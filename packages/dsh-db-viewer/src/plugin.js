// ═══════════════════════════════════════════════════════════════════════════
// dsh-db-viewer — client plugin body (readable source).
//
// A TAB of the right sidebar that shows the small SQLite database of a kyber,
// drawdb style, in four internal views:
//   • Diagram — coloured entity cards + crow's-foot links;
//   • Charts  — counters and ECharts cards built from the data;
//   • Data    — one table, its rows;
//   • SQL     — one SELECT query, its result.
//
// scripts/build.mjs wraps this file in a factory `(React) => {…}` concatenated
// after the DSH module-loader header: `client/client.js` is GENERATED, never
// edited. The data comes from the host routes `/dsh-db-viewer/*` (read-only);
// nothing can be written from the page.
// ═══════════════════════════════════════════════════════════════════════════

// ── language ──
// English is the base of every string. French is given to a French UI only (Kybernos's own « kybernos », or an fr tag); a language the
// Language page translated is looked up by its French text in the dictionary the page keeps; any other language (and a language not
// known yet) reads English.
const lang = () => {
  try { return String(typeof window.__KB_LANG_RESOLVE__ === 'function' ? window.__KB_LANG_RESOLVE__() : (document.documentElement.lang || 'en')) } catch (e) { return 'en' }
}
const kt = (fr, en) => {
  const l = lang()
  if (l === 'kybernos' || l.slice(0, 2) === 'fr') return fr
  if (l === 'en') return en
  try {
    const a = window.__KB_I18N_ACTIVE__
    if (a !== null && a !== undefined && a.dict !== null && typeof a.dict === 'object' && typeof a.dict[fr] === 'string') return a.dict[fr]
  } catch (e) { /* no dictionary: English */ }
  return en
}

const NAME = 'dsh-db-viewer'
const KIND = 'dsh-db-viewer'
const TYPE_ID = 'dsh-db-viewer-panel'

/** Card header colours — a drawdb-style pastel palette, indexed by table. */
const PALETTE = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#ef4444', '#14b8a6']

const HAUT_ENTETE = 34
const HAUT_LIGNE = 26
const LARG_CARTE = 220
const DX = 260
const DY = 48

// ── pure helpers (exposed to the test bench through plugin.__test) ──────────

/**
 * Lays out the cards: one column per foreign-key depth (the root tables on
 * the left), stacked vertically. Deterministic — two renders of the same
 * schema give the same picture.
 */
function calculerDisposition (schema) {
  const tables = Array.isArray(schema && schema.tables) ? schema.tables : []
  const relations = Array.isArray(schema && schema.relations) ? schema.relations : []
  const profondeur = {}
  for (const t of tables) profondeur[t.nom] = 0
  // bounded iterations: the longest path, not an endless loop
  for (let i = 0; i < tables.length + 1; i++) {
    for (const r of relations) {
      const d = (profondeur[r.parent] || 0) + 1
      if (d > (profondeur[r.enfant] || 0)) profondeur[r.enfant] = d
    }
  }
  const pos = {}
  const yCourant = {}
  let yMax = 0
  tables.forEach((t, index) => {
    const d = profondeur[t.nom] || 0
    if (yCourant[d] === undefined) yCourant[d] = 24
    const hauteur = HAUT_ENTETE + t.colonnes.length * HAUT_LIGNE + 10
    pos[t.nom] = { x: 24 + d * DX, y: yCourant[d], hauteur, largeur: LARG_CARTE, index }
    yCourant[d] += hauteur + DY
    yMax = Math.max(yMax, yCourant[d])
  })
  let dMax = 0
  for (const d of Object.values(profondeur)) dMax = Math.max(dMax, d)
  return {
    pos,
    largeur: 24 + (dMax + 1) * DX + 40,
    hauteur: yMax + 24,
  }
}

/** The two anchors of a link: the parent's right edge → the child's left edge. */
function ancresRelation (rel, pos) {
  const p = pos[rel.parent]
  const e = pos[rel.enfant]
  if (p === undefined || e === undefined) return null
  return {
    x1: p.x + p.largeur,
    y1: p.y + Math.round(p.hauteur / 2),
    x2: e.x,
    y2: e.y + Math.round(HAUT_ENTETE / 2),
  }
}

function cheminLien (a) {
  const b = 70
  return `M ${a.x1} ${a.y1} C ${a.x1 + b} ${a.y1}, ${a.x2 - b} ${a.y2}, ${a.x2} ${a.y2}`
}

// ── host calls ──────────────────────────────────────────────────────────────

async function api (path, params) {
  const u = new URL(path, window.location.origin)
  for (const cle of Object.keys(params || {})) {
    if (params[cle] !== undefined && params[cle] !== null) u.searchParams.set(cle, String(params[cle]))
  }
  const r = await window.fetch(u)
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.erreur) {
    // The host words its own refusals in English with a code (index.js, Refus): the code is kept, so the page can word it for the person.
    const e = new Error(j.erreur || (kt('Réponse de l’hôte : ', 'Host answered: ') + r.statusText))
    if (typeof j.code === 'string') e.code = j.code
    throw e
  }
  return j
}

// What the host refuses is worded here, in the language of the person; the SQL engine's own messages (no code) are shown as they came.
const REFUS = {
  'empty-query': ['Requête vide', 'Empty query'],
  'read-only': ['Lecture seule : SELECT / WITH / PRAGMA / EXPLAIN uniquement', 'Read-only: SELECT / WITH / PRAGMA / EXPLAIN only'],
  'one-statement': ['Une seule requête à la fois', 'One statement at a time'],
  'unknown-base': ['Base inconnue', 'Unknown database'],
  'bad-table': ['Nom de table invalide', 'Invalid table name'],
}
function explain (e) {
  const message = String(e && e.message ? e.message : e)
  const code = e && typeof e.code === 'string' ? e.code : ''
  if (code === 'unknown-table') return kt('Table inconnue : ' + message.replace(/^Unknown table:\s*/, ''), message)
  const row = Object.prototype.hasOwnProperty.call(REFUS, code) ? REFUS[code] : null
  return row === null ? message : kt(row[0], row[1])
}

// ── plugin factory ──────────────────────────────────────────────────────────
// The body below receives React from the factory generated by build.mjs.

const h = React.createElement

const CSS = `
.dshdb-root{display:flex;flex-direction:column;min-height:0;height:100%;font:13px/1.45 ui-sans-serif,system-ui,sans-serif;color:var(--dsw-alias-label-primary,inherit)}
.dshdb-bar{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid rgba(128,128,128,.22)}
.dshdb-title{font-weight:700;font-size:13px;white-space:nowrap}
.dshdb-select{flex:1;min-width:0;height:30px;border-radius:8px;border:1px solid rgba(128,128,128,.3);background:transparent;color:inherit;padding:0 8px;font-size:12.5px}
.dshdb-select:focus{outline:none;border-color:var(--dsw-alias-brand-primary,#6366f1)}
.dshdb-hbtn{flex:none;display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:8px;border:1px solid rgba(128,128,128,.3);background:transparent;color:inherit;cursor:pointer}
.dshdb-hbtn:hover{background:rgba(128,128,128,.12)}
.dshdb-pills{display:flex;gap:6px;padding:8px 12px}
.dshdb-pill{flex:1;height:30px;border-radius:8px;border:1px solid rgba(128,128,128,.3);background:transparent;color:inherit;font-size:12.5px;cursor:pointer;white-space:nowrap}
.dshdb-pill:hover{background:rgba(128,128,128,.1)}
.dshdb-pill.on{background:var(--dsw-alias-brand-primary,#6366f1);border-color:var(--dsw-alias-brand-primary,#6366f1);color:var(--dsw-alias-label-primary-foreground,#fff);font-weight:650}
.dshdb-view{flex:1;min-height:0;overflow:auto}
.dshdb-canvas{position:relative;background-image:radial-gradient(circle, rgba(128,128,128,.28) 1px, transparent 1px);background-size:18px 18px;border-top:1px solid rgba(128,128,128,.15)}
.dshdb-liens{position:absolute;inset:0;pointer-events:none}
.dshdb-card{position:absolute;width:${LARG_CARTE}px;border-radius:10px;border:1px solid color-mix(in srgb, currentColor 25%, transparent);background:color-mix(in srgb, currentColor 6%, transparent);box-shadow:0 4px 14px rgba(0,0,0,.12);overflow:hidden;color:inherit;cursor:grab;user-select:none}
.dshdb-card:active{cursor:grabbing}
.dshdb-reset{position:absolute;top:10px;right:10px;z-index:3}
.dshdb-cardhead{display:flex;align-items:center;gap:8px;height:${HAUT_ENTETE}px;padding:0 10px;color:#fff;font-weight:700;font-size:12.5px}
.dshdb-count{margin-left:auto;font-size:11px;font-weight:500;opacity:.9}
.dshdb-row{display:flex;align-items:center;gap:6px;height:${HAUT_LIGNE}px;padding:0 10px;border-top:1px solid rgba(128,128,128,.14);font-size:12px}
.dshdb-type{flex:none;font:10px/1 ui-monospace,SFMono-Regular,monospace;padding:3px 5px;border-radius:4px;background:rgba(128,128,128,.16);opacity:.85;text-transform:lowercase}
.dshdb-col{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshdb-key{flex:none;font:9.5px/1 ui-sans-serif,system-ui;font-weight:800;padding:3px 5px;border-radius:4px}
.dshdb-key.pk{background:color-mix(in srgb, #f59e0b 20%, transparent);color:color-mix(in srgb, #f59e0b 70%, currentColor)}
.dshdb-key.fk{background:color-mix(in srgb, #8b5cf6 22%, transparent);color:color-mix(in srgb, #a78bfa 70%, currentColor)}
.dshdb-err{margin:12px;padding:9px 13px;border-radius:9px;background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.35);color:var(--dsw-alias-state-error-primary,#ef4444);font-size:12px}
.dshdb-note{padding:14px;opacity:.6;font-size:12.5px}
.dshdb-chips{display:flex;gap:6px;overflow-x:auto;padding:10px 12px;scrollbar-width:none}
.dshdb-chips::-webkit-scrollbar{display:none}
.dshdb-chip{flex:none;height:26px;padding:0 12px;border-radius:99px;border:1px solid rgba(128,128,128,.3);background:transparent;color:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
.dshdb-chip.on{background:var(--dsw-alias-brand-primary,#6366f1);border-color:var(--dsw-alias-brand-primary,#6366f1);color:var(--dsw-alias-label-primary-foreground,#fff)}
.dshdb-table{border-collapse:collapse;width:calc(100% - 24px);margin:0 12px 16px;font-size:12px}
.dshdb-table th,.dshdb-table td{border:1px solid rgba(128,128,128,.25);padding:3px 7px;text-align:left;vertical-align:top;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshdb-table th{background:rgba(128,128,128,.12);font-weight:650}
.dshdb-sql{display:flex;flex-direction:column;gap:8px;padding:12px}
.dshdb-sql textarea{width:100%;box-sizing:border-box;min-height:76px;resize:vertical;border-radius:8px;border:1px solid rgba(128,128,128,.3);background:transparent;color:inherit;padding:8px 10px;font:12px/1.5 ui-monospace,SFMono-Regular,monospace}
.dshdb-sql textarea:focus{outline:none;border-color:var(--dsw-alias-brand-primary,#6366f1)}
.dshdb-run{align-self:flex-start;height:30px;padding:0 16px;border-radius:8px;border:none;background:var(--dsw-alias-brand-primary,#6366f1);color:var(--dsw-alias-label-primary-foreground,#fff);font-size:12.5px;font-weight:650;cursor:pointer}
.dshdb-run:hover{opacity:.9}
.dshdb-cut{display:flex;align-items:center;flex-wrap:wrap;gap:10px;padding:2px 0 8px;opacity:1;color:var(--dsw-alias-label-secondary,inherit)}
.dshdb-more{height:26px;padding:0 12px;border-radius:8px;border:1px solid rgba(128,128,128,.3);background:transparent;color:inherit;font-size:12px;cursor:pointer}
.dshdb-more:hover:not(:disabled){background:rgba(128,128,128,.12)}
.dshdb-more:disabled{opacity:.5;cursor:default}
.dshdb-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(84px,1fr));gap:8px;padding:12px 12px 2px}
.dshdb-kpi{border-radius:12px;padding:10px 12px;border:1px solid color-mix(in srgb, currentColor 14%, transparent);background:linear-gradient(135deg,color-mix(in srgb,#6366f1 26%,transparent),color-mix(in srgb,#0ea5e9 12%,transparent))}
.dshdb-kpi:nth-child(2){background:linear-gradient(135deg,color-mix(in srgb,#10b981 26%,transparent),color-mix(in srgb,#14b8a6 12%,transparent))}
.dshdb-kpi:nth-child(3){background:linear-gradient(135deg,color-mix(in srgb,#f59e0b 26%,transparent),color-mix(in srgb,#ec4899 12%,transparent))}
.dshdb-kpi:nth-child(4){background:linear-gradient(135deg,color-mix(in srgb,#8b5cf6 26%,transparent),color-mix(in srgb,#6366f1 12%,transparent))}
.dshdb-kpi b{display:block;font-size:20px;line-height:1.15}
.dshdb-kpi span{font-size:11px;opacity:.7}
.dshdb-charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px;padding:10px 12px 16px}
.dshdb-chart{border:1px solid color-mix(in srgb, currentColor 15%, transparent);border-radius:12px;padding:10px 10px 4px;background:color-mix(in srgb, currentColor 4%, transparent)}
.dshdb-chart h4{margin:0 0 4px;font-size:12px;font-weight:650;opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dshdb-chartbox{width:100%;height:200px}
.dshdb-modes{display:flex;gap:4px;margin:0 12px 8px;padding:3px;border-radius:9px;border:1px solid color-mix(in srgb, currentColor 16%, transparent);background:color-mix(in srgb, currentColor 5%, transparent)}
.dshdb-mode{flex:1;height:24px;border:none;border-radius:7px;background:transparent;color:inherit;font-size:12px;cursor:pointer}
.dshdb-mode.on{background:color-mix(in srgb, currentColor 12%, transparent);font-weight:650}
.dshdb-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;padding:4px 12px 16px}
.dshdb-cardv{border:1px solid color-mix(in srgb, currentColor 15%, transparent);border-radius:12px;padding:10px 12px;background:color-mix(in srgb, currentColor 4%, transparent);display:flex;flex-direction:column;gap:5px}
.dshdb-cardv-head{display:flex;align-items:center;gap:8px;margin-bottom:2px}
.dshdb-logo{width:30px;height:30px;border-radius:8px;object-fit:cover;flex:none}
.dshdb-logo.nologo{display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;background:color-mix(in srgb, currentColor 12%, transparent)}
.dshdb-cardv-titre{font-weight:700;font-size:13px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshdb-champ{display:flex;gap:8px;font-size:11.5px;min-width:0}
.dshdb-champ-n{flex:none;opacity:.55;min-width:64px}
.dshdb-champ-v{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshdb-audio{display:flex;flex-direction:column;gap:4px;margin-top:4px}
.dshdb-audio audio{width:100%;height:30px}
.dshdb-ondes{width:100%;height:24px;opacity:.8}
.dshdb-cal{padding:4px 12px 16px}
.dshdb-cal-nav{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;font-size:12.5px}
.dshdb-cal-head{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;font-size:10.5px;opacity:.6;text-align:center;margin-bottom:4px}
.dshdb-cal-grille{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}
.dshdb-cal-case{min-height:56px;border:1px solid color-mix(in srgb, currentColor 12%, transparent);border-radius:8px;padding:3px;display:flex;flex-direction:column;gap:2px;font-size:10px}
.dshdb-cal-case.hors{opacity:.35}
.dshdb-cal-jour{font-weight:700;font-size:10.5px}
.dshdb-cal-entree{border-radius:5px;padding:1px 4px;background:color-mix(in srgb, #6366f1 24%, transparent);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshdb-cal-plus{opacity:.6;text-align:center}
`

/** drawdb-style entity card: coloured header, type + column + key rows. */
function Carte (props) {
  const t = props.table
  const p = props.pos
  const couleur = PALETTE[p.index % PALETTE.length]
  const lignes = t.colonnes.map((c) => h('div', { className: 'dshdb-row', key: c.name },
    h('span', { className: 'dshdb-type' }, (c.type || 'text').toLowerCase()),
    h('span', { className: 'dshdb-col', title: c.name }, c.name),
    c.pk === true ? h('span', { className: 'dshdb-key pk' }, 'PK') : (c.fk === true ? h('span', { className: 'dshdb-key fk' }, 'KEY') : null)))
  return h('div', {
    className: 'dshdb-card',
    onMouseDown: (e) => { if (props.onGlisser !== undefined) props.onGlisser(e) },
    style: { left: p.x + 'px', top: p.y + 'px' },
  },
    h('div', { className: 'dshdb-cardhead', style: { background: couleur } },
      h('span', null, t.nom),
      h('span', { className: 'dshdb-count' }, String(t.compte))),
    lignes)
}

/**
 * Final layout = automatic placement + the user's moves (drag).
 * The canvas grows when needed and shifts so that a card moved past the
 * edges is never clipped.
 */
function positionsFinales (dispo, depl) {
  const pos = {}
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity
  for (const nom of Object.keys(dispo.pos)) {
    const p = dispo.pos[nom]
    const d = depl[nom]
    const x = p.x + (d !== undefined ? d.dx : 0)
    const y = p.y + (d !== undefined ? d.dy : 0)
    pos[nom] = { ...p, x, y }
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x + p.largeur > maxX) maxX = x + p.largeur
    if (y + p.hauteur > maxY) maxY = y + p.hauteur
  }
  const ddx = minX < 24 ? 24 - minX : 0
  const ddy = minY < 24 ? 24 - minY : 0
  if (ddx !== 0 || ddy !== 0) {
    for (const nom of Object.keys(pos)) pos[nom] = { ...pos[nom], x: pos[nom].x + ddx, y: pos[nom].y + ddy }
  }
  return {
    pos,
    largeur: Math.max(dispo.largeur, maxX + ddx + 40),
    hauteur: Math.max(dispo.hauteur, maxY + ddy + 24),
  }
}

/** Diagram view: draggable cards + crow's-foot links. */
function Diagramme (props) {
  const schema = props.schema
  const [depl, setDepl] = React.useState({})
  const glisse = React.useRef(null)
  const dispo = positionsFinales(calculerDisposition(schema), depl)
  // global mouse: the drag survives leaving the card / the canvas
  React.useEffect(() => {
    const bouger = (e) => {
      const g = glisse.current
      if (g === null) return
      setDepl((prev) => ({ ...prev, [g.nom]: { dx: g.dx0 + (e.clientX - g.x0), dy: g.dy0 + (e.clientY - g.y0) } }))
    }
    const lacher = () => { glisse.current = null }
    window.addEventListener('mousemove', bouger)
    window.addEventListener('mouseup', lacher)
    return () => {
      window.removeEventListener('mousemove', bouger)
      window.removeEventListener('mouseup', lacher)
    }
  }, [])
  const demarrerGlisse = (e, nom) => {
    e.preventDefault()
    const d = depl[nom] || { dx: 0, dy: 0 }
    glisse.current = { nom, x0: e.clientX, y0: e.clientY, dx0: d.dx, dy0: d.dy }
  }
  const liens = schema.relations.map((rel, i) => {
    const a = ancresRelation(rel, dispo.pos)
    if (a === null) return null
    // crow's foot on the child side (the “N”), short bar on the parent side (the “1”)
    return h('g', { key: 'l' + i },
      h('path', { d: cheminLien(a), fill: 'none', stroke: 'rgba(128,128,128,.75)', 'stroke-width': 1.6 }),
      h('line', { x1: a.x1, y1: a.y1 - 7, x2: a.x1, y2: a.y1 + 7, stroke: 'rgba(128,128,128,.9)', 'stroke-width': 2 }),
      h('line', { x1: a.x2, y1: a.y2, x2: a.x2 - 13, y2: a.y2 - 8, stroke: 'rgba(128,128,128,.9)', 'stroke-width': 1.6 }),
      h('line', { x1: a.x2, y1: a.y2, x2: a.x2 - 13, y2: a.y2, stroke: 'rgba(128,128,128,.9)', 'stroke-width': 1.6 }),
      h('line', { x1: a.x2, y1: a.y2, x2: a.x2 - 13, y2: a.y2 + 8, stroke: 'rgba(128,128,128,.9)', 'stroke-width': 1.6 }))
  })
  const cartes = schema.tables.map((t) => h(Carte, {
    key: t.nom, table: t, pos: dispo.pos[t.nom],
    onGlisser: (e) => demarrerGlisse(e, t.nom),
  }))
  const nbDeplaces = Object.keys(depl).length
  return h('div', { className: 'dshdb-view' },
    h('div', { className: 'dshdb-canvas', style: { width: dispo.largeur + 'px', height: dispo.hauteur + 'px' } },
      nbDeplaces > 0 ? h('button', {
        type: 'button', className: 'dshdb-hbtn dshdb-reset', title: kt('Réinitialiser la disposition', 'Reset the layout'),
        onClick: () => setDepl({}),
      }, '⟲') : null,
      h('svg', { className: 'dshdb-liens', width: dispo.largeur, height: dispo.hauteur }, liens),
      cartes))
}

/** The name of a view of the Data tab (the keys come from the pack: liste, cartes, calendrier). */
const nomVue = (v) => ({ liste: kt('Liste', 'List'), cartes: kt('Cartes', 'Cards'), calendrier: kt('Calendrier', 'Calendar') })[v] || v
const pad2 = (n) => (n < 10 ? '0' + n : String(n))
/** The locale of the dates and numbers shown: French for a French UI, English for every other language. */
const localeDate = () => kt('fr-FR', 'en-US')
/** The week starts on Monday (2024-01-01 was one); the day letters come from the language. */
const initialesJours = () => [0, 1, 2, 3, 4, 5, 6].map((i) => new Date(2024, 0, 1 + i).toLocaleDateString(localeDate(), { weekday: 'narrow' }))

/** Month grid (Monday first): cells + the entries of the date field. */
function construireCalendrier (lignes, dateCol, annee, mois) {
  const depart = (new Date(annee, mois, 1).getDay() + 6) % 7
  const nbJours = new Date(annee, mois + 1, 0).getDate()
  const total = Math.ceil((depart + nbJours) / 7) * 7
  const cases = []
  for (let i = 0; i < total; i++) {
    const jour = i - depart + 1
    const dedans = jour >= 1 && jour <= nbJours
    const cle = dedans ? annee + '-' + pad2(mois + 1) + '-' + pad2(jour) : null
    cases.push({
      jour: dedans ? jour : null,
      date: cle,
      entrees: dedans ? lignes.filter((l) => String(l[dateCol] ?? '').slice(0, 10) === cle) : [],
    })
  }
  return { jours: initialesJours(), cases }
}

/** Audio waveform: Web Audio decoding → SVG bars (no dependency). */
function Ondes (props) {
  const [points, setPoints] = React.useState(null)
  React.useEffect(() => {
    let vivant = true
    const AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null
    if (AC === null || typeof fetch !== 'function') return undefined
    fetch(props.src)
      .then((r) => r.arrayBuffer())
      .then((b) => new AC().decodeAudioData(b))
      .then((buf) => {
        if (!vivant) return
        const n = 48; const pas = Math.max(1, Math.floor(buf.length / n)); const vals = buf.getChannelData(0)
        const pts = []
        for (let i = 0; i < n; i++) {
          let max = 0
          for (let k = 0; k < pas; k += 4) max = Math.max(max, Math.abs(vals[i * pas + k] || 0))
          pts.push(Math.min(1, max))
        }
        setPoints(pts)
      })
      .catch(() => {})
    return () => { vivant = false }
  }, [props.src])
  if (points === null) return null
  return h('svg', { className: 'dshdb-ondes', viewBox: '0 0 192 24', preserveAspectRatio: 'none' },
    points.map((v, i) => h('rect', {
      key: 'b' + i, x: i * 4, y: 12 - v * 11, width: 2.6,
      height: Math.max(2, v * 22), rx: 1.3, fill: 'currentColor', opacity: 0.55,
    })))
}

/** Cards view: logo, the pack's fields, audio player + waveform. */
function VueCartes (props) {
  const e = props.entite
  const noms = props.data.colonnes.map((c) => c.name)
  const champs = (e.champs || noms.filter((n) => n !== 'id'))
  const titre = champs[0]
  const logo = e.logo
  const audio = e.audio
  return h('div', { className: 'dshdb-cards' }, props.data.lignes.map((l, i) =>
    h('div', { className: 'dshdb-cardv', key: 'k' + i },
      h('div', { className: 'dshdb-cardv-head' },
        (logo !== undefined && l[logo])
          ? h('img', { className: 'dshdb-logo', src: String(l[logo]), alt: '' })
          : h('span', { className: 'dshdb-logo nologo' }, String(l[titre] ?? '?').slice(0, 2).toUpperCase()),
        h('div', { className: 'dshdb-cardv-titre' }, String(l[titre] ?? ''))),
      champs.slice(1).map((c) => h('div', { className: 'dshdb-champ', key: c },
        h('span', { className: 'dshdb-champ-n' }, c),
        h('span', { className: 'dshdb-champ-v', title: String(l[c] ?? '') }, String(l[c] ?? '—')))),
      (audio !== undefined && l[audio])
        ? h('div', { className: 'dshdb-audio', key: 'a' },
          h('audio', { controls: true, src: String(l[audio]) }),
          h(Ondes, { src: String(l[audio]) }))
        : null)))
}

/** Calendar view: a month you can move through, the date field's entries per day. */
function VueCalendrier (props) {
  const e = props.entite
  const [pos, setPos] = React.useState(() => {
    // the last month that holds data, else the current month
    let d = new Date()
    for (const l of props.data.lignes) {
      const s = String(l[e.date] ?? '').slice(0, 10)
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const t = new Date(s + 'T00:00'); if (t > d) d = t }
    }
    return { annee: d.getFullYear(), mois: d.getMonth() }
  })
  const g = construireCalendrier(props.data.lignes, e.date, pos.annee, pos.mois)
  const label = String(e.champs && e.champs[0] ? e.champs[0] : e.date)
  const bouger = (delta) => setPos((p) => {
    const d = new Date(p.annee, p.mois + delta, 1)
    return { annee: d.getFullYear(), mois: d.getMonth() }
  })
  return h('div', { className: 'dshdb-cal' },
    h('div', { className: 'dshdb-cal-nav' },
      h('button', { type: 'button', className: 'dshdb-hbtn', onClick: () => bouger(-1) }, '‹'),
      h('b', null, new Date(pos.annee, pos.mois, 1).toLocaleDateString(localeDate(), { month: 'long', year: 'numeric' })),
      h('button', { type: 'button', className: 'dshdb-hbtn', onClick: () => bouger(1) }, '›')),
    h('div', { className: 'dshdb-cal-head' }, g.jours.map((j, i) => h('span', { key: 'j' + i }, j))),
    h('div', { className: 'dshdb-cal-grille' }, g.cases.map((c, i) =>
      h('div', { className: 'dshdb-cal-case' + (c.jour === null ? ' hors' : ''), key: 'c' + i },
        c.jour === null ? null : h('span', { className: 'dshdb-cal-jour' }, String(c.jour)),
        c.entrees.slice(0, 2).map((l, k) => h('span', {
          className: 'dshdb-cal-entree', key: 'e' + k,
          title: String(l[label] ?? l[e.date] ?? ''),
        }, String(l[label] ?? l[e.date] ?? ''))),
        c.entrees.length > 2 ? h('span', { className: 'dshdb-cal-plus', key: 'p' }, '+' + (c.entrees.length - 2)) : null))))
}

/** List view: the raw table (the former Data view). */
function VueListe (props) {
  const d = props.data
  const out = [h('table', { className: 'dshdb-table', key: 'tab' },
    h('thead', null, h('tr', null, d.colonnes.map((c) => h('th', { key: c.name }, c.name)))),
    h('tbody', null, d.lignes.map((l, i) => h('tr', { key: 'r' + i },
      d.colonnes.map((c) => h('td', { key: c.name, title: String(l[c.name] ?? '') }, String(l[c.name] ?? '')))))))]
  if (d.compte > d.lignes.length) out.push(h('div', { className: 'dshdb-note', key: 'plus' }, kt(d.lignes.length + ' premières lignes sur ' + d.compte, 'First ' + d.lignes.length + ' of ' + d.compte + ' rows')))
  return out
}

/**
 * Data view: the entities declared by the pack (the database's `pack` table) +
 * List · Cards · Calendar views. Without a pack: a flat list of the tables.
 */
function Donnees (props) {
  const entites = props.packEntites !== null && props.packEntites !== undefined
    ? props.packEntites
    : props.schema.tables.map((t) => ({ table: t.nom, titre: t.nom, vues: ['liste'] }))
  const [table, setTable] = React.useState(entites.length > 0 ? entites[0].table : null)
  const [vue, setVue] = React.useState(entites.length > 0 ? (entites[0].vues || ['liste'])[0] : 'liste')
  const [etat, setEtat] = React.useState({ chargement: false, data: null, erreur: null })
  const courante = entites.find((x) => x.table === table) || entites[0] || null
  React.useEffect(() => {
    if (table === null) return undefined
    let vivant = true
    setEtat({ chargement: true, data: null, erreur: null })
    api('/dsh-db-viewer/rows', { base: props.baseId, table, limit: 200 })
      .then((data) => { if (vivant) setEtat({ chargement: false, data, erreur: null }) })
      .catch((e) => { if (vivant) setEtat({ chargement: false, data: null, erreur: explain(e) }) })
    return () => { vivant = false }
  }, [table, props.baseId])
  const vues = (courante !== null && courante.vues) || ['liste']
  const vueActive = vues.indexOf(vue) !== -1 ? vue : vues[0]
  const chips = entites.map((x) => h('button', {
    type: 'button', key: x.table,
    className: 'dshdb-chip' + (x.table === table ? ' on' : ''),
    onClick: () => { setTable(x.table); setVue((x.vues || ['liste'])[0]) },
  }, x.titre))
  const corps = [h('div', { className: 'dshdb-chips', key: 'chips' }, chips)]
  if (vues.length > 1) {
    corps.push(h('div', { className: 'dshdb-modes', key: 'modes' }, vues.map((v) =>
      h('button', {
        type: 'button', key: v,
        className: 'dshdb-mode' + (v === vueActive ? ' on' : ''),
        onClick: () => setVue(v),
      }, nomVue(v)))))
  }
  if (etat.erreur !== null) corps.push(h('div', { className: 'dshdb-err', key: 'err' }, etat.erreur))
  if (etat.chargement) corps.push(h('div', { className: 'dshdb-note', key: 'load' }, kt('Chargement…', 'Loading…')))
  if (etat.data !== null) {
    const d = etat.data
    if (vueActive === 'cartes') corps.push(h(VueCartes, { key: 'v', entite: courante, data: d }))
    else if (vueActive === 'calendrier' && courante !== null && courante.date) corps.push(h(VueCalendrier, { key: 'v', entite: courante, data: d }))
    else corps.push(h(VueListe, { key: 'v', data: d }))
  }
  return h('div', { className: 'dshdb-view' }, corps)
}

// A result is shown 500 rows at a time and the host cuts it (it used to send every row: 200 000 rows froze the page
// for ~14 s). « Show more rows » asks twice as many, up to what the host gives (index.js, LIMITE_REQUETE_MAX).
const PAGE_SQL = 500
const PAGE_SQL_MAX = 5000

/** « Showing the first 500 of 200,000 rows. » for a result the host cut, null for a whole one. */
function noteSql (d) {
  if (d === null || d === undefined || d.tronque !== true) return null
  const n = (x) => Number(x).toLocaleString(localeDate())
  return kt('Affichage des ' + n(d.compte) + ' premières lignes sur ' + (d.borne === true ? 'plus de ' : '') + n(d.total) + '.',
    'Showing the first ' + n(d.compte) + ' of ' + (d.borne === true ? 'more than ' : '') + n(d.total) + ' rows.')
}

/** The size asked next: twice the last one, never more than the host would give. */
function limiteSqlSuivante (limite) { return Math.min(limite * 2, PAGE_SQL_MAX) }

/** SQL view: one SELECT query, its result. Nothing written gets through. */
function Sql (props) {
  const [sql, setSql] = React.useState('SELECT * FROM societes LIMIT 20')
  const [etat, setEtat] = React.useState({ lance: false, data: null, erreur: null, limite: PAGE_SQL })
  const lancer = (limite) => {
    // « Show more rows » keeps the rows already on screen until the larger answer arrives.
    setEtat((avant) => ({ lance: true, data: limite > PAGE_SQL ? avant.data : null, erreur: null, limite }))
    api('/dsh-db-viewer/query', { base: props.baseId, sql, limit: limite })
      .then((data) => setEtat({ lance: false, data, erreur: null, limite }))
      .catch((e) => setEtat({ lance: false, data: null, erreur: explain(e), limite }))
  }
  const corps = [h('textarea', {
    key: 'sql', value: sql, spellCheck: false,
    onChange: (e) => setSql(e.target.value),
  }),
  h('button', { type: 'button', className: 'dshdb-run', key: 'run', onClick: () => lancer(PAGE_SQL) }, kt('Exécuter', 'Run'))]
  if (etat.erreur !== null) corps.push(h('div', { className: 'dshdb-err', key: 'err' }, etat.erreur))
  if (etat.data !== null) {
    const d = etat.data
    if (d.colonnes.length === 0) corps.push(h('div', { className: 'dshdb-note', key: 'vide' }, kt('Aucune ligne', 'No rows')))
    else {
      // The note sits above the table AND under it: 500 rows is a long scroll.
      const note = noteSql(d)
      const encore = d.compte < PAGE_SQL_MAX
      const bandeau = (cle) => h('div', { className: 'dshdb-note dshdb-cut', key: cle, 'data-dshdb': 'cut' },
        note + (encore ? '' : kt(' Affine la requête (WHERE ou LIMIT) pour voir les autres.', ' Narrow the query (WHERE or LIMIT) to see the others.')),
        encore ? h('button', {
          type: 'button', className: 'dshdb-more', 'data-dshdb': 'more', disabled: etat.lance,
          onClick: () => lancer(limiteSqlSuivante(etat.limite)),
        }, etat.lance ? kt('Chargement…', 'Loading…') : kt('Afficher plus de lignes', 'Show more rows')) : null)
      if (note !== null) corps.push(bandeau('cut-haut'))
      corps.push(h('table', { className: 'dshdb-table', key: 'tab' },
        h('thead', null, h('tr', null, d.colonnes.map((c) => h('th', { key: c }, c)))),
        h('tbody', null, d.lignes.map((l, i) => h('tr', { key: 'r' + i },
          d.colonnes.map((c) => h('td', { key: c, title: String(l[c] ?? '') }, String(l[c] ?? ''))))))))
      if (note !== null) corps.push(bandeau('cut-bas'))
    }
  }
  return h('div', { className: 'dshdb-view' }, h('div', { className: 'dshdb-sql' }, corps))
}

// ── Charts: column analysis + ECharts options (pure, tested) ────────────────

/** rgba() from a #rrggbb hex — readable gradients without depending on echarts. */
function avecAlpha (hex, a) {
  const n = parseInt(hex.slice(1), 16)
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'
}

/** Is the app in a dark theme? Luminance of the body background. */
function themeSombre () {
  try {
    const m = String(getComputedStyle(document.body).backgroundColor).match(/\d+(\.\d+)?/g) || [255, 255, 255]
    return (0.2126 * Number(m[0]) + 0.7152 * Number(m[1]) + 0.0722 * Number(m[2])) / 255 < 0.5
  } catch (e) { return false }
}

/** Profile of a table from its rows: categories, numbers, dates. */
function profiler (table, lignes) {
  const prof = { cats: [], nums: [], dates: [] }
  for (const c of table.colonnes) {
    const valeurs = lignes.map((l) => l[c.name]).filter((v) => v !== null && v !== undefined)
    if (valeurs.length < 3) continue
    const estDate = valeurs.every((v) => typeof v === 'string' && /^\d{4}-\d{2}/.test(v))
    const estNum = valeurs.every((v) => typeof v === 'number')
    const distincts = new Map()
    for (const v of valeurs) { const k = String(v); distincts.set(k, (distincts.get(k) || 0) + 1) }
    if (estDate) prof.dates.push({ col: c.name, valeurs })
    else if (estNum && c.pk !== true && c.fk !== true) prof.nums.push({ col: c.name, valeurs })
    else if (!estNum && c.pk !== true && c.fk !== true && distincts.size >= 2 && distincts.size <= 8) {
      prof.cats.push({ col: c.name, parts: [...distincts.entries()].map(([v, n]) => ({ v, n })).sort((a, b) => b.n - a.n) })
    }
  }
  return prof
}

/**
 * Auto-built chart cards: a global donut + at best one card per table
 * (count per category, then a time curve, then categories).
 */
function construireGraphiques (schema, donnees, sombre) {
  const texte = sombre ? 'rgba(249,250,251,.74)' : 'rgba(15,17,21,.68)'
  const trait = sombre ? 'rgba(249,250,251,.09)' : 'rgba(15,17,21,.09)'
  const axeCommun = { axisLabel: { color: texte, fontSize: 10 }, axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: trait } } }
  const grille = { left: 6, right: 14, top: 10, bottom: 2, containLabel: true }
  const sortie = []
  sortie.push({
    titre: kt('Lignes par table', 'Rows per table'),
    options: {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'item', formatter: kt('{b} : {c} ({d} %)', '{b}: {c} ({d}%)') },
      legend: { bottom: 0, icon: 'roundRect', itemWidth: 9, itemHeight: 9, textStyle: { color: texte, fontSize: 10 } },
      series: [{
        type: 'pie', radius: ['44%', '70%'], center: ['50%', '45%'],
        itemStyle: { borderRadius: 6, borderColor: 'transparent', borderWidth: 2 },
        label: { color: texte, fontSize: 10 }, emphasis: { scaleSize: 5 },
        data: schema.tables.map((t, i) => ({ name: t.nom, value: t.compte, itemStyle: { color: PALETTE[i % PALETTE.length] } })),
      }],
    },
  })
  for (const t of schema.tables.slice(0, 4)) {
    if (sortie.length >= 5) break
    const lignes = donnees[t.nom] || []
    if (lignes.length < 2) continue
    const prof = profiler(t, lignes)
    const num = prof.nums[0]; const cat = prof.cats[0]; const date = prof.dates[0]
    const i = schema.tables.indexOf(t)
    const c1 = PALETTE[i % PALETTE.length]
    const c2 = PALETTE[(i + 3) % PALETTE.length]
    if (num !== undefined && cat !== undefined) {
      const sommes = new Map()
      lignes.forEach((l) => {
        const k = String(l[cat.col] ?? '—')
        sommes.set(k, (sommes.get(k) || 0) + (Number(l[num.col]) || 0))
      })
      const entrees = [...sommes.entries()].sort((a, b) => a[1] - b[1])
      sortie.push({
        titre: kt('« ' + num.col + ' » par « ' + cat.col + ' » — ' + t.nom, '“' + num.col + '” by “' + cat.col + '” — ' + t.nom),
        options: {
          backgroundColor: 'transparent',
          tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
          grid: grille,
          xAxis: { type: 'category', data: entrees.map((e) => e[0]), ...axeCommun, splitLine: { show: false }, axisLabel: { color: texte, fontSize: 10, rotate: entrees.length > 4 ? 30 : 0 } },
          yAxis: { type: 'value', ...axeCommun },
          series: [{
            type: 'bar', barMaxWidth: 26, data: entrees.map((e) => Math.round(e[1] * 100) / 100),
            itemStyle: { borderRadius: [7, 7, 0, 0], color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: c1 }, { offset: 1, color: avecAlpha(c2, 0.55) }] } },
            showBackground: true, backgroundStyle: { color: avecAlpha('#808080', 0.1), borderRadius: 7 },
          }],
        },
      })
    } else if (date !== undefined) {
      const parJour = new Map()
      lignes.forEach((l) => { const k = String(l[date.col]).slice(0, 10); parJour.set(k, (parJour.get(k) || 0) + 1) })
      const jours = [...parJour.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
      sortie.push({
        titre: kt(t.nom + ' dans le temps — « ' + date.col + ' »', t.nom + ' over time — “' + date.col + '”'),
        options: {
          backgroundColor: 'transparent',
          tooltip: { trigger: 'axis' },
          grid: grille,
          xAxis: { type: 'category', boundaryGap: false, data: jours.map((j) => j[0].slice(5)), ...axeCommun, splitLine: { show: false } },
          yAxis: { type: 'value', ...axeCommun, minInterval: 1 },
          series: [{
            type: 'line', smooth: true, symbol: 'circle', symbolSize: 6, data: jours.map((j) => j[1]),
            lineStyle: { width: 2.5, color: c1 }, itemStyle: { color: c1 },
            areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: avecAlpha(c1, 0.32) }, { offset: 1, color: avecAlpha(c1, 0.02) }] } },
          }],
        },
      })
    } else if (cat !== undefined) {
      sortie.push({
        titre: kt('« ' + cat.col + ' » — ' + t.nom, '“' + cat.col + '” — ' + t.nom),
        options: {
          backgroundColor: 'transparent',
          tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
          grid: { left: 6, right: 24, top: 6, bottom: 2, containLabel: true },
          xAxis: { type: 'value', ...axeCommun },
          yAxis: { type: 'category', data: cat.parts.map((p) => p.v).reverse(), ...axeCommun, splitLine: { show: false } },
          series: [{
            type: 'bar', barWidth: 12, data: cat.parts.map((p) => p.n).reverse(),
            itemStyle: { borderRadius: [0, 7, 7, 0], color: { type: 'linear', x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: avecAlpha(c1, 0.55) }, { offset: 1, color: c2 }] } },
            showBackground: true, backgroundStyle: { color: avecAlpha('#808080', 0.1), borderRadius: 7 },
          }],
        },
      })
    } else if (num !== undefined) {
      const vals = lignes.slice(0, 20).map((l) => Number(l[num.col]) || 0)
      sortie.push({
        titre: kt('« ' + num.col + ' » — ' + t.nom, '“' + num.col + '” — ' + t.nom),
        options: {
          backgroundColor: 'transparent',
          tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
          grid: grille,
          xAxis: { type: 'category', data: vals.map((_, k) => String(k + 1)), ...axeCommun, splitLine: { show: false } },
          yAxis: { type: 'value', ...axeCommun },
          series: [{
            type: 'bar', barMaxWidth: 18, data: vals,
            itemStyle: { borderRadius: [7, 7, 0, 0], color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: c1 }, { offset: 1, color: avecAlpha(c2, 0.55) }] } },
          }],
        },
      })
    }
  }
  return sortie
}

/** One chart card: creates the ECharts instance, follows resizes, disposes itself. */
function Graphique (props) {
  const ref = React.useRef(null)
  React.useEffect(() => {
    const el = ref.current
    if (el === null || echarts === null) return undefined
    const chart = echarts.init(el, props.sombre ? 'dark' : undefined)
    chart.setOption(props.options)
    let ro = null
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(() => chart.resize()); ro.observe(el) }
    return () => { if (ro !== null) ro.disconnect(); chart.dispose() }
  }, [props.options, props.sombre])
  return h('div', { className: 'dshdb-chartbox', ref })
}

/** Charts view: KPI strip + auto-built ECharts cards. */
function Graphiques (props) {
  const [sombre] = React.useState(themeSombre)
  const [etat, setEtat] = React.useState({ chargement: true, donnees: null, erreur: null })
  React.useEffect(() => {
    let vivant = true
    setEtat({ chargement: true, donnees: null, erreur: null })
    Promise.all(props.schema.tables.map((t) =>
      api('/dsh-db-viewer/rows', { base: props.baseId, table: t.nom, limit: 200 })
        .then((d) => [t.nom, d.lignes])
        .catch(() => [t.nom, []])
    )).then((paires) => {
      if (!vivant) return
      const donnees = {}
      paires.forEach(([nom, lignes]) => { donnees[nom] = lignes })
      setEtat({ chargement: false, donnees, erreur: null })
    }).catch((e) => { if (vivant) setEtat({ chargement: false, donnees: null, erreur: explain(e) }) })
    return () => { vivant = false }
  }, [props.baseId, props.schema])

  const s = props.schema
  const kpis = [
    [s.tables.length, 'tables'],
    [s.tables.reduce((n, t) => n + t.compte, 0), kt('lignes', 'rows')],
    [s.relations.length, 'relations'],
    [s.tables.reduce((n, t) => n + t.colonnes.length, 0), kt('colonnes', 'columns')],
  ]
  const kids = [h('div', { className: 'dshdb-kpis', key: 'kpis' }, kpis.map(([v, l], i) =>
    h('div', { className: 'dshdb-kpi', key: 'k' + i }, h('b', null, String(v)), h('span', null, l))))]
  if (echarts === null) kids.push(h('div', { className: 'dshdb-note', key: 'novendor' }, kt('Graphiques indisponibles : le module ECharts n’est pas chargé.', 'Charts unavailable: the ECharts module did not load.')))
  else if (etat.erreur !== null) kids.push(h('div', { className: 'dshdb-err', key: 'err' }, etat.erreur))
  else if (etat.donnees !== null) {
    const cartes = construireGraphiques(s, etat.donnees, sombre)
    kids.push(h('div', { className: 'dshdb-charts', key: 'charts' }, cartes.map((c, i) =>
      h('div', { className: 'dshdb-chart', key: 'c' + i },
        h('h4', null, c.titre),
        h(Graphique, { key: 'g' + i, options: c.options, sombre })))))
  } else {
    kids.push(h('div', { className: 'dshdb-note', key: 'load' }, kt('Lecture des données…', 'Reading the data…')))
  }
  return h('div', { className: 'dshdb-view' }, kids)
}

/** Body of the right-sidebar tab: database picker + internal views. */
function TabBody () {
  const [bases, setBases] = React.useState(null)
  const [baseId, setBaseId] = React.useState(null)
  const [schema, setSchema] = React.useState(null)
  const [packEntites, setPackEntites] = React.useState(null)
  const [erreur, setErreur] = React.useState(null)
  const [onglet, setOnglet] = React.useState('diagramme')

  const chargerBases = () => {
    setErreur(null)
    api('/dsh-db-viewer/bases')
      .then((d) => {
        setBases(d.bases)
        if (d.bases.length > 0) setBaseId((courant) => (courant === null ? d.bases[0].id : courant))
      })
      .catch((e) => setErreur(explain(e)))
  }
  React.useEffect(chargerBases, [])

  React.useEffect(() => {
    if (baseId === null) return
    let vivant = true
    setSchema(null)
    // The error of a database that could not be read belongs to that database: the one chosen now starts without it.
    setErreur(null)
    api('/dsh-db-viewer/schema', { base: baseId })
      .then((s) => { if (vivant) setSchema(s) })
      .catch((e) => { if (vivant) setErreur(explain(e)) })
    return () => { vivant = false }
  }, [baseId])

  // The “mini-app pack” lives in the database (`pack` table, JSON manifest):
  // entities, fields, allowed views, logo/audio/date columns.
  React.useEffect(() => {
    if (baseId === null) return undefined
    let vivant = true
    setPackEntites(null)
    api('/dsh-db-viewer/query', { base: baseId, sql: 'SELECT contenu FROM pack LIMIT 1' })
      .then((d) => {
        if (!vivant || d.lignes.length === 0) return
        try { setPackEntites(JSON.parse(String(d.lignes[0].contenu)).entites || null) } catch (e) { /* unreadable pack: fall back to the flat list */ }
      })
      .catch(() => {})
    return () => { vivant = false }
  }, [baseId])

  const kids = []
  kids.push(h('div', { className: 'dshdb-bar', key: 'bar' },
    h('span', { className: 'dshdb-title' }, kt('Base de l’Agent Team', 'Agent Team database')),
    h('select', {
      className: 'dshdb-select', value: baseId === null ? '' : baseId,
      onChange: (e) => setBaseId(e.target.value),
    }, (bases || []).map((b) => h('option', { key: b.id, value: b.id }, b.id))),
    h('button', { type: 'button', className: 'dshdb-hbtn', title: kt('Relire la base', 'Reload the database'), onClick: chargerBases }, '↻')))

  kids.push(h('div', { className: 'dshdb-pills', key: 'pills' },
    [['diagramme', kt('Diagramme', 'Diagram')], ['graphiques', kt('Graphiques', 'Charts')], ['donnees', kt('Données', 'Data')], ['sql', 'SQL']].map(([cle, label]) =>
      h('button', {
        type: 'button', key: cle,
        className: 'dshdb-pill' + (onglet === cle ? ' on' : ''),
        onClick: () => setOnglet(cle),
      }, label))))

  if (erreur !== null) kids.push(h('div', { className: 'dshdb-err', key: 'err' }, erreur))
  if (bases !== null && bases.length === 0) {
    kids.push(h('div', { className: 'dshdb-note', key: 'vide' }, kt('Aucune base pour l’instant — une Agent Team la crée avec « crm.cjs init ».', 'No database yet — an Agent Team creates one with “crm.cjs init”.')))
  } else if (baseId !== null && schema !== null) {
    if (onglet === 'diagramme') kids.push(h(Diagramme, { key: 'v', schema }))
    else if (onglet === 'graphiques') kids.push(h(Graphiques, { key: 'v', baseId, schema }))
    else if (onglet === 'donnees') kids.push(h(Donnees, { key: 'v', baseId, schema, packEntites }))
    else kids.push(h(Sql, { key: 'v', baseId }))
  } else if (baseId !== null && erreur === null) {
    // Only while it is being read: a schema that failed to load is not « being read » any more (the error says so above).
    kids.push(h('div', { className: 'dshdb-note', key: 'load' }, kt('Lecture du schéma…', 'Reading the schema…')))
  }

  return h('div', { className: 'dshdb-root' }, kids)
}

function apply (ctx) {
  // Fine-grained diagnostics: each block is isolated so that the exact exception
  // is logged instead of letting the fiber go silently to « failed ».
  const tenter = (label, fn) => {
    try { return fn() } catch (e) { console.error('[dsh-db-viewer] failed: ' + label, e); return null }
  }
  const slots = tenter('slots', () => (ctx.slots !== undefined && ctx.slots !== null ? ctx.slots : ctx.get('slots')))
  if (slots === undefined || slots === null || typeof slots.register !== 'function') {
    console.error('[dsh-db-viewer] slots service unavailable: no interface')
    return
  }
  const sidebarTabs = tenter('get sidebarRightTabs', () => ctx.get('sidebarRightTabs'))

  // Styles: one-shot injection WITHOUT cleanup. Measured: the cleanup of
  // ctx.effect ends up removing the <style> while the panel is still mounted
  // (CSS lost → block grids, ECharts canvas at 0). One sheet per page,
  // idempotent, survives any lifecycle of the fiber.
  tenter('styles', () => {
    if (document.getElementById('dsh-db-viewer-styles') === null) {
      const s = document.createElement('style')
      s.id = 'dsh-db-viewer-styles'
      s.textContent = CSS
      document.head.appendChild(s)
    }
  })

  // The icon of this tab in the « Start » picker of the right sidebar: the engine draws a grey cube for a type that gives none, and nine tabs of the suite looked the same (V-25).
  // A line icon in the ink of the picker, one per plugin; the engine calls it as a component with { size, className }.
  // KB-TABICON-BEGIN
  const KB_TAB_ICON = (props) => { const px = (props !== null && props !== undefined && typeof props.size === 'number') ? props.size : 22; return React.createElement('svg', { width: px, height: px, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', className: (props !== null && props !== undefined) ? props.className : undefined }, ['M3 5a9 3 0 1 0 18 0a9 3 0 1 0-18 0', 'M3 5v14a9 3 0 0 0 18 0V5', 'M3 12a9 3 0 0 0 18 0'].map((d, i) => React.createElement('path', { key: i, d }))) }
  // KB-TABICON-END
  if (sidebarTabs !== undefined && sidebarTabs !== null && typeof sidebarTabs.register === 'function') {
    tenter('sidebarTabs.register', () => ctx.effect(() => sidebarTabs.register({
      id: TYPE_ID,
      kind: KIND,
      title: () => kt('Base de données', 'Databases'),
      // The guide host calls title()/description(): bare strings crash the slot
      // entry (see the kybers lesson: « entry.title is not a function »).
      guide: [{
        icon: KB_TAB_ICON,
        title: () => kt('Base de données', 'Databases'),
        description: () => kt('Diagramme, graphiques, données et SQL des petites bases SQLite des Agent Teams', 'Diagram, charts, data and SQL of the small SQLite databases of Agent Teams'),
      }],
    }), 'dsh-db-viewer: right sidebar tab type'))
  }
  // `slots.inject` (the runner's contract) is AWARE of the declaration: the
  // `sidebar.right.pane.tab` hole is declared by ui-sidebar-right, whose
  // activation is not ordered with ours — a direct `register` would die on
  // « slot is not declared ». The injector replays when the hole comes back
  // (see ARB-1 kybernos).
  tenter('slots.inject', () => ctx.effect(() => slots.inject('sidebar.right.pane.tab', () => slots.register({ name: 'sidebar.right.pane.tab', key: TYPE_ID }, TabBody)), 'dsh-db-viewer: right sidebar tab body'))
}

return {
  name: NAME,
  // The export contract of a cordis entry: the services the context MUST
  // expose. `apply` reads `ctx.slots` (the ctx guard REFUSES any undeclared
  // ctx.<service> and the entry fails at boot — measured on 24/09: « cannot
  // get property "slots" without inject »). `sidebarRightTabs` is provided by
  // ui-sidebar-right: declaring it puts the fiber in « pending » until the
  // service is provided — without it, our apply ran BEFORE the provide and
  // `ctx.get('sidebarRightTabs')` returned undefined (tab type never
  // registered, entry missing from the guide).
  inject: ['slots', 'sidebarRightTabs'],
  apply,
  __test: { calculerDisposition, ancresRelation, cheminLien, PALETTE, profiler, construireGraphiques, construireCalendrier, positionsFinales, noteSql, limiteSqlSuivante, PAGE_SQL, PAGE_SQL_MAX },
}
