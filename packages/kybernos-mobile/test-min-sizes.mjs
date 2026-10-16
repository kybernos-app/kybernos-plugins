#!/usr/bin/env node
/** The phone sheet's « at least 36-40 px » rules leave switches and round radios their own shape (A3-20, A3-23 of the
 *  2026-10-16 pre-production audit).
 *
 *  Measured at 390 px: every on/off switch of Web Search, Auto Routing, General, About, Suite and Usage was a 40 x 40 rounded
 *  square (a 34 x 20 pill at 1400 px) and the radios of the Connectors page were 40 x 40 squares too, because
 *  `[data-shortcut-modal="settings"] button { min-width: 40px; min-height: 40px }` and its `[data-slot="main"]` twin apply to
 *  every button. A segmented option (a button with role="radio" AND a label) is a button for a finger and keeps its minimum.
 *
 *  Source-level: the sheet is CSS. The matching measurement on the real GUI is `node scripts/check-phone-width-live.mjs`.
 *
 *  Usage: node packages/kybernos-mobile/test-min-sizes.mjs   (exit 0 = all pass; KB_MOBILE_CSS=<file> to test another copy) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const css = readFileSync(process.env.KB_MOBILE_CSS || join(dirname(fileURLToPath(import.meta.url)), 'mobile.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

// every `selector { declarations }` of the sheet, whatever the @media around it
const rules = []
{
  let depth = 0
  let start = 0
  const stack = []
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i]
    if (ch === '{') { stack.push({ head: css.slice(start, i).trim(), from: i + 1 }); depth += 1; start = i + 1 }
    else if (ch === '}') {
      const top = stack.pop()
      depth -= 1
      if (top !== undefined && !top.head.startsWith('@')) rules.push({ selector: top.head, body: css.slice(top.from, i) })
      start = i + 1
    }
  }
  assert.equal(depth, 0, 'balanced braces')
}

/** Split a selector list at its top-level commas (the ones inside :where(...) or [...] stay). */
const splitTop = (list) => { const out = []; let depth = 0; let cur = ''; for (const ch of list) { if (ch === '(' || ch === '[') depth += 1; if (ch === ')' || ch === ']') depth -= 1; if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = '' } else cur += ch } out.push(cur.trim()); return out }
const EXCLUDES = ':not([role="switch"], [role="radio"]:empty, [role="checkbox"])'
/** Rules that give every button a minimum size on the page, the settings modal or the right bar. */
const minSizeRules = rules.filter((r) => /min-(width|height):\s*(3[6-9]|4\d)px/.test(r.body) && splitTop(r.selector).some((s) => /^\s*(\[data-slot="main"\]|\[data-shortcut-modal="settings"\]|\[data-rightbar-col\])\s+button(:where\(.*\))?\s*$/.test(s)))

assert.ok(minSizeRules.length >= 4, 'the sheet has the page / settings / right bar minimum-size rules (' + minSizeRules.length + ' found)')
for (const r of minSizeRules) {
  const bare = splitTop(r.selector).filter((s) => /\sbutton(:where\(.*\))?$/.test(s) && !/:has\(/.test(s))
  for (const s of bare) assert.ok(s.includes(EXCLUDES), 'the minimum size of « ' + s + ' » leaves switches, checkboxes and round radios alone')
}
ok('every « at least 36-44 px » rule on buttons of the page, the settings modal and the right bar excludes switches, checkboxes and round radios')

// a segmented option (a role="radio" button with a label) is not excluded: :empty only matches the label-less dot
assert.ok(EXCLUDES.includes('[role="radio"]:empty'), 'only an EMPTY radio keeps its own shape')
ok('a segmented radio (it has a label) keeps its finger-sized minimum')

// the touch target of those controls grows around them, at zero specificity (the usage switch draws its knob in ::after)
{
  const hit = rules.find((r) => /::before$/.test(r.selector) && /button\[role="switch"\]/.test(r.selector))
  assert.ok(hit !== undefined, 'a hit-area rule for the switch')
  assert.match(hit.selector, /^:where\(/, 'at zero specificity: any control that draws its own knob in ::before wins')
  assert.match(hit.body, /content:\s*""/)
  assert.match(hit.body, /position:\s*absolute/)
  assert.match(hit.body, /inset:\s*-\d+px/, 'it reaches beyond the control')
  assert.ok(!/::after/.test(hit.selector), 'and leaves ::after (the knob of .kbus-sw, the dot of .kbcp-pv-rad) alone')
  ok('the hit area is a ::before pseudo-element at zero specificity')
}

console.log('\n' + pass + ' checks passed')
