#!/usr/bin/env node
// The Settings nav (organiser in client.js): what the layout promises, pinned without a browser.
// The DOM result itself is checked against the real GUI (scripts/check-settings-nav-live.mjs).
//
//   node packages/kybernos-plugin/test-settings-nav.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')
const start = SRC.indexOf("const GROUPES = [")
const block = SRC.slice(start, start + 12000)

console.log('About closes the list')
const fin = /const FIN_DE_LISTE = \[([^\]]*)\]/.exec(block)
const finWords = fin === null ? [] : fin[1].split(',').map((w) => w.trim().replace(/^'|'$/g, ''))
check('the end-of-list labels are About, in English and in French', finWords.indexOf('about') >= 0 && finWords.indexOf('a propos') >= 0, finWords)
const groupOrder = block.indexOf('cellule.style.order = String(g * 100 + 10 + wi)')
const endOrder = block.indexOf("if (FIN_DE_LISTE.indexOf(n) !== -1) cellule.style.order = '9000'")
check('the override comes AFTER the group order (else the group order wins)', groupOrder > 0 && endOrder > groupOrder, { groupOrder, endOrder })
const unknown = /cellule\.style\.order = String\((\d+) \+ idx\)/.exec(block)
check('9000 sits after every page a plugin can add (unknown labels start at 450)', unknown !== null && Number(unknown[1]) + 200 < 9000, unknown && unknown[1])
check('About is still a known label, so the Settings nav is still recognised from it', /'about', 'a propos'/.test(block))

console.log('room at the end, smaller names')
check('the Settings list is marked, so only it is restyled', block.indexOf("liste.dataset.kbSettings = '1'") > 0)
check('it gets room under the last tab', /\[class\*="navList"\]\[data-kb-settings\]\{padding-bottom:\d+px\}/.test(SRC))
const fs = /\[class\*="navList"\]\[data-kb-settings\] \[class\*="navCell"\]\{font-size:(\d+(?:\.\d+)?)px\}/.exec(SRC)
check('tab names are smaller than the shell\'s 14px but still readable', fs !== null && Number(fs[1]) < 14 && Number(fs[1]) >= 12, fs && fs[1])
check('the other navs of the app are not touched (every rule is scoped by data-kb-settings)', !/\[class\*="navList"\]\{[^}]*(padding-bottom|font-size)/.test(SRC))

console.log('\n' + String(pass) + ' verifications, ' + String(fail) + ' failure(s)')
process.exit(fail === 0 ? 0 : 1)
