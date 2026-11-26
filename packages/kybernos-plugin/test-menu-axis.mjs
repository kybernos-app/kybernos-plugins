#!/usr/bin/env node
/** One icon column, one label column, in the sidebar menu — the workspace selector included.
 *
 *  The person, 2026-10-30: « dans le menu, il faudrait que les icônes et les titres soient alignés (collapsé ou non) ».
 *  Measured on a capture before the fix: a header label sat 34 px right of the items' and the workspace selector
 *  « Real estate agency » 8 px right (its own inset, plus a 1.65em tile where the items reserve 1.25em). The header (the
 *  « Business » group) has since gone: the menu is fixed and the declared rows are drawn flat, as items.
 *
 *  This file keeps the invariants in the source: one inset, one gap, one icon box of 1.25em.
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

// 1. the item has one inset and one gap
{
  const body = rule('.kb4-item{')
  assert.ok(/padding:[^;]*\.6em/.test(body) || /padding-left:calc\(\.6em - 1px\)/.test(body), '.kb4-item starts its content at .6em (' + body.slice(0, 90) + ')')
  assert.ok(/gap:\.5em/.test(body), '.kb4-item uses the .5em gap')
}
ok('the item has one inset and one gap')

// 2. one icon box
assert.ok(/\.kb4-ico\{[^}]*width:1\.25em/.test(src), 'the items’ icon sits in a fixed 1.25em box')
ok('one icon column of 1.25em')

// 3. one end-of-row indicator slot (.kb4-end), label truncated before it, no contradictory .kb4-dot rules
{
  const lab = rule('\n.kb4-lab{')
  assert.ok(/flex:1/.test(lab) && /min-width:0/.test(lab) && /overflow:hidden/.test(lab) && /text-overflow:ellipsis/.test(lab) && /white-space:nowrap/.test(lab), '.kb4-lab truncates with ellipsis before the end slot (' + lab + ')')
  const end = rule('\n.kb4-end{')
  assert.ok(/flex:none/.test(end) && /display:inline-flex/.test(end) && /align-items:center/.test(end) && /justify-content:center/.test(end) && /min-width:16px/.test(end) && /margin-inline-start:auto/.test(end), '.kb4-end reserves a consistent end-of-row slot (' + end + ')')
  assert.ok(/\.kb4-end \.kb-ping\{margin:0\}/.test(src), '.kb-ping has no extra horizontal offset inside .kb4-end')
  assert.ok(/\.kb4-end \.kb-rowstate\{[^}]*margin-inline-start:0/.test(src), '.kb-rowstate has no extra start offset inside .kb4-end')
  const dotBaseRules = src.match(/(?:^|\n)\.kb4-dot\{[^}]*\}/g) || []
  assert.equal(dotBaseRules.length, 1, 'exactly one base .kb4-dot rule exists (no contradictory duplicate)')
  assert.ok(!/margin-inline-start:/.test(dotBaseRules[0]), 'the base .kb4-dot rule does not fight the end slot with its own margin-inline-start')
  assert.ok(/\.kb4-badge\{display:none\}/.test(src), 'legacy numeric menu badges stay hidden')
  assert.ok(/h\('span', \{ className: 'kb4-end' \}, extra === undefined \? null : extra\)/.test(src), 'row() renders every indicator inside the shared .kb4-end slot')
  assert.ok(/\[class\*="collapsed"\] \.kb4-menu \.kb4-end:empty\{display:none !important\}/.test(src), 'empty .kb4-end is hidden in the collapsed icon rail')
  assert.ok(/\[class\*="collapsed"\] \.kb4-menu \.kb4-newchat \.kb4-nct\{display:none !important\}/.test(src), 'collapsed New chat hides its text and keeps only the centered plus')
  assert.ok(/\[class\*="collapsed"\] \.kb4-menu \.kb4-end \.kb-ping::after\{display:none\}/.test(src), 'collapsed pings have no clipped animated halo')
  assert.ok(/\.kb4-menu \.kb-ping\{display:none !important\}/.test(src), 'the menu draws no blue attention dot at all (owner decision), while the running spinner stays')
  assert.ok(/\[class\*="collapsed"\] \[class\*="panelRow"\]:has\(\[data-forge-glyph\]\) > \[class\*="panelTrailing"\]/.test(src), 'the native Code review trailing badge has a dedicated collapsed position')
  assert.ok(/html:not\(\[data-kb-domain="dev"\]\) \[class\*="panelRow"\]:has\(\[data-forge-glyph\]\)\{display:none !important\}/.test(src) && /document\.documentElement\.setAttribute\('data-kb-domain', kbDomainPack === null \? 'none' : String\(kbDomainPack\.id\)\)/.test(src), 'Code review follows the Development pack through a stable DOM hook')
}
ok('one end-of-row indicator slot (.kb4-end), label truncated before it, single .kb4-dot definition, hidden legacy badges')

console.log('\n' + pass + ' verifications OK')
