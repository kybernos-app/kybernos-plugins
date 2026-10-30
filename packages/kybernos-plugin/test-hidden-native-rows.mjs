#!/usr/bin/env node
/** The sidebar's native « More » row is hidden — and the way we recognise it is played here.
 *
 *  Why hide it: its menu holds « Browse other plugins » and « Create your plugin », drawn by the native bundle
 *  @deepseek-ai/dsh-client-ui-entry-customization (0.2.2-alpha.2, lib/client.js:78 and :149), and both open the
 *  Plugins page this product does not show (person, 2026-10-30). No engine patch is allowed, so kybernos-plugin
 *  marks the launcher in the DOM and one CSS rule hides it: the row and its menu go away together.
 *
 *  Why the launcher and not the two rows: their words are DSH's, translated in eight languages, and this repo
 *  forbids French literals outside a dictionary (scripts/test-no-french-literals.mjs, which caught the first
 *  version). The launcher, itself, is recognisable without a single word — `aria-haspopup="menu"` plus the shell's
 *  `panelRow` class — and in the sidebar its menu holds those two rows and nothing else (the native bundle fills
 *  the conversation rows for the conversation region only: lib/client.js:40).
 *
 *  Scope: the SIDEBAR launcher only. The conversation and rightbar « More » menus are left alone: they may hold
 *  the folded conversation views, and hiding their rows there is a product decision nobody has taken.
 *
 *  What is played here, with no browser and no jsdom: the matcher and the marker cut out of client.js (the
 *  `<kb-hide-native-rows>` block). The observer itself needs a real DOM; its registration and its selector are
 *  checked in the source, so deleting either one fails this file.
 *
 *  Usage: node packages/kybernos-plugin/test-hidden-native-rows.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

const HERE = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(HERE, 'client.js'), 'utf8')

// ── the block is cut out and evaluated, so the test runs the code production runs ──────────────────────────────
const BEGIN = '// <kb-hide-native-rows>'
const END = '// </kb-hide-native-rows>'
const from = src.indexOf(BEGIN)
const to = src.indexOf(END)
assert.ok(from >= 0 && to > from, 'client.js carries the <kb-hide-native-rows> block, between its two markers')
const block = src.slice(from + BEGIN.length, to)
const { kbIsMoreLauncher, kbHideNativeMoreRow } = new Function(block + '\nreturn { kbIsMoreLauncher, kbHideNativeMoreRow }')()

// ── a fake element: attributes only, which is all the matcher reads ─────────────────────────────────────────────
const fakeEl = (attrs) => {
  const a = Object.assign({}, attrs)
  return {
    textContent: '',
    getAttribute: (k) => (a[k] === undefined ? null : a[k]),
    setAttribute: (k, v) => { a[k] = v },
    marked: () => a['data-kb-hidden-row'] === '1',
    attrs: a,
  }
}
const fakeRoot = (launchers) => ({ querySelectorAll: (sel) => (sel === 'button[aria-haspopup="menu"]' ? launchers : []) })

// 1. what the shell really renders: the sidebar launcher is a panel-row button with aria-haspopup="menu"
const sidebar = fakeEl({ 'aria-haspopup': 'menu', class: 'panelRow_a1b2c3', 'aria-label': 'More' })
assert.ok(kbIsMoreLauncher(sidebar) === true, 'the sidebar launcher (aria-haspopup + panelRow + module hash) is recognised')
// the chat header's own « More » is not a panel row: it is left alone, folded views may live there
const header = fakeEl({ 'aria-haspopup': 'menu', class: 'headerMore_d4e5f6', 'aria-label': 'More' })
assert.ok(kbIsMoreLauncher(header) === false, 'the chat header’s « More » (no panelRow class) is left alone')
// a panel row that opens no menu (our own kybers-menu row) is not a launcher
const row = fakeEl({ class: 'panelRow_a1b2c3' })
assert.ok(kbIsMoreLauncher(row) === false, 'a panel row with no aria-haspopup (our menu row) is left alone')
ok('the matcher recognises the sidebar launcher and nothing else')

// 2. holes and rubbish never crash the matcher (it runs on every DOM batch)
for (const bad of [null, undefined, {}, { getAttribute: () => { throw new Error('gone') } }, 'More', 42]) {
  assert.equal(kbIsMoreLauncher(bad), false, 'no match, no throw: ' + JSON.stringify(bad))
}
ok('a null, a string, a number or an element that throws is a no-match, never a crash')

// 3. the marker: the sidebar launcher marked once, the header one untouched, a second pass marks nothing
const root = fakeRoot([sidebar, header, row])
assert.equal(kbHideNativeMoreRow(root), 1, 'exactly one launcher marked on the first pass')
assert.ok(sidebar.marked() === true, 'the sidebar launcher carries data-kb-hidden-row="1" (the CSS rule hides it)')
assert.ok(header.marked() === false && row.marked() === false, 'the header launcher and our menu row are untouched')
assert.equal(kbHideNativeMoreRow(root), 0, 'the second pass marks nothing (the observer runs on every added launcher)')
assert.equal(kbHideNativeMoreRow({ querySelectorAll: () => [] }), 0, 'a document with no launcher is a no-op')
assert.equal(kbHideNativeMoreRow({ querySelectorAll: () => { throw new Error('no DOM') } }), 0, 'a root that throws is a no-op, never a crash')
assert.equal(kbHideNativeMoreRow(null), 0, 'a null root is a no-op')
ok('the marker marks the sidebar launcher once, leaves the other menus alone, and never throws')

// 4. what a browser needs is in the source: the CSS rule, the observer, and the right selector on both sides
assert.ok(src.includes('[data-kb-hidden-row]{display:none!important}'), 'the CSS rule that hides a marked element is in the bundle')
assert.ok(src.includes("'kybernos: hide the native « More » row of the sidebar'"), 'the observer effect is registered (taken back with the plugin)')
assert.ok(src.includes('querySelectorAll(\'button[aria-haspopup="menu"]\')'), 'the marker queries the launcher selector the shell gives it')
assert.ok(src.includes('n.matches(\'[aria-haspopup="menu"]\')'), 'the observer only looks at batches that bring a menu launcher')
assert.ok(/mo\.observe\([^,]+,\s*\{ childList: true, subtree: true \}\)/.test(src), 'the observer watches added subtrees (the sidebar mounts after us)')
ok('the rule, the registration, the selector and the observed mutations are all in client.js')

// 5. the rows are hidden as a whole: the matcher holds no word of the native dictionaries (the comment above may
//    name them, the code must not: matching on words is what the repo's no-French-literal guard forbade)
for (const word of ['Browse other plugins', 'Create your plugin', 'Parcourir', 'Créez', '创建你的插件']) {
  assert.ok(block.indexOf(word) < 0, 'the matcher carries no native label: ' + word)
}
ok('no native label is hard-coded in the matcher (the launcher is recognised by its markup, never by its words)')

console.log('\n' + pass + ' verifications OK')
