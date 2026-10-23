#!/usr/bin/env node
/** A skill, wherever it is clicked, opens in a window over the page (owner's remark of 2026-10-23: « au click sur un skill, n'importe où, un popup avec les actions
 *  sticky, visibles tout de suite sans scroller »), source-level like test-picks.mjs.
 *  Usage: node packages/kybernos-skills/test-popup.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, 'client.js'), 'utf8')
const between = (a, b) => {
  const i = src.indexOf(a)
  const j = src.indexOf(b, i + 1)
  assert.ok(i >= 0 && j > i, a + ' … ' + b + ' were found')
  return src.slice(i, j)
}

const shell = between('function SkillPopup(props) {', '// « Install ? »')
assert.ok(shell.includes("role: 'dialog', 'aria-modal': 'true', 'aria-label': props.label") && shell.includes("'data-kb': 'skill-popup'"), 'a dialog with a name')
assert.ok(shell.includes("className: 'kb-overlay kbs-win-back', onClick: props.onClose") && shell.includes('onClick: (e) => e.stopPropagation()'), 'a click outside closes it, a click inside does not')
assert.ok(shell.includes("e.key !== 'Escape'") && shell.includes('install-confirm') && shell.includes('delete-confirm') && shell.includes('e.stopPropagation(); props.onClose()'), 'Escape closes it, unless a confirmation above it is open')
assert.ok(shell.includes('box.current.focus()') && shell.includes('before.focus()'), 'focus goes into the window and comes back where it was')
ok('the window is a dialog: Escape, a click outside and ✕ close it, a confirmation above takes Escape first, focus goes in and comes back')

const css = src.slice(src.indexOf('.kbs-root .kbs-win{'), src.indexOf('.kbs-root .kbs-win .kbsf-dacts{margin:0}') + 40)
assert.ok(/\.kbs-win\{width:min\(1000px,96vw\);max-height:92vh;overflow:auto/.test(css), 'the window scrolls, not the page')
assert.ok(/\.kbs-win \.kbs-panel-top\{position:sticky;top:0;/.test(css), 'the name and ✕ stay at the top')
assert.ok(/\.kbs-win \.kbs-panel-acts,\.kbs-root \.kbs-win \.kbs-panel-foot\{bottom:0;/.test(css) && /\.kbs-panel-acts\{position:sticky;bottom:-16px/.test(src), 'the actions stay at the foot')
ok('the name and ✕ are sticky at the top of the window, the actions sticky at its foot: nothing needs a scroll to be reached')

const pop = between('const renderPopup = ', 'const renderModal = ')
for (const what of ['h(SkillPanel', 'renderPickDetail(p)', 'h(DiscoverPanel']) assert.ok(pop.includes(what), what + ' is drawn in the window')
assert.ok((pop.match(/h\(SkillPopup/g) || []).length === 3)
assert.ok(!/setMode\(/.test(pop), 'opening a skill never switches tab')
ok('an installed skill, a pick and a Discover entry or a find all open in the same window, on the tab they were clicked on')

// every click that opens a skill goes through the two states the window reads
const openers = [...src.matchAll(/setDetail\(x\); setLocal\(null\)/g)].length + [...src.matchAll(/setLocal\(s\); setDetail\(null\)/g)].length + [...src.matchAll(/setLocal\(own\)/g)].length
assert.ok(openers >= 6, 'the cards and rows of Featured, Discover and Yours open skills through detail / local (' + openers + ')')
const panels = between('const renderPanel = ', 'const renderPopup = ')
assert.ok(!panels.includes('SkillPanel') && !panels.includes('DiscoverPanel'), 'the side panel keeps only the review and the journal of Kaby\'s suggestions')
ok('the side panel is left to Kaby\'s review and journal; every skill goes to the window')

// The class is global CSS for the page: another bundle's rule of the same name once moved the window out of view (`.kbs-pop` of Sessions made it absolute and translated it by half its width).
const clash = readdirSync(join(here, '..')).filter((d) => d !== 'kybernos-skills' && existsSync(join(here, '..', d, 'client.js'))).filter((d) => /\.kbs-win\b|kbs-win-back/.test(readFileSync(join(here, '..', d, 'client.js'), 'utf8')))
assert.deepEqual(clash, [], 'the window\'s class names are used by no other bundle: ' + clash.join(', '))
ok('the window\'s class names belong to this bundle alone (a global rule of the same name elsewhere moved it out of view once)')

// One layout for the three kinds of window: a pick, an entry of Discover (or a find), a skill of Yours are all drawn by the same sheet
const sheetUsers = [...src.matchAll(/h\(SkillSheet, \{\s*kb: '([a-z-]+)'/g)].map((m) => m[1]).sort()
assert.deepEqual(sheetUsers, ['disc-panel', 'pick-detail', 'skill-panel'])
const sheet = src.slice(src.indexOf('function SkillSheet(props) {'), src.indexOf('const sheetRow = '))
for (const part of ['kbs-panel-top', 'kbsf-dhero', 'kbsf-dpic kbsf-t', 'kbsf-dtitle', 'kbsf-dcols', 'kbsf-dcard kbs-audit', 'kbs-panel-acts kbsf-dacts']) assert.ok(sheet.includes(part), 'the sheet has ' + part)
const twoPanels = src.slice(src.indexOf('function SkillPanel(props) {'), src.indexOf('// Escape closes a confirmation'))
assert.ok(twoPanels.includes('props.art !== undefined ? props.art') && (twoPanels.match(/making: props\.making === true/g) || []).length === 2, 'both take the picture and its state from the page')
assert.ok(!twoPanels.includes('kb-detail-head') && !twoPanels.includes("className: 'kbs-panel'"), 'neither draws its own header or frame any more')
ok('a pick, an entry of Discover or a find, and a skill of Yours are drawn by ONE sheet: top bar, hero with the picture, facts beside audits, SKILL.md, sticky actions')

console.log(pass + ' tests passed')
