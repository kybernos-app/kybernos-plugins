// ═══════════════════════════════════════════════════════════════════════════
// kybernos-usage — Context Insight analyzer (read-only session breakdown).
//
// Reads a session's local `.jsonl.zstd` journal (multi-frame zstd via Node's
// built-in `zstdDecompressSync`) and produces a privacy-safe, aggregate
// breakdown of what fills the active context window since the last compaction:
//   - tool outputs (plus top 5 heaviest tools paired via callId);
//   - user messages & assistant replies (conversation);
//   - injected runtime context (memory, skills, reminders);
//   - system prompt / tool definitions (when present in request/header);
//   - real token usage & cache hit rate, compaction history, shell savings.
//
// Never returns raw message text, tool arguments, or file paths.
// ═══════════════════════════════════════════════════════════════════════════

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

export const CHARS_PER_TOKEN = 4
export const MAX_ZSTD_BYTES = 64 * 1024 * 1024
export const MAX_CACHE_ENTRIES = 64
const TOP_TOOLS_LIMIT = 5

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const str = (v) => (typeof v === 'string' ? v : '')
const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)

/** Safe single-segment session id, or '' when invalid. */
export function safeSessionId (raw) {
  const cleaned = str(raw).trim().replace(/^session-/, '')
  if (cleaned === '' || cleaned.length > 80 || cleaned === '.' || cleaned === '..' || cleaned.includes('..')) return ''
  if (!/^[A-Za-z0-9._-]+$/.test(cleaned)) return ''
  return cleaned
}

/**
 * Decodes concatenated zstd frames (same method as kybernos-search/zstd-frames.mjs).
 */
export function zstdFrames (buf) {
  const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
  const parts = []
  let cursor = 0
  while (cursor < buf.length - 4) {
    let start = cursor
    let out = null
    while (start <= buf.length - 4) {
      const at = buf.indexOf(magic, start)
      if (at < 0) break
      const next = buf.indexOf(magic, at + 4)
      const end = next < 0 ? buf.length : next
      try {
        const txt = zstdDecompressSync(buf.subarray(at, end)).toString('utf8')
        if (txt.startsWith('{')) { out = { txt, end }; break }
      } catch { /* candidate fell inside previous frame */ }
      start = at + 1
    }
    if (out === null) break
    parts.push(out.txt)
    cursor = out.end
  }
  return parts.join('')
}

const contentLength = (content) => {
  if (typeof content === 'string') return content.length
  if (!Array.isArray(content)) return 0
  let total = 0
  for (const block of content) {
    if (!isObj(block)) continue
    if (typeof block.text === 'string') total += block.text.length
    else if (typeof block.thinking === 'string') total += block.thinking.length
    else if (typeof block.input === 'string') total += block.input.length
    else if (isObj(block.input)) { try { total += JSON.stringify(block.input).length } catch { /* ignore */ } }
  }
  return total
}

const contentHasCompressionMarker = (content) => {
  if (typeof content === 'string') return content.includes('[kybernos: shell output compressed')
  if (!Array.isArray(content)) return false
  for (const block of content) {
    if (isObj(block) && typeof block.text === 'string' && block.text.includes('[kybernos: shell output compressed')) return true
  }
  return false
}

const toTokens = (chars) => Math.round(chars / CHARS_PER_TOKEN)

/**
 * Analyzes a decoded JSONL session journal into an aggregate, privacy-safe
 * Context Insight summary. Pure function (no disk, no clock).
 */
export function analyzeJournal (jsonlText) {
  const callNames = new Map() // callId -> toolName

  // Active-window accumulators (reset on each compaction/summary so they mirror
  // what is currently sitting in the prompt window).
  const resetActive = () => ({
    userChars: 0,
    userMsgs: 0,
    injectedChars: 0,
    injectedMsgs: 0,
    assistantChars: 0,
    assistantMsgs: 0,
    toolChars: 0,
    toolCount: 0,
    summaryChars: 0,
    turns: 0,
    byTool: new Map() // name -> { chars, calls }
  })

  let active = resetActive()
  let systemChars = 0
  let toolDefsCount = 0
  let model = { provider: '', model: '', contextWindow: null }
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  const compactions = { count: 0, failures: 0, lastAt: null }
  let compressedCount = 0
  let totalEvents = 0

  for (const line of str(jsonlText).split('\n')) {
    if (line === '' || line.charCodeAt(0) !== 123) continue
    let ev
    try { ev = JSON.parse(line) } catch { continue }
    if (!isObj(ev)) continue
    totalEvents += 1
    const type = str(ev.type)
    const data = isObj(ev.data) ? ev.data : {}
    const at = typeof ev.time === 'number' ? ev.time : null

    if (type === 'request/header') {
      const h = isObj(data.header) ? data.header : data
      const cfg = isObj(h.config) ? h.config : h
      if (typeof cfg.provider === 'string' && cfg.provider !== '') model.provider = cfg.provider
      if (typeof cfg.model === 'string' && cfg.model !== '') model.model = cfg.model
      if (typeof cfg.contextWindow === 'number' && cfg.contextWindow > 0) model.contextWindow = cfg.contextWindow
      if (typeof h.systemPrompt === 'string') systemChars = h.systemPrompt.length
      if (Array.isArray(h.tools)) {
        toolDefsCount = h.tools.length
        try { systemChars = Math.max(systemChars, JSON.stringify(h.tools).length) } catch { /* ignore */ }
      }
      continue
    }

    if (type === 'model/selection') {
      const r = isObj(data.route) ? data.route : data
      if (typeof r.provider === 'string' && r.provider !== '') model.provider = r.provider
      if (typeof r.model === 'string' && r.model !== '') model.model = r.model
      continue
    }

    if (type === 'compaction/summary') {
      compactions.count += 1
      if (at !== null) compactions.lastAt = at
      active = resetActive()
      active.summaryChars = contentLength(data.summary ?? data.content ?? (isObj(data.message) ? data.message.content : ''))
      continue
    }

    if (type === 'compaction/end') {
      if (data.ok === false || isObj(data.error) || data.status === 'failed' || data.status === 'error') {
        compactions.failures += 1
      }
      continue
    }

    if (type === 'turn/start') {
      active.turns += 1
      continue
    }

    if (type === 'user/message') {
      const kind = isObj(data.source) ? data.source.kind : null
      const len = contentLength(data.content)
      if (kind !== null && kind !== undefined && kind !== 'user') {
        active.injectedChars += len
        active.injectedMsgs += 1
      } else {
        active.userChars += len
        active.userMsgs += 1
      }
      continue
    }

    if (type === 'assistant/message') {
      const m = isObj(data.message) ? data.message : {}
      active.assistantChars += contentLength(m.content)
      active.assistantMsgs += 1
      const u = isObj(data.usage) ? data.usage : (isObj(m.usage) ? m.usage : null)
      if (u !== null) {
        usage.input += num(u.inputTokens ?? u.uncachedInputTokens)
        usage.output += num(u.outputTokens)
        usage.cacheRead += num(u.cacheReadTokens)
        usage.cacheWrite += num(u.cacheWriteTokens)
      }
      continue
    }

    if (type === 'tool/call') {
      const callId = str(data.callId)
      const toolName = str(data.name).slice(0, 60)
      if (callId !== '' && toolName !== '') callNames.set(callId, toolName)
      const argLen = isObj(data.arguments) ? (() => { try { return JSON.stringify(data.arguments).length } catch { return 0 } })() : str(data.arguments).length
      active.assistantChars += argLen
      continue
    }

    if (type === 'tool/result') {
      const msg = isObj(data.message) ? data.message : {}
      const len = contentLength(msg.content ?? data.content)
      const source = isObj(msg.source) ? msg.source : {}
      const callId = str(source.callId || data.callId)
      const name = str(source.toolName || data.name || (callId !== '' ? callNames.get(callId) : '') || 'tool').slice(0, 60)
      active.toolChars += len
      active.toolCount += 1
      const bucket = active.byTool.get(name) || { chars: 0, calls: 0 }
      bucket.chars += len
      bucket.calls += 1
      active.byTool.set(name, bucket)
      if (contentHasCompressionMarker(msg.content ?? data.content)) compressedCount += 1
    }
  }

  const userTokens = toTokens(active.userChars)
  const assistantTokens = toTokens(active.assistantChars)
  const injectedTokens = toTokens(active.injectedChars + active.summaryChars)
  const toolTokens = toTokens(active.toolChars)
  const systemTokens = toTokens(systemChars)
  const totalTokens = userTokens + assistantTokens + injectedTokens + toolTokens + systemTokens

  const topTools = Array.from(active.byTool.entries())
    .map(([name, b]) => {
      const tokens = toTokens(b.chars)
      return {
        name,
        tokens,
        calls: b.calls,
        share: totalTokens > 0 ? Math.round((tokens / totalTokens) * 1000) / 1000 : 0
      }
    })
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, TOP_TOOLS_LIMIT)

  const totalPromptUsage = usage.input + usage.cacheRead + usage.cacheWrite
  const cacheHitRate = totalPromptUsage > 0 ? Math.round((usage.cacheRead / totalPromptUsage) * 1000) / 1000 : null

  return {
    totalEvents,
    model,
    active: {
      totalTokens,
      conversationTokens: userTokens + assistantTokens,
      userTokens,
      assistantTokens,
      injectedTokens,
      toolTokens,
      systemTokens,
      toolDefsCount,
      toolCount: active.toolCount,
      turns: active.turns,
      userMsgs: active.userMsgs,
      assistantMsgs: active.assistantMsgs,
      injectedMsgs: active.injectedMsgs,
      topTools
    },
    usage: {
      ...usage,
      cacheHitRate
    },
    compactions,
    compression: {
      compressedCount
    }
  }
}

/**
 * Finds the newest `session.v*.jsonl.zstd` file for `sessionId` under `sessionsHome`.
 * Returns `{ file, mtimeMs, size }` or `null`.
 */
export function findSessionJournal (sessionsHome, rawSessionId) {
  const sid = safeSessionId(rawSessionId)
  if (sid === '' || !sessionsHome || !existsSync(sessionsHome)) return null
  let best = null
  let workspaces
  try { workspaces = readdirSync(sessionsHome) } catch { return null }
  for (const ws of workspaces) {
    const wsDir = join(sessionsHome, ws)
    try { if (!statSync(wsDir).isDirectory()) continue } catch { continue }
    const candidates = [join(wsDir, 'session-' + sid), join(wsDir, sid)]
    for (const sdir of candidates) {
      if (!existsSync(sdir)) continue
      let files
      try { files = readdirSync(sdir) } catch { continue }
      for (const f of files) {
        if (!/^session\.v\d+\.jsonl\.zstd$/.test(f)) continue
        const full = join(sdir, f)
        try {
          const st = statSync(full)
          if (!st.isFile()) continue
          if (best === null || st.mtimeMs > best.mtimeMs) {
            best = { file: full, mtimeMs: st.mtimeMs, size: st.size }
          }
        } catch { /* skip */ }
      }
    }
  }
  return best
}

/**
 * Creates a cached, bounded context-insight reader backed by `<DSH home>/sessions`.
 */
export function createContextReader ({ sessionsHome }) {
  const cache = new Map() // sid -> { mtimeMs, data }

  return {
    read (rawSessionId) {
      const sid = safeSessionId(rawSessionId)
      if (sid === '') return { ok: false, error: 'missing-session' }
      const found = findSessionJournal(sessionsHome, sid)
      if (found === null) return { ok: false, error: 'session-not-found' }
      if (found.size > MAX_ZSTD_BYTES) return { ok: false, error: 'journal-too-large' }

      const hit = cache.get(sid)
      if (hit !== undefined && hit.mtimeMs === found.mtimeMs) {
        return { ok: true, session: sid, ...hit.data }
      }

      let raw
      try {
        const buf = readFileSync(found.file)
        raw = zstdFrames(buf)
      } catch {
        return { ok: false, error: 'journal-unreadable' }
      }

      const data = analyzeJournal(raw)
      if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value)
      cache.set(sid, { mtimeMs: found.mtimeMs, data })
      return { ok: true, session: sid, ...data }
    }
  }
}
