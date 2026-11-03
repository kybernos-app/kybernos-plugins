// The Markdown editor: Tiptap (MIT) with its Markdown extension, in the frame. Two views of the same file: « Editor » (headings, lists, tables, task lists, links)
// and « Text » (the Markdown itself, in a text box). The file on disk stays the truth:
//  - nothing changed => the page never asks for bytes, and the bytes it has are the file's own;
//  - the byte-order mark, the line ends (LF or CRLF), the final newline and a YAML front matter are kept as they were;
//  - what the Editor view cannot hold (HTML, footnotes, reference links, formulas) is announced by the host's guard BEFORE the person edits, who may then edit in
//    « Text » (`?mode=text`), where nothing is rewritten.
// The frame is sandboxed without modals: no prompt(), the link address is typed in a small bar of its own.
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'
import { TaskList } from '@tiptap/extension-task-list'
import { TaskItem } from '@tiptap/extension-task-item'
import Image from '@tiptap/extension-image'
import { LANG, READONLY, dirty, fail, fetchFile, listen, loaded } from './envelope.js'
import './md.css'

const t = (fr, en) => (LANG === 'fr' ? fr : en)
const TEXT_FIRST = new URLSearchParams(location.search).get('mode') === 'text'
const FRONT = /^---\n[\s\S]*?\n---[ \t]*(?:\n|$)/

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
let bom = ''          // '﻿' when the file starts with a byte-order mark
let eol = '\n'        // the file's line end; the frame works in LF and puts it back
let endsNl = true     // whether the file ended with a newline
let disk = ''         // the text of the file as it was loaded or last saved (LF)
let base = ''         // the text the Editor view was last built from (LF): what the file is while the Editor view has no change of its own
let front = ''        // the YAML front matter and the blank lines after it, set aside while the Editor view holds the rest (LF)
let richNewer = false // the Editor view holds changes the text of `base` does not
let changed = false   // anything differs from the file
let shown = ''        // what the text box was filled with when it was last opened
let lastExport = ''
let mode = 'ed'
let editor = null

const split = (text) => {
  const m = text.match(FRONT)
  if (m === null) return ['', text]
  const rest = text.slice(m[0].length)
  const blank = rest.match(/^(?:[ \t]*\n)*/)[0]
  return [m[0] + blank, rest.slice(blank.length)]
}

// ── the page ─────────────────────────────────────────────────────────────────
const TOOLS = [
  ['b', 'B', t('Gras', 'Bold')], ['i', 'I', t('Italique', 'Italic')], ['s', 'S', t('Barré', 'Strikethrough')], ['code', '</>', t('Code', 'Code')],
  null,
  ['h1', 'H1', t('Titre 1', 'Heading 1')], ['h2', 'H2', t('Titre 2', 'Heading 2')], ['h3', 'H3', t('Titre 3', 'Heading 3')],
  null,
  ['ul', '•', t('Liste à puces', 'Bullet list')], ['ol', '1.', t('Liste numérotée', 'Numbered list')], ['task', '☑', t('Liste de tâches', 'Task list')],
  ['quote', '❝', t('Citation', 'Quote')], ['pre', '{ }', t('Bloc de code', 'Code block')], ['hr', '―', t('Séparateur', 'Divider')],
  null,
  ['link', t('Lien', 'Link'), t('Lien', 'Link')], ['table', t('Tableau', 'Table'), t('Tableau', 'Table')],
  null,
  ['undo', '↶', t('Annuler', 'Undo')], ['redo', '↷', t('Rétablir', 'Redo')]
]
const toolbar = el('div', { class: 'kymd-tb', id: 'md-tools', role: 'toolbar', 'aria-label': t('Mise en forme', 'Formatting') })
for (const tool of TOOLS) {
  if (tool === null) { toolbar.appendChild(el('span', { class: 'kymd-sep' })); continue }
  toolbar.appendChild(el('button', { type: 'button', 'data-c': tool[0], title: tool[2], 'aria-label': tool[2], text: tool[1] }))
}
const modeEd = el('button', { type: 'button', id: 'm-ed', class: 'kymd-mode on', text: t('Éditeur', 'Editor') })
const modeSrc = el('button', { type: 'button', id: 'm-src', class: 'kymd-mode', text: t('Texte', 'Text') })
const top = el('div', { class: 'kymd-top' }, el('div', { class: 'kymd-modes', role: 'group', 'aria-label': t('Affichage', 'View') }, modeEd, modeSrc), toolbar)
const linkInput = el('input', { type: 'url', id: 'md-link', placeholder: t('Adresse du lien', 'Link address'), 'aria-label': t('Adresse du lien', 'Link address') })
const linkOk = el('button', { type: 'button', class: 'kymd-ok', text: 'OK' })
const linkOff = el('button', { type: 'button', text: t('Retirer le lien', 'Remove link') })
const linkBar = el('div', { class: 'kymd-linkbar', id: 'md-linkbar', hidden: true }, linkInput, linkOk, linkOff)
const richEl = el('div', { class: 'kymd-rich', id: 'md-rich' })
const textEl = el('textarea', { class: 'kymd-src', id: 'md-text', spellcheck: 'false', 'aria-label': t('Texte Markdown', 'Markdown text'), hidden: true })
app.append(top, linkBar, richEl, textEl)

// ── the Editor view ──────────────────────────────────────────────────────────
const make = (body) => {
  if (editor !== null) editor.destroy()
  editor = new Editor({
    element: richEl,
    editable: !READONLY,
    extensions: [StarterKit.configure({ underline: false, link: { openOnClick: false } }), Markdown, Table.configure({ resizable: false }), TableRow, TableHeader, TableCell, TaskList, TaskItem.configure({ nested: true }), Image],
    content: body,
    contentType: 'markdown',
    onUpdate: () => { if (!READONLY) { richNewer = true; tell(true) } },
    onTransaction: () => marks(),
    onSelectionUpdate: () => marks()
  })
}
const commands = {
  b: (c) => c.toggleBold(), i: (c) => c.toggleItalic(), s: (c) => c.toggleStrike(), code: (c) => c.toggleCode(),
  h1: (c) => c.toggleHeading({ level: 1 }), h2: (c) => c.toggleHeading({ level: 2 }), h3: (c) => c.toggleHeading({ level: 3 }),
  ul: (c) => c.toggleBulletList(), ol: (c) => c.toggleOrderedList(), task: (c) => c.toggleTaskList(), quote: (c) => c.toggleBlockquote(), pre: (c) => c.toggleCodeBlock(), hr: (c) => c.setHorizontalRule(),
  table: (c) => c.insertTable({ rows: 3, cols: 2, withHeaderRow: true }), undo: (c) => c.undo(), redo: (c) => c.redo()
}
const activeName = { b: 'bold', i: 'italic', s: 'strike', code: 'code', ul: 'bulletList', ol: 'orderedList', task: 'taskList', quote: 'blockquote', pre: 'codeBlock', link: 'link' }
function marks () {
  if (editor === null) return
  for (const b of toolbar.querySelectorAll('button')) {
    const k = b.dataset.c
    const on = (activeName[k] !== undefined && editor.isActive(activeName[k])) || (/^h[123]$/.test(k) && editor.isActive('heading', { level: Number(k[1]) }))
    b.classList.toggle('on', on === true)
  }
}
const shutLink = () => { linkBar.hidden = true }
const openLink = () => {
  linkInput.value = editor.getAttributes('link').href || ''
  linkBar.hidden = false
  linkInput.focus()
}
const applyLink = (href) => {
  const chain = editor.chain().focus().extendMarkRange('link')
  if (href === '') chain.unsetLink().run()
  else chain.setLink({ href }).run()
  shutLink()
}
linkOk.addEventListener('click', () => applyLink(linkInput.value.trim()))
linkOff.addEventListener('click', () => applyLink(''))
linkInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyLink(linkInput.value.trim()) } else if (e.key === 'Escape') { e.preventDefault(); shutLink(); editor.commands.focus() } })
toolbar.addEventListener('mousedown', (e) => {
  const b = e.target instanceof Element ? e.target.closest('button') : null
  if (b === null || editor === null || mode !== 'ed' || READONLY) return
  e.preventDefault()
  if (b.dataset.c === 'link') { openLink(); return }
  const run = commands[b.dataset.c]
  if (run !== undefined) run(editor.chain().focus()).run()
})

// ── what the file would be now ───────────────────────────────────────────────
const richText = () => front + editor.getMarkdown().replace(/\n+$/, '') + (endsNl ? '\n' : '')
const current = () => (mode === 'src' ? textEl.value : (richNewer ? richText() : base))
const tell = (value) => { changed = value; dirty(value) }

const show = () => {
  richEl.hidden = mode === 'src'
  toolbar.hidden = mode === 'src' || READONLY
  textEl.hidden = mode !== 'src'
  modeEd.classList.toggle('on', mode === 'ed')
  modeSrc.classList.toggle('on', mode === 'src')
  shutLink()
  if (mode === 'ed') marks()
}
const setMode = (m) => {
  if (m === mode) return
  if (m === 'src') {
    shown = current()
    textEl.value = shown
  } else if (textEl.value !== shown) {
    // The text was edited: the Editor view is rebuilt from it and the text is the truth from here.
    const [f, body] = split(textEl.value)
    front = f
    editor.commands.setContent(body, { contentType: 'markdown', emitUpdate: false })
    base = textEl.value
    richNewer = false
    if (!READONLY) tell(base !== disk)
  }
  mode = m
  show()
}
modeEd.addEventListener('click', () => setMode('ed'))
modeSrc.addEventListener('click', () => setMode('src'))
textEl.addEventListener('input', () => { if (!READONLY) tell(textEl.value !== disk) })

// ── load, export, saved ──────────────────────────────────────────────────────
let booted = false
async function load () {
  const f = await fetchFile()
  let bytes = f.bytes
  bom = ''
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) { bom = '\uFEFF'; bytes = bytes.subarray(3) }
  const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  eol = raw.includes('\r\n') ? '\r\n' : '\n'
  disk = raw.replace(/\r\n/g, '\n')
  base = disk
  endsNl = disk === '' || disk.endsWith('\n')
  const [fm, body] = split(disk)
  front = fm
  richNewer = false
  lastExport = disk
  make(body)
  textEl.value = disk
  textEl.readOnly = READONLY
  shown = disk
  if (!booted) { mode = TEXT_FIRST ? 'src' : 'ed'; booted = true }
  show()
  tell(false)
  loaded(f.hash, READONLY)
}

listen({
  exportBytes: async () => {
    const text = current()
    lastExport = text
    return new TextEncoder().encode(bom + (eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text))
  },
  reload: load,
  saved: () => {
    // Typing may have gone on while the page saved: only what was written becomes the new file.
    if (current() === lastExport) { disk = lastExport; base = lastExport; richNewer = false; tell(false) }
  }
})
load().catch(fail)
