#!/usr/bin/env node
/** R2 guard (recoupement 2026-10-15): the English description of the rename setting (« Name each chat when it ends ») must
 *  not contain a French word. The word « chantier » shipped in an English setting for weeks, and a commit
 *  message said it had been replaced while the code still had it.
 *
 *  Usage: node packages/kybernos-sessions/test-wording.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, 'client.js'), 'utf8')

// The two descriptions sit right after the setting's title.
const TITLE = 'Name each chat when it ends'
const at = src.indexOf("'" + TITLE + "')")
assert.ok(at > 0, 'the setting was found')
const region = src.slice(at, at + 900)
const on = /'(On: [^']*)'/.exec(region)
const off = /'(Off: [^']*)'/.exec(region)
assert.ok(on !== null && off !== null, 'both descriptions were found')

{
  const FRENCH = /\b(chantier|séance|fin de|quand|titre|récap|le|la|les|des|du|une?)\b|[éèêàùç]/i
  assert.ok(!FRENCH.test(on[1]), 'the « On » description has no French word: ' + on[1])
  assert.ok(!FRENCH.test(off[1]), 'the « Off » description has no French word: ' + off[1])
  ok('the English descriptions of the rename setting contain no French word')
}

{
  assert.ok(/work session/i.test(on[1]), 'the « On » description says « work session »')
  ok('the « On » description says « work session »')
}

// A3-42: a person reads what the switch does, not how it is drawn, and the title is a plain sentence (no capital mid-sentence).
{
  assert.ok(!/svg|emoji|glyph/i.test(on[1] + off[1]), 'the descriptions say nothing of SVG or emoji: ' + on[1] + ' / ' + off[1])
  assert.ok(/^[A-Z][a-z]*( [a-z]+)*$/.test(TITLE), 'the title has one capital, at its start')
  assert.ok(!src.includes('Rename Chat session'), 'the old title \u00ab Rename Chat session after each recap \u00bb is gone everywhere in the bundle')
  ok('the rename setting is a plain sentence with no implementation detail')
}

console.log('\n' + pass + ' checks passed')
