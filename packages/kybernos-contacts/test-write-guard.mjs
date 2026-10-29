// test-write-guard.mjs — EVERY route of this bundle, reads included, carries DSH's signed session, not only an Origin. A contact is personal data and DSH serves plugin
// routes before its own login (docs/dev/route-origin-rule.md, "The reads": the owner decided 2026-10-29 that Contacts reads need the cookie too). For each route, in this order:
//   no Origin and no cookie · a foreign Origin (even with the real cookie) · the right Origin and no cookie (what a local program sends) · the right Origin and a forged cookie ·
//   an expired cookie · the cookie of another authority · a secret that cannot be read · the real pair (the page).
// A write that comes through the phone link never passes; a read of the same route does. A refused request leaves the base and the journal exactly as they were.
//
//   node packages/kybernos-contacts/test-write-guard.mjs
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBusinessBase } from '../kybernos-plugin/business-base.mjs'
import { apply } from './index.js'
import { sessionSource } from './session-guard.mjs'
import { OTHER_SECRET, SESSION_SECRET, browserHeaders, sessionCookie } from './lib-session-test.mjs'

let echecs = 0
const ok = (label, cond, detail) => {
  if (cond) console.log('✓ ' + label + (detail === undefined ? '' : ' (' + detail + ')'))
  else { console.error('✗ ' + label + (detail === undefined ? '' : ' — ' + detail)); echecs += 1 }
}
sessionSource.secret = () => SESSION_SECRET

const home = mkdtempSync(join(tmpdir(), 'kb-contacts-guard-'))
process.env.DSH_HOME = join(home, '.dsh')
const base = createBusinessBase({ file: join(home, 'business', 'donnees.sqlite') })
globalThis[Symbol.for('kybernos.business')] = base
const seeded = base.create('contact', { name: 'Guard Test', email: 'guard@example.com' }, { actor: 'person' }).row
// counts() carries the journal's length and writes nothing itself (exportAll would journal its own call)
const state = () => JSON.stringify([base.counts(), base.list('contact', { includeArchived: true }).rows, base.list('note', {}).rows])

const routes = {}
apply({ get: (n) => (n === 'webServer' ? { register: (r) => { routes[r.path] = r.handler } } : undefined), effect: () => {}, inject: () => {}, on: () => {} }, { delays: [] })

const hit = async (path, method, headers, body, query = '') => {
  const raw = body === undefined ? undefined : JSON.stringify(body)
  const req = { method, url: path + query, headers: { host: '127.0.0.1:3080', ...(method === 'POST' ? { 'content-type': 'application/json' } : {}), ...headers }, socket: { localPort: 3080 }, on: (ev, fn) => { if (ev === 'data' && raw !== undefined) fn(raw); if (ev === 'end') setTimeout(() => fn(), 0) } }
  const out = { code: 200, body: '' }
  await routes[path](req, { setHeader () {}, writeHead (c) { out.code = c }, end (b) { out.body = String(b === undefined ? '' : b) } })
  return out
}

// Every body is one the business rules refuse, so even the real pair changes nothing: the guard is what is on trial here, and the base must be as it was.
const id = seeded.id
const table = [
  ['schema', 'GET', undefined, ''],
  ['list', 'GET', undefined, '?q=guard'],
  ['get', 'GET', undefined, '?id=' + id],
  ['create', 'POST', { name: 'Intruder', kind: 'robot' }, ''],
  ['update', 'POST', { id, kind: 'company' }, ''],
  ['archive', 'POST', { id: 99999 }, ''],
  ['restore', 'POST', { id: 99999 }, ''],
  ['note', 'POST', { id: 99999, text: 'x' }, ''],
  ['clear-demo', 'POST', {}, ''],
]
const before = state()
for (const [name, method, body, query] of table) {
  const path = '/kybernos-contacts/' + name
  const read = method === 'GET'
  ok(path + ' is mounted', typeof routes[path] === 'function')
  ok(path + ': no Origin and no cookie -> ' + (read ? '401' : '403'), (await hit(path, method, {}, body, query)).code === (read ? 401 : 403))
  ok(path + ': a foreign Origin -> 403, even with the real cookie', (await hit(path, method, { ...browserHeaders(), origin: 'http://evil.example' }, body, query)).code === 403)
  ok(path + ': a foreign Referer -> 403', (await hit(path, method, { cookie: sessionCookie(), referer: 'http://evil.example/page' }, body, query)).code === 403)
  ok(path + ': the right Origin and no cookie -> 401', (await hit(path, method, { origin: 'http://127.0.0.1:3080' }, body, query)).code === 401)
  ok(path + ': the right Origin and a forged cookie -> 401', (await hit(path, method, { origin: 'http://127.0.0.1:3080', cookie: sessionCookie(undefined, { secret: OTHER_SECRET }) }, body, query)).code === 401)
  ok(path + ': an expired cookie -> 401', (await hit(path, method, { origin: 'http://127.0.0.1:3080', cookie: sessionCookie(undefined, { expiresAt: Date.now() - 1000 }) }, body, query)).code === 401)
  ok(path + ': the cookie of another authority -> 401', (await hit(path, method, { origin: 'http://127.0.0.1:3080', cookie: sessionCookie('127.0.0.1:4000') }, body, query)).code === 401)
  if (read) ok(path + ': a read with the cookie and no Origin (a page GET) passes the guard', (await hit(path, method, { cookie: sessionCookie() }, body, query)).code !== 401)
  ok(path + ': a Host that is not this listener\'s -> 403 before the guard', (await hit(path, method, { ...browserHeaders(), host: 'attacker.example:3080' }, body, query)).code === 403)
  const phone = await hit(path, method, { ...browserHeaders(), 'x-kybernos-tunnel': '1' }, body, query)
  if (read) ok(path + ': through the phone link a read passes', phone.code !== 403 && phone.code !== 401, String(phone.code))
  else ok(path + ': through the phone link a write is refused (refused_on_phone)', phone.code === 403 && JSON.parse(phone.body).error === 'refused_on_phone', phone.body)
  const reel = await hit(path, method, browserHeaders(), body, query)
  ok(path + ': the real pair passes the guard', reel.code !== 401 && reel.code !== 403 && reel.code !== 503, String(reel.code))
  if (!read) ok(path + ': ...and loses on the business rule', reel.code === 400 || reel.code === 404, reel.body)
}
ok('a refused request left the base, the journal and the row as they were', state() === before)

sessionSource.secret = () => null
ok('a guard that cannot read the machine secret closes every route (503)', (await Promise.all(table.map(([name, method, body, query]) => hit('/kybernos-contacts/' + name, method, browserHeaders(), body, query)))).every((r) => r.code === 503))
sessionSource.secret = () => SESSION_SECRET

rmSync(home, { recursive: true, force: true })
if (echecs > 0) { console.log('test-write-guard: ' + echecs + ' failure(s)'); process.exit(1) }
console.log('test-write-guard: all green')
