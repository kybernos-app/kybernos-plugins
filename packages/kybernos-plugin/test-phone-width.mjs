#!/usr/bin/env node
/** Pages of the core plugin that did not fit a 390 px phone (audit 2026-10-16, package WP-17).
 *
 *  Source-level (the bundle is a browser module); the matching measurements on the real GUI are in
 *  `node scripts/check-phone-width-live.mjs`, run on a sandbox.
 *
 *  Usage: node packages/kybernos-plugin/test-phone-width.mjs   (exit 0 = all pass; KB_PLUGIN_CLIENT=<file> to test another copy) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const src = readFileSync(process.env.KB_PLUGIN_CLIENT || join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')

// Settings › Tools: the profile card is a column of rows. `.kbt2-stat` wraps (flex-wrap: wrap), and a column that wraps stretches its
// rows to their content width instead of its own: the config path (max 340 px) pushed the copy button 36 px past the card and the
// whole Settings page scrolled sideways at 390 px. The card says « no wrap » where it says « column ».
{
  const cards = [...src.matchAll(/className: '(kbt2-stat[^']*)'[^\n]*style: \{ flexDirection: 'column',([^}]*)\}/g)]
  assert.ok(cards.length >= 2, 'the profile card and its skeleton are where the test expects them (' + cards.length + ')')
  for (const c of cards) assert.match(c[0], /flexDirection: 'column', flexWrap: 'nowrap'/, 'a column card of the Tools page does not wrap: ' + c[1].trim())
  ok('the Tools profile card (and its skeleton) is a column that does not wrap')
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** The body of the stylesheet rule `sel{...}` (a whole line starts with it), or null. */
const rule = (sel) => { const m = new RegExp('(?:^|\\n)' + esc(sel) + '\\{([^}]*)\\}').exec(src); return m === null ? null : m[1] }

// Creations (A4-10, A4-31, C-04): the type tiles are equal tiles in a grid, and on a
// phone ONE strip that slides sideways: ten wrapping tiles took 460 px and put the first creation 976 px down; wrapped in flex rows
// the last ones stretched to half the width each.
{
  const g = rule('.kb-typerow')
  assert.ok(g !== null, 'the type row has a rule')
  assert.match(g, /display:grid/, 'a grid: equal tiles, whatever the count')
  const min = Number(/minmax\((\d+)px,1fr\)/.exec(g)[1])
  assert.match(g, /repeat\(auto-fit,/, 'auto-fit: fewer tiles share the row')
  const gap = Number(/gap:(\d+)px/.exec(g)[1])
  // C-04: the label comes first. « Spreadsheets » (79 px at 11.5 px bold) and « Audio & Video » (80 px) were cut at 1100-1280 px in a 96 px tile
  // (22 px of padding and border): a tile is at least 108 px (the phone strip's width), and what does not fit goes to a second row (the grid keeps the
  // tiles equal, so the one that wraps alone is not stretched). This replaces A4-10's « ten tiles on one row at 1400 px ».
  assert.ok(min >= 80 + 22, 'a tile of ' + min + ' px holds the longest label (80 px) and its padding (22 px)')
  assert.ok(/\.kb-type-line\{display:flex;flex-wrap:wrap;/.test(src), 'the count goes under the label when the tile is narrow')
  assert.ok(!/style: \{ display: 'flex', alignItems: 'baseline', gap: 6, width: '100%' \}/.test(src), 'the label row of a tile is the wrapping one, not an inline nowrap flex')
  assert.doesNotMatch(rule('.kb-type'), /flex:1 1 112px|min-width:112px/, 'a tile has no flex-basis of its own any more (it stretched when it wrapped alone)')
  const at = src.indexOf('@media (max-width:480px){\n.kb-typerow{')
  assert.ok(at > 0, 'a phone block for the type row')
  const phone = src.slice(at, src.indexOf('\n}\n', at))
  assert.match(phone, /\.kb-typerow\{display:flex;overflow-x:auto/, 'on a phone the row is a strip that slides sideways')
  assert.match(phone, /\.kb-typerow>\.kb-type\{flex:0 0 \d+px/, 'its tiles keep their width')
  ok('Creations: equal type tiles in a grid (ten on one row at 1400 px), one scrolling strip on a phone')
}

// A MiniApp / HTML / Markdown card draws its document 1200 px wide and scales it into the card: the phone sheet caps every box at its
// container (max-width:100%), so the 1200 px box became 332 px and was scaled to a 92 px stamp (A4-31). It says max-width:none, and
// the scale follows the card's width (a ResizeObserver), not the width it had when it was mounted.
{
  assert.match(rule('.kb6-minivis-in'), /width:1200px;max-width:none/, 'the miniapp thumbnail is not capped by the phone sheet')
  assert.match(rule('.kb6-live-in'), /width:1200px;max-width:none/, 'nor is the HTML/Markdown one')
  for (const name of ['KbArtMiniVisual', 'KbArtLiveVisual']) {
    const at = src.indexOf('const ' + name + ' = ')
    assert.ok(at > 0, name + ' is where the test expects it')
    const body = src.slice(at, src.indexOf('if (typeof texte !== \'string\'', at))
    assert.match(body, /new ResizeObserver\(calc\)/, name + ' follows the width of its card')
  }
  ok('Creations cards: the thumbnail keeps its 1200 px and its scale follows the card')
}

// Home (A1-06): « Sites, apps, automations » / « Slides, documents, images » were cut by an ellipsis at 1400 px, with no tooltip.
{
  const d = rule('.kb8-nc-d')
  assert.match(d, /-webkit-line-clamp:2/, 'two lines')
  assert.doesNotMatch(d, /white-space:nowrap/, 'it wraps')
  assert.ok(src.includes("h('span', { className: 'kb8-nc-d', title: sub }, sub)"), 'and the full text is a tooltip when it is still cut')
  ok('Home: the description of a card wraps to two lines and carries its full text as a tooltip')
}

// The sidebar rail (A5-29, A5-30): the goal-progress card is hidden in the 44 px icon rail, and each page icon names itself.
{
  assert.ok(src.includes('[class*="collapsed"] .kbp-bar{display:none}'), 'the goal card is hidden in the rail')
  assert.ok(src.includes("className: 'kb4-item' + (active === true ? ' on' : ''), 'aria-label': label, title: label, onClick }"), 'a page row carries its name as aria-label and title (in the rail its label is hidden)')
  ok('Sidebar rail: no clipped goal card; every page icon has a name')
}

// Conversation header at 390 px (A5-17): the Teams chip says when it is empty so that the phone sheet can park it.
{
  assert.ok(src.includes("className: 'kbtg-root', ref: racine, 'data-empty': crews.length === 0 && gateCalls.length === 0 ? '1' : undefined"), 'an empty Teams chip is marked')
  ok('Teams chip: marked data-empty when it counts 0 and has nothing to validate')
}

console.log('\n' + pass + ' checks passed')
