// The personal memory is CUT in a team space (plan « Équipes », step 5). The canary test.
//
//   node scripts/test-team-memory-cut.mjs
//
// What is proven, with the two real bundles (kybernos-cloud and kybernos-memory) mounted on one fake host and a fake account server:
//   · a personal memory and a personal lesson that both carry the canary word are in the assembled system prompt, found by the tools and
//     written by the capture in the PERSONAL space (nothing changes there);
//   · in a TEAM space the canary is in no injector (the prompt is assembled from every block both bundles mounted), neither tool of either
//     bundle reads or writes anything, the capture makes no model call and writes nothing, the scheduled tidy-ups stay home;
//   · the switch works in the middle of a session, both ways, with no restart (the seam is read at every assembly);
//   · it fails CLOSED: a list of spaces that cannot tell, a record that does not say `personal: true`, a state file that is damaged,
//     empty or unreadable, a model route that names another space than the active one, a seam that throws or answers something odd;
//   · the Kybernos proxy reads its memory markers in the system role only: in a team space the off marker leads a real system SECTION too;
//   · a turn that began in a team and ends after a switch to personal is not captured; the Study model stays out of a team's tidy scan;
//   · a shell is refused the side doors in a team space (memory.cjs, the lessons files, the account's state files, the pages' loopback routes);
//   · the routes a shell could use (add/edit a memory, push lessons, choose the space, propose to the team, make a session Kaby's) need the signed session;
//   · not connected, and no seam at all: behaviour unchanged;
//   · what a team keeps: its lessons block, the team-lessons chunk, and the sentence that points to « Propose to team ».
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ICI = fileURLToPath(new URL('.', import.meta.url))
const PACKAGES = join(ICI, '..', 'packages')
const CANARY = 'ZEBRA-7731'
const TEAM_RULE = 'TEAM-RULE-9001'

let fails = 0
let passed = 0
const ok = (name) => { passed += 1; console.log('  ok   ' + name) }
const check = (name, cond, detail) => { if (cond) ok(name); else { fails += 1; console.log('  FAIL ' + name + (detail === undefined ? '' : '  — ' + detail)) } }

// ── The machine: a throw-away home, state file, kybers folder ────────────────────────────────────────────
const root = mkdtempSync(join(tmpdir(), 'kb-team-cut-'))
const dshHome = join(root, '.dsh')
mkdirSync(dshHome, { recursive: true })
const stateFile = join(root, 'kybernos-cloud.json')
const kybers = join(root, 'kybers')
const lessonsFile = join(kybers, 'default', 'memory', 'lessons.jsonl')
mkdirSync(join(kybers, 'default', 'memory'), { recursive: true })
process.env.HOME = root
process.env.DSH_HOME = dshHome
process.env.KYBERNOS_CLOUD_STATE = stateFile
process.env.KYBERNOS_MEMORY_KYBERS = kybers
process.env.KYBERNOS_MEMORY_SETTINGS = join(root, 'kybernos-memory.json')
delete process.env.KYBERNOS_SERVERS_FILE

// ── The account server: the memories of the account, and a record of every write ────────────────────────
const memories = [{ id: 1, scope: 'account', kind: 'fact', content: 'The codename of the person\'s migration is ' + CANARY, source: 'taught', pinned: true, created_at: '2026-09-01 10:00:00+00:00' }]
const hits = { writes: [], searches: 0, lists: 0 }
const api = createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
    const url = new URL(req.url, 'http://x')
    if (req.method === 'GET' && url.pathname === '/v1/memories') { hits.lists += 1; return send(200, { memories }) }
    if (req.method === 'GET' && url.pathname === '/v1/memories/search') {
      hits.searches += 1
      const q = String(url.searchParams.get('q') || '').toLowerCase()
      return send(200, { memories: memories.filter((m) => m.content.toLowerCase().includes(q)) })
    }
    if (req.method === 'POST' && url.pathname === '/v1/memories') {
      const body = JSON.parse(raw)
      hits.writes.push(body)
      const made = { id: memories.length + 1, scope: 'account', pinned: false, created_at: '2026-10-18 09:00:00+00:00', ...body }
      memories.push(made)
      return send(201, made)
    }
    return send(404, { error: 'not here' })
  })
})
await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve))
process.env.KYBERNOS_CLOUD_API = 'http://127.0.0.1:' + api.address().port

// ── The host both bundles are mounted on ──────────────────────────────────────────────────────────────────
const blocks = new Map()      // name -> { order, text }
const tools = new Map()       // name -> definition
const hooks = new Map()       // event -> [handler]
const llm = { calls: 0 }
// a different fact each time, so that the capture's idempotence (a fact already in the account is not written again) never hides a write
llm.stream = async function* () { llm.calls += 1; yield { type: 'text-delta', text: JSON.stringify({ memories: [{ content: 'The person likes green tea number ' + String(llm.calls) + ' (' + CANARY + ' capture test)', kind: 'fact' }] }) } }
const sections = new Map()    // name -> { order, text } : the SYSTEM prompt itself (the proxy reads the system role only)
const systemPrompt = { context: (entry) => { blocks.set(entry.name, entry) }, section: (entry) => { sections.set(entry.name, entry) } }
const toolService = { register: (def) => { tools.set(def.name, def); return () => tools.delete(def.name) } }
const webServer = { register: () => () => {} }
const ctx = {
  get: (name) => ({ webServer, systemPrompt, tools: toolService, llm })[name],
  inject: (_list, cb) => cb(ctx),
  effect: (fn) => { fn() },
  on: (event, handler) => { hooks.set(event, [...(hooks.get(event) || []), handler]) },
  systemPrompt,
  tools: toolService,
}

const cloud = await import(pathToFileURL(join(PACKAGES, 'kybernos-cloud', 'index.js')).href)
const memory = await import(pathToFileURL(join(PACKAGES, 'kybernos-memory', 'index.js')).href)
const cloudSpace = await import(pathToFileURL(join(PACKAGES, 'kybernos-cloud', 'team-space.mjs')).href)
const memorySpace = await import(pathToFileURL(join(PACKAGES, 'kybernos-memory', 'team-space.mjs')).href)
cloud.MEMORY_TUNING.writeRefreshMs = -1     // no timer fires at the fake server behind the test's back
cloud.MEMORY_TUNING.tickMs = 3600000

// ── Two spaces, and the state that says which is active ──────────────────────────────────────────────────
const TOKEN = 'kyd_' + 's'.repeat(40)
const PERSONAL = { id: 'ws-me', name: 'My workspace', role: 'owner', personal: true, created_at: '2026-09-01 10:00:00' }
const TEAM = { id: 'ws-acme', name: 'Acme', role: 'member', personal: false, created_at: '2026-10-01 10:00:00' }
const baseState = () => ({ token: TOKEN, api: process.env.KYBERNOS_CLOUD_API, user: { id: 'u-me', email: 'sara@example.test', name: 'Sara M.', plan: 'team-solo' }, workspaces: [PERSONAL, TEAM], active_workspace_id: PERSONAL.id })
const setState = (over = {}) => writeFileSync(stateFile, JSON.stringify({ ...baseState(), ...over }, null, 2) + '\n', { mode: 0o600 })
const inPersonal = () => setState({ active_workspace_id: PERSONAL.id })
const inTeam = () => setState({ active_workspace_id: TEAM.id, space_plan: { workspace_id: TEAM.id, key: 'team', name: 'Team', level: null, label: 'Team', status: 'active', credit_balance_credits: null } })
const notConnected = () => rmSync(stateFile, { force: true })

// Apply with no connection yet: nothing is asked of the network at boot. The state is written afterwards.
notConnected()
cloud.apply(ctx)
memory.apply(ctx)
const SESSION = 'sess-canary-0001'
const context = { agent: { session: { id: SESSION } } }

// the personal lesson, with the canary in it
writeFileSync(lessonsFile, JSON.stringify({ ts: new Date().toISOString(), text: 'The migration codename is ' + CANARY + ': always say it in capitals.', tags: [], uses: 0, lastUsed: null }) + '\n')
const lessonsBytes = () => readFileSync(lessonsFile, 'utf8')

/** The system prompt as the engine assembles it: the text of every block both bundles mounted, in order. */
const systemRole = () => [...sections.values()].sort((a, b) => a.order - b.order).map((b) => b.text(context)).filter((t) => t.length > 0).join('\n\n')
const assemble = () => [...blocks.values()].sort((a, b) => a.order - b.order).map((b) => { try { return b.text(context) } catch (e) { return '<<' + b.name + ' threw>>' } }).join('\n---\n')
const loadCache = async () => { await cloud.refreshMemoryCache(cloud.readStateForSpace(), true) }
const turn = (sid = SESSION) => ({
  agent: {
    session: {
      id: sid,
      deriveMessages: () => [
        { role: 'user', content: [{ type: 'text', text: 'Remember that I always prefer short answers, and that I like green tea in the afternoon, please.' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Noted: short answers from now on, and green tea in the afternoon is yours to enjoy.' }] },
      ],
    },
    options: { provider: 'p', model: 'm' },
  },
  signal: undefined,
})
const claimed = (text, sid = SESSION) => { for (const h of hooks.get('agent/inbox/claimed') || []) h({ agent: { session: { id: sid } }, message: { source: { kind: 'user' }, content: [{ type: 'text', text }] }, turn: 1 }) }
// the capture is fire-and-forget: wait for it to note its outcome (it always does), or 600 ms
const runCapture = async () => {
  const before = cloud.lastCapture.at
  for (const h of hooks.get('agent/turn-stopping') || []) h(turn())
  for (let waited = 0; cloud.lastCapture.at === before && waited < 600; waited += 10) await new Promise((resolve) => setTimeout(resolve, 10))
}
const tool = (name) => tools.get(name)

try {
  console.log('team memory cut — the canary')

  // ── the seam ───────────────────────────────────────────────────────────────────────────────────────────
  const seam = globalThis[Symbol.for('kybernos.space')]
  check('the cloud bundle publishes the seam: frozen, with isTeam()', seam !== undefined && Object.isFrozen(seam) && typeof seam.isTeam === 'function')
  check('both bundles use the same registered symbol (drift)', Symbol.keyFor(cloudSpace.SPACE_SEAM) === 'kybernos.space' && Symbol.keyFor(memorySpace.SPACE_SEAM) === 'kybernos.space')
  const every = ['kybernos:memory', 'kybernos:team-lessons', 'kybernos:kyby', 'kybernos:lessons']
  check('every injector of both bundles is mounted: ' + every.join(', '), every.every((n) => blocks.has(n)), [...blocks.keys()].join(', '))
  check('the four memory tools are mounted', ['memory_write', 'memory_search', 'lesson_write', 'lesson_search'].every((n) => tools.has(n)), [...tools.keys()].join(', '))

  // ── 1. the PERSONAL space: everything works as today ───────────────────────────────────────────────────
  inPersonal()
  await loadCache()
  check('personal: the seam says not a team', seam.isTeam() === false)
  check('personal: the system role carries nothing of ours (nothing changes there)', sections.has('kybernos:memory-off') && systemRole() === '')
  let prompt = assemble()
  check('personal: the account memory is in the prompt', prompt.includes('[KYBERNOS MEMORY]') && prompt.includes(CANARY))
  check('personal: the local lesson is in the prompt', prompt.includes('[KYBERNOS LESSONS]') && prompt.includes('Lessons learned on this machine') && prompt.includes('always say it in capitals'))
  const ls = await tool('lesson_search').execute({ q: 'codename' })
  check('personal: lesson_search finds the lesson', ls.ok === true && ls.count === 1 && ls.found.includes(CANARY))
  const ms = await tool('memory_search').execute({ q: 'codename' })
  check('personal: memory_search finds the memory', ms.ok === true && ms.count === 1 && ms.found.includes(CANARY))
  const lessonsBefore = lessonsBytes()
  const lw = await tool('lesson_write').execute({ text: 'Personal lesson written in the personal space.' })
  check('personal: lesson_write stores the lesson', lw.ok === true && lessonsBytes() !== lessonsBefore)
  const mw = await tool('memory_write').execute({ content: 'A memory written in the personal space.', kind: 'fact' })
  check('personal: memory_write stores the memory', mw.ok === true && hits.writes.length === 1)
  claimed('what is the codename of the migration')
  check('personal: both bundles note the person\'s question (relevance)', cloud.sessionQuery.has(SESSION) && memory.sessionQuery.has(SESSION))
  const callsBefore = llm.calls
  await runCapture()
  check('personal: the capture asks the model and writes', llm.calls === callsBefore + 1 && hits.writes.length === 2 && cloud.lastCapture.status === 'ecrit', cloud.lastCapture.status)

  // ── 2. a TEAM space: nothing personal reaches the model, nothing personal is written ────────────────────
  cloud.sessionQuery.clear(); memory.sessionQuery.clear()
  inTeam()
  check('team: the seam says a team', seam.isTeam() === true)
  prompt = assemble()
  check('team: the canary is in NO injector', prompt.includes(CANARY) === false, prompt.slice(0, 400))
  check('team: no memory line and no lesson line', prompt.includes('Lessons learned on this machine') === false && prompt.includes('Kybernos account memories') === false && prompt.includes('always say it in capitals') === false)
  check('team: the proxy is told not to add its own copy (off marker leads the memory block)', blocks.get('kybernos:memory').text(context).startsWith(cloud.MEMORY_OFF_MARKER) && blocks.get('kybernos:memory').text(context).includes('Propose to team'))
  check('team: the SYSTEM role leads with the off marker (the proxy reads system/developer messages only, a context block is a user message)', systemRole().startsWith(cloud.MEMORY_OFF_MARKER))
  check('team: the lessons block says why, and points to « Propose to team »', blocks.get('kybernos:lessons').text(context).includes('team space') && blocks.get('kybernos:lessons').text(context).includes('Propose to team'))
  check('team: the page\'s plan sends nothing either', cloud.planInjection(cloud.readStateForSpace(), { sessionId: SESSION }).account.chosen.length === 0)

  const lessonsFrozen = lessonsBytes()
  const writesFrozen = hits.writes.length
  const searchesFrozen = hits.searches
  const ls2 = await tool('lesson_search').execute({ q: 'codename' })
  check('team: lesson_search reads nothing', ls2.ok === false && JSON.stringify(ls2).includes(CANARY) === false && ls2.error.includes('Propose to team'), JSON.stringify(ls2))
  const lw2 = await tool('lesson_write').execute({ text: 'A lesson from a team chat that must not be stored.' })
  check('team: lesson_write stores nothing', lw2.ok === false && lessonsBytes() === lessonsFrozen && lw2.error.includes('Propose to team'))
  const ms2 = await tool('memory_search').execute({ q: 'codename' })
  check('team: memory_search reads nothing (and does not even ask the server)', ms2.ok === false && JSON.stringify(ms2).includes(CANARY) === false && hits.searches === searchesFrozen && ms2.error.includes('Propose to team'), JSON.stringify(ms2))
  const mw2 = await tool('memory_write').execute({ content: 'A memory from a team chat that must not be stored.', kind: 'fact' })
  check('team: memory_write stores nothing', mw2.ok === false && hits.writes.length === writesFrozen && mw2.error.includes('Propose to team'))
  check('team: the rendered answers of the four tools carry the sentence', ['memory_write', 'memory_search', 'lesson_write', 'lesson_search'].every((n) => {
    const text = tool(n).output.render({ q: 'x' }, { ok: false, error: n.startsWith('lesson') ? lw2.error : mw2.error })
    return JSON.stringify(text).includes('Propose to team')
  }))
  const direct = await cloud.createMemory(cloud.readStateForSpace(), { scope: 'account', kind: 'fact', content: 'A model-driven write at the lowest door.', source: 'conversation' }, 'agent')
  const directCapture = await cloud.createMemory(cloud.readStateForSpace(), { scope: 'account', kind: 'fact', content: 'A capture write at the lowest door.', source: 'conversation' }, 'capture')
  check('team: even the lowest door refuses what the model writes (agent, capture)', direct.ok === false && directCapture.ok === false && hits.writes.length === writesFrozen)
  const callsBeforeTeam = llm.calls
  await runCapture()
  check('team: the capture makes no model call and writes nothing', llm.calls === callsBeforeTeam && hits.writes.length === writesFrozen && cloud.lastCapture.status === 'espace_equipe', cloud.lastCapture.status)
  claimed('what is the codename of the migration')
  check('team: the lessons bundle keeps no word of a team chat; the cloud bundle keeps it for the team block', memory.sessionQuery.has(SESSION) === false && cloud.sessionQuery.has(SESSION) === true)
  const tidyCloud = await cloud.tidyTick(Date.now())
  const tidyMemory = await memory.tidyTick(Date.now())
  check('team: the scheduled tidy-ups stay home (the Study model is on the team\'s route)', tidyCloud.ran === false && tidyCloud.why === 'espace_equipe' && tidyMemory.ran === false && tidyMemory.why === 'espace_equipe', JSON.stringify([tidyCloud, tidyMemory]))
  const page = await memory.ROUTES.find((r) => r.path === '/kybernos-memory/lessons').run({ url: '/kybernos-memory/lessons', headers: {} })
  check('team: the lessons page does not claim lessons are sent', page.injection.team === true && page.injection.defaultSent === 0)

  // what a team keeps: its own lessons block (read from the cache, per team), the per-folder instructions are another bundle's
  const asLesson = { id: 1, text: TEAM_RULE + ': deploys wait for the second review.', tags: [], kyber: null, status: 'approved', updatedAt: '2026-10-10T10:00:00Z', createdAt: '2026-10-10T10:00:00Z' }
  Object.assign(cloud.teamCache, { at: Date.now(), workspaceId: TEAM.id, lessons: [asLesson], role: 'member', counts: { approved: 1, pending: 0 }, error: null })
  prompt = assemble()
  check('team: the team lessons block still reaches the model', prompt.includes('[KYBERNOS TEAM LESSONS]') && prompt.includes(TEAM_RULE))
  check('team: and still not the canary', prompt.includes(CANARY) === false)
  check('team: Kaby\'s block is for Kaby\'s own session only', blocks.get('kybernos:kyby').text(context) === '')

  // ── 3. the switch, in the middle of a session, both ways ───────────────────────────────────────────────
  inPersonal()
  check('switch team → personal: the very next assembly carries the memory again', assemble().includes(CANARY))
  inTeam()
  check('switch personal → team: the very next assembly carries none', assemble().includes(CANARY) === false)
  inPersonal()
  check('switch back to personal: the tools work again', (await tool('lesson_search').execute({ q: 'codename' })).ok === true && (await tool('memory_search').execute({ q: 'codename' })).ok === true)
  inTeam()
  check('switch to team once more: refused again', (await tool('lesson_search').execute({ q: 'codename' })).ok === false && (await tool('memory_search').execute({ q: 'codename' })).ok === false)

  // ── 4. fail closed ──────────────────────────────────────────────────────────────────────────────────────
  const closed = async (label, arrange) => {
    arrange()
    const before = { writes: hits.writes.length, lessons: lessonsBytes(), calls: llm.calls }
    const prompt2 = assemble()
    const refused = [await tool('lesson_search').execute({ q: 'codename' }), await tool('lesson_write').execute({ text: 'x lesson in doubt' }), await tool('memory_search').execute({ q: 'codename' }), await tool('memory_write').execute({ content: 'x memory in doubt', kind: 'fact' })]
    await runCapture()
    check('fail closed — ' + label, prompt2.includes(CANARY) === false && refused.every((r) => r.ok === false && JSON.stringify(r).includes(CANARY) === false)
      && hits.writes.length === before.writes && lessonsBytes() === before.lessons && llm.calls === before.calls && seam.isTeam() === true && systemRole().startsWith(cloud.MEMORY_OFF_MARKER), JSON.stringify({ prompt: prompt2.slice(0, 160), refused }))
  }
  await closed('connected, the list of spaces is empty (the active space cannot be told)', () => setState({ workspaces: [], active_workspace_id: null }))
  await closed('connected, no list of spaces at all', () => { const s = baseState(); delete s.workspaces; writeFileSync(stateFile, JSON.stringify(s)) })
  await closed('connected, the active space is not in the list and the first one is a team', () => setState({ workspaces: [TEAM, PERSONAL], active_workspace_id: 'ws-gone' }))
  await closed('a space whose record does not say personal: true', () => setState({ workspaces: [{ id: PERSONAL.id, name: 'My workspace', role: 'owner' }], active_workspace_id: PERSONAL.id }))
  await closed('personal is not a boolean', () => setState({ workspaces: [{ ...PERSONAL, personal: 'true' }], active_workspace_id: PERSONAL.id }))
  await closed('the model route still names the team while the state says personal (a failed import, a stale write)', () => setState({ active_workspace_id: PERSONAL.id, models: { workspace: TEAM.id, provider: 'kybernos' } }))
  await closed('the state file is damaged JSON', () => writeFileSync(stateFile, '{"token": "kyd_x", "workspaces": [{"id": "ws-me", "personal": tr'))
  await closed('the state file is empty (a write caught half way)', () => writeFileSync(stateFile, ''))
  await closed('the state file is valid JSON of the wrong kind', () => writeFileSync(stateFile, '["not", "an", "object"]'))
  if (typeof process.getuid === 'function' && process.getuid() !== 0) {
    await closed('the state file exists and cannot be read (rights)', () => { inPersonal(); chmodSync(stateFile, 0o000) })
    chmodSync(stateFile, 0o600)
  } else {
    console.log('SKIPPED: unreadable state file by rights — running as root, chmod 000 does not stop root')
  }

  // a route that names the same space is no doubt
  setState({ active_workspace_id: PERSONAL.id, models: { workspace: PERSONAL.id, provider: 'kybernos' } })
  check('the model route names the active personal space: nothing is cut', seam.isTeam() === false && assemble().includes(CANARY))

  // a turn that began in a team and ends after the switch to personal is a team's turn: not captured
  inTeam()
  claimed('a team message, taken in the team space')
  inPersonal()
  const callsStraddle = llm.calls
  const writesStraddle = hits.writes.length
  await runCapture()
  check('a turn that began in a team space is not captured after a switch to personal', llm.calls === callsStraddle && hits.writes.length === writesStraddle && cloud.lastCapture.status === 'espace_equipe', cloud.lastCapture.status)
  claimed('a personal message, taken in the personal space')
  await runCapture()
  check('and the next personal turn is captured again', llm.calls === callsStraddle + 1 && hits.writes.length === writesStraddle + 1 && cloud.lastCapture.status === 'ecrit', JSON.stringify({ calls: llm.calls - callsStraddle, writes: hits.writes.length - writesStraddle, status: cloud.lastCapture.status }))

  // the tidy scan, started by the person: the Study model is not asked in a team space
  writeFileSync(join(dshHome, 'kybernos-memory.json'), '{}')
  mkdirSync(join(dshHome, 'kybernos'), { recursive: true })
  writeFileSync(join(dshHome, 'kybernos', 'settings.json'), JSON.stringify({ brain: 'kybernos/study-model' }))
  cloud.tidySettings({ brain: true })
  memory.tidySettings({ brain: true })
  inPersonal()
  const scanPersonal = await cloud.tidyRun(cloud.readStateForSpace(), 'manual')
  inTeam()
  const scanTeam = await cloud.tidyRun(cloud.readStateForSpace(), 'manual')
  const lessonsTeam = await memory.tidyRun('manual')
  check('personal: the tidy scan names the Study model', scanPersonal.brain.model === 'kybernos/study-model', JSON.stringify(scanPersonal.brain))
  check('team: the tidy scan of the memories and of the lessons leaves the Study model out', scanTeam.brain.model === '' && scanTeam.brain.asked === 0 && lessonsTeam.brain.model === '' && lessonsTeam.brain.asked === 0, JSON.stringify([scanTeam.brain, lessonsTeam.brain]))

  // a shell: the side doors are refused in a team space (the same hook as kybernos-cloud's turn gate)
  const chain = async (exec) => {
    const handlers = hooks.get('tools/pre-execute') || []
    const run = async (i) => (i >= handlers.length ? { kind: 'pass' } : handlers[i](exec, () => run(i + 1)))
    return run(0)
  }
  const bash = (command) => ({ name: 'bash', arguments: { command }, agent: { id: SESSION } })
  const doors = [
    'node ~/.dsh/kybers/memory.cjs lesson --kyber default --text "x"',
    'cat ~/.dsh/kybers/default/memory/lessons.jsonl',
    'cat ' + lessonsFile,
    'cat ~/.dsh/kybernos-cloud.json',
    'curl -s http://127.0.0.1:3080/kybernos-cloud/memory/list',
    'curl -s -X POST http://localhost:3080/kybernos-search/query -d \'{"q":"x"}\'',
  ]
  inTeam()
  const denied = []
  for (const d of doors) denied.push(await chain(bash(d)))
  check('team: a shell that names a side door of the personal memory is refused, with the sentence', denied.every((r) => r.kind === 'deny' && String(r.reason).includes('Propose to team')), JSON.stringify(denied))
  const readTool = await chain({ name: 'read', arguments: { file_path: lessonsFile } })
  check('team: so is a file tool on the lessons file', readTool.kind === 'deny')
  const fine = await Promise.all(['ls -la', 'git status', 'node build.mjs', 'ls ~/.dsh/kybers'].map((c) => chain(bash(c))))
  check('team: an ordinary command goes through (the kybers folder as a whole too: the Agent Team matching reads it)', fine.every((r) => r.kind === 'pass'), JSON.stringify(fine))
  inPersonal()
  const personalShell = await chain(bash(doors[0]))
  check('personal: the same command goes through (nothing changes there)', personalShell.kind === 'pass')

  // the routes a shell could use need the signed session
  const guarded = ['/kybernos-cloud/memory/add', '/kybernos-cloud/memory/update', '/kybernos-cloud/memory/lessons', '/kybernos-cloud/team/lessons/add', '/kybernos-cloud/space/active', '/kybernos-cloud/kyby/native/set']
  check('the routes a shell could use to write the memory, choose the space or make a session Kaby\'s need the signed session', guarded.every((p) => cloud.ROUTES.find((r) => r.path === p)?.session === true), guarded.filter((p) => cloud.ROUTES.find((r) => r.path === p)?.session !== true).join(', '))

  // the seam itself in doubt (the reader half: the lessons bundle must cut when it cannot be told; the account memory has its own reader)
  inPersonal()
  const goodSeam = globalThis[Symbol.for('kybernos.space')]
  const LESSON = 'always say it in capitals'
  const lessonsWith = (value) => { globalThis[Symbol.for('kybernos.space')] = value; return blocks.get('kybernos:lessons').text(context) }
  check('the seam throws → the lessons are cut', lessonsWith({ isTeam() { throw new Error('boom') } }).includes(LESSON) === false)
  check('the seam has no isTeam → cut', lessonsWith({ version: 1 }).includes(LESSON) === false)
  check('the seam answers something odd (not the boolean false) → cut', lessonsWith({ isTeam: () => 'maybe' }).includes(LESSON) === false && lessonsWith({ isTeam: () => undefined }).includes(LESSON) === false)
  const toolsWith = async (value) => { globalThis[Symbol.for('kybernos.space')] = value; return tool('lesson_search').execute({ q: 'codename' }) }
  check('the seam in doubt → lesson_search and lesson_write refuse', (await toolsWith({ isTeam() { throw new Error('boom') } })).ok === false && (await tool('lesson_write').execute({ text: 'x lesson, seam in doubt' })).ok === false)
  check('the seam says false → the lessons are back', lessonsWith({ isTeam: () => false }).includes(LESSON) && (await toolsWith({ isTeam: () => false })).ok === true)
  delete globalThis[Symbol.for('kybernos.space')]
  check('no seam at all (no cloud bundle): behaviour unchanged', blocks.get('kybernos:lessons').text(context).includes(LESSON) && (await tool('lesson_search').execute({ q: 'codename' })).ok === true)
  globalThis[Symbol.for('kybernos.space')] = goodSeam

  // ── 5. not connected: no teams exist, nothing changes ──────────────────────────────────────────────────
  notConnected()
  check('not connected: the seam says not a team', goodSeam.isTeam() === false)
  prompt = assemble()
  check('not connected: the local lesson still goes in (as before), no account memory', prompt.includes('always say it in capitals') && prompt.includes('[KYBERNOS MEMORY]') === false && blocks.get('kybernos:memory').text(context) === '')
  check('not connected: the lesson tools work (as before)', (await tool('lesson_search').execute({ q: 'codename' })).ok === true)
  const callsOff = llm.calls
  await runCapture()
  check('not connected: the capture says so (as before)', llm.calls === callsOff && cloud.lastCapture.status === 'hors_connexion', cloud.lastCapture.status)

  console.log(fails === 0 ? '\nALL PASS (' + passed + ' checks)' : '\n' + fails + ' FAILED')
} catch (e) {
  fails += 1
  console.log('  FAIL unexpected: ' + String((e && e.stack) || e))
} finally {
  try { chmodSync(stateFile, 0o600) } catch (e) { /* not there */ }
  api.close()
  try { rmSync(root, { recursive: true, force: true }) } catch (e) { /* temp */ }
  process.exit(fails === 0 ? 0 : 1)
}
