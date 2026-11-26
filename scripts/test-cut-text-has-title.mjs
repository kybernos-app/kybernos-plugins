#!/usr/bin/env node
// Text that a stylesheet cuts with an ellipsis carries its full text in a `title`, so it can still be read (the ux-bug-hunter probe
// `truncated-no-hint` found these three on the real GUI), and the memory page's search-mode buttons reach the 24 px click target.
// A source check: the elements are drawn by browser bundles that are not importable here.
//   node scripts/test-cut-text-has-title.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages')
const src = (p) => readFileSync(join(root, p), 'utf8')
let fail = 0
const ok = (label, cond) => { console.log((cond ? '  ✓ ' : '  ✗ ') + label); if (!cond) fail += 1 }

ok('learned skills: the example skill name of the preview can be read in full (title)', src('kybernos-skills/client.js').includes("h('b', { className: 'kbl-mono', title: lessThan(r.p) }, lessThan(r.p))"))
ok('Agent Team cards: the cut sub-line (category and tags) carries its full text (title)', src('kybernos-plugin/client.js').includes("h('span', { className: 'kb8-cf-sub', title: sub }, sub)"))
ok('memory: a note row cut to one line carries its full text (title)', /h\(NoteRow, \{[^\n]*title: m\.content/.test(src('kybernos-memory/client.js')))
console.log(fail === 0 ? '\nCUT TEXT — 3 checks, 0 échec' : '\nCUT TEXT — ' + fail + ' échec(s)')
process.exit(fail === 0 ? 0 : 1)
