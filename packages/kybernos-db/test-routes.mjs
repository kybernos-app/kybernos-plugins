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
import { CORE_ROUTE, ROUTE, UPLOAD_MAX, VENDOR_ROUTES, coreFiles, uploadHandler } from './routes.mjs'
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

await ok('state names the template a database came from (null for one the person made), and survives markers that cannot be read', () => {
  const { svc, id } = seeded()
  const other = svc.create({ name: 'Mine', by: 'agent' }).db.info().id
  const named = makeApi({ service: svc, ports: { markers: () => ({ 'real-estate': id, junk: 7 }) } }).state()
  assert.deepEqual(named.dbs.map((d) => [d.id, d.template]).sort(), [[id, 'real-estate'], [other, null]].sort())
  assert.equal(makeApi({ service: svc }).state().dbs.every((d) => d.template === null), true, 'no markers port: no template names')
  assert.equal(makeApi({ service: svc, ports: { markers: () => { throw new Error('unreadable') } } }).state().ok, true)
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

// ---------------------------------------------------------------- files
const DOCS = { key: 'doc', label: 'Documents', title: 'name', fields: [{ key: 'name', type: 'text', label: 'Name', required: true }, { key: 'files', type: 'attachment', label: 'Files' }, { key: 'tiny', type: 'attachment', label: 'Tiny', maxBytes: 10 }, { key: 'id_card', type: 'attachment', label: 'ID card', protection: 'sensitive' }] }
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
const withDocs = () => {
  const svc = service()
  const db = svc.create({ name: 'Papers', by: 'agent' }).db
  assert.equal(db.addObject(DOCS, 'agent').ok, true)
  return { svc, db, api: makeApi({ service: svc, ports: { today: () => '2026-10-30' } }) }
}
/** One http call with raw bytes in, raw bytes out. */
async function hitRaw (routes, path, method, headers, bytes, query = '') {
  const req = {
    method, url: path + query,
    headers: { host: '127.0.0.1:3080', ...(method === 'POST' ? { 'content-type': 'application/octet-stream' } : {}), ...headers },
    socket: { localPort: 3080 },
    on (ev, fn) { if (ev === 'data' && bytes !== undefined) for (let i = 0; i < Math.max(bytes.length, 1); i += 1024 * 1024) fn(bytes.subarray(i, i + 1024 * 1024)); if (ev === 'end') fn() },
  }
  const out = { code: 200, body: Buffer.alloc(0), headers: {} }
  await routes[path.split('?')[0]].handler(req, { setHeader () {}, writeHead (c, h) { out.code = c; out.headers = h || {} }, end (b) { out.body = b === undefined ? Buffer.alloc(0) : Buffer.from(b) } })
  return out
}
const q = (o) => '?' + new URLSearchParams(o).toString()

await ok('upload stores a file for an attachment field and hands back the value to write; the field\'s own cap and the kind of field are enforced', () => {
  const { api, db } = withDocs()
  const up = api.upload({ object: 'doc', field: 'files', name: 'logo.png', type: 'image/png', bytes: PNG })
  assert.equal(up.ok, true, JSON.stringify(up))
  assert.deepEqual(Object.keys(up.file).sort(), ['hash', 'name', 'size', 'type'])
  assert.equal(up.file.size, PNG.length)
  assert.equal(db.blobs.has(up.file.hash), true)
  assert.equal(api.upload({ object: 'doc', field: 'tiny', name: 'a.txt', type: 'text/plain', bytes: Buffer.alloc(11) }).error, 'too-big', 'the field\'s cap')
  assert.equal(api.upload({ object: 'doc', field: 'tiny', name: 'a.txt', type: 'text/plain', bytes: Buffer.alloc(10) }).ok, true)
  assert.equal(api.upload({ object: 'doc', field: 'name', name: 'a.txt', type: 'text/plain', bytes: PNG }).error, 'invalid', 'a text field takes no file')
  assert.equal(api.upload({ object: 'doc', field: 'nope', name: 'a.txt', type: 'text/plain', bytes: PNG }).error, 'invalid')
  assert.equal(api.upload({ object: 'nope', field: 'files', name: 'a.txt', type: 'text/plain', bytes: PNG }).error, 'unknown_object')
  assert.equal(api.upload({ object: 'doc', field: 'files', name: 'a/b.txt', type: 'text/plain', bytes: PNG }).ok, false, 'a name with a slash')
  assert.equal(api.upload({ object: 'doc', field: 'files', name: 'a.txt', type: 'text/plain', bytes: 'text' }).error, 'invalid')
  const w = api.write({ object: 'doc', op: 'create', values: { name: 'Brand', files: [up.file] } })
  assert.equal(w.ok, true, JSON.stringify(w))
  assert.deepEqual(api.records({ object: 'doc' }).records[0].values.files, [up.file])
})

await ok('file gives the bytes of a file a row holds, and nothing for a hash the row does not hold, a missing row or a file gone from the disk', () => {
  const { api, db } = withDocs()
  const up = api.upload({ object: 'doc', field: 'files', name: 'logo.png', type: 'image/png', bytes: PNG }).file
  const other = api.upload({ object: 'doc', field: 'files', name: 'other.png', type: 'image/png', bytes: Buffer.from('other') }).file
  const row = api.write({ object: 'doc', op: 'create', values: { name: 'Brand', files: [up] } }).record
  const f = api.file({ object: 'doc', id: row.id, field: 'files', hash: up.hash })
  assert.equal(f.ok, true); assert.deepEqual(Buffer.from(f.bytes), PNG); assert.deepEqual(f.file, up)
  assert.equal(api.file({ object: 'doc', id: row.id, field: 'files', hash: other.hash }).error, 'missing', 'a blob is not served because its hash is known')
  assert.equal(api.file({ object: 'doc', id: row.id, field: 'tiny', hash: up.hash }).error, 'missing', 'nor from another field of the row')
  assert.equal(api.file({ object: 'doc', id: '01ARYZ6S410000000000000009', field: 'files', hash: up.hash }).error, 'missing')
  assert.equal(api.file({ object: 'doc', field: 'files', hash: up.hash }).error, 'missing')
  assert.equal(api.file({ object: 'doc', id: row.id, field: 'files', hash: 'x' }).error, 'missing')
  db.blobs.remove(up.hash)
  assert.equal(api.file({ object: 'doc', id: row.id, field: 'files', hash: up.hash }).error, 'missing', 'a file that left the disk')
})

await ok('upload and file are behind the signed session, like every data route', async () => {
  const { routes } = door()
  for (const [name, method] of [['upload', 'POST'], ['file', 'GET']]) {
    const path = ROUTE + name
    const query = q({ object: 'doc', field: 'files', name: 'a.png', type: 'image/png', id: '01ARYZ6S410000000000000001', hash: '0'.repeat(64) })
    const read = method === 'GET'
    assert.equal((await hitRaw(routes, path, method, {}, PNG, query)).code, read ? 401 : 403, path + ' no Origin, no cookie')
    assert.equal((await hitRaw(routes, path, method, { ...browserHeaders(), origin: 'http://evil.example' }, PNG, query)).code, 403, path + ' foreign Origin with the real cookie')
    assert.equal((await hitRaw(routes, path, method, { origin: 'http://127.0.0.1:3080' }, PNG, query)).code, 401, path + ' right Origin, no cookie')
    assert.equal((await hitRaw(routes, path, method, { origin: 'http://127.0.0.1:3080', cookie: sessionCookie(undefined, { secret: OTHER_SECRET }) }, PNG, query)).code, 401, path + ' forged cookie')
    assert.equal((await hitRaw(routes, path, method, { origin: 'http://127.0.0.1:3080', cookie: sessionCookie(undefined, { expiresAt: Date.now() - 1000 }) }, PNG, query)).code, 401, path + ' expired cookie')
    assert.equal((await hitRaw(routes, path, method, { ...browserHeaders(), host: 'attacker.example:3080' }, PNG, query)).code, 403, path + ' a Host that is not ours')
  }
})

await ok('the map library is served to the signed session only: the two files, byte for byte, kept for a day, and nothing else of vendor/', async () => {
  const { routes } = door()
  assert.deepEqual(Object.keys(routes).filter((r) => r.startsWith(ROUTE + 'vendor/')).sort(), Object.keys(VENDOR_ROUTES).map((n) => ROUTE + n).sort())
  for (const [name, [file, type]] of Object.entries(VENDOR_ROUTES)) {
    const path = ROUTE + name
    const bytes = readFileSync(new URL('./vendor/' + file, import.meta.url))
    assert.equal((await hitRaw(routes, path, 'GET', {}, undefined, '?v=5.24.0')).code, 401, path + ' no cookie')
    assert.equal((await hitRaw(routes, path, 'GET', { cookie: sessionCookie(undefined, { secret: OTHER_SECRET }) }, undefined, '')).code, 401, path + ' forged cookie')
    assert.equal((await hitRaw(routes, path, 'GET', { ...browserHeaders(), host: 'attacker.example:3080' }, undefined, '')).code, 403, path + ' a Host that is not ours')
    const got = await hitRaw(routes, path, 'GET', { cookie: sessionCookie() }, undefined, '?v=5.24.0')
    assert.equal(got.code, 200, path + ' the page’s own <script> sends the cookie and no Origin')
    assert.deepEqual(got.body, bytes)
    assert.equal(got.headers['content-type'], type); assert.equal(got.headers['x-content-type-options'], 'nosniff'); assert.equal(got.headers['cache-control'], 'private, max-age=86400')
    assert.equal(got.headers['content-length'], String(bytes.length))
    assert.equal((await hitRaw(routes, path, 'POST', browserHeaders(), Buffer.from('x'), '')).code, 405, path + ' only GET and HEAD')
  }
})

await ok('through the page: upload files, write them on a row, read them back; the type comes from the bytes, a picture is shown in place and anything else is a download', async () => {
  const { routes, home } = door()
  const svc = makeService({ dir: join(home, 'kybernos', 'kybernos-db', 'dbs'), ports: ports() })
  const made = svc.create({ name: 'Papers', by: 'agent' })
  made.db.addObject(DOCS, 'agent')
  const H = browserHeaders()
  const up = async (name, type, bytes) => JSON.parse((await hitRaw(routes, ROUTE + 'upload', 'POST', H, bytes, q({ object: 'doc', field: 'files', name, type }))).body)
  const PDF = Buffer.from('%PDF-1.4 x')
  const png = await up('logo.png', 'image/png', PNG)
  const pdf = await up('brief "final" é.pdf', 'application/pdf', PDF)
  const html = await up('page.html', 'text/html', Buffer.from('<script>alert(1)</script>'))
  const svg = await up('icon.svg', 'image/svg+xml', Buffer.from('<svg onload="alert(1)"/>'))
  const liar = await up('photo.png', 'image/png', Buffer.from('<script>alert(1)</script>'))
  const modest = await up('notes.txt', 'text/plain', PNG)
  for (const r of [png, pdf, html, svg, liar, modest]) assert.equal(r.ok, true, JSON.stringify(r))
  const row = JSON.parse((await hit(routes, ROUTE + 'write', 'POST', H, { object: 'doc', op: 'create', values: { name: 'Pack', files: [png.file, pdf.file, html.file, svg.file, liar.file, modest.file] } })).body).record
  const get = (file, method = 'GET') => hitRaw(routes, ROUTE + 'file', method, H, undefined, q({ object: 'doc', id: row.id, field: 'files', hash: file.hash }))
  const closed = "default-src 'none'; sandbox"
  const img = await get(png.file)
  assert.equal(img.code, 200); assert.deepEqual(img.body, PNG)
  assert.equal(img.headers['content-type'], 'image/png'); assert.equal(img.headers['content-disposition'], undefined, 'a picture is shown in place')
  assert.equal(img.headers['x-content-type-options'], 'nosniff'); assert.equal(img.headers['content-security-policy'], closed); assert.equal(img.headers['cache-control'], 'no-store')
  assert.equal(img.headers['content-length'], String(PNG.length))
  const asPicture = await get(modest.file)
  assert.equal(asPicture.headers['content-type'], 'image/png', 'a PNG that was uploaded as text/plain is still a picture: the bytes decide')
  for (const [label, f, type] of [['a PDF', pdf, 'application/octet-stream'], ['a page', html, 'application/octet-stream'], ['an SVG', svg, 'image/svg+xml'], ['a page that said it was a PNG', liar, 'application/octet-stream']]) {
    const r = await get(f.file)
    assert.equal(r.code, 200, label)
    assert.equal(r.headers['content-type'], type, label + ' is never shown as a document'); assert.equal(r.headers['content-disposition'], 'attachment', label)
    assert.equal(r.headers['content-security-policy'], closed, label); assert.equal(r.headers['x-content-type-options'], 'nosniff', label)
  }
  assert.deepEqual((await get(pdf.file)).body, PDF, 'a download is the very bytes that were sent')
  assert.equal((await get({ hash: '0'.repeat(64) })).code, 404)
  for (const method of ['POST', 'HEAD']) assert.equal((await hitRaw(routes, ROUTE + 'file', method, H, undefined, '')).code, 405, method)
  svc.close()
})

await ok('an upload refuses what is not octet-stream, what is over the cap (by its length and by what is really sent), and a field with its own cap', async () => {
  const { routes, home } = door()
  const svc = makeService({ dir: join(home, 'kybernos', 'kybernos-db', 'dbs'), ports: ports() })
  svc.create({ name: 'Papers', by: 'agent' }).db.addObject(DOCS, 'agent')
  const H = browserHeaders()
  const query = q({ object: 'doc', field: 'files', name: 'a.bin', type: 'application/octet-stream' })
  assert.equal((await hitRaw(routes, ROUTE + 'upload', 'POST', { ...H, 'content-type': 'application/json' }, PNG, query)).code, 415)
  assert.equal((await hitRaw(routes, ROUTE + 'upload', 'POST', { ...H, 'content-type': 'multipart/form-data; boundary=x' }, PNG, query)).code, 415)
  assert.equal((await hitRaw(routes, ROUTE + 'upload', 'GET', H, undefined, query)).code, 405)
  assert.equal((await hitRaw(routes, ROUTE + 'upload', 'POST', { ...H, 'content-length': String(UPLOAD_MAX + 1) }, PNG, query)).code, 413, 'by its announced length: nothing is read')
  const over = await hitRaw(routes, ROUTE + 'upload', 'POST', H, Buffer.alloc(UPLOAD_MAX + 1), query)
  assert.equal(over.code, 413); assert.equal(JSON.parse(over.body).error, 'too-big')
  assert.equal((await hitRaw(routes, ROUTE + 'upload', 'POST', H, Buffer.alloc(UPLOAD_MAX), query)).code, 200, 'the cap itself')
  // what is sent past the cap never reaches the api: the page is told 413 while the bytes are dropped as they arrive
  let reached = 0
  const spy = { routes: { [ROUTE + 'upload']: { handler: uploadHandler({ upload: () => { reached += 1; return { ok: true, file: {} } } }) } } }
  assert.equal((await hitRaw(spy.routes, ROUTE + 'upload', 'POST', H, Buffer.alloc(UPLOAD_MAX + 1), query)).code, 413)
  assert.equal(reached, 0)
  assert.equal((await hitRaw(spy.routes, ROUTE + 'upload', 'POST', H, Buffer.alloc(1024), query)).code, 200)
  assert.equal(reached, 1)
  const tiny = await hitRaw(routes, ROUTE + 'upload', 'POST', H, Buffer.alloc(11), q({ object: 'doc', field: 'tiny', name: 'a.bin', type: 'application/octet-stream' }))
  assert.equal(tiny.code, 413); assert.equal(JSON.parse(tiny.body).error, 'too-big')
  assert.equal((await hitRaw(routes, ROUTE + 'upload', 'POST', H, PNG, q({ object: 'doc', field: 'name', name: 'a.bin', type: 'application/octet-stream' }))).code, 400)
  assert.equal((await hitRaw(routes, ROUTE + 'upload', 'POST', H, PNG, q({ object: 'doc', field: 'files', name: 'a.bin' }))).code, 200, 'no type: octet-stream')
  svc.close()
})

await ok('apply mounts the data routes, the file door and the core files', () => {
  const { routes } = door()
  for (const name of ['state', 'records', 'links', 'write', 'view', 'upload', 'file']) assert.equal(typeof routes[ROUTE + name].handler, 'function', name)
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
