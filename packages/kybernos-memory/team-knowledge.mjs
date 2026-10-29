// team-knowledge.mjs — Structured team knowledge extending team lessons.
// Adds categories, sources, confidence, citations, and full-text search.
// Works alongside the existing team lessons (propose/approve flow).

// ── Frozen shapes ─────────────────────────────────────────────────────────────

export const KNOWLEDGE_CATEGORIES = Object.freeze([
  'workflow', 'architecture', 'security', 'performance', 'integration',
  'process', 'domain', 'tooling', 'debugging', 'decision',
])
export const CONFIDENCE_LEVELS = Object.freeze(['draft', 'verified', 'battle-tested'])
export const ENTRY_MAX_TITLE = 120
export const ENTRY_MAX_BODY = 2000
export const ENTRY_MAX_CITATIONS = 5
export const ENTRY_MAX_TAGS = 8
export const SEARCH_MAX_RESULTS = 20

// ── Normalization ─────────────────────────────────────────────────────────────

/** Normalize text for search: lowercase, strip accents, collapse whitespace. */
export const normalizeText = (text) =>
  String(text).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Tokenize text into searchable words (length > 2). */
export const tokenize = (text) =>
  normalizeText(text).split(' ').filter((w) => w.length > 2)

// ── Knowledge entry ───────────────────────────────────────────────────────────

/**
 * Validate and normalize a knowledge entry.
 * Returns { ok, entry } or { ok: false, error }.
 */
export const makeEntry = (input) => {
  const r = input !== null && typeof input === 'object' ? input : {}
  const title = String(r.title || '').trim().slice(0, ENTRY_MAX_TITLE)
  if (title.length === 0) return { ok: false, error: 'title is required' }

  const body = String(r.body || '').trim().slice(0, ENTRY_MAX_BODY)
  if (body.length === 0) return { ok: false, error: 'body is required' }

  const category = KNOWLEDGE_CATEGORIES.includes(r.category) ? r.category : 'domain'
  const confidence = CONFIDENCE_LEVELS.includes(r.confidence) ? r.confidence : 'draft'

  const tags = (Array.isArray(r.tags) ? r.tags : [])
    .map((t) => String(t).toLowerCase().replace(/[^a-z0-9-]/g, ''))
    .filter((t) => t.length >= 2)
    .slice(0, ENTRY_MAX_TAGS)

  const citations = (Array.isArray(r.citations) ? r.citations : [])
    .map((c) => ({
      source: String(c.source || '').trim().slice(0, 200),
      reference: String(c.reference || '').trim().slice(0, 200),
    }))
    .filter((c) => c.source.length > 0)
    .slice(0, ENTRY_MAX_CITATIONS)

  return {
    ok: true,
    entry: {
      id: r.id || 'kn-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      title,
      body,
      category,
      confidence,
      tags,
      citations,
      author: String(r.author || '').trim().slice(0, 80),
      status: r.status === 'approved' ? 'approved' : 'proposed',
      createdAt: r.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  }
}

// ── Search ────────────────────────────────────────────────────────────────────

/**
 * Score an entry against a query. Returns 0-1.
 * Uses token overlap + title boost + category/tag boost.
 */
export const scoreEntry = (entry, queryTokens) => {
  if (queryTokens.length === 0) return 0
  const entryTokens = new Set(tokenize(entry.title + ' ' + entry.body + ' ' + entry.tags.join(' ')))
  const titleTokens = new Set(tokenize(entry.title))
  let hits = 0
  for (const q of queryTokens) {
    if (entryTokens.has(q)) hits += 1
    if (titleTokens.has(q)) hits += 0.5
    if (entry.tags.includes(q)) hits += 0.5
    if (entry.category === q) hits += 0.3
  }
  return Math.min(1, hits / queryTokens.length)
}

/**
 * Search knowledge entries. Returns top results sorted by score.
 * Query is tokenized; each token must match at least one entry field.
 */
export const searchKnowledge = (entries, query, limit = SEARCH_MAX_RESULTS) => {
  const queryTokens = tokenize(query)
  if (queryTokens.length === 0) return entries.slice(0, limit).map((e) => ({ entry: e, score: 1 }))
  const scored = entries
    .map((e) => ({ entry: e, score: scoreEntry(e, queryTokens) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title))
  return scored.slice(0, limit)
}

// ── Knowledge store ───────────────────────────────────────────────────────────

/**
 * Create a knowledge store. Entries are stored as JSONL.
 * Compatible with the team lessons store pattern.
 */
export const makeKnowledgeStore = ({ file, readFile, writeFile }) => {
  const read = () => {
    try {
      const text = readFile(file)
      return text.trim().split('\n').filter(Boolean).map((line) => {
        try { return JSON.parse(line) } catch { return null }
      }).filter(Boolean)
    } catch {
      return []
    }
  }

  const write = (entries) => {
    writeFile(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n')
  }

  return {
    list: () => read(),

    add: (input) => {
      const result = makeEntry(input)
      if (!result.ok) return result
      const entries = read()
      if (entries.some((e) => e.id === result.entry.id)) {
        return { ok: false, error: 'duplicate id' }
      }
      entries.push(result.entry)
      write(entries)
      return { ok: true, entry: result.entry }
    },

    update: (id, changes) => {
      const entries = read()
      const idx = entries.findIndex((e) => e.id === id)
      if (idx < 0) return { ok: false, error: 'entry not found' }
      const merged = { ...entries[idx], ...changes, id, updatedAt: new Date().toISOString() }
      const result = makeEntry(merged)
      if (!result.ok) return result
      entries[idx] = result.entry
      write(entries)
      return { ok: true, entry: result.entry }
    },

    remove: (id) => {
      const entries = read()
      const idx = entries.findIndex((e) => e.id === id)
      if (idx < 0) return { ok: false, error: 'entry not found' }
      const removed = entries.splice(idx, 1)[0]
      write(entries)
      return { ok: true, entry: removed }
    },

    get: (id) => read().find((e) => e.id === id) || null,

    search: (query, limit) => searchKnowledge(read(), query, limit),
  }
}

// ── Citations ─────────────────────────────────────────────────────────────────

/** Format a citation for display. */
export const formatCitation = (citation) => {
  if (!citation.source) return ''
  return citation.reference
    ? citation.source + ' (' + citation.reference + ')'
    : citation.source
}

/** Get all unique sources across entries. */
export const uniqueSources = (entries) => {
  const sources = new Set()
  for (const e of entries) {
    for (const c of e.citations || []) {
      if (c.source) sources.add(c.source)
    }
  }
  return [...sources].sort()
}
