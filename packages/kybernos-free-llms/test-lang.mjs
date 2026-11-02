#!/usr/bin/env node
// The language of the Free LLMs page (WP-07, D1; audit A2-18): it reads the language Kybernos resolved (« kybernos » or fr* is French,
// everything else English) — not the <html lang>, which is never « fr » — and every string it asks for exists in both languages.
// The i18n block is cut out of the client as it is written.
//
//   node packages/kybernos-free-llms/test-lang.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(fileURLToPath(new URL('./client.js', import.meta.url)), 'utf8')
let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }

const a = src.indexOf('// ── i18n minimal')
const b = src.indexOf('// ── icons')
check('the i18n block is delimited', a > 0 && b > a)
const make = (resolve) => new Function('window', 'document', src.slice(a, b) + '\nreturn { KB_M_T, kbLocaleRead, m, sep }')(
  { __KB_LANG_RESOLVE__: resolve }, { documentElement: { lang: 'en' } })

console.log('\n── the language is the one Kybernos resolved (A2-18) ──')
const lang = (r) => make(r).kbLocaleRead()
check('en reads English', lang(() => 'en') === 'en')
check('« kybernos » (DSH\'s own selector, French) reads French', lang(() => 'kybernos') === 'fr')
check('fr and fr-CA read French', lang(() => 'fr') === 'fr' && lang(() => 'fr-CA') === 'fr')
check('es, ar, zh read English (never French)', ['es', 'ar', 'zh', 'de'].every((l) => lang(() => l) === 'en'))
check('a resolver that throws, or none, reads English', lang(() => { throw new Error('not ready') }) === 'en' && lang(undefined) === 'en')

console.log('\n── the words ──')
const en = make(() => 'en')
const fr = make(() => 'kybernos')
check('the French page speaks French and the English page English', fr.m('kfl.sonde.ok') === 'Répond — contrat accepté.' && en.m('kfl.sonde.ok') === 'Answers — contract accepted.')
check('the separator follows the language', fr.sep() === ' : ' && en.sep() === ': ')
const keys = [...src.matchAll(/\bm\('(kfl\.[A-Za-z0-9_.-]+)'/g)].map((x) => x[1])
check('every m(\'kfl.…\') key used by the page exists in the table', keys.length > 15 && keys.every((k) => en.KB_M_T[k] !== undefined), keys.filter((k) => en.KB_M_T[k] === undefined))
check('every row has an English text and a French one', Object.values(en.KB_M_T).every((v) => typeof v.en === 'string' && typeof v.fr === 'string' && v.en.length > 0 && v.fr.length > 0))
check('the French of the page addresses the person as « tu » (no « vous », « votre », « -ez » command)', !Object.values(en.KB_M_T).some((v) => /\b(vous|votre|vos|[a-zé]+ez)\b/i.test(v.fr.replace(/\b(chez|assez)\b/gi, ''))), Object.values(en.KB_M_T).map((v) => v.fr).filter((t) => /\b(vous|votre|vos|[a-zé]+ez)\b/i.test(t)))

console.log('\n── the page code itself ──')
check('the page reads neither the <html lang> nor the locale service', !/documentElement\.lang/.test(src.slice(b)) && !/ctx\.get\('locale'\)/.test(src))
check('no bare French default is left in the error line', !/'refus'/.test(src))

console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)
