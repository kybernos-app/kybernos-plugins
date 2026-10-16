// The database viewer, when the person changes database (audit A4-21): the error of a database that could not be read belongs to
// THAT database. It used to stay as a red box above every healthy database chosen afterwards, and the bar went on saying that it was
// reading the schema of the broken one. The real TabBody runs here on a tiny synchronous renderer, with a scripted host.
//
//   node packages/dsh-db-viewer/test-base-change.mjs
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
const expand = (node, path) => {
  if (node === null || node === undefined || typeof node === 'boolean') return null
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (typeof node.type === 'function') {
    const key = path + '/' + node.type.name
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

// ── a scripted host ───────────────────────────────────────────────────────────
const SCHEMA = { tables: [{ nom: 'societes', compte: 2, colonnes: [{ name: 'id', type: 'integer', pk: true }] }], relations: [] }
const asked = []
const fetchFake = async (url) => {
  const u = new URL(String(url))
  asked.push(u.pathname + '?base=' + u.searchParams.get('base'))
  const json = (status, body) => ({ ok: status < 400, status, statusText: String(status), json: async () => body })
  if (u.pathname.endsWith('/bases')) return json(200, { bases: [{ id: 'a4-corrupt' }, { id: 'a4-crm' }] })
  if (u.pathname.endsWith('/schema')) return u.searchParams.get('base') === 'a4-corrupt' ? json(500, { erreur: 'file is not a database' }) : json(200, SCHEMA)
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
const pass = () => { tree = expand(React.createElement(TabBody, {}), 'root') }
const settle = async () => { for (let n = 0; n < 12; n += 1) { await new Promise((r) => setImmediate(r)); if (dirty) { dirty = false; pass() } } }
pass()
await settle()

const banner = () => findAll(tree, (n) => n.props && n.props.className === 'dshdb-err').map((n) => textOf(n))
const select = findAll(tree, (n) => n.tag === 'select')[0]
ok('the first database is read first and its failure is shown', banner().some((t) => /file is not a database/.test(t)), JSON.stringify(banner()))
ok('...and the bar does not go on saying it is reading the schema of that broken database', !/Reading the schema/.test(textOf(tree)), textOf(tree))

select.props.onChange({ target: { value: 'a4-crm' } })
await settle()
ok('choosing a healthy database drops the error of the broken one', banner().length === 0, JSON.stringify(banner()))
ok('...and draws the healthy database (its schema was asked for)', asked.includes('/dsh-db-viewer/schema?base=a4-crm'))

console.log(ko === 0 ? '\nOK' : `\n${ko} failure(s)`)
process.exit(ko === 0 ? 0 : 1)
