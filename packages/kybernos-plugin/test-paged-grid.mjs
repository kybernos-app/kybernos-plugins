#!/usr/bin/env node
// A page of cards holds whole rows (UX audit 2026-10-20): usePagedView of client.js, cut out and run with a stub React. No browser.
//
//   node packages/kybernos-plugin/test-paged-grid.mjs
//
// Pinned because the pages held a fixed 9 cards while the grid fills its width: in 4 columns the last row of a page held one card
// alone, with another page still to come. The grid now reports its column count and the page size follows it.
import { readFileSync } from 'node:fs'

let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) console.log('  ✓ ' + name)
  else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const SRC = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
const a = SRC.indexOf('// <kb-paged-view>')
const b = SRC.indexOf('// </kb-paged-view>', a)
if (a < 0 || b < a) { console.log('  ✗ cannot cut usePagedView out of client.js'); process.exit(1) }

// One hook "component": state and refs live in slots by call order, like React's. `columns` is what the grid's computed style answers.
const mount = (columns) => {
  const slots = []
  let at = 0
  let rerender = false
  const React = {
    useState: (init) => { const i = at; at += 1; if (!(i in slots)) slots[i] = init; return [slots[i], (v) => { const next = typeof v === 'function' ? v(slots[i]) : v; if (next !== slots[i]) { slots[i] = next; rerender = true } }] },
    useRef: (init) => { const i = at; at += 1; if (!(i in slots)) slots[i] = { current: init }; return slots[i] },
    useCallback: (fn) => { const i = at; at += 1; if (!(i in slots)) slots[i] = fn; return slots[i] },
    useEffect: () => { at += 0 }
  }
  const globals = { ResizeObserver: class { observe () {} disconnect () {} }, getComputedStyle: () => ({ gridTemplateColumns: columns }) }
  const usePagedView = new Function('React', 'ResizeObserver', 'getComputedStyle', SRC.slice(a, b) + '\nreturn usePagedView')(React, globals.ResizeObserver, globals.getComputedStyle)
  const run = (count, perPage, mode) => { at = 0; rerender = false; return usePagedView(count, perPage, mode, undefined) }
  return { run, wasUpdated: () => rerender }
}
const rows = Array.from({ length: 11 }, (_, i) => i)
const trackList = (n) => Array.from({ length: n }, () => '250px').join(' ')

{
  const m = mount(trackList(4))
  const first = m.run(11, 9, 'cards')
  check('before the grid is measured, a page keeps the base size', first.per === 9 && first.slice(rows).length === 9, first.per)
  first.gridRef({})   // the grid mounts and reports its 4 columns
  const vp = m.run(11, 9, 'cards')
  check('in 4 columns a page holds two whole rows, 8 cards', vp.per === 8 && vp.slice(rows).length === 8, vp.per)
  check('the last row of the first page is full (no card alone while another page follows)', vp.slice(rows).length % 4 === 0)
  check('the pager counts pages of that size', vp.pages === 2, vp.pages)
}
for (const [cols, want] of [[3, 9], [2, 10], [5, 10], [6, 12], [1, 9]]) {
  const m = mount(trackList(cols))
  m.run(40, 9, 'cards').gridRef({})
  const vp = m.run(40, 9, 'cards')
  check(cols + ' columns: ' + want + ' cards a page, whole rows', vp.per === want && vp.per % cols === 0, vp.per)
}
{
  const m = mount(trackList(4))
  m.run(11, 9, 'list').gridRef({})
  const vp = m.run(11, 9, 'list')
  check('a list is not a grid: it keeps the base size', vp.per === 9, vp.per)
}
{
  const m = mount('none')
  m.run(11, 9, 'cards').gridRef({})
  const vp = m.run(11, 9, 'cards')
  check('a grid that answers no track list keeps the base size', vp.per === 9, vp.per)
}

console.log('the callers')
{
  const fixedNine = SRC.match(/\.page \* 9/g)
  check('no caller slices a page with a literal 9 any more', fixedNine === null, fixedNine)
  for (const marker of ["'kb8-grid kb8-cmp', ref: vp.gridRef", "'kb8-grid kb8-cmp', key: 'grid-' + curRoot, ref: out.length === 0 ? vp.gridRef : undefined", "ref: docsVp.gridRef", "ref: delivVp.gridRef"]) {
    check('a paged grid reports its columns: ' + marker.slice(0, 48), SRC.includes(marker))
  }
}
process.exit(fail === 0 ? 0 : 1)
