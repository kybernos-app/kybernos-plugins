#!/usr/bin/env node
/** kybernos-refs: source chips for the links of a chat message.
 *
 *  Reported (owner, 2026-10-15): « parfois je vois 2 tags qui switchent de place et bougent, c'est très perturbant ».
 *  Cause, measured in the code: every pass moved EVERY chip of a block to the end of the block when it was not the last
 *  one; with two chips in a block, each move put the other one out of place, so they swapped forever, and the observer
 *  woke itself on its own moves. Now: one chip per block (first source + « +N », a card lists them all), a pass that
 *  writes nothing when the block is unchanged, and an observer that ignores our own mutations.
 *
 *  Three parts: (1) the pure helpers, cut out of client.js and run as they are (always); (2) source-level guards
 *  (always); (3) the DOM behaviour in jsdom (only when jsdom can be imported: KYBERNOS_JSDOM=<path to its entry>, as
 *  kybernos-flow/test-client.mjs does; it is skipped, and says so, otherwise).
 *
 *  Usage: node packages/kybernos-refs/test-refs.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(process.env.KB_REFS_CLIENT || join(here, 'client.js'), 'utf8')

// ── 1. pure helpers ───────────────────────────────────────────────────────────
const a = src.indexOf('// KB-REFS-PURE-BEGIN')
const b = src.indexOf('// KB-REFS-PURE-END')
assert.ok(a > 0 && b > a, 'the KB-REFS-PURE block exists')
const api = vm.runInNewContext(src.slice(a, b) + '\n;({ siteName, siteHost, hueOf, distinct, chipLabel, signature })', { URL, String, Object, Array })
const link = (href, text) => ({ href, textContent: text === undefined ? '' : text })
{
  assert.equal(api.siteName('www.llm-stats.com'), 'llm-stats')
  assert.equal(api.siteName('arxiv.org'), 'arxiv')
  assert.equal(api.siteName('www.semanticscholar.org'), 'semanticscholar')
  assert.equal(api.siteName('www.bbc.co.uk'), 'bbc', 'a country suffix with a second level (it was « co »)')
  assert.equal(api.siteName('gov.uk'), 'gov')
  assert.equal(api.siteName('shop.example.com.au'), 'example')
  assert.equal(api.siteName('a.b.c.example.org'), 'example')
  assert.equal(api.siteName('localhost'), 'localhost')
  assert.equal(api.siteName(''), 'source')
  assert.equal(api.siteName(null), 'source')
  assert.equal(api.siteName('www.www.com'), 'com', 'never « www »')
  ok('the site name: second-to-last label, country suffixes, never « www », never throws')
}
{
  assert.equal(api.siteHost('https://www.arxiv.org/abs/1?x=1'), 'arxiv.org')
  assert.equal(api.siteHost('not a url'), 'not a url')
  for (const n of ['arxiv', 'semanticscholar', 'a', '']) { const h = api.hueOf(n); assert.ok(Number.isInteger(h) && h >= 0 && h < 360); assert.equal(api.hueOf(n), h) }
  assert.notEqual(api.hueOf('arxiv'), api.hueOf('semanticscholar'), 'two different sites do not collapse on one colour')
  ok('the host and the colour of a site are stable')
}
{
  const l = [link('https://a.com/1', 'one'), link('https://b.com/', 'two'), link('https://a.com/1', 'one again')]
  const d = api.distinct(l)
  assert.equal(d.length, 2); assert.equal(d[0].textContent, 'one'); assert.equal(d[1].href, 'https://b.com/')
  assert.deepEqual(JSON.parse(JSON.stringify(api.chipLabel(d))), { name: 'a', more: 1 })
  assert.deepEqual(JSON.parse(JSON.stringify(api.chipLabel([]))), { name: 'source', more: 0 })
  assert.notEqual(api.signature(d), api.signature([d[0]]), 'a link added by streaming changes the signature')
  assert.notEqual(api.signature([link('https://a.com/1', 'on')]), api.signature([link('https://a.com/1', 'one')]), 'so does a text completed by streaming')
  ok('two identical addresses are one source; the chip says the first and « +N »')
}

// ── 2. source-level guards ────────────────────────────────────────────────────
{
  assert.ok(/records\.every\(isOurs\)/.test(src), 'the observer ignores the mutations of our own nodes')
  assert.ok(/function place\(block, group\)/.test(src) && /group\.parentNode !== block \|\| block\.lastChild !== group/.test(src), 'a group already in place is not moved')
  assert.ok(!/\.append\(cite\)\s*\n\s*}\s*\n\s*return\s*\n/.test(src), 'no per-link « move my chip to the end » any more')
  assert.ok(!/Ouvrir/.test(src), 'no hard-coded French in the card')
  assert.ok(!/fetch\(|XMLHttpRequest|EventSource|sendBeacon/.test(src), 'nothing is fetched: the card shows the link text and the host only')
  ok('the observer ignores itself, a placed group is not moved, no hard-coded language, no network')
}

// ── 3. DOM behaviour (jsdom, optional) ────────────────────────────────────────
let JSDOM = null
try { ({ JSDOM } = await import(process.env.KYBERNOS_JSDOM ?? 'jsdom')) } catch (e) { JSDOM = null }
if (JSDOM === null) {
  console.log('  - jsdom is not importable: the DOM part is skipped (set KYBERNOS_JSDOM=<path to jsdom/lib/api.js>)')
} else {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const html = '<!doctype html><body>' +
    '<div class="_markdown_x">' +
    '<ul><li id="a">Claim one. <a href="https://arxiv.org/abs/1">Paper A</a> <a href="https://arxiv.org/abs/2">Paper B</a></li>' +
    '<li id="b">Claim two. <a href="https://www.semanticscholar.org/p">Semantic</a></li>' +
    '<li id="n">Parent <ul><li>child</li></ul><a href="https://example.com/p">Ex</a></li></ul>' +
    '<p id="c">Same twice <a href="https://x.com/1">x</a> <a href="https://x.com/1">x again</a></p>' +
    '<pre id="code"><a href="https://code.example/1">in code</a></pre>' +
    '</div>' +
    '<div id="outside"><a href="https://outside.example/1">outside</a></div>' +
    '</body>'
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://127.0.0.1:3080/' })
  const w = dom.window
  let def = null
  w.__ModuleLoader__ = { load (d) { def = d } }
  w.eval(src)
  assert.ok(def !== null && def.id === '@local/kybernos-refs', 'the module registers itself')
  const plugin = def.factory()
  assert.equal(typeof plugin.apply, 'function', 'the factory returns a plugin (runner contract)')
  plugin.apply()
  const doc = w.document
  const $ = (s) => doc.querySelector(s)
  const cites = (s) => Array.from($(s).children).filter((c) => c.classList.contains('kyb-refs-cite'))

  assert.equal(cites('#a').length, 1, 'ONE chip for the two links of a block (they used to be two chips that swapped)')
  const chipA = cites('#a')[0].querySelector('.kyb-refs-chip')
  assert.equal(chipA.querySelector('.kyb-refs-name').textContent, 'arxiv')
  assert.equal(chipA.querySelector('.kyb-refs-more').textContent, '+1')
  assert.deepEqual(Array.from(cites('#a')[0].querySelectorAll('.kyb-refs-title')).map((t) => t.textContent), ['Paper A', 'Paper B'], 'the card lists the sources in document order')
  assert.equal(cites('#b').length, 1); assert.equal(cites('#b')[0].querySelector('.kyb-refs-more'), null, 'a single source has no « +N »')
  assert.equal(cites('#c').length, 1); assert.equal(cites('#c')[0].querySelectorAll('.kyb-refs-row').length, 1, 'the same address twice is one source')
  assert.equal($('#code a').hasAttribute('data-kyb-replaced'), false, 'a link in code is left alone')
  assert.equal($('#outside a').hasAttribute('data-kyb-replaced'), false, 'a link outside a message is left alone')
  const nested = cites('#n')[0]
  assert.ok(nested !== undefined && nested.nextElementSibling !== null && nested.nextElementSibling.tagName === 'UL', 'in an item with a nested list the chip ends the item\'s own text, before the nested list')
  ok('one chip per block, in order, deduplicated, code and outside links untouched, nested lists respected')

  // idempotence: a pass over an unchanged page writes nothing, and nothing keeps moving
  const records = []
  const watcher = new w.MutationObserver((r) => { for (const x of r) records.push(x) })
  watcher.observe($('._markdown_x'), { childList: true, subtree: true, attributes: true, characterData: true })
  doc.body.append(doc.createElement('i')) // wakes the plugin's observer
  await sleep(500)
  const noise = records.filter((r) => r.target.nodeName !== 'BODY')
  assert.equal(noise.length, 0, 'an unchanged page: the pass wrote nothing (' + noise.length + ' mutations inside the message)')
  records.length = 0
  await sleep(1000)
  assert.equal(records.length, 0, 'and nothing moves afterwards (the old code re-ordered the chips of a block 5 times a second)')
  assert.deepEqual(Array.from(cites('#a')[0].querySelectorAll('.kyb-refs-title')).map((t) => t.textContent), ['Paper A', 'Paper B'])
  ok('an unchanged page: zero writes, zero movement over 1.5 s, the order never flips')

  // streaming: text arrives after the chip → the chip is moved back to the end, once; a link arrives → the chip grows
  $('#a').append(doc.createTextNode(' More text streamed in.'))
  await sleep(500)
  assert.equal($('#a').lastChild, cites('#a')[0], 'text streamed after the chip: the chip is last again')
  assert.equal(cites('#a').length, 1)
  const third = doc.createElement('a'); third.href = 'https://arxiv.org/abs/3'; third.textContent = 'Paper C'
  $('#a').insertBefore(third, cites('#a')[0])
  await sleep(500)
  assert.equal(cites('#a').length, 1, 'still one chip')
  assert.equal(cites('#a')[0].querySelector('.kyb-refs-more').textContent, '+2', 'the chip counts the new source')
  assert.equal(cites('#a')[0].querySelectorAll('.kyb-refs-row').length, 3)
  ok('while text and links stream in, the block keeps ONE chip, last, with the right count')

  // interaction
  const chip = cites('#a')[0].querySelector('.kyb-refs-chip')
  chip.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }))
  assert.ok(cites('#a')[0].classList.contains('kyb-refs-open') && chip.getAttribute('aria-expanded') === 'true', 'a click opens the card')
  doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  assert.ok(!cites('#a')[0].classList.contains('kyb-refs-open') && chip.getAttribute('aria-expanded') === 'false', 'Escape closes it')
  chip.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }))
  doc.body.dispatchEvent(new w.MouseEvent('click', { bubbles: true }))
  assert.ok(!cites('#a')[0].classList.contains('kyb-refs-open'), 'a click elsewhere closes it')
  const row = cites('#a')[0].querySelector('.kyb-refs-row')
  assert.equal(row.target, '_blank'); assert.match(row.rel, /noopener/); assert.match(row.rel, /noreferrer/)
  ok('the card opens and closes (click, Escape, click elsewhere); every row opens in a new tab without an opener')
  w.close()
}

console.log('\n' + pass + ' checks passed')
