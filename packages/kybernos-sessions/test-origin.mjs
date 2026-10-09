#!/usr/bin/env node
/** Test of the same-origin guard of kybernos-sessions (`origineOK`).
 *
 *  DSH serves plugin routes BEFORE its own authentication, so the plugin must refuse a
 *  state-changing request that does not come from the GUI. A browser always sends an
 *  `Origin` on a POST: no Origin (and no Referer) therefore means a caller that is not a
 *  browser, and it is refused. Reads may omit it. The origin is compared with the REAL
 *  listening address of the socket, never with the client-supplied `Host` header.
 *
 *  The routes are driven through `monterRoutes` on a fake web server, in a temporary
 *  directory: no network, no git, nothing outside the directory.
 *
 *  Usage: node packages/kybernos-sessions/test-origin.mjs   (exit 0 = all pass) */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { origineOK, monterRoutes } from './index.js'

let ok0 = 0
let ko = 0
const ok = (nom, cond, detail) => {
  if (cond === true) { ok0 += 1; console.log('  ✓ ' + nom) } else { ko += 1; console.log('  ✗ ' + nom + (detail !== undefined ? ' → ' + JSON.stringify(detail).slice(0, 300) : '')) }
}

const PORT = 3080
const req = (method, headers = {}, port = PORT) => ({ method, headers, socket: { localPort: port } })

console.log('\n── a POST must carry an origin from this machine ──')
ok('no Origin, no Referer → refused (a caller that is not a browser)', origineOK(req('POST')) === false)
ok('Origin http://127.0.0.1:PORT → allowed', origineOK(req('POST', { origin: 'http://127.0.0.1:' + PORT })) === true)
ok('Origin http://localhost:PORT → allowed', origineOK(req('POST', { origin: 'http://localhost:' + PORT })) === true)
ok('Origin http://[::1]:PORT → allowed', origineOK(req('POST', { origin: 'http://[::1]:' + PORT })) === true)
ok('Origin https on the same host and port → allowed', origineOK(req('POST', { origin: 'https://localhost:' + PORT })) === true)
ok('the port is the real listening port of the socket', origineOK(req('POST', { origin: 'http://127.0.0.1:4444' }, 4444)) === true && origineOK(req('POST', { origin: 'http://127.0.0.1:4444' }, PORT)) === false)
ok('another local port (another dev server) → refused', origineOK(req('POST', { origin: 'http://localhost:5173' })) === false)
ok('a foreign site → refused', origineOK(req('POST', { origin: 'https://evil.example' })) === false)
ok('a prefix trick (localhost.evil.example) → refused', origineOK(req('POST', { origin: 'http://localhost.evil.example:' + PORT })) === false)
ok('a suffix trick (127.0.0.1:PORT.evil.example) → refused', origineOK(req('POST', { origin: 'http://127.0.0.1:' + PORT + '.evil.example' })) === false)
ok('a userinfo trick (127.0.0.1:PORT@evil.example) → refused', origineOK(req('POST', { origin: 'http://127.0.0.1:' + PORT + '@evil.example' })) === false)
ok('Origin: null (sandboxed frame, privacy mode) → refused', origineOK(req('POST', { origin: 'null' })) === false)
ok('a file: origin → refused', origineOK(req('POST', { origin: 'file://' })) === false)
ok('a javascript: origin → refused', origineOK(req('POST', { origin: 'javascript:alert(1)' })) === false)
ok('an unparsable origin → refused', origineOK(req('POST', { origin: '::::' })) === false)

console.log('\n── the client-supplied Host header proves nothing ──')
ok('Host: 127.0.0.1:PORT but no Origin → refused', origineOK(req('POST', { host: '127.0.0.1:' + PORT })) === false)
ok('Origin and Host both forged to attacker.example → refused (the old Host comparison let this through)', origineOK(req('POST', { origin: 'http://attacker.example', host: 'attacker.example' })) === false)
ok('a foreign Origin with a loopback Host → refused', origineOK(req('POST', { origin: 'https://evil.example', host: '127.0.0.1:' + PORT })) === false)

console.log('\n── Referer is the fallback, Origin wins ──')
ok('Referer from this machine, no Origin → allowed', origineOK(req('POST', { referer: 'http://127.0.0.1:' + PORT + '/some/page?x=1' })) === true)
ok('Referer from a foreign site, no Origin → refused', origineOK(req('POST', { referer: 'https://evil.example/page' })) === false)
ok('foreign Origin + loopback Referer → refused (Origin wins)', origineOK(req('POST', { origin: 'https://evil.example', referer: 'http://127.0.0.1:' + PORT + '/' })) === false)
ok('loopback Origin + foreign Referer → allowed (Origin wins)', origineOK(req('POST', { origin: 'http://127.0.0.1:' + PORT, referer: 'https://evil.example/' })) === true)

console.log('\n── every method that changes state is held to the same rule ──')
for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'post']) ok(m + ' without an origin → refused', origineOK(req(m)) === false)
for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) ok(m + ' with a good origin → allowed', origineOK(req(m, { origin: 'http://localhost:' + PORT })) === true)

console.log('\n── reads may omit the origin, but never a foreign one ──')
for (const m of ['GET', 'HEAD', 'OPTIONS']) ok(m + ' without an origin → allowed (direct navigation, <img>)', origineOK(req(m)) === true)
ok('GET from this machine → allowed', origineOK(req('GET', { origin: 'http://127.0.0.1:' + PORT })) === true)
ok('GET from a foreign site → refused (DNS rebinding always sends one)', origineOK(req('GET', { origin: 'https://evil.example' })) === false)
ok('GET with Origin: null → refused', origineOK(req('GET', { origin: 'null' })) === false)

console.log('\n── robustness ──')
ok('no headers object at all → refused for POST, allowed for GET', origineOK({ method: 'POST' }) === false && origineOK({ method: 'GET' }) === true)
ok('no socket → only a port-less origin can match', origineOK({ method: 'POST', headers: { origin: 'http://127.0.0.1:' + PORT } }) === false && origineOK({ method: 'POST', headers: { origin: 'http://127.0.0.1' } }) === true)
ok('null / undefined request does not throw', (() => { try { origineOK(null); origineOK(undefined); return true } catch (e) { return false } })())

console.log('\n── through the real routes: EVERY route refuses a POST with no origin ──')
const racine = mkdtempSync(join(tmpdir(), 'ksess-origin-'))
const reglages = join(racine, 'kybernos', 'settings.json')
mkdirSync(join(racine, 'kybernos'), { recursive: true })
const AVANT = JSON.stringify({ pairingToken: 'pt-secret-123', brain: 'a/b' })
writeFileSync(reglages, AVANT)
const routes = {}
monterRoutes({ register: (r) => { routes[r.path] = r.handler } }, { reglagesPath: reglages, categoriesPath: join(racine, 'kybernos', 'categories.json'), sessionsHome: join(racine, 'sessions'), kybersHome: join(racine, 'kybers') })
const chemins = Object.keys(routes)
ok('the routes were registered (at least the 10 known ones)', chemins.length >= 10, chemins)
const requete = (method, path, headers, corps) => ({
  method, url: path, headers: headers || {}, socket: { localPort: PORT },
  on (ev, cb) { if (ev === 'data' && corps !== undefined) cb(JSON.stringify(corps)); if (ev === 'end') cb() }
})
const reponse = () => { const r = { code: null, corps: null, writeHead (c) { r.code = c }, end (s) { try { r.corps = JSON.parse(s) } catch (e) { r.corps = s } } }; return r }
// A read-only route answers a POST with 405 before doing anything: it cannot change state either way.
const LECTURE_SEULE = ['/kybernos-sessions/state']
const refuse = (chemin, r) => (LECTURE_SEULE.indexOf(chemin) !== -1 ? r.code === 405 : r.code === 403)
for (const chemin of chemins) {
  const r = reponse()
  await routes[chemin](requete('POST', chemin, {}, { exec: true, chemin: racine, brain: 'x/y' }), r)
  ok('POST ' + chemin + ' without an origin → ' + (LECTURE_SEULE.indexOf(chemin) !== -1 ? '405 (read-only route)' : '403'), refuse(chemin, r), { code: r.code, corps: r.corps })
}
ok('and nothing was written: settings.json is byte for byte as it was', readFileSync(reglages, 'utf8') === AVANT)
for (const chemin of chemins) {
  const r = reponse()
  await routes[chemin](requete('POST', chemin, { origin: 'https://evil.example' }, {}), r)
  if (!refuse(chemin, r)) ok('POST ' + chemin + ' from a foreign origin is refused', false, { code: r.code })
}
ok('every route also refuses a foreign origin', true)

console.log('\n── the GUI keeps working ──')
{
  const bon = { origin: 'http://127.0.0.1:' + PORT }
  const get = reponse()
  await routes['/kybernos-sessions/settings'](requete('GET', '/kybernos-sessions/settings', {}), get)
  ok('GET /settings without an origin still answers (a plain read)', get.code === 200 && get.corps.ok === true, { code: get.code })
  const post = reponse()
  await routes['/kybernos-sessions/settings'](requete('POST', '/kybernos-sessions/settings', bon, { brain: 'c/d' }), post)
  ok('POST /settings from the GUI origin is accepted', post.code === 200 && post.corps.ok === true, { code: post.code, corps: post.corps })
  ok('and it did its job (secret kept, value written)', JSON.parse(readFileSync(reglages, 'utf8')).brain === 'c/d' && JSON.parse(readFileSync(reglages, 'utf8')).pairingToken === 'pt-secret-123')
  const referer = reponse()
  await routes['/kybernos-sessions/settings'](requete('POST', '/kybernos-sessions/settings', { referer: 'http://localhost:' + PORT + '/' }, { brain: 'e/f' }), referer)
  ok('POST /settings with only a same-machine Referer is accepted', referer.code === 200 && referer.corps.ok === true, { code: referer.code })
  // A value the page sent that is not acceptable is the caller's mistake (400), not a failure of the host (500).
  for (const [nom, corps] of [['brain', { brain: 'x'.repeat(201) }], ['voiceInput', { voiceInput: 'telepathy' }], ['decisionBrain', { decisionBrain: 42 }], ['autoWhitelist', { autoWhitelist: ['a/b', 'a/b'] }]]) {
    const refus = reponse()
    await routes['/kybernos-sessions/settings'](requete('POST', '/kybernos-sessions/settings', bon, corps), refus)
    ok('POST /settings with an invalid ' + nom + ' answers 400 and says why', refus.code === 400 && refus.corps.ok === false && String(refus.corps.erreur).startsWith(nom), { code: refus.code, corps: refus.corps })
  }
  ok('...and the refused values were not written (brain is still the last accepted one)', JSON.parse(readFileSync(reglages, 'utf8')).brain === 'e/f')
  const script = reponse()
  await routes['/kybernos-sessions/categories'](requete('POST', '/kybernos-sessions/categories', { origin: 'http://127.0.0.1:' + PORT, 'sec-fetch-site': 'same-origin', cookie: 'x=1' }, { session: 's1', cat: 'inexistante', titre: 't' }), script)
  ok('the naming script (Node fetch with an explicit origin, as dsh-relance.mjs sends) passes the guard', script.code !== 403, { code: script.code })
}

rmSync(racine, { recursive: true, force: true })
console.log('\nSESSIONS ORIGIN — ' + (ok0 + ko) + ' assertions, ' + ko + ' failure(s)')
process.exit(ko === 0 ? 0 : 1)
