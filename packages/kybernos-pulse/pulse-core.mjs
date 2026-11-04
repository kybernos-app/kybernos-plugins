// kybernos-pulse — the pure rules. No disk, no clock of its own, no DSH: everything the host and the tests share.
//
// What this bundle does: it watches the sessions the Automations scheduler started, files what happened to each (finished, failed, waiting
// for an approval) in a small inbox, and says which of those deserve a banner. The browser half draws the inbox and the banners.
//
// Where the facts come from, nothing guessed:
//   · which runs exist  tasks.json, the `history` of each automation (`{ at, sessionId, status }`, the scheduler's own record)
//   · how a run stands  the engine's own session journal: `turn/start`, `turn/end` (with an error reason when the turn failed),
//                       `approval/asked` and `approval/decided`, `tool/call`. The same events the Automations page reads.
//   · the certification gate  gates.json, the store the gate owns, beside tasks.json: a static check that failed, a trial that
//                       failed or reached outside, a trial that passed, an approval due, an approval still to switch on
//   · the initiative queue   initiatives.json, the ledger the queue owns, beside it: a draft waiting for the person
// The two stores are only read, never written, and absent is the normal state of the product: no file, no item, no error.
// Nothing is read from globalThis, nothing is captured at load time, and no text is guessed: the fields are the contract.

export const SETTINGS_VERSION = 1
export const LEVELS = ['need', 'every', 'never']
export const MUTED_MAX = 30
export const NAME_MAX = 80
export const INBOX_MAX = 100
/** The feeds an inbox item can come from. An item stored before the gate and the queue existed is a 'scheduler' one. */
export const SOURCES = ['scheduler', 'gate', 'queue']
/** The gate store, beside tasks.json. Pulse reads this file; the `gate` field of a `list` answer belongs to the Automations page. */
export const GATE_FILE = 'gates.json'
/** Bounds this batch adds. INBOX_MAX is unchanged and still the last word. */
export const GATE_ITEMS_PER_PASS = 40
export const QUEUE_ITEMS_PER_PASS = 8 // = SUGGESTED_MAX of automation-suggest.mjs
export const SEEN_MAX = 300 // ids remembered in state.seen + state.gates + state.queue together
export const PROACTIVE_FILE_MAX = 1024 * 1024 // a feed file over this is not parsed
const ID_MAX = 120
const SIG_MAX = 60
const CODE_MAX = 60
const MESSAGE_MAX = 200
/** A run is followed for this long after it was fired; past it, it is let go. */
export const HORIZON_MS = 6 * 3600 * 1000
/** At most this many sessions are read per pass: one journal read each. */
export const READS_PER_PASS = 20
export const SESSION_ID_RE = /^[A-Za-z0-9_.-]{1,80}$/

const one = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '')
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const obj = (v) => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v : null)

// A mail address or a long opaque token never reaches a card or the state file. Same idea as the `scrub` of
// automation-runs.mjs, copied rather than imported: two bundles never import each other.
const MAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const TOKEN_RE = /[A-Za-z0-9+/=_-]{40,}/g
/** One line, bounded to `max`, with mail addresses and long tokens blanked. Anything that is not a string is ''. */
export const scrubText = (v, max) => {
  const width = typeof max === 'number' && max > 0 ? Math.round(max) : MESSAGE_MAX
  const flat = one(v, width * 8)
  return one(flat.replace(MAIL_RE, '[mail]').replace(TOKEN_RE, '[token]'), width)
}

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
 *   { phase: 'stopped', calls, startedAt, endedAt }                 the last turn was cut short (the person stopped it): nothing is claimed, no card
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
    if (reason !== null && (reason.kind === 'aborted' || reason.kind === 'interrupted')) return { phase: 'stopped', calls, startedAt, endedAt }
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
    bannered: r.bannered === true,
    source: SOURCES.indexOf(r.source) >= 0 ? r.source : 'scheduler'
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

export const emptyState = () => ({ baselined: false, seen: {}, gates: {}, queue: {}, inbox: [] })

export const normalizeState = (raw) => {
  const r = obj(raw)
  const st = emptyState()
  if (r === null) return st
  st.baselined = r.baselined === true
  const seen = obj(r.seen)
  if (seen !== null) {
    for (const [sid, v] of Object.entries(seen)) {
      const e = obj(v)
      if (SESSION_ID_RE.test(sid) && e !== null && (e.phase === 'done' || e.phase === 'failed' || e.phase === 'stopped' || e.phase === 'waiting' || e.phase === 'running') && num(e.at) !== null) st.seen[sid] = { phase: e.phase, at: e.at }
    }
  }
  // The two maps of this batch: absent in a file written by the previous version, which is a normal state (no migration).
  st.gates = signalMap(r.gates)
  st.queue = signalMap(r.queue)
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

// ── The gate and the queue: two feeds read beside tasks.json ─────────────────────────────────────────────────

/** `{ [automationId]: name }` from the tasks the pass already reads for its run names: a gate card's title then costs no extra read. */
export const taskNames = (tasks) => {
  const out = {}
  for (const t of Array.isArray(tasks) ? tasks : []) {
    const task = obj(t)
    if (task === null) continue
    const id = one(task.id, NAME_MAX)
    if (id === '') continue
    out[id] = one(task.name, NAME_MAX) || 'Automation'
  }
  return out
}

const blockersOf = (checks) => {
  const list = Array.isArray(checks !== null && checks !== undefined ? checks.findings : null) ? checks.findings : []
  return list.filter((f) => obj(f) !== null && f.severity === 'blocker')
}

/**
 * The signal of one GateRecord: null when the record says nothing the person must act on, otherwise
 * `{ kind, code, message }` with the three existing kinds. First match wins, in this order: a failed static check, a failed
 * trial, a trial that reached outside (reported as failed even when the record also says awaiting-approval), then the status.
 * `draft`, `static-passed` and `refused` say nothing: they are working states of the Automations page, not news. Pure, no clock.
 */
export const gateSignal = (record) => {
  const r = obj(record)
  if (r === null) return null
  const checks = obj(r.staticChecks)
  if (checks !== null && checks.verdict === 'fail') {
    const blockers = blockersOf(checks)
    const first = blockers.length > 0 ? scrubText(blockers[0].message, MESSAGE_MAX) : ''
    const message = first !== '' ? first : (blockers.length === 0 ? 'The static checks failed' : blockers.length + ' blockers')
    return { kind: 'failed', code: 'gate.static.failed', message }
  }
  const trial = obj(r.trial)
  const outcome = trial !== null ? obj(trial.outcome) : null
  if (outcome !== null && outcome.state === 'failed') {
    return { kind: 'failed', code: 'gate.trial.failed', message: scrubText(outcome.message, MESSAGE_MAX) || scrubText(outcome.code, MESSAGE_MAX) }
  }
  if (trial !== null && trial.sideEffectFree === false) {
    const effects = Array.isArray(trial.externalEffects) ? trial.externalEffects : []
    const first = effects.length > 0 ? scrubText(effects[0], 80) : ''
    return { kind: 'failed', code: 'gate.trial.effects', message: first !== '' ? 'The trial reached something outside: ' + first : 'The trial reached something outside' }
  }
  if (r.status === 'awaiting-approval') return { kind: 'waiting', code: 'gate.awaiting-approval', message: 'A supervised trial passed; your approval is due' }
  if (r.status === 'approved') return { kind: 'waiting', code: 'gate.approved', message: 'Approved; switching it on in Automations is still yours' }
  // A passed trial needs its proof: without one the record claims more than it can show, and the card stays away.
  if (r.status === 'trial-done' && trial !== null && trial.sideEffectFree === true) {
    const calls = Array.isArray(trial.toolCalls) ? trial.toolCalls.length : 0
    return { kind: 'done', code: 'gate.trial.passed', message: 'Supervised trial passed, no external effect · ' + calls + ' calls' }
  }
  if (r.status === 'activated') return { kind: 'done', code: 'gate.activated', message: 'Switched on' }
  return null
}

/** An ISO time as epoch ms, never in the future (`now` is the ceiling); null when it cannot be read, and the record is then skipped. */
const timeOf = (iso, nowMs) => {
  const ms = typeof iso === 'string' ? Date.parse(iso) : NaN
  if (!Number.isFinite(ms)) return null
  const ceiling = num(nowMs) !== null ? nowMs : ms
  return ms > ceiling ? ceiling : ms
}

/** One inbox item from one GateRecord, or null. `name` is the automation's display name from tasks.json; 'Automation' when unknown. */
export const gateItemFor = (record, now, name) => {
  const r = obj(record)
  if (r === null) return null
  const automationId = one(r.automationId, NAME_MAX)
  if (automationId === '') return null
  const signal = gateSignal(r)
  if (signal === null) return null
  const at = timeOf(r.updatedAt, now)
  if (at === null) return null
  return cleanItem({
    id: ('g:' + automationId).slice(0, ID_MAX),
    kind: signal.kind,
    task: one(name, NAME_MAX) || 'Automation',
    taskId: automationId,
    at,
    code: signal.code.slice(0, CODE_MAX),
    message: signal.message,
    source: 'gate',
    unread: true,
    bannered: false
  })
}

/** One inbox item from one InitiativeEntry, or null (an entry that is `added` or `dropped` is no news). `task` is the entry title. */
export const queueItemFor = (entry, now) => {
  const e = obj(entry)
  if (e === null) return null
  const id = one(e.id, NAME_MAX)
  if (id === '') return null
  if (e.status !== 'proposed' && e.status !== 'asked') return null
  const at = timeOf(e.at, now)
  if (at === null) return null
  const next = obj(e.nextAction)
  const summary = next !== null ? scrubText(next.summary, MESSAGE_MAX) : ''
  const risk = scrubText(e.risk, 20)
  const undo = scrubText(e.reversibility, 20)
  const qualifier = risk !== '' && undo !== '' ? ' (risk: ' + risk + ' · undo: ' + undo + ')' : ''
  return cleanItem({
    id: ('q:' + id).slice(0, ID_MAX),
    kind: 'waiting',
    task: scrubText(e.title, NAME_MAX) || 'Initiative',
    taskId: id,
    at,
    code: 'queue.draft',
    message: scrubText((summary !== '' ? summary : 'A draft message, ready to review') + qualifier, MESSAGE_MAX),
    source: 'queue',
    unread: true,
    bannered: false
  })
}

/** A map of `{ sig, at }` for one feed, cleaned and capped: what the pass remembers per automation or per entry. */
const signalMap = (raw) => {
  const out = {}
  const m = obj(raw)
  if (m === null) return out
  for (const [key, v] of Object.entries(m)) {
    if (!SESSION_ID_RE.test(key)) continue
    const e = obj(v)
    if (e === null || typeof e.sig !== 'string' || e.sig === '' || num(e.at) === null) continue
    out[key] = { sig: one(e.sig, SIG_MAX), at: e.at }
  }
  return capSignals(out)
}

/** Drop the oldest entries of one map over SEEN_MAX (oldest first, so the newest state survives). */
const capSignals = (map) => {
  const keys = Object.keys(map)
  if (keys.length <= SEEN_MAX) return map
  keys.sort((a, b) => map[a].at - map[b].at)
  for (let i = 0; i < keys.length - SEEN_MAX; i += 1) delete map[keys[i]]
  return map
}

/**
 * The gate/queue half of a pass: folds the records into the state, follows the first-pass rule and returns what moved.
 * Mutates and returns the state it is given (same style as the session loop), so `watchStep` calls it before `baselined`.
 * On the very first pass a result (done or failed) is only remembered, never announced; an ask is announced, silently
 * (`bannered: true`), because an ask is why the module is being switched on. `names` maps an automationId to its display name.
 */
export const proactiveStep = ({ state, gates = [], entries = [], names = {}, now } = {}) => {
  const st = state !== null && typeof state === 'object' ? state : emptyState()
  if (obj(st.gates) === null) st.gates = {}
  if (obj(st.queue) === null) st.queue = {}
  if (!Array.isArray(st.inbox)) st.inbox = []
  const ticks = num(now) !== null ? now : Date.now()
  const nameOf = obj(names) !== null ? names : {}
  const first = st.baselined !== true
  const added = []
  const removed = []
  const drop = (id) => {
    if (st.inbox.some((x) => x.id === id) === false) return
    st.inbox = inboxRemove(st.inbox, id)
    removed.push(id)
    for (const x of added.slice()) if (x.id === id) added.splice(added.indexOf(x), 1)
  }

  // One record per automation: a duplicated automationId is one card, and the highest revision wins.
  const byAutomation = new Map()
  for (const raw of Array.isArray(gates) ? gates : []) {
    const r = obj(raw)
    if (r === null) continue
    const id = one(r.automationId, NAME_MAX)
    if (id === '') continue
    const before = byAutomation.get(id)
    if (before === undefined || (num(r.rev) !== null ? r.rev : 0) > (num(before.rev) !== null ? before.rev : 0)) byAutomation.set(id, r)
  }
  let madeGates = 0
  for (const [id, record] of byAutomation) {
    const signal = gateSignal(record)
    const key = 'g:' + id
    if (signal === null) { drop(key); delete st.gates[id]; continue }
    const sig = signal.kind + '|' + signal.code
    const prev = st.gates[id]
    if (prev !== undefined && prev.sig === sig) continue
    const item = gateItemFor(record, ticks, nameOf[id])
    // No usable time (or no name to show): nothing is remembered, so a repaired record can still make its card later.
    if (item === null) continue
    if (first && item.kind !== 'waiting') { st.gates[id] = { sig, at: ticks }; continue }
    // Over the per-pass cap: the record is NOT remembered, so it is turned into an item on the next pass (15 s later).
    if (madeGates >= GATE_ITEMS_PER_PASS) continue
    if (first) item.bannered = true
    st.gates[id] = { sig, at: ticks }
    st.inbox = inboxPut(st.inbox, item)
    added.push(item)
    madeGates += 1
  }

  // The ledger: the first entry seen for an id wins (entries carry no revision).
  const seenEntries = new Set()
  let madeQueue = 0
  for (const raw of Array.isArray(entries) ? entries : []) {
    const e = obj(raw)
    if (e === null) continue
    const id = one(e.id, NAME_MAX)
    if (id === '' || seenEntries.has(id)) continue
    seenEntries.add(id)
    const item = queueItemFor(e, ticks)
    const key = 'q:' + id
    if (item === null) { drop(key); delete st.queue[id]; continue }
    const sig = item.kind + '|' + item.code
    const prev = st.queue[id]
    if (prev !== undefined && prev.sig === sig) continue
    if (madeQueue >= QUEUE_ITEMS_PER_PASS) continue
    if (first) item.bannered = true
    st.queue[id] = { sig, at: ticks }
    st.inbox = inboxPut(st.inbox, item)
    added.push(item)
    madeQueue += 1
  }
  return { state: st, added, removed }
}

/**
 * One pass over the automations, the gate store and the initiative ledger. `readRunOf(sessionId)` returns the readRun() verdict, or null
 * when the journal cannot be read (then nothing is claimed and the run is looked at again next time). The very first pass only learns: runs
 * that were already over when the module started are recorded without any item, so switching it on never floods the inbox; a run still
 * waiting for an approval does appear. `gates` (B3's records) and `entries` (B4's ledger) are the two proactive feeds, absent on a home that
 * has neither. Order inside one pass: sessions, then gates, then entries — so an ask ends up at the head of the inbox.
 * Returns { state, running, added, removed } — `added` are the items this pass created, `removed` the ids it took away.
 */
export const watchStep = async ({ tasks, state, readRunOf, now, gates = [], entries = [] }) => {
  const st = normalizeState(state)
  const running = []
  const added = []
  const quiet = st.baselined !== true
  const list = candidates(tasks, now)
  let reads = 0
  for (const c of list) {
    const prev = st.seen[c.sessionId]
    if (prev !== undefined && (prev.phase === 'done' || prev.phase === 'failed' || prev.phase === 'stopped')) continue
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
    // A run the person stopped is their own act: it is remembered (never read again) and says nothing, neither « done » nor « failed ».
    if (run.phase === 'stopped') continue
    const item = itemFor(c, run, now)
    if (item === null) continue
    if (quiet) { item.bannered = true }
    st.inbox = inboxPut(st.inbox, item)
    added.push(item)
  }
  // The two proactive feeds, folded with the same first-pass rule as the session loop (it reads `baselined`, so it runs before the flip).
  const proactive = proactiveStep({ state: st, gates, entries, names: taskNames(tasks), now })
  st.baselined = true
  for (const sid of Object.keys(st.seen)) if (now - st.seen[sid].at > 2 * HORIZON_MS) delete st.seen[sid]
  capSignals(st.gates)
  capSignals(st.queue)
  // One budget for the three maps together: the newest SEEN_MAX entries stay, the oldest leave.
  const remembered = []
  for (const [key, v] of Object.entries(st.seen)) remembered.push({ map: st.seen, key, at: v.at })
  for (const [key, v] of Object.entries(st.gates)) remembered.push({ map: st.gates, key, at: v.at })
  for (const [key, v] of Object.entries(st.queue)) remembered.push({ map: st.queue, key, at: v.at })
  if (remembered.length > SEEN_MAX) {
    remembered.sort((a, b) => a.at - b.at)
    for (let i = 0; i < remembered.length - SEEN_MAX; i += 1) delete remembered[i].map[remembered[i].key]
  }
  return { state: st, running, added: added.concat(proactive.added), removed: proactive.removed }
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
