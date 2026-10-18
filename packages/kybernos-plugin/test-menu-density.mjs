#!/usr/bin/env node
// The main menu (sidebar): its size follows the chat's text size and it wastes no room — the CSS promises, pinned without a browser.
// The measured result is checked against the real GUI (scripts/check-menu-density-live.mjs).
//
//   node packages/kybernos-plugin/test-menu-density.mjs
import { readFileSync } from 'node:fs'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}
const SRC = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
const CLOUD = readFileSync(new URL('../kybernos-cloud/client.js', import.meta.url), 'utf8')
const rule = (src, sel) => { const at = src.indexOf('\n' + sel + '{'); if (at < 0) return null; return src.slice(at + 1, src.indexOf('}', at) + 1) }

console.log('the menu is drawn in em of the chat text size')
const menu = rule(SRC, '.kb4-menu')
check('the menu takes the chat text size from the engine (--dsh-content-font-size on <body>, 13px when unknown)', menu !== null && /font-size:var\(--dsh-content-font-size,13px\)/.test(menu), menu)
const SIZED = ['.kb4-newchat', '.kb4-plus', '.kb4-ncol', '.kb4-nct', '.kb4-ncs', '.kb4-item', '.kb4-ico', '.kb4-isvg', '.kb4-badge', '.kb4-split .kb4-chevbtn']
const px = SIZED.filter((s) => { const r = rule(SRC, s); return r === null || /(^|[;{ ])(font-size|width|height|min-height|padding|margin|gap):[^;}]*\d+(\.\d+)?px/.test(r) })
check('every size of the menu\'s rows (font, height, padding, gap, icon) is in em, none in px', px.length === 0, px)
const item = rule(SRC, '.kb4-item') || ''
check('a row of the menu has the chat text size itself (1em), not the fixed 15px it had', /font-size:1em/.test(item) && !/font-size:15px/.test(item))
check('and a height in em, so a bigger text gets a taller row', /min-height:2\.25em/.test(item), item)
check('New chat is one line: the name, then the agent it starts with, in a smaller size', /flex-direction:row/.test(rule(SRC, '.kb4-ncol') || '') && /\.kb4-ncs::before\{content:"· "\}/.test(SRC))
check('touch screens keep a 44px target', /@media \(pointer:coarse\)\{\.kb4-item,\.kb4-newchat\{min-height:44px\}\}/.test(SRC))
check('the collapsed rail keeps its own 36px sizes (its rules come after, and win)', /\[class\*="collapsed"\] \.kb4-menu \.kb4-item\{width:36px;height:36px/.test(SRC))

console.log('the blocks of the shell around it')
check('one variable carries the size for them (--kb-u, from the same engine value)', /body\{--kb-u:var\(--dsh-content-font-size,13px\)\}/.test(SRC))
const logo = /\[class\*="_logoRow"\]\{([^}]*)\}/.exec(SRC)
check('the logo row is about three text heights, not 60px for a 24px logo', logo !== null && /height:calc\(var\(--kb-u\)\*3\.2\)/.test(logo[1]) && /padding-block:0/.test(logo[1]), logo && logo[1])
for (const [what, sel, mult] of [['the Workspaces header', '[class*="_regionArea"] [class*="_sectionHeader"]', '2.4'], ['a workspace row', '[class*="_regionArea"] [class*="_treeBody"] [class*="_projectRow"]', '2.4'], ['a session row', '[class*="_regionArea"] [class*="_treeBody"] [class*="_sessionRow"]', '2.2']]) {
  const r = rule(SRC, sel)
  check(what + ' is ' + mult + ' text heights', r !== null && new RegExp('height:calc\\(var\\(--kb-u\\)\\*' + mult.replace('.', '\\.') + '\\)').test(r), r)
}
check('their text follows the size too', /\[class\*="_treeBody"\] \[class\*="_title"\]\{font-size:var\(--kb-u\)/.test(SRC))
check('touch screens keep 44px rows in the workspace list', /@media \(pointer:coarse\)\{\[class\*="_regionArea"\][^}]*height:44px\}\}/.test(SRC))

console.log('the account card at the foot of the menu (kybernos-cloud)')
const card = rule(CLOUD, '.kbfp-card') || ''
check('the card takes the chat text size and its paddings are in em', /font-size:var\(--dsh-content-font-size,13px\)/.test(card) && !/padding:\d+px/.test(card), card)
check('its tile, name, plan line and meter follow it', /\.kbfp-tile\{[^}]*width:2\.5em/.test(CLOUD) && /\.kbfp-cardname\{[^}]*font-size:1em/.test(CLOUD) && /\.kbfp-cardsub\{[^}]*font-size:\.9em/.test(CLOUD) && /\.kbfp-usepct\{[^}]*font-size:\.85em/.test(CLOUD))

console.log('\n' + String(pass) + ' verifications, ' + String(fail) + ' failure(s)')
process.exit(fail === 0 ? 0 : 1)
