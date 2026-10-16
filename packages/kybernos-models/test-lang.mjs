#!/usr/bin/env node
// The language of the AI Provider & Models page (WP-07, D1; audit A2-25, A2-18's rule): the page reads the language Kybernos resolved
// (« kybernos » or fr* is French, every other language English, nothing resolved = English — it used to default to FRENCH), the
// decimal comma is French only, the French half of the table speaks « tu », and no French word is left outside the table.
// The language block and the number helper are cut out of the client as they are written.
//
//   node packages/kybernos-models/test-lang.mjs
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(fileURLToPath(new URL('./client.js', import.meta.url)), 'utf8')
let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }

const a = src.indexOf('// ── language:')
const b = src.indexOf('// ── icons: exact paths of the mock-up')
const n0 = src.indexOf('const kbNum = (v, dec) => {')
const n1 = src.indexOf('\n      }\n', n0) + 9
check('the language block and the number helper are delimited', a > 0 && b > a && n0 > b && n1 > n0)
const make = (resolve) => new Function('window', 'localStorage', src.slice(a, b) + '\n' + src.slice(n0, n1) + '\nreturn { KB_M_T, kbIsFr, m, sep, kbNum }')(
  { __KB_LANG_RESOLVE__: resolve, __KB_I18N_ACTIVE__: { lang: 'es' } }, { getItem: () => 'es' })

console.log('\n── the language is the one Kybernos resolved ──')
const fr = (r) => make(r).kbIsFr()
check('en is English', fr(() => 'en') === false)
check('« kybernos » (the French of the product) and fr* are French', fr(() => 'kybernos') === true && fr(() => 'fr') === true && fr(() => 'fr-CA') === true)
check('es, ar, zh are English (never French)', ['es', 'ar', 'zh', 'de'].every((l) => fr(() => l) === false))
check('nothing resolved (no resolver, or one that throws) is English, not French', fr(undefined) === false && fr(() => { throw new Error('not ready') }) === false)
check('a stale « es » in the theme storage does not turn the page French', make(() => 'kybernos').m('kb.models.restore') === 'Rétablir les défauts')

console.log('\n── the words and the numbers ──')
const en = make(() => 'en')
const kyb = make(() => 'kybernos')
check('the nav entry is « AI Provider & Models » / « Fournisseur IA & modèles »', en.m('kb.models.surface.entry') === 'AI Provider & Models' && kyb.m('kb.models.surface.entry') === 'Fournisseur IA & modèles')
check('the separator follows the language', en.sep() === ': ' && kyb.sep() === ' : ')
check('a number has a decimal point in English and a comma in French', en.kbNum(1.5) === '1.5' && kyb.kbNum(1.5) === '1,5' && en.kbNum('x') === '—')
check('every row has an English text and a French one', Object.values(en.KB_M_T).every((v) => typeof v.en === 'string' && typeof v.kybernos === 'string' && v.en.length > 0 && v.kybernos.length > 0))
const keys = [...src.matchAll(/\bm\('(kb\.[A-Za-z0-9_.-]+)'/g)].map((x) => x[1]).filter((k) => !k.endsWith('.'))
check('every m(\'kb.…\') key used by the page exists in the table', keys.length > 50 && keys.every((k) => en.KB_M_T[k] !== undefined), keys.filter((k) => en.KB_M_T[k] === undefined))

console.log('\n── « tu », not « vous » (A2-25) ──')
const VOUS = /\b(vous|votre|vos)\b/i
const IMP = /\b(?!chez\b|assez\b)[a-zà-ÿ]{3,}ez\b/i
const frTexts = Object.values(en.KB_M_T).map((v) => v.kybernos)
check('no « vous », « votre », « vos » in the French rows', !frTexts.some((t) => VOUS.test(t)), frTexts.filter((t) => VOUS.test(t)).slice(0, 3))
check('no second-person-plural command (« -ez ») in the French rows', !frTexts.some((t) => IMP.test(t)), frTexts.filter((t) => IMP.test(t)).slice(0, 3))
const help = JSON.parse(readFileSync(fileURLToPath(new URL('./help.json', import.meta.url)), 'utf8'))
const helpFr = [help.what && help.what.fr, ...(help.steps || []).map((s) => s.fr), help.good && help.good.fr].filter((t) => typeof t === 'string')
check('the French help speaks « tu » too', helpFr.length >= 4 && !helpFr.some((t) => VOUS.test(t) || IMP.test(t)), helpFr.filter((t) => VOUS.test(t) || IMP.test(t)))

console.log('\n── nothing French outside the table ──')
check('the error codes the page hands out are English (« empty », « refused »)', !/code: 'vide'|'refus'/.test(src) && /code: 'empty'/.test(src))
check('the dead generated CSS file is gone (nothing imported it)', !existsSync(fileURLToPath(new URL('./dsh-css.js', import.meta.url))))

console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)
