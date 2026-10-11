// Main-session failover: the chat itself moves to the next whitelist model when its own cannot answer.
//   node packages/kybernos-auto/test-failover.mjs
// Driven with fake `agent/request` / `agent/request-error` payloads, a fake clock and the REAL breaker (resilience.mjs).
import { IMMEDIATE_CODES, TRANSIENT_CODES, createFailover, issueOf, routeKey } from './failover.mjs'
import { apresIssue, etatDisjoncteur, PAUSE_MIN_MS, PAUSE_MAX_MS } from './resilience.mjs'
import { mountFailover } from './index.js'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + JSON.stringify(detail)))
  if (!ok) failed += 1
}

const WHITELIST = ['zai/glm-5', 'openrouter/qwen/qwen-coder', 'ollama-local/llama3']
const PRIMARY = { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high', maxTokens: 8000, temperature: 0.2 }

// A world: clock, health map (the real breaker), notes, and a failover wired to them.
const world = (opts = {}) => {
  const w = { t: 1_000_000, enabled: opts.enabled !== false, whitelist: opts.whitelist || WHITELIST, health: {}, notes: [], logs: [] }
  w.fo = createFailover({
    settings: () => ({ enabled: w.enabled }),
    health: () => w.health,
    note: (model, issue) => { w.notes.push({ model, issue }); w.health[model] = apresIssue(w.health[model], issue, w.t) },
    fallbacks: () => w.whitelist,
    now: () => w.t,
    log: (l) => w.logs.push(l)
  })
  return w
}
const agent = { id: 'agent-1' }
const request = (w, call = PRIMARY, { turn = 1, step = 1, who = agent } = {}) => w.fo.onRequest({ agent: who, turn, step, signal: new AbortController().signal }, async () => ({ ...call }))
const failure = (w, code, { turn = 1, step = 1, signal = new AbortController().signal, who = agent, downstream } = {}) => {
  let nextCalls = 0
  const p = w.fo.onRequestError({ agent: who, turn, step, provider: 'x', failure: { code, message: code + ' happened' }, retryPolicy: undefined, signal }, async () => { nextCalls += 1; return downstream })
  return p.then((action) => ({ action, nextCalls }))
}

console.log('off by default')
{
  const w = world({ enabled: false })
  const call = await request(w)
  check('the call is left exactly as the engine proposed it', JSON.stringify(call) === JSON.stringify(PRIMARY))
  const r = await failure(w, 'AUTH')
  check('a failure is handed to the engine untouched (next called once)', r.action === undefined && r.nextCalls === 1)
  check('and nothing is recorded', w.notes.length === 0)
}

console.log('a healthy primary')
{
  const w = world()
  const call = await request(w)
  check('is served as it is, with its reasoning effort and cap', JSON.stringify(call) === JSON.stringify(PRIMARY))
  check('the view says it is on and nothing moved', JSON.stringify(w.fo.view()) === JSON.stringify({ enabled: true, last: null }))
}

console.log('a refused key (cannot be fixed by waiting)')
{
  const w = world()
  await request(w)
  const r = await failure(w, 'AUTH')
  check('moves on at once: retry, and the engine\'s own retries are not consulted', r.action !== undefined && r.action.kind === 'retry' && r.nextCalls === 0, r)
  check('the failed model is noted with its real classification', w.notes.length === 1 && w.notes[0].model === 'deepseek/deepseek-chat' && w.notes[0].issue.etat === 'erreur' && w.notes[0].issue.code === 'AUTH', w.notes)
  check('its breaker is open for a long pause (a refused key is not a flake)', etatDisjoncteur(w.health['deepseek/deepseek-chat'], w.t) === 'open' && w.health['deepseek/deepseek-chat'].openUntil - w.t >= PAUSE_MAX_MS)
  const served = await request(w)
  check('the retry is served by the first whitelist model', served.provider === 'zai' && served.model === 'glm-5', served)
  check('which does not inherit the primary\'s reasoning effort or output cap', served.reasoningEffort === undefined && served.maxTokens === undefined)
  check('but keeps the generic controls', served.temperature === 0.2)
  check('the page can say where it went and why', w.fo.view().last.from === 'deepseek/deepseek-chat' && w.fo.view().last.to === 'zai/glm-5' && w.fo.view().last.code === 'AUTH')
}

console.log('a transient failure goes through the engine\'s own retries first')
{
  const w = world()
  await request(w)
  const retried = await failure(w, 'SERVER', { downstream: { kind: 'retry' } })
  check('when the engine retries the same model, nothing moves', retried.action.kind === 'retry' && retried.nextCalls === 1 && w.notes.length === 0)
  const again = await request(w)
  check('and the same model is asked again', again.model === 'deepseek-chat')
  const gaveUp = await failure(w, 'SERVER', { downstream: undefined })
  check('when the engine gives up, the next model is served', gaveUp.action.kind === 'retry' && gaveUp.nextCalls === 1 && w.notes.length === 1)
  check('the failed model is set aside for a pause that starts at one minute', etatDisjoncteur(w.health['deepseek/deepseek-chat'], w.t) === 'open' && w.health['deepseek/deepseek-chat'].openUntil - w.t === PAUSE_MIN_MS, w.health['deepseek/deepseek-chat'])
  check('with the cause kept (the page says why it is skipped)', w.health['deepseek/deepseek-chat'].lastError.code === 'SERVER')
  const served = await request(w)
  check('and the whitelist model answers', served.provider === 'zai')
}

console.log('the primary comes back, it is never sticky')
{
  const w = world()
  await request(w)
  await failure(w, 'TIMEOUT')
  await request(w)
  w.t += PAUSE_MIN_MS - 1000
  const stillOut = await request(w, { provider: 'zai', model: 'glm-5' }, { step: 2 })
  check('before its pause ends the fallback keeps serving', stillOut.provider === 'zai')
  w.t += 2000
  const back = await request(w, { provider: 'zai', model: 'glm-5' }, { step: 3 })
  check('once the pause ends the primary is tried again (the engine proposes the logged fallback; we serve the primary)', back.provider === 'deepseek' && back.model === 'deepseek-chat', back)
  check('and a refused trial doubles the pause', await (async () => { await failure(w, 'TIMEOUT', { step: 3 }); const r = w.health['deepseek/deepseek-chat']; return etatDisjoncteur(r, w.t) === 'open' && r.openUntil - w.t === PAUSE_MIN_MS * 2 })())
}

console.log('a trial that answers closes the breaker')
{
  const w = world()
  w.health['deepseek/deepseek-chat'] = apresIssue(undefined, { etat: 'bascule', code: 'TIMEOUT', message: '' }, w.t - PAUSE_MIN_MS - 1)
  check('precondition: the pause has ended (half-open)', etatDisjoncteur(w.health['deepseek/deepseek-chat'], w.t) === 'half-open')
  await request(w)
  w.fo.onStream({ agent, frame: { type: 'end', outcome: { kind: 'committed', eventType: 'assistant/message' } } })
  check('the committed answer is noted as a success', w.notes.length === 1 && w.notes[0].issue.etat === 'ok')
  check('and the breaker is closed', etatDisjoncteur(w.health['deepseek/deepseek-chat'], w.t) === 'closed' && w.health['deepseek/deepseek-chat'].consecutive === 0)
  const quiet = world()
  await request(quiet)
  quiet.fo.onStream({ agent, frame: { type: 'end', outcome: { kind: 'committed', eventType: 'assistant/message' } } })
  check('a healthy model\'s answers write nothing (no I/O per message)', quiet.notes.length === 0)
  quiet.fo.onStream({ agent, frame: { type: 'chunk' } })
  quiet.fo.onStream({ agent, frame: { type: 'end', outcome: { kind: 'committed', eventType: 'assistant/attempt' } } })
  check('chunks and attempts are ignored', quiet.notes.length === 0)
}

console.log('what must never move')
{
  const w = world()
  await request(w)
  const ctl = new AbortController(); ctl.abort()
  const cancelled = await failure(w, 'AUTH', { signal: ctl.signal })
  check('a turn the person cancelled', cancelled.action === undefined && cancelled.nextCalls === 1 && w.notes.length === 0)
  for (const code of ['CONTEXT_WINDOW_EXCEEDED', 'INVALID_REQUEST', 'IMAGE_OFFLOAD_REQUIRED', 'PI_AI_ERROR', 'SOMETHING_NEW']) {
    const r = await failure(w, code)
    check('failure ' + code + ' is not about the model', r.action === undefined && r.nextCalls === 1 && w.notes.length === 0, r)
  }
  const stranger = await failure(w, 'AUTH', { who: { id: 'never-served' } })
  check('a request this module did not serve', stranger.action === undefined && stranger.nextCalls === 1 && w.notes.length === 0)
}

console.log('the chain is finite')
{
  const w = world({ whitelist: ['zai/glm-5', 'ollama-local/llama3'] })
  const seen = []
  let call = await request(w)
  seen.push(routeKey(call))
  for (let i = 0; i < 6; i += 1) {
    const r = await failure(w, 'AUTH')
    if (r.action === undefined) break
    call = await request(w)
    seen.push(routeKey(call))
  }
  check('every model is asked once, then the engine\'s own error stands', seen.join() === 'deepseek/deepseek-chat,zai/glm-5,ollama-local/llama3', seen)
  const none = await request(w)
  check('with nothing left the call is left as proposed (its own error is the answer)', none.provider === 'deepseek' || none.provider === 'ollama-local' || none.provider === 'zai')
  const w2 = world({ whitelist: [] })
  await request(w2)
  const r = await failure(w2, 'AUTH')
  check('an empty whitelist: the failure stays terminal', r.action === undefined && w2.notes.length === 1)
}

console.log('a new step starts clean, and a changed model is a new primary')
{
  const w = world()
  await request(w)
  await failure(w, 'NO_ADAPTER')
  const served = await request(w)
  check('step 1 moved on', served.provider === 'zai')
  w.health = {}
  const nextStep = await request(w, PRIMARY, { step: 2 })
  check('step 2 proposes the primary again and gets it (nothing excluded any more)', nextStep.provider === 'deepseek')
  const chosen = await request(w, { provider: 'openrouter', model: 'anthropic/claude', reasoningEffort: 'low' }, { step: 3 })
  check('the person picked another model: it is served as is', chosen.provider === 'openrouter' && chosen.model === 'anthropic/claude' && chosen.reasoningEffort === 'low')
}

console.log('the classification')
{
  check('a refused key keeps its real class', issueOf('AUTH', 'bad key').etat === 'erreur')
  check('a rate limit keeps the limit pause', issueOf('RATE_LIMIT', '').etat === 'limite')
  check('a model that said it is not a language model is set aside for an hour, not failed over', issueOf('INVALID_REQUEST', 'This is not a language model').etat === 'hors-jeu')
  check('a server error, a timeout or a missing adapter is "could not serve just now"', ['SERVER', 'TIMEOUT', 'TRANSPORT', 'NO_ADAPTER'].every((c) => issueOf(c, '').etat === 'bascule'))
  check('the two lists do not overlap', IMMEDIATE_CODES.every((c) => TRANSIENT_CODES.indexOf(c) < 0))
  let r = apresIssue(undefined, { etat: 'bascule', code: 'SERVER', message: '' }, 0)
  const pauses = []
  for (let i = 0; i < 6; i += 1) { pauses.push(r.openUntil - 0); r = apresIssue(r, { etat: 'bascule', code: 'SERVER', message: '' }, 0) }
  check('the pause doubles: 1, 2, 4, 8, then 10 minutes', pauses.join() === [60000, 120000, 240000, 480000, 600000, 600000].join(), pauses)
}

console.log('mounting')
{
  const registered = []
  const ctx = {
    effect: (fn, label) => { const d = fn(); registered.push({ label, d }); return d },
    on: (event, handler, options) => { registered.push({ event, options }); return () => {} }
  }
  const w = world()
  mountFailover(ctx, w.fo)
  const events = registered.filter((r) => r.event !== undefined)
  check('three events are hooked', events.map((e) => e.event).sort().join() === 'agent/assistant-stream,agent/request,agent/request-error', events)
  check('the request-error hook runs first in line', events.find((e) => e.event === 'agent/request-error').options.prepend === true)
  const broken = { effect: () => { throw new Error('no effect service') }, on: () => () => {} }
  let threw = null
  const realError = console.error
  console.error = () => {}
  try { mountFailover(broken, w.fo) } catch (e) { threw = e } finally { console.error = realError }
  check('a DSH that cannot hook an event does not stop here', threw === null)
}

console.log(failed === 0 ? '\nOK' : `\n${failed} failure(s)`)
process.exit(failed === 0 ? 0 : 1)
