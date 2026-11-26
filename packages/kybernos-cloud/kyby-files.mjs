// The small file helpers of Kaby's host-written records (kyby-mandate-store.mjs): a JSON file read without throwing, written private (0600) and replaced
// atomically, and an audit line appended and trimmed when the file grows. None of them throws: a file that cannot be read is no record, never a permissive one.
import { appendFileSync, chmodSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const AUDIT_MAX_BYTES = 256 * 1024
const AUDIT_KEEP_LINES = 500

export const readJson = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch (e) { return null } }

export const writeJson = (file, value) => {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = file + '.' + process.pid + '.tmp'
  writeFileSync(tmp, JSON.stringify(value) + '\n', { mode: 0o600 })
  try { chmodSync(tmp, 0o600) } catch (e) { /* a filesystem with no modes */ }
  renameSync(tmp, file)
}

/** One line, dated, at the end of an audit file; the file is cut to its last lines when it passes 256 KB. The audit never stops a turn. */
export const appendAudit = (file, at, event) => {
  try {
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, JSON.stringify({ at: new Date(at).toISOString(), ...event }) + '\n', { mode: 0o600 })
    if (statSync(file).size > AUDIT_MAX_BYTES) {
      const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l !== '')
      writeFileSync(file, lines.slice(-AUDIT_KEEP_LINES).join('\n') + '\n', { mode: 0o600 })
    }
  } catch (e) { /* the audit never stops a turn */ }
}
