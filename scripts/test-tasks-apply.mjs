// Test of POST /kybernos/tasks/apply, the door through which a cloud computer's reporter applies what the person's laptop published, end to end on the REAL
// packages/kybernos-plugin/index.js: the plugin boots with a fake context in a temporary DSH_HOME, the registered route is driven with fake requests.
// Nothing outside the temporary folder is read or written. Usage: node scripts/test-tasks-apply.mjs   (exit 0 = everything passes)
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { randomBytes } from 'node:crypto'

const root = fileURLToPath(new URL('..', import.meta.url))
const dshHome = mkdtempSync(join(tmpdir(), 'kb-tasks-apply-'))
process.env.HOME = dshHome
process.env.DSH_HOME = dshHome
mkdirSync(join(dshHome, 'kybernos'), { recursive: true })
const file = join(dshHome, 'kybernos', 'tasks.json')
const tokenFile = join(dshHome, 'kybernos', 'apply-token')

const realSetTimeout = globalThis.setTimeout
globalThis.setTimeout = (fn, ms, ...a) => {
  if (ms === 5000 || ms === 30000) return { unref() {}, ref() {} } // the scheduler's ticks are not driven here
  if (ms === 750) return realSetTimeout(fn, 1, ...a)
  return realSetTimeout(fn, ms, ...a)
}
let fails = 0
const eq = (label, got, want) => { const ok = got === want; if (!ok) { fails++; console.log('FAIL', label, '| got', got, '| want', want) } else console.log('ok  ', label) }

process.env.KYBERNOS_AUTOMATION_LOAD_GUARD = 'off'
const mod = await import(root + 'packages/kybernos-plugin/index.js')
const routes = {}
const services = {
  fs: {},
  webServer: { register: (r) => { routes[r.path] = r.handler; return () => {} } },
  workspaceRegistry: { list: () => [{ id: 'ws1' }] },
  sessions: { get: () => undefined },
  sessionController: { async create() { return { ok: true, value: { sessionId: 'sess-1' } } }, async prompt() { return { ok: true } }, async selectModel() { return { ok: true } } },
}
const quiet = []
const realErr = console.error; const realLog = console.log
console.error = (...a) => quiet.push(a.join(' ')); console.log = (...a) => quiet.push(a.join(' '))
mod.apply({ get: (n) => services[n], inject: () => {}, effect: (fn) => { try { return fn() } catch (e) { return undefined } }, on: () => () => {}, scope: {} })
await new Promise((r) => realSetTimeout(r, 50))
console.error = realErr; console.log = realLog

const call = async (path, method, bodyText, headers) => {
  const req = Readable.from(bodyText === undefined ? [] : [Buffer.from(bodyText)])
  req.method = method; req.url = path
  req.headers = Object.assign({ origin: 'http://127.0.0.1:3081' }, headers || {})
  req.socket = { localPort: 3081 }
  const res = { status: null, body: null }
  const done = new Promise((resolve) => { res.end = (b) => { res.body = b; resolve() }; res.writeHead = (s) => { res.status = s } })
  await Promise.race([Promise.resolve(routes[path](req, res)).catch(() => {}), done, new Promise((r) => realSetTimeout(r, 3000))])
  let json = null
  try { json = JSON.parse(res.body) } catch (e) { /* not JSON */ }
  return { status: res.status, json }
}
const token = randomBytes(32).toString('hex')
const apply = (obj, headers) => call('/kybernos/tasks/apply', 'POST', JSON.stringify(obj), Object.assign({ 'x-kybernos-apply-token': token }, headers || {}))
const onDisk = () => JSON.parse(readFileSync(file, 'utf8'))
const def = (o) => ({ name: 'Collecteur nocturne', prompt: 'Collect the prices and write the summary', schedule: { mode: 'cron', cron: '0 3 * * *', tz: 'Europe/Paris' }, active: true, approvals: 'auto', ...(o || {}) })

/* ── The door ───────────────────────────────────────────────────────────── */
eq('the route is registered', typeof routes['/kybernos/tasks/apply'], 'function')
eq('GET is refused', (await call('/kybernos/tasks/apply', 'GET')).status, 405)
eq('no Origin is refused', (await apply({ op: 'delete', ref: 'x' }, { origin: '' })).status, 403)
eq('a foreign Origin is refused', (await apply({ op: 'delete', ref: 'x' }, { origin: 'http://evil.example' })).status, 403)
eq('with no token file (a laptop) everything is refused', (await apply({ op: 'put', ref: 'task-a', task: def() })).status, 401)
writeFileSync(tokenFile, token, { mode: 0o600 })
eq('no token header: 401', (await call('/kybernos/tasks/apply', 'POST', JSON.stringify({ op: 'put', ref: 'task-a', task: def() }))).status, 401)
eq('a wrong token: 401', (await apply({ op: 'put', ref: 'task-a', task: def() }, { 'x-kybernos-apply-token': randomBytes(32).toString('hex') })).status, 401)
eq('a token of another length: 401', (await apply({ op: 'put', ref: 'task-a', task: def() }, { 'x-kybernos-apply-token': 'abc' })).status, 401)
writeFileSync(tokenFile, 'not hex at all', { mode: 0o600 })
eq('a token file that is not hex is no token', (await apply({ op: 'put', ref: 'task-a', task: def() })).status, 401)
writeFileSync(tokenFile, token, { mode: 0o600 })
eq('nothing was stored by the refused calls', (() => { try { return onDisk().length } catch (e) { return 0 } })(), 0)
eq('no signed browser session is asked: the reporter has none', (await apply({ op: 'put', ref: 'task-a', task: def() })).status, 200)
// DSH keeps one secret per machine and signs its browser cookie with it: with that secret in place the ordinary route asks for the cookie, the apply door does not.
writeFileSync(join(dshHome, '.credentials.yaml'), 'credentials:\n  - name: client-connection/browser-session\n    secret: ' + randomBytes(32).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '\n')
eq('the ordinary route still wants the signed session (401 without)', (await call('/kybernos/tasks', 'POST', '{"action":"list"}', { cookie: '' })).status, 401)
eq('a body that is not an object answers 400', (await call('/kybernos/tasks/apply', 'POST', '[1]', { 'x-kybernos-apply-token': token })).status, 400)
eq('an oversized body answers 413', (await apply({ op: 'put', ref: 'task-a', task: def({ prompt: 'x'.repeat(60000) }) })).status, 413)

/* ── put: create, then update ────────────────────────────────────────────── */
let stored = onDisk()
eq('the first put created one task', stored.length, 1)
const first = stored[0]
eq('it keeps the laptop\'s id as `published.ref`', first.published.ref, 'task-a')
eq('it has an id of its own', /^st-/.test(first.id), true)
eq('it is scheduled', typeof first.nextRun, 'string')
eq('it runs here', first.runsOn, 'local')
eq('it runs by itself (auto)', first.approvals, 'auto')
const again = await apply({ op: 'put', ref: 'task-a', task: def({ name: 'Collecteur (v2)', schedule: { mode: 'cron', cron: '30 3 * * *', tz: 'Europe/Paris' } }) })
eq('the second put answers applied, not created', JSON.stringify([again.json.ok, again.json.state, again.json.created]), JSON.stringify([true, 'applied', false]))
stored = onDisk()
eq('still one task: a put for the same ref replaces', stored.length, 1)
eq('...its own id is kept', stored[0].id, first.id)
eq('...and its creation date', stored[0].createdAt, first.createdAt)
eq('...the new definition is in', stored[0].name + '|' + stored[0].schedule.cron, 'Collecteur (v2)|30 3 * * *')
eq('...`published.at` is the first one', stored[0].published.at, first.published.at)
eq('a put never makes it faster than the plugin allows: an every-minute cron is refused', (await apply({ op: 'put', ref: 'task-b', task: def({ schedule: { mode: 'cron', cron: '* * * * *', tz: 'UTC' } }) })).json.code, 'too_frequent')

/* ── what is read of a definition, and what is refused ───────────────────── */
const extra = await apply({ op: 'put', ref: 'task-c', task: def({ name: 'Extras', workspace: 'ws-evil', homeSessionId: 'sess-evil', sessionMode: 'home', notify: ['email'], trigger: { type: 'webhook', secret: 'S' }, history: [{ at: 'x' }], id: 'st-forged', runsOn: 'cloud', needs: ['gmail', 'Not A Slug', 'calendar'] }) })
eq('a definition with extra fields is applied', extra.json.ok, true)
const c = onDisk().find((t) => t.published.ref === 'task-c')
eq('...a workspace is not taken from the server', c.workspace, undefined)
eq('...nor a home session', JSON.stringify([c.homeSessionId, c.sessionMode]), JSON.stringify([undefined, undefined]))
eq('...nor who is told', c.notify, undefined)
eq('...nor a webhook', c.trigger, undefined)
eq('...nor an id or a history', JSON.stringify([c.id === 'st-forged', c.history]), JSON.stringify([false, []]))
eq('...the apps it asks for are the valid slugs only', JSON.stringify(c.needs), JSON.stringify(['gmail', 'calendar']))
eq('an automation that asks first cannot be published yet', (await apply({ op: 'put', ref: 'task-d', task: def({ approvals: 'ask' }) })).json.code, 'approval_path_missing')
eq('an approvals field that is missing is refused the same way', (await apply({ op: 'put', ref: 'task-d', task: def({ approvals: undefined }) })).json.code, 'approval_path_missing')
eq('an invalid cron is an invalid task', (await apply({ op: 'put', ref: 'task-d', task: def({ schedule: { mode: 'cron', cron: 'nope', tz: 'UTC' } }) })).json.code, 'invalid_task')
eq('a missing prompt is an invalid task', (await apply({ op: 'put', ref: 'task-d', task: def({ prompt: '' }) })).json.code, 'invalid_task')
eq('a one-time date in the past never runs', (await apply({ op: 'put', ref: 'task-d', task: def({ schedule: { mode: 'once', at: '2020-01-01T08:00', tz: 'UTC' } }) })).json.code, 'never_runs')
eq('no definition at all is an invalid task', (await apply({ op: 'put', ref: 'task-d' })).json.code, 'invalid_task')
eq('a definition that is an array is an invalid task', (await apply({ op: 'put', ref: 'task-d', task: [1] })).json.code, 'invalid_task')
eq('an unknown op', (await apply({ op: 'run', ref: 'task-d' })).json.code, 'invalid_op')
eq('a ref that is not an id', (await apply({ op: 'put', ref: 'bad ref', task: def() })).json.code, 'invalid_ref')
eq('a ref that is too long', (await apply({ op: 'delete', ref: 'x'.repeat(65) })).json.code, 'invalid_ref')
eq('none of the refused calls stored anything', onDisk().length, 2)

/* ── delete: only what was published, and twice is fine ──────────────────── */
const ownTasks = onDisk()
ownTasks.push({ id: 'st-own', name: 'Made on this computer', prompt: 'p', schedule: { mode: 'cron', cron: '0 9 * * *', tz: 'UTC' }, active: true, approvals: 'ask', runsOn: 'local', history: [], createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', nextRun: null })
writeFileSync(file, JSON.stringify(ownTasks), { mode: 0o600 })
chmodSync(file, 0o600)
eq('a removal answers applied', JSON.stringify((await apply({ op: 'delete', ref: 'task-a' })).json), JSON.stringify({ ok: true, state: 'applied', removed: 1 }))
eq('...and takes only that one away', onDisk().map((t) => t.id === 'st-own' ? 'own' : t.published.ref).join(','), 'task-c,own')
eq('the same removal again is still applied (nothing is there)', (await apply({ op: 'delete', ref: 'task-a' })).json.state, 'applied')
eq('a task made on this computer is never removed by a ref', (await apply({ op: 'delete', ref: 'st-own' })).json.removed, 0)
eq('...it is still there', onDisk().some((t) => t.id === 'st-own'), true)

/* ── what the reporter then says of it ───────────────────────────────────── */
process.env.KYBERNOS_API = 'https://api.example.test'; process.env.KYBERNOS_COMPUTER_TOKEN = 'kyd_test'
const rep = await import(root + 'services/computer-image/reporter.mjs')
const sched = rep.scheduleOf(onDisk())
eq('a published task is reported by the laptop\'s id', sched.map((t) => t.id).join(','), 'task-c,st-own')
eq('a task of this computer keeps its own id', rep.externalIdOf({ id: 'st-own' }), 'st-own')

console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILURES')
process.exit(fails === 0 ? 0 : 1)
