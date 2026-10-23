// The skill scout: once a week, look through the public skills index for skills that fit what the person does, keep the few that pass a filter written in CODE,
// and leave them as a short list to look at. Nothing is installed, nothing is written to the skills folder: installing goes through the same confirmation as
// any skill of Discover. The model never decides what passes; it only tells the person the result.
//
// Where candidates come from (queries sent to the index): the goals the person ticked at first run (`kybernos/onboarding.json`), and the commonest words of the
// skills the person already has. What a candidate must pass, in this order, cheapest first (the reason of every refusal is counted and shown):
//   not_github · bad_name · installed · dismissed · already_found · few_installs      from the index entry alone
//   not_checked · audit_unreachable · unaudited · audit_warning                       the security audits of skills.sh: at least one, all of them « pass »
//   no_skill_file · too_big · unsafe_text · similar                                    the SKILL.md itself: size, secrets, instructions that look like an injection, a copy of a skill the person has
// A skill that asks the agent to send, delete, pay or run commands is not refused (many good skills do): it carries a `risky` flag and the card says so.
//
// Pure where it can be: `filterCandidates` and `runScout` take the network as `deps` ({ search, audit, preview }), so the tests need no network.
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { kyDir, likeness, SKILL_NAME_RE } from './learned.mjs'
import { isRisky } from './learned-score.mjs'

export const SCOUT_LIMITS = Object.freeze({
  queries: 8,         // what the index is asked in one scan
  minSkills: 6,       // fewer skills than this say nothing about a theme: only the goals are asked
  perQuery: 10,       // answers kept per question
  minInstalls: 1000,  // a skill nobody uses is not a pick
  audited: 24,        // audit lookups per scan (the best-installed first)
  previews: 12,       // SKILL.md files read per scan (GitHub allows 60 requests an hour without a key, and a preview is two)
  textMax: 24 * 1024, // a longer SKILL.md is refused
  keep: 5,            // new finds per scan
  listMax: 12,        // finds waiting at once (the oldest leave first)
  foundDays: 60,      // a find nobody looked at leaves after this
  dismissDays: 180,   // « not interested » is remembered this long
  gapHours: 12,       // the tool does not scan again before this (the page's « Scan now » may)
  runsKept: 12,
  duplicate: 0.6      // likeness to a skill the person has, from which a candidate is a copy
})

export const scoutPath = (dsh) => join(kyDir(dsh), 'skills-scout.json')

/** The goals the person ticked at first run (`kybernos/onboarding.json` › `goals`): plain ids only. */
export const goalsOf = (dsh) => {
  try {
    const goals = JSON.parse(readFileSync(join(kyDir(dsh), 'onboarding.json'), 'utf8')).goals
    return (Array.isArray(goals) ? goals : []).filter((g) => typeof g === 'string' && /^[a-z0-9][a-z0-9_-]{1,39}$/.test(g)).slice(0, 8)
  } catch (e) { return [] }
}

const plain = (v) => v !== null && typeof v === 'object' && Array.isArray(v) === false
const oneLine = (v, max) => String(typeof v === 'string' ? v : '').replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
const stamp = (ms) => new Date(ms).toISOString()
const DAY = 24 * 3600 * 1000
const validIso = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null

const emptyScout = () => ({ version: 1, found: [], dismissed: [], runs: [] })

const normFound = (f) => {
  if (!plain(f) || typeof f.source !== 'string' || SKILL_NAME_RE.test(String(f.name)) === false) return null
  return {
    id: oneLine(f.source, 120) + '/' + String(f.name), name: String(f.name), source: oneLine(f.source, 120), description: oneLine(f.description, 400),
    installs: Number.isFinite(f.installs) && f.installs >= 0 ? Math.round(f.installs) : 0,
    audits: (Array.isArray(f.audits) ? f.audits : []).filter(plain).slice(0, 8).map((a) => ({ provider: oneLine(a.provider, 60), status: oneLine(a.status, 20) })),
    why: (Array.isArray(f.why) ? f.why : []).map((w) => oneLine(w, 40)).filter((w) => w !== '').slice(0, 4),
    risky: f.risky === true, url: oneLine(f.url, 300), foundAt: validIso(f.foundAt) || stamp(0)
  }
}

/** The file as it is on disk, whatever it holds: always the same shape, never a throw. */
export const normalizeScout = (raw) => {
  const out = emptyScout()
  if (!plain(raw)) return out
  for (const f of Array.isArray(raw.found) ? raw.found.slice(0, 50) : []) { const n = normFound(f); if (n !== null) out.found.push(n) }
  for (const d of Array.isArray(raw.dismissed) ? raw.dismissed.slice(0, 500) : []) if (plain(d) && typeof d.id === 'string' && validIso(d.at) !== null) out.dismissed.push({ id: oneLine(d.id, 160), at: d.at })
  for (const r of Array.isArray(raw.runs) ? raw.runs.slice(-SCOUT_LIMITS.runsKept) : []) {
    if (!plain(r) || validIso(r.at) === null) continue
    const rejected = {}
    if (plain(r.rejected)) for (const k of Object.keys(r.rejected).slice(0, 20)) if (Number.isInteger(r.rejected[k]) && r.rejected[k] > 0) rejected[oneLine(k, 30)] = r.rejected[k]
    out.runs.push({ at: r.at, by: r.by === 'automation' ? 'automation' : 'you', queries: (Array.isArray(r.queries) ? r.queries : []).map((q) => oneLine(q, 40)).filter((q) => q !== '').slice(0, 8), seen: Number.isInteger(r.seen) ? r.seen : 0, kept: Number.isInteger(r.kept) ? r.kept : 0, rejected, error: typeof r.error === 'string' && r.error !== '' ? oneLine(r.error, 60) : null })
  }
  return out
}

export const readScout = (dsh) => { try { return normalizeScout(JSON.parse(readFileSync(scoutPath(dsh), 'utf8'))) } catch (e) { return emptyScout() } }

const writeScout = (dsh, state) => {
  const file = scoutPath(dsh)
  mkdirSync(join(file, '..'), { recursive: true })
  const temp = file + '.tmp-' + String(process.pid) + '-' + randomBytes(3).toString('hex')
  try { writeFileSync(temp, JSON.stringify(state, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 }); renameSync(temp, file) } catch (e) { try { unlinkSync(temp) } catch (e2) { /* nothing to clean */ } throw e }
}

// One writer at a time per home: a read, a change and a write never interleave with another call's.
const queues = new Map()
export const withScout = (dsh, fn) => {
  const run = (queues.get(dsh) || Promise.resolve()).then(() => { const state = readScout(dsh); const out = fn(state); writeScout(dsh, state); return out })
  queues.set(dsh, run.catch(() => null))
  return run
}

// ── what the person is interested in ──────────────────────────────────────────────────────────────────────────
const fold = (t) => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const STOPWORDS = (() => { try { return new Set(JSON.parse(readFileSync(new URL('./stopwords.json', import.meta.url), 'utf8')).words) } catch (e) { return new Set() } })()
// Words every skill description holds, and the names of the places the skills live in: not an interest. (Measured on a first real scan: « tool », « plugin » and « kybernos » brought in Azure skills for a shop.)
const SKILL_WORDS = new Set(['tool', 'tools', 'plugin', 'plugins', 'kybernos', 'agent', 'agents', 'claude', 'anthropic', 'assistant', 'model', 'models', 'project', 'projects', 'workflow', 'workflows', 'use', 'when', 'user', 'users', 'skill', 'skills', 'file', 'files', 'create', 'creating', 'write', 'writing', 'make', 'need', 'needs', 'want', 'wants', 'task', 'tasks', 'help', 'helps', 'work', 'working', 'request', 'requests', 'based', 'including'])
const contentWords = (text) => fold(text).split(/[^a-z0-9]+/).filter((w) => w.length > 3 && STOPWORDS.has(w) === false && SKILL_WORDS.has(w) === false)

/**
 * The questions put to the index: the goals the person ticked first, then the commonest words of the skills they already have. `[{ q, from }]`, at most `queries`.
 * @param goals     ids such as `tickets` or `case-law-watch`
 * @param installed `[{ name, description }]`
 */
export const interestsOf = ({ goals, installed }, limits = SCOUT_LIMITS) => {
  const out = []
  const seen = new Set()
  const add = (q, from) => { const t = oneLine(q, 40).toLowerCase(); if (t.length >= 3 && seen.has(t) === false && out.length < limits.queries) { seen.add(t); out.push({ q: t, from }) } }
  for (const g of Array.isArray(goals) ? goals : []) add(String(g).replace(/[-_]+/g, ' '), 'goal')
  // The words of the person's skills say something only when there are enough skills to tell a theme from filler: a word that three skills share is a theme,
  // one that more than two in five hold is the filler of every description (« description », « asks », « harness » on a real scan).
  const mine = Array.isArray(installed) ? installed : []
  const count = new Map()
  for (const s of mine) for (const w of new Set(contentWords(String(s.description || '')))) count.set(w, (count.get(w) || 0) + 1)
  const top = mine.length < limits.minSkills ? [] : [...count.entries()].filter((e) => e[1] >= 3 && e[1] <= mine.length * 0.4).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 3)
  for (const e of top) add(e[0], 'yours')
  return out
}

// ── what a SKILL.md must not hold ─────────────────────────────────────────────────────────────────────────────
const SECRET = /(?:\bsk-[A-Za-z0-9_-]{20,}|\bAKIA[0-9A-Z]{16}\b|\bghp_[A-Za-z0-9]{30,}|\bxox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/
const INJECTION = /(?:ignore (?:all |any )?(?:the )?(?:previous|prior|above|earlier) (?:instructions|rules)|disregard (?:the |all )?(?:system|previous|prior) (?:prompt|instructions)|\bexfiltrat|(?:send|post|upload|email)\b[^.\n]{0,40}\b(?:env(?:ironment)?(?: variables?)?|api[ _-]?keys?|credentials|secrets?|\.env|ssh keys?|tokens?)\b[^.\n]{0,40}\b(?:to|at)\s+https?:|\|\s*(?:sudo\s+)?(?:ba)?sh\b|base64\s+(?:-d|--decode)|\beval\s*\()/i

/** What the text holds that decides the case: `{ secrets, injection, risky }` (counts, and whether it asks to send, delete, pay or run commands). */
export const textFlags = (text) => {
  const t = String(text)
  const count = (re) => { const g = new RegExp(re.source, re.flags.indexOf('g') >= 0 ? re.flags : re.flags + 'g'); return (t.match(g) || []).length }
  return { secrets: count(SECRET), injection: count(INJECTION), risky: isRisky(t) }
}

const closestOf = (installed, text) => {
  let best = { name: null, likeness: 0 }
  for (const e of installed) {
    const l = likeness(text, String(e.description || '') + ' ' + String(e.name || ''))
    if (l > best.likeness) best = { name: e.name, likeness: l }
  }
  return best
}

/**
 * The filter. `candidates` are index entries (`{ id, name, source, installs, installable, url, via }`); `deps` is `{ audit(source, name), preview(source, name, textChars) }`.
 * @returns `{ kept, rejected, seen }`: `kept` is the ranked short list (new finds), `rejected` counts refusals by reason.
 */
export const filterCandidates = async ({ candidates, installed, state, deps, now = Date.now(), limits = SCOUT_LIMITS }) => {
  const rejected = {}
  const no = (why) => { rejected[why] = (rejected[why] || 0) + 1 }
  const have = new Set(installed.map((s) => String(s.name).toLowerCase()))
  const dismissed = new Set(state.dismissed.filter((d) => now - Date.parse(d.at) < limits.dismissDays * DAY).map((d) => d.id))
  const known = new Set(state.found.map((f) => f.id))
  const first = []
  for (const c of candidates) {
    if (c.installable !== true) { no('not_github'); continue }
    if (SKILL_NAME_RE.test(c.name) === false) { no('bad_name'); continue }
    if (have.has(c.name.toLowerCase())) { no('installed'); continue }
    if (dismissed.has(c.id)) { no('dismissed'); continue }
    if (known.has(c.id)) { no('already_found'); continue }
    if (c.installs < limits.minInstalls) { no('few_installs'); continue }
    // What answers a goal the person ticked is enough; what only matches the words of their own skills must match two of them (one word alone brought in noise).
    if (c.goal !== true && c.via.length < 2) { no('weak_match'); continue }
    first.push(c)
  }
  // The audit budget is shared out between the questions, in their order (the goals first): the most installed skill of each question, then the second of each…
  // (sorted by installs alone, the generic skills of one broad word used up every look and the goals' own skills were never checked).
  const groups = new Map()
  for (const c of first) { const k = c.via[0]; if (groups.has(k) === false) groups.set(k, []); groups.get(k).push(c) }
  for (const g of groups.values()) g.sort((a, b) => b.installs - a.installs)
  const ordered = []
  for (let round = 0; ordered.length < first.length; round += 1) {
    let took = false
    for (const g of groups.values()) if (round < g.length) { ordered.push(g[round]); took = true }
    if (took === false) break
  }
  const audited = []
  let lookups = 0
  for (const c of ordered) {
    if (lookups >= limits.audited) { no('not_checked'); continue }
    lookups += 1
    let a = null
    try { a = await deps.audit(c.source, c.name) } catch (e) { a = null }
    if (a === null || a.ok !== true) { no('audit_unreachable'); continue }
    if (a.audits.length === 0) { no('unaudited'); continue }
    if (a.audits.some((x) => x.status !== 'pass')) { no('audit_warning'); continue }
    audited.push({ ...c, audits: a.audits.map((x) => ({ provider: x.provider, status: x.status })) })
  }
  const kept = []
  let reads = 0
  for (const c of audited) {
    if (reads >= limits.previews) { no('not_checked'); continue }
    reads += 1
    let p = null
    try { p = await deps.preview(c.source, c.name, limits.textMax) } catch (e) { p = null }
    if (p === null || p.ok !== true || p.found !== true) { no('no_skill_file'); continue }
    if (p.size > limits.textMax) { no('too_big'); continue }
    const flags = textFlags(p.text)
    if (flags.secrets > 0 || flags.injection > 0) { no('unsafe_text'); continue }
    const description = oneLine(p.description, 400)
    if (closestOf(installed, description + ' ' + c.name).likeness >= limits.duplicate) { no('similar'); continue }
    kept.push({ id: c.id, name: c.name, source: c.source, description, installs: c.installs, audits: c.audits, why: [...new Set(c.via)].slice(0, 3), risky: flags.risky, url: c.url, fit: c.via.length, goal: c.goal === true })
  }
  // What answers a goal the person ticked comes before what only matches the words of their skills.
  kept.sort((a, b) => (b.goal === true ? 1 : 0) - (a.goal === true ? 1 : 0) || b.fit - a.fit || b.installs - a.installs)
  return { kept: kept.slice(0, limits.keep), rejected, seen: candidates.length }
}

// ── one scan ──────────────────────────────────────────────────────────────────────────────────────────────────
const running = new Map()
const lastRun = (state) => (state.runs.length === 0 ? null : state.runs[state.runs.length - 1])

/** Is a scan under way for this home? (the page shows « Scanning… » and asks again). */
export const scanning = (dsh) => running.has(dsh)

/**
 * Runs one scan and records it. `deps`: `{ search(q, limit), audit, preview }`. A second call while one runs gets the same promise. Unless `force`, a scan that ran in the
 * last `gapHours` is not repeated: the answer is `{ ok: true, state: 'recent' }`.
 */
export const runScout = ({ dsh, deps, installed, goals, by = 'you', force = false, now = Date.now(), limits = SCOUT_LIMITS }) => {
  if (running.has(dsh)) return running.get(dsh)
  const job = (async () => {
    const before = readScout(dsh)
    const prev = lastRun(before)
    if (force !== true && prev !== null && now - Date.parse(prev.at) < limits.gapHours * 3600 * 1000) return { ok: true, state: 'recent', at: prev.at }
    const interests = interestsOf({ goals, installed }, limits)
    if (interests.length === 0) return { ok: false, error: 'no_interests' }
    const byId = new Map()
    let failed = 0
    for (const it of interests) {
      let res = null
      try { res = await deps.search(it.q, limits.perQuery) } catch (e) { res = null }
      if (res === null || res.ok !== true) { failed += 1; continue }
      for (const s of res.skills) {
        const c = byId.get(s.id)
        if (c === undefined) byId.set(s.id, { ...s, via: [it.q], goal: it.from === 'goal' })
        else { if (c.via.indexOf(it.q) < 0) c.via.push(it.q); if (it.from === 'goal') c.goal = true }
      }
    }
    if (failed === interests.length) {
      await withScout(dsh, (s) => { s.runs.push({ at: stamp(now), by, queries: interests.map((i) => i.q), seen: 0, kept: 0, rejected: {}, error: 'index_unreachable' }); s.runs = s.runs.slice(-limits.runsKept) })
      return { ok: false, error: 'index_unreachable' }
    }
    const result = await filterCandidates({ candidates: [...byId.values()], installed, state: before, deps, now, limits })
    return withScout(dsh, (s) => {
      const fresh = result.kept.map((k) => ({ ...k, foundAt: stamp(now) }))
      for (const f of fresh) { delete f.fit; delete f.goal; if (s.found.some((x) => x.id === f.id) === false) s.found.push(f) }
      s.found = s.found.filter((f) => now - Date.parse(f.foundAt) < limits.foundDays * DAY).slice(-limits.listMax)
      s.runs.push({ at: stamp(now), by, queries: interests.map((i) => i.q), seen: result.seen, kept: result.kept.length, rejected: result.rejected, error: null })
      s.runs = s.runs.slice(-limits.runsKept)
      return { ok: true, state: 'done', found: fresh, kept: result.kept.length, seen: result.seen, rejected: result.rejected, queries: interests.map((i) => i.q) }
    })
  })()
  running.set(dsh, job)
  const clear = () => { if (running.get(dsh) === job) running.delete(dsh) }
  job.then(clear, clear)
  return job
}

/** What the page shows: the finds still worth a look (not installed since), the last scans, whether one is under way. */
export const viewScout = ({ dsh, installed }) => {
  const state = readScout(dsh)
  const have = new Set(installed.map((s) => String(s.name).toLowerCase()))
  return { ok: true, found: state.found.filter((f) => have.has(f.name.toLowerCase()) === false), runs: state.runs.slice(-6).reverse(), scanning: scanning(dsh) }
}

/** « Not interested »: the find leaves and is not offered again for `dismissDays`. */
export const dismissFound = ({ dsh, id, now = Date.now() }) => {
  if (typeof id !== 'string' || id === '') return Promise.resolve({ ok: false, error: 'bad_id' })
  return withScout(dsh, (s) => {
    const i = s.found.findIndex((f) => f.id === id)
    if (i < 0) return { ok: false, error: 'not_found' }
    s.found.splice(i, 1)
    s.dismissed = s.dismissed.filter((d) => d.id !== id && now - Date.parse(d.at) < SCOUT_LIMITS.dismissDays * DAY).concat([{ id, at: stamp(now) }]).slice(-500)
    return { ok: true }
  })
}
