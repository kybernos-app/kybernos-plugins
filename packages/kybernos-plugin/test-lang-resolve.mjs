#!/usr/bin/env node
// Which language the Kybernos labels (Settings nav, pages) are drawn in: kbLangActive / kbLangResolve
// of client.js, cut out and run against a fake window and a fake storage. No browser.
//
//   node packages/kybernos-plugin/test-lang-resolve.mjs
//
// Pinned here because a live check once read « French labels after es -> en » as a bug: the trip
// never left English and its « restore English » pressed « Use » on French, which is an EXPLICIT
// Kybernos choice (kybernos.theme.lang = 'kybernos'). The rule that follows is what these cases
// state: an explicit choice is obeyed; only the DEFAULT « kybernos » yields to an English shell.
import { readFileSync } from 'node:fs'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const SRC = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
const cut = (from, to) => {
  const a = SRC.indexOf(from)
  const b = SRC.indexOf(to, a)
  if (a < 0 || b < a) { console.log('  ✗ cannot cut client.js between ' + JSON.stringify(from) + ' and ' + JSON.stringify(to)); process.exit(1) }
  return SRC.slice(a, b)
}
const CODE = cut("const KB_LANG_FALLBACK = 'en'", '// <kb-lang-runtime>') + '\n' +
  cut('const kbLangResolve = () => {', "try { if (typeof window !== 'undefined') window.__KB_LANG_RESOLVE__")
const build = (fx) => new Function('window', 'localStorage', 'kbLocaleRead', 'document', CODE + '\nreturn { kbLangActive, kbLangResolve }')(
  fx.window, fx.localStorage, fx.kbLocaleRead, {})

// A page: what the browser stores, what the Language plugin published, what DSH's locale says.
const page = ({ stored, active, shell }) => {
  const store = new Map()
  if (stored !== undefined) store.set('kybernos.theme.lang', stored)
  const fx = {
    window: active === undefined ? {} : { __KB_I18N_ACTIVE__: { lang: active } },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)) } },
    kbLocaleRead: () => shell,
  }
  return Object.assign(build(fx), { fx, store })
}

console.log('the default follows the shell')
check('nothing stored, an English shell: English', page({ shell: 'en' }).kbLangResolve() === 'en')
check('the Language plugin\'s default (« kybernos », nothing stored), an English shell: English', page({ active: 'kybernos', shell: 'en' }).kbLangResolve() === 'en')
check('nothing stored, a shell language Kybernos has no table for: French, the source language', page({ shell: 'es' }).kbLangResolve() === 'kybernos')
check('nothing stored, a right-to-left shell: that language', page({ shell: 'ar' }).kbLangResolve() === 'ar')

console.log('an explicit choice is obeyed')
check('English chosen: English', page({ stored: 'en', active: 'en', shell: 'en' }).kbLangResolve() === 'en')
check('French chosen (« Use » on Français) under an English DSH: French, on purpose', page({ stored: 'kybernos', active: 'kybernos', shell: 'en' }).kbLangResolve() === 'kybernos')
check('a translated language chosen: that language', page({ stored: 'es', active: 'es', shell: 'es' }).kbLangResolve() === 'es')

console.log('the trip en -> es -> en (one page, the way the runtime writes it: stored choice + published state + shell)')
{
  const store = new Map([['kybernos.theme.lang', 'en']])
  const win = { __KB_I18N_ACTIVE__: { lang: 'en' } }
  let shell = 'en'
  const ls = { getItem: (k) => (store.has(k) ? store.get(k) : null) }
  const labels = () => build({ window: win, localStorage: ls, kbLocaleRead: () => shell }).kbLangResolve()
  const trip = [labels()]
  store.set('kybernos.theme.lang', 'es'); win.__KB_I18N_ACTIVE__ = { lang: 'es' }; shell = 'es'
  trip.push(labels())
  store.set('kybernos.theme.lang', 'en'); win.__KB_I18N_ACTIVE__ = { lang: 'en' }; shell = 'en'
  trip.push(labels())
  check('the labels follow: en, es, en', trip.join(',') === 'en,es,en', trip)
}

console.log('\n' + String(pass) + ' verifications, ' + String(fail) + ' failure(s)')
process.exit(fail === 0 ? 0 : 1)
