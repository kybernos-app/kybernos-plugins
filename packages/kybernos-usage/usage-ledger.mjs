// kybernos-usage — the ledger: what was used, by day, by model and by session.
//
// Pure: no disk, no DSH, no clock of its own (the caller passes `now`). The browser reports, from the session
// projection `tokenUsage`, the CUMULATIVE counters of a session; this module turns those into deltas.
//
// Honesty rules, all deliberate:
//  - the first time a session is seen, what it had already used is not dated: it goes to `before`, never to a day;
//  - a counter that goes down (a replayed log, a reset) is a new baseline, never a negative or a double count;
//  - tokens are stored, money is not: a price changes, a token count does not (the page prices them when it draws);
//  - the plan's own windows are the server's business and are not stored here.

export const VERSION = 1
export const MAX_DAYS = 120
export const MAX_SESSIONS = 300

const KEYS = ['u', 'o', 'cr', 'cw']
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const count = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), 1e12) : 0)
const text = (v, max) => (typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : '')
const zero = () => ({ u: 0, o: 0, cr: 0, cw: 0 })
const copy = (t) => ({ u: count(t && t.u), o: count(t && t.o), cr: count(t && t.cr), cw: count(t && t.cw) })
const add = (a, b) => { for (const k of KEYS) a[k] += b[k]; return a }
export const total = (t) => t.u + t.o + t.cr + t.cw

export const emptyLedger = () => ({ version: VERSION, days: {}, sessions: {}, before: {}, budget: { usd: null, alert: true } })

/** Local calendar day, YYYY-MM-DD. */
export const dayKey = (date) => {
  const d = date instanceof Date ? date : new Date(date)
  const p = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

/** The four counters of a `tokenUsage` projection, as non-negative integers. */
export const tokensOf = (usage) => (isObj(usage)
  ? { u: count(usage.uncachedInputTokens), o: count(usage.outputTokens), cr: count(usage.cacheReadTokens), cw: count(usage.cacheWriteTokens) }
  : zero())

/** Anything read from disk goes through here: a corrupt file never throws, it becomes an empty ledger. */
export function normalise (raw) {
  const out = emptyLedger()
  if (!isObj(raw)) return out
  if (isObj(raw.days)) {
    for (const day of Object.keys(raw.days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !isObj(raw.days[day]) || !isObj(raw.days[day].models)) continue
      const models = {}
      for (const k of Object.keys(raw.days[day].models)) models[k.slice(0, 300)] = copy(raw.days[day].models[k])
      out.days[day] = { models }
    }
  }
  if (isObj(raw.before)) for (const k of Object.keys(raw.before)) out.before[k.slice(0, 300)] = copy(raw.before[k])
  if (isObj(raw.sessions)) {
    for (const sid of Object.keys(raw.sessions)) {
      const s = raw.sessions[sid]
      if (!isObj(s)) continue
      const models = {}
      if (isObj(s.models)) for (const k of Object.keys(s.models)) models[k.slice(0, 300)] = copy(s.models[k])
      out.sessions[sid.slice(0, 160)] = {
        title: text(s.title, 160), key: text(s.key, 300), last: copy(s.last), models,
        first: text(s.first, 40), seen: text(s.seen, 40),
      }
    }
  }
  if (isObj(raw.budget)) {
    const usd = typeof raw.budget.usd === 'number' && Number.isFinite(raw.budget.usd) && raw.budget.usd > 0 ? raw.budget.usd : null
    out.budget = { usd, alert: raw.budget.alert !== false }
  }
  return out
}

const prune = (ledger, now) => {
  const keep = new Date(now); keep.setDate(keep.getDate() - MAX_DAYS)
  const min = dayKey(keep)
  for (const d of Object.keys(ledger.days)) if (d < min) delete ledger.days[d]
  const ids = Object.keys(ledger.sessions)
  if (ids.length > MAX_SESSIONS) {
    ids.sort((a, b) => String(ledger.sessions[a].seen).localeCompare(String(ledger.sessions[b].seen)))
    for (const id of ids.slice(0, ids.length - MAX_SESSIONS)) delete ledger.sessions[id]
  }
}

/**
 * Apply one observation: { sessionId, provider, model, title?, usage } where `usage` is the cumulative
 * `tokenUsage` of the session. Mutates `ledger`. Returns { ok, changed, delta, key }.
 */
export function applyObservation (ledger, obs, now = new Date()) {
  if (!isObj(obs)) return { ok: false, reason: 'invalid' }
  const sid = text(obs.sessionId, 160)
  const model = text(obs.model, 160)
  const provider = text(obs.provider, 120)
  if (sid === '' || model === '') return { ok: false, reason: 'invalid' }
  const key = provider === '' ? model : provider + '/' + model
  const cur = tokensOf(obs.usage)
  const title = text(obs.title, 160)
  const iso = new Date(now).toISOString()
  let s = ledger.sessions[sid]
  if (s === undefined) {
    if (total(cur) === 0) return { ok: true, changed: false, delta: zero(), key }
    ledger.before[key] = add(ledger.before[key] === undefined ? zero() : ledger.before[key], cur)
    ledger.sessions[sid] = { title, key, last: cur, models: {}, first: iso, seen: iso }
    prune(ledger, now)
    return { ok: true, changed: true, delta: zero(), key, baseline: true }
  }
  let changed = false
  if (title !== '' && title !== s.title) { s.title = title; changed = true }
  if (key !== s.key) { s.key = key; changed = true }
  let reset = false
  for (const k of KEYS) if (cur[k] < s.last[k]) reset = true
  if (reset) { s.last = cur; s.seen = iso; return { ok: true, changed: true, delta: zero(), key, reset: true } }
  const delta = zero()
  for (const k of KEYS) delta[k] = cur[k] - s.last[k]
  if (total(delta) === 0) return { ok: true, changed, delta, key }
  const day = dayKey(now)
  if (ledger.days[day] === undefined) ledger.days[day] = { models: {} }
  const bucket = ledger.days[day].models
  bucket[key] = add(bucket[key] === undefined ? zero() : bucket[key], delta)
  s.models[key] = add(s.models[key] === undefined ? zero() : s.models[key], delta)
  s.last = cur
  s.seen = iso
  prune(ledger, now)
  return { ok: true, changed: true, delta, key }
}

export function setBudget (ledger, body) {
  if (!isObj(body)) return { ok: false, reason: 'invalid' }
  let usd = null
  if (body.usd !== null && body.usd !== undefined) {
    if (typeof body.usd !== 'number' || !Number.isFinite(body.usd) || body.usd < 0 || body.usd > 1e6) return { ok: false, reason: 'invalid' }
    usd = body.usd === 0 ? null : body.usd
  }
  ledger.budget = { usd, alert: body.alert !== false }
  return { ok: true, budget: ledger.budget }
}

/** What the page draws, in tokens: the days of the period (oldest first), the totals by model, the sessions. */
export function summarize (ledger, { days = 30, now = new Date() } = {}) {
  const n = Math.min(Math.max(Math.floor(days) || 30, 1), MAX_DAYS)
  const keys = []
  for (let i = n - 1; i >= 0; i--) { const d = new Date(now); d.setDate(d.getDate() - i); keys.push(dayKey(d)) }
  const daily = keys.map((day) => ({ day, models: ledger.days[day] === undefined ? {} : ledger.days[day].models }))
  const models = {}
  for (const d of daily) for (const k of Object.keys(d.models)) models[k] = add(models[k] === undefined ? zero() : models[k], d.models[k])
  const first = keys[0]
  const inPeriod = Object.keys(ledger.sessions)
    .map((id) => ({ id, ...ledger.sessions[id] }))
    .filter((s) => s.seen !== '' && dayKey(s.seen) >= first && Object.keys(s.models).length > 0)
    .sort((a, b) => String(b.seen).localeCompare(String(a.seen)))
  // the list is cut at 40 for the page; the count is not (a dashboard says how many sessions there were)
  const sessions = inPeriod
    .slice(0, 40)
    .map((s) => ({ id: s.id, title: s.title, seen: s.seen, models: s.models }))
  const allDays = Object.keys(ledger.days).sort()
  return {
    period: { days: n, from: keys[0], to: keys[keys.length - 1] },
    daily, models, sessions, sessionCount: inPeriod.length,
    before: ledger.before,
    since: allDays.length > 0 ? allDays[0] : null,
    budget: ledger.budget,
  }
}
