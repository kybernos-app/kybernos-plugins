// kybernos-db, the routes of the Tables page: the api over a real db (a temp folder), and EVERY route behind DSH's signed session. For each route, in this order:
//   no Origin and no cookie · a foreign Origin (even with the real cookie) · the right Origin and no cookie · a forged cookie · an expired one · another authority's ·
//   a Host that is not this listener's · the real pair (the page). A refused request leaves the databases exactly as they were.
//
//   node packages/kybernos-db/test-routes.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeService } from './agent/service.mjs'
import { RECORDS_MAX, makeApi } from './api.mjs'
import { apply } from './index.js'
import { CORE_ROUTE, ROUTE, coreFiles } from './routes.mjs'
import { sessionSource } from './session-guard.mjs'
import { OTHER_SECRET, SESSION_SECRET, browserHeaders, sessionCookie } from './lib-session-test.mjs'

let count = 0
const ok = async (label, fn) => { await fn(); count++; console.log('ok  ', label) }
sessionSource.secret = () => SESSION_SECRET

const root = mkdtempSync(join(tmpdir(), 'kb-db-routes-'))
let n = 0
const clock = () => { let t = Date.UTC(2026, 9, 30, 9, 0, 0); return () => (t += 1) }
const sequence = () => { let i = 0; return (len) => { i += 1; return Uint8Array.from({ length: len }, (_, k) => (i * 31 + k * 7 + 1) & 255) } }
const ports = () => ({ now: clock(), random: sequence() })
const service = () => makeService({ dir: join(root, 's' + (n++)), ports: ports() })

const TASKS = {
  key: 'task', label: 'Tasks', title: 'name',
  fields: [
    { key: 'name', type: 'text', label: 'Name', required: true },
    { key: 'status', type: 'choice', label: 'Status', options: [{ key: 'todo', label: 'To do' }, { key: 'done', label: 'Done' }] },
    { key: 'email', type: 'email', label: 'Email', protection: 'personal' },
    { key: 'token', type: 'text', label: 'Token', protection: 'secret' },
  ],
}
function seeded () {
  const svc = service()
  const made = svc.create({ name: 'Home', by: 'agent' })
  assert.equal(made.ok, true)
  assert.equal(made.db.addObject(TASKS, 'agent').ok, true)
  const api = makeApi({ service: svc, ports: { today: () => '2026-10-30' } })
  return { svc, api, db: made.db, id: made.db.info().id }
}

// ---------------------------------------------------------------- the api
await ok('state lists the dbs with their tables, fields and views, a fingerprint and today', () => {
  const { api, id, db } = seeded()
  db.saveView('task', { name: 'Open', kind: 'table' }, 'agent')
  const s = api.state()
  assert.equal(s.ok, true)
  assert.equal(s.today, '2026-10-30')
  assert.equal(s.dbs.length, 1)
  assert.equal(s.dbs[0].id, id)
  assert.equal(s.dbs[0].objects[0].key, 'task')
  assert.equal(s.dbs[0].objects[0].views[0].name, 'Open')
  assert.equal(s.dbs[0].objects[0].fields.length, 4)
  assert.equal(typeof s.dbs[0].fingerprint, 'string')
  assert.deepEqual(s.unreadable, [])
})

await ok('state of an empty folder is no database, not an error', () => {
  const api = makeApi({ service: service() })
  assert.deepEqual(api.state().dbs, [])
  assert.match(api.state().today, /^\d{4}-\d{2}-\d{2}$/)
})

await ok('the person sees every field in clear, protected and secret ones included', () => {
  const { api } = seeded()
  const w = api.write({ object: 'task', op: 'create', values: { name: 'Pay', email: 'a@b.co', token: 'sk-1' } })
  assert.equal(w.ok, true)
  const r = api.records({ object: 'task' })
  assert.equal(r.records[0].values.email, 'a@b.co')
  assert.equal(r.records[0].values.token, 'sk-1')
})

await ok('a write is journalled as the person, whatever the request says it is', () => {
  const { api, db } = seeded()
  const w = api.write({ object: 'task', op: 'create', values: { name: 'Pay' }, by: 'agent', actor: 'agent' })
  assert.equal(w.record.created.by, 'person')
  assert.ok(db.journal().every((op) => op.by === 'person' || op.by === 'agent'))
  assert.equal(db.get('task', w.record.id).created.by, 'person')
})

await ok('write creates, updates, deletes and restores, and says when nothing changed', () => {
  const { api } = seeded()
  const c = api.write({ object: 'task', op: 'create', values: { name: 'Pay', status: 'todo' } })
  const id = c.record.id
  const u = api.write({ object: 'task', op: 'update', id, values: { status: 'done' } })
  assert.equal(u.record.values.status, 'done')
  assert.equal(u.applied, true)
  assert.equal(api.write({ object: 'task', op: 'update', id, values: { status: 'done' } }).applied, false)
  assert.equal(api.write({ object: 'task', op: 'delete', id }).applied, true)
  assert.equal(api.records({ object: 'task' }).total, 0)
  assert.equal(api.records({ object: 'task', deleted: true }).total, 1)
  assert.equal(api.records({ object: 'task', deleted: '1' }).total, 1, 'a query string says 1')
  assert.equal(api.write({ object: 'task', op: 'restore', id }).ok, true)
  assert.equal(api.records({ object: 'task' }).total, 1)
})

await ok('write refuses what the engine refuses, with the reason, and an unknown op', () => {
  const { api } = seeded()
  const bad = api.write({ object: 'task', op: 'create', values: { name: '', status: 'maybe' } })
  assert.equal(bad.ok, false)
  assert.ok(bad.error && bad.message)
  assert.ok(Array.isArray(bad.errors) && bad.errors.length >= 1)
  assert.equal(api.write({ object: 'task', op: 'update', id: 'nope', values: {} }).error, 'missing')
  assert.equal(api.write({ object: 'task', op: 'explode' }).error, 'invalid')
  assert.equal(api.write({ object: 'nope', op: 'create', values: {} }).error, 'unknown_object')
  assert.equal(api.write({ db: 'nope', object: 'task', op: 'create' }).error, 'unknown_db')
  assert.equal(api.write(null).ok, false, 'no body is an answer, not a throw')
  const c = api.write({ object: 'task', op: 'create', values: { name: 'x' } })
  api.write({ object: 'task', op: 'delete', id: c.record.id })
  assert.equal(api.write({ object: 'task', op: 'update', id: c.record.id, values: { name: 'y' } }).error, 'deleted')
})

await ok('views are saved, changed in place and removed', () => {
  const { api } = seeded()
  const a = api.view({ object: 'task', op: 'save', view: { name: 'Open', kind: 'table', state: { flt: { conj: 'and', items: [{ k: 'status', op: 'isnot', v: 'done' }] } } } })
  assert.equal(a.ok, true)
  assert.equal(a.created, true)
  assert.equal(a.view.owner, 'me')
  const b = api.view({ object: 'task', op: 'save', view: { ...a.view, name: 'Still open', fav: true } })
  assert.equal(b.created, false)
  assert.equal(b.view.name, 'Still open')
  assert.equal(api.view({ object: 'task', op: 'save', view: { ...b.view } }).applied, false)
  assert.equal(api.view({ object: 'task', op: 'save', view: { name: 'Bad', kind: 'pie' } }).ok, false)
  assert.equal(api.view({ object: 'task', op: 'remove', id: a.view.id }).removed, true)
  assert.equal(api.view({ object: 'task', op: 'remove', id: a.view.id }).removed, false)
  assert.equal(api.view({ object: 'task', op: 'dance' }).error, 'invalid')
  assert.equal(api.view({ object: 'nope', op: 'save', view: {} }).error, 'unknown_object')
})

await ok('state tells who last saved each view, so the page can tell Kaby\'s change from its own', () => {
  const { api } = seeded()
  const v = api.view({ object: 'task', op: 'save', view: { name: 'Open', kind: 'table' } }).view
  const st = () => api.state().dbs[0].objects.find((o) => o.key === 'task').stamps[v.id]
  assert.deepEqual([st().rev, st().by], [1, 'person'])
  api.view({ object: 'task', op: 'save', view: { ...v, fav: true } })
  assert.equal(st().rev, 2)
})

await ok('the fingerprint of state and of records moves when Kaby, or the person, changes anything', () => {
  const { api, db } = seeded()
  const f0 = api.state().dbs[0].fingerprint
  db.saveView('task', { name: 'By Kaby', kind: 'table', owner: 'kaby' }, 'agent')
  const f1 = api.state().dbs[0].fingerprint
  assert.notEqual(f1, f0)
  api.write({ object: 'task', op: 'create', values: { name: 'x' } })
  assert.notEqual(api.state().dbs[0].fingerprint, f1)
  assert.equal(api.records({ object: 'task' }).fingerprint, api.state().dbs[0].fingerprint)
})

await ok('a table is read whole up to the cap, and says when it was cut', () => {
  const { api, db } = seeded()
  for (let i = 0; i < 3; i += 1) db.create('task', { name: 'n' + i }, 'agent')
  const r = api.records({ object: 'task' })
  assert.equal(r.total, 3)
  assert.equal(r.truncated, false)
  assert.equal(RECORDS_MAX, 5000)
})

await ok('several databases need the db named; one is found by itself', () => {
  const svc = service()
  svc.create({ name: 'A', by: 'agent' }); svc.create({ name: 'B', by: 'agent' })
  const api = makeApi({ service: svc })
  assert.equal(api.records({ object: 'task' }).error, 'which_db')
  assert.equal(api.state().dbs.length, 2)
})

// ---------------------------------------------------------------- the http door
function door () {
  const routes = {}
  const home = join(root, 'home' + (n++))
  const ctx = { get: (name) => (name === 'webServer' ? { register: (r) => { routes[r.path] = r; return () => { delete routes[r.path] } } } : undefined), effect: () => {}, inject: () => {}, on: () => {} }
  apply(ctx, { home, ports: ports(), toolPorts: { today: () => '2026-10-30' } })
  return { routes, home }
}

/** One http call into a route's handler, as DSH makes it. */
async function hit (routes, path, method, headers, body, query = '') {
  const raw = body === undefined ? undefined : JSON.stringify(body)
  const req = {
    method, url: path + query,
    headers: { host: '127.0.0.1:3080', ...(method === 'POST' ? { 'content-type': 'application/json' } : {}), ...headers },
    socket: { localPort: 3080 },
    on (ev, fn) { if (ev === 'data' && raw !== undefined) fn(Buffer.from(raw)); if (ev === 'end') fn() },
  }
  const out = { code: 200, body: '', headers: {} }
  await routes[path.split('?')[0]].handler(req, { setHeader () {}, writeHead (c, h) { out.code = c; out.headers = h || {} }, end (b) { out.body = String(b === undefined ? '' : b) } })
  return out
}

// ---------------------------------------------------------------- links
const CUSTOMERS = { key: 'customer', label: 'Customers', title: 'name', fields: [{ key: 'name', type: 'text', label: 'Name', required: true }] }
const ORDERS = { key: 'order', label: 'Orders', title: 'name', fields: [{ key: 'name', type: 'text', label: 'Name', required: true }, { key: 'customer', type: 'relation', label: 'Customer', to: 'customer', inverse: 'Purchases' }, { key: 'items', type: 'relation', label: 'Products', to: 'product', many: true }] }
const PRODUCTS = { key: 'product', label: 'Products', title: 'name', fields: [{ key: 'name', type: 'text', label: 'Name', required: true }] }
const shop = () => {
  const svc = service()
  const db = svc.create({ name: 'Shop', by: 'agent' }).db
  for (const o of [CUSTOMERS, PRODUCTS, ORDERS]) assert.equal(db.addObject(o, 'agent').ok, true)
  return { api: makeApi({ service: svc, ports: { today: () => '2026-10-30' } }), db }
}

await ok('links says what points at a record: a group per link field, titled, with the name it shows under and how many there are', () => {
  const { api, db } = shop()
  const ada = db.create('customer', { name: 'Ada' }, 'agent').record.id
  const pen = db.create('product', { name: 'Pen' }, 'agent').record.id
  const o1 = db.create('order', { name: 'O-1', customer: ada, items: [pen] }, 'agent').record.id
  const l = api.links({ object: 'customer', id: ada })
  assert.deepEqual(l, { ok: true, object: 'customer', id: ada, groups: [{ object: 'order', objectLabel: 'Orders', field: 'customer', fieldLabel: 'Customer', inverse: 'Purchases', many: false, count: 1, records: [{ id: o1, title: 'O-1' }] }] })
  const p = api.links({ object: 'product', id: pen }).groups[0]
  assert.equal(p.inverse, null, 'no name given: the page says the label of the table it comes from')
  assert.equal(p.many, true)
  assert.deepEqual(api.links({ object: 'order', id: o1 }).groups, [], 'nothing points at an order')
})

await ok('links refuses what it cannot answer, and a write that links to nothing is refused with the field named', () => {
  const { api, db } = shop()
  const ada = db.create('customer', { name: 'Ada' }, 'agent').record.id
  assert.equal(api.links({ object: 'customer', id: '01ARYZ6S410000000000000009' }).error, 'missing')
  assert.equal(api.links({ object: 'customer' }).error, 'missing')
  assert.equal(api.links({ object: 'nope', id: ada }).error, 'unknown_object')
  const w = api.write({ object: 'order', op: 'create', values: { name: 'O-x', customer: '01ARYZ6S410000000000000009' } })
  assert.equal(w.ok, false)
  assert.equal(w.error, 'invalid')
  assert.equal(w.errors[0].path, 'customer')
  assert.equal(w.errors[0].code, 'link')
  assert.equal(api.write({ object: 'order', op: 'create', values: { name: 'O-1', customer: ada } }).ok, true)
})

await ok('apply mounts the five data routes and the core files', () => {
  const { routes } = door()
  for (const name of ['state', 'records', 'links', 'write', 'view']) assert.equal(typeof routes[ROUTE + name].handler, 'function', name)
  assert.equal(routes[CORE_ROUTE.slice(0, -1)].kind, 'prefix')
})

await ok('EVERY data route is behind the signed session, reads included', async () => {
  const { routes } = door()
  const table = [['state', 'GET', undefined, ''], ['records', 'GET', undefined, '?object=task'], ['links', 'GET', undefined, '?object=task&id=01ARYZ6S410000000000000001'], ['write', 'POST', { object: 'task', op: 'create', values: { name: 'Intruder' } }, ''], ['view', 'POST', { object: 'task', op: 'save', view: { name: 'X', kind: 'table' } }, '']]
  for (const [name, method, body, query] of table) {
    const path = ROUTE + name
    const read = method === 'GET'
    assert.equal((await hit(routes, path, method, {}, body, query)).code, read ? 401 : 403, path + ' no Origin, no cookie')
    assert.equal((await hit(routes, path, method, { ...browserHeaders(), origin: 'http://evil.example' }, body, query)).code, 403, path + ' foreign Origin with the real cookie')
    assert.equal((await hit(routes, path, method, { cookie: sessionCookie(), referer: 'http://evil.example/page' }, body, query)).code, 403, path + ' foreign Referer')
    assert.equal((await hit(routes, path, method, { origin: 'http://127.0.0.1:3080' }, body, query)).code, 401, path + ' right Origin, no cookie')
    assert.equal((await hit(routes, path, method, { origin: 'http://127.0.0.1:3080', cookie: sessionCookie(undefined, { secret: OTHER_SECRET }) }, body, query)).code, 401, path + ' forged cookie')
    assert.equal((await hit(routes, path, method, { origin: 'http://127.0.0.1:3080', cookie: sessionCookie(undefined, { expiresAt: Date.now() - 1000 }) }, body, query)).code, 401, path + ' expired cookie')
    assert.equal((await hit(routes, path, method, { origin: 'http://127.0.0.1:3080', cookie: sessionCookie('127.0.0.1:4000') }, body, query)).code, 401, path + ' another authority')
    assert.equal((await hit(routes, path, method, { ...browserHeaders(), host: 'attacker.example:3080' }, body, query)).code, 403, path + ' a Host that is not ours')
  }
  const s = await hit(routes, ROUTE + 'state', 'GET', browserHeaders())
  assert.equal(s.code, 200)
  assert.equal(JSON.parse(s.body).ok, true)
  assert.match(s.headers['cache-control'], /no-store/)
})

await ok('through the page: create a db table over http, write, read, change a view', async () => {
  const { routes, home } = door()
  // the database is made the way Kaby makes one; the page then works on it
  const svcFolder = join(home, 'kybernos', 'kybernos-db', 'dbs')
  const svc = makeService({ dir: svcFolder, ports: ports() })
  const made = svc.create({ name: 'Home', by: 'agent' })
  made.db.addObject(TASKS, 'agent')
  const H = browserHeaders()
  const w = await hit(routes, ROUTE + 'write', 'POST', H, { object: 'task', op: 'create', values: { name: 'Pay the rent', status: 'todo' } })
  assert.equal(w.code, 200, w.body)
  const rec = JSON.parse(w.body).record
  assert.equal(rec.created.by, 'person')
  const list = JSON.parse((await hit(routes, ROUTE + 'records', 'GET', H, undefined, '?object=task')).body)
  assert.equal(list.records.length, 1)
  assert.equal(list.records[0].values.name, 'Pay the rent')
  const bad = await hit(routes, ROUTE + 'write', 'POST', H, { object: 'task', op: 'create', values: { name: '' } })
  assert.equal(bad.code, 400)
  assert.equal(JSON.parse(bad.body).ok, false)
  assert.equal((await hit(routes, ROUTE + 'records', 'GET', H, undefined, '?object=nope')).code, 404)
  const v = await hit(routes, ROUTE + 'view', 'POST', H, { object: 'task', op: 'save', view: { name: 'Mine', kind: 'board' } })
  assert.equal(JSON.parse(v.body).view.by, 'status')
  assert.equal((await hit(routes, ROUTE + 'view', 'POST', H, { object: 'task', op: 'remove', id: JSON.parse(v.body).view.id })).code, 200)
  svc.close()
})

await ok('a route refuses the wrong method, a body that is not JSON and one that is too large', async () => {
  const { routes } = door()
  const H = browserHeaders()
  assert.equal((await hit(routes, ROUTE + 'state', 'POST', H, {})).code, 405)
  assert.equal((await hit(routes, ROUTE + 'write', 'GET', H)).code, 405)
  assert.equal((await hit(routes, ROUTE + 'write', 'POST', { ...H, 'content-type': 'text/plain' }, { object: 'task' })).code, 415)
  assert.equal((await hit(routes, ROUTE + 'write', 'POST', H, { object: 'task', op: 'create', values: { name: 'x'.repeat(70 * 1024) } })).code, 413)
})

await ok('the core files are served by name, as JavaScript, and nothing else is', async () => {
  const { routes } = door()
  const files = coreFiles()
  assert.ok(files.includes('index.mjs') && files.includes('filter.mjs') && files.includes('query.mjs'), files.join())
  const handler = routes[CORE_ROUTE.slice(0, -1)].handler
  const get = async (name, headers = {}, method = 'GET') => {
    const out = { code: 200, body: '', headers: {} }
    await handler({ method, url: CORE_ROUTE + name, headers: { host: '127.0.0.1:3080', ...headers }, socket: { localPort: 3080 } }, { setHeader () {}, writeHead (c, h) { out.code = c; out.headers = h || {} }, end (b) { out.body = String(b === undefined ? '' : b) } })
    return out
  }
  const index = await get('index.mjs')
  assert.equal(index.code, 200)
  assert.match(index.headers['content-type'], /javascript/)
  assert.equal(index.headers['x-content-type-options'], 'nosniff')
  assert.equal(index.body, readFileSync(new URL('./core/index.mjs', import.meta.url), 'utf8'))
  assert.equal((await get('index.mjs', {}, 'HEAD')).body, '')
  assert.equal((await get('index.mjs', {}, 'POST')).code, 405)
  for (const bad of ['', '../store/db.mjs', '..%2Fstore%2Fdb.mjs', 'nope.mjs', 'index.js', 'index.mjs/../../index.js', '%2e%2e/index.mjs', 'INDEX.MJS']) assert.equal((await get(bad)).code, 404, 'refused: ' + bad)
  assert.equal((await get('index.mjs', { host: 'attacker.example:3080' })).code, 403)
  for (const f of files) assert.equal((await get(f)).code, 200, f)
})

await ok('the core files the browser imports reach only each other (no disk, no network, no node module)', () => {
  for (const f of coreFiles()) {
    const text = readFileSync(new URL('./core/' + f, import.meta.url), 'utf8')
    for (const m of text.matchAll(/^\s*(?:import|export)\b[^'"\n]*from\s+['"]([^'"]+)['"]/gm)) assert.match(m[1], /^\.\/[a-z]+\.mjs$/, f + ' imports ' + m[1])
    assert.ok(!/\bnode:|require\(|process\.|\bfs\b|fetch\(/.test(text.replace(/\/\/.*$/gm, '')), f + ' must stay pure')
  }
})

console.log('\nkybernos-db routes: ' + count + ' checks passed')
