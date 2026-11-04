// A reminder is an automation that runs once, in the chat that made it, on the REAL packages/kybernos-plugin/index.js: the tool `automation_remind` makes it through the
// tasks route, the scheduler tick posts it in that chat, the Automations list shows it like any other, and DSH's own `schedule_create` is refused with the way to the tool.
// The plugin boots with a fake context in a temporary DSH_HOME; no real session is started and nothing outside the temporary folder is read or written.
// Usage: node scripts/test-reminder-route.mjs   (exit 0 = everything passes)
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { createHash, createHmac, randomBytes } from 'node:crypto'

const root = fileURLToPath(new URL('..', import.meta.url))
const dshHome = mkdtempSync(join(tmpdir(), 'kb-reminder-route-'))
process.env.HOME = dshHome
process.env.DSH_HOME = dshHome
process.env.KYBERNOS_AUTOMATION_LOAD_GUARD = 'off'
mkdirSync(join(dshHome, 'kybernos'), { recursive: true })
const tasksFile = join(dshHome, 'kybernos', 'tasks.json')
const gatesFile = join(dshHome, 'kybernos', 'gates.json')
const b64u = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const machineSecret = randomBytes(32)
writeFileSync(join(dshHome, '.credentials.yaml'), 'credentials:\n  - name: client-connection/browser-session\n    secret: ' + b64u(machineSecret) + '\n')
const cookieFor = (authority, expiresAt) => {
  const body = b64u(Buffer.from(JSON.stringify({ version: 1, authority, issuedAt: Date.now(), expiresAt })))
  return 'dsh-auth-' + b64u(createHash('sha256').update(authority).digest()) + '=v1.' + body + '.' + b64u(createHmac('sha256', machineSecret).update(body).digest())
}
const goodCookie = cookieFor('127.0.0.1:3080', Date.now() + 86400000)

const realSetTimeout = globalThis.setTimeout
const captured = []
globalThis.setTimeout = (fn, ms, ...a) => {
  if (ms === 5000 || ms === 30000) { captured.push({ fn, ms }); return { unref () {}, ref () {} } }
  if (ms === 750) return realSetTimeout(fn, 1, ...a)
  return realSetTimeout(fn, ms, ...a)
}

let fails = 0
const eq = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) { fails += 1; console.log('FAIL', label, '| got', JSON.stringify(got), '| want', JSON.stringify(want)) } else console.log('ok  ', label) }

const mod = await import(root + 'packages/kybernos-plugin/index.js')
const routes = {}
const listeners = {}
const registered = {}
const contexts = []
const prompts = []
const created = []
// The chats that exist: `sess-home` is the one the reminder is made in; `sess-gone` was deleted.
const liveSessions = { get: (id) => (id === 'sess-home' ? { id, header: { id } } : undefined) }
const services = {
  fs: {},
  webServer: { register: (r) => { routes[r.path] = r.handler; return () => {} } },
  workspaceRegistry: { list: () => [{ id: 'ws1' }] },
  permissionPresets: { names: ['workspace-write'], resolve: () => ({ sandbox: 'workspace-write', approval: 'ask' }), set: () => {} },
  sessions: liveSessions,
  sessionController: {
    async create () { created.push(true); return { ok: true, value: { sessionId: 'sess-new' } } },
    // The engine reports the session running, then idle once the turn is over.
    async prompt (a) {
      prompts.push(a)
      for (const fn of listeners['agent/status'] || []) { fn({ agent: { session: { id: a.sessionId } }, status: 'running' }); fn({ agent: { session: { id: a.sessionId } }, status: 'idle' }) }
      return { ok: true }
    },
    async selectModel () { return { ok: true } },
    async state () { return { ok: true, value: { running: false, queue: [], pendingInput: [] } } },
    wait () { return new Promise(() => {}) },
    async cancel () { return { ok: true } }
  }
}
const quiet = []
const realErr = console.error; const realLog = console.log
console.error = (...a) => quiet.push(a.join(' ')); console.log = (...a) => quiet.push(a.join(' '))
mod.apply({
  get: (n) => services[n],
  inject: (deps, fn) => {
    if (!Array.isArray(deps)) return
    try {
      if (deps[0] === 'systemPrompt') fn({ systemPrompt: { context: (c) => { contexts.push(c) } } })
      else if (deps[0] === 'tools') fn({ tools: { register: (t) => { registered[t.name] = t } } })
    } catch (e) { /* not this one */ }
  },
  effect: (fn) => { try { return fn() } catch (e) { return undefined } },
  on: (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); return () => {} },
  scope: {}
})
await new Promise((r) => realSetTimeout(r, 50))
console.error = realErr; console.log = realLog

const callRoute = async (bodyText) => {
  const url = '/kybernos/tasks'
  const req = Readable.from([Buffer.from(bodyText)])
  req.method = 'POST'; req.url = url
  req.headers = { origin: 'http://127.0.0.1:3080', cookie: goodCookie }
  req.socket = { localPort: 3080 }
  const res = { status: null, body: null }
  const done = new Promise((resolve) => { res.end = (b) => { res.body = b; resolve() }; res.writeHead = (s) => { res.status = s } })
  await Promise.race([Promise.resolve(routes[url](req, res)).catch(() => {}), done, new Promise((r) => realSetTimeout(r, 3000))])
  try { return JSON.parse(res.body) } catch (e) { return null }
}
const onDisk = () => (existsSync(tasksFile) ? JSON.parse(readFileSync(tasksFile, 'utf8')) : [])
const tick = async () => { const t = captured.filter((x) => x.ms === 30000).pop(); const before = captured.length; t.fn(); const t0 = Date.now(); while (captured.length === before && Date.now() - t0 < 5000) await new Promise((r) => realSetTimeout(r, 5)) }
const inChat = (id) => ({ agent: { session: { id } } })
const remind = registered.automation_remind
const text = (res) => remind.output.render({}, res)[0].text

eq('the plugin registers automation_remind with the other automation tools', [typeof remind, Object.keys(registered).filter((n) => n.indexOf('automation_') === 0).sort()], ['object', ['automation_home', 'automation_remind', 'automation_suggest']])
eq('the prompt tells the model to use it and not schedule_create', contexts.some((c) => typeof c.text === 'function' && c.text().includes('automation_remind') && c.text().includes('schedule_create')), true)

// ── Making a reminder ─────────────────────────────────────────────────────────────────────────────────────────────
eq('outside a chat there is nothing to remind in', await remind.execute({ message: 'Call the plumber', in_minutes: 10 }, {}), { ok: false, error: 'no chat' })
const made = await remind.execute({ message: 'Remind the person to call the plumber.', in_minutes: 10, name: 'Call the plumber' }, inChat('sess-home'))
eq('a reminder in minutes is made', [made.ok, made.existed, made.task.name], [true, undefined, 'Call the plumber'])
const t0 = onDisk()[0]
eq('it is a one-time automation, switched on, that asks first', [t0.schedule.mode, t0.active, t0.approvals, typeof t0.nextRun], ['once', true, 'ask', 'string'])
eq('...posted in the chat the ENGINE named, as its home, not a chat of its own', [t0.sessionMode, t0.homeSessionId, t0.homeOwn], ['home', 'sess-home', false])
eq('...stamped as a reminder made in a chat, with no apps or skills', [t0.origin.recipe, t0.origin.by, t0.needs], ['reminder', 'chat', undefined])
const wait = new Date(t0.nextRun).getTime() - Date.now()
eq('...ten minutes from now', wait > 9 * 60000 && wait <= 10 * 60000 + 2000, true)
eq('...and it keeps no gate record (like a suggestion or a legacy automation)', existsSync(gatesFile) ? JSON.parse(readFileSync(gatesFile, 'utf8')).records.filter((r) => r.automationId === t0.id).length : 0, 0)
eq('the model is told in one line what was set, and that it has not run', text(made).startsWith('Reminder set: “Call the plumber”, ') && text(made).endsWith('in this chat. It is one of the person\'s automations; it has not run yet.'), true)

const again = await remind.execute({ message: 'Remind the person to call the plumber.', in_minutes: 11, name: 'Call the plumber' }, inChat('sess-home'))
eq('the same words at another moment are another reminder', [again.ok, onDisk().length], [true, 2])
const at = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10) + 'T09:30'
const abs = await remind.execute({ message: 'Stand-up.', at, timezone: 'Europe/Paris' }, inChat('sess-home'))
eq('a date-time in a zone is kept as given (name from the message)', [abs.ok, abs.task.name, abs.task.schedule], [true, 'Stand-up.', { mode: 'once', tz: 'Europe/Paris', at }])
const same = await remind.execute({ message: 'Stand-up.', at, timezone: 'Europe/Paris' }, inChat('sess-home'))
eq('the same words, chat and moment are one reminder (a retry of the model)', [same.ok, same.existed, same.task.id === abs.task.id, onDisk().length], [true, true, true, 3])
eq('...and it says it was already set', text(same).startsWith('Already set: '), true)

// ── What is refused, in words ─────────────────────────────────────────────────────────────────────────────────────
const refused = async (args, why) => eq('refused: ' + why, text(await remind.execute(args, inChat('sess-home'))), 'Not done: ' + why + '.')
await refused({ message: '   ', in_minutes: 5 }, 'say what to remind the person of')
await refused({ message: 'x' }, 'give either at or in_minutes')
await refused({ message: 'x', at: '2099-01-02T09:30', in_minutes: 5 }, 'give at or in_minutes, not both')
await refused({ message: 'x', in_minutes: 0 }, 'in_minutes must be a number from 1 to 527040')
await refused({ message: 'x', in_minutes: 600000 }, 'in_minutes must be a number from 1 to 527040')
await refused({ message: 'x', at: 'tomorrow morning' }, 'at must look like 2026-11-03T23:07')
await refused({ message: 'x', at: '2020-01-01T08:00' }, 'that time has already passed')
await refused({ message: 'x', at: '2099-01-02T09:30', timezone: 'Mars/Phobos' }, 'unknown time zone')
await refused({ message: 'x', at: '2099-01-02T09:30' }, 'a reminder can be one year ahead at most')
eq('...and none of them was stored', onDisk().length, 3)
eq('a chat id the model could write is not trusted: the tool takes the engine\'s, an odd one is refused', text(await remind.execute({ message: 'x', in_minutes: 5 }, inChat('bad id/../x'))), 'Not done: a reminder is made from a chat.')
eq('a page cannot make one: the route refuses it for a human request', (await callRoute(JSON.stringify({ action: 'remind', sessionId: 'sess-home', args: { message: 'x', in_minutes: 5 } }))).error, 'not available here')

// twenty-five at most
for (let i = 0; i < 40; i += 1) await remind.execute({ message: 'Bulk ' + i, in_minutes: 20 + i }, inChat('sess-home'))
eq('twenty-five reminders wait at most', onDisk().filter((t) => t.origin && t.origin.recipe === 'reminder' && t.active === true).length, 25)
eq('...and the 26th is said in words', text(await remind.execute({ message: 'one more', in_minutes: 500 }, inChat('sess-home'))), 'Not done: twenty-five reminders already wait: some have to run or be deleted first.')

// ── It comes, in the chat ─────────────────────────────────────────────────────────────────────────────────────────
const all = onDisk()
const due = all.find((t) => t.name === 'Call the plumber')
due.nextRun = new Date(Date.now() - 1000).toISOString()
due.schedule.at = new Date(Date.now() - 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
writeFileSync(tasksFile, JSON.stringify(all, null, 2), { mode: 0o600 })
await tick()
const ran = onDisk().find((t) => t.id === due.id)
eq('at its time the prompt is posted in the chat it was made in, no new chat', [prompts.length, prompts.map((p) => p.sessionId), created.length], [1, ['sess-home'], 0])
eq('...it ran once and is done', [ran.active, ran.nextRun, ran.history.length > 0 || ran.lastRun !== null], [false, null, true])
eq('...and the Automations list shows it like any other (with its home chat)', (await callRoute(JSON.stringify({ action: 'list' }))).tasks.some((t) => t.id === due.id && t.sessionMode === 'home' && t.homeSessionId === 'sess-home'), true)

// ── DSH's own schedule_create is refused, before any approval ─────────────────────────────────────────────────────
// Other modules listen on the same seam: the chain is run the way the engine runs it, each listener getting the next one, the last one letting the call go on.
const pre = listeners['tools/pre-execute'] || []
eq('the refusal is on the engine\'s pre-execute seam', pre.length >= 1, true)
const WENT_ON = { kind: 'went on' }
const through = (exec) => {
  const step = (i) => (i >= pre.length ? WENT_ON : Promise.resolve(pre[i](exec, () => step(i + 1))))
  return Promise.resolve(step(0))
}
const denied = await through({ name: 'schedule_create', agent: inChat('sess-home').agent })
eq('schedule_create is denied with the way to automation_remind', [denied.kind, typeof denied.reason === 'string' && denied.reason.includes('automation_remind')], ['deny', true])
eq('every other tool goes on', [(await through({ name: 'bash' })) === WENT_ON, (await through({ name: 'schedule_list' })) === WENT_ON, (await through({ name: 'automation_remind' })) === WENT_ON], [true, true, true])
writeFileSync(join(dshHome, 'kybernos', 'automation-settings.json'), JSON.stringify({ version: 1, showNativeTasks: true }))
eq('when the person turned DSH\'s native tasks back on, schedule_create goes on', (await through({ name: 'schedule_create' })) === WENT_ON, true)

console.log(fails === 0 ? '\nall checks passed' : '\n' + fails + ' check(s) FAILED')
process.exit(fails === 0 ? 0 : 1)
