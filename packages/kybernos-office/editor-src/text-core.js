// The rules of the text editor (.txt, .csv, .tsv, .json, .yaml, .toml…), with no page and no network, so they run the same in the frame and in the tests.
// The file on disk stays the truth: the byte-order mark, the line ends and the final newline are put back as they were, and the table view of a CSV file writes
// the file again only when a cell was changed.

/** What the file is, by its name: 'json', 'csv', 'tsv' or 'text' (every other plain-text file). */
export const kindOf = (name) => {
  const n = String(name || '').toLowerCase()
  if (/\.json$/.test(n)) return 'json'
  if (/\.tsv$/.test(n)) return 'tsv'
  if (/\.csv$/.test(n)) return 'csv'
  return 'text'
}

/** The text of a file's bytes in LF, with what must be put back when it is written: `{ bom, eol, text }`. Throws on bytes that are not UTF-8. */
export function decode (bytes) {
  let b = bytes
  let bom = ''
  if (b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) { bom = '﻿'; b = b.subarray(3) }
  const raw = new TextDecoder('utf-8', { fatal: true }).decode(b)
  return { bom, eol: raw.includes('\r\n') ? '\r\n' : '\n', text: raw.replace(/\r\n/g, '\n') }
}

/** The bytes of a text, with the byte-order mark and the line end of the file it came from. */
export const encode = (seen, text) => new TextEncoder().encode(seen.bom + (seen.eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text))

const DELIMS = [',', ';', '\t', '|']

/** The field separator of a delimited file: a `.tsv` is tabs; otherwise the one of , ; tab | that the first lines use most (outside quotes), the comma by default. */
export function detectDelimiter (text, name) {
  if (kindOf(name) === 'tsv') return '\t'
  const counts = new Map(DELIMS.map((d) => [d, 0]))
  let inQ = false
  let lines = 0
  for (let i = 0; i < text.length && lines < 5; i += 1) {
    const c = text[i]
    if (c === '"') inQ = !inQ
    else if (!inQ && c === '\n') lines += 1
    else if (!inQ && counts.has(c)) counts.set(c, counts.get(c) + 1)
  }
  let best = ','
  for (const d of DELIMS) if (counts.get(d) > counts.get(best)) best = d
  return best
}

/**
 * The rows of a delimited text (LF line ends): `{ rows, open }`. A quote opens a quoted field only at the start of a field; inside one, `""` is a quote and the
 * delimiter and the line end are text. `open` is true when a quote was never closed (the text is not a table, edit it as text).
 */
export function parseCsv (text, delim) {
  const rows = []
  let row = []
  let field = ''
  let inQ = false
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue }
        inQ = false; i += 1; continue
      }
      field += c; i += 1; continue
    }
    if (c === '"' && field === '') { inQ = true; i += 1; continue }
    if (c === delim) { row.push(field); field = ''; i += 1; continue }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i += 1; continue }
    field += c; i += 1
  }
  if (field !== '' || row.length > 0 || inQ) { row.push(field); rows.push(row) }
  return { rows, open: inQ }
}

const quoted = (f, delim) => (f.includes(delim) || f.includes('"') || f.includes('\n') ? '"' + f.replace(/"/g, '""') + '"' : f)

/** A delimited text from rows: quotes only where a field needs them, the final newline as asked. */
export const serializeCsv = (rows, delim, endsNl) => rows.map((r) => r.map((f) => quoted(f, delim)).join(delim)).join('\n') + (endsNl && rows.length > 0 ? '\n' : '')

/** Most cells the table view draws: beyond it the file is edited as text. */
export const TABLE_MAX_CELLS = 20000

/**
 * Whether a delimited text can be drawn as a table, and the grid to draw: `{ ok, grid, width }` or `{ ok: false, why }` with why = 'open' (an unclosed quote), 'multiline'
 * (a field holds a line end: a cell is one line) or 'big' (more than TABLE_MAX_CELLS cells). The grid is rectangular: the short rows are padded with empty cells.
 */
export function toGrid (text, delim) {
  const { rows, open } = parseCsv(text, delim)
  if (open) return { ok: false, why: 'open' }
  let width = 1
  for (const r of rows) {
    if (r.length > width) width = r.length
    for (const f of r) if (f.includes('\n')) return { ok: false, why: 'multiline' }
  }
  if (rows.length * width > TABLE_MAX_CELLS) return { ok: false, why: 'big' }
  const grid = rows.length === 0 ? [['']] : rows.map((r) => r.concat(new Array(width - r.length).fill('')))
  return { ok: true, grid, width: grid[0].length }
}

/** `{ ok: true }`, `{ ok: false, empty: true }` for a blank text, or `{ ok: false, message, line, col }` (line and column from 1, null when the engine did not say). */
export function jsonStatus (text) {
  if (String(text).trim() === '') return { ok: false, empty: true }
  try { JSON.parse(text); return { ok: true } } catch (e) {
    const message = String(e && e.message ? e.message : e)
    let line = null
    let col = null
    const lc = /line (\d+) column (\d+)/.exec(message)
    const pos = /position (\d+)/.exec(message)
    if (lc !== null) { line = Number(lc[1]); col = Number(lc[2]) } else if (pos !== null) {
      const before = text.slice(0, Number(pos[1]))
      line = before.split('\n').length
      col = Number(pos[1]) - before.lastIndexOf('\n')
    }
    return { ok: false, message, line, col }
  }
}

/** A valid JSON text written again with two-space indents (its final newline kept), or null when it is not valid JSON. */
export function formatJson (text) {
  try { return JSON.stringify(JSON.parse(text), null, 2) + (text.endsWith('\n') ? '\n' : '') } catch (e) { return null }
}

/** « 3 lines · 120 characters »: the numbers of a text (a final newline does not start a line). */
export function countText (text) {
  const chars = Array.from(text).length
  const lines = text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
  return { lines, chars }
}
