// An automation that asks first, on a cloud computer, end to end on the REAL plugins: packages/kybernos-plugin (the task list, the door that applies what the laptop published, the
// fire) and packages/kybernos-cloud (the gate that asks the platform, the answer poller) boot in one process with a fake context in a temporary DSH_HOME, next to a stand-in platform
// (an HTTP server answering the computer's three calls). The tool hook the cloud plugin registers is driven with fake tool calls.
//
// What is proved: the door refuses such an automation until the gate is there; a run is not given DSH's own question card; a call that changes something is asked and refused with « stop
// and wait » (no waiting inside the run), the run is marked as waiting, nothing else is asked meanwhile (a sub-agent included); the answer continues the SAME session once, at most; an
// « allow once » passes that very action once; « the rest of the run » passes the rest; a refusal is not asked again; the limit of questions holds; a platform that fails is a refusal;
// the reporter does not report a waiting run as ended. Nothing outside the temporary folder is read or written.
// Usage: node scripts/test-computer-approvals.mjs   (exit 0 = everything passes)
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'

const root = fileURLToPath(new URL('..', import.meta.url))
const dshHome = mkdtempSync(join(tmpdir(), 'kb-computer-approvals-'))
process.env.HOME = dshHome
process.env.DSH_HOME = dshHome
mkdirSync(join(dshHome, 'kybernos'), { recursive: true })
const b64u = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const secret = randomBytes(32)
writeFileSync(join(dshHome, '.credentials.yaml'), 'credentials:\n  - name: client-connection/browser-session\n    secret: ' + b64u(secret) + '\n')
const cookie = (() => {
  const authority = '127.0.0.1:3080'
  const body = b64u(Buffer.from(JSON.stringify({ version: 1, authority, issuedAt: Date.now(), expiresAt: Date.now() + 86400000 })))
  return 'dsh-auth-' + b64u(createHash('sha256').update(authority).digest()) + '=v1.' + body + '.' + b64u(createHmac('sha256', secret).update(body).digest())
})()
const tasksFile = join(dshHome, 'kybernos', 'tasks.json')
const approvalsFile = join(dshHome, 'kybernos', 'approvals.json')
const tokenFile = join(dshHome, 'kybernos', 'apply-token')
const applyToken = randomBytes(32).toString('hex')
writeFileSync(tokenFile, applyToken, { mode: 0o600 })

const realSetTimeout = globalThis.setTimeout
globalThis.setTimeout = (fn, ms, ...a) => {
  if (ms === 5000 || ms === 30000) return { unref() {}, ref() {} } // the scheduler's ticks are not driven here
  if (ms === 750) return realSetTimeout(fn, 1, ...a)
  return realSetTimeout(fn, ms, ...a)
}
let fails = 0
const eq = (label, got, want) => { const ok = got === want; if (!ok) { fails++; console.log('FAIL', label, '| got', got, '| want', want) } else console.log('ok  ', label) }
const sleep = (ms) => new Promise((r) => realSetTimeout(r, ms))
const until = async (fn, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(15) } return false }

// ── the stand-in platform: what the computer calls ─────────────────────────────────────────────────────────────────────────────
const platform = { asked: [], acks: [], decided: [], fail: false, auth: [] }
const server = createServer((req, res) => {
  let text = ''
  req.on('data', (d) => { text += d })
  req.on('end', () => {
    platform.auth.push(req.headers.authorization)
    const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
    const url = new URL(req.url, 'http://x')
    if (req.method === 'POST' && url.pathname === '/v1/computer/approvals') {
      if (platform.fail) return send(500, { error: 'boom' })
      const body = JSON.parse(text)
      const id = randomUUID()
      platform.asked.push({ id, ...body })
      return send(200, { id, state: 'pending', expires_at: new Date(Date.now() + 86400000).toISOString() })
    }
    if (req.method === 'GET' && url.pathname === '/v1/computer/approvals/decided') return send(200, { approvals: platform.decided.slice() })
    const ack = /^\/v1\/computer\/approvals\/([0-9a-f-]{36})\/ack$/u.exec(url.pathname)
    if (req.method === 'POST' && ack !== null) { platform.acks.push(ack[1]); platform.decided = platform.decided.filter((d) => d.id !== ack[1]); return send(200, { ok: true }) }
    send(404, { error: 'not_found' })
  })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))

// ── the two plugins in one process ────────────────────────────────────────────────────────────────────────────────────────────
process.env.KYBERNOS_AUTOMATION_LOAD_GUARD = 'off'
process.env.KYBERNOS_APPROVAL_POLL_MS = '40'
const core = await import(root + 'packages/kybernos-plugin/index.js')
const cloud = await import(root + 'packages/kybernos-cloud/index.js')
const routes = {}
const sessionsMade = []
const prompts = []
const parents = {}
const services = {
  fs: {},
  webServer: { register: (r) => { routes[r.path] = r.handler; return () => {} } },
  workspaceRegistry: { list: () => [{ id: 'ws1' }] },
  sessions: { get: (id) => (parents[id] === undefined ? undefined : { header: { parentSession: parents[id] } }) },
  sessionController: {
    async create() { const id = 'sess-' + String(sessionsMade.length + 1); sessionsMade.push(id); return { ok: true, value: { sessionId: id } } },
    async prompt(req) { prompts.push({ sessionId: req.sessionId, text: req.content[0].text }); return { ok: true } },
    async selectModel() { return { ok: true } },
  },
}
const hooks = []
const statusHooks = []
const ctxOf = () => ({ get: (n) => services[n], inject: () => {}, effect: (fn) => { try { return fn() } catch (e) { return undefined } }, on: (name, fn) => { if (name === 'tools/pre-execute') hooks.push(fn); if (name === 'agent/status') statusHooks.push(fn); return () => {} }, scope: {} })
const realErr = console.error; const realLog = console.log
console.error = () => {}; console.log = () => {}
core.apply(ctxOf())
await sleep(50)

const call = async (path, method, bodyText, headers) => {
  const req = Readable.from(bodyText === undefined ? [] : [Buffer.from(bodyText)])
  req.method = method; req.url = path
  req.headers = Object.assign({ origin: 'http://127.0.0.1:3080' }, headers || {})
  req.socket = { localPort: Number(new URL(req.headers.origin).port) }
  const res = { body: null }
  const done = new Promise((resolve) => { res.end = (b) => { res.body = b; resolve() }; res.writeHead = () => {} })
  await Promise.race([Promise.resolve(routes[path](req, res)).catch(() => {}), done, sleep(3000)])
  try { return JSON.parse(res.body) } catch (e) { return null }
}
const apply = (obj) => call('/kybernos/tasks/apply', 'POST', JSON.stringify(obj), { origin: 'http://127.0.0.1:3081', 'x-kybernos-apply-token': applyToken })
const tasksApi = (obj) => call('/kybernos/tasks', 'POST', JSON.stringify(obj), { cookie })
const def = (o) => ({ name: 'Veille tarifaire', prompt: 'Watch the prices', schedule: { mode: 'cron', cron: '0 3 * * *', tz: 'Europe/Paris' }, active: true, approvals: 'ask', ...(o || {}) })
const onDisk = () => JSON.parse(readFileSync(tasksFile, 'utf8'))
const records = () => { try { return JSON.parse(readFileSync(approvalsFile, 'utf8')).items } catch (e) { return [] } }
const PASS = 'PASS'
const gate = async (exec) => {
  let out = null
  for (const h of hooks) { out = await h(exec, async () => PASS); if (out !== PASS) return out }
  return out
}
const tool = (name, args, agentId) => ({ name, arguments: args, agent: { id: agentId } })

// ── 1. before the gate: such an automation is refused ───────────────────────────────────────────────────────────────────────────
eq('without the cloud plugin\'s gate, an automation that asks first is refused by the door', (await apply({ op: 'put', ref: 'task-ask', task: def() })).code, 'approval_path_missing')
eq('...and an automation set to auto is not', (await apply({ op: 'put', ref: 'task-auto', task: def({ approvals: 'auto', name: 'Auto' }) })).ok, true)

// ── 2. the computer: the cloud plugin mounts its gate ──────────────────────────────────────────────────────────────────────────
process.env.KYBERNOS_API = 'http://127.0.0.1:' + String(server.address().port)
process.env.KYBERNOS_COMPUTER_ID = randomUUID()
process.env.KYBERNOS_COMPUTER_TOKEN = 'computer-token'
cloud.apply(ctxOf())
await sleep(50)
console.error = realErr; console.log = realLog
eq('the cloud plugin registered a tool hook', hooks.length >= 1, true)
const put = await apply({ op: 'put', ref: 'task-ask', task: def() })
eq('with the gate there, the door accepts an automation that asks first', put.ok, true)
const stored = onDisk().find((t) => t.published && t.published.ref === 'task-ask')
eq('...it is an ordinary task that asks, published under the laptop\'s id', JSON.stringify([stored.approvals, stored.published.ref]), JSON.stringify(['ask', 'task-ask']))

// ── 3. the fire: no card of DSH's own, the run is known to the gate ───────────────────────────────────────────────────────────
const fired = await tasksApi({ action: 'run-now', id: stored.id })
eq('the run starts', fired !== null && fired.ok === true, true)
await sleep(80)
eq('it has a session of its own', sessionsMade.length >= 1, true)
const S1 = sessionsMade[0]
eq('its prompt was sent', prompts.some((p) => p.sessionId === S1 && p.text.indexOf('Watch the prices') >= 0), true)

// ── 4. the gate ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
eq('a tool that only reads passes without a question', await gate(tool('read', { file_path: '/x' }, S1)), PASS)
eq('a session of a person (not an automation run) is not gated', await gate(tool('bash', { command: 'ls' }, 'chat-9')), PASS)
eq('DSH\'s own question card is turned away: nobody can answer it', (await gate(tool('ask_user_question', {}, S1))).kind, 'deny')
const first = await gate(tool('bash', { command: 'curl -s https://example.com/prices | head' }, S1))
eq('a command is refused at once: the run does not wait inside', first.kind, 'deny')
eq('...with words that make it stop and wait', /must allow this first/.test(first.reason) && /stop/.test(first.reason), true)
eq('the platform was asked once, as this run\'s question', platform.asked.length, 1)
eq('...with the automation, the run, the kind and the action', JSON.stringify([platform.asked[0].task_ref, platform.asked[0].run_key, platform.asked[0].kind, platform.asked[0].summary]), JSON.stringify(['task-ask', S1, 'shell', 'curl -s https://example.com/prices | head']))
eq('...with the computer\'s own token', platform.auth.includes('Bearer computer-token'), true)
eq('the run is marked as waiting in the task list', onDisk().find((t) => t.id === stored.id).history.find((h) => h.sessionId === S1).status, 'waiting_approval')
eq('the question is on the volume, readable by its owner only', (statSync(approvalsFile).mode & 0o777).toString(8), '600')
eq('...as pending', JSON.stringify(records().map((r) => [r.sessionId, r.state, r.kind])), JSON.stringify([[S1, 'pending', 'shell']]))
const other = await gate(tool('write', { file_path: '/tmp/out.txt' }, S1))
eq('another change in the same run is refused without a second question', JSON.stringify([other.kind, platform.asked.length]), JSON.stringify(['deny', 1]))
parents['sub-1'] = S1
eq('a sub-agent of the run is held by the same question', JSON.stringify([(await gate(tool('bash', { command: 'rm -rf x' }, 'sub-1'))).kind, platform.asked.length]), JSON.stringify(['deny', 1]))

// The engine says the first turn ran, then ended (the model stopped when it was refused): the run is no longer counted as going.
for (const st of ['running', 'idle']) for (const h of statusHooks) h({ agent: { id: S1 }, status: st })
const idleLoad = await call('/kybernos/automation-load', 'GET', undefined, { origin: 'http://127.0.0.1:3081' })
eq('once its first turn ended, the waiting run is not counted as going (the computer may rest)', idleLoad !== null && idleLoad.inFlight === 0 && !(idleLoad.runs || []).some((r) => r.taskId === stored.id), true)

// ── 5. the reporter does not call a waiting run over ──────────────────────────────────────────────────────────────────────────
const reporter = await import(root + 'services/computer-image/reporter.mjs')
const tasksNow = onDisk()
eq('the reporter does not report the waiting run as ended', reporter.endedRuns(tasksNow, new Set()).some((r) => r.run_id === S1), false)
eq('...and the schedule row says it waits', reporter.scheduleOf(tasksNow).find((r) => r.id === 'task-ask').last_status, 'waiting_approval')

// ── 6. the answer: allow once ──────────────────────────────────────────────────────────────────────────────────────────────────
const q1 = platform.asked[0]
platform.decided.push({ id: q1.id, state: 'allowed', task_ref: 'task-ask', run_key: S1, kind: 'shell' })
eq('the answer is taken off the platform\'s list', await until(() => platform.acks.includes(q1.id)), true)
eq('the SAME session is continued, once, with what was allowed', JSON.stringify(prompts.filter((p) => p.sessionId === S1 && /The person allowed this action/.test(p.text)).length), '1')
eq('...naming the action', prompts.some((p) => p.sessionId === S1 && p.text.indexOf('curl -s https://example.com/prices | head') >= 0), true)
const afterAnswer = onDisk().find((t) => t.id === stored.id).history.find((h) => h.sessionId === S1)
eq('the run is no longer marked as waiting', afterAnswer.status, 'fired')
eq('...and dated: the moment it was told to go on (the reporter does not call it ended before its session was written to after that)', typeof afterAnswer.continuedAt === 'string' && Date.now() - Date.parse(afterAnswer.continuedAt) < 60000, true)
const load = await call('/kybernos/automation-load', 'GET', undefined, { origin: 'http://127.0.0.1:3081' })
eq('the run that goes on counts as a run going in the load the reporter sends (so the beat says busy and the computer is not put to sleep under it)', load !== null && load.inFlight >= 1 && Array.isArray(load.runs) && load.runs.some((r) => r.taskId === stored.id), true)
eq('the question is answered on the volume', JSON.stringify(records().map((r) => [r.state, r.continued === true])), JSON.stringify([['allowed', true]]))
eq('that very action now passes', await gate(tool('bash', { command: 'curl -s   https://example.com/prices | head' }, S1)), PASS)
eq('...once: the record is used', records()[0].used, true)
const again = await gate(tool('bash', { command: 'curl -s https://example.com/prices | head' }, S1))
eq('...the same action again is asked again', JSON.stringify([again.kind, platform.asked.length]), JSON.stringify(['deny', 2]))
eq('...and the run waits again: the date of the last time it went on is gone', onDisk().find((t) => t.id === stored.id).history.find((h) => h.sessionId === S1).continuedAt, undefined)

// ── 7. the answer comes twice (the first ack was lost): the run is continued once ────────────────────────────────────────────
const q2 = platform.asked[1]
const before = prompts.length
platform.decided.push({ id: q2.id, state: 'denied', task_ref: 'task-ask', run_key: S1, kind: 'shell' })
platform.decided.push({ id: q2.id, state: 'denied', task_ref: 'task-ask', run_key: S1, kind: 'shell' })
eq('a refusal is taken off the list', await until(() => platform.acks.includes(q2.id)), true)
eq('...and the run is continued once, told it was refused', prompts.slice(before).filter((p) => p.sessionId === S1 && /refused this action/.test(p.text)).length, 1)
const refused = await gate(tool('bash', { command: 'curl -s https://example.com/prices | head' }, S1))
eq('the action that was refused is not asked again', JSON.stringify([refused.kind, /did not allow/.test(refused.reason), platform.asked.length]), JSON.stringify(['deny', true, 2]))
const third = await gate(tool('edit', { file_path: '/tmp/a' }, S1))
eq('another action is asked', JSON.stringify([third.kind, platform.asked.length]), JSON.stringify(['deny', 3]))
// answered, so that the limit can be reached
const q3 = platform.asked[2]
platform.decided.push({ id: q3.id, state: 'denied', task_ref: 'task-ask', run_key: S1, kind: 'edit' })
await until(() => platform.acks.includes(q3.id))
const many = await gate(tool('bash', { command: 'echo a fourth thing' }, S1))
eq('after three questions the run is told to finish with what it has', JSON.stringify([many.kind, /already asked the person 3 times/.test(many.reason), platform.asked.length]), JSON.stringify(['deny', true, 3]))

// ── 8. the rest of the run ──────────────────────────────────────────────────────────────────────────────────────────────────────
const fired2 = await tasksApi({ action: 'run-now', id: stored.id })
await sleep(80)
const S2 = sessionsMade[sessionsMade.length - 1]
eq('a second run has a session of its own', S2 !== S1 && fired2.ok === true, true)
await gate(tool('bash', { command: 'make build' }, S2))
const q4 = platform.asked[platform.asked.length - 1]
platform.decided.push({ id: q4.id, state: 'allowed_turn', task_ref: 'task-ask', run_key: S2, kind: 'shell' })
await until(() => platform.acks.includes(q4.id))
eq('« allow for this run » says so to the session', prompts.some((p) => p.sessionId === S2 && /for the rest of this task/.test(p.text)), true)
const asked = platform.asked.length
eq('...and everything else of that run passes', JSON.stringify([await gate(tool('bash', { command: 'something else' }, S2)), await gate(tool('write', { file_path: '/y' }, S2)), platform.asked.length]), JSON.stringify([PASS, PASS, asked]))
eq('...but not a run of the same automation started later', (await gate(tool('bash', { command: 'something else' }, S1))).kind, 'deny')

// ── 9. no answer, an answer for nothing here, a platform that fails ────────────────────────────────────────────────────────────
await tasksApi({ action: 'run-now', id: stored.id })
await sleep(80)
const S3 = sessionsMade[sessionsMade.length - 1]
await gate(tool('bash', { command: 'long wait' }, S3))
const q5 = platform.asked[platform.asked.length - 1]
const mark = prompts.length
platform.decided.push({ id: q5.id, state: 'expired', task_ref: 'task-ask', run_key: S3, kind: 'shell' })
const strange = randomUUID()
platform.decided.push({ id: strange, state: 'allowed', task_ref: 'task-ask', run_key: 'sess-gone', kind: 'shell' })
await until(() => platform.acks.includes(q5.id) && platform.acks.includes(strange))
eq('a question that ran out is told to the run as a refusal', prompts.slice(mark).some((p) => p.sessionId === S3 && /did not answer in time/.test(p.text)), true)
eq('an answer that matches nothing here is taken off the list and continues nothing', prompts.slice(mark).filter((p) => p.sessionId === 'sess-gone').length, 0)
await tasksApi({ action: 'run-now', id: stored.id })
await sleep(80)
const S4 = sessionsMade[sessionsMade.length - 1]
platform.fail = true
const asksBefore = platform.asked.length
const failed = await gate(tool('bash', { command: 'while the platform is down' }, S4))
eq('a platform that cannot be reached is a refusal, never a pass', JSON.stringify([failed.kind, /could not be asked/.test(failed.reason), platform.asked.length - asksBefore]), JSON.stringify(['deny', true, 0]))
eq('...and nothing was written, nothing marked as waiting', JSON.stringify([records().some((r) => r.sessionId === S4), (onDisk().find((t) => t.id === stored.id).history.find((h) => h.sessionId === S4) || {}).status]), JSON.stringify([false, 'fired']))
platform.fail = false

// ── 10. the gate is not there: such a run does not start ───────────────────────────────────────────────────────────────────────
const seam = globalThis[Symbol.for('kybernos.computerGate')]
globalThis[Symbol.for('kybernos.computerGate')] = undefined
const nSessions = sessionsMade.length
await tasksApi({ action: 'run-now', id: stored.id })
await sleep(80)
const last = onDisk().find((t) => t.id === stored.id).history.slice(-1)[0]
eq('with no gate to ask, the run is not started, and the failure is recorded', JSON.stringify([last.status, typeof last.error === 'string' && /gate/.test(last.error)]), JSON.stringify(['error', true]))
globalThis[Symbol.for('kybernos.computerGate')] = seam

server.close()
console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILURES')
process.exit(fails === 0 ? 0 : 1)
