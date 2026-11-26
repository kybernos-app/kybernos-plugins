#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// chat-import — Import external chat histories into DSH session journals.
//
// Supported sources (v1):
//   - chatgpt : OpenAI `conversations.json` export (walks active mapping branch)
//   - claude  : Claude.ai `conversations.json` export OR Claude Code `.jsonl`
//   - cursor  : Cursor exported composer/chat `.json` / `.jsonl`
//   - codex   : Codex CLI `.jsonl` session rollout
//
// Usage:
//   node import-chats.mjs <file-or-dir> [--source auto|chatgpt|claude|cursor|codex]
//                         [--cwd <workspace>] [--dsh-home <dir>] [--limit N]
//                         [--dry-run] [--json]
//
// Zero external dependencies (uses Node built-in `node:zlib` zstdCompressSync).
// Deterministic deduplication by source hash; atomic writes (mode 0600).
// ═══════════════════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zstdCompressSync } from 'node:zlib'

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const str = (v) => (typeof v === 'string' ? v : '')
const MAX_TITLE_CHARS = 120
const MAX_MSG_CHARS = 100_000

const toMs = (ts, fallback = Date.now()) => {
  if (typeof ts === 'number' && Number.isFinite(ts) && ts > 0) {
    return ts < 1e12 ? Math.round(ts * 1000) : Math.round(ts)
  }
  if (typeof ts === 'string' && ts.trim() !== '') {
    const parsed = Date.parse(ts)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return fallback
}

const textFromBlocks = (content) => {
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (!isObj(part)) return ''
        if (typeof part.text === 'string') return part.text
        if (typeof part.content === 'string') return part.content
        return ''
      })
      .filter((s) => s.trim() !== '')
      .join('\n')
      .trim()
  }
  if (isObj(content)) {
    if (Array.isArray(content.parts)) return textFromBlocks(content.parts)
    if (typeof content.text === 'string') return content.text.trim()
  }
  return ''
}

const cleanTitle = (raw, fallback) => {
  const t = str(raw).replace(/\s+/g, ' ').trim()
  const pick = t !== '' ? t : str(fallback).replace(/\s+/g, ' ').trim()
  if (pick === '') return 'Imported chat'
  return pick.length > MAX_TITLE_CHARS ? pick.slice(0, MAX_TITLE_CHARS - 1) + '…' : pick
}

/** Encodes a workspace path into a DSH sessions slug (e.g. `/a/b` -> `--a-b--`). */
export function encodeSlugPath (cwd) {
  const norm = resolve(str(cwd) || homedir()).replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
  const segs = norm.split('/').filter(Boolean).map((s) => s.replace(/[^A-Za-z0-9._-]/g, (ch) => '~' + ch.charCodeAt(0).toString(16).padStart(4, '0')))
  return '--' + segs.join('-') + '--'
}

/** Deterministic, collision-resistant id for idempotent re-imports. */
export function deterministicSessionId (conv) {
  const firstText = conv.messages[0] ? conv.messages[0].text.slice(0, 200) : ''
  const seed = [conv.source, conv.sourceId || conv.title, firstText].join('\0')
  return 'imp-' + createHash('sha256').update(seed).digest('hex').slice(0, 12)
}

// ── 1. ChatGPT (`conversations.json`) ───────────────────────────────────────
export function parseChatGPT (rawText) {
  let data
  try { data = JSON.parse(rawText) } catch { return [] }
  const items = Array.isArray(data) ? data : (isObj(data) && isObj(data.mapping) ? [data] : [])
  const out = []

  for (const conv of items) {
    if (!isObj(conv) || !isObj(conv.mapping)) continue
    const mapping = conv.mapping
    // Walk from current_node back to root to keep only the active branch.
    const chain = []
    let nodeId = str(conv.current_node)
    if (nodeId === '' || !isObj(mapping[nodeId])) {
      // Fallback: pick deepest leaf node with a message.
      const ids = Object.keys(mapping)
      nodeId = ids[ids.length - 1] || ''
    }
    const visited = new Set()
    while (nodeId !== '' && isObj(mapping[nodeId]) && !visited.has(nodeId)) {
      visited.add(nodeId)
      chain.push(mapping[nodeId])
      nodeId = str(mapping[nodeId].parent)
    }
    chain.reverse()

    const createdAt = toMs(conv.create_time)
    const messages = []
    for (const node of chain) {
      const msg = isObj(node.message) ? node.message : null
      if (msg === null) continue
      const roleRaw = isObj(msg.author) ? str(msg.author.role) : ''
      if (roleRaw !== 'user' && roleRaw !== 'assistant') continue
      const text = textFromBlocks(msg.content).slice(0, MAX_MSG_CHARS)
      if (text === '') continue
      messages.push({ role: roleRaw, text, time: toMs(msg.create_time, createdAt + messages.length * 1000) })
    }
    if (messages.length === 0) continue
    out.push({
      source: 'chatgpt',
      sourceId: str(conv.id || conv.conversation_id || conv.title),
      title: cleanTitle(conv.title, messages[0].text),
      cwd: '',
      createdAt,
      messages
    })
  }
  return out
}

// ── 2. Claude.ai (`conversations.json`) & Claude Code (`.jsonl`) ────────────
export function parseClaude (rawText, fileHint = '') {
  const trimmed = str(rawText).trim()
  if (trimmed === '') return []

  // Case A: Claude.ai JSON export (array or single conversation with chat_messages)
  if (trimmed.startsWith('[') || (trimmed.startsWith('{') && trimmed.includes('"chat_messages"'))) {
    let data
    try { data = JSON.parse(trimmed) } catch { data = null }
    if (data !== null) {
      const items = Array.isArray(data) ? data : (isObj(data) ? [data] : [])
      const out = []
      for (const conv of items) {
        if (!isObj(conv) || !Array.isArray(conv.chat_messages)) continue
        const createdAt = toMs(conv.created_at)
        const messages = []
        for (const m of conv.chat_messages) {
          if (!isObj(m)) continue
          const sender = str(m.sender || m.role).toLowerCase()
          const role = sender === 'human' || sender === 'user' ? 'user' : (sender === 'assistant' ? 'assistant' : '')
          if (role === '') continue
          const text = (str(m.text).trim() || textFromBlocks(m.content)).slice(0, MAX_MSG_CHARS)
          if (text === '') continue
          messages.push({ role, text, time: toMs(m.created_at, createdAt + messages.length * 1000) })
        }
        if (messages.length === 0) continue
        out.push({
          source: 'claude',
          sourceId: str(conv.uuid || conv.id || conv.name),
          title: cleanTitle(conv.name || conv.title, messages[0].text),
          cwd: '',
          createdAt,
          messages
        })
      }
      if (out.length > 0) return out
    }
  }

  // Case B: Claude Code `.jsonl` session transcript
  const messages = []
  let sessionId = ''
  let cwd = ''
  let title = ''
  let createdAt = 0

  for (const line of trimmed.split('\n')) {
    if (line === '' || line.charCodeAt(0) !== 123) continue
    let ev
    try { ev = JSON.parse(line) } catch { continue }
    if (!isObj(ev)) continue
    if (sessionId === '' && typeof ev.sessionId === 'string') sessionId = ev.sessionId
    if (cwd === '' && typeof ev.cwd === 'string') cwd = ev.cwd
    if (title === '' && typeof ev.summary === 'string') title = ev.summary
    const t = toMs(ev.timestamp, 0)
    if (createdAt === 0 && t > 0) createdAt = t

    const evType = str(ev.type).toLowerCase()
    const msg = isObj(ev.message) ? ev.message : ev
    const roleRaw = str(msg.role || evType).toLowerCase()
    if (roleRaw !== 'user' && roleRaw !== 'assistant') continue
    if (ev.isMeta === true) continue
    const text = textFromBlocks(msg.content).slice(0, MAX_MSG_CHARS)
    if (text === '') continue
    messages.push({ role: roleRaw, text, time: t > 0 ? t : (createdAt || Date.now()) + messages.length * 1000 })
  }

  if (messages.length === 0) return []
  return [{
    source: 'claude',
    sourceId: sessionId || basename(fileHint || 'claude-session'),
    title: cleanTitle(title, messages[0].text),
    cwd,
    createdAt: createdAt || messages[0].time,
    messages
  }]
}

// ── 3. Cursor exported JSON / JSONL ─────────────────────────────────────────
export function parseCursor (rawText, fileHint = '') {
  const trimmed = str(rawText).trim()
  if (trimmed === '') return []
  let data = null
  try { data = JSON.parse(trimmed) } catch { data = null }

  const out = []
  const extractBubbles = (conv, fallbackId) => {
    const rawList = Array.isArray(conv.bubbles) ? conv.bubbles : (Array.isArray(conv.messages) ? conv.messages : (Array.isArray(conv.conversation) ? conv.conversation : []))
    const createdAt = toMs(conv.createdAt ?? conv.timestamp ?? conv.lastUpdatedAt)
    const messages = []
    for (const b of rawList) {
      if (!isObj(b)) continue
      let role = ''
      if (b.type === 1 || b.type === 'user' || b.role === 'user') role = 'user'
      else if (b.type === 2 || b.type === 'ai' || b.type === 'assistant' || b.role === 'assistant') role = 'assistant'
      if (role === '') continue
      const text = (str(b.text).trim() || str(b.rawText).trim() || textFromBlocks(b.content)).slice(0, MAX_MSG_CHARS)
      if (text === '') continue
      messages.push({ role, text, time: toMs(b.timestamp ?? b.createdAt, createdAt + messages.length * 1000) })
    }
    if (messages.length === 0) return null
    return {
      source: 'cursor',
      sourceId: str(conv.composerId || conv.tabId || conv.id || fallbackId),
      title: cleanTitle(conv.name || conv.title || conv.chatTitle, messages[0].text),
      cwd: str(conv.workspacePath || conv.cwd),
      createdAt,
      messages
    }
  }

  if (data !== null) {
    if (isObj(data) && Array.isArray(data.tabs)) {
      for (let i = 0; i < data.tabs.length; i += 1) {
        const c = extractBubbles(data.tabs[i], 'cursor-tab-' + i)
        if (c !== null) out.push(c)
      }
    } else if (Array.isArray(data)) {
      for (let i = 0; i < data.length; i += 1) {
        if (!isObj(data[i])) continue
        const c = extractBubbles(data[i], 'cursor-' + i)
        if (c !== null) out.push(c)
      }
    } else if (isObj(data)) {
      const c = extractBubbles(data, basename(fileHint || 'cursor-chat'))
      if (c !== null) out.push(c)
    }
  }
  return out
}

// ── 4. Codex CLI `.jsonl` rollout ───────────────────────────────────────────
export function parseCodex (rawText, fileHint = '') {
  const trimmed = str(rawText).trim()
  if (trimmed === '') return []
  const messages = []
  let sourceId = ''
  let cwd = ''
  let createdAt = 0

  for (const line of trimmed.split('\n')) {
    if (line === '' || line.charCodeAt(0) !== 123) continue
    let ev
    try { ev = JSON.parse(line) } catch { continue }
    if (!isObj(ev)) continue
    const t = toMs(ev.timestamp, 0)
    if (createdAt === 0 && t > 0) createdAt = t
    const payload = isObj(ev.payload) ? ev.payload : {}

    if (ev.type === 'session_meta') {
      if (sourceId === '' && typeof payload.id === 'string') sourceId = payload.id
      if (cwd === '' && typeof payload.cwd === 'string') cwd = payload.cwd
      continue
    }

    if (ev.type === 'response_item') {
      const role = str(payload.role).toLowerCase()
      if (role !== 'user' && role !== 'assistant') continue
      const text = textFromBlocks(payload.content).slice(0, MAX_MSG_CHARS)
      if (text === '') continue
      messages.push({ role, text, time: t > 0 ? t : (createdAt || Date.now()) + messages.length * 1000 })
      continue
    }

    if (ev.type === 'event_msg') {
      const ptype = str(payload.type)
      if (ptype === 'user_message' && typeof payload.message === 'string' && payload.message.trim() !== '') {
        messages.push({ role: 'user', text: payload.message.trim().slice(0, MAX_MSG_CHARS), time: t > 0 ? t : (createdAt || Date.now()) + messages.length * 1000 })
      } else if (ptype === 'agent_message' && typeof payload.message === 'string' && payload.message.trim() !== '') {
        messages.push({ role: 'assistant', text: payload.message.trim().slice(0, MAX_MSG_CHARS), time: t > 0 ? t : (createdAt || Date.now()) + messages.length * 1000 })
      }
    }
  }

  if (messages.length === 0) return []
  return [{
    source: 'codex',
    sourceId: sourceId || basename(fileHint || 'codex-rollout'),
    title: cleanTitle('', messages[0].text),
    cwd,
    createdAt: createdAt || messages[0].time,
    messages
  }]
}

/** Auto-detects the export format from file text. */
export function detectSource (rawText) {
  const sample = str(rawText).slice(0, 64_000)
  if (sample.includes('"mapping"') && sample.includes('"current_node"')) return 'chatgpt'
  if (sample.includes('"chat_messages"')) return 'claude'
  if (sample.includes('"session_meta"') || sample.includes('"response_item"')) return 'codex'
  if (sample.includes('"bubbles"') || sample.includes('"composerId"') || sample.includes('"tabs"')) return 'cursor'
  if (sample.includes('"sessionId"') && (sample.includes('"type":"user"') || sample.includes('"type": "user"'))) return 'claude'
  return 'unknown'
}

export function parseExport (rawText, { source = 'auto', fileHint = '' } = {}) {
  const picked = source === 'auto' ? detectSource(rawText) : source
  if (picked === 'chatgpt') return parseChatGPT(rawText)
  if (picked === 'claude') return parseClaude(rawText, fileHint)
  if (picked === 'cursor') return parseCursor(rawText, fileHint)
  if (picked === 'codex') return parseCodex(rawText, fileHint)
  return []
}

/** Serializes a normalized conversation into DSH session JSONL lines. */
export function buildDshJournal (conv, { sessionId, cwd }) {
  const targetCwd = resolve(str(cwd) || str(conv.cwd) || homedir())
  const lines = [
    JSON.stringify({
      type: 'session',
      id: 'session-' + sessionId,
      cwd: targetCwd,
      createdAt: conv.createdAt,
      meta: { importedFrom: conv.source, sourceId: conv.sourceId }
    }),
    JSON.stringify({
      type: 'session/title',
      time: conv.createdAt,
      data: { title: conv.title }
    })
  ]

  for (const m of conv.messages) {
    if (m.role === 'user') {
      lines.push(JSON.stringify({
        type: 'user/message',
        time: m.time,
        data: { source: { kind: 'user' }, content: [{ type: 'text', text: m.text }] }
      }))
    } else {
      lines.push(JSON.stringify({
        type: 'assistant/message',
        time: m.time,
        data: { message: { content: [{ type: 'text', text: m.text }] } }
      }))
    }
  }
  return lines.join('\n') + '\n'
}

/**
 * Imports one file or a directory of `.json`/`.jsonl` exports into `<dshHome>/sessions/`.
 * When `dryRun` is true, writes nothing and returns the full preview report.
 */
export function importPath (inputPath, opts = {}) {
  const target = resolve(str(inputPath))
  if (!existsSync(target)) return { ok: false, error: 'input-not-found', path: target }

  const files = []
  const st = statSync(target)
  if (st.isDirectory()) {
    for (const entry of readdirSync(target)) {
      if (!/\.(json|jsonl)$/i.test(entry)) continue
      const full = join(target, entry)
      try { if (statSync(full).isFile()) files.push(full) } catch { /* skip */ }
    }
    files.sort()
  } else if (st.isFile()) {
    files.push(target)
  }

  const dshHome = resolve(str(opts.dshHome) || process.env.DSH_HOME || join(homedir(), '.dsh'))
  const sessionsHome = join(dshHome, 'sessions')
  const dryRun = opts.dryRun === true
  const limit = Number.isFinite(opts.limit) && opts.limit > 0 ? Math.floor(opts.limit) : Infinity
  const sourceOpt = str(opts.source) || 'auto'

  const imported = []
  const skipped = []
  const errors = []
  let seenCount = 0

  for (const file of files) {
    let raw
    try { raw = readFileSync(file, 'utf8') } catch (e) { errors.push({ file, error: String(e.message) }); continue }
    const convs = parseExport(raw, { source: sourceOpt, fileHint: file })
    if (convs.length === 0) {
      errors.push({ file, error: 'no-conversations-found' })
      continue
    }

    for (const conv of convs) {
      if (seenCount >= limit) break
      seenCount += 1
      const id = deterministicSessionId(conv)
      const targetCwd = resolve(str(opts.cwd) || str(conv.cwd) || homedir())
      const slug = encodeSlugPath(targetCwd)
      const outDir = join(sessionsHome, slug, 'session-' + id)
      const outFile = join(outDir, 'session.v4.jsonl.zstd')

      if (existsSync(outFile)) {
        skipped.push({ id, source: conv.source, title: conv.title, reason: 'already-imported', file: outFile })
        continue
      }

      if (!dryRun) {
        mkdirSync(outDir, { recursive: true, mode: 0o700 })
        const jsonl = buildDshJournal(conv, { sessionId: id, cwd: targetCwd })
        const compressed = zstdCompressSync(Buffer.from(jsonl, 'utf8'))
        const tmp = outFile + '.tmp-' + process.pid
        writeFileSync(tmp, compressed, { mode: 0o600 })
        renameSync(tmp, outFile)
        try { chmodSync(outFile, 0o600) } catch { /* ignore */ }
      }

      imported.push({
        id,
        source: conv.source,
        title: conv.title,
        messages: conv.messages.length,
        cwd: targetCwd,
        file: outFile
      })
    }
  }

  return {
    ok: true,
    dryRun,
    dshHome,
    counts: { imported: imported.length, skipped: skipped.length, errors: errors.length },
    imported,
    skipped,
    errors
  }
}

// ── CLI entry point ─────────────────────────────────────────────────────────
const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (isMain) {
  const args = process.argv.slice(2)
  const flagVal = (name) => {
    const i = args.indexOf('--' + name)
    return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined
  }
  const hasFlag = (name) => args.includes('--' + name)
  const positional = args.filter((a, i) => !a.startsWith('--') && (i === 0 || !['--source', '--cwd', '--dsh-home', '--limit'].includes(args[i - 1])))

  if (positional.length === 0 || hasFlag('help') || hasFlag('h')) {
    console.log('Usage: node import-chats.mjs <file-or-dir> [--source auto|chatgpt|claude|cursor|codex] [--cwd <dir>] [--dsh-home <dir>] [--limit N] [--dry-run] [--json]')
    process.exit(positional.length === 0 ? 1 : 0)
  }

  const res = importPath(positional[0], {
    source: flagVal('source') || 'auto',
    cwd: flagVal('cwd'),
    dshHome: flagVal('dsh-home'),
    limit: flagVal('limit') ? Number(flagVal('limit')) : undefined,
    dryRun: hasFlag('dry-run')
  })

  if (hasFlag('json')) {
    console.log(JSON.stringify(res, null, 2))
  } else if (!res.ok) {
    console.error('Import failed: ' + res.error)
  } else {
    const mode = res.dryRun ? '[dry-run] ' : ''
    console.log(mode + 'imported: ' + res.counts.imported + ', skipped (duplicates): ' + res.counts.skipped + ', errors: ' + res.counts.errors)
    for (const item of res.imported.slice(0, 15)) {
      console.log('  + [' + item.source + '] ' + item.title + ' (' + item.messages + ' msgs) -> ' + item.id)
    }
  }
  process.exit(res.ok ? 0 : 1)
}
