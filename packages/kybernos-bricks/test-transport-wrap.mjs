#!/usr/bin/env node
/** The transport row of Briques and Modeleur wraps instead of leaving the screen (A4-32 of the 2026-10-16 pre-production audit).
 *
 *  Measured at 390 px: eight controls (three transport buttons, four speeds, the « Fini » badge) of 44 px each (the phone sheet's
 *  minimum for the right bar) and 7 px gaps need 401 px in a 390 px screen: the badge sat at x 370..408 and was cut (« Fi »). The row
 *  did not wrap. (The first number of the counter, dark on dark, is a colour: left to the contrast package.)
 *
 *  Source-level; the measurement on the real GUI is `node scripts/check-phone-width-live.mjs`.
 *
 *  Usage: node packages/kybernos-bricks/test-transport-wrap.mjs   (exit 0 = all pass; KB_BRICKS_CLIENT / KB_MODELEUR_CLIENT=<file> to test another copy) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const files = [
  ['Briques', process.env.KB_BRICKS_CLIENT || join(here, 'client.js'), '.kbb-line'],
  ['Modeleur', process.env.KB_MODELEUR_CLIENT || join(here, '..', 'kybernos-modeleur', 'client.js'), '.kbm-line'],
]
for (const [name, file, sel] of files) {
  const src = readFileSync(file, 'utf8')
  const m = new RegExp('\\n' + sel.replace('.', '\\.') + '\\{([^}]*)\\}').exec(src)
  assert.ok(m !== null, name + ': the transport row has a rule')
  assert.match(m[1], /flex-wrap:wrap/, name + ': the transport row wraps when its eight controls do not fit')
  console.log('  ✓ ' + name + ': the transport row wraps')
}
console.log('\n2 checks passed')
