// The three plugin clients refuse the same invisible characters as the server (decision DL-09 of the 2026-10 recette, findings L2-18 and L2-20).
//
//   node scripts/test-hidden-text-clients.mjs   (exit 0 = everything passes)
//
// A member's skill or automation whose visible words are harmless and whose end is a run of Unicode tag characters (U+E0000-U+E007F) shows two anodyne lines to the admin who approves it, and
// an instruction only a model can read lands on every member's machine. The server (`kybernos-server`, `src/lib/hidden-text.ts`) refuses these characters; so do the three clients that
// propose a text or install one: `kybernos-plugin/automation-team.mjs` (the host that packs and installs an automation), `kybernos-cloud/team-automations.mjs` (the relay) and
// `kybernos-skills/team-skills.mjs` (packs and installs a skill). The packages do not import each other, so each carries its own copy of the set: this test is what keeps the three, and the
// server, the same.
//
// What it checks, for every copy:
//   · the shared list of texts, `docs/dev/hidden-text-vectors.json` (the same file, byte for byte, as `test/fixtures/hidden-text-vectors.json` in the server), including the 77, 59, 49 and 66
//     hidden characters seen by the recette, joiners, direction marks and emoji selectors that must stay;
//   · every one of the 1.1 million code points against the decision's table, written once more here: 457 are refused, nothing else is.
// And that the list itself holds no raw invisible character (it is written in escapes, so it cannot carry what it forbids).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hiddenIn as inHost } from '../packages/kybernos-plugin/automation-team.mjs'
import { hiddenIn as inRelay } from '../packages/kybernos-cloud/team-automations.mjs'
import { hiddenIn as inSkills, findSecret } from '../packages/kybernos-skills/team-skills.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

const CLIENTS = [['kybernos-plugin/automation-team.mjs', inHost], ['kybernos-cloud/team-automations.mjs', inRelay], ['kybernos-skills/team-skills.mjs', inSkills]]

// The decision DL-09: refused. Everything else is accepted by this rule.
const REFUSED = [
  [0x0000, 0x0008], [0x000b, 0x000c], [0x000e, 0x001f], // C0 controls, except tab, line feed and carriage return
  [0x007f, 0x009f], // DEL and the C1 controls
  [0x00ad, 0x00ad], // soft hyphen
  [0x180e, 0x180e], // Mongolian vowel separator
  [0x200b, 0x200b], // zero-width space
  [0x202a, 0x202e], // direction embeddings and overrides
  [0x2060, 0x2064], // word joiner, invisible operators
  [0x2066, 0x206f], // direction isolates, deprecated formatting characters
  [0xfeff, 0xfeff], // byte-order mark, anywhere
  [0xfff9, 0xfffb], // interlinear annotation
  [0xe0000, 0xe007f], // the tags block
  [0xe0100, 0xe01ef], // variation selectors supplement
]
const KEPT = [0x200c, 0x200d, 0x200e, 0x200f, 0xfe0e, 0xfe0f]
const refusedByTable = (cp) => REFUSED.some(([lo, hi]) => cp >= lo && cp <= hi)

// ── the shared list of texts ──
const raw = readFileSync(join(REPO, 'docs', 'dev', 'hidden-text-vectors.json'), 'utf8')
const VECTORS = JSON.parse(raw)
{
  // Written in escapes: no character of the file is outside printable ASCII (plus the line breaks of the layout).
  assert.equal(/[^\x20-\x7e\n]/.test(raw), false, 'the list is ASCII only: it holds no invisible character itself')
  assert.ok(Array.isArray(VECTORS) && VECTORS.length >= 60)
  for (const v of VECTORS) assert.deepEqual(Object.keys(v).sort(), ['accepted', 'note', 'text'], JSON.stringify(v.note))
  assert.ok(VECTORS.some((v) => v.accepted) && VECTORS.some((v) => !v.accepted))
  const tagCounts = VECTORS.map((v) => Array.from(v.text).filter((c) => c.codePointAt(0) >= 0xe0000 && c.codePointAt(0) <= 0xe007f).length)
  for (const n of [77, 59, 49, 66]) assert.ok(tagCounts.includes(n), n + ' tag characters, as the recette saw them')
  ok('the shared list of texts: ASCII only, the same keys everywhere, accepted and refused texts, the payloads of the recette (77, 59, 49 and 66 characters)')
}

// ── the three clients against the list ──
for (const [name, hiddenIn] of CLIENTS) {
  const wrong = VECTORS.filter((v) => (hiddenIn(v.text) === null) !== v.accepted).map((v) => v.note)
  assert.deepEqual(wrong, [], name + ': the texts it gets wrong')
  ok(name + ': agrees with the shared list of ' + VECTORS.length + ' texts')
}

// ── and, code point by code point, with the decision ──
{
  const wrong = { [CLIENTS[0][0]]: [], [CLIENTS[1][0]]: [], [CLIENTS[2][0]]: [] }
  let refused = 0
  for (let cp = 0; cp <= 0x10ffff; cp += 1) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue // half of a surrogate pair is not text at all: another rule
    const want = refusedByTable(cp)
    const text = 'a' + String.fromCodePoint(cp) + 'b'
    let n = 0
    for (const [name, hiddenIn] of CLIENTS) {
      const found = hiddenIn(text)
      if ((found !== null) !== want) wrong[name].push('U+' + cp.toString(16).toUpperCase())
      else if (found !== null) { n += 1; assert.equal(found.count, 1); assert.equal(found.first, 'U+' + cp.toString(16).toUpperCase().padStart(4, '0')) }
    }
    if (want) { refused += 1; assert.equal(n, CLIENTS.length) }
  }
  for (const [name] of CLIENTS) assert.deepEqual(wrong[name].slice(0, 10), [], name + ': code points it gets wrong')
  assert.equal(refused, 457, 'the decision refuses 457 code points')
  for (const cp of KEPT) for (const [name, hiddenIn] of CLIENTS) assert.equal(hiddenIn('a' + String.fromCodePoint(cp) + 'b'), null, name + ' keeps U+' + cp.toString(16))
  ok('all 1.1 million code points: exactly the 457 of the decision are refused by each client, the joiners, the direction marks and the emoji selectors are kept')
}

// ── the count and the first character, and no cost on a long text ──
{
  const text = 'x' + String.fromCodePoint(0xe0041, 0xe0042) + '\u{202e}'
  for (const [name, hiddenIn] of CLIENTS) assert.deepEqual(hiddenIn(text), { first: 'U+E0041', count: 3 }, name)
  const started = Date.now()
  for (const [name, hiddenIn] of CLIENTS) {
    assert.equal(hiddenIn(String.fromCodePoint(0xe0041).repeat(500000)).count, 500000, name)
    assert.equal(hiddenIn('a'.repeat(1000000)), null, name)
  }
  assert.ok(Date.now() - started < 5000, 'linear: half a million hidden characters per client answered in moments')
  ok('each client names the first refused character and how many there are, in moments on a long text')
}

// ── the secret scan of the skills client reads through what draws nothing (L2-20), as the server does ──
{
  const key = 'sk-ant-' + 'a'.repeat(30)
  for (const cp of [...KEPT, 0x034f, 0x3164, 0x200b, 0x2060, 0xfeff, 0x00ad, 0xe0041, 0x202e]) {
    const found = findSecret([{ path: 'f.md', content: 'one\n' + key.slice(0, 12) + String.fromCodePoint(cp) + key.slice(12) }])
    assert.deepEqual(found, { file: 'f.md', line: 2, kind: 'anthropic_key' }, 'a key cut by U+' + cp.toString(16))
  }
  assert.equal(findSecret([{ path: 'f.md', content: 'a harmless line of ordinary words, with an emoji 👨\u{200d}👩\u{200d}👧 and a mark' }]), null)
  ok('the skills scan finds a key cut by any character that draws nothing, on its own line')
}

console.log('\n' + pass + ' verifications OK')
process.exit(0)
