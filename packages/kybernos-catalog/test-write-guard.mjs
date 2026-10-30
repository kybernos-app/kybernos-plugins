// test-write-guard.mjs — every route of this bundle carries DSH's signed session, READS INCLUDED. The items are the person's own goods and customers' prices, DSH
// serves plugin routes before its own login, and an Origin header is forgeable by any local program: before this rule a plain `curl` could have listed or
// changed them. For each route, in this order: no Origin and no cookie · a foreign Origin (even with the real cookie) · the right Origin and no cookie (what a
// local program sends) · the right Origin and a forged cookie · an expired cookie · the right Origin and the real cookie (the page) · a foreign Host (a rebound
// page) · the phone marker (a write through the phone link never passes; a read does) · a machine secret that cannot be read.
//
// The routes are mounted through `apply`, so the host fence of index.js is part of what is measured. No shared base is published here: the real pair passes the
// guard and is then answered `base_missing`, which proves it got past the guard and touched nothing.
//
//   node packages/kybernos-catalog/test-write-guard.mjs
import { apply } from './index.js'
import { sessionSource } from './session-guard.mjs'
import { OTHER_SECRET, SESSION_SECRET, browserHeaders, sessionCookie } from './lib-session-test.mjs'

let failed = 0
const ok = (label, cond, detail) => {
  if (cond) console.log('✓ ' + label + (detail === undefined ? '' : ' (' + detail + ')'))
  else { console.error('✗ ' + label + (detail === undefined ? '' : ' — ' + detail)); failed += 1 }
}
sessionSource.secret = () => SESSION_SECRET
delete globalThis[Symbol.for('kybernos.business')]

const routes = {}
const log = console.log
console.log = () => {}
try { apply({ get: (n) => (n === 'webServer' ? { register: (r) => { routes[r.path] = r.handler } } : undefined), effect: (fn) => fn(), inject: (_n, fn) => fn({ tools: { register () {} } }) }, { schedule: () => undefined }) } finally { console.log = log }

const hit = async (path, method, headers, body, query = '') => {
  const raw = body === undefined ? '' : JSON.stringify(body)
  const req = { method, url: path + query, headers: { host: '127.0.0.1:3080', ...(method === 'POST' ? { 'content-type': 'application/json' } : {}), ...headers }, socket: { localPort: 3080 }, on: (ev, fn) => { if (ev === 'data' && raw !== '') fn(raw); if (ev === 'end') setTimeout(() => fn(), 0) } }
  const out = { code: 200, body: '' } // a handler that never calls writeHead answers 200
  await routes[path](req, { setHeader () {}, writeHead (c) { out.code = c }, end (b) { out.body = String(b === undefined ? '' : b) } })
  return out
}
const ORIGIN = 'http://127.0.0.1:3080'
// `types` needs no base (it answers the default type); every other route is answered base_missing once it is past the guard
const VENDOR = ['/kybernos-catalog/vendor/maplibre-gl.js', '/kybernos-catalog/vendor/maplibre-gl.css']
// a vendor route answers the library itself (a read of public code, behind the same guard), not JSON
const passed = (r, path) => r.code === 200 && (VENDOR.includes(path) ? r.body.length > 1000 : (path === '/kybernos-catalog/types' ? JSON.parse(r.body).ok === true : JSON.parse(r.body).error === 'base_missing'))

const table = {
  '/kybernos-catalog/types': ['GET'],
  '/kybernos-catalog/list': ['GET'],
  '/kybernos-catalog/get': ['GET', undefined, '?id=1'],
  '/kybernos-catalog/create': ['POST', { title: 'guard test' }],
  '/kybernos-catalog/update': ['POST', { id: 1, patch: { title: 'guard test' } }],
  '/kybernos-catalog/archive': ['POST', { id: 1 }],
  '/kybernos-catalog/restore': ['POST', { id: 1 }],
  '/kybernos-catalog/clear-demo': ['POST', { confirm: true }],
  '/kybernos-catalog/vendor/maplibre-gl.js': ['GET'],
  '/kybernos-catalog/vendor/maplibre-gl.css': ['GET'],
}
ok('the ten routes (eight of data, two of the map library) are mounted and nothing else', Object.keys(routes).sort().join() === Object.keys(table).sort().join())

for (const [path, [method, body, query]] of Object.entries(table)) {
  const write = method === 'POST'
  ok(path + ': no cookie -> refused (' + (write ? '403, a write names an Origin' : '401, a read needs the session too') + ')', (await hit(path, method, {}, body, query)).code === (write ? 403 : 401))
  ok(path + ': a foreign Origin -> 403, even with the real cookie', (await hit(path, method, { ...browserHeaders(), origin: 'http://evil.example' }, body, query)).code === 403)
  ok(path + ': the right Origin and no cookie -> 401', (await hit(path, method, { origin: ORIGIN }, body, query)).code === 401)
  ok(path + ': the right Origin and a forged cookie -> 401', (await hit(path, method, { origin: ORIGIN, cookie: sessionCookie(undefined, { secret: OTHER_SECRET }) }, body, query)).code === 401)
  ok(path + ': an expired cookie -> 401', (await hit(path, method, { origin: ORIGIN, cookie: sessionCookie(undefined, { expiresAt: Date.now() - 1000 }) }, body, query)).code === 401)
  ok(path + ': a cookie for another authority -> 401', (await hit(path, method, { origin: ORIGIN, cookie: sessionCookie('127.0.0.1:9999') }, body, query)).code === 401)
  ok(path + ': the real pair passes the guard' + (VENDOR.includes(path) ? ' (and gets the file)' : ' (and is answered base_missing: nothing touched)'), passed(await hit(path, method, browserHeaders(), body, query), path))
  ok(path + ': a rebound page (foreign Host) -> 403 whatever it sends', (await hit(path, method, { ...browserHeaders(), host: 'attacker.example:3080' }, body, query)).code === 403)
  const phone = await hit(path, method, { ...browserHeaders(), 'x-kybernos-tunnel': '1' }, body, query)
  ok(path + ': through the phone link a ' + (write ? 'write -> 403 refused_on_phone' : 'read still passes'), write ? phone.code === 403 && JSON.parse(phone.body).error === 'refused_on_phone' : passed(phone, path))
}
ok('a read with no Origin and the real cookie passes (what the page\'s own fetch sends)', passed(await hit('/kybernos-catalog/list', 'GET', { cookie: browserHeaders().cookie }), '/kybernos-catalog/list'))

sessionSource.secret = () => null
ok('a machine secret that cannot be read closes every route (503)', (await hit('/kybernos-catalog/list', 'GET', browserHeaders())).code === 503 && (await hit('/kybernos-catalog/create', 'POST', browserHeaders(), { title: 'x' })).code === 503)
sessionSource.secret = () => SESSION_SECRET

if (failed > 0) { console.log('test-write-guard: ' + failed + ' failure(s)'); process.exit(1) }
console.log('test-write-guard: all green')
