// kybernos-log — host half: the activity journal that answers « what did this machine send out? »
//
// One subscription to `session/event` (the same source kybernos-call follows) turns every session event into a
// small METADATA record and nothing else: never a message body, never a tool argument, never a tool result.
// What is kept is what a person can act on: when, which kind, which session, which provider/model and how many
// tokens, which tool (so a connector is told apart from a web search and from a shell command), and why it failed.
//
// Storage is a bounded ring on disk (`<DSH home>/kybernos/log/events.jsonl`, rotated) plus the last few thousand
// records in memory. Three read-only routes serve the page and anything else that wants to watch:
//   GET  /kybernos-log/events?types=llm,websearch&session=&q=&since=&before=&limit=
//   GET  /kybernos-log/stats?days=1          (per day, and per hour of each day: the page's sparklines)
//   GET  /kybernos-log/stream      (SSE, live)
//   GET  /kybernos-log/terminal?stream=out|err&before=&after=&limit=&q=&plugin=   (what DSH prints in its terminal)
// Every route is fenced by Host and Origin: they are served BEFORE DSH's own authentication. The terminal route reads local text
// that may hold paths, so it also needs DSH's signed session cookie (session-guard.mjs), and it masks secrets before it answers.
//
// Rules kept deliberately, all tested in test-host.mjs:
//  - a bundle must never stop DSH from starting: `apply` is wrapped, every hook is wrapped;
//  - a record is a plain object and the classifier is pure (no clock, no disk): the same event gives the same record;
//  - the journal never throws into a session: a disk error loses a line, not a turn;
//  - nothing is stored that a person would not want in a log file they might share: no text, no arguments.

import { dirname, join } from 'node:path'
import { mkdirSync, appendFileSync, readFileSync, statSync, renameSync, existsSync, openSync, readSync, closeSync } from 'node:fs'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { writeGuard, dshHome } from './session-guard.mjs'

export const name = 'kybernos-log'

export const KINDS = ['llm', 'connector', 'websearch', 'tool', 'probe', 'title', 'compaction', 'approval', 'job', 'sandbox', 'session']
const MAX_RING = 4000
const MAX_BYTES = 8 * 1024 * 1024
const MAX_LIMIT = 500
const TITLE_MAX = 80
const ERROR_MAX = 180
const TITLES_MAX = 2000

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const clampText = (v, max) => (typeof v === 'string' && v !== '' ? (v.length > max ? v.slice(0, max - 1) + '…' : v) : undefined)
/** What a person reads of a provider's failure: the status prefix (« 429: ») goes, and a JSON body (« {"error":{"message":"…","type":"rate_limit_error"}} ») gives its message, never its braces. */
export const failureSentence = (raw) => {
  const text = String(raw).replace(/^\d{3}: /, '').trim()
  if (!text.startsWith('{')) return text
  try {
    const body = JSON.parse(text)
    const found = isObj(body) ? (typeof body.message === 'string' ? body.message : (isObj(body.error) && typeof body.error.message === 'string' ? body.error.message : null)) : null
    if (found !== null && found.trim() !== '') return found.trim()
  } catch { /* not whole JSON */ }
  const cut = text.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)/)
  if (cut === null) return text
  try { return JSON.parse('"' + cut[1].replace(/\\$/, '') + '"') } catch { return cut[1] }
}
const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0)

/** Local calendar day, YYYY-MM-DD (the person's day, not UTC: the ledger taught that lesson). */
export const dayKey = (ms) => {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

/** Which family a tool call belongs to. A connector is an MCP/Composio tool (prefixed), a search is the web tool. */
export const toolKind = (toolName) => {
  const n = String(toolName === undefined || toolName === null ? '' : toolName)
  if (n === '') return 'tool'
  if (/^mcp__/i.test(n)) return 'connector'
  if (/^(web_search|websearch|web_fetch|search_web)$/i.test(n)) return 'websearch'
  return 'tool'
}

/** The model a session is using, remembered from its last request or explicit selection. */
const routeOf = (data) => {
  if (!isObj(data)) return null
  const h = isObj(data.header) ? data.header : null
  const cfg = h !== null && isObj(h.config) ? h.config : null
  if (cfg !== null && typeof cfg.provider === 'string') return { provider: cfg.provider, model: cfg.model }
  if (typeof data.provider === 'string') return { provider: data.provider, model: data.model }
  const r = isObj(data.route) ? data.route : null
  if (r !== null && typeof r.provider === 'string') return { provider: r.provider, model: r.model }
  return null
}

/**
 * One session event → one record, or null when the event says nothing a journal should keep.
 * Pure: `state` carries what must be remembered between events (the session's current route) and is updated in place.
 */
export const classifyEvent = (sessionId, event, state = {}) => {
  const type = typeof event.type === 'string' ? event.type : ''
  const data = isObj(event.data) ? event.data : {}
  const at = typeof event.time === 'number' ? event.time : Date.now()
  const session = String(sessionId === undefined || sessionId === null ? '' : sessionId).replace(/^session-/, '').slice(0, 40)
  if (session !== '') {
    if (!isObj(state.routes)) state.routes = {}
    if (!isObj(state.titles)) state.titles = {}
  }
  const base = { at, session: session === '' ? null : session }

  if (type === 'session/title') {
    const title = clampText(data.title, TITLE_MAX)
    if (title === undefined) return null
    if (session !== '') state.titles[session] = title
    return { ...base, type: 'session', kind: 'title', title }
  }
  if (type === 'request/header') {
    const r = routeOf(data)
    if (r === null) return null
    if (session !== '') state.routes[session] = r
    return { ...base, type: 'llm', kind: 'request', provider: r.provider, model: r.model }
  }
  if (type === 'model/selection') {
    const r = routeOf(data)
    if (r === null) return null
    if (session !== '') state.routes[session] = r
    return { ...base, type: 'llm', kind: 'selection', provider: r.provider, model: r.model }
  }
  if (type === 'assistant/message') {
    const u = isObj(data.usage) ? data.usage : null
    const r = session !== '' && isObj(state.routes) ? state.routes[session] : null
    return {
      ...base,
      type: 'llm',
      kind: 'answer',
      ...(r ? { provider: r.provider, model: r.model } : {}),
      ...(u ? { input: num(u.inputTokens), output: num(u.outputTokens), cache: num(u.cacheReadTokens) } : {})
    }
  }
  if (type === 'session/title-llm-request') {
    const r = routeOf(data)
    return { ...base, type: 'title', kind: 'request', ...(r ? { provider: r.provider, model: r.model } : {}) }
  }
  if (type === 'compaction/summary') return { ...base, type: 'compaction', kind: 'summary' }
  if (type === 'llm/retry') {
    const fail = isObj(data.failure) ? data.failure : {}
    return {
      ...base,
      type: 'llm',
      kind: 'retry',
      ...(typeof data.provider === 'string' ? { provider: data.provider } : {}),
      ...(typeof data.retry === 'number' ? { attempt: data.retry } : {}),
      ...(typeof fail.code === 'string' ? { error: clampText(fail.code, ERROR_MAX) } : {}),
      ...(typeof fail.message === 'string' ? { detail: clampText(failureSentence(fail.message), ERROR_MAX) } : {})
    }
  }
  if (type === 'tool/call') {
    const tool = clampText(data.name, 60)
    if (tool === undefined) return null
    const callId = clampText(data.callId, 80)
    return { ...base, type: toolKind(tool), kind: 'call', tool, ...(callId !== undefined ? { callId } : {}) }
  }
  // What a tool answered: the harness records it separately from the call, and it carries the outcome (isError) and, when
  // it failed, an error code. Without it the page could not say « result » at all — a tool call and its result were one row.
  if (type === 'tool/result') {
    const message = isObj(data.message) ? data.message : {}
    const ok = message.isError !== true
    const info = isObj(data.error) ? data.error : {}
    const code = clampText(info.code, 40) || clampText(info.message, 80)
    const source = isObj(message.source) ? message.source : {}
    const callId = clampText(source.callId, 80)
    return { ...base, type: 'tool', kind: 'result', ok, ...(callId !== undefined ? { callId } : {}), ...(code !== undefined ? { detail: code } : {}) }
  }
  if (type === 'approval/asked' || type === 'approval/decided') {
    return { ...base, type: 'approval', kind: type === 'approval/asked' ? 'asked' : 'decided' }
  }
  if (type === 'job/registered' || type === 'job/settled') {
    const job = clampText(isObj(data) ? String(data.kind || '') : '', 20)
    const status = type === 'job/settled' ? clampText(data.status, 20) : undefined
    return { ...base, type: 'job', kind: type === 'job/registered' ? 'start' : 'end', ...(job ? { tool: job } : {}), ...(status !== undefined ? { status } : {}) }
  }
  if (type === 'sandbox/mode') return { ...base, type: 'sandbox', kind: 'mode' }
  if (type === 'turn/start') return { ...base, type: 'session', kind: 'turn-start' }
  if (type === 'turn/end') {
    const reason = isObj(data.reason) ? data.reason : {}
    const failed = reason.kind !== undefined && reason.kind !== 'completed'
    // A turn that failed says why in words (« Your budget is used up »), as the retry rows do, not only the kind of ending.
    const why = failed && isObj(reason.error) && typeof reason.error.message === 'string' ? clampText(failureSentence(reason.error.message), ERROR_MAX) : undefined
    return { ...base, type: 'session', kind: 'turn-end', status: failed ? 'failed' : 'completed', ...(failed ? { error: clampText(String(reason.kind), ERROR_MAX) } : {}), ...(why !== undefined ? { detail: why } : {}) }
  }
  return null
}

/** Keep the records a query asks for. Pure: the client's chips, session filter and search all land here. */
export const filterEvents = (rows, query = {}) => {
  // An unknown family is dropped; asking only for unknowns reads as « no family filter » rather than a blank page.
  const wanted = Array.isArray(query.types) ? query.types.filter((t) => KINDS.includes(t)) : []
  const types = wanted.length > 0 ? new Set(wanted) : null
  const session = typeof query.session === 'string' && query.session !== '' ? query.session.replace(/^session-/, '').slice(0, 40) : null
  const q = typeof query.q === 'string' && query.q.trim() !== '' ? query.q.trim().toLowerCase() : null
  const since = typeof query.since === 'number' ? query.since : null
  const before = typeof query.before === 'number' ? query.before : null
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(query.limit) || 200))
  const out = []
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const r = rows[i]
    if (r === null || typeof r !== 'object') continue
    if (types !== null && !types.has(r.type)) continue
    if (session !== null && r.session !== session) continue
    if (since !== null && !(r.at >= since)) continue
    if (before !== null && !(r.seq < before)) continue
    if (q !== null) {
      const hay = [r.type, r.kind, r.session, r.title, r.provider, r.model, r.tool, r.error, r.detail].filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) continue
    }
    out.push(r)
    if (out.length >= limit) break
  }
  return out.reverse()
}

/** A record that says something went wrong: a retry, a tool that answered with an error, a turn or a job that did not complete. */
const FAILED_STATUS = new Set(['failed', 'killed', 'error', 'timeout'])
export const isFailure = (r) => r !== null && typeof r === 'object' && (r.kind === 'retry' || r.ok === false || (typeof r.status === 'string' && FAILED_STATUS.has(r.status)))
/** The calls nobody asked for: automatic titles, compactions, probes (one record per call). */
const UNASKED = new Set(['title', 'compaction', 'probe'])
export const isUnasked = (r) => r !== null && typeof r === 'object' && UNASKED.has(r.type)
const emptyHour = () => ({ calls: 0, tokens: 0, failures: 0, unasked: 0 })

/**
 * Calls and tokens per day, per type and per model (what the page's cards show), and the same per local hour of each day
 * (`hours`, 24 buckets: model calls, tokens, failures, unasked calls), which the cards draw as sparklines. Pure.
 */
export const aggregate = (rows, { days = 1, now = Date.now() } = {}) => {
  const keep = new Set()
  for (let i = 0; i < days; i += 1) keep.add(dayKey(now - i * 86400000))
  const byDay = new Map()
  for (const r of rows) {
    if (r === null || typeof r !== 'object') continue
    const day = dayKey(r.at)
    if (!keep.has(day)) continue
    if (!byDay.has(day)) byDay.set(day, { day, calls: 0, tokens: 0, failures: 0, unasked: 0, types: {}, models: {}, hours: Array.from({ length: 24 }, emptyHour) })
    const d = byDay.get(day)
    const hour = d.hours[new Date(r.at).getHours()]
    const tokens = num(r.input) + num(r.output) + num(r.cache)
    d.tokens += tokens
    hour.tokens += tokens
    if (r.type === 'llm' && r.kind === 'answer') { d.calls += 1; hour.calls += 1 }
    if (isFailure(r)) { d.failures += 1; hour.failures += 1 }
    if (isUnasked(r)) { d.unasked += 1; hour.unasked += 1 }
    const t = d.types[r.type] || { calls: 0, tokens: 0 }
    t.calls += r.kind === 'call' || r.kind === 'answer' ? 1 : 0
    t.tokens += tokens
    d.types[r.type] = t
    if (r.type === 'llm' && typeof r.model === 'string') {
      const m = d.models[r.model] || { calls: 0, tokens: 0 }
      if (r.kind === 'answer') m.calls += 1
      m.tokens += tokens
      d.models[r.model] = m
    }
  }
  return Array.from(byDay.values()).sort((a, b) => (a.day < b.day ? 1 : -1))
}

/** The journal: a bounded, rotated JSONL file and the ring the routes read. Never throws into its caller. */
export const createJournal = ({ file, maxBytes = MAX_BYTES, ring = MAX_RING, now = () => Date.now() } = {}) => {
  const rows = []
  let seq = 0
  let loaded = false
  let size = 0
  // Each chat's last title, read from the WHOLE file (the ring keeps the last few thousand records, and a chat named long ago is still
  // a chat the page should call by its name). Bounded: the oldest titles go first past TITLES_MAX.
  const titles = new Map()
  const remember = (r) => {
    if (r.type !== 'session' || r.kind !== 'title' || typeof r.session !== 'string' || typeof r.title !== 'string') return
    titles.delete(r.session)
    titles.set(r.session, r.title)
    if (titles.size > TITLES_MAX) titles.delete(titles.keys().next().value)
  }

  const load = () => {
    if (loaded) return
    loaded = true
    try {
      if (typeof file === 'string' && existsSync(file)) {
        const text = readFileSync(file, 'utf8')
        for (const line of text.split('\n')) {
          if (line.length < 2) continue
          try {
            const r = JSON.parse(line)
            if (isObj(r)) { rows.push(r); remember(r); seq = Math.max(seq, Number(r.seq) || 0) }
          } catch (e) { /* a torn tail line is normal after a crash */ }
        }
        if (rows.length > ring) rows.splice(0, rows.length - ring)
        try { size = statSync(file).size } catch (e) { size = text.length }
      }
    } catch (e) { /* an unreadable log is an empty log, never a dead plugin */ }
  }

  const rotate = () => {
    try {
      if (typeof file === 'string' && existsSync(file)) renameSync(file, file + '.1')
    } catch (e) { /* rotation is best effort */ }
    size = 0
  }

  return {
    get file () { return file },
    /** Add one record (already classified). Returns the stored record, or null when it was refused. */
    append (rec) {
      if (!isObj(rec) || typeof rec.type !== 'string') return null
      load()
      seq += 1
      const stored = { seq, ...rec, at: typeof rec.at === 'number' ? rec.at : now() }
      rows.push(stored)
      remember(stored)
      if (rows.length > ring) rows.splice(0, rows.length - ring)
      try {
        if (typeof file === 'string') {
          mkdirSync(dirname(file), { recursive: true })
          const line = JSON.stringify(stored) + '\n'
          appendFileSync(file, line)
          size += Buffer.byteLength(line)
          if (size > maxBytes) rotate()
        }
      } catch (e) { /* disk full or read-only: tracking is best effort */ }
      return stored
    },
    list (query = {}) { load(); return filterEvents(rows, query) },
    stats (opts = {}) { load(); return aggregate(rows, { now: now(), ...opts }) },
    size () { load(); return { rows: rows.length, seq, bytes: size } },
    /** The titles of the given chats (those the journal knows), as `{ session: title }`. */
    titles (sessions) {
      load()
      const out = {}
      for (const id of sessions) if (typeof id === 'string' && titles.has(id)) out[id] = titles.get(id)
      return out
    }
  }
}

// ── routes ───────────────────────────────────────────────────────────────────────────────────────────────────────
// -- the terminal: what DSH prints ------------------------------------------------------------------------------------
// DSH, started by the launcher, writes its terminal to <DSH home>/logs/dsh-web.out.log (standard output) and dsh-web.err.log
// (errors). Those files have no timestamps, so the two streams are served apart and never merged. The reader is bounded: it reads
// at most TAIL_BYTES from the end, whatever the size of the file, and counts the lines before that window once (append-only files:
// the count is kept per file and only the new bytes are counted on the next call, so following the file every 2 s stays cheap).

const TAIL_BYTES = 4 * 1024 * 1024
const TERM_LIMIT = 500
const TERM_LINE_MAX = 2000

/** Where DSH's terminal is written. A DSH on another port than 3080 writes dsh-web-<port>.<stream>.log (scripts/dsh-relance.mjs). */
export const terminalFile = (home, stream, port) => {
  const which = stream === 'err' ? 'err' : 'out'
  if (typeof port === 'number' && port !== 3080) {
    const own = join(home, 'logs', 'dsh-web-' + port + '.' + which + '.log')
    if (existsSync(own)) return own
  }
  return join(home, 'logs', 'dsh-web.' + which + '.log')
}

const HIDDEN = '[hidden]'
// Each pattern keeps what names the secret and replaces only the value. Applied in this order, on every line, BEFORE it leaves the host.
const SECRET_PATTERNS = [
  // a JSON Web Token, wherever it stands
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, HIDDEN],
  // the API keys whose shape is known: OpenAI/Anthropic-style sk-, GitHub, GitLab, Slack, AWS, Google
  [/\bsk-[A-Za-z0-9_-]{12,}/g, 'sk-' + HIDDEN],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}/g, HIDDEN],
  [/\bgithub_pat_[A-Za-z0-9_]{16,}/g, HIDDEN],
  [/\bglpat-[A-Za-z0-9_-]{12,}/g, HIDDEN],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, HIDDEN],
  [/\bAKIA[0-9A-Z]{16}\b/g, HIDDEN],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, HIDDEN],
  // an Authorization header and its scheme
  [/\b(Bearer|Basic|Token)(\s+)[A-Za-z0-9._~+/=-]{6,}/g, '$1$2' + HIDDEN],
  [/\b(authorization["']?\s*[:=]\s*["']?)(?!Bearer\b|Basic\b|Token\b|\[hidden\])[^\s"',;&]+/gi, '$1' + HIDDEN],
  // name=value or "name": "value" for the names a secret goes under (token=..., access_token, api_key, key=, password=...)
  [/(\b(?:access_token|refresh_token|id_token|token|api[_-]?key|apikey|key|secret|client_secret|password|passwd|pwd|auth|cookie)["']?\s*[=:]\s*["']?)(?!\[hidden\])[^\s"'&,;]+/gi, '$1' + HIDDEN],
  // a long hex or base64 run right after the word secret or token ("secret abcd...", "token 9f8e...")
  [/(\b(?:secrets?|tokens?)\b[^A-Za-z0-9\n]{1,4})(?!\[hidden\])[A-Za-z0-9+/_=-]{20,}/gi, '$1' + HIDDEN]
]
/** One line as the page may show it: colour codes gone, secrets hidden, a very long line cut. Pure. */
export const maskSecrets = (line) => {
  let t = String(line).replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r$/, '')
  for (const [re, by] of SECRET_PATTERNS) t = t.replace(re, by)
  return t.length > TERM_LINE_MAX ? t.slice(0, TERM_LINE_MAX - 1) + '\u2026' : t
}
/** The plugin a line comes from, when it starts with a tag such as "[kybernos-cloud]". */
export const pluginTag = (line) => {
  const m = /^\[([A-Za-z0-9@][\w.@/-]{0,40})\]/.exec(line)
  return m === null ? null : m[1]
}

const lineCounts = new Map()
const countNewlines = (fd, from, to) => {
  const chunk = Buffer.alloc(1024 * 1024)
  let n = 0
  for (let at = from; at < to;) {
    const got = readSync(fd, chunk, 0, Math.min(chunk.length, to - at), at)
    if (got <= 0) break
    for (let i = 0; i < got; i += 1) if (chunk[i] === 10) n += 1
    at += got
  }
  return n
}

/**
 * The end of one terminal file, numbered. Lines are 1-based, newest last; only complete lines are served (a line still being
 * written waits for its newline). `before` asks for older lines, `after` for the ones that came since (follow), `q` and `plugin`
 * filter on the MASKED text (so a search cannot find a secret by its value). Never throws: a missing file answers `exists: false`.
 */
export const readTerminal = (file, { before, after, limit = TERM_LIMIT, q, plugin, tailBytes = TAIL_BYTES } = {}) => {
  let st = null
  try { st = statSync(file) } catch (e) { st = null }
  if (st === null || !st.isFile()) return { exists: false, total: 0, lines: [], hasOlder: false, truncated: false, plugins: [] }
  let fd = null
  try {
    fd = openSync(file, 'r')
    const size = st.size
    const start = Math.max(0, size - tailBytes)
    let c = lineCounts.get(file)
    if (c === undefined || c.ino !== st.ino || c.bytes > start || c.size > size) c = { ino: st.ino, bytes: 0, lines: 0, size }
    if (c.bytes < start) { c.lines += countNewlines(fd, c.bytes, start); c.bytes = start }
    c.size = size
    lineCounts.set(file, c)
    const buf = Buffer.alloc(size - start)
    if (buf.length > 0) readSync(fd, buf, 0, buf.length, start)
    const pieces = buf.toString('utf8').split('\n')
    const total = c.lines + pieces.length - 1
    const first = start > 0 ? 1 : 0
    const all = []
    const tags = new Map()
    for (let i = first; i < pieces.length - 1; i += 1) {
      const text = maskSecrets(pieces[i])
      const tag = pluginTag(text)
      if (tag !== null) tags.set(tag, (tags.get(tag) || 0) + 1)
      all.push({ n: c.lines + 1 + i, text, tag })
    }
    const needle = typeof q === 'string' && q.trim() !== '' ? q.trim().toLowerCase() : null
    const only = typeof plugin === 'string' && plugin !== '' ? plugin : null
    const max = Math.min(TERM_LIMIT, Math.max(1, Number(limit) || TERM_LIMIT))
    const matched = all.filter((l) => (only === null || l.tag === only) && (needle === null || l.text.toLowerCase().includes(needle)))
    let picked
    let skipped = 0
    if (typeof after === 'number' && Number.isFinite(after)) {
      const since = matched.filter((l) => l.n > after)
      skipped = Math.max(0, since.length - max)
      picked = since.slice(since.length - max)
    } else {
      const older = typeof before === 'number' && Number.isFinite(before) ? matched.filter((l) => l.n < before) : matched
      picked = older.slice(Math.max(0, older.length - max))
    }
    const oldest = picked.length > 0 ? picked[0].n : (typeof before === 'number' ? before : total + 1)
    const hasOlder = matched.some((l) => l.n < oldest)
    return {
      exists: true,
      total,
      lines: picked.map((l) => ({ n: l.n, text: l.text })),
      hasOlder,
      // the window does not reach the start of the file: older lines exist but are not read here
      truncated: start > 0 && !hasOlder,
      skipped,
      plugins: Array.from(tags.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([tag, count]) => ({ tag, count }))
    }
  } catch (e) {
    return { exists: true, total: 0, lines: [], hasOlder: false, truncated: false, plugins: [], error: 'unreadable' }
  } finally {
    if (fd !== null) { try { closeSync(fd) } catch (e) { /* already closed */ } }
  }
}

const str = (v) => (typeof v === 'string' && v !== '' ? v : null)
const localAuthority = (req) => {
  try {
    const host = str(req && req.headers && req.headers.host)
    const port = req && req.socket && typeof req.socket.localPort === 'number' ? req.socket.localPort : null
    if (host === null || port === null) return true
    return ['127.0.0.1:' + port, 'localhost:' + port, '[::1]:' + port].includes(host)
  } catch (e) { return false }
}
const originOk = (req) => {
  try {
    const source = str(req && req.headers && (req.headers.origin || req.headers.referer))
    if (source === null) return true
    const u = new URL(source)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    return /^(127\.0\.0\.1|localhost|\[::1\])$/.test(u.hostname)
  } catch (e) { return false }
}
const send = (res, status, body) => {
  try {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  } catch (e) { /* socket closed */ }
}

/** Mount the four routes on a webServer-like `{ register }`. Returns a function that unregisters them. `home` is the DSH folder (a test gives a temp one). */
export const mountRoutes = (webServer, journal, { subscribe, home } = {}) => {
  const withdrawals = []
  const register = (route) => {
    const off = webServer.register(route)
    if (typeof off === 'function') withdrawals.push(off)
  }
  const guard = (res, req) => {
    if (localAuthority(req) === false || originOk(req) === false) { res.writeHead(403); res.end('origin refused'); return false }
    return true
  }
  const streams = new Set()
  const broadcast = (rec) => {
    const line = 'event: record\ndata: ' + JSON.stringify(rec) + '\n\n'
    for (const res of streams) { try { res.write(line) } catch (e) { streams.delete(res) } }
  }
  try {
    register({ kind: 'exact', path: '/kybernos-log/events', handler: (req, res) => {
      if (!guard(res, req)) return
      if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'method-not-allowed' })
      let url
      try { url = new URL('http://x' + (req.url || '/')) } catch (e) { return send(res, 400, { ok: false, error: 'bad-url' }) }
      const p = url.searchParams
      const types = (p.get('types') || '').split(',').map((x) => x.trim()).filter(Boolean)
      const limit = Math.min(MAX_LIMIT, Math.max(1, Number(p.get('limit')) || 200))
      const events = journal.list({
        types,
        session: p.get('session') || undefined,
        q: p.get('q') || undefined,
        since: p.get('since') ? Number(p.get('since')) : undefined,
        before: p.get('before') ? Number(p.get('before')) : undefined,
        limit
      })
      // The page pages: a full page means there may be older rows, and the client asks for them with `before` (the seq of
      // its oldest row). `total` is what the ring holds, so the page can say « 300 of 12 000 » instead of guessing.
      const state = journal.size()
      // `titles` names the chats of these rows (from the whole file, not only the ring): the page shows a chat's title, not its id.
      return send(res, 200, { ok: true, events, state, total: state.rows, hasMore: events.length >= limit, titles: journal.titles(new Set(events.map((e) => e.session))) })
    } })
    register({ kind: 'exact', path: '/kybernos-log/stats', handler: (req, res) => {
      if (!guard(res, req)) return
      if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'method-not-allowed' })
      let days = 1
      try { days = Math.min(30, Math.max(1, Number(new URL('http://x' + (req.url || '/')).searchParams.get('days')) || 1)) } catch (e) { days = 1 }
      return send(res, 200, { ok: true, days: journal.stats({ days }) })
    } })
    // What DSH prints in its terminal. Local text that may hold a path or an error message: a GET, but under DSH's signed session
    // like a write (session-guard.mjs), and every line is masked before it leaves (maskSecrets). Read-only: no other method.
    register({ kind: 'exact', path: '/kybernos-log/terminal', handler: (req, res) => {
      if (!guard(res, req)) return
      if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'method-not-allowed' })
      const refused = writeGuard(req)
      if (refused !== null) return send(res, refused.status, { ok: false, error: refused.error })
      let p
      try { p = new URL('http://x' + (req.url || '/')).searchParams } catch (e) { return send(res, 400, { ok: false, error: 'bad-url' }) }
      const stream = p.get('stream') === 'err' ? 'err' : 'out'
      const at = (k) => { const v = p.get(k); return v === null || v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v) }
      const port = req && req.socket && typeof req.socket.localPort === 'number' ? req.socket.localPort : undefined
      const file = terminalFile(typeof home === 'string' ? home : dshHome(), stream, port)
      const got = readTerminal(file, { before: at('before'), after: at('after'), limit: at('limit'), q: p.get('q') || undefined, plugin: p.get('plugin') || undefined })
      // The file's NAME only: its folder is a personal path.
      return send(res, 200, { ok: true, stream, file: file.split(/[\\/]/).pop(), ...got })
    } })
    register({ kind: 'exact', path: '/kybernos-log/stream', handler: (req, res) => {
      if (!guard(res, req)) return
      if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'method-not-allowed' })
      try {
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' })
        res.write('event: hello\ndata: ' + JSON.stringify(journal.size()) + '\n\n')
      } catch (e) { return }
      streams.add(res)
      const beat = setInterval(() => { try { res.write(': beat\n\n') } catch (e) { clearInterval(beat); streams.delete(res) } }, 25000)
      const drop = () => { clearInterval(beat); streams.delete(res) }
      try { req.on('close', drop); res.on('close', drop) } catch (e) { /* older nodes */ }
    } })
    if (typeof subscribe === 'function') {
      const off = subscribe((rec) => broadcast(rec))
      if (typeof off === 'function') withdrawals.push(off)
    }
  } catch (e) {
    // A route already taken by an older copy of this plugin must not stop the others: log, keep what mounted.
    console.log('[kybernos-log] routes not fully mounted: ' + String(e && e.message ? e.message : e))
  }
  return () => { for (const off of withdrawals) { try { off() } catch (e) { /* already gone */ } } withdrawals.length = 0 }
}

/** Where the journal lives: `<DSH home>/kybernos/log/events.jsonl` (never a personal absolute path in the code). */
export const journalPath = (home = process.env.DSH_HOME || join(homedir(), '.dsh')) => join(home, 'kybernos', 'log', 'events.jsonl')

export function apply (ctx) {
  try {
    const journal = createJournal({ file: journalPath() })
    const state = { routes: {}, titles: {} }
    const listeners = new Set()
    let unmount = null
    try {
      if (ctx !== null && ctx !== undefined && typeof ctx.on === 'function') {
        ctx.on('session/event', (session, event) => {
          try {
            const sid = session !== null && session !== undefined && typeof session.id === 'string' ? session.id : (event && event.sessionId)
            const rec = classifyEvent(sid, event, state)
            if (rec === null) return
            const stored = journal.append(rec)
            if (stored !== null) for (const fn of listeners) { try { fn(stored) } catch (e) { /* a listener never breaks a turn */ } }
          } catch (e) { /* never break a session */ }
        })
      }
    } catch (e) { console.log('[kybernos-log] session events not followed: ' + String(e && e.message ? e.message : e)) }
    const url = fileURLToPath(import.meta.url)
    const home = dirname(url)
    try {
      ctx.effect(() => {
        const services = ['webServer']
        for (const name of services) {
          try {
            ctx.inject([name], (scope) => {
              const server = scope[name]
              if (server === undefined || server === null || typeof server.register !== 'function') return
              unmount = mountRoutes(server, journal, { subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn) } })
              console.log('[kybernos-log] routes mounted — journal at ' + journal.file)
            })
          } catch (e) { /* the service may not be published yet */ }
        }
        return () => { if (unmount !== null) unmount(); listeners.clear() }
      }, 'kybernos-log: routes')
    } catch (e) { console.log('[kybernos-log] routes not mounted: ' + String(e && e.message ? e.message : e)) }
    return { journal, pluginDir: home }
  } catch (e) {
    console.log('[kybernos-log] disabled: ' + String(e && e.message ? e.message : e))
    return null
  }
}
