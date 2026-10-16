#!/usr/bin/env node
// The language of the Local models page (WP-07, D1; audit A2-03, A2-18, A3-13, A3-36, A2-09): the page reads the language Kybernos
// resolved (« kybernos » or fr* is French, everything else English), formats sizes with the unit and the decimal mark of that
// language, and has no French word outside its { fr, en } table. The i18n block is cut out of the client as it is written.
//
//   node packages/kybernos-modeles-locaux/test-lang.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(fileURLToPath(new URL('./client.js', import.meta.url)), 'utf8')
let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }

const a = src.indexOf('// ── i18n minimal')
const b = src.indexOf('// KB-KML-PURE-END')
check('the i18n block is delimited', a > 0 && b > a)
const make = (resolve) => new Function('window', 'document', src.slice(a, b) + '\nreturn { KB_M_T, kbLocaleRead, m, kbNum, sep }')(
  { __KB_LANG_RESOLVE__: resolve }, { documentElement: { lang: 'en' } })

console.log('\n── the language is the one Kybernos resolved (A2-18) ──')
const lang = (r) => make(r).kbLocaleRead()
check('en reads English', lang(() => 'en') === 'en')
check('« kybernos » (DSH\'s own selector, French) reads French', lang(() => 'kybernos') === 'fr')
check('fr and fr-CA read French', lang(() => 'fr') === 'fr' && lang(() => 'fr-CA') === 'fr')
check('es, ar, zh read English (never French)', ['es', 'ar', 'zh', 'de'].every((l) => lang(() => l) === 'en'))
check('a resolver that throws, or none, reads English', lang(() => { throw new Error('not ready') }) === 'en' && lang(undefined) === 'en')
check('the <html lang> is not what decides (it stays « en » under the Language page\'s French)', make(() => 'kybernos').kbLocaleRead() === 'fr')

console.log('\n── sizes: one unit and one decimal mark per language (A2-03, A3-13) ──')
const en = make(() => 'en')
const fr = make(() => 'kybernos')
check('English: 8.3 and GB', en.kbNum(8.3, 'en') === '8.3' && en.m('kml.unit.go') === 'GB')
check('French: 8,3 and Go', fr.kbNum(8.3, 'fr') === '8,3' && fr.m('kml.unit.go') === 'Go')
check('a whole number is left alone', en.kbNum(16, 'en') === '16' && fr.kbNum(16, 'fr') === '16')
check('the « loaded » line follows the language', en.m('kml.en.charge', { go: en.kbNum(8.3, 'en') }) === 'loaded ≈ 8.3 GB' && fr.m('kml.en.charge', { go: fr.kbNum(8.3, 'fr') }) === 'en charge ≈ 8,3 Go')

console.log('\n── no French word in the English page (A3-36, A2-09) ──')
check('« Detecting… » while the machine is measured', en.m('kml.detection') === 'Detecting…' && fr.m('kml.detection') === 'détection…')
check('the trash button reads « Remove from DSH » / « Remove <id> »', en.m('kml.retirer') === 'Remove from DSH' && en.m('kml.retirer.id', { id: 'qwen3.5:9b' }) === 'Remove qwen3.5:9b' && fr.m('kml.retirer') === 'Retirer de DSH')
check('Cancel is a key', en.m('kml.annuler') === 'Cancel' && fr.m('kml.annuler') === 'Annuler')
const keys = [...src.matchAll(/\bm\('(kml\.[A-Za-z0-9_.-]+)'/g)].map((x) => x[1]).filter((k) => !k.endsWith('.'))
check('every m(\'kml.…\') key used by the page exists in the table (the two built with a suffix aside)', keys.every((k) => en.KB_M_T[k] !== undefined) && keys.length > 40, keys.filter((k) => en.KB_M_T[k] === undefined))
check('every row has an English text and a French one', Object.entries(en.KB_M_T).every(([, v]) => typeof v.en === 'string' && typeof v.fr === 'string' && v.en.length > 0))

console.log('\n── the page code itself ──')
check('no hard-coded French unit or forced decimal comma outside the pure helper', !/'\s*Go\b/.test(src.replace(/fr: [^\n]*/g, '')) && (src.match(/\.replace\('\.', ','\)/g) || []).length === 1)
check('the page does not read the <html lang> or the locale service any more', !/documentElement\.lang/.test(src.slice(src.indexOf('// KB-KML-PURE-END'))) && !/ctx\.get\('locale'\)/.test(src))

console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)
