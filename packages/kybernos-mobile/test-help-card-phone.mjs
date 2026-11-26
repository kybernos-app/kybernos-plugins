#!/usr/bin/env node
/** The « ? » of a page and the help card it opens, on a phone (the owner's capture of 2026-11-23: the card of Automations was a 44 px strip, one or two letters a line, and the « ? » sat on the
 *  left of its 44 px box).
 *
 *  Measured on the real GUI at 390 px (node scripts/check-help-panel-live.mjs): five causes, each fixed at its source and fixed here as a rule of the code:
 *   1. the touch layer's « every dialog is a bottom sheet » rule (`width:100%`) hit the help card (`role="dialog"`), which hangs inside a wrapper as wide as its 44 px button;
 *   2. the pill is an `inline-flex` WITHOUT `justify-content:center`, so the phone layer's 44 px minimum widened the box and left the « ? » at its start; the pill has five copies;
 *   3. inside a Settings page the touch layer zooms by 1.14: a card sized from the screen (358 px, placed from its button's rectangle) came out 408 px, off the right edge, its ✕ half out;
 *   4. the chat strip's phone sheet (`inset-inline:16px`) lost to the inline offset the Suite computes for a card that hangs from a button: the card sat 296 px left of the screen;
 *   5. the ✕ was 26 px and the card's foot (the article link, « Watch the animation », a page's action) 20-40 px high: under a thumb.
 *
 *  And five more, found by the sweep of every page that has a guide (a scan of what sticks out of the screen or of the box that clips it):
 *   6. the Agent Teams guide holds two three-column tables (a first column of 118 px, a path that cannot break): the third column was cut by the card and the screen;
 *   7. the Language page's rows at 640 px and under are `width:100%` + 46 px of padding in a content box: 46 px too wide, a sideways scrollbar at the foot of the whole Settings page;
 *   8. the ✕ of a page's own guide (Agent Teams 28 px, Automations 32 px) was under a thumb's size;
 *   9. the providers page of Settings (full app): search + « Add provider » + « … » in one row, 12 px too wide at 390 and 57 px at 360;
 *  10. the Theme page's editor (folded): a segmented control of 379 px in a 315 px row, 24 px past the screen in Simple.
 *
 *  Source-level: the sheets are CSS. The measurements on the real GUI (3 widths, 2 languages, light and dark, Simple and the full app) are `node scripts/check-help-panel-live.mjs`.
 *  Usage: node packages/kybernos-mobile/test-help-card-phone.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(here, '..', rel), 'utf8')

/** The declarations of the first rule written as `<selector>{…}` in a source (a CSS string inside a JS file). */
const ruleOf = (src, selector) => {
  const i = src.search(new RegExp('(^|[\\s\'"`}])' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{'))
  assert.ok(i >= 0, 'a rule « ' + selector + ' »')
  const open = src.indexOf('{', i)
  return src.slice(open + 1, src.indexOf('}', open))
}

// 2. the pill, in each of its five copies, keeps its glyph in the middle when a phone widens it
const PILLS = [
  ['kybernos-hub/client.js', '.kbhp-wrap .kbhp-btn'],
  ['kybernos-plugin/client.js', '.kb6-helpbtn'],
  ['kybernos-language/client.js', '.kbln-help-btn'],
  ['kybernos-atlas/client.js', '.kbat-page .kbat-help'],
  ['kybernos-call/client.js', '.kbcl-hl']
]
for (const [file, sel] of PILLS) {
  const body = ruleOf(read(file), sel)
  assert.match(body, /display:inline-flex/, sel + ' is a flex pill')
  assert.match(body, /align-items:center/, sel + ' centres its glyph across')
  assert.match(body, /justify-content:center/, sel + ' centres its glyph along: the phone layer widens the box to 44 px, the « ? » must not stay at its start')
}
ok('every « ? » pill (hub, page header, Language, Atlas, Call) is a flex box that centres its glyph both ways')

// the phone layer: the pills are 44 px, in the card tone, and the card's ✕ and foot are a thumb's size
const css = read('kybernos-mobile/mobile.css').replace(/\/\*[\s\S]*?\*\//g, '')
const rules = []
{
  const stack = []
  let start = 0
  for (let i = 0; i < css.length; i += 1) {
    if (css[i] === '{') { stack.push({ head: css.slice(start, i).trim(), from: i + 1 }); start = i + 1 } else if (css[i] === '}') {
      const top = stack.pop()
      if (top !== undefined && !top.head.startsWith('@')) rules.push({ selector: top.head, body: css.slice(top.from, i) })
      start = i + 1
    }
  }
}
const has = (r, cls) => r.selector.split(',').map((x) => x.trim()).includes(cls)
const rulesFor = (cls) => rules.filter((r) => has(r, cls))
const PILL_CLASSES = ['.kbhp-btn', '.kb6-helpbtn', '.kbln-help-btn', '.kbat-help', '.kbcl-hl']
for (const c of PILL_CLASSES) {
  assert.ok(rulesFor(c).some((r) => /min-width:\s*44px\s*!important/.test(r.body) && /min-height:\s*44px\s*!important/.test(r.body)), c + ' is 44 x 44 on a phone')
  assert.ok(rulesFor(c).some((r) => /background-color:\s*var\(--kbmob-card\)/.test(r.body)), c + ' takes the card tone like its siblings')
}
ok('the five pills are 44 x 44 and drawn in the same card tone on a phone')

{
  const x = rulesFor('.kbhp-x').find((r) => /width:\s*44px/.test(r.body) && /height:\s*44px/.test(r.body))
  assert.ok(x !== undefined, 'the card\'s ✕ is 44 x 44 on a phone')
  assert.match(x.body, /inset-inline-end:\s*4px/, 'at the card\'s corner, inside it (a 44 px box 4 px from the edge)')
  const h4 = rules.find((r) => r.selector === '.kbhp-pop h4')
  assert.ok(h4 !== undefined && /padding-inline-end:\s*44px/.test(h4.body), 'the title leaves room for the ✕')
  ok('the card\'s ✕ is a thumb\'s size, inside the card, and the title leaves it room')
  for (const c of ['.kbhp-link', '.kbhp-replay', '.kbhp-act']) assert.ok(rulesFor(c).some((r) => /min-height:\s*44px/.test(r.body)), c + ' is 44 px high on a phone')
  ok('the foot of the card (article link, « Watch the animation », a page\'s action) is 44 px high')
  const pop = rules.find((r) => r.selector === '.kbhp-pop')
  assert.ok(pop !== undefined && /font-size:\s*16px/.test(pop.body), 'the card reads at the touch layer\'s 16 px')
  ok('the card\'s text is 16 px on a phone')
}

// 1 + 3. the card is no bottom sheet (touch layer), and inside a zoomed Settings page it is brought back to 1
{
  const theme = read('kybernos-theme/client.js')
  assert.match(theme, /const DIALOG = '\[role="dialog"\]:not\(\[data-shortcut-modal\]\):not\(\.kbsr-dlg\):not\(\[data-kb="help-panel"\]\)'/, 'the touch layer\'s « every dialog is a sheet » rule leaves the help card out (by its data-kb hook: the .kbhp- prefix is the hub\'s alone)')
  assert.match(theme, /const TOUCH_ZOOM = 1\.14/)
  assert.match(theme, /'zoom:' \+ TOUCH_ZOOM\]/, 'the Settings pages are zoomed by the constant…')
  assert.match(theme, /\[data-kb="help-panel"\]'\], 'zoom:' \+ \(Math\.round\(1e4 \/ TOUCH_ZOOM\) \/ 1e4\)\]/, '…and the help card inside is zoomed by its inverse: 1.14 × 0.8772 = 1')
  assert.ok(1.14 * (Math.round(1e4 / 1.14) / 1e4) > 0.9999 && 1.14 * (Math.round(1e4 / 1.14) / 1e4) < 1.0001)
  assert.match(theme, /:is\(button:not\(\[role="switch"\]\):not\(\[data-kb="help-button"\]\):not\(\.kbln-help-btn\),select/, 'the Settings pages\' « 48 px high » rule leaves the « ? » pill at 44 px (48 × 1.14 high by 44 × 1.14 wide made it a 55 × 50 rectangle)')
  ok('the touch layer leaves the help card out of its sheets, cancels the Settings zoom inside it and keeps the « ? » pill square')
}

// the card's own bounds: it never grows past the screen whatever a page's generic rule says (`max-width:100%` of a 44 px wrapper)
{
  const body = ruleOf(read('kybernos-hub/client.js'), '.kbhp-pop')
  assert.match(body, /width:min\(420px,calc\(100vw - 32px\)\)/)
  assert.match(body, /max-width:calc\(100vw - 32px\)/, 'an ancestor\'s `max-width:100%` (the phone layer\'s) cannot shrink it to its wrapper\'s width')
  ok('the card states its own width bounds (min 420 px, screen − 32 px)')
}

// 4. the chat strip's phone sheet wins over the inline offset the Suite computes
{
  const kyber = read('kybernos-kyber/client.js')
  assert.match(kyber, /@media \(max-width:520px\)\{\.kbky-strip \.kbky-pillwrap \[data-kb="help-panel"\][^}]*position:fixed;inset-inline:16px!important;/, 'the strip\'s sheet keeps its 16 px sides against an inline `inset-inline-start`')
  ok('the chat strip\'s help sheet keeps its 16 px sides (an inline offset cannot push it off the screen)')
}

// 6 + 8. the Agent Teams guide: each row of its two tables is a small block on a phone, the cell carries its column's name, and the guide's ✕ is a thumb's size
{
  const stack = rules.find((r) => has(r, '.kb8-help td') && has(r, '.kb8-help table') && has(r, '.kb8-help tr') && has(r, '.kb8-help tbody'))
  assert.ok(stack !== undefined && /display:\s*block\s*!important/.test(stack.body) && /width:\s*auto\s*!important/.test(stack.body), 'the table, its rows and its cells are blocks on a phone (a table of three columns does not fit 358 px)')
  const head = rules.find((r) => r.selector === '.kb8-help thead')
  assert.ok(head !== undefined && /display:\s*none/.test(head.body), 'the header row goes: each cell names its own column')
  const label = rules.find((r) => r.selector === '.kb8-help td[data-label]::before')
  assert.ok(label !== undefined && /content:\s*attr\(data-label\)/.test(label.body), 'the cell\'s column name is drawn from its `data-label`')
  assert.ok(!rules.some((r) => r.selector.includes('.kb8-help') && /border[a-z-]*:\s*[1-9]\d*px/.test(r.body)), 'the phone\'s look draws no line (test-style): the rows are told apart by their heading and the air between them')
  const td = rules.find((r) => r.selector === '.kb8-help td')
  assert.ok(td !== undefined && /overflow-wrap:\s*anywhere/.test(td.body), 'a path in a cell breaks instead of pushing the card')
  const src = read('kybernos-plugin/client.js')
  for (const k of ['kbat.col.def', 'kbat.col.runtime', 'kbat.col.what', 'kbat.col.how']) assert.ok(src.includes("{ 'data-label': kbt('" + k + "') }"), 'a cell carries `data-label` = ' + k)
  for (const c of ['.kb8-help-close', '.kba-ob-close']) assert.ok(rulesFor(c).some((r) => /min-width:\s*44px\s*!important/.test(r.body) && /min-height:\s*44px\s*!important/.test(r.body)), c + ' is 44 x 44 on a phone')
  ok('the Agent Teams guide stacks its tables on a phone (a block a row, the column\'s name on each cell) and the ✕ of a page\'s guide is 44 x 44')
}

// 7. the Language page: a full-width row with a start padding counts the padding inside its width
{
  const src = read('kybernos-language/client.js')
  const m = /@media \(max-width:640px\)\{[^]*?\.kbln-lang-act\{([^}]*)\}/.exec(src)
  assert.ok(m !== null, 'the Language page\'s 640 px sheet has a rule for the row\'s actions')
  assert.match(m[1], /width:100%/)
  assert.match(m[1], /padding-inline-start:46px/)
  assert.match(m[1], /box-sizing:border-box/, '`width:100%` + 46 px of padding in a content box was 46 px wider than its row: a sideways scroll of the whole page')
  ok('the Language page\'s row actions keep their padding inside their width (no sideways scroll)')
}

// 9 + 10. two Settings pages the sideways scan found with a « ? »: a row that does not fit a phone must wrap or scroll in its own box, never push the page
{
  const models = read('kybernos-models/client.js')
  const m = /\.kbpv-search\{[^}]*\}',\s*(?:\/\/[^\n]*\n\s*)?'@media \(max-width:600px\)\{\.kbpv-head\{flex-wrap:wrap\}\.kbpv-search\{flex:1 1 100%\}\}'/.exec(models)
  assert.ok(m !== null, 'on a phone the providers page\'s head (search, « Add provider », « … ») wraps: it was 12 px too wide at 390 and 57 px at 360, a sideways scroll of the Settings page')
  const theme = ruleOf(read('kybernos-theme/client.js'), '.kbth-seg')
  assert.match(theme, /max-width:100%/, 'a segmented control of the Theme page (Surfaces, Text, States, Brand: 379 px) never grows past its row')
  assert.match(theme, /overflow-x:auto/, '…it scrolls in its own box instead')
  ok('the providers page\'s head wraps on a phone and the Theme page\'s segmented controls stay in their row (no sideways scroll of the Settings page)')
}

console.log('\n' + pass + ' checks passed')
