// ── Deduplication of the memory + team-lesson blocks: per-agent SECTIONS, not durable CONTEXTS ──────────
// Standalone host suite (node + assert, no framework), throwaway stores only: DSH_HOME,
// KYBERNOS_CLOUD_STATE, KYBERNOS_CLOUD_KYBERS and KYBERNOS_MEMORY_SETTINGS point into a temp folder,
// never ~/.dsh, and KYBERNOS_CLOUD_API targets a closed local port (nothing leaves the machine).
//
// The engine is modelled by a fake ctx: `inject(['systemPrompt'])` yields a scope whose `section()` and
// `context()` record registrations per layer, and every agent carries its own ctx (as DSH's Agent does).
// What is proven:
//   (a) no `systemPrompt.context` remains for `kybernos:memory` / `kybernos:team-lessons` on the new path,
//       while the host-level `kybernos:memory-off` section is still installed (the proxy reads it there);
//   (b) one section per agent is installed at mount and for later `agent/created`, disposed on
//       `agent/disposed`;
//   (c) three assemblies of the same session are byte-identical and carry ONE block each;
//   (d) a memory removed from the cache leaves the next assembly;
//   (e) memory/context off -> the `[KYBERNOS MEMORY OFF]` marker;
//   (f) a team space -> the team note as the memory block, the `[KYBERNOS TEAM LESSONS]` block for lessons,
//       and never the person's own memory content;
//   (g) an unreadable seam falls back to the historical `context`, and an agent whose seam refuses after a
//       section exists never gets a global context on top (no double block).
//
//   node packages/kybernos-cloud/test-prompt-dedup.mjs
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'kybernos-cloud-dedup-'))
const statePath = join(root, 'state.json')
const kybers = join(root, 'kybers')
mkdirSync(join(kybers, '.active'), { recursive: true })
process.env.DSH_HOME = root
process.env.KYBERNOS_CLOUD_STATE = statePath
process.env.KYBERNOS_CLOUD_KYBERS = kybers
process.env.KYBERNOS_MEMORY_SETTINGS = join(root, 'kybernos-memory.json')
process.env.KYBERNOS_CLOUD_API = 'http://127.0.0.1:1'
process.env.KYBERNOS_SERVERS_FILE = join(root, 'servers.json')

const SESSION = 'sess-cloud-dedup-01'
const MEMORY_NAME = 'kybernos:memory'
const TEAM_NAME = 'kybernos:team-lessons'
const MEMORY_MARK = '[KYBERNOS MEMORY]'
const OFF_MARK = '[KYBERNOS MEMORY OFF]'
const TEAM_MARK = '[KYBERNOS TEAM LESSONS]'
let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const occurrences = (text, needle) => text.split(needle).length - 1

const token = 'kys-' + 'a'.repeat(43)
const PERSONAL = { token, user: { name: 'Test' }, workspaces: [{ id: 'ws-p', name: 'Perso', personal: true }], active_workspace_id: 'ws-p' }
const TEAM = { token, user: { name: 'Test' }, workspaces: [{ id: 'ws-team', name: 'Atelier Nord', personal: false }], active_workspace_id: 'ws-team', space_plan: { workspace_id: 'ws-team', key: 'team-solo' } }
const writeState = (state) => writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n')
const settingsPath = join(root, 'state-memory.json')     // readSide('memory') lives next to the state file
const writeSettings = (settings) => writeFileSync(settingsPath, JSON.stringify(settings) + '\n')
const mkMem = (id, pinned, createdAt, content, kind = 'fact') => ({ id, scope: 'account', kyberId: null, kind, content, source: 'conversation', pinned, retentionDays: 180, expiresAt: null, createdAt })

// ── Fake engine: one registry layer per agent (and one host/global layer) ───────────────────────────────
const createEngine = ({ withAgents = true } = {}) => {
  const layers = new Map()
  const handlers = new Map()
  const live = []
  const layerOf = (key) => {
    let layer = layers.get(key)
    if (layer === undefined) { layer = { sections: new Map(), contexts: new Map() }; layers.set(key, layer) }
    return layer
  }
  const service = (key) => {
    const layer = layerOf(key)
    return {
      section: (entry) => {
        assert.equal(typeof entry.name, 'string')
        assert.equal(Number.isFinite(entry.order), true)
        assert.equal(typeof entry.text, 'function', 'the text is a provider, evaluated at each assembly')
        assert.equal(layer.sections.has(entry.name), false, 'one registration per name in one layer')
        layer.sections.set(entry.name, entry)
        return () => layer.sections.delete(entry.name)
      },
      context: (entry) => {
        assert.equal(Number.isFinite(entry.order), true)
        assert.equal(typeof entry.text, 'function')
        layer.contexts.set(entry.name, entry)
        return () => layer.contexts.delete(entry.name)
      },
    }
  }
  const makeAgent = (id) => {
    const key = 'agent:' + id
    const own = { disposed: false }
    const fiber = { dispose: async () => { own.disposed = true; const layer = layerOf(key); layer.sections.clear(); layer.contexts.clear() } }
    const agent = {
      session: { id },
      ctx: {
        inject: (deps, cb) => {
          assert.ok(deps.includes('systemPrompt'), 'the seam asks the engine for systemPrompt')
          cb({ systemPrompt: service(key) })
          return fiber
        },
      },
    }
    live.push(agent)
    return { agent, own }
  }
  const ctx = {
    get: (name) => {
      if (name === 'agents') return withAgents === true ? { list: () => live.slice() } : undefined
      return undefined
    },
    inject: (deps, cb) => {
      // Optional services are simply absent (settings/credentials): their callers are guarded, and the
      // seam we test is systemPrompt/webServer/tools.
      if (deps.some((name) => name === 'settings' || name === 'credentials')) return { dispose: async () => {} }
      cb({ systemPrompt: service('host'), webServer: { register: () => () => {} }, tools: { register: () => () => {} } })
      return { dispose: async () => {} }
    },
    effect: (fn) => { const d = fn(); void d },
    on: (event, fn) => { handlers.set(event, (handlers.get(event) || []).concat([fn])) },
    emit: (event, payload) => { for (const fn of handlers.get(event) || []) fn(payload) },
  }
  return { ctx, makeAgent, layers, layerOf, emit: ctx.emit }
}

rmSync(statePath, { force: true })     // disconnected at apply: no boot refresh tries the (closed) API
const mod = await import('./index.js')

try {
  console.log('kybernos-cloud — prompt dedup (per-agent sections)')

  // ── (a)(b)(c) the new path ──────────────────────────────────────────────
  const engine = createEngine()
  const first = engine.makeAgent(SESSION)
  mod.apply(engine.ctx)
  writeState(PERSONAL)     // the plugin reads the state file at every assembly
  mod.memoryCache.account = [
    mkMem(1, false, '2026-10-01T10:00:00Z', 'the deployment goes through Fly.io'),
    mkMem(2, true, '2026-10-02T10:00:00Z', 'the person prefers French in every conversation'),
    mkMem(3, true, '2026-10-03T10:00:00Z', 'safety: never publish a page without the person\'s approval', 'policy'),
  ]
  mod.memoryCache.kyber = {}
  mod.memoryCache.at = Date.now()
  const host = engine.layerOf('host')
  assert.equal(host.contexts.has(MEMORY_NAME), false, '(a) no durable context for the account memory on the new path')
  assert.equal(host.contexts.has(TEAM_NAME), false, '(a) no durable context for the team lessons on the new path')
  assert.ok(host.sections.has('kybernos:memory-off'), '(a) the host-level memory-off section is still installed (the proxy reads it in the system prompt)')
  assert.equal(host.sections.get('kybernos:memory-off').text(), '', 'personal space: the off section is empty')
  const agentLayer = () => engine.layerOf('agent:' + SESSION)
  assert.ok(agentLayer().sections.has(MEMORY_NAME), '(b) a memory section was installed for the agent alive at mount')
  assert.ok(agentLayer().sections.has(TEAM_NAME), '(b) a team-lessons section was installed for the agent alive at mount')
  assert.equal(agentLayer().sections.size, 2, 'exactly the two blocks: nothing else is registered per agent')
  const memoryText = () => agentLayer().sections.get(MEMORY_NAME).text()
  const teamText = () => agentLayer().sections.get(TEAM_NAME).text()
  const m1 = memoryText()
  const m2 = memoryText()
  const m3 = memoryText()
  assert.equal(m1, m2, '(c) assembly 2 is byte-identical to assembly 1')
  assert.equal(m2, m3, '(c) assembly 3 is byte-identical to assembly 2')
  assert.ok(m1.startsWith(MEMORY_MARK), 'the memory marker still leads the block')
  assert.equal(occurrences(m1, MEMORY_MARK), 1, '(c) exactly one memory block exists')
  assert.ok(m1.includes('the deployment goes through Fly.io') && m1.includes('the person prefers French'), 'the memories are there')
  assert.ok(m1.includes('safety: never publish a page'), 'a pinned policy is visible without any question')
  assert.equal(teamText(), '', 'personal space: no team block')
  ok('new path: one section per agent and per block, no context, three assemblies byte-identical with one block')

  // ── (b) an agent created after mount, then disposed ─────────────────────
  const second = engine.makeAgent('sess-cloud-dedup-02')
  engine.emit('agent/created', { agent: second.agent })
  assert.ok(engine.layerOf('agent:sess-cloud-dedup-02').sections.has(MEMORY_NAME), '(b) an agent created after mount gets its sections')
  assert.ok(engine.layerOf('agent:sess-cloud-dedup-02').sections.has(TEAM_NAME))
  engine.emit('agent/disposed', { agent: second.agent })
  assert.equal(second.own.disposed, true, '(b) the fiber is disposed on agent/disposed')
  assert.equal(engine.layerOf('agent:sess-cloud-dedup-02').sections.size, 0, '(b) its registrations go with it')
  assert.ok(agentLayer().sections.has(MEMORY_NAME), 'the first agent is untouched')
  ok('disposal: agent/created installs, agent/disposed disposes and drops both registrations')

  // ── (d) a removed memory leaves the next assembly ───────────────────────
  assert.ok(memoryText().includes('the deployment goes through Fly.io'))
  mod.memoryCache.account = mod.memoryCache.account.filter((m) => m.id !== 1)
  assert.equal(memoryText().includes('the deployment goes through Fly.io'), false, '(d) the removed memory is not injected anymore')
  assert.ok(memoryText().includes('the person prefers French'), 'the other memories stay')
  mod.memoryCache.account = [
    mkMem(2, true, '2026-10-02T10:00:00Z', 'the person prefers French in every conversation'),
    mkMem(3, true, '2026-10-03T10:00:00Z', 'safety: never publish a page without the person\'s approval', 'policy'),
    mkMem(4, false, '2026-10-04T10:00:00Z', 'the build runs on Node 26'),
  ]
  ok('removal: a deleted memory disappears from the next assembly (no stale instruction kept visible)')

  // ── (e) memory / context off -> the off marker ──────────────────────────
  writeSettings({ memories: true, context: false })
  assert.ok(memoryText().startsWith(OFF_MARK), '(e) context off: the section leads with the off marker (the proxy must not add its own copy)')
  assert.equal(memoryText().includes('the build runs on Node 26'), false, '(e) context off: no memory is injected')
  writeSettings({ memories: false, context: true })
  assert.ok(memoryText().startsWith(OFF_MARK), '(e) memories off: same marker')
  writeSettings({ memories: true, context: true })
  assert.ok(memoryText().startsWith(MEMORY_MARK), 'switched on again: the memory block comes back')
  assert.ok(memoryText().includes('the build runs on Node 26'))
  ok('switches: context off / memories off -> the off marker, no memory text; back on -> the memory block')

  // ── (f) team space: the team note, never the person's own content ───────
  writeState(TEAM)
  mod.teamCache.at = Date.now()
  mod.teamCache.workspaceId = 'ws-team'
  mod.teamCache.role = 'owner'
  mod.teamCache.error = null
  mod.teamCache.counts = { approved: 2, pending: 0 }
  mod.teamCache.lessons = [
    { id: 11, text: 'staging database migrations always run twice', tags: ['db'], kyber: null, status: 'approved', proposedName: null, reviewedName: null, reviewedAt: null, createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-01T10:00:00Z', mine: false, note: null, reviewNote: null },
    { id: 12, text: 'the lifecycle robot runs on every release', tags: [], kyber: 'dev-team', status: 'approved', proposedName: null, reviewedName: null, reviewedAt: null, createdAt: '2026-10-02T10:00:00Z', updatedAt: '2026-10-02T10:00:00Z', mine: false, note: null, reviewNote: null },
  ]
  writeFileSync(join(kybers, '.active', SESSION), JSON.stringify({ kyber: 'dev-team', ts: '2026-10-01T10:00:00Z' }))
  const teamMemory = memoryText()
  assert.ok(teamMemory.startsWith(OFF_MARK), '(f) the team memory block still leads with the off marker')
  assert.ok(teamMemory.includes('team space'), '(f) it says this is a team space')
  assert.equal(teamMemory.includes('the build runs on Node 26'), false, '(f) no personal memory content in a team space')
  const teamBlock = teamText()
  assert.ok(teamBlock.startsWith(TEAM_MARK), '(f) the team-lessons block leads with its marker')
  assert.ok(teamBlock.includes('staging database migrations always run twice'), '(f) the approved team lesson is sent')
  assert.ok(teamBlock.includes('the lifecycle robot runs on every release'), 'the lesson of the chat\'s kyber is sent')
  assert.equal(teamBlock.includes('the build runs on Node 26'), false, '(f) the team block carries no personal memory content')
  assert.equal(occurrences(teamBlock, TEAM_MARK), 1, '(f) exactly one team-lessons block')
  ok('team space: the off/team note for the memory, the approved team lessons, never the person\'s own content')

  writeState(PERSONAL)
  mod.emptyTeamCache()
  assert.ok(memoryText().startsWith(MEMORY_MARK), 'personal space again: the memory block comes back')
  assert.equal(teamText(), '', 'personal space again: no team block')
  ok('restore: back to the personal space, the memory block returns and the team block is empty')

  // ── (h) relevance scoping for pinned memories (workstream A, requirement 3) ─
  // A pinned POLICY is a safety rule: visible whatever the question. Any other pinned memory is no longer
  // injected blindly once a question exists — it competes in the relevance ranking like a non-pinned one.
  assert.equal(mod.RELEVANCE_TUNING.maxPicked, 8, 'the pick is capped at 8 non-pinned memories')
  mod.noteUserTurn(SESSION, { source: { kind: 'user' }, content: [{ type: 'text', text: 'docker desktop keeps the disk full on the mac' }] }, 1)
  const dockerCandidates = Array.from({ length: 12 }, (_, i) => mkMem(900 + i, false, '2026-10-01T10:00:00Z', 'docker desktop keeps the disk full on the mac, note ' + String(i)))
  assert.equal(mod.pickRelevant(SESSION, dockerCandidates).length, 8, 'never more than 8 non-pinned memories are picked by relevance')
  mod.memoryCache.account = [
    mkMem(600, true, '2026-09-01T10:00:00Z', 'sector: the person works in the health sector and wants office mode'),
    mkMem(601, true, '2026-09-02T10:00:00Z', 'safety: never send an email without the person\'s approval', 'policy'),
    mkMem(602, true, '2026-09-03T10:00:00Z', 'docker desktop keeps the disk full on the mac'),
    ...Array.from({ length: 6 }, (_, i) => mkMem(910 + i, false, '2026-10-01T10:00:00Z', 'docker desktop keeps the disk full on the mac, captured note ' + String(i))),
  ]
  mod.memoryCache.kyber = {}
  mod.memoryCache.at = Date.now()
  const scoped = memoryText()
  assert.ok(scoped.includes('safety: never send an email'), 'a pinned policy stays visible even when the question is about something else')
  assert.equal(scoped.includes('sector: the person works in the health sector'), false, 'an unrelated pinned fact is NOT injected blindly when a question exists')
  assert.ok(scoped.includes('docker desktop keeps the disk full on the mac'), 'the matching pinned fact goes in through the same ranking')
  assert.ok(scoped.includes('captured note 0'), 'the matching non-pinned memories are injected')
  ok('relevance scoping: policies always visible, other pinned memories ranked (unrelated one excluded), at most 8 picks')
  mod.sessionQuery.delete(SESSION)
  mod.sessionPick.delete(SESSION)

  // ── (g) mixed case and fallback ─────────────────────────────────────────
  const mixed = createEngine()
  mixed.makeAgent(SESSION)
  mod.apply(mixed.ctx)
  assert.ok(mixed.layerOf('agent:' + SESSION).sections.has(MEMORY_NAME))
  mixed.emit('agent/created', { agent: { session: { id: 'sess-no-ctx' } } })   // no agent.ctx at all
  assert.equal(mixed.layerOf('host').contexts.has(MEMORY_NAME), false, '(g) a refused seam after a section exists does NOT add the global context: never two blocks')
  assert.equal(mixed.layerOf('host').contexts.has(TEAM_NAME), false)
  ok('mixed case: one agent on sections, a later refused seam does not duplicate through the global context')

  const fallback = createEngine({ withAgents: false })
  mod.apply(fallback.ctx)
  const hostFallback = fallback.layerOf('host')
  const memoryEntry = hostFallback.contexts.get(MEMORY_NAME)
  const teamEntry = hostFallback.contexts.get(TEAM_NAME)
  assert.ok(memoryEntry !== undefined, '(g) no agent registry: the historical memory context fallback is installed')
  assert.ok(teamEntry !== undefined, '(g) no agent registry: the historical team-lessons context fallback is installed')
  assert.equal(hostFallback.sections.has(MEMORY_NAME), false, 'the fallback does not also register a section')
  const fallbackMemory = memoryEntry.text({ agent: { session: { id: SESSION } } })
  assert.ok(fallbackMemory.startsWith(MEMORY_MARK), '(g) the fallback renders the memory block, marker first')
  assert.ok(fallbackMemory.includes('safety: never send an email'), '(g) the fallback really carries the memories')
  assert.equal(fallbackMemory, memoryEntry.text({ agent: { session: { id: SESSION } } }), 'stable between two assemblies')
  assert.equal(teamEntry.text({ agent: { session: { id: SESSION } } }), '', 'the fallback team block is empty in a personal space')
  ok('fallback: without an agent registry the historical systemPrompt.context path still carries both blocks')

  // ── Measured before/after: three turns, one change between turn 2 and 3 ──
  // The engine keeps a `context` as a durable user-role snapshot: it is retained in the history and a new
  // copy is appended when its text changes (documented in @deepseek-ai/dsh-system-prompt). A `section` is
  // re-read in the system prompt at every assembly and never stored. Same fixture, same three assemblies.
  writeState(PERSONAL)
  mod.emptyTeamCache()
  mod.memoryCache.account = [
    ...Array.from({ length: 8 }, (_, i) => mkMem(100 + i, true, '2026-09-' + String(10 + i).padStart(2, '0') + 'T10:00:00Z', 'pinned fact ' + String(i) + ': the person works in the health sector and wants office mode')),
    ...Array.from({ length: 40 }, (_, i) => mkMem(200 + i, false, '2026-10-' + String(1 + (i % 27)).padStart(2, '0') + 'T10:00:00Z', 'captured memory ' + String(i) + ': a short sentence about the build, the deploy and the review of the day')),
  ]
  mod.memoryCache.at = Date.now()
  const turn1 = memoryText()
  const turn2 = memoryText()
  mod.memoryCache.account = mod.memoryCache.account.concat([mkMem(999, false, '2026-10-27T10:00:00Z', 'a memory captured between turn 2 and turn 3')])
  const turn3 = memoryText()
  assert.equal(turn1, turn2, 'no change between turn 1 and turn 2')
  assert.notEqual(turn2, turn3, 'the measured scenario changes once, like a memory written between two turns')
  const retained = turn1.length + turn3.length   // the old path keeps both snapshots in the history
  const tokens = (chars) => Math.round(chars / 4)
  console.log('  MEASURE memory: 3 turns, 1 change — legacy retained context = 2 snapshots, ' + String(retained) + ' chars (~' + String(tokens(retained)) + ' tokens); section = ' + String(turn3.length) + ' chars (~' + String(tokens(turn3.length)) + ' tokens); saved ' + String(retained - turn3.length) + ' chars (~' + String(tokens(retained - turn3.length)) + ' tokens)')
  ok('measured: the old context path retains 2 snapshots over 3 turns, the section injects the current text once')

  console.log(String(pass) + ' verifications OK')
} finally {
  rmSync(root, { recursive: true, force: true })
}
