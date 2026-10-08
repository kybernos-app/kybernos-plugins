// Tests of the host route that opens the team console in the user's browser (/kybernos-cloud/console/link).
//   node packages/kybernos-cloud/test-console-link.mjs
//
// The server serves the console page and, in a browser, uses the person's own session; DSH holds only a device token, which must never go through a
// browser. So DSH asks the server for a single-use link and hands THAT to the browser. What matters here: the token goes out in an Authorization header
// and nowhere else, the link is returned only when it points at the server this account is connected to, a workspace that is not the account's is
// never asked for, and a page of another origin cannot ask DSH for a link.
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}

const W1 = '11111111-1111-4111-8111-111111111111'
const WX = '99999999-9999-4999-8999-999999999999'
const TOKEN = 'kys-secret-token-0123456789'

const seen = []
let origin = ''
let answer = null
const api = createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization || null, body: raw })
    const a = typeof answer === 'function' ? answer() : answer
    res.writeHead(a.status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(a.body))
  })
})
await new Promise((r) => api.listen(0, '127.0.0.1', r))
origin = 'http://127.0.0.1:' + api.address().port
const good = () => ({ status: 200, body: { url: origin + '/api/auth/magic-link/verify?token=abc&callbackURL=%2Fconsole', expires_in: 60 } })

const dir = mkdtempSync(join(tmpdir(), 'kb-console-link-'))
process.env.KYBERNOS_CLOUD_API = origin
process.env.KYBERNOS_CLOUD_STATE = join(dir, 'state.json')
const writeState = (state) => writeFileSync(process.env.KYBERNOS_CLOUD_STATE, JSON.stringify(state))
const connected = { token: TOKEN, user: { email: 'a@b.test' }, workspaces: [{ id: W1, name: 'Acme' }], active_workspace_id: W1 }

const mod = await import('./index.js')
const route = mod.ROUTES.find((r) => r.path === '/kybernos-cloud/console/link')

console.log('the route')
check('it is a strict, guarded POST with a small body', route !== undefined && route.method === 'POST' && route.guarded === true && route.strict === true && route.body === true && route.cap <= 4096, JSON.stringify(route && { m: route.method, g: route.guarded, s: route.strict, c: route.cap }))

console.log('what it does')
{
  writeState({})
  seen.length = 0
  answer = good
  const none = await mod.consoleLink({}, {})
  check('not connected: nothing is called', none.ok === false && none.connected === false && seen.length === 0, JSON.stringify(none))

  writeState(connected)
  const r = await mod.consoleLink({}, {})
  check('the link comes back, for this server', r.ok === true && r.url.startsWith(origin + '/api/auth/magic-link/verify?token=abc') && r.expires_in === 60, JSON.stringify(r))
  check('one POST to /v1/console/link, token as Authorization, an empty body', seen.length === 1 && seen[0].method === 'POST' && seen[0].url === '/v1/console/link' && seen[0].auth === 'Bearer ' + TOKEN && seen[0].body === '{}', JSON.stringify(seen))
  check('the token is nowhere in the answer', JSON.stringify(r).indexOf(TOKEN) < 0)

  seen.length = 0
  const w = await mod.consoleLink({}, { workspace_id: W1.toUpperCase() })
  check('a workspace of the account is forwarded (lower-cased)', w.ok === true && seen.length === 1 && JSON.parse(seen[0].body).workspace_id === W1, JSON.stringify(seen))

  seen.length = 0
  const other = await mod.consoleLink({}, { workspace_id: WX })
  const bad = await mod.consoleLink({}, { workspace_id: 'not-a-uuid" , "admin": true' })
  check('a workspace that is not the account\'s, or not an id, is refused with no call', other.ok === false && other.error === 'espace_inconnu' && bad.ok === false && seen.length === 0, JSON.stringify([other, bad, seen]))
}

console.log('what it will not hand to a browser')
{
  writeState(connected)
  for (const [label, url] of [
    ['a link on another origin', 'https://evil.example/api/auth/magic-link/verify?token=abc'],
    ['the same host on another port', 'http://127.0.0.1:1/api/auth/magic-link/verify?token=abc'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['something that is not a URL', 'not a url'],
    ['no URL at all', undefined],
  ]) {
    answer = () => ({ status: 200, body: { url, expires_in: 60 } })
    const r = await mod.consoleLink({}, {})
    check(label + ': refused, and no link in the answer', r.ok === false && r.error === 'lien_invalide' && r.url === undefined, JSON.stringify(r))
  }
  answer = () => ({ status: 403, body: { error: 'forbidden' } })
  const refused = await mod.consoleLink({}, {})
  check('a refusal by the server comes back as a refusal', refused.ok === false && refused.status === 403 && refused.url === undefined, JSON.stringify(refused))
  answer = () => ({ status: 200, body: null })
  check('an empty answer is a refusal, not a crash', (await mod.consoleLink({}, {})).ok === false)
}

console.log('opening the system browser (the server only accepts a link a person\'s OS opens)')
{
  // A tab a page opens, pointed at the link, is a « cross-site » navigation: the server refuses it (ADR 0005 § 5) and the person lands on « link expired ». The host,
  // which runs on the person's machine, opens the SYSTEM browser instead: that navigation carries no such mark. The tests never open a real browser: the opener is injected.
  writeState(connected)
  answer = good
  const loopback = { socket: { remoteAddress: '127.0.0.1' }, headers: {} }
  const opened = []
  const opener = (result) => async (url) => { opened.push(url); return result }

  seen.length = 0
  let r = await mod.consoleLink(loopback, { open: true }, { openExternal: opener(true) })
  check('open: the host opens the link itself and does not hand it to the page', r.ok === true && r.opened === true && r.url === undefined && opened.length === 1 && opened[0].startsWith(origin + '/api/auth/magic-link/verify?token=abc'), JSON.stringify([r, opened]))
  check('the answer still carries no token', JSON.stringify(r).indexOf(TOKEN) < 0)

  opened.length = 0
  r = await mod.consoleLink(loopback, { open: true }, { openExternal: opener(false) })
  check('a host that cannot open a browser hands the address back, opened: false', r.ok === true && r.opened === false && typeof r.url === 'string' && r.url.startsWith(origin + '/api/auth/magic-link/verify?token=abc') && opened.length === 1, JSON.stringify(r))

  opened.length = 0
  r = await mod.consoleLink(loopback, {}, { openExternal: opener(true) })
  check('without the wish to open, nothing is opened and the address comes back as before', r.ok === true && r.url !== undefined && r.opened === undefined && opened.length === 0, JSON.stringify(r))

  for (const [label, peer] of [['a peer that is not on this machine', '10.1.2.3'], ['an unknown peer', undefined]]) {
    opened.length = 0
    r = await mod.consoleLink({ socket: { remoteAddress: peer }, headers: {} }, { open: true }, { openExternal: opener(true) })
    check(label + ': no browser is opened on this machine; the address comes back', r.ok === true && r.opened === false && typeof r.url === 'string' && opened.length === 0, JSON.stringify(r))
  }
  for (const peer of ['::1', '::ffff:127.0.0.1']) {
    opened.length = 0
    r = await mod.consoleLink({ socket: { remoteAddress: peer }, headers: {} }, { open: true }, { openExternal: opener(true) })
    check('a loopback peer (' + peer + ') may have a browser opened', r.opened === true && opened.length === 1, JSON.stringify(r))
  }

  opened.length = 0
  answer = () => ({ status: 200, body: { url: 'https://evil.example/api/auth/magic-link/verify?token=abc', expires_in: 60 } })
  r = await mod.consoleLink(loopback, { open: true }, { openExternal: opener(true) })
  check('a link for another origin is never opened', r.ok === false && r.error === 'lien_invalide' && opened.length === 0, JSON.stringify([r, opened]))
  answer = good

  opened.length = 0
  r = await mod.consoleLink(loopback, { open: true }, { openExternal: async () => { throw new Error('boom') } })
  check('an opener that throws is « could not open », not a crash and not a lost link', r.ok === true && r.opened === false && typeof r.url === 'string', JSON.stringify(r))
  r = await mod.consoleLink(loopback, { open: 'yes' }, { openExternal: opener(true) })
  check('only a true « open » opens anything', r.opened === undefined && opened.length === 0, JSON.stringify(r))
}

console.log('the system opener itself')
{
  const make = (events) => {
    const calls = []
    const spawnFn = (cmd, args, options) => {
      calls.push({ cmd, args, options })
      const handlers = {}
      const child = { once: (name, fn) => { handlers[name] = fn; return child }, unref: () => {} }
      setImmediate(() => { if (events.error !== undefined) handlers.error?.(events.error); else if (events.exit !== undefined) handlers.exit?.(events.exit) })
      return child
    }
    return { calls, spawnFn }
  }
  const URL1 = 'https://srv.example/api/auth/magic-link/verify?token=a&b=c&callbackURL=%2Fconsole'
  let m = make({ exit: 0 })
  check('macOS: `open <url>`, one argument, no shell', (await mod.openExternal(URL1, { platform: 'darwin', env: {}, spawnFn: m.spawnFn })) === true && m.calls[0].cmd === 'open' && m.calls[0].args.length === 1 && m.calls[0].args[0] === URL1 && m.calls[0].options.shell !== true, JSON.stringify(m.calls))
  m = make({ exit: 0 })
  check('Windows: the URL is ONE argument of the URL handler (an & in it is not a shell command)', (await mod.openExternal(URL1, { platform: 'win32', env: {}, spawnFn: m.spawnFn })) === true && m.calls[0].cmd === 'rundll32' && m.calls[0].args.join('|') === 'url.dll,FileProtocolHandler|' + URL1 && m.calls[0].options.shell !== true, JSON.stringify(m.calls))
  m = make({ exit: 0 })
  check('Linux with a display: xdg-open', (await mod.openExternal(URL1, { platform: 'linux', env: { DISPLAY: ':0' }, spawnFn: m.spawnFn })) === true && m.calls[0].cmd === 'xdg-open' && m.calls[0].args[0] === URL1, JSON.stringify(m.calls))
  m = make({ exit: 0 })
  check('Linux with no display: not opened, nothing started', (await mod.openExternal(URL1, { platform: 'linux', env: {}, spawnFn: m.spawnFn })) === false && m.calls.length === 0)
  m = make({ exit: 1 })
  check('an opener that exits with an error is « not opened »', (await mod.openExternal(URL1, { platform: 'darwin', env: {}, spawnFn: m.spawnFn })) === false)
  m = make({ error: new Error('ENOENT') })
  check('an opener that is not there is « not opened »', (await mod.openExternal(URL1, { platform: 'linux', env: { WAYLAND_DISPLAY: 'wayland-0' }, spawnFn: m.spawnFn })) === false)
  check('a spawn that throws is « not opened »', (await mod.openExternal(URL1, { platform: 'darwin', env: {}, spawnFn: () => { throw new Error('x') } })) === false)
  m = make({})
  check('an opener that is still handing over after the time allowed counts as opened', (await mod.openExternal(URL1, { platform: 'darwin', env: {}, spawnFn: m.spawnFn, waitMs: 20 })) === true)
  for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'ftp://x/y', 'not a url', '']) {
    m = make({ exit: 0 })
    check('« ' + bad + ' » is never handed to the system', (await mod.openExternal(bad, { platform: 'darwin', env: {}, spawnFn: m.spawnFn })) === false && m.calls.length === 0)
  }
}

console.log('who may ask')
{
  check('a page of another origin is refused (strict)', mod.sameOriginStrict({ headers: { origin: 'https://evil.example' } }) === false)
  check('no Origin and no Referer: refused', mod.sameOriginStrict({ headers: {} }) === false)
}

api.close()
if (failed > 0) { console.log('\n' + failed + ' check(s) FAILED'); process.exit(1) }
console.log('\nall checks OK')
process.exit(0)
