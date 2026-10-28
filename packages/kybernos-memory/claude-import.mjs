// claude-import.mjs — Import Claude Code memories into Kybernos memory with quarantine.
// Reads ~/.claude/projects/*/memory/*.md (YAML frontmatter + markdown), converts to
// Kybernos memory entries in staging, deduplicates against existing lessons.
// Source Claude files are NEVER modified.

import { readdirSync, readFileSync, statSync, existsSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'
import { homedir } from 'node:os'

// ── Frozen shapes ─────────────────────────────────────────────────────────────

export const IMPORT_STATUSES = Object.freeze(['staging', 'active', 'pinned', 'locked'])
export const IMPORT_SOURCES = Object.freeze(['claude-project-memory', 'claude-claude-md', 'claude-rtk'])
export const ENTRY_MAX_CHARS = 500
export const ENTRY_MAX_TAGS = 5
export const IMPORT_BATCH_MAX = 500
export const DEDUP_THRESHOLD = 0.6

// ── Parsing ───────────────────────────────────────────────────────────────────

/** Parse YAML frontmatter from a markdown file. Returns { frontmatter, body }. */
export const parseFrontmatter = (text) => {
  const t = String(text)
  if (!t.startsWith('---\n')) return { frontmatter: {}, body: t }
  const end = t.indexOf('\n---\n', 4)
  if (end < 0) return { frontmatter: {}, body: t }
  const yamlStr = t.slice(4, end)
  const body = t.slice(end + 5)
  const frontmatter = {}
  for (const line of yamlStr.split('\n')) {
    const m = line.match(/^(\w[\w_-]*):\s*(.+)$/)
    if (m) {
      let val = m[2].trim()
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1)
      if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1)
      frontmatter[m[1]] = val
    }
  }
  return { frontmatter, body: body.trim() }
}

/** Extract a short title from markdown body (first heading or first line). */
export const extractTitle = (body) => {
  const heading = body.match(/^#{1,3}\s+(.+)$/m)
  if (heading) return heading[1].trim().slice(0, 120)
  const firstLine = body.split('\n').find((l) => l.trim().length > 0)
  return firstLine ? firstLine.trim().replace(/^[-*]\s*/, '').slice(0, 120) : ''
}

/** Extract tags from frontmatter metadata or content heuristics. */
export const extractTags = (frontmatter, body) => {
  const tags = new Set()
  if (frontmatter.tags) {
    for (const t of String(frontmatter.tags).split(/[,\s]+/)) {
      const tag = t.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
      if (tag && tag.length >= 2) tags.add(tag)
    }
  }
  if (frontmatter.type) tags.add(String(frontmatter.type).toLowerCase())
  if (frontmatter.node_type) tags.add(String(frontmatter.node_type).toLowerCase())
  // Heuristic: extract from content keywords
  const content = body.toLowerCase()
  const keywords = ['workflow', 'deploy', 'test', 'config', 'api', 'database', 'security', 'billing', 'stripe', 'docker', 'git', 'ci', 'monitoring']
  for (const kw of keywords) {
    if (content.includes(kw) && tags.size < ENTRY_MAX_TAGS) tags.add(kw)
  }
  return [...tags].slice(0, ENTRY_MAX_TAGS)
}

/** Truncate text to entry limit, preserving word boundaries. */
export const truncateEntry = (text, max = ENTRY_MAX_CHARS) => {
  const t = String(text).replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > max * 0.7 ? cut.slice(0, lastSpace) : cut) + '…'
}

// ── Scanning ──────────────────────────────────────────────────────────────────

/** Find all Claude memory files under the projects/memory tree. Returns [{ path, project, name }]. */
export const scanClaudeMemory = (claudeRoot = join(homedir(), '.claude')) => {
  const results = []
  const projectsDir = join(claudeRoot, 'projects')
  if (!existsSync(projectsDir)) return results
  for (const project of readdirSync(projectsDir)) {
    const memoryDir = join(projectsDir, project, 'memory')
    if (!existsSync(memoryDir)) continue
    for (const file of readdirSync(memoryDir)) {
      if (!file.endsWith('.md') || file === 'MEMORY.md') continue
      const path = join(memoryDir, file)
      try {
        const stat = statSync(path)
        if (!stat.isFile() || stat.size === 0) continue
        results.push({ path, project, name: basename(file, '.md'), size: stat.size })
      } catch { /* skip unreadable */ }
    }
  }
  return results.sort((a, b) => a.project.localeCompare(b.project) || a.name.localeCompare(b.name))
}

// ── Conversion ────────────────────────────────────────────────────────────────

/** Convert one Claude memory file to a Kybernos import entry. */
export const toImportEntry = (file, now = new Date().toISOString()) => {
  const raw = readFileSync(file.path, 'utf-8')
  const { frontmatter, body } = parseFrontmatter(raw)
  const title = frontmatter.name || extractTitle(body) || file.name
  const description = frontmatter.description || ''
  const tags = extractTags(frontmatter, body)
  const content = truncateEntry(description || body)
  return {
    id: 'claude-' + file.project.replace(/[^a-z0-9]/gi, '-') + '-' + file.name,
    source: 'claude-project-memory',
    sourcePath: file.path,
    project: file.project,
    title: truncateEntry(title, 120),
    content,
    tags,
    status: 'staging',
    importedAt: now,
    originSession: frontmatter.originSessionId || '',
    modified: frontmatter.modified || '',
  }
}

// ── Deduplication ─────────────────────────────────────────────────────────────

/** Normalize text for dedup comparison: lowercase, strip punctuation, collapse whitespace. */
export const normalizeForDedup = (text) =>
  String(text).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()

/** Compute Jaccard similarity between two normalized texts (word sets). */
export const similarity = (a, b) => {
  const wa = new Set(normalizeForDedup(a).split(' ').filter((w) => w.length > 2))
  const wb = new Set(normalizeForDedup(b).split(' ').filter((w) => w.length > 2))
  if (wa.size === 0 && wb.size === 0) return 1
  if (wa.size === 0 || wb.size === 0) return 0
  let intersection = 0
  for (const w of wa) if (wb.has(w)) intersection++
  return intersection / (wa.size + wb.size - intersection)
}

/** Deduplicate import entries against existing lessons and among themselves. */
export const deduplicate = (entries, existingLessons = [], threshold = DEDUP_THRESHOLD) => {
  const kept = []
  const duplicates = []
  const existingTexts = existingLessons.map((l) => l.text || l.content || '')
  for (const entry of entries) {
    let isDup = false
    for (const existing of existingTexts) {
      if (similarity(entry.content, existing) >= threshold) {
        duplicates.push({ entry, matched: existing.slice(0, 80) })
        isDup = true
        break
      }
    }
    if (!isDup) {
      for (const keptEntry of kept) {
        if (similarity(entry.content, keptEntry.content) >= threshold) {
          duplicates.push({ entry, matched: keptEntry.title })
          isDup = true
          break
        }
      }
    }
    if (!isDup) kept.push(entry)
  }
  return { kept, duplicates }
}

// ── Full import pipeline ──────────────────────────────────────────────────────

/**
 * Import Claude memories into a staging file.
 * Returns { imported, duplicates, skipped, outputPath }.
 * NEVER modifies source Claude files.
 */
export const importClaudeMemories = (opts = {}) => {
  const {
    claudeRoot = join(homedir(), '.claude'),
    outputPath = join(homedir(), '.dsh', 'kybernos', 'claude-import-staging.json'),
    existingLessons = [],
    now = new Date().toISOString(),
    dryRun = false,
  } = opts

  const files = scanClaudeMemory(claudeRoot)
  const entries = []
  let skipped = 0

  for (const file of files) {
    if (entries.length >= IMPORT_BATCH_MAX) { skipped++; continue }
    try {
      entries.push(toImportEntry(file, now))
    } catch { skipped++ }
  }

  const { kept, duplicates } = deduplicate(entries, existingLessons)

  const result = {
    version: 1,
    importedAt: now,
    source: 'claude-project-memory',
    total: files.length,
    imported: kept.length,
    duplicates: duplicates.length,
    skipped,
    entries: kept,
  }

  if (!dryRun) {
    mkdirSync(dirname(outputPath), { recursive: true })
    writeFileSync(outputPath, JSON.stringify(result, null, 2), { mode: 0o600 })
  }

  return { ...result, outputPath: dryRun ? null : outputPath }
}

// ── Quarantine management ─────────────────────────────────────────────────────

/** Change an entry's status. Returns { ok, entry } or { ok: false, error }. */
export const setEntryStatus = (entry, status) => {
  if (!IMPORT_STATUSES.includes(status)) return { ok: false, error: 'unknown status: ' + status }
  if (entry.status === 'locked') return { ok: false, error: 'locked entries cannot be changed' }
  return { ok: true, entry: { ...entry, status } }
}

/** Read the staging file and return its entries. */
export const readStaging = (path = join(homedir(), '.dsh', 'kybernos', 'claude-import-staging.json')) => {
  if (!existsSync(path)) return { version: 1, entries: [], total: 0, imported: 0, duplicates: 0, skipped: 0 }
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8'))
    return { ...data, entries: Array.isArray(data.entries) ? data.entries : [] }
  } catch {
    return { version: 1, entries: [], total: 0, imported: 0, duplicates: 0, skipped: 0 }
  }
}

/** Write updated staging file. */
export const writeStaging = (data, path = join(homedir(), '.dsh', 'kybernos', 'claude-import-staging.json')) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(data, null, 2), { mode: 0o600 })
  return path
}

/** Count entries by status. */
export const statusCounts = (entries) => {
  const counts = { staging: 0, active: 0, pinned: 0, locked: 0 }
  for (const e of entries) {
    if (counts[e.status] !== undefined) counts[e.status]++
  }
  return counts
}
