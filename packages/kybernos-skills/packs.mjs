// Integration packs, the pure half (docs/dev/integration-packs.md). A pack is a folder of plain text that teaches Kaby to work with one outside
// app: a manifest, a few skills, a few automations that are installed paused, the recipes that start them, and a plain statement of what
// Kaby never does with that app. This file says what a valid pack is and what installing it does; it reads no file and writes none. The host
// passes the files in and carries the plan out through injected functions, so every rule is testable on a bare object.
//
// A pack can never switch anything on. Its automations are created paused, asking first, and not callable by an assistant: the person turns
// those on, one by one. A pack also cannot carry a webhook secret, an approval mode or a script outside its skills.
import { findSecret, scriptFiles, validateTeamSkill } from './team-skills.mjs'

export const PACK_FORMAT = 1

export const PACK_LIMITS = Object.freeze({
  files: 120,
  fileBytes: 256 * 1024,
  totalBytes: 2 * 1024 * 1024,
  skills: 12,
  automations: 12,
  connectors: 8,
  never: 8,
  neverChars: 160,
  name: 80,
  description: 280,
  automationName: 120,
  automationPrompt: 8000,
  pathChars: 200
})

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const PATH_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_][A-Za-z0-9._-]*)*$/
const CONNECTOR_RE = /^[a-z0-9_]{1,40}$/
const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/
const TZ_RE = /^[A-Za-z0-9_+/-]{1,64}$/
// A name that is a Windows device cannot be a folder or a file there (a pack's names go to every machine).
const DEVICE_RE = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/
// What a one-line field may not hold: control characters, the two Unicode line separators (built from code points: a literal one inside a
// regex literal would end it), and the angle brackets that make text look like markup.
const NOT_ONE_LINE = new RegExp('[\\x00-\\x1f\\x7f<>' + String.fromCharCode(0x2028, 0x2029) + ']')
const MANIFEST_KEYS = ['format', 'id', 'name', 'version', 'description', 'host', 'needs', 'skills', 'automations', 'never', 'demo']
const AUTOMATION_KEYS = ['name', 'prompt', 'schedule']
const SCHEDULE_KEYS = ['mode', 'cron', 'tz']

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const fail = (reason, extra) => Object.assign({ ok: false, reason }, extra)
const oneLine = (v, max) => typeof v === 'string' && v.trim() !== '' && v.length <= max && !NOT_ONE_LINE.test(v)
const goodName = (v) => typeof v === 'string' && v.length <= 64 && NAME_RE.test(v) && !DEVICE_RE.test(v)

/** Pure. Where a path sits in a pack: `{ kind, id?, rest? }`, or null for a path a pack may not hold. */
const place = (path) => {
  if (path === 'pack.json') return { kind: 'manifest' }
  if (path === 'README.md' || path === 'demo.md') return { kind: 'doc' }
  let m = /^triggers\/([a-z0-9-]+)\.md$/.exec(path)
  if (m !== null && goodName(m[1])) return { kind: 'trigger', id: m[1] }
  m = /^automations\/([a-z0-9-]+)\.json$/.exec(path)
  if (m !== null && goodName(m[1])) return { kind: 'automation', id: m[1] }
  m = /^skills\/([a-z0-9-]+)\/(.+)$/.exec(path)
  if (m !== null && goodName(m[1])) return { kind: 'skill', id: m[1], rest: m[2] }
  return null
}

const readAutomation = (id, text) => {
  let raw = null
  try { raw = JSON.parse(text) } catch (e) { return fail('automation_json', { file: 'automations/' + id + '.json' }) }
  const file = 'automations/' + id + '.json'
  if (!plain(raw)) return fail('automation_json', { file })
  // Strict: a pack that tries to set `active`, `approvals`, `trigger` or `assistant` is refused whole, not trimmed.
  for (const key of Object.keys(raw)) if (AUTOMATION_KEYS.indexOf(key) < 0) return fail('automation_key', { file, key: key.slice(0, 40) })
  if (!oneLine(raw.name, PACK_LIMITS.automationName)) return fail('automation_name', { file })
  if (typeof raw.prompt !== 'string' || raw.prompt.trim() === '' || raw.prompt.length > PACK_LIMITS.automationPrompt) return fail('automation_prompt', { file })
  const sc = raw.schedule
  if (!plain(sc)) return fail('automation_schedule', { file })
  for (const key of Object.keys(sc)) if (SCHEDULE_KEYS.indexOf(key) < 0) return fail('automation_schedule', { file })
  // A date in the past helps nobody: a pack runs on a rhythm (cron) or when an event calls it (webhook). The host's own sanitiser checks the cron itself.
  if (sc.mode !== 'cron' && sc.mode !== 'webhook') return fail('automation_schedule', { file })
  if (sc.mode === 'cron' && !oneLine(sc.cron, 100)) return fail('automation_schedule', { file })
  if (sc.mode === 'webhook' && sc.cron !== undefined) return fail('automation_schedule', { file })
  if (sc.tz !== undefined && (typeof sc.tz !== 'string' || !TZ_RE.test(sc.tz))) return fail('automation_schedule', { file })
  const schedule = { mode: sc.mode }
  if (sc.mode === 'cron') schedule.cron = sc.cron.trim()
  if (sc.tz !== undefined) schedule.tz = sc.tz
  return { ok: true, id, task: { name: raw.name.trim(), prompt: raw.prompt.trim(), schedule } }
}

/**
 * Pure. `pack` is `{ files: [{ path, content }] }`. Returns `{ ok: true, id, name, version, description, host, connectors, never, skills,
 * automations, triggers, demo, bytes }` when the pack may be installed, else `{ ok: false, reason, file?, key? }`. The first problem found.
 * Reasons: no_manifest, too_many_files, bad_path, binary, file_too_large, too_large, scan_rejected, unexpected_file, manifest_json,
 * manifest_key, format, id, name, version, description, host, needs, skills, automations, never, demo, skill_<reason of a team skill>,
 * automation_json, automation_key, automation_name, automation_prompt, automation_schedule.
 */
export const validatePack = (pack) => {
  const files = plain(pack) && Array.isArray(pack.files) ? pack.files : []
  if (files.length === 0) return fail('no_manifest')
  if (files.length > PACK_LIMITS.files) return fail('too_many_files')
  const byPath = new Map()
  const folded = new Set()
  let bytes = 0
  for (const f of files) {
    if (!plain(f) || typeof f.path !== 'string' || typeof f.content !== 'string') return fail('bad_path')
    if (f.path.length > PACK_LIMITS.pathChars || !PATH_RE.test(f.path) || byPath.has(f.path) || folded.has(f.path.toLowerCase())) return fail('bad_path', { file: f.path.slice(0, PACK_LIMITS.pathChars) })
    if (f.content.indexOf('\u0000') >= 0) return fail('binary', { file: f.path })
    const size = Buffer.byteLength(f.content, 'utf8')
    if (size > PACK_LIMITS.fileBytes) return fail('file_too_large', { file: f.path })
    bytes += size
    byPath.set(f.path, f.content)
    folded.add(f.path.toLowerCase())
  }
  if (bytes > PACK_LIMITS.totalBytes) return fail('too_large')
  const secret = findSecret(files)
  if (secret !== null) return fail('scan_rejected', { file: secret.file, line: secret.line })
  const placed = new Map()
  for (const f of files) {
    const at = place(f.path)
    if (at === null) return fail('unexpected_file', { file: f.path })
    placed.set(f.path, at)
  }
  if (!byPath.has('pack.json')) return fail('no_manifest')

  let m = null
  try { m = JSON.parse(byPath.get('pack.json')) } catch (e) { return fail('manifest_json', { file: 'pack.json' }) }
  if (!plain(m)) return fail('manifest_json', { file: 'pack.json' })
  for (const key of Object.keys(m)) if (MANIFEST_KEYS.indexOf(key) < 0) return fail('manifest_key', { file: 'pack.json', key: key.slice(0, 40) })
  if (m.format !== PACK_FORMAT) return fail('format')
  if (!goodName(m.id)) return fail('id')
  if (!oneLine(m.name, PACK_LIMITS.name)) return fail('name')
  if (typeof m.version !== 'string' || !VERSION_RE.test(m.version)) return fail('version')
  if (!oneLine(m.description, PACK_LIMITS.description)) return fail('description')
  if (m.host !== undefined && !oneLine(m.host, PACK_LIMITS.name)) return fail('host')

  let connectors = []
  if (m.needs !== undefined) {
    if (!plain(m.needs) || Object.keys(m.needs).some((k) => k !== 'connectors')) return fail('needs')
    const list = m.needs.connectors
    if (!Array.isArray(list) || list.length > PACK_LIMITS.connectors || list.some((c) => typeof c !== 'string' || !CONNECTOR_RE.test(c)) || new Set(list).size !== list.length) return fail('needs')
    connectors = list.slice()
  }
  const names = (key, max) => {
    const list = m[key] === undefined ? [] : m[key]
    if (!Array.isArray(list) || list.length > max || list.some((n) => !goodName(n)) || new Set(list).size !== list.length) return null
    return list.slice()
  }
  const skillNames = names('skills', PACK_LIMITS.skills)
  if (skillNames === null) return fail('skills')
  const automationIds = names('automations', PACK_LIMITS.automations)
  if (automationIds === null) return fail('automations')
  const never = m.never === undefined ? [] : m.never
  if (!Array.isArray(never) || never.length > PACK_LIMITS.never || never.some((s) => !oneLine(s, PACK_LIMITS.neverChars))) return fail('never')
  // Saying what Kaby will not do is not optional for a pack that does anything.
  if (never.length === 0 && (skillNames.length > 0 || automationIds.length > 0)) return fail('never')
  if (m.demo !== undefined && (m.demo !== 'demo.md' || !byPath.has('demo.md'))) return fail('demo')

  // What the folders hold and what the manifest lists must be the same set.
  const folders = new Set()
  const hooks = []
  const autos = new Map()
  for (const [path, at] of placed) {
    if (at.kind === 'skill') folders.add(at.id)
    if (at.kind === 'automation') autos.set(at.id, byPath.get(path))
    if (at.kind === 'trigger') hooks.push(at.id)
  }
  if (skillNames.some((n) => !folders.has(n))) return fail('skills')
  for (const n of folders) if (skillNames.indexOf(n) < 0) return fail('unexpected_file', { file: 'skills/' + n })
  if (automationIds.some((n) => !autos.has(n))) return fail('automations')
  for (const n of autos.keys()) if (automationIds.indexOf(n) < 0) return fail('unexpected_file', { file: 'automations/' + n + '.json' })

  const skills = []
  for (const name of skillNames) {
    const inner = []
    for (const [path, at] of placed) if (at.kind === 'skill' && at.id === name) inner.push({ path: at.rest, content: byPath.get(path) })
    const v = validateTeamSkill({ name, files: inner })
    if (v.ok !== true) return fail('skill_' + v.reason, { file: 'skills/' + name + (v.file ? '/' + v.file : '') })
    skills.push({ name, description: v.description, files: inner, scripts: scriptFiles(inner), version: v.version })
  }
  const automations = []
  for (const id of automationIds) {
    const a = readAutomation(id, autos.get(id))
    if (a.ok !== true) return a
    automations.push({ id, task: a.task })
  }
  return {
    ok: true,
    id: m.id,
    name: m.name.trim(),
    version: m.version,
    description: m.description.trim(),
    host: typeof m.host === 'string' ? m.host.trim() : '',
    connectors,
    never: never.map((s) => s.trim()),
    skills,
    automations,
    triggers: hooks.sort(),
    demo: byPath.has('demo.md'),
    bytes
  }
}

/**
 * Pure. What installing a valid pack would do, from what the host says is there now:
 *   state.connected   the connector slugs the person has connected
 *   state.skills      { name: 'absent' | 'same' | 'different' | 'disabled' } for the skills named by the pack
 *   state.automations the names of the automations that exist
 * A skill is written only when absent: one the person edited (`different`), switched off (`disabled`) or that is already the same is left
 * alone. An automation whose name exists is not made twice. Every new automation is paused, asks first and is not callable by an assistant.
 * `ready` is true when every connector the pack needs is connected: the pack installs anyway, and says what is missing.
 */
export const planInstall = (valid, state) => {
  const s = plain(state) ? state : {}
  const connected = new Set(Array.isArray(s.connected) ? s.connected : [])
  const now = plain(s.skills) ? s.skills : {}
  const have = new Set((Array.isArray(s.automations) ? s.automations : []).map((n) => String(n).trim().toLowerCase()))
  const skills = valid.skills.map((k) => {
    const at = now[k.name]
    const action = at === undefined || at === 'absent' ? 'create' : (at === 'same' ? 'current' : (at === 'disabled' ? 'disabled' : 'keep'))
    return { name: k.name, action, scripts: k.scripts }
  })
  const automations = valid.automations.map((a) => ({
    id: a.id,
    name: a.task.name,
    action: have.has(a.task.name.toLowerCase()) ? 'exists' : 'create',
    task: Object.assign({}, a.task, { active: false, approvals: 'ask' })
  }))
  const connectors = valid.connectors.map((slug) => ({ slug, connected: connected.has(slug) }))
  return {
    id: valid.id,
    version: valid.version,
    skills,
    automations,
    connectors,
    ready: connectors.every((c) => c.connected),
    never: valid.never,
    record: { id: valid.id, version: valid.version, skills: valid.skills.map((k) => k.name), automations: valid.automations.map((a) => a.id) }
  }
}

/**
 * Carries a plan out through injected functions (no file, no network here):
 *   deps.state()                   the `state` of planInstall
 *   deps.writeSkill(name, files)   writes a skill folder
 *   deps.createAutomation(task)    creates one automation (the host runs its own sanitiser on it)
 *   deps.record(record)            remembers that the pack is installed
 * One failure does not stop the others; the pack is recorded only when nothing failed.
 */
export const installPack = async (valid, deps) => {
  const plan = planInstall(valid, await deps.state())
  const done = { skills: [], automations: [] }
  const errors = []
  const oops = (e) => String((e && e.message) || e).slice(0, 200)
  for (const k of plan.skills) {
    if (k.action !== 'create') continue
    try {
      await deps.writeSkill(k.name, valid.skills.find((x) => x.name === k.name).files)
      done.skills.push(k.name)
    } catch (e) { errors.push({ kind: 'skill', name: k.name, error: oops(e) }) }
  }
  for (const a of plan.automations) {
    if (a.action !== 'create') continue
    try {
      await deps.createAutomation(a.task)
      done.automations.push(a.id)
    } catch (e) { errors.push({ kind: 'automation', name: a.id, error: oops(e) }) }
  }
  if (errors.length === 0) {
    try { await deps.record(plan.record) } catch (e) { errors.push({ kind: 'record', name: valid.id, error: oops(e) }) }
  }
  return { ok: errors.length === 0, plan, done, errors }
}
