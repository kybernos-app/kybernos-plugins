// What a light editor would do to a file, said before it opens (docs/dev/office-editors-open-save-contract-2026-11-03.md, "The guard, per format").
// Every editor re-writes the file it saves and none says what it drops, so the host looks inside first. Three levels:
//   loss     the 2026-11-03 spike measured the editor dropping it: the person chooses before the file opens (read only, edit anyway, cancel);
//   review   the editor keeps it but cannot act on it (accept or refuse a tracked change): a notice, and « review » belongs to the full editor;
//   untested no measurement either way: a notice. The guard errs towards flagging; a false alarm costs a click, a silent loss costs a file.
import { listParts, readText } from './zip-lite.mjs'

export const FORMATS = {
  docx: { editor: 'doc', root: 'word/document.xml', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  xlsx: { editor: 'sheet', root: 'xl/workbook.xml', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
}

/** `docx` or `xlsx` for a file name the light editors can open; null for anything else. */
export const formatOf = (name) => {
  const m = /\.([A-Za-z0-9]+)$/.exec(String(name || ''))
  const ext = m === null ? '' : m[1].toLowerCase()
  return Object.prototype.hasOwnProperty.call(FORMATS, ext) ? ext : null
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

/**
 * `{ ok: true, losses: [{ code, level, count }], block }` for a file a light editor may open (`block`: some loss is certain, ask first), or
 * `{ ok: false, reason }` — 'not-a-zip', 'zip64', 'part-too-big', 'too-many-parts' (the container) or `not-a-<format>` (a zip without the part that makes it one).
 */
export const inspect = (format, bytes) => {
  const spec = FORMATS[format]
  if (spec === undefined) return { ok: false, reason: 'unsupported-format' }
  try {
    const parts = listParts(bytes)
    if (!parts.has(spec.root)) return { ok: false, reason: 'not-a-' + format }
    const losses = (format === 'xlsx' ? xlsx : docx)(bytes, parts)
    return { ok: true, losses, block: losses.some((l) => l.level === 'loss') }
  } catch (e) {
    return { ok: false, reason: e && typeof e.code === 'string' ? e.code : 'not-a-zip' }
  }
}
