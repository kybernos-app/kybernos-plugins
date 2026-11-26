// The sub-agents of a chat, for the Journal (journal-subagents.mjs).
//
// A sub-agent is a session of its own: its log starts with a header line `{"type":"session","parentSession":"<chat id>","origin":"subagent","delegationDepth":1,…}`.
// The chat's own log says "started subagent <name>" and nothing more, so the models, tokens and cost of a team of sub-agents were missing from the Journal:
// only the lead's own calls were counted. This finds the sessions that name the chat as their parent (and theirs, down a few levels) by reading the first
// frame of each log, so a scan costs one small read per session, not a full decompression.
//
//   findSubagentChildren(sessionsRoot, chatId, { since, exclude }) → [{ id, parent, depth, file, createdAt }]
//   subagentRun(rows) → one run, in the shape `deriveRuns` gives (members + totals), or null when there is no sub-agent
//
// Nothing is invented: a child whose log cannot be read is left out, a fact the log does not carry stays null.
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const VERSIONS = ['session.v4.jsonl.zstd', 'session.v3.jsonl.zstd', 'session.jsonl.zstd']
const HEAD_BYTES = 65536
const MAX_SCANNED = 600
const MAX_CHILDREN = 60
const MAX_DEPTH = 4

const str = (v) => (typeof v === 'string' && v.length > 0 ? v : null)
const num = (v) => (typeof v === 'number' && Number.isFinite(v) === true ? v : null)
/** A session id with or without the `session-` prefix the engine sometimes writes. */
export const bareId = (id) => (typeof id === 'string' && id.length > 0 ? id.replace(/^session-/, '') : null)

/** The header line of one session log, read from its FIRST zstd frame only. null when unreadable. */
export function headerOf(file) {
  try {
    const fd = openSync(file, 'r')
    let head = null
    try {
      const buf = Buffer.alloc(HEAD_BYTES)
      const got = readSync(fd, buf, 0, HEAD_BYTES, 0)
      head = buf.subarray(0, got)
    } finally { closeSync(fd) }
    let end = head.indexOf(MAGIC, 4)
    let frame = end > 0 ? head.subarray(0, end) : null
    if (frame === null) {
      // The first frame is longer than the head read (or the file is one frame): take the whole file, cut at the next frame.
      const whole = readFileSync(file)
      end = whole.indexOf(MAGIC, 4)
      frame = end > 0 ? whole.subarray(0, end) : whole
    }
    const text = zstdDecompressSync(frame).toString('utf8')
    const line = text.slice(0, text.indexOf('\n') < 0 ? text.length : text.indexOf('\n')).trim()
    const header = JSON.parse(line)
    return header !== null && typeof header === 'object' && header.type === 'session' ? header : null
  } catch (e) { return null }
}

/** The session logs under a sessions root: `[{ file, dir, mtimeMs }]`, newest first, only those touched since `since`. */
function candidates(sessionsRoot, since) {
  const out = []
  let workspaces = []
  try { workspaces = readdirSync(sessionsRoot, { withFileTypes: true }) } catch (e) { return out }
  for (const ws of workspaces) {
    if (ws.isDirectory() !== true) continue
    let dirs = []
    try { dirs = readdirSync(join(sessionsRoot, ws.name), { withFileTypes: true }) } catch (e) { continue }
    for (const d of dirs) {
      if (d.isDirectory() !== true) continue
      for (const v of VERSIONS) {
        const file = join(sessionsRoot, ws.name, d.name, v)
        if (existsSync(file) !== true) continue
        let mtimeMs = 0
        try { mtimeMs = statSync(file).mtimeMs } catch (e) { break }
        if (since === null || mtimeMs >= since) out.push({ file: file, dir: d.name, mtimeMs: mtimeMs })
        break
      }
    }
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return out
}

/**
 * The sub-agent sessions of one chat, nested ones included (a sub-agent can start its own).
 * @param {string} sessionsRoot the DSH `sessions` folder.
 * @param {string} chatId the chat's session id (with or without `session-`).
 * @param {{ since?: number|null, exclude?: Iterable<string> }} [opts] `since`: the chat's first event time, a child cannot have been written before it. `exclude`: ids already counted elsewhere (the members of a workflow run).
 * @returns {Array<{ id: string, parent: string, depth: number, file: string, createdAt: number|null }>} oldest first.
 */
export function findSubagentChildren(sessionsRoot, chatId, opts) {
  const o = opts !== null && opts !== undefined && typeof opts === 'object' ? opts : {}
  const root = bareId(chatId)
  if (root === null || typeof sessionsRoot !== 'string') return []
  const since = num(o.since) !== null ? o.since - 60000 : null
  const skip = new Set(Array.from(o.exclude !== undefined && o.exclude !== null ? o.exclude : [], (x) => bareId(x)))
  const byParent = new Map()
  const scanned = candidates(sessionsRoot, since).slice(0, MAX_SCANNED)
  for (const c of scanned) {
    const h = headerOf(c.file)
    if (h === null) continue
    const parent = bareId(str(h.parentSession))
    const id = bareId(str(h.id)) !== null ? bareId(str(h.id)) : bareId(c.dir)
    if (parent === null || id === null || id === root) continue
    if (byParent.has(parent) !== true) byParent.set(parent, [])
    byParent.get(parent).push({ id: id, parent: parent, file: c.file, createdAt: num(h.createdAt) })
  }
  const out = []
  let level = [root]
  for (let depth = 1; depth <= MAX_DEPTH && level.length > 0 && out.length < MAX_CHILDREN; depth += 1) {
    const next = []
    for (const p of level) {
      for (const child of byParent.get(p) || []) {
        if (out.length >= MAX_CHILDREN) break
        if (out.some((x) => x.id === child.id) === true) continue
        out.push({ id: child.id, parent: child.parent, depth: depth, file: child.file, createdAt: child.createdAt })
        next.push(child.id)
      }
    }
    level = next
  }
  return out.filter((c) => skip.has(c.id) !== true).sort((a, b) => (a.createdAt === null ? 0 : a.createdAt) - (b.createdAt === null ? 0 : b.createdAt))
}

/**
 * What the Journal needs of one child, from its events: who it was, when, whether it finished. The route fact (model, tokens, cost) is read by the caller
 * (the plugin owns that derivation) and handed in as `fact`.
 * @param {ReadonlyArray<{type?: string, time?: number, data?: any}>} events the child's events.
 * @returns {{ label: string|null, provider: string|null, model: string|null, startedAt: number|null, endedAt: number|null, finished: boolean }} nulls where the log says nothing.
 */
export function childStory(events) {
  const list = Array.isArray(events) === true ? events : []
  let label = null
  let provider = null
  let model = null
  let startedAt = null
  let endedAt = null
  let finished = false
  for (const ev of list) {
    if (ev === null || typeof ev !== 'object') continue
    const t = num(ev.time)
    if (t !== null) { if (startedAt === null) startedAt = t; endedAt = t }
    if (ev.type === 'subagent/descriptor' && ev.data !== null && typeof ev.data === 'object' && label === null) {
      label = str(ev.data.label)
      provider = str(ev.data.agentProvider)
      model = str(ev.data.agentModel)
    }
    if (ev.type === 'turn/end') finished = true
    else if (ev.type === 'turn/start') finished = false
  }
  return { label: label, provider: provider, model: model, startedAt: startedAt, endedAt: endedAt, finished: finished }
}

/**
 * One run for all the sub-agents of a chat, in the shape `deriveRuns` gives, so the crew view and the Journal count them the same way.
 * @param {ReadonlyArray<{ id: string, depth: number, story: ReturnType<typeof childStory>, fact: {provider?: string|null, model?: string|null, tokens?: number|null, usage?: object|null, costEur?: number|null, source?: string|null}|null }>} rows one per child.
 * @param {number} [now] the clock, in ms (a child silent for ten minutes without an end event is no longer running).
 * @returns {object|null} the run; null when there is no child.
 */
export function subagentRun(rows, now) {
  const list = Array.isArray(rows) === true ? rows : []
  const clock = num(now)
  if (list.length === 0) return null
  const members = []
  let tokens = null
  let costEur = null
  let completed = 0
  let startedAt = null
  let endedAt = null
  let running = false
  for (const r of list) {
    const s = r.story
    const fact = r.fact !== null && r.fact !== undefined && typeof r.fact === 'object' ? r.fact : null
    // The log's own model when the route fact cannot be read: the descriptor names the model the sub-agent was started on.
    const provider = fact !== null && str(fact.provider) !== null ? str(fact.provider) : s.provider
    const model = fact !== null && str(fact.model) !== null ? str(fact.model) : s.model
    const t = fact !== null ? num(fact.tokens) : null
    const c = fact !== null ? num(fact.costEur) : null
    if (t !== null) tokens = (tokens === null ? 0 : tokens) + t
    if (c !== null) costEur = (costEur === null ? 0 : costEur) + c
    if (s.finished === true) completed += 1
    // A child with no end event that has been silent for ten minutes is not « running »: its log simply stops (killed, or the machine slept).
    else if (clock === null || s.endedAt === null || clock - s.endedAt < 600000) running = true
    if (s.startedAt !== null && (startedAt === null || s.startedAt < startedAt)) startedAt = s.startedAt
    if (s.endedAt !== null && (endedAt === null || s.endedAt > endedAt)) endedAt = s.endedAt
    members.push({
      seq: null,
      label: s.label !== null ? s.label : null,
      phase: r.depth > 1 ? 'level ' + r.depth : null,
      childId: r.id,
      outcome: s.finished === true ? 'completed' : null,
      startedAt: s.startedAt,
      endedAt: s.finished === true ? s.endedAt : null,
      durationMs: s.finished === true && s.startedAt !== null && s.endedAt !== null ? s.endedAt - s.startedAt : null,
      declared: { provider: null, model: null, source: null },
      actual: {
        provider: provider,
        model: model,
        tokens: t,
        usage: fact !== null && fact.usage !== null && fact.usage !== undefined && typeof fact.usage === 'object' ? fact.usage : null,
        costEur: c,
        source: fact !== null ? str(fact.source) : 'subagent/descriptor',
      },
    })
  }
  return {
    runId: 'subagents',
    name: 'Sub-agents',
    declaredFrom: 'subagent-sessions',
    startedAt: startedAt,
    endedAt: running === true ? null : endedAt,
    stopReason: running === true ? null : 'completed',
    declaredPhases: [],
    observedPhases: [],
    members: members,
    totals: { members: members.length, completed: completed, failed: 0, cancelled: 0, durationMs: startedAt !== null && endedAt !== null && running !== true ? endedAt - startedAt : null, tokens: tokens, costEur: costEur },
    deviations: [],
  }
}
