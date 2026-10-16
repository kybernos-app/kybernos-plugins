// /kybernos-miniapps/install writes a native app into ~/Applications and launches it; /uninstall removes one and unloads its LaunchAgent. DSH serves
// plugin routes before its own login and an Origin header is forgeable by any local program: before this rule
// `curl -X POST http://127.0.0.1:<port>/kybernos-miniapps/install -d '{"id":"x","html":"..."}'` installed and started an app, with no header at all.
// Both now need DSH's signed session as well as the right Origin (session-guard.mjs, the terminal's rule); their only caller is the page.
//
// For each, in this order: no Origin and no cookie · a foreign Origin (even with the real cookie) · the right Origin and no cookie (what a local
// program sends) · the right Origin and a forged cookie · the right Origin and the real cookie (the page). The body is an HTML too short to be
// installed: even the real pair writes nothing here.
//
//   node packages/kybernos-miniapps/test-write-guard.mjs
import { apply } from './index.js'
import { sessionSource } from './session-guard.mjs'
import { OTHER_SECRET, SESSION_SECRET, browserHeaders, sessionCookie } from './lib-session-test.mjs'

let echecs = 0
const ok = (label, cond, detail) => {
  if (cond) console.log(`✓ ${label}${detail === undefined ? '' : ` (${detail})`}`)
  else { console.error(`✗ ${label}${detail === undefined ? '' : ` — ${detail}`}`); echecs += 1 }
}
sessionSource.secret = () => SESSION_SECRET

const routes = {}
apply({ get: (n) => (n === 'webServer' ? { register: (r) => { routes[r.path] = r.handler } } : undefined), effect: (fn) => fn(), inject: (_n, fn) => fn() })

const hit = async (path, method, headers, body) => {
  const raw = JSON.stringify(body)
  const req = { method, url: path, headers: { host: '127.0.0.1:3080', 'content-type': 'application/json', ...headers }, socket: { localPort: 3080 }, on: (ev, fn) => { if (ev === 'data') fn(raw); if (ev === 'end') setTimeout(() => fn(), 0) } }
  const out = { code: 200, body: '' } // a handler that never calls writeHead answers 200
  await routes[path](req, { setHeader () {}, writeHead (c) { out.code = c }, end (b) { out.body = String(b === undefined ? '' : b) } })
  return out
}

const bodies = { '/kybernos-miniapps/install': { id: 'guard-test', html: '<b>x</b>' }, '/kybernos-miniapps/uninstall': { id: 'guard-test' } }
for (const [path, body] of Object.entries(bodies)) {
  ok(path + ' is mounted', typeof routes[path] === 'function')
  ok(path + ': no Origin and no cookie -> 403', (await hit(path, 'POST', {}, body)).code === 403)
  ok(path + ': a foreign Origin -> 403, even with the real cookie', (await hit(path, 'POST', { ...browserHeaders(), origin: 'http://evil.example' }, body)).code === 403)
  ok(path + ': the right Origin and no cookie -> 401', (await hit(path, 'POST', { origin: 'http://127.0.0.1:3080' }, body)).code === 401)
  ok(path + ': the right Origin and a forged cookie -> 401', (await hit(path, 'POST', { origin: 'http://127.0.0.1:3080', cookie: sessionCookie(undefined, { secret: OTHER_SECRET }) }, body)).code === 401)
  const real = await hit(path, 'POST', browserHeaders(), body)
  ok(path + ': the right Origin and the real cookie -> the route answers (' + real.code + ')', real.code === 200 && real.body.startsWith('{'), real.body.slice(0, 60))
}
ok('the guard refuses before the content type is looked at', (await hit('/kybernos-miniapps/install', 'POST', { 'content-type': 'text/plain' }, bodies['/kybernos-miniapps/install'])).code === 403)
ok('the list (a read) answers with no header', typeof routes['/kybernos-miniapps/list'] === 'function' && (await hit('/kybernos-miniapps/list', 'GET', {}, {})).code !== 403)

console.log(echecs === 0 ? '\nall green' : `\n✗ ${echecs} failure(s)`)
process.exit(echecs === 0 ? 0 : 1)
