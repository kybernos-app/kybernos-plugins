// ═══════════════════════════════════════════════════════════════════════════
// Tests de kybernos-slides — moitié CLIENT, hors navigateur.
//
// Le bundle est écrit dans le format du chargeur DSH (`window.__ModuleLoader__`)
// ET dans un navigateur : on fournit donc un faux chargeur, un faux `document`
// (canevas enregistreur) et un faux React à crochets inertes, puis :
//   1. on vérifie le CÂBLAGE : type d'onglet et corps de panneau ;
//   2. le MOTEUR DE FRAPPE : poids, budget par slide, segments ordonnés,
//      frappe progressive (texte tronqué, jamais dépassé) ;
//   3. le DIFF : passages modifiés détectés, sans faux positifs ;
//   4. les OUTILS : hit-test de gomme, tracé des traits, annotations rejouées ;
//   5. on rend le panneau une fois (crochets inertes) pour lire son chrome.
//
// Usage : node kybernos-slides/test-client.mjs
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs'

let echecs = 0
const ok = (label, condition, detail) => {
  if (condition) console.log(`✓ ${label}${detail === undefined ? '' : ` (${detail})`}`)
  else { console.error(`✗ ${label}${detail === undefined ? '' : ` — ${detail}`}`); echecs += 1 }
}

// ── faux navigateur ─────────────────────────────────────────────────────────
const appels = { fill: 0, stroke: 0, moveTo: 0, lineTo: 0, quad: 0 }
function fauxContexte () {
  return {
    setTransform: () => {}, save: () => {}, restore: () => {},
    clearRect: () => {}, beginPath: () => {}, closePath: () => {},
    moveTo: () => { appels.moveTo += 1 }, lineTo: () => { appels.lineTo += 1 },
    quadraticCurveTo: () => { appels.quad += 1 },
    stroke: () => { appels.stroke += 1 }, fill: () => { appels.fill += 1 },
    fillText: () => {}, setLineDash: () => {},
    set fillStyle (v) {}, set strokeStyle (v) {}, set lineWidth (v) {},
    set lineCap (v) {}, set lineJoin (v) {},
    set font (v) {}, set textAlign (v) {}, set textBaseline (v) {},
  }
}
const fauxCanvas = () => ({
  width: 0, height: 0, style: {},
  getContext: () => fauxContexte(),
  addEventListener: () => {}, removeEventListener: () => {},
  setPointerCapture: () => {},
})

let definition = null
globalThis.window = {
  __ModuleLoader__: { load: (d) => { definition = d } },
  devicePixelRatio: 1,
  addEventListener: () => {},
}
globalThis.document = {
  createElement: (tag) => (tag === 'canvas' ? fauxCanvas() : { style: {}, appendChild: () => {}, set textContent (v) {}, id: '', firstChild: null, removeChild: () => {} }),
  getElementById: () => null,
  documentElement: { style: {} },
  body: { appendChild: () => {}, removeChild: () => {} },
  head: { appendChild: () => {} },
}
try { Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'test' }, configurable: true }) } catch { /* déjà défini */ }
globalThis.requestAnimationFrame = () => 1
globalThis.cancelAnimationFrame = () => {}
globalThis.fetch = async () => ({ ok: true, json: async () => ({ vide: true }) })
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
ok('identifiant du module', definition.id === '@local/kybernos-slides/client', definition.id)
const plugin = definition.factory((nom) => { if (nom === 'react') return React; throw new Error('require inattendu : ' + nom) })
ok('le plugin déclare `slots` et `sidebarRightTabs` en inject',
  Array.isArray(plugin.inject) && plugin.inject.includes('slots') && plugin.inject.includes('sidebarRightTabs'))
ok('le plugin expose une surface de test', plugin.__test !== undefined && typeof plugin.__test.budget === 'function')

const T = plugin.__test

// ── 1. normalisation ────────────────────────────────────────────────────────
const deck = T.normaliserDeck([
  { layout: 'titre', kicker: 'K', titre: 'Rain is a given.', sous: 'un sous-titre' },
  { layout: 'puces', titre: 'Trois gestes', points: ['Le chat écrit.', 'Tu modifies.', 'Il corrige.'], note: 'note orateur' },
  { layout: 'chiffre', grand: '12 s', legende: 'pour un deck' },
  null, 'pas une slide', { layout: 'citation', citation: '« test »', auteur: 'A. Mustre' },
])
ok('les slides sont normalisées, les déchets écartés', deck.length === 4, String(deck.length))
ok('les champs manquants valent chaîne vide', deck[0].points.length === 0 && deck[0].note === '')
ok('la normalisation borne le deck à 60', T.normaliserDeck(Array.from({ length: 80 }, () => ({ titre: 'x' }))).length === 60)

// ── 2. moteur de frappe ─────────────────────────────────────────────────────
const iv = T.budget(deck)
ok('un intervalle par slide', iv.length === deck.length)
ok('les intervalles partent de 0', Math.abs(iv[0].start) < 1e-9)
ok('les intervalles sont contigus', iv.every((x, i) => i === 0 || Math.abs(x.start - (iv[i - 1].start + iv[i - 1].weight)) < 1e-9))
ok('le dernier intervalle finit à 1', Math.abs(iv[3].start + iv[3].weight - 1) < 1e-9)
ok('une slide vide garde un poids plancher', T.poidsSlide(T.normaliserDeck([{}])[0]) >= 50)

ok('slideActive trouve la première slide au tout début', T.slideActive(iv, 0) === 0)
ok('slideActive trouve la dernière slide à 1', T.slideActive(iv, 1) === 3)
const milieu2 = iv[2].start + iv[2].weight / 2
ok('slideActive trouve la slide du milieu', T.slideActive(iv, milieu2) === 2)

const segsPuces = T.segments(deck[1])
ok('les segments suivent l\'ordre de lecture (kicker→titre→sous→points→note)',
  segsPuces[0].champ === 'titre' && segsPuces[1].champ === 'points' && segsPuces[segsPuces.length - 1].champ === 'note',
  JSON.stringify(segsPuces.map((s) => s.champ)))
ok('un segment par puce', segsPuces.filter((s) => s.champ === 'points').length === 3)
const segsCita = T.segments(deck[3])
ok('la citation passe avant l\'auteur', segsCita[0].champ === 'citation' && segsCita[1].champ === 'auteur')

const segTitre = T.segments(deck[0]).find((s) => s.champ === 'titre')
const src = segTitre.source
ok('à q=0 rien n\'est tapé', T.texteVisible(segTitre, 0) === '')
ok('à q=1 tout est tapé', T.texteVisible(segTitre, 1) === src)
const moitie = T.texteVisible(segTitre, 0.5)
ok('à q=0.5 la frappe est tronquée', moitie.length > 0 && moitie.length < src.length && src.startsWith(moitie),
  `${moitie.length}/${src.length}`)

// ── 3. diff de correction ───────────────────────────────────────────────────
const avant = T.normaliserDeck([
  { layout: 'puces', titre: 'Trois gestes', points: ['Le chat écrit.', 'Tu modifies.', 'Il corrige.'] },
  { layout: 'titre', titre: 'Rain is a given.' },
])
const apres = T.normaliserDeck([
  { layout: 'puces', titre: 'Les trois gestes', points: ['Le chat écrit.', 'Tu modifies en live.', 'Il corrige.', 'Nouvelle puce.'] },
  { layout: 'titre', titre: 'Rain is a given.' },
])
const diff = T.diffSlides(avant, apres)
ok('le titre modifié est détecté', diff.some((d) => d.slide === 0 && d.champ === 'titre' && d.apres === 'Les trois gestes'))
ok('la puce modifiée est détectée avec son index', diff.some((d) => d.slide === 0 && d.champ === 'points' && d.idx === 1 && d.apres === 'Tu modifies en live.'))
ok('la puce ajoutée est détectée (avant vide)', diff.some((d) => d.slide === 0 && d.champ === 'points' && d.idx === 3 && d.avant === ''))
ok('les passages identiques ne sont pas signalés', !diff.some((d) => d.slide === 1))
ok('aucun faux positif sur un deck identique', T.diffSlides(avant, avant).length === 0)

// ── 4. outils utilisateur ───────────────────────────────────────────────────
const traits = [
  { points: [[0, 0], [100, 0]], color: '#F2C31A', width: 5 },
  { points: [[500, 500], [520, 540], [560, 500]], color: '#E1502A', width: 5 },
]
ok('la gomme touche le trait le plus récent d\'abord', T.hitStroke(traits, 510, 510, 20) === 1)
ok('la gomme touche le premier trait', T.hitStroke(traits, 50, 5, 20) === 0)
ok('la gomme rate hors trait', T.hitStroke(traits, 300, 300, 10) === -1)

appels.stroke = 0; appels.moveTo = 0; appels.quad = 0
T.dessinerTraits(fauxContexte(), traits)
ok('chaque trait est tracé', appels.stroke === 2 && appels.moveTo === 2, `stroke=${appels.stroke}`)
ok('le tracé lisse utilise des quadratiques', appels.quad >= 1, String(appels.quad))

const S = {
  deck: null,
  ann: { version: 0, edits: [], strokes: [] },
  overrides: new Map(), traits: new Map(),
}
T.appliquerAnnotations(S, {
  version: 3,
  edits: [{ slide: 0, champ: 'titre', idx: -1, apres: 'retouché' }, { slide: 0, champ: 'titre', idx: -1, apres: 'retouché deux fois' }],
  strokes: [{ slide: 1, points: [[1, 1], [2, 2]], color: '#fff', width: 3 }],
})
ok('la dernière édition gagne', S.overrides.get(T.cleChamp(0, 'titre', -1)) === 'retouché deux fois')
ok('les traits sont regroupés par slide', S.traits.get(1).length === 1 && !S.traits.has(0))
ok('la version des annotations est mémorisée', S.ann.version === 3)
// Retouche COULEUR : l'override dédié est posé (remplacement complet des
// annotations — traits vides, d'où la position après les assertions de traits).
T.appliquerAnnotations(S, {
  version: 4,
  edits: [{ slide: 1, champ: 'titre', idx: -1, avant: 'x', apres: 'x', couleur: '#37B5C4' }],
  strokes: [],
})
ok('la retouche couleur pose l\'override dédié',
  S.overrides.get(T.cleChamp(1, 'titre', -1) + ':couleur') === '#37B5C4')

// ── 5. le chrome du panneau ─────────────────────────────────────────────────
const arbre = pluginPantheon()
function pluginPantheon () {
  // Le `apply` du plugin a besoin d'un ctx ; on ne teste ici que le RENDU du
  // composant : appeler la fabrique du panneau via le slot n'est pas possible
  // hors DSH, donc on reconstruit l'appel tel que `ctx.slots.register` le fait.
  return null
}
ok('la démo embarque un deck complet', Array.isArray(T.DEMOS) && T.DEMOS[0].slides.length >= 4
  && T.DEMOS[0].slides.some((s) => s.layout === 'statement'))
ok('les quatre thèmes sont définis', ['sombre', 'clair', 'corail', 'papier'].every((t) => T.THEMES[t] !== undefined))
ok('progression sans deck vaut 1', T.progression({ deck: null }) === 1)
ok('progression avec deck reste bornée',
  T.progression({ deck: { t0: Date.now() - 999_999, dureeMs: 10 } }) === 1
  && T.progression({ deck: { t0: Date.now(), dureeMs: 10_000 } }) === 0)

// Rendu réel du composant panneau (crochets inertes) : le composant est
// enregistré via ctx.slots.register ; on l'attrape par un faux ctx.
let composant = null
let panneau = null
const fauxCtx = {
  effect: (f) => f(),
  get: () => null,
  inject: () => {},
  slots: {
    inject: (_slot, fabrique) => { composant = fabrique },
    register: (_desc, comp) => { panneau = comp; return comp },
  },
}
plugin.apply(fauxCtx)
ok('apply enregistre la fabrique du panneau', typeof composant === 'function')
composant() // la fabrique appelle ctx.slots.register, qui révèle le composant
ok('la fabrique révèle le composant du panneau', typeof panneau === 'function')
const rendu = panneau()
ok('le panneau rend une racine', rendu !== null && rendu.type === 'div')
const classes = (noeud, acc = []) => {
  if (noeud === null || typeof noeud !== 'object') return acc
  if (noeud.props && noeud.props.className) acc.push(noeud.props.className)
  for (const e of (noeud.enfants || [])) classes(e, acc)
  return acc
}
const toutes = classes(rendu)
ok('l\'état vide montre le guide et la démo', toutes.some((c) => c.includes('kbs-empty')) && toutes.some((c) => c.includes('kbs-demo')))
ok('le chrome de lecture est présent (vignettes, barre, note)',
  toutes.some((c) => c === 'kbs-vignettes') && toutes.some((c) => c === 'kbs-bar') && toutes.some((c) => c === 'kbs-note-bas'))
ok('le titre d\'en-tête est rendu', JSON.stringify(rendu).includes('Slides'))

console.log(echecs === 0 ? '\nClient : tout est vert.' : `\nClient : ${echecs} échec(s).`)
process.exit(echecs === 0 ? 0 : 1)
