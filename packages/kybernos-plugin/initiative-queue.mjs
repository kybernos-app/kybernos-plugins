// The initiative queue: intent with evidence, waiting for the person's decision on the Automations page.
//
// Kaby notices the same need, chore or correction coming back with a measured proof and records it here ONCE, instead of
// repeating it in every answer. An entry never creates, schedules or switches anything on: its next action is always a
// draft, and resolving it only writes the answer the person gave (`asked`, `added`, `dropped`). A resolved entry is kept,
// so a decision can still be shown or counted; it is the pending state that stays bounded.
//
// One ledger file of the DSH home (kybernos/initiatives.json next to suggestions.json), written atomically with mode 0600,
// one writer at a time: same pattern as the suggestions ledger. The serial chain is per process, as the rest of the home
// already assumes. No route, no network, no model, no automation module: this file knows only its own ledger.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
import { hasPersonalData } from './suggestions.mjs'

/** Pending entries at once (mirrors SUGGESTED_MAX of the automation proposals). */
export const INITIATIVE_MAX = 8
/** Resolved entries kept, so a decision can still be shown; the oldest ones leave first. */
export const KEPT_MAX = 24
/** The longest text of an entry, in characters (an emoji counts as one). */
export const LIMITS = Object.freeze({ title: 120, span: 40, where: 80, summary: 240 })
export const RISKS = Object.freeze(['low', 'medium', 'high'])
export const REVERSIBILITY = Object.freeze(['trivial', 'easy', 'hard'])
/** The four states of an entry: `proposed` is the creation state, the three others are answers. */
export const STATUSES = Object.freeze(['proposed', 'asked', 'added', 'dropped'])
/** The only answers `resolve` accepts: `proposed` is a creation state, never an answer. */
export const RESOLVE_STATUSES = Object.freeze(['asked', 'added', 'dropped'])

/** The same clipping discipline as the suggestions door: control characters stripped, one character at a time. */
const clip = (v, max) => (typeof v === 'string' ? Array.from(v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim()).slice(0, max).join('') : '')
/** The length in characters, never in UTF-16 units: an emoji counts as one. */
const chars = (v) => Array.from(v).length
const plain = (v) => v !== null && typeof v === 'object' && Array.isArray(v) === false
/** The dedup key of a title: accents dropped, lower case, punctuation and spacing collapsed to one space. */
const normalise = (v) => String(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const waiting = (i) => i.status === 'proposed' || i.status === 'asked'

/**
 * The door: `{ ok: true, entry }` (normalised, nested, without id/status/at) or `{ ok: false, error }`.
 * The input is flat, exactly what a tool call gives; the file holds the nested frozen shape. Pure, no I/O.
 */
export const checkInitiative = (raw) => {
  const r = plain(raw) ? raw : {}
  const title = clip(r.title, LIMITS.title + 1)
  if (title === '') return { ok: false, error: 'empty title' }
  if (chars(title) > LIMITS.title) return { ok: false, error: 'too long' }
  const n = Number.isFinite(r.n) ? Math.round(r.n) : null
  const span = clip(r.span, LIMITS.span)
  const where = clip(r.where, LIMITS.where)
  if (n === null || n < 1 || n > 100000 || where === '') return { ok: false, error: 'no evidence' }
  if (RISKS.indexOf(r.risk) < 0) return { ok: false, error: 'unknown risk' }
  if (REVERSIBILITY.indexOf(r.reversibility) < 0) return { ok: false, error: 'unknown reversibility' }
  const action = plain(r.nextAction) ? r.nextAction : {}
  const kind = action.kind === undefined || action.kind === null || action.kind === '' ? 'draft' : action.kind
  if (kind !== 'draft') return { ok: false, error: 'next action must be a draft' }
  const summary = clip(action.summary, LIMITS.summary + 1)
  if (summary === '') return { ok: false, error: 'empty next action' }
  if (chars(summary) > LIMITS.summary) return { ok: false, error: 'too long' }
  // Last, so the agent gets the actionable shape error first, and the refusal keeps the sentence it already knows.
  if ([title, span, where, summary].some(hasPersonalData)) return { ok: false, error: 'personal data' }
  return { ok: true, entry: { title, evidence: { n, span, where }, risk: r.risk, reversibility: r.reversibility, nextAction: { kind: 'draft', summary } } }
}

/** An entry read back from disk: a damaged line never reaches a route. */
const valid = (i) => plain(i) && typeof i.id === 'string' && i.id !== '' && typeof i.title === 'string' && STATUSES.indexOf(i.status) >= 0 &&
  plain(i.evidence) && typeof i.evidence.n === 'number' && plain(i.nextAction) && i.nextAction.kind === 'draft'

/** The ledger of one DSH home. `file` is the whole path; `now` and `newId` are injected for the tests. */
export const makeInitiativeQueue = ({ file, now = () => new Date().toISOString(), newId = () => 'i_' + randomBytes(5).toString('hex') }) => {
  let chain = Promise.resolve()
  const read = () => {
    try { const j = JSON.parse(readFileSync(file, 'utf8')); return Array.isArray(j.items) ? j.items.filter(valid) : [] } catch (e) { return [] }
  }
  const write = (items) => {
    mkdirSync(dirname(file), { recursive: true })
    const tmp = file + '.tmp-' + process.pid
    writeFileSync(tmp, JSON.stringify({ version: 1, items }, null, 2), { mode: 0o600 })
    renameSync(tmp, file)
  }
  const serial = (fn) => { const run = chain.then(fn, fn); chain = run.then(() => null, () => null); return run }
  /** Only resolved entries are evicted, and the oldest of them first: a pending decision is never thrown away. */
  const keep = (items) => {
    const done = items.filter((i) => waiting(i) === false)
    if (done.length <= KEPT_MAX) return items
    const leaving = done.slice(0, done.length - KEPT_MAX)
    return items.filter((i) => leaving.indexOf(i) < 0)
  }
  return {
    cap: INITIATIVE_MAX,
    list: (status) => {
      const items = read()
      if (status === undefined || status === null || status === 'pending') return items.filter(waiting).map((i) => Object.assign({}, i))
      if (STATUSES.indexOf(status) < 0) return []
      return items.filter((i) => i.status === status).map((i) => Object.assign({}, i))
    },
    add: (raw) => serial(async () => {
      const checked = checkInitiative(raw)
      if (checked.ok !== true) return checked
      const entry = checked.entry
      const items = read()
      const key = normalise(entry.title)
      const same = items.filter((i) => normalise(i.title) === key)
      if (same.some(waiting)) return { ok: false, error: 'already queued' }
      if (same.some((i) => i.status === 'added')) return { ok: false, error: 'already added' }
      const dropped = same.filter((i) => i.status === 'dropped')
      if (dropped.length > 0 && entry.evidence.n <= Math.max(...dropped.map((i) => i.evidence.n))) return { ok: false, error: 'needs new evidence' }
      if (items.filter(waiting).length >= INITIATIVE_MAX) return { ok: false, error: 'too many initiatives' }
      const item = Object.assign({ id: newId() }, entry, { status: 'proposed', at: now() })
      items.push(item)
      write(keep(items))
      return { ok: true, item }
    }),
    resolve: (id, status = 'dropped') => serial(async () => {
      // The status is checked before the id, so the same call always answers the same refusal first.
      if (RESOLVE_STATUSES.indexOf(status) < 0) return { ok: false, error: 'unknown status' }
      const items = read()
      const hit = items.find((i) => i.id === id)
      if (hit === undefined) return { ok: false, error: 'not found' }
      write(items.map((i) => (i.id === id ? Object.assign({}, i, { status }) : i)))
      return { ok: true, item: Object.assign({}, hit, { status }) }
    }),
  }
}
