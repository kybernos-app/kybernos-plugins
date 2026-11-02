// A session the engine lists as done can have ended on a failed turn (audit A5-11). This proves the two halves of how the
// Automations board learns it: the verdict on a journal (session-outcome.mjs) and the host route that serves it
// (GET /kybernos/tasks/outcomes, driven through the real apply() on a fake context).
//   node packages/kybernos-plugin/test-session-outcome.mjs   (exit 0 = everything passes)
import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { lastTurnOutcome, OUTCOME_MESSAGE_MAX } from './session-outcome.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

// ── the verdict, on the events the engine really writes (a turn with no credential for the model) ────────────────
const MISSING = { message: 'llm-pi-ai: no credential for provider route "zai-coding-cn"; its profile resolves ZAI_CODING_CN_API_KEY, which is not set', code: 'MISSING_CREDENTIAL' }
const failedTurn = [
  { type: 'user/message', seq: 11, data: {} },
  { type: 'turn/start', seq: 7, time: 1, data: { turn: 1 } },
  { type: 'assistant/attempt', seq: 20, data: { turn: 1, step: 1 } },
  { type: 'step/end', seq: 21, data: { turn: 1, step: 1 } },
  { type: 'turn/end', seq: 22, time: 2, data: { turn: 1, reason: { kind: 'error', error: MISSING } } },
]
{
  const v = lastTurnOutcome(failedTurn)
  assert.deepEqual([v.open, v.failed, v.code], [false, true, 'MISSING_CREDENTIAL'])
  assert.match(v.message, /no credential for provider route/)
  ok('a turn closed with an error reason is a failed turn, with the engine\'s code and message')
}
{
  const done = [{ type: 'turn/start', data: { turn: 1 } }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }]
  assert.deepEqual(lastTurnOutcome(done), { open: false, failed: false })
  assert.deepEqual(lastTurnOutcome([{ type: 'turn/start' }, { type: 'turn/end', data: { reason: { kind: 'aborted' } } }]), { open: false, failed: false })
  assert.deepEqual(lastTurnOutcome([{ type: 'turn/start' }, { type: 'turn/end', data: {} }]), { open: false, failed: false })
  ok('any other ending is not a failure (only the engine\'s `error` kind is)')
}
{
  assert.deepEqual(lastTurnOutcome(failedTurn.concat([{ type: 'turn/start', seq: 30, data: { turn: 2 } }])), { open: true })
  assert.deepEqual(lastTurnOutcome([{ type: 'user/message' }]), { open: true })
  assert.deepEqual(lastTurnOutcome([]), { open: true })
  ok('a turn still open, or no turn at all, gives no verdict')
}
{
  const retried = failedTurn.concat([{ type: 'turn/start', seq: 30, data: { turn: 2 } }, { type: 'turn/end', seq: 31, data: { turn: 2, reason: { kind: 'completed' } } }])
  assert.equal(lastTurnOutcome(retried).failed, false)
  ok('only the LAST turn counts: a failure followed by a good turn is not a failure')
}
{
  const long = [{ type: 'turn/start' }, { type: 'turn/end', data: { reason: { kind: 'error', error: { message: 'x'.repeat(5000) + '\u0000\u0007', code: 'C\n\u0000' } } } }]
  const v = lastTurnOutcome(long)
  assert.equal(v.message.length, OUTCOME_MESSAGE_MAX)
  assert.equal(v.code, 'C')
  assert.deepEqual(lastTurnOutcome([null, 3, 'x', { type: 'turn/start' }, { type: 'turn/end', data: null }]), { open: false, failed: false })
  assert.deepEqual(lastTurnOutcome([null, 3, 'x', undefined]), { open: true })
  assert.deepEqual(lastTurnOutcome(null), { open: true })
  assert.equal(lastTurnOutcome([{ type: 'turn/start' }, { type: 'turn/end', data: { reason: { kind: 'error' } } }]).failed, true)
  ok('the message is bounded and free of control characters; hostile input does not throw; an error with no detail is still a failure')
}

// ── the route, through the real apply() ──────────────────────────────────────────────────────────────────────────
const here = dirname(fileURLToPath(import.meta.url))
const scratch = mkdtempSync(join(tmpdir(), 'kb-outcome-'))
const copy = join(scratch, 'plugin')
mkdirSync(copy, { recursive: true })
for (const file of readdirSync(here)) {
  if (file === 'client.js' || file.startsWith('test-') || statSync(join(here, file)).isFile() === false) continue
  copyFileSync(join(here, file), join(copy, file))
}
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, DSH_HOME: process.env.DSH_HOME }
process.env.HOME = join(scratch, 'home')
process.env.USERPROFILE = process.env.HOME
process.env.DSH_HOME = join(scratch, 'dsh')
mkdirSync(process.env.DSH_HOME, { recursive: true })
const disposers = []
try {
  const mod = await import(pathToFileURL(join(copy, 'index.js')).href)
  const journals = { 'session-bad': failedTurn, 'session-good': [{ type: 'turn/start' }, { type: 'turn/end', data: { reason: { kind: 'completed' } } }], 'session-open': [{ type: 'turn/start' }] }
  const opened = []
  const persistence = { open: async (id) => {
    opened.push(id)
    if (Object.prototype.hasOwnProperty.call(journals, id) !== true) throw new Error('no such session')
    return { read: async () => ({ events: journals[id] }), close: async () => {} }
  } }
  const registered = {}
  const webServer = { register: (r) => { registered[r.path] = r.handler; return () => { delete registered[r.path] } } }
  const services = { fs: {}, webServer, sessionPersistence: persistence }
  mod.apply({ get: (n) => services[n], inject: () => {}, effect: (fn) => { const d = fn(); if (typeof d === 'function') disposers.push(d); return d }, on: () => {} })

  const PORT = 3080
  const get = async (query, method = 'GET', origin = 'http://127.0.0.1:' + PORT) => {
    const handler = registered['/kybernos/tasks/outcomes']
    assert.ok(handler !== undefined, 'the route is registered')
    const res = { code: 0, raw: null, writeHead (c) { this.code = c }, end (p) { this.raw = p === undefined ? null : String(p) } }
    await handler({ method, url: '/kybernos/tasks/outcomes' + query, headers: { origin, host: '127.0.0.1:' + PORT }, socket: { localPort: PORT }, async *[Symbol.asyncIterator] () {} }, res)
    let json = null
    try { json = JSON.parse(res.raw) } catch (e) { json = null }
    return { code: res.code, json }
  }

  const r = await get('?ids=session-bad,session-good,session-open,session-gone')
  assert.equal(r.code, 200)
  assert.deepEqual(r.json.outcomes['session-bad'].failed, true)
  assert.equal(r.json.outcomes['session-bad'].code, 'MISSING_CREDENTIAL')
  assert.deepEqual(r.json.outcomes['session-good'], { failed: false })
  ok('the route gives the verdict of each finished session')
  assert.equal(Object.prototype.hasOwnProperty.call(r.json.outcomes, 'session-open'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(r.json.outcomes, 'session-gone'), false)
  ok('a session still running, or one that cannot be read, is absent: no verdict is claimed')

  opened.length = 0
  const many = await get('?ids=' + Array.from({ length: 40 }, (_, i) => 'session-' + i).join(',') + ',../../etc/passwd,' + 'a'.repeat(200))
  assert.equal(many.code, 200)
  assert.equal(opened.length, 20, 'at most 20 journals are read per call')
  assert.equal(opened.some((id) => id.includes('/')), false, 'an id that is not a plain session id is never opened')
  ok('at most 20 sessions per call, and only plain session ids are opened')

  assert.equal((await get('?ids=session-bad', 'POST')).code, 405)
  assert.equal((await get('?ids=session-bad', 'GET', 'http://evil.example')).code, 403)
  assert.equal((await get('')).json.ok, true)
  ok('only GET from this machine\'s origin is served; no ids is an empty answer')
} finally {
  for (const d of disposers) { try { d() } catch (e) { /* best effort */ } }
  for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  rmSync(scratch, { recursive: true, force: true })
}
console.log('\n' + pass + ' verifications OK')
// The plugin may leave timers running (bridge tick, trim): the test is over.
process.exit(0)
