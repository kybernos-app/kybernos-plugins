#!/usr/bin/env node
/** R2 guard (recoupement 2026-10-15): the English description of « Rename Chat session after each recap » must
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
const at = src.indexOf("'Rename Chat session after each recap')")
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

console.log('\n' + pass + ' checks passed')
