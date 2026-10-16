#!/usr/bin/env node
/** Pages of the core plugin that did not fit a 390 px phone (audit 2026-10-16, package WP-17).
 *
 *  Source-level (the bundle is a browser module); the matching measurements on the real GUI are in
 *  `node scripts/check-phone-width-live.mjs`, run on a sandbox.
 *
 *  Usage: node packages/kybernos-plugin/test-phone-width.mjs   (exit 0 = all pass; KB_PLUGIN_CLIENT=<file> to test another copy) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const src = readFileSync(process.env.KB_PLUGIN_CLIENT || join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')

// Settings › Tools: the profile card is a column of rows. `.kbt2-stat` wraps (flex-wrap: wrap), and a column that wraps stretches its
// rows to their content width instead of its own: the config path (max 340 px) pushed the copy button 36 px past the card and the
// whole Settings page scrolled sideways at 390 px. The card says « no wrap » where it says « column ».
{
  const cards = [...src.matchAll(/className: '(kbt2-stat[^']*)'[^\n]*style: \{ flexDirection: 'column',([^}]*)\}/g)]
  assert.ok(cards.length >= 2, 'the profile card and its skeleton are where the test expects them (' + cards.length + ')')
  for (const c of cards) assert.match(c[0], /flexDirection: 'column', flexWrap: 'nowrap'/, 'a column card of the Tools page does not wrap: ' + c[1].trim())
  ok('the Tools profile card (and its skeleton) is a column that does not wrap')
}

console.log('\n' + pass + ' checks passed')
