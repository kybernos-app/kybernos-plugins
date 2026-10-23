#!/usr/bin/env node
// The English side of a bilingual text never carries French guillemets (« »): they read as a stray French word in an English page.
// The French twin keeps them. Heuristic, on the bundles' client files: `kt(fr, en)` (the English text is the second argument) and
// `kbe(en, fr)` (the English text is the first one), both written as two string literals.
//   node scripts/test-en-quotes.mjs
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages')
const lit = String.raw`(['"\x60])((?:\\.|(?!\1)[^\\])*)\1`
const KT = new RegExp(String.raw`\bkt\(\s*${lit}\s*,\s*(['"\x60])((?:\\.|(?!\3)[^\\])*)\3`, 'g')
const KBE = new RegExp(String.raw`\bkbe\(\s*${lit}\s*,\s*(['"\x60])((?:\\.|(?!\3)[^\\])*)\3`, 'g')
const bad = []
let pairs = 0
for (const dir of readdirSync(root)) {
  const file = join(root, dir, 'client.js')
  if (!existsSync(file)) continue
  const src = readFileSync(file, 'utf8')
  for (const [re, enAt] of [[KT, 4], [KBE, 2]]) {
    for (const m of src.matchAll(re)) {
      pairs += 1
      if (/[«»]/.test(m[enAt])) bad.push(dir + '/client.js:' + (src.slice(0, m.index).split('\n').length) + '  ' + m[enAt].slice(0, 70))
    }
  }
}
console.log(pairs + ' bilingual pairs read')
if (bad.length > 0) {
  for (const b of bad) console.error('  ✗ French guillemets on the English side: ' + b)
  process.exit(1)
}
console.log('EN QUOTES — no guillemets on the English side of any pair, 0 échec')
