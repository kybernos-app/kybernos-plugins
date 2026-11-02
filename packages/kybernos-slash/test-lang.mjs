#!/usr/bin/env node
// The language of the Commands page (WP-07, D1; audit A2-12, A2-25): the page reads the language Kybernos resolved (French for « kybernos »
// and fr*, English for every other language and for nothing), a count says « 1 field » and not « 1 fields », the errors it hands out are
// English, and its French speaks « tu ». The helpers are cut out of the client as they are written.
//
//   node packages/kybernos-slash/test-lang.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(fileURLToPath(new URL('./client.js', import.meta.url)), 'utf8')
const host = readFileSync(fileURLToPath(new URL('./index.js', import.meta.url)), 'utf8')
let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }

const a = src.indexOf('      const kbslLang = () => {')
const b = src.indexOf("      // ── Access to the host's entries")
check('the language helpers are delimited', a > 0 && b > a)
const make = (resolve) => new Function('window', 'document', 'navigator', src.slice(a, b) + '\nreturn { kbslLang, L, kbslCount }')(
  { __KB_LANG_RESOLVE__: resolve }, { documentElement: { lang: 'en' } }, { language: 'en' })

console.log('\n── the language is the one Kybernos resolved ──')
const lang = (r) => make(r).kbslLang()
check('en is English; « kybernos » and fr* are French', lang(() => 'en') === 'en' && lang(() => 'kybernos') === 'fr' && lang(() => 'fr-CA') === 'fr')
check('es, ar, zh are English (never French)', ['es', 'ar', 'zh', 'de'].every((l) => lang(() => l) === 'en'))
check('a resolver that throws is English', lang(() => { throw new Error('not ready') }) === 'en')

console.log('\n── one is not « 1 fields » (A2-12) ──')
const en = make(() => 'en')
const fr = make(() => 'kybernos')
const one = { fr: 'champ', en: 'field' }
const many = { fr: 'champs', en: 'fields' }
check('English: 1 field, 2 fields, 0 fields', en.kbslCount(1, one, many) === '1 field' && en.kbslCount(2, one, many) === '2 fields' && en.kbslCount(0, one, many) === '0 fields')
check('French: 1 champ, 3 champs', fr.kbslCount(1, one, many) === '1 champ' && fr.kbslCount(3, one, many) === '3 champs')

console.log('\n── the words ──')
check('the errors the page and the host hand out are English', !/error: '(écriture refusée|composeur introuvable|gabarit vide|trop d entrées|aucune entree fournie|message introuvable)'/.test(src + host) && /error: 'too many entries'/.test(host))
const VOUS = /(?<![A-Za-zÀ-ÿ])(vous|votre|vos)(?![A-Za-zÀ-ÿ])/i
const IMP = /(?<![A-Za-zÀ-ÿ])(?!chez(?![A-Za-zÀ-ÿ])|assez(?![A-Za-zÀ-ÿ]))[a-zà-ÿ]{3,}ez(?![A-Za-zÀ-ÿ])/i
const frPieces = [...src.matchAll(/fr: ('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g)].map((m) => m[1])
check('the French of the page speaks « tu »: no « vous », « votre », « vos », no « -ez » command', frPieces.length > 40 && !frPieces.some((x) => VOUS.test(x) || IMP.test(x)), frPieces.filter((x) => VOUS.test(x) || IMP.test(x)).slice(0, 3))
const help = JSON.parse(readFileSync(fileURLToPath(new URL('./help.json', import.meta.url)), 'utf8'))
const helpFr = [help.what && help.what.fr, ...(help.steps || []).map((s) => s.fr), help.good && help.good.fr].filter((x) => typeof x === 'string')
check('the French help speaks « tu » too', helpFr.length >= 4 && !helpFr.some((x) => VOUS.test(x) || IMP.test(x)), helpFr.filter((x) => VOUS.test(x) || IMP.test(x)))

console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)
