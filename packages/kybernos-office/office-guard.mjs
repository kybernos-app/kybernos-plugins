// What a light editor would do to a file, said before it opens (docs/dev/office-editors-open-save-contract-2026-11-03.md, "The guard, per format").
// Every editor re-writes the file it saves and none says what it drops, so the host looks inside first. Three levels:
//   loss     the 2026-11-03 spike measured the editor dropping it: the person chooses before the file opens (read only, edit anyway, cancel);
//   review   the editor keeps it but cannot act on it (accept or refuse a tracked change): a notice, and « review » belongs to the full editor;
//   untested no measurement either way: a notice. The guard errs towards flagging; a false alarm costs a click, a silent loss costs a file.
import { listParts, readText } from './zip-lite.mjs'

export const FORMATS = {
  docx: { editor: 'doc', root: 'word/document.xml', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  xlsx: { editor: 'sheet', root: 'xl/workbook.xml', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  md: { editor: 'md', root: null, type: 'text/markdown' },
  pdf: { editor: 'pdf', root: null, type: 'application/pdf' },
}
// The file suffixes (lower case) and the format each one is.
const SUFFIXES = { docx: 'docx', xlsx: 'xlsx', md: 'md', markdown: 'md', pdf: 'pdf' }

/** `docx`, `xlsx`, `md` or `pdf` for a file name the light editors can open; null for anything else. */
export const formatOf = (name) => {
  const m = /\.([A-Za-z0-9]+)$/.exec(String(name || ''))
  const ext = m === null ? '' : m[1].toLowerCase()
  return Object.prototype.hasOwnProperty.call(SUFFIXES, ext) ? SUFFIXES[ext] : null
}

const has = (parts, prefix) => { let n = 0; for (const k of parts.keys()) if (k.startsWith(prefix) && !k.endsWith('/')) n += 1; return n }
const count = (text, re) => (text === null ? 0 : (text.match(re) || []).length)

const xlsx = (buf, parts) => {
  const out = []
  const add = (code, level, n) => { if (n > 0) out.push({ code, level, count: n }) }
  add('chart', 'loss', has(parts, 'xl/charts/'))
  add('comment', 'loss', has(parts, 'xl/comments') + has(parts, 'xl/threadedComments/'))
  let validation = 0
  let filter = 0
  for (const name of parts.keys()) {
    if (/^xl\/worksheets\/[^/]+\.xml$/.test(name)) {
      const xml = readText(buf, parts, name)
      validation += count(xml, /<dataValidation[\s>]/g)
      filter += count(xml, /<autoFilter[\s>]/g)
    }
  }
  add('validation', 'loss', validation)
  add('image', 'untested', has(parts, 'xl/media/'))
  add('pivot', 'untested', has(parts, 'xl/pivotTables/'))
  add('table', 'untested', has(parts, 'xl/tables/'))
  add('filter', 'untested', filter)
  add('external-link', 'untested', has(parts, 'xl/externalLinks/'))
  add('macro', 'loss', parts.has('xl/vbaProject.bin') ? 1 : 0)
  return out
}

const docx = (buf, parts) => {
  const out = []
  const add = (code, level, n) => { if (n > 0) out.push({ code, level, count: n }) }
  const body = readText(buf, parts, 'word/document.xml')
  add('tracked-changes', 'review', count(body, /<w:(?:ins|del|moveFrom|moveTo)[\s>]/g))
  const comments = readText(buf, parts, 'word/comments.xml')
  add('comment', 'review', count(comments, /<w:comment[\s>]/g))
  add('content-control', 'untested', count(body, /<w:sdt[\s>]/g))
  add('field', 'untested', count(body, /<w:fldSimple[\s>]/g) + count(body, /<w:fldChar[\s>]/g) / 3)
  add('image', 'untested', has(parts, 'word/media/'))
  add('equation', 'untested', count(body, /<m:oMath[\s>]/g))
  add('macro', 'loss', parts.has('word/vbaProject.bin') ? 1 : 0)
  return out.map((x) => ({ ...x, count: Math.max(1, Math.round(x.count)) }))
}

// Markdown: the editor writes the text again, so what it has no node for is dropped. The text is read without what is not prose: the front matter (set aside and put
// back by the editor, so no loss) and code (kept as it is), then the guard looks for HTML, footnotes, reference links, math. A fence is read line by line.
const prose = (text) => {
  let body = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const front = /^---[ \t]*\n[\s\S]*?\n---[ \t]*(\n|$)/.exec(body)
  if (front !== null) body = body.slice(front[0].length)
  const out = []
  let fence = null
  for (const line of body.split('\n')) {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (fence === null) {
      if (m !== null) { fence = m[1]; continue }
      out.push(line.replace(/`[^`]*`/g, ''))
    } else if (m !== null && m[1][0] === fence[0] && m[1].length >= fence.length && /^ {0,3}[`~]+[ \t]*$/.test(line)) fence = null
  }
  return out.join('\n')
}

const markdown = (bytes) => {
  if (!(bytes instanceof Uint8Array) || bytes.includes(0)) return { ok: false, reason: 'not-text' }
  let text
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch (e) { return { ok: false, reason: 'not-text' } }
  const body = prose(text)
  const out = []
  const add = (code, level, n) => { if (n > 0) out.push({ code, level, count: n }) }
  add('html-comment', 'loss', count(body, /<!--/g))
  add('html', 'loss', count(body, /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>/g))
  add('footnote', 'loss', count(body, /^ {0,3}\[\^[^\]\n]+\]:/gm))
  add('reference-link', 'loss', count(body, /^ {0,3}\[(?!\^)[^\]\n]+\]:[ \t]*\S+/gm))
  add('math', 'loss', count(body, /\$\$[\s\S]*?\$\$/g))
  add('wiki-link', 'untested', count(body, /\[\[[^\]\n]+\]\]/g))
  return { ok: true, losses: out, block: out.some((l) => l.level === 'loss') }
}

// PDF: read as bytes. What sits in compressed object streams (a catalog of a recent file) is not seen, so the notice for a form is a hint, not a promise.
const pdf = (bytes) => {
  if (!(bytes instanceof Uint8Array) || bytes.length < 8) return { ok: false, reason: 'not-a-pdf' }
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1')
  if (!text.slice(0, 1024).includes('%PDF-')) return { ok: false, reason: 'not-a-pdf' }
  const out = []
  const add = (code, level, n) => { if (n > 0) out.push({ code, level, count: n }) }
  add('encrypted', 'loss', count(text, /\/Encrypt\s*(?:\d+\s+\d+\s+R|<<)/g))
  add('signature', 'loss', count(text, /\/ByteRange\s*\[/g))
  add('form', 'untested', count(text, /\/AcroForm\b/g))
  add('attachment', 'untested', count(text, /\/EmbeddedFile\b/g))
  return { ok: true, losses: out, block: out.some((l) => l.level === 'loss') }
}

/**
 * `{ ok: true, losses: [{ code, level, count }], block }` for a file a light editor may open (`block`: some loss is certain, ask first), or
 * `{ ok: false, reason }` — 'not-a-zip', 'zip64', 'part-too-big', 'too-many-parts' (the container), `not-a-<format>` (a zip without the part that makes it one),
 * 'not-text' (a Markdown file that is not UTF-8 text) or 'not-a-pdf'.
 */
export const inspect = (format, bytes) => {
  const spec = FORMATS[format]
  if (spec === undefined) return { ok: false, reason: 'unsupported-format' }
  if (format === 'md') return markdown(bytes)
  if (format === 'pdf') return pdf(bytes)
  try {
    const parts = listParts(bytes)
    if (!parts.has(spec.root)) return { ok: false, reason: 'not-a-' + format }
    const losses = (format === 'xlsx' ? xlsx : docx)(bytes, parts)
    return { ok: true, losses, block: losses.some((l) => l.level === 'loss') }
  } catch (e) {
    return { ok: false, reason: e && typeof e.code === 'string' ? e.code : 'not-a-zip' }
  }
}
