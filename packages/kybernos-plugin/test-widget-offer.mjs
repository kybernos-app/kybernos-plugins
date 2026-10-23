#!/usr/bin/env node
// The website widget is only offered when a host really serves its script (audit 2026-10-16, A6-25): the Widget tab used to hand out
// `<script src="https://app.kybernos.ai/widget.js" …>` and that host has no DNS record, so a creator could configure a widget, paste the
// snippet into a website and the script never loaded. Source-level, no browser.
//
//   node packages/kybernos-plugin/test-widget-offer.mjs
import { readFileSync } from 'node:fs'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}
const SRC = readFileSync(new URL('./client.js', import.meta.url), 'utf8')

const flag = /const KBW_PUBLIC_RUNTIME = (true|false)\n/.exec(SRC)
const base = /const KBW_EMBED_BASE = '([^']+)'/.exec(SRC)
check('the public-runtime switch and the embed address are declared', flag !== null && base !== null)
const on = flag !== null && flag[1] === 'true'

// The one thing that makes the switch honest: it cannot be on while the address is the one nobody serves.
check('the switch is off while the embed address is app.kybernos.ai (no DNS record, no server half)', on === false || (base !== null && !/app\.kybernos\.ai/.test(base[1])), base && base[1])

// What it takes away when it is off.
check('the « Widget » tab is not in the Agent Team sheet\'s tab bar unless the switch is on', /KBW_PUBLIC_RUNTIME === true \? kbt\('kbw\.tab'\) : null/.test(SRC) && /'Danger Zone'\]\.filter\(\(t\) => t !== null\)/.test(SRC))
const gate = SRC.indexOf('if (KBW_PUBLIC_RUNTIME === true) {')
const after = gate < 0 ? '' : SRC.slice(gate, gate + 900)
check('the composer chip, its styles and the /widget command are mounted only behind the switch', gate > 0 && /KbWidgetChip/.test(after) && /styles\.insert\(KBW_CSS\)/.test(after) && /kbwAssurerSlash\(\)/.test(after))
check('nothing else mounts the chip or registers /widget', (SRC.match(/KbWidgetChip\)\)/g) || []).length === 1 && (SRC.match(/kbwAssurerSlash\(\)/g) || []).length === 1)

// I-06 (action 10 of block 13): the Legal screen READS the route instead of leaving it dead. The terms the widget
// shows are the ones the active server publishes (`GET /kybernos-cloud/legal` — the route `legalLink` hardens and that
// nobody called); the two manual fields stay the source when `{ok:false}`, and are never overwritten.
check('the Legal fields read the active server\'s published terms instead of leaving that route uncalled', /fetch\('\/kybernos-cloud\/legal', \{ cache: 'no-store', credentials: 'same-origin' \}\)/.test(SRC))
{
  // The order is the claim: the two INPUTS come first, the links after them (compared on the field's own text, not on
  // the draft's initialiser, which sits hundreds of lines earlier and would make the assertion pass by accident).
  const fieldTerms = SRC.indexOf('value: draftW.termsUrl')
  const fieldPrivacy = SRC.indexOf('value: draftW.privacyUrl')
  const linkTerms = SRC.indexOf("'data-kb': 'widget-legal-terms'")
  const linkPrivacy = SRC.indexOf("'data-kb': 'widget-legal-privacy'")
  check('what it finds is shown as links, AFTER the two manual fields that stay the fallback', fieldTerms > 0 && fieldPrivacy > fieldTerms && linkTerms > fieldPrivacy && linkPrivacy > linkTerms)
}
check('a server that publishes nothing says so, and the manual fields are then the only source', /'data-kb': legal\.known === true \? 'widget-legal-none' : 'widget-legal-unknown'/.test(SRC) && /kbw\.legal\.none/.test(SRC) && /kbw\.legal\.published/.test(SRC))
check('"we could not read it" is not sold as "it publishes nothing"', /kbw\.legal\.unknown/.test(SRC) && /known: known/.test(SRC) && /const known = j !== null && j\.ok === true/.test(SRC))
check('a url is drawn only over https, or over http to this machine (the host\'s legalLink rule, on the page side)', /\['127\.0\.0\.1', 'localhost', '\[::1\]'\]\.indexOf\(p\.hostname\)/.test(SRC) && /p\.protocol === 'https:'/.test(SRC))

console.log(`\n${pass} ✓  ${fail} ✗`)
process.exit(fail === 0 ? 0 : 1)
