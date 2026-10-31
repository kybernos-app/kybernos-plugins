// kybernos-db, browser half: its pure parts (words, the filter tree, sorts, views, the board and the calendar, what Kaby's change looks like), its registration (the menu row inside
// apply and taken back by the cleanup; the page on the keyed slot), each piece of the page rendered to a plain tree and read by its `data-kb` hooks, and the static promises a
// browser would only break late (DSH's tokens only, the page asks its own host only, the core is imported from the host). Outside a browser: a fake loader and a small React
// whose hooks keep their first value and whose function components are called down to plain elements. The page as a whole is checked on the real GUI (scripts/check-tables-live.mjs).
//
//   node packages/kybernos-db/test-client.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as core from './core/index.mjs'

let failed = 0
const ok = (label, fn) => { try { fn(); console.log('  ok   ' + label) } catch (e) { failed += 1; console.log('  FAIL ' + label + ' — ' + (e && e.message)) } }
const okAsync = async (label, fn) => { try { await fn(); console.log('  ok   ' + label) } catch (e) { failed += 1; console.log('  FAIL ' + label + ' — ' + (e && e.message)) } }

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
globalThis.document = { documentElement: { clientWidth: 1200 } }
await import(new URL('./client.js', import.meta.url).href)

// ── a small React: elements are plain objects, function components are called down to host elements, hooks keep their first value ─────────────────────────────────────────
const FRAGMENT = Symbol('fragment')
const el = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false) })
const React = {
  createElement: el, Fragment: FRAGMENT,
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
  useRef: (v) => ({ current: v === undefined ? null : v }),
  useMemo: (fn) => fn(), useCallback: (fn) => fn(), useEffect: () => {}, useLayoutEffect: () => {},
}
const render = (node) => {
  if (node === null || node === undefined || node === false || node === true) return []
  if (typeof node === 'string' || typeof node === 'number') return [String(node)]
  if (Array.isArray(node)) return node.flatMap(render)
  if (typeof node.type === 'function') {
    const kids = node.children
    return render(node.type(Object.assign({}, node.props, kids.length === 0 ? {} : { children: kids.length === 1 ? kids[0] : kids })))
  }
  if (node.type === FRAGMENT) return node.children.flatMap(render)
  return [{ type: node.type, props: node.props, children: node.children.flatMap(render) }]
}
const tree = (node) => ({ type: 'root', props: {}, children: render(node) })
const walk = (t, fn) => { if (typeof t === 'string') return; fn(t); for (const c of t.children) walk(c, fn) }
const all = (t, pred) => { const out = []; walk(t, (n) => { if (pred(n)) out.push(n) }); return out }
const kb = (t, hook) => all(t, (n) => n.props['data-kb'] === hook)
const text = (t) => (typeof t === 'string' ? t : t.children.map(text).join(''))
const click = (n, e) => n.props.onClick(e || { stopPropagation () {}, preventDefault () {}, shiftKey: false })

const plugin = definition.factory((name) => { if (name === 'react') return React; throw new Error('unexpected require ' + name) })
const T = plugin.__test
T.useCore(core)
const Page = T.build(React)
const P = Page.parts

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const field = (key, type, label, extra) => Object.assign({ key, type, label, required: false, protection: 'normal' }, extra || {})
const STATUS = [{ key: 'todo', label: 'To do', color: 'gray' }, { key: 'doing', label: 'Doing', color: 'blue' }, { key: 'done', label: 'Done', color: 'green' }]
const TASK = {
  key: 'task', label: 'Tasks', title: 'name',
  fields: [
    field('name', 'text', 'Name', { required: true }), field('status', 'choice', 'Status', { options: STATUS }), field('due', 'date', 'Due'),
    field('amount', 'money', 'Amount', { currency: 'EUR', precision: 2 }), field('email', 'email', 'Email', { protection: 'personal' }), field('token', 'text', 'Token', { protection: 'secret' }),
    field('tags', 'multichoice', 'Tags', { options: [{ key: 'a', label: 'Alpha' }, { key: 'b', label: 'Beta' }] }), field('flag', 'checkbox', 'Flag'),
    field('project', 'relation', 'Project', { to: 'project', many: false }), field('files', 'attachment', 'Files', { maxBytes: 1000 }),
  ],
}
const PROJECT = { key: 'project', label: 'Projects', title: 'name', fields: [field('name', 'text', 'Name', { required: true })] }
const view = (extra) => Object.assign({ id: 'v1', name: 'Open', kind: 'table', owner: 'me', fav: true, state: { flt: core.blankFilter(), sorts: [], hidden: [] } }, extra || {})
const rec = (id, values) => ({ id, values, rev: 1, created: { by: 'person', at: '2026-10-30T09:00:00.000Z' }, modified: { by: 'person', at: '2026-10-30T10:00:00.000Z' }, deleted: null }) // the shape the host sends: a stamp is { by, at }
const ROWS = [
  rec('r1', { name: 'Write the brief', status: 'doing', due: '2026-11-04', amount: 12.5, email: 'a@b.co', token: 'sekret', tags: ['a'], flag: true, project: 'p1' }),
  rec('r2', { name: 'Ship it', status: 'todo', due: '2026-10-31', amount: 1200 }),
  rec('r3', { name: 'Old thing', status: 'done', due: '2026-09-02' }),
  rec('r4', { name: 'Nothing set' }),
]
const CTX = T.makeCtx('2026-10-30', [TASK, PROJECT], { project: [rec('p1', { name: 'Launch' })] })
const calls = []
const spy = (name) => (...args) => { calls.push([name, ...args]); return undefined }
const pageApi = (extra) => {
  const v = (extra && extra.view) || view()
  return Object.assign({
    dbs: [], archived: [], templates: null, fold: false, dialog: null, relTab: false,
    db: { id: 'db1', name: 'Home', objects: [TASK, PROJECT] }, obj: TASK, view: v, views: [v], rows: ROWS, all: ROWS, rec: { status: 'ok', truncated: false, rows: ROWS }, ctx: CTX, related: { project: [rec('p1', { name: 'Launch' })] },
    flt: v.state.flt, menu: null, drawer: null, query: '', months: {},
    setMenu: spy('setMenu'), setFlt: spy('setFlt'), editView: spy('editView'), sortBy: spy('sortBy'), filterBy: spy('filterBy'), clearAll: spy('clearAll'), selectView: spy('selectView'),
    favView: spy('favView'), askKaby: spy('askKaby'), say: spy('say'), openRecord: spy('openRecord'), closeDrawer: spy('closeDrawer'), setMonth: spy('setMonth'),
    openTable: spy('openTable'), openApp: spy('openApp'), goGallery: spy('goGallery'), newApp: spy('newApp'), setFold: spy('setFold'),
    confirmArchive: spy('confirmArchive'), confirmDelete: spy('confirmDelete'), restoreApp: spy('restoreApp'), restoreTable: spy('restoreTable'),
    closeDialog: spy('closeDialog'), runDialog: spy('runDialog'), openTemplate: spy('openTemplate'), setTemplateOpt: spy('setTemplateOpt'),
    hosting: null, syncBusy: '', openPublish: spy('openPublish'), retryPublish: spy('retryPublish'), pickHost: spy('pickHost'), orderComputer: spy('orderComputer'), openUnpublish: spy('openUnpublish'), startForget: spy('startForget'), openWeb: spy('openWeb'), refreshNow: spy('refreshNow'),
  }, extra || {})
}
/** The view a function handed to `editView` would produce from the current one. */
const edited = (callIndex, from) => { const c = calls.filter((x) => x[0] === 'editView')[callIndex]; return c[1](JSON.parse(JSON.stringify(from))) }

console.log('── loading ──')
ok('the client loads in the module-loader format and returns a plugin that asks for the slots service', () => {
  assert.ok(definition !== null)
  assert.equal(definition.id, '@local/kybernos-db')
  assert.equal(plugin.name, 'kybernos-db'); assert.deepEqual(plugin.inject, ['slots']); assert.equal(typeof plugin.apply, 'function')
})
ok('a factory that cannot even start still returns a plugin, and does not throw', () => {
  const warn = console.warn
  const broken = definition.factory(() => { throw new Error('no react') })
  assert.equal(typeof broken.apply, 'function')
  console.warn = () => {}
  try { assert.doesNotThrow(() => broken.apply({ slots: { inject () {} }, effect () {} })) } finally { console.warn = warn }
})

console.log('── registration ──')
const mount = () => {
  const effects = []
  const registered = []
  plugin.apply({ effect: (fn, label) => { effects.push({ fn, label }) }, slots: { inject: (name, fn) => { registered.push({ name, entry: fn() }); return () => {} }, register: (opts, component) => ({ opts, component }) } })
  return { effects, registered }
}
ok('apply declares the menu row inside an effect and the cleanup takes it back', () => {
  menuCalls.length = 0; menuOff = 0
  const { effects } = mount()
  assert.equal(menuCalls.length, 0, 'nothing is declared outside an effect')
  const row = effects.find((e) => /menu row/.test(e.label))
  assert.ok(row !== undefined)
  const cleanup = row.fn()
  assert.deepEqual(menuCalls, [{ id: 'tables', group: 'business', icon: 'grid', labelKey: 'business.apps', label: { en: 'Apps', fr: 'Apps' }, order: 40 }])
  cleanup(); cleanup()
  assert.equal(menuOff, 1, 'the disposer the menu gave is the one the cleanup calls, once')
})
ok('the page is mounted on the keyed business slot with the id of the row as its key', () => {
  const { effects, registered } = mount()
  const page = effects.find((e) => /page/.test(e.label))
  assert.ok(page !== undefined)
  page.fn()
  assert.equal(registered.length, 1)
  assert.equal(registered[0].name, 'main.kybernos-business')
  assert.deepEqual(registered[0].entry.opts, { name: 'main.kybernos-business', key: 'tables' })
})
ok('the menu row waits for the registry when it is not there yet, and gives up cleanly', () => {
  const saved = window.__KB_MENU__
  window.__KB_MENU__ = undefined
  const timers = []
  const realSet = globalThis.setTimeout
  globalThis.setTimeout = (fn) => { timers.push(fn); return timers.length }
  try {
    const { effects } = mount()
    const cleanup = effects.find((e) => /menu row/.test(e.label)).fn()
    assert.equal(timers.length, 1, 'one retry is planned')
    window.__KB_MENU__ = saved
    menuCalls.length = 0
    timers[0]()
    assert.equal(menuCalls.length, 1, 'the row is declared as soon as the registry shows')
    cleanup()
  } finally { globalThis.setTimeout = realSet; window.__KB_MENU__ = saved }
})

console.log('── words ──')
ok('every operator has words in both languages, and the numbers read as signs', () => {
  for (const [lang, expect] of [['en', 'is not empty'], ['fr', 'n’est pas vide']]) {
    resolved = lang
    assert.equal(T.opLabel(TASK.fields[0], 'nempty'), expect)
    for (const f of TASK.fields) for (const op of core.opsFor(f)) { const w = T.opLabel(f, op); assert.ok(typeof w === 'string' && w !== '', f.key + '/' + op) }
  }
  resolved = 'en'
  assert.equal(T.opLabel(TASK.fields[3], 'ge'), '≥')
  assert.equal(T.opLabel(TASK.fields[9], 'empty'), 'has no file')
  assert.equal(T.opLabel(TASK.fields[6], 'in'), 'has any of')
  assert.equal(T.opLabel(TASK.fields[1], 'in'), 'is any of')
})
ok('a condition reads as a sentence: field, operator, value in the person\'s words', () => {
  const txt = (c) => T.conditionText(TASK, c, CTX)
  assert.equal(txt({ k: 'status', op: 'is', v: 'doing' }), 'Status is Doing')
  assert.equal(txt({ k: 'status', op: 'nin', v: ['done', 'todo'] }), 'Status is none of Done, To do')
  assert.equal(txt({ k: 'due', op: 'within', v: 'next7' }), 'Due is within the next 7 days')
  assert.equal(txt({ k: 'due', op: 'before', v: { n: 0 } }), 'Due is before today')
  assert.equal(txt({ k: 'due', op: 'after', v: { n: -7 } }), 'Due is after 7 days ago')
  assert.equal(txt({ k: 'due', op: 'is', v: { d: '2026-11-04' } }).startsWith('Due is '), true)
  assert.equal(txt({ k: 'name', op: 'contains', v: 'brief' }), 'Name contains brief')
  assert.equal(txt({ k: 'email', op: 'empty' }), 'Email is empty')
  assert.equal(txt({ k: 'flag', op: 'checked' }), 'Flag is checked')
  assert.equal(txt({ k: 'project', op: 'is', v: 'p1' }), 'Project is Launch')
  assert.equal(txt({ k: 'ghost', op: 'contains', v: 'x' }), 'ghost contains x', 'a damaged condition still draws')
  assert.equal(T.itemText(TASK, { conj: 'or', items: [{ k: 'status', op: 'is', v: 'todo' }, { k: 'flag', op: 'checked' }] }, CTX), '(Status is To do or Flag is checked)')
  resolved = 'fr'
  assert.equal(txt({ k: 'status', op: 'is', v: 'doing' }), 'Status est Doing')
  assert.equal(T.relDay(1), 'demain'); assert.equal(T.relDay(-30), 'il y a 30 jours')
  resolved = 'en'
})
ok('a value is spelled the way the person reads it, and a secret is never spelled out', () => {
  const t = (f, v) => T.cellText(TASK.fields.find((x) => x.key === f), v, CTX)
  assert.equal(t('amount', 1200), '€1,200.00')
  assert.equal(t('status', 'done'), 'Done')
  assert.equal(t('tags', ['a', 'b']), 'Alpha, Beta')
  assert.equal(t('flag', true), 'Yes')
  assert.equal(t('flag', false), '')
  assert.equal(t('project', 'p1'), 'Launch')
  assert.equal(t('files', [{ name: 'a.pdf', size: 1, type: 'application/pdf', hash: 'x' }]), '1 file')
  assert.equal(t('token', 'sekret'), T.MASK)
  assert.equal(t('token', null), '')
  assert.equal(t('name', null), '')
})
ok('a link shows « … » while its table is being read, and a removed link says so', () => {
  const loading = T.makeCtx('2026-10-30', [TASK, PROJECT], {})
  assert.equal(loading.label(TASK.fields[8], 'p1'), '…')
  assert.equal(CTX.label(TASK.fields[8], 'gone'), 'Removed link')
  assert.equal(CTX.label(TASK.fields[1], 'todo'), 'todo', 'only links are looked up')
})

console.log('── links between tables ──')
const CUSTOMER = { key: 'customer', label: 'Customers', title: 'name', fields: [field('name', 'text', 'Name', { required: true })] }
const ITEM = { key: 'item', label: 'Products', title: 'name', fields: [field('name', 'text', 'Name', { required: true })] }
const ORDER = {
  key: 'order', label: 'Orders', title: 'ref',
  fields: [field('ref', 'text', 'Reference', { required: true }), field('customer', 'relation', 'Customer', { to: 'customer', many: false, inverse: 'Purchases' }), field('items', 'relation', 'Products', { to: 'item', many: true }), field('lost', 'relation', 'Lost', { to: 'gone', many: false })],
}
const SHOP = [CUSTOMER, ITEM, ORDER]
ok('the links of a database are listed with the name each shows under on the other side, a link to a missing table left out', () => {
  const rels = T.relationFields(SHOP)
  assert.deepEqual(rels.map((r) => r.from + '.' + r.field + '>' + r.to + (r.many ? '*' : '')), ['order.customer>customer', 'order.items>item*'])
  assert.equal(T.seenAs(rels[0]), 'Purchases', 'a named link is seen under its name')
  assert.equal(T.seenAs(rels[1]), 'Orders', 'an unnamed one under the label of the table it comes from')
  assert.deepEqual(T.relationFields([CUSTOMER]), [])
})
ok('the map puts every table once, draws every link from its table to the one it points at, and keeps two links of one pair apart', () => {
  const m = T.mapLayout(SHOP)
  assert.deepEqual(m.nodes.map((n) => n.key), ['customer', 'item', 'order'])
  assert.deepEqual(m.edges.map((e) => e.rel.field), ['customer', 'items'])
  assert.ok(m.edges.every((e) => /^M -?\d/.test(e.d) && Number.isFinite(e.lx) && Number.isFinite(e.ly)))
  assert.ok(m.edges[0].label.endsWith('· 1') && m.edges[1].label.endsWith('· n'), 'one or many is on the label')
  for (const n of m.nodes) assert.ok(n.x > 0 && n.x < m.width && n.y > 0 && n.y < m.height, n.key + ' is inside the map')
  const both = T.mapLayout([CUSTOMER, Object.assign({}, ORDER, { fields: ORDER.fields.concat([field('mirror', 'relation', 'Mirror', { to: 'customer', many: true })]) })])
  const pairEdges = both.edges.filter((e) => e.rel.to === 'customer')
  assert.equal(pairEdges.length, 2); assert.notEqual(pairEdges[0].d, pairEdges[1].d, 'two links between the same two tables are two lines')
  assert.ok(pairEdges.every((e) => e.d.includes(' Q ')), 'and both bend, so neither hides the other')
  const self = T.mapLayout([{ key: 'person', label: 'People', title: 'name', fields: [field('name', 'text', 'Name'), field('boss', 'relation', 'Boss', { to: 'person', many: false })] }])
  assert.equal(self.edges.length, 1); assert.ok(self.edges[0].d.includes(' C '), 'a link to its own table is a loop')
  assert.deepEqual(T.mapLayout([]).edges, []); assert.equal(T.mapLayout([]).nodes.length, 0)
  const wide = T.mapLayout(Array.from({ length: 12 }, (_, i) => ({ key: 't' + i, label: 'T' + i, title: 'name', fields: [] })))
  assert.equal(new Set(wide.nodes.map((n) => n.x + ',' + n.y)).size, 12, 'a dozen tables never share a place')
})
ok('a link chip opens its row when the page can open it, is plain when it cannot, and says a deleted row is gone', () => {
  const link = TASK.fields[8]
  const opened = []
  const ctxOpen = Object.assign({}, CTX, { open: (f, id) => opened.push([f.to, id]) })
  const t = tree(React.createElement(P.LinkChips, { field: link, value: 'p1', ctx: ctxOpen, max: 2 }))
  const chip = kb(t, 'tables-link')[0]
  assert.equal(chip.type, 'button'); assert.equal(chip.props['data-object'], 'project'); assert.equal(chip.props['data-id'], 'p1')
  click(chip)
  assert.deepEqual(opened, [['project', 'p1']])
  assert.equal(kb(tree(React.createElement(P.LinkChips, { field: link, value: 'p1', ctx: CTX, max: 2 })), 'tables-link').length, 0, 'no way to open: a plain chip')
  const gone = tree(React.createElement(P.LinkChips, { field: link, value: 'zz', ctx: ctxOpen, max: 2 }))
  assert.equal(kb(gone, 'tables-link').length, 0); assert.equal(kb(gone, 'tables-link-gone').length, 1); assert.ok(text(gone).includes('Removed link'))
  const loading = T.makeCtx('2026-10-30', [TASK, PROJECT], {})
  loading.open = ctxOpen.open
  assert.equal(kb(tree(React.createElement(P.LinkChips, { field: link, value: 'p1', ctx: loading, max: 2 })), 'tables-link').length, 0, 'a row not read yet is not a button yet')
  const many = tree(React.createElement(P.LinkChips, { field: Object.assign({}, link, { many: true }), value: ['p1', 'p1', 'p1'], ctx: ctxOpen, max: 2 }))
  assert.ok(text(many).includes('+1'))
})

console.log('── the filter tree ──')
ok('a new condition is the first operator of its field with a value that is blank until given', () => {
  const nc = (k) => T.newCondition(TASK.fields.find((f) => f.key === k))
  assert.deepEqual(nc('name'), { k: 'name', op: 'contains', v: '' })
  assert.deepEqual(nc('amount'), { k: 'amount', op: 'eq', v: null })
  assert.deepEqual(nc('due'), { k: 'due', op: 'is', v: { n: 0 } })
  assert.deepEqual(nc('flag'), { k: 'flag', op: 'checked' })
  assert.deepEqual(nc('status'), { k: 'status', op: 'is', v: '' })
  assert.deepEqual(nc('tags'), { k: 'tags', op: 'in', v: [] })
  assert.deepEqual(nc('files'), { k: 'files', op: 'nempty' })
  for (const f of TASK.fields) if (core.opsFor(f).length) assert.ok(core.opsFor(f).includes(T.newCondition(f).op), f.key)
})
ok('changing the operator keeps the value when the new operator takes the same kind of value, else starts again', () => {
  const f = (k) => TASK.fields.find((x) => x.key === k)
  assert.deepEqual(T.withOp(f('name'), { k: 'name', op: 'contains', v: 'abc' }, 'is'), { k: 'name', op: 'is', v: 'abc' })
  assert.deepEqual(T.withOp(f('name'), { k: 'name', op: 'contains', v: 'abc' }, 'empty'), { k: 'name', op: 'empty' })
  assert.deepEqual(T.withOp(f('name'), { k: 'name', op: 'empty' }, 'contains'), { k: 'name', op: 'contains', v: '' })
  assert.deepEqual(T.withOp(f('status'), { k: 'status', op: 'is', v: 'todo' }, 'in'), { k: 'status', op: 'in', v: [] })
  assert.deepEqual(T.withOp(f('due'), { k: 'due', op: 'is', v: { d: '2026-11-04' } }, 'after'), { k: 'due', op: 'after', v: { d: '2026-11-04' } })
  assert.deepEqual(T.withOp(f('due'), { k: 'due', op: 'is', v: { n: 1 } }, 'within'), { k: 'due', op: 'within', v: 'next7' })
  assert.equal(T.valueKind(f('status'), 'in'), 'list'); assert.equal(T.valueKind(f('status'), 'is'), 'one'); assert.equal(T.valueKind(f('tags'), 'all'), 'list'); assert.equal(T.valueKind(f('files'), 'empty'), 'none')
})
ok('every condition a new one gives is sound once it has a value, for every operator of every field', () => {
  for (const f of TASK.fields) for (const op of core.opsFor(f)) {
    const c = T.withOp(f, T.newCondition(f), op)
    const kind = T.valueKind(f, op)
    const given = kind === 'text' ? 'x' : kind === 'number' ? 3 : kind === 'day' ? { n: 2 } : kind === 'within' ? 'past7' : kind === 'one' ? 'k' : kind === 'list' ? ['k'] : undefined
    const full = given === undefined ? { k: f.key, op } : { k: f.key, op, v: given }
    assert.deepEqual(core.checkFilter({ conj: 'and', items: [full] }, TASK.fields), [], f.key + '/' + op)
    assert.equal(c.op, op)
  }
})
ok('the tree is edited without touching the one it was given, at the root and inside a group', () => {
  const flt = { conj: 'and', items: [{ k: 'name', op: 'contains', v: 'a' }, { conj: 'or', items: [{ k: 'flag', op: 'checked' }, { k: 'status', op: 'is', v: 'todo' }] }] }
  const frozen = JSON.stringify(flt)
  assert.deepEqual(T.nodeAt(flt, '1.1'), { k: 'status', op: 'is', v: 'todo' })
  assert.deepEqual(T.removeAt(flt, '1.0').items[1].items, [{ k: 'status', op: 'is', v: 'todo' }])
  assert.equal(T.removeAt(flt, '0').items.length, 1)
  assert.equal(T.addItem(flt, '1', { k: 'due', op: 'empty' }).items[1].items.length, 3)
  assert.equal(T.addItem(flt, '', { k: 'due', op: 'empty' }).items.length, 3)
  assert.equal(T.mapAt(flt, '1', (g) => Object.assign({}, g, { conj: 'and' })).items[1].conj, 'and')
  assert.equal(T.mapAt(flt, '', (g) => Object.assign({}, g, { conj: 'or' })).conj, 'or')
  assert.equal(JSON.stringify(flt), frozen, 'the given tree is unchanged')
  assert.equal(T.countConditions(flt), 3)
})
ok('what is saved holds no half-made condition, and a view is never saved with more sorts than the core allows', () => {
  const v = view({ state: { flt: { conj: 'and', items: [{ k: 'name', op: 'contains', v: '' }, { k: 'status', op: 'is', v: 'doing' }, { k: 'ghost', op: 'is', v: 'x' }] }, sorts: [{ k: 'due', dir: 'asc' }, { k: 'ghost', dir: 'asc' }], hidden: ['email'] } })
  const s = T.savable(v, TASK)
  assert.deepEqual(s.state.flt.items, [{ k: 'status', op: 'is', v: 'doing' }])
  assert.deepEqual(s.state.sorts, [{ k: 'due', dir: 'asc' }])
  assert.deepEqual(s.state.hidden, ['email'])
  assert.equal(v.state.flt.items.length, 3, 'the view given is unchanged')
  assert.deepEqual(core.checkView(T.savable(v, TASK), TASK), [])
})

console.log('── sorts ──')
ok('a column heading sorts ascending, then descending, then off; with shift it adds a sort, up to three', () => {
  assert.deepEqual(T.nextSorts([], 'due', false), [{ k: 'due', dir: 'asc' }])
  assert.deepEqual(T.nextSorts([{ k: 'due', dir: 'asc' }], 'due', false), [{ k: 'due', dir: 'desc' }])
  assert.deepEqual(T.nextSorts([{ k: 'due', dir: 'desc' }], 'due', false), [])
  assert.deepEqual(T.nextSorts([{ k: 'due', dir: 'desc' }], 'name', false), [{ k: 'name', dir: 'asc' }], 'another column replaces the sort')
  assert.deepEqual(T.nextSorts([{ k: 'due', dir: 'asc' }], 'name', true), [{ k: 'due', dir: 'asc' }, { k: 'name', dir: 'asc' }])
  assert.deepEqual(T.nextSorts([{ k: 'due', dir: 'asc' }, { k: 'name', dir: 'asc' }], 'name', true), [{ k: 'due', dir: 'asc' }, { k: 'name', dir: 'desc' }])
  assert.deepEqual(T.nextSorts([{ k: 'due', dir: 'asc' }, { k: 'name', dir: 'desc' }], 'name', true), [{ k: 'due', dir: 'asc' }])
  const three = [{ k: 'a', dir: 'asc' }, { k: 'b', dir: 'asc' }, { k: 'c', dir: 'asc' }]
  assert.deepEqual(T.nextSorts(three, 'd', true), three)
})
ok('the direction is worded by the type of the field', () => {
  assert.deepEqual(T.dirLabels(TASK.fields[0]), ['A → Z', 'Z → A'])
  assert.equal(T.dirLabels(TASK.fields[2])[0], 'Oldest first')
  assert.equal(T.dirLabels(TASK.fields[3])[1], 'High to low')
  assert.equal(T.dirLabels(TASK.fields[7])[0], 'Unchecked first')
  assert.equal(T.dirLabels(TASK.fields[1])[0], 'In the order of the choices')
  assert.deepEqual(T.sortableFields(TASK).map((f) => f.key).includes('files'), false)
})

console.log('── views ──')
ok('a table with no saved view shows a plain table', () => {
  const d = T.defaultView(TASK)
  assert.equal(d.id, 'default-task'); assert.equal(d.kind, 'table'); assert.deepEqual(core.checkView(T.savable(d, TASK), TASK), [])
})
ok('the bar shows the favourites and the view on screen, in the order the views have', () => {
  const vs = [view({ id: 'a', fav: true }), view({ id: 'b', fav: false }), view({ id: 'c', fav: true }), view({ id: 'd', fav: false })]
  assert.deepEqual(T.barViews(vs, 'a').map((v) => v.id), ['a', 'c'])
  assert.deepEqual(T.barViews(vs, 'd').map((v) => v.id), ['a', 'c', 'd'])
})
ok('Kaby\'s changes are told from the person\'s, and from what waits to be saved', () => {
  const o = (rev, by, name) => ({ key: 'task', views: [view({ id: 'v1', name })], stamps: { v1: { rev, by, at: 'x' } } })
  const before = T.viewIndex([o(1, 'person', 'Open')])
  assert.deepEqual(T.agentViewEvents(before, T.viewIndex([o(1, 'person', 'Open')]), new Set()), [], 'nothing moved')
  const changed = T.agentViewEvents(before, T.viewIndex([o(2, 'agent', 'Late')]), new Set())
  assert.equal(changed.length, 1); assert.equal(changed[0].kind, 'changed'); assert.equal(changed[0].view.name, 'Late'); assert.equal(changed[0].before.name, 'Open')
  assert.deepEqual(T.agentViewEvents(before, T.viewIndex([o(2, 'person', 'Late')]), new Set()), [], 'the person\'s own save is not news')
  assert.deepEqual(T.agentViewEvents(before, T.viewIndex([o(2, 'agent', 'Late')]), new Set(['v1'])), [], 'a view with an edit waiting is not announced')
  const made = T.agentViewEvents({}, T.viewIndex([o(1, 'agent', 'New')]), new Set())
  assert.equal(made.length, 1); assert.equal(made[0].kind, 'made')
  assert.deepEqual(T.agentViewEvents({}, T.viewIndex([o(1, 'person', 'New')]), new Set()), [])
  assert.deepEqual(Object.keys(T.viewIndex([{ key: 'x', views: [view({ id: 'q' })] }])), ['q'], 'an object with no stamps still indexes')
})
ok('the sentence for Kaby names the app, the table and the view, and leaves the end to the person', () => {
  const s = T.askAbout({ id: 'db1', name: 'Shop' }, TASK, view({ id: 'v9', name: 'Late' }))
  for (const part of ['Apps page', 'Shop', 'db1', 'Tasks', 'task', 'Late', 'v9']) assert.ok(s.includes(part), part)
  assert.ok(s.endsWith(': '), 'the sentence waits for what the person adds')
  const app = T.askAbout({ id: 'db1', name: 'Shop' }, null, null)
  assert.ok(app.includes('Shop') && !app.includes('table'), 'about the app alone, no table is named')
  assert.ok(T.askAbout({ id: 'db1', name: 'Shop' }, TASK, null).includes('Tasks') && !T.askAbout({ id: 'db1', name: 'Shop' }, TASK, null).includes('view'), 'a table with no view on screen names none')
  resolved = 'fr'
  const f = T.askAbout({ id: 'db1', name: 'Boutique' }, TASK, view({ id: 'v9', name: 'Retards' }))
  assert.ok(f.startsWith('Sur la page Apps, dans mon app « Boutique »') && f.includes('vue « Retards »'))
  resolved = 'en'
  assert.equal(T.buildText(''), 'On the Apps page, I would like to keep track of: ')
  assert.ok(T.buildText('my books').includes('db-builder'))
})
ok('the simple starts are three shapes, each a sentence Kaby builds from, in both languages', () => {
  const en = T.STARTS()
  assert.deepEqual(en.map((x) => x.id), ['contacts', 'tasks', 'collection'])
  assert.ok(en.every((x) => x.name !== '' && x.line !== '' && x.text !== ''))
  resolved = 'fr'
  try { assert.ok(T.STARTS()[1].text.includes('liste de tâches')) } finally { resolved = 'en' }
})
ok('an app has a hue and a letter of its own, the same every time; a name to confirm must be typed exactly', () => {
  assert.equal(T.appHue('db1'), T.appHue('db1')); assert.ok(Number.isFinite(T.appHue('db1')))
  assert.notEqual(new Set(['a1', 'b2', 'c3', 'd4', 'e5', 'f6', 'g7', 'h8'].map(T.appHue)).size, 1, 'apps do not all get one hue')
  assert.equal(T.monogram('  shop'), 'S'); assert.equal(T.monogram('élan'), 'É'); assert.equal(T.monogram(''), '?'); assert.equal(T.monogram('😀 fun'), '😀')
  assert.equal(T.confirmOk('Shop', 'Shop'), true); assert.equal(T.confirmOk('shop', 'Shop'), false, 'a near miss does not delete'); assert.equal(T.confirmOk(' Shop', 'Shop'), false)
  assert.equal(T.confirmOk('', ''), false, 'nothing typed never confirms nothing'); assert.equal(T.confirmOk('x', undefined), false)
  assert.equal(T.rowsIn({ objects: [{ count: 3 }, { count: 4 }, {}] }), 7, 'a table with no count adds nothing')
})
ok('the templates the core offers are read with care: a bad entry is dropped, a good one is cut to size', () => {
  assert.equal(T.templateOf(null), null); assert.equal(T.templateOf({ id: '', name: 'x' }), null); assert.equal(T.templateOf({ id: 'a' }), null)
  const t = T.templateOf({ id: 'shop', name: 'Shop', line: 'Sell things', tag: 'Retail', extras: 'a dashboard', tables: ['Contacts', '', 3, 'Orders'], have: true, appId: 'db9', evil: '<b>' })
  assert.deepEqual(t, { id: 'shop', name: 'Shop', line: 'Sell things', tag: 'Retail', extras: 'a dashboard', tables: ['Contacts', 'Orders'], have: true, appId: 'db9' })
  assert.deepEqual(T.templateOf({ id: 'a', name: 'A' }), { id: 'a', name: 'A', line: '', tag: '', extras: '', tables: [], have: false, appId: null })
  assert.equal(T.templateOf({ id: 'a', name: 'x'.repeat(500) }).name.length, 80)
  assert.equal(T.tplSeam(), null, 'no seam, no templates')
  window.__KB_TEMPLATES__ = { list () {}, add () {} }
  try { assert.equal(typeof T.tplSeam().add, 'function') } finally { delete window.__KB_TEMPLATES__ }
  window.__KB_TEMPLATES__ = { list () {} }
  try { assert.equal(T.tplSeam(), null, 'half a seam is none') } finally { delete window.__KB_TEMPLATES__ }
})

console.log('── board and calendar ──')
ok('a board has a column per option and one for the rows with none', () => {
  const cols = T.boardColumns(TASK.fields[1], ROWS)
  assert.deepEqual(cols.map((c) => [c.key, c.rows.length]), [['todo', 1], ['doing', 1], ['done', 1], ['', 1]])
  assert.equal(cols[3].label, 'No status')
  assert.equal(T.boardColumns(TASK.fields[1], ROWS.slice(0, 3)).length, 3, 'no « none » column when every row has one')
})
ok('the calendar shows six weeks, Monday first, and moves from month to month across the year', () => {
  const g = T.monthGrid('2026-10')
  assert.equal(g.length, 42)
  assert.equal(g[0].iso, '2026-09-28'); assert.equal(g[0].out, true)
  assert.equal(g.find((d) => d.iso === '2026-10-01').out, false)
  assert.equal(g.filter((d) => !d.out).length, 31)
  assert.equal(T.shiftMonth('2026-12', 1), '2027-01'); assert.equal(T.shiftMonth('2026-01', -1), '2025-12'); assert.equal(T.shiftMonth('2026-10', -12), '2025-10')
  assert.equal(T.monthOf('2026-10-30'), '2026-10')
  assert.equal(T.monthGrid('2026-02').filter((d) => !d.out).length, 28)
})

console.log('── the page, piece by piece ──')
ok('the bar has the views, four menus and the table menu, each with a hook, and nothing that writes a row', () => {
  const t = tree(React.createElement(P.Bar, { p: pageApi() }))
  for (const hook of ['tables-bar', 'tables-menu-views', 'tables-menu-fields', 'tables-menu-filter', 'tables-menu-sort', 'tables-menu-topt']) assert.equal(kb(t, hook).length, 1, hook)
  for (const gone of ['tables-menu-modify', 'tables-new']) assert.equal(kb(t, gone).length, 0, gone + ' is gone: Kaby changes rows')
  assert.equal(kb(t, 'tables-view').length, 1)
  click(kb(t, 'tables-menu-filter')[0]); click(kb(t, 'tables-view')[0])
  assert.deepEqual(calls.splice(0).map((c) => c[0]), ['setMenu', 'selectView'])
})
ok('a badge counts what is active, and a calendar has no fields menu', () => {
  const v = view({ state: { flt: { conj: 'and', items: [{ k: 'status', op: 'is', v: 'todo' }, { k: 'flag', op: 'checked' }] }, sorts: [{ k: 'due', dir: 'asc' }], hidden: ['email', 'token', 'tags'] } })
  const t = tree(React.createElement(P.Bar, { p: pageApi({ view: v }) }))
  const badge = (hook) => text(kb(t, hook)[0]).replace(/\D+/g, ' ').trim()
  assert.equal(badge('tables-menu-filter'), '2'); assert.equal(badge('tables-menu-sort'), '1'); assert.equal(badge('tables-menu-fields'), '3')
  const cal = tree(React.createElement(P.Bar, { p: pageApi({ view: view({ kind: 'calendar', date: 'due' }) }) }))
  assert.equal(kb(cal, 'tables-menu-fields').length, 0)
})
ok('only the open menu draws its panel, and it is labelled as a dialog', () => {
  for (const id of ['views', 'fields', 'filter', 'sort', 'topt']) {
    const t = tree(React.createElement(P.Bar, { p: pageApi({ menu: id }) }))
    const pops = all(t, (n) => n.props.role === 'dialog')
    assert.equal(pops.length, 1, id)
    assert.equal(kb(t, 'tables-menu-' + id)[0].props['aria-expanded'], 'true')
  }
  assert.equal(all(tree(React.createElement(P.Bar, { p: pageApi() })), (n) => n.props.role === 'dialog').length, 0)
})
ok('the filter panel draws a row per condition and a group, and a change goes to setFlt as a whole tree', () => {
  const flt = { conj: 'and', items: [{ k: 'status', op: 'is', v: 'todo' }, { conj: 'or', items: [{ k: 'flag', op: 'checked' }, { k: 'name', op: 'contains', v: 'x' }] }] }
  const t = tree(React.createElement(P.FilterPop, { p: pageApi({ flt }) }))
  assert.equal(kb(t, 'tables-cond').length, 3); assert.equal(kb(t, 'tables-group').length, 1)
  assert.deepEqual(kb(t, 'tables-cond').map((n) => n.props['data-path']), ['0', '1.0', '1.1'])
  calls.length = 0
  const first = kb(t, 'tables-cond')[0]
  const opSelect = all(first, (n) => n.type === 'select' && n.props['aria-label'] === 'Operator')[0]
  opSelect.props.onChange({ target: { value: 'isnot' } })
  assert.deepEqual(calls[0][1].items[0], { k: 'status', op: 'isnot', v: 'todo' })
  assert.equal(calls[0][1].items[1].items.length, 2, 'the rest of the tree travels with it')
  const fieldSelect = all(first, (n) => n.type === 'select' && n.props['aria-label'] === 'Field')[0]
  fieldSelect.props.onChange({ target: { value: 'amount' } })
  assert.deepEqual(calls[1][1].items[0], { k: 'amount', op: 'eq', v: null })
  click(kb(t, 'tables-cond-add')[0]); click(kb(t, 'tables-group-add')[0])
  assert.equal(calls[2][1].items.length, 3); assert.deepEqual(calls[3][1].items[2].items.length, 1)
  const values = all(first, (n) => n.type === 'select' && n.props['aria-label'] === 'Value')[0]
  values.props.onChange({ target: { value: 'done' } })
  assert.deepEqual(calls[4][1].items[0], { k: 'status', op: 'is', v: 'done' })
  assert.deepEqual(all(values, (n) => n.type === 'option').map((n) => n.props.value), ['', 'todo', 'doing', 'done'])
  calls.length = 0
})
ok('the value cell fits the type: a text, a number, a day or an exact date, a window, a list; none for an empty test', () => {
  const cell = (k, c) => tree(React.createElement(P.ValueCell, { p: pageApi({ flt: { conj: 'and', items: [c] } }), f: TASK.fields.find((f) => f.key === k), c, path: '0', open: null, setOpen: () => {} }))
  assert.equal(all(cell('name', { k: 'name', op: 'contains', v: 'a' }), (n) => n.type === 'input').length, 1)
  assert.equal(all(cell('amount', { k: 'amount', op: 'gt', v: 3 }), (n) => n.type === 'input' && n.props.inputMode === 'decimal').length, 1)
  assert.equal(all(cell('due', { k: 'due', op: 'is', v: { n: 0 } }), (n) => n.type === 'input').length, 0, 'a relative day is a choice')
  assert.equal(all(cell('due', { k: 'due', op: 'is', v: { d: '2026-11-04' } }), (n) => n.type === 'input' && n.props.type === 'date').length, 1)
  assert.deepEqual(all(cell('due', { k: 'due', op: 'within', v: 'next7' }), (n) => n.type === 'option').map((n) => n.props.value), core.WITHIN)
  assert.equal(all(cell('tags', { k: 'tags', op: 'in', v: ['a'] }), (n) => n.props['aria-expanded'] !== undefined).length, 1)
  assert.equal(all(cell('flag', { k: 'flag', op: 'checked' }), (n) => n.type === 'input' || n.type === 'select').length, 0)
  assert.equal(all(cell('email', { k: 'email', op: 'empty' }), (n) => n.type === 'input' || n.type === 'select').length, 0)
  assert.equal(all(cell('project', { k: 'project', op: 'is', v: '' }), (n) => n.type === 'option').length, 2, 'a link offers the records of its table')
  const day = cell('due', { k: 'due', op: 'is', v: { n: 0 } })
  const sel = all(day, (n) => n.type === 'select')[0]
  assert.ok(sel.props.onChange)
  calls.length = 0
  sel.props.onChange({ target: { value: 'exact' } })
  assert.deepEqual(calls[0][1].items[0].v, { d: '2026-10-30' }, 'an exact date starts at today')
  sel.props.onChange({ target: { value: 'n:7' } })
  assert.deepEqual(calls[1][1].items[0].v, { n: 7 })
  calls.length = 0
})
ok('the sort panel adds a sort on a free field, changes direction and removes; three at most', () => {
  const v = view({ state: { flt: core.blankFilter(), sorts: [{ k: 'due', dir: 'asc' }], hidden: [] } })
  const t = tree(React.createElement(P.SortPop, { p: pageApi({ view: v }) }))
  assert.equal(kb(t, 'tables-sort-row').length, 1)
  click(kb(t, 'tables-sort-add')[0])
  assert.equal(edited(0, v).state.sorts.length, 2)
  const dir = all(kb(t, 'tables-sort-row')[0], (n) => n.type === 'select')[1]
  dir.props.onChange({ target: { value: 'desc' } })
  assert.deepEqual(edited(1, v).state.sorts, [{ k: 'due', dir: 'desc' }])
  const full = view({ state: { flt: core.blankFilter(), sorts: [{ k: 'due', dir: 'asc' }, { k: 'name', dir: 'asc' }, { k: 'amount', dir: 'asc' }], hidden: [] } })
  assert.equal(kb(tree(React.createElement(P.SortPop, { p: pageApi({ view: full }) })), 'tables-sort-add').length, 0)
  calls.length = 0
})
ok('the fields panel hides and shows a field, never the title, and all at once', () => {
  const v = view()
  const t = tree(React.createElement(P.FieldsPop, { p: pageApi({ view: v }) }))
  const sw = kb(t, 'tables-field-switch')
  assert.equal(sw.length, TASK.fields.length)
  assert.equal(sw[0].props.disabled, true, 'the title stays')
  click(sw[4])
  assert.deepEqual(edited(0, v).state.hidden, ['email'])
  const hideAll = all(t, (n) => n.type === 'button' && text(n) === 'Hide all')[0]
  click(hideAll)
  assert.equal(edited(1, v).state.hidden.includes('name'), false)
  assert.equal(edited(1, v).state.hidden.length, TASK.fields.length - 1)
  calls.length = 0
})
ok('the views panel lists the views to choose and pin, and sends a new view, a rename or a removal to Kaby', () => {
  const vs = [view({ id: 'a', name: 'Open' }), view({ id: 'b', name: 'By Kaby', owner: 'kaby', fav: false })]
  const t = tree(React.createElement(P.ViewsPop, { p: pageApi({ view: vs[0], views: vs }) }))
  assert.equal(kb(t, 'tables-view-pick').length, 2)
  assert.equal(all(t, (n) => n.props.title === 'Made by Kaby').length, 1)
  for (const gone of ['tables-view-new-table', 'tables-view-new-board']) assert.equal(kb(t, gone).length, 0, gone)
  assert.equal(all(t, (n) => /^(Rename|Duplicate|Delete) /.test(String(n.props['aria-label'] || ''))).length, 0, 'no rename, duplicate or delete by hand')
  click(kb(t, 'tables-view-pick')[1]); click(kb(t, 'tables-view-fav')[1]); click(kb(t, 'tables-view-ask')[0])
  assert.deepEqual(calls.splice(0).map((c) => c.slice(0, 2)), [['selectView', 'b'], ['favView', 'b'], ['askKaby']])
  assert.equal(kb(t, 'tables-view-fav')[1].props['aria-pressed'], 'false'); assert.equal(kb(t, 'tables-view-fav')[0].props['aria-pressed'], 'true')
})
ok('the table menu offers a chat about the table, and putting it away', () => {
  const open = tree(React.createElement(P.TableMenu, { p: pageApi({ menu: 'topt' }) }))
  assert.equal(kb(open, 'tables-menu-topt')[0].props['aria-expanded'], 'true')
  click(kb(open, 'tables-menu-topt-ask')[0]); click(kb(open, 'tables-menu-topt-archive')[0])
  assert.deepEqual(calls.splice(0).map((c) => c.slice(0, 3)), [['setMenu', null], ['askKaby'], ['setMenu', null], ['confirmArchive', 'db1', 'task']])
  assert.equal(all(tree(React.createElement(P.TableMenu, { p: pageApi() })), (n) => n.props.role === 'menuitem').length, 0, 'closed: no items')
})
ok('a table view draws a header per shown field with sort and filter buttons, and a row per record that opens', () => {
  const v = view({ state: { flt: core.blankFilter(), sorts: [{ k: 'due', dir: 'desc' }], hidden: ['token', 'email'] } })
  const t = tree(React.createElement(P.TableView, { p: pageApi({ view: v }) }))
  const heads = all(t, (n) => n.type === 'th')
  assert.equal(heads.length, TASK.fields.length - 2)
  assert.equal(heads[0].props['aria-sort'], 'none'); assert.equal(heads.find((h) => text(h).startsWith('Due')).props['aria-sort'], 'descending')
  assert.equal(kb(t, 'tables-row').length, ROWS.length)
  click(kb(t, 'tables-th-sort')[0], { shiftKey: true, stopPropagation () {} })
  click(kb(t, 'tables-th-filter')[1])
  click(kb(t, 'tables-row')[0])
  click(kb(t, 'tables-open')[1])
  assert.deepEqual(calls.splice(0), [['sortBy', 'name', true], ['filterBy', 'status'], ['openRecord', 'r1'], ['openRecord', 'r2']])
  const cells = text(kb(t, 'tables-row')[0])
  assert.ok(cells.includes('Write the brief') && cells.includes('Doing') && cells.includes('Launch') && !cells.includes('sekret'))
  const withSecret = tree(React.createElement(P.TableView, { p: pageApi() }))
  assert.equal(text(withSecret).includes('sekret'), false, 'a secret is never in the page text')
  assert.ok(text(withSecret).includes(T.MASK))
})
ok('a table draws 200 rows at a time, and says how many there are', () => {
  const many = Array.from({ length: 450 }, (_, i) => rec('m' + i, { name: 'Row ' + i }))
  const t = tree(React.createElement(P.TableView, { p: pageApi({ rows: many, all: many }) }))
  assert.equal(kb(t, 'tables-row').length, 200)
  assert.equal(kb(t, 'tables-more').length, 1)
  assert.ok(text(t).includes('200 / 450'))
})
ok('a board has its columns and its cards; a card opens its row, and nothing is dragged or added by hand', () => {
  const v = view({ kind: 'board', by: 'status' })
  const t = tree(React.createElement(P.BoardView, { p: pageApi({ view: v }) }))
  const cols = all(t, (n) => n.props['data-col'] !== undefined)
  assert.deepEqual(cols.map((c) => c.props['data-col']), ['todo', 'doing', 'done', ''])
  assert.equal(kb(t, 'tables-card').length, ROWS.length)
  assert.equal(kb(t, 'tables-col-add').length, 0, 'no add button in a column')
  assert.ok(!text(t).includes('sekret'))
  const card = kb(t, 'tables-card')[0]
  assert.equal(card.props.draggable, undefined); assert.equal(card.props.tabIndex, 0)
  click(card); card.props.onKeyDown({ key: 'Enter', target: card, currentTarget: card, preventDefault () {} })
  assert.deepEqual(calls.splice(0), [['openRecord', 'r2'], ['openRecord', 'r2']])
  assert.equal(P.BoardView({ p: pageApi({ view: view({ kind: 'board', by: 'gone' }) }) }), null, 'a board whose field is gone draws nothing instead of throwing')
})
ok('the cards show the first choice as the tone and three more fields', () => {
  const v = view({ kind: 'cards' })
  const t = tree(React.createElement(P.CardsView, { p: pageApi({ view: v }) }))
  const tiles = kb(t, 'tables-card')
  assert.equal(tiles.length, ROWS.length)
  assert.ok(text(tiles[0]).includes('Write the brief') && text(tiles[0]).includes('Doing'))
  click(tiles[1]); assert.deepEqual(calls.splice(0), [['openRecord', 'r2']])
})
ok('a card shows the first picture of the record: as the avatar, or on top when the view is a gallery; a record with none keeps its letter', () => {
  const shown = (extra, rows) => tree(React.createElement(P.CardsView, { p: pageApi({ view: view(Object.assign({ kind: 'cards' }, extra)), rows, ctx: Object.assign({}, CTX, { fileUrl: (f, r, file) => T.fileUrl('db1', 'task', r.id, f, file) }) }) }))
  const photo = { name: 'a.jpg', size: 900, type: 'image/jpeg', hash: 'a'.repeat(64) }
  const pdf = { name: 'b.pdf', size: 900, type: 'application/pdf', hash: 'b'.repeat(64) }
  const withPic = rec('p1', { name: 'Villa', files: [pdf, photo] })
  const without = rec('p2', { name: 'Loft', files: [pdf] })
  const avatar = shown({}, [withPic, without])
  const tiles = kb(avatar, 'tables-card')
  const img = all(tiles[0], (n) => n.type === 'img')
  assert.equal(img.length, 1, 'the picture, not the pdf')
  assert.ok(img[0].props.src.includes('hash=' + photo.hash) && img[0].props.className.includes('kbtb-im'), 'the avatar is the picture')
  assert.equal(all(tiles[1], (n) => n.type === 'img').length, 0); assert.equal(text(all(tiles[1], (n) => String(n.props.className).startsWith('kbtb-im'))[0]), 'L')
  const gallery = shown({ cover: true }, [withPic, without])
  const g = kb(gallery, 'tables-card')
  assert.ok(g[0].props.className.includes('cov') && g[1].props.className.includes('cov'))
  assert.equal(kb(g[0], 'tables-cover').length, 1); assert.equal(all(kb(g[0], 'tables-cover')[0], (n) => n.type === 'img').length, 1)
  assert.equal(all(kb(g[1], 'tables-cover')[0], (n) => n.type === 'img').length, 0); assert.equal(text(kb(g[1], 'tables-cover')[0]), 'L', 'the placeholder keeps the grid even')
  const hidden = shown({ state: { flt: core.blankFilter(), sorts: [], hidden: ['files'] } }, [withPic])
  assert.equal(all(hidden, (n) => n.type === 'img').length, 0, 'a hidden attachment field is not drawn')
  assert.equal(T.pictureOf(TASK, without, []), null); assert.equal(T.pictureOf(TASK, withPic, []).file, photo)
})
ok('a board adds up the first shown, unprotected money field in each column, and leaves it out when there is none', () => {
  const v = view({ kind: 'board', by: 'status' })
  const t = tree(React.createElement(P.BoardView, { p: pageApi({ view: v }) }))
  const sums = kb(t, 'tables-col-total').map(text)
  assert.equal(sums.length, 2, 'only the columns with an amount have a total: To do (1200) and Doing (12.5)')
  assert.ok(sums[0].includes('1,200.00') && sums[1].includes('12.50'), sums.join(' | '))
  const off = tree(React.createElement(P.BoardView, { p: pageApi({ view: view({ kind: 'board', by: 'status', state: { flt: core.blankFilter(), sorts: [], hidden: ['amount'] } }) }) }))
  assert.equal(kb(off, 'tables-col-total').length, 0, 'a hidden money field adds nothing')
  assert.equal(T.totalField({ fields: [field('m', 'money', 'M', { currency: 'EUR', protection: 'personal' })] }, []), undefined, 'a protected one reaches the page masked')
  assert.equal(T.columnTotal(field('m', 'money', 'M', { currency: 'EUR' }), [rec('a', { m: 2.5 }), rec('b', { m: 'x' }), rec('c', {})]), 2.5)
  assert.equal(T.columnTotal(field('m', 'money', 'M', { currency: 'EUR' }), [rec('c', {})]), null, 'no amount, no total')
})
ok('a calendar places records on their day, moves by month, and says how many have no date', () => {
  const v = view({ kind: 'calendar', date: 'due' })
  const t = tree(React.createElement(P.CalendarView, { p: pageApi({ view: v, months: { v1: '2026-10' } }) }))
  assert.equal(kb(t, 'tables-event').length, 2, 'the record due on 31 October and the one due on 4 November, which the sixth week still shows')
  assert.equal(kb(t, 'tables-cal-add').length, 0, 'a day takes no row by hand')
  click(kb(t, 'tables-cal-next')[0]); click(kb(t, 'tables-cal-prev')[0]); click(kb(t, 'tables-cal-today')[0]); click(kb(t, 'tables-event')[0])
  assert.deepEqual(calls.splice(0), [['setMonth', 'v1', '2026-11'], ['setMonth', 'v1', '2026-09'], ['setMonth', 'v1', '2026-10'], ['openRecord', 'r2']])
  assert.ok(text(t).includes('1 row without a date is not in the calendar'))
  const nov = tree(React.createElement(P.CalendarView, { p: pageApi({ view: v, months: { v1: '2026-11' } }) }))
  assert.equal(kb(nov, 'tables-event').length, 2)
})
ok('the chips say what filters and sorts, remove one at a time, and count the rows', () => {
  const v = view({ state: { flt: { conj: 'and', items: [{ k: 'status', op: 'is', v: 'todo' }, { k: 'flag', op: 'checked' }] }, sorts: [{ k: 'due', dir: 'asc' }], hidden: [] } })
  const t = tree(React.createElement(P.Chips, { p: pageApi({ view: v, rows: ROWS.slice(0, 2) }) }))
  const chips = kb(t, 'tables-chip')
  assert.equal(chips.length, 3)
  assert.ok(text(chips[0]).includes('Status is To do') && text(chips[2]).includes('Sort: Due ↑'))
  assert.equal(text(kb(t, 'tables-count')[0]), '2 of 4')
  click(all(chips[1], (n) => n.type === 'button')[0])
  assert.deepEqual(calls[0][1].items, [{ k: 'status', op: 'is', v: 'todo' }])
  click(all(chips[2], (n) => n.type === 'button')[0])
  assert.deepEqual(edited(0, v).state.sorts, [])
  calls.length = 0
  const or = tree(React.createElement(P.Chips, { p: pageApi({ view: view({ state: { flt: { conj: 'or', items: [{ k: 'status', op: 'is', v: 'todo' }, { k: 'flag', op: 'checked' }] }, sorts: [], hidden: [] } }) }) }))
  assert.equal(kb(or, 'tables-chip').length, 1, 'an « or » is one chip')
  assert.equal(text(kb(tree(React.createElement(P.Chips, { p: pageApi() })), 'tables-count')[0]), '4 rows')
})
ok('the drawer reads every field of a row, never shows a secret in clear, and has no editor, no delete', () => {
  const t = tree(React.createElement(P.Drawer, { p: pageApi({ drawer: { id: 'r1' } }) }))
  assert.equal(kb(t, 'tables-drawer').length, 1)
  for (const f of TASK.fields) assert.ok(kb(t, 'tables-field-' + f.key).length >= 1, f.key)
  assert.equal(all(t, (n) => n.type === 'input' || n.type === 'textarea' || n.type === 'select' || n.type === 'form').length, 0, 'nothing to type in')
  assert.equal(kb(t, 'tables-delete').length, 0); assert.equal(kb(t, 'tables-create').length, 0)
  assert.ok(text(kb(t, 'tables-field-token')[0]).includes(T.MASK) && !text(t).includes('sekret'), 'a secret stays masked')
  assert.ok(text(kb(t, 'tables-field-name')[0]).includes('Write the brief'))
  assert.equal(all(kb(t, 'tables-field-flag')[0], (n) => n.props.role === 'img').length, 1, 'a ticked box shows a tick')
  assert.ok(text(kb(tree(React.createElement(P.Drawer, { p: pageApi({ drawer: { id: 'r4' } }) })), 'tables-field-status')[0]).includes('—'), 'an empty field says so')
  click(kb(t, 'tables-drawer-ask')[0]); click(kb(t, 'tables-drawer-close')[0])
  assert.deepEqual(calls.splice(0).map((c) => c[0]), ['askKaby', 'closeDrawer'])
  assert.ok(text(t).includes('Launch'), 'a link shows the title of the record it points to')
  assert.ok(!/Invalid/.test(text(kb(t, 'tables-drawer')[0])) && /2026/.test(text(all(t, (n) => n.props.className === 'kbtb-stamp')[0])), 'the drawer dates the row from the host\'s stamps')
})
ok('a row that is gone says so, and a row of a table still being read is not reported gone', () => {
  const gone = tree(React.createElement(P.Drawer, { p: pageApi({ drawer: { id: 'zz' } }) }))
  assert.ok(text(gone).includes('This row no longer exists.'))
  const waiting = tree(React.createElement(P.Drawer, { p: pageApi({ drawer: { id: 'zz' }, rec: { status: 'loading', rows: [] } }) }))
  assert.ok(text(waiting).includes('Loading…') && !text(waiting).includes('no longer exists'))
})
ok('a link field in the drawer shows the rows it points at as chips that open, and nothing to change them', () => {
  const SHOP_DB = { id: 'db1', name: 'Shop', objects: SHOP }
  const customers = [rec('c1', { name: 'Ada' }), rec('c2', { name: 'Bob' })]
  const items = [rec('i1', { name: 'Pen' }), rec('i2', { name: 'Ink' })]
  const related = { customer: customers, item: items }
  const ctx = T.makeCtx('2026-10-30', SHOP, related)
  const opened = []
  ctx.open = (f, id) => opened.push([f.to, id])
  const orders = [rec('o1', { ref: 'A-1', customer: 'c1', items: ['i1', 'i2'] }), rec('o2', { ref: 'A-2' })]
  const mk = (id) => pageApi({ db: SHOP_DB, obj: ORDER, rows: orders, all: orders, rec: { status: 'ok', rows: orders }, ctx, related, drawer: { id }, view: view() })
  const t = tree(React.createElement(P.Drawer, { p: mk('o1') }))
  const one = kb(t, 'tables-field-customer')[0]
  assert.equal(all(one, (n) => n.props['data-kb'] === 'tables-link').length, 1)
  assert.ok(text(one).includes('Ada'))
  assert.ok(text(kb(t, 'tables-field-items')[0]).includes('Pen') && text(kb(t, 'tables-field-items')[0]).includes('Ink'))
  assert.equal(all(t, (n) => n.props['data-kb'] === 'tables-link-remove' || n.props['data-kb'] === 'tables-link-add').length, 0, 'no way to add or take off a link by hand')
  click(all(one, (n) => n.props['data-kb'] === 'tables-link')[0])
  assert.deepEqual(opened, [['customer', 'c1']])
  const empty = tree(React.createElement(P.Drawer, { p: mk('o2') }))
  assert.ok(text(kb(empty, 'tables-field-customer')[0]).includes('—'))
})
ok('the rows that link here are listed by link field with how many, each opens its row; the drawer has a Back button once it was followed', () => {
  const opened = []
  const groups = [
    { object: 'order', objectLabel: 'Orders', field: 'customer', fieldLabel: 'Customer', inverse: 'Purchases', many: false, count: 3, records: [{ id: 'o1', title: 'A-1' }, { id: 'o2', title: '' }] },
    { object: 'review', objectLabel: 'Reviews', field: 'about', fieldLabel: 'About', inverse: null, many: false, count: 0, records: [] },
  ]
  const t = tree(React.createElement(P.LinkedGroups, { p: { openLinked: (o, id) => opened.push([o, id]) }, groups }))
  const gs = kb(t, 'tables-linked-group')
  assert.equal(gs.length, 2)
  assert.ok(text(gs[0]).includes('Purchases') && text(gs[0]).includes('via Orders › Customer') && text(gs[0]).includes('+1'), 'the name it is seen under, where it comes from, how many are not shown')
  assert.equal(text(kb(gs[0], 'tables-linked-count')[0]), '3')
  assert.ok(text(gs[1]).includes('Reviews') && text(gs[1]).includes('None yet.'), 'a link field nobody uses yet is listed, empty')
  const chips = kb(gs[0], 'tables-link')
  assert.equal(chips.length, 2); assert.ok(text(chips[1]).includes('Untitled'))
  click(chips[0])
  assert.deepEqual(opened, [['order', 'o1']])
  const back = tree(React.createElement(P.Drawer, { p: pageApi({ drawer: { id: 'r1', trail: [{ object: 'customer', id: 'c1', label: 'Ada' }] } }) }))
  const b = kb(back, 'tables-drawer-back')[0]
  assert.ok(b.props['aria-label'].includes('Back to Ada'))
  assert.equal(kb(tree(React.createElement(P.Drawer, { p: pageApi({ drawer: { id: 'r1' } }) })), 'tables-drawer-back').length, 0, 'no Back button when nothing was followed')
  const waiting = tree(React.createElement(P.Drawer, { p: pageApi({ drawer: { id: 'zz', trail: [{ object: 'customer', id: null, label: 'Customers' }] }, rec: { status: 'loading', rows: [] } }) }))
  assert.ok(text(waiting).includes('Loading…') && !text(waiting).includes('no longer exists'), 'a row of a table still being read is not reported missing')
  assert.equal(kb(waiting, 'tables-drawer-back').length, 1)
})
ok('the Relations tab draws the map with a table and a line each, and lists the same links for those who do not see the drawing', () => {
  const SHOP_DB = { id: 'db1', name: 'Shop', objects: SHOP }
  const asked = []
  const picked = []
  const mk = (extra) => pageApi(Object.assign({ db: SHOP_DB, obj: null, relTab: true, openTable: (k) => picked.push(k), askKaby: (x) => asked.push(x) }, extra || {}))
  const m = tree(React.createElement(P.RelationsView, { p: mk() }))
  assert.equal(kb(m, 'tables-relations').length, 1)
  assert.equal(kb(m, 'tables-map-node').length, 3); assert.equal(kb(m, 'tables-map-link').length, 2)
  assert.equal(kb(m, 'tables-map-list')[0].children.length, 2, 'the same links as a list')
  assert.equal(kb(m, 'tables-map')[0].props.role, 'img')
  assert.ok(text(kb(m, 'tables-map-list')[0]).includes('Orders › Customer') && text(kb(m, 'tables-map-list')[0]).includes('Purchases'), 'the name a link is seen under on the other side')
  click(kb(m, 'tables-map-node').find((n) => n.props['data-object'] === 'item'))
  kb(m, 'tables-map-node')[0].props.onKeyDown({ key: 'Enter', preventDefault () {} })
  assert.deepEqual(picked, ['item', 'customer'])
  const bare = tree(React.createElement(P.RelationsView, { p: mk({ db: { id: 'db1', name: 'Shop', objects: [CUSTOMER, ITEM] } }) }))
  assert.equal(kb(bare, 'tables-map-none').length, 1); assert.equal(kb(bare, 'tables-map-link').length, 0)
  click(kb(bare, 'tables-map-ask')[0])
  assert.ok(asked.length === 1 && asked[0].includes('relation_add') && asked[0].includes('db1') && asked[0].includes('Apps page'), 'Kaby is asked for the link tool, in that app')
})
ok('the empty states: no row (Kaby fills it), nothing matching (clear the filter)', () => {
  const none = tree(React.createElement(P.Empty, { p: pageApi(), why: 'none' }))
  assert.equal(kb(none, 'tables-empty')[0].props['data-why'], 'none'); assert.equal(kb(none, 'tables-empty-new').length, 0, 'no New row button'); click(kb(none, 'tables-empty-ask')[0])
  const filtered = tree(React.createElement(P.Empty, { p: pageApi(), why: 'filtered' }))
  assert.equal(kb(filtered, 'tables-empty')[0].props['data-why'], 'filtered')
  click(all(filtered, (n) => n.type === 'button')[0])
  assert.deepEqual(calls.splice(0).map((c) => c[0]), ['askKaby', 'clearAll'])
})
const APP_SHOP = {
  id: 'shop', name: 'Shop', fingerprint: 'f1', template: null,
  objects: [Object.assign({}, CUSTOMER, { count: 12, views: [], fields: CUSTOMER.fields }), Object.assign({}, ITEM, { count: 3, views: [] }), Object.assign({}, ORDER, { count: 7, views: [] })],
  archivedObjects: [{ key: 'old', label: 'Old notes', archived: { by: 'person', at: 'x' }, count: 4 }],
}
ok('the gallery draws a card per app with its tables and rows, and a card opens its app; the ⋯ menu offers Open, Ask Kaby and Archive', () => {
  const t = tree(React.createElement(P.Gallery, { p: pageApi({ dbs: [APP_SHOP, Object.assign({}, APP_SHOP, { id: 'b', name: 'Books', objects: [] })] }) }))
  const cards = kb(t, 'apps-card')
  assert.equal(cards.length, 2); assert.equal(cards[0].props['data-db'], 'shop')
  const first = text(cards[0])
  assert.ok(first.includes('Shop') && first.includes('3 tables') && first.includes('22 rows') && first.includes('12 Customers') && first.includes('Private, on this computer'), first)
  assert.ok(text(cards[1]).includes('No table yet'))
  assert.equal(text(all(cards[0], (n) => String(n.props.className).startsWith('kbtb-apptile'))[0]), 'S', 'the first letter stands for the app')
  click(kb(cards[0], 'apps-open')[0])
  assert.deepEqual(calls.splice(0), [['openApp', 'shop']])
  assert.equal(all(cards[0], (n) => n.props.role === 'menuitem').length, 0, 'the menu is closed')
  const menu = tree(React.createElement(P.AppCard, { p: pageApi({ menu: 'card:shop' }), app: APP_SHOP }))
  const items = all(menu, (n) => n.props.role === 'menuitem')
  assert.deepEqual(items.map((n) => n.props['data-kb']), ['apps-card-menu-open', 'apps-card-menu-ask', 'apps-card-menu-archive'])
  click(items[0]); click(items[1]); click(items[2])
  const c = calls.splice(0)
  assert.deepEqual(c.map((x) => x[0]), ['setMenu', 'openApp', 'setMenu', 'askKaby', 'setMenu', 'confirmArchive'])
  assert.ok(c[3][1].includes('Shop') && c[3][1].includes('shop') && !c[3][1].includes('Customers'), 'asking about the card asks about the app, not a table')
  assert.deepEqual(c[5].slice(1), ['shop', null])
})
ok('no app yet is a place that teaches: a sentence and the button for the first one', () => {
  const t = tree(React.createElement(P.Gallery, { p: pageApi({ dbs: [] }) }))
  assert.equal(kb(t, 'apps-none').length, 1); assert.equal(kb(t, 'apps-card').length, 0)
  click(kb(t, 'apps-none-new')[0]); assert.deepEqual(calls.splice(0), [['newApp']])
})
ok('apps put away fold under the cards: a count, then Restore and Delete forever, never an open', () => {
  const away = [{ id: 'old', name: 'Old', archived: { by: 'person', at: 'x' }, tables: 2, rows: 5 }]
  const shut = tree(React.createElement(P.Gallery, { p: pageApi({ dbs: [APP_SHOP], archived: away, fold: false }) }))
  assert.equal(kb(shut, 'apps-fold')[0].props['aria-expanded'], 'false'); assert.equal(kb(shut, 'apps-archived').length, 0)
  assert.ok(text(kb(shut, 'apps-fold')[0]).includes('Archived · 1'))
  click(kb(shut, 'apps-fold')[0]); assert.deepEqual(calls.splice(0), [['setFold', true]])
  const open = tree(React.createElement(P.Gallery, { p: pageApi({ dbs: [APP_SHOP], archived: away, fold: true }) }))
  const card = kb(open, 'apps-archived')[0]
  assert.equal(kb(card, 'apps-open').length, 0, 'an app put away does not open')
  assert.ok(text(card).includes('2 tables') && text(card).includes('5 rows'))
  click(kb(card, 'apps-restore')[0]); click(kb(card, 'apps-delete')[0])
  assert.deepEqual(calls.splice(0), [['restoreApp', 'old'], ['confirmDelete', 'old', null]])
  assert.equal(kb(tree(React.createElement(P.Gallery, { p: pageApi({ dbs: [APP_SHOP], archived: [] }) })), 'apps-fold').length, 0, 'nothing put away, no fold')
})
ok('a new app is described to Kaby, or started from a simple shape, or from a template when the core offers some', () => {
  const t = tree(React.createElement(P.NewApp, { p: pageApi() }))
  assert.equal(kb(t, 'tables-build-input').length, 1); assert.equal(kb(t, 'tables-build-send')[0].props.disabled, true, 'nothing to send yet')
  assert.equal(kb(t, 'apps-templates').length, 0, 'no templates from the core, no section')
  const starts = kb(t, 'apps-start')
  assert.deepEqual(starts.map((n) => n.props['data-id']), ['contacts', 'tasks', 'collection'])
  click(starts[1])
  const asked = calls.splice(0)
  assert.equal(asked[0][0], 'askKaby'); assert.ok(asked[0][1].includes('task list') && asked[0][1].includes('db-builder'))
  const tpl = [T.templateOf({ id: 'shop', name: 'Online shop', line: 'Sell online', tag: 'Retail', extras: 'a dashboard', tables: ['Contacts', 'Orders', 'Products', 'Notes'] }), T.templateOf({ id: 'agency', name: 'Agency', have: true, appId: 'db7' })]
  const withTpl = tree(React.createElement(P.NewApp, { p: pageApi({ templates: { status: 'ok', list: tpl } }) }))
  const cards = kb(withTpl, 'apps-template')
  assert.equal(cards.length, 2)
  assert.ok(text(cards[0]).includes('Online shop') && text(cards[0]).includes('+1') && text(cards[0]).includes('Comes with a dashboard') && text(cards[0]).includes('Use template'))
  assert.ok(text(cards[1]).includes('In your apps'))
  click(all(cards[0], (n) => n.type === 'button')[0]); click(all(cards[1], (n) => n.type === 'button')[0])
  assert.deepEqual(calls.splice(0), [['openTemplate', 'shop'], ['openApp', 'db7']], 'a template in use opens its app instead of adding it twice')
  assert.equal(kb(tree(React.createElement(P.NewApp, { p: pageApi({ templates: { status: 'loading', list: [] } }) })), 'apps-templates').length, 0)
})
ok('an app opens on its tables with Relations after them, only when there is more than one table; the header goes back and asks Kaby', () => {
  const p = pageApi({ db: APP_SHOP, obj: APP_SHOP.objects[0] })
  const tabs = tree(React.createElement(P.Tabs, { p }))
  assert.deepEqual(kb(tabs, 'tables-tab').map((n) => n.props['data-object']), ['customer', 'item', 'order'])
  assert.equal(kb(tabs, 'tables-tab')[0].props['aria-selected'], 'true'); assert.equal(kb(tabs, 'tables-tab')[1].props['aria-selected'], 'false')
  const rel = kb(tabs, 'tables-tab-relations')[0]
  assert.equal(rel.props['aria-selected'], 'false')
  click(rel); click(kb(tabs, 'tables-tab')[2])
  assert.deepEqual(calls.splice(0), [['openTable', T.REL_TAB], ['openTable', 'order']])
  const onRel = tree(React.createElement(P.Tabs, { p: pageApi({ db: APP_SHOP, obj: null, relTab: true }) }))
  assert.equal(kb(onRel, 'tables-tab-relations')[0].props['aria-selected'], 'true'); assert.ok(kb(onRel, 'tables-tab').every((n) => n.props['aria-selected'] === 'false'))
  const one = tree(React.createElement(P.Tabs, { p: pageApi({ db: Object.assign({}, APP_SHOP, { objects: [APP_SHOP.objects[0]] }), obj: APP_SHOP.objects[0] }) }))
  assert.equal(kb(one, 'tables-tab-relations').length, 0, 'one table has nothing to relate')
  const head = tree(React.createElement(P.AppHeader, { p, title: 'Shop', back: () => calls.push(['back']), backLabel: 'All apps' }))
  assert.equal(kb(head, 'apps-back')[0].props['aria-label'], 'All apps'); click(kb(head, 'apps-back')[0]); assert.deepEqual(calls.splice(0), [['back']])
  assert.ok(text(head).includes('Shop'))
})
ok('the ⋯ of an app lists its archived tables with Restore and Delete forever, and puts the app away', () => {
  const p = (menu) => pageApi({ db: APP_SHOP, obj: APP_SHOP.objects[0], menu })
  const closed = tree(React.createElement(P.AppMenu, { p: p(null) }))
  assert.equal(kb(closed, 'apps-menu')[0].props['aria-expanded'], 'false'); assert.equal(all(closed, (n) => n.props.role === 'menuitem').length, 0)
  const open = tree(React.createElement(P.AppMenu, { p: p('app') }))
  assert.ok(text(open).includes('Archived tables · 1'))
  click(kb(open, 'apps-menu-archt')[0]); click(kb(open, 'apps-menu-archive')[0])
  assert.deepEqual(calls.splice(0), [['setMenu', 'archt'], ['confirmArchive', 'shop', null]])
  const none = tree(React.createElement(P.AppMenu, { p: pageApi({ db: Object.assign({}, APP_SHOP, { archivedObjects: [] }), menu: 'app' }) }))
  assert.ok(text(none).includes('No archived table.') && kb(none, 'apps-menu-archt').length === 0)
  const list = tree(React.createElement(P.AppMenu, { p: p('archt') }))
  const row = kb(list, 'apps-archived-table')[0]
  assert.ok(text(row).includes('Old notes') && text(row).includes('4 rows'))
  click(kb(row, 'apps-table-restore')[0]); click(kb(row, 'apps-table-delete')[0])
  assert.deepEqual(calls.splice(0), [['restoreTable', 'shop', 'old'], ['confirmDelete', 'shop', 'old']])
})
ok('archiving says what is kept and how to bring it back, for an app and for a table, and asks nothing to be typed', () => {
  const dlg = (extra) => tree(React.createElement(P.AppDialog, { p: pageApi({ dbs: [APP_SHOP], dialog: Object.assign({ kind: 'archive', db: 'shop', table: null, impact: null, busy: false, error: null }, extra) }) }))
  const app = dlg()
  assert.equal(kb(app, 'apps-dialog')[0].props.role, 'dialog'); assert.equal(kb(app, 'apps-dialog')[0].props['aria-modal'], 'true')
  const said = text(app)
  assert.ok(said.includes('Archive “Shop”?') && said.includes('3 tables · 22 rows') && said.includes('“Archived” under your apps') && said.includes('Nothing is deleted'), said)
  assert.equal(kb(app, 'apps-typed').length, 0); assert.equal(kb(app, 'apps-confirm')[0].props.disabled, false)
  click(kb(app, 'apps-confirm')[0]); click(kb(app, 'apps-cancel')[0])
  assert.deepEqual(calls.splice(0), [['runDialog', ''], ['closeDialog']])
  const table = text(dlg({ table: 'customer' }))
  assert.ok(table.includes('Archive “Customers”?') && table.includes('12 rows') && table.includes('1 field') && table.includes('Archived tables'), table)
  const busy = dlg({ busy: true })
  assert.equal(kb(busy, 'apps-confirm')[0].props.disabled, true); assert.equal(kb(busy, 'apps-cancel')[0].props.disabled, true)
  assert.ok(text(dlg({ error: 'This app is published: unpublish it first.' })).includes('unpublish it first'))
})
ok('deleting for good says what disappears, waits for the facts, and needs the name typed back exactly', () => {
  const dlg = (extra, apps) => tree(React.createElement(P.AppDialog, { p: pageApi({ dbs: [], archived: apps || [{ id: 'old', name: 'Old', archived: { by: 'person', at: 'x' }, tables: 2, rows: 5 }], dialog: Object.assign({ kind: 'delete', db: 'old', table: null, impact: null, busy: false, error: null }, extra) }) }))
  const wait = dlg()
  assert.ok(text(wait).includes('Working it out…')); assert.equal(kb(wait, 'apps-confirm')[0].props.disabled, true, 'nothing to confirm before the facts')
  assert.equal(kb(wait, 'apps-typed').length, 1)
  const facts = dlg({ impact: { ok: true, tables: 2, rows: 5, links: 3, files: 1, views: 4, cut: [] } })
  const said = text(facts)
  assert.ok(said.includes('Delete “Old” for good?') && said.includes('2 tables · 5 rows · 3 links · 1 file · their views') && said.includes('Can it come back?') && said.includes('No'), said)
  assert.equal(kb(facts, 'apps-confirm')[0].props.disabled, true, 'the name is not typed yet')
  const bare = dlg({ impact: { ok: true, tables: 1, rows: 0, links: 0, files: 0, views: 1, cut: [] } })
  assert.ok(text(bare).includes('1 table · 0 rows · their views') && !text(bare).includes('link') && !text(bare).includes('file'), 'what is zero is not listed')
  const tbl = text(dlg({ table: 'order', impact: { ok: true, tables: 1, rows: 7, fields: 3, links: 5, files: 0, views: 1, cut: [{ object: 'customer', objectLabel: 'Customers', field: 'orders', fieldLabel: 'Orders', links: 5 }] } },
    [{ id: 'old', name: 'Old', archived: { by: 'person', at: 'x' }, tables: 2, rows: 5, objects: [], archivedObjects: [{ key: 'order', label: 'Orders', count: 7 }] }]))
  assert.ok(tbl.includes('Delete “Orders” for good?') && tbl.includes('7 rows · 3 fields') && tbl.includes('Customers › Orders (5 links)') && tbl.includes('lose their “Orders” field'), tbl)
  const none = text(dlg({ table: 'order', impact: { ok: true, tables: 1, rows: 0, fields: 1, links: 0, files: 0, views: 1, cut: [] } }, [{ id: 'old', name: 'Old', tables: 1, rows: 0, objects: [], archivedObjects: [{ key: 'order', label: 'Orders', count: 0 }] }]))
  assert.ok(none.includes('None'))
  assert.ok(text(dlg({ error: 'The local server does not answer. Try again in a moment.' })).includes('does not answer'))
})
ok('a template asks which of its extras to add, and Add app runs the dialog', () => {
  const t = T.templateOf({ id: 'shop', name: 'Online shop', line: 'Sell online', extras: 'a dashboard and automations', tables: ['Contacts', 'Orders'] })
  const dlg = (extra) => tree(React.createElement(P.Dialogs, { p: pageApi({ dialog: Object.assign({ kind: 'template', template: t, opts: { sample: true, kit: true }, busy: false, error: null }, extra) }) }))
  const d = dlg()
  assert.ok(text(d).includes('Add “Online shop”?') && text(d).includes('2 tables') && text(d).includes('A dashboard and automations.'))
  assert.equal(kb(d, 'apps-opt-sample')[0].props.checked, true); assert.equal(kb(d, 'apps-opt-kit')[0].props.checked, true)
  kb(d, 'apps-opt-kit')[0].props.onChange({ target: { checked: false } }); click(kb(d, 'apps-confirm')[0])
  assert.deepEqual(calls.splice(0), [['setTemplateOpt', 'kit', false], ['runDialog', '']])
  const plain = tree(React.createElement(P.Dialogs, { p: pageApi({ dialog: { kind: 'template', template: T.templateOf({ id: 'a', name: 'A' }), opts: { sample: true, kit: false }, busy: false, error: null } }) }))
  assert.equal(kb(plain, 'apps-opt-kit').length, 0, 'no extras, no checkbox for them')
  assert.equal(P.Dialogs({ p: pageApi() }), null, 'no dialog open, nothing drawn')
  assert.equal(kb(dlg({ busy: true }), 'apps-confirm')[0].props.disabled, true)
})
ok('the whole page draws its first state without a host: the heading and the loading line, nothing thrown', () => {
  const t = tree(React.createElement(Page, {}))
  assert.equal(kb(t, 'tables-page')[0].props['data-screen'], 'gallery')
  assert.ok(text(t).includes('Apps') && text(t).includes('Loading apps…'))
})
ok('every piece draws in French too, with no English left in the words it speaks', () => {
  resolved = 'fr'
  try {
    const flt = { conj: 'and', items: [{ k: 'status', op: 'is', v: 'todo' }] }
    const p = pageApi({ menu: 'filter', flt, view: view({ state: { flt, sorts: [], hidden: [] } }) })
    const t = tree(React.createElement(P.Bar, { p }))
    const said = text(t)
    for (const w of ['Filtre', 'Tri', 'Champs', 'Vues']) assert.ok(said.includes(w), w)
    assert.ok(said.includes('Où'), 'the filter panel')
    const chips = text(tree(React.createElement(P.Chips, { p: pageApi() })))
    assert.ok(chips.includes('4 lignes'))
    const shop = pageApi({ db: { id: 'db1', name: 'Shop', objects: SHOP }, obj: null, relTab: true })
    const rel = text(tree(React.createElement(P.RelationsView, { p: shop })))
    for (const w of ['Chaque ligne porte le nom', 'un seul', 'plusieurs']) assert.ok(rel.includes(w), w)
    const linked = text(tree(React.createElement(P.LinkedGroups, { p: {}, groups: [{ object: 'order', objectLabel: 'Orders', field: 'customer', fieldLabel: 'Customer', inverse: null, many: false, count: 0, records: [] }] })))
    assert.ok(linked.includes('Lié depuis') && linked.includes('Aucune pour l’instant.'))
    const gal = text(tree(React.createElement(P.Gallery, { p: pageApi({ dbs: [APP_SHOP], archived: [{ id: 'old', name: 'Old', archived: { by: 'person', at: 'x' }, tables: 2, rows: 5 }], fold: true }) })))
    for (const w of ['Privée, sur cet ordinateur', 'Rangées', 'Rétablir', 'Supprimer pour de bon…']) assert.ok(gal.includes(w), w)
    const dlg = text(tree(React.createElement(P.AppDialog, { p: pageApi({ dbs: [APP_SHOP], dialog: { kind: 'archive', db: 'shop', table: null, impact: null, busy: false, error: null } }) })))
    for (const w of ['Ranger « Shop » ?', 'Gardé', 'Annuler']) assert.ok(dlg.includes(w), w)
  } finally { resolved = 'en' }
})

console.log('── publish: an app that lives in a web app ──')
const NOW = Date.parse('2026-10-31T12:00:00.000Z')
const PUB_OLD = { slug: 'shop', url: 'https://team.example.test', since: '2026-10-30T08:00:00.000Z', lastSync: '2026-10-31T11:57:00.000Z', syncError: null, host: null, hostGone: false }
const PUB = Object.assign({}, PUB_OLD, { host: { id: 'studio', name: 'Studio', region: 'Frankfurt, EU' } })
const PUB_GONE = Object.assign({}, PUB, { hostGone: true, syncError: { code: 'unreachable', message: 'x', at: 'y' } })
const APP_PUB = Object.assign({}, APP_SHOP, { published: PUB })
const HOSTING = { available: true, name: 'Kybernos' }
const inFrench = (fn) => { resolved = 'fr'; try { return fn() } finally { resolved = 'en' } }
ok('how long ago a copy was brought up to date is said in plain words, in both languages, and a date that is not one says nothing', () => {
  assert.equal(T.agoWord('2026-10-31T11:59:40.000Z', NOW), 'just now'); assert.equal(T.agoWord('2026-10-31T12:00:30.000Z', NOW), 'just now', 'a clock a little ahead is not a mystery')
  assert.equal(T.agoWord('2026-10-31T11:57:00.000Z', NOW), '3 min ago'); assert.equal(T.agoWord('2026-10-31T09:00:00.000Z', NOW), '3 h ago'); assert.equal(T.agoWord('2026-10-28T12:00:00.000Z', NOW), '3 d ago')
  assert.equal(T.agoWord('nonsense', NOW), ''); assert.equal(T.agoWord(undefined, NOW), '')
  assert.equal(inFrench(() => T.agoWord('2026-10-31T11:57:00.000Z', NOW)), 'il y a 3 min'); assert.equal(inFrench(() => T.agoWord('2026-10-31T11:59:50.000Z', NOW)), 'à l’instant')
})
ok('the sync line says when the copy was refreshed, or why it could not be, and what the person is looking at meanwhile', () => {
  assert.equal(T.syncLine(PUB, NOW), 'Synced 3 min ago'); assert.equal(inFrench(() => T.syncLine(PUB, NOW)), 'Synchronisée il y a 3 min')
  assert.equal(T.syncLine(Object.assign({}, PUB, { lastSync: null }), NOW), 'Copy kept on this computer')
  const down = Object.assign({}, PUB, { syncError: { code: 'unreachable', message: 'x', at: 'y' } })
  assert.equal(T.syncLine(down, NOW), 'The web app is not answering. Last synced 3 min ago.')
  assert.equal(T.syncLine(Object.assign({}, down, { lastSync: null }), NOW), 'The web app is not answering. You are seeing the copy kept on this computer.')
  assert.ok(T.syncLine(Object.assign({}, down, { syncError: { code: 'refused' } }), NOW).startsWith('The web app refused this computer’s key.'))
  assert.ok(T.syncLine(Object.assign({}, down, { syncError: { code: 'mismatch' } }), NOW).startsWith('The copy from the web app could not be checked.'))
  assert.ok(inFrench(() => T.syncLine(down, NOW)).startsWith('L’app web ne répond pas. Dernière mise à jour il y a 3 min.'))
})
ok('the page reads only what it needs of the state: a published object with a url, a host that says it is available', () => {
  assert.equal(T.pubOf(APP_PUB), PUB); assert.equal(T.pubOf(APP_SHOP), null); assert.equal(T.pubOf(Object.assign({}, APP_SHOP, { published: null })), null); assert.equal(T.pubOf(Object.assign({}, APP_SHOP, { published: { slug: 'x' } })), null); assert.equal(T.pubOf(null), null)
  assert.equal(T.hostWord('https://team.example.test/open?t=abc'), 'team.example.test'); assert.equal(T.hostWord('not a url'), '')
  assert.equal(T.canPublishVia(HOSTING), true); assert.equal(T.canPublishVia({ available: false }), false); assert.equal(T.canPublishVia(null), false); assert.equal(T.canPublishVia({ available: 'yes' }), false, 'only a true')
})
ok('a card offers Publish only when the host offers it, and a private card still says it is private', () => {
  const none = tree(React.createElement(P.AppCard, { p: pageApi({ menu: 'card:shop' }), app: APP_SHOP }))
  assert.equal(kb(none, 'apps-card-menu-publish').length, 0, 'no hosting, no Publish')
  const off = tree(React.createElement(P.AppCard, { p: pageApi({ menu: 'card:shop', hosting: { available: false } }), app: APP_SHOP }))
  assert.equal(kb(off, 'apps-card-menu-publish').length, 0)
  const on = tree(React.createElement(P.AppCard, { p: pageApi({ menu: 'card:shop', hosting: HOSTING }), app: APP_SHOP }))
  assert.deepEqual(all(on, (n) => n.props.role === 'menuitem').map((n) => n.props['data-kb']), ['apps-card-menu-open', 'apps-card-menu-ask', 'apps-card-menu-publish', 'apps-card-menu-archive'])
  assert.ok(text(on).includes('Private, on this computer') && text(on).includes('Publish…')); assert.equal(kb(on, 'apps-card-published').length, 0)
  click(kb(on, 'apps-card-menu-publish')[0]); assert.deepEqual(calls.splice(0), [['setMenu', null], ['openPublish', 'shop']])
})
ok('a published card says so with its host, and its menu opens the web app, unpublishes, and shows Archive locked with the reason', () => {
  const t = tree(React.createElement(P.AppCard, { p: pageApi({ menu: 'card:shop', hosting: HOSTING }), app: APP_PUB }))
  assert.equal(text(kb(t, 'apps-card-published')[0]), 'Published · on Studio'); assert.ok(!text(t).includes('Private, on this computer'))
  assert.equal(text(kb(tree(React.createElement(P.AppCard, { p: pageApi({}), app: Object.assign({}, APP_PUB, { published: PUB_OLD }) })), 'apps-card-published')[0]), 'Published · team.example.test', 'an app published before computers were chosen still shows its web address')
  assert.deepEqual(all(t, (n) => n.props.role === 'menuitem').map((n) => n.props['data-kb']), ['apps-card-menu-open', 'apps-card-menu-ask', 'apps-card-menu-web', 'apps-card-menu-unpublish', 'apps-card-menu-archive'])
  const locked = kb(t, 'apps-card-menu-archive')[0]
  assert.equal(locked.props['aria-disabled'], 'true'); assert.ok(text(locked).includes('Unpublish first')); assert.equal(locked.props.title, 'Unpublish to change this')
  click(locked); assert.deepEqual(calls.splice(0), [], 'a locked item does nothing, and does not even close the menu')
  click(kb(t, 'apps-card-menu-web')[0]); click(kb(t, 'apps-card-menu-unpublish')[0])
  assert.deepEqual(calls.splice(0), [['setMenu', null], ['openWeb', 'shop'], ['setMenu', null], ['openUnpublish', 'shop']])
  const down = tree(React.createElement(P.AppCard, { p: pageApi({ hosting: HOSTING }), app: Object.assign({}, APP_PUB, { published: Object.assign({}, PUB, { syncError: { code: 'unreachable', message: 'x', at: 'y' } }) }) }))
  assert.ok(kb(down, 'apps-card-published')[0].props.className.includes('bad'), 'a copy that cannot be refreshed is told apart on the card')
  assert.ok(kb(down, 'apps-card-published')[0].props.title.includes('not answering'))
  assert.ok(inFrench(() => text(kb(tree(React.createElement(P.AppCard, { p: pageApi({}), app: APP_PUB })), 'apps-card-published')[0])).startsWith('Publiée · sur Studio'))
})
ok('a published app wears a pill next to its name, and its ⋯ unpublishes and keeps Archive locked', () => {
  const pill = React.createElement(P.PubPill, { pub: PUB, hd: true })
  const head = tree(React.createElement(P.AppHeader, { p: pageApi(), title: 'Shop', pill }))
  assert.equal(text(kb(head, 'apps-published-pill')[0]), 'Published · on Studio')
  assert.equal(text(kb(tree(React.createElement(P.AppHeader, { p: pageApi(), title: 'Shop', pill: React.createElement(P.PubPill, { pub: PUB_OLD, hd: true }) })), 'apps-published-pill')[0]), 'Published', 'no computer to name, and the web address is under the tabs')
  assert.equal(kb(tree(React.createElement(P.AppHeader, { p: pageApi(), title: 'Shop' })), 'apps-published-pill').length, 0)
  const open = tree(React.createElement(P.AppMenu, { p: pageApi({ db: APP_PUB, obj: APP_PUB.objects[0], menu: 'app' }) }))
  click(kb(open, 'apps-menu-unpublish')[0]); click(kb(open, 'apps-menu-archive')[0])
  assert.deepEqual(calls.splice(0), [['openUnpublish', 'shop']], 'the locked Archive does nothing')
  assert.equal(kb(open, 'apps-menu-archive')[0].props['aria-disabled'], 'true'); assert.ok(text(kb(open, 'apps-menu-archive')[0]).includes('Unpublish first'))
  const priv = tree(React.createElement(P.AppMenu, { p: pageApi({ db: APP_SHOP, obj: APP_SHOP.objects[0], menu: 'app' }) }))
  assert.equal(kb(priv, 'apps-menu-unpublish').length, 0); assert.equal(kb(priv, 'apps-menu-archive')[0].props['aria-disabled'], undefined)
})
ok('the note under the tabs says where the app lives, how fresh the copy is, why the structure is locked, and offers Update and Unpublish', () => {
  const t = tree(React.createElement(P.PublishedNote, { p: pageApi({ db: APP_PUB }) }))
  const said = text(t)
  assert.ok(said.includes('Hosted on Studio · Frankfurt, EU') && !said.includes('team.example.test') && said.includes('Rows are written in the web app and copied here') && said.includes('can’t change while the app is published') && said.includes('for this visit only'), said)
  assert.ok(/^ · synced (just now|\d+ (min|h|d) ago)$/.test(text(kb(t, 'apps-sync')[0])), 'after the region, lower case, as in the mockup: ' + text(kb(t, 'apps-sync')[0]))
  assert.ok(/^ · The web app is not answering\. Last synced /.test(text(kb(tree(React.createElement(P.PublishedNote, { p: pageApi({ db: Object.assign({}, APP_PUB, { published: Object.assign({}, PUB, { syncError: { code: 'unreachable', message: 'x', at: 'y' } }) }) }) })), 'apps-sync')[0])), 'a failure keeps its own sentence, capital letter and all')
  const refresh = kb(t, 'apps-refresh')[0]
  assert.equal(refresh.props['aria-label'], 'Update the copy now'); assert.equal(text(refresh), '', 'an icon, named for the people who cannot see it'); assert.equal(refresh.props.disabled, false)
  click(refresh); click(kb(t, 'apps-unpublish')[0])
  assert.deepEqual(calls.splice(0), [['refreshNow', 'shop'], ['openUnpublish', 'shop']])
  assert.equal(kb(tree(React.createElement(P.PublishedNote, { p: pageApi({ db: APP_PUB, syncBusy: 'shop' }) })), 'apps-refresh')[0].props.disabled, true, 'one update at a time')
  assert.equal(P.PublishedNote({ p: pageApi({ db: APP_SHOP }) }), null)
  assert.ok(text(tree(React.createElement(P.PublishedNote, { p: pageApi({ db: Object.assign({}, APP_PUB, { published: PUB_OLD }) }) }))).includes('team.example.test'), 'no computer recorded: the web address')
  assert.ok(inFrench(() => text(tree(React.createElement(P.PublishedNote, { p: pageApi({ db: APP_PUB }) })))).includes('Hébergée sur Studio · Frankfurt, EU'))
  const bad = tree(React.createElement(P.PublishedNote, { p: pageApi({ db: Object.assign({}, APP_PUB, { published: Object.assign({}, PUB, { syncError: { code: 'unreachable', message: 'x', at: 'y' } }) }) }) }))
  assert.ok(kb(bad, 'apps-published-note')[0].props.className.includes('warn')); assert.ok(text(kb(bad, 'apps-sync')[0]).includes('not answering'))
  assert.ok(inFrench(() => text(tree(React.createElement(P.PublishedNote, { p: pageApi({ db: APP_PUB }) })))).includes('Arrêter la publication…'))
})
const HOST_STUDIO = { id: 'studio', name: 'Studio', state: 'running', region: 'Frankfurt, EU', alwaysOn: false, shared: false }
const HOST_BACKOFFICE = { id: 'backoffice', name: 'Backoffice', state: 'sleeping', region: 'Paris, EU', alwaysOn: false, shared: false }
const CARD = {
  ok: true, can: true, reason: null, app: { id: 'shop', name: 'Shop' }, tables: 3, rows: 22, files: 2, bytes: 1258291,
  personal: [{ object: 'customer', objectLabel: 'Customers', field: 'email', fieldLabel: 'Email' }], blocked: [],
  hosting: { name: 'Kybernos', orderUrl: 'https://kybernos.example.test/computers' }, hosts: [HOST_STUDIO, HOST_BACKOFFICE], lastHost: null,
}
const pubDialog = (extra, card) => tree(React.createElement(P.Dialogs, { p: pageApi({ dbs: [APP_SHOP], dialog: Object.assign({ kind: 'publish', db: 'shop', card: card === undefined ? CARD : card, host: null, busy: false, error: null }, extra) }) }))
const cardWith = (extra) => Object.assign({}, CARD, extra)
const radios = (t) => kb(t, 'apps-host')
ok('the Publish card says what goes, lists the person\'s computers, what the pick means and what changes, and nothing leaves before its button', () => {
  const t = pubDialog({ host: 'studio' })
  const said = text(t)
  assert.ok(said.includes('Publish “Shop”?') && said.includes('3 tables · 22 rows · 2 files') && said.includes('1.2 MB'), said)
  assert.ok(said.includes('Where it runs') && said.includes('2 computers') && said.includes('Studio') && said.includes('Frankfurt, EU') && said.includes('Backoffice') && said.includes('Paris, EU'), said)
  assert.ok(said.includes('Customers › Email') && said.includes('go to the web app with the rest'), 'personal fields are listed')
  assert.ok(said.includes('While published') && said.includes('unpublish to change them'), said)
  assert.ok(!/\$|€|a month|budget|new web app|estimated/i.test(said), 'no price, no budget, no « a new web app is set up »: ' + said)
  assert.equal(kb(t, 'apps-confirm')[0].props.disabled, false); assert.equal(text(kb(t, 'apps-confirm')[0]), 'Publish')
  click(kb(t, 'apps-confirm')[0]); click(kb(t, 'apps-cancel')[0]); assert.deepEqual(calls.splice(0), [['runDialog', ''], ['closeDialog']])
  const fr = inFrench(() => text(pubDialog({ host: 'studio' })))
  assert.ok(fr.includes('Publier « Shop » ?') && fr.includes('Où ça tourne') && fr.includes('2 ordinateurs') && fr.includes('En marche') && fr.includes('En veille') && fr.includes('Obtenir un autre ordinateur cloud'), fr)
})
ok('the computers are a real radio group: one is checked, one is a tab stop, a click picks, and the arrows, Home and End move the pick and the focus', () => {
  const t = pubDialog({ host: 'backoffice' })
  const group = kb(t, 'apps-hosts')[0]
  assert.equal(group.props.role, 'radiogroup'); assert.ok(group.props['aria-label'].length > 3)
  const r = radios(t)
  assert.deepEqual(r.map((n) => n.props.role), ['radio', 'radio']); assert.deepEqual(r.map((n) => n.props['aria-checked']), ['false', 'true'])
  assert.deepEqual(r.map((n) => n.props.tabIndex), [-1, 0], 'one tab stop: the checked one'); assert.deepEqual(r.map((n) => n.props.autoFocus), [false, true], 'focus lands on the checked one')
  assert.ok(r.every((n) => n.props.type === 'button' && n.props.disabled === false))
  click(r[0]); assert.deepEqual(calls.splice(0), [['pickHost', 'studio']])
  const noneChecked = radios(pubDialog({ host: null }))
  assert.deepEqual(noneChecked.map((n) => n.props['aria-checked']), ['false', 'false']); assert.deepEqual(noneChecked.map((n) => n.props.tabIndex), [0, -1], 'with no pick the first is the way in')
  const focused = []
  const press = (key, from) => { const ev = { key, target: { getAttribute: () => from }, currentTarget: { querySelectorAll: () => [{ focus: () => focused.push(0) }, { focus: () => focused.push(1) }] }, prevented: false, preventDefault () { this.prevented = true }, stopPropagation () {} }; group.props.onKeyDown(ev); return ev }
  assert.equal(press('ArrowDown', 'studio').prevented, true); assert.deepEqual(calls.splice(0), [['pickHost', 'backoffice']]); assert.deepEqual(focused.splice(0), [1], 'the focus follows the pick')
  press('ArrowDown', 'backoffice'); assert.deepEqual(calls.splice(0), [['pickHost', 'studio']], 'it wraps')
  press('ArrowUp', 'studio'); assert.deepEqual(calls.splice(0), [['pickHost', 'backoffice']])
  press('ArrowRight', 'studio'); press('ArrowLeft', 'studio'); assert.deepEqual(calls.splice(0), [['pickHost', 'backoffice'], ['pickHost', 'backoffice']])
  press('End', 'studio'); press('Home', 'backoffice'); assert.deepEqual(calls.splice(0), [['pickHost', 'backoffice'], ['pickHost', 'studio']])
  assert.equal(press('a', 'studio').prevented, false); assert.equal(press('Enter', 'studio').prevented, false, 'Enter is left to the buttons: it never publishes from a radio'); assert.deepEqual(calls.splice(0), [])
  const busyGroup = kb(pubDialog({ host: 'studio', busy: true }), 'apps-hosts')[0]
  busyGroup.props.onKeyDown({ key: 'ArrowDown', target: { getAttribute: () => 'studio' }, currentTarget: {}, preventDefault () {}, stopPropagation () {} }); assert.deepEqual(calls.splice(0), [], 'nothing moves while it publishes')
})
ok('the first computer to show is the last one used if it is still listed, else the only one, else none', () => {
  assert.equal(T.defaultHost(cardWith({ lastHost: 'backoffice' })), 'backoffice'); assert.equal(T.defaultHost(cardWith({ lastHost: 'gone-one' })), null, 'two computers and the last is not one of them: the person picks')
  assert.equal(T.defaultHost(cardWith({ hosts: [HOST_BACKOFFICE], lastHost: null })), 'backoffice'); assert.equal(T.defaultHost(cardWith({ hosts: [HOST_BACKOFFICE], lastHost: 'gone-one' })), 'backoffice')
  assert.equal(T.defaultHost(cardWith({ hosts: [], lastHost: null })), null); assert.equal(T.defaultHost(null), null); assert.equal(T.defaultHost({ hosts: 'x' }), null)
  const pick = radios(pubDialog({ host: null })); assert.ok(pick.every((n) => n.props['aria-checked'] === 'false'))
  assert.ok(text(pubDialog({ host: null })).includes('Choose the computer that receives the app.')); assert.equal(kb(pubDialog({ host: null }), 'apps-confirm')[0].props.disabled, true, 'Publish waits for a pick')
  assert.equal(kb(pubDialog({ host: 'studio' }), 'apps-host-hint').length, 0)
})
ok('each computer wears the pill of what it is doing, and « Always on » only for one the host says is set that way', () => {
  const s = (x) => T.hostState(x)
  assert.deepEqual([s(HOST_STUDIO).label, s(HOST_BACKOFFICE).label, s({ state: 'starting' }).label, s({ state: 'stopped' }).label, s({ state: 'running', alwaysOn: true }).label], ['Running', 'Sleeping', 'Starting', 'Stopped', 'Always on'])
  assert.equal(s({ state: 'running', alwaysOn: 'yes' }).label, 'Running', 'only a true counts'); assert.equal(s({ state: 'nonsense' }).label, 'Running')
  const t = pubDialog({ host: 'studio' }, cardWith({ hosts: [Object.assign({}, HOST_STUDIO, { alwaysOn: true }), HOST_BACKOFFICE] }))
  assert.deepEqual(kb(t, 'apps-host-state').map(text), ['Always on', 'Sleeping'])
  assert.deepEqual(inFrench(() => ['running', 'sleeping', 'starting', 'stopped'].map((st) => T.hostState({ state: st }).label)), ['En marche', 'En veille', 'Démarrage', 'Arrêté'])
})
ok('the Availability line is Always on only when the picked computer is, else it says it sleeps and how long the team waits, and that a sleeping one is woken by Publish', () => {
  const on = text(pubDialog({ host: 'studio' }, cardWith({ hosts: [Object.assign({}, HOST_STUDIO, { alwaysOn: true })] })))
  assert.ok(on.includes('AvailabilityAlways onStudio stays up'), on); assert.ok(!on.includes('Sleeps when idle'))
  const awake = text(pubDialog({ host: 'studio' }))
  assert.ok(awake.includes('Sleeps when idle') && awake.includes('Your team waits about a second while Studio wakes.') && !awake.includes('asleep now') && !awake.includes('Always on'), awake)
  const asleep = text(pubDialog({ host: 'backoffice' }))
  assert.ok(asleep.includes('while Backoffice wakes. It is asleep now; Publish wakes it.'), asleep)
  assert.ok(text(pubDialog({ host: 'stopped-one' }, cardWith({ hosts: [{ id: 'stopped-one', name: 'Old', state: 'stopped' }] }))).includes('It is stopped now; Publish starts it.'))
  assert.ok(!text(pubDialog({ host: null })).includes('Availability'), 'nothing is said of a computer that is not picked')
  assert.ok(inFrench(() => text(pubDialog({ host: 'backoffice' }))).includes('Il dort en ce moment ; Publier le réveille.'))
  assert.ok(inFrench(() => text(pubDialog({ host: 'studio' }, cardWith({ hosts: [Object.assign({}, HOST_STUDIO, { alwaysOn: true })] })))).includes('Toujours allumé'))
})
ok('the line about the agents is shown only when a listed computer is shared with them', () => {
  assert.equal(kb(pubDialog({ host: 'studio' }), 'apps-hosts-shared').length, 0)
  const shared = pubDialog({ host: 'studio' }, cardWith({ hosts: [Object.assign({}, HOST_STUDIO, { shared: true }), HOST_BACKOFFICE] }))
  assert.equal(text(kb(shared, 'apps-hosts-shared')[0]), 'These computers also run your agents. For an app your team uses daily, order a separate one.')
  assert.ok(inFrench(() => text(kb(pubDialog({ host: 'studio' }, cardWith({ hosts: [Object.assign({}, HOST_STUDIO, { shared: true })] })), 'apps-hosts-shared')[0])).includes('font aussi tourner tes agents'))
})
ok('the order button sits in the block\'s header, opens the address the host gave and nothing else, and is not drawn without a valid one', () => {
  const t = pubDialog({ host: 'studio' })
  const order = kb(t, 'apps-order')[0]
  assert.equal(text(order), 'Get another cloud computer'); assert.ok(order.props.className.includes('sm')); assert.equal(order.props.type, 'button')
  click(order); assert.deepEqual(calls.splice(0), [['orderComputer', 'https://kybernos.example.test/computers']])
  for (const bad of ['', 'http://kybernos.example.test/computers', 'https://user:pw@kybernos.example.test/', 'javascript:alert(1)', 'data:text/html,x', 'kybernos.example.test', undefined, 7, 'https://' + 'a'.repeat(2100) + '.test']) {
    assert.equal(kb(pubDialog({ host: 'studio' }, cardWith({ hosting: { name: 'K', orderUrl: bad } })), 'apps-order').length, 0, String(bad).slice(0, 30))
    assert.equal(T.orderHref(bad), '')
  }
  assert.equal(T.orderHref('https://kybernos.example.test/computers?x=1'), 'https://kybernos.example.test/computers?x=1', 'handed back exactly as it came')
  assert.equal(kb(pubDialog({ host: 'studio', busy: true }), 'apps-order')[0].props.disabled, true)
})
ok('the order address opens in a new tab with no opener and no referrer, exactly once, and an address that is not https opens nothing', () => {
  const opened = []
  assert.deepEqual(T.openOrderPage('https://kybernos.example.test/computers', { open: (...a) => opened.push(a) }), { ok: true })
  assert.deepEqual(opened, [['https://kybernos.example.test/computers', '_blank', 'noopener,noreferrer']])
  for (const bad of ['http://kybernos.example.test/', 'https://u:p@kybernos.example.test/', 'javascript:alert(1)', '', null]) assert.deepEqual(T.openOrderPage(bad, { open: (...a) => opened.push(a) }), { ok: false, error: 'failed' })
  assert.equal(opened.length, 1, 'nothing else was opened')
  assert.deepEqual(T.openOrderPage('https://kybernos.example.test/', { open: () => { throw new Error('blocked') } }), { ok: false, error: 'popup' })
})
ok('with no computer the dialog says so, offers the one primary button and only Close, and the dashed box is not drawn when there is something to pick', () => {
  const none = pubDialog({}, cardWith({ can: false, reason: 'no-host', hosts: [] }))
  const said = text(none)
  assert.ok(said.includes('you don’t have one yet') && said.includes('No cloud computer yet') && said.includes('keeps running when yours is off'), said)
  assert.equal(kb(none, 'apps-hosts-none').length, 1); assert.equal(radios(none).length, 0)
  const order = kb(none, 'apps-order')[0]; assert.equal(text(order), 'Get a cloud computer'); assert.ok(order.props.className.includes('primary')); click(order); assert.deepEqual(calls.splice(0), [['orderComputer', 'https://kybernos.example.test/computers']])
  assert.equal(kb(none, 'apps-confirm').length, 0, 'no Publish without a computer'); assert.equal(text(kb(none, 'apps-cancel')[0]), 'Close')
  assert.ok(said.includes('What goes') && said.includes('3 tables'), 'the facts are still told')
  assert.equal(kb(pubDialog({}, cardWith({ can: false, reason: 'no-host', hosts: [], hosting: { name: 'K', orderUrl: '' } })), 'apps-order').length, 0, 'no address, no button')
  assert.equal(kb(pubDialog({ host: 'studio' }), 'apps-hosts-none').length, 0)
  assert.ok(inFrench(() => text(pubDialog({}, cardWith({ can: false, reason: 'no-host', hosts: [] })))).includes('Obtenir un ordinateur cloud'))
})
ok('while the computers are read the dialog shows bones in the real box, a disabled Publish and Cancel', () => {
  const load = pubDialog({}, null)
  const where = kb(load, 'apps-where')[0]
  assert.equal(where.props['data-state'], 'loading'); assert.equal(where.props['aria-busy'], 'true')
  assert.equal(all(load, (n) => typeof n.props.className === 'string' && n.props.className === 'kbtb-bone').length, 6, 'two rows of three bones')
  assert.equal(radios(load).length, 0); assert.ok(text(load).includes('Where it runs') && text(load).includes('Checking…'))
  assert.equal(kb(load, 'apps-confirm')[0].props.disabled, true); assert.equal(text(kb(load, 'apps-cancel')[0]), 'Cancel')
  click(kb(load, 'apps-cancel')[0]); assert.deepEqual(calls.splice(0), [['closeDialog']])
})
ok('when the computers cannot be read the warning offers Try again and the order button, and Publish waits', () => {
  const off = pubDialog({}, cardWith({ can: false, reason: 'hosts-unreachable', hosts: null, hostsError: { code: 'hosts-unreachable', message: 'Check your connection, then try again.' } }))
  const said = text(off)
  assert.ok(said.includes('We couldn’t load your cloud computers.') && said.includes('Check your connection, then try again.'), said)
  const note = kb(off, 'apps-hosts-error')[0]; assert.ok(note.props.className.includes('warn')); assert.equal(note.props.role, 'alert')
  click(kb(off, 'apps-hosts-retry')[0]); click(kb(off, 'apps-order')[0]); assert.deepEqual(calls.splice(0), [['retryPublish'], ['orderComputer', 'https://kybernos.example.test/computers']])
  assert.equal(kb(off, 'apps-confirm')[0].props.disabled, true); assert.equal(text(kb(off, 'apps-cancel')[0]), 'Cancel'); assert.equal(radios(off).length, 0)
  assert.ok(text(pubDialog({}, cardWith({ can: false, reason: 'hosts-unreachable', hosts: null, hostsError: { message: 'The server said no.' } }))).includes('The server said no.'), 'the host\'s own sentence')
  assert.ok(inFrench(() => text(pubDialog({}, cardWith({ can: false, reason: 'hosts-unreachable', hosts: null })))).includes('Tes ordinateurs cloud ne se sont pas chargés.'))
})
ok('the card asks while it checks, shows a refusal instead of a button, and says why in plain words', () => {
  const wait = pubDialog({}, null)
  assert.ok(text(wait).includes('Checking…')); assert.equal(kb(wait, 'apps-confirm')[0].props.disabled, true, 'nothing to confirm before the facts')
  const failed2 = pubDialog({ error: 'The web app is not answering.' }, null)
  assert.ok(text(failed2).includes('The web app is not answering.')); assert.equal(text(kb(failed2, 'apps-cancel')[0]), 'Close'); assert.equal(kb(failed2, 'apps-where').length, 0, 'no computers to show when the card itself did not come'); assert.equal(kb(failed2, 'apps-confirm').length, 0)
  const sens = pubDialog({}, cardWith({ can: false, reason: 'sensitive', hosts: undefined, blocked: [{ object: 'customer', objectLabel: 'Customers', field: 'iban', fieldLabel: 'IBAN', protection: 'secret' }, { object: 'customer', objectLabel: 'Customers', field: 'notes', fieldLabel: 'Notes', protection: 'sensitive' }] }))
  const s = text(sens)
  assert.ok(s.includes('never sent to a web app') && s.includes('Customers › IBAN (secret)') && s.includes('Customers › Notes (sensitive)'), s)
  assert.equal(kb(sens, 'apps-confirm').length, 0); assert.equal(text(kb(sens, 'apps-cancel')[0]), 'Close'); assert.equal(kb(sens, 'apps-where').length, 0, 'the computers are not asked about an app that cannot go')
  assert.ok(text(pubDialog({}, cardWith({ can: false, reason: 'too-big', bytes: 5 * 1048576 }))).includes('too big to publish in one go (5.0 MB)'))
  for (const [reason, said] of [['archived', 'archived: restore it first'], ['busy', 'already being published or unpublished'], ['published', 'already published'], ['unavailable', 'not available on this computer'], ['whatever', 'can’t be published right now']]) assert.ok(text(pubDialog({}, cardWith({ can: false, reason }))).includes(said), reason)
  assert.ok(inFrench(() => text(pubDialog({}, cardWith({ can: false, reason: 'sensitive', blocked: [{ objectLabel: 'Clients', fieldLabel: 'IBAN', protection: 'sensitive' }] })))).includes('Clients › IBAN (sensible)'))
})
ok('while it publishes the dialog says one honest thing naming the computer, nothing can be closed or pressed twice, and a refusal stays with its sentence and the pick', () => {
  const awake = pubDialog({ host: 'studio', busy: true })
  assert.equal(text(kb(awake, 'apps-publishing-line')[0]), 'Sending the app to Studio'); assert.ok(text(kb(awake, 'apps-publishing')[0]).includes('This can take a minute.')); assert.equal(kb(awake, 'apps-publishing')[0].props.role, 'status')
  assert.equal(text(kb(pubDialog({ host: 'backoffice', busy: true }), 'apps-publishing-line')[0]), 'Waking Backoffice and sending the app')
  assert.equal(text(kb(pubDialog({ host: 'x', busy: true }, cardWith({ hosts: [{ id: 'x', name: 'Old', state: 'stopped' }] })), 'apps-publishing-line')[0]), 'Starting Old and sending the app')
  assert.equal(inFrench(() => text(kb(pubDialog({ host: 'backoffice', busy: true }), 'apps-publishing-line')[0])), 'Réveil de Backoffice et envoi de l’app')
  assert.equal(kb(awake, 'apps-confirm')[0].props.disabled, true); assert.equal(text(kb(awake, 'apps-confirm')[0]), 'Publishing…'); assert.equal(kb(awake, 'apps-cancel')[0].props.disabled, true)
  assert.ok(radios(awake).every((n) => n.props.disabled === true), 'the pick cannot change while it publishes')
  assert.ok(!text(awake).includes('Sleeps when idle'), 'the facts give way to the status line')
  const err = pubDialog({ host: 'backoffice', error: T.errorText({ error: 'host-unavailable', message: 'Backoffice can’t be started right now. Try again in a minute, or pick another computer.' }) })
  assert.equal(kb(err, 'apps-dialog-error')[0].props.role, 'alert'); assert.ok(text(kb(err, 'apps-dialog-error')[0]).startsWith('Backoffice can’t be started right now.'), 'the host\'s own words')
  assert.deepEqual(radios(err).map((n) => n.props['aria-checked']), ['false', 'true'], 'the pick is kept'); assert.equal(kb(err, 'apps-confirm')[0].props.disabled, false, 'and the person can try again')
})
ok('an app whose computer is gone says so on its card, next to its name and under the tabs, keeps the copy safe and offers only the way that keeps it', () => {
  const app = Object.assign({}, APP_PUB, { published: PUB_GONE })
  const card = kb(tree(React.createElement(P.AppCard, { p: pageApi({}), app })), 'apps-card-published')[0]
  assert.equal(text(card), 'Its computer is gone'); assert.ok(card.props.className.includes('bad')); assert.equal(card.props['data-gone'], 'true')
  assert.equal(text(kb(tree(React.createElement(P.AppHeader, { p: pageApi(), title: 'Shop', pill: React.createElement(P.PubPill, { pub: PUB_GONE, hd: true }) })), 'apps-published-pill')[0]), 'Its computer is gone')
  const note = tree(React.createElement(P.PublishedNote, { p: pageApi({ db: app }) }))
  const said = text(note)
  assert.ok(said.includes('Studio no longer exists, so the web app can’t be reached.') && /Your copy here is safe, as it was (just now|\d+ (min|h|d) ago)\./.test(said) && said.includes('forget the web app'), said)
  const box = kb(note, 'apps-published-note')[0]; assert.ok(box.props.className.includes('warn')); assert.equal(box.props['data-gone'], 'true'); assert.equal(box.props.role, 'alert')
  assert.equal(kb(note, 'apps-refresh').length, 0, 'no refresh of what cannot answer'); assert.equal(kb(note, 'apps-unpublish').length, 0)
  const keep = kb(note, 'apps-keep-local')[0]; assert.equal(text(keep), 'Keep my local copy…'); click(keep); assert.deepEqual(calls.splice(0), [['openUnpublish', 'shop', true]], 'straight to the screen that keeps the copy')
  assert.ok(inFrench(() => text(tree(React.createElement(P.PublishedNote, { p: pageApi({ db: app }) })))).includes('n’existe plus, l’app web est donc injoignable.'))
  assert.ok(inFrench(() => text(kb(tree(React.createElement(P.AppCard, { p: pageApi({}), app })), 'apps-card-published')[0])) === 'Son ordinateur n’existe plus')
  const nolast = tree(React.createElement(P.PublishedNote, { p: pageApi({ db: Object.assign({}, APP_PUB, { published: Object.assign({}, PUB_GONE, { lastSync: null }) }) }) }))
  assert.ok(text(nolast).includes('Your copy here is safe. Keep it') && !text(nolast).includes('as it was'), 'no moment to quote')
  const notGone = tree(React.createElement(P.PublishedNote, { p: pageApi({ db: Object.assign({}, APP_PUB, { published: Object.assign({}, PUB, { hostGone: 'yes' }) }) }) }))
  assert.equal(kb(notGone, 'apps-published-note')[0].props['data-gone'], undefined, 'only a true says it')
})
const unpubDialog = (extra) => tree(React.createElement(P.Dialogs, { p: pageApi({ dbs: [APP_PUB], dialog: Object.assign({ kind: 'unpublish', db: 'shop', forget: false, canForget: false, busy: false, error: null }, extra) }) }))
ok('Unpublish says what comes back and what goes, and offers the way that keeps this computer\'s copy only when the web app could not be reached', () => {
  const t = unpubDialog()
  const said = text(t)
  assert.ok(said.includes('Unpublish “Shop”?') && said.includes('as it is in the web app right now') && said.includes('Is taken down') && said.includes('publish it again later'), said)
  assert.equal(kb(t, 'apps-forget').length, 0); assert.equal(kb(t, 'apps-typed').length, 0, 'nothing to type for the normal way')
  assert.equal(kb(t, 'apps-confirm')[0].props.disabled, false); assert.equal(text(kb(t, 'apps-confirm')[0]), 'Unpublish'); assert.ok(kb(t, 'apps-confirm')[0].props.className.includes('danger'))
  click(kb(t, 'apps-confirm')[0]); assert.deepEqual(calls.splice(0), [['runDialog', '']])
  const stuck = unpubDialog({ error: T.errorText({ error: 'unreachable' }), canForget: true })
  assert.ok(text(stuck).includes('not answering')); click(kb(stuck, 'apps-forget')[0]); assert.deepEqual(calls.splice(0), [['startForget']])
  assert.equal(text(kb(unpubDialog({ busy: true }), 'apps-confirm')[0]), 'Unpublishing…'); assert.equal(kb(unpubDialog({ busy: true }), 'apps-cancel')[0].props.disabled, true)
})
ok('keeping the local copy and forgetting the web app is behind the app\'s typed name, says the web app is left as it is, and has no other way in', () => {
  const t = unpubDialog({ forget: true, canForget: true, error: 'x' })
  const said = text(t)
  assert.ok(said.includes('Keep the local copy of “Shop”?') && said.includes('without asking it anything') && said.includes('Left as it is, online') && said.includes('Synced 3 min ago') === false, said)
  assert.ok(said.includes('As it was ') && said.includes('Type the name to confirm: Shop'), said)
  assert.equal(kb(t, 'apps-typed').length, 1); assert.equal(kb(t, 'apps-confirm')[0].props.disabled, true, 'the name is not typed yet'); assert.equal(kb(t, 'apps-forget').length, 0, 'already there')
  assert.ok(text(kb(t, 'apps-confirm')[0]).includes('forget the web app'))
  assert.equal(T.errorText({ error: 'confirm' }), 'The name typed is not the right one.')
})
ok('every refusal Publish can give has a sentence of its own, in both languages, and none is the generic one', () => {
  const generic = T.errorText({ error: 'zzz' })
  for (const code of ['unreachable', 'refused', 'space', 'rate-limited', 'hosting-failed', 'mismatch', 'changed', 'db-exists', 'sensitive', 'budget', 'unknown-host', 'host-gone', 'host-unavailable', 'hosts-unreachable', 'busy', 'not-published', 'registry', 'too-large', 'unavailable', 'failed', 'popup', 'published', 'confirm']) {
    const en = T.errorText({ error: code }); const fr = inFrench(() => T.errorText({ error: code }))
    assert.ok(en.length > 10 && en !== generic && fr.length > 10 && fr !== en, code)
  }
  assert.equal(T.errorText({ error: 'other-code', message: 'The host says this.' }), 'The host says this.', 'a code the page does not know shows the host\'s own words')
})
await okAsync('Open web app opens its tab first, inside the click, then points it at the one-time link; the link goes nowhere else', async () => {
  const log = []
  const win = { opener: 'the page', closed: false, location: { set href (v) { log.push(['href', v]) } }, close () { this.closed = true } }
  let answer
  const pending = new Promise((resolve) => { answer = resolve })
  const run = T.openWebApp('shop', { open: (url, target) => { log.push(['open', url, target]); return win }, call: async (m, path, body) => { log.push(['call', m, path, body]); return pending } })
  assert.deepEqual(log, [['open', '', '_blank'], ['call', 'POST', '/open-web', { db: 'shop' }]], 'the tab exists before the host has answered: a pop-up blocker sees a click, not a timer')
  assert.equal(win.opener, null, 'the new tab cannot reach this page')
  answer({ ok: true, url: 'https://team.example.test/open?t=abc.def' })
  assert.deepEqual(await run, { ok: true }); assert.deepEqual(log.slice(2), [['href', 'https://team.example.test/open?t=abc.def']]); assert.equal(win.closed, false)
  const blocked = await T.openWebApp('shop', { open: () => null, call: async () => { throw new Error('must not ask the host when there is no tab') } })
  assert.deepEqual(blocked, { ok: false, error: 'popup' }); assert.equal((await T.openWebApp('shop', { open: () => { throw new Error('blocked') }, call: async () => ({ ok: true }) })).error, 'popup')
  const refused = { opener: 'x', closed: false, location: {}, close () { this.closed = true } }
  const r1 = await T.openWebApp('shop', { open: () => refused, call: async () => ({ ok: false, error: 'unreachable', message: 'x' }) })
  assert.equal(r1.error, 'unreachable'); assert.equal(refused.closed, true, 'a tab that goes nowhere is closed')
  for (const url of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'not a url', undefined]) {
    const w = { opener: 'x', closed: false, location: {}, close () { this.closed = true } }
    const r = await T.openWebApp('shop', { open: () => w, call: async () => ({ ok: true, url }) })
    assert.deepEqual(r, { ok: false, error: 'failed' }, String(url)); assert.equal(w.closed, true); assert.equal(w.location.href, undefined, 'never pointed at ' + url)
  }
})
ok('the page never keeps, shows or logs the one-time link, and never saves a view of a published app', () => {
  assert.equal((source.match(/\br\.url\b/g) || []).length, 1, 'the link is read in one place: the helper that opens the tab')
  assert.equal(/console\.(log|warn|info|error)\([^)]*(\.url|href)/.test(source), false)
  assert.ok(source.includes("const local = pubOf(L.db) !== null") && source.includes('if (!local) schedule(id, now === true)'), 'a published app\'s view edits are never scheduled for saving')
  assert.ok(source.includes('if (e.local !== true) call(') && source.includes('entry.local === true) return'), 'neither the unmount flush nor a late save sends them')
  assert.ok(source.includes('pubOf(db) !== null) return // a published app'), 'the plain default view is not created on a published app')
})

console.log('── files ──')
const FILES = TASK.fields.find((f) => f.key === 'files')
const HASH = (c) => c.repeat(64)
const PNG = { name: 'logo.png', size: 2048, type: 'image/png', hash: HASH('a') }
const PDF = { name: 'contract.pdf', size: 300000, type: 'application/pdf', hash: HASH('b') }
const TXT = { name: 'notes.txt', size: 12, type: 'text/plain', hash: HASH('c') }
const SVG = { name: 'mark.svg', size: 90, type: 'image/svg+xml', hash: HASH('d') }
ok('a file is read from the host by the row that holds it; a picture is drawn and opens in a tab, the rest (a PDF, an SVG, a text) is a download', () => {
  assert.equal(T.fileUrl('db1', 'task', 'r1', FILES, PNG), '/kybernos-db/file?db=db1&object=task&id=r1&field=files&hash=' + HASH('a'))
  assert.equal(T.isImage(PNG), true); assert.equal(T.isImage(PDF), false); assert.equal(T.isImage(SVG), false, 'an SVG can hold a script: it is never drawn')
  assert.equal(T.isImage({ type: 'IMAGE/PNG' }), true, 'a type is compared without its case'); assert.equal(T.isImage({ type: 'text/html' }), false)
})
await okAsync('a body goes to the host as JSON, a read as no body at all, and a refusal is an answer', async () => {
  const sent = []
  const real = globalThis.fetch
  globalThis.fetch = async (url, init) => { sent.push([url, init]); return { status: 409, json: async () => ({ ok: false, error: 'not-archived' }) } }
  try {
    const r = await T.call('POST', '/app', { db: 'db1', op: 'delete' })
    assert.deepEqual(r, { ok: false, error: 'not-archived' })
    assert.equal(sent[0][1].headers['content-type'], 'application/json'); assert.equal(sent[0][1].body, '{"db":"db1","op":"delete"}')
    await T.call('GET', '/state')
    assert.deepEqual(sent[1][1].headers, {}); assert.equal(sent[1][1].body, undefined)
  } finally { globalThis.fetch = real }
})
ok('the cells of a field of files: a thumbnail for a picture, a name for the rest, each opening its file; nothing takes one off', () => {
  const row = rec('r1', { name: 'x', files: [PNG, PDF, TXT, SVG] })
  const ctx = Object.assign({}, CTX, { fileUrl: (f, r, file) => T.fileUrl('db1', 'task', r.id, f, file) })
  const t = tree(React.createElement(P.Cell, { field: FILES, rec: row, ctx }))
  const chips = kb(t, 'tables-file')
  assert.equal(chips.length, 3, 'three at most, the rest is counted'); assert.equal(text(t).includes('+1'), true)
  const imgs = all(t, (n) => n.type === 'img')
  assert.equal(imgs.length, 1); assert.ok(imgs[0].props.src.startsWith('/kybernos-db/file?db=db1&object=task&id=r1&field=files&hash=' + HASH('a'))); assert.equal(imgs[0].props.alt, '')
  const links = all(t, (n) => n.type === 'a')
  assert.equal(links[0].props.target, '_blank'); assert.ok(links[0].props.rel.includes('noopener'), 'a picture opens in a tab that cannot reach the page')
  assert.equal(links[1].props.download, 'contract.pdf'); assert.equal(links[1].props.target, undefined, 'a PDF is a download, never a document of DSH\'s own origin')
  assert.equal(links[2].props.download, 'notes.txt'); assert.equal(links[2].props.target, undefined, 'a text file is only ever downloaded')
  assert.ok(links[2].props['aria-label'].includes('notes.txt'))
  let stopped = 0
  links[0].props.onClick({ stopPropagation () { stopped += 1 } }); assert.equal(stopped, 1, 'opening a file does not open the row')
  assert.equal(kb(t, 'tables-file-remove').length, 0, 'no × on a file: Kaby changes what a row holds')
  const bare = tree(React.createElement(P.Cell, { field: FILES, rec: row, ctx: CTX }))
  assert.equal(kb(bare, 'tables-file').length, 0, 'a caller with no way to read files still gets the count'); assert.equal(text(bare).includes('4 files'), true)
  assert.equal(kb(tree(React.createElement(P.Cell, { field: FILES, rec: rec('r2', { name: 'y' }), ctx })), 'tables-file').length, 0, 'a row with no file draws nothing')
})
ok('a thumbnail that cannot be read falls back to the file\'s icon instead of a broken picture', () => {
  const t = tree(React.createElement(P.Thumb, { src: '/x', cls: 'kbtb-thumb' }))
  assert.equal(all(t, (n) => n.type === 'img').length, 1); assert.equal(typeof all(t, (n) => n.type === 'img')[0].props.onError, 'function')
})

console.log('── errors and the host ──')
ok('each answer of the host has a sentence, and an unknown refusal shows the host\'s own words', () => {
  for (const code of ['network', 'sign-in required', 'origin refused', 'sqlite_unavailable', 'db_newer', 'not_a_db', 'unknown_object', 'missing', 'deleted', 'unknown_db', 'archived', 'not-archived', 'published', 'confirm']) assert.ok(T.errorText({ error: code }).length > 10, code)
  assert.equal(T.errorText({ error: 'invalid', message: 'name: a name is 1 to 60 characters' }), 'name: a name is 1 to 60 characters')
  assert.ok(T.errorText({ error: 'invalid' }).length > 10)
  assert.ok(T.errorText(undefined).length > 10)
})
ok('the query string leaves out what is empty and encodes the rest', () => {
  assert.equal(T.qs({ db: 'a b', object: 'task', deleted: false, q: '' }), '?db=a%20b&object=task')
  assert.equal(T.qs({ deleted: true }), '?deleted=1')
})

console.log('── promises a browser would only break late ──')
ok('the page imports the core from the host it came from, and asks one other host, for the map and only the map, without a cookie', () => {
  assert.ok(source.includes("const BASE = '/kybernos-db'") && source.includes("const CORE_URL = BASE + '/core/index.mjs'"))
  assert.equal((source.match(/\bfetch\(/g) || []).length, 2, 'two doors to the network: the host, and the map style')
  assert.ok(source.includes("fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', signal })"), 'the style is asked with no cookie and no referrer')
  const hosts = [...new Set((source.replace(/\/\/ .*$/gm, '').match(/https?:\/\/[^'"\s)/]+/g) || []).map((a) => a.replace(/^https?:\/\//, '')))].sort()
  assert.deepEqual(hosts, ['openfreemap.org', 'tiles.openfreemap.org', 'www.openmaptiles.org', 'www.openstreetmap.org'], 'the style host the manifest names, and the credits the data licences ask for')
  assert.equal((source.match(/\bimport\(/g) || []).length, 1, 'one dynamic import')
})
ok('colours come from DSH\'s tokens or from a hue, never a literal', () => {
  const css = T.CSS
  const literals = css.match(/#[0-9a-fA-F]{3,8}\b/g) || []
  assert.deepEqual(literals.filter((c) => c.toLowerCase() !== '#fff'), [], 'only the white fallback of a token')
  assert.equal(/(rgb|hsl)a?\(\s*\d/.test(css), false, 'no literal colour function')
  assert.ok(css.includes('prefers-reduced-motion'))
  assert.ok(/--dsw-alias-/.test(css))
})
ok('every class of the page is its own: the prefix is not used by another bundle', () => {
  const classes = new Set((T.CSS.match(/\.kbtb-[a-z0-9-]+/g) || []))
  assert.ok(classes.size > 80)
  for (const c of classes) assert.ok(c.startsWith('.kbtb-'), c)
})
ok('the page never writes HTML from data', () => {
  assert.equal(/dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|document\.write/.test(source), false)
  assert.equal(/\beval\(|new Function\(/.test(source), false)
})
ok('the page text never holds a secret: cells and chips go through the mask', () => {
  const secret = TASK.fields.find((f) => f.key === 'token')
  assert.equal(T.cellText(secret, 'x', CTX), T.MASK)
  assert.equal(T.valueText(TASK, { k: 'token', op: 'is', v: 'x' }, CTX).length > 0, true, 'a filter value the person typed is theirs to see')
})

process.stdout.write('\nkybernos-db client: ' + (failed === 0 ? 'all checks passed' : failed + ' failed') + '\n')
process.exit(failed === 0 ? 0 : 1)
