// ═════════════════════════════════════════════════════════════════════════════
// lessons-store — the lessons of each kyber, as files.
//
// A lesson is one JSON line in `<kybers>/<kyber>/memory/lessons.jsonl`:
//   { ts, text (≤ 500 chars), tags (≤ 5), uses, lastUsed [, from] }
// The file is written by `~/.dsh/kybers/memory.cjs` (the agent runs it through bash
// after a contradicted expectation) AND, from now on, by this module. Both must
// agree, so the rules below are the CLI's rules, not new ones:
//   · text over 500 chars is cut and ends with "…" (never rejected);
//   · tags are lower-cased, at most 5;
//   · at most 50 lessons per kyber: over the cap the LEAST USEFUL one leaves (fewest
//     `uses`, then oldest) — never the lesson just written — and it is ARCHIVED to
//     `lessons.archive.jsonl`, never destroyed.
// Differences, on purpose: an identical lesson is not stored twice, and every rewrite
// is atomic (temp file + rename), so a crash cannot leave half a file.
//
// No import from `@deepseek-ai/*` (a plugin linked as `@local/…` cannot resolve them).
// ═════════════════════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const LESSON_MAX_CHARS = 500
export const LESSONS_MAX_COUNT = 50
export const LESSON_TAGS_MAX = 5
const ARCHIVE = 'lessons.archive.jsonl'

/** Kyber ids and session ids end up in paths: only plain names get through. */
const KYBER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{5,79}$/
const TAG = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,31}$/u

export const isKyberId = (value) => typeof value === 'string' && KYBER_ID.test(value) && value.indexOf('..') < 0

/** Root of the local kybers. Overridable so the tests never touch the real one. */
export const kybersRoot = () => {
  const own = process.env.KYBERNOS_MEMORY_KYBERS
  if (typeof own === 'string' && own.trim() !== '') return own.trim()
  const home = process.env.DSH_HOME
  return join(typeof home === 'string' && home.trim() !== '' ? home.trim() : join(homedir(), '.dsh'), 'kybers')
}

const memoryDir = (kyber) => join(kybersRoot(), kyber, 'memory')
const lessonsFile = (kyber) => join(memoryDir(kyber), 'lessons.jsonl')

const isDir = (path) => { try { return statSync(path).isDirectory() } catch (e) { return false } }

const readJsonl = (path) => {
  let raw = ''
  try { raw = readFileSync(path, 'utf8') } catch (e) { return [] }
  const rows = []
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue
    // One damaged line must not hide the other lessons (the CLI behaves the same).
    try { const row = JSON.parse(line); if (row !== null && typeof row === 'object') rows.push(row) } catch (e) { /* skipped */ }
  }
  return rows
}

/** Atomic rewrite: a crash leaves the old file or the new one, never half of one. */
const writeJsonlAtomic = (path, rows) => {
  const tmp = path + '.tmp-' + String(process.pid)
  try {
    writeFileSync(tmp, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length > 0 ? '\n' : ''))
    renameSync(tmp, path)
  } catch (e) {
    try { rmSync(tmp, { force: true }) } catch (e2) { /* nothing to clean */ }
    throw e
  }
}

const normalize = (text) => String(text).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

/** A lesson has no id of its own: this one is stable until its text changes. */
export const lessonId = (kyber, lesson) => kyber + ':' + createHash('sha1').update(String(lesson.ts) + '\n' + String(lesson.text)).digest('hex').slice(0, 12)

export const parseLessonId = (id) => {
  if (typeof id !== 'string') return null
  const cut = id.lastIndexOf(':')
  if (cut < 1) return null
  const kyber = id.slice(0, cut)
  const hash = id.slice(cut + 1)
  return isKyberId(kyber) && /^[0-9a-f]{12}$/.test(hash) ? { kyber, hash } : null
}

const cleanRow = (row) => ({
  ...row,
  ts: typeof row.ts === 'string' ? row.ts : '',
  text: String(row.text),
  tags: Array.isArray(row.tags) ? row.tags.filter((t) => typeof t === 'string') : [],
  uses: Number.isFinite(row.uses) ? row.uses : 0,
  lastUsed: typeof row.lastUsed === 'string' ? row.lastUsed : null,
})

/** The lessons of one kyber, in file order. A row without text is not a lesson. */
export const readLessons = (kyber) => {
  if (!isKyberId(kyber)) return []
  return readJsonl(lessonsFile(kyber)).filter((row) => typeof row.text === 'string' && row.text.trim() !== '').map(cleanRow)
}

/** Kybers on this machine: any visible folder (some only hold lessons, no kyber.yml). */
export const listKybers = () => {
  try {
    return readdirSync(kybersRoot(), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() === true && isKyberId(entry.name))
      .map((entry) => entry.name)
      .sort()
  } catch (e) {
    return []
  }
}

const present = (kyber, lesson, now) => {
  const when = Date.parse(lesson.ts)
  return {
    id: lessonId(kyber, lesson), kyber, text: lesson.text, tags: lesson.tags, uses: lesson.uses, lastUsed: lesson.lastUsed, ts: lesson.ts,
    from: typeof lesson.from === 'string' ? lesson.from : null,
    ageMinutes: Number.isFinite(when) ? Math.max(0, Math.round((now - when) / 60000)) : null,
  }
}

const newestFirst = (a, b) => (Date.parse(b.ts) || 0) - (Date.parse(a.ts) || 0) || (a.id < b.id ? -1 : 1)

export const ADDED_WINDOW_MIN = { '1m': 1, '1h': 60, today: 1440, '7d': 10080 }

/**
 * Lessons of every kyber (or one), filtered and paginated. `used`: only lessons used
 * at least once. `added`: created within a window. `q`: every word must appear.
 */
export const listLessons = (options = {}) => {
  const now = Date.now()
  const kybers = isKyberId(options.kyber) ? [options.kyber] : listKybers()
  let rows = []
  for (const kyber of kybers) for (const lesson of readLessons(kyber)) rows.push(present(kyber, lesson, now))
  const counts = { all: rows.length, used: rows.filter((r) => r.uses > 0).length }
  if (options.used === true) rows = rows.filter((r) => r.uses > 0)
  const window = ADDED_WINDOW_MIN[options.added]
  if (window !== undefined) rows = rows.filter((r) => r.ageMinutes !== null && r.ageMinutes <= window)
  const words = normalize(options.q === undefined ? '' : options.q).split(' ').filter((w) => w !== '')
  if (words.length > 0) rows = rows.filter((r) => { const hay = normalize(r.text + ' ' + r.tags.join(' ') + ' ' + r.kyber); return words.every((w) => hay.indexOf(w) >= 0) })
  rows.sort(newestFirst)
  const limit = Number.isFinite(options.limit) ? Math.min(200, Math.max(1, options.limit)) : 25
  const offset = Number.isFinite(options.offset) ? Math.max(0, options.offset) : 0
  return { total: rows.length, limit, offset, items: rows.slice(offset, offset + limit), counts }
}

const cleanTags = (tags) => {
  const list = Array.isArray(tags) ? tags : typeof tags === 'string' ? tags.split(',') : []
  const out = []
  for (const raw of list) {
    const tag = String(raw).trim().toLowerCase()
    if (tag !== '' && TAG.test(tag) && out.indexOf(tag) < 0) out.push(tag)
    if (out.length === LESSON_TAGS_MAX) break
  }
  return out
}

const capText = (text) => (text.length > LESSON_MAX_CHARS ? text.slice(0, LESSON_MAX_CHARS) + '…' : text)

const archive = (kyber, rows, reason) => {
  if (rows.length === 0) return
  const stamp = new Date().toISOString()
  appendFileSync(join(memoryDir(kyber), ARCHIVE), rows.map((r) => JSON.stringify({ ...r, archivedAt: stamp, archivedBecause: reason })).join('\n') + '\n')
}

/** Adds a lesson. The kyber folder must exist (a typo must not invent a kyber). */
export const addLesson = (kyber, input) => {
  if (!isKyberId(kyber) || !isDir(join(kybersRoot(), kyber))) return { ok: false, error: 'kyber_inconnu', kybers: listKybers() }
  const text = input !== null && typeof input === 'object' && typeof input.text === 'string' ? input.text.trim() : ''
  if (text === '') return { ok: false, error: 'texte_vide' }
  const lessons = readLessons(kyber)
  const key = normalize(text)
  const same = lessons.find((l) => normalize(l.text) === key)
  if (same !== undefined) return { ok: true, duplicate: true, lesson: present(kyber, same, Date.now()), total: lessons.length, evicted: [] }
  const fresh = { ts: new Date().toISOString(), text: capText(text), tags: cleanTags(input.tags), uses: 0, lastUsed: null }
  if (typeof input.from === 'string' && input.from.trim() !== '') fresh.from = input.from.trim().slice(0, 80)
  let kept = lessons.concat([fresh])
  let evicted = []
  if (kept.length > LESSONS_MAX_COUNT) {
    // By usefulness, never by luck: fewest uses first, then oldest. The lesson just
    // written is excluded — learning something and dropping it in the same write is
    // not eviction, it is amnesia (the CLI hit exactly that bug on 2026-09-22).
    const candidates = kept.map((l, i) => ({ l, i })).filter((x) => x.l !== fresh)
      .sort((a, b) => (a.l.uses || 0) - (b.l.uses || 0) || (Date.parse(a.l.ts) || 0) - (Date.parse(b.l.ts) || 0))
    const doomed = new Set(candidates.slice(0, kept.length - LESSONS_MAX_COUNT).map((x) => x.l))
    evicted = kept.filter((l) => doomed.has(l))
    kept = kept.filter((l) => !doomed.has(l))
  }
  mkdirSync(memoryDir(kyber), { recursive: true })
  archive(kyber, evicted, 'cap:' + String(LESSONS_MAX_COUNT))
  writeJsonlAtomic(lessonsFile(kyber), kept)
  return { ok: true, duplicate: false, lesson: present(kyber, fresh, Date.now()), total: kept.length, evicted: evicted.map((l) => l.text.slice(0, 60)) }
}

const locate = (id) => {
  const parsed = parseLessonId(id)
  if (parsed === null) return null
  const lessons = readLessons(parsed.kyber)
  const index = lessons.findIndex((l) => lessonId(parsed.kyber, l) === id)
  return index < 0 ? null : { kyber: parsed.kyber, lessons, index }
}

/** Edits the text and/or the tags. The id changes with the text — the new one is returned. */
export const updateLesson = (id, patch) => {
  const found = locate(id)
  if (found === null) return { ok: false, error: 'lecon_introuvable' }
  const changes = patch !== null && typeof patch === 'object' ? patch : {}
  const lesson = found.lessons[found.index]
  if (changes.text !== undefined) {
    const text = typeof changes.text === 'string' ? changes.text.trim() : ''
    if (text === '') return { ok: false, error: 'texte_vide' }
    lesson.text = capText(text)
  }
  if (changes.tags !== undefined) lesson.tags = cleanTags(changes.tags)
  writeJsonlAtomic(lessonsFile(found.kyber), found.lessons)
  return { ok: true, lesson: present(found.kyber, lesson, Date.now()) }
}

/** Removes a lesson — into the archive, like the cap does: deleting is still recoverable by hand. */
export const deleteLesson = (id) => {
  const found = locate(id)
  if (found === null) return { ok: false, error: 'lecon_introuvable' }
  const [removed] = found.lessons.splice(found.index, 1)
  archive(found.kyber, [removed], 'deleted')
  writeJsonlAtomic(lessonsFile(found.kyber), found.lessons)
  return { ok: true, total: found.lessons.length }
}

/** `uses` + 1: the signal the cap uses to keep a lesson. */
export const markUsed = (id) => {
  const found = locate(id)
  if (found === null) return { ok: false, error: 'lecon_introuvable' }
  const lesson = found.lessons[found.index]
  lesson.uses = (lesson.uses || 0) + 1
  lesson.lastUsed = new Date().toISOString()
  writeJsonlAtomic(lessonsFile(found.kyber), found.lessons)
  return { ok: true, uses: lesson.uses }
}

/** Best matches first: most words found, then most used, then newest. */
export const searchLessons = (q, options = {}) => {
  const words = normalize(q).split(' ').filter((w) => w !== '')
  if (words.length === 0) return []
  const now = Date.now()
  const kybers = isKyberId(options.kyber) ? [options.kyber] : listKybers()
  const hits = []
  for (const kyber of kybers) {
    for (const lesson of readLessons(kyber)) {
      const hay = normalize(lesson.text + ' ' + lesson.tags.join(' '))
      const found = words.filter((w) => hay.indexOf(w) >= 0).length
      if (found > 0) hits.push({ ...present(kyber, lesson, now), found })
    }
  }
  hits.sort((a, b) => b.found - a.found || b.uses - a.uses || newestFirst(a, b))
  return hits.slice(0, Number.isFinite(options.limit) ? options.limit : 10)
}

/** The kyber a session runs: `<kybers>/.active/<sessionId>` holds `{ kyber, ts }`. */
export const activeKyber = (sessionId) => {
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return null
  let row = null
  try { row = JSON.parse(readFileSync(join(kybersRoot(), '.active', sessionId), 'utf8')) } catch (e) { return null }
  const kyber = row !== null && typeof row === 'object' ? row.kyber : null
  return isKyberId(kyber) && isDir(join(kybersRoot(), kyber)) ? kyber : null
}

