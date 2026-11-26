#!/usr/bin/env node
// scripts/lib-i18n-audit.mjs: what the audit calls French or English, and what is a real leftover against the English baseline.
import { analyse, classify, leftovers } from './lib-i18n-audit.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }

check('digits, symbols and paths are not text', classify('16h') === null && classify('10 %') === null && classify('/Users/x/file.txt') === null && classify('···') === null)
check('an accent or a French function word makes French', classify('Créer une compétence') === 'fr' && classify('Pas de résultat') === 'fr')
check('plain English is English', classify('Create a skill') === 'en')
check('an accent-free French word is called English: the heuristic cannot tell, which is why leftovers() compares with the baseline', classify('Connecteurs') === 'en' && classify('Cartes') === 'en')

const r = analyse([{ kind: 'text', text: '⟦Create⟧' }, { kind: 'text', text: 'Create' }, { kind: 'text', text: 'Create' }, { kind: 'title', text: 'Créer' }])
check('analyse counts a ⟦…⟧ text as translated, drops duplicates, and sorts the rest', r.translated === 1 && r.en.length === 1 && r.fr.length === 1, r)

const baseline = [{ page: 'Home', fr: [], en: ['New chat', 'Automations', 'Skills'] }, { page: 'Skills', fr: [], en: ['Featured'] }]
const run = [
  { page: 'Home', fr: ['Compétences'], en: ['New chat', 'Connecteurs', 'Automations'] },
  { page: 'Skills', fr: [], en: ['Featured', 'New chat', 'Cartes'] },
]
const left = leftovers(baseline, run)
check('a text the baseline also shows is a leftover', left.some((l) => l.text === 'Featured') && left.some((l) => l.text === 'Automations'))
check('a text the baseline does not show is French the heuristic missed, not a leftover', !left.some((l) => l.text === 'Connecteurs' || l.text === 'Cartes'), left)
check('the most widespread leftover comes first and names its pages', left[0].text === 'New chat' && left[0].pages.join() === 'Home,Skills', left)
check('nothing in common, nothing left', leftovers([{ page: 'a', en: ['x'] }], [{ page: 'a', en: ['y'] }]).length === 0 && leftovers([], []).length === 0)

console.log(`\n${pass} ✓  ${fail} ✗`)
process.exit(fail === 0 ? 0 : 1)
