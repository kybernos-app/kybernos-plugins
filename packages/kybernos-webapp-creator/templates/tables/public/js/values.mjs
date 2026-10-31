// values.mjs — a value as the page draws it: the plain data model.describe() gives (a pill, some chips, a link, files…) turned into nodes. Used by the table, the board and the detail.
import { h, icon } from './dom.mjs'
import { fmtSize, initials, plural } from './model.mjs'

const dash = () => h('span', { class: 'mute' }, '—')
export const pill = (label, color) => h('span', { class: ['pill', color === 'gray' ? '' : color] }, label)

/** A linked row as a chip; a button that opens the row when `open` is given and the row's title is known. */
function refChip (item, object, open) {
  const known = item.title !== null
  const inner = [h('i', { 'aria-hidden': 'true' }, known ? initials(item.title) : '?'), h('span', null, known ? item.title : 'Linked row')]
  if (!known || typeof open !== 'function') return h('span', { class: 'chip' }, inner)
  return h('button', { type: 'button', class: 'chip', onclick: (e) => { e.stopPropagation(); open(object, item.id) } }, inner)
}

/**
 * `d` is model.describe()'s answer. `opts.detail` draws the long form (files as links, the checkbox as a word); `opts.open(object, id)` makes a linked row clickable;
 * `opts.fileUrl(hash)` is the address of one attached file.
 */
export function renderValue (d, opts = {}) {
  switch (d.kind) {
    case 'empty': return dash()
    case 'text': return h('span', null, d.text)
    case 'link': return h('a', { href: d.href, target: '_blank', rel: 'noopener noreferrer', class: opts.detail ? '' : 'clip', onclick: (e) => e.stopPropagation() }, d.text)
    case 'pill': return pill(d.label, d.color)
    case 'pills': return h('span', { class: 'chips' }, d.items.map((i) => pill(i.label, i.color)))
    case 'refs': return h('span', { class: 'chips' }, d.items.map((i) => refChip(i, d.object, opts.open)))
    case 'bool': return opts.detail ? h('span', null, d.value ? 'Yes' : 'No') : (d.value ? h('span', { 'aria-label': 'Yes' }, icon('check')) : dash())
    case 'files':
      if (!opts.detail) return h('span', null, plural(d.files.length, 'file', 'files'))
      return h('span', { class: 'chips' }, d.files.map((f) => h('a', { class: 'chip', href: opts.fileUrl(f.hash), target: '_blank', rel: 'noopener noreferrer' }, h('span', null, f.name + (f.size === undefined ? '' : ' · ' + fmtSize(f.size))))))
    default: return dash()
  }
}
