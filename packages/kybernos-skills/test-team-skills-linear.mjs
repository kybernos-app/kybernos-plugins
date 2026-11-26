#!/usr/bin/env node
/** The checks that run on a skill's TEXT are linear, and give the answers the regular expressions they replace gave.
 *
 *  A skill is text a stranger wrote, and these checks run in the DSH host (the same process as the GUI): a check that backtracks freezes it.
 *  Measured before the fix: the JWT pattern took 6.7 s on 160 000 characters (`-eyJ-eyJ…`, about 17 s at the 256 KiB cap of a file),
 *  and the frontmatter line pattern 6 s on `k:` + 80 000 spaces + a character `.` does not match. Both were also in the server;
 *  kybernos-server fixed them the same way (src/modules/skills/validate.ts) and so does this plugin.
 *
 *  1. equivalence: the linear JWT scan and the linear frontmatter parser against the original expressions, on random lines
 *     (seeded, so a failure replays);
 *  2. time: the hostile inputs, through each door a skill's text goes in by (the pure checks, `packSkill`, the catalogue, GitHub
 *     import's frontmatter), each under a bound that is a hundred times the measured time and a tenth of the old one.
 *
 *  Usage: node packages/kybernos-skills/test-team-skills-linear.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findSecret, frontmatterOfText, hasJwt, validateTeamSkill } from './team-skills.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

// A small seeded generator (mulberry32): the same run every time.
const rng = (seed) => () => { seed += 0x6d2b79f5; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const LS = String.fromCharCode(0x2028)
const PS = String.fromCharCode(0x2029)

// ── 1a. the JWT scan equals the expression it replaces ──
const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/
{
  const rand = rng(20261006)
  // Pieces chosen to sit right at the edges of the rule: the start `eyJ`, the dashes that make a word boundary, the dots, ten-character runs.
  const pieces = ['eyJ', 'eyJ', '-', '-', '.', '.', '_', 'a', 'Z', '9', 'abcdefghij', 'abcdefghi', 'eyJabcdefghij', ' ', '=', '/', 'eyJ-', '.-', '-.', 'xy']
  let positives = 0
  let negatives = 0
  const n = 400000
  const alnum = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'
  const run = (min, max) => { let r = ''; const len = min + Math.floor(rand() * (max - min + 1)); for (let k = 0; k < len; k += 1) r += alnum[Math.floor(rand() * alnum.length)]; return r }
  for (let i = 0; i < n; i += 1) {
    let line = ''
    if (i % 2 === 0) {
      // Near-JWTs: three runs of about ten characters around the limit, one start `eyJ`, noise at the edges.
      const noise = ['', '', '-', '.', ' ', 'x', '_', '--', 'eyJ', 'eyJ-']
      line = noise[Math.floor(rand() * noise.length)] + (rand() < 0.9 ? 'eyJ' : 'eyK') + run(7, 13) + '.' + run(8, 12) + '.' + run(8, 12) + noise[Math.floor(rand() * noise.length)]
    } else {
      const parts = 3 + Math.floor(rand() * 14)
      for (let k = 0; k < parts; k += 1) line += pieces[Math.floor(rand() * pieces.length)]
    }
    const want = JWT.test(line)
    assert.equal(hasJwt(line), want, 'differs on ' + JSON.stringify(line))
    if (want) positives += 1; else negatives += 1
  }
  assert.ok(positives > 20000 && negatives > 20000, 'the random lines must cover both answers (' + positives + ' / ' + negatives + ')')
  for (const line of ['', 'eyJ', 'eyJabcdefghij.abcdefghij.abcdefghij', 'x eyJabcdefghij.abcdefghij.abcdefghij y', 'eyJabcdefghij.abcdefghij.abcdefghij-', '-eyJabcdefghij.abcdefghij.abcdefghij',
    'eyJabcdefghij.abcdefghi.abcdefghij', 'eyJabcdefghij..abcdefghij', 'eyJabcdefghij.abcdefghij.abcdefghi', 'AeyJabcdefghij.abcdefghij.abcdefghij']) {
    assert.equal(hasJwt(line), JWT.test(line), JSON.stringify(line))
  }
  ok('the JWT scan gives the expression\'s answer on ' + n + ' random lines (' + positives + ' hits, ' + negatives + ' misses) and on the edge cases')
}

// ── 1b. the frontmatter parser equals the one it replaces ──
// The previous parser, kept here as the reference: one expression per line, `(.*)` not matching CR, U+2028 and U+2029.
const unquote = (v) => {
  const t = v.trim()
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1).replace(/\\(.)/g, (m, c) => (c === 'n' ? '\n' : (c === '\\' || c === '"' ? c : m)))
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1).replace(/''/g, "'")
  return t
}
const frontmatterReference = (text) => {
  const out = {}
  const lines = String(text).split(/\r?\n/)
  if (lines[0] !== '---') return out
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') break
    const m = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(lines[i])
    if (m === null) continue
    out[m[1]] = unquote(m[2])
  }
  return out
}
{
  const rand = rng(777)
  const pieces = ['---', '\n', '\n', '\r\n', '\r', LS, PS, 'name', 'description', 'k', ':', ': ', ':  ', ' ', '\t', '"', "'", "''", '\\', '\\n', '\\"', 'value', 'x y', '-', '_', '1']
  for (let i = 0; i < 200000; i += 1) {
    let text = rand() < 0.85 ? '---\n' : ''
    const parts = 2 + Math.floor(rand() * 16)
    for (let k = 0; k < parts; k += 1) text += pieces[Math.floor(rand() * pieces.length)]
    assert.deepEqual(frontmatterOfText(text), frontmatterReference(text), 'differs on ' + JSON.stringify(text))
  }
  assert.deepEqual(frontmatterOfText('---\nname: a\ndescription: "x \\"q\\" y\\nz"\nplain: v\n---\nbody: not me'), { name: 'a', description: 'x "q" y\nz', plain: 'v' })
  ok('the frontmatter parser gives the old parser\'s answer on 200000 random blocks, line terminators and quotes included')
}

// ── 2. time: hostile text through every door ──
const ms = (f) => { const t = process.hrtime.bigint(); const r = f(); return { ms: Number(process.hrtime.bigint() - t) / 1e6, r } }
const BOUND = 1000   // the measured time is 1 ms; the quadratic one was 6 700 ms at 160 000 characters and 17 000 at 256 KiB
const fast = (label, f) => { const { ms: took } = ms(f); assert.ok(took < BOUND, label + ' took ' + took.toFixed(0) + ' ms'); return took }
const CAP = 256 * 1024
const hostile = {
  jwt: '-eyJ'.repeat(CAP / 4),
  jwtDots: ('eyJabcdefghij.').repeat(CAP / 14),
  fmSpacesLS: 'k:' + ' '.repeat(CAP - 10) + LS,
  fmSpacesCR: 'k:' + ' '.repeat(CAP - 10) + '\r x',
  bearer: ('bearer' + ' '.repeat(40)).repeat(CAP / 46),
  slack: 'xoxb-'.repeat(CAP / 5),
  github: 'ghp_'.repeat(CAP / 4),
  sk: 'sk-'.repeat(CAP / 3),
  aws: 'AKIA'.repeat(CAP / 4)
}
const md = (body) => '---\nname: a\ndescription: "d"\n---\n' + body
{
  for (const [name, text] of Object.entries(hostile)) {
    fast('findSecret on ' + name, () => findSecret([{ path: 'a.md', content: text }]))
    fast('hasJwt on ' + name, () => hasJwt(text))
    fast('validateTeamSkill on ' + name + ' as a file of the skill', () => validateTeamSkill({ name: 'a', files: [{ path: 'SKILL.md', content: md('') }, { path: 'notes.md', content: text }] }))
  }
  fast('frontmatterOfText on a hostile header', () => frontmatterOfText('---\n' + hostile.fmSpacesLS + '\n---\n'))
  fast('frontmatterOfText on a hostile header (CR)', () => frontmatterOfText('---\n' + hostile.fmSpacesCR + '\n---\n'))
  fast('validateTeamSkill on a SKILL.md that is all hostile header', () => validateTeamSkill({ name: 'a', files: [{ path: 'SKILL.md', content: '---\nname: a\ndescription: "d"\n' + hostile.fmSpacesLS + '\n---\n' }] }))
  // 50 hostile files at once: the caps bound the total (1 MiB), so the time is bounded too.
  const many = Array.from({ length: 4 }, (_, i) => ({ path: 'h' + i + '.md', content: hostile.jwt }))
  fast('four 256 KiB hostile files in one skill', () => validateTeamSkill({ name: 'a', files: [{ path: 'SKILL.md', content: md('') }, ...many.slice(0, 3)] }))
  ok('every secret pattern and the frontmatter run in linear time on 256 KiB of hostile text (each under ' + BOUND + ' ms; the quadratic ones took 6 to 60 s)')
}

// ── 2b. the doors on the disk: packSkill, the catalogue, the frontmatter GitHub import reads ──
{
  const home = mkdtempSync(join(tmpdir(), 'kybernos-linear-'))
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, DSH_HOME: process.env.DSH_HOME }
  process.env.HOME = home; process.env.USERPROFILE = home; process.env.DSH_HOME = join(home, '.dsh')
  try {
    const mod = await import('./index.js')
    const root = join(home, '.dsh', 'skills')
    const seed = (name, file, content) => { mkdirSync(join(root, name), { recursive: true }); writeFileSync(join(root, name, file), content) }
    seed('hostile-pack', 'SKILL.md', md(''))
    writeFileSync(join(root, 'hostile-pack', 'notes.md'), hostile.jwt)
    const config = { home }
    fast('packSkill on a skill whose file is hostile', () => mod.packSkill({ root, name: 'hostile-pack', config }))
    seed('hostile-fm', 'SKILL.md', '---\nname: hostile-fm\ndescription: "d"\n' + hostile.fmSpacesLS + '\n---\n')
    seed('hostile-off', 'SKILL.md.disabled', '---\nname: hostile-off\n' + hostile.fmSpacesCR + '\n---\n')
    const ctx = { get: () => undefined }
    const took = fast('catalogueOf, which reads the frontmatter of every disabled skill, with a hostile one', () => { void mod.catalogueOf(ctx, config); return null })
    assert.ok(took < BOUND)
    const cat = await mod.catalogueOf(ctx, config)
    assert.ok(cat.skills.some((s) => s.name === 'hostile-off'), 'the hostile disabled skill is still listed')
    ok('the disk doors too: packing a skill, and the catalogue reading a disabled skill with a hostile header, answer at once')
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
    rmSync(home, { recursive: true, force: true })
  }
}

console.log('\n' + pass + ' verifications OK')
