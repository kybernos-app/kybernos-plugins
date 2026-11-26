// kybernos-mobile: where the person's display choice (Auto, Simple, Complete) is kept for the ACCOUNT.
//
// One small file in the DSH folder of the account (`<dsh home>/kybernos/mobile-mode.json`, mode 0600): every device that opens this account's DSH reads the same choice, which is what « per account,
// not per device » means for a plugin (a choice kept on the server for several DSH folders would be the server's: see docs/dev/kaby-mode-shell-contract.md §9). The page keeps a copy in its own
// storage for the first paint (`mode.mjs`); when the two disagree the NEWER `at` wins, so a device that was offline catches up when it comes back, and an old tab cannot undo a new choice.
//
// Pure around its `fs`: `readFile(path) -> string`, `writeFile(path, text, mode)`, `rename(from, to)`, `mkdir(dir)` are injected (the test gives it a map in memory, the host gives it `node:fs`).
// Nothing here throws: a missing, unreadable or foreign file is « Auto, never chosen ».
import { cleanDoc, cleanPref } from './mode.mjs'

export const MODE_FILE = 'mobile-mode.json'
const MAX_BODY = 1024

/** `{ v: 1, pref: 'auto', at: 0 }`: what an account that never chose holds. */
export const NEVER = Object.freeze({ v: 1, pref: 'auto', at: 0 })

export const modePath = (home, join) => join(home, 'kybernos', MODE_FILE)

/** The stored choice (a fresh object). */
export function readMode (path, fs) {
  try {
    const doc = cleanDoc(JSON.parse(String(fs.readFile(path))))
    return doc === null ? { ...NEVER } : doc
  } catch (e) { return { ...NEVER } }
}

/**
 * Stores `input` (`{ pref, at }`) when it is valid and not older than what is there. Answers `{ ok, applied, doc }`: `applied: false` with the document in force when the stored one is newer
 * (the page then takes that one), `ok: false` with a word for a body that is not a choice. A write that fails answers `{ ok: false, error: 'not-saved', doc }` (the page keeps its own copy).
 */
export function writeMode (path, input, fs, now = Date.now) {
  const pref = input !== null && typeof input === 'object' ? cleanPref(input.pref) : null
  if (pref === null) return { ok: false, error: 'bad-pref', doc: readMode(path, fs) }
  const stored = readMode(path, fs)
  const stamp = input.at
  const at = typeof stamp === 'number' && Number.isFinite(stamp) && stamp >= 0 && stamp <= 8.64e15 ? Math.floor(stamp) : now()
  if (stored.at > at) return { ok: true, applied: false, doc: stored }
  const doc = { v: 1, pref, at }
  try {
    const dir = path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')))
    if (dir !== '') fs.mkdir(dir)
    const tmp = path + '.' + process.pid + '.tmp'
    fs.writeFile(tmp, JSON.stringify(doc) + '\n', 0o600)
    fs.rename(tmp, path)
    return { ok: true, applied: true, doc }
  } catch (e) { return { ok: false, error: 'not-saved', doc: stored } }
}

/** The body of a POST: at most 1 KB of JSON, else null. */
export const parseBody = (raw) => {
  try {
    if (typeof raw !== 'string' || raw.length > MAX_BODY) return null
    const v = JSON.parse(raw)
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? v : null
  } catch (e) { return null }
}
export { MAX_BODY }
