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
  // V1-05 (video review): the space name is drawn at least twice (footer card, menu head) and CSS ellipsises it; with no
  // title a long name was unreadable in both places (measured live: title and aria-label empty).
  assert.ok(/className: 'kbfp-cardname', title: nomEspace \}/.test(clientSource) && /className: 'kbfp-mheadname', title: vueEspace\.name \}/.test(clientSource), 'le nom de l espace porte son infobulle là où le CSS le coupe (V1-05)')
assert.ok(clientSource.includes("onAccount: ouvrirAppli('overview')") && clientSource.includes("onReferral: ouvrirAppli('referral')"), 'Account ouvre la vue d ensemble et Referral sa propre page (2026-10-18), dans le navigateur')
// « Phone and channels » (decision of 2026-10-19): ONE entry of the connected menu, just before « Settings », that opens kybernos-mobile's window (the phone link on the left,
// Kaby's messaging apps on the right). It replaced « Remote control », its popover (MobilePanel, with its fake QR code) and the 60-second poll of the phone link's status the
// old entry needed to decide whether to show itself: the window says by itself what this server and this plan allow. The window draws itself in a root of its own
// (`window.__KB_MOBILE__.open()`): this footer mounts nothing (a window drawn inside the footer slides away with a phone's drawer, which moves with a transform).
{
  // V1-07 (video review): the menu was one block mixing three families, and the entries that OPEN THE SERVER'S CONSOLE
  // (Account, Referral, Team settings) had no arrow while Upgrade/Website/Help did. Now: three blocks in that order
  // (account · appearance · console), the console block keeping « Phone and channels » right before « Settings ».
  assert.ok(
    clientSource.indexOf("'data-kb': 'menu-block-account'") > 0 &&
    clientSource.indexOf("'data-kb': 'menu-block-account'") < clientSource.indexOf("'data-kb': 'menu-block-appearance'") &&
    clientSource.indexOf("'data-kb': 'menu-block-appearance'") < clientSource.indexOf("'data-kb': 'menu-block-console'") &&
    /'data-kb': 'menu-block-console'[\s\S]{0,900}?entree\('phone'[\s\S]{0,420}?entree\('settings'/.test(clientSource),
    'trois blocs (compte · apparence · console), « Phone and channels » juste avant Settings')
  assert.ok(/entree\('account'[^\n]*props\.onAccount, \{ ext: true \}\)/.test(clientSource) && /entree\('referral'[^\n]*props\.onReferral, \{ amber: true, ext: true \}\)/.test(clientSource) && /entree\('space-settings'[^\n]*props\.onSpace, \{ ext: true \}\)/.test(clientSource), 'les entrées qui ouvrent la console web portent la flèche, comme Upgrade (V1-07)')
  assert.ok(/menuPhone: 'Phone and channels'/.test(clientSource) && /menuPhone: 'Téléphone et canaux'/.test(clientSource), 'fr/en')
  assert.ok(!/MobilePanel|menuRemote|menu-remote|remoteOffer|kbf-qr|kbf-popcenter|mobTitle|mobScan|mobSoon|mobHelp|setMobileOpen|mobileOpen|\\bphoneOpen\\b|setPhoneOpen|phoneDialog/.test(clientSource), 'plus de panneau telephone, de faux QR code, de sondage du statut du lien, ni de fenetre montee dans le pied')
  assert.ok(!clientSource.includes("'kybernos-mobile/remote/status'"), 'le pied ne lit plus le statut du lien telephone : la fenetre le dit elle-meme')
  assert.ok(/phone: phoneOpener\(\) !== null,\s*onPhone: \(\) => \{ setMenuOpen\(false\); setNotifOpen\(false\); const open = phoneOpener\(\); if \(open !== null\) open\(\) \}/.test(clientSource), 'le menu se ferme et demande la fenetre quand le paquet qui la dessine est la')
  assert.ok(/const ouvrirServeurs = \(\) => \{ setMenuOpen\(false\); setNotifOpen\(false\); openServersPage\(\) \}/.test(clientSource), 'Switch server ouvre Settings › Servers')
  const m = clientSource.match(/const phoneOpener = \(\) => \{[\s\S]*?\n        \}\n/)
  assert.ok(m !== null, 'phoneOpener est la ou le test l attend')
  const phoneOpener = (win) => new Function('window', 'return ' + m[0].replace('const phoneOpener = ', '').trim())(win)()
  const asked = []
  const open = phoneOpener({ __KB_MOBILE__: { version: 3, open () { asked.push('open'); return true } } })
  assert.equal(typeof open, 'function', 'the bundle publishes open: the entry is offered')
  open()
  assert.deepEqual(asked, ['open'], 'and it asks that bundle for the window')
  for (const none of [{}, { __KB_MOBILE__: null }, { __KB_MOBILE__: { version: 2, Dialog () {} } }, { __KB_MOBILE__: { open: 'x' } }])
    assert.equal(phoneOpener(none), null, 'no window to open, no entry: ' + JSON.stringify(none))
  assert.equal(phoneOpener({ get __KB_MOBILE__ () { throw new Error('frozen') } }), null, 'a seam that throws offers nothing')
  sok('Phone and channels : une entree avant Settings, qui demande sa fenetre a kybernos-mobile (open) quand elle existe ; le pied ne monte plus rien, plus de panneau telephone ni de sondage')
}
// A1-29: both footer menus (signed out, and the profile's) work with the keyboard. The focus moves INTO the menu when it opens, ArrowUp/ArrowDown (round the ends), Home and
// End move between its buttons, Tab and Escape close it and give the focus back to the button that opened it. The signed-out menu is a portal on <body> (the last thing the
// Tab order reaches), so without this a keyboard user cannot reach Sign in, Settings or Help from the footer.
{
  const m = clientSource.match(/\/\/ <menu-keys:begin>[\s\S]*?\/\/ <menu-keys:end>/)
  assert.ok(m !== null, 'the keyboard contract of the footer menus is a marked block')
  const menuTarget = new Function(m[0] + '\nreturn menuTarget')()
  assert.equal(menuTarget('ArrowDown', 5, -1), 0, 'ArrowDown from the trigger enters on the first item')
  assert.equal(menuTarget('ArrowDown', 5, 0), 1)
  assert.equal(menuTarget('ArrowDown', 5, 4), 0, 'ArrowDown on the last item wraps to the first')
  assert.equal(menuTarget('ArrowUp', 5, 3), 2)
  assert.equal(menuTarget('ArrowUp', 5, 0), 4, 'ArrowUp on the first item wraps to the last')
  assert.equal(menuTarget('ArrowUp', 5, -1), 4, 'ArrowUp from the trigger enters on the last item')
  assert.equal(menuTarget('Home', 5, 3), 0)
  assert.equal(menuTarget('End', 5, 1), 4)
  for (const k of ['Enter', ' ', 'a', 'Tab', 'Escape', 'ArrowLeft', 'PageDown']) assert.equal(menuTarget(k, 5, 2), -1, k + ' moves nothing here')
  assert.equal(menuTarget('ArrowDown', 0, -1), -1, 'an empty menu moves nothing')
  assert.equal(menuTarget('End', 1, 0), 0)
  for (const [name, from] of [['OffMenu', 'const OffMenu = '], ['UserMenu', 'const UserMenu = ']]) {
    const i = clientSource.indexOf(from)
    assert.ok(i > 0, name + ' is there')
    const body = clientSource.slice(i, clientSource.indexOf('\n        const ', i + 60))
    assert.ok(/onKeyDown: menuKeyDown\(/.test(body), name + ': the menu element handles the arrow keys')
    assert.ok(/focusFirstItem\(/.test(body), name + ': the focus moves into the menu when it opens')
    assert.ok(/focusTrigger\(props\.toggleRef\)/.test(body), name + ': Escape gives the focus back to the button that opened the menu')
  }
  assert.ok(/toggleRef: cardRef/.test(clientSource) && /ref: cardRef/.test(clientSource), 'the profile menu knows its button')
  sok('menus du pied : le focus entre dans le menu, fleches/Home/End, Tab et Echap le ferment et rendent le focus au bouton')
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
assert.ok(clientSource.includes('espaceActifVue(state, t)') && clientSource.includes('espaceVue(w, t)') && clientSource.includes('const nomAffiche = (w, t) =>'), 'la carte et la liste affichent le nom via la meme source (espaceVue -> nomAffiche), avec le traducteur de l appelant (Personal pour l espace personnel)')
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
assert.ok(/label: t\('plan'\), value: \(st\.space_plan !== undefined && st\.space_plan !== null && st\.space_plan\.key === 'none' \? t\('planNone'\) : null\) \|\| \(st\.space_plan !== undefined && st\.space_plan !== null && typeof st\.space_plan\.label === 'string'/.test(clientSource), 'la ligne Plan de la carte lit le libelle de l espace actif avant le mot du compte (et dit « No plan » pour une equipe sans formule)')
sok('carte : la ligne Plan dit le plan de l espace actif (comme la pastille), le mot du compte seulement en repli')
// The team switcher's list names the personal space the way the card and the chip do (« Personal »), not by the server's name for it (« My workspace »).
// The rows of the list are built by spaceRowOf (pure, test-teams-menu.mjs plays it): its name and initials come from espaceVue, and the list draws exactly those.
assert.ok(/const spaceRowOf = [\s\S]{0,400}const view = espaceVue\(w, t\)/.test(clientSource) && clientSource.includes("h('span', { className: 'kbfp-wsname' }, r.name || t('none'))"), 'la liste du selecteur d equipe passe par espaceVue (nom et initiales de la meme source)')
sok('selecteur d equipe : l espace personnel s y appelle Personal / Personnel, comme la pastille')
// The footer chip re-reads the host's /status by itself: after the host signs the device out (a token revoked from the account page) it said
// « Rita Rich · Solo Studio » until the card was opened.
for (const key of ['spaceBusy', 'spaceBusyAny', 'followMismatch', 'wsNewBusy']) assert.equal((clientSource.match(new RegExp('^\\s+' + key + ':', 'gm')) || []).length, 2, key + ' exists in both locale blocks (fr, en)')
assert.ok(/callLocal\('\/space\/busy', 'GET'\)/.test(clientSource), 'la page demande a l\'hote si une reponse tourne (space/busy) pour ne changer d\'equipe qu\'a la fin')
assert.ok(/window\.setInterval\(again, 30000\)[\s\S]{0,200}visibilitychange[\s\S]{0,200}'focus'/.test(clientSource), 'le pied relit /status tout seul (toutes les 30 s, au retour de la fenetre)')
sok('pied de sidebar : la pastille relit /status toute seule (30 s, retour de fenetre), elle ne reste plus connectee apres une revocation')
console.log('  ' + staticPass + ' verifications statiques OK')

let React = null
let renderToStaticMarkup = null
try {
  React = require('react')
  renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup
} catch (e) {
  // A skip is never a pass: only the static checks above ran, the rendered footer and team switcher were not covered.
  console.log('SKIPPED: the rendered part of the cloud client (footer chip, team switcher) — react / react-dom not found. Re-run with:')
  console.log('  NODE_PATH=<a node_modules that has react + react-dom> node ' + join('kybernos-cloud', 'test-cloud-client.mjs'))
  console.log('\nkybernos-cloud client — ' + staticPass + ' static checks OK, the rendered part SKIPPED')
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
// DSH's own services the footer reaches on a team switch (step 6): a scene sets them, they are absent otherwise.
const dshFake = { workspaces: undefined, uiWorkspace: undefined }
const ctx = {
  get: (name) => (name === 'slots' ? slots : (name === 'workspaces' ? dshFake.workspaces : (name === 'uiWorkspace' ? dshFake.uiWorkspace : undefined))),
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
for (const cls of ['.kbf-root', '.kbf-off', '.kbfp-card']) {
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
assert.ok(htmlConnecte.includes('kbfp-cardname" title="Personal">Personal<'), 'la carte montre l espace ACTIF (le personnel s affiche Personal)')
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
assert.equal(htmlCompteur.includes('workspace-card-usage'), false, 'un espace personnel ne dessine aucune jauge sur la carte, meme quand l hote donne 82 % : c est le quota de l offre Kybernos, que la puce du compositeur montre sur un modele Kybernos')
racine2.unmount()
ok('carte : l espace personnel n a plus de jauge de quota (lu a l hote, mais jamais dessine) ; l equipe garde son compteur (voir la carte du plan par role)')


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
  // ux: the sentence no longer shows the file's path (a person reads "Kept on this computer"); the path is the tooltip of that line.
  assert.ok(html.includes('Kept on this computer: every agent reads them, in new chats.') && !/Kept on this computer, in /.test(html) && html.includes('title="/home/dev/.dsh/AGENTS.md"'), 'la page dit ou sont gardees les instructions : sur cet ordinateur, le chemin en infobulle')
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
assert.ok(source.includes("entree('space-settings', h(BuildingIcon, { size: 18 }), t('menuTeamsSettings'), props.onSpace, { ext: true })"),
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

// ── The account state, as the footer shows it (2026-10-18 account campaign: AC-01, AC-02, AC-09, AC-15, AC-17) ──────────────────────────────────────────────
// AC-15: ONE source for how a workspace looks (the name a person sees and its initials), and for how its plan reads. The block is cut out of client.js and played alone.
{
  const m = source.match(/\/\/ <space-face:begin>[\s\S]*?\/\/ <space-face:end>/)
  assert.ok(m !== null, 'the workspace face is a marked block')
  const face = new Function(m[0] + '\nreturn { espaceVue, espaceActifVue, planDeEspace, planNameOf, initiales }')()
  const dict = { wsPersonal: 'Personal', spaceTitle: 'Team', planNone: 'No plan', none: '—' }
  const t = (k) => dict[k] !== undefined ? dict[k] : k
  const personal = { id: 'p', name: 'My workspace', personal: true }
  const team = { id: 'x', name: 'Acme Crew', personal: false }
  assert.deepEqual(face.espaceVue(personal, t), { name: 'Personal', initials: 'PE' }, 'the personal workspace is « Personal » and PE wherever it is drawn')
  assert.deepEqual(face.espaceVue({ id: 'p', name: 'My workspace' }, t), { name: 'Personal', initials: 'PE' }, 'the server\'s own name for it is enough (no `personal` flag): the same face')
  assert.deepEqual(face.espaceVue(team, t), { name: 'Acme Crew', initials: 'AC' })
  assert.deepEqual(face.espaceActifVue({ workspaces: [personal, team], active_workspace_id: 'x' }, t), { name: 'Acme Crew', initials: 'AC' }, 'the active workspace is read the same way')
  assert.deepEqual(face.espaceActifVue({ workspaces: [personal, team] }, t), { name: 'Personal', initials: 'PE' }, 'none chosen: the first, the same face')
  assert.deepEqual(face.espaceActifVue({ workspaces: [] }, t), { name: 'Team', initials: 'TE' }, 'no workspace known: « Team »')
  // The old call sites that cut the initials from the server's raw name (the list said MW next to a card that said PE) must not come back.
  assert.equal(/initiales\(w && w\.name/.test(source), false, 'no list cuts initials from the raw name')
  assert.equal((source.match(/initiales\(/g) || []).length, 2, 'initiales() is called by the one source only (espaceVue, and the « Team » fallback of espaceActifVue)')
  // The plan slot: a team with no plan says so (it is neither « Free » nor an unknown « — »).
  assert.equal(face.planNameOf({ space_plan: { key: 'none', label: null } }, { plan: 'free' }, t), 'No plan', 'no plan at all: said, not « — » and not the account\'s « free »')
  assert.equal(face.planDeEspace({ space_plan: { key: 'none', label: null } }, {}).none, true)
  assert.equal(face.planDeEspace({ space_plan: { key: 'free', label: 'Free' } }, {}).none, false)
  assert.equal(face.planNameOf({ space_plan: { key: 'free', label: 'Free' } }, {}, t), 'Free')
  assert.equal(face.planNameOf({ space_plan: { key: 'solo', label: 'solo Studio' } }, {}, t), 'Solo Studio')
  assert.equal(face.planNameOf({}, {}, t), '—', 'unknown stays « — »')
  assert.equal(face.planNameOf({}, { plan: 'team' }, t), 'Team', 'no read of the space: the account\'s word, as before')
  ok('one source for a workspace\'s name and initials (Personal/PE in the card, the menu and both lists) and for its plan (« No plan » for a team without one)')
}

// AC-09 / AC-02 wiring that needs a click to see: the dialog has its heading and what a team is, the plan slot offers « Choose a plan » on the plan page.
{
  const i = source.indexOf('const NewSpacePanel = ')
  const panel = source.slice(i, source.indexOf('// ── THE MOBILE APP', i))
  assert.ok(/className: 'kbc-head'[\s\S]*className: 'kbc-title'[\s\S]*className: 'kbc-x'/.test(panel), 'the dialog has the card\'s own header: the title, then the cross (the title used to run under a bare button)')
  assert.ok(panel.includes("t('wsNewIntro')") && panel.includes("'data-kb': 'new-team-intro'"), 'and one sentence on what a team is and that it starts without a plan')
  assert.ok(panel.includes('props.onCreated(res)'), 'the answer of the host reaches the footer, which tells the person what happened')
  assert.equal(/kbc-close|kbws-head|kbws-who/.test(source), false, 'the bare button and its two styles are gone')
  assert.ok(/if \(id === 'choose'\) return h\('button'[^\n]*'data-plan': 'none'[^\n]*closeThen\(props\.onUpgradePage\)[^\n]*t\('planChoose'\)/.test(source), 'the menu\'s plan card offers « Choose a plan » for a team without a plan, on the plan page')
  assert.ok(/flashAct !== null && flashAct\.for === flash/.test(source) && /const announceCreated = /.test(source), 'a team created without a plan is announced, with its plan page one press away')
  for (const k of ['wsNewIntro', 'wsNewNoPlan', 'planNone', 'planChoose', 'quotaNoPlan', 'quotaNoPlanAdmin', 'quotaNoPlanMember', 'sessionEnded', 'footSignInAgain', 'footEnded', 'footPairDenied', 'footPairExpired'])
    assert.ok(frKeys.has(k) && enKeys.has(k), 'missing in fr or en: ' + k)
  assert.equal((source.match(/callLocal\('\/console\/link'/g) || []).length, 2, 'still two call sites of the console link: « Choose a plan » goes through them')
  ok('create dialog: heading, cross, what a team is; plan slot: « Choose a plan »; a plan-less team is announced; fr/en')
}

// AC-01: a connection the server ended. The host's /status says `revoked` and the row says « Sign in again » and why, instead of the first-time words.
{
  const intervals = []
  const realSetInterval = globalThis.window.setInterval
  globalThis.window.setInterval = (fn, ms) => { intervals.push({ fn, ms }); return intervals.length }
  // The notices go by themselves after a few seconds: they need real timers here.
  globalThis.window.setTimeout = setTimeout
  globalThis.window.clearTimeout = clearTimeout
  const calls = []
  let status = { ok: true, connected: false, status: 'revoked', ended: { at: '2026-10-18T10:00:00.000Z' } }
  let quota = { ok: false, error: 'indisponible' }
  let poll = { ok: true, connected: false, status: 'pending' }
  globalThis.fetch = async (url, init) => {
    const path = new URL(String(url), 'http://localhost').pathname.replace(/^.*\/kybernos-cloud/, '')
    calls.push((init && init.method ? init.method : 'GET') + ' ' + path)
    const json = path === '/status' ? status : path === '/quota' ? quota : path === '/poll' ? poll : { ok: false }
    return { ok: true, status: 200, json: async () => json }
  }
  const draw = async (wait = 20) => {
    const el = element(doc)
    const root = ReactClient.createRoot(el)
    await act(async () => { root.render(createElement(registered.component, null)); await new Promise((r) => setTimeout(r, wait)) })
    await act(async () => { await new Promise((r) => setTimeout(r, wait)) })
    return { el, root }
  }

  // 1. Ended: « Sign in again », and the sentence that says why, in the row's own line.
  {
    const { el, root } = await draw()
    const html = htmlDe(el)
    assert.ok(html.includes('data-kb="foot-signin"') && html.includes('>Sign in again<'), 'an ended connection reads « Sign in again »: ' + html.slice(0, 400))
    assert.ok(html.includes('data-kb="foot-ended"') && html.includes('>Your session ended<'), 'with the sentence that says the session was ended')
    assert.equal(html.includes('Sign in / Sign up'), false, 'not the first-time words')
    root.unmount()
    status = { ok: true, connected: false, status: 'none' }
    const plain = await draw()
    assert.ok(htmlDe(plain.el).includes('Sign in / Sign up') && !htmlDe(plain.el).includes('Sign in again'), 'never connected: the first-time words, as before')
    plain.root.unmount()
    ok('footer: a connection the server ended says « Sign in again » and « Your session ended » (the first-time words only when nobody was ever connected)')
  }

  // 2. Connected, then the quota read (the footer's own, on mount) finds the session ended: the row flips at once, with a notice, without waiting for the 30-second read.
  {
    const connected = { ok: true, connected: true, state: { user: { email: 'dev@example.test', plan: 'free' }, workspaces: [{ id: 'ws-1', name: 'My workspace', personal: true }], active_workspace_id: 'ws-1', space_plan: { key: 'free', label: 'Free', workspace_id: 'ws-1' } } }
    status = connected
    const gone = { ok: true, connected: false, status: 'revoked', ended: { at: '2026-10-18T10:00:00.000Z' } }
    globalThis.fetch = async (url, init) => {
      const path = new URL(String(url), 'http://localhost').pathname.replace(/^.*\/kybernos-cloud/, '')
      calls.push((init && init.method ? init.method : 'GET') + ' ' + path)
      if (path === '/quota') { status = gone; return { ok: true, status: 200, json: async () => ({ ok: false, connected: false, status: 'revoked', error: 'session_ended' }) } }
      return { ok: true, status: 200, json: async () => (path === '/status' ? status : { ok: false }) }
    }
    calls.length = 0
    const { el, root } = await draw(40)
    const html = htmlDe(el)
    assert.ok(calls.includes('GET /quota'), 'the footer reads the quota when it appears')
    assert.ok(html.includes('>Sign in again<'), 'the quota answer « revoked » flips the row at once: ' + html.slice(0, 300))
    assert.ok(html.includes('data-kb="foot-flash"') && html.includes('class="kbfp-flashtext">Your session ended: the server no longer recognises this device.'), 'and a notice says why (the row changed while the person looked elsewhere)')
    root.unmount()
    ok('footer: a quota read that finds the session ended flips the row to « Sign in again » at once, with the reason in a notice')
  }

  // 3. A pairing under way is asked about by the footer itself: a refusal or an expiry is said where the person looks.
  {
    for (const [verdict, short, long] of [['denied', 'Connection refused', 'The connection was refused in the browser.'], ['expired', 'Code expired', 'The code expired before it was confirmed.']]) {
      intervals.length = 0
      status = { ok: true, connected: false, status: 'pending', pairing: { user_code: 'ABC234', activation_url: 'http://127.0.0.1/a', expires_at: '2026-10-18T10:10:00.000Z' } }
      poll = { ok: true, connected: false, status: 'pending' }
      globalThis.fetch = async (url, init) => {
        const path = new URL(String(url), 'http://localhost').pathname.replace(/^.*\/kybernos-cloud/, '')
        calls.push((init && init.method ? init.method : 'GET') + ' ' + path)
        if (path === '/poll') { const out = poll; if (poll.status === verdict) status = { ok: true, connected: false, status: 'none' }; return { ok: true, status: 200, json: async () => out } }
        return { ok: true, status: 200, json: async () => (path === '/status' ? status : { ok: false }) }
      }
      calls.length = 0
      const { el, root } = await draw()
      assert.ok(htmlDe(el).includes('>Pairing in progress<'), 'a pending pairing: the row says so')
      const ask = intervals.filter((i) => i.ms === 3000)
      assert.equal(ask.length, 1, 'the footer asks about the pairing every few seconds (one timer)')
      await act(async () => { await ask[0].fn() })
      assert.ok(calls.includes('POST /poll'), 'by the host\'s poll route')
      poll = { ok: true, connected: false, status: verdict }
      await act(async () => { await ask[0].fn(); await new Promise((r) => setTimeout(r, 20)) })
      await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
      const html = htmlDe(el)
      assert.ok(html.includes('data-kb="foot-flash"') && html.includes('class="kbfp-flashtext">' + long), verdict + ': a notice says it (' + long + ')')
      assert.ok(html.includes('data-kb="foot-pair-note"') && html.includes(short), verdict + ': and the row keeps a short line until the person tries again')
      assert.ok(html.includes('>Sign in / Sign up<'), 'the row is the signed-out one again (a refused pairing is not an ended session)')
      root.unmount()
    }
    ok('footer: a pairing that ends refused or expired is said in a notice and in the row, without the card being open')
  }
  globalThis.window.setInterval = realSetInterval
}

// ── The failure row of a turn: AC-01 (« no adapter registered ») and AC-02 (« Request quota exhausted » of a team without a plan) ──────────────────────────
// The engine's keyed slot `conversation.chat.node`, key `turn-error`: the plugin wraps the SHIPPED row (found in the slot's entries, registered at the lowest priority so that it
// renders, with the shipped entry's own locale so the shipped row still gets its translator). Every other failure is drawn by the shipped component, untouched.
{
  const list = []
  const subscribers = []
  const registrations = []
  let disposeInject = null
  const slotsRow = {
    inject: (name, cb) => { const d = cb(); if (name === 'conversation.chat.node') disposeInject = d; return () => {} },
    register: (options, component) => { registrations.push({ options, component }); list.unshift({ options: { key: options.key, priority: options.priority }, component, locale: options.locale }); return () => { const i = list.findIndex((e) => e.component === component); if (i >= 0) list.splice(i, 1) } },
    entries: (name) => (name === 'conversation.chat.node' ? list.slice() : []),
    subscribe: (name, fn) => { subscribers.push(fn); return () => { const i = subscribers.indexOf(fn); if (i >= 0) subscribers.splice(i, 1) } },
  }
  const seen = []
  const Shipped = (props) => { seen.push(props); return createElement('div', { className: 'shipped-row' }, String(props.node.data.code) + '|' + String(props.node.data.message)) }
  const pluginRow = captured.def.factory(require)
  // Only the failure row's own effect runs here (the other effects mount styles and footers that this fake DOM does not draw).
  pluginRow.apply({ get: (name) => (name === 'slots' ? slotsRow : undefined), effect: (fn, label) => { if (/failure row of a turn/.test(String(label))) void fn() } })
  const nodeRegistrations = () => registrations.filter((r) => r.options.name === 'conversation.chat.node')
  assert.equal(nodeRegistrations().length, 0, 'the shipped row is not there yet: nothing is registered (and nothing broke)')
  list.push({ options: { key: 'turn-error' }, component: Shipped, locale: 'chat-ns' })
  for (const fn of subscribers.slice()) fn()
  assert.equal(nodeRegistrations().length, 1, 'once the shipped row is registered, it is wrapped')
  assert.deepEqual(nodeRegistrations()[0].options, { name: 'conversation.chat.node', key: 'turn-error', priority: -1, locale: 'chat-ns' }, 'same key, the lowest priority (it renders), the shipped entry\'s own locale')
  for (const fn of subscribers.slice()) fn()
  assert.equal(nodeRegistrations().length, 1, 'wrapped once, however often the slot changes')
  const Row = nodeRegistrations()[0].component
  const events = []
  const realDispatch = globalThis.window.dispatchEvent
  globalThis.window.dispatchEvent = (ev) => { events.push(ev.type + (ev.detail ? ':' + JSON.stringify(ev.detail) : '')); return true }
  const draw = async (props, quota) => {
    seen.length = 0
    globalThis.fetch = async (url) => ({ ok: true, status: 200, json: async () => (String(url).includes('/quota') ? quota : { ok: false }) })
    const el = element(doc)
    const root = ReactClient.createRoot(el)
    await act(async () => { root.render(createElement(Row, props)); await new Promise((r) => setTimeout(r, 20)) })
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    return { el, root, html: htmlDe(el) }
  }
  const T = () => 'translated'
  const node = (data) => ({ key: 'n1', kind: 'turn-error', data })

  // 1. The cloud models are gone: a sentence and the way back, in the shipped row (its title and look), with no engine code beside it.
  {
    const a = await draw({ node: node({ code: 'UNKNOWN', message: 'no adapter registered for provider "kybernos"' }), t: T }, { ok: false })
    assert.equal(seen.length, 1)
    assert.equal(seen[0].node.data.message, 'This model comes from your Kybernos account, and this DSH is not signed in to it any more. Sign in again to use it.')
    assert.equal(seen[0].node.data.code, undefined, 'no engine code next to our sentence')
    assert.equal(seen[0].t, T, 'the shipped row gets its own translator, as it was handed it')
    assert.ok(a.html.includes('data-kb="turn-error-action"') && a.html.includes('>Sign in again<'), 'the action is beside it')
    a.root.unmount()
  }
  // 2. Any other failure: the shipped row, with the very props it was given, and no action of ours.
  {
    const props = { node: node({ code: 'AUTH', message: 'API key is invalid' }), t: T, extra: 7 }
    const b = await draw(props, { ok: false })
    assert.ok(seen[0].node === props.node && seen[0].t === T && seen[0].extra === 7, 'the same props, node included')
    assert.ok(b.html.includes('shipped-row') && !b.html.includes('turn-error-action'), 'nothing of ours around it')
    b.root.unmount()
  }
  // 3. QUOTA on a team with no plan: the sentence and « Choose a plan » (which asks the footer for the plan page, with the team's id).
  {
    const c = await draw({ node: node({ code: 'QUOTA', message: 'Request quota exhausted.' }), t: T }, { ok: true, no_plan: true, payment_blocked: false, usage: [], workspace: { id: 'ws-9', name: 'Alpha crew', role: 'owner', personal: false } })
    assert.equal(seen[seen.length - 1].node.data.message, 'Alpha crew has no plan yet, so nobody in it can use the models. Choose a plan to turn them on.')
    assert.equal(seen[seen.length - 1].node.data.code, undefined)
    assert.ok(c.html.includes('>Choose a plan<'), 'with its action')
    // the button asks the footer (no new call of the console link from here)
    const idx = seen.length
    c.root.unmount()
    assert.ok(idx >= 1)
    // A plain member is told who to ask, with no button of their own.
    const m = await draw({ node: node({ code: 'QUOTA', message: 'Request quota exhausted.' }), t: T }, { ok: true, no_plan: true, payment_blocked: false, usage: [], workspace: { id: 'ws-9', name: 'Alpha crew', role: 'member', personal: false } })
    assert.ok(seen[seen.length - 1].node.data.message.includes('Ask an owner or admin of Alpha crew to choose one.') && !m.html.includes('turn-error-action'), 'a member: who to ask, no button')
    m.root.unmount()
  }
  // 4. QUOTA for any other reason (a window used up, a failed payment, facts that did not come): the engine's own words, untouched.
  {
    const props = { node: node({ code: 'QUOTA', message: 'Request quota exhausted.' }), t: T }
    for (const facts of [{ ok: true, no_plan: false, payment_blocked: false, usage: [{ kind: 'member', window_seconds: 18000, scope: 'plan', used_percent: 100, exhausted: true, resets_at: null }], workspace: { id: 'w', name: 'Acme', role: 'owner', personal: false } }, { ok: false, error: 'indisponible' }, { ok: false, status: 'revoked' }]) {
      const d = await draw(props, facts)
      assert.ok(seen[seen.length - 1].node === props.node && seen[seen.length - 1].t === T, 'untouched for ' + JSON.stringify(facts).slice(0, 60))
      assert.ok(!d.html.includes('turn-error-action'))
      d.root.unmount()
    }
  }
  // 5. The slot's owner goes away (or the plugin is unloaded): the wrapper is withdrawn, the shipped row alone is left.
  assert.ok(typeof disposeInject === 'function', 'the registration is disposable')
  disposeInject()
  assert.equal(list.some((e) => e.component === Row), false, 'withdrawn')
  assert.equal(subscribers.length, 0, 'and it stops listening')
  globalThis.window.dispatchEvent = realDispatch
  // The footer owns the console link: the row's « Choose a plan » reaches it through a window event, and there is still no third call site.
  assert.ok(/addEventListener\('kybernos-cloud:plan'/.test(source) && /openAccountPage\('plan', id\)/.test(source), 'the footer opens the plan page on the row\'s request')
  assert.equal((source.match(/callLocal\('\/console\/link'/g) || []).length, 2, 'still two call sites of the console link')
  ok('failure row of a turn: « no adapter registered » and a plan-less team get a sentence and an action in the shipped row; every other failure is the shipped row untouched; withdrawn with the plugin')
}

// ── The retry row of a turn: while the account server is down a chat showed only the engine's « Retrying model request (5/5) » ─────────────────────────────────
// The engine's keyed slot `conversation.chat.node`, key `model-retry`, is reachable the same way as the failure row: the plugin wraps the SHIPPED row, and only when the model
// route is Kybernos's, the attempt is waiting, and the host (its quota read, the footer's own) says the account server does not answer. The row keeps its look, its countdown and its
// details; its label names the server and says that DSH keeps trying, and « Switch server » is beside it when the registry names another server.
{
  const list = []
  const subscribers = []
  const registrations = []
  let disposeRetry = null
  const slotsRetry = {
    inject: (name, cb) => { const d = cb(); if (name === 'conversation.chat.node') disposeRetry = d; return () => {} },
    register: (options, component) => { registrations.push({ options, component }); list.unshift({ options: { key: options.key, priority: options.priority }, component, locale: options.locale }); return () => { const i = list.findIndex((e) => e.component === component); if (i >= 0) list.splice(i, 1) } },
    entries: (name) => (name === 'conversation.chat.node' ? list.slice() : []),
    subscribe: (name, fn) => { subscribers.push(fn); return () => { const i = subscribers.indexOf(fn); if (i >= 0) subscribers.splice(i, 1) } },
  }
  const seen = []
  const Shipped = (props) => { seen.push(props); return createElement('div', { className: 'shipped-retry' }, String(props.t('message.retry.active')) + '|' + String(props.t('message.retry.status', { retry: 5 }))) }
  const pluginRetry = captured.def.factory(require)
  pluginRetry.apply({ get: (name) => (name === 'slots' ? slotsRetry : undefined), effect: (fn, label) => { if (/model retry row/.test(String(label))) void fn() } })
  const retryRegistrations = () => registrations.filter((r) => r.options.name === 'conversation.chat.node')
  assert.equal(retryRegistrations().length, 0, 'the shipped retry row is not there yet: nothing is registered')
  list.push({ options: { key: 'model-retry' }, component: Shipped, locale: 'chat-ns' })
  for (const fn of subscribers.slice()) fn()
  assert.equal(retryRegistrations().length, 1, 'once the shipped row is registered, it is wrapped')
  assert.deepEqual(retryRegistrations()[0].options, { name: 'conversation.chat.node', key: 'model-retry', priority: -1, locale: 'chat-ns' }, 'same key, the lowest priority (it renders), the shipped entry\'s own locale')
  for (const fn of subscribers.slice()) fn()
  assert.equal(retryRegistrations().length, 1, 'wrapped once, however often the slot changes')
  const Row = retryRegistrations()[0].component
  const events = []
  const realDispatch = globalThis.window.dispatchEvent
  globalThis.window.dispatchEvent = (ev) => { events.push(ev.type); return true }
  const asked = []
  const T = (key, params) => 'engine:' + key + (params === undefined ? '' : JSON.stringify(params))
  const attempt = (over) => Object.assign({ kind: 'model-retry', seq: 7, retryState: 'scheduled', provider: 'kybernos', mode: 'normal', retry: 5, maxRetries: 5, delayMs: 8000, failure: { code: 'TRANSPORT', message: 'Connection error.' } }, over)
  const node = (over) => ({ key: 'r1', kind: 'model-retry', data: { attempts: [attempt(over)], current: attempt(over) } })
  const draw = async (props, quota) => {
    seen.length = 0
    globalThis.fetch = async (url, init) => {
      const path = new URL(String(url), 'http://localhost').pathname.replace(/^.*\/kybernos-cloud/, '')
      asked.push((init && init.method ? init.method : 'GET') + ' ' + path)
      return { ok: true, status: 200, json: async () => (path === '/quota' ? quota : { ok: false }) }
    }
    asked.length = 0
    const el = element(doc)
    const root = ReactClient.createRoot(el)
    await act(async () => { root.render(createElement(Row, props)); await new Promise((r) => setTimeout(r, 20)) })
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    return { el, root, html: htmlDe(el) }
  }
  const press = (n, name) => {
    if (n.attributes !== undefined && n.attributes['data-kb'] === name) { const key = Object.keys(n).find((k) => k.indexOf('__reactProps$') === 0); n[key].onClick(); return true }
    return (n.childNodes || []).some((c) => press(c, name))
  }
  const drop = (root) => act(async () => { root.unmount() })
  const DOWN = { ok: false, error: 'injoignable', server: { name: 'Kybernos (local)', host: 'localhost:8851', can_switch: true } }

  // 1. The Kybernos route, a waiting attempt, a server that does not answer: the label names the server and says DSH keeps trying; the rest of the row is the engine's.
  {
    const props = { node: node(), t: T }
    const a = await draw(props, DOWN)
    assert.deepEqual(asked, ['GET /quota'], 'one read of the host, no more')
    const last = seen[seen.length - 1]
    assert.equal(last.node, props.node, 'the same node')
    assert.equal(last.t('message.retry.active'), 'The Kybernos server “Kybernos (local)” (localhost:8851) is not answering: DSH keeps retrying', 'the label of the active row')
    assert.equal(last.t('message.retry.status', { retry: 5 }), 'engine:message.retry.status{"retry":5}', 'every other word is the engine\'s own (the count and the countdown are drawn by it)')
    assert.equal(last.t('message.retry.cancelled'), 'engine:message.retry.cancelled')
    assert.ok(a.html.includes('shipped-retry') && a.html.includes('data-kb="retry-kb"'), 'the shipped row, in our wrapper')
    assert.ok(a.html.includes('data-kb="retry-switch"') && a.html.includes('>Switch server<'), 'with the footer\'s « Switch server » beside it')
    events.length = 0
    assert.ok(press(a.el, 'retry-switch'), 'the button is there to press')
    assert.deepEqual(events, ['kybernos-cloud:servers'], 'it asks the footer for Settings › Servers, as the phone link does')
    await drop(a.root)
    // No other server in the registry: the sentence, no button.
    const alone = await draw({ node: node(), t: T }, { ok: false, error: 'injoignable', server: { name: 'Kybernos (local)', host: 'localhost:8851', can_switch: false } })
    assert.ok(seen[seen.length - 1].t('message.retry.active').includes('is not answering') && !alone.html.includes('retry-switch'), 'nobody to switch to: no button')
    await drop(alone.root)
  }
  // 2. Every other case is the shipped row with the very props it was given: a server that answers, one that refuses, an answer that names no server, a read that fails.
  {
    const cases = [
      [{ ok: true, no_plan: false, payment_blocked: false, usage: [], workspace: { id: 'w', name: 'Acme', role: 'owner', personal: false } }, 'a server that answers'],
      [{ ok: false, error: 'indisponible' }, 'a server that refuses'],
      [{ ok: false, error: 'injoignable' }, 'an answer that names no server'],
      [{ ok: false, connected: false, status: 'revoked', error: 'session_ended' }, 'a session the server ended'],
      [null, 'an unreadable answer'],
    ]
    for (const [quota, why] of cases) {
      const props = { node: node(), t: T, extra: 7 }
      const d = await draw(props, quota)
      assert.equal(seen[seen.length - 1].node, props.node, why)
      assert.equal(seen[seen.length - 1].t, T, why + ': the engine\'s own translator, not ours')
      assert.equal(seen[seen.length - 1].extra, 7)
      assert.ok(!d.html.includes('retry-switch') && !d.html.includes('retry-kb'), why + ': nothing of ours around it')
      await drop(d.root)
    }
    const failing = async (url) => { throw new Error('host down') }
    seen.length = 0
    globalThis.fetch = failing
    const el = element(doc)
    const root = ReactClient.createRoot(el)
    await act(async () => { root.render(createElement(Row, { node: node(), t: T })); await new Promise((r) => setTimeout(r, 20)) })
    assert.equal(seen[seen.length - 1].t, T, 'the host does not answer either: the shipped row')
    await drop(root)
  }
  // 3. Another provider's retry, an attempt that is not waiting, a node that is not the engine's shape: no read of the host at all, the shipped row.
  {
    const odd = [
      [node({ provider: 'deepseek' }), 'another provider'],
      [node({ provider: 'openai' }), 'another provider'],
      [node({ retryState: 'started' }), 'an attempt that started'],
      [node({ retryState: 'cancelled' }), 'an attempt that was cancelled'],
      [{ key: 'r2', kind: 'model-retry', data: {} }, 'no current attempt'],
      [{ key: 'r3', kind: 'model-retry' }, 'no data'],
      [{ key: 'r4', kind: 'model-retry', data: { current: null } }, 'a null attempt'],
    ]
    for (const [nd, why] of odd) {
      const props = { node: nd, t: T }
      const d = await draw(props, DOWN)
      assert.deepEqual(asked, [], why + ': the host is not asked')
      assert.equal(seen[seen.length - 1].node, nd, why)
      assert.equal(seen[seen.length - 1].t, T, why + ': the engine\'s own translator')
      assert.ok(!d.html.includes('retry-kb'), why)
      await drop(d.root)
    }
  }
  // 4. A new attempt looks again (the server may have come back or gone), and an attempt re-drawn for another reason does not.
  {
    seen.length = 0
    let quota = { ok: true }
    globalThis.fetch = async (url, init) => {
      const path = new URL(String(url), 'http://localhost').pathname.replace(/^.*\/kybernos-cloud/, '')
      asked.push((init && init.method ? init.method : 'GET') + ' ' + path)
      return { ok: true, status: 200, json: async () => quota }
    }
    asked.length = 0
    const el = element(doc)
    const root = ReactClient.createRoot(el)
    const first = { node: node({ retry: 3 }), t: T }
    await act(async () => { root.render(createElement(Row, first)); await new Promise((r) => setTimeout(r, 20)) })
    assert.deepEqual(asked, ['GET /quota'])
    assert.equal(seen[seen.length - 1].t, T, 'attempt 3: the server answers, the shipped row')
    await act(async () => { root.render(createElement(Row, { node: node({ retry: 3 }), t: T })); await new Promise((r) => setTimeout(r, 20)) })
    assert.deepEqual(asked, ['GET /quota'], 'the same attempt drawn again: no second read (the countdown ticks inside the shipped row, not here)')
    quota = DOWN
    await act(async () => { root.render(createElement(Row, { node: node({ retry: 4 }), t: T })); await new Promise((r) => setTimeout(r, 20)) })
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    assert.deepEqual(asked, ['GET /quota', 'GET /quota'], 'attempt 4: one more look')
    assert.ok(seen[seen.length - 1].t('message.retry.active').includes('is not answering'), 'and now it says so')
    await act(async () => { root.render(createElement(Row, { node: node({ retry: 4, retryState: 'started' }), t: T })); await new Promise((r) => setTimeout(r, 20)) })
    assert.deepEqual(asked, ['GET /quota', 'GET /quota'], 'the retry started: no read')
    assert.equal(seen[seen.length - 1].t, T, 'and the row is the engine\'s again (the server is back, or at least the attempt left)')
    await drop(root)
  }
  // 5. The slot's owner goes away (or the plugin is unloaded): the wrapper is withdrawn, the shipped row alone is left.
  assert.ok(typeof disposeRetry === 'function', 'the registration is disposable')
  disposeRetry()
  assert.equal(list.some((e) => e.component === Row), false, 'withdrawn')
  assert.equal(subscribers.length, 0, 'and it stops listening')
  globalThis.window.dispatchEvent = realDispatch
  assert.equal((source.match(/callLocal\('\/console\/link'/g) || []).length, 2, 'still two call sites of the console link')
  ok('retry row of a turn: the Kybernos route + a waiting attempt + a server that does not answer names the server, says DSH keeps trying, offers « Switch server »; every other provider, attempt or answer is the shipped row untouched; one look per attempt')
}

// ── The gift card's « Open the referral page » (kybernos-plugin) goes through the footer's own opener ─────────────────────────────────────────────────────────────
// It was a plain link to `<web>/account`: signed out in the browser, and the Overview instead of the Referral page. The footer owns the console link (the single-use link the HOST
// asks for and opens in the system browser), so the card asks IT, with a window event it may cancel: the footer claims the request when the account is connected, and does what its
// own Referral entry does; a request it does not claim (signed out, no footer mounted) is left to the link, which opens the server's own sign-in.
{
  const listeners = {}
  const realAdd = globalThis.window.addEventListener
  const realRemove = globalThis.window.removeEventListener
  globalThis.window.addEventListener = (type, fn) => { (listeners[type] = listeners[type] || []).push(fn) }
  globalThis.window.removeEventListener = (type, fn) => { listeners[type] = (listeners[type] || []).filter((f) => f !== fn) }
  globalThis.window.setTimeout = setTimeout
  globalThis.window.clearTimeout = clearTimeout
  const connected = { ok: true, connected: true, state: { user: { email: 'dev@example.test', plan: 'free' }, workspaces: [{ id: 'ws-1', name: 'My workspace', personal: true }], active_workspace_id: 'ws-1', space_plan: { key: 'free', label: 'Free', workspace_id: 'ws-1' } } }
  let status = connected
  let link = { ok: true, opened: true, expires_in: 60 }
  const sent = []
  globalThis.fetch = async (url, init) => {
    const path = new URL(String(url), 'http://localhost').pathname.replace(/^.*\/kybernos-cloud/, '')
    if (path === '/console/link') sent.push(JSON.parse(init.body))
    const json = path === '/status' ? status : path === '/console/link' ? link : { ok: false }
    return { ok: true, status: 200, json: async () => json }
  }
  const ask = (detail) => {
    const ev = { type: 'kybernos-cloud:account', detail, defaultPrevented: false, preventDefault () { this.defaultPrevented = true } }
    for (const fn of (listeners['kybernos-cloud:account'] || []).slice()) fn(ev)
    return ev
  }
  const draw = async () => {
    const el = element(doc)
    const root = ReactClient.createRoot(el)
    await act(async () => { root.render(createElement(registered.component, null)); await new Promise((r) => setTimeout(r, 30)) })
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    return { el, root }
  }
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })

  // 1. Connected: the request is claimed, and the host is asked for the Referral page of the ACTIVE team, to be opened by the host (what the profile menu's Referral entry does).
  {
    const { el, root } = await draw()
    assert.equal((listeners['kybernos-cloud:account'] || []).length, 1, 'the footer listens for the request')
    sent.length = 0
    const ev = ask({ section: 'referral' })
    await settle()
    assert.equal(ev.defaultPrevented, true, 'claimed: the card must not follow its own link')
    assert.deepEqual(sent, [{ section: 'referral', open: true, workspace_id: 'ws-1' }], 'one console link, the Referral page, opened by the host, for the active team')
    assert.ok(htmlDe(el).includes('class="kbfp-flashtext">Your account page is opening in your browser.'), 'and the person is told that it is opening')
    // The server does not answer: the same notice as for the menu's entries, naming the server (nothing is opened, and the card does not fall back to a link that would not help).
    link = { ok: false, error: 'injoignable', server: { name: 'Kybernos (local)', host: 'localhost:8851', can_switch: true } }
    const down = ask({ section: 'referral' })
    await settle()
    assert.equal(down.defaultPrevented, true)
    assert.ok(htmlDe(el).includes('the server “Kybernos (local)” (localhost:8851) does not answer.') && htmlDe(el).includes('>Switch server<'), 'a server that does not answer is named, with the way to another one: ' + htmlDe(el).slice(0, 300))
    link = { ok: true, opened: true, expires_in: 60 }
    // A request that names no section, or one that is not a page name, is not ours to open.
    for (const odd of [undefined, null, {}, { section: 7 }, { section: '' }, { section: '../x' }, { section: 'a b' }]) {
      sent.length = 0
      const e = ask(odd)
      await settle()
      assert.equal(e.defaultPrevented, false, 'not claimed: ' + JSON.stringify(odd))
      assert.deepEqual(sent, [], 'and nothing asked of the host')
    }
    await act(async () => { root.unmount() })
    assert.equal((listeners['kybernos-cloud:account'] || []).length, 0, 'the footer stops listening when it goes')
  }
  // 2. Signed out: not claimed (there is no device token to ask a link with): the card's own link opens the server\'s sign-in.
  {
    status = { ok: true, connected: false, status: 'none' }
    const { root } = await draw()
    sent.length = 0
    const ev = ask({ section: 'referral' })
    await settle()
    assert.equal(ev.defaultPrevented, false, 'signed out: left to the link')
    assert.deepEqual(sent, [], 'no console link asked')
    await act(async () => { root.unmount() })
  }
  globalThis.window.addEventListener = realAdd
  globalThis.window.removeEventListener = realRemove
  assert.equal((source.match(/callLocal\('\/console\/link'/g) || []).length, 2, 'still two call sites of the console link: the gift card goes through the footer\'s')
  assert.ok(/addEventListener\('kybernos-cloud:account'/.test(source), 'the footer listens for the request')
  ok('footer: the gift card\'s request for an account page is claimed when connected (the Referral page of the active team, opened by the host, a down server named) and left alone when signed out')
}

// ── The account menu lists the spaces, the plan card follows the role, a switch waits on DSH, a team space has its cues (plan « Équipes », steps 1, 2, 3, 7) ──────────────────────
// Rendered for real (React + the minimal DOM above); a click is the onClick React keeps on the node. The pure rules are test-teams-menu.mjs's; the real clicks, the screenshots and the
// delay of a switch on a live DSH are scripts/check-footer-live.mjs.
{
  const listeners = {}
  const realAdd = globalThis.window.addEventListener
  const realRemove = globalThis.window.removeEventListener
  globalThis.window.addEventListener = (type, fn) => { (listeners[type] = listeners[type] || []).push(fn) }
  globalThis.window.removeEventListener = (type, fn) => { listeners[type] = (listeners[type] || []).filter((f) => f !== fn) }
  globalThis.window.setTimeout = setTimeout
  globalThis.window.clearTimeout = clearTimeout
  // The menu measures itself to place its side panel, and takes focus: the minimal DOM gets the few methods that need.
  const realCreate = doc.createElement
  doc.createElement = () => Object.assign(realCreate(), { getBoundingClientRect: () => ({ left: 0, top: 0, right: 220, width: 220, height: 300 }), getClientRects: () => [], contains: () => false, focus () {}, querySelectorAll: () => [] })
  globalThis.window.innerWidth = 1400
  const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
  const propsOf = (n) => n[Object.keys(n).find((k) => k.indexOf('__reactProps$') === 0)]
  const find = (n, pred) => {
    if (n.nodeType === 1 && pred(n)) return n
    for (const c of (n.childNodes || [])) { const r = find(c, pred); if (r !== null) return r }
    return null
  }
  const findAll = (n, pred, out = []) => { if (n.nodeType === 1 && pred(n)) out.push(n); for (const c of (n.childNodes || [])) findAll(c, pred, out); return out }
  const byKb = (name) => (n) => n.attributes !== undefined && n.attributes['data-kb'] === name
  const byClass = (name) => (n) => String(n.attributes !== undefined && n.attributes.class !== undefined ? n.attributes.class : n.className).split(' ').includes(name)
  const press = async (n) => { await act(async () => { propsOf(n).onClick({ preventDefault () {}, stopPropagation () {}, target: n }); await new Promise((r) => setTimeout(r, 0)) }) }

  const TEAMS = [['t1', 'Acme'], ['t2', 'Studio B'], ['t3', 'Nova Labs'], ['t4', 'Delta Co'], ['t5', 'Orbit']]
  const workspaces = (count, role) => [{ id: 'p', name: 'My workspace', personal: true, role: 'owner' }, ...TEAMS.slice(0, count - 1).map(([id, name]) => ({ id, name, personal: false, role }))]
  const win = (kind, seconds, percent, extra = {}) => ({ kind, window_seconds: seconds, scope: 'plan', used_percent: percent, exhausted: false, resets_at: null, ...extra })
  const world = {
    status: null, quota: null, summary: null, calls: [], bodies: [], applied: [], route: 'written', activeOk: true, invitePreview: { ok: false }, inviteAccept: { ok: false },
    activeState: null, folderAnswer: { ok: true }, createAnswer: { ok: false },
  }
  const stateOf = (count, role, active, extra = {}) => ({ ok: true, connected: true, state: {
    user: { email: 'dev@example.test', name: 'Local test', plan: active === 'p' ? 'free' : 'team' },
    workspaces: workspaces(count, role), active_workspace_id: active,
    space_plan: active === 'p' ? { key: 'free', label: 'Free', workspace_id: 'p' } : { key: 'team', label: 'Team', workspace_id: active },
    web_url: 'https://dev.kybernos.app', ...extra } })
  const quotaOf = (workspace, usage, extra = {}) => ({ ok: true, workspace, payment_blocked: false, no_plan: false, usage, ...extra })
  globalThis.fetch = async (url, init) => {
    const path = new URL(String(url), 'http://localhost').pathname.replace(/^.*\/kybernos-cloud/, '')
    const method = init && init.method ? init.method : 'GET'
    world.calls.push(method + ' ' + path)
    if (init && init.body) world.bodies.push({ path, body: JSON.parse(init.body) })
    let json = { ok: false }
    if (path === '/status') json = world.status
    else if (path === '/quota') json = world.quota !== null ? world.quota : { ok: false }
    else if (path === '/spaces/summary') json = world.summary !== null ? world.summary : { ok: false }
    else if (path === '/space/active' && world.activeRefusal !== undefined && world.activeRefusal !== null) json = world.activeRefusal
    else if (path === '/space/active') {
      json = world.activeOk ? { ok: true, route: world.route, state: world.activeState !== null ? world.activeState(JSON.parse(init.body).workspace_id) : {} } : { ok: false, error: 'espace_inconnu' }
      if (world.activeOk) world.status = { ...world.status, state: { ...world.status.state, active_workspace_id: JSON.parse(init.body).workspace_id } }
    } else if (path === '/space/applied') json = { ok: true, applied: world.applied.length > 0 ? world.applied.shift() : true }
    else if (path === '/space/folder') json = world.folderAnswer
    else if (path === '/space/for-folder') json = typeof world.forFolder === 'function' ? world.forFolder(JSON.parse(init.body)) : { ok: false }
    else if (path === '/space/create') json = world.createAnswer
    else if (path === '/invitation/preview') json = world.invitePreview
    else if (path === '/invitation/accept') {
      json = world.inviteAccept
      // The host adds the accepted team to the list (it does not make it active): the next /status shows it.
      if (json.ok === true) world.status = stateOf(3, 'member', 'p')
    }
    return { ok: true, status: 200, json: async () => json }
  }
  const draw = async () => {
    const el = element(doc)
    const root = ReactClient.createRoot(el)
    await act(async () => { root.render(createElement(registered.component, null)); await new Promise((r) => setTimeout(r, 30)) })
    await settle()
    return { el, root }
  }
  const open = async (el) => { await press(find(el, byClass('kbfp-cardmain'))); await settle() }
  const SUMMARY = (count, members = 6, teamUsage = [win('member', 18000, 12), win('pool', 2592000, 84)]) => ({ ok: true, server_time: null, spaces: Object.fromEntries(workspaces(count, 'admin').map((w) => [w.id, w.personal ? { usage: [win('member', 2592000, 3)], members: null, plan: { key: 'free', label: 'Free' } } : { usage: teamUsage, members, plan: null }])) })

  // 1. The menu lists the spaces itself for one to three of them; from four the top row stays « Switch team ».
  for (const count of [1, 3, 4, 6]) {
    const inline = count <= 3
    world.status = stateOf(count, 'admin', 'p')
    world.quota = quotaOf({ id: 'p', name: 'My workspace', role: 'owner', personal: true }, [win('member', 2592000, 3)])
    world.summary = SUMMARY(count)
    const { el, root } = await draw()
    await open(el)
    const menu = find(el, byClass('kbfp-menu'))
    assert.ok(menu !== null, count + ' spaces: the menu is open')
    const teamsBlock = find(menu, byKb('menu-block-teams'))
    assert.equal(teamsBlock.attributes['data-mode'], inline ? 'inline' : 'submenu', count + ' spaces: ' + (inline ? 'listed in the menu' : 'the Switch team row'))
    const rowsIn = findAll(menu, byKb('space-row'))
    if (inline) {
      assert.equal(rowsIn.length, count, count + ' spaces: one row each, in the menu itself')
      assert.equal(find(menu, byKb('menu-switch')), null, 'no « Switch team » row while the list is in the menu')
      assert.ok(find(menu, byKb('space-create')) !== null, 'and « Create a team » under the list')
      assert.equal(rowsIn.filter((r) => r.attributes['aria-current'] === 'true').length, 1, 'one row is the active one')
      assert.equal(rowsIn[0].attributes['aria-current'], 'true', 'the personal space, here')
      const text = htmlDe(menu)
      if (count > 1) {
        assert.ok(text.includes('Admin · 6 members'), count + ' spaces: « Admin · 6 members »')
        assert.ok(text.includes('class="kbfp-usepct">84%<'), 'the usage of each team as a percent: ' + text.slice(0, 200))
      }
      assert.ok(text.includes('Local test · Free'), 'the personal row: « you · plan »')
      assert.equal(/[$€]|usd|credit/i.test(text.replace(/Add credits/g, '')), false, 'no money in the menu')
    } else {
      assert.equal(rowsIn.length, 0, count + ' spaces: the menu itself holds no list')
      const head = find(menu, byKb('menu-switch'))
      assert.ok(head !== null && htmlDe(head).includes('Switch team'), 'the top row stays « Switch team »')
      await press(head)
      await settle()
      const sub = find(doc.body, byClass('kbfp-sub'))
      assert.ok(sub !== null, 'it opens the full list next to the menu')
      assert.equal(findAll(sub, byKb('space-row')).length, count, 'with every space')
      assert.ok(find(sub, byKb('space-create')) !== null)
      assert.ok(htmlDe(sub).includes('Admin · 6 members'), 'the same rows as the inline list')
      doc.body.childNodes.length = 0
    }
    await act(async () => { root.unmount() })
  }
  ok('menu : jusqu\'a 3 espaces la liste est dans le menu (tuile, nom, « Admin · 6 membres », pourcentage, coche), des 4 la ligne « Switch team » ouvre la liste complete (1, 3, 4, 6)')

  // 2. The plan card follows the role: a member sees the team's bar and their own, an admin also gets Manage and, once the pool is used up, Add credits.
  {
    const run = async (role, usage) => {
      world.status = stateOf(3, role, 't1')
      world.quota = quotaOf({ id: 't1', name: 'Acme', role, personal: false }, usage)
      world.summary = SUMMARY(3)
      const { el, root } = await draw()
      await open(el)
      const menu = find(el, byClass('kbfp-menu'))
      const out = { rows: findAll(menu, byKb('menu-plan-window')).map((r) => [r.attributes['data-win'], r.attributes['data-percent'], r.attributes['data-level']]), manage: find(menu, byKb('menu-plan-manage')) !== null, credits: find(menu, byKb('menu-plan-credits')) !== null, html: htmlDe(find(menu, byKb('menu-plan-card'))), footer: htmlDe(el) }
      await act(async () => { root.unmount() })
      return out
    }
    const usage = [win('pool', 2592000, 40), win('member', 18000, 12), win('member', 604800, 30)]
    const member = await run('member', usage)
    assert.deepEqual(member.rows, [['team', '40', 'ok'], ['you', '12', 'ok'], ['you', '30', 'ok']], 'a member: the Team bar and their own 5 hours and 7 days')
    assert.equal(member.manage || member.credits, false, 'and neither Manage nor Add credits')
    assert.ok(member.html.includes('Last 30 days') && member.html.includes('Last 5 hours') && member.html.includes('Last 7 days'), 'each bar says how long its window is')
    assert.equal(/resets|back/i.test(member.html), false, 'nothing about a time of return while there is room')
    const admin = await run('admin', usage)
    assert.ok(admin.footer.includes('data-kb="workspace-card-usage"') && admin.footer.includes('data-percent="40"'), 'a team keeps the meter of its pool on the footer card')
    assert.deepEqual([admin.manage, admin.credits], [true, false], 'an admin gets Manage, and not Add credits while the pool has room')
    const near = await run('admin', [win('pool', 2592000, 76), win('member', 18000, 12)])
    assert.equal(near.rows[0][2], 'near', 'the team bar turns amber from 75%')
    const soon = new Date(Date.now() + 3 * 3600000).toISOString()
    const poolFull = [win('pool', 2592000, 100, { exhausted: true, resets_at: soon }), win('member', 18000, 12), win('member', 604800, 30)]
    const adminFull = await run('admin', poolFull)
    assert.deepEqual([adminFull.manage, adminFull.credits], [true, true], 'an admin of a team whose pool is used up also gets Add credits')
    assert.ok(adminFull.rows[0][2] === 'full' && adminFull.html.includes('Back in about 3'), 'and the bar says when it is back, only now: ' + adminFull.html.slice(0, 300))
    const memberFull = await run('member', poolFull)
    assert.deepEqual([memberFull.manage, memberFull.credits], [false, false], 'a member of that team gets neither')
    // The personal free card: « Free », Upgrade and one allowance bar.
    world.status = stateOf(3, 'admin', 'p')
    world.quota = quotaOf({ id: 'p', name: 'My workspace', role: 'owner', personal: true }, [win('member', 2592000, 7)])
    world.summary = SUMMARY(3)
    const free = await draw()
    await open(free.el)
    const fm = find(free.el, byClass('kbfp-menu'))
    assert.ok(find(fm, byKb('menu-plan-cta')) !== null && find(fm, byKb('menu-plan-manage')) === null, 'a free personal space: Upgrade, no Manage')
    assert.deepEqual(findAll(fm, byKb('menu-plan-window')), [], 'and NO allowance row: it is the Kybernos plan\'s number, which the composer\'s chip shows on a Kybernos model')
    assert.equal(htmlDe(free.el).includes('workspace-card-usage'), false, 'nor a gauge on the footer card')
    const menuHtml = htmlDe(fm)
    const iAcc = menuHtml.indexOf('data-kb="menu-block-account"')
    const iApp = menuHtml.indexOf('data-kb="menu-block-appearance"')
    assert.ok(iAcc >= 0 && iApp > iAcc && menuHtml.slice(iAcc, iApp).includes('class="kbfp-msep"'), 'a rule sits between the account block (Account, Referral) and Appearance')
    await act(async () => { await press(find(fm, byKb('menu-plan-cta'))) })
    await act(async () => { free.root.unmount() })
    ok('carte du plan par role : membre = barre Equipe + les siennes (5 h, 7 j), admin = + Manage, + Add credits quand le pot est plein ; perso gratuit = Upgrade, ni ligne de quota ni jauge ; ambre des 75 %, heure de retour seulement quand c\'est plein')
  }

  // 3. A switch waits for DSH: the card says « Switching… » until the host reports the new route live, and the other outcomes are said.
  {
    world.status = stateOf(3, 'admin', 'p')
    world.quota = quotaOf({ id: 'p', name: 'My workspace', role: 'owner', personal: true }, [win('member', 2592000, 3)])
    world.summary = SUMMARY(3)
    world.route = 'written'
    world.activeOk = true
    world.applied = [false, false, true]
    world.calls.length = 0
    world.bodies.length = 0
    const { el, root } = await draw()
    await open(el)
    const row = findAll(find(el, byClass('kbfp-menu')), byKb('space-row')).filter((r) => r.attributes['data-space'] === 't1')[0]
    await press(row)
    await act(async () => { await new Promise((r) => setTimeout(r, 120)) })
    const during = htmlDe(el)
    assert.ok(during.includes('data-kb="workspace-card-switching"') && during.includes('>Switching…<'), 'while DSH has not applied the route: « Switching… » on the card: ' + during.slice(0, 400))
    assert.ok(during.includes('kbfp-cardname" title="Acme">Acme<'), 'with the team that was chosen')
    assert.equal(during.includes('workspace-card-usage'), false, 'and no meter of another team\'s allowance')
    assert.equal(find(el, byClass('kbfp-menu')), null, 'the menu is closed')
    await act(async () => { await new Promise((r) => setTimeout(r, 900)) })
    const after = htmlDe(el)
    assert.equal(after.includes('workspace-card-switching'), false, 'once the route is applied the card is back to normal')
    assert.ok(after.includes('kbfp-cardname" title="Acme">Acme<'))
    const asked = world.calls.filter((c) => c.indexOf('/space/') >= 0)
    assert.equal(asked[0], 'POST /space/active')
    assert.equal(asked.filter((c) => c === 'POST /space/applied').length, 3, 'it asked the host whether the route is applied until it said yes: ' + JSON.stringify(asked))
    assert.deepEqual(world.bodies.filter((b) => b.path === '/space/applied').map((b) => b.body), [{ workspace_id: 't1' }, { workspace_id: 't1' }, { workspace_id: 't1' }])
    // The route the host could not rewrite: the choice is kept, and the person is told that messages may still be billed to the previous team (no waiting).
    world.route = 'failed'
    world.calls.length = 0
    await open(el)
    await press(findAll(find(el, byClass('kbfp-menu')), byKb('space-row')).filter((r) => r.attributes['data-space'] === 'p')[0])
    await settle(80)
    const stale = htmlDe(el)
    assert.ok(stale.includes('data-kb="foot-flash"') && stale.includes('may still be billed to the previous team'), 'a route that could not be rewritten is said at once: ' + stale.slice(0, 300))
    assert.equal(stale.includes('workspace-card-switching'), false, 'and nothing waits for a route that will not change')
    assert.equal(world.calls.includes('POST /space/applied'), false, 'it did not ask for an application that will not come')
    // A team the host does not know: refused, nothing changed, said.
    world.activeOk = false
    world.status = stateOf(3, 'admin', 'p')
    await settle(80)
    await open(el)
    await press(findAll(find(el, byClass('kbfp-menu')), byKb('space-row')).filter((r) => r.attributes['data-space'] === 't2')[0])
    await settle(80)
    assert.ok(htmlDe(el).includes('Unknown team'), 'an id the host refuses: « Unknown team — nothing was changed. »')
    world.activeOk = true
    // A reply is running: the host refuses the switch. The person is told WHICH reply (in which team), nothing is waiting, and the card stays where it was.
    world.activeRefusal = { ok: false, error: 'turn_running', running: { count: 1, space_id: 'p', space_name: 'My workspace', since: 1 } }
    world.status = stateOf(3, 'admin', 'p')
    world.calls.length = 0
    await settle(80)
    await open(el)
    await press(findAll(find(el, byClass('kbfp-menu')), byKb('space-row')).filter((r) => r.attributes['data-space'] === 't1')[0])
    await settle(80)
    const busy = htmlDe(el)
    assert.ok(busy.includes('data-kb="foot-flash"') && busy.includes('A reply is still running in Personal. Switching waits for it or stop it first.'), 'a refused switch says which reply is running and where: ' + busy.slice(0, 400))
    assert.equal(busy.includes('workspace-card-switching'), false, 'and nothing waits')
    assert.equal(busy.includes('Unknown team'), false, 'it is not an unknown team')
    assert.equal(world.calls.includes('POST /space/applied'), false, 'no wait for a route that did not change')
    // A reply the host only found in the engine\'s registry has no team: the sentence names none.
    world.activeRefusal = { ok: false, error: 'turn_running', running: { count: 1, space_id: null, space_name: null, since: 1 } }
    await settle(80)
    await open(el)
    await press(findAll(find(el, byClass('kbfp-menu')), byKb('space-row')).filter((r) => r.attributes['data-space'] === 't2')[0])
    await settle(80)
    assert.ok(htmlDe(el).includes('A reply is still running. Switching waits for it or stop it first.'), 'a reply with no known team: the sentence has no team')
    world.activeRefusal = null
    await act(async () => { root.unmount() })
    ok('changement d\'equipe : la carte dit « Switching… » (equipe choisie, sans compteur) jusqu\'a ce que l\'hote dise que la route tourne ; une route non reecrite est dite tout de suite ; un refus est dit')
  }

  // 4. A team space has its cues: the pill in the dock and the options row, the heading's accessor; the personal space has none; a folder pill only when a folder exists.
  {
    const cueSlots = registrations.filter((r) => r.options.id === 'kybernos-cloud-cues')
    assert.deepEqual(cueSlots.map((r) => r.options.name).sort(), ['conversation.composer.dock', 'conversation.hero.options'], 'the pills are registered in the composer dock and in the new chat\'s options row')
    assert.ok(cueSlots.every((r) => r.options.order === 3), 'in front of the other pills')
    const dock = () => { const el = element(doc); return { el, root: ReactClient.createRoot(el) } }
    world.status = stateOf(3, 'admin', 't1')
    world.quota = quotaOf({ id: 't1', name: 'Acme', role: 'admin', personal: false }, [win('pool', 2592000, 40)])
    world.summary = SUMMARY(3)
    const foot = await draw()
    const d1 = dock()
    await act(async () => { d1.root.render(createElement(cueSlots[0].component, null)); await new Promise((r) => setTimeout(r, 20)) })
    const html1 = htmlDe(d1.el)
    assert.ok(html1.includes('data-kb="space-cue"') && html1.includes('data-kb="cue-memory"') && html1.includes('>Team memory · personal off<'), 'a team: the memory pill says the personal memory is off (the cut is on, PERSONAL_MEMORY_CUT): ' + html1)
    assert.ok(/data-kb-hue="(violet|teal|amber|rose|blue|green)"/.test(html1), 'in the team\'s colour')
    assert.equal(html1.includes('cue-folder'), false, 'no team folder yet: no folder pill')
    const cue = globalThis.window.__KB_SPACE_CUE__
    assert.ok(cue !== null && cue.heading === 'What is Acme working on?' && cue.placeholder === 'Message Acme…', 'the core plugin reads the heading through the accessor: ' + JSON.stringify(cue))
    // The host names a folder (step 6): its pill appears.
    world.status = stateOf(3, 'admin', 't1', { space_folder: '/work/Acme' })
    await act(async () => { await foot.root.unmount() })
    const foot2 = await draw()
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    const html2 = htmlDe(d1.el)
    assert.ok(html2.includes('data-kb="cue-folder"') && html2.includes('Acme folder') && html2.includes('title="/work/Acme"'), 'a folder the host names shows its pill: ' + html2)
    // The personal space: nothing.
    world.status = stateOf(3, 'admin', 'p')
    await act(async () => { await foot2.root.unmount() })
    const foot3 = await draw()
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    assert.equal(htmlDe(d1.el).includes('space-cue'), false, 'the personal space shows no cue')
    assert.equal(globalThis.window.__KB_SPACE_CUE__, null, 'and publishes none')
    await act(async () => { await foot3.root.unmount() })
    await act(async () => { d1.root.unmount() })
    ok('repères de la zone de saisie : pastille mémoire en couleur (« personal off » : la mémoire personnelle est coupée dans une équipe), pastille dossier seulement si un dossier existe, rien dans l\'espace perso, titre d\'accueil lu par le plugin de base')
  }

  // 5. Joining with an invitation link (plan « Équipes », step 4): the row under « Create a team » in both lists, the dialog (paste, check, preview, join), each refusal in its own words, the
  // switch through the ordinary path after an accepted invitation, and no switch for a team that has no plan. The host's rules are test-join-host.mjs's.
  {
    const INVITE = 'k3Zp9-Qw_7Lm2XvB0cR8sTnYh4JdUeA6oGfIiNaPqMc'
    const LINK = 'https://dev.kybernos.app/invitations/accept?token=' + INVITE
    const PREVIEW = { ok: true, preview: { team: 'Studio B', inviter: 'Ada Lovelace', email: 'dev@example.test', role: 'member', expires_at: '2026-10-25T10:00:00.000Z' } }
    const JOINED = { ok: true, state: {}, joined: { id: 't2', name: 'Studio B', role: 'member', plan_key: 'team' } }
    const reset = (count = 2) => {
      world.status = stateOf(count, 'member', 'p')
      world.quota = quotaOf({ id: 'p', name: 'My workspace', role: 'owner', personal: true }, [win('member', 2592000, 3)])
      world.summary = SUMMARY(count)
      world.route = 'written'; world.activeOk = true; world.applied = [true]
      world.invitePreview = PREVIEW; world.inviteAccept = JOINED
      world.calls.length = 0; world.bodies.length = 0
    }
    const typeIn = async (el, value) => { await act(async () => { propsOf(find(el, byKb('join-input'))).onChange({ target: { value } }); await new Promise((r) => setTimeout(r, 0)) }) }
    const dialog = async (el, count = 2) => {
      await open(el)
      const menu = find(el, byClass('kbfp-menu'))
      if (count > 3) { await press(find(menu, byKb('menu-switch'))); await settle() }
      const where = count > 3 ? find(doc.body, byClass('kbfp-sub')) : menu
      await press(find(where, byKb('space-join')))
      await settle()
      return find(el, byKb('join-team'))
    }
    const noteOf = (el) => { const n = find(el, byKb('join-note')); return n === null ? null : htmlDe(n) }

    // The row: under « Create a team », in the inline list and in the « Switch team » panel.
    reset(2)
    let foot = await draw()
    await open(foot.el)
    let menu = find(foot.el, byClass('kbfp-menu'))
    const rows = findAll(menu, (n) => n.attributes !== undefined && (n.attributes['data-kb'] === 'space-create' || n.attributes['data-kb'] === 'space-join'))
    assert.deepEqual(rows.map((n) => n.attributes['data-kb']), ['space-create', 'space-join'], 'the join row is right under « Create a team »')
    assert.ok(htmlDe(rows[1]).includes('Join with an invitation link'), 'and says what it is')
    assert.equal(find(foot.el, byKb('join-team')), null, 'nothing is open, nothing was asked of the host by itself')
    assert.equal(world.calls.filter((c) => c.indexOf('/invitation/') >= 0).length, 0)
    await act(async () => { foot.root.unmount() })
    reset(4)
    foot = await draw()
    await open(foot.el)
    await press(find(find(foot.el, byClass('kbfp-menu')), byKb('menu-switch')))
    await settle()
    const sub = find(doc.body, byClass('kbfp-sub'))
    assert.ok(find(sub, byKb('space-join')) !== null, 'the « Switch team » panel has the row too')
    doc.body.childNodes.length = 0
    await act(async () => { foot.root.unmount() })

    // The dialog, a refused paste, the preview, and the switch after the acceptance.
    reset(2)
    foot = await draw()
    let card = await dialog(foot.el)
    assert.ok(card !== null && card.attributes['data-step'] === 'paste', 'the row opens the dialog')
    assert.equal(find(foot.el, byClass('kbfp-menu')), null, 'the menu closes behind it')
    assert.ok(htmlDe(find(card, byKb('join-check'))).includes('disabled'), 'nothing pasted: nothing to check')
    await typeIn(foot.el, 'hello there')
    await press(find(foot.el, byKb('join-check')))
    await settle()
    assert.ok(noteOf(foot.el).includes('neither an invitation link nor its code'), 'junk is said, in words: ' + noteOf(foot.el))
    assert.equal(world.calls.filter((c) => c.indexOf('/invitation/') >= 0).length, 0, 'junk never reaches the host')
    await typeIn(foot.el, LINK)
    assert.equal(noteOf(foot.el), null, 'typing clears the note')
    await press(find(foot.el, byKb('join-check')))
    await settle()
    assert.deepEqual(world.bodies.filter((b) => b.path === '/invitation/preview').map((b) => b.body), [{ token: INVITE }], 'the host gets the token and only the token, not the link')
    card = find(foot.el, byKb('join-team'))
    assert.equal(card.attributes['data-step'], 'preview')
    assert.equal(find(card, byKb('join-who')) !== null && htmlDe(find(card, byKb('join-who'))).includes('Ada Lovelace invited you to join “Studio B” as member.'), true, 'the preview says who invited, the team and the role: ' + htmlDe(card).slice(0, 400))
    assert.ok(htmlDe(find(card, byKb('join-sent-to'))).includes('Sent to dev@example.test.'))
    assert.equal(find(card, byKb('join-mismatch')), null, 'the signed-in address is the invited one: no warning')
    assert.equal(htmlDe(card).includes(INVITE), false, 'the token is not drawn anywhere')
    assert.equal(world.calls.filter((c) => c === 'POST /invitation/accept').length, 0, 'nothing is accepted before the second click')
    await press(find(card, byKb('join-accept')))
    await settle(120)
    assert.deepEqual(world.bodies.filter((b) => b.path === '/invitation/accept').map((b) => b.body), [{ token: INVITE }])
    const order = world.calls.filter((c) => c.indexOf('/invitation/') >= 0 || c.indexOf('/space/') >= 0)
    assert.deepEqual(order.slice(0, 3), ['POST /invitation/preview', 'POST /invitation/accept', 'POST /space/active'], 'accepted, then the ordinary switch: ' + JSON.stringify(order))
    assert.deepEqual(world.bodies.filter((b) => b.path === '/space/active').map((b) => b.body), [{ workspace_id: 't2' }], 'to the team just joined')
    assert.equal(find(foot.el, byKb('join-team')), null, 'the dialog is closed')
    await settle(900)
    assert.ok(order.indexOf('POST /space/applied') >= 0 || world.calls.indexOf('POST /space/applied') >= 0, 'with the same wait on the model route as any switch')
    assert.ok(htmlDe(foot.el).includes('kbfp-cardname" title="Studio B">Studio B<'), 'the card shows the new team')
    await act(async () => { foot.root.unmount() })

    // A team that has no plan: the person stays where they are and is told.
    reset(2)
    world.inviteAccept = { ok: true, state: {}, joined: { id: 't1', name: 'Acme', role: 'member', plan_key: 'none' } }
    foot = await draw()
    await dialog(foot.el)
    await typeIn(foot.el, INVITE)
    await press(find(foot.el, byKb('join-check')))
    await settle()
    await press(find(foot.el, byKb('join-accept')))
    await settle(120)
    assert.equal(world.calls.filter((c) => c === 'POST /space/active').length, 0, 'a team without a plan is not switched to')
    const flash = htmlDe(foot.el)
    assert.ok(flash.includes('data-kb="foot-flash"') && flash.includes('You joined “Acme”, which has no plan yet. You are still in “Personal”.'), 'and the person is told: ' + flash.slice(Math.max(0, flash.indexOf('foot-flash') - 40), flash.indexOf('foot-flash') + 300) + ' / ' + flash.length)
    assert.equal(flash.includes('foot-flash-action'), false, 'a member has no plan to choose')
    assert.ok(flash.includes('kbfp-cardname" title="Personal">Personal<'), 'they stay where they were')
    await act(async () => { foot.root.unmount() })

    // Each refusal has its own sentence; the dialog stays so the person can go on.
    const refusals = [
      ['preview', { ok: false, error: 'invitation_unusable', status: 404 }, ['expired', 'used', 'withdrawn', 'another account'], false],
      ['preview', { ok: false, error: 'rate_limited', status: 429 }, ['Too many tries'], false],
      ['preview', { ok: false, error: 'unreachable', status: 0 }, ['could not be reached'], false],
      ['preview', { ok: false, error: 'refused', status: 500 }, ['did not work out'], true],
      ['accept', { ok: false, error: 'invitation_unusable', status: 404 }, ['expired', 'used', 'withdrawn', 'another account'], false],
      ['accept', { ok: false, error: 'seat_limit', status: 409 }, ['no free seat', 'stays valid'], false],
      ['accept', { ok: false, error: 'rate_limited', status: 429 }, ['Too many tries'], false],
      ['accept', { ok: false, error: 'unreachable', status: 0 }, ['could not be reached'], false],
      ['accept', { ok: false, error: 'non_connecte' }, ['signed out'], false],
      ['accept', { ok: false, error: 'refused', status: 500 }, ['did not work out'], true],
    ]
    for (const [step, answer, words, browser] of refusals) {
      reset(2)
      if (step === 'preview') world.invitePreview = answer; else world.inviteAccept = answer
      foot = await draw()
      await dialog(foot.el)
      await typeIn(foot.el, LINK)
      await press(find(foot.el, byKb('join-check')))
      await settle()
      if (step === 'accept') { await press(find(foot.el, byKb('join-accept'))); await settle(60) }
      const note = noteOf(foot.el)
      const label = step + ' ' + answer.error + ': '
      assert.ok(note !== null && words.every((w) => note.includes(w)), label + 'the sentence names ' + words.join(', ') + ' -> ' + note)
      assert.equal(find(foot.el, byKb('join-team')).attributes['data-step'], step === 'preview' ? 'paste' : 'preview', label + 'the dialog stays at the step it was at')
      const exit = find(foot.el, byKb('join-browser'))
      assert.equal(exit !== null, browser, label + (browser ? 'the server\'s own page is offered' : 'no browser exit for a planned refusal'))
      if (browser) assert.equal(exit.attributes.href, 'https://dev.kybernos.app/invitations/accept?token=' + INVITE, label + 'on the ACTIVE server\'s web address, with the token')
      assert.equal(world.calls.filter((c) => c === 'POST /space/active').length, 0, label + 'nothing was switched')
      await act(async () => { foot.root.unmount() })
    }

    // A link of another host names it on a refusal; an invitation for another address is warned about; the button of a bare token works the same.
    reset(2)
    world.invitePreview = { ok: false, error: 'invitation_unusable', status: 404 }
    foot = await draw()
    await dialog(foot.el)
    await typeIn(foot.el, 'https://other-server.example/invitations/accept?token=' + INVITE)
    await press(find(foot.el, byKb('join-check')))
    await settle()
    assert.ok(noteOf(foot.el).includes('This link comes from other-server.example; your active server is dev.kybernos.app.'), 'a link from another server says so: ' + noteOf(foot.el))
    assert.deepEqual(world.bodies.filter((b) => b.path === '/invitation/preview').map((b) => b.body), [{ token: INVITE }], 'still only the token goes to the host')
    await act(async () => { foot.root.unmount() })
    reset(2)
    world.invitePreview = { ok: true, preview: { ...PREVIEW.preview, email: 'someone.else@example.test', inviter: null, role: 'admin' } }
    foot = await draw()
    await dialog(foot.el)
    await typeIn(foot.el, INVITE)
    await press(find(foot.el, byKb('join-check')))
    await settle()
    card = find(foot.el, byKb('join-team'))
    assert.ok(htmlDe(find(card, byKb('join-who'))).includes('You were invited to join “Studio B” as admin.'), 'no inviter: the sentence without a name')
    assert.ok(find(card, byKb('join-mismatch')) !== null && htmlDe(find(card, byKb('join-mismatch'))).includes('someone.else@example.test') && htmlDe(find(card, byKb('join-mismatch'))).includes('dev@example.test'), 'an invitation sent to another address says which one')
    assert.equal(htmlDe(find(card, byKb('join-accept'))).includes('disabled'), false, 'the server decides: the button stays')
    await act(async () => { foot.root.unmount() })
    ok('rejoindre avec un lien : la ligne sous « Create a team » (liste du menu et panneau), le dialogue (coller, verifier, apercu, rejoindre), le jeton seul part vers l\'hote, bascule par le chemin ordinaire avec attente de la route, rien si l\'equipe n\'a pas de formule, une phrase par refus (404 en une seule, equipe pleine, trop d\'essais, injoignable, deconnecte), la page du serveur pour l\'imprevu, lien d\'un autre serveur nomme, autre adresse signalee')
  }

  // 6. One working folder per team (plan « Équipes », step 6): a switch to a team opens a NEW chat in its folder (registered as a DSH workspace), a switch back to Personal one in the
  // workspace the person had, a team that is created and takes over does the same after the route wait, a team that is active with no folder asks the host once, and a DSH that is not
  // there changes nothing. The pure rules are test-team-folder-nav.mjs's; the real DSH is scripts/check-team-folder-live.mjs.
  {
    const FOLDERS = { t1: '/docs/Kybernos/Acme', t2: '/docs/Kybernos/Studio B' }
    const dsh = (screen = 's-notes') => {
      const rows = [{ workspaceId: 'w-work', path: '/work', sessionIds: ['s-work'] }, { workspaceId: 'w-notes', path: '/notes', sessionIds: ['s-notes'] }]
      const log = { created: [], started: [] }
      const state = { screen }
      dshFake.workspaces = {
        list: { getSnapshot: () => ({ items: rows }), subscribe: () => () => {} },
        create: async ({ path }) => { log.created.push(path); let row = rows.find((r) => r.path === path); if (row === undefined) { row = { workspaceId: 'w-' + path.split('/').pop().toLowerCase().replace(/\W+/g, '-'), path, sessionIds: [] }; rows.push(row) } return row },
      }
      dshFake.uiWorkspace = { get mainReference() { return { sessionId: state.screen } }, startSession: (id) => { log.started.push(id) } }
      return log
    }
    const memory = {}
    globalThis.window.localStorage = { getItem: (k) => (k in memory ? memory[k] : null), setItem: (k, v) => { memory[k] = String(v) } }
    const activation = (id) => {
      const sp = id === 'p'
      return { workspaces: workspaces(3, 'admin'), team_folders: [FOLDERS.t1, FOLDERS.t2], ...(sp ? {} : { space_folder: FOLDERS[id] }) }
    }
    const reset = (active = 'p') => {
      world.status = { ...stateOf(3, 'admin', active), state: { ...stateOf(3, 'admin', active).state, team_folders: [FOLDERS.t1, FOLDERS.t2], ...(active === 'p' ? {} : { space_folder: FOLDERS[active] }) } }
      world.quota = quotaOf({ id: 'p', name: 'My workspace', role: 'owner', personal: true }, [win('member', 2592000, 3)])
      world.summary = SUMMARY(3)
      world.route = 'written'; world.activeOk = true; world.applied = [true]
      world.activeState = activation
      world.folderAnswer = { ok: true }
      world.calls.length = 0; world.bodies.length = 0
    }
    const pick = async (el, id) => { await open(el); await press(findAll(find(el, byClass('kbfp-menu')), byKb('space-row')).filter((r) => r.attributes['data-space'] === id)[0]); await settle(150) }

    // To a team: its folder is registered and a new chat is started in it, only once the route is applied.
    reset('p')
    let log = dsh('s-notes')
    let foot = await draw()
    await pick(foot.el, 't1')
    await settle(900)
    assert.deepEqual(log.created, [FOLDERS.t1], 'the team\'s folder is registered as a DSH workspace')
    assert.deepEqual(log.started, ['w-acme'], 'and a new chat is started in that workspace, named explicitly')
    assert.ok(world.calls.indexOf('POST /space/active') < world.calls.indexOf('POST /space/applied'), 'the switch, then the wait on the route')
    assert.equal(memory['kybernos-cloud.personal-folder'], '/notes', 'the folder of the chat that was on screen is kept as Personal\'s')
    await act(async () => { foot.root.unmount() })

    // Back to Personal: a new chat in the workspace the person had, not in the team's folder.
    reset('t1')
    log = dsh('s-acme')
    foot = await draw()
    await pick(foot.el, 'p')
    await settle(900)
    assert.deepEqual(log.created, [], 'nothing is registered for Personal')
    assert.deepEqual(log.started, ['w-notes'], 'a new chat is started in the remembered workspace, never by inheritance')
    assert.equal(memory['kybernos-cloud.personal-folder'], '/notes', 'a chat that is in a team\'s folder does not replace what was remembered')
    await act(async () => { foot.root.unmount() })

    // A switch that fails opens nothing; DSH's services absent change nothing.
    reset('p')
    world.activeOk = false
    log = dsh()
    foot = await draw()
    await pick(foot.el, 't1')
    await settle(300)
    assert.deepEqual(log.started, [], 'a switch the host refused opens no chat')
    await act(async () => { foot.root.unmount() })
    reset('p')
    dshFake.workspaces = undefined
    dshFake.uiWorkspace = undefined
    foot = await draw()
    await pick(foot.el, 't1')
    await settle(900)
    assert.ok(htmlDe(foot.el).includes('kbfp-cardname" title="Acme">Acme<'), 'with no DSH services the switch itself still works')
    await act(async () => { foot.root.unmount() })

    // A route that could not be rewritten still opens the chat in the team's folder (the choice is kept), after the notice.
    reset('p')
    world.route = 'failed'
    log = dsh()
    foot = await draw()
    await pick(foot.el, 't1')
    await settle(150)
    assert.deepEqual(log.started, ['w-acme'], 'the choice is kept: the chat opens in the team\'s folder')
    assert.ok(htmlDe(foot.el).includes('may still be billed to the previous team'), 'and the notice is still said')
    await act(async () => { foot.root.unmount() })

    // A team that is created and takes over (it has a plan): the same wait, then its chat; one without a plan opens nothing.
    reset('p')
    log = dsh()
    world.createAnswer = { ok: true, state: { ...stateOf(3, 'admin', 't1').state, space_folder: FOLDERS.t1, team_folders: [FOLDERS.t1] }, created: { id: 't1', name: 'Acme', plan_key: 'team', activated: true } }
    foot = await draw()
    await open(foot.el)
    await press(find(find(foot.el, byClass('kbfp-menu')), byKb('space-create')))
    await settle()
    await act(async () => { propsOf(find(foot.el, byClass('kbc-input'))).onChange({ target: { value: 'Acme' } }); await new Promise((r) => setTimeout(r, 0)) })
    await press(find(foot.el, byClass('kbc-btn-primary')))
    await settle(900)
    assert.deepEqual(log.started, ['w-acme'], 'a team created with a plan: its chat opens in its folder after the route wait')
    assert.ok(world.calls.indexOf('POST /space/create') < world.calls.indexOf('POST /space/applied'))
    await act(async () => { foot.root.unmount() })
    reset('p')
    log = dsh()
    world.createAnswer = { ok: true, state: { ...stateOf(3, 'admin', 'p').state, team_folders: [FOLDERS.t1] }, created: { id: 't1', name: 'Acme', plan_key: 'none', activated: false } }
    foot = await draw()
    await open(foot.el)
    await press(find(find(foot.el, byClass('kbfp-menu')), byKb('space-create')))
    await settle()
    await act(async () => { propsOf(find(foot.el, byClass('kbc-input'))).onChange({ target: { value: 'Acme' } }); await new Promise((r) => setTimeout(r, 0)) })
    await press(find(foot.el, byClass('kbc-btn-primary')))
    await settle(400)
    assert.deepEqual(log.started, [], 'a team created without a plan did not take over: no chat opens')
    await act(async () => { foot.root.unmount() })

    // An active team with no folder yet asks the host once; a team with one, and Personal, never ask.
    reset('t1')
    world.status = { ...world.status, state: { ...world.status.state, space_folder: undefined } }
    delete world.status.state.space_folder
    log = dsh()
    foot = await draw()
    await settle(100)
    assert.equal(world.calls.filter((c) => c === 'POST /space/folder').length, 1, 'an active team with no folder: the page asks the host once')
    assert.deepEqual(world.bodies.filter((b) => b.path === '/space/folder').map((b) => b.body), [{ workspace_id: 't1' }], 'naming the team, never a path')
    assert.deepEqual(log.started, [], 'and opens no chat')
    await act(async () => { foot.root.unmount() })
    reset('t1')
    foot = await draw()
    await settle(100)
    assert.equal(world.calls.filter((c) => c === 'POST /space/folder').length, 0, 'a team that has its folder asks nothing')
    await act(async () => { foot.root.unmount() })
    reset('p')
    foot = await draw()
    await settle(100)
    assert.equal(world.calls.filter((c) => c === 'POST /space/folder').length, 0, 'Personal has no folder and asks nothing')
    await act(async () => { foot.root.unmount() })

    // A team chosen by hand is not undone by the chat that was on screen (found by scripts/check-team-folder-live.mjs, which failed a different few checks on every run). The chat a
    // switch back to Personal opens is listed by DSH about half a second later; a click on a team inside that half second was answered by the follower's first look at that chat, which
    // found it in another space than the team just chosen and switched BACK. The follower looks at the chat while the switch waits for the route and again when DSH lists the new chat.
    {
      reset('p')
      const listeners = new Set()
      const rows = [{ workspaceId: 'w-work', path: '/work', sessionIds: ['s-work'] }]
      const started = []
      dshFake.workspaces = {
        list: { getSnapshot: () => ({ items: rows }), subscribe: (f) => { listeners.add(f); return () => listeners.delete(f) } },
        create: async ({ path }) => { let row = rows.find((r) => r.path === path); if (row === undefined) { row = { workspaceId: 'w-acme', path, sessionIds: [] }; rows.push(row) } return row },
      }
      dshFake.uiWorkspace = { get mainReference() { return { sessionId: 's-fresh' } }, startSession: (id) => { started.push(id) } }
      world.applied = [false, false, true]
      world.forFolder = () => {
        const active = world.status.state.active_workspace_id
        return { ok: true, kind: 'personal', space_id: 'p', space_name: 'My workspace', active_id: active, follow: active !== 'p' }
      }
      const foot = await draw()
      await settle(200)
      await pick(foot.el, 't1')
      rows[0].sessionIds.push('s-fresh')
      listeners.forEach((f) => f())
      await settle(500)
      listeners.forEach((f) => f())
      await settle(400)
      assert.ok(world.calls.includes('POST /space/for-folder'), 'the follower did look at the chat that DSH listed meanwhile, and told the host')
      assert.deepEqual(world.bodies.filter((b) => b.path === '/space/active').map((b) => b.body.workspace_id), ['t1'], 'the team the person chose is not switched back by the chat they were looking at')
      assert.equal(world.status.state.active_workspace_id, 't1', 'and it is still the active one')
      assert.deepEqual(started, ['w-acme'], 'the new chat opened in the team\'s folder')
      await act(async () => { foot.root.unmount() })
      world.forFolder = undefined
    }
    dshFake.workspaces = undefined
    dshFake.uiWorkspace = undefined
    delete globalThis.window.localStorage
    ok('un dossier par equipe : un changement vers une equipe enregistre son dossier comme espace de travail DSH et y ouvre un NOUVEAU chat (apres l\'attente de la route), le retour en Personal ouvre un chat dans l\'espace d\'avant (jamais par heritage), une route non reecrite ouvre quand meme le chat, une equipe creee avec formule fait de meme et sans formule rien, une equipe active sans dossier le demande une fois a l\'hote, DSH absent ne change rien')
  }
  doc.createElement = realCreate
  globalThis.window.addEventListener = realAdd
  globalThis.window.removeEventListener = realRemove
}

// « Open activation page » also copies the code: the page asks for it typed (it shows nothing of it, on purpose), so what is left there is to paste it.
{
  const open = clientSource.slice(clientSource.indexOf('const openPage = () => {'), clientSource.indexOf('const header = h(\'div\', { className: \'kbc-head\' }'))
  assert.ok(open.includes('copy()') && open.indexOf('copy()') < open.indexOf('window.open('), 'the page opens after the code is copied, in the same click')
  assert.ok(clientSource.includes('the code is copied, paste it there to confirm') && clientSource.includes('le code est copié, colle-le là-bas'), 'the card says so, in both languages')
  ok('Open activation page copies the code in the same click and the card says it is copied (both languages)')
}

console.log('\n' + pass + ' verifications OK')
