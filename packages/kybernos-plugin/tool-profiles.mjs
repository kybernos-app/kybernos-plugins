// Tool profiles (2026-10-28): show a task-appropriate tool set at session start,
// instead of every registered tool on every request.
//
// Measured baseline on this machine before writing this file (a live coding session,
// `request/header` of the session journal): 80 visible tool definitions, 58,165
// characters of JSON schemas, about 14.5k prompt tokens per request. The same session
// does not need the documents, memory-page, team or scheduler tools to read a file, edit
// it and run a test.
//
// The seam is the native per-agent restriction: `ctx.tools.restrict({ allow })` called
// from the agent's own scope (`agent.ctx.inject(['tools'], ...)`). It is not a bundle
// switch: plugin pages, routes and scheduled jobs stay exactly as they are, and only the
// agent's model-facing surface shrinks. `tools.restrict` constrains the tool surface a
// scope INHERITS (the global layer and every ancestor layer); a tool registered in the
// agent's own layer is never removed by it.
//
// The profile is chosen ONCE, at session start, from the workspace and the first user
// message, and never changes during the session: a mid-session tool change rewrites the
// prompt prefix and costs the provider cache. When the classification is not clear, the
// answer is `full` (today's behavior): a smaller surface must never cost a task.
//
// Recovery: the chosen profile is announced to the agent by a small, stable system-prompt
// section. When a task genuinely needs a hidden capability, the agent must say which
// profile/capability is missing; widening happens in a new session (or after the user
// explicitly asks for it), never through silent tool churn.
//
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Everything here is guarded: an absent service, an unreadable agent, a refused filter
// leaves the session on `full`, and the boot never depends on it.
//
// Rollback: delete the `monterProfilsOutils` call in index.js (or set
// KYBERNOS_TOOL_PROFILES=full) and every session is back to the full tool set.

/** Environment switch: `full`/`off` disables restriction, `code`/`office`/`automation` forces one profile. */
export const TOOL_PROFILES_ENV = 'KYBERNOS_TOOL_PROFILES'

/**
 * The conservative core every profile keeps. Filesystem, search, bash (diagnostics and
 * tests run through it), job management and focused delegation: without these, no
 * profile can do its own job. Names that the deployment does not register are dropped
 * when the filter is built.
 */
export const CORE_TOOLS = [
  'read', 'write', 'edit', 'glob', 'grep', 'bash',
  'job_list', 'job_output', 'job_kill', 'todo_write',
  'ask_user_question', 'present', 'skill', 'working_directory', 'subagent',
]

/** Tool sets per profile, on top of {@link CORE_TOOLS}. `full` is the fallback: no restriction. */
export const PROFILE_TOOLS = {
  code: [
    // code intelligence, over the local language servers
    'mcp__lsp__lsp_definition', 'mcp__lsp__lsp_diagnostics', 'mcp__lsp__lsp_hover',
    'mcp__lsp__lsp_references', 'mcp__lsp__lsp_symbols', 'mcp__lsp__lsp_format',
    // documentation lookups a coding task routinely needs
    'web_search', 'web_fetch', 'read_image',
    // a dev server or a REPL needs a persistent terminal
    'terminal_open', 'terminal_read', 'terminal_send', 'terminal_signal', 'terminal_close',
    // recall of an earlier decision in the same repository
    'session_search',
    // a focused child can run in parallel without widening this session
    'subagent_fork',
  ],
  office: [
    'read_image', 'kaby_knowledge', 'kaby_journal', 'kaby_account',
    'memory_search', 'memory_write', 'memory_suggest', 'lesson_search', 'lesson_write',
    'web_search', 'web_fetch', 'schedule_create', 'schedule_list', 'schedule_update', 'schedule_delete',
    'instructions_suggest', 'skill_propose',
  ],
  automation: [
    'schedule_create', 'schedule_list', 'schedule_update', 'schedule_delete',
    'automation_home', 'automation_suggest',
    'web_search', 'web_fetch', 'read_image',
    'memory_search', 'lesson_search', 'lesson_write',
    'terminal_open', 'terminal_read', 'terminal_send', 'terminal_signal', 'terminal_close',
    'subagent_fork',
  ],
}

/** Every profile name the switch accepts. */
export const PROFILE_NAMES = ['code', 'office', 'automation', 'full']

/** What the agent is told about its own profile: one stable paragraph, no timestamp, no per-turn noise. */
export const PROFILE_NOTE_HEAD = '[KYBERNOS TOOL PROFILE]'

/**
 * The note registered as a system-prompt section for a restricted session. It is
 * byte-identical across the whole session, so it never invalidates the prompt cache.
 * @param {string} profile an applied profile name (`full` contributes nothing)
 * @returns {string} the note, or '' for `full`
 */
export const profileNote = (profile) => {
  if (typeof profile !== 'string' || profile === '' || profile === 'full' || PROFILE_NAMES.indexOf(profile) < 0) return ''
  return PROFILE_NOTE_HEAD + ' This session runs the "' + profile + '" tool profile chosen at session start: tools that belong to other tasks are hidden to keep the prompt small. If the work genuinely needs a missing capability, say which capability and which profile would cover it; widening happens in a new session (or when the user explicitly asks for it), never mid-turn. Never call or describe a tool that is not in your tool list.'
}

/** Normalised text used by the classification (accents and case ignored). */
const words = (text) => String(text === undefined || text === null ? '' : text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

const CODE_WORDS = ['code', 'bug', 'fix', 'test', 'tests', 'refactor', 'commit', 'merge', 'branch', 'lint', 'build', 'compile', 'error', 'stack', 'trace', 'regex', 'function', 'module', 'api', 'endpoint', 'typescript', 'javascript', 'python', 'rust', 'sql', 'docker', 'ci', 'patch', 'diff', 'pull request', 'repo', 'repository', 'git']
const OFFICE_WORDS = ['document', 'documents', 'word', 'docx', 'excel', 'xlsx', 'spreadsheet', 'csv', 'slide', 'slides', 'presentation', 'deck', 'report', 'letter', 'mail', 'email', 'invoice', 'contract', 'note', 'notes', 'meeting', 'appointment', 'appointments', 'knowledge', 'memory', 'resume', 'cv', 'translation', 'translate']
const AUTOMATION_WORDS = ['schedule', 'scheduled', 'cron', 'automation', 'automate', 'pipeline', 'collect', 'scrape', 'scraping', 'monitor', 'watch', 'background', 'every day', 'every hour', 'every week', 'routine']

// The person's own language. These are DATA, not user-facing text: they sit in a JSON file next to this module so the
// language gate (scripts/test-no-french-literals.mjs, which reads code files) keeps its rule — French lives in data, not
// in code. A missing or malformed file degrades to the English words only; it never breaks the boot.
const TASK_KEYWORDS_FILE = join(dirname(fileURLToPath(import.meta.url)), 'task-keywords.json')
const frenchTaskWords = () => {
  try {
    const raw = JSON.parse(readFileSync(TASK_KEYWORDS_FILE, 'utf8'))
    const list = (v) => (Array.isArray(v) ? v.filter((w) => typeof w === 'string' && w.trim() !== '') : [])
    return { office: list(raw.office), automation: list(raw.automation) }
  } catch (e) { return { office: [], automation: [] } }
}
const FRENCH_TASK_WORDS = frenchTaskWords()
const OFFICE_TERMS = OFFICE_WORDS.concat(FRENCH_TASK_WORDS.office)
const AUTOMATION_TERMS = AUTOMATION_WORDS.concat(FRENCH_TASK_WORDS.automation)

/** How many distinct keywords of a list appear in the text (a rough but deterministic signal). */
const hits = (text, list) => {
  let n = 0
  for (const word of list) if (text.indexOf(word) >= 0) n += 1
  return n
}

/** True when the working directory looks like a code checkout, not a documents folder. */
export const looksLikeCodeWorkspace = (cwd, options = {}) => {
  const exists = typeof options.exists === 'function' ? options.exists : existsSync
  const path = typeof cwd === 'string' ? cwd.trim() : ''
  if (path === '') return false
  try {
    for (const marker of ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'Makefile', '.git', 'tsconfig.json']) {
      if (exists(path.replace(/[\\/]+$/, '') + '/' + marker) === true) return true
    }
  } catch (e) { /* an unreadable workspace is not a code workspace */ }
  return false
}

/**
 * Which profile a session starts on. Deterministic, local, and conservative: `full`
 * unless the workspace or the first task says clearly otherwise.
 *
 * @param {{cwd?: string, text?: string, exists?: (path: string) => boolean}} input
 *   the session's working directory, the first human message, and an optional stat probe
 * @returns {'code'|'office'|'automation'|'full'}
 */
export const profileFor = (input = {}) => {
  try {
    const text = words(input.text)
    const code = hits(text, CODE_WORDS)
    const office = hits(text, OFFICE_TERMS)
    const automation = hits(text, AUTOMATION_TERMS)
    // Two clear task signals beat the workspace: a coding checkout is often used to
    // write a report, and a documents folder can hold a script.
    if (office >= 2 && office > code && office > automation) return 'office'
    if (automation >= 2 && automation > code && automation > office) return 'automation'
    if (code >= 2 && code > office && code > automation) return 'code'
    if (looksLikeCodeWorkspace(input.cwd, { exists: input.exists }) === true) return 'code'
    if (office >= 1 && office >= code && office >= automation) return 'office'
    if (automation >= 1 && automation > code && automation > office) return 'automation'
    return 'full'
  } catch (e) {
    return 'full'
  }
}

/**
 * The restriction filter for one profile over the tools the agent can actually see.
 * Intersecting with the visible names is what keeps `tools.restrict` from throwing on an
 * unknown name in a deployment that does not mount every tool (a bare CLI, another
 * profile's bundle set). Unknown and absent names are simply dropped.
 *
 * @param {string} profile the wanted profile
 * @param {string[]} visibleNames the tool names currently visible to that agent
 * @returns {{allow: string[]}|null} the filter, or null when nothing should be restricted
 */
export const filterFor = (profile, visibleNames) => {
  if (profile === 'full' || PROFILE_NAMES.indexOf(profile) < 0) return null
  if (!Array.isArray(visibleNames)) return null
  const visible = new Set(visibleNames.filter((n) => typeof n === 'string' && n !== ''))
  const wanted = CORE_TOOLS.concat(PROFILE_TOOLS[profile] === undefined ? [] : PROFILE_TOOLS[profile])
  const allow = []
  for (const name of wanted) if (visible.has(name) && allow.indexOf(name) < 0) allow.push(name)
  // A filter that keeps almost nothing is a bug, not an economy: fall back to full.
  if (allow.length < 5) return null
  return { allow }
}

const readMode = (env) => {
  const raw = env !== null && env !== undefined && typeof env[TOOL_PROFILES_ENV] === 'string' ? env[TOOL_PROFILES_ENV].trim().toLowerCase() : ''
  if (raw === '' || raw === 'on' || raw === 'auto') return 'auto'
  if (raw === 'off' || raw === 'full' || raw === 'none') return 'off'
  return PROFILE_NAMES.indexOf(raw) >= 0 ? raw : 'auto'
}

/** The human text of a claimed message; injected runtime context and file notices are not a task. */
export const claimedText = (message) => {
  try {
    // Only a human/agent prompt decides the profile. Goal rounds, steering notices and
    // runtime-context injections carry text too, and are not the session's task.
    if (message?.source?.kind !== 'user') return ''

    const blocks = Array.isArray(message?.content) ? message.content : []
    return blocks.filter((b) => b !== null && typeof b === 'object' && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n').slice(0, 4000)
  } catch (e) { return '' }
}

const visibleNamesOf = (tools, agent) => {
  try {
    const schemas = typeof tools.schemas === 'function' ? tools.schemas(agent) : []
    return Array.isArray(schemas) ? schemas.map((s) => (s !== null && typeof s === 'object' ? s.name : undefined)).filter((n) => typeof n === 'string') : []
  } catch (e) { return [] }
}

const alreadyRequested = (agent) => {
  try {
    return typeof agent.session.requestHeader === 'function' && agent.session.requestHeader() !== undefined
  } catch (e) {
    return true   // unreadable session: do not touch it
  }
}

/**
 * Mounts the profiler on a host context. Never throws: every listener body is guarded and
 * a refused restriction leaves the session on `full`.
 *
 * Registration is SYNCHRONOUS and scoped: `agent.ctx.get('tools').restrict(filter)` — the
 * service accessor is shadowed by Cordis with the calling context (the mechanism an
 * `agent.ctx.inject` callback relies on), so the restriction belongs to the agent's scope and
 * is visible in the very next assembly, including the first one of the session. A
 * `ctx.inject(...)` callback is scheduled on a later microtask and would miss that first
 * assembly; a same-tick install is what makes "chosen once at session start" true.
 *
 * The registration is an effect of the agent's own context: it is disposed with the agent,
 * so a disposed session cannot keep a restriction alive.
 *
 * Safety: the restrict path is proven scoped before it is trusted. An older Cordis without
 * the caller-context shadow would register the filter on the GLOBAL layer and shrink every
 * session; the code compares the global tool count before/after, and undoes the filter and
 * keeps `full` when it changed.
 *
 * @param {object} ctx the plugin's cordis host context
 * @param {{env?: object, exists?: (path: string) => boolean}} [options] injected for tests
 * @returns {{mode: string, profiles: Map<string, string>, unseen: () => number}} a small diagnostic handle
 */
export function mountToolProfiles(ctx, options = {}) {
  const mode = readMode(options.env === undefined ? process.env : options.env)
  const profiles = new Map()
  const decided = new WeakSet()
  const sessions = new WeakSet()
  if (mode === 'off') return { mode, profiles, unseen: () => 0 }
  if (ctx === null || ctx === undefined || typeof ctx.on !== 'function') return { mode: 'unavailable', profiles, unseen: () => 0 }

  const serviceOf = (agent, name) => {
    try { return agent.ctx.get(name) } catch (e) { return undefined }
  }
  const globalCount = (tools) => {
    try { const all = tools.schemas(); return Array.isArray(all) ? all.length : -1 } catch (e) { return -1 }
  }

  const install = (agent, profile) => {
    if (profile === 'full' || profile === null || profile === undefined) return false
    const tools = serviceOf(agent, 'tools')
    if (tools === undefined || tools === null || typeof tools.restrict !== 'function') return false
    if (alreadyRequested(agent) === true) return false
    const visible = visibleNamesOf(tools, agent)
    const filter = filterFor(profile, visible)
    if (filter === null) return false
    // Prove the filter is scoped BEFORE trusting it: a global leak would copy this economy
    // rule onto every chat. Undo it and keep the full surface when the global count moves.
    const before = globalCount(tools)
    let undo
    try {
      undo = tools.restrict(filter)
    } catch (e) {
      // A refused filter (an unknown or scope-local name in another deployment) means the
      // session keeps its full surface: the safe fallback.
      console.error('[kybernos] tool profile "' + profile + '" not applied: ' + String((e && e.message) || e))
      return false
    }
    const after = globalCount(tools)
    if (before >= 0 && after >= 0 && after !== before) {
      try { if (typeof undo === 'function') undo() } catch (e) { /* nothing more to do */ }
      console.error('[kybernos] tool profile "' + profile + '" refused: the restriction was not scoped, full surface kept')
      return false
    }
    profiles.set(String(agent.id === undefined ? '' : agent.id), profile)
    const sid = (() => { try { return String(agent.session.id || '') } catch (e) { return '' } })()
    console.log('[kybernos] tool profile "' + profile + '" on ' + (sid === '' ? 'an agent' : sid) + ': ' + String(filter.allow.length) + ' of ' + String(visible.length) + ' tools kept')
    // The stable note that tells the agent its own profile (and how to recover). Same
    // synchronous scoped path, so it is present from the first request too.
    try {
      const prompt = serviceOf(agent, 'systemPrompt')
      const note = profileNote(profile)
      if (note !== '' && prompt !== undefined && prompt !== null && typeof prompt.section === 'function') {
        prompt.section({ name: 'kybernos:tool-profile', order: 9600, interpolate: false, text: () => note })
      }
    } catch (e) { /* the restriction is what matters; the note is guidance */ }
    return true
  }

  const cwdOf = (agent) => {
    try {
      if (typeof agent.session.cwd === 'string') return agent.session.cwd
      if (typeof agent.session.header?.cwd === 'string') return agent.session.header.cwd
    } catch (e) { /* unreadable session: classify on the task only */ }
    return undefined
  }
  const classify = (agent, text) => {
    if (mode !== 'auto') return mode
    return profileFor({ cwd: cwdOf(agent), text, exists: options.exists })
  }

  // A fresh session whose WORKSPACE already says what it is (a code checkout) is restricted
  // at creation, long before its first step. When the workspace is not decisive, the profile
  // waits for the first human message and is installed in the same synchronous tick, before
  // the first assembly: still a start-of-session decision, never a mid-session switch.
  const onCreated = (payload) => {
    try {
      const agent = payload === null || payload === undefined ? undefined : payload.agent
      if (agent === null || agent === undefined || decided.has(agent)) return
      sessions.add(agent)
      if (payload.source !== undefined && payload.source !== 'fresh') { decided.add(agent); return }
      if (alreadyRequested(agent) === true) { decided.add(agent); return }
      const profile = classify(agent, '')
      if (profile === 'full') return
      decided.add(agent)
      install(agent, profile)
    } catch (e) { /* never break agent creation */ }
  }
  const onClaimed = (payload) => {
    try {
      const agent = payload === null || payload === undefined ? undefined : payload.agent
      if (agent === null || agent === undefined || decided.has(agent)) return
      const text = claimedText(payload.message)
      if (text === '') return
      decided.add(agent)
      if (sessions.has(agent) === false) sessions.add(agent)
      install(agent, classify(agent, text))
    } catch (e) { /* never break a turn */ }
  }
  try { ctx.on('agent/created', onCreated) } catch (e) { /* optional seam */ }
  try { ctx.on('agent/inbox/claimed', onClaimed) } catch (e) { /* optional seam */ }
  return { mode, profiles, unseen: () => profiles.size }
}
