// The active team follows the chat: the host half (teams plan, option 2).
//   node packages/kybernos-cloud/test-chat-space-host.mjs
//
// A REAL HTTP server carries the plugin's routes, a fake Kybernos API answers, Documents is a throw-away folder, and the engine is played by hand: the test fires the same events
// the engine fires (`agent/inbox/claimed`, then the `agent/pre-step` waterfall) at the listeners the plugin registered. What is proven: `space/for-folder` names the space that
// owns a chat's folder (the team folder, a subfolder, a sibling with the same prefix, any other folder, Kaby's, a path that is no path) and says whether that is the active one;
// the first claim of a turn of a chat the page reported switches the active space BEFORE the step is assembled (the personal-memory cut reads it there) and the first request is
// held until the switch is through; a chat the page never reported (an automation, Kaby's, a Telegram turn, a subagent) changes nothing; the check runs once per turn; two switches
// at once end in one place; a payload that is not what the engine sends breaks nothing.
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionSource } from './session-guard.mjs'
import { SESSION_SECRET, sessionCookie } from './lib-session-test.mjs'

const TOKEN = 'kys-' + 'f'.repeat(43)
const PERSONAL = { id: '11111111-1111-4111-8111-111111111111', name: 'My workspace', personal: true, role: 'owner' }
const ACME = { id: '22222222-2222-4222-8222-222222222222', name: 'Acme', personal: false, role: 'admin' }
const STUDIO = { id: '33333333-3333-4333-8333-333333333333', name: 'Studio B', personal: false, role: 'member' }
const SPACES = [PERSONAL, ACME, STUDIO]

const api = { calls: [], planDelayMs: 0, listDelayMs: 0, modelsDelayMs: 0 }
const apiServer = http.createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname
  api.calls.push(req.method + ' ' + path)
  const reply = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
  if (req.method === 'GET' && path === '/v1/workspaces') return api.listDelayMs > 0 ? setTimeout(() => reply(200, { workspaces: SPACES }), api.listDelayMs) : reply(200, { workspaces: SPACES })
  if (req.method === 'GET' && /^\/v1\/workspaces\/[^/]+\/plan$/.test(path)) {
    const answer = () => reply(200, { plan: { key: 'team', name: 'Team', kind: 'team' }, level: '1-5 seats', status: 'active' })
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

const dir = mkdtempSync(join(tmpdir(), 'kybernos-cloud-chat-space-'))
const statePath = join(dir, 'kybernos-cloud.json')
const DOCS = join(dir, 'Documents')
const ROOT = join(DOCS, 'Kybernos')
process.env.KYBERNOS_CLOUD_API = 'http://127.0.0.1:' + apiServer.address().port
process.env.KYBERNOS_CLOUD_STATE = statePath
process.env.KYBERNOS_DOCUMENTS_DIR = DOCS
process.env.DSH_HOME = dir
process.env.HOME = dir
process.env.KYBERNOS_SERVERS_FILE = join(dir, 'servers.json')
const writeState = (extra = {}) => writeFileSync(statePath, JSON.stringify({ token: TOKEN, api: process.env.KYBERNOS_CLOUD_API, user: { id: 'u-1', name: 'Ada', email: 'ada@example.test' }, workspaces: SPACES, ...extra }), { mode: 0o600 })
const readState = () => JSON.parse(readFileSync(statePath, 'utf8'))
writeState()
sessionSource.secret = () => SESSION_SECRET

// The engine, by hand: the plugin registers its listeners on this context, the test fires the events.
const routes = new Map()
const listeners = new Map()
const webServer = { register: (r) => { routes.set(r.path, r.handler); return () => routes.delete(r.path) } }
const ctx = {
  get: (name) => (name === 'webServer' ? webServer : undefined),
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
  // The folders of the teams are made by a switch (step 6); the folders file is the host's record of which they are.
  for (const space of [ACME, STUDIO, PERSONAL]) assert.equal((await post('space/active', { workspace_id: space.id })).json.ok, true)
  const acme = join(ROOT, 'Acme')
  const studio = join(ROOT, 'Studio B')
  mkdirSync(join(acme, 'docs', 'deep'), { recursive: true })
  mkdirSync(join(ROOT, 'Acme-2'), { recursive: true })
  mkdirSync(join(dir, 'work'), { recursive: true })
  symlinkSync(acme, join(dir, 'shortcut'))

  console.log('space/for-folder: which space owns a chat\'s folder')
  let r = await post('space/for-folder', { path: acme })
  assert.equal(r.status, 200)
  assert.deepEqual({ ok: r.json.ok, kind: r.json.kind, id: r.json.space_id, name: r.json.space_name, active: r.json.active_id, follow: r.json.follow }, { ok: true, kind: 'team', id: ACME.id, name: 'Acme', active: PERSONAL.id, follow: true })
  ok('a chat in the team\'s folder belongs to the team; Personal is active, so the page should follow')
  r = await post('space/for-folder', { path: join(acme, 'docs', 'deep') })
  assert.equal(r.json.space_id, ACME.id)
  ok('a chat in a subfolder of the team\'s folder belongs to the team')
  r = await post('space/for-folder', { path: join(ROOT, 'Acme-2') })
  assert.deepEqual({ kind: r.json.kind, id: r.json.space_id, follow: r.json.follow }, { kind: 'personal', id: PERSONAL.id, follow: false })
  ok('a sibling folder with the same prefix (Acme-2) is Personal, and nothing follows it while Personal is active')
  r = await post('space/for-folder', { path: join(dir, 'work') })
  assert.equal(r.json.kind, 'personal')
  ok('any other folder is Personal')
  r = await post('space/for-folder', { path: join(dir, '.dsh', 'kybernos', 'kyby') })
  assert.equal(r.json.kind, 'personal')
  ok('Kaby\'s own folder is Personal (it does not even have to exist)')
  r = await post('space/for-folder', { path: join(dir, 'shortcut', 'docs') })
  assert.equal(r.json.space_id, ACME.id)
  ok('a chat reached through a symbolic link into the team\'s folder belongs to the team')
  r = await post('space/for-folder', { path: join(acme, 'removed', 'x') })
  assert.equal(r.json.space_id, ACME.id)
  ok('a folder that was deleted under the team\'s folder still belongs to the team')
  r = await post('space/for-folder', { path: 'work/app' })
  assert.deepEqual({ ok: r.json.ok, kind: r.json.kind, id: r.json.space_id, follow: r.json.follow }, { ok: true, kind: 'unknown', id: null, follow: false })
  ok('a path that is no absolute path names no space: nothing follows it')
  for (const bad of [{}, { path: '' }, { path: 7 }, { path: 'x'.repeat(5000) }]) {
    r = await post('space/for-folder', bad)
    assert.deepEqual({ ok: r.json.ok, error: r.json.error }, { ok: false, error: 'path_missing' }, JSON.stringify(bad).slice(0, 40))
  }
  ok('a missing, empty, non-string or enormous path is refused with one code')

  assert.equal((await post('space/active', { workspace_id: ACME.id })).json.ok, true)
  r = await post('space/for-folder', { path: acme })
  assert.equal(r.json.follow, false)
  r = await post('space/for-folder', { path: join(dir, 'work') })
  assert.deepEqual({ id: r.json.space_id, follow: r.json.follow }, { id: PERSONAL.id, follow: true })
  ok('with a team active: its own chat needs no switch, a personal chat asks for Personal')
  assert.equal((await post('space/active', { workspace_id: PERSONAL.id })).json.ok, true)

  r = await post('space/for-folder', { path: acme }, { origin: 'http://evil.example' })
  assert.equal(r.status, 403)
  ok('a foreign Origin is refused like every route')

  console.log('Claim time: the first request waits for the chat\'s team')
  const trace = []
  // 1. A chat the page reported, in the team's folder, claimed while Personal is active.
  const S1 = 'session-acme-1'
  await post('space/for-folder', { path: acme, session_id: S1 })
  assert.equal(active(), PERSONAL.id)
  fire('agent/inbox/claimed', { agent: agentIn(S1, join(acme, 'docs')), turn: 1, message: {} })
  assert.equal(active(), ACME.id, 'the active space was written synchronously by the claim: the system prompt assembled right after it reads it')
  ok('the claim of a turn of a reported team chat makes the team active at once (before the step is assembled)')
  await preStep(agentIn(S1, join(acme, 'docs')), 1, 1, trace)
  assert.deepEqual(trace, ['next'])
  assert.equal(readState().space_plan.workspace_id, ACME.id, 'the rest of the switch (plan, folder, model route) was done before the request')
  assert.ok(api.calls.includes('GET /v1/workspaces/' + ACME.id + '/plan'))
  ok('and the first request is held until the switch (plan, folder, model route) is through')

  // 2. The same turn again: nothing is checked twice; a switch by hand is not undone mid-turn.
  writeState({ active_workspace_id: PERSONAL.id })
  fire('agent/inbox/claimed', { agent: agentIn(S1, join(acme, 'docs')), turn: 1, message: {} })
  await preStep(agentIn(S1, join(acme, 'docs')), 1, 2, trace)
  assert.equal(active(), PERSONAL.id)
  ok('a second claim or step of the same turn changes nothing')
  fire('agent/inbox/claimed', { agent: agentIn(S1, join(acme, 'docs')), turn: 2, message: {} })
  assert.equal(active(), ACME.id)
  ok('the next turn of the chat is checked again')
  await preStep(agentIn(S1, join(acme, 'docs')), 2, 1, [])

  // 3. A chat in a personal folder, reported, claimed while a team is active: Personal.
  const S2 = 'session-work-1'
  await post('space/for-folder', { path: join(dir, 'work'), session_id: S2 })
  fire('agent/inbox/claimed', { agent: agentIn(S2, join(dir, 'work')), turn: 1, message: {} })
  assert.equal(active(), PERSONAL.id)
  await preStep(agentIn(S2, join(dir, 'work')), 1, 1, [])
  ok('a reported chat in any other folder claimed while a team is active goes back to Personal')

  // 4. Nothing else is touched: an automation, Kaby, a Telegram turn, a subagent — chats the page never reported.
  writeState({ active_workspace_id: STUDIO.id })
  for (const [who, agent] of [['an automation', agentIn('session-auto-1', acme)], ['Kaby\'s chat', agentIn('session-kaby-1', join(dir, '.dsh', 'kybernos', 'kyby'))], ['a subagent', agentIn('session-sub-1', acme, { origin: 'subagent', parentSession: S1 })]]) {
    fire('agent/inbox/claimed', { agent, turn: 1, message: {} })
    await preStep(agent, 1, 1, [])
    assert.equal(active(), STUDIO.id, who + ' does not change the active team')
  }
  ok('a turn of a chat the page never reported (automation, Kaby, subagent) changes nothing: it is billed to whichever team is active')

  // 5. A chat whose folder belongs to the team that is already active: nothing to do.
  const S3 = 'session-studio-1'
  mkdirSync(join(studio, 'x'), { recursive: true })
  await post('space/for-folder', { path: studio, session_id: S3 })
  const callsBefore = api.calls.length
  fire('agent/inbox/claimed', { agent: agentIn(S3, join(studio, 'x')), turn: 1, message: {} })
  await preStep(agentIn(S3, join(studio, 'x')), 1, 1, [])
  assert.equal(active(), STUDIO.id)
  assert.equal(api.calls.length, callsBefore, 'no call to the server: nothing to switch')
  ok('a chat of the team that is already active: no switch, no call')

  // 6. The first request waits for a slow switch, then goes.
  writeState({ active_workspace_id: PERSONAL.id })
  api.planDelayMs = 400
  const S4 = 'session-acme-slow'
  await post('space/for-folder', { path: acme, session_id: S4 })
  fire('agent/inbox/claimed', { agent: agentIn(S4, acme), turn: 1, message: {} })
  const slowTrace = []
  const t0 = Date.now()
  await preStep(agentIn(S4, acme), 1, 1, slowTrace)
  assert.ok(Date.now() - t0 >= 380, 'the step waited for the plan read of the switch: ' + (Date.now() - t0) + ' ms')
  assert.deepEqual(slowTrace, ['next'])
  assert.equal(readState().space_plan.workspace_id, ACME.id)
  api.planDelayMs = 0
  ok('a slow switch holds the first request, which then goes ahead')

  // 6b. A switch that lands between the claim and the first request (a click or a script already on its way; J1 3b of the end-to-end journeys, Enter 2 ms after the switch started): the claim
  // saw the chat's team active and decided nothing, the switch then made another team active, and the request went out billed to it. The team is decided again just before the request.
  writeState({ active_workspace_id: ACME.id })
  const S6 = 'session-acme-landing'
  await post('space/for-folder', { path: acme, session_id: S6 })
  fire('agent/inbox/claimed', { agent: agentIn(S6, acme), turn: 1, message: {} })
  assert.equal(active(), ACME.id, 'at the claim the chat\'s team is the active one: nothing to do')
  writeState({ active_workspace_id: STUDIO.id })
  const landTrace = []
  await preStep(agentIn(S6, acme), 1, 1, landTrace)
  assert.equal(active(), ACME.id, 'the switch that landed after the claim is put right before the first request')
  assert.deepEqual(landTrace, ['next'])
  assert.equal(readState().space_plan.workspace_id, ACME.id)
  // And only once per turn, and only for a chat the page reported: a later switch by hand is not undone.
  writeState({ active_workspace_id: STUDIO.id })
  await preStep(agentIn(S6, acme), 1, 2, [])
  assert.equal(active(), STUDIO.id, 'a second step of the turn changes nothing')
  fire('agent/inbox/claimed', { agent: agentIn('session-acme-unseen', acme), turn: 1, message: {} })
  writeState({ active_workspace_id: STUDIO.id })
  await preStep(agentIn('session-acme-unseen', acme), 1, 1, [])
  assert.equal(active(), STUDIO.id, 'a chat the page never reported is left alone')
  ok('a switch that lands between the claim and the first request is put right before the request (once per turn, reported chats only)')

  // 7. Two switches at once (the page\'s own and the claim-time one) end in one place.
  writeState({ active_workspace_id: PERSONAL.id })
  api.planDelayMs = 150
  const S5 = 'session-acme-race'
  await post('space/for-folder', { path: acme, session_id: S5 })
  const pageSwitch = post('space/active', { workspace_id: ACME.id })
  fire('agent/inbox/claimed', { agent: agentIn(S5, acme), turn: 1, message: {} })
  const held = preStep(agentIn(S5, acme), 1, 1, [])
  const both = await Promise.all([pageSwitch, held])
  assert.equal(both[0].json.ok, true)
  assert.equal(active(), ACME.id)
  assert.equal(readState().space_plan.workspace_id, ACME.id)
  api.planDelayMs = 0
  ok('the page\'s switch and the claim-time one, at once, end with the team active and its plan read')

  // 7b. A profile refresh that is in flight (the server is slow) must not undo a switch made meanwhile: it read the state before, it writes it back after.
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

  // 7c. A catalogue import in flight (the server is slow; a switch ends with one) must not put back the list of teams it read before: a refresh that finished meanwhile wrote a longer one.
  // Found with scripts/check-team-folder-live.mjs: the team the check had just added vanished from the menu (the row to click was not there) when a refresh fell inside a switch.
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

  // 8. What is not what the engine sends breaks nothing.
  for (const junk of [{}, { agent: null }, { agent: {} }, { agent: { session: null } }, { agent: { session: { id: 'session-x-123' } }, turn: 1 }]) {
    fire('agent/inbox/claimed', junk)
    await (listeners.get('agent/pre-step') || [])[0](junk, async () => ({ kind: 'enter', messages: [] }))
  }
  assert.deepEqual(await (listeners.get('agent/pre-step') || [])[0](undefined, async () => ({ kind: 'enter', messages: [] })), { kind: 'enter', messages: [] })
  ok('events that are not what the engine sends break nothing, and the step still goes ahead')

  // 9. Not connected: nothing.
  rmSync(statePath)
  fire('agent/inbox/claimed', { agent: agentIn(S1, acme), turn: 9, message: {} })
  assert.deepEqual((await post('space/for-folder', { path: acme })).json, { ok: false, error: 'non_connecte' })
  ok('signed out: the route says so and a claim does nothing')

  console.log('\n' + pass + ' verifications OK')
} finally {
  apiServer.close()
  server.close()
  rmSync(dir, { recursive: true, force: true })
}
process.exit(0)
