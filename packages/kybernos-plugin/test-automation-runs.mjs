// What an automation run did, read from the engine's journal. This proves the two halves of how the Sessions and Journal views learn
// it: the summary of a journal (automation-runs.mjs) and the host route that serves it (GET /kybernos/tasks/runs, driven through the
// real apply() on a fake context).
//   node packages/kybernos-plugin/test-automation-runs.mjs   (exit 0 = everything passes)
import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { RUN_LABEL_MAX, RUN_NODES_DETAIL, RUN_NODES_LIST, RUN_TEXT_MAX, scrub, summarizeRun } from './automation-runs.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

// ── a journal as the engine writes it: a first step that calls a tool, a second that calls two, a last that only answers ─────────────
const T0 = 1_790_000_000_000
let seq = 0
const ev = (type, dt, data) => ({ type, seq: (seq += 1), time: T0 + dt, data })
const call = (dt, step, callId, name, args) => ev('tool/call', dt, { turn: 1, step, callId, name, arguments: JSON.stringify(args) })
const result = (dt, step, callId, content, isError) => ev('tool/result', dt, { turn: 1, step, message: Object.assign({ role: 'tool', toolCallId: callId, content }, isError === true ? { isError: true } : {}) })
const header = (dt) => ev('request/header', dt, { header: { config: { provider: 'acme', model: 'alpha-1' } } })
const okRun = [
  ev('session', 0, {}),
  ev('turn/start', 100, { turn: 1 }),
  ev('step/start', 110, { turn: 1, step: 1 }),
  header(120),
  ev('assistant/message', 11_600, { turn: 1, step: 1 }),
  call(11_600, 1, 'c1', 'bash', { command: 'ls ~/data', description: 'List the data folder' }),
  result(17_300, 1, 'c1', [{ type: 'text', text: 'one two three' }]),
  ev('step/end', 17_300, { turn: 1, step: 1 }),
  ev('step/start', 17_310, { turn: 1, step: 2 }),
  header(17_320),
  ev('assistant/message', 21_500, { turn: 1, step: 2 }),
  call(21_500, 2, 'c2', 'skill', { name: 'report-writer' }),
  call(21_500, 2, 'c3', 'read', { path: '/tmp/notes.md' }),
  result(21_600, 2, 'c2', 'skill text'),
  result(21_900, 2, 'c3', 'the notes', true),
  ev('step/end', 21_900, { turn: 1, step: 2 }),
  ev('step/start', 21_910, { turn: 1, step: 3 }),
  ev('assistant/message', 28_400, { turn: 1, step: 3 }),
  ev('step/end', 28_400, { turn: 1, step: 3 }),
  ev('turn/end', 28_410, { turn: 1, reason: { kind: 'completed' } }),
]

{
  const r = summarizeRun(okRun)
  assert.equal(r.startedAt, new Date(T0 + 100).toISOString())
  assert.equal(r.endedAt, new Date(T0 + 28_410).toISOString())
  assert.equal(r.durationMs, 28_310)
  assert.deepEqual(r.outcome, { state: 'completed' })
  assert.deepEqual(r.models, [{ provider: 'acme', model: 'alpha-1' }])
  assert.equal(r.selected, false)
  assert.deepEqual([r.turns, r.steps, r.toolCalls, r.nodeCount], [1, 3, 3, 3])
  ok('a finished run: its own clock, the engine\'s verdict, the model that answered (once, however many requests), the counts')
  assert.deepEqual(r.nodes.map((n) => [n.kind, n.label]), [['bash', 'List the data folder'], ['skill', 'report-writer'], ['read', 'read']])
  assert.deepEqual(r.nodes.map((n) => n.thinkMs), [11_490, 4_190, 4_190])
  assert.deepEqual(r.nodes.map((n) => n.runMs), [5_700, 100, 400])
  assert.deepEqual(r.nodes.map((n) => n.ok), [true, true, false])
  assert.ok(r.nodes[0].outBytes > 0 && r.nodes[1].outBytes > 0)
  assert.deepEqual(r.final, { thinkMs: 6_490 })
  ok('each tool call: its label (description, then name, then query, url, command, then the tool\'s own name), how long the model thought, how long the tool ran, how much it returned, whether it failed')
  assert.equal(Object.prototype.hasOwnProperty.call(r.nodes[0], 'in'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(r.nodes[0], 'out'), false)
  ok('list mode carries no input and no output')
}
{
  const r = summarizeRun(okRun, { detail: true })
  assert.equal(r.nodes[0].in, 'ls ~/data')
  assert.equal(r.nodes[0].out, 'one two three')
  assert.equal(r.nodes[1].in, 'report-writer')
  assert.equal(r.nodes[2].out, 'the notes')
  ok('detail mode adds the input (the command, else the query, else the name) and the output of each step')
}
{
  const failed = okRun.slice(0, -1).concat([ev('turn/end', 28_410, { turn: 1, reason: { kind: 'error', error: { code: 'MISSING_CREDENTIAL', message: 'no credential for provider route "acme"' } } })])
  const r = summarizeRun(failed)
  assert.deepEqual([r.outcome.state, r.outcome.code], ['failed', 'MISSING_CREDENTIAL'])
  assert.match(r.outcome.message, /no credential/)
  const open = summarizeRun(okRun.slice(0, 8))
  assert.deepEqual([open.outcome.state, open.endedAt, open.durationMs], ['open', null, null])
  assert.equal(open.nodes.length, 1)
  assert.equal(summarizeRun([ev('session', 0, {}), ev('user/message', 1, {})]), null)
  assert.equal(summarizeRun(null), null)
  assert.equal(summarizeRun([null, 3, 'x', undefined, { type: 'turn/start' }]).outcome.state, 'open')
  ok('a failed turn keeps the engine\'s code and message; an open turn has no end and no duration; no turn is null; hostile input does not throw')
}
{
  const later = okRun.concat([ev('user/message', 30_000, {}), ev('turn/start', 30_100, { turn: 2 }), call(31_000, 1, 'z1', 'bash', { command: 'echo later' }), ev('turn/end', 40_000, { turn: 2, reason: { kind: 'completed' } })])
  const r = summarizeRun(later)
  assert.deepEqual([r.turns, r.toolCalls, r.durationMs], [2, 3, 28_310])
  ok('a person who keeps talking in the chat afterwards does not change the run: only the first turn is summarised, the others are counted')
}
{
  const chosen = [ev('model/selection', 5, { provider: 'acme', model: 'beta-2' })].concat(okRun)
  assert.equal(summarizeRun(chosen).selected, true)
  ok('a model chosen on purpose for the session is told apart from the profile\'s default')
}
{
  const asked = okRun.slice(0, 5).concat([
    call(11_600, 1, 'c1', 'bash', { command: 'rm -rf x' }),
    ev('approval/asked', 11_650, { id: 'a1', toolName: 'bash', callId: 'c1', reason: 'delete' }),
    ev('approval/decided', 15_000, { id: 'a1', outcome: 'allowed-once' }),
    ev('approval/asked', 15_100, { id: 'a2', toolName: 'mail', callId: 'c9', reason: 'send' }),
    result(17_300, 1, 'c1', 'done'),
    ev('step/end', 17_300, { turn: 1, step: 1 }),
    ev('turn/end', 17_400, { turn: 1, reason: { kind: 'completed' } }),
  ])
  const r = summarizeRun(asked)
  assert.deepEqual(r.approvals, [{ toolName: 'bash', outcome: 'allowed-once' }, { toolName: 'mail', outcome: 'asked' }])
  assert.equal(r.nodes[0].approval, 'allowed-once')
  ok('what asked for an approval is listed with the engine\'s decision (\'asked\' while undecided) and marked on its step')
}
{
  const many = [ev('turn/start', 0, { turn: 1 })]
  for (let i = 0; i < 60; i += 1) { many.push(ev('step/start', i * 10 + 1, { step: i + 1 }), call(i * 10 + 2, i + 1, 'k' + i, 'bash', { description: 'x'.repeat(300) + i }), result(i * 10 + 5, i + 1, 'k' + i, 'y'.repeat(5000)), ev('step/end', i * 10 + 6, { step: i + 1 })) }
  many.push(ev('turn/end', 700, { turn: 1, reason: { kind: 'completed' } }))
  const list = summarizeRun(many)
  const det = summarizeRun(many, { detail: true })
  assert.deepEqual([list.nodes.length, det.nodes.length, list.nodeCount, det.nodeCount], [RUN_NODES_LIST, RUN_NODES_DETAIL, 60, 60])
  assert.ok(list.nodes.every((n) => n.label.length <= RUN_LABEL_MAX))
  assert.ok(det.nodes.every((n) => n.out.length <= RUN_TEXT_MAX && n.outBytes > 5000))
  ok('what is handed to the page is bounded (steps, labels, outputs) while the real count and size are kept')
}
{
  assert.equal(scrub('key sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 mail name@example.com'), 'key ••• mail •••@•••')
  assert.equal(scrub('a\u0000b\n\tc'), 'a b c')
  assert.equal(scrub(undefined), '')
  assert.equal(scrub('x'.repeat(2000)).length <= RUN_TEXT_MAX, true)
  const hostile = summarizeRun([ev('turn/start', 0, {}), call(1, 1, 'h', 'bash\u0000', { command: 'token ' + 'A'.repeat(40) }), result(2, 1, 'h', { weird: [1, 2] }), ev('turn/end', 3, { reason: { kind: 'completed' } })], { detail: true })
  assert.equal(hostile.nodes[0].kind, 'bash')
  assert.match(hostile.nodes[0].in, /token •••/)
  ok('text that comes from the machine is made safe: control characters out, long secret-looking strings and email addresses masked')
}

// ── the route, through the real apply() ───────────────────────────────────────────────────────────────────────────────────────────
const here = dirname(fileURLToPath(import.meta.url))
const scratch = mkdtempSync(join(tmpdir(), 'kb-runs-'))
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
  const journals = { 'session-ok': okRun, 'session-open': okRun.slice(0, 8), 'session-empty': [ev('session', 0, {})] }
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
    const handler = registered['/kybernos/tasks/runs']
    assert.ok(handler !== undefined, 'the route is registered')
    const res = { code: 0, raw: null, writeHead (c) { this.code = c }, end (p) { this.raw = p === undefined ? null : String(p) } }
    await handler({ method, url: '/kybernos/tasks/runs' + query, headers: { origin, host: '127.0.0.1:' + PORT }, socket: { localPort: PORT }, async *[Symbol.asyncIterator] () {} }, res)
    let json = null
    try { json = JSON.parse(res.raw) } catch (e) { json = null }
    return { code: res.code, json }
  }

  const r = await get('?ids=session-ok,session-open,session-empty,session-gone')
  assert.equal(r.code, 200)
  assert.equal(r.json.runs['session-ok'].outcome.state, 'completed')
  assert.equal(r.json.runs['session-ok'].nodes.length, 3)
  assert.equal(r.json.runs['session-open'].outcome.state, 'open')
  ok('the route gives the summary of each run, finished or still open')
  assert.equal(Object.prototype.hasOwnProperty.call(r.json.runs, 'session-empty'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(r.json.runs, 'session-gone'), false)
  ok('a session with no turn, or one that cannot be read, is absent: nothing is claimed')
  assert.equal(Object.prototype.hasOwnProperty.call(r.json.runs['session-ok'].nodes[0], 'in'), false)
  const d = await get('?ids=session-ok&detail=1')
  assert.equal(d.json.runs['session-ok'].nodes[0].out, 'one two three')
  const two = await get('?ids=session-ok,session-open&detail=1')
  assert.equal(Object.prototype.hasOwnProperty.call(two.json.runs['session-ok'].nodes[0], 'out'), false)
  ok('input and output come only with detail=1 and exactly one session')

  opened.length = 0
  const many = await get('?ids=' + Array.from({ length: 40 }, (_, i) => 'session-' + i).join(',') + ',../../etc/passwd,' + 'a'.repeat(200))
  assert.equal(many.code, 200)
  assert.equal(opened.length, 20, 'at most 20 journals are read per call')
  assert.equal(opened.some((id) => id.includes('/')), false, 'an id that is not a plain session id is never opened')
  ok('at most 20 sessions per call, and only plain session ids are opened')

  assert.equal((await get('?ids=session-ok', 'POST')).code, 405)
  assert.equal((await get('?ids=session-ok', 'GET', 'http://evil.example')).code, 403)
  const none = await get('')
  assert.deepEqual([none.code, none.json.ok, Object.keys(none.json.runs).length], [200, true, 0])
  ok('only GET from this machine\'s origin is served; no ids is an empty answer')
} finally {
  for (const d of disposers) { try { d() } catch (e) { /* best effort */ } }
  for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  rmSync(scratch, { recursive: true, force: true })
}
console.log('\n' + pass + ' verifications OK')
// The plugin may leave timers running (bridge tick, trim): the test is over.
process.exit(0)
