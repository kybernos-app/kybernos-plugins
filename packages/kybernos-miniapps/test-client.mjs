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

console.log(echecs === 0 ? '\nClient : tout est vert.' : `\n✗ ${echecs} échec(s)`)
process.exit(echecs === 0 ? 0 : 1)
