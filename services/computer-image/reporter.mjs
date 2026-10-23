// A cloud computer's reporter (ADR 0052 §§ 10 and 13). A separate process next to DSH, with no dependency and no access to anything of the
// platform but its own restricted token: it says that the computer is up, that it is busy and how loaded it is, what automations it has, and which runs ended.
// It reads what DSH and the Kybernos plugin already keep on the volume and writes nothing there but its own small list of what it has
// reported; it changes nothing about how a run is made. What it sends is ids, labels, times, outcome codes and a few load figures, never a prompt or a result.
//
//   KYBERNOS_API             the platform's address       KYBERNOS_COMPUTER_TOKEN   its restricted token
//   DSH_HOME                 the profile on the volume    DSH_PORT                  DSH's loopback port (3081)
//   KYBERNOS_IMAGE_VERSION   a short build name, sent once
//
// It never stops DSH and is never fatal: a platform that cannot be reached is tried again with a pause; a token that is refused makes it
// quiet (one try every five minutes), because a computer whose token was revoked has nothing left to say.
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'

const API = String(process.env.KYBERNOS_API || '').replace(/\/+$/u, '')
const TOKEN = String(process.env.KYBERNOS_COMPUTER_TOKEN || '')
const HOME = String(process.env.DSH_HOME || '')
const DSH_PORT = Number(process.env.DSH_PORT || 3081)
const VERSION = String(process.env.KYBERNOS_IMAGE_VERSION || '').replace(/[^A-Za-z0-9._+-]/gu, '').slice(0, 40)
const BEAT_MS = Number(process.env.KYBERNOS_REPORT_EVERY_MS || 30_000)
// A beat answers at once; one that was in flight when the machine was suspended never does, and its timeout counts only the time the machine ran (see runner.mjs, CLAIM_TIMEOUT_MS).
export const HEARTBEAT_TIMEOUT_MS = Number(process.env.KYBERNOS_REPORT_BEAT_TIMEOUT_MS || 6000)

const log = (line) => console.log('[reporter] ' + line)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const readJson = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch (e) { return null } }

// ── the platform ─────────────────────────────────────────────────────────────────────────────
// What went wrong is said once per kind and path (a code, never a body): a computer that cannot reach its platform is a thing to read in its log.
const said = new Set()
const sayOnce = (key, line) => { if (!said.has(key)) { said.add(key); log(line) } }

// After a call that failed, the next one goes on a connection of its own: the one it used may be a socket that died with a suspend.
let fresh = false
export async function call (method, path, body, timeoutMs = 15_000) {
  try {
    const r = await fetch(API + path, {
      method,
      headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json', ...(fresh ? { connection: 'close' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    })
    fresh = false
    const text = await r.text()
    let json = null
    try { json = JSON.parse(text) } catch (e) { /* not json */ }
    if (r.status >= 300) sayOnce(`${path}:${r.status}`, `${method} ${path} answered ${r.status}`)
    else if (said.size > 0) { said.clear(); log(`${method} ${path} answered ${r.status}: the platform is reachable again`) }
    return { status: r.status, json }
  } catch (e) {
    const code = (e && e.cause && (e.cause.code || e.cause.name)) || (e && e.name) || 'error'
    sayOnce(`${path}:net:${code}`, `${method} ${path} could not be sent (${code})`)
    fresh = true
    return { status: 0, json: null }
  }
}

// ── what DSH and the plugin keep ───────────────────────────────────────────────────────────────
const tasksFile = () => join(HOME, 'kybernos', 'tasks.json')
const projectionDir = () => join(HOME, 'storages', 'session_projcache', 'sessions')
const reportedFile = () => join(HOME, 'kybernos', 'reported-runs.json')

const readTasks = () => {
  const t = readJson(tasksFile())
  return Array.isArray(t) ? t.filter((x) => x !== null && typeof x === 'object') : []
}

const HIDDEN = new RegExp('[' + [[0, 0x1f], [0x7f, 0x7f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2066, 0x2069], [0xfeff, 0xfeff]].map(([a, b]) => String.fromCharCode(a) + '-' + String.fromCharCode(b)).join('') + '<>]', 'gu')
export const cleanLabel = (v) => String(v ?? '').replace(HIDDEN, ' ').replace(/\s+/gu, ' ').trim().slice(0, 80) || 'Automation'
const isoOrNull = (v) => { const t = Date.parse(String(v ?? '')); return Number.isFinite(t) ? new Date(t).toISOString() : null }
const idOk = (v) => /^[A-Za-z0-9_.:-]{1,64}$/u.test(String(v))

/** The projection of a session: closed (its turn ended) and when it last changed. */
export function sessionState (sessionId) {
  const file = join(projectionDir(), sessionId + '.json')
  try {
    const rows = JSON.parse(readFileSync(file, 'utf8')).record.rows
    const open = rows.turnBoundary?.val?.openTurnStartSeq
    const steps = rows.sessionStats?.val?.steps ?? 0
    return { closed: open === null && steps > 0, at: statSync(file).mtime.toISOString() }
  } catch (e) { return null }
}

const lastOutcome = (task) => {
  const h = Array.isArray(task.history) ? task.history : []
  const last = h[h.length - 1]
  if (last === undefined || last === null) return { status: null, reason: null }
  if (last.status === 'error') return { status: 'error', reason: 'run_failed' }
  if (typeof last.sessionId === 'string') {
    const s = sessionState(last.sessionId)
    if (s !== null && s.closed) return { status: 'completed', reason: null }
  }
  return { status: null, reason: null }
}

export function scheduleOf (tasks) {
  const out = []
  for (const t of tasks) {
    if (!idOk(t.id)) continue
    const mode = t.schedule && typeof t.schedule === 'object' ? t.schedule.mode : null
    const o = lastOutcome(t)
    out.push({
      id: String(t.id),
      label: cleanLabel(t.name),
      kind: mode === 'cron' || mode === 'once' || mode === 'webhook' ? mode : 'manual',
      enabled: t.active !== false,
      next_run_at: isoOrNull(t.nextRun),
      last_run_at: isoOrNull(t.lastRun),
      last_status: o.status,
      last_reason: o.reason,
      tool_profile: null
    })
  }
  return out.slice(0, 50)
}

function loadReported () {
  const r = readJson(reportedFile())
  return new Set(Array.isArray(r) ? r.filter((x) => typeof x === 'string') : [])
}
function saveReported (set) {
  try {
    mkdirSync(join(HOME, 'kybernos'), { recursive: true })
    const list = [...set].slice(-2000)
    writeFileSync(reportedFile() + '.tmp', JSON.stringify(list), { mode: 0o600 })
    renameSync(reportedFile() + '.tmp', reportedFile())
  } catch (e) { /* the next report will send them again: the platform counts a run once */ }
}

/** Runs of the automations that have ended and were not reported yet: a session the plugin fired whose turn is closed. */
export function endedRuns (tasks, reported) {
  const runs = []
  for (const t of tasks) {
    if (!idOk(t.id)) continue
    const via = t.schedule && t.schedule.mode === 'webhook' ? 'webhook' : t.schedule && t.schedule.mode === 'cron' ? 'cron' : 'once'
    for (const h of Array.isArray(t.history) ? t.history : []) {
      if (h === null || typeof h !== 'object') continue
      const started = isoOrNull(h.at)
      if (started === null) continue
      const hasSession = typeof h.sessionId === 'string' && idOk(h.sessionId)
      // A fire that never made a session (it failed to start) is a run that ended in error: its id is the automation's and the moment.
      const runId = hasSession ? h.sessionId : t.id + ':' + started
      if (!idOk(runId) || reported.has(runId)) continue
      if (h.status === 'error' || !hasSession) {
        if (h.status !== 'error') continue
        runs.push({ run_id: runId, task_id: String(t.id), via, outcome: 'error', reason: 'run_failed', started_at: started, ended_at: started })
        continue
      }
      const s = sessionState(h.sessionId)
      if (s === null || !s.closed) continue
      const ended = Date.parse(s.at) >= Date.parse(started) ? s.at : started
      runs.push({ run_id: h.sessionId, task_id: String(t.id), via, outcome: 'completed', reason: null, started_at: started, ended_at: ended })
    }
  }
  return runs.slice(0, 100)
}

/** Sessions with a turn still open that changed lately: what keeps a computer from being put to sleep for idleness. */
function openSessions () {
  let n = 0
  try {
    const cutoff = Date.now() - 15 * 60_000
    for (const f of readdirSync(projectionDir())) {
      if (!f.endsWith('.json')) continue
      const file = join(projectionDir(), f)
      if (statSync(file).mtimeMs < cutoff) continue
      const rows = JSON.parse(readFileSync(file, 'utf8')).record.rows
      if (rows.turnBoundary?.val?.openTurnStartSeq !== null && rows.turnBoundary?.val?.openTurnStartSeq !== undefined) n += 1
      if (n >= 1000) break
    }
  } catch (e) { /* no session yet */ }
  return n
}

// ── how loaded the computer is ──────────────────────────────────────────────────────────────────
// The Kybernos plugin keeps the one reading of the machine (a level, the room for runs, the runs going). The reporter asks it on the loopback,
// as the claimer does, and passes a short summary on in the beat: numbers and ids, never a prompt.
const whole = (v, max) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(max, Math.round(n))) : 0 }

/** MemAvailable and MemTotal in MB, from the text of /proc/meminfo; null when they are not there. Never MemFree: the page cache makes it read near zero on a healthy machine. */
export function memoryOf (text) {
  const kb = (name) => { const m = new RegExp('^' + name + ':\\s+(\\d+)\\s*kB', 'mu').exec(String(text)); return m === null ? null : Number(m[1]) }
  const avail = kb('MemAvailable')
  const total = kb('MemTotal')
  if (avail === null || total === null || total <= 0) return null
  return { availMb: Math.round(avail / 1024), totalMb: Math.round(total / 1024) }
}

/** The `load` of a beat, from what the plugin answered (`GET /kybernos/automation-load`) and the memory just read; null when there is nothing true to say. */
export function loadOf (view, memory) {
  if (view === null || typeof view !== 'object' || view.ok !== true) return null
  if (view.level !== 'ok' && view.level !== 'busy' && view.level !== 'high') return null
  // With the machine's reading switched off or forced the plugin has no pressure: that is not the machine's load, so nothing is said.
  if (typeof view.pressure !== 'number' || !Number.isFinite(view.pressure)) return null
  if (memory === null || typeof memory !== 'object') return null
  return {
    level: view.level,
    pressure: whole(view.pressure, 100),
    cpu_per_core: typeof view.loadPerCpu === 'number' && Number.isFinite(view.loadPerCpu) ? Math.max(0, Math.min(64, Math.round(view.loadPerCpu * 100) / 100)) : 0,
    mem_avail_mb: whole(memory.availMb, 1_048_576),
    mem_total_mb: Math.max(1, whole(memory.totalMb, 1_048_576)),
    running: whole(view.inFlight, 64),
    waiting: whole(view.waiting, 64),
    allowed: whole(view.allowed, 64)
  }
}

/** The automations that have a run going, by their own id, with the moment the run started (at most eight). */
export function runningTasksOf (view, nowMs) {
  const runs = view !== null && typeof view === 'object' && Array.isArray(view.runs) ? view.runs : []
  const out = []
  for (const r of runs) {
    if (r === null || typeof r !== 'object' || !idOk(r.taskId)) continue
    const ms = Number(r.elapsedMs)
    out.push({ task_ref: String(r.taskId), started_at: new Date(nowMs - (Number.isFinite(ms) && ms > 0 ? ms : 0)).toISOString() })
    if (out.length >= 8) break
  }
  return out
}

/** The body of a beat: what it always said (sessions open, memory in use), and the load when the plugin could say it. An older platform ignores the added keys. */
export function beatOf (sessions, usedMb, view, memory, nowMs) {
  const body = { sessions, rss_mb: usedMb }
  const load = loadOf(view, memory)
  if (load !== null) { body.load = load; body.running_tasks = runningTasksOf(view, nowMs) }
  return body
}

async function readLoadView () {
  try {
    const local = `http://127.0.0.1:${DSH_PORT}`
    const r = await fetch(local + '/kybernos/automation-load', { headers: { origin: local }, signal: AbortSignal.timeout(2000) })
    if (r.status !== 200) return null
    return JSON.parse(await r.text())
  } catch (e) { return null }
}
const readMemory = () => { try { return memoryOf(readFileSync('/proc/meminfo', 'utf8')) } catch (e) { return null } }

async function dshAnswers () {
  try {
    const r = await fetch(`http://127.0.0.1:${DSH_PORT}/`, { signal: AbortSignal.timeout(2500) })
    await r.text()
    return true
  } catch (e) { return false }
}

// ── the loop ───────────────────────────────────────────────────────────────────────────────────
async function main () {
  if (API === '' || TOKEN === '' || HOME === '') {
    log('no platform, token or profile given: nothing to report to')
    return
  }
  log('started')
  while (!(await dshAnswers())) await sleep(2000)

  // Ready. A token the platform has not written yet (the machine can be faster than the row) answers 401: try again for a while.
  let said = false
  for (let attempt = 0; !said; attempt += 1) {
    const r = await call('POST', '/v1/computer/ready', VERSION === '' ? {} : { version: VERSION })
    if (r.status === 200) { said = true; log('ready: the platform knows this computer is up'); break }
    await sleep(Math.min(300_000, 5000 * (attempt + 1)))
  }

  const reported = loadReported()
  let lastSchedule = ''
  let lastScheduleAt = 0
  for (;;) {
    const tasks = readTasks()
    // The schedule, when it changed or every ten minutes (the platform replaces it as a whole).
    const sched = scheduleOf(tasks)
    const text = JSON.stringify(sched)
    if (text !== lastSchedule || Date.now() - lastScheduleAt > 600_000) {
      const r = await call('PUT', '/v1/computer/schedule', { tasks: sched })
      if (r.status === 200) { lastSchedule = text; lastScheduleAt = Date.now() }
    }
    // The runs that ended since.
    const runs = endedRuns(tasks, reported)
    if (runs.length > 0) {
      const r = await call('POST', '/v1/computer/runs', { runs })
      if (r.status === 200) {
        for (const x of runs) reported.add(x.run_id)
        saveReported(reported)
        log(`reported ${runs.length} run(s)`)
      }
    }
    // A beat: sessions open, memory in use, and how loaded the machine is (the plugin's own reading, asked on the loopback with a short timeout).
    const used = Math.max(0, Math.round((os.totalmem() - os.freemem()) / 1048576))
    const body = beatOf(openSessions(), used, await readLoadView(), readMemory(), Date.now())
    const beat = await call('POST', '/v1/computer/heartbeat', body, HEARTBEAT_TIMEOUT_MS)
    if (beat.status === 401 || beat.status === 404) await sleep(300_000)
    await sleep(BEAT_MS)
  }
}

// Run as a program; a test imports the pure functions above and starts nothing.
if (process.argv[1] !== undefined && import.meta.url === new URL('file://' + process.argv[1]).href) {
  main().catch((e) => { log('stopped: ' + String((e && e.message) || e)); process.exit(0) })
}
