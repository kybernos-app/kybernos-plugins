// Puts the companion files of a shipped skill (scripts, references, examples: everything next to its SKILL.md) into
// <dsh home>/skills/<name>/, beside the SKILL.md that seed-skills.mjs seeded. seed-skills.mjs copies SKILL.md only, and the
// other bundles carry identical copies of it (scripts/test-seed-skills-drift.mjs), so this part lives here alone.
//
// Same rule as seed-skills.mjs, file by file (the sha-256 of what WE wrote last time is kept in
// <dsh home>/kybernos/seeded-skill-files.json):
//   - absent                          -> written                      ("created")
//   - identical to the shipped file   -> nothing to do                ("current")
//   - differs, and is still byte for byte what WE wrote last time
//                                     -> refreshed from the plugin    ("updated")
//   - differs, anything else          -> the person's file, left alone ("kept")
//   - shipped last time, not any more, and still ours -> removed      ("removed")
// SKILL.md.disabled next to the skill means the person switched it off: nothing is written. A skill whose SKILL.md is not on disk
// gets no companion files either (they would be orphans). Only plain files are copied: no symlink, no hidden name, no odd character.
// Pure node:fs, no DSH service: unit-testable on a temp folder. Never throws.
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const FILES_STATE = 'seeded-skill-files.json'
const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SEGMENT_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/
export const MAX_FILES = 200
export const MAX_FILE_BYTES = 1048576

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

/** The shipped companion files of one skill folder: relative '/' paths, SKILL.md excluded. Anything unsafe is left out. */
export const listCompanions = (dir) => {
  const out = []
  const walk = (abs, rel) => {
    for (const entry of readdirSync(abs).sort()) {
      if (!SEGMENT_RE.test(entry)) continue
      const full = join(abs, entry)
      const r = rel === '' ? entry : rel + '/' + entry
      const st = lstatSync(full)
      if (st.isSymbolicLink()) continue
      if (st.isDirectory()) walk(full, r)
      else if (st.isFile() && st.size <= MAX_FILE_BYTES && r !== 'SKILL.md' && out.length < MAX_FILES) out.push(r)
    }
  }
  walk(dir, '')
  return out
}

/**
 * @param {{ home: string, sourceDir: string, names: string[] }} opts   as seedSkills
 * @returns {{ name: string, action: string, counts?: Record<string, number>, error?: string }[]}
 *   action: seeded (counts says what happened to each file) | nothing | disabled | no-skill | invalid-name | error
 */
export function seedSkillFiles(opts) {
  const results = []
  const { home, sourceDir } = opts
  const stateFile = join(home, 'kybernos', FILES_STATE)
  let state = {}
  try {
    const raw = JSON.parse(readFileSync(stateFile, 'utf8'))
    if (plain(raw) && plain(raw.files)) state = raw.files
  } catch (e) { /* first run, or a damaged file: nothing is known to be ours, so nothing is refreshed or removed */ }
  let dirty = false
  for (const name of opts.names) {
    const r = { name, action: 'error' }
    results.push(r)
    try {
      if (typeof name !== 'string' || !NAME_RE.test(name)) { r.action = 'invalid-name'; continue }
      const src = join(sourceDir, name)
      if (!existsSync(src)) { r.action = 'nothing'; continue }
      const shipped = listCompanions(src)
      const dir = join(home, 'skills', name)
      if (existsSync(join(dir, 'SKILL.md.disabled'))) { r.action = 'disabled'; continue }
      if (!existsSync(join(dir, 'SKILL.md'))) { r.action = shipped.length === 0 ? 'nothing' : 'no-skill'; continue }
      const known = plain(state[name]) ? state[name] : {}
      const next = {}
      const counts = { created: 0, updated: 0, current: 0, kept: 0, removed: 0 }
      for (const rel of shipped) {
        const buf = readFileSync(join(src, ...rel.split('/')))
        const want = sha(buf)
        const file = join(dir, ...rel.split('/'))
        let disk = null
        try { disk = readFileSync(file) } catch (e) { /* absent */ }
        if (disk === null) { writeAtomic(file, buf); next[rel] = want; counts.created += 1 }
        else if (sha(disk) === want) { next[rel] = want; counts.current += 1 }
        else if (known[rel] === sha(disk)) { writeAtomic(file, buf); next[rel] = want; counts.updated += 1 }
        else { counts.kept += 1; if (known[rel] !== undefined) next[rel] = known[rel] }
      }
      for (const rel of Object.keys(known)) {          // shipped before, not any more
        if (shipped.includes(rel)) continue
        const file = join(dir, ...rel.split('/'))
        let disk = null
        try { disk = readFileSync(file) } catch (e) { /* already gone */ }
        if (disk !== null && sha(disk) === known[rel]) { rmSync(file, { force: true }); counts.removed += 1 }
        else if (disk !== null) next[rel] = known[rel]
      }
      if (JSON.stringify(next) !== JSON.stringify(known)) { state[name] = next; dirty = true }
      r.action = 'seeded'
      r.counts = counts
    } catch (e) {
      r.action = 'error'
      r.error = errText(e)
    }
  }
  if (dirty) {
    try { writeAtomic(stateFile, JSON.stringify({ version: 1, files: state })) } catch (e) { results.push({ name: FILES_STATE, action: 'error', error: errText(e) }) }
  }
  return results
}
