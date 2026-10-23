// The person's cloud computers as the laptop's page shows them (`GET /kybernos-cloud/computers`): what the server's list says of each one, cut down to a
// closed set of fields. Nothing the server sent goes through as it is: a name is clipped, a state is one of a few words, a load is numbers from a closed
// list (the shape the computer's reporter sends in its beat, ADR 0052 and the server's spec of 2026-10-23), a figure that does not fit is not shown.
//
// Pure: the route in index.js makes the calls, this turns the rows into what the page draws.

const ID = /^[A-Za-z0-9_.:-]{1,64}$/u
const LEVELS = Object.freeze(['ok', 'busy', 'high'])

/** The server's states, in the page's words: awake, asleep, waking (creating, resuming), winding down, and off (stopped, failed, being deleted). */
const STATES = Object.freeze({ running: 'awake', suspended: 'asleep', creating: 'waking', resuming: 'waking', suspending: 'winding_down', stopped: 'off', failed: 'off', deleting: 'off' })

/** What the machine's shape says of its memory, in MB, when the server names one of the sizes it knows. */
const SHAPE_MB = Object.freeze({ '1x1g': 1024, '1x2g': 2048 })

/** A load older than this is not shown, whatever the server says (it answers `null` itself after two minutes: this is a second belt). */
export const LOAD_FRESH_MS = 150_000

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const whole = (v, max) => { const n = num(v); return n === null ? 0 : Math.max(0, Math.min(max, Math.round(n))) }
const isoOrNull = (v) => { const t = Date.parse(String(v ?? '')); return Number.isFinite(t) ? new Date(t).toISOString() : null }

export const stateOf = (row) => {
  const s = row !== null && typeof row === 'object' ? STATES[String(row.state)] : undefined
  return s === undefined ? 'off' : s
}

/** The load the computer reported in its last beat: numbers from a closed list and the automations running, or null. */
export const loadOf = (row, nowMs) => {
  const l = row !== null && typeof row === 'object' && row.load !== null && typeof row.load === 'object' ? row.load : null
  if (l === null) return null
  if (LEVELS.indexOf(l.level) < 0) return null
  if (num(l.pressure) === null) return null
  // The server dates a reading with the computer's last beat (`heartbeat_at`; `load_at` when it names one) and answers null itself after two minutes.
  const stamp = row.load_at !== undefined && row.load_at !== null ? row.load_at : row.heartbeat_at
  const at = stamp === undefined || stamp === null ? null : Date.parse(String(stamp))
  if (at !== null && (!Number.isFinite(at) || (Number.isFinite(nowMs) && nowMs - at > LOAD_FRESH_MS))) return null
  const tasks = (Array.isArray(l.running_tasks) ? l.running_tasks : Array.isArray(row.running_tasks) ? row.running_tasks : [])
    .filter((t) => t !== null && typeof t === 'object' && ID.test(String(t.task_ref)) && isoOrNull(t.started_at) !== null)
    .slice(0, 8).map((t) => ({ taskRef: String(t.task_ref), startedAt: isoOrNull(t.started_at) }))
  return {
    level: l.level,
    pressure: whole(l.pressure, 100),
    cpuPerCore: num(l.cpu_per_core) === null ? 0 : Math.max(0, Math.min(64, Math.round(l.cpu_per_core * 100) / 100)),
    memAvailMb: whole(l.mem_avail_mb, 1_048_576),
    memTotalMb: Math.max(1, whole(l.mem_total_mb, 1_048_576)),
    running: whole(l.running, 64),
    waiting: whole(l.waiting, 64),
    allowed: whole(l.allowed, 64),
    runningTasks: tasks,
  }
}

/** One computer, as the page draws it. */
export const computerOf = (row, nowMs) => {
  const name = String(row.name ?? '').replace(/[\u0000-\u001f\u007f<>]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, 60)
  const state = stateOf(row)
  return {
    id: String(row.id),
    name: name === '' ? 'Computer' : name,
    isHome: name.toLowerCase() === 'home',
    state,
    memoryMb: SHAPE_MB[String(row.shape)] ?? null,
    mode: row.mode === 'always' ? 'always' : 'sleep',
    paused: typeof row.paused_reason === 'string' && /^[a-z_]{1,40}$/u.test(row.paused_reason) ? row.paused_reason : null,
    // An asleep computer has no live reading: what it last said is of no use to a gauge.
    load: state === 'awake' ? loadOf(row, nowMs) : null,
  }
}

/** The cloud computers of a list answer, Home first and the others by name, at most twelve. */
export const computersOf = (rows, nowMs) => {
  const list = (Array.isArray(rows) ? rows : [])
    .filter((r) => r !== null && typeof r === 'object' && typeof r.id === 'string' && ID.test(r.id) && (r.kind === undefined || r.kind === 'cloud'))
    .map((r) => computerOf(r, nowMs))
  list.sort((a, b) => (a.isHome === b.isHome ? a.name.localeCompare(b.name) : a.isHome ? -1 : 1))
  return list.slice(0, 12)
}
