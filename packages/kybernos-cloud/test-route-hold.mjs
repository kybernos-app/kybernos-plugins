// A turn is held to the model route: the host half (docs/dev/team-profiles-cadrage.md, step 5).
//   node packages/kybernos-cloud/test-route-hold.mjs
//
// A REAL HTTP server carries the plugin's routes, a fake Kybernos API answers, Documents is a throw-away folder, and the engine is played by hand: the test fires the same events the
// engine fires (the `agent/pre-step` waterfall) at the listeners the plugin registered. What is proven: a DSH no longer follows a chat from one space to another (`space/for-folder` and
// `space/busy` are gone, and creating a team does not make it active here: it has a DSH of its own); a switch made while the server does not answer leaves the model route on the previous
// team, and the next turn re-aligns it (the second press on the team, done for the person) or, if it cannot, is REFUSED with a sentence naming the team it would be billed to, once per turn;
// the host also tries again by itself at 10 s, 30 s and 2 min (recette L3-76, decision DL-20); a profile refresh or a catalogue import in flight does not undo a switch; a payload that is not
// what the engine sends breaks nothing.
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionSource } from './session-guard.mjs'
import { SESSION_SECRET, sessionCookie } from './lib-session-test.mjs'

const TOKEN = 'kys-' + 'f'.repeat(43)
const PERSONAL = { id: '11111111-1111-4111-8111-111111111111', name: 'My workspace', personal: true, role: 'owner' }
const ACME = { id: '22222222-2222-4222-8222-222222222222', name: 'Acme', personal: false, role: 'admin' }
const STUDIO = { id: '33333333-3333-4333-8333-333333333333', name: 'Studio B', personal: false, role: 'member' }
const SPACES = [PERSONAL, ACME, STUDIO]
const MADE = { id: '55555555-5555-4555-8555-555555555555', name: 'Made Now', personal: false, role: 'owner' }
const PLANLESS = { id: '66666666-6666-4666-8666-666666666666', name: 'No Plan Yet', personal: false, role: 'owner' }

const api = { calls: [], planDelayMs: 0, listDelayMs: 0, modelsDelayMs: 0 }
const apiServer = http.createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname
  api.calls.push(req.method + ' ' + path)
  // The server does not answer (the connection is cut), for the scenario of a switch made while it is down.
  if (api.down === true) { req.socket.destroy(); return }
  const reply = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
  if (req.method === 'GET' && path === '/v1/workspaces') return api.listDelayMs > 0 ? setTimeout(() => reply(200, { workspaces: SPACES }), api.listDelayMs) : reply(200, { workspaces: SPACES })
  if (req.method === 'POST' && path === '/v1/workspaces') {
    let text = ''
    req.on('data', (c) => { text += c })
    req.on('end', () => { const name = JSON.parse(text).name; reply(201, { workspace: name === PLANLESS.name ? PLANLESS : MADE }) })
    return
  }
  if (req.method === 'GET' && /^\/v1\/workspaces\/[^/]+\/plan$/.test(path)) {
    const none = path.includes(PLANLESS.id)
    const answer = () => reply(200, { plan: none ? { key: 'none', name: 'No plan', kind: 'none' } : { key: 'team', name: 'Team', kind: 'team' }, level: '1-5 seats', status: 'active' })
    return api.planDelayMs > 0 ? setTimeout(answer, api.planDelayMs) : answer()
  }
  if (req.method === 'GET' && path === '/v1/models') {
    const answer = () => reply(200, { object: 'list', data: [{ id: 'kys-test-model', object: 'model' }] })
    // `modelsOnce`: only the first read is slow (the import of the switch), the next ones (the refresh's own) are not.
    const delay = api.modelsDelayMs
    if (api.modelsOnce === true) api.modelsDelayMs = 0
    return delay > 0 ? setTimeout(answer, delay) : answer()
  }
  return reply(404, { error: 'not_found' })
})
await new Promise((resolve) => apiServer.listen(0, '127.0.0.1', resolve))

const dir = mkdtempSync(join(tmpdir(), 'kybernos-cloud-route-hold-'))
const statePath = join(dir, 'kybernos-cloud.json')
const DOCS = join(dir, 'Documents')
process.env.KYBERNOS_CLOUD_API = 'http://127.0.0.1:' + apiServer.address().port
process.env.KYBERNOS_CLOUD_STATE = statePath
process.env.KYBERNOS_DOCUMENTS_DIR = DOCS
process.env.DSH_HOME = dir
process.env.HOME = dir
process.env.KYBERNOS_SERVERS_FILE = join(dir, 'servers.json')
delete process.env.KYBERNOS_TEAM_ID
const writeState = (extra = {}) => writeFileSync(statePath, JSON.stringify({ token: TOKEN, api: process.env.KYBERNOS_CLOUD_API, user: { id: 'u-1', name: 'Ada', email: 'ada@example.test' }, workspaces: SPACES, ...extra }), { mode: 0o600 })
const readState = () => JSON.parse(readFileSync(statePath, 'utf8'))
writeState()
sessionSource.secret = () => SESSION_SECRET

// The engine, by hand: the plugin registers its listeners on this context, the test fires the events.
const routes = new Map()
const listeners = new Map()
const webServer = { register: (r) => { routes.set(r.path, r.handler); return () => routes.delete(r.path) } }
// DSH's `settings` service, for the section on a stale model route: `mutate` writes the provider route and, like DSH after its reload, the running route follows (`describe`).
let settingsOn = false
const settingsStore = {}
const fakeSettings = {
  async mutate(ns, ops) {
    for (const op of ops) {
      settingsStore[ns] = settingsStore[ns] || {}
      let node = settingsStore[ns]
      for (let i = 0; i < op.path.length - 1; i += 1) node = node[op.path[i]] = node[op.path[i]] || {}
      if (op.op === 'unset') delete node[op.path.at(-1)]
      else node[op.path.at(-1)] = JSON.parse(JSON.stringify(op.value))
    }
    return { ok: true }
  },
  describe: () => [{ ns: 'llm-pi-ai', value: { providers: JSON.parse(JSON.stringify((settingsStore['llm-pi-ai'] || {}).providers || {})) } }],
}
const liveRouteHeader = () => { const p = fakeSettings.describe()[0].value.providers.kybernos; return p === undefined ? undefined : (p.headers || {})['x-kybernos-workspace'] }
const ctx = {
  get: (name) => (name === 'webServer' ? webServer : (name === 'settings' && settingsOn === true ? fakeSettings : undefined)),
  inject: (_l, cb) => cb(ctx),
  effect: (fn) => fn(),
  on: (event, handler) => { if (!listeners.has(event)) listeners.set(event, []); listeners.get(event).push(handler); return () => {} },
  systemPrompt: { context: () => {}, section: () => {} },
  tools: { register: () => () => {} },
}
const mod = await import('./index.js')
mod.MEMORY_TUNING.writeRefreshMs = -1
mod.MEMORY_TUNING.tickMs = 3600000
if (mod.PROFILE_REFRESH_TUNING !== undefined) { mod.PROFILE_REFRESH_TUNING.firstMs = 3600000; mod.PROFILE_REFRESH_TUNING.tickMs = 3600000 }
mod.apply(ctx)

const server = http.createServer((req, res) => {
  const handler = routes.get(new URL(req.url, 'http://x').pathname)
  if (handler === undefined) { res.writeHead(404); res.end('{}'); return }
  Promise.resolve(handler(req, res)).catch(() => { res.writeHead(500); res.end('{}') })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const own = '127.0.0.1:' + port
const origin = 'http://' + own
const send = (path, headers, body) => new Promise((resolve) => {
  const payload = JSON.stringify(body)
  const req = http.request({ host: '127.0.0.1', port, path, method: 'POST', headers: { host: own, ...headers, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } }, (res) => {
    let text = ''
    res.on('data', (c) => { text += c })
    res.on('end', () => { let json = null; try { json = JSON.parse(text) } catch (e) { json = null } resolve({ status: res.statusCode, text, json }) })
  })
  req.on('error', () => resolve({ status: 0, text: '', json: null }))
  req.write(payload)
  req.end()
})
const post = (path, body, headers) => send('/kybernos-cloud/' + path, headers === undefined ? { origin, cookie: sessionCookie(own) } : headers, body)

// ── the engine's events, fired by hand ────────────────────────────────────────────────────────────────────────────────────────────────────────
const agentIn = (sid, cwd, extra = {}) => ({ id: sid, session: { id: sid, header: { cwd, ...extra } } })
const fire = (event, payload) => { for (const h of listeners.get(event) || []) h(payload) }
/** The pre-step waterfall: the plugin's listener gets `next`, and `trace` says when `next` was reached. */
const preStep = async (agent, turn, step, trace) => {
  const handler = (listeners.get('agent/pre-step') || [])[0]
  assert.ok(handler !== undefined, 'the plugin registered a pre-step listener')
  return handler({ agent, turn, step, messages: [], signal: new AbortController().signal }, async () => { trace.push('next'); return { kind: 'enter', messages: [] } })
}
const active = () => (readState().active_workspace_id === undefined ? null : readState().active_workspace_id)

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

try {
  // 1. What is gone: a DSH does not follow a chat, and no reply can block a switch.
  console.log('a DSH serves one space: nothing follows a chat any more')
  assert.equal(routes.has('/kybernos-cloud/space/for-folder'), false)
  assert.equal(routes.has('/kybernos-cloud/space/busy'), false)
  assert.equal((await post('space/for-folder', { path: dir })).status, 404)
  // The claim of a turn in a team's folder (the engine's event, with a chat that stands in it) moves nothing: Personal stays active, and no request is made.
  const callsAtStart = api.calls.length
  fire('agent/inbox/claimed', { agent: agentIn('session-in-team-folder', join(DOCS, 'Kybernos', 'Acme')), turn: 1, message: {} })
  fire('agent/status', { agent: agentIn('session-in-team-folder', join(DOCS, 'Kybernos', 'Acme')), status: 'running' })
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(readState().active_workspace_id, undefined, 'no choice was written: the DSH still serves Personal')
  assert.equal(api.calls.length, callsAtStart, 'and nothing was asked of the server')
  ok('`space/for-folder` and `space/busy` are not served, and the claim of a turn in a team\'s folder moves nothing')

  // 2. Reading and switching the space this DSH serves still works, and never waits on a reply.
  let r = await post('space/active', { workspace_id: ACME.id })
  assert.equal(r.json.ok, true, JSON.stringify(r.json).slice(0, 200))
  assert.equal(active(), ACME.id)
  r = await post('space/active', { workspace_id: PERSONAL.id })
  assert.equal(r.json.ok, true)
  assert.equal((await post('space/active', { workspace_id: 'not-a-space' })).json.error, 'espace_inconnu')
  ok('`space/active` still chooses a known space (no answer is `turn_running` any more) and refuses an unknown one')

  // 3. Creating a team lists it and gives it a folder, but the DSH stays where it is: the team has a DSH of its own, which the page opens.
  SPACES.push(MADE)
  r = await post('space/create', { name: MADE.name })
  assert.equal(r.json.ok, true, JSON.stringify(r.json).slice(0, 200))
  assert.deepEqual({ id: r.json.created.id, activated: r.json.created.activated, busy: r.json.created.busy }, { id: MADE.id, activated: true, busy: undefined })
  assert.equal(active(), PERSONAL.id, 'this DSH stays on the space it serves')
  assert.equal(readState().workspaces.some((w) => w.id === MADE.id), true, 'the team is listed')
  SPACES.push(PLANLESS)
  r = await post('space/create', { name: PLANLESS.name })
  assert.deepEqual({ ok: r.json.ok, activated: r.json.created.activated, plan: r.json.created.plan_key }, { ok: true, activated: false, plan: 'none' })
  assert.equal(active(), PERSONAL.id)
  SPACES.pop()
  SPACES.pop()
  writeState({ active_workspace_id: PERSONAL.id })
  ok('creating a team lists it and makes its folder but does not make it active here; one with no plan says `activated: false`')

  // 4. A profile refresh that is in flight (the server is slow) must not undo a switch made meanwhile: it read the state before, it writes it back after.
  writeState({ active_workspace_id: PERSONAL.id })
  api.listDelayMs = 500
  const refreshing = post('refresh', {})
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal((await post('space/active', { workspace_id: ACME.id })).json.ok, true)
  const refreshed = await refreshing
  api.listDelayMs = 0
  assert.equal(refreshed.json.ok, true, JSON.stringify(refreshed.json).slice(0, 200))
  assert.equal(active(), ACME.id, 'the refresh that finished AFTER the switch did not put the previous team back')
  assert.equal(readState().space_plan.workspace_id, ACME.id, 'nor its plan')
  ok('a profile refresh in flight does not undo a switch made while it waited (it used to write back the active team it had read before)')

  // 5. A catalogue import in flight (the server is slow; a switch ends with one) must not put back the list of teams it read before: a refresh that finished meanwhile wrote a longer one.
  writeState({ active_workspace_id: PERSONAL.id })
  const NOVA = { id: '44444444-4444-4444-8444-444444444444', name: 'Nova Labs', personal: false, role: 'member' }
  api.modelsDelayMs = 400
  api.modelsOnce = true
  const switching = post('space/active', { workspace_id: ACME.id })
  await new Promise((resolve) => setTimeout(resolve, 150))
  SPACES.push(NOVA)
  assert.equal((await post('refresh', {})).json.ok, true)
  assert.equal(readState().workspaces.length, 4, 'the refresh wrote the new team')
  assert.equal((await switching).json.ok, true)
  api.modelsDelayMs = 0
  api.modelsOnce = false
  assert.equal(readState().workspaces.some((w) => w.id === NOVA.id), true, 'the import that finished AFTER the refresh did not write back the list of teams it had read before')
  assert.equal(active(), ACME.id)
  SPACES.pop()
  writeState({ active_workspace_id: PERSONAL.id })
  ok('a catalogue import in flight does not put back the list of teams a refresh wrote while it waited')

  // 6. A switch made while the server does not answer (recette L3-76, decision DL-20). The choice is written, the model route could not be: it still names the previous team, and every
  // message would be billed to it. The next turn puts the route right first (the second press on the team, done for the person, bounded) and, if it cannot, is refused.
  settingsOn = true
  assert.equal((await post('space/active', { workspace_id: PERSONAL.id })).json.ok, true)
  assert.equal(liveRouteHeader(), PERSONAL.id, 'the running route names Personal')
  api.down = true
  const broken = await post('space/active', { workspace_id: ACME.id })
  assert.deepEqual({ ok: broken.json.ok, route: broken.json.route }, { ok: true, route: 'failed' })
  assert.equal(active(), ACME.id, 'the choice is kept')
  assert.equal(liveRouteHeader(), PERSONAL.id, 'but the route could not be rewritten: it names the previous team')
  const SB = 'session-acme-broken'
  const refusedTrace = []
  await assert.rejects(preStep(agentIn(SB, dir), 1, 1, refusedTrace), (e) => e.message === 'Your messages would be billed to Personal. Try again.', 'the turn is refused, with the sentence that names the team it would be billed to')
  assert.deepEqual(refusedTrace, [], 'no request went out')
  ok('the route still names the previous team and the server does not answer: the first request is refused with « Your messages would be billed to Personal. Try again. », nothing is sent')

  // The server is back: the next turn puts the route right BEFORE its request (no wait for the five-minute profile read) and goes ahead.
  api.down = false
  const mendedTrace = []
  await preStep(agentIn(SB, dir), 2, 1, mendedTrace)
  assert.deepEqual(mendedTrace, ['next'])
  assert.equal(liveRouteHeader(), ACME.id, 'the route was re-aligned at send: it names the team this DSH serves')
  ok('the server is back: the next turn re-aligns the model route before its request and goes ahead (billed to the space this DSH serves)')

  // Once per turn: the later steps of a turn are not held again, the next turn is.
  assert.equal((await post('space/active', { workspace_id: PERSONAL.id })).json.route, 'written')
  const callsBefore = api.calls.length
  const stepTrace = []
  await preStep(agentIn(SB, dir), 2, 2, stepTrace)
  assert.deepEqual(stepTrace, ['next'])
  assert.equal(api.calls.length, callsBefore, 'a later step of the same turn asks the server nothing')
  api.down = true
  assert.equal((await post('space/active', { workspace_id: ACME.id })).json.route, 'failed')
  const callsDown = api.calls.length
  const sameTurn = []
  await preStep(agentIn(SB, dir), 2, 3, sameTurn)
  assert.deepEqual(sameTurn, ['next'], 'the turn that was let through is not refused half way')
  assert.equal(api.calls.length, callsDown, 'and not looked at again')
  const nextTurn = []
  await assert.rejects(preStep(agentIn(SB, dir), 3, 1, nextTurn), (e) => e.message === 'Your messages would be billed to Personal. Try again.')
  assert.deepEqual(nextTurn, [])
  fire('agent/disposed', { agent: agentIn(SB, dir) })
  api.down = false
  assert.equal((await post('space/active', { workspace_id: ACME.id })).json.route, 'written')
  ok('the hold is made once per turn: a later step of the same turn goes ahead, the next turn is looked at again')

  // The host tries again by itself, at 10 s, 30 s and 2 min after the failure (here scaled down), and stops once the route is right.
  const modelReads = () => api.calls.filter((c) => c === 'GET /v1/models').length
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  mod.ROUTE_REPAIR_TUNING.delaysMs = [80, 250, 500]
  api.down = false
  assert.equal((await post('space/active', { workspace_id: PERSONAL.id })).json.route, 'written')
  api.down = true
  assert.equal((await post('space/active', { workspace_id: ACME.id })).json.route, 'failed')
  assert.equal(liveRouteHeader(), PERSONAL.id)
  await wait(150)
  assert.equal(liveRouteHeader(), PERSONAL.id, 'the first try (the server is still down) mends nothing')
  api.down = false
  await wait(450)
  assert.equal(liveRouteHeader(), ACME.id, 'the second try, the server being back, re-aligned the route with nobody sending anything')
  const readsMended = modelReads()
  await wait(600)
  assert.equal(modelReads(), readsMended, 'and the tries stopped once the route was right')
  ok('after a failed switch the host tries again by itself (10 s, 30 s, 2 min, scaled down here) and stops as soon as the route names the active team')

  // A server that stays down: three tries after the failure, then nothing more (bounded), and the choice is still kept.
  api.down = false
  assert.equal((await post('space/active', { workspace_id: PERSONAL.id })).json.route, 'written')
  api.down = true
  const readsBefore = modelReads()
  assert.equal((await post('space/active', { workspace_id: ACME.id })).json.route, 'failed')
  await wait(900)
  assert.equal(modelReads() - readsBefore, 4, 'the failed switch itself, then three tries')
  await wait(300)
  assert.equal(modelReads() - readsBefore, 4, 'and no fifth: the tries are bounded')
  assert.equal(active(), ACME.id)
  api.down = false
  mod.ROUTE_REPAIR_TUNING.delaysMs = [10000, 30000, 120000]
  ok('a server that stays down gets three tries after the failure and no more')
  settingsOn = false

  // 7. What is not what the engine sends breaks nothing.
  for (const junk of [{}, { agent: null }, { agent: {} }, { agent: { session: null } }, { agent: { session: { id: 'session-x-123' } }, turn: 1 }]) {
    await (listeners.get('agent/pre-step') || [])[0](junk, async () => ({ kind: 'enter', messages: [] }))
  }
  assert.deepEqual(await (listeners.get('agent/pre-step') || [])[0](undefined, async () => ({ kind: 'enter', messages: [] })), { kind: 'enter', messages: [] })
  ok('events that are not what the engine sends break nothing, and the step still goes ahead')

  // 8. Not connected: nothing to hold.
  rmSync(statePath)
  const signedOut = []
  await preStep(agentIn('session-signed-out', dir), 1, 1, signedOut)
  assert.deepEqual(signedOut, ['next'])
  assert.deepEqual((await post('space/active', { workspace_id: ACME.id })).json, { ok: false, error: 'non_connecte' })
  ok('signed out: the route says so and a turn is not held')

  console.log('\n' + pass + ' verifications OK')
} finally {
  apiServer.close()
  server.close()
  rmSync(dir, { recursive: true, force: true })
}
process.exit(0)
