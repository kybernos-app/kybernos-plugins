#!/usr/bin/env node
// Our small controls keep their invisible 24 px hit area (UX audit 2026-10-20, WCAG 2.5.8), checked at source level. No browser; the real
// measure is scripts/check-hit-targets-live.mjs.
//
//   node scripts/test-hit-areas.mjs
//
// A switch, a colour dot, a radio, a chip's cross is drawn smaller than 24 px; an invisible ::before reaches 24 px around it, so the drawing
// does not move. The pseudo-element is placed from the PADDING box: a 1 px border takes one more pixel off each side, which is why the Suite
// switch (36x20, bordered) asks for -3px and the Web Search one (34x20, no border) for -2px.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) console.log('  ✓ ' + name)
  else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}
const PACKAGES = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages')
const read = (b) => readFileSync(join(PACKAGES, b, 'client.js'), 'utf8')
const RULES = [
  ['kybernos-hub', 'the Suite switch', '.kbsu-sw::before{content:"";position:absolute;inset:-3px 0}'],
  ['kybernos-websearch', 'the Web Search switch', '.kwse-switch::before{content:"";position:absolute;inset:-2px 0}'],
  ['kybernos-websearch', 'the reorder arrows (24 wide, reaching out of the pair)', '.kwse-move button:first-child::before{content:"";position:absolute;inset:-6px -5px 0}'],
  ['kybernos-auto', 'the Auto Routing switch', '.kaa-switch-btn::before{content:"";position:absolute;inset:-2px 0}'],
  ['kybernos-auto', 'the cross of a chip', '.kaa-chip button::before{content:"";position:absolute;inset:-5px -4px}'],
  ['kybernos-plugin', 'the Automations switch', '.kba-toggle::before{content:"";position:absolute;inset:-2px 0}'],
  ['kybernos-maintenance', 'the About switch', '.kbmz-sw::before{content:"";position:absolute;inset:-3px 0}'],
  ['kybernos-theme', 'the accent dots', '.kbth-dot::before{content:"";position:absolute;inset:-2px}'],
  ['kybernos-theme', 'the wallpaper category chips', '.kbth-cat::before{content:"";position:absolute;inset:-2px 0}'],
  ['kybernos-composio', 'the provider radio (its ::after draws the checked dot)', '.kbcp-pv-rad::before{content:"";position:absolute;inset:-5px;border-radius:50%}'],
  ['kybernos-skills', 'the Skills link chip', '.kbss-page .kbss-link::before{content:"";position:absolute;inset:-2px 0}'],
]
for (const [b, what, rule] of RULES) check(what + ' (' + b + ')', read(b).includes(rule))
check('the resync tag of the local models', read('kybernos-modeles-locaux').includes(".kbm-resync::before { content: ''; position: absolute; inset: -3px 0; }"))
check('the free-model link is 24 px without moving the line (padding and the opposite margin)', read('kybernos-models').includes('.kbmp-free-lien{color:inherit;text-decoration:none;font-weight:700;display:inline-block;padding:5px 8px;margin:-5px -8px}'))
check('the voice input device caret is 24 px wide (it sits in a group that clips: a ::before would be cut)', read('kybernos-plugin').includes('.kbv-caret{width:24px;'))
process.exit(fail === 0 ? 0 : 1)
