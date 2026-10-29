// kybernos-contacts, browser half: its pure parts, its registration (the menu row inside apply, taken back by the cleanup; the page on the keyed slot), the page rendered
// to a plain tree in each of its states (loading, error, empty, filtered, loaded, panel, dialog) and read by its `data-kb` hooks, and the static promises a browser would only
// break late (DSH's tokens only, every text in both languages, the page asks its own host only). Outside a browser: a fake loader and a fake React whose hooks keep their first
// value, or the value the test hands them.
//
//   node packages/kybernos-contacts/test-client.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

let failed = 0
const ok = (label, fn) => { try { fn(); console.log('  ok   ' + label) } catch (e) { failed += 1; console.log('  FAIL ' + label + ' — ' + (e && e.message)) } }

const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
let definition = null
let resolved = 'en'
const menuCalls = []
let menuOff = 0
globalThis.window = {
  __ModuleLoader__: { load: (def) => { definition = def } },
  __KB_LANG_RESOLVE__: () => resolved,
  __KB_MENU__: { register: (entry) => { menuCalls.push(entry); return () => { menuOff += 1 } } },
  addEventListener () {}, removeEventListener () {},
}
globalThis.document = { activeElement: null, contains: () => false, querySelector: () => null }
await import(new URL('./client.js', import.meta.url).href)

console.log('── loading ──')
ok('the client loads in the module-loader format', () => { assert.ok(definition !== null); assert.equal(definition.id, '@local/kybernos-contacts'); assert.equal(typeof definition.factory, 'function') })

// A React whose hooks keep their first value (or the one a test hands the component by name) and whose elements are plain objects.
const FRAGMENT = Symbol('fragment')
let hooks = { i: 0, over: [], name: '' }
const SETS = [] // what a state setter was handed: { name, i, value } (the value of a function is the function applied to the value it had)
const el = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false) })
const React = {
  createElement: el, Fragment: FRAGMENT,
  useState: (v) => {
    const mine = hooks
    const i = mine.i++
    const o = mine.over[i]
    const init = typeof v === 'function' ? v() : v
    const cur = o !== undefined ? o : init
    return [cur, (next) => { SETS.push({ name: mine.name, i, value: typeof next === 'function' ? next(cur) : next }) }]
  },
  useEffect: () => {}, useRef: (v) => ({ current: v === undefined ? null : v }),
}
const loaderRequire = (name) => { if (name === 'react') return React; throw new Error('unexpected require ' + name) }
const plugin = definition.factory(loaderRequire)
const T = plugin.__test

ok('the factory returns a plugin that asks for the slots service and exposes its pure parts', () => {
  assert.equal(plugin.name, 'kybernos-contacts'); assert.deepEqual(plugin.inject, ['slots']); assert.equal(typeof plugin.apply, 'function')
  for (const k of ['kt', 'initials', 'relTime', 'typeLabel', 'errorText', 'checkForm', 'formBody', 'emptyForm', 'build']) assert.equal(typeof T[k], 'function', k)
})
const warn = console.warn
ok('a factory that cannot even start still returns a plugin, and does not throw', () => {
  const broken = definition.factory(() => { throw new Error('no react') })
  assert.equal(typeof broken.apply, 'function')
  console.warn = () => {}
  try { assert.doesNotThrow(() => broken.apply({ slots: { inject () {} }, effect () {} })) } finally { console.warn = warn }
})

console.log('── registration ──')
const mount = (ctx) => {
  const effects = []
  const registered = []
  const full = Object.assign({ effect: (fn, label) => { effects.push({ fn, label }) }, slots: { inject: (name, fn) => { registered.push({ name, entry: fn() }); return () => {} }, register: (opts, component) => ({ opts, component }) } }, ctx)
  plugin.apply(full)
  return { effects, registered }
}
ok('apply declares the menu row inside an effect and the cleanup takes it back', () => {
  menuCalls.length = 0; menuOff = 0
  const { effects } = mount()
  assert.equal(menuCalls.length, 0, 'nothing is declared outside an effect')
  const row = effects.find((e) => /menu row/.test(e.label))
  assert.ok(row !== undefined)
  const cleanup = row.fn()
  assert.deepEqual(menuCalls, [{ id: 'contacts', group: 'business', icon: 'users', labelKey: 'business.contacts', label: { en: 'Contacts', fr: 'Contacts' }, order: 10 }])
  assert.equal(typeof cleanup, 'function'); cleanup(); cleanup()
  assert.equal(menuOff, 1, 'the disposer the menu gave is the one the cleanup calls, once')
})
ok('the core applied after this plugin (no registry yet): the row waits for it, is declared once, and a cleanup in between leaves nothing behind', () => {
  const kept = window.__KB_MENU__
  const realSet = globalThis.setTimeout
  const realClear = globalThis.clearTimeout
  const timers = new Map()
  let next = 1
  globalThis.setTimeout = (fn, ms) => { timers.set(next, { fn, ms }); return next++ }
  globalThis.clearTimeout = (id) => { timers.delete(id) }
  const tick = () => { const [id, t] = [...timers.entries()][0]; timers.delete(id); t.fn() }
  try {
    menuCalls.length = 0; menuOff = 0
    window.__KB_MENU__ = undefined
    const { effects } = mount()
    const cleanup = effects.find((e) => /menu row/.test(e.label)).fn()
    assert.equal(menuCalls.length, 0); assert.equal(timers.size, 1, 'it waits'); assert.equal([...timers.values()][0].ms, 250)
    tick(); tick(); assert.equal(menuCalls.length, 0)
    window.__KB_MENU__ = { register: (entry) => { menuCalls.push(entry); return () => { menuOff += 1 } } }
    tick()
    assert.equal(menuCalls.length, 1); assert.equal(timers.size, 0, 'once declared it stops looking')
    cleanup(); assert.equal(menuOff, 1)
    // a plugin switched off while it was still waiting never declares anything
    window.__KB_MENU__ = undefined; menuCalls.length = 0
    const again = mount().effects.find((e) => /menu row/.test(e.label)).fn()
    assert.equal(timers.size, 1); again(); assert.equal(timers.size, 0)
    window.__KB_MENU__ = { register: (entry) => { menuCalls.push(entry); return () => {} } }
    assert.equal(menuCalls.length, 0)
    // and it does not wait for ever
    window.__KB_MENU__ = undefined
    mount().effects.find((e) => /menu row/.test(e.label)).fn()
    let polls = 0
    while (timers.size > 0 && polls < 500) { tick(); polls += 1 }
    assert.equal(polls, 119, 'about thirty seconds, then it gives up')
  } finally { globalThis.setTimeout = realSet; globalThis.clearTimeout = realClear; window.__KB_MENU__ = kept }
})
ok('apply mounts the page on the keyed slot, with the id of the row as its key', () => {
  const { effects, registered } = mount()
  const page = effects.find((e) => /page/.test(e.label))
  assert.ok(page !== undefined)
  page.fn()
  assert.equal(registered.length, 1); assert.equal(registered[0].name, 'main.kybernos-business')
  assert.deepEqual(registered[0].entry.opts, { name: 'main.kybernos-business', key: 'contacts' })
  assert.equal(typeof registered[0].entry.component, 'function')
})
ok('no menu, a menu that throws or refuses the row: the page is still mounted and nothing throws', () => {
  const kept = window.__KB_MENU__
  for (const menu of [undefined, { register: () => { throw new Error('boom') } }, { register: () => null }, { register: 'x' }]) {
    window.__KB_MENU__ = menu
    const { effects, registered } = mount()
    for (const e of effects) { const cleanup = e.fn(); if (typeof cleanup === 'function') assert.doesNotThrow(cleanup) }
    assert.equal(registered.length, 1)
  }
  window.__KB_MENU__ = kept
})
ok('no slots service, or a slots service that throws: nothing is mounted and nothing throws', () => {
  console.warn = () => {}
  try {
    assert.doesNotThrow(() => plugin.apply({ effect () {} }))
    assert.doesNotThrow(() => plugin.apply({ effect () { throw new Error('boom') }, slots: { inject () {} } }))
    assert.doesNotThrow(() => plugin.apply({ effect: (fn) => fn(), slots: { inject () { throw new Error('boom') } } }))
  } finally { console.warn = warn }
})

console.log('── pure parts ──')
ok('initials: two letters, a company name, one word, nothing, a non-Latin name', () => {
  assert.equal(T.initials('Léa Martin'), 'LM'); assert.equal(T.initials('acme'), 'A'); assert.equal(T.initials('  '), '?'); assert.equal(T.initials(undefined), '?')
  assert.equal(T.initials('Jean de la Fontaine'), 'JF'); assert.equal(T.initials('李 小龍'), '李小')
})
ok('relTime: just now, minutes, hours, yesterday, days, a date; a bad date reads as nothing', () => {
  const now = Date.parse('2026-10-29T12:00:00Z')
  const at = (ms) => new Date(now - ms).toISOString()
  assert.equal(T.relTime(at(5000), now), 'just now'); assert.equal(T.relTime(at(5 * 60000), now), '5 min ago'); assert.equal(T.relTime(at(3 * 3600000), now), '3 h ago')
  assert.equal(T.relTime(at(30 * 3600000), now), 'yesterday'); assert.equal(T.relTime(at(4 * 86400000), now), '4 days ago')
  assert.match(T.relTime(at(90 * 86400000), now), /2026|Jul/); assert.equal(T.relTime('nope', now), ''); assert.equal(T.relTime(at(-5000), now), 'just now')
  resolved = 'fr'; assert.equal(T.relTime(at(5 * 60000), now), 'il y a 5 min'); resolved = 'en'
})
const schema = { themed: true, themes: ['shop'], types: [{ key: 'customer', kind: 'person', label: { en: 'Customer', fr: 'Client' } }, { key: 'supplier', kind: 'person', label: { en: 'Supplier' } }, { key: 'company', kind: 'company', label: { en: 'Company' } }], fields: [{ key: 'city', type: 'text', label: { en: 'City', fr: 'Ville' } }, { key: 'credit', type: 'money', currency: 'EUR' }, { key: 'tier', type: 'choice', options: ['gold', 'silver'] }, { key: 'since', type: 'date' }], tags: ['repeat', 'wholesale'] }
ok('typeLabel: the theme\'s word in the language, English as the fallback, a plain kind when nobody defines the type', () => {
  assert.equal(T.typeLabel(schema, { kind: 'person', type: 'customer' }), 'Customer')
  assert.equal(T.typeLabel(schema, { kind: 'person', type: 'supplier' }), 'Supplier')
  resolved = 'fr'; assert.equal(T.typeLabel(schema, { kind: 'person', type: 'customer' }), 'Client'); assert.equal(T.typeLabel(schema, { kind: 'person', type: 'supplier' }), 'Supplier'); assert.equal(T.typeLabel(schema, { kind: 'person', type: 'gone' }), 'Personne'); resolved = 'en'
  assert.equal(T.typeLabel(schema, { kind: 'person', type: 'gone' }), 'Person'); assert.equal(T.typeLabel(schema, { kind: 'company', type: '' }), 'Company')
  assert.equal(T.typeLabel(schema, { kind: 'company', type: 'customer' }), 'Company', 'a type of the other kind is not used')
})
ok('fieldDisplay and fieldLabel: money, number, date, choice, empty; a label from the key when the theme gave none', () => {
  assert.match(T.fieldDisplay(schema.fields[1], 1234.5), /€|EUR/); assert.match(T.fieldDisplay(schema.fields[1], 1234.5), /1,234\.50|1\s?234/)
  assert.equal(T.fieldDisplay(schema.fields[0], 'Lyon'), 'Lyon'); assert.match(T.fieldDisplay(schema.fields[3], '2026-02-28'), /2026/)
  assert.equal(T.fieldDisplay(schema.fields[0], null), ''); assert.equal(T.fieldDisplay(schema.fields[0], ''), '')
  assert.equal(T.fieldLabel(schema.fields[0]), 'City'); assert.equal(T.fieldLabel({ key: 'credit_limit', type: 'money' }), 'Credit limit')
})
ok('errorText: a sentence for every code the host or the base can answer, in both languages; a bad field shows its own reason', () => {
  const codes = ['base_missing', 'sqlite_unavailable', 'cannot_open', 'not_a_database', 'schema_newer', 'read_only', 'busy', 'not_found', 'bad_ref', 'constraint', 'confirm_required', 'network', 'sign-in required', 'origin refused', 'refused_on_phone']
  for (const lang of ['en', 'fr']) { resolved = lang; for (const c of codes) { const t = T.errorText(c); assert.ok(t.length > 10 && !t.includes(c), c + ' ' + lang + ': ' + t) } }
  resolved = 'en'
  assert.equal(T.errorText('bad_field', 'email: an email address'), 'email: an email address')
  assert.match(T.errorText('weird_code'), /weird_code/)
  assert.match(T.errorText('base_missing'), /Update Kybernos/)
})
ok('checkForm: what the inputs say before the host is asked', () => {
  const form = (o) => Object.assign({ kind: 'person', name: 'A', type: 'customer', email: '', companyId: '', tags: '', fields: {} }, o)
  assert.deepEqual(T.checkForm(form({}), schema), {})
  assert.ok(T.checkForm(form({ name: '  ' }), schema).name); assert.ok(T.checkForm(form({ name: 'x'.repeat(201) }), schema).name)
  assert.ok(T.checkForm(form({ email: 'nope' }), schema).email); assert.deepEqual(T.checkForm(form({ email: 'a@b.co' }), schema), {})
  assert.ok(T.checkForm(form({ fields: { credit: 'abc' } }), schema)['f:credit']); assert.deepEqual(T.checkForm(form({ fields: { credit: '12,5' } }), schema), {})
  assert.deepEqual(T.checkForm(form({ fields: { credit: '  ' } }), schema), {}, 'an empty field is not an error')
})
ok('formBody: trims, splits the tags, numbers, leaves an empty field out on a new contact and clears it on a change', () => {
  const form = { kind: 'person', name: ' Léa ', type: 'customer', email: ' lea@example.com ', companyId: '7', tags: 'repeat, vip,, repeat', fields: { city: ' Lyon ', credit: '12,5', since: '' } }
  assert.deepEqual(T.formBody(form, schema, true), { name: 'Léa', type: 'customer', email: 'lea@example.com', tags: ['repeat', 'vip'], company_id: 7, kind: 'person', fields: { city: 'Lyon', credit: 12.5 } })
  const had = { fields: { city: 'x', since: '2020-01-01' } }
  const patch = T.formBody(form, schema, false, had)
  assert.equal(patch.kind, undefined); assert.deepEqual(patch.fields, { city: 'Lyon', credit: 12.5, since: null })
  assert.equal(T.formBody(Object.assign({}, form, { kind: 'company' }), schema, true).company_id, null, 'a company has no company')
  assert.equal(T.formBody(Object.assign({}, form, { companyId: '' }), schema, true).company_id, null)
  assert.equal(T.formBody({ kind: 'person', name: 'A', type: '', email: '', companyId: '', tags: '', fields: {} }, schema, true).fields, undefined)
})
ok('emptyForm: a new contact starts on the first type of its kind; an existing one on its own values', () => {
  const f = T.emptyForm('person', schema)
  assert.equal(f.type, 'customer'); assert.equal(f.kind, 'person'); assert.equal(f.name, '')
  assert.equal(T.emptyForm('company', schema).type, 'company')
  assert.equal(T.emptyForm('person', { types: [], fields: [] }).type, '')
  const c = { kind: 'person', name: 'Léa', type: 'supplier', email: 'l@e.co', company_id: 4, tags: ['a', 'b'], fields: { city: 'Lyon', credit: 12, gone: 'x' } }
  const g = T.emptyForm('person', schema, c)
  assert.deepEqual([g.name, g.type, g.email, g.companyId, g.tags], ['Léa', 'supplier', 'l@e.co', '4', 'a, b']); assert.deepEqual(g.fields, { city: 'Lyon', credit: '12' })
})
ok('tagChoices: the theme\'s tags, then the ones the rows carry, once each', () => {
  assert.deepEqual(T.tagChoices(schema, [{ tags: ['vip', 'repeat'] }, { tags: ['vip', 'x'] }]), ['repeat', 'wholesale', 'vip', 'x'])
  assert.deepEqual(T.tagChoices({ tags: [] }, []), [])
})
ok('query: only what is set, encoded', () => { assert.equal(T.query({ q: 'a b&c', kind: 'person', type: '', tag: undefined, archived: false, limit: 100, offset: 0 }), '?q=a%20b%26c&kind=person&limit=100&offset=0'); assert.equal(T.query({ archived: true }), '?archived=1') })
ok('domainLabel: the word the theme\'s menu gives the row, nothing when it gives none, nothing when the seam fails', () => {
  assert.equal(T.domainLabel(), null)
  window.__KB_DOMAIN__ = { label: (id) => (id === 'contacts' ? 'Clients' : null) }; assert.equal(T.domainLabel(), 'Clients')
  window.__KB_DOMAIN__ = { label: () => { throw new Error('boom') } }; assert.equal(T.domainLabel(), null)
  delete window.__KB_DOMAIN__
})

console.log('── facets, period and sort ──')
const NOW = Date.parse('2026-10-29T12:00:00Z')
const iso = (msAgo) => new Date(NOW - msAgo).toISOString()
const R = (o) => Object.assign({ id: 1, kind: 'person', type: 'customer', name: 'Léa Martin', email: 'lea@example.com', company_id: 9, company: { id: 9, name: 'Acme Farm' }, tags: ['repeat', 'vip', 'a', 'b'], fields: { city: 'Lyon' }, demo: false, archived_at: null, created_at: '2026-10-28T10:00:00Z', updated_at: '2026-10-28T10:00:00Z' }, o)
const sample = [
  R({ id: 1, name: 'Ana', type: 'customer', tags: ['vip'], updated_at: iso(2 * 86400000), created_at: iso(40 * 86400000) }),
  R({ id: 2, name: 'Bob', type: 'supplier', tags: ['repeat', 'vip'], updated_at: iso(20 * 86400000), created_at: iso(10 * 86400000) }),
  R({ id: 3, name: 'Cleo', type: 'customer', tags: [], updated_at: iso(60 * 86400000), created_at: iso(5 * 86400000) }),
  R({ id: 4, name: 'Acme', kind: 'company', type: 'company', tags: ['wholesale'], updated_at: iso(86400000), created_at: iso(90 * 86400000) }),
]
ok('typeId and tagId do not meet; toggleId adds then removes', () => {
  assert.equal(T.typeId('buyer'), 't:buyer'); assert.equal(T.tagId('vip'), 'g:vip')
  assert.deepEqual(T.toggleId(['a'], 'b'), ['a', 'b']); assert.deepEqual(T.toggleId(['a', 'b'], 'a'), ['b'])
})
ok('filterRows: one kind; any of the chosen types AND any of the chosen tags; the period keeps the recent ones', () => {
  const f = (o) => T.filterRows(sample, Object.assign({ kind: 'person', types: [], period: 'all', nowMs: NOW }, o)).map((r) => r.id)
  assert.deepEqual(f({}), [1, 2, 3]); assert.deepEqual(f({ kind: 'company' }), [4])
  assert.deepEqual(f({ types: ['t:supplier'] }), [2]); assert.deepEqual(f({ types: ['t:supplier', 't:customer'] }), [1, 2, 3], 'two types: either')
  assert.deepEqual(f({ types: ['g:vip'] }), [1, 2]); assert.deepEqual(f({ types: ['g:vip', 'g:repeat'] }), [1, 2], 'two tags: either')
  assert.deepEqual(f({ types: ['t:customer', 'g:vip'] }), [1], 'a type and a tag: both')
  assert.deepEqual(f({ period: '7' }), [1]); assert.deepEqual(f({ period: '30' }), [1, 2]); assert.deepEqual(f({ types: ['g:nobody'] }), [])
  assert.deepEqual(f({ types: ['t:gone'] }), [], 'a type nobody has keeps nothing')
})
ok('sortRows: by last update, name, date added or type, in both directions; the name breaks ties; the input is not touched', () => {
  const s = (sort, dir) => T.sortRows(sample.filter((r) => r.kind === 'person'), sort, dir, schema).map((r) => r.id)
  assert.deepEqual(s('modified', 'desc'), [1, 2, 3]); assert.deepEqual(s('modified', 'asc'), [3, 2, 1])
  assert.deepEqual(s('name', 'asc'), [1, 2, 3]); assert.deepEqual(s('name', 'desc'), [3, 2, 1])
  assert.deepEqual(s('created', 'desc'), [3, 2, 1]); assert.deepEqual(s('created', 'asc'), [1, 2, 3])
  assert.deepEqual(s('type', 'asc'), [1, 3, 2], 'Customer, Customer (by name), Supplier')
  const same = [R({ id: 7, name: 'Zed' }), R({ id: 8, name: 'Abe' })]
  assert.deepEqual(T.sortRows(same, 'modified', 'desc', schema).map((r) => r.id), [8, 7], 'same date: by name')
  assert.deepEqual(same.map((r) => r.id), [7, 8]); assert.equal(T.sortChoice('nope'), 'modified'); assert.equal(T.sortChoice('name'), 'name')
  assert.deepEqual(T.SORTS, ['modified', 'name', 'created', 'type'])
})
ok('facetOptions: the theme\'s types of the kind with their counts, then the tags by count; a chosen id that matches nothing stays at 0', () => {
  const o = T.facetOptions(schema, 'person', sample, [])
  assert.deepEqual(o.filter((x) => x.group === 'type').map((x) => [x.id, x.text, x.count]), [['t:customer', 'Customer', 2], ['t:supplier', 'Supplier', 1]])
  assert.deepEqual(o.filter((x) => x.group === 'tag').map((x) => [x.id, x.count]), [['g:vip', 2], ['g:repeat', 1], ['g:wholesale', 0]], 'the theme\'s tags come even at 0, the busiest first')
  const c = T.facetOptions(schema, 'company', sample, [])
  assert.deepEqual(c.filter((x) => x.group === 'type').map((x) => [x.id, x.count]), [['t:company', 1]], 'only the types of the kind'); assert.equal(c.find((x) => x.id === 'g:wholesale').count, 1)
  const kept = T.facetOptions(schema, 'person', sample, ['g:ghost', 't:gone'])
  assert.deepEqual(kept.filter((x) => x.count === 0 && /ghost|gone/.test(x.id)).map((x) => x.id), ['g:ghost', 't:gone'], 'in the order they were chosen')
  const many = Array.from({ length: 40 }, (_, i) => R({ id: 100 + i, tags: ['t' + String(i).padStart(2, '0')] }))
  assert.equal(T.facetOptions({ types: [], tags: [] }, 'person', many, []).length, 24, 'the menu never grows past 24 tags')
  assert.ok(T.facetOptions({ types: [], tags: [] }, 'person', many, ['g:t39']).some((x) => x.id === 'g:t39'), 'a chosen tag is kept past the cap')
})
ok('hueFor: the kit\'s tint of the type (the kind when it has none), 212 without the kit', () => {
  assert.equal(T.hueFor({ type: 'customer', kind: 'person' }), 212)
  window.__KB_BIZ_KIT__ = { Tag () { return null }, Avatar () { return null }, tint: (s) => s.length * 10 }
  assert.equal(T.hueFor({ type: 'customer', kind: 'person' }), 80); assert.equal(T.hueFor({ type: '', kind: 'company' }), 70)
  window.__KB_BIZ_KIT__ = { Tag () { return null }, Avatar () { return null }, tint: () => { throw new Error('boom') } }
  assert.equal(T.hueFor({ type: 'x', kind: 'person' }), 212, 'a kit that throws does not break the page')
  delete window.__KB_BIZ_KIT__
})

console.log('── the page, rendered in each state ──')
const walk = (node, fn) => { if (node === null || typeof node !== 'object') return; fn(node); for (const c of node.children || []) walk(c, fn) }
const find = (tree, pred) => { const out = []; walk(tree, (n) => { if (pred(n)) out.push(n) }); return out }
const byKb = (tree, kb) => find(tree, (n) => n.props && n.props['data-kb'] === kb)
// The words a person reads: the text nodes, leaving out the stylesheet the page carries
const text = (tree) => { let s = ''; walk(tree, (n) => { if (n.type === 'style') return; for (const c of n.children || []) if (typeof c === 'string' || typeof c === 'number') s += c + ' ' }); return s }
/** Expands the components (the page, its panel and its dialogs) into plain elements; `over` hands a component its first hook values, by the component's name. */
const expand = (node, over) => {
  if (node === null || typeof node !== 'object') return node
  if (typeof node.type === 'function') {
    const saved = hooks
    hooks = { i: 0, over: (over && over[node.type.name]) || [], name: node.type.name }
    const out = node.type(Object.assign({}, node.props, { children: node.children }))
    hooks = saved
    return expand(out, over)
  }
  return Object.assign({}, node, { children: (node.children || []).map((c) => expand(c, over)) })
}
let Page = null
ok('the page builds from React', () => { Page = T.build(React); assert.equal(typeof Page, 'function') })
// ContactsPage state order: own prefs, find (search, facets, period), filters, q, schema, list, openId, detail, dialog, toast, reload, redraw, closing
const PREFS = { sort: 'modified', dir: 'desc', viewMode: 'list' }
const FIND = { query: '', types: [], period: 'all' }
const FILTERS = { kind: 'person', archived: false, offset: 0 }
const LIST = (rows, extra) => Object.assign({ status: 'ok', rows, total: rows.length, demo: 0, truncated: false, error: null }, extra)
const IDLE = { state: 'idle', data: null, error: null }
const st = (o) => [o.prefs || PREFS, o.find || FIND, o.filters || FILTERS, o.q || '', o.schema || schema, o.list, o.openId === undefined ? null : o.openId, o.detail || IDLE, o.dialog === undefined ? null : o.dialog, o.toast === undefined ? null : o.toast]
const page = (state, props) => expand(el(Page, props || {}), { ContactsPage: state })
const loaded = (rows, extra) => st({ list: LIST(rows, extra) })
const row = R
const withPanel = (rows, id, d) => st({ list: LIST(rows), openId: id, detail: d })
const withDialog = (rows, dialog) => st({ list: LIST(rows), dialog })
// A bar like the core's: a component that gets the props the page hands it, and a state hook that keeps the first value.
const KbToolbar = function KbToolbar (props) { return el('div', { 'data-kb': 'fake-toolbar' }) }
const useToolbarState = (id, defaults) => { toolbarCalls.push({ id, defaults }); return [Object.assign({ query: '', sort: 'modified', dir: 'desc', types: [], period: 'all', fav: false, viewMode: 'list' }, toolbarOver), (patch) => { toolbarPatches.push(patch) }] }
const toolbarCalls = []
const toolbarPatches = []
let toolbarOver = {}

ok('loading: a label first (what is loading), then the placeholder rows', () => {
  const t = page([])
  assert.equal(byKb(t, 'contacts-page').length, 1)
  assert.equal(byKb(t, 'contacts-loading').length, 1); assert.match(text(byKb(t, 'contacts-loading')[0]), /Loading contacts/)
  assert.equal(find(t, (n) => n.props['aria-busy'] === 'true').length >= 1, true)
  assert.equal(byKb(t, 'contacts-table').length, 0)
})
ok('the header is the template of the other pages, and carries the help pill when the help host is there, nothing when it is not', () => {
  let t = page([])
  assert.ok(find(t, (n) => n.type === 'header' && n.props.className === 'kb6-headrow').length === 1)
  assert.ok(find(t, (n) => n.props.className === 'kb6-title').length === 1); assert.ok(find(t, (n) => n.props.className === 'kb8-sub').length === 1)
  assert.equal(byKb(t, 'contacts-new').length, 1); assert.equal(byKb(t, 'contacts-new')[0].props.className, 'kb8-primary')
  assert.equal(find(t, (n) => n.props['data-help'] !== undefined).length, 0)
  window.__KB_HELP__ = { Help: (props) => el('span', { 'data-help': props.id }) }
  t = page([])
  assert.equal(find(t, (n) => n.props['data-help'] === 'kybernos-contacts').length, 1)
  delete window.__KB_HELP__
})
ok('the title is the word the theme gives the menu row', () => {
  window.__KB_DOMAIN__ = { label: () => 'Customers' }
  assert.equal(text(find(page([]), (n) => n.props.className === 'kb6-title')[0]).trim(), 'Customers')
  delete window.__KB_DOMAIN__
  assert.equal(text(find(page([]), (n) => n.props.className === 'kb6-title')[0]).trim(), 'Contacts')
})
ok('the error state says what failed, offers a retry, and the new-contact button is off', () => {
  const t = page(st({ list: { status: 'error', rows: [], total: 0, demo: 0, truncated: false, error: { ok: false, error: 'base_missing' } } }))
  const e = byKb(t, 'contacts-error')[0]
  assert.ok(e !== undefined); assert.equal(e.props.role, 'alert'); assert.match(text(e), /cannot be read right now/); assert.match(text(e), /not available in this DSH/)
  assert.equal(byKb(t, 'contacts-retry').length, 1); assert.equal(byKb(t, 'contacts-new')[0].props.disabled, true)
  assert.equal(byKb(t, 'contacts-table').length, 0); assert.equal(byKb(t, 'contacts-loading').length, 0)
})
ok('empty, nothing yet: an invitation to add the first one, and the same button as the header', () => {
  const t = page(loaded([]))
  const e = byKb(t, 'contacts-empty')[0]
  assert.equal(e.props['data-why'], 'none'); assert.match(text(e), /No contacts yet/); assert.equal(byKb(t, 'contacts-empty-new').length, 1)
  const co = page(st({ filters: Object.assign({}, FILTERS, { kind: 'company' }), list: LIST([]) }))
  assert.match(text(byKb(co, 'contacts-empty')[0]), /No companies yet/)
  assert.match(text(byKb(co, 'contacts-new')[0]), /New company/)
})
ok('empty, nothing matches: it says so and offers to clear the filters (the search is not "no contacts")', () => {
  const t = page(st({ find: Object.assign({}, FIND, { query: 'zzz' }), q: 'zzz', list: LIST([]) }))
  const e = byKb(t, 'contacts-empty')[0]
  assert.equal(e.props['data-why'], 'filtered'); assert.match(text(e), /No contact matches/); assert.doesNotMatch(text(e), /No contacts yet/)
  assert.equal(byKb(t, 'contacts-clear-filters').length, 1)
})
ok('a kind with no rows while the other has some: nothing yet for this kind, not "no match" (but a facet that hides everything is "no match")', () => {
  const rows = [row({ id: 1 })]
  assert.equal(byKb(page(st({ filters: Object.assign({}, FILTERS, { kind: 'company' }), list: LIST(rows) })), 'contacts-empty')[0].props['data-why'], 'none')
  const hidden = page(st({ find: Object.assign({}, FIND, { types: ['g:nobody'] }), list: LIST(rows) }))
  assert.equal(byKb(hidden, 'contacts-empty')[0].props['data-why'], 'filtered'); assert.equal(byKb(hidden, 'contacts-clear-filters').length >= 1, true)
})
ok('loaded as a list: a table, one focusable row per contact with its id, the demo badge, the email or the company under the name, two tags and a count', () => {
  const t = page(loaded([row({}), row({ id: 2, name: 'Bob', company: null, company_id: null, email: 'bob@example.com', demo: true, tags: [] })], { demo: 1 }))
  assert.equal(byKb(t, 'contacts-table').length, 1); assert.equal(byKb(t, 'contacts-cards').length, 0)
  const rows = byKb(t, 'contacts-row')
  assert.deepEqual(rows.map((r) => r.props['data-id']).sort(), [1, 2]); assert.ok(rows.every((r) => r.props.tabIndex === 0 && typeof r.props.onKeyDown === 'function' && typeof r.props.onClick === 'function'))
  const bob = rows.find((r) => r.props['data-id'] === 2); const lea = rows.find((r) => r.props['data-id'] === 1)
  assert.equal(bob.props['data-demo'], '1'); assert.equal(byKb(t, 'contacts-demo-badge').length, 1)
  assert.match(text(lea), /Acme Farm/); assert.match(text(bob), /bob@example\.com/)
  assert.equal(byKb(t, 'contacts-row-tag').length, 2, 'two tags are drawn, the others are counted'); assert.match(text(lea), /\+2/)
  assert.match(text(byKb(t, 'contacts-count')[0]), /^2 people/)
  assert.equal(byKb(t, 'contacts-demo-banner').length, 1); assert.equal(byKb(t, 'contacts-clear-demo').length, 1)
  assert.equal(byKb(page(loaded([row({})])), 'contacts-demo-banner').length, 0, 'no sample rows, no banner')
  assert.ok(rows.every((r) => /kz-in/.test(r.props.className) && r.props.style['--kz-i'] >= 0), 'the rows come in one after the other')
})
ok('a row has its actions (write, edit) beside the cells, and a row action does not open the panel', () => {
  const t = page(loaded([row({})]))
  assert.equal(byKb(t, 'contacts-row-mail').length, 1); assert.equal(byKb(t, 'contacts-row-mail')[0].props.href, 'mailto:lea@example.com')
  assert.equal(byKb(t, 'contacts-row-edit').length, 1)
  let stopped = 0
  byKb(t, 'contacts-row-mail')[0].props.onClick({ stopPropagation: () => { stopped += 1 } }); byKb(t, 'contacts-row-edit')[0].props.onClick({ stopPropagation: () => { stopped += 1 } })
  assert.equal(stopped, 2)
  assert.equal(byKb(page(loaded([row({ email: '' })])), 'contacts-row-mail').length, 0, 'no email, no mail action')
  assert.equal(byKb(page(loaded([row({ email: 'x" onmouseover="y' })])), 'contacts-row-mail').length, 0, 'a value that is not an address never becomes a link')
})
ok('loaded as cards: a grid of contact cards with the same hooks, the same actions and the same keyboard', () => {
  const t = page(st({ prefs: Object.assign({}, PREFS, { viewMode: 'cards' }), list: LIST([row({}), row({ id: 2, name: 'Bob', demo: true, tags: ['vip'] })]) }))
  assert.equal(byKb(t, 'contacts-cards').length, 1); assert.equal(byKb(t, 'contacts-table').length, 0)
  const cards = byKb(t, 'contacts-row')
  assert.equal(cards.length, 2); assert.ok(cards.every((c) => c.type === 'article' && c.props.tabIndex === 0 && /kz-lift/.test(c.props.className) && !/kz-in/.test(c.props.className) && c.props['data-view'] === 'cards'), 'the card lifts on hover')
  const cells = find(t, (n) => /\bkbcts-cell\b/.test(n.props.className || ''))
  assert.equal(cells.length, 2); assert.ok(cells.every((c) => /kz-in/.test(c.props.className) && c.props.style['--kz-i'] >= 0 && c.children[0].type === 'article'), 'the entry is the cell\'s: an animation that keeps its last frame would hold the card\'s transform and the lift would never show')
  assert.equal(byKb(t, 'contacts-row-edit').length, 2); assert.equal(byKb(t, 'contacts-demo-badge').length, 1); assert.equal(byKb(t, 'contacts-row-tag').length, 4, 'three tags of the first card and one of the second')
  assert.equal(find(t, (n) => n.props['data-kb'] === 'contacts-page')[0].props['data-view'], 'cards')
})
ok('the stagger stops at a step: a long list does not take seconds to appear', () => {
  const many = Array.from({ length: 60 }, (_, i) => row({ id: 100 + i, name: 'N' + String(i).padStart(2, '0') }))
  const idx = byKb(page(loaded(many)), 'contacts-row').map((r) => r.props.style['--kz-i'])
  assert.equal(Math.max(...idx), 14); assert.equal(idx[0], 0); assert.equal(idx[3], 3)
})
ok('companies: no company column, the email under the name; the rows are those of the kind, sorted by the preference', () => {
  const rows = sample.concat([R({ id: 5, kind: 'company', type: 'company', name: 'Zeta Ltd', tags: [] })])
  const t = page(st({ filters: Object.assign({}, FILTERS, { kind: 'company' }), list: LIST(rows) }))
  assert.deepEqual(byKb(t, 'contacts-row').map((r) => r.props['data-id']), [4, 5])
  assert.equal(find(t, (n) => n.type === 'th' && /col-co/.test(n.props.className || '')).length, 0)
  assert.equal(find(page(loaded(sample)), (n) => n.type === 'th' && /col-co/.test(n.props.className || '')).length, 1)
  const byName = page(st({ prefs: { sort: 'name', dir: 'desc', viewMode: 'list' }, list: LIST(sample) }))
  assert.deepEqual(byKb(byName, 'contacts-row').map((r) => r.props['data-id']), [3, 2, 1], 'Z to A')
})
ok('the strip: the kind switch with its counts, the theme\'s types as chips with theirs, the archived toggle; every button is type="button"', () => {
  const t = page(loaded(sample))
  assert.equal(byKb(t, 'contacts-kind').length, 2); assert.deepEqual(byKb(t, 'contacts-kind').map((b) => b.props['aria-pressed']), [true, false])
  assert.deepEqual(byKb(t, 'contacts-kind').map((b) => text(b).trim()), ['People 3', 'Companies 1'])
  assert.deepEqual(byKb(t, 'contacts-type').map((b) => b.props['data-type']), ['', 'customer', 'supplier'])
  assert.deepEqual(byKb(t, 'contacts-type').map((b) => b.props['aria-pressed']), [true, false, false], 'All is pressed when no type is chosen')
  assert.match(text(byKb(t, 'contacts-type')[1]), /Customer 2/)
  assert.equal(byKb(t, 'contacts-archived').length, 1); assert.equal(byKb(t, 'contacts-archived')[0].props['aria-pressed'], false)
  assert.equal(find(t, (n) => n.type === 'button' && n.props.type !== 'button').length, 0)
  const plain = page(st({ schema: { themed: false, types: [{ key: 'person', kind: 'person', label: { en: 'Person' } }, { key: 'company', kind: 'company', label: { en: 'Company' } }], fields: [], tags: [] }, list: LIST([]) }))
  assert.equal(byKb(plain, 'contacts-type').length, 0, 'one type of a kind: no chip row')
})
ok('the strip, with a type chosen: its chip is pressed and All is not; a chosen tag is a removable chip', () => {
  const t = page(st({ find: Object.assign({}, FIND, { types: ['t:supplier', 'g:vip'] }), list: LIST(sample) }))
  assert.deepEqual(byKb(t, 'contacts-type').map((b) => b.props['aria-pressed']), [false, false, true])
  assert.equal(byKb(t, 'contacts-active-tag').length, 1); assert.match(text(byKb(t, 'contacts-active-tag')[0]), /vip/)
  assert.equal(byKb(t, 'contacts-clear-filters').length, 1)
})
ok('the chips and the chips of the strip change the facets; the kind switch drops the types of the other kind', () => {
  SETS.length = 0
  const t = page(loaded(sample))
  const chip = byKb(t, 'contacts-type').find((b) => b.props['data-type'] === 'supplier')
  chip.props.onClick()
  const f1 = SETS.find((s) => s.name === 'ContactsPage' && s.i === 1)
  assert.deepEqual(f1.value.types, ['t:supplier'], 'a type chip toggles the type')
  SETS.length = 0
  page(st({ find: Object.assign({}, FIND, { types: ['t:customer', 'g:vip'] }), list: LIST(sample) }))
  const t2 = page(st({ find: Object.assign({}, FIND, { types: ['t:customer', 'g:vip'] }), list: LIST(sample) }))
  SETS.length = 0
  byKb(t2, 'contacts-kind').find((b) => b.props['data-kind'] === 'company').props.onClick()
  const kind = SETS.find((s) => s.name === 'ContactsPage' && s.i === 2); const types = SETS.find((s) => s.name === 'ContactsPage' && s.i === 1)
  assert.equal(kind.value.kind, 'company'); assert.deepEqual(types.value.types, ['g:vip'], 'the type goes, the tag stays')
  SETS.length = 0
  byKb(t2, 'contacts-type').find((b) => b.props['data-type'] === '').props.onClick()
  assert.deepEqual(SETS.find((s) => s.i === 1).value.types, ['g:vip'], 'All drops the types and keeps the tags')
  SETS.length = 0
  byKb(t2, 'contacts-row-tag')[0].children[0].children[0].props.onClick({ stopPropagation () {} })
  assert.deepEqual(SETS.find((s) => s.i === 1).value.types, ['t:customer'], 'a tag on a row, already chosen, goes off')
  SETS.length = 0
  byKb(page(loaded(sample)), 'contacts-row-tag')[0].children[0].children[0].props.onClick({ stopPropagation () {} })
  assert.deepEqual(SETS.find((s) => s.i === 1).value.types.length, 1, 'a tag on a row, not chosen, is chosen')
})
ok('a filter in use shows how to clear it; the pager appears past one page of the host', () => {
  assert.equal(byKb(page(st({ find: Object.assign({}, FIND, { query: 'a' }), q: 'a', list: LIST([row({})]) })), 'contacts-clear-filters').length, 1)
  assert.equal(byKb(page(st({ find: Object.assign({}, FIND, { period: '7' }), list: LIST([row({})]) })), 'contacts-clear-filters').length, 1)
  assert.equal(byKb(page(loaded([row({})])), 'contacts-clear-filters').length, 0)
  const t = page(loaded([row({})], { total: 750 }))
  assert.equal(byKb(t, 'contacts-pager').length, 1); assert.equal(byKb(t, 'contacts-pager-prev')[0].props.disabled, true); assert.equal(byKb(t, 'contacts-pager-next')[0].props.disabled, false)
  assert.equal(byKb(page(loaded([row({})], { total: 250 })), 'contacts-pager').length, 0, 'the host gives 500 rows a page now')
  assert.equal(T.PAGE_SIZE, 500)
  assert.match(text(byKb(t, 'contacts-count')[0]), /\+\s*$/, 'a partial page says so'); assert.equal(byKb(t, 'contacts-kind')[0].children.length >= 2, true)
})
ok('the count says how many of how many once a facet narrows the list', () => {
  const t = page(st({ find: Object.assign({}, FIND, { types: ['t:supplier'] }), list: LIST(sample) }))
  assert.match(text(byKb(t, 'contacts-count')[0]), /^1 of 3 people/)
})

console.log('── the bar of the core ──')
const withBar = (state, props) => { toolbarCalls.length = 0; return expand(el(Page, Object.assign({ toolbar: { KbToolbar, useToolbarState } }, props || {})), { ContactsPage: state }) }
ok('the page hands the core\'s bar its state, the four views it has and the primary action; no favourites (a contact has none)', () => {
  const t = withBar(loaded(sample))
  const bars = find(t, (n) => n.props && n.props['data-kb'] === 'fake-toolbar'); assert.equal(bars.length, 1, 'the core\'s bar is drawn')
  assert.equal(find(t, (n) => n.type === 'header' && n.props.className === 'kb6-headrow')[0].children.some((c) => c.props['data-kb'] === 'fake-toolbar'), true, 'in the header row, right of the title')
  assert.equal(byKb(t, 'contacts-own-bar').length, 0, 'and the page\'s own bar is not')
  assert.deepEqual(toolbarCalls, [{ id: 'contacts', defaults: { sort: 'modified', dir: 'desc', viewMode: 'list' } }], 'the view and the sort are kept by the core\'s hook under the page\'s id')
})
ok('the props of the bar: views cards then list with their words, no favourites, the sort options, the facets (types then tags, with counts), the period, the primary action as trailing', () => {
  let props = null
  const Spy = function KbToolbar (p) { props = p; return el('div', { 'data-kb': 'fake-toolbar' }) }
  expand(el(Page, { toolbar: { KbToolbar: Spy, useToolbarState } }), { ContactsPage: loaded(sample) })
  assert.deepEqual(props.views, ['cards', 'list']); assert.equal(props.viewLabels, true); assert.equal(props.showFav, false); assert.equal(props.facets.period, true)
  assert.deepEqual(props.sortOptions.map((o) => o.id), ['modified', 'name', 'created', 'type']); assert.ok(props.sortOptions.every((o) => o.label.length > 2))
  assert.deepEqual(props.facets.type.options.map((o) => [o.id, o.count]), [['t:customer', 2], ['t:supplier', 1], ['g:vip', 2], ['g:repeat', 1], ['g:wholesale', 0]])
  assert.ok(props.facets.type.options.every((o) => typeof o.label === 'string'), 'plain words without the kit')
  assert.deepEqual(props.state, { query: '', sort: 'modified', dir: 'desc', types: [], period: 'all', fav: false, viewMode: 'list' })
  assert.equal(props.trailing.props['data-kb'], 'contacts-new'); assert.equal(props.searchPlaceholder, 'Search a name or an email')
})
ok('with the kit, the options of the facet menu are the coloured chips; the first tag is marked so the menu can set the groups apart', () => {
  window.__KB_BIZ_KIT__ = { Tag: function Tag (p) { return el('span', { 'data-kit': 'tag', 'data-hue': p.hue, 'data-dot': p.dot }, p.text) }, Avatar: function Avatar () { return el('i') }, Icon: () => null, tint: () => 33, ensureCss () {} }
  let props = null
  const Spy = function KbToolbar (p) { props = p; return null }
  expand(el(Page, { toolbar: { KbToolbar: Spy, useToolbarState } }), { ContactsPage: loaded(sample) })
  const labels = props.facets.type.options.map((o) => expand(o.label, {}))
  assert.ok(labels.every((l) => l.type === 'span'))
  assert.equal(find(labels[0], (n) => n.props['data-kit'] === 'tag')[0].props['data-hue'], 33, 'a type is drawn in its hue, with a dot')
  assert.ok(!find(labels[2], (n) => n.props['data-kit'] === 'tag')[0].props['data-dot'], 'a tag has no dot')
  assert.deepEqual(labels.map((l) => l.props.className), [undefined, undefined, 'kbcts-first-tag', undefined, undefined])
  delete window.__KB_BIZ_KIT__
})
ok('what the bar says changes the page: the search, the facets and the period are the page\'s own state; the view, the sort and the direction go to the core\'s hook', () => {
  SETS.length = 0; toolbarPatches.length = 0
  let props = null
  const Spy = function KbToolbar (p) { props = p; return null }
  expand(el(Page, { toolbar: { KbToolbar: Spy, useToolbarState } }), { ContactsPage: loaded(sample) })
  props.onUpdate({ query: 'ana' }); props.onUpdate({ types: ['t:customer', 7, 'g:vip'] }); props.onUpdate({ period: '30' }); props.onUpdate({ period: 'x' })
  const sets = SETS.filter((s) => s.name === 'ContactsPage' && s.i === 1).map((s) => s.value)
  assert.deepEqual(sets[0], { query: 'ana', types: [], period: 'all' }); assert.deepEqual(sets[1].types, ['t:customer', 'g:vip'], 'a facet id that is not a string is dropped'); assert.equal(sets[2].period, '30'); assert.equal(sets.length, 3, 'a period nobody offers is ignored')
  props.onUpdate({ viewMode: 'cards' }); props.onUpdate({ sort: 'name', dir: 'asc' }); props.onUpdate({ viewMode: 'calendar', sort: 'weird', dir: 'sideways' }); props.onUpdate(null); props.onUpdate({ fav: true })
  assert.deepEqual(toolbarPatches, [{ viewMode: 'cards' }, { sort: 'name', dir: 'asc' }], 'a view, a sort or a direction the page does not have never reaches the hook; favourites are ignored')
  const longQuery = 'x'.repeat(300); SETS.length = 0; props.onUpdate({ query: longQuery })
  assert.equal(SETS.find((s) => s.i === 1).value.query.length, 200)
})
ok('the saved view decides the page: cards from the hook draw cards, an old value (columns) draws the list, and the sort of the hook orders the rows', () => {
  toolbarOver = { viewMode: 'cards' }; assert.equal(byKb(withBar(loaded(sample)), 'contacts-cards').length, 1)
  toolbarOver = { viewMode: 'columns' }; assert.equal(byKb(withBar(loaded(sample)), 'contacts-table').length, 1)
  toolbarOver = { sort: 'name', dir: 'asc' }; assert.deepEqual(byKb(withBar(loaded(sample)), 'contacts-row').map((r) => r.props['data-id']), [1, 2, 3])
  toolbarOver = { sort: 'bogus' }; assert.deepEqual(byKb(withBar(loaded(sample)), 'contacts-row').map((r) => r.props['data-id']), [1, 2, 3], 'a sort nobody offers reads as the last update')
  toolbarOver = {}
})
ok('the page\'s own bar (no core bar): search, the view with its words, the tag and the sort; a bar without the hook is not used', () => {
  const t = page(loaded(sample))
  assert.equal(byKb(t, 'contacts-own-bar').length, 1); assert.equal(byKb(t, 'contacts-search').length, 1)
  assert.deepEqual(byKb(t, 'contacts-view').map((b) => b.props['data-view']), ['cards', 'list']); assert.deepEqual(byKb(t, 'contacts-view').map((b) => b.props['aria-pressed']), ['false', 'true'])
  assert.equal(byKb(t, 'contacts-tag').length, 1); assert.equal(byKb(t, 'contacts-sort').length, 1); assert.equal(byKb(t, 'contacts-new').length, 1)
  assert.equal(byKb(page(loaded(sample), { toolbar: { KbToolbar } }), 'contacts-own-bar').length, 1, 'a half-handed bar is not trusted')
  assert.equal(byKb(page(loaded(sample), { toolbar: null }), 'contacts-own-bar').length, 1)
  assert.equal(byKb(page(st({ schema: { themed: false, types: [], fields: [], tags: [] }, list: LIST([]) })), 'contacts-tag').length, 0, 'no tag at all: no tag filter')
  SETS.length = 0
  byKb(t, 'contacts-view')[0].props.onClick(); assert.equal(SETS.find((s) => s.i === 0).value.viewMode, 'cards', 'the page keeps the view itself')
  SETS.length = 0
  byKb(t, 'contacts-tag')[0].props.onChange({ target: { value: 'g:vip' } }); assert.deepEqual(SETS.find((s) => s.i === 1).value.types, ['g:vip'])
  SETS.length = 0
  byKb(t, 'contacts-sort')[0].props.onChange({ target: { value: 'name' } }); assert.deepEqual(SETS.find((s) => s.i === 0).value, { sort: 'name', dir: 'asc', viewMode: 'list' })
})

const detail = (o) => ({ state: 'ok', error: null, data: Object.assign({ ok: true, contact: row({}), notes: [{ id: 2, body: 'Asked a quote', actor: 'agent', created_at: '2026-10-28T11:00:00Z' }, { id: 1, body: 'Called her', actor: 'person', created_at: '2026-10-28T10:00:00Z' }], company: { id: 9, name: 'Acme Farm', type: 'company', archived: false }, people: [] }, o) })
ok('the panel: fields in the theme\'s words, the linked company, the notes as a timeline (the agent\'s marked), the actions', () => {
  const t = page(withPanel([row({})], 1, detail()))
  const p = byKb(t, 'contacts-panel')[0]
  assert.ok(p !== undefined); assert.equal(p.props['data-id'], 1); assert.equal(p.type, 'aside')
  assert.match(text(p), /Léa Martin/); assert.match(text(p), /City/); assert.match(text(p), /Lyon/); assert.match(text(p), /lea@example\.com/); assert.match(text(p), /Customer/)
  assert.equal(byKb(t, 'contacts-linked').length, 1)
  const notes = byKb(t, 'contacts-note'); assert.equal(notes.length, 2); assert.match(text(notes[0]), /agent/); assert.doesNotMatch(text(notes[1]), /agent/)
  for (const k of ['contacts-panel-close', 'contacts-note-input', 'contacts-note-add', 'contacts-edit', 'contacts-archive', 'contacts-timeline', 'contacts-mail']) assert.equal(byKb(t, k).length, 1, k)
  assert.equal(byKb(t, 'contacts-restore').length, 0)
  assert.equal(byKb(t, 'contacts-note-add')[0].props.disabled, true, 'an empty note cannot be added')
  assert.equal(byKb(t, 'contacts-note-input')[0].type, 'textarea'); assert.equal(find(t, (n) => n.type === 'button' && /Edit/.test(text(n))).length, 1)
  assert.equal(find(t, (n) => n.props['data-kb'] === 'contacts-edit' && typeof n.props.onClick === 'function').length, 1)
  assert.equal(find(t, (n) => n.props.className && /kbcts-body has-panel/.test(n.props.className)).length, 1)
  assert.equal(byKb(t, 'contacts-created').length, 1, 'the timeline ends with the day the contact was added'); assert.match(text(byKb(t, 'contacts-created')[0]), /Added/)
  const tl = byKb(t, 'contacts-timeline')[0]; assert.equal(tl.children[tl.children.length - 1].props['data-kb'], 'contacts-created')
  assert.equal(find(t, (n) => n.type === 'label' && n.props.htmlFor === 'kbcts-note').length, 1, 'the note field has its label')
})
ok('the panel closes through the same button and Escape, and slides out while it closes', () => {
  const closing = find(page(st({ list: LIST([row({})]), openId: 1, detail: detail() }).concat([0, 0, true])), (n) => n.type === 'aside')[0]
  assert.match(closing.props.className, /\bout\b/)
  const open = byKb(page(withPanel([row({})], 1, detail())), 'contacts-panel')[0]
  assert.doesNotMatch(open.props.className, /\bout\b/); assert.equal(typeof open.props.onKeyDown, 'function')
})
ok('the panel lists the cards of a board that point at the contact, only when there are some', () => {
  const t = page(withPanel([row({})], 1, detail({ cards: [{ id: 5, flow: 'orders', stage: 'paid', title: 'Order #1031' }] })))
  assert.equal(byKb(t, 'contacts-card').length, 1); assert.match(text(byKb(t, 'contacts-card')[0]), /Order #1031.*orders · paid/); assert.match(text(byKb(t, 'contacts-panel')[0]), /Linked work/)
  assert.equal(byKb(page(withPanel([row({})], 1, detail())), 'contacts-card').length, 0)
})
ok('the panel of an archived demo contact: restore instead of archive, and both badges', () => {
  const d = detail({ contact: row({ archived_at: '2026-10-28T12:00:00Z', demo: true }) })
  const t = page(withPanel([row({})], 1, d))
  assert.equal(byKb(t, 'contacts-restore').length, 1); assert.equal(byKb(t, 'contacts-archive').length, 0)
  assert.equal(byKb(t, 'contacts-archived-badge').length, 1); assert.equal(byKb(byKb(t, 'contacts-panel')[0], 'contacts-demo-badge').length, 1)
})
ok('the panel of a company lists its people; with no note it says so (and the timeline keeps the day it was added); loading and error have their own words', () => {
  const co = detail({ contact: row({ id: 9, kind: 'company', name: 'Acme Farm', type: 'company', company_id: null, company: null }), company: null, notes: [], people: [{ id: 1, name: 'Léa Martin', type: 'customer', email: '' }] })
  const t = page(withPanel([row({})], 9, co))
  assert.equal(byKb(t, 'contacts-linked').length, 1); assert.equal(byKb(t, 'contacts-no-notes').length, 1); assert.equal(byKb(t, 'contacts-created').length, 1)
  assert.equal(byKb(page(withPanel([row({})], 1, { state: 'loading', data: null, error: null })), 'contacts-panel-loading').length, 1)
  const e = byKb(page(withPanel([row({})], 1, { state: 'error', data: null, error: { ok: false, error: 'busy' } })), 'contacts-panel-error')[0]
  assert.match(text(e), /in use by another program/)
})
ok('the panel has no mail action for a contact with no address', () => {
  assert.equal(byKb(page(withPanel([row({})], 1, detail({ contact: row({ email: '' }) }))), 'contacts-mail').length, 0)
})
ok('the dialog: name, kind (new only), type, email, company (people only), the theme\'s fields, tags; save and cancel', () => {
  const t = page(withDialog([row({})], { mode: 'new', kind: 'person' }))
  const d = byKb(t, 'contacts-dialog')[0]
  assert.ok(d !== undefined); assert.equal(d.props.role, 'dialog'); assert.equal(d.props['aria-modal'], 'true'); assert.ok(d.props['aria-labelledby'])
  for (const k of ['contacts-form-name', 'contacts-form-type', 'contacts-form-email', 'contacts-form-company', 'contacts-form-tags', 'contacts-form-save', 'contacts-form-cancel']) assert.equal(byKb(t, k).length, 1, k)
  assert.equal(byKb(t, 'contacts-form-kind').length, 2); assert.equal(byKb(t, 'contacts-form-field').length, schema.fields.length)
  assert.deepEqual(byKb(t, 'contacts-form-field').map((f) => f.props['data-key']), ['city', 'credit', 'tier', 'since'])
  assert.equal(byKb(t, 'contacts-form-field')[2].type, 'select'); assert.equal(byKb(t, 'contacts-form-field')[3].props.type, 'date')
  assert.ok(find(t, (n) => n.type === 'label' && n.props.htmlFor === 'kbcts-f-name').length === 1, 'every input has its label')
  const edit = page(st({ list: LIST([row({})]), openId: 1, detail: detail(), dialog: { mode: 'edit', contact: row({}), company: { id: 9, name: 'Acme Farm' } } }))
  assert.equal(byKb(edit, 'contacts-form-kind').length, 0, 'the kind of a contact does not change')
  assert.equal(byKb(edit, 'contacts-form-name')[0].props.value, 'Léa Martin')
})
ok('an edit can start from a row (the row is a whole contact), and the dialog\'s tags are chips that toggle', () => {
  const t = page(loaded([row({ id: 1 })]))
  SETS.length = 0
  byKb(t, 'contacts-row-edit')[0].props.onClick({ stopPropagation () {} })
  const dlg = SETS.find((s) => s.name === 'ContactsPage' && s.i === 8).value
  assert.equal(dlg.mode, 'edit'); assert.equal(dlg.contact.id, 1); assert.deepEqual(dlg.company, { id: 9, name: 'Acme Farm' })
  const tagged = page(withDialog([row({})], { mode: 'new', kind: 'person' }))
  assert.ok(find(byKb(tagged, 'contacts-dialog')[0], (n) => n.type === 'button' && n.props['aria-pressed'] !== undefined && /^(repeat|wholesale)$/.test(text(n).trim())).length === 2, 'the theme\'s tags are toggles')
})
ok('the dialog of a company has no company field; the confirmation before the sample data goes says it reaches the other pages', () => {
  const t = page(withDialog([row({})], { mode: 'new', kind: 'company' }))
  assert.equal(byKb(t, 'contacts-form-company').length, 0)
  const c = page(withDialog([row({})], { mode: 'clear' }))
  const box = byKb(c, 'contacts-confirm')[0]
  assert.equal(box.props.role, 'alertdialog'); assert.match(text(box), /Catalog and Pipeline/); assert.match(text(box), /Whatever you added yourself stays/)
  assert.equal(byKb(c, 'contacts-confirm-clear').length, 1); assert.equal(byKb(c, 'contacts-confirm-cancel').length, 1)
})
ok('a toast is a polite status line', () => {
  const t = page(st({ list: LIST([row({})]), toast: 'Contact added.' }))
  const s = byKb(t, 'contacts-toast')[0]
  assert.equal(s.props.role, 'status'); assert.match(text(s), /Contact added/)
})

console.log('── the shared kit ──')
const kitCalls = { tag: [], avatar: [], art: [], css: 0 }
const installKit = () => {
  kitCalls.tag.length = 0; kitCalls.avatar.length = 0; kitCalls.art.length = 0; kitCalls.css = 0
  window.__KB_BIZ_KIT__ = {
    v: 1, tint: (s) => ([...String(s)].reduce((n, c) => n + c.charCodeAt(0), 0) % 12) * 30,
    Tag: function Tag (p) { kitCalls.tag.push(p); return el(typeof p.onClick === 'function' ? 'button' : 'span', { className: 'kz-tag', 'data-hue': p.hue, onClick: p.onClick, 'aria-pressed': typeof p.onClick === 'function' ? String(p.on === true) : undefined }, p.text) },
    Avatar: function Avatar (p) { kitCalls.avatar.push(p); return el('span', { className: 'kz-av', 'data-kind': p.kind }, p.name) },
    Art: function Art (p) { kitCalls.art.push(p); return el('svg', { className: 'kz-art' }) },
    Icon: (n, s) => el('svg', { 'data-icon': n }), ensureCss () { kitCalls.css += 1 },
  }
}
ok('with the kit: the type is a chip in the hue of its key, the tags are chips, the avatar is the kit\'s (a company too), and the kit\'s CSS is asked for', () => {
  installKit()
  const t = page(loaded([row({ tags: ['vip'] }), row({ id: 2, kind: 'company', type: 'company', name: 'Acme', tags: [] })]))
  assert.ok(kitCalls.css >= 1)
  const type = kitCalls.tag.filter((p) => p.dot === true); assert.ok(type.length >= 1); assert.equal(type[0].text, 'Customer'); assert.equal(type[0].hue, window.__KB_BIZ_KIT__.tint('customer'), 'the hue follows the key, not the word (French reads the same colour)')
  assert.ok(kitCalls.tag.some((p) => p.text === 'vip' && typeof p.onClick === 'function'), 'a tag on a row is a button chip')
  assert.ok(kitCalls.avatar.length >= 1); assert.ok(kitCalls.avatar.every((p) => typeof p.name === 'string' && p.size > 0))
  assert.equal(find(t, (n) => n.props.className === 'kbcts-face' || /kbcts-face/.test(n.props.className || '')).every((n) => n.props['aria-hidden'] === 'true'), true, 'the avatar is decoration: the name is written beside it')
  const co = page(st({ filters: Object.assign({}, FILTERS, { kind: 'company' }), list: LIST([row({ id: 2, kind: 'company', type: 'company', name: 'Acme', tags: [] })]) }))
  assert.ok(kitCalls.avatar.some((p) => p.kind === 'company'))
  assert.equal(byKb(co, 'contacts-row').length, 1)
  delete window.__KB_BIZ_KIT__
})
ok('with the kit, an empty kind shows the drawn picture; without it, no picture and no error', () => {
  installKit()
  page(loaded([])); assert.equal(kitCalls.art.length, 1); assert.match(kitCalls.art[0].spec, /^art:desk\//)
  delete window.__KB_BIZ_KIT__
  assert.doesNotThrow(() => page(loaded([])))
})
ok('a kit that is half there (no Tag, no Avatar) or gone is no kit: the page draws plain chips and initials', () => {
  window.__KB_BIZ_KIT__ = { v: 1 }
  assert.equal(byKb(page(loaded([row({})])), 'contacts-row').length, 1)
  window.__KB_BIZ_KIT__ = undefined
  assert.equal(byKb(page(loaded([row({})])), 'contacts-row').length, 1)
  delete window.__KB_BIZ_KIT__
})

console.log('── words and promises ──')
/** Every state the page can be in, drawn once with the core's bar and once with its own, in cards and in a list, with the kit and without it. */
const everyState = () => {
  const r0 = row({ name: 'Lea Martin' })
  const detail0 = detail({ contact: r0, notes: [{ id: 1, body: 'Called her', actor: 'person', created_at: '2026-10-28T10:00:00Z' }, { id: 2, body: 'Asked a quote', actor: 'agent', created_at: '2026-10-28T11:00:00Z' }], cards: [{ id: 5, flow: 'orders', stage: 'paid', title: 'Order' }] })
  const cards = Object.assign({}, PREFS, { viewMode: 'cards' })
  const list = [page([]), page(loaded([r0], { demo: 1 })), page(loaded([])), page(st({ list: { status: 'error', rows: [], total: 0, demo: 0, truncated: false, error: { ok: false, error: 'busy' } } })),
    page(withPanel([r0], 1, detail0)), page(withDialog([r0], { mode: 'new', kind: 'person' })), page(withDialog([r0], { mode: 'clear' })), page(withDialog([r0], { mode: 'edit', contact: r0, company: r0.company })),
    page(st({ prefs: cards, list: LIST([r0], { demo: 1 }) })), page(st({ prefs: cards, list: LIST([r0]), openId: 1, detail: detail0 })), page(st({ find: Object.assign({}, FIND, { types: ['g:vip', 't:customer'], period: '7' }), list: LIST([r0], { total: 900 }) })),
    page(st({ find: Object.assign({}, FIND, { query: 'zzz' }), q: 'zzz', list: LIST([]) })), page(st({ list: LIST([r0]), toast: 'Contact added.' })),
    page(withPanel([r0], 1, { state: 'loading', data: null, error: null })), page(withPanel([r0], 1, { state: 'error', data: null, error: { ok: false, error: 'busy' } })),
    withBar(loaded([r0]))]
  return list
}
ok('no English sentence leaks French accents, in any state (everything visible goes through kt)', () => {
  resolved = 'en'
  // the data is the person's, accents and all: the fixtures here have none, so a French letter can only come from the page's own words
  for (const kit of [false, true]) {
    if (kit) installKit()
    for (const s of everyState()) assert.doesNotMatch(text(s) + JSON.stringify(find(s, (n) => n.props['aria-label'] || n.props.placeholder || n.props.title).map((n) => [n.props['aria-label'], n.props.placeholder, n.props.title])), /[éèêàçùôîï]/)
    delete window.__KB_BIZ_KIT__
  }
})
ok('French is the other language: the same page speaks French when the language is French, and not for any other language', () => {
  resolved = 'fr'; const fr = text(page(loaded([row({})]))); resolved = 'en'
  assert.match(fr, /Modifié/); assert.match(fr, /Nom/); assert.match(fr, /Personnes/)
  for (const l of ['es', 'ar', 'zh-Hans', 'de']) { resolved = l; assert.doesNotMatch(text(page(loaded([row({})]))), /Modifié/, l) }
  resolved = 'kybernos'; assert.match(text(page(loaded([row({})]))), /Modifié/, 'the Kybernos default is French'); resolved = 'en'
  window.__KB_LANG_RESOLVE__ = () => { throw new Error('not ready') }; assert.equal(T.kt('un', 'one'), 'one'); window.__KB_LANG_RESOLVE__ = () => resolved
  resolved = 'fr'; const bar = withBar(loaded([row({})])); resolved = 'en'
  assert.ok(find(bar, (n) => n.props['data-kb'] === 'fake-toolbar').length === 1)
})
ok('every text the page can show has both languages (the pack the Language plugin reads has both sides filled)', () => {
  everyState()
  const pack = T.kt.pack
  assert.ok(Object.keys(pack).length > 60)
  for (const [fr, v] of Object.entries(pack)) { assert.ok(v.fr.trim() !== '' && v.en.trim() !== '', fr); assert.equal(v.fr, fr) }
  assert.ok(pack['Dernière modification'] && pack['Type et étiquettes'] && pack['Écrire un e-mail'], 'the words of the new bar, the facet label and the row actions are in the pack')
})
ok('the colours: DSH\'s tokens, or the hsl of a type\'s hue; the one literal colour is white (#fff) on a solid chip; no hex, no rgb, no named colour', () => {
  assert.doesNotMatch(T.CSS, /#(?!fff\b)[0-9a-fA-F]{3,8}\b/); assert.doesNotMatch(T.CSS, /\brgba?\(/)
  assert.doesNotMatch(T.CSS, /\bhsla?\((?!var\(--(?:kbcts|kz)-h\)|calc\(var\(--kbcts-h\))/, 'an hsl is always the hue of a type, never a colour of its own')
  assert.doesNotMatch(T.CSS, /(color|background|border[a-z-]*)\s*:\s*(white|black|red|green|blue|gray|grey|orange|yellow)\b/i)
  assert.ok((T.CSS.match(/var\(--dsw-alias-[a-z0-9-]+/g) || []).length > 100)
  assert.doesNotMatch(source, /#(?!fff\b)[0-9a-fA-F]{6}\b/); assert.doesNotMatch(source.replace(/\/\/[^\n]*/g, ''), /rgba?\(/)
})
ok('font sizes come from the scale 11, 12, 13, 14, 16, 20 (px), in the styles and in the few inline styles', () => {
  const scale = [11, 12, 13, 14, 16, 20]
  const sizes = [...T.CSS.matchAll(/font-size:\s*([0-9.]+)px/g)].map((m) => Number(m[1]))
  assert.ok(sizes.length > 20); assert.deepEqual(sizes.filter((s) => scale.indexOf(s) < 0), [])
  for (const m of source.matchAll(/fontSize:\s*([^,}]+)/g)) for (const n of m[1].match(/\d+/g) || []) assert.ok(scale.indexOf(Number(n)) >= 0, 'fontSize ' + m[1])
})
ok('motion: the styles stop every animation and transition under prefers-reduced-motion, the kit\'s classes are the ones used, and the panel closes at once when motion is reduced', () => {
  assert.match(T.CSS, /@media \(prefers-reduced-motion:reduce\)\{[^@]*animation:none!important;transition:none!important/)
  for (const cls of ['kz-lift', 'kz-in', 'kz-pop']) assert.match(source, new RegExp(cls))
  for (const kf of [...T.CSS.matchAll(/animation:\s*([a-z-]+)/g)].map((m) => m[1]).filter((n) => n !== 'none')) assert.match(T.CSS, new RegExp('@keyframes ' + kf + '\\b'), kf)
  assert.match(source, /prefers-reduced-motion: reduce/)
})
ok('the page\'s CSS names no class of the kit (a prefix one bundle owns: the kit\'s chips are reached through their wrapper, the kit\'s motion through its class names in the markup)', () => {
  assert.doesNotMatch(T.CSS.replace(/\[style\*="--kz-h"\]/g, '').replace(/var\(--kz-[a-z]+/g, ''), /\.kz-/)
  assert.match(source, /className: 'kbcts-cell kz-in'/); assert.match(source, /'kbcts-card kz-lift/)
})
ok('no innerHTML anywhere, no hand-made markup', () => { assert.doesNotMatch(source, /innerHTML|dangerouslySetInnerHTML|insertAdjacentHTML|document\.write/) })
ok('every control is a real element: buttons are button/a, toggles say aria-pressed, rows are focusable', () => {
  const t = page(loaded(sample)); const c = page(st({ prefs: Object.assign({}, PREFS, { viewMode: 'cards' }), list: LIST(sample) }))
  for (const tree of [t, c]) {
    assert.equal(find(tree, (n) => n.props && typeof n.props.onClick === 'function' && !['button', 'a', 'tr', 'article', 'div'].includes(n.type) && typeof n.type === 'string').length, 0)
    assert.ok(find(tree, (n) => n.type === 'button' && n.props['data-kb'] === 'contacts-archived').every((b) => b.props['aria-pressed'] !== undefined))
    assert.ok(find(tree, (n) => n.type === 'button' && /contacts-(kind|type)/.test(n.props['data-kb'] || '')).every((b) => b.props['aria-pressed'] !== undefined))
    assert.ok(find(tree, (n) => n.props && n.props['data-kb'] === 'contacts-row-edit' || (n.props && n.props['data-kb'] === 'contacts-row-mail')).every((b) => typeof b.props['aria-label'] === 'string' && b.props['aria-label'].length > 3), 'icon buttons are named')
  }
})
ok('the page asks its own host only, with the session cookie, and every call goes through one function', () => {
  assert.deepEqual([...new Set([...source.matchAll(/'\/kybernos[a-z-]*/g)].map((m) => m[0]))], ["'/kybernos-contacts"])
  assert.equal([...source.matchAll(/\bfetch\(/g)].length, 1); assert.match(source, /credentials: 'same-origin'/)
  assert.doesNotMatch(source, /localStorage|sessionStorage|XMLHttpRequest|WebSocket|navigator\.sendBeacon/)
})
ok('the help is mounted behind the guard expression, and the page never calls a seam it did not test for', () => {
  assert.match(source, /typeof window !== 'undefined' && window\.__KB_HELP__ && window\.__KB_HELP__\.Help/)
  assert.match(source, /window\.__KB_MENU__ && typeof window\.__KB_MENU__\.register === 'function'/)
})
ok('the file keeps the rules of the bundle: no import of another bundle or of the core, English comments', () => {
  assert.doesNotMatch(source, /^\s*import\s/m); assert.doesNotMatch(source, /@deepseek-ai/)
  assert.doesNotMatch(source.replace(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g, ''), /[éèêàçù]/, 'a comment or an identifier in French')
})

if (failed > 0) { console.log('test-client: ' + failed + ' failure(s)'); process.exit(1) }
console.log('test-client: all green')
