// Seeds shipped skills of kybernos-sessions (<bundle>/skills/<name>/) into
// <dsh home>/skills/<name>/ at host startup so DSH discovers both SKILL.md and
// its accompanying executable scripts (skills-vs-plugins.md R1).
//
// Follows the same user-safe contract as kybernos-slash/seed-skills.mjs:
//   - absent                        -> written                     ("created")
//   - identical to shipped SKILL.md -> synced scripts if needed    ("current")
//   - differs, matches our sha-256  -> refreshed from bundle       ("updated")
//   - differs, user-edited          -> left untouched              ("kept")
//   - SKILL.md.disabled present     -> left disabled               ("disabled")
// Pure node:fs, never throws.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

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
    try { rmSync(tmp, { force: true }) } catch { /* ignore */ }
    throw e
  }
}

function syncScriptsDir (srcScriptsDir, dstScriptsDir) {
  if (!existsSync(srcScriptsDir)) return
  let entries = []
  try { entries = readdirSync(srcScriptsDir, { withFileTypes: true }) } catch { return }
  for (const ent of entries) {
    if (!ent.isFile() || ent.name.startsWith('.')) continue
    const srcBuf = readFileSync(join(srcScriptsDir, ent.name))
    const dstPath = join(dstScriptsDir, ent.name)
    let dstBuf = null
    try { dstBuf = readFileSync(dstPath) } catch { /* absent */ }
    if (dstBuf === null || sha(dstBuf) !== sha(srcBuf)) {
      writeAtomic(dstPath, srcBuf)
    }
  }
}

/**
 * @param {{ home: string, sourceDir: string, names: string[] }} opts
 * @returns {{ name: string, action: string, error?: string }[]}
 */
export function seedSkills (opts) {
  const results = []
  const { home, sourceDir } = opts
  const stateFile = join(home, 'kybernos', STATE_FILE)
  let state = {}
  try {
    const raw = JSON.parse(readFileSync(stateFile, 'utf8'))
    if (plain(raw) && plain(raw.skills)) state = raw.skills
  } catch { /* first run or damaged state file */ }
  let dirty = false
  for (const name of opts.names) {
    const r = { name, action: 'error' }
    results.push(r)
    try {
      if (typeof name !== 'string' || !SKILL_NAME_RE.test(name)) { r.action = 'invalid-name'; continue }
      const srcDir = join(sourceDir, name)
      let src = null
      try { src = readFileSync(join(srcDir, 'SKILL.md')) } catch { /* missing */ }
      if (src === null || src.toString('utf8').trim() === '') { r.action = 'no-source'; continue }
      const dstDir = join(home, 'skills', name)
      const dstFile = join(dstDir, 'SKILL.md')
      if (existsSync(join(dstDir, 'SKILL.md.disabled'))) { r.action = 'disabled'; continue }
      const want = sha(src)
      let disk = null
      try { disk = readFileSync(dstFile) } catch { /* absent */ }
      if (disk === null) {
        writeAtomic(dstFile, src)
        syncScriptsDir(join(srcDir, 'scripts'), join(dstDir, 'scripts'))
        state[name] = want; dirty = true; r.action = 'created'
      } else if (sha(disk) === want) {
        syncScriptsDir(join(srcDir, 'scripts'), join(dstDir, 'scripts'))
        if (state[name] !== want) { state[name] = want; dirty = true }
        r.action = 'current'
      } else if (state[name] === sha(disk)) {
        writeAtomic(dstFile, src)
        syncScriptsDir(join(srcDir, 'scripts'), join(dstDir, 'scripts'))
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
