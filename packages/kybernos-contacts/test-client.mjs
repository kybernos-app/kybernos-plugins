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
let hooks = { i: 0, over: [] }
const el = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false) })
const React = {
  createElement: el, Fragment: FRAGMENT,
  useState: (v) => { const o = hooks.over[hooks.i++]; const init = typeof v === 'function' ? v() : v; return [o !== undefined ? o : init, () => {}] },
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

console.log('── the page, rendered in each state ──')
const walk = (node, fn) => { if (node === null || typeof node !== 'object') return; fn(node); for (const c of node.children || []) walk(c, fn) }
const find = (tree, pred) => { const out = []; walk(tree, (n) => { if (pred(n)) out.push(n) }); return out }
const byKb = (tree, kb) => find(tree, (n) => n.props && n.props['data-kb'] === kb)
// The words a person reads: the text nodes, leaving out the stylesheet the page carries
const text = (tree) => { let s = ''; walk(tree, (n) => { if (n.type === 'style') return; for (const c of n.children || []) if (typeof c === 'string') s += c + ' ' }); return s }
/** Expands the components (the page, its panel and its dialogs) into plain elements; `over` hands a component its first hook values, by the component's name. */
const expand = (node, over) => {
  if (node === null || typeof node !== 'object') return node
  if (typeof node.type === 'function') {
    const saved = hooks
    hooks = { i: 0, over: (over && over[node.type.name]) || [] }
    const out = node.type(Object.assign({}, node.props, { children: node.children }))
    hooks = saved
    return expand(out, over)
  }
  return Object.assign({}, node, { children: (node.children || []).map((c) => expand(c, over)) })
}
let Page = null
ok('the page builds from React', () => { Page = T.build(React); assert.equal(typeof Page, 'function') })
// ContactsPage state order: filters, qInput, q, schema, list, openId, detail, dialog, toast, reload, redraw
const FILTERS = { kind: 'person', type: '', tag: '', archived: false, offset: 0 }
const row = (o) => Object.assign({ id: 1, kind: 'person', type: 'customer', name: 'Léa Martin', email: 'lea@example.com', company_id: 9, company: { id: 9, name: 'Acme Farm' }, tags: ['repeat', 'vip', 'a', 'b'], fields: { city: 'Lyon' }, demo: false, archived_at: null, created_at: '2026-10-28T10:00:00Z', updated_at: '2026-10-28T10:00:00Z' }, o)
const page = (state) => expand(el(Page, {}), { ContactsPage: state })
const loaded = (rows, extra) => [FILTERS, '', '', schema, Object.assign({ status: 'ok', rows, total: rows.length, demo: 0, truncated: false, error: null }, extra)]

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
  const t = page([FILTERS, '', '', schema, { status: 'error', rows: [], total: 0, demo: 0, truncated: false, error: { ok: false, error: 'base_missing' } }])
  const e = byKb(t, 'contacts-error')[0]
  assert.ok(e !== undefined); assert.equal(e.props.role, 'alert'); assert.match(text(e), /cannot be read right now/); assert.match(text(e), /not available in this DSH/)
  assert.equal(byKb(t, 'contacts-retry').length, 1); assert.equal(byKb(t, 'contacts-new')[0].props.disabled, true)
  assert.equal(byKb(t, 'contacts-table').length, 0); assert.equal(byKb(t, 'contacts-loading').length, 0)
})
ok('empty, nothing yet: an invitation to add the first one, and the same button as the header', () => {
  const t = page(loaded([]))
  const e = byKb(t, 'contacts-empty')[0]
  assert.equal(e.props['data-why'], 'none'); assert.match(text(e), /No contacts yet/); assert.equal(byKb(t, 'contacts-empty-new').length, 1)
  const co = page([Object.assign({}, FILTERS, { kind: 'company' }), '', '', schema, { status: 'ok', rows: [], total: 0, demo: 0, truncated: false, error: null }])
  assert.match(text(byKb(co, 'contacts-empty')[0]), /No companies yet/)
})
ok('empty, nothing matches: it says so and offers to clear the filters (the search is not "no contacts")', () => {
  const t = page([FILTERS, 'zzz', 'zzz', schema, { status: 'ok', rows: [], total: 0, demo: 0, truncated: false, error: null }])
  const e = byKb(t, 'contacts-empty')[0]
  assert.equal(e.props['data-why'], 'filtered'); assert.match(text(e), /No contact matches/); assert.doesNotMatch(text(e), /No contacts yet/)
  assert.equal(byKb(t, 'contacts-clear-filters').length, 1)
})
ok('loaded: a table, one focusable row per contact with its id, the demo badge, the company under the name, three tags and a count', () => {
  const t = page(loaded([row({}), row({ id: 2, name: 'Bob', company: null, company_id: null, email: 'bob@example.com', demo: true, tags: [] })], { demo: 1 }))
  assert.equal(byKb(t, 'contacts-table').length, 1)
  const rows = byKb(t, 'contacts-row')
  assert.deepEqual(rows.map((r) => r.props['data-id']), [1, 2]); assert.ok(rows.every((r) => r.props.tabIndex === 0 && typeof r.props.onKeyDown === 'function' && typeof r.props.onClick === 'function'))
  assert.equal(rows[1].props['data-demo'], '1'); assert.equal(byKb(t, 'contacts-demo-badge').length, 1)
  assert.match(text(rows[0]), /Acme Farm/); assert.match(text(rows[1]), /bob@example\.com/)
  assert.equal(byKb(t, 'contacts-row-tag').length, 3, 'three tags are drawn, the others are counted'); assert.match(text(rows[0]), /\+1/)
  assert.match(text(byKb(t, 'contacts-count')[0]), /^2 people/)
  assert.equal(byKb(t, 'contacts-demo-banner').length, 1); assert.equal(byKb(t, 'contacts-clear-demo').length, 1)
  assert.equal(byKb(page(loaded([row({})])), 'contacts-demo-banner').length, 0, 'no sample rows, no banner')
})
ok('the controls: search, the kind switch, the theme\'s types as chips, the tag filter, the archived toggle; every button is type="button"', () => {
  const t = page(loaded([row({})]))
  assert.equal(byKb(t, 'contacts-search').length, 1); assert.equal(byKb(t, 'contacts-kind').length, 2)
  assert.deepEqual(byKb(t, 'contacts-kind').map((b) => b.props['aria-pressed']), [true, false])
  assert.deepEqual(byKb(t, 'contacts-type').map((b) => b.props['data-type']), ['', 'customer', 'supplier'])
  assert.equal(byKb(t, 'contacts-tag').length, 1); assert.equal(byKb(t, 'contacts-archived').length, 1)
  assert.equal(find(t, (n) => n.type === 'button' && n.props.type !== 'button').length, 0)
  const plain = expand(el(Page, {}), { ContactsPage: [FILTERS, '', '', { themed: false, types: [{ key: 'person', kind: 'person', label: { en: 'Person' } }, { key: 'company', kind: 'company', label: { en: 'Company' } }], fields: [], tags: [] }, { status: 'ok', rows: [], total: 0, demo: 0, truncated: false, error: null }] })
  assert.equal(byKb(plain, 'contacts-type').length, 0, 'one type of a kind: no chip row'); assert.equal(byKb(plain, 'contacts-tag').length, 0, 'no tag at all: no tag filter')
})
ok('a filter in use shows how to clear it; the pager appears past one page', () => {
  assert.equal(byKb(page([FILTERS, 'a', 'a', schema, loaded([row({})])[4]]), 'contacts-clear-filters').length, 1)
  assert.equal(byKb(page(loaded([row({})])), 'contacts-clear-filters').length, 0)
  const t = page(loaded([row({})], { total: 250 }))
  assert.equal(byKb(t, 'contacts-pager').length, 1); assert.equal(byKb(t, 'contacts-pager-prev')[0].props.disabled, true); assert.equal(byKb(t, 'contacts-pager-next')[0].props.disabled, false)
})
const detail = (o) => ({ state: 'ok', error: null, data: Object.assign({ ok: true, contact: row({}), notes: [{ id: 1, body: 'Called her', actor: 'person', created_at: '2026-10-28T10:00:00Z' }, { id: 2, body: 'Asked a quote', actor: 'agent', created_at: '2026-10-28T11:00:00Z' }], company: { id: 9, name: 'Acme Farm', type: 'company', archived: false }, people: [] }, o) })
ok('the panel: fields in the theme\'s words, the linked company, the notes (the agent\'s marked), the actions', () => {
  const t = page(loaded([row({})]).concat([1, detail()]))
  const p = byKb(t, 'contacts-panel')[0]
  assert.ok(p !== undefined); assert.equal(p.props['data-id'], 1); assert.equal(p.type, 'aside')
  assert.match(text(p), /Léa Martin/); assert.match(text(p), /City/); assert.match(text(p), /Lyon/); assert.match(text(p), /lea@example\.com/); assert.match(text(p), /Customer/)
  assert.equal(byKb(t, 'contacts-linked').length, 1)
  const notes = byKb(t, 'contacts-note'); assert.equal(notes.length, 2); assert.match(text(notes[1]), /agent/); assert.doesNotMatch(text(notes[0]), /agent/)
  for (const k of ['contacts-panel-close', 'contacts-note-input', 'contacts-note-add', 'contacts-edit', 'contacts-archive']) assert.equal(byKb(t, k).length, 1, k)
  assert.equal(byKb(t, 'contacts-restore').length, 0)
  assert.equal(byKb(t, 'contacts-note-add')[0].props.disabled, true, 'an empty note cannot be added')
  assert.equal(byKb(t, 'contacts-note-input')[0].type, 'textarea'); assert.equal(find(t, (n) => n.type === 'button' && /Edit/.test(text(n))).length, 1)
  assert.equal(find(t, (n) => n.props['data-kb'] === 'contacts-edit' && typeof n.props.onClick === 'function').length, 1)
  assert.equal(find(t, (n) => n.props.className && /kbcts-body has-panel/.test(n.props.className)).length, 1)
})
ok('the panel lists the cards of a board that point at the contact, only when there are some', () => {
  const t = page(loaded([row({})]).concat([1, detail({ cards: [{ id: 5, flow: 'orders', stage: 'paid', title: 'Order #1031' }] })]))
  assert.equal(byKb(t, 'contacts-card').length, 1); assert.match(text(byKb(t, 'contacts-card')[0]), /Order #1031.*orders · paid/); assert.match(text(byKb(t, 'contacts-panel')[0]), /Linked work/)
  assert.equal(byKb(page(loaded([row({})]).concat([1, detail()])), 'contacts-card').length, 0)
})
ok('the panel of an archived demo contact: restore instead of archive, and both badges', () => {
  const d = detail({ contact: row({ archived_at: '2026-10-28T12:00:00Z', demo: true }) })
  const t = page(loaded([row({})]).concat([1, d]))
  assert.equal(byKb(t, 'contacts-restore').length, 1); assert.equal(byKb(t, 'contacts-archive').length, 0)
  assert.equal(byKb(t, 'contacts-archived-badge').length, 1); assert.equal(byKb(byKb(t, 'contacts-panel')[0], 'contacts-demo-badge').length, 1)
})
ok('the panel of a company lists its people; with no note it says so; loading and error have their own words', () => {
  const co = detail({ contact: row({ id: 9, kind: 'company', name: 'Acme Farm', type: 'company', company_id: null, company: null }), company: null, notes: [], people: [{ id: 1, name: 'Léa Martin', type: 'customer', email: '' }] })
  const t = page(loaded([row({})]).concat([9, co]))
  assert.equal(byKb(t, 'contacts-linked').length, 1); assert.equal(byKb(t, 'contacts-no-notes').length, 1)
  assert.equal(byKb(page(loaded([row({})]).concat([1, { state: 'loading', data: null, error: null }])), 'contacts-panel-loading').length, 1)
  const e = byKb(page(loaded([row({})]).concat([1, { state: 'error', data: null, error: { ok: false, error: 'busy' } }])), 'contacts-panel-error')[0]
  assert.match(text(e), /in use by another program/)
})
ok('the dialog: name, kind (new only), type, email, company (people only), the theme\'s fields, tags; save and cancel', () => {
  const t = page(loaded([row({})]).concat([null, { state: 'idle', data: null, error: null }, { mode: 'new', kind: 'person' }]))
  const d = byKb(t, 'contacts-dialog')[0]
  assert.ok(d !== undefined); assert.equal(d.props.role, 'dialog'); assert.equal(d.props['aria-modal'], 'true'); assert.ok(d.props['aria-labelledby'])
  for (const k of ['contacts-form-name', 'contacts-form-type', 'contacts-form-email', 'contacts-form-company', 'contacts-form-tags', 'contacts-form-save', 'contacts-form-cancel']) assert.equal(byKb(t, k).length, 1, k)
  assert.equal(byKb(t, 'contacts-form-kind').length, 2); assert.equal(byKb(t, 'contacts-form-field').length, schema.fields.length)
  assert.deepEqual(byKb(t, 'contacts-form-field').map((f) => f.props['data-key']), ['city', 'credit', 'tier', 'since'])
  assert.equal(byKb(t, 'contacts-form-field')[2].type, 'select'); assert.equal(byKb(t, 'contacts-form-field')[3].props.type, 'date')
  assert.ok(find(t, (n) => n.type === 'label' && n.props.htmlFor === 'kbcts-f-name').length === 1, 'every input has its label')
  const edit = page(loaded([row({})]).concat([1, detail(), { mode: 'edit', contact: row({}), company: { id: 9, name: 'Acme Farm' } }]))
  assert.equal(byKb(edit, 'contacts-form-kind').length, 0, 'the kind of a contact does not change')
  assert.equal(byKb(edit, 'contacts-form-name')[0].props.value, 'Léa Martin')
})
ok('the dialog of a company has no company field; the confirmation before the sample data goes says it reaches the other pages', () => {
  const t = page(loaded([row({})]).concat([null, { state: 'idle', data: null, error: null }, { mode: 'new', kind: 'company' }]))
  assert.equal(byKb(t, 'contacts-form-company').length, 0)
  const c = page(loaded([row({})]).concat([null, { state: 'idle', data: null, error: null }, { mode: 'clear' }]))
  const box = byKb(c, 'contacts-confirm')[0]
  assert.equal(box.props.role, 'alertdialog'); assert.match(text(box), /Catalog and Pipeline/); assert.match(text(box), /Whatever you added yourself stays/)
  assert.equal(byKb(c, 'contacts-confirm-clear').length, 1); assert.equal(byKb(c, 'contacts-confirm-cancel').length, 1)
})
ok('a toast is a polite status line', () => {
  const t = page(loaded([row({})]).concat([null, { state: 'idle', data: null, error: null }, null, 'Contact added.']))
  const s = byKb(t, 'contacts-toast')[0]
  assert.equal(s.props.role, 'status'); assert.match(text(s), /Contact added/)
})

console.log('── words and promises ──')
ok('no English sentence leaks French accents, in any state (everything visible goes through kt)', () => {
  resolved = 'en'
  // the data is the person's, accents and all: the fixtures here have none, so a French letter can only come from the page's own words
  const r0 = row({ name: 'Lea Martin' })
  const detail0 = detail({ contact: r0, notes: [{ id: 1, body: 'Called her', actor: 'person', created_at: '2026-10-28T10:00:00Z' }] })
  const states = [page([]), page(loaded([r0], { demo: 1 })), page(loaded([])), page([FILTERS, '', '', schema, { status: 'error', rows: [], total: 0, demo: 0, truncated: false, error: { ok: false, error: 'busy' } }]), page(loaded([r0]).concat([1, detail0])), page(loaded([r0]).concat([null, { state: 'idle', data: null, error: null }, { mode: 'new', kind: 'person' }])), page(loaded([r0]).concat([null, { state: 'idle', data: null, error: null }, { mode: 'clear' }]))]
  for (const s of states) assert.doesNotMatch(text(s) + JSON.stringify(find(s, (n) => n.props['aria-label'] || n.props.placeholder || n.props.title).map((n) => [n.props['aria-label'], n.props.placeholder, n.props.title])), /[éèêàçùôîï]/)
})
ok('French is the other language: the same page speaks French when the language is French, and not for any other language', () => {
  resolved = 'fr'; const fr = text(page(loaded([row({})]))); resolved = 'en'
  assert.match(fr, /Modifié/); assert.match(fr, /Nom/)
  for (const l of ['es', 'ar', 'zh-Hans', 'de']) { resolved = l; assert.doesNotMatch(text(page(loaded([row({})]))), /Modifié/, l) }
  resolved = 'kybernos'; assert.match(text(page(loaded([row({})]))), /Modifié/, 'the Kybernos default is French'); resolved = 'en'
  window.__KB_LANG_RESOLVE__ = () => { throw new Error('not ready') }; assert.equal(T.kt('un', 'one'), 'one'); window.__KB_LANG_RESOLVE__ = () => resolved
})
ok('every text the page can show has both languages (the pack the Language plugin reads has both sides filled)', () => {
  page(loaded([row({})])); page([]); page(loaded([]))
  const pack = T.kt.pack
  assert.ok(Object.keys(pack).length > 40)
  for (const [fr, v] of Object.entries(pack)) { assert.ok(v.fr.trim() !== '' && v.en.trim() !== '', fr); assert.equal(v.fr, fr) }
})
ok('DSH\'s tokens only: no colour in the styles (no hex, no rgb, no named colour), every colour from var(--dsw-alias-*)', () => {
  assert.doesNotMatch(T.CSS, /#[0-9a-fA-F]{3,8}\b/); assert.doesNotMatch(T.CSS, /\brgba?\(|\bhsla?\(/)
  assert.doesNotMatch(T.CSS, /(color|background|border[a-z-]*)\s*:\s*(white|black|red|green|blue|gray|grey|orange|yellow)\b/i)
  assert.ok((T.CSS.match(/var\(--dsw-alias-[a-z0-9-]+/g) || []).length > 60)
  assert.doesNotMatch(source, /#[0-9a-fA-F]{6}\b/)
})
ok('labels are in sentence case: no text-transform in the styles (the product shouts nowhere but in its few named places)', () => { assert.doesNotMatch(T.CSS, /text-transform/) })
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
