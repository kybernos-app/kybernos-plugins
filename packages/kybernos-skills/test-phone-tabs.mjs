#!/usr/bin/env node
/** The four tabs of the Skills page fit a 390 px phone (A5-05 of the 2026-10-16 pre-production audit).
 *
 *  Measured at 390 px: the strip (Featured, Yours, Discover, Team) was 391 px wide in a 332 px box, scrolled sideways, and ended exactly
 *  after « Discover »: the fourth tab sat at x 364..400, out of sight, with nothing to say that it existed. Below 440 px the tabs are
 *  tighter (12 px of padding) and their counts, which the pages show too, are left out: the four fit with room to spare.
 *
 *  Source-level (the bundle is a browser module); the measurement on the real GUI is `node scripts/check-phone-width-live.mjs`.
 *
 *  Usage: node packages/kybernos-skills/test-phone-tabs.mjs   (exit 0 = all pass; KB_SKILLS_CLIENT=<file> to test another copy) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const src = readFileSync(process.env.KB_SKILLS_CLIENT || join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')
const at = src.indexOf('@media (max-width:440px){\n.kbs-root .kbsub button.kb-seg{')
assert.ok(at > 0, 'a phone block for the Skills tabs')
const block = src.slice(at, src.indexOf('\n}\n', at))
const pad = Number(/padding:0 (\d+)px/.exec(block)[1])
assert.ok(pad <= 12, 'tighter tabs: ' + pad + ' px of padding')
assert.match(block, /\.kbs-root \.kbsub \.count\{display:none\}/, 'no counts on the tabs')
// the four tabs (measured in English at 390 px: the labels are 56 + 36 + 54 + 30 px, « Team » has a 16 px icon and a 6 px gap), 3 gaps
// of 2 px, the capsule's 4 px padding and 1 px border on each side
const need = (56 + 36 + 54 + 30) + 22 + 8 * pad + 3 * 2 + 2 * 4 + 2
assert.ok(need <= 332, 'the four tabs need about ' + need + ' px, the strip has 332 px at 390 px')
console.log('  ✓ below 440 px the Skills tabs are tighter and drop their counts: about ' + need + ' px of the 332 px of the strip')
console.log('\n1 check passed')
