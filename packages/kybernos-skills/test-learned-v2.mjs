#!/usr/bin/env node
/** Skills learned from experience, V2, host half: the settings of what Kaby notices and tells, the rule-based detector of a task that comes back, the notice and its
 *  rate limits, the repeats as evidence in the score, the weekly card, « ready to share », and the routes.
 *
 *  Everything runs on a throw-away DSH home with a fake chat index: nothing reaches the network, the user's home or a model.
 *
 *  Usage: node packages/kybernos-skills/test-learned-v2.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionSource } from './session-guard.mjs'
import { SESSION_SECRET, sessionCookie } from './lib-session-test.mjs'

// The POST routes need the signed session as well as the Origin (L3-17): the Skills page's own request carries both.
sessionSource.secret = () => SESSION_SECRET

const base = mkdtempSync(join(tmpdir(), 'kb-learned-v2-'))
const dsh = join(base, '.dsh')
process.env.HOME = base
process.env.DSH_HOME = dsh
let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const L = await import('./learned.mjs')
const S = await import('./learned-settings.mjs')
const R = await import('./learned-repeat.mjs')
const W = await import('./learned-week.mjs')
const SC = await import('./learned-score.mjs')
const DAY = 24 * 3600 * 1000
const NOW = Date.parse('2026-10-21T10:00:00.000Z')
const fresh = () => { rmSync(dsh, { recursive: true, force: true }); mkdirSync(join(dsh, 'skills'), { recursive: true }); R.forgetCache(); delete globalThis[R.SEAM] }
const at = (daysAgo) => NOW - daysAgo * DAY
const ask = (id, daysAgo, text, cwd) => ({ id, at: at(daysAgo), text: text || 'Write the release notes from the commits since the last tag, grouped by feature.', cwd: cwd || '/work/app' })
const seam = (asks) => { globalThis[R.SEAM] = Object.freeze({ version: 1, asks: (since) => asks.filter((a) => a.at >= since), refresh: async () => { seam.refreshed = (seam.refreshed || 0) + 1 } }) }
const FOUR = () => [ask('c1', 18), ask('c2', 12, 'Write release notes from the commits since the last tag, group them by feature.'), ask('c3', 7, 'Please write the release notes from the commits since last tag, grouped by feature'), ask('c4', 0.1, 'Release notes from the commits since the last tag, grouped by feature, please.')]
const settings = (over) => ({ ...S.defaults(), ...(over || {}) })

try {
  console.log('kybernos-skills — learned skills V2, host half')

  // ── settings ─────────────────────────────────────────────────────────────────────────────────
  fresh()
  const d = S.defaults()
  assert.deepEqual([d.notice, d.minRep, d.win, d.week, d.team, d.teamMin, d.teamPriv], [true, 3, 60, true, true, 3, false])
  assert.equal(S.apply(d, { minRep: 4, win: 90, teamMin: 5, week: false, notice: false, team: false, teamPriv: true }).ok, true)
  for (const bad of [{ minRep: 2 }, { win: 45 }, { teamMin: 4 }, { week: 'yes' }, { notice: 1 }, { teamPriv: null }]) assert.equal(S.apply(d, bad).error, 'bad_settings', JSON.stringify(bad))
  assert.deepEqual(S.normalize({ minRep: 9, win: 1, teamMin: 'x', week: 'no' }), S.defaults(), 'wrong values read as their defaults')
  assert.equal((await L.patchSettings({ dsh, patch: { minRep: 5, sessionId: 'x' } })).ok, false, 'an unknown key refuses the whole patch')
  assert.equal((await L.patchSettings({ dsh, patch: { minRep: 5 } })).settings.minRep, 5)
  assert.equal(L.readSettings(dsh).minRep, 5)
  ok('the V2 settings: defaults, strict values, saved')

  // ── the detector ─────────────────────────────────────────────────────────────────────────────
  assert.equal(R.tokensOf('x'.repeat(401)), null, 'a brief of more than 400 characters is not an ask')
  assert.equal(R.tokensOf('ok merci'), null, 'too few words')
  assert.equal(R.tokensOf('Fix /srv/project/src/app.js https://example.com/a/b 12345 the'), null, 'paths, urls, numbers and common words are not words')
  const t1 = R.tokensOf('Rédige les notes de version depuis les commits groupées par fonctionnalité')
  assert.ok(t1.has('notes') && t1.has('version') && t1.has('commits') && !t1.has('les'), 'accents folded, common words dropped')
  const found = R.findPatterns(FOUR(), { minRep: 3, windowDays: 60, now: NOW })
  assert.equal(found.length, 1)
  assert.equal(found[0].n, 4)
  assert.equal(found[0].days.length, 4)
  assert.deepEqual(found[0].members, ['c1', 'c2', 'c3', 'c4'], 'oldest first, so the last one is the newest')
  assert.equal(found[0].anchor, 'c1')
  assert.ok(/^r_[0-9a-f]{8}$/.test(found[0].id))
  assert.equal(R.findPatterns(FOUR(), { minRep: 3, windowDays: 60, now: NOW })[0].id, found[0].id, 'the id is stable')
  assert.equal(R.findPatterns(FOUR(), { minRep: 5, windowDays: 60, now: NOW }).length, 0, 'under the number the person chose')
  assert.equal(R.findPatterns(FOUR(), { minRep: 3, windowDays: 30, now: NOW }).length, 1)
  assert.equal(R.findPatterns(FOUR().slice(0, 2), { minRep: 3, windowDays: 60, now: NOW }).length, 0)
  const sameDay = FOUR().map((a, i) => ({ ...a, at: at(2) + i * 60000 }))
  assert.equal(R.findPatterns(sameDay, { minRep: 3, windowDays: 60, now: NOW }).length, 0, 'four asks in one day is one burst, not a habit')
  const mixed = [...FOUR(), ask('x1', 3, 'Summarise the quarterly sales meeting for the finance team tomorrow'), ask('x2', 5, 'Compare these two clauses of the contract and list the differences'), ask('b1', 4, 'z'.repeat(500)), ask('a1', 2, undefined, '/home/u/.dsh/kybernos/automations/nightly'), ask('t1', 2, undefined, '/home/u/.dsh/telegram-bridge/workspaces/1')]
  const m = R.findPatterns(mixed, { minRep: 3, windowDays: 60, now: NOW })
  assert.equal(m.length, 1)
  assert.deepEqual(m[0].members, ['c1', 'c2', 'c3', 'c4'], 'unrelated asks, briefs, automation and phone chats are left out')
  assert.equal(R.findPatterns(FOUR().map((a) => ({ ...a, at: at(200) })), { minRep: 3, windowDays: 60, now: NOW }).length, 0, 'outside the window')
  ok('the detector: short asks, alike by words, on different days; briefs, automation and phone chats left out; stable id')

  // ── the notice and its rate limits ───────────────────────────────────────────────────────────
  fresh()
  const on = settings()
  assert.equal((await R.noticeFor({ dsh, sessionId: 'c4', settings: on, sensitive: false, now: NOW })).why, 'no_index', 'no Search everywhere, no notice')
  seam(FOUR())
  assert.equal((await R.noticeFor({ dsh, sessionId: 'c4', settings: settings({ notice: false }), sensitive: false, now: NOW })).why, 'off')
  assert.equal((await R.noticeFor({ dsh, sessionId: 'c2', settings: on, sensitive: false, now: NOW })).why, 'not_newest', 'only the chat that makes the pattern')
  assert.equal((await R.noticeFor({ dsh, sessionId: 'nope', settings: on, sensitive: false, now: NOW })).why, 'not_indexed')
  const n1 = await R.noticeFor({ dsh, sessionId: 'c4', settings: on, sensitive: false, now: NOW })
  assert.equal(n1.ok, true)
  assert.equal(n1.notice.n, 4)
  assert.equal(n1.notice.dates.length, 4)
  assert.ok(typeof n1.notice.label === 'string' && n1.notice.label.split(' ').length === 3, 'three words name the topic outside Law and Health')
  assert.equal(R.readState(dsh).shown.length, 1)
  const again = await R.noticeFor({ dsh, sessionId: 'c4', settings: on, sensitive: false, now: NOW + 60000 })
  assert.equal(again.notice.id, n1.notice.id, 'the same chat gets the same notice')
  assert.equal(R.readState(dsh).shown.length, 1, 'and it counts once')
  assert.ok(seam.refreshed >= 1, 'the chat index is refreshed before it is read')
  // one a day
  const more = [...FOUR(), ask('c5', 0, 'Release notes from the commits since the last tag grouped by feature again')]
  seam(more)
  R.forgetCache()
  assert.equal((await R.noticeFor({ dsh, sessionId: 'c5', settings: on, sensitive: false, now: NOW + 3600000 })).why, 'today')
  // the answers
  assert.equal((await R.answerNotice({ dsh, id: n1.notice.id, answer: 'later', now: NOW + 3600000 })).state, 'later')
  assert.equal((await R.answerNotice({ dsh, id: 'r_00000000', answer: 'later' })).error, 'not_found')
  assert.equal((await R.answerNotice({ dsh, id: n1.notice.id, answer: 'maybe' })).error, 'bad_answer')
  const n2 = await R.noticeFor({ dsh, sessionId: 'c5', settings: on, sensitive: false, now: NOW + 2 * DAY })
  assert.equal(n2.notice.n, 5, 'a day later it may speak again (one « Not now »)')
  await R.answerNotice({ dsh, id: n2.notice.id, answer: 'later', now: NOW + 2 * DAY })
  assert.equal(R.readState(dsh).streak, 2)
  const more2 = [...more, ask('c6', -3.9, 'Release notes from the commits since the last tag grouped by feature once more')]
  seam(more2)
  R.forgetCache()
  assert.equal((await R.noticeFor({ dsh, sessionId: 'c6', settings: on, sensitive: false, now: NOW + 4 * DAY })).why, 'week', 'two « Not now » in a row: once a week')
  seam([...more2, ask('c7', -9.9, 'Release notes from the commits since the last tag grouped by feature, seventh time')])
  R.forgetCache()
  assert.ok((await R.noticeFor({ dsh, sessionId: 'c7', settings: on, sensitive: false, now: NOW + 10 * DAY })).notice !== null, 'after a week it may speak again')
  // never, and forget
  const id = R.readState(dsh).current.pid
  assert.equal((await R.answerNotice({ dsh, id, answer: 'never' })).state, 'never')
  assert.equal((await R.noticeFor({ dsh, sessionId: 'c7', settings: on, sensitive: false, now: NOW + 10 * DAY + 3600000 })).why, 'never')
  assert.equal(R.listNotices({ dsh, sensitive: false }).patterns[0].state, 'never')
  assert.equal((await R.forgetNotice({ dsh, id })).ok, true)
  assert.equal(R.listNotices({ dsh, sensitive: false }).patterns.length, 0)
  ok('the notice: only for the newest chat of a pattern, once a day, a week after two « Not now », never when refused, forgotten on request')

  // ── Law and Health keep no word ──────────────────────────────────────────────────────────────
  fresh()
  seam(FOUR())
  const priv = await R.noticeFor({ dsh, sessionId: 'c4', settings: on, sensitive: true, now: NOW })
  assert.equal(priv.notice.label, null)
  const stored = readFileSync(R.noticesPath(dsh), 'utf8')
  assert.ok(!/release|notes|commits/i.test(stored), 'no word of the chats is on disk: ' + stored)
  assert.equal(R.listNotices({ dsh, sensitive: true }).patterns.length, 0)
  await R.answerNotice({ dsh, id: priv.notice.id, answer: 'yes' })
  assert.equal(R.listNotices({ dsh, sensitive: true }).patterns[0].label, null)
  ok('Law and Health: the notice names no topic and the file holds numbers and dates only')

  // ── repeats as evidence ──────────────────────────────────────────────────────────────────────
  fresh()
  seam(FOUR())
  const info = await R.repeatInfo({ sessionId: 'c4', now: NOW })
  assert.equal(info.n, 4)
  assert.equal(await R.repeatInfo({ sessionId: 'c2', now: NOW }), null, 'only for the chat that makes the pattern')
  const sc = (extra) => SC.scoreOf({ kind: 'asked', verifiedLessons: 0, from: {}, description: 'Use when asked.', body: '# x', ...extra }, { checks: { list: [{ id: 'size', s: 'ok' }], hits: [], blocking: false }, record: true })
  assert.equal(sc({ repeats: 0 }).signals[0].v, 11)
  assert.equal(sc({ repeats: 2 }).signals[0].v, 33)
  assert.equal(sc({ repeats: 3 }).signals[0].v, 35, 'capped at the 35 of « what it came from »')
  assert.equal(sc({ repeats: 3 }).total, 35 + 10 + 15 + 10 + 10 + 5, 'the most an agent-written skill reaches is 85')
  const done = await L.proposeFromAsked({ dsh, name: 'release-notes', description: 'Writes release notes from the commits. Use when asked for release notes.', steps: '1. Read the commits.\n2. Group them by feature.', sessionId: 'c4', repeats: info.n - 1, repeatDates: info.dates })
  assert.equal(done.ok, true)
  assert.equal(done.state, 'pending')
  const listed = await L.listLearned({ dsh })
  const p = listed.proposals[0]
  assert.equal(p.from.repeats.n, 4)
  assert.equal(p.from.repeats.dates.length, 4)
  assert.equal(p.score.signals[0].v, 35, 'the repeats the host verified are counted')
  assert.ok(p.stops.includes('asks') && p.stops.includes('untrusted'), 'and every hard stop of V1 still applies')
  ok('repeats are evidence: 11 each, capped at 35, 85 at most, and the proposal says how many chats and when')

  // ── share-ready, Keep on an unused skill, shared ─────────────────────────────────────────────
  fresh()
  const mk = async (name, uses, daysAgo) => {
    const made = await L.proposeFromAutomation({ dsh, name, description: 'Does a thing. Use when asked for ' + name + '.', whenToUse: '', body: '# ' + name + '\n\nRead the files.', automation: { id: 't-' + name, runs: 5 }, acceptNow: true, now: NOW - 40 * DAY })
    assert.equal(made.ok, true, JSON.stringify(made))
    for (let i = 0; i < uses; i += 1) await L.recordUse({ dsh, name: made.name, sessionId: name + '-chat-' + String(i), now: NOW - daysAgo * DAY + i * 1000 })
    return made.name
  }
  const used = await mk('weekly-report', 3, 2)
  const few = await mk('rarely-used', 1, 2)
  const old = await mk('forgotten-one', 1, 41)
  let lst = await L.listLearned({ dsh, now: NOW })
  const by = (n) => lst.learned.find((x) => x.name === n)
  assert.deepEqual([by(used).shareReady, by(used).chats, by(few).shareReady], [true, 3, false])
  assert.equal(by(old).unusedDays >= 30, true)
  await L.patchSettings({ dsh, patch: { teamMin: 5 } })
  assert.equal((await L.listLearned({ dsh, now: NOW })).learned.find((x) => x.name === used).shareReady, false, 'the person\'s threshold')
  await L.patchSettings({ dsh, patch: { teamMin: 3, team: false } })
  assert.equal((await L.listLearned({ dsh, now: NOW })).learned.find((x) => x.name === used).shareReady, false, 'switched off')
  await L.patchSettings({ dsh, patch: { team: true } })
  assert.equal((await L.markShared({ dsh, name: used })).ok, true)
  assert.equal((await L.markShared({ dsh, name: 'nope' })).error, 'not_found')
  lst = await L.listLearned({ dsh, now: NOW })
  assert.deepEqual([by(used).shared, lst.learned.find((x) => x.name === used).shareReady], [true, false])
  const journal = L.readAudit(dsh).entries
  assert.equal(journal.filter((e) => e.act === 'shared' && e.skill === used).length, 1, 'once in the journal, however many times it is asked')
  assert.equal(L.readAudit(dsh).verified, true)
  const kept = await L.keepChange({ dsh, name: old, now: NOW })
  assert.equal(kept.ok, true)
  assert.equal((await L.listLearned({ dsh, now: NOW })).learned.find((x) => x.name === old).unusedDays, 0, 'Keep starts the clock over')
  assert.ok(L.readAudit(dsh).entries.some((e) => e.act === 'reviewed' && e.note === 'kept_unused'))
  // Law and Health: no hint until the person unlocks it
  mkdirSync(join(dsh, 'kybernos'), { recursive: true })
  writeFileSync(join(dsh, 'kybernos', 'onboarding.json'), JSON.stringify({ profil: 'droit' }))
  const other = await mk('court-letter', 3, 2)
  assert.equal((await L.listLearned({ dsh, now: NOW })).learned.find((x) => x.name === other).shareReady, false, 'Law: stays on this computer')
  await L.patchSettings({ dsh, patch: { teamPriv: true } })
  assert.equal((await L.listLearned({ dsh, now: NOW })).learned.find((x) => x.name === other).shareReady, true, 'unlocked')
  ok('ready to share: used in enough chats, the person\'s threshold and switch, once proposed it stops (and is journaled); Keep renews an unused skill; Law and Health need the unlock')

  // ── the weekly card ──────────────────────────────────────────────────────────────────────────
  fresh()
  assert.equal((await W.weekView({ dsh, sessionId: 'home-1', now: NOW })).why, 'quiet', 'nothing happened, no card')
  const a = await mk('weekly-report', 3, 2)
  await mk('forgotten-one', 1, 41)
  L.appendAudit(dsh, { act: 'created', skill: 'auto-made', by: 'kaby', mode: 'auto', kind: 'auto', ver: 1, score: 91, sig: [] }, NOW - DAY)
  const w = await W.weekView({ dsh, sessionId: 'home-1', now: NOW })
  assert.equal(w.show, true)
  assert.equal(w.week, W.weekKey(NOW))
  assert.deepEqual([w.used, w.usedSkills, w.auto.created, w.auto.improved], [3, 1, 1, 0])
  assert.equal(w.top.name, a)
  assert.equal(w.stale[0].name, 'forgotten-one')
  assert.equal(w.ready[0].name, a)
  assert.equal(w.waiting, 0)
  assert.equal((await W.weekView({ dsh, sessionId: 'home-1', now: NOW + 60000 })).show, true, 'the chat that has it keeps it')
  assert.equal((await W.weekView({ dsh, sessionId: 'home-2', now: NOW + 60000 })).why, 'shown_elsewhere', 'another blank chat of the same week does not repeat it')
  assert.equal((await W.weekView({ dsh, sessionId: 'home-2', now: NOW + 7 * DAY })).show, true, 'next week it is back')
  await W.hideWeek({ dsh, now: NOW + 7 * DAY })
  assert.equal((await W.weekView({ dsh, sessionId: 'home-2', now: NOW + 7 * DAY + 1000 })).why, 'hidden')
  await L.patchSettings({ dsh, patch: { week: false } })
  assert.equal((await W.weekView({ dsh, sessionId: 'home-3', now: NOW + 14 * DAY })).why, 'off')
  await L.patchSettings({ dsh, patch: { week: true, notify: 'chat' } })
  assert.equal((await W.weekView({ dsh, sessionId: 'home-3', now: NOW + 14 * DAY })).why, 'off', '« in chat only » means no card')
  ok('the weekly card: only when something happened, once a week in the first blank chat that has it, hideable, off by the person\'s settings')

  // ── the routes ───────────────────────────────────────────────────────────────────────────────
  fresh()
  seam(FOUR())
  const { apply } = await import('./index.js')
  const routes = {}
  const webServer = { register: (r) => { routes[r.path] = r.handler; return () => { delete routes[r.path] } } }
  const registry = { async snapshot () { return { complete: true, skills: [] } }, invalidateCache () {} }
  apply({ inject (_deps, fn) { fn({ get: (n) => (n === 'webServer' ? webServer : n === 'skills' ? registry : undefined), effect: (f) => f() }) } })
  const PORT = 3080
  const request = (method, body, origin, url) => ({ method, headers: origin === null ? {} : { origin, cookie: sessionCookie('127.0.0.1:' + PORT) }, socket: { localPort: PORT }, url: url || '/', async * [Symbol.asyncIterator] () { if (body !== undefined) yield Buffer.from(JSON.stringify(body)) } })
  const call = async (method, path, body, origin = 'http://127.0.0.1:' + PORT, url) => { const res = { code: null, body: null, writeHead (c) { res.code = c }, end (t) { try { res.body = JSON.parse(t) } catch (e2) { res.body = t } } }; await routes['/kybernos-skills/' + path](request(method, body, origin, url), res); return res }
  for (const pth of ['learned/notice/answer', 'learned/notice/forget', 'learned/week/hide', 'learned/shared']) {
    assert.equal((await call('POST', pth, {}, null)).code, 403, pth + ' refuses a call with no origin')
    assert.equal((await call('POST', pth, {}, 'https://evil.example')).code, 403, pth + ' refuses a foreign origin')
  }
  // the chats of the fake index are dated around NOW: the routes run on the real clock, so the chat that makes the pattern is « now »
  const nowAsks = [ask('r1', 18), ask('r2', 12), ask('r3', 7), ask('r4', 0)].map((x, i) => ({ ...x, at: Date.now() - [18, 12, 7, 0][i] * DAY - 1000, text: FOUR()[i].text }))
  seam(nowAsks)
  const g = await call('GET', 'learned/notice', undefined, undefined, '/?sessionId=r4')
  assert.equal(g.body.ok, true)
  assert.equal(g.body.notice.n, 4)
  assert.equal((await call('GET', 'learned/notice', undefined, undefined, '/?sessionId=r1')).body.notice, null)
  assert.equal((await call('POST', 'learned/notice/answer', { id: g.body.notice.id, answer: 'never' })).body.state, 'never')
  assert.equal((await call('GET', 'learned/notice/list')).body.patterns[0].state, 'never')
  assert.equal((await call('POST', 'learned/notice/forget', { id: g.body.notice.id })).body.ok, true)
  assert.equal((await call('GET', 'learned/week', undefined, undefined, '/?sessionId=h1')).body.show, false, 'a fresh home: nothing to say')
  assert.equal((await call('POST', 'learned/week/hide', {})).body.ok, true)
  assert.equal((await call('POST', 'learned/shared', { name: 'nope' })).body.error, 'not_found')
  assert.equal((await call('POST', 'learned/settings/set', { minRep: 4, win: 30 })).body.settings.minRep, 4)
  assert.equal((await call('GET', 'learned')).body.settings.win, 30, 'GET learned carries the V2 settings')
  ok('the routes: notice, answer, list, forget, week, hide, shared, settings; every POST keeps the origin guard')
} catch (e) {
  console.log('\n✗ ' + String((e && e.stack) || e).slice(0, 1800))
  rmSync(base, { recursive: true, force: true })
  process.exit(1)
}
rmSync(base, { recursive: true, force: true })
console.log('\n' + String(pass) + ' checks passed')
process.exit(0)
