// Puts the skills this plugin ships into <dsh home>/skills/<name>/SKILL.md, where
// DSH's skill registry looks for user skills (`user-dsh`, resolved from DSH_HOME).
//
// Same convention as the `signaler-retour` skill of kybernos-plugin (copied at host
// start, idempotent), with one difference: that one overwrites the file whenever it
// differs, which would silently erase a skill the user edited. Here:
//   - absent                          -> written                      ("created")
//   - identical to the shipped text   -> nothing to do                ("current")
//   - differs, and is still byte for byte what WE wrote last time
//     (sha-256 kept in <dsh home>/kybernos/seeded-skills.json)
//                                     -> refreshed from the plugin    ("updated")
//   - differs, anything else          -> the user's file, left alone  ("kept")
//   - SKILL.md.disabled next to it    -> the user switched it off, so we do not
//                                        bring it back                 ("disabled")
// Pure node:fs, no DSH service: unit-testable on a temp folder. Never throws.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Same rule as DSH's own skill names (dsh-skill: lowercase words joined by single hyphens). */
export const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const STATE_FILE = 'seeded-skills.json'

const sha = (buf) => createHash('sha256').update(buf).digest('hex')
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const errText = (e) => (e && e.message ? e.message : String(e))
const writeAtomic = (file, data) => {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  try {
    writeFileSync(tmp, data)
    renameSync(tmp, file)
  } catch (e) {
    try { rmSync(tmp, { force: true }) } catch (e2) { /* nothing to clean */ }
    throw e
  }
}

/**
 * @param {{ home: string, sourceDir: string, names: string[] }} opts
 *   home      the DSH home (~/.dsh); skills go to <home>/skills/<name>/SKILL.md
 *   sourceDir folder holding <name>/SKILL.md as shipped by the plugin
 * @returns {{ name: string, action: string, error?: string }[]} one entry per skill:
 *   created | updated | current | kept | disabled | no-source | invalid-name | error
 */
export function seedSkills(opts) {
  const results = []
  const { home, sourceDir } = opts
  const stateFile = join(home, 'kybernos', STATE_FILE)
  let state = {}
  try {
    const raw = JSON.parse(readFileSync(stateFile, 'utf8'))
    if (plain(raw) && plain(raw.skills)) state = raw.skills
  } catch (e) { /* first run, or a damaged file: nothing is known to be ours, so nothing is refreshed */ }
  let dirty = false
  for (const name of opts.names) {
    const r = { name, action: 'error' }
    results.push(r)
    try {
      if (typeof name !== 'string' || !SKILL_NAME_RE.test(name)) { r.action = 'invalid-name'; continue }
      let src = null
      try { src = readFileSync(join(sourceDir, name, 'SKILL.md')) } catch (e) { /* missing */ }
      if (src === null || src.toString('utf8').trim() === '') { r.action = 'no-source'; continue }
      const dir = join(home, 'skills', name)
      const file = join(dir, 'SKILL.md')
      if (existsSync(join(dir, 'SKILL.md.disabled'))) { r.action = 'disabled'; continue }
      const want = sha(src)
      let disk = null
      try { disk = readFileSync(file) } catch (e) { /* absent */ }
      if (disk === null) {
        writeAtomic(file, src)
        state[name] = want; dirty = true; r.action = 'created'
      } else if (sha(disk) === want) {
        if (state[name] !== want) { state[name] = want; dirty = true }
        r.action = 'current'
      } else if (state[name] === sha(disk)) {
        writeAtomic(file, src)
        state[name] = want; dirty = true; r.action = 'updated'
      } else {
        r.action = 'kept'
      }
    } catch (e) {
      r.action = 'error'
      r.error = errText(e)
    }
  }
  if (dirty) {
    try { writeAtomic(stateFile, JSON.stringify({ version: 1, skills: state })) } catch (e) { results.push({ name: STATE_FILE, action: 'error', error: errText(e) }) }
  }
  return results
}
