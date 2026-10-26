// kybernos-pulse — the host: the store, the watcher on a real folder, the routes, and apply() with a missing service.
//   node packages/kybernos-pulse/test-host.mjs
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPulse, createWatcher, hostOk, HELPER_FRESH_MS, mountRoutes, originOk } from './pulse-host.mjs'
import { apply, PASS_MS, readRunFrom, readTasksFile, storeIo } from './index.js'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const NOW = Date.parse('2026-10-26T14:30:00Z')
const home = mkdtempSync(join(tmpdir(), 'kybernos-pulse-'))

// ── the store ──────────────────────────────────────────────────────────────────────────────────────────────
console.log('the store')
let disk = null
let writes = 0
const mem = () => createPulse({ read: () => disk, write: (d) => { writes += 1; disk = JSON.parse(JSON.stringify(d)) }, now: () => NOW })
let pulse = mem()
let v = pulse.view()
assert.equal(v.settings.level, 'need'); assert.deepEqual(v.inbox, []); assert.equal(v.unread, 0)
ok('an empty disk gives the defaults and an empty inbox')
assert.equal(pulse.patchSettings({ level: 'every' }).ok, true); assert.equal(writes, 1)
assert.equal(pulse.patchSettings({ level: 'nope' }).ok, false); assert.equal(writes, 1)
ok('a good patch is saved, a refused one writes nothing')
pulse = createPulse({ read: () => { throw new Error('corrupt') }, write: () => { throw new Error('read-only') }, now: () => NOW })
assert.equal(pulse.view().settings.level, 'need')
assert.equal(pulse.patchSettings({ badge: false }).ok, true)
ok('an unreadable or unwritable file is never fatal')

// ── the watcher, with a fake engine and a real tasks.json ───────────────────────────────────────────────────
console.log('the watcher')
mkdirSync(join(home, 'kybernos'), { recursive: true })
const tasksPath = join(home, 'kybernos', 'tasks.json')
const at = (min) => new Date(NOW - min * 60000).toISOString()
writeFileSync(tasksPath, JSON.stringify([{ id: 't1', name: 'Weekly TikTok scout', history: [{ at: at(2), sessionId: 'session-1', status: 'fired' }] }]))
const events = { 'session-1': [{ type: 'turn/start', time: NOW - 100000, data: {} }, { type: 'tool/call', time: NOW - 90000, data: {} }] }
const persistence = { open: async (id) => { if (events[id] === undefined) throw new Error('gone'); return { read: async () => ({ events: events[id] }), close: async () => {} } } }
disk = null
pulse = mem()
let clock = NOW
const watcher = createWatcher({ pulse, readTasks: readTasksFile(home), readRunOf: readRunFrom(() => persistence), now: () => clock })
assert.equal(await watcher.tick(), true)
assert.equal(pulse.view().running.length, 1); assert.equal(pulse.view().inbox.length, 0)
ok('a run in flight is followed on the first pass and the inbox stays empty')
events['session-1'].push({ type: 'turn/end', time: NOW - 20000, data: { reason: { kind: 'stop' } } })
clock = NOW + 15000
await watcher.tick()
v = pulse.view()
assert.equal(v.inbox.length, 1); assert.equal(v.inbox[0].kind, 'done'); assert.equal(v.inbox[0].task, 'Weekly TikTok scout'); assert.equal(v.running.length, 0); assert.equal(v.unread, 1)
assert.deepEqual(v.banners, [])
ok('when it ends, an unread "done" item appears and, at the default level, no banner is due')
pulse.patchSettings({ level: 'every' })
assert.deepEqual(pulse.view().banners, [v.inbox[0].id])
pulse.inbox({ action: 'banner-shown', ids: [v.inbox[0].id] })
assert.deepEqual(pulse.view().banners, [])
ok('at "every run" a banner is due once, then marked as shown')
const before = writes
await watcher.tick(); await watcher.tick()
assert.equal(writes, before)
ok('a pass that changes nothing writes nothing')
assert.equal(pulse.inbox({ action: 'dismiss', id: v.inbox[0].id }).ok, true); assert.equal(pulse.view().inbox.length, 0)
assert.equal(pulse.inbox({ action: 'dismiss' }).ok, false)
ok('dismissing removes the item; a body without an id is refused')

writeFileSync(tasksPath, '{ not json')
assert.equal(await watcher.tick(), true)
assert.deepEqual(await readTasksFile(home)(), [])
rmSync(tasksPath)
assert.deepEqual(await readTasksFile(home)(), [])
ok('a corrupt or missing tasks.json means nothing to follow, not an error')
assert.equal(await readRunFrom(() => undefined)('session-1'), null)
assert.equal(await readRunFrom(() => persistence)('../etc'), null)
assert.equal(await readRunFrom(() => persistence)('session-unknown'), null)
ok('no persistence service, a bad session id or a gone journal all read as "unknown"')

const flaky = createWatcher({ pulse, readTasks: async () => { throw new Error('disk gone') }, readRunOf: async () => null, now: () => NOW, log: () => {} })
assert.equal(await flaky.tick(), false)
ok('a pass that fails answers false and never throws')
let slow = 0
const gate = {}
const slowWatcher = createWatcher({ pulse, readTasks: () => new Promise((r) => { gate.go = () => r([]) }), readRunOf: async () => null, now: () => NOW })
const p1 = slowWatcher.tick(); slow = await slowWatcher.tick(); gate.go(); await p1
assert.equal(slow, false)
ok('two passes never overlap')

// ── the file on disk ────────────────────────────────────────────────────────────────────────────────────────
console.log('the file')
const io = storeIo(home)
io.write({ version: 1, settings: { level: 'never' }, state: {} })
assert.equal(JSON.parse(readFileSync(join(home, 'kybernos', 'pulse', 'pulse.json'), 'utf8')).settings.level, 'never')
assert.equal((statSync(join(home, 'kybernos', 'pulse', 'pulse.json')).mode & 0o777).toString(8), '600')
assert.equal(io.read().settings.level, 'never')
ok('the store is one file under the DSH folder, readable by its owner only')
assert.equal(storeIo(join(home, 'nowhere')).read(), null)
ok('a file that is not there reads as null')

// ── the routes ──────────────────────────────────────────────────────────────────────────────────────────────
console.log('the routes')
const routes = new Map()
const web = { register: ({ path, handler }) => { routes.set(path, handler); return () => routes.delete(path) } }
disk = null
pulse = mem()
let refuse = null
mountRoutes(web, pulse, () => refuse)
assert.deepEqual([...routes.keys()].sort(), ['/kybernos-pulse/inbox', '/kybernos-pulse/settings', '/kybernos-pulse/state'])
const hit = async (path, { method = 'GET', headers = {}, body } = {}) => {
  const out = { status: 0, body: null }
  const res = { writeHead (s) { out.status = s }, end (t) { out.body = t ? JSON.parse(t) : null } }
  const req = { method, url: path, headers: { host: '127.0.0.1:3080', ...headers }, socket: { localPort: 3080 }, async * [Symbol.asyncIterator] () { if (body !== undefined) yield Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)) } }
  await routes.get(path)(req, res)
  return out
}
const json = { 'content-type': 'application/json', origin: 'http://127.0.0.1:3080' }
let r = await hit('/kybernos-pulse/state')
assert.equal(r.status, 200); assert.equal(r.body.ok, true); assert.equal(r.body.settings.level, 'need')
ok('GET state answers the view')
assert.equal((await hit('/kybernos-pulse/state', { headers: { host: 'evil.example:3080' } })).status, 403)
assert.equal((await hit('/kybernos-pulse/state', { headers: { origin: 'http://evil.example' } })).status, 403)
assert.equal((await hit('/kybernos-pulse/state', { method: 'POST' })).status, 405)
ok('a foreign Host or Origin is refused on a read, and so is another method')

// ── the Mac menu-bar app says who it is on its reads ─────────────────────────
console.log('the helper')
{
  const map = new Map()
  let t = 1000000
  mountRoutes({ register: ({ path, handler }) => { map.set(path, handler); return () => map.delete(path) } }, mem(), () => null, { now: () => t })
  const read = async (headers = {}) => {
    const out = { status: 0, body: null }
    const res = { writeHead (s) { out.status = s }, end (x) { out.body = x ? JSON.parse(x) : null } }
    await map.get('/kybernos-pulse/state')({ method: 'GET', url: '/kybernos-pulse/state', headers: { host: '127.0.0.1:3080', ...headers }, socket: { localPort: 3080 } }, res)
    return out
  }
  assert.deepEqual((await read()).body.helper, { seen: false, banners: false })
  ok('with no word from the helper, it is not there')
  assert.deepEqual((await read({ 'x-kybernos-helper': 'v1; banners=ok' })).body.helper, { seen: true, banners: true })
  t += HELPER_FRESH_MS - 1
  assert.deepEqual((await read()).body.helper, { seen: true, banners: true })
  ok('it is heard, and still counted on a read that does not say it (a browser tab) until HELPER_FRESH_MS has passed')
  t += 2
  assert.deepEqual((await read()).body.helper, { seen: false, banners: false })
  ok('it is not there any more once it stops reading')
  assert.deepEqual((await read({ 'x-kybernos-helper': 'v1; banners=off' })).body.helper, { seen: true, banners: false })
  ok('a helper whose notifications are not allowed is there, without banners')
  t += HELPER_FRESH_MS + 1
  for (const bad of ['v2; banners=ok', 'v1; banners=yes', ' v1; banners=ok', 'v1; banners=ok; x=1', 'banners=ok', 'x'.repeat(5000)]) {
    assert.deepEqual((await read({ 'x-kybernos-helper': bad })).body.helper, { seen: false, banners: false }, bad.slice(0, 30))
  }
  ok('a header of another shape is ignored')
  const foreign = await read({ host: 'evil.example:3080', 'x-kybernos-helper': 'v1; banners=ok' })
  assert.equal(foreign.status, 403)
  assert.deepEqual((await read()).body.helper, { seen: false, banners: false })
  ok('a refused read does not count as the helper')
}
r = await hit('/kybernos-pulse/settings', { method: 'POST', headers: json, body: { level: 'never' } })
assert.equal(r.status, 200); assert.equal(r.body.settings.level, 'never')
assert.equal(pulse.view().settings.level, 'never')
ok('POST settings applies the patch')
assert.equal((await hit('/kybernos-pulse/settings', { method: 'POST', headers: json, body: { level: 'bogus' } })).status, 400)
assert.equal((await hit('/kybernos-pulse/settings', { method: 'POST', headers: { origin: json.origin }, body: { level: 'every' } })).status, 415)
assert.equal((await hit('/kybernos-pulse/settings', { method: 'POST', headers: json, body: '{nope' })).status, 400)
assert.equal((await hit('/kybernos-pulse/settings', { method: 'POST', headers: json, body: 'x'.repeat(9000) })).status, 400)
assert.equal((await hit('/kybernos-pulse/settings', { method: 'GET' })).status, 405)
assert.equal(pulse.view().settings.level, 'never')
ok('a bad value, a missing content type, broken or oversized JSON and a GET all leave the settings alone')
refuse = { status: 401, error: 'sign-in-required' }
r = await hit('/kybernos-pulse/settings', { method: 'POST', headers: json, body: { level: 'every' } })
assert.equal(r.status, 401); assert.equal(pulse.view().settings.level, 'never')
r = await hit('/kybernos-pulse/inbox', { method: 'POST', headers: json, body: { action: 'read-all' } })
assert.equal(r.status, 401)
ok('when the guard refuses a write, the answer is the guard\'s and nothing changed')
refuse = null
assert.equal((await hit('/kybernos-pulse/inbox', { method: 'POST', headers: json, body: { action: 'read-all' } })).status, 200)
assert.equal((await hit('/kybernos-pulse/inbox', { method: 'POST', headers: json, body: { action: 'x' } })).status, 400)
ok('POST inbox answers 200 for a known action and 400 for another')
assert.equal(hostOk({ headers: { host: '127.0.0.1:3080' }, socket: { localPort: 3080 } }), true)
assert.equal(hostOk({ headers: { host: 'localhost:3080' }, socket: { localPort: 3080 } }), true)
assert.equal(hostOk({ headers: { host: 'localhost:9' }, socket: { localPort: 3080 } }), false)
assert.equal(originOk({ headers: {}, socket: { localPort: 3080 } }), true)
assert.equal(originOk({ headers: { origin: 'file:///x' }, socket: { localPort: 3080 } }), false)
ok('the Host and Origin fences')

// ── apply() ────────────────────────────────────────────────────────────────────────────────────────────────
console.log('apply')
const saved = process.env.DSH_HOME
process.env.DSH_HOME = home
const effects = []
const lines = []
const log = console.log
console.log = (...a) => { lines.push(a.join(' ')) }
try {
  apply({ get: () => undefined, inject: (_n, cb) => cb({ webServer: web }), effect: (fn) => { effects.push(fn()) } })
  apply({ get: () => undefined, inject: () => { throw new Error('no inject') }, effect: (fn) => { effects.push(fn()) } })
  apply({})
  apply(undefined)
} finally { console.log = log; process.env.DSH_HOME = saved }
assert.ok(lines.some((l) => l.includes('routes mounted')))
assert.ok(effects.some((e) => typeof e === 'function'))
for (const e of effects) if (typeof e === 'function') e()
ok('apply never throws, even with no service, no inject and no context; it mounts the routes and gives back its cleanups')
assert.equal(PASS_MS, 15000)
rmSync(home, { recursive: true, force: true })
console.log('\n' + pass + ' checks passed')
