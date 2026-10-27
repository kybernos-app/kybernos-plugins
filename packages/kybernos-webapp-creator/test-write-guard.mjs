// test-write-guard.mjs — the write routes of this bundle carry DSH's signed session, not only an
// Origin. DSH serves plugin routes before its own login and an Origin header is forgeable by any
// local program: before this rule a plain `curl -X POST …/create` scaffolded folders with no header
// at all. For each write route, in this order: no Origin and no cookie · a foreign Origin (even with
// the real cookie) · the right Origin and no cookie (what a local program sends) · the right Origin
// and a forged cookie · the right Origin and the real cookie (the page). Even the real pair writes
// nothing here: every body fails its own business rule (a bad slug, an unknown app).
//
//   node packages/kybernos-webapp-creator/test-write-guard.mjs
import { apply } from './index.js'
import { sessionSource } from './session-guard.mjs'
import { OTHER_SECRET, SESSION_SECRET, browserHeaders, sessionCookie } from './lib-session-test.mjs'

let echecs = 0
const ok = (label, cond, detail) => {
  if (cond) console.log('✓ ' + label + (detail === undefined ? '' : ' (' + detail + ')'))
  else { console.error('✗ ' + label + (detail === undefined ? '' : ' — ' + detail)); echecs += 1 }
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

// Every body loses on its own rules, so even the real pair reaches nothing: create rejects the slug,
// start and stop name an app that cannot exist.
const corps = {
  '/kybernos-webapp-creator/create': { nom: 'guard test', slug: 'Bad Slug!' },
  '/kybernos-webapp-creator/start': { slug: 'nope-not-here' },
  '/kybernos-webapp-creator/stop': { slug: 'nope-not-here' },
}
for (const [path, body] of Object.entries(corps)) {
  ok(path + ' is mounted', typeof routes[path] === 'function')
  ok(path + ': no Origin and no cookie -> 403', (await hit(path, 'POST', {}, body)).code === 403)
  ok(path + ': a foreign Origin -> 403, even with the real cookie', (await hit(path, 'POST', { ...browserHeaders(), origin: 'http://evil.example' }, body)).code === 403)
  ok(path + ': the right Origin and no cookie -> 401', (await hit(path, 'POST', { origin: 'http://127.0.0.1:3080' }, body)).code === 401)
  ok(path + ': the right Origin and a forged cookie -> 401', (await hit(path, 'POST', { origin: 'http://127.0.0.1:3080', cookie: sessionCookie(undefined, { secret: OTHER_SECRET }) }, body)).code === 401)
  const reel = await hit(path, 'POST', browserHeaders(), body)
  ok(path + ': the real pair passes the guard and loses on the business rule', reel.code === 200 && JSON.parse(reel.body).ok === false, reel.body)
}

if (echecs > 0) { console.log('test-write-guard: ' + echecs + ' failure(s)'); process.exit(1) }
console.log('test-write-guard: all green')
