// When an assistant last called the door: the one fact the Settings page needs to say whether a pasted message worked ("an assistant connected, last call 2 min ago").
//
// Kept in memory and written to the profile at most once every `every` ms (a busy assistant makes many calls a minute; the file is only there so a restart of Kybernos does not forget that
// an assistant had connected). Never fatal: a profile that cannot be written only means the page forgets after a restart. The file holds a time and nothing else.
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** `file()` is read at each use (the profile can move). */
export function createActivity ({ file, now = Date.now, every = 20000 }) {
  let last = null
  let written = null
  const write = (at) => {
    const f = file()
    mkdirSync(dirname(f), { recursive: true, mode: 0o700 })
    const tmp = f + '.tmp'
    writeFileSync(tmp, JSON.stringify({ at }) + '\n', { mode: 0o600 })
    renameSync(tmp, f)
    try { chmodSync(f, 0o600) } catch (e) { /* not fatal */ }
  }
  return {
    /** An authenticated call came in. */
    touch () {
      const at = now()
      last = at
      if (written !== null && at - written < every) return
      written = at
      try { write(at) } catch (e) { /* the page forgets after a restart, nothing else */ }
    },
    /** The time of the last call (ms), or null when no assistant ever called. */
    lastAt () {
      if (last !== null) return last
      try {
        const at = JSON.parse(readFileSync(file(), 'utf8')).at
        return Number.isFinite(at) && at > 0 && at <= now() + 60000 ? at : null
      } catch (e) { return null }
    },
  }
}
