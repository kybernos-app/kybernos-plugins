#!/usr/bin/env node
// <html lang> is a language tag whatever DSH's shell writes there (A2-20): « kybernos » is not one, and a French interface chosen on the
// Language page was left with lang="en". The guard of client.js (between the <kb-html-lang> markers) is cut out and run against a fake <html>.
//
//   node packages/kybernos-plugin/test-html-lang.mjs
import { readFileSync } from 'node:fs'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}
const SRC = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
const a = SRC.indexOf('// <kb-html-lang>')
const b = SRC.indexOf('// </kb-html-lang>')
if (a < 0 || b < a) { console.log('  ✗ the <kb-html-lang> block is missing from client.js'); process.exit(1) }
const CODE = SRC.slice(a, b)

// A fake <html> whose attribute writes notify a fake MutationObserver, like the browser does (asynchronously, but here at once is enough).
const page = (lang, initial) => {
  const state = { lang: initial, watchers: [] }
  const root = {
    getAttribute: (k) => (k === 'lang' ? state.lang : null),
    setAttribute: (k, v) => { if (k === 'lang' && state.lang !== v) { state.lang = v; for (const w of state.watchers.slice()) w() } },
  }
  const doc = { documentElement: root }
  class MO { constructor(fn) { this.fn = fn } observe() { state.watchers.push(this.fn) } disconnect() {} }
  const resolve = { value: lang }
  new Function('document', 'MutationObserver', 'kbLangResolve', CODE)(doc, MO, () => { if (resolve.value instanceof Error) throw resolve.value; return resolve.value })
  return { state, root, resolve }
}

console.log('French')
{
  const p = page('kybernos', 'en')
  check('the French of Kybernos is lang="fr", not "kybernos" and not "en"', p.state.lang === 'fr', p.state.lang)
  p.root.setAttribute('lang', 'kybernos')
  check('DSH writes its locale id « kybernos » later: it is put back to fr', p.state.lang === 'fr', p.state.lang)
  p.root.setAttribute('lang', 'en')
  check('…and « en » over a French interface too', p.state.lang === 'fr', p.state.lang)
}
{
  const p = page('fr-CA', 'kybernos')
  check('an fr tag stays fr', p.state.lang === 'fr', p.state.lang)
}
console.log('a translated language')
{
  const p = page('ar', 'en')
  check('Arabic is lang="ar"', p.state.lang === 'ar', p.state.lang)
  p.root.setAttribute('lang', 'en')
  check('the shell writing en over it does not stay', p.state.lang === 'ar', p.state.lang)
}
console.log('English and the cases that must not be touched')
{
  const p = page('en', 'en-GB')
  check('English leaves the shell\'s own tag alone (en-GB stays)', p.state.lang === 'en-GB', p.state.lang)
  p.root.setAttribute('lang', 'kybernos')
  check('…but the non-tag « kybernos » never stays: en', p.state.lang === 'en', p.state.lang)
}
{
  const p = page(new Error('not ready'), 'zh')
  check('a resolver that throws touches nothing', p.state.lang === 'zh', p.state.lang)
}

console.log('text blocks in a right-to-left page (A2-26)')
{
  const x = SRC.indexOf('// <kb-rtl-bidi>')
  const y = SRC.indexOf('// </kb-rtl-bidi>')
  check('the <kb-rtl-bidi> block is in client.js', x > 0 && y > x)
  const added = []
  const doc = { head: {}, getElementById: () => null, createElement: () => ({}) }
  doc.head.appendChild = (el) => added.push(el)
  new Function('document', SRC.slice(x, y))(doc)
  const css = added.length === 1 ? String(added[0].textContent) : ''
  check('one style is added, with the isolation of each text block', added.length === 1 && /unicode-bidi:\s*plaintext/.test(css), css.slice(0, 80))
  check('…only under a right-to-left page', /^html\[dir="rtl"\]/.test(css))
  check('…never on code, inputs or buttons', /:not\(pre, code, input, textarea, select, button\)/.test(css))
}

console.log('\n' + String(pass) + ' verifications, ' + String(fail) + ' failure(s)')
process.exit(fail === 0 ? 0 : 1)
