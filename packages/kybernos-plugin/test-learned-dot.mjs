#!/usr/bin/env node
// The dot on the Skills row of the menu: Kaby has suggestions waiting. The browser bundle is not importable, so the client is read as text
// (the page itself is checked on the real GUI by scripts/check-skills-learned-live.mjs).
//
//   node packages/kybernos-plugin/test-learned-dot.mjs   (exit 0 = all pass)
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')
let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

const comp = src.slice(src.indexOf('const KbLearnedDot = () => {'), src.indexOf('const KB_MENU_ENTRY = {'))
assert.ok(comp.length > 200, 'the component was found')
assert.ok(/window\.__KB_LEARNED__/.test(comp) && /store\.subscribe\(/.test(comp) && /store\.count\(\)/.test(comp), 'it reads the count the Skills bundle publishes, and listens for changes')
assert.ok(/if \(!\(pair\[0\] > 0\)\) return null/.test(comp), 'nothing is drawn at 0')
assert.ok(/h\('span', \{[^}]*'data-kb': 'learned-dot' \}\)/.test(comp), 'the dot is an empty span: it carries no number, the page does')
assert.ok(/'aria-label': label/.test(comp) && /title: label/.test(comp), 'it has a name for a screen reader and a tooltip')
ok('the dot reads the Skills bundle’s count, listens for changes, draws nothing at 0 and has a name')

assert.ok(/row\('skills', Icon\('sparkles', 15\), kbt\('kbui\.skills'\), c\.skills, shown === 'skills', \(\) => openPage\(\{ view: 'skills' \}\), h\(KbLearnedDot\)\)/.test(src), 'the Skills row of the menu carries it')
assert.equal((src.match(/row\('[a-z]+', Icon\([^)]*\), kbt\('[^']+'\), [^,]+, [^,]+, \(\) => openPage\(\{ view: '[a-z]+' \}\), h\(KbLearnedDot\)\)/g) || []).length, 1, 'and only that row does')
ok('only the Skills row of the menu carries the dot, as the extra of the shared row builder')

for (const key of ['kbui.skills.suggested', 'kbui.skills.suggested.1']) {
  assert.ok(new RegExp("'" + key.replace(/\./g, '\\.') + "': \\{ kybernos: '[^']*\\{n\\}[^']*', en: '[^']*\\{n\\}[^']*' \\}").test(src) || key.endsWith('.1'), key + ' has both languages with {n}')
}
assert.ok(/'kbui\.skills\.suggested\.1': \{ kybernos: '1 skill attend ta relecture', en: '1 skill is waiting for you' \}/.test(src), 'the singular has its own words')
ok('the tooltip is worded in French and English, with its singular')

assert.ok(/\.kb4-dot\{[^}]*border-radius:50%/.test(src), 'the dot has a style')
ok('the dot has a style')
console.log('\n' + String(pass) + ' checks passed')
