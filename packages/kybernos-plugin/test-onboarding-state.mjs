// The first-run onboarding state: what a fresh install holds, what completing records,
// and, above all, that an older file keeps meaning « done » (no wizard for existing users).
//
//   node packages/kybernos-plugin/test-onboarding-state.mjs
import assert from 'node:assert/strict'
import { ONBOARDING_VERSION, MODEL_CHOICES, GOALS_MAX, defaultState, publicView, complete, replay, chooseDomain } from './onboarding-state.mjs'

const NOW = new Date('2026-10-10T09:00:00.000Z')
let count = 0
const ok = (label, fn) => { fn(); count++; console.log('ok  ', label) }

ok('a fresh install is not completed and carries no answer', () => {
  const s = defaultState(NOW)
  assert.equal(s.completed, false)
  assert.equal(s.version, ONBOARDING_VERSION)
  assert.equal(s.installedAt, NOW.toISOString())
  assert.deepEqual([s.profil, s.uiMode, s.model, s.lang, s.completedAt], [null, null, null, null, null])
  assert.equal(publicView(s).completed, false)
})

ok('the version did not move: existing users stay done', () => {
  assert.equal(ONBOARDING_VERSION, 1)
  // The real file of an existing install, written before `model` and `lang` existed.
  const old = { version: 1, completed: true, installedAt: '2026-09-27T22:28:33.901Z', completedAt: '2026-10-04T11:57:38.023Z', profil: 'produit', uiMode: null }
  const view = publicView(old)
  assert.equal(view.completed, true)
  assert.equal(view.profil, 'produit')
  assert.equal(view.model, null)
  assert.equal(view.lang, null)
})

ok('a file from a newer wizard version reopens it', () => {
  assert.equal(publicView({ version: 2, completed: true }).completed, false)
})

ok('completing records the four answers and stamps the date', () => {
  const s = complete(defaultState(NOW), { profil: 'soft', uiMode: 'bureau', model: 'cloud', lang: 'fr' }, NOW)
  assert.equal(s.completed, true)
  assert.equal(s.completedAt, NOW.toISOString())
  assert.deepEqual([s.profil, s.uiMode, s.model, s.lang], ['soft', 'bureau', 'cloud', 'fr'])
  assert.equal(s.installedAt, NOW.toISOString(), 'the install date is kept')
})

ok('leaving everything blank still completes (the wizard can be skipped)', () => {
  const s = complete(defaultState(NOW), {}, NOW)
  assert.equal(s.completed, true)
  assert.deepEqual([s.profil, s.uiMode, s.model, s.lang], [null, null, null, null])
  assert.equal(complete(defaultState(NOW), null, NOW).completed, true)
})

ok('the goals ticked are kept as valid ids, once each, bounded', () => {
  assert.deepEqual(defaultState(NOW).goals, [])
  const s = complete(defaultState(NOW), { profil: 'sante', goals: ['notes', 'notes', 'Bad Id', '', 7, null, 'appointments'] }, NOW)
  assert.deepEqual(s.goals, ['notes', 'appointments'])
  assert.deepEqual(complete(defaultState(NOW), { goals: 'notes' }, NOW).goals, [])
  const many = Array.from({ length: GOALS_MAX + 5 }, (_, i) => 'goal-' + i)
  assert.equal(complete(defaultState(NOW), { goals: many }, NOW).goals.length, GOALS_MAX)
})

ok('a client that sends no goals keeps the saved ones; one that sends an empty list clears them', () => {
  const saved = complete(defaultState(NOW), { profil: 'edu', goals: ['exams'] }, NOW)
  assert.deepEqual(complete(saved, { profil: 'edu' }, NOW).goals, ['exams'])
  assert.deepEqual(complete(saved, { profil: 'edu', goals: [] }, NOW).goals, [])
})

ok('an older file (no goals) reads as no goals, and still means done', () => {
  const old = { version: 1, completed: true, installedAt: 'x', completedAt: 'y', profil: 'produit', uiMode: null }
  assert.deepEqual(publicView(old).goals, [])
  assert.equal(publicView(old).completed, true)
})

ok('choosing a domain later moves the domain and the goals and nothing else', () => {
  const done = complete(defaultState(NOW), { profil: 'soft', uiMode: 'code', model: 'cloud', lang: 'fr', memoryId: 'm1' }, NOW)
  const next = chooseDomain(done, { profil: 'sante', goals: ['notes'] })
  assert.deepEqual([next.profil, next.goals], ['sante', ['notes']])
  assert.deepEqual([next.completed, next.completedAt, next.uiMode, next.model, next.lang, next.memoryId, next.installedAt],
    [done.completed, done.completedAt, done.uiMode, done.model, done.lang, done.memoryId, done.installedAt])
  assert.equal(chooseDomain(defaultState(NOW), { profil: 'sante' }).completed, false, 'it never completes the wizard')
  assert.deepEqual([chooseDomain(done, null).profil, chooseDomain(done, null).goals], [null, []])
})

ok('only the known model choices are kept', () => {
  for (const choice of MODEL_CHOICES) assert.equal(complete(defaultState(NOW), { model: choice }, NOW).model, choice)
  for (const bad of ['', 'gpt', 'CLOUD', 7, null, {}]) assert.equal(complete(defaultState(NOW), { model: bad }, NOW).model, null)
})

ok('a language tag is kept only when it is one', () => {
  for (const good of ['en', 'fr', 'ar', 'pt-BR', 'zh-Hans']) assert.equal(complete(defaultState(NOW), { lang: good }, NOW).lang, good)
  for (const bad of ['', 'English', 'e', 'en_US', '../etc', 'a'.repeat(20), 3]) assert.equal(complete(defaultState(NOW), { lang: bad }, NOW).lang, null)
})

ok('free text is trimmed and cut at 60 characters, never stored as a non-string', () => {
  assert.equal(complete(defaultState(NOW), { profil: '  soft  ' }, NOW).profil, 'soft')
  assert.equal(Array.from(complete(defaultState(NOW), { profil: 'x'.repeat(200) }, NOW).profil).length, 60)
  assert.equal(complete(defaultState(NOW), { profil: 42, uiMode: { a: 1 } }, NOW).profil, null)
  assert.equal(complete(defaultState(NOW), { uiMode: '   ' }, NOW).uiMode, null)
})

ok('replay reopens the wizard and keeps the old answers', () => {
  const done = complete(defaultState(NOW), { profil: 'legal', uiMode: 'code', model: 'key', lang: 'es' }, NOW)
  const again = replay(done)
  assert.equal(again.completed, false)
  assert.equal(again.completedAt, null)
  assert.deepEqual([again.profil, again.uiMode, again.model, again.lang], ['legal', 'code', 'key', 'es'])
  assert.equal(publicView(again).completed, false)
})

ok('the public view never leaks a value outside the vocabulary', () => {
  const view = publicView({ version: 1, completed: true, model: 'something', lang: 'xx yy' })
  assert.equal(view.model, null)
  assert.equal(view.lang, null)
})

ok('the memory id is kept across a replay, and only an opaque printable id is accepted', () => {
  const first = complete(defaultState(NOW), { profil: 'etudes', memoryId: 'mem_01HZX' }, NOW)
  assert.equal(first.memoryId, 'mem_01HZX')
  assert.equal(publicView(first).memoryId, 'mem_01HZX')
  const again = complete(replay(first), { profil: 'soft' }, NOW)
  assert.equal(again.memoryId, 'mem_01HZX', 'a replay that wrote nothing keeps the id: the next write updates that memory')
  assert.equal(complete(again, { memoryId: 'mem_NEW' }, NOW).memoryId, 'mem_NEW')
  for (const bad of ['', '  ', 'has space', 'x\ny', 12, {}, null]) assert.equal(complete(defaultState(NOW), { memoryId: bad }, NOW).memoryId, null)
  assert.equal(defaultState(NOW).memoryId, null)
})

console.log(count + ' checks passed')
