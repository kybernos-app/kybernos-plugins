// kybernos-contacts, the frame: the point `kybernos/contacts#schema` (its check, bounded and pure), the host half that tells the registry about it
// without ever throwing, and the browser half that draws nothing yet but must still return a plugin.
//
//   node packages/kybernos-contacts/test-contacts.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { CONTACTS_POINT, CONTACTS_POINT_REF, LIMITS, RESERVED, validateContactsSchema as check } from './contacts-schema.mjs'
import { apply, name, tellPoint, tellWhenReady } from './index.js'

const here = fileURLToPath(new URL('.', import.meta.url))
let count = 0
const ok = (label, fn) => { fn(); count++; console.log('ok  ', label) }
const L = (en) => ({ en })
const good = () => ({
  id: 'shop',
  types: [{ key: 'customer', kind: 'person', label: { en: 'Customer', fr: 'Client' } }, { key: 'grower', kind: 'company', label: L('Grower') }],
  fields: [{ key: 'city', type: 'text', label: L('City') }, { key: 'delivery', type: 'choice', options: ['pickup', 'courier'] }, { key: 'credit', type: 'money', currency: 'EUR' }],
  tags: ['repeat', 'wholesale'],
})
const bad = (mutate, fileId = 'shop') => { const v = good(); mutate(v); return check(v, fileId) }
const refused = (r, re) => { assert.equal(r.ok, false, JSON.stringify(r)); assert.match(r.errors.join(' | '), re) }

ok('a well-formed schema is accepted, defaults filled, nothing added or lost', () => {
  const r = check(good(), 'shop')
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.deepEqual(r.value, good())
  assert.deepEqual(check({ id: 'min', types: [{ key: 'p', kind: 'person', label: L('P') }] }, 'min').value, { id: 'min', types: [{ key: 'p', kind: 'person', label: L('P') }], fields: [], tags: [] })
})
ok('the id is the name of the file', () => {
  refused(check(good(), 'other'), /must be the name of its file/)
  assert.equal(check(good()).ok, true, 'no file name given: only the shape is judged')
  refused(bad((v) => { v.id = 'Shop!' }, undefined), /id: lower-case letters/)
})
ok('only known keys, at every level', () => {
  refused(bad((v) => { v.colour = 'red' }), /unknown key "colour"/)
  refused(bad((v) => { v.types[0].icon = 'x' }), /types\[0\]: unknown key "icon"/)
  refused(bad((v) => { v.fields[0].default = 'x' }), /fields\[0\]: unknown key "default"/)
})
ok('types: 1 to 12, a key, a kind, a label, no duplicate', () => {
  refused(bad((v) => { v.types = [] }), /types: a list of 1 to 12/)
  refused(bad((v) => { delete v.types }), /types: a list of 1 to 12/)
  refused(bad((v) => { v.types = Array.from({ length: LIMITS.types + 1 }, (_, i) => ({ key: 't' + i, kind: 'person', label: L('T') })) }), /types: a list of 1 to 12/)
  assert.equal(bad((v) => { v.types = Array.from({ length: LIMITS.types }, (_, i) => ({ key: 't' + i, kind: 'person', label: L('T') })) }).ok, true)
  refused(bad((v) => { v.types[0].kind = 'robot' }), /types\[0\]\.kind: person or company/)
  refused(bad((v) => { v.types[1].key = 'customer' }), /types: "customer" appears twice/)
  refused(bad((v) => { v.types[0].key = 'Not A Key' }), /types\[0\]\.key/)
  refused(bad((v) => { delete v.types[0].label }), /types\[0\]\.label/)
})
ok('labels: English is required, the other languages are the four known ones, a bounded clean text', () => {
  refused(bad((v) => { v.types[0].label = { fr: 'Client' } }), /label\.en: required/)
  refused(bad((v) => { v.types[0].label = { en: 'x', de: 'y' } }), /unknown language "de"/)
  refused(bad((v) => { v.types[0].label = { en: 'x'.repeat(61) } }), /1 to 60 characters/)
  refused(bad((v) => { v.types[0].label = { en: '' } }), /1 to 60 characters/)
  refused(bad((v) => { v.types[0].label = { en: '<script>' } }), /no < >/)
  refused(bad((v) => { v.types[0].label = { en: 'a\u0007b' } }), /no < >/)
  refused(bad((v) => { v.types[0].label = 'Customer' }), /an object \{ en/)
  assert.equal(bad((v) => { v.types[0].label = { en: 'a', fr: 'b', es: 'c', ar: 'd' } }).ok, true)
})
ok('fields: at most 20, a free key, a known type, options only for a choice, a currency only for money, no duplicate, no reserved name', () => {
  refused(bad((v) => { v.fields = Array.from({ length: LIMITS.fields + 1 }, (_, i) => ({ key: 'f' + i, type: 'text' })) }), /fields: a list of at most 20/)
  refused(bad((v) => { v.fields[0].type = 'blob' }), /fields\[0\]\.type: one of/)
  refused(bad((v) => { v.fields[0].key = '1abc' }), /fields\[0\]\.key/)
  for (const key of RESERVED) refused(bad((v) => { v.fields[0].key = key }), /is already a column of the row/)
  refused(bad((v) => { v.fields[1].key = 'city' }), /fields: "city" appears twice/)
  refused(bad((v) => { delete v.fields[1].options }), /options: a list of 1 to 12/)
  refused(bad((v) => { v.fields[1].options = ['a', 'a'] }), /options: "a" appears twice/)
  refused(bad((v) => { v.fields[0].options = ['a'] }), /only a "choice" field has options/)
  refused(bad((v) => { v.fields[0].currency = 'EUR' }), /only a "money" field has a currency/)
  refused(bad((v) => { v.fields[2].currency = 'euro' }), /three capital letters/)
})
ok('tags: at most 20, each 1 to 40 clean characters, no duplicate', () => {
  refused(bad((v) => { v.tags = Array.from({ length: 21 }, (_, i) => 't' + i) }), /tags: a list of at most 20/)
  refused(bad((v) => { v.tags = ['x'.repeat(41)] }), /tags\[0\]/)
  refused(bad((v) => { v.tags = [7] }), /tags\[0\]/)
  refused(bad((v) => { v.tags = ['a', 'a'] }), /tags: "a" appears twice/)
  assert.deepEqual(bad((v) => { v.tags = [' a '] }).value.tags, ['a'], 'trimmed')
})
ok('anything that is not an object, and any other junk, is refused and never thrown', () => {
  for (const junk of [null, undefined, 7, 'text', true, [], [{}]]) refused(check(junk, 'x'), /JSON object/)
  for (const junk of [{ types: 'x' }, { types: [null] }, { types: [[]] }, { id: 'a', types: [{ key: 1, kind: {}, label: [] }], fields: [null, 3, 'x'], tags: 'x' }]) assert.equal(check(junk, 'a').ok, false)
  assert.ok(check({ id: 'a', types: 'x', fields: 'x', tags: 'x' }, 'a').errors.length <= 20, 'the list of errors is bounded')
})
ok('the point is what the registry expects: data, inert, version 1.0, at most four files', () => {
  assert.equal(CONTACTS_POINT_REF, 'kybernos/contacts#schema')
  assert.deepEqual([CONTACTS_POINT.owner, CONTACTS_POINT.name, CONTACTS_POINT.version, CONTACTS_POINT.kind, CONTACTS_POINT.class, CONTACTS_POINT.max], ['kybernos/contacts', 'schema', '1.0', 'data', 'inert', 4])
  assert.equal(CONTACTS_POINT.validate, check)
  assert.equal(Object.isFrozen(CONTACTS_POINT), true)
  const pj = JSON.parse(readFileSync(here + 'plugin.json', 'utf8'))
  assert.deepEqual([pj.id, pj.version, pj.kind, pj.provides[0].name, pj.provides[0].version, pj.provides[0].class], ['kybernos/contacts', CONTACTS_POINT.ownerVersion, 'code', 'schema', '1.0', 'inert'])
  assert.equal(JSON.parse(readFileSync(here + 'package.json', 'utf8')).version, pj.version)
})

// ── the host half ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const SEAM = Symbol.for('kybernos.registry')
const withSeam = (seam, fn) => { const was = globalThis[SEAM]; if (seam === undefined) delete globalThis[SEAM]; else globalThis[SEAM] = seam; try { return fn() } finally { if (was === undefined) delete globalThis[SEAM]; else globalThis[SEAM] = was } }
/** A clock the test drives: `tick()` runs the oldest pending timer; the delays asked are kept. */
const clock = () => { const pending = []; const asked = []; return { asked, schedule: (fn, ms) => { pending.push(fn); asked.push(ms); return { unref () { asked.push('unref') } } }, tick: () => { const fn = pending.shift(); if (fn) fn(); return pending.length } } }
const quiet = { schedule: () => undefined }
ok('without a registry, the plugin starts and says it told nobody', () => {
  assert.equal(name, 'kybernos-contacts')
  withSeam(undefined, () => { assert.equal(tellPoint(), false); apply({}, quiet) })
})
ok('with a registry, the point is told at boot and again on each question (the same definition twice is fine)', () => {
  const told = []
  const seam = { version: 1, definePoint: (def) => told.push(def) }
  withSeam(seam, () => { apply({}, quiet); assert.equal(tellPoint(), true) })
  assert.deepEqual(told, [CONTACTS_POINT, CONTACTS_POINT])
})
ok('a registry that mounts after the plugin still hears the point: told again after each delay until it answers, then no more timers', () => {
  const told = []
  const c = clock()
  const heard = withSeam(undefined, () => tellWhenReady({ schedule: c.schedule, delays: [10, 20, 30] }))
  assert.equal(heard(), false)
  assert.deepEqual(c.asked, [10, 'unref'], 'one timer at a time, and it never holds DSH open')
  assert.equal(withSeam(undefined, () => c.tick()), 1, 'still no registry: the next timer is set')
  assert.equal(heard(), false)
  const seam = { version: 1, definePoint: (def) => told.push(def) }
  assert.equal(withSeam(seam, () => c.tick()), 0, 'the registry is there: told, and no timer left')
  assert.equal(heard(), true)
  assert.deepEqual(told, [CONTACTS_POINT])
  assert.deepEqual(c.asked, [10, 'unref', 20, 'unref'])
})
ok('a registry that never comes: the telling gives up after the last delay, and nothing throws', () => {
  const c = clock()
  const heard = withSeam(undefined, () => tellWhenReady({ schedule: c.schedule, delays: [1, 2] }))
  assert.equal(withSeam(undefined, () => c.tick()), 1)
  assert.equal(withSeam(undefined, () => c.tick()), 0)
  assert.equal(heard(), false)
  assert.deepEqual(c.asked.filter((x) => x !== 'unref'), [1, 2])
})
ok('a registry that throws, a registry of another version, a frozen global: nothing stops DSH from starting', () => {
  withSeam({ version: 1, definePoint: () => { throw new Error('boom') } }, () => { assert.equal(tellPoint(), false); apply({}, quiet) })
  withSeam({ version: 2, definePoint: () => assert.fail('a registry of another version is not spoken to') }, () => { assert.equal(tellPoint(), false); apply({}, quiet) })
  withSeam({ version: 1 }, () => { assert.equal(tellPoint(), false); apply({}, quiet) })
  const logs = []
  const log = console.log
  console.log = (...a) => logs.push(a.join(' '))
  try {
    withSeam({ version: 1, definePoint: () => { throw new Error('boom') } }, () => apply({}, quiet))
    withSeam(undefined, () => apply({}, { schedule: () => { throw new Error('no timers here') } }))
  } finally { console.log = log }
  assert.equal(logs.length, 1, 'only a broken clock is worth a line; tellPoint already answers false for the rest: ' + logs.join(' | '))
  assert.match(logs[0], /^\[kybernos-contacts\] disabled: no timers here$/)
})

// ── the browser half ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
ok('the browser half hands the loader a plugin that never throws, and mounts nothing when the slots service is not there', () => {
  const loaded = []
  const warns = []
  const sandbox = { window: { __ModuleLoader__: { load: (entry) => loaded.push(entry) } }, console: { warn: (...a) => warns.push(a), log () {} } }
  vm.runInNewContext(readFileSync(here + 'client.js', 'utf8'), sandbox)
  assert.equal(loaded.length, 1)
  assert.equal(loaded[0].id, '@local/kybernos-contacts')
  const plugin = loaded[0].factory((m) => (m === 'react' ? {} : assert.fail('it requires nothing but react: ' + m)))
  assert.equal(typeof plugin, 'object')
  assert.equal(typeof plugin.apply, 'function')
  assert.equal(JSON.stringify(plugin.inject), '["slots"]') // an array made in the loader's realm
  assert.equal(plugin.apply({ effect: () => assert.fail('no slots service: nothing is registered') }), undefined)
  assert.deepEqual(warns, [])
  const src = readFileSync(here + 'client.js', 'utf8')
  assert.doesNotMatch(src, /#[0-9a-fA-F]{3,6}\b|rgba?\(/, 'no colour of its own')
})

console.log('\n' + count + ' checks passed')
