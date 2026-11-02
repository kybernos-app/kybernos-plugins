#!/usr/bin/env node
/** A Workers row in a narrow page does not push its chevron past the page (A3-19 of the 2026-10-16 pre-production audit).
 *
 *  Measured at 390 px: the settings content scrolled sideways (scrollWidth 401 for 369) and « Details » sat at x 369..409.
 *  In a narrow container the row is a grid whose last column was a fixed 28 px, while the phone sheet gives every settings button
 *  a 40 px minimum: the chevron overflowed its column by 12 px. The column now follows the chevron, which also sits on the
 *  line of the row's action instead of far from it.
 *
 *  Source-level (the bundle is a browser module); the measurement on the real GUI is `node scripts/check-phone-width-live.mjs`.
 *
 *  Usage: node packages/kybernos-workers/test-narrow-row.mjs   (exit 0 = all pass; KB_WORKERS_CLIENT=<file> to test another copy) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const src = readFileSync(process.env.KB_WORKERS_CLIENT || join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')
const at = src.indexOf('@container kbwk (max-width:640px){')
assert.ok(at > 0, 'the narrow-container block exists')
const block = src.slice(at, src.indexOf("'}',", at))
let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

const grid = /'\.kbwk-row\{grid-template-columns:([^}]*)\}'/.exec(block)
assert.ok(grid !== null, 'the narrow row declares its columns')
assert.ok(!/\b28px\b/.test(grid[1]), 'no fixed 28 px column for the chevron (a phone makes it 36-40 px): ' + grid[1])
ok('the last column of a narrow row is sized by the chevron, not fixed at 28 px')

assert.match(block, /\.kbwk-chev\{grid-column:3;grid-row:3\}/, 'the chevron is on the line of the action')
assert.match(block, /\.kbwk-ctl\{[^}]*grid-row:3[^}]*flex-wrap:wrap/, 'the action shares that line and wraps rather than widening the page')
ok('the chevron and the action are on the same line, and the action can wrap')

console.log('\n' + pass + ' checks passed')
