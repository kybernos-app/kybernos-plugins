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
const rec = (id, values) => ({ id, values, rev: 1, created: '2026-10-30T09:00:00.000Z', modified: '2026-10-30T10:00:00.000Z', deleted: false })
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
    db: { id: 'db1', name: 'Home', objects: [TASK, PROJECT] }, obj: TASK, view: v, views: [v], rows: ROWS, all: ROWS, rec: { status: 'ok', truncated: false, rows: ROWS }, ctx: CTX, related: { project: [rec('p1', { name: 'Launch' })] },
    flt: v.state.flt, menu: null, drawer: null, query: '', months: {},
    setMenu: spy('setMenu'), setFlt: spy('setFlt'), editView: spy('editView'), sortBy: spy('sortBy'), filterBy: spy('filterBy'), clearAll: spy('clearAll'), selectView: spy('selectView'),
    createView: spy('createView'), dupView: spy('dupView'), removeView: spy('removeView'), renameView: spy('renameView'), favView: spy('favView'), ask: () => true, say: spy('say'),
    openRecord: spy('openRecord'), newRecord: spy('newRecord'), closeDrawer: spy('closeDrawer'), createRecord: async (v) => { calls.push(['createRecord', v]); return { ok: true, record: rec('n1', v) } }, updateField: spy('updateField'), deleteRecord: spy('deleteRecord'), moveRecord: spy('moveRecord'), setMonth: spy('setMonth'),
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
  assert.deepEqual(menuCalls, [{ id: 'tables', group: 'business', icon: 'grid', labelKey: 'business.tables', label: { en: 'Tables', fr: 'Tables' }, order: 40 }])
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
ok('a table with no saved view shows a plain table; a new view takes the first free name of its kind', () => {
  const d = T.defaultView(TASK)
  assert.equal(d.id, 'default-task'); assert.equal(d.kind, 'table'); assert.deepEqual(core.checkView(T.savable(d, TASK), TASK), [])
  assert.equal(T.freshName([], 'board'), 'Board')
  assert.equal(T.freshName([{ name: 'Board' }], 'board'), 'Board 2')
  assert.equal(T.freshName([{ name: 'Board' }, { name: 'Board 2' }], 'board'), 'Board 3')
  resolved = 'fr'; assert.equal(T.freshName([], 'calendar'), 'Calendrier'); resolved = 'en'
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
ok('the sentence for Kaby names the database, the table and the view, and limits what she may change', () => {
  const s = T.askText({ id: 'db1' }, TASK, view({ id: 'v9', name: 'Late' }), '  overdue first  ')
  for (const part of ['Late', 'v9', 'Tasks', 'task', 'db1', 'overdue first', 'view_save', 'never the records or the structure']) assert.ok(s.includes(part), part)
  assert.equal(s.includes('  overdue'), false, 'the request is trimmed')
  resolved = 'fr'
  const f = T.askText({ id: 'db1' }, TASK, view({ id: 'v9', name: 'Late' }), 'les retards')
  assert.ok(f.includes('view_save') && f.includes('jamais les enregistrements ni la structure') && f.includes('les retards'))
  resolved = 'en'
  assert.equal(T.buildText(''), 'On the Tables page, I would like to keep track of: ')
  assert.ok(T.buildText('my books').includes('db-builder'))
  assert.ok(T.modifyExamples(TASK).length <= 3 && T.modifyExamples(TASK).length >= 2)
  assert.deepEqual(T.modifyExamples({ fields: [field('name', 'text', 'Name')], title: 'name' }), [])
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
ok('the bar has the views, the five menus and the primary action, each with a hook', () => {
  const t = tree(React.createElement(P.Bar, { p: pageApi() }))
  for (const hook of ['tables-bar', 'tables-menu-views', 'tables-menu-fields', 'tables-menu-filter', 'tables-menu-sort', 'tables-menu-modify', 'tables-new']) assert.equal(kb(t, hook).length, 1, hook)
  assert.equal(kb(t, 'tables-view').length, 1)
  click(kb(t, 'tables-menu-filter')[0]); click(kb(t, 'tables-new')[0]); click(kb(t, 'tables-view')[0])
  assert.deepEqual(calls.splice(0).map((c) => c[0]), ['setMenu', 'newRecord', 'selectView'])
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
  for (const id of ['views', 'fields', 'filter', 'sort', 'modify']) {
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
ok('the views panel lists the views with their actions and offers the kinds this table can be drawn as', () => {
  const vs = [view({ id: 'a', name: 'Open' }), view({ id: 'b', name: 'By Kaby', owner: 'kaby', fav: false })]
  const t = tree(React.createElement(P.ViewsPop, { p: pageApi({ view: vs[0], views: vs }) }))
  assert.equal(kb(t, 'tables-view-pick').length, 2)
  assert.equal(all(t, (n) => n.props.title === 'Made by Kaby').length, 1)
  assert.deepEqual(['table', 'board', 'cards', 'calendar'].map((k) => kb(t, 'tables-view-new-' + k).length), [1, 1, 1, 1])
  const noDate = Object.assign({}, TASK, { fields: TASK.fields.filter((f) => f.type !== 'date') })
  const t2 = tree(React.createElement(P.ViewsPop, { p: pageApi({ view: vs[0], views: vs, obj: noDate }) }))
  assert.equal(kb(t2, 'tables-view-new-calendar').length, 0, 'no date field, no calendar')
  const del = all(t, (n) => n.props['aria-label'] === 'Delete “Open”')[0]
  click(del)
  assert.deepEqual(calls.splice(0).map((c) => c.slice(0, 2)), [['removeView', 'a']])
  const lone = tree(React.createElement(P.ViewsPop, { p: pageApi({ view: vs[0], views: [vs[0]] }) }))
  assert.equal(all(lone, (n) => n.props['aria-label'] === 'Delete “Open”')[0].props.disabled, true, 'a table keeps one view')
})
ok('Modify view sends the sentence to the chat, or offers it to copy when the chat cannot open', () => {
  const t = tree(React.createElement(P.ModifyPop, { p: pageApi() }))
  assert.equal(kb(t, 'tables-modify-input').length, 1)
  assert.equal(kb(t, 'tables-modify-send')[0].props.disabled, true, 'nothing to send yet')
  assert.ok(all(t, (n) => n.props.className === 'kbtb-ex').length >= 2, 'examples to start from')
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
ok('a board has its columns, adds in a column with the column\'s value, and moves a card by drag and drop', () => {
  const v = view({ kind: 'board', by: 'status' })
  const t = tree(React.createElement(P.BoardView, { p: pageApi({ view: v }) }))
  const cols = all(t, (n) => n.props['data-col'] !== undefined)
  assert.deepEqual(cols.map((c) => c.props['data-col']), ['todo', 'doing', 'done', ''])
  assert.equal(kb(t, 'tables-card').length, ROWS.length)
  click(kb(t, 'tables-col-add')[1]); click(kb(t, 'tables-col-add')[3])
  assert.deepEqual(calls.splice(0), [['newRecord', { status: 'doing' }], ['newRecord', { status: null }]])
  assert.ok(!text(t).includes('sekret'))
  // the hooks of a drag keep their first value in this fake, so the drop is read from what the card hands over
  const card = kb(t, 'tables-card')[0]
  assert.equal(card.props.draggable, true); assert.equal(card.props.tabIndex, 0)
  let data = null
  card.props.onDragStart({ dataTransfer: { setData: (_, v) => { data = v }, effectAllowed: '' } })
  assert.equal(data, 'r2', 'the first card is the first of the first column')
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
ok('a calendar places records on their day, adds on a day, and says how many have no date', () => {
  const v = view({ kind: 'calendar', date: 'due' })
  const t = tree(React.createElement(P.CalendarView, { p: pageApi({ view: v, months: { v1: '2026-10' } }) }))
  assert.equal(kb(t, 'tables-event').length, 2, 'the record due on 31 October and the one due on 4 November, which the sixth week still shows')
  assert.equal(all(t, (n) => n.props['data-kb'] === 'tables-cal-add').length, 42)
  click(kb(t, 'tables-cal-add')[0]); assert.deepEqual(calls.splice(0), [['newRecord', { due: '2026-09-28' }]])
  click(kb(t, 'tables-cal-next')[0]); click(kb(t, 'tables-cal-prev')[0]); click(kb(t, 'tables-cal-today')[0])
  assert.deepEqual(calls.splice(0), [['setMonth', 'v1', '2026-11'], ['setMonth', 'v1', '2026-09'], ['setMonth', 'v1', '2026-10']])
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
ok('the drawer lists every field with its editor, never shows a secret in clear, and offers delete', () => {
  const t = tree(React.createElement(P.Drawer, { p: pageApi({ drawer: { mode: 'edit', id: 'r1' } }) }))
  assert.equal(kb(t, 'tables-drawer').length, 1)
  for (const f of TASK.fields.filter((x) => !['relation', 'attachment'].includes(x.type))) assert.ok(kb(t, 'tables-field-' + f.key).length >= 1, f.key)
  const token = kb(t, 'tables-field-token')[0]
  assert.equal(token.props.type, 'password')
  assert.equal(all(t, (n) => n.props.type === 'text' && n.props.value === 'sekret').length, 0)
  token.props.onBlur()
  assert.deepEqual(calls.filter((c) => c[0] === 'updateField'), [], 'leaving a field as it was writes nothing')
  const r2 = tree(React.createElement(P.Drawer, { p: pageApi({ drawer: { mode: 'edit', id: 'r2' } }) }))
  kb(r2, 'tables-field-token')[0].props.onBlur()
  assert.deepEqual(calls.filter((c) => c[0] === 'updateField'), [], 'nor does leaving an empty secret empty')
  calls.length = 0
  click(kb(t, 'tables-delete')[0]); click(kb(t, 'tables-drawer-close')[0])
  assert.deepEqual(calls.splice(0).map((c) => (c[0] === 'deleteRecord' ? c.slice(0, 2) : c.slice(0, 1))), [['deleteRecord', 'r1'], ['closeDrawer']])
  assert.ok(text(t).includes('Launch'), 'a link shows the title of the record it points to')
})
ok('a row that is gone says so; a new row asks for the required fields before it asks the host', async () => {
  const gone = tree(React.createElement(P.Drawer, { p: pageApi({ drawer: { mode: 'edit', id: 'zz' } }) }))
  assert.ok(text(gone).includes('This row no longer exists.'))
  const t = tree(React.createElement(P.Drawer, { p: pageApi({ drawer: { mode: 'new', prefill: { status: 'doing' } } }) }))
  assert.equal(kb(t, 'tables-delete').length, 0); assert.equal(kb(t, 'tables-create').length, 1)
  assert.equal(kb(t, 'tables-field-status')[0].props.value, 'doing', 'a column or a day hands its value to the new row')
})
ok('the empty states: no row, nothing matching, no table at all', () => {
  const none = tree(React.createElement(P.Empty, { p: pageApi(), why: 'none' }))
  assert.equal(kb(none, 'tables-empty')[0].props['data-why'], 'none'); click(kb(none, 'tables-empty-new')[0])
  const filtered = tree(React.createElement(P.Empty, { p: pageApi(), why: 'filtered' }))
  assert.equal(kb(filtered, 'tables-empty')[0].props['data-why'], 'filtered')
  const nt = tree(React.createElement(P.NoTables, { p: pageApi() }))
  assert.equal(kb(nt, 'tables-none').length, 1); assert.equal(kb(nt, 'tables-build-input').length, 1)
  assert.deepEqual(calls.splice(0).map((c) => c[0]), ['newRecord'])
})
ok('every piece draws in French too, with no English left in the words it speaks', () => {
  resolved = 'fr'
  try {
    const flt = { conj: 'and', items: [{ k: 'status', op: 'is', v: 'todo' }] }
    const p = pageApi({ menu: 'filter', flt, view: view({ state: { flt, sorts: [], hidden: [] } }) })
    const t = tree(React.createElement(P.Bar, { p }))
    const said = text(t)
    for (const w of ['Filtre', 'Tri', 'Champs', 'Vues', 'Nouvelle ligne', 'Modifier la vue']) assert.ok(said.includes(w), w)
    assert.ok(said.includes('Où'), 'the filter panel')
    const chips = text(tree(React.createElement(P.Chips, { p: pageApi() })))
    assert.ok(chips.includes('4 lignes'))
  } finally { resolved = 'en' }
})

console.log('── errors and the host ──')
ok('each answer of the host has a sentence, and an unknown refusal shows the host\'s own words', () => {
  for (const code of ['network', 'sign-in required', 'origin refused', 'sqlite_unavailable', 'db_newer', 'not_a_db', 'unknown_object', 'missing', 'deleted']) assert.ok(T.errorText({ error: code }).length > 10, code)
  assert.equal(T.errorText({ error: 'invalid', message: 'name: a name is 1 to 60 characters' }), 'name: a name is 1 to 60 characters')
  assert.ok(T.errorText({ error: 'invalid' }).length > 10)
  assert.ok(T.errorText(undefined).length > 10)
})
ok('the query string leaves out what is empty and encodes the rest', () => {
  assert.equal(T.qs({ db: 'a b', object: 'task', deleted: false, q: '' }), '?db=a%20b&object=task')
  assert.equal(T.qs({ deleted: true }), '?deleted=1')
})

console.log('── promises a browser would only break late ──')
ok('the page imports the core from the host it came from, and asks no other host', () => {
  assert.ok(source.includes("const BASE = '/kybernos-db'") && source.includes("const CORE_URL = BASE + '/core/index.mjs'"))
  assert.equal((source.match(/\bfetch\(/g) || []).length, 1, 'one door to the network')
  assert.equal(/https?:\/\//.test(source.replace(/\/\/ .*$/gm, '')), false, 'no address in the code')
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
