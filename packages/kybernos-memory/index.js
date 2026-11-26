// ═════════════════════════════════════════════════════════════════════════════
// kybernos-memory — lessons learned: read, write, inject, switch on and off.
//
// Host half. What it does, and what it does not:
//   · the lessons live in `<kybers>/<kyber>/memory/lessons.jsonl` (see
//     lessons-store.mjs — same rules as `<DSH home>/kybers/memory.cjs`);
//   · it injects the lessons of the kyber a session runs (plus `default`) into the
//     system prompt, in a small bounded chunk — never the lessons of every kyber;
//   · the chunk is an INDEX (id, title, summary per lesson; the ones that match the latest message in full), and the full text
//     is read on demand with `lesson_read`;
//   · it gives the agent five tools, `lesson_write`, `lesson_search`, `lesson_read`, `lesson_forget` (asks the person first) and
//     `memory_tidy` (the lessons tidy-up, now);
//   · it serves the routes of the "Memory & Lessons learned" page;
//   · two switches, `lessons` and `context`, persisted in `<DSH home>/kybernos-memory.json`;
//   · in a TEAM space (team-space.mjs asks kybernos-cloud) nothing here is injected, searched or written by the agent: personal
//     lessons stay out of a team conversation, and « Propose to team » is the one door.
// The account memory (cloud) stays in `@local/kybernos-cloud`: it needs the account
// token, lessons do not — they keep working offline and without an account.
//
// A bundle must never stop DSH from starting: every mount below is guarded.
// No import from `@deepseek-ai/*` (a plugin linked as `@local/…` cannot resolve them);
// the route helpers are small copies of the ones in kybernos-cloud, since bundles
// cannot share code.
// ═════════════════════════════════════════════════════════════════════════════

import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { LESSONS_NEAR_COUNT, LESSON_MAX_CHARS, activeKybers, addLesson, deleteLesson, dshHome, isKyberId, listKybers, listLessons, markUsed, readLessons, searchLessons, updateLesson, restoreLessons, retouchLesson, lessonId, parseLessonId, lessonHeads, clipWords, archiveLessons, LESSON_TITLE_MAX, LESSON_SUMMARY_MAX } from './lessons-store.mjs'
import { findDuplicateGroups, unclearPairs } from './dedupe.mjs'
import { rank } from './relevance.mjs'
import { writeGuard } from './session-guard.mjs'
import { TIDY_SCHEDULES, normalizeTidySettings, patchTidySettings, tidyDue, tidyNext, pickAuto, AUTO_MAX_BRAIN_MERGES, autoRequest, removalChunks, readStudyChoice, brainGroups, askModel, brainPrompt, parseVerdicts, textHash, BRAIN_BATCH, BRAIN_TIMEOUT_MS } from './tidy.mjs'
import { COMPACT_BATCH, COMPACT_MAX_CALLS, COMPACT_TEXT_MAX, askCompactions, needsCompaction } from './compact.mjs'
import { TEAM_SPACE_REFUSAL, inTeamSpace, lessonsCut, touchesPersonalMemory } from './team-space.mjs'
import { importClaudeMemories, readStaging, writeStaging, setEntryStatus, statusCounts, scanClaudeMemory } from './claude-import.mjs'

export const name = 'kybernos-memory'

const say = (message) => console.log('[kybernos-memory] ' + message)

// ── Switches ────────────────────────────────────────────────────────────────
// `lessons`: agents may save and look up lessons. `context`: lessons are injected into
// the system prompt. `relevant`: besides the base selection, also send the lessons that clearly match what the user
// just asked. All true by default — that is how things behaved before the switches existed, so nothing changes for
// whoever never touches them (`relevant` is new and local: nothing extra leaves the machine).
const SETTING_KEYS = ['lessons', 'context', 'relevant']

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
// The frame (head, index note, "more" line, closing instruction) counts inside the cap: the cap bounds the whole injected
// text, not only the lesson lines. Each part is measured, not guessed.
const INDEX_NOTE = 'The other lessons, one line each (id title : summary). Before you rely on one, read its full text with lesson_read (up to 5 ids per call).'
// One door (2026-11-20): 148 of his 212 lessons were written by a script outside this bundle, which none of the rules here could see.
const RECORD_LINE = 'Record a new lesson with lesson_write only when an expectation was contradicted: one falsifiable sentence. lesson_write is the only door: never a file or a script.'
const moreLine = (n) => '- \u2026 (' + String(n) + ' more not shown: lesson_search to look them up)'
/** The widths of the "title : summary" part of an index line, widest first (planLessons takes the widest at which every lesson fits). */
export const INDEX_WIDTHS = [200, 160, 130, 110, 96, 84, 72, 64, 56, 48, 42, 36]
const CHUNK_HEAD = '[KYBERNOS LESSONS]'
const ACTIVE_SHARE = 0.7

const sanitize = (text) => String(text)
  .replace(/\r?\n+/g, ' · ')
  .replace(/\[\s*KYBERNOS\s*(LESSONS|MEMORY)/gi, '[KYBERNOS-$1')
  .slice(0, LESSON_MAX_CHARS + 1)

const lessonLine = (lesson) => '- [' + lesson.kyber + '] ' + sanitize(lesson.text) + (lesson.tags.length > 0 ? ' ' + lesson.tags.map((t) => '#' + t).join(' ') : '')

const usefulFirst = (a, b) => (b.uses || 0) - (a.uses || 0) || (Date.parse(b.ts) || 0) - (Date.parse(a.ts) || 0)

const headLine = (kybers) => CHUNK_HEAD + ' Lessons learned on this machine' + (kybers.length === 0 ? '' : ' (your agent ' + (kybers.length > 1 ? 'teams' : 'team') + ': ' + kybers.join(', ') + ')') + ':'

/**
 * One index entry: `- <id> <title> : <summary>` with the "title : summary" part within `width` characters. A summary that starts
 * with the title (what the fallback of an old line gives) is shown alone; when the width leaves too little for a summary, the title alone.
 * A lesson with no title of its own and a text no longer than a title is shown whole: reading it again would cost more.
 */
export const indexLine = (lesson, width) => {
  const heads = lessonHeads(lesson)
  const stem = heads.title.replace(/\u2026$/, '')
  const whole = clipWords(lesson.text, LESSON_MAX_CHARS + 1)
  let body
  if (!heads.own && whole.length <= Math.max(width, LESSON_TITLE_MAX)) body = whole
  else if (heads.summary.startsWith(stem)) body = clipWords(heads.summary, width)
  else if (heads.title.length + 3 + 16 <= width) body = heads.title + ' : ' + clipWords(heads.summary, width - heads.title.length - 3)
  else body = clipWords(heads.title, width)
  return '- ' + lesson.id + ' ' + sanitize(body)
}

// ── The lessons that matter to THIS question ───────────────────────────────
// The base selection (most used, then newest) cannot know what the user is asking: a kyber holds up to 50 lessons and
// the block fits about a third of them. So the human's latest message of each session is kept here and ranked against the
// lessons of the kybers the session reads (relevance.mjs, local: nothing is sent anywhere), and the ones that clearly
// match go first. The same rules as the memories' (kybernos-cloud): the engine appends a new « runtime context » snapshot
// to the history whenever this text changes, so the pick is made once per user message, kept while the topic is the same
// (overlap), and not changed again for a few turns — never per step, never per tool call.
export const RELEVANCE_TUNING = {
  maxTerms: 12,           // judge the question by its 12 rarest words that can match something
  minCoverage: 0.25,      // >= 2 words matched and a quarter of the question's rarity …
  strongCoverage: 0.5,    // … or 1 word that is half of it
  relative: 0.5,          // and never less than this fraction of the best match's coverage
  maxPicked: 4,           // at most this many lessons picked
  maxCandidates: 10,      // … and only when the question is SELECTIVE: more than this many qualifying means none stands out
  share: 0.4,             // … and at most this share of the lessons budget
  keepOverlap: 0.6,       // a new pick that overlaps the last one this much changes nothing
  minTurnsBetweenChanges: 3,
  queryChars: 1200,
  sessions: 64,
}
export const sessionQuery = new Map()   // sessionId -> { key, text, turn }
export const sessionPick = new Map()    // sessionId -> { key, ids, turn }

const forgetOldest = (map) => { while (map.size > RELEVANCE_TUNING.sessions) map.delete(map.keys().next().value) }

/** The text of a HUMAN prompt (source.kind 'user'); injected context, file notices, skills and goal rounds are not a question. */
export const userPromptText = (message) => {
  if (message === null || typeof message !== 'object') return ''
  const kind = message.source !== null && typeof message.source === 'object' ? message.source.kind : undefined
  if (kind !== 'user') return ''
  const blocks = Array.isArray(message.content) ? message.content : []
  return blocks.filter((b) => b !== null && typeof b === 'object' && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n').trim()
}

export const noteUserTurn = (sessionId, message, turn) => {
  try {
    const text = userPromptText(message)
    if (typeof sessionId !== 'string' || sessionId === '' || text === '') return
    const cut = text.slice(0, RELEVANCE_TUNING.queryChars)
    sessionQuery.delete(sessionId)
    sessionQuery.set(sessionId, { key: String(Number.isFinite(turn) ? turn : 0) + ':' + String(text.length) + ':' + cut.slice(0, 40), text: cut, turn: Number.isFinite(turn) ? turn : 0 })
    forgetOldest(sessionQuery)
  } catch (e) { /* never break a turn */ }
}

const overlapOf = (a, b) => {
  if (a.length === 0 && b.length === 0) return 1
  const set = new Set(a)
  let both = 0
  for (const id of b) if (set.has(id)) both += 1
  return both / (a.length + b.length - both)
}

/** The lessons of `candidates` (each with an `id`) that match this session's latest question, best first; [] when nothing clearly does. */
export const pickRelevant = (sessionId, candidates) => {
  const q = sessionQuery.get(sessionId)
  if (q === undefined) return []
  const byId = new Map(candidates.map((l) => [l.id, l]))
  const prev = sessionPick.get(sessionId)
  if (prev !== undefined && prev.key === q.key) return prev.ids.map((id) => byId.get(id)).filter((l) => l !== undefined)   // same message, next step: byte-identical
  const T = RELEVANCE_TUNING
  // tags and the kyber's name are text too (as in the lessons search)
  const ranked = rank(candidates.map((l) => ({ content: l.text + ' ' + l.tags.join(' '), createdAt: l.ts, pinned: false, lesson: l })), q.text, { maxTerms: T.maxTerms })
  const passing = ranked.filter((r) => (r.matched >= 2 && r.coverage >= T.minCoverage) || (r.matched >= 1 && r.coverage >= T.strongCoverage))
  const best = passing.reduce((top, r) => Math.max(top, r.coverage), 0)
  const strong = passing.filter((r) => r.coverage >= best * T.relative)
  const ids = strong.length > T.maxCandidates ? [] : strong.slice(0, T.maxPicked).map((r) => r.doc.lesson.id)
  let next = ids
  let turn = q.turn
  if (prev !== undefined) {
    const spaced = q.turn - prev.turn >= T.minTurnsBetweenChanges
    if (overlapOf(ids, prev.ids) >= T.keepOverlap || !spaced) { next = prev.ids; turn = prev.turn }
  }
  sessionPick.delete(sessionId)
  sessionPick.set(sessionId, { key: q.key, ids: next, turn })
  forgetOldest(sessionPick)
  return next.map((id) => byId.get(id)).filter((l) => l !== undefined)
}

/**
 * Which lessons a session reads, and how. The block is an INDEX, like the skills list: the lessons that clearly match the user's
 * latest message are written in full (at most their own share of the budget), every other lesson that fits is one line,
 * `- <id> <title> : <summary>`, and the model reads a full text with lesson_read before it relies on it. The selection is the one
 * the block always had: the kybers the session runs share 70 % of the budget (the ones that hold no lesson do not count in the
 * split), `default` (the general lessons) gets the rest, and inside a team the most used come first, then the newest. What a share
 * leaves unused (default needed less) goes back to the teams.
 * The index lines are as wide as the budget allows: the widest of INDEX_WIDTHS at which every lesson fits, else the narrowest
 * and as many as fit. Everything here depends only on the files and the pick, so the text is byte-identical while they stay the same.
 * `sessionId` also decides the relevance pick: the page (no session) shows the base selection, the prompt shows both.
 */
export const planLessons = (sessionId, options = {}) => {
  const running = activeKybers(sessionId)
  const actives = running.filter((kyber) => kyber !== 'default')
  const kybers = [...actives, 'default']
  const frame = headLine(running).length + 1 + INDEX_NOTE.length + 1 + moreLine(999).length + 1 + 1 + RECORD_LINE.length
  const budget = Math.max(0, CHUNK_MAX_CHARS - frame)
  const all = kybers.flatMap((kyber) => readLessons(kyber).map((l) => ({ ...l, kyber, id: lessonId(kyber, l) })))
  const wantRelevant = options.relevant === true && typeof sessionId === 'string'
  const preferred = wantRelevant ? pickRelevant(sessionId, all) : []
  const relevantCap = Math.floor(budget * RELEVANCE_TUNING.share)
  const activeCap = Math.floor(budget * ACTIVE_SHARE / Math.max(1, actives.filter((kyber) => all.some((l) => l.kyber === kyber)).length))
  const groupUsed = kybers.map(() => 0)
  const full = []
  let used = 0
  let relevantUsed = 0
  // what matches the question, in full, BEFORE anything else and within its own share
  for (const lesson of preferred) {
    const i = kybers.indexOf(lesson.kyber)
    const cost = lessonLine(lesson).length + 1
    if (relevantUsed + cost > relevantCap || used + cost > budget || (i < actives.length && groupUsed[i] + cost > activeCap)) continue
    full.push(lesson)
    used += cost
    relevantUsed += cost
    groupUsed[i] += cost
  }
  const rest = []
  kybers.forEach((kyber, i) => { for (const lesson of all.filter((l) => l.kyber === kyber && !full.includes(l)).sort(usefulFirst)) rest.push({ lesson, i, k: rest.length }) })
  const fill = (width) => {
    const g = groupUsed.slice()
    let u = used
    const shown = []
    const take = (x, capped) => {
      const line = indexLine(x.lesson, width)
      const cost = line.length + 1
      if (u + cost > budget || (capped && x.i < actives.length && g[x.i] + cost > activeCap)) return false
      shown.push({ lesson: x.lesson, line, k: x.k })
      u += cost
      g[x.i] += cost
      return true
    }
    const skipped = rest.filter((x) => !take(x, true))
    // what is left goes back to the teams in turn, one lesson each, so that two full teams still get the same share
    const queues = kybers.map((kyber, i) => skipped.filter((x) => x.i === i))
    let omitted = 0
    for (let open = true; open;) {
      open = false
      for (const q of queues) {
        if (q.length === 0) continue
        if (take(q[0], false)) { q.shift(); open = true } else { omitted += q.length; q.length = 0 }
      }
    }
    return { shown: shown.sort((a, b) => a.k - b.k), omitted, used: u, width }
  }
  let index = fill(INDEX_WIDTHS[0])
  for (let w = 1; w < INDEX_WIDTHS.length && index.omitted > 0; w++) index = fill(INDEX_WIDTHS[w])
  return {
    kybers: running, full, index: index.shown.map((x) => ({ id: x.lesson.id, line: x.line })), chosen: [...full, ...index.shown.map((x) => x.lesson)],
    picked: full.map((l) => l.id), used: index.used, omitted: index.omitted, width: index.width, cap: CHUNK_MAX_CHARS,
  }
}

const sessionIdOf = (context) => {
  try { return context.agent.session.id } catch (e) { return undefined }
}

/** The text injected at each assembly. Synchronous, and it never throws. */
export const renderLessonsChunk = (context) => {
  try {
    // A team space: no lesson goes in, and the agent is told why — a global rule or the memory.cjs habit would otherwise go on recording them.
    if (lessonsCut()) return CHUNK_HEAD + ' This is a team space: the person\'s own lessons are not available here and none can be recorded (no lesson_write, no lesson_search, no lesson_read, no memory.cjs lesson). To share a lesson with the team, the person uses "Propose to team".'
    const settings = readSettings()
    // Switched off: say so in one line, so an agent that was told elsewhere to record
    // lessons (a global rule, the memory.cjs habit) knows the user has turned it off.
    if (settings.lessons !== true) return CHUNK_HEAD + ' Lesson recording is turned off by the user: do not record lessons (no lesson_write, no memory.cjs lesson).'
    // Recording is on but nothing is injected (context off, or no lesson yet): the one door is still named, in one short line.
    const door = CHUNK_HEAD + ' ' + RECORD_LINE
    if (settings.context !== true) return door
    const plan = planLessons(sessionIdOf(context), { relevant: settings.relevant === true })
    if (plan.chosen.length === 0) return door
    const lines = [headLine(plan.kybers)]
    plan.full.forEach((l) => lines.push(lessonLine(l)))
    if (plan.index.length > 0) lines.push(INDEX_NOTE, ...plan.index.map((x) => x.line))
    if (plan.omitted > 0) lines.push(moreLine(plan.omitted))
    lines.push('', RECORD_LINE)
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
  description: 'Records a lesson learned in an AI agent team: ONE falsifiable sentence, only when an expectation was contradicted. Never fabricate one to fill a box.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      text: { type: 'string', description: 'The lesson, one sentence (cut at ' + String(LESSON_MAX_CHARS) + ' characters).' },
      kyber: { type: 'string', description: 'The AI agent team the lesson belongs to. Default: "default".' },
      tags: { type: 'array', items: { type: 'string' }, description: 'Up to 5 short lower-case tags.' },
      title: { type: 'string', description: 'Optional: a few words that name the lesson in the index (cut at ' + String(LESSON_TITLE_MAX) + ' characters).' },
      summary: { type: 'string', description: 'Optional: what the lesson says, in one line (cut at ' + String(LESSON_SUMMARY_MAX) + ' characters).' },
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
    if (lessonsCut()) return { ok: false, error: TEAM_SPACE_REFUSAL }
    if (readSettings().lessons !== true) return { ok: false, error: 'lecons_desactivees' }
    const made = addLesson(typeof args.kyber === 'string' && args.kyber !== '' ? args.kyber : DEFAULT_KYBER, { text: args.text, tags: args.tags, title: args.title, summary: args.summary, from: 'lesson_write' })
    if (made.ok !== true) return { ok: false, error: made.error, ...(made.kybers === undefined ? {} : { kybers: made.kybers.join(', ') }) }
    return { ok: true, id: made.lesson.id, duplicate: made.duplicate === true, evicted: made.evicted.length }
  },
})

const lessonSearchTool = () => ({
  name: 'lesson_search',
  description: 'Looks up lessons learned (every AI agent team, or one). Lessons it returns count as used, which keeps them from being evicted.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      q: { type: 'string', description: 'Words to look for.' },
      kyber: { type: 'string', description: 'Restrict to one AI agent team.' },
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
    if (lessonsCut()) return { ok: false, error: TEAM_SPACE_REFUSAL }
    if (readSettings().lessons !== true) return { ok: false, error: 'lecons_desactivees' }
    const hits = searchLessons(args.q, { kyber: args.kyber, limit: 8 })
    // Retrieving a lesson is the only use this module can see: it feeds the cap.
    hits.slice(0, 5).forEach((h) => { try { markUsed(h.id) } catch (e) { /* a counter is never worth failing the search */ } })
    return { ok: true, count: hits.length, found: hits.map((h) => '#' + h.id + ' (' + h.kyber + ') ' + h.text).join('\n') }
  },
})

// The index in the prompt shows a title and a summary per lesson; this tool gives the full text of the ones the model needs, by the
// ids the index printed (the lesson_forget form). Reading a lesson is a use, like a search hit: it feeds the cap.
export const LESSON_READ_MAX = 5
const lessonReadTool = () => ({
  name: 'lesson_read',
  description: 'Reads the full text of lessons learned, by the ids the lessons index shows (like "default:3f2a1c10b7d4"). Call it before relying on a lesson of the index. Up to ' + String(LESSON_READ_MAX) + ' ids per call.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ids: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: LESSON_READ_MAX, description: 'The lesson ids, as the index printed them (1 to ' + String(LESSON_READ_MAX) + ').' },
    },
    required: ['ids'],
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { ok: { type: 'boolean' }, count: { type: 'integer' }, found: { type: 'string' }, missing: { type: 'string' }, error: { type: 'string' } },
      required: ['ok'],
    },
    render: (args, value) => {
      if (value.ok !== true) return TEXT('Lessons not read: ' + String(value.error))
      const parts = []
      if (typeof value.found === 'string' && value.found !== '') parts.push(value.found)
      if (typeof value.missing === 'string' && value.missing !== '') parts.push('Unknown ids (no such lesson): ' + value.missing)
      return TEXT(parts.length === 0 ? 'No lesson.' : parts.join('\n\n'))
    },
  },
  async execute(args) {
    if (lessonsCut()) return { ok: false, error: TEAM_SPACE_REFUSAL }
    if (readSettings().lessons !== true) return { ok: false, error: 'lecons_desactivees' }
    const raw = Array.isArray(args.ids) ? args.ids : (typeof args.ids === 'string' ? [args.ids] : [])
    const ids = [...new Set(raw.filter((x) => typeof x === 'string').map((x) => x.trim().replace(/^#/, '')).filter((x) => x !== ''))]
    if (ids.length === 0) return { ok: false, error: 'ids_manquants' }
    if (ids.length > LESSON_READ_MAX) return { ok: false, error: 'trop_d_ids: ' + String(LESSON_READ_MAX) + ' at most' }
    const found = []
    const missing = []
    for (const id of ids) {
      const parsed = parseLessonId(id)
      const lesson = parsed === null ? undefined : readLessons(parsed.kyber).find((l) => lessonId(parsed.kyber, l) === id)
      if (lesson === undefined) { missing.push(id); continue }
      try { markUsed(id) } catch (e) { /* a counter is never worth failing the read */ }
      const heads = lessonHeads(lesson)
      found.push('#' + id + ' (' + parsed.kyber + ') ' + heads.title + '\n' + lesson.text + (lesson.tags.length > 0 ? '\ntags: ' + lesson.tags.map((t) => '#' + t).join(' ') : ''))
    }
    return { ok: true, count: found.length, found: found.join('\n\n'), missing: missing.join(', ') }
  },
})

const lessonOfId = (id) => {
  const parsed = parseLessonId(id)
  if (parsed === null) return null
  const found = readLessons(parsed.kyber).find((l) => lessonId(parsed.kyber, l) === id)
  return found === undefined ? null : found
}

// The agent can forget a lesson (UJ-177), but never silently: the engine asks the person first (`forgetGate`), and the lesson goes to the archive, like the cap's evictions.
const lessonForgetTool = () => ({
  name: 'lesson_forget',
  description: 'Forgets ONE lesson learned, by its id as the lessons index or lesson_search shows it (like "default:3f2a1c10b7d4"). Use it only when the person asked to forget it. The person is asked before it goes, and it is kept in an archive.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string', description: 'The lesson id, as lesson_search printed it after "#".' },
    },
    required: ['id'],
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { ok: { type: 'boolean' }, error: { type: 'string' } },
      required: ['ok'],
    },
    render: (args, value) => TEXT(value.ok === true ? 'Lesson forgotten.' : 'Lesson not forgotten: ' + String(value.error)),
  },
  async execute(args) {
    if (lessonsCut()) return { ok: false, error: TEAM_SPACE_REFUSAL }
    if (readSettings().lessons !== true) return { ok: false, error: 'lecons_desactivees' }
    const done = deleteLesson(typeof args.id === 'string' ? args.id : '', 'forgotten at the request of the person')
    return done.ok === true ? { ok: true } : { ok: false, error: done.error }
  },
})

/** A text in the two languages of the product: English first (the base), then French. */
const twice = (en, fr) => ({ en, fr })

/** The `tools/pre-execute` answer for a `lesson_forget` call: the card the person approves, with the lesson's own words. Anything else (or a lesson that does not exist: the tool says so) passes. */
const forgetGate = (exec) => {
  if (exec === null || typeof exec !== 'object' || exec.name !== 'lesson_forget' || lessonsCut()) return null
  const args = exec.arguments !== null && typeof exec.arguments === 'object' ? exec.arguments : {}
  const lesson = lessonOfId(args.id)
  if (lesson === null) return null
  const said = lesson.text.length > 200 ? lesson.text.slice(0, 197) + '…' : lesson.text
  const words = twice('Forget this lesson? “' + said + '” It is kept in the archive.', 'Oublier cette leçon ? « ' + said + ' » Elle reste dans l’archive.')
  return { kind: 'ask', reason: words.en, displayReason: words }
}

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

// Hosted instance: also accept the authorities declared to DSH with --trusted-host. The core bundle publishes the predicate
// (kybernos-plugin/trusted-authority.mjs); absent or failing, it answers false and the guard stays loopback-only.
const kbTrusted = (host) => { try { const f = globalThis[Symbol.for('kybernos.trustedAuthority')]; return typeof f === 'function' && f(host) === true } catch (e) { return false } }
// Host fence (scripts/test-route-hosts.mjs). DSH serves plugin routes BEFORE its own authentication, and a page that rebinds its own name to this machine
// (DNS rebinding) reaches them with its own name as Host, no cookie and, on a same-origin GET, no Origin (a browser sends none): a guard that looks at the
// Origin alone lets every read through. Every route of this bundle refuses a Host that is not this listener's (the port the socket is bound to, on
// 127.0.0.1 / localhost / [::1], or an authority declared with --trusted-host) before its own guard runs. A request with no socket (a test) is not judged.
const kbHostOK = (req) => {
  try {
    const host = req.headers !== null && req.headers !== undefined && typeof req.headers.host === 'string' ? req.headers.host : null
    const sock = req.socket !== null && req.socket !== undefined ? req.socket : null
    if (host === null || sock === null || typeof sock.localPort !== 'number') return true
    const port = ':' + sock.localPort
    return ['127.0.0.1' + port, 'localhost' + port, '[::1]' + port].indexOf(host) >= 0 || kbTrusted(host)
  } catch (e) { return false }
}
const kbFenced = (service) => {
  if (service === null || service === undefined || typeof service.register !== 'function') return service
  const fence = (route) => (route !== null && typeof route === 'object' && typeof route.handler === 'function'
    ? Object.assign({}, route, {
      handler: (req, res, ...rest) => {
        if (kbHostOK(req) !== true) {
          try { res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' }); res.end('{"ok":false,"error":"origin refused"}') } catch (e) { /* closed */ }
          return undefined
        }
        return route.handler(req, res, ...rest)
      },
    })
    : route)
  return new Proxy(service, { get: (target, key) => (key === 'register' ? (route) => target.register(fence(route)) : (typeof target[key] === 'function' ? target[key].bind(target) : target[key])) })
}

/** Same guard as the other local routes: never cross-origin. */
const sameOrigin = (req) => {
  try {
    const origin = req.headers && typeof req.headers.origin === 'string' ? req.headers.origin : ''
    if (origin === '') return true
    const u = new URL(origin)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const sock = req.socket !== null && req.socket !== undefined ? req.socket : null
    // A real connection: the origin is compared with what THIS listener really is (the socket's port), never with the client-supplied Host header
    // alone (a page that rebinds its own name sends the same authority as Host and as Origin). No socket = a synthetic caller (a test).
    if (sock === null || typeof sock.localPort !== 'number') return typeof req.headers.host === 'string' && u.host === req.headers.host
    const port = ':' + sock.localPort
    return (['127.0.0.1' + port, 'localhost' + port, '[::1]' + port].indexOf(u.host) >= 0 || kbTrusted(u.host))
  } catch (e) { return false }
}

const intParam = (raw, fallback, min, max) => {
  const n = parseInt(raw, 10)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

const queryOf = (req) => { try { return new URL(req.url, 'http://localhost').searchParams } catch (e) { return new URLSearchParams('') } }

const pickedFor = (session) => {
  const sid = String(session || '')
  if (sid === '') return null
  const pick = sessionPick.get(sid) || sessionPick.get(sid.replace(/^session-/, ''))
  return pick === undefined ? null : { count: pick.ids.length, turn: pick.turn }
}

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
  const team = lessonsCut()
  return {
    ok: true, ...listed,
    filters: { kyber: isKyberId(kyber) ? kyber : null, used: params.get('used') === '1', added: params.get('added') === null ? 'any' : params.get('added'), q: params.get('q') === null ? '' : params.get('q') },
    search: { mode: 'relevance', relevance: true },
    injection: { scope: 'the AI agent team of the session, plus default', cap: plan.cap, defaultSent: team ? 0 : plan.chosen.length, defaultOmitted: team ? 0 : plan.omitted, team },
    // the chat this page is open next to (`?session=`): how many lessons were picked for its latest message
    picked: pickedFor(params.get('session')),
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
  return updateLesson(input.id, { ...(input.text === undefined ? {} : { text: input.text }), ...(input.tags === undefined ? {} : { tags: input.tags }), ...(input.title === undefined ? {} : { title: input.title }), ...(input.summary === undefined ? {} : { summary: input.summary }) })
}


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
// The lessons' own defaults (the memories keep tidy.mjs's TIDY_DEFAULTS): a daily look, with the Study model, so the index in the
// prompt gets its titles and summaries without anyone opening a page. A setting the file holds wins (see tidyState).
export const LESSONS_TIDY_DEFAULTS = Object.freeze({ mode: 'auto', schedule: 'daily', brain: true })

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
    // what the file says wins; what it does not say is the LESSONS default (daily, with the Study model)
    settings: normalizeTidySettings({ ...LESSONS_TIDY_DEFAULTS, ...(raw.settings !== null && typeof raw.settings === 'object' ? raw.settings : {}) }),
    settingsSaved: raw.settings !== null && typeof raw.settings === 'object',
    last: raw.last !== null && typeof raw.last === 'object' && typeof raw.last.at === 'string' ? raw.last : null,
    judged: raw.judged !== null && typeof raw.judged === 'object' && !Array.isArray(raw.judged) ? raw.judged : {},
    compactRefused: raw.compactRefused !== null && typeof raw.compactRefused === 'object' && !Array.isArray(raw.compactRefused) ? raw.compactRefused : {},
  }
}
// The settings are written only once someone set them (the page, `tidySettings`): a default stays a default and can change with a release.
const writeTidy = (t) => writeTidyFile('tidy', { scan: t.scan, dismissed: t.dismissed.slice(-TIDY_DISMISSED_MAX), log: t.log.slice(0, TIDY_LOG_MAX), settings: t.settingsSaved === true ? t.settings : undefined, last: t.last, judged: t.judged, compactRefused: t.compactRefused })

// The Study model (Kybernos Settings → `brain`: a « route/id », `none`, or empty = Automatic, the model kybernos-sessions
// publishes) and the `llm` service that can talk to it.
const kybernosSettingsFile = () => {
  const own = process.env.KYBERNOS_SETTINGS_FILE
  return typeof own === 'string' && own.trim() !== '' ? own.trim() : join(dshHome(), 'kybernos', 'settings.json')
}
const studyChoice = () => readStudyChoice(() => readFileSync(kybernosSettingsFile(), 'utf8'))
const studyModel = () => studyChoice().model
/** What the page needs of the Study model: its name, whether it was picked for the person, whether they chose none, and whether a model service exists. */
const studyView = () => { const c = studyChoice(); return { model: c.model, auto: c.auto, none: c.none, llm: tidyLlm() !== undefined } }
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

/** How many lessons the fullest agent team holds (the cap is per agent team, not a total). */
const fullestTeam = (live) => {
  const counts = new Map()
  for (const { kyber } of live.values()) counts.set(kyber, (counts.get(kyber) || 0) + 1)
  return Math.max(0, ...counts.values())
}

/**
 * Is a look due because an agent team nears its cap (WP-10)? Not before the team holds LESSONS_NEAR_COUNT lessons; then once when
 * it has grown since the last run (`last.peak`, the size of the fullest team after that run) and otherwise once a day, so a team
 * that stays near the cap is not scanned every ten minutes. « Run automatically: Off » is respected: the person said never by
 * themselves. What the run may merge is still the mode's business (`pickAuto`).
 */
export const capDue = ({ schedule, peak, last, now, retryAt }) => {
  if (schedule === 'off' || TIDY_SCHEDULES.indexOf(schedule) < 0) return false
  if (typeof retryAt === 'number' && now < retryAt) return false
  if (!(peak >= LESSONS_NEAR_COUNT)) return false
  const lastAt = last === null || last === undefined ? NaN : Date.parse(last.at)
  if (!Number.isFinite(lastAt)) return true
  const seen = Number.isFinite(last.peak) ? last.peak : 0
  return peak > seen || now - lastAt >= 86400000
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
    brain: studyView(),
    unclear: t.scan === null || !Number.isFinite(t.scan.unclear) ? 0 : t.scan.unclear,
  }
}

/**
 * One run: look (local detection, and — when the user allowed it and a Study model is set — its judgement of the pairs
 * the word count cannot decide, the local pairs under the line first), then, in `auto` mode, merge by itself the local groups at
 * or above the line (the Study model's verdicts are suggestions only), each through applyGroups: archive first, one Undo per merge.
 */
const tidyRun = async (trigger, now = Date.now()) => {
  if (tidyFlags.running) return { ok: false, error: 'deja_en_cours' }
  tidyFlags.running = true
  try {
    const items = []
    for (const [id, { kyber, lesson }] of liveLessons()) items.push({ id, content: lesson.text, createdAt: lesson.ts, pinned: false, bucket: kyber })
    const t = tidyState()
    let local = findDuplicateGroups(items)
    const taken = new Set(local.flatMap((g) => g.items.map((i) => i.id)))
    let suggestions = []
    let unclear = 0
    const brain = { asked: 0, error: null, detail: null, model: '' }
    // In a team space the Study model is on the team's route: the person's lessons are looked at on this machine only.
    if (t.settings.brain === true && !lessonsCut()) {
      brain.model = studyModel()
      const llm = tidyLlm()
      const judged = await brainGroups({ items, taken, judged: t.judged, dismissed: t.dismissed, llm: brain.model === '' ? null : llm, model: brain.model, maxMerged: LESSON_MAX_CHARS, noun: 'lessons', review: local })
      suggestions = judged.groups
      // a verdict on a local pair under the line takes the place of that group (same id)
      const verdicts = new Set(suggestions.map((g) => g.id))
      local = local.filter((g) => !verdicts.has(g.id))
      unclear = judged.unclear
      brain.asked = judged.asked
      brain.error = brain.model === '' ? 'pas_de_modele_detude' : (llm === undefined ? 'llm_indisponible' : judged.error)
      t.judged = judged.judged
      brain.detail = brain.error === null ? null : (judged.detail === undefined ? null : judged.detail)
      if (brain.error !== null && brain.error !== 'pas_de_modele_detude' && brain.error !== 'llm_indisponible') console.error('[kybernos-memory] tidy-up: the Study model could not be asked (' + brain.error + (brain.detail === null ? '' : ': ' + brain.detail) + ')')
    } else {
      unclear = unclearPairs(items, { taken }).filter((p) => t.dismissed.indexOf(p.id) < 0).length
    }
    // The run may have waited for the Study model: what the person did meanwhile (a setting, « Keep both ») lives in the file, not in
    // `t`, which is a stale copy. Re-read, put only this run's findings on it, and decide from what the file says NOW.
    const fresh = tidyState()
    fresh.scan = { at: new Date(now).toISOString(), total: items.length, unclear, groups: [...local, ...suggestions] }
    fresh.judged = t.judged
    writeTidy(fresh)
    const auto = { groups: 0, removed: 0, runs: [], failed: 0, brain: 0 }
    const picked = pickAuto([...local, ...suggestions].filter((g) => fresh.dismissed.indexOf(g.id) < 0), fresh.settings)
    // the local merges are logged 'auto', the Study model's 'brain' (the page says who merged)
    for (const by of ['auto', 'brain']) {
      for (const chunk of removalChunks(picked.filter((g) => (g.by === 'brain') === (by === 'brain')), TIDY_MAX_REMOVALS)) {
        if (tidyState().settings.mode !== 'auto') break   // « ask » was chosen while this run was merging: stop
        const done = applyGroups(chunk.map(autoRequest), by, now)
        if (done.error !== undefined) { auto.failed += chunk.length; continue }
        for (const r of done.results) {
          if (r.ok === true) { auto.groups += 1; auto.removed += r.removed || 0; if (by === 'brain') auto.brain += 1; if (r.run) auto.runs.push(r.run) } else auto.failed += 1
        }
      }
    }
    // the Study model's second job: a title and a summary for the lessons that have none, a shorter text for the long ones
    const compact = brain.model !== '' && tidyLlm() !== undefined && t.settings.brain === true && !lessonsCut()
      ? await compactLessons({ llm: tidyLlm(), model: brain.model, mode: 'ask', now })   // titles and summaries only: the model never rewrites a lesson's text (2026-11-20)
      : { asked: 0, compacted: 0, titled: 0, refused: 0, unanswered: 0, why: {}, error: null, runs: [] }
    const after = tidyState()
    after.last = { at: new Date(now).toISOString(), trigger, total: items.length - auto.removed, peak: fullestTeam(liveLessons()), found: local.length + suggestions.length, autoGroups: auto.groups, autoRemoved: auto.removed, autoBrain: auto.brain, brainAsked: brain.asked, brainError: brain.error, compactAsked: compact.asked, compacted: compact.compacted, titled: compact.titled, compactRefused: compact.refused, compactUnanswered: compact.unanswered, compactWhy: compact.why, compactError: compact.error, ok: true }
    writeTidy(after)
    return { ...tidyView(), auto, brain, compact }
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
  t.settingsSaved = true
  writeTidy(t)
  return { ok: true, settings: t.settings, view: tidyView() }
}

/** One look at whether a scheduled run is due; a run that fails waits an hour. Never throws. */
export const tidyTick = async (now = Date.now()) => {
  try {
    if (readSettings().lessons !== true) return { ran: false, why: 'lecons_desactivees' }
    // The scheduled run may ask the Study model: in a team space that is the team's route, and the person's lessons would leave under its bill.
    if (lessonsCut()) return { ran: false, why: 'espace_equipe' }
    const t = tidyState()
    const live = liveLessons()
    const count = live.size
    const due = tidyDue({ schedule: t.settings.schedule, last: t.last, now, total: count > 0 ? count : null, bootDone: tidyFlags.bootDone, retryAt: tidyFlags.retryAt })
    if (t.settings.schedule === 'start') tidyFlags.bootDone = true
    // the week (or day, or launch) is not over, but an agent team is nearly full: look now, before the cap does the choosing
    const trigger = due ? 'schedule' : (capDue({ schedule: t.settings.schedule, peak: fullestTeam(live), last: t.last, now, retryAt: tidyFlags.retryAt }) ? 'cap' : null)
    if (trigger === null) return { ran: false, why: 'pas_echu' }
    const res = await tidyRun(trigger, now)
    if (res.ok !== true) { tidyFlags.retryAt = now + 3600000; return { ran: false, why: res.error } }
    return { ran: true, trigger, auto: res.auto }
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

const fieldsOf = (lesson) => ({ text: lesson.text, tags: lesson.tags, uses: lesson.uses, lastUsed: lesson.lastUsed, title: typeof lesson.title === 'string' ? lesson.title : null, summary: typeof lesson.summary === 'string' ? lesson.summary : null })

// -- Compaction: titles, summaries and shorter texts from the Study model (compact.mjs) ---------------------------------------
// Bounded per run (COMPACT_MAX_CALLS questions of COMPACT_BATCH lessons), the lessons without a title first, then the longest: a new
// lesson is never starved by long ones that already have a title.
// Each accepted rewrite is applied like a merge: the old fields go to the tidy archive FIRST (Undo puts them back), the lesson is
// retouched, the original wording is copied into `lessons.archive.jsonl` when the text changed, and the log gets one entry
// (`by: 'brain'`, `kind: 'compact'` when the text changed, 'title' otherwise). In `ask` mode nothing is rewritten without a click,
// so only titles and summaries are written there (they add, they change no word of the lesson). A refused rewrite is not asked again
// for COMPACT_REFUSED_DAYS while the text stays the same.
const COMPACT_REFUSED_DAYS = 7
const COMPACT_REFUSED_MAX = 500

/** The order the Study model is asked in: untitled first, then the longest, then by id (the same files give the same order). */
export const compactOrder = (a, b) => (Number(b.untitled === true) - Number(a.untitled === true)) || b.text.length - a.text.length || (a.id < b.id ? -1 : 1)

const compactLessons = async ({ llm, model, mode, now = Date.now() }) => {
  const out = { asked: 0, compacted: 0, titled: 0, refused: 0, unanswered: 0, why: {}, error: null, runs: [] }
  const t = tidyState()
  // A refusal is remembered COMPACT_REFUSED_DAYS; a lesson the model did not answer ({ at, days: 1 }) only until the next day.
  const fresh = (hash) => {
    const v = t.compactRefused[hash]
    const at = Date.parse(v !== null && typeof v === 'object' ? v.at : v)
    const days = v !== null && typeof v === 'object' && Number.isFinite(v.days) ? v.days : COMPACT_REFUSED_DAYS
    return Number.isFinite(at) && now - at < days * 86400000
  }
  const textOnly = mode !== 'auto'
  const candidates = []
  for (const [id, { kyber, lesson }] of liveLessons()) {
    const wants = textOnly ? !lessonHeads(lesson).own : needsCompaction(lesson)
    if (wants && !fresh(textHash(lesson.text))) candidates.push({ id, kyber, text: lesson.text, ts: lesson.ts, untitled: !lessonHeads(lesson).own })
  }
  candidates.sort(compactOrder)
  if (candidates.length === 0) return out
  const answer = await askCompactions({ llm, model, lessons: candidates.slice(0, COMPACT_BATCH * COMPACT_MAX_CALLS) })
  out.asked = answer.asked
  out.error = answer.error
  if (answer.error !== null) console.error('[kybernos-memory] tidy-up: the Study model could not compact lessons (' + answer.error + (answer.detail === null ? '' : ': ' + answer.detail) + ')')
  const stamp = new Date(now).toISOString()
  const log = []
  const refused = {}
  for (const { lesson: cand, result } of answer.results) {
    // A lesson the model did not answer (cut short, a slip) is asked again the next day; a refusal is remembered for a week.
    if (result.ok !== true && result.why === 'shape') { refused[textHash(cand.text)] = { at: stamp, days: 1 }; out.unanswered += 1; continue }
    if (result.ok !== true) { refused[textHash(cand.text)] = stamp; out.refused += 1; out.why[result.why] = (out.why[result.why] || 0) + 1; continue }
    // A sound title and summary over a text that failed its checks: they are taken, the text stays, and the lesson is not asked again for a while.
    if (typeof result.textRefused === 'string') { refused[textHash(cand.text)] = stamp; out.why['text-' + result.textRefused] = (out.why['text-' + result.textRefused] || 0) + 1 }
    if (typeof result.summaryRefused === 'string') out.why['summary-' + result.summaryRefused] = (out.why['summary-' + result.summaryRefused] || 0) + 1
    const live = liveLessons().get(cand.id)
    if (live === undefined || live.lesson.text !== cand.text) continue   // changed while the model was thinking: asked again next run
    const lesson = live.lesson
    const newText = textOnly ? lesson.text : result.text
    const textChanges = newText !== lesson.text
    if (!textChanges && lesson.title === result.title && lesson.summary === result.summary) continue
    const afterId = lessonId(cand.kyber, { ts: lesson.ts, text: newText })
    const runId = 'c' + Date.now().toString(36) + textHash(cand.id)
    // 1. the archive FIRST: Undo can always put the old fields back
    const arch = tidyArchive()
    arch.runs[runId] = { at: stamp, kyber: cand.kyber, removed: [], edited: [{ id: afterId, before: fieldsOf(lesson) }] }
    writeTidyArchive(arch)
    const done = retouchLesson(cand.id, { title: result.title, summary: result.summary, ...(textChanges ? { text: newText } : {}) })
    if (done.ok !== true) { const a2 = tidyArchive(); delete a2.runs[runId]; writeTidyArchive(a2); continue }
    if (textChanges) { try { archiveLessons(cand.kyber, [lesson], 'compacted') } catch (e) { /* the tidy archive holds it too */ } }
    if (textChanges) out.compacted += 1
    if (!lessonHeads(lesson).own) out.titled += 1
    out.runs.push(runId)
    log.push({ id: runId, at: stamp, by: 'brain', kind: textChanges ? 'compact' : 'title', groupId: null, kyber: cand.kyber, kept: afterId, removed: 0, edited: true, partial: false, undone: false })
  }
  const after = tidyState()
  after.log = [...log.reverse(), ...after.log]
  after.compactRefused = { ...after.compactRefused, ...refused }
  const keys = Object.keys(after.compactRefused)
  const atOf = (v) => Date.parse(v !== null && typeof v === 'object' ? v.at : v) || 0
  if (keys.length > COMPACT_REFUSED_MAX) for (const k of keys.sort((x, y) => atOf(after.compactRefused[x]) - atOf(after.compactRefused[y])).slice(0, keys.length - COMPACT_REFUSED_MAX)) delete after.compactRefused[k]
  writeTidy(after)
  return out
}

/** Why rewrites were refused, in plain words, for the line of memory_tidy. A text kept under a new title (`text-*`) is not a refusal: it is said apart. */
const REFUSAL_WORDS = { negation: 'a negation lost', number: 'a number lost or changed', title: 'no usable title', summary: 'no usable summary' }
const refusalWords = (why) => Object.keys(why !== null && typeof why === 'object' ? why : {}).filter((k) => !k.startsWith('text-') && !k.startsWith('summary-')).sort().map((k) => (REFUSAL_WORDS[k] || k) + ' ' + String(why[k])).join(', ')

// -- memory_tidy: the lessons and the account memories tidied now, for the model or an automation ------------------------------------
// Runs what "Clean up now" runs (trigger 'tool'), waits for it at most MEMORY_TIDY_WAIT_MS and answers in a few plain words.
// `dryRun` looks only: no write, no Study model. The account memories have their own tidy-up in kybernos-cloud, which holds the
// account token: that bundle publishes globalThis[Symbol.for('kybernos.memoriesTidy')], a function ({ dryRun }) that runs it now and
// answers { ok, before, after, merged, suggestions, error } and nothing else. It is started beside the lessons and waited for within the
// same deadline; without it (the bundle absent, no account) the line says "memories: not connected", which is not an error.
export const MEMORY_TIDY_WAIT_MS = 300000
export const MEMORIES_TIDY_SEAM = Symbol.for('kybernos.memoriesTidy')
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms) })
const errorWords = (list) => (list.length === 0 ? 'none' : list.join(', '))
const MEMORIES_NOT_CONNECTED = 'memories: not connected'
const MEMORIES_ERRORS = { deja_en_cours: 'another memories tidy-up is running', espace_equipe: 'not tidied in a team space', memoires_desactivees: 'switched off' }

/** Starts the account memories tidy-up through kybernos-cloud's seam: a promise of its answer, or null without the seam. Never throws. */
const startMemoriesTidy = (dryRun) => {
  let run = null
  try { run = globalThis[MEMORIES_TIDY_SEAM] } catch (e) { return null }
  if (typeof run !== 'function') return null
  const failed = (e) => ({ ok: false, error: String((e && e.message) || e).slice(0, 160) })
  try { return Promise.resolve(run({ dryRun: dryRun === true })).then((v) => (v !== null && typeof v === 'object' ? v : failed('no answer')), failed) } catch (e) { return Promise.resolve(failed(e)) }
}

/** Waits for the memories' answer until `deadline`: the answer, null without the seam, or { pending: true }. */
const settleMemories = async (memories, deadline) => {
  if (memories === null) return null
  let timer = null
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve({ pending: true }), Math.max(0, deadline - Date.now())) })
  const res = await Promise.race([memories, late])
  clearTimeout(timer)
  return res
}

const countWord = (n) => (Number.isFinite(n) ? String(n) : '?')
/** The memories' line of the summary. */
export const memoriesLine = (res, dryRun = false) => {
  if (res === null || res === undefined) return MEMORIES_NOT_CONNECTED
  if (res.pending === true) return 'memories: still running, the Memory page shows the result'
  if (res.ok !== true) return res.error === 'not_connected' ? MEMORIES_NOT_CONNECTED : 'memories: not tidied (' + (MEMORIES_ERRORS[res.error] || String(res.error || 'unknown error')) + ')'
  const study = typeof res.error === 'string' && res.error !== '' ? ' (Study model: ' + res.error + ')' : ''
  if (dryRun === true) return 'Memories: ' + countWord(res.before) + ' now, would merge ' + countWord(res.merged) + ' group(s) (' + countWord(res.after) + ' after), ' + countWord(res.suggestions) + ' left as suggestions'
  return 'Memories: ' + countWord(res.before) + ' before, ' + countWord(res.after) + ' after, ' + countWord(res.merged) + ' merged, ' + countWord(res.suggestions) + ' left as suggestions' + study
}

/** The lessons' part of memory_tidy: { ok, summary, error?, dryRun?, pending? } with the summary ending in a full stop. */
const lessonsTidy = async ({ dryRun, deadline, waitMs, pollMs }) => {
  if (lessonsCut()) return { ok: false, error: TEAM_SPACE_REFUSAL, summary: 'Lessons: not tidied in a team space.' }
  if (readSettings().lessons !== true) return { ok: false, error: 'lecons_desactivees', summary: 'Lessons: switched off.' }
  const before = liveLessons().size
  const t = tidyState()
  if (dryRun === true) {
    const items = janitorLessonItems()
    const groups = pickAuto(findDuplicateGroups(items).filter((g) => t.dismissed.indexOf(g.id) < 0), t.settings)
    const removals = groups.reduce((n, g) => n + g.items.length - 1, 0)
    let need = 0
    for (const { lesson } of liveLessons().values()) if (t.settings.mode === 'auto' ? needsCompaction(lesson) : !lessonHeads(lesson).own) need += 1
    const brainOn = t.settings.brain === true && studyModel() !== '' && tidyLlm() !== undefined
    return {
      ok: true, dryRun: true,
      summary: 'Dry run, nothing written. Lessons: ' + String(before) + '. Would merge ' + String(groups.length) + ' group(s) (' + String(removals) + ' lesson(s) fewer). '
        + String(need) + ' lesson(s) have no title or are over ' + String(COMPACT_TEXT_MAX) + ' characters' + (brainOn ? ' (the Study model would be asked about up to ' + String(COMPACT_BATCH * COMPACT_MAX_CALLS) + ')' : ' (the Study model is off or missing: nothing would be rewritten)') + '.',
    }
  }
  while (tidyFlags.running && Date.now() < deadline) await sleep(pollMs)
  if (tidyFlags.running) return { ok: false, error: 'deja_en_cours', summary: 'Another lessons tidy-up is still running; try again later.' }
  let timer = null
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(null), Math.max(0, deadline - Date.now())) })
  const res = await Promise.race([tidyRun('tool'), late])
  clearTimeout(timer)
  if (res === null) return { ok: true, pending: true, summary: 'The lessons tidy-up is still running after ' + String(Math.round(waitMs / 60000)) + ' minutes; it finishes by itself and the Memory page shows its result.' }
  if (res.ok !== true) return { ok: false, error: String(res.error), summary: 'The lessons tidy-up did not run: ' + String(res.error) + '.' }
  const errors = []
  if (res.auto.failed > 0) errors.push(String(res.auto.failed) + ' merge(s) failed')
  if (res.brain.error !== null) errors.push('Study model: ' + String(res.brain.error))
  if (res.compact.error !== null && res.compact.error !== res.brain.error) errors.push('compaction: ' + String(res.compact.error))
  if (res.compact.refused > 0) errors.push(String(res.compact.refused) + ' rewrite(s) refused (' + refusalWords(res.compact.why) + ')')
  if (res.compact.unanswered > 0) errors.push(String(res.compact.unanswered) + ' lesson(s) the Study model did not answer (asked again tomorrow)')
  const kept = Object.keys(res.compact.why).filter((k) => k.startsWith('text-')).reduce((n, k) => n + res.compact.why[k], 0)
  return {
    ok: true,
    summary: 'Lessons: ' + String(before) + ' before, ' + String(liveLessons().size) + ' after. Merged: ' + String(res.auto.groups) + ' group(s) (' + String(res.auto.removed) + ' lesson(s) removed' + (res.auto.brain > 0 ? ', ' + String(res.auto.brain) + ' by the Study model' : '') + '). '
      + 'Compacted: ' + String(res.compact.compacted) + '. Titles written: ' + String(res.compact.titled) + (kept > 0 ? ' (' + String(kept) + ' kept their own text: the shorter one lost a fact or was too long)' : '') + '. Errors: ' + errorWords(errors) + '.',
  }
}

export const memoryTidy = async ({ dryRun = false, waitMs = MEMORY_TIDY_WAIT_MS, pollMs = 500 } = {}) => {
  const deadline = Date.now() + Math.max(0, waitMs)
  // the memories run beside the lessons: neither waits for the other, both within the same deadline
  const memories = startMemoriesTidy(dryRun === true)
  const lessons = await lessonsTidy({ dryRun: dryRun === true, deadline, waitMs, pollMs })
  const mem = await settleMemories(memories, deadline)
  return { ...lessons, summary: lessons.summary + ' ' + memoriesLine(mem, dryRun === true) + '.' }
}

const memoryTidyTool = () => ({
  name: 'memory_tidy',
  description: 'Tidies the lessons learned and the account memories now: merges near-duplicates and, when the Study model is on, the pairs it judges the same, gives lessons a title and a summary and shortens the long ones (each change can be undone on the Memory page). Waits for the result (5 minutes at most) and returns a short summary. { "dryRun": true } only says what it would do.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: { dryRun: { type: 'boolean', description: 'Look only: write nothing and ask no model.' } },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { ok: { type: 'boolean' }, summary: { type: 'string' }, error: { type: 'string' }, dryRun: { type: 'boolean' }, pending: { type: 'boolean' } },
      required: ['ok'],
    },
    render: (args, value) => TEXT(typeof value.summary === 'string' ? value.summary : 'Tidy-up not run: ' + String(value.error)),
  },
  async execute(args) {
    return memoryTidy({ dryRun: args !== null && typeof args === 'object' && args.dryRun === true })
  },
})

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
/** A lesson in a few words, for the « Recently removed » list. */
const labelOf = (text) => { const t = String(text).replace(/\s+/g, ' ').trim(); return t.length > 60 ? t.slice(0, 57) + '…' : t }

/**
 * The person deletes a lesson: it goes to the tidy archive and log first (`by: 'you'`, `kind: 'delete'`), so « Recently removed » can
 * bring it back, exactly as it was, for 30 days with the same Undo as a tidy-up (2026-11-20). The store still archives it in lessons.archive.jsonl.
 */
const lessonsDeleteRoute = async (req, body) => {
  const id = body !== null && typeof body === 'object' ? body.id : undefined
  const found = typeof id === 'string' ? liveLessons().get(id) : undefined
  if (found === undefined) return deleteLesson(id)
  const runId = 'd' + Date.now().toString(36) + textHash(String(id))
  const archive = tidyArchive()
  archive.runs[runId] = { at: new Date().toISOString(), kyber: found.kyber, removed: [found.lesson], edited: [] }
  writeTidyArchive(archive)
  const del = deleteLesson(id)
  if (del.ok !== true) { const a2 = tidyArchive(); delete a2.runs[runId]; writeTidyArchive(a2); return del }
  const t = tidyState()
  t.log = [{ id: runId, at: new Date().toISOString(), by: 'you', kind: 'delete', groupId: null, kyber: found.kyber, kept: null, removed: 1, edited: false, partial: false, undone: false, label: labelOf(found.lesson.text) }, ...t.log]
  writeTidy(t)
  return { ...del, run: runId }
}

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
    if (gone.length > 0 || edited) log.push({ id: runId, at: new Date(now).toISOString(), by, groupId: step.group.id, kyber, kept: afterId, removed: gone.length, edited, partial: failure !== null, undone: false, label: labelOf(next.text) })
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

// ── The janitor seam: bounded, dirty-aware cleaning of the local lessons ─────────────────────────────────────────────
// kybernos-maintenance owns ONE host-level scheduler (janitor.mjs) and reaches this store through
// globalThis[Symbol.for('kybernos.janitor.lessons')], a frozen { version: 1, enabled(), revision(), scanAndClean() }.
// SAME CONTRACT IN kybernos-cloud (account memories). The janitor is the schedule/lock/backup/report layer; this
// file owns the rules of the lessons and reuses the paths that already exist (dedupe.mjs, pickAuto, applyGroups,
// the tidy archive + Undo, and lessons.archive.jsonl through deleteLesson).
//
//   · enabled(): the lessons switch (readSettings().lessons === true, exactly the rule of the scheduled tidy-up)
//     and NOT a team space (existing rule: personal lessons stay out of a team conversation). The `context`
//     switch is about injecting lessons into the prompt, not about recording them, so it does not close the store.
//   · revision(): a hash of every kyber's lessons (id + kyber + ts + text + tags + uses + lastUsed): SYNCHRONOUS,
//     read-only, no network. It changes exactly when a lesson the user sees changes.
//   · SCAN-ONLY (apply !== true) IS INSPECT-ONLY: no Study-model call, and NO write of any kind — not even the
//     tidy scan side file or an archive. A boot with the janitor mounted leaves the lessons files untouched.
//   · apply === true is the user's explicit approval. Then: a timestamped JSON backup is written to
//     options.backupPath BEFORE any change; pass 1 is the store's own rule (findDuplicateGroups + pickAuto: tidy
//     mode « auto », score >= 80, only within the same kyber); pass 2 (Study model) only when the tidy `brain`
//     setting is on and candidates exist, bounded to 20 candidates / 4 calls. Only a « same » verdict is merged;
//     « replaces » (a contradiction) is counted in `conflicts` and both lessons are KEPT. The keeper's falsifiable
//     wording is kept exactly as written; applyGroups adds the removed lessons' tags (5 at most), uses (summed)
//     and lastUsed (newest), so merging never makes it the first lesson the 50-lesson cap evicts. Every removal
//     goes through applyGroups, which writes the tidy archive first (Undo), and deleteLesson archives the row too.
//   · At most `maxRemovals` items are removed (merges + archives counted together); every number is returned.
//   · Nothing throws across the boundary: a failure returns { ok: false, error } with the files untouched.
const JANITOR_LESSONS_BOUNDS = Object.freeze({ maxInspected: 200, maxCandidates: 20, maxModelCalls: 4, maxRemovals: 20 })
const JANITOR_LESSONS_SEAM = Symbol.for('kybernos.janitor.lessons')

/** The janitor's bounds, never wider than the product defaults, whatever a caller asks. */
const janitorBounds = (bounds) => {
  const b = bounds !== null && typeof bounds === 'object' ? bounds : {}
  const num = (key, fallback) => (Number.isFinite(b[key]) && b[key] >= 0 ? Math.min(Math.floor(b[key]), fallback) : fallback)
  return {
    maxInspected: num('maxInspected', JANITOR_LESSONS_BOUNDS.maxInspected),
    maxCandidates: num('maxCandidates', JANITOR_LESSONS_BOUNDS.maxCandidates),
    maxModelCalls: num('maxModelCalls', JANITOR_LESSONS_BOUNDS.maxModelCalls),
    maxRemovals: num('maxRemovals', JANITOR_LESSONS_BOUNDS.maxRemovals),
  }
}

/** Every lesson of every kyber, as the dedupe module wants it (bucket = kyber: lessons only meet inside their own kyber). */
const janitorLessonItems = () => {
  const items = []
  for (const [id, { kyber, lesson }] of liveLessons()) items.push({ id, content: lesson.text, createdAt: lesson.ts, pinned: false, bucket: kyber })
  return items
}

/** A stable hash of those lessons: SYNCHRONOUS, read-only, no network. */
const janitorLessonsRevision = () => {
  try {
    const rows = []
    for (const [id, entry] of liveLessons()) {
      const lesson = entry.lesson
      rows.push([String(id), String(entry.kyber), String(lesson.ts === undefined ? '' : lesson.ts), String(lesson.text), Array.isArray(lesson.tags) ? lesson.tags.join(',') : '', Number(lesson.uses) || 0, typeof lesson.lastUsed === 'string' ? lesson.lastUsed : ''])
    }
    if (rows.length === 0) return null
    rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    return createHash('sha1').update(JSON.stringify(rows)).digest('hex')
  } catch (e) { return null }
}

/** enabled(): lessons are recorded, and this is not a team space. Never throws. */
const janitorLessonsEnabled = () => {
  try { return readSettings().lessons === true && !lessonsCut() } catch (e) { return false }
}

/** The backup file, written atomically, where the janitor asked for it. */
const writeJanitorBackup = (file, payload) => {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  const tmp = file + '.tmp-' + String(process.pid)
  try {
    writeFileSync(tmp, JSON.stringify({ at: new Date().toISOString(), ...payload }, null, 2) + '\n', { mode: 0o600 })
    renameSync(tmp, file)
  } catch (e) {
    try { rmSync(tmp, { force: true }) } catch (e2) { /* nothing to clean */ }
    throw e
  }
}

/** The Study model's judgement of at most `maxCandidates` pairs, bounded by `maxModelCalls`. Never in scan-only. */
const janitorJudgePairs = async (pairs, maxCalls) => {
  const model = { route: null, calls: 0 }
  const verdicts = []
  const route = studyModel()
  const llm = tidyLlm()
  if (route === '' || llm === undefined) return { model, verdicts }
  model.route = route
  for (let at = 0; at < pairs.length && model.calls < maxCalls; at += BRAIN_BATCH) {
    const batch = pairs.slice(at, at + BRAIN_BATCH)
    const res = await askModel(llm, route, brainPrompt(batch, 'lessons'), { timeoutMs: BRAIN_TIMEOUT_MS })
    if (res.error !== undefined) break
    model.calls += 1
    const parsed = parseVerdicts(res.text, batch.length, LESSON_MAX_CHARS)
    batch.forEach((pair, index) => verdicts.push({ pair, verdict: parsed[index] }))
  }
  return { model, verdicts }
}

/**
 * The janitor's cleaning pass over every kyber's lessons. Scan-only inspects and counts; apply writes a backup
 * first, then merges through applyGroups. Returns the numbers the janitor reports, or { ok: false, error }.
 */
const janitorLessonsScanAndClean = async (options = {}) => {
  try {
    const opts = options !== null && typeof options === 'object' ? options : {}
    const bounds = janitorBounds(opts.bounds)
    const apply = opts.apply === true
    const now = Date.now()
    if (readSettings().lessons !== true) return { ok: false, unavailable: true, error: 'lecons_desactivees' }
    if (lessonsCut()) return { ok: false, unavailable: true, error: 'espace_equipe' }
    const all = janitorLessonItems()
    const inspectedItems = all.slice(0, bounds.maxInspected)
    const before = { items: all.length, chars: all.reduce((n, it) => n + String(it.content).length, 0) }
    const t = tidyState()
    // Pass 1 — deterministic and local.
    const local = findDuplicateGroups(inspectedItems).filter((g) => t.dismissed.indexOf(g.id) < 0)
    const taken = new Set(local.flatMap((g) => g.items.map((i) => i.id)))
    // Candidates for pass 2 — collected in every mode, asked only when the user approved an applying run.
    const unclear = unclearPairs(inspectedItems, { taken, max: bounds.maxCandidates }).filter((p) => t.dismissed.indexOf(p.id) < 0)
    const model = { route: null, calls: 0 }
    // A pass-1 « clash » (one text says « not », or the numbers differ) is a contradiction dedupe.mjs has already
    // refused to call a duplicate: it is COUNTED and both rows are kept, and the model is never asked to override it.
    const conflictIds = new Set(unclear.filter((p) => p.why === 'negation' || p.why === 'number').map((p) => p.id))
    const judgeable = unclear.filter((p) => !conflictIds.has(p.id))
    const semantic = []
    if (apply === true && t.settings.brain === true && judgeable.length > 0) {
      const judged = await janitorJudgePairs(judgeable, bounds.maxModelCalls)
      model.route = judged.model.route
      model.calls = judged.model.calls
      for (const judgedPair of judged.verdicts) {
        const p = judgedPair.pair
        const v = judgedPair.verdict
        if (v.verdict === 'replaces') { conflictIds.add(p.id); continue }   // a contradiction: counted, both lessons kept
        if (v.verdict !== 'same') continue
        // lessons have no pinned flag: the newer one is the keeper (the model said both state the same thing)
        const keeper = (Date.parse(p.a.createdAt) || 0) <= (Date.parse(p.b.createdAt) || 0) ? p.b : p.a
        const other = keeper.id === p.a.id ? p.b : p.a
        semantic.push({
          id: p.id, keeperId: keeper.id, type: 'merge', by: 'brain', score: null, saves: 1,
          items: [
            { id: keeper.id, content: keeper.content, createdAt: keeper.createdAt, pinned: false, keep: true, like: p.like / 100 },
            { id: other.id, content: other.content, createdAt: other.createdAt, pinned: false, keep: false, like: p.like / 100 },
          ],
        })
      }
    }
    // What may be applied: the store's own « merge without asking » rule decides pass 1 (mode « auto »); pass 2
    // only adds the model's « same » verdicts, and the janitor's removals budget caps the whole run.
    const order = apply === true && t.settings.mode === 'auto' ? [...pickAuto(local, t.settings), ...semantic.slice(0, AUTO_MAX_BRAIN_MERGES)] : []
    const picked = []
    let removals = 0
    for (const group of order) {
      const r = Math.max(0, group.items.length - 1)
      if (r === 0) continue
      if ((picked.length + 1) + (removals + r) > bounds.maxRemovals) continue
      picked.push(group)
      removals += r
    }
    let merges = 0
    let archives = 0
    let backupPath = null
    const counts = () => ({ ok: false, before, after: before, inspected: inspectedItems.length, candidates: unclear.length, merges, archives, conflicts: conflictIds.size, model: { route: model.calls > 0 ? model.route : null, calls: model.calls }, backupPath })
    if (apply === true && picked.length > 0) {
      if (typeof opts.backupPath !== 'string' || opts.backupPath.trim() === '') return { ...counts(), error: 'backup_requis' }
      const kybers = {}
      for (const entry of liveLessons().values()) { if (kybers[entry.kyber] === undefined) kybers[entry.kyber] = []; kybers[entry.kyber].push(entry.lesson) }
      writeJanitorBackup(opts.backupPath, { kind: 'lessons', kybers })
      backupPath = opts.backupPath
      // The store's own scan record: applyGroups re-checks every group against the lessons it reads NOW.
      t.scan = { at: new Date(now).toISOString(), total: all.length, unclear: unclear.length, groups: [...local, ...semantic] }
      writeTidy(t)
      const done = applyGroups(picked.map((g) => ({ id: g.id, keep: g.keeperId })), 'janitor', now)
      if (done.error !== undefined) return { ...counts(), error: done.error }
      let partial = false
      for (const r of done.results) {
        if (r.ok === true) { merges += 1; archives += Number.isFinite(r.removed) ? r.removed : 0 }
        else partial = true
      }
      if (partial) return { ...counts(), error: 'merge_partiel' }
    }
    const remaining = janitorLessonItems()
    const after = { items: remaining.length, chars: remaining.reduce((n, it) => n + String(it.content).length, 0) }
    return {
      ok: true, before, after,
      inspected: inspectedItems.length, candidates: unclear.length,
      merges, archives, conflicts: conflictIds.size,
      model: { route: model.calls > 0 ? model.route : null, calls: model.calls },
      backupPath, changed: merges > 0, protectedViolations: [],
    }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
}

const janitorLessonsSeam = () => Object.freeze({
  version: 1,
  enabled: janitorLessonsEnabled,
  revision: janitorLessonsRevision,
  scanAndClean: janitorLessonsScanAndClean,
})

/** Publishes (or republishes) the seam. Last writer wins; a frozen global is not an error. */
const publishJanitorSeam = (target = globalThis) => {
  try { target[JANITOR_LESSONS_SEAM] = janitorLessonsSeam() } catch (e) { /* a frozen global: the janitor degrades to "no seam" */ }
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
// `session: true` is a route that WRITES: besides the same-origin rule it needs DSH's signed browser-session cookie (session-guard.mjs, the terminal's
// rule). Plugin routes are served before DSH's own login and an Origin header is forgeable by any local program, so before this a `curl -X POST` with
// no header at all deleted a lesson. Every caller is the Memory page (a browser): the agent's tools call the store in-process, not these routes.

// ── Claude memory import ──────────────────────────────────────────────────────

const claudeImportListRoute = async () => {
  const staging = readStaging()
  return { ok: true, ...staging, counts: statusCounts(staging.entries) }
}

const claudeImportScanRoute = async () => {
  const files = scanClaudeMemory()
  return { ok: true, total: files.length, files: files.slice(0, 20) }
}

const claudeImportApplyRoute = async (req, body) => {
  const existingLessons = readLessons(activeKybers()[0])
  const result = importClaudeMemories({ existingLessons, now: new Date().toISOString() })
  return { ok: true, ...result }
}

const claudeImportStatusRoute = async (req, body) => {
  if (!body || typeof body.id !== 'string' || typeof body.status !== 'string') {
    return { ok: false, error: 'id and status required' }
  }
  const staging = readStaging()
  const entry = staging.entries.find((e) => e.id === body.id)
  if (!entry) return { ok: false, error: 'entry not found' }
  const result = setEntryStatus(entry, body.status)
  if (!result.ok) return result
  entry.status = result.entry.status
  writeStaging(staging)
  return { ok: true, entry }
}

const claudeImportStatusBulkRoute = async (req, body) => {
  if (!body || !Array.isArray(body.ids) || typeof body.status !== 'string') {
    return { ok: false, error: 'ids array and status required' }
  }
  const staging = readStaging()
  let changed = 0
  for (const id of body.ids) {
    const entry = staging.entries.find((e) => e.id === id)
    if (!entry) continue
    const result = setEntryStatus(entry, body.status)
    if (result.ok) { entry.status = result.entry.status; changed++ }
  }
  writeStaging(staging)
  return { ok: true, changed }
}

export const ROUTES = [
  { path: '/kybernos-memory/lessons', method: 'GET', guarded: true, run: lessonsListRoute },
  { path: '/kybernos-memory/kybers', method: 'GET', guarded: true, run: lessonsKybersRoute },
  { path: '/kybernos-memory/lessons/add', method: 'POST', guarded: true, session: true, body: true, run: lessonsAddRoute },
  { path: '/kybernos-memory/lessons/update', method: 'POST', guarded: true, session: true, body: true, run: lessonsUpdateRoute },
  { path: '/kybernos-memory/lessons/delete', method: 'POST', guarded: true, session: true, body: true, run: lessonsDeleteRoute },
  { path: '/kybernos-memory/tidy', method: 'GET', guarded: true, run: tidyRoute },
  { path: '/kybernos-memory/tidy/scan', method: 'POST', guarded: true, session: true, run: tidyScanRoute },
  { path: '/kybernos-memory/tidy/apply', method: 'POST', guarded: true, session: true, body: true, cap: 65536, run: tidyApplyRoute },
  { path: '/kybernos-memory/tidy/dismiss', method: 'POST', guarded: true, session: true, body: true, cap: 16384, run: tidyDismissRoute },
  { path: '/kybernos-memory/tidy/undo', method: 'POST', guarded: true, session: true, body: true, cap: 4096, run: tidyUndoRoute },
  { path: '/kybernos-memory/tidy/settings', method: 'POST', guarded: true, session: true, body: true, cap: 4096, run: tidySettingsRoute },
  { path: '/kybernos-memory/settings', method: 'GET', guarded: true, run: settingsRoute },
  { path: '/kybernos-memory/settings/set', method: 'POST', guarded: true, session: true, body: true, run: settingsSetRoute },
  { path: '/kybernos-memory/claude-import', method: 'GET', guarded: true, run: claudeImportListRoute },
  { path: '/kybernos-memory/claude-import/scan', method: 'POST', guarded: true, session: true, run: claudeImportScanRoute },
  { path: '/kybernos-memory/claude-import/apply', method: 'POST', guarded: true, session: true, run: claudeImportApplyRoute },
  { path: '/kybernos-memory/claude-import/status', method: 'POST', guarded: true, session: true, body: true, run: claudeImportStatusRoute },
  { path: '/kybernos-memory/claude-import/status-bulk', method: 'POST', guarded: true, session: true, body: true, cap: 65536, run: claudeImportStatusBulkRoute },
]

const mountRoutes = (ctx, webServer) => {
  webServer = kbFenced(webServer)
  for (const route of ROUTES) {
    const handler = async (req, res) => {
      if (req.method !== route.method) return sendJson(res, 405, { ok: false, error: route.method + ' expected' })
      if (route.guarded === true && sameOrigin(req) === false) return sendJson(res, 403, { ok: false, error: 'origin refused' })
      if (route.session === true) {
        const refused = writeGuard(req)
        if (refused !== null) return sendJson(res, refused.status, { ok: false, error: refused.error })
      }
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

// ── Where the chunk lives: a per-agent `section`, not a durable `context` ─────
// `systemPrompt.context` is a DURABLE runtime-context snapshot: the engine writes it into the history as a
// user-role message and appends a new copy every time its text changes. Lessons change rarely, but the
// change is enough to leave several stale copies in a long chat — the duplication workstream A removes.
// `systemPrompt.section` is part of the system prompt: it is evaluated at every assembly and never retained
// in the history. Native plugins install one section per agent (dsh-file-reference-local `installPrompt`,
// dsh-tool-subagent `installScoped`):
//
//   const fiber = agent.ctx.inject(['systemPrompt'], (scope) => {
//     scope.systemPrompt.section({ name: CHUNK_NAME, order: CHUNK_ORDER, text: () => renderLessonsChunk({ agent }) })
//   })
//
// The text provider stays SYNCHRONOUS and never throws, and reads only the lessons files and the settings
// (no network, no timer): while nothing changes it is byte-identical between steps, so the prompt
// prefix stays cacheable (no timestamp, no per-step noise).
//
// FAIL SAFE: when the agent seam is not readable (no agent registry, no event bus to follow agent creation),
// the historical `systemPrompt.context` registration is kept — boot never breaks and lessons are never
// silently lost. `installed` also makes the first successful section registration win: the two paths are
// never both active, otherwise every agent would read the block twice.
const mountPrompt = (ctx) => {
  const fibers = new WeakMap()     // agent -> the fiber that owns its section
  let fallbackFiber = null
  let installed = 0
  const installFallback = () => {
    // Never both: once a section is installed for at least one agent, a later refusal leaves that agent
    // without the block rather than putting the same text in the global context for everybody.
    if (fallbackFiber !== null || installed > 0) return
    fallbackFiber = ctx.inject(['systemPrompt'], (scope) => {
      scope.systemPrompt.context({ name: CHUNK_NAME, order: CHUNK_ORDER, text: (context) => renderLessonsChunk(context) })
    })
  }
  const install = (agent) => {
    if (agent === null || typeof agent !== 'object' || fibers.has(agent)) return
    const agentCtx = agent.ctx
    if (agentCtx === null || typeof agentCtx !== 'object' || typeof agentCtx.inject !== 'function') { installFallback(); return }
    try {
      const fiber = agentCtx.inject(['systemPrompt'], (scope) => {
        scope.systemPrompt.section({ name: CHUNK_NAME, order: CHUNK_ORDER, text: () => { try { return renderLessonsChunk({ agent }) } catch (e) { return '' } } })
      })
      fibers.set(agent, fiber)
      installed += 1
    } catch (e) {
      // The seam answered but refused (an older engine without `section`): the context path is the last resort.
      if (installed === 0) installFallback()
      say('prompt section not installed for an agent: ' + String((e && e.message) || e))
    }
  }
  const dispose = (agent) => {
    const fiber = fibers.get(agent)
    if (fiber === undefined) return
    fibers.delete(agent)
    try {
      const task = typeof fiber.dispose === 'function' ? fiber.dispose() : undefined
      if (task !== undefined && typeof task.catch === 'function') task.catch(() => {})
    } catch (e) { /* the agent is going away anyway */ }
  }
  // `get` (and not `ctx.agents`): cordis refuses a direct property read of a service this apply() did not
  // declare through `inject`, and the access must stay optional — no agent registry means the fallback path.
  let agents = null
  try { agents = ctx.get('agents') } catch (e) { agents = null }
  if (agents === null || typeof agents !== 'object' || typeof agents.list !== 'function' || typeof ctx.on !== 'function') {
    installFallback()
    return
  }
  let live = null
  try { live = agents.list() } catch (e) { live = null }
  if (Array.isArray(live) !== true) { installFallback(); return }
  for (const agent of live) install(agent)
  // Every live agent refused the seam: the context path carries the block (nothing was installed, so no duplicate).
  if (installed === 0 && live.length > 0) installFallback()
  ctx.on('agent/created', ({ agent }) => { try { install(agent) } catch (e) { /* never break boot */ } })
  ctx.on('agent/disposed', ({ agent }) => { try { dispose(agent) } catch (e) { /* never break boot */ } })
  // The fibers live on the agents' own contexts, so a plugin unload does not dispose them: do it here.
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      let current = []
      try { current = agents.list() } catch (e) { current = [] }
      if (Array.isArray(current)) for (const agent of current) dispose(agent)
    }, 'kybernos-memory: prompt sections')
  }
}

const mountTools = (ctx) => {
  ctx.inject(['tools'], (scope) => {
    scope.tools.register(lessonWriteTool())
    scope.tools.register(lessonSearchTool())
    scope.tools.register(lessonForgetTool())
    scope.tools.register(lessonReadTool())
    scope.tools.register(memoryTidyTool())
  })
}

const mountForgetGate = (ctx) => {
  if (typeof ctx.on !== 'function') return
  ctx.on('tools/pre-execute', async (exec, next) => {
    try {
      const card = forgetGate(exec)
      if (card !== null) return card
    } catch (e) { /* never break a call */ }
    return next()
  })
}

// A shell reaches what the two tools do not: `memory.cjs lesson`, the lessons files, the account state, the loopback routes of the pages. In a team space a call that
// names one of them is refused (same hook and answer as kybernos-cloud's turn gate). It stops the habit and the plain curl, not a shell that hides what it touches.
const mountTeamGate = (ctx) => {
  if (typeof ctx.on !== 'function') return
  ctx.on('tools/pre-execute', async (exec, next) => {
    try {
      if (inTeamSpace() && touchesPersonalMemory(exec)) return { kind: 'deny', reason: TEAM_SPACE_REFUSAL }
    } catch (e) { /* never break a call */ }
    return next()
  })
}

export function apply(ctx) {
  try {
    if (ctx.get('webServer') !== undefined) mountRoutes(ctx, ctx.get('webServer'))
    else ctx.inject(['webServer'], (scope) => mountRoutes(ctx, scope.webServer))
  } catch (e) { say('routes not mounted: ' + String((e && e.message) || e)) }
  try { mountPrompt(ctx) } catch (e) { say('prompt chunk not mounted: ' + String((e && e.message) || e)) }
  try { mountTools(ctx) } catch (e) { say('tools not mounted: ' + String((e && e.message) || e)) }
  try { mountTeamGate(ctx) } catch (e) { say('team gate not mounted: ' + String((e && e.message) || e)) }
  try { mountForgetGate(ctx) } catch (e) { say('forget gate not mounted: ' + String((e && e.message) || e)) }
  // the human's message of each turn, to pick the lessons that match it (see « The lessons that matter to THIS question »)
  try {
    if (typeof ctx.on === 'function') ctx.on('agent/inbox/claimed', ({ agent, message, turn }) => { try { if (!lessonsCut()) noteUserTurn(agent.session.id, message, turn) } catch (e) { /* never break a turn */ } })
  } catch (e) { say('turn listener not mounted: ' + String((e && e.message) || e)) }
  hostCtx = ctx
  try { publishJanitorSeam() } catch (e) { say('janitor seam not published: ' + String((e && e.message) || e)) }
  try { mountTidySchedule(ctx) } catch (e) { say('scheduled tidy-up not mounted: ' + String((e && e.message) || e)) }
}

// Exported for the host suite (test-memory-host.mjs): nothing else is promised.
export { refusalWords, lessonWriteTool, lessonSearchTool, lessonForgetTool, lessonReadTool, memoryTidyTool, forgetGate, sanitize, CHUNK_NAME, CHUNK_ORDER, CHUNK_MAX_CHARS, tidyRun, tidySettings, studyModel, publishJanitorSeam, JANITOR_LESSONS_SEAM }
