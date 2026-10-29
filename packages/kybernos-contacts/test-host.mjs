// kybernos-contacts, host half: the words of a theme, what a contact may carry, the routes over a REAL base (a temp file, the core's own
// business-base.mjs), the two agent tools and the approval gate. Hermetic: a temp DSH home, no network, the seams replaced by the test.
//
//   node packages/kybernos-contacts/test-host.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBusinessBase } from '../kybernos-plugin/business-base.mjs'
import { apply, makeApi, routeTable } from './index.js'
import { approvalGate, tools as makeTools } from './contacts-tools.mjs'
import { createApi } from './contacts-api.mjs'
import { defaultSchema, mergeSchema, schemaFrom, vocabulary } from './contacts-words.mjs'
import { checkContact } from './contacts-input.mjs'
import { sessionSource } from './session-guard.mjs'
import { SESSION_SECRET, browserHeaders } from './lib-session-test.mjs'

const home = mkdtempSync(join(tmpdir(), 'kb-contacts-host-'))
process.env.DSH_HOME = join(home, '.dsh')
sessionSource.secret = () => SESSION_SECRET
const BASE_SEAM = Symbol.for('kybernos.business')
const REGISTRY_SEAM = Symbol.for('kybernos.registry')

let failed = 0
const ok = (label, fn) => {
  try { const r = fn(); if (r instanceof Promise) return r.then(() => console.log('  ok   ' + label), (e) => { failed += 1; console.log('  FAIL ' + label + ' — ' + (e && e.message)) }); console.log('  ok   ' + label) } catch (e) { failed += 1; console.log('  FAIL ' + label + ' — ' + (e && e.message)) }
  return undefined
}

// ── the words ──────────────────────────────────────────────────────────────────────────────────────────────
const L = (en, fr) => (fr === undefined ? { en } : { en, fr })
const shop = { plugin: 'acme/shop', file: 'contacts/shop.json', value: { id: 'shop', types: [{ key: 'customer', kind: 'person', label: L('Customer', 'Client') }, { key: 'supplier', kind: 'person', label: L('Supplier') }], fields: [{ key: 'city', type: 'text', label: L('City') }, { key: 'tier', type: 'choice', options: ['gold', 'silver'] }, { key: 'credit', type: 'money', currency: 'EUR' }, { key: 'since', type: 'date' }, { key: 'site', type: 'url' }], tags: ['repeat', 'wholesale'] } }
const second = { plugin: 'acme/other', file: 'contacts/other.json', value: { id: 'other', types: [{ key: 'customer', kind: 'person', label: L('Dup') }, { key: 'grower', kind: 'company', label: L('Grower') }], fields: [{ key: 'city', type: 'number' }, { key: 'extra', type: 'text' }], tags: ['repeat', 'vip'] } }

console.log('── the words ──')
ok('no theme: plain English defaults, a person and a company', () => {
  const d = defaultSchema()
  assert.deepEqual(d.types.map((t) => [t.key, t.kind, t.label.en]), [['person', 'person', 'Person'], ['company', 'company', 'Company']])
  assert.equal(d.themed, false)
  assert.deepEqual(mergeSchema([]), d)
  assert.deepEqual(mergeSchema(null), d)
  assert.deepEqual(mergeSchema([{ plugin: 'x', value: 'broken' }, null, { value: { id: 'x' } }]), d, 'contributions that are not what the registry promises are skipped')
})
ok('a theme speaks: its types, fields and tags; a kind it gives no type for gets the plain one', () => {
  const m = mergeSchema([shop])
  assert.equal(m.themed, true)
  assert.deepEqual(m.themes, ['shop'])
  assert.deepEqual(m.types.map((t) => t.key), ['customer', 'supplier', 'company'])
  assert.deepEqual(m.fields.map((f) => f.key), ['city', 'tier', 'credit', 'since', 'site'])
  assert.deepEqual(m.tags, ['repeat', 'wholesale'])
})
ok('two themes merge: the first to name a key keeps it', () => {
  const m = mergeSchema([shop, second])
  assert.deepEqual(m.themes, ['shop', 'other'])
  assert.equal(m.types.find((t) => t.key === 'customer').label.en, 'Customer')
  assert.deepEqual(m.types.map((t) => t.key), ['customer', 'supplier', 'grower'])
  assert.equal(m.fields.find((f) => f.key === 'city').type, 'text')
  assert.deepEqual(m.fields.map((f) => f.key), ['city', 'tier', 'credit', 'since', 'site', 'extra'])
  assert.deepEqual(m.tags, ['repeat', 'wholesale', 'vip'])
})
ok('the schema is read from the registry seam when asked; a registry that fails gives the defaults, never a throw', () => {
  assert.deepEqual(schemaFrom(null), defaultSchema())
  assert.deepEqual(schemaFrom({ contributions: () => { throw new Error('boom') } }), defaultSchema())
  const asked = []
  const m = schemaFrom({ contributions: (ref) => { asked.push(ref); return [shop] } })
  assert.deepEqual(asked, ['kybernos/contacts#schema'])
  assert.equal(m.themed, true)
  assert.deepEqual(vocabulary(m).types.map((t) => t.key), ['customer', 'supplier', 'company'])
  assert.deepEqual(vocabulary(m).fields.find((f) => f.key === 'tier').options, ['gold', 'silver'])
})

// ── what a contact may carry ─────────────────────────────────────────────────────────────────────────────────
console.log('── what a contact may carry ──')
const themed = mergeSchema([shop])
const refused = (r, code, re) => { assert.equal(r.ok, false, JSON.stringify(r)); assert.equal(r.error, code, JSON.stringify(r)); if (re !== undefined) assert.match(r.detail, re) }
ok('a well-formed contact: only the keys given come back, text trimmed', () => {
  const r = checkContact(themed, { name: '  Léa Martin ', email: 'lea@example.com', type: 'customer', tags: 'repeat, vip, repeat', fields: { city: 'Lyon', credit: '12,5'.replace(',', '.'), tier: 'gold', since: '2026-02-29'.replace('29', '28') } }, { creating: true })
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.deepEqual(r.values, { name: 'Léa Martin', email: 'lea@example.com', type: 'customer', tags: ['repeat', 'vip'], fields: { city: 'Lyon', credit: 12.5, tier: 'gold', since: '2026-02-28' } })
})
ok('what is refused, with a reason an agent can act on', () => {
  refused(checkContact(themed, {}, { creating: true }), 'missing_field')
  refused(checkContact(themed, { name: 'a', actor: 'agent' }, { creating: true }), 'unknown_field', /no column "actor"/)
  refused(checkContact(themed, { name: 'a', demo: true }, { creating: true }), 'unknown_field')
  refused(checkContact(themed, { name: '' }, { creating: true }), 'bad_field')
  refused(checkContact(themed, { name: 'x'.repeat(201) }, { creating: true }), 'bad_field')
  refused(checkContact(themed, { name: 'a', email: 'nope' }, { creating: true }), 'bad_field', /email/)
  refused(checkContact(themed, { name: 'a', kind: 'robot' }, { creating: true }), 'bad_field')
  refused(checkContact(themed, { name: 'a', type: 'grower' }, { creating: true }), 'bad_field', /one of customer, supplier/)
  refused(checkContact(themed, { name: 'a', kind: 'company', type: 'customer' }, { creating: true }), 'bad_field', /one of company/)
  refused(checkContact(themed, { name: 'a', fields: { nope: 'x' } }, { creating: true }), 'unknown_field', /known: city, tier/)
  refused(checkContact(defaultSchema(), { name: 'a', fields: { nope: 'x' } }, { creating: true }), 'unknown_field', /no theme adds fields/)
  refused(checkContact(themed, { name: 'a', fields: { credit: 'abc' } }, { creating: true }), 'bad_field', /a number/)
  refused(checkContact(themed, { name: 'a', fields: { tier: 'bronze' } }, { creating: true }), 'bad_field', /one of gold, silver/)
  refused(checkContact(themed, { name: 'a', fields: { since: '2026-13-40' } }, { creating: true }), 'bad_field', /a date/)
  refused(checkContact(themed, { name: 'a', fields: { site: 'javascript:alert(1)' } }, { creating: true }), 'bad_field', /http/)
  refused(checkContact(themed, { name: 'a', fields: { city: 'x'.repeat(501) } }, { creating: true }), 'bad_field', /500/)
  refused(checkContact(themed, { name: 'a', company_id: 0 }, { creating: true }), 'bad_field')
  refused(checkContact(themed, { name: 'a', tags: [1] }, { creating: true }), 'bad_field')
})
ok('a change: the kind never changes, a type the theme dropped may stay, a field set to null is a clear', () => {
  const had = { kind: 'person', type: 'old-type', fields: { city: 'x' } }
  refused(checkContact(themed, { kind: 'company' }, { creating: false, current: had }), 'not_allowed')
  assert.equal(checkContact(themed, { kind: 'person', type: 'old-type' }, { creating: false, current: had }).ok, true, 'the same type it already has')
  refused(checkContact(themed, { type: 'other-old' }, { creating: false, current: had }), 'bad_field')
  assert.deepEqual(checkContact(themed, { fields: { city: null } }, { creating: false, current: had }).values, { fields: { city: null } })
})

// ── the routes, over a real base ─────────────────────────────────────────────────────────────────────────────
const file = join(home, 'business', 'donnees.sqlite')
const base = createBusinessBase({ file })
globalThis[BASE_SEAM] = base
globalThis[REGISTRY_SEAM] = { version: 1, contributions: () => [shop], definePoint () {} }

const routes = {}
const tools = {}
let gate = null
apply({
  get: (n) => (n === 'webServer' ? { register: (r) => { routes[r.path] = r.handler; return () => { delete routes[r.path] } } } : (n === 'tools' ? { register: (t) => { tools[t.name] = t } } : undefined)),
  effect: () => {}, inject: () => {}, on: (ev, fn) => { if (ev === 'tools/pre-execute') gate = fn },
}, { delays: [] })

const hit = async (path, { method = 'GET', headers = browserHeaders(), body, query = '', raw } = {}) => {
  const payload = raw !== undefined ? raw : (body === undefined ? undefined : JSON.stringify(body))
  const req = {
    method, url: path + query, headers: { host: '127.0.0.1:3080', ...(method === 'POST' ? { 'content-type': 'application/json' } : {}), ...headers },
    socket: { localPort: 3080 },
    on: (ev, fn) => { if (ev === 'data' && payload !== undefined) fn(payload); if (ev === 'end') setTimeout(() => fn(), 0) },
  }
  const out = { code: 200, body: '', headers: {} }
  await routes[path](req, { setHeader (k, v) { out.headers[k] = v }, writeHead (c, h) { out.code = c; Object.assign(out.headers, h || {}) }, end (b) { out.body = String(b === undefined ? '' : b) } })
  out.json = out.body === '' ? null : JSON.parse(out.body)
  return out
}
const get = (name, query) => hit('/kybernos-contacts/' + name, { query: query === undefined ? '' : '?' + new URLSearchParams(query) })
const post = (name, body, extra) => hit('/kybernos-contacts/' + name, Object.assign({ method: 'POST', body }, extra))
// exportAll journals itself (`export`): the helper leaves that line out so a count of the journal is not changed by looking at it
const changes = () => base.exportAll({ actor: 'person' }).tables.changes.filter((c) => c.action !== 'export')

console.log('── the routes ──')
await ok('the nine routes are mounted, every one of them behind the guard', async () => {
  assert.deepEqual(Object.keys(routes).sort(), ['archive', 'clear-demo', 'create', 'get', 'list', 'note', 'restore', 'schema', 'update'].map((n) => '/kybernos-contacts/' + n))
  assert.deepEqual(Object.keys(routeTable(makeApi())).sort(), ['archive', 'clear-demo', 'create', 'get', 'list', 'note', 'restore', 'schema', 'update'])
})
await ok('the theme words are served by the schema route', async () => {
  const r = await get('schema')
  assert.equal(r.code, 200)
  assert.deepEqual(r.json.schema.themes, ['shop'])
  assert.deepEqual(r.json.schema.types.map((t) => t.key), ['customer', 'supplier', 'company'])
})
let lea, acme, bob
await ok('create: a company, then people of it; the actor is the person and the journal says so', async () => {
  acme = (await post('create', { name: 'Acme Farm', kind: 'company', type: 'company', email: 'hello@acme.example', tags: ['wholesale'] })).json.contact
  assert.equal(acme.kind, 'company')
  lea = (await post('create', { name: 'Léa Martin', email: 'lea@example.com', type: 'customer', company_id: acme.id, tags: ['repeat'], fields: { city: 'Lyon', tier: 'gold', credit: 120 } })).json.contact
  bob = (await post('create', { name: 'Bob Stone', type: 'supplier' })).json.contact
  assert.equal(lea.company_id, acme.id)
  assert.deepEqual(lea.fields, { city: 'Lyon', tier: 'gold', credit: 120 })
  const last = changes().filter((c) => c.action === 'create').map((c) => c.actor)
  assert.deepEqual(last, ['person', 'person', 'person'])
})
await ok('create: a body that names an actor, a demo flag or an id is refused, and writes nothing', async () => {
  const before = base.counts().tables.contact
  for (const extra of [{ actor: 'agent' }, { demo: true }, { id: 99 }, { archived_at: 'x' }]) {
    const r = await post('create', Object.assign({ name: 'Mallory' }, extra))
    assert.equal(r.code, 400, JSON.stringify(extra))
    assert.equal(r.json.error, 'unknown_field')
  }
  assert.equal(base.counts().tables.contact, before)
})
await ok('list: search, kind, type, tag, company, paging, with the company name on each row', async () => {
  let r = (await get('list')).json
  assert.equal(r.ok, true)
  assert.equal(r.total, 3)
  assert.equal(r.rows.find((x) => x.id === lea.id).company.name, 'Acme Farm')
  assert.equal(r.demo, 0)
  assert.deepEqual((await get('list', { q: 'lea@' })).json.rows.map((x) => x.name), ['Léa Martin'])
  assert.deepEqual((await get('list', { q: '%' })).json.rows, [], 'a % is a letter, not a wildcard')
  assert.deepEqual((await get('list', { kind: 'company' })).json.rows.map((x) => x.name), ['Acme Farm'])
  assert.deepEqual((await get('list', { type: 'supplier' })).json.rows.map((x) => x.name), ['Bob Stone'])
  assert.deepEqual((await get('list', { tag: 'repeat' })).json.rows.map((x) => x.name), ['Léa Martin'])
  assert.deepEqual((await get('list', { company_id: String(acme.id) })).json.rows.map((x) => x.name), ['Léa Martin'])
  r = (await get('list', { limit: '2', offset: '0' })).json
  assert.equal(r.rows.length, 2); assert.equal(r.total, 3)
  assert.equal((await get('list', { limit: '2', offset: '2' })).json.rows.length, 1)
  assert.equal((await get('list', { limit: '9999' })).json.limit, 500, 'at most 500 rows')
})
await ok('list: a bad filter is a 400 with a reason, never a crash', async () => {
  for (const q of [{ kind: 'robot' }, { type: 'Bad Type!' }, { company_id: 'x' }, { limit: '0' }, { limit: 'many' }, { offset: '-1' }, { q: 'x'.repeat(201) }, { tag: 'x'.repeat(41) }]) {
    const r = await get('list', q)
    assert.equal(r.code, 400, JSON.stringify(q))
    assert.equal(r.json.ok, false)
  }
})
await ok('list: a tag filter finds rows past the first 500, and says when it had to stop', async () => {
  const many = createBusinessBase({ file: join(home, 'many', 'donnees.sqlite') })
  const api = createApi({ base: () => many, schema: () => themed })
  for (let i = 0; i < 520; i += 1) assert.equal(api.create({ name: 'Row ' + String(i).padStart(3, '0'), tags: i === 519 ? ['last'] : ['bulk'] }).ok, true)
  const r = api.list({ tag: 'last' })
  assert.equal(r.ok, true); assert.deepEqual(r.rows.map((x) => x.name), ['Row 519']); assert.equal(r.total, 1); assert.equal(r.truncated, false)
  const paged = api.list({ tag: 'bulk', limit: 100, offset: 400 })
  assert.equal(paged.total, 519); assert.equal(paged.rows.length, 100)
  many.close()
})
await ok('get: the contact with its notes, its company, and the people of a company', async () => {
  const r = (await get('get', { id: String(lea.id) })).json
  assert.equal(r.contact.name, 'Léa Martin'); assert.equal(r.company.name, 'Acme Farm'); assert.deepEqual(r.notes, [])
  const co = (await get('get', { id: String(acme.id) })).json
  assert.deepEqual(co.people.map((p) => p.name), ['Léa Martin'])
  assert.deepEqual(r.cards, [], 'no board points at her yet')
  base.create('flow_card', { flow: 'orders', stage: 'new', title: 'Order #1046', contact_id: lea.id }, { actor: 'person' })
  base.create('flow_card', { flow: 'orders', stage: 'paid', title: 'Order #1031', contact_id: lea.id }, { actor: 'person' })
  assert.deepEqual((await get('get', { id: String(lea.id) })).json.cards.map((c) => [c.title, c.flow, c.stage]), [['Order #1046', 'orders', 'new'], ['Order #1031', 'orders', 'paid']], 'the cards that point at her, read only, in the order the base keeps them (board, column, place)')
  assert.equal((await get('get', { id: '99999' })).code, 404)
  assert.equal((await get('get', { id: 'abc' })).code, 400)
  assert.equal((await get('get')).code, 400)
})
await ok('update: a patch changes what it names; fields merge, null clears; the kind cannot change', async () => {
  let r = await post('update', { id: lea.id, email: 'lea.martin@example.com', fields: { city: 'Paris', tier: null } })
  assert.equal(r.code, 200, r.body)
  assert.equal(r.json.contact.email, 'lea.martin@example.com')
  assert.deepEqual(r.json.contact.fields, { city: 'Paris', credit: 120 })
  assert.equal(r.json.contact.name, 'Léa Martin')
  r = await post('update', { id: lea.id, kind: 'company' })
  assert.equal(r.code, 400); assert.equal(r.json.error, 'not_allowed')
  r = await post('update', { id: lea.id })
  assert.equal(r.code, 400, 'nothing to change'); assert.equal(r.json.error, 'missing_field')
  r = await post('update', { id: 99999, name: 'x' })
  assert.equal(r.code, 404)
  r = await post('update', { id: lea.id, company_id: bob.id })
  assert.equal(r.code, 400, 'a person is not a company'); assert.equal(r.json.error, 'bad_field')
  r = await post('update', { id: lea.id, company_id: null })
  assert.equal(r.json.contact.company_id, null)
  await post('update', { id: lea.id, company_id: acme.id })
})
await ok('note: added with the actor person, newest first, never edited, bounded', async () => {
  let r = await post('note', { id: lea.id, text: '  Called her back  ' })
  assert.equal(r.code, 200); assert.equal(r.json.note.body, 'Called her back'); assert.equal(r.json.note.actor, 'person')
  await post('note', { id: lea.id, text: 'Second note' })
  const notes = (await get('get', { id: String(lea.id) })).json.notes
  assert.deepEqual(notes.map((n) => n.body), ['Second note', 'Called her back'])
  assert.equal((await post('note', { id: lea.id, text: '' })).code, 400)
  assert.equal((await post('note', { id: lea.id, text: 'x'.repeat(4001) })).code, 400)
  assert.equal((await post('note', { id: 99999, text: 'x' })).code, 404)
  assert.equal(routes['/kybernos-contacts/note-edit'], undefined, 'there is no route that edits a note')
})
await ok('archive then restore: the row leaves the list, stays under `archived`, comes back', async () => {
  let r = await post('archive', { id: bob.id })
  assert.equal(r.code, 200); assert.notEqual(r.json.contact.archived_at, null)
  assert.equal((await get('list')).json.total, 2)
  assert.equal((await get('list', { archived: '1' })).json.total, 3)
  r = await post('restore', { id: bob.id })
  assert.equal(r.json.contact.archived_at, null)
  assert.equal((await get('list')).json.total, 3)
  assert.equal((await post('archive', { id: 99999 })).code, 404)
  assert.deepEqual(changes().filter((c) => c.action === 'archive' || c.action === 'restore').map((c) => [c.action, c.actor]), [['archive', 'person'], ['restore', 'person']])
})
await ok('sample rows: counted, shown with the flag, and cleared only on a confirmed request', async () => {
  base.seed({ contacts: [{ ref: 'a', kind: 'company', name: 'Demo Farm' }, { ref: 'b', name: 'Demo Person', company_ref: 'a' }], notes: [{ contact_ref: 'b', body: 'sample' }] }, { theme: 'acme/shop' })
  const r = (await get('list')).json
  assert.equal(r.demo, 2)
  assert.equal(r.rows.filter((x) => x.demo).length, 2, 'both sample rows carry the flag')
  let c = await post('clear-demo', {})
  assert.equal(c.code, 400); assert.equal(c.json.error, 'confirm_required')
  assert.equal((await get('list')).json.demo, 2)
  c = await post('clear-demo', { confirm: true })
  assert.equal(c.code, 200); assert.equal(c.json.removed.contact, 2)
  assert.equal((await get('list')).json.demo, 0)
  assert.equal((await get('list')).json.total, 3, 'what the person made stays')
})
await ok('the method, the content type, the body: each wrong one is answered, not thrown', async () => {
  assert.equal((await hit('/kybernos-contacts/list', { method: 'POST', body: {} })).code, 405)
  assert.equal((await hit('/kybernos-contacts/create', { method: 'GET' })).code, 405)
  assert.equal((await hit('/kybernos-contacts/create', { method: 'POST', body: { name: 'x' }, headers: { ...browserHeaders(), 'content-type': 'text/plain' } })).code, 415)
  assert.equal((await hit('/kybernos-contacts/create', { method: 'POST', raw: '{nope' })).code, 400)
  assert.equal((await hit('/kybernos-contacts/create', { method: 'POST', raw: '[1]' })).code, 400)
  assert.equal((await hit('/kybernos-contacts/create', { method: 'POST', raw: JSON.stringify({ name: 'x'.repeat(40000) }) })).code, 413)
  assert.equal((await post('update', { id: 'x', name: 'y' })).json.error, 'bad_id')
})
await ok('a Host that is not this listener\'s is refused before anything else', async () => {
  const r = await hit('/kybernos-contacts/list', { headers: { ...browserHeaders(), host: 'attacker.example:3080' } })
  assert.equal(r.code, 403)
})

// ── no base ──────────────────────────────────────────────────────────────────────────────────────────────────
console.log('── no base ──')
await ok('without the base seam every route answers base_missing (503) and nothing throws', async () => {
  const kept = globalThis[BASE_SEAM]
  delete globalThis[BASE_SEAM]
  try {
    for (const [name, opts] of [['list'], ['get', { query: '?id=1' }], ['create', { method: 'POST', body: { name: 'x' } }], ['update', { method: 'POST', body: { id: 1, name: 'x' } }], ['archive', { method: 'POST', body: { id: 1 } }], ['restore', { method: 'POST', body: { id: 1 } }], ['note', { method: 'POST', body: { id: 1, text: 'x' } }], ['clear-demo', { method: 'POST', body: { confirm: true } }]]) {
      const r = await hit('/kybernos-contacts/' + name, opts || {})
      assert.equal(r.code, 503, name); assert.deepEqual(r.json, { ok: false, error: 'base_missing' }, name)
    }
    assert.equal((await get('schema')).code, 200, 'the words do not need the base')
    globalThis[BASE_SEAM] = { version: 2 }
    assert.equal((await get('list')).json.error, 'base_missing', 'a seam of another version is not used')
    globalThis[BASE_SEAM] = { version: 1, list () { throw new Error('boom') } }
    assert.equal((await get('list')).code, 500, 'a base that throws is a 500, with no stack')
    assert.equal((await get('list')).json.error, 'failed')
  } finally { globalThis[BASE_SEAM] = kept }
})
await ok('without a registry seam the words are the plain defaults', async () => {
  const kept = globalThis[REGISTRY_SEAM]
  delete globalThis[REGISTRY_SEAM]
  try {
    const r = (await get('schema')).json.schema
    assert.equal(r.themed, false); assert.deepEqual(r.types.map((t) => t.key), ['person', 'company'])
  } finally { globalThis[REGISTRY_SEAM] = kept }
})
ok('apply never throws, whatever the host hands it, and never stops the start', () => {
  for (const ctx of [undefined, null, {}, { get: () => undefined }, { get: () => { throw new Error('boom') } }, { get: () => undefined, inject: () => { throw new Error('boom') } }]) assert.doesNotThrow(() => apply(ctx, { delays: [] }))
})

// ── the tools ────────────────────────────────────────────────────────────────────────────────────────────────
console.log('── the tools ──')
const run = async (name, args) => tools[name].execute(args)
await ok('two tools are registered, with the engine\'s shape, and no network in them', async () => {
  assert.deepEqual(Object.keys(tools).sort(), ['contacts_find', 'contacts_upsert'])
  for (const t of Object.values(tools)) { assert.equal(typeof t.execute, 'function'); assert.equal(t.parameters.type, 'object'); assert.equal(t.parameters.additionalProperties, false); assert.equal(typeof t.output.render, 'function'); assert.ok(t.description.length > 60) }
  assert.deepEqual(makeTools(makeApi()).map((t) => t.name), ['contacts_find', 'contacts_upsert'])
})
await ok('contacts_find: by words, by tag, by id with notes; it carries the vocabulary; it writes nothing', async () => {
  const before = changes().length
  let r = await run('contacts_find', { q: 'martin' })
  assert.equal(r.ok, true); assert.equal(r.count, 1); assert.equal(r.contacts[0].company, 'Acme Farm')
  assert.deepEqual(r.vocabulary.types.map((t) => t.key), ['customer', 'supplier', 'company'])
  assert.ok(r.vocabulary.fields.some((f) => f.key === 'tier' && f.options.length === 2))
  r = await run('contacts_find', { tag: 'wholesale', kind: 'company' })
  assert.deepEqual(r.contacts.map((c) => c.name), ['Acme Farm'])
  r = await run('contacts_find', { id: lea.id })
  assert.equal(r.contact.name, 'Léa Martin'); assert.equal(r.notes.length, 2)
  assert.equal((await run('contacts_find', { id: 99999 })).error, 'not_found')
  assert.equal((await run('contacts_find', { limit: 1 })).contacts.length, 1)
  assert.equal((await run('contacts_find', undefined)).ok, true)
  assert.equal(changes().length, before, 'a read leaves nothing in the journal')
  assert.match(tools.contacts_find.output.render({}, r)[0].text, /Léa Martin/)
})
await ok('contacts_upsert: adds, with the actor agent in the journal; names a company; adds a note in the same call', async () => {
  const r = await run('contacts_upsert', { name: 'Zoé Kim', email: 'zoe@example.com', type: 'customer', company: 'acme farm', tags: ['vip'], fields: { city: 'Nice' }, note: 'Met at the fair' })
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.action, 'created'); assert.equal(r.note_added, true); assert.equal(r.contact.company, 'Acme Farm')
  const log = changes().filter((c) => /Zoé Kim|Met at/.test(c.summary))
  assert.ok(log.length >= 1 && log.every((c) => c.actor === 'agent'), JSON.stringify(log))
  const notes = (await get('get', { id: String(r.contact.id) })).json.notes
  assert.equal(notes[0].actor, 'agent')
  assert.match(tools.contacts_upsert.output.render({}, r)[0].text, /Contact added/)
})
await ok('contacts_upsert: changes with an id, refuses a duplicate email, a company that is not there, an ambiguous one, a bad key', async () => {
  const z = (await run('contacts_find', { q: 'Zoé' })).contacts[0]
  let r = await run('contacts_upsert', { id: z.id, fields: { city: 'Lille' }, tags: ['vip', 'repeat'] })
  assert.equal(r.ok, true); assert.equal(r.action, 'updated'); assert.deepEqual(r.contact.fields, { city: 'Lille' })
  r = await run('contacts_upsert', { name: 'Zoé Again', email: 'ZOE@example.com' })
  assert.equal(r.ok, false); assert.equal(r.error, 'duplicate'); assert.match(r.detail, new RegExp('id ' + z.id))
  r = await run('contacts_upsert', { name: 'Nobody', company: 'Ghost Ltd' })
  assert.equal(r.error, 'company_not_found')
  await post('create', { name: 'Twin', kind: 'company', type: 'company' }); await post('create', { name: 'twin', kind: 'company', type: 'company' })
  r = await run('contacts_upsert', { name: 'Nobody', company: 'TWIN' })
  assert.equal(r.error, 'company_ambiguous')
  r = await run('contacts_upsert', { name: 'Nobody', fields: { bogus: 1 } })
  assert.equal(r.error, 'unknown_field'); assert.match(r.detail, /known:/)
  r = await run('contacts_upsert', { fields: { city: 'x' } })
  assert.equal(r.error, 'missing_field', 'a new contact needs a name')
  r = await run('contacts_upsert', { id: z.id, company_id: 0 })
  assert.equal(r.contact.company_id, null, '0 detaches')
  assert.equal(base.list('contact', { q: 'Nobody' }).total, 0, 'a refused call writes nothing')
  assert.match(tools.contacts_upsert.output.render({}, { ok: false, error: 'duplicate', detail: 'x' })[0].text, /not written: duplicate/)
})
await ok('contacts_upsert: not a way around the base rules (a person cannot become another kind, an actor cannot be chosen)', async () => {
  const z = (await run('contacts_find', { q: 'Zoé' })).contacts[0]
  assert.equal((await run('contacts_upsert', { id: z.id, kind: 'company' })).error, 'not_allowed')
  const r = await run('contacts_upsert', { name: 'Sneaky', actor: 'person', demo: true })
  assert.equal(r.ok, true, 'unknown arguments are ignored by the tool, never forwarded')
  assert.equal(changes().filter((c) => /Sneaky/.test(c.summary)).every((c) => c.actor === 'agent'), true)
  assert.equal(base.list('contact', { q: 'Sneaky' }).rows[0].demo, false)
})
await ok('without the base the tools answer base_missing, they do not throw', async () => {
  const kept = globalThis[BASE_SEAM]
  delete globalThis[BASE_SEAM]
  try {
    assert.deepEqual(await run('contacts_find', { q: 'x' }), { ok: false, error: 'base_missing' })
    assert.deepEqual(await run('contacts_upsert', { name: 'x' }), { ok: false, error: 'base_missing' })
  } finally { globalThis[BASE_SEAM] = kept }
})

console.log('── the approval ──')
await ok('only contacts_upsert is gated, with a sentence that says what will be written, in both languages', async () => {
  assert.equal(approvalGate({ name: 'contacts_find', arguments: { q: 'x' } }), null)
  assert.equal(approvalGate({ name: 'bash', arguments: {} }), null)
  assert.equal(approvalGate(null), null)
  assert.equal(approvalGate(undefined), null)
  const add = approvalGate({ name: 'contacts_upsert', arguments: { name: 'Zoé Kim', note: 'x' } })
  assert.equal(add.kind, 'ask'); assert.match(add.reason, /add “Zoé Kim” in Contacts, with a note/); assert.match(add.displayReason.fr, /ajouter “Zoé Kim”/)
  const change = approvalGate({ name: 'contacts_upsert', arguments: { id: 7 } })
  assert.match(change.reason, /change contact #7/); assert.match(change.displayReason.fr, /modifier contact #7/)
  assert.equal(approvalGate({ name: 'contacts_upsert', arguments: 'broken' }).kind, 'ask', 'a malformed call is asked about, never let through')
  assert.match(approvalGate({ name: 'contacts_upsert', arguments: { name: 'x'.repeat(500) } }).reason, /x{50,}…/)
})
await ok('the engine\'s waterfall: the gate answers for the write, and hands every other call on', async () => {
  assert.equal(typeof gate, 'function')
  const next = async () => ({ kind: 'allow' })
  assert.deepEqual(await gate({ name: 'contacts_find', arguments: {} }, next), { kind: 'allow' })
  assert.equal((await gate({ name: 'contacts_upsert', arguments: { name: 'x' } }, next)).kind, 'ask')
})

console.log('── one template at a time ──')
await ok('the schema, the list and the writes follow the active template; with none active every theme speaks, as before', async () => {
  const keptBase = globalThis[BASE_SEAM]
  const keptRegistry = globalThis[REGISTRY_SEAM]
  try {
    let scope = null
    const one = createBusinessBase({ file: join(home, 'business', 'one-template.sqlite'), scope: () => scope })
    one.seed({ contacts: [{ name: 'Amelia the customer', type: 'customer' }, { name: 'Mateo the customer', type: 'customer' }] }, { theme: 'acme/shop' })
    one.seed({ contacts: [{ name: 'Gina the grower', type: 'grower', kind: 'company' }] }, { theme: 'acme/other' })
    globalThis[BASE_SEAM] = one
    globalThis[REGISTRY_SEAM] = { version: 1, contributions: () => [shop, second], definePoint () {} }
    const api = makeApi()
    assert.deepEqual(api.schema().schema.themes, ['shop', 'other'], 'none active: both themes')
    assert.equal(api.list({}).total, 3)
    scope = 'acme/shop'
    assert.deepEqual(api.schema().schema.themes, ['shop'])
    assert.deepEqual(api.schema().schema.types.map((t) => t.key), ['customer', 'supplier', 'company'], 'the shop\'s types, and the plain company the shop gives none for')
    assert.equal(api.list({}).total, 2)
    assert.equal(api.list({}).demo, 2, 'the sample count is the active template\'s')
    assert.equal(api.list({ q: 'Gina' }).total, 0)
    refused(api.create({ name: 'Gina 2', type: 'grower', kind: 'company' }), 'bad_field')
    const made = api.create({ name: 'Made in the shop', type: 'customer' })
    assert.equal(made.ok, true, JSON.stringify(made))
    assert.equal(made.contact.scope, 'acme/shop')
    scope = 'acme/other'
    assert.deepEqual(api.schema().schema.themes, ['other'])
    assert.deepEqual(api.list({}).rows.map((r) => r.name), ['Gina the grower'])
    assert.equal(api.vocabulary().types.some((t) => t.key === 'supplier'), false, 'an agent is not offered the shop\'s words either')
    assert.equal(api.clearDemo().ok, true)
    assert.equal(one.list('contact', { scope: 'acme/shop' }).total, 3, 'the other template\'s samples and the new customer are untouched')
    scope = 'acme/none'
    assert.equal(api.schema().schema.themed, false, 'an active template that speaks of no contact: the plain words')
    assert.deepEqual(schemaFrom({ contributions: () => [shop, second] }, 'acme/shop').themes, ['shop'])
    assert.deepEqual(schemaFrom({ contributions: () => [shop, second] }, null).themes, ['shop', 'other'])
    assert.deepEqual(schemaFrom({ contributions: () => [shop, second] }, '').themes, ['shop', 'other'])
    one.close()
  } finally { globalThis[BASE_SEAM] = keptBase; globalThis[REGISTRY_SEAM] = keptRegistry }
})

rmSync(home, { recursive: true, force: true })
if (failed > 0) { console.log('test-host: ' + failed + ' failure(s)'); process.exit(1) }
console.log('test-host: all green')
