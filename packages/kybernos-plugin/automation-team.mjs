// Team automations, the local half (docs/dev/team-automations-contract.md, piece 2). Pure: no file, no clock, no random, no network. The host (index.js) hands in
// the stored task, the sanitized values and the moment; it applies what comes back inside the task store's own serialized write. So the tests drive the code
// production runs.
//
// A Team automation is a DEFINITION (key, name, description, prompt, schedule, needs) with a `version`: the SHA-256 of its canonical form. A member installs it as
// an ordinary, paused automation of their own and the copy carries one more field, the mark:
//
//   team: { workspaceId, id, key, version, installedAt, base: { name, prompt, schedule, needs }, contentHash }
//
// `base` is the definition as installed (the member's own record of it: a retired version is no longer served to members, so « changes since v3 » is computed
// from it). `contentHash` is the hash of `base`; a copy is EDITED when the hash of the same four fields as they are now differs. The mark rides on the task
// object and survives every ordinary edit: the sanitizer never produces a `team` field, and the update path merges onto the stored task.

import { createHash } from 'node:crypto'

export const KEY_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const NEED_RE = /^[a-z0-9_-]{2,40}$/
export const WORKSPACE_ID_RE = /^[A-Za-z0-9_.:@-]{1,160}$/
// Five whitespace-separated fields made of digits, `*`, `/`, `,`, `-` and letters, at most 100 characters: the server's shape check. The host parses the expression for real.
const CRON_FIELD_RE = /^[0-9*/,A-Za-z-]+$/
export const LIMITS = { key: 64, name: 120, description: 500, prompt: 8000, cron: 100, needs: 6, describe: 200 }
const MINE = ' (mine)'

const isObj = (v) => v !== null && typeof v === 'object' && Array.isArray(v) !== true
// A half of a surrogate pair or a NUL is not text.
const BINARY_RE = /\u0000|[\ud800-\udbff](?![\udc00-\udfff])|(?:^|[^\ud800-\udbff])[\udc00-\udfff]/
const ZERO_WIDTH_RE = /[\u200b-\u200f\u2060\ufeff]/g
// A string cut at `max` code units never ends on half of a surrogate pair (the sanitizer's own rule).
const clip = (value, max) => {
  const out = value.slice(0, max)
  const last = out.charCodeAt(out.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? out.slice(0, -1) : out
}
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex')
const normCron = (cron) => String(cron === undefined || cron === null ? '' : cron).trim().split(/\s+/).join(' ')

// Is this (already normalised) cron of the shape the server accepts?
const validCron = (cron) => {
  const fields = String(cron).split(/\s+/)
  return fields.length === 5 && fields.every((f) => CRON_FIELD_RE.test(f) === true)
}

/** The apps a definition needs: valid slugs only, unique, sorted, at most six. */
export const needsOf = (list) => Array.from(new Set((Array.isArray(list) === true ? list : []).filter((x) => typeof x === 'string' && NEED_RE.test(x) === true))).sort().slice(0, LIMITS.needs)

/** `{ mode: 'cron', cron }` or `{ mode: 'webhook' }` (the contract's canonical schedule: no zone), another mode as `{ mode }` so that a changed copy reads as changed. */
export const scheduleOf = (schedule) => {
  const sc = isObj(schedule) ? schedule : {}
  if (sc.mode === 'cron') return { mode: 'cron', cron: normCron(sc.cron) }
  if (sc.mode === 'webhook') return { mode: 'webhook' }
  return { mode: typeof sc.mode === 'string' && sc.mode !== '' ? sc.mode : 'once' }
}

/**
 * The canonical form of a definition: the UTF-8 bytes of `JSON.stringify({ key, name, description, prompt, schedule, needs })`, keys in that order, `name`,
 * `description` and `prompt` trimmed (the contract's « Trimming and the note »: what is validated, stored and hashed is the trimmed text), the schedule
 * as `{ mode, cron? }` with the fields joined by one space, `needs` sorted. null when the definition is not made of the right types.
 */
export const canonicalOf = (def) => {
  if (!isObj(def)) return null
  for (const k of ['key', 'name', 'description', 'prompt']) { if (typeof def[k] !== 'string') return null }
  if (isObj(def.schedule) !== true || (def.schedule.mode !== 'cron' && def.schedule.mode !== 'webhook')) return null
  if (def.schedule.mode === 'cron' && typeof def.schedule.cron !== 'string') return null
  if (Array.isArray(def.needs) !== true || def.needs.some((x) => typeof x !== 'string')) return null
  return JSON.stringify({ key: def.key, name: def.name.trim(), description: def.description.trim(), prompt: def.prompt.trim(), schedule: scheduleOf(def.schedule), needs: def.needs.slice().sort() })
}

/** SHA-256 (hex) of the canonical form, or null when the definition has no canonical form. */
export const versionOf = (def) => {
  const canon = canonicalOf(def)
  return canon === null ? null : sha256(canon)
}

/** The key a name gets: accents removed, lower case, every other run of characters one `-`, at most 64 characters. A name with nothing left (only symbols or another script) gets `automation-` and six hex digits of its hash. */
export const slugKey = (name) => {
  const text = String(name === undefined || name === null ? '' : name)
  const slug = clip(text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''), LIMITS.key).replace(/-+$/, '')
  return slug !== '' ? slug : 'automation-' + sha256(text).slice(0, 6)
}

/** The description the Propose sheet pre-fills: the first sentence of the prompt (its first line, up to the first full stop), at most 200 characters, cut on a word. */
export const describeFrom = (prompt) => {
  const lines = String(prompt === undefined || prompt === null ? '' : prompt).split(/\r\n|\r|\n/).map((l) => l.trim()).filter((l) => l !== '')
  if (lines.length === 0) return ''
  const bare = lines[0].replace(/^(?:#{1,6}|[-*>]+|\d+[.)])\s+/, '').replace(/\s+/g, ' ').trim()
  let line = bare !== '' ? bare : lines[0].replace(/\s+/g, ' ')
  const end = /[.!?\u2026](?=\s|$)|[\u3002\uff01\uff1f]/.exec(line)
  if (end !== null) line = line.slice(0, end.index + 1)
  if (line.length <= LIMITS.describe) return line
  // Over the cap: room for the ellipsis, then back to the last space (a word is never cut) unless there is none (a script without spaces).
  let cut = clip(line, LIMITS.describe - 1)
  const space = cut.lastIndexOf(' ')
  if (line.charAt(cut.length) !== ' ' && space > 0) cut = cut.slice(0, space)
  return cut.replace(/[\s,;:\-\u2013\u2014]+$/, '') + '\u2026'
}

/** The four fields a copy is judged on, as they are now: `{ name, prompt, schedule: { mode, cron? }, needs }`. */
export const baseOf = (like) => {
  const t = isObj(like) ? like : {}
  return { name: typeof t.name === 'string' ? t.name : '', prompt: typeof t.prompt === 'string' ? t.prompt : '', schedule: scheduleOf(t.schedule), needs: needsOf(t.needs) }
}

/** SHA-256 (hex) of the canonical JSON of `{ name, prompt, schedule: { mode, cron? }, needs }`, `needs` sorted. */
export const contentHashOf = (like) => sha256(JSON.stringify(baseOf(like)))

const isMark = (m) => isObj(m) && typeof m.workspaceId === 'string' && typeof m.key === 'string' && typeof m.version === 'string' && isObj(m.base)

/** True when the task is a copy of a team automation and its four fields are no longer the ones it was installed with (a mark with no usable hash counts as edited: nothing is overwritten on a guess). */
export const isEdited = (task) => isObj(task) && isMark(task.team) && contentHashOf(task) !== task.team.contentHash

/** What the page needs to know about a copy's origin: `{ workspaceId, id, key, version, edited }`, or null when the task is not a team copy. */
export const teamInfoOf = (task) => (isObj(task) && isMark(task.team)
  ? { workspaceId: task.team.workspaceId, id: task.team.id, key: task.team.key, version: task.team.version, edited: isEdited(task) }
  : null)

/** One row of `team-copies` for a task, or null when it is not a team copy. */
export const copyRowOf = (task, missingApps) => {
  const info = teamInfoOf(task)
  return info === null ? null : Object.assign({ taskId: task.id }, info, { missingApps: Array.isArray(missingApps) ? missingApps : [] })
}

/** The apps a definition needs that are not connected. `connected` is a list of slugs, or null when the host cannot know: then nothing is said to be missing. */
export const missingAppsOf = (needs, connected) => (Array.isArray(connected) === true ? needsOf(needs).filter((slug) => connected.indexOf(slug) < 0) : [])

/**
 * An automation of the person, as a proposal for the team: `{ ok: true, proposal }` or `{ ok: false, error }` with `error` one of once_not_shareable,
 * empty_prompt, invalid_schedule. A copy of a team automation proposes under its own `key` (that is what makes it an update of the same one). The proposal holds the
 * contract's fields and nothing else: no `runsOn`, state, notification choice, id, history, webhook address or secret, workspace, session or approval mode.
 */
export const packOf = (task) => {
  if (!isObj(task)) return { ok: false, error: 'not_found' }
  const sc = isObj(task.schedule) ? task.schedule : {}
  if (sc.mode !== 'cron' && sc.mode !== 'webhook') return { ok: false, error: 'once_not_shareable' }
  // Trimmed again after the cut: a cut that lands on a space must not leave one at the end.
  const prompt = clip((typeof task.prompt === 'string' ? task.prompt : '').trim(), LIMITS.prompt).trim()
  if (prompt === '') return { ok: false, error: 'empty_prompt' }
  const schedule = scheduleOf(sc)
  if (schedule.mode === 'cron' && (schedule.cron.length > LIMITS.cron || validCron(schedule.cron) !== true)) return { ok: false, error: 'invalid_schedule' }
  const named = clip((typeof task.name === 'string' ? task.name : '').trim(), LIMITS.name).trim()
  const name = named.replace(ZERO_WIDTH_RE, '') === '' ? 'Automation' : named
  const proposal = {
    key: isMark(task.team) && KEY_RE.test(task.team.key) === true ? task.team.key : slugKey(name),
    name,
    description: describeFrom(prompt) || name,
    prompt,
    schedule,
    needs: needsOf(task.needs),
  }
  proposal.version = versionOf(proposal)
  return { ok: true, proposal }
}

const bad = (reason, field) => ({ ok: false, reason, field })

/**
 * The contract's rules on a definition, at the level of shape: `{ ok: true, definition }` (`name`, `description` and `prompt` trimmed, `needs` sorted, `id` a number) or `{ ok: false, reason, field }` with `reason`
 * one of id, key, name, description, prompt, schedule, needs, binary. The cron is parsed for real by the host; the `version` is checked by `versionOf`.
 */
export const validateDefinition = (def) => {
  if (!isObj(def)) return bad('key', 'definition')
  const id = typeof def.id === 'string' && /^[0-9]{1,15}$/.test(def.id) === true ? Number(def.id) : def.id
  if (Number.isSafeInteger(id) !== true || id < 1) return bad('id', 'id')
  if (typeof def.key !== 'string' || def.key.length === 0 || def.key.length > LIMITS.key || KEY_RE.test(def.key) !== true) return bad('key', 'key')
  for (const f of ['name', 'description', 'prompt']) {
    if (typeof def[f] !== 'string') return bad(f, f)
    if (BINARY_RE.test(def[f]) === true) return bad('binary', f)
  }
  const name = def.name.trim()
  if (name.length === 0 || name.length > LIMITS.name || name.replace(ZERO_WIDTH_RE, '').length === 0) return bad('name', 'name')
  const description = def.description.trim()
  if (description.length === 0 || description.length > LIMITS.description) return bad('description', 'description')
  const prompt = def.prompt.trim()
  if (prompt.length === 0 || prompt.length > LIMITS.prompt) return bad('prompt', 'prompt')
  const sc = def.schedule
  if (isObj(sc) !== true) return bad('schedule', 'schedule')
  const keys = Object.keys(sc)
  if (sc.mode === 'webhook') {
    if (keys.length !== 1) return bad('schedule', 'schedule')
  } else if (sc.mode === 'cron') {
    // A time zone (or anything else) sent with the schedule is refused: the cron is read in the installer's own zone.
    if (keys.some((k) => k !== 'mode' && k !== 'cron') || typeof sc.cron !== 'string' || sc.cron.length > LIMITS.cron || validCron(normCron(sc.cron)) !== true) return bad('schedule', 'schedule')
  } else return bad('schedule', 'schedule')
  if (Array.isArray(def.needs) !== true || def.needs.length > LIMITS.needs || def.needs.some((x) => typeof x !== 'string' || NEED_RE.test(x) !== true) || new Set(def.needs).size !== def.needs.length) return bad('needs', 'needs')
  return {
    ok: true,
    definition: { id, key: def.key, name, description, prompt, schedule: scheduleOf(sc), needs: def.needs.slice().sort(), version: def.version },
  }
}

/** The mark of a copy: where it came from, and the definition as it is stored (so a copy that was just installed reads as not edited). `from`: `{ workspaceId, id, key, version, installedAt }`. */
export const markOf = (from, stored) => {
  const base = baseOf(stored)
  return { workspaceId: from.workspaceId, id: from.id, key: from.key, version: from.version, installedAt: from.installedAt, base, contentHash: sha256(JSON.stringify(base)) }
}

/** Does the schedule of this copy still follow the team's? Only when it is the one it was installed with (`team.base`): a person's own rhythm is never overwritten. */
export const scheduleFollows = (task) => {
  const base = isObj(task) && isMark(task.team) && isObj(task.team.base) ? task.team.base : null
  if (base === null || isObj(base.schedule) !== true) return false
  return JSON.stringify(scheduleOf(task.schedule)) === JSON.stringify(scheduleOf(base.schedule))
}

/**
 * What an update asks, before anything is written: `{ ok: true, keep: true }` (nothing to change), `{ ok: true, keep: false, both, followsSchedule }`, or
 * `{ ok: false, error }` with `error` one of not_a_team_copy, invalid_mode, key_mismatch, not_edited. An unedited copy accepts `replace` only.
 */
export const planUpdate = (task, def, mode) => {
  if (isObj(task) !== true || isMark(task.team) !== true) return { ok: false, error: 'not_a_team_copy' }
  if (mode !== 'keep' && mode !== 'both' && mode !== 'replace') return { ok: false, error: 'invalid_mode' }
  if (isObj(def) !== true || def.key !== task.team.key) return { ok: false, error: 'key_mismatch' }
  if (mode !== 'replace' && isEdited(task) !== true) return { ok: false, error: 'not_edited' }
  if (mode === 'keep') return { ok: true, keep: true }
  return { ok: true, keep: false, both: mode === 'both', followsSchedule: scheduleFollows(task) }
}

/**
 * `replace`: the task with the team's name, prompt and needs, and its schedule only when `follows`; active state, place, approval mode, notifications, history and
 * the webhook stay as they are. `clean` is what the sanitizer made of the definition (`name`, `prompt`, `needs`, `schedule`); the mark moves to the new version, with the
 * definition as `base` (even where the schedule did not follow, so the person's own rhythm keeps reading as a change). Returns a new object; `nextRun` is the host's to recompute.
 */
export const replaceTask = (task, def, clean, follows, nowIso) => {
  const merged = Object.assign({}, task, { name: clean.name, prompt: clean.prompt, needs: clean.needs, updatedAt: nowIso })
  if (follows === true) merged.schedule = clean.schedule
  merged.team = markOf({ workspaceId: task.team.workspaceId, id: def.id, key: task.team.key, version: def.version, installedAt: nowIso }, { name: clean.name, prompt: clean.prompt, schedule: def.schedule, needs: clean.needs })
  return merged
}

/** `both`: the copy as the person has it, kept as a separate paused automation named « <name> (mine) » with no mark. Nothing that belongs to the original (history, home session, cloud link, webhook) comes along. */
export const mineOf = (task, id, nowIso) => {
  const name = clip(String(task.name === undefined || task.name === null ? '' : task.name).trim(), LIMITS.name - MINE.length).trimEnd() + MINE
  const out = { id, createdAt: nowIso, updatedAt: nowIso, history: [], lastRun: null, nextRun: null, name, prompt: task.prompt, schedule: JSON.parse(JSON.stringify(task.schedule)), runsOn: 'local', active: false, approvals: task.approvals === 'auto' ? 'auto' : 'ask' }
  if (Array.isArray(task.notify) === true) out.notify = task.notify.slice()
  if (Array.isArray(task.needs) === true) out.needs = task.needs.slice()
  if (typeof task.workspaceHint === 'string' && task.workspaceHint !== '') out.workspaceHint = task.workspaceHint
  return out
}
