// Kaby as a NATIVE DSH conversation (ADR 0053 § 14): the person's Kaby is a real chat of DSH, with DSH's own composer and rendering,
// running DSH's agent on this machine with the account's memory. What this file adds around that chat:
//   · which session is Kaby's (a pointer file; the page opens it, creating it once),
//   · who Kaby is for that session only (a block of the system prompt, plus the last words said on the shared thread: Telegram's),
//   · the end of each turn written on the person's thread on the server, when the server has one (`GET /v1/me/kyby`).
// The server's Kaby (Telegram, its cloud computer) and this one are two bodies of one assistant: one memory, one thread.
//
// Pure functions and a factory over injected helpers, so the hooks are tested without DSH and without a server. Nothing here throws
// into a turn, and nothing here returns the account's token.
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { identityBlock } from './kyby-identity.mjs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SESSION_ID = /^[A-Za-z0-9_.-]{8,120}$/
const KYBER_ID = /^[A-Za-z0-9_-]{4,64}$/
/** What the person calls their own assistant (the sidebar row's label is `kbui.kyber` in kybernos-plugin; the page has its own NAME). */
export const ASSISTANT_NAME = 'Kaby'
export const MAX_USER_CHARS = 100000
export const CONTEXT_LINES = 8
export const CONTEXT_CHARS = 240
const IDENTITY_TTL_MS = 5 * 60 * 1000
const CONTEXT_TTL_MS = 60 * 1000
/** A server that has no Kaby thread (older than this page) is not asked again for this long. */
const UNSUPPORTED_MS = 10 * 60 * 1000
/** The memory block the cloud bundle injects into a turn: removed before a turn's words are kept (same markers as index.js). */
const MEMORY_HEAD = '[KYBERNOS MEMORY]'
const MEMORY_TAIL = 'memory_search to look one up.'
const KYBY_HEAD = '[KYBY]'
const KYBY_TAIL = '[/KYBY]'

/**
 * DSH writes messages of its own with the user role: the runtime-context snapshot (where Kaby's identity block lives), the time sample, the skill catalogue,
 * « [model changed: ...] ». They carry `source.kind`, as measured in a session log (`user` for what the person typed; `time-context`, `runtime-context`,
 * `skill-catalog`, `agent-instructions`, `model-selection` for DSH's): only the person's own are their words.
 */
const isDshNote = (m) => m.source !== null && typeof m.source === 'object' && typeof m.source.kind === 'string' && m.source.kind !== 'user'

export const isSessionId = (v) => typeof v === 'string' && SESSION_ID.test(v)

const strip = (value) => {
  let text = String(value)
  for (const [head, tail] of [[MEMORY_HEAD, MEMORY_TAIL], [KYBY_HEAD, KYBY_TAIL]]) {
    for (;;) {
      const start = text.indexOf(head)
      if (start < 0) break
      const end = text.indexOf(tail, start)
      text = text.slice(0, start) + (end < 0 ? '' : text.slice(end + tail.length))
    }
  }
  return text.trim()
}

const textOf = (m) => {
  if (m === null || typeof m !== 'object') return ''
  if (typeof m.content === 'string') return m.content
  if (!Array.isArray(m.content)) return ''
  return m.content.filter((b) => b !== null && typeof b === 'object' && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n')
}

/** The last words of the person and the last of the assistant in a session's derived messages (the memory block is not theirs). */
export const lastTurn = (messages) => {
  const list = Array.isArray(messages) ? messages : []
  let user = ''
  let assistant = ''
  for (let i = list.length - 1; i >= 0 && (user === '' || assistant === ''); i -= 1) {
    const m = list[i]
    if (m === null || typeof m !== 'object') continue
    if (assistant === '' && m.role === 'assistant') assistant = strip(textOf(m))
    else if (user === '' && m.role === 'user' && !isDshNote(m)) user = strip(textOf(m))
  }
  return { user: user.slice(0, MAX_USER_CHARS), assistant: assistant.slice(0, MAX_USER_CHARS) }
}

/** What the server's conversation said last, as a few short lines. `skip` holds the starts of the texts this chat itself wrote there. */
export const contextLines = (rows, skip) => {
  const out = []
  const mine = skip instanceof Set ? skip : new Set()
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r === null || typeof r !== 'object' || (r.role !== 'user' && r.role !== 'assistant') || typeof r.content !== 'string') continue
    const text = strip(r.content).replace(/\s+/g, ' ')
    if (text === '' || mine.has(text.slice(0, 120))) continue
    out.push((r.role === 'user' ? 'Person: ' : ASSISTANT_NAME + ': ') + (text.length > CONTEXT_CHARS ? text.slice(0, CONTEXT_CHARS - 1) + '…' : text))
  }
  return out.slice(-CONTEXT_LINES)
}

/** The time as a sentence, in the machine's own zone (this chat runs on the person's computer, so its zone is theirs). Empty when the platform cannot say. */
export const nowSentence = (d = new Date()) => {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'
    const text = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(d).replace(',', '')
    return 'Local time: ' + text + ' (' + zone + ').'
  } catch (e) { return '' }
}

/** The block of the system prompt, for Kaby's own chat: the identity text shared with the cloud computer's turns (kyby-identity.mjs). `lines` is what was said lately on the person's shared thread (Telegram's), given as data. */
export const kybyPrompt = (lines, now = new Date()) =>
  [KYBY_HEAD, identityBlock({ channel: 'chat', body: 'computer', nowText: nowSentence(now), thread: lines }), KYBY_TAIL].join('\n')

// ── the pointer file: which session is Kaby's ───────────────────────────────────────────────────────

export function readPointer (file) {
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'))
    return j !== null && typeof j === 'object' && isSessionId(j.sessionId) ? j.sessionId : null
  } catch (e) { return null }
}

/** `{ ok }` or `{ ok: false, error }`. A written file is private to the person (0600) and replaced atomically. */
export function writePointer (file, sessionId) {
  if (sessionId !== null && !isSessionId(sessionId)) return { ok: false, error: 'invalid_session' }
  try {
    mkdirSync(dirname(file), { recursive: true })
    const tmp = file + '.' + process.pid + '.tmp'
    writeFileSync(tmp, JSON.stringify({ sessionId, at: new Date().toISOString() }) + '\n', { mode: 0o600 })
    try { chmodSync(tmp, 0o600) } catch (e) { /* a filesystem with no modes */ }
    renameSync(tmp, file)
    return { ok: true }
  } catch (e) { return { ok: false, error: 'write_failed' } }
}

/**
 * @param deps { pointerFile (a path, or a function giving it at each use), readState, isConnected, apiCall, now? } the helpers index.js already has.
 * Every method is safe to call from a hook: none throws.
 */
export function createKybyNative (deps) {
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now()
  let pointer = { at: 0, value: null }
  let identity = { at: 0, token: '', value: null }
  let unsupportedUntil = 0
  let context = { at: 0, lines: [], busy: false }
  const mirrored = new Set()

  const sessionId = () => {
    // Read at most once a second: the prompt is built at every request of a turn.
    if (now() - pointer.at > 1000) pointer = { at: now(), value: readPointer(typeof deps.pointerFile === 'function' ? deps.pointerFile() : deps.pointerFile) }
    return pointer.value
  }
  const token = () => {
    try {
      const s = deps.readState()
      return deps.isConnected(s) === true && typeof s.token === 'string' ? s.token : null
    } catch (e) { return null }
  }
  /** `{ kyber, thread }` of the person's Kaby on the server, or null (not signed in, an older server, nothing to talk to). */
  const thread = async (t) => {
    if (now() < unsupportedUntil) return null
    if (identity.value !== null && identity.token === t && now() - identity.at < IDENTITY_TTL_MS) return identity.value
    const res = await deps.apiCall('/v1/me/kyby', { method: 'GET', token: t, timeoutMs: 15000 })
    if (res.status === 404 || res.status === 405) { unsupportedUntil = now() + UNSUPPORTED_MS; return null }
    const b = res.status === 200 && res.body !== null && typeof res.body === 'object' ? res.body : null
    if (b === null || typeof b.kyber_id !== 'string' || !KYBER_ID.test(b.kyber_id) || typeof b.thread_id !== 'string' || !UUID.test(b.thread_id)) return null
    identity = { at: now(), token: t, value: { kyber: b.kyber_id, thread: b.thread_id } }
    return identity.value
  }
  const refreshContext = async () => {
    if (context.busy) return
    const t = token()
    if (t === null) return
    context.busy = true
    try {
      const th = await thread(t)
      if (th === null) { context.lines = []; context.at = now(); return }
      const res = await deps.apiCall('/v1/threads/' + encodeURIComponent(th.thread) + '/messages?limit=12', { method: 'GET', token: t, timeoutMs: 15000 })
      if (res.status === 404) { identity.value = null; return }
      const rows = res.status === 200 && res.body !== null && typeof res.body === 'object' ? res.body.messages : []
      context.lines = contextLines(rows, mirrored)
      context.at = now()
    } catch (e) { /* the words stay as they were */ } finally { context.busy = false }
  }

  return {
    /** The session that is Kaby's, or null. */
    sessionId,
    isKyby: (sid) => typeof sid === 'string' && sid !== '' && sid === sessionId(),
    /** Called for each request of a turn: the identity block for Kaby's session, an empty string for every other. */
    promptFor (sid) {
      if (!this.isKyby(sid)) return ''
      return kybyPrompt(context.lines)
    },
    /** A message of the person was taken in Kaby's session: the shared thread is read again, for the next request. */
    noteClaim (sid) {
      if (!this.isKyby(sid)) return
      if (now() - context.at > CONTEXT_TTL_MS) void refreshContext()
    },
    refreshContext,
    /** The end of a turn of Kaby's session: its words go on the person's thread. Returns what happened, as a word (for tests). */
    async mirrorTurn (agent, signal) {
      try {
        const sid = agent !== null && agent !== undefined && agent.session !== undefined ? agent.session.id : undefined
        if (!this.isKyby(sid)) return 'not_kyby'
        if (signal !== undefined && signal !== null && signal.aborted === true) return 'aborted'
        const t = token()
        if (t === null) return 'signed_out'
        const messages = typeof agent.session.deriveMessages === 'function' ? agent.session.deriveMessages() : []
        const turn = lastTurn(messages)
        if (turn.user === '' || turn.assistant === '') return 'nothing'
        const th = await thread(t)
        if (th === null) return 'no_thread'
        // One id per turn of this session: a retry of the same turn is the same turn at the server.
        const clientTurn = 'kybydsh_' + String(sid).replace(/[^A-Za-z0-9]/g, '').slice(0, 12) + '_' + String(messages.length)
        const res = await deps.apiCall('/v1/threads/' + encodeURIComponent(th.thread) + '/messages', {
          method: 'POST', token: t, timeoutMs: 20000,
          body: { user_message: turn.user, assistant_message: turn.assistant, client_turn_id: clientTurn },
        })
        if (res.status === 201 || res.status === 200) {
          mirrored.add(turn.user.replace(/\s+/g, ' ').slice(0, 120))
          mirrored.add(turn.assistant.replace(/\s+/g, ' ').slice(0, 120))
          if (mirrored.size > 400) mirrored.clear()
          return 'mirrored'
        }
        // The thread was deleted since: the identity is asked again at the next turn.
        if (res.status === 404) identity = { at: 0, token: '', value: null }
        return 'refused'
      } catch (e) { return 'error' }
    },
  }
}
