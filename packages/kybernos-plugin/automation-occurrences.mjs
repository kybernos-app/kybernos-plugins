// When the scheduled automations will run, for the Automations calendar.
//
// Pure: no disk, no clock of its own, no cron engine of its own. The matcher is the scheduler's
// (`kbComputeNextRun` and `kbNeverRuns` of KB-TASKS-CORE in index.js), handed in by the route, so what
// the calendar plans is exactly what the tick will claim: same cron grammar, same zones, same clock
// changes, same "this schedule never fires". Read-only: nothing is stored and nothing is started.
//
// What it does not do: say what HAPPENED. The past of an automation is its `history` (the last 20
// runs), which the page reads from tasks.json; only the future needs a matcher.

/** A six-week month grid and the margins of a zone (up to 14 hours each way); a longer window is refused, never cut quietly. */
export const OCC_MAX_RANGE_MS = 45 * 86400000
/** Occurrences listed for one automation in one answer. A schedule denser than this is reported as truncated. */
export const OCC_PER_TASK = 200
/** Occurrences listed in one answer, all automations together. */
export const OCC_TOTAL = 1000
/** The expansion of one dense cron costs about a millisecond per occurrence: past this, it stops and says so. */
export const OCC_BUDGET_MS = 800

const isoOf = (ms) => new Date(ms).toISOString()
const dateMs = (raw) => {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 40) return NaN
  const ms = Date.parse(raw)
  return Number.isFinite(ms) ? ms : NaN
}

/**
 * The window asked for. `from` defaults to now, `to` to a week later; the past is never expanded (it is
 * the history's), so `from` is lifted to now. Returns { ok: true, fromMs, toMs, nowMs } or { ok: false, error }.
 */
export const parseOccurrenceRange = (fromRaw, toRaw, nowMs) => {
  if (!Number.isFinite(nowMs)) return { ok: false, error: 'no clock' }
  const given = (v) => v !== null && v !== undefined && v !== ''
  const from = given(fromRaw) ? dateMs(fromRaw) : nowMs
  if (!Number.isFinite(from)) return { ok: false, error: 'from must be a date' }
  const to = given(toRaw) ? dateMs(toRaw) : from + 7 * 86400000
  if (!Number.isFinite(to)) return { ok: false, error: 'to must be a date' }
  if (to <= from) return { ok: false, error: 'to must be after from' }
  if (to - from > OCC_MAX_RANGE_MS) return { ok: false, error: 'range too long (45 days at most)' }
  return { ok: true, fromMs: Math.max(from, nowMs), toMs: to, nowMs }
}

/**
 * The occurrences of the active scheduled automations inside a window.
 *
 *   tasks  the entries of tasks.json
 *   range  { fromMs, toMs, nowMs } as returned by parseOccurrenceRange
 *   deps   { computeNextRun(task, afterMs) -> ms | null    the scheduler's own,
 *            neverRuns(task, nextMs) -> boolean            "active, not a webhook, and no next run",
 *            noNextRunError(task) -> string                the message the scheduler gives,
 *            isValidTimeZone(tz) -> boolean,
 *            clock() -> ms }                               (optional) for the time budget
 *
 * Answer: { occurrences: [{ id, at }] sorted by time, cannotFire: [{ id, error }],
 *           warnings: [{ id, warning }], truncated: [{ id, until }] }.
 * An automation that is paused, or runs on a webhook alone, has no occurrence. One that is active but
 * can never fire (a date that passed, a cron such as "0 0 31 2 *" written by hand) is in `cannotFire`
 * with the scheduler's own words. A schedule too dense to list is in `truncated`, with the instant the
 * list stops: nothing after `until` is known for it, and the page must not read that as "nothing".
 */
export const expandOccurrences = (tasks, range, deps) => {
  const occurrences = []
  const cannotFire = []
  const warnings = []
  const truncated = []
  const clock = typeof deps.clock === 'function' ? deps.clock : () => Date.now()
  const started = clock()
  const reached = new Set()
  let total = 0
  let budgetSpent = false
  for (const t of Array.isArray(tasks) ? tasks : []) {
    if (t === null || typeof t !== 'object' || Array.isArray(t) === true || typeof t.id !== 'string' || t.active !== true) continue
    const sc = t.schedule
    if (sc === null || typeof sc !== 'object' || (sc.mode !== 'cron' && sc.mode !== 'once')) continue
    reached.add(t.id)
    if (typeof sc.tz === 'string' && sc.tz !== '' && deps.isValidTimeZone(sc.tz) !== true) {
      warnings.push({ id: t.id, warning: 'unknown time zone: the machine zone is used' })
    }
    // The scheduler's own question first: does this fire at all?
    const upcoming = deps.computeNextRun(t, range.nowMs)
    if (deps.neverRuns(t, upcoming) === true) {
      cannotFire.push({ id: t.id, error: deps.noNextRunError(t) })
      continue
    }
    let cursor = range.fromMs - 1
    let listed = 0
    for (;;) {
      const at = deps.computeNextRun(t, cursor)
      if (at === null || Number.isFinite(at) !== true || at <= cursor || at > range.toMs) break
      if (listed >= OCC_PER_TASK || total >= OCC_TOTAL || clock() - started > OCC_BUDGET_MS) {
        truncated.push({ id: t.id, until: isoOf(Math.max(cursor, range.fromMs)) })
        if (clock() - started > OCC_BUDGET_MS) budgetSpent = true
        break
      }
      occurrences.push({ id: t.id, at: isoOf(at) })
      listed += 1
      total += 1
      cursor = at
    }
    // Out of budget: the automations not reached yet are not listed at all, and say so.
    if (budgetSpent === true) break
  }
  if (budgetSpent === true) {
    for (const t of Array.isArray(tasks) ? tasks : []) {
      if (t === null || typeof t !== 'object' || typeof t.id !== 'string' || t.active !== true || reached.has(t.id) === true) continue
      const sc = t.schedule
      if (sc === null || typeof sc !== 'object' || (sc.mode !== 'cron' && sc.mode !== 'once')) continue
      truncated.push({ id: t.id, until: isoOf(range.fromMs) })
    }
  }
  occurrences.sort((a, b) => (a.at < b.at ? -1 : (a.at > b.at ? 1 : (a.id < b.id ? -1 : (a.id > b.id ? 1 : 0)))))
  return { occurrences, cannotFire, warnings, truncated }
}
