#!/usr/bin/env node
/** Guard for the English-based phrases of the core client (decision D1: English is the base of every UI string).
 *
 *  A phrase is written `kbe('English text')`; its French twin is the KB_FR_EN key whose VALUE is that English text (the table maps French source →
 *  English). So a `kbe('…')` literal must be the value of exactly one KB_FR_EN entry, otherwise the French UI shows English (no twin) or a wrong French
 *  (two keys share the English text: then the call must name the French itself, `kbe(' answered', ' répondues')`).
 *  The French UI is also checked from the other side: no `kbe` literal may still be French, and `kbf` (the old French-keyed call) is gone.
 *
 *  Usage: node packages/kybernos-plugin/test-kbe-dictionary.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, 'client.js'), 'utf8')

const a = src.indexOf('const KB_FR_EN = {')
const b = src.indexOf('\n}\n', a) + 2
assert.ok(a > 0 && b > a, 'KB_FR_EN was found')
const dict = new Function('return ' + src.slice(a + 'const KB_FR_EN = '.length, b).trim())()
assert.ok(Object.keys(dict).length > 500, 'KB_FR_EN has its entries')
const keysOf = new Map()
for (const [fr, en] of Object.entries(dict)) { if (!keysOf.has(en)) keysOf.set(en, []); keysOf.get(en).push(fr) }

const cook = (s) => s.replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\(['"\\])/g, '$1').replace(/\\n/g, '\n')

// kbe('English') and kbe("English"), one literal argument; a second argument names the French
const re = /\bkbe\(\s*(['"])((?:\\.|(?!\1)[^\\\n])*)\1\s*([,)])/g
const noTwin = []
const ambiguous = []
let calls = 0
for (const m of src.matchAll(re)) {
  if (m.index >= a && m.index < b) continue
  calls += 1
  if (m[3] === ',') continue // kbe(en, fr): the French is named
  const en = cook(m[2])
  const line = src.slice(0, m.index).split('\n').length
  const keys = keysOf.get(en)
  if (keys === undefined) noTwin.push(line + ': ' + JSON.stringify(en.slice(0, 70)))
  else if (keys.length > 1) ambiguous.push(line + ': ' + JSON.stringify(en.slice(0, 50)) + ' ← ' + keys.map((k) => JSON.stringify(k)).join(' | '))
}
assert.ok(calls > 400, 'the phrases were found (' + calls + ')')
assert.deepEqual(noTwin, [], 'kbe literals with no French twin in KB_FR_EN (add the French key, or name it: kbe(en, fr)):\n  ' + noTwin.join('\n  '))
ok('every kbe(\'English\') has a French twin in KB_FR_EN (' + calls + ' calls)')
assert.deepEqual(ambiguous, [], 'kbe literals whose English text is shared by several French keys (name the French: kbe(en, fr)):\n  ' + ambiguous.join('\n  '))
ok('no kbe literal is ambiguous (two French keys for one English text)')

assert.ok(!/\bkbf\(/.test(src), 'the French-keyed kbf() is gone')
ok('the French-keyed kbf() call is gone: every phrase is written in English')

console.log('\n' + pass + ' checks passed')
