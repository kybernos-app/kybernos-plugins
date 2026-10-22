// ── No pictographic emoji in the sentences of the interface ───────────────────────────────────────────────────────────
//
// The house rule (docs/dev/brand.md, the ux-bug-hunter skill): no emoji in the interface; the product draws its own icons. Two slipped into labels (a satellite before
// « Live team », a pencil before « stroke drawn on top »), and four rows of the Agent Team card used an emoji where their siblings use the product's icons. This reads the literals handed to `kt(fr, en)` and `kbe(en)` and the `{ fr, en }` entries of every
// bundle's client and refuses a pictographic emoji. Not refused: the check and cross marks (✓ ✗, text symbols that read as the result of an action) and the
// thumbs 👍 👎, which name the product's own feedback controls in the sentences that count or explain them.
//
//   node scripts/test-no-emoji-in-ui.mjs
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{FE0F}✏]/u
const ALLOWED = new Set(['\u{1F44E}', '\u{1F44D}']) // 👎 👍: the feedback controls' own glyphs, in the sentences that count or explain them
const MARK = /\bkt\(|\bkbe\(|\bkbt\(|\bfr:\s*['"`]|\ben:\s*['"`]|className: 'kbg-mico'|\blabel: /
const LIT = /'((?:\\.|[^'\\\n])+)'|"((?:\\.|[^"\\\n])+)"|`((?:\\.|[^`\\\n])+)`/g

const hits = []
let literals = 0
for (const pkg of readdirSync(join(root, 'packages')).sort()) {
  const file = join(root, 'packages', pkg, 'client.js')
  if (!existsSync(file)) continue
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (!MARK.test(line) || /^\s*\/\//.test(line)) return
    for (const m of line.matchAll(LIT)) {
      const text = m[1] ?? m[2] ?? m[3]
      literals += 1
      const bad = [...text].filter((c) => EMOJI.test(c) && !ALLOWED.has(c))
      if (bad.length > 0) hits.push(pkg + '/client.js:' + String(i + 1) + '  ' + text.slice(0, 90))
    }
  })
}
let failed = 0
console.log((hits.length === 0 ? '  ✓ ' : '  ✗ ') + 'no sentence of a client carries a pictographic emoji (' + literals + ' literals read)' + (hits.length === 0 ? '' : '\n    ' + hits.join('\n    ')))
if (hits.length > 0) failed += 1
if (!EMOJI.test('🛰') || !EMOJI.test('✏️') || EMOJI.test('✓') || EMOJI.test('✗')) { console.log('  ✗ the guard does not tell an emoji from a check mark'); failed += 1 }
console.log(failed === 0 ? '\nNO EMOJI — 0 échec' : '\n' + failed + ' check(s) failed')
process.exit(failed === 0 ? 0 : 1)
