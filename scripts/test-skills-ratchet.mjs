// A ratchet on the installed skills folder: what cannot be tested may only shrink, never grow.
//
//   node scripts/test-skills-ratchet.mjs            # the checks
//   node scripts/test-skills-ratchet.mjs --update   # rewrite scripts/skills-ratchet-baseline.json from the folder as it is
//
// Decision of 2026-11-01 (docs/dev/skills-vs-plugins.md): a creation enters the catalogue as a skill only when it carries an
// executable script and a use counter. Until the counter exists, this file holds two numbers that may not get worse:
//  - R1  a skill with no executable in its folder is a notice of nothing: 85 of the 91 installed on 2026-11-01. The prop is
//        that the script is the product and the skill is its manual, and that "a skill does not break at test time" is true
//        because nothing tests it. A new one is a document, not a skill: keep it out of the folder.
//        A notice accepted from the Skills page lands in the same folder and trips R1 on purpose: the doctrine asks for a
//        reviewed diff before the catalogue grows, so the way through is `--update` read by a person, never a silent green run.
//  - R2  a skill that names a tool only this harness provides (read_image, subagent, kybernos_dashboard, creer_slides,
//        modeliser, creer_motion) is a plugin client written in prose: it cannot run on another harness, and no test of the
//        498 in this repo sees it. The prop that skills are portable is measured here, and it is false for 13 of 91.
// The baseline holds names, not a total: a rename shows up as one name in and one name out, which is what the reviewer reads.
// A name that leaves the baseline is free and is reported, so the ceiling gets lowered instead of forgotten.
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

// KB_SKILLS_ROOT points the scan at another folder (to prove a check fails on a tree that has the defect).
const HERE = dirname(fileURLToPath(import.meta.url))
const SKILLS = process.env.KB_SKILLS_ROOT || join(homedir(), '.dsh', 'skills')
const BASELINE = join(HERE, 'skills-ratchet-baseline.json')
const UPDATE = process.argv.includes('--update')

// Tools this harness registers and no other one does. A skill that calls one of them is not a procedure: it is a client.
// The list is deliberately short and named: it is the coupling that was measured on 2026-11-01, not every DSH-adjacent word.
const HARNESS_TOOLS = ['read_image', 'subagent', 'kybernos_dashboard', 'creer_slides', 'creer_motion', 'modeliser']

// A skills folder may not exist at all (CI, a fresh machine): a skip, not a pass, and never a red file.
if (!existsSync(SKILLS) || !statSync(SKILLS).isDirectory()) {
  console.log('SKIPPED: no skills folder at ' + SKILLS)
  process.exit(0)
}

const dirs = readdirSync(SKILLS).filter((n) => { try { return statSync(join(SKILLS, n)).isDirectory() } catch (e) { return false } }).sort()

/** True when the skill folder carries something runnable, two levels deep: a procedure, not a page of advice. */
const hasExecutable = (name) => {
  const walk = (dir, depth) => {
    let entries
    try { entries = readdirSync(dir) } catch (e) { return false }
    for (const e of entries) {
      const full = join(dir, e)
      let st
      try { st = statSync(full) } catch (err) { continue }
      if (st.isDirectory()) { if (depth > 0 && walk(full, depth - 1)) return true; continue }
      if (/\.(mjs|cjs|js|py|sh)$/.test(e)) return true
    }
    return false
  }
  return walk(join(SKILLS, name), 1)
}

/** The text of the skill: its SKILL.md, else every markdown file of the folder. Undefined when it holds no text at all. */
const textOf = (name) => {
  const read = (f) => { try { return readFileSync(join(SKILLS, name, f), 'utf8') } catch (e) { return null } }
  const main = read('SKILL.md')
  if (main !== null) return main
  const md = readdirSync(join(SKILLS, name)).filter((f) => /\.md$/i.test(f))
  return md.length === 0 ? '' : md.map(read).filter((t) => t !== null).join('\n')
}

const prose = dirs.filter((n) => !hasExecutable(n))
const coupled = dirs.filter((n) => {
  const text = textOf(n)
  if (text === null || text === '') return false
  return HARNESS_TOOLS.some((tool) => new RegExp('\\b' + tool + '\\b').test(text))
})

if (UPDATE) {
  const body = {
    note: 'Written by scripts/test-skills-ratchet.mjs --update. A name may leave this file at any time; it may only enter it in a reviewed diff.',
    prose,
    coupled,
    harnessTools: HARNESS_TOOLS
  }
  writeFileSync(BASELINE, JSON.stringify(body, null, 2) + '\n')
  console.log('baseline written: ' + prose.length + ' prose, ' + coupled.length + ' harness-coupled, from ' + dirs.length + ' skills')
  process.exit(0)
}

if (!existsSync(BASELINE)) {
  console.log('FAIL: no ' + BASELINE + ' — run with --update once, and read the diff')
  process.exit(1)
}
const base = JSON.parse(readFileSync(BASELINE, 'utf8'))

let count = 0
const failed = []
const ok = (label, fn) => {
  try { fn(); count += 1; console.log('ok  ', label) } catch (e) { failed.push(label); console.log('FAIL', label, '-', String(e.message).split('\n')[0].slice(0, 200)) }
}

ok('R1: no skill is added without an executable (a notice of nothing is a document, not a skill)', () => {
  const fresh = prose.filter((n) => !(base.prose || []).includes(n))
  assert.deepEqual(fresh, [], 'added: ' + fresh.join(', ') + ' — give it a script, or do not put it in the skills folder')
})

ok('R2: no skill starts naming a tool only this harness provides (it would stop being portable, and nothing here tests it)', () => {
  const fresh = coupled.filter((n) => !(base.coupled || []).includes(n))
  assert.deepEqual(fresh, [], 'added: ' + fresh.join(', ') + ' — write the procedure so it names the job, not the tool')
})

{
  // not a check: what the baseline could shed today, said once so that the ceiling gets lowered
  const shed = []
  const goneProse = (base.prose || []).filter((n) => !prose.includes(n))
  const goneCoupled = (base.coupled || []).filter((n) => !coupled.includes(n))
  if (goneProse.length > 0) shed.push(goneProse.length + ' prose (' + goneProse.slice(0, 3).join(', ') + (goneProse.length > 3 ? ', …' : '') + ')')
  if (goneCoupled.length > 0) shed.push(goneCoupled.length + ' coupled (' + goneCoupled.slice(0, 3).join(', ') + (goneCoupled.length > 3 ? ', …' : '') + ')')
  if (shed.length > 0) console.log('note: the baseline holds what is gone (' + shed.join('; ') + '): node scripts/test-skills-ratchet.mjs --update lowers it')
}

console.log('\n' + count + ' tests passed' + (failed.length > 0 ? ', ' + failed.length + ' failed' : '') + ' — ' + dirs.length + ' skills scanned at ' + SKILLS)
if (failed.length > 0) process.exit(1)
