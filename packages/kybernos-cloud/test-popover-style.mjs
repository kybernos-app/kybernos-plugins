// The sidebar's popover must fit the card it opens from. Measured on the owner's real GUI (2026-10-12): `width:252px`
// on a content-box element with 8px padding and a border made it 274 px wide in a 256 px card, so its right edge
// was cut off by the next column.
//
//   node packages/kybernos-cloud/test-popover-style.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')
const start = source.indexOf('\n.kbf-pop{')
assert.notEqual(start, -1, '.kbf-pop is defined')
const css = source.slice(start, source.indexOf('}', start))

assert.match(css, /box-sizing:border-box/, 'padding and border are inside the width')
assert.match(css, /width:min\(252px,\s*100%\)/, 'never wider than the card it opens from')
console.log('ok   the sidebar popover fits its card\n\n1 tests passed')
