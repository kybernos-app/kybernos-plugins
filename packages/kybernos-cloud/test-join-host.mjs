// Joining a team with an invitation link: the host routes (plan « Équipes », step 4).
//   node packages/kybernos-cloud/test-join-host.mjs
//
// A REAL HTTP server carries the plugin's routes and a fake Kybernos API answers each case. What is proven, and not claimed:
//  · the invitation's token goes to the ACTIVE server's own API and nowhere else: a decoy server named in the request (as the host of a pasted link, as a base address) gets nothing;
//  · the token travels in the body of a POST, never in an address, and the preview carries no device token;
//  · the answer of the server for each case (preview 200, invalid / used / revoked / expired / someone else's = ONE 404, a full team = 409 seat_limit that leaves the state
//    alone, 429, a server that does not answer, a token that is refused) is one code the page maps to one sentence;
//  · an accepted invitation makes the new team appear in the list WITHOUT making it active (the page switches through the ordinary path), and says whether it has a plan;
//  · the words of someone else (a team's name, an inviter) come back as one bounded line; the token is never in an answer, a log or the state file;
//  · the guard: no Origin 403, foreign Origin 403, and `accept` also needs the signed session.
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionSource } from './session-guard.mjs'
import { OTHER_SECRET, SESSION_SECRET, sessionCookie } from './lib-session-test.mjs'

const INVITE = 'k3Zp9-Qw_7Lm2XvB0cR8sTnYh4JdUeA6oGfIiNaPqMc'
const TOKEN = 'kys-' + 'j'.repeat(43)
const PERSONAL = '11111111-1111-4111-8111-111111111111'
const TEAM = '22222222-2222-4222-8222-222222222222'
const LS = String.fromCharCode(0x2028)

// Every request the account's server received, and the answers the next ones get.
const api = { calls: [], preview: { status: 200, body: {} }, accept: { status: 200, body: {} }, workspaces: { status: 200, body: { workspaces: [] } }, plan: { status: 200, body: { plan: { key: 'team', name: 'Team', kind: 'team' }, level: '1-5 seats', status: 'active' } } }
const readBody = (req) => new Promise((resolve) => { let t = ''; req.on('data', (c) => { t += c }); req.on('end', () => resolve(t)) })
const apiServer = http.createServer(async (req, res) => {
  const text = await readBody(req)
  const path = new URL(req.url, 'http://x').pathname
  api.calls.push({ method: req.method, url: req.url, path, auth: req.headers.authorization || null, body: text })
  const reply = (r) => { res.writeHead(r.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(r.body)) }
  if (req.method === 'POST' && path === '/v1/invitations/preview') return reply(api.preview)
  if (req.method === 'POST' && path === '/v1/invitations/accept') return reply(api.accept)
  if (req.method === 'GET' && path === '/v1/workspaces') return reply(api.workspaces)
  if (req.method === 'GET' && /^\/v1\/workspaces\/[^/]+\/plan$/.test(path)) return reply(api.plan)
  return reply({ status: 404, body: { error: 'not_found' } })
})
await new Promise((resolve) => apiServer.listen(0, '127.0.0.1', resolve))
const apiPort = apiServer.address().port

// A host that came out of a pasted link: it must never hear of the token.
const decoy = { calls: 0 }
const decoyServer = http.createServer((req, res) => { decoy.calls += 1; req.resume(); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}') })
await new Promise((resolve) => decoyServer.listen(0, '127.0.0.1', resolve))
const decoyUrl = 'http://127.0.0.1:' + decoyServer.address().port

const dir = mkdtempSync(join(tmpdir(), 'kybernos-cloud-join-host-'))
const statePath = join(dir, 'kybernos-cloud.json')
process.env.KYBERNOS_CLOUD_API = 'http://127.0.0.1:' + apiPort
process.env.KYBERNOS_CLOUD_STATE = statePath
process.env.DSH_HOME = dir
process.env.HOME = dir
process.env.KYBERNOS_SERVERS_FILE = join(dir, 'servers.json')
const writeState = (extra = {}) => writeFileSync(statePath, JSON.stringify({ token: TOKEN, api: process.env.KYBERNOS_CLOUD_API, user: { id: 'u-1', name: 'Ada', email: 'ada@example.test' }, workspaces: [{ id: PERSONAL, name: 'Personal', personal: true, role: 'owner' }], ...extra }), { mode: 0o600 })
const readState = () => JSON.parse(readFileSync(statePath, 'utf8'))
writeState()
sessionSource.secret = () => SESSION_SECRET

// Everything the bundle prints: the token of the invitation must not be in it.
const printed = []
for (const level of ['log', 'error', 'warn']) { const orig = console[level].bind(console); console[level] = (...a) => { printed.push(a.map(String).join(' ')); orig(...a) } }

const routes = new Map()
const webServer = { register: (r) => { routes.set(r.path, r.handler); return () => routes.delete(r.path) } }
const ctx = { get: (name) => (name === 'webServer' ? webServer : undefined), inject: (_l, cb) => cb(ctx), effect: (fn) => { fn() }, on: () => {}, systemPrompt: { context: () => {} }, tools: { register: () => () => {} } }
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
const browser = () => ({ origin, cookie: sessionCookie(own) })

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
const preview = (body = { token: INVITE }) => send('/kybernos-cloud/invitation/preview', browser(), body)
const accept = (body = { token: INVITE }) => send('/kybernos-cloud/invitation/accept', browser(), body)
const callsTo = (path) => api.calls.filter((c) => c.path === path)

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

try {
  console.log('Preview')
  api.preview = { status: 200, body: { workspace_name: 'Acme', inviter_name: 'Ada Lovelace', email: 'ada@example.test', role: 'admin', expires_at: '2026-10-25T10:00:00.000Z' } }
  let r = await preview()
  assert.equal(r.status, 200)
  assert.deepEqual(r.json, { ok: true, preview: { team: 'Acme', inviter: 'Ada Lovelace', email: 'ada@example.test', role: 'admin', expires_at: '2026-10-25T10:00:00.000Z' } })
  const sent = callsTo('/v1/invitations/preview')[0]
  assert.equal(sent.method, 'POST')
  assert.deepEqual(JSON.parse(sent.body), { token: INVITE }, 'the token is the body, and only the token')
  assert.equal(sent.url, '/v1/invitations/preview', 'the token is NOT in the address')
  assert.equal(sent.auth, null, 'a public question carries no device token')
  ok('a good link: the preview says the team, who invited, the role and the address; the token rides the body of a POST to the active server, with no device token')

  api.preview = { status: 200, body: { workspace_name: 'Acme' + LS + '\u0007\nCorp ' + 'x'.repeat(300), inviter_name: null, email: 'ada@example.test', role: 'superuser', expires_at: '2026-10-25T10:00:00.000Z' } }
  r = await preview()
  assert.equal(r.json.preview.inviter, null)
  assert.equal(r.json.preview.role, 'member', 'a role the page does not know is the lowest')
  assert.ok(r.json.preview.team.length <= 120 && !/[\u0000-\u001f\u0007]/.test(r.json.preview.team) && !r.json.preview.team.includes(LS), 'a team\'s name from someone else is one bounded line: ' + JSON.stringify(r.json.preview.team.slice(0, 20)))
  ok('the words of someone else come back as one bounded line without control characters; an unknown role is « member »; a gone inviter is null')

  api.preview = { status: 200, body: { nothing: true } }
  r = await preview()
  assert.deepEqual(r.json, { ok: false, error: 'refused', status: 200 })
  ok('a 200 that describes no invitation is not one')

  api.preview = { status: 404, body: { error: 'not_found', message: 'This invitation is invalid or has expired.' } }
  r = await preview()
  assert.deepEqual(r.json, { ok: false, error: 'invitation_unusable', status: 404 })
  ok('404 (invalid, used, withdrawn, expired): ONE answer')

  api.preview = { status: 429, body: { error: 'rate_limited' } }
  r = await preview()
  assert.deepEqual(r.json, { ok: false, error: 'rate_limited', status: 429 })
  ok('429: too many tries')

  api.preview = { status: 500, body: { error: 'internal' } }
  r = await preview()
  assert.deepEqual(r.json, { ok: false, error: 'refused', status: 500 })
  ok('any other status is « refused » (the page then offers the server\'s own page)')

  const before = api.calls.length
  for (const bad of [{}, { token: 'short' }, { token: 42 }, { token: INVITE + '!' }, { token: 'a'.repeat(201) }, { token: INVITE.slice(0, 20) + ' ' + INVITE.slice(21) }]) {
    r = await preview(bad)
    assert.deepEqual(r.json, { ok: false, error: 'token_shape' }, JSON.stringify(bad))
  }
  assert.equal(api.calls.length, before, 'a token of the wrong shape never reaches the server')
  ok('a token of the wrong shape is refused here and never sent')

  console.log('Accept')
  api.workspaces = { status: 200, body: { workspaces: [{ id: PERSONAL, name: 'Personal', personal: true, role: 'owner' }, { id: TEAM, name: 'Acme', personal: false, role: 'member' }] } }
  api.accept = { status: 200, body: { id: TEAM, name: 'Acme', role: 'member', personal: false, created_at: '2026-10-18T10:00:00.000Z' } }
  api.calls.length = 0
  r = await accept()
  assert.equal(r.status, 200)
  assert.equal(r.json.ok, true)
  assert.deepEqual(r.json.joined, { id: TEAM, name: 'Acme', role: 'member', plan_key: 'team' })
  const acc = callsTo('/v1/invitations/accept')[0]
  assert.equal(acc.auth, 'Bearer ' + TOKEN, 'the device token proves the account')
  assert.deepEqual(JSON.parse(acc.body), { token: INVITE })
  assert.equal(acc.url, '/v1/invitations/accept', 'the token is not in the address')
  const state = readState()
  assert.deepEqual(state.workspaces.map((w) => w.id), [PERSONAL, TEAM], 'the list of teams is read again')
  assert.equal(state.active_workspace_id, undefined, 'the new team is NOT made active here: the page switches through the ordinary path')
  assert.equal(state.token, TOKEN)
  assert.deepEqual(r.json.state.workspaces.map((w) => w.id), [PERSONAL, TEAM], 'the public state shows it')
  assert.equal(r.text.includes(INVITE) || r.text.includes(TOKEN), false, 'no token in the answer')
  assert.equal(readFileSync(statePath, 'utf8').includes(INVITE), false, 'the invitation\'s token is never stored')
  ok('accepted: the team appears in the list, is not activated here, comes with its plan; the device token is the proof; no token in the answer or the state file')

  api.accept = { status: 200, body: { id: TEAM, name: 'Acme', role: 'owner', personal: false } }
  api.workspaces = { status: 503, body: { error: 'down' } }
  writeState()
  r = await accept()
  assert.equal(r.json.ok, true)
  assert.deepEqual(readState().workspaces.map((w) => w.id), [PERSONAL, TEAM], 'when the list cannot be read again, the accepted team is added to the one known')
  ok('the list unreadable after an accepted invitation: the team is added to the known list anyway')
  api.workspaces = { status: 200, body: { workspaces: [{ id: PERSONAL, name: 'Personal', personal: true, role: 'owner' }, { id: TEAM, name: 'Acme', personal: false, role: 'member' }] } }

  api.plan = { status: 200, body: { plan: null, level: null, status: 'none' } }
  writeState()
  api.accept = { status: 200, body: { id: TEAM, name: 'Acme', role: 'admin', personal: false } }
  r = await accept()
  assert.equal(r.json.ok, true)
  assert.equal(r.json.joined.plan_key, 'none', 'a team nobody bought a plan for says so: it cannot answer a model call')
  assert.equal(readState().active_workspace_id, undefined)
  ok('a team without a plan: « plan_key: none » (the page leaves the person where they are, and tells them)')
  api.plan = { status: 503, body: {} }
  writeState()
  r = await accept()
  assert.equal(r.json.joined.plan_key, null, 'a plan that could not be read is not « none »')
  ok('a plan that cannot be read is not mistaken for « no plan »')
  api.plan = { status: 200, body: { plan: { key: 'team', name: 'Team', kind: 'team' }, level: '1-5 seats', status: 'active' } }

  writeState()
  api.accept = { status: 404, body: { error: 'not_found', message: 'This invitation is invalid or has expired.' } }
  let beforeState = readFileSync(statePath, 'utf8')
  r = await accept()
  assert.deepEqual(r.json, { ok: false, error: 'invitation_unusable', status: 404 })
  assert.equal(readFileSync(statePath, 'utf8'), beforeState, 'a refusal leaves the state as it was')
  ok('404 (invalid, used, withdrawn, expired or meant for another account): ONE answer, the state untouched')

  api.accept = { status: 409, body: { error: 'seat_limit', message: 'No free seat.' } }
  r = await accept()
  assert.deepEqual(r.json, { ok: false, error: 'seat_limit', status: 409 })
  assert.equal(readFileSync(statePath, 'utf8'), beforeState)
  ok('409 seat_limit: the team is full, the state untouched (the link stays valid on the server)')

  api.accept = { status: 409, body: { error: 'conflict' } }
  r = await accept()
  assert.deepEqual(r.json, { ok: false, error: 'refused', status: 409 })
  ok('another 409 is not mistaken for a full team')

  api.accept = { status: 429, body: { error: 'rate_limited' } }
  r = await accept()
  assert.deepEqual(r.json, { ok: false, error: 'rate_limited', status: 429 })
  ok('429: too many tries')

  api.accept = { status: 200, body: { nothing: true } }
  r = await accept()
  assert.deepEqual(r.json, { ok: false, error: 'refused', status: 200 })
  assert.equal(readFileSync(statePath, 'utf8'), beforeState)
  ok('a 200 that describes no team joined nobody: nothing is written')

  api.accept = { status: 502, body: '<html>bad gateway</html>' }
  r = await accept()
  assert.deepEqual(r.json, { ok: false, error: 'refused', status: 502 })
  ok('a gateway\'s page is « refused »')

  console.log('Nothing goes anywhere else')
  api.calls.length = 0
  api.preview = { status: 200, body: { workspace_name: 'Acme', inviter_name: 'Ada', email: 'ada@example.test', role: 'member', expires_at: '2026-10-25T10:00:00.000Z' } }
  api.accept = { status: 200, body: { id: TEAM, name: 'Acme', role: 'member', personal: false } }
  const lures = { token: INVITE, base: decoyUrl, api: decoyUrl, url: decoyUrl + '/invitations/accept?token=' + INVITE, host: '127.0.0.1:' + decoyServer.address().port, link: decoyUrl + '/invitations/accept?token=' + INVITE }
  await preview(lures)
  await accept(lures)
  assert.equal(decoy.calls, 0, 'the host of a pasted link, a base address or an api field in the request reach nothing')
  assert.equal(api.calls.filter((c) => c.path.startsWith('/v1/invitations/')).length, 2, 'the two calls went to the active server')
  ok('a request that names another host (as the host of a link, a base, an api) is answered by the ACTIVE server alone: the decoy heard nothing')
  assert.equal(api.calls.some((c) => c.url.includes(INVITE)), false, 'the token is in no address')
  assert.equal(printed.some((l) => l.includes(INVITE)), false, 'the token is in no line the bundle printed')
  ok('the invitation\'s token is in no address and in no line the bundle printed')

  console.log('Guards')
  const bodyOf = { token: INVITE }
  api.calls.length = 0
  for (const [headers, want, label] of [[{}, 403, 'no Origin'], [{ origin: 'http://evil.example' }, 403, 'a foreign Origin'], [{ origin: 'http://evil.example', cookie: sessionCookie(own) }, 403, 'a foreign Origin even with the real cookie']]) {
    for (const path of ['preview', 'accept']) {
      r = await send('/kybernos-cloud/invitation/' + path, headers, bodyOf)
      assert.equal(r.status, want, path + ': ' + label + ' -> ' + r.status)
    }
  }
  assert.equal(api.calls.length, 0, 'a refused request sent nothing to the server')
  ok('preview and accept: no Origin 403, foreign Origin 403 (even with the cookie), nothing sent')
  // L3-04 (recette 2026-10-25): preview joins nobody, but its only caller is the join dialog of the page, which sends the cookie, so it follows the rule of every other
  // write of the bundle (the right Origin AND DSH's signed session) instead of being the one POST a bare local program can still drive.
  for (const path of ['accept', 'preview']) {
    r = await send('/kybernos-cloud/invitation/' + path, { origin }, bodyOf)
    assert.equal(r.status, 401, path + ': the right Origin and no cookie')
    r = await send('/kybernos-cloud/invitation/' + path, { origin, cookie: sessionCookie(own, { secret: OTHER_SECRET }) }, bodyOf)
    assert.equal(r.status, 401, path + ': the right Origin and a forged cookie')
  }
  assert.equal(api.calls.length, 0)
  ok('accept and preview: the right Origin without the signed session, or with a forged one, is 401 and sends nothing')
  r = await send('/kybernos-cloud/invitation/preview', browser(), bodyOf)
  assert.equal(r.status, 200)
  assert.equal(r.json.ok, true)
  ok('preview with the real pair (the page\'s Origin and the signed session) answers; it joins nobody')
  const get = (path, headers) => new Promise((resolve) => http.get({ host: '127.0.0.1', port, path, headers: { host: own, ...headers } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)) }).on('error', () => resolve(0)))
  assert.equal(await get('/kybernos-cloud/invitation/preview', browser()), 405, 'a GET is not the method')
  ok('the routes answer to POST only')

  console.log('Signed out, unreachable, refused')
  const unplugged = readFileSync(statePath, 'utf8')
  rmSync(statePath, { force: true })
  api.calls.length = 0
  r = await preview()
  assert.deepEqual(r.json, { ok: false, error: 'non_connecte' })
  r = await accept()
  assert.deepEqual(r.json, { ok: false, error: 'non_connecte' })
  assert.equal(api.calls.length, 0, 'a device that is not connected asks nothing')
  ok('not connected: « non_connecte », nothing sent')
  writeFileSync(statePath, unplugged, { mode: 0o600 })

  // The token of the device is refused by the server: the host asks once more on the route that decides, ends the connection and says so.
  api.accept = { status: 401, body: { error: 'unauthorized', message: 'Sign in required.' } }
  api.workspaces = { status: 401, body: { error: 'unauthorized', message: 'Sign in required.' } }
  r = await accept()
  assert.deepEqual(r.json, { ok: false, error: 'non_connecte', status: 401 })
  assert.equal(existsSync(statePath), false, 'the connection the server turned away is over')
  ok('a device token the server refuses: the connection is ended and the answer says « signed out »')

  writeState()
  api.accept = { status: 200, body: { id: TEAM, name: 'Acme', role: 'member', personal: false } }
  api.workspaces = { status: 200, body: { workspaces: [] } }
  await new Promise((resolve) => apiServer.close(resolve))
  r = await preview()
  assert.equal(r.json.ok, false)
  assert.equal(r.json.error, 'unreachable')
  assert.equal(r.json.status, 0)
  r = await accept()
  assert.equal(r.json.error, 'unreachable')
  assert.deepEqual(readState().workspaces.map((w) => w.id), [PERSONAL], 'an unreachable server changes nothing')
  ok('a server that does not answer: « unreachable » (status 0), the state untouched')
} finally {
  server.close()
  decoyServer.close()
  try { apiServer.close() } catch (e) { /* already closed */ }
  rmSync(dir, { recursive: true, force: true })
}
console.log('\n' + pass + ' verifications OK')
process.exit(0)
