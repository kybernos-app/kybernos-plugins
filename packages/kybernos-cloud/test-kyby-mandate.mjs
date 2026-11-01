// Kaby's mandate (kyby-mandate.mjs, kyby-mandate-store.mjs): what is signed, what it lets through, what voids it, what the host writes down. No network, a temporary home.
//   node packages/kybernos-cloud/test-kyby-mandate.mjs
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MANDATE_HEAD, PRESETS, TOOL_CLASS, countUse, decide, describe, dayKey, emptyUsage, inForce, mandateText, presetOf, readRequest, sign, usageOf, verify } from './kyby-mandate.mjs'
import { createMandateStore } from './kyby-mandate-store.mjs'

let fail = 0
const ok = (name, cond, detail) => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  ' + JSON.stringify(detail))); if (!cond) fail++ }

const SECRET = Buffer.alloc(32, 7)
const OTHER = Buffer.alloc(32, 9)
const T0 = Date.UTC(2026, 10, 1, 12, 0, 0)
const DAY = 24 * 3600 * 1000
const signed = (fields, secret = SECRET, at = T0) => sign({ ...PRESETS.off, paused: false, ...fields }, secret, at).record

// ── what is covered: our tools of two classes, never an app or a restart ──────────────────────────────
ok('the tools of two classes are covered', TOOL_CLASS.memory_write === 'memory' && TOOL_CLASS.lesson_write === 'memory' && ['computer_exec', 'computer_write', 'computer_start', 'computer_stop', 'computer_pause', 'computer_resume', 'computer_task'].every((t) => TOOL_CLASS[t] === 'computer'))
ok('a connected app and a restart of DSH are in no class', TOOL_CLASS.connections_execute === undefined && TOOL_CLASS.relancer_dsh === undefined && Object.keys(TOOL_CLASS).length === 9)
ok('the engine\'s own tools are in no class either', ['bash', 'write', 'edit', 'read'].every((t) => TOOL_CLASS[t] === undefined && decide(signed(PRESETS.intensive), SECRET, null, t, T0).allow === false))

// ── the request, checked ─────────────────────────────────────────────────────────────────────────────
ok('a preset fills the fields', readRequest({ preset: 'standard' }, null).fields.computer === true && readRequest({ preset: 'prudent' }, null).fields.computer === false)
ok('an unknown preset, a non-boolean switch and a bad limit are refused', readRequest({ preset: 'x' }, null).ok === false && readRequest({ memory: 'yes' }, null).error === 'invalid_memory' && readRequest({ memoryPerDay: 0 }, null).error === 'invalid_memoryPerDay' && readRequest({ computerPerDay: 501 }, null).error === 'invalid_computerPerDay' && readRequest({ computerPerDay: 1.5 }, null).ok === false && readRequest('x', null).ok === false && readRequest([], null).ok === false)
ok('a request over the current record changes only what it names', (() => { const r = readRequest({ computerPerDay: 5 }, signed(PRESETS.standard)); return r.ok && r.fields.memory === true && r.fields.computer === true && r.fields.computerPerDay === 5 && r.fields.memoryPerDay === 40 })())
ok('numbers that match no preset are « custom »', presetOf(PRESETS.standard) === 'standard' && presetOf({ ...PRESETS.standard, computerPerDay: 41 }) === 'custom')
ok('a prototype key is no preset', readRequest({ preset: '__proto__' }, null).ok === false && readRequest({ preset: 'constructor' }, null).ok === false)

// ── the signature ────────────────────────────────────────────────────────────────────────────────────
ok('nothing can be signed without the machine secret', sign(PRESETS.standard, null, T0).error === 'cannot_sign' && sign(PRESETS.standard, Buffer.alloc(0), T0).ok === false)
ok('a signed record verifies, with its own secret only', verify(signed(PRESETS.standard), SECRET).ok === true && verify(signed(PRESETS.standard), OTHER).why === 'altered' && verify(signed(PRESETS.standard), null).why === 'no_secret')
ok('one changed field voids it (the file edited by hand)', (() => { const r = signed(PRESETS.prudent); return verify({ ...r, computer: true }, SECRET).why === 'altered' && verify({ ...r, computerPerDay: 500 }, SECRET).why === 'altered' && verify({ ...r, paused: !r.paused }, SECRET).why === 'altered' && verify({ ...r, signedAt: '2030-01-01T00:00:00.000Z' }, SECRET).why === 'altered' })())
ok('a record that is not ours is unreadable, never trusted', ['none', null, undefined, 'x', 3, [], {}, { v: 2 }, { ...signed(PRESETS.standard), v: 0 }, { ...signed(PRESETS.standard), memory: 'true' }, { ...signed(PRESETS.standard), sig: 5 }, { ...signed(PRESETS.standard), memoryPerDay: 0 }].every((r) => verify(r, SECRET).ok === false))
ok('a signature that is not hex or too short is refused without throwing', verify({ ...signed(PRESETS.standard), sig: 'zz' }, SECRET).ok === false && verify({ ...signed(PRESETS.standard), sig: 'ab'.repeat(8) }, SECRET).ok === false)

// ── in force or not ──────────────────────────────────────────────────────────────────────────────────
ok('in force: signed, not paused, one class on', inForce(signed(PRESETS.prudent), SECRET).ok === true)
ok('not in force: nothing on, paused, void', inForce(signed(PRESETS.off), SECRET).why === 'nothing_on' && inForce(signed({ ...PRESETS.standard, paused: true }), SECRET).why === 'paused' && inForce({ ...signed(PRESETS.standard), computer: false }, SECRET).why === 'altered' && inForce(null, SECRET).why === 'none')

// ── the decision ─────────────────────────────────────────────────────────────────────────────────────
const standard = signed(PRESETS.standard)
ok('a covered tool of an enabled class passes', decide(standard, SECRET, null, 'memory_write', T0).allow === true && decide(standard, SECRET, null, 'computer_start', T0).allow === true)
ok('a class that is off asks', decide(signed(PRESETS.prudent), SECRET, null, 'computer_exec', T0).why === 'class_off' && decide(signed(PRESETS.prudent), SECRET, null, 'memory_write', T0).allow === true)
ok('an app, a restart, an unknown or a prototype name never pass', ['connections_execute', 'relancer_dsh', 'nope', '', undefined, null, '__proto__', 'constructor', 'toString'].every((t) => decide(signed(PRESETS.intensive), SECRET, null, t, T0).allow === false))
ok('paused, void or unsigned asks', decide(signed({ ...PRESETS.standard, paused: true }), SECRET, null, 'memory_write', T0).why === 'paused' && decide(standard, OTHER, null, 'memory_write', T0).allow === false && decide(null, SECRET, null, 'memory_write', T0).allow === false)
{
  const small = signed({ ...PRESETS.standard, memoryPerDay: 2, computerPerDay: 1 })
  let u = null
  const run = (tool) => { const v = decide(small, SECRET, u, tool, T0); if (v.allow) u = countUse(u, v.klass, T0); return v }
  const steps = [run('memory_write'), run('lesson_write'), run('memory_write'), run('computer_exec'), run('computer_stop')]
  ok('a daily limit is counted per class and then asks', steps.map((s) => s.allow).join() === 'true,true,false,true,false' && steps[2].why === 'limit_reached' && u.memory === 2 && u.computer === 1, steps)
  ok('the next day starts again at zero', decide(small, SECRET, u, 'memory_write', T0 + DAY).allow === true && usageOf(u, T0 + DAY).memory === 0 && dayKey(T0 + DAY) !== dayKey(T0))
}
ok('a corrupt count is read as zero', usageOf({ day: dayKey(T0), memory: -3, computer: 'x' }, T0).memory === 0 && usageOf('x', T0).computer === 0 && countUse({ day: 'old', memory: 9, computer: 9 }, 'memory', T0).memory === 1 && countUse(null, 'nope', T0).memory === 0)

// ── the block written into the prompt ────────────────────────────────────────────────────────────────
{
  const text = mandateText(standard, SECRET)
  ok('the block names what is allowed, with the numbers of the record', text.startsWith(MANDATE_HEAD + '\n') && text.endsWith('\n[/MANDATE]') && /write your memory and your lessons \(up to 40 a day\)/.test(text) && /use your cloud computer \(up to 40 actions a day\)/.test(text) && /signed this standing permission on 2026-11-01/.test(text), text)
  ok('it says that the rest asks, and that a refusal is not retried', /Everything else, and anything over a limit, goes to the person for an answer first/.test(text) && /never retry or work around it/.test(text))
  ok('a class that is off is not named', !/cloud computer/.test(mandateText(signed(PRESETS.prudent), SECRET)) && /memory/.test(mandateText(signed(PRESETS.prudent), SECRET)))
  ok('no block when nothing is in force', mandateText(signed(PRESETS.off), SECRET) === '' && mandateText(signed({ ...PRESETS.standard, paused: true }), SECRET) === '' && mandateText({ ...standard, computer: false }, SECRET) === '' && mandateText(null, SECRET) === '' && mandateText(standard, OTHER) === '')
  ok('the block is the same from one step to the next (no use count in it), under 600 characters', mandateText(standard, SECRET) === text && text.length < 600, text.length)
  ok('the block is made of the record\'s numbers and fixed words only', !/[<>{}$`]/.test(text) && text.split('\n').length === 3)
}

// ── what the page shows ──────────────────────────────────────────────────────────────────────────────
{
  const v = describe(standard, SECRET, { day: dayKey(T0), memory: 3, computer: 1 }, T0)
  ok('the view says whether it is in force, the numbers and today\'s use, never the signature', v.inForce === true && v.preset === 'standard' && v.memoryPerDay === 40 && v.usedToday.memory === 3 && v.usedToday.computer === 1 && v.canSign === true && v.signedAt === '2026-11-01T12:00:00.000Z' && !JSON.stringify(v).includes(standard.sig))
  const bad = describe({ ...standard, computer: false }, SECRET, null, T0)
  ok('an altered record is shown as off, with the reason', bad.inForce === false && bad.why === 'altered' && bad.preset === 'off' && bad.memory === false && bad.signedAt === null)
  ok('without the machine secret nothing can be signed, and the page says so', describe(null, null, null, T0).canSign === false && describe(null, null, null, T0).why === 'none')
}

// ── the store: files, audit, no way to a permissive default ─────────────────────────────────────────
{
  const home = mkdtempSync(join(tmpdir(), 'kyby-mandate-'))
  let clock = T0
  let secret = SECRET
  const store = createMandateStore({ home: () => home, secret: () => secret, now: () => clock })
  try {
    ok('with no file there is no mandate and nothing is allowed', store.view().inForce === false && store.view().why === 'none' && store.allow('memory_write', 'session-a').allow === false && store.text() === '')
    const set = store.set({ preset: 'standard' })
    ok('the person signs: the record, the view and the text follow', set.ok === true && set.view.inForce === true && store.text().startsWith('[MANDATE]') && statSync(store.files.record()).mode % 0o1000 === 0o600, set)
    ok('the file holds a signed record that verifies', verify(JSON.parse(readFileSync(store.files.record(), 'utf8')), SECRET).ok === true)
    const first = store.allow('memory_write', 'session-a')
    const second = store.allow('computer_start', 'session-a')
    ok('a covered tool passes and is counted and written down', first.allow === true && second.allow === true && store.usage().memory === 1 && store.usage().computer === 1)
    const audit = readFileSync(store.files.audit(), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    ok('the audit has the signature and each action, with the session and the class', audit.length === 3 && audit[0].kind === 'signed' && audit[0].preset === 'standard' && audit[1].kind === 'ran' && audit[1].tool === 'memory_write' && audit[1].klass === 'memory' && audit[1].session === 'session-a' && audit[2].klass === 'computer', audit)
    ok('a session id that could carry markup is not written', (() => { store.allow('memory_write', 'x"}\n{"kind":"signed"'); const last = readFileSync(store.files.audit(), 'utf8').trim().split('\n').pop(); return JSON.parse(last).session === null })())
    ok('an app is refused and leaves no trace', store.allow('connections_execute', 'session-a').allow === false && !readFileSync(store.files.audit(), 'utf8').includes('connections_execute'))
    writeFileSync(store.files.record(), JSON.stringify({ ...JSON.parse(readFileSync(store.files.record(), 'utf8')), computerPerDay: 500, memoryPerDay: 500 }))
    clock += 2000
    ok('a file edited by anything but the route is void at the next call', store.allow('memory_write', 's').allow === false && store.view().why === 'altered' && store.text() === '')
    ok('the person signs again and it is back', store.set({ preset: 'prudent' }).ok === true && store.allow('memory_write', 's').allow === true && store.allow('computer_exec', 's').allow === false)
    secret = OTHER
    clock += 2000
    ok('another machine secret (DSH reinstalled) voids it until the person signs again', store.allow('memory_write', 's').allow === false && store.view().why === 'altered')
    secret = null
    ok('with no secret nothing is signed and nothing passes', store.set({ preset: 'standard' }).error === 'cannot_sign' && store.allow('memory_write', 's').allow === false && store.view().canSign === false)
    secret = SECRET
    clock += 2000
    store.set({ preset: 'standard', computerPerDay: 1 })
    ok('a pause is a request like another and stops everything at once', store.set({ paused: true }).view.inForce === false && store.allow('memory_write', 's').allow === false && store.text() === '' && store.set({ paused: false }).view.inForce === true)
    ok('a request that is refused changes nothing', (() => { const before = readFileSync(store.files.record(), 'utf8'); const r = store.set({ memoryPerDay: -1 }); return r.ok === false && readFileSync(store.files.record(), 'utf8') === before })())
    ok('a day later the count starts again', (() => { store.allow('computer_exec', 's'); const blocked = store.allow('computer_exec', 's').allow === false; clock += DAY; return blocked && store.allow('computer_exec', 's').allow === true })())
    writeFileSync(store.files.usage(), '{ not json')
    ok('a broken count file does not break anything', store.allow('memory_write', 's').allow === true)
    mkdirSync(join(home, 'kybernos', 'kyby-mandate.json.dir'), { recursive: true })
    ok('a home that cannot be written answers an error, not a throw', createMandateStore({ home: () => join(home, 'kybernos', 'kyby-mandate.json.dir', 'a', 'b'), secret: () => SECRET, now: () => T0 }).view().inForce === false)
    ok('the store never throws on a failing secret or clock-less dependency', (() => { const s = createMandateStore({ home: () => home, secret: () => { throw new Error('boom') } }); return s.view().canSign === false && s.allow('memory_write', 's').allow === false && s.set({ preset: 'standard' }).ok === false && s.text() === '' })())
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

console.log(fail === 0 ? '\nall good' : `\n${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
