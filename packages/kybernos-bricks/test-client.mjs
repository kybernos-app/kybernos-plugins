// ═══════════════════════════════════════════════════════════════════════════
// Tests de kybernos-bricks — moitié CLIENT, hors navigateur.
//
// Le bundle est écrit dans le format du chargeur DSH (`window.__ModuleLoader__`)
// ET dans un navigateur : on fournit donc un faux chargeur, un faux `document`
// (canevas de rendu enregistreur) et un faux React à crochets inertes, puis :
//   1. on vérifie le CÂBLAGE : type d'onglet et corps de panneau — et
//      l'ABSENCE de bouton dans le pied de la sidebar ;
//   2. on vérifie le MOTEUR sur les 9 archétypes — et surtout qu'aucun n'a
//      d'îlot de briques détachées (le défaut le plus coûteux d'un générateur) ;
//   3. on vérifie l'EXÉCUTEUR D'OPS : chaque op produit des briques, dans l'ordre ;
//   4. on vérifie que le RENDU tourne et remplit le canevas ;
//   5. on rend le panneau une fois (crochets inertes) pour lire son chrome.
//
// Usage : node kybernos-bricks/test-client.mjs
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs'

let echecs = 0
const ok = (label, condition, detail) => {
  if (condition) console.log(`✓ ${label}${detail === undefined ? '' : ` (${detail})`}`)
  else { console.error(`✗ ${label}${detail === undefined ? '' : ` — ${detail}`}`); echecs += 1 }
}

// ── faux navigateur ─────────────────────────────────────────────────────────
const appels = { fill: 0, stroke: 0, arc: 0, drawImage: 0 }
function fauxContexte () {
  const ctx = {
    setTransform: () => {}, transform: () => {}, save: () => {}, restore: () => {},
    clearRect: () => {}, fillRect: () => {}, beginPath: () => {}, closePath: () => {},
    moveTo: () => {}, lineTo: () => {}, arc: () => { appels.arc += 1 },
    ellipse: () => {}, fill: () => { appels.fill += 1 }, stroke: () => { appels.stroke += 1 },
    drawImage: () => { appels.drawImage += 1 },
    set fillStyle (v) { this._f = v }, get fillStyle () { return this._f },
    set strokeStyle (v) { this._s = v }, get strokeStyle () { return this._s },
    set lineWidth (v) {}, set filter (v) {}, set globalAlpha (v) {},
  }
  return ctx
}
const faussCanvas = () => ({ width: 0, height: 0, clientWidth: 340, clientHeight: 260, style: {}, getContext: () => fauxContexte(), toDataURL: () => 'data:,', addEventListener: () => {}, removeEventListener: () => {} })

let definition = null
globalThis.window = {
  __ModuleLoader__: { load: (d) => { definition = d } },
  devicePixelRatio: 1,
  addEventListener: () => {},
}
globalThis.document = {
  createElement: (tag) => (tag === 'canvas' ? faussCanvas() : { style: {}, appendChild: () => {}, set textContent (v) {}, id: '' }),
  getElementById: () => null,
  head: { appendChild: () => {} },
}
globalThis.requestAnimationFrame = () => 1
globalThis.cancelAnimationFrame = () => {}
globalThis.fetch = async () => ({ ok: false, json: async () => ({ vide: true }) })
globalThis.ResizeObserver = class { observe () {} disconnect () {} }

// Faux React : `createElement` construit un arbre lisible, les crochets sont
// inertes (on ne veut ni effets ni re-rendus dans le harnais).
const React = {
  createElement: (type, props, ...enfants) => ({ type, props: props || {}, enfants: enfants.flat(Infinity).filter((e) => e !== null && e !== undefined && e !== false) }),
  Fragment: 'Fragment',
  useReducer: (_r, init) => [init, () => {}],
  useRef: (v) => ({ current: v === undefined ? null : v }),
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
  useEffect: () => {},
}
const h = React.createElement

// ── chargement ──────────────────────────────────────────────────────────────
const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
// eslint-disable-next-line no-new-func
new Function('window', 'document', 'React', source)(globalThis.window, globalThis.document, React)

ok('le bundle se charge dans le format du ModuleLoader', typeof definition === 'object' && definition !== null)
ok('identifiant du module', definition.id === '@local/kybernos-bricks/client', definition.id)
const plugin = definition.factory((nom) => { if (nom === 'react') return React; throw new Error('require inattendu : ' + nom) })
ok('le plugin déclare `slots` en inject', Array.isArray(plugin.inject) && plugin.inject.includes('slots'))
ok('le plugin attend `sidebarRightTabs` avant de s\'appliquer',
  plugin.inject.includes('sidebarRightTabs'), plugin.inject.join('+'))
ok('le plugin expose `apply`', typeof plugin.apply === 'function')
const T = plugin.__test
ok('la surface de test est exposée', T !== undefined && typeof T.construire === 'function')

// ── 2. les neuf archétypes : construisibles, d'un seul tenant ───────────────
function ilots (model) {
  const cellules = new Set()
  const solides = model.bricks.filter((b) => !b.decal)
  for (const b of solides) for (let j = b.y; j < b.y + b.d; j++) for (let i = b.x; i < b.x + b.w; i++) for (let z = b.z; z < b.z + b.hp; z++) cellules.add(`${i},${j},${z}`)
  const zmin = Math.min(...solides.map((b) => b.z))
  const vus = new Set(); const pile = []
  for (const c of cellules) { if (Number(c.split(',')[2]) === zmin) { vus.add(c); pile.push(c) } }
  while (pile.length) {
    const [x, y, z] = pile.pop().split(',').map(Number)
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const n = `${x + dx},${y + dy},${z + dz}`
      if (cellules.has(n) && !vus.has(n)) { vus.add(n); pile.push(n) }
    }
  }
  let orphelins = 0
  for (const b of solides) {
    let touche = false
    for (let j = b.y; j < b.y + b.d && !touche; j++) for (let i = b.x; i < b.x + b.w && !touche; i++) for (let z = b.z; z < b.z + b.hp; z++) if (vus.has(`${i},${j},${z}`)) { touche = true; break }
    if (!touche) orphelins += 1
  }
  return orphelins
}

for (const [cle, titre] of T.SHOWCASE.map((s) => [s[0], s[1]])) {
  const c = T.construire({ prompt: titre, version: 1, sessionId: 's', cle })
  const n = c.model.bricks.length
  ok(`archétype « ${titre} » construit`, n > 40, `${n} pièces`)
  ok(`archétype « ${titre} » d'un seul tenant`, ilots(c.model) === 0, `${ilots(c.model)} îlot(s)`)
}

// ── 3. l'exécuteur d'ops ────────────────────────────────────────────────────
const ops = [
  { op: 'plate', x: 0, y: 0, z: 0, w: 12, d: 12, color: '#4C9A52', group: 'socle' },
  { op: 'rect', x: 2, y: 2, z: 1, w: 8, d: 8, h: 3, color: '#9BA3A7', group: 'murs' },
  { op: 'disc', cx: 6, cy: 6, r: 3, z: 4, h: 3, color: '#C4291C', group: 'tour' },
  { op: 'ring', cx: 6, cy: 6, r: 5, t: 1, z: 1, h: 3, color: '#2A6FD6', group: 'anneau' },
  { op: 'cone', cx: 6, cy: 6, z: 7, r: 3, niveaux: 3, color: '#8E1B14', group: 'toit' },
  { op: 'pyramid', x: 0, y: 0, z: 1, w: 4, d: 4, niveaux: 2, color: '#D9C08C', group: 'pyramide' },
  { op: 'tree', x: 10, y: 10, z: 1, h: 3, group: 'arbre' },
  { op: 'brique', x: 11, y: 0, z: 1, w: 1, d: 1, h: 3, color: '#F2C31A', group: 'brique' },
  { op: 'nawak', group: 'inconnu' },
]
const avecOps = T.construire({ ops, version: 2, sessionId: 's' })
ok('le chemin `ops` est reconnu', avecOps.source === 'ops')
ok('les 8 lots valides sont comptés (l\'inconnu est ignoré)', avecOps.lots === 8, String(avecOps.lots))
ok('les ops produisent des briques', avecOps.model.bricks.length > 30, `${avecOps.model.bricks.length} pièces`)
ok('les groupes gardent l\'ordre des lots',
  avecOps.model.groups.slice(0, 3).join('|') === 'socle|murs|tour', avecOps.model.groups.join('|'))
ok('un op inconnu ne fabrique pas de groupe',
  !avecOps.model.groups.includes('inconnu') && avecOps.model.groups.length === 8, avecOps.model.groups.join('|'))
ok('une couleur invalide ne casse pas le lot',
  T.construire({ ops: [{ op: 'brique', x: 0, y: 0, z: 0, w: 1, d: 1, color: 'javascript:alert(1)' }] }).model.bricks[0].color.startsWith('#'))

// Le chemin `archetype` : une clé NON reconnue tombait en silence — une
// maquette VIDE qui avait l'air d'avoir réussi. On exige les deux graphies
// (française et anglaise) et un échec MESURABLE sur une clé inventée.
for (const cle of ['chateau', 'castle', 'mosaique', 'mosaic', 'phare', 'colibri', 'camper']) {
  const c = T.construire({ ops: [{ op: 'archetype', cle }], version: 4, sessionId: 's' })
  ok(`archetype « ${cle} » porte des briques`, c.model.bricks.length > 40, `${c.model.bricks.length} pièces`)
}
ok('un archétype est posé comme UN lot compté',
  T.construire({ ops: [{ op: 'archetype', cle: 'chateau' }] }).lots === 1)
ok('un archétype inconnu ne rend pas des briques par accident',
  T.construire({ ops: [{ op: 'archetype', cle: 'licorne-en-plastique' }] }).model.bricks.length === 0)

// ── 4. le rendu ─────────────────────────────────────────────────────────────
const cam = T.makeCam()
const modele = T.construire({ prompt: 'un château', version: 3, sessionId: 's' }).model
const bd = modele.bounds()
cam._z0 = bd.z0
T.fitCamera(cam, 340, 260, bd, 0.86)
const avantRendu = appels.fill
T.renderScene(fauxContexte(), 340, 260, modele.bricks.slice(0, 300), cam, { occ: modele.occ, bg: '#f7f6f3', studs: true })
ok('renderScene dessine des faces', appels.fill - avantRendu > 100, `${appels.fill - avantRendu} remplissages`)

// ── 5. le câblage et le chrome du panneau ───────────────────────────────────
const types = []; const depots = []; const injections = []
const arrets = []
let ouvert = 0
const ctx = {
  get: (nom) => {
    if (nom === 'sidebarRight') return { openTab: () => { ouvert += 1 } }
    if (nom === 'sidebarRightTabs') return { register: (d) => { types.push(d); return () => {} } }
    return undefined
  },
  effect: (f) => { const d = f(); if (typeof d === 'function') arrets.push(d); return () => {} },
  slots: {
    inject: (nom, f) => { injections.push(nom); return f() },
    register: (opts, composant) => { depots.push({ opts, composant }); return () => {} },
  },
}
plugin.apply(ctx)
ok('le type d\'onglet est enregistré une fois', types.length === 1, String(types.length))
ok('l\'identifiant et le genre du type', types[0]?.id === 'kybernos-bricks' && types[0]?.kind === 'kybernos-bricks')
ok('le titre du type est une FONCTION (l\'hôte l\'appelle)', typeof types[0]?.title === 'function', typeof types[0]?.title)
ok('le guide fournit titre et description',
  typeof types[0]?.guide?.[0]?.title === 'function' && typeof types[0]?.guide?.[0]?.description === 'function')
const corps = depots.find((d) => d.opts.name === 'sidebar.right.pane.tab')
ok('le corps du panneau est déposé dans le bon trou', corps !== undefined && corps.opts.key === 'kybernos-bricks')
// Un « ▦ Briques » permanent traînait dans le pied de la sidebar : le type
// d'onglet est déjà offert par le sélecteur de la barre latérale droite, et le
// panneau s'ouvre seul quand une maquette arrive. Le raccourci de secours ne
// valait pas un meuble de plus dans le menu principal.
ok('aucun bouton dans le pied de la sidebar',
  !depots.some((d) => d.opts.name === 'sidebar.footer.action'))
ok('un seul trou est injecté, celui du panneau',
  injections.length === 1 && injections[0] === 'sidebar.right.pane.tab', injections.join('+'))

const arbre = corps.composant({})
const noeuds = []
;(function parcourir (n) { if (n === null || n === undefined) return; if (Array.isArray(n)) { n.forEach(parcourir); return } noeuds.push(n); if (n.enfants) n.enfants.forEach(parcourir) })(arbre)
const classes = noeuds.map((n) => (n.props && n.props.className) || '').join(' ')
ok('le panneau rend son canevas', noeuds.some((n) => n.type === 'canvas'))
ok('le panneau rend son en-tête', classes.includes('kbb-head'))
ok('le panneau rend son bandeau de transport', classes.includes('kbb-play') || classes.includes('kbb-foot'))
ok('l\'état vide propose les aperçus des 8 vitrines',
  noeuds.filter((n) => n.props && n.props.cle !== undefined).length >= T.SHOWCASE.length,
  `${noeuds.filter((n) => n.props && n.props.cle !== undefined).length} aperçu(s)`)

console.log(echecs === 0 ? '\nclient : tout est vert' : `\nclient : ${echecs} échec(s)`)
// La sonde de l'hôte est un setInterval : on rend les effets avant de sortir,
// sinon Node ne rend jamais la main.
for (const arret of arrets) { try { arret() } catch { /* un effet déjà tombé */ } }
process.exit(echecs === 0 ? 0 : 1)