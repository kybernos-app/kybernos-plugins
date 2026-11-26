#!/usr/bin/env node
// The language of the Skills screen (WP-07, D1; audit A3-15, A2-12, A2-25): the page reads the language Kybernos resolved (« kybernos »
// or fr* is French, every other language English, nothing resolved English), says « 1 file » and not « 1 files », tells an admin what the
// members can and cannot see (it used to say there was nothing to review next to a counter that said otherwise), and its French speaks
// « tu ». The table and the helper are cut out of the client as they are written.
//
//   node packages/kybernos-skills/test-lang.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(fileURLToPath(new URL('./client.js', import.meta.url)), 'utf8')
let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }

const a = src.indexOf('      const STR = {')
const b = src.indexOf('      const PAGE = 6\n')
check('the table and the helper are delimited', a > 0 && b > a)
const make = (resolve) => new Function('window', src.slice(a, b) + '\nreturn { STR, t, tlang, isEn, sep }')({ __KB_LANG_RESOLVE__: resolve })

console.log('\n── the language is the one Kybernos resolved ──')
const lang = (r) => make(r).tlang()
check('en is English', lang(() => 'en') === 'en')
check('« kybernos » and fr* are French', lang(() => 'kybernos') === 'fr' && lang(() => 'fr') === 'fr' && lang(() => 'fr-CA') === 'fr')
check('es, ar, zh are English (never French)', ['es', 'ar', 'zh', 'de'].every((l) => lang(() => l) === 'en'))
check('nothing resolved (none, or one that throws) is English', lang(undefined) === 'en' && lang(() => { throw new Error('not ready') }) === 'en')

console.log('\n── one is not « 1 files » (A2-12) ──')
const en = make(() => 'en')
const fr = make(() => 'kybernos')
check('one file, several files', en.t('panel.files', { n: 1 }) === '1 file in the folder' && en.t('panel.files', { n: 4 }) === '4 files in the folder' && en.t('panel.files', { n: 0 }) === '0 files in the folder')
check('one install, several installs (the count is a localised string)', en.t('pick.count', { n: '1' }) === '1 install' && en.t('pick.count', { n: '1,204' }) === '1,204 installs')
check('one result, one skill ranked', en.t('src.search', { n: 1, total: 9, ms: '3 ms' }).startsWith('1 result shown of 9') && en.t('src.index', { n: 1, v: 'hot' }).startsWith('1 skill ranked'))
check('the French has its singular too', fr.t('panel.files', { n: 1 }) === '1 fichier dans le dossier' && fr.t('pick.count', { n: 1 }) === '1 installation' && fr.t('tm.n.installed', { name: 'x', n: 1 }) === '« x » installé (1 fichier).')
check('a row without a « .1 » twin is unchanged for 1', en.t('flt.active', { n: 1 }) === 'Active (1)')

console.log('\n── the Team caption for an admin (A3-15) ──')
const adminEn = en.t('tm.who.admin', { ws: 'Acme' })
check('English: it says members do not see the review queue, not that there is nothing to review', adminEn === 'Acme · you are an admin · members do not see the review queue yet' && !/nothing to review/.test(adminEn), adminEn)
check('French: the same meaning, in « tu »', fr.t('tm.who.admin', { ws: 'Acme' }) === 'Acme · tu es admin · les membres ne voient pas encore ce qui est à valider')

console.log('\n── « tu », not « vous » (A2-25) ──')
const VOUS = /(?<![A-Za-zÀ-ÿ])(vous|votre|vos|vôtre)(?![A-Za-zÀ-ÿ])/i
const IMP = /(?<![A-Za-zÀ-ÿ])(?!chez(?![A-Za-zÀ-ÿ])|assez(?![A-Za-zÀ-ÿ]))[a-zà-ÿ]{3,}ez(?![A-Za-zÀ-ÿ])/i
const frTexts = Object.values(en.STR).map((v) => v.fr)
check('no « vous », « votre », « vos » in the French rows', !frTexts.some((x) => VOUS.test(x)), frTexts.filter((x) => VOUS.test(x)).slice(0, 3))
check('no second-person-plural command (« -ez ») in the French rows', !frTexts.some((x) => IMP.test(x)), frTexts.filter((x) => IMP.test(x)).slice(0, 3))
const help = JSON.parse(readFileSync(fileURLToPath(new URL('./help.json', import.meta.url)), 'utf8'))
const helpFr = [help.what && help.what.fr, ...(help.steps || []).map((s) => s.fr), help.good && help.good.fr].filter((x) => typeof x === 'string')
check('the French help speaks « tu » too', helpFr.length >= 4 && !helpFr.some((x) => VOUS.test(x) || IMP.test(x)), helpFr.filter((x) => VOUS.test(x) || IMP.test(x)))

console.log('\n── the page code ──')
check('the helper does not read the locale service, the theme storage or <html lang> any more', !/localeSvc|theme\.lang|documentElement\.lang/.test(src.slice(a, b)) && !/ctx\.get\('locale'\)/.test(src))

console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)
