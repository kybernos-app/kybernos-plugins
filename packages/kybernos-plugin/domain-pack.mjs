// Domain packs: one JSON file per field of work (docs/dev/domain-packs.md).
//
//   packages/kybernos-plugin/domains/<id>.json
//
// A pack is DATA: texts, the names of skills and Agent Teams that already exist, the wording of some menu rows, and the goals that group them.
// Nothing in a pack is ever executed or fetched, and a pack is checked on the way in: known keys only, plain values, bounded sizes. A file that
// fails is left out and reported (it can never become a 5xx or stop the host). The wizard reads the checked packs from `GET /kybernos/domains`.
//
// Pure node:fs, no DSH service: unit-testable on a temp folder (see test-domain-pack.mjs).
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const FORMAT = 1
/** The rows of the Kybernos sidebar menu (SalesMenu in client.js): the only ones a pack may rename. */
export const ROW_IDS = ['kyber', 'dashboards', 'aiteams', 'projects', 'deliverables', 'tasks', 'skills', 'connectors', 'documents']
/** The rows a pack may hide: the others are the only door to a page. */
export const HIDEABLE = ['documents']
export const LANGS = ['en', 'fr', 'es', 'ar']
/** The display modes of the wizard (KB_OB_MODES) and the autonomy presets of the agents step: a pack names the ones it starts from. */
export const MODES = ['bureau', 'code']
export const PRESETS = ['prudent', 'balanced', 'auto']
/** The icons the wizard can draw for a field (client.js, KB-OB-UI). */
export const ICONS = ['cap', 'heart', 'house', 'scales', 'trend', 'bag', 'mega', 'code', 'wand']
/** The templates of the new-chat page (KB_NC_TEMPLATES): a pack may put some first. */
export const HOME_IDS = ['slides', 'doc', 'sheet', 'dashboard', 'image', 'video', 'website', 'miniapp', 'model3d', 'automation', 'team', 'skill', 'plugin']
/** The `source` of a skill the plugin itself ships (domains/skills/<name>/SKILL.md), installed by `POST /kybernos/domain/skill`. */
export const BUNDLED_SOURCE = 'kybernos'
export const LIMITS = { goals: 12, skills: 8, teams: 3, soon: 4, automations: 3, connectors: 4, text: 160, prompt: 900, keywords: 40, keyword: 24, home: 6, legacy: 8 }

const ID_RE = /^[a-z][a-z0-9-]{1,23}$/
const SKILL_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SOURCE_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/
// The slug of an app of the Connectors catalogue (packages/kybernos-composio/catalog.js): lower case, digits and underscores.
const APP_RE = /^[a-z0-9_]{2,40}$/
const TEAM_RE = /^[a-z0-9][a-z0-9-]{0,40}$/
const JOB_RE = /^[a-z][a-z0-9-]{1,23}$/
const COLOR_RE = /^#[0-9a-fA-F]{6}$/
// Five cron fields made of digits, `*`, `/`, `,` and `-`: the host's own parser has the last word when the automation is created.
const CRON_RE = /^[0-9*/,-]+( [0-9*/,-]+){4}$/
const KEYWORD_RE = /^[a-z0-9][a-z0-9 .'-]*$/

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const only = (obj, keys, where, errors) => { for (const k of Object.keys(obj)) if (keys.indexOf(k) < 0) errors.push(where + ': unknown key "' + k + '"') }

/** A text in several languages: `en` is required, the others are optional. Printable, no angle brackets, at most LIMITS.text characters. */
const textOf = (v, where, errors, max) => {
  if (!plain(v)) { errors.push(where + ': a text is an object { en, fr… }'); return null }
  only(v, LANGS, where, errors)
  const out = {}
  for (const lang of LANGS) {
    if (v[lang] === undefined) continue
    const t = typeof v[lang] === 'string' ? v[lang].trim() : ''
    if (t === '' || Array.from(t).length > (max === undefined ? LIMITS.text : max) || /[<>]/.test(t) || (max === undefined ? /[\u0000-\u001f]/ : /[\u0000-\u0008\u000b-\u001f]/).test(t)) { errors.push(where + '.' + lang + ': empty, too long or not plain text'); return null }
    out[lang] = t
  }
  if (out.en === undefined) { errors.push(where + ': "en" is required'); return null }
  return out
}
const listOf = (v, max, where, errors) => {
  if (v === undefined) return []
  if (!Array.isArray(v) || v.length > max) { errors.push(where + ': a list of at most ' + max); return [] }
  return v
}

/** Checks one pack. `fileId` is the file's name without `.json`: the pack's id must be the same. Returns `{ ok, pack }` or `{ ok:false, errors }`. */
export const validatePack = (raw, fileId) => {
  const errors = []
  if (!plain(raw)) return { ok: false, errors: ['a pack is a JSON object'] }
  only(raw, ['v', 'id', 'order', 'accent', 'icon', 'name', 'tagline', 'keywords', 'home', 'legacyJobs', 'menu', 'mode', 'agents', 'goals'], 'pack', errors)
  if (raw.v !== FORMAT) errors.push('v: ' + FORMAT + ' expected')
  if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) errors.push('id: not a valid id')
  else if (raw.id !== fileId) errors.push('id: "' + raw.id + '" is not the file name "' + fileId + '"')
  if (raw.order !== undefined && !(Number.isInteger(raw.order) && raw.order >= 1 && raw.order <= 99)) errors.push('order: an integer from 1 to 99')
  if (typeof raw.accent !== 'string' || !COLOR_RE.test(raw.accent)) errors.push('accent: a #rrggbb colour')
  if (ICONS.indexOf(raw.icon) < 0) errors.push('icon: one of ' + ICONS.join(', '))
  const keywords = []
  for (const k of listOf(raw.keywords, LIMITS.keywords, 'keywords', errors)) {
    if (typeof k !== 'string' || !KEYWORD_RE.test(k) || k.length > LIMITS.keyword) errors.push('keywords: "' + String(k) + '" is not a lower-case word or phrase')
    else if (keywords.indexOf(k) < 0) keywords.push(k)
  }
  const home = []
  for (const h of listOf(raw.home, LIMITS.home, 'home', errors)) {
    if (HOME_IDS.indexOf(h) < 0) errors.push('home: "' + String(h) + '" is not a new-chat template')
    else if (home.indexOf(h) < 0) home.push(h)
  }
  const name = textOf(raw.name, 'name', errors)
  const tagline = textOf(raw.tagline, 'tagline', errors)
  const legacyJobs = listOf(raw.legacyJobs, LIMITS.legacy, 'legacyJobs', errors).filter((j) => {
    const good = typeof j === 'string' && JOB_RE.test(j)
    if (!good) errors.push('legacyJobs: "' + String(j) + '" is not an id')
    return good
  })

  const menu = { labels: {}, hide: [] }
  if (raw.menu !== undefined) {
    if (!plain(raw.menu)) errors.push('menu: an object')
    else {
      only(raw.menu, ['labels', 'hide'], 'menu', errors)
      if (raw.menu.labels !== undefined) {
        if (!plain(raw.menu.labels)) errors.push('menu.labels: an object')
        else for (const k of Object.keys(raw.menu.labels)) {
          if (ROW_IDS.indexOf(k) < 0) { errors.push('menu.labels: "' + k + '" is not a menu row'); continue }
          const t = textOf(raw.menu.labels[k], 'menu.labels.' + k, errors)
          if (t !== null) menu.labels[k] = t
        }
      }
      for (const k of listOf(raw.menu.hide, HIDEABLE.length, 'menu.hide', errors)) {
        if (HIDEABLE.indexOf(k) < 0) errors.push('menu.hide: "' + String(k) + '" cannot be hidden')
        else if (menu.hide.indexOf(k) < 0) menu.hide.push(k)
      }
    }
  }

  if (raw.mode !== undefined && MODES.indexOf(raw.mode) < 0) errors.push('mode: one of ' + MODES.join(', '))
  // How much the agents may do alone, by default, in this field, and why (one sentence the wizard shows under the choice).
  const agents = { preset: 'balanced', why: null }
  if (raw.agents !== undefined) {
    if (!plain(raw.agents)) errors.push('agents: an object')
    else {
      only(raw.agents, ['preset', 'why'], 'agents', errors)
      if (PRESETS.indexOf(raw.agents.preset) < 0) errors.push('agents.preset: one of ' + PRESETS.join(', '))
      else agents.preset = raw.agents.preset
      if (raw.agents.why !== undefined) agents.why = textOf(raw.agents.why, 'agents.why', errors)
    }
  }

  const goals = []
  const rawGoals = listOf(raw.goals, LIMITS.goals, 'goals', errors)
  if (!Array.isArray(raw.goals) || raw.goals.length === 0) errors.push('goals: at least one goal')
  const seenGoal = {}
  rawGoals.forEach((g, i) => {
    const where = 'goals[' + i + ']'
    if (!plain(g)) { errors.push(where + ': an object'); return }
    only(g, ['id', 'name', 'title', 'desc', 'skills', 'teams', 'connectors', 'automations', 'soon', 'starter'], where, errors)
    if (typeof g.id !== 'string' || !ID_RE.test(g.id)) errors.push(where + '.id: not a valid id')
    else if (seenGoal[g.id] === true) errors.push(where + '.id: "' + g.id + '" appears twice')
    else seenGoal[g.id] = true
    const goal = { id: g.id, name: textOf(g.name, where + '.name', errors), title: textOf(g.title, where + '.title', errors), desc: textOf(g.desc, where + '.desc', errors), skills: [], teams: [], connectors: [], automations: [], soon: [], starter: null }
    const seenSkill = {}
    for (const [j, s] of listOf(g.skills, LIMITS.skills, where + '.skills', errors).entries()) {
      const sw = where + '.skills[' + j + ']'
      if (!plain(s)) { errors.push(sw + ': an object'); continue }
      only(s, ['source', 'name', 'd'], sw, errors)
      if (typeof s.name !== 'string' || !SKILL_RE.test(s.name) || s.name.length > 64) { errors.push(sw + '.name: not a skill name'); continue }
      if (typeof s.source !== 'string' || !(SOURCE_RE.test(s.source) || s.source === BUNDLED_SOURCE)) { errors.push(sw + '.source: not a GitHub owner/repo, nor "' + BUNDLED_SOURCE + '"'); continue }
      if (seenSkill[s.name + '|' + s.source] === true) { errors.push(sw + ': "' + s.name + '" appears twice in the goal'); continue }
      seenSkill[s.name + '|' + s.source] = true
      const d = textOf(s.d, sw + '.d', errors)
      if (d !== null) goal.skills.push({ source: s.source, name: s.name, d })
    }
    for (const t of listOf(g.teams, LIMITS.teams, where + '.teams', errors)) {
      if (typeof t !== 'string' || !TEAM_RE.test(t)) errors.push(where + '.teams: "' + String(t) + '" is not a team id')
      else if (goal.teams.indexOf(t) < 0) goal.teams.push(t)
    }
    for (const c of listOf(g.connectors, LIMITS.connectors, where + '.connectors', errors)) {
      if (typeof c !== 'string' || !APP_RE.test(c)) errors.push(where + '.connectors: "' + String(c) + '" is not an app slug')
      else if (goal.connectors.indexOf(c) < 0) goal.connectors.push(c)
    }
    const seenAuto = {}
    for (const [j, a] of listOf(g.automations, LIMITS.automations, where + '.automations', errors).entries()) {
      const aw = where + '.automations[' + j + ']'
      if (!plain(a)) { errors.push(aw + ': an object'); continue }
      only(a, ['id', 'name', 'prompt', 'cron'], aw, errors)
      if (typeof a.id !== 'string' || !ID_RE.test(a.id)) { errors.push(aw + '.id: not a valid id'); continue }
      if (seenAuto[a.id] === true) { errors.push(aw + '.id: "' + a.id + '" appears twice in the goal'); continue }
      seenAuto[a.id] = true
      if (typeof a.cron !== 'string' || !CRON_RE.test(a.cron)) { errors.push(aw + '.cron: five cron fields'); continue }
      const name = textOf(a.name, aw + '.name', errors)
      const prompt = textOf(a.prompt, aw + '.prompt', errors, LIMITS.prompt)
      if (name !== null && prompt !== null) goal.automations.push({ id: a.id, name, prompt, cron: a.cron })
    }
    for (const [j, t] of listOf(g.soon, LIMITS.soon, where + '.soon', errors).entries()) {
      const x = textOf(t, where + '.soon[' + j + ']', errors)
      if (x !== null) goal.soon.push(x)
    }
    if (g.starter !== undefined) goal.starter = textOf(g.starter, where + '.starter', errors)
    if (goal.skills.length + goal.teams.length + goal.automations.length + goal.soon.length === 0) errors.push(where + ': a goal asks for something (skills, teams, automations or soon)')
    goals.push(goal)
  })
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, pack: { v: FORMAT, id: raw.id, order: raw.order === undefined ? 50 : raw.order, accent: raw.accent, icon: raw.icon, name, tagline, keywords, home, legacyJobs, menu, mode: raw.mode === undefined ? 'bureau' : raw.mode, agents, goals } }
}

/** What no single file can see: a legacy job claimed by two packs. Returns the list of problems (empty = fine). */
export const checkSet = (packs) => {
  const errors = []
  const claimed = {}
  for (const p of packs) for (const j of p.legacyJobs) {
    if (claimed[j] !== undefined) errors.push('legacy job "' + j + '" is claimed by "' + claimed[j] + '" and "' + p.id + '"')
    else claimed[j] = p.id
  }
  return errors
}

/** Reads and checks every `<dir>/*.json`. A file that fails is returned in `rejected` and left out; a pack that clashes with an earlier one too. */
export const loadPacks = (dir) => {
  const packs = []
  const rejected = []
  let files = []
  try { files = readdirSync(dir).filter((f) => /\.json$/.test(f)).sort() } catch (e) { return { packs, rejected: [{ file: dir, errors: ['folder unreadable'] }] } }
  for (const f of files) {
    let raw = null
    try { raw = JSON.parse(readFileSync(join(dir, f), 'utf8')) } catch (e) { rejected.push({ file: f, errors: ['not valid JSON'] }); continue }
    const r = validatePack(raw, f.replace(/\.json$/, ''))
    if (!r.ok) { rejected.push({ file: f, errors: r.errors }); continue }
    const clash = checkSet(packs.concat([r.pack]))
    if (clash.length > 0) { rejected.push({ file: f, errors: clash }); continue }
    packs.push(r.pack)
  }
  // The order the wizard lists them in: the pack's own `order`, then its id.
  packs.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1))
  return { packs, rejected }
}

// ── The point of the plugin contract (docs/dev/plugin-contract.md): other plugins can contribute packs ──
/** The version of this plugin, as a point owner: a plugin that says `requires: { "kybernos/core": "^1.0" }` is judged against it (test-domain-pack.mjs keeps it equal to package.json's major). */
export const OWNER_VERSION = '1.0.0'
/** Checks one contributed file for the registry: the same check as a shipped pack, in the registry's `{ ok, value }` shape. */
export const validateContribution = (raw, fileId) => {
  const r = validatePack(raw, fileId)
  return r.ok ? { ok: true, value: r.pack } : { ok: false, errors: r.errors }
}
/** What the registry is told about this point (the owner calls `definePoint` with it). Instruction data: a pack carries prompts and starter questions. */
export const DOMAIN_POINT = { owner: 'kybernos/core', ownerVersion: OWNER_VERSION, name: 'domain-pack', version: '1.0', kind: 'data', class: 'instruction', validate: validateContribution, max: 12 }
export const DOMAIN_POINT_REF = 'kybernos/core#domain-pack'
/** A pack that comes from a plugin is listed after ours: its `order` is held between these, so a plugin cannot put itself before Education or after the catch-all. */
export const CONTRIBUTED_ORDER = { min: 50, max: 98 }

/**
 * The packs the wizard offers: the shipped ones, then what the enabled plugins contribute (`[{ plugin, file, value }]` from the registry). A contributed pack
 * whose id is already taken (by a shipped pack or an earlier plugin), or that claims a legacy job someone already claims, is left out and reported. A kept
 * pack says where it came from in `from`. Pure; `shipped` is `{ packs, rejected }` as `loadPacks` returns it.
 */
export const mergePackSets = (shipped, contributions) => {
  const packs = shipped.packs.slice()
  const rejected = shipped.rejected.slice()
  for (const c of contributions) {
    const pack = c.value
    const where = String(c.plugin) + ':' + String(c.file)
    if (packs.some((p) => p.id === pack.id)) { rejected.push({ file: where, errors: ['id "' + pack.id + '" is already taken'] }); continue }
    const clash = checkSet(packs.concat([pack]))
    if (clash.length > 0) { rejected.push({ file: where, errors: clash }); continue }
    packs.push({ ...pack, order: Math.min(CONTRIBUTED_ORDER.max, Math.max(CONTRIBUTED_ORDER.min, pack.order)), from: c.plugin })
  }
  packs.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1))
  return { packs, rejected }
}

/** The pack a saved `profil` stands for: the pack's own id, or the pack that claims it as a legacy job. `null` when none. */
export const domainOfProfil = (packs, profil) => {
  if (typeof profil !== 'string') return null
  const own = packs.find((p) => p.id === profil)
  if (own !== undefined) return own.id
  const legacy = packs.find((p) => p.legacyJobs.indexOf(profil) >= 0)
  return legacy === undefined ? null : legacy.id
}
