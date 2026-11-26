// ═══════════════════════════════════════════════════════════════════════════
// kybernos-plugin — Preventive shell output compressor (`tools/post-execute`).
//
// Measured on local sessions (docs/etudes/compaction-summary-fallback-2026-11-25.md):
// 64 % to 86 % of active context surface in agentic sessions comes from verbose
// tool dumps. The native tool-result pruner only fires once compaction pressure
// hits; this hook compresses noisy shell outputs (progress spinners, ANSI codes,
// long green test runs, repetitive listings) deterministically BEFORE they enter
// history, while preserving error/failure lines and tail summaries intact.
//
// Pure Node.js, zero external binaries, linear-time regexes only, opt-out via
// `KYBERNOS_SHELL_COMPRESS=0`. Never blocks or fails a tool call.
// ═══════════════════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DEFAULT_THRESHOLD_CHARS = 8000
export const DEFAULT_TARGET_CHARS = 5500
export const MAX_SAVED_LOGS = 50
export const SHELL_TOOLS = new Set(['bash', 'pwsh', 'terminal_read'])

// Linear-time ANSI CSI / OSC escape stripping (no nested quantifiers).
const ANSI_CSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g
const ANSI_OSC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g

// Lines that MUST NEVER be dropped during compression.
const ERROR_LINE_RE = /\b(?:error|err_[a-z0-9_]+|fail|failed|failure|fatal|exception|traceback|assertionerror|panic|rejected|enoent|eacces|eexist|syntaxerror|typeerror|referenceerror)\b|^\s*(?:✗|✘|✖|FAIL\b|RED\b|ERR!|E:|Error:)|exit code [1-9]/i

// Repetitive green/progress lines eligible for run-length collapsing.
const PASS_OR_NOISE_RE = /^\s*(?:✓|✔|ok\s{1,4}|PASS\b|added\s+\d|up to date|downloading|compiling|installing|building|fetching|checking|reading|writing|\.{3,}|#+\s*\d+%)/i

const str = (v) => (typeof v === 'string' ? v : '')
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Strips ANSI escapes and resolves `\r` progress-bar overwrites per line. */
export function cleanTerminalNoise (raw) {
  const noAnsi = str(raw).replace(ANSI_CSI_RE, '').replace(ANSI_OSC_RE, '')
  const normalized = noAnsi.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  const out = []
  for (const line of lines) {
    if (line.includes('\r')) {
      const segs = line.split('\r').filter((s) => s.length > 0)
      out.push(segs.length > 0 ? segs[segs.length - 1] : '')
    } else {
      out.push(line)
    }
  }
  return out.join('\n')
}

/**
 * Collapses long consecutive runs (> 10) of passing/progress lines while
 * preserving any line that matches `ERROR_LINE_RE`.
 */
export function collapseVerboseRuns (lines) {
  const out = []
  let run = []
  const flush = () => {
    if (run.length === 0) return
    if (run.length <= 10) {
      for (const l of run) out.push(l)
    } else {
      out.push(run[0], run[1], run[2])
      out.push('... (' + (run.length - 5) + ' similar passing/progress lines omitted) ...')
      out.push(run[run.length - 2], run[run.length - 1])
    }
    run = []
  }

  for (const line of lines) {
    if (!ERROR_LINE_RE.test(line) && PASS_OR_NOISE_RE.test(line)) {
      run.push(line)
    } else {
      flush()
      out.push(line)
    }
  }
  flush()
  return out
}

const takeHeadChars = (lines, maxChars) => {
  const out = []
  let used = 0
  let idx = 0
  while (idx < lines.length && used + lines[idx].length + 1 <= maxChars) {
    out.push(lines[idx])
    used += lines[idx].length + 1
    idx += 1
  }
  return { lines: out, endIdx: idx }
}

const takeTailChars = (lines, startMinIdx, maxChars) => {
  const out = []
  let used = 0
  let idx = lines.length - 1
  while (idx >= startMinIdx && used + lines[idx].length + 1 <= maxChars) {
    out.unshift(lines[idx])
    used += lines[idx].length + 1
    idx -= 1
  }
  return { lines: out, startIdx: idx + 1 }
}

/**
 * Deterministically compresses oversized shell output while preserving head,
 * error lines (with +-1 line of context), and tail summary.
 * Pure function. Returns `{ changed, text, originalChars, compressedChars, savedPct }`.
 */
export function compressShellOutput (rawText, opts = {}) {
  const raw = str(rawText)
  const threshold = Number.isFinite(opts.thresholdChars) && opts.thresholdChars > 0 ? opts.thresholdChars : DEFAULT_THRESHOLD_CHARS
  const target = Number.isFinite(opts.targetChars) && opts.targetChars > 0 ? Math.min(opts.targetChars, threshold) : Math.min(DEFAULT_TARGET_CHARS, threshold)

  if (raw.length <= threshold) {
    return { changed: false, text: raw, originalChars: raw.length, compressedChars: raw.length, savedPct: 0 }
  }

  // Pass 1: clean ANSI escapes and carriage-return spinner overwrites.
  const cleaned = cleanTerminalNoise(raw)
  // Pass 2: collapse consecutive passing/progress runs.
  const lines = collapseVerboseRuns(cleaned.split('\n'))
  let body = lines.join('\n')

  // Pass 3: if still above targetChars, keep head + error excerpts + tail.
  if (body.length > target) {
    const headBudget = Math.floor(target * 0.27)
    const errBudget = Math.floor(target * 0.33)
    const tailBudget = Math.floor(target * 0.40)

    const head = takeHeadChars(lines, headBudget)
    const tail = takeTailChars(lines, head.endIdx, tailBudget)

    // Collect error lines (with +-1 context line) strictly in the middle gap.
    const errIndexes = new Set()
    for (let i = head.endIdx; i < tail.startIdx; i += 1) {
      if (ERROR_LINE_RE.test(lines[i])) {
        if (i - 1 >= head.endIdx) errIndexes.add(i - 1)
        errIndexes.add(i)
        if (i + 1 < tail.startIdx) errIndexes.add(i + 1)
      }
    }

    const errLines = []
    let errChars = 0
    for (const i of Array.from(errIndexes).sort((a, b) => a - b)) {
      const l = lines[i]
      if (errChars + l.length + 1 > errBudget) break
      errLines.push(l)
      errChars += l.length + 1
    }

    const middleCount = Math.max(0, tail.startIdx - head.endIdx - errLines.length)
    const sections = []
    if (head.lines.length > 0) sections.push(head.lines.join('\n'))
    if (errLines.length > 0) {
      sections.push('--- error/diagnostic lines preserved ---\n' + errLines.join('\n'))
    }
    if (middleCount > 0) {
      sections.push('... (' + middleCount + ' middle lines omitted) ...')
    }
    if (tail.lines.length > 0) sections.push(tail.lines.join('\n'))
    body = sections.join('\n')
  }

  // Only replace if we saved at least 15 % (otherwise keep original lossless).
  const logNote = str(opts.savedLogPath) !== '' ? ' · full log: ' + opts.savedLogPath : ''
  const pct = Math.max(0, Math.round((1 - body.length / raw.length) * 100))
  const marker = '\n[kybernos: shell output compressed ' + raw.length + ' -> ' + body.length + ' chars (' + pct + '% saved)' + logNote + ']'
  const finalText = body + marker

  if (finalText.length >= raw.length * 0.85) {
    return { changed: false, text: raw, originalChars: raw.length, compressedChars: raw.length, savedPct: 0 }
  }

  return {
    changed: true,
    text: finalText,
    originalChars: raw.length,
    compressedChars: finalText.length,
    savedPct: Math.round((1 - finalText.length / raw.length) * 100)
  }
}

/**
 * Saves raw shell output under `logDir` (mode 0600) and prunes oldest files
 * beyond `MAX_SAVED_LOGS`. Returns the saved file path or '' on failure.
 */
export function saveRawShellLog (logDir, rawText, now = () => Date.now()) {
  try {
    mkdirSync(logDir, { recursive: true, mode: 0o700 })
    const hash = createHash('sha256').update(rawText).digest('hex').slice(0, 8)
    const name = now() + '-' + hash + '.log'
    const file = join(logDir, name)
    writeFileSync(file, rawText, { mode: 0o600 })

    // Bounded retention: keep newest MAX_SAVED_LOGS files.
    const entries = readdirSync(logDir)
      .filter((f) => f.endsWith('.log'))
      .map((f) => {
        const p = join(logDir, f)
        try { return { p, mtime: statSync(p).mtimeMs } } catch { return null }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime)
    for (const stale of entries.slice(MAX_SAVED_LOGS)) {
      try { rmSync(stale.p, { force: true }) } catch { /* ignore */ }
    }
    return file
  } catch {
    return ''
  }
}

const thresholdFromEnv = (env) => {
  const raw = env && env.KYBERNOS_SHELL_COMPRESS_CHARS
  if (raw === undefined || raw === '') return DEFAULT_THRESHOLD_CHARS
  const n = Number.parseInt(String(raw), 10)
  return Number.isFinite(n) && n >= 1000 ? n : DEFAULT_THRESHOLD_CHARS
}

/**
 * Mounts the preventive shell output compressor on DSH's `tools/post-execute`
 * waterfall seam. Calls `next()` first so any downstream block or explicit
 * replacement wins untouched. Returns a disposer function. Never throws.
 */
export function mountShellCompressor (ctx, opts = {}) {
  if (ctx === null || ctx === undefined || typeof ctx.on !== 'function') return () => {}
  const env = opts.env ?? process.env
  const logDir = opts.logDir ?? join(env.DSH_HOME || join(homedir(), '.dsh'), 'kybernos', 'shell-logs')
  const saveLogs = opts.saveLogs !== false
  const now = opts.now ?? (() => Date.now())

  const handler = async (exec, result, next) => {
    const upstream = typeof next === 'function' ? await next() : { kind: 'accept' }
    try {
      if (str(env.KYBERNOS_SHELL_COMPRESS) === '0') return upstream
      if (!isObj(upstream) || upstream.kind !== 'accept') return upstream
      if (upstream.content !== undefined || upstream.value !== undefined) return upstream
      if (!isObj(exec) || !SHELL_TOOLS.has(str(exec.name))) return upstream
      if (!isObj(result) || !Array.isArray(result.content) || result.content.length === 0) return upstream

      const thresholdChars = opts.thresholdChars ?? thresholdFromEnv(env)
      const targetChars = opts.targetChars ?? Math.min(DEFAULT_TARGET_CHARS, thresholdChars)
      let anyChanged = false
      const nextContent = result.content.map((block) => {
        if (!isObj(block) || block.type !== 'text' || typeof block.text !== 'string') return block
        if (block.text.length <= thresholdChars) return block
        const savedLogPath = saveLogs ? saveRawShellLog(logDir, block.text, now) : ''
        const res = compressShellOutput(block.text, { thresholdChars, targetChars, savedLogPath })
        if (!res.changed) return block
        anyChanged = true
        return { ...block, text: res.text }
      })

      if (!anyChanged) return upstream
      return { ...upstream, kind: 'accept', content: nextContent }
    } catch {
      return upstream
    }
  }

  try {
    const off = ctx.on('tools/post-execute', handler)
    return typeof off === 'function' ? off : () => {}
  } catch {
    return () => {}
  }
}
