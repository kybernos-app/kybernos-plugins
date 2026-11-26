// The SQL tab of the database viewer (audit L1-05): it must start on a query that fits THE DATABASE CHOSEN, not on the fixed
// `SELECT * FROM societes LIMIT 20` of the mini-CRM sample (which turned the first « Run » on any other database into a red SQL
// error for a query nobody had written), and what is on screen (query, result) must not survive a change of database.
// The real TabBody runs here on a tiny synchronous renderer (it honours React keys), with a scripted host.
//
//   node packages/dsh-db-viewer/test-sql-start.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let ko = 0
const ok = (titre, cond, detail = '') => {
  console.log(`${cond ? '✓' : '✗'} ${titre}${detail ? ' — ' + detail : ''}`)
  if (!cond) ko += 1
}

// ── the renderer ──────────────────────────────────────────────────────────────
const store = new Map()
let current = null
let dirty = false
const slot = () => { const k = current.i; current.i += 1; if (current.hooks[k] === undefined) current.hooks[k] = {}; return current.hooks[k] }
const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
const React = {
  Fragment: 'Fragment',
  createElement: (type, props, ...kids) => ({ type, props: props || {}, kids: kids.flat(Infinity) }),
  useState: (init) => {
    const s = slot()
    if (!('v' in s)) s.v = typeof init === 'function' ? init() : init
    return [s.v, (n) => { const nv = typeof n === 'function' ? n(s.v) : n; if (!Object.is(nv, s.v)) { s.v = nv; dirty = true } }]
  },
  useRef: (init) => { const s = slot(); if (!('r' in s)) s.r = { current: init }; return s.r },
  useCallback: (f, deps) => { const s = slot(); if (!same(s.deps, deps)) { s.deps = deps; s.f = f } return s.f },
  useEffect: (f, deps) => { const s = slot(); if (s.deps === undefined || !same(s.deps, deps)) { s.deps = deps; current.effects.push(() => { if (typeof s.cleanup === 'function') s.cleanup(); s.cleanup = f() }) } },
}
// A component keeps its state while its place AND its key stay the same; a new key is a new component (as in React).
const seen = new Set()
const expand = (node, path) => {
  if (node === null || node === undefined || typeof node === 'boolean') return null
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (typeof node.type === 'function') {
    const key = path + '/' + node.type.name + '#' + String(node.props.key ?? '')
    seen.add(key)
    let inst = store.get(key)
    if (inst === undefined) { inst = { hooks: [], i: 0, effects: [] }; store.set(key, inst) }
    inst.i = 0; inst.effects = []
    current = inst
    const out = node.type({ ...node.props, children: node.kids })
    const effects = inst.effects
    const tree = expand(out, key)
    for (const e of effects) e()
    return tree
  }
  return { tag: node.type, props: node.props, kids: node.kids.map((k, n) => expand(k, path + '.' + n)).filter((k) => k !== null) }
}
const textOf = (t) => (t === null ? '' : typeof t === 'string' ? t : (t.kids || []).map(textOf).join(' '))
const findAll = (t, pred, out = []) => { if (t === null || typeof t === 'string') return out; if (pred(t)) out.push(t); for (const k of t.kids) findAll(k, pred, out); return out }

// ── a scripted host: four databases ───────────────────────────────────────────
const col = [{ name: 'id', type: 'integer', pk: true }]
const SCHEMAS = {
  clients: { tables: [{ nom: 'clients', compte: 2, colonnes: col }, { nom: 'factures', compte: 1, colonnes: col }], relations: [] },
  crm: { tables: [{ nom: 'societes', compte: 3, colonnes: col }], relations: [] },
  vide: { tables: [], relations: [] },
  'o"dd': { tables: [{ nom: 'we"ird', compte: 1, colonnes: col }], relations: [] },
}
const queries = []
let latence = false // a real host answers after the render that asked: the screen shows « Reading the schema… » in between
const fetchFake = async (url) => {
  if (latence) await new Promise((r) => setTimeout(r, 5))
  const u = new URL(String(url))
  const json = (status, body) => ({ ok: status < 400, status, statusText: String(status), json: async () => body })
  if (u.pathname.endsWith('/bases')) return json(200, { bases: Object.keys(SCHEMAS).map((id) => ({ id })) })
  if (u.pathname.endsWith('/schema')) return json(200, SCHEMAS[u.searchParams.get('base')])
  if (u.pathname.endsWith('/query')) {
    if (!/FROM pack/.test(u.searchParams.get('sql'))) queries.push({ base: u.searchParams.get('base'), sql: u.searchParams.get('sql') }) // not the viewer's own pack read
    return json(200, { colonnes: ['id'], lignes: [{ id: 1 }], compte: 1, total: 1, tronque: false })
  }
  return json(200, { lignes: [] })
}

let def = null
globalThis.window = { __ModuleLoader__: { load: (d) => { def = d } }, location: { origin: 'http://127.0.0.1:3080' }, fetch: fetchFake, matchMedia: () => ({ matches: false }), addEventListener: () => {}, removeEventListener: () => {} }
const elFactice = () => ({ style: {}, appendChild: () => {}, remove: () => {}, setAttribute: () => () => {}, getContext: () => null, getElementsByTagName: () => [], classList: { contains: () => false } })
globalThis.document = { createElement: elFactice, createTextNode: elFactice, getElementById: () => null, head: elFactice(), body: elFactice(), documentElement: elFactice(), getElementsByTagName: () => [], querySelector: () => null }
if (globalThis.navigator === undefined) globalThis.navigator = { userAgent: 'test' }
new Function(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client', 'client.js'), 'utf8'))()
const plugin = def.factory((n) => (n === 'react' ? React : null))
let TabBody = null
const slots = { register: (spec, comp) => { TabBody = comp; return () => {} }, inject: (n, f) => { f(); return () => {} } }
plugin.apply({ effect: (f) => { if (typeof f === 'function') f() }, get: (s) => (s === 'slots' ? slots : { register: () => () => {} }), slots })
ok('the tab body is registered', typeof TabBody === 'function')

let tree = null
const pass = () => {
  seen.clear()
  tree = expand(React.createElement(TabBody, {}), 'root')
  for (const k of [...store.keys()]) if (!seen.has(k)) store.delete(k) // unmounted: its state is gone
}
const settle = async () => { for (let n = 0; n < 12; n += 1) { await new Promise((r) => setTimeout(r, latence ? 4 : 0)); if (dirty) { dirty = false; pass() } } }
const box = () => findAll(tree, (n) => n.tag === 'textarea')[0]
const run = () => findAll(tree, (n) => n.props && n.props.className === 'dshdb-run')[0]
const pill = (label) => findAll(tree, (n) => n.props && /dshdb-pill/.test(String(n.props.className)) && textOf(n) === label)[0]
const select = () => findAll(tree, (n) => n.tag === 'select')[0]
const choose = async (id) => { select().props.onChange({ target: { value: id } }); await settle() }

pass()
await settle()
ok('the first database is read (clients, no societes)', select().props.value === 'clients')
pill('SQL').props.onClick()
await settle()

ok('the SQL tab is open', box() !== undefined)
ok('it starts on the first table of THIS database', box().props.value === 'SELECT * FROM "clients" LIMIT 20', JSON.stringify(box().props.value))
ok('...and never on the fixed table of the mini-CRM sample', !/societes/.test(box().props.value))

run().props.onClick()
await settle()
ok('Run asks the host for exactly that query', queries.length === 1 && queries[0].sql === 'SELECT * FROM "clients" LIMIT 20' && queries[0].base === 'clients', JSON.stringify(queries))
ok('...and the result is on screen', findAll(tree, (n) => n.tag === 'table').length === 1)

box().props.onChange({ target: { value: 'SELECT 42' } })
await settle()
ok('a query typed by the person is kept', box().props.value === 'SELECT 42')

await choose('crm')
ok('choosing another database while on SQL: the typed query is gone, the new database\'s first table is proposed',
  box().props.value === 'SELECT * FROM "societes" LIMIT 20', JSON.stringify(box().props.value))
ok('...and the result of the old database is gone', findAll(tree, (n) => n.tag === 'table').length === 0)

await choose('vide')
ok('a database without any table: the box starts empty (an example sits in the placeholder)', box().props.value === '' && /SELECT/.test(String(box().props.placeholder)),
  JSON.stringify([box().props.value, box().props.placeholder]))
ok('...and Run is not offered on nothing', run().props.disabled === true)
box().props.onChange({ target: { value: 'SELECT 1' } })
await settle()
ok('...it is as soon as something is typed', run().props.disabled === false)

await choose('o"dd')
ok('a table name with a double quote is quoted safely', box().props.value === 'SELECT * FROM "we""ird" LIMIT 20', JSON.stringify(box().props.value))

// The same journey against a host that answers a few milliseconds later (what a real one does).
latence = true
await choose('clients')
ok('with a slow host: the first table of the database chosen', box() !== undefined && box().props.value === 'SELECT * FROM "clients" LIMIT 20', JSON.stringify(box() && box().props.value))
box().props.onChange({ target: { value: 'SELECT 7' } })
await settle()
await choose('crm')
ok('with a slow host: another database, another start', box() !== undefined && box().props.value === 'SELECT * FROM "societes" LIMIT 20', JSON.stringify(box() && box().props.value))

console.log(ko === 0 ? '\nOK' : `\n${ko} failure(s)`)
process.exit(ko === 0 ? 0 : 1)
