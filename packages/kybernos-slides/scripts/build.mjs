#!/usr/bin/env node
// scripts/build.mjs — produit `client.js` (ne pas l'éditer à la main).
//
// Concatène : l'en-tête du chargeur de modules DSH + le bundle vendoré de
// TipTap (vendor/tiptap.iife.js, recette dsh-mermaid) + le corps de la
// fabrique (src/plugin.js), enveloppé d'un filet : une exception d'évaluation
// dégrade CE plugin sans casser les autres entrées (« Failed to load plugins »,
// incident du 23/09).
//
//   node scripts/build.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const vendor = readFileSync(join(root, 'vendor', 'tiptap.iife.js'), 'utf8').trimEnd()
const corps = readFileSync(join(root, 'src', 'plugin.js'), 'utf8')

const indent = (texte, prefixe) => texte.split('\n').map((l) => prefixe + l).join('\n')

const assemblé = `// @local/kybernos-slides — bundle client GÉNÉRÉ par scripts/build.mjs (ne pas éditer).
// TipTap 2.27 (MIT) vendoré — voir vendor/NOTICES.md.
window.__ModuleLoader__.load({
  id: '@local/kybernos-slides/client',
  factory (require) {
    try {
${indent(vendor, '      ')}
      return (function (TipTap) {
${indent(corps, '        ')}
      })(typeof __DSH_TIPTAP_NS !== 'undefined' ? __DSH_TIPTAP_NS : null)
    } catch (error) {
      // Une exception ici casserait TOUTE l'entrée : on dégrade, plugin désactivé.
      console.error('[kybernos-slides] évaluation impossible — plugin désactivé', error)
      return { name: 'kybernos-slides/client', inject: [], apply () {} }
    }
  }
})
`
writeFileSync(join(root, 'client.js'), assemblé)
console.log('client.js assemblé :', assemblé.split('\n').length, 'lignes')
