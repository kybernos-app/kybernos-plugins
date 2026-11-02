// No switch of the team under a running reply: the host half (teams plan, option 2, part B).
//   node packages/kybernos-cloud/test-turn-guard-host.mjs
//
// A REAL HTTP server carries the plugin's routes, a fake Kybernos API answers, and the engine is played by hand (the listeners the plugin registered get the events the engine fires,
// and `ctx.agents` is a fake registry). What is proven: while a reply is running `space/active` is REFUSED with `turn_running` (who is running, since when, in which team) and nothing
// is written, whoever asks (a click, the page following a chat, a script); a switch to the space that is already active is not a switch; the refusal ends with the reply (`idle`, or
// the chat's disposal); the engine's registry corrects the events (a missed `idle` cannot leave a reply stuck, a missed start is found); a reply older than the bound no longer blocks
// (fail open); `space/busy` tells the page when to try again; the claim-time switch of part A does not run while ANOTHER reply is running, and does not count the claiming turn itself;
// a team created while a reply runs is created but does not take over.
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionSource } from './session-guard.mjs'
import { SESSION_SECRET, sessionCookie } from './lib-session-test.mjs'

const TOKEN = 'kys-' + 'f'.repeat(43)
const PERSONAL = { id: '11111111-1111-4111-8111-111111111111', name: 'My workspace', personal: true, role: 'owner' }
const ACME = { id: '22222222-2222-4222-8222-222222222222', name: 'Acme', personal: false, role: 'admin' }
const STUDIO = { id: '33333333-3333-4333-8333-333333333333', name: 'Studio B', personal: false, role: 'member' }
const SPACES = [PERSONAL, ACME, STUDIO]

const api = { calls: [], spaces: SPACES.slice() }
const apiServer = http.createServer((req, res) => {
  let text = ''
  req.on('data', (c) => { text += c })
  req.on('end', () => {
    const path = new URL(req.url, 'http://x').pathname
    api.calls.push(req.method + ' ' + path)
    const reply = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
    if (req.method === 'POST' && path === '/v1/workspaces') {
      const made = { id: '66666666-6666-4666-8666-666666666666', name: JSON.parse(text || '{}').name, personal: false, role: 'owner' }
      api.spaces = api.spaces.concat([made])
      return reply(201, made)
    }
    if (req.method === 'GET' && path === '/v1/workspaces') return reply(200, { workspaces: api.spaces })
    if (req.method === 'GET' && /^\/v1\/workspaces\/[^/]+\/plan$/.test(path)) return reply(200, { plan: { key: 'team', name: 'Team', kind: 'team' }, level: '1-5 seats', status: 'active' })
    return reply(404, { error: 'not_found' })
  })
})
await new Promise((resolve) => apiServer.listen(0, '127.0.0.1', resolve))

const dir = mkdtempSync(join(tmpdir(), 'kybernos-cloud-turn-guard-'))
const statePath = join(dir, 'kybernos-cloud.json')
const DOCS = join(dir, 'Documents')
const ROOT = join(DOCS, 'Kybernos')
process.env.KYBERNOS_CLOUD_API = 'http://127.0.0.1:' + apiServer.address().port
process.env.KYBERNOS_CLOUD_STATE = statePath
process.env.KYBERNOS_DOCUMENTS_DIR = DOCS
process.env.DSH_HOME = dir
process.env.HOME = dir
process.env.KYBERNOS_SERVERS_FILE = join(dir, 'servers.json')
const writeState = (extra = {}) => writeFileSync(statePath, JSON.stringify({ token: TOKEN, api: process.env.KYBERNOS_CLOUD_API, user: { id: 'u-1', name: 'Ada', email: 'ada@example.test' }, workspaces: api.spaces, ...extra }), { mode: 0o600 })
const readState = () => JSON.parse(readFileSync(statePath, 'utf8'))
const stateBytes = () => readFileSync(statePath, 'utf8')
writeState()
sessionSource.secret = () => SESSION_SECRET

// The engine, by hand. `registry` is the fake `ctx.agents`: what is really running, by agent id.
const routes = new Map()
const listeners = new Map()
const registry = { running: new Set(), list() { return Array.from(registry.running).map((id) => ({ id, status: 'running' })).concat([{ id: 'idle-one', status: 'idle' }]) } }
let registryOn = true
const webServer = { register: (r) => { routes.set(r.path, r.handler); return () => routes.delete(r.path) } }
const ctx = {
  get: (name) => (name === 'webServer' ? webServer : (name === 'agents' && registryOn ? registry : undefined)),
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
const call = (method, path, headers, body) => new Promise((resolve) => {
  const payload = body === undefined ? null : JSON.stringify(body)
  const req = http.request({ host: '127.0.0.1', port, path, method, headers: { host: own, ...headers, ...(payload !== null ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}) } }, (res) => {
    let text = ''
    res.on('data', (c) => { text += c })
    res.on('end', () => { let json = null; try { json = JSON.parse(text) } catch (e) { json = null } resolve({ status: res.statusCode, text, json }) })
  })
  req.on('error', () => resolve({ status: 0, text: '', json: null }))
  if (payload !== null) req.write(payload)
  req.end()
})
const browser = { origin, cookie: sessionCookie(own) }
const post = (path, body) => call('POST', '/kybernos-cloud/' + path, browser, body)
const get = (path) => call('GET', '/kybernos-cloud/' + path, { origin })

const agentIn = (sid, cwd) => ({ id: sid, session: { id: sid, header: { cwd } } })
const fire = (event, payload) => { for (const h of listeners.get(event) || []) h(payload) }
/** The engine starts a reply in `sid`: `agent/status` running (before the claim), and the registry says so. */
const startReply = (sid) => { registry.running.add(sid); fire('agent/status', { agent: agentIn(sid, '/x'), status: 'running' }) }
const endReply = (sid) => { registry.running.delete(sid); fire('agent/status', { agent: agentIn(sid, '/x'), status: 'idle' }) }
const active = () => (readState().active_workspace_id === undefined ? null : readState().active_workspace_id)

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const realNow = Date.now

try {
  assert.equal((await post('space/active', { workspace_id: ACME.id })).json.ok, true)
  assert.equal((await post('space/active', { workspace_id: PERSONAL.id })).json.ok, true)
  const acme = join(ROOT, 'Acme')
  mkdirSync(join(acme, 'docs'), { recursive: true })

  console.log('Nothing running: a switch works')
  let r = await get('space/busy')
  assert.deepEqual(r.json, { ok: true, busy: false })
  r = await post('space/active', { workspace_id: ACME.id })
  assert.equal(r.json.ok, true)
  assert.equal(active(), ACME.id)
  ok('with no reply running the switch is made, and space/busy says nobody is busy')

  console.log('A reply is running: the switch is refused')
  startReply('session-one-1')
  const before = stateBytes()
  const callsBefore = api.calls.length
  r = await post('space/active', { workspace_id: STUDIO.id })
  assert.equal(r.status, 200)
  assert.equal(r.json.ok, false)
  assert.equal(r.json.error, 'turn_running')
  assert.equal(r.json.running.count, 1)
  assert.equal(r.json.running.space_id, ACME.id, 'the reply is billed to the team that was active when it started')
  assert.equal(r.json.running.space_name, 'Acme')
  assert.equal(typeof r.json.running.since, 'number')
  assert.equal(stateBytes(), before, 'nothing was written')
  assert.equal(api.calls.length, callsBefore, 'no plan read, no folder, no model route: the refusal comes first')
  ok('space/active answers `turn_running` with who is running (the count, the team the reply is billed to, since when), writes nothing and asks the server nothing')
  r = await get('space/busy')
  assert.equal(r.json.busy, true)
  assert.equal(r.json.running.space_name, 'Acme')
  ok('space/busy says so too, with the same facts (the page that deferred a switch asks it)')
  r = await post('space/active', { workspace_id: ACME.id })
  assert.equal(r.json.ok, true)
  ok('choosing the space that is ALREADY active is not a switch: it is not refused')
  r = await post('space/active', { workspace_id: 'nope' })
  assert.equal(r.json.error, 'espace_inconnu')
  ok('an unknown space is still refused for what it is, not for the running reply')
  r = await post('space/active', { workspace_id: PERSONAL.id })
  assert.equal(r.json.error, 'turn_running')
  ok('a switch to Personal is refused like any other')

  console.log('The refusal ends with the reply')
  endReply('session-one-1')
  r = await post('space/active', { workspace_id: STUDIO.id })
  assert.equal(r.json.ok, true)
  assert.equal(active(), STUDIO.id)
  ok('`idle` ends it: the switch goes through')
  startReply('session-one-2')
  assert.equal((await post('space/active', { workspace_id: ACME.id })).json.error, 'turn_running')
  assert.equal(r.json.state.active_workspace_id, STUDIO.id)
  fire('agent/disposed', { agent: agentIn('session-one-2', '/x') })
  registry.running.delete('session-one-2')
  assert.equal((await post('space/active', { workspace_id: ACME.id })).json.ok, true)
  ok('a chat that is closed (disposed) while its reply runs frees the switch too')

  console.log('Several replies')
  startReply('session-a-1')
  startReply('session-b-1')
  r = await post('space/active', { workspace_id: PERSONAL.id })
  assert.equal(r.json.running.count, 2)
  endReply('session-a-1')
  assert.equal((await post('space/active', { workspace_id: PERSONAL.id })).json.running.count, 1)
  endReply('session-b-1')
  assert.equal((await post('space/active', { workspace_id: PERSONAL.id })).json.ok, true)
  ok('two replies count as two, and the switch waits for the LAST one')

  console.log('The engine\'s registry corrects the events')
  startReply('session-missed-1')
  registry.running.delete('session-missed-1') // the engine went idle; its `idle` event never reached the plugin
  assert.equal((await get('space/busy')).json.busy, false)
  assert.equal((await post('space/active', { workspace_id: ACME.id })).json.ok, true)
  ok('a MISSED `idle` event cannot leave a reply stuck as running: the registry says it is not')
  registry.running.add('session-nostart-1') // running in the engine, no `running` event seen (the plugin was reloaded mid-reply)
  r = await post('space/active', { workspace_id: PERSONAL.id })
  assert.equal(r.json.error, 'turn_running')
  assert.equal(r.json.running.space_id, null)
  assert.equal(r.json.running.space_name, null)
  ok('a reply the plugin never saw start is found in the registry (its team unknown: the page then names none)')
  registry.running.delete('session-nostart-1')
  assert.equal((await get('space/busy')).json.busy, false, 'the registry lets it go again')
  registryOn = false
  startReply('session-noreg-1')
  assert.equal((await post('space/active', { workspace_id: PERSONAL.id })).json.error, 'turn_running')
  endReply('session-noreg-1')
  assert.equal((await post('space/active', { workspace_id: PERSONAL.id })).json.ok, true)
  registryOn = true
  ok('without a registry the events alone decide')

  console.log('The bound: past it a reply no longer blocks')
  assert.equal((await post('space/active', { workspace_id: ACME.id })).json.ok, true)
  const t0 = realNow()
  startReply('session-long-1')
  assert.equal((await post('space/active', { workspace_id: PERSONAL.id })).json.error, 'turn_running')
  Date.now = () => t0 + 31 * 60 * 1000
  assert.equal((await get('space/busy')).json.busy, false, 'the page that waits is told it can go')
  r = await post('space/active', { workspace_id: PERSONAL.id })
  Date.now = realNow
  assert.equal(r.json.ok, true, 'thirty-one minutes later the reply no longer blocks (fail open, on purpose)')
  registry.running.delete('session-long-1')
  ok('after thirty minutes a reply that is still "running" stops blocking: the person is never held for good by a counter that is wrong')

  console.log('Claim time (part A) and a running reply')
  assert.equal((await post('space/active', { workspace_id: PERSONAL.id })).json.ok, true)
  const S1 = 'session-follow-1'
  await post('space/for-folder', { path: acme, session_id: S1 })
  // Its own turn is running (the engine says `running` before the claim): that alone must not stop the switch.
  startReply(S1)
  fire('agent/inbox/claimed', { agent: agentIn(S1, join(acme, 'docs')), turn: 1, message: {} })
  assert.equal(active(), ACME.id)
  const preStep = (listeners.get('agent/pre-step') || [])[0]
  const trace = []
  await preStep({ agent: agentIn(S1, join(acme, 'docs')), turn: 1, step: 1 }, async () => { trace.push('next'); return { kind: 'enter', messages: [] } })
  assert.deepEqual(trace, ['next'])
  assert.equal(readState().space_plan.workspace_id, ACME.id)
  ok('the claim-time switch does not count the claiming turn itself: it switches and holds the first request')
  const claimed = await get('space/busy')
  assert.equal(claimed.json.running.space_id, ACME.id, 'the reply is billed to the chat\'s team (it was counted as started under Personal, before the claim switched it)')
  ok('and the reply the refusal names is the team it is billed to after that switch, not the one before')
  endReply(S1)

  assert.equal((await post('space/active', { workspace_id: PERSONAL.id })).json.ok, true)
  const S2 = 'session-follow-2'
  await post('space/for-folder', { path: acme, session_id: S2 })
  startReply('session-other-1') // another reply is running (a chat in the background)
  startReply(S2)
  fire('agent/inbox/claimed', { agent: agentIn(S2, join(acme, 'docs')), turn: 1, message: {} })
  assert.equal(active(), PERSONAL.id, 'no switch: it would bill the other reply to two teams')
  const calls2 = api.calls.length
  await preStep({ agent: agentIn(S2, join(acme, 'docs')), turn: 1, step: 1 }, async () => ({ kind: 'enter', messages: [] }))
  assert.equal(active(), PERSONAL.id)
  assert.equal(api.calls.length, calls2, 'nothing was asked of the server')
  ok('with ANOTHER reply running the claim-time switch does not happen: the turn goes ahead, billed to the active team (the exposure the page tells about)')
  endReply(S2)
  endReply('session-other-1')

  console.log('A team that is created while a reply runs')
  startReply('session-create-1')
  r = await post('space/create', { name: 'Fresh Co' })
  assert.equal(r.json.ok, true)
  assert.equal(r.json.created.activated, false)
  assert.equal(r.json.created.busy.count, 1)
  assert.equal(active(), PERSONAL.id, 'the person stays where they were')
  assert.ok(r.json.state.workspaces.some((w) => w.name === 'Fresh Co'), 'but the team is created and listed')
  ok('a team created while a reply runs is created and listed but does not take over: the answer says `activated: false` and `busy`')
  endReply('session-create-1')
  r = await post('space/active', { workspace_id: '66666666-6666-4666-8666-666666666666' })
  assert.equal(r.json.ok, true)
  ok('and the person switches to it once the reply is done')

  console.log('Every caller of the switch is covered')
  startReply('session-guard-1')
  const both = await Promise.all([post('space/active', { workspace_id: PERSONAL.id }), post('space/active', { workspace_id: STUDIO.id })])
  assert.deepEqual(both.map((x) => x.json.error), ['turn_running', 'turn_running'])
  ok('two windows asking at once both meet the refusal: it is made by the host\'s switch, not by the page')
  const noOrigin = await call('POST', '/kybernos-cloud/space/active', { cookie: sessionCookie(own) }, { workspace_id: PERSONAL.id })
  assert.equal(noOrigin.status, 403)
  ok('a call with no Origin never reaches the switch (the route guard of the origin rule comes first, unchanged)')
  endReply('session-guard-1')

  console.log('\n' + pass + ' verifications OK')
} finally {
  Date.now = realNow
  apiServer.close()
  server.close()
  rmSync(dir, { recursive: true, force: true })
}
process.exit(0)
