// ── The cloud client when the Kybernos server misbehaves ────────────────────────────────────────────────────────────
//
// A programmable fake server (loopback) answers badly on purpose, and the REAL host routes of the plugin are called the way the
// page calls them. What must hold, whatever the server does:
//   · a huge body is never held in memory (the call fails, the connection is dropped);
//   · a redirect is never followed (to another host it would carry the request body away, and the answer of that host would be
//     taken for the server's);
//   · a pairing in progress survives a reply that is not a verdict (429, 5xx, HTML, garbage): only « denied » / « expired »
//     end it;
//   · a reply that is not the workspace list (HTML of a captive portal, garbage) never erases the list the person already has;
//   · a success status with a body that is not JSON is a failure, not a success with nothing in it.
//
//   node kybernos-cloud/test-cloud-resilience.mjs
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TOKEN = 'kys-' + 'r'.repeat(43)
const DEVICE_SECRET = 'secret-' + 'd'.repeat(30)
const WS = '11111111-1111-4111-8111-111111111111'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

// ── A server that behaves, until a test says otherwise ──────────────────────────────────────────────────────────
const fake = { mode: 'good', pollAnswer: null, workspacesAnswer: null, hugeMb: 64, hugeSent: 0, hugeClosedEarly: false, calls: [] }
const foreign = { hits: [] }
const foreignServer = createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    foreign.hits.push({ method: req.method, url: req.url, auth: req.headers.authorization !== undefined, bodyLen: body.length })
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, captured: true, workspaces: [], items: [] }))
  })
})
await new Promise((resolve) => foreignServer.listen(0, '127.0.0.1', resolve))
const foreignPort = foreignServer.address().port

const json = (res, status, payload) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload)) }
const server = createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    fake.calls.push(req.method + ' ' + req.url)
    if (fake.mode === 'huge') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.write('{"items":["')
      const piece = 'x'.repeat(1 << 20)
      let sent = 0
      res.on('close', () => { if (sent < fake.hugeMb) fake.hugeClosedEarly = true })
      const pump = () => {
        while (sent < fake.hugeMb && !res.destroyed) {
          sent += 1; fake.hugeSent = sent
          if (res.write(piece) === false) { res.once('drain', pump); return }
        }
        if (!res.destroyed) res.end('"]}')
      }
      pump()
      return
    }
    if (fake.mode === 'redirect307' || fake.mode === 'redirect302') {
      res.writeHead(fake.mode === 'redirect307' ? 307 : 302, { location: 'http://127.0.0.1:' + foreignPort + '/captured' + req.url })
      res.end()
      return
    }
    if (fake.mode === 'empty') { res.writeHead(200); res.end(); return }
    if (fake.mode === 'html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html><body>Captive portal: please sign in</body></html>'); return }
    if (fake.mode === 'truncated') {
      // Announces 1000 bytes, sends 12, then drops the connection.
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': '1000' })
      res.write('{"workspace')
      setTimeout(() => res.destroy(), 20)
      return
    }
    if (req.url === '/v1/device/poll' && fake.pollAnswer !== null) {
      const a = fake.pollAnswer
      if (a.html) { res.writeHead(a.status, { 'content-type': 'text/html' }); res.end('<html>' + a.status + '</html>'); return }
      return json(res, a.status, a.body)
    }
    if (req.url === '/v1/workspaces' && req.method === 'GET' && fake.workspacesAnswer !== null) {
      const a = fake.workspacesAnswer
      if (a.html) { res.writeHead(a.status, { 'content-type': 'text/html' }); res.end(a.text ?? '<html>portal</html>'); return }
      if (a.empty) { res.writeHead(a.status); res.end(); return }
      return json(res, a.status, a.body)
    }
    if (req.url === '/v1/workspaces' && req.method === 'GET') return json(res, 200, { workspaces: [{ id: WS, name: 'Personal', personal: true }] })
    if (req.url === '/v1/me') return json(res, 200, { id: 'u-1', name: 'Test', plan: 'free' })
    if (req.url.startsWith('/v1/workspaces/') && req.url.endsWith('/plan')) return json(res, 200, { source: 'free', status: 'active', plan: { key: 'free', name: 'Free', kind: 'individual' }, level: 'Free', seats: 1, credit_balance_credits: 0 })
    if (req.url === '/v1/referral') return json(res, 200, { id: 'u-1', code: 'ABCD12', share_url: 'https://example.invalid/r/ABCD12' })
    if (req.url === '/v1/memories' && req.method === 'POST') return json(res, 201, { id: 7, scope: 'account', kind: 'fact', content: 'x', source: 'taught', pinned: false, created_at: '2026-01-01 00:00:00+00:00' })
    if (req.url === '/v1/device/poll') return json(res, 200, { status: 'pending', interval: 2 })
    json(res, 404, { error: 'not found' })
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

const dir = mkdtempSync(join(tmpdir(), 'kybernos-cloud-resilience-'))
const statePath = join(dir, 'kybernos-cloud.json')
process.env.KYBERNOS_CLOUD_API = 'http://127.0.0.1:' + server.address().port
process.env.KYBERNOS_CLOUD_STATE = statePath
process.env.DSH_HOME = dir
process.env.HOME = dir
process.env.KYBERNOS_SERVERS_FILE = join(dir, 'servers.json')

// ── The real host routes, on a minimal fake host ────────────────────────────────────────────────────────────────
const routes = new Map()
const webServer = { register: (r) => { routes.set(r.path, r.handler); return () => routes.delete(r.path) } }
const ctx = {
  get: (name) => (name === 'webServer' ? webServer : undefined),
  inject: (_list, cb) => cb(ctx),
  effect: (fn) => { fn() },
  on: () => {},
  systemPrompt: { context: () => {} },
  tools: { register: () => () => {} },
}
const mod = await import('./index.js')
mod.MEMORY_TUNING.writeRefreshMs = -1
mod.MEMORY_TUNING.tickMs = 3600000
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
const connected = (extra = {}) => writeFileSync(statePath, JSON.stringify({ token: TOKEN, api: process.env.KYBERNOS_CLOUD_API, user: { id: 'u-1', name: 'Test' }, workspaces: [{ id: WS, name: 'Personal', personal: true }], ...extra }), { mode: 0o600 })
const pending = () => writeFileSync(statePath, JSON.stringify({ device_id: 'dev-1', device_secret: DEVICE_SECRET, user_code: 'ABC234', activation_url: 'http://127.0.0.1/activate', expires_at: new Date(Date.now() + 600000).toISOString(), api: process.env.KYBERNOS_CLOUD_API }), { mode: 0o600 })

try {
  console.log('Kybernos Cloud — the server misbehaves')

  // 1. A huge body is not held.
  {
    connected()
    fake.mode = 'huge'; fake.hugeMb = 96; fake.hugeSent = 0; fake.hugeClosedEarly = false
    const rss0 = process.memoryUsage().rss
    const r = await hit('/kybernos-cloud/referral', 'GET')
    const grownMb = (process.memoryUsage().rss - rss0) / (1 << 20)
    assert.equal(r.body.ok, false, 'a 96 MB answer must be refused, not parsed: ' + JSON.stringify(r.body).slice(0, 120))
    await new Promise((resolve) => setTimeout(resolve, 200))
    assert.equal(fake.hugeClosedEarly, true, 'the client must drop the connection instead of reading everything (sent ' + fake.hugeSent + ' MB)')
    assert.ok(fake.hugeSent < 80, 'the client read ' + fake.hugeSent + ' MB of a 96 MB body')
    assert.ok(grownMb < 150, 'memory grew by ' + Math.round(grownMb) + ' MB')
    fake.mode = 'good'
    ok('a 96 MB answer is refused and the connection dropped (memory +' + Math.round(grownMb) + ' MB)')
  }

  // 2. A redirect is not followed, and nothing reaches the other host.
  for (const mode of ['redirect307', 'redirect302']) {
    connected()
    fake.mode = mode; foreign.hits.length = 0
    const a = await hit('/kybernos-cloud/referral', 'GET')
    const b = await hit('/kybernos-cloud/space/create', 'POST', { name: 'my secret project' })
    assert.equal(foreign.hits.length, 0, mode + ': the other host must receive nothing, got ' + JSON.stringify(foreign.hits))
    assert.equal(a.body.ok, false, mode + ': a redirected answer is not the server\'s answer')
    assert.equal(b.body.ok, false)
    assert.equal(readState().token, TOKEN, mode + ': a redirect never signs the person out')
    fake.mode = 'good'
  }
  ok('a 307 and a 302 are refused: the other host got no request, no body, no header')

  // 3. A pairing survives a reply that is not a verdict.
  {
    const answers = [
      { label: '429', status: 429, body: { error: 'rate_limited' } },
      { label: '500', status: 500, body: { error: 'boom' } },
      { label: '502 html', status: 502, html: true },
      { label: '200 html', status: 200, html: true },
      { label: '200 without status', status: 200, body: { hello: 'world' } },
      { label: '200 unknown status', status: 200, body: { status: 'weird' } },
    ]
    for (const a of answers) {
      pending(); fake.pollAnswer = a
      const r = await hit('/kybernos-cloud/poll', 'POST')
      assert.equal(r.body.ok, false, a.label + ': the poll must report a failure, got ' + JSON.stringify(r.body))
      assert.notEqual(r.body.status, 'expired', a.label + ': not a verdict')
      const st = readState()
      assert.equal(st.device_secret, DEVICE_SECRET, a.label + ': the pairing must still be there')
    }
    // Only the server's own verdicts end it.
    for (const verdict of ['denied', 'expired']) {
      pending(); fake.pollAnswer = { status: 200, body: { status: verdict } }
      const r = await hit('/kybernos-cloud/poll', 'POST')
      assert.equal(r.body.status, verdict)
      assert.equal(r.body.connected, false)
    }
    // And a pending one, then the claim, still work after the errors.
    pending(); fake.pollAnswer = { status: 200, body: { status: 'pending' } }
    assert.equal((await hit('/kybernos-cloud/poll', 'POST')).body.status, 'pending')
    fake.pollAnswer = { status: 200, body: { status: 'claimed', token: TOKEN, user: { id: 'u-1', name: 'Test' } } }
    const claimed = await hit('/kybernos-cloud/poll', 'POST')
    assert.equal(claimed.body.connected, true)
    assert.equal(readState().token, TOKEN)
    assert.equal(readState().device_secret, undefined, 'the device secret is gone after the claim')
    fake.pollAnswer = null
    ok('a 429, a 5xx, an HTML page or a garbage reply to the poll leaves the pairing alone; denied / expired end it; claimed still claims')
  }

  // 4. A refresh answered by something that is not the workspace list keeps the list.
  {
    const bad = [
      { label: '200 html', answer: { status: 200, html: true } },
      { label: '200 empty', answer: { status: 200, empty: true } },
      { label: '200 object without workspaces', answer: { status: 200, body: { x: 1 } } },
      { label: '200 array', answer: { status: 200, body: [1, 2, 3] } },
      { label: '200 null', answer: { status: 200, body: null } },
      { label: '200 workspaces is a string', answer: { status: 200, body: { workspaces: 'none' } } },
    ]
    for (const b of bad) {
      connected(); fake.workspacesAnswer = b.answer
      const r = await hit('/kybernos-cloud/refresh', 'POST')
      assert.equal(r.body.ok, false, b.label + ': got ' + JSON.stringify(r.body).slice(0, 160))
      const st = readState()
      assert.equal(st.token, TOKEN, b.label)
      assert.deepEqual(st.workspaces.map((w) => w.id), [WS], b.label + ': the workspace list must be kept')
    }
    // A real, empty list is the server's word: it is kept as such.
    connected(); fake.workspacesAnswer = { status: 200, body: { workspaces: [] } }
    const r = await hit('/kybernos-cloud/refresh', 'POST')
    assert.equal(r.body.ok, true)
    assert.deepEqual(readState().workspaces, [])
    fake.workspacesAnswer = null
    ok('a captive-portal page, an empty or malformed answer never erases the workspace list; a real empty list still does')
  }

  // 5. A success status whose body is not JSON is a failure; so is a body cut short.
  {
    connected(); fake.mode = 'html'
    const added = await hit('/kybernos-cloud/memory/add', 'POST', { content: 'remember this', kind: 'fact' })
    assert.equal(added.body.ok, false, 'HTML in place of the saved memory is not a saved memory: ' + JSON.stringify(added.body).slice(0, 160))
    fake.mode = 'truncated'
    const cut = await hit('/kybernos-cloud/memory/add', 'POST', { content: 'remember this', kind: 'fact' })
    assert.equal(cut.body.ok, false, 'a body cut short is not a saved memory')
    assert.equal(readState().token, TOKEN)
    // A space the server did not describe was not created; the person's list is left alone.
    fake.mode = 'empty'
    const before = readState().workspaces
    const made = await hit('/kybernos-cloud/space/create', 'POST', { name: 'a new space' })
    assert.equal(made.body.ok, false, 'an empty 200 is not a created space: ' + JSON.stringify(made.body).slice(0, 160))
    assert.deepEqual(readState().workspaces, before, 'the list is untouched')
    fake.mode = 'good'
    const good = await hit('/kybernos-cloud/memory/add', 'POST', { content: 'remember this', kind: 'fact' })
    assert.equal(good.body.ok, true, 'and a good answer still works: ' + JSON.stringify(good.body).slice(0, 160))
    ok('HTML or a cut body in place of the answer is reported as a failure; a good answer still works')
  }

  console.log('\n' + pass + ' checks passed')
} finally {
  server.close(); foreignServer.close()
}
process.exit(0)
