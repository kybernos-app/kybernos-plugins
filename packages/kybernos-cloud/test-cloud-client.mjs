// ── Test hors-DSH du half client Kybernos Cloud ─────────────────────────────
//
// Le half client n'est pas un module ESM : c'est un script que DSH charge via
// `window.__ModuleLoader__.load({ id, factory })`. On rejoue exactement ce
// contrat ici, puis on vérifie :
//   * l'enregistrement du bouton dans `sidebar.footer.action` (id + ordre) ;
//   * l'injection du CSS ;
//   * un rendu React réel (react-dom/server) qui ne casse pas et expose bien
//     l'entrée « Kybernos Cloud » accessible au clavier.
//
// React n'est pas une dépendance du dépôt (aucun node_modules) : pointez
// NODE_PATH sur un dossier qui en contient, sinon le test se saute :
//
//   NODE_PATH=/chemin/vers/node_modules node kybernos-cloud/test-cloud-client.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

// ── Étage statique : tourne MÊME sans react ─────────────────────────────────
// Le half client n'est pas un module ESM : on lit la clientSource. Ce qui est
// vérifiable sans moteur de rendu l'est ici (câblage de la section mémoire,
// complétude des dictionnaires), pour que l'absence de react ne transforme pas
// la suite en « tout vert » silencieux.
const clientSource = readFileSync(join(here, 'client.js'), 'utf8')
let staticPass = 0
const sok = (label) => { staticPass += 1; console.log('  ✓ ' + label) }

for (const needle of [
  "callLocal('/memory', 'GET')",
  "callLocal('/memory/add', 'POST'",
  "callLocal('/memory/lessons', 'POST'",
  // Épingler/oublier/reliers passent par le même assistant `memoAct`.
  "memoAct('/memory/update'",
  "memoAct('/memory/delete'",
  "memoAct('/memory/map'",
  "t('memoTitle')",
  'memoReport',
  'setMemoReport',
]) {
  assert.ok(clientSource.includes(needle), 'cablage de la section memoire manquant: ' + needle)
}
sok('section memoire cablée : lecture, ajout, epinglage, oubli, lecons, correspondance')

// La route d'ajout doit avoir un chemin DISTINCT de la lecture : le routeur
// indexe par chemin, deux routes sur `/memory` se masqueraient.
assert.ok(clientSource.includes("callLocal('/memory/add', 'POST'"), "l'ajout doit passer par /memory/add")
assert.equal(clientSource.includes("callLocal('/memory', 'POST'"), false)
sok('ajout sur /memory/add (jamais un POST sur /memory, qui masquerait la lecture)')

// Dictionnaires : toute clé littérale `t('…')` doit exister en fr ET en en.
const frStart = clientSource.indexOf('      fr: {')
const enStart = clientSource.indexOf('      en: {')
assert.ok(frStart > 0 && enStart > frStart, 'dictionnaires fr/en introuvables')
const frBlock = clientSource.slice(frStart, enStart)
const enBlock = clientSource.slice(enStart, clientSource.indexOf('\n      },', enStart))
const keysOf = (text) => new Set([...text.matchAll(/^ {8}([A-Za-z][A-Za-z0-9_]*): '/gm)].map((m) => m[1]))
const frKeys = keysOf(frBlock)
const enKeys = keysOf(enBlock)
assert.ok(frKeys.size > 20 && enKeys.size > 20, 'dictionnaires parses trop maigres: ' + frKeys.size + '/' + enKeys.size)
const used = new Set([...clientSource.matchAll(/\bt\('([A-Za-z][A-Za-z0-9_]*)'\)/g)].map((m) => m[1]))
assert.deepEqual([...used].filter((k) => frKeys.has(k) !== true), [], 'cles fr manquantes')
assert.deepEqual([...used].filter((k) => enKeys.has(k) !== true), [], 'cles en manquantes')
// Les quatre clés construites dynamiquement : t('memoKind' + Capitalisé).
for (const k of ['memoKindFact', 'memoKindPreference', 'memoKindEvent', 'memoKindPolicy']) {
  assert.ok(frKeys.has(k) && enKeys.has(k), 'cle dynamique manquante: ' + k)
}
sok(String(used.size) + ' cles litterales presentes en fr ET en (+4 construites dynamiquement)')
console.log('  ' + staticPass + ' verifications statiques OK')

let React = null
let renderToStaticMarkup = null
try {
  React = require('react')
  renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup
} catch (e) {
  console.log('SKIP — react/react-dom introuvables. Relancez avec :')
  console.log('  NODE_PATH=<dossier node_modules contenant react> node ' + join('kybernos-cloud', 'test-cloud-client.mjs'))
  process.exit(0)
}

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

// ── DOM minimal (le plugin n'utilise que createElement/head.append) ─────────
const inserted = []
const fakeTag = () => ({ dataset: {}, textContent: '', removed: false, remove() { this.removed = true } })
globalThis.document = {
  baseURI: 'http://127.0.0.1:3080/',
  createElement: () => fakeTag(),
  head: { append: (tag) => inserted.push(tag) },
  // Surface DOM ajoutée pour le RENDU de l'état connecté (plus loin) : le plugin
  // capture `window`/`document` par RÉFÉRENCE au chargement, donc tout ce qu'un
  // rendu exige doit exister AVANT `new Function(...)`.
  addEventListener () {}, removeEventListener () {},
}
const opened = []
globalThis.window = {
  setInterval: () => 0,
  clearInterval: () => {},
  open: (url) => { opened.push(url); return null },
  addEventListener () {}, removeEventListener () {}, dispatchEvent: () => true,
}
// Node expose `navigator` en lecture seule : on le remplace par defineProperty.
Object.defineProperty(globalThis, 'navigator', {
  value: { clipboard: { writeText: async () => {} } },
  configurable: true,
  writable: true,
})

// ── Chargement du script client, comme le fait DSH ─────────────────────────
const captured = {}
globalThis.window.__ModuleLoader__ = { load: (def) => { captured.def = def } }
const source = readFileSync(join(here, 'client.js'), 'utf8')
new Function('window', 'document', 'navigator', source)(globalThis.window, globalThis.document, globalThis.navigator)

assert.ok(captured.def !== undefined, 'le script doit appeler __ModuleLoader__.load')
assert.equal(captured.def.id, '@local/kybernos-cloud')
ok('__ModuleLoader__.load appele avec id=@local/kybernos-cloud')

const plugin = captured.def.factory(require)
assert.equal(typeof plugin.apply, 'function')
assert.ok(Array.isArray(plugin.inject) && plugin.inject.includes('slots'), 'inject doit declarer slots')
ok('factory(require) renvoie un plugin Cordis (apply + inject slots)')

// ── Montage sur un faux ctx : capture de l'enregistrement de slot ───────────
const registrations = []
let registered = null
const injectedSlots = []
const slots = {
  // The client now fills more than the footer (the Account section of Settings, the full-page panels): record every slot it asks to inject into.
  inject: (name, cb) => { injectedSlots.push(name); cb(); return () => {} },
  register: (options, component) => {
    registrations.push({ options, component })
    if (options !== null && options !== undefined && options.name === 'sidebar.footer.action') registered = { options, component }
    return () => {}
  },
}
const ctx = {
  get: (name) => (name === 'slots' ? slots : undefined),
  effect: (fn) => { void fn() },
}
plugin.apply(ctx)

assert.ok(registered !== null, 'le plugin doit enregistrer un slot')
assert.equal(registered.options.name, 'sidebar.footer.action')
assert.equal(registered.options.id, 'kybernos-cloud')
assert.equal(registered.options.order, 21)
ok('bouton enregistre dans sidebar.footer.action (id=kybernos-cloud, order=21)')

// La page de l'espace est PLEIN CADRE : enregistrée dans le slot `main` sous la
// clé qu'ouvre layout.selectPanel — pas une surcouche.
const page = registrations.filter((r) => r.options.name === 'main')[0]
assert.ok(page !== undefined, 'la page de l espace doit etre enregistree dans le slot main')
assert.equal(page.options.key, 'kybernos-cloud-space')
assert.equal(typeof page.component, 'function')
assert.equal(source.includes("selectPanel('kybernos-cloud-space')"), true, 'l engrenage doit ouvrir le panneau main')
// Only the page's own body counts: the profile card, defined further down, legitimately owns a scrim.
const spaceBody = source.slice(source.indexOf('const SpaceMain'), source.indexOf('SpaceMain.__testTabs'))
assert.ok(spaceBody.length > 200, 'le corps de la page de l espace doit etre trouve')
assert.equal(spaceBody.includes('kbc-scrim'), false, 'la page ne doit PAS etre une surcouche')
ok('page de l espace enregistree dans le slot main (selectPanel, pas de surcouche)')

assert.equal(inserted.length, 1)
assert.ok(inserted[0].textContent.includes('.kbc-scrim'), 'le CSS de la carte doit etre injecte')
assert.ok(inserted[0].textContent.includes('.kbf-profile'), 'le CSS de la rangee d identite doit etre injecte')
ok('CSS injecte via styles.insert')

// ── Rendu réel du composant (React) ─────────────────────────────────────────
// L'état de connexion vient d'un effet fetch : au premier rendu la rangée est
// en phase « lecture » et propose le geste — c'est cette forme-là qu'on mesure
// ici (les deux autres états sont couverts par le CSS et le câblage ci-dessous).
const html = renderToStaticMarkup(React.createElement(registered.component, null))
assert.ok(html.includes('<button'), 'la rangee de pied doit rendre un bouton')
assert.ok(html.includes('kbf-off') && html.includes('kbm-btn-primary'), 'le CTA de connexion est rendu tant que l etat est inconnu')
assert.ok(html.includes('kbf-gear'), 'les Reglages restent atteignables meme deconnecte (le declencheur natif est masque)')
assert.ok(html.includes('<svg'), 'icone de connexion presente')
// La carte n'est pas ouverte au premier rendu : le scrim ne doit pas exister.
assert.equal(html.includes('kbc-scrim'), false)
ok('rendu React de la rangee de pied sans erreur (CTA + icone)')

// ── La feuille de style couvre bien les trois états de la carte ─────────────
// (un composant ne s'appelle pas hors de React : on vérifie donc le CSS qui
// porte les états appairé / appairage / connecté, et le rendu ci-dessus qui
// prouve que le composant s'instancie sans erreur.)
const css = inserted[0].textContent
for (const cls of ['.kbc-card', '.kbc-code', '.kbc-rows', '.kbc-ws-item', '.kbc-badge', '.kbc-btn-primary', '.kbc-btn-ghost', '.kbc-v-fallback']) {
  assert.ok(css.includes(cls), 'CSS manquant: ' + cls)
}
ok('CSS des 3 etats (appairage, profil, actions) present')

// ── Les trois formes de la rangée du bas ────────────────────────────────────
// Identité (avatar + nom + pastille de formule + appareil), encart de connexion
// (phrase + CTA), et le rail replié qui se réduit à l'avatar. La cloche des
// notifications est masquée quand le compte est déconnecté : l'état est publié
// sur <html data-kb-cloud> par CETTE rangée, pas deviné par l'autre plugin.
for (const cls of ['.kbf-avatar', '.kbf-name', '.kbf-plan', '.kbf-dev', '.kbf-hint', '.kbf-connect']) {
  assert.ok(css.includes(cls), 'CSS de la rangee manquant: ' + cls)
}
for (const needle of ["setAttribute('data-kb-cloud'", 'phase === \'connected\' ? \'on\' : \'off\'', 'kbf-connect', 'autoStart']) {
  assert.ok(source.includes(needle), 'cablage de la rangee manquant: ' + needle)
}
// Les libellés de la rangée existent en fr ET en (aucun trou de traduction).
for (const key of ['footHint', 'footConnect', 'footProfile', 'footDevice', 'footPairing', 'footPairingAction']) {
  assert.equal((source.match(new RegExp(key + ':', 'g')) || []).length, 2, key + ' doit exister en fr ET en')
}
ok('rangee du bas : les 3 formes + etat publie + libelles fr/en')

// ── Repli d'affichage du nom ────────────────────────────────────────────────
// `kybernos_users.name` est vide : la carte montre la partie locale de l'email
// au lieu d'un « — » muet, marquee comme un repli (classe + info-bulle).
// L'etat connecte vient d'un effet fetch, donc renderToStaticMarkup ne
// l'atteint pas : on verifie le cablage dans la source, la classe CSS ci-dessus
// et la parite fr/en de l'info-bulle.
for (const needle of ['kbc-v-fallback', 'email.slice(0, at)', "hint: shownName.fallback"]) {
  assert.ok(source.includes(needle), 'cablage du repli manquant: ' + needle)
}
assert.equal((source.match(/nameFallback:/g) || []).length, 2, 'nameFallback doit exister en fr ET en')
ok('repli de nom : classe CSS + derivation partie locale + info-bulle fr/en')

// ── Catalogue LiteLLM importé (fonctionnalité cloud n°1) ────────────────────
// La carte connectée affiche le résumé (combien, quelle formule) et un bouton
// « Réimporter » qui appelle POST /kybernos-cloud/models/sync. L'import
// automatique, lui, est du côté host (au claim, au boot, au sync) : le client
// ne lit QUE des résumés, jamais de jeton ni d'ids complets.
assert.equal((source.match(/modelsNote:/g) || []).length, 2, 'modelsNote doit exister en fr ET en')
assert.equal((source.match(/modelsWarn:/g) || []).length, 2, 'modelsWarn doit exister en fr ET en')
for (const needle of ["callLocal('/models/sync', 'POST')", 'st.models', 'kbc-btn-ghost:disabled']) {
  assert.ok(source.includes(needle), 'cablage du bloc modele manquant: ' + needle)
}
ok('bloc catalogue : resume + bouton resync + note fr/en + bouton desactive')

// ── Le sélecteur d'espace et sa page (menu principal) ──────────────────────
// La rangée du pied SÉLECTIONNE l'espace : connectée, elle montre l'espace ACTIF
// (pas le profil) et ouvre la page. On rend réellement l'état connecté avec un
// DOM minimal + act() : la rangée en phase « lecture » ne prouverait rien du
// sélecteur (react-dom/server n'exécute aucun effet).
function texteNode () {
  let v = ''
  return { nodeType: 3, get nodeValue () { return v }, set nodeValue (x) { v = x }, get textContent () { return v }, set textContent (x) { v = x } }
}
function element (doc) {
  let propre = ''
  const el = {
    nodeType: 1, nodeName: 'DIV', tagName: 'DIV', namespaceURI: null, style: {}, className: '',
    attributes: {}, ownerDocument: doc, childNodes: [],
    setAttribute (k, v) { el.attributes[k] = String(v) },
    getAttribute (k) { return el.attributes[k] === undefined ? null : el.attributes[k] },
    removeAttribute (k) { delete el.attributes[k] },
    appendChild (c) { el.childNodes.push(c); return c },
    removeChild (c) { const i = el.childNodes.indexOf(c); if (i >= 0) el.childNodes.splice(i, 1); return c },
    insertBefore (c) { el.childNodes.push(c); return c },
    addEventListener () {}, removeEventListener () {}, dispatchEvent: () => true,
    // `texte` est PUBLIC : le sérialiseur doit voir ce que React a posé en
    // textContent (sinon les assertions ne lisent que les attributs — piège
    // mesuré : un test « vert » qui ne vérifiait que title="").
    texte: '',
    get textContent () { return propre + el.texte + el.childNodes.map((c) => c.nodeValue ?? c.textContent ?? '').join('') },
    set textContent (v) { propre = ''; el.texte = v; el.childNodes = [] },
  }
  return el
}
/** Sérialise l'arbre minimal : ce sont les CLASSES et le TEXTE qu'on vérifie. */
function htmlDe (n) {
  if (n.nodeType === 3) return String(n.nodeValue ?? '')
  const cls = n.className ? ` class="${n.className}"` : ''
  const attrs = Object.entries(n.attributes || {}).map(([k, v]) => ` ${k}="${v}"`).join('')
  return `<div${cls}${attrs}>` + (n.texte || '') + (n.childNodes || []).map(htmlDe).join('') + '</div>'
}
// On complète les objets DÉJÀ capturés par le plugin (mêmes références).
const doc = globalThis.document
doc.activeElement = null
doc.createElement = () => element(doc)
doc.createElementNS = () => element(doc)
doc.createTextNode = () => texteNode()
doc.documentElement = element(doc)
doc.body = element(doc)
doc.defaultView = { document: doc, addEventListener () {}, removeEventListener () {}, HTMLIFrameElement: class {} }
doc.document = doc
globalThis.window.document = doc
globalThis.window.HTMLIFrameElement = class {}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// react-dom lit navigator à l'import : sans lui, le require jette avant tout
// rendu (« Cannot read properties of undefined »).
globalThis.navigator = { userAgent: 'node.js' }
const ReactClient = require('react-dom/client')
const { act } = require('react')

globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  json: async () => ({
    ok: true,
    connected: true,
    state: {
      user: { email: 'dev@example.test', plan: 'free' },
      workspaces: [{ id: 'ws-1', name: 'My workspace', kyber_count: 2 }],
      active_workspace_id: 'ws-1',
      web_url: 'https://dev.kybernos.app',
    },
  }),
})

const racineEl = element(doc)
const racine = ReactClient.createRoot(racineEl)
const { createElement } = require('react')
await act(async () => {
  racine.render(createElement(registered.component, null))
  await new Promise((r) => setTimeout(r, 0))
})
const htmlConnecte = htmlDe(racineEl)
// The unified card (04/10): ONE card carries the active space, "who · plan", the phone and the bell; a click opens the
// account menu. No gear inside the row (DSH shows its own right beside it) and no menu until it is opened.
assert.ok(htmlConnecte.includes('data-kb="workspace-card"'), 'la carte unifiee est la (un clic ouvre le menu)')
assert.ok(htmlConnecte.includes('kbfp-cardname">My workspace<'), 'la carte montre l espace ACTIF')
assert.ok(htmlConnecte.includes('kbfp-tile') && htmlConnecte.includes('>MW<'), 'tuile d initiales de l espace')
assert.ok(htmlConnecte.includes('dev · free'), 'sous-titre : qui · formule (partie locale de l email, pas un « — » muet)')
assert.ok(htmlConnecte.includes('aria-haspopup="menu"') && htmlConnecte.includes('aria-expanded="false"'), 'la carte ouvre un menu, ferme au premier rendu')
assert.equal(htmlConnecte.includes('kbfp-menu'), false, 'le menu n est pas rendu tant qu il n est pas ouvert')
assert.equal(htmlConnecte.includes('kbf-wsgear'), false, 'aucun engrenage DANS la rangee du pied')
assert.ok(htmlConnecte.includes('title="Notifications"'), 'la cloche est dans la carte')
ok('carte unifiee : espace actif, qui · formule, mobile et cloche, menu ferme, aucun engrenage')


// « Teams settings » is a NAMED entry of the account menu. It opens the console through a bridge the core plugin exposes,
// then falls back to the rich space page, then to the local page: degrade, never break.
assert.ok(source.includes("entree('space-settings', h(BuildingIcon, { size: 18 }), t('menuTeamsSettings'), props.onSpace)"),
  'le menu doit porter une entree nommee pour les reglages de la team')
for (const needle of ['window.__kbOpenWsConsole', 'window.__kbOpenWorkspace', "selectPanel('kybernos-cloud-space')"]) {
  assert.ok(source.includes(needle), 'repli de l entree Teams settings manquant: ' + needle)
}
assert.equal((source.match(/menuTeamsSettings:/g) || []).length, 2, 'menuTeamsSettings doit exister en fr ET en')
ok('Teams settings : entree nommee du menu, pont vers la console puis deux replis, fr/en')

// « Open the console in your browser »: the page is the same one, where it can change things. DSH asks its host route for a single-use link (never the
// device token in a URL) and asks the HOST to open the system browser with it: the server refuses a link that reaches it as a navigation a page started (a tab this page
// opened and pointed at the link is « cross-site »: the person lands on « link expired », measured 2026-10-08 in a real browser), and accepts one the OS opened.
// Only a host that could not open one hands the address back, and then a tab is opened here, with no opener.
for (const needle of ["entree('space-browser', h(GlobeIcon", "callLocal('/console/link', 'POST'", '{ open: true }', 'workspace_id: actif, open: true', 'r.opened !== true', "window.open(r.url, '_blank', 'noopener,noreferrer')", 'onSpaceBrowser: ouvrirEspaceNavigateur']) {
  assert.ok(source.includes(needle), 'entree « ouvrir dans le navigateur » : element manquant: ' + needle)
}
assert.ok(!source.includes("window.open('', '_blank')") && !source.includes('onglet.location.href'), 'un onglet ouvert par la page puis pointe sur le lien est « cross-site » : le serveur le refuse')
assert.equal((source.match(/menuTeamsBrowser:/g) || []).length, 2, 'menuTeamsBrowser doit exister en fr ET en')
ok('Ouvrir la console dans le navigateur : entree du menu, lien a usage unique demande a l hote qui ouvre le navigateur du systeme, adresse rendue sinon, fr/en')

// Le câblage de la page : la liste des espaces, la route du choix, les cinq
// directions inertes, et le lien vers la page hébergée.
for (const needle of [
  "callLocal('/space/active', 'POST'",
  "'kybernos-cloud:space'",
  "'kybernos-cloud:switch'",
  "t('spaceUnknown')",
  "t('syncNotServed')",
  "t('wsTabPlan')",
  "t('wsTabSync')",
]) {
  assert.ok(source.includes(needle), 'cablage de la page d espace manquant: ' + needle)
}
// Les cinq onglets de la maquette, dans l'ordre : la clé du panneau, la liste
// des clés d'onglet, puis le dictionnaire de libellés (les cinq mêmes clés).
assert.equal(source.includes("const TABS = ['plan', 'usage', 'people', 'billing', 'sync']"), true,
  'les cinq onglets doivent etre declares dans l ordre de la maquette')
const libelles = "{ plan: t('wsTabPlan'), usage: t('wsTabUsage'), people: t('wsTabPeople'), billing: t('wsTabBilling'), sync: t('wsTabSync') }"
assert.equal(source.includes(libelles), true, 'le dictionnaire des libelles doit suivre le meme ordre')
for (const cle of ['wsTabPlan', 'wsTabUsage', 'wsTabPeople', 'wsTabBilling', 'wsTabSync', 'wsPlanLabel', 'wsViewUsage']) {
  assert.equal((source.match(new RegExp(cle + ':', 'g')) || []).length, 2, cle + ' doit exister en fr ET en')
}
ok('page de l espace : cinq onglets (Plan, Usage, People, Billing, Synchronisation) + fr/en')

console.log('\n' + pass + ' verifications OK')
