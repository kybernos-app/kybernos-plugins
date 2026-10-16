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

// The five pages of the account that used to sit in DSH's Settings (Account, Referral, Security, Account data, Support & legal) are gone from
// this bundle, with what only they used: the account memory section, the model re-import and DSH chats buttons, the referral and legal
// reads, the profile helpers, and the dictionary lines and CSS of all of that. The host routes stay (the Atlas reads `/kybernos-cloud/memory`,
// test-cloud-host.mjs holds the contract); only the client side is pinned as removed here.
for (const gone of ["callLocal('/memory", 'memoAct', "t('memoTitle')", 'setMemoReport', "callLocal('/referral'", "callLocal('/legal'",
  'AccountSection', 'DataSection', 'ProfileMain', 'kybernos-cloud-profile', "id: 'kybernos-account'", "id: 'kybernos-data'", 'KB_ACC_KEY', 'kbAccRead', 'kbAccWrite',
  'props.page === true', 'accSub', 'dataSub', 'refTitle', 'supTitle']) {
  assert.equal(clientSource.includes(gone), false, 'removed with the account pages of Settings, must not come back: ' + gone)
}
sok('les cinq pages du compte ne sont plus dans les Reglages : ni section, ni memoire, ni parrainage, ni legal, ni profil local cote client')
// What came back, and only that: the « Kybernos » section of what stays on THIS computer (the custom instructions through the host's two routes, the re-import
// of the active server's models, the send of the DSH chats). It is the bundle's only Settings section and holds nothing of the account.
assert.equal((clientSource.match(/name: 'settings\.section'/g) || []).length, 1, 'une seule section de Reglages')
assert.ok(clientSource.includes("id: 'kybernos-local'"), 'la section s appelle kybernos-local (cle de nav connue du plugin de base)')
for (const needle of ["callLocal('/instructions', 'GET')", "callLocal('/instructions/save', 'POST', { text: text })", "run('models', '/models/sync')", "run('chats', '/chats/push')"]) {
  assert.ok(clientSource.includes(needle), 'cablage de la section Kybernos manquant: ' + needle)
}
sok('section Kybernos : instructions (lecture + enregistrement par la route hote), reimport des modeles, envoi des chats DSH')

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
sok(String(used.size) + ' cles litterales presentes en fr ET en')
// « Open the console in your browser » is gone: it asked the server for a link the old stack does not have (the tab opened, then closed with no word) and
// it repeated « Teams settings ». The menu has ONE entry for the team console, and nothing in the client opens a tab for it.
for (const needle of ["entree('space-browser'", "menuTeamsBrowser", "onSpaceBrowser", "ouvrirEspaceNavigateur", "window.open('', '_blank')"]) {
  assert.ok(!clientSource.includes(needle), 'l entree « ouvrir dans le navigateur » ne doit plus exister: ' + needle)
}
assert.ok(clientSource.includes("entree('space-settings'"), 'l entree « Teams settings » reste')
// Two client calls to the host's console-link route, and only two: the quota notice's button, and the footer's account page (the menu's Team settings, Account and Referral
// entries: `section: 'plan'` and `'overview'`). Both ask the HOST to open the system browser (`open: true`): a tab opened by the page and pointed at the link is « cross-site »
// and the server refuses it (« link expired »).
assert.equal((clientSource.match(/callLocal\('\/console\/link'/g) || []).length, 2, 'deux appels client a /console/link : la notice de quota et la page du compte du pied')
assert.equal((clientSource.match(/callLocal\('\/console\/link', 'POST', [^\n]*open: true/g) || []).length, 2, 'le lien de la console est ouvert par l hote (open: true), jamais par un onglet de la page')
assert.ok(/const ouvrirAppli = \(section\) => \(\) => \{\s*setMenuOpen\(false\)\s*openAccountPage\(section, actif\)/.test(clientSource) && /section: section, open: true/.test(clientSource), 'les entrees du menu demandent un lien de console, ouvert par l hote')
assert.ok(clientSource.includes("onSpace: ouvrirAppli('plan')"), 'Team settings ouvre la page du plan de l equipe dans le navigateur')
assert.ok(clientSource.includes("onAccount: ouvrirAppli('overview')") && clientSource.includes("onReferral: ouvrirAppli('overview')"), 'Account et Referral ouvrent la vue d ensemble dans le navigateur')
// « Remote control »: the phone link is ONE entry of the connected menu (right after Referral), offered only when the phone link's own status route says the
// feature is there; the footer's separate phone button is gone. The panel is the same bridge and fallback as the old button's (MobilePanel).
{
  assert.ok(/entree\('referral'[^\n]*\n\s*\/\/[^\n]*\n\s*props\.remote !== null && props\.remote !== undefined\s*\? entree\('remote', h\(PhoneIcon/.test(clientSource), 'l entree Remote control vient juste apres Referral')
  assert.ok(clientSource.includes("'kybernos-mobile/remote/status'"), 'la disponibilite se lit sur la route de kybernos-mobile')
  assert.ok(!clientSource.includes("title: t('mobTitle') + ' — ' + t('mobHelp')"), 'le bouton telephone autonome du pied n existe plus')
  assert.equal((clientSource.match(/h\(MobilePanel, \{/g) || []).length, 1, 'un seul panneau telephone')
  assert.ok(/menuRemote: 'Remote control'/.test(clientSource) && /menuRemote: 'Contrôle à distance'/.test(clientSource), 'fr/en')
  const m = clientSource.match(/const remoteOffer = \(j\) => \{[\s\S]*?\n        \}\n/)
  assert.ok(m !== null, 'remoteOffer est la ou le test l attend')
  const remoteOffer = new Function('return ' + m[0].replace('const remoteOffer = ', '').trim())()
  const on = { ok: true, available: true, connected: true, configured: true, entitled: true, devices: [{ id: 'a' }, { id: 'b' }] }
  assert.deepEqual(remoteOffer(on), { devices: 2 }, 'offered, with the phones already linked')
  assert.deepEqual(remoteOffer(Object.assign({}, on, { devices: undefined })), { devices: 0 })
  assert.deepEqual(remoteOffer(Object.assign({}, on, { configured: null, entitled: null, connected: null })), { devices: 2 }, 'not told it is off: offered')
  for (const off of [{ configured: false }, { entitled: false }, { available: false }, { connected: false }, { ok: false }])
    assert.equal(remoteOffer(Object.assign({}, on, off)), null, 'hidden: ' + JSON.stringify(off))
  for (const odd of [null, undefined, 'x', 7, []]) assert.equal(remoteOffer(odd), null, 'an answer that is not a status offers nothing')
  sok('Remote control : une entree apres Referral, lue sur le statut du lien telephone (cachee si non offert, hors forfait, ou illisible), plus de bouton telephone')
}
// The words: a shared space is a Team, creating one says so (docs/vocabulary.md in the app repo: workspace = the container incl. the personal one).
for (const [needle, why] of [["wsNewTitle: 'Create a team'", 'en: Create a team'], ["wsNewName: 'Team name'", 'en: Team name'],
  ["wsNewTitle: 'Créer une équipe'", 'fr: Créer une équipe'], ["wsNewName: 'Nom de l\\'équipe'", 'fr: Nom de l équipe']]) {
  assert.ok(clientSource.includes(needle), 'vocabulaire Team: ' + why)
}
for (const old of ["wsNew: 'New workspace'", "wsNewTitle: 'Create a workspace'", "wsNewName: 'Workspace name'", "wsNew: 'Nouvel espace'", "wsNewTitle: 'Créer un espace'"]) {
  assert.ok(!clientSource.includes(old), 'ancien libellé « workspace » à la création: ' + old)
}
sok('Menu du compte : une seule entrée pour la console d équipe, création = Team (fr/en)')
// Vocabulary (decided: the product speaks of TEAMS): no person-facing string of the cloud card says « workspace » / « espace », and the personal one is shown as « Personal » / « Personnel ».
// The dictionaries are the only place such strings live; code, routes and comments keep the technical word.
for (const [lang, block] of [['en', enBlock], ['fr', frBlock]]) {
  const values = [...block.matchAll(/^ {8}[A-Za-z][A-Za-z0-9_]*: '((?:[^'\\]|\\.)*)'/gm)].map((m) => m[1])
  const bad = values.filter((v) => /workspace|espace/i.test(v))
  assert.deepEqual(bad, [], 'mot « workspace » / « espace » dans une chaine visible (' + lang + ') : on dit Team / équipe')
}
assert.ok(/wsPersonal: 'Personal'/.test(enBlock) && /wsPersonal: 'Personnel'/.test(frBlock), 'l espace personnel s affiche Personal / Personnel')
assert.ok(clientSource.includes('nomAffiche(courant, t)') && clientSource.includes('nomAffiche(w, t)') && clientSource.includes('const nomAffiche = (w, t) =>'), 'la carte et la liste affichent le nom via nomAffiche, avec le traducteur de l appelant (Personal pour l espace personnel)')
sok('vocabulaire Team : aucune chaine visible ne dit workspace / espace, l espace personnel = Personal / Personnel')
// A refused creation always says so (with the server's code), and keeps the hosted page as an extra: never a dialog that silently does nothing.
assert.ok(clientSource.includes("setErreur(t('wsNewErr') + (res !== null && typeof res.status === 'number'"), 'la creation refusee dit pourquoi (code serveur)')
sok('creation d une equipe refusee : une phrase avec le code, la page hebergee reste proposee')
// The page head of the Account / Data pages, and the custom-instructions field of the Account page, left with those pages: nothing of them stays.
for (const gone of ['PageHead', 'kbpg-head', 'kbax-', 'kbfp-avat', 'accInstr', 'accLocalNote', 'dataNavLabel']) {
  assert.equal(clientSource.includes(gone), false, 'belonged to the Account / Data pages of Settings: ' + gone)
}
sok('en-tete de page, champ d instructions et styles du compte : retires avec les pages')
// Dead-code rider: the local Team page (`SpaceMain`, key `kybernos-cloud-space`: Plan / Usage / People / Billing / Synchronisation tabs) was removed as
// unreachable. Its only doors were the last fallback of the « Teams settings » entry (behind the two bridges the mandatory master bundle sets
// unconditionally) and the window event `kybernos-cloud:space`, which nothing in the repos dispatched. It stays removed: the component, its panel key,
// its event, its tab list and helpers, and its strings in BOTH dictionaries (a dictionary line is also a line the Language page has to translate).
for (const gone of ['SpaceMain', 'kybernos-cloud-space', "'kybernos-cloud:space'", 'const TABS = [', 'kbt-tabs', 'kbs-flip', 'ligneSync']) {
  assert.equal(clientSource.includes(gone), false, 'removed with the local Team page, must not come back: ' + gone)
}
for (const cle of ['wsTabPlan', 'wsTabUsage', 'wsTabPeople', 'wsTabBilling', 'wsTabSync', 'wsPlanLabel', 'wsViewUsage', 'wsUsageNote', 'wsPeopleNote', 'wsBillingNote',
  'syncTitle', 'syncNotServed', 'syncOn', 'syncOff', 'syncMemorySpace', 'syncSends', 'syncPull', 'syncPush', 'spaceAccount']) {
  assert.equal((clientSource.match(new RegExp('^ {8}' + cle + ': ', 'gm')) || []).length, 0, cle + ' belonged to the local Team page and must not stay in a dictionary')
}
// The menu entries no longer open a page of DSH (2026-10-16): the console's frame was read-only and every change in it sent the person to the browser. Neither bridge of
// the core is asked for any more, and no fallback to the rich page of an older master stands.
assert.equal((clientSource.match(/window\.__kbOpenWsConsole/g) || []).length, 0, 'plus de pont vers l iframe de la console')
assert.equal((clientSource.match(/window\.__kbOpenWorkspace/g) || []).length, 0, 'plus de repli vers la page riche')
assert.equal(/\.selectPanel\('/.test(clientSource), false, 'selectPanel only ever closes the profile page (selectPanel(null)): no call opens a panel by key')
sok('page locale de l equipe : supprimee (composant, cle de panneau, evenement, onglets, 38 chaines fr/en)')
// The card says what went wrong in a sentence, never in the host's internal code (found in the pre-production acceptance: « Could not connect »
// followed by `demarrage_impossible`, for a server that was down, one that answered 503 and a portal page alike). Every code the host's pairing
// and refresh routes return to the card has a sentence in both dictionaries, and the pairing's own rows say what they are (the hour the code
// stops working, not a date under « Session »; a refused or expired request is not a « revoked session »).
for (const code of ['reseau', 'trop_de_demandes', 'demarrage_impossible', 'profil_indisponible', 'reponse_illisible']) {
  assert.ok(clientSource.includes("'" + code + "'") && /const errorWords = /.test(clientSource), 'le code ' + code + ' doit avoir une phrase')
}
assert.equal(/String\(view\.error \|\| ''\)/.test(clientSource), false, 'la carte n affiche plus view.error tel quel')
assert.ok(clientSource.includes('errorWords(view.error)'), 'la carte passe view.error par errorWords')
for (const key of ['errNet', 'errBusy', 'errStart', 'errProfile', 'errUnreadable', 'pairingExpires', 'pairingDenied', 'pairingExpired']) {
  assert.ok(frKeys.has(key) && enKeys.has(key), 'phrase manquante (fr et en): ' + key)
}
assert.ok(clientSource.includes("label: t('pairingExpires'), value: fmtTime(pairing.expires_at)"), 'l appairage dit jusqu a quelle heure le code est valable')
assert.equal(/label: t\('session'\), value: fmtDate\(pairing\.expires_at\)/.test(clientSource), false, 'plus de « Session <date> » pour un code qui expire dans dix minutes')
assert.ok(/view\.note === 'denied' \? t\('pairingDenied'\) : t\('pairingExpired'\)/.test(clientSource), 'refus et expiration ont chacun leur phrase (pas « session révoquée »)')
sok('la carte parle en phrases : codes internes traduits (reseau, trop_de_demandes, ...), heure de validité du code, refus / expiration distincts d une révocation')
// The card's plan row is the ACTIVE team's plan label (what the footer chip says), not the account-level word of the profile: « Plan team » next to a chip that
// said « Solo Studio » was measured right after a pairing.
assert.ok(/label: t\('plan'\), value: \(st\.space_plan !== undefined && st\.space_plan !== null && typeof st\.space_plan\.label === 'string'/.test(clientSource), 'la ligne Plan de la carte lit le libelle de l espace actif avant le mot du compte')
sok('carte : la ligne Plan dit le plan de l espace actif (comme la pastille), le mot du compte seulement en repli')
// The team switcher's list names the personal space the way the card and the chip do (« Personal »), not by the server's name for it (« My workspace »).
assert.ok(clientSource.includes("h('span', { className: 'kbfp-wsname' }, (w && nomAffiche(w, t)) || t('none'))"), 'la liste du selecteur d equipe passe par nomAffiche')
sok('selecteur d equipe : l espace personnel s y appelle Personal / Personnel, comme la pastille')
// The footer chip re-reads the host's /status by itself: after the host signs the device out (a token revoked from the account page) it said
// « Rita Rich · Solo Studio » until the card was opened.
assert.ok(/window\.setInterval\(again, 30000\)[\s\S]{0,200}visibilitychange[\s\S]{0,200}'focus'/.test(clientSource), 'le pied relit /status tout seul (toutes les 30 s, au retour de la fenetre)')
sok('pied de sidebar : la pastille relit /status toute seule (30 s, retour de fenetre), elle ne reste plus connectee apres une revocation')
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

// The bundle puts NO full-frame page in the `main` slot any more: the old local Team page (`SpaceMain`, key `kybernos-cloud-space`) went as unreachable,
// and the profile page (`kybernos-cloud-profile`: Account, Referral, Appearance, Security, Data, Support) went with the five account entries of DSH's
// Settings. The account's pages are the app's own, opened in the browser by the footer menu (the console link).
const mains = registrations.filter((r) => r.options.name === 'main')
assert.deepEqual(mains.map((r) => r.options.key), [], 'no `main` page in the bundle')
ok('slot main : plus aucune page locale (ni profil, ni espace)')

assert.equal(inserted.length, 1)
assert.ok(inserted[0].textContent.includes('.kbc-scrim'), 'le CSS de la carte doit etre injecte')
assert.ok(inserted[0].textContent.includes('.kbf-root'), 'le CSS de la rangee d identite doit etre injecte')
ok('CSS injecte via styles.insert')

// One Settings section of ours: « Kybernos » (what stays on this computer). Neither Account nor Account data, nor anything else of the account.
const settingsSections = registrations.filter((r) => r.options.name === 'settings.section')
assert.deepEqual(settingsSections.map((r) => r.options.id), ['kybernos-local'], 'this bundle registers one Settings section: Kybernos')
assert.equal(settingsSections[0].options.label, 'Kybernos')
ok('une seule section Settings : Kybernos (ce qui reste sur cet ordinateur)')

// ── Rendu réel du composant (React) ─────────────────────────────────────────
// L'état de connexion vient d'un effet fetch : au premier rendu la rangée est
// en phase « lecture » et propose le geste — c'est cette forme-là qu'on mesure
// ici (les deux autres états sont couverts par le CSS et le câblage ci-dessous).
const html = renderToStaticMarkup(React.createElement(registered.component, null))
assert.ok(html.includes('<button'), 'la rangee de pied doit rendre un bouton')
// ONE button, in the place and at the size of the profile row (same card, same chevron): « Sign in / Sign up ». No separate gear: the menu it opens reaches DSH's Settings.
assert.ok(html.includes('kbf-off') && html.includes('data-kb="foot-signin"') && html.includes('kbfp-card') && html.includes('kbfp-chev'), 'le bouton unique de connexion est rendu tant que l etat est inconnu')
assert.equal((html.match(/<button/g) || []).length, 1, 'le pied deconnecte n a qu un seul bouton')
assert.equal(html.includes('kbf-gear'), false, 'plus d engrenage separe dans le pied')
assert.ok(html.includes('aria-haspopup="menu"'), 'le bouton annonce un menu')
assert.ok(html.includes('<svg'), 'icone presente')
// La carte n'est pas ouverte au premier rendu : le scrim ne doit pas exister.
assert.equal(html.includes('kbc-scrim'), false)
ok('rendu React de la rangee de pied sans erreur (CTA + icone)')

// WP-07 (A2-17): the language is what Kybernos resolved. English by default (nothing resolved), French when it says « kybernos » or fr*,
// English for another language: the French dictionary is SERVED (it used to sit behind the English one and never showed).
{
  const row = () => renderToStaticMarkup(React.createElement(registered.component, null))
  assert.ok(html.includes('Sign in') && !html.includes('Se connecter'), 'nothing resolved: English')
  globalThis.window.__KB_LANG_RESOLVE__ = () => 'kybernos'
  const fr = row()
  assert.ok(fr.includes('Se connecter') && fr.includes('Créer un compte') && !fr.includes('Sign in'), 'Kybernos in French: the French dictionary is shown')
  globalThis.window.__KB_LANG_RESOLVE__ = () => 'fr-CA'
  assert.ok(row().includes('Se connecter'), 'a fr* base: French')
  for (const other of ['en', 'es', 'ar', 'zh']) {
    globalThis.window.__KB_LANG_RESOLVE__ = () => other
    assert.ok(row().includes('Sign in') && !row().includes('Se connecter'), other + ': English (no pack, never French)')
  }
  globalThis.window.__KB_LANG_RESOLVE__ = () => { throw new Error('not ready') }
  assert.ok(row().includes('Sign in'), 'a resolver that throws: English')
  delete globalThis.window.__KB_LANG_RESOLVE__
  // the French of the dictionary speaks « tu »; the English uses one verb pair (Sign in / Sign out)
  const dict = readFileSync(join(here, 'client.js'), 'utf8')
  const frBlock = dict.slice(dict.indexOf('    const DICT = {'), dict.indexOf('      en: {', dict.indexOf('    const DICT = {')))
  assert.ok(!/(?<![A-Za-zÀ-ÿ])(vous|votre|vos)(?![A-Za-zÀ-ÿ])/i.test(frBlock), 'the French dictionary says « tu », not « vous »')
  assert.ok(/profLogout: 'Sign out'/.test(dict) && /disconnect: 'Sign out'/.test(dict) && !/'Log out'/.test(dict), 'English: Sign in / Sign out, one verb pair')
  ok('langue : anglais par defaut, francais servi pour Kybernos/fr*, anglais pour toute autre langue; « tu »; Sign in / Sign out')
}

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
for (const cls of ['.kbf-root', '.kbf-avatar', '.kbf-off', '.kbfp-card']) {
  assert.ok(css.includes(cls), 'CSS de la rangee manquant: ' + cls)
}
for (const needle of ["setAttribute('data-kb-cloud'", 'phase === \'connected\' ? \'on\' : \'off\'', 'autoStart']) {
  assert.ok(source.includes(needle), 'cablage de la rangee manquant: ' + needle)
}
// Les libellés de la rangée existent en fr ET en (aucun trou de traduction).
for (const key of ['footHint', 'footConnect', 'footPairing', 'footPairingAction']) {
  assert.equal((source.match(new RegExp(key + ':', 'g')) || []).length, 2, key + ' doit exister en fr ET en')
}
ok('rangee du bas : les 3 formes + etat publie + libelles fr/en')

// The card of the sidebar menu is basic: the e-mail, the plan, the teams and the way out. The models import, the DSH chats and the account memory are not drawn on it
// (they are on the full page), and neither are the name, the device and the session.
{
  const from = source.indexOf("} else if (view.phase === 'connected') {")
  const to = source.indexOf("} else if (view.phase === 'revoked') {", from)
  assert.ok(from > 0 && to > from, 'the connected branch of the card is where the test expects it')
  const card = source.slice(from, to)
  for (const gone of ["t('modelsImport')", "t('chatsTitle')", "t('memoTitle')", "t('device')", "t('session')", "label: t('name')"])
    assert.equal(card.includes(gone), false, 'the card must not draw ' + gone)
  for (const kept of ["label: t('email')", "label: t('plan')", "t('workspaces')", "t('disconnect')"])
    assert.equal(card.includes(kept), true, 'the card must keep ' + kept)
}
ok('carte du menu : e-mail, formule, equipes, deconnexion ; rien d autre')

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
assert.ok(htmlConnecte.includes('kbfp-cardname">Personal<'), 'la carte montre l espace ACTIF (le personnel s affiche Personal)')
assert.ok(htmlConnecte.includes('kbfp-tile') && htmlConnecte.includes('>PE<'), 'tuile d initiales de l espace (celles du nom affiche : Personal, pas My workspace)')
assert.ok(htmlConnecte.includes('dev · Free'), 'sous-titre : qui · formule (partie locale de l email, pas un « — » muet)')
assert.ok(htmlConnecte.includes('aria-haspopup="menu"') && htmlConnecte.includes('aria-expanded="false"'), 'la carte ouvre un menu, ferme au premier rendu')
assert.equal(htmlConnecte.includes('kbfp-menu'), false, 'le menu n est pas rendu tant qu il n est pas ouvert')
assert.equal(htmlConnecte.includes('kbf-wsgear'), false, 'aucun engrenage DANS la rangee du pied')
// The bell is hidden behind ONE flag (SHOW_BELL), not deleted: with the flag off it is not drawn, with the flag on it is the card's last button.
assert.equal(htmlConnecte.includes('title="Notifications"'), false, 'la cloche est cachee (SHOW_BELL = false)')
assert.equal(htmlConnecte.includes('kbfp-bellwrap'), false, 'et son conteneur aussi')
assert.ok(/const SHOW_BELL = false\n/.test(source), 'un seul drapeau : SHOW_BELL')
assert.ok(source.includes("SHOW_BELL === true || notes.length > 0\n                ? h('span', { className: 'kbfp-bellwrap' },"), 'la cloche et son popover sont encore la, derriere le drapeau — et reviennent seuls quand un plugin a publie une note')
// What a plugin publishes (window.__KB_NOTIFY__, kybernos-plugin <kb-notify>) is what the bell lists: with none, it stays hidden.
assert.ok(/window\.__KB_NOTIFY__\.list\(\)/.test(source) && /window\.__KB_NOTIFY__\.subscribe\(/.test(source), 'la cloche lit le magasin de notes et le suit')
assert.ok(/notes\.some\(\(n\) => n\.read !== true\)/.test(source) && /window\.__KB_NOTIFY__\.markRead\(\)/.test(source), 'le point dit « nouveau », ouvrir la cloche marque lu')
assert.ok(/window\.__KB_NOTIFY__\.run\(n\)/.test(source), 'le bouton d une note lance son action par le magasin (jamais une fonction gardee ici)')
ok('carte unifiee : espace actif, qui · formule, menu ferme, aucun engrenage, cloche cachee derriere SHOW_BELL tant qu aucune note')

// The meter of the card: the percent of the allowance that counts in the ACTIVE team, read from the host's /quota route. Nothing is drawn while the host has nothing to
// say (the render above got the status JSON for /quota too: no windows, no meter), and a fresh read of 82% shows a bar, the figure and the sentence as its title.
assert.equal(htmlConnecte.includes('workspace-card-usage'), false, 'sans fenetre de budget : aucun compteur sur la carte')
// The first card's own read of the quota lands after its render: let it settle inside act before the next card is drawn.
await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
racine.unmount()
const statutConnecte = (await globalThis.fetch('/status')).json
let quotaServi = { ok: true, workspace: { id: 'ws-1', name: 'My workspace', role: 'owner', personal: true }, payment_blocked: false, usage: [{ kind: 'member', window_seconds: 86400, scope: 'plan', used_percent: 82, exhausted: false, resets_at: null }] }
let quotaLus = 0
globalThis.fetch = async (url) => {
  if (String(url).includes('/quota')) { quotaLus += 1; return { ok: true, status: 200, json: async () => quotaServi } }
  return { ok: true, status: 200, json: statutConnecte }
}
const racineEl2 = element(doc)
const racine2 = ReactClient.createRoot(racineEl2)
await act(async () => {
  racine2.render(createElement(registered.component, null))
  await new Promise((r) => setTimeout(r, 20))
})
await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
const htmlCompteur = htmlDe(racineEl2)
assert.ok(quotaLus >= 1, 'la carte lit le quota a l hote quand elle apparait')
assert.ok(htmlCompteur.includes('data-kb="workspace-card-usage"') && htmlCompteur.includes('data-percent="82"') && htmlCompteur.includes('data-level="near"'), 'le compteur montre 82 % en ambre')
assert.ok(htmlCompteur.includes('class="kbfp-usepct">82%<'), 'le chiffre est un pourcentage entier')
assert.ok(htmlCompteur.includes('title="82% of your 24 hours allowance is used."'), 'la phrase derriere le compteur est son titre')
assert.equal(/[$\u20ac]|token|_usd/i.test(htmlCompteur.slice(htmlCompteur.indexOf('workspace-card-usage'), htmlCompteur.indexOf('workspace-card-usage') + 400)), false, 'ni montant ni jeton sur la carte')
racine2.unmount()
ok('carte : compteur d usage en pourcentage (lu a l hote, ambre des 75 %, phrase en titre, aucun montant)')


// ── The « Kybernos » section of Settings, rendered for real ─────────────────────────────────────────────────────────────────────────
// Signed out: the instructions are there (read and saved through the host's own file routes, no server involved), the two actions that need a server say so and
// are disabled. Signed in: the models line says what the last import did, the chats line what the last send did, and the buttons run their routes.
{
  const Section = settingsSections[0].component
  const calls = []
  let cloud = { ok: true, connected: false }
  let instructions = { ok: true, present: true, text: 'Be direct.', file: '/home/dev/.dsh/AGENTS.md' }
  const answer = (url, init) => {
    const path = new URL(url, 'http://localhost').pathname.replace(/^.*\/kybernos-cloud/, '')
    const method = init && init.method ? init.method : 'GET'
    calls.push(method + ' ' + path + (init && init.body ? ' ' + init.body : ''))
    if (path === '/status') return cloud
    if (path === '/instructions') return instructions
    if (path === '/instructions/save') return { ok: true, present: true, changed: true, file: instructions.file }
    if (path === '/models/sync') return { ok: true, models: { count: 7, plan: 'free', settings: true } }
    if (path === '/chats/push') return { ok: true, scanned: 3, pushed: 3 }
    return { ok: false, error: 'inconnu' }
  }
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => ({ ok: true, status: 200, json: async () => answer(String(url), init) })
  const root = element(doc)
  const r = ReactClient.createRoot(root)
  await act(async () => { r.render(createElement(Section, null)); await new Promise((res) => setTimeout(res, 30)) })
  let html = htmlDe(root)
  assert.ok(html.includes('data-kb="ky-section"') && html.includes('data-kb="ky-instructions"') && html.includes('data-kb="ky-models"') && html.includes('data-kb="ky-advanced"') && !html.includes('data-kb="ky-chats"'), 'the instructions, the models and a folded Advanced')
  assert.ok(html.includes('Kept on this computer, in /home/dev/.dsh/AGENTS.md'), 'la page dit ou sont gardees les instructions : sur cet ordinateur')
  assert.ok(html.includes('data-kb="ky-signed-out"'), 'deconnecte : les actions qui demandent un serveur le disent')
  const tag = (h, k) => { const i = h.indexOf('data-kb="' + k + '"'); return i < 0 ? '' : h.slice(h.lastIndexOf('<', i), h.indexOf('>', i)) }
  // N-07: the two developer actions (re-import the models, send the DSH chats) are not on the page a newcomer reads: they sit under a folded « Advanced ».
  assert.ok(/aria-expanded="false"/.test(tag(html, 'ky-adv-toggle')) && html.includes('>Advanced<'), 'the server actions are behind a folded Advanced')
  assert.ok(!html.includes('data-kb="ky-models-run"') && !html.includes('data-kb="ky-chats-run"') && !html.includes('Send DSH chats') && !html.includes('Re-import') && !html.includes('Import models'), 'folded: neither Re-import nor Send DSH chats is on screen')
  assert.ok(html.includes('The list updates by itself when your plan or your server changes.'), 'the models update by themselves, and the page says so')
  assert.equal(html.includes('Re-reads the active server'), false, 'the button\'s sentence is not on the page as it opens')
  assert.equal(html.includes('kybernos-account') || html.includes('Referral') || html.includes('Security'), false, 'rien du compte dans la section')
  assert.ok(calls.includes('GET /instructions') && !calls.some((c) => c.startsWith('POST /models/sync') || c.startsWith('POST /chats/push')), 'rien n est envoye a la lecture')
  r.unmount()
  // Unfolded (the page can start open): the two actions, their sentences, and disabled while signed out.
  const rootAdv = element(doc)
  const rAdv = ReactClient.createRoot(rootAdv)
  await act(async () => { rAdv.render(createElement(Section, { advanced: true })); await new Promise((res) => setTimeout(res, 30)) })
  const htmlAdv = htmlDe(rootAdv)
  assert.ok(/aria-expanded="true"/.test(tag(htmlAdv, 'ky-adv-toggle')), 'unfolded: the toggle says so')
  assert.ok(/disabled/.test(tag(htmlAdv, 'ky-models-run')) && /disabled/.test(tag(htmlAdv, 'ky-chats-run')), 'signed out: the server buttons are disabled')
  assert.ok(htmlAdv.includes('Re-reads the active server') && htmlAdv.includes('Import models'), 'unfolded: the models button and what it does')
  assert.ok(htmlAdv.includes('Sends the title and date of your DSH chats (never what is said in them) to your Kybernos account, so they appear in the “DSH conversations” list of the web app. Nothing is sent until you confirm.'), 'unfolded: one sentence says what is sent, why, and that nothing goes without a yes')
  assert.ok(htmlAdv.includes('Send DSH chats') && !htmlAdv.includes('data-kb="ky-chats-confirm"'), 'unfolded: the button is there, the confirmation is not open')
  rAdv.unmount()

  // Signed in: what the last import and the last send did.
  cloud = { ok: true, connected: true, state: { user: { email: 'dev@example.test' }, models: { count: 5, plan: 'free', settings: true, imported_at: '2026-10-14T10:00:00Z' }, chats_last_push: { ok: true, pushed: 2, at: '2026-10-14T11:00:00Z' } } }
  calls.length = 0
  const root2 = element(doc)
  const r2 = ReactClient.createRoot(root2)
  await act(async () => { r2.render(createElement(Section, { advanced: true })); await new Promise((res) => setTimeout(res, 30)) })
  html = htmlDe(root2)
  assert.equal(html.includes('data-kb="ky-signed-out"'), false, 'connecte : aucune note de connexion')
  assert.ok(html.includes('5 models · plan free'), 'le nombre de modeles et la formule du dernier import')
  assert.ok(html.includes('Last send · 2'), 'le dernier envoi des chats')
  assert.ok(html.includes('Re-import'), 'avec des modeles, le bouton dit Re-import')
  assert.ok(!/disabled/.test(tag(html, 'ky-models-run')) && !/disabled/.test(tag(html, 'ky-chats-run')), 'signed in: both buttons are active')
  r2.unmount()
  // Folded, signed in: the models line is still the page's, and neither action is.
  const root3 = element(doc)
  const r3 = ReactClient.createRoot(root3)
  await act(async () => { r3.render(createElement(Section, null)); await new Promise((res) => setTimeout(res, 30)) })
  html = htmlDe(root3)
  assert.ok(html.includes('5 models · plan free') && !html.includes('Last send') && !html.includes('data-kb="ky-chats-run"') && !html.includes('Re-import'), 'folded: the models line stays, no action')
  r3.unmount()
  globalThis.fetch = realFetch
}
ok('section Kybernos : instructions lues sur l hote, deconnecte (actions serveur desactivees et dites) puis connecte (dernier import, dernier envoi)')

// « Teams settings » is a NAMED entry of the account menu. It opens the app's plan page for the active team in the person's browser, signed in (the console link,
// asked of the host, which opens the system browser). No frame, no bridge to the core, no local page.
assert.ok(source.includes("entree('space-settings', h(BuildingIcon, { size: 18 }), t('menuTeamsSettings'), props.onSpace)"),
  'le menu doit porter une entree nommee pour les reglages de la team')
assert.ok(source.includes("onSpace: ouvrirAppli('plan')"), 'Teams settings ouvre la page du plan dans le navigateur')
for (const needle of ['window.__kbOpenWsConsole', 'window.__kbOpenWorkspace']) {
  assert.ok(!source.includes(needle), 'l entree Teams settings ne passe plus par un pont du coeur: ' + needle)
}
assert.equal((source.match(/menuTeamsSettings:/g) || []).length, 2, 'menuTeamsSettings doit exister en fr ET en')
ok('Teams settings : entree nommee du menu, ouvre le plan de l equipe dans le navigateur (lien de console), fr/en')


// Wiring that stays: the switcher (the list of teams, the choice route, the event another plugin can send) and the hosted-page link.
for (const needle of [
  "callLocal('/space/active', 'POST'",
  "'kybernos-cloud:switch'",
  "t('spaceUnknown')",
]) {
  assert.ok(source.includes(needle), 'cablage du selecteur d equipe manquant: ' + needle)
}
ok('selecteur d equipe : route du choix, evenement d ouverture, message d equipe inconnue')

console.log('\n' + pass + ' verifications OK')
