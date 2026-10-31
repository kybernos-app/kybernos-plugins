// test-publish-through-cloud.mjs — the two halves of Publish's real hosting wired to each other over HTTP: kybernos-db's `cloudHosting` (remote/cloud-hosting.mjs) calls the seam that kybernos-cloud
// publishes (`cloudSeamCall`), which adds the account token and calls a local server that answers the team-space routes in the shapes kybernos-server documents (routes.ts, ADR 0061 section 12).
// Each half has its own test with a fake of the other; this one proves they agree: the paths, the methods, the token only on the wire, the field names, the "starting" answer asked again.
//   node scripts/test-publish-through-cloud.mjs
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let count = 0
const ok = async (label, fn) => { await fn(); count++; console.log('ok  ', label) }

const TOKEN = 'kyd_' + 'q'.repeat(40)
const KEY = 'cd'.repeat(32)
const seen = []
const script = { hosts: 'ok', ensure: ['starting', 'starting', 'ready'], release: 'ok' }
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
const api = createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization || null, body: raw === '' ? null : JSON.parse(raw) })
    const owner = req.headers.authorization === 'Bearer ' + TOKEN
    if (!owner) return json(res, 401, { error: 'unauthorized', message: 'Sign in required.', request_id: 'r1' })
    if (req.method === 'GET' && req.url === '/v1/workspaces/ws_main/team-space/hosts') {
      if (script.hosts === 'off') return json(res, 503, { error: 'teamspace_disabled', message: 'Team spaces are switched off on this server.', request_id: 'r2' })
      return json(res, 200, { order_url: 'https://kybernos.example.test/console/computers', hosts: [
        { id: 'cmp_a1', name: 'Studio', state: 'sleeping', region: 'fra', region_label: 'Frankfurt, EU', always_on: false, shared: true, space: null },
        { id: 'cmp_b2', name: 'Always on', state: 'running', region: 'ams', region_label: null, always_on: true, shared: true, space: { id: 'sp_b2', state: 'active' } },
      ] })
    }
    if (req.method === 'POST' && req.url === '/v1/workspaces/ws_main/team-space') {
      const host = JSON.parse(raw || '{}').host
      if (host !== 'cmp_a1' && host !== 'cmp_b2') return json(res, 404, { error: 'unknown_host', message: 'Not found.', request_id: 'r3' })
      const step = script.ensure.length > 1 ? script.ensure.shift() : script.ensure[0]
      if (step === 'starting') return json(res, 202, { ready: false, state: 'creating', frozen: false, retry_after_seconds: 1 })
      return json(res, 200, { ready: true, state: 'active', frozen: false, retry_after_seconds: null, space: { id: 'sp_' + host.slice(4), url: 'https://team.kaby.test', boot_key: KEY, name: 'Team space', region: 'fra', region_label: 'Frankfurt, EU', always_on: false, host_id: host } })
    }
    if (req.method === 'DELETE' && req.url.startsWith('/v1/workspaces/ws_main/team-space')) {
      return script.release === 'ok' ? json(res, 200, { released: true, state: 'released' }) : json(res, 409, { error: 'apps_remain', message: 'x', request_id: 'r4' })
    }
    return json(res, 404, { error: 'not_found', message: 'Not found.', request_id: 'r5' })
  })
})
await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve))
const home = mkdtempSync(join(tmpdir(), 'kb-publish-cloud-'))
const stateFile = join(home, 'kybernos-cloud.json')
process.env.HOME = home
process.env.DSH_HOME = join(home, '.dsh')
process.env.KYBERNOS_CLOUD_API = 'http://127.0.0.1:' + api.address().port
process.env.KYBERNOS_CLOUD_STATE = stateFile
delete process.env.KYBERNOS_SERVERS_FILE

let failed = false
try {
  const { publishCloudSeam } = await import('../packages/kybernos-cloud/index.js')
  const { cloudHosting } = await import('../packages/kybernos-db/remote/cloud-hosting.mjs')
  const { describeHosting, readHosts } = await import('../packages/kybernos-db/remote/hosting.mjs')
  const target = {}
  publishCloudSeam(target)
  let clock = Date.UTC(2026, 9, 31, 12, 0, 0)
  const waits = []
  const hosting = cloudHosting({ seam: () => target[Symbol.for('kybernos.cloud')], now: () => clock, wait: async (ms) => { waits.push(ms); clock += ms } })
  const tick = () => new Promise((resolve) => setImmediate(resolve))
  const signIn = (extra = {}) => writeFileSync(stateFile, JSON.stringify({ token: TOKEN, api: process.env.KYBERNOS_CLOUD_API, workspaces: [{ id: 'ws_main', name: 'Main' }], active_workspace_id: 'ws_main', ...extra }) + '\n', { mode: 0o600 })

  await ok('signed out: Publish is not offered and the server is not called', async () => {
    assert.equal(hosting.available(), false)
    await tick()
    assert.equal((await hosting.hosts()).code, 'unavailable')
    assert.equal(seen.length, 0)
  })

  await ok('signed in: the first look says no and reads the computers in the background; the next look says yes', async () => {
    signIn()
    assert.equal(hosting.available(), false)
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(hosting.available(), true)
    assert.deepEqual(seen.map((s) => [s.method, s.url, s.auth === 'Bearer ' + TOKEN]), [['GET', '/v1/workspaces/ws_main/team-space/hosts', true]], 'the token is added by the cloud half, on the wire only')
    assert.equal(describeHosting(hosting).orderUrl, 'https://kybernos.example.test/console/computers')
  })

  await ok('the computers, as the plugin reads them', async () => {
    const r = await readHosts(hosting)
    assert.equal(r.ok, true)
    assert.deepEqual(r.hosts.map((h) => [h.id, h.name, h.state, h.region, h.alwaysOn, h.shared]), [
      ['cmp_a1', 'Studio', 'sleeping', 'Frankfurt, EU', false, true],
      ['cmp_b2', 'Always on', 'running', 'ams', true, true],
    ])
  })

  await ok('ensureSpace: the sleeping computer is asked until it answers, then the space is handed over with its key', async () => {
    const before = seen.length
    const r = await hosting.ensureSpace({ host: 'cmp_a1' })
    assert.deepEqual(r, { ok: true, space: { id: 'sp_a1', url: 'https://team.kaby.test', bootKey: KEY } })
    assert.deepEqual(seen.slice(before).map((s) => [s.method, s.url, s.body && s.body.host]), [['POST', '/v1/workspaces/ws_main/team-space', 'cmp_a1'], ['POST', '/v1/workspaces/ws_main/team-space', 'cmp_a1'], ['POST', '/v1/workspaces/ws_main/team-space', 'cmp_a1']])
    assert.deepEqual(waits, [2000, 2000], 'asked again after the 1 s the server named, which is held up to the 2 s floor')
  })

  await ok('ensureSpace: a computer the server does not know is "unknown-host"', async () => {
    const r = await hosting.ensureSpace({ host: 'cmp_zz' })
    assert.deepEqual([r.ok, r.code], [false, 'unknown-host'])
  })

  await ok('releaseSpace: yes when released, no while apps remain', async () => {
    assert.deepEqual(await hosting.releaseSpace('sp_a1'), { ok: true })
    assert.equal(seen.at(-1).url, '/v1/workspaces/ws_main/team-space?space=sp_a1')
    script.release = 'busy'
    assert.deepEqual(await hosting.releaseSpace('sp_a1'), { ok: false })
  })

  await ok('switching the active workspace: the old verdict is not believed, and the old workspace is out of reach', async () => {
    signIn({ workspaces: [{ id: 'ws_main' }, { id: 'ws_team' }], active_workspace_id: 'ws_team' })
    const before = seen.length
    assert.equal(hosting.available(), false)
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(seen[before].url, '/v1/workspaces/ws_team/team-space/hosts', 'asked for the workspace now active')
    assert.equal(hosting.available(), false, 'this server answers 404 for it')
  })

  await ok('a server that switched hosting off: no button, and the computers say why', async () => {
    signIn()
    script.hosts = 'off'
    clock += 10 * 60 * 1000
    hosting.available()
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(hosting.available(), false)
    const r = await hosting.hosts()
    assert.deepEqual([r.ok, r.code], [false, 'unavailable'])
    assert.match(r.message, /switched off/)
  })

  await ok('the token is only ever on the wire', () => {
    assert.equal(JSON.stringify(target[Symbol.for('kybernos.cloud')]).includes(TOKEN), false)
  })
} catch (e) {
  failed = true
  console.log('FAILED — ' + (e && e.stack ? e.stack : e))
} finally {
  api.close()
  if (typeof api.closeAllConnections === 'function') api.closeAllConnections()
  rmSync(home, { recursive: true, force: true })
}
if (failed) process.exit(1)
console.log('\npublish through the cloud: ' + count + ' checks passed')
process.exit(0)
