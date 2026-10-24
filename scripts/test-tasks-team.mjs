// Test of the four Team automations routes of the host (docs/dev/team-automations-contract.md, piece 2): POST /kybernos/automation/team-pack | team-copies | team-install |
// team-update. The rules themselves are packages/kybernos-plugin/automation-team.mjs's (its own test); this drives the real routes end to end, on the REAL
// packages/kybernos-plugin/index.js with a fake context in a temporary DSH_HOME: an install is a paused automation written through the sanitizer and the store a created one goes
// through, the mark survives every ordinary edit, the three update modes, the exact answers, and every refusal without DSH's signed session.
// Usage: node scripts/test-tasks-team.mjs   (exit 0 = everything passes)
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { createHash, createHmac, randomBytes } from 'node:crypto'

const root = fileURLToPath(new URL('..', import.meta.url))
const dshHome = mkdtempSync(join(tmpdir(), 'kb-tasks-team-'))
process.env.HOME = dshHome
process.env.DSH_HOME = dshHome
mkdirSync(join(dshHome, 'kybernos'), { recursive: true })
const b64u = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const writeSecret = (secret) => writeFileSync(join(dshHome, '.credentials.yaml'), 'credentials:\n  - name: client-connection/browser-session\n    secret: ' + b64u(secret) + '\n')
const cookieFor = (secret) => {
  const authority = '127.0.0.1:3080'
  const body = b64u(Buffer.from(JSON.stringify({ version: 1, authority, issuedAt: Date.now(), expiresAt: Date.now() + 86400000 })))
  return 'dsh-auth-' + b64u(createHash('sha256').update(authority).digest()) + '=v1.' + body + '.' + b64u(createHmac('sha256', secret).update(body).digest())
}
const secret = randomBytes(32)
writeSecret(secret)
const cookie = cookieFor(secret)
const forged = cookieFor(randomBytes(32))
const realSetTimeout = globalThis.setTimeout
globalThis.setTimeout = (fn, ms, ...a) => {
  if (ms === 5000 || ms === 30000) return { unref() {}, ref() {} }
  if (ms === 750) return realSetTimeout(fn, 1, ...a)
  return realSetTimeout(fn, ms, ...a)
}
let fails = 0
const eq = (label, got, want) => { const ok = got === want; if (!ok) { fails++; console.log('FAIL', label, '| got', got, '| want', want) } else console.log('ok  ', label) }
const same = (label, got, want) => eq(label, JSON.stringify(got), JSON.stringify(want))
process.env.KYBERNOS_AUTOMATION_LOAD_GUARD = 'off'
const { versionOf } = await import(root + 'packages/kybernos-plugin/automation-team.mjs')
const mod = await import(root + 'packages/kybernos-plugin/index.js')
const routes = {}
const services = { fs: {}, webServer: { register: (r) => { routes[r.path] = r.handler; return () => {} } }, workspaceRegistry: { list: () => [{ id: 'ws1' }] }, sessions: { get: () => undefined }, sessionController: { async create() { return { ok: true, value: { sessionId: 'sess-1' } } }, async prompt() { return { ok: true } }, async selectModel() { return { ok: true } } } }
const realErr = console.error; const realLog = console.log
console.error = () => {}; console.log = () => {}
mod.apply({ get: (n) => services[n], inject: () => {}, effect: (fn) => { try { return fn() } catch (e) { return undefined } }, on: () => () => {}, scope: {} })
await new Promise((r) => realSetTimeout(r, 50))
console.error = realErr; console.log = realLog

// A call to a route: `{ status, json }`. `opts.headers` replaces the default headers (a refusal test), `opts.method`, `opts.raw` a body sent as it is.
const call = async (path, obj, opts) => {
  const o = opts || {}
  const req = Readable.from([Buffer.from(o.raw !== undefined ? o.raw : JSON.stringify(obj))])
  req.method = o.method || 'POST'; req.url = path
  req.headers = o.headers !== undefined ? o.headers : { origin: 'http://127.0.0.1:3080', cookie }
  req.socket = { localPort: 3080 }
  const res = { body: null, status: null }
  const done = new Promise((resolve) => { res.end = (b) => { res.body = b; resolve() }; res.writeHead = (s) => { res.status = s } })
  await Promise.race([Promise.resolve(routes[path](req, res)).catch(() => {}), done, new Promise((r) => realSetTimeout(r, 3000))])
  let json = null
  try { json = JSON.parse(res.body) } catch (e) { json = null }
  return { status: res.status, json }
}
const team = async (kind, obj, opts) => (await call('/kybernos/automation/' + kind, obj, opts)).json
const api = async (obj) => (await call('/kybernos/tasks', obj)).json
const tasksFile = join(dshHome, 'kybernos', 'tasks.json')
const stored = () => JSON.parse(readFileSync(tasksFile, 'utf8'))
const storedOf = (id) => stored().find((t) => t.id === id)
const WS = 'ws-team-1'
const MACHINE_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone
const def = (o) => {
  const d = Object.assign({ id: 7, key: 'invoice-reminder', name: 'Invoice reminder', description: 'Drafts a reminder for every late invoice.', prompt: 'Every Monday, draft a polite reminder for each late invoice.', schedule: { mode: 'cron', cron: '0 9 * * 1' }, needs: ['slack', 'gmail'] }, o)
  d.version = versionOf(d)
  return d
}
const install = (d, extra) => team('team-install', Object.assign({ definition: d, workspaceId: WS, approvals: 'ask', turnOn: false }, extra))
const update = (taskId, d, mode, extra) => team('team-update', Object.assign({ taskId, definition: d, mode }, extra))
const MARK_KEYS = ['workspaceId', 'id', 'key', 'version', 'installedAt', 'base', 'contentHash']

/* ── the four routes need the pair a write needs: a strict Origin AND DSH's signed session ──────────────────────────── */
const KINDS = ['team-pack', 'team-copies', 'team-install', 'team-update']
const BODIES = { 'team-pack': { id: 'x' }, 'team-copies': {}, 'team-install': { definition: def(), workspaceId: WS, approvals: 'ask', turnOn: true }, 'team-update': { taskId: 'x', definition: def(), mode: 'replace' } }
for (const kind of KINDS) {
  const path = '/kybernos/automation/' + kind
  eq(kind + ': is mounted', typeof routes[path], 'function')
  eq(kind + ': GET is refused', (await call(path, {}, { method: 'GET' })).status, 405)
  eq(kind + ': no Origin and no cookie is refused', (await call(path, BODIES[kind], { headers: {} })).status, 403)
  eq(kind + ': a foreign Origin, even with the real cookie, is refused', (await call(path, BODIES[kind], { headers: { origin: 'http://evil.example', cookie } })).status, 403)
  eq(kind + ': the right Origin and no cookie is refused', (await call(path, BODIES[kind], { headers: { origin: 'http://127.0.0.1:3080' } })).status, 401)
  eq(kind + ': a forged cookie is refused', (await call(path, BODIES[kind], { headers: { origin: 'http://127.0.0.1:3080', cookie: forged } })).status, 401)
}
eq('...and a refused install wrote nothing', readdirSync(join(dshHome, 'kybernos')).includes('tasks.json'), false)
const big = await call('/kybernos/automation/team-install', {}, { raw: JSON.stringify({ pad: 'x'.repeat(200000) }) })
same('a body past the cap is refused in JSON', [big.status, big.json], [413, { ok: false, error: 'request body too large' }])
same('a body that is not an object is refused', (await call('/kybernos/automation/team-copies', null, { raw: '[1]' })).status, 400)
same('no tasks yet: no copies', await team('team-copies', {}), { ok: true, copies: [] })

/* ── team-pack ───────────────────────────────────────────────────────────────────────────────────────────────────────────── */
const own = (await api({ action: 'create', task: { name: 'Late invoices', prompt: 'Look at the invoices more than 30 days old. Draft a reminder for each.\nNever send anything.', schedule: { mode: 'cron', cron: '0  9 * * 1', tz: 'Asia/Tokyo' }, active: true, approvals: 'auto', notify: ['push'], needs: ['slack', 'gmail'], workspaceHint: 'ws1' } })).task
const packed = await team('team-pack', { id: own.id })
same('pack: the contract\'s answer', Object.keys(packed), ['ok', 'proposal', 'team'])
same('pack: the proposal has the contract\'s fields', Object.keys(packed.proposal), ['key', 'name', 'description', 'prompt', 'schedule', 'needs', 'version'])
same('pack: its values', [packed.proposal.key, packed.proposal.name, packed.proposal.description, packed.proposal.schedule, packed.proposal.needs, packed.team], ['late-invoices', 'Late invoices', 'Look at the invoices more than 30 days old.', { mode: 'cron', cron: '0 9 * * 1' }, ['gmail', 'slack'], null])
eq('pack: the version is the one of the proposal', packed.proposal.version, versionOf(packed.proposal))
const packText = JSON.stringify(packed)
for (const leak of ['Asia/Tokyo', 'ws1', own.id, 'runsOn', 'approvals', 'notify', 'active', 'history', 'push']) eq('pack: nothing of the task leaks (' + leak + ')', packText.includes(leak), false)
const hooked = (await api({ action: 'create', task: { name: 'On call', prompt: 'Handle the call.', schedule: { mode: 'webhook' } } })).task
const minted = await api({ action: 'hook-generate', id: hooked.id })
const hookPack = await team('team-pack', { id: hooked.id })
same('pack: a webhook automation is a kind', hookPack.proposal.schedule, { mode: 'webhook' })
eq('pack: ...with no address and no secret', JSON.stringify(hookPack).includes(minted.hookId) || JSON.stringify(hookPack).includes(minted.secret), false)
const onceTask = (await api({ action: 'create', task: { name: 'One time', prompt: 'Once.', schedule: { mode: 'once', at: '2099-01-01T08:00', tz: 'UTC' } } })).task
same('pack: a one-time automation is refused', await team('team-pack', { id: onceTask.id }), { ok: false, error: 'once_not_shareable' })
same('pack: an unknown id', await team('team-pack', { id: 'st-nope' }), { ok: false, error: 'not_found' })
same('pack: no id', await team('team-pack', {}), { ok: false, error: 'not_found' })
const suggested = (await api({ action: 'suggest', task: { name: 'Kaby idea', prompt: 'Do the thing.', schedule: { mode: 'cron', cron: '0 8 * * *' } }, proof: { n: 3 } })).task
same('pack: a suggestion that was not added yet is not the person\'s automation', await team('team-pack', { id: suggested.id }), { ok: false, error: 'not_found' })
const blank = stored(); blank.push({ id: 'st-blank', name: 'Blank', prompt: '   ', schedule: { mode: 'cron', cron: '0 8 * * *' }, active: false }); writeFileSync(tasksFile, JSON.stringify(blank), { mode: 0o600 })
same('pack: an empty prompt is refused', await team('team-pack', { id: 'st-blank' }), { ok: false, error: 'empty_prompt' })
await api({ action: 'delete', id: 'st-blank' })
await api({ action: 'delete', id: suggested.id })

/* ── team-install ─────────────────────────────────────────────────────────────────────────────────────────────────────────── */
const d1 = def()
const i1 = await install(d1)
same('install: a paused copy, the contract\'s answer', Object.keys(i1), ['ok', 'taskId', 'active', 'missingApps'])
same('install: paused, no app reported missing (the host cannot know which are connected)', [i1.ok, i1.active, i1.missingApps], [true, false, []])
const t1 = storedOf(i1.taskId)
same('install: a task like a created one (id, dates, history, last run)', [typeof t1.id, typeof t1.createdAt, t1.createdAt === t1.updatedAt, t1.history, t1.lastRun], ['string', 'string', true, [], null])
same('install: paused, local, asks first by default, the definition\'s fields', [t1.active, t1.nextRun, t1.runsOn, t1.approvals, t1.name, t1.prompt, t1.needs], [false, null, 'local', 'ask', d1.name, d1.prompt, ['gmail', 'slack']])
same('install: the cron in the installer\'s own zone', t1.schedule, { mode: 'cron', tz: MACHINE_ZONE, cron: '0 9 * * 1' })
same('install: the mark has the contract\'s fields', Object.keys(t1.team), MARK_KEYS)
same('install: ...where it came from', [t1.team.workspaceId, t1.team.id, t1.team.key, t1.team.version], [WS, 7, 'invoice-reminder', d1.version])
same('install: ...and the definition as installed, no zone', t1.team.base, { name: d1.name, prompt: d1.prompt, schedule: { mode: 'cron', cron: '0 9 * * 1' }, needs: ['gmail', 'slack'] })
eq('install: ...with the hash of it', /^[0-9a-f]{64}$/.test(t1.team.contentHash), true)
eq('install: no webhook for a cron automation', t1.trigger, undefined)
eq('install: tasks.json is private (0600), like the store always writes it', (statSync(tasksFile).mode & 0o777).toString(8), '600')
const copies1 = (await team('team-copies', {})).copies
same('copies: the contract\'s fields, only the copies that came from a team', copies1.map((c) => Object.keys(c)), [['taskId', 'workspaceId', 'id', 'key', 'version', 'edited', 'missingApps']])
same('copies: its values', copies1[0], { taskId: i1.taskId, workspaceId: WS, id: 7, key: 'invoice-reminder', version: d1.version, edited: false, missingApps: [] })
same('pack of a copy: it says where it came from', (await team('team-pack', { id: i1.taskId })).team, { workspaceId: WS, id: 7, key: 'invoice-reminder', version: d1.version, edited: false })

const i2 = await install(def({ id: 21, key: 'daily-digest', name: 'Daily digest', prompt: 'Summarise the day.', schedule: { mode: 'cron', cron: '0 18 * * *' }, needs: [] }), { turnOn: true, approvals: 'auto' })
same('install: turned on when asked and nothing is missing', [i2.ok, i2.active, i2.missingApps], [true, true, []])
const t2 = storedOf(i2.taskId)
same('install: active with a next run, approvals as asked', [t2.active, typeof t2.nextRun, Date.parse(t2.nextRun) > Date.now(), t2.approvals], [true, 'string', true, 'auto'])
const i2b = await install(def({ id: 22, key: 'weekly-wrap', name: 'Weekly wrap', prompt: 'Wrap up the week.', needs: [] }), { approvals: 'sure', turnOn: 'yes' })
same('install: an approval mode that is neither ask nor auto is ask; turnOn must be true, not just truthy', [i2b.active, storedOf(i2b.taskId).approvals], [false, 'ask'])

// Trimming (the contract's « Trimming and the note »): the text is trimmed, then the version is recomputed from it and compared.
const tidy = def({ id: 15, key: 'padded-one', name: 'Padded one', description: 'Handles it.', prompt: 'Handle the thing.', needs: [] })
const padded = Object.assign({}, tidy, { name: '  Padded one\n', description: ' Handles it.\t', prompt: '\n\nHandle the thing.  ' })
const pi = await install(padded)
same('install: an untrimmed definition is trimmed first, then its version matches the one of the trimmed text', [pi.ok, storedOf(pi.taskId).name, storedOf(pi.taskId).prompt, storedOf(pi.taskId).team.base.name, storedOf(pi.taskId).team.base.prompt, storedOf(pi.taskId).team.version], [true, 'Padded one', 'Handle the thing.', 'Padded one', 'Handle the thing.', tidy.version])
const rawHash = createHash('sha256').update(JSON.stringify({ key: padded.key, name: padded.name, description: padded.description, prompt: padded.prompt, schedule: padded.schedule, needs: padded.needs }), 'utf8').digest('hex')
same('install: a version computed over the UNtrimmed text is not the version of this definition', await install(Object.assign({}, padded, { key: 'padded-two', version: rawHash })), { ok: false, error: 'version_mismatch' })
same('copies: a copy installed from untrimmed text is not edited', (await team('team-copies', {})).copies.find((c) => c.taskId === pi.taskId).edited, false)
await api({ action: 'delete', id: pi.taskId })

const before = readFileSync(tasksFile, 'utf8')
same('install: the same key in the same workspace is already installed', await install(d1), { ok: false, error: 'already_installed', taskId: i1.taskId })
const wrongVersion = Object.assign({}, def({ id: 30, key: 'tampered' }), { prompt: 'Something else was approved.' })
same('install: a definition that does not hash to its version is refused', await install(wrongVersion), { ok: false, error: 'version_mismatch' })
same('install: no version at all', await install(Object.assign({}, def({ key: 'no-version' }), { version: undefined })), { ok: false, error: 'version_mismatch' })
same('install: a one-time schedule', await install(def({ key: 'one-shot', schedule: { mode: 'once', at: '2099-01-01T08:00' } })), { ok: false, error: 'invalid_automation', reason: 'schedule', field: 'schedule' })
same('install: a zone sent with the schedule', await install(def({ key: 'with-zone', schedule: { mode: 'cron', cron: '0 9 * * 1', tz: 'UTC' } })), { ok: false, error: 'invalid_automation', reason: 'schedule', field: 'schedule' })
same('install: a cron the host cannot parse', await install(def({ key: 'bad-cron', schedule: { mode: 'cron', cron: '0 9 * * MON' } })), { ok: false, error: 'invalid_automation', reason: 'schedule', field: 'schedule' })
same('install: a cron that never fires', await install(def({ key: 'never', schedule: { mode: 'cron', cron: '0 0 31 2 *' } })), { ok: false, error: 'invalid_automation', reason: 'schedule', field: 'schedule' })
same('install: a NUL in the prompt', await install(def({ key: 'binary', prompt: 'a\u0000b' })), { ok: false, error: 'invalid_automation', reason: 'binary', field: 'prompt' })
same('install: no definition', await install(undefined), { ok: false, error: 'invalid_automation', reason: 'key', field: 'definition' })
same('install: no workspace', await team('team-install', { definition: def({ key: 'no-ws' }), turnOn: false }), { ok: false, error: 'invalid_workspace' })
same('install: a workspace id that is not an id', await team('team-install', { definition: def({ key: 'bad-ws' }), workspaceId: 'a b/c' }), { ok: false, error: 'invalid_workspace' })
eq('install: none of those refusals wrote anything', readFileSync(tasksFile, 'utf8'), before)
const other = await install(d1, { workspaceId: 'ws-team-2' })
eq('install: the same key for another team is another copy', other.ok === true && other.taskId !== i1.taskId, true)
same('install: ...with its own mark', [storedOf(other.taskId).team.workspaceId, (await team('team-copies', {})).copies.length], ['ws-team-2', 4])

// frequent rhythm: the person's yes, as for any created automation (A5-24)
const fast = def({ id: 40, key: 'every-minute', name: 'Every minute', prompt: 'Check.', schedule: { mode: 'cron', cron: '* * * * *' }, needs: [] })
const sizeBefore = stored().length
same('install: an every-minute rhythm needs the person\'s yes', await install(fast, { turnOn: true }), { ok: false, error: 'frequent schedule', everyMinutes: 1 })
eq('install: ...and nothing was written', stored().length, sizeBefore)
const confirmed = await install(fast, { turnOn: true, confirmFrequent: true })
same('install: ...with it, it goes through', [confirmed.ok, confirmed.active], [true, true])

// a webhook automation mints its own secret, as a created one does
const wd = def({ id: 50, key: 'hook-demo', name: 'Hook demo', description: 'Runs when called.', prompt: 'Say hi.', schedule: { mode: 'webhook' }, needs: [] })
const w1 = await install(wd, { turnOn: true })
const w2 = await install(wd, { workspaceId: 'ws-team-2' })
const tw1 = storedOf(w1.taskId); const tw2 = storedOf(w2.taskId)
same('webhook: the contract\'s second vector installs', [w1.ok, w1.active, tw1.team.version], [true, true, 'e68467deacc2f458f0b1c5a0655c743e5b8ff1c81e20b9104c191a820f8fa5dd'])
same('webhook: a webhook-only schedule with no next run', [tw1.schedule.mode, tw1.nextRun, tw1.schedule.cron], ['webhook', null, undefined])
eq('webhook: its own address and secret, the shapes hook-generate makes', /^hk_[0-9a-f]{12}$/.test(tw1.trigger.hookId) && /^[0-9a-f]{32}$/.test(tw1.trigger.secret) && tw1.trigger.type === 'webhook', true)
eq('webhook: another copy has another address and secret', tw1.trigger.hookId !== tw2.trigger.hookId && tw1.trigger.secret !== tw2.trigger.secret, true)
eq('webhook: neither is in the answer', JSON.stringify(w1).includes(tw1.trigger.secret) || JSON.stringify(w1).includes(tw1.trigger.hookId), false)
eq('webhook: the paused copy has one too', typeof tw2.trigger.hookId, 'string')

/* ── the mark survives every ordinary edit ────────────────────────────────────────────────────────────────────────────────── */
const markOfId = (id) => JSON.stringify(storedOf(id).team)
const mark1 = markOfId(i1.taskId)
const pageForm = (t, o) => Object.assign({ name: t.name, prompt: t.prompt, active: t.active, approvals: t.approvals, notify: [], workspaceHint: null, runsOn: 'local', schedule: Object.assign({}, t.schedule) }, o)
const edit1 = await api({ action: 'update', id: i1.taskId, task: pageForm(t1, { active: true }) })
eq('mark: an edit as the page sends it (no needs) answers ok', edit1.ok, true)
eq('mark: ...and the mark is untouched', markOfId(i1.taskId), mark1)
eq('mark: ...the needs are kept too', JSON.stringify(storedOf(i1.taskId).needs), JSON.stringify(['gmail', 'slack']))
eq('mark: ...a copy that was only switched on is not edited', (await team('team-copies', {})).copies.find((c) => c.taskId === i1.taskId).edited, false)
await api({ action: 'update', id: i1.taskId, task: pageForm(t1, { active: false }) })
eq('mark: a toggle keeps it', (await api({ action: 'toggle', id: i1.taskId, active: true })).ok && markOfId(i1.taskId) === mark1, true)
await api({ action: 'toggle', id: i1.taskId, active: false })
await api({ action: 'bind-home', id: i1.taskId, sessionId: 'sess-home-1' })
await api({ action: 'hook-generate', id: i1.taskId })
await api({ action: 'hook-revoke', id: i1.taskId })
const linked = await api({ action: 'cloud-link', id: i1.taskId, cloud: { computerId: '3f2a1c10-0000-4000-8000-000000000001', name: 'Home' } })
const unlinked = await api({ action: 'cloud-link', id: i1.taskId, cloud: null })
eq('mark: binding a home, making and revoking a webhook, linking to a cloud computer and bringing it back keep it', linked.ok && unlinked.ok && markOfId(i1.taskId) === mark1, true)
// a page cannot write or move a mark through the task routes
const forgedMark = { workspaceId: 'forged', id: 1, key: 'forged', version: 'x', installedAt: 'x', base: {}, contentHash: 'x' }
const created = (await api({ action: 'create', task: { name: 'Forger', prompt: 'p', schedule: { mode: 'cron', cron: '0 8 * * *' }, team: forgedMark } })).task
eq('mark: a created automation cannot carry one', created.team, undefined)
await api({ action: 'update', id: i1.taskId, task: Object.assign(pageForm(t1, {}), { team: forgedMark }) })
eq('mark: an update cannot replace one', markOfId(i1.taskId), mark1)
// edits that change the four fields make the copy « edited »
await api({ action: 'update', id: i1.taskId, task: pageForm(t1, { name: 'Late invoice chaser' }) })
eq('mark: a rename keeps it and the copy now reads as edited', JSON.stringify([markOfId(i1.taskId) === mark1, (await team('team-copies', {})).copies.find((c) => c.taskId === i1.taskId).edited]), JSON.stringify([true, true]))
same('mark: the pack of an edited copy still goes under the team key', [(await team('team-pack', { id: i1.taskId })).proposal.key, (await team('team-pack', { id: i1.taskId })).team.edited], ['invoice-reminder', true])
await api({ action: 'update', id: i1.taskId, task: pageForm(t1, { name: d1.name }) })
eq('mark: putting the name back makes it unedited again', (await team('team-copies', {})).copies.find((c) => c.taskId === i1.taskId).edited, false)
// the export file and the duplicate never carry the mark
const clientSrc = readFileSync(join(root, 'packages/kybernos-plugin/client.js'), 'utf8')
const exportFn = (0, eval)('(' + /const kbExportTask = (\(t\) => \{[\s\S]*?\n\})/.exec(clientSrc)[1] + ')')
const cloneFn = (0, eval)('(' + /const kbCloneDefinition = (\(t, name\) => \(\{[\s\S]*?\n\}\))/.exec(clientSrc)[1] + ')')
const exported = JSON.stringify(exportFn(storedOf(i1.taskId)))
eq('export: the .automation.json holds no mark, no base, no hash, no version', /team|base|contentHash|version|installedAt|workspaceId/.test(exported), false)
eq('export: ...and still holds the definition', JSON.parse(exported).name, d1.name)
eq('duplicate: a copy of a copy is a plain automation', JSON.stringify(cloneFn(storedOf(i1.taskId), 'x')).includes('team'), false)

/* ── team-update ──────────────────────────────────────────────────────────────────────────────────────────────────────────── */
const v2 = def({ id: 8, key: 'invoice-reminder', name: 'Invoice reminder v2', prompt: 'Every Monday morning, draft a reminder and list the clients.', schedule: { mode: 'cron', cron: '30 8 * * 1' }, needs: ['gmail'] })
await api({ action: 'toggle', id: i1.taskId, active: true })
const live1 = storedOf(i1.taskId)
const replaced = await update(i1.taskId, v2, 'replace')
same('update replace: the contract\'s answer', replaced, { ok: true, taskId: i1.taskId })
const r1 = storedOf(i1.taskId)
same('update replace: name, prompt, needs and (unchanged by the person) schedule come from the team', [r1.name, r1.prompt, r1.needs, r1.schedule], ['Invoice reminder v2', v2.prompt, ['gmail'], { mode: 'cron', tz: live1.schedule.tz, cron: '30 8 * * 1' }])
same('update replace: active state, approvals, place and history stay', [r1.active, r1.approvals, r1.runsOn, r1.id, r1.createdAt, r1.history], [live1.active, live1.approvals, live1.runsOn, live1.id, live1.createdAt, live1.history])
eq('update replace: it is scheduled again for the new rhythm', typeof r1.nextRun === 'string' && Date.parse(r1.nextRun) > Date.now(), true)
same('update replace: the mark moved to the new version', [r1.team.id, r1.team.version, r1.team.key, r1.team.workspaceId, Object.keys(r1.team)], [8, v2.version, 'invoice-reminder', WS, MARK_KEYS])
same('update replace: ...with the new definition as base', r1.team.base, { name: v2.name, prompt: v2.prompt, schedule: { mode: 'cron', cron: '30 8 * * 1' }, needs: ['gmail'] })
eq('update replace: ...and the copy is the team\'s again', (await team('team-copies', {})).copies.find((c) => c.taskId === i1.taskId).edited, false)

// an unedited copy accepts replace only
const sealed = readFileSync(tasksFile, 'utf8')
same('update: keep on an unedited copy', await update(i1.taskId, v2, 'keep'), { ok: false, error: 'not_edited' })
same('update: both on an unedited copy', await update(i1.taskId, v2, 'both'), { ok: false, error: 'not_edited' })
same('update: another key', await update(i1.taskId, Object.assign(def({ id: 9, key: 'other-key' }), {}), 'replace'), { ok: false, error: 'key_mismatch' })
same('update: a mode that does not exist', await update(i1.taskId, v2, 'merge'), { ok: false, error: 'invalid_mode' })
same('update: no mode', await update(i1.taskId, v2, undefined), { ok: false, error: 'invalid_mode' })
same('update: an unknown task', await update('st-nope', v2, 'replace'), { ok: false, error: 'not_found' })
same('update: no task id', await team('team-update', { definition: v2, mode: 'replace' }), { ok: false, error: 'not_found' })
same('update: an automation that is not a team copy', await update(own.id, v2, 'replace'), { ok: false, error: 'not_a_team_copy' })
same('update: a definition that does not hash to its version', await update(i1.taskId, Object.assign({}, v2, { prompt: 'tampered' }), 'replace'), { ok: false, error: 'version_mismatch' })
same('update: a definition that breaks the rules', await update(i1.taskId, def({ id: 8, key: 'invoice-reminder', schedule: { mode: 'once', at: '2099-01-01T08:00' } }), 'replace'), { ok: false, error: 'invalid_automation', reason: 'schedule', field: 'schedule' })
same('update: an every-minute rhythm that would follow needs the person\'s yes', await update(i1.taskId, def({ id: 9, key: 'invoice-reminder', schedule: { mode: 'cron', cron: '* * * * *' } }), 'replace'), { ok: false, error: 'frequent schedule', everyMinutes: 1 })
eq('update: none of those refusals changed anything', readFileSync(tasksFile, 'utf8'), sealed)

// the person changed the schedule and the prompt: keep, both and replace
const d3 = def({ id: 60, key: 'daily-digest-2', name: 'Digest', prompt: 'Summarise the day.', schedule: { mode: 'cron', cron: '0 18 * * *' }, needs: [] })
const c3 = await install(d3, { turnOn: true })
const t3 = storedOf(c3.taskId)
await api({ action: 'update', id: c3.taskId, task: pageForm(t3, { prompt: 'My own summary of the day.', schedule: { mode: 'cron', cron: '0 21 * * *', tz: t3.schedule.tz } }) })
const mine3 = storedOf(c3.taskId)
const d3b = def({ id: 61, key: 'daily-digest-2', name: 'Digest v2', prompt: 'Summarise the day and the week.', schedule: { mode: 'cron', cron: '0 7 * * *' }, needs: ['notion'] })
eq('update: the person\'s edit shows', (await team('team-copies', {})).copies.find((c) => c.taskId === c3.taskId).edited, true)
const keptBytes = readFileSync(tasksFile, 'utf8')
same('update keep: ok, and nothing changes', [await update(c3.taskId, d3b, 'keep'), readFileSync(tasksFile, 'utf8') === keptBytes], [{ ok: true, taskId: c3.taskId }, true])
const both = await update(c3.taskId, d3b, 'both')
same('update both: the contract\'s answer', [both.ok, both.taskId, typeof both.newTaskId], [true, c3.taskId, 'string'])
const kept3 = storedOf(both.newTaskId)
same('update both: the person\'s version is saved first as « <name> (mine) », paused, with no mark', [kept3.name, kept3.prompt, kept3.schedule.cron, kept3.active, kept3.nextRun, kept3.team, kept3.runsOn], ['Digest (mine)', 'My own summary of the day.', '0 21 * * *', false, null, undefined, 'local'])
same('update both: ...with nothing of the original\'s runs', [kept3.history, kept3.lastRun, kept3.trigger], [[], null, undefined])
const re3 = storedOf(c3.taskId)
same('update both: then the copy is replaced: the team\'s name, prompt and needs', [re3.name, re3.prompt, re3.needs], ['Digest v2', 'Summarise the day and the week.', ['notion']])
same('update both: ...but the schedule the person moved stays theirs, and so does its next run', [re3.schedule.cron, re3.nextRun, re3.active], ['0 21 * * *', mine3.nextRun, true])
same('update both: ...the mark moved, with the team\'s schedule as base', [re3.team.version, re3.team.base.schedule], [d3b.version, { mode: 'cron', cron: '0 7 * * *' }])
eq('update both: ...the copy reads as edited (its rhythm is not the team\'s) and is offered keep and both again', (await team('team-copies', {})).copies.find((c) => c.taskId === c3.taskId).edited, true)
const again = await update(c3.taskId, def({ id: 62, key: 'daily-digest-2', name: 'Digest v3', prompt: 'Third.', schedule: { mode: 'cron', cron: '0 6 * * *' }, needs: [] }), 'replace')
same('update replace on an edited copy: the person\'s schedule is still not taken', [again.ok, storedOf(c3.taskId).schedule.cron, storedOf(c3.taskId).name], [true, '0 21 * * *', 'Digest v3'])
eq('update both/replace: the number of automations grew by one only', stored().filter((t) => t.name === 'Digest (mine)').length, 1)

// a webhook copy that was edited: both gives the saved copy its own address
const hk = await install(def({ id: 70, key: 'hook-two', name: 'Hook two', description: 'd', prompt: 'Handle it.', schedule: { mode: 'webhook' }, needs: [] }))
const hkTask = storedOf(hk.taskId)
await api({ action: 'update', id: hk.taskId, task: pageForm(hkTask, { prompt: 'Handle it my way.', schedule: { mode: 'webhook', tz: hkTask.schedule.tz } }) })
const hkBoth = await update(hk.taskId, def({ id: 71, key: 'hook-two', name: 'Hook two', description: 'd', prompt: 'Handle it better.', schedule: { mode: 'webhook' }, needs: [] }), 'both')
const hkMine = storedOf(hkBoth.newTaskId); const hkOrig = storedOf(hk.taskId)
eq('update both (webhook): the saved copy has its own address and secret', hkMine.trigger.hookId !== hkTask.trigger.hookId && hkMine.trigger.secret !== hkTask.trigger.secret && /^hk_[0-9a-f]{12}$/.test(hkMine.trigger.hookId), true)
eq('update both (webhook): the copy keeps its address', JSON.stringify(hkOrig.trigger), JSON.stringify(hkTask.trigger))
eq('update both (webhook): the saved copy is paused', hkMine.active, false)

// the rhythm follows into a webhook, and a frequent one with the person's yes
const cw = await install(def({ id: 80, key: 'to-hook', name: 'To hook', prompt: 'Run.', schedule: { mode: 'cron', cron: '0 8 * * *' }, needs: [] }), { turnOn: true })
const toHook = await update(cw.taskId, def({ id: 81, key: 'to-hook', name: 'To hook', prompt: 'Run.', schedule: { mode: 'webhook' }, needs: [] }), 'replace')
const hookCopy = storedOf(cw.taskId)
same('update replace: a rhythm that became a webhook gets its address and no next run', [toHook.ok, hookCopy.schedule.mode, hookCopy.nextRun, /^hk_[0-9a-f]{12}$/.test(hookCopy.trigger.hookId), hookCopy.active], [true, 'webhook', null, true, true])
const freq = await update(cw.taskId, def({ id: 82, key: 'to-hook', name: 'To hook', prompt: 'Run.', schedule: { mode: 'cron', cron: '*/2 * * * *' }, needs: [] }), 'replace', { confirmFrequent: true })
same('update replace: an every-two-minutes rhythm with the person\'s yes', [freq.ok, storedOf(cw.taskId).schedule.cron, typeof storedOf(cw.taskId).nextRun], [true, '*/2 * * * *', 'string'])

// a copy that lives on a cloud computer stays paused
const cc = await install(def({ id: 90, key: 'cloud-one', name: 'Cloud one', prompt: 'Run.', needs: [] }), { turnOn: true })
await api({ action: 'cloud-link', id: cc.taskId, cloud: { computerId: '3f2a1c10-0000-4000-8000-000000000002', name: 'Pros' } })
const ccUp = await update(cc.taskId, def({ id: 91, key: 'cloud-one', name: 'Cloud one v2', prompt: 'Run better.', schedule: { mode: 'cron', cron: '0 7 * * 1' }, needs: [] }), 'replace')
same('update replace: a copy published to a cloud computer stays paused and linked', [ccUp.ok, storedOf(cc.taskId).active, storedOf(cc.taskId).nextRun, typeof storedOf(cc.taskId).cloud, storedOf(cc.taskId).name], [true, false, null, 'object', 'Cloud one v2'])

/* ── an unreadable store is an answer, not a crash ─────────────────────────────────────────────────────────────────────────── */
const good = readFileSync(tasksFile, 'utf8')
writeFileSync(tasksFile, '{ not a list', { mode: 0o600 })
for (const kind of KINDS) same(kind + ': a tasks.json that cannot be trusted is a plain answer', await team(kind, BODIES[kind]), { ok: false, error: 'store_unreadable' })
same('...an install never overwrites it', [(await install(def({ id: 99, key: 'x-after-corrupt', needs: [] }))).error, readFileSync(tasksFile, 'utf8')], ['store_unreadable', '{ not a list'])
writeFileSync(tasksFile, good, { mode: 0o600 })
eq('...and it works again once the file is back', (await team('team-copies', {})).ok, true)

console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILURES')
process.exit(fails === 0 ? 0 : 1)
