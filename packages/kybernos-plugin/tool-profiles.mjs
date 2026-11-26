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
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Everything here is guarded: an absent service, an unreadable agent, a refused filter
// leaves the session on `full`, and the boot never depends on it.
//
// Rollback: delete the `mountToolProfiles` call in index.js (or set
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
    'memory_search', 'memory_write', 'memory_suggest', 'lesson_search', 'lesson_read', 'lesson_write', 'lesson_forget', 'memory_tidy',
    'web_search', 'web_fetch', 'schedule_create', 'schedule_list', 'schedule_update', 'schedule_delete',
    'instructions_suggest', 'skill_propose',
  ],
  automation: [
    'schedule_create', 'schedule_list', 'schedule_update', 'schedule_delete',
    'automation_home', 'automation_suggest',
    'web_search', 'web_fetch', 'read_image',
    'memory_search', 'lesson_search', 'lesson_read', 'lesson_write', 'memory_tidy',
    'terminal_open', 'terminal_read', 'terminal_send', 'terminal_signal', 'terminal_close',
    'subagent_fork',
  ],
}

/**
 * Host tools a shipped automation calls BY NAME: its prompt says "call the <name> tool" (the core automation "Tidy memory &
 * lessons" calls `memory_tidy`, the skill scout template calls `skill_scout`). They belong to no profile, so a restricted
 * session would hide the one tool the run exists for. A session whose first human message names one keeps it, whatever
 * its profile; a session that does not name it never sees it.
 */
export const NAMED_TOOLS = ['memory_tidy', 'skill_scout']

/**
 * The tools of {@link NAMED_TOOLS} that a text names as a whole word (`memory_tidy`, not `memory_tidy_old`).
 * @param {unknown} text the first human message
 * @returns {string[]}
 */
export const namedTools = (text) => {
  const t = typeof text === 'string' ? text : ''
  if (t === '') return []
  return NAMED_TOOLS.filter((name) => new RegExp('(^|[^A-Za-z0-9_])' + name + '($|[^A-Za-z0-9_])').test(t))
}

/** Every profile name the switch accepts. */
export const PROFILE_NAMES = ['code', 'office', 'automation', 'full']

/** Prefix shared by delegated external worker tools (`subagent_codex`, `subagent_claude_code`, ...). */
export const WORKER_TOOL_PREFIX = 'subagent_'

/** Known external subagent worker IDs accepted as shorthand by {@link normalizeWorkerTool}. */
export const KNOWN_WORKER_IDS = ['claude-code', 'codex', 'gemini', 'antigravity', 'opencode', 'qwen', 'hermes']

/**
 * True for a delegated external worker tool (`subagent_<worker>`), false for core in-process tools
 * (`subagent`, `subagent_fork`).
 * @param {unknown} name
 * @returns {boolean}
 */
export const isWorkerTool = (name) =>
  typeof name === 'string' && name.startsWith(WORKER_TOOL_PREFIX) && name.length > WORKER_TOOL_PREFIX.length && name !== 'subagent_fork'

/**
 * Normalises either a known worker ID (`claude-code`, `codex`) or a full worker tool name (`subagent_claude_code`,
 * `subagent_<custom>`) to its canonical worker tool name. Returns null for any non-worker tool (e.g. `bash`,
 * `memory_write`, `subagent_fork`) or malformed input.
 * @param {unknown} value
 * @returns {string|null}
 */
export const normalizeWorkerTool = (value) => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '' || !/^[A-Za-z0-9_-]+$/.test(trimmed)) return null
  if (trimmed.startsWith(WORKER_TOOL_PREFIX)) return isWorkerTool(trimmed) ? trimmed : null
  if (KNOWN_WORKER_IDS.indexOf(trimmed) < 0) return null
  return WORKER_TOOL_PREFIX + trimmed.replace(/-/g, '_')
}

/**
 * Resolves only the PROVEN identity scopes of an agent from real DSH runtime seams (Phase 0 contract).
 * Never invents a team or role ID when the runtime does not supply one.
 *
 * Proven seams on DSH 0.2.3-alpha.2:
 *   - `automation:<id>` / `automation` when supplied by the host's explicit automation session tracker
 *   - `preset:<agentPreset>` from the durable `agent.session.header.agentPreset`
 *   - `default` fallback
 *
 * @param {object|null|undefined} agent
 * @param {{automationScope?: (agent: object) => string|boolean|null|undefined}} [options]
 * @returns {{scope: string, scopes: string[], presetId: string|null, automationId: string|null}}
 */
export const resolveProvenAgentScope = (agent, options = {}) => {
  const scopes = []
  let automationId = null
  if (typeof options.automationScope === 'function' && agent !== null && agent !== undefined) {
    try {
      const auto = options.automationScope(agent)
      if (typeof auto === 'string' && auto.trim() !== '') {
        automationId = auto.trim()
        scopes.push('automation:' + automationId)
        scopes.push('automation')
      } else if (auto === true) {
        scopes.push('automation')
      }
    } catch (e) { /* unreadable tracker: stay conservative */ }
  }
  let presetId = null
  try {
    const raw = agent?.session?.header?.agentPreset
    if (typeof raw === 'string' && raw.trim() !== '') {
      presetId = raw.trim()
      scopes.push('preset:' + presetId)
    }
  } catch (e) { /* unreadable session header */ }
  scopes.push('default')
  return { scope: scopes[0], scopes, presetId, automationId }
}

const normalizeWorkerSet = (list) => {
  const out = new Set()
  if (!Array.isArray(list)) return out
  for (const item of list) {
    const t = normalizeWorkerTool(item)
    if (t !== null) out.add(t)
  }
  return out
}

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

/** A filter that keeps fewer tools than this is a bug, not an economy. */
const MIN_ALLOWED = 5

/**
 * The single-pass restriction filter for one profile composed with an optional worker policy over the tools
 * the agent can actually see.
 *
 * Intersecting with the visible names is what keeps `tools.restrict` from throwing on an unknown name in a
 * deployment that does not mount every tool. Worker policy can ONLY add or remove `subagent_<worker>` tools:
 * it never broadens non-worker task capabilities, and revocations always win over additions.
 *
 * @param {string} profile the wanted profile
 * @param {string[]} visibleNames the tool names currently visible to that agent
 * @param {string[]} [named] tools the session's first message names ({@link namedTools}): kept too when visible
 * @param {{allow?: string[], deny?: string[]}|null} [workerPolicy] optional per-scope worker policy composed in the same pass
 * @returns {{allow: string[]}|null} the filter, or null when nothing should be restricted
 */
export const filterFor = (profile, visibleNames, named = [], workerPolicy = null) => {
  if (PROFILE_NAMES.indexOf(profile) < 0) return null
  if (!Array.isArray(visibleNames)) return null
  const visibleList = visibleNames.filter((n) => typeof n === 'string' && n !== '')
  const visible = new Set(visibleList)
  const workerAllow = workerPolicy !== null && workerPolicy !== undefined ? normalizeWorkerSet(workerPolicy.allow) : new Set()
  const workerDeny = workerPolicy !== null && workerPolicy !== undefined ? normalizeWorkerSet(workerPolicy.deny) : new Set()
  if (profile === 'full') {
    if (workerDeny.size === 0) return null
    const hasRevokedVisible = [...workerDeny].some((name) => visible.has(name))
    if (!hasRevokedVisible) return null
    const allow = visibleList.filter((name, idx) => !workerDeny.has(name) && visibleList.indexOf(name) === idx)
    if (allow.length < MIN_ALLOWED) return null
    return { allow }
  }
  const extra = Array.isArray(named) ? named.filter((n) => NAMED_TOOLS.indexOf(n) >= 0) : []
  const wanted = CORE_TOOLS.concat(PROFILE_TOOLS[profile] === undefined ? [] : PROFILE_TOOLS[profile], extra, [...workerAllow])
  const allow = []
  for (const name of wanted) {
    if (workerDeny.has(name)) continue
    if (visible.has(name) && allow.indexOf(name) < 0) allow.push(name)
  }
  // A filter that keeps almost nothing is a bug, not an economy: fall back to full.
  if (allow.length < MIN_ALLOWED) return null
  return { allow }
}

/**
 * The tool names the engine refused as "unknown global" in a `tools.restrict()` error.
 *
 * `restrict` only accepts tools the agent INHERITS (the global layer and its ancestors). A tool registered in the
 * agent's own layer (`subagent` on the 0.2.2 engine) is visible to the agent but is not restrictable, so a filter
 * naming it is refused whole: `names unknown global tool "subagent"; known global tools: ...`.
 *
 * @param {unknown} error what `tools.restrict()` threw
 * @returns {string[]} the refused names, or [] when the error is not that refusal
 */
export const unknownGlobalNames = (error) => {
  try {
    const text = String(error !== null && typeof error === 'object' && error.message !== undefined ? error.message : error)
    const quoted = /names unknown global tools? ((?:"[^"]*"(?:, )?)+);/.exec(text)
    if (quoted === null) return []
    return [...quoted[1].matchAll(/"([^"]*)"/g)].map((m) => m[1])
  } catch (e) { return [] }
}

/**
 * A filter without the given names. Those names are not lost: a tool the engine does not let us name is exempt from
 * the restriction and stays visible anyway.
 *
 * @param {{allow: string[]}} filter a filter built by {@link filterFor}
 * @param {string[]} names the names to drop
 * @returns {{allow: string[]}|null} the narrowed filter, or null when what is left is too small
 */
export const withoutNames = (filter, names) => {
  const dropped = new Set(names)
  const allow = filter.allow.filter((name) => !dropped.has(name))
  return allow.length < MIN_ALLOWED ? null : { allow }
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
 * @returns {{mode: string, profiles: Map<string, string>}} a small diagnostic handle
 */
export function mountToolProfiles(ctx, options = {}) {
  const mode = readMode(options.env === undefined ? process.env : options.env)
  const profiles = new Map()
  const decided = new WeakSet()
  // What was installed on an agent (profile, filter, undo), so that a first message naming a NAMED_TOOLS tool can widen a
  // restriction made at creation, once, before the first request.
  const installed = new WeakMap()
  if (mode === 'off') return { mode, profiles }
  if (ctx === null || ctx === undefined || typeof ctx.on !== 'function') return { mode: 'unavailable', profiles }

  const serviceOf = (agent, name) => {
    try { return agent.ctx.get(name) } catch (e) { return undefined }
  }
  const globalCount = (tools) => {
    try { const all = tools.schemas(); return Array.isArray(all) ? all.length : -1 } catch (e) { return -1 }
  }

  const policyOf = (agent) => {
    if (typeof options.workerPolicyFor !== 'function') return null
    try {
      const scopeInfo = resolveProvenAgentScope(agent, options)
      return options.workerPolicyFor(agent, scopeInfo) ?? null
    } catch (e) { return null }
  }

  const install = (agent, profile, text, withNote = true) => {
    if (profile === null || profile === undefined) return false
    const workerPolicy = policyOf(agent)
    if (profile === 'full' && (workerPolicy === null || !Array.isArray(workerPolicy.deny) || workerPolicy.deny.length === 0)) return false
    const tools = serviceOf(agent, 'tools')
    if (tools === undefined || tools === null || typeof tools.restrict !== 'function') return false
    if (alreadyRequested(agent) === true) return false
    const visible = visibleNamesOf(tools, agent)
    let filter = filterFor(profile, visible, namedTools(text), workerPolicy)
    if (filter === null) return false
    // Prove the filter is scoped BEFORE trusting it: a global leak would copy this economy
    // rule onto every chat. Undo it and keep the full surface when the global count moves.
    const before = globalCount(tools)
    let undo
    let exempt = 0
    try {
      undo = tools.restrict(filter)
    } catch (e) {
      // The engine refuses the WHOLE filter when it names a tool of the agent's own layer. Those tools are exempt
      // from any restriction anyway, so name only the others and ask once more.
      const refused = unknownGlobalNames(e)
      const narrowed = refused.length === 0 ? null : withoutNames(filter, refused)
      try {
        if (narrowed === null) throw e
        undo = tools.restrict(narrowed)
        exempt = filter.allow.length - narrowed.allow.length
        filter = narrowed
      } catch (retryError) {
        // Still refused (an unknown or scope-local name in another deployment): the session keeps its
        // full surface, the safe fallback.
        console.error('[kybernos] tool profile "' + profile + '" not applied: ' + String((retryError && retryError.message) || retryError))
        return false
      }
    }
    const after = globalCount(tools)
    if (before >= 0 && after >= 0 && after !== before) {
      try { if (typeof undo === 'function') undo() } catch (e) { /* nothing more to do */ }
      console.error('[kybernos] tool profile "' + profile + '" refused: the restriction was not scoped, full surface kept')
      return false
    }
    profiles.set(String(agent.id === undefined ? '' : agent.id), profile)
    installed.set(agent, { profile, filter, undo, visible })
    const sid = (() => { try { return String(agent.session.id || '') } catch (e) { return '' } })()
    console.log('[kybernos] tool profile "' + profile + '" on ' + (sid === '' ? 'an agent' : sid) + ': ' + String(filter.allow.length + exempt) + ' of ' + String(visible.length) + ' tools kept')
    if (withNote !== true) return true
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
      if (payload.source !== undefined && payload.source !== 'fresh') { decided.add(agent); return }
      if (alreadyRequested(agent) === true) { decided.add(agent); return }
      const profile = classify(agent, '')
      if (profile === 'full') {
        const wp = policyOf(agent)
        if (wp === null || !Array.isArray(wp.deny) || wp.deny.length === 0) return
        decided.add(agent)
        install(agent, 'full', '', false)
        return
      }
      decided.add(agent)
      install(agent, profile)
    } catch (e) { /* never break agent creation */ }
  }
  const onClaimed = (payload) => {
    try {
      const agent = payload === null || payload === undefined ? undefined : payload.agent
      if (agent === null || agent === undefined) return
      if (decided.has(agent)) {
        // Restricted at creation (a code workspace) before any message: when the first human message names a tool the
        // run exists for, the restriction is made again with it, once, while no request has been sent yet.
        const was = installed.get(agent)
        if (was === undefined || was.widened === true) return
        const text = claimedText(payload.message)
        if (text === '') return
        was.widened = true
        const missing = namedTools(text).filter((name) => was.visible.indexOf(name) >= 0 && was.filter.allow.indexOf(name) < 0)
        if (missing.length === 0 || alreadyRequested(agent) === true) return
        try { if (typeof was.undo === 'function') was.undo() } catch (e) { return }
        if (install(agent, was.profile, text, false) === true) installed.get(agent).widened = true
        else installed.delete(agent)
        return
      }
      const text = claimedText(payload.message)
      if (text === '') return
      decided.add(agent)
      install(agent, classify(agent, text), text)
    } catch (e) { /* never break a turn */ }
  }
  try { ctx.on('agent/created', onCreated) } catch (e) { /* optional seam */ }
  try { ctx.on('agent/inbox/claimed', onClaimed) } catch (e) { /* optional seam */ }
  return { mode, profiles }
}

let harnessPolicyCache = { path: '', mtimeMs: -1, data: null }

/**
 * Reads the active worker policy for a proven DSH scope (`automation` -> `preset:<id>` -> `default`)
 * from `$DSH_HOME/kybernos-workers/harness.json`. Never throws; returns null when absent or empty.
 *
 * @param {{scopes?: string[]}|null|undefined} scopeInfo output of {@link resolveProvenAgentScope}
 * @param {string} [dshHome] optional DSH home override (tests)
 * @returns {{allow: string[], deny: string[]}|null}
 */
export const readHarnessWorkerPolicy = (scopeInfo, dshHome) => {
  try {
    const scopes = scopeInfo !== null && scopeInfo !== undefined && Array.isArray(scopeInfo.scopes) ? scopeInfo.scopes : ['default']
    const root = typeof dshHome === 'string' && dshHome !== '' ? dshHome : (process.env.DSH_HOME || join(homedir(), '.dsh'))
    const filePath = join(root, 'kybernos-workers', 'harness.json')
    let mtimeMs = -1
    try { mtimeMs = statSync(filePath).mtimeMs } catch (e) { mtimeMs = -1 }
    let parsed = null
    if (mtimeMs < 0) {
      harnessPolicyCache = { path: filePath, mtimeMs: -1, data: null }
    } else if (harnessPolicyCache.path === filePath && harnessPolicyCache.mtimeMs === mtimeMs) {
      parsed = harnessPolicyCache.data
    } else {
      try { parsed = JSON.parse(readFileSync(filePath, 'utf8')) } catch (e) { parsed = null }
      harnessPolicyCache = { path: filePath, mtimeMs, data: parsed }
    }
    const policies = parsed !== null && typeof parsed === 'object' && parsed.policies !== null && typeof parsed.policies === 'object' ? parsed.policies : null
    let allow = []
    let deny = []
    if (policies !== null) {
      for (const sc of scopes) {
        const pol = policies[sc]
        if (pol !== null && pol !== undefined && typeof pol === 'object') {
          const a = Array.isArray(pol.allow) ? pol.allow : []
          const d = Array.isArray(pol.deny) ? pol.deny : []
          if (a.length > 0 || d.length > 0) { allow = a.slice(); deny = d.slice(); break }
        }
      }
    }
    // Also expose the user's explicitly selected Composer external worker (if not denied by scope policy).
    try {
      const activePath = join(root, 'kybernos-workers', 'active-worker.json')
      if (existsSync(activePath)) {
        const active = JSON.parse(readFileSync(activePath, 'utf8'))
        const toolName = normalizeWorkerTool(active?.toolName ?? active?.driverId)
        const deniedSet = normalizeWorkerSet(deny)
        if (toolName !== null && !deniedSet.has(toolName) && allow.indexOf(toolName) < 0) allow.push(toolName)
      }
    } catch (e) { /* missing or unreadable active-worker.json is ignored */ }
    if (allow.length > 0 || deny.length > 0) return { allow, deny }
  } catch (e) { /* missing or unreadable harness policy degrades to default */ }
  return null
}

/**
 * Execution-time revocation guard for delegated external workers (`tools/pre-execute`).
 * Complements the start-of-session single-pass `tools.restrict()` filter so revoking a worker also blocks
 * the next delegation in an already-open session or an unrestricted (`full`) session without mutating the
 * prompt prefix or spawning a subprocess.
 *
 * @param {object} ctx the plugin's cordis host context
 * @param {{workerPolicyFor?: (agent: object, scopeInfo: object) => ({allow?: string[], deny?: string[]}|null), automationScope?: (agent: object) => string|boolean|null|undefined}} [options]
 * @returns {boolean} true when the listener was installed
 */
export function mountWorkerExecutionGuard(ctx, options = {}) {
  if (ctx === null || ctx === undefined || typeof ctx.on !== 'function') return false
  if (typeof options.workerPolicyFor !== 'function') return false
  try {
    ctx.on('tools/pre-execute', async (exec, next) => {
      try {
        if (exec !== null && exec !== undefined && isWorkerTool(exec.name)) {
          const scopeInfo = resolveProvenAgentScope(exec.agent, options)
          const policy = options.workerPolicyFor(exec.agent, scopeInfo)
          const denied = policy !== null && policy !== undefined ? normalizeWorkerSet(policy.deny) : new Set()
          if (denied.has(exec.name)) {
            return {
              kind: 'deny',
              reason: 'Worker tool "' + exec.name + '" is disabled for scope "' + scopeInfo.scope + '" by the current Workers policy.',
            }
          }
        }
      } catch (e) { /* never block unrelated tools on a policy read failure */ }
      return next()
    })
    return true
  } catch (e) { return false }
}
