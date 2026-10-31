// dom.mjs — the few helpers every view uses to build the page. Elements are made with the DOM and text goes in as text, never as markup: a value from a database cannot become
// script, and the page's policy (no inline script, no inline style) is kept without effort. A `style` attribute is refused here on purpose.
const HTML_NS = 'http://www.w3.org/1999/xhtml'
const SVG_NS = 'http://www.w3.org/2000/svg'

function put (el, key, value) {
  if (value === undefined || value === null || value === false) return
  if (key === 'style') throw new Error('no inline style: the page policy forbids it, use a class')
  if (key === 'class') el.setAttribute('class', Array.isArray(value) ? value.filter(Boolean).join(' ') : value)
  else if (key === 'data') for (const [k, v] of Object.entries(value)) el.dataset[k] = v
  else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value)
  else if (key === 'value' || key === 'checked' || key === 'selected' || key === 'disabled') { if (key === 'value') el.value = value; else el[key] = value === true }
  else el.setAttribute(key, value === true ? '' : String(value))
}
function add (el, child) {
  if (child === undefined || child === null || child === false) return
  if (Array.isArray(child)) { for (const c of child) add(el, c); return }
  el.append(child instanceof Node ? child : document.createTextNode(String(child)))
}
const make = (ns) => (tag, attrs, ...children) => {
  const el = document.createElementNS(ns, tag)
  if (attrs !== null && attrs !== undefined) for (const [k, v] of Object.entries(attrs)) put(el, k, v)
  for (const c of children) add(el, c)
  return el
}
/** `h('button', { class: 'btn', onclick }, 'Save')`: an HTML element. Children are nodes, text, or lists of them (empty ones are skipped). */
export const h = make(HTML_NS)
/** The same for an SVG element. */
export const s = make(SVG_NS)

/** An icon from the sprite in index.html. */
export const icon = (name, cls) => s('svg', { class: cls === undefined ? 'ic' : 'ic ' + cls, 'aria-hidden': 'true' }, s('use', { href: '#i-' + name }))

/** The Kybernos mark: the red K with three dots, from the product's own art. */
export function kmark () {
  return s('svg', { class: 'kmark', viewBox: '0 0 32.5 36', 'aria-hidden': 'true' },
    s('g', { fill: '#f2372a' }, s('rect', { x: 0, y: 0, width: 13, height: 36 }), s('polygon', { points: '21,0 31,0 13,28.3 13,12.6' }), s('polygon', { points: '13,22 22,36 32.5,36 20.3,16.8 13,16.8' })),
    s('g', { fill: '#fff' }, s('circle', { cx: 6.5, cy: 7.5, r: 2.8 }), s('circle', { cx: 6.5, cy: 18, r: 2.8 }), s('circle', { cx: 6.5, cy: 28.5, r: 2.8 })))
}

/** Empties a node and fills it again. */
export function fill (el, ...children) {
  el.replaceChildren()
  for (const c of children) add(el, c)
  return el
}

let seq = 0
/** A fresh id for a label to point at its control. */
export const uid = (prefix = 'f') => prefix + '-' + (++seq)

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
/** Keeps Tab inside a dialog. */
export function trapTab (dialog, e) {
  if (e.key !== 'Tab') return
  const items = [...dialog.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement)
  if (items.length === 0) { e.preventDefault(); dialog.focus(); return }
  const first = items[0]
  const last = items[items.length - 1]
  if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { e.preventDefault(); last.focus() } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
}
