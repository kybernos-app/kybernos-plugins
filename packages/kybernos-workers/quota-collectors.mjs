// ── kybernos-workers · native quota collectors & rate-limit header parser ────
// Zero-cost, honest quota telemetry for external workers:
//   - Never invokes paid LLM calls.
//   - Never invents quota percentages when a CLI/provider does not expose them
//     (`authRequired: true` when unsigned; preserves live `headers`/`native` windows).
//   - Parses standard OpenAI, Anthropic unified (5h / 7d), Google, and DashScope
//     rate-limit HTTP response headers into rolling quota windows.
//
// All I/O is injectable so test-quota-collectors.mjs runs without DSH or network.
// English only (enforced by scripts/test-no-french-literals.mjs).

import { recordQuotaUpdate } from './runtime-router.mjs'

const num = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}
const clampPct = (v) => Math.max(0, Math.min(100, Math.round(v)))

/**
 * Parses a reset header value into an ISO timestamp (or null).
 * Supports Go durations (`2h36m`, `1m30s`, `45s`, `500ms`), relative seconds,
 * Unix epoch seconds, ISO-8601 strings, and HTTP dates.
 */
export function parseResetTime (raw, now = new Date()) {
  if (raw === null || raw === undefined) return null
  const s = String(raw).trim()
  if (s === '') return null

  // Pure numeric: Unix epoch seconds (>= 1e9) or relative seconds
  if (/^\d+(?:\.\d+)?$/.test(s)) {
    const v = Number(s)
    if (!Number.isFinite(v)) return null
    if (v >= 1e9) return new Date(Math.round(v * 1000)).toISOString()
    return new Date(now.getTime() + Math.round(v * 1000)).toISOString()
  }

  // Go-style duration e.g. "2h36m10s", "45s", "500ms", "1d4h"
  if (/^(?:\d+(?:\.\d+)?(?:d|h|m|s|ms))+$/i.test(s)) {
    let totalMs = 0
    const re = /(\d+(?:\.\d+)?)(ms|d|h|m|s)/gi
    let m
    while ((m = re.exec(s)) !== null) {
      const val = Number(m[1])
      const unit = m[2].toLowerCase()
      if (unit === 'ms') totalMs += val
      else if (unit === 's') totalMs += val * 1000
      else if (unit === 'm') totalMs += val * 60_000
      else if (unit === 'h') totalMs += val * 3_600_000
      else if (unit === 'd') totalMs += val * 86_400_000
    }
    return totalMs > 0 ? new Date(now.getTime() + Math.round(totalMs)).toISOString() : null
  }

  const parsed = Date.parse(s)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

/**
 * Parses provider HTTP response headers into honest rolling quota windows (`source: 'headers'`)
 * plus an optional `cooldownUntil` timestamp from `retry-after`.
 */
export function parseRateLimitHeaders (headers, now = new Date()) {
  const map = new Map()
  if (headers !== null && typeof headers === 'object') {
    for (const [k, v] of Object.entries(headers)) {
      if (typeof k === 'string' && v !== undefined && v !== null) {
        map.set(k.toLowerCase().trim(), String(v))
      }
    }
  }
  const get = (k) => map.get(k) ?? null
  const windows = []

  // Anthropic unified subscription windows (utilization is 0..1 float or 0..100%)
  const parseUtil = (raw) => {
    const v = num(raw)
    if (v === null) return null
    const pct = v <= 1 ? v * 100 : v
    return clampPct(pct)
  }
  const u5h = parseUtil(get('anthropic-ratelimit-unified-5h-utilization'))
  if (u5h !== null) {
    windows.push({
      key: '5h',
      label: '5-hour',
      usedPct: u5h,
      remainingPct: 100 - u5h,
      resetAt: parseResetTime(get('anthropic-ratelimit-unified-5h-reset'), now),
      source: 'headers'
    })
  }
  const u7d = parseUtil(get('anthropic-ratelimit-unified-7d-utilization'))
  if (u7d !== null) {
    windows.push({
      key: 'weekly',
      label: 'Weekly',
      usedPct: u7d,
      remainingPct: 100 - u7d,
      resetAt: parseResetTime(get('anthropic-ratelimit-unified-7d-reset'), now),
      source: 'headers'
    })
  }

  // Standard x-ratelimit-*-requests / x-ratelimit-*-tokens (OpenAI, Anthropic API, DashScope)
  const limReq = num(get('x-ratelimit-limit-requests') ?? get('anthropic-ratelimit-requests-limit'))
  const remReq = num(get('x-ratelimit-remaining-requests') ?? get('anthropic-ratelimit-requests-remaining'))
  if (limReq !== null && limReq > 0 && remReq !== null) {
    const remainingPct = clampPct((remReq / limReq) * 100)
    windows.push({
      key: 'requests',
      label: 'Requests',
      remainingPct,
      usedPct: 100 - remainingPct,
      resetAt: parseResetTime(get('x-ratelimit-reset-requests') ?? get('anthropic-ratelimit-requests-reset'), now),
      source: 'headers'
    })
  }

  const limTok = num(get('x-ratelimit-limit-tokens') ?? get('anthropic-ratelimit-tokens-limit'))
  const remTok = num(get('x-ratelimit-remaining-tokens') ?? get('anthropic-ratelimit-tokens-remaining'))
  if (limTok !== null && limTok > 0 && remTok !== null) {
    const remainingPct = clampPct((remTok / limTok) * 100)
    windows.push({
      key: 'tokens',
      label: 'Tokens',
      remainingPct,
      usedPct: 100 - remainingPct,
      resetAt: parseResetTime(get('x-ratelimit-reset-tokens') ?? get('anthropic-ratelimit-tokens-reset'), now),
      source: 'headers'
    })
  }

  const retryAfter = parseResetTime(get('retry-after'), now)
  return { windows, cooldownUntil: retryAfter }
}

/**
 * Extracts explicit quota percentage lines if a CLI natively prints them (e.g. "Weekly: 58% left").
 * Never guesses: only matches lines with an explicit percentage and window keyword.
 */
export function parseNativePercentLines (text) {
  if (typeof text !== 'string' || text.trim() === '') return []
  const out = []
  const seen = new Set()
  const lines = text.split(/\r?\n/)
  const patterns = [
    { key: '5h', label: '5-hour', re: /\b(?:5[- ]?h(?:our)?|five[- ]?hour)\b[^%\n]{0,40}?(\d{1,3})\s*%/i },
    { key: 'session', label: 'Session', re: /\bsession\b[^%\n]{0,40}?(\d{1,3})\s*%/i },
    { key: 'weekly', label: 'Weekly', re: /\b(?:week(?:ly)?|7[- ]?d(?:ay)?)\b[^%\n]{0,40}?(\d{1,3})\s*%/i },
    { key: 'monthly', label: 'Monthly', re: /\bmonth(?:ly)?\b[^%\n]{0,40}?(\d{1,3})\s*%/i }
  ]
  for (const line of lines) {
    for (const pat of patterns) {
      if (seen.has(pat.key)) continue
      const m = pat.re.exec(line)
      if (!m) continue
      const pct = clampPct(Number(m[1]))
      const isUsed = /\b(?:used|spent|consumed)\b/i.test(line)
      const remainingPct = isUsed ? 100 - pct : pct
      seen.add(pat.key)
      out.push({ key: pat.key, label: pat.label, remainingPct, usedPct: 100 - remainingPct, resetAt: null, source: 'native' })
    }
  }
  return out
}

const KEY_ENVS = Object.freeze({
  gemini: Object.freeze(['GEMINI_API_KEY', 'GOOGLE_API_KEY']),
  qwen: Object.freeze(['QWEN_TOKEN_PLAN_API_KEY', 'DASHSCOPE_API_KEY'])
})

/**
 * Collects zero-cost local auth, billing mode, and native quota metadata for one worker instance.
 */
export async function collectQuotaForInstance (instance, { io = {}, now = new Date() } = {}) {
  const driverId = String(instance?.driverId ?? instance?.id ?? '').trim()
  const workerId = String(instance?.id ?? driverId).trim()
  const label = String(instance?.label ?? workerId).trim()
  const executer = typeof io.executer === 'function' ? io.executer : null
  const cleDansEnv = typeof io.cleDansEnv === 'function' ? io.cleDansEnv : null

  if (driverId === 'zcode') {
    return { workerId, driverId, label, billingMode: 'local', authRequired: false, authMessage: null, windows: [] }
  }

  if (driverId === 'gemini' || driverId === 'qwen') {
    const names = KEY_ENVS[driverId]
    let hasKey = false
    if (cleDansEnv !== null) {
      try { hasKey = (await cleDansEnv(names)) === true } catch { hasKey = false }
    }
    return {
      workerId,
      driverId,
      label,
      billingMode: 'api-key',
      authRequired: !hasKey,
      authMessage: hasKey ? null : `Configure ${names[0]} to track ${label} usage.`,
      windows: []
    }
  }

  if (driverId === 'codex') {
    if (executer === null) return { workerId, driverId, label, billingMode: 'unknown', authRequired: false, authMessage: null, windows: [] }
    const bin = instance?.binaryPath || 'codex'
    const opts = { delaiMs: 12000 }
    if (typeof instance?.shadowHomePath === 'string' && instance.shadowHomePath.trim() !== '') {
      opts.extraEnv = { CODEX_HOME: instance.shadowHomePath.trim() }
    }
    const r = await executer(bin, ['login', 'status'], opts)
    const text = String(r?.sortie ?? '')
    const loggedIn = r?.code === 0 && !/not logged in|unauthenticated/i.test(text)
    if (!loggedIn) {
      return { workerId, driverId, label, billingMode: 'subscription', authRequired: true, authMessage: `${label}: sign in with Codex CLI to see limits.`, windows: [] }
    }
    const billingMode = /api[ _-]?key/i.test(text) ? 'api-key' : 'subscription'
    return { workerId, driverId, label, billingMode, authRequired: false, authMessage: null, windows: parseNativePercentLines(text) }
  }

  if (driverId === 'claude-code') {
    if (executer === null) return { workerId, driverId, label, billingMode: 'unknown', authRequired: false, authMessage: null, windows: [] }
    const bin = instance?.binaryPath || 'claude'
    const r = await executer(bin, ['auth', 'status'], { delaiMs: 12000 })
    const text = String(r?.sortie ?? '')
    let parsed = null
    try { parsed = JSON.parse(text) } catch { parsed = null }
    const loggedIn = parsed !== null ? parsed.loggedIn === true : (r?.code === 0 && /logged.?in/i.test(text) && !/not logged/i.test(text))
    if (!loggedIn) {
      return { workerId, driverId, label, billingMode: 'subscription', authRequired: true, authMessage: `${label}: sign in with Claude Code to see limits.`, windows: [] }
    }
    const method = String(parsed?.authMethod ?? '')
    const billingMode = /api|key/i.test(method) ? 'api-key' : 'subscription'
    return { workerId, driverId, label, billingMode, authRequired: false, authMessage: null, windows: parseNativePercentLines(text) }
  }

  if (driverId === 'antigravity') {
    if (executer === null) return { workerId, driverId, label, billingMode: 'subscription', authRequired: true, authMessage: `${label}: Sign in with Google to see Antigravity limits.`, windows: [] }
    const bin = instance?.binaryPath || 'agy'
    const r = await executer(bin, ['models'], { delaiMs: 25000 })
    const text = String(r?.sortie ?? '')
    const ok = r?.code === 0 && !/sign in|not authenticated|login required|unauthorized/i.test(text)
    if (!ok) {
      return { workerId, driverId, label, billingMode: 'subscription', authRequired: true, authMessage: `${label}: Sign in with Google to see Antigravity limits.`, windows: [] }
    }
    return { workerId, driverId, label, billingMode: 'subscription', authRequired: false, authMessage: null, windows: parseNativePercentLines(text) }
  }

  if (driverId === 'opencode') {
    if (executer === null) return { workerId, driverId, label, billingMode: 'unknown', authRequired: false, authMessage: null, windows: [] }
    const bin = instance?.binaryPath || 'opencode'
    const r = await executer(bin, ['auth', 'list'], { delaiMs: 12000 })
    const m = /(\d+)\s+credential/i.exec(String(r?.sortie ?? ''))
    const count = m ? Number(m[1]) : 0
    return {
      workerId,
      driverId,
      label,
      billingMode: 'unknown',
      authRequired: !(r?.code === 0 && count > 0),
      authMessage: (r?.code === 0 && count > 0) ? null : `${label}: run "opencode auth login" to sign in.`,
      windows: []
    }
  }

  if (driverId === 'hermes') {
    if (executer === null) return { workerId, driverId, label, billingMode: 'unknown', authRequired: false, authMessage: null, windows: [] }
    const bin = instance?.binaryPath || 'hermes'
    const r = await executer(bin, ['status'], { delaiMs: 20000 })
    const text = String(r?.sortie ?? '')
    const ok = r?.code === 0 && /provider|authenticated|logged in|ready/i.test(text) && !/not configured|no credentials/i.test(text)
    return {
      workerId,
      driverId,
      label,
      billingMode: 'unknown',
      authRequired: !ok,
      authMessage: ok ? null : `${label}: run "hermes model" to sign in.`,
      windows: parseNativePercentLines(text)
    }
  }

  return { workerId, driverId, label, billingMode: 'unknown', authRequired: false, authMessage: null, windows: [] }
}

/**
 * Probes configured harness instances (or a single `workerId`) and merges the results
 * into `runtime` without clobbering fresher `headers`/`native` windows when the CLI itself
 * does not emit percentage lines.
 */
export async function collectAllQuotas ({ harness = null, runtime, io = {}, workerId = null, now = new Date() } = {}) {
  const instances = Array.isArray(harness?.instances) ? harness.instances : []
  const targets = workerId
    ? instances.filter((i) => i.id === workerId || i.driverId === workerId)
    : instances.filter((i) => i.enabled !== false)

  const results = []
  for (const inst of targets) {
    let probed
    try {
      probed = await collectQuotaForInstance(inst, { io, now })
    } catch {
      continue
    }
    const prev = runtime.quotas.get(probed.workerId)
    // Preserve fresh headers/native windows when probe confirms auth is valid but CLI doesn't print % lines.
    const mergedWindows = probed.authRequired
      ? []
      : (probed.windows.length > 0 ? probed.windows : (prev?.windows ?? []))
    const res = recordQuotaUpdate(runtime, probed.workerId, {
      driverId: probed.driverId,
      label: probed.label,
      billingMode: probed.billingMode !== 'unknown' ? probed.billingMode : (prev?.billingMode ?? 'unknown'),
      authRequired: probed.authRequired,
      authMessage: probed.authMessage,
      windows: mergedWindows
    }, now)
    if (res.ok) results.push(res.quota)
  }
  return { ok: true, probed: results.length, quotas: results }
}
