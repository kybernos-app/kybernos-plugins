#!/usr/bin/env node
/** Test of the same-origin guard of the kybernos-skills POST routes (`sameOrigin`).
 *
 *  DSH serves plugin routes BEFORE its own authentication, and these routes install,
 *  create and switch skills on disk. A browser always sends an `Origin` on a POST: no
 *  Origin (and no Referer) means a caller that is not a browser, and it is refused. The
 *  origin is compared with the REAL listening address of the socket, never with the
 *  client-supplied `Host` header (the old rule compared the two and trusted a forged pair).
 *
 *  The routes are driven through `apply()` on a fake context and web server: no network,
 *  and the only request that gets past the guard is an empty `toggle`, which is rejected
 *  before touching the disk.
 *
 *  Usage: node packages/kybernos-skills/test-origin.mjs   (exit 0 = all pass) */
import { sameOrigin, apply } from './index.js'

let ok0 = 0
let ko = 0
const ok = (nom, cond, detail) => {
  if (cond === true) { ok0 += 1; console.log('  ✓ ' + nom) } else { ko += 1; console.log('  ✗ ' + nom + (detail !== undefined ? ' → ' + JSON.stringify(detail).slice(0, 300) : '')) }
}

const PORT = 3080
const req = (headers = {}, port = PORT) => ({ method: 'POST', headers, socket: { localPort: port } })

console.log('\n── a POST must carry an origin from this machine ──')
ok('no Origin, no Referer → refused (the old rule accepted this)', sameOrigin(req()) === false)
ok('Origin http://127.0.0.1:PORT → allowed', sameOrigin(req({ origin: 'http://127.0.0.1:' + PORT })) === true)
ok('Origin http://localhost:PORT → allowed', sameOrigin(req({ origin: 'http://localhost:' + PORT })) === true)
ok('Origin http://[::1]:PORT → allowed', sameOrigin(req({ origin: 'http://[::1]:' + PORT })) === true)
ok('the port is the real listening port of the socket', sameOrigin(req({ origin: 'http://127.0.0.1:4444' }, 4444)) === true && sameOrigin(req({ origin: 'http://127.0.0.1:4444' }, PORT)) === false)
ok('another local port (another dev server) → refused', sameOrigin(req({ origin: 'http://localhost:5173' })) === false)
ok('a foreign site → refused', sameOrigin(req({ origin: 'https://evil.example' })) === false)
ok('a prefix trick (localhost.evil.example) → refused', sameOrigin(req({ origin: 'http://localhost.evil.example:' + PORT })) === false)
ok('a userinfo trick (127.0.0.1:PORT@evil.example) → refused', sameOrigin(req({ origin: 'http://127.0.0.1:' + PORT + '@evil.example' })) === false)
ok('Origin: null → refused', sameOrigin(req({ origin: 'null' })) === false)
ok('a file: origin → refused', sameOrigin(req({ origin: 'file://' })) === false)
ok('an unparsable origin → refused', sameOrigin(req({ origin: '::::' })) === false)

console.log('\n── the client-supplied Host header proves nothing ──')
ok('Host: 127.0.0.1:PORT but no Origin → refused', sameOrigin(req({ host: '127.0.0.1:' + PORT })) === false)
ok('Origin and Host both forged to attacker.example → refused (the old Host comparison let this through)', sameOrigin(req({ origin: 'http://attacker.example', host: 'attacker.example' })) === false)
ok('a foreign Origin with a loopback Host → refused', sameOrigin(req({ origin: 'https://evil.example', host: '127.0.0.1:' + PORT })) === false)

console.log('\n── Referer is the fallback, Origin wins ──')
ok('Referer from this machine, no Origin → allowed', sameOrigin(req({ referer: 'http://127.0.0.1:' + PORT + '/skills?x=1' })) === true)
ok('Referer from a foreign site, no Origin → refused', sameOrigin(req({ referer: 'https://evil.example/page' })) === false)
ok('foreign Origin + loopback Referer → refused (Origin wins)', sameOrigin(req({ origin: 'https://evil.example', referer: 'http://127.0.0.1:' + PORT + '/' })) === false)

console.log('\n── robustness ──')
ok('no headers object → refused', sameOrigin({ method: 'POST' }) === false)
ok('null / undefined request does not throw and is refused', sameOrigin(null) === false && sameOrigin(undefined) === false)

console.log('\n── through the real routes (apply on a fake context) ──')
const routes = {}
const webServer = { register: (r) => { routes[r.path] = { kind: r.kind, handler: r.handler } } }
apply({ inject (deps, fn) { fn({ get: (nom) => (nom === 'webServer' ? webServer : {}), effect: (f) => f() }) } })
const POSTS = ['toggle', 'create', 'install', 'featured/toggle', 'team/pack', 'team/install'].map((n) => '/kybernos-skills/' + n)
ok('the six POST routes are registered', POSTS.every((p) => routes[p] !== undefined), Object.keys(routes))
const requete = (method, headers, corps) => ({
  method, headers: headers || {}, socket: { localPort: PORT },
  async * [Symbol.asyncIterator] () { if (corps !== undefined) yield Buffer.from(JSON.stringify(corps)) }
})
const reponse = () => { const r = { code: null, corps: null, writeHead (c) { r.code = c }, end (s) { try { r.corps = JSON.parse(s) } catch (e) { r.corps = s } } }; return r }
for (const chemin of POSTS) {
  const r = reponse()
  await routes[chemin].handler(requete('POST', {}, { root: '/tmp', name: 'x', active: true }), r)
  ok('POST ' + chemin + ' without an origin → 403, handler not run', r.code === 403 && r.corps.ok === false, { code: r.code, corps: r.corps })
}
for (const chemin of POSTS) {
  const r = reponse()
  await routes[chemin].handler(requete('POST', { origin: 'https://evil.example', host: 'evil.example' }, {}), r)
  ok('POST ' + chemin + ' from a forged foreign origin → 403', r.code === 403, { code: r.code })
}
{
  const r = reponse()
  await routes['/kybernos-skills/toggle'].handler(requete('POST', { origin: 'http://127.0.0.1:' + PORT }, {}), r)
  ok('POST /toggle from the GUI origin passes the guard (and is refused by its own validation, no disk touched)', r.code === 200 && r.corps.ok === false && /racine absente/.test(r.corps.error), { code: r.code, corps: r.corps })
  const g = reponse()
  await routes['/kybernos-skills/toggle'].handler(requete('GET', { origin: 'http://127.0.0.1:' + PORT }), g)
  ok('a GET on a POST route is still 405 (method guard first)', g.code === 405, { code: g.code })
}

console.log('\nSKILLS ORIGIN — ' + (ok0 + ko) + ' assertions, ' + ko + ' failure(s)')
process.exit(ko === 0 ? 0 : 1)
