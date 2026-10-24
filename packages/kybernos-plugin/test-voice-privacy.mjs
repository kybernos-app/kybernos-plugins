#!/usr/bin/env node
/** The Voice page's confidentiality line names the right machine (T1-17, 2026-10-24).
 *  Piper and Supertonic run on Linux and Windows too, yet read « Stays on this Mac »; only Apple `say` is Mac-only.
 *  Usage: node packages/kybernos-plugin/test-voice-privacy.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const host = readFileSync(join(here, 'index.js'), 'utf8')
const client = readFileSync(join(here, 'client.js'), 'utf8')

const privacyOf = (id) => {
  const m = new RegExp("\\{ id: '" + id + "', name: '[^']*', kind: 'local', price: 'free', privacy: '([^']*)' \\}").exec(host)
  assert.ok(m !== null, 'the engine ' + id + ' is in the catalogue')
  return m[1]
}
assert.equal(privacyOf('say'), 'Stays on this Mac. Nothing leaves it.', 'Apple say exists on the Mac only')
assert.equal(privacyOf('piper'), 'Stays on this computer. Nothing leaves it.', 'Piper runs on any computer')
assert.equal(privacyOf('supertonic'), 'Stays on this computer. Nothing leaves it.', 'Supertonic runs on any computer')
console.log('  ✓ only the Mac-only engine says « Mac »; Piper and Supertonic say « computer »')

const n = client.indexOf('const kbttsConfidentialite = ')
const fn = new Function('kbe', client.slice(n, client.indexOf('\n', n)) + '\nreturn kbttsConfidentialite')((s) => '[' + s + ']')
assert.equal(fn('Stays on this Mac. Nothing leaves it.'), '[Stays on this Mac. Nothing leaves it.]')
assert.equal(fn('Stays on this computer. Nothing leaves it.'), '[Stays on this computer. Nothing leaves it.]', 'the page translates the new line (otherwise it would print it in English in a French page)')
assert.equal(fn('something else'), 'something else')
assert.ok(client.includes("'Reste sur cet ordinateur. Rien n’en sort.': 'Stays on this computer. Nothing leaves it.',"), 'and the French line exists')
console.log('  ✓ the page translates both lines, and the French dictionary has the new one')
console.log('\n2 checks passed')
