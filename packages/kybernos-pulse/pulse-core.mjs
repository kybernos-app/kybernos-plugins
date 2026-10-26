// kybernos-pulse — the pure rules. No disk, no clock of its own, no DSH: everything the host and the tests share.
//
// What this bundle does: it watches the sessions the Automations scheduler started, files what happened to each (finished, failed, waiting
// for an approval) in a small inbox, and says which of those deserve a banner. The browser half draws the inbox and the banners.
//
// Where the facts come from, nothing guessed:
//   · which runs exist  tasks.json, the `history` of each automation (`{ at, sessionId, status }`, the scheduler's own record)
//   · how a run stands  the engine's own session journal: `turn/start`, `turn/end` (with an error reason when the turn failed),
//                       `approval/asked` and `approval/decided`, `tool/call`. The same events the Automations page reads.

export const SETTINGS_VERSION = 1
export const LEVELS = ['need', 'every', 'never']
export const MUTED_MAX = 30
export const NAME_MAX = 80
export const INBOX_MAX = 100
/** A run is followed for this long after it was fired; past it, it is let go. */
export const HORIZON_MS = 6 * 3600 * 1000
/** At most this many sessions are read per pass: one journal read each. */
export const READS_PER_PASS = 20
export const SESSION_ID_RE = /^[A-Za-z0-9_.-]{1,80}$/

const one = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '')
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const obj = (v) => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v : null)

// ── Settings ────────────────────────────────────────────────────────────────────────────────────────────────

export const defaults = () => ({ version: SETTINGS_VERSION, level: 'need', banners: true, badge: true, muted: [] })

const cleanNames = (list) => {
  const out = []
  for (const x of Array.isArray(list) ? list : []) {
    const n = one(x, NAME_MAX)
    if (n !== '' && out.indexOf(n) < 0) out.push(n)
    if (out.length >= MUTED_MAX) break
  }
  return out
}

/** Any parsed value → a complete, well-typed settings object. A key of the wrong type reads as its default. */
export const normalizeSettings = (raw) => {
  const base = defaults()
  const r = obj(raw)
  if (r === null) return base
  if (LEVELS.indexOf(r.level) >= 0) base.level = r.level
  if (typeof r.banners === 'boolean') base.banners = r.banners
  if (typeof r.badge === 'boolean') base.badge = r.badge
  base.muted = cleanNames(r.muted)
  return base
}

const SETTING_KEYS = ['level', 'banners', 'badge', 'muted', 'mute', 'unmute']

/**
 * A POST body → the next settings, or a refusal. Only known keys with the right types; anything else refuses the whole patch (a half-applied
 * patch would leave the page and the file disagreeing). `mute` / `unmute` add or remove one automation name from the quiet list.
 */
export const applySettings = (current, patch) => {
  const p = obj(patch)
  if (p === null) return { ok: false, error: 'a JSON object is expected' }
  const keys = Object.keys(p)
  if (keys.length === 0) return { ok: false, error: 'nothing to change' }
  for (const k of keys) if (SETTING_KEYS.indexOf(k) < 0) return { ok: false, error: 'unknown setting: ' + k }
  if (p.level !== undefined && LEVELS.indexOf(p.level) < 0) return { ok: false, error: 'level must be one of ' + LEVELS.join(', ') }
  for (const k of ['banners', 'badge']) if (p[k] !== undefined && typeof p[k] !== 'boolean') return { ok: false, error: k + ' must be true or false' }
  if (p.muted !== undefined && !Array.isArray(p.muted)) return { ok: false, error: 'muted must be a list of names' }
  for (const k of ['mute', 'unmute']) if (p[k] !== undefined && one(p[k], NAME_MAX) === '') return { ok: false, error: k + ' must be a name' }
  const next = normalizeSettings(current)
  if (p.level !== undefined) next.level = p.level
  if (p.banners !== undefined) next.banners = p.banners
  if (p.badge !== undefined) next.badge = p.badge
  if (p.muted !== undefined) next.muted = cleanNames(p.muted)
  if (p.mute !== undefined) next.muted = cleanNames(next.muted.concat([p.mute]))
  if (p.unmute !== undefined) { const n = one(p.unmute, NAME_MAX); next.muted = next.muted.filter((x) => x !== n) }
  return { ok: true, settings: next }
}

// ── One run, read from its journal ───────────────────────────────────────────────────────────────────────────

/**
 * How a session stands, from the engine's journal events:
 *   { phase: 'running', calls, startedAt }                          a turn is open (or none has started yet: nothing is claimed)
 *   { phase: 'waiting', calls, startedAt, tool }                    an approval was asked and not decided yet
 *   { phase: 'done',    calls, startedAt, endedAt }                 the last turn ended without an error
 *   { phase: 'failed',  calls, startedAt, endedAt, code, message }  the last turn ended with an error reason
 * Times are epoch milliseconds or null. Same rule as the Automations page: the verdict is the engine's `turn/end` reason, not a reading of
 * the text of the answer.
 */
export const readRun = (events) => {
  const list = Array.isArray(events) ? events : []
  let start = -1
  let end = -1
  let endEv = null
  for (let i = 0; i < list.length; i += 1) {
    const ev = list[i]
    if (ev === null || typeof ev !== 'object') continue
    if (ev.type === 'turn/start') start = i
    else if (ev.type === 'turn/end') { end = i; endEv = ev }
  }
  if (start < 0 && endEv === null) return { phase: 'running', calls: 0, startedAt: null }
  const startedAt = start >= 0 ? num(list[start].time) : null
  let calls = 0
  const asked = new Map()
  for (let i = Math.max(start, 0); i < list.length; i += 1) {
    const ev = list[i]
    if (ev === null || typeof ev !== 'object') continue
    const d = obj(ev.data) || {}
    if (ev.type === 'tool/call') calls += 1
    else if (ev.type === 'approval/asked') asked.set(String(d.id), one(d.toolName, 60))
    else if (ev.type === 'approval/decided') asked.delete(String(d.id))
  }
  if (endEv !== null && end >= start) {
    const endedAt = num(endEv.time)
    const reason = obj(obj(endEv.data) && obj(endEv.data).reason)
    if (reason === null || reason.kind !== 'error') return { phase: 'done', calls, startedAt, endedAt }
    const err = obj(reason.error)
    return { phase: 'failed', calls, startedAt, endedAt, code: err !== null ? one(err.code, 60) : '', message: err !== null ? one(err.message, 200) : '' }
  }
  if (asked.size > 0) return { phase: 'waiting', calls, startedAt, tool: asked.values().next().value }
  return { phase: 'running', calls, startedAt }
}

// ── What the scheduler fired ─────────────────────────────────────────────────────────────────────────────────

/** The runs worth looking at: fired (or queued) with a session, inside the horizon, newest first. */
export const candidates = (tasks, nowMs) => {
  const out = []
  for (const t of Array.isArray(tasks) ? tasks : []) {
    const task = obj(t)
    if (task === null || !Array.isArray(task.history)) continue
    const name = one(task.name, NAME_MAX) || 'Automation'
    for (const h of task.history) {
      const e = obj(h)
      if (e === null || (e.status !== 'fired' && e.status !== 'queued')) continue
      if (typeof e.sessionId !== 'string' || !SESSION_ID_RE.test(e.sessionId)) continue
      const at = Date.parse(e.at)
      if (!Number.isFinite(at) || nowMs - at > HORIZON_MS || at > nowMs + 60000) continue
      out.push({ sessionId: e.sessionId, taskId: one(task.id, 80), name, at })
    }
  }
  out.sort((a, b) => b.at - a.at)
  return out
}

// ── The inbox ────────────────────────────────────────────────────────────────────────────────────────────────

const KINDS = ['done', 'failed', 'waiting']
const TONE = { done: 'ok', failed: 'bad', waiting: 'ask' }

/** One inbox item from stored or incoming data; null when it is not one. Bounded text, known kinds only. */
export const cleanItem = (raw) => {
  const r = obj(raw)
  if (r === null || typeof r.id !== 'string' || r.id === '' || r.id.length > 120 || KINDS.indexOf(r.kind) < 0) return null
  const item = {
    id: r.id,
    kind: r.kind,
    tone: TONE[r.kind],
    todo: r.kind !== 'done',
    task: one(r.task, NAME_MAX) || 'Automation',
    taskId: one(r.taskId, 80),
    sessionId: typeof r.sessionId === 'string' && SESSION_ID_RE.test(r.sessionId) ? r.sessionId : '',
    at: num(r.at) !== null ? r.at : 0,
    unread: r.unread !== false,
    bannered: r.bannered === true
  }
  for (const k of ['durMs', 'calls']) if (num(r[k]) !== null && r[k] >= 0) item[k] = Math.round(r[k])
  if (one(r.tool, 60) !== '') item.tool = one(r.tool, 60)
  if (one(r.message, 200) !== '') item.message = one(r.message, 200)
  if (one(r.code, 60) !== '') item.code = one(r.code, 60)
  return item
}

export const inboxPut = (inbox, item) => [item].concat(inbox.filter((x) => x.id !== item.id)).slice(0, INBOX_MAX)
export const inboxRemove = (inbox, id) => inbox.filter((x) => x.id !== id)

/** A finished run of an automation the person made quiet: listed, but silent (no banner, no count). Failures and approvals are never quiet. */
export const isQuiet = (item, settings) => item.kind === 'done' && settings.muted.indexOf(item.task) >= 0

/** Does this item deserve a banner, at the level the person chose? */
export const wantsBanner = (item, settings) => {
  if (settings.banners !== true || settings.level === 'never') return false
  if (isQuiet(item, settings)) return false
  if (settings.level === 'every') return true
  return item.kind !== 'done'
}

export const bannersDue = (inbox, settings) => inbox.filter((x) => x.bannered !== true && x.unread === true && wantsBanner(x, settings))
export const unreadCount = (inbox, settings) => inbox.filter((x) => x.unread === true && !isQuiet(x, settings)).length

// ── The watcher's pass ───────────────────────────────────────────────────────────────────────────────────────

export const emptyState = () => ({ baselined: false, seen: {}, inbox: [] })

export const normalizeState = (raw) => {
  const r = obj(raw)
  const st = emptyState()
  if (r === null) return st
  st.baselined = r.baselined === true
  const seen = obj(r.seen)
  if (seen !== null) {
    for (const [sid, v] of Object.entries(seen)) {
      const e = obj(v)
      if (SESSION_ID_RE.test(sid) && e !== null && (e.phase === 'done' || e.phase === 'failed' || e.phase === 'waiting' || e.phase === 'running') && num(e.at) !== null) st.seen[sid] = { phase: e.phase, at: e.at }
    }
  }
  for (const x of Array.isArray(r.inbox) ? r.inbox : []) { const it = cleanItem(x); if (it !== null) st.inbox.push(it) }
  st.inbox = st.inbox.slice(0, INBOX_MAX)
  return st
}

const itemFor = (c, run, nowMs) => {
  const base = { sessionId: c.sessionId, taskId: c.taskId, task: c.name, calls: run.calls, unread: true, bannered: false }
  if (run.phase === 'waiting') return cleanItem({ ...base, id: 'w:' + c.sessionId, kind: 'waiting', at: nowMs, tool: run.tool })
  const endedAt = run.endedAt !== null && run.endedAt !== undefined ? run.endedAt : nowMs
  const durMs = run.startedAt !== null && run.endedAt !== null && run.endedAt >= run.startedAt ? run.endedAt - run.startedAt : undefined
  if (run.phase === 'done') return cleanItem({ ...base, id: 'r:' + c.sessionId, kind: 'done', at: endedAt, durMs })
  return cleanItem({ ...base, id: 'r:' + c.sessionId, kind: 'failed', at: endedAt, durMs, code: run.code, message: run.message })
}

/**
 * One pass over the automations. `readRunOf(sessionId)` returns the readRun() verdict, or null when the journal cannot be read (then nothing is
 * claimed and the run is looked at again next time). The very first pass only learns: runs that were already over when the module started are
 * recorded without any item, so switching it on never floods the inbox; a run still waiting for an approval does appear.
 * Returns { state, running, added } — `added` are the items this pass created.
 */
export const watchStep = async ({ tasks, state, readRunOf, now }) => {
  const st = normalizeState(state)
  const running = []
  const added = []
  const quiet = st.baselined !== true
  const list = candidates(tasks, now)
  let reads = 0
  for (const c of list) {
    const prev = st.seen[c.sessionId]
    if (prev !== undefined && (prev.phase === 'done' || prev.phase === 'failed')) continue
    if (reads >= READS_PER_PASS) break
    reads += 1
    let run = null
    try { run = await readRunOf(c.sessionId) } catch (e) { run = null }
    if (run === null || run === undefined) continue
    st.seen[c.sessionId] = { phase: run.phase, at: prev !== undefined && prev.phase === run.phase ? prev.at : now }
    if (run.phase === 'running' || run.phase === 'waiting') running.push({ sessionId: c.sessionId, taskId: c.taskId, task: c.name, phase: run.phase, calls: run.calls, startedAt: run.startedAt !== null && run.startedAt !== undefined ? run.startedAt : c.at, tool: run.tool })
    if (prev !== undefined && prev.phase === 'waiting' && run.phase !== 'waiting') st.inbox = inboxRemove(st.inbox, 'w:' + c.sessionId)
    if (run.phase === 'running') continue
    const isNew = prev === undefined || prev.phase !== run.phase
    if (!isNew) continue
    if (run.phase !== 'waiting') st.inbox = inboxRemove(st.inbox, 'w:' + c.sessionId)
    if (quiet && run.phase !== 'waiting') continue
    const item = itemFor(c, run, now)
    if (item === null) continue
    if (quiet) { item.bannered = true }
    st.inbox = inboxPut(st.inbox, item)
    added.push(item)
  }
  st.baselined = true
  for (const sid of Object.keys(st.seen)) if (now - st.seen[sid].at > 2 * HORIZON_MS) delete st.seen[sid]
  return { state: st, running, added }
}

// ── The answer of the state route ────────────────────────────────────────────────────────────────────────────

export const publicView = ({ settings, state, running, now }) => {
  const s = normalizeSettings(settings)
  const inbox = state.inbox.map((x) => ({ ...x, quiet: isQuiet(x, s) }))
  return {
    settings: s,
    inbox,
    running: running.slice(0, 20),
    unread: unreadCount(state.inbox, s),
    banners: bannersDue(state.inbox, s).map((x) => x.id),
    now
  }
}

/** The inbox actions of the POST route: read one, read all, dismiss one, mark banners as shown. Returns the next inbox, or null for a bad body. */
export const inboxAction = (inbox, body) => {
  const b = obj(body)
  if (b === null) return null
  const ids = Array.isArray(b.ids) ? b.ids.filter((x) => typeof x === 'string').slice(0, 100) : (typeof b.id === 'string' ? [b.id] : [])
  switch (b.action) {
    case 'read': return ids.length === 0 ? null : inbox.map((x) => (ids.indexOf(x.id) >= 0 ? { ...x, unread: false } : x))
    case 'read-all': return inbox.map((x) => ({ ...x, unread: false }))
    case 'dismiss': return ids.length === 0 ? null : inbox.filter((x) => ids.indexOf(x.id) < 0)
    case 'banner-shown': return ids.length === 0 ? null : inbox.map((x) => (ids.indexOf(x.id) >= 0 ? { ...x, bannered: true } : x))
    default: return null
  }
}
