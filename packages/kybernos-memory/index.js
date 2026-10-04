// ═════════════════════════════════════════════════════════════════════════════
// kybernos-memory — lessons learned: read, write, inject, switch on and off.
//
// Host half. What it does, and what it does not:
//   · the lessons live in `<kybers>/<kyber>/memory/lessons.jsonl` (see
//     lessons-store.mjs — same rules as `~/.dsh/kybers/memory.cjs`);
//   · it injects the lessons of the kyber a session runs (plus `default`) into the
//     system prompt, in a small bounded chunk — never the lessons of every kyber;
//   · it gives the agent two tools, `lesson_write` and `lesson_search`;
//   · it serves the routes of the "Memory & Lessons learned" page;
//   · two switches, `lessons` and `context`, persisted in `kybernos-memory.json`.
// The account memory (cloud) stays in `@local/kybernos-cloud`: it needs the account
// token, lessons do not — they keep working offline and without an account.
//
// A bundle must never stop DSH from starting: every mount below is guarded.
// No import from `@deepseek-ai/*` (a plugin linked as `@local/…` cannot resolve them);
// the route helpers are small copies of the ones in kybernos-cloud, since bundles
// cannot share code.
// ═════════════════════════════════════════════════════════════════════════════

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { LESSON_MAX_CHARS, activeKyber, addLesson, deleteLesson, isKyberId, listKybers, listLessons, markUsed, readLessons, searchLessons, updateLesson } from './lessons-store.mjs'

export const name = 'kybernos-memory'

const say = (message) => console.log('[kybernos-memory] ' + message)

// ── Switches ────────────────────────────────────────────────────────────────
// `lessons`: agents may save and look up lessons. `context`: lessons are injected into
// the system prompt. Both true by default — that is how things behaved before the
// switches existed, so nothing changes for whoever never touches them.
const SETTING_KEYS = ['lessons', 'context']

const settingsFile = () => {
  const own = process.env.KYBERNOS_MEMORY_SETTINGS
  return typeof own === 'string' && own.trim() !== '' ? own.trim() : join(homedir(), '.dsh', 'kybernos-memory.json')
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
    search: { mode: 'exact', relevance: false },
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
}

// Exported for the host suite (test-memory-host.mjs): nothing else is promised.
export { lessonWriteTool, lessonSearchTool, sanitize, CHUNK_NAME, CHUNK_ORDER, CHUNK_MAX_CHARS }
