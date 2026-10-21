#!/usr/bin/env node
/** Skills learned from experience, host half: the ledger, the proposals, Accept and its undo, the journal and its chain, the routes and the seam.
 *
 *  Everything runs on a throw-away DSH home and a fake registry and web server: nothing reaches the network, the user's home or a shell.
 *
 *  Usage: node packages/kybernos-skills/test-learned.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const base = mkdtempSync(join(tmpdir(), 'kb-learned-'))
const dsh = join(base, '.dsh')
process.env.HOME = base
process.env.DSH_HOME = dsh
mkdirSync(join(dsh, 'skills'), { recursive: true })

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const fresh = () => { rmSync(dsh, { recursive: true, force: true }); mkdirSync(join(dsh, 'skills'), { recursive: true }) }
const L = await import('./learned.mjs')
const skillFile = (n) => join(dsh, 'skills', n, 'SKILL.md')
const lessons = (tag, n) => Array.from({ length: n }, (_, i) => ({ text: 'Lesson ' + String(i + 1) + ' about ' + tag + ': check the starting point before you count.', tags: [tag, 'x'], kyber: 'default' }))

try {
  console.log('kybernos-skills — skills learned from experience, host half')

  // ── text and checks ────────────────────────────────────────────────────────────────────────────────────────────────────────
  const hits = L.lintText('Write to marie.roux@cabinet.example or call 06 12 34 56 78, born 03/04/1961, see Dupont v. Martin.', ['Dupont', 'Martin'])
  assert.deepEqual(hits.map((h) => h.kind), ['email', 'phone', 'date', 'name', 'name'])
  assert.equal(L.lintText('nothing to find here, version 1.2.3 and 42 items', []).length, 0)
  assert.equal(L.lintText('x'.repeat(100000) + ' 1 1 1 1 1 1 1 1 1 1', []).length >= 0, true)
  ok('the privacy lint finds e-mails, phone numbers, dates and listed names, and leaves plain numbers alone')

  const text = L.buildSkillText({ name: 'demo-checklist', description: 'Reminds you. Use when the user works on demo.', whenToUse: 'When asked.', body: '# Demo\n\n## Watch out for\n- one' })
  assert.match(text, /^---\nname: demo-checklist\ndescription: "Reminds you\. Use when the user works on demo\."\nwhenToUse: "When asked\."\n---\n\n# Demo/)
  for (const r of L.RULES) assert.ok(text.includes('- ' + r), r)
  ok('a learned skill ends with the standard rules block of the shipped skills')

  const good = { name: 'demo-checklist', description: 'Reminds you. Use when the user works on demo.', body: '# Demo\n- one', names: [] }
  assert.equal(L.checkProposal(good, {}).blocking, false)
  assert.equal(L.checkProposal({ ...good, description: 'Reminds you of things.' }, {}).blocking, true)
  assert.equal(L.checkProposal({ ...good, name: 'Bad Name' }, {}).blocking, true)
  assert.equal(L.checkProposal({ ...good, body: 'x'.repeat(9000) }, {}).blocking, true)
  const copy = L.checkProposal(good, { existing: [{ name: 'other', description: 'Reminds you. Use when the user works on demo.' }] }).list.find((c) => c.id === 'copy')
  assert.equal(copy.s, 'warn')
  assert.equal(copy.closest, 'other')
  const dirty = { ...good, body: 'Mail marie.roux@cabinet.example' }
  assert.equal(L.checkProposal(dirty, { sensitive: false }).blocking, false, 'client data only warns outside Law and Health')
  assert.equal(L.checkProposal(dirty, { sensitive: true }).blocking, true, 'and blocks Accept inside them')
  ok('the checks: name, “Use when”, size, a copy of a skill you have, client data (a warning, or a block in Law and Health)')

  // ── a proposal is not a skill ──────────────────────────────────────────────────────────────────────────────────────────────
  fresh()
  const made = await L.proposeFromLessons({ dsh, lessons: lessons('i18n', 3), existing: [] })
  assert.equal(made.ok, true, JSON.stringify(made))
  assert.equal(made.proposal.name, 'i18n-checklist')
  assert.equal(made.proposal.kind, 'lessons')
  assert.match(made.proposal.description, /Use when the user works on i18n\./)
  assert.match(made.proposal.body, /## Watch out for\n- Lesson 1 about i18n/)
  assert.equal(existsSync(join(dsh, 'skills', 'i18n-checklist')), false, 'nothing in the skills folder')
  assert.equal(readdirSync(join(dsh, 'skills')).length, 0)
  const led = JSON.parse(readFileSync(L.ledgerPath(dsh), 'utf8'))
  assert.equal(led.proposals.length, 1)
  assert.equal(L.readAudit(dsh).entries[0].act, 'proposed')
  ok('Make a skill from lessons writes a proposal to the ledger and nothing to the skills folder')

  assert.equal((await L.proposeFromLessons({ dsh, lessons: lessons('i18n', 3), existing: [] })).error, 'already_proposed')
  assert.equal((await L.proposeFromLessons({ dsh, lessons: [], existing: [] })).error, 'no_lessons')
  const one = await L.proposeFromLessons({ dsh, lessons: lessons('sandbox', 1), existing: [] })
  assert.equal(one.proposal.name, 'sandbox-pitfall')
  const same = await L.proposeFromLessons({ dsh, lessons: [{ text: 'A different sandbox lesson.', tags: ['sandbox'] }], existing: [] })
  assert.equal(same.proposal.name, 'sandbox-pitfall-2', 'a name taken by a pending proposal gets the next free one')
  ok('the same lessons are not proposed twice, and names stay unique')

  fresh()
  for (let i = 0; i < 5; i += 1) assert.equal((await L.proposeFromLessons({ dsh, lessons: [{ text: 'Lesson number ' + String(i), tags: ['t' + String(i)] }], existing: [] })).ok, true)
  assert.deepEqual(await L.proposeFromLessons({ dsh, lessons: [{ text: 'One too many', tags: ['more'] }], existing: [] }), { ok: false, error: 'too_many_pending', max: 5 })
  ok('at most five proposals wait')

  // ── Accept ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  fresh()
  const p1 = (await L.proposeFromLessons({ dsh, lessons: lessons('deadline', 3), existing: [] })).proposal
  const acc = await L.acceptProposal({ dsh, id: p1.id, existing: [] })
  assert.equal(acc.ok, true, JSON.stringify(acc))
  assert.equal(acc.name, 'deadline-checklist')
  const written = readFileSync(skillFile('deadline-checklist'), 'utf8')
  assert.equal(written, p1.text, 'what was shown is what was written')
  assert.ok(existsSync(join(L.versionsDir(dsh), 'deadline-checklist', '1.md')))
  const after = await L.listLearned({ dsh, existing: [] })
  assert.equal(after.proposals.length, 0)
  assert.equal(after.learned.length, 1)
  assert.equal(after.learned[0].name, 'deadline-checklist')
  assert.equal(after.learned[0].mode, 'approved')
  const j = L.readAudit(dsh)
  assert.deepEqual(j.entries.map((e) => e.act), ['accepted', 'proposed'])
  assert.equal(j.verified, true)
  ok('Accept copies the proposal to the skills folder as it was shown, keeps version 1, and journals it')

  const p2 = (await L.proposeFromLessons({ dsh, lessons: [{ text: 'Another deadline lesson', tags: ['deadline'] }], existing: [] })).proposal
  mkdirSync(join(dsh, 'skills', 'deadline-pitfall'), { recursive: true })
  writeFileSync(skillFile('deadline-pitfall'), 'THE PERSON WROTE THIS')
  const acc2 = await L.acceptProposal({ dsh, id: p2.id, existing: [] })
  assert.equal(acc2.name, 'deadline-pitfall-2')
  assert.equal(readFileSync(skillFile('deadline-pitfall'), 'utf8'), 'THE PERSON WROTE THIS', 'never over an existing skill')
  ok('Accept never writes over a skill that is already there: the next free name is used')

  const p3 = (await L.proposeFromLessons({ dsh, lessons: [{ text: 'Mail marie.roux@cabinet.example about it', tags: ['mail'] }], existing: [] })).proposal
  assert.equal((await L.acceptProposal({ dsh, id: p3.id, existing: [] })).ok, true, 'a warning does not block outside Law and Health')
  mkdirSync(join(dsh, 'kybernos'), { recursive: true })
  writeFileSync(join(dsh, 'kybernos', 'onboarding.json'), JSON.stringify({ profil: 'droit' }))
  assert.equal(L.isSensitive(dsh), true)
  const p4 = (await L.proposeFromLessons({ dsh, lessons: [{ text: 'Call 06 12 34 56 78 first', tags: ['calls'] }], existing: [] })).proposal
  const blocked = await L.acceptProposal({ dsh, id: p4.id, existing: [] })
  assert.equal(blocked.error, 'checks_failed')
  assert.ok(blocked.checks.includes('client_data'))
  assert.equal(existsSync(skillFile('calls-pitfall')), false)
  const fixed = await L.acceptProposal({ dsh, id: p4.id, body: '# Calls\n## Watch out for\n- Call the client first', existing: [] })
  assert.equal(fixed.ok, true, 'the person edits the text and accepts it')
  assert.equal(JSON.parse(readFileSync(L.ledgerPath(dsh), 'utf8')).learned['calls-pitfall'].proposal.edited, true)
  rmSync(join(dsh, 'kybernos', 'onboarding.json'))
  ok('in Law and Health client data blocks Accept until the text is changed; elsewhere it only warns')

  const p5 = (await L.proposeFromLessons({ dsh, lessons: [{ text: 'Edit me', tags: ['edit'] }], existing: [] })).proposal
  const ed = await L.editProposal({ dsh, id: p5.id, description: 'Edited. Use when the user edits.', body: '# Mine\n- my words', existing: [] })
  assert.equal(ed.ok, true)
  assert.equal(ed.proposal.edited, true)
  assert.equal(existsSync(skillFile('edit-pitfall')), false, 'editing does not activate anything')
  const acc5 = await L.acceptProposal({ dsh, id: p5.id, existing: [] })
  assert.match(readFileSync(skillFile(acc5.name), 'utf8'), /Edited\. Use when the user edits\.[\s\S]*- my words/)
  assert.equal((await L.editProposal({ dsh, id: 'p_nope' })).error, 'not_found')
  ok('Edit keeps the person’s own words on the proposal; Accept writes those')

  // ── Discard, Restore, expiry ───────────────────────────────────────────────────────────────────────────────────────────────
  fresh()
  const d1 = (await L.proposeFromLessons({ dsh, lessons: [{ text: 'Discard me', tags: ['disc'] }], existing: [] })).proposal
  assert.equal((await L.discardProposal({ dsh, id: d1.id })).ok, true)
  let list = await L.listLearned({ dsh, existing: [] })
  assert.equal(list.proposals.length, 0)
  assert.equal(list.discarded.length, 1)
  assert.equal((await L.restoreProposal({ dsh, id: d1.id })).ok, true)
  list = await L.listLearned({ dsh, existing: [] })
  assert.equal(list.proposals.length, 1)
  assert.equal(list.discarded.length, 0)
  assert.deepEqual(L.readAudit(dsh).entries.map((e) => e.act), ['restored', 'discarded', 'proposed'])
  ok('Discard keeps the proposal for 30 days and Restore brings it back, both journaled')

  const day = 24 * 3600 * 1000
  const t0 = Date.now()
  await L.listLearned({ dsh, existing: [], now: t0 + 31 * day })
  const gone = await L.listLearned({ dsh, existing: [], now: t0 + 31 * day })
  assert.equal(gone.proposals.length, 0)
  assert.equal(gone.discarded.length, 1)
  assert.equal(gone.discarded[0].why, 'expired')
  assert.equal(L.readAudit(dsh).entries[0].act, 'expired')
  const forgotten = await L.listLearned({ dsh, existing: [], now: t0 + 62 * day })
  assert.equal(forgotten.discarded.length, 0)
  ok('a proposal nobody answers for 30 days leaves, is kept 30 days more, then forgotten')

  // ── Undo ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  fresh()
  const u1 = (await L.proposeFromLessons({ dsh, lessons: [{ text: 'Undo me', tags: ['undo'] }], existing: [] })).proposal
  await L.acceptProposal({ dsh, id: u1.id, existing: [] })
  const undone = await L.undoAccept({ dsh, name: 'undo-pitfall' })
  assert.equal(undone.ok, true)
  assert.equal(existsSync(join(dsh, 'skills', 'undo-pitfall')), false)
  list = await L.listLearned({ dsh, existing: [] })
  assert.equal(list.learned.length, 0)
  assert.equal(list.proposals.length, 1, 'the proposal is back in the list')
  assert.equal(L.readAudit(dsh).entries[0].act, 'reverted')
  const u2 = list.proposals[0]
  await L.acceptProposal({ dsh, id: u2.id, existing: [] })
  writeFileSync(skillFile('undo-pitfall'), readFileSync(skillFile('undo-pitfall'), 'utf8') + '\nThe person added a line.\n')
  assert.equal((await L.undoAccept({ dsh, name: 'undo-pitfall' })).error, 'edited_since')
  assert.ok(existsSync(skillFile('undo-pitfall')), 'a skill the person edited is theirs')
  assert.equal((await L.undoAccept({ dsh, name: 'never-there' })).error, 'not_found')
  ok('Undo takes an acceptance back only while the skill is still the text that was written')

  // ── automations: pending, or accepted at once by the person's own click ────────────────────────────────────────────────────
  fresh()
  const auto = await L.proposeFromAutomation({ dsh, name: 'Nightly store collector', description: 'Does what the automation does. Use when asked.', whenToUse: 'By hand.', body: '# Nightly store collector\n\n## What to do\nRead the orders.', automation: { id: 't1', name: 'Nightly store collector', runs: 5 }, existing: [] })
  assert.equal(auto.ok, true)
  assert.equal(auto.pending, true)
  assert.equal(auto.name, 'nightly-store-collector')
  assert.equal(existsSync(join(dsh, 'skills', 'nightly-store-collector')), false, 'a stable automation no longer writes a skill on its own')
  const now = await L.proposeFromAutomation({ dsh, name: 'Weekly report', description: 'Use when asked for the weekly report.', body: '# Weekly report\nDo it.', automation: { id: 't2', name: 'Weekly report', runs: 3 }, acceptNow: true, existing: [] })
  assert.equal(now.ok, true)
  assert.equal(now.pending, false)
  assert.ok(existsSync(skillFile('weekly-report')))
  const ent = L.readAudit(dsh).entries.find((e) => e.act === 'accepted')
  assert.equal(ent.mode, 'manual')
  assert.equal(ent.from.automation.id, 't2')
  ok('an automation’s skill waits as a proposal; the person’s own « Create skill » click writes it at once and says so in the journal')

  // ── the skills the automations made the old way ────────────────────────────────────────────────────────────────────────────
  fresh()
  mkdirSync(join(dsh, 'kybernos'), { recursive: true })
  mkdirSync(join(dsh, 'skills', 'old-auto'), { recursive: true })
  writeFileSync(skillFile('old-auto'), '---\nname: old-auto\ndescription: "x"\n---\n\nbody\n')
  writeFileSync(join(dsh, 'kybernos', 'automation-skills.json'), JSON.stringify({ version: 1, skills: { t9: { skill: 'old-auto', at: '2026-10-12T10:00:00.000Z', how: 'auto', runs: 5 }, t8: { skill: 'ghost', at: '2026-10-12T10:00:00.000Z', how: 'auto', runs: 5 } } }))
  list = await L.listLearned({ dsh, existing: [] })
  assert.deepEqual(list.learned.map((l) => l.name), ['old-auto'])
  assert.equal(list.learned[0].legacy, true)
  assert.equal(list.learned[0].by, 'kaby')
  assert.equal((await L.undoAccept({ dsh, name: 'old-auto' })).error, 'not_undoable')
  assert.ok(existsSync(skillFile('old-auto')), 'adopted skills stay active and untouched')
  assert.equal(L.readAudit(dsh).entries[0].act, 'adopted')
  await L.listLearned({ dsh, existing: [] })
  assert.equal(L.readAudit(dsh).count, 1, 'adopted once')
  rmSync(join(dsh, 'skills', 'old-auto'), { recursive: true })
  list = await L.listLearned({ dsh, existing: [] })
  assert.equal(list.learned.length, 0)
  assert.equal(L.readAudit(dsh).entries[0].act, 'removed')
  ok('skills the automations already made are adopted once as Learned and stay active; one the person deleted is dropped and journaled')

  // ── the journal and its chain ──────────────────────────────────────────────────────────────────────────────────────────────
  fresh()
  for (let i = 0; i < 4; i += 1) await L.proposeFromLessons({ dsh, lessons: [{ text: 'Chain lesson ' + String(i), tags: ['c' + String(i)] }], existing: [] })
  let a = L.readAudit(dsh)
  assert.equal(a.verified, true)
  assert.equal(a.count, 4)
  assert.deepEqual(a.entries.map((e) => e.n), [4, 3, 2, 1])
  const lines = readFileSync(L.auditPath(dsh), 'utf8').split('\n').filter((l) => l !== '')
  writeFileSync(L.auditPath(dsh), lines.map((l, i) => (i === 1 ? l.replace('"by":"kaby"', '"by":"you"') : l)).join('\n') + '\n')
  a = L.readAudit(dsh)
  assert.equal(a.verified, false)
  assert.equal(a.brokenAt, 2, 'an edited line shows')
  writeFileSync(L.auditPath(dsh), [lines[0], lines[2], lines[3]].join('\n') + '\n')
  a = L.readAudit(dsh)
  assert.equal(a.verified, false)
  assert.equal(a.brokenAt, 3, 'a deleted line shows')
  writeFileSync(L.auditPath(dsh), lines.join('\n') + '\nnot json\n')
  assert.equal(L.readAudit(dsh).verified, false)
  ok('the journal is a hash chain: an edited, a deleted or a damaged line shows')

  // ── robustness ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
  fresh()
  mkdirSync(join(dsh, 'kybernos'), { recursive: true })
  writeFileSync(L.ledgerPath(dsh), '{"proposals": "no", "learned": [1,2], "discarded": 7')
  assert.deepEqual((await L.listLearned({ dsh, existing: [] })).proposals, [])
  writeFileSync(L.ledgerPath(dsh), JSON.stringify({ version: 1, proposals: [{ id: 'p_x', name: '../evil', kind: 'lessons' }, { id: 'p_y', name: 'fine', kind: 'nope' }, 7, null], learned: { '../x': {}, 'ok-name': { kind: 'zzz', ver: -3 } } }))
  list = await L.listLearned({ dsh, existing: [] })
  assert.equal(list.proposals.length, 0, 'a proposal with an unsafe name or an unknown kind is dropped')
  fresh()
  await Promise.all(Array.from({ length: 6 }, (_, i) => L.proposeFromLessons({ dsh, lessons: [{ text: 'Parallel lesson ' + String(i), tags: ['par' + String(i)] }], existing: [] })))
  assert.equal((await L.listLearned({ dsh, existing: [] })).proposals.length, 5, 'parallel calls never overwrite each other and the cap holds')
  ok('a damaged ledger reads as empty, unsafe entries are dropped, parallel writes do not clobber each other')

  // ── the routes and the seam, through apply() on a fake context ─────────────────────────────────────────────────────────────
  fresh()
  const { apply } = await import('./index.js')
  const routes = {}
  const webServer = { register: (r) => { routes[r.path] = r.handler; return () => { delete routes[r.path] } } }
  const registry = { async snapshot () { return { complete: true, skills: [] } }, invalidateCache () { registry.invalidated = (registry.invalidated || 0) + 1 } }
  apply({ inject (deps, fn) { fn({ get: (n) => (n === 'webServer' ? webServer : n === 'skills' ? registry : undefined), effect: (f) => f() }) } })
  const PORT = 3080
  const request = (method, body, origin) => ({ method, headers: origin === null ? {} : { origin }, socket: { localPort: PORT }, url: '/', async * [Symbol.asyncIterator] () { if (body !== undefined) yield Buffer.from(JSON.stringify(body)) } })
  const call = async (method, path, body, origin = 'http://127.0.0.1:' + PORT) => { const r = { code: null, body: null, writeHead (c) { r.code = c }, end (s) { try { r.body = JSON.parse(s) } catch (e) { r.body = s } } }; await routes['/kybernos-skills/' + path](request(method, body, origin), r); return r }
  const POSTS = ['learned/from-lessons', 'learned/accept', 'learned/edit', 'learned/discard', 'learned/restore', 'learned/undo']
  for (const p of POSTS) {
    assert.ok(routes['/kybernos-skills/' + p], p + ' is registered')
    assert.equal((await call('POST', p, {}, null)).code, 403, p + ' refuses a call with no origin')
    assert.equal((await call('POST', p, {}, 'https://evil.example')).code, 403, p + ' refuses a foreign origin')
    assert.equal((await call('GET', p, undefined)).code, 405, p + ' wants a POST')
  }
  assert.equal((await call('POST', 'learned', {})).code, 405)
  const r1 = await call('POST', 'learned/from-lessons', { lessons: lessons('route', 3) })
  assert.equal(r1.body.ok, true)
  const g = await call('GET', 'learned')
  assert.equal(g.body.proposals.length, 1)
  assert.equal(g.body.limits.maxPending, 5)
  const before = registry.invalidated || 0
  const r2 = await call('POST', 'learned/accept', { id: r1.body.proposal.id })
  assert.equal(r2.body.ok, true)
  assert.equal(registry.invalidated, before + 1, 'the DSH registry is told a skill appeared')
  assert.ok(existsSync(skillFile('route-checklist')))
  const jr = await call('GET', 'learned/journal')
  assert.equal(jr.body.ok, true)
  assert.equal(jr.body.verified, true)
  assert.deepEqual(jr.body.entries.map((e) => e.act), ['accepted', 'proposed'])
  const r3 = await call('POST', 'learned/undo', { name: 'route-checklist' })
  assert.equal(r3.body.ok, true)
  assert.equal(registry.invalidated, before + 2)
  ok('the six POST routes keep the origin guard, and accept and undo tell the DSH registry')

  const seam = globalThis[L.LEARNED_SEAM]
  assert.equal(typeof seam.propose, 'function')
  assert.equal(Object.isFrozen(seam), true)
  const viaSeam = await seam.propose({ name: 'Seam skill', description: 'Use when asked.', body: '# Seam\nDo it.', automation: { id: 't5', name: 'Seam', runs: 5 } })
  assert.equal(viaSeam.ok, true)
  assert.equal(viaSeam.pending, true)
  assert.equal((await seam.propose(null)).ok, true, 'a bad call does not throw')
  const viaClick = await seam.propose({ name: 'Click skill', description: 'Use when asked.', body: '# Click\nDo it.', automation: { id: 't6', name: 'Click', runs: 3 }, acceptNow: true })
  assert.equal(viaClick.pending, false)
  assert.ok(existsSync(skillFile('click-skill')))
  ok('the seam the automations half finds at call time proposes, and accepts at once for the person’s own click')
  console.log('\n' + String(pass) + ' checks passed')
} catch (e) {
  console.error('\n✗ ' + (e && e.stack ? e.stack : String(e)))
  process.exitCode = 1
} finally {
  rmSync(base, { recursive: true, force: true })
}
