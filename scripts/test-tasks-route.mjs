// Test of the /kybernos/tasks route and the scheduler tick, end to end on the REAL
// packages/kybernos-plugin/index.js: it boots the plugin with a fake context in a temporary
// DSH_HOME, drives the registered route with fake requests, and runs the real tick with a
// stubbed session service. No real session is ever started and nothing outside the temporary
// folder is read or written.
// Usage: node scripts/test-tasks-route.mjs   (exit 0 = everything passes)
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'

const root = fileURLToPath(new URL('..', import.meta.url))
const dshHome = mkdtempSync(join(tmpdir(), 'kb-tasks-route-'))
process.env.HOME = dshHome
process.env.DSH_HOME = dshHome
mkdirSync(join(dshHome, 'kybernos'), { recursive: true })
const file = join(dshHome, 'kybernos', 'tasks.json')

// The tick is driven by hand: capture the 5 s and 30 s timers, and shrink the fixed 750 ms wait.
const realSetTimeout = globalThis.setTimeout
const captured = []
globalThis.setTimeout = (fn, ms, ...a) => {
  if (ms === 5000 || ms === 30000) { captured.push({ fn, ms }); return { unref() {}, ref() {} } }
  if (ms === 750) return realSetTimeout(fn, 1, ...a)
  return realSetTimeout(fn, ms, ...a)
}

let fails = 0
const eq = (label, got, want) => { const ok = got === want; if (!ok) { fails++; console.log('FAIL', label, '| got', got, '| want', want) } else console.log('ok  ', label) }

const mod = await import(root + 'packages/kybernos-plugin/index.js')
const routes = {}
const sessions = { created: 0, prompts: [], failCreate: false }
const services = {
  fs: {},
  webServer: { register: (r) => { routes[r.path] = r.handler; return () => {} } },
  workspaceRegistry: { list: () => [{ id: 'ws1' }] },
  sessionController: {
    async create() { sessions.created += 1; if (sessions.failCreate === true) throw new Error('session service refused'); return { ok: true, value: { sessionId: 'sess-' + sessions.created } } },
    async prompt(a) { sessions.prompts.push(a); return { ok: true } },
    async selectModel() { return { ok: true } },
  },
}
const quiet = []
const realErr = console.error; const realLog = console.log
console.error = (...a) => quiet.push(a.join(' ')); console.log = (...a) => quiet.push(a.join(' '))
mod.apply({ get: (n) => services[n], inject: () => {}, effect: (fn) => { try { return fn() } catch (e) { return undefined } }, on: () => {}, scope: {} })
await new Promise((r) => realSetTimeout(r, 50))
console.error = realErr; console.log = realLog

const call = async (method, bodyText, headers) => {
  const req = Readable.from(bodyText === undefined ? [] : [Buffer.from(bodyText)])
  req.method = method; req.url = '/kybernos/tasks'
  req.headers = Object.assign({ origin: 'http://127.0.0.1:3080' }, headers || {})
  req.socket = { localPort: 3080 }
  const res = { status: null, body: null }
  const done = new Promise((resolve) => { res.end = (b) => { res.body = b; resolve() }; res.writeHead = (s) => { res.status = s } })
  await Promise.race([Promise.resolve(routes['/kybernos/tasks'](req, res)).catch(() => {}), done, new Promise((r) => realSetTimeout(r, 3000))])
  let json = null
  try { json = JSON.parse(res.body) } catch (e) { /* not JSON */ }
  return { status: res.status, json }
}
const api = (obj) => call('POST', JSON.stringify(obj))
const tick = async () => { const t = captured.filter((x) => x.ms === 30000).pop(); const before = captured.length; t.fn(); const t0 = Date.now(); while (captured.length === before && Date.now() - t0 < 5000) await new Promise((r) => realSetTimeout(r, 5)) }
const onDisk = () => JSON.parse(readFileSync(file, 'utf8'))
const task = (o) => ({ name: 'Weekly report', prompt: 'Write the report', schedule: { mode: 'cron', cron: '0 8 * * 1-5', tz: 'Europe/Paris' }, active: true, ...(o || {}) })

/* ── The route ───────────────────────────────────────────────────────────── */
eq('GET is refused', (await call('GET')).status, 405)
eq('no Origin is refused', (await call('POST', '{"action":"list"}', { origin: '' })).status, 403)
eq('foreign Origin is refused', (await call('POST', '{"action":"list"}', { origin: 'http://evil.example' })).status, 403)
eq('empty store lists as empty', JSON.stringify((await api({ action: 'list' })).json), '{"ok":true,"tasks":[]}')
const created = (await api({ action: 'create', task: task() })).json
eq('create works', created.ok, true)
eq('create sets the next run', typeof created.task.nextRun, 'string')
eq('the store file is private (0600)', (statSync(file).mode & 0o777).toString(8), '600')
eq('no temporary file is left behind', readdirSync(join(dshHome, 'kybernos')).filter((n) => n.includes('.tmp-')).length, 0)
eq('a one-time date in the past is refused when active', (await api({ action: 'create', task: task({ schedule: { mode: 'once', at: '2020-01-01T08:00', tz: 'UTC' } }) })).json.error, 'that date is in the past')
eq('...but allowed while paused', (await api({ action: 'create', task: task({ active: false, schedule: { mode: 'once', at: '2020-01-01T08:00', tz: 'UTC' } }) })).json.ok, true)
eq('a cron that never fires is refused', (await api({ action: 'create', task: task({ schedule: { mode: 'cron', cron: '0 0 31 2 *' } }) })).json.error, 'this schedule never fires')
eq('an unknown zone is refused', (await api({ action: 'create', task: task({ schedule: { mode: 'cron', cron: '0 8 * * *', tz: 'Mars/Phobos' } }) })).json.error, 'unknown time zone')
const pastId = (await api({ action: 'list' })).json.tasks.find((t) => t.schedule.mode === 'once').id
eq('switching a past one-time task on is refused', (await api({ action: 'toggle', id: pastId, active: true })).json.error, 'that date is in the past')
eq('toggle needs a real boolean', (await api({ action: 'toggle', id: created.task.id, active: 'false' })).json.error, 'active must be true or false')
eq('toggle off works', (await api({ action: 'toggle', id: created.task.id, active: false })).json.task.nextRun, null)
eq('toggle on works', typeof (await api({ action: 'toggle', id: created.task.id, active: true })).json.task.nextRun, 'string')
eq('an edit that cannot fire is refused and changes nothing', (await api({ action: 'update', id: created.task.id, task: task({ schedule: { mode: 'cron', cron: '0 0 30 2 *' } }) })).json.error, 'this schedule never fires')
eq('...the stored cron is unchanged', onDisk().find((t) => t.id === created.task.id).schedule.cron, '0 8 * * 1-5')
const big = await call('POST', JSON.stringify({ action: 'create', task: task({ prompt: 'x'.repeat(250000) }) }))
eq('an oversized body answers 413', big.status, 413)
eq('a null body answers 400', (await call('POST', 'null')).status, 400)
eq('an array body answers 400', (await call('POST', '[1]')).status, 400)
eq('an unknown action is a clean error', (await api({ action: 'nope' })).json.error, 'action inconnue: nope')
eq('a JSON object where a string is expected does not crash the route', (await api({ action: 'create', task: { name: { toString: 1 }, prompt: 'p' } })).json.error, 'name required')
eq('only the valid tasks were stored', onDisk().length, 2)

/* ── A store that cannot be trusted ───────────────────────────────────────── */
const good = readFileSync(file, 'utf8')
writeFileSync(file, good.slice(0, 40))
const truncated = readFileSync(file, 'utf8')
const lst = await api({ action: 'list' })
eq('corrupt file: list says so, as JSON the page can show', lst.status + ':' + lst.json.ok + ':' + lst.json.code, '200:false:tasks-corrupt')
const crt = await api({ action: 'create', task: task({ name: 'New' }) })
eq('corrupt file: create is refused', crt.json.code, 'tasks-corrupt')
eq('corrupt file: nothing was overwritten', readFileSync(file, 'utf8'), truncated)
eq('corrupt file: a private copy is kept', readdirSync(join(dshHome, 'kybernos')).filter((n) => n.startsWith('tasks.json.corrupt-')).length, 1)
eq('corrupt file: the message carries no path', String(crt.json.error).indexOf(dshHome) < 0, true)
await tick(); await tick()
eq('corrupt file: the scheduler leaves it alone', readFileSync(file, 'utf8'), truncated)
writeFileSync(file, good)

/* ── The tick, on the real code ───────────────────────────────────────────── */
{
  const all = onDisk()
  const t = all.find((x) => x.id === created.task.id)
  t.nextRun = new Date(Date.now() - 5000).toISOString()
  writeFileSync(file, JSON.stringify(all, null, 2))
  await tick()
  eq('a due task starts exactly one session', sessions.created, 1)
  eq('the prompt is the task prompt', JSON.stringify(sessions.prompts[0].content), JSON.stringify([{ type: 'text', text: 'Write the report' }]))
  const after = onDisk().find((x) => x.id === created.task.id)
  eq('the run is recorded', after.history[0].status + ':' + after.history[0].sessionId, 'fired:sess-1')
  eq('the next run moved to the future', Date.parse(after.nextRun) > Date.now(), true)
  await tick()
  eq('nothing runs twice', sessions.created, 1)
  const before = readFileSync(file, 'utf8')
  const mtime = statSync(file).mtimeMs
  await new Promise((r) => realSetTimeout(r, 20))
  await tick()
  eq('an idle tick does not rewrite the file', readFileSync(file, 'utf8') === before && statSync(file).mtimeMs === mtime, true)
  sessions.failCreate = true
  const again = onDisk(); again.find((x) => x.id === created.task.id).nextRun = new Date(Date.now() - 1000).toISOString()
  writeFileSync(file, JSON.stringify(again, null, 2))
  await tick()
  const failed = onDisk().find((x) => x.id === created.task.id)
  eq('a failed start is recorded, not retried every 30 s', failed.history[failed.history.length - 1].status + ':' + (Date.parse(failed.nextRun) > Date.now()), 'error:true')
}

rmSync(dshHome, { recursive: true, force: true })
console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILURES')
process.exit(fails === 0 ? 0 : 1)
