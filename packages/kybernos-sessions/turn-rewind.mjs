// ═══════════════════════════════════════════════════════════════════════════
// kybernos-sessions — Turn Rewind (persistent pre-mutation Change Ledger).
//
// Captures bounded, content-addressed pre-mutation file snapshots per turn via
// DSH host hooks (`session/event` + `tools/pre-execute`), works identically in
// git repositories and plain non-git folders, and restores files safely:
//   - dry-run preview first (`exec !== true`), no disk writes;
//   - automatic rescue checkpoint saved before touching any workspace file;
//   - strict confinement inside workspace realpath, `.git/` never touched;
//   - bounded history (64 turns/session, 200 files/turn, 4 MiB/file cap);
//   - zero engine patches, every hook guarded so it can never break a turn.
// ═══════════════════════════════════════════════════════════════════════════

import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export const MAX_TURNS = 64
export const MAX_FILES_PER_TURN = 200
export const MAX_FILE_BYTES = 4 * 1024 * 1024
export const MAX_PROMPT_CHARS = 120

export const REWIND_TEXTS = {
  'missing-session': 'missing session identifier',
  'turn-not-found': 'checkpoint not found for this chat',
  'folder-not-found': 'folder not found',
  'nothing-to-rewind': 'nothing to restore — every file already matches that point',
  'rewound': 'restored {files} (a rescue point was saved first)',
  'rewind-partial': 'restored {files}, skipped {skipped} (a rescue point was saved first)',
  'rewind-failed': 'restore refused: {detail}'
}

const countOf = (n, one, many) => n + ' ' + (n === 1 ? one : many)
export const rewindText = (code, p = {}) => String(REWIND_TEXTS[code] || code).replace(/\{(\w+)\}/g, (m, k) => (p[k] !== undefined ? String(p[k]) : m))

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const str = (v) => (typeof v === 'string' ? v : '')
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const SHA_RE = /^[0-9a-f]{64}$/
const REMINDER_RE = /<system-reminder>[\s\S]*?<\/system-reminder>/g

/** Safe single-segment directory name for a session id, or '' when invalid. */
export function safeSessionId (raw) {
  const cleaned = str(raw).trim().replace(/^session-/, '')
  if (cleaned === '' || cleaned.length > 80 || cleaned === '.' || cleaned === '..' || cleaned.includes('..')) return ''
  if (!/^[A-Za-z0-9._-]+$/.test(cleaned)) return ''
  return cleaned
}

const expandHome = (p, home = homedir()) => (p === '~' || p.startsWith('~/') ? home + p.slice(1) : p)

/** Normalize a relative path to POSIX separators without leading `./`. */
const toPosixRel = (rel) => rel.split(sep).join('/').replace(/^\.\/+/, '')

/**
 * Resolves `rawPath` and guarantees that neither the path nor any existing
 * symlink ancestor escapes `workspaceRoot`, and that it never enters `.git/`.
 * Returns `{ absPath, relPath }` or `null`.
 */
export function resolveConfined (workspaceRoot, rawPath, currentDir = '', home = homedir()) {
  const rootStr = str(workspaceRoot).trim()
  const targetStr = str(rawPath).trim()
  if (rootStr === '' || targetStr === '' || targetStr.includes('\0')) return null
  let realRoot
  try { realRoot = realpathSync(rootStr) } catch { return null }

  const expanded = expandHome(targetStr, home)
  const base = str(currentDir).trim() !== '' ? str(currentDir).trim() : realRoot
  const candidate = isAbsolute(expanded) ? resolve(expanded) : resolve(base, expanded)

  // Walk upward to the deepest existing ancestor to defeat symlink escapes.
  let probe = candidate
  const tail = []
  while (!existsSync(probe)) {
    const parent = dirname(probe)
    if (parent === probe) return null
    tail.unshift(probe.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)))
    probe = parent
  }
  let realAncestor
  try { realAncestor = realpathSync(probe) } catch { return null }
  const resolved = tail.length > 0 ? resolve(realAncestor, ...tail) : realAncestor

  const rel = relative(realRoot, resolved)
  if (rel === '' || rel === '.' || rel.startsWith('..') || isAbsolute(rel)) return null
  const posix = toPosixRel(rel)
  if (posix === '' || posix === '.git' || posix.startsWith('.git/') || posix.split('/').includes('..')) return null
  return { absPath: resolved, relPath: posix }
}

/** Extract file paths from Codex-style `apply_patch` input. */
export function patchPaths (input) {
  const out = []
  for (const m of str(input).matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)) {
    const p = m[1].trim()
    if (p !== '') out.push(p)
  }
  return out
}

const stripHeredocs = (cmd) => {
  const lines = str(cmd).split('\n')
  const kept = []
  let end = null
  for (const line of lines) {
    if (end !== null) { if (line.trim() === end) end = null; continue }
    const m = /<<-?\s*(?:"([^"]*)"|'([^']*)'|([A-Za-z_][A-Za-z0-9_]*))/.exec(line)
    kept.push(line)
    if (m !== null) end = m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3])
  }
  return kept.join('\n')
}

const looksLikeLiteralPath = (tok) => {
  if (tok === '' || tok.startsWith('-') || tok === '/dev/null') return false
  if (/[$*?`{}()[\];|&<>!]/.test(tok)) return false
  return true
}

const unquote = (tok) => tok.replace(/^["']|["']$/g, '')

/**
 * Best-effort extraction of target file paths from a shell command (redirections,
 * `tee`, `rm`, `mv`, `cp`). Never throws; only literal non-glob paths are kept.
 */
export function shellMutationPaths (command) {
  const clean = stripHeredocs(command)
  if (clean.trim() === '') return []
  const out = new Set()
  const add = (raw) => {
    const t = unquote(str(raw).trim())
    if (looksLikeLiteralPath(t)) out.add(t)
  }

  // Output redirections: `> file`, `>> "file name"`
  for (const m of clean.matchAll(/(?:^|[^|&>=])>{1,2}\s*(?![0-9=&])("[^"]*"|'[^']*'|[^\s;|&)]+)/g)) add(m[1])

  // Split by simple command separators for rm / mv / cp / tee
  for (const seg of clean.split(/[;\n]|&&|\|\|/)) {
    const tokens = (seg.trim().match(/"[^"]*"|'[^']*'|\S+/g) || []).map(unquote)
    if (tokens.length < 2) continue
    const cmd = tokens[0]
    if (cmd === 'rm' || cmd === 'tee') {
      for (let i = 1; i < tokens.length; i += 1) {
        if (tokens[i] === '--') continue
        if (tokens[i].startsWith('-')) continue
        add(tokens[i])
      }
    } else if (cmd === 'mv' || cmd === 'cp') {
      const args = tokens.slice(1).filter((t) => t !== '--' && !t.startsWith('-'))
      if (args.length >= 2) {
        // Snapshot both source (for mv) and destination
        if (cmd === 'mv') for (const a of args) add(a)
        else add(args[args.length - 1])
      }
    }
  }
  return Array.from(out)
}

const DIRECT_WRITE_TOOLS = new Set([
  'write', 'write_file', 'file_write',
  'edit', 'edit_file', 'file_edit',
  'multi_edit', 'multiedit',
  'str_replace', 'str_replace_editor',
  'notebook_write', 'notebook_edit',
  'delete_file', 'remove_file'
])

/**
 * Extracts workspace-candidate file paths that a DSH tool call may mutate.
 * Pure function, safe against arbitrary malformed inputs.
 */
export function extractMutationPaths (toolName, args) {
  const name = str(toolName).trim()
  const a = isObj(args) ? args : {}
  if (name === '') return []

  if (name === 'apply_patch') return patchPaths(a.input ?? a.patch)

  if (name === 'bash' || name === 'pwsh') return shellMutationPaths(a.command)

  if (DIRECT_WRITE_TOOLS.has(name)) {
    if (name === 'str_replace_editor' && str(a.command) === 'view') return []
    const out = new Set()
    for (const key of ['file_path', 'path', 'target_file', 'notebook_path', 'Path']) {
      const v = str(a[key]).trim()
      if (v !== '') out.add(v)
    }
    if (Array.isArray(a.edits)) {
      for (const item of a.edits) {
        if (!isObj(item)) continue
        const v = str(item.file_path ?? item.path).trim()
        if (v !== '') out.add(v)
      }
    }
    return Array.from(out)
  }

  return []
}

/** Extract clean, short prompt preview from a DSH `user/message` event. */
export function promptFromContent (content) {
  let raw = ''
  if (typeof content === 'string') raw = content
  else if (Array.isArray(content)) {
    raw = content.filter((b) => isObj(b) && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join(' ')
  }
  const clean = raw.replace(REMINDER_RE, '').replace(/\s+/g, ' ').trim()
  if (clean.length <= MAX_PROMPT_CHARS) return clean
  return clean.slice(0, MAX_PROMPT_CHARS - 1) + '…'
}

const writeAtomic = (filePath, data, mode = 0o600) => {
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 })
  const tmp = filePath + '.tmp-' + process.pid + '-' + randomUUID().slice(0, 8)
  writeFileSync(tmp, data, { mode })
  renameSync(tmp, filePath)
  try { chmodSync(filePath, mode) } catch { /* Windows / restricted fs */ }
}

const removeEmptyParents = (filePath, realRoot) => {
  let dir = dirname(filePath)
  while (dir !== realRoot && dir.startsWith(realRoot + sep)) {
    let entries
    try { entries = readdirSync(dir) } catch { break }
    if (entries.length > 0) break
    try { rmdirSync(dir) } catch { break }
    dir = dirname(dir)
  }
}

/**
 * Creates a persistent Change Ledger store under `rootDir` (typically `<DSH home>/kybernos/rewind`).
 */
export function createRewindLedger ({ rootDir, now = () => Date.now(), home = homedir() }) {
  const sessionDirOf = (sid) => join(rootDir, sid)
  const blobsDirOf = (sid) => join(rootDir, sid, 'blobs')
  const ledgerFileOf = (sid) => join(rootDir, sid, 'ledger.json')

  const readLedger = (rawSessionId) => {
    const sid = safeSessionId(rawSessionId)
    if (sid === '') return null
    const file = ledgerFileOf(sid)
    if (!existsSync(file)) return { version: 1, sessionId: sid, cwd: '', turns: [] }
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'))
      if (!isObj(parsed) || !Array.isArray(parsed.turns)) return { version: 1, sessionId: sid, cwd: '', turns: [] }
      return {
        version: 1,
        sessionId: sid,
        cwd: str(parsed.cwd),
        turns: parsed.turns.filter((t) => isObj(t) && typeof t.id === 'string' && isObj(t.files))
      }
    } catch {
      return { version: 1, sessionId: sid, cwd: '', turns: [] }
    }
  }

  const writeBlob = (sid, buf) => {
    const hash = sha256(buf)
    const dir = blobsDirOf(sid)
    const file = join(dir, hash)
    if (!existsSync(file)) writeAtomic(file, buf, 0o600)
    return hash
  }

  const readBlob = (sid, hash) => {
    if (!SHA_RE.test(str(hash))) return null
    const file = join(blobsDirOf(sid), hash)
    if (!existsSync(file)) return null
    try { return readFileSync(file) } catch { return null }
  }

  const pruneAndSave = (ledger) => {
    const sid = ledger.sessionId
    if (ledger.turns.length > MAX_TURNS) {
      ledger.turns = ledger.turns.slice(ledger.turns.length - MAX_TURNS)
    }
    writeAtomic(ledgerFileOf(sid), JSON.stringify(ledger, null, 2), 0o600)

    // Garbage-collect blobs no longer referenced by any kept turn.
    const bdir = blobsDirOf(sid)
    if (!existsSync(bdir)) return
    const keep = new Set()
    for (const t of ledger.turns) {
      for (const entry of Object.values(t.files)) {
        if (isObj(entry) && typeof entry.sha256 === 'string') keep.add(entry.sha256)
      }
    }
    try {
      for (const name of readdirSync(bdir)) {
        if (SHA_RE.test(name) && !keep.has(name)) {
          try { rmSync(join(bdir, name), { force: true }) } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
  }

  const snapshotFile = (sid, absPath) => {
    let st
    try { st = lstatSync(absPath) } catch (e) {
      if (e && e.code === 'ENOENT') return { existed: false }
      return { existed: true, skipped: 'unreadable' }
    }
    if (st.isSymbolicLink()) return { existed: true, skipped: 'symlink' }
    if (!st.isFile()) return null
    if (st.size > MAX_FILE_BYTES) return { existed: true, skipped: 'too-large', size: st.size }
    try {
      const buf = readFileSync(absPath)
      const hash = writeBlob(sid, buf)
      return { existed: true, sha256: hash, size: buf.length, mode: st.mode & 0o777 }
    } catch {
      return { existed: true, skipped: 'unreadable' }
    }
  }

  /**
   * Records a pre-mutation snapshot for `rawPath` inside `cwd` on `turnId`.
   * First-touch semantics: if `relPath` was already captured for this turn, it is kept as-is.
   */
  const recordPreMutation = ({ sessionId, cwd, turnId, prompt = '', rawPath, currentDir = '' }) => {
    const sid = safeSessionId(sessionId)
    if (sid === '') return { ok: false, reason: 'missing-session' }
    const confined = resolveConfined(cwd, rawPath, currentDir, home)
    if (confined === null) return { ok: false, reason: 'outside-workspace' }

    const ledger = readLedger(sid)
    if (ledger.cwd === '') ledger.cwd = realpathSync(cwd)

    let turn = ledger.turns.find((t) => t.id === turnId)
    if (turn === undefined) {
      turn = { id: turnId, kind: 'turn', at: now(), prompt: str(prompt).slice(0, MAX_PROMPT_CHARS), files: {} }
      ledger.turns.push(turn)
    } else if (turn.prompt === '' && prompt !== '') {
      turn.prompt = str(prompt).slice(0, MAX_PROMPT_CHARS)
    }

    if (Object.prototype.hasOwnProperty.call(turn.files, confined.relPath)) {
      return { ok: true, alreadyCaptured: true, path: confined.relPath }
    }
    if (Object.keys(turn.files).length >= MAX_FILES_PER_TURN) {
      return { ok: false, reason: 'turn-file-limit' }
    }

    const snap = snapshotFile(sid, confined.absPath)
    if (snap === null) return { ok: false, reason: 'not-a-file' }
    turn.files[confined.relPath] = snap
    pruneAndSave(ledger)
    return { ok: true, captured: true, path: confined.relPath, snapshot: snap }
  }

  /** Lists recorded turns for a session, newest first. */
  const listTurns = (rawSessionId) => {
    const sid = safeSessionId(rawSessionId)
    if (sid === '') return { ok: false, code: 'missing-session', erreur: rewindText('missing-session'), turns: [] }
    const ledger = readLedger(sid)
    const turns = ledger.turns.map((t, index) => {
      const files = Object.entries(t.files).map(([path, entry]) => ({
        path,
        existed: entry.existed === true,
        ...(typeof entry.size === 'number' ? { size: entry.size } : {}),
        ...(typeof entry.skipped === 'string' ? { skipped: entry.skipped } : {})
      }))
      const restorable = files.some((f) => f.skipped === undefined)
      return {
        id: t.id,
        index: index + 1,
        kind: t.kind === 'rescue' ? 'rescue' : 'turn',
        at: typeof t.at === 'number' ? t.at : 0,
        prompt: str(t.prompt),
        files,
        fileCount: files.length,
        restorable
      }
    }).reverse()
    return { ok: true, session: sid, cwd: ledger.cwd, turns }
  }

  /**
   * Computes the target pre-state map for rewinding to `turnId`:
   * - For a `rescue` checkpoint: restores that exact rescue snapshot.
   * - For a normal `turn`: collects every file touched from `turnId` through the
   *   newest turn, taking the earliest pre-state per path (state right before `turnId`).
   */
  const computeTargetStates = (ledger, turnId) => {
    const idx = ledger.turns.findIndex((t) => t.id === turnId)
    if (idx === -1) return null
    const anchor = ledger.turns[idx]
    const target = new Map()
    if (anchor.kind === 'rescue') {
      for (const [relPath, entry] of Object.entries(anchor.files)) target.set(relPath, entry)
      return { anchor, target }
    }
    for (let i = idx; i < ledger.turns.length; i += 1) {
      const t = ledger.turns[i]
      for (const [relPath, entry] of Object.entries(t.files)) {
        if (!target.has(relPath)) target.set(relPath, entry)
      }
    }
    return { anchor, target }
  }

  /** Computes a dry-run rewind plan without modifying any file on disk. */
  const planRewind = ({ sessionId, cwd, turnId, paths = null }) => {
    const sid = safeSessionId(sessionId)
    if (sid === '') return { ok: false, code: 'missing-session', erreur: rewindText('missing-session') }
    const ledger = readLedger(sid)
    const root = str(cwd).trim() || ledger.cwd
    if (root === '' || !existsSync(root)) return { ok: false, code: 'folder-not-found', erreur: rewindText('folder-not-found') }

    const resolved = computeTargetStates(ledger, str(turnId).trim())
    if (resolved === null) return { ok: false, code: 'turn-not-found', erreur: rewindText('turn-not-found') }

    const filterSet = Array.isArray(paths) && paths.length > 0 ? new Set(paths.map((p) => toPosixRel(str(p).trim()))) : null
    const changes = []
    const summary = { restore: 0, delete: 0, unchanged: 0, skipped: 0 }

    for (const [relPath, entry] of resolved.target.entries()) {
      if (filterSet !== null && !filterSet.has(relPath)) continue
      const confined = resolveConfined(root, relPath, '', home)
      if (confined === null) {
        changes.push({ path: relPath, action: 'skipped', reason: 'outside-workspace' })
        summary.skipped += 1
        continue
      }
      if (typeof entry.skipped === 'string') {
        changes.push({ path: relPath, action: 'skipped', reason: entry.skipped })
        summary.skipped += 1
        continue
      }

      let curStat = null
      try { curStat = lstatSync(confined.absPath) } catch { curStat = null }
      if (curStat !== null && curStat.isSymbolicLink()) {
        changes.push({ path: relPath, action: 'skipped', reason: 'symlink' })
        summary.skipped += 1
        continue
      }

      if (entry.existed === false) {
        if (curStat !== null && curStat.isFile()) {
          changes.push({ path: relPath, action: 'delete' })
          summary.delete += 1
        } else {
          changes.push({ path: relPath, action: 'unchanged' })
          summary.unchanged += 1
        }
        continue
      }

      const blob = readBlob(sid, entry.sha256)
      if (blob === null) {
        changes.push({ path: relPath, action: 'skipped', reason: 'missing-snapshot' })
        summary.skipped += 1
        continue
      }

      if (curStat !== null && curStat.isFile()) {
        try {
          const curHash = sha256(readFileSync(confined.absPath))
          if (curHash === entry.sha256) {
            changes.push({ path: relPath, action: 'unchanged' })
            summary.unchanged += 1
            continue
          }
        } catch { /* treat as restorable */ }
      }

      changes.push({ path: relPath, action: 'restore', existedNow: curStat !== null })
      summary.restore += 1
    }

    const commandes = changes
      .filter((c) => c.action === 'restore' || c.action === 'delete')
      .map((c) => (c.action === 'delete' ? 'remove ' : 'restore ') + c.path)

    return {
      ok: true,
      dry: true,
      session: sid,
      turnId: resolved.anchor.id,
      turnKind: resolved.anchor.kind === 'rescue' ? 'rescue' : 'turn',
      turnPrompt: str(resolved.anchor.prompt),
      cwd: root,
      rescueWillBeCreated: summary.restore + summary.delete > 0,
      changes,
      summary,
      commandes
    }
  }

  /**
   * Executes a rewind: creates an automatic rescue point of current files first,
   * then restores or removes each planned path strictly inside `cwd`.
   */
  const executeRewind = ({ sessionId, cwd, turnId, paths = null }) => {
    const plan = planRewind({ sessionId, cwd, turnId, paths })
    if (plan.ok !== true) return plan

    const actionable = plan.changes.filter((c) => c.action === 'restore' || c.action === 'delete')
    if (actionable.length === 0) {
      return { ok: false, code: 'nothing-to-rewind', erreur: rewindText('nothing-to-rewind'), summary: plan.summary }
    }

    const sid = plan.session
    const ledger = readLedger(sid)
    const realRoot = realpathSync(plan.cwd)
    const resolved = computeTargetStates(ledger, plan.turnId)
    if (resolved === null) return { ok: false, code: 'turn-not-found', erreur: rewindText('turn-not-found') }

    // 1. Automatic rescue checkpoint BEFORE touching any file on disk.
    const rescueFiles = {}
    for (const item of actionable) {
      const confined = resolveConfined(realRoot, item.path, '', home)
      if (confined === null) continue
      const snap = snapshotFile(sid, confined.absPath)
      if (snap !== null) rescueFiles[confined.relPath] = snap
    }
    const rescueId = 'rescue-' + randomUUID().slice(0, 8)
    const label = plan.turnPrompt !== '' ? 'Before rewind: ' + plan.turnPrompt : 'Before rewind'
    ledger.turns.push({
      id: rescueId,
      kind: 'rescue',
      at: now(),
      prompt: label.slice(0, MAX_PROMPT_CHARS),
      files: rescueFiles
    })
    pruneAndSave(ledger)

    // 2. Apply planned restorations & deletions.
    const applied = []
    const skipped = plan.changes.filter((c) => c.action === 'skipped')
    for (const item of actionable) {
      const confined = resolveConfined(realRoot, item.path, '', home)
      if (confined === null) {
        skipped.push({ path: item.path, action: 'skipped', reason: 'outside-workspace' })
        continue
      }
      if (item.action === 'delete') {
        try {
          rmSync(confined.absPath, { force: true })
          removeEmptyParents(confined.absPath, realRoot)
          applied.push({ path: item.path, action: 'delete' })
        } catch (e) {
          skipped.push({ path: item.path, action: 'skipped', reason: String(e && e.code ? e.code : 'delete-failed') })
        }
      } else if (item.action === 'restore') {
        const entry = resolved.target.get(item.path)
        const blob = entry ? readBlob(sid, entry.sha256) : null
        if (blob === null) {
          skipped.push({ path: item.path, action: 'skipped', reason: 'missing-snapshot' })
          continue
        }
        try {
          const mode = typeof entry.mode === 'number' && entry.mode > 0 ? entry.mode : 0o644
          writeAtomic(confined.absPath, blob, mode)
          applied.push({ path: item.path, action: 'restore' })
        } catch (e) {
          skipped.push({ path: item.path, action: 'skipped', reason: String(e && e.code ? e.code : 'write-failed') })
        }
      }
    }

    if (applied.length === 0) {
      return {
        ok: false,
        code: 'rewind-failed',
        detail: skipped.map((s) => s.path + ' (' + s.reason + ')').join(', ').slice(0, 200),
        erreur: rewindText('rewind-failed', { detail: skipped.map((s) => s.path + ' (' + s.reason + ')').join(', ').slice(0, 200) }),
        rescueId
      }
    }

    const code = skipped.length > 0 ? 'rewind-partial' : 'rewound'
    const filesStr = countOf(applied.length, 'file', 'files')
    const skippedStr = countOf(skipped.length, 'file', 'files')
    return {
      ok: true,
      code,
      count: applied.length,
      skippedCount: skipped.length,
      message: rewindText(code, { files: filesStr, skipped: skippedStr }),
      rescueId,
      applied,
      skipped
    }
  }

  return {
    rootDir,
    readLedger,
    recordPreMutation,
    listTurns,
    planRewind,
    executeRewind,
    sessionDirOf
  }
}

/**
 * Attaches DSH host event listeners to capture pre-mutation snapshots per turn.
 * Returns a disposer function suitable for `ctx.effect(...)`. Never throws.
 */
export function attachRewindHooks (ctx, ledger, { now = () => Date.now(), resolveCwd = null } = {}) {
  if (ctx === null || ctx === undefined || typeof ctx.on !== 'function') return () => {}

  // sessionId -> { id, prompt, cwd }
  const active = new Map()
  const offs = []

  const rootSessionId = (id) => {
    let current = safeSessionId(id)
    if (current === '') return ''
    try {
      const sessions = typeof ctx.get === 'function' ? ctx.get('sessions') : undefined
      for (let depth = 0; depth < 8 && current !== ''; depth += 1) {
        const live = sessions && typeof sessions.get === 'function' ? sessions.get(current) : undefined
        const parent = live && live.header ? safeSessionId(live.header.parentSession) : ''
        if (parent === '') break
        current = parent
      }
    } catch { /* keep current */ }
    return current
  }

  const cwdOf = (session, agent, sid) => {
    try {
      const direct = str(session && session.header ? session.header.cwd : '')
      if (direct !== '') return direct
      const fromAgent = str(agent && agent.session && agent.session.header ? agent.session.header.cwd : '')
      if (fromAgent !== '') return fromAgent
      const wd = typeof ctx.get === 'function' ? ctx.get('workingDirectory') : undefined
      const live = wd && typeof wd.get === 'function' ? str(wd.get(session || (agent && agent.session))) : ''
      if (live !== '') return live
    } catch { /* fall through */ }
    return typeof resolveCwd === 'function' ? str(resolveCwd(sid)) : ''
  }

  const currentDirOf = (agent) => {
    try {
      const wd = typeof ctx.get === 'function' ? ctx.get('workingDirectory') : undefined
      return wd && typeof wd.get === 'function' && agent && agent.session ? str(wd.get(agent.session)) : ''
    } catch { return '' }
  }

  const on = (event, fn) => {
    try {
      const off = ctx.on(event, fn)
      if (typeof off === 'function') offs.push(off)
    } catch { /* engine without this hook */ }
  }

  on('session/event', (session, event) => {
    try {
      if (!isObj(event)) return
      const rawId = session && typeof session.id === 'string' ? session.id : event.sessionId
      const sid = rootSessionId(rawId)
      if (sid === '') return

      if (event.type === 'user/message') {
        // Only human messages start a labelled turn anchor (ignore sub-agent prompts).
        if (safeSessionId(rawId) !== sid) return
        const data = isObj(event.data) ? event.data : {}
        const sourceKind = isObj(data.source) ? data.source.kind : null
        if (sourceKind !== null && sourceKind !== undefined && sourceKind !== 'user') return
        const prompt = promptFromContent(data.content)
        const cwd = cwdOf(session, null, sid)
        active.set(sid, { id: 'turn-' + now() + '-' + randomUUID().slice(0, 6), prompt, cwd })
      } else if (event.type === 'turn/start') {
        if (!active.has(sid)) {
          active.set(sid, { id: 'turn-' + now() + '-' + randomUUID().slice(0, 6), prompt: '', cwd: cwdOf(session, null, sid) })
        }
      } else if (event.type === 'turn/end') {
        if (safeSessionId(rawId) === sid) active.delete(sid)
      }
    } catch { /* never break a session */ }
  })

  on('tools/pre-execute', async (exec, next) => {
    try {
      if (isObj(exec)) {
        const paths = extractMutationPaths(exec.name, exec.arguments)
        if (paths.length > 0) {
          const agent = isObj(exec.agent) ? exec.agent : null
          const rawId = agent ? (agent.session && agent.session.id ? agent.session.id : agent.id) : ''
          const sid = rootSessionId(rawId)
          if (sid !== '') {
            let turn = active.get(sid)
            const cwd = (turn && turn.cwd) || cwdOf(agent && agent.session, agent, sid)
            if (cwd !== '') {
              if (turn === undefined) {
                turn = { id: 'turn-' + now() + '-' + randomUUID().slice(0, 6), prompt: '', cwd }
                active.set(sid, turn)
              } else if (turn.cwd === '') {
                turn.cwd = cwd
              }
              const curDir = currentDirOf(agent)
              for (const rawPath of paths) {
                try {
                  ledger.recordPreMutation({
                    sessionId: sid,
                    cwd,
                    turnId: turn.id,
                    prompt: turn.prompt,
                    rawPath,
                    currentDir: curDir
                  })
                } catch { /* never block tool execution */ }
              }
            }
          }
        }
      }
    } catch { /* never block tool execution */ }
    return typeof next === 'function' ? next() : undefined
  })

  on('agent/disposed', ({ agent } = {}) => {
    try {
      const sid = safeSessionId(agent && agent.session ? agent.session.id : (agent && agent.id))
      if (sid !== '') active.delete(sid)
    } catch { /* ignore */ }
  })

  return () => {
    active.clear()
    for (const off of offs.splice(0).reverse()) {
      try { off() } catch { /* already gone */ }
    }
  }
}
