#!/usr/bin/env node
// Tool profiles (2026-10-28): classification, core-tool preservation, conservative
// fallback, single decision per session, synchronous scoped installation, global-leak guard.
//
// No engine and no network: a fake host context carries only the seams the profiler uses
// (`agent/created`, `agent/inbox/claimed`, `agent.ctx.get('tools'|'systemPrompt')`), and a
// fake tool registry that mirrors the native `ToolRuntime`: a global view, a per-scope
// `restrict({ allow })` view, and an opt-in "not scoped" failure mode used to prove the
// global-leak guard. The last block applies the filter to the REAL tool universe of this
// machine's coding session (names read from a `request/header`, kept as data here) and
// measures how many tools a coding session keeps.
//
//   node packages/kybernos-plugin/test-tool-profiles.mjs   (exit 0 = all pass)
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  CORE_TOOLS, PROFILE_TOOLS, PROFILE_NAMES, TOOL_PROFILES_ENV, claimedText, filterFor, looksLikeCodeWorkspace,
  mountToolProfiles, profileFor, profileNote,
} from './tool-profiles.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))

// ── The real tool universe of a coding session on this machine (80 names, from the
// `request/header` of a live session journal, 2026-10-28). Kept as data so the test can
// measure the profile without reading a personal session log.
const LIVE_TOOL_UNIVERSE = [
  'ask_user_question', 'automation_home', 'automation_suggest', 'bash', 'cordis_inspect_list', 'cordis_inspect_query',
  'create_goal', 'edit', 'enregistrer_entree', 'exit_plan_mode', 'get_goal', 'glob', 'grep', 'instructions_suggest',
  'interrupt_agent', 'job_kill', 'job_list', 'job_output', 'kaby_account', 'kaby_journal', 'kaby_knowledge',
  'lesson_search', 'lesson_write', 'list_agents', 'list_mcp_resource_templates', 'list_mcp_resources',
  'mcp__horloge__now', 'mcp__horloge__secret_probe', 'mcp__lsp__lsp_definition', 'mcp__lsp__lsp_diagnostics',
  'mcp__lsp__lsp_format', 'mcp__lsp__lsp_hover', 'mcp__lsp__lsp_references', 'mcp__lsp__lsp_symbols',
  'memory_search', 'memory_suggest', 'memory_write', 'plugin_manager', 'present', 'read', 'read_image',
  'read_mcp_resource', 'relancer_dsh', 'schedule_create', 'schedule_delete', 'schedule_list', 'schedule_update',
  'send_message', 'session_event_read', 'session_event_search', 'session_event_trace', 'session_search',
  'session_trace', 'skill', 'skill_improve', 'skill_propose', 'skill_scout', 'spawn_teammate', 'subagent',
  'subagent_claude_code', 'subagent_codex', 'subagent_fork', 'team_task_create', 'team_task_get', 'team_task_list',
  'team_task_update', 'terminal_close', 'terminal_list', 'terminal_open', 'terminal_read', 'terminal_send',
  'terminal_signal', 'todo_write', 'update_goal', 'wait_agent', 'web_fetch', 'web_search', 'workflow',
  'working_directory', 'write',
]

// ── A fake native tool registry: a global layer, per-scope `restrict({allow})` views, and
// a `leak` mode that shrinks the global layer instead (an engine without the caller-context
// shadow) so the guard can be proven.
const makeRegistry = (names) => {
  const global = new Map(names.map((name) => [name, { name, description: 'fake ' + name, parameters: { type: 'object', properties: {} } }]))
  const scoped = new Map()
  const state = { global, scoped, leak: false, calls: [] }
  state.facadeFor = (agent) => ({
    schemas: (scope) => {
      if (scope === undefined) return [...global.values()]
      const allow = scoped.get(scope)
      return allow === undefined ? [...global.values()] : [...allow].map((name) => global.get(name)).filter((d) => d !== undefined)
    },
    restrict: (filter) => {
      state.calls.push(filter)
      if (filter === null || typeof filter !== 'object' || Array.isArray(filter.allow) === false) throw new Error('tools.restrict(): allow required')
      for (const name of filter.allow) if (global.has(name) === false) throw new Error('tools.restrict() names unknown global tool "' + name + '"')
      if (state.leak === true) {
        const removed = []
        for (const name of [...global.keys()]) if (filter.allow.indexOf(name) < 0) { removed.push([name, global.get(name)]); global.delete(name) }
        return () => { for (const [name, definition] of removed) global.set(name, definition) }
      }
      scoped.set(agent, new Set(filter.allow))
      return () => { scoped.delete(agent) }
    },
  })
  return state
}

const makeHost = () => {
  const handlers = new Map()
  return {
    handlers,
    ctx: { on: (event, handler) => { handlers.set(event, handler) } },
    emit: (event, payload) => {
      const handler = handlers.get(event)
      if (handler === undefined) return undefined
      return handler(payload)
    },
  }
}

const userMsg = (text) => ({ content: [{ type: 'text', text }], source: { kind: 'user' } })

const makeAgent = ({ id, cwd, requestHeader, registry }) => {
  const sections = []
  const prompt = { section: (section) => { sections.push(section); return () => {} } }
  const agent = { id, session: { cwd, header: cwd === undefined ? undefined : { cwd }, requestHeader }, ctx: undefined }
  agent.ctx = {
    get: (name) => {
      if (name === 'tools') return registry === undefined ? undefined : registry.facadeFor(agent)
      if (name === 'systemPrompt') return prompt
      return undefined
    },
  }
  return { agent, sections }
}

console.log('classification')
assert.equal(PROFILE_NAMES.join(','), 'code,office,automation,full')
assert.equal(PROFILE_TOOLS.full, undefined, 'full is the fallback, not a tool set')
assert.equal(profileFor({ cwd: '/tmp', text: '' }), 'full', 'nothing to go on: full')
assert.equal(profileFor({ cwd: join(here, '..', '..') }), 'code', 'a code checkout (package.json + .git) is a coding workspace')
assert.equal(looksLikeCodeWorkspace(here), true)
assert.equal(looksLikeCodeWorkspace('/tmp/nope'), false)
assert.equal(profileFor({ cwd: '/tmp', text: 'fix the failing test and commit the patch' }), 'code')
assert.equal(profileFor({ cwd: '/tmp', text: 'write a report on the supplier contract as a spreadsheet' }), 'office')
assert.equal(profileFor({ cwd: '/tmp', text: 'schedule a cron automation that collects prospects every day' }), 'automation')
assert.equal(profileFor({ cwd: '/tmp', text: 'what is the weather' }), 'full', 'an unclear task stays on the full surface')
assert.equal(profileFor({ cwd: join(here, '..', '..'), text: 'write a report as a spreadsheet' }), 'office', 'two office signals beat the code checkout')
assert.equal(profileFor({ cwd: '/tmp', text: 'schedule the automation' }), 'automation')
// The person's language comes from the data file next to the module (task-keywords.json): a French task is classified too.
assert.equal(profileFor({ cwd: '/tmp', text: 'écris le compte rendu de la réunion et la facture du contrat' }), 'office')
assert.equal(profileFor({ cwd: '/tmp', text: 'relance la collecte nocturne de prospection' }), 'automation')
assert.equal(profileFor({}), 'full', 'an empty input never fails')
assert.equal(profileFor(undefined), 'full')
ok('code/office/automation from the task, code from the workspace, full when uncertain')

console.log('filter')
{
  const code = filterFor('code', LIVE_TOOL_UNIVERSE)
  assert.ok(code !== null)
  for (const core of CORE_TOOLS) assert.ok(code.allow.indexOf(core) >= 0, 'core tool kept: ' + core)
  assert.ok(code.allow.indexOf('mcp__lsp__lsp_diagnostics') >= 0)
  assert.ok(code.allow.indexOf('memory_write') < 0, 'an office tool is hidden from a coding session')
  assert.ok(code.allow.indexOf('schedule_create') < 0)
  assert.ok(code.allow.length <= 35, 'a coding session keeps at most 35 tools (' + code.allow.length + ')')
  const office = filterFor('office', LIVE_TOOL_UNIVERSE)
  assert.ok(office.allow.indexOf('memory_write') >= 0)
  assert.ok(office.allow.indexOf('kaby_knowledge') >= 0)
  assert.ok(office.allow.indexOf('mcp__lsp__lsp_diagnostics') < 0)
  const automation = filterFor('automation', LIVE_TOOL_UNIVERSE)
  assert.ok(automation.allow.indexOf('schedule_create') >= 0)
  assert.ok(automation.allow.indexOf('automation_suggest') >= 0)
  assert.equal(filterFor('full', LIVE_TOOL_UNIVERSE), null, 'full means no filter')
  assert.equal(filterFor('nonsense', LIVE_TOOL_UNIVERSE), null)
  // A deployment missing almost every tool: the filter would keep too little, so no
  // restriction at all (a task must never lose its shell to an economy rule).
  assert.equal(filterFor('code', ['read', 'bash']), null)
  // Unknown names in the wanted list are dropped, never passed to restrict (it throws).
  const partial = filterFor('code', ['read', 'write', 'edit', 'glob', 'grep', 'bash', 'job_list', 'todo_write', 'ask_user_question', 'present', 'skill', 'working_directory', 'subagent'])
  assert.ok(partial !== null)
  assert.deepEqual(partial.allow, ['read', 'write', 'edit', 'glob', 'grep', 'bash', 'job_list', 'todo_write', 'ask_user_question', 'present', 'skill', 'working_directory', 'subagent'])
  assert.equal(profileNote('full'), '')
  assert.match(profileNote('code'), /tool profile chosen at session start/)
  ok('intersection with visible tools, core kept, other-task tools hidden, full/short-universe fallback')
}

console.log('mount')
{
  // A code workspace is decided at agent creation, BEFORE the first step: the restriction is
  // in place for the very first assembly (no first-request window on the full surface).
  const host = makeHost()
  const registry = makeRegistry(LIVE_TOOL_UNIVERSE)
  const mounted = mountToolProfiles(host.ctx, { env: {}, exists: (p) => existsSync(p) })
  assert.equal(mounted.mode, 'auto')
  const { agent, sections } = makeAgent({ id: 'a1', cwd: join(here, '..', '..'), requestHeader: () => undefined, registry })
  host.emit('agent/created', { agent, source: 'fresh' })
  assert.ok(registry.scoped.has(agent), 'the restriction is installed at session start')
  const allow = [...registry.scoped.get(agent)]
  assert.ok(allow.indexOf('bash') >= 0)
  assert.ok(allow.indexOf('memory_write') < 0)
  assert.equal(sections.length, 1)
  assert.equal(sections[0].name, 'kybernos:tool-profile')
  assert.equal(sections[0].text(), profileNote('code'), 'the note is byte-identical on every assembly')
  // no re-decision on later turns (no mid-session tool churn)
  host.emit('agent/inbox/claimed', { agent, message: userMsg('now write a report as a spreadsheet'), turn: 1 })
  assert.equal(registry.calls.length, 1, 'the profile is decided once')
  ok('code workspace: one restriction at creation, one stable note, no later change')
}
{
  // A workspace that does not say what the session is: the first human message decides, in
  // the same synchronous tick (before the first assembly), and never changes afterwards.
  const host = makeHost()
  const registry = makeRegistry(LIVE_TOOL_UNIVERSE)
  mountToolProfiles(host.ctx, { env: {}, exists: () => false })
  const { agent, sections } = makeAgent({ id: 'a2', cwd: '/tmp', requestHeader: () => undefined, registry })
  host.emit('agent/created', { agent, source: 'fresh' })
  assert.equal(registry.scoped.has(agent), false, 'an unclear workspace waits for the task')
  host.emit('agent/inbox/claimed', { agent, message: userMsg('write a report on the supplier contract as a spreadsheet'), turn: 1 })
  assert.ok(registry.scoped.has(agent))
  assert.ok([...registry.scoped.get(agent)].indexOf('memory_write') >= 0, 'office profile chosen from the first message')
  assert.equal(sections.length, 1)
  host.emit('agent/inbox/claimed', { agent, message: userMsg('fix the failing test'), turn: 2 })
  assert.equal(registry.calls.length, 1, 'the profile is decided once')
  ok('unclear workspace: decided on the first human message, same tick, then fixed')
}
{
  const host = makeHost()
  const registry = makeRegistry(LIVE_TOOL_UNIVERSE)
  const mounted = mountToolProfiles(host.ctx, { env: { [TOOL_PROFILES_ENV]: 'office' }, exists: () => false })
  assert.equal(mounted.mode, 'office')
  const { agent } = makeAgent({ id: 'a3', cwd: '/tmp', requestHeader: () => undefined, registry })
  host.emit('agent/inbox/claimed', { agent, message: userMsg('fix a bug'), turn: 1 })
  assert.ok([...registry.scoped.get(agent)].indexOf('memory_write') >= 0, 'the switch forces the profile')
  ok('KYBERNOS_TOOL_PROFILES forces a profile')
}
{
  const host = makeHost()
  const registry = makeRegistry(LIVE_TOOL_UNIVERSE)
  const mounted = mountToolProfiles(host.ctx, { env: { [TOOL_PROFILES_ENV]: 'full' }, exists: () => false })
  assert.equal(mounted.mode, 'off')
  assert.equal(host.handlers.has('agent/created'), false, 'no listener when disabled')
  ok('KYBERNOS_TOOL_PROFILES=full disables the profiler')
}
{
  const host = makeHost()
  const registry = makeRegistry(LIVE_TOOL_UNIVERSE)
  mountToolProfiles(host.ctx, { env: {}, exists: () => false })
  // A resumed session, or one that already sent a request, must not have its surface changed.
  const { agent, sections } = makeAgent({ id: 'a4', cwd: join(here, '..', '..'), requestHeader: () => undefined, registry })
  host.emit('agent/created', { agent, source: 'resume' })
  assert.equal(registry.scoped.has(agent), false)
  const { agent: sent, sections: sentSections } = makeAgent({ id: 'a5', cwd: join(here, '..', '..'), requestHeader: () => ({ config: {}, tools: [] }), registry })
  host.emit('agent/created', { agent: sent, source: 'fresh' })
  assert.equal(registry.scoped.has(sent), false, 'a session that already sent a request is left alone')
  assert.equal(sections.length + sentSections.length, 0)
  ok('resumed and already-requesting sessions are left alone')
}
{
  const host = makeHost()
  mountToolProfiles(host.ctx, { env: {}, exists: () => false })
  // No `tools` service at all (a bare composition): the profiler must not throw.
  const { agent } = makeAgent({ id: 'a6', cwd: join(here, '..', '..'), requestHeader: () => undefined, registry: undefined })
  host.emit('agent/created', { agent, source: 'fresh' })
  ok('no tools service: the session keeps every tool, nothing throws')
}
{
  const host = makeHost()
  const registry = makeRegistry(LIVE_TOOL_UNIVERSE)
  mountToolProfiles(host.ctx, { env: {}, exists: () => false })
  const { agent, sections } = makeAgent({ id: 'a7', cwd: '/tmp', requestHeader: () => undefined, registry })
  const refused = { schemas: () => LIVE_TOOL_UNIVERSE.map((name) => ({ name })), restrict: () => { throw new Error('scope-local name in filter') } }
  agent.ctx.get = (name) => (name === 'tools' ? refused : undefined)
  host.emit('agent/created', { agent, source: 'fresh' })
  host.emit('agent/inbox/claimed', { agent, message: userMsg('fix the failing test'), turn: 1 })
  assert.equal(sections.length, 0, 'a refused filter adds no note either: the session is simply unrestricted')
  ok('a refused restriction is a safe fallback (full surface), never a boot failure')
}
{
  // An engine whose `ctx.get(service).restrict(...)` is NOT scoped would shrink EVERY
  // session: the guard must detect it, undo it, and keep the full surface.
  const host = makeHost()
  const registry = makeRegistry(LIVE_TOOL_UNIVERSE)
  registry.leak = true
  mountToolProfiles(host.ctx, { env: {}, exists: () => false })
  const { agent, sections } = makeAgent({ id: 'a8', cwd: '/tmp', requestHeader: () => undefined, registry })
  host.emit('agent/inbox/claimed', { agent, message: userMsg('fix the failing test'), turn: 1 })
  assert.equal(registry.global.size, LIVE_TOOL_UNIVERSE.length, 'the global surface is kept whole')
  assert.equal(registry.scoped.has(agent), false)
  assert.equal(sections.length, 0)
  ok('global-leak guard: an unscoped restriction is undone, full surface kept')
}
{
  const host = makeHost()
  const registry = makeRegistry(LIVE_TOOL_UNIVERSE)
  mountToolProfiles(host.ctx, { env: {}, exists: () => false })
  const { agent } = makeAgent({ id: 'a9', cwd: '/tmp', requestHeader: () => undefined, registry })
  // Injected context and goal rounds must not decide the profile: only a human prompt does.
  host.emit('agent/inbox/claimed', { agent, message: { content: [{ type: 'image', data: 'x' }], source: { kind: 'user' } }, turn: 1 })
  assert.equal(registry.scoped.has(agent), false)
  assert.equal(claimedText({ content: [{ type: 'text', text: 'continue the goal' }], source: { kind: 'goal' } }), '')
  host.emit('agent/inbox/claimed', { agent, message: userMsg('fix the failing test and commit'), turn: 2 })
  assert.ok(registry.scoped.has(agent))
  ok('a message without human text does not decide the profile; the next human one does')
}

console.log('measure')
{
  const before = LIVE_TOOL_UNIVERSE.length
  const code = filterFor('code', LIVE_TOOL_UNIVERSE)
  const office = filterFor('office', LIVE_TOOL_UNIVERSE)
  const automation = filterFor('automation', LIVE_TOOL_UNIVERSE)
  console.log('    full: ' + before + ' tools')
  console.log('    code: ' + code.allow.length + ' tools')
  console.log('    office: ' + office.allow.length + ' tools')
  console.log('    automation: ' + automation.allow.length + ' tools')
  assert.ok(code.allow.length <= 35, 'the coding profile stays within the 35-tool target')
  ok('measured on the real tool universe: code profile ' + code.allow.length + '/' + before)
}

console.log('\n' + pass + ' checks passed')
