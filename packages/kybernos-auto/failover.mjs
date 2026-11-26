// Main-session failover (opt-in): when the model of the person's own chat cannot answer, the same step is served by
// the next healthy model of the Auto whitelist, instead of ending the turn on an error.
//
// Until now Auto only protected DELEGATIONS (probe, breaker, fallback chain). The chat itself stopped on the first
// refused key or dead provider. This module hooks the two events DSH gives for that and nothing else, no engine patch:
//
//   `agent/request`        a waterfall that may replace the frozen call configuration (provider + model). Run again
//                          on every attempt of a step, retries included.
//   `agent/request-error`  a waterfall asked, once per failed attempt, "retry?". `{ kind: 'retry' }` runs the
//                          request waterfall again; `undefined` leaves the failure terminal.
//
// What it does, in order:
//   · the model the person chose stays the PRIMARY: it is served again as soon as its pause ends (one trial decides),
//     so a failover is never sticky;
//   · a failure that retrying cannot fix (a refused key, a model that is gone, no adapter for the route) moves to
//     the next model at once; a transient one (rate limit, server error, timeout, transport) first goes through the
//     engine's own retries (`llm-retry`), and moves on only when those gave up;
//   · the candidates are the Auto whitelist in its order, minus the models whose breaker is open (`resilience.mjs`:
//     the SAME health file as the delegations, so each side learns from the other);
//   · a model that failed is never asked twice for the same step, so the chain is finite;
//   · a fallback route does not inherit the primary's reasoning effort or output cap: both are model-specific.
//
// Never: when the person cancelled, when the failure is not about the model (context window, invalid request), or
// when nothing healthy is left (the engine then reports its own error, unchanged).
//
// Pure: every effect (settings, health, notes, the clock) is injected, so the tests drive it with fake payloads.
import { etatDisjoncteur, triCandidats } from './resilience.mjs'
import { classerCode, decouperCle } from './sonde.mjs'

/** Retrying cannot fix these: the next model is served at once. */
export const IMMEDIATE_CODES = ['AUTH', 'UNKNOWN_MODEL', 'INVALID_MODEL', 'NO_ADAPTER']
/** These may pass: the engine's own retries go first, the next model is served when they gave up. */
export const TRANSIENT_CODES = ['RATE_LIMIT', 'QUOTA', 'OVERLOADED', 'SERVER', 'TIMEOUT', 'TRANSPORT', 'NETWORK']
/** The most agents followed at once; the oldest is forgotten past it. */
const AGENTS_MAX = 200

/** What a failure means for the breaker. A refused key, a gone model and a rate limit keep their real classification
 *  (long pause, or the limit pause); anything else is "this model could not serve the chat just now": `bascule`. */
export function issueOf (code, message) {
  const base = classerCode(code, message)
  if (base.etat === 'limite' || base.etat === 'hors-jeu') return base
  if (code === 'AUTH' || code === 'UNKNOWN_MODEL' || code === 'INVALID_MODEL') return base
  return { etat: 'bascule', code, message }
}

/** The route of a call configuration, as the Auto whitelist spells it: `provider/model`. */
export const routeKey = (call) => String(call.provider) + '/' + String(call.model)

const withoutModelSpecifics = (call) => {
  const { reasoningEffort, maxTokens, ...rest } = call
  return rest
}

/**
 * @param {object} io
 * @param {() => { enabled: boolean }} io.settings     read at each event: the switch takes effect at once
 * @param {() => object} io.health                      the raw health map (`auto-health.json`)
 * @param {(model: string, issue: object) => void} io.note   records an outcome (a failure counts as a failed call)
 * @param {() => string[]} io.fallbacks                 the whitelist models able to serve a chat, in order
 * @param {() => number} [io.now]
 * @param {(line: string) => void} [io.log]
 */
export function createFailover ({ settings, health, note, fallbacks, now = () => Date.now(), log = () => {} }) {
  const agents = new Map()
  let last = null

  const agentId = (payload) => (payload && payload.agent && typeof payload.agent.id === 'string' && payload.agent.id !== '' ? payload.agent.id : 'default')
  const fresh = (primaryKey) => ({ primary: primaryKey, served: null, turn: -1, step: -1, tried: new Set() })
  const remember = (id, st) => {
    agents.delete(id)
    agents.set(id, st)
    if (agents.size > AGENTS_MAX) agents.delete(agents.keys().next().value)
  }
  const eligible = (st) => {
    const order = [st.primary]
    for (const key of fallbacks()) if (order.indexOf(key) < 0) order.push(key)
    return triCandidats(order, health(), now(), { exclure: Array.from(st.tried) }).eligibles
  }

  /** `agent/request`: serve the first eligible route of [primary, ...whitelist]. */
  async function onRequest (payload, next) {
    const call = await next()
    try {
      if (settings().enabled !== true || call === null || typeof call !== 'object') return call
      const id = agentId(payload)
      const key = routeKey(call)
      let st = agents.get(id)
      // First sight, or the person changed the model: what the engine proposes is the primary now. What we served
      // ourselves comes back as the logged header: that is not a choice of the person.
      if (st === undefined || (key !== st.served && key !== st.primary)) st = fresh(key)
      if (st.turn !== payload.turn || st.step !== payload.step) { st.tried.clear(); st.turn = payload.turn; st.step = payload.step }
      remember(id, st)
      const chosen = eligible(st)[0]
      // Nothing healthy: the call stays as the engine proposed it, and its own error is the answer.
      if (chosen === undefined) { st.served = key; return call }
      st.served = chosen
      if (chosen === key) return call
      const parts = decouperCle(chosen)
      if (parts === null) { st.served = key; return call }
      return { ...withoutModelSpecifics(call), provider: parts.route, model: parts.modele }
    } catch (e) {
      log('failover: request hook failed, the call is left as it was: ' + String(e && e.message ? e.message : e))
      return call
    }
  }

  /** `agent/request-error`: decide whether to move on to the next model. */
  async function onRequestError (payload, next) {
    let st
    let code
    try {
      if (settings().enabled !== true) return next()
      if (payload.signal !== undefined && payload.signal !== null && payload.signal.aborted === true) return next()
      st = agents.get(agentId(payload))
      code = payload.failure !== undefined && payload.failure !== null && typeof payload.failure.code === 'string' ? payload.failure.code : 'UNKNOWN'
      // A request this module did not serve is none of its business.
      if (st === undefined || st.served === null) return next()
      if (IMMEDIATE_CODES.indexOf(code) < 0 && TRANSIENT_CODES.indexOf(code) < 0) return next()
    } catch (e) {
      return next()
    }
    let downstream
    if (IMMEDIATE_CODES.indexOf(code) < 0) {
      // Transient: the engine's own retries first. Only when it gives up do we move on.
      downstream = await next()
      if (downstream !== undefined && downstream !== null && downstream.kind === 'retry') return downstream
    }
    try {
      const failed = st.served
      st.tried.add(failed)
      st.served = null
      note(failed, issueOf(code, payload.failure !== undefined && payload.failure !== null && typeof payload.failure.message === 'string' ? payload.failure.message : ''))
      const alternative = eligible(st)[0]
      if (alternative === undefined) return downstream
      last = { at: now(), from: failed, to: alternative, code, primary: st.primary }
      log('failover: ' + failed + ' → ' + alternative + ' (' + code + ')')
      return { kind: 'retry' }
    } catch (e) {
      log('failover: request-error hook failed, the failure stays as it was: ' + String(e && e.message ? e.message : e))
      return downstream
    }
  }

  /** `agent/assistant-stream`: a committed answer closes the loop: a model on trial that answered is healthy again. */
  function onStream (payload) {
    try {
      const frame = payload !== null && typeof payload === 'object' ? payload.frame : null
      if (frame === null || frame === undefined || frame.type !== 'end') return
      if (frame.outcome === undefined || frame.outcome.kind !== 'committed' || frame.outcome.eventType !== 'assistant/message') return
      const st = agents.get(agentId(payload))
      if (st === undefined || st.served === null) return
      st.tried.clear()
      const rec = health()[st.served]
      const wasOnTrial = etatDisjoncteur(rec, now()) !== 'closed' || (rec !== undefined && rec !== null && Number(rec.consecutive) > 0)
      if (wasOnTrial) note(st.served, { etat: 'ok', code: 'stop', message: '' })
    } catch (e) { /* a lost note never breaks the chat */ }
  }

  /** What the Auto page shows: the switch and the last move, if any. */
  const view = () => ({ enabled: settings().enabled === true, last })

  return { onRequest, onRequestError, onStream, view }
}
