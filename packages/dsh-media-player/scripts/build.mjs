// scripts/build.mjs — produit `client/client.js` à partir de `src/plugin.js`.
//
// Le chargeur de modules DSH attend un bundle qui appelle
// `window.__ModuleLoader__.load({ id, factory })`. Ici la fabrique reçoit le
// `require` du chargeur (React est dans la table de modules de la plateforme)
// et rend l'objet plugin { name, inject, apply }.
//
// Le média n'embarque AUCUNE bibliothèque : <audio>/<video> natifs suffisent.
// Le bundle est donc minuscule et se génère sans dépendance externe.
//
// Usage : node scripts/build.mjs
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGE_ID = '@local/dsh-media-player'

const body = readFileSync(join(root, 'src', 'plugin.js'), 'utf8')

const assembled = `// @local/dsh-media-player — bundle client GÉNÉRÉ par scripts/build.mjs (ne pas éditer).
// Source : src/plugin.js. Aucun code tiers : lecteur natif du navigateur.
window.__ModuleLoader__.load({
  id: '${PACKAGE_ID}',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    try {
      var React = require('react')
      var plugin = (function (React) {
${indent(body, '        ')}
      })(React)
      exports.name = plugin.name
      exports.inject = plugin.inject
      exports.apply = plugin.apply
      exports.__test = plugin.__test
    } catch (error) {
      // Une exception ici casserait TOUTE l'entrée (« Failed to load plugins »)
      // et laisserait la GUI inutilisable : on dégrade, plugin désactivé.
      console.error('[dsh-media-player] évaluation impossible — plugin désactivé', error)
    }
    return module.exports
  }
})
`

/** Indente un bloc de source pour l'insérer dans la fabrique. */
function indent(text, prefix) {
  return text
    .split('\n')
    .map((line) => (line.length > 0 ? prefix + line : line))
    .join('\n')
}

mkdirSync(join(root, 'client'), { recursive: true })
const outPath = join(root, 'client', 'client.js')
writeFileSync(outPath, assembled)

// Vérification syntaxique immédiate : un bundle cassé ne doit jamais être installé.
execFileSync(process.execPath, ['--check', outPath], { stdio: 'inherit' })

const bytes = readFileSync(outPath).length
console.log(`[build] client/client.js — ${bytes} octets, syntaxe OK`)
