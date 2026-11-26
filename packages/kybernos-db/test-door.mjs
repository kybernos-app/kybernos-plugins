// kybernos-db, the actor-aware door (api.mjs `as(actor)`): the rights matrix of a team member over a real db built from the e-commerce template (its own profile), asked
// the way a hand-written request would ask it. The decision is the door's, so each case goes through it and not through the page.
//
//   node packages/kybernos-db/test-door.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeService } from './agent/service.mjs'
import { makeApi } from './api.mjs'
import { buildStructure, validateTemplate } from './template.mjs'

let count = 0
const ok = (label, fn) => { fn(); count++; console.log('ok  ', label) }
const root = mkdtempSync(join(tmpdir(), 'kb-db-door-'))
const clock = () => { let t = Date.UTC(2026, 9, 31, 9, 0, 0); return () => (t += 1) }
const sequence = () => { let i = 0; return (len) => { i += 1; return Uint8Array.from({ length: len }, (_, k) => (i * 31 + k * 7 + 1) & 255) } }

const raw = JSON.parse(readFileSync(new URL('../kybernos-plugin/themes/ecommerce/db/ecommerce.json', import.meta.url), 'utf8'))
const built = buildStructure(raw, 'en')

/** The e-commerce app as the template makes it, with two fields the profile does not name: a personal phone and a sensitive IBAN on the contacts. */
function shop () {
  const svc = makeService({ dir: join(root, 's'), ports: { now: clock(), random: sequence() } })
  const made = svc.create({ name: built.name, by: 'template', objects: built.objects })
  assert.ok(made.ok, JSON.stringify(made))
  const db = made.db
  assert.ok(db.setProfiles(built.profiles, 'template').ok)
  assert.ok(db.addField('contact', { key: 'phone', type: 'text', label: 'Phone', protection: 'personal' }, 'agent').ok)
  assert.ok(db.addField('contact', { key: 'iban', type: 'text', label: 'IBAN', protection: 'sensitive' }, 'agent').ok)
  const row = (object, values) => { const r = db.create(object, values, 'agent'); assert.ok(r.ok, object + ': ' + JSON.stringify(r)); return r.record.id }
  const ada = row('contact', { name: 'Ada', email: 'ada@example.com', phone: '0102030405', iban: 'FR7612345' })
  const candle = row('product', { title: 'Candle', price: 12, stock: 4 })
  const order = row('orders', { title: '#1001', stage: undefined })
  const note = row('note', { body: 'Likes beeswax' })
  return { api: makeApi({ service: svc, ports: { today: () => '2026-10-31' } }), db, id: db.info().id, ada, candle, order, note }
}

const app = shop()
const owner = app.api
const member = app.api.as({ kind: 'member', role: 'member', id: 'u1' })
const q = (object, more) => ({ db: app.id, object, ...(more || {}) })
const forbidden = (r, reason) => { assert.equal(r.ok, false, JSON.stringify(r)); assert.equal(r.error, 'forbidden', JSON.stringify(r)); if (reason !== undefined) assert.equal(r.reason, reason, JSON.stringify(r)) }

ok('the template carries the member profile and the db keeps it', () => {
  assert.ok(validateTemplate(raw, 'ecommerce').ok)
  assert.deepEqual(app.db.profiles().map((p) => p.id), ['member'])
})

ok('a member may ask for fewer records too, and still reads only what their profile shows', () => {
  for (let i = 0; i < 4; i += 1) app.db.create('product', { title: 'P' + i, price: 1, stock: 1 }, 'agent')
  const all = member.records(q('product'))
  assert.ok(all.ok && all.records.length >= 5 && all.truncated === false)
  const two = member.records(q('product', { limit: '2' }))
  assert.deepEqual([two.records.length, two.truncated, two.total], [2, true, all.total])
  assert.deepEqual(two.records.map((r) => r.id), all.records.slice(0, 2).map((r) => r.id))
  assert.equal(member.records(q('product', { limit: 'x' })).records.length, all.records.length)
})

ok('a member searches what their profile shows and nothing else: a hidden field cannot be found, filtered on or sorted by', () => {
  const seenBy = member.records(q('contact'))
  assert.ok(seenBy.ok && seenBy.records.length >= 1)
  const hidden = ['phone', 'iban'].filter((k) => seenBy.records.every((r) => !(k in r.values)))
  assert.ok(hidden.length >= 1, 'the member profile hides at least one of the personal fields')
  const text = { phone: '0102030405', iban: 'FR7612345' }
  for (const k of hidden) {
    assert.equal(owner.records(q('contact', { q: text[k] })).matched, 1, k + ': the owner finds it')
    assert.equal(member.records(q('contact', { q: text[k] })).matched, 0, k + ': a search does not find it for a member')
    const flt = JSON.stringify({ conj: 'and', items: [{ k, op: 'contains', v: text[k] }] })
    assert.equal(member.records(q('contact', { flt })).matched, 0, k + ': nor does a filter')
  }
  assert.equal(member.records(q('product', { q: 'candle' })).matched, 1, 'what they see is found')
  assert.equal(member.records(q('product', { q: 'candle' })).total, member.records(q('product')).total, '`total` stays the table')
})

ok('the owner is unchanged: every field in clear, every table, the structure', () => {
  const r = owner.records(q('contact'))
  assert.ok(r.ok)
  assert.equal(r.records[0].values.iban, 'FR7612345')
  assert.ok(owner.state().dbs[0].objects.some((o) => o.key === 'contact'))
  assert.equal(owner.as({ kind: 'person', role: 'owner' }), owner)
})

ok('a member sees the tables they have a grant for, and in each only the fields their profile shows, with what each allows', () => {
  const s = member.state()
  assert.ok(s.ok)
  const d = s.dbs[0]
  assert.equal(d.profile.id, 'member')
  assert.deepEqual(d.objects.map((o) => o.key).sort(), ['contact', 'note', 'orders', 'product'])
  const contact = d.objects.find((o) => o.key === 'contact')
  assert.equal(contact.fields.find((f) => f.key === 'email').access, 'read', 'a personal field the profile names')
  assert.equal(contact.fields.find((f) => f.key === 'name').access, 'write')
  assert.equal(contact.fields.some((f) => f.key === 'phone' || f.key === 'iban'), false, 'a personal field not named, and a sensitive one, are not even listed')
  const product = d.objects.find((o) => o.key === 'product')
  assert.equal(product.fields.find((f) => f.key === 'price').access, 'read')
  assert.equal(product.fields.find((f) => f.key === 'stock').access, 'write')
  assert.deepEqual(product.can, { create: false, update: true })
  assert.deepEqual(contact.can, { create: true, update: true })
  assert.equal(JSON.stringify(s).includes('FR7612345'), false)
})

ok('what a member reads has no hidden field in it, whichever door it comes through', () => {
  const r = member.records(q('contact'))
  assert.ok(r.ok)
  assert.equal(r.records[0].values.email, 'ada@example.com')
  assert.equal(Object.prototype.hasOwnProperty.call(r.records[0].values, 'phone'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(r.records[0].values, 'iban'), false)
  assert.equal(JSON.stringify(r).includes('0102030405') || JSON.stringify(r).includes('FR7612345'), false)
  assert.ok(member.records(q('product')).ok)
  const linked = member.links(q('contact', { id: app.ada }))
  assert.ok(linked.ok)
})

ok('a member adds and edits where the profile says, and what they write is journalled as them', () => {
  const made = member.write({ ...q('orders'), op: 'create', values: { title: '#1002' } })
  assert.ok(made.ok, JSON.stringify(made))
  const edited = member.write({ ...q('orders'), op: 'update', id: made.record.id, values: { title: '#1002 rush' } })
  assert.ok(edited.ok, JSON.stringify(edited))
  assert.equal(app.db.get('orders', made.record.id).values.title, '#1002 rush')
  const last = app.db.journal({ object: 'orders', record: made.record.id }).at(-1)
  assert.equal(last.by, 'member:u1')
  assert.ok(member.write({ ...q('note'), op: 'create', values: { body: 'Call back' } }).ok)
  assert.ok(member.write({ ...q('contact'), op: 'update', id: app.ada, values: { city: 'Leeds' } }).ok)
})

ok('the one writable field of a read-only table can be edited, and no other', () => {
  assert.ok(member.write({ ...q('product'), op: 'update', id: app.candle, values: { stock: 3 } }).ok)
  assert.equal(app.db.get('product', app.candle).values.stock, 3)
  forbidden(member.write({ ...q('product'), op: 'update', id: app.candle, values: { price: 1 } }), 'read-only-field')
  forbidden(member.write({ ...q('product'), op: 'update', id: app.candle, values: { stock: 2, price: 1 } }), 'read-only-field')
  assert.equal(app.db.get('product', app.candle).values.stock, 3, 'a refused write changes nothing, not even the allowed field of it')
  forbidden(member.write({ ...q('product'), op: 'create', values: { title: 'New' } }), 'no-access')
})

ok('a member cannot write a field they cannot see, or one they only read', () => {
  forbidden(member.write({ ...q('contact'), op: 'update', id: app.ada, values: { email: 'x@y.z' } }), 'read-only-field')
  forbidden(member.write({ ...q('contact'), op: 'update', id: app.ada, values: { phone: '1' } }), 'hidden-field')
  forbidden(member.write({ ...q('contact'), op: 'update', id: app.ada, values: { iban: 'x' } }), 'hidden-field')
  const r = member.write({ ...q('contact'), op: 'update', id: app.ada, values: { nonsense: 1 } })
  assert.equal(r.ok, false)
  assert.equal(app.db.get('contact', app.ada).values.phone, '0102030405')
  assert.equal(app.db.get('contact', app.ada).values.email, 'ada@example.com')
})

ok('a member never deletes or restores, whatever the table', () => {
  for (const object of ['contact', 'orders', 'note', 'product']) {
    const id = { contact: app.ada, orders: app.order, note: app.note, product: app.candle }[object]
    forbidden(member.write({ ...q(object), op: 'delete', id }), 'members-never-delete')
    forbidden(member.write({ ...q(object), op: 'restore', id }), 'members-never-delete')
    assert.equal(app.db.get(object, id).deleted, null, object + ' is still there')
  }
})

ok('a member never changes structure, views or the app, and cannot read what was deleted', () => {
  forbidden(member.view({ ...q('orders'), op: 'save', view: { id: 'x', name: 'X', kind: 'table' } }), 'owner-only')
  forbidden(member.app({ db: app.id, op: 'archive' }), 'owner-only')
  forbidden(member.app({ db: app.id, object: 'orders', op: 'delete', confirm: 'Orders' }), 'owner-only')
  forbidden(member.impact({ db: app.id }), 'owner-only')
  assert.equal(app.db.listViews('orders').some((v) => v.id === 'x'), false)
  assert.ok(owner.write({ ...q('note'), op: 'delete', id: app.note }).ok)
  const rows = member.records(q('note', { deleted: true })).records
  assert.equal(rows.some((r) => r.id === app.note), false, 'a deleted row is the owner’s to see')
  assert.ok(owner.write({ ...q('note'), op: 'restore', id: app.note }).ok)
})

ok('a role the app has no profile for gets nothing, and so does anyone that is not the owner or a member', () => {
  const stranger = app.api.as({ kind: 'member', role: 'ghost', id: 'u2' })
  assert.deepEqual(stranger.state().dbs, [])
  forbidden(stranger.records(q('orders')), 'no-profile')
  forbidden(stranger.write({ ...q('orders'), op: 'create', values: { title: 'x' } }), 'no-profile')
  for (const actor of [null, undefined, {}, { kind: 'agent', role: 'owner' }, { kind: 'person', role: 'member' }, { kind: 'member' }, { kind: 'bot', role: 'owner' }]) {
    const door = app.api.as(actor)
    forbidden(door.state(), 'not-allowed')
    forbidden(door.records(q('orders')), 'not-allowed')
    forbidden(door.write({ ...q('orders'), op: 'create', values: { title: 'x' } }), 'not-allowed')
  }
})

ok('profiles are read from the app, not from the request: a member cannot hand the door a richer profile', () => {
  const forged = app.api.as({ kind: 'member', role: 'member', id: 'u3', profile: { id: 'member', label: 'x', grants: [{ object: 'contact', do: ['read', 'create', 'update'], fields: { phone: 'write', iban: 'write' } }] } })
  forbidden(forged.write({ ...q('contact'), op: 'update', id: app.ada, values: { phone: '9' } }), 'hidden-field')
  assert.equal(JSON.stringify(forged.records(q('contact'))).includes('0102030405'), false)
})

ok('an app with no profile at all shows a member nothing', () => {
  const svc = makeService({ dir: join(root, 'bare'), ports: { now: clock(), random: sequence() } })
  const made = svc.create({ name: 'Bare', by: 'agent', objects: built.objects })
  assert.ok(made.ok)
  const door = makeApi({ service: svc, ports: {} }).as({ kind: 'member', role: 'member', id: 'u1' })
  assert.deepEqual(door.state().dbs, [])
  forbidden(door.records({ db: made.db.info().id, object: 'orders' }), 'no-profile')
})

rmSync(root, { recursive: true, force: true })
console.log('\nkybernos-db door: ' + count + ' checks passed')
