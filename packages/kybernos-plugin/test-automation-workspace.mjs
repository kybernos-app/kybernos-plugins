// Where the runs of an automation land. This proves the rule (automation-workspace.mjs, pure), then the host that applies it: a run
// goes to the workspace the automation names, else to ONE dedicated « Automations » workspace the host makes under the DSH home, and the
// route keeps, sets and clears the choice. Driven through the real apply() on a fake context with a fake workspace registry and a
// throw-away DSH home. Then the page: the pure block, the field of the form, the line of the detail.
//   node packages/kybernos-plugin/test-automation-workspace.mjs   (exit 0 = everything passes)
import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DEDICATED_DIR, DEDICATED_TITLE, cleanHint, idOf, chooseWorkspace } from './automation-workspace.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))

// ── the rule ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
assert.deepEqual([DEDICATED_TITLE, DEDICATED_DIR], ['Automations', 'automations'])
assert.deepEqual([null, '', 'ws-1', 'a.b:c@d_e-f'].map(cleanHint), [null, null, 'ws-1', 'a.b:c@d_e-f'])
assert.deepEqual([undefined, 7, {}, [], 'has space', '../x', 'a/b', 'x'.repeat(161), true].map(cleanHint), [undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined])
ok('a workspace is nothing, null, an empty string, or a plain id: anything else is invalid')
assert.deepEqual([{ id: 'a' }, { workspaceId: 'b' }, { id: '', workspaceId: 'c' }, {}, null, 'x', { id: 7 }].map(idOf), ['a', 'b', 'c', null, null, null, null])
ok('the id of a workspace is read from the host\'s spelling and the page\'s')
const list = [{ id: 'ws1' }, { id: 'ws2' }]
assert.deepEqual(chooseWorkspace('ws2', list), { id: 'ws2', why: 'chosen' })
assert.deepEqual(chooseWorkspace(null, list), { id: null, why: 'none' })
assert.deepEqual(chooseWorkspace('', list), { id: null, why: 'none' })
assert.deepEqual(chooseWorkspace(undefined, list), { id: null, why: 'none' })
assert.deepEqual(chooseWorkspace('gone', list), { id: null, why: 'missing' })
assert.deepEqual(chooseWorkspace('../x', list), { id: null, why: 'none' }, 'an invalid id is no choice, never a guess')
assert.deepEqual(chooseWorkspace('ws1', null), { id: null, why: 'missing' })
assert.deepEqual(chooseWorkspace('ws1', [{ workspaceId: 'ws1' }]), { id: 'ws1', why: 'chosen' })
ok('a run goes to the workspace it names when it exists; none, or a deleted one, means the dedicated workspace')

// ── the host, through the real apply() ───────────────────────────────────────────────────────────────────────────────────────
const scratch = mkdtempSync(join(tmpdir(), 'kb-ws-'))
const copy = join(scratch, 'plugin')
mkdirSync(copy, { recursive: true })
for (const file of readdirSync(here)) {
  if (file === 'client.js' || file.startsWith('test-') || statSync(join(here, file)).isFile() === false) continue
  copyFileSync(join(here, file), join(copy, file))
}
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, DSH_HOME: process.env.DSH_HOME }
process.env.HOME = join(scratch, 'home')
process.env.USERPROFILE = process.env.HOME
const dsh = join(scratch, 'dsh')
process.env.DSH_HOME = dsh
mkdirSync(join(dsh, 'kybernos'), { recursive: true })
const disposers = []
const realSetTimeout = globalThis.setTimeout
globalThis.setTimeout = (fn, ms, ...a) => realSetTimeout(fn, ms === 750 ? 1 : ms, ...a)
try {
  const mod = await import(pathToFileURL(join(copy, 'index.js')).href)
  const registered = {}
  const webServer = { register: (r) => { registered[r.path] = r.handler; return () => { delete registered[r.path] } } }
  const book = { created: [], sessions: [], failCreate: false, noCreate: false }
  const workspaceRegistry = {
    list: () => [{ id: 'ws-first' }, { id: 'ws-mine' }].concat(book.created.length > 0 ? [{ id: 'ws-dedicated' }] : []),
  }
  Object.defineProperty(workspaceRegistry, 'create', { enumerable: true, get: () => (book.noCreate === true ? undefined : async (path, title) => {
    if (book.failCreate === true) throw new Error('refused')
    book.created.push({ path, title })
    return { id: 'ws-dedicated' }
  }) })
  const sessionController = {
    create: async (a) => { book.sessions.push(a); return { ok: true, value: { sessionId: 'sess-' + book.sessions.length } } },
    prompt: async () => ({ ok: true }),
    selectModel: async () => ({ ok: true }),
  }
  const services = { fs: {}, webServer, workspaceRegistry, sessionController }
  mod.apply({ get: (n) => services[n], inject: () => {}, effect: (fn) => { const d = fn(); if (typeof d === 'function') disposers.push(d); return d }, on: () => {} })
  const PORT = 3080
  const api = async (body) => {
    const handler = registered['/kybernos/tasks']
    assert.ok(handler !== undefined, 'the route is registered')
    const res = { code: 0, raw: null, writeHead (c) { this.code = c }, end (p) { this.raw = p === undefined ? null : String(p) } }
    const payload = JSON.stringify(body)
    await handler({ method: 'POST', url: '/kybernos/tasks', headers: { origin: 'http://127.0.0.1:' + PORT, host: '127.0.0.1:' + PORT, 'content-type': 'application/json' }, socket: { localPort: PORT }, async *[Symbol.asyncIterator] () { yield Buffer.from(payload) } }, res)
    let json = null
    try { json = JSON.parse(res.raw) } catch (e) { json = null }
    return { code: res.code, json }
  }
  const base = { name: 'Weekly report', prompt: 'Write the report', schedule: { mode: 'webhook', tz: 'UTC' }, active: false, approvals: 'auto' }
  const make = async (extra) => (await api({ action: 'create', task: Object.assign({}, base, extra || {}) })).json.task
  const run = async (t) => { const r = await api({ action: 'run-now', id: t.id }); assert.equal(r.json.ok, true, JSON.stringify(r.json)); return book.sessions[book.sessions.length - 1] }

  // no choice → the dedicated workspace, made under the DSH home, once
  const t1 = await make()
  assert.equal(Object.prototype.hasOwnProperty.call(t1, 'workspaceHint'), false, 'an automation with no choice stores none')
  const s1 = await run(t1)
  assert.deepEqual(s1, { workspaceId: 'ws-dedicated' })
  assert.deepEqual(book.created.map((c) => [c.path, c.title]), [[join(dsh, 'kybernos', 'automations'), 'Automations']])
  assert.ok(existsSync(join(dsh, 'kybernos', 'automations')) && statSync(join(dsh, 'kybernos', 'automations')).isDirectory(), 'the folder exists before the workspace adopts it')
  ok('with no choice a run lands in the dedicated « Automations » workspace, which adopts a folder under the DSH home')
  const s1b = await run(t1)
  assert.deepEqual(s1b, { workspaceId: 'ws-dedicated' })
  ok('...and the next run lands there too (the registry returns the workspace it already has for that folder)')

  // a workspace that exists → exactly that one, nothing is made
  book.created.length = 0
  const t2 = await make({ workspaceHint: 'ws-mine' })
  assert.equal(t2.workspaceHint, 'ws-mine')
  assert.deepEqual(await run(t2), { workspaceId: 'ws-mine' })
  assert.equal(book.created.length, 0, 'a chosen workspace asks the registry for nothing')
  ok('an automation that names a workspace runs in it, and no dedicated workspace is made for it')

  // a workspace that is gone → the dedicated one, never the first of the list
  const t3 = await make({ workspaceHint: 'ws-deleted' })
  assert.deepEqual(await run(t3), { workspaceId: 'ws-dedicated' })
  ok('a workspace that was deleted sends the run to the dedicated one, not to whichever is first')

  // the engine cannot make a workspace → what it always did
  book.noCreate = true
  assert.deepEqual(await run(await make()), { workspaceId: 'ws-first' })
  book.noCreate = false
  book.failCreate = true
  assert.deepEqual(await run(await make()), { workspaceId: 'ws-first' })
  book.failCreate = false
  ok('when the dedicated workspace cannot be made (an older registry, a refusal) the first workspace is used, as before: a run is never lost')

  // the route keeps, sets, clears and refuses
  const set = (await api({ action: 'update', id: t1.id, task: Object.assign({}, base, { workspaceHint: 'ws-mine' }) })).json
  assert.equal(set.task.workspaceHint, 'ws-mine')
  const kept = (await api({ action: 'update', id: t1.id, task: Object.assign({}, base, { name: 'Renamed' }) })).json
  assert.deepEqual([kept.task.name, kept.task.workspaceHint], ['Renamed', 'ws-mine'])
  const cleared = (await api({ action: 'update', id: t1.id, task: Object.assign({}, base, { workspaceHint: null }) })).json
  assert.equal(cleared.task.workspaceHint, null)
  assert.deepEqual(await run(cleared.task), { workspaceId: 'ws-dedicated' })
  const empty = (await api({ action: 'update', id: t2.id, task: Object.assign({}, base, { workspaceHint: '' }) })).json
  assert.equal(empty.task.workspaceHint, null)
  ok('an edit keeps the workspace when the page does not send one, sets it, and clears it with null or an empty string')
  for (const bad of ['has space', '../x', 7, {}, ['a']]) {
    const r = (await api({ action: 'update', id: t1.id, task: Object.assign({}, base, { workspaceHint: bad }) })).json
    assert.deepEqual([r.ok, r.error], [false, 'invalid workspace'], JSON.stringify(bad))
  }
  assert.equal((await api({ action: 'create', task: Object.assign({}, base, { workspaceHint: '../x' }) })).json.error, 'invalid workspace')
  ok('an invalid workspace is refused whole, on create and on update')
  const onDisk = JSON.parse(readFileSync(join(dsh, 'kybernos', 'tasks.json'), 'utf8'))
  assert.equal(onDisk.find((x) => x.id === t1.id).workspaceHint, null)
  ok('what is stored is the id and nothing else of the workspace (no path, no name)')
} finally {
  globalThis.setTimeout = realSetTimeout
  for (const d of disposers) { try { d() } catch (e) { /* best effort */ } }
  for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  rmSync(scratch, { recursive: true, force: true })
}

// ── the page ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const src = readFileSync(join(here, 'client.js'), 'utf8')
const parts = src.split('// KB-AUTOWS-BEGIN')
assert.equal(parts.length, 2, 'exactly one KB-AUTOWS block')
const block = parts[1].split('// KB-AUTOWS-END')[0]
const m = await import('data:text/javascript,' + encodeURIComponent(block + '\nexport { kbWsName, kbWsChoice, kbWsOptions }'))
const items = [{ workspaceId: 'w2', title: 'zeta' }, { workspaceId: 'w1', title: 'Alpha', displayTitle: 'My alpha' }, { workspaceId: 'w3', title: '  ' }, null, { title: 'no id' }]
assert.deepEqual([m.kbWsName(items[1]), m.kbWsName(items[0]), m.kbWsName(items[2]), m.kbWsName(null)], ['My alpha', 'zeta', 'w3', ''])
assert.deepEqual([m.kbWsChoice(null, items), m.kbWsChoice('', items), m.kbWsChoice(undefined, items)], [{ kind: 'dedicated' }, { kind: 'dedicated' }, { kind: 'dedicated' }])
assert.deepEqual(m.kbWsChoice('w1', items), { kind: 'ws', id: 'w1', name: 'My alpha' })
assert.deepEqual(m.kbWsChoice('w9', items), { kind: 'gone', id: 'w9' })
assert.deepEqual(m.kbWsChoice('w1', null), { kind: 'gone', id: 'w1' })
ok('the page names the dedicated workspace, a chosen one, or one that is gone')
assert.deepEqual(m.kbWsOptions(items, null).map((o) => [o.id, o.kind, o.name]), [['', 'dedicated', undefined], ['w1', 'ws', 'My alpha'], ['w3', 'ws', 'w3'], ['w2', 'ws', 'zeta']])
assert.deepEqual(m.kbWsOptions(items, 'w9').map((o) => o.kind), ['dedicated', 'ws', 'ws', 'ws', 'gone'])
assert.deepEqual(m.kbWsOptions(items, 'w1').map((o) => o.kind), ['dedicated', 'ws', 'ws', 'ws'])
assert.deepEqual(m.kbWsOptions(null, null), [{ id: '', kind: 'dedicated' }])
ok('the form offers the dedicated workspace first, then the person\'s by name, and the deleted one only while the automation still names it')
assert.ok(src.includes("'data-kb': 'task-workspace'") && src.includes('workspaceHint: wsHint === \'\' ? null : wsHint'), 'the form sends the choice, null for none')
assert.ok(src.includes("kbWsOptions(kbPinsSnapshots().items, wsHint)"), 'the options come from the workspaces the page already watches')
assert.ok(src.includes("kbWsChoice(t.workspaceHint, kbPinsSnapshots().items)"), 'the detail says where the runs land')
assert.ok(src.includes("'invalid workspace': 'tasks.err.workspace'"), 'the refusal is said in the page\'s language')
assert.ok(/workspaceHint: typeof t\.workspaceHint === 'string' && t\.workspaceHint\.length > 0 \? t\.workspaceHint : null/.test(src), 'a copy keeps the workspace')
const exportFn = /const kbExportTask = \(t\) => \{[\s\S]*?\n\}/.exec(src)[0]
assert.equal(exportFn.indexOf('workspace'), -1, 'an exported file never carries a workspace id: it means nothing on another machine')
ok('the form, the detail line, the copy and the export are wired the right way')
const host = readFileSync(join(here, 'index.js'), 'utf8')
assert.ok(/kbTaskWorkspaceId = async \(task\) => \{[\s\S]{0,600}autoWsChoose\(task\.workspaceHint, list\)/.test(host), 'the host chooses with the shared rule')
assert.ok(host.includes('return autoWsIdOf(list[0])'), 'the first workspace stays the last resort')
ok('the host chooses with the shared rule and keeps the first workspace as the last resort')
console.log('\n' + pass + ' verifications OK')
process.exit(0)
