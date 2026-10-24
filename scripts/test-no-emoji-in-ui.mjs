// ── No pictographic emoji in the interface ─────────────────────────────────────────────────────────────────────────────
//
// The house rule (docs/dev/brand.md, the ux-bug-hunter skill): no emoji in the interface; the product draws its own icons. This reads EVERY line of every
// bundle's client.js (a bare `h('span', …, '👑')` counts as much as a `kt(fr, en)` sentence) and refuses a pictographic emoji: the Unicode pictograph blocks, the
// emoji variation selector, and the few BMP characters that are emoji by default (⚡ ✨ ✅ ❌ ⭐). Not refused: text symbols that read as typography (✓ ✗ ▶ ⏸ ⚠ ⚙ ✎ ➔) and
// the thumbs 👍 👎, which name the product's own feedback controls in the sentences that count or explain them.
//
// KNOWN holds the sites that still carry one, each with the reason; it can only shrink: a new emoji fails, and an entry that no longer matches anything fails too
// (delete it). Four rows of the Agent Team card, five labels and the slide-notes preview were replaced by the icon family on 2026-10-22.
//
//   node scripts/test-no-emoji-in-ui.mjs
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{FE0F}⚡✨✅❌⭐]/u
const ALLOWED = new Set(['\u{1F44E}', '\u{1F44D}'])

// package|emoji → why it stays. Burn this list down: a LUCIDE icon of that client, or the product's own, replaces the glyph.
const KNOWN = {
  'kybernos-plugin|📌': 'the pin button of an Agent Team card (three places): the LUCIDE table has no pin icon yet',
  'kybernos-plugin|🎓': 'same example, in the field of the skill icon',
  'kybernos-composio|⚡': 'the fallback icon of a catalogue item that brings none (this bundle has no icon table)',
  'kybernos-composio|🤖': 'same fallback, for a kyber item',
  'kybernos-composio|🧰': 'same fallback, for a tool item',
  'kybernos-composio|🔌': 'same fallback, for any other item',
  'kybernos-auto|⚡': 'the Auto row in the model menu (this bundle has no icon table)',
}

const seen = new Set()
const hits = []
let lines = 0
for (const pkg of readdirSync(join(root, 'packages')).sort()) {
  const file = join(root, 'packages', pkg, 'client.js')
  if (!existsSync(file)) continue
  let inBlock = false
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    lines += 1
    // Comments are not the interface: a // line, and a /* … */ block (tracked across lines).
    if (inBlock) { if (line.includes('*/')) inBlock = false; return }
    if (/^\s*\/\*/.test(line)) { if (!line.includes('*/')) inBlock = true; return }
    if (/^\s*(\/\/|\*)/.test(line)) return
    // The whole line, not its string literals: a regex over quotes loses a literal that follows another quote on a long line (the pin button was missed that way).
    const code = line.replace(/\s\/\/\s.*$/, '') // a trailing comment is not the interface
    for (const c of new Set([...code].filter((ch) => EMOJI.test(ch) && !ALLOWED.has(ch)))) {
      if (c === '\u{FE0F}') continue // the variation selector rides on the emoji before it, which is reported itself
      const key = pkg + '|' + c
      if (KNOWN[key] !== undefined) { seen.add(key); continue }
      hits.push(pkg + '/client.js:' + String(i + 1) + '  ' + c + '  ' + code.trim().slice(0, 80))
    }
  })
}
let failed = 0
const stale = Object.keys(KNOWN).filter((k) => !seen.has(k))
console.log((hits.length === 0 ? '  ✓ ' : '  ✗ ') + 'no line of a client carries a pictographic emoji beyond the listed sites (' + lines + ' lines read)' + (hits.length === 0 ? '' : '\n    ' + hits.join('\n    ')))
if (hits.length > 0) failed += 1
console.log((stale.length === 0 ? '  ✓ ' : '  ✗ ') + 'every listed site still exists (' + Object.keys(KNOWN).length + ')' + (stale.length === 0 ? '' : ' — remove: ' + stale.join(', ')))
if (stale.length > 0) failed += 1
if (!EMOJI.test('🛰') || !EMOJI.test('✏\u{FE0F}') || !EMOJI.test('⚡') || EMOJI.test('✓') || EMOJI.test('▶') || EMOJI.test('⚠') || EMOJI.test('✎')) { console.log('  ✗ the guard does not tell an emoji from a text symbol'); failed += 1 }
console.log(failed === 0 ? '\nNO EMOJI — 0 échec' : '\n' + failed + ' check(s) failed')
process.exit(failed === 0 ? 0 : 1)
