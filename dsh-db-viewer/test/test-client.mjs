// ═══════════════════════════════════════════════════════════════════════════
// test/test-client.mjs — harnais de la moitié CLIENT.
//
// Pourquoi : une entrée dont `apply` lit `ctx.<service>` sans l'avoir déclaré
// dans `inject` ÉCHOUE au boot (« Failed to load plugins », mesuré le 24/09 :
// `inject: []` + `ctx.slots` → « cannot get property "slots" without inject »).
// Le ctx factice de ce banc est donc STRICT comme cordis : tout service non
// déclaré lève. Un `require('react')` minimal suffit à évaluer la fabrique.
//
// Usage : node test/test-client.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ICI = dirname(fileURLToPath(import.meta.url))
let ko = 0
const ok = (titre, cond, detail = '') => {
  console.log(`${cond ? '✓' : '✗'} ${titre}${detail ? ' — ' + detail : ''}`)
  if (!cond) ko += 1
}

// ── React factice (createElement + hooks) ──────────────────────────────────
const el = (type, props, ...enfants) => ({ type, props: props || {}, enfants: enfants.flat() })
const React = {
  createElement: el,
  Fragment: 'Fragment',
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
  useEffect: () => {},
  useCallback: (f) => f,
  useRef: (v) => ({ current: v }),
}

// ── module loader factice ──────────────────────────────────────────────────
let moduleCharge = null
const elFactice = () => ({ style: {}, appendChild: () => {}, remove: () => {}, setAttribute: () => () => {}, getContext: () => null, getElementsByTagName: () => [] })
globalThis.window = { __ModuleLoader__: { load: (def) => { moduleCharge = def.factory((n) => (n === 'react' ? React : null)) } } }
globalThis.document = { createElement: elFactice, createTextNode: elFactice, getElementById: () => null, head: elFactice(), body: elFactice(), documentElement: elFactice(), getElementsByTagName: () => [], addEventListener: () => {} }
if (globalThis.navigator === undefined) globalThis.navigator = { userAgent: 'test' }

const code = readFileSync(join(ICI, '..', 'client', 'client.js'), 'utf8')
new Function(code)()
ok('le bundle s\'évalue et exporte apply', moduleCharge !== null && typeof moduleCharge.apply === 'function')
ok('la fabrique n\'a pas avalé une erreur (module non vide)', moduleCharge !== null && moduleCharge.name === 'dsh-db-viewer')

// ── LE CONTRAT : tout service lu doit être déclaré dans inject ─────────────
const declares = new Set(Array.isArray(moduleCharge.inject) ? moduleCharge.inject : [])
ok('inject déclare `slots` (sinon l\'entrée échoue au boot)',
  declares.has('slots'), JSON.stringify(moduleCharge.inject))

// ── ctx STRICT comme cordis : un service non déclaré LÈVE ──────────────────
const store = {
  slots: { register: () => () => {}, inject: (n, f) => { f(); return () => {} } },
  sidebarRightTabs: { register: () => () => {} },
}
const effets = []
const ctx = new Proxy({ effect: (f, l) => { effets.push(l); if (typeof f === 'function') f() }, get: (s) => (declares.has(s) ? store[s] : undefined) }, {
  get (t, prop) {
    if (prop in t) return t[prop]
    if (declares.has(prop)) return store[prop]
    throw new Error('cannot get property "' + String(prop) + '" without inject')
  },
})
try {
  moduleCharge.apply(ctx)
  ok('apply() s\'exécute sur un ctx strict (aucun service non déclaré)', true, effets.length + ' effets')
} catch (e) {
  ok('apply() s\'exécute sur un ctx strict (aucun service non déclaré)', false, String(e && e.message ? e.message : e))
}

// ── fonctions pures exposées au banc ───────────────────────────────────────
const t = moduleCharge.__test || {}
ok('__test expose les helpers du diagramme', typeof t.calculerDisposition === 'function' && typeof t.cheminLien === 'function')
if (typeof t.calculerDisposition === 'function') {
  const schema = {
    tables: [{ nom: 'a', colonnes: [{ nom: 'id' }] }, { nom: 'b', colonnes: [{ nom: 'id' }, { nom: 'a_id' }] }],
    relations: [{ parent: 'a', enfant: 'b', depuis: 'id', vers: 'a_id' }],
  }
  const d = t.calculerDisposition(schema)
  ok('calculerDisposition est déterministe (même schéma → même image)',
    JSON.stringify(d) === JSON.stringify(t.calculerDisposition(schema)))
  ok('calculerDisposition place parent et enfant sur deux colonnes',
    d.pos.a.x < d.pos.b.x, JSON.stringify({ a: d.pos.a.x, b: d.pos.b.x }))
  const anc = t.ancresRelation(schema.relations[0], d.pos)
  ok('ancresRelation relie bord droit du parent au bord gauche de l\'enfant',
    anc !== null && anc.x1 === d.pos.a.x + d.pos.a.largeur && anc.x2 === d.pos.b.x)
}

// ── constructeurs de graphiques (purs) ─────────────────────────────────────
if (typeof t.profiler === 'function' && typeof t.construireGraphiques === 'function') {
  const schemaG = {
    tables: [{ nom: 'affaires', compte: 3, colonnes: [
      { name: 'id', type: 'integer', pk: true },
      { name: 'montant', type: 'real' },
      { name: 'etape', type: 'text' },
      { name: 'echeance', type: 'text' },
    ] }],
    relations: [],
  }
  const donneesG = { affaires: [
    { id: 1, montant: 1000, etape: 'signe', echeance: '2026-10-01' },
    { id: 2, montant: 2500, etape: 'negociation', echeance: '2026-10-05' },
    { id: 3, montant: 800, etape: 'signe', echeance: '2026-10-02' },
  ] }
  const prof = t.profiler(schemaG.tables[0], donneesG.affaires)
  ok('profiler détecte catégorie, numérique et date',
    prof.cats.length === 1 && prof.nums.length === 1 && prof.dates.length === 1,
    JSON.stringify({ cats: prof.cats.map((c) => c.col), nums: prof.nums.map((c) => c.col), dates: prof.dates.map((c) => c.col) }))
  ok('profiler ignore la clé primaire (pas de chart sur les id)',
    prof.nums.every((c) => c.col !== 'id') && prof.cats.every((c) => c.col !== 'id'))
  const gs = t.construireGraphiques(schemaG, donneesG, true)
  ok('construireGraphiques produit donut + chart de table',
    gs.length === 2 && gs[0].options.series[0].type === 'pie' && gs[1].options.series[0].type === 'bar',
    JSON.stringify(gs.map((g) => g.titre)))
  ok('thème sombre = couleurs de texte claires',
    String(gs[0].options.series[0].label.color).indexOf('249') !== -1)
  const gsClair = t.construireGraphiques(schemaG, donneesG, false)
  ok('thème clair = couleurs de texte sombres',
    String(gsClair[0].options.series[0].label.color).indexOf('15,17,21') !== -1)
}

// ── calendrier (pur) ───────────────────────────────────────────────────────
if (typeof t.construireCalendrier === 'function') {
  const lignesCal = [
    { sujet: 'A', debut: '2026-09-18T14:00' },
    { sujet: 'B', debut: '2026-09-18T18:00' },
    { sujet: 'C', debut: '2026-09-23T11:00' },
    { sujet: 'hors', debut: '2026-08-31T09:00' },
  ]
  const cal = t.construireCalendrier(lignesCal, 'debut', 2026, 8)
  ok('construireCalendrier produit une grille multiple de 7',
    cal.cases.length > 0 && cal.cases.length % 7 === 0, cal.cases.length + ' cases')
  const case18 = cal.cases.find((c) => c.date === '2026-09-18')
  ok('construireCalendrier place les entrées sur le bon jour',
    case18 !== undefined && case18.entrees.length === 2, JSON.stringify(case18 && case18.entrees.map((e) => e.sujet)))
  ok('construireCalendrier écarte les mois voisins',
    cal.cases.filter((c) => c.jour === null).every((c) => c.entrees.length === 0) &&
    cal.cases.every((c) => c.date === null || c.entrees.every((e) => String(e.debut).slice(0, 7) === '2026-09')))
}

// ── déplacement des cartes (pur) ───────────────────────────────────────────
if (typeof t.positionsFinales === 'function') {
  const schemaD = {
    tables: [{ nom: 'a', colonnes: [{ nom: 'id' }] }, { nom: 'b', colonnes: [{ nom: 'id' }, { nom: 'a_id' }] }],
    relations: [{ parent: 'a', enfant: 'b', depuis: 'id', vers: 'a_id' }],
  }
  const dispo = t.calculerDisposition(schemaD)
  const fin = t.positionsFinales(dispo, { b: { dx: 60, dy: 0 } })
  ok('positionsFinales applique le déplacement de la carte glissée',
    fin.pos.b.x === dispo.pos.b.x + 60 && fin.pos.a.x === dispo.pos.a.x,
    JSON.stringify({ a: fin.pos.a.x, b: fin.pos.b.x }))
  const finNeg = t.positionsFinales(dispo, { a: { dx: -500, dy: -500 } })
  const xs = Object.values(finNeg.pos).map((p) => p.x)
  const ys = Object.values(finNeg.pos).map((p) => p.y)
  ok('positionsFinales recadre pour ne rien rogner',
    Math.min(...xs) >= 24 && Math.min(...ys) >= 24 && finNeg.largeur >= dispo.largeur,
    JSON.stringify({ minX: Math.min(...xs), minY: Math.min(...ys) }))
  const anc = t.ancresRelation(schemaD.relations[0], fin.pos)
  ok('les liens suivent la carte déplacée',
    anc.x2 === fin.pos.b.x, JSON.stringify(anc))
}

console.log(ko === 0 ? `\nHARNAIS CLIENT dsh-db-viewer — 0 échec` : `\n✗ ${ko} échec(s)`)
process.exit(ko === 0 ? 0 : 1)