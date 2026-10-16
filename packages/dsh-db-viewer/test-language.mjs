// The database viewer speaks the language of the person (audit A2-02): English is the base of every string, French is given to a
// French UI only, and any other language (Spanish, Arabic, Chinese, one not known yet) reads English. The real TabBody runs here on a
// tiny synchronous renderer, with a scripted host, once per language; everything it shows (text, titles, labels) is collected.
//
//   node packages/dsh-db-viewer/test-language.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let ko = 0
const ok = (titre, cond, detail = '') => {
  console.log(`${cond ? '✓' : '✗'} ${titre}${detail ? ' — ' + detail : ''}`)
  if (!cond) ko += 1
}

// ── the renderer (same idea as test-base-change.mjs: hooks, a store per component, effects run after each pass) ──
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
  // a component may return a list (the table view does)
  if (Array.isArray(node)) return { tag: 'Fragment', props: {}, kids: node.map((k, n) => expand(k, path + '.' + n)).filter((k) => k !== null) }
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
/** Every string a person can read in a tree: the text, and the title / aria-label / placeholder of every element. */
const readable = (t, out = []) => {
  if (t === null) return out
  if (typeof t === 'string') { out.push(t); return out }
  for (const k of ['title', 'aria-label', 'placeholder', 'alt']) if (typeof t.props[k] === 'string') out.push(t.props[k])
  for (const k of t.kids) readable(k, out)
  return out
}

// ── a scripted host ───────────────────────────────────────────────────────────
const SCHEMA = {
  tables: [
    { nom: 'societes', compte: 3, colonnes: [{ name: 'id', type: 'integer', pk: true }, { name: 'nom', type: 'text' }] },
    { nom: 'affaires', compte: 4, colonnes: [{ name: 'id', type: 'integer', pk: true }, { name: 'societe_id', type: 'integer', fk: true, fkVers: 'societes' }, { name: 'montant', type: 'real' }, { name: 'etape', type: 'text' }, { name: 'echeance', type: 'text' }] },
  ],
  relations: [{ parent: 'societes', enfant: 'affaires', colonne: 'societe_id' }],
}
const ROWS = {
  societes: [{ id: 1, nom: 'A' }, { id: 2, nom: 'B' }, { id: 3, nom: 'C' }],
  affaires: [
    { id: 1, societe_id: 1, montant: 100, etape: 'open', echeance: '2026-10-01' },
    { id: 2, societe_id: 1, montant: 250, etape: 'won', echeance: '2026-10-05' },
    { id: 3, societe_id: 2, montant: 80, etape: 'open', echeance: '2026-10-09' },
    { id: 4, societe_id: 3, montant: 40, etape: 'won', echeance: '2026-10-11' },
  ],
}
// The viewer's own refusals come as English text and a code; the page words them for the person.
const REFUS = { 'DELETE FROM x': ['read-only', 'Read-only: SELECT / WITH / PRAGMA / EXPLAIN only'], '': ['empty-query', 'Empty query'], 'SELECT 1; SELECT 2': ['one-statement', 'One statement at a time'] }
const CUT = { colonnes: ['id'], lignes: Array.from({ length: 500 }, (_, i) => ({ id: i + 1 })), compte: 500, total: 200000, tronque: true, borne: false }
let rowsBase = null
// A pack (the manifest a mini-app keeps in its database) adds the Cards and Calendar views of the Data tab.
let withPack = false
const PACK = { entites: [
  { table: 'affaires', titre: 'Deals', champs: ['montant', 'etape'], vues: ['liste', 'cartes', 'calendrier'], date: 'echeance' },
  { table: 'ghost', titre: 'Ghost', vues: ['liste'] },
] }
const fetchFake = async (url) => {
  const u = new URL(String(url))
  const json = (status, body) => ({ ok: status < 400, status, statusText: String(status), json: async () => body })
  if (u.pathname.endsWith('/bases')) return json(200, { bases: rowsBase === null ? [{ id: 'crm-demo' }] : rowsBase })
  if (u.pathname.endsWith('/schema')) return json(200, SCHEMA)
  if (u.pathname.endsWith('/rows') && u.searchParams.get('table') === 'ghost') return json(400, { erreur: 'Unknown table: ghost', code: 'unknown-table' })
  if (u.pathname.endsWith('/rows')) return json(200, { colonnes: SCHEMA.tables.find((t) => t.nom === u.searchParams.get('table')).colonnes, lignes: ROWS[u.searchParams.get('table')], compte: 9999 })
  if (u.pathname.endsWith('/query')) {
    const sql = u.searchParams.get('sql') || ''
    if (/FROM pack/.test(sql)) return withPack ? json(200, { colonnes: ['contenu'], lignes: [{ contenu: JSON.stringify(PACK) }], compte: 1 }) : json(200, { colonnes: [], lignes: [], compte: 0 })
    if (sql === 'HOST DOWN') return { ok: false, status: 502, statusText: 'Bad Gateway', json: async () => { throw new Error('not json') } }
    if (sql === 'SELECT * FROM big') return json(200, CUT)
    if (sql === 'SELECT * FROM empty') return json(200, { colonnes: [], lignes: [], compte: 0, total: 0, tronque: false })
    if (REFUS[sql] !== undefined) return json(400, { erreur: REFUS[sql][1], code: REFUS[sql][0] })
    return json(400, { erreur: 'no such table: x' })
  }
  return json(404, {})
}

let def = null
let LANG = 'en'
const listeners = {}
globalThis.window = { __ModuleLoader__: { load: (d) => { def = d } }, location: { origin: 'http://127.0.0.1:3080' }, fetch: fetchFake, matchMedia: () => ({ matches: false }), addEventListener: (t, f) => { listeners[t] = f }, removeEventListener: () => {}, __KB_LANG_RESOLVE__: () => LANG }
const elFactice = () => ({ style: {}, appendChild: () => {}, remove: () => {}, setAttribute: () => () => {}, getContext: () => null, getElementsByTagName: () => [], classList: { contains: () => false } })
globalThis.document = { createElement: elFactice, createTextNode: elFactice, getElementById: () => null, head: elFactice(), body: elFactice(), documentElement: Object.assign(elFactice(), { lang: 'en' }), getElementsByTagName: () => [], querySelector: () => null }
if (globalThis.navigator === undefined) globalThis.navigator = { userAgent: 'test' }
new Function(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client', 'client.js'), 'utf8'))()
const plugin = def.factory((n) => (n === 'react' ? React : null))
let TabBody = null
let tabType = null
const slots = { register: (spec, comp) => { TabBody = comp; return () => {} }, inject: (n, f) => { f(); return () => {} } }
plugin.apply({ effect: (f) => { if (typeof f === 'function') f() }, get: (s) => (s === 'slots' ? slots : { register: (t) => { tabType = t; return () => {} } }), slots })
ok('the tab body and the tab type are registered', typeof TabBody === 'function' && tabType !== null)

/** Runs the viewer once in `lang`, walks its views, and returns everything a person could read, per step. */
const walk = async (lang) => {
  LANG = lang
  store.clear()
  dirty = false
  const seen = {}
  let tree = null
  const pass = () => { tree = expand(React.createElement(TabBody, {}), 'root') }
  const settle = async () => { for (let n = 0; n < 12; n += 1) { await new Promise((r) => setImmediate(r)); if (dirty) { dirty = false; pass() } } }
  const note = (step) => { seen[step] = readable(tree).join(' | ') }
  const press = async (pred) => { const b = findAll(tree, (n) => n.tag === 'button' && pred(n))[0]; if (b === undefined) return false; b.props.onClick(); await settle(); return true }
  pass(); await settle()
  seen.tab = [tabType.title(), tabType.guide[0].title(), tabType.guide[0].description()].join(' | ')
  note('diagram')
  // the card of a table can be moved: the reset button then appears, with its tooltip
  const card = findAll(tree, (n) => n.props && n.props.className === 'dshdb-card')[0]
  if (card !== undefined) { card.props.onMouseDown({ preventDefault: () => {}, clientX: 5, clientY: 5 }); listeners.mousemove({ clientX: 65, clientY: 45 }); await settle() }
  note('diagram')
  const isPill = (n) => n.tag === 'button' && /(^| )dshdb-pill( |$)/.test(n.props.className || '')
  const pills = findAll(tree, isPill)
  seen.pills = pills.map((p) => textOf(p)).join(' | ')
  await press((n) => isPill(n) && textOf(n) === pills[1].kids[0]); note('charts')
  await press((n) => isPill(n) && textOf(n) === pills[2].kids[0]); note('data')
  // the Données view with no pack: a chip per table; the list of the first table is cut at 200 of 9999 rows
  await settle(); note('data')
  await press((n) => isPill(n) && textOf(n) === pills[3].kids[0]); note('sql')
  const area = () => findAll(tree, (n) => n.tag === 'textarea')[0]
  const run = async (sql) => { area().props.onChange({ target: { value: sql } }); pass(); await press((n) => /dshdb-run/.test(n.props.className || '')); await settle() }
  await run('SELECT * FROM big'); note('sql-cut')
  await press((n) => /dshdb-more/.test(n.props.className || '')); note('sql-cut')
  await run('SELECT * FROM empty'); note('sql-empty')
  await run('DELETE FROM x'); note('sql-readonly')
  await run(''); note('sql-empty-query')
  await run('SELECT 1; SELECT 2'); note('sql-stacked')
  await run('SELECT * FROM nothing'); note('sql-engine')
  await run('HOST DOWN'); note('sql-host-down')
  // no database yet
  store.clear(); dirty = false; rowsBase = []; pass(); await settle(); note('no-database'); rowsBase = null
  return seen
}

/** The Data tab of a database that carries a pack: the three views of an entity, the month of the calendar, a table the host does not know. */
const walkPack = async (lang) => {
  LANG = lang
  store.clear()
  dirty = false
  withPack = true
  const seen = {}
  let tree = null
  const pass = () => { tree = expand(React.createElement(TabBody, {}), 'root') }
  const settle = async () => { for (let n = 0; n < 12; n += 1) { await new Promise((r) => setImmediate(r)); if (dirty) { dirty = false; pass() } } }
  const press = async (pred) => { const b = findAll(tree, (n) => n.tag === 'button' && pred(n))[0]; if (b === undefined) return false; b.props.onClick(); await settle(); return true }
  pass(); await settle()
  const pills = findAll(tree, (n) => n.tag === 'button' && /(^| )dshdb-pill( |$)/.test(n.props.className || ''))
  await press((n) => n === pills[2] || textOf(n) === textOf(pills[2]))
  const isMode = (n) => /(^| )dshdb-mode( |$)/.test(n.props.className || '')
  seen.modes = findAll(tree, isMode).map((n) => textOf(n)).join(' | ')
  const modes = findAll(tree, isMode)
  await press((n) => isMode(n) && textOf(n) === textOf(modes[1]))
  seen.cards = readable(tree).join(' | ')
  await press((n) => isMode(n) && textOf(n) === textOf(modes[2]))
  seen.calendar = readable(tree).join(' | ')
  await press((n) => /dshdb-chip/.test(n.props.className || '') && textOf(n) === 'Ghost')
  seen.ghost = readable(tree).join(' | ')
  withPack = false
  return seen
}

const MOIS_EN = /(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}/
const MOIS_FR = /(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre) \d{4}/

const FRENCH = /Base de |Diagramme|Graphiques|Données|Exécuter|aucune|Aucune|lecture|chargement|premières|Relire|Réinitialiser|Requête|requête|Liste|Cartes|Calendrier|Lignes par|dans le temps|Réponse de l|indisponibles|Une seule|Table inconnue|Nom de table|Base inconnue|Affiche|Afficher|Affinez|Affine|\bpar «|«/
const frenchIn = (seen) => Object.entries(seen).filter(([, v]) => FRENCH.test(v)).map(([k, v]) => k + ': ' + (v.match(FRENCH) || [''])[0])

console.log('English')
{
  const en = await walk('en')
  ok('nothing French is shown (text, tooltips, labels), in any view', frenchIn(en).length === 0, JSON.stringify(frenchIn(en)))
  ok('the tab is « Databases », as the Suite names the module', /^Databases \| Databases \| Diagram, charts, data and SQL/.test(en.tab), en.tab)
  ok('the title says « Agent Team database »', /Agent Team database/.test(en.diagram) && /Reload the database/.test(en.diagram), en.diagram)
  ok('the four views are Diagram / Charts / Data / SQL', en.pills === 'Diagram | Charts | Data | SQL', en.pills)
  ok('the moved card offers « Reset the layout »', /Reset the layout/.test(en.diagram), en.diagram)
  ok('charts: counters and titles in English', /\btables\b/.test(en.charts) && /\brows\b/.test(en.charts) && /\bcolumns\b/.test(en.charts), en.charts)
  ok('data: a chip per table and the cut line « First 3 of 9999 rows »', /societes \| affaires/.test(en.data) && /First 3 of 9999 rows/.test(en.data), en.data)
  ok('sql: « Run », and a cut result says so with « Show more rows »', /Run/.test(en.sql) && /Showing the first 500 of 200,000 rows\./.test(en['sql-cut']) && /Show more rows/.test(en['sql-cut']), en['sql-cut'])
  ok('sql: an empty result says « No rows »', /No rows/.test(en['sql-empty']), en['sql-empty'])
  ok('sql: refusals are worded in English', /Read-only: SELECT \/ WITH \/ PRAGMA \/ EXPLAIN only/.test(en['sql-readonly']) && /Empty query/.test(en['sql-empty-query']) && /One statement at a time/.test(en['sql-stacked']), en['sql-readonly'])
  ok('sql: the engine\'s own message is shown as it came', /no such table: x/.test(en['sql-engine']), en['sql-engine'])
  ok('sql: a host that answers with no JSON is named in English', /Host answered: Bad Gateway/.test(en['sql-host-down']), en['sql-host-down'])
  ok('no database yet: a sentence in English', /No database yet/.test(en['no-database']), en['no-database'])
}

console.log('French')
{
  const fr = await walk('kybernos')
  ok('the tab is « Base de données »', /^Base de données \| Base de données \| Diagramme, graphiques, données et SQL/.test(fr.tab), fr.tab)
  ok('the title and the views are French', /Base de l’Agent Team/.test(fr.diagram) && /Relire la base/.test(fr.diagram) && fr.pills === 'Diagramme | Graphiques | Données | SQL', fr.pills)
  ok('the moved card offers « Réinitialiser la disposition »', /Réinitialiser la disposition/.test(fr.diagram))
  ok('charts: counters in French', /lignes/.test(fr.charts) && /colonnes/.test(fr.charts), fr.charts)
  ok('data: the cut line is French', /premières lignes sur 9999/.test(fr.data), fr.data)
  ok('sql: « Exécuter », the cut note and « Afficher plus de lignes »', /Exécuter/.test(fr.sql) && /Affichage des 500 premières lignes sur 200[\s  ]000\./.test(fr['sql-cut']) && /Afficher plus de lignes/.test(fr['sql-cut']), fr['sql-cut'])
  ok('sql: « Aucune ligne »', /Aucune ligne/.test(fr['sql-empty']), fr['sql-empty'])
  ok('sql: refusals are worded in French', /Lecture seule : SELECT \/ WITH \/ PRAGMA \/ EXPLAIN uniquement/.test(fr['sql-readonly']) && /Requête vide/.test(fr['sql-empty-query']) && /Une seule requête à la fois/.test(fr['sql-stacked']), fr['sql-readonly'])
  ok('sql: the engine\'s own message is still shown as it came', /no such table: x/.test(fr['sql-engine']))
  ok('sql: a host that answers with no JSON is named in French', /Réponse de l’hôte : Bad Gateway/.test(fr['sql-host-down']), fr['sql-host-down'])
  ok('no database yet: a sentence in French', /Aucune base pour l’instant/.test(fr['no-database']), fr['no-database'])
}

console.log('the Data tab of a database with a pack')
{
  const en = await walkPack('en')
  ok('English: List / Cards / Calendar', en.modes === 'List | Cards | Calendar', en.modes)
  ok('English: the calendar names its month in English and starts on Monday', MOIS_EN.test(en.calendar) && /\| M \| T \| W \| T \| F \| S \| S \|/.test(en.calendar), en.calendar.slice(0, 200))
  ok('English: a table the host does not know is worded in English', /Unknown table: ghost/.test(en.ghost), en.ghost)
  ok('English: nothing French in the three views', !FRENCH.test(en.modes + en.cards + en.calendar + en.ghost), (en.modes + en.cards + en.calendar + en.ghost).match(FRENCH))
  const fr = await walkPack('kybernos')
  ok('French: Liste / Cartes / Calendrier', fr.modes === 'Liste | Cartes | Calendrier', fr.modes)
  ok('French: the calendar names its month in French and starts on Monday', MOIS_FR.test(fr.calendar) && /\| L \| M \| M \| J \| V \| S \| D \|/.test(fr.calendar), fr.calendar.slice(0, 200))
  ok('French: a table the host does not know is worded in French', /Table inconnue : ghost/.test(fr.ghost), fr.ghost)
  const es = await walkPack('es')
  ok('Spanish: English', es.modes === 'List | Cards | Calendar' && MOIS_EN.test(es.calendar) && /Unknown table: ghost/.test(es.ghost), es.modes)
}

console.log('every other language reads English')
for (const lang of ['fr-CA', 'es', 'ar', 'zh', 'de', 'xx']) {
  const seen = await walk(lang)
  const french = lang === 'fr-CA'
  if (french) ok('fr-CA is French', /Base de l’Agent Team/.test(seen.diagram), seen.diagram)
  else ok(lang + ': English, nothing French', frenchIn(seen).length === 0 && /Agent Team database/.test(seen.diagram) && seen.pills === 'Diagram | Charts | Data | SQL', JSON.stringify(frenchIn(seen)))
}

console.log(ko === 0 ? '\nOK' : `\n${ko} failure(s)`)
process.exit(ko === 0 ? 0 : 1)
