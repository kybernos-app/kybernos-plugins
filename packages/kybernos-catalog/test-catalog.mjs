// kybernos-catalog, the frame: the point `kybernos/catalog#type` (its check, bounded and pure), the host half that tells the registry about it
// without ever throwing, and the browser half that draws nothing yet but must still return a plugin.
//
//   node packages/kybernos-catalog/test-catalog.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { CATALOG_POINT, CATALOG_POINT_REF, ICONS, LIMITS, PICTURE, RESERVED, TONES, VIEWS, validateCatalogType as check } from './catalog-type.mjs'
import { apply, name, tellPoint, tellWhenReady } from './index.js'

const here = fileURLToPath(new URL('.', import.meta.url))
let count = 0
const ok = (label, fn) => { fn(); count++; console.log('ok  ', label) }
const L = (en) => ({ en })
const good = () => ({
  id: 'product', label: { en: 'Product', fr: 'Produit' }, plural: L('Products'), icon: 'package',
  statuses: [{ key: 'live', tone: 'ok', label: L('Live') }, { key: 'out', tone: 'bad', label: L('Out of stock') }],
  fields: [{ key: 'sku', type: 'text' }, { key: 'stock', type: 'number' }, { key: 'price', type: 'money', currency: 'EUR' }, { key: 'size', type: 'choice', options: ['s', 'm'] }],
  card: { title: 'title', subtitle: 'sku', price: 'price', flag: { field: 'stock', lte: 10, label: L('Low stock: {n} left') } },
  views: ['cards', 'list'],
})
const bad = (mutate, fileId = 'product') => { const v = good(); mutate(v); return check(v, fileId) }
const refused = (r, re) => { assert.equal(r.ok, false, JSON.stringify(r)); assert.match(r.errors.join(' | '), re) }

ok('a well-formed type is accepted, nothing added or lost', () => {
  const r = check(good(), 'product')
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.deepEqual(r.value, good())
})
ok('the smallest type: defaults are filled (package icon, no field, no card, both views)', () => {
  const r = check({ id: 'job', label: L('Job'), plural: L('Jobs'), statuses: [{ key: 'open', label: L('Open') }] }, 'job')
  assert.deepEqual(r.value, { id: 'job', label: L('Job'), plural: L('Jobs'), icon: 'package', statuses: [{ key: 'open', tone: 'neutral', label: L('Open') }], fields: [], card: {}, views: ['cards', 'list'] })
})
ok('the id is the name of the file; only known keys', () => {
  refused(check(good(), 'other'), /must be the name of its file/)
  refused(bad((v) => { v.colour = 'red' }), /unknown key "colour"/)
  refused(bad((v) => { v.statuses[0].icon = 'x' }), /statuses\[0\]: unknown key "icon"/)
  refused(bad((v) => { v.card.colour = 'x' }), /card: unknown key "colour"/)
})
ok('label and plural are both required, and clean', () => {
  refused(bad((v) => { delete v.label }), /label: an object/)
  refused(bad((v) => { delete v.plural }), /plural: an object/)
  refused(bad((v) => { v.label = { fr: 'Produit' } }), /label\.en: required/)
  refused(bad((v) => { v.plural = { en: '<b>' } }), /no < >/)
})
ok('the icon is one the page can draw', () => {
  for (const icon of ICONS) assert.equal(bad((v) => { v.icon = icon }).ok, true)
  refused(bad((v) => { v.icon = 'rocket' }), /icon: one of package/)
})
ok('statuses: 1 to 12, a key, a tone, a label, no duplicate', () => {
  refused(bad((v) => { v.statuses = [] }), /statuses: a list of 1 to 12/)
  refused(bad((v) => { v.statuses = Array.from({ length: LIMITS.statuses + 1 }, (_, i) => ({ key: 's' + i, label: L('S') })) }), /statuses: a list of 1 to 12/)
  for (const tone of TONES) assert.equal(bad((v) => { v.statuses[0].tone = tone }).ok, true)
  refused(bad((v) => { v.statuses[0].tone = 'purple' }), /tone: one of ok, warn, bad, neutral/)
  refused(bad((v) => { v.statuses[1].key = 'live' }), /statuses: "live" appears twice/)
  refused(bad((v) => { delete v.statuses[0].label }), /statuses\[0\]\.label/)
})
ok('fields: the same rules as the contacts, and the names an item already has are taken', () => {
  for (const key of RESERVED) refused(bad((v) => { v.fields[0].key = key; v.card = {} }), /is already a column of the row/)
  refused(bad((v) => { v.fields[1].key = 'sku' }), /fields: "sku" appears twice/)
  refused(bad((v) => { v.fields[0].type = 'blob' }), /fields\[0\]\.type: one of/)
  refused(bad((v) => { delete v.fields[3].options }), /options: a list of 1 to 12/)
  refused(bad((v) => { v.fields = Array.from({ length: LIMITS.fields + 1 }, (_, i) => ({ key: 'f' + i, type: 'text' })); v.card = {} }), /fields: a list of at most 20/)
})
ok('the card names the item\'s own title and subtitle, or one of the fields, by key', () => {
  refused(bad((v) => { v.card.price = 'cost' }), /card\.price: "title", "subtitle" or the key of one of the fields/)
  refused(bad((v) => { v.card.title = 7 }), /card\.title/)
  assert.equal(bad((v) => { v.card = { title: 'sku', subtitle: 'subtitle', price: 'stock' } }).ok, true)
  assert.equal(bad((v) => { delete v.card }).ok, true)
})
ok('the flag points at a number or money field, with a threshold and a label', () => {
  refused(bad((v) => { v.card.flag.field = 'sku' }), /flag\.field: the key of a number or money field/)
  refused(bad((v) => { v.card.flag.field = 'nope' }), /flag\.field/)
  refused(bad((v) => { delete v.card.flag.lte }), /lte or gte is needed/)
  refused(bad((v) => { v.card.flag.lte = 'ten' }), /flag\.lte: a finite number/)
  refused(bad((v) => { v.card.flag.gte = Infinity }), /flag\.gte: a finite number/)
  refused(bad((v) => { delete v.card.flag.label }), /flag\.label: an object/)
  refused(bad((v) => { v.card.flag.label = { en: 'x'.repeat(81) } }), /1 to 80 characters/)
  assert.equal(bad((v) => { delete v.card.flag.lte; v.card.flag.gte = 100 }).value.card.flag.gte, 100)
  refused(bad((v) => { v.card.flag = 'low' }), /card\.flag: an object/)
  // a flag on a field the type then lost is refused, not drawn wrong
  refused(bad((v) => { v.fields = v.fields.filter((f) => f.key !== 'stock') }), /flag\.field/)
})
ok('views: one to three of cards, list and map, no duplicate; the map only for a type that says where its items are', () => {
  assert.deepEqual([...VIEWS], ['cards', 'list', 'map'])
  assert.deepEqual(bad((v) => { v.views = ['list'] }).value.views, ['list'])
  refused(bad((v) => { v.views = [] }), /views: a list of 1 to 3/)
  refused(bad((v) => { v.views = ['grid'] }), /views\[0\]: one of cards, list, map/)
  refused(bad((v) => { v.views = ['list', 'list'] }), /views: "list" appears twice/)
  refused(bad((v) => { v.views = ['cards', 'map'] }), /views: "map" needs a map/)
})
const located = (v) => { v.fields.push({ key: 'lat', type: 'number' }, { key: 'lng', type: 'number' }); v.map = { lat: 'lat', lng: 'lng' } }
ok('map: two different number fields place an item; with a map the default views gain « map »', () => {
  const r = bad((v) => { located(v); delete v.views })
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.deepEqual(r.value.map, { lat: 'lat', lng: 'lng' })
  assert.deepEqual(r.value.views, ['cards', 'list', 'map'])
  assert.deepEqual(bad((v) => { located(v); v.views = ['map'] }).value.views, ['map'])
  assert.equal('map' in bad((v) => { delete v.views }).value, false, 'no map declared, no map in the value')
  assert.deepEqual(bad((v) => { delete v.views }).value.views, ['cards', 'list'])
  refused(bad((v) => { located(v); v.map = { lat: 'lat', lng: 'lat' } }), /map: lat and lng are two different fields/)
  refused(bad((v) => { located(v); v.map = { lat: 'lat', lng: 'sku' } }), /map\.lng: the key of a number field/)
  refused(bad((v) => { located(v); v.map = { lat: 'lat' } }), /map\.lng/)
  refused(bad((v) => { located(v); v.map = { lat: 'lat', lng: 'lng', zoom: 3 } }), /map: unknown key "zoom"/)
  refused(bad((v) => { v.map = 'here' }), /map: an object/)
})
ok('card.image names a text field, card.chips up to six fields: anything else is refused', () => {
  const r = bad((v) => { v.fields.push({ key: 'photo', type: 'text' }); v.card.image = 'photo'; v.card.chips = ['size', 'stock'] })
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(r.value.card.image, 'photo')
  assert.deepEqual(r.value.card.chips, ['size', 'stock'])
  refused(bad((v) => { v.card.image = 'stock' }), /card\.image: the key of a text field/)
  refused(bad((v) => { v.card.image = 'nope' }), /card\.image: the key of a text field/)
  refused(bad((v) => { v.card.chips = [] }), /card\.chips: a list of 1 to 6/)
  refused(bad((v) => { v.card.chips = ['sku', 'stock', 'price', 'size', 'sku', 'sku', 'sku'] }), /card\.chips: a list of 1 to 6/)
  refused(bad((v) => { v.card.chips = ['nope'] }), /card\.chips\[0\]: the key of one of the fields/)
  refused(bad((v) => { v.card.chips = ['size', 'size'] }), /card\.chips: "size" appears twice/)
})
ok('PICTURE accepts a drawn picture or a shipped one, nothing that could be fetched', () => {
  for (const good of ['art:house/willow', 'art:box', 'art:villa/lake@210', 'photo:real-estate/willow-lane']) assert.match(good, PICTURE, good)
  for (const bad of ['https://example.org/a.jpg', 'data:image/svg+xml;base64,AAAA', 'photo:../x/y', 'photo:real-estate', 'photo:a/b/c', 'art:HOUSE', 'file:///etc/passwd', '']) assert.doesNotMatch(bad, PICTURE, bad)
})
ok('anything that is not an object, and any other junk, is refused and never thrown', () => {
  for (const junk of [null, undefined, 7, 'text', true, [], [{}]]) refused(check(junk, 'x'), /JSON object/)
  for (const junk of [{ statuses: 'x' }, { statuses: [null] }, { id: 'a', label: 7, plural: [], statuses: [[]], fields: 'x', card: 'x', views: 'x' }]) assert.equal(check(junk, 'a').ok, false)
  assert.ok(check({ id: 'a', label: 7, plural: [], statuses: [[]], fields: 'x', card: 'x', views: 'x' }, 'a').errors.length <= 20)
})
ok('the point is what the registry expects: data, inert, version 1.0, at most twelve files', () => {
  assert.equal(CATALOG_POINT_REF, 'kybernos/catalog#type')
  assert.deepEqual([CATALOG_POINT.owner, CATALOG_POINT.name, CATALOG_POINT.version, CATALOG_POINT.kind, CATALOG_POINT.class, CATALOG_POINT.max], ['kybernos/catalog', 'type', '1.0', 'data', 'inert', 12])
  assert.equal(CATALOG_POINT.validate, check)
  assert.equal(Object.isFrozen(CATALOG_POINT), true)
  const pj = JSON.parse(readFileSync(here + 'plugin.json', 'utf8'))
  assert.deepEqual([pj.id, pj.version, pj.kind, pj.provides[0].name, pj.provides[0].version, pj.provides[0].class], ['kybernos/catalog', CATALOG_POINT.ownerVersion, 'code', 'type', '1.0', 'inert'])
  assert.equal(JSON.parse(readFileSync(here + 'package.json', 'utf8')).version, pj.version)
})

const SEAM = Symbol.for('kybernos.registry')
const withSeam = (seam, fn) => { const was = globalThis[SEAM]; if (seam === undefined) delete globalThis[SEAM]; else globalThis[SEAM] = seam; try { return fn() } finally { if (was === undefined) delete globalThis[SEAM]; else globalThis[SEAM] = was } }
/** A clock the test drives: `tick()` runs the oldest pending timer; the delays asked are kept. */
const clock = () => { const pending = []; const asked = []; return { asked, schedule: (fn, ms) => { pending.push(fn); asked.push(ms); return { unref () { asked.push('unref') } } }, tick: () => { const fn = pending.shift(); if (fn) fn(); return pending.length } } }
const quiet = { schedule: () => undefined }
ok('without a registry, the plugin starts and says it told nobody', () => {
  assert.equal(name, 'kybernos-catalog')
  withSeam(undefined, () => { assert.equal(tellPoint(), false); apply({}, quiet) })
})
ok('with a registry, the point is told at boot and again on each question', () => {
  const told = []
  withSeam({ version: 1, definePoint: (def) => told.push(def) }, () => { apply({}, quiet); assert.equal(tellPoint(), true) })
  assert.deepEqual(told, [CATALOG_POINT, CATALOG_POINT])
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
  assert.deepEqual(told, [CATALOG_POINT])
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
ok('a registry that throws, of another version or without definePoint: nothing stops DSH from starting', () => {
  withSeam({ version: 1, definePoint: () => { throw new Error('boom') } }, () => { assert.equal(tellPoint(), false); apply({}, quiet) })
  withSeam({ version: 2, definePoint: () => assert.fail('a registry of another version is not spoken to') }, () => { assert.equal(tellPoint(), false); apply({}, quiet) })
  withSeam({ version: 1 }, () => { assert.equal(tellPoint(), false); apply({}, quiet) })
  const logs = []
  const log = console.log
  console.log = (...a) => logs.push(a.join(' '))
  try { withSeam(undefined, () => apply({}, { schedule: () => { throw new Error('no timers here') } })) } finally { console.log = log }
  assert.deepEqual(logs, ['[kybernos-catalog] disabled: no timers here'], 'only a broken clock is worth a line')
})
ok('the browser half hands the loader a plugin that never throws, even when its React is missing', () => {
  const loaded = []
  const sandbox = { window: { __ModuleLoader__: { load: (entry) => loaded.push(entry) } }, console: { warn () {}, log () {} } }
  const src = readFileSync(here + 'client.js', 'utf8')
  vm.runInNewContext(src, sandbox)
  assert.equal(loaded.length, 1)
  assert.equal(loaded[0].id, '@local/kybernos-catalog')
  const plugin = loaded[0].factory(() => { throw new Error('no react here') })
  assert.equal(typeof plugin.apply, 'function')
  assert.equal(plugin.apply({ effect: () => assert.fail('a disabled plugin registers nothing') }), undefined)
  assert.doesNotMatch(src, /#[0-9a-fA-F]{3,6}\b|rgba?\(/, 'no colour of its own')
})

console.log('\n' + count + ' checks passed')
