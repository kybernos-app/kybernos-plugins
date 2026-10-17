#!/usr/bin/env node
// The four playback panels (Slides, Modeleur, Bricks, Motion) speak the same transport (audit A4-26 of 2026-10-16, R3-01).
//
// Round 2 had aligned Modeleur and Bricks; Slides still had a lone Play button, no step buttons, no counter and a « live » head badge, and
// Motion had no speeds at all. There is no shared component (decision D2: that waits for the owner's look), so this guards the vocabulary
// each copy of the bar must keep: the same step buttons, the same four speeds written the same way (0.5×, not ×0.5), the same pill at the
// end of the row (Done / Fini), no « live ». Source-level; the look on the real GUI is `node scripts/check-slides-live.mjs` and
// `node scripts/check-motion-live.mjs`.
//
//   node scripts/test-transport-parity.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages')
let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const PANELS = [
  ['Slides', 'kybernos-slides'],
  ['Modeleur', 'kybernos-modeleur'],
  ['Bricks', 'kybernos-bricks'],
  ['Motion', 'kybernos-motion'],
]
// A glyph may be written as the character or as its escape.
const either = (ch, escape) => src => src.includes(ch) || src.includes(escape)

for (const [name, dir] of PANELS) {
  const src = readFileSync(join(root, dir, 'client.js'), 'utf8')
  console.log('\n' + name)
  check('Start and End buttons, in both languages', src.includes("kt('Début', 'Start')") && src.includes("kt('Fin', 'End')"))
  check('the step glyphs are ◀◀ and ▶▶', either('◀◀', '\\u25C0\\u25C0')(src) && either('▶▶', '\\u25B6\\u25B6')(src))
  const asList = /\[0\.5, 1, 2, 4\]/.test(src) && /\$\{v\}(×|\\u00D7)/.test(src)
  const asLiterals = ['0.5', '1', '2', '4'].every((v) => new RegExp("'" + v.replace('.', '\\.') + "(×|\\\\u00D7)'").test(src))
  check('the four speeds 0.5× 1× 2× 4×', asList || asLiterals)
  check('the speeds are never written the other way round (×0.5)', !/(×|\\u00D7)(0\.5|1|2|4)\b/.test(src.replace(/\$\{v\}(×|\\u00D7)/g, '')))
  check('the pill at the end of the row says Done / Fini', src.includes("kt('Fini', 'Done')"))
  check('...and nothing says « live » any more', !/'live'/.test(src))
  check('the play button toggles to a pause glyph or icon', either('⏸', '\\u23F8')(src) || src.includes("Ic(player.playing ? 'pause'"))
}

console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + ', ' + pass + ' passed')
process.exit(fail === 0 ? 0 : 1)
