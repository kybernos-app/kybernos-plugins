// ── The account's picture stays current without a page asking ───────────────────────────────────────────────────────
//
// Found in the pre-production acceptance (2026-10-10, against the new server):
//   · the server's claim carries the person, not their workspaces: right after pairing DSH had no workspace list, no active
//     workspace and no plan of the active space, so the card said « Team » (the account-level word) and the Team features and the model
//     route's workspace header waited for a page to call /refresh;
//   · nothing else re-read them: a member removed from a team (or a team deleted) went on sending `x-kybernos-workspace` of a team the
//     server no longer knew (every model call a 404), a token revoked from the account page was still « signed in » for ever.
//
//   node kybernos-cloud/test-profile-refresh.mjs
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TOKEN = 'kys-' + 'p'.repeat(43)
const DEVICE_SECRET = 'secret-' + 'd'.repeat(30)
const PERSONAL = '11111111-1111-4111-8111-111111111111'
const TEAM = '22222222-2222-4222-8222-222222222222'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

const fake = { calls: [], workspaces: [{ id: PERSONAL, name: 'My workspace', personal: true, role: 'owner' }, { id: TEAM, name: 'Acme', personal: false, role: 'member' }], mode: 'good' }
const json = (res, status, payload) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload)) }
const server = createServer((req, res) => {
  req.resume()
  req.on('end', () => {
    fake.calls.push(req.method + ' ' + req.url)
    if (req.url === '/v1/device/poll') return json(res, 200, { status: 'claimed', token: TOKEN, expires_at: '2026-12-01T00:00:00Z', user: { id: 'u-1', email: 'a@example.test', name: 'Ada', plan: 'team' } })
    if (req.url === '/v1/workspaces' && req.method === 'GET') {
      if (fake.mode === 'revoked') return json(res, 401, { error: 'unauthorized', message: 'Sign in required.' })
      if (fake.mode === 'portal') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html>portal</html>') }
      return json(res, 200, { workspaces: fake.workspaces })
    }
    if (req.url === '/v1/me') return json(res, 200, { id: 'u-1', name: 'Ada', plan: 'team' })
    const plan = /^\/v1\/workspaces\/([^/]+)\/plan$/.exec(req.url)
    if (plan !== null) {
      const team = plan[1] === TEAM
      return json(res, 200, { source: 'subscription', status: 'active', plan: { key: team ? 'team' : 'solo', name: team ? 'Team' : 'Solo', kind: team ? 'team' : 'individual' }, level: team ? 'Per seat' : 'Studio', seats: 1, credit_balance_credits: 1200 })
    }
    if (req.url.startsWith('/v1/models')) return json(res, 200, { object: 'list', data: [{ id: 'glm', object: 'model' }] })
    json(res, 404, { error: 'not_found', message: 'No such route.' })
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

const dir = mkdtempSync(join(tmpdir(), 'kybernos-cloud-profile-refresh-'))
const statePath = join(dir, 'kybernos-cloud.json')
process.env.KYBERNOS_CLOUD_API = 'http://127.0.0.1:' + server.address().port
process.env.KYBERNOS_CLOUD_STATE = statePath
process.env.DSH_HOME = dir
process.env.HOME = dir
process.env.KYBERNOS_SERVERS_FILE = join(dir, 'servers.json')

const routes = new Map()
const webServer = { register: (r) => { routes.set(r.path, r.handler); return () => routes.delete(r.path) } }
const effects = []
const ctx = {
  get: (name) => (name === 'webServer' ? webServer : undefined),
  inject: (_list, cb) => cb(ctx),
  effect: (fn, label) => { effects.push(label); fn() },
  on: () => {},
  systemPrompt: { context: () => {} },
  tools: { register: () => () => {} },
}
const mod = await import('./index.js')
mod.MEMORY_TUNING.writeRefreshMs = -1
mod.MEMORY_TUNING.tickMs = 3600000
if (mod.PROFILE_REFRESH_TUNING !== undefined) { mod.PROFILE_REFRESH_TUNING.firstMs = 3600000; mod.PROFILE_REFRESH_TUNING.tickMs = 3600000 }
mod.apply(ctx)

const fakeRes = () => ({ status: 0, body: null, writeHead(status) { this.status = status }, end(payload) { this.body = payload === undefined || payload === '' ? null : JSON.parse(payload) } })
const hit = async (path, method, body) => {
  const handler = routes.get(path.split('?')[0])
  assert.ok(handler !== undefined, 'missing route ' + path)
  const res = fakeRes()
  await handler({
    method, url: path, headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' },
    async *[Symbol.asyncIterator]() { if (body !== undefined) yield Buffer.from(JSON.stringify(body)) },
  }, res)
  return res
}
const readState = () => JSON.parse(readFileSync(statePath, 'utf8'))
const pending = () => writeFileSync(statePath, JSON.stringify({ device_id: 'dev-1', device_secret: DEVICE_SECRET, user_code: 'ABC234', activation_url: 'http://127.0.0.1/activate', expires_at: new Date(Date.now() + 600000).toISOString(), api: process.env.KYBERNOS_CLOUD_API }), { mode: 0o600 })

try {
  console.log('Kybernos Cloud — the picture of the account stays current')

  // 1. The claim: the workspaces and the active space's plan are there at once.
  {
    pending()
    const polled = await hit('/kybernos-cloud/poll', 'POST')
    assert.equal(polled.body.connected, true, JSON.stringify(polled.body).slice(0, 200))
    const view = (await hit('/kybernos-cloud/status', 'GET')).body.state
    assert.deepEqual((view.workspaces || []).map((w) => w.id), [PERSONAL, TEAM], 'the workspaces must be known right after the claim')
    assert.equal(view.active_workspace_id, PERSONAL, 'the active workspace must be the first one, not null')
    assert.equal(view.space_plan !== undefined ? view.space_plan.key : undefined, 'solo', 'the plan of the ACTIVE space (not the account-level « team ») must be known')
    assert.equal((polled.body.state.workspaces || []).length, 2, 'the poll answer itself carries them')
    ok('right after the claim the workspaces, the active one and its plan are known (the card does not say « Team » for a personal space)')
  }

  // 2. A member removed from the active team: the next tick falls back to a space that exists.
  {
    await hit('/kybernos-cloud/space/active', 'POST', { workspace_id: TEAM })
    assert.equal((await hit('/kybernos-cloud/status', 'GET')).body.state.active_workspace_id, TEAM)
    fake.workspaces = [{ id: PERSONAL, name: 'My workspace', personal: true, role: 'owner' }]   // removed from Acme
    fake.calls.length = 0
    assert.equal(typeof mod.profileRefreshTick, 'function', 'the host must export the periodic read')
    await mod.profileRefreshTick()
    const view = (await hit('/kybernos-cloud/status', 'GET')).body.state
    assert.equal(view.active_workspace_id, PERSONAL, 'the removed team must not stay active')
    assert.deepEqual(view.workspaces.map((w) => w.id), [PERSONAL])
    ok('a tick drops a team the person no longer belongs to and falls back to a space that exists (no page needed)')
  }

  // 3. The token revoked from the account page: the next tick signs DSH out, like the card's refresh does.
  {
    fake.mode = 'revoked'
    await mod.profileRefreshTick()
    const st = (await hit('/kybernos-cloud/status', 'GET')).body
    assert.equal(st.connected, false, 'a revoked device must not stay « signed in »')
    fake.mode = 'good'
    ok('a tick notices a token revoked from the account page and signs DSH out')
  }

  // 4. A server that cannot answer (a portal page) changes nothing; nothing is asked when nobody is connected.
  {
    pending()
    await hit('/kybernos-cloud/poll', 'POST')
    const before = readState()
    fake.mode = 'portal'
    await mod.profileRefreshTick()
    const after = readState()
    assert.deepEqual(after.workspaces, before.workspaces, 'a captive-portal page must not erase the list')
    assert.equal(after.token, TOKEN)
    fake.mode = 'good'
    writeFileSync(statePath, '{}')
    fake.calls.length = 0
    assert.equal(await mod.profileRefreshTick(), null)
    assert.deepEqual(fake.calls, [], 'not connected: no call at all')
    ok('a portal page changes nothing, and a DSH that is not connected asks nothing')
  }

  // 5. Two ticks at once make one read.
  {
    pending()
    await hit('/kybernos-cloud/poll', 'POST')
    fake.calls.length = 0
    await Promise.all([mod.profileRefreshTick(), mod.profileRefreshTick(), mod.profileRefreshTick()])
    const lists = fake.calls.filter((c) => c === 'GET /v1/workspaces').length
    assert.equal(lists, 1, 'overlapping ticks must not stack up (' + lists + ' reads of the list)')
    ok('overlapping ticks make one read')
  }

  // 6. The periodic read is mounted through ctx.effect (cleaned with the plugin).
  assert.ok(effects.some((l) => /periodic profile read/.test(String(l))), 'the tick must be mounted through ctx.effect')
  ok('the periodic read is mounted through ctx.effect')

  console.log('\n' + pass + ' checks passed')
} finally {
  server.close()
}
process.exit(0)
