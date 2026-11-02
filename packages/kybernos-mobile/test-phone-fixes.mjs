#!/usr/bin/env node
/** Two phone-width defects of the sheet itself (audit 2026-10-16, package WP-17): A1-20 and A5-17.
 *
 *  A1-20 — at 390 px the native session search of the drawer opened as an icon-only pill: its field was 4 px wide. Measured: the
 *  box that holds the field and its two 36 px buttons matched `[data-slot="sidebar"] div:has(> button > svg:only-child)`, which says
 *  `width: auto !important` (so that the boxes of icon buttons follow the icons); `auto` made it 80 px. The sheet's own rule caused
 *  it, not the engine: with the rule removed the field is 184 px. The rule now leaves a box that holds a field alone.
 *
 *  A5-17 — the chat title was cut to 80 px by a « Teams 0 » chip (72 px) with nothing in it. An empty chip (`data-empty="1"`, set by
 *  the core plugin) is parked like the other actions the header has no room for, and the title carries its full text as a tooltip.
 *
 *  Source-level; the matching measurement on the real GUI is `node scripts/check-phone-width-live.mjs`.
 *
 *  Usage: node packages/kybernos-mobile/test-phone-fixes.mjs   (exit 0 = all pass; KB_MOBILE_DIR=<dir with mobile.css and client.js> to test another copy) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = process.env.KB_MOBILE_DIR || dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(dir, 'mobile.css'), 'utf8')
const client = readFileSync(join(dir, 'client.js'), 'utf8')
let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

{
  const at = css.indexOf('width: auto !important')
  assert.ok(at > 0, 'the icon-box rule is there')
  const head = css.slice(css.lastIndexOf('}', at), at)
  const sels = head.split('\n').filter((l) => /has\(> (button|span > button|div > button) > svg:only-child\)/.test(l))
  assert.equal(sels.length, 3, 'its three selectors')
  // the collapsed search holds its field too (tabindex -1, 0 px): excluding every box with a field put back the 28 px boxes that
  // clipped the 36 px magnifier (the mobile tour: « Search sessions [168..204] cut by its container »). Only a REACHABLE field counts.
  for (const s of sels) assert.ok(s.includes(':where(:not(:has(> input:not([tabindex="-1"]))))'), 'a box that holds a reachable field is not an icon box: ' + s.trim())
  ok('the sidebar icon-box rule (width: auto !important) leaves the expanded session search alone (not the collapsed one)')
}

{
  assert.ok(css.includes('.kbtg-root[data-empty="1"]'), 'the empty Teams chip is in the parked list')
  const at = css.indexOf('.kbtg-root[data-empty="1"]')
  const rest = css.slice(at, css.indexOf('}', at))
  assert.match(rest, /position: fixed !important/, 'parked like the others (fixed, invisible, still rendered)')
  assert.match(rest, /opacity: 0 !important/)
  ok('an empty Teams chip is parked in the conversation header (it is still listed by the « … » sheet)')
}

{
  assert.match(client, /nav\[aria-label\]'\)\n\s+if \(name !== null && name !== undefined\) \{\n\s+const full = String\(name\.textContent/, 'the title is read')
  assert.ok(client.includes("name.setAttribute('title', full)"), 'and written as a tooltip')
  ok('the chat title carries its full text as a tooltip on a phone')
}

// R-A5-05 — the failed-turn row of the engine keeps its desktop grid on a phone: text in a ~150 px column, code in a column of its own
{
  const at = css.indexOf('[data-chat-flow-kind="turn-error"] [role="status"] {')
  assert.ok(at > 0, 'the failed-turn row has a rule')
  const body = css.slice(at, css.indexOf('}', at))
  assert.ok(/grid-template-columns:\s*10px minmax\(0, 1fr\) !important/.test(body), 'two columns: the dot and the whole width for the text')
  const code = css.slice(css.indexOf('> :nth-child(n + 3) {', at))
  assert.ok(/grid-column:\s*2/.test(code.slice(0, code.indexOf('}'))), 'the error code goes under the text, in the text column')
  assert.ok(css.lastIndexOf('@media', at) < at && css.slice(css.lastIndexOf('@media', at), at).includes('(max-width: 700px)'), 'it sits in the phone block')
  ok('the failed-turn row uses the whole width of the screen on a phone (R-A5-05)')
}

console.log('\n' + pass + ' checks passed')
