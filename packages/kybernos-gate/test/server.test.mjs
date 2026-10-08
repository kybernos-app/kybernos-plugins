// Integration tests: a real gate in front of a fake DSH, driven over real sockets.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { loadConfig } from '../core/config.mjs'
import { createGate } from '../core/server.mjs'
import { createLimiter } from '../core/limiter.mjs'

const PASSWORD = 'correct horse battery'
const CHEAP = { N: 1024, r: 8, p: 1 }
const DSH_SECRET = randomBytes(32)

// ── a fake DSH ──
const seen = []
const upstream = http.createServer((req, res) => {
  seen.push({ method: req.method, url: req.url, headers: req.headers })
  const path = String(req.url).split('?')[0]
  if (path === '/echo') {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': ['up=1; Path=/', 'up2=2; Path=/'], connection: 'keep-alive' })
      res.end(JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') }))
    })
  } else if (path === '/stream') {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write('data: one\n\n')
    setTimeout(() => { res.write('data: two\n\n'); res.end() }, 400)
  } else {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<html>DSH index</html>')
  }
})
upstream.on('upgrade', (req, socket) => {
  seen.push({ method: 'UPGRADE', url: req.url, headers: req.headers })
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n')
  socket.on('data', (d) => socket.write('echo:' + d))
})
let upstreamPort

// ── helpers ──
async function startGate (extraEnv = {}, deps = {}, port = () => upstreamPort) {
  const home = mkdtempSync(join(tmpdir(), 'kb-gate-srv-'))
  writeFileSync(join(home, '.credentials.yaml'), `client-connection/browser-session:\n  kind: grant\n  payload:\n    version: 1\n    secret: ${DSH_SECRET.toString('base64url')}\n`)
  const config = await loadConfig({
    DSH_HOME: home, KYBERNOS_GATE_PASSWORD: PASSWORD, KYBERNOS_GATE_PORT: '0',
    KYBERNOS_GATE_UPSTREAM: `http://127.0.0.1:${port()}`, ...extraEnv
  }, { hashParams: CHEAP })
  const logs = []
  const gate = createGate(config, { log: (l) => logs.push(l), ...deps })
  const address = await gate.listen()
  return { gate, port: address.port, logs, config }
}

const request = (port, method, path, { headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
    const chunks = []
    res.on('data', (c) => chunks.push(c))
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }))
  })
  req.on('error', reject)
  if (body !== undefined) req.write(body)
  req.end()
})
const NAV = { accept: 'text/html,application/xhtml+xml' }
const loginBody = (user, password, next) => JSON.stringify({ user, password, next })
const post = (port, body, headers = {}) => request(port, 'POST', '/__gate/login', {
  headers: { origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json', ...headers }, body
})
const cookiePair = (setCookie, name) => (Array.isArray(setCookie) ? setCookie : [setCookie]).map((c) => c.split(';')[0]).find((c) => c.startsWith(name + '='))

async function signedIn (port, extraHeaders = {}) {
  const r = await post(port, loginBody('kybernos', PASSWORD), extraHeaders)
  assert.equal(r.status, 200)
  const cookies = [].concat(r.headers['set-cookie']).map((c) => c.split(';')[0]).join('; ')
  return { cookies, response: r }
}

function rawUpgrade (port, headers = {}, path = '/api') {
  return new Promise((resolve, reject) => {
    const s = net.connect(port, '127.0.0.1')
    let buf = ''
    s.on('error', reject)
    s.on('data', (d) => {
      buf += d.toString('latin1')
      if (buf.includes('\r\n\r\n')) { s.removeAllListeners('data'); resolve({ status: Number(buf.split(' ')[1]), socket: s, head: buf }) }
    })
    const lines = [`GET ${path} HTTP/1.1`, `Host: 127.0.0.1:${port}`, 'Connection: Upgrade', 'Upgrade: websocket', 'Sec-WebSocket-Version: 13', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`), '', '']
    s.write(lines.join('\r\n'))
  })
}

before(async () => { await new Promise((r) => upstream.listen(0, '127.0.0.1', r)); upstreamPort = upstream.address().port })
after(async () => { upstream.closeAllConnections?.(); await new Promise((r) => upstream.close(r)) })

// ── tests ──
test('a visitor without a session is sent to the sign-in page and DSH is never contacted', async () => {
  const { gate, port } = await startGate()
  const before = seen.length
  const nav = await request(port, 'GET', '/settings/models?token=SECRET', { headers: NAV })
  assert.equal(nav.status, 303)
  assert.equal(nav.headers.location, '/__gate/login?next=%2Fsettings%2Fmodels', 'the query string (a token, maybe) is dropped')
  const api = await request(port, 'GET', '/api/state', { headers: { accept: 'application/json' } })
  assert.equal(api.status, 401)
  assert.deepEqual(JSON.parse(api.text), { error: 'unauthorized' })
  const post401 = await request(port, 'POST', '/anything', { headers: { 'content-type': 'application/json' }, body: '{}' })
  assert.equal(post401.status, 401)
  assert.equal(seen.length, before, 'nothing reached the upstream')
  await gate.close()
})

test('the sign-in page reads in French or English with scripts off, and is locked down', async () => {
  const { gate, port } = await startGate()
  const fr = await request(port, 'GET', '/__gate/login', { headers: { 'accept-language': 'fr-FR,fr;q=0.9' } })
  assert.equal(fr.status, 200)
  for (const text of ['Accès protégé', 'Identifiant', 'Mot de passe', 'Se connecter', 'connecté 30 jours']) assert.ok(fr.text.includes(text), text)
  const en = await request(port, 'GET', '/__gate/login', { headers: { 'accept-language': 'en-US' } })
  for (const text of ['Protected access', 'Username', 'Password', 'Sign in', 'signed in for 30 days']) assert.ok(en.text.includes(text), text)
  const nonce = /<script nonce="([^"]+)"/.exec(fr.text)[1]
  assert.ok(fr.headers['content-security-policy'].includes(`script-src 'nonce-${nonce}'`))
  assert.match(fr.headers['content-security-policy'], /frame-ancestors 'none'/)
  assert.equal(fr.headers['x-frame-options'], 'DENY')
  assert.equal(fr.headers['cache-control'], 'no-store')
  assert.ok(!fr.text.includes(PASSWORD))
  await gate.close()
})

test('the next parameter cannot send the user to another site', async () => {
  const { gate, port } = await startGate()
  const page = await request(port, 'GET', '/__gate/login?next=' + encodeURIComponent('https://evil.example/x'), { headers: NAV })
  assert.ok(page.text.includes('"next":"/"'), 'sanitised in the page')
  const r = await post(port, loginBody('kybernos', PASSWORD, '//evil.example'))
  assert.equal(JSON.parse(r.text).next, '/')
  const ok = await post(port, loginBody('kybernos', PASSWORD, '/settings/models'))
  assert.equal(JSON.parse(ok.text).next, '/settings/models')
  await gate.close()
})

test('a wrong login says how many tries are left and a good one sets both cookies', async () => {
  const { gate, port, logs } = await startGate()
  const bad = await post(port, loginBody('kybernos', 'nope nope nope'))
  assert.equal(bad.status, 401)
  assert.deepEqual(JSON.parse(bad.text), { ok: false, error: 'invalid', triesLeft: 4 })
  const wrongUser = await post(port, loginBody('someone', PASSWORD))
  assert.equal(wrongUser.status, 401, 'the right password with the wrong user is refused')
  assert.deepEqual(JSON.parse(wrongUser.text), { ok: false, error: 'invalid', triesLeft: 3 }, 'same answer: it does not tell which one was wrong')
  const good = await post(port, loginBody('kybernos', PASSWORD))
  assert.equal(good.status, 200)
  const cookies = [].concat(good.headers['set-cookie'])
  assert.equal(cookies.length, 2)
  const gateCookie = cookies.find((c) => c.startsWith('kybernos_gate='))
  assert.match(gateCookie, /HttpOnly/)
  assert.match(gateCookie, /SameSite=Strict/)
  assert.match(gateCookie, /Max-Age=2592000/)
  assert.doesNotMatch(gateCookie, /Secure/, 'plain http: no Secure flag')
  assert.ok(cookies.some((c) => c.startsWith('dsh-auth-') && /HttpOnly; SameSite=Strict/.test(c)), 'DSH session cookie')
  assert.ok(logs.every((l) => !l.includes(PASSWORD)), 'the password is never logged')
  await gate.close()
})

test('after signing in, requests reach DSH with the gate cookie removed and the Host kept', async () => {
  const { gate, port } = await startGate()
  const { cookies } = await signedIn(port)
  const html = await request(port, 'GET', '/', { headers: { ...NAV, cookie: cookies } })
  assert.equal(html.status, 200)
  assert.ok(html.text.includes('DSH index'))
  const echo = await request(port, 'POST', '/echo?a=1', { headers: { cookie: cookies + '; other=keep', 'content-type': 'text/plain', host: 'dsh.example.com' }, body: 'hello body' })
  const got = JSON.parse(echo.text)
  assert.equal(got.method, 'POST')
  assert.equal(got.url, '/echo?a=1')
  assert.equal(got.body, 'hello body')
  assert.equal(got.headers.host, 'dsh.example.com', 'DSH checks the Host it is given')
  assert.ok(!/kybernos_gate/.test(got.headers.cookie), 'the gate cookie never reaches DSH')
  assert.ok(/dsh-auth-/.test(got.headers.cookie) && /other=keep/.test(got.headers.cookie), 'everything else is forwarded')
  assert.deepEqual([].concat(echo.headers['set-cookie']), ['up=1; Path=/', 'up2=2; Path=/'], 'several Set-Cookie headers survive')
  await gate.close()
})

test('the DSH cookie is bound to the host the browser used', async () => {
  const { gate, port } = await startGate()
  const r = await post(port, loginBody('kybernos', PASSWORD), { host: 'Hosted.Example.com', origin: 'http://hosted.example.com' })
  const { createHash } = await import('node:crypto')
  const want = 'dsh-auth-' + createHash('sha256').update('hosted.example.com').digest('base64url')
  assert.ok([].concat(r.headers['set-cookie']).some((c) => c.startsWith(want + '=')))
  await gate.close()
})

test('a session cookie from another secret, or a mangled one, opens nothing', async () => {
  const a = await startGate({ KYBERNOS_GATE_SECRET: 'a'.repeat(40) })
  const b = await startGate({ KYBERNOS_GATE_SECRET: 'b'.repeat(40) })
  const { cookies } = await signedIn(a.port)
  const gateCookie = cookies.split('; ').find((c) => c.startsWith('kybernos_gate='))
  assert.equal((await request(b.port, 'GET', '/', { headers: { ...NAV, cookie: gateCookie } })).status, 303)
  assert.equal((await request(a.port, 'GET', '/', { headers: { ...NAV, cookie: gateCookie.slice(0, -3) + 'xyz' } })).status, 303)
  assert.equal((await request(a.port, 'GET', '/', { headers: { ...NAV, cookie: gateCookie } })).status, 200)
  await a.gate.close(); await b.gate.close()
})

test('a login must come from this site, as JSON', async () => {
  const { gate, port } = await startGate()
  const body = loginBody('kybernos', PASSWORD)
  const send = (headers) => request(port, 'POST', '/__gate/login', { headers, body })
  assert.equal((await send({ 'content-type': 'application/json' })).status, 403, 'no Origin')
  assert.equal((await send({ 'content-type': 'application/json', origin: 'https://evil.example' })).status, 403, 'foreign Origin')
  assert.equal((await send({ 'content-type': 'application/json', origin: `http://127.0.0.1:${port}`, 'sec-fetch-site': 'cross-site' })).status, 403)
  assert.equal((await send({ 'content-type': 'text/plain', origin: `http://127.0.0.1:${port}` })).status, 415)
  assert.equal((await request(port, 'POST', '/__gate/login', { headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` }, body: '{not json' })).status, 400)
  assert.equal((await request(port, 'POST', '/__gate/login', { headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` }, body: JSON.stringify({ user: 1, password: 2 }) })).status, 400)
  assert.equal((await request(port, 'POST', '/__gate/login', { headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${port}` }, body: 'x'.repeat(10000) }).catch(() => ({ status: 0 }))).status === 200, false, 'an oversized body does not log anyone in')
  const dotted = await request(port, 'GET', '/__gate/../secret', { headers: NAV })
  assert.equal(dotted.status, 303, 'a dotted path is normalised to /secret, which needs a session: not a back door')
  assert.equal(dotted.headers.location, '/__gate/login?next=%2Fsecret')
  await gate.close()
})

test('five wrong tries lock the client, even for the right password, and say for how long', async () => {
  const { gate, port } = await startGate()
  let last
  for (let i = 0; i < 5; i++) last = await post(port, loginBody('kybernos', 'wrong wrong ' + i))
  assert.equal(last.status, 429)
  assert.equal(JSON.parse(last.text).error, 'locked')
  assert.equal(last.headers['retry-after'], '45')
  const right = await post(port, loginBody('kybernos', PASSWORD))
  assert.equal(right.status, 429, 'locked means locked')
  assert.ok(!right.headers['set-cookie'])
  await gate.close()
})

test('behind a trusted proxy the client is the last X-Forwarded-For address, and a forged first one changes nothing', async () => {
  const { gate, port } = await startGate({ KYBERNOS_GATE_TRUST_PROXY: '1' })
  let last
  for (let i = 0; i < 5; i++) last = await post(port, loginBody('kybernos', 'wrong wrong ' + i), { 'x-forwarded-for': `10.9.9.${i}, 203.0.113.7` })
  assert.equal(last.status, 429, 'rotating the first address does not reset the count')
  const other = await post(port, loginBody('kybernos', PASSWORD), { 'x-forwarded-for': '203.0.113.99' })
  assert.equal(other.status, 200, 'a different client is not locked')
  await gate.close()
})

test('without a trusted proxy the forwarded headers are ignored', async () => {
  const { gate, port } = await startGate()
  let last
  for (let i = 0; i < 5; i++) last = await post(port, loginBody('kybernos', 'wrong wrong ' + i), { 'x-forwarded-for': `10.0.0.${i}`, 'x-forwarded-proto': 'https' })
  assert.equal(last.status, 429, 'all five came from the same socket address')
  await gate.close()
})

test('Secure is set only when the proxy says https and is trusted', async () => {
  const trusted = await startGate({ KYBERNOS_GATE_TRUST_PROXY: '1' })
  const a = await post(trusted.port, loginBody('kybernos', PASSWORD), { 'x-forwarded-proto': 'https', 'x-forwarded-host': `127.0.0.1:${trusted.port}` })
  assert.ok([].concat(a.headers['set-cookie']).every((c) => /; Secure$/.test(c)))
  const plain = await startGate()
  const b = await post(plain.port, loginBody('kybernos', PASSWORD), { 'x-forwarded-proto': 'https' })
  assert.ok([].concat(b.headers['set-cookie']).every((c) => !/Secure/.test(c)), 'an untrusted header cannot flip the flag')
  await trusted.gate.close(); await plain.gate.close()
})

test('behind a proxy the Origin is checked against the public host it forwards', async () => {
  const { gate, port } = await startGate({ KYBERNOS_GATE_TRUST_PROXY: '1' })
  const ok = await post(port, loginBody('kybernos', PASSWORD), { origin: 'https://dsh.example.com', 'x-forwarded-host': 'dsh.example.com', 'x-forwarded-proto': 'https' })
  assert.equal(ok.status, 200)
  const bad = await post(port, loginBody('kybernos', PASSWORD), { origin: 'https://evil.example', 'x-forwarded-host': 'dsh.example.com' })
  assert.equal(bad.status, 403)
  await gate.close()
})

test('a WebSocket upgrade needs a session, then tunnels bytes both ways', async () => {
  const { gate, port } = await startGate()
  const refused = await rawUpgrade(port)
  assert.equal(refused.status, 401)
  refused.socket.destroy()
  const { cookies } = await signedIn(port)
  const before = seen.length
  const up = await rawUpgrade(port, { Cookie: cookies })
  assert.equal(up.status, 101)
  assert.ok(/sec-websocket-accept: s3pPLMBiTxaQ9kYGzzhZRbK\+xOo=/i.test(up.head))
  const echoed = await new Promise((resolve) => { up.socket.once('data', (d) => resolve(d.toString())); up.socket.write('ping') })
  assert.equal(echoed, 'echo:ping')
  up.socket.destroy()
  const forwarded = seen.slice(before).find((s) => s.method === 'UPGRADE')
  assert.ok(!/kybernos_gate/.test(forwarded.headers.cookie ?? ''), 'the gate cookie is stripped on upgrades too')
  const gatePath = await rawUpgrade(port, { Cookie: cookies }, '/__gate/login')
  assert.equal(gatePath.status, 404, 'the gate prefix is never proxied')
  gatePath.socket.destroy()
  await gate.close()
})

test('server-sent events are streamed, not buffered', async () => {
  const { gate, port } = await startGate()
  const { cookies } = await signedIn(port)
  const firstAt = await new Promise((resolve, reject) => {
    const started = Date.now()
    http.get({ host: '127.0.0.1', port, path: '/stream', headers: { cookie: cookies } }, (res) => {
      res.once('data', () => { resolve(Date.now() - started); res.destroy() })
    }).on('error', reject)
  })
  assert.ok(firstAt < 300, `first event after ${firstAt} ms: it must not wait for the end of the stream (400 ms)`)
  await gate.close()
})

test('when DSH is down a signed-in user sees the starting page, an API call gets a 502', async () => {
  const dead = net.createServer().listen(0, '127.0.0.1')
  await new Promise((r) => dead.once('listening', r))
  const deadPort = dead.address().port
  await new Promise((r) => dead.close(r))
  const { gate, port } = await startGate({}, {}, () => deadPort)
  const { cookies } = await signedIn(port)
  const page = await request(port, 'GET', '/', { headers: { ...NAV, cookie: cookies } })
  assert.equal(page.status, 503)
  assert.equal(page.headers['retry-after'], '3')
  assert.ok(page.text.includes('Kybernos is starting'))
  const api = await request(port, 'GET', '/api/x', { headers: { cookie: cookies, accept: 'application/json' } })
  assert.equal(api.status, 502)
  await gate.close()
})

test('logout clears both cookies and needs the same origin', async () => {
  const { gate, port } = await startGate()
  const { cookies } = await signedIn(port)
  assert.equal((await request(port, 'POST', '/__gate/logout', { headers: { cookie: cookies } })).status, 403)
  const out = await request(port, 'POST', '/__gate/logout', { headers: { cookie: cookies, origin: `http://127.0.0.1:${port}`, host: `127.0.0.1:${port}` } })
  assert.equal(out.status, 200)
  const cleared = [].concat(out.headers['set-cookie'])
  assert.equal(cleared.length, 2)
  assert.ok(cleared.every((c) => /Max-Age=0/.test(c)))
  assert.equal((await request(port, 'GET', '/__gate/logout')).status, 405)
  await gate.close()
})

test('health answers without a session, unknown gate paths are 404, and a signed-in user is not kept on the login page', async () => {
  const { gate, port } = await startGate()
  assert.equal((await request(port, 'GET', '/__gate/health')).text, 'ok')
  assert.equal((await request(port, 'GET', '/__gate/nope')).status, 404)
  const { cookies } = await signedIn(port)
  const again = await request(port, 'GET', '/__gate/login?next=%2Fsettings', { headers: { ...NAV, cookie: cookies } })
  assert.equal(again.status, 303)
  assert.equal(again.headers.location, '/settings')
  await gate.close()
})

test('a flood of simultaneous guesses from one client is serialised, not run in parallel', async () => {
  const limiter = createLimiter()
  const { gate, port } = await startGate({}, { limiter })
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => post(port, loginBody('kybernos', 'guess guess ' + i))))
  const statuses = results.map((r) => r.status)
  assert.ok(statuses.filter((s) => s === 401).length <= 5, 'at most the tries before the lock were evaluated: ' + statuses.join())
  assert.ok(statuses.some((s) => s === 429))
  await gate.close()
})
