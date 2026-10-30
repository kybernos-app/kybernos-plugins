// test-client.mjs: the browser half of kybernos-catalog, outside a browser. client.js is evaluated as the engine loads it (a fake `window.__ModuleLoader__`); the
// page is rendered with the repository's small React (the test helper of the core, which also fails on a component that changes its hooks between two renders),
// over a fake /kybernos-catalog server. The tests select on `data-kb`, never on the visible words.
//
//   node packages/kybernos-catalog/test-client.mjs
import { readFileSync } from 'node:fs'
import { createLite } from '../kybernos-plugin/lib-lite-react-test.mjs'

let failed = 0
const ok = (label, cond, detail) => {
  if (cond) console.log('✓ ' + label + (detail === undefined ? '' : ' (' + detail + ')'))
  else { console.error('✗ ' + label + (detail === undefined ? '' : ' — ' + detail)); failed += 1 }
}
const L = (en, fr) => (fr === undefined ? { en } : { en, fr })

const PRODUCT = {
  id: 'product', label: L('Product', 'Produit'), plural: L('Products', 'Produits'), icon: 'package',
  statuses: [{ key: 'live', tone: 'ok', label: L('Live', 'En ligne') }, { key: 'low', tone: 'warn', label: L('Low stock', 'Stock bas') }, { key: 'out', tone: 'bad', label: L('Out of stock', 'Rupture') }],
  fields: [{ key: 'sku', type: 'text', label: L('SKU') }, { key: 'stock', type: 'number', label: L('Stock') }, { key: 'price', type: 'money', currency: 'EUR', label: L('Price', 'Prix') }, { key: 'size', type: 'choice', options: ['s', 'm'] }, { key: 'site', type: 'url' }],
  card: { title: 'title', subtitle: 'sku', price: 'price', flag: { field: 'stock', lte: 10, label: L('Only {n} left', 'Plus que {n}') } },
  views: ['cards', 'list'],
}
const JOB = { id: 'job', label: L('Job'), plural: L('Jobs'), icon: 'briefcase', statuses: [{ key: 'open', tone: 'ok', label: L('Open') }, { key: 'filled', label: L('Filled') }], fields: [], card: {}, views: ['list'] }
const DEFAULT = { id: 'item', label: L('Item', 'Élément'), plural: L('Items', 'Éléments'), icon: 'package', statuses: [{ key: 'draft', tone: 'warn', label: L('Draft', 'Brouillon') }, { key: 'live', tone: 'ok', label: L('Live', 'En ligne') }, { key: 'archived', tone: 'neutral', label: L('Archived', 'Archivé') }], fields: [], card: {}, views: ['cards', 'list'] }

// ── a fake browser and a fake server ───────────────────────────────────────────────────────────────
let language = 'en'
const store = new Map()
const calls = []
const server = {
  types: [PRODUCT], source: 'theme', rows: [], fail: null, nextId: 100,
  reset (types, source, rows) { this.types = types; this.source = source; this.rows = rows; this.fail = null; calls.length = 0 },
}
const row = (id, over) => Object.assign({ id, type: 'product', title: 'Item ' + id, subtitle: '', status: 'live', price_text: '', price_num: null, fields: {}, demo: false, created_at: '2026-10-29T10:00:00.000Z', updated_at: '2026-10-29T10:00:00.000Z', archived_at: null }, over)
const respond = (status, json) => ({ status, json: async () => json })
globalThis.fetch = async (url, init = {}) => {
  const method = init.method || 'GET'
  const body = init.body === undefined ? undefined : JSON.parse(init.body)
  calls.push({ method, url, body, credentials: init.credentials })
  if (server.fail === 'throw') throw new Error('network down')
  if (server.fail !== null) return respond(server.fail.status, server.fail.json)
  const u = new URL(url, 'http://x')
  const path = u.pathname.replace('/kybernos-catalog/', '')
  const p = u.searchParams
  if (path === 'types') return respond(200, { ok: true, source: server.source, types: server.types })
  if (path === 'list') {
    const live = server.rows.filter((r) => (p.get('archived') === 'only') === (r.archived_at !== null))
    const byText = live.filter((r) => (p.get('q') ? r.title.toLowerCase().includes(p.get('q').toLowerCase()) : true) && (p.get('type') ? r.type === p.get('type') : true))
    const counts = {}
    for (const r of byText) counts[r.status] = (counts[r.status] || 0) + 1
    const chosen = byText.filter((r) => (p.get('status') ? r.status === p.get('status') : true))
    const off = Number(p.get('offset') || 0)
    const lim = Number(p.get('limit') || 100)
    const demoItems = server.rows.filter((r) => r.demo).length
    return respond(200, { ok: true, rows: chosen.slice(off, off + lim), total: chosen.length, limit: lim, offset: off, counts, countsPartial: false, demo: { items: demoItems, all: demoItems ? demoItems + 2 : 0 } })
  }
  if (path === 'create') { const r = row(server.nextId++, { ...body, type: body.type || server.types[0].id, fields: body.fields || {} }); server.rows.unshift(r); return respond(200, { ok: true, row: r }) }
  if (path === 'update') { const r = server.rows.find((x) => x.id === body.id); Object.assign(r, body.patch); return respond(200, { ok: true, row: r }) }
  if (path === 'archive') { const r = server.rows.find((x) => x.id === body.id); r.archived_at = '2026-10-29T11:00:00.000Z'; return respond(200, { ok: true, row: r }) }
  if (path === 'restore') { const r = server.rows.find((x) => x.id === body.id); r.archived_at = null; return respond(200, { ok: true, row: r }) }
  if (path === 'clear-demo') { server.rows = server.rows.filter((r) => !r.demo); return respond(200, { ok: true, removed: {} }) }
  return respond(404, { ok: false })
}
const registered = []
let menuRows = []
let slotCalls = []
globalThis.document = { getElementById: () => null, createElement: () => ({ setAttribute () {}, remove () {} }), head: { appendChild () {} }, activeElement: null, addEventListener () {}, removeEventListener () {}, contains: () => false }
let loaded = null
const lite = createLite()
const { React } = lite
const h = React.createElement
const windowObject = {
  __ModuleLoader__: { load: (entry) => { loaded = entry } },
  __KB_LANG_RESOLVE__: () => language,
  localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)) } },
  __KB_MENU__: { register: (entry) => { menuRows.push(entry); registered.push(entry); return () => { menuRows = menuRows.filter((x) => x !== entry) } } },
  __KB_HELP__: { Help: (props) => h('span', { 'data-kb': 'help-pill', 'data-help-id': props.id }) },
}
globalThis.window = windowObject

const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
// eslint-disable-next-line no-new-func
new Function('window', 'document', source)(windowObject, globalThis.document)

// ── the contract with the loader ───────────────────────────────────────────────────────────────────
ok('client.js hands the loader one entry named for the package', loaded !== null && loaded.id === '@local/kybernos-catalog' && typeof loaded.factory === 'function')
const plugin = loaded.factory((name) => { if (name === 'react') return React; throw new Error('unexpected require ' + name) })
ok('the factory returns a plugin that waits for `slots` and has an apply', typeof plugin.apply === 'function' && Array.isArray(plugin.inject) && plugin.inject.indexOf('slots') >= 0 && plugin.name === 'kybernos-catalog')
const quietWarn = (fn) => { const warn = console.warn; console.warn = () => {}; try { return fn() } finally { console.warn = warn } }
ok('a factory whose require fails still returns a plugin (and does not throw)', quietWarn(() => { const p = loaded.factory(() => { throw new Error('no react') }); return typeof p === 'object' && typeof p.apply === 'function' && p.apply() === undefined }))
ok('a React that breaks while the factory runs still gives a plugin', quietWarn(() => { const p = loaded.factory(() => ({ createElement: null, useState: null })); return typeof p.apply === 'function' }))
ok('no colour of its own: tokens only', !/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(source) && /var\(--dsw-alias-/.test(source))
ok('no label of its own outside kt(): every aria-label, title and placeholder is a call or a variable', !/'aria-label': '|placeholder: '|title: '[A-Za-z]/.test(source.replace(/data-kb': '[^']*'/g, '')))
const hooks = ['catalog-page', 'catalog-title', 'catalog-new', 'catalog-card', 'catalog-row', 'catalog-chip', 'catalog-archived', 'catalog-panel', 'catalog-edit', 'catalog-archive', 'catalog-restore', 'catalog-close', 'catalog-dialog', 'catalog-save', 'catalog-cancel', 'catalog-demo-banner', 'catalog-demo-clear', 'catalog-empty', 'catalog-error', 'catalog-retry', 'catalog-loading', 'catalog-flag', 'catalog-toast', 'catalog-undo', 'catalog-more']
ok('the data-kb hooks the live check selects on exist', hooks.every((k) => source.includes("'" + k + "'")), hooks.filter((k) => !source.includes("'" + k + "'")).join())

// ── apply: the row, the page, the styles; and what happens without the core's seams ────────────────────
{
  const effects = []
  const slotsSvc = { inject: (name, fn) => { slotCalls.push(['inject', name]); fn(); return () => slotCalls.push(['uninject', name]) }, register: (opts, comp) => { slotCalls.push(['register', opts, comp]); return () => {} } }
  const ctx = { effect: (fn, label) => { const c = fn(); effects.push({ label, cleanup: c }) }, slots: slotsSvc }
  plugin.apply(ctx)
  ok('apply declares the menu row with the documented entry', menuRows.length === 1 && JSON.stringify(menuRows[0]) === JSON.stringify({ id: 'catalog', group: 'business', icon: 'package', labelKey: 'business.catalog', label: { en: 'Catalog', fr: 'Catalogue' }, order: 20 }), JSON.stringify(menuRows[0]))
  const reg = slotCalls.find((c) => c[0] === 'register')
  ok('the page mounts on the keyed business slot with the key of its row', reg !== undefined && reg[1].name === 'main.kybernos-business' && reg[1].key === 'catalog' && typeof reg[2] === 'function')
  ok('every effect has a label', effects.length === 3 && effects.every((e) => /^kybernos-catalog: /.test(e.label)))
  effects.forEach((e) => { if (typeof e.cleanup === 'function') e.cleanup() })
  ok('the cleanup takes the row back and the page off', menuRows.length === 0 && slotCalls.some((c) => c[0] === 'uninject'))
  // The core builds its menu registry when ITS client is applied, which (measured in a sandbox) is after this plugin's apply: the row waits for it.
  const realSetTimeout = globalThis.setTimeout
  const realClearTimeout = globalThis.clearTimeout
  const timers = []
  globalThis.setTimeout = (fn, ms) => { timers.push({ fn, ms, live: true }); return timers.length }
  globalThis.clearTimeout = (id) => { if (timers[id - 1]) timers[id - 1].live = false }
  const tick = () => { const t = timers.filter((x) => x.live).pop(); if (!t) return false; t.live = false; t.fn(); return true }
  try {
    const registry = windowObject.__KB_MENU__
    windowObject.__KB_MENU__ = undefined
    const cleanups = []
    plugin.apply({ effect: (fn) => { cleanups.push(fn()) }, slots: slotsSvc })
    ok('a core without the registry yet: no row, no throw, the page still mounts, and the row waits (every 150 ms)', menuRows.length === 0 && cleanups.length === 3 && timers.filter((x) => x.live).length === 1 && timers[0].ms === 150)
    tick()
    ok('it keeps waiting while the registry is absent', menuRows.length === 0 && timers.filter((x) => x.live).length === 1)
    windowObject.__KB_MENU__ = registry
    tick()
    ok('the registry shows up late: the row is declared then, and the wait stops', menuRows.length === 1 && menuRows[0].id === 'catalog' && timers.filter((x) => x.live).length === 0)
    cleanups.forEach((c) => { if (typeof c === 'function') c() })
    ok('the cleanup takes a late row back', menuRows.length === 0)

    timers.length = 0
    windowObject.__KB_MENU__ = undefined
    const early = []
    plugin.apply({ effect: (fn) => { early.push(fn()) }, slots: slotsSvc })
    early.forEach((c) => { if (typeof c === 'function') c() })
    windowObject.__KB_MENU__ = registry
    ok('a plugin switched off before the registry came never declares a row, and its wait is cancelled', timers.filter((x) => x.live).length === 0 && menuRows.length === 0)

    timers.length = 0
    windowObject.__KB_MENU__ = undefined
    const patient = []
    plugin.apply({ effect: (fn) => { patient.push(fn()) }, slots: slotsSvc })
    let laps = 0
    while (tick() && laps < 500) laps += 1
    ok('it gives up after about 15 s (100 tries) when the registry never comes', laps >= 99 && laps <= 101 && timers.filter((x) => x.live).length === 0 && menuRows.length === 0, 'laps ' + laps)
    patient.forEach((c) => { if (typeof c === 'function') c() })
    windowObject.__KB_MENU__ = registry
  } finally { globalThis.setTimeout = realSetTimeout; globalThis.clearTimeout = realClearTimeout }
  windowObject.__KB_MENU__ = { register: () => { throw new Error('boom') } }
  ok('a registry that throws does not stop apply', (() => { try { plugin.apply({ effect: (fn) => { fn() }, slots: slotsSvc }); return true } catch (e) { return false } })())
  windowObject.__KB_MENU__ = { register: (entry) => { menuRows.push(entry); registered.push(entry); return () => { menuRows = menuRows.filter((x) => x !== entry) } } }
  ok('apply with a context that cannot work does not throw', (() => { const warn = console.warn; console.warn = () => {}; try { plugin.apply({}); plugin.apply(undefined); return true } catch (e) { return false } finally { console.warn = warn } })())
}

// ── the pure helpers ──────────────────────────────────────────────────────────────────────────────
const T = plugin.__test
{
  language = 'en'
  const lowStock = row(1, { title: 'Apron', subtitle: 'x', price_text: '€39', fields: { sku: 'A-1', stock: 3, price: 39 } })
  const c = T.cardOf(PRODUCT, lowStock)
  ok('a card shows the fields its type names: title, the sku as subtitle, the price field formatted', c.title === 'Apron' && c.subtitle === 'A-1' && /39/.test(c.price) && c.price.includes('€'), JSON.stringify(c))
  ok('the flag shows when the number crosses the threshold, with {n} filled', c.flag === 'Only 3 left')
  ok('no flag above the threshold, without the field or with a non-number', T.cardOf(PRODUCT, row(2, { fields: { stock: 50 } })).flag === null && T.cardOf(PRODUCT, row(3)).flag === null && T.cardOf(PRODUCT, row(4, { fields: { stock: 'x' } })).flag === null)
  ok('a gte flag works too', T.flagText({ card: { flag: { field: 'n', gte: 5, label: L('{n}+') } } }, row(5, { fields: { n: 7 } })) === '7+')
  language = 'fr'
  ok('the flag and the labels come in the person\'s language', T.cardOf(PRODUCT, lowStock).flag === 'Plus que 3' && T.pick(L('A', 'B')) === 'B' && T.pick(L('A')) === 'A' && T.pick(null, 'z') === 'z')
  language = 'en'
  const generic = T.cardOf(null, row(6, { type: 'old', title: 'Orphan', subtitle: 'sub', price_text: '12', fields: { sku: 'z' } }))
  ok('a row of a type no theme defines is a generic card: its own lines only', generic.title === 'Orphan' && generic.subtitle === 'sub' && generic.price === '12' && generic.flag === null)
  ok('a status the type does not know has no tone and shows its key', T.statusOf(PRODUCT, row(7, { status: 'gone' })) === null && T.humanize('on_hold') === 'On hold')
  ok('values by kind', T.valueText({ type: 'date' }, '2026-12-31').includes('2026') && T.valueText({ type: 'number' }, 1234) === '1,234' && T.valueText(null, 5) === '5' && T.valueText({ type: 'text' }, '') === '' && T.valueText({ type: 'money', currency: 'EUR' }, 9.5).includes('9.50'))
  ok('views: the union of the types in view, or the type\'s own', T.viewsOf([PRODUCT, JOB], '').join() === 'cards,list' && T.viewsOf([PRODUCT, JOB], 'job').join() === 'list' && T.viewsOf([], '').join() === 'cards,list')
  const chips = T.chipsOf([PRODUCT, JOB], '', { live: 2, open: 1 }, false)
  ok('status chips: the union by key, with the counts of the same search', chips.map((x) => x.key).join() === 'live,low,out,open,filled' && chips[0].count === 2 && chips[1].count === 0 && T.chipsOf([PRODUCT], '', {}, true)[0].count === null)
  ok('the title is the plural of the only theme type, else Catalog', T.pageTitle([PRODUCT], 'theme') === 'Products' && T.pageTitle([PRODUCT, JOB], 'theme') === 'Catalog' && T.pageTitle([DEFAULT], 'default') === 'Catalog')
  ok('the new button names the only type, in both languages, with no article to get wrong', T.newLabel([PRODUCT]) === 'New product' && T.newLabel([DEFAULT]) === 'New item' && T.newLabel([PRODUCT, JOB]) === 'New' && (() => { language = 'fr'; const x = T.newLabel([PRODUCT]); language = 'en'; return x === 'Ajouter · Produit' })())
  ok('every error code and the signed-out statuses have words', ['base_missing', 'sqlite_unavailable', 'busy', 'unknown_type', 'unknown_status', 'bad_field', 'missing_field', 'not_found', 'x'].every((c) => T.errorText(c, 200).length > 10) && T.errorText('', 401).toLowerCase().includes('session') && T.errorText('', 0).length > 10)
  const form = T.formOf(PRODUCT, lowStock)
  ok('the form of a row holds strings; a blank form starts on the first status', form.title === 'Apron' && form.fields.stock === '3' && form.fields.size === '' && T.formOf(PRODUCT, null).status === 'live')
  form.fields.stock = '4,5'; form.fields.size = 'm'; form.fields.sku = ''
  const sent = T.payloadOf(PRODUCT, form, true)
  ok('the body of an update: numbers parsed (a comma too), empty values clear, no type on an edit', sent.ok === true && sent.body.fields.stock === 4.5 && sent.body.fields.sku === null && sent.body.fields.size === 'm' && sent.body.type === undefined && sent.body.title === 'Apron')
  form.fields.stock = 'many'
  ok('a number field that is not a number is caught before sending', T.payloadOf(PRODUCT, form, true).ok === false && T.payloadOf(PRODUCT, form, true).field === 'stock')
  ok('creating sends the type; a row of an unknown type sends only its own lines', T.payloadOf(PRODUCT, T.formOf(PRODUCT, null), false).body.type === 'product' && JSON.stringify(Object.keys(T.payloadOf(null, T.formOf(PRODUCT, null), true).body)) === '["title","subtitle","price_text"]')
}

// ── the page ──────────────────────────────────────────────────────────────────────────────────────
const Page = T.CatalogPage
const bar = (calls2) => ({ KbToolbar: (props) => { calls2.push(props); return h('div', { 'data-kb': 'toolbar' }, props.trailing) } })
const mountPage = async (props) => { const root = lite.mount(h(Page, props || { toolbar: null })); await root.settle(); return root }
const by = (root, kb, extra) => lite.find(root.tree, (n) => n.props['data-kb'] === kb && (extra === undefined || extra(n)))
const click = async (root, node) => { await node.props.onClick({ preventDefault () {}, stopPropagation () {}, target: node, currentTarget: node }); await root.settle() }
const type = async (root, node, value) => { node.props.onChange({ target: { value } }); await root.settle() }
const submit = async (root, kb) => { const f = by(root, kb)[0]; await f.props.onSubmit({ preventDefault () {} }); await root.settle() }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const DEMO = [row(1, { title: 'Linen apron', status: 'low', demo: true, fields: { sku: 'A-1', stock: 3, price: 39 } }), row(2, { title: 'Oak board', status: 'live', demo: true, fields: { sku: 'B-2', stock: 40, price: 95 } }), row(3, { title: 'Out chair', status: 'out', fields: { sku: 'C-3', stock: 0, price: 120 } })]

{
  server.reset([PRODUCT], 'theme', DEMO.map((r) => ({ ...r })))
  const bars = []
  const root = lite.mount(h(Page, { toolbar: bar(bars) }))
  ok('before the first answer the page says it is loading (a status, not an empty page)', by(root, 'catalog-loading').length === 1 && by(root, 'catalog-empty').length === 0)
  await root.settle()
  ok('the list is asked with the session cookie (same-origin credentials)', calls.length >= 2 && calls.every((c) => c.credentials === 'same-origin'))
  ok('the title is the theme\'s plural and the help pill is mounted with the plugin\'s id', lite.textOf(by(root, 'catalog-title')[0]) === 'Products' && by(root, 'help-pill')[0].props['data-help-id'] === 'kybernos-catalog')
  ok('three cards, with a neutral picture each, the status tag and the card flag of the type (stock 3 and 0 are under its threshold of 10)', by(root, 'catalog-card').length === 3 && by(root, 'catalog-picture').length === 3 && by(root, 'catalog-flag').length === 2 && lite.textOf(by(root, 'catalog-flag')[0]) === 'Only 3 left' && lite.textOf(by(root, 'catalog-flag')[1]) === 'Only 0 left')
  ok('the sample rows carry the « demo » badge and the banner offers to clear them', by(root, 'catalog-demo-badge').length === 2 && by(root, 'catalog-demo-banner').length === 1)
  ok('the status tags carry the theme\'s tones', by(root, 'catalog-status').map((n) => n.props.className).join('|').includes('warn') && by(root, 'catalog-status').some((n) => n.props.className.includes('bad')) && by(root, 'catalog-status').some((n) => n.props.className.includes('ok')))
  ok('status chips: All and the three statuses with their counts', by(root, 'catalog-chip').length === 4 && lite.textOf(by(root, 'catalog-chip')[0]).includes('3') && lite.textOf(by(root, 'catalog-chip', (n) => n.props['data-status'] === 'low')[0]).includes('1'))
  ok('the product\'s own toolbar is used: the views with their names, a sort, the star, the add button as its trailing action', bars.length > 0 && bars[bars.length - 1].viewLabels === true && bars[bars.length - 1].showFav === true && bars[bars.length - 1].sortOptions.map((o) => o.id).join() === 'modified,price,name' && bars[bars.length - 1].views.join() === 'cards,list' && by(root, 'catalog-new').length === 1 && by(root, 'catalog-own-bar').length === 0)
  const lastBar = () => bars[bars.length - 1]
  ok('the price of a card is the formatted price field', lite.textOf(by(root, 'catalog-price')[0]).includes('39'))

  // filter by status
  const before = calls.length
  await click(root, by(root, 'catalog-chip', (n) => n.props['data-status'] === 'out')[0])
  await sleep(10); await root.settle()
  ok('a status chip filters on the host (status=out) and is pressed', calls.slice(before).some((c) => /status=out/.test(c.url)) && by(root, 'catalog-card').length === 1 && by(root, 'catalog-chip', (n) => n.props['data-status'] === 'out')[0].props['aria-pressed'] === 'true')
  await click(root, by(root, 'catalog-chip', (n) => n.props['data-status'] === 'out')[0])
  await sleep(10); await root.settle()
  ok('pressing it again clears the filter', by(root, 'catalog-card').length === 3)

  // search (debounced)
  lastBar().onUpdate({ query: 'oak' })
  await root.settle(); await sleep(300); await root.settle()
  ok('typing in the bar searches after a short pause (q=oak)', calls.some((c) => /q=oak/.test(c.url)) && by(root, 'catalog-card').length === 1)
  lastBar().onUpdate({ query: 'zzz' })
  await root.settle(); await sleep(300); await root.settle()
  ok('a search that finds nothing says so and offers to clear (not "nothing here yet")', by(root, 'catalog-empty')[0].props['data-why'] === 'filter' && by(root, 'catalog-clear-filters').length === 1)
  await click(root, by(root, 'catalog-clear-filters')[0])
  await sleep(10); await root.settle()
  ok('clearing brings every card back', by(root, 'catalog-card').length === 3 && by(root, 'catalog-empty').length === 0)

  // view switch
  lastBar().onUpdate({ viewMode: 'list' })
  await root.settle()
  ok('the Note column is there when a row has a flag', lite.find(root.tree, (n) => n.tag === 'th').length === 4)
  ok('the list view draws a table row per item and the choice is kept for next time', by(root, 'catalog-row').length === 3 && by(root, 'catalog-cards').length === 0 && store.get('kybernos.catalog.view.v1') === 'list')
  ok('a row is reachable by keyboard: focusable, Enter opens it', by(root, 'catalog-row')[0].props.tabIndex === 0 && typeof by(root, 'catalog-row')[0].props.onKeyDown === 'function')
  by(root, 'catalog-row')[1].props.onKeyDown({ key: 'Enter', preventDefault () {}, target: 'x', currentTarget: 'x' })
  await root.settle()
  ok('Enter on a row opens its panel', by(root, 'catalog-panel').length === 1 && by(root, 'catalog-panel')[0].props['data-id'] === 2)
  lastBar().onUpdate({ viewMode: 'cards' })
  await root.settle()

  // panel
  await click(root, by(root, 'catalog-card-open')[0])
  const panel = by(root, 'catalog-panel')[0]
  ok('a card opens the details panel: close, edit, archive; the fields the type defines', panel !== undefined && by(root, 'catalog-close').length === 1 && by(root, 'catalog-edit').length === 1 && by(root, 'catalog-archive').length === 1 && lite.textOf(panel).includes('SKU'))
  ok('the panel is a labelled landmark and its card is marked current', panel.props['aria-label'].length > 0 && by(root, 'catalog-card')[0].props['aria-current'] === 'true')
  await click(root, by(root, 'catalog-close')[0])
  ok('close puts the panel away', by(root, 'catalog-panel').length === 0)

  // edit
  await click(root, by(root, 'catalog-card-open')[0])
  await click(root, by(root, 'catalog-edit')[0])
  ok('a type whose card reads its price and its subtitle from fields does not ask for the item\'s own price and subtitle (two prices would be two answers)', (await click(root, by(root, 'catalog-edit')[0]), true) && by(root, 'catalog-field-price_text').length === 0 && by(root, 'catalog-field-subtitle').length === 0 && by(root, 'catalog-field-price').length === 1)
  await click(root, by(root, 'catalog-cancel')[0])
  await click(root, by(root, 'catalog-edit')[0])
  ok('edit opens a dialog with a title, a status and the type\'s fields, named for assistive tech', by(root, 'catalog-dialog').length === 1 && by(root, 'catalog-dialog')[0].props['aria-modal'] === 'true' && by(root, 'catalog-dialog')[0].props['data-mode'] === 'edit' && by(root, 'catalog-field-title')[0].props.value === 'Linen apron' && by(root, 'catalog-field-stock').length === 1 && by(root, 'catalog-field-status').length === 1)
  await type(root, by(root, 'catalog-field-title')[0], 'Linen apron XL')
  await type(root, by(root, 'catalog-field-stock')[0], '8')
  await submit(root, 'catalog-dialog')
  const upd = calls.filter((c) => /\/update$/.test(c.url)).pop()
  ok('saving sends the id and a patch with the parsed number, then closes and says it saved', upd !== undefined && upd.body.id === 1 && upd.body.patch.title === 'Linen apron XL' && upd.body.patch.fields.stock === 8 && by(root, 'catalog-dialog').length === 0 && by(root, 'catalog-toast').length === 1)

  // archive + undo
  await click(root, by(root, 'catalog-archive')[0])
  ok('archive sends the id, closes the panel and offers Undo', calls.some((c) => /\/archive$/.test(c.url) && c.body.id === 1) && by(root, 'catalog-panel').length === 0 && by(root, 'catalog-undo').length === 1)
  await click(root, by(root, 'catalog-undo')[0])
  ok('Undo restores it', calls.some((c) => /\/restore$/.test(c.url) && c.body.id === 1) && server.rows.find((r) => r.id === 1).archived_at === null)
  await click(root, by(root, 'catalog-card-open')[2])
  await click(root, by(root, 'catalog-archive')[0])
  await click(root, by(root, 'catalog-archived')[0])
  ok('the archived view lists archived rows (archived=only) and offers Restore', calls.some((c) => /archived=only/.test(c.url)) && by(root, 'catalog-card').length === 1 && by(root, 'catalog-chip').length === 0)
  await click(root, by(root, 'catalog-card-open')[0])
  ok('an archived item cannot be edited, only restored', by(root, 'catalog-edit').length === 0 && by(root, 'catalog-restore').length === 1)
  await click(root, by(root, 'catalog-restore')[0])
  ok('restore from the panel sends the id', calls.filter((c) => /\/restore$/.test(c.url)).length === 2)
  ok('the empty archive says so', by(root, 'catalog-empty')[0].props['data-why'] === 'archived')
  await click(root, by(root, 'catalog-archived')[0])

  // new
  await click(root, by(root, 'catalog-new')[0])
  ok('new opens an empty dialog on the first status', by(root, 'catalog-dialog')[0].props['data-mode'] === 'new' && by(root, 'catalog-field-title')[0].props.value === '' && by(root, 'catalog-field-status')[0].props.value === 'live' && by(root, 'catalog-field-type').length === 0)
  await submit(root, 'catalog-dialog')
  ok('an empty title is refused in the form, with an alert, and nothing is sent', by(root, 'catalog-title-error').length === 1 && by(root, 'catalog-title-error')[0].props.role === 'alert' && by(root, 'catalog-field-title')[0].props['aria-invalid'] === 'true' && !calls.some((c) => /\/create$/.test(c.url)))
  await type(root, by(root, 'catalog-field-title')[0], 'New stool')
  await type(root, by(root, 'catalog-field-stock')[0], 'lots')
  await submit(root, 'catalog-dialog')
  ok('a number field that is not a number stops the save', by(root, 'catalog-dialog').length === 1 && !calls.some((c) => /\/create$/.test(c.url)))
  await type(root, by(root, 'catalog-field-stock')[0], '2')
  await type(root, by(root, 'catalog-field-status')[0], 'low')
  server.fail = { status: 200, json: { ok: false, error: 'bad_field' } }
  await submit(root, 'catalog-dialog')
  ok('a refusal from the host stays in the dialog, in words', by(root, 'catalog-dialog').length === 1 && by(root, 'catalog-form-error').length === 1)
  server.fail = null
  await submit(root, 'catalog-dialog')
  const created = calls.filter((c) => /\/create$/.test(c.url)).pop()
  ok('create sends the type, the status and the fields, and the new row opens in the panel', created.body.type === 'product' && created.body.title === 'New stool' && created.body.status === 'low' && created.body.fields.stock === 2 && by(root, 'catalog-dialog').length === 0 && by(root, 'catalog-panel').length === 1)
  await click(root, by(root, 'catalog-close')[0])

  // clear the sample data
  await click(root, by(root, 'catalog-demo-clear')[0])
  ok('clearing sample data asks first, in an alert dialog that can be cancelled', by(root, 'catalog-confirm').length === 1 && by(root, 'catalog-confirm')[0].props.role === 'alertdialog' && !calls.some((c) => /clear-demo/.test(c.url)))
  await click(root, by(root, 'catalog-confirm-cancel')[0])
  ok('cancel leaves everything', by(root, 'catalog-confirm').length === 0 && !calls.some((c) => /clear-demo/.test(c.url)))
  await click(root, by(root, 'catalog-demo-clear')[0])
  await click(root, by(root, 'catalog-confirm-ok')[0])
  ok('confirm sends { confirm: true }; the sample rows and the banner go, mine stay', calls.some((c) => /clear-demo/.test(c.url) && c.body.confirm === true) && by(root, 'catalog-demo-banner').length === 0 && by(root, 'catalog-demo-badge').length === 0 && by(root, 'catalog-card').length === 2)
  root.unmount()
}

// ── paging ──────────────────────────────────────────────────────────────────────────────────────────
{
  server.reset([PRODUCT], 'theme', Array.from({ length: 130 }, (_, i) => row(i + 1, { title: 'Bulk ' + i })))
  const root = await mountPage()
  ok('100 rows at a time and a "show more" with the count', by(root, 'catalog-card').length === 100 && by(root, 'catalog-more').length === 1 && lite.textOf(by(root, 'catalog-more')[0]).includes('100 / 130'))
  await click(root, by(root, 'catalog-more-btn')[0])
  ok('show more appends the rest and the control goes', by(root, 'catalog-card').length === 130 && by(root, 'catalog-more').length === 0 && calls.some((c) => /offset=100/.test(c.url)))
  root.unmount()
}

// ── states: empty, errors, generic rows, several types, the default type ─────────────────────────────
{
  server.reset([PRODUCT], 'theme', [])
  let root = await mountPage()
  ok('no item at all: an inviting empty state with a way to add one, no status chips to filter nothing, and the archive still reachable', by(root, 'catalog-empty')[0].props['data-why'] === 'empty' && by(root, 'catalog-empty-new').length === 1 && by(root, 'catalog-demo-banner').length === 0 && by(root, 'catalog-chip').length === 0 && by(root, 'catalog-archived').length === 1)
  await click(root, by(root, 'catalog-empty-new')[0])
  ok('the empty state\'s button opens the new dialog', by(root, 'catalog-dialog').length === 1)
  root.unmount()

  server.reset([PRODUCT], 'theme', DEMO)
  server.fail = { status: 503, json: { ok: false, error: 'the DSH session secret cannot be read, so this write stays closed' } }
  root = await mountPage()
  ok('a signed-out page says the session ended, with a retry, and no empty state', by(root, 'catalog-error').length === 1 && lite.textOf(by(root, 'catalog-error')[0]).toLowerCase().includes('session') && by(root, 'catalog-retry').length === 1 && by(root, 'catalog-empty').length === 0 && by(root, 'catalog-error')[0].props.role === 'alert')
  ok('with nothing loaded, "new" is off', by(root, 'catalog-new')[0].props.disabled === true)
  root.unmount()

  server.fail = 'throw'
  root = await mountPage()
  ok('a server that does not answer is said as such', by(root, 'catalog-error').length === 1 && lite.textOf(by(root, 'catalog-error')[0]).length > 20)
  server.fail = null
  await click(root, by(root, 'catalog-retry')[0])
  ok('Try again recovers once the server answers', by(root, 'catalog-error').length === 0 && by(root, 'catalog-card').length === 3)
  root.unmount()

  // base missing only on the list (types need no base)
  server.reset([PRODUCT], 'theme', DEMO)
  const real = globalThis.fetch
  globalThis.fetch = async (url, init) => (/\/list/.test(url) ? respond(200, { ok: false, error: 'base_missing' }) : real(url, init))
  root = await mountPage()
  ok('the shared base missing is explained in words, not an empty page', by(root, 'catalog-error')[0].props['data-code'] === 'base_missing' && lite.textOf(by(root, 'catalog-error')[0]).toLowerCase().includes('not available'))
  root.unmount()
  globalThis.fetch = real

  // an item whose type no theme defines
  server.reset([PRODUCT], 'theme', [row(1, { type: 'old-kind', status: 'retired', title: 'Orphan', price_text: '€5', fields: { legacy: 'kept', sku: 'z' } }), row(2, { title: 'Known', fields: { sku: 'K' } })])
  root = await mountPage()
  ok('a row of an unknown type is a generic card, flagged data-known=no, with its raw status as a neutral tag', by(root, 'catalog-card').length === 2 && by(root, 'catalog-card')[0].props['data-known'] === 'no' && lite.textOf(by(root, 'catalog-status')[0]) === 'Retired')
  await click(root, by(root, 'catalog-card-open')[0])
  ok('its panel lists what is stored, as written', lite.textOf(by(root, 'catalog-panel')[0]).includes('Legacy') && lite.textOf(by(root, 'catalog-panel')[0]).includes('kept'))
  await click(root, by(root, 'catalog-edit')[0])
  ok('editing it offers only its own lines, and says why', by(root, 'catalog-field-status').length === 0 && by(root, 'catalog-field-stock').length === 0 && by(root, 'catalog-generic-note').length === 1)
  root.unmount()

  // the view the person left on the other template (the map of the agency) is not one of this type's: the bar says which one is shown
  server.reset([PRODUCT], 'theme', DEMO.map((r) => ({ ...r })))
  const saved = []
  const mapBar = { KbToolbar: (props) => { saved.push(props); return h('div', { 'data-kb': 'toolbar' }, props.trailing) }, useToolbarState: () => [{ query: '', sort: 'modified', dir: 'desc', types: [], period: 'all', fav: false, viewMode: 'map' }, () => {}] }
  const stale = lite.mount(h(Page, { toolbar: mapBar }))
  await stale.settle()
  ok('a saved map view that this type does not offer: the cards are shown and the bar says « cards », not a view that no button is on', by(stale, 'catalog-card').length === 3 && saved.length > 0 && saved.every((p) => p.state.viewMode === 'cards') && saved[saved.length - 1].views.join() === 'cards,list')
  stale.unmount()

  // several types
  server.reset([PRODUCT, JOB], 'theme', [row(1, { title: 'Chair' }), row(2, { type: 'job', status: 'open', title: 'Carpenter' })])
  const bars = []
  root = lite.mount(h(Page, { toolbar: bar(bars) }))
  await root.settle()
  ok('several types: a chip per type, the title stays Catalog, the views are the union', by(root, 'catalog-type-chip').length === 3 && lite.textOf(by(root, 'catalog-title')[0]) === 'Catalog' && bars[bars.length - 1].views.join() === 'cards,list')
  await click(root, by(root, 'catalog-type-chip', (n) => n.props['data-type'] === 'job')[0])
  await sleep(10); await root.settle()
  ok('choosing a type filters on the host and narrows the views to that type\'s (list only: no switch to cards)', calls.some((c) => /type=job/.test(c.url)) && by(root, 'catalog-row').length === 1 && by(root, 'catalog-cards').length === 0 && bars[bars.length - 1].views.join() === 'list')
  await click(root, by(root, 'catalog-new')[0])
  ok('with several types the new dialog asks for the type first', by(root, 'catalog-field-type').length === 1 && by(root, 'catalog-field-type')[0].props.children.length === 2)
  root.unmount()

  // the default type (no theme): the plain page
  server.reset([DEFAULT], 'default', [row(1, { type: 'item', status: 'draft', title: 'Plain thing' })])
  root = await mountPage()
  ok('without a theme: the page is called Catalog and the button says New item', lite.textOf(by(root, 'catalog-title')[0]) === 'Catalog' && lite.textOf(by(root, 'catalog-new')[0]).includes('New item'))
  ok('without the product\'s toolbar the page draws a bar of its own, made of the core\'s toolbar pieces: a magnifier, a view group, the primary action', by(root, 'catalog-own-bar').length === 1 && by(root, 'catalog-own-bar')[0].props.className === 'kb6-toolbar' && by(root, 'catalog-search-toggle').length === 1 && by(root, 'catalog-view').length === 2 && by(root, 'catalog-new').length === 1)
  await click(root, by(root, 'catalog-search-toggle')[0])
  ok('the magnifier opens the search field, which searches', by(root, 'catalog-search').length === 1 && by(root, 'catalog-search-toggle').length === 0)
  await type(root, by(root, 'catalog-search')[0], 'plain')
  await sleep(300); await root.settle()
  ok('typing searches (q=plain) and a clear button empties it', calls.some((c) => /q=plain/.test(c.url)) && by(root, 'catalog-search-clear').length === 1)
  await click(root, by(root, 'catalog-search-clear')[0])
  await sleep(300); await root.settle()
  ok('clearing closes the field again (the magnifier is back)', by(root, 'catalog-search-toggle').length === 1 && by(root, 'catalog-search-clear').length === 0)
  await click(root, by(root, 'catalog-view', (n) => n.props['data-view'] === 'list')[0])
  ok('the plain bar switches views', by(root, 'catalog-row').length === 1)
  root.unmount()

  // French
  language = 'fr'
  server.reset([PRODUCT], 'theme', DEMO)
  root = await mountPage()
  ok('in French the page speaks French (button, chips, banner)', lite.textOf(by(root, 'catalog-new')[0]).includes('Ajouter') && lite.textOf(by(root, 'catalog-chip')[0]).includes('Tous') && lite.textOf(by(root, 'catalog-demo-banner')[0]).includes('exemple') && lite.textOf(by(root, 'catalog-title')[0]) === 'Produits' && lite.textOf(by(root, 'catalog-archived')[0]).includes('archives'))
  root.unmount()
  language = 'en'
}

// ── pictures, chips, the shortlist, the sort and the map ────────────────────────────────────────────────────
const HOME = {
  id: 'property', label: L('Property'), plural: L('Properties'), icon: 'home',
  statuses: [{ key: 'for-sale', tone: 'ok', label: L('For sale') }, { key: 'sold', tone: 'neutral', label: L('Sold') }],
  fields: [{ key: 'surface', type: 'number', label: L('Surface (m²)') }, { key: 'rooms', type: 'number', label: L('Rooms') }, { key: 'energy', type: 'choice', options: ['A', 'B', 'C', 'D', 'E', 'F', 'G'], label: L('Energy') }, { key: 'kind', type: 'choice', options: ['House', 'Loft'], label: L('Kind') },
    { key: 'price', type: 'money', currency: 'EUR', label: L('Price') }, { key: 'image', type: 'text', label: L('Picture') }, { key: 'lat', type: 'number', label: L('Latitude') }, { key: 'lng', type: 'number', label: L('Longitude') }],
  card: { title: 'title', subtitle: 'subtitle', price: 'price', image: 'image', chips: ['kind', 'surface', 'rooms', 'energy'] }, map: { lat: 'lat', lng: 'lng' }, views: ['cards', 'list', 'map'],
}
const homeRow = (id, over) => row(id, Object.assign({ type: 'property', status: 'for-sale', price_num: 300000 + id * 1000, price_text: '€' + (300000 + id * 1000), fields: { surface: 60 + id, rooms: 3, energy: 'C', kind: 'House', price: 300000 + id * 1000, image: 'photo:real-estate/willow-lane', lat: 46.2 + id / 1000, lng: 6.14 + id / 800 } }, over))
{
  language = 'en'
  ok('a photograph reference is read, a drawn one too; anything else is no picture', T.pictureRef(HOME, homeRow(1)) === 'photo:real-estate/willow-lane' && T.pictureRef(PRODUCT, row(1)) === '' && T.pictureRef(null, row(1)) === '')
  ok('an item with no picture of its own falls back to the drawing that goes with its type', T.fallbackArt(HOME, homeRow(7)) === 'art:house/7' && T.fallbackArt(PRODUCT, row(8)) === 'art:box/8' && T.fallbackArt(null, row(9)) === 'art:box/9')
  ok('an energy class runs from green to red, and only a choice of the letters A to G does', T.energyHue(HOME.fields[2], 'A') === 146 && T.energyHue(HOME.fields[2], 'G') === 4 && T.energyHue(HOME.fields[3], 'House') === undefined && T.energyHue(null, 'A') === undefined && T.energyHue(HOME.fields[2], 'Z') === undefined)
  ok('a number is a stat with the unit of its label (« 68 m² ») or the label (« 3 rooms »); money is money', T.statText(HOME.fields[0], 68) === '68 m²' && T.statText(HOME.fields[1], 3) === '3 rooms' && T.statText(HOME.fields[4], 385000).includes('385,000'))
  const chips = T.cardChips(HOME, homeRow(2))
  ok('the chips follow the type: tags for choices (energy coloured), stats for numbers, in the order the type gives', chips.map((c) => c.key).join() === 'kind,surface,rooms,energy' && chips[0].stat === false && chips[1].stat === true && chips[1].icon === 'ruler' && chips[3].hue === 90 && T.cardChips(PRODUCT, row(1)).length === 0)
  ok('a chip with no value is left out, and a field the type lost too', T.cardChips(HOME, homeRow(3, { fields: { kind: 'Loft' } })).map((c) => c.key).join() === 'kind' && T.cardChips({ ...HOME, card: { chips: ['gone'] } }, homeRow(3)).length === 0)
  ok('a pin says the price short: €385k, €1.45M, €780', T.pinPrice({ price_num: 385000, price_text: '€385,000' }) === '€385k' && T.pinPrice({ price_num: 1450000, price_text: '€1,450,000' }) === '€1.45M' && T.pinPrice({ price_num: 780, price_text: '€780 / month' }) === '€780' && T.pinPrice({ price_num: null, price_text: 'On request' }) === 'On' && T.pinPrice({ price_num: null, price_text: '' }) === '…')
  const rows3 = [homeRow(1), homeRow(2), homeRow(3, { fields: { kind: 'Loft' } }), row(4)]
  const placed = T.placedRows(rows3, [HOME, PRODUCT])
  ok('only the items that say where they are are on the map (two numbers, in range); the others are counted apart', placed.length === 2 && T.placedRows([homeRow(1, { fields: { lat: 'x', lng: 1 } }), homeRow(2, { fields: { lat: 95, lng: 1 } })], [HOME]).length === 0)
  const pins = T.projectPins(T.placedRows([homeRow(1), homeRow(40), homeRow(80)], [HOME]), 1000, 720)
  ok('the pins fill the map inside its margins, north up and east right', pins.length === 3 && pins.every((q) => q.x > 60 && q.x < 940 && q.y > 50 && q.y < 670) && pins[2].x > pins[0].x && pins[2].y < pins[0].y && T.projectPins([]).length === 0 && T.projectPins(T.placedRows([homeRow(1)], [HOME]))[0].x === 500)
  ok('the sort is on the loaded rows: the host\'s order is « modified », price and name are asked for, ascending or descending', T.sortRows([homeRow(3), homeRow(1), homeRow(2)], 'price', 'asc').map((r) => r.id).join() === '1,2,3' && T.sortRows([homeRow(3), homeRow(1), homeRow(2)], 'price', 'desc').map((r) => r.id).join() === '3,2,1' && T.sortRows([homeRow(3, { title: 'b' }), homeRow(1, { title: 'a' })], 'name', 'asc')[0].id === 1 && T.sortRows([homeRow(3), homeRow(1)], 'modified', 'desc').map((r) => r.id).join() === '3,1')
  ok('the map is one of the views only for a type that has it', T.viewsOf([HOME], '').join() === 'cards,list,map' && T.viewsOf([HOME, PRODUCT], 'product').join() === 'cards,list' && T.viewsOf([HOME, PRODUCT], '').join() === 'cards,list,map')
  ok('the town behind the pins is drawn from its seed: the same each time, parks among the blocks', T.townBlocks(5).length > 300 && JSON.stringify(T.townBlocks(5)) === JSON.stringify(T.townBlocks(5)) && JSON.stringify(T.townBlocks(5)) !== JSON.stringify(T.townBlocks(6)) && T.townBlocks(5).some((b) => b.park))
}
{
  server.reset([HOME], 'theme', [homeRow(1), homeRow(2, { title: 'Cheap one', price_num: 100000, fields: { price: 100000, image: 'art:villa/two', kind: 'Loft', lat: 46.19, lng: 6.13 } }), homeRow(3, { title: 'Zebra loft', status: 'sold' })])
  store.clear()
  windowObject.__KB_BIZ_KIT__ = { v: 1, artOk: (x) => /^art:/.test(x), Art: (props) => h('svg', { 'data-art': props.spec }), Tag: (props) => h('span', { 'data-kb': 'kit-tag', 'data-text': props.text }), Icon: (name) => h('svg', { 'data-icon': name }), tint: () => 0 }
  const bars = []
  const root = lite.mount(h(Page, { toolbar: bar(bars) }))
  await root.settle()
  const pics = by(root, 'catalog-picture').map((n) => n.props['data-picture'])
  ok('a photograph is an image served by the core, a drawn picture is drawn, and each card says which it is', pics.join() === 'photo,art,photo' && by(root, 'catalog-picture')[0].children.some((c) => c.tag === 'img' && c.props.src === '/kybernos/themes/photo?id=real-estate%2Fwillow-lane' && c.props.loading === 'lazy'))
  ok('every card has its chips (the tags through the kit, the stats as plain text) and a price at the bottom', by(root, 'catalog-chips').length === 3 && by(root, 'kit-tag').length === 5 && by(root, 'catalog-stat').length === 4 && by(root, 'catalog-stats').length === 2 && by(root, 'catalog-price').length === 3)
  ok('a card is an article with its own open button and a heart beside it (a button inside a button is not a thing)', by(root, 'catalog-card')[0].tag === 'article' && by(root, 'catalog-card-open')[0].tag === 'button' && by(root, 'catalog-heart')[0].tag === 'button' && by(root, 'catalog-card-open')[0].children.every((c) => c.props === undefined || c.props['data-kb'] !== 'catalog-heart'))
  await click(root, by(root, 'catalog-heart')[1])
  ok('the heart shortlists the item, says so (pressed), keeps it in this browser, and does not open the card', by(root, 'catalog-heart')[1].props['aria-pressed'] === 'true' && by(root, 'catalog-panel').length === 0 && store.get('kybernos.catalog.shortlist.v1') === '[2]')
  bars[bars.length - 1].onUpdate({ fav: true })
  await root.settle()
  ok('the star shows the shortlist only, and says so when it is empty of matches', by(root, 'catalog-card').length === 1 && by(root, 'catalog-card')[0].props['data-id'] === 2)
  bars[bars.length - 1].onUpdate({ fav: false, sort: 'price', dir: 'asc' })
  await root.settle()
  ok('the sort puts the cheapest first', by(root, 'catalog-card').map((n) => n.props['data-id']).join() === '2,1,3')
  bars[bars.length - 1].onUpdate({ viewMode: 'map' })
  await root.settle()
  ok('the map view: the cards beside a map, one pin per item that has a place, with its price, as a keyboard-reachable button', by(root, 'catalog-split').length === 1 && by(root, 'catalog-map').length === 1 && by(root, 'catalog-pin').length === 3 && by(root, 'catalog-pin')[0].props.tabIndex === 0 && by(root, 'catalog-pin')[0].props.role === 'button' && /€/.test(lite.textOf(by(root, 'catalog-pin')[0])) && by(root, 'catalog-map-note').length === 1 && store.get('kybernos.catalog.view.v1') === 'map')
  by(root, 'catalog-pin')[0].props.onMouseEnter()
  await root.settle()
  ok('a pin lit by the pointer lights its card too, and goes out with it', by(root, 'catalog-card').some((n) => /hot/.test(n.props.className)) && by(root, 'catalog-pin').some((n) => /\bon\b/.test(n.props.className)))
  by(root, 'catalog-pin')[0].props.onMouseLeave()
  await root.settle()
  const firstPin = by(root, 'catalog-pin').find((n) => true)
  firstPin.props.onKeyDown({ key: 'Enter', preventDefault () {}, target: 'x', currentTarget: 'x' })
  await root.settle()
  ok('Enter on a pin opens the item, as a panel above the cards, never over the map', by(root, 'catalog-panel').length === 1 && /inline/.test(by(root, 'catalog-panel')[0].props.className) && by(root, 'catalog-split').length === 1)
  await click(root, by(root, 'catalog-map-zoom-in')[0])
  await click(root, by(root, 'catalog-map-fit')[0])
  ok('the zoom buttons and « show everything » are there and do not break the map', by(root, 'catalog-map').length === 1 && by(root, 'catalog-map-zoom-out').length === 1)
  language = 'fr'
  await root.settle()
  root.unmount()
  language = 'en'
  delete windowObject.__KB_BIZ_KIT__
  const bare = lite.mount(h(Page, { toolbar: null }))
  await bare.settle()
  ok('without the shared kit the page still draws: a neutral tile for a picture, plain chips', by(bare, 'catalog-card').length === 3 && by(bare, 'catalog-picture').every((n) => n.props['data-picture'] !== 'art') && by(bare, 'catalog-chips').length === 3)
  bare.unmount()
  store.clear()
}
{
  // a type whose card names its company (`card.company`): the line that holds the company's name is led by the kit's drawn mark
  const HIRE = { id: 'hire', label: L('Job'), plural: L('Jobs'), icon: 'briefcase', statuses: [{ key: 'open', tone: 'ok', label: L('Open') }], fields: [{ key: 'client', type: 'text', label: L('Client') }], card: { title: 'title', subtitle: 'client', company: 'client' }, views: ['cards', 'list'] }
  server.reset([HIRE], 'theme', [row(1, { type: 'hire', title: 'Data engineer', status: 'open', fields: { client: 'Brightwell Analytics' } }), row(2, { type: 'hire', title: 'Designer', status: 'open', fields: { client: '' } })])
  store.clear()
  windowObject.__KB_BIZ_KIT__ = { v: 1, artOk: () => false, Art: () => null, Tag: (props) => h('span', { 'data-kb': 'kit-tag', 'data-text': props.text }), Icon: (name) => h('svg', { 'data-icon': name }), tint: () => 0, Logo: (props) => h('span', { 'data-kb': 'kit-logo', 'data-name': props.name, 'data-size': String(props.size) }) }
  const root = lite.mount(h(Page, { toolbar: null }))
  await root.settle()
  ok('a card whose type names its company leads the company line with the drawn mark, and a card with no company line draws none', by(root, 'catalog-company').length === 1 && by(root, 'kit-logo').length === 1 && by(root, 'kit-logo')[0].props['data-name'] === 'Brightwell Analytics' && by(root, 'catalog-company')[0].children.some((c) => c.props !== undefined && c.props['aria-hidden'] === 'true'))
  await click(root, by(root, 'catalog-card-open')[0])
  ok('and so does the panel of the item', by(root, 'catalog-panel').length === 1 && lite.find(by(root, 'catalog-panel')[0], (n) => n.props['data-kb'] === 'kit-logo').length === 1)
  root.unmount()
  delete windowObject.__KB_BIZ_KIT__.Logo
  const older = lite.mount(h(Page, { toolbar: null }))
  await older.settle()
  ok('a kit with no Logo (an older core) leaves the plain line', by(older, 'catalog-company').length === 0 && by(older, 'catalog-card').length === 2 && by(older, 'catalog-card')[0].children.length > 0)
  older.unmount()
  delete windowObject.__KB_BIZ_KIT__
  store.clear()
}

if (failed > 0) { console.log('test-client: ' + failed + ' failure(s)'); process.exit(1) }
console.log('test-client: all green')
