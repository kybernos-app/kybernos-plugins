#!/usr/bin/env node
// « A short automatic state + a Customize fold » (audit N-08): the one helper every settings page can use, cut out of client.js and run alone.
// No browser, no DSH: a stub for React, for the DOM and for the browser's storage.
//
//   node packages/kybernos-plugin/test-customize-fold.mjs
import { readFileSync } from 'node:fs'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const SRC = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
const a = SRC.indexOf('const KB_CZ_STORE = ')
const b = SRC.indexOf('ctx.effect(() => styles.insert(`\n.kb-cz{', a)
if (a < 0 || b < a) { console.log('  ✗ cannot cut the Customize helper out of client.js'); process.exit(1) }
const CODE = SRC.slice(a, b)

/** A fresh helper over a stub world. `store`: the browser's storage (a Map), or null for a browser that refuses it. */
const world = (store) => {
  const win = { localStorage: store === null ? { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } } : { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)) } } }
  // React: the state hook keeps its value in a cell the test can read and set; elements are plain descriptors.
  const cells = []
  let at = 0
  const React = { useState: (init) => { const i = at; at += 1; if (!(i in cells)) cells[i] = typeof init === 'function' ? init() : init; return [cells[i], (v) => { cells[i] = v }] } }
  const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat() })
  const make = (tag) => { const el = { tag, attrs: {}, children: [], listeners: {}, className: '', style: {}, setAttribute(k, v) { this.attrs[k] = String(v) }, append(...c) { this.children.push(...c) }, addEventListener(t, f) { this.listeners[t] = f }, set innerHTML(v) { this.html = v }, set textContent(v) { this.text = v } }; return el }
  const document = { createElement: make }
  const fn = new Function('window', 'React', 'h', 'kbt', 'document', CODE + '\nreturn { kbCzRead, kbCzWrite, KbCustomize }')
  const api = fn(win, React, h, (k) => (k === 'kbcz.customize' ? 'Customize' : k), document)
  return { ...api, rewind: () => { at = 0 }, cells }
}
const find = (node, pred, out = []) => { if (node === null || node === undefined || typeof node !== 'object') return out; if (pred(node)) out.push(node); for (const c of node.children || []) find(c, pred, out); return out }

console.log('the store')
{
  const store = new Map()
  const w = world(store)
  check('a fold nobody chose for reads null (not false: « never chose » is not « shut »)', w.kbCzRead('memory') === null)
  w.kbCzWrite('memory', true)
  check('what the person chose is read back, and kept in the browser under its own key', w.kbCzRead('memory') === true && store.get('kybernos.fold.memory') === '1')
  w.kbCzWrite('memory', false)
  check('shut is written too', w.kbCzRead('memory') === false && store.get('kybernos.fold.memory') === '0')
  check('another browser session reads the same choice', world(store).kbCzRead('memory') === false)
  const refused = world(null)
  refused.kbCzWrite('memory', true)
  check('a browser that refuses storage (a private window) neither throws nor forgets, for as long as the page lives', refused.kbCzRead('memory') === true && refused.kbCzRead('other') === null)
}

console.log('the fold of a page: the state first, the knobs on demand')
{
  const w = world(new Map())
  const tree = w.KbCustomize({ id: 'p', state: 'Memory is on and tidies itself.', tone: 'on', children: ['KNOBS'] })
  const state = find(tree, (n) => n.props && n.props.className === 'kb-cz-state')[0]
  check('the page opens on one sentence and one status', state !== undefined && JSON.stringify(state).indexOf('Memory is on and tidies itself.') >= 0 && find(state, (n) => n.props && /kb-cz-dot on/.test(n.props.className || '')).length === 1, state)
  check('the knobs are not drawn while the fold is shut, and the button says so', find(tree, (n) => n.props && n.props.className === 'kb-cz-body').length === 0 && find(tree, (n) => n.props && n.props['aria-expanded'] === 'false').length === 1)
  check('the button is called « Customize » unless the page says otherwise', JSON.stringify(tree).indexOf('Customize') >= 0)
  const button = find(tree, (n) => n.type === 'button')[0]
  button.props.onClick()
  w.rewind()
  const open = w.KbCustomize({ id: 'p', state: 'x', children: ['KNOBS'] })
  check('a click opens it (the knobs show, the button says so) and is remembered', find(open, (n) => n.props && n.props.className === 'kb-cz-body').length === 1 && find(open, (n) => n.props && n.props['aria-expanded'] === 'true').length === 1 && w.kbCzRead('p') === true)
  const w2 = world(new Map([['kybernos.fold.q', '1']]))
  check('a person who opened it before finds it open on the next visit', find(w2.KbCustomize({ id: 'q', state: 'x', children: [] }), (n) => n.props && n.props.className === 'kb-cz-body').length === 1)
  const w3 = world(new Map([['kybernos.fold.q', '0']]))
  check('a page may open its fold by default, but the person\'s choice wins over it', find(world(new Map()).KbCustomize({ id: 'q', state: 'x', defaultOpen: true, children: [] }), (n) => n.props && n.props.className === 'kb-cz-body').length === 1 && find(w3.KbCustomize({ id: 'q', state: 'x', defaultOpen: true, children: [] }), (n) => n.props && n.props.className === 'kb-cz-body').length === 0)
  const warn = w.KbCustomize({ id: 'r', state: 'x', tone: 'warn', children: [] })
  const odd = w.KbCustomize({ id: 's', state: 'x', tone: 'purple', children: [] })
  check('the status dot is green, grey or amber; a tone nobody knows falls back to green', find(warn, (n) => n.props && /kb-cz-dot warn/.test(n.props.className || '')).length === 1 && find(odd, (n) => n.props && /kb-cz-dot on/.test(n.props.className || '')).length === 1)
}

console.log('it is published for the other bundles')
check('window.__KB_CUSTOMIZE__ carries the fold and the store (a bundle falls back to its own markup without it)', /window\.__KB_CUSTOMIZE__ = \{ Fold: KbCustomize, read: kbCzRead, write: kbCzWrite \}/.test(SRC))

console.log(`\n${pass} ✓  ${fail} ✗`)
process.exit(fail === 0 ? 0 : 1)
