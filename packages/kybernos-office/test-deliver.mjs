// The `deliver_files` tool: what it refuses, the record it writes (once, after the call, for a successful call only), what its description tells the model, and that
// `apply` registers it on a fake DSH context without ever throwing when a service is missing.
//
//   node packages/kybernos-office/test-deliver.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const base = mkdtempSync(join(tmpdir(), 'kb-office-deliver-'))
process.env.DSH_HOME = join(base, 'dsh')
process.env.HOME = base
const { TOOL, MAX_FILES, DESCRIPTION, deliverTool, writeCard } = await import('./deliver.mjs')
const { apply, mountDeliver } = await import('./index.js')

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

const cwd = join(base, 'work')
mkdirSync(join(cwd, 'sub'), { recursive: true })
writeFileSync(join(cwd, 'sub', 'note.docx'), 'x')
writeFileSync(join(cwd, 'plan.md'), '# plan\n')

// ── fake DSH services, with the shapes of the engine's `fs`, `agents` and `workingDirectory` ─────────────────────────────
const fs = {
  lstat: async (p, o) => { const f = join(o.cwd, p); return f.endsWith('sub') ? { type: 'directory' } : (f.endsWith('note.docx') || f.endsWith('plan.md') ? { type: 'file' } : undefined) },
  resolve: async (p, o) => join(o.cwd, p),
  stat: async (p) => (p.endsWith('note.docx') || p.endsWith('plan.md') ? { type: 'file' } : (p.endsWith('sub') ? { type: 'directory' } : undefined)),
  processPath: (p) => p
}
const appended = []
const session = { append: (type, data) => appended.push({ type, data }) }
const agent = { session }
let boundary = { openTurnStartSeq: 4, lastTurn: 2 }
const services = () => ({ fs, agents: { turnBoundaryOf: () => boundary }, workingDirectory: { ensure: async () => cwd } })
const exec = (extra) => Object.freeze({ callId: 'call_1', agent, signal: new AbortController().signal, ...extra })

console.log('Kybernos office: the deliver_files tool')

// ── the tool ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const t = deliverTool(services)
  assert.equal(t.options.name, TOOL)
  assert.equal(TOOL, 'deliver_files')
  const e = exec()
  const out = await t.options.execute({ files: [{ path: 'sub/note.docx', description: ' Note ' }, { path: 'plan.md' }] }, e)
  assert.deepEqual(out, { turn: 2, files: [{ path: join(cwd, 'sub/note.docx'), description: 'Note' }, { path: join(cwd, 'plan.md') }] })
  assert.equal(appended.length, 0, 'nothing is written before the call has a result')
  ok('the call answers with absolute paths and the turn, and writes nothing yet')

  assert.equal(writeCard(t.pending, e, { isError: false }), true)
  assert.equal(appended.length, 1)
  assert.deepEqual(appended[0], { type: 'deliverables/presented', data: { turn: 2, callId: 'call_1', files: out.files } })
  assert.equal(writeCard(t.pending, e, { isError: false }), false, 'a second result for the same call writes nothing')
  assert.equal(appended.length, 1)
  ok('the card record is written once, after the result, exactly in the shape DSH draws cards from')

  const failed = exec({ callId: 'call_2' })
  await t.options.execute({ files: [{ path: 'plan.md' }] }, failed)
  assert.equal(writeCard(t.pending, failed, { isError: true }), false)
  assert.equal(appended.length, 1)
  assert.equal(writeCard(t.pending, exec({ callId: 'never_called' }), { isError: false }), false)
  ok('no card for a failed call, nor for a call this tool did not make')

  const refuse = async (args, text, e2 = exec({ callId: 'c' + Math.random() })) => assert.rejects(() => t.options.execute(args, e2), (err) => text.test(err.message))
  await refuse({ files: [] }, /1 to 8/)
  await refuse({ files: Array.from({ length: MAX_FILES + 1 }, () => ({ path: 'plan.md' })) }, /1 to 8/)
  await refuse({}, /1 to 8/)
  await refuse({ files: [{ path: '  ' }] }, /needs a path/)
  await refuse({ files: [{ path: 'missing.pdf' }] }, /file not found/)
  await refuse({ files: [{ path: 'sub' }] }, /not a regular file/)
  await refuse({ files: [{ path: 'plan.md' }] }, /chat session/, { callId: 'x' })
  boundary = { openTurnStartSeq: null, lastTurn: 2 }
  await refuse({ files: [{ path: 'plan.md' }] }, /open turn/)
  boundary = { openTurnStartSeq: 4, lastTurn: 2 }
  const lazy = deliverTool(() => null)
  await assert.rejects(() => lazy.options.execute({ files: [{ path: 'plan.md' }] }, exec()), /not ready/)
  ok('it refuses no files, too many, an empty path, a missing file, a folder, a call outside a chat or a turn, and DSH not ready')
  assert.equal(appended.length, 1, 'a refused call leaves no card')

  assert.match(t.options.render({}, { files: [{ path: '/a/b.docx' }] })[0].text, /Delivered \/a\/b\.docx/)
  ok('the tool row says what was delivered')
}

// ── what the model is told ───────────────────────────────────────────────────────────────────────────────────────────────
{
  assert.match(DESCRIPTION, /cards in the chat/)
  assert.match(DESCRIPTION, /right-hand panel/)
  assert.match(DESCRIPTION, /\.docx/)
  assert.match(DESCRIPTION, /ONCE, at the end of the turn/)
  assert.match(DESCRIPTION, /NEW files for each request/)
  assert.match(DESCRIPTION, /earlier chats left/)
  assert.ok(DESCRIPTION.length < 900, 'a tool description is read on every turn: keep it short')
  ok('the description asks for cards at the end, for new files each time, and not for files earlier chats left')
}

// ── apply on a fake DSH context ──────────────────────────────────────────────────────────────────────────────────────────
{
  const registered = []
  const listeners = []
  const have = { tools: { register: (t) => registered.push(t) }, fs, agents: { turnBoundaryOf: () => boundary }, workingDirectory: { ensure: async () => cwd } }
  const ctx = { get: (n) => have[n], on: (name, fn) => listeners.push([name, fn]), inject: () => { throw new Error('inject must not be needed when every service is there') }, effect: () => undefined }
  mountDeliver(ctx)
  const until = async (cond) => { for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 10)) }
  await until(() => registered.length > 0)
  assert.equal(registered.length, 1)
  assert.equal(registered[0].name, 'deliver_files')
  assert.equal(typeof registered[0].execute, 'function')
  assert.equal(listeners.length, 1)
  assert.equal(listeners[0][0], 'tools/result')
  ok('mountDeliver registers the tool and one tools/result observer when every service is there')

  // the observer writes the card for a call the registered tool answered
  appended.length = 0
  const e = exec({ callId: 'call_9' })
  await registered[0].execute({ files: [{ path: 'plan.md' }] }, e)
  listeners[0][1](e, { isError: false })
  assert.equal(appended.length, 1)
  assert.equal(appended[0].data.callId, 'call_9')
  ok('a call through the registered tool ends in a card record')

  // a service is missing: it waits for DSH (inject) and registers nothing now
  const waiting = []
  const ctx2 = { get: (n) => (n === 'tools' ? have.tools : undefined), on: () => assert.fail('no observer before the services'), inject: (names, cb) => waiting.push([names, cb]), effect: () => undefined }
  mountDeliver(ctx2)
  assert.equal(waiting.length, 1)
  assert.deepEqual(waiting[0][0], ['tools', 'fs', 'agents', 'workingDirectory'])
  ok('with a service missing it waits for DSH and registers nothing')

  // the injected callback cannot throw into DSH, even with nothing there
  const lines = []
  const log = console.log
  console.log = (...a) => lines.push(a.join(' '))
  try { waiting[0][1]({ get: () => undefined }) } finally { console.log = log }
  assert.ok(lines.some((l) => /not registered/.test(l)))
  ok('a missing service is logged, never thrown')

  // apply itself: a context that throws on get must not stop DSH
  const quiet = []
  console.log = (...a) => quiet.push(a.join(' '))
  try { apply({ get: () => { throw new Error('boom') }, effect: () => undefined, inject: () => undefined }) } finally { console.log = log }
  assert.ok(quiet.some((l) => /disabled/.test(l)))
  ok('apply never throws, whatever the context does')
}

console.log(`\nAll ${pass} checks passed.`)
