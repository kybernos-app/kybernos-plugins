// Test of the core automation "Tidy memory & lessons" (packages/kybernos-plugin/automation-core.mjs), end to end on the REAL
// packages/kybernos-plugin/index.js: the plugin boots with a fake context in temporary DSH homes, and the test reads tasks.json and
// the ledger next to it (core-automations.json). It proves: made once at the first start with a readable store, active, daily at
// 03:30 in the machine's zone, approvals `auto`, `core: 'memory-tidy'`; two starts never make two; a pause and an edit are kept and a
// body from the page can neither set nor change `core`; a deletion is recorded and never undone; a damaged ledger or store makes
// nothing; a run sends the prompt that calls memory_tidy without the "ask" permission preset. No real session is started.
// Usage: node scripts/test-core-automation.mjs   (exit 0 = everything passes)
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { createHash, createHmac, randomBytes } from 'node:crypto'

const root = fileURLToPath(new URL('..', import.meta.url))
const core = await import(root + 'packages/kybernos-plugin/automation-core.mjs')
let fails = 0
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) { fails++; console.log('FAIL', label, '| got', JSON.stringify(got), '| want', JSON.stringify(want)) } else console.log('ok  ', label)
}

/* -- The pure module ---------------------------------------------------------------------------------------------------- */
{
  const input = core.coreTaskInput('memory-tidy', { tz: 'Europe/Paris' })
  eq('the core input: English name, daily 03:30 in the given zone, active, approvals auto, one home chat', [input.name, input.schedule, input.active, input.approvals, input.sessionMode], ['Tidy memory & lessons', { mode: 'cron', cron: '30 3 * * *', tz: 'Europe/Paris' }, true, 'auto', 'home'])
  eq('without a zone the sanitizer will put the machine\'s own', core.coreTaskInput('memory-tidy').schedule, { mode: 'cron', cron: '30 3 * * *' })
  eq('an unknown core id has no input', core.coreTaskInput('other'), null)
  eq('the French name, written with escapes', core.MEMORY_TIDY_NAMES.fr, 'Ranger m\u00e9moire et le\u00e7ons')
  const p = core.memoryTidyPrompt()
  eq('the prompt calls memory_tidy once, no other tool, two lines, no deletion by hand, one line when the tool is absent', [/Call the memory_tidy tool once/.test(p), /Call no other tool/.test(p), /two plain lines/.test(p), /Never delete/.test(p), /not in your tool list, answer in one line/.test(p)], [true, true, true, true, true])
  eq('the ledger: no file is empty, a damaged one is unreadable', [core.coreLedgerParse(null), core.coreLedgerParse('{oops'), core.coreLedgerParse('[]'), core.coreLedgerParse('"x"')], [{ ok: true, ledger: {} }, { ok: false }, { ok: false }, { ok: false }])
  eq('the ledger keeps known ids and dates only', core.coreLedgerParse(JSON.stringify({ 'memory-tidy': { seededAt: '2026-11-08T03:30:00.000Z', deletedAt: 'never', x: 1 }, other: { seededAt: '2026-11-08T03:30:00.000Z' } })), { ok: true, ledger: { 'memory-tidy': { seededAt: '2026-11-08T03:30:00.000Z' } } })
  const t = { id: 'a', core: 'memory-tidy' }
  eq('the plan: a task carries it, the ledger says made or deleted, or make it', [core.corePlan([t], {}, 'memory-tidy'), core.corePlan([], { 'memory-tidy': { seededAt: 'x' } }, 'memory-tidy'), core.corePlan([], { 'memory-tidy': { deletedAt: 'x' } }, 'memory-tidy'), core.corePlan([], {}, 'memory-tidy'), core.corePlan(null, null, 'memory-tidy')], ['exists', 'deleted', 'deleted', 'create', 'create'])
  eq('the plan on a phone: nothing is made and nothing is recorded, but a task already there stays and a deletion is still a deletion', [core.corePlan([], {}, 'memory-tidy', 'android'), core.corePlan([], {}, 'memory-tidy', 'ios'), core.corePlan([t], {}, 'memory-tidy', 'android'), core.corePlan([], { 'memory-tidy': { deletedAt: 'x' } }, 'memory-tidy', 'ios'), core.corePlan([], {}, 'memory-tidy', 'darwin'), core.corePlan([], {}, 'memory-tidy')], ['not-on-phone', 'not-on-phone', 'exists', 'deleted', 'create', 'create'])
  eq('coreOf reads a known core only', [core.coreOf(t), core.coreOf({ core: 'x' }), core.coreOf(null)], ['memory-tidy', null, null])
  eq('coreLedgerWith adds a field without touching the given ledger', (() => { const a = { 'memory-tidy': { seededAt: 's' } }; const b = core.coreLedgerWith(a, 'memory-tidy', 'deletedAt', 'd'); return [a, b] })(), [{ 'memory-tidy': { seededAt: 's' } }, { 'memory-tidy': { seededAt: 's', deletedAt: 'd' } }])
}

/* -- The host ----------------------------------------------------------------------------------------------------------- */
const b64u = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const secret = randomBytes(32)
const cookie = (() => {
  const authority = '127.0.0.1:3080'
  const body = b64u(Buffer.from(JSON.stringify({ version: 1, authority, issuedAt: Date.now(), expiresAt: Date.now() + 86400000 })))
  return 'dsh-auth-' + b64u(createHash('sha256').update(authority).digest()) + '=v1.' + body + '.' + b64u(createHmac('sha256', secret).update(body).digest())
})()
const realSetTimeout = globalThis.setTimeout
globalThis.setTimeout = (fn, ms, ...a) => {
  if (ms === 5000 || ms === 30000) return { unref() {}, ref() {} }
  if (ms === 750) return realSetTimeout(fn, 1, ...a)
  return realSetTimeout(fn, ms, ...a)
}
const sleep = (ms) => new Promise((r) => realSetTimeout(r, ms))
// The console is muted while a host starts (its own logs are kept per start). Saved once: two starts at once must not keep it muted.
const realErr = console.error
const realLog = console.log
let muted = 0
process.env.KYBERNOS_AUTOMATION_LOAD_GUARD = 'off'
const mod = await import(root + 'packages/kybernos-plugin/index.js')

const newHome = (name) => {
  const home = mkdtempSync(join(tmpdir(), 'kb-core-' + name + '-'))
  mkdirSync(join(home, 'kybernos'), { recursive: true })
  writeFileSync(join(home, '.credentials.yaml'), 'credentials:\n  - name: client-connection/browser-session\n    secret: ' + b64u(secret) + '\n')
  return home
}
const tasksOf = (home) => (existsSync(join(home, 'kybernos', 'tasks.json')) ? JSON.parse(readFileSync(join(home, 'kybernos', 'tasks.json'), 'utf8')) : [])
const ledgerOf = (home) => (existsSync(join(home, 'kybernos', 'core-automations.json')) ? JSON.parse(readFileSync(join(home, 'kybernos', 'core-automations.json'), 'utf8')) : null)
const cores = (home) => tasksOf(home).filter((t) => t !== null && typeof t === 'object' && t.core === 'memory-tidy')

// One start of the host on `home`: its own routes and services. Resolves once its core check had time to finish.
const boot = async (home, extra) => {
  process.env.HOME = home
  process.env.DSH_HOME = home
  const routes = {}
  const seen = { prompts: [], presets: [] }
  const services = Object.assign({
    fs: {},
    webServer: { register: (r) => { routes[r.path] = r.handler; return () => {} } },
    workspaceRegistry: { list: () => [{ id: 'ws1' }] },
    sessions: { get: (id) => (String(id).indexOf('sess-') === 0 ? { id } : undefined) },
    permissionPresets: { names: ['workspace-write'], resolve: () => ({ approval: 'ask' }), set: (s, n) => { seen.presets.push(n) } },
    sessionController: { async create() { return { ok: true, value: { sessionId: 'sess-1' } } }, async prompt(a) { seen.prompts.push(a); return { ok: true } }, async selectModel() { return { ok: true } } },
  }, extra || {})
  const logs = []
  muted += 1
  console.error = (...a) => logs.push(a.join(' ')); console.log = (...a) => logs.push(a.join(' '))
  mod.apply({ get: (n) => services[n], inject: () => {}, effect: (fn) => { try { return fn() } catch (e) { return undefined } }, on: () => () => {}, scope: {} })
  await sleep(250)
  muted -= 1
  if (muted === 0) { console.error = realErr; console.log = realLog }
  const api = async (obj) => {
    const req = Readable.from([Buffer.from(JSON.stringify(obj))])
    req.method = 'POST'; req.url = '/kybernos/tasks'
    req.headers = { origin: 'http://127.0.0.1:3080', cookie }
    req.socket = { localPort: 3080 }
    const res = { body: null }
    const done = new Promise((resolve) => { res.end = (b) => { res.body = b; resolve() }; res.writeHead = () => {} })
    await Promise.race([Promise.resolve(routes['/kybernos/tasks'](req, res)).catch(() => {}), done, sleep(3000)])
    return JSON.parse(res.body)
  }
  return { api, seen, logs }
}

const machineTz = Intl.DateTimeFormat().resolvedOptions().timeZone
// On a phone (the engine of the app reports android or ios) the core automation is not made by itself: no task, no ledger entry.
{
  const was = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: 'android', configurable: true })
  const home = newHome('phone')
  try { await boot(home) } finally { Object.defineProperty(process, 'platform', was) }
  eq('a fresh store on a phone: no core automation is made, and no ledger is written', [cores(home).length, ledgerOf(home)], [0, null])
}

{
  const home = newHome('fresh')
  const h = await boot(home)
  const made = cores(home)
  eq('a fresh store: the core automation is made, once', made.length, 1)
  const t = made[0]
  eq('...active, daily at 03:30 in the machine\'s zone, on this computer, approvals auto, one home chat', [t.active, t.schedule, t.runsOn, t.approvals, t.sessionMode], [true, { mode: 'cron', tz: machineTz, cron: '30 3 * * *' }, 'local', 'auto', 'home'])
  eq('...named in English, with the prompt that calls memory_tidy', [t.name, t.prompt], ['Tidy memory & lessons', core.memoryTidyPrompt()])
  const next = new Date(t.nextRun)
  const local = new Intl.DateTimeFormat('en-GB', { timeZone: machineTz, hour: '2-digit', minute: '2-digit', hour12: false }).format(next)
  eq('...its next run is at 03:30 local time, within a day', [/^0[23]:[0-9]{2}$/.test(local), next.getTime() - Date.now() > 0, next.getTime() - Date.now() <= 86400000 + 3600000], [true, true, true])
  eq('...it says where it came from', [t.origin.by, t.origin.recipe], ['kaby', 'memory-tidy'])
  eq('...it has no gate record (a core automation is not a draft to certify)', existsSync(join(home, 'kybernos', 'gates.json')) ? JSON.parse(readFileSync(join(home, 'kybernos', 'gates.json'), 'utf8')).records.filter((r) => r.automationId === t.id).length : 0, 0)
  eq('the ledger says it was made, and is private (0600)', [typeof ledgerOf(home)['memory-tidy'].seededAt, ledgerOf(home)['memory-tidy'].deletedAt, (statSync(join(home, 'kybernos', 'core-automations.json')).mode & 0o777).toString(8)], ['string', undefined, '600'])
  eq('the list of the page shows it with its core mark', (await h.api({ action: 'list' })).tasks.map((x) => [x.core, x.name]), [['memory-tidy', 'Tidy memory & lessons']])

  // A run: the prompt goes out as is, and no "ask" preset is put on its session (approvals auto).
  const ran = await h.api({ action: 'run-now', id: t.id })
  eq('a run opens a session and sends the prompt that calls memory_tidy', [ran.ok, h.seen.prompts.length, /memory_tidy/.test(h.seen.prompts[0].content[0].text)], [true, 1, true])
  eq('...without the "ask" permission preset', h.seen.presets, [])

  // A body from the page can neither set nor change `core`; an edit and a pause are kept.
  const other = await h.api({ action: 'create', task: { name: 'Mine', prompt: 'Do it', core: 'memory-tidy', schedule: { mode: 'cron', cron: '0 8 * * *' } } })
  eq('a created task never carries `core`, even when the body says so', [other.ok, other.task.core, tasksOf(home).find((x) => x.id === other.task.id).core], [true, undefined, undefined])
  const edited = await h.api({ action: 'update', id: t.id, task: { name: 'My night tidy', prompt: t.prompt, core: 'other', schedule: { mode: 'cron', cron: '0 4 * * *' }, active: true, approvals: 'auto' } })
  eq('an edit is allowed and keeps `core` (the body\'s is ignored)', [edited.ok, edited.task.name, edited.task.schedule.cron, edited.task.core], [true, 'My night tidy', '0 4 * * *', 'memory-tidy'])
  const paused = await h.api({ action: 'toggle', id: t.id, active: false })
  eq('it can be paused', [paused.ok, paused.task.active, paused.task.nextRun], [true, false, null])

  // A second start, and two at once: never a second one, and the pause and the edit are kept.
  await boot(home)
  await Promise.all([boot(home), boot(home)])
  eq('three more starts: still one core automation', cores(home).length, 1)
  eq('...still paused and still edited', [cores(home)[0].active, cores(home)[0].name], [false, 'My night tidy'])

  // Deleted by the person: recorded first, then gone, and never made again.
  const gone = await h.api({ action: 'delete', id: t.id })
  eq('it can be deleted', [gone.ok, cores(home).length], [true, 0])
  eq('the ledger records the deletion', typeof ledgerOf(home)['memory-tidy'].deletedAt, 'string')
  await boot(home)
  eq('a start after the deletion makes nothing', [cores(home).length, tasksOf(home).length], [0, 1])
}
{
  const home = newHome('parallel')
  await Promise.all([boot(home), boot(home)])
  eq('two starts at once on a fresh store make one core automation', cores(home).length, 1)
}
{
  // Deleted outside the page (the automation-creator skill or by hand): the ledger says it was made, so it is not made again.
  const home = newHome('byhand')
  writeFileSync(join(home, 'kybernos', 'tasks.json'), '[]')
  writeFileSync(join(home, 'kybernos', 'core-automations.json'), JSON.stringify({ 'memory-tidy': { seededAt: '2026-11-01T00:00:00.000Z' } }))
  await boot(home)
  eq('made once, then removed by hand: not made again', cores(home).length, 0)
}
{
  const home = newHome('ledgerbad')
  writeFileSync(join(home, 'kybernos', 'core-automations.json'), '{not json')
  const h = await boot(home)
  eq('a damaged ledger makes nothing and is left as it is', [cores(home).length, readFileSync(join(home, 'kybernos', 'core-automations.json'), 'utf8')], [0, '{not json'])
  eq('...and says why in the log', h.logs.some((l) => /core automation memory-tidy: core-automations\.json unreadable/.test(l)), true)
}
{
  const home = newHome('storebad')
  writeFileSync(join(home, 'kybernos', 'tasks.json'), '{"not": "a list"}')
  await boot(home)
  eq('an unreadable store makes nothing and is not rewritten', [readFileSync(join(home, 'kybernos', 'tasks.json'), 'utf8'), ledgerOf(home)], ['{"not": "a list"}', null])
}
{
  // The task is in tasks.json but the ledger was never written (a crash in between): the next start repairs the ledger, makes nothing.
  const home = newHome('repair')
  writeFileSync(join(home, 'kybernos', 'tasks.json'), JSON.stringify([{ id: 'st-x', name: 'Tidy memory & lessons', prompt: 'p', core: 'memory-tidy', active: true, schedule: { mode: 'cron', cron: '30 3 * * *', tz: 'UTC' }, history: [] }]))
  await boot(home)
  eq('a core task without its ledger line: one task, and the ledger is written', [cores(home).length, typeof ledgerOf(home)['memory-tidy'].seededAt], [1, 'string'])
}
{
  // A deletion the ledger cannot record is refused: the next start would make the automation again.
  const home = newHome('delrefused')
  const h = await boot(home)
  const id = cores(home)[0].id
  writeFileSync(join(home, 'kybernos', 'core-automations.json'), '{broken')
  const r = await h.api({ action: 'delete', id })
  eq('a deletion that cannot be recorded is refused, and the automation stays', [r.ok, /could not be recorded/.test(r.error), cores(home).length], [false, true, 1])
}

if (fails > 0) { console.log('\n' + fails + ' FAILURE(S)'); process.exit(1) }
console.log('\nALL PASS')
process.exit(0)
