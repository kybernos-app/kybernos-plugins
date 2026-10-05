// ═════════════════════════════════════════════════════════════════════════════
// kybernos-memory — lessons learned: read, write, inject, switch on and off.
//
// Host half. What it does, and what it does not:
//   · the lessons live in `<kybers>/<kyber>/memory/lessons.jsonl` (see
//     lessons-store.mjs — same rules as `<DSH home>/kybers/memory.cjs`);
//   · it injects the lessons of the kyber a session runs (plus `default`) into the
//     system prompt, in a small bounded chunk — never the lessons of every kyber;
//   · it gives the agent two tools, `lesson_write` and `lesson_search`;
//   · it serves the routes of the "Memory & Lessons learned" page;
//   · two switches, `lessons` and `context`, persisted in `<DSH home>/kybernos-memory.json`.
// The account memory (cloud) stays in `@local/kybernos-cloud`: it needs the account
// token, lessons do not — they keep working offline and without an account.
//
// A bundle must never stop DSH from starting: every mount below is guarded.
// No import from `@deepseek-ai/*` (a plugin linked as `@local/…` cannot resolve them);
// the route helpers are small copies of the ones in kybernos-cloud, since bundles
// cannot share code.
// ═════════════════════════════════════════════════════════════════════════════

import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { LESSON_MAX_CHARS, activeKyber, addLesson, deleteLesson, dshHome, isKyberId, listKybers, listLessons, markUsed, readLessons, searchLessons, updateLesson, restoreLessons, retouchLesson, lessonId, parseLessonId } from './lessons-store.mjs'
import { findDuplicateGroups, unclearPairs } from './dedupe.mjs'
import { normalizeTidySettings, patchTidySettings, tidyDue, tidyNext, pickAuto, removalChunks, readStudyModel, brainGroups } from './tidy.mjs'

export const name = 'kybernos-memory'

const say = (message) => console.log('[kybernos-memory] ' + message)

// ── Switches ────────────────────────────────────────────────────────────────
// `lessons`: agents may save and look up lessons. `context`: lessons are injected into
// the system prompt. Both true by default — that is how things behaved before the
// switches existed, so nothing changes for whoever never touches them.
const SETTING_KEYS = ['lessons', 'context']

// <DSH home>/kybernos-memory.json, in the same home as the lessons (lessons-store.mjs).
const settingsFile = () => {
  const own = process.env.KYBERNOS_MEMORY_SETTINGS
  return typeof own === 'string' && own.trim() !== '' ? own.trim() : join(dshHome(), 'kybernos-memory.json')
}

/** Read at every prompt assembly (a tiny file): no cache to invalidate when another process writes. */
export const readSettings = () => {
  let raw = {}
  try {
    const parsed = JSON.parse(readFileSync(settingsFile(), 'utf8'))
    if (parsed !== null && typeof parsed === 'object') raw = parsed
  } catch (e) { /* no file yet: defaults */ }
  const out = {}
  for (const key of SETTING_KEYS) out[key] = typeof raw[key] === 'boolean' ? raw[key] : true
  return out
}

const writeSettings = (settings) => {
  const file = settingsFile()
  try { mkdirSync(dirname(file), { recursive: true, mode: 0o700 }) } catch (e) { /* already there */ }
  writeFileSync(file, JSON.stringify(settings) + '\n', { mode: 0o600 })
  try { chmodSync(file, 0o600) } catch (e) { /* exotic filesystem */ }
}

// ── Prompt chunk ────────────────────────────────────────────────────────────
const CHUNK_NAME = 'kybernos:lessons'
const CHUNK_ORDER = 135
const CHUNK_MAX_CHARS = 2400
// The frame (head, "more" line, closing instruction) counts inside the cap: the cap
// bounds the whole injected text, not only the lesson lines.
const CHUNK_FRAME_CHARS = 460
const CHUNK_HEAD = '[KYBERNOS LESSONS]'
const ACTIVE_SHARE = 0.7

const sanitize = (text) => String(text)
  .replace(/\r?\n+/g, ' · ')
  .replace(/\[\s*KYBERNOS\s*(LESSONS|MEMORY)/gi, '[KYBERNOS-$1')
  .slice(0, LESSON_MAX_CHARS + 1)

const lessonLine = (lesson) => '- [' + lesson.kyber + '] ' + sanitize(lesson.text) + (lesson.tags.length > 0 ? ' ' + lesson.tags.map((t) => '#' + t).join(' ') : '')

const usefulFirst = (a, b) => (b.uses || 0) - (a.uses || 0) || (Date.parse(b.ts) || 0) - (Date.parse(a.ts) || 0)

/**
 * Which lessons a session reads. The kyber the session runs gets most of the budget,
 * `default` (the general lessons) the rest; inside a kyber the most used come first,
 * then the newest. A lesson too long for what is left is skipped, not a stopper.
 */
export const planLessons = (sessionId) => {
  const active = activeKyber(sessionId)
  const kybers = active !== null && active !== 'default' ? [active, 'default'] : ['default']
  const budget = Math.max(0, CHUNK_MAX_CHARS - CHUNK_FRAME_CHARS)
  const chosen = []
  let used = 0
  let omitted = 0
  kybers.forEach((kyber, i) => {
    const cap = i === 0 && kybers.length > 1 ? Math.floor(budget * ACTIVE_SHARE) : budget
    const lessons = readLessons(kyber).map((l) => ({ ...l, kyber })).sort(usefulFirst)
    const groupStart = used
    for (const lesson of lessons) {
      const cost = lessonLine(lesson).length + 1
      if (used + cost > (i === 0 ? groupStart + cap : budget)) { omitted += 1; continue }
      chosen.push(lesson)
      used += cost
    }
  })
  return { kyber: active, chosen, used, omitted, cap: CHUNK_MAX_CHARS }
}

const sessionIdOf = (context) => {
  try { return context.agent.session.id } catch (e) { return undefined }
}

/** The text injected at each assembly. Synchronous, and it never throws. */
export const renderLessonsChunk = (context) => {
  try {
    const settings = readSettings()
    // Switched off: say so in one line, so an agent that was told elsewhere to record
    // lessons (a global rule, the memory.cjs habit) knows the user has turned it off.
    if (settings.lessons !== true) return CHUNK_HEAD + ' Lesson recording is turned off by the user: do not record lessons (no lesson_write, no memory.cjs lesson).'
    if (settings.context !== true) return ''
    const plan = planLessons(sessionIdOf(context))
    if (plan.chosen.length === 0) return ''
    const lines = [CHUNK_HEAD + ' Lessons learned on this machine' + (plan.kyber === null ? '' : ' (your kyber: ' + plan.kyber + ')') + ':']
    plan.chosen.forEach((l) => lines.push(lessonLine(l)))
    if (plan.omitted > 0) lines.push('- … (' + String(plan.omitted) + ' more not shown: lesson_search to look them up)')
    lines.push('', 'Record a new lesson with lesson_write only when an expectation was contradicted: one falsifiable sentence.')
    return lines.join('\n')
  } catch (e) {
    return ''
  }
}

// ── Tools ───────────────────────────────────────────────────────────────────
// Built by hand: `defineTool` lives in `@deepseek-ai/dsh-tools`, which this plugin
// cannot import, but `tools.register` only needs { name, parameters, output, execute }.
const TEXT = (text) => [{ type: 'text', text }]
const DEFAULT_KYBER = 'default'

const lessonWriteTool = () => ({
  name: 'lesson_write',
  description: 'Records a lesson learned in a kyber: ONE falsifiable sentence, only when an expectation was contradicted. Never fabricate one to fill a box.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      text: { type: 'string', description: 'The lesson, one sentence (cut at ' + String(LESSON_MAX_CHARS) + ' characters).' },
      kyber: { type: 'string', description: 'The kyber the lesson belongs to. Default: "default".' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Up to 5 short lower-case tags.' },
    },
    required: ['text'],
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { ok: { type: 'boolean' }, id: { type: 'string' }, duplicate: { type: 'boolean' }, evicted: { type: 'integer' }, error: { type: 'string' }, kybers: { type: 'string' } },
      required: ['ok'],
    },
    render: (args, value) => TEXT(value.ok === true ? (value.duplicate === true ? 'Lesson already recorded.' : 'Lesson recorded.') : 'Lesson not recorded: ' + String(value.error) + (value.kybers === undefined ? '' : ' (kybers: ' + value.kybers + ')')),
  },
  async execute(args) {
    if (readSettings().lessons !== true) return { ok: false, error: 'lecons_desactivees' }
    const made = addLesson(typeof args.kyber === 'string' && args.kyber !== '' ? args.kyber : DEFAULT_KYBER, { text: args.text, tags: args.tags, from: 'lesson_write' })
    if (made.ok !== true) return { ok: false, error: made.error, ...(made.kybers === undefined ? {} : { kybers: made.kybers.join(', ') }) }
    return { ok: true, id: made.lesson.id, duplicate: made.duplicate === true, evicted: made.evicted.length }
  },
})

const lessonSearchTool = () => ({
  name: 'lesson_search',
  description: 'Looks up lessons learned (every kyber, or one). Lessons it returns count as used, which keeps them from being evicted.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      q: { type: 'string', description: 'Words to look for.' },
      kyber: { type: 'string', description: 'Restrict to one kyber.' },
    },
    required: ['q'],
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { ok: { type: 'boolean' }, count: { type: 'integer' }, found: { type: 'string' }, error: { type: 'string' } },
      required: ['ok'],
    },
    render: (args, value) => TEXT(value.ok === true ? (value.count === 0 ? 'No lesson for "' + String(args.q) + '".' : String(value.found)) : 'Search impossible: ' + String(value.error)),
  },
  async execute(args) {
    if (readSettings().lessons !== true) return { ok: false, error: 'lecons_desactivees' }
    const hits = searchLessons(args.q, { kyber: args.kyber, limit: 8 })
    // Retrieving a lesson is the only use this module can see: it feeds the cap.
    hits.slice(0, 5).forEach((h) => { try { markUsed(h.id) } catch (e) { /* a counter is never worth failing the search */ } })
    return { ok: true, count: hits.length, found: hits.map((h) => '#' + h.id + ' (' + h.kyber + ') ' + h.text).join('\n') }
  },
})

// ── Routes ──────────────────────────────────────────────────────────────────
const sendJson = (res, status, payload) => {
  try {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(payload === undefined ? null : payload))
  } catch (e) {
    try { res.writeHead(500); res.end('{}') } catch (e2) { /* socket closed */ }
  }
}

const readJsonBody = async (req, cap) => {
  const max = typeof cap === 'number' ? cap : 16384
  try {
    let size = 0
    const chunks = []
    for await (const chunk of req) {
      size += chunk.length
      if (size > max) return {}
      chunks.push(chunk)
    }
    const text = Buffer.concat(chunks).toString('utf8')
    if (text.length === 0) return {}
    const parsed = JSON.parse(text)
    return parsed !== null && typeof parsed === 'object' && Array.isArray(parsed) === false ? parsed : {}
  } catch (e) { return {} }
}

/** Same guard as the other local routes: never cross-origin. */
const sameOrigin = (req) => {
  try {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : null
    const host = typeof req.headers.host === 'string' ? req.headers.host : null
    if (origin === null || host === null) return true
    return new URL(origin).host === host
  } catch (e) {
    return false
  }
}

const intParam = (raw, fallback, min, max) => {
  const n = parseInt(raw, 10)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

const queryOf = (req) => { try { return new URL(req.url, 'http://localhost').searchParams } catch (e) { return new URLSearchParams('') } }

const lessonsListRoute = async (req) => {
  const params = queryOf(req)
  const kyber = params.get('kyber')
  const listed = listLessons({
    kyber: isKyberId(kyber) ? kyber : undefined,
    used: params.get('used') === '1',
    added: params.get('added') === null ? undefined : params.get('added'),
    q: params.get('q') === null ? '' : params.get('q'),
    limit: intParam(params.get('limit'), 25, 1, 200),
    offset: intParam(params.get('offset'), 0, 0, 1000000),
  })
  // What a session reads depends on the kyber it runs; with no session in hand, the
  // page reports the `default` kyber's share and says what the scope is.
  const plan = planLessons(undefined)
  return {
    ok: true, ...listed,
    filters: { kyber: isKyberId(kyber) ? kyber : null, used: params.get('used') === '1', added: params.get('added') === null ? 'any' : params.get('added'), q: params.get('q') === null ? '' : params.get('q') },
    search: { mode: 'relevance', relevance: true },
    injection: { scope: 'the kyber of the session, plus default', cap: plan.cap, defaultSent: plan.chosen.length, defaultOmitted: plan.omitted },
    settings: readSettings(),
  }
}

const lessonsKybersRoute = async () => ({ ok: true, kybers: listKybers().map((id) => ({ id, count: readLessons(id).length })) })

const lessonsAddRoute = async (req, body) => {
  const input = body !== null && typeof body === 'object' ? body : {}
  const made = addLesson(typeof input.kyber === 'string' ? input.kyber : DEFAULT_KYBER, { text: input.text, tags: input.tags, from: 'page' })
  return made.ok === true ? made : { ok: false, error: made.error, ...(made.kybers === undefined ? {} : { kybers: made.kybers }) }
}

const lessonsUpdateRoute = async (req, body) => {
  const input = body !== null && typeof body === 'object' ? body : {}
  return updateLesson(input.id, { ...(input.text === undefined ? {} : { text: input.text }), ...(input.tags === undefined ? {} : { tags: input.tags }) })
}

const lessonsDeleteRoute = async (req, body) => deleteLesson(body !== null && typeof body === 'object' ? body.id : undefined)

// ── Tidy up: near-duplicate lessons (dedupe.mjs, local, no model) ───────────────────────────────────────────
// Same contract as the memories' tidy-up (kybernos-cloud): a scan only LOOKS and stores the groups; applying a group keeps
// one lesson (the one the user picks, optionally edited, inheriting the tags and the uses of the others) and removes the
// rest. Lessons only ever meet inside their own kyber (`bucket`). BEFORE anything is removed the removed rows and the kept
// one's old fields go to a local archive — Undo puts them back exactly, for 30 days; the store also archives each removed
// lesson in `lessons.archive.jsonl`, as every deletion does. Side files sit next to the settings file.

const TIDY_UNDO_DAYS = 30
const TIDY_MAX_REMOVALS = 50
const TIDY_DISMISSED_MAX = 500
const TIDY_LOG_MAX = 50

const tidyFile = (suffix) => settingsFile().replace(/\.json$/, '') + '.' + suffix + '.json'
const readTidyFile = (suffix, fallback) => {
  try {
    const parsed = JSON.parse(readFileSync(tidyFile(suffix), 'utf8'))
    return parsed !== null && typeof parsed === 'object' && Array.isArray(parsed) === false ? parsed : fallback
  } catch (e) { return fallback }
}
const writeTidyFile = (suffix, value) => {
  const file = tidyFile(suffix)
  const tmp = file + '.tmp-' + String(process.pid)
  try { mkdirSync(dirname(file), { recursive: true, mode: 0o700 }) } catch (e) { /* already there */ }
  try {
    writeFileSync(tmp, JSON.stringify(value) + '\n', { mode: 0o600 })
    renameSync(tmp, file)
  } catch (e) {
    try { rmSync(tmp, { force: true }) } catch (e2) { /* nothing to clean */ }
    throw e
  }
}

const tidyState = () => {
  const raw = readTidyFile('tidy', {})
  return {
    scan: raw.scan !== null && typeof raw.scan === 'object' && Array.isArray(raw.scan.groups) ? raw.scan : null,
    dismissed: Array.isArray(raw.dismissed) ? raw.dismissed.map(String) : [],
    log: Array.isArray(raw.log) ? raw.log : [],
    settings: normalizeTidySettings(raw.settings),
    last: raw.last !== null && typeof raw.last === 'object' && typeof raw.last.at === 'string' ? raw.last : null,
    judged: raw.judged !== null && typeof raw.judged === 'object' && !Array.isArray(raw.judged) ? raw.judged : {},
  }
}
const writeTidy = (t) => writeTidyFile('tidy', { scan: t.scan, dismissed: t.dismissed.slice(-TIDY_DISMISSED_MAX), log: t.log.slice(0, TIDY_LOG_MAX), settings: t.settings, last: t.last, judged: t.judged })

// The Study model (Kybernos Settings → `brain`, « route/id ») and the `llm` service that can talk to it.
const kybernosSettingsFile = () => {
  const own = process.env.KYBERNOS_SETTINGS_FILE
  return typeof own === 'string' && own.trim() !== '' ? own.trim() : join(dshHome(), 'kybernos', 'settings.json')
}
const studyModel = () => readStudyModel(() => readFileSync(kybernosSettingsFile(), 'utf8'))
let hostCtx = null
const tidyLlm = () => { try { return hostCtx === null ? undefined : hostCtx.get('llm') } catch (e) { return undefined } }
// A run that starts by itself, and the process-wide flags it needs.
export const TIDY_TUNING = { firstMs: 90000, tickMs: 600000 }
export const tidyFlags = { running: false, bootDone: false, retryAt: 0 }
const tidyArchive = () => { const raw = readTidyFile('tidy-archive', {}); return { runs: raw.runs !== null && typeof raw.runs === 'object' ? raw.runs : {} } }
const writeTidyArchive = (a) => writeTidyFile('tidy-archive', a)

const forgetOldArchive = () => {
  const limit = Date.now() - TIDY_UNDO_DAYS * 86400000
  const a = tidyArchive()
  let changed = false
  for (const id of Object.keys(a.runs)) { if (!(Date.parse(a.runs[id].at) > limit)) { delete a.runs[id]; changed = true } }
  if (changed) writeTidyArchive(a)
  return a
}

/** Every lesson of every kyber, by id, as it is NOW. */
const liveLessons = () => {
  const live = new Map()
  for (const kyber of listKybers()) for (const lesson of readLessons(kyber)) live.set(lessonId(kyber, lesson), { kyber, lesson })
  return live
}

const tidyView = () => {
  const t = tidyState()
  const a = forgetOldArchive()
  const live = liveLessons()
  const now = Date.now()
  // a group whose lessons are gone or changed since the scan is not offered any more (apply would refuse it anyway)
  const groups = t.scan === null ? [] : t.scan.groups.filter((g) => t.dismissed.indexOf(g.id) < 0 && g.items.every((i) => live.has(String(i.id)))).map((g) => ({
    ...g, kyber: parseLessonId(String(g.keeperId)) === null ? null : parseLessonId(String(g.keeperId)).kyber,
    items: g.items.map((i) => {
      const found = live.get(String(i.id))
      const when = Date.parse(i.createdAt)
      return { ...i, uses: found.lesson.uses, tags: found.lesson.tags, ageMinutes: Number.isFinite(when) ? Math.max(0, Math.round((now - when) / 60000)) : null }
    }),
  }))
  return {
    ok: true, scannedAt: t.scan === null ? null : t.scan.at, total: t.scan === null ? null : t.scan.total, groups,
    saves: groups.reduce((n, g) => n + g.saves, 0),
    log: t.log.slice(0, 20).map((l) => ({ ...l, canUndo: l.undone !== true && a.runs[l.id] !== undefined })),
    settings: t.settings, last: t.last,
    next: tidyNext({ schedule: t.settings.schedule, last: t.last, now, total: live.size > 0 ? live.size : null, bootDone: tidyFlags.bootDone }),
    brain: { model: studyModel(), llm: tidyLlm() !== undefined },
    unclear: t.scan === null || !Number.isFinite(t.scan.unclear) ? 0 : t.scan.unclear,
  }
}

/**
 * One run: look (local detection, and — when the user allowed it and a Study model is set — its judgement of the pairs
 * the word count cannot decide), then, in `auto` mode, merge by itself the local groups at or above the line.
 */
const tidyRun = async (trigger, now = Date.now()) => {
  if (tidyFlags.running) return { ok: false, error: 'deja_en_cours' }
  tidyFlags.running = true
  try {
    const items = []
    for (const [id, { kyber, lesson }] of liveLessons()) items.push({ id, content: lesson.text, createdAt: lesson.ts, pinned: false, bucket: kyber })
    const t = tidyState()
    const local = findDuplicateGroups(items)
    const taken = new Set(local.flatMap((g) => g.items.map((i) => i.id)))
    let suggestions = []
    let unclear = 0
    const brain = { asked: 0, error: null, detail: null, model: '' }
    if (t.settings.brain === true) {
      brain.model = studyModel()
      const llm = tidyLlm()
      const judged = await brainGroups({ items, taken, judged: t.judged, dismissed: t.dismissed, llm: brain.model === '' ? null : llm, model: brain.model, maxMerged: LESSON_MAX_CHARS, noun: 'lessons' })
      suggestions = judged.groups
      unclear = judged.unclear
      brain.asked = judged.asked
      brain.error = brain.model === '' ? 'pas_de_modele_detude' : (llm === undefined ? 'llm_indisponible' : judged.error)
      t.judged = judged.judged
      brain.detail = brain.error === null ? null : (judged.detail === undefined ? null : judged.detail)
      if (brain.error !== null && brain.error !== 'pas_de_modele_detude' && brain.error !== 'llm_indisponible') console.error('[kybernos-memory] tidy-up: the Study model could not be asked (' + brain.error + (brain.detail === null ? '' : ': ' + brain.detail) + ')')
    } else {
      unclear = unclearPairs(items, { taken }).filter((p) => t.dismissed.indexOf(p.id) < 0).length
    }
    t.scan = { at: new Date(now).toISOString(), total: items.length, unclear, groups: [...local, ...suggestions] }
    writeTidy(t)
    const auto = { groups: 0, removed: 0, runs: [], failed: 0 }
    const picked = pickAuto(local.filter((g) => t.dismissed.indexOf(g.id) < 0), t.settings)
    for (const chunk of removalChunks(picked, TIDY_MAX_REMOVALS)) {
      const done = applyGroups(chunk.map((g) => ({ id: g.id })), 'auto', now)
      if (done.error !== undefined) { auto.failed += chunk.length; continue }
      for (const r of done.results) {
        if (r.ok === true) { auto.groups += 1; auto.removed += r.removed || 0; if (r.run) auto.runs.push(r.run) } else auto.failed += 1
      }
    }
    const after = tidyState()
    after.last = { at: new Date(now).toISOString(), trigger, total: items.length - auto.removed, found: local.length + suggestions.length, autoGroups: auto.groups, autoRemoved: auto.removed, brainAsked: brain.asked, brainError: brain.error, ok: true }
    writeTidy(after)
    return { ...tidyView(), auto, brain }
  } finally {
    tidyFlags.running = false
  }
}
const tidyScan = () => tidyRun('manual')

const tidySettings = (body) => {
  const t = tidyState()
  const patched = patchTidySettings(t.settings, body)
  if (patched.ok !== true) return patched
  t.settings = patched.settings
  writeTidy(t)
  return { ok: true, settings: t.settings, view: tidyView() }
}

/** One look at whether a scheduled run is due; a run that fails waits an hour. Never throws. */
export const tidyTick = async (now = Date.now()) => {
  try {
    if (readSettings().lessons !== true) return { ran: false, why: 'lecons_desactivees' }
    const t = tidyState()
    const count = liveLessons().size
    const due = tidyDue({ schedule: t.settings.schedule, last: t.last, now, total: count > 0 ? count : null, bootDone: tidyFlags.bootDone, retryAt: tidyFlags.retryAt })
    if (t.settings.schedule === 'start') tidyFlags.bootDone = true
    if (!due) return { ran: false, why: 'pas_echu' }
    const res = await tidyRun('schedule', now)
    if (res.ok !== true) { tidyFlags.retryAt = now + 3600000; return { ran: false, why: res.error } }
    return { ran: true, auto: res.auto }
  } catch (e) {
    tidyFlags.retryAt = now + 3600000
    return { ran: false, why: 'erreur' }
  }
}

const mountTidySchedule = (ctx) => {
  ctx.effect(() => {
    const first = setTimeout(() => { void tidyTick() }, TIDY_TUNING.firstMs)
    const timer = setInterval(() => { void tidyTick() }, TIDY_TUNING.tickMs)
    if (typeof first.unref === 'function') first.unref()
    if (typeof timer.unref === 'function') timer.unref()
    return () => { clearTimeout(first); clearInterval(timer) }
  }, 'kybernos-memory: scheduled tidy-up')
}

const tidyDismiss = (body) => {
  const ids = body !== null && typeof body === 'object' && Array.isArray(body.groups) ? body.groups.map(String) : []
  if (ids.length === 0) return { ok: false, error: 'groupes_manquants' }
  const t = tidyState()
  if (body.restore === true) t.dismissed = t.dismissed.filter((d) => ids.indexOf(d) < 0)   // Undo of « Keep both »
  else for (const id of ids) if (t.dismissed.indexOf(id) < 0) t.dismissed.push(id)
  writeTidy(t)
  return tidyView()
}

const fieldsOf = (lesson) => ({ text: lesson.text, tags: lesson.tags, uses: lesson.uses, lastUsed: lesson.lastUsed })

/**
 * `body = { confirm: true, groups: [{ id, keep?, edit? }] }`. Each group is checked against the files NOW: a lesson that
 * was edited or deleted since the scan makes its group `a_change`, never a guess. The kept lesson inherits the others' tags
 * (5 at most) and uses, so merging never makes it the first thing the 50-lesson cap evicts.
 */
const tidyApply = (body) => {
  if (body === null || typeof body !== 'object' || body.confirm !== true) return { ok: false, error: 'confirmation_requise' }
  const asked = Array.isArray(body.groups) ? body.groups : []
  if (asked.length === 0) return { ok: false, error: 'groupes_manquants' }
  const done = applyGroups(asked, 'you')
  if (done.error !== undefined) return { ok: false, error: done.error, ...(done.max === undefined ? {} : { max: done.max, wanted: done.wanted }) }
  return { ok: done.results.every((r) => r.ok === true), results: done.results, view: tidyView() }
}

/** The work of an apply, for the user's click (`by: 'you'`) and for a run that merges by itself (`by: 'auto'`). */
const applyGroups = (asked, by, now = Date.now()) => {
  const t = tidyState()
  if (t.scan === null) return { error: 'aucun_scan', results: [] }
  const live = liveLessons()
  const plan = []
  const results = []
  let removals = 0
  for (const want of asked) {
    const id = want !== null && typeof want === 'object' ? String(want.id) : ''
    const group = t.scan.groups.find((g) => g.id === id)
    if (group === undefined) { results.push({ id, ok: false, error: 'groupe_inconnu' }); continue }
    const members = group.items.map((i) => live.get(String(i.id)))
    if (members.some((m) => m === undefined)) { results.push({ id, ok: false, error: 'a_change' }); continue }
    const keepId = want.keep === undefined || want.keep === null ? String(group.keeperId) : String(want.keep)
    const ids = group.items.map((i) => String(i.id))
    if (ids.indexOf(keepId) < 0) { results.push({ id, ok: false, error: 'garde_invalide' }); continue }
    let edit = null
    if (typeof want.edit === 'string' && want.edit.trim() !== '') {
      edit = want.edit.trim()
      if (edit.length > LESSON_MAX_CHARS) { results.push({ id, ok: false, error: 'contenu_trop_long' }); continue }
    }
    const keeper = live.get(keepId)
    const removed = ids.filter((x) => x !== keepId).map((x) => ({ id: x, ...live.get(x) }))
    removals += removed.length
    plan.push({ group, keepId, keeper, removed, edit: edit !== null && edit !== keeper.lesson.text ? edit : null })
  }
  if (removals > TIDY_MAX_REMOVALS) return { error: 'trop_de_suppressions', max: TIDY_MAX_REMOVALS, wanted: removals, results: [] }
  const log = []
  for (const step of plan) {
    const runId = 't' + Date.now().toString(36) + step.group.id
    const { kyber, lesson } = step.keeper
    const tags = []
    for (const tag of [...lesson.tags, ...step.removed.flatMap((r) => r.lesson.tags)]) if (tags.indexOf(tag) < 0 && tags.length < 5) tags.push(tag)
    const uses = lesson.uses + step.removed.reduce((n, r) => n + r.lesson.uses, 0)
    const stamps = [lesson.lastUsed, ...step.removed.map((r) => r.lesson.lastUsed)].filter((x) => typeof x === 'string' && Number.isFinite(Date.parse(x)))
    const lastUsed = stamps.length === 0 ? null : stamps.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b))
    const next = { text: step.edit === null ? lesson.text : step.edit, tags, uses, lastUsed }
    const changes = next.text !== lesson.text || next.uses !== lesson.uses || next.lastUsed !== lesson.lastUsed || next.tags.join('\n') !== lesson.tags.join('\n')
    const afterId = lessonId(kyber, { ts: lesson.ts, text: next.text })
    // 1. the archive FIRST: if anything below fails half way, what was removed can always be put back
    const archive = tidyArchive()
    archive.runs[runId] = { at: new Date().toISOString(), kyber, removed: step.removed.map((r) => r.lesson), edited: changes ? [{ id: afterId, before: fieldsOf(lesson) }] : [] }
    writeTidyArchive(archive)
    let edited = false
    if (changes) {
      const done = retouchLesson(step.keepId, next)
      if (done.ok !== true) { const a2 = tidyArchive(); delete a2.runs[runId]; writeTidyArchive(a2); results.push({ id: step.group.id, ok: false, error: done.error }); continue }
      edited = true
    }
    const gone = []
    let failure = null
    for (const r of step.removed) {
      const del = deleteLesson(r.id, 'tidy')
      if (del.ok !== true) { failure = del.error; break }
      gone.push(r.lesson)
    }
    // the archive keeps ONLY what was really removed (and the old fields only if they were really changed)
    const kept = tidyArchive()
    kept.runs[runId].removed = gone
    if (!edited) kept.runs[runId].edited = []
    if (gone.length === 0 && !edited) delete kept.runs[runId]
    writeTidyArchive(kept)
    if (gone.length > 0 || edited) log.push({ id: runId, at: new Date(now).toISOString(), by, groupId: step.group.id, kyber, kept: afterId, removed: gone.length, edited, partial: failure !== null, undone: false })
    results.push({ id: step.group.id, ok: failure === null, removed: gone.length, edited, run: gone.length > 0 || edited ? runId : null, error: failure === null ? undefined : failure })
  }
  const after = tidyState()
  const done = new Set(results.filter((r) => r.ok === true).map((r) => r.id))
  if (after.scan !== null) after.scan.groups = after.scan.groups.filter((g) => !done.has(g.id))
  after.log = [...log.reverse(), ...after.log]
  writeTidy(after)
  return { results }
}

/** Puts a run back exactly: removed lessons return as they were (ts, tags, uses…), the kept one gets its old fields. */
const tidyUndo = (body) => {
  const runId = body !== null && typeof body === 'object' ? String(body.run || '') : ''
  if (runId === '') return { ok: false, error: 'run_manquant' }
  const t = tidyState()
  const entry = t.log.find((l) => l.id === runId)
  if (entry === undefined) return { ok: false, error: 'run_inconnu' }
  if (entry.undone === true) return { ok: false, error: 'deja_annule' }
  const archive = tidyArchive()
  const run = archive.runs[runId]
  if (run === undefined) return { ok: false, error: 'archive_perimee' }
  // the kept lesson first: if the kyber is full the restore below refuses, and nothing has been touched yet
  const back = restoreLessons(run.kyber, run.removed)
  if (back.ok !== true) return { ok: false, error: back.error, ...(back.room === undefined ? {} : { room: back.room, needed: back.needed }) }
  let reverted = 0
  let notReverted = 0
  for (const e of run.edited) {
    const done = retouchLesson(e.id, e.before)
    if (done.ok === true) reverted += 1
    else notReverted += 1
  }
  delete archive.runs[runId]
  entry.undone = true
  writeTidyArchive(archive)
  writeTidy(t)
  return { ok: true, restored: back.restored, reverted, notReverted, view: tidyView() }
}

const tidyRoute = async () => tidyView()
const tidyScanRoute = async () => tidyScan()
const tidyApplyRoute = async (req, body) => tidyApply(body)
const tidyDismissRoute = async (req, body) => tidyDismiss(body)
const tidySettingsRoute = async (req, body) => tidySettings(body)
const tidyUndoRoute = async (req, body) => tidyUndo(body)

const settingsRoute = async () => ({ ok: true, settings: readSettings() })

const settingsSetRoute = async (req, body) => {
  const incoming = body !== null && typeof body === 'object' && Array.isArray(body) === false ? body : null
  if (incoming === null) return { ok: false, error: 'corps_invalide' }
  const next = readSettings()
  for (const key of Object.keys(incoming)) {
    // Fail-closed: an unknown key or a non-boolean refuses the whole patch — a switch
    // is never half applied.
    if (SETTING_KEYS.indexOf(key) < 0) return { ok: false, error: 'cle_inconnue', key }
    if (typeof incoming[key] !== 'boolean') return { ok: false, error: 'valeur_invalide', key }
    next[key] = incoming[key]
  }
  writeSettings(next)
  return { ok: true, settings: next }
}

// One path per route: the web server indexes by path only, so a GET and a POST can
// never share one (kybernos-cloud's host suite caught that once).
export const ROUTES = [
  { path: '/kybernos-memory/lessons', method: 'GET', guarded: true, run: lessonsListRoute },
  { path: '/kybernos-memory/kybers', method: 'GET', guarded: true, run: lessonsKybersRoute },
  { path: '/kybernos-memory/lessons/add', method: 'POST', guarded: true, body: true, run: lessonsAddRoute },
  { path: '/kybernos-memory/lessons/update', method: 'POST', guarded: true, body: true, run: lessonsUpdateRoute },
  { path: '/kybernos-memory/lessons/delete', method: 'POST', guarded: true, body: true, run: lessonsDeleteRoute },
  { path: '/kybernos-memory/tidy', method: 'GET', guarded: true, run: tidyRoute },
  { path: '/kybernos-memory/tidy/scan', method: 'POST', guarded: true, run: tidyScanRoute },
  { path: '/kybernos-memory/tidy/apply', method: 'POST', guarded: true, body: true, cap: 65536, run: tidyApplyRoute },
  { path: '/kybernos-memory/tidy/dismiss', method: 'POST', guarded: true, body: true, cap: 16384, run: tidyDismissRoute },
  { path: '/kybernos-memory/tidy/undo', method: 'POST', guarded: true, body: true, cap: 4096, run: tidyUndoRoute },
  { path: '/kybernos-memory/tidy/settings', method: 'POST', guarded: true, body: true, cap: 4096, run: tidySettingsRoute },
  { path: '/kybernos-memory/settings', method: 'GET', guarded: true, run: settingsRoute },
  { path: '/kybernos-memory/settings/set', method: 'POST', guarded: true, body: true, run: settingsSetRoute },
]

const mountRoutes = (ctx, webServer) => {
  for (const route of ROUTES) {
    const handler = async (req, res) => {
      if (req.method !== route.method) return sendJson(res, 405, { ok: false, error: route.method + ' expected' })
      if (route.guarded === true && sameOrigin(req) === false) return sendJson(res, 403, { ok: false, error: 'origin refused' })
      try {
        const body = route.body === true ? await readJsonBody(req, route.cap) : null
        sendJson(res, 200, await route.run(req, body))
      } catch (e) {
        console.error('[kybernos-memory] ' + route.path + ': ' + String((e && e.message) || e))
        sendJson(res, 500, { ok: false, error: 'internal error' })
      }
    }
    ctx.effect(() => webServer.register({ kind: 'exact', path: route.path, handler }), 'kybernos-memory: route ' + route.path)
  }
  say('routes /kybernos-memory/* mounted')
}

const mountPrompt = (ctx) => {
  ctx.inject(['systemPrompt'], (scope) => {
    scope.systemPrompt.context({ name: CHUNK_NAME, order: CHUNK_ORDER, text: (context) => renderLessonsChunk(context) })
  })
}

const mountTools = (ctx) => {
  ctx.inject(['tools'], (scope) => {
    scope.tools.register(lessonWriteTool())
    scope.tools.register(lessonSearchTool())
  })
}

export function apply(ctx) {
  try {
    if (ctx.get('webServer') !== undefined) mountRoutes(ctx, ctx.get('webServer'))
    else ctx.inject(['webServer'], (scope) => mountRoutes(ctx, scope.webServer))
  } catch (e) { say('routes not mounted: ' + String((e && e.message) || e)) }
  try { mountPrompt(ctx) } catch (e) { say('prompt chunk not mounted: ' + String((e && e.message) || e)) }
  try { mountTools(ctx) } catch (e) { say('tools not mounted: ' + String((e && e.message) || e)) }
  hostCtx = ctx
  try { mountTidySchedule(ctx) } catch (e) { say('scheduled tidy-up not mounted: ' + String((e && e.message) || e)) }
}

// Exported for the host suite (test-memory-host.mjs): nothing else is promised.
export { lessonWriteTool, lessonSearchTool, sanitize, CHUNK_NAME, CHUNK_ORDER, CHUNK_MAX_CHARS, tidyRun, tidySettings, studyModel }
