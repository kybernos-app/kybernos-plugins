// Which DSH session each task of the assistants' door ran in (the job's id → the session's id), kept on the volume so that it survives a restart of DSH and of the machine.
//
// The cloud plugin only serves a Journal link for a session ITS OWN `turn` route made (an in-memory set: a restart forgets it). A link lasts a few minutes, and the person asks for a new one
// hours later, often after the machine slept: the new link is asked for by the TASK's id, and this file is what says which session that task was. It is written only by the `turn` route,
// so what it names is a session the door itself made, never one of the person's own chats. Bounded (300 tasks, 7 days), written atomically, readable by the owner alone, and never fatal:
// a file that cannot be read or written is « no memory of that task », and the person is told the link cannot be renewed.
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export const MAX_TASKS = 300
export const KEEP_MS = 7 * 24 * 3600 * 1000
const JOB = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const SESSION = /^[A-Za-z0-9_-]{1,80}$/

/** `file()` is read at each use (the profile can move); `now()` is a seam for the tests. */
export function createDoorSessions ({ file, now = Date.now }) {
  const read = () => {
    try {
      const j = JSON.parse(readFileSync(file(), 'utf8'))
      const items = j !== null && typeof j === 'object' && Array.isArray(j.items) ? j.items : []
      return items.filter((i) => i !== null && typeof i === 'object' && JOB.test(i.job) && SESSION.test(i.session) && Number.isFinite(i.at))
    } catch (e) { return [] }
  }
  const write = (items) => {
    try {
      const f = file()
      mkdirSync(dirname(f), { recursive: true })
      const tmp = f + '.tmp'
      writeFileSync(tmp, JSON.stringify({ items }) + '\n', { mode: 0o600 })
      renameSync(tmp, f)
      // writeFileSync does not tighten the mode of a file that was there: 0600 is forced all the same.
      try { chmodSync(f, 0o600) } catch (e) { /* not fatal */ }
      return true
    } catch (e) { return false }
  }
  return {
    /** Remembers that task `job` ran in `session`. A task asked again (the same id) replaces its line. False when the file could not be written (the task still runs). */
    note (job, session) {
      if (typeof job !== 'string' || !JOB.test(job) || typeof session !== 'string' || !SESSION.test(session)) return false
      const t = now()
      const items = read().filter((i) => i.job !== job && t - i.at < KEEP_MS)
      items.push({ job, session, at: t })
      return write(items.slice(-MAX_TASKS))
    },
    /** The session of task `job`, or null: never made here, forgotten (over seven days, or past the 300 most recent), or the file is unreadable. */
    sessionOf (job) {
      if (typeof job !== 'string' || !JOB.test(job)) return null
      const t = now()
      const hit = read().find((i) => i.job === job && t - i.at < KEEP_MS)
      return hit === undefined ? null : hit.session
    }
  }
}
