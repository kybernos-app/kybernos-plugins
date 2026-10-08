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

console.log('who may ask')
{
  check('a page of another origin is refused (strict)', mod.sameOriginStrict({ headers: { origin: 'https://evil.example' } }) === false)
  check('no Origin and no Referer: refused', mod.sameOriginStrict({ headers: {} }) === false)
}

api.close()
if (failed > 0) { console.log('\n' + failed + ' check(s) FAILED'); process.exit(1) }
console.log('\nall checks OK')
process.exit(0)
