// A stable automation becomes a skill, by a fixed rule. This proves the rule and the text (automation-skills.mjs, pure), then the host
// that applies them: the route GET/POST /kybernos/automation-skills and the automatic pass, through the real apply() on a fake context and
// a throw-away DSH home. Nothing here touches the person's own ~/.dsh.
//   node packages/kybernos-plugin/test-automation-skills.mjs   (exit 0 = everything passes)
import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { SKILL_NAME_RE, SKILL_NAME_MAX, stableStreak, stableAfterOf, skillSlug, skillParts, normalizeRecords, dueTasks, lessonOf } from './automation-skills.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const at = (d, h, m) => new Date(Date.UTC(2026, 9, d, h, m || 0)).toISOString()
const run = (d, id) => ({ at: at(d, 8), sessionId: id || 'session-' + d, status: 'fired' })
const fail = (d, h, m) => ({ at: at(d, h || 8, m === undefined ? 3 : m), status: 'error', error: 'no event received' })

// ── the rule: runs in a row without a failure ────────────────────────────────────────────────────────────────────────────────────
assert.equal(stableStreak([]), 0)
for (const bad of [undefined, null, 'x', 7, {}]) assert.equal(stableStreak(bad), 0, 'not a list: no run')
assert.equal(stableStreak([run(1), run(2), run(3)]), 3)
ok('every run without a failure counts')
assert.equal(stableStreak([run(1), run(2), fail(2), run(3), run(4)]), 2, 'the newest failure stops the count')
assert.equal(stableStreak([run(1), run(2), run(3), fail(3)]), 0, 'a failure after the newest run: the streak is nothing')
ok('the newest failure stops the count, the note a run writes about itself included')
assert.equal(stableStreak([run(3), run(1), fail(1), run(2)]), 2, 'the order of the stored lines does not matter')
assert.equal(stableStreak([{ at: at(1, 8), status: 'fired' }, { at: at(2, 8), status: 'queued' }]), 0, 'a line with no session id is not a run')
assert.equal(stableStreak([null, 7, 'x', run(1)]), 1, 'junk lines are skipped')
ok('lines are read by time, a line without a session is not a run, junk is skipped')
assert.deepEqual([3, 5, 10, 20].map((n) => stableAfterOf({ stableAfter: n })), [3, 5, 10, 20])
assert.deepEqual([undefined, null, {}, { stableAfter: 7 }, { stableAfter: '5' }].map(stableAfterOf), [5, 5, 5, 5, 5])
ok('the number of runs that makes it stable is one of 3, 5, 10, 20, else 5')

// ── the name and the text ────────────────────────────────────────────────────────────────────────────────────────────────────
assert.equal(skillSlug('Étude à la demande'), 'etude-a-la-demande')
assert.equal(skillSlug('Prospection PME .fr — collecte contacts'), 'prospection-pme-fr-collecte-contacts')
assert.equal(skillSlug('   '), 'automation')
assert.equal(skillSlug('日本語'), 'automation')
assert.equal(skillSlug(undefined), 'automation')
const long = skillSlug('a'.repeat(200))
assert.ok(long.length <= SKILL_NAME_MAX && SKILL_NAME_RE.test(long))
for (const n of ['Étude à la demande', 'x', '!!!', 'A -- B', 'Rapport #3 (hebdo)']) assert.ok(SKILL_NAME_RE.test(skillSlug(n)), n)
ok('the name is DSH-valid lowercase words, never empty, never too long')
assert.equal(skillSlug('Étude', (n) => n === 'etude'), 'etude-2')
assert.equal(skillSlug('Étude', (n) => n === 'etude' || n === 'etude-2'), 'etude-3')
assert.equal(skillSlug('Étude', () => true), null, 'no free name: none is invented')
assert.ok(SKILL_NAME_RE.test(skillSlug('a'.repeat(60), (n) => n === 'a'.repeat(40))))
ok('a name that is taken gets the next free one, never the same')
{
  const task = { id: 'st-1', name: 'Weekly report', prompt: 'Write the weekly report.\n1. Read the numbers.\n2. Write it.\n', trigger: { type: 'webhook', secret: 'SECRET-VALUE', hookId: 'h1' }, history: [run(1, 'session-secret-id')] }
  const parts = skillParts(task, 'weekly-report', 12)
  assert.equal(parts.description, 'Does what the automation “Weekly report” does: Write the weekly report. Use when the user asks for “Weekly report” by hand, or to redo what the automation of that name does.')
  assert.match(parts.description, /\bUse when\b/, 'the skills page checks for a “Use when…” description')
  assert.ok(parts.whenToUse.startsWith('The user asks for “Weekly report” by hand'))
  assert.ok(parts.body.includes('1. Read the numbers.\n2. Write it.'), 'the steps are the automation text')
  assert.ok(parts.body.includes('after 12 runs in a row without a failure') && parts.body.includes('Suggested by Kaby'))
  assert.equal(/SECRET-VALUE|session-secret-id|hookId/.test(JSON.stringify(parts)), false, 'no secret, no session id, no webhook')
  assert.equal(parts.body.startsWith('---'), false, 'no frontmatter: the skills page writes that, and the standard rules')
  ok('the skill parts are the automation text, without its secret, history or webhook, and carry no frontmatter')
  const hostile = skillParts({ name: 'x"\n---\nname: evil', prompt: 'a\r\nb' }, 'x', 5)
  assert.equal(hostile.description.includes('\n'), false, 'a name with quotes and dashes stays on one line')
  assert.equal(skillParts({ name: 'e', prompt: '' }, 'e', 5).body.includes('(the automation had no text)'), true)
  assert.equal(skillParts(null, 'e', NaN).body.includes('after 0 runs'), true)
  assert.equal(skillParts({ name: 'n', prompt: 'Do it' }, 'n', 5).description.includes('Do it. Use when'), true, 'a first line with no full stop gets one')
  ok('a hostile name cannot spill over a line, an empty text and a null task do not throw')
}

// ── what is kept, what is due ────────────────────────────────────────────────────────────────────────────────────────────────
assert.deepEqual(normalizeRecords(null), { version: 1, skills: {} })
assert.deepEqual(Object.keys(normalizeRecords({ skills: { a: { skill: 'ok-name', at: at(1, 1), how: 'manual', runs: 5.7 }, b: { skill: 'Bad Name' }, c: 'x', d: null } }).skills), ['a'])
assert.equal(normalizeRecords({ skills: { a: { skill: 'ok-name', how: 'weird', runs: -3 } } }).skills.a.how, 'auto')
assert.equal(normalizeRecords({ skills: { a: { skill: 'ok-name', runs: -3 } } }).skills.a.runs, 0)
ok('a damaged record reads as empty, a bad entry is dropped, never thrown')
{
  const stable = { id: 'a', history: [1, 2, 3, 4, 5, 6].map((d) => run(d)) }
  const young = { id: 'b', history: [run(1), run(2)] }
  const broken = { id: 'c', history: [1, 2, 3, 4, 5, 6].map((d) => run(d)).concat([fail(6)]) }
  const made = { id: 'd', history: [1, 2, 3, 4, 5, 6].map((d) => run(d)) }
  const recs = { skills: { d: { skill: 'done-before', how: 'auto', runs: 5, at: at(1, 1) } } }
  assert.deepEqual(dueTasks([stable, young, broken, made, null, { history: [] }], recs, { autoSkill: true, stableAfter: 5 }).map((t) => t.id), ['a'])
  assert.deepEqual(dueTasks([stable], recs, { autoSkill: false, stableAfter: 5 }), [], 'switched off: nothing is due')
  assert.deepEqual(dueTasks([stable], recs, null), [])
  assert.deepEqual(dueTasks([stable], recs, { autoSkill: true, stableAfter: 10 }), [], 'six runs are not stable at ten')
  assert.deepEqual(dueTasks('x', recs, { autoSkill: true }), [])
  ok('due = stable, with no skill yet, and only when the switch is on')
  const l = lessonOf(stable, recs, { autoSkill: false, stableAfter: 3 })
  assert.deepEqual([l.streak, l.stableAfter, l.autoSkill, l.skill], [6, 3, false, null])
  assert.equal(lessonOf(made, recs, { autoSkill: true }).skill.skill, 'done-before')
  assert.deepEqual(lessonOf(null, null, null), { streak: 0, stableAfter: 5, autoSkill: false, skill: null })
  ok('what the page asks: how far it is, what the rule needs, the skill if there is one')
}

// ── the host, through the real apply() ───────────────────────────────────────────────────────────────────────────────────────
const here = dirname(fileURLToPath(import.meta.url))
const scratch = mkdtempSync(join(tmpdir(), 'kb-skills-'))
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
const tasks = [
  { id: 'st-stable', name: 'Étude à la demande', prompt: 'Study the request.\n1. Read it.\n2. Send the result.', schedule: { mode: 'webhook' }, approvals: 'ask', active: false, history: [1, 2, 3, 4, 5, 6].map((d) => run(d)), createdAt: at(1, 1), updatedAt: at(1, 1) },
  { id: 'st-young', name: 'Young one', prompt: 'x', schedule: { mode: 'webhook' }, approvals: 'ask', active: false, history: [run(1)], createdAt: at(1, 1), updatedAt: at(1, 1) },
  { id: 'st-failed', name: 'Failing one', prompt: 'x', schedule: { mode: 'webhook' }, approvals: 'ask', active: false, history: [1, 2, 3, 4, 5, 6].map((d) => run(d)).concat([fail(6)]), createdAt: at(1, 1), updatedAt: at(1, 1) },
]
writeFileSync(join(dsh, 'kybernos', 'tasks.json'), JSON.stringify(tasks), { mode: 0o600 })
const settingsFile = join(dsh, 'kybernos', 'automation-settings.json')
// suggesting is on by default (automation-settings.mjs); the first checks want it off, so the tick cannot make a record of its own meanwhile
writeFileSync(settingsFile, JSON.stringify({ version: 1, autoSkill: false, stableAfter: 5 }), { mode: 0o600 })
const disposers = []
try {
  const mod = await import(pathToFileURL(join(copy, 'index.js')).href)
  const registered = {}
  const webServer = { register: (r) => { registered[r.path] = r.handler; return () => { delete registered[r.path] } } }
  const services = { fs: {}, webServer }
  mod.apply({ get: (n) => services[n], inject: () => {}, effect: (fn) => { const d = fn(); if (typeof d === 'function') disposers.push(d); return d }, on: () => {} })
  const PORT = 3080
  const call = async (method, query, body, origin = 'http://127.0.0.1:' + PORT) => {
    const handler = registered['/kybernos/automation-skills']
    assert.ok(handler !== undefined, 'the route is registered')
    const res = { code: 0, raw: null, writeHead (c) { this.code = c }, end (p) { this.raw = p === undefined ? null : String(p) } }
    const payload = body === undefined ? '' : JSON.stringify(body)
    await handler({ method, url: '/kybernos/automation-skills' + query, headers: { origin, host: '127.0.0.1:' + PORT, 'content-type': 'application/json' }, socket: { localPort: PORT }, async *[Symbol.asyncIterator] () { if (payload !== '') yield Buffer.from(payload) } }, res)
    let json = null
    try { json = JSON.parse(res.raw) } catch (e) { json = null }
    return { code: res.code, json }
  }

  const g = await call('GET', '?id=st-stable')
  assert.deepEqual([g.code, g.json.ok, g.json.lesson.streak, g.json.lesson.stableAfter, g.json.lesson.autoSkill, g.json.lesson.skill], [200, true, 6, 5, false, null])
  assert.equal((await call('GET', '?id=st-young')).json.lesson.streak, 1)
  ok('GET says how far an automation is from becoming a skill')
  assert.deepEqual([(await call('GET', '?id=nope')).code, (await call('GET', '')).code, (await call('GET', '?id=../etc')).code], [404, 400, 400])
  assert.equal((await call('DELETE', '?id=st-stable')).code, 405)
  assert.equal((await call('GET', '?id=st-stable', undefined, 'http://evil.example')).code, 403)
  assert.equal((await call('POST', '', { id: 'st-stable' }, 'http://evil.example')).code, 403)
  ok('an unknown or malformed id, another method and another origin are refused')

  const early = await call('POST', '', { id: 'st-young' })
  assert.deepEqual([early.json.ok, early.json.error], [false, 'not stable yet'])
  const broke = await call('POST', '', { id: 'st-failed' })
  assert.deepEqual([broke.json.ok, broke.json.error], [false, 'not stable yet'])
  assert.equal(existsSync(join(dsh, 'skills')), false, 'a refused request writes nothing')
  ok('the button works only for a stable automation: the rule is the host\'s, not the page\'s')

  // The skills page's seam: this test stands in for it (the real one is packages/kybernos-skills/learned.mjs, tested in its own suite).
  const SEAM = Symbol.for('kybernos.learned-skills')
  const proposals = []
  let reply = (input) => ({ ok: true, name: input.name, pending: input.acceptNow !== true })
  globalThis[SEAM] = Object.freeze({ version: 1, propose: async (input) => { proposals.push(input); return reply(input) } })

  const none = Object.getOwnPropertyDescriptor(globalThis, SEAM)
  delete globalThis[SEAM]
  const lonely = await call('POST', '', { id: 'st-stable' })
  assert.deepEqual([lonely.json.ok, lonely.json.error], [false, 'the skills page is not loaded'])
  assert.equal(existsSync(join(dsh, 'skills')), false, 'no skill is ever written by this half')
  assert.equal(existsSync(join(dsh, 'kybernos', 'automation-skills.json')), false, 'and no record without a proposal')
  Object.defineProperty(globalThis, SEAM, none)
  ok('without the skills page there is nothing to hand the skill to: refused, no record')

  const made = await call('POST', '', { id: 'st-stable' })
  assert.equal(made.json.ok, true)
  assert.deepEqual([made.json.lesson.skill.skill, made.json.lesson.skill.how, made.json.lesson.skill.runs, made.json.lesson.skill.state], ['etude-a-la-demande', 'manual', 6, 'made'])
  assert.equal(proposals.length, 1)
  const p = proposals[0]
  assert.equal(p.acceptNow, true, 'the person pressing « Create skill » is the acceptance')
  assert.equal(p.name, 'etude-a-la-demande')
  assert.ok(p.body.includes('1. Read it.\n2. Send the result.') && p.body.includes('after 6 runs in a row'))
  assert.match(p.description, /\bUse when\b/)
  assert.deepEqual(p.automation, { id: 'st-stable', name: 'Étude à la demande', runs: 6 })
  assert.equal(existsSync(join(dsh, 'skills')), false, 'this half writes no skill: the skills page does')
  ok('POST hands the STORED automation to the skills page, as the person’s own acceptance, and keeps a record')
  const again = await call('POST', '', { id: 'st-stable' })
  assert.deepEqual([again.json.ok, again.json.error], [false, 'a skill was already written'])
  assert.equal(proposals.length, 1)
  assert.equal((await call('GET', '?id=st-stable')).json.lesson.skill.skill, 'etude-a-la-demande')
  ok('a skill is proposed once per automation, and GET then tells which')

  // the skills page picks the free name; the record keeps the name it answered
  const rec = join(dsh, 'kybernos', 'automation-skills.json')
  rmSync(rec)
  reply = (input) => ({ ok: true, name: input.name + '-2', pending: false })
  const other = await call('POST', '', { id: 'st-stable' })
  assert.equal(other.json.lesson.skill.skill, 'etude-a-la-demande-2', 'the name is taken: the next free one, as the skills page said')
  rmSync(rec)
  reply = () => ({ ok: false, error: 'too_many_pending', max: 5 })
  const full = await call('POST', '', { id: 'st-stable' })
  assert.deepEqual([full.json.ok, full.json.error], [false, 'too_many_pending'])
  assert.equal(existsSync(rec), false, 'a refusal writes no record, so it is tried again later')
  reply = () => { throw new Error('boom') }
  assert.equal((await call('POST', '', { id: 'st-stable' })).code >= 200, true, 'a seam that throws does not take the route down')
  assert.equal(existsSync(rec), false)
  reply = (input) => ({ ok: true, name: input.name, pending: input.acceptNow !== true })
  ok('the name comes from the skills page, a refusal or a failure writes no record')

  // the settings carry the rule
  writeFileSync(settingsFile, JSON.stringify({ version: 1, autoSkill: true, stableAfter: 3 }), { mode: 0o600 })
  const g3 = await call('GET', '?id=st-young')
  assert.deepEqual([g3.json.lesson.autoSkill, g3.json.lesson.stableAfter], [true, 3])
  const g4 = await call('POST', '', { id: 'st-failed' })
  assert.equal(g4.json.error, 'not stable yet')
  ok('the number of runs and the switch come from the Automations settings')

  // the automatic pass: with the switch on, the scheduler's tick PROPOSES the stable ones (the first tick comes 5 s after boot)
  rmSync(rec, { force: true })
  proposals.length = 0
  writeFileSync(settingsFile, JSON.stringify({ version: 1, autoSkill: true, stableAfter: 5 }), { mode: 0o600 })
  let waited = 0
  while (existsSync(rec) === false && waited < 20000) { await new Promise((r) => setTimeout(r, 500)); waited += 500 }
  assert.equal(existsSync(rec), true, 'the tick proposed the skill of the stable automation')
  const kept = JSON.parse(readFileSync(rec, 'utf8')).skills
  assert.deepEqual(Object.keys(kept), ['st-stable'], 'only the stable automation: not the young one, not the one that failed')
  assert.deepEqual([kept['st-stable'].skill, kept['st-stable'].how, kept['st-stable'].runs, kept['st-stable'].state], ['etude-a-la-demande', 'auto', 6, 'pending'])
  assert.equal(proposals.length, 1)
  assert.equal(proposals[0].acceptNow, false, 'by itself it only suggests: nothing is active before the person accepts')
  assert.equal(existsSync(join(dsh, 'skills')), false)
  ok('with the switch on, the tick suggests the stable automation as a skill by itself, and only that one')
} finally {
  delete globalThis[Symbol.for('kybernos.learned-skills')]
  for (const d of disposers) { try { d() } catch (e) { /* best effort */ } }
  for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  rmSync(scratch, { recursive: true, force: true })
}
console.log('\n' + pass + ' verifications OK')
process.exit(0)
