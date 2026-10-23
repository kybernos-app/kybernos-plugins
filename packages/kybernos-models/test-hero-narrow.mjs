#!/usr/bin/env node
/** The « Kybernos Cloud » card is one card tall on a phone, not 390 px (A3-18 of the 2026-10-16 pre-production audit).
 *
 *  Measured at 390 px, the old banner was a ~390 px box: in a narrow container it became a COLUMN, and the text block's `flex: 1 1 300px`
 *  then set its HEIGHT (a flex basis is a main size, and the main size of a column is its height). The banner is gone: the Cloud card is
 *  a cell of the provider grid with the anatomy of a provider card (a row, 76 px). This test keeps the cause out: no column rule, no flex
 *  basis on the text, a text line that shrinks and ellipsizes instead of pushing the card taller, an action column that keeps its size.
 *
 *  Usage: node packages/kybernos-models/test-hero-narrow.mjs   (exit 0 = all pass; KB_MODELS_CLIENT=<file> to test another copy) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const src = readFileSync(process.env.KB_MODELS_CLIENT || join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')
const rule = (sel) => { const m = new RegExp("'" + sel.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&') + '\\{([^}]*)\\}').exec(src); assert.ok(m !== null, 'the rule ' + sel + ' exists'); return m[1] }

assert.ok(!/@container[^']*\{\.kbmh-hero\{/.test(src), 'no narrow-container rule turns the Cloud card into a column')
assert.ok(!/\.kbmh-hero\{[^}]*flex-direction:column/.test(src), 'the Cloud card is never a flex column')
assert.ok(!/\.kbmh-hero[a-z-]*\{[^}]*flex:[^};]*\d+px/.test(src), 'and no part of it has a flex basis in pixels (in a column that is a height)')
console.log('  ✓ no column rule and no flex basis on the Cloud card')

assert.match(rule('.kbmh-hero-name'), /min-width:0/, 'the name line can shrink')
assert.match(rule('.kbmh-hero-sub'), /overflow:hidden;text-overflow:ellipsis/, 'the line under the name ellipsizes instead of wrapping')
assert.match(rule('.kbmh-hero-side'), /flex:none/, 'the actions keep their size')
console.log('  ✓ the text shrinks and ellipsizes, the actions keep their size')

console.log('\n2 checks passed')
