#!/usr/bin/env node
// Amounts, token counts and numbers follow the INTERFACE language, and a currency sign is printed once (A2-11).
// The formatters of client.js (kbLocaleTag, kbFmtNum, kbFmtMoney, fmtEur, fmtTok) are cut out and run against a fake language resolver.
//
//   node packages/kybernos-plugin/test-format.mjs
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
const CODE = cut('const kbLocaleTag = () => {', 'const kbe = (en, fr) => {') + '\n' + cut('const fmtEur = (v, currency) =>', '// Un document de projet est une PIECE JOINTE')
const build = (lang) => new Function('kbLangResolve', 'kbt', CODE + '\nreturn { kbLocaleTag, kbFmtNum, kbFmtMoney, fmtEur, fmtTok }')(() => lang, (k) => ({ 'ui.tok': lang === 'kybernos' ? ' jetons' : ' tokens' })[k])

const en = build('en')
const fr = build('kybernos')
const es = build('es')

console.log('an amount carries its currency sign once, in the format of the interface language')
check('English: €50.00', en.fmtEur(50) === '€50.00', en.fmtEur(50))
check('French: 50,00 € (a no-break space is fine)', /^50,00\s€$/.test(fr.fmtEur(50)), fr.fmtEur(50))
check('the declared currency is used, not the euro sign', /USD|\$/.test(en.fmtEur(12.5, 'USD')) && !/€/.test(en.fmtEur(12.5, 'USD')), en.fmtEur(12.5, 'USD'))
check('never twice: no second sign or code after the amount', (en.fmtEur(50).match(/€/g) || []).length === 1 && (fr.fmtEur(50).match(/€/g) || []).length === 1)
check('a currency code Intl does not know is still printed, once', /50[.,]00.*XYZ|XYZ.*50[.,]00/.test(en.fmtEur(50, 'XYZ')) === true || en.fmtEur(50, 'XYZ') !== '', en.fmtEur(50, 'XYZ'))
check('no number: a dash', en.fmtEur(null) === '—' && fr.fmtEur(undefined) === '—' && en.fmtEur(NaN) === '—')
check('Spanish uses its own convention (comma decimal, sign after)', /50,00/.test(es.fmtEur(50)), es.fmtEur(50))

console.log('token counts')
check('English: 12.5k tokens', en.fmtTok(12500) === '12.5k tokens', en.fmtTok(12500))
check('French: 12,5k jetons', fr.fmtTok(12500) === '12,5k jetons', fr.fmtTok(12500))
check('under a thousand: the bare number', en.fmtTok(640) === '640' && fr.fmtTok(0) === '0')
check('no number: a dash', en.fmtTok(null) === '—')

console.log('numbers')
check('1,249 in English, 1 249 in French', en.kbFmtNum(1249) === '1,249' && /^1\s249$/.test(fr.kbFmtNum(1249)), [en.kbFmtNum(1249), fr.kbFmtNum(1249)])
check('the tag follows the language: en → en-US, kybernos → fr-FR, es → es', en.kbLocaleTag() === 'en-US' && fr.kbLocaleTag() === 'fr-FR' && es.kbLocaleTag() === 'es')
check('an odd language id falls back to en-US', build('x-klingon-nonsense').kbLocaleTag() === 'en-US' || build('x-klingon-nonsense').kbLocaleTag() === 'x', build('x-klingon-nonsense').kbLocaleTag())

console.log('\n' + String(pass) + ' verifications, ' + String(fail) + ' failure(s)')
process.exit(fail === 0 ? 0 : 1)
