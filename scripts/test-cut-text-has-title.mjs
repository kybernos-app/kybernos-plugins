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
ok('memory: the Relevance / Meaning buttons are 24 px high, the click target floor', /\.kbmem-modes button\{[^}]*height:24px/.test(src('kybernos-memory/client.js')))
// The page title starts at the same y on every Settings page (54 px); the memory page's title box was 23.4 px tall in a 30 px row, centred, so it started 3.3 px lower.
ok('memory: the page title is as tall as the 30 px row it sits in (so it starts where the other pages\' titles do)', /\.kbmem-h1\{[^}]*line-height:30px/.test(src('kybernos-memory/client.js')))
console.log(fail === 0 ? '\nCUT TEXT — 4 checks, 0 échec' : '\nCUT TEXT — ' + fail + ' échec(s)')
process.exit(fail === 0 ? 0 : 1)
