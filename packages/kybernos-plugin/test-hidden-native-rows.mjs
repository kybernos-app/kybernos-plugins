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
 *  Two more native entries are hidden the same way (person, 2026-11-18, DSH 0.2.2-rc.5): the « Plugins » row (the
 *  page stays in Settings) and the « Import DeepSeek chats » button that @deepseek-ai/dsh-deepseek-chat-import puts
 *  under the logo. Again no word is read: the Plugins row is the shell's PanelRow whose React key is `plugins`, the
 *  import button is the one drawn by the bundle's ImportSessionsAction (measured on the real DSH, 2026-11-18). The
 *  session-action slot also holds the native new-session button, so the BUTTON is marked, never the slot.
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
import { entry } from './lib-i18n-test.mjs'

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
const { kbIsMoreLauncher, kbHideNativeMoreRow, kbIsNativePluginsRow, kbIsImportChatsButton, kbHideNativeExtraRows, KB_EXTRA_ROWS, kbFindNativeImport, kbSyncImportEntry, KB_WS_ACTIONS, KB_WS_HEADER_CSS, kbSessionFeedbackRow, kbRedirectSessionFeedback } = new Function(block + '\nreturn { kbIsMoreLauncher, kbHideNativeMoreRow, kbIsNativePluginsRow, kbIsImportChatsButton, kbHideNativeExtraRows, KB_EXTRA_ROWS, kbFindNativeImport, kbSyncImportEntry, KB_WS_ACTIONS, KB_WS_HEADER_CSS, kbSessionFeedbackRow, kbRedirectSessionFeedback }')()

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

// 3b. the Plugins row and the import button, as the real DSH draws them (fibers measured on 127.0.0.1:3080, 2026-11-18)
const named = (name) => { const f = function () {}; Object.defineProperty(f, 'name', { value: name }); return f }
/** A React fiber chain from the nearest level to the farthest: [{ name?, key? }] (a level with no name is a DOM node). */
const chain = (levels) => {
  let up = null
  for (let i = levels.length - 1; i >= 0; i -= 1) up = { key: levels[i].key === undefined ? null : levels[i].key, type: levels[i].name === undefined ? 'div' : named(levels[i].name), return: up }
  return up
}
const live = (attrs, levels, parent) => {
  const el = fakeEl(attrs)
  if (levels !== null) el['__reactFiber$test'] = chain(levels)
  el.parentElement = parent === undefined ? null : parent
  return el
}
const entryBox = () => live({ class: 'panelEntry_a1 panelEntryWide_b2' }, null)
const pluginsBox = entryBox()
const pluginsRow = live({ class: 'panelRow_a1b2c3', 'aria-label': 'Plugins' }, [{}, { name: 'Gn' }, {}, { name: 'PanelRow', key: 'plugins' }, { name: 'nav' }], pluginsBox)
const schedulesRow = live({ class: 'panelRow_a1b2c3', 'aria-label': 'Automation tasks' }, [{}, { name: 'Gn' }, {}, { name: 'PanelRow', key: 'schedules' }], entryBox())
const frenchPlugins = live({ class: 'panelRow_a1b2c3', 'aria-label': 'Extensions' }, [{}, { name: 'Gn' }, {}, { name: 'PanelRow', key: 'plugins' }], entryBox())
const notARow = live({ class: 'trigger_x9', 'aria-label': 'Plugins' }, [{}, { name: 'PanelRow', key: 'plugins' }], entryBox())
const importBtn = live({ class: 'trigger_x9 wide_y8', 'aria-label': 'Import DeepSeek chats' }, [{}, { name: 'Gn' }, { name: 'ImportSessionsAction' }, { name: 'RootEntry' }], null)
// the native new-session button, as the real DSH nests it: the chat-import bundle wraps it with the same component, through a HocContentBoundary
const newSessionBtn = live({ class: 'newSession_z7', 'aria-label': 'New session' }, [{}, { name: 'Gn' }, { name: 'HocContentBoundary' }, { name: 'ImportSessionsAction' }, { name: 'RootEntry' }], null)
const plainNewSession = live({ class: 'trigger_x9', 'aria-label': 'New session' }, [{}, { name: 'Gn' }, { name: 'NewSessionAction' }, { name: 'RootEntry' }], null)
assert.ok(kbIsNativePluginsRow(pluginsRow) === true, 'the Plugins row (PanelRow, key « plugins ») is recognised')
assert.ok(kbIsNativePluginsRow(frenchPlugins) === true, 'it is recognised in any language: the key is the same whatever the label says')
assert.ok(kbIsNativePluginsRow(schedulesRow) === false, 'another native row (key « schedules ») is left alone')
assert.ok(kbIsNativePluginsRow(notARow) === false, 'a button that is not a panel row is left alone, whatever its key')
assert.ok(kbIsNativePluginsRow(live({ class: 'panelRow_a1b2c3' }, null)) === false, 'a panel row with no fiber is left alone (the markup moved: the row simply stays)')
assert.ok(kbIsImportChatsButton(importBtn) === true, 'the import button (drawn by ImportSessionsAction) is recognised')
assert.ok(kbIsImportChatsButton(newSessionBtn) === false, 'the native new-session button, wrapped by the same component through a HocContentBoundary, is left alone')
assert.ok(kbIsImportChatsButton(plainNewSession) === false, 'a new-session button with no ImportSessionsAction above it is left alone')
assert.ok(kbIsImportChatsButton(live({ 'aria-label': 'Import DeepSeek chats' }, null)) === false, 'the English label alone does not make a match (a word is never the proof)')
for (const bad of [null, undefined, {}, 'Plugins', 42, { getAttribute: () => { throw new Error('gone') } }]) {
  assert.equal(kbIsNativePluginsRow(bad), false, 'no match, no throw: ' + JSON.stringify(bad))
  assert.equal(kbIsImportChatsButton(bad), false, 'no match, no throw: ' + JSON.stringify(bad))
}
ok('the Plugins row and the import button are recognised by their key and their component, in any language, and nothing else is')

const extraRoot = (list) => ({ querySelectorAll: (sel) => (sel === KB_EXTRA_ROWS ? list : []) })
const rows = [pluginsRow, schedulesRow, notARow, importBtn, newSessionBtn]
assert.equal(kbHideNativeExtraRows(extraRoot(rows)), 2, 'two entries marked on the first pass: the Plugins row and the import button')
assert.ok(pluginsBox.marked() === true && pluginsRow.marked() === false, 'the Plugins row is hidden through its panelEntry box (the box would keep its height otherwise)')
assert.ok(importBtn.marked() === true, 'the import button itself is marked (its slot also holds the new-session button)')
assert.ok(schedulesRow.marked() === false && notARow.marked() === false && newSessionBtn.marked() === false, 'the other rows and buttons are untouched')
assert.equal(kbHideNativeExtraRows(extraRoot(rows)), 0, 'the second pass marks nothing')
const bareBox = live({ class: 'something_else' }, null)
const loneRow = live({ class: 'panelRow_a1b2c3' }, [{}, { name: 'PanelRow', key: 'plugins' }], bareBox)
assert.equal(kbHideNativeExtraRows(extraRoot([loneRow])), 1, 'a Plugins row with no panelEntry box is marked itself')
assert.ok(loneRow.marked() === true && bareBox.marked() === false, 'and its parent is not touched')
assert.equal(kbHideNativeExtraRows({ querySelectorAll: () => { throw new Error('no DOM') } }), 0, 'a root that throws is a no-op')
assert.equal(kbHideNativeExtraRows(null), 0, 'a null root is a no-op')
ok('the marker hides the Plugins entry through its box and the import button itself, once, and never throws')

// 4. what a browser needs is in the source: the CSS rule, the observer, and the right selector on both sides
assert.ok(src.includes('[data-kb-hidden-row]{display:none!important}'), 'the CSS rule that hides a marked element is in the bundle')
assert.ok(src.includes("'kybernos: hide the native « More », « Plugins », chat-import and Workspaces search entries of the sidebar; chat-import icon in the Workspaces header'"), 'the observer effect is registered (taken back with the plugin)')
assert.ok(KB_EXTRA_ROWS === 'button[class*="panelRow"],[data-slot="sidebar.session.action"] button', 'the extra entries are looked up among the panel rows and the session-action buttons, never the whole slot')
assert.ok(src.includes('n.matches(KB_EXTRA_ROWS)') && src.includes('n.querySelector(KB_EXTRA_ROWS)'), 'the observer also wakes for a batch that brings a panel row or a session-action button')
assert.ok(src.includes("kbHideNativeMoreRow(document); kbHideNativeExtraRows(document); kbSyncImportEntry(document, kbt('kbui.import.chats')); return") && /kbSyncImportEntry\(document, kbt\('kbui\.import\.chats'\)\)\n\s+return \(\) => \{\n\s+mo\.disconnect\(\)/.test(src), 'the markers and the import icon run on every worthy batch and once at start, and the observer is taken back with the plugin')
assert.ok(src.includes('querySelectorAll(\'button[aria-haspopup="menu"]\')'), 'the marker queries the launcher selector the shell gives it')
assert.ok(src.includes('n.matches(\'[aria-haspopup="menu"]\')'), 'the observer only looks at batches that bring a menu launcher')
assert.ok(/mo\.observe\([^,]+,\s*\{ childList: true, subtree: true \}\)/.test(src), 'the observer watches added subtrees (the sidebar mounts after us)')
ok('the rule, the registration, the selector and the observed mutations are all in client.js')

// 5. the rows are hidden as a whole: the matcher holds no word of the native dictionaries (the comment above may
//    name them, the code must not: matching on words is what the repo's no-French-literal guard forbade)
for (const word of ['Browse other plugins', 'Create your plugin', 'Parcourir', 'Créez', '创建你的插件']) {
  assert.ok(block.indexOf(word) < 0, 'the matcher carries no native label: ' + word)
}
// the code itself (comments cut away) names no label of the two entries either
const code = block.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
for (const word of ['Import DeepSeek', 'Importer', 'Extensions', '导入']) {
  assert.ok(code.indexOf(word) < 0, 'the code carries no native label: ' + word)
}
assert.ok(!/['"`]Plugins['"`]/.test(code), 'the code carries no « Plugins » string literal (the function names do, the strings do not)')
ok('no native label is hard-coded in the matcher (the launcher is recognised by its markup, never by its words)')

// 6. the shell's hover pin (« Unpin … from sidebar ») is hidden on our menu and on the entry whose row we hide (person, 2026-11-18)
//    On the real DSH (measured): `button.panelUnpin` is a sibling of the entry's `panelRow`, opacity 0 until hover; on the entry that holds
//    `.kb4-menu` it sat over the right end of « New chat », and on the hidden « Automation tasks » entry it stayed as a ghost button.
const pinRule = '[class*="panelEntry"]:has(.kb4-menu) > [class*="panelUnpin"],[class*="panelEntry"]:has(> [data-kb-hidden="schedules"]) > [class*="panelUnpin"]{display:none !important}'
assert.ok(src.includes(pinRule), 'the rule that hides the pin of our menu entry and of the hidden native entry is in the bundle')
assert.ok(src.includes("row.setAttribute('data-kb-hidden', 'schedules')"), 'the marker the second selector relies on is still set by the native-tasks effect')
assert.ok(!/aria-label|from sidebar|Désépingler/.test(pinRule), 'the rule reads no label: only the shell\'s own panelUnpin class')
ok('the hover pin is hidden on our menu entry and on the hidden native entry, by class and not by word')

// 7. the import entry of the Workspaces header, and the native search button we hide there (person, 2026-11-18: option B)
//    Source level, always: the CSS, the observer wake-up, the dictionary entry, the cleanup.
assert.ok(KB_WS_HEADER_CSS.includes('[data-slot="sidebar.workspaces"] [class*="_searchSlot"] button{display:none!important}'), 'the native search button of the Workspaces header is hidden (the search at the top of the sidebar stays), by class and not by word')
assert.ok(KB_WS_HEADER_CSS.includes('[class*="_headerActions"]:has([data-kb="import-chats"]){width:auto!important;max-width:none!important'), 'the icon group is widened only once it holds our icon (the shell caps it at max-width 60 px, measured on the real DSH, which cut the third button off)')
assert.ok(KB_WS_HEADER_CSS.includes('.kb-tip{position:fixed;z-index:1100') && KB_WS_HEADER_CSS.includes('var(--dsw-alias-tooltip-bg') && KB_WS_HEADER_CSS.includes('var(--dsw-alias-tooltip-label'), 'the bubble is drawn with DSH\'s own tooltip tokens (so the theme drives its colours), above the dialogs like DSH\'s portal')
assert.ok(src.includes('n.matches(KB_WS_ACTIONS)') && src.includes('n.querySelector(KB_WS_ACTIONS)'), 'the observer wakes for a batch that brings the Workspaces icon group (it mounts after us)')
assert.ok(entry('kbui.import.chats') !== null && entry('kbui.import.chats').kybernos !== '' && entry('kbui.import.chats').en === 'Import chats…', 'the label is in the dictionary, not in the code')
assert.ok(/querySelectorAll\('\[data-kb="import-chats"\]'\)\.forEach\(\(n\) => n\.remove\(\)\)/.test(src), 'the icon is taken away with the plugin')
ok('the Workspaces header: native search hidden, group widened with our icon, observer wake-up, label in the dictionary, cleanup')

//    With a DOM, when jsdom is importable (KYBERNOS_JSDOM=<path to jsdom/lib/api.js>): the icon is added once, in the right place, and follows the native button.
let JSDOM = null
try { ({ JSDOM } = await import(process.env.KYBERNOS_JSDOM ?? 'jsdom')) } catch (e) { JSDOM = null }
if (JSDOM === null) {
  console.log('  SKIPPED: the import icon on a DOM — jsdom is not importable (set KYBERNOS_JSDOM=<path to jsdom/lib/api.js>)')
} else {
  const dom = new JSDOM('<!doctype html><body>' +
    '<div data-slot="sidebar.session.action"><button id="imp" class="trigger_x9 wide_y8"></button><button id="ns" class="newSession_z7"></button></div>' +
    '<div data-slot="sidebar.workspaces"><div class="x_root"><div class="x_sectionHeader"><span class="x_label"></span>' +
    '<div class="x_searchSlot"><span></span><button id="srch" aria-label="Search sessions"></button></div>' +
    '<div class="x_headerActions"><span><button id="view"></button></span><button id="add" class="x_iconButton x_wide" aria-label="Add workspace"></button></div></div></div></div>' +
    '<div data-slot="sidebar.other"><div class="x_headerActions"><button class="b"></button></div></div></body>')
  const doc = dom.window.document
  const imp = doc.getElementById('imp')
  imp['__reactFiber$t'] = chain([{}, { name: 'Gn' }, { name: 'ImportSessionsAction' }, { name: 'RootEntry' }])
  doc.getElementById('ns')['__reactFiber$t'] = chain([{}, { name: 'Gn' }, { name: 'HocContentBoundary' }, { name: 'ImportSessionsAction' }, { name: 'RootEntry' }])
  assert.equal(kbFindNativeImport(doc), imp, 'the native import button is found among the session-action buttons (the new-session one is not)')
  let clicks = 0
  imp.addEventListener('click', () => { clicks += 1 })
  assert.equal(kbSyncImportEntry(doc, 'Import chats…'), 1, 'one icon added, in the Workspaces header only (another header\'s icon group is left alone)')
  const mine = doc.querySelector('[data-kb="import-chats"]')
  const actions = doc.querySelector('[data-slot="sidebar.workspaces"] .x_headerActions')
  assert.ok(mine !== null && mine.parentElement === actions && mine.nextElementSibling === doc.getElementById('add'), 'it sits in the icon group, right before « Add workspace »')
  assert.ok(mine.getAttribute('aria-label') === 'Import chats…' && mine.querySelector('svg') !== null, 'it has its name and a drawn icon')
  assert.ok(mine.getAttribute('title') === null, 'no native title (DSH-style tooltip below instead: the native one comes late, in another look)')
  assert.ok(/x_iconButton/.test(mine.className) && !/wide/.test(mine.className), 'it borrows the look of « Add workspace », minus its « wide » modifier')
  assert.ok(doc.querySelectorAll('[data-slot="sidebar.other"] [data-kb="import-chats"]').length === 0, 'no icon in the other headers')
  assert.equal(kbSyncImportEntry(doc, 'Import chats…'), 0, 'a second pass adds nothing')
  mine.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  assert.equal(clicks, 1, 'a click on the icon clicks the native import button (hidden or not)')
  // the tooltip: DSH's own look, centred under the button, after a short delay, gone on leaving / click / Escape / removal
  const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms))
  const MouseEv = (t) => new dom.window.MouseEvent(t, { bubbles: false })
  const tipOf = () => doc.querySelector('[data-kb="tip"]')
  mine.dispatchEvent(MouseEv('mouseenter'))
  await sleepMs(150)
  assert.ok(tipOf() === null, 'no tooltip right away (DSH waits about half a second)')
  await sleepMs(500)
  assert.ok(tipOf() !== null && tipOf().textContent === 'Import chats…' && tipOf().getAttribute('role') === 'tooltip' && tipOf().parentElement === doc.body, 'after the delay the bubble shows the name, as a tooltip, on the body (like DSH\'s portal)')
  mine.dispatchEvent(MouseEv('mouseleave'))
  assert.ok(tipOf() === null, 'it goes away when the pointer leaves')
  mine.dispatchEvent(MouseEv('mouseenter')); mine.dispatchEvent(MouseEv('mouseleave'))
  await sleepMs(650)
  assert.ok(tipOf() === null, 'a quick pass shows nothing (the pending bubble is cancelled)')
  mine.dispatchEvent(MouseEv('mouseenter')); await sleepMs(650)
  assert.ok(tipOf() !== null, 'it shows again on a new hover')
  mine.dispatchEvent(MouseEv('mousedown'))
  assert.ok(tipOf() === null, 'a press on the icon takes it away (it must not sit over the dialog that opens)')
  mine.dispatchEvent(MouseEv('mouseenter')); await sleepMs(650)
  mine.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  assert.ok(tipOf() === null, 'Escape takes it away')
  assert.equal(doc.querySelectorAll('[data-kb="tip"]').length, 0, 'never two bubbles at once, none left behind')
  assert.ok(doc.getElementById('srch') !== null && doc.getElementById('view') !== null && doc.getElementById('add') !== null, 'the native buttons themselves are never removed from the DOM (the CSS hides the search one)')
  mine.dispatchEvent(MouseEv('mouseenter')); await sleepMs(650)
  assert.ok(tipOf() !== null, 'a bubble is up on the icon when the native button goes')
  imp.remove()
  assert.equal(kbSyncImportEntry(doc, 'Import chats…'), 1, 'when the native import button is gone (bundle off or renamed) the icon is taken away')
  assert.ok(doc.querySelector('[data-kb="import-chats"]') === null && tipOf() === null, 'no dead icon and no orphan bubble are left behind')
  assert.equal(kbSyncImportEntry(null, 'x'), 0, 'a null root is a no-op')
  assert.equal(kbSyncImportEntry({ querySelectorAll: () => { throw new Error('no DOM') } }, 'x'), 0, 'a root that throws is a no-op')
  dom.window.close()
  ok('on a DOM: the icon is added once before « Add workspace », clicks the native button, and leaves with it')
}

// 8. the « Feedback » row of the conversation's « More actions » menu opens the Kybernos form, not DSH's dialog (person, 2026-11-18)
//    Measured on the real DSH: the four rows of that menu are Zu entries keyed `session-log-download.export/copy`, `…export/download`,
//    `open-in-app.openWith/openWith` and `session-log-download.feedback/…`; the row is recognised by that key, in any language.
const menuRow = (key) => {
  const el = fakeEl({ role: 'menuitem', type: 'button' })
  el.closest = (sel) => (sel === '[role="menuitem"]' ? el : null)
  el['__reactFiber$t'] = chain([{}, { name: 'Gn' }, { name: 'Zu', key }, { name: 'div' }])
  el.sent = []
  el.dispatchEvent = (e) => { el.sent.push(e.type + (e.key ? ':' + e.key : '')); return true }
  return el
}
const clickOn = (el) => { const ev = { target: el, calls: [], preventDefault () { this.calls.push('prevent') }, stopPropagation () { this.calls.push('stop') }, stopImmediatePropagation () { this.calls.push('stopNow') } }; return ev }
const winWith = (formMounted) => {
  const timers = []
  const log = []
  class Ev { constructor (type, init) { this.type = type; this.detail = init ? init.detail : undefined; this.cancelable = !!(init && init.cancelable); this.defaultPrevented = false } preventDefault () { if (this.cancelable) this.defaultPrevented = true } }
  class Kbd { constructor (type, init) { this.type = type; this.key = init.key } }
  return { log, timers, CustomEvent: Ev, Event: Ev, KeyboardEvent: Kbd, setTimeout: (fn) => { timers.push(fn); return 1 },
    dispatchEvent (e) { log.push(e.type + (e.detail && e.detail.probe === true ? ':probe' : '')); if (formMounted && e.type === 'kybernos:menu:feedback' && e.cancelable) e.preventDefault(); return !e.defaultPrevented } }
}
const fbRow = menuRow('session-log-download.feedback/session-9edab6e0')
const copyRow = menuRow('session-log-download.export/copy')
const openInRow = menuRow('open-in-app.openWith/openWith')
assert.equal(kbSessionFeedbackRow(fbRow), fbRow, 'the Feedback row is recognised by the key of its entry')
assert.equal(kbSessionFeedbackRow(copyRow), null, 'Copy as Markdown (key export/copy) is left alone')
assert.equal(kbSessionFeedbackRow(openInRow), null, 'Open in is left alone')
const noFiber = fakeEl({ role: 'menuitem' }); noFiber.closest = () => noFiber
assert.equal(kbSessionFeedbackRow(noFiber), null, 'a row with no fiber is left alone (the markup moved: DSH\'s dialog stays)')
const notMenu = fakeEl({ type: 'button' }); notMenu.closest = () => null
assert.equal(kbSessionFeedbackRow(notMenu), null, 'a button that is not a menu row is left alone, whatever its key')
const labelOnly = menuRow('something.else/x'); labelOnly.textContent = 'Feedback'
assert.equal(kbSessionFeedbackRow(labelOnly), null, 'the word « Feedback » alone is no proof')
for (const bad of [null, undefined, {}, 'Feedback', 42, { closest: () => { throw new Error('gone') } }]) assert.equal(kbSessionFeedbackRow(bad), null, 'no match, no throw: ' + JSON.stringify(bad))

// the form is mounted: DSH's handler is cut, the menu is closed (Escape), then the form opens once
{
  const win = winWith(true); const ev = clickOn(fbRow)
  assert.equal(kbRedirectSessionFeedback(ev, win), true, 'with a form listening, the click is taken over')
  assert.deepEqual(ev.calls, ['prevent', 'stop', 'stopNow'], 'DSH\'s own click handler never runs')
  assert.deepEqual(fbRow.sent, ['keydown:Escape'], 'the menu is closed the way a person closes it')
  assert.deepEqual(win.log, ['kybernos:menu:feedback:probe'], 'only the probe so far (it opens nothing)')
  assert.equal(win.timers.length, 1, 'the form is opened later, once the menu is gone')
  win.timers[0]()
  assert.deepEqual(win.log, ['kybernos:menu:feedback:probe', 'kybernos:menu:feedback'], 'then the real event opens the Kybernos form')
}
// no form mounted (a probe nobody answers): DSH's dialog stays the way in, nothing is cut
{
  const win = winWith(false); const ev = clickOn(menuRow('session-log-download.feedback/x'))
  assert.equal(kbRedirectSessionFeedback(ev, win), false, 'with no form, the click is left to DSH')
  assert.deepEqual(ev.calls, [], 'nothing is stopped or prevented')
  assert.equal(win.timers.length, 0, 'nothing is scheduled')
}
// another row: not even a probe is sent
{
  const win = winWith(true); const ev = clickOn(copyRow)
  assert.equal(kbRedirectSessionFeedback(ev, win), false, 'another menu row is left alone')
  assert.deepEqual(win.log, [], 'no event is sent for it')
  assert.equal(kbRedirectSessionFeedback({ target: null }, win), false, 'a click on nothing is a no-op')
  assert.equal(kbRedirectSessionFeedback(null, win), false, 'a null event is a no-op, never a crash')
  assert.equal(kbRedirectSessionFeedback(clickOn(fbRow), { dispatchEvent: () => { throw new Error('gone') }, CustomEvent: Object }), false, 'a window that throws leaves DSH\'s dialog in place')
}
assert.ok(src.includes("document.addEventListener('click', onClick, true)") && src.includes("'kybernos: the Feedback row of the conversation menu opens the Kybernos form'"), 'the capture-phase listener is registered as an effect (taken back with the plugin)')
assert.ok(/ev\.detail\.probe === true\) return/.test(src) && /ev\.preventDefault\(\) \} catch \(e\) \{ \/\* not an event/.test(src), 'the form answers a probe (cancels the event) and opens nothing for it')
assert.ok(!/['"`]Feedback['"`]/.test(block.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')), 'no « Feedback » string literal in the code')
ok('the conversation menu\'s Feedback row opens the Kybernos form: recognised by key, DSH\'s handler cut, menu closed, form opened once; no form = DSH\'s dialog')

console.log('\n' + pass + ' verifications OK')
