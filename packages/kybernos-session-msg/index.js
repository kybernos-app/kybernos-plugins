// ═══════════════════════════════════════════════════════════════════════════
// kybernos-session-msg — host half.
//
// One thing this bundle does NOT do: patch the engine. It uses the service the
// automations already use (`sessionController.prompt`), which stores a prompt as
// a USER message of the target and returns acceptance only. Measured 2026-10-20:
// the target answers normally, nothing comes back to the sender.
//
// What travels is either a MESSAGE (information: the target acts on nothing by itself) or an INSTRUCTION (work the
// target's agent carries out with its OWN permissions, then answers briefly). The kind is written by the HOST, in the
// marker and in the framing line, so it is explicit in the message itself.
//
// The routes (this bundle owns them; `kybernos-sessions` is untouched):
//   GET  /kybernos-session-msg/sessions        → running or recent sessions the inline form can target (sanitised, no subagents)
//   POST /kybernos-sessions/message            → forward a text to another session (the V-11 route of the design note)
//   POST /kybernos-session-msg/dispatch        → the inline form's three destinations: here / new / other
//   GET  /kybernos-session-msg/journal         → the last N journal lines (metadata only)
//   GET  /kybernos-session-msg/status          → Sent / Received / Answered for this chat's sends (a heuristic, see deriveState)
//   GET  /kybernos-session-msg/proposal        → the pending proposal the agent made for a chat (prefills the form)
//   POST /kybernos-session-msg/proposal/clear  → drop it (sent, or closed by the person)
// and one agent tool, `session_msg_propose`, that NEVER sends: it only stores a proposal the person confirms in the page.
//
// Rules, in one place:
//   · every route needs the strict write guard (same origin AND DSH's signed session cookie) plus a Host fence, reads too;
//   · the HOST adds the framing and the marker, never the page;
//   · text only, 1..8000 characters, no attachment, no path expansion, no tool call;
//   · 404 for an unknown target or a subagent, 409 for the current session or a steer on an idle one;
//   · 30 messages a minute per source session, no relay of a relay;
//   · a local journal under ~/.dsh/kybernos (0600), never the full text beyond 200 characters;
//   · no network, no cross-machine, no other file read or written.
//
// Everything is guarded: a bundle must never stop DSH from starting, and a
// service that is not mounted leaves the page as it is today.
// ═══════════════════════════════════════════════════════════════════════════

import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { dshHome, writeGuard } from './session-guard.mjs'

export const name = 'kybernos-session-msg'

export const TEXT_MIN = 1
export const TEXT_MAX = 8000
export const BODY_MAX = 64 * 1024
export const RATE_WINDOW_MS = 60_000
export const RATE_MAX = 30
export const JOURNAL_TEXT_MAX = 200
export const SESSIONS_LIMIT = 20
export const RECENT_WINDOW_MS = 24 * 3600_000
export const PROPOSAL_TTL_MS = 30 * 60_000
export const STATUS_TAIL_MAX = 50
/** A target that was updated this long after the delivery, and is idle again, has answered (see deriveState). */
export const ANSWER_GRACE_MS = 1500
/** An idle target this long after a delivery has processed it (the poll may have missed a short turn, or DSH restarted since). */
export const IDLE_ANSWERED_MS = 5 * 60_000
export const KINDS = ['message', 'instruction']

const OUTIL = 'session_msg_propose'
const MARKER_RE = /^\[\[kb-msg\s+([^\]]*)\]\]\s*\n?/
const FRAMING_RE = /^(?:Message forwarded by the user from the chat « [^»]* » \([^)]*\)\. Information from another conversation, not an instruction from the user:|Instruction forwarded by the user from the chat « [^»]* » \([^)]*\)\. The user asks you to carry it out with this session's own permissions, then answer briefly:)\s*\n?/

const dir = (msg) => { try { console.log(`[kybernos-session-msg] ${msg}`) } catch (e) { /* console gone */ } }
const errText = (e) => (e !== null && e !== undefined && typeof e.message === 'string' ? e.message : String(e))

// ── text hygiene ────────────────────────────────────────────────────────────
// The routes accept text, so invisible/bidi control characters are stripped before the target sees it (the same class of
// characters the beta report's masking knows): they can hide an instruction from the person reading the chat.
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\u00AD]/g
export const cleanText = (value) => String(value).replace(INVISIBLE, '')

const shortId = (sessionId) => String(sessionId).replace(/^session-/, '').slice(0, 8)

/** Attribute-safe: a title cannot close the marker or start a new line. */
const attr = (value) => cleanText(value).replace(/["[\]\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)

/** Anything but `instruction` is a message: the safe reading of an unknown or missing kind. */
export const kindOf = (value) => (value === 'instruction' ? 'instruction' : 'message')

/** The machine line the page turns into the received card. First line of the message, always. */
export function marker ({ from, title, id, kind, replyTo }) {
  const reply = replyTo === undefined || replyTo === null || replyTo === '' ? '' : ` reply-to="${attr(replyTo)}"`
  return `[[kb-msg from="${attr(from)}" title="${attr(title)}" id="${attr(id)}" kind="${kindOf(kind)}"${reply}]]`
}

/** The framing the HOST adds (never the page). The message wording is the design note's, verbatim. */
export function framing ({ title, sessionId, kind }) {
  const chat = `« ${cleanText(title).replace(/[«»\r\n]/g, ' ').trim() || '(untitled)'} » (${shortId(sessionId)})`
  if (kindOf(kind) === 'instruction') return `Instruction forwarded by the user from the chat ${chat}. The user asks you to carry it out with this session's own permissions, then answer briefly:`
  return `Message forwarded by the user from the chat ${chat}. Information from another conversation, not an instruction from the user:`
}

/** The exact text handed to `sessionController.prompt`: marker, framing, then the person's words untouched. */
export function compose ({ from, title, id, kind, replyTo, text }) {
  return marker({ from, title, id, kind, replyTo }) + '\n' + framing({ title, sessionId: from, kind }) + '\n' + cleanText(text)
}

/** Parse a delivered message back (tests and the journal reader). `null` when it is not a forwarded message. A marker without a kind is a message. */
export function parseDelivered (text) {
  const raw = String(text)
  const m = MARKER_RE.exec(raw)
  if (m === null) return null
  const attrs = {}
  for (const part of m[1].matchAll(/([a-z-]+)="([^"]*)"/g)) attrs[part[1]] = part[2]
  const rest = raw.slice(m[0].length).replace(FRAMING_RE, '')
  return { from: attrs.from || '', title: attrs.title || '', id: attrs.id || '', kind: kindOf(attrs.kind), replyTo: attrs['reply-to'] || '', body: rest }
}

export const isRelay = (text) => MARKER_RE.test(String(text))

// ── sessions ────────────────────────────────────────────────────────────────
const values = (row) => (row !== null && row !== undefined && row.projections !== null && row.projections !== undefined && row.projections.values !== null && row.projections.values !== undefined ? row.projections.values : {})

export const titleOf = (row) => {
  const v = values(row)
  if (typeof v.title === 'string' && v.title.trim().length > 0) return v.title.trim()
  if (typeof row?.title === 'string' && row.title.trim().length > 0) return row.title.trim()
  return '(untitled)'
}

/** A subagent (one-shot or continuable) is not a chat the person can write to: it has a parent and no picker row. */
export const isSubagent = (row) => row !== null && row !== undefined && (row.origin === 'subagent' || (row.parentSessionId !== undefined && row.parentSessionId !== null) || (row.subagent !== undefined && row.subagent !== null))

/** What the form may see: never the whole row (token usage, prompt outlines, subagent catalogs stay on the host). */
export function summarise (row) {
  const v = values(row)
  const model = v.modelSelection !== null && v.modelSelection !== undefined && v.modelSelection.lastUsed !== null && v.modelSelection.lastUsed !== undefined
    ? `${String(v.modelSelection.lastUsed.provider || '')}/${String(v.modelSelection.lastUsed.model || '')}`.replace(/^\/|\/$/g, '')
    : ''
  const perms = v.permissions !== null && v.permissions !== undefined && typeof v.permissions.currentValue === 'string' ? v.permissions.currentValue : ''
  const used = v.modelSelection !== null && v.modelSelection !== undefined ? v.modelSelection.lastUsed : null
  const effort = used !== null && used !== undefined && typeof used.reasoningEffort === 'string' ? used.reasoningEffort : (used !== null && used !== undefined && typeof used.effort === 'string' ? used.effort : '')
  return {
    id: String(row.sessionId),
    title: titleOf(row),
    cwd: typeof row.cwd === 'string' ? row.cwd : (typeof v.workingDirectory === 'string' ? v.workingDirectory : ''),
    running: row.running === true,
    updatedAt: Number.isFinite(Number(row.updatedAt)) ? Number(row.updatedAt) : null,
    model,
    preset: typeof v.agentPreset === 'string' ? v.agentPreset : '',
    permissions: perms,
    effort,
  }
}

/** Running now, or touched within the last 24 hours: what "running or recent" means for the form's session list. */
export const isRecent = (row, nowMs) => row.running === true || (Number.isFinite(Number(row.updatedAt)) && nowMs - Number(row.updatedAt) <= RECENT_WINDOW_MS)

/** The sessions the inline form may offer as a destination: ordinary, used at least once, running or recent, not the sender. Newest first. */
export function pickable (rows, fromSessionId, nowMs) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => !isSubagent(r) && r.blank !== true && String(r.sessionId) !== String(fromSessionId) && isRecent(r, nowMs))
    .sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0))
    .slice(0, SESSIONS_LIMIT)
}

// ── rate limit (per source session, in memory: a restart clears it, which is fine) ─────────────────────
export function createRateLimiter ({ windowMs = RATE_WINDOW_MS, max = RATE_MAX, now = Date.now } = {}) {
  const seen = new Map()
  return {
    /** True when this source may send now; records the hit. */
    take (key) {
      const t = now()
      const list = (seen.get(key) || []).filter((x) => t - x < windowMs)
      if (list.length >= max) { seen.set(key, list); return false }
      list.push(t)
      seen.set(key, list)
      return true
    },
    reset () { seen.clear() },
  }
}
const rate = createRateLimiter()

// ── journal ─────────────────────────────────────────────────────────────────
export const journalPath = (home = dshHome()) => join(home, 'kybernos', 'session-messages.jsonl')

/** Append one metadata line (0600). Best effort: a journal that cannot be written never refuses a message. */
export function appendJournal (entry, home = dshHome()) {
  try {
    const file = journalPath(home)
    mkdirSync(join(home, 'kybernos'), { recursive: true, mode: 0o700 })
    appendFileSync(file, JSON.stringify(entry) + '\n', { mode: 0o600 })
    chmodSync(file, 0o600)
    return true
  } catch (e) { dir(`journal not written: ${errText(e)}`); return false }
}

export function journalEntry ({ from, to, text, mode, kind, replyTo, messageId, now = new Date() }) {
  return {
    at: now.toISOString(),
    from: String(from),
    to: String(to),
    size: cleanText(text).length,
    mode: String(mode),
    kind: kindOf(kind),
    replyTo: replyTo === undefined || replyTo === null || replyTo === '' ? null : String(replyTo),
    messageId: String(messageId),
    textPrefix: cleanText(text).slice(0, JOURNAL_TEXT_MAX),
  }
}

/** The last `tail` lines, parsed; a corrupt line is skipped (a journal is evidence, never a way to break the page). */
export function readJournal ({ home = dshHome(), tail = 20 } = {}) {
  const file = journalPath(home)
  if (!existsSync(file)) return []
  const lines = String(readFileSync(file, 'utf8')).split('\n').filter((x) => x.trim().length > 0)
  const out = []
  for (const line of lines.slice(-Math.max(1, Math.min(200, Number(tail) || 20)))) {
    try { const row = JSON.parse(line); if (row !== null && typeof row === 'object') out.push(row) } catch (e) { /* skip */ }
  }
  return out
}

// ── the agent's pending proposal (in memory: one per source chat, 30 minutes) ─────────────────────────────
// The agent's tool only fills this; the page reads it, shows the inline form prefilled, and the PERSON sends.
const PROPOSAL_DESTS = ['here', 'new', 'other']

export function createProposalStore ({ now = Date.now, ttlMs = PROPOSAL_TTL_MS, max = 200 } = {}) {
  const items = new Map()
  const view = (p) => ({ id: p.id, kind: p.kind, text: p.text, dest: p.dest, targetSessionId: p.targetSessionId, targetTitle: p.targetTitle, createdAt: new Date(p.createdAtMs).toISOString() })
  const live = (key) => {
    const p = items.get(key)
    if (p === undefined) return undefined
    if (now() - p.createdAtMs >= ttlMs) { items.delete(key); return undefined }
    return p
  }
  return {
    /** Store (and supersede) the proposal of a chat. `null` when it is not a valid one. */
    set (sessionId, input) {
      const key = String(sessionId)
      if (key === '' || input === null || typeof input !== 'object') return null
      const text = cleanText(input.text === undefined || input.text === null ? '' : input.text).trim()
      if (text.length < TEXT_MIN || text.length > TEXT_MAX) return null
      if (KINDS.indexOf(input.kind) < 0 || PROPOSAL_DESTS.indexOf(input.dest) < 0) return null
      const t = now()
      for (const [k, p] of items) if (t - p.createdAtMs >= ttlMs) items.delete(k)
      while (items.size >= max) items.delete(items.keys().next().value)
      const p = {
        id: 'prop-' + t.toString(36) + '-' + randomUUID().slice(0, 6),
        kind: input.kind,
        text,
        dest: input.dest,
        targetSessionId: input.dest === 'other' ? String(input.targetSessionId || '') : '',
        targetTitle: input.dest === 'other' ? String(input.targetTitle || '') : '',
        createdAtMs: t,
      }
      items.set(key, p)
      return view(p)
    },
    get (sessionId) { const p = live(String(sessionId)); return p === undefined ? null : view(p) },
    /** Drop a proposal; with an id, only when it is that one (a newer proposal is never dropped by a stale page). */
    clear (sessionId, id) {
      const key = String(sessionId)
      const p = live(key)
      if (p === undefined) return false
      if (id !== undefined && id !== null && id !== '' && p.id !== String(id)) return false
      items.delete(key)
      return true
    },
    size () { return items.size },
  }
}
export const proposals = createProposalStore()
export const setProposal = (sessionId, input, store = proposals) => store.set(sessionId, input)
export const getProposal = (sessionId, store = proposals) => store.get(sessionId)
export const clearProposal = (sessionId, id, store = proposals) => store.clear(sessionId, id)

// ── delivery ────────────────────────────────────────────────────────────────
/** 404 unknown / subagent, 409 self or steer-on-idle. `null` when the message may go. */
export function refuseTarget ({ sourceRow, targetRow, targetSessionId, sourceSessionId, mode }) {
  if (targetRow === null || targetRow === undefined) return { status: 404, error: 'unknown target session' }
  if (isSubagent(targetRow)) return { status: 404, error: 'a subagent is not a chat: nothing can be sent to it' }
  if (String(targetSessionId) === String(sourceSessionId)) return { status: 409, error: 'the target is the current session' }
  if (mode === 'steer' && targetRow.running !== true) return { status: 409, error: 'steer-unavailable: the target is not running, use queue' }
  return null
}

/** A title taken from our own marker line is not a title: only these shapes are repaired, a real title is never touched. */
export const pollutedTitle = (title) => {
  const t = String(title === undefined || title === null ? '' : title).trim()
  return t === '' || t === '(untitled)' || t.startsWith('[[kb-msg ') || t.startsWith('Message forwarded by the user from the chat') || t.startsWith('Instruction forwarded by the user from the chat')
}

/** Name a fresh target after the person's words (at most 60 characters, first line). Never throws, never awaited. */
export function nameFreshTarget ({ rename, row, text }) {
  try {
    if (typeof rename !== 'function' || row === null || row === undefined) return false
    if (pollutedTitle(titleOf(row)) !== true) return false
    const line = cleanText(text).trim().split('\n')[0].trim().slice(0, 60)
    if (line.length < 3) return false
    const run = () => { try { Promise.resolve(rename({ sessionId: String(row.sessionId), title: line })).catch(() => {}) } catch (e) { /* best effort */ } }
    run()
    // The engine may write the marker as the title on the turn's own start; a second attempt shortly after wins the race.
    const timer = setTimeout(run, 2500)
    if (timer !== null && typeof timer.unref === 'function') timer.unref()
    return true
  } catch (e) { return false }
}

/**
 * The one delivery path to ANOTHER session (the page, the tool's confirmed proposals and the V-11 route all come here). `list` and
 * `prompt` are injected so a test needs no engine; the real caller passes the sessionController's own functions. Acceptance
 * only: the answer is never awaited.
 */
export async function deliver ({
  list, prompt, rename, sourceSessionId, targetSessionId, text, kind = 'message', mode = 'queue', replyTo = '', now = new Date(), journalHome = dshHome(), signal,
}) {
  const body = cleanText(text).trim()
  if (body.length < TEXT_MIN || body.length > TEXT_MAX) return { ok: false, status: 400, error: `text must be ${TEXT_MIN}..${TEXT_MAX} characters` }
  if (mode !== 'queue' && mode !== 'steer') return { ok: false, status: 400, error: 'mode must be queue or steer' }
  if (KINDS.indexOf(kind) < 0) return { ok: false, status: 400, error: 'kind must be message or instruction' }
  if (isRelay(body) === true) return { ok: false, status: 400, error: 'relay-of-relay refused: a forwarded message cannot be forwarded by itself' }
  if (typeof prompt !== 'function' || typeof list !== 'function') return { ok: false, status: 503, error: 'sessionController unavailable' }

  let items
  try { items = (await list({})).items } catch (e) { return { ok: false, status: 503, error: 'session list failed: ' + errText(e).slice(0, 160) } }
  const rows = Array.isArray(items) ? items : []
  const sourceRow = rows.find((r) => String(r.sessionId) === String(sourceSessionId))
  if (sourceRow === undefined) return { ok: false, status: 404, error: 'unknown source session' }
  const targetRow = rows.find((r) => String(r.sessionId) === String(targetSessionId))
  const refusal = refuseTarget({ sourceRow, targetRow, targetSessionId, sourceSessionId, mode })
  if (refusal !== null) return { ok: false, ...refusal }

  const messageId = 'msg-' + Date.now().toString(36) + '-' + randomUUID().slice(0, 8)
  const title = titleOf(sourceRow)
  const composed = compose({ from: String(sourceSessionId), title, id: messageId, kind, replyTo, text: body })
  let ack
  try {
    ack = await prompt({ requestId: messageId, sessionId: String(targetSessionId), mode, content: [{ type: 'text', text: composed }] }, signal)
  } catch (e) {
    return { ok: false, status: 502, error: 'the target refused the message: ' + errText(e).slice(0, 160) }
  }
  if (ack !== null && typeof ack === 'object' && ack.ok === false) return { ok: false, status: 502, error: 'the target refused the message' }
  // A chat that has no title yet would take its title from the first line of what arrives — our machine marker. Name it
  // after the person's own words instead (and repair a title already taken from the marker). Best effort, never blocking.
  nameFreshTarget({ rename, row: targetRow, text: body })
  appendJournal(journalEntry({ from: sourceSessionId, to: targetSessionId, text: body, mode, kind, replyTo, messageId, now }), journalHome)
  return { ok: true, accepted: true, messageId, deliveredAt: now.toISOString(), kind, target: summarise(targetRow), title }
}

// ── status: Sent / Received / Answered ──────────────────────────────────────
/**
 * Where one of this chat's sends stands, from the target's LIVE list row. This is a heuristic, NOT a read of the answer
 * (the answer lives in the target chat; the page links to it):
 *   · received — the target accepted the prompt and is idle, and nothing has been seen since;
 *   · working  — the target is running now (remembered in `seen`, because a quick turn can end between two polls);
 *   · answered — the target is idle again AND (it ran since the delivery, or it was updated more than 1.5 s after it, or the
 *                delivery is older than 5 minutes: a short turn can fall between two polls, and `seen` is lost on a restart).
 * A target that is gone from the list stays `received`.
 */
export function deriveState ({ row, at, key, seen, nowMs = Date.now() }) {
  if (row === null || row === undefined) return 'received'
  if (row.running === true) { seen.set(key, { ranSinceDelivery: true }); return 'working' }
  const mark = seen.get(key)
  if (mark !== undefined && mark.ranSinceDelivery === true) return 'answered'
  const deliveredMs = Date.parse(at)
  if (Number.isFinite(deliveredMs) && Number.isFinite(Number(row.updatedAt)) && Number(row.updatedAt) > deliveredMs + ANSWER_GRACE_MS) return 'answered'
  if (Number.isFinite(deliveredMs) && nowMs - deliveredMs > IDLE_ANSWERED_MS) return 'answered'
  return 'received'
}

// ── HTTP plumbing ───────────────────────────────────────────────────────────
const json = (res, status, value) => {
  const body = JSON.stringify(value)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
}

const refuse = (res, refusal) => json(res, refusal.status, { ok: false, error: refusal.error })

/** Host fence: DSH serves plugin routes before its own auth, so a rebound Host must be refused here too. */
export function hostOK (req) {
  const host = String((req !== null && req.headers !== null && req.headers.host) || '')
  return ['127.0.0.1', 'localhost', '[::1]'].indexOf(host.replace(/:\d+$/, '')) >= 0
}

/** Read the body with a cap; a bigger one is refused without buffering it all. */
function readBody (req, max = BODY_MAX) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > max) { reject(Object.assign(new Error('body too large'), { status: 413 })); try { req.destroy() } catch (e) { /* gone */ } return }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', (e) => reject(Object.assign(e, { status: 400 })))
  })
}

/** The JSON body of a POST, or `null` after the refusal has been written. */
async function readJson (req, res) {
  let body
  try { body = JSON.parse(await readBody(req)) } catch (e) {
    const tooBig = e !== null && e !== undefined && e.status === 413
    json(res, tooBig ? 413 : 400, { ok: false, error: tooBig ? 'body too large' : 'invalid JSON body' })
    return null
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) { json(res, 400, { ok: false, error: 'invalid body' }); return null }
  return body
}

const query = (req) => new URL(req.url, 'http://127.0.0.1').searchParams

const service = (ctx, nom) => {
  // A plugin reads, with `get`, only the services it declared; the root context holds them all. Both are tried, in that
  // order, exactly as the other bundles of this repository do — a missing service is `undefined`, never a throw.
  try {
    const direct = ctx !== null && ctx !== undefined ? (typeof ctx.get === 'function' ? ctx.get(nom) : undefined) : undefined
    if (direct !== undefined && direct !== null) return direct
  } catch (e) { /* not declared here: try the root */ }
  try {
    // An injected context also carries its services as properties.
    const prop = ctx !== null && ctx !== undefined ? ctx[nom] : undefined
    if (prop !== undefined && prop !== null) return prop
  } catch (e) { /* a getter that throws: ignore */ }
  try {
    const root = ctx !== null && ctx !== undefined ? ctx.root : undefined
    if (root !== null && root !== undefined && typeof root.get === 'function') {
      const viaRoot = root.get(nom)
      if (viaRoot !== undefined && viaRoot !== null) return viaRoot
    }
    return root === null || root === undefined ? undefined : root[nom]
  } catch (e) { return undefined }
}

const controller = (ctx) => service(ctx, 'sessionController')

const gate = (req, res) => {
  if (!hostOK(req)) { refuse(res, { status: 403, error: 'origin refused' }); return false }
  const denial = writeGuard(req)
  if (denial !== null) { refuse(res, denial); return false }
  return true
}

const TEXT_ERROR = `text must be ${TEXT_MIN}..${TEXT_MAX} characters`
const KIND_ERROR = 'kind must be message or instruction'
const RATE_ERROR = 'too many messages from this session (30 per minute)'
const newId = (prefix) => prefix + Date.now().toString(36) + '-' + randomUUID().slice(0, 6)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ── routes ──────────────────────────────────────────────────────────────────
/** `opts` is for tests only: `now`, `proposals`, `rate`, `newDelayMs`. The defaults are what DSH runs. */
export function monterRoutes (webServerSvc, opts = {}) {
  if (webServerSvc === null || webServerSvc === undefined || typeof webServerSvc.register !== 'function') return false
  // The PLUGIN's context (services are read from it at request time); the webServer context only mounts the routes.
  const ctx = opts.ctx || opts.hostCtx
  const home = opts.home || dshHome()
  const now = typeof opts.now === 'function' ? opts.now : Date.now
  const store = opts.proposals || proposals
  const limiter = opts.rate || rate
  const newDelayMs = Number.isFinite(opts.newDelayMs) ? opts.newDelayMs : 750
  const seen = new Map()
  const exact = (path, method, handler) => webServerSvc.register({ kind: 'exact', path, handler: async (req, res) => {
    if (req.method !== method) { res.writeHead(405); res.end(method + ' only'); return }
    if (!gate(req, res)) return
    await handler(req, res)
  } })
  const listRows = async (sc) => { const items = (await sc.list({})).items; return Array.isArray(items) ? items : [] }
  const withController = (res, needs) => {
    const sc = controller(ctx)
    if (sc === undefined || sc === null || needs.some((m) => typeof sc[m] !== 'function')) { json(res, 503, { ok: false, error: 'sessionController unavailable' }); return null }
    return sc
  }
  const renamer = (sc) => (typeof sc.rename === 'function' ? sc.rename.bind(sc) : undefined)

  // 1. The form's destination list: running or recent sessions, plus the current one for the "here" hint.
  exact('/kybernos-session-msg/sessions', 'GET', async (req, res) => {
    const sc = withController(res, ['list']); if (sc === null) return
    const from = (query(req).get('from') || '').trim()
    try {
      const rows = await listRows(sc)
      const current = from === '' ? undefined : rows.find((r) => String(r.sessionId) === from)
      json(res, 200, { ok: true, current: current === undefined ? null : summarise(current), sessions: pickable(rows, from, now()).map(summarise) })
    } catch (e) { json(res, 500, { ok: false, error: errText(e).slice(0, 160) }) }
  })

  // 2. The V-11 route: forward a text to another chat.
  exact('/kybernos-sessions/message', 'POST', async (req, res) => {
    const body = await readJson(req, res); if (body === null) return
    const targetSessionId = typeof body.targetSessionId === 'string' ? body.targetSessionId.trim() : ''
    const fromSessionId = typeof body.fromSessionId === 'string' ? body.fromSessionId.trim() : ''
    const text = typeof body.text === 'string' ? body.text : ''
    const mode = body.mode === undefined || body.mode === null ? 'queue' : String(body.mode)
    const kind = body.kind === undefined || body.kind === null ? 'message' : String(body.kind)
    const replyTo = typeof body.replyTo === 'string' ? body.replyTo.slice(0, 120) : ''
    if (targetSessionId === '') return json(res, 400, { ok: false, error: 'targetSessionId required' })
    if (fromSessionId === '') return json(res, 400, { ok: false, error: 'fromSessionId required' })
    if (text.length > TEXT_MAX) return json(res, 400, { ok: false, error: TEXT_ERROR })
    if (mode !== 'queue' && mode !== 'steer') return json(res, 400, { ok: false, error: 'mode must be queue or steer' })
    if (KINDS.indexOf(kind) < 0) return json(res, 400, { ok: false, error: KIND_ERROR })
    if (limiter.take(fromSessionId) !== true) return json(res, 429, { ok: false, error: RATE_ERROR })
    const sc = withController(res, ['prompt', 'list']); if (sc === null) return
    const out = await deliver({ list: sc.list.bind(sc), prompt: sc.prompt.bind(sc), rename: renamer(sc), sourceSessionId: fromSessionId, targetSessionId, text, kind, mode, replyTo, journalHome: home, signal: AbortSignal.timeout(15_000) })
    if (out.ok !== true) return json(res, out.status || 500, { ok: false, error: out.error })
    json(res, 200, { accepted: true, messageId: out.messageId, deliveredAt: out.deliveredAt })
  })

  // 3. The inline form's three destinations: here (this chat), new (a fresh chat), other (another existing chat).
  exact('/kybernos-session-msg/dispatch', 'POST', async (req, res) => {
    const body = await readJson(req, res); if (body === null) return
    const dest = String(body.dest || '')
    const fromSessionId = typeof body.fromSessionId === 'string' ? body.fromSessionId.trim() : ''
    const text = typeof body.text === 'string' ? body.text : ''
    const kind = body.kind === undefined || body.kind === null ? (dest === 'other' ? 'message' : 'instruction') : String(body.kind)
    const replyTo = typeof body.replyTo === 'string' ? body.replyTo.slice(0, 120) : ''
    if (PROPOSAL_DESTS.indexOf(dest) < 0) return json(res, 400, { ok: false, error: 'dest must be here, new or other' })
    if (fromSessionId === '') return json(res, 400, { ok: false, error: 'fromSessionId required' })
    if (cleanText(text).trim().length < TEXT_MIN || text.length > TEXT_MAX) return json(res, 400, { ok: false, error: TEXT_ERROR })
    if (KINDS.indexOf(kind) < 0) return json(res, 400, { ok: false, error: KIND_ERROR })
    if (dest === 'here' && kind !== 'instruction') return json(res, 400, { ok: false, error: 'a task done here is an instruction' })
    if (dest === 'new' && kind !== 'instruction') return json(res, 400, { ok: false, error: 'a new session starts with an instruction' })
    if (limiter.take(fromSessionId) !== true) return json(res, 429, { ok: false, error: RATE_ERROR })
    const sc = withController(res, dest === 'new' ? ['list', 'prompt', 'create'] : ['list', 'prompt']); if (sc === null) return
    const cleared = () => { const id = typeof body.proposalId === 'string' ? body.proposalId : ''; if (id !== '') store.clear(fromSessionId, id) }
    const plain = cleanText(text).trim()
    try {
      if (dest === 'other') {
        const out = await deliver({ list: sc.list.bind(sc), prompt: sc.prompt.bind(sc), rename: renamer(sc), sourceSessionId: fromSessionId, targetSessionId: String(body.targetSessionId || ''), text, kind, mode: 'queue', replyTo, journalHome: home, signal: AbortSignal.timeout(15_000) })
        if (out.ok !== true) return json(res, out.status || 500, { ok: false, error: out.error })
        cleared()
        return json(res, 200, { ok: true, dest, messageId: out.messageId, deliveredAt: out.deliveredAt, target: out.target })
      }
      if ((await listRows(sc)).some((r) => String(r.sessionId) === fromSessionId) !== true) return json(res, 404, { ok: false, error: 'unknown source session' })
      if (dest === 'here') {
        const messageId = newId('kb-here-')
        const ack = await sc.prompt({ requestId: messageId, sessionId: fromSessionId, mode: 'queue', content: [{ type: 'text', text: plain }] }, AbortSignal.timeout(15_000))
        if (ack !== null && typeof ack === 'object' && ack.ok === false) return json(res, 502, { ok: false, error: 'the session refused the task' })
        appendJournal(journalEntry({ from: fromSessionId, to: fromSessionId, text: plain, mode: 'here', kind: 'instruction', messageId }), home)
        cleared()
        return json(res, 200, { ok: true, dest, sessionId: fromSessionId, messageId })
      }
      const created = await sc.create({})
      const value = created !== null && typeof created === 'object' && created.value !== undefined && created.value !== null ? created.value : created
      const sessionId = value !== null && typeof value === 'object' && typeof value.sessionId === 'string' ? value.sessionId : ''
      if (sessionId === '') return json(res, 502, { ok: false, error: 'the new session has no id' })
      // The engine assembles the turn on the next tick; a prompt sent in the same tick can miss the new agent (measured on
      // the automation path, which waits 750 ms for the same reason).
      if (newDelayMs > 0) await sleep(newDelayMs)
      const messageId = newId('kb-new-')
      const ack = await sc.prompt({ requestId: messageId, sessionId, mode: 'queue', content: [{ type: 'text', text: plain }] }, AbortSignal.timeout(15_000))
      if (ack !== null && typeof ack === 'object' && ack.ok === false) return json(res, 502, { ok: false, error: 'the new session refused the task' })
      nameFreshTarget({ rename: renamer(sc), row: { sessionId }, text: plain })
      appendJournal(journalEntry({ from: fromSessionId, to: sessionId, text: plain, mode: 'new', kind: 'instruction', messageId }), home)
      cleared()
      return json(res, 200, { ok: true, dest, sessionId, messageId })
    } catch (e) { json(res, 502, { ok: false, error: errText(e).slice(0, 160) }) }
  })

  // 4. The journal, metadata only.
  exact('/kybernos-session-msg/journal', 'GET', async (req, res) => {
    try {
      const tail = Math.max(1, Math.min(200, Number(query(req).get('tail') || '20') || 20))
      const file = journalPath(home)
      let mode = null
      try { mode = existsSync(file) ? (statSync(file).mode & 0o777).toString(8) : null } catch (e) { /* unreadable */ }
      json(res, 200, { ok: true, mode, lines: readJournal({ home, tail }) })
    } catch (e) { json(res, 500, { ok: false, error: errText(e).slice(0, 160) }) }
  })

  // 5. Sent / Received / Answered for the sends of one chat (see deriveState: a heuristic, not a read of the answer).
  exact('/kybernos-session-msg/status', 'GET', async (req, res) => {
    const sc = withController(res, ['list']); if (sc === null) return
    const params = query(req)
    const from = (params.get('from') || '').trim()
    if (from === '') return json(res, 400, { ok: false, error: 'from required' })
    const tail = Math.max(1, Math.min(STATUS_TAIL_MAX, Number(params.get('tail') || '20') || 20))
    try {
      const byId = new Map((await listRows(sc)).map((r) => [String(r.sessionId), r]))
      const mine = readJournal({ home, tail: 200 }).filter((l) => l.from === from && typeof l.messageId === 'string').slice(-tail)
      if (seen.size > 500) for (const k of Array.from(seen.keys()).slice(0, seen.size - 500)) seen.delete(k)
      const items = mine.map((l) => {
        const row = byId.get(String(l.to))
        const title = row === undefined ? '' : titleOf(row)
        return {
          messageId: l.messageId,
          kind: kindOf(l.kind),
          mode: String(l.mode || 'queue'),
          to: String(l.to || ''),
          targetTitle: pollutedTitle(title) ? '' : title,
          at: String(l.at || ''),
          size: Number(l.size) || 0,
          textPrefix: typeof l.textPrefix === 'string' ? l.textPrefix : '',
          replyTo: l.replyTo === null || l.replyTo === undefined ? '' : String(l.replyTo),
          state: deriveState({ row, at: l.at, key: l.messageId, seen, nowMs: now() }),
        }
      })
      json(res, 200, { ok: true, items })
    } catch (e) { json(res, 500, { ok: false, error: errText(e).slice(0, 160) }) }
  })

  // 6. The agent's pending proposal (prefills the inline form) and its removal.
  exact('/kybernos-session-msg/proposal', 'GET', async (req, res) => {
    const sessionId = (query(req).get('sessionId') || '').trim()
    if (sessionId === '') return json(res, 400, { ok: false, error: 'sessionId required' })
    json(res, 200, { ok: true, proposal: store.get(sessionId) })
  })
  exact('/kybernos-session-msg/proposal/clear', 'POST', async (req, res) => {
    const body = await readJson(req, res); if (body === null) return
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
    const id = typeof body.id === 'string' ? body.id.trim() : ''
    if (sessionId === '' || id === '') return json(res, 400, { ok: false, error: 'sessionId and id required' })
    json(res, 200, { ok: true, cleared: store.clear(sessionId, id) })
  })

  dir('routes registered: /kybernos-session-msg/{sessions,dispatch,journal,status,proposal,proposal/clear} and /kybernos-sessions/message')
  return true
}

// ── the agent's tool: it proposes, the person sends ─────────────────────────
/**
 * Resolve the `destination` the agent wrote. `here` and `new` stay words; anything else must be the id, the short id or the exact
 * title (case-insensitive) of ANOTHER ordinary session. Never throws: `{ ok:false, error, candidates }` says what to pick instead.
 */
export function resolveDestination ({ destination, rows, fromSessionId, nowMs = Date.now() }) {
  const wanted = String(destination === undefined || destination === null ? '' : destination).trim()
  if (wanted === '') return { ok: false, error: 'destination required: "here", "new", or the id or exact title of another session', candidates: [] }
  const lower = wanted.toLowerCase()
  if (lower === 'here' || lower === 'new') return { ok: true, dest: lower, targetSessionId: '', targetTitle: '' }
  const ordinary = (Array.isArray(rows) ? rows : []).filter((r) => !isSubagent(r))
  const candidates = () => pickable(ordinary, fromSessionId, nowMs).slice(0, 5).map((r) => ({ id: String(r.sessionId), title: titleOf(r) }))
  const own = ordinary.find((r) => String(r.sessionId) === String(fromSessionId))
  const byId = ordinary.filter((r) => String(r.sessionId) === wanted || shortId(r.sessionId) === wanted)
  const hits = byId.length > 0 ? byId : ordinary.filter((r) => titleOf(r).toLowerCase() === lower)
  if (hits.some((r) => own !== undefined && r === own)) return { ok: false, error: 'the destination is the current session: use "here" for work in this chat', candidates: candidates() }
  if (hits.length === 0) return { ok: false, error: 'unknown destination: no other session has this id or exact title', candidates: candidates() }
  if (hits.length > 1) return { ok: false, error: 'ambiguous destination: several sessions have this title, use the id', candidates: hits.slice(0, 5).map((r) => ({ id: String(r.sessionId), title: titleOf(r) })) }
  return { ok: true, dest: 'other', targetSessionId: String(hits[0].sessionId), targetTitle: titleOf(hits[0]) }
}

export function toolDefinition (ctx, opts = {}) {
  const store = opts.proposals || proposals
  const now = typeof opts.now === 'function' ? opts.now : Date.now
  const arg = (args, key) => (args !== null && typeof args === 'object' && typeof args[key] === 'string' ? args[key] : '')
  return {
    name: OUTIL,
    description:
      'Propose to the person that THIS chat tells ANOTHER session something, hands work to another session, or starts a NEW session with a task. ' +
      'Nothing is sent: the person sees an inline form in this chat, prefilled with your proposal (kind, text, destination), edits it if they want, and clicks Send. ' +
      'Use it whenever the person\'s wish is to tell another session something, or to hand work to another or to a new session. ' +
      'Choose the destination and the kind yourself: "message" = information the other session should know (it acts on nothing by itself); ' +
      '"instruction" = work for that session to carry out with its own permissions (always the case for "here" and "new"). ' +
      'destination is "here" (do it in this chat), "new" (a new session whose first message is the text), or the id or exact title of one of the person\'s other sessions. ' +
      'One proposal per call: a new call replaces the previous one. The person decides.',
    parameters: {
      kind: { type: 'string', description: '"message" (information) or "instruction" (work to do).' },
      text: { type: 'string', description: 'What to send, 1 to 8000 characters, plain text, written for the receiving session.' },
      destination: { type: 'string', description: '"here", "new", or the id or exact title of another session.' },
    },
    render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
    execute: async (args, exec) => {
      const sc = controller(ctx)
      if (sc === undefined || sc === null || typeof sc.list !== 'function') return { ok: false, error: 'sessionController unavailable' }
      const from = exec !== null && exec !== undefined && exec.agent !== null && exec.agent !== undefined ? String(exec.agent.id || '') : ''
      if (from === '') return { ok: false, error: 'cannot identify the current session (called outside a turn?)' }
      const kind = arg(args, 'kind').trim()
      if (KINDS.indexOf(kind) < 0) return { ok: false, error: KIND_ERROR }
      const text = cleanText(arg(args, 'text')).trim()
      if (text.length < TEXT_MIN || text.length > TEXT_MAX) return { ok: false, error: TEXT_ERROR }
      let rows
      try { const items = (await sc.list({})).items; rows = Array.isArray(items) ? items : [] } catch (e) { return { ok: false, error: 'session list failed: ' + errText(e).slice(0, 160) } }
      const target = resolveDestination({ destination: arg(args, 'destination'), rows, fromSessionId: from, nowMs: now() })
      if (target.ok !== true) return target
      if (target.dest !== 'other' && kind !== 'instruction') return { ok: false, error: target.dest === 'here' ? 'a task done here is an instruction: use kind "instruction"' : 'a new session starts with an instruction: use kind "instruction"' }
      const proposal = store.set(from, { kind, text, dest: target.dest, targetSessionId: target.targetSessionId, targetTitle: target.targetTitle })
      if (proposal === null) return { ok: false, error: 'the proposal could not be stored' }
      return { ok: true, shown: true, dest: proposal.dest, target: proposal.targetTitle, note: 'The person sees an inline form prefilled with this proposal; nothing is sent until they click Send.' }
    },
  }
}

const CANDIDATS_DSH_TOOLS = [
  join(dshHome(), 'profiles', 'web', 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js'),
  '/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js',
  '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js',
]

async function chargerDefineTool () {
  for (const chemin of CANDIDATS_DSH_TOOLS) {
    if (!existsSync(chemin)) continue
    try {
      const module = await import(chemin)
      if (typeof module?.defineTool === 'function') return module.defineTool
    } catch (e) { dir(`defineTool unreadable from ${chemin}: ${errText(e)}`) }
  }
  return undefined
}

/** The exact shape `defineTool` produces (same fallback as the other bundles, checked by the host test). */
export function definitionLiteral (options) {
  return {
    name: options.name,
    description: options.description,
    parameters: { type: 'object', properties: options.parameters },
    output: { schema: {}, render: (args, value) => options.render(args, value) },
    execute: options.execute,
  }
}

async function enregistrerOutil (c) {
  if (c === null || c === undefined || c.tools === null || c.tools === undefined || typeof c.tools.register !== 'function') return
  const definition = toolDefinition(c)
  const defineTool = await chargerDefineTool()
  let outil
  try { outil = typeof defineTool === 'function' ? defineTool(definition) : definitionLiteral(definition) } catch (e) { outil = definitionLiteral(definition) }
  c.tools.register(outil)
  dir(`tool “${OUTIL}” registered`)
}

// ── the plugin ──────────────────────────────────────────────────────────────
export function apply (ctx) {
  try {
    const demarrerRoutes = (hostCtx) => {
      try { monterRoutes(hostCtx !== null && hostCtx !== undefined ? hostCtx.webServer : undefined, { ctx, hostCtx }) } catch (e) { dir('routes not mounted: ' + errText(e)) }
    }
    // The routes are mounted on the injected `webServer` context but hold the PLUGIN's own context: at request time they read
    // `sessionController` from it (the pattern of the Cloud routes, measured: `ctx.get('sessionController')` works there).
    const mountsRoutes = (c) => { try { demarrerRoutes(c) } catch (e) { dir('routes not mounted: ' + errText(e)) } }
    if (ctx !== null && ctx !== undefined && typeof ctx.get === 'function' && ctx.get('webServer') !== undefined) mountsRoutes(ctx)
    else if (ctx !== null && ctx !== undefined && typeof ctx.inject === 'function') ctx.inject(['webServer'], mountsRoutes)

    const demarrerOutil = (c) => { enregistrerOutil(c).catch((e) => dir('tool not registered: ' + errText(e))) }
    if (ctx !== null && ctx !== undefined && typeof ctx.get === 'function' && ctx.get('tools') !== undefined) demarrerOutil(ctx)
    else if (ctx !== null && ctx !== undefined && typeof ctx.inject === 'function') ctx.inject(['tools'], demarrerOutil)
  } catch (e) {
    dir('disabled: ' + errText(e))
  }
}
