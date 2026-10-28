// ═══════════════════════════════════════════════════════════════════════════
// janitor — the host-level, five-hour, dirty-only cleaning pass for the account
// memories (kybernos-cloud seam) and the local lessons (kybernos-memory seam).
//
// WHAT IT DOES
//   · ONE scheduler for the whole host (never one timer per chat) and ONE
//     inter-session file lock, so two DSH processes never clean at the same
//     time;
//   · runs when due: never succeeded yet (boot catch-up) or the last success is
//     older than INTERVAL_MS (five hours) — with a small jitter so several local
//     jobs do not start together;
//   · runs on a store ONLY when its revision changed since the last successful
//     inspection: no change = no scan, no model call, no notification (the run
//     still writes one status:'clean' report line);
//   · pass 1 (deterministic) and pass 2 (semantic, Study model) are the STORES'
//     work. This file is the scheduler / dirty check / bounds / backup / report
//     / retry layer that CALLS their public seam. It never re-implements dedupe,
//     and it never invents a model setting: whichever tidy setting the store
//     already has decides whether pass 2 may run;
//   · memory off = the whole janitor is skipped (status:'skipped',
//     reason:'memory_off'): no background processing of personal content.
//
// SCAN-ONLY BY DEFAULT — THE APPLY GATE
//   A real cleaning run needs the user's explicit approval, through ONE of:
//     · the environment variable KYBERNOS_JANITOR=apply, or
//     · {"apply": true} in the state file <DSH home>/kybernos/janitor/state.json.
//   Without either, every run inspects, records and reports but changes NOTHING:
//   the store seams are called with apply:false and a seam that changes a store
//   anyway is reported as an error (changed_in_scan_only). This is deliberate:
//   the first real cleaning of a user's stores is a user decision, never
//   something that happens on boot. KYBERNOS_JANITOR=off also stops the
//   scheduler from being mounted at all.
//
// PATHS (every one of them under KYBERNOS_JANITOR_DIR, default <DSH home>/kybernos/janitor)
//   state.json      last success, last revisions, failures, circuit breaker, apply flag
//   report.jsonl    one bounded JSONL line per run (last 200 lines / 256 KiB)
//   notices.jsonl   local notifications — change or failure only
//   lock            the inter-session lock (PID + time, stale reclaim after one interval)
//   backups/        timestamped snapshot written before ANY change (then pruned to 40)
//
// ROLLBACK
//   Scan-only mode writes no store content at all: deleting the janitor directory
//   (state, report, notices, backups, lock) is a complete rollback — the schedule
//   then restarts from the same scan-only default. Once apply mode was approved,
//   the janitor passes a backup path to the store seam, which writes it BEFORE any
//   change and keeps its own archive with its Undo: put the backup's content back
//   through the store's restore path, and delete this directory to stop the
//   schedule. Nothing here writes user data itself.
//
// PORTS (all injectable; a fixture port is what the tests use — never ~/.dsh)
//   { memory: { enabled(), revision(), scanAndClean({ apply, bounds, backupPath }) },
//     lessons: same,
//     now(), lock, reportPath, notify }
//   A store port may also carry { available: false } to mean "no seam installed".
//   scanAndClean returns:
//     { ok?, error?, unavailable?, before:{items,chars}, after:{items,chars},
//       inspected, candidates, merges, archives, conflicts, changed?,
//       model:{route,calls}, backupPath?, protectedViolations?[] }
//   Seams are published on the global symbol registry, so sibling bundles that
//   cannot import this file still reach it:
//     globalThis[Symbol.for('kybernos.janitor.memory')]  — kybernos-cloud
//     globalThis[Symbol.for('kybernos.janitor.lessons')] — kybernos-memory
//   each frozen { version: 1, enabled(), revision(), scanAndClean(options) }.
// ═══════════════════════════════════════════════════════════════════════════

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'

const say = (message) => { try { console.log('[kybernos-janitor] ' + message) } catch (e) { /* no console */ } }

// ── The product defaults of v1 (internal: the user configures nothing) ─────
export const JANITOR = Object.freeze({
  VERSION: 1,
  INTERVAL_MS: 5 * 3600 * 1000,        // every five hours while the host runs
  TICK_MS: 60 * 1000,                  // the scheduler re-checks due() about once a minute
  START_GRACE_MS: 30 * 1000,           // a moment after the host starts, then boot catch-up
  JITTER_MS: 5 * 60 * 1000,            // a run that is due waits a little, so local jobs never align
  SKIP_RECHECK_MS: 5 * 60 * 1000,      // memory off / no seam: look again in five minutes, not every minute
  MAX_INSPECTED: 200,                  // bounded pass 1 (items looked at)
  MAX_CANDIDATES: 20,                  // bounded pass 2 (semantic candidates handed to the model)
  MAX_MODEL_CALLS: 4,                  // bounded model calls per store per run
  MAX_REMOVALS: 20,                    // bounded merges + archives per store per run
  MAX_CONSECUTIVE_FAILURES: 3,         // then one local notice and a long back-off
  CIRCUIT_BACKOFF_MS: 24 * 3600 * 1000,
  REPORT_MAX_LINES: 200,
  REPORT_MAX_BYTES: 256 * 1024,
  REPORT_LINE_MAX_BYTES: 4096,
  NOTICES_MAX_LINES: 200,
  LOCK_STALE_MS: 5 * 3600 * 1000,      // a lock older than one interval is reclaimed
  BACKUPS_KEEP: 40,
  CHARS_PER_TOKEN: 4,                  // the same coarse estimate the rest of the repo uses
  MEMORY_SEAM: Symbol.for('kybernos.janitor.memory'),
  LESSONS_SEAM: Symbol.for('kybernos.janitor.lessons'),
  APPLY_ENV: 'KYBERNOS_JANITOR',
})

const iso = (ms) => new Date(ms).toISOString()
const hex = (bytes = 3) => { try { return randomBytes(bytes).toString('hex') } catch (e) { return Math.floor(Math.random() * 0xffffff).toString(16) } }
export const estimateTokens = (chars) => (Number.isFinite(chars) && chars > 0 ? Math.round(chars / JANITOR.CHARS_PER_TOKEN) : 0)
const attempt = async (fn) => { try { return { ok: true, value: await fn() } } catch (e) { return { ok: false, error: String((e && e.message) || e) } } }
const isObject = (v) => v !== null && typeof v === 'object' && Array.isArray(v) === false

// ── Where everything lives ─────────────────────────────────────────────────
const envOf = (config) => (isObject(config) && isObject(config.env) ? config.env : process.env)

/** The DSH home, read the way the rest of the host reads it (DSH_HOME wins, else ~/.dsh). */
export const dshHome = (env = process.env) => {
  const raw = isObject(env) && typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  if (raw === '') return join(homedir(), '.dsh')
  if (raw === '~') return homedir()
  return resolve(raw.startsWith('~/') ? join(homedir(), raw.slice(2)) : raw)
}

/** The janitor directory: an explicit `config.dir` (tests), then KYBERNOS_JANITOR_DIR, then the DSH home. */
export const janitorDir = (config = {}) => {
  const explicit = isObject(config) && typeof config.dir === 'string' ? config.dir.trim() : ''
  if (explicit !== '') return resolve(explicit)
  const env = envOf(config)
  const own = typeof env.KYBERNOS_JANITOR_DIR === 'string' ? env.KYBERNOS_JANITOR_DIR.trim() : ''
  if (own !== '') return resolve(own)
  return join(dshHome(env), 'kybernos', 'janitor')
}

export const janitorPaths = (dir) => ({
  dir,
  state: join(dir, 'state.json'),
  report: join(dir, 'report.jsonl'),
  notices: join(dir, 'notices.jsonl'),
  lock: join(dir, 'lock'),
  backups: join(dir, 'backups'),
})

// ── State: the last success, the last revisions, the failure history ───────
export const emptyState = () => ({
  version: JANITOR.VERSION,
  lastSuccessfulAt: null,
  lastRevisions: { memory: null, lessons: null },
  consecutiveFailures: 0,
  nextRunAt: null,
  retryAt: null,
  circuitUntil: null,
  appliedOnce: false,
  apply: false,        // the user's explicit approval (never written by the janitor itself)
  lastRun: null,
  lastSkip: null,
})

export const normalizeState = (raw) => {
  const base = emptyState()
  if (!isObject(raw)) return base
  const asIso = (v) => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null)
  const asText = (v) => (typeof v === 'string' && v.trim() !== '' ? v : null)
  const revisions = isObject(raw.lastRevisions) ? raw.lastRevisions : {}
  return {
    version: JANITOR.VERSION,
    lastSuccessfulAt: asIso(raw.lastSuccessfulAt),
    lastRevisions: { memory: asText(revisions.memory), lessons: asText(revisions.lessons) },
    consecutiveFailures: Number.isFinite(raw.consecutiveFailures) && raw.consecutiveFailures > 0 ? Math.min(99, Math.floor(raw.consecutiveFailures)) : 0,
    nextRunAt: asIso(raw.nextRunAt),
    retryAt: asIso(raw.retryAt),
    circuitUntil: asIso(raw.circuitUntil),
    appliedOnce: raw.appliedOnce === true,
    apply: raw.apply === true,
    lastRun: isObject(raw.lastRun) ? { runId: asText(raw.lastRun.runId), at: asIso(raw.lastRun.at), status: asText(raw.lastRun.status), reason: asText(raw.lastRun.reason) } : null,
    lastSkip: isObject(raw.lastSkip) && asText(raw.lastSkip.reason) !== null && asIso(raw.lastSkip.at) !== null ? { reason: asText(raw.lastSkip.reason), at: asIso(raw.lastSkip.at) } : null,
  }
}

export const readState = (dir) => {
  let raw = null
  try { raw = JSON.parse(readFileSync(janitorPaths(dir).state, 'utf8')) } catch (e) { raw = null }
  return normalizeState(raw)
}

export const writeState = (state, dir) => {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = janitorPaths(dir).state
  const tmp = file + '.tmp-' + String(process.pid)
  try {
    writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 })
    renameSync(tmp, file)
  } catch (e) {
    try { rmSync(tmp, { force: true }) } catch (e2) { /* nothing to clean */ }
    throw e
  }
  return state
}

/** The pure due rule: circuit, then a pending retry, then boot catch-up / the five-hour interval. */
export const due = (state, nowMs) => {
  const when = Number.isFinite(nowMs) ? nowMs : Date.now()
  const circuit = isObject(state) && typeof state.circuitUntil === 'string' ? Date.parse(state.circuitUntil) : NaN
  if (Number.isFinite(circuit) && when < circuit) return { due: false, why: 'circuit_open', at: state.circuitUntil }
  const retry = isObject(state) && typeof state.retryAt === 'string' ? Date.parse(state.retryAt) : NaN
  if (Number.isFinite(retry) && when < retry) return { due: false, why: 'retry_wait', at: state.retryAt }
  const last = isObject(state) && typeof state.lastSuccessfulAt === 'string' ? Date.parse(state.lastSuccessfulAt) : NaN
  if (!Number.isFinite(last)) return { due: true, why: 'boot_catch_up' }
  if (when - last >= JANITOR.INTERVAL_MS) return { due: true, why: 'interval' }
  return { due: false, why: 'not_due', at: state.lastSuccessfulAt }
}

/** The apply gate — the ONLY place that decides whether a store may be changed. Scan-only by default. */
export const applyGate = (state, env = process.env) => {
  const flag = isObject(env) && typeof env[JANITOR.APPLY_ENV] === 'string' ? env[JANITOR.APPLY_ENV].trim().toLowerCase() : ''
  if (flag === 'apply') return true
  if (flag === 'off') return false
  return isObject(state) && state.apply === true
}

// ── The inter-session lock (atomic O_EXCL file, PID + time, stale reclaim) ─
const processAlive = (pid) => {
  const n = Number(pid)
  if (!Number.isInteger(n) || n <= 0) return false
  try { process.kill(n, 0); return true } catch (e) { return isObject(e) && e.code === 'EPERM' }
}

const readLockFile = (path) => {
  try {
    const row = JSON.parse(readFileSync(path, 'utf8'))
    if (isObject(row)) return { pid: Number.isInteger(row.pid) ? row.pid : null, at: typeof row.at === 'string' ? row.at : null, token: typeof row.token === 'string' ? row.token : null, corrupt: false }
  } catch (e) { /* unreadable or corrupt: fall through to its mtime */ }
  let at = null
  try { at = iso(statSync(path).mtimeMs) } catch (e) { at = null }
  return { pid: null, at, token: null, corrupt: true }
}

export const createFileLock = ({ dir, now = () => Date.now(), staleMs = JANITOR.LOCK_STALE_MS, pid = process.pid } = {}) => {
  const path = janitorPaths(dir).lock
  const token = () => String(pid) + '-' + hex(6)
  const holderOf = () => readLockFile(path)
  let owned = null   // the token THIS lock instance wrote (release only removes its own lock)

  const acquireOnce = (own) => {
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      const fd = openSync(path, 'wx', 0o600)
      try { writeFileSync(fd, JSON.stringify({ pid, at: iso(now()), token: own }) + '\n') } finally { closeSync(fd) }
      return { ok: true, token: own }
    } catch (e) {
      if (isObject(e) && e.code === 'EEXIST') {
        const holder = holderOf()
        return { ok: false, error: 'held', holder }
      }
      return { ok: false, error: isObject(e) ? (e.code || 'lock_failed') : 'lock_failed' }
    }
  }

  const isStale = (holder) => {
    if (holder === null || holder === undefined) return false
    const at = typeof holder.at === 'string' ? Date.parse(holder.at) : NaN
    if (!Number.isFinite(at)) return true                     // corrupt lock: no age to trust
    if (now() - at > staleMs) return true                     // older than one interval
    if (holder.pid !== null && processAlive(holder.pid) !== true) return true   // dead process
    return false
  }

  return {
    path,
    holder: () => holderOf(),
    acquire () {
      const own = token()
      const first = acquireOnce(own)
      if (first.ok === true) { owned = own; return first }
      if (first.error !== 'held') return first
      const holder = first.holder
      if (isStale(holder) !== true) return first
      // one reclaim attempt, never a loop: another process may be reclaiming too
      try { rmSync(path, { force: true }) } catch (e) { /* already gone */ }
      const second = acquireOnce(own)
      if (second.ok === true) { owned = own; return { ...second, reclaimed: holder } }
      return second
    },
    release () {
      if (owned === null) return false
      const holder = holderOf()
      const mine = owned
      owned = null
      // only the owner releases: a reclaimed lock belongs to whoever wrote it last
      if (!isObject(holder) || holder.token !== mine) return false
      try { rmSync(path, { force: true }) } catch (e) { return false }
      return true
    },
  }
}

// ── The bounded JSONL sinks (report, notices) and the local notification ───
export const appendBounded = (file, text, limits = {}) => {
  const maxLines = Number.isFinite(limits.maxLines) && limits.maxLines > 0 ? limits.maxLines : JANITOR.REPORT_MAX_LINES
  const maxBytes = Number.isFinite(limits.maxBytes) && limits.maxBytes > 0 ? limits.maxBytes : JANITOR.REPORT_MAX_BYTES
  const line = String(text).replace(/\r?\n/g, ' ')
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  let rows = []
  try {
    let raw = readFileSync(file, 'utf8')
    if (raw.length > maxBytes * 4) raw = raw.slice(-maxBytes * 2)
    rows = raw.split('\n').filter((r) => r.trim() !== '')
  } catch (e) { rows = [] }
  rows.push(line)
  if (rows.length > maxLines) rows = rows.slice(rows.length - maxLines)
  let body = rows.join('\n') + '\n'
  while (Buffer.byteLength(body) > maxBytes && rows.length > 1) { rows.shift(); body = rows.join('\n') + '\n' }
  if (Buffer.byteLength(body) > maxBytes) { rows = []; body = '' }   // one line over the whole cap: dropped, never a torn line
  const tmp = file + '.tmp-' + String(process.pid)
  writeFileSync(tmp, body, { mode: 0o600 })
  renameSync(tmp, file)
  return { lines: rows.length, bytes: Buffer.byteLength(body) }
}

const writeNotice = (dir, notice) => {
  try {
    const row = { at: isObject(notice) && typeof notice.at === 'string' ? notice.at : iso(Date.now()), kind: isObject(notice) && typeof notice.kind === 'string' ? notice.kind : 'info', runId: isObject(notice) && typeof notice.runId === 'string' ? notice.runId : null, message: isObject(notice) ? String(notice.message || '') : String(notice || '') }
    appendBounded(janitorPaths(dir).notices, JSON.stringify(row), { maxLines: JANITOR.NOTICES_MAX_LINES, maxBytes: 64 * 1024 })
  } catch (e) { /* the sink is best effort */ }
  say(isObject(notice) ? String(notice.message || notice.kind || 'notice') : String(notice))
}

// ── The seams a sibling bundle publishes on the global symbol registry ─────
/**
 * Reads one seam and turns it into a port. `{ available: false }` means "this
 * store is not installed here": the janitor skips it and never throws.
 */
export const resolveSeamPort = (symbol, target = globalThis) => {
  try {
    const seam = target === null || target === undefined ? null : target[symbol]
    if (!isObject(seam)) return { available: false, reason: 'no_seam' }
    if (seam.version !== 1) return { available: false, reason: 'bad_version' }
    const clean = typeof seam.scanAndClean === 'function' ? seam.scanAndClean : (typeof seam.clean === 'function' ? seam.clean : null)
    if (typeof seam.enabled !== 'function' || typeof seam.revision !== 'function' || clean === null) return { available: false, reason: 'bad_seam' }
    return {
      available: true,
      enabled: () => seam.enabled(),
      revision: () => seam.revision(),
      scanAndClean: (options) => clean.call(seam, options),
    }
  } catch (e) { return { available: false, reason: 'seam_error' } }
}

const portAvailable = (port) => {
  if (!isObject(port)) return false
  if (port.available === false) return false
  return typeof port.enabled === 'function' && typeof port.revision === 'function' && typeof port.scanAndClean === 'function'
}

const portReason = (port) => (isObject(port) && typeof port.reason === 'string' ? port.reason : 'unavailable')

/**
 * The default port of a sibling bundle's seam. It is resolved on EVERY call:
 * bundles mount in no guaranteed order, so a seam published after the janitor was
 * created (the usual case) is picked up without a host restart.
 */
const lazySeamPort = (symbol) => ({
  get available () { return resolveSeamPort(symbol).available },
  get reason () { return resolveSeamPort(symbol).reason },
  enabled: () => resolveSeamPort(symbol).enabled(),
  revision: () => resolveSeamPort(symbol).revision(),
  scanAndClean: (options) => resolveSeamPort(symbol).scanAndClean(options),
})

// ── The janitor itself ─────────────────────────────────────────────────────
/**
 * Creates one janitor. Everything is injectable so the tests never touch a live
 * store: `config = { dir, env, random, ports: { memory, lessons, now, lock, reportPath, notify } }`.
 */
export function createJanitor (config = {}) {
  const dir = janitorDir(config)
  const paths = janitorPaths(dir)
  const env = envOf(config)
  const now = isObject(config) && isObject(config.ports) && typeof config.ports.now === 'function' ? config.ports.now : () => Date.now()
  const random = isObject(config) && typeof config.random === 'function' ? config.random : Math.random
  const lock = isObject(config) && isObject(config.ports) && isObject(config.ports.lock) ? config.ports.lock : createFileLock({ dir, now })
  const reportPath = isObject(config) && isObject(config.ports) && typeof config.ports.reportPath === 'string' && config.ports.reportPath.trim() !== '' ? resolve(config.ports.reportPath) : paths.report
  const notify = isObject(config) && isObject(config.ports) && typeof config.ports.notify === 'function' ? config.ports.notify : (notice) => writeNotice(dir, notice)
  const ports = {
    memory: isObject(config) && isObject(config.ports) && config.ports.memory !== undefined ? config.ports.memory : lazySeamPort(JANITOR.MEMORY_SEAM),
    lessons: isObject(config) && isObject(config.ports) && config.ports.lessons !== undefined ? config.ports.lessons : lazySeamPort(JANITOR.LESSONS_SEAM),
  }
  const bounds = { maxInspected: JANITOR.MAX_INSPECTED, maxCandidates: JANITOR.MAX_CANDIDATES, maxModelCalls: JANITOR.MAX_MODEL_CALLS, maxRemovals: JANITOR.MAX_REMOVALS }
  let jitterAt = null
  let stopped = true

  const backupFile = (name, runId, whenMs) => join(paths.backups, iso(whenMs).replace(/[:.]/g, '-') + '-' + name + '-' + runId + '.json')
  const fileNonEmpty = (file) => { try { return statSync(file).size > 0 } catch (e) { return false } }
  const pruneBackups = () => {
    try {
      const names = readdirSync(paths.backups).filter((n) => /^\d{4}-\d{2}-\d{2}T.*\.json$/.test(n)).sort()
      for (const name of names.slice(0, Math.max(0, names.length - JANITOR.BACKUPS_KEEP))) {
        try { unlinkSync(join(paths.backups, name)) } catch (e) { /* kept */ }
      }
    } catch (e) { /* no backups yet */ }
  }

  const compactView = (view) => {
    const out = { available: view.available !== false }
    if (view.available === false) { out.reason = String(view.reason || 'unavailable'); return out }
    out.enabled = view.enabled !== false
    if (view.clean === true) out.clean = true
    if (view.skipped === true) out.skipped = true
    for (const key of ['inspected', 'candidates', 'merges', 'archives', 'conflicts']) if (Number.isFinite(view[key])) out[key] = view[key]
    if (isObject(view.model)) out.model = { route: view.model.route === undefined ? null : view.model.route, calls: Number.isFinite(view.model.calls) ? view.model.calls : 0 }
    if (typeof view.backupPath === 'string') out.backup = view.backupPath
    if (typeof view.error === 'string' && view.error !== '') out.error = view.error
    return out
  }

  const normalizeStoreResult = (raw, options) => {
    const r = isObject(raw) ? raw : {}
    const num = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0)
    const b = isObject(r.before) ? r.before : {}
    const a = isObject(r.after) ? r.after : {}
    const model = isObject(r.model) ? r.model : {}
    const before = { items: num(b.items), chars: num(b.chars) }
    const after = { items: num(a.items), chars: num(a.chars) }
    const merges = num(r.merges)
    const archives = num(r.archives)
    const inspected = num(r.inspected)
    const candidates = num(r.candidates)
    const modelCalls = num(model.calls)
    const view = {
      available: true,
      unavailable: r.unavailable === true,
      ok: r.ok !== false,
      error: typeof r.error === 'string' ? r.error : null,
      enabled: true,
      before,
      after,
      inspected,
      candidates,
      merges,
      archives,
      conflicts: num(r.conflicts),
      model: { route: typeof model.route === 'string' && model.route.trim() !== '' ? model.route.trim() : null, calls: modelCalls },
      backupPath: typeof r.backupPath === 'string' && r.backupPath.trim() !== '' ? r.backupPath : (typeof options.backupPath === 'string' ? options.backupPath : null),
      protectedViolations: Array.isArray(r.protectedViolations) ? r.protectedViolations.map(String).slice(0, 10) : (num(r.removedProtected) > 0 ? ['removedProtected:' + num(r.removedProtected)] : []),
      boundsViolations: [],
      changed: r.changed === true || after.items !== before.items || after.chars !== before.chars || merges > 0 || archives > 0,
    }
    // Bounds are the store seam's job; a seam that ignores them is REPORTED, never silently accepted.
    if (inspected > bounds.maxInspected) view.boundsViolations.push('inspected')
    if (candidates > bounds.maxCandidates) view.boundsViolations.push('candidates')
    if (modelCalls > bounds.maxModelCalls) view.boundsViolations.push('model_calls')
    if (modelCalls > 0 && candidates === 0) view.boundsViolations.push('model_without_candidates')
    if (merges + archives > bounds.maxRemovals) view.boundsViolations.push('removals')
    if (options.apply !== true && view.changed) view.boundsViolations.push('changed_in_scan_only')
    return view
  }

  const serializeLine = (line) => {
    let text = JSON.stringify(line)
    if (Buffer.byteLength(text) <= JANITOR.REPORT_LINE_MAX_BYTES) return text
    const lean = { ...line, stores: undefined, backups: undefined, protectedViolations: line.protectedViolations.slice(0, 2), boundsViolations: line.boundsViolations.slice(0, 2), errors: line.errors.slice(0, 2) }
    delete lean.stores
    delete lean.backups
    text = JSON.stringify(lean)
    if (Buffer.byteLength(text) <= JANITOR.REPORT_LINE_MAX_BYTES) return text
    return JSON.stringify({ runId: line.runId, start: line.start, end: line.end, status: line.status, truncated: true, errors: line.errors.slice(0, 2) })
  }

  const buildLine = (payload, whenMs) => {
    const before = isObject(payload.before) ? payload.before : { items: 0, chars: 0 }
    const after = isObject(payload.after) ? payload.after : { items: 0, chars: 0 }
    const tokens = { before: estimateTokens(before.chars), after: estimateTokens(after.chars), saved: Math.max(0, estimateTokens(before.chars) - estimateTokens(after.chars)) }
    const backups = isObject(payload.backups) ? payload.backups : {}
    const line = {
      runId: payload.runId,
      start: iso(payload.startedAt),
      end: iso(whenMs),
      durationMs: Math.max(0, whenMs - payload.startedAt),
      status: payload.status,
      apply: payload.apply === true,
      dirtyStores: Array.isArray(payload.dirtyStores) ? payload.dirtyStores.slice(0, 4) : [],
      before: { items: before.items, chars: before.chars },
      after: { items: after.items, chars: after.chars },
      tokens,
      merges: Number.isFinite(payload.merges) ? payload.merges : 0,
      archives: Number.isFinite(payload.archives) ? payload.archives : 0,
      conflicts: Number.isFinite(payload.conflicts) ? payload.conflicts : 0,
      model: { route: typeof payload.route === 'string' ? payload.route : null, calls: Number.isFinite(payload.modelCalls) ? payload.modelCalls : 0 },
      stores: isObject(payload.stores) ? payload.stores : {},
      errors: Array.isArray(payload.errors) ? payload.errors.slice(0, 8).map(String) : [],
      protectedViolations: Array.isArray(payload.protectedViolations) ? payload.protectedViolations.slice(0, 8).map(String) : [],
      boundsViolations: Array.isArray(payload.boundsViolations) ? payload.boundsViolations.slice(0, 8).map(String) : [],
      backupPath: typeof payload.backupPath === 'string' ? payload.backupPath : (Object.values(backups).find((v) => typeof v === 'string') || null),
      backups,
      lock: isObject(payload.lock) ? payload.lock : { pid: process.pid, acquired: false },
    }
    if (typeof payload.reason === 'string') line.reason = payload.reason
    return line
  }

  /**
   * The only exit of a run: builds the report line, moves the state forward
   * (success / failure / skip), appends the bounded report, notifies when
   * something changed or a failure needs attention. Never throws.
   */
  const finish = (payload) => {
    const when = now()
    const line = buildLine(payload, when)
    let silent = false
    let notice = payload.notice === undefined ? null : payload.notice
    const state = readState(dir)
    try {
      if (payload.failure === true) {
        const failures = Math.min(99, (Number.isFinite(state.consecutiveFailures) ? state.consecutiveFailures : 0) + 1)
        state.consecutiveFailures = failures
        state.retryAt = iso(when + JANITOR.TICK_MS)
        state.nextRunAt = state.retryAt
        state.lastSkip = null
        state.lastRun = { runId: line.runId, at: line.end, status: line.status, reason: typeof line.reason === 'string' ? line.reason : null }
        if (failures >= JANITOR.MAX_CONSECUTIVE_FAILURES) {
          state.circuitUntil = iso(when + JANITOR.CIRCUIT_BACKOFF_MS)
          state.nextRunAt = state.circuitUntil
          if (failures === JANITOR.MAX_CONSECUTIVE_FAILURES) {
            notice = { kind: 'failure', runId: line.runId, message: 'Janitor failed ' + failures + ' runs in a row (' + (line.errors[0] || 'unknown error') + '); stores are untouched, next attempt in 24 h.' }
          }
        }
        try { writeState(state, dir) } catch (e) { /* a read-only home must not break the host */ }
        line.state = { consecutiveFailures: failures, circuitUntil: state.circuitUntil, nextRunAt: state.nextRunAt }
      } else if (payload.status === 'skipped') {
        const reason = typeof payload.reason === 'string' ? payload.reason : 'skipped'
        const last = state.lastSkip
        const lastAt = last === null ? NaN : Date.parse(last.at)
        silent = last !== null && last.reason === reason && Number.isFinite(lastAt) && when - lastAt < JANITOR.INTERVAL_MS
        // a skip caused by the schedule itself (not due / retry wait / circuit) keeps the pending times it found
        if (reason !== 'not_due' && reason !== 'retry_wait' && reason !== 'circuit_open') {
          const recheck = reason === 'memory_off' || reason === 'stores_unavailable' ? JANITOR.SKIP_RECHECK_MS : JANITOR.TICK_MS
          state.retryAt = iso(when + recheck)
          state.nextRunAt = state.retryAt
        }
        if (silent !== true) state.lastSkip = { reason, at: iso(when) }
        state.lastRun = { runId: line.runId, at: line.end, status: line.status, reason }
        try { writeState(state, dir) } catch (e) { /* a read-only home must not break the host */ }
      } else if (payload.success === true) {
        state.lastSuccessfulAt = iso(when)
        state.lastRevisions = { ...state.lastRevisions, ...(isObject(payload.revisions) ? payload.revisions : {}) }
        state.consecutiveFailures = 0
        state.retryAt = null
        state.circuitUntil = null
        state.nextRunAt = iso(when + JANITOR.INTERVAL_MS)
        state.lastSkip = null
        if (payload.apply === true && payload.changed === true) state.appliedOnce = true
        state.lastRun = { runId: line.runId, at: line.end, status: line.status, reason: typeof line.reason === 'string' ? line.reason : null }
        try { writeState(state, dir) } catch (e) { /* a read-only home must not break the host */ }
        line.state = { lastSuccessfulAt: state.lastSuccessfulAt, consecutiveFailures: 0, nextRunAt: state.nextRunAt }
        if (payload.apply === true && payload.changed === true) { try { pruneBackups() } catch (e) { /* best effort */ } }
      }
    } catch (e) { /* the state must never take a run down */ }
    if (silent !== true) {
      try { appendBounded(reportPath, serializeLine(line), { maxLines: JANITOR.REPORT_MAX_LINES, maxBytes: JANITOR.REPORT_MAX_BYTES }) } catch (e) { /* full disk: the host keeps running */ }
    }
    if (notice !== null && notice !== undefined) {
      try { notify({ ...notice, runId: line.runId, at: line.end }) } catch (e) { /* a sink that throws must not break the run */ }
    }
    return line
  }

  /** Memory off skips the WHOLE janitor (no background processing of personal content). */
  const checkStores = async (state, stores) => {
    const memory = ports.memory
    const memoryAvailable = portAvailable(memory)
    if (memoryAvailable !== true) stores.memory = compactView({ available: false, reason: portReason(memory) })
    else {
      const enabled = await attempt(() => memory.enabled())
      if (enabled.ok !== true) return { error: 'memory:enabled', stores }
      if (enabled.value === false) return { memoryOff: true, stores }
      stores.memory = compactView({ available: true, enabled: true })
    }
    const lessons = ports.lessons
    let lessonsRuns = false
    if (portAvailable(lessons) !== true) stores.lessons = compactView({ available: false, reason: portReason(lessons) })
    else {
      const enabled = await attempt(() => lessons.enabled())
      if (enabled.ok !== true) return { error: 'lessons:enabled', stores }
      if (enabled.value === false) stores.lessons = compactView({ available: true, enabled: false, skipped: true })
      else { lessonsRuns = true; stores.lessons = compactView({ available: true, enabled: true }) }
    }
    const active = []
    if (memoryAvailable === true) active.push('memory')
    if (lessonsRuns === true) active.push('lessons')
    return { stores, active }
  }

  /** One cleaning cycle: due? stores? revisions changed? scan, validate, account, report. */
  const cycle = async (context, lockInfo) => {
    const state = readState(dir)
    const when = now()
    const d = due(state, when)
    if (d.due !== true) return finish({ ...context, status: 'skipped', reason: d.why, lock: lockInfo, stores: {} })
    const stores = {}
    const checked = await checkStores(state, stores)
    if (checked.error !== undefined) {
      return finish({ ...context, status: 'error', reason: 'store_unavailable', failure: true, lock: lockInfo, stores: checked.stores, dirtyStores: [], errors: [checked.error] })
    }
    if (checked.memoryOff === true) return finish({ ...context, status: 'skipped', reason: 'memory_off', lock: lockInfo, stores: checked.stores, dirtyStores: [] })
    const active = Array.isArray(checked.active) ? checked.active : []
    if (active.length === 0) return finish({ ...context, status: 'skipped', reason: 'stores_unavailable', lock: lockInfo, stores: checked.stores, dirtyStores: [] })

    // Dirty-only: a store whose revision equals the last successful inspection is not looked at.
    const revisions = {}
    const dirtyStores = []
    for (const name of active) {
      const revision = await attempt(() => ports[name].revision())
      if (revision.ok !== true) {
        return finish({ ...context, status: 'error', reason: 'store_unavailable', failure: true, lock: lockInfo, stores: checked.stores, dirtyStores, errors: [name + ':revision'] })
      }
      const value = typeof revision.value === 'string' && revision.value.trim() !== '' ? revision.value.trim() : null
      revisions[name] = value
      const unchanged = value !== null && state.lastRevisions[name] === value
      if (unchanged === true && state.lastRevisions[name] !== null) {
        stores[name] = compactView({ available: true, enabled: true, clean: true })
      } else {
        dirtyStores.push(name)
      }
    }
    if (dirtyStores.length === 0) {
      return finish({ ...context, status: 'clean', reason: 'unchanged', success: true, revisions, lock: lockInfo, stores, dirtyStores: [] })
    }

    // Scan the dirty stores. Pass 1 and pass 2 happen in the store's own tidy path.
    const totals = { before: { items: 0, chars: 0 }, after: { items: 0, chars: 0 }, merges: 0, archives: 0, conflicts: 0, modelCalls: 0, route: null, backups: {} }
    const errors = []
    const protectedViolations = []
    const boundsViolations = []
    let changedAny = false
    for (const name of dirtyStores) {
      const options = { apply: context.apply, bounds, backupPath: context.apply === true ? backupFile(name, context.runId, when) : null }
      const scanned = await attempt(() => ports[name].scanAndClean(options))
      if (scanned.ok !== true) {
        errors.push(name + ':throws')
        stores[name] = compactView({ available: true, enabled: true, error: 'threw' })
        // the seam writes its backup BEFORE it touches anything: on a failure in the
        // middle, the snapshot the janitor asked for is the proof of what was there
        if (options.apply === true && fileNonEmpty(options.backupPath)) totals.backups[name] = options.backupPath
        break
      }
      const view = normalizeStoreResult(scanned.value, options)
      stores[name] = compactView(view)
      if (view.unavailable === true) { errors.push(name + ':unavailable'); break }
      if (view.ok !== true) { errors.push(name + ': ' + (view.error || 'error')); break }
      if (view.protectedViolations.length > 0) {
        protectedViolations.push(...view.protectedViolations.map((id) => name + ':' + id))
        errors.push(name + ':protected_violation')
        break
      }
      if (view.boundsViolations.length > 0) {
        boundsViolations.push(...view.boundsViolations.map((v) => name + ':' + v))
        errors.push(name + ':bounds')
        break
      }
      if (options.apply === true && view.changed === true) {
        const backup = view.backupPath !== null ? view.backupPath : options.backupPath
        if (backup === null || fileNonEmpty(backup) !== true) { errors.push(name + ':backup_missing'); break }
        totals.backups[name] = backup
        changedAny = true
      }
      totals.before.items += view.before.items
      totals.before.chars += view.before.chars
      totals.after.items += view.after.items
      totals.after.chars += view.after.chars
      totals.merges += view.merges
      totals.archives += view.archives
      totals.conflicts += view.conflicts
      totals.modelCalls += view.model.calls
      if (totals.route === null && view.model.route !== null) totals.route = view.model.route
      // fresh revision after the pass, so a cleaned store is not considered dirty again
      const post = await attempt(() => ports[name].revision())
      revisions[name] = post.ok === true && typeof post.value === 'string' && post.value.trim() !== '' ? post.value.trim() : null
    }
    if (errors.length > 0) {
      return finish({ ...context, status: 'error', reason: 'store_error', failure: true, lock: lockInfo, stores, dirtyStores, errors, protectedViolations, boundsViolations, before: totals.before, after: totals.after, merges: totals.merges, archives: totals.archives, conflicts: totals.conflicts, modelCalls: totals.modelCalls, route: totals.route, backups: totals.backups })
    }
    const status = changedAny === true ? 'changed' : 'dirty'
    const notice = changedAny === true
      ? { kind: 'changed', message: 'Janitor cleaned ' + totals.merges + ' duplicate(s) and archived ' + totals.archives + ' (' + totals.before.items + ' -> ' + totals.after.items + ' item(s)).' }
      : null
    return finish({ ...context, status, reason: changedAny === true ? 'applied' : 'scanned', success: true, changed: changedAny, notice, lock: lockInfo, stores, dirtyStores, revisions, before: totals.before, after: totals.after, merges: totals.merges, archives: totals.archives, conflicts: totals.conflicts, modelCalls: totals.modelCalls, route: totals.route, backups: totals.backups })
  }

  /** One run. Never throws; returns the report line it wrote (or meant to write). */
  const run = async () => {
    const startedAt = now()
    const runId = 'j' + startedAt.toString(36) + '-' + hex(3)
    const context = { runId, startedAt, apply: false }
    let lockInfo = { pid: process.pid, acquired: false, reclaimed: null, holder: null }
    try {
      context.apply = applyGate(readState(dir), env)
      // the lock is taken synchronously, before the first await: two concurrent run() calls cannot both proceed
      const held = lock.acquire()
      lockInfo = {
        pid: process.pid,
        acquired: held.ok === true,
        reclaimed: held.reclaimed === undefined || held.reclaimed === null ? null : { pid: held.reclaimed.pid === undefined ? null : held.reclaimed.pid, at: held.reclaimed.at === undefined ? null : held.reclaimed.at },
        holder: held.ok === true ? null : (isObject(held.holder) ? { pid: held.holder.pid === undefined ? null : held.holder.pid, at: held.holder.at === undefined ? null : held.holder.at } : null),
      }
      if (held.ok !== true) {
        return finish({ ...context, status: 'skipped', reason: held.error === 'held' ? 'locked' : 'lock_error', lock: lockInfo, stores: {}, dirtyStores: [], errors: held.error === 'held' ? [] : [String(held.error || 'lock_failed')] })
      }
      try {
        return await cycle(context, lockInfo)
      } finally {
        try { lock.release() } catch (e) { /* the stale reclaim releases it next time */ }
      }
    } catch (e) {
      const message = String((e && e.message) || e)
      return finish({ ...context, status: 'error', reason: 'unexpected', failure: true, lock: lockInfo, stores: {}, dirtyStores: [], errors: ['unexpected: ' + message] })
    }
  }

  /** One scheduler look: due? jitter? then run. Never throws. */
  const tick = async () => {
    try {
      const state = readState(dir)
      const when = now()
      const d = due(state, when)
      if (d.due !== true) { jitterAt = null; return { ran: false, why: d.why } }
      if (jitterAt === null) jitterAt = when + Math.floor(Math.max(0, Math.min(1, Number(random()) || 0)) * JANITOR.JITTER_MS)
      if (when < jitterAt) return { ran: false, why: 'jitter', at: jitterAt }
      jitterAt = null
      return await run()
    } catch (e) { return { ran: false, why: 'tick_error' } }
  }

  /** The one host-level scheduler. Returns its stop function (idempotent). */
  const start = () => {
    stopped = false
    const wake = () => { if (stopped !== true) { void tick() } }
    const first = setTimeout(wake, JANITOR.START_GRACE_MS)
    const timer = setInterval(wake, JANITOR.TICK_MS)
    if (typeof first.unref === 'function') first.unref()
    if (typeof timer.unref === 'function') timer.unref()
    say('started (' + dir + '): ' + (applyGate(readState(dir), env) === true ? 'apply mode approved' : 'scan-only until KYBERNOS_JANITOR=apply or state apply:true'))
    return () => { stopped = true; clearTimeout(first); clearInterval(timer) }
  }

  return {
    dir,
    paths,
    reportPath,
    ports,
    bounds,
    run,
    tick,
    start,
    status () {
      const state = readState(dir)
      return { ok: true, dir, paths, reportPath, due: due(state, now()), apply: applyGate(state, env), state }
    },
  }
}

export default createJanitor
