// ── kybernos-workers · runtime router, quota tracker & RunBinding ledger ─────
// Pure, injectable host module for Phase 2 Workers Metaharness:
//   1. Quota & load tracker (per-instance rolling windows, activeRuns, 429 cooldown, cache hit stats).
//      Honest by design: never invents percentages when unavailable (`auth-required` / `local-estimate`).
//   2. Deterministic Smart Router (`selectWorkerInstance`):
//      - Pinned target NEVER silently switches (explicit refusal + suggested alternative).
//      - Auto/pool mode: cache-affinity when warm + headroom > 20%, otherwise least-loaded & highest headroom
//        (fixed subscriptions/local before pay-per-token API keys).
//   3. Cache-friendly context packet (`buildStableContextPacket`) + compact worker handoff (`buildHandoffCapsule`).
//   4. Bounded metadata-only `RunBinding` ledger at `$DSH_HOME/kybernos-workers/runs.json` (mode 0600, max 200).
//      Never stores prompt bodies, raw messages, or secret values.
//
// Zero external imports, English only.

import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { BUILTIN_WORKER } from './harness-store.mjs'

export const RUNS_VERSION = 1
export const MAX_RUNS = 200
export const MAX_WARM_ENTRIES = 128
const MAX_FILES_PER_RUN = 24
const VALID_SOURCES = new Set(['native', 'headers', 'local-estimate', 'auth-required'])
const VALID_BILLING = new Set(['subscription', 'api-key', 'local', 'unknown'])
const VALID_STATUS = new Set(['running', 'ok', 'error', 'rate-limited', 'cancelled'])

const str = (v, max = 160) => (typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : null)
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const clampPct = (v) => {
  const n = num(v)
  return n === null ? null : Math.max(0, Math.min(100, Math.round(n)))
}
const isoOrNull = (v) => {
  if (typeof v !== 'string' || v.trim() === '') return null
  const ms = Date.parse(v)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

export function runsPath (dshHome) {
  return join(dshHome, 'kybernos-workers', 'runs.json')
}

export function emptyRunsStore (now = new Date()) {
  return {
    version: RUNS_VERSION,
    updatedAt: now.toISOString(),
    runs: [],
    quotas: {}
  }
}

function sanitizeWindow (w) {
  if (w === null || typeof w !== 'object') return null
  const key = str(w.key ?? w.id, 40)
  if (key === null) return null
  const label = str(w.label, 80) ?? key
  const source = VALID_SOURCES.has(w.source) ? w.source : 'local-estimate'
  let remainingPct = clampPct(w.remainingPct)
  let usedPct = clampPct(w.usedPct)
  if (remainingPct === null && usedPct !== null) remainingPct = 100 - usedPct
  if (usedPct === null && remainingPct !== null) usedPct = 100 - remainingPct
  if (source === 'auth-required') { remainingPct = null; usedPct = null }
  return {
    key,
    label,
    remainingPct,
    usedPct,
    resetAt: isoOrNull(w.resetAt),
    source
  }
}

export function sanitizeQuotaEntry (workerId, raw, now = new Date()) {
  const id = str(workerId, 64)
  if (id === null) return null
  const r = raw !== null && typeof raw === 'object' ? raw : {}
  const windows = Array.isArray(r.windows) ? r.windows.map(sanitizeWindow).filter((x) => x !== null).slice(0, 8) : []
  const maxParallel = Math.max(1, Math.min(32, Math.floor(num(r.maxParallel) ?? 2)))
  const activeRuns = Math.max(0, Math.min(64, Math.floor(num(r.activeRuns) ?? 0)))
  const billingMode = VALID_BILLING.has(r.billingMode) ? r.billingMode : 'unknown'
  const inputTokens = Math.max(0, Math.floor(num(r.cacheStats?.inputTokens) ?? 0))
  const cacheReadTokens = Math.max(0, Math.floor(num(r.cacheStats?.cacheReadTokens) ?? 0))
  const cacheHitPct = inputTokens > 0 ? Math.min(100, Math.round((cacheReadTokens / inputTokens) * 100)) : null
  return {
    workerId: id,
    driverId: str(r.driverId, 64) ?? id,
    label: str(r.label, 80) ?? id,
    billingMode,
    windows,
    authRequired: r.authRequired === true || windows.some((w) => w.source === 'auth-required'),
    authMessage: str(r.authMessage, 180),
    activeRuns,
    maxParallel,
    cooldownUntil: isoOrNull(r.cooldownUntil),
    cacheStats: { inputTokens, cacheReadTokens, cacheHitPct },
    updatedAt: isoOrNull(r.updatedAt) ?? now.toISOString()
  }
}

export function sanitizeRunBinding (raw, now = new Date()) {
  if (raw === null || typeof raw !== 'object') return null
  const runId = str(raw.runId, 80)
  const workerId = str(raw.workerId, 64)
  if (runId === null || workerId === null) return null
  const inputTokens = Math.max(0, Math.floor(num(raw.inputTokens) ?? 0))
  const cacheReadTokens = Math.max(0, Math.floor(num(raw.cacheReadTokens) ?? 0))
  const outputTokens = Math.max(0, Math.floor(num(raw.outputTokens) ?? 0))
  const computedHit = inputTokens > 0 ? Math.min(100, Math.round((cacheReadTokens / inputTokens) * 100)) : null
  const cacheHitPct = clampPct(raw.cacheHitPct) ?? computedHit
  const files = Array.isArray(raw.files)
    ? raw.files.filter((f) => typeof f === 'string' && f.trim() !== '').map((f) => f.trim().slice(0, 180)).slice(0, MAX_FILES_PER_RUN)
    : []
  const startedAt = isoOrNull(raw.startedAt) ?? now.toISOString()
  const endedAt = isoOrNull(raw.endedAt)
  let durMs = num(raw.durMs)
  if (durMs === null && endedAt !== null) durMs = Math.max(0, Date.parse(endedAt) - Date.parse(startedAt))
  return {
    runId,
    sessionId: str(raw.sessionId, 120),
    workerId,
    kind: raw.kind === 'internal' || workerId === BUILTIN_WORKER.id ? 'internal' : 'external',
    driverId: str(raw.driverId, 64) ?? workerId,
    label: str(raw.label, 80),
    modelId: str(raw.modelId, 120),
    reason: str(raw.reason, 64) ?? 'pinned',
    contextPrefixHash: str(raw.contextPrefixHash, 64),
    startedAt,
    endedAt,
    durMs: durMs !== null ? Math.max(0, Math.round(durMs)) : null,
    inputTokens,
    cacheReadTokens,
    outputTokens,
    cacheHitPct,
    status: VALID_STATUS.has(raw.status) ? raw.status : 'running',
    files
  }
}

export function readRunsFile (filePath, now = new Date()) {
  if (!existsSync(filePath)) return { ok: true, store: emptyRunsStore(now), exists: false }
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'))
    const runs = Array.isArray(parsed?.runs)
      ? parsed.runs.map((r) => sanitizeRunBinding(r, now)).filter((x) => x !== null).slice(-MAX_RUNS)
      : []
    const quotas = {}
    if (parsed?.quotas !== null && typeof parsed?.quotas === 'object' && !Array.isArray(parsed.quotas)) {
      for (const [k, v] of Object.entries(parsed.quotas)) {
        const clean = sanitizeQuotaEntry(k, v, now)
        if (clean !== null) quotas[clean.workerId] = clean
      }
    }
    return {
      ok: true,
      exists: true,
      store: {
        version: RUNS_VERSION,
        updatedAt: isoOrNull(parsed?.updatedAt) ?? now.toISOString(),
        runs,
        quotas
      }
    }
  } catch (e) {
    return { ok: false, error: 'corrupt-runs-store', detail: String(e?.message ?? e), store: emptyRunsStore(now), exists: true }
  }
}

export function writeRunsFile (filePath, store, now = new Date()) {
  const dir = dirname(filePath)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const payload = {
    version: RUNS_VERSION,
    updatedAt: now.toISOString(),
    runs: (Array.isArray(store?.runs) ? store.runs : []).slice(-MAX_RUNS),
    quotas: store?.quotas && typeof store.quotas === 'object' ? store.quotas : {}
  }
  const tmp = filePath + '.tmp-' + process.pid + '-' + Math.random().toString(16).slice(2, 8)
  writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
  try { chmodSync(tmp, 0o600) } catch { /* best effort */ }
  renameSync(tmp, filePath)
  try { chmodSync(filePath, 0o600) } catch { /* best effort */ }
  return payload
}

// ── Quota, Load & Warm-Cache State ──────────────────────────────────────────

export function createRuntimeState (initialStore = null) {
  const quotas = new Map()
  if (initialStore?.quotas && typeof initialStore.quotas === 'object') {
    for (const [k, v] of Object.entries(initialStore.quotas)) {
      const clean = sanitizeQuotaEntry(k, v)
      if (clean !== null) quotas.set(clean.workerId, clean)
    }
  }
  const runs = Array.isArray(initialStore?.runs) ? initialStore.runs.slice(-MAX_RUNS) : []
  const warmCache = new Map() // `${sessionId}::${workKey}` -> { workerId, contextPrefixHash, updatedAt, hits }
  return { quotas, runs, warmCache }
}

export function exportRuntimeStore (state, now = new Date()) {
  const quotas = {}
  for (const [k, v] of state.quotas.entries()) quotas[k] = v
  return {
    version: RUNS_VERSION,
    updatedAt: now.toISOString(),
    runs: state.runs.slice(-MAX_RUNS),
    quotas
  }
}

export function computeHeadroom (quotaEntry) {
  if (!quotaEntry || !Array.isArray(quotaEntry.windows) || quotaEntry.windows.length === 0) return null
  const vals = quotaEntry.windows
    .filter((w) => w.source !== 'auth-required' && typeof w.remainingPct === 'number')
    .map((w) => w.remainingPct)
  if (vals.length === 0) return null
  return Math.min(...vals)
}

export function isCoolingDown (quotaEntry, now = new Date()) {
  if (!quotaEntry?.cooldownUntil) return false
  const until = Date.parse(quotaEntry.cooldownUntil)
  return Number.isFinite(until) && until > now.getTime()
}

export function recordQuotaUpdate (state, workerId, patch, now = new Date()) {
  const id = str(workerId, 64)
  if (id === null) return { ok: false, error: 'invalid-worker-id' }
  const prev = state.quotas.get(id) ?? sanitizeQuotaEntry(id, {}, now)
  const merged = sanitizeQuotaEntry(id, { ...prev, ...patch, updatedAt: now.toISOString() }, now)
  state.quotas.set(id, merged)
  return { ok: true, quota: merged }
}

export function recordRateLimit (state, { workerId, cooldownSeconds = 120, windowKey = 'session', resetAt = null } = {}, now = new Date()) {
  const id = str(workerId, 64)
  if (id === null) return { ok: false, error: 'invalid-worker-id' }
  const prev = state.quotas.get(id) ?? sanitizeQuotaEntry(id, {}, now)
  const secs = Math.max(10, Math.min(86400, Math.floor(num(cooldownSeconds) ?? 120)))
  const untilIso = isoOrNull(resetAt) ?? new Date(now.getTime() + secs * 1000).toISOString()
  const windows = prev.windows.slice()
  const idx = windows.findIndex((w) => w.key === windowKey)
  const updatedWin = { key: windowKey, label: idx >= 0 ? windows[idx].label : windowKey, remainingPct: 0, usedPct: 100, resetAt: untilIso, source: 'headers' }
  if (idx >= 0) windows[idx] = updatedWin
  else windows.push(updatedWin)
  const next = sanitizeQuotaEntry(id, { ...prev, windows, cooldownUntil: untilIso, updatedAt: now.toISOString() }, now)
  state.quotas.set(id, next)
  return { ok: true, quota: next }
}

function touchWarmCache (state, sessionId, workKey, workerId, contextPrefixHash, now) {
  if (!sessionId || !workKey || !workerId) return
  const key = sessionId + '::' + workKey
  const prev = state.warmCache.get(key)
  const same = prev && prev.workerId === workerId && (!contextPrefixHash || prev.contextPrefixHash === contextPrefixHash)
  state.warmCache.set(key, {
    workerId,
    contextPrefixHash: contextPrefixHash ?? prev?.contextPrefixHash ?? null,
    updatedAt: now.toISOString(),
    hits: same ? prev.hits + 1 : 0
  })
  if (state.warmCache.size > MAX_WARM_ENTRIES) {
    const oldest = state.warmCache.keys().next().value
    if (oldest !== undefined) state.warmCache.delete(oldest)
  }
}

export function recordRunStart (state, input, now = new Date()) {
  const binding = sanitizeRunBinding({
    ...input,
    runId: str(input?.runId, 80) ?? ('run-' + now.getTime().toString(36) + '-' + Math.random().toString(36).slice(2, 6)),
    status: 'running',
    startedAt: isoOrNull(input?.startedAt) ?? now.toISOString(),
    endedAt: null
  }, now)
  if (binding === null) return { ok: false, error: 'invalid-run' }
  state.runs.push(binding)
  if (state.runs.length > MAX_RUNS) state.runs.splice(0, state.runs.length - MAX_RUNS)
  const prev = state.quotas.get(binding.workerId) ?? sanitizeQuotaEntry(binding.workerId, { driverId: binding.driverId, label: binding.label ?? binding.workerId }, now)
  const next = sanitizeQuotaEntry(binding.workerId, { ...prev, activeRuns: prev.activeRuns + 1, updatedAt: now.toISOString() }, now)
  state.quotas.set(binding.workerId, next)
  if (binding.sessionId && input?.workKey) {
    touchWarmCache(state, binding.sessionId, str(input.workKey, 80), binding.workerId, binding.contextPrefixHash, now)
  }
  return { ok: true, run: binding, quota: next }
}

export function recordRunFinish (state, input, now = new Date()) {
  const runId = str(input?.runId, 80)
  if (runId === null) return { ok: false, error: 'invalid-run-id' }
  const idx = state.runs.findIndex((r) => r.runId === runId)
  if (idx < 0) return { ok: false, error: 'unknown-run' }
  const cur = state.runs[idx]
  const endedAt = isoOrNull(input?.endedAt) ?? now.toISOString()
  const updated = sanitizeRunBinding({
    ...cur,
    status: VALID_STATUS.has(input?.status) ? input.status : 'ok',
    endedAt,
    durMs: num(input?.durMs) ?? Math.max(0, Date.parse(endedAt) - Date.parse(cur.startedAt)),
    inputTokens: num(input?.inputTokens) ?? cur.inputTokens,
    cacheReadTokens: num(input?.cacheReadTokens) ?? cur.cacheReadTokens,
    outputTokens: num(input?.outputTokens) ?? cur.outputTokens,
    files: Array.isArray(input?.files) ? input.files : cur.files
  }, now)
  state.runs[idx] = updated
  const prev = state.quotas.get(updated.workerId)
  if (prev) {
    const nextIn = prev.cacheStats.inputTokens + updated.inputTokens
    const nextCr = prev.cacheStats.cacheReadTokens + updated.cacheReadTokens
    const nextQ = sanitizeQuotaEntry(updated.workerId, {
      ...prev,
      activeRuns: Math.max(0, prev.activeRuns - (cur.status === 'running' ? 1 : 0)),
      cacheStats: { inputTokens: nextIn, cacheReadTokens: nextCr },
      updatedAt: now.toISOString()
    }, now)
    state.quotas.set(updated.workerId, nextQ)
  }
  if (updated.status === 'rate-limited') {
    recordRateLimit(state, { workerId: updated.workerId, cooldownSeconds: input?.cooldownSeconds ?? 120 }, now)
  }
  return { ok: true, run: updated }
}

// ── Deterministic Smart Router ──────────────────────────────────────────────

function buildCandidateList (harness, roleId, includeBuiltin) {
  const instances = Array.isArray(harness?.instances) ? harness.instances : []
  const list = []
  if (includeBuiltin) {
    list.push({ id: BUILTIN_WORKER.id, driverId: BUILTIN_WORKER.driverId, label: BUILTIN_WORKER.label, kind: 'internal', enabled: true })
  }
  for (const inst of instances) {
    list.push({ id: inst.id, driverId: inst.driverId, label: inst.label, kind: 'external', enabled: inst.enabled !== false && inst.active !== false })
  }
  if (roleId && harness?.roleEngines && harness.roleEngines[roleId]) {
    const eng = harness.roleEngines[roleId]
    if (eng.workerId && eng.workerId !== BUILTIN_WORKER.id) {
      const allowedIds = new Set([eng.workerId, ...(Array.isArray(eng.delegateWorkers) ? eng.delegateWorkers : [])])
      if (includeBuiltin && eng.fallbackModel) allowedIds.add(BUILTIN_WORKER.id)
      return list.filter((c) => allowedIds.has(c.id))
    }
    if (Array.isArray(eng.delegateWorkers) && eng.delegateWorkers.length > 0) {
      const allowedIds = new Set([...(includeBuiltin ? [BUILTIN_WORKER.id] : []), ...eng.delegateWorkers])
      return list.filter((c) => allowedIds.has(c.id))
    }
  }
  return list
}

function evaluateCandidate (cand, state, policy, minHeadroomPct, now) {
  if (!cand.enabled) return { eligible: false, blockReason: 'disabled' }
  if (policy && Array.isArray(policy.deniedDrivers) && policy.deniedDrivers.includes(cand.driverId)) {
    return { eligible: false, blockReason: 'policy-denied' }
  }
  if (policy && Array.isArray(policy.allowedWorkers) && policy.allowedWorkers.length > 0 && !policy.allowedWorkers.includes(cand.id) && !policy.allowedWorkers.includes(cand.driverId)) {
    return { eligible: false, blockReason: 'policy-denied' }
  }
  const q = state.quotas.get(cand.id) ?? sanitizeQuotaEntry(cand.id, { driverId: cand.driverId, label: cand.label }, now)
  if (q.authRequired) return { eligible: false, blockReason: 'auth-required', quota: q }
  if (isCoolingDown(q, now)) return { eligible: false, blockReason: 'cooldown', quota: q }
  const headroom = computeHeadroom(q)
  if (headroom !== null && headroom <= minHeadroomPct) return { eligible: false, blockReason: 'quota-exhausted', quota: q, headroom }
  if (q.activeRuns >= q.maxParallel) return { eligible: false, blockReason: 'at-capacity', quota: q, headroom }
  return { eligible: true, quota: q, headroom, loadRatio: q.activeRuns / Math.max(1, q.maxParallel) }
}

const BILLING_RANK = { subscription: 0, local: 1, unknown: 2, 'api-key': 3 }

function rankEligible (evaluated, warmWorkerId, warmMinHeadroom) {
  return evaluated.slice().sort((a, b) => {
    const aWarm = a.cand.id === warmWorkerId && (a.headroom === null || a.headroom > warmMinHeadroom)
    const bWarm = b.cand.id === warmWorkerId && (b.headroom === null || b.headroom > warmMinHeadroom)
    if (aWarm !== bWarm) return aWarm ? -1 : 1
    if (a.loadRatio !== b.loadRatio) return a.loadRatio - b.loadRatio
    const aHead = a.headroom === null ? 50 : a.headroom
    const bHead = b.headroom === null ? 50 : b.headroom
    if (aHead !== bHead) return bHead - aHead
    const aBill = BILLING_RANK[a.quota.billingMode] ?? 2
    const bBill = BILLING_RANK[b.quota.billingMode] ?? 2
    if (aBill !== bBill) return aBill - bBill
    return a.cand.id.localeCompare(b.cand.id)
  })
}

export function selectWorkerInstance ({
  harness = null,
  runtime = createRuntimeState(),
  requestedWorkerId = 'auto',
  roleId = null,
  sessionId = null,
  workKey = null,
  policy = null,
  includeBuiltin = true,
  minHeadroomPct = 5,
  warmMinHeadroom = 20,
  now = new Date()
} = {}) {
  const candidates = buildCandidateList(harness, roleId, includeBuiltin)
  const evaluated = candidates.map((cand) => ({ cand, ...evaluateCandidate(cand, runtime, policy, minHeadroomPct, now) }))
  const eligible = evaluated.filter((e) => e.eligible)

  const warmKey = sessionId && workKey ? sessionId + '::' + workKey : null
  const warmEntry = warmKey ? runtime.warmCache.get(warmKey) ?? null : null
  const warmWorkerId = warmEntry ? warmEntry.workerId : null
  const ranked = rankEligible(eligible, warmWorkerId, warmMinHeadroom)

  const req = str(requestedWorkerId, 64)
  // Pinned worker mode: NEVER silently switch away from the user's explicit choice.
  if (req !== null && req !== 'auto') {
    const exact = evaluated.find((e) => e.cand.id === req)
    if (!exact) {
      return {
        ok: false,
        error: 'unknown-worker',
        pinnedWorkerId: req,
        suggestedAlternative: ranked[0]?.cand.id ?? null
      }
    }
    if (!exact.eligible) {
      return {
        ok: false,
        error: exact.blockReason,
        pinnedWorkerId: req,
        cooldownUntil: exact.quota?.cooldownUntil ?? null,
        suggestedAlternative: ranked[0]?.cand.id ?? null
      }
    }
    return {
      ok: true,
      selectedId: exact.cand.id,
      driverId: exact.cand.driverId,
      kind: exact.cand.kind,
      reason: 'pinned',
      headroomPct: exact.headroom,
      activeRuns: exact.quota.activeRuns,
      alternatives: ranked.filter((r) => r.cand.id !== exact.cand.id).map((r) => r.cand.id)
    }
  }

  // Auto / pool mode
  if (ranked.length === 0) {
    return {
      ok: false,
      error: 'no-eligible-worker',
      blocked: evaluated.map((e) => ({ workerId: e.cand.id, reason: e.blockReason }))
    }
  }
  const best = ranked[0]
  let reason = 'highest-headroom'
  if (warmWorkerId && best.cand.id === warmWorkerId && (best.headroom === null || best.headroom > warmMinHeadroom)) {
    reason = 'cache-affinity'
  } else if (ranked.some((r) => r.loadRatio > best.loadRatio && (r.headroom ?? 50) >= (best.headroom ?? 50))) {
    reason = 'least-loaded'
  }
  return {
    ok: true,
    selectedId: best.cand.id,
    driverId: best.cand.driverId,
    kind: best.cand.kind,
    reason,
    headroomPct: best.headroom,
    activeRuns: best.quota.activeRuns,
    alternatives: ranked.slice(1).map((r) => r.cand.id)
  }
}

// ── Cache-Friendly Stable Prefix & Handoff Capsule ──────────────────────────

const normText = (s) => String(s ?? '').replace(/\r\n/g, '\n').trim()

/**
 * Builds a canonical prompt packet whose static prefix is byte-identical across turns
 * (sorted keys/entries, stable separators) so worker prompt caches stay hot, while
 * placing the volatile `taskDelta` strictly at the tail.
 */
export function buildStableContextPacket ({ repoRules = '', architecture = '', conventions = '', pinnedFiles = [], taskDelta = '' } = {}) {
  const sections = [
    ['ARCHITECTURE', normText(architecture)],
    ['CONVENTIONS', normText(conventions)],
    ['REPO_RULES', normText(repoRules)]
  ].filter(([, body]) => body !== '')

  const files = Array.isArray(pinnedFiles)
    ? pinnedFiles
      .filter((f) => f !== null && typeof f === 'object' && typeof f.path === 'string')
      .map((f) => ({ path: f.path.trim(), summary: normText(f.summary ?? '') }))
      .filter((f) => f.path !== '')
      .sort((a, b) => a.path.localeCompare(b.path))
    : []

  const prefixParts = sections.map(([title, body]) => `## ${title}\n${body}`)
  if (files.length > 0) {
    prefixParts.push('## PINNED_FILES\n' + files.map((f) => `- ${f.path}${f.summary ? ': ' + f.summary : ''}`).join('\n'))
  }
  const staticPrefix = prefixParts.join('\n\n')
  const prefixHash = createHash('sha256').update(staticPrefix, 'utf8').digest('hex').slice(0, 16)
  const delta = normText(taskDelta)
  const fullPacket = staticPrefix && delta ? `${staticPrefix}\n\n## TASK_DELTA\n${delta}` : (staticPrefix || delta)
  return { staticPrefix, taskDelta: delta, prefixHash, fullPacket }
}

/**
 * Compact, structured handoff capsule when switching from one worker instance to another.
 * Never carries raw transcripts or secret values.
 */
export function buildHandoffCapsule ({
  fromWorkerId = null,
  toWorkerId = null,
  goal = '',
  completedSteps = [],
  modifiedFiles = [],
  openQuestions = [],
  nextStep = ''
} = {}) {
  const cleanList = (arr, limit, maxLen) => (Array.isArray(arr) ? arr.filter((x) => typeof x === 'string' && x.trim() !== '').map((x) => x.trim().slice(0, maxLen)).slice(0, limit) : [])
  const capsule = {
    version: 1,
    fromWorkerId: str(fromWorkerId, 64),
    toWorkerId: str(toWorkerId, 64),
    goal: normText(goal).slice(0, 280),
    completedSteps: cleanList(completedSteps, 12, 160),
    modifiedFiles: cleanList(modifiedFiles, 24, 180).sort(),
    openQuestions: cleanList(openQuestions, 6, 180),
    nextStep: normText(nextStep).slice(0, 280)
  }
  const lines = [
    `[HANDOFF ${capsule.fromWorkerId ?? 'orchestrator'} -> ${capsule.toWorkerId ?? 'worker'}]`,
    capsule.goal ? `Goal: ${capsule.goal}` : '',
    capsule.completedSteps.length > 0 ? 'Completed:\n' + capsule.completedSteps.map((s) => `- ${s}`).join('\n') : '',
    capsule.modifiedFiles.length > 0 ? 'Modified files: ' + capsule.modifiedFiles.join(', ') : '',
    capsule.openQuestions.length > 0 ? 'Open questions:\n' + capsule.openQuestions.map((q) => `- ${q}`).join('\n') : '',
    capsule.nextStep ? `Next step: ${capsule.nextStep}` : ''
  ].filter((l) => l !== '')
  return { capsule, text: lines.join('\n') }
}

// ── Snapshot for GET /kybernos-workers/runtime ──────────────────────────────

export function runtimeSnapshot (state, { harness = null, sessionId = null, now = new Date() } = {}) {
  const instances = Array.isArray(harness?.instances) ? harness.instances : []
  const byId = new Map()
  for (const [k, v] of state.quotas.entries()) byId.set(k, v)
  for (const inst of instances) {
    if (!byId.has(inst.id)) {
      byId.set(inst.id, sanitizeQuotaEntry(inst.id, { driverId: inst.driverId, label: inst.label }, now))
    } else {
      const cur = byId.get(inst.id)
      byId.set(inst.id, { ...cur, driverId: inst.driverId, label: inst.label })
    }
  }
  const quotas = Array.from(byId.values()).map((q) => ({
    ...q,
    headroomPct: computeHeadroom(q),
    coolingDown: isCoolingDown(q, now)
  }))
  const sid = str(sessionId, 120)
  const runs = sid ? state.runs.filter((r) => r.sessionId === sid) : state.runs.slice(-50)
  const activeRuns = runs.filter((r) => r.status === 'running')
  return {
    ok: true,
    quotas,
    runs,
    activeRuns,
    summary: {
      totalRuns: runs.length,
      activeCount: activeRuns.length,
      trackedWorkers: quotas.length
    }
  }
}
