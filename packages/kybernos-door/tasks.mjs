// The tasks the local door gave to Kaby: the task's id (what the assistant holds) → the DSH session it ran in, kept in a file of the profile.
//
// It is the only way back to a task, and it is written only by the door, so a task id never names one of the person's own chats. Bounded (200 tasks, 7 days), written atomically, readable by
// the owner alone, and never fatal: a file that cannot be read is « no memory of that task » and the assistant is told so. An idempotency key (the assistant's own label for a request it may
// repeat) gives back the same task instead of starting a second one.
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'

export const MAX_TASKS = 200
export const KEEP_MS = 7 * 24 * 3600 * 1000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const SESSION = /^[A-Za-z0-9_-]{1,80}$/
const KEY = /^[A-Za-z0-9._:-]{1,100}$/

export const isTaskId = (v) => typeof v === 'string' && UUID.test(v)
export const isKey = (v) => typeof v === 'string' && KEY.test(v)

/** `file()` is read at each use (the profile can move); `now()` and `newId()` are seams for the tests. */
export function createTasks ({ file, now = Date.now, newId = randomUUID }) {
  const read = () => {
    try {
      const j = JSON.parse(readFileSync(file(), 'utf8'))
      const items = j !== null && typeof j === 'object' && Array.isArray(j.items) ? j.items : []
      const t = now()
      return items.filter((i) => i !== null && typeof i === 'object' && isTaskId(i.id) && SESSION.test(i.session) && Number.isFinite(i.at) && t - i.at < KEEP_MS)
    } catch (e) { return [] }
  }
  const write = (items) => {
    try {
      const f = file()
      mkdirSync(dirname(f), { recursive: true, mode: 0o700 })
      const tmp = f + '.tmp'
      writeFileSync(tmp, JSON.stringify({ items }) + '\n', { mode: 0o600 })
      renameSync(tmp, f)
      try { chmodSync(f, 0o600) } catch (e) { /* not fatal */ }
      return true
    } catch (e) { return false }
  }
  return {
    /** Remembers a new task that ran in `session`; returns it (`{ id, session, at, key? }`), or null when the file cannot be written (then there is no way back to the task: it is not started). */
    start ({ session, key }) {
      if (typeof session !== 'string' || !SESSION.test(session)) return null
      const rec = { id: newId(), session, at: now(), ...(isKey(key) ? { key } : {}) }
      const items = read()
      items.push(rec)
      return write(items.slice(-MAX_TASKS)) ? rec : null
    },
    /** Remembers that a task was stopped by the assistant (`kaby_stop`), so that its id says `canceled` and not an answer it never gave. False when the task is unknown or the file cannot be written. */
    markStopped (id) {
      const items = read()
      const rec = isTaskId(id) ? items.find((i) => i.id === id) : undefined
      if (rec === undefined) return false
      rec.stopped = true
      return write(items.slice(-MAX_TASKS))
    },
    get: (id) => (isTaskId(id) ? read().find((i) => i.id === id) ?? null : null),
    byKey: (key) => (isKey(key) ? read().find((i) => i.key === key) ?? null : null),
    /** The most recent first. */
    recent: (limit) => read().slice(-Math.max(1, limit)).reverse(),
  }
}
