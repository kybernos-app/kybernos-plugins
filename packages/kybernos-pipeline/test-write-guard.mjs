// test-write-guard.mjs — every route of this bundle, reads included, carries DSH's signed session, not only an Origin. DSH serves plugin routes before its
// own login and an Origin header is forgeable by any local program; the cards are personal data (customers, candidates, tenants). For each route, in this
// order: no Origin and no cookie · a foreign Origin (even with the real cookie) · a foreign Host (a page that rebinds its name to this machine) · the right
// Origin and no cookie (what a local program sends) · the right Origin and a forged cookie · the right Origin and the real cookie (the page). A spy stands
// where the business base is: a refused request must not reach it at all, and the real pair with a body that loses on its own rule must not write.
//
//   node packages/kybernos-pipeline/test-write-guard.mjs
import { apply, ROUTES } from './index.js'
import { sessionSource } from './session-guard.mjs'
import { OTHER_SECRET, SESSION_SECRET, browserHeaders, sessionCookie } from './lib-session-test.mjs'

let failures = 0
const ok = (label, cond, detail) => {
  if (cond) console.log('✓ ' + label + (detail === undefined ? '' : ' (' + detail + ')'))
  else { console.error('✗ ' + label + (detail === undefined ? '' : ' — ' + detail)); failures += 1 }
}
sessionSource.secret = () => SESSION_SECRET

// The spy: it answers like an empty base and remembers every call, so "reached nothing" is a measurement.
const calls = []
const spy = (name, answer) => (...args) => { calls.push(name); return typeof answer === 'function' ? answer(...args) : answer }
const SEAM = Symbol.for('kybernos.business')
globalThis[SEAM] = {
  version: 1,
  list: spy('list', { ok: true, total: 0, rows: [] }), get: spy('get', { ok: false, error: 'not_found' }), counts: spy('counts', { ok: true, tables: {}, demo: {} }),
  create: spy('create', { ok: false, error: 'spy' }), update: spy('update', { ok: false, error: 'spy' }), archive: spy('archive', { ok: false, error: 'spy' }),
  restore: spy('restore', { ok: false, error: 'spy' }), clearDemo: spy('clearDemo', { ok: true, removed: {} }),
}

const routes = {}
apply({ get: (n) => (n === 'webServer' ? { register: (r) => { routes[r.path] = r.handler } } : undefined), effect: () => {}, inject: () => {}, on: () => {} }, { schedule: () => undefined })

const hit = async (path, method, headers, body, socket = { localPort: 3080 }) => {
  const raw = body === undefined ? '' : (typeof body === 'string' ? body : JSON.stringify(body))
  const req = { method, url: path, headers: { host: '127.0.0.1:3080', ...(method === 'POST' ? { 'content-type': 'application/json' } : {}), ...headers }, socket, on: (ev, fn) => { if (ev === 'data' && raw !== '') fn(raw); if (ev === 'end') setTimeout(() => fn(), 0) } }
  const out = { code: 200, body: '' }
  await routes[path.split('?')[0]](req, { setHeader () {}, writeHead (c) { out.code = c }, end (b) { out.body = String(b === undefined ? '' : b) } })
  return out
}
const parsed = (r) => { try { return JSON.parse(r.body) } catch (e) { return null } }

// What each route is sent: a body that loses on its own rule even with the real pair (a bad id, an unknown flow), or a query.
const ASKS = {
  '/kybernos-pipeline/flows': { method: 'GET', url: '/kybernos-pipeline/flows' },
  '/kybernos-pipeline/board': { method: 'GET', url: '/kybernos-pipeline/board?flow=nope' },
  '/kybernos-pipeline/card': { method: 'GET', url: '/kybernos-pipeline/card?id=9' },
  '/kybernos-pipeline/links': { method: 'GET', url: '/kybernos-pipeline/links?kind=contact&q=a' },
  '/kybernos-pipeline/create': { method: 'POST', body: { flow: 'nope', title: 'guard test' } },
  '/kybernos-pipeline/update': { method: 'POST', body: { id: 'x', title: 'guard test' } },
  '/kybernos-pipeline/move': { method: 'POST', body: { id: 'x', stage: 'new' } },
  '/kybernos-pipeline/archive': { method: 'POST', body: { id: 'x' } },
  '/kybernos-pipeline/restore': { method: 'POST', body: { id: 'x' } },
  '/kybernos-pipeline/clear-demo': { method: 'POST', body: {} },
}
const WRITES = new Set(['create', 'update', 'move', 'archive', 'restore', 'clearDemo'])
const wrote = () => calls.filter((c) => WRITES.has(c)).length

ok('every route of the table is mounted and has a request in this test', ROUTES.every((r) => typeof routes[r.path] === 'function' && ASKS[r.path] !== undefined) && Object.keys(ASKS).length === ROUTES.length)

const OWN = 'http://127.0.0.1:3080'
for (const route of ROUTES) {
  const { path } = route
  const ask = ASKS[path]
  const go = (headers, socket) => hit(ask.url || path, ask.method, headers, ask.body, socket)
  calls.length = 0
  ok(path + ': no Origin and no cookie -> ' + (ask.method === 'GET' ? '401 (a read may carry no Origin, never no cookie)' : '403'), (await go({})).code === (ask.method === 'GET' ? 401 : 403))
  ok(path + ': a foreign Origin -> 403, even with the real cookie', (await go({ ...browserHeaders(), origin: 'http://evil.example' })).code === 403)
  ok(path + ': a foreign Referer -> 403 too', (await go({ cookie: browserHeaders().cookie, referer: 'http://evil.example/page' })).code === 403)
  ok(path + ': a foreign Host (DNS rebinding) -> 403, even with the real pair', (await go({ ...browserHeaders(), host: 'evil.example:3080' })).code === 403)
  ok(path + ': the right Origin and no cookie -> 401', (await go({ origin: OWN })).code === 401)
  ok(path + ': the right Origin and a forged cookie -> 401', (await go({ origin: OWN, cookie: sessionCookie(undefined, { secret: OTHER_SECRET }) })).code === 401)
  ok(path + ': the right Origin and an expired cookie -> 401', (await go({ origin: OWN, cookie: sessionCookie(undefined, { expiresAt: Date.now() - 1000 }) })).code === 401)
  ok(path + ': nothing reached the base so far', calls.length === 0, calls.join(','))
  const real = await go(browserHeaders())
  const answer = parsed(real)
  ok(path + ': the real pair passes the guard and loses on the business rule (or reads the empty spy)', real.code === 200 && answer !== null && typeof answer.ok === 'boolean', real.body.slice(0, 120))
  // clear-demo has no body to get wrong: with the real pair it is the one write that goes through (and it is the person's own button).
  if (ask.method === 'POST') ok(path + (path.endsWith('/clear-demo') ? ': ...and that is the one write that goes through' : ': ...and that wrote nothing'), wrote() === (path.endsWith('/clear-demo') ? 1 : 0), calls.join(','))
  calls.length = 0
  const other = ask.method === 'GET' ? 'POST' : 'GET'
  ok(path + ': the other method -> 405', (await hit(ask.url || path, other, browserHeaders(), other === 'POST' ? {} : undefined)).code === 405)
  const phone = await go({ ...browserHeaders(), 'x-kybernos-tunnel': '1' })
  ok(path + ': through the phone link ' + (ask.method === 'GET' ? 'a read passes' : 'a write is refused (refused_on_phone)'), ask.method === 'GET' ? phone.code === 200 : phone.code === 403 && parsed(phone).error === 'refused_on_phone', phone.code)
}

// The shape of a body.
calls.length = 0
const post = '/kybernos-pipeline/create'
ok('a body that is not JSON content-type -> 415', (await hit(post, 'POST', { ...browserHeaders(), 'content-type': 'text/plain' }, 'x')).code === 415)
ok('a body that is not JSON -> 400', (await hit(post, 'POST', browserHeaders(), '{nope')).code === 400)
ok('a body that is too large -> 413', (await hit(post, 'POST', browserHeaders(), { flow: 'x', title: 'y'.repeat(20 * 1024) })).code === 413)
ok('none of the shape refusals wrote', wrote() === 0, calls.join(','))

// The secret that cannot be read closes everything, reads included.
sessionSource.secret = () => null
ok('the machine secret unreadable -> 503 on a read and on a write', (await hit('/kybernos-pipeline/flows', 'GET', browserHeaders())).code === 503 && (await hit(post, 'POST', browserHeaders(), {})).code === 503)
sessionSource.secret = () => SESSION_SECRET

// The page, with a real base behind the seam of the spy: a signed-in read answers the board.
globalThis[SEAM] = { ...globalThis[SEAM], list: spy('list', { ok: true, total: 0, rows: [] }) }
const flows = parsed(await hit('/kybernos-pipeline/flows', 'GET', browserHeaders()))
ok('the signed-in page reads the boards', flows !== null && flows.ok === true && flows.flows[0].id === 'default', JSON.stringify(flows).slice(0, 100))

// Without the base the same routes answer base_missing with the real pair and still nothing throws.
delete globalThis[SEAM]
const missing = parsed(await hit('/kybernos-pipeline/board', 'GET', browserHeaders()))
ok('without the base: base_missing, not an error page', missing !== null && missing.ok === false && missing.error === 'base_missing')

if (failures > 0) { console.log('test-write-guard: ' + failures + ' failure(s)'); process.exit(1) }
console.log('test-write-guard: all green')
