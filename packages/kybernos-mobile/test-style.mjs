// The phone panel's styles must follow the theme: a primary button's text colour is its theme pair, never a literal.
// Measured on the owner's real GUI (2026-10-12): `color: white` on the brand fill, which the Neutre theme makes
// near-white, gave a contrast of 1.05:1: the "Allow" and "Add a phone" buttons looked empty.
//
//   node packages/kybernos-mobile/test-style.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')
let count = 0
const ok = (label, fn) => { fn(); count++; console.log('ok  ', label) }

const rule = (selector) => {
  const start = source.indexOf('\n' + selector + '{')
  assert.notEqual(start, -1, selector + ' is defined')
  return source.slice(start, source.indexOf('}', start))
}

ok('the primary button takes its text colour from the theme, not a literal white', () => {
  const css = rule('.kbmr-primary')
  assert.match(css, /color:var\(--dsw-alias-label-primary-foreground/, 'the label colour is the button pair')
  assert.doesNotMatch(css.replace(/var\([^)]*\)/g, ''), /color:\s*(white|#fff\b|#ffffff)/i, 'no literal white left outside a fallback')
})

ok('the primary fill is the theme\'s button fill (the brand token is only the fallback)', () => {
  assert.match(rule('.kbmr-primary'), /background:var\(--dsw-alias-button-primary-fill/)
})

console.log(`\n${count} tests passed`)
