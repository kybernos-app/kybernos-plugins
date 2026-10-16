#!/usr/bin/env node
/** V-23 (audit 2026-10-16): the « sources » area of the Skills screens (Settings › Skills › Index source, Discover › Source and the
 *  Index source dialog) read on a phone (390 px) and on a desktop: the guards of the three defects measured in a real GUI, and the
 *  one line that says what a source is. The client is read as text (it is a browser bundle); the pixels are checked by looking.
 *
 *    1. the dialog's Cancel and Save were stacked on two rows at 390 px: the mobile layout reads a row whose FIRST item is a
 *       `flex: 1` spacer as « a setting: text then controls » and gives it 180 px, which pushes Save to a second row. A row of
 *       buttons has no spacer first: the one button that sits on the left (Reset) takes `margin-right: auto` instead.
 *    2. « · Kybernos relay (default) » started its line with an orphan dot when the line wrapped: the dot is a pseudo-element,
 *       off on a narrow screen, not a character of the text.
 *    3. a long folder path pushed the chips of « Writable folders » onto a second row at ragged positions: the path takes what
 *       is left (and ends with an ellipsis), so the chips stay on the row of the path.
 *
 *  Usage: node packages/kybernos-skills/test-sources-css.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, 'client.js'), 'utf8')

// 1. the buttons of the Index source dialog
{
  const from = src.indexOf("data-kb': 'index-source-modal'")
  assert.ok(from > 0, 'the dialog is in the client')
  const actions = src.slice(src.indexOf("className: 'kbs-actions'", from), src.indexOf('// Import modal', from))
  assert.ok(actions.length > 100 && /index-source-save/.test(actions), 'the actions of the dialog were found')
  assert.ok(!/style: \{ flex: '1' \}/.test(actions), 'no flex:1 spacer in the row of buttons (the mobile layout would stack it)')
  assert.ok(/index-source-reset[^\n]*marginRight: 'auto'/.test(actions), 'Reset keeps the left by itself')
  ok('the dialog\'s row of buttons has no spacer: Cancel and Save stay on one row on a phone')
  assert.ok(/\.kbs-root \.kbs-actions\{[^}]*flex-wrap:wrap/.test(src), 'and the row wraps when Reset, Cancel and Save do not fit')
  ok('...and it wraps, rather than overflows, when three buttons do not fit')
}

// 2. the dot before « Kybernos relay (default) »
{
  assert.ok(!/'\u00b7 ' \+ where/.test(src) && !/'· ' \+ where/.test(src), 'the dot is not a character of the text any more')
  assert.ok(/\.kbs-root \.kbs-srcline \.w::before\{[^}]*content:'·'/.test(src) && /\.kbss-page \.kbss-srcline \.w::before\{[^}]*content:'·'/.test(src), 'both source lines draw it as a pseudo-element')
  assert.ok(/@media \(max-width:520px\)\{[^}]*\.kbs-srcline \.w::before\{display:none\}/.test(src.replace(/\n/g, '')), 'and drop it on a narrow screen')
  ok('the dot is a pseudo-element, dropped on a narrow screen: no orphan dot at the start of a wrapped line')
}

// 3. the folders
{
  assert.ok(/\.kbss-page \.kbss-root-row \.p\{[^}]*flex:1 1 220px/.test(src), 'the path has a basis, so it shrinks before the chips wrap')
  ok('a long folder path ends with an ellipsis; the chips stay on its row')
}

// 4. what a source is, in one line
{
  const row = src.match(/^\s+'src\.what': \{ fr: (.+), en: (.+) \},?\s*$/m)
  assert.ok(row !== null, 'the sentence exists in both languages')
  assert.ok(/skills\.sh/.test(row[2]) && /default/i.test(row[2]) && /relay/i.test(row[2]), 'it says where the list comes from and what the default is')
  assert.ok(/t\('src\.what'\)/.test(src.slice(src.indexOf('const sourceCard'), src.indexOf('const rootsCard'))), 'it is on the Settings card')
  assert.ok(/t\('src\.what'\)/.test(src.slice(src.indexOf("data-kb': 'index-source-modal'"), src.indexOf('// Import modal'))), 'and in the dialog')
  assert.ok(!/'set\.srcSub'/.test(src), 'the older, shorter sentence of the card is gone (not said twice)')
  ok('one line says what a source is and where the default comes from, on the card and in the dialog')
}

// 5. the hint under the address field is a sentence, not code
{
  const field = src.slice(src.indexOf("'index-source-input'"), src.indexOf("'index-source-reset'"))
  assert.ok(/className: 'kb8-sub'[^)]*t\('src\.hint'\)/.test(field) && !/kb8-mono[^)]*t\('src\.hint'\)/.test(field), 'the hint is set as text')
  ok('the hint under the address field is text, not a monospace line')
}

console.log('\n' + pass + ' checks passed')
