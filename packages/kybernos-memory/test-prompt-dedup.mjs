// ── Deduplication of the lessons block: a per-agent SECTION, not a durable CONTEXT ──────────────────────
// Standalone host suite (node + assert, no framework), throwaway stores only: DSH_HOME,
// KYBERNOS_MEMORY_KYBERS and KYBERNOS_MEMORY_SETTINGS point into a temp folder, never ~/.dsh.
//
// The engine is modelled by a fake ctx: `inject(['systemPrompt'])` yields a scope whose `section()` and
// `context()` record registrations per layer, and every agent carries its own ctx (as DSH's Agent does).
// What is proven:
//   (a) no `systemPrompt.context` is registered for the lessons on the new path;
//   (b) one `section` is installed per agent, and disposed on `agent/disposed`;
//   (c) three assemblies of the same session are byte-identical and carry ONE block;
//   (d) a removed lesson leaves the next assembly;
//   (e) context off injects nothing, recording off injects the directive line and no lesson;
//   (f) a team space says so and carries no personal lesson;
//   (g) an unreadable seam falls back to the historical `context` (never breaks boot), and a later agent
//       whose seam refuses never gets a global context on top of the sections already installed.
//
//   node packages/kybernos-memory/test-prompt-dedup.mjs
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'kybernos-memory-dedup-'))
const kybers = join(root, 'kybers')
mkdirSync(kybers, { recursive: true })
process.env.DSH_HOME = root
process.env.KYBERNOS_MEMORY_KYBERS = kybers
process.env.KYBERNOS_MEMORY_SETTINGS = join(root, 'kybernos-memory.json')

const SESSION = 'sess-dedup-0001'
const MARK = '[KYBERNOS LESSONS]'
let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const occurrences = (text, needle) => text.split(needle).length - 1

const mod = await import('./index.js')
const store = await import('./lessons-store.mjs')

const put = (kyber, lessons) => {
  mkdirSync(join(kybers, kyber, 'memory'), { recursive: true })
  writeFileSync(join(kybers, kyber, 'memory', 'lessons.jsonl'), lessons.map((l) => JSON.stringify(l)).join('\n') + '\n')
}
const lesson = (text, over = {}) => ({ ts: '2026-10-01T10:00:00Z', text, tags: [], uses: 0, lastUsed: null, ...over })

put('default', [
  lesson('general: confirm a finding twice before reporting it', { uses: 2 }),
  lesson('general: restart expo after edits', { ts: '2026-10-02T10:00:00Z' }),
])

// ── Fake engine: one registry layer per agent (and one for the host/global layer) ───────────────────────
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
      cb({ systemPrompt: service('host'), webServer: { register: () => () => {} }, tools: { register: () => () => {} } })
      return { dispose: async () => {} }
    },
    effect: (fn) => { const d = fn(); void d },
    on: (event, fn) => { handlers.set(event, (handlers.get(event) || []).concat([fn])) },
    emit: (event, payload) => { for (const fn of handlers.get(event) || []) fn(payload) },
  }
  return { ctx, makeAgent, layers, layerOf, emit: ctx.emit }
}

try {
  console.log('kybernos-memory — prompt dedup (per-agent section)')

  // ── (a)(b)(c) the new path ──────────────────────────────────────────────
  const engine = createEngine()
  const first = engine.makeAgent(SESSION)
  mod.apply(engine.ctx)
  assert.equal(engine.layerOf('host').contexts.has(mod.CHUNK_NAME), false, '(a) no durable context for the lessons on the new path')
  assert.equal(engine.layerOf('host').sections.has(mod.CHUNK_NAME), false, 'the block is never host-wide: one section per agent')
  assert.ok(engine.layerOf('agent:' + SESSION).sections.has(mod.CHUNK_NAME), '(b) a section was installed for the agent alive at mount')
  const section = () => engine.layerOf('agent:' + SESSION).sections.get(mod.CHUNK_NAME)
  assert.equal(section().order, mod.CHUNK_ORDER)
  const text = () => section().text()
  const t1 = text()
  const t2 = text()
  const t3 = text()
  assert.equal(t1, t2, '(c) assembly 2 is byte-identical to assembly 1')
  assert.equal(t2, t3, '(c) assembly 3 is byte-identical to assembly 2')
  assert.ok(t1.startsWith(MARK), 'the block still leads with its marker')
  assert.equal(occurrences(t1, MARK), 1, '(c) exactly one lessons block exists')
  assert.equal(engine.layerOf('agent:' + SESSION).sections.size, 1, 'one registration: a section replaces itself, it is not appended')
  assert.ok(t1.includes('restart expo after edits') && t1.includes('confirm a finding twice'), 'both lessons of the default kyber are there')
  ok('new path: one per-agent section, no context, three assemblies byte-identical with one block')

  // (b) agents created after mount get one too; disposal takes it away.
  const second = engine.makeAgent('sess-dedup-0002')
  engine.emit('agent/created', { agent: second.agent })
  assert.ok(engine.layerOf('agent:sess-dedup-0002').sections.has(mod.CHUNK_NAME), '(b) an agent created after mount gets its own section')
  ok('an agent created later gets its section')

  engine.emit('agent/disposed', { agent: second.agent })
  assert.equal(second.own.disposed, true, '(b) the fiber is disposed on agent/disposed')
  assert.equal(engine.layerOf('agent:sess-dedup-0002').sections.has(mod.CHUNK_NAME), false, '(b) its registration goes with it')
  assert.ok(engine.layerOf('agent:' + SESSION).sections.has(mod.CHUNK_NAME), 'the other agent is untouched')
  ok('disposal: agent/disposed disposes its fiber and drops the registration, the other agent keeps its section')

  // ── (g) mixed case: a section installed, then an agent whose seam refuses ─
  const mixed = createEngine()
  mixed.makeAgent(SESSION)
  mod.apply(mixed.ctx)
  assert.ok(mixed.layerOf('agent:' + SESSION).sections.has(mod.CHUNK_NAME))
  mixed.emit('agent/created', { agent: { session: { id: 'sess-no-ctx' } } })   // no agent.ctx at all
  assert.equal(mixed.layerOf('host').contexts.has(mod.CHUNK_NAME), false, '(g) a refused seam after a section exists does NOT add the global context: never two blocks')
  assert.ok(mixed.layerOf('agent:' + SESSION).sections.has(mod.CHUNK_NAME), 'the section of the first agent stays')
  ok('mixed case: one agent on the section, a later refused seam does not duplicate through the global context')

  // ── (g) fallback: no agent registry at all ──────────────────────────────
  const fallback = createEngine({ withAgents: false })
  mod.apply(fallback.ctx)
  const entry = fallback.layerOf('host').contexts.get(mod.CHUNK_NAME)
  assert.ok(entry !== undefined, '(g) no agent registry: the historical context fallback is installed')
  assert.equal(fallback.layerOf('host').sections.has(mod.CHUNK_NAME), false, 'the fallback does not also register a section')
  const fallbackText = entry.text({ agent: { session: { id: SESSION } } })
  assert.ok(fallbackText.startsWith(MARK), '(g) the fallback renders the same block')
  assert.ok(fallbackText.includes('restart expo after edits'), '(g) the fallback really carries the lessons')
  assert.equal(entry.text({}), entry.text(undefined), 'no session in the context is not an error')
  ok('fallback: without an agent registry the historical systemPrompt.context path still carries the lessons')

  // ── (d) a removed lesson leaves the next assembly ───────────────────────
  assert.ok(text().includes('restart expo after edits'))
  const doomed = store.listLessons({ kyber: 'default' }).items.find((l) => l.text === 'general: restart expo after edits')
  assert.ok(doomed !== undefined)
  assert.equal(store.deleteLesson(doomed.id).ok, true)
  assert.equal(text().includes('restart expo after edits'), false, '(d) the removed lesson is not injected anymore')
  assert.ok(text().includes('confirm a finding twice'), 'the other lesson stays')
  ok('removal: a deleted lesson disappears from the next assembly (no stale instruction kept visible)')

  // ── (e) switches ────────────────────────────────────────────────────────
  writeFileSync(process.env.KYBERNOS_MEMORY_SETTINGS, JSON.stringify({ lessons: true, context: false }) + '\n')
  assert.equal(text(), '', '(e) context off: nothing is injected (an empty section)')
  writeFileSync(process.env.KYBERNOS_MEMORY_SETTINGS, JSON.stringify({ lessons: false, context: true }) + '\n')
  const recordingOff = text()
  assert.ok(recordingOff.startsWith(MARK) && recordingOff.includes('turned off by the user'), '(e) recording off: the directive line, and it leads with the marker')
  assert.equal(recordingOff.includes('confirm a finding twice'), false, '(e) recording off: no lesson is injected')
  writeFileSync(process.env.KYBERNOS_MEMORY_SETTINGS, JSON.stringify({ lessons: true, context: true, relevant: true }) + '\n')
  assert.ok(text().includes('confirm a finding twice'), 'switched on again: the lesson is back')
  ok('switches: context off -> empty, recording off -> one directive line without a lesson')

  // ── (f) team space ──────────────────────────────────────────────────────
  globalThis[Symbol.for('kybernos.space')] = Object.freeze({ version: 1, isTeam: () => true })
  try {
    const team = text()
    assert.ok(team.startsWith(MARK), '(f) the team line still leads with the lessons marker')
    assert.ok(team.includes('team space'), '(f) it says this is a team space')
    assert.equal(team.includes('confirm a finding twice'), false, '(f) no personal lesson in a team space')
  } finally {
    delete globalThis[Symbol.for('kybernos.space')]
  }
  assert.ok(text().includes('confirm a finding twice'), 'personal space again: the lesson comes back')
  ok('team space: the team line leads, no personal lesson leaks; the personal space is restored')

  // ── Measured before/after: three turns, one change between turn 1 and 2 ──
  // The engine keeps a `context` as a durable user-role snapshot: it is retained in the history and a new
  // copy is appended when its text changes (documented in @deepseek-ai/dsh-system-prompt). A `section` is
  // re-read in the system prompt at every assembly and never stored. Same fixture, same three assemblies.
  rmSync(join(kybers, 'default'), { recursive: true, force: true })
  put('default', Array.from({ length: 24 }, (_, i) => lesson('measured lesson ' + String(i) + ': a short falsifiable sentence about the build, the tests and the deploys', { uses: i % 3 })))
  mkdirSync(join(kybers, '.active'), { recursive: true })
  writeFileSync(join(kybers, '.active', SESSION), JSON.stringify({ kyber: 'dev-team', ts: '2026-10-01T10:00:00Z' }))
  put('dev-team', Array.from({ length: 8 }, (_, i) => lesson('team lesson ' + String(i) + ': pad sprites, keep commits imperative and restart the app after an edit')))
  const turn1 = text()
  put('dev-team', Array.from({ length: 9 }, (_, i) => lesson('team lesson ' + String(i) + ': pad sprites, keep commits imperative and restart the app after an edit')))
  const turn2 = text()
  const turn3 = text()
  assert.notEqual(turn1, turn2, 'the measured scenario changes once, like a lesson written between two turns')
  assert.equal(turn2, turn3, 'no change between turn 2 and turn 3')
  const retained = turn1.length + turn2.length   // the old path keeps both snapshots in the history
  const tokens = (chars) => Math.round(chars / 4)
  console.log('  MEASURE lessons: 3 turns, 1 change — legacy retained context = 2 snapshots, ' + String(retained) + ' chars (~' + String(tokens(retained)) + ' tokens); section = ' + String(turn3.length) + ' chars (~' + String(tokens(turn3.length)) + ' tokens); saved ' + String(retained - turn3.length) + ' chars (~' + String(tokens(retained - turn3.length)) + ' tokens)')
  ok('measured: the old context path retains 2 snapshots over 3 turns, the section injects the current text once')

  console.log(String(pass) + ' verifications OK')
} finally {
  rmSync(root, { recursive: true, force: true })
}
