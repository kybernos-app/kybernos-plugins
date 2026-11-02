// Kaby, the DSH side of the person's own assistant (kybernos-server ADR 0053): the Telegram pairing by QR code or link, the choice of
// the cloud computer linked to it, and the disconnect. This file holds what is pure: the shapes a page may rely on, what a refusal is
// called, the QR. index.js makes the network calls with the account's token and hands this factory what it needs, so every route is
// tested without a server. (Kaby's own chat is a native DSH conversation: kyby-native.mjs.)
//
// Two rules run through it. The page only ever gets WORDS for a refusal (a server's own text may echo what was sent), and nothing
// returns the token, the pairing's secret part on its own, or the server's raw answer.

import { encodeQr } from './qr.mjs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BOT = /^[A-Za-z0-9_]{3,64}$/
const START = /^https:\/\/t\.me\/([A-Za-z0-9_]{3,64})\?start=pair_[a-z0-9]{8,64}$/
export const PAIRING_STATES = Object.freeze(['waiting', 'scanned', 'done', 'declined', 'expired'])
export const DECLINE_REASONS = Object.freeze(['user', 'taken', 'botmade'])

/** Codes a page may be told. Anything else the server says is `refused`. */
const KNOWN = Object.freeze([
  'not_found', 'already_linked', 'not_linked', 'computer_not_found', 'computer_unavailable', 'rate_limited', 'busy', 'turn_pending', 'model_required', 'model_not_in_plan', 'model_not_found',
  'feature_not_in_plan', 'insufficient_quota', 'payment_past_due', 'budget_not_configured', 'job_bud', 'hosted_busy', 'queue_full',
  'thread_full', 'storage_full', 'hosted_runs_disabled', 'no_runner', 'kyber_archived', 'thread_archived', 'client_turn_conflict', 'unsupported',
  'mfa_required_by_workspace', 'plan_required', 'computers_off_for_workspace', 'invalid_request', 'thread_limit', 'computer_unavailable',
])

/** One word for an answer that is not a success. Never the server's text. */
export const codeOf = (res) => {
  if (res === null || typeof res !== 'object') return 'unreachable'
  if (res.status === 0 || res.status === undefined) return 'unreachable'
  if (res.status === 401) return 'not_connected'
  const e = res.body !== null && typeof res.body === 'object' ? res.body.error : undefined
  const code = typeof e === 'string' ? e : (e !== null && typeof e === 'object' && typeof e.code === 'string' ? e.code : '')
  // A route the server does not have answers 404 with none of OUR codes (a framework's own page, or {detail}): « unsupported », so the page can say that this
  // server is too old, not fail silently. A 404 that carries our code (`not_found`) is the door being off, which is another thing.
  if (res.status === 404 && code === '') return 'unsupported'
  return KNOWN.includes(code) ? code : 'refused'
}

/** Whether the server has the pairing routes (ADR 0053 slice of PR #230), from the status of the two reads the host already makes: `GET /v1/me/telegram` and `GET /v1/me/kyby`.
 *  « unsupported »: either is a 404 (the server is older than the routes); « supported »: both answered; « unknown »: anything else (a failure says nothing about the routes). */
export const pairingSupport = (telegramStatus, kybyStatus) => {
  if (telegramStatus === 404 || kybyStatus === 404) return 'unsupported'
  return telegramStatus === 200 && kybyStatus === 200 ? 'supported' : 'unknown'
}

const asObj = (v) => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v : null)
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '')

/** What the page may know of a pairing. `link` is checked: only the bot's own t.me address with a start payload is ever drawn or opened. */
export const pairingOf = (body) => {
  const b = asObj(body)
  if (b === null || typeof b.id !== 'string' || !UUID.test(b.id)) return null
  const link = typeof b.link === 'string' ? b.link : ''
  const m = START.exec(link)
  if (m === null) return null
  return { id: b.id, link, bot: m[1], expires_at: str(b.expires_at, 40) }
}

export const pairingStateOf = (body) => {
  const b = asObj(body)
  if (b === null || !PAIRING_STATES.includes(b.state)) return null
  return {
    state: b.state,
    reason: DECLINE_REASONS.includes(b.reason) ? b.reason : null,
    sender: str(b.sender, 80),
    expires_at: str(b.expires_at, 40),
  }
}

/**
 * @param deps { readState, isConnected, apiCall, deviceLabel, now? } the same helpers index.js already has.
 * Every handler is `(req, body) => Promise<object>` and never throws; a refusal is `{ ok: false, error: <word> }`.
 */
export function createKybyRoutes (deps) {
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now()

  const session = () => {
    const state = deps.readState()
    return deps.isConnected(state) === true && typeof state.token === 'string' ? state.token : null
  }
  const queryOf = (req) => {
    try { return new URL(String((req && req.url) || ''), 'http://localhost').searchParams } catch (e) { return new URLSearchParams() }
  }

  return {
    /** POST: asks the server for a pairing and draws its QR. */
    async pairingStart () {
      const token = session()
      if (token === null) return { ok: false, error: 'not_connected' }
      const res = await deps.apiCall('/v1/me/telegram/pairing', { method: 'POST', token, body: { device_label: String(deps.deviceLabel()).slice(0, 60) }, timeoutMs: 15000 })
      if (res.status !== 201 && res.status !== 200) return { ok: false, error: codeOf(res) }
      const p = pairingOf(res.body)
      if (p === null) return { ok: false, error: 'refused' }
      let qr = null
      try {
        const q = encodeQr(p.link, { ecc: 'M' })
        qr = { size: q.size, modules: q.modules }
      } catch (e) { qr = null }
      return { ok: true, ...p, qr }
    },

    /** GET ?id=: where the pairing stands. */
    async pairingState (req) {
      const token = session()
      if (token === null) return { ok: false, error: 'not_connected' }
      const id = queryOf(req).get('id') || ''
      if (!UUID.test(id)) return { ok: false, error: 'invalid_request' }
      const res = await deps.apiCall('/v1/me/telegram/pairing?id=' + encodeURIComponent(id), { method: 'GET', token, timeoutMs: 15000 })
      if (res.status !== 200) return { ok: false, error: codeOf(res) }
      const s = pairingStateOf(res.body)
      return s === null ? { ok: false, error: 'refused' } : { ok: true, ...s }
    },

    /** POST {id}: the person says it is not them. */
    async pairingCancel (req, body) {
      const token = session()
      if (token === null) return { ok: false, error: 'not_connected' }
      const id = body !== null && typeof body === 'object' ? String(body.id || '') : ''
      if (!UUID.test(id)) return { ok: false, error: 'invalid_request' }
      const res = await deps.apiCall('/v1/me/telegram/pairing?id=' + encodeURIComponent(id), { method: 'DELETE', token, timeoutMs: 15000 })
      return res.status === 200 ? { ok: true } : { ok: false, error: codeOf(res) }
    },

    /** POST {computer_id}: the cloud computer linked to the assistant (null = the default). */
    async computer (req, body) {
      const token = session()
      if (token === null) return { ok: false, error: 'not_connected' }
      const id = body !== null && typeof body === 'object' ? body.computer_id : undefined
      if (id !== null && !(typeof id === 'string' && UUID.test(id))) return { ok: false, error: 'invalid_request' }
      const res = await deps.apiCall('/v1/me/kyby/computer', { method: 'PUT', token, body: { computer_id: id }, timeoutMs: 15000 })
      const b = res.status === 200 ? asObj(res.body) : null
      return b !== null && (b.computer_id === null || typeof b.computer_id === 'string') ? { ok: true, computer_id: b.computer_id } : { ok: false, error: codeOf(res) }
    },

    /** POST: disconnects this account's Telegram (the route needs no recent sign-in; the chat can be linked again at once). */
    async unlink () {
      const token = session()
      if (token === null) return { ok: false, error: 'not_connected' }
      const res = await deps.apiCall('/v1/me/telegram', { method: 'DELETE', token, timeoutMs: 15000 })
      return res.status === 200 ? { ok: true } : { ok: false, error: codeOf(res) }
    },
  }
}
