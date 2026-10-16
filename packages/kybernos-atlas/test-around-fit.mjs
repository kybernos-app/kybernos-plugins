#!/usr/bin/env node
/** Atlas › Around shows its four columns at 1400 px (A4-23 of the 2026-10-16 pre-production audit).
 *
 *  Measured on the real GUI at 1400 px: the Around card is 786 px wide (the rail takes 300 of the page's 1104), i.e. 746 px of
 *  content, and the grid asked for 4 columns of 176 px at least with a 52 px gap (860 px, min-width 820 px): the fourth column
 *  (« Memory & lessons ») started at x 1293 of a card that ends at 1375, behind a scroll bar.
 *
 *  Source-level (the bundle is a browser module); the measurement on the real GUI is `node scripts/check-phone-width-live.mjs`.
 *
 *  Usage: node packages/kybernos-atlas/test-around-fit.mjs   (exit 0 = all pass; KB_ATLAS_CLIENT=<file> to test another copy) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const src = readFileSync(process.env.KB_ATLAS_CLIENT || join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')
const m = /\n\.kbat-grid\{([^}]*)\}/.exec(src)
assert.ok(m !== null, 'the Around grid has a rule')
const body = m[1]
const cols = /grid-template-columns:repeat\(4,minmax\((\d+)px,1fr\)\)/.exec(body)
assert.ok(cols !== null, 'four columns with a minimum width')
const gap = /column-gap:(?:clamp\(\d+px,[^,]+,(\d+)px\)|(\d+)px)/.exec(body)
assert.ok(gap !== null, 'a column gap')
const gapMax = Number(gap[1] || gap[2])
const need = 4 * Number(cols[1]) + 3 * gapMax
const minW = Number(/min-width:(\d+)px/.exec(body)[1])
const CARD_CONTENT = 746 // measured at 1400 px: 786 px card, 20 px of padding each side
assert.ok(need <= CARD_CONTENT, 'four columns of ' + cols[1] + ' px and gaps of ' + gapMax + ' px need ' + need + ' px: they fit the 746 px of the card at 1400 px')
assert.ok(minW <= CARD_CONTENT, 'the grid\'s own minimum width (' + minW + ' px) does not exceed the card (it used to be 820 px: a sideways scroll bar)')
console.log('  ✓ the four columns of the Around view (' + need + ' px at most) fit the 746 px of the card at 1400 px; its minimum width is ' + minW + ' px')
console.log('\n1 check passed')
