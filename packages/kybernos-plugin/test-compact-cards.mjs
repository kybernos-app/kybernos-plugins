#!/usr/bin/env node
/** The cards of Workspaces, Agent Teams and the Marketplace are compact, and the Marketplace shows its actions like the
 *  Agent Teams cards do (V-15, V-16 of the 2026-10-16 pre-production audit).
 *
 *  Reported by the owner: « les cartes sont grandes et prennent beaucoup d'espace perdu ». Measured at 1400 px: a Workspaces card
 *  344 x 231 px and a Marketplace card 344 x 214 px for four lines of information (min-height 212 px, a description block that
 *  reserved three lines even for « No description yet. », counters pushed to the bottom, columns of 330 px), and the Marketplace
 *  drew two 43 px buttons (Install, Preview) at all times while the Agent Teams cards hide their actions until hover.
 *
 *  Source-level (the bundle is a browser module): the rules and the markup that make the cards compact. The matching
 *  measurement on the real GUI is `node scripts/check-cards-live.mjs` in a sandbox.
 *
 *  Usage: node packages/kybernos-plugin/test-compact-cards.mjs   (exit 0 = all pass; KB_PLUGIN_CLIENT=<file> to test another copy) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(process.env.KB_PLUGIN_CLIENT || join(here, 'client.js'), 'utf8')

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** The body of the rule `sel{...}` (a whole line of the stylesheet starts with it), or null. */
const rule = (sel) => { const m = new RegExp('(?:^|\\n)' + esc(sel) + '\\{([^}]*)\\}').exec(src); return m === null ? null : m[1] }
/** The text of the `@media (...) { ... }` block of the stylesheet (it starts at a line of its own) that holds `needle`. */
const media = (query, needle) => {
  for (let at = src.indexOf('\n@media ' + query + '{\n'); at >= 0; at = src.indexOf('\n@media ' + query + '{\n', at + 1)) {
    const block = src.slice(at, src.indexOf('\n}\n', at))
    if (block.includes(needle)) return block
  }
  return null
}

// 1. the grid: four columns fit in the 1064 px a page leaves at 1400 px (measured), and only the compact grids change
{
  const g = rule('.kb8-grid.kb8-cmp')
  assert.ok(g !== null, 'the compact grid has a rule')
  const min = /minmax\((\d+)px,1fr\)/.exec(g)
  assert.ok(min !== null, 'a minmax() column')
  const gap = Number(/gap:(\d+)px/.exec(g)[1])
  assert.ok(4 * Number(min[1]) + 3 * gap <= 1064, 'four columns of ' + min[1] + ' px (+ gaps of ' + gap + ') fit in 1064 px')
  assert.match(rule('.kb8-grid'), /minmax\(330px,1fr\)/, 'the other grids (Skills, Suite) keep their 330 px columns')
  ok('the compact grid takes four columns at 1400 px; the other grids are untouched')
}

// 2. the card: no forced height, tighter padding, and the description takes the room it needs
{
  const c = rule('.kb8-card.kb8-cmp')
  assert.ok(c !== null, 'the compact card has a rule')
  assert.match(c, /min-height:0/, 'no forced minimum height')
  assert.match(c, /height:auto/, 'not stretched to 100 % of its row cell')
  assert.ok(Number(/padding:(\d+)px/.exec(c)[1]) <= 14, 'padding of 14 px or less')
  assert.match(rule('.kb8-card'), /min-height:212px/, 'the shared card keeps its size for its other users (Skills, folders)')
  const d = rule('.kb8-desc')
  assert.match(d, /-webkit-line-clamp:2/, 'the description is clamped to two lines')
  assert.doesNotMatch(d, /min-height/, 'and reserves no block of its own (it reserved 4.2em)')
  assert.ok(rule('.kb8-cmp .kb8-desc.kb8-none') !== null, 'an empty description has a muted one-line style')
  ok('the compact card has no forced height and a two-line description that reserves nothing')
}

// 3. the markup: the three families carry the modifier, grids and skeletons too
{
  const mustHave = [
    ["className: 'kb8-card kb8-cmp kb8-cmp-top kb8-project kb8-cf'", 'a Workspaces card'],
    ["className: 'kb8-card kb8-cmp kb8-kyber kb8-cf'", 'an Agent Teams card'],
    ["className: 'kb8-card kb8-cmp kb8-cf', key: tpl.id", 'a Marketplace template card'],
    ["className: 'kb8-card kb8-cmp kb8-cf', key: it.slug", 'a kybernos.app catalogue card'],
    ["className: 'kb8-card kb8-cmp kb8-project kb-sk-row'", 'the Workspaces skeleton'],
    ["className: 'kb8-card kb8-cmp kb8-kyber kb-sk-row'", 'the Agent Teams skeleton'],
    ["className: 'kb8-card kb8-cmp kb-sk-row'", 'the catalogue skeleton'],
  ]
  for (const [needle, what] of mustHave) assert.ok(src.includes(needle), what + ' carries kb8-cmp')
  const grids = src.split("className: 'kb8-grid kb8-cmp'").length - 1
  assert.ok(grids >= 8, 'every grid of these cards (6 lists + 3 skeletons, less the shared one) is a compact grid: ' + grids)
  const wsAt = src.indexOf("className: 'kb8-card kb8-cmp kb8-cmp-top kb8-project kb8-cf'")
  assert.ok(!src.slice(wsAt, src.indexOf("'data-kb': 'project-card-actions'", wsAt)).includes('kbui.project.toplevel'), 'the same « Top-level project » subtitle is not repeated on every Workspaces card')
  ok('Workspaces, Agent Teams, Marketplace cards, grids and skeletons all use the compact modifier')
}

// 4. the counters sit in the quiet foot of a Workspaces card (two small figures), not in a pill row and not in a caps sentence under the name
{
  const at = src.indexOf("className: 'kb8-card kb8-cmp kb8-cmp-top kb8-project kb8-cf'")
  const card = src.slice(at, src.indexOf("'data-kb': 'project-card-actions'", at))
  assert.ok(card.indexOf("'data-kb': 'project-counts'") > 0, 'a counters element')
  assert.ok(card.indexOf("className: 'kb8-cf-foot'") > 0 && card.indexOf("className: 'kb8-cf-foot'") < card.indexOf("'data-kb': 'project-counts'"), 'it is in the foot')
  assert.ok(card.indexOf("className: 'kb8-name'") < card.indexOf("className: 'kb8-cf-foot'"), 'under the name')
  assert.ok(!card.includes("className: 'kb8-pills'"), 'no pill row of its own')
  assert.ok(/kbCfFig\(Icon\('messageSquare', 13\)/.test(card) && /kbCfFig\(Icon\('sparkles', 13\)/.test(card), 'the two figures: threads and creations')
  ok('the thread and creation counters are two small figures in the foot')
}

// 5. V-16: the actions of a card show on hover and on focus, always without a hover device and at phone width
{
  const hover = media('(hover:hover)', '.kb8-card .kb8-cardacts')
  assert.ok(hover !== null, 'the hover block of the cards')
  assert.match(hover, /\.kb8-card \.kb8-cardacts\{opacity:0/, 'a card hides its actions at rest on a device with a hover')
  assert.match(hover, /\.kb8-card:hover \.kb8-cardacts,\.kb8-card:focus-within \.kb8-cardacts\{opacity:1\}/, 'and shows them on hover and on keyboard focus')
  assert.match(src, /@media \(hover:hover\)\{\n\.kb8-cmp \.kb8-cardacts\{position:absolute/, 'they are drawn over the foot (no empty band at rest) only where a hover exists')
  assert.match(src, /\.kb8-card\.kb8-cmp:hover \.kb8-cardacts,\.kb8-card\.kb8-cmp:focus-within \.kb8-cardacts\{pointer-events:auto\}/, 'and only clickable once shown')
  const phone = media('(max-width:480px)', '.kb8-cardacts')
  assert.ok(phone !== null, 'a phone-width block for the card actions')
  assert.match(phone, /\.kb8-card\.kb8-cmp \.kb8-cardacts\{position:static;[^}]*opacity:1/, 'at phone width they are in the flow and visible')
  assert.ok(!/@media \(hover:none\)\{[^}]*kb8-cardacts\{[^}]*opacity:0/.test(src), 'no rule hides them on a device with no hover')
  ok('actions: hover and focus on a pointer device, always visible with no hover and below 480 px')
}

// 6. V-16: the Marketplace uses the same container as the Agent Teams cards, with Preview and Install as compact actions (Install is the last, the primary one)
{
  for (const [anchor, last, what] of [["key: tpl.id, 'data-kb': 'market-card'", "kbt('kbui.install')))))", 'a template'], ["key: it.slug, 'data-kb': 'market-card'", "kbt('kbui.market.cloud.install')", 'a catalogue entry']]) {
    const at = src.indexOf(anchor)
    assert.ok(at > 0, what + ' card is where the test expects it')
    const card = src.slice(at, src.indexOf(last, at))
    const acts = card.indexOf("className: 'kb8-cardacts'")
    assert.ok(acts > 0, what + ' card has the .kb8-cardacts container')
    assert.ok(card.indexOf("className: 'kb8-primary'") > acts, 'Install is inside it')
    if (what === 'a template') assert.ok(card.indexOf("className: 'kb8-chip'") > acts && card.indexOf("className: 'kb8-chip'") < card.indexOf("className: 'kb8-primary'"), 'Preview is inside it, before Install')
    assert.ok(!card.includes("marginTop: 'auto'"), 'no plain flex row of big buttons left')
  }
  const cmpBtn = rule('.kb8-cmp .kb8-cardacts .kb8-primary')
  assert.ok(Number(/padding:(\d+)px/.exec(cmpBtn)[1]) <= 6, 'Install is compact (it was 13 px of padding: 43 px high)')
  const rowBtn = rule('.kb8-rf-btns .kb8-primary')
  assert.ok(Number(/padding:(\d+)px/.exec(rowBtn)[1]) <= 6, 'and compact in a list row too')
  ok('Install and Preview live in .kb8-cardacts, compact')
}

// 7. an installed template keeps a visible state at rest (not a greyed button hidden until hover)
{
  const at = src.indexOf("'data-kb': 'market-installed'", src.indexOf("key: tpl.id, 'data-kb': 'market-card'"))
  assert.ok(at > 0, 'an « Installed » figure')
  const foot = src.slice(src.lastIndexOf("className: 'kb8-cf-foot'", at), at)
  assert.ok(!foot.includes("className: 'kb8-cardacts'"), 'in the foot, outside the hover-only actions')
  ok('an installed template shows an « Installed » figure (its word always shown) that does not wait for a hover')
}

console.log('\n' + pass + ' checks passed')
