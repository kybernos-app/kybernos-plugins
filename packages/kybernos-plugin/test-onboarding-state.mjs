// The first-run onboarding state: what a fresh install holds, what completing records,
// and, above all, that an older file keeps meaning « done » (no wizard for existing users).
//
//   node packages/kybernos-plugin/test-onboarding-state.mjs
import assert from 'node:assert/strict'
import { ONBOARDING_VERSION, MODEL_CHOICES, defaultState, publicView, complete, replay } from './onboarding-state.mjs'

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

console.log(count + ' checks passed')
