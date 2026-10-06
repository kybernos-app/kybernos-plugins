// Tests a custom MCP server the way a client would: initialize, then tools/list. The connector
// form's "Test" button goes through here. It answers the question the form could not: "does this
// connector start, and what does it expose?", without waiting for the next DSH start.
//
// Nothing here writes a file or reads one. The caller resolves the secrets (a $NAME token in a
// header or an env value) and passes plain values; every text that leaves is redacted of them.
import { spawn } from 'node:child_process'
import { exchange, decodeRpc, mcpFailure, failureCode } from './mcp-http.mjs'

export const PROBE_LIMITS = { httpMs: 12000, stdioMs: 20000, tools: 200, stderrChars: 400, pages: 5 }
const PROTOCOL = '2024-11-05'
const CLIENT = { name: 'kybernos-connector-test', version: '1.0' }

/** Replaces every secret value (3 characters or more) in `text` by ***, and cuts it at `max`. */
export function redact(text, secrets, max) {
  let out = String(text === null || text === undefined ? '' : text)
  for (const s of (secrets || [])) {
    const v = String(s === null || s === undefined ? '' : s)
    if (v.length >= 3) out = out.split(v).join('***')
  }
  out = out.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
  return out.length > max ? out.slice(0, max) + '…' : out
}

/** `value` with every string in it redacted of the secrets; the structure (keys, numbers, booleans) is left alone. */
export function redactDeep(value, secrets, max) {
  if (typeof value === 'string') return redact(value, secrets, max)
  if (Array.isArray(value)) return value.map((x) => redactDeep(x, secrets, max))
  if (value !== null && typeof value === 'object') { const o = {}; for (const k of Object.keys(value)) o[k] = redactDeep(value[k], secrets, max); return o }
  return value
}

/** The tools of a tools/list result, as { name, description }. Anything else is dropped. */
function toolsOf(result) {
  const list = result !== null && typeof result === 'object' && Array.isArray(result.tools) ? result.tools : []
  const out = []
  for (const t of list) {
    if (t === null || typeof t !== 'object' || typeof t.name !== 'string' || t.name.length === 0) continue
    out.push({ name: t.name.slice(0, 120), description: typeof t.description === 'string' ? t.description.slice(0, 160) : '' })
    if (out.length >= PROBE_LIMITS.tools) break
  }
  return out
}

const serverOf = (result) => {
  const s = result !== null && typeof result === 'object' && result.serverInfo !== null && typeof result.serverInfo === 'object' ? result.serverInfo : {}
  return { name: typeof s.name === 'string' ? s.name.slice(0, 80) : '', version: typeof s.version === 'string' ? s.version.slice(0, 40) : '' }
}

// ── streamable-http ─────────────────────────────────────────────────────────

/**
 * Probes a streamable-http server. `headers` are plain values (secrets already resolved).
 * Resolves { ok: true, ms, server, tools } or { ok: false, ms, code, message, hint? }, where `code`
 * is the failure vocabulary the Composio calls already use: 401, 403, 404, 429, another status,
 * timeout, offline, bad-response, rpc-error. Never rejects.
 */
export async function probeHttp({ url, headers, timeoutMs, secrets }) {
  const t0 = Date.now()
  const total = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : PROBE_LIMITS.httpMs
  const left = () => Math.max(1, total - (Date.now() - t0))
  const base = { 'content-type': 'application/json', 'accept': 'application/json, text/event-stream' }
  let session = null
  let hint = null
  const post = async (body) => {
    const h = Object.assign({}, headers || {}, base)
    if (session !== null) h['mcp-session-id'] = session
    const out = await exchange(url, { method: 'POST', headers: h, body: JSON.stringify(body) }, left())
    const sid = out.res.headers !== null && out.res.headers !== undefined && typeof out.res.headers.get === 'function' ? out.res.headers.get('mcp-session-id') : null
    if (typeof sid === 'string' && sid.length > 0) session = sid
    if (out.res.ok !== true) {
      if (out.res.status === 401) {
        const auth = out.res.headers !== null && out.res.headers !== undefined && typeof out.res.headers.get === 'function' ? String(out.res.headers.get('www-authenticate') || '') : ''
        // A server that answers with an OAuth challenge cannot be used with a header alone.
        if (/resource_metadata|authorization_uri|oauth/i.test(auth)) hint = 'oauth'
      }
      throw mcpFailure(String(out.res.status))
    }
    return out.raw.trim().length === 0 ? null : decodeRpc(out.raw)
  }
  try {
    const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: CLIENT } })
    if (init === null || typeof init !== 'object') throw mcpFailure('bad-response')
    if (init.error !== undefined && init.error !== null) { const e = mcpFailure('rpc-error'); e.detail = init.error.message; throw e }
    if (init.result === undefined) throw mcpFailure('bad-response')
    const server = serverOf(init.result)
    try { await post({ jsonrpc: '2.0', method: 'notifications/initialized' }) } catch (e) { if (['timeout', 'offline'].indexOf(failureCode(e)) >= 0) throw e }
    const tools = []
    let cursor = null
    for (let page = 0; page < PROBE_LIMITS.pages; page += 1) {
      const reply = await post({ jsonrpc: '2.0', id: 2 + page, method: 'tools/list', params: cursor === null ? {} : { cursor: cursor } })
      if (reply === null || typeof reply !== 'object') throw mcpFailure('bad-response')
      if (reply.error !== undefined && reply.error !== null) { const e = mcpFailure('rpc-error'); e.detail = reply.error.message; throw e }
      tools.push(...toolsOf(reply.result))
      cursor = reply.result !== null && typeof reply.result === 'object' && typeof reply.result.nextCursor === 'string' && reply.result.nextCursor.length > 0 ? reply.result.nextCursor : null
      if (cursor === null || tools.length >= PROBE_LIMITS.tools) break
    }
    // Polite end of a session; nothing depends on it.
    if (session !== null) { try { await exchange(url, { method: 'DELETE', headers: Object.assign({}, headers || {}, { 'mcp-session-id': session }) }, 1500) } catch (e) { /* the server may not allow it */ } }
    return { ok: true, ms: Date.now() - t0, server: server, tools: tools.slice(0, PROBE_LIMITS.tools) }
  } catch (e) {
    const code = failureCode(e)
    const out = { ok: false, ms: Date.now() - t0, code: code, message: redact(e !== null && e !== undefined && typeof e.detail === 'string' ? e.detail : '', secrets, 200) }
    if (hint !== null) out.hint = hint
    return out
  }
}

// ── stdio ───────────────────────────────────────────────────────────────────

// The child's environment is what DSH gives a stdio server: the parent's, minus credential-shaped
// names and every DSH_* name, then the connector's own env (the same rule as @deepseek-ai/dsh-subprocess,
// which dsh-mcp-client uses). A test that saw more than the real start would pass for the wrong reason.
const SENSITIVE_ENV = /KEY|PASSWORD|SECRET|TOKEN/i
export function childEnv(parent, extra) {
  const env = {}
  for (const [k, v] of Object.entries(parent || {})) if (v !== undefined && !SENSITIVE_ENV.test(k) && !k.toUpperCase().startsWith('DSH_')) env[k] = v
  return Object.assign(env, extra || {})
}

/**
 * Probes a stdio server: spawns `command args`, speaks newline-delimited JSON-RPC, and kills the
 * process when done. `env` holds plain values. Resolves like probeHttp, with these `code`s:
 * spawn (cannot start: ENOENT, EACCES), exited (stopped before answering), timeout, bad-response,
 * rpc-error. `stderr` carries the end of what the server wrote there (redacted). Never rejects.
 */
export function probeStdio({ command, args, cwd, env, timeoutMs, secrets, parentEnv }) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    const total = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : PROBE_LIMITS.stdioMs
    let child = null
    let finished = false
    let out = ''
    let err = ''
    let noise = 0
    let server = { name: '', version: '' }
    const tools = []
    let timer = null
    let stage = 'initialize'
    const tail = () => redact(err.slice(-PROBE_LIMITS.stderrChars * 2), secrets, PROBE_LIMITS.stderrChars).trim()
    const finish = (result) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      if (child !== null) {
        try { child.stdin.end() } catch (e) { /* closed */ }
        try { child.kill('SIGTERM') } catch (e) { /* gone */ }
        const hard = setTimeout(() => { try { child.kill('SIGKILL') } catch (e) { /* gone */ } }, 500)
        hard.unref()
      }
      const base = { ms: Date.now() - t0 }
      if (result.ok !== true) { const s = tail(); if (s.length > 0) base.stderr = s }
      if (noise > 0) base.noise = noise
      resolve(Object.assign(base, result))
    }
    const send = (msg) => { try { child.stdin.write(JSON.stringify(msg) + '\n') } catch (e) { finish({ ok: false, code: 'exited', message: '' }) } }
    const onMessage = (m) => {
      if (m === null || typeof m !== 'object') return
      if (m.error !== undefined && m.error !== null && (m.id === 1 || m.id === 2)) return finish({ ok: false, code: 'rpc-error', message: redact(m.error.message, secrets, 200) })
      if (m.id === 1 && stage === 'initialize') {
        if (m.result === undefined) return finish({ ok: false, code: 'bad-response', message: '' })
        server = serverOf(m.result)
        stage = 'tools'
        send({ jsonrpc: '2.0', method: 'notifications/initialized' })
        send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
      } else if (m.id === 2 && stage === 'tools') {
        tools.push(...toolsOf(m.result))
        finish({ ok: true, server: server, tools: tools })
      }
    }
    try {
      child = spawn(command, Array.isArray(args) ? args : [], { cwd: cwd || undefined, env: childEnv(parentEnv === undefined ? process.env : parentEnv, env), stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (e) {
      return finish({ ok: false, code: 'spawn', message: e !== null && e !== undefined && typeof e.code === 'string' ? e.code : 'spawn' })
    }
    timer = setTimeout(() => finish({ ok: false, code: 'timeout', message: stage === 'initialize' ? 'no answer to initialize' : 'no answer to tools/list' }), total)
    child.on('error', (e) => finish({ ok: false, code: 'spawn', message: e !== null && e !== undefined && typeof e.code === 'string' ? e.code : 'spawn' }))
    child.on('exit', (code, signal) => finish({ ok: false, code: 'exited', message: signal !== null ? 'signal ' + signal : 'exit code ' + code }))
    child.stdin.on('error', () => { /* the child closed its input: the exit event says why */ })
    child.stderr.on('data', (d) => { err += String(d); if (err.length > 8000) err = err.slice(-8000) })
    child.stdout.on('data', (d) => {
      out += String(d)
      if (out.length > 4 * 1024 * 1024) return finish({ ok: false, code: 'bad-response', message: 'too much output' })
      let at
      while ((at = out.indexOf('\n')) >= 0) {
        const line = out.slice(0, at).trim()
        out = out.slice(at + 1)
        if (line.length === 0) continue
        let m = null
        try { m = JSON.parse(line) } catch (e) { noise += 1; continue }
        onMessage(m)
      }
    })
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: CLIENT } })
  })
}
