// Test of the `cloud-link` action of POST /kybernos/tasks: the link between an automation and the cloud computer it was published to. While it lives there the copy on
// this computer is paused and cannot be switched on, an edit keeps it paused, and bringing it back restores what it was. End to end on the REAL
// packages/kybernos-plugin/index.js with a fake context in a temporary DSH_HOME. Usage: node scripts/test-tasks-cloud-link.mjs   (exit 0 = everything passes)
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { createHash, createHmac, randomBytes } from 'node:crypto'

const root = fileURLToPath(new URL('..', import.meta.url))
const dshHome = mkdtempSync(join(tmpdir(), 'kb-tasks-link-'))
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
const realSetTimeout = globalThis.setTimeout
globalThis.setTimeout = (fn, ms, ...a) => {
  if (ms === 5000 || ms === 30000) return { unref() {}, ref() {} }
  if (ms === 750) return realSetTimeout(fn, 1, ...a)
  return realSetTimeout(fn, ms, ...a)
}
let fails = 0
const eq = (label, got, want) => { const ok = got === want; if (!ok) { fails++; console.log('FAIL', label, '| got', got, '| want', want) } else console.log('ok  ', label) }
process.env.KYBERNOS_AUTOMATION_LOAD_GUARD = 'off'
const mod = await import(root + 'packages/kybernos-plugin/index.js')
const routes = {}
const services = { fs: {}, webServer: { register: (r) => { routes[r.path] = r.handler; return () => {} } }, workspaceRegistry: { list: () => [{ id: 'ws1' }] }, sessions: { get: () => undefined }, sessionController: { async create() { return { ok: true, value: { sessionId: 'sess-1' } } }, async prompt() { return { ok: true } }, async selectModel() { return { ok: true } } } }
const realErr = console.error; const realLog = console.log
console.error = () => {}; console.log = () => {}
mod.apply({ get: (n) => services[n], inject: () => {}, effect: (fn) => { try { return fn() } catch (e) { return undefined } }, on: () => () => {}, scope: {} })
await new Promise((r) => realSetTimeout(r, 50))
console.error = realErr; console.log = realLog
const api = async (obj) => {
  const req = Readable.from([Buffer.from(JSON.stringify(obj))])
  req.method = 'POST'; req.url = '/kybernos/tasks'
  req.headers = { origin: 'http://127.0.0.1:3080', cookie }
  req.socket = { localPort: 3080 }
  const res = { body: null }
  const done = new Promise((resolve) => { res.end = (b) => { res.body = b; resolve() }; res.writeHead = () => {} })
  await Promise.race([Promise.resolve(routes['/kybernos/tasks'](req, res)).catch(() => {}), done, new Promise((r) => realSetTimeout(r, 3000))])
  return JSON.parse(res.body)
}
const HOME = '3f2a1c10-0000-4000-8000-000000000001'
const PROS = '3f2a1c10-0000-4000-8000-000000000002'
const task = (o) => ({ name: 'Collecteur', prompt: 'Collect the prices', schedule: { mode: 'cron', cron: '0 3 * * *', tz: 'Europe/Paris' }, active: true, approvals: 'auto', ...(o || {}) })
const list = async () => (await api({ action: 'list' })).tasks

/* ── linking: paused, and kept paused ────────────────────────────────────── */
const made = (await api({ action: 'create', task: task() })).task
eq('the task starts active, with a next run', JSON.stringify([made.active, typeof made.nextRun]), JSON.stringify([true, 'string']))
const linked = (await api({ action: 'cloud-link', id: made.id, cloud: { computerId: HOME, name: 'Home' } })).task
eq('linking pauses the copy on this computer', JSON.stringify([linked.active, linked.nextRun]), JSON.stringify([false, null]))
eq('...and remembers where it went and that it was on', JSON.stringify([linked.cloud.computerId, linked.cloud.name, linked.cloud.wasActive]), JSON.stringify([HOME, 'Home', true]))
eq('...the link and the task have the same moment, so nothing reads as edited yet', linked.cloud.at, linked.updatedAt)
eq('it cannot be switched on here while it lives in the cloud', (await api({ action: 'toggle', id: made.id, active: true })).error, 'runs in the cloud')
eq('...switching it off is harmless', (await api({ action: 'toggle', id: made.id, active: false })).ok, true)
await new Promise((r) => realSetTimeout(r, 15))
const edited = (await api({ action: 'update', id: made.id, task: task({ name: 'Collecteur (v2)', active: true }) })).task
eq('an edit here keeps the copy paused, whatever the form says', JSON.stringify([edited.active, edited.nextRun, edited.name]), JSON.stringify([false, null, 'Collecteur (v2)']))
eq('...keeps the link', edited.cloud.computerId, HOME)
eq('...and is dated after the link: the page can say "changed since the last publish"', edited.updatedAt > edited.cloud.at, true)
const moved = (await api({ action: 'cloud-link', id: made.id, cloud: { computerId: PROS, name: 'Prospection' } })).task
eq('moving to another computer keeps what it was before it left', JSON.stringify([moved.cloud.computerId, moved.cloud.name, moved.cloud.wasActive, moved.active]), JSON.stringify([PROS, 'Prospection', true, false]))
eq('...and a publish of the update (the same link again) dates the link again', moved.cloud.at >= edited.updatedAt, true)

/* ── bringing it back ────────────────────────────────────────────────────── */
const back = (await api({ action: 'cloud-link', id: made.id, cloud: null })).task
eq('bringing it back removes the link', back.cloud, undefined)
eq('...and the copy is on again, with a next run, as it was', JSON.stringify([back.active, typeof back.nextRun]), JSON.stringify([true, 'string']))
eq('...the edit made meanwhile is kept', back.name, 'Collecteur (v2)')
eq('bringing back what is not linked changes nothing', (await api({ action: 'cloud-link', id: made.id, cloud: null })).task.active, true)
eq('it can be switched on and off here again', (await api({ action: 'toggle', id: made.id, active: false })).ok, true)

const off = (await api({ action: 'create', task: task({ name: 'Paused one', active: false }) })).task
await api({ action: 'cloud-link', id: off.id, cloud: { computerId: HOME, name: 'Home' } })
const offBack = (await api({ action: 'cloud-link', id: off.id, cloud: null })).task
eq('an automation that was paused comes back paused', JSON.stringify([offBack.active, offBack.nextRun]), JSON.stringify([false, null]))

const once = (await api({ action: 'create', task: task({ name: 'One time', schedule: { mode: 'once', at: '2099-01-01T08:00', tz: 'UTC' } }) })).task
await api({ action: 'cloud-link', id: once.id, cloud: { computerId: HOME, name: 'Home' } })
// the date passes while it lives in the cloud
const tasksFile = join(dshHome, 'kybernos', 'tasks.json')
const { readFileSync } = await import('node:fs')
const stored = JSON.parse(readFileSync(tasksFile, 'utf8'))
stored.find((t) => t.id === once.id).schedule.at = '2020-01-01T08:00'
writeFileSync(tasksFile, JSON.stringify(stored), { mode: 0o600 })
const onceBack = (await api({ action: 'cloud-link', id: once.id, cloud: null })).task
eq('a one-time date that passed while it was away comes back paused, not as an error', JSON.stringify([onceBack.active, onceBack.nextRun, onceBack.cloud]), JSON.stringify([false, null, undefined]))

/* ── what is refused ─────────────────────────────────────────────────────── */
for (const [label, cloud] of [['a computer id that is not an id', { computerId: 'nope', name: 'Home' }], ['an empty name', { computerId: HOME, name: '  ' }], ['a name that is not text', { computerId: HOME, name: { x: 1 } }], ['an array', [1]], ['a string', 'Home'], ['no computer id', { name: 'Home' }]]) {
  eq('refused: ' + label, (await api({ action: 'cloud-link', id: made.id, cloud })).error, 'invalid cloud link')
}
eq('an unknown task', (await api({ action: 'cloud-link', id: 'st-nope', cloud: { computerId: HOME, name: 'Home' } })).error, 'task not found')
eq('no id', (await api({ action: 'cloud-link', cloud: null })).error, 'id required')
eq('a name is clipped to 60 characters', (await api({ action: 'cloud-link', id: made.id, cloud: { computerId: HOME, name: 'N'.repeat(100) } })).task.cloud.name.length, 60)
eq('nothing else was disturbed: three tasks', (await list()).length, 3)

console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILURES')
process.exit(fails === 0 ? 0 : 1)
