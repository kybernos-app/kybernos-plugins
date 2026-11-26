// Team automations, the server half as this plugin sees it: where the routes are, the limits and the canonical form of a definition (so its `version`), and what a row or a
// refusal means. No network, no file: index.js makes the calls with the account token. The contract is docs/dev/team-automations-contract.md; turning a local automation into a
// proposal and installing a downloaded one is kybernos-plugin's business, this side only carries definitions to and from the server.
import { createHash } from 'node:crypto'

/** The Team automations routes of a workspace: `/v1/workspaces/{id}/automations`. */
export const teamAutomationsBase = (workspaceId) => '/v1/workspaces/' + encodeURIComponent(workspaceId) + '/automations'

/** An automation id as the server numbers them: a positive integer, no sign, no leading zero. */
export const isAutomationId = (v) => (typeof v === 'number' && Number.isSafeInteger(v) && v > 0) || (typeof v === 'string' && /^[1-9]\d{0,17}$/.test(v))

/** The limits of the contract. `noteMax` is ours: the contract sets none (the server cuts a note itself), this keeps the body far below the server's 128 KiB. */
export const TEAM_AUTOMATION_LIMITS = Object.freeze({ keyMax: 64, nameMax: 120, descriptionMax: 500, promptMax: 8000, cronMax: 100, needsMax: 6, noteMax: 2000 })

export const TEAM_AUTOMATION_VIEWS = Object.freeze(['approved', 'proposed', 'mine', 'all'])
const STATUSES = ['proposed', 'approved', 'rejected', 'retired']
/** The `reason` of an `invalid_automation`. */
const REASONS = ['key', 'name', 'description', 'prompt', 'schedule', 'needs', 'binary', 'hidden', 'too_large']
const SCAN_FIELDS = ['name', 'description', 'note', 'prompt']
const KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SLUG = /^[a-z0-9_-]{2,40}$/
const CRON_FIELD = /^[0-9*/,A-Za-z-]+$/
const VERSION = /^[0-9a-f]{64}$/

const isRow = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isString = (v) => typeof v === 'string'

/** Text in the contract's sense: no NUL and no half of a surrogate pair (it would not come back from UTF-8 as it went). Linear. */
const isText = (s) => {
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i)
    if (c === 0) return false
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) i += 1
      else return false
    } else if (c >= 0xdc00 && c <= 0xdfff) return false
  }
  return true
}

// What no person can see in a text, or what changes how it reads (decision DL-09 of the 2026-10 recette, finding L2-18): the tags block U+E0000-U+E007F, the direction controls
// U+202A-U+202E and U+2066-U+2069, U+200B, U+2060, the invisible operators U+2061-U+2064, U+206A-U+206F, U+FEFF anywhere (a BOM is not text), U+00AD, U+180E, U+FFF9-U+FFFB, the variation
// selectors U+E0100-U+E01EF, and the C0 and C1 controls except tab, line feed and carriage return (457 code points). REFUSED, never removed: the version is the SHA-256 of the exact text.
// Kept: U+200C and U+200D (emoji sequences, Persian), U+200E and U+200F (Arabic and Hebrew), U+FE0E and U+FE0F. The SAME set as the server (`src/lib/hidden-text.ts`) and the two other clients
// (`kybernos-plugin/automation-team.mjs`, `kybernos-skills/team-skills.mjs`); docs/dev/hidden-text-vectors.json is the list of texts all of them are tested against.
const HIDDEN_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00ad\u180e\u200b\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}]/u
const HIDDEN_ALL_RE = new RegExp(HIDDEN_RE.source, 'gu')
/** The refused characters of a text: `{ first: 'U+E0041', count }`, or null when it has none (or when `s` is not text). Linear. */
export const hiddenIn = (s) => {
  if (typeof s !== 'string' || !HIDDEN_RE.test(s)) return null
  const all = s.match(HIDDEN_ALL_RE)
  return { first: 'U+' + all[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0'), count: all.length }
}

/** True when nothing of `s` can be seen: only zero-width characters (the plugin's own rule for the name of an automation). */
const onlyZeroWidth = (s) => {
  for (const ch of s) {
    const cp = ch.codePointAt(0)
    if (!((cp >= 0x200b && cp <= 0x200f) || cp === 0x2060 || cp === 0xfeff)) return false
  }
  return true
}

const cronShape = (c) => {
  if (typeof c !== 'string' || c.length > TEAM_AUTOMATION_LIMITS.cronMax) return false
  const fields = c.trim().split(/\s+/)
  return fields.length === 5 && fields.every((f) => CRON_FIELD.test(f))
}

/** The schedule as the canonical form writes it (the cron on single spaces, nothing else), or null when it is neither a cron nor a webhook. */
const scheduleOf = (s) => {
  if (!isRow(s)) return null
  if (s.mode === 'webhook') return { mode: 'webhook' }
  if (s.mode === 'cron' && isString(s.cron)) return { mode: 'cron', cron: s.cron.trim().split(/\s+/).join(' ') }
  return null
}

/**
 * The six fields of a definition and nothing else, in the order of the canonical form, with the schedule rebuilt and the needs sorted: what is sent to the server and what the
 * version is computed over. Null when `d` cannot carry a canonical form at all (a field of the wrong type, a schedule that is neither a cron nor a webhook).
 */
export const definitionOf = (d) => {
  if (!isRow(d)) return null
  const schedule = scheduleOf(d.schedule)
  if (schedule === null || !Array.isArray(d.needs) || !d.needs.every(isString) || ![d.key, d.name, d.description, d.prompt].every(isString)) return null
  // name, description and prompt are trimmed before they are validated, sent and hashed (contract, « Trimming and the note »).
  return { key: d.key.trim(), name: d.name.trim(), description: d.description.trim(), prompt: d.prompt.trim(), schedule, needs: d.needs.slice().sort() }
}

/** The canonical form of the contract: `JSON.stringify` of `{ key, name, description, prompt, schedule, needs }` in that order, or null. */
export const canonicalOf = (d) => {
  const def = definitionOf(d)
  return def === null ? null : JSON.stringify(def)
}

/** The `version` of a definition: SHA-256 (hex) of the UTF-8 bytes of its canonical form, or null. What an admin approved is exactly what a member installs. */
export const versionOf = (d) => {
  const canonical = canonicalOf(d)
  return canonical === null ? null : createHash('sha256').update(canonical, 'utf8').digest('hex')
}

/**
 * A light look at a definition before anything leaves, so the page gets a clear word before the server's: null when it has the shape the contract asks for, else
 * `{ error: 'invalid_automation', reason }`. The server stays the judge (it also scans for secrets and knows the key's neighbours).
 */
export const teamAutomationShape = (d) => {
  const o = isRow(d) ? d : {}
  const L = TEAM_AUTOMATION_LIMITS
  const bad = (reason, field) => (field === undefined ? { error: 'invalid_automation', reason } : { error: 'invalid_automation', reason, field })
  if (!isString(o.key) || o.key.length > L.keyMax || !KEY.test(o.key)) return bad('key')
  const name = isString(o.name) ? o.name.trim() : ''
  if (name === '' || name.length > L.nameMax || !isText(name) || onlyZeroWidth(name)) return bad('name')
  const description = isString(o.description) ? o.description.trim() : ''
  if (description === '' || description.length > L.descriptionMax || !isText(description)) return bad('description')
  if (!isString(o.prompt) || o.prompt.trim() === '' || o.prompt.length > L.promptMax) return bad('prompt')
  if (!isText(o.prompt)) return bad('binary')
  // What no person can see (DL-09), in everything the members read or the copy runs, on the text as given (before the trim): refused here, so the page says so before the server does.
  const texts = [['name', o.name], ['description', o.description], ['prompt', o.prompt], ['note', o.note], ['schedule', isRow(o.schedule) ? o.schedule.cron : undefined]].concat(Array.isArray(o.needs) ? o.needs.map((n) => ['needs', n]) : [])
  for (const [field, text] of texts) {
    if (hiddenIn(text) !== null) return bad('hidden', field)
  }
  const s = o.schedule
  const keys = isRow(s) ? Object.keys(s).sort().join() : ''
  // A time zone, a date or any other field is a different kind of schedule: refused, not dropped.
  if (!(isRow(s) && ((s.mode === 'webhook' && keys === 'mode') || (s.mode === 'cron' && keys === 'cron,mode' && cronShape(s.cron))))) return bad('schedule')
  const needs = o.needs
  if (!Array.isArray(needs) || needs.length > L.needsMax || !needs.every((n) => isString(n) && SLUG.test(n)) || new Set(needs).size !== needs.length) return bad('needs')
  return null
}

const code = (body) => (isRow(body) && isString(body.error) ? body.error : '')
/** A short identifier of the server's answer, or undefined: its free text never passes. */
const word = (v) => (isString(v) && /^[a-z][a-z0-9_.[\]]{0,39}$/.test(v) ? v : undefined)
const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))

/**
 * What a failed call to the Team automations routes means, or null for a success: `{ error, ...details }` where `error` is one word the page translates. The server's own
 * text never reaches the page. A 404 that names neither the workspace nor the automation is a server that has no Team automations at all (an older or another server):
 * `not_on_this_server`, which the page shows as "not available here". A `403 plan_required` is the server's verdict on the plan; this side never guesses it from a plan's name.
 */
export const teamAutomationsFailure = (status, body) => {
  const c = code(body)
  if (status >= 200 && status < 300) return null
  if (status === 401) return { error: 'reconnect_required' }
  if (status === 0) return { error: 'network' }
  if (status === 404) return { error: c === 'Team automation not found' || c === 'Workspace not found' ? 'not_found' : 'not_on_this_server' }
  if (status === 403) {
    if (c === 'admin_required') return { error: 'admin_required' }
    if (c === 'plan_required') return defined({ error: 'plan_required', feature: word(body.feature) })
    return { error: 'forbidden' }
  }
  if (status === 409) {
    if (c === 'duplicate') return defined({ error: 'duplicate', id: isAutomationId(body.id) ? body.id : undefined, status: STATUSES.includes(body.status) ? body.status : undefined })
    if (c === 'team_full') return defined({ error: 'team_full', max: Number.isFinite(body.max) ? body.max : undefined })
    if (c === 'not_pending') return { error: 'not_pending' }
    if (c === 'not_approved') return { error: 'not_approved' }
    return { error: 'conflict' }
  }
  if (status === 413) return { error: 'too_large' }
  // Two different 429s: the cap of pending proposals (its own word) and the server's general rate limiter (`rate_limited`, or no word at all).
  if (status === 429) return c === 'too_many_proposals' ? defined({ error: 'too_many_proposals', max: isRow(body) && Number.isFinite(body.max) ? body.max : undefined }) : { error: 'rate_limited' }
  if (status === 400) {
    if (c === 'invalid_automation') return defined({ error: 'invalid_automation', reason: REASONS.includes(body.reason) ? body.reason : undefined, field: word(body.field) })
    // Where the secret is, never what it is: the field, and for the prompt the 1-based line.
    if (c === 'scan_rejected') return defined({ error: 'scan_rejected', field: SCAN_FIELDS.includes(body.field) ? body.field : undefined, line: Number.isInteger(body.line) && body.line >= 1 ? body.line : undefined })
    return { error: 'bad_request' }
  }
  return { error: 'refused_' + String(status) }
}

const num = (v) => (Number.isFinite(v) ? v : 0)
const str = (v) => (isString(v) ? v : null)
const idOr = (v) => (isAutomationId(v) ? v : null)

/** A server row → what the page uses. A list row has no prompt (`prompt` is undefined, `promptChars` says how long it is); a single automation carries it. Only the fields below pass. */
export const asTeamAutomation = (r) => {
  const row = isRow(r) ? r : {}
  const prompt = isString(row.prompt) ? row.prompt : undefined
  return {
    id: idOr(row.id),
    key: isString(row.key) ? row.key : '',
    name: isString(row.name) ? row.name : '',
    description: isString(row.description) ? row.description : '',
    version: isString(row.version) && VERSION.test(row.version) ? row.version : '',
    // The 1-based number of this version among the approved ones of the same key (contract: `revision`), for « v3 → v4 »; null on a proposal that is not approved yet.
    revision: Number.isInteger(row.revision) && row.revision > 0 ? row.revision : null,
    status: STATUSES.includes(row.status) ? row.status : null,
    schedule: scheduleOf(row.schedule),
    needs: Array.isArray(row.needs) ? row.needs.filter((n) => isString(n) && SLUG.test(n)) : [],
    // The server's own count wins; without it, what was actually read.
    promptChars: Number.isFinite(row.prompt_chars) ? row.prompt_chars : (prompt === undefined ? 0 : prompt.length),
    prompt,
    // True when the name, the description, the prompt or the remark holds a character a person cannot see (`hiddenIn`): a text approved before the server refused them. The review sheet must not call it « Checked ».
    hidden: [row.name, row.description, prompt, row.note].some((v) => hiddenIn(v) !== null),
    proposedName: str(row.proposed_by_name),
    proposedAt: str(row.proposed_at),
    reviewedName: str(row.reviewed_by_name),
    reviewedAt: str(row.reviewed_at),
    note: str(row.note),
    reviewNote: str(row.review_note),
    replaces: idOr(row.replaces),
    supersededBy: idOr(row.superseded_by),
    mine: row.mine === true,
  }
}

/** A list answer → the page of rows with its paging and counts, or null when the body is not one (no `automations` array). */
export const asTeamAutomationsPage = (b) => {
  if (!isRow(b) || !Array.isArray(b.automations)) return null
  const counts = isRow(b.counts) ? b.counts : {}
  return {
    role: isString(b.role) && /^[a-z_]{1,20}$/.test(b.role) ? b.role : null,
    view: TEAM_AUTOMATION_VIEWS.includes(b.view) ? b.view : null,
    total: num(b.total),
    limit: num(b.limit),
    offset: num(b.offset),
    counts: { approved: num(counts.approved), pending: num(counts.pending) },
    automations: b.automations.filter(isRow).map(asTeamAutomation),
  }
}

const ACTIONS = ['list', 'item', 'check', 'add', 'review', 'retire', 'delete']
const WHO = /^[A-Za-z0-9_.:-]{1,80}$/

/**
 * One line of the access journal (`team-automations-access.jsonl`): who, when, which action on which automation, how the server answered. A closed list of fields, each
 * cut to a short identifier, so that no name, prompt, description or note can get in. Null when the action is not one of ours.
 */
export const accessEntry = (f) => {
  const e = isRow(f) ? f : {}
  if (!ACTIONS.includes(e.action) || !isString(e.at)) return null
  return defined({
    at: e.at,
    user: isString(e.user) && WHO.test(e.user) ? e.user : null,
    workspace: isString(e.workspace) && WHO.test(e.workspace) ? e.workspace : null,
    action: e.action,
    id: isAutomationId(e.id) ? String(e.id) : undefined,
    view: TEAM_AUTOMATION_VIEWS.includes(e.view) ? e.view : undefined,
    decision: e.decision === 'approve' || e.decision === 'reject' ? e.decision : undefined,
    result: isString(e.result) && /^[a-z0-9_]{1,40}$/.test(e.result) ? e.result : 'unknown',
  })
}
