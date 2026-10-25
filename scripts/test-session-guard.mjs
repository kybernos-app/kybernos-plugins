// The write guard (session-guard.mjs) is carried by every bundle that guards a write with DSH's signed session cookie. Bundles are installed on
// their own and import nothing from one another, so each holds a copy of the same file; this test keeps those copies honest:
//   1. every copy is byte-identical, and so is the test helper (lib-session-test.mjs) that sits beside it;
//   2. the copy is kybernos-terminal's own code: its five functions (the terminal's run route is the reference, it started this rule)
//      read the same, word for word, as the terminal's;
//   3. a copy that no host file of its bundle imports is dead code and fails;
//   4. what the guard decides: no Origin and no cookie, a foreign Origin, the right Origin and no cookie, a forged or expired cookie, the
//      right Origin and the real cookie, a hosted instance's public authority, and a machine secret that cannot be read;
//   5. a write that came through the phone link (the marker kybernos-mobile sets on every request it replays) never passes (audit L3-11).
//
//   node scripts/test-session-guard.mjs
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const packages = join(root, 'packages')
let failed = 0
const check = (label, ok, detail) => {
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok || detail === undefined ? '' : '  -- ' + detail))
  if (!ok) failed += 1
}

const copies = readdirSync(packages).filter((p) => existsSync(join(packages, p, 'session-guard.mjs'))).sort()
console.log('copies of session-guard.mjs: ' + copies.join(', '))
check('the guard is carried by the bundles that need it (at least the 7 named by the origin rule)', copies.length >= 7, String(copies.length))
const text = (pkg, file) => readFileSync(join(packages, pkg, file), 'utf8')

// ── 1. identical copies ───────────────────────────────────────────────────────────────────────────────────────
for (const file of ['session-guard.mjs', 'lib-session-test.mjs']) {
  const first = text(copies[0], file)
  for (const pkg of copies.slice(1)) {
    check(pkg + '/' + file + ' is identical to ' + copies[0] + '/' + file, existsSync(join(packages, pkg, file)) && text(pkg, file) === first)
  }
}

// ── 2. the terminal's own code ────────────────────────────────────────────────────────────────────────────────
/** The source of `function name (...) { ... }` as written, by matching braces from its first `{` (these functions hold no brace in a string). */
const functionSource = (source, name) => {
  const start = source.search(new RegExp('function ' + name + ' \\('))
  if (start < 0) return null
  let depth = 0
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') { depth -= 1; if (depth === 0) return source.slice(start, i + 1) }
  }
  return null
}
const terminal = readFileSync(join(packages, 'kybernos-terminal', 'index.js'), 'utf8')
for (const name of ['autorites', 'origineOK', 'dshHome', 'lireSecretSession', 'cookieSessionValide']) check('kybernos-terminal defines ' + name, functionSource(terminal, name) !== null)
for (const pkg of copies) {
  const guard = text(pkg, 'session-guard.mjs')
  const same = ['autorites', 'origineOK', 'dshHome', 'lireSecretSession', 'cookieSessionValide'].filter((name) => functionSource(guard, name) !== functionSource(terminal, name))
  check(pkg + '/session-guard.mjs: its five functions read exactly as the terminal\'s', same.length === 0, same.join(', '))
  for (const pattern of [/^const METHODES_LECTURE = .*$/m, /^const b64url = .*$/m]) {
    const line = pattern.exec(terminal)
    check(pkg + '/session-guard.mjs carries the terminal\'s line ' + pattern.source.slice(1, 22), line !== null && guard.split('\n').includes(line[0]))
  }
}

// ── 3. no dead copy ───────────────────────────────────────────────────────────────────────────────────────────
const hostFiles = (pkg) => readdirSync(join(packages, pkg)).filter((f) => /\.(m?js)$/.test(f) && !/^(test|lib-)/.test(f) && f !== 'client.js' && f !== 'session-guard.mjs')
for (const pkg of copies) {
  const users = hostFiles(pkg).filter((f) => /from '\.\/session-guard\.mjs'/.test(text(pkg, f)))
  check(pkg + ': a host file imports session-guard.mjs', users.length > 0, users.join(', '))
  const tests = readdirSync(join(packages, pkg)).filter((f) => /^test.*\.mjs$/.test(f) && /writeGuard|session-guard|lib-session-test/.test(text(pkg, f)))
  check(pkg + ': a test of its own drives the guard (' + (tests.join(', ') || 'none') + ')', tests.length > 0)
}

// ── 4. what the guard decides ─────────────────────────────────────────────────────────────────────────────────
const { writeGuard, sessionSource } = await import(pathToFileURL(join(packages, copies[0], 'session-guard.mjs')).href)
const { SESSION_SECRET, OTHER_SECRET, sessionCookie } = await import(pathToFileURL(join(packages, copies[0], 'lib-session-test.mjs')).href)
const PORT = 3080
const HOST = '127.0.0.1:' + PORT
const request = (method, headers) => ({ method, headers: { host: HOST, ...headers }, socket: { localPort: PORT } })
const cookie = (authority = HOST, opts) => sessionCookie(authority, opts)
const verdict = (r) => (r === null ? 'allowed' : r.status)
sessionSource.secret = () => SESSION_SECRET
sessionSource.now = () => Date.now()

for (const method of ['POST', 'DELETE', 'PUT']) {
  check(method + ': no Origin and no cookie -> 403', verdict(writeGuard(request(method, {}))) === 403)
  check(method + ': a foreign Origin -> 403 (even with the real cookie)', verdict(writeGuard(request(method, { origin: 'http://evil.example', cookie: cookie() }))) === 403)
  check(method + ': the right Origin and no cookie -> 401', verdict(writeGuard(request(method, { origin: 'http://' + HOST }))) === 401)
  check(method + ': the right Origin and the real cookie -> allowed', verdict(writeGuard(request(method, { origin: 'http://' + HOST, cookie: cookie() }))) === 'allowed')
}
check('a cookie signed with another secret -> 401', verdict(writeGuard(request('POST', { origin: 'http://' + HOST, cookie: cookie(HOST, { secret: OTHER_SECRET }) }))) === 401)
check('an expired cookie -> 401', verdict(writeGuard(request('POST', { origin: 'http://' + HOST, cookie: cookie(HOST, { expiresAt: Date.now() - 1000 }) }))) === 401)
check('a cookie minted for another port -> 401', verdict(writeGuard(request('POST', { origin: 'http://' + HOST, cookie: cookie('127.0.0.1:3081') }))) === 401)
check('the Referer stands in for a missing Origin', verdict(writeGuard(request('POST', { referer: 'http://' + HOST + '/page', cookie: cookie() }))) === 'allowed')
check('a neighbouring port is not this listener -> 403', verdict(writeGuard(request('POST', { origin: 'http://127.0.0.1:3081', cookie: cookie() }))) === 403)
check('127.0.0.1.evil.example is not 127.0.0.1 -> 403', verdict(writeGuard(request('POST', { origin: 'http://127.0.0.1.evil.example:3080', cookie: cookie() }))) === 403)
check('localhost is this listener too', verdict(writeGuard(request('POST', { origin: 'http://localhost:' + PORT, cookie: cookie('localhost:' + PORT) }))) === 'allowed')
check('the answer names a reason', writeGuard(request('POST', {})).error === 'origin refused' && writeGuard(request('POST', { origin: 'http://' + HOST })).error === 'sign-in required')

// ── 5. the phone link ─────────────────────────────────────────────────────────────────────────────────────────
// kybernos-mobile replays a paired phone's requests with the person's own Origin and cookie, plus `x-kybernos-tunnel` (and drops any a phone sends). Origin and
// cookie are then both right, so the marker is the only thing that tells a stolen phone from the person's browser.
const tunnelled = { origin: 'http://' + HOST, cookie: cookie(), 'x-kybernos-tunnel': '1' }
for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
  const refusal = writeGuard(request(method, tunnelled))
  check(method + ': the right Origin, the real cookie and the phone-link marker -> 403 refused_on_phone', refusal !== null && refusal.status === 403 && refusal.error === 'refused_on_phone', JSON.stringify(refusal))
}
check('...whatever the marker\'s value (an empty one counts)', verdict(writeGuard(request('POST', { ...tunnelled, 'x-kybernos-tunnel': '' }))) === 403)
check('...and the same request without the marker is allowed (the marker is the only difference)', verdict(writeGuard(request('POST', { origin: tunnelled.origin, cookie: tunnelled.cookie }))) === 'allowed')
check('a foreign Origin with the marker is still « origin refused » first', writeGuard(request('POST', { ...tunnelled, origin: 'http://evil.example' })).error === 'origin refused')
check('the marker without a cookie is refused 403, not told to sign in', verdict(writeGuard(request('POST', { origin: tunnelled.origin, 'x-kybernos-tunnel': '1' }))) === 403)
for (const method of ['GET', 'HEAD']) check(method + ': a read is not a write, so the phone link still reads the routes that ask for the cookie', verdict(writeGuard(request(method, tunnelled))) === 'allowed')
check('the code is the one the phone page recognises (phone/phone.mjs shows « this cannot be done from the phone »)', /error === 'refused_on_phone'/.test(readFileSync(join(packages, 'kybernos-mobile', 'phone', 'phone.mjs'), 'utf8')))

sessionSource.secret = () => null
check('a machine secret that cannot be read closes the write (503), whatever the headers', verdict(writeGuard(request('POST', { origin: 'http://' + HOST, cookie: cookie() }))) === 503)
check('...but a foreign Origin is still told 403 first', verdict(writeGuard(request('POST', { origin: 'http://evil.example' }))) === 403)
sessionSource.secret = () => SESSION_SECRET

// A hosted instance behind a reverse proxy: the browser's Origin and Host are the public authority, declared to DSH with --trusted-host.
const PUBLIC = 'dsh.example.com'
const KEY = Symbol.for('kybernos.trustedAuthority')
const publicRequest = (headers) => ({ method: 'POST', headers: { host: PUBLIC, ...headers }, socket: { localPort: PORT } })
check('hosted, nothing declared: the public Origin is refused', verdict(writeGuard(publicRequest({ origin: 'https://' + PUBLIC, cookie: cookie(PUBLIC) }))) === 403)
globalThis[KEY] = (host) => host === PUBLIC
check('hosted, declared: the public Origin and a cookie minted for it -> allowed', verdict(writeGuard(publicRequest({ origin: 'https://' + PUBLIC, cookie: cookie(PUBLIC) }))) === 'allowed')
check('hosted, declared: the public Origin and no cookie -> 401', verdict(writeGuard(publicRequest({ origin: 'https://' + PUBLIC }))) === 401)
check('hosted, declared: a cookie signed with another secret -> 401', verdict(writeGuard(publicRequest({ origin: 'https://' + PUBLIC, cookie: cookie(PUBLIC, { secret: OTHER_SECRET }) }))) === 401)
check('hosted, declared: a forged Host cannot borrow the public cookie name', verdict(writeGuard({ method: 'POST', headers: { host: 'evil.example', origin: 'https://' + PUBLIC, cookie: cookie(PUBLIC) }, socket: { localPort: PORT } })) === 401)
check('hosted, declared: another site is still refused', verdict(writeGuard(publicRequest({ origin: 'https://evil.example', cookie: cookie(PUBLIC) }))) === 403)
delete globalThis[KEY]

console.log(failed === 0 ? '\nALL PASS' : '\n' + failed + ' check(s) FAILED')
process.exit(failed === 0 ? 0 : 1)
