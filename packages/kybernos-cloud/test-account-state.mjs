// ── What the account's state looks like from DSH: a refused token, a pairing that ends, a team without a plan ─────────────────────────────
//
// Found in the 2026-10-18 account end-to-end campaign (findings AC-01, AC-02, AC-09, AC-15, AC-17), host half:
//   · a device the server no longer knows (revoked from the Devices page, or a server on a new database) answered 401 to every call, and the host did nothing
//     about it for up to five minutes: the footer kept « Sara Main · Free », « Team settings » said « try again in a moment » and a chat failed with a raw engine error;
//   · a pairing that ended refused or expired was only noticed by an open panel (the footer never asked, and two askers could race for the one-time token);
//   · a team with no plan answered the quota read like any other and a new plan-less team silently became the active one;
//   · two DSH on one computer read identically in the server's Devices list.
//
//   node kybernos-cloud/test-account-state.mjs
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, readSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { asBrowser } from './lib-session-routes-test.mjs'

const TOKEN = 'kys-' + 'a'.repeat(43)
const DEVICE_SECRET = 'secret-' + 'd'.repeat(30)
const PERSONAL = '11111111-1111-4111-8111-111111111111'
const TEAM = '22222222-2222-4222-8222-222222222222'
const NEWTEAM = '33333333-3333-4333-8333-333333333333'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

const fake = {
  calls: [], bodies: [],
  // 'good' | 'refused' (every call with the token is a 401 of the server's own) | 'route' (only /v1/console/link is refused, the token is fine)
  mode: 'good',
  poll: 'pending', pollDelayMs: 0,
  newTeamPlan: null,
  workspaces: [{ id: PERSONAL, name: 'My workspace', personal: true, role: 'owner' }],
}
const json = (res, status, payload) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload)) }
const refusal = (res) => json(res, 401, { error: 'unauthorized', message: 'Sign in required.' })
const server = createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    fake.calls.push(req.method + ' ' + req.url)
    let body = null
    try { body = raw === '' ? null : JSON.parse(raw) } catch (e) { body = null }
    fake.bodies.push(body)
    const withToken = String(req.headers.authorization || '') !== ''
    if (req.url === '/v1/device/start') return json(res, 200, { device_id: 'dev-1', device_secret: DEVICE_SECRET, user_code: 'ABC234', activation_url: 'http://127.0.0.1/activate', expires_in: 600 })
    if (req.url === '/v1/device/poll') {
      const answer = () => {
        if (fake.poll === 'claimed') return json(res, 200, { status: 'claimed', token: TOKEN, expires_at: '2026-12-01T00:00:00Z', user: { id: 'u-1', email: 'a@example.test', name: 'Ada', plan: 'free' } })
        return json(res, 200, { status: fake.poll })
      }
      return fake.pollDelayMs > 0 ? setTimeout(answer, fake.pollDelayMs) : answer()
    }
    if (withToken && fake.mode === 'refused') return refusal(res)
    if (req.url === '/v1/console/link' && fake.mode === 'route') return refusal(res)
    if (req.url === '/v1/workspaces' && req.method === 'GET') return json(res, 200, { workspaces: fake.workspaces })
    if (req.url === '/v1/workspaces' && req.method === 'POST') {
      const team = { id: NEWTEAM, name: body.name, personal: false, role: 'owner' }
      fake.workspaces = fake.workspaces.concat([team])
      return json(res, 201, { workspace: team })
    }
    if (req.url === '/v1/me') return json(res, 200, { id: 'u-1', name: 'Ada', plan: 'free' })
    const plan = /^\/v1\/workspaces\/([^/]+)\/plan$/.exec(req.url)
    if (plan !== null) {
      if (plan[1] === NEWTEAM || plan[1] === TEAM) {
        const key = plan[1] === NEWTEAM ? fake.newTeamPlan : null
        return json(res, 200, key === null ? { source: 'none', status: 'none', plan: null, level: null, seats: 1, credit_balance_credits: 0 } : { source: 'subscription', status: 'active', plan: { key, name: 'Team', kind: 'team' }, level: '1-5 seats', seats: 5, credit_balance_credits: 0 })
      }
      return json(res, 200, { source: 'subscription', status: 'active', plan: { key: 'free', name: 'Free', kind: 'individual' }, level: 'Free', seats: 1, credit_balance_credits: 0 })
    }
    if (/^\/v1\/workspaces\/[^/]+\/llm\/budget$/.test(req.url)) return json(res, 200, { windows: [] })
    if (req.url === '/v1/console/link') return json(res, 200, { url: 'http://127.0.0.1:' + server.address().port + '/account', expires_in: 60 })
    if (req.url.startsWith('/v1/models')) return json(res, 200, { object: 'list', data: [{ id: 'glm', object: 'model' }] })
    if (req.url.startsWith('/v1/memories')) return json(res, 200, { memories: [], total: 0 })
    json(res, 404, { error: 'not_found', message: 'No such route.' })
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

const dir = mkdtempSync(join(tmpdir(), 'kybernos-cloud-account-state-'))
const statePath = join(dir, 'kybernos-cloud.json')
process.env.KYBERNOS_CLOUD_API = 'http://127.0.0.1:' + server.address().port
process.env.KYBERNOS_CLOUD_STATE = statePath
process.env.DSH_HOME = dir
process.env.HOME = dir
process.env.KYBERNOS_SERVERS_FILE = join(dir, 'servers.json')
delete process.env.DSH_WEB_PORT

const routes = new Map()
const webServer = { register: (r) => { routes.set(r.path, r.handler); return () => routes.delete(r.path) } }
const ctx = {
  get: (name) => (name === 'webServer' ? webServer : undefined),
  inject: (_list, cb) => cb(ctx),
  effect: (_fn, label) => { if (/route /.test(String(label))) _fn() },
  on: () => {},
  systemPrompt: { context: () => {} },
  tools: { register: () => () => {} },
}
const mod = await import('./index.js')
mod.MEMORY_TUNING.writeRefreshMs = -1
mod.MEMORY_TUNING.tickMs = 3600000
if (mod.PROFILE_REFRESH_TUNING !== undefined) { mod.PROFILE_REFRESH_TUNING.firstMs = 3600000; mod.PROFILE_REFRESH_TUNING.tickMs = 3600000; mod.PROFILE_REFRESH_TUNING.probeGapMs = 0 }
mod.apply(ctx)

const fakeRes = () => ({ status: 0, body: null, writeHead(status) { this.status = status }, setHeader() {}, end(payload) { this.body = payload === undefined || payload === '' ? null : JSON.parse(payload) } })
let listenPort = null
const hit = async (path, method, body) => {
  const handler = routes.get(path.split('?')[0])
  assert.ok(handler !== undefined, 'missing route ' + path)
  const res = fakeRes()
  const host = '127.0.0.1:' + (listenPort === null ? 3080 : listenPort)
  await handler(asBrowser(path, {
    method, url: path, headers: { host, origin: 'http://' + host },
    socket: { localPort: listenPort === null ? 3080 : listenPort, remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() { if (body !== undefined) yield Buffer.from(JSON.stringify(body)) },
  }), res)
  return res
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const leakFree = (body) => JSON.stringify(body).indexOf(TOKEN) < 0
const endedFile = statePath + '.ended'
const connect = async () => {
  fake.mode = 'good'; fake.poll = 'claimed'
  writeFileSync(statePath, JSON.stringify({ device_id: 'dev-1', device_secret: DEVICE_SECRET, user_code: 'ABC234', activation_url: 'http://127.0.0.1/activate', expires_at: new Date(Date.now() + 600000).toISOString(), api: process.env.KYBERNOS_CLOUD_API }), { mode: 0o600 })
  const polled = await hit('/kybernos-cloud/poll', 'POST')
  assert.equal(polled.body.connected, true, JSON.stringify(polled.body).slice(0, 200))
}
const pending = () => writeFileSync(statePath, JSON.stringify({ device_id: 'dev-1', device_secret: DEVICE_SECRET, user_code: 'ABC234', activation_url: 'http://127.0.0.1/activate', expires_at: new Date(Date.now() + 600000).toISOString(), api: process.env.KYBERNOS_CLOUD_API }), { mode: 0o600 })

try {
  console.log('Kybernos Cloud — the account state seen from DSH')

  // ── AC-01: a token the server refuses ────────────────────────────────────────────────────────────────
  // 1. The console link (Team settings, Account) meets the server's 401: the device is gone. The answer says the session ended, the connection is dropped and /status says so.
  {
    await connect()
    fake.mode = 'refused'
    const link = await hit('/kybernos-cloud/console/link', 'POST', { section: 'plan', open: false })
    assert.equal(link.body.ok, false)
    assert.equal(link.body.status, 'revoked', 'a refused token must say the session ended, not « refused »: ' + JSON.stringify(link.body))
    assert.equal(link.body.error, 'session_ended')
    const st = (await hit('/kybernos-cloud/status', 'GET')).body
    assert.equal(st.connected, false, 'the connection must be dropped')
    assert.equal(st.status, 'revoked', 'and /status must say why')
    assert.equal(typeof st.ended === 'object' && st.ended !== null ? typeof st.ended.at : null, 'string', 'with the time it ended')
    assert.ok(existsSync(endedFile), 'the ended marker sits beside the state file')
    assert.equal(existsSync(statePath), false, 'the token is gone')
    assert.equal(readFileSync(endedFile, 'utf8').includes(TOKEN), false, 'the marker holds no token')
    ok('the console link meets a 401: the host ends the connection, answers « session ended » and /status says it (marker beside the state file, no token in it)')
  }

  // 2. The quota read (every two minutes and at each focus, from the footer) does the same, so a reload of the page finds out in seconds.
  {
    await connect()
    fake.mode = 'refused'
    const q = await hit('/kybernos-cloud/quota', 'GET')
    assert.equal(q.body.ok, false)
    assert.equal(q.body.status, 'revoked', 'the quota read must report the ended session: ' + JSON.stringify(q.body))
    assert.equal((await hit('/kybernos-cloud/status', 'GET')).body.status, 'revoked')
    ok('the quota read meets a 401: the session is ended and reported to the footer in the same answer')
  }

  // 3. Any other token call that is refused starts the same check in the background (no page has to ask).
  {
    await connect()
    fake.mode = 'refused'
    await hit('/kybernos-cloud/memory', 'GET')
    let st = null
    for (let i = 0; i < 40; i += 1) { st = (await hit('/kybernos-cloud/status', 'GET')).body; if (st.connected === false) break; await sleep(50) }
    assert.equal(st.connected, false, 'a refused memory read must end the session by itself')
    assert.equal(st.status, 'revoked')
    ok('a refused call of any route starts the check by itself: the footer finds the session ended without a page asking')
  }

  // 4. A 401 about ONE route while the server still accepts the token (a route's own refusal) signs nobody out.
  {
    await connect()
    fake.mode = 'route'
    const link = await hit('/kybernos-cloud/console/link', 'POST', { section: 'plan', open: false })
    assert.equal(link.body.ok, false)
    assert.notEqual(link.body.status, 'revoked', 'one refused route is not a revoked token: ' + JSON.stringify(link.body))
    const st = (await hit('/kybernos-cloud/status', 'GET')).body
    assert.equal(st.connected, true, 'the token is still good: stay connected')
    assert.equal(existsSync(endedFile), false)
    fake.mode = 'good'
    ok('a 401 on one route while /v1/workspaces still accepts the token signs nobody out (the /v1/me lesson)')
  }

  // 5. The marker belongs to the person's next move: signing out on purpose, or starting a new pairing, clears it; it survives a DSH restart (it is a file).
  {
    await connect()
    fake.mode = 'refused'
    await hit('/kybernos-cloud/quota', 'GET')
    assert.ok(existsSync(endedFile))
    assert.equal((await hit('/kybernos-cloud/status', 'GET')).body.status, 'revoked', 'still ended on the next read (it is a file, a restart keeps it)')
    fake.mode = 'good'
    const started = await hit('/kybernos-cloud/start', 'POST')
    assert.equal(started.body.ok, true)
    assert.equal(existsSync(endedFile), false, 'a new pairing clears the marker')
    assert.equal((await hit('/kybernos-cloud/status', 'GET')).body.status, 'pending')
    await connect()
    fake.mode = 'refused'
    await hit('/kybernos-cloud/quota', 'GET')
    assert.ok(existsSync(endedFile))
    fake.mode = 'good'
    await hit('/kybernos-cloud/disconnect', 'POST', { confirm: true })
    assert.equal(existsSync(endedFile), false, 'a sign-out on purpose clears the marker')
    assert.equal((await hit('/kybernos-cloud/status', 'GET')).body.status, 'none')
    ok('the ended marker survives a restart, and a new pairing or a sign-out on purpose clears it')
  }

  // ── AC-17: a pairing that ends, seen by whoever asks ─────────────────────────────────────────────────
  // 6. The footer and the open card both poll: two polls at once make ONE call to the server (the one-time token goes to one asker).
  {
    pending()
    fake.mode = 'good'; fake.poll = 'pending'; fake.pollDelayMs = 80
    fake.calls.length = 0
    const [a, b, c] = await Promise.all([hit('/kybernos-cloud/poll', 'POST'), hit('/kybernos-cloud/poll', 'POST'), hit('/kybernos-cloud/poll', 'POST')])
    const polls = fake.calls.filter((x) => x === 'POST /v1/device/poll').length
    assert.equal(polls, 1, 'overlapping polls must share one call (' + polls + ' reached the server)')
    for (const r of [a, b, c]) assert.equal(r.body.status, 'pending')
    // Sequential polls are separate calls, as before.
    fake.pollDelayMs = 0
    fake.calls.length = 0
    await hit('/kybernos-cloud/poll', 'POST'); await hit('/kybernos-cloud/poll', 'POST')
    assert.equal(fake.calls.filter((x) => x === 'POST /v1/device/poll').length, 2)
    ok('overlapping polls (the footer and an open card) share one call to the server; sequential ones are separate calls')
  }

  // 7. A refused or expired pairing: every asker is told, the request is forgotten (and no « session ended » marker is left for it).
  {
    for (const verdict of ['denied', 'expired']) {
      pending()
      fake.poll = verdict; fake.pollDelayMs = 40
      const [a, b] = await Promise.all([hit('/kybernos-cloud/poll', 'POST'), hit('/kybernos-cloud/poll', 'POST')])
      assert.equal(a.body.status, verdict); assert.equal(b.body.status, verdict, 'both askers hear it, not only the first')
      assert.equal(existsSync(statePath), false, 'the dead request is forgotten')
      assert.equal(existsSync(endedFile), false, 'a refused pairing is not an ended session')
      assert.equal((await hit('/kybernos-cloud/status', 'GET')).body.status, 'none')
    }
    fake.pollDelayMs = 0
    ok('a refused or expired pairing is reported to every asker and forgotten, with no ended-session marker')
  }

  // ── AC-02: a team with no plan ───────────────────────────────────────────────────────────────────────
  // 8. The quota facts say the team has no plan (the notice and the card need it: the budget windows are empty, so nothing else explains the refusal).
  {
    fake.workspaces = [{ id: PERSONAL, name: 'My workspace', personal: true, role: 'owner' }, { id: TEAM, name: 'Acme Crew', personal: false, role: 'owner' }]
    await connect()
    await hit('/kybernos-cloud/space/active', 'POST', { workspace_id: TEAM })
    await hit('/kybernos-cloud/refresh', 'POST')
    assert.equal((await hit('/kybernos-cloud/status', 'GET')).body.state.active_workspace_id, TEAM)
    const q = (await hit('/kybernos-cloud/quota', 'GET')).body
    assert.equal(q.ok, true, JSON.stringify(q))
    assert.equal(q.no_plan, true, 'a team with no plan must be named as such: ' + JSON.stringify(q))
    await hit('/kybernos-cloud/space/active', 'POST', { workspace_id: PERSONAL })
    const q2 = (await hit('/kybernos-cloud/quota', 'GET')).body
    assert.equal(q2.no_plan, false, 'a space with a plan is not « no plan »')
    ok('the quota facts say when the active team has no plan (and only then)')
  }

  // ── AC-09: creating a team does not take over silently ───────────────────────────────────────────────
  // 9. A new team has no plan: the person stays where they were, and the answer says what happened.
  {
    fake.workspaces = [{ id: PERSONAL, name: 'My workspace', personal: true, role: 'owner' }]
    await connect()
    fake.newTeamPlan = null
    const made = await hit('/kybernos-cloud/space/create', 'POST', { name: 'Alpha crew' })
    assert.equal(made.body.ok, true, JSON.stringify(made.body).slice(0, 200))
    const view = made.body.state
    assert.ok(view.workspaces.some((w) => w.id === NEWTEAM), 'the team is created and listed')
    assert.equal(view.active_workspace_id, PERSONAL, 'a team with no plan must not become the active one by itself')
    assert.deepEqual(made.body.created, { id: NEWTEAM, name: 'Alpha crew', plan_key: 'none', activated: false }, JSON.stringify(made.body.created))
    ok('a new team with no plan is created but does not take over: the answer says it has no plan and was not activated')
  }
  // 10. A team created with a plan (the server attached one) is activated, as before.
  {
    fake.workspaces = [{ id: PERSONAL, name: 'My workspace', personal: true, role: 'owner' }]
    await connect()
    fake.newTeamPlan = 'team'
    const made = await hit('/kybernos-cloud/space/create', 'POST', { name: 'Beta crew' })
    assert.equal(made.body.ok, true)
    assert.equal(made.body.state.active_workspace_id, NEWTEAM, 'a team that has a plan becomes the active one')
    assert.equal(made.body.created.activated, true)
    assert.equal(made.body.created.plan_key, 'team')
    fake.newTeamPlan = null
    ok('a new team that already has a plan becomes active, as before')
  }

  // ── AC-15: two DSH of one computer ───────────────────────────────────────────────────────────────────
  // 11. The device label names the port when it is not the default one.
  {
    fake.workspaces = [{ id: PERSONAL, name: 'My workspace', personal: true, role: 'owner' }]
    writeFileSync(statePath, '{}')
    for (const [port, expectSuffix] of [[3161, true], [3080, false]]) {
      listenPort = port
      fake.bodies.length = 0
      fake.calls.length = 0
      const started = await hit('/kybernos-cloud/start', 'POST')
      assert.equal(started.body.ok, true)
      const sent = fake.bodies[fake.calls.indexOf('POST /v1/device/start')]
      assert.ok(/^DSH /.test(sent.device_label), sent.device_label)
      assert.equal(sent.device_label.includes('3161'), expectSuffix, 'port ' + port + ': ' + sent.device_label)
      if (expectSuffix === false) assert.equal(/\(port /.test(sent.device_label), false, sent.device_label)
      assert.ok(sent.device_label.length <= 64, 'the label stays within its limit: ' + sent.device_label.length)
      writeFileSync(statePath, '{}')
    }
    listenPort = null
    // A host name that fills the whole label still leaves room for the port.
    const long = mod.deviceLabel(3161)
    assert.ok(/\(port 3161\)$/.test(long) && long.length <= 64, long)
    ok('the device label names the port when it is not 3080 (two DSH of one computer read differently), within the label limit')
  }

  // ── L3-83 / L3-57: the connection file holds the device token. It was written in place, and a file that could not be read was « not connected » with no word ─────────────────
  // Now: written through a temporary file that is renamed over it (a reader sees the old file or the new one, never half), the last good version kept as `.bak` and read when the file
  // cannot be, and a file that is damaged with no copy to help says so instead of the first-time words.
  {
    const bakFile = statePath + '.bak'
    const mode = (f) => statSync(f).mode & 0o777
    const strays = () => readdirSync(dir).filter((f) => /\.tmp$/.test(f))
    await connect()
    // 1. A write is « a temporary file renamed over the file », not an opening and filling of the file itself.
    await hit('/kybernos-cloud/refresh', 'POST')           // a second write: the first good version becomes the copy
    assert.ok(existsSync(bakFile), 'the last good version is kept beside the file as .bak')
    assert.equal(JSON.parse(readFileSync(bakFile, 'utf8')).token, TOKEN, 'a whole copy')
    assert.equal(mode(statePath), 0o600, 'the file keeps mode 0600')
    assert.equal(mode(bakFile), 0o600, 'and so does its copy (it holds the token)')
    const before = readFileSync(statePath, 'utf8')
    const inode = statSync(statePath).ino
    const reader = openSync(statePath, 'r')                  // a reader that opened the file BEFORE the next write
    await hit('/kybernos-cloud/refresh', 'POST')
    assert.notEqual(statSync(statePath).ino, inode, 'the write went through a temporary file renamed over the file (the same file was not opened and filled again)')
    const heard = Buffer.alloc(before.length + 64)
    const n = readSync(reader, heard, 0, heard.length, 0)
    closeSync(reader)
    assert.equal(heard.toString('utf8', 0, n), before, 'the reader that was in the middle of the file saw the old one whole: a write cut at any point leaves the old file or the new one')
    assert.deepEqual(strays(), [], 'no temporary file is left behind')
    assert.equal(mode(statePath), 0o600)
    ok('state file: written through a temporary file renamed over it (a reader that had it open keeps the old content whole), mode 0600, the last good version kept as .bak, no stray file')

    // 2. A write cut half way (the file truncated) with a good copy: still connected, and the next write mends the file.
    const whole = readFileSync(statePath, 'utf8')
    writeFileSync(bakFile, whole, { mode: 0o600 })
    truncateSync(statePath, Math.floor(whole.length / 2))
    assert.throws(() => JSON.parse(readFileSync(statePath, 'utf8')), 'the file is really damaged now')
    const st = (await hit('/kybernos-cloud/status', 'GET')).body
    assert.equal(st.connected, true, 'a truncated file with a good copy is still connected: ' + JSON.stringify(st).slice(0, 200))
    assert.equal(st.state.user.email, 'a@example.test', 'with the person it knew')
    assert.equal(leakFree(st), true)
    const refreshed = await hit('/kybernos-cloud/refresh', 'POST')
    assert.equal(refreshed.body.connected, true, 'and the host still works with the token from the copy')
    assert.equal(JSON.parse(readFileSync(statePath, 'utf8')).token, TOKEN, 'the next write mends the file itself')
    assert.equal(mode(statePath), 0o600)
    ok('a write cut half way (truncated file): the .bak is read, DSH stays connected and the next write mends the file')

    // 3. Every way of damaging the file, with a good copy: connected. A copy that is itself damaged never replaces a good one.
    for (const [label, content] of [['empty', ''], ['JSON cut', '{"token": "kys-'], ['text', 'not json at all'], ['null', 'null'], ['a number', '42'], ['an array', '[]'], ['NUL bytes', '\u0000\u0000\u0000']]) {
      writeFileSync(bakFile, JSON.stringify({ ...JSON.parse(whole) }), { mode: 0o600 })
      writeFileSync(statePath, content)
      assert.equal((await hit('/kybernos-cloud/status', 'GET')).body.connected, true, label + ': the copy is read')
    }
    writeFileSync(statePath, '{"token": "kys-')           // damaged main
    await hit('/kybernos-cloud/refresh', 'POST')          // the host writes: the damaged file must not become the copy
    assert.equal(JSON.parse(readFileSync(bakFile, 'utf8')).token, TOKEN, 'a damaged file never replaces a good copy')
    ok('empty, cut, text, null, a number, an array, NUL bytes: each is read from the copy; a damaged file never becomes the copy')

    // 4. Damaged and no copy that helps: not « Sign in / Sign up » (nobody ever connected) and not « session ended » (the server did not end it): the host says it cannot read it.
    writeFileSync(statePath, '{"token": "kys-', { mode: 0o600 })
    writeFileSync(bakFile, 'also damaged', { mode: 0o600 })
    let st2 = (await hit('/kybernos-cloud/status', 'GET')).body
    assert.deepEqual({ ok: st2.ok, connected: st2.connected, status: st2.status }, { ok: true, connected: false, status: 'unreadable' }, 'both damaged: the status says unreadable')
    rmSync(bakFile)
    st2 = (await hit('/kybernos-cloud/status', 'GET')).body
    assert.equal(st2.status, 'unreadable', 'no copy at all: the same')
    assert.equal(existsSync(endedFile), false, 'it is not an ended session')
    assert.equal((await hit('/kybernos-cloud/refresh', 'POST')).body.connected, false, 'nothing is read from a file the host cannot read')
    ok('a damaged file with no usable copy: /status says « unreadable » (not none, not revoked)')

    // 5. Signing in again replaces the damaged file; and a file that is simply ABSENT is « none », a deliberate sign-out leaves no copy to come back from.
    fake.mode = 'good'; fake.poll = 'claimed'
    const started = await hit('/kybernos-cloud/start', 'POST')
    assert.equal(started.body.ok, true, JSON.stringify(started.body))
    assert.equal((await hit('/kybernos-cloud/status', 'GET')).body.status, 'pending', 'a new pairing replaces the damaged file')
    const claimed = await hit('/kybernos-cloud/poll', 'POST')
    assert.equal(claimed.body.connected, true)
    await hit('/kybernos-cloud/refresh', 'POST')
    assert.ok(existsSync(bakFile), 'connected again, with a copy')
    await hit('/kybernos-cloud/disconnect', 'POST', { confirm: true })
    assert.equal(existsSync(statePath), false)
    assert.equal(existsSync(bakFile), false, 'a sign-out removes the copy too: the signed-out person does not come back from it')
    const out = (await hit('/kybernos-cloud/status', 'GET')).body
    assert.deepEqual({ connected: out.connected, status: out.status }, { connected: false, status: 'none' }, 'a file that is absent is « none », never « unreadable »')
    ok('signing in again replaces a damaged file; a sign-out removes the copy as well and an absent file stays « none »')

    assert.deepEqual(strays(), [], 'no stray temporary file after all of this')
  }

  console.log('\n' + pass + ' checks passed')
} finally {
  server.close()
}
process.exit(0)
