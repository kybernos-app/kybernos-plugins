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

// The safe areas: inside the phone app the app's own frame already keeps the status bar and the navigation bar out of the web view and Android's WebView reports them again, so a page that
// pads with a bare env() pads twice (measured on a real phone, 2026-10-25: the menu button 44 px too low on top of the page titles, a white band at the top of every page).
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'mobile.css'), 'utf8')
ok('mobile.css never pads with a bare env(): every safe area goes through --kb-sat / --kb-sab', () => {
  const bare = css.split('\n').filter((l) => /env\(safe-area-inset/.test(l) && !/var\(--kb-sa[tb], env\(safe-area-inset-(top|bottom), 0px\)\)/.test(l) && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
  assert.deepEqual(bare, [], 'bare env() left')
})
ok('the app sets both variables to zero, from the first paint (class set by the app) or once the plugin is up', () => {
  assert.match(css, /html\.kb-native-insets,\s*html\.kb-app\s*\{[^}]*--kb-sat:\s*0px;[^}]*--kb-sab:\s*0px;/)
})
ok('the other bundles that pad a fixed box with a safe area use the same variables', () => {
  for (const f of ['../kybernos-usage/client.js', 'client.js']) {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), f), 'utf8')
    const lines = src.split('\n').filter((l) => /env\(safe-area-inset/.test(l))
    assert.ok(lines.every((l) => /var\(--kb-sa[tb],\s*env\(safe-area-inset/.test(l.replace(/\s+/g, ' '))), f + ' has a bare env()')
  }
})

// Responsiveness measured on a real phone with the system's font size at 145 % (2026-10-25).
ok('the new-chat field is tall enough for the two lines of its hint at any text size: its height follows the line height (`lh`), only on the screen that has the hero slots', () => {
  assert.match(css, /\[data-slot="conversation\.composer"\]:has\(\[data-slot\^="conversation\.hero\."\]\) :is\(\[data-composer-input\], \[data-input-scroll\]\) \{\s*min-height: calc\(2lh \+ 4px\) !important;/)
})
ok('a page title and its "How it works" pill wrap instead of squeezing the title onto two lines (the rule belongs to the core plugin, which owns kb6-)', () => {
  const core = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../kybernos-plugin/client.js'), 'utf8')
  assert.match(core, /\.kb6-titlerow\{display:flex;flex-wrap:wrap;/)
  assert.doesNotMatch(css, /\.kb6-titlerow/)
})
ok('the hint of the field in a conversation is small enough to show whole on one line (it was cut at "@ fi…"), the new-chat screen keeps its own size', () => {
  assert.match(css, /\[data-slot="conversation\.composer"\]:not\(:has\(\[data-slot\^="conversation\.hero\."\]\)\) \[data-composer-placeholder\] \{\s*font-size: 12px !important;/)
})

console.log(`\n${count} tests passed`)
