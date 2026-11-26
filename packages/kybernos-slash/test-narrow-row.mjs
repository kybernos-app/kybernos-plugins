#!/usr/bin/env node
/** Commands & actions at phone width (A3-22 of the 2026-10-16 pre-production audit).
 *
 *  Measured at 390 px with one command: the row's name kept about 50 px (« / w… ») between its tile and a chip plus three 40 px
 *  icon buttons, and the search field (220 px wide, at the end of the tab line) was cut by the page (« Search for a commanc »).
 *  Below 520 px the chip and the actions go on a line under the name, the tabs wrap, and the search takes its own line.
 *  Source-level (the bundle is a browser module); the measurement on the real GUI is `node scripts/check-phone-width-live.mjs`.
 *
 *  Usage: node packages/kybernos-slash/test-narrow-row.mjs   (exit 0 = all pass; KB_SLASH_CLIENT=<file> to test another copy) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const src = readFileSync(process.env.KB_SLASH_CLIENT || join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')
const at = src.indexOf('@media (max-width:520px){\n.kbsl-tabs{')
assert.ok(at > 0, 'a phone-width block for the Commands page')
const block = src.slice(at, src.indexOf('\n}\n', at))
assert.match(block, /\.kbsl-tabs\{flex-wrap:wrap/, 'the tab line wraps')
assert.match(block, /\.kbsl-tabs \.kbsl-search\{flex:1 1 100%;width:auto!important;margin-inline-start:0!important\}/, 'the search takes a whole line (it carries an inline width of 220 px, hence !important)')
assert.match(block, /\.kbsl-lrow\{flex-wrap:wrap/, 'a row wraps')
assert.match(block, /\.kbsl-lrow>\.kbsl-lmain\{flex:1 1 calc\(100% - 40px\)\}/, 'the name takes the whole line next to the tile')
assert.match(block, /\.kbsl-lrow>\.kbsl-chip\{margin-inline-start:40px\}/, 'the chip starts under the name')
assert.match(block, /\.kbsl-lrow>\.kbsl-chip\+\.kbsl-lacts\{margin-inline-start:auto;opacity:1\}/, 'the actions go to the end of that line, and show (a touch screen has no hover)')
console.log('  ✓ below 520 px the row, the tabs and the search of the Commands page wrap instead of squeezing the name')
console.log('\n1 check passed')
