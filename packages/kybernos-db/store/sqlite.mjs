// The two things every connection to a db file needs: the SQLite binding (loaded lazily) and the switch to WAL.

import { createRequire } from 'node:module'

export const BUSY_MS = 3000

/** A few milliseconds of real waiting, in the one place a busy timeout does not reach (see `enterWal`). */
const pause = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) } catch (e) { /* no way to wait here: the next try comes at once */ } }

/** `node:sqlite`, or null: a Node without it must not stop the bundle from loading. */
export function loadSqlite () {
  try { return createRequire(import.meta.url)('node:sqlite') } catch (e) { return null }
}

/** The binding the ports ask for: `sqlite` is `{ DatabaseSync }`, a function giving it, or null (tests). Anything unusable gives null. */
export function sqliteOf (ports) {
  const lib = ports.sqlite === undefined ? loadSqlite() : (typeof ports.sqlite === 'function' ? ports.sqlite() : ports.sqlite)
  return lib !== null && lib !== undefined && typeof lib.DatabaseSync === 'function' ? lib : null
}

/**
 * Puts a new file in WAL. SQLite answers `database is locked` at once, whatever `busy_timeout` says, when two connections switch the SAME new file together
 * (measured on the business base). The switch is only needed once, so: look first, and when it is busy, wait a little and look again.
 */
export function enterWal (handle) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      if (handle.prepare('PRAGMA journal_mode').get().journal_mode === 'wal') return
      handle.exec('PRAGMA journal_mode = WAL')
      return
    } catch (e) {
      if (!/locked|busy/i.test(String(e && e.message)) || attempt >= 60) throw e
      pause(10 + Math.min(attempt * 5, 90))
    }
  }
}
