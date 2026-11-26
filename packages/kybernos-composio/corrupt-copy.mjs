// A copy of a private store that cannot be read, kept next to it. Both stores of this bundle follow the same rule
// (connecteurs.json through index.js, openapi-connectors.json through openapi.mjs): an unreadable file is NEVER read as an
// empty store and NEVER written over, because the next save would lose what the person had saved; a copy is kept instead,
// with the content unchanged, so it can be recovered by hand.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

export const CORRUPT_SUFFIX = '.corrupt-'
export const CORRUPT_COPIES_MAX = 5

/**
 * Keeps a copy of a corrupt file next to it as <name>.corrupt-<time>. A copy with the same content is reused and there are
 * never more than CORRUPT_COPIES_MAX, so repeated attempts do not pile up files. Returns the copy's path or null.
 */
export function keepCorruptCopy(file, text) {
  try {
    const folder = dirname(file)
    const prefix = basename(file) + CORRUPT_SUFFIX
    const copies = readdirSync(folder).filter((n) => n.startsWith(prefix))
    for (const n of copies) {
      try { if (readFileSync(join(folder, n), 'utf8') === text) return join(folder, n) } catch (e) { /* unreadable copy: ignored */ }
    }
    if (copies.length >= CORRUPT_COPIES_MAX) return null
    const base = join(folder, prefix + Date.now())
    for (let i = 0; i < CORRUPT_COPIES_MAX; i += 1) {
      const copy = i === 0 ? base : base + '-' + i
      try { writeFileSync(copy, text, { mode: 0o600, flag: 'wx' }); return copy } catch (e) { if (!(e && e.code === 'EEXIST')) return null }
    }
    return null
  } catch (e) { return null }
}
