// Skills learned from experience: the proposals Kaby makes, what the person accepted, and the journal of both.
//
// The loop is observe, propose, validate, use, and nothing is active before the person validates. A proposal therefore lives in a
// ledger (<DSH home>/kybernos/skills-learned.json), not in the skills folder: it is not a skill yet, so the DSH registry, the count of
// active skills, Duplicate, Delete and the Team pack cannot reach it. Accept copies it to <DSH home>/skills/<name>/SKILL.md (never over
// an existing folder) and keeps the first version in <DSH home>/kybernos/skills-learned-versions/<name>/1.md.
//
// Every step is written to an append-only journal (<DSH home>/kybernos/skills-learned.audit.jsonl). Each line carries the hash of the
// line before it, so an edit or a deletion shows when the journal is verified.
//
// No model is used here. Lessons become a checklist of pitfalls (a lesson is a mistake that was corrected, not a procedure) and a stable automation
// becomes the skill of its own text; both get the standard rules block of the shipped skills. The agent can also propose a skill (`skill_propose`) or an
// improvement of one Kaby made (`skill_improve`): what it writes is checked here, scored by rules (learned-score.mjs) and, only if the person's level
// and threshold allow it and no hard stop applies (untrusted source, risky text, client data, a skill the person edited…), applied on Kaby's word, with a
// journal line and an undo. The level lives in learned-settings.mjs; docs/dev/learned-skills.md says what is built and what comes next.
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { defaults as settingsDefaults, normalize as normalizeSettings, publicView as settingsView, apply as applySettings, MODES, THRESHOLD, CAPS, NOTIFY } from './learned-settings.mjs'
import { scoreOf, stopsOf, isRisky, AGENT_KINDS, SCORE_MAX } from './learned-score.mjs'
import { sourceOf } from './learned-taint.mjs'

export const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const LEARNED_SEAM = Symbol.for('kybernos.learned-skills')
export const LEARNED_LIMITS = Object.freeze({
  maxPending: 5,        // proposals waiting at once
  pendingDays: 30,      // a proposal nobody answers leaves after this
  discardedDays: 30,    // and is kept this long, so Restore works
  nameMax: 40,
  descriptionMax: 1024,
  bodyMax: 6000,
  sizeMax: 8192,        // description + body, in characters
  lessonsMax: 8,
  lessonMax: 500,
  versionsKept: 10,     // per skill
  versionDays: 90,
  addMax: 600,          // an improvement is one paragraph
  addMin: 8,
  weekDays: 7,          // the window of the weekly cap and of the circuit breaker
  unusedDays: 30,       // a learned skill nobody used for this long is flagged
  usedInKept: 30,
  duplicate: 0.6        // likeness to a skill the person has, from which the check warns
})
export const KINDS = ['lessons', 'auto', 'asked', 'improve']
const DAY = 24 * 3600 * 1000

/** The block every learned skill ends with, the same rules as the skills Kybernos ships. */
export const RULES = Object.freeze([
  'Speak the user’s language, whatever language this file is written in.',
  'Draft only: never send, publish, delete or pay for the user.',
  'Only what is in the sources. Never invent a fact, a number or a quote.',
  'Verification is the user’s: end with what to read before relying on it.'
])

const plain = (v) => v !== null && typeof v === 'object' && Array.isArray(v) === false
// \s also covers U+2028 and U+2029, so no raw line separator is spelled out here.
const oneLine = (v, max) => String(typeof v === 'string' ? v : '').replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
const iso = (ms) => new Date(ms).toISOString()
const sha = (text) => createHash('sha256').update(text).digest('hex')

// ── where things live ────────────────────────────────────────────────────────────────────────────────────────────────────────
export const kyDir = (dsh) => join(dsh, 'kybernos')
export const ledgerPath = (dsh) => join(kyDir(dsh), 'skills-learned.json')
export const auditPath = (dsh) => join(kyDir(dsh), 'skills-learned.audit.jsonl')
export const versionsDir = (dsh) => join(kyDir(dsh), 'skills-learned-versions')
export const skillsDir = (dsh) => join(dsh, 'skills')
export const settingsPath = (dsh) => join(kyDir(dsh), 'skills-learned-settings.json')

// ── text: what a proposal says, and the checks every one passes ───────────────────────────────────────────────────────────────
const yamlText = (s) => JSON.stringify(String(s))

/** The SKILL.md of a learned skill: the shipped frontmatter, the body, then the standard rules. */
export const buildSkillText = ({ name, description, whenToUse, body }) => {
  const lines = ['---', 'name: ' + name, 'description: ' + yamlText(description)]
  if (typeof whenToUse === 'string' && whenToUse.trim() !== '') lines.push('whenToUse: ' + yamlText(whenToUse.trim()))
  lines.push('---', '', String(body).trim(), '', '## Rules', '', ...RULES.map((r) => '- ' + r), '')
  return lines.join('\n')
}

const fold = (t) => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const STOP = new Set(['the', 'and', 'for', 'with', 'use', 'when', 'user', 'that', 'this', 'from', 'une', 'des', 'les', 'que', 'pour', 'dans', 'est', 'quand', 'sur', 'par', 'aux'])
const wordsOf = (t) => new Set(fold(t).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && STOP.has(w) === false))
/** How alike two texts are, 0 to 1 (words in common over words in all). */
export const likeness = (a, b) => {
  const x = wordsOf(a); const y = wordsOf(b)
  if (x.size === 0 || y.size === 0) return 0
  let both = 0
  for (const w of x) if (y.has(w)) both += 1
  return both / (x.size + y.size - both)
}

/** Client data found in a text: e-mails, phone numbers and long numbers, dates, and the names the caller lists. `[{ s, e, kind }]`, in order. */
export const lintText = (text, names) => {
  const t = String(text).slice(0, LEARNED_LIMITS.sizeMax * 2)
  const hits = []
  const run = (re, kind) => { re.lastIndex = 0; let m; while ((m = re.exec(t)) !== null) hits.push({ s: m.index, e: m.index + m[0].length, kind }) }
  run(/[\w.+-]+@[\w-]+\.[\w.-]+/g, 'email')
  run(/\+?\d[\d .-]{7,}\d/g, 'phone')
  run(/\b\d{2}\/\d{2}\/\d{4}\b/g, 'date')
  for (const n of Array.isArray(names) ? names.slice(0, 20) : []) {
    const name = oneLine(n, 40)
    if (name.length >= 3) run(new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g'), 'name')
  }
  hits.sort((a, b) => a.s - b.s || b.e - a.e)
  const out = []
  for (const h of hits) if (out.length === 0 || h.s >= out[out.length - 1].e) out.push(h)
  return out
}

/**
 * The checks of a proposal: `{ list: [{ id, s: 'ok'|'warn'|'bad', ... }], hits, blocking }`. `existing` is `[{ name, description }]` (the skills the person has).
 * Client data blocks Accept only where the work is sensitive (Law, Health): elsewhere it is a warning to read.
 */
export const checkProposal = (p, { existing = [], sensitive = false } = {}) => {
  const name = oneLine(p.name, 80); const description = typeof p.description === 'string' ? p.description : ''; const body = typeof p.body === 'string' ? p.body : ''
  const size = description.length + body.length
  const list = []
  list.push({ id: 'name', s: SKILL_NAME_RE.test(name) && name.length <= LEARNED_LIMITS.nameMax ? 'ok' : 'bad', name })
  list.push({ id: 'use_when', s: /\buse when\b/i.test(description) && description.trim().length <= LEARNED_LIMITS.descriptionMax ? 'ok' : 'bad' })
  list.push({ id: 'rules', s: 'ok' })
  list.push({ id: 'size', s: size > 0 && size <= LEARNED_LIMITS.sizeMax && body.trim() !== '' ? 'ok' : 'bad', size, max: LEARNED_LIMITS.sizeMax })
  let closest = { name: null, likeness: 0 }
  for (const e of existing) {
    if (!plain(e) || typeof e.name !== 'string' || e.name === name) continue
    const l = likeness(description + ' ' + body, String(e.description || '') + ' ' + e.name)
    if (l > closest.likeness) closest = { name: e.name, likeness: l }
  }
  list.push({ id: 'copy', s: closest.likeness < LEARNED_LIMITS.duplicate ? 'ok' : 'warn', closest: closest.name, percent: Math.round(closest.likeness * 100) })
  const hits = size <= LEARNED_LIMITS.sizeMax ? lintText(description + '\n' + body, p.names) : []
  list.push({ id: 'client_data', s: hits.length === 0 ? 'ok' : (sensitive ? 'bad' : 'warn'), count: hits.length })
  return { list, hits, blocking: list.some((c) => c.s === 'bad'), size }
}

// ── the ledger ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
const emptyLedger = () => ({ version: 1, proposals: [], learned: {}, discarded: [], legacyImported: false })

const normProposal = (p) => {
  if (!plain(p) || typeof p.id !== 'string' || SKILL_NAME_RE.test(String(p.name)) === false || KINDS.indexOf(p.kind) < 0) return null
  if (p.kind === 'improve' && SKILL_NAME_RE.test(String(p.target)) === false) return null
  return {
    id: oneLine(p.id, 40), name: String(p.name), kind: p.kind,
    createdAt: oneLine(p.createdAt, 40), description: oneLine(p.description, LEARNED_LIMITS.descriptionMax), whenToUse: oneLine(p.whenToUse, 400),
    body: String(typeof p.body === 'string' ? p.body : '').slice(0, LEARNED_LIMITS.bodyMax),
    from: plain(p.from) ? JSON.parse(JSON.stringify(p.from)) : {},
    names: (Array.isArray(p.names) ? p.names : []).map((n) => oneLine(n, 40)).filter((n) => n.length >= 3).slice(0, 20),
    edited: p.edited === true,
    // for an improvement: the skill it improves, the paragraph to add, why, and the version it was made against
    ...(p.kind === 'improve' ? { target: SKILL_NAME_RE.test(String(p.target)) ? String(p.target) : '', add: oneLine(p.add, LEARNED_LIMITS.addMax), reason: oneLine(p.reason, 300), baseVer: Number.isInteger(p.baseVer) ? p.baseVer : 1 } : {}),
    // where an agent-written suggestion came from: the chat, and what the host knows about it (learned-taint.mjs): `tainted` is false only for a chat followed from its start that never reached outside
    source: plain(p.source) ? { sessionId: oneLine(p.source.sessionId, 80), tracked: p.source.tracked === true, tainted: p.source.tainted === false ? false : true, tool: typeof p.source.tool === 'string' ? oneLine(p.source.tool, 60) : null } : null,
    verifiedLessons: Number.isInteger(p.verifiedLessons) && p.verifiedLessons > 0 ? Math.min(p.verifiedLessons, 8) : 0
  }
}

/** The ledger as the file holds it, whatever the file holds: always the same shape, never a throw. */
export const normalizeLedger = (raw) => {
  const out = emptyLedger()
  if (!plain(raw)) return out
  out.legacyImported = raw.legacyImported === true
  for (const p of Array.isArray(raw.proposals) ? raw.proposals.slice(0, 50) : []) { const n = normProposal(p); if (n !== null) out.proposals.push(n) }
  for (const d of Array.isArray(raw.discarded) ? raw.discarded.slice(0, 100) : []) {
    const n = normProposal(d)
    if (n !== null && typeof d.discardedAt === 'string') out.discarded.push({ ...n, discardedAt: oneLine(d.discardedAt, 40), why: d.why === 'expired' ? 'expired' : 'discarded' })
  }
  if (plain(raw.learned)) {
    for (const name of Object.keys(raw.learned).slice(0, 500)) {
      const l = raw.learned[name]
      if (!SKILL_NAME_RE.test(name) || !plain(l)) continue
      out.learned[name] = {
        kind: KINDS.indexOf(l.kind) >= 0 ? l.kind : 'lessons', acceptedAt: oneLine(l.acceptedAt, 40), ver: Number.isInteger(l.ver) && l.ver > 0 ? l.ver : 1,
        sha: typeof l.sha === 'string' && /^[0-9a-f]{64}$/.test(l.sha) ? l.sha : null, from: plain(l.from) ? JSON.parse(JSON.stringify(l.from)) : {},
        by: l.by === 'kaby' ? 'kaby' : 'you', mode: ['approved', 'manual', 'auto', 'legacy'].indexOf(l.mode) >= 0 ? l.mode : 'approved',
        uses: Number.isInteger(l.uses) && l.uses >= 0 ? l.uses : 0, lastUsed: typeof l.lastUsed === 'string' ? oneLine(l.lastUsed, 40) : null,
        legacy: l.legacy === true, proposal: plain(l.proposal) ? normProposal(l.proposal) : null,
        // what Kaby did on its own: the score it was applied at, whether the person has looked at it, the chats it was used in (one use per chat), what changed since version 1
        score: Number.isFinite(l.score) ? Math.max(0, Math.min(SCORE_MAX, Math.round(l.score))) : null, reviewed: l.reviewed !== false,
        usedIn: (Array.isArray(l.usedIn) ? l.usedIn : []).map((x) => oneLine(x, 80)).filter((x) => x !== '').slice(-LEARNED_LIMITS.usedInKept),
        sessionId: typeof l.sessionId === 'string' && l.sessionId !== '' ? oneLine(l.sessionId, 80) : null,
        history: (Array.isArray(l.history) ? l.history : []).filter(plain).slice(-20).map((x) => ({ ver: Number.isInteger(x.ver) ? x.ver : 1, at: oneLine(x.at, 40), by: x.by === 'kaby' ? 'kaby' : 'you', mode: ['approved', 'manual', 'auto'].indexOf(x.mode) >= 0 ? x.mode : 'approved', sha: typeof x.sha === 'string' ? x.sha : null, add: oneLine(x.add, LEARNED_LIMITS.addMax) }))
      }
    }
  }
  return out
}

export const readLedger = (dsh) => { try { return normalizeLedger(JSON.parse(readFileSync(ledgerPath(dsh), 'utf8'))) } catch (e) { return emptyLedger() } }

const writeAtomic = (file, text, mode) => {
  mkdirSync(join(file, '..'), { recursive: true })
  const temp = file + '.tmp-' + String(process.pid) + '-' + randomBytes(3).toString('hex')
  try { writeFileSync(temp, text, { encoding: 'utf8', mode }); renameSync(temp, file) } catch (e) { try { unlinkSync(temp) } catch (e2) { /* nothing to clean */ } throw e }
}
export const writeLedger = (dsh, ledger) => writeAtomic(ledgerPath(dsh), JSON.stringify(ledger, null, 2) + '\n', 0o600)

// One writer at a time per home: a read, a change and a write never interleave with another call's.
const queues = new Map()
export const withLedger = (dsh, fn) => {
  const run = (queues.get(dsh) || Promise.resolve()).then(async () => {
    const ledger = readLedger(dsh)
    const before = JSON.stringify(ledger)
    const result = await fn(ledger)
    if (JSON.stringify(ledger) !== before) writeLedger(dsh, ledger)
    return result
  })
  queues.set(dsh, run.catch(() => null))
  return run
}

// ── the journal ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
const ZERO = '0'.repeat(64)
const entryHash = (prev, e) => {
  const body = [e.n, e.t, e.act, e.skill, e.by, e.mode, e.kind, e.ver, e.from, e.note]
  // The score and its parts are in the hash only when the line has them: the lines written before they existed still verify.
  if (e.score !== undefined) body.push(e.score, e.sig === undefined ? null : e.sig)
  return sha(prev + '\n' + JSON.stringify(body))
}
const readLines = (dsh) => { try { return readFileSync(auditPath(dsh), 'utf8').split('\n').filter((l) => l !== '') } catch (e) { return [] } }
const parseEntry = (line) => { try { const e = JSON.parse(line); return plain(e) ? e : null } catch (e) { return null } }

/** Adds one line to the journal. `act`: proposed, accepted, created (Kaby on its own), improved, discarded, restored, reverted, reviewed, expired, adopted, removed, settings, paused. `by`: you | kaby. `note`: a short code the page words (edited_before_accepting, taken_back, folder_gone, undid_auto, two_undos, stopped). `score`/`sig`: the confidence score and its parts, for what Kaby did on its own. */
export const appendAudit = (dsh, o, now = Date.now()) => {
  const lines = readLines(dsh)
  const last = lines.length === 0 ? null : parseEntry(lines[lines.length - 1])
  const e = {
    n: last === null ? 1 : (Number(last.n) || lines.length) + 1, t: iso(now), act: String(o.act), skill: oneLine(o.skill, 80), by: o.by === 'kaby' ? 'kaby' : 'you',
    mode: ['approved', 'manual', 'auto', 'legacy'].indexOf(o.mode) >= 0 ? o.mode : 'approved', kind: KINDS.indexOf(o.kind) >= 0 ? o.kind : null,
    ver: Number.isInteger(o.ver) ? o.ver : null, from: plain(o.from) ? o.from : null, note: o.note === undefined ? null : oneLine(o.note, 200)
  }
  if (Number.isFinite(o.score)) { e.score = Math.round(o.score); e.sig = Array.isArray(o.sig) ? o.sig.slice(0, 8).map((x) => [String(x[0]).slice(0, 20), Number(x[1])]) : null }
  e.prev = last === null ? ZERO : String(last.hash)
  e.hash = entryHash(e.prev, e)
  mkdirSync(kyDir(dsh), { recursive: true })
  appendFileSync(auditPath(dsh), JSON.stringify(e) + '\n', { encoding: 'utf8', mode: 0o600 })
  return e
}

/**
 * The journal, newest first, and whether its chain holds: `{ verified, count, brokenAt, entries }`. `brokenAt` is the `n` of the first line that does not
 * match the one before it (-1 for a line that is not JSON). A hash chain shows an edit and a deletion in the middle; it cannot show lines cut off the end.
 */
export const readAudit = (dsh, limit = 200) => {
  const entries = []
  let prev = ZERO; let brokenAt = null
  for (const line of readLines(dsh)) {
    const e = parseEntry(line)
    if (e === null) { if (brokenAt === null) brokenAt = -1; continue }
    if ((e.prev !== prev || e.hash !== entryHash(prev, e)) && brokenAt === null) brokenAt = e.n
    entries.push(e)
    prev = typeof e.hash === 'string' ? e.hash : prev
  }
  return { verified: brokenAt === null, count: entries.length, brokenAt, entries: entries.reverse().slice(0, Math.max(1, Math.min(500, limit))) }
}

// ── versions: the text as it was accepted ───────────────────────────────────────────────────────────────────────────────────
const snapshot = (dsh, name, ver, text, now) => {
  const dir = join(versionsDir(dsh), name)
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, String(ver) + '.md'), text, { encoding: 'utf8', mode: 0o600 })
    const files = readdirSync(dir).filter((f) => /^\d+\.md$/.test(f)).map((f) => ({ f, ver: parseInt(f, 10), at: statSync(join(dir, f)).mtimeMs })).sort((a, b) => b.ver - a.ver)
    files.forEach((x, i) => { if (i >= LEARNED_LIMITS.versionsKept || now - x.at > LEARNED_LIMITS.versionDays * DAY) { try { rmSync(join(dir, x.f)) } catch (e) { /* kept */ } } })
  } catch (e) { /* a version that could not be kept does not stop the skill */ }
}

// ── legacy: skills the automations already made the old way ─────────────────────────────────────────────────────────────────
/** Skills written from stable automations before proposals existed (<DSH home>/kybernos/automation-skills.json) become Learned, kept active. */
const adoptLegacy = (dsh, ledger, now) => {
  if (ledger.legacyImported === true) return false
  ledger.legacyImported = true
  let raw = null
  try { raw = JSON.parse(readFileSync(join(kyDir(dsh), 'automation-skills.json'), 'utf8')) } catch (e) { return true }
  if (!plain(raw) || !plain(raw.skills)) return true
  for (const id of Object.keys(raw.skills).slice(0, 200)) {
    const r = raw.skills[id]
    if (!plain(r) || typeof r.skill !== 'string' || SKILL_NAME_RE.test(r.skill) === false || ledger.learned[r.skill] !== undefined) continue
    if (existsSync(join(skillsDir(dsh), r.skill, 'SKILL.md')) === false) continue
    const manual = r.how === 'manual'
    ledger.learned[r.skill] = { kind: 'auto', acceptedAt: oneLine(r.at, 40) || iso(now), ver: 1, sha: null, from: { automation: { id: oneLine(id, 120), runs: Number.isFinite(r.runs) ? r.runs : 0 } }, by: manual ? 'you' : 'kaby', mode: manual ? 'manual' : 'legacy', uses: 0, lastUsed: null, legacy: true, proposal: null, score: null, reviewed: true, usedIn: [], sessionId: null, history: [] }
    appendAudit(dsh, { act: 'adopted', skill: r.skill, by: manual ? 'you' : 'kaby', mode: manual ? 'manual' : 'legacy', kind: 'auto', ver: 1, from: ledger.learned[r.skill].from }, now)
  }
  return true
}

/** Housekeeping on every read: legacy skills adopted once, proposals nobody answered for 30 days leave, old discards are forgotten, vanished skills are dropped. */
const sweep = (dsh, ledger, now) => {
  let changed = adoptLegacy(dsh, ledger, now)
  const keep = []
  for (const p of ledger.proposals) {
    if (now - (Date.parse(p.createdAt) || now) > LEARNED_LIMITS.pendingDays * DAY) {
      ledger.discarded.push({ ...p, discardedAt: iso(now), why: 'expired' })
      appendAudit(dsh, { act: 'expired', skill: p.name, by: 'kaby', mode: 'auto', kind: p.kind }, now)
      changed = true
    } else keep.push(p)
  }
  ledger.proposals = keep
  const before = ledger.discarded.length
  ledger.discarded = ledger.discarded.filter((d) => now - (Date.parse(d.discardedAt) || now) <= LEARNED_LIMITS.discardedDays * DAY)
  if (ledger.discarded.length !== before) changed = true
  for (const name of Object.keys(ledger.learned)) {
    if (existsSync(join(skillsDir(dsh), name, 'SKILL.md')) === false && existsSync(join(skillsDir(dsh), name, 'SKILL.md.disabled')) === false) {
      appendAudit(dsh, { act: 'removed', skill: name, by: 'you', mode: 'manual', kind: ledger.learned[name].kind, ver: ledger.learned[name].ver, note: 'folder_gone' }, now)
      delete ledger.learned[name]
      changed = true
    }
  }
  return changed
}

/** Is the work sensitive (Law, Health)? From the field the person chose at first run; a proposal there stays local and client data blocks Accept. */
export const SENSITIVE_FIELDS = Object.freeze(['droit', 'legal', 'sante'])
export const isSensitive = (dsh) => {
  try { return SENSITIVE_FIELDS.indexOf(String(JSON.parse(readFileSync(join(kyDir(dsh), 'onboarding.json'), 'utf8')).profil)) >= 0 } catch (e) { return false }
}

// ── settings, track record, the weekly cap ──────────────────────────────────────────────────────────────────────────────────
export const readSettings = (dsh) => { try { return normalizeSettings(JSON.parse(readFileSync(settingsPath(dsh), 'utf8'))) } catch (e) { return settingsDefaults() } }
const writeSettings = (dsh, state) => writeAtomic(settingsPath(dsh), JSON.stringify(state) + '\n', 0o600)
const journalEntries = (dsh) => readLines(dsh).map(parseEntry).filter((e) => e !== null)
const at = (e) => Date.parse(e.t) || 0
/** Automatic changes of this week that still stand: what Kaby made or improved on its own, less what the person undid. */
export const autoThisWeek = (entries, now) => {
  const since = now - LEARNED_LIMITS.weekDays * DAY
  const made = entries.filter((e) => e.by === 'kaby' && e.mode === 'auto' && (e.act === 'created' || e.act === 'improved') && at(e) >= since).length
  const undone = entries.filter((e) => e.act === 'reverted' && e.note === 'undid_auto' && at(e) >= since).length
  return Math.max(0, made - undone)
}
/** The person has accepted suggestions and has not taken back one of Kaby's own changes in the last 30 days. */
const goodRecord = (entries, now) => entries.some((e) => e.act === 'accepted' && e.by === 'you') && !entries.some((e) => e.act === 'reverted' && e.note === 'undid_auto' && at(e) >= now - 30 * DAY)

const HARD = ['your_click', 'locked', 'untrusted', 'risky', 'client_data', 'checks', 'edited_by_you']
const sigOf = (score) => score.signals.map((x) => [x.id, x.v])
const skillFile = (dsh, name) => join(skillsDir(dsh), name, 'SKILL.md')
const editedSince = (dsh, name, l) => {
  try { return l === undefined || l.sha === null || sha(readFileSync(skillFile(dsh, name), 'utf8')) !== l.sha } catch (e) { return true }
}
// The checks of an improvement are those of the paragraph it adds (a skill that exists was checked when it was accepted).
const checkable = (p) => (p.kind === 'improve' ? { name: p.target, description: 'Use when the skill ' + p.target + ' is used.', body: p.add, names: [] } : p)

/**
 * Everything the host knows about one suggestion: its checks, its confidence score and, if the person's settings say it may not be applied on Kaby's word, why
 * (`stops`, codes of learned-score.mjs). `mode` overrides the level (the page asks « what if »). Read-only: nothing is written.
 */
const assess = (dsh, ledger, p, { existing = [], settings, sensitive, entries, now, mode }) => {
  const checks = checkProposal(checkable(p), { existing: p.kind === 'improve' ? [] : existing, sensitive })
  const l = p.kind === 'improve' ? ledger.learned[p.target] : undefined
  const score = scoreOf(p, { checks, record: goodRecord(entries, now), uses: l !== undefined ? l.usedIn.length : 0, text: p.kind === 'improve' ? p.add : undefined })
  const stops = stopsOf(p, score, { settings, sensitive, usedThisWeek: autoThisWeek(entries, now), targetEdited: p.kind === 'improve' ? editedSince(dsh, p.target, l) : false, mode })
  return { checks, score, stops }
}

const proposalView = (p, ctx, a) => {
  const checks = a !== undefined ? a.checks : checkProposal(checkable(p), ctx)
  const out = { id: p.id, name: p.name, kind: p.kind, createdAt: p.createdAt, expiresAt: iso((Date.parse(p.createdAt) || 0) + LEARNED_LIMITS.pendingDays * DAY), description: p.description, whenToUse: p.whenToUse, body: p.body, from: p.from, edited: p.edited, checks: checks.list, hits: checks.hits, blocking: checks.blocking, text: p.kind === 'improve' ? '' : buildSkillText(p), source: p.source }
  if (p.kind === 'improve') { out.target = p.target; out.add = p.add; out.reason = p.reason; out.baseVer = p.baseVer }
  if (a !== undefined) { out.score = { total: a.score.total, signals: a.score.signals, risky: a.score.risky }; out.stops = a.stops; out.hard = a.stops.filter((c) => HARD.indexOf(c) >= 0) }
  return out
}

// ── reading ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Whole days since the skill was last used (or accepted, if never used), once that is a month or more; 0 before. */
const unusedFor = (l, now) => { const d = Math.floor((now - (Date.parse(l.lastUsed || l.acceptedAt) || now)) / DAY); return d >= LEARNED_LIMITS.unusedDays ? d : 0 }

/** What the page shows: the proposals with their checks and scores, the learned skills, the settings, the field's privacy, the limits. `existing` is `[{ name, description }]`. */
export const listLearned = async ({ dsh, existing = [], now = Date.now() }) => {
  const sensitive = isSensitive(dsh)
  const settings = readSettings(dsh)
  const out = await withLedger(dsh, async (ledger) => {
    sweep(dsh, ledger, now)
    const entries = journalEntries(dsh)
    return {
      proposals: ledger.proposals.map((p) => proposalView(p, { existing, sensitive }, assess(dsh, ledger, p, { existing, settings, sensitive, entries, now }))),
      learned: Object.keys(ledger.learned).map((name) => { const l = ledger.learned[name]; return { name, kind: l.kind, acceptedAt: l.acceptedAt, ver: l.ver, from: l.from, by: l.by, mode: l.mode, uses: l.uses, lastUsed: l.lastUsed, legacy: l.legacy, score: l.score, reviewed: l.reviewed, unusedDays: unusedFor(l, now), improved: l.history.length > 0, auto: l.by === 'kaby' && l.mode === 'auto' || l.history.some((h) => h.by === 'kaby') } }),
      discarded: ledger.discarded.map((d) => ({ id: d.id, name: d.name, kind: d.kind, discardedAt: d.discardedAt, why: d.why })),
      week: { used: autoThisWeek(entries, now), cap: settings.cap }
    }
  })
  return { ok: true, ...out, sensitive, settings: settingsView(settings), rules: RULES, limits: { maxPending: LEARNED_LIMITS.maxPending, pendingDays: LEARNED_LIMITS.pendingDays, discardedDays: LEARNED_LIMITS.discardedDays } }
}

// ── proposing ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const freeName = (base, taken) => {
  const root = base.slice(0, LEARNED_LIMITS.nameMax).replace(/-+$/g, '') || 'skill'
  if (taken(root) === false) return root
  for (let i = 2; i < 10; i += 1) { const c = root.slice(0, LEARNED_LIMITS.nameMax - 2).replace(/-+$/g, '') + '-' + String(i); if (taken(c) === false) return c }
  return null
}
const slugOf = (text) => oneLine(text, 120).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
const titleOf = (tag) => { const t = oneLine(tag, 40); return t === '' ? 'Lessons' : t.charAt(0).toUpperCase() + t.slice(1) }

const addProposal = (dsh, ledger, p, now) => {
  const taken = (n) => existsSync(join(skillsDir(dsh), n)) || ledger.proposals.some((x) => x.name === n) || ledger.learned[n] !== undefined
  const name = freeName(p.name, taken)
  if (name === null) return { ok: false, error: 'no_free_name' }
  const id = 'p_' + randomBytes(4).toString('hex')
  const prop = normProposal({ ...p, id, name, createdAt: iso(now) })
  ledger.proposals.unshift(prop)
  appendAudit(dsh, { act: 'proposed', skill: name, by: 'kaby', mode: 'approved', kind: prop.kind, from: prop.from }, now)
  return { ok: true, proposal: prop }
}

/**
 * A checklist of pitfalls from one or several lessons, by fixed rules: the lessons' own words under « Watch out for », no model. `lessons` is
 * `[{ text, tags, kyber }]`. Answers `too_many_pending` at 5 proposals and `already_proposed` for lessons that already made one.
 */
export const proposeFromLessons = ({ dsh, lessons, existing = [], now = Date.now() }) => {
  const list = (Array.isArray(lessons) ? lessons : []).filter((l) => plain(l) && oneLine(l.text, LEARNED_LIMITS.lessonMax) !== '').slice(0, LEARNED_LIMITS.lessonsMax)
  if (list.length === 0) return Promise.resolve({ ok: false, error: 'no_lessons' })
  const texts = list.map((l) => oneLine(l.text, LEARNED_LIMITS.lessonMax))
  const tags = list.flatMap((l) => (Array.isArray(l.tags) ? l.tags : [])).map((t) => oneLine(t, 40)).filter((t) => t !== '')
  const counts = new Map(); for (const t of tags) counts.set(t, (counts.get(t) || 0) + 1)
  const tag = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  const topic = tag === undefined ? 'lessons' : tag[0]
  const base = slugOf(topic + (list.length > 1 ? ' checklist' : ' pitfall')) || 'lessons-pitfall'
  const body = '# ' + titleOf(topic) + (list.length > 1 ? ' checklist' : ' pitfall') + '\n\n## Watch out for\n' + texts.map((t) => '- ' + t).join('\n')
  const description = 'Reminds you of ' + String(list.length) + ' mistake' + (list.length > 1 ? 's' : '') + ' already made about “' + topic + '”. Use when the user works on ' + topic + '.'
  return withLedger(dsh, async (ledger) => {
    sweep(dsh, ledger, now)
    if (ledger.proposals.length >= LEARNED_LIMITS.maxPending) return { ok: false, error: 'too_many_pending', max: LEARNED_LIMITS.maxPending }
    const key = sha(texts.slice().sort().join('\n'))
    if (ledger.proposals.some((p) => p.from.key === key) || Object.values(ledger.learned).some((l) => l.from && l.from.key === key)) return { ok: false, error: 'already_proposed' }
    const made = addProposal(dsh, ledger, { name: base, kind: 'lessons', description, body, from: { key, lessons: list.map((l, i) => ({ text: texts[i].slice(0, 140), kyber: oneLine(l.kyber, 60) })), topic } }, now)
    if (made.ok !== true) return made
    const sensitive = isSensitive(dsh)
    return { ok: true, proposal: proposalView(made.proposal, { existing, sensitive }, assess(dsh, ledger, made.proposal, { existing, settings: readSettings(dsh), sensitive, entries: journalEntries(dsh), now })) }
  })
}

/**
 * The skill of a stable automation: its own text, no model. The caller (the automations half of Kybernos) passes the parts it built;
 * `acceptNow` is the person pressing « Create skill » by hand, which is the validation itself: the skill is written at once, and the journal says so.
 */
export const proposeFromAutomation = ({ dsh, name, description, whenToUse, body, automation, acceptNow, existing = [], now = Date.now() }) => {
  const a = plain(automation) ? automation : {}
  const draft = { name: slugOf(name) || 'automation', kind: 'auto', description: oneLine(description, LEARNED_LIMITS.descriptionMax), whenToUse: oneLine(whenToUse, 400), body: String(body === undefined ? '' : body).slice(0, LEARNED_LIMITS.bodyMax), from: { automation: { id: oneLine(a.id, 120), name: oneLine(a.name, 120), runs: Number.isFinite(a.runs) ? Math.max(0, Math.floor(a.runs)) : 0 } } }
  return withLedger(dsh, async (ledger) => {
    sweep(dsh, ledger, now)
    if (acceptNow !== true && ledger.proposals.length >= LEARNED_LIMITS.maxPending) return { ok: false, error: 'too_many_pending', max: LEARNED_LIMITS.maxPending }
    const made = addProposal(dsh, ledger, draft, now)
    if (made.ok !== true) return made
    if (acceptNow === true) {
      const done = acceptInLedger(dsh, ledger, made.proposal.id, {}, { existing, now, mode: 'manual' })
      return done.ok ? { ok: true, name: done.name, pending: false } : done
    }
    const sensitive = isSensitive(dsh)
    const a = assess(dsh, ledger, made.proposal, { existing, settings: readSettings(dsh), sensitive, entries: journalEntries(dsh), now })
    const applied = applyIfAllowed(dsh, ledger, made.proposal, a, { existing, now })
    if (applied.applied === true) return { ok: true, name: applied.name, pending: false, auto: true }
    return { ok: true, name: made.proposal.name, pending: true, proposal: proposalView(made.proposal, { existing, sensitive }, a) }
  })
}

// ── answering: accept, edit, discard, restore, undo ─────────────────────────────────────────────────────────────────────────
export const proposalOf = (ledger, id) => ledger.proposals.find((p) => p.id === id)

function acceptInLedger (dsh, ledger, id, edits, { existing, now, mode, by = 'you', score = null, signals = null }) {
  const p = proposalOf(ledger, id)
  if (p === undefined) return { ok: false, error: 'not_found' }
  const draft = { ...p }
  if (plain(edits)) {
    if (typeof edits.description === 'string') draft.description = oneLine(edits.description, LEARNED_LIMITS.descriptionMax + 1)
    if (typeof edits.body === 'string') draft.body = edits.body.slice(0, LEARNED_LIMITS.bodyMax + 1)
  }
  const checks = checkProposal(draft, { existing, sensitive: isSensitive(dsh) })
  if (checks.blocking) return { ok: false, error: 'checks_failed', checks: checks.list.filter((c) => c.s === 'bad').map((c) => c.id), hits: checks.hits.length }
  const taken = (n) => existsSync(join(skillsDir(dsh), n)) || ledger.learned[n] !== undefined
  const name = taken(p.name) ? freeName(p.name, taken) : p.name
  if (name === null) return { ok: false, error: 'no_free_name' }
  const text = buildSkillText({ ...draft, name })
  const dir = join(skillsDir(dsh), name)
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'SKILL.md'), text, { encoding: 'utf8', flag: 'wx' })
  } catch (e) {
    try { rmSync(dir, { recursive: false, force: true }) } catch (e2) { /* only an empty folder this call made */ }
    return { ok: false, error: 'write_failed', dest: join(skillsDir(dsh)) }
  }
  ledger.proposals = ledger.proposals.filter((x) => x.id !== id)
  const auto = by === 'kaby'
  ledger.learned[name] = { kind: p.kind, acceptedAt: iso(now), ver: 1, sha: sha(text), from: p.from, by, mode, uses: 0, lastUsed: null, legacy: false, proposal: normProposal({ ...draft, id: p.id, name: p.name, createdAt: p.createdAt, edited: p.edited || draft.body !== p.body || draft.description !== p.description }), score, reviewed: !auto, usedIn: [], sessionId: p.source !== null && p.source.sessionId !== '' ? p.source.sessionId : null, history: [] }
  snapshot(dsh, name, 1, text, now)
  appendAudit(dsh, { act: auto ? 'created' : 'accepted', skill: name, by, mode, kind: p.kind, ver: 1, from: p.from, note: ledger.learned[name].proposal.edited ? 'edited_before_accepting' : null, score: auto ? score : undefined, sig: auto ? signals : undefined }, now)
  return { ok: true, name }
}

export const acceptProposal = ({ dsh, id, description, body, existing = [], now = Date.now() }) => withLedger(dsh, async (ledger) => {
  sweep(dsh, ledger, now)
  const p = proposalOf(ledger, String(id))
  // An improvement is written into the skill that exists; the person's own Accept applies it even to a skill they have edited (the paragraph is added, nothing else moves).
  if (p !== undefined && p.kind === 'improve') {
    const c = checkProposal(checkable(p), { sensitive: isSensitive(dsh) })
    if (c.blocking) return { ok: false, error: 'checks_failed', checks: c.list.filter((x) => x.s === 'bad').map((x) => x.id), hits: c.hits.length }
    return applyImprove(dsh, ledger, p, { by: 'you', mode: 'approved', now })
  }
  return acceptInLedger(dsh, ledger, String(id), { description, body }, { existing, now, mode: 'approved' })
})

/** The person's own words for the description and the text, kept on the proposal (nothing is active). Answers the checks of what was saved. */
export const editProposal = ({ dsh, id, description, body, add, existing = [], now = Date.now() }) => withLedger(dsh, async (ledger) => {
  sweep(dsh, ledger, now)
  const p = proposalOf(ledger, String(id))
  if (p === undefined) return { ok: false, error: 'not_found' }
  if (p.kind === 'improve') { if (typeof add === 'string') p.add = oneLine(add, LEARNED_LIMITS.addMax) } else {
    if (typeof description === 'string') p.description = oneLine(description, LEARNED_LIMITS.descriptionMax + 1)
    if (typeof body === 'string') p.body = body.slice(0, LEARNED_LIMITS.bodyMax + 1)
  }
  p.edited = true
  const sensitive = isSensitive(dsh)
  return { ok: true, proposal: proposalView(p, { existing, sensitive }, assess(dsh, ledger, p, { existing, settings: readSettings(dsh), sensitive, entries: journalEntries(dsh), now })) }
})

export const discardProposal = ({ dsh, id, now = Date.now() }) => withLedger(dsh, async (ledger) => {
  sweep(dsh, ledger, now)
  const p = proposalOf(ledger, String(id))
  if (p === undefined) return { ok: false, error: 'not_found' }
  ledger.proposals = ledger.proposals.filter((x) => x.id !== p.id)
  ledger.discarded.unshift({ ...p, discardedAt: iso(now), why: 'discarded' })
  appendAudit(dsh, { act: 'discarded', skill: p.name, by: 'you', mode: 'manual', kind: p.kind, from: p.from }, now)
  return { ok: true, name: p.name }
})

export const restoreProposal = ({ dsh, id, now = Date.now() }) => withLedger(dsh, async (ledger) => {
  sweep(dsh, ledger, now)
  const d = ledger.discarded.find((x) => x.id === String(id))
  if (d === undefined) return { ok: false, error: 'not_found' }
  if (ledger.proposals.length >= LEARNED_LIMITS.maxPending) return { ok: false, error: 'too_many_pending', max: LEARNED_LIMITS.maxPending }
  ledger.discarded = ledger.discarded.filter((x) => x.id !== d.id)
  const { discardedAt, why, ...p } = d
  ledger.proposals.unshift({ ...p, createdAt: iso(now) })
  appendAudit(dsh, { act: 'restored', skill: p.name, by: 'you', mode: 'manual', kind: p.kind, from: p.from }, now)
  return { ok: true, name: p.name }
})

/** Takes the last change of this skill back. An improvement goes back one version; an acceptance removes the skill (see below). */
export const undoAccept = ({ dsh, name, now = Date.now() }) => withLedger(dsh, async (ledger) => {
  const l = ledger.learned[String(name)]
  if (l === undefined) return { ok: false, error: 'not_found' }
  const done = l.history.length > 0 ? revertImproveIn(dsh, ledger, String(name), { now, why: 'person' }) : undoCreateIn(dsh, ledger, String(name), { now, why: 'person' })
  if (done.ok === true && done.autoUndone === true) breakerCheck(dsh, now)
  return done
})

/** « What the person undid » → the note of the journal line: `undid_auto` is an undo of something Kaby did on its own (it counts toward the circuit breaker). */
const noteOf = (autoChange, why) => (why === 'stopped' ? 'stopped' : (autoChange ? 'undid_auto' : 'taken_back'))

/**
 * Takes an acceptance back: the skill's folder goes only if SKILL.md is still the very text that was written (a skill the person has edited
 * since is theirs: `edited_since`), and the proposal returns to the list. Journaled as « reverted ».
 */
function undoCreateIn (dsh, ledger, name, { now, why }) {
  const l = ledger.learned[name]
  if (l === undefined) return { ok: false, error: 'not_found' }
  if (l.legacy === true || l.sha === null) return { ok: false, error: 'not_undoable' }
  let text = null
  try { text = readFileSync(skillFile(dsh, name), 'utf8') } catch (e) { return { ok: false, error: 'edited_since' } }
  if (sha(text) !== l.sha) return { ok: false, error: 'edited_since' }
  try { rmSync(join(skillsDir(dsh), name), { recursive: true, force: false }) } catch (e) { return { ok: false, error: 'delete_failed' } }
  const autoChange = l.by === 'kaby' && l.mode === 'auto'
  delete ledger.learned[name]
  if (l.proposal !== null && ledger.proposals.length < LEARNED_LIMITS.maxPending) ledger.proposals.unshift({ ...l.proposal, createdAt: iso(now) })
  appendAudit(dsh, { act: 'reverted', skill: name, by: 'you', mode: 'manual', kind: l.kind, ver: l.ver, note: noteOf(autoChange, why) }, now)
  return { ok: true, name, autoUndone: autoChange && why !== 'stopped' }
}

// ── improving a skill Kaby made ─────────────────────────────────────────────────────────────────────────────────────────────────
/** The paragraph goes in a section « Additions », before the standard rules, as one bullet. Everything else of the file stays as it was. */
export const insertAddition = (text, add) => {
  const bullet = '- ' + oneLine(add, LEARNED_LIMITS.addMax)
  const trimEnd = (t) => t.replace(/\s+$/, '')
  const m = text.indexOf('\n## Additions\n')
  if (m >= 0) {
    const next = text.indexOf('\n## ', m + 5)
    const end = next < 0 ? text.length : next
    return trimEnd(text.slice(0, end)) + '\n' + bullet + '\n' + text.slice(end)
  }
  const r = text.indexOf('\n## Rules')
  if (r >= 0) return trimEnd(text.slice(0, r)) + '\n\n## Additions\n\n' + bullet + '\n' + text.slice(r)
  return trimEnd(text) + '\n\n## Additions\n\n' + bullet + '\n'
}

/** Writes an improvement. `by`/`mode`: the person's Accept (you, approved) or Kaby's own (kaby, auto, with the score). Refuses a skill that was not made by Kaby or was edited since. */
function applyImprove (dsh, ledger, p, { by, mode, score = null, signals = null, now }) {
  const l = ledger.learned[p.target]
  if (l === undefined || l.legacy === true || l.sha === null) return { ok: false, error: 'not_improvable' }
  let cur = null
  try { cur = readFileSync(skillFile(dsh, p.target), 'utf8') } catch (e) { return { ok: false, error: 'not_found' } }
  if (by === 'kaby' && sha(cur) !== l.sha) return { ok: false, error: 'edited_since' }
  const next = insertAddition(cur, p.add)
  if (next.length > LEARNED_LIMITS.sizeMax * 2) return { ok: false, error: 'checks_failed', checks: ['size'], hits: 0 }
  try { writeAtomic(skillFile(dsh, p.target), next, 0o644) } catch (e) { return { ok: false, error: 'write_failed', dest: join(skillsDir(dsh)) } }
  const from = l.ver
  l.ver += 1
  l.sha = sha(next)
  l.history.push({ ver: l.ver, at: iso(now), by, mode, sha: l.sha, add: p.add })
  if (l.history.length > 20) l.history.splice(0, l.history.length - 20)
  if (by === 'kaby') { l.reviewed = false; l.score = score }
  snapshot(dsh, p.target, l.ver, next, now)
  ledger.proposals = ledger.proposals.filter((x) => x.id !== p.id)
  appendAudit(dsh, { act: 'improved', skill: p.target, by, mode, kind: 'improve', ver: l.ver, from: { improve: { from, to: l.ver, add: p.add, reason: p.reason } }, score: by === 'kaby' ? score : undefined, sig: by === 'kaby' ? signals : undefined }, now)
  return { ok: true, name: p.target, ver: l.ver }
}

/** Puts the skill back to the version before its last improvement, if the file is still the text that improvement wrote. */
function revertImproveIn (dsh, ledger, name, { now, why }) {
  const l = ledger.learned[name]
  if (l === undefined || l.history.length === 0) return { ok: false, error: 'not_undoable' }
  const top = l.history[l.history.length - 1]
  let cur = null
  try { cur = readFileSync(skillFile(dsh, name), 'utf8') } catch (e) { return { ok: false, error: 'edited_since' } }
  if (sha(cur) !== l.sha) return { ok: false, error: 'edited_since' }
  let prev = null
  try { prev = readFileSync(join(versionsDir(dsh), name, String(top.ver - 1) + '.md'), 'utf8') } catch (e) { return { ok: false, error: 'not_undoable' } }
  try { writeAtomic(skillFile(dsh, name), prev, 0o644) } catch (e) { return { ok: false, error: 'write_failed', dest: join(skillsDir(dsh)) } }
  l.history.pop()
  l.ver = top.ver - 1
  l.sha = sha(prev)
  l.reviewed = !l.history.some((h) => h.by === 'kaby')
  const autoChange = top.by === 'kaby' && top.mode === 'auto'
  appendAudit(dsh, { act: 'reverted', skill: name, by: 'you', mode: 'manual', kind: l.kind, ver: l.ver, note: noteOf(autoChange, why) }, now)
  return { ok: true, name, ver: l.ver, autoUndone: autoChange && why !== 'stopped' }
}

/** Applies a suggestion on Kaby's word when nothing stops it (`a.stops` empty); otherwise leaves it waiting. */
function applyIfAllowed (dsh, ledger, p, a, { existing, now }) {
  if (a.stops.length > 0) return { applied: false }
  const opts = { by: 'kaby', mode: 'auto', score: a.score.total, signals: sigOf(a.score), now }
  if (p.kind === 'improve') { const done = applyImprove(dsh, ledger, p, opts); return done.ok ? { applied: true, name: done.name, ver: done.ver } : { applied: false, error: done.error } }
  const done = acceptInLedger(dsh, ledger, p.id, {}, { ...opts, existing })
  return done.ok ? { applied: true, name: done.name } : { applied: false, error: done.error }
}

/**
 * The circuit breaker: two of Kaby's own changes undone in a week and Kaby goes back to « Ask me every time », with a note on the settings page and a line in the journal.
 * Returns true when it tripped.
 */
function breakerCheck (dsh, now) {
  const settings = readSettings(dsh)
  if (settings.mode === 'ask') return false
  const undone = journalEntries(dsh).filter((e) => e.act === 'reverted' && e.note === 'undid_auto' && at(e) >= now - LEARNED_LIMITS.weekDays * DAY).length
  if (undone < 2) return false
  writeSettings(dsh, { ...settings, mode: 'ask', breaker: iso(now) })
  appendAudit(dsh, { act: 'paused', skill: '—', by: 'kaby', mode: 'auto', note: 'two_undos' }, now)
  return true
}

/** The person has looked at what Kaby did on its own and keeps it: it stops asking for a look. */
export const keepChange = ({ dsh, name, now = Date.now() }) => withLedger(dsh, async (ledger) => {
  const l = ledger.learned[String(name)]
  if (l === undefined) return { ok: false, error: 'not_found' }
  if (l.reviewed === true) return { ok: true, name: String(name) }
  l.reviewed = true
  appendAudit(dsh, { act: 'reviewed', skill: String(name), by: 'you', mode: 'manual', kind: l.kind, ver: l.ver }, now)
  return { ok: true, name: String(name) }
})

/** « Stop and undo the last 7 days »: every change Kaby made on its own that still stands and was not edited since goes back, and the level returns to « ask ». */
export const stopAll = ({ dsh, now = Date.now() }) => withLedger(dsh, async (ledger) => {
  const since = now - LEARNED_LIMITS.weekDays * DAY
  const names = [...new Set(journalEntries(dsh).filter((e) => e.by === 'kaby' && e.mode === 'auto' && (e.act === 'created' || e.act === 'improved') && at(e) >= since).map((e) => e.skill))]
  let undone = 0; let skipped = 0
  for (const name of names) {
    let l = ledger.learned[name]
    for (let i = 0; l !== undefined && l.history.length > 0 && l.history[l.history.length - 1].by === 'kaby' && l.history[l.history.length - 1].mode === 'auto' && i < 20; i += 1) {
      const done = revertImproveIn(dsh, ledger, name, { now, why: 'stopped' })
      if (done.ok === true) undone += 1; else { skipped += 1; break }
    }
    l = ledger.learned[name]
    if (l !== undefined && l.history.length === 0 && l.by === 'kaby' && l.mode === 'auto' && (Date.parse(l.acceptedAt) || 0) >= since) {
      const done = undoCreateIn(dsh, ledger, name, { now, why: 'stopped' })
      if (done.ok === true) undone += 1; else skipped += 1
    }
  }
  const settings = readSettings(dsh)
  if (settings.mode !== 'ask') writeSettings(dsh, { ...settings, mode: 'ask', breaker: null })
  appendAudit(dsh, { act: 'paused', skill: '—', by: 'you', mode: 'manual', note: 'stopped' }, now)
  return { ok: true, undone, skipped }
})

/** The person changed a setting (level, line, limit, notice, unlock): the new settings, and a line in the journal. */
export const patchSettings = ({ dsh, patch, now = Date.now() }) => withLedger(dsh, async () => {
  const cur = readSettings(dsh)
  const done = applySettings(cur, patch, { sensitive: isSensitive(dsh) })
  if (done.ok !== true) return done
  if (JSON.stringify(done.state) !== JSON.stringify(cur)) {
    writeSettings(dsh, done.state)
    appendAudit(dsh, { act: 'settings', skill: '—', by: 'you', mode: 'manual', from: { settings: settingsView(done.state) } }, now)
  }
  return { ok: true, settings: settingsView(done.state), sensitive: isSensitive(dsh) }
})
export const getSettings = ({ dsh }) => ({ ok: true, settings: settingsView(readSettings(dsh)), sensitive: isSensitive(dsh), ranges: { modes: MODES, threshold: THRESHOLD, caps: CAPS, notify: NOTIFY } })

// ── what the agent proposes ──────────────────────────────────────────────────────────────────────────────────────────────────
const clean = (v, max) => String(typeof v === 'string' ? v : '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ' ').replace(/\r\n?/g, '\n').trim().slice(0, max)

/**
 * A skill the agent proposes after the person asked it to remember how to do something (`skill_propose`). The text is the agent's own, so it is checked here, scored by rules
 * and, only if the settings allow and no hard stop applies, applied on Kaby's word; otherwise it waits for the person. A failing check answers `checks_failed`
 * (the agent fixes its call): a broken suggestion is never left in the list.
 */
export const proposeFromAsked = ({ dsh, name, description, steps, sessionId, existing = [], now = Date.now() }) => withLedger(dsh, async (ledger) => {
  sweep(dsh, ledger, now)
  const desc = oneLine(description, LEARNED_LIMITS.descriptionMax)
  const text = clean(steps, LEARNED_LIMITS.bodyMax)
  const base = slugOf(name !== undefined && String(name).trim() !== '' ? name : desc.replace(/\bUse when\b.*$/i, '')) || 'skill'
  if (ledger.proposals.length >= LEARNED_LIMITS.maxPending) return { ok: false, error: 'too_many_pending', max: LEARNED_LIMITS.maxPending }
  const src = sourceOf(dsh, sessionId)
  const draft = { name: base, kind: 'asked', description: desc, body: text.startsWith('#') ? text : '# ' + base.replace(/-/g, ' ') + '\n\n' + text, from: { sessionId: oneLine(sessionId, 80), asked: true }, source: { sessionId: oneLine(sessionId, 80), tracked: src.tracked, tainted: src.tainted, tool: src.tool } }
  const sensitive = isSensitive(dsh)
  const checks = checkProposal(draft, { existing, sensitive })
  if (checks.blocking) return { ok: false, error: 'checks_failed', checks: checks.list.filter((c) => c.s === 'bad').map((c) => c.id), hits: checks.hits.length }
  const made = addProposal(dsh, ledger, draft, now)
  if (made.ok !== true) return made
  const a = assess(dsh, ledger, made.proposal, { existing, settings: readSettings(dsh), sensitive, entries: journalEntries(dsh), now })
  const applied = applyIfAllowed(dsh, ledger, made.proposal, a, { existing, now })
  if (applied.applied === true) return { ok: true, state: 'applied', name: applied.name, score: a.score.total, stops: [] }
  return { ok: true, state: 'pending', name: made.proposal.name, id: made.proposal.id, score: a.score.total, stops: a.stops }
})

/** An improvement of a skill Kaby made (`skill_improve`): one paragraph added to it. Same checks, score and hard stops as a new skill (a skill the person edited is never changed on Kaby's word). */
export const proposeImprove = ({ dsh, skill, add, reason, sessionId, existing = [], now = Date.now() }) => withLedger(dsh, async (ledger) => {
  sweep(dsh, ledger, now)
  const target = String(skill === undefined ? '' : skill).trim()
  const l = ledger.learned[target]
  if (l === undefined || l.legacy === true || l.sha === null) return { ok: false, error: 'not_improvable' }
  const paragraph = oneLine(add, LEARNED_LIMITS.addMax)
  if (paragraph.length < LEARNED_LIMITS.addMin) return { ok: false, error: 'checks_failed', checks: ['size'], hits: 0 }
  if (ledger.proposals.some((p) => p.kind === 'improve' && p.target === target && p.add === paragraph)) return { ok: false, error: 'already_proposed' }
  if (ledger.proposals.length >= LEARNED_LIMITS.maxPending) return { ok: false, error: 'too_many_pending', max: LEARNED_LIMITS.maxPending }
  const src = sourceOf(dsh, sessionId)
  const id = 'p_' + randomBytes(4).toString('hex')
  const prop = normProposal({ id, name: target, kind: 'improve', createdAt: iso(now), description: '', body: '', target, add: paragraph, reason, baseVer: l.ver, from: { sessionId: oneLine(sessionId, 80), improve: true }, source: { sessionId: oneLine(sessionId, 80), tracked: src.tracked, tainted: src.tainted, tool: src.tool } })
  const sensitive = isSensitive(dsh)
  const checks = checkProposal(checkable(prop), { sensitive })
  if (checks.blocking) return { ok: false, error: 'checks_failed', checks: checks.list.filter((c) => c.s === 'bad').map((c) => c.id), hits: checks.hits.length }
  ledger.proposals.unshift(prop)
  appendAudit(dsh, { act: 'proposed', skill: target, by: 'kaby', mode: 'approved', kind: 'improve', ver: l.ver, from: { improve: { from: l.ver, add: paragraph, reason: prop.reason } } }, now)
  const a = assess(dsh, ledger, prop, { existing, settings: readSettings(dsh), sensitive, entries: journalEntries(dsh), now })
  const applied = applyIfAllowed(dsh, ledger, prop, a, { existing, now })
  if (applied.applied === true) return { ok: true, state: 'applied', name: target, ver: applied.ver, score: a.score.total, stops: [] }
  return { ok: true, state: 'pending', name: target, id: prop.id, score: a.score.total, stops: a.stops }
})

// ── use ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** A chat loaded this skill (the `skill` tool, seen on `tools/pre-execute`): one use per chat. Counts only skills Kaby learned. */
export const recordUse = ({ dsh, name, sessionId, now = Date.now() }) => withLedger(dsh, async (ledger) => {
  const l = ledger.learned[String(name)]
  const sid = oneLine(sessionId, 80)
  if (l === undefined || sid === '') return { ok: false, counted: false }
  if (l.usedIn.indexOf(sid) >= 0) return { ok: true, counted: false }
  l.usedIn = l.usedIn.concat([sid]).slice(-LEARNED_LIMITS.usedInKept)
  l.uses += 1
  l.lastUsed = iso(now)
  return { ok: true, counted: true, uses: l.uses }
})

/** What happened to skills in one chat: what Kaby suggested from it, what it applied, and what it loaded there (for the Summary tab). */
export const sessionView = ({ dsh, sessionId, existing = [], now = Date.now() }) => withLedger(dsh, async (ledger) => {
  const sid = oneLine(sessionId, 80)
  if (sid === '') return { ok: true, suggested: [], applied: [], used: [] }
  const sensitive = isSensitive(dsh)
  const settings = readSettings(dsh)
  const entries = journalEntries(dsh)
  return {
    ok: true,
    suggested: ledger.proposals.filter((p) => p.source !== null && p.source.sessionId === sid).map((p) => { const v = proposalView(p, { existing, sensitive }, assess(dsh, ledger, p, { existing, settings, sensitive, entries, now })); return { id: v.id, name: v.name, kind: v.kind, description: v.kind === 'improve' ? v.add : v.description, score: v.score.total, stops: v.stops, createdAt: v.createdAt } }),
    applied: Object.keys(ledger.learned).filter((n) => ledger.learned[n].sessionId === sid).map((n) => ({ name: n, ver: ledger.learned[n].ver, score: ledger.learned[n].score, reviewed: ledger.learned[n].reviewed, auto: ledger.learned[n].by === 'kaby' && ledger.learned[n].mode === 'auto', at: ledger.learned[n].acceptedAt })),
    used: Object.keys(ledger.learned).filter((n) => ledger.learned[n].usedIn.indexOf(sid) >= 0).map((n) => ({ name: n, uses: ledger.learned[n].uses }))
  }
})
