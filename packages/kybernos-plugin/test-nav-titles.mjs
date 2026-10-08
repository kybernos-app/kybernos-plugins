#!/usr/bin/env node
// Which title each Settings cell stands for, whatever the language: KB_NAV_KEYS, kbNavKeyOf and kbNavTitles of client.js, cut out
// and run alone. No browser.
//
//   node packages/kybernos-plugin/test-nav-titles.mjs
//
// Pinned here because the menu used to be organised by TITLE only (French, English and a few Spanish ones): under any other
// translated language no title matched and the groups, the order and the icons of the Settings menu were lost. A cell is now
// named by the key React renders it with (the id of its section), which does not depend on the language.
import { readFileSync } from 'node:fs'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const SRC = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
const a = SRC.indexOf('const KB_NAV_KEYS = ')
const b = SRC.indexOf('// </kb-nav-titles>', a)
if (a < 0 || b < a) { console.log('  ✗ cannot cut the nav title helpers out of client.js'); process.exit(1) }
const { KB_NAV_KEYS, kbNavKeyOf, kbNavTitles } = new Function(SRC.slice(a, b) + '\nreturn { KB_NAV_KEYS, kbNavKeyOf, kbNavTitles }')()

// What the organiser knows by title (its GROUPES and ICONES, in normalised form): every key must lead to a title it can place.
const ORGANISER = new Set(readFileSync(new URL('./client.js', import.meta.url), 'utf8').match(/'[a-z0-9 &.-]+'/g).map((x) => x.slice(1, -1)))
const cell = (key) => ({ ['__reactFiber$abc']: { key } })

console.log('a cell is named by its React key')
{
  check('the key of a core cell is read from its fiber', kbNavKeyOf(cell('kbac-referral')) === 'kbac-referral')
  check('a cell with no fiber has no key (null, not an error)', kbNavKeyOf({}) === null)
  check('a fiber that throws is not an error either', kbNavKeyOf(new Proxy({}, { ownKeys() { throw new Error('boom') } })) === null)
  check('a fiber whose key is not a string (a numeric key, null) has none', kbNavKeyOf(cell(7)) === null && kbNavKeyOf(cell(null)) === null)
}

console.log('the title is the one the organiser knows, in any language')
{
  const keys = ['general', 'kybernos-theme', 'kybernos-language', 'kbac-referral', 'kbac-appearance', 'kbac-security', 'kybernos-maintenance']
  const german = ['allgemein', 'design', 'sprache', 'empfehlung', 'erscheinungsbild', 'sicherheit', 'uber']
  check('German titles nobody knows become the known ones, cell by cell', JSON.stringify(kbNavTitles(german, keys)) === JSON.stringify(['general', 'theme', 'language', 'referral', 'appearance', 'security', 'about']))
  check('the same cells in English come out the same', JSON.stringify(kbNavTitles(['general', 'theme', 'language', 'referral', 'appearance', 'security', 'about'], keys)) === JSON.stringify(['general', 'theme', 'language', 'referral', 'appearance', 'security', 'about']))
  check('the same cells in French come out the same', JSON.stringify(kbNavTitles(['general', 'theme', 'langue', 'parrainage', 'apparence', 'securite', 'a propos'], keys)) === JSON.stringify(['general', 'theme', 'language', 'referral', 'appearance', 'security', 'about']))
}

console.log('what has no known key keeps what is drawn')
{
  check('a section added later keeps its title', JSON.stringify(kbNavTitles(['mon plugin', 'sprache'], [null, 'kybernos-language'])) === JSON.stringify(['mon plugin', 'language']))
  check('an unknown key keeps its title too (and « constructor » is not a key)', JSON.stringify(kbNavTitles(['x', 'y'], ['new-section', 'constructor'])) === JSON.stringify(['x', 'y']))
}

console.log('the table is consistent with the organiser')
{
  const missing = Object.entries(KB_NAV_KEYS).filter(([, title]) => !ORGANISER.has(title)).map(([k, t]) => k + ' → ' + t)
  check('every title of the table appears in the organiser\'s own lists or is a plugin page it leaves in the tail', missing.length === 0 || missing.every((m) => /workers|kybernos suite|tools|auto routing/.test(m)), missing)
  check('no two keys name the same title', new Set(Object.values(KB_NAV_KEYS)).size === Object.values(KB_NAV_KEYS).length)
}

console.log(`\n${pass} ✓  ${fail} ✗`)
process.exit(fail === 0 ? 0 : 1)
