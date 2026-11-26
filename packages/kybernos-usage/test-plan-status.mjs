// The plan the usage chip and Settings > Usage show is read from the REAL answer of the host's status route (recette L2-36).
//
// The page read `status.space_plan`; the host (kybernos-cloud, `statusRoute`) answers `{ ok, connected, state: { …, space_plan } }`. The plan's name and the balance
// were therefore never found, « Credits left » was never drawn, and every earlier test passed a flat shape that does not exist. Here the answer is made by the host itself:
// a fake Kybernos API, a connected state file, the host's own profile read (`profileRefreshTick`, which writes the active space's plan into the state) and the host's own
// `/kybernos-cloud/status` and `/kybernos-cloud/quota` routes (the windows come from the fake server's budget). The page's `loadPlan` and `CreditsRow` are the shipped ones, from client.js.
//
//   node packages/kybernos-usage/test-plan-status.mjs
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const TOKEN = 'kys-' + 'u'.repeat(43)
const PERSONAL = '11111111-1111-4111-8111-111111111111'
let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

// ── The host and its fake server ────────────────────────────────────────────────────────────────────────────────────────────
const fake = { balance: 3680 }
const json = (res, status, payload) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload)) }
const server = createServer((req, res) => {
  req.resume()
  req.on('end', () => {
    if (req.url === '/v1/workspaces') return json(res, 200, { workspaces: [{ id: PERSONAL, name: 'My workspace', personal: true, role: 'owner' }] })
    if (req.url === '/v1/me') return json(res, 200, { id: 'u-1', name: 'Ada', plan: 'solo' })
    if (/^\/v1\/workspaces\/[^/]+\/plan$/.test(req.url)) {
      const body = { source: 'subscription', status: 'active', plan: { key: 'solo', name: 'Solo', kind: 'individual' }, level: 'Studio', seats: 1 }
      if (fake.balance !== null) body.credit_balance_credits = fake.balance
      return json(res, 200, body)
    }
    if (/^\/v1\/workspaces\/[^/]+\/llm\/budget$/.test(req.url)) {
      return json(res, 200, { windows: [
        { kind: 'member', window_seconds: 18000, scope: 'plan', used_percent: 42, exhausted: false },
        { kind: 'member', window_seconds: 86400, scope: 'plan', used_percent: 17, exhausted: false },
      ] })
    }
    if (req.url.startsWith('/v1/models')) return json(res, 200, { object: 'list', data: [{ id: 'glm', object: 'model' }] })
    json(res, 404, { error: 'not_found', message: 'No such route.' })
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const dir = mkdtempSync(join(tmpdir(), 'kybernos-usage-plan-status-'))
const statePath = join(dir, 'kybernos-cloud.json')
process.env.KYBERNOS_CLOUD_API = 'http://127.0.0.1:' + server.address().port
process.env.KYBERNOS_CLOUD_STATE = statePath
process.env.DSH_HOME = dir
process.env.HOME = dir
process.env.KYBERNOS_SERVERS_FILE = join(dir, 'servers.json')
const host = await import(pathToFileURL(join(here, '..', 'kybernos-cloud', 'index.js')).href)
const statusRoute = host.ROUTES.find((r) => r.path === '/kybernos-cloud/status')
const quotaRoute = host.ROUTES.find((r) => r.path === '/kybernos-cloud/quota')
assert.ok(statusRoute !== undefined && typeof statusRoute.run === 'function' && quotaRoute !== undefined && typeof quotaRoute.run === 'function', 'the host has a status route and a quota route')
const signIn = () => writeFileSync(statePath, JSON.stringify({ token: TOKEN, api: process.env.KYBERNOS_CLOUD_API, user: { id: 'u-1', name: 'Ada', email: 'ada@example.test' }, workspaces: [{ id: PERSONAL, name: 'My workspace', personal: true, role: 'owner' }] }), { mode: 0o600 })
/** The host's own answers, after its own read of the plan from the (fake) server. */
const realStatus = async () => { await host.profileRefreshTick(); return JSON.parse(JSON.stringify(await statusRoute.run())) }
const realQuota = async () => JSON.parse(JSON.stringify(await quotaRoute.run()))

// ── The page: client.js against a stub loader, `fetch` answered by the host's status and a quota fixture ────────────────────
let captured = null
let status = null
let quota = null
globalThis.window = { __ModuleLoader__: { load: (m) => { captured = m } }, __KB_LANG_RESOLVE__: () => 'en', addEventListener () {}, removeEventListener () {} }
globalThis.document = { documentElement: { lang: 'en' }, querySelector: () => null, head: { appendChild () {} }, createElement: () => ({ setAttribute () {} }) }
const answer = (body) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) })
// The page asks with relative addresses; the host (same process) asks the fake server with absolute ones and must reach it for real.
const realFetch = globalThis.fetch
globalThis.fetch = (url, init) => {
  if (/^https?:\/\//.test(String(url))) return realFetch(url, init)
  if (String(url) === '/kybernos-cloud/quota') return answer(quota)
  if (String(url) === '/kybernos-cloud/status') return answer(status)
  return answer({ ok: true })
}
const React = { createElement: (type, props, ...kids) => ({ type, props, kids }), useState: (v) => [v, () => {}], useEffect () {}, useRef: (v) => ({ current: v }), useMemo: (f) => f(), useCallback: (f) => f }
// eslint-disable-next-line no-new-func
new Function(readFileSync(join(here, 'client.js'), 'utf8'))()
const plugin = captured.factory((name) => (name === 'react' ? React : undefined))
const T = plugin.__test
const textOf = (node) => (node === null || node === undefined ? '' : (typeof node === 'string' ? node : (typeof node === 'number' ? String(node) : (Array.isArray(node) ? node.map(textOf).join('') : textOf(node.kids)))))

try {
  console.log('Kybernos usage — the plan, from the host\'s own status')

  signIn()
  status = await realStatus()
  quota = await realQuota()
  assert.equal(status.connected, true)
  assert.equal(quota.ok, true, 'the host\'s quota route answers for the active space')
  assert.equal(status.space_plan, undefined, 'the host answers the plan under `state`, not at the top: that is the shape the page must read')
  assert.equal(status.state.space_plan.credit_balance_credits, 3680, 'the host carries the balance of the active space')
  ok('the real answer of the host: the plan of the active space is under `state`, with its balance')

  {
    const plan = await T.loadPlan(true)
    assert.equal(plan.connected, true)
    assert.equal(plan.credits, 3680, 'the balance is found')
    assert.equal(plan.name, 'Solo Studio', 'and so is the plan\'s name')
    assert.deepEqual(plan.windows.map((w) => w.pct), [42, 17])
    ok('loadPlan reads the balance and the name from `state.space_plan` of that answer (the windows still come from the quota)')
    const row = textOf(T.CreditsRow({ credits: plan.credits }))
    assert.match(row, /Credits left/)
    assert.match(row, /3,680/)
    assert.match(row, /credits/)
    ok('and the row « Credits left 3,680 credits » is drawn from it')
  }

  // A balance the server did not give is `null` in the host's state: no row at all, never « 0 credits ».
  {
    fake.balance = null
    status = await realStatus()
    quota = await realQuota()
    assert.equal(status.state.space_plan.credit_balance_credits, null, 'the host says it does not know')
    const plan = await T.loadPlan(true)
    assert.equal(plan.connected, true)
    assert.equal(plan.credits, null, 'unknown stays unknown')
    assert.equal(plan.name, 'Solo Studio')
    assert.equal(T.CreditsRow({ credits: plan.credits }), null, 'no row')
    ok('an unknown balance draws no row (it is not « 0 credits »)')
  }

  // A balance of zero IS a number: the row says « 0 credits ».
  {
    fake.balance = 0
    status = await realStatus()
    quota = await realQuota()
    const plan = await T.loadPlan(true)
    assert.equal(plan.credits, 0)
    assert.match(textOf(T.CreditsRow({ credits: plan.credits })), /0/)
    ok('a balance of zero is drawn as zero')
  }

  // Signed out: the host answers `connected: false` with no state; the page says so and invents nothing.
  {
    rmSync(statePath, { force: true })
    status = JSON.parse(JSON.stringify(await statusRoute.run()))
    quota = await realQuota()
    assert.equal(status.connected, false)
    assert.equal(quota.connected, false)
    const plan = await T.loadPlan(true)
    assert.deepEqual(plan, { connected: false, windows: [] })
    ok('signed out: no plan, no balance, no windows')
  }
  console.log('\n' + pass + ' passed')
} catch (e) {
  console.error('  ✗ ' + (e && e.stack ? e.stack : e))
  process.exitCode = 1
} finally {
  server.close()
  // The host keeps timers of its own; the test is over.
  process.exit(process.exitCode === undefined ? 0 : process.exitCode)
}
