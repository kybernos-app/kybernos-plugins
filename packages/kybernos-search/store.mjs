// The index: what is known of the chats (extracted once, kept on disk, refreshed by file size and time), plus the small sources.
// Every side effect is injected (`io`), so the tests play it with no disk and no DSH.
import { prepare, search } from './core.mjs'
import { extractJournal } from './extractor.mjs'
import { zstdFrames } from './zstd-frames.mjs'

const CACHE_VERSION = 1
const SOURCES_TTL_MS = 60000
const YIELD_EVERY = 8
const MAX_FAILURES = 20

const basename = (p) => String(p ?? '').split(/[\\/]/).filter(Boolean).pop() ?? ''

/** The document the search sees for one extracted chat. */
export function chatDoc (e) {
  const firstUser = e.msgs.find((m) => m[0] === 'u')
  const title = e.title !== '' ? e.title : (firstUser !== undefined ? firstUser[2].replace(/\s+/g, ' ').slice(0, 80) : e.id)
  return prepare({
    scope: 'chat', id: e.id, title,
    parts: e.msgs.map((m) => ({ r: m[0], ts: m[1], t: m[2] })),
    meta: { where: basename(e.cwd), when: e.lastAt ?? e.mtimeMs ?? null, cwd: e.cwd },
    open: { kind: 'session', id: e.id },
    ts: e.lastAt ?? e.mtimeMs ?? null
  })
}

/**
 * @param {{
 *   listSessions: () => Array<{ id: string, file: string, size: number, mtimeMs: number }>,
 *   readFile: (file: string) => Buffer,
 *   readCache: () => (object|null),
 *   writeCache: (obj: object) => void,
 *   sources: () => object[],
 *   now: () => number,
 *   tick?: () => Promise<void>
 * }} io
 */
export function createIndex (io) {
  const tick = typeof io.tick === 'function' ? io.tick : () => new Promise((r) => setImmediate(r))
  const entries = new Map()
  // prepared documents, by chat id: updated as each journal is read, so a search made DURING the first build already sees what is read
  const docs = new Map()
  let loaded = false
  let state = 'idle'
  let done = 0
  let total = 0
  let updatedAt = null
  let errors = 0
  // Which journals could not be read, and why: { id, code }, at most MAX_FAILURES (`errors` counts them all). Kept for the diagnostic and the page.
  let failures = []
  let building = null
  let src = { at: 0, docs: [] }

  const load = () => {
    if (loaded) return
    loaded = true
    let c = null
    try { c = io.readCache() } catch (e) { c = null }
    if (c === null || typeof c !== 'object' || c.v !== CACHE_VERSION || !Array.isArray(c.sessions)) return
    for (const s of c.sessions) {
      if (s !== null && typeof s === 'object' && typeof s.id === 'string' && Array.isArray(s.msgs)) entries.set(s.id, s)
    }
    for (const e of entries.values()) docs.set(e.id, chatDoc(e))
    if (typeof c.updatedAt === 'number') updatedAt = c.updatedAt
    if (entries.size > 0) state = 'ready'
  }

  const persist = () => {
    try { io.writeCache({ v: CACHE_VERSION, updatedAt, sessions: [...entries.values()] }) } catch (e) { /* the index still works in memory */ }
  }

  const run = async () => {
    state = 'building'
    errors = 0
    failures = []
    let files = []
    try { files = io.listSessions() } catch (e) { files = [] }
    total = files.length
    done = 0
    const present = new Set()
    let sinceYield = 0
    for (const f of files) {
      present.add(f.id)
      const have = entries.get(f.id)
      if (have === undefined || have.size !== f.size || have.mtimeMs !== f.mtimeMs) {
        try {
          const raw = io.readFile(f.file)
          const text = zstdFrames(raw)
          // A file with bytes in it but not one decodable frame (cut short, a frame this reader does not handle) used to become an empty chat,
          // found by nothing and reported by nothing.
          if (text === '' && raw.length > 0) { const bad = new Error('no frame could be decoded'); bad.code = 'no-frame'; throw bad }
          const j = extractJournal(text)
          const e = { id: f.id, size: f.size, mtimeMs: f.mtimeMs, cwd: j.cwd, title: j.title, createdAt: j.createdAt, lastAt: j.lastAt, msgs: j.msgs }
          entries.set(f.id, e)
          docs.set(f.id, chatDoc(e))
        } catch (e) {
          errors += 1
          if (failures.length < MAX_FAILURES) failures.push({ id: f.id, code: e !== null && typeof e === 'object' && typeof e.code === 'string' ? e.code : 'unreadable' })
        }
      }
      done += 1
      sinceYield += 1
      if (sinceYield >= YIELD_EVERY) { sinceYield = 0; await tick() }
    }
    for (const id of [...entries.keys()]) if (!present.has(id)) { entries.delete(id); docs.delete(id) }
    updatedAt = io.now()
    persist()
    // « ready » means every journal was read: an index that missed some says `partial`, and `failed` says which.
    state = errors > 0 ? 'partial' : 'ready'
  }

  const sourceDocs = () => {
    const t = io.now()
    if (t - src.at > SOURCES_TTL_MS || src.docs.length === 0) {
      let raw = []
      try { raw = io.sources() } catch (e) { raw = [] }
      src = { at: t, docs: raw.map(prepare) }
    }
    return src.docs
  }

  return {
    /** Starts (or joins) a refresh. Resolves when it is done. Idempotent. */
    start () {
      load()
      // A run that fell over is not « ready »: what was read stays searchable, and the state and the counts say it is incomplete.
      if (building === null) {
        building = run().catch(() => {
          errors += 1
          if (failures.length < MAX_FAILURES) failures.push({ id: null, code: 'run-failed' })
          state = 'partial'
        }).finally(() => { building = null })
      }
      return building
    },
    /** Drops everything and reads every journal again. */
    rebuild () {
      load()
      if (building !== null) return building
      entries.clear()
      docs.clear()
      return this.start()
    },
    status () {
      load()
      return { state, done, total, chats: entries.size, updatedAt, errors, failed: failures.slice(), sources: sourceDocs().length }
    },
    query ({ q, scopes, limit, perScope }) {
      load()
      const t0 = io.now()
      const all = [...docs.values()].concat(sourceDocs())
      const r = search(all, q, { scopes, limit, perScope, now: t0 })
      return { ok: true, state, terms: r.terms, results: r.results, counts: r.counts, indexed: entries.size, tookMs: Math.max(0, io.now() - t0) }
    }
  }
}
