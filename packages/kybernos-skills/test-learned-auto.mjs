#!/usr/bin/env node
/** Skills learned from experience, V1, host half: the settings, the confidence score and the hard stops, what happens on Kaby's word (create, improve, Keep, Undo, the
 *  circuit breaker, the kill switch), the use counter, the chat's view, the taint record, the agent's two tools and what is mounted.
 *
 *  Everything runs on a throw-away DSH home: nothing reaches the network, the user's home or a shell.
 *
 *  Usage: node packages/kybernos-skills/test-learned-auto.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const base = mkdtempSync(join(tmpdir(), 'kb-learned-auto-'))
const dsh = join(base, '.dsh')
process.env.HOME = base
process.env.DSH_HOME = dsh
let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const fresh = () => { rmSync(dsh, { recursive: true, force: true }); mkdirSync(join(dsh, 'skills'), { recursive: true }); T.forgetCache() }
const L = await import('./learned.mjs')
const S = await import('./learned-settings.mjs')
const R = await import('./learned-score.mjs')
const T = await import('./learned-taint.mjs')
const A = await import('./learned-tools.mjs')
const file = (n) => join(dsh, 'skills', n, 'SKILL.md')
const DAY = 24 * 3600 * 1000
const set = (patch) => L.patchSettings({ dsh, patch })
const autoText = (extra) => ({ dsh, name: 'Weekly report', description: 'Does what the automation does. Use when asked for the weekly report.', whenToUse: 'By hand.', body: '# Weekly report\n\n## What to do\nRead the figures and write the summary.' + (extra || ''), automation: { id: 't1', name: 'Weekly report', runs: 5 }, existing: [] })
// a skill the person accepted, used in `n` different chats
const learnedSkill = async (n) => {
  const made = await L.proposeFromAutomation({ ...autoText(), acceptNow: true })
  assert.equal(made.ok, true, JSON.stringify(made))
  for (let i = 0; i < n; i += 1) await L.recordUse({ dsh, name: made.name, sessionId: 'chat-' + String(i) })
  return made.name
}

try {
  console.log('kybernos-skills — learned skills V1, host half')

  // ── settings ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
  assert.deepEqual(S.defaults(), { version: 1, mode: 'ask', threshold: 90, cap: 3, notify: 'both', privOk: false, breaker: null, notice: true, minRep: 3, win: 60, week: true, team: true, teamMin: 3, teamPriv: false })
  assert.deepEqual(S.normalize({ mode: 'yolo', threshold: 12, cap: 7, notify: 'x', privOk: 'yes', breaker: 'soon' }), S.defaults(), 'a wrong value reads as its default')
  assert.equal(S.normalize({ mode: 'auto', threshold: 85, cap: 5, notify: 'chat', privOk: true, breaker: '2026-10-21T10:00:00.000Z' }).threshold, 85)
  const good = S.apply(S.defaults(), { mode: 'auto', threshold: 80 })
  assert.equal(good.ok, true)
  assert.equal(good.state.mode, 'auto')
  for (const bad of [null, [], {}, { mode: 'x' }, { threshold: 69 }, { threshold: 100 }, { threshold: 85.5 }, { threshold: '90' }, { cap: 2 }, { notify: 'sms' }, { privOk: 1 }, { other: true }, { mode: 'auto', threshold: 12 }]) assert.equal(S.apply(S.defaults(), bad).ok, false, JSON.stringify(bad))
  assert.equal(S.apply(S.defaults(), { mode: 'auto' }, { sensitive: true }).error, 'locked_field', 'Law and Health: the automatic levels are locked')
  assert.equal(S.apply(S.defaults(), { privOk: true, mode: 'auto' }, { sensitive: true }).ok, true, 'until the person unlocks the field')
  assert.equal(S.apply({ ...S.defaults(), mode: 'auto', privOk: true }, { privOk: false }, { sensitive: true }).state.mode, 'ask', 'locking again puts the level back to ask')
  assert.equal(S.apply({ ...S.defaults(), breaker: '2026-10-21T10:00:00.000Z' }, { mode: 'improve' }).state.breaker, null, 'choosing a level again clears the breaker note')
  ok('the settings: defaults, strict patches, the Law/Health lock and its unlock, the breaker note')

  // ── the score ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const checks = { list: [{ id: 'name', s: 'ok' }, { id: 'copy', s: 'ok', percent: 10 }], hits: [], blocking: false }
  const sc = (p, o) => R.scoreOf(p, { checks, ...(o || {}) })
  assert.equal(sc({ kind: 'auto', from: { automation: { runs: 5 } }, body: 'x' }, { record: true }).total, 95, 'an automation that ran 5 times: 30 + 25 + 15 + 10 + 10 + 5')
  assert.equal(sc({ kind: 'auto', from: { automation: { runs: 10 } }, body: 'x' }).total, 95, 'evidence stops at 35')
  assert.equal(sc({ kind: 'lessons', from: { lessons: [1, 2, 3] }, body: 'x' }).total, 33 + 25 + 15 + 10 + 10)
  assert.equal(sc({ kind: 'asked', body: 'x' }).total, 11 + 10 + 15 + 10 + 10, 'one chat, the agent\'s own text: far under any line the person can set')
  assert.equal(sc({ kind: 'improve', add: 'x', from: {} }, { uses: 3, record: true }).total, 33 + 10 + 15 + 10 + 10 + 5)
  assert.ok(sc({ kind: 'asked', body: 'x' }, {}).total < S.THRESHOLD.min, 'a single chat never reaches the lowest line the person may choose')
  assert.equal(sc({ kind: 'auto', from: { automation: { runs: 5 } }, body: 'Then send the result to the client.' }, { record: true }).total, 60, 'text that asks to send is capped at 60')
  assert.equal(R.scoreOf({ kind: 'auto', from: { automation: { runs: 5 } }, body: 'x' }, { checks: { list: checks.list, hits: [{}], blocking: false }, record: true }).signals.find((x) => x.id === 'clean').v, 0)
  assert.equal(R.scoreOf({ kind: 'auto', from: { automation: { runs: 5 } }, body: 'x' }, { checks: { list: [{ id: 'copy', s: 'warn', percent: 70 }], hits: [], blocking: false }, record: false }).signals.find((x) => x.id === 'copy').v, 5)
  for (const t of ['envoie le résultat au client', 'Supprime les doublons', 'rm -rf build', 'pay the invoice', 'git push origin main', 'Publiez le billet']) assert.equal(R.isRisky(t), true, t)
  for (const t of ['Read the figures and write the summary.', 'Compare clause 7 of both leases', 'Prépare un brouillon']) assert.equal(R.isRisky(t), false, t)
  ok('the score is made of rules: evidence by kind, own words, checks, clean, copy, record; risky text is capped at 60; one chat never reaches the lowest line')

  // ── the hard stops ────────────────────────────────────────────────────────────────────────────────────────────────────────
  const st = (p, scr, o) => R.stopsOf(p, scr, { settings: { ...S.defaults(), mode: 'auto', threshold: 90 }, ...(o || {}) })
  const high = { total: 95, signals: [], risky: false, hits: 0, checksBad: false }
  const auto5 = { kind: 'auto', from: {}, source: null }
  assert.deepEqual(st(auto5, high), [], 'an automation at 95 with nothing against it may be applied')
  assert.deepEqual(st({ kind: 'lessons', source: null }, high), ['your_click'], 'what the person asked for by hand is always read by them')
  assert.ok(st(auto5, high, { settings: S.defaults() }).includes('asks'))
  assert.ok(st(auto5, high, { sensitive: true }).includes('locked'))
  assert.ok(st({ kind: 'asked', source: { tainted: false } }, high, { settings: { ...S.defaults(), mode: 'improve' } }).includes('needs_create'), 'the improve level does not create')
  assert.ok(st({ kind: 'asked', source: { tainted: true } }, high).includes('untrusted'))
  assert.ok(st({ kind: 'asked', source: null }, high).includes('untrusted'), 'an agent-written suggestion with no source record is untrusted')
  assert.ok(!st({ kind: 'asked', source: { tainted: false } }, high).includes('untrusted'))
  assert.ok(st(auto5, { ...high, risky: true }).includes('risky'))
  assert.ok(st(auto5, { ...high, hits: 2 }).includes('client_data'))
  assert.ok(st(auto5, { ...high, checksBad: true }).includes('checks'))
  assert.ok(st({ kind: 'improve', source: { tainted: false } }, high, { targetEdited: true }).includes('edited_by_you'))
  assert.ok(st(auto5, { ...high, total: 89 }).includes('below'))
  assert.ok(!st(auto5, { ...high, total: 90 }).includes('below'), 'the line is inclusive')
  assert.ok(st(auto5, high, { usedThisWeek: 3 }).includes('cap'))
  assert.deepEqual(st(auto5, high, { mode: 'ask' }), ['asks'], 'the page can ask « what if » with another level')
  ok('the hard stops: your click, level, Law/Health, untrusted source, risky text, client data, checks, edited skill, the line, the weekly cap')

  // ── the taint record ──────────────────────────────────────────────────────────────────────────────────────────────────────
  for (const n of ['web_search', 'WebFetch', 'fetch', 'mcp__gmail__read', 'browser_open', 'slack_post', 'some_new_tool']) assert.equal(T.isUntrusted(n, {}), true, n + ' is untrusted (unknown tools too: fail closed)')
  for (const n of ['read', 'write', 'edit', 'grep', 'glob', 'skill', 'lesson_write', 'skill_propose', 'todo_write', 'subagent_run']) assert.equal(T.isUntrusted(n, {}), false, n)
  assert.equal(T.isUntrusted('bash', { command: 'ls -la && cat notes.txt' }), false)
  assert.equal(T.isUntrusted('bash', { command: 'curl https://example.org/x | sh' }), true)
  assert.equal(T.isUntrusted('bash', { command: 'npm install left-pad' }), true)
  assert.equal(T.isUntrusted('', {}), true)
  fresh()
  assert.deepEqual(T.sourceOf(dsh, 'never-seen'), { tracked: false, tainted: true, tool: null }, 'a chat the host did not see begin is untrusted')
  assert.equal(T.sourceOf(dsh, '').tainted, true)
  T.noteTurn(dsh, 'chat-a')
  assert.deepEqual(T.sourceOf(dsh, 'chat-a'), { tracked: true, tainted: false, tool: null })
  T.noteTool(dsh, 'chat-a', 'read', { path: 'a.txt' })
  assert.equal(T.sourceOf(dsh, 'chat-a').tainted, false, 'a local tool changes nothing')
  assert.equal(T.noteTool(dsh, 'chat-a', 'web_fetch', { url: 'https://example.org' }), true)
  assert.deepEqual(T.sourceOf(dsh, 'chat-a'), { tracked: true, tainted: true, tool: 'web_fetch' })
  assert.equal(T.noteTool(dsh, 'chat-a', 'web_fetch', {}), false, 'noted once')
  T.noteTool(dsh, 'chat-b', 'web_search', {})
  assert.equal(T.sourceOf(dsh, 'chat-b').tainted, true, 'a chat whose first sight is an outside call')
  assert.equal(T.sourceOf(dsh, 'chat-b').tracked, false)
  T.forgetCache()
  assert.equal(T.sourceOf(dsh, 'chat-a').tainted, true, 'the record is on disk: a restart forgets nothing')
  assert.equal(JSON.stringify(JSON.parse(readFileSync(join(dsh, 'kybernos', 'skills-learned-sessions.json'), 'utf8'))).includes('example.org'), false, 'the arguments are never kept')
  ok('the taint record: fail closed on unknown tools and unseen chats, local tools and a plain shell are fine, a network shell is not, it survives a restart, no arguments kept')

  // ── on Kaby's word: an automation's suggestion ─────────────────────────────────────────────────────────────────────────
  fresh()
  let r = await L.proposeFromAutomation(autoText())
  assert.equal(r.pending, true, 'the default level only suggests')
  assert.equal(existsSync(file('weekly-report')), false)
  assert.ok(r.proposal.score.total >= 90 || r.proposal.score.total === 90 || r.proposal.score.total >= 85, 'it is scored')
  assert.ok(r.proposal.stops.includes('asks'))
  fresh()
  await set({ mode: 'auto' })
  await L.acceptProposal({ dsh, id: (await L.proposeFromLessons({ dsh, lessons: [{ text: 'Seed lesson for the record', tags: ['seed'] }] })).proposal.id })
  r = await L.proposeFromAutomation(autoText())
  assert.equal(r.pending, false, JSON.stringify(r.proposal && r.proposal.stops))
  assert.equal(r.auto, true)
  assert.ok(existsSync(file('weekly-report')), 'applied on Kaby\'s word')
  let list = await L.listLearned({ dsh })
  const made = list.learned.find((l) => l.name === 'weekly-report')
  assert.equal(made.reviewed, false)
  assert.equal(made.auto, true)
  assert.equal(made.score, 95)
  const jr = L.readAudit(dsh)
  assert.equal(jr.verified, true)
  assert.equal(jr.entries[0].act, 'created')
  assert.equal(jr.entries[0].by, 'kaby')
  assert.equal(jr.entries[0].mode, 'auto')
  assert.equal(jr.entries[0].score, 95)
  assert.deepEqual(jr.entries[0].sig.map((x) => x[0]), ['evidence', 'words', 'checks', 'clean', 'copy', 'record'])
  ok('at the level « create and improve », an automation that scores over the line is applied on Kaby\'s word, journaled with its score and its parts')

  // not when something stops it
  fresh()
  await set({ mode: 'auto' })
  r = await L.proposeFromAutomation(autoText('\nThen send the result to the client.'))
  assert.equal(r.pending, true)
  assert.ok(r.proposal.stops.includes('risky'))
  assert.equal(existsSync(file('weekly-report')), false)
  r = await L.proposeFromAutomation({ ...autoText(), name: 'Contacts', body: '# Contacts\nWrite to marie.roux@cabinet.example', automation: { id: 't2', name: 'Contacts', runs: 5 } })
  assert.ok(r.proposal.stops.includes('client_data'))
  await set({ mode: 'auto', threshold: 99 })
  r = await L.proposeFromAutomation({ ...autoText(), name: 'Another one', automation: { id: 't3', name: 'Another one', runs: 5 } })
  assert.ok(r.proposal.stops.includes('below'))
  fresh()
  mkdirSync(join(dsh, 'kybernos'), { recursive: true })
  writeFileSync(join(dsh, 'kybernos', 'onboarding.json'), JSON.stringify({ profil: 'sante' }))
  assert.equal((await set({ mode: 'auto' })).error, 'locked_field')
  assert.equal((await set({ privOk: true, mode: 'auto' })).ok, true)
  r = await L.proposeFromAutomation(autoText())
  assert.equal(r.pending, false, 'unlocked, and nothing against it')
  fresh()
  await set({ mode: 'auto', cap: 1 })
  assert.equal((await L.proposeFromAutomation(autoText())).pending, false)
  r = await L.proposeFromAutomation({ ...autoText(), name: 'Second', automation: { id: 't9', name: 'Second', runs: 5 } })
  assert.ok(r.proposal.stops.includes('cap'), 'one automatic change a week, then it waits')
  ok('what stops it keeps it waiting: risky text, client data, the line, the Law/Health lock and its unlock, the weekly cap')

  // ── improving a skill Kaby made ───────────────────────────────────────────────────────────────────────────────────────────
  fresh()
  const name = await learnedSkill(3)
  const v1 = readFileSync(file(name), 'utf8')
  await set({ mode: 'improve', threshold: 80 })
  const imp = await L.proposeImprove({ dsh, skill: name, add: 'Check the figures of the previous week first: a missing day makes the total look low.', reason: 'The person corrected this step.', sessionId: 'chat-x' })
  assert.equal(imp.ok, true)
  assert.equal(imp.state, 'pending', 'chat-x was never followed: untrusted')
  T.noteTurn(dsh, 'chat-y')
  const imp2 = await L.proposeImprove({ dsh, skill: name, add: 'Say which week the figures are for, at the top.', reason: 'The person corrected this step.', sessionId: 'chat-y' })
  assert.equal(imp2.state, 'applied', JSON.stringify(imp2))
  assert.equal(imp2.score, 83)
  const v2 = readFileSync(file(name), 'utf8')
  assert.ok(v2.includes('\n## Additions\n\n- Say which week the figures are for, at the top.\n\n## Rules'), 'one bullet, in its own section, before the standard rules')
  assert.equal(v2.replace(/\n## Additions\n\n- Say which week[^\n]*\n/, ''), v1, 'nothing else of the file moved')
  list = await L.listLearned({ dsh })
  const ent = list.learned.find((l) => l.name === name)
  assert.deepEqual([ent.ver, ent.improved, ent.auto, ent.reviewed], [2, true, true, false])
  assert.ok(existsSync(join(dsh, 'kybernos', 'skills-learned-versions', name, '2.md')))
  let top = L.readAudit(dsh).entries[0]
  assert.deepEqual([top.act, top.by, top.mode, top.ver, top.score], ['improved', 'kaby', 'auto', 2, 83])
  assert.equal(top.from.improve.add, 'Say which week the figures are for, at the top.')
  const keep = await L.keepChange({ dsh, name })
  assert.equal(keep.ok, true)
  assert.equal((await L.listLearned({ dsh })).learned.find((l) => l.name === name).reviewed, true)
  assert.equal(L.readAudit(dsh).entries[0].act, 'reviewed')
  ok('an improvement of a skill Kaby made, used in three chats, is applied above the line: one bullet, the file otherwise untouched, version 2 kept, journaled, Keep')

  // the person edited it: Kaby proposes a change to read, never applies it
  fresh()
  const name2 = await learnedSkill(3)
  T.noteTurn(dsh, 'chat-z')
  await set({ mode: 'improve', threshold: 80 })
  writeFileSync(file(name2), readFileSync(file(name2), 'utf8') + '\nThe person added a line.\n')
  const edited = await L.proposeImprove({ dsh, skill: name2, add: 'Round the totals to the nearest ten.', sessionId: 'chat-z' })
  assert.equal(edited.state, 'pending')
  assert.ok(edited.stops.includes('edited_by_you'))
  const accepted = await L.acceptProposal({ dsh, id: edited.id })
  assert.equal(accepted.ok, true, 'the person\'s own Accept applies it')
  assert.ok(readFileSync(file(name2), 'utf8').includes('The person added a line.') && readFileSync(file(name2), 'utf8').includes('- Round the totals'))
  assert.deepEqual([L.readAudit(dsh).entries[0].act, L.readAudit(dsh).entries[0].by], ['improved', 'you'])
  // not a skill Kaby made
  fresh()
  mkdirSync(join(dsh, 'skills', 'mine'), { recursive: true })
  writeFileSync(file('mine'), 'MY OWN')
  assert.equal((await L.proposeImprove({ dsh, skill: 'mine', add: 'Something to add here.', sessionId: 's' })).error, 'not_improvable')
  assert.equal((await L.proposeImprove({ dsh, skill: 'nope', add: 'Something to add here.', sessionId: 's' })).error, 'not_improvable')
  const n3 = await learnedSkill(0)
  assert.equal((await L.proposeImprove({ dsh, skill: n3, add: 'short', sessionId: 's' })).error, 'checks_failed')
  assert.equal((await L.proposeImprove({ dsh, skill: n3, add: 'Write to marie.roux@cabinet.example first.', sessionId: 's' })).state, 'pending', 'client data is a warning outside Law and Health, and it waits')
  ok('a skill the person edited is changed only by their own Accept; a skill Kaby did not make, a missing one and a paragraph that is too short are refused')

  // ── undo, the circuit breaker, the kill switch ────────────────────────────────────────────────────────────────────────────
  fresh()
  const n4 = await learnedSkill(3)
  T.noteTurn(dsh, 'chat-u')
  // 75: after a first undo the person's record is no longer clean (5 points less), and the second change must still clear the line
  await set({ mode: 'improve', threshold: 75 })
  const v1b = readFileSync(file(n4), 'utf8')
  await L.proposeImprove({ dsh, skill: n4, add: 'First addition made on its own.', sessionId: 'chat-u' })
  const v2b = readFileSync(file(n4), 'utf8')
  assert.notEqual(v1b, v2b)
  const u1 = await L.undoAccept({ dsh, name: n4 })
  assert.equal(u1.ok, true)
  assert.equal(readFileSync(file(n4), 'utf8'), v1b, 'Undo puts back the very text of version 1')
  assert.equal((await L.listLearned({ dsh })).learned.find((l) => l.name === n4).ver, 1)
  assert.deepEqual([L.readAudit(dsh).entries[0].act, L.readAudit(dsh).entries[0].note], ['reverted', 'undid_auto'])
  assert.equal(L.getSettings({ dsh }).settings.mode, 'improve', 'one undo does not trip the breaker')
  await L.proposeImprove({ dsh, skill: n4, add: 'Second addition made on its own.', sessionId: 'chat-u' })
  await L.undoAccept({ dsh, name: n4 })
  const settings = L.getSettings({ dsh }).settings
  assert.equal(settings.mode, 'ask', 'two of Kaby\'s own changes undone in a week: back to « Ask me every time »')
  assert.ok(typeof settings.breaker === 'string')
  assert.equal(L.readAudit(dsh).entries[0].act, 'paused')
  assert.equal(L.readAudit(dsh).entries[0].note, 'two_undos')
  assert.equal(L.readAudit(dsh).verified, true)
  assert.equal((await set({ mode: 'improve' })).settings.breaker, null, 'choosing a level again clears the note')
  // an undo of something the person accepted does not count
  fresh()
  const n5 = await learnedSkill(0)
  await set({ mode: 'improve', threshold: 80 })
  assert.equal((await L.undoAccept({ dsh, name: n5 })).ok, true)
  assert.equal(L.readAudit(dsh).entries[0].note, 'taken_back')
  // the file edited since: the undo refuses
  fresh()
  const n6 = await learnedSkill(3)
  T.noteTurn(dsh, 'chat-v')
  await set({ mode: 'improve', threshold: 80 })
  await L.proposeImprove({ dsh, skill: n6, add: 'An addition to be undone later.', sessionId: 'chat-v' })
  writeFileSync(file(n6), readFileSync(file(n6), 'utf8') + 'edited\n')
  assert.equal((await L.undoAccept({ dsh, name: n6 })).error, 'edited_since')
  ok('Undo puts the previous version back; two undos of Kaby\'s own changes in a week send it back to « ask » with a note and a journal line; the person\'s own acceptances do not count; an edited file is never overwritten')

  fresh()
  const k1 = await learnedSkill(3)
  T.noteTurn(dsh, 'chat-k')
  await set({ mode: 'auto', threshold: 80 })
  await L.proposeImprove({ dsh, skill: k1, add: 'An addition the kill switch will take back.', sessionId: 'chat-k' })
  await L.proposeFromAutomation({ ...autoText(), name: 'Auto made', automation: { id: 'ta', name: 'Auto made', runs: 5 } })
  assert.ok(existsSync(file('auto-made')))
  const stop = await L.stopAll({ dsh })
  assert.equal(stop.ok, true)
  assert.equal(stop.undone, 2)
  assert.equal(existsSync(file('auto-made')), false, 'what Kaby created on its own goes')
  assert.equal(existsSync(file(k1)), true, 'what the person accepted stays')
  assert.ok(!readFileSync(file(k1), 'utf8').includes('kill switch'), 'and its improvement is taken back')
  assert.equal(L.getSettings({ dsh }).settings.mode, 'ask')
  assert.equal(L.readAudit(dsh).entries[0].note, 'stopped')
  assert.equal(L.readAudit(dsh).verified, true)
  ok('« Stop and undo the last 7 days »: what Kaby made on its own goes, its improvements are taken back, what the person accepted stays, the level returns to ask')

  // ── use and the chat's view ───────────────────────────────────────────────────────────────────────────────────────────────
  fresh()
  const used = await learnedSkill(0)
  assert.deepEqual(await L.recordUse({ dsh, name: used, sessionId: 's1' }), { ok: true, counted: true, uses: 1 })
  assert.equal((await L.recordUse({ dsh, name: used, sessionId: 's1' })).counted, false, 'one use per chat')
  assert.equal((await L.recordUse({ dsh, name: used, sessionId: 's2' })).uses, 2)
  assert.equal((await L.recordUse({ dsh, name: 'not-learned', sessionId: 's2' })).ok, false)
  assert.equal((await L.recordUse({ dsh, name: used, sessionId: '' })).ok, false)
  const now = Date.now()
  assert.equal((await L.listLearned({ dsh, now })).learned[0].unusedDays, 0)
  assert.ok((await L.listLearned({ dsh, now: now + 45 * DAY })).learned[0].unusedDays >= 44, 'a month without a use is flagged, with the days')
  const view = await L.sessionView({ dsh, sessionId: 's1' })
  assert.deepEqual(view.used.map((x) => x.name), [used])
  assert.deepEqual((await L.sessionView({ dsh, sessionId: 'nobody' })).used, [])
  assert.deepEqual(await L.sessionView({ dsh, sessionId: '' }), { ok: true, suggested: [], applied: [], used: [] })
  ok('the use counter counts one use per chat, only for learned skills, flags a month without use, and the chat can see what it used')

  // ── the agent's two tools ─────────────────────────────────────────────────────────────────────────────────────────────────
  fresh()
  let invalidated = 0
  const deps = { dsh: () => dsh, existing: async () => [], invalidate: () => { invalidated += 1 } }
  const [propose, improve] = A.toolDefinitions(deps)
  assert.deepEqual([propose.name, improve.name], ['skill_propose', 'skill_improve'])
  assert.deepEqual(propose.parameters.required, ['description', 'steps'])
  assert.equal(propose.parameters.additionalProperties, false)
  const exec = (id) => ({ agent: { id, session: { id } } })
  assert.equal(A.sessionOf(exec('abc')), 'abc')
  assert.equal(A.sessionOf({ agent: { id: 'only-id' } }), 'only-id')
  assert.equal(A.sessionOf({}), '')
  assert.equal((await propose.execute({ description: 'x', steps: 'y' }, {})).error, 'no_session')
  T.noteTurn(dsh, 'chat-t')
  const proposed = await propose.execute({ description: 'Gives the weekly figures. Use when the user asks for the weekly figures.', steps: '1. Read the sheet.\n2. Write the summary.' }, exec('chat-t'))
  assert.equal(proposed.ok, true)
  assert.equal(proposed.state, 'pending')
  assert.equal(existsSync(file(proposed.name)), false, 'nothing active by itself')
  const said = propose.output.render({}, proposed)[0].text
  assert.match(said, /waits for the person's yes in Skills/)
  assert.match(said, /NOT active/)
  assert.match(said, /Why it waits: the person's level is « Ask me every time »/)
  assert.equal(invalidated, 0)
  const bad = await propose.execute({ description: 'No trigger sentence here.', steps: 'y' }, exec('chat-t'))
  assert.deepEqual([bad.ok, bad.error, bad.checks], [false, 'checks_failed', ['use_when']])
  assert.match(propose.output.render({}, bad)[0].text, /a check failed.*\(use_when\)/)
  const v = (await L.listLearned({ dsh })).proposals.find((p) => p.kind === 'asked')
  assert.equal(v.source.tainted, false)
  assert.equal(v.score.total, 61 - 5, 'one chat, the agent\'s words, no record yet')
  assert.ok(v.body.startsWith('# ') && v.body.includes('1. Read the sheet.'))
  // an untrusted chat
  T.noteTool(dsh, 'chat-t', 'web_fetch', {})
  const second = await propose.execute({ description: 'Another skill. Use when the user asks for another thing.', steps: '1. Do it.' }, exec('chat-t'))
  assert.ok(second.stops.includes('untrusted'))
  assert.match(propose.output.render({}, second)[0].text, /read content from outside/)
  assert.equal((await improve.execute({ skill: 'nope', addition: 'Add something useful here.' }, exec('chat-t'))).error, 'not_improvable')
  assert.match(improve.output.render({}, { ok: false, error: 'not_improvable' })[0].text, /not made by Kaby/)
  ok('the tools: no session is refused, a suggestion says it is NOT active and why it waits, a failing check says which, an untrusted chat is named, nothing is written by itself')

  // ── what is mounted ───────────────────────────────────────────────────────────────────────────────────────────────────────
  const registered = []; const chunks = []; const handlers = {}
  const ctx = {
    inject (names, fn) { fn({ tools: { register: (t) => registered.push(t.name) }, systemPrompt: { context: (c) => chunks.push(c) } }) },
    on (event, fn) { handlers[event] = fn; return () => { delete handlers[event] } },
    effect (fn) { return fn() }
  }
  A.mountLearned(ctx, deps)
  assert.deepEqual(registered, ['skill_propose', 'skill_improve'])
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0].name, 'kybernos:learned-skills')
  assert.ok(chunks[0].text().includes('skill_propose') && chunks[0].text().includes('Never put in a skill') && chunks[0].text().length < 1100)
  assert.equal(typeof handlers['tools/pre-execute'], 'function')
  assert.equal(typeof handlers['agent/inbox/claimed'], 'function')
  let nexted = 0
  const next = () => { nexted += 1; return 'next-result' }
  handlers['agent/inbox/claimed']({ agent: { session: { id: 'chat-m' } }, message: 'hi' })
  assert.equal(T.sourceOf(dsh, 'chat-m').tracked, true, 'a turn began: the chat is followed')
  assert.equal(await handlers['tools/pre-execute']({ name: 'read', arguments: {}, agent: { id: 'chat-m' } }, next), 'next-result')
  assert.equal(T.sourceOf(dsh, 'chat-m').tainted, false)
  assert.equal(await handlers['tools/pre-execute']({ name: 'web_search', arguments: { q: 'x' }, agent: { id: 'chat-m' } }, next), 'next-result', 'a call is never blocked')
  assert.equal(T.sourceOf(dsh, 'chat-m').tainted, true)
  assert.equal(nexted, 2)
  const sk = await learnedSkill(0)
  await handlers['tools/pre-execute']({ name: 'skill', arguments: { name: sk }, agent: { id: 'chat-m' } }, next)
  await new Promise((r) => setTimeout(r, 120))
  assert.equal((await L.listLearned({ dsh })).learned.find((l) => l.name === sk).uses, 1, 'loading a learned skill counts as a use')
  await handlers['tools/pre-execute'](null, next)
  await handlers['tools/pre-execute']({ name: 'skill', arguments: null, agent: null }, next)
  const bare = {}
  A.mountLearned({ inject () { throw new Error('no seam') } }, deps, () => {})
  A.mountLearned(bare, deps)
  ok('mounted: two tools, one short prompt chunk, a tool watcher that never blocks and counts a loaded learned skill, a turn watcher; a missing seam drops that part only')

  // ── the journal keeps its chain with the new lines, and the lines of V0 still verify ──────────────────────────────────────
  assert.equal(L.readAudit(dsh).verified, true)
  fresh()
  mkdirSync(join(dsh, 'kybernos'), { recursive: true })
  const crypto = await import('node:crypto')
  const sha = (t) => crypto.createHash('sha256').update(t).digest('hex')
  const e = { n: 1, t: '2026-10-21T10:00:00.000Z', act: 'accepted', skill: 'old', by: 'you', mode: 'approved', kind: 'lessons', ver: 1, from: null, note: null }
  e.prev = '0'.repeat(64)
  e.hash = sha(e.prev + '\n' + JSON.stringify([e.n, e.t, e.act, e.skill, e.by, e.mode, e.kind, e.ver, e.from, e.note]))
  writeFileSync(L.auditPath(dsh), JSON.stringify(e) + '\n')
  L.appendAudit(dsh, { act: 'created', skill: 'new', by: 'kaby', mode: 'auto', kind: 'auto', ver: 1, score: 91, sig: [['evidence', 30]] })
  const chain = L.readAudit(dsh)
  assert.equal(chain.verified, true, 'a line written before scores existed still verifies, and the next one chains onto it')
  assert.equal(chain.entries[0].score, 91)
  const lines = readFileSync(L.auditPath(dsh), 'utf8').split('\n').filter((l) => l !== '')
  writeFileSync(L.auditPath(dsh), [lines[0], lines[1].replace('"score":91', '"score":99')].join('\n') + '\n')
  assert.equal(L.readAudit(dsh).verified, false, 'a score edited after the fact shows')
  ok('the journal chain covers the score and its parts; the lines written before them still verify')

  // ── the routes ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  fresh()
  const { apply } = await import('./index.js')
  const routes = {}
  const webServer = { register: (r) => { routes[r.path] = r.handler; return () => { delete routes[r.path] } } }
  const registry = { async snapshot () { return { complete: true, skills: [] } }, invalidateCache () { registry.invalidated = (registry.invalidated || 0) + 1 } }
  apply({ inject (_deps, fn) { fn({ get: (n) => (n === 'webServer' ? webServer : n === 'skills' ? registry : undefined), effect: (f) => f() }) } })
  const PORT = 3080
  const request = (method, body, origin, url) => ({ method, headers: origin === null ? {} : { origin }, socket: { localPort: PORT }, url: url || '/', async * [Symbol.asyncIterator] () { if (body !== undefined) yield Buffer.from(JSON.stringify(body)) } })
  const call = async (method, path, body, origin = 'http://127.0.0.1:' + PORT, url) => { const res = { code: null, body: null, writeHead (c) { res.code = c }, end (t) { try { res.body = JSON.parse(t) } catch (e2) { res.body = t } } }; await routes['/kybernos-skills/' + path](request(method, body, origin, url), res); return res }
  for (const pth of ['learned/settings/set', 'learned/keep', 'learned/stop']) {
    assert.equal((await call('POST', pth, {}, null)).code, 403, pth + ' refuses a call with no origin')
    assert.equal((await call('POST', pth, {}, 'https://evil.example')).code, 403, pth + ' refuses a foreign origin')
  }
  assert.equal((await call('GET', 'learned/settings')).body.settings.mode, 'ask')
  assert.equal((await call('POST', 'learned/settings/set', { mode: 'auto', threshold: 85, sessionId: 'ignored' })).body.settings.threshold, 85)
  assert.equal((await call('POST', 'learned/settings/set', { mode: 'sudo' })).body.error, 'bad_settings')
  assert.equal((await call('POST', 'learned/settings/set', null)).body.error, 'bad_settings')
  const lg = await call('GET', 'learned')
  assert.equal(lg.body.settings.mode, 'auto')
  assert.deepEqual(lg.body.week, { used: 0, cap: 3 })
  assert.equal((await call('GET', 'learned/session', undefined, undefined, '/?sessionId=zzz')).body.ok, true)
  assert.equal((await call('POST', 'learned/keep', { name: 'nope' })).body.error, 'not_found')
  const before = registry.invalidated || 0
  assert.equal((await call('POST', 'learned/stop', {})).body.ok, true)
  assert.equal(registry.invalidated, before + 1)
  assert.equal((await call('GET', 'learned/settings')).body.settings.mode, 'ask', 'Stop returns the level to ask')
  ok('the routes: settings read and set (strict, the page cannot name the breaker), the chat\'s view, Keep, Stop; every POST keeps the origin guard')
  console.log('\n' + String(pass) + ' checks passed')
} catch (e) {
  console.error('\n✗ ' + (e && e.stack ? e.stack : String(e)))
  process.exitCode = 1
} finally {
  rmSync(base, { recursive: true, force: true })
}
