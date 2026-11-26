#!/usr/bin/env node
// The French twin of the « Memory & Lessons » page, offline: the pair helper cut out of client.js (English base and default, French for
// the French of the product), a sample of the pairs, and the French help (« tu », and the labels it quotes exist on the page).
//
//   node packages/kybernos-memory/test-lang.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCE = readFileSync(join(HERE, 'client.js'), 'utf8')

// ── the helper, as the page has it
console.log('the pair helper')
const lang = /const lang = \(\) => \{[\s\S]*?\n {6}\}\n/.exec(SOURCE)
const kt = /const kt = \(fr, en\) => .*\n/.exec(SOURCE)
check('client.js has the helper, the two statements self-contained', lang !== null && kt !== null)
const ask = (resolver) => vm.runInNewContext(lang[0] + kt[0] + 'kt("FR", "EN")', { window: resolver === null ? {} : { __KB_LANG_RESOLVE__: resolver }, String })
check('English for en', ask(() => 'en') === 'EN')
check('French for the French of the product (kybernos)', ask(() => 'kybernos') === 'FR')
check('French for fr-CA', ask(() => 'fr-CA') === 'FR')
check('French for fr', ask(() => 'fr') === 'FR')
check('English for es, ar, zh (every other language reads English)', ['es', 'ar', 'zh'].every((l) => ask(() => l) === 'EN'))
check('English when the resolver throws', ask(() => { throw new Error('not ready') }) === 'EN')
check('English when nothing resolves (no resolver, or an empty answer)', ask(null) === 'EN' && ask(() => undefined) === 'EN' && ask(() => '') === 'EN')

// ── the pairs
console.log('the pairs')
const pairs = [...SOURCE.matchAll(/kt\('((?:[^'\\]|\\.)*)', '((?:[^'\\]|\\.)*)'\)/g)].map((m) => ({ fr: m[1], en: m[2] }))
check('the page has its pairs (a hundred and more simple ones)', pairs.length >= 100, pairs.length)
const sample = Array.from({ length: 10 }, (_, i) => pairs[Math.floor(i * pairs.length / 10)])
check('in a sample of 10 pairs the French differs from the English', sample.every((p) => p.fr !== p.en && p.fr.length > 0), sample.filter((p) => p.fr === p.en))
check('no pair has « vous / votre / vos » in its French', pairs.every((p) => !/\b(vous|votre|vos)\b/i.test(p.fr)), pairs.filter((p) => /\b(vous|votre|vos)\b/i.test(p.fr)).map((p) => p.fr))

// ── the French help
console.log('the French help')
const help = JSON.parse(readFileSync(join(HERE, 'help.json'), 'utf8'))
const fr = [help.what.fr, ...help.steps.map((s) => s.fr), help.where.fr, help.good.fr]
check('every French text is there', fr.every((t) => typeof t === 'string' && t.length > 10))
const NOT_COMMANDS = new Set(['chez', 'assez', 'nez', 'lez'])
const vous = fr.filter((t) => /\b(vous|votre|vos)\b/i.test(t))
const ez = fr.flatMap((t) => (t.match(/\b[a-zàâçéèêëîïôùûœ]+ez\b/gi) || []).filter((w) => !NOT_COMMANDS.has(w.toLowerCase())))
check('it says « tu » (no vous / votre / vos)', vous.length === 0, vous)
check('it gives no order in « -ez »', ez.length === 0, ez)
const quoted = [...new Set(fr.flatMap((t) => [...t.matchAll(/«\s*([^»]+?)\s*»/g)].map((m) => m[1])))]
check('it quotes labels', quoted.length >= 5, quoted)
check('every label it quotes is a French label of the page', quoted.every((q) => SOURCE.includes("kt('" + q + "'")), quoted.filter((q) => !SOURCE.includes("kt('" + q + "'")))
check('the English help is still English and untouched in shape', Object.keys(help).join() === 'what,steps,where,good,url' && help.steps.length === 4 && help.steps.every((s) => typeof s.en === 'string' && !/[éèàç]/.test(s.en)))

// The Settings menu draws the label the section is registered with: a fixed English string would stay English under the French.
console.log('the nav entry')
check('the nav label is the page title, said in the language in use', /id: 'kybernos-memory', order: 3, label: pageTitle\(\) \}/.test(SOURCE) && /const pageTitle = \(\) => kt\('Mémoire & Leçons', PAGE_TITLE\)/.test(SOURCE))

console.log('\n' + (pass + fail) + ' verifications, ' + fail + ' failure(s)')
process.exit(fail === 0 ? 0 : 1)
