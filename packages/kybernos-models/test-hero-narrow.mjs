#!/usr/bin/env node
/** The « Kybernos Cloud · Start for free » banner is not 390 px tall on a phone (A3-18 of the 2026-10-16 pre-production audit).
 *
 *  Measured at 390 px: the banner was a ~390 px box with its title at the top, « Start for free » in the middle and the two buttons
 *  at the bottom, with large empty bands between them. Cause: in a narrow container the banner becomes a COLUMN, and the text
 *  block's `flex: 1 1 300px` then sets its HEIGHT (a flex basis is a main size, and the main size of a column is its height).
 *  Source-level: the narrow rule takes the text block out of the growing/basis business and lets the buttons wrap.
 *
 *  Usage: node packages/kybernos-models/test-hero-narrow.mjs   (exit 0 = all pass; KB_MODELS_CLIENT=<file> to test another copy) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const src = readFileSync(process.env.KB_MODELS_CLIENT || join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')
const q = /'@container \(max-width: 520px\)\{(\.kbmh-hero\{[^}]*\})([^']*)\}'/.exec(src)
assert.ok(q !== null, 'the narrow-container rule of the banner exists')
assert.match(q[1], /flex-direction:column/, 'the banner is a column when it is narrow')
assert.match(q[2], /\.kbmh-hero-main\{flex:0 0 auto\}/, 'and its text block has no flex basis (in a column a basis of 300 px is a height of 300 px)')
assert.match(q[2], /\.kbmh-hero-cta\{flex:0 0 auto;flex-wrap:wrap\}/, 'its buttons take their own height and wrap')
console.log('  ✓ in a narrow banner the text block and the buttons size themselves (no 300 px basis in a column)')
console.log('\n1 check passed')
