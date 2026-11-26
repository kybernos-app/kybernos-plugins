// ═══════════════════════════════════════════════════════════════════════════
// kybernos-knowledge — Local incremental index, BM25 search, auto-maintained
// Markdown wiki, and kybernos-front-desk fact exporter.
//
// Everything stays on disk under <DSH_HOME>/kybernos/knowledge/:
//   collections.json          registered workspaces / folders
//   index/<id>.json           incremental per-file chunk + term-frequency cache
//   wiki/<id>/index.md        auto-maintained Markdown wiki overview
//   wiki/<id>/pages/<slug>.md per-document outline & citable excerpts
// ═══════════════════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import {
  extractFile,
  fold,
  maskSecrets,
  MAX_FILE_BYTES,
  SUPPORTED_EXTENSIONS,
  tokenize
} from './knowledge-extract.mjs'

export const MAX_COLLECTIONS = 20
export const MAX_FILES_PER_COLLECTION = 500
export const MAX_DEPTH = 8
export const MAX_SEARCH_LIMIT = 20

const SKIP_DIRS = new Set([
  '.git', '.hg', '.svn', 'node_modules', '.dsh', '.next', '.nuxt', '.cache',
  'dist', 'build', 'coverage', '__pycache__', '.venv', 'venv', '.worktrees', '.agents'
])

const SECRET_FILE_RE = /^(?:\.env(?:\..+)?|\.credentials(?:\..+)?|id_rsa.*|id_ed25519.*|.*\.(?:pem|key|p12|pfx|jks))$/i

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const str = (v) => (typeof v === 'string' ? v : '')

function writeAtomic (filePath, text) {
  mkdirSync(dirname(filePath), { recursive: true })
  const tmp = filePath + '.tmp.' + process.pid
  try {
    writeFileSync(tmp, text, 'utf8')
    renameSync(tmp, filePath)
  } catch (e) {
    try { rmSync(tmp, { force: true }) } catch { /* ignore */ }
    throw e
  }
}

export function slugify (input, fallback = 'collection') {
  const s = fold(str(input)).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
  return s || fallback
}

function sha256File (filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function isConfinedInside (rootReal, candidatePath) {
  try {
    const real = realpathSync(candidatePath)
    return real === rootReal || real.startsWith(rootReal + sep)
  } catch {
    return false
  }
}

function walkSupportedFiles (rootReal) {
  const found = []
  const visit = (dir, depth) => {
    if (depth > MAX_DEPTH || found.length >= MAX_FILES_PER_COLLECTION) return
    let entries = []
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const ent of entries) {
      if (found.length >= MAX_FILES_PER_COLLECTION) break
      if (ent.name.startsWith('.') && ent.name !== '.well-known') continue
      const full = join(dir, ent.name)
      let lst
      try { lst = lstatSync(full) } catch { continue }
      if (lst.isSymbolicLink()) continue
      if (lst.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue
        visit(full, depth + 1)
      } else if (lst.isFile()) {
        if (SECRET_FILE_RE.test(ent.name)) continue
        if (!SUPPORTED_EXTENSIONS.includes(extname(ent.name).toLowerCase())) continue
        if (lst.size > MAX_FILE_BYTES) continue
        if (!isConfinedInside(rootReal, full)) continue
        const rel = relative(rootReal, full).split(sep).join('/')
        found.push({ fullPath: full, relPath: rel, mtimeMs: lst.mtimeMs, size: lst.size })
      }
    }
  }
  visit(rootReal, 0)
  return found
}

function buildTermFreqs (text) {
  const tokens = tokenize(text)
  const tf = Object.create(null)
  for (const t of tokens) tf[t] = (tf[t] || 0) + 1
  return { len: tokens.length, tf }
}

function pageSlug (relPath) {
  const hash = createHash('sha1').update(relPath).digest('hex').slice(0, 6)
  return slugify(relPath.replace(/\.[^.]+$/, ''), 'doc') + '-' + hash
}

function renderWiki (collection, docs, wikiDir) {
  const pagesDir = join(wikiDir, 'pages')
  mkdirSync(pagesDir, { recursive: true })
  const wantedPages = new Set()
  const sorted = [...docs].sort((a, b) => a.relPath.localeCompare(b.relPath))

  const indexLines = [
    '# ' + collection.name + ' — Knowledge Wiki',
    '',
    '- **Collection ID**: `' + collection.id + '`',
    '- **Source folder**: `' + collection.rootPath + '`',
    '- **Front desk**: ' + (collection.includeFrontDesk ? 'enabled' : 'disabled'),
    '- **Documents**: ' + sorted.length,
    '- **Updated**: ' + new Date().toISOString(),
    '',
    '## Documents',
    ''
  ]

  if (sorted.length === 0) {
    indexLines.push('_No supported documents found (.md, .txt, .csv, .docx, .pdf)._')
  } else {
    indexLines.push('| Document | Format | Chunks | Wiki page |')
    indexLines.push('| --- | --- | ---: | --- |')
  }

  for (const doc of sorted) {
    const slug = pageSlug(doc.relPath)
    const fileName = slug + '.md'
    wantedPages.add(fileName)
    indexLines.push('| `' + doc.relPath + '` | ' + doc.format + ' | ' + doc.chunks.length + ' | [' + doc.title.replace(/\|/g, ' ') + '](./pages/' + fileName + ') |')

    const pageLines = [
      '# ' + doc.title,
      '',
      '- **Source**: `' + doc.relPath + '` (' + doc.format + ')',
      '- **Chunks**: ' + doc.chunks.length,
      ''
    ]
    if (Array.isArray(doc.headings) && doc.headings.length > 0) {
      pageLines.push('## Outline', '')
      for (const hd of doc.headings.slice(0, 25)) pageLines.push('- ' + hd)
      pageLines.push('')
    }
    pageLines.push('## Key excerpts', '')
    for (const ch of doc.chunks.slice(0, 6)) {
      const head = ch.section ? '**' + ch.section + '** (' + ch.locator + ')' : '(' + ch.locator + ')'
      pageLines.push('### ' + head, '', maskSecrets(ch.text).slice(0, 500), '')
    }
    writeAtomic(join(pagesDir, fileName), pageLines.join('\n') + '\n')
  }

  // Prune stale wiki pages from deleted documents
  try {
    for (const f of readdirSync(pagesDir)) {
      if (f.endsWith('.md') && !wantedPages.has(f)) {
        try { rmSync(join(pagesDir, f), { force: true }) } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }

  const indexPath = join(wikiDir, 'index.md')
  writeAtomic(indexPath, indexLines.join('\n') + '\n')
  return indexPath
}

function makeSnippet (text, terms) {
  const clean = maskSecrets(String(text ?? '').replace(/\s+/g, ' ').trim())
  if (clean.length <= 260) return clean
  const folded = fold(clean)
  let first = -1
  for (const t of terms) {
    const at = folded.indexOf(t)
    if (at >= 0 && (first < 0 || at < first)) first = at
  }
  if (first < 0) return clean.slice(0, 257) + '…'
  const start = Math.max(0, first - 80)
  const end = Math.min(clean.length, start + 260)
  return (start > 0 ? '…' : '') + clean.slice(start, end).trim() + (end < clean.length ? '…' : '')
}

// ── Knowledge Store factory ──────────────────────────────────────────────────

export function createKnowledgeStore ({ dir, now = Date.now }) {
  const rootDir = resolve(dir)
  const collectionsFile = join(rootDir, 'collections.json')
  const indexDir = join(rootDir, 'index')
  const wikiRoot = join(rootDir, 'wiki')

  const readCollections = () => {
    try {
      const parsed = JSON.parse(readFileSync(collectionsFile, 'utf8'))
      if (isObj(parsed) && Array.isArray(parsed.collections)) return parsed.collections
    } catch { /* absent or corrupt */ }
    return []
  }

  const saveCollections = (list) => {
    writeAtomic(collectionsFile, JSON.stringify({ version: 1, collections: list }, null, 2) + '\n')
  }

  const readIndex = (id) => {
    try {
      const parsed = JSON.parse(readFileSync(join(indexDir, id + '.json'), 'utf8'))
      if (isObj(parsed) && Array.isArray(parsed.docs)) return parsed
    } catch { /* absent */ }
    return { version: 1, collectionId: id, updatedAt: 0, docs: [] }
  }

  const saveIndex = (id, payload) => {
    writeAtomic(join(indexDir, id + '.json'), JSON.stringify(payload))
  }

  const listCollections = () => readCollections().map((c) => ({
    ...c,
    wikiPath: join(wikiRoot, c.id, 'index.md')
  }))

  const findCollection = (idOrName) => {
    const key = str(idOrName).trim()
    if (key === '') return null
    const list = readCollections()
    return list.find((c) => c.id === key) || list.find((c) => fold(c.name) === fold(key)) || null
  }

  function indexCollection (id) {
    const list = readCollections()
    const col = list.find((c) => c.id === id)
    if (!col) return { ok: false, error: 'collection-not-found' }
    if (!existsSync(col.rootPath)) return { ok: false, error: 'folder-not-found' }
    let rootReal
    try {
      const st = statSync(col.rootPath)
      if (!st.isDirectory()) return { ok: false, error: 'not-a-directory' }
      rootReal = realpathSync(col.rootPath)
    } catch { return { ok: false, error: 'folder-unreadable' } }

    const prev = readIndex(col.id)
    const prevByPath = new Map(prev.docs.map((d) => [d.relPath, d]))
    const files = walkSupportedFiles(rootReal)
    const nextDocs = []
    let added = 0
    let updated = 0
    let unchanged = 0
    let skipped = 0

    for (const f of files) {
      const old = prevByPath.get(f.relPath)
      if (old && old.mtimeMs === f.mtimeMs && old.size === f.size) {
        nextDocs.push(old)
        unchanged += 1
        continue
      }
      let sha = ''
      try { sha = sha256File(f.fullPath) } catch { skipped += 1; continue }
      if (old && old.sha256 === sha) {
        nextDocs.push({ ...old, mtimeMs: f.mtimeMs, size: f.size })
        unchanged += 1
        continue
      }
      try {
        const res = extractFile(f.fullPath, f.relPath)
        if (!res.ok) { skipped += 1; continue }
        const enrichedChunks = res.chunks.map((ch) => {
          const { len, tf } = buildTermFreqs(ch.text)
          const secTerms = buildTermFreqs(ch.section)
          return {
            id: col.id + ':' + f.relPath + '#' + ch.idx,
            idx: ch.idx,
            section: ch.section,
            locator: ch.locator,
            text: ch.text,
            len,
            tf,
            secTf: secTerms.tf
          }
        })
        const titleTerms = buildTermFreqs(res.title + ' ' + f.relPath)
        nextDocs.push({
          relPath: f.relPath,
          format: res.format,
          mtimeMs: f.mtimeMs,
          size: f.size,
          sha256: sha,
          title: res.title,
          titleTf: titleTerms.tf,
          headings: res.headings,
          totalChars: res.totalChars,
          chunks: enrichedChunks
        })
        if (old) updated += 1
        else added += 1
      } catch {
        skipped += 1
      }
    }

    const removed = Math.max(0, prev.docs.length - unchanged - updated)
    const ts = now()
    saveIndex(col.id, { version: 1, collectionId: col.id, updatedAt: ts, docs: nextDocs })
    const wikiPath = renderWiki(col, nextDocs, join(wikiRoot, col.id))

    const chunkCount = nextDocs.reduce((acc, d) => acc + d.chunks.length, 0)
    const updatedCol = {
      ...col,
      docCount: nextDocs.length,
      chunkCount,
      lastIndexedAt: ts,
      updatedAt: ts
    }
    saveCollections(list.map((c) => (c.id === col.id ? updatedCol : c)))

    return {
      ok: true,
      collection: { ...updatedCol, wikiPath },
      stats: { added, updated, unchanged, removed, skipped, docCount: nextDocs.length, chunkCount }
    }
  }

  function addCollection ({ name, rootPath, kind = 'workspace', includeFrontDesk = false, indexNow = true }) {
    const rawPath = str(rootPath).trim()
    if (rawPath === '') return { ok: false, error: 'path-required' }
    const absPath = resolve(rawPath)
    if (!existsSync(absPath)) return { ok: false, error: 'folder-not-found' }
    let realPath
    try {
      if (!statSync(absPath).isDirectory()) return { ok: false, error: 'not-a-directory' }
      realPath = realpathSync(absPath)
    } catch { return { ok: false, error: 'folder-unreadable' } }

    const list = readCollections()
    const existing = list.find((c) => c.rootPath === realPath)
    if (existing) {
      return indexNow ? indexCollection(existing.id) : { ok: true, collection: { ...existing, wikiPath: join(wikiRoot, existing.id, 'index.md') }, alreadyExists: true }
    }
    if (list.length >= MAX_COLLECTIONS) return { ok: false, error: 'max-collections-reached' }

    const label = str(name).trim() || basename(realPath) || 'Knowledge'
    let id = slugify(label, 'kb')
    if (list.some((c) => c.id === id)) {
      id = id + '-' + createHash('sha1').update(realPath).digest('hex').slice(0, 6)
    }
    const ts = now()
    const entry = {
      id,
      name: label.slice(0, 80),
      rootPath: realPath,
      kind: kind === 'folder' ? 'folder' : 'workspace',
      includeFrontDesk: includeFrontDesk === true,
      docCount: 0,
      chunkCount: 0,
      createdAt: ts,
      updatedAt: ts,
      lastIndexedAt: 0
    }
    saveCollections([...list, entry])
    if (indexNow) return indexCollection(id)
    return { ok: true, collection: { ...entry, wikiPath: join(wikiRoot, id, 'index.md') } }
  }

  function updateCollection (id, patch = {}) {
    const list = readCollections()
    const col = list.find((c) => c.id === id)
    if (!col) return { ok: false, error: 'collection-not-found' }
    const next = {
      ...col,
      name: typeof patch.name === 'string' && patch.name.trim() !== '' ? patch.name.trim().slice(0, 80) : col.name,
      includeFrontDesk: patch.includeFrontDesk === undefined ? col.includeFrontDesk : patch.includeFrontDesk === true,
      updatedAt: now()
    }
    saveCollections(list.map((c) => (c.id === id ? next : c)))
    const idx = readIndex(id)
    const wikiPath = renderWiki(next, idx.docs, join(wikiRoot, id))
    return { ok: true, collection: { ...next, wikiPath } }
  }

  function removeCollection (id) {
    const list = readCollections()
    if (!list.some((c) => c.id === id)) return { ok: false, error: 'collection-not-found' }
    saveCollections(list.filter((c) => c.id !== id))
    try { rmSync(join(indexDir, id + '.json'), { force: true }) } catch { /* ignore */ }
    try { rmSync(join(wikiRoot, id), { recursive: true, force: true }) } catch { /* ignore */ }
    return { ok: true, removed: id }
  }

  function listDocuments (collectionId) {
    const col = findCollection(collectionId)
    if (!col) return { ok: false, error: 'collection-not-found' }
    const idx = readIndex(col.id)
    return {
      ok: true,
      collection: { ...col, wikiPath: join(wikiRoot, col.id, 'index.md') },
      documents: idx.docs.map((d) => ({
        relPath: d.relPath,
        format: d.format,
        title: d.title,
        headings: d.headings || [],
        chunks: d.chunks.length,
        size: d.size,
        mtimeMs: d.mtimeMs
      }))
    }
  }

  function search ({ query, collection = '', frontDeskOnly = false, limit = 6 } = {}) {
    const rawQuery = str(query).trim()
    const terms = Array.from(new Set(tokenize(rawQuery, { keepStopwords: false })))
    const fallbackTerms = terms.length > 0 ? terms : Array.from(new Set(tokenize(rawQuery, { keepStopwords: true })))
    const maxRes = Math.max(1, Math.min(MAX_SEARCH_LIMIT, Number(limit) || 6))
    if (fallbackTerms.length === 0) return { ok: true, query: rawQuery, terms: [], totalHits: 0, results: [] }

    let targetCols = readCollections()
    if (frontDeskOnly === true) targetCols = targetCols.filter((c) => c.includeFrontDesk === true)
    if (str(collection).trim() !== '') {
      const hit = findCollection(collection)
      targetCols = hit ? targetCols.filter((c) => c.id === hit.id) : []
    }

    const candidates = []
    const df = Object.create(null)
    let totalLen = 0
    for (const col of targetCols) {
      const idx = readIndex(col.id)
      for (const doc of idx.docs) {
        for (const ch of doc.chunks) {
          totalLen += ch.len || 1
          candidates.push({ col, doc, ch })
          for (const t of fallbackTerms) {
            if ((ch.tf && ch.tf[t]) || (ch.secTf && ch.secTf[t]) || (doc.titleTf && doc.titleTf[t])) {
              df[t] = (df[t] || 0) + 1
            }
          }
        }
      }
    }

    const N = candidates.length
    if (N === 0) return { ok: true, query: rawQuery, terms: fallbackTerms, totalHits: 0, results: [] }
    const avgdl = Math.max(1, totalLen / N)
    const k1 = 1.5
    const b = 0.75
    const foldedPhrase = fallbackTerms.length > 1 ? fold(rawQuery) : ''

    const scored = []
    for (const item of candidates) {
      const { col, doc, ch } = item
      let score = 0
      let matchedTerms = 0
      for (const t of fallbackTerms) {
        const bodyFreq = (ch.tf && ch.tf[t]) || 0
        const secFreq = (ch.secTf && ch.secTf[t]) || 0
        const titleFreq = (doc.titleTf && doc.titleTf[t]) || 0
        const weightedTf = bodyFreq + secFreq * 2.0 + titleFreq * 3.0
        if (weightedTf <= 0) continue
        matchedTerms += 1
        const docFreq = df[t] || 1
        const idf = Math.log(1 + (N - docFreq + 0.5) / (docFreq + 0.5))
        const dl = ch.len || 1
        score += idf * ((weightedTf * (k1 + 1)) / (weightedTf + k1 * (1 - b + b * (dl / avgdl))))
      }
      if (matchedTerms === 0) continue
      // Bonus when all query terms appear in the passage/title
      if (matchedTerms === fallbackTerms.length && fallbackTerms.length > 1) score *= 1.35
      if (foldedPhrase !== '' && fold(ch.text).includes(foldedPhrase)) score += 2.5
      scored.push({ col, doc, ch, score })
    }

    scored.sort((a, b) => b.score - a.score)
    const top = scored.slice(0, maxRes).map(({ col, doc, ch, score }) => {
      const citation = '[' + col.name + '] ' + doc.relPath + (ch.section ? '#' + ch.section : '') + (ch.locator ? ' (' + ch.locator + ')' : '')
      return {
        collectionId: col.id,
        collectionName: col.name,
        relPath: doc.relPath,
        format: doc.format,
        title: doc.title,
        section: ch.section || '',
        locator: ch.locator || '',
        citation,
        score: Math.round(score * 100) / 100,
        snippet: makeSnippet(ch.text, fallbackTerms),
        text: maskSecrets(ch.text).slice(0, 1200)
      }
    })

    return { ok: true, query: rawQuery, terms: fallbackTerms, totalHits: scored.length, results: top }
  }

  /**
   * Produces candidate facts in the exact shape accepted by kybernos-front-desk's
   * draft fiche (`{ text, source, validated: false }`). Always unvalidated so
   * the owner keeps final approval in the Atelier.
   */
  function exportFrontDeskFacts ({ collection = '', query = '', maxFacts = 15 } = {}) {
    const cap = Math.max(1, Math.min(50, Number(maxFacts) || 15))
    if (str(query).trim() !== '') {
      const found = search({ query, collection, frontDeskOnly: collection === '', limit: cap })
      return {
        ok: true,
        facts: found.results.map((r) => ({
          text: r.snippet.slice(0, 280),
          source: 'knowledge:' + r.collectionId + '/' + r.relPath + (r.section ? '#' + r.section : ''),
          validated: false
        }))
      }
    }
    let cols = readCollections()
    if (str(collection).trim() !== '') {
      const hit = findCollection(collection)
      cols = hit ? [hit] : []
    } else {
      cols = cols.filter((c) => c.includeFrontDesk === true)
    }
    const facts = []
    for (const col of cols) {
      const idx = readIndex(col.id)
      for (const doc of idx.docs) {
        for (const ch of doc.chunks) {
          if (facts.length >= cap) break
          const text = maskSecrets(ch.text.replace(/\s+/g, ' ').trim()).slice(0, 280)
          if (text.length < 12) continue
          facts.push({
            text,
            source: 'knowledge:' + col.id + '/' + doc.relPath + (ch.section ? '#' + ch.section : ''),
            validated: false
          })
        }
        if (facts.length >= cap) break
      }
    }
    return { ok: true, facts }
  }

  const getWikiPath = (id) => {
    const col = findCollection(id)
    return col ? join(wikiRoot, col.id, 'index.md') : null
  }

  return {
    rootDir,
    listCollections,
    findCollection,
    addCollection,
    updateCollection,
    removeCollection,
    indexCollection,
    listDocuments,
    search,
    exportFrontDeskFacts,
    getWikiPath
  }
}
