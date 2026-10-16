#!/usr/bin/env node
// One name for the models page everywhere a message sends people to it (A2-06): the label of its Settings entry — « AI Provider & Models »
// (« Fournisseur IA & modèles » in French). The first-run wizard said « Settings → Models » in four places and « → AI Provider & Models » in a fifth.
//
//   node packages/kybernos-plugin/test-page-names.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
const a = src.indexOf('const KB_OB_T = {')
const b = src.indexOf('\n    }\n', a)
assert.ok(a > 0 && b > a, 'the wizard table was found')
const table = src.slice(a, b)
let n = 0
const ok = (label) => { n += 1; console.log('  ✓ ' + label) }

// every row that sends to the models page, in the four languages
const rows = table.split('\n').filter((l) => /(?:→|←) (?:Models|AI Provider|Fournisseur)/.test(l))
assert.ok(rows.length >= 5, 'the wizard has at least five lines that point at the models page (' + rows.length + ')')
for (const r of rows) {
  assert.ok(!/(?:→|←) Models\b/.test(r), 'a line says « Settings → Models »: ' + r.slice(0, 80))
  assert.ok(/Réglages → Fournisseur IA & modèles/.test(r) || !/Réglages → /.test(r), 'the French line must name « Fournisseur IA & modèles »: ' + r.slice(0, 80))
}
ok('the wizard names the models page « AI Provider & Models » (« Fournisseur IA & modèles ») in all ' + rows.length + ' lines')
assert.ok(!/Réglages → Models/.test(table) && !/Réglages → AI Provider/.test(table), 'no French line keeps an English page name')
ok('no French line of the wizard keeps the English page name')

// A4-20: the quick actions of the Creations page name the type in brackets — the tile labels are plurals or mass nouns, so « Create a images… » was wrong.
const kt = src.slice(src.indexOf('const KB_T = {'), src.indexOf('\n    }\n', src.indexOf('const KB_T = {')))
const qa = [...kt.matchAll(/'deliv\.qa\.([123])': \{ kybernos: '((?:[^'\\]|\\.)*)', en: '((?:[^'\\]|\\.)*)' \}/g)]
assert.equal(qa.length, 3, 'the three typed quick actions were found')
for (const m of qa) {
  assert.ok(!/\b(?:a|an|le|la|un|une) \{type\}/i.test(m[2] + ' ' + m[3]), 'an article in front of {type} in quick action ' + m[1])
  assert.ok(m[3].endsWith('({type}).') && m[2].endsWith('({type}).'), 'quick action ' + m[1] + ' names the type in brackets')
}
ok('the three typed quick actions of Creations never put an article in front of the (plural) type name')

console.log('\n' + n + ' checks passed')
