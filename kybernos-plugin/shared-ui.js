// ═══════════════════════════════════════════════════════════════════════════
// shared-ui.js — le pont entre le design system partagé et le plugin DSH.
//
//   node scripts/build-shared-ui.mjs   (génère shared-ui.css + shared-ui.ts)
//
// Ce module charge `shared-ui.css` (généré depuis les modules CSS de DSH) et
// l'injecte dans le plugin via `styles.insert()`. Les classes `kbm-*` deviennent
// alors disponibles dans le plugin DSH.
//
// Usage dans client.js (après la réservation par un autre chat) :
//   const { injectSharedUI } = require('./shared-ui.js')
//   ctx.effect(() => injectSharedUI(styles), 'shared-ui: design system DSH')
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Injecte le CSS du design system partagé dans le plugin.
 * @param {object} styles - l'objet styles du plugin (avec insert(css))
 * @returns {() => void} une fonction de nettoyage
 */
function injectSharedUI(styles) {
  const css = readFileSync(join(__dirname, 'shared-ui.css'), 'utf8')
  return styles.insert(css)
}

export { injectSharedUI }
