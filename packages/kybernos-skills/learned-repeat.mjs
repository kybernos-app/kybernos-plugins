// What Kaby notices: the person asked for the same kind of thing again. Rules on the first message of each chat, no model, nothing leaves this computer.
//
// The chats are read through a read-only seam of kybernos-search (`globalThis[Symbol.for('kybernos.chat-index')]`, frozen, looked up at call time): without that
// bundle nothing is noticed and everything else keeps working. This module only COUNTS and says « you asked something alike N times »; it never writes a skill:
// the card it feeds pre-fills the composer and the person presses Send (the agent then writes the proposal with `skill_propose`).
//
// What counts as « alike » (measured, docs/dev/learned-skills.md): the first message of each chat of the last 30, 60 or 90 days, short asks only (a brief of more than
// 400 characters is not an ask), words of 4 letters or more without the common words, the numbers and the paths; two asks are alike when they share 3 words and at
// least 40 % of their words; a pattern is at least `minRep` chats on at least 3 different days.
//
// When it speaks: under a finished answer of the chat that makes the pattern (the newest member, opened in the last 3 days), at most once a day; two « Not now » in a
// row make it once a week; « Never for this one » is remembered; an accepted one is quiet for 30 days. In Law and Health no word of a chat is kept: numbers and dates.
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { join } from 'node:path'

export const SEAM = Symbol.for('kybernos.chat-index')
export const LIMITS = Object.freeze({
  askMax: 400,          // a longer first message is a brief, not an ask
  minTokens: 4,
  minShared: 3,
  jaccard: 0.4,
  minDays: 3,           // different days
  recentChatDays: 3,    // the chat that makes the pattern is a recent one
  shownGapDays: 1,
  laterGapDays: 7,      // after two « Not now » in a row
  doneQuietDays: 30,
  keepPatterns: 60,
  keepShown: 30,
  refreshMs: 120000,    // the chat index is refreshed at most this often
  cacheMs: 600000       // the analysis is kept this long
})
const DAY = 24 * 3600 * 1000

// The common English and French words the detector ignores (a data file: it is language, not text a person reads).
const STOP = new Set(JSON.parse(readFileSync(new URL('./stopwords.json', import.meta.url), 'utf8')).words)

const fold = (t) => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const iso = (ms) => new Date(ms).toISOString()
const dayOf = (ms) => iso(ms).slice(0, 10)

/** The words of an ask, or null when it is not a short ask (too long, or too few words once the common ones, numbers and paths are gone). */
export const tokensOf = (text) => {
  const raw = String(text === undefined || text === null ? '' : text)
  if (raw.length > LIMITS.askMax) return null
  const words = fold(raw.replace(/https?:\/\/\S+/g, ' ').replace(/[\w.~-]*[\\/][\w./\\~-]+/g, ' ')).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !/^\d+$/.test(w) && !STOP.has(w))
  const set = new Set(words)
  return set.size >= LIMITS.minTokens ? set : null
}

/** Are two asks alike: 3 words in common and at least 40 % of the words of both. */
export const similar = (a, b) => {
  let inter = 0
  for (const w of a) if (b.has(w)) inter += 1
  return inter >= LIMITS.minShared && inter / (a.size + b.size - inter) >= LIMITS.jaccard
}

/** Chats Kaby does not read as the person's own asks: started by an automation, the phone bridge or Kaby's own folder. */
export const excludedCwd = (cwd) => /[\\/]\.dsh[\\/]kybernos|telegram-bridge|kybernos-automations/.test(String(cwd === undefined || cwd === null ? '' : cwd))

/**
 * The patterns among `asks` (`[{ id, at, text, cwd }]`, `at` in ms): groups of at least `minRep` alike chats of the last `windowDays` days on at least 3 different days.
 * `[{ id, anchor, members, n, days, firstAt, lastAt, terms }]`, biggest first. The id is stable while the oldest chat of the group stays in the window.
 */
export const findPatterns = (asks, { minRep = 3, windowDays = 60, now = Date.now() } = {}) => {
  const since = now - windowDays * DAY
  const rows = []
  for (const a of Array.isArray(asks) ? asks : []) {
    if (a === null || typeof a !== 'object' || typeof a.id !== 'string' || !Number.isFinite(a.at) || a.at < since || a.at > now + DAY || excludedCwd(a.cwd)) continue
    const tk = tokensOf(a.text)
    if (tk !== null) rows.push({ id: a.id, at: a.at, tk })
  }
  rows.sort((x, y) => x.at - y.at)
  const parent = rows.map((_, i) => i)
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] } return i }
  for (let i = 0; i < rows.length; i += 1) for (let j = i + 1; j < rows.length; j += 1) if (similar(rows[i].tk, rows[j].tk)) parent[find(i)] = find(j)
  const groups = new Map()
  rows.forEach((r, i) => { const k = find(i); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r) })
  const out = []
  for (const g of groups.values()) {
    const days = [...new Set(g.map((r) => dayOf(r.at)))].sort()
    if (g.length < minRep || days.length < LIMITS.minDays) continue
    const freq = new Map()
    for (const r of g) for (const w of r.tk) freq.set(w, (freq.get(w) || 0) + 1)
    const terms = [...freq.entries()].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).slice(0, 3).map((x) => x[0])
    out.push({ id: 'r_' + createHash('sha1').update(g[0].id).digest('hex').slice(0, 8), anchor: g[0].id, members: g.map((r) => r.id), n: g.length, days, firstAt: g[0].at, lastAt: g[g.length - 1].at, terms })
  }
  return out.sort((x, y) => y.n - x.n || y.lastAt - x.lastAt)
}

// ── what is remembered: the answers and the last time it spoke (numbers, dates and, outside Law and Health, three words) ─────────
export const noticesPath = (dsh) => join(dsh, 'kybernos', 'skills-learned-notices.json')
const emptyState = () => ({ v: 1, shown: [], streak: 0, patterns: {}, current: null, week: { key: null, session: null, hidden: null } })
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const str = (v, max) => String(typeof v === 'string' ? v : '').replace(/[\x00-\x1f\x7f]+/g, ' ').trim().slice(0, max)

export const normalizeState = (raw) => {
  const out = emptyState()
  if (!plain(raw)) return out
  out.shown = (Array.isArray(raw.shown) ? raw.shown : []).filter((x) => typeof x === 'string' && Number.isFinite(Date.parse(x))).slice(-LIMITS.keepShown)
  out.streak = Number.isInteger(raw.streak) && raw.streak > 0 ? Math.min(raw.streak, 9) : 0
  if (plain(raw.patterns)) {
    for (const id of Object.keys(raw.patterns).slice(0, 500)) {
      const p = raw.patterns[id]
      if (!/^r_[0-9a-f]{8}$/.test(id) || !plain(p) || ['shown', 'later', 'never', 'done'].indexOf(p.state) < 0) continue
      out.patterns[id] = { state: p.state, at: str(p.at, 40), n: Number.isInteger(p.n) ? p.n : 0, label: typeof p.label === 'string' && p.label !== '' ? str(p.label, 80) : null }
    }
    const keep = Object.keys(out.patterns).sort((a, b) => String(out.patterns[b].at).localeCompare(String(out.patterns[a].at))).slice(0, LIMITS.keepPatterns)
    for (const id of Object.keys(out.patterns)) if (keep.indexOf(id) < 0) delete out.patterns[id]
  }
  if (plain(raw.current) && /^r_[0-9a-f]{8}$/.test(String(raw.current.pid))) out.current = { pid: raw.current.pid, session: str(raw.current.session, 80), at: str(raw.current.at, 40), n: Number.isInteger(raw.current.n) ? raw.current.n : 0, days: (Array.isArray(raw.current.days) ? raw.current.days : []).map((d) => str(d, 10)).slice(-6), label: typeof raw.current.label === 'string' && raw.current.label !== '' ? str(raw.current.label, 80) : null }
  if (plain(raw.week)) out.week = { key: typeof raw.week.key === 'string' ? str(raw.week.key, 12) : null, session: typeof raw.week.session === 'string' ? str(raw.week.session, 80) : null, hidden: typeof raw.week.hidden === 'string' ? str(raw.week.hidden, 12) : null }
  return out
}
export const readState = (dsh) => { try { return normalizeState(JSON.parse(readFileSync(noticesPath(dsh), 'utf8'))) } catch (e) { return emptyState() } }
export const writeState = (dsh, state) => {
  const file = noticesPath(dsh)
  mkdirSync(join(file, '..'), { recursive: true })
  const temp = file + '.tmp-' + String(process.pid) + '-' + randomBytes(3).toString('hex')
  try { writeFileSync(temp, JSON.stringify(state) + '\n', { encoding: 'utf8', mode: 0o600 }); renameSync(temp, file) } catch (e) { try { unlinkSync(temp) } catch (e2) { /* nothing to clean */ } throw e }
}
// one writer at a time (the routes of one process)
let queue = Promise.resolve()
export const withState = (dsh, fn) => { const run = queue.then(async () => { const s = readState(dsh); const before = JSON.stringify(s); const r = await fn(s); if (JSON.stringify(s) !== before) writeState(dsh, s); return r }); queue = run.catch(() => null); return run }

// ── the chat index (kybernos-search), read-only ──────────────────────────────────────────────────────────────────────────────────
const seamOf = () => { try { const s = globalThis[SEAM]; return s !== undefined && s !== null && typeof s.asks === 'function' ? s : null } catch (e) { return null } }
const cache = { at: 0, key: '', patterns: [], asks: [] }
let lastRefresh = 0
/** The asks of the last `windowDays` days and the patterns among them (kept 10 minutes); `fresh` re-reads the index first (a chat that has just begun). */
const analyse = async ({ windowDays, minRep, now, fresh }) => {
  const seam = seamOf()
  if (seam === null) return null
  if ((fresh === true || now - lastRefresh > LIMITS.refreshMs) && typeof seam.refresh === 'function') { lastRefresh = now; try { await seam.refresh() } catch (e) { /* the cached index still answers */ } }
  const key = String(windowDays) + ':' + String(minRep)
  if (cache.key === key && now - cache.at < LIMITS.cacheMs && fresh !== true) return cache
  let asks = []
  try { asks = seam.asks(now - windowDays * DAY) } catch (e) { asks = [] }
  Object.assign(cache, { at: now, key, asks: Array.isArray(asks) ? asks : [], patterns: findPatterns(asks, { minRep, windowDays, now }) })
  return cache
}
export const forgetCache = () => { cache.at = 0; cache.key = ''; lastRefresh = 0 }

/** The pattern a chat belongs to, with the newest member being that chat: `{ pattern, ask }` or `{ why }`. */
const patternOf = async ({ sessionId, minRep, windowDays, now }) => {
  let a = await analyse({ windowDays, minRep, now, fresh: false })
  if (a === null) return { why: 'no_index' }
  let ask = a.asks.find((x) => x !== null && typeof x === 'object' && x.id === sessionId)
  if (ask === undefined) { a = await analyse({ windowDays, minRep, now, fresh: true }); ask = a === null ? undefined : a.asks.find((x) => x !== null && typeof x === 'object' && x.id === sessionId) }
  if (ask === undefined) return { why: 'not_indexed' }
  if (tokensOf(ask.text) === null) return { why: 'not_a_short_ask' }
  const pattern = a.patterns.find((p) => p.members.indexOf(sessionId) >= 0)
  if (pattern === undefined) return { why: 'no_pattern' }
  if (pattern.members[pattern.members.length - 1] !== sessionId) return { why: 'not_newest' }
  if (now - ask.at > LIMITS.recentChatDays * DAY) return { why: 'old_chat' }
  return { pattern, ask }
}

/** How many chats (this one included) the host verified as asking something alike, for the evidence of a skill proposed from this chat. `{ n, dates }` or null. */
export const repeatInfo = async ({ sessionId, minRep = 3, windowDays = 60, now = Date.now() }) => {
  try {
    const r = await patternOf({ sessionId: String(sessionId), minRep, windowDays, now })
    return r.pattern === undefined ? null : { n: r.pattern.n, dates: r.pattern.days.slice(-6) }
  } catch (e) { return null }
}

/**
 * The notice for the chat on screen, or none. `settings` is the person's (notice, minRep, win), `sensitive` is Law or Health (no word is kept or shown).
 * `{ ok: true, notice: { id, n, dates, label, minRep } | null, why? }`. Asking again for the same chat gives the same notice and counts once.
 */
export const noticeFor = ({ dsh, sessionId, settings, sensitive, now = Date.now() }) => withState(dsh, async (state) => {
  const sid = str(sessionId, 80)
  if (settings.notice !== true) return { ok: true, notice: null, why: 'off' }
  if (sid === '') return { ok: true, notice: null, why: 'no_session' }
  const view = (c) => ({ id: c.pid, n: c.n, dates: c.days, label: sensitive === true ? null : c.label, minRep: settings.minRep })
  if (state.current !== null && state.current.session === sid && state.patterns[state.current.pid] !== undefined && state.patterns[state.current.pid].state === 'shown') return { ok: true, notice: view(state.current) }
  const r = await patternOf({ sessionId: sid, minRep: settings.minRep, windowDays: settings.win, now })
  if (r.pattern === undefined) return { ok: true, notice: null, why: r.why }
  const known = state.patterns[r.pattern.id]
  if (known !== undefined && known.state === 'never') return { ok: true, notice: null, why: 'never' }
  if (known !== undefined && known.state === 'done' && now - (Date.parse(known.at) || 0) < LIMITS.doneQuietDays * DAY) return { ok: true, notice: null, why: 'done' }
  const last = state.shown.length > 0 ? Date.parse(state.shown[state.shown.length - 1]) : 0
  if (now - last < LIMITS.shownGapDays * DAY) return { ok: true, notice: null, why: 'today' }
  if (state.streak >= 2 && now - last < LIMITS.laterGapDays * DAY) return { ok: true, notice: null, why: 'week' }
  const label = sensitive === true ? null : r.pattern.terms.join(' ')
  const cur = { pid: r.pattern.id, session: sid, at: iso(now), n: r.pattern.n, days: r.pattern.days.slice(-6), label }
  state.shown = state.shown.concat([iso(now)]).slice(-LIMITS.keepShown)
  state.current = cur
  state.patterns[cur.pid] = { state: 'shown', at: iso(now), n: cur.n, label }
  return { ok: true, notice: view(cur) }
})

/** The person answered the card: `yes` (the composer was pre-filled), `later` or `never`. */
export const answerNotice = ({ dsh, id, answer, now = Date.now() }) => withState(dsh, async (state) => {
  const p = state.patterns[String(id)]
  if (p === undefined) return { ok: false, error: 'not_found' }
  if (['yes', 'later', 'never'].indexOf(answer) < 0) return { ok: false, error: 'bad_answer' }
  p.state = answer === 'yes' ? 'done' : (answer === 'never' ? 'never' : 'later')
  p.at = iso(now)
  state.streak = answer === 'later' ? state.streak + 1 : 0
  if (state.current !== null && state.current.pid === id) state.current = null
  return { ok: true, id: String(id), state: p.state }
})

/** What the settings page lists: the patterns the person answered (and what Kaby kept of them). */
export const listNotices = ({ dsh, sensitive }) => {
  const s = readState(dsh)
  return { ok: true, index: seamOf() !== null, patterns: Object.keys(s.patterns).filter((id) => s.patterns[id].state !== 'shown').map((id) => ({ id, state: s.patterns[id].state, n: s.patterns[id].n, at: s.patterns[id].at, label: sensitive === true ? null : s.patterns[id].label })).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 20) }
}
/** « Forget » / « Allow again »: the record goes, so the pattern can be noticed again. */
export const forgetNotice = ({ dsh, id }) => withState(dsh, async (state) => {
  if (state.patterns[String(id)] === undefined) return { ok: false, error: 'not_found' }
  delete state.patterns[String(id)]
  if (state.current !== null && state.current.pid === id) state.current = null
  return { ok: true, id: String(id) }
})

