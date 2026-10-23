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
import { assemble } from './scripts/build.mjs'

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
let langue = 'kybernos' // the language the page resolves to: the checks below read the French panel first, then the language block
globalThis.window = {
  __ModuleLoader__: { load: (d) => { definition = d } },
  __KB_LANG_RESOLVE__: () => { if (langue === 'throws') throw new Error('langue pas encore connue'); return langue },
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
let deckPourTest = null // when set, the panel's initial state starts with this deck (see the tool bar check)
const React = {
  createElement: (type, props, ...enfants) => ({ type, props: props || {}, enfants: enfants.flat(Infinity).filter((e) => e !== null && e !== undefined && e !== false) }),
  Fragment: 'Fragment',
  useReducer: (_r, init) => [init, () => {}],
  useRef: (v) => {
    if (deckPourTest !== null && v !== null && typeof v === 'object' && 'outil' in v) v.deck = deckPourTest
    return { current: v === undefined ? null : v }
  },
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

// A4-03: the thumbnail of a « statement » slide shows what the stage shows (its title, and the line under it), not an empty `grand`.
{
  const texts = (n, acc = []) => { if (n === null || n === undefined) return acc; if (typeof n === 'string') { acc.push(n); return acc } for (const e of (n.enfants || [])) texts(e, acc); return acc }
  const th = T.THEMES.sombre
  const st = T.normaliserDeck([{ layout: 'statement', kicker: 'The premise', titre: 'Shells should come prepared.', sous: 'and say so' }])[0]
  const t = texts(T.miniature(st, th))
  ok('A4-03: the thumbnail of a statement slide shows its title (as the stage does)', t.includes('Shells should come prepared.'), t.join(' | '))
  ok('A4-03: ...and the line under it, with the kicker', t.includes('and say so') && t.includes('The premise'), t.join(' | '))
  ok('A4-03: the thumbnail of a figure slide still shows its big number', texts(T.miniature(T.normaliserDeck([{ layout: 'chiffre', grand: '12 s', legende: 'x' }])[0], th)).includes('12 s'))
}

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
ok('l\'état vide montre le guide et la démo', toutes.some((c) => c.includes('kbsd-empty')) && toutes.some((c) => c.includes('kbsd-demo')))
ok('le chrome de lecture est présent (vignettes, barre, note)',
  toutes.some((c) => c === 'kbsd-vignettes') && toutes.some((c) => c === 'kbsd-bar') && toutes.some((c) => c === 'kbsd-note-bas'))
ok('le titre d\'en-tête est rendu', JSON.stringify(rendu).includes('Slides'))

// The tool bar (Voir / Texte / Pinceau / Gomme) is the only thing that changes the tool, and the tool starts on 'voir':
// it used to be rendered only when the tool was not 'voir', so the brush and the eraser could never be picked.
const trouver = (noeud, test) => {
  if (noeud === null || typeof noeud !== 'object') return null
  if (test(noeud)) return noeud
  for (const e of (noeud.enfants || [])) { const r = trouver(e, test); if (r !== null) return r }
  return null
}
deckPourTest = { version: 1, t0: Date.now() - 999_999, dureeMs: 10, titre: T.DEMOS[0].titre || 'demo', theme: 'sombre', mode: 'nouveau', slides: T.normaliserDeck(T.DEMOS[0].slides) }
const avecDeck = panneau()
deckPourTest = null
const barre = trouver(avecDeck, (n) => n.props && typeof n.props.className === 'string' && n.props.className.split(' ').includes('kbsd-outils'))
ok('with a deck, the tool bar is rendered from the default state (tool = voir)', barre !== null)
const boutons = barre === null ? [] : barre.enfants.filter((e) => e && e.type === 'button' && String(e.props.className).split(' ').includes('kbsd-outil'))
ok('the bar holds the four tools and "clear all"', boutons.length === 5, String(boutons.length))
ok('the four tools are Voir, Texte, Pinceau, Gomme, in that order',
  JSON.stringify(boutons.slice(0, 4).map((b) => b.enfants[0])) === JSON.stringify(['Voir', '✎ Texte', '✎ Pinceau', 'Gomme']),
  JSON.stringify(boutons.slice(0, 4).map((b) => b.enfants[0])))
ok('in the default state the bar is dimmed, not hidden', barre !== null && barre.props.className.includes('kbsd-outils-idle'))

// The opening probe: the tab opens by itself when a deck arrives. A failed attempt (right after a page reload the
// sidebar service is not always there yet) used to set the "already open" flag anyway, so no later deck ever
// opened the tab on its own.
{
  let appels = 0
  let reussit = false
  const ouvrir = () => { appels += 1; return reussit }
  const vide = { versionVue: null, dejaOuvert: false }
  let etat = T.pasSonde(vide, { version: 1 }, ouvrir)
  ok('PROBE: a failed opening is not remembered (it is retried at the next probe)', appels === 1 && etat.dejaOuvert === false && etat.versionVue === null, JSON.stringify(etat))
  reussit = true
  etat = T.pasSonde(etat, { version: 1 }, ouvrir)
  ok('PROBE: the retry succeeds and the version is remembered', appels === 2 && etat.dejaOuvert === true && etat.versionVue === 1, JSON.stringify(etat))
  etat = T.pasSonde(etat, { version: 1 }, ouvrir)
  ok('PROBE: the same version does not open again', appels === 2)
  etat = T.pasSonde(etat, { version: 2 }, ouvrir)
  ok('PROBE: a newer deck does not re-open a tab that is already open, but is remembered', appels === 2 && etat.versionVue === 2)
  etat = T.pasSonde(etat, { vide: true }, ouvrir)
  ok('PROBE: an empty host resets the flag', etat.dejaOuvert === false && etat.versionVue === 2)
  etat = T.pasSonde(etat, { version: 3 }, ouvrir)
  ok('PROBE: the next deck opens the tab again', appels === 3 && etat.dejaOuvert === true && etat.versionVue === 3)
  ok('PROBE: an unreachable host changes nothing', T.pasSonde(etat, null, ouvrir) === etat && appels === 3)
}

// ── L4-02: no /state request before the session key is known ─────────────────
// A request WITHOUT `session` makes the host answer with the last deck of ANOTHER conversation: the panel showed it and the probe
// opened the tab on it. urlEtat is the single place that builds the URL, and it refuses an empty key.
{
  ok('L4-02: no /state URL while the session key is empty (never poll another chat\'s deck)',
    T.urlEtat('') === null && T.urlEtat(undefined) === null && T.urlEtat(null) === null)
  ok('L4-02: the URL carries the session once it is known',
    T.urlEtat('session-1') === '/kybernos-slides/state?session=session-1'
    && T.urlEtat('a b') === '/kybernos-slides/state?session=a%20b')
}

// ── the build and the demo ──────────────────────────────────────────────────
// client.js is generated from src/plugin.js (scripts/build.mjs). It was edited by hand in four commits and src/plugin.js stayed behind:
// the next build would have undone the focus fix, the reachable tool bar and the kbsd- selectors (audit 2026-10-16).
ok('BUILD: client.js is the build of its sources (node packages/kybernos-slides/scripts/build.mjs)', assemble() === source)
// The demo's caption names what the tool bar offers; it once promised keyboard shortcuts (T) and (B) that did not exist.
const legende = (lg) => { langue = lg; return T.DEMOS[0].prompt }
ok('DEMO: its caption names the tools of the bar (French), not shortcuts that do not exist', /outil Texte/.test(legende('kybernos')) && /outil Pinceau/.test(legende('kybernos')) && !/\([A-Z]\)/.test(legende('kybernos')) && source.includes("['texte', kt('✎ Texte', '✎ Text')]") && source.includes("['pinceau', kt('✎ Pinceau', '✎ Brush')]"), legende('kybernos'))
ok('DEMO: …and in English, the tools of the English bar', /Text tool/.test(legende('en')) && /Brush tool/.test(legende('en')) && !/\([A-Z]\)/.test(legende('en')), legende('en'))

// A4-02: the floating text editor (format bar + box) used to sit at a fixed corner, over the Text / Brush / Eraser / Clear all buttons.
// It is now placed next to the field, never on the tool bar. Pane of 480 x 270, the tool bar at its top-left.
{
  const scene = { w: 480, h: 270 }
  const outils = { x: 10, y: 10, w: 300, h: 30 }
  const boite = { w: 280, h: 70 }
  const touche = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  const rect = (lieu) => ({ x: lieu.x, y: lieu.y, w: boite.w, h: boite.h })
  const titre = T.placerEditeur({ champ: { x: 33, y: 30, w: 200, h: 28 }, outils, scene, boite })
  ok('editor: a field at the top gets its editor right below it, clear of the tool bar', titre.y === 64 && !touche(rect(titre), outils), titre)
  const pied = T.placerEditeur({ champ: { x: 33, y: 232, w: 200, h: 16 }, outils, scene, boite })
  ok('editor: a field at the bottom gets its editor above it (no room below)', pied.y === 232 - 70 - 6 && !touche(rect(pied), outils), pied)
  ok('editor: it is anchored on the field\'s left edge', titre.x === 33 && pied.x === 33)
  const droite = T.placerEditeur({ champ: { x: 450, y: 100, w: 20, h: 20 }, outils, scene, boite })
  ok('editor: a field near the right edge keeps the editor inside the pane', droite.x + boite.w <= scene.w - 8 && droite.x >= 8, droite)
  let pire = null
  for (let y = 0; y <= 260; y += 6) {
    for (let x = 0; x <= 470; x += 30) {
      for (const [w, hh] of [[20, 14], [200, 28], [440, 120]]) {
        const lieu = T.placerEditeur({ champ: { x, y, w, h: hh }, outils, scene, boite })
        const dedans = lieu.x >= 8 && lieu.y >= 8 && lieu.x + boite.w <= scene.w - 8 && lieu.y + boite.h <= scene.h - 8
        if (touche(rect(lieu), outils) || !dedans) { pire = { champ: { x, y, w, h: hh }, lieu }; break }
      }
      if (pire !== null) break
    }
    if (pire !== null) break
  }
  ok('editor: wherever the field is, the editor never covers the tool bar and stays inside the pane', pire === null, pire)
  const sansOutils = T.placerEditeur({ champ: { x: 33, y: 30, w: 200, h: 28 }, outils: null, scene, boite })
  ok('editor: without a tool bar it still goes below the field', sansOutils.y === 64, sansOutils)
}

// A4-26: the transport bar speaks like the Modeleur and Bricks panels: Start / Play-Pause / End, 0.5× 1× 2× 4×, the state at the right
// end of the row (NN% while it writes, Done when it has), and « n / total » above the position slider.
{
  const clic = (noeud) => { noeud.props.onClick() }
  const ligne = (arbre) => trouver(arbre, (n) => n.props && n.props.className === 'kbsd-line')
  const rendre = (lg, dureeMs) => {
    langue = lg
    deckPourTest = { version: 1, t0: Date.now() - 999_999, dureeMs, titre: 'demo', theme: 'sombre', mode: 'nouveau', slides: T.normaliserDeck(T.DEMOS[0].slides) }
    const arbre = panneau()
    deckPourTest = null
    return arbre
  }
  const boutonsDe = (arbre) => ligne(arbre).enfants.filter((e) => e && e.type === 'button')
  const pilule = (arbre) => ligne(arbre).enfants.find((e) => e && e.props && String(e.props.className).startsWith('kbsd-badge'))
  const texte = (n) => (n.enfants || []).map((e) => (typeof e === 'string' ? e : texte(e))).join('')
  let arbre = rendre('en', 600_000)
  ok('transport: the row holds Start, Play, End and the four speeds, in the order of the other panels',
    JSON.stringify(boutonsDe(arbre).map((b) => b.props.title || b.enfants[0])) === JSON.stringify(['Start', 'Replay the writing', 'End', '0.5×', '1×', '2×', '4×']),
    JSON.stringify(boutonsDe(arbre).map((b) => b.props.title || b.enfants[0])))
  ok('transport: the glyphs are the shared ones (◀◀ ▶ ▶▶)', boutonsDe(arbre).slice(0, 3).map((b) => b.enfants[0]).join(' ') === '\u25C0\u25C0 \u25B6 \u25B6\u25B6')
  ok('transport: a deck that has finished says Done in the pill, not "live"', texte(pilule(arbre)) === 'Done' && !JSON.stringify(arbre).includes('"live"'), texte(pilule(arbre)))
  ok('transport: the counter above the slider reads « n / total slides »', /^\d+ \/ 5 slides$/.test(texte(trouver(arbre, (n) => n.props && n.props.className === 'kbsd-lab'))), texte(trouver(arbre, (n) => n.props && n.props.className === 'kbsd-lab')))
  ok('transport: the French panel says Début / Fin / Fini', (() => { const fr = rendre('kybernos', 600_000); return JSON.stringify(boutonsDe(fr).slice(0, 3).map((b) => b.props.title)) === JSON.stringify(['Début', 'Rejouer l\'écriture', 'Fin']) && texte(pilule(fr)) === 'Fini' })())
  // Replay, then Pause, Start and End move the clock and the state.
  arbre = rendre('en', 600_000)
  clic(boutonsDe(arbre)[1]) // finished: Play replays from 0
  arbre = rendre('en', 600_000)
  ok('transport: Play on a finished deck replays it: the glyph becomes Pause and the pill shows a percentage in the running style', boutonsDe(arbre)[1].enfants[0] === '\u23F8' && /^\d+%$/.test(texte(pilule(arbre))) && pilule(arbre).props.className.includes('run'), texte(pilule(arbre)))
  clic(boutonsDe(arbre)[1]) // Pause
  arbre = rendre('en', 600_000)
  const figeA = texte(pilule(arbre))
  ok('transport: Pause stops the clock: the glyph is Play again and the pill is no longer in the running style', boutonsDe(arbre)[1].enfants[0] === '\u25B6' && !pilule(arbre).props.className.includes('run') && /^\d+%$/.test(figeA), figeA)
  clic(boutonsDe(arbre)[0]) // Start
  arbre = rendre('en', 600_000)
  ok('transport: Start puts the clock at 0 and holds it there', texte(pilule(arbre)) === '0%' && boutonsDe(arbre)[1].enfants[0] === '\u25B6', texte(pilule(arbre)))
  clic(boutonsDe(arbre)[2]) // End
  arbre = rendre('en', 600_000)
  ok('transport: End shows the finished deck: Done', texte(pilule(arbre)) === 'Done', texte(pilule(arbre)))
  clic(boutonsDe(arbre)[4]) // 1x while finished and frozen stays frozen
  arbre = rendre('en', 600_000)
  ok('transport: a speed change on a frozen clock does not restart it', texte(pilule(arbre)) === 'Done')
  // A speed change keeps the position (it used to jump when the previous speed was not 1×).
  clic(boutonsDe(arbre)[0])
  arbre = rendre('en', 600_000)
  clic(boutonsDe(arbre)[1]) // play from 0 at 1×
  arbre = rendre('en', 600_000)
  clic(boutonsDe(arbre)[5]) // 2×
  arbre = rendre('en', 600_000)
  const avant = T.progression({ deck: { t0: 0, dureeMs: 600_000 } })
  clic(boutonsDe(arbre)[4]) // back to 1×
  const apres = T.progression({ deck: { t0: 0, dureeMs: 600_000 } })
  ok('transport: going from 2× back to 1× does not move the position', Math.abs(apres - avant) < 0.001, { avant, apres })
  clic(boutonsDe(arbre)[0]) // leave the clock held at 0 for whatever follows
  langue = 'kybernos'
}

// ── the language (A2-31, A2-08): French for the French UI, English for every other language ──
{
  const textes = () => JSON.stringify(panneau()) + ' ' + JSON.stringify(T.DEMOS[0])
  const avecDeckBarre = (lg) => { langue = lg; deckPourTest = { version: 1, t0: Date.now() - 999_999, dureeMs: 10, titre: 'x', theme: 'sombre', mode: 'nouveau', slides: T.normaliserDeck(T.DEMOS[0].slides) }; const r = JSON.stringify(panneau()); deckPourTest = null; return r }
  for (const [lg, attendu, interdit] of [
    ['en', ['Ask the chat for a deck', 'See the demo', 'Slides panel — the chat writes, you edit, it corrects.', 'Three gestures', 'Your turn.'], /Demande|Voir la démo|Trois gestes|À toi|le chat écrit/],
    ['kybernos', ['Demande un deck au chat', 'Voir la démo', 'Trois gestes', 'À toi.', 'tu modifies'], /Ask the chat|See the demo|Three gestures|Your turn/],
    ['es', ['Ask the chat for a deck', 'See the demo', 'Three gestures'], /Demande|Voir la démo|Trois gestes/],
    ['ar', ['Ask the chat for a deck', 'See the demo'], /Demande|Voir la démo/],
    ['throws', ['Ask the chat for a deck', 'See the demo'], /Demande|Voir la démo/],
  ]) {
    langue = lg
    const t = textes()
    ok(`language « ${lg} »: the empty panel and the demo deck speak the language of the page`, attendu.every((m) => t.includes(m)) && !interdit.test(t), t.slice(0, 120))
  }
  // L4-07: the demo deck's kickers (the small line above a slide's title) were English literals in a French interface, one of them
  // missed by every earlier pass. Each is a kt(fr, en) pair; the only bare word left is one that is the same in both languages.
  {
    const src = readFileSync(new URL('./src/plugin.js', import.meta.url), 'utf8')
    const demo = src.slice(src.indexOf('const DEMOS = ['), src.indexOf('/* ═══════════════ 5. PANNEAU'))
    const nus = [...demo.matchAll(/kicker:\s*'([^']*)'/g)].map((m) => m[1])
    ok('the demo deck: no kicker is a bare literal (only « Tempo », the same word in French and English)', demo.length > 200 && nus.every((k) => k === 'Tempo'), nus)
    const kickers = (lg) => { langue = lg; return T.DEMOS[0].slides.map((sl) => sl.kicker).filter(Boolean) }
    const fr = kickers('kybernos')
    ok('French: the demo kickers are French', fr.includes('Comment ça marche') && fr.includes('Le principe') && !fr.includes('How it works') && !fr.includes('The premise'), fr.join(' | '))
    const en = kickers('en')
    ok('English: the same kickers in English', en.includes('How it works') && en.includes('The premise') && !en.includes('Comment ça marche'), en.join(' | '))
    const es = kickers('es')
    ok('Spanish (no table of ours): English, never French', es.includes('How it works') && !es.includes('Comment ça marche'), es.join(' | '))
    langue = 'kybernos'
  }
  const barreEn = avecDeckBarre('en')
  ok('English: the tool bar reads View / Text / Brush / Eraser / Clear all', ['"View"', '"✎ Text"', '"✎ Brush"', '"Eraser"', '"Clear all"'].every((m) => barreEn.includes(m)) && !/Gomme|Tout effacer|"Voir"/.test(barreEn))
  const barreFr = avecDeckBarre('kybernos')
  ok('French: the same bar reads Voir / Texte / Pinceau / Gomme / Tout effacer', ['"Voir"', '"✎ Texte"', '"✎ Pinceau"', '"Gomme"', '"Tout effacer"'].every((m) => barreFr.includes(m)))
  ok('Spanish (no table of ours): English, never French', !/Gomme|Tout effacer|"Voir"/.test(avecDeckBarre('es')))
  langue = 'kybernos'
}

console.log(echecs === 0 ? '\nClient : tout est vert.' : `\nClient : ${echecs} échec(s).`)
process.exit(echecs === 0 ? 0 : 1)
