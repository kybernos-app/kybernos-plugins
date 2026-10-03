// scripts/build.mjs — produit `client/client.js`.
//
//   1. vendor `echarts` (UMD officiel, vendoré pour rester hors ligne)
//      → injecté dans la fabrique avec `module/exports/define` masqués pour que
//        l'UMD prenne la branche globale (sinon il s'accrocherait aux `exports`
//        de la fabrique et `window.echarts` resterait vide).
//   2. concatène l'en-tête du chargeur de modules DSH + le vendor + la fabrique
//      du plugin (src/plugin.js).
//
// Usage : node scripts/build.mjs
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pluginBody = readFileSync(join(root, 'src', 'plugin.js'), 'utf8')
const echartsUmd = readFileSync(join(root, 'vendor', 'echarts.min.js'), 'utf8')

const assembled = `// @local/dsh-db-viewer — bundle client GÉNÉRÉ par scripts/build.mjs (ne pas éditer).
// Source lisible : src/plugin.js. ECharts vendoré : vendor/echarts.min.js (Apache-2.0).
window.__ModuleLoader__.load({
  id: '@local/dsh-db-viewer',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    try {
      var React = require('react')
      // Le vendor UMD : module/exports/define passés à undefined pour forcer la
      // branche globale → window.echarts. Échec isolé : la vue Graphiques
      // dégrade, le reste du plugin vit.
      var echarts = null
      try {
        ;(function (module, exports, define) {
${indent(echartsUmd, '          ')}
        }).call(typeof window !== 'undefined' ? window : globalThis, undefined, undefined, undefined)
        echarts = (typeof window !== 'undefined' && window.echarts) || (typeof globalThis !== 'undefined' && globalThis.echarts) || null
      } catch (error) {
        console.error('[dsh-db-viewer] vendor echarts indisponible — vue Graphiques désactivée', error)
      }
      var plugin = (function (React, echarts) {
${indent(pluginBody, '        ')}
      })(React, echarts)
      exports.name = plugin.name
      exports.inject = plugin.inject
      exports.apply = plugin.apply
      exports.__test = plugin.__test
    } catch (error) {
      // Une exception ici casserait TOUTE l'entrée (« Failed to load plugins »)
      // et laisserait la GUI inutilisable : on dégrade, plugin désactivé.
      console.error('[dsh-db-viewer] évaluation impossible — plugin désactivé', error)
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

// Vérification syntaxique immédiate — `node --check` est un faux vert sur Node
// 26 (mesuré) : on parse vraiment via une Function compilée.
execFileSync(process.execPath, ['-e', 'new Function(require("fs").readFileSync(process.argv[1], "utf8"))', outPath], { stdio: 'inherit' })

const ko = (readFileSync(outPath).length / 1024).toFixed(0)
console.log(`[build] client/client.js — ${ko} Ko, vraie parse OK`)
