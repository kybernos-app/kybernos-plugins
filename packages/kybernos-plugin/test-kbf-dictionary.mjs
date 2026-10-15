#!/usr/bin/env node
/** R3 guard (recoupement 2026-10-15): a French `kbf('…')` label must have an English entry in `KB_FR_EN`,
 *  otherwise an English interface shows French (« Plein écran » on the Full page button of the creation dialog).
 *
 *  A short allowlist covers the sentence fragments that are glued to values or sent to the model, which are
 *  not labels. A new entry in the allowlist needs a reason; a new French label needs a dictionary entry.
 *
 *  Usage: node packages/kybernos-plugin/test-kbf-dictionary.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, 'client.js'), 'utf8')

const a = src.indexOf('const KB_FR_EN = {')
const b = src.indexOf('\nconst kbf = (fr) =>', a)
assert.ok(a > 0 && b > a, 'KB_FR_EN was found')
const dict = new Function('return ' + src.slice(a + 'const KB_FR_EN = '.length, b).trim())()
assert.ok(Object.keys(dict).length > 500, 'KB_FR_EN has its entries')

// Fragments, not labels: pieces of a sentence assembled with a value in between, and prompts sent to the model.
const FRAGMENTS = [
  ' — période de ',
  ' méthodes de mesure documentées, ',
  '.\\nMène des tours',
  '.\\nFais travailler',
  '\\n\\n— Rendu générique'
]
const isFragment = (s) => FRAGMENTS.some((f) => s.startsWith(f))
const FRENCH = /[éèêàùçôîâ]|\b(le|la|les|des|pour|avec|sans|une?|du|aucun|nouvelle?)\b/i

const re = /\bkbf\(\s*'((?:[^'\\\n]|\\.)*)'\s*[,)]/g
const missing = []
for (const m of src.matchAll(re)) {
  const s = m[1].replace(/\\'/g, "'").replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  if (dict[s] === undefined && FRENCH.test(s) && !isFragment(s)) {
    const line = src.slice(0, m.index).split('\n').length
    missing.push(line + ': ' + JSON.stringify(s))
  }
}
assert.deepEqual(missing, [], 'French kbf labels with no English entry:\n  ' + missing.join('\n  '))
ok('every French kbf label has an English entry in KB_FR_EN')

console.log('\n' + pass + ' checks passed')
