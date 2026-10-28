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
//   GET  /kybernos-log/stats?days=1
//   GET  /kybernos-log/stream      (SSE, live)
// Every route is fenced by Host and Origin: they are served BEFORE DSH's own authentication.
//
// Rules kept deliberately, all tested in test-host.mjs:
//  - a bundle must never stop DSH from starting: `apply` is wrapped, every hook is wrapped;
//  - a record is a plain object and the classifier is pure (no clock, no disk): the same event gives the same record;
//  - the journal never throws into a session: a disk error loses a line, not a turn;
//  - nothing is stored that a person would not want in a log file they might share: no text, no arguments.

import { dirname, join } from 'node:path'
import { mkdirSync, appendFileSync, readFileSync, statSync, renameSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

export const name = 'kybernos-log'

export const KINDS = ['llm', 'connector', 'websearch', 'tool', 'probe', 'title', 'compaction', 'approval', 'job', 'sandbox', 'session']
const MAX_RING = 4000
const MAX_BYTES = 8 * 1024 * 1024
const MAX_LIMIT = 500
const TITLE_MAX = 80
const ERROR_MAX = 180

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const clampText = (v, max) => (typeof v === 'string' && v !== '' ? (v.length > max ? v.slice(0, max - 1) + '…' : v) : undefined)
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
      ...(typeof fail.message === 'string' ? { detail: clampText(String(fail.message).replace(/^\d{3}: /, ''), ERROR_MAX) } : {})
    }
  }
  if (type === 'tool/call') {
    const tool = clampText(data.name, 60)
    if (tool === undefined) return null
    return { ...base, type: toolKind(tool), kind: 'call', tool }
  }
  // What a tool answered: the harness records it separately from the call, and it carries the outcome (isError) and, when
  // it failed, an error code. Without it the page could not say « result » at all — a tool call and its result were one row.
  if (type === 'tool/result') {
    const message = isObj(data.message) ? data.message : {}
    const ok = message.isError !== true
    const info = isObj(data.error) ? data.error : {}
    const code = clampText(info.code, 40) || clampText(info.message, 80)
    return { ...base, type: 'tool', kind: 'result', ok, ...(code !== undefined ? { detail: code } : {}) }
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
    return { ...base, type: 'session', kind: 'turn-end', status: failed ? 'failed' : 'completed', ...(failed ? { error: clampText(String(reason.kind), ERROR_MAX) } : {}) }
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

/** Calls and tokens per day, per type and per model — what the page's cards show. Pure. */
export const aggregate = (rows, { days = 1, now = Date.now() } = {}) => {
  const keep = new Set()
  for (let i = 0; i < days; i += 1) keep.add(dayKey(now - i * 86400000))
  const byDay = new Map()
  for (const r of rows) {
    if (r === null || typeof r !== 'object') continue
    const day = dayKey(r.at)
    if (!keep.has(day)) continue
    if (!byDay.has(day)) byDay.set(day, { day, calls: 0, tokens: 0, types: {}, models: {} })
    const d = byDay.get(day)
    const tokens = num(r.input) + num(r.output) + num(r.cache)
    if (r.type === 'llm' && r.kind === 'answer') { d.calls += 1; d.tokens += tokens }
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
            if (isObj(r)) { rows.push(r); seq = Math.max(seq, Number(r.seq) || 0) }
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
    size () { load(); return { rows: rows.length, seq, bytes: size } }
  }
}

// ── routes ───────────────────────────────────────────────────────────────────────────────────────────────────────
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

/** Mount the three routes on a webServer-like `{ register }`. Returns a function that unregisters them. */
export const mountRoutes = (webServer, journal, { subscribe } = {}) => {
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
      return send(res, 200, { ok: true, events, state, total: state.rows, hasMore: events.length >= limit })
    } })
    register({ kind: 'exact', path: '/kybernos-log/stats', handler: (req, res) => {
      if (!guard(res, req)) return
      if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'method-not-allowed' })
      let days = 1
      try { days = Math.min(30, Math.max(1, Number(new URL('http://x' + (req.url || '/')).searchParams.get('days')) || 1)) } catch (e) { days = 1 }
      return send(res, 200, { ok: true, days: journal.stats({ days }) })
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
