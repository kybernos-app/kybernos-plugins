#!/usr/bin/env node
/** One icon column, one label column, in the sidebar menu — the group header and the workspace selector included.
 *
 *  The person, 2026-10-30: « dans le menu, il faudrait que les icônes et les titres soient alignés (collapsé ou non) ».
 *  Measured on a capture before the fix: the « Business » header label sat 34 px right of the items' (a chevron drawn
 *  before the icon, its own padding, and a `.95em` font that rescaled every `em` it used), and the workspace selector
 *  « Real estate agency » 8 px right (its own inset, plus a 1.65em tile where the items reserve 1.25em).
 *
 *  After the fix, the same measurement on the live GUI (127.0.0.1:3080, CDP probe) reads icoX 16.4 / labX 40.9 for
 *  the 10 items, the group header and the selector alike.
 *
 *  This file keeps the invariants in the source (the live numbers are quoted in campagne-recette-2026-10-30):
 *  same inset, same gap, one icon box of 1.25em, the label voice carried by the label and not by the row, and the
 *  disclosure drawn AFTER the label so it cannot push the icon off the column.
 *
 *  Usage: node packages/kybernos-plugin/test-menu-axis.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

const HERE = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(HERE, 'client.js'), 'utf8')

/** The rule body of a selector, as written in the bundle's stylesheet string. */
const rule = (sel) => {
  const i = src.indexOf(sel)
  assert.ok(i >= 0, 'the rule ' + sel + ' is in the bundle')
  const open = src.indexOf('{', i)
  const close = src.indexOf('}', open)
  return src.slice(open + 1, close)
}

// 1. the three row kinds share one inset and one gap
for (const sel of ['.kb4-item{', '.kb4-grph{', '.kb4-scopebtn,.kb4-scopeitem{']) {
  const body = rule(sel)
  assert.ok(/padding:[^;]*\.6em/.test(body) || /padding-left:calc\(\.6em - 1px\)/.test(body), sel + ' starts its content at .6em (' + body.slice(0, 90) + ')')
  assert.ok(/gap:\.5em/.test(body), sel + ' uses the items’ .5em gap')
}
ok('the item, the group header and the workspace selector share one inset and one gap')

// 2. one icon box, one label voice
assert.ok(/\.kb4-ico\{[^}]*width:1\.25em/.test(src), 'the items’ icon sits in a fixed 1.25em box')
assert.ok(/\.kb4-scopebtn \.kb4-scopetile,\.kb4-scopeitem \.kb4-scopetile\{width:1\.25em;height:1\.25em\}/.test(src), 'the selector’s tile takes the same 1.25em footprint')
assert.ok(/\.kb4-grph \.kb4-lab\{font-size:\.95em\}/.test(src), 'the header keeps the smaller voice on its label, not on the row (its `em` paddings stay the items’)')
assert.ok(/\.kb4-scopebtn \.kb4-lab,\.kb4-scopeitem \.kb4-lab\{[^}]*font-size:\.95em/.test(src), 'the selector’s label carries its own size too')
assert.ok(!/\.kb4-grph\{[^}]*font-size:\.95em/.test(src), 'the header row is back to 1em (a .95em row rescaled its own paddings)')
ok('one icon column of 1.25em, and the smaller voice lives on the label')

// 3. the disclosure is drawn after the label and pushed to the end, so it cannot shift the icon
const labAt = src.indexOf("h('span', { className: 'kb4-lab' }, title)")
const chevAt = src.indexOf("className: 'kb4-grpchev'", labAt >= 0 ? labAt : 0)
assert.ok(labAt >= 0 && chevAt > labAt, 'the group header draws its label before its chevron')
assert.ok(/\.kb4-grpchev\{[^}]*margin-left:auto/.test(src), 'the chevron is pushed to the end of the header')
ok('the disclosure sits at the end of the header, after the label')

// 4. the selector’s 1px border is compensated, so its tile starts exactly where the items’ icon does
assert.ok(/\.kb4-scopebtn,\.kb4-scopeitem\{[^}]*padding:\.25em \.7em \.25em calc\(\.6em - 1px\)/.test(src), 'the selector insets 1px less, and its 1px border makes up the difference')
ok('the border of the selector row does not add a pixel (measured live: 16.4 for both)')

console.log('\n' + pass + ' verifications OK')
