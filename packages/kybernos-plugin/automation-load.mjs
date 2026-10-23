// Machine load and the cap on automation runs started at once (pure rules; index.js reads the machine and calls them).
//
// Why: the scheduler used to start every due task in the same tick, so ten crons on the same minute were ten sessions at once on
// a laptop or on a 1 GB cloud computer, and nothing looked at the machine first. Now a tick asks two questions: how loaded is the
// machine (a level), and how many automation runs are already going. The answer is the number of runs that may start now. The
// rest stay due and start on a later tick, oldest first: a deferred run is late, never lost.
//
// Lighter runs: while the machine is busy or very busy, the runs it starts (and the ones already going, at their next step) are told to work
// alone, and a sub-agent call from an automation run is refused beyond what the level allows (none when very busy, one at a time when busy).
// The engine caps the DEPTH of sub-agents, not their number, so the number is limited here, by the plugin's own `tools/pre-execute` listener.
//
// What it does NOT do: it does not hold a webhook event or a "run now" click (those are counted, not capped, but they are lightened like any
// other automation run), it does not touch a chat a person opened, and it does not see the agent-team tool (a different tool).
//
// The thresholds below are a first guess, not calibrated on a fleet: they are named so a measurement can move them.

/** Most automation runs going at once on a machine that is not loaded. `KYBERNOS_AUTOMATION_MAX_PARALLEL` overrides it. */
export const DEFAULT_MAX_PARALLEL = 3
export const MAX_PARALLEL_CEILING = 20

/** A due run is never held back by load for longer than this: a loaded machine slows the automations, it does not freeze them. */
export const HOLD_LIMIT_MS = 10 * 60000

/** A started run that the engine has not reported as running after this long is no longer counted (it failed to start). */
export const START_GRACE_MS = 2 * 60000
/** A run still reported as running after this long stops being counted (an end event was missed): the cap fails open. */
export const RUN_MAX_MS = 2 * 3600000

/** Memory still available to programs, as a share of the machine and in MB: below either `busy` bound the level is busy, at or below either `high` bound it is high. */
export const MEMORY = Object.freeze({ busyPct: 20, highPct: 10, busyMb: 400, highMb: 200 })
/** One-minute load average per core. */
export const CPU = Object.freeze({ busy: 1.5, high: 2.5 })

export const LEVELS = Object.freeze(['ok', 'busy', 'high'])
const RANK = Object.freeze({ ok: 0, busy: 1, high: 2 })

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** `KYBERNOS_AUTOMATION_MAX_PARALLEL` → a whole number from 1 to the ceiling, else the default. */
export const maxParallelFrom = (env) => {
  const raw = env !== null && typeof env === 'object' ? env.KYBERNOS_AUTOMATION_MAX_PARALLEL : undefined
  const n = typeof raw === 'string' && /^\d{1,3}$/.test(raw.trim()) ? Number(raw.trim()) : NaN
  return Number.isSafeInteger(n) && n >= 1 ? Math.min(n, MAX_PARALLEL_CEILING) : DEFAULT_MAX_PARALLEL
}

/**
 * `KYBERNOS_AUTOMATION_LOAD_GUARD=off`: the machine is not consulted (the level is always `ok`); the cap on runs going at once still
 * applies. For a machine whose reading is wrong or whose owner has decided, and for tests that must not depend on the load of the box.
 */
export const guardOff = (env) => env !== null && typeof env === 'object' && typeof env.KYBERNOS_AUTOMATION_LOAD_GUARD === 'string' && env.KYBERNOS_AUTOMATION_LOAD_GUARD.trim().toLowerCase() === 'off'

/**
 * `KYBERNOS_AUTOMATION_LOAD_FORCE=busy|high`: pretend the machine is at that level (a drill, a maintenance window, a test that must see the
 * lighter run). Anything else is no override. Wins over the reading; `KYBERNOS_AUTOMATION_LOAD_GUARD=off` is the other way round.
 */
export const forcedLevel = (env) => {
  const raw = env !== null && typeof env === 'object' && typeof env.KYBERNOS_AUTOMATION_LOAD_FORCE === 'string' ? env.KYBERNOS_AUTOMATION_LOAD_FORCE.trim().toLowerCase() : ''
  return raw === 'busy' || raw === 'high' ? raw : null
}

/**
 * The memory still available on Linux, from the text of /proc/meminfo (`MemAvailable`, which counts reclaimable cache; `MemFree`
 * does not, and reads as "full" on a healthy machine). Null when the text has no such line.
 */
export const parseMeminfo = (text) => {
  const m = /^MemAvailable:\s+(\d+)\s*kB/m.exec(typeof text === 'string' ? text : '')
  return m === null ? null : Math.round(Number(m[1]) / 1024)
}

/**
 * The raw facts about the machine → a level and the reasons for it.
 *   sample: { memAvailablePct, memAvailableMb, loadPerCpu }, each a number or null (null = unknown, never a reason).
 * Unknown facts never raise the level: a machine that cannot be measured is treated as free (fail-open).
 */
export const levelOf = (sample) => {
  const s = sample !== null && typeof sample === 'object' ? sample : {}
  const pct = num(s.memAvailablePct)
  const mb = num(s.memAvailableMb)
  const cpu = num(s.loadPerCpu)
  let level = 'ok'
  const reasons = []
  const raise = (to, reason) => {
    if (RANK[to] > RANK[level]) level = to
    if (reasons.indexOf(reason) < 0) reasons.push(reason)
  }
  if ((pct !== null && pct <= MEMORY.highPct) || (mb !== null && mb <= MEMORY.highMb)) raise('high', 'memory')
  else if ((pct !== null && pct < MEMORY.busyPct) || (mb !== null && mb < MEMORY.busyMb)) raise('busy', 'memory')
  if (cpu !== null && cpu >= CPU.high) raise('high', 'cpu')
  else if (cpu !== null && cpu >= CPU.busy) raise('busy', 'cpu')
  return { level, reasons }
}

/** Memory in MB at which a small machine starts to count as pressured: twice the busy bound, so the gauge rises before the level does. */
const MEMORY_ZERO_MB = 800

// 0 at `zero`, 0.5 at `busy`, 1 at `high`, straight lines between, whichever way the metric runs (memory falls, load rises).
const ramp = (v, zero, busy, high) => {
  const t1 = (v - zero) / (busy - zero)
  if (t1 <= 0) return 0
  if (t1 < 1) return 0.5 * t1
  const t2 = (v - busy) / (high - busy)
  return t2 >= 1 ? 1 : 0.5 + 0.5 * t2
}

/**
 * How close the machine is to `high`, as a whole number from 0 to 100, for a gauge: 50 at the `busy` thresholds, 100 at the `high` ones, in
 * memory (share and MB) and in load; the worst of them. `high` is always 100, `busy` is 50 to 99, `ok` is 50 at most. Null when nothing could
 * be measured (a gauge with nothing to show).
 */
export const pressureOf = (sample) => {
  const s = sample !== null && typeof sample === 'object' ? sample : {}
  const pct = num(s.memAvailablePct)
  const mb = num(s.memAvailableMb)
  const cpu = num(s.loadPerCpu)
  const parts = []
  if (pct !== null) parts.push(ramp(pct, 100, MEMORY.busyPct, MEMORY.highPct))
  if (mb !== null) parts.push(ramp(mb, MEMORY_ZERO_MB, MEMORY.busyMb, MEMORY.highMb))
  if (cpu !== null) parts.push(ramp(cpu, 0, CPU.busy, CPU.high))
  if (parts.length === 0) return null
  const worst = Math.max(...parts)
  return worst >= 1 ? 100 : Math.min(99, Math.round(worst * 100))
}

/** How many automation runs may be going at once at this level. */
export const allowedAt = (level, maxParallel) => {
  const max = Number.isSafeInteger(maxParallel) && maxParallel >= 1 ? maxParallel : DEFAULT_MAX_PARALLEL
  if (level === 'high') return 0
  if (level === 'busy') return 1
  return max
}

/**
 * Which of the due runs may start now.
 *   capacity: { level, allowed, inFlight }   (allowed = runs that may be going at once, inFlight = runs going now)
 *   due:      [{ id, dueMs }]                 (dueMs = the instant the run came due)
 * Oldest first, as many as there is room for. If there is no room but the oldest has waited more than HOLD_LIMIT_MS, that one
 * starts anyway: the cap slows the automations down, it never stops them. Returns the ids, in the order they start.
 */
export const admit = (capacity, due, nowMs) => {
  const list = (Array.isArray(due) ? due : []).filter((d) => d !== null && typeof d === 'object' && typeof d.id === 'string')
  list.sort((a, b) => (num(a.dueMs) === null ? 0 : a.dueMs) - (num(b.dueMs) === null ? 0 : b.dueMs))
  if (list.length === 0) return []
  const cap = capacity !== null && typeof capacity === 'object' ? capacity : {}
  const allowed = Number.isSafeInteger(cap.allowed) ? cap.allowed : Infinity
  const inFlight = Number.isSafeInteger(cap.inFlight) && cap.inFlight > 0 ? cap.inFlight : 0
  let room = Math.max(0, allowed - inFlight)
  if (room === 0 && num(nowMs) !== null && num(list[0].dueMs) !== null && nowMs - list[0].dueMs > HOLD_LIMIT_MS) room = 1
  return list.slice(0, room).map((d) => d.id)
}

/**
 * The automation runs going now, by session id. A run is counted from the moment its session is created (before the engine
 * says anything) and stops counting when the engine reports the session no longer running, when it is disposed, when it never
 * started within START_GRACE_MS, or after RUN_MAX_MS. Every doubt resolves to "not counted": the cap must fail open.
 */
export const createInflight = (opts) => {
  const o = opts !== null && typeof opts === 'object' ? opts : {}
  const now = typeof o.now === 'function' ? o.now : () => Date.now()
  const runs = new Map()
  const prune = () => {
    const t = now()
    for (const [id, r] of runs) {
      if (t - r.at > RUN_MAX_MS || (r.seen === false && t - r.at > START_GRACE_MS)) runs.delete(id)
    }
  }
  return {
    start(id) {
      if (typeof id !== 'string' || id.length === 0) return
      if (runs.size >= 500) prune()
      if (runs.size >= 500) runs.delete(runs.keys().next().value)
      runs.set(id, { at: now(), seen: false })
    },
    /** The engine's status of a session: `running` true while a turn goes on. Unknown sessions are ignored. */
    status(id, running) {
      const r = runs.get(id)
      if (r === undefined) return
      if (running === true) r.seen = true
      else if (r.seen === true) runs.delete(id)
    },
    end(id) { runs.delete(id) },
    count() { prune(); return runs.size },
  }
}

// ── Lighter runs ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A reading older than this is not trusted to lighten a run (nothing refreshed it: the scheduler is paused, say): the run is left alone. */
export const LEVEL_FRESH_MS = 2 * 60000
/** A sub-agent call that was let through counts as going for this long, unless the engine says its child ended first. */
export const SUBAGENT_LEASE_MS = 2 * 60000

/** The model-facing names of the sub-agent tools: `subagent` and `subagent_<worker>` (claude_code, codex, gemini...). */
export const isSubagentTool = (name) => typeof name === 'string' && /^subagent(_[a-z0-9_]+)?$/.test(name)

/** How many sub-agents the automation runs may have going at once: `null` is no limit, 0 is none. */
export const subagentLimitAt = (level) => (level === 'high' ? 0 : level === 'busy' ? 1 : null)

const NOTES = Object.freeze({
  busy: 'The computer is busy right now. Do the work yourself in this session wherever you can. If you do start a sub-agent, start only one at a time and wait for its result before starting another.',
  high: 'The computer is very busy right now. Do not start sub-agents: do the work yourself in this session, one step after the other.',
})
/** The line added to the instructions of an automation run at this level; empty when the machine is not loaded. */
export const noteAt = (level) => (level === 'busy' || level === 'high' ? NOTES[level] : '')

/** What the model reads when a sub-agent call is refused (the tool result of the refused call). */
export const refusalReason = (level) => (level === 'high'
  ? 'Sub-agent not started: this computer is very busy right now. Do this work yourself in this session.'
  : 'Sub-agent not started: this computer is busy and a sub-agent is already going. Wait for its result, or do this work yourself in this session.')

/** The level of the last reading, when it is recent enough to act on, else null. `last` is `{ at, level }`. */
export const freshLevel = (last, nowMs) => (last !== null && typeof last === 'object' && num(last.at) !== null && num(nowMs) !== null && nowMs - last.at <= LEVEL_FRESH_MS && LEVELS.indexOf(last.level) >= 0 ? last.level : null)

/**
 * The sub-agents the automation runs have going, as leases: one per call let through, ending after SUBAGENT_LEASE_MS or when
 * `release()` is told a child ended (the oldest lease goes). `decide(level)` says whether one more call may start now.
 * Soft by design: a lease that is never released only lasts two minutes, and an unknown level lets everything through.
 */
export const createSubagentGate = (opts) => {
  const o = opts !== null && typeof opts === 'object' ? opts : {}
  const now = typeof o.now === 'function' ? o.now : () => Date.now()
  let leases = []
  const live = () => { const t = now(); leases = leases.filter((at) => t - at < SUBAGENT_LEASE_MS); return leases.length }
  return {
    active: live,
    grant() { live(); leases.push(now()); if (leases.length > 200) leases.shift() },
    release() { live(); leases.shift() },
    decide(level) {
      const limit = subagentLimitAt(level)
      const active = live()
      return { allow: limit === null || active < limit, limit, active }
    },
  }
}

/** What the page shows: the level, how close it is to the top, why, the room, and the runs waiting. Never a path, an id or a prompt. */
export const publicView = (capacity, sample, waiting, subagents) => ({
  level: LEVELS.indexOf(capacity.level) >= 0 ? capacity.level : 'ok',
  // With the machine reading switched off the level is always `ok`: a gauge that still climbed would contradict it, so there is none.
  pressure: capacity.guard === undefined || capacity.guard === 'on' ? pressureOf(sample) : null,
  // Sub-agents: how many the runs may have going at this level (null = no limit), how many go, and how many calls were refused since the start.
  subagents: {
    limit: subagentLimitAt(capacity.level),
    active: subagents !== null && typeof subagents === 'object' && Number.isSafeInteger(subagents.active) && subagents.active >= 0 ? subagents.active : 0,
    refused: subagents !== null && typeof subagents === 'object' && Number.isSafeInteger(subagents.refused) && subagents.refused >= 0 ? subagents.refused : 0,
  },
  reasons: Array.isArray(capacity.reasons) ? capacity.reasons.filter((r) => r === 'memory' || r === 'cpu') : [],
  inFlight: Number.isSafeInteger(capacity.inFlight) ? capacity.inFlight : 0,
  allowed: Number.isSafeInteger(capacity.allowed) ? capacity.allowed : 0,
  maxParallel: Number.isSafeInteger(capacity.maxParallel) ? capacity.maxParallel : DEFAULT_MAX_PARALLEL,
  waiting: Number.isSafeInteger(waiting) && waiting > 0 ? waiting : 0,
  memAvailablePct: num(sample && sample.memAvailablePct) === null ? null : Math.round(sample.memAvailablePct),
  loadPerCpu: num(sample && sample.loadPerCpu) === null ? null : Math.round(sample.loadPerCpu * 100) / 100,
})
