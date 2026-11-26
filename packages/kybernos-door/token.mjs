// The secret of the local door: one random token in a file of the profile, readable by the owner alone.
//
// It is made when the plugin starts (so a person who switches the plugin on has a door that is closed to everyone but whoever can read their own profile) and read again at each request, so
// that `scripts/door-local.mjs --rotate` takes effect at once and a deleted file switches the door off. Never logged, never put in a URL.
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname } from 'node:path'

const SHAPE = /^kbd_[0-9a-f]{48}$/

/** `file()` is read at each use (the profile can move). */
export function createToken ({ file }) {
  const read = () => {
    try {
      const t = readFileSync(file(), 'utf8').trim()
      return SHAPE.test(t) ? t : ''
    } catch (e) { return '' }
  }
  const write = (t) => {
    const f = file()
    mkdirSync(dirname(f), { recursive: true, mode: 0o700 })
    const tmp = f + '.tmp'
    writeFileSync(tmp, t + '\n', { mode: 0o600 })
    renameSync(tmp, f)
    // writeFileSync keeps the mode of a file that was already there: 0600 is forced all the same.
    try { chmodSync(f, 0o600) } catch (e) { /* not fatal */ }
  }
  return {
    /** The token, or '' when there is none (the door is off). */
    current: read,
    /** The token, made if there was none. Throws only when the profile cannot be written; the caller decides what that means. */
    ensure () {
      const have = read()
      if (have !== '') return have
      const made = 'kbd_' + randomBytes(24).toString('hex')
      write(made)
      return made
    },
    /** A new token: the old one stops working at once. */
    rotate () {
      const made = 'kbd_' + randomBytes(24).toString('hex')
      write(made)
      return made
    },
  }
}
