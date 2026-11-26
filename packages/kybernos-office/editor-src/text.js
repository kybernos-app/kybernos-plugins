// The text editor: plain text, JSON and delimited files (.txt, .json, .csv, .tsv, .yaml, .toml…), in the frame, with no dependency. What it does:
//  - a text box for every file (the text itself: nothing is rewritten, only what is typed changes);
//  - JSON: says at once whether the text is valid JSON (with the line and column of the first mistake) and formats it on request;
//  - CSV and TSV: a « Table » view (cells to type in, rows and columns to add or delete) next to the « Text » view; a file that is not a table (an unclosed quote, a cell
//    with a line end, more than 20 000 cells) opens as text. The table writes the file again only once a cell was changed.
// The file on disk stays the truth: nothing changed => the page never asks for bytes; the byte-order mark, the line ends and the final newline are put back as they were.
// The frame is sandboxed without modals and without storage.
import { LANG, NAME, READONLY, dirty, fail, fetchFile, listen, loaded } from './envelope.js'
import { countText, decode, detectDelimiter, encode, formatJson, jsonStatus, kindOf, serializeCsv, toGrid } from './text-core.js'
import './text.css'

const t = (fr, en) => (LANG === 'fr' ? fr : en)
const kind = kindOf(NAME)
const delimited = kind === 'csv' || kind === 'tsv'
const isJson = kind === 'json'

const app = document.getElementById('app')
const el = (tag, attrs, ...kids) => {
  const n = document.createElement(tag)
  for (const k of Object.keys(attrs || {})) {
    if (k === 'text') n.textContent = attrs[k]
    else if (k === 'class') n.className = attrs[k]
    else if (attrs[k] !== false && attrs[k] !== undefined && attrs[k] !== null) n.setAttribute(k, attrs[k] === true ? '' : String(attrs[k]))
  }
  for (const kid of kids) if (kid !== null && kid !== undefined) n.appendChild(kid)
  return n
}

// ── the file ─────────────────────────────────────────────────────────────────
let seen = { bom: '', eol: '\n', text: '' } // what decode() found: the byte-order mark and the line end to put back
let disk = ''         // the text of the file as it was loaded or last saved (LF)
let base = ''         // the text the table was last built from (LF): what the file is while the table has no change of its own
let endsNl = true     // whether the file ended with a newline
let tableNewer = false // the table holds changes the text of `base` does not
let grid = [['']]
let delim = ','
let tableWhy = null   // why the table is not offered: 'open', 'multiline', 'big'; null when it is
let shown = ''        // what the text box was filled with when it was last opened
let lastExport = ''
let mode = 'text'
let booted = false
let focus = { r: 0, c: 0 }

// ── the page ─────────────────────────────────────────────────────────────────
const modeTable = el('button', { type: 'button', id: 'tx-m-table', class: 'kytx-mode on', text: t('Tableau', 'Table') })
const modeText = el('button', { type: 'button', id: 'tx-m-text', class: 'kytx-mode', text: t('Texte', 'Text') })
const modes = delimited ? el('div', { class: 'kytx-modes', role: 'group', 'aria-label': t('Affichage', 'View') }, modeTable, modeText) : null
const tool = (id, label, title) => el('button', { type: 'button', id, class: 'kytx-tool', title, 'aria-label': title, text: label })
const addRow = tool('tx-add-row', '+ ' + t('Ligne', 'Row'), t('Ajouter une ligne sous la cellule choisie', 'Add a row under the chosen cell'))
const addCol = tool('tx-add-col', '+ ' + t('Colonne', 'Column'), t('Ajouter une colonne à droite de la cellule choisie', 'Add a column right of the chosen cell'))
const delRow = tool('tx-del-row', '− ' + t('Ligne', 'Row'), t('Supprimer la ligne de la cellule choisie', 'Delete the row of the chosen cell'))
const delCol = tool('tx-del-col', '− ' + t('Colonne', 'Column'), t('Supprimer la colonne de la cellule choisie', 'Delete the column of the chosen cell'))
const tableTools = el('div', { class: 'kytx-tools', id: 'tx-table-tools', role: 'toolbar', 'aria-label': t('Tableau', 'Table') }, addRow, addCol, delRow, delCol)
const fmtBtn = tool('tx-format', t('Mettre en forme', 'Format'), t('Réécrire le JSON avec des retraits de deux espaces', 'Write the JSON again with two-space indents'))
const info = el('span', { class: 'kytx-info', id: 'tx-info', role: 'status' })
const top = el('div', { class: 'kytx-top' }, modes, tableTools, isJson ? fmtBtn : null, info)
const hint = el('div', { class: 'kytx-hint', id: 'tx-hint', hidden: true })
const tableEl = el('div', { class: 'kytx-table', id: 'tx-table', hidden: true })
const textEl = el('textarea', { class: 'kytx-text' + (isJson || delimited ? ' nowrap' : ''), id: 'tx-text', spellcheck: 'false', wrap: isJson || delimited ? 'off' : 'soft', 'aria-label': t('Texte du fichier', 'Text of the file') })
app.append(top, hint, tableEl, textEl)

const tell = (value) => dirty(value)

// ── what is said under the bar ───────────────────────────────────────────────
const delimName = () => ({ ',': t('virgule', 'comma'), ';': t('point-virgule', 'semicolon'), '\t': t('tabulation', 'tab'), '|': t('barre verticale', 'pipe') }[delim] || delim)
const WHY = {
  open: t('Un guillemet n’est jamais refermé : ce fichier n’est pas un tableau, modifie-le comme du texte.', 'A quote is never closed: this file is not a table, edit it as text.'),
  multiline: t('Une cellule contient un retour à la ligne : ce fichier s’affiche en texte pour ne rien changer.', 'A cell holds a line break: this file is shown as text so nothing is changed.'),
  big: t('Ce fichier a trop de cellules pour le tableau : modifie-le comme du texte.', 'This file has too many cells for the table: edit it as text.')
}
const refreshInfo = () => {
  let text = ''
  let bad = false
  if (mode === 'table') {
    text = grid.length + ' × ' + grid[0].length + ' · ' + t('séparateur', 'delimiter') + ' : ' + delimName()
  } else if (isJson) {
    const s = jsonStatus(textEl.value)
    if (s.ok) text = t('JSON valide', 'Valid JSON')
    else if (s.empty) text = t('Vide', 'Empty')
    else {
      bad = true
      text = t('JSON invalide', 'Not valid JSON') + (s.line !== null ? t(' — ligne ', ' — line ') + s.line + t(', colonne ', ', column ') + s.col : '')
      info.title = s.message
    }
    fmtBtn.disabled = READONLY || !s.ok
  } else {
    const n = countText(textEl.value)
    text = n.lines + ' ' + t(n.lines > 1 ? 'lignes' : 'ligne', n.lines > 1 ? 'lines' : 'line') + ' · ' + n.chars + ' ' + t(n.chars > 1 ? 'caractères' : 'caractère', n.chars > 1 ? 'characters' : 'character')
  }
  if (!bad) info.removeAttribute('title')
  info.textContent = text
  info.classList.toggle('bad', bad)
  const note = mode === 'table' && tableNewer ? t('Enregistrer réécrit tout le tableau (guillemets seulement quand il le faut, lignes courtes complétées). La vue « Texte » ne réécrit rien.', 'Saving writes the whole table again (quotes only where needed, short rows filled in). The “Text” view rewrites nothing.')
    : (delimited && tableWhy !== null ? WHY[tableWhy] : '')
  hint.textContent = note
  hint.hidden = note === ''
}
let timer = null
const refreshSoon = () => { if (timer !== null) clearTimeout(timer); timer = setTimeout(() => { timer = null; refreshInfo() }, 150) }

const show = () => {
  const table = delimited && mode === 'table'
  tableEl.hidden = !table
  textEl.hidden = table
  tableTools.hidden = !table || READONLY
  fmtBtn.hidden = !isJson || READONLY
  if (modes !== null) {
    modeTable.classList.toggle('on', table)
    modeText.classList.toggle('on', !table)
    modeTable.disabled = tableWhy !== null
    if (tableWhy !== null) modeTable.title = WHY[tableWhy]
    else modeTable.removeAttribute('title')
  }
  refreshInfo()
}

// ── the table ────────────────────────────────────────────────────────────────
const buildTable = () => {
  const tbl = el('table', { class: 'kytx-grid' })
  const body = el('tbody')
  grid.forEach((row, r) => {
    const tr = el('tr')
    tr.appendChild(el('th', { class: 'kytx-rn', scope: 'row', text: String(r + 1) }))
    row.forEach((v, c) => {
      const inp = el('input', { type: 'text', 'data-r': r, 'data-c': c, spellcheck: 'false', 'aria-label': t('Ligne ', 'Row ') + (r + 1) + t(', colonne ', ', column ') + (c + 1), readonly: READONLY })
      inp.value = v
      tr.appendChild(el('td', null, inp))
    })
    body.appendChild(tr)
  })
  tbl.appendChild(body)
  tableEl.replaceChildren(tbl)
}
const cell = (r, c) => tableEl.querySelector('input[data-r="' + r + '"][data-c="' + c + '"]')
const edited = () => { tableNewer = true; tell(true); refreshInfo() }
tableEl.addEventListener('input', (e) => {
  const inp = e.target
  if (READONLY || !(inp instanceof HTMLInputElement)) return
  grid[Number(inp.dataset.r)][Number(inp.dataset.c)] = inp.value
  edited()
})
tableEl.addEventListener('focusin', (e) => {
  const inp = e.target
  if (inp instanceof HTMLInputElement && inp.dataset.r !== undefined) focus = { r: Number(inp.dataset.r), c: Number(inp.dataset.c) }
})
tableEl.addEventListener('keydown', (e) => {
  const inp = e.target
  if (!(inp instanceof HTMLInputElement) || inp.dataset.r === undefined) return
  const r = Number(inp.dataset.r)
  const c = Number(inp.dataset.c)
  const to = e.key === 'Enter' ? (e.shiftKey ? r - 1 : r + 1) : e.key === 'ArrowDown' ? r + 1 : e.key === 'ArrowUp' ? r - 1 : null
  if (to === null) return
  e.preventDefault()
  const next = cell(to, c)
  if (next !== null) { next.focus(); next.select() }
})
const restructure = (run, r, c) => {
  if (READONLY) return
  run()
  buildTable()
  focus = { r: Math.max(0, Math.min(r, grid.length - 1)), c: Math.max(0, Math.min(c, grid[0].length - 1)) }
  const f = cell(focus.r, focus.c)
  if (f !== null) f.focus()
  edited()
}
addRow.addEventListener('click', () => restructure(() => grid.splice(focus.r + 1, 0, new Array(grid[0].length).fill('')), focus.r + 1, focus.c))
addCol.addEventListener('click', () => restructure(() => grid.forEach((row) => row.splice(focus.c + 1, 0, '')), focus.r, focus.c + 1))
delRow.addEventListener('click', () => { if (grid.length > 1) restructure(() => grid.splice(focus.r, 1), focus.r, focus.c) })
delCol.addEventListener('click', () => { if (grid[0].length > 1) restructure(() => grid.forEach((row) => row.splice(focus.c, 1)), focus.r, focus.c) })

// ── what the file would be now ───────────────────────────────────────────────
const current = () => (delimited && mode === 'table' ? (tableNewer ? serializeCsv(grid, delim, endsNl) : base) : textEl.value)

const setMode = (m) => {
  if (m === mode || !delimited) return
  if (m === 'text') {
    shown = current()
    textEl.value = shown
    mode = 'text'
  } else {
    if (textEl.value !== shown) {
      // The text was edited: the table is rebuilt from it, and the text is the truth from here.
      const g = toGrid(textEl.value, delim)
      if (!g.ok) { tableWhy = g.why; show(); return }
      tableWhy = null
      grid = g.grid
      base = textEl.value
      tableNewer = false
      buildTable()
      if (!READONLY) tell(base !== disk)
    }
    mode = 'table'
  }
  show()
}
modeTable.addEventListener('click', () => setMode('table'))
modeText.addEventListener('click', () => setMode('text'))
textEl.addEventListener('input', () => { if (!READONLY) tell(textEl.value !== disk); refreshSoon() })
fmtBtn.addEventListener('click', () => {
  const out = formatJson(textEl.value)
  if (out === null || READONLY || out === textEl.value) return
  // Typed in, not assigned, so the text box's own Undo still works.
  textEl.focus()
  textEl.select()
  let done = false
  try { done = document.execCommand('insertText', false, out) } catch (e) { done = false }
  if (!done || textEl.value !== out) textEl.value = out
  tell(textEl.value !== disk)
  refreshInfo()
})

// ── load, export, saved ──────────────────────────────────────────────────────
async function load () {
  const f = await fetchFile()
  seen = decode(f.bytes)
  disk = seen.text
  base = disk
  endsNl = disk === '' || disk.endsWith('\n')
  tableNewer = false
  textEl.value = disk
  textEl.readOnly = READONLY
  shown = disk
  if (delimited) {
    delim = detectDelimiter(disk, NAME)
    const g = toGrid(disk, delim)
    tableWhy = g.ok ? null : g.why
    if (g.ok) { grid = g.grid; buildTable() }
    if (!booted) mode = g.ok ? 'table' : 'text'
    else if (mode === 'table' && !g.ok) mode = 'text'
  } else mode = 'text'
  booted = true
  show()
  tell(false)
  loaded(f.hash, READONLY)
}

listen({
  exportBytes: async () => {
    const text = current()
    lastExport = text
    return encode(seen, text)
  },
  reload: load,
  saved: () => {
    // Typing may have gone on while the page saved: only what was written becomes the new file.
    if (current() === lastExport) { disk = lastExport; base = lastExport; shown = lastExport; tableNewer = false; tell(false); refreshInfo() }
  }
})
load().catch(fail)
