// ═══════════════════════════════════════════════════════════════════════════
// Tests de kybernos-modeleur — moitié CLIENT, hors navigateur.
//
// Le bundle est écrit dans le format du chargeur DSH (`window.__ModuleLoader__`)
// ET dans un navigateur : on fournit donc un faux chargeur, un faux `document`
// (canevas enregistreur) et un faux React à crochets inertes, puis :
//   1. on vérifie le CÂBLAGE : type d'onglet et corps de panneau ;
//   2. on vérifie le MOTEUR 3D : chaque op produit des facettes, bornes,
//      tri du peintre (loin → près), ombrage en nuances de la couleur ;
//   3. on vérifie le MOTEUR 2D : ops normalisées, style par défaut, bornes,
//      commandes réellement émises sur le contexte ;
//   4. on vérifie l'EXÉCUTEUR : une op inconnue est ignorée sans casser ;
//   5. on rend le panneau une fois (crochets inertes) pour lire son chrome.
//
// Usage : node kybernos-modeleur/test-client.mjs
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs'

let echecs = 0
const ok = (label, condition, detail) => {
  if (condition) console.log(`✓ ${label}${detail === undefined ? '' : ` (${detail})`}`)
  else { console.error(`✗ ${label}${detail === undefined ? '' : ` — ${detail}`}`); echecs += 1 }
}

// ── faux navigateur ─────────────────────────────────────────────────────────
const appels = { fill: 0, stroke: 0, moveTo: 0, lineTo: 0, arc: 0, fillText: 0, styles: [] }
function fauxContexte () {
  const ctx = {
    setTransform: () => {}, save: () => {}, restore: () => {},
    clearRect: () => {}, beginPath: () => {}, closePath: () => {},
    moveTo: () => { appels.moveTo += 1 }, lineTo: () => { appels.lineTo += 1 },
    arc: () => { appels.arc += 1 }, ellipse: () => {},
    quadraticCurveTo: () => {}, bezierCurveTo: () => {},
    rect: () => {}, roundRect: () => {}, setLineDash: () => {},
    fill: () => { appels.fill += 1 }, stroke: () => { appels.stroke += 1 },
    fillText: () => { appels.fillText += 1 },
    set fillStyle (v) { appels.styles.push(v); this._f = v }, get fillStyle () { return this._f },
    set strokeStyle (v) { this._s = v }, get strokeStyle () { return this._s },
    set lineWidth (v) {}, set font (v) {}, set textAlign (v) {}, set textBaseline (v) {},
  }
  return ctx
}
const faussCanvas = () => ({ width: 0, height: 0, clientWidth: 340, clientHeight: 260, style: {}, getContext: () => fauxContexte(), addEventListener: () => {}, removeEventListener: () => {} })

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

// Faux React : `createElement` construit un arbre lisible, les crochets sont inertes.
const React = {
  createElement: (type, props, ...enfants) => ({ type, props: props || {}, enfants: enfants.flat(Infinity).filter((e) => e !== null && e !== undefined && e !== false) }),
  Fragment: 'Fragment',
  useReducer: (_r, init) => [init, () => {}],
  useRef: (v) => ({ current: v === undefined ? null : v }),
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
  useEffect: () => {},
}

// ── chargement ──────────────────────────────────────────────────────────────
const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
// eslint-disable-next-line no-new-func
new Function('window', 'document', 'React', source)(globalThis.window, globalThis.document, React)

ok('le bundle se charge dans le format du ModuleLoader', typeof definition === 'object' && definition !== null)
ok('identifiant du module', definition.id === '@local/kybernos-modeleur/client', definition.id)
const plugin = definition.factory((nom) => { if (nom === 'react') return React; throw new Error('require inattendu : ' + nom) })
ok('le plugin déclare `slots` en inject', Array.isArray(plugin.inject) && plugin.inject.includes('slots'))
ok('le plugin attend `sidebarRightTabs` avant de s\'appliquer',
  Array.isArray(plugin.inject) && plugin.inject.includes('sidebarRightTabs'))

const T = plugin.__test
ok('la surface de test expose les deux moteurs',
  typeof T.normaliser2D === 'function' && typeof T.normaliser3D === 'function' && typeof T.construire === 'function')

// ── câblage : apply sur un contexte factice ─────────────────────────────────
const effets = []
const slotsInj = []
const contexte = {
  get (nom) {
    if (nom === 'sidebarRight') return { openTab: () => {} }
    if (nom === 'sidebarRightTabs') return { register: (r) => { slotsInj.push(r) } }
    if (nom === 'uiSession') throw new Error('absent')
    return undefined
  },
  effect (f, nom) { effets.push(nom); const d = f(); return typeof d === 'function' ? d : () => {} },
  slots: {
    inject: (slot, fabrique) => { slotsInj.push({ slot, fabrique: fabrique() }) },
    // `slots.register(def, composant)` rend le composant, comme le vrai slot.
    register: (def, composant) => composant,
  },
}
plugin.apply(contexte)
ok('le panneau pose ses effets (styles, onglet, corps, sonde)',
  effets.filter((n) => String(n).startsWith('kybernos-modeleur')).length >= 4, JSON.stringify(effets))
ok('le type d\'onglet s\'enregistre comme « Modeleur »', slotsInj.some((r) => r && r.title && r.title() === 'Modeleur'))
ok('le corps de panneau vise le slot de la barre latérale droite',
  slotsInj.some((r) => r && r.slot === 'sidebar.right.pane.tab'))

// ── moteur 3D ───────────────────────────────────────────────────────────────
const boite = T.normaliser3D([{ op: 'box', x: 0, y: 0, z: 0, w: 4, d: 4, h: 3, color: '#C4291C' }])
ok('une boîte produit 5 facettes (fond omis)', boite.length === 1 && boite[0].facets.length === 5, String(boite[0].facets.length))
const b3 = T.bornes3D(boite)
ok('les bornes 3D enveloppent la boîte', b3.x1 === 4 && b3.y1 === 4 && b3.z1 === 3, JSON.stringify(b3))

const cyl = T.normaliser3D([{ op: 'cyl', cx: 0, cy: 0, z: 0, r: 3, r2: 2, h: 8, n: 12 }])
ok('un cylindre à 12 pans produit 13 facettes (12 côtés + dessus)',
  cyl.length === 1 && cyl[0].facets.length === 13, String(cyl[0].facets.length))
const cone = T.normaliser3D([{ op: 'cone', cx: 0, cy: 0, z: 0, r: 3, h: 4, n: 12 }])
ok('un cône n\'ajoute pas de dessus (r2 = 0)', cone[0].facets.length === 12, String(cone[0].facets.length))
const coneRot = T.normaliser3D([{ op: 'cone', cx: 0, cy: 0, z: 0, r: 3, h: 4, n: 4, rot: 45 }])
const premier = coneRot[0].facets[0].pts[0]
ok('rot:45 tourne le départ des pans vers la diagonale',
  Math.abs(premier[0] - 3 * Math.SQRT1_2) < 1e-9 && Math.abs(premier[1] - 3 * Math.SQRT1_2) < 1e-9,
  `(${premier[0].toFixed(3)}, ${premier[1].toFixed(3)})`)
const sph = T.normaliser3D([{ op: 'sphere', cx: 0, cy: 0, cz: 3, r: 3, n: 12, m: 8 }])
ok('une sphère produit ses bandes', sph[0].facets.length === 12 * 8, String(sph[0].facets.length))
const tube = T.normaliser3D([{ op: 'tube', cx: 0, cy: 0, z: 0, r: 4, t: 1, h: 3, n: 10 }])
ok('un tube produit murs extérieurs + intérieurs + couronne',
  tube[0].facets.length === 10 * 3, String(tube[0].facets.length))
const prisme = T.normaliser3D([{ op: 'extrude', points: [[0, 0], [4, 0], [4, 3], [0, 3]], z: 0, h: 2 }])
ok('un extrude produit dessus + côtés', prisme[0].facets.length === 5, String(prisme[0].facets.length))

// rendu : tri du peintre + nuances de la couleur de base
appels.fill = 0; appels.styles.length = 0
const ctx3 = fauxContexte()
T.dessiner3D(ctx3, 340, 260, T.normaliser3D([
  { op: 'box', x: 0, y: 0, z: 0, w: 4, d: 4, h: 3, color: '#C4291C' },
  { op: 'box', x: 10, y: 10, z: 0, w: 4, d: 4, h: 3, color: '#C4291C' },
]), T.makeCam(), {})
ok('le rendu 3D remplit les facettes', appels.fill === 10, String(appels.fill))
ok('l\'ombrage reste dans la famille de la couleur (canal R dominant)',
  appels.styles.every((c) => !c.startsWith('#') || parseInt(c.slice(1, 3), 16) >= parseInt(c.slice(3, 5), 16)))

// annotations typées : trait → perfect-freehand (contour rempli),
// rect/ellipse/flèche → rough.js (traits), texte → fillText, dégénérés sautés
const recPen = { couleurs: [], fills: 0, strokes: 0, fillTexts: [], moveTo: [], lineTo: [] }
const ctxPen = {
  save: () => {}, restore: () => {},
  beginPath: () => {}, closePath: () => {},
  moveTo: (x, y) => recPen.moveTo.push([x, y]),
  lineTo: (x, y) => recPen.lineTo.push([x, y]),
  bezierCurveTo: () => {}, quadraticCurveTo: () => {},
  translate: () => {}, rotate: () => {}, setLineDash: () => {},
  arc: () => {}, ellipse: () => {},
  fill: () => { recPen.fills += 1 },
  stroke: () => { recPen.strokes += 1 },
  fillText: (t, x, y) => recPen.fillTexts.push([t, x, y]),
  set strokeStyle (v) { recPen.couleurs.push(v) },
  set fillStyle (v) { recPen.couleurs.push(v) },
  set lineWidth (v) {}, set lineCap (v) {}, set lineJoin (v) {},
  set globalAlpha (v) {}, set font (v) {}, set textBaseline (v) {},
}
ctxPen.canvas = { getContext: () => ctxPen }

const anns = [
  { type: 'trait', coul: '#E1502A', pts: [[0.1, 0.2], [0.5, 0.5], [0.9, 0.2]] },
  { coul: '#E1502A', pts: [[0.1, 0.8], [0.3, 0.85], [0.5, 0.8]] }, // sans type → trait
  { type: 'rect', coul: '#2A6FD6', pts: [[0.1, 0.1], [0.4, 0.4]] },
  { type: 'fleche', coul: '#2A6FD6', pts: [[0.7, 0.7], [0.7, 0.3]] },
  { type: 'texte', coul: '#F2C31A', pts: [[0.5, 0.5]], text: 'plus grand' },
  { type: 'ellipse', coul: '#2A6FD6', pts: [[0.2, 0.6], [0.5, 0.8]] },
  { type: 'texte', coul: '#F2C31A', pts: [[0.5, 0.5]], text: '' },
  { type: 'fleche', coul: '#2A6FD6', pts: [[0.1, 0.1]] },
]
T.tracerAnnotations(ctxPen, 400, 300, anns)
ok('tracerAnnotations rend les 5 annotations valides et saute les dégénérés',
  recPen.fills === 2 && recPen.strokes >= 5 && recPen.fillTexts.length === 1,
  `fills=${recPen.fills} strokes=${recPen.strokes} fillTexts=${recPen.fillTexts.length}`)
ok('tracerAnnotations place le texte en pixels : (0.5, 0.5) → (200, 150)',
  recPen.fillTexts.length === 1 && recPen.fillTexts[0][0] === 'plus grand'
  && recPen.fillTexts[0][1] === 200 && recPen.fillTexts[0][2] === 150)
ok('la graine rough.js est stable et sensible aux points',
  T.graineDe({ type: 'rect', pts: [[0.1, 0.1], [0.4, 0.4]] }) === T.graineDe({ type: 'rect', pts: [[0.1, 0.1], [0.4, 0.4]] })
  && T.graineDe({ type: 'rect', pts: [[0.1, 0.1], [0.4, 0.4]] }) !== T.graineDe({ type: 'rect', pts: [[0.2, 0.1], [0.4, 0.4]] }))

// tri du peintre : en vue rasante, un PLAFOND interne (horizontal sous le
// point culminant) se dessine AVANT une verticale plus lointaine ; le sommet
// du modèle n'est pas pénalisé ; en vue Top, ordre normal.
const plafond = { proj: [], prof: -5, color: '#FFFFFF', n: [0, 0, 1], zmax: 0 }
const facetteVerticale = { proj: [], prof: 5, color: '#000000', n: [0, 1, 0], zmax: 10 }
const sommet = { proj: [], prof: -5, color: '#888888', n: [0, 0, 1], zmax: 10 }
const rasante = T.ordonnerFacettes([plafond, facetteVerticale], 0.47, 10)
const plongee = T.ordonnerFacettes([plafond, facetteVerticale], 1.47, 10)
const auSommet = T.ordonnerFacettes([sommet, facetteVerticale], 0.47, 10)
ok('vue rasante : le plafond couvert passe au fond de l\'ordre (dessiné d\'abord)', rasante[0] === plafond)
ok('vue rasante : le sommet du modèle n\'est pas pénalisé', auSommet[0] === facetteVerticale)
ok('vue Top : tri normal par profondeur', plongee[0] === facetteVerticale)

// ── moteur 2D ───────────────────────────────────────────────────────────────
const ops2d = T.normaliser2D([
  { op: 'rect', x: 10, y: 10, w: 40, h: 20 },
  { op: 'circle', cx: 30, cy: 20, r: 8 },
  { op: 'circle', cx: 60, cy: 20, r: 5, stroke: '#C4291C' },
  { op: 'text', x: 12, y: 50, text: 'coupe' },
  { op: 'inconnu', x: 1 },
  { op: 'poly', points: [[0, 0], [5]] },
])
ok('les ops 2D inconnues ou invalides sont ignorées', ops2d.length === 5, String(ops2d.length))
ok('le style 2D par défaut d\'un cercle est bleu', ops2d[1].style.stroke === '#2A6FD6', ops2d[1].style.stroke)
ok('un stroke explicite gagne', ops2d[2].style.stroke === '#C4291C', ops2d[2].style.stroke)
const b2 = T.bornes2D(ops2d)
ok('les bornes 2D enveloppent le dessin (texte compris)', b2.x1 >= 50 && b2.y1 >= 51, JSON.stringify(b2))

const chemin = T.normaliser2D([{ op: 'path', d: 'M10 10 L20 10 Q25 15 20 20 Z' }])
ok('le parseur de chemin lit M L Q Z', chemin.length === 1 && chemin[0].cmds.length === 4, JSON.stringify(chemin[0]?.cmds?.map((c) => c.t)))
ok('Z ferme le tracé', chemin[0].cmds[3].t === 'Z')
const relatif = T.parserChemin('m10 10 l10 0 h-4 v6')
ok('le parseur lit les relatifs et les horizontales/verticales', relatif.length === 4, JSON.stringify(relatif.map((c) => c.t)))

appels.moveTo = 0; appels.lineTo = 0; appels.fill = 0; appels.stroke = 0; appels.fillText = 0; appels.arc = 0
const ctx2 = fauxContexte()
const tr = { W: 340, H: 260, k: 2, cadre: T.bornes2D(ops2d), kx: (x) => x * 2, ky: (y) => 260 - y * 2 }
T.dessiner2D(ctx2, ops2d, ops2d.length, tr, { grille: true })
ok('le rendu 2D trace des segments', appels.moveTo > 0 && appels.lineTo > 0, `${appels.moveTo}/${appels.lineTo}`)
ok('le rendu 2D remplit et traitte les formes', appels.fill >= 2 && appels.stroke >= 2, `${appels.fill}/${appels.stroke}`)
ok('le rendu 2D écrit le texte', appels.fillText === 1, String(appels.fillText))
ok('le rendu 2D dessine les cercles', appels.arc >= 1, String(appels.arc))

// pose partielle : révéler 1 op sur 3 ne dessine pas le texte
appels.fillText = 0
T.dessiner2D(fauxContexte(), ops2d, 1, tr, { grille: false })
ok('la pose partielle ne révèle pas les ops suivants', appels.fillText === 0, String(appels.fillText))

// ── exécuteur + démos ───────────────────────────────────────────────────────
const modele3d = T.construire({ espace: '3d', ops: T.DEMOS.phare.ops })
ok('la démo phare se construit en 3D', modele3d.espace === '3d' && modele3d.lots === T.DEMOS.phare.ops.length, `${modele3d.lots} lots`)
ok('la démo phare porte ses groupes nommés', modele3d.objets.every((o) => typeof o.group === 'string'))
const modele2d = T.construire({ espace: '2d', ops: T.DEMOS.schema.ops })
ok('la démo schéma se construit en 2D', modele2d.espace === '2d' && modele2d.lots === T.DEMOS.schema.ops.length, `${modele2d.lots} lots`)
for (const cle of Object.keys(T.DEMOS)) {
  const m = T.construire({ espace: T.DEMOS[cle].espace, ops: T.DEMOS[cle].ops })
  ok(`la démo « ${cle} » ne perd aucun lot`, m.lots === T.DEMOS[cle].ops.length, `${m.lots}/${T.DEMOS[cle].ops.length}`)
}

// ── chrome du panneau ───────────────────────────────────────────────────────
const composant = slotsInj.find((r) => r && r.slot === 'sidebar.right.pane.tab').fabrique
const arbre = composant({})
const texte = JSON.stringify(arbre)
ok('le chrome porte le titre et le badge d\'espace', texte.includes('Modeleur') && texte.includes('3D'))
// Le faux React n'instantie pas les composants enfants : les démos se lisent
// dans les props (`cle`) transmises à chaque puce.
ok('l\'état vide propose les trois démos',
  texte.includes('"cle":"phare"') && texte.includes('"cle":"maison"') && texte.includes('"cle":"schema"'))
ok('le transport est là (lecture, vitesses)', texte.includes('0.5×') && texte.includes('4×'))

console.log(echecs === 0 ? '\nclient : tout est vert' : `\nclient : ${echecs} échec(s)`)
// La sonde de l'hôte (setInterval) garde sinon le processus vivant pour rien.
process.exit(echecs === 0 ? 0 : 1)
