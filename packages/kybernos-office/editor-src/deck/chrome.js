// The markup the runtime puts around the slides: navigation bar, presenter view, and (when the build edits) the notes box, the formatting bar, the bubble menu,
// the « / » menu and the popover. Built here, never stored in a deck file, so a file stays small and the editor's chrome is always the current one.
import { T } from './i18n.js'
import { ICONS } from './icons.js'

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
/** One toolbar button: `attrs` is raw (already safe), `title` is translated here. */
const tb = (attrs, title, inner, cls = '') => `<button class="tt-btn${cls === '' ? '' : ' ' + cls}" ${attrs} title="${esc(T(title))}">${inner}</button>`
const grp = (...bits) => `<div class="tt-grp">${bits.join('')}</div>`
const sep = '<i class="tt-sep"></i>'

/**
 * `edit`: the editing chrome is wanted. `framed`: the deck runs in the sandboxed editor frame, which can open no window, go full screen or print, so those
 * buttons are not drawn (the DSH page around the frame has Save).
 */
export function chromeHtml ({ edit, framed }) {
  const bar = `<nav id="bar" aria-label="${esc(T('Controls'))}">
<button id="b-prev" title="${esc(T('Previous (←)'))}">◀</button><span id="cnt">1 / 1</span><button id="b-next" title="${esc(T('Next (→)'))}">▶</button>
<span class="sep"></span>
<button id="b-grid" title="${esc(T('Grid view (G)'))}">${esc(T('Grid'))}</button>${framed ? '' : `
<button id="b-pres" title="${esc(T('Presenter view (P)'))}">${esc(T('Presenter'))}</button>`}${edit ? `
<button id="b-edit" title="${esc(T('Edit the text (E)'))}">${esc(T('Edit'))}</button>` : ''}${framed ? '' : `
<span class="sep"></span>
<button id="b-fs" title="${esc(T('Full screen (F)'))}">${esc(T('Full screen'))}</button>
<button id="b-print" title="${esc(T('Print or export as PDF'))}">PDF</button>`}
</nav>`
  let out = '<div id="pv"></div>\n'
  if (edit) out += `<div id="nb"><b>${esc(T('Slide notes:'))}</b> <div id="nbt" contenteditable="true"></div></div>\n`
  out += bar + '\n'
  if (!edit) return out
  const mark = (extra = '') => [
    tb('data-cmd="bold"', 'Bold (Ctrl+B)', ICONS.bold), tb('data-cmd="italic"', 'Italic (Ctrl+I)', ICONS.italic),
    tb('data-cmd="underline"', 'Underline (Ctrl+U)', ICONS.underline), tb('data-cmd="strike"', 'Strikethrough', ICONS.strike), extra,
  ].join('')
  const colours = tb('data-pop="text"', 'Text colour', '<span class="tt-a">A</span>') + tb('data-pop="hl"', 'Highlight', ICONS.highlight)
  const aligns = tb('data-align="left"', 'Align left', ICONS.alignl) + tb('data-align="center"', 'Centre', ICONS.alignc) + tb('data-align="right"', 'Align right', ICONS.alignr)
  out += `<div id="fmt" role="toolbar" aria-label="${esc(T('Formatting'))}">
<div class="row">
${grp(tb('data-act="undo"', 'Undo (Ctrl+Z)', ICONS.undo), tb('data-act="redo"', 'Redo (Ctrl+Shift+Z)', ICONS.redo))}${sep}
${grp(tb('id="f-size" data-pop="size"', 'Text size', `<span id="f-sizev">24</span> px ${ICONS.down}`, 'sz'))}${sep}
${grp(mark())}${sep}
${grp(colours)}${sep}
${grp(tb('data-act="list"', 'Bulleted list', ICONS.list), aligns, tb('id="f-ls"', 'Block line spacing (click = next)', ICONS.lineh))}
<span id="f-msg" aria-live="polite"></span>
</div>
<div class="row">
${grp(`<span class="tt-cap">${esc(T('Block'))}</span>`, tb('id="f-addtext"', 'Add a text box', `${ICONS.type} ${esc(T('Text'))}`), tb('id="f-addshape"', 'Add a rectangle', `${ICONS.square} ${esc(T('Shape'))}`),
    tb('id="f-addimg"', 'Add an image', `${ICONS.image} ${esc(T('Image'))}`), tb('data-pop="fill"', 'Fill colour of the selected block', `<span class="tt-chip"></span> ${esc(T('Fill'))}`),
    tb('id="f-dupblock"', 'Duplicate the selected block', `${ICONS.copy} ${esc(T('Duplicate'))}`), tb('id="f-del"', 'Delete the selected block (Delete key)', `${ICONS.trash} ${esc(T('Delete'))}`, 'danger'))}${sep}
${grp(`<span class="tt-cap">${esc(T('Slide'))}</span>`, tb('data-pop="newslide"', 'Add a slide or a section', `${ICONS.plus} ${esc(T('Slide'))} ${ICONS.down}`, 'pri'),
    tb('data-pop="bg"', 'Background colour of the slide', `<span class="tt-chip"></span> ${esc(T('Fill'))}`), tb('id="f-dupslide"', 'Duplicate the slide', `${ICONS.copy} ${esc(T('Duplicate'))}`),
    tb('id="f-delslide"', 'Delete the slide', `${ICONS.trash} ${esc(T('Delete'))}`, 'danger'), tb('id="f-mvprev"', 'Move the slide earlier', ICONS.left), tb('id="f-mvnext"', 'Move the slide later', ICONS.right))}
</div>
<input type="file" id="f-img" accept="image/*" hidden>
</div>
<div id="bubble" class="tt-card" role="toolbar" aria-label="${esc(T('Formatting of the selection'))}">
${mark(sep + colours + sep + tb('data-act="list"', 'Bulleted list', ICONS.list) + aligns)}
</div>
<div id="slash" class="tt-card" role="listbox" aria-label="${esc(T('Insert'))}"></div>
<div id="pop" class="tt-card"></div>
`
  return out
}
