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

{
  // `.kbm-` is a prefix shared by three bundles: the Modeleur panel, kybernos-models' Settings page (`.kbm-root.kbmp`) and the core's own Models
  // page (a bare `.kbm-root`). The Modeleur says `kbmo` on its root and the entry asks for it. The cross-bundle check, on every panel of the list
  // and against the real sources of every bundle, is scripts/test-miniapps-panels.mjs; this is the same rule for the Modeleur, next to the code.
  const src = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
  ok("le Modeleur ne se reconnaît ni sur la page Réglages de kybernos-models ni sur la page Models du cœur (.kbm-root seul)", src.includes("racine: '.kbm-root.kbmo'") && !/racine: '\.kbm-root'/.test(src) && !src.includes('.kbm-root:not(.kbmp)'))
  const root = (cls) => ({ matches: (sel) => { const m = sel.match(/^((?:\.[a-z-]+)+)$/); return m !== null && m[1].split('.').filter(Boolean).every((c) => cls.includes(c)) } })
  ok('sélecteur : .kbm-root.kbmp (Réglages) et .kbm-root seul (page Models du cœur) sont écartés, .kbm-root.kbmo (Modeleur) est gardé',
    root(['kbm-root', 'kbmp']).matches('.kbm-root.kbmo') === false && root(['kbm-root']).matches('.kbm-root.kbmo') === false && root(['kbm-root', 'kbmo']).matches('.kbm-root.kbmo') === true)
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

console.log(echecs === 0 ? '\nClient : tout est vert.' : `\n✗ ${echecs} échec(s)`)
process.exit(echecs === 0 ? 0 : 1)
