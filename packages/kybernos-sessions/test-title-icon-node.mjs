#!/usr/bin/env node
// The icon of a chat row is put before the TITLE TEXT (list item 30, 2026-11-24). The engine from 0.2.3-alpha.2 wraps that text one level down
// (`<span class="…title"><span class="…travel">New Session</span></span>`): the old lookup read the direct children only, found no text, and so no
// row got its placeholder icon and the automatic classification (which starts from the placeholder) never ran. No browser: the two small pure pieces
// are taken from the bundle as it is, on a minimal fake DOM.
//
//   node packages/kybernos-sessions/test-title-icon-node.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

const SOURCE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')
const React = { createElement: () => null, useState: (v) => [v, () => {}], useEffect: () => {}, useRef: () => ({ current: null }), useCallback: (f) => f, useMemo: (f) => f(), Fragment: 'fragment' }
let definition = null
globalThis.window = { __ModuleLoader__: { load: (def) => { definition = def } } }
globalThis.document = { createElement: () => ({ style: {} }), head: { append() {} }, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} }
new Function('window', SOURCE)(globalThis.window)
const { noeudTexte, ancreDeTexte } = definition.factory((spec) => { if (spec === 'react') return React; throw new Error('unexpected require ' + spec) }).__test

// A minimal DOM: elements with children, text nodes, a class list.
const txt = (v) => ({ nodeType: 3, nodeValue: v, parentNode: null })
const el = (cls, ...kids) => {
  const n = { nodeType: 1, parentNode: null, childNodes: kids, classList: { contains: (c) => cls.split(' ').includes(c) } }
  for (const k of kids) k.parentNode = n
  return n
}

// 1. the flat title (the Pinned rows, the engines before 0.2.3-alpha.2): the direct text node, and it is its own anchor.
{
  const t = txt('Refonte du menu')
  const title = el('title', t)
  assert.equal(noeudTexte(title), t)
  assert.equal(ancreDeTexte(title, t), t, 'the icon goes right before the text')
  ok('a flat title gives its own text node, the icon goes right before it')
}
// 2. the wrapped title of 0.2.3-alpha.2: the text node is found inside the wrapper, and the icon goes before the WRAPPER (a child of the title).
{
  const t = txt('New Session')
  const travel = el('travel', t)
  const title = el('title', travel)
  assert.equal(noeudTexte(title), t, 'the text is found one level down')
  assert.equal(ancreDeTexte(title, t), travel, 'the anchor is the child of the title that holds it')
  ok('a wrapped title (engine 0.2.3-alpha.2) gives its text, and the icon goes before the wrapper')
}
// 3. our own icon is never read as the title, wherever it sits; the text after it is.
{
  const t = txt('Five-word hello…')
  const icon = el('kbs-titre-ico', txt('x'))
  const title = el('title', icon, el('travel', t))
  assert.equal(noeudTexte(title), t, 'the icon already there is skipped')
  ok('the icon we already put is skipped, the title text after it is found')
}
// 4. a direct text node still wins over a wrapped one; nothing, or blanks only, gives null (the row has no name yet).
{
  const direct = txt('Direct')
  assert.equal(noeudTexte(el('title', el('travel', txt('Inside')), direct)), direct, 'a direct text node wins')
  assert.equal(noeudTexte(el('title')), null, 'empty')
  assert.equal(noeudTexte(el('title', el('travel', txt('   ')))), null, 'blank text in a wrapper is no name')
  ok('a direct text node wins; an empty or blank title gives null')
}
// 5. wired: the placeholder and the real icon both go before the anchor, not before the text node.
{
  assert.ok(/el\.insertBefore\(provisoire, ancre\)/.test(SOURCE) && /el\.insertBefore\(marque, ancre\)/.test(SOURCE), 'both icons are put before the anchor')
  assert.ok(!/el\.insertBefore\((provisoire|marque), noeud\)/.test(SOURCE), 'never before the text node itself (it may be one level down: an insertBefore on a non-child throws)')
  ok('the placeholder and the category icon are put before the anchor')
}

console.log('\n' + pass + ' checks passed')
