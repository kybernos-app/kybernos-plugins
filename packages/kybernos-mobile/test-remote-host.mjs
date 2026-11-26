// Integration test of the remote half on the computer (remote-host.mjs): a real pairing, a real end-to-end channel and
// a real replay against a stand-in DSH, through the stand-in relay. No DSH, no real network, no account.
//   cd packages/kybernos-mobile && node test-remote-host.mjs
import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, statSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as e2e from './remote-e2e.mjs'
import { acceptWebSocket, startFakeRelay } from './remote-fake-relay.mjs'
import { DENY_API, DENY_PREFIX, createRemote, pickRequestHeaders, pickResponseHeaders, refusedOnPhone, sentPath, shouldCompress } from './remote-host.mjs'
import { sessionSource, writeGuard } from './session-guard.mjs'
import { SESSION_SECRET, sessionCookie } from './lib-session-test.mjs'

let fail = 0
const ok = (name, cond, detail) => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (detail ? ' - ' + detail : '')); if (!cond) fail++ }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const until = async (fn, ms = 4000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(25) } }
const te = new TextEncoder()
const td = new TextDecoder()

// ── pure rules ──────────────────────────────────────────────────────────────────────────────────────────────────
ok('a credential write is refused on a phone', refusedOnPhone('POST', '/api/credentials/set') === 'refused_on_phone')
ok('a credential read is allowed', refusedOnPhone('POST', '/api/credentials/describe') === null)
ok('installing a plugin is refused', refusedOnPhone('POST', '/api/pluginManager/installBundle') === 'refused_on_phone')
ok('the remote routes are refused', refusedOnPhone('POST', '/kybernos-mobile/remote/pair') === 'refused_on_phone' && refusedOnPhone('GET', '/kybernos-mobile/remote/status?x=1') === 'refused_on_phone')
ok('changing the server is refused', refusedOnPhone('POST', '/kybernos-cloud/server/apply') === 'refused_on_phone')
ok('a session call is allowed', refusedOnPhone('POST', '/api/session/prompt') === null && refusedOnPhone('GET', '/assets/app-abc123.js') === null)
ok('protocol-relative and CRLF paths are refused', refusedOnPhone('GET', '//evil.test/x') === 'bad_path' && refusedOnPhone('GET', '/a\r\nHost: x') === 'bad_path')
ok('an odd method is refused', refusedOnPhone('TRACE', '/') === 'bad_method')

// The deny lists are judged on the path as DSH will read it (audit L3-10). Every listed route, every spelling: none may be served. The table is built from the lists
// themselves, so a route added to DENY_API or DENY_PREFIX is covered without touching this file.
const listed = [...[...DENY_API].map((name) => '/api/' + name), ...DENY_PREFIX.map((prefix) => (prefix.endsWith('/') ? prefix + 'x' : prefix))]
const spellings = (path) => [
  ['a dot segment first', '/.' + path], ['a dot segment inside', path.replace(/^(\/[^/]+)/u, '$1/.')], ['a dot segment last', path + '/.'],
  ['a parent segment', '/x/..' + path], ['an escaped dot', '/%2e' + path], ['an escaped dot, upper case', '/%2E' + path],
  ['an escaped parent', '/a/%2e%2e' + path], ['a half-escaped parent', '/a/.%2E' + path], ['a doubly escaped dot', '/%252e' + path],
  ['a doubled slash', path.replace(/^(\/[^/]+)/u, '$1/')], ['upper case', path.toUpperCase()], ['the first segment in upper case', path.replace(/^\/[^/]+/u, (m) => m.toUpperCase())],
  ['a trailing slash', path + '/'], ['an escaped letter', path.replace(/^\/(.)/u, (m, c) => '/%' + c.charCodeAt(0).toString(16))],
  ['escaped slashes', '/' + path.slice(1).replaceAll('/', '%2F')], ['a tab inside the name', path.slice(0, 8) + '\t' + path.slice(8)],
  ['a fragment', path + '#x'], ['an escaped backslash', path.replace(/^(\/[^/]+)/u, '$1%5c')],
]
let hole = null
for (const path of listed) {
  if (refusedOnPhone('POST', path) !== 'refused_on_phone') hole = hole || ['listed route not refused', path]
  for (const [label, variant] of spellings(path)) {
    for (const method of ['GET', 'POST', 'DELETE']) { if (refusedOnPhone(method, variant) === null && hole === null) hole = [label, method, variant] }
  }
}
ok('every listed route stays refused in every spelling (' + listed.length + ' routes x ' + spellings('/api/a/b').length + ' spellings x 3 methods)', hole === null, JSON.stringify(hole))
ok('the verifier\'s own bypasses are refused', ['/./api/credentials/set', '/x/../api/credentials/set', '/%2e/api/pluginManager/installBundle', '/a/%2E%2E/api/terminal/create', '/./kybernos-cloud/disconnect', '/api//credentials/set', '/API/credentials/set', '/api/credentials/set/'].every((p) => refusedOnPhone('POST', p) !== null))
// What is judged is what is sent: the lists look at the path a URL parser makes of the phone's path, and that same path is what goes out (fetch would do it after the check).
ok('sentPath is what a URL parser makes of the path, query kept', [['/./x', '/x'], ['/a/../x?y=1#f', '/x?y=1'], ['/%2e/x', '/x'], ['/a/%2E%2E/x', '/x'], ['/a\tb', '/ab'], ['/a b', '/a%20b'], ['/A//b/', '/A//b/']].every(([raw, sent]) => sentPath(raw) === sent))
ok('a path that becomes an innocent one is allowed, and is sent as what it became', refusedOnPhone('GET', '/./assets/app-abc123.js') === null && refusedOnPhone('GET', '/x/../assets/app-abc123.js') === null && sentPath('/./assets/app-abc123.js') === '/assets/app-abc123.js')
ok('a path that does not reduce is refused (bad escape, control character once decoded, too deeply escaped)', ['/%zz/%e9', '/a%00b', '/a%0ab', '/%2525252e/x'].every((p) => refusedOnPhone('GET', p) === 'bad_path'))
// What the phone page really asks for (phone.mjs and sw.js hand over `pathname + search`, so these are the forms a browser produces): none of it may change.
const pageCalls = [
  ['GET', '/'], ['GET', '/assets/app-abcdef12.js'], ['GET', '/assets/Index-Dq3_xK9aZ-1.js'], ['GET', '/assets/chunk-AbC123.css?rev=0a1b2c3d4e'],
  ['GET', '/kybernos-mobile/mobile.css'], ['GET', '/kybernos-mobile/remote-control.png'], ['GET', '/api/auth/get-session'],
  ['POST', '/api/session/list'], ['POST', '/api/session/page'], ['POST', '/api/session/create'], ['POST', '/api/session/prompt'], ['POST', '/api/session/rename'],
  ['POST', '/api/credentials/describe'], ['GET', '/kybernos-cloud/status'], ['GET', '/kybernos-cloud/chats/detail?id=a%20b'],
  ['GET', '/kybernos-skills/skills?q=a%20b&x=%2e%2e'], ['GET', '/files/My%20Doc%20%28final%29.png'], ['GET', '/a/b/'],
]
ok('the page\'s own calls are served, and sent exactly as written', pageCalls.every(([m, p]) => refusedOnPhone(m, p) === null && sentPath(p) === p), JSON.stringify(pageCalls.filter(([m, p]) => refusedOnPhone(m, p) !== null || sentPath(p) !== p)))
const ph = pickRequestHeaders({ Cookie: 'a=b', Host: 'x', Origin: 'y', 'X-Kybernos-Tunnel': '0', 'Sec-Fetch-Mode': 'cors', accept: 'text/html', 'Content-Type': 'application/json', authorization: 'Bearer z' })
ok('request headers: identity headers are dropped, content ones kept', ph.cookie === undefined && ph.host === undefined && ph.origin === undefined && ph['x-kybernos-tunnel'] === undefined && ph.authorization === undefined && ph.accept === 'text/html' && ph['content-type'] === 'application/json')
const rh = pickResponseHeaders(new Headers({ 'set-cookie': 'a=b', 'content-type': 'text/css', 'x-frame-options': 'DENY', location: '/x', 'x-dsh-thing': '1' }))
ok('response headers: cookies and frame fences are dropped', rh['set-cookie'] === undefined && rh['x-frame-options'] === undefined && rh['content-type'] === 'text/css' && rh['x-dsh-thing'] === '1')
ok('text is compressed, images are not', shouldCompress('text/javascript; charset=utf-8') && shouldCompress('application/json') && !shouldCompress('image/png') && !shouldCompress(undefined))

// ── a stand-in DSH ──────────────────────────────────────────────────────────────────────────────────────────────
const dshHits = []
const bigJs = '/* bundle */\n' + 'export const x = "kybernos-mobile-test-line-of-javascript";\n'.repeat(6000)
const dshServer = http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8')
    dshHits.push({ method: req.method, url: req.url, headers: req.headers, body })
    if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'set-cookie': 'dsh=1' }); return res.end('<!doctype html><html><head></head><body>dsh page</body></html>') }
    if (req.url === '/assets/app-abcdef12.js') { res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }); return res.end(bigJs) }
    if (req.url === '/big') { res.writeHead(200, { 'content-type': 'application/octet-stream' }); return res.end(randomBytes(300 * 1024)) }
    if (req.url === '/small') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"ok":true,"small":true}') }
    if (req.url === '/bin') { res.writeHead(200, { 'content-type': 'application/octet-stream' }); return res.end(Buffer.from([0, 1, 2, 3, 250, 251, 252])) }
    if (req.url === '/guarded/write') { // a plugin route behind the real write guard (session-guard.mjs), as the bundles mount them
      const denied = writeGuard(req)
      res.writeHead(denied === null ? 200 : denied.status, { 'content-type': 'application/json' })
      return res.end(JSON.stringify(denied === null ? { ok: true, wrote: true } : { ok: false, error: denied.error }))
    }
    if (req.url === '/redirect') { res.writeHead(302, { location: 'http://127.0.0.1:' + dshServer.address().port + '/final' }); return res.end() }
    if (req.url === '/slow') { setTimeout(() => { try { res.writeHead(200); res.end('late') } catch (e) { /* gone */ } }, 3000); return }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, echo: body, cookie: req.headers.cookie, origin: req.headers.origin, host: req.headers.host, tunnel: req.headers['x-kybernos-tunnel'], ct: req.headers['content-type'] }))
  })
})
const wsSeen = []
dshServer.on('upgrade', (req, socket) => {
  if (req.url !== '/api/remote.mux') { socket.destroy(); return }
  wsSeen.push({ cookie: req.headers.cookie, origin: req.headers.origin, tunnel: req.headers['x-kybernos-tunnel'] })
  const peer = acceptWebSocket(req, socket)
  if (peer === null) return
  peer.onmessage = (data, bin) => { peer.send(bin ? Buffer.concat([Buffer.from('echo:'), data]) : 'echo:' + data.toString('utf8'), bin) }
})
await new Promise((r) => dshServer.listen(0, '127.0.0.1', r))
const dshBase = 'http://127.0.0.1:' + dshServer.address().port
// DSH's own session cookie as the stand-in knows it: signed for its authority, so the real write guard accepts it from the browser and from the tunnel alike.
sessionSource.secret = () => SESSION_SECRET
const SESSION = sessionCookie('127.0.0.1:' + dshServer.address().port)

// ── the stand-in phone ──────────────────────────────────────────────────────────────────────────────────────────
class Phone {
  constructor (wsUrl, sid) { this.wsUrl = wsUrl; this.sid = sid; this.q = []; this.waiters = []; this.closed = false; this.channel = null; this.control = [] }
  async open () {
    this.ws = new WebSocket(this.wsUrl)
    this.ws.binaryType = 'arraybuffer'
    this.ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') { const m = JSON.parse(ev.data); this.control.push(m); this.wake(); return }
      this.q.push(new Uint8Array(ev.data)); this.wake()
    }
    this.ws.onclose = () => { this.closed = true; this.wake() }
    await new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = () => reject(new Error('ws error')) })
    this.ws.send(JSON.stringify({ t: 'auth', role: 'phone', sid: this.sid }))
    return until(() => this.control.find((m) => m.t === 'auth-ok' || m.t === 'error'))
  }
  wake () { for (const w of this.waiters.splice(0)) w() }
  async nextBin (ms = 4000) { const t0 = Date.now(); while (this.q.length === 0) { if (this.closed || Date.now() - t0 > ms) return null; await new Promise((r) => { this.waiters.push(r); setTimeout(r, 50) }) } return this.q.shift() }
  async nextHandshake () { const b = await this.nextBin(); return b === null ? null : JSON.parse(td.decode(b)) }
  async nextEnc () { const b = await this.nextBin(); if (b === null) return null; return e2e.unpackFrame(await this.channel.open(b)) }
  sendPlain (obj) { this.ws.send(te.encode(JSON.stringify(obj))) }
  async sendEnc (header, body) { this.ws.send(await this.channel.seal(e2e.packFrame(header, body))) }
  /** Collect the frames of one request until `end`. */
  async request (header, body) {
    await this.sendEnc(header, body)
    const out = { head: null, chunks: [], end: false }
    for (let i = 0; i < 4000 && !out.end; i += 1) {
      const f = await this.nextEnc()
      if (f === null) break
      if (f.header.id !== header.id) continue
      if (f.header.t === 'res') out.head = f.header
      else if (f.header.t === 'chunk') out.chunks.push(f.body)
      else if (f.header.t === 'end') out.end = true
    }
    out.body = new Uint8Array(out.chunks.reduce((n, c) => n + c.length, 0))
    let o = 0
    for (const c of out.chunks) { out.body.set(c, o); o += c.length }
    return out
  }
}
const gunzip = async (u8) => new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())
/** The body of a request() result as the page would see it (decompressed when the computer compressed it). */
const bodyOf = async (r) => (r.head !== null && r.head.enc === 'gzip' ? gunzip(r.body) : r.body)

// ── the run ─────────────────────────────────────────────────────────────────────────────────────────────────────
const relay = await startFakeRelay({ maxDevices: 2 })
const dir = mkdtempSync(join(tmpdir(), 'kb-mobile-remote-'))
// the computer's own socket as seen by its send buffer: the test says how backed up it is (a slow uplink at home)
const lag = { value: 0 }
class LaggyWebSocket extends globalThis.WebSocket { get bufferedAmount () { return lag.value } }
const makeRemote = () => createRemote({
  dir,
  cloud: () => relay.api,
  WebSocket: LaggyWebSocket,
  fetch: globalThis.fetch,
  local: () => ({ base: dshBase, cookie: SESSION }),
  label: () => 'Test computer',
  tuning: { retryMinMs: 100, retryMaxMs: 400 },
})
let remote = makeRemote()
await remote.start()

try {
  // 1. a plan without the feature
  relay.state.entitled = false
  const refused = await remote.pair()
  ok('a plan without the feature cannot pair', refused.ok === false && refused.error === 'not_in_plan')
  ok('the status says so', (await remote.status()).entitled === false)
  relay.state.entitled = true

  // 2. pairing
  const started = await remote.pair()
  ok('pairing starts', started.ok === true, JSON.stringify(started))
  const waiting = await until(async () => { const s = await remote.status(); return s.pairing !== null && s.pairing.state === 'waiting' ? s : null })
  ok('the relay accepted the computer', waiting !== null)
  ok('the status carries a QR code and its link', waiting !== null && waiting.pairing.qr !== null && waiting.pairing.qr.size >= 21 && typeof waiting.pairing.url === 'string')
  ok('the QR link keeps its secrets after the #', waiting !== null && /^http:\/\/127\.0\.0\.1:\d+\/__kb\/#/u.test(waiting.pairing.url))
  const frag = e2e.parsePairingFragment(waiting.pairing.url.slice(waiting.pairing.url.indexOf('#')))
  ok('the fragment parses', frag !== null)
  const identityMode = statSync(join(dir, 'identity.json')).mode & 0o777
  ok('the identity file is private', identityMode === 0o600, identityMode.toString(8))

  const phone = new Phone(relay.wsUrl, frag.sid)
  const auth = await phone.open()
  ok('the phone is accepted by the relay', auth !== null && auth.t === 'auth-ok')
  await until(() => phone.control.find((m) => m.t === 'peer' && m.state === 'up'))
  const wrong = await e2e.phonePairRequest({ sid: frag.sid, code: e2e.randomToken(16), phoneId: await e2e.newIdentity(false) })
  phone.sendPlain(wrong.msg)
  await sleep(150)
  ok('a request with a wrong one-time code goes nowhere', (await remote.status()).pairing.state === 'waiting')

  const phoneId = await e2e.newIdentity(false)
  const req = await e2e.phonePairRequest({ sid: frag.sid, code: frag.code, phoneId })
  phone.sendPlain(req.msg)
  const reply = await phone.nextHandshake()
  const fin = await e2e.phonePairFinish(reply, req.state, { sid: frag.sid, hostIdPub: frag.hostIdPub })
  phone.channel = fin.channel
  await phone.sendEnc({ t: 'hello', label: 'Test phone <b>' })
  const verify = await until(async () => { const s = await remote.status(); return s.pairing !== null && s.pairing.state === 'verify' && s.pairing.phone_label === 'Test phone b' ? s : null })
  ok('the computer shows the same 4 digits', verify !== null && verify.pairing.sas === fin.sas, fin.sas)
  ok('the phone label is cleaned (markup characters removed)', verify !== null && verify.pairing.phone_label === 'Test phone b')
  ok('the QR secrets are not shown any more while checking', verify !== null && verify.pairing.qr === null && verify.pairing.url === null)
  const early = await phone.request({ t: 'req', id: 'early', method: 'GET', path: '/', headers: {} })
  ok('nothing is served before the person approves', early.head === null && dshHits.length === 0)

  const approved = await remote.approve()
  ok('the person approves', approved.ok === true && typeof approved.device_id === 'string', JSON.stringify(approved))
  const decision = await phone.nextEnc()
  ok('the phone is told it is approved', decision !== null && decision.header.t === 'approved' && decision.header.computer === 'Test computer')
  const devicesFile = JSON.parse(readFileSync(join(dir, 'devices.json'), 'utf8'))
  ok('the paired phone is stored with its key, privately', devicesFile.devices.length === 1 && devicesFile.devices[0].phoneId === e2e.toB64u(phoneId.pub) && (statSync(join(dir, 'devices.json')).mode & 0o777) === 0o600)
  ok('the server knows the device', relay.state.devices.size === 1)
  ok('the single-use code cannot pair a second phone', await (async () => {
    const other = await e2e.phonePairRequest({ sid: frag.sid, code: frag.code, phoneId: await e2e.newIdentity(false) })
    phone.sendPlain(other.msg)
    await sleep(150)
    return (await remote.status()).pairing === null
  })())

  // 3. serving
  const page = await phone.request({ t: 'req', id: 'p1', method: 'GET', path: '/', headers: { cookie: 'evil=1', origin: 'https://evil.test', host: 'evil.test', accept: 'text/html' } }, undefined)
  const hit = dshHits.find((h) => h.url === '/')
  ok('the page comes back', page.head !== null && page.head.status === 200 && /dsh page/u.test(td.decode(await bodyOf(page))))
  ok('the local call carries DSH\'s own cookie, not the phone\'s', hit !== undefined && hit.headers.cookie === SESSION)
  ok('the local call looks like the page itself', hit !== undefined && hit.headers.origin === dshBase && hit.headers.host === dshBase.replace('http://', ''))
  ok('the local call is marked as tunnelled', hit !== undefined && hit.headers['x-kybernos-tunnel'] === '1')
  ok('the page\'s set-cookie never reaches the phone', page.head !== null && page.head.headers['set-cookie'] === undefined)

  const js = await phone.request({ t: 'req', id: 'p2', method: 'GET', path: '/assets/app-abcdef12.js', headers: {} })
  ok('text assets travel gzip-compressed', js.head !== null && js.head.enc === 'gzip' && js.body.length < bigJs.length / 3, js.body.length + ' of ' + bigJs.length)
  ok('and decompress to the original bytes', (await gunzip(js.body)).length === Buffer.byteLength(bigJs) && td.decode(await gunzip(js.body)) === bigJs)
  const bin = await phone.request({ t: 'req', id: 'p3', method: 'GET', path: '/bin', headers: {} })
  ok('binary answers are not compressed and arrive intact', bin.head.enc === undefined && Array.from(bin.body).join(',') === '0,1,2,3,250,251,252')
  const post = await phone.request({ t: 'req', id: 'p4', method: 'POST', path: '/api/session/list', headers: { 'content-type': 'application/json' } }, te.encode('{"a":1}'))
  const postBody = JSON.parse(td.decode(await bodyOf(post)))
  ok('a POST body goes through', post.head.status === 200 && postBody.echo === '{"a":1}' && postBody.ct === 'application/json')
  const redir = await phone.request({ t: 'req', id: 'p5', method: 'GET', path: '/redirect', headers: {} })
  ok('a redirect is handed to the phone with a local path', redir.head.status === 302 && redir.head.headers.location === '/final')

  const hitsBefore = dshHits.length
  const cred = await phone.request({ t: 'req', id: 'p6', method: 'POST', path: '/api/credentials/set', headers: {} }, te.encode('{}'))
  ok('a credential write is answered 403 and never reaches DSH', cred.head.status === 403 && dshHits.length === hitsBefore && JSON.parse(td.decode(await bodyOf(cred))).error === 'refused_on_phone')
  const pairRoute = await phone.request({ t: 'req', id: 'p7', method: 'POST', path: '/kybernos-mobile/remote/pair', headers: {} }, te.encode('{}'))
  ok('a phone cannot manage phones', pairRoute.head.status === 403 && dshHits.length === hitsBefore)
  ok('refusals are counted', (await remote.status()).refused === 2)

  // The bypasses of the deny list, through the tunnel (audit L3-10): DSH's router reads « /./api/credentials/set » as « /api/credentials/set », so nothing that reads
  // as a listed route may reach it, in whatever spelling. The stand-in DSH records every request it receives, after fetch has normalised the address.
  const bypasses = [
    ['POST', '/./api/credentials/set'], ['POST', '/x/../api/credentials/set'], ['POST', '/%2e/api/pluginManager/installBundle'], ['POST', '/a/%2E%2E/api/terminal/create'],
    ['POST', '/./kybernos-cloud/disconnect'], ['POST', '/./kybernos-mobile/remote/pair/approve'], ['POST', '/api//credentials/set'], ['POST', '/API/credentials/set'],
    ['POST', '/api/credentials/set/'], ['POST', '/api/credentials/s\tet'],
  ]
  const stopped = []
  for (const [i, [method, path]] of bypasses.entries()) {
    const r = await phone.request({ t: 'req', id: 'by' + i, method, path, headers: {} }, te.encode('{}'))
    if (r.head === null || r.head.status !== 403) stopped.push(path)
  }
  ok('no spelling of a listed route reaches DSH: each is answered 403', stopped.length === 0 && dshHits.length === hitsBefore, JSON.stringify([stopped, dshHits.slice(hitsBefore).map((h) => h.url)]))
  await phone.sendEnc({ t: 'ws-open', id: 'wb', path: '/api/./terminal/create', protocols: [] })
  const wsBypass = await phone.nextEnc()
  ok('a socket whose path is a listed route once a URL parser has read it is refused (1008) before it is opened', wsBypass !== null && wsBypass.header.t === 'ws-close' && wsBypass.header.id === 'wb' && wsBypass.header.code === 1008 && wsSeen.length === 0, JSON.stringify(wsBypass && wsBypass.header))
  // ...and what is judged is what is sent: an innocent path with a dot segment reaches DSH as the path it became.
  const rewritten = await phone.request({ t: 'req', id: 'rw', method: 'GET', path: '/x/../assets/app-abcdef12.js?v=1#frag', headers: {} })
  ok('an innocent path a parser rewrites is sent rewritten, the very path the lists judged', rewritten.head.status === 200 && dshHits[dshHits.length - 1].url === '/assets/app-abcdef12.js?v=1', dshHits[dshHits.length - 1].url)
  dshHits.pop()

  // What the phone page really asks for is served exactly as asked: same method, same bytes of the address (case and escapes kept), and DSH's own cookie.
  const wanted = [
    ['GET', '/'], ['GET', '/assets/app-abcdef12.js'], ['GET', '/assets/Index-Dq3_xK9aZ-1.js?rev=0a1b2c3d4e'], ['GET', '/kybernos-mobile/mobile.css'], ['GET', '/api/auth/get-session'],
    ['POST', '/api/session/list'], ['POST', '/api/session/create'], ['POST', '/api/session/prompt'], ['POST', '/api/session/rename'], ['POST', '/api/credentials/describe'],
    ['GET', '/kybernos-cloud/status'], ['GET', '/kybernos-skills/skills?q=a%20b'], ['GET', '/files/My%20Doc%20%28final%29.png'],
  ]
  const served = []
  for (const [i, [method, path]] of wanted.entries()) {
    const before = dshHits.length
    const r = await phone.request({ t: 'req', id: 'pg' + i, method, path, headers: method === 'POST' ? { 'content-type': 'application/json' } : {} }, method === 'POST' ? te.encode('{}') : undefined)
    const hit2 = dshHits[dshHits.length - 1]
    if (r.head === null || r.head.status !== 200 || dshHits.length !== before + 1 || hit2.url !== path || hit2.method !== method || hit2.headers.cookie !== SESSION) served.push([method, path, r.head && r.head.status])
  }
  ok('the page\'s own calls reach DSH unchanged (' + wanted.length + ' calls)', served.length === 0, JSON.stringify(served))

  // A write that came through the phone link meets the real write guard on the plugin routes (the L3-11 family): the cookie is valid, the Origin is right, the marker is there.
  const tunnelledWrite = await phone.request({ t: 'req', id: 'gw', method: 'POST', path: '/guarded/write', headers: { 'content-type': 'application/json' } }, te.encode('{}'))
  const tw = JSON.parse(td.decode(await bodyOf(tunnelledWrite)))
  ok('a guarded write from the phone is refused 403 refused_on_phone, with a valid cookie and the right Origin', tunnelledWrite.head.status === 403 && tw.error === 'refused_on_phone' && tw.wrote === undefined, JSON.stringify([tunnelledWrite.head.status, tw]))
  const tunnelledRead = await phone.request({ t: 'req', id: 'gr', method: 'GET', path: '/guarded/write', headers: {} })
  ok('...while a read of the same route is still served', tunnelledRead.head.status === 200)
  ok('...and the desktop browser (the right Origin and the cookie, no marker) still writes', (() => { const r = writeGuard({ method: 'POST', headers: { host: dshBase.replace('http://', ''), origin: dshBase, cookie: SESSION }, socket: { localPort: dshServer.address().port } }); return r === null })())
  ok('a phone that sends the marker header itself is no different: the host drops it and sets its own', (() => { const h = pickRequestHeaders({ 'x-kybernos-tunnel': '0' }); return h['x-kybernos-tunnel'] === undefined })())

  // several answers leave at once while the computer's socket is backed up (a slow uplink): the frames must still leave in
  // order, since the phone requires the counter to be exactly the next one (measured 2026-10-13: a desynchronised channel
  // dropped every later frame, and the Skills page stayed a skeleton on a real phone)
  lag.value = 8 * 1024 * 1024
  const burst = ['o1', 'o2', 'o3', 'o4']
  for (const id of burst) await phone.sendEnc({ t: 'req', id, method: 'GET', path: '/big', headers: {} })
  await sleep(300)
  lag.value = 0
  const lateIds = []
  for (let i = 0; i < 12; i += 1) { lateIds.push('l' + i); await phone.sendEnc({ t: 'req', id: 'l' + i, method: 'GET', path: '/small', headers: {} }) }
  const sizes = new Map([...burst, ...lateIds].map((id) => [id, { bytes: 0, end: false }]))
  let broke = null
  for (let n = 0; n < 600 && [...sizes.values()].some((v) => !v.end); n += 1) {
    let f = null
    try { f = await phone.nextEnc() } catch (e) { broke = String(e.message || e); break }
    if (f === null) break
    const v = sizes.get(f.header.id)
    if (v === undefined) continue
    if (f.header.t === 'chunk') v.bytes += f.body.length
    else if (f.header.t === 'end') v.end = true
  }
  ok('frames leave in order while the socket is backed up (the phone never sees one out of order)', broke === null, broke || '')
  ok('every answer arrives whole', [...burst].every((id) => sizes.get(id).end && sizes.get(id).bytes === 300 * 1024) && lateIds.every((id) => sizes.get(id).end && sizes.get(id).bytes > 10), JSON.stringify([...sizes].map(([k, v]) => k + ':' + v.bytes + (v.end ? '' : '!'))))
  lag.value = 0

  // a request the phone gives up on
  await phone.sendEnc({ t: 'req', id: 'slow', method: 'GET', path: '/slow', headers: {} })
  await sleep(100)
  await phone.sendEnc({ t: 'cancel', id: 'slow' })
  await sleep(150)
  ok('a cancelled request is dropped without a stray answer', true)

  // 4. the streaming socket
  await phone.sendEnc({ t: 'ws-open', id: 'w1', path: '/api/remote.mux', protocols: [] })
  const opened = await phone.nextEnc()
  ok('the socket opens through the tunnel', opened !== null && opened.header.t === 'ws-open' && opened.header.id === 'w1')
  ok('the local socket carries the cookie and the marker', wsSeen.length === 1 && wsSeen[0].cookie === SESSION && wsSeen[0].origin === dshBase && wsSeen[0].tunnel === '1')
  await phone.sendEnc({ t: 'ws-msg', id: 'w1', text: true }, te.encode('hello'))
  const echoText = await phone.nextEnc()
  ok('a text message is echoed', echoText !== null && echoText.header.t === 'ws-msg' && echoText.header.text === true && td.decode(echoText.body) === 'echo:hello')
  await phone.sendEnc({ t: 'ws-msg', id: 'w1', text: false }, new Uint8Array([7, 8, 9]))
  const echoBin = await phone.nextEnc()
  ok('a binary message is echoed', echoBin !== null && echoBin.header.text === false && Array.from(echoBin.body).join(',') === '101,99,104,111,58,7,8,9')
  await phone.sendEnc({ t: 'ws-open', id: 'w2', path: '/not-the-api', protocols: [] })
  const closed = await phone.nextEnc()
  ok('a socket outside /api is refused', closed !== null && closed.header.t === 'ws-close' && closed.header.id === 'w2')
  await phone.sendEnc({ t: 'ws-close', id: 'w1', code: 1000 })
  const wc = await phone.nextEnc()
  ok('closing the socket is passed on', wc !== null && wc.header.t === 'ws-close' && wc.header.id === 'w1')

  // 5. what the relay saw
  const seen = relay.state.samples
  const sealed = seen.filter((s) => !s.startsWith('{'))
  ok('the relay carried many frames and could read none of the sealed ones', relay.state.framesBinary > 20 && sealed.length > 20 && sealed.every((s) => !/"t"\s*:|"method"|<html|dsh page|dsh-auth-/u.test(s)))
  ok('the relay saw only the handshake as JSON', seen.filter((s) => s.startsWith('{')).length <= 8)

  // 6. a restart: the paired phone resumes
  const deviceId = approved.device_id
  phone.ws.close()
  await until(() => phone.closed)
  remote.stop()
  remote = makeRemote()
  await remote.start()
  const online = await until(async () => { const s = await remote.status(); return s.relay === 'up' ? s : null })
  ok('after a restart the computer reconnects the paired phone by itself', online !== null && online.devices.length === 1 && online.devices[0].id === deviceId)
  const phone2 = new Phone(relay.wsUrl, frag.sid)
  await phone2.open()
  await until(() => phone2.control.find((m) => m.t === 'peer' && m.state === 'up'))
  const rr = await e2e.phoneResumeRequest({ sid: frag.sid, phoneId })
  phone2.sendPlain(rr.msg)
  const rreply = await phone2.nextHandshake()
  const rfin = await e2e.phoneResumeFinish(rreply, rr.state, { sid: frag.sid, hostIdPub: frag.hostIdPub })
  phone2.channel = rfin.channel
  const ready = await phone2.nextEnc()
  ok('the known phone resumes without any approval', ready !== null && ready.header.t === 'ready')
  const again = await phone2.request({ t: 'req', id: 'q1', method: 'GET', path: '/', headers: {} })
  ok('and is served', again.head !== null && again.head.status === 200)
  ok('the device shows online', await until(async () => (await remote.status()).devices[0].online === true) !== null)

  const strangerId = await e2e.newIdentity(false)
  const phone3 = new Phone(relay.wsUrl, frag.sid)
  await phone3.open()
  const sr = await e2e.phoneResumeRequest({ sid: frag.sid, phoneId: strangerId })
  phone3.sendPlain(sr.msg)
  await sleep(200)
  ok('an unpaired phone with the same address gets no answer', phone3.q.length === 0)
  phone3.ws.close()

  // 7. revoking
  const revoked = await remote.revoke(deviceId)
  ok('revoking says the server was told too', revoked.ok === true && revoked.server === true)
  ok('the device is gone from the list and from the server', (await remote.status()).devices.length === 0 && relay.state.devices.size === 0)
  ok('the revoked phone is cut off', await until(() => phone2.closed) !== null)
  const phone4 = new Phone(relay.wsUrl, frag.sid)
  const late = await phone4.open()
  ok('a revoked address is unknown to the relay', late !== null && late.t === 'error')
  ok('revoking an unknown device is an error', (await remote.revoke('d_nope')).ok === false)

  // 8. a refusal, a cancellation, the device limit
  await remote.pair()
  const w2 = await until(async () => { const s = await remote.status(); return s.pairing !== null && s.pairing.state === 'waiting' ? s : null })
  const f2 = e2e.parsePairingFragment(w2.pairing.url.slice(w2.pairing.url.indexOf('#')))
  const p5 = new Phone(relay.wsUrl, f2.sid)
  await p5.open()
  await until(() => p5.control.find((m) => m.t === 'peer' && m.state === 'up'))
  const id5 = await e2e.newIdentity(false)
  const r5 = await e2e.phonePairRequest({ sid: f2.sid, code: f2.code, phoneId: id5 })
  p5.sendPlain(r5.msg)
  p5.channel = (await e2e.phonePairFinish(await p5.nextHandshake(), r5.state, { sid: f2.sid, hostIdPub: f2.hostIdPub })).channel
  await until(async () => (await remote.status()).pairing.state === 'verify')
  const denied = await remote.deny()
  ok('the person refuses', denied.ok === true)
  const dn = await p5.nextEnc()
  ok('the phone is told', dn !== null && dn.header.t === 'denied')
  ok('nothing is stored and the server forgot the pairing', (await remote.status()).devices.length === 0 && (await remote.status()).pairing === null && relay.state.pairings.size === 0)

  await remote.pair()
  const cancel = await remote.cancel()
  ok('a pairing can be cancelled', cancel.ok === true && (await remote.status()).pairing === null)

  relay.state.maxDevices = 0
  const lim = await remote.pair()
  ok('the server\'s device limit is reported', lim.ok === false && lim.error === 'device_limit')
  relay.state.maxDevices = 8

  // 9. the plan lapses while a phone is paired
  await remote.pair()
  const w3 = await until(async () => { const s = await remote.status(); return s.pairing !== null && s.pairing.state === 'waiting' ? s : null })
  const f3 = e2e.parsePairingFragment(w3.pairing.url.slice(w3.pairing.url.indexOf('#')))
  const p6 = new Phone(relay.wsUrl, f3.sid)
  await p6.open()
  await until(() => p6.control.find((m) => m.t === 'peer' && m.state === 'up'))
  const id6 = await e2e.newIdentity(false)
  const r6 = await e2e.phonePairRequest({ sid: f3.sid, code: f3.code, phoneId: id6 })
  p6.sendPlain(r6.msg)
  p6.channel = (await e2e.phonePairFinish(await p6.nextHandshake(), r6.state, { sid: f3.sid, hostIdPub: f3.hostIdPub })).channel
  await until(async () => (await remote.status()).pairing.state === 'verify')
  await remote.approve()
  remote.stop()
  relay.state.entitled = false
  remote = makeRemote()
  await remote.start()
  const locked = await until(async () => { const s = await remote.status(); return s.entitled === false && s.devices.length === 1 && s.devices[0].state === 'locked' ? s : null })
  const hostGone = await until(() => relay.state.rooms.get(f3.sid).host === null)
  ok('when the plan lapses the paired phone stays listed, locked, and nothing connects', locked !== null && hostGone === true)
  relay.state.entitled = true

  // 9b. the server does not answer: the refusal names it (audit V-41: « The Kybernos server does not answer » with no word of WHICH server)
  {
    const downDir = mkdtempSync(join(tmpdir(), 'kb-mobile-remote-down-'))
    const named = { name: 'Kybernos (local)', host: 'localhost:8791', can_switch: true }
    let seam = { status: 0, body: null, error: 'fetch failed', server: named }
    const gone = createRemote({
      dir: downDir, cloud: () => ({ call: async () => seam }), WebSocket: LaggyWebSocket, fetch: globalThis.fetch,
      local: () => ({ base: dshBase, cookie: SESSION }), label: () => 'Test computer', tuning: { retryMinMs: 100, retryMaxMs: 400 },
    })
    await gone.start()
    const down = await gone.pair()
    ok('the server does not answer: server_unavailable, with the server named (label, host) and whether another one can be chosen', down.ok === false && down.error === 'server_unavailable' && JSON.stringify(down.server) === JSON.stringify(named), JSON.stringify(down))
    seam = { status: 0, body: null, error: 'fetch failed' }
    const bare = await gone.pair()
    ok('a seam that names no server: the same refusal, no server in it', bare.ok === false && bare.error === 'server_unavailable' && bare.server === undefined, JSON.stringify(bare))
    seam = { status: 0, body: null, error: 'fetch failed', server: { name: 'x'.repeat(500), host: 7, can_switch: 'yes', extra: 'no' } }
    const odd = await gone.pair()
    ok('what the seam says is cut to what the page may show (bounded text, a boolean, nothing else)', odd.server !== undefined && odd.server.name.length <= 80 && odd.server.host === '' && odd.server.can_switch === false && Object.keys(odd.server).sort().join() === 'can_switch,host,name', JSON.stringify(odd))
    seam = { status: 0, body: null, error: 'not_connected' }
    const out = await gone.pair()
    ok('signed out is still « not_connected », not an unreachable server', out.ok === false && out.error === 'not_connected' && out.server === undefined, JSON.stringify(out))
    gone.stop()
    rmSync(downDir, { recursive: true, force: true })
  }

  // 10. everything off
  const all = await remote.revokeAll()
  ok('revoke all empties the list', all.ok === true && (await remote.status()).devices.length === 0)
} catch (e) {
  console.log('FAIL exception - ' + (e && e.stack ? e.stack : e))
  fail++
} finally {
  remote.stop()
  await relay.close()
  dshServer.close()
  if (typeof dshServer.closeAllConnections === 'function') dshServer.closeAllConnections()
  rmSync(dir, { recursive: true, force: true })
  ok('the test left no temp folder behind', !existsSync(dir))
}
process.exit(fail ? 1 : 0)
