// The routes that START and STOP an install (/installer runs `brew install ollama` and `ollama pull`, /annuler ends that process), and (A-16) the
// catalogue's refresh and the "Re-check" scan, need DSH's
// signed session as well as the right Origin. DSH serves plugin routes before its own login and an Origin header is forgeable by any local
// program: before this rule `curl -X POST http://127.0.0.1:<port>/modeles-locaux/installer -d '{"cible":"ollama"}'` started the install.
//
// For each, in this order: no Origin and no cookie · a foreign Origin (even with the real cookie) · the right Origin and no cookie (what a
// local program sends) · the right Origin and a forged cookie · the right Origin and the real cookie (the Local models page). The bodies are
// chosen so that even the real pair starts nothing here (an empty target is a 400, a cancel with no job a no-op).
//
//   node packages/kybernos-modeles-locaux/test-write-guard.mjs
import { apply } from './index.js'
import { sessionSource } from './session-guard.mjs'
import { OTHER_SECRET, SESSION_SECRET, browserHeaders, sessionCookie } from './lib-session-test.mjs'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}
sessionSource.secret = () => SESSION_SECRET

const routes = {}
const webServer = { register: (r) => { routes[r.path] = r.handler; return () => {} } }
const hostCtx = { get: () => webServer, effect: (fn) => fn() }
apply({ inject: (_names, cb) => cb(hostCtx) })

const hit = async (path, method, headers, body = {}) => {
  const raw = JSON.stringify(body)
  const req = { method, url: path, headers: { host: '127.0.0.1:3080', 'content-type': 'application/json', ...headers }, socket: { localPort: 3080 }, on (ev, cb) { if (ev === 'data') cb(Buffer.from(raw)); if (ev === 'end') cb() } }
  const out = { status: 0 }
  await routes[path](req, { writeHead (s) { out.status = s }, setHeader () {}, end () {} })
  return out.status
}

for (const path of ['/modeles-locaux/installer', '/modeles-locaux/annuler']) {
  check(path + ' is mounted', typeof routes[path] === 'function')
  const body = { cible: '' } // never starts anything, even when the guard lets it through
  check(path + ': no Origin and no cookie -> 403', await hit(path, 'POST', {}, body) === 403)
  check(path + ': a foreign Origin -> 403, even with the real cookie', await hit(path, 'POST', { ...browserHeaders(), origin: 'http://evil.example' }, body) === 403)
  check(path + ': the right Origin and no cookie -> 401', await hit(path, 'POST', { origin: 'http://127.0.0.1:3080' }, body) === 401)
  check(path + ': the right Origin and a forged cookie -> 401', await hit(path, 'POST', { origin: 'http://127.0.0.1:3080', cookie: sessionCookie(undefined, { secret: OTHER_SECRET }) }, body) === 401)
  const real = await hit(path, 'POST', browserHeaders(), body)
  check(path + ': the right Origin and the real cookie -> the route answers (' + real + ')', real === 200 || real === 400, real)
  check(path + ': GET stays "method not allowed" (405), whatever the headers', await hit(path, 'GET', browserHeaders()) === 405)
}
// A-16: the two writes whose caller is the Local models page — the signed catalogue refresh ({op:'refresh'} downloads and verifies the
// online catalogue) and the "Re-check" scan (it stores the ids seen last time). An unknown op / no Ollama server answers without side effects.
for (const [path, body] of [['/modeles-locaux/catalogue', {}], ['/modeles-locaux/decouvrir', {}]]) {
  check(path + ' is mounted', typeof routes[path] === 'function')
  check(path + ': no Origin and no cookie -> 403', await hit(path, 'POST', {}, body) === 403)
  check(path + ': a foreign Origin -> 403, even with the real cookie', await hit(path, 'POST', { ...browserHeaders(), origin: 'http://evil.example' }, body) === 403)
  check(path + ': the right Origin and no cookie -> 401', await hit(path, 'POST', { origin: 'http://127.0.0.1:3080' }, body) === 401)
  check(path + ': the right Origin and a forged cookie -> 401', await hit(path, 'POST', { origin: 'http://127.0.0.1:3080', cookie: sessionCookie(undefined, { secret: OTHER_SECRET }) }, body) === 401)
  const real = await hit(path, 'POST', browserHeaders(), body)
  check(path + ': the right Origin and the real cookie -> the route answers (' + real + ')', real === 200 || real === 400, real)
}
check('the catalogue READ still answers with no header (a GET carries no Origin): the shipped list', await hit('/modeles-locaux/catalogue', 'GET', {}) === 200)
check('the reads keep answering with no header: machine', await hit('/modeles-locaux/machine', 'GET', {}) === 200)
check('the reads keep answering with no header: installation (the job state)', await hit('/modeles-locaux/installation', 'GET', {}) === 200)

console.log(failed === 0 ? '\nall green' : '\n' + failed + ' failure(s)')
process.exit(failed === 0 ? 0 : 1)
