// ═══════════════════════════════════════════════════════════════════════════
// Tests de kybernos-miniapps — moitié CLIENT, hors navigateur (cas hostiles M-04).
//
//   node kybernos-miniapps/test-client.mjs
//
// M-04 : le HTML autonome exporté embarque titre + état JSON dans des balises
// <title>/<script> — toute fermeture de balise portée par la donnée doit être
// neutralisée (injection </script><script>…).
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs'

let echecs = 0
const ok = (label, cond, detail) => {
  if (cond) console.log(`✓ ${label}${detail === undefined ? '' : ` (${detail})`}`)
  else { console.error(`✗ ${label}${detail === undefined ? '' : ` — ${detail}`}`); echecs += 1 }
}

// ── faux navigateur ─────────────────────────────────────────────────────────
let definition = null
globalThis.window = {
  __ModuleLoader__: { load: (d) => { definition = d } },
  document: { querySelectorAll: () => [], scripts: [], styleSheets: [] },
  fetch: async () => { throw new Error('réseau interdit au harnais') },
}
globalThis.document = globalThis.window.document

new Function('window', 'document', readFileSync(new URL('./client.js', import.meta.url), 'utf8'))(globalThis.window, globalThis.document)
const T = definition.factory(() => { throw new Error('require inattendu') }).__test
ok('bundle client charge et expose __test', T !== null && typeof T.escTitre === 'function' && typeof T.jsonPourScript === 'function')

// ── A4-28: the App button of a mini-app must not sit over the player's own buttons ─────────────────────────────
// A mini-app has no head: the button used to float at the top-right corner of its root, exactly where the Quiz and Cards
// players keep « Check » / « Replay » (a click in the middle of that button installed an app). It now takes its own line above.
{
  const el = (tag) => ({
    tag, style: {}, className: '', textContent: '', title: '', children: [],
    prepend (n) { this.children.unshift(n) }, appendChild (n) { this.children.push(n) },
    querySelector (sel) { const m = /^:scope > \.(\S+)$/.exec(sel); return m === null ? null : (this.children.find((c) => c.className === m[1]) || null) },
  })
  globalThis.window.document.createElement = el
  const player = el('div')
  player.className = 'kbq-player'
  const root = el('div')
  root.children.push(player)
  T.majBouton({ racineDynamique: root, id: 'ma-quiz-demo-quiz', tete: null, defaut: 'quiz-demo', l: 420, h: 480, flottant: true })
  const btn = root.children[0]
  ok('A4-28: the button is the first thing of the mini-app, above the player (in the flow)', btn.className === 'kbmini-btn' && root.children[1] === player, root.children.map((c) => c.className).join())
  ok('A4-28: it does not float: no absolute position, no corner offsets', btn.style.position === undefined && btn.style.top === undefined && btn.style.insetInlineEnd === undefined && btn.style.zIndex === undefined, JSON.stringify(btn.style))
  ok('A4-28: it is right-aligned on its own line', btn.style.alignSelf === 'flex-end')
  ok('A4-28: the root is left as it was (no forced position)', root.style.position === undefined)
  T.majBouton({ racineDynamique: root, id: 'ma-quiz-demo-quiz', tete: null, defaut: 'quiz-demo', l: 420, h: 480, flottant: true })
  ok('A4-28: a second sweep does not add a second button', root.children.length === 2)
}

// ── M-04 : escTitre — le titre ne peut pas fermer <title> ───────────────────
{
  const piege = '</title><script>window.__M04 = "INJECTE"</script>'
  const echappe = T.escTitre(piege)
  ok('M-04 : escTitre neutralise </title> et <script>',
     echappe.includes('</title>') === false && echappe.includes('<script>') === false && echappe.includes('&lt;/title&gt;') === true, echappe.slice(0, 60))
  const page = '<!DOCTYPE html><html><head><title>' + echappe + '</title></head></html>'
  const ouvertes = (page.match(/<title>/g) || []).length
  ok('M-04 : une seule balise <title> dans la page générée', ouvertes === 1)
}
// ── M-04 : jsonPourScript — le JSON ne peut pas fermer <script> ─────────────
{
  const etat = JSON.stringify({ titre: '</script><script>window.__M04 = "INJECTE"</script>', points: ['Map<String, Integer>'] })
  const protege = T.jsonPourScript(etat)
  const page = '<script>var ETAT = ' + protege + ';</script>'
  // la page ne contient plus AUCUNE fermeture de script au milieu du JSON
  const fermuturesPrecoces = page.split('</script>').length - 1
  ok('M-04 : jsonPourScript neutralise </script> dans le JSON', fermuturesPrecoces === 1, `${fermuturesPrecoces} fermeture(s) — attendu 1 (la vraie fin)`)
  // le JSON reste VALIDE : <\/ redevient </ en JS
  const relu = JSON.parse(protege.replace(/<\\\//g, '</'))
  ok('M-04 : le JSON protégé re-lit la valeur d’origine', relu.titre.includes('</script><script>') === true && relu.points[0] === 'Map<String, Integer>')
}
// ── M-04 : serialiser — le titre fourni passe bien par escTitre ─────────────
{
  const racine = { innerHTML: '<div>x</div>', querySelectorAll: () => [], matches: () => false, querySelector: () => null, cloneNode: () => ({ innerHTML: '<div>x</div>', querySelectorAll: () => [], remove: () => {} }) }
  const html = T.serialiser(racine, { defaut: '</title><script>piege()</script>', racine: '.x' })
  ok('M-04 : serialiser échappe le titre piégé', html.includes('<title>&lt;/title&gt;') === true && html.includes('</title><script>') === false, html.slice(0, 90))
}

// ── T2-25 : a panel found in the page (`.kbma-root`) has `racineDynamique` and no `racine`: its sizing rule must name that class, not « undefined » ──
{
  const racine = { innerHTML: '<div>x</div>', querySelectorAll: () => [], matches: () => false, querySelector: () => null, cloneNode: () => ({ innerHTML: '<div>x</div>', querySelectorAll: () => [], remove: () => {} }) }
  const dynamique = T.serialiser(racine, { racineDynamique: racine, defaut: 'Quiz' })
  ok('T2-25 : a dynamic panel is exported with no `undefined{` rule', !dynamique.includes('undefined'), dynamique.slice(dynamique.indexOf('<style>'), dynamique.indexOf('<style>') + 160))
  ok('T2-25 : ...and its sizing rule names the `.kbma-root` class', dynamique.includes('.kbma-root{width:100%;height:100%;padding:8px;overflow:hidden}'))
  const statique = T.serialiser(racine, { racine: '.kbb-root', defaut: 'Bricks' })
  ok('T2-25 : a built-in panel keeps its own root selector', statique.includes('.kbb-root{width:100%;height:100%;padding:8px;overflow:hidden}') && !statique.includes('.kbma-root'))
}

// ── another bundle's live page (Motion): exporters and the install door ─────
{
  const racine = { getAttribute: (k) => (k === 'data-renderer' ? 'motion' : null) }
  const conf = { racineDynamique: racine, defaut: 'Défaut' }
  globalThis.window.__KB_MINIAPP_EXPORTERS__ = { motion: async (r) => (r === racine ? { titre: 'Live', html: '<html>live</html>' } : null) }
  const ex = await T.pageExport(conf)
  ok('a registered exporter provides the live page, before any snapshot', ex.html === '<html>live</html>' && ex.titre === 'Live', ex)
  globalThis.window.__KB_MINIAPP_EXPORTERS__ = { motion: async () => null }
  ok('an exporter that answers null falls through (the page is then a snapshot or live export)', (await T.exporterExterne(conf)) === null)
  globalThis.window.__KB_MINIAPP_EXPORTERS__ = { motion: async () => { throw new Error('x') } }
  ok('an exporter that throws never breaks the export', (await T.exporterExterne(conf)) === null)
  globalThis.window.__KB_MINIAPP_EXPORTERS__ = {}
  ok('no exporter for the renderer: null', (await T.exporterExterne(conf)) === null)
  ok('a root with no data-renderer: null', (await T.exporterExterne({ racineDynamique: { getAttribute: () => null }, defaut: 'x' })) === null)
  ok('install door: exposed on window, off until the host says macOS', globalThis.window.__KB_MINIAPPS__ === T.interfaceExterne && T.interfaceExterne.supported === false)
  const posted = []
  globalThis.window.fetch = async (url, init) => { posted.push([url, JSON.parse(init.body)]); return { json: async () => ({ ok: true }) } }
  const r = await T.interfaceExterne.install({ id: 'Motion Intro!', titre: 'Intro', html: '<html>x</html>', largeur: 500, hauteur: 300 })
  ok('install door: posts the page to the install route with a safe id', r.ok === true && posted[0][0] === '/kybernos-miniapps/install' && posted[0][1].id === 'motion-intro' && posted[0][1].html === '<html>x</html>' && posted[0][1].auto === false, posted)
}

{
  // `.kbm-` is the prefix of kybernos-models' Settings page (`.kbm-root.kbmp`) and of the core's own Models page (a bare `.kbm-root`). The Modeleur
  // panel has its own prefix, `kbmo-`, and the entry asks for its root. The cross-bundle check, on every panel of the list and against the real
  // sources of every bundle, is scripts/test-miniapps-panels.mjs; this is the same rule for the Modeleur, next to the code.
  const src = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
  ok("le Modeleur ne se reconnaît ni sur la page Réglages de kybernos-models ni sur la page Models du cœur (.kbm-root seul)", src.includes("racine: '.kbmo-root'") && !/racine: '\.kbm-root'/.test(src) && !src.includes('.kbm-root:not(.kbmp)'))
  const root = (cls) => ({ matches: (sel) => { const m = sel.match(/^((?:\.[a-z-]+)+)$/); return m !== null && m[1].split('.').filter(Boolean).every((c) => cls.includes(c)) } })
  ok('sélecteur : .kbm-root.kbmp (Réglages) et .kbm-root seul (page Models du cœur) sont écartés, .kbmo-root (Modeleur) est gardé',
    root(['kbm-root', 'kbmp']).matches('.kbmo-root') === false && root(['kbm-root']).matches('.kbmo-root') === false && root(['kbmo-root', 'kbmo']).matches('.kbmo-root') === true)
}

// ── the live export finds the engine the way DSH loaded it ──────────────────
// The module is not in a <script> of the page: DSH's boot script lists its address in a JSON manifest (quotes escaped). The first
// inline script that merely MENTIONED the module was taken for the engine, and the exported Bricks app opened with a bar and no scene.
{
  const MARQUE = 'kybernos-bricks/client'
  const MODULE = "window.__ModuleLoader__.load({\n  id: '@local/kybernos-bricks/client',\n  factory: () => ({})\n})"
  const BS = String.fromCharCode(92) // a backslash
  // what the boot script really contains: a JSON manifest inside a string, with backslash-escaped quotes
  const BOOT = 'var m = "[{' + BS + '"id' + BS + '":' + BS + '"@local/kybernos-bricks' + BS + '",' + BS + '"url' + BS + '":' + BS + '"plugins/??@local/kybernos-bricks/client.js&rev=ff7aa3035718' + BS + '",' + BS + '"rev' + BS + '":' + BS + '"ff7aa3035718' + BS + '"}]"'
  const essai = async ({ scripts, reponses }) => {
    const demandes = []
    globalThis.window.document.scripts = scripts
    globalThis.window.document.baseURI = 'http://127.0.0.1:3080/'
    globalThis.window.fetch = async (url) => {
      demandes.push(String(url))
      const r = reponses[String(url)]
      if (r === undefined) throw new Error('no route')
      return { ok: r.ok !== false, text: async () => r.text }
    }
    return { texte: await T.sourceModule(MARQUE), demandes }
  }
  const URL_MODULE = 'http://127.0.0.1:3080/plugins/??@local/kybernos-bricks/client.js&rev=ff7aa3035718'

  let r = await essai({ scripts: [{ textContent: BOOT }], reponses: { [URL_MODULE]: { text: MODULE } } })
  ok('the boot script is NOT taken for the engine: its manifest address is followed, relative to the page', r.texte === MODULE && r.demandes.length === 1 && r.demandes[0] === URL_MODULE, JSON.stringify(r.demandes))

  r = await essai({ scripts: [{ textContent: BOOT }, { textContent: MODULE }], reponses: {} })
  ok('an inline script that DEFINES the module is used as it is, with no request', r.texte === MODULE && r.demandes.length === 0)

  r = await essai({ scripts: [{ src: 'http://127.0.0.1:3080/plugins/??@local/kybernos-bricks/client.js&rev=1' }], reponses: { 'http://127.0.0.1:3080/plugins/??@local/kybernos-bricks/client.js&rev=1': { text: MODULE } } })
  ok('a <script src> whose text defines the module is used', r.texte === MODULE)

  r = await essai({ scripts: [{ src: 'http://127.0.0.1:3080/plugins/??@local/kybernos-bricks/client.js&rev=1' }], reponses: { 'http://127.0.0.1:3080/plugins/??@local/kybernos-bricks/client.js&rev=1': { text: '// something else that mentions kybernos-bricks/client' } } })
  ok('...but a text that only mentions it is refused', r.texte === null)

  r = await essai({ scripts: [{ textContent: BOOT }], reponses: { [URL_MODULE]: { text: 'not the module' } } })
  ok('an address that serves something else gives null (the export then falls back to a still snapshot)', r.texte === null)

  r = await essai({ scripts: [{ textContent: BOOT }], reponses: { [URL_MODULE]: { ok: false, text: 'nope' } } })
  ok('an address that answers with an error gives null', r.texte === null)

  r = await essai({ scripts: [{ textContent: BOOT }], reponses: {} })
  ok('an address that does not answer at all gives null, it does not throw', r.texte === null)

  r = await essai({ scripts: [{ textContent: 'var x = 1' }, { textContent: '' }, { src: 'http://127.0.0.1:3080/plugins/other.js' }], reponses: {} })
  ok('a page without the module gives null and asks nothing', r.texte === null && r.demandes.length === 0)

  const autre = BOOT.split('kybernos-bricks').join('kybernos-slides')
  r = await essai({ scripts: [{ textContent: BOOT + autre }], reponses: { [URL_MODULE]: { text: MODULE } } })
  ok('only the address of the asked module is followed, not the other modules of the manifest', r.demandes.length === 1 && r.demandes[0] === URL_MODULE, JSON.stringify(r.demandes))
}

// ── the menu stays inside the window ────────────────────────────────────────
{
  const P = T.placerMenu
  const W = 1400, H = 900
  const bouton = (left, top) => ({ left, right: left + 60, top, bottom: top + 24 })
  let p = P(bouton(300, 100), 190, 120, W, H)
  ok('room around the button: under it, left edges aligned', p.left === 300 && p.top === 130, JSON.stringify(p))
  p = P(bouton(W - 70, 60), 190, 120, W, H)
  ok('a button at the right edge: the menu is pulled back so it ends inside the window (it ran ~110 px out)', p.left + 190 <= W - 8 && p.left >= 8, JSON.stringify(p))
  p = P(bouton(2, 60), 190, 120, W, H)
  ok('a button at the left edge: the menu keeps a margin', p.left === 8, JSON.stringify(p))
  p = P(bouton(300, H - 30), 190, 120, W, H)
  ok('no room below: it opens above the button', p.top + 120 <= H - 30 && p.top >= 8, JSON.stringify(p))
  p = P(bouton(300, 20), 190, 300, W, 200)
  ok('a window smaller than the menu: it is pinned to the margin, never negative', p.top >= 8 && p.left >= 8, JSON.stringify(p))
  const src = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
  ok('the menu uses it, with its measured size', /placerMenu\(r, menu\.offsetWidth \|\| 190, menu\.offsetHeight \|\| 120/.test(src))
  ok('a sweep skipped by the throttle is replayed once the quiet period is over, not dropped', /balayageDiffere = setTimeout\(\(\) => \{ balayageDiffere = null; balayer\(\) \}, attente\)/.test(src) && !/< 200\) return/.test(src))
}

// ── la langue (A2-31, A2-08) : français pour le français, anglais pour toute autre langue ──
{
  const noms = () => T.PANNEAUX.map((x) => x.defaut).join(' | ')
  for (const [lg, attendu, interdit] of [
    ['en', 'Bricks | 3D modeller | Slides', /Briques|Modeleur/],
    ['kybernos', 'Briques | Modeleur | Slides', /Bricks|3D modeller/],
    ['es', 'Bricks | 3D modeller | Slides', /Briques|Modeleur/],
    ['ar', 'Bricks | 3D modeller | Slides', /Briques|Modeleur/],
  ]) {
    globalThis.window.__KB_LANG_RESOLVE__ = () => lg
    ok(`langue « ${lg} » : les noms de panneaux (titre de l'app installée) suivent la langue`, noms() === attendu && !interdit.test(noms()), noms())
    const mots = [T.kt('Lancer', 'Launch'), T.kt('Démarrage auto', 'Launch at login'), T.kt('Désinstaller', 'Uninstall')].join(' | ')
    ok(`langue « ${lg} » : le menu de l'app parle la langue`, lg === 'kybernos' ? mots === 'Lancer | Démarrage auto | Désinstaller' : mots === 'Launch | Launch at login | Uninstall', mots)
  }
  globalThis.window.__KB_LANG_RESOLVE__ = () => { throw new Error('langue pas encore connue') }
  ok('langue pas encore connue : anglais', T.kt('Lancer', 'Launch') === 'Launch')
}

// ── L3-06: the reason the host gives for a refused install reaches the person (it used to be thrown away) ──
{
  const el = (tag) => ({
    tag, style: {}, className: '', textContent: '', title: '', children: [], attrs: {}, disabled: false,
    prepend (n) { this.children.unshift(n) }, appendChild (n) { this.children.push(n) }, setAttribute (k, v) { this.attrs[k] = v }, remove () {},
    querySelector () { return null },
  })
  globalThis.window.document.createElement = el
  const toasts = []
  globalThis.window.document.body = { appendChild: (n) => { toasts.push(n) } }
  globalThis.window.__KB_MINIAPP_EXPORTERS__ = { motion: async () => ({ titre: 'Intro', html: '<html>live</html>' }) }
  let n = 0
  /** Click the App button of a fresh mini-app while the host answers `reponse` (a function throws when called with the request). */
  const clique = async (reponse) => {
    n += 1
    const racine = el('div')
    racine.getAttribute = (k) => (k === 'data-renderer' ? 'motion' : null)
    globalThis.window.fetch = async () => (typeof reponse === 'function' ? reponse() : { json: async () => reponse })
    T.majBouton({ racineDynamique: racine, id: 'essai-' + n, tete: null, defaut: 'essai', l: 300, h: 300, flottant: false })
    await racine.children[0].onclick()
    return toasts[toasts.length - 1]
  }
  const REFUS = {
    codesign: { ok: false, code: 'codesign', erreur: 'Cannot sign the app (codesign).' },
    'html-short': { ok: false, code: 'html-short', erreur: 'HTML too short.' },
    'html-long': { ok: false, code: 'html-long', erreur: 'HTML too large.' },
    'name-refused': { ok: false, code: 'name-refused', erreur: 'app name refused (outside the install folder).' },
    'macos-only': { ok: false, code: 'macos-only', erreur: 'Installing a widget app is macOS only.' },
  }
  globalThis.window.__KB_LANG_RESOLVE__ = () => 'en'
  const sig = await clique(REFUS.codesign)
  ok('L3-06: a codesign refusal says that the signing failed, with a hook for the checks', sig.attrs['data-kb'] === 'miniapps-install-error' && /^Cannot install: signing the app failed/.test(sig.textContent), sig.textContent)
  globalThis.window.__KB_LANG_RESOLVE__ = () => 'fr'
  const sigFr = await clique(REFUS.codesign)
  ok('L3-06: the same, in French', /^Installation impossible : la signature de l’app a échoué/.test(sigFr.textContent), sigFr.textContent)
  globalThis.window.__KB_LANG_RESOLVE__ = () => 'en'
  const causes = new Set()
  for (const code of Object.keys(REFUS)) {
    const t = await clique(REFUS[code])
    causes.add(t.textContent)
    ok('L3-06: ' + code + ' has its own sentence, not the generic one', t.textContent.startsWith('Cannot install: ') && t.textContent !== 'Installation failed.', t.textContent)
  }
  ok('L3-06: the five refusals read differently (the person can tell what to do)', causes.size === 5)
  const inconnu = await clique({ ok: false, code: 'something-new' })
  const sansCode = await clique({ ok: false, erreur: 'Cannot sign the app (codesign).' })
  const hote = await clique(() => { throw new Error('host down') })
  ok('L3-06: an unknown code, an answer without a code and a host that does not answer keep the generic sentence (and the hook)',
    [inconnu, sansCode, hote].every((t) => t.textContent === 'Installation failed.' && t.attrs['data-kb'] === 'miniapps-install-error'))
  const bon = await clique({ ok: true, chemin: '/x' })
  ok('L3-06: a successful install is not an error toast', bon.attrs['data-kb'] === undefined && /installed/.test(bon.textContent), bon.textContent)
  ok('L3-06: a hostile code cannot pick a prototype member as its sentence', T.messageEchecInstallation({ code: 'constructor' }) === 'Installation failed.' && T.messageEchecInstallation({ code: '__proto__' }) === 'Installation failed.')
}

console.log(echecs === 0 ? '\nClient : tout est vert.' : `\n✗ ${echecs} échec(s)`)
process.exit(echecs === 0 ? 0 : 1)
