// kybernos-pipeline, the frame: the point `kybernos/pipeline#flow` (its check, bounded and pure), the host half that tells the registry about it
// without ever throwing, and the browser half that draws nothing yet but must still return a plugin.
//
//   node packages/kybernos-pipeline/test-pipeline.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { FORMATS, LIMITS, PIPELINE_POINT, PIPELINE_POINT_REF, validatePipelineFlow as check } from './pipeline-flow.mjs'
import { apply, name, tellPoint, tellWhenReady } from './index.js'

const here = fileURLToPath(new URL('.', import.meta.url))
let count = 0
const ok = (label, fn) => { fn(); count++; console.log('ok  ', label) }
const L = (en) => ({ en })
const good = () => ({
  id: 'orders', label: { en: 'Orders', fr: 'Commandes' }, newLabel: L('New order'),
  stages: [{ key: 'new', label: L('New') }, { key: 'paid', label: L('Paid') }, { key: 'shipped', label: L('Shipped') }],
  value: { format: 'money', currency: 'EUR' }, links: { contact: true, item: false },
})
const bad = (mutate, fileId = 'orders') => { const v = good(); mutate(v); return check(v, fileId) }
const refused = (r, re) => { assert.equal(r.ok, false, JSON.stringify(r)); assert.match(r.errors.join(' | '), re) }

ok('a well-formed flow is accepted, nothing added or lost', () => {
  const r = check(good(), 'orders')
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.deepEqual(r.value, good())
})
ok('the smallest flow: two stages, no value, no links, no new-card label', () => {
  const r = check({ id: 'f', label: L('F'), stages: [{ key: 'a', label: L('A') }, { key: 'b', label: L('B') }] }, 'f')
  assert.deepEqual(r.value, { id: 'f', label: L('F'), newLabel: null, stages: [{ key: 'a', label: L('A') }, { key: 'b', label: L('B') }], value: null, links: { contact: false, item: false } })
})
ok('the id is the name of the file; only known keys', () => {
  refused(check(good(), 'other'), /must be the name of its file/)
  refused(bad((v) => { v.colour = 'red' }), /unknown key "colour"/)
  refused(bad((v) => { v.stages[0].color = 'red' }), /stages\[0\]: unknown key "color"/)
  refused(bad((v) => { v.value.unit = 'x' }), /value: unknown key "unit"/)
  refused(bad((v) => { v.links.company = true }), /links: unknown key "company"/)
})
ok('stages: 2 to 8, a key and a short label each, no duplicate', () => {
  refused(bad((v) => { v.stages = v.stages.slice(0, 1) }), /stages: a list of 2 to 8/)
  refused(bad((v) => { delete v.stages }), /stages: a list of 2 to 8/)
  refused(bad((v) => { v.stages = Array.from({ length: LIMITS.stages + 1 }, (_, i) => ({ key: 's' + i, label: L('S') })) }), /stages: a list of 2 to 8/)
  assert.equal(bad((v) => { v.stages = Array.from({ length: LIMITS.stages }, (_, i) => ({ key: 's' + i, label: L('S') })) }).ok, true)
  refused(bad((v) => { v.stages[1].key = 'new' }), /stages: "new" appears twice/)
  refused(bad((v) => { v.stages[0].key = 'New Stage' }), /stages\[0\]\.key/)
  refused(bad((v) => { v.stages[0].label = { en: 'x'.repeat(41) } }), /1 to 40 characters/)
  refused(bad((v) => { v.stages[0].label = {} }), /label\.en: required/)
})
ok('label is required, newLabel is optional and short', () => {
  refused(bad((v) => { delete v.label }), /label: an object/)
  assert.equal(bad((v) => { delete v.newLabel }).value.newLabel, null)
  refused(bad((v) => { v.newLabel = { en: 'x'.repeat(41) } }), /newLabel\.en: a text of 1 to 40/)
})
ok('value: a format, and a currency only with money', () => {
  assert.deepEqual([...FORMATS], ['money', 'number'])
  assert.deepEqual(bad((v) => { v.value = { format: 'number' } }).value.value, { format: 'number' })
  assert.equal(bad((v) => { delete v.value }).value.value, null)
  refused(bad((v) => { v.value.format = 'percent' }), /value\.format: one of money, number/)
  refused(bad((v) => { v.value = { format: 'number', currency: 'EUR' } }), /only for the "money" format/)
  refused(bad((v) => { v.value.currency = 'euro' }), /three capital letters/)
  refused(bad((v) => { v.value = 'money' }), /value: an object/)
})
ok('links: the two booleans, nothing else', () => {
  assert.deepEqual(bad((v) => { delete v.links }).value.links, { contact: false, item: false })
  assert.deepEqual(bad((v) => { v.links = { item: true } }).value.links, { contact: false, item: true })
  refused(bad((v) => { v.links.contact = 'yes' }), /links\.contact: true or false/)
  refused(bad((v) => { v.links = true }), /links: an object/)
})
ok('anything that is not an object, and any other junk, is refused and never thrown', () => {
  for (const junk of [null, undefined, 7, 'text', true, [], [{}]]) refused(check(junk, 'x'), /JSON object/)
  for (const junk of [{ stages: 'x' }, { stages: [null, null] }, { id: 'a', label: 7, stages: [[], []], value: [], links: 'x' }]) assert.equal(check(junk, 'a').ok, false)
  assert.ok(check({ id: 'a', label: 7, stages: [[], []], value: [], links: 'x' }, 'a').errors.length <= 20)
})
ok('the point is what the registry expects: data, inert, version 1.0, at most four files', () => {
  assert.equal(PIPELINE_POINT_REF, 'kybernos/pipeline#flow')
  assert.deepEqual([PIPELINE_POINT.owner, PIPELINE_POINT.name, PIPELINE_POINT.version, PIPELINE_POINT.kind, PIPELINE_POINT.class, PIPELINE_POINT.max], ['kybernos/pipeline', 'flow', '1.0', 'data', 'inert', 4])
  assert.equal(PIPELINE_POINT.validate, check)
  assert.equal(Object.isFrozen(PIPELINE_POINT), true)
  const pj = JSON.parse(readFileSync(here + 'plugin.json', 'utf8'))
  assert.deepEqual([pj.id, pj.version, pj.kind, pj.provides[0].name, pj.provides[0].version, pj.provides[0].class], ['kybernos/pipeline', PIPELINE_POINT.ownerVersion, 'code', 'flow', '1.0', 'inert'])
  assert.equal(JSON.parse(readFileSync(here + 'package.json', 'utf8')).version, pj.version)
})

const SEAM = Symbol.for('kybernos.registry')
const withSeam = (seam, fn) => { const was = globalThis[SEAM]; if (seam === undefined) delete globalThis[SEAM]; else globalThis[SEAM] = seam; try { return fn() } finally { if (was === undefined) delete globalThis[SEAM]; else globalThis[SEAM] = was } }
/** A clock the test drives: `tick()` runs the oldest pending timer; the delays asked are kept. */
const clock = () => { const pending = []; const asked = []; return { asked, schedule: (fn, ms) => { pending.push(fn); asked.push(ms); return { unref () { asked.push('unref') } } }, tick: () => { const fn = pending.shift(); if (fn) fn(); return pending.length } } }
const quiet = { schedule: () => undefined }
ok('without a registry, the plugin starts and says it told nobody', () => {
  assert.equal(name, 'kybernos-pipeline')
  withSeam(undefined, () => { assert.equal(tellPoint(), false); apply({}, quiet) })
})
ok('with a registry, the point is told at boot and again on each question', () => {
  const told = []
  withSeam({ version: 1, definePoint: (def) => told.push(def) }, () => { apply({}, quiet); assert.equal(tellPoint(), true) })
  assert.deepEqual(told, [PIPELINE_POINT, PIPELINE_POINT])
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
  assert.deepEqual(told, [PIPELINE_POINT])
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
  assert.deepEqual(logs, ['[kybernos-pipeline] disabled: no timers here'], 'only a broken clock is worth a line')
})
ok('the browser half hands the loader a plugin that never throws, and draws nothing', () => {
  const loaded = []
  const sandbox = { window: { __ModuleLoader__: { load: (entry) => loaded.push(entry) } }, console: { warn () {}, log () {} } }
  const src = readFileSync(here + 'client.js', 'utf8')
  vm.runInNewContext(src, sandbox)
  assert.equal(loaded.length, 1)
  assert.equal(loaded[0].id, '@local/kybernos-pipeline')
  const plugin = loaded[0].factory((m) => assert.fail('it requires nothing: ' + m))
  assert.equal(typeof plugin.apply, 'function')
  assert.equal(plugin.apply({ effect: () => assert.fail('nothing is registered yet') }), undefined)
  assert.doesNotMatch(src, /#[0-9a-fA-F]{3,6}\b|rgba?\(/, 'no colour of its own')
})

console.log('\n' + count + ' checks passed')
