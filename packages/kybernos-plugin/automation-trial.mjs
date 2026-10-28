// ── KB-AUTOTRIAL-HEADER ────────────────────────────────────────────────────
// The middle rung of the certification gate: a supervised, side-effect-free trial of one automation draft, and the
// proof report a person reads before deciding.
//
// A trial is a real session, started by a person, whose write-capable calls are refused at runtime: the mask answers
// every call that could change something outside the session, and the run is then judged on its journal. The trial
// state machine has four states and NO edge to `approved` or `activated`: this module can ask the person and record a
// refusal, and that is all. The `granted` transition and the `active` flip belong to the route (B3), which consults
// `mayActivate` — the single activation predicate of the lot — instead of re-deriving the rule.
//
// Why the rules are pure: every answer here is a function of arguments (a gate record, a trial, the engine's own
// journal events, and an ISO timestamp the caller passes). The host owns the session, the store and the clock; this
// module holds no clock of its own, opens no file, no socket and no timer, and starts nothing at import time, so it
// can be unit-tested without a running DSH and imported by B3 behind its existing try/catch guard.
//
// What it deliberately cannot do: decide that an automation may run; grant an approval; switch a task on; invent a
// gate record; read an argument value back out of a proof (a proof carries tool names, instants and scrubbed error
// text, never a path, a token or a message body). It also never takes a claim for evidence: a proof this module builds
// is sealed with a fingerprint of its own content, and `approved`/`activated` are only read off a record whose proof
// carries a valid one with a dated grant. The digest is tamper-EVIDENCE, not authentication — it is unkeyed, so it stops
// a pasted or edited proof, not a forger who reimplements it; the run's journal, from which `trial-report` builds the
// proof, remains the anchor. The gate vocabulary is imported from the static gate (B1), never copied: one list, one
// meaning.

import { allowedAt } from './automation-load.mjs'
import { scrub, summarizeRun } from './automation-runs.mjs'
import { GATE_APPROVAL_STATES, GATE_FINDINGS_MAX, GATE_RECORD_KEYS, GATE_STATUSES } from './automation-gate.mjs'

export { GATE_APPROVAL_STATES, GATE_FINDINGS_MAX, GATE_RECORD_KEYS, GATE_STATUSES }

// ── KB-AUTOTRIAL-BOUNDS ────────────────────────────────────────────────────
/** The four states of a trial. `done` is not a pass: the pass lives in the proof below. */
export const TRIAL_STATES = Object.freeze(['requested', 'running', 'done', 'failed'])

/** The only edges of the machine. A retry is a NEW trial (`startTrial`), never an edge out of `failed`. */
export const TRIAL_TRANSITIONS = Object.freeze({
  requested: Object.freeze(['running', 'failed']),
  running: Object.freeze(['done', 'failed']),
  done: Object.freeze([]),
  failed: Object.freeze([]),
})

/** The two presets B3 must install on the trial session (frozen here so there is one source). */
export const TRIAL_APPROVALS = 'ask'
export const TRIAL_MASK = 'deny-writes'

/**
 * What the model reads when the mask stops a call. The proof recognises a refusal by this text, so it is a contract:
 * English, one line, stable, and containing no token long enough for the scrubber to alter.
 */
export const TRIAL_DENY_REASON = 'This is a supervised trial: this call may change something outside this session, so it was refused.'

/** How many tool calls, errors and effects one proof carries, and how long one text is. */
export const PROOF_TOOL_CALLS_MAX = 20
export const PROOF_ERRORS_MAX = 5
export const PROOF_EFFECTS_MAX = 10
export const PROOF_TEXT_MAX = 420 // = RUN_TEXT_MAX, so a proof and a run summary clip alike
/** The longest id this module emits (a gate id, a trial id, a run id). */
export const GATE_ID_MAX = 120

const TRIAL_MSG_MAX = 200
const TRIAL_EFFECT_MAX = 120
const TRIAL_NAME_MAX = 60
const TRIAL_CODE_MAX = 60
const TRIAL_SEVERITY = Object.freeze(['blocker', 'warn', 'info'])
const TRIAL_LADDER = Object.freeze(['draft', 'static-failed', 'static-passed', 'trial-done', 'awaiting-approval', 'approved', 'activated'])

/** A gate id or an automation id: the same alphabet the routes accept, and the same bound. */
const TRIAL_ID_RE = /^[A-Za-z0-9_.:-]{1,120}$/

// ── KB-AUTOTRIAL-TIME ──────────────────────────────────────────────────────
// The module holds no clock. Two conversions only: read an instant the caller stored, and format an instant the
// journal stamped. Both are pure arithmetic over a value they were given.

const TRIAL_ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/

/** An ISO 8601 instant, or null: ranges are checked, so `2026-13-45T99:99:99Z` is not one. */
const isoAt = (v) => {
  if (typeof v !== 'string') return null
  const m = TRIAL_ISO_RE.exec(v)
  if (m === null) return null
  const mo = Number(m[2])
  const d = Number(m[3])
  const h = Number(m[4])
  const mi = Number(m[5])
  const s = Number(m[6])
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60) return null
  return v
}

/** A validated ISO instant as milliseconds since the epoch, or null. `Date.parse` reads an instant, it never reads a clock. */
const msOfIso = (v) => {
  if (isoAt(v) === null) return null
  const ms = Date.parse(v)
  return Number.isFinite(ms) === true ? ms : null
}

const pad = (v, n) => String(v).padStart(n, '0')

/** A journal stamp (whole milliseconds since the epoch) as an ISO 8601 instant, by arithmetic (Howard Hinnant's inverse). */
const isoOfMs = (ms) => {
  if (typeof ms !== 'number' || Number.isFinite(ms) === false) return ''
  const whole = Math.floor(ms)
  let days = Math.floor(whole / 86400000)
  let rest = whole - days * 86400000
  if (rest < 0) { days -= 1; rest += 86400000 }
  const z = days + 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365)
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1
  const mo = mp < 10 ? mp + 3 : mp - 9
  const y = yoe + era * 400 + (mo <= 2 ? 1 : 0)
  const hh = Math.floor(rest / 3600000)
  const mi = Math.floor((rest - hh * 3600000) / 60000)
  const ss = Math.floor((rest - hh * 3600000 - mi * 60000) / 1000)
  const milli = rest - hh * 3600000 - mi * 60000 - ss * 1000
  return pad(y, 4) + '-' + pad(mo, 2) + '-' + pad(d, 2) + 'T' + pad(hh, 2) + ':' + pad(mi, 2) + ':' + pad(ss, 2) + '.' + pad(milli, 3) + 'Z'
}

/** The digits of an instant: the stable tail of a trial id, so two trials of one draft never share an id. */
const digitsOf = (v) => String(v === null || v === undefined ? '' : v).replace(/[^0-9]/g, '')

const plain = (v) => v !== null && typeof v === 'object' && Array.isArray(v) === false

// ── KB-AUTOTRIAL-ACCESS ────────────────────────────────────────────────────
// Which calls may touch something outside the session.
//
// The word tables below are a COPY of the shape of the engine's own tables in the host module (KB_MCP_READ_WORDS /
// KB_MCP_WRITE_WORDS, the ones the MCP approval gate already uses), not an import: that table is private to a hot
// module this batch must not touch, and a second opinion is exactly what a proof wants — a name the runtime guard
// let through still has to survive this classifier, and this classifier is the fail-safe one. A write word anywhere
// wins; with no write word, one read word is enough; a name this cannot read is a write ("unknown is never a read").

const TRIAL_READ_WORDS = new Set(['get', 'list', 'read', 'search', 'find', 'fetch', 'query', 'lookup', 'count', 'describe', 'details',
  'detail', 'info', 'status', 'view', 'show', 'inspect', 'retrieve', 'preview', 'now', 'schema', 'schemas', 'docs', 'documentation',
  'analytics', 'whoami', 'hover', 'definition', 'definitions', 'references', 'symbols', 'diagnostics', 'models', 'check', 'snapshot',
  'screenshot', 'plan', 'planner', 'glob', 'grep', 'ls'])

const TRIAL_WRITE_WORDS = new Set(['send', 'create', 'update', 'delete', 'remove', 'write', 'post', 'put', 'patch', 'add', 'append',
  'insert', 'upsert', 'move', 'rename', 'trash', 'untrash', 'archive', 'unarchive', 'label', 'unlabel', 'reply', 'forward', 'share',
  'unshare', 'invite', 'upload', 'publish', 'unpublish', 'pay', 'charge', 'refund', 'cancel', 'close', 'reopen', 'merge', 'edit',
  'modify', 'set', 'apply', 'execute', 'exec', 'run', 'click', 'fill', 'type', 'press', 'drag', 'drop', 'submit', 'select', 'import',
  'export', 'copy', 'duplicate', 'clear', 'reset', 'revoke', 'grant', 'assign', 'approve', 'reject', 'confirm', 'schedule', 'book',
  'order', 'buy', 'sell', 'transfer', 'capture', 'void', 'sync', 'install', 'uninstall', 'enable', 'disable', 'activate', 'deactivate',
  'subscribe', 'unsubscribe', 'mark', 'star', 'unstar', 'pin', 'unpin', 'snooze', 'block', 'unblock', 'report', 'empty', 'purge',
  'restore', 'rollback', 'deploy', 'start', 'stop', 'kill', 'restart', 'evaluate', 'format', 'save', 'store', 'commit', 'push',
  // The engine's own agent tools: a sub-agent or a teammate can do anything, so a call that starts one is a write.
  'spawn', 'teammate', 'subagent', 'shell'])

/**
 * The built-in tools that only read, whose own name carries no word of either table: they load text into the session
 * and cannot change anything outside it. `todo_write` is here because it writes the SESSION's own list, not a file.
 */
const TRIAL_BUILTIN_READS = new Set(['glob', 'grep', 'ls', 'skill', 'todo_write', 'todo_read'])

/** Composio's meta-tools that only look things up; everything else of its is gated, EXECUTE judged on its actions. */
const TRIAL_COMPOSIO_READ_META = new Set(['COMPOSIO_SEARCH_TOOLS', 'COMPOSIO_GET_TOOL_SCHEMAS', 'COMPOSIO_SEARCH_SKILLS', 'COMPOSIO_USE_SKILL', 'COMPOSIO_WAIT_FOR_CONNECTIONS'])

/** A tool name as the engine tokenizes it: camelCase split, lower case, anything else a separator. */
const trialWords = (name) => String(name).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w !== '')

/** A write word anywhere wins; with none, one read word is enough; no known word at all is not a read. */
const trialIsReadName = (name) => {
  let read = false
  for (const w of trialWords(name)) {
    if (TRIAL_WRITE_WORDS.has(w) === true) return false
    if (TRIAL_READ_WORDS.has(w) === true) read = true
  }
  return read
}

const trialArgsOf = (raw) => {
  if (plain(raw) === true) return raw
  try { const a = JSON.parse(String(raw === undefined ? '{}' : raw)); return plain(a) === true ? a : {} } catch (e) { return {} }
}

/**
 * The Composio actions a (multi-)execute call carries, or null when they cannot be read. Bounded: 20 actions, 80
 * characters each, and one malformed entry makes the whole call unreadable (a write this cannot judge is a write).
 */
const trialComposioSlugs = (args) => {
  let a = args
  if (typeof a === 'string') { try { a = JSON.parse(a) } catch (e) { return null } }
  if (plain(a) === false) return null
  const slugs = []
  const add = (v) => { if (typeof v !== 'string' || v === '' || slugs.length >= 20) return false; slugs.push(v.slice(0, 80)); return true }
  if (Array.isArray(a.tools) === true) {
    for (const t of a.tools) {
      if (slugs.length >= 20) break
      if (typeof t === 'string') { if (add(t) === false) return null; continue }
      if (plain(t) === false || typeof t.tool_slug !== 'string' || t.tool_slug === '') return null
      add(t.tool_slug)
    }
  }
  if (a.tool_slug !== undefined) { if (typeof a.tool_slug !== 'string' || a.tool_slug === '') return null; add(a.tool_slug) }
  return slugs.length === 0 ? null : slugs
}

/**
 * 'read' when the call provably cannot change anything outside the session; 'write' otherwise. Total: a name that is
 * not a string, an unreadable argument blob or an internal error all answer 'write'.
 */
export const accessOf = (name, args) => {
  try { return trialAccessOf(name, args) } catch (e) { return 'write' }
}

const trialAccessOf = (name, args) => {
  if (typeof name !== 'string') return 'write'
  const raw = name.trim()
  if (raw === '') return 'write'
  if (TRIAL_BUILTIN_READS.has(raw) === true) return 'read'
  const mcp = /^mcp__(.+?)__(.+)$/.exec(raw)
  if (mcp === null) return trialIsReadName(raw) === true ? 'read' : 'write'
  const tool = mcp[2]
  if (tool.indexOf('COMPOSIO_') !== 0) return trialIsReadName(tool) === true ? 'read' : 'write'
  if (TRIAL_COMPOSIO_READ_META.has(tool) === true) return 'read'
  if (tool.indexOf('EXECUTE') < 0) return 'write'
  const slugs = trialComposioSlugs(args)
  if (slugs === null) return 'write'
  for (const slug of slugs) if (trialIsReadName(slug) === false) return 'write'
  return 'read'
}

// ── KB-AUTOTRIAL-TRIAL ────────────────────────────────────────────────────
// The in-flight state. It is host memory, not a stored shape: only the finished proof reaches the gate record.

const trialOf = (raw) => {
  if (plain(raw) === false) return null
  const state = typeof raw.state === 'string' && TRIAL_STATES.indexOf(raw.state) >= 0 ? raw.state : null
  if (state === null) return null
  return {
    id: scrub(raw.id, GATE_ID_MAX),
    gateId: scrub(raw.gateId, GATE_ID_MAX),
    automationId: scrub(raw.automationId, GATE_ID_MAX),
    state,
    requestedAt: isoAt(raw.requestedAt) || '',
    startedAt: isoAt(raw.startedAt),
    endedAt: isoAt(raw.endedAt),
    sessionId: typeof raw.sessionId === 'string' && raw.sessionId !== '' ? raw.sessionId.slice(0, GATE_ID_MAX) : null,
    supervised: true,
    approvals: TRIAL_APPROVALS,
    mask: TRIAL_MASK,
    refusal: plain(raw.refusal) === true && typeof raw.refusal.code === 'string'
      ? { code: scrub(raw.refusal.code, TRIAL_CODE_MAX), message: scrub(raw.refusal.message, TRIAL_MSG_MAX) }
      : null,
  }
}

const trialRefusal = (code, error) => ({ ok: false, code, error })

const trialAutomationId = (gate) => {
  if (plain(gate) === false) return null
  if (typeof gate.automationId === 'string' && TRIAL_ID_RE.test(gate.automationId) === true) return gate.automationId
  if (typeof gate.id === 'string' && gate.id.indexOf('gate:') === 0 && TRIAL_ID_RE.test(gate.id.slice(5)) === true) return gate.id.slice(5)
  return null
}

// The machine slot of a trial: a trial is a real session, so it asks the load rules the rest of the automations ask.
const trialCapacityFree = (capacity) => {
  if (plain(capacity) === false) return true
  return allowedAt(capacity.level, capacity.maxParallel) > 0
}

/**
 * Begin a supervised trial. Returns the in-flight state, or a refusal code.
 *   { gate, by, at, sessionId?, capacity? }
 * `by` must be 'person': a model tool call, a cron, a webhook or a tunnelled request is refused here as well as at
 * the route. `capacity` is `{ level, maxParallel }`, read by the load rules; without it no slot is checked.
 */
export const startTrial = (input) => {
  try { return trialStart(input) } catch (e) { return trialRefusal('gate-not-ready', 'the trial could not be started.') }
}

const trialStart = (input) => {
  const o = plain(input) === true ? input : {}
  if (o.by !== 'person') return trialRefusal('not-supervised', 'a trial is started by a person, never by a model, a schedule or a webhook.')
  const at = isoAt(o.at)
  if (at === null) return trialRefusal('no-timestamp', 'a trial needs an ISO 8601 timestamp: this module holds no clock.')
  const gate = plain(o.gate) === true ? o.gate : {}
  const automationId = trialAutomationId(gate)
  if (automationId === null) return trialRefusal('gate-not-ready', 'the gate record carries no usable automation id.')
  if (gate.status !== 'static-passed' && gate.status !== 'trial-done') return trialRefusal('gate-not-ready', "a trial follows the static gate: the record must read 'static-passed' or 'trial-done'.")
  if (plain(gate.trial) === true && plain(gate.trial.outcome) === true && gate.trial.outcome.state === 'open') return trialRefusal('already-open', 'a trial of this draft is still running.')
  if (trialCapacityFree(o.capacity) === false) return trialRefusal('machine-busy', 'the computer is too busy to start a trial now: try again when the load drops.')
  return {
    ok: true,
    trial: {
      id: ('trial:' + automationId + ':' + digitsOf(at)).slice(0, GATE_ID_MAX),
      gateId: ('gate:' + automationId).slice(0, GATE_ID_MAX),
      automationId,
      state: 'requested',
      requestedAt: at,
      startedAt: null,
      endedAt: null,
      sessionId: typeof o.sessionId === 'string' && o.sessionId !== '' ? o.sessionId.slice(0, GATE_ID_MAX) : null,
      supervised: true,
      approvals: TRIAL_APPROVALS,
      mask: TRIAL_MASK,
      refusal: null,
    },
  }
}

// One edge of TRIAL_TRANSITIONS, or the trial unchanged: the two entry points of the machine share this line.
const trialEdge = (trial, target, at) => {
  if (TRIAL_TRANSITIONS[trial.state].indexOf(target) < 0) return trial
  const next = Object.assign({}, trial, { state: target })
  const iso = isoAt(at)
  if (target === 'running') { if (iso !== null) next.startedAt = iso } else if (iso !== null) next.endedAt = iso
  return next
}

const TRIAL_SIGNALS = Object.freeze({ 'run-started': 'running', 'run-ended': 'done', 'run-failed': 'failed' })

/**
 * Move the in-flight state on a host signal, without reading events:
 *   { type: 'run-started', at?, sessionId? } | { type: 'run-ended', at? } | { type: 'run-failed', at? }
 * A signal already applied, an edge that does not exist, or a trial this cannot read answers `changed: false`.
 */
export const advanceTrial = (trial, signal) => {
  try {
    const t = trialOf(trial)
    if (t === null) return { trial: null, changed: false, code: 'illegal-transition' }
    const s = plain(signal) === true ? signal : {}
    const target = TRIAL_SIGNALS[s.type]
    if (target === undefined || TRIAL_TRANSITIONS[t.state].indexOf(target) < 0) return { trial: t, changed: false, code: 'illegal-transition' }
    const next = trialEdge(t, target, s.at)
    if (target === 'running' && typeof s.sessionId === 'string' && s.sessionId !== '') next.sessionId = s.sessionId.slice(0, GATE_ID_MAX)
    return { trial: next, changed: true }
  } catch (e) {
    return { trial: null, changed: false, code: 'illegal-transition' }
  }
}

// ── KB-AUTOTRIAL-PROOF ────────────────────────────────────────────────────
// The proof of one run, from the engine's own journal events. `summarizeRun` gives the clock, the counts and the
// verdict; a second, bounded pass gives what a summary drops: the full tool name (the summary clips it to 40
// characters, which cuts a connector slug), the arguments (needed to judge a Composio EXECUTE) and the approval
// decision of each call.

// The text of a tool result, whatever shape the engine wrote it in.
const trialResultText = (content) => {
  if (typeof content === 'string') return content
  if (Array.isArray(content) === true) {
    return content.map((p) => {
      if (typeof p === 'string') return p
      if (plain(p) === false) return ''
      if (p.text !== undefined) return String(p.text)
      return plain(p.output) === true && p.output.text !== undefined ? String(p.output.text) : ''
    }).join(' ')
  }
  try { return JSON.stringify(content === undefined ? '' : content) } catch (e) { return '' }
}

// A tool result may quote an absolute path (an error about a file this machine holds), and a proof carries no path.
// Two or more leading-slash segments are masked exactly as the scrubber masks an e-mail or a long token.
const TRIAL_PATH_RE = /(?:\/[A-Za-z0-9_.@+-]+){2,}/g

/** Text of a journal that may reach a proof: the package scrubber, then no absolute path, then the same bound. */
const trialSafeText = (v, max) => scrub(scrub(v, max).replace(TRIAL_PATH_RE, '•••'), max)

// A result body is scrubbed and bounded before anything else touches it: 2 000 characters is plenty to recognise a
// refusal, and bounding first keeps a huge payload from being scanned four times.
const trialResultSafe = (content) => {
  const raw = trialResultText(content)
  return trialSafeText(raw.length > 2000 ? raw.slice(0, 2000) : raw, PROOF_TEXT_MAX)
}

// A decision that refused the call. 'asked' is the undecided state and 'allowed-once' the engine's grant.
const trialRefusalDecision = (decision) => typeof decision === 'string' && decision !== '' && decision !== 'asked' && decision !== 'allowed-once'

// ── KB-AUTOTRIAL-INTEGRITY ────────────────────────────────────────────────
// Evidence, not text: a proof this module built carries a fingerprint of its own content, and `approved`/`activated`
// are only readable off a record whose proof carries a valid one. Without it a hand-edited gates.json could copy a
// clean-looking proof — `sideEffectFree: true`, a completed outcome — and climb the ladder on words alone. The digest
// is FNV-1a over the canonical fields, in a fixed order, with no dependency and no clock: the same cheap digest the
// host uses for its corrupt copies, and stable across processes so a stored hash is still true after a restart.
const TRIAL_PROOF_HASH_FIELDS = Object.freeze(['runId', 'gateId', 'startedAt', 'endedAt', 'supervised', 'sideEffectFree', 'toolCalls', 'outcome', 'externalEffects', 'errors'])

/** The fingerprint of a proof: its canonical fields, never the fingerprint itself. */
const trialProofHashOf = (proof) => {
  const text = JSON.stringify(TRIAL_PROOF_HASH_FIELDS.map((k) => (proof[k] === undefined ? null : proof[k])))
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return 'fnv1a:' + h.toString(16).padStart(8, '0')
}

/** Seal a proof: its normalized shape, then the fingerprint of that shape. Null when it is not a proof at all. */
const trialSealProof = (raw) => {
  const p = normalizeProof(raw)
  if (p === null) return null
  p.proofHash = trialProofHashOf(p)
  return p
}

/**
 * May a record sit above `awaiting-approval`? Only on evidence: a sealed proof (a real run id and a valid digest) and
 * a dated grant that is not in the future. `at` is an instant the caller already holds (the store passes its own now);
 * with no instant there is nothing to compare the grant against, and the seal plus the stamp are judged alone.
 */
const trialEvidence = (proof, approval, at) => {
  if (proof === null || proof.supervised !== true) return false
  if (typeof proof.runId !== 'string' || proof.runId === '') return false
  if (typeof proof.proofHash !== 'string' || proof.proofHash === '') return false
  if (approval.state !== 'granted' || approval.at === null) return false
  if (at !== null) {
    const granted = msOfIso(approval.at)
    const horizon = msOfIso(at)
    if (granted === null || horizon === null || granted > horizon) return false
  }
  return true
}

/**
 * The proof of a run, built from the run's journal events; the trial is advanced in the same pass.
 *   { trial, events, at }   →   { trial, proof: ProofReport | null }
 * Only the FIRST turn is read: a session of an automation is one prompt, and what a person says later is theirs.
 * `at` is accepted for a uniform signature and never used: every instant here comes from the journal, so the builder
 * cannot invent one and two runs of the same events give the same bytes.
 */
export const trialFromEvents = (input) => {
  try { return trialFromEventsRaw(input) } catch (e) { return { trial: trialOf(plain(input) === true ? input.trial : null), proof: null } }
}

const trialFromEventsRaw = (input) => {
  const o = plain(input) === true ? input : {}
  const trial = trialOf(o.trial)
  const events = Array.isArray(o.events) === true ? o.events : []
  const summary = summarizeRun(events)
  if (trial === null || summary === null) return { trial, proof: null }
  // The window of the first turn, by array order, exactly as summarizeRun reads it.
  let from = -1
  let to = -1
  for (let i = 0; i < events.length; i += 1) {
    const ev = events[i]
    if (plain(ev) === false) continue
    if (ev.type === 'turn/start') { if (from < 0) from = i } else if (ev.type === 'turn/end' && from >= 0 && to < 0) to = i
  }
  if (from < 0) return { trial, proof: null }
  const stop = to < 0 ? events.length : to + 1
  const order = []
  const byCall = new Map()
  const approvalCall = new Map()
  const decisions = new Map()
  for (let i = from; i < stop; i += 1) {
    const ev = events[i]
    if (plain(ev) === false) continue
    const d = plain(ev.data) === true ? ev.data : {}
    if (ev.type === 'tool/call') {
      const callId = String(d.callId)
      if (byCall.has(callId) === true) continue
      byCall.set(callId, {
        name: scrub(typeof d.name === 'string' ? d.name : '', TRIAL_NAME_MAX) || 'tool',
        args: trialArgsOf(d.arguments),
        result: null,
        resultAt: null,
      })
      order.push(callId)
    } else if (ev.type === 'tool/result') {
      const m = plain(d.message) === true ? d.message : null
      if (m === null) continue
      const call = byCall.get(String(m.toolCallId))
      if (call === undefined || call.result !== null) continue
      call.result = { isError: m.isError === true, text: trialResultSafe(m.content) }
      call.resultAt = ev.time
    } else if (ev.type === 'approval/asked') {
      const id = String(d.id)
      const callId = String(d.callId)
      approvalCall.set(id, callId)
      if (decisions.has(callId) === false) decisions.set(callId, 'asked')
    } else if (ev.type === 'approval/decided') {
      const id = String(d.id)
      const callId = approvalCall.has(id) === true ? approvalCall.get(id) : String(d.callId)
      decisions.set(callId, scrub(typeof d.outcome === 'string' ? d.outcome : '', 40) || 'decided')
    }
  }
  const calls = []
  const effects = []
  const seenEffects = new Set()
  const errors = []
  let allWritesRefused = true
  for (const callId of order) {
    const call = byCall.get(callId)
    const access = accessOf(call.name, call.args)
    const errored = call.result !== null && call.result.isError === true
    const refused = access === 'write' && (trialRefusalDecision(decisions.get(callId)) || (errored === true && call.result.text.indexOf(TRIAL_DENY_REASON) >= 0))
    const outcome = refused === true ? 'refused-as-write' : (errored === true ? 'error' : 'ok')
    calls.push({ toolName: call.name, access, outcome })
    if (access === 'write') {
      if (refused === true) continue
      // A refusal is the mask doing its job, never an outside effect: only a call that could have run is one.
      allWritesRefused = false
      const effect = scrub((outcome === 'ok' ? 'write-succeeded:' : 'write-unverified:') + call.name, TRIAL_EFFECT_MAX)
      if (seenEffects.has(effect) === false && effects.length < PROOF_EFFECTS_MAX) { seenEffects.add(effect); effects.push(effect) }
    }
    if (outcome === 'error' && errors.length < PROOF_ERRORS_MAX) {
      errors.push({ at: isoOfMs(call.resultAt), where: call.name, message: trialSafeText(call.result.text, PROOF_TEXT_MAX) })
    }
  }
  const verdict = plain(summary.outcome) === true ? summary.outcome : { state: 'failed' }
  if (verdict.state === 'failed' && errors.length < PROOF_ERRORS_MAX) {
    const message = trialSafeText(verdict.message !== undefined ? verdict.message : verdict.code, PROOF_TEXT_MAX)
    errors.push({ at: isoAt(summary.endedAt) || '', where: 'turn/end', message: message === '' ? 'the turn failed.' : message })
  }
  const outcome = { state: verdict.state === 'completed' || verdict.state === 'open' ? verdict.state : 'failed' }
  const code = scrub(verdict.code, TRIAL_CODE_MAX)
  if (code !== '') outcome.code = code
  if (verdict.message !== undefined) {
    const message = trialSafeText(verdict.message, PROOF_TEXT_MAX)
    if (message !== '') outcome.message = message
  }
  const proof = {
    runId: (trial.sessionId !== null ? trial.sessionId : 'trial:' + trial.gateId + ':' + digitsOf(trial.requestedAt)).slice(0, GATE_ID_MAX),
    gateId: trial.gateId,
    startedAt: isoAt(summary.startedAt) || '',
    endedAt: isoAt(summary.endedAt),
    supervised: true,
    // cadrage.md:93, read literally: nothing realized AND every write call refused at runtime — over EVERY call of
    // the window, never only over the bounded list.
    sideEffectFree: effects.length === 0 && allWritesRefused === true,
    toolCalls: calls.slice(0, PROOF_TOOL_CALLS_MAX),
    outcome,
    externalEffects: effects,
    errors,
  }
  let next = trial
  if (next.state === 'requested') next = trialEdge(next, 'running', summary.startedAt)
  if (outcome.state === 'failed') next = trialEdge(next, 'failed', summary.endedAt)
  else if (outcome.state === 'completed') next = trialEdge(next, 'done', summary.endedAt)
  const sealed = trialSealProof(proof)
  return { trial: next, proof: sealed }
}

/**
 * A proof passes only if the run completed, nothing reached the outside, every write-classified call was refused at
 * runtime, AND the proof carries the fingerprint of its own content: a record with no verifiable trial reference is
 * not a pass, it is a claim. With no write call at all both runtime clauses hold vacuously, so a read-only run passes.
 */
export const trialPassed = (proof) => {
  const p = normalizeProof(proof)
  if (p === null) return false
  if (typeof p.proofHash !== 'string' || p.proofHash === '') return false
  return p.sideEffectFree === true && p.outcome.state === 'completed' && p.externalEffects.length === 0
}

/** The gate status a finished trial unlocks. Never 'approved'/'activated': only a person climbs those rungs. */
export const gateStatusAfterTrial = (trial, proof) => (trialPassed(proof) === true ? 'awaiting-approval' : 'trial-done')

// ── KB-AUTOTRIAL-RECORD ───────────────────────────────────────────────────
// The gate record: stored bytes → a safe record capped at what its evidence allows, a record → exactly the frozen
// keys, and the four moves a trial may make on it (attach a proof, ask, refuse, may it be activated).

/**
 * Stored bytes → a safe ProofReport, or null when it is not one. The verdict is never trusted blind: `sideEffectFree`
 * survives only when the arrays agree with it, so a hand-edited proof cannot claim a clean run it did not have.
 */
export const normalizeProof = (raw) => {
  if (plain(raw) === false) return null
  // A proof with no run id reports no run: it is not a proof, so it is not one here either.
  const runId = scrub(raw.runId, GATE_ID_MAX)
  if (runId === '') return null
  // The verdict runs over EVERY stored call; only the displayed list is truncated. A write at position 21 is still a
  // write, and a call this cannot read counts as a write that may have run.
  const PROOF_TOOL_CALLS_SCAN_MAX = 1000
  const rawCalls = Array.isArray(raw.toolCalls) === true ? raw.toolCalls : []
  const scanned = Math.min(rawCalls.length, PROOF_TOOL_CALLS_SCAN_MAX)
  const toolCalls = []
  let refusedAll = true
  for (let i = 0; i < scanned; i += 1) {
    const c = plain(rawCalls[i]) === true ? rawCalls[i] : null
    const access = c !== null && c.access === 'read' ? 'read' : 'write'
    const outcome = c !== null && (c.outcome === 'ok' || c.outcome === 'refused-as-write') ? c.outcome : 'error'
    if (access === 'write' && outcome !== 'refused-as-write') refusedAll = false
    if (i < PROOF_TOOL_CALLS_MAX) toolCalls.push({ toolName: (c === null ? '' : scrub(c.toolName, TRIAL_NAME_MAX)) || 'tool', access, outcome })
  }
  // A proof the scan cannot finish is refused rather than believed: the caller must not be able to hide a write past it.
  if (rawCalls.length > scanned) refusedAll = false
  const effects = []
  const seen = new Set()
  const list = Array.isArray(raw.externalEffects) === true ? raw.externalEffects.slice(0, PROOF_EFFECTS_MAX) : []
  for (const item of list) {
    const effect = scrub(item, TRIAL_EFFECT_MAX)
    if (effect === '' || seen.has(effect) === true) continue
    seen.add(effect)
    effects.push(effect)
  }
  const errors = []
  const errs = Array.isArray(raw.errors) === true ? raw.errors.slice(0, PROOF_ERRORS_MAX) : []
  for (const e of errs) {
    if (plain(e) === false) continue
    errors.push({ at: scrub(e.at, 40), where: scrub(e.where, TRIAL_NAME_MAX) || 'tool', message: trialSafeText(e.message, PROOF_TEXT_MAX) })
  }
  const rawOutcome = plain(raw.outcome) === true ? raw.outcome : {}
  const state = rawOutcome.state === 'completed' || rawOutcome.state === 'open' ? rawOutcome.state : 'failed'
  const outcome = { state }
  const code = scrub(rawOutcome.code, TRIAL_CODE_MAX)
  if (code !== '') outcome.code = code
  const message = trialSafeText(rawOutcome.message, PROOF_TEXT_MAX)
  if (message !== '') outcome.message = message
  const proof = {
    runId,
    gateId: scrub(raw.gateId, GATE_ID_MAX),
    startedAt: isoAt(raw.startedAt) || '',
    endedAt: isoAt(raw.endedAt),
    supervised: true,
    sideEffectFree: raw.sideEffectFree === true && refusedAll === true && effects.length === 0,
    toolCalls,
    outcome,
    externalEffects: effects,
    errors,
  }
  // The fingerprint is kept only when it is the one this content produces: a hash that does not match its own proof is
  // a proof that was edited after the fact, so it is dropped and the record reads as unsealed evidence.
  const hash = trialProofHashOf(proof)
  if (raw.proofHash === hash) proof.proofHash = hash
  return proof
}

const trialApprovalOf = (raw) => {
  const a = plain(raw) === true ? raw : {}
  return {
    state: typeof a.state === 'string' && GATE_APPROVAL_STATES.indexOf(a.state) >= 0 ? a.state : 'none',
    at: isoAt(a.at),
  }
}

const trialStaticChecksOf = (raw, fallbackAt) => {
  if (plain(raw) === false) return null
  const verdict = raw.verdict === 'pass' || raw.verdict === 'fail' ? raw.verdict : null
  if (verdict === null) return null
  const findings = []
  const seen = new Set()
  const list = Array.isArray(raw.findings) === true ? raw.findings.slice(0, GATE_FINDINGS_MAX) : []
  for (const f of list) {
    if (plain(f) === false) continue
    const code = scrub(f.code, 80)
    if (code === '' || seen.has(code) === true) continue
    seen.add(code)
    const finding = { code, severity: TRIAL_SEVERITY.indexOf(f.severity) >= 0 ? f.severity : 'info' }
    const field = scrub(f.field, 80)
    if (field !== '') finding.field = field
    finding.message = scrub(f.message, TRIAL_MSG_MAX)
    findings.push(finding)
  }
  // A check block with no usable instant takes the record's own stamp: no field this module emits is ever a non-ISO
  // string, and no time is invented.
  return { ranAt: isoAt(raw.ranAt) || fallbackAt, verdict, findings }
}

const trialRank = (status) => {
  const i = TRIAL_LADDER.indexOf(status)
  return i < 0 ? 0 : i
}

/** The highest status the evidence allows. `activated` is only ever reached from a record that already claimed it. */
const trialCeiling = (staticChecks, trial, passing, approval, claimedActivated, at) => {
  let base = 'draft'
  if (staticChecks !== null) base = staticChecks.verdict === 'fail' ? 'static-failed' : 'static-passed'
  if (trial !== null) base = 'trial-done'
  if (passing === true) base = 'awaiting-approval'
  if (base === 'awaiting-approval' && trialEvidence(trial, approval, at) === true) base = 'approved'
  if (base === 'approved' && claimedActivated === true) base = 'activated'
  return base
}

/** The lower of a stored status and a ceiling. `refused` is orthogonal and terminal. */
const trialStatusOf = (stored, approval, ceiling) => {
  if (approval.state === 'refused') return 'refused'
  if (stored === 'refused') return ceiling // a refusal with no recorded refusal is a claim, not a state
  const s = trialRank(stored)
  const c = trialRank(ceiling)
  return TRIAL_LADDER[s < c ? s : c]
}

/**
 * Stored bytes → a GateRecord capped at what its evidence allows, or null when it is not usable (no automation id, or
 * no ISO timestamp anywhere). `opts.at` is the caller's own instant: a fallback for a stored record whose own stamp is
 * unusable, and the horizon a dated grant is judged against (the store passes its now). A record that CLAIMS
 * `approved`/`activated` without evidence — a sealed proof and a dated grant, neither of them in the future — is
 * capped to `draft`: it did not pass a trial, so it cannot say it did.
 */
export const normalizeGateRecord = (raw, opts) => {
  try { return trialNormalizeGate(raw, opts) } catch (e) { return null }
}

const trialNormalizeGate = (raw, opts) => {
  if (plain(raw) === false) return null
  const automationId = trialAutomationId(raw)
  if (automationId === null) return null
  const o = plain(opts) === true ? opts : {}
  const updatedAt = isoAt(raw.updatedAt) || isoAt(o.at)
  if (updatedAt === null) return null
  const staticChecks = trialStaticChecksOf(raw.staticChecks, updatedAt)
  const trial = normalizeProof(raw.trial)
  const approval = trialApprovalOf(raw.approval)
  const passing = trialPassed(trial)
  // A grant cannot be dated after the caller's own instant when it has one (the store passes its now), nor after the
  // record's own last write when it has not: a future-dated grant is not a decision anybody has made yet.
  const callerAt = isoAt(o.at)
  const horizon = callerAt !== null ? callerAt : updatedAt
  const claimsHigh = typeof raw.status === 'string' && (raw.status === 'approved' || raw.status === 'activated')
  const ceiling = trialCeiling(staticChecks, trial, passing, approval, raw.status === 'activated', horizon)
  let status = trialStatusOf(typeof raw.status === 'string' && GATE_STATUSES.indexOf(raw.status) >= 0 ? raw.status : 'draft', approval, ceiling)
  if (claimsHigh === true && status !== 'refused' && trialEvidence(trial, approval, horizon) === false) status = 'draft'
  return {
    id: ('gate:' + automationId).slice(0, GATE_ID_MAX),
    automationId,
    status,
    staticChecks,
    trial,
    approval,
    updatedAt,
    rev: Number.isSafeInteger(raw.rev) && raw.rev >= 1 ? raw.rev : 1,
  }
}

/** The writer shape: exactly the frozen keys, in their order, and nothing a store cannot hold (a JSON copy). */
export const toStoredGate = (gate) => {
  const g = normalizeGateRecord(gate, {})
  return g === null ? null : JSON.parse(JSON.stringify(g))
}

const trialSameGate = (a, b) => JSON.stringify([a.id, a.automationId, a.status, a.staticChecks, a.trial, a.approval, a.updatedAt]) === JSON.stringify([b.id, b.automationId, b.status, b.staticChecks, b.trial, b.approval, b.updatedAt])

/**
 * Attach a proof to a gate record. Pure: `rev` rises by exactly 1 and only when something changed, so B3 can skip the
 * write. A new proof puts the decision back in front of the person (the rung is the trial rung, never above it).
 */
export const applyTrial = (gate, change) => {
  try {
    const c = plain(change) === true ? change : {}
    const at = isoAt(c.at)
    const base = normalizeGateRecord(gate, { at })
    if (base === null) return null
    const proof = normalizeProof(c.proof)
    const trial = proof !== null ? proof : base.trial
    const passing = trialPassed(trial)
    const ceiling = trialCeiling(base.staticChecks, trial, passing, base.approval, base.status === 'activated', at)
    const candidate = gateStatusAfterTrial(null, trial)
    const next = {
      id: base.id,
      automationId: base.automationId,
      status: TRIAL_LADDER[Math.min(trialRank(candidate), trialRank(ceiling))],
      staticChecks: base.staticChecks,
      trial,
      approval: base.approval,
      updatedAt: at !== null ? at : base.updatedAt,
      rev: base.rev,
    }
    if (trialSameGate(base, next) === true) return base
    next.rev = base.rev + 1
    return next
  } catch (e) {
    return null
  }
}

/**
 * The person is asked: status 'awaiting-approval', approval.state 'asked'. Only on a passing proof, and never over a
 * refusal (a refusal is terminal: asking again would rewrite a decision nobody made twice).
 */
export const askApproval = (gate, change) => {
  try {
    const c = plain(change) === true ? change : {}
    const at = isoAt(c.at)
    if (at === null) return trialRefusal('no-timestamp', 'asking for an approval needs an ISO 8601 timestamp.')
    const base = normalizeGateRecord(gate, { at })
    if (base === null) return trialRefusal('gate-not-ready', 'the gate record is unusable: no automation id, or no timestamp.')
    if (base.approval.state === 'refused') return trialRefusal('gate-not-ready', 'the person already refused this trial: a refusal is terminal.')
    if (trialPassed(base.trial) === false) return trialRefusal('gate-not-ready', 'the proof does not pass: there is nothing to approve.')
    if (base.approval.state === 'granted') return { ok: true, gate: base }
    const next = Object.assign({}, base, { status: 'awaiting-approval', approval: { state: 'asked', at }, updatedAt: at })
    if (trialSameGate(base, next) === true) return { ok: true, gate: base }
    next.rev = base.rev + 1
    return { ok: true, gate: next }
  } catch (e) {
    return trialRefusal('gate-not-ready', 'the approval could not be asked.')
  }
}

/** The person refused: status 'refused', approval.state 'refused'. A refusal is recorded at any rung, and it is final. */
export const refuseApproval = (gate, change) => {
  try {
    const c = plain(change) === true ? change : {}
    const base = normalizeGateRecord(gate, { at: isoAt(c.at) })
    if (base === null) return null
    const at = isoAt(c.at)
    const next = Object.assign({}, base, {
      status: 'refused',
      approval: { state: 'refused', at: at !== null ? at : base.approval.at },
      updatedAt: at !== null ? at : base.updatedAt,
      rev: base.rev,
    })
    if (trialSameGate(base, next) === true) return base
    next.rev = base.rev + 1
    return next
  } catch (e) {
    return null
  }
}

/**
 * The single activation predicate of the lot. B3 consults it before switching a gated automation on AND before
 * letting it run, so "may it be switched on" and "may it run" are one question with one answer. A record that has not
 * climbed the ladder (B3 reads through `normalizeGateRecord`, which caps it) can never answer true, and an absent or
 * unreadable record answers false: fail closed, never open. A sealed proof is required, so a record that only reads
 * like an approval — no trial reference, no fingerprint — never activates anything.
 */
export const mayActivate = (gate) => {
  try {
    if (plain(gate) === false) return false
    if (gate.status !== 'approved' && gate.status !== 'activated') return false
    const proof = normalizeProof(gate.trial)
    if (proof === null || trialPassed(proof) === false) return false
    const approval = trialApprovalOf(gate.approval)
    return trialEvidence(proof, approval, null)
  } catch (e) {
    return false
  }
}
