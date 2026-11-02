#!/usr/bin/env node
// data-feed — reads a table from a file (CSV and other delimited text, Excel .xlsx, JSON, JSON lines) and writes it as one JSON line per row,
// where the `records_import` tool of the Tables plugin picks it up by id. No dependency: node:fs, node:zlib, node:crypto.
//
//   node feed.mjs profile <file> [--sheet NAME|N] [--path a.b] [--delimiter ,] [--header-row N]
//       what is in the file: its columns, how full they are, a few values, and what each looks like (number, money, date, yes/no, choice, e-mail…)
//   node feed.mjs parse <file> [same options] [--id NAME]
//       writes <DSH home>/kybernos/imports/<id>.jsonl and prints the id; nothing else is touched
//
// Both print ONE JSON object on stdout: { ok: true, … } or { ok: false, error, detail } with exit code 1.
// The file format of the output is described at the top of packages/kybernos-db/agent/import.mjs, which reads it: a change here is a change there.
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { inflateRawSync } from 'node:zlib'

const MAX_BYTES = 64 * 1024 * 1024
const MAX_ROWS = 50000
const KEEP_DAYS = 14
const SAMPLE = 3000

const fail = (error, detail) => Object.assign(new Error(detail), { feed: error })
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const fold = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[\s  ]+/g, ' ').trim()

export const importsDir = (env = process.env) => join(typeof env.DSH_HOME === 'string' && env.DSH_HOME.trim() !== '' ? env.DSH_HOME.trim() : join(homedir(), '.dsh'), 'kybernos', 'imports')

// ── delimited text ──────────────────────────────────────────────────────────────────────────────────────────
/** Text → records [{ r, cells }] (r = the record's number in the file, 1-based, the header included). Quotes, doubled quotes and line breaks inside quotes follow RFC 4180. */
export function parseDelimited (text, delimiter, maxRecords = Infinity) {
  const records = []
  let cells = []
  let cell = ''
  let quoted = false
  let started = false
  let r = 1
  const endCell = () => { cells.push(cell.trim()); cell = ''; started = false }
  const endRecord = () => { endCell(); records.push({ r, cells }); cells = []; r += 1 }
  for (let i = 0; i < text.length && records.length < maxRecords; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else quoted = false } else cell += ch
    } else if (ch === '"' && !started && cell === '') { quoted = true; started = true } else if (ch === delimiter) endCell()
    else if (ch === '\n') endRecord()
    else if (ch === '\r') { if (text[i + 1] === '\n') i++; endRecord() } else { cell += ch; started = true }
  }
  if (records.length < maxRecords && (cell !== '' || cells.length > 0)) endRecord()
  return records
}

const sniffDelimiter = (text) => {
  const head = text.slice(0, 65536)
  let best = ','
  let bestScore = 0
  for (const d of [',', ';', '\t', '|']) {
    const counts = parseDelimited(head, d, 30).map((x) => x.cells.length)
    if (counts.length === 0) continue
    const freq = new Map()
    for (const c of counts) freq.set(c, (freq.get(c) || 0) + 1)
    const [width, n] = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]
    const score = width > 1 ? (n / counts.length) * 1000 + width : 0
    if (score > bestScore) { bestScore = score; best = d }
  }
  return best
}

const decode = (buf) => {
  let text
  let encoding = 'utf-8'
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf) } catch (e) { text = new TextDecoder('windows-1252').decode(buf); encoding = 'windows-1252' }
  return { text: text.charCodeAt(0) === 0xfeff ? text.slice(1) : text, encoding }
}

// ── Excel ───────────────────────────────────────────────────────────────────────────────────────────────────
/** A zip's entries by name, each inflated on demand. Plain zip only (no zip64, no encryption): what Excel writes. */
function readZip (buf) {
  let end = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break }
  if (end < 0) throw fail('format', 'not a zip file: an .xlsx file is one')
  const count = buf.readUInt16LE(end + 10)
  let at = buf.readUInt32LE(end + 16)
  const entries = new Map()
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw fail('format', 'the zip directory is damaged')
    const method = buf.readUInt16LE(at + 10)
    const size = buf.readUInt32LE(at + 20)
    const nameLen = buf.readUInt16LE(at + 28)
    const extraLen = buf.readUInt16LE(at + 30)
    const commentLen = buf.readUInt16LE(at + 32)
    const local = buf.readUInt32LE(at + 42)
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen)
    entries.set(name, () => {
      const data = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
      const raw = buf.subarray(data, data + size)
      if (method === 0) return raw
      if (method === 8) return inflateRawSync(raw, { maxOutputLength: 192 * 1024 * 1024 })
      throw fail('format', 'a zip entry uses a compression this reader does not know')
    })
    at += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

const unxml = (s) => s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e]))
const attr = (tag, name) => { const m = new RegExp('(?:^|\\s)' + name + '="([^"]*)"').exec(tag); return m ? unxml(m[1]) : null }
const column = (ref) => { let n = 0; for (const ch of /^[A-Z]+/.exec(ref)[0]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1 }

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58])
const isDateFormat = (code) => /[dmyhs]/i.test(code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, ''))

const pad = (n, w = 2) => String(n).padStart(w, '0')
/** An Excel serial → « YYYY-MM-DD », or « YYYY-MM-DDTHH:MM:SS » when it carries a time of day. */
function fromSerial (serial, base1904) {
  const whole = Math.floor(serial)
  const seconds = Math.round((serial - whole) * 86400)
  const days = base1904 ? whole - 24107 : whole - (whole >= 61 ? 25569 : 25568) // 1970-01-01 is 25569 (1900 system, after the phantom 29 Feb 1900) or 24107 (1904 system)
  const d = new Date(days * 86400000)
  const date = d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate())
  if (whole === 0 && !base1904) return pad(Math.floor(seconds / 3600)) + ':' + pad(Math.floor(seconds / 60) % 60)
  return seconds === 0 || seconds === 86400 ? date : date + 'T' + pad(Math.floor(seconds / 3600) % 24) + ':' + pad(Math.floor(seconds / 60) % 60) + ':' + pad(seconds % 60)
}

/** An .xlsx workbook → { sheets: [names], sheet, records: [{ r, cells }] } for the sheet asked (default: the first one). */
function readXlsx (buf, want) {
  const zip = readZip(buf)
  const text = (name) => (zip.has(name) ? zip.get(name)().toString('utf8') : null)
  const workbook = text('xl/workbook.xml')
  if (workbook === null) throw fail('format', 'not an Excel workbook (no xl/workbook.xml)')
  const rels = new Map()
  for (const m of (text('xl/_rels/workbook.xml.rels') || '').matchAll(/<Relationship\b[^>]*>/g)) rels.set(attr(m[0], 'Id'), attr(m[0], 'Target'))
  const sheets = []
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const target = rels.get(attr(m[0], 'r:id'))
    if (target !== undefined && attr(m[0], 'state') !== 'hidden') sheets.push({ name: attr(m[0], 'name'), file: target.startsWith('/') ? target.slice(1) : 'xl/' + target })
  }
  if (sheets.length === 0) throw fail('empty', 'the workbook has no sheet')
  let chosen = sheets[0]
  if (want !== undefined) {
    chosen = sheets.find((s) => s.name === want) || sheets.find((s) => fold(s.name) === fold(want)) || (/^\d+$/.test(want) ? sheets[Number(want) - 1] : undefined)
    if (!chosen) throw fail('unknown_sheet', 'no sheet "' + want + '": the sheets are ' + sheets.map((s) => '"' + s.name + '"').join(', '))
  }
  const strings = []
  const shared = text('xl/sharedStrings.xml')
  if (shared !== null) for (const si of shared.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) strings.push(unxml([...si[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')))
  const formats = new Map()
  const styles = text('xl/styles.xml') || ''
  for (const m of styles.matchAll(/<numFmt\b[^>]*>/g)) formats.set(Number(attr(m[0], 'numFmtId')), attr(m[0], 'formatCode') || '')
  const dateStyle = []
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)
  if (xfs) for (const m of xfs[1].matchAll(/<xf\b[^>]*>/g)) { const id = Number(attr(m[0], 'numFmtId')); dateStyle.push(BUILTIN_DATE_FORMATS.has(id) || (formats.has(id) && isDateFormat(formats.get(id)))) }
  const base1904 = /<workbookPr\b[^>]*date1904="(?:1|true)"/.test(workbook)
  const sheetXml = text(chosen.file)
  if (sheetXml === null) throw fail('format', 'the sheet "' + chosen.name + '" is missing from the file')
  const records = []
  for (const row of sheetXml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const r = Number(attr(row[1], 'r')) || records.length + 1
    const cells = []
    for (const c of (row[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(c[1], 'r')
      if (ref === null || c[2] === undefined) continue
      const type = attr(c[1], 't')
      const v = /<v>([\s\S]*?)<\/v>/.exec(c[2])
      let value = null
      if (type === 'inlineStr') value = unxml([...c[2].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''))
      else if (v !== null) {
        const raw = unxml(v[1])
        if (type === 's') value = strings[Number(raw)] === undefined ? null : strings[Number(raw)]
        else if (type === 'b') value = raw === '1'
        else if (type === 'e') value = null
        else if (type === 'str' || type === 'd') value = raw
        else if (Number.isFinite(Number(raw))) value = dateStyle[Number(attr(c[1], 's'))] === true ? fromSerial(Number(raw), base1904) : Number(raw)
      }
      cells[column(ref)] = typeof value === 'string' ? value.trim() : value
    }
    records.push({ r, cells: Array.from(cells, (x) => (x === undefined ? null : x)) })
  }
  return { sheets: sheets.map((s) => s.name), sheet: chosen.name, records }
}

// ── JSON ────────────────────────────────────────────────────────────────────────────────────────────────────
const flat = (obj, prefix, out) => {
  for (const [k, v] of Object.entries(obj)) {
    const name = prefix === '' ? k : prefix + '.' + k
    if (plain(v)) flat(v, name, out)
    else if (Array.isArray(v)) out[name] = v.every((x) => x === null || typeof x !== 'object') ? v.join('; ') : JSON.stringify(v)
    else out[name] = v
  }
  return out
}

function readJson (text, path, lines) {
  let data
  if (lines) data = text.split('\n').filter((l) => l.trim() !== '').map((l, i) => { try { return JSON.parse(l) } catch (e) { throw fail('format', 'line ' + (i + 1) + ' is not JSON') } })
  else { try { data = JSON.parse(text) } catch (e) { throw fail('format', 'not valid JSON: ' + e.message) } }
  if (path) for (const part of path.split('.')) data = plain(data) ? data[part] : undefined
  if (!Array.isArray(data) && plain(data)) {
    const arrays = Object.entries(data).filter(([, v]) => Array.isArray(v) && v.some(plain))
    const named = arrays.find(([k]) => /^(data|items|results|records|rows|orders|list)$/i.test(k))
    if (named) data = named[1]
    else if (arrays.length === 1) data = arrays[0][1]
    else if (arrays.length > 1) throw fail('which_array', 'the JSON holds several lists (' + arrays.map(([k]) => k).join(', ') + '): give --path')
  }
  if (!Array.isArray(data)) throw fail('format', 'no list of records in the JSON' + (path ? ' at "' + path + '"' : '') + ': give --path to the list')
  const rows = data.map((x) => (plain(x) ? flat(x, '', {}) : { value: x }))
  const columns = []
  for (const row of rows) for (const k of Object.keys(row)) if (!columns.includes(k)) columns.push(k)
  return [{ r: 1, cells: columns }, ...rows.map((row, i) => ({ r: i + 2, cells: columns.map((k) => (row[k] === undefined ? null : row[k])) }))]
}

// ── reading any file ────────────────────────────────────────────────────────────────────────────────────────
/** A file → { format, encoding?, delimiter?, sheets?, sheet?, columns, rows: [{ r, c }] }. The first record (or `--header-row`) names the columns. */
export function readTable (file, opts = {}) {
  let st
  try { st = statSync(file) } catch (e) { throw fail('not_found', 'no file at ' + file) }
  if (!st.isFile()) throw fail('not_found', file + ' is not a file')
  if (st.size > MAX_BYTES) throw fail('too_big', 'the file is over ' + MAX_BYTES / 1048576 + ' MB: split it')
  const buf = readFileSync(file)
  const ext = extname(file).toLowerCase()
  const out = {}
  let records
  const textual = ['.csv', '.tsv', '.txt'].includes(ext)
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0xd0cf11e0 && !textual) throw fail('xls', 'an old .xls file: save it as .xlsx (or CSV) from Excel first')
  if (buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50 && !textual) {
    const book = readXlsx(buf, opts.sheet)
    Object.assign(out, { format: 'xlsx', sheets: book.sheets, sheet: book.sheet })
    records = book.records
  } else {
    const { text, encoding } = decode(buf)
    if (ext === '.json' || ext === '.jsonl' || ext === '.ndjson' || (!textual && /^\s*[[{]/.test(text.slice(0, 200)))) {
      out.format = ext === '.jsonl' || ext === '.ndjson' ? 'jsonl' : 'json'
      records = readJson(text, opts.path, out.format === 'jsonl')
    } else {
      let body = text
      let delimiter = opts.delimiter === 'tab' || opts.delimiter === '\\t' ? '\t' : opts.delimiter
      const sep = /^sep=(.)\r?\n/i.exec(body) // the line Excel puts first in a CSV that uses another separator
      if (sep) { body = body.slice(sep[0].length); delimiter = delimiter || sep[1] }
      if (delimiter === undefined || delimiter === '') delimiter = sniffDelimiter(body)
      Object.assign(out, { format: ext === '.tsv' ? 'tsv' : ext === '.txt' ? 'text' : 'csv', encoding, delimiter })
      records = parseDelimited(body, delimiter)
    }
  }
  const headRow = Number.isInteger(opts.headerRow) ? opts.headerRow : null
  const nonEmpty = records.filter((x) => x.cells.some((c) => c !== null && c !== ''))
  const head = headRow !== null ? nonEmpty.find((x) => x.r === headRow) : nonEmpty[0]
  if (!head) throw fail('empty', 'the file holds no rows' + (headRow !== null ? ' at the header row ' + headRow : ''))
  const seen = new Map()
  const columns = head.cells.map((c, i) => {
    const base = c === null || c === '' ? 'column ' + (i + 1) : String(c)
    const n = (seen.get(base) || 0) + 1
    seen.set(base, n)
    return n === 1 ? base : base + ' (' + n + ')'
  })
  const width = columns.length
  const rows = nonEmpty.filter((x) => x.r > head.r).map((x) => ({ r: x.r, c: Array.from({ length: width }, (_, i) => (x.cells[i] === undefined || x.cells[i] === '' ? null : x.cells[i])) }))
  return { ...out, headerRow: head.r, columns, rows }
}

// ── what a column looks like ────────────────────────────────────────────────────────────────────────────────
const NUMBERISH = /^[(+\-−–]?[$€£¥]?\d[\d\s.,'’  ]*(?:[$€£¥%]|\s?[A-Za-z]{3})?\)?-?$/
const ISO_DAY = /^\d{4}-\d{1,2}-\d{1,2}(?:[T ]\d{1,2}:\d{2}(?::\d{2})?)?$/
const NUM_DAY = /^\d{1,2}[/.\-]\d{1,2}[/.\-](?:\d{2}|\d{4})(?:[T ,]+\d{1,2}:\d{2}(?::\d{2})?)?$/
const WORD_DAY = /^(?:\d{1,2}(?:st|nd|rd|th|er)?[\s.\-/]+[A-Za-zÀ-ÿ]{3,}\.?,?[\s.\-/]+\d{4}|[A-Za-zÀ-ÿ]{3,}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE = /^(?:\+|00|0)\d[\d\s().-]{7,}$/
const URL_TEXT = /^https?:\/\/[^\s/]+\S*$/
const YESNO = new Set(['true', 'false', 'yes', 'no', 'oui', 'non', 'y', 'n', 'vrai', 'faux', 'x'])
const MONEY_NAME = /amount|price|total|revenue|sales|cost|montant|prix|chiffre|\bca\b|fee|tax|tva|ttc|\bht\b|salary|salaire|budget|importe|precio|[€$£]/i

/** Same rule as agent/import.mjs `decimalOf`: the mark the values settle, or null. */
const decimalOf = (cells) => {
  let dot = 0
  let comma = 0
  for (const raw of cells) {
    const s = String(raw).replace(/[^\d.,]/g, '')
    const d = s.lastIndexOf('.')
    const c = s.lastIndexOf(',')
    if (d >= 0 && c >= 0) { if (d > c) dot++; else comma++; continue }
    const mark = d >= 0 ? '.' : c >= 0 ? ',' : ''
    if (mark === '') continue
    const parts = s.split(mark)
    if (parts.length > 2) { if (mark === '.') comma++; else dot++; continue }
    if (parts[1].length !== 3) { if (mark === '.') dot++; else comma++ }
  }
  return dot > 0 && comma === 0 ? '.' : comma > 0 && dot === 0 ? ',' : null
}
/** Same rule as agent/import.mjs `dateOrderOf`. */
const dateOrderOf = (cells) => {
  let dmy = 0
  let mdy = 0
  for (const raw of cells) {
    const m = /^\s*(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})(?:\D.*)?$/.exec(String(raw))
    if (!m) continue
    if (Number(m[1]) > 12) dmy++
    else if (Number(m[2]) > 12) mdy++
  }
  return dmy > 0 && mdy === 0 ? 'dmy' : mdy > 0 && dmy === 0 ? 'mdy' : null
}

export function profileColumn (name, cells) {
  const filled = cells.filter((c) => c !== null && c !== '')
  const strings = filled.map((c) => (typeof c === 'string' ? c : String(c)))
  const sample = strings.slice(0, SAMPLE)
  const counts = new Map()
  for (const s of strings) counts.set(s, (counts.get(s) || 0) + 1)
  const all = (test) => sample.length > 0 && sample.every(test)
  const out = { name, filled: filled.length, empty: cells.length - filled.length, distinct: counts.size, unique: filled.length > 0 && counts.size === filled.length, samples: [...counts.keys()].slice(0, 3).map((s) => s.slice(0, 40)), likely: 'text' }
  if (filled.length === 0) return out
  if (filled.every((c) => typeof c === 'boolean') || all((s) => YESNO.has(fold(s)))) out.likely = 'checkbox'
  else if (all((s) => PHONE.test(s.trim()))) out.likely = 'phone'
  else if (filled.every((c) => typeof c === 'number') || all((s) => NUMBERISH.test(s.trim()) && !/^0\d/.test(s.trim()))) {
    out.likely = MONEY_NAME.test(name) || sample.some((s) => /[$€£¥]/.test(s)) ? 'money' : 'number'
    const mark = decimalOf(filled.filter((c) => typeof c === 'string'))
    if (mark !== null) out.decimal = mark
  } else if (all((s) => ISO_DAY.test(s.trim()) || NUM_DAY.test(s.trim()) || WORD_DAY.test(s.trim()))) {
    out.likely = 'date'
    if (sample.some((s) => NUM_DAY.test(s.trim()))) { const order = dateOrderOf(sample); out.dateOrder = order; if (order === null) out.ambiguous = 'the day and the month are both 12 or less in every value: ask which comes first' }
  } else if (all((s) => EMAIL.test(s))) out.likely = 'email'
  else if (all((s) => URL_TEXT.test(s))) out.likely = 'url'
  else if (counts.size <= 20 && filled.length >= (counts.size <= 6 ? 2 : 3) * counts.size) out.likely = 'choice'
  else if (Math.max(...sample.map((s) => s.length)) > 300) out.likely = 'longtext'
  if (out.likely === 'choice') out.choices = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([value, rows]) => ({ value: value.slice(0, 40), rows }))
  return out
}

// ── commands ────────────────────────────────────────────────────────────────────────────────────────────────
const idFor = (file, given) => {
  if (given !== undefined) { if (!/^[a-z0-9][a-z0-9-]{5,47}$/.test(given)) throw fail('invalid', '--id is 6 to 48 characters: lower-case letters, digits and dashes'); return given }
  const slug = basename(file, extname(file)).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30)
  return (slug.length >= 2 ? slug : 'import') + '-' + randomBytes(4).toString('hex')
}

const sweep = (dir) => {
  const limit = Date.now() - KEEP_DAYS * 86400000
  try { for (const f of readdirSync(dir)) if (/\.jsonl(?:\.tmp)?$/.test(f) && statSync(join(dir, f)).mtimeMs < limit) rmSync(join(dir, f), { force: true }) } catch (e) { /* nothing to sweep */ }
}

export function run (argv, env = process.env) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { args[argv[i].slice(2)] = argv[i + 1] === undefined || argv[i + 1].startsWith('--') ? true : argv[++i] } else args._.push(argv[i])
  }
  const [command, file] = args._
  if ((command !== 'profile' && command !== 'parse') || !file) throw fail('usage', 'node feed.mjs profile|parse <file> [--sheet NAME] [--path a.b] [--delimiter ,] [--header-row N] [--id NAME]')
  const t = readTable(file, { sheet: typeof args.sheet === 'string' ? args.sheet : undefined, path: typeof args.path === 'string' ? args.path : undefined, delimiter: typeof args.delimiter === 'string' ? args.delimiter : undefined, headerRow: /^\d+$/.test(args['header-row']) ? Number(args['header-row']) : undefined })
  if (t.rows.length > MAX_ROWS) throw fail('too_many_rows', 'the file has ' + t.rows.length + ' rows and an import holds at most ' + MAX_ROWS + ': split it')
  const common = { ok: true, format: t.format, ...(t.encoding ? { encoding: t.encoding } : {}), ...(t.delimiter ? { delimiter: t.delimiter === '\t' ? 'tab' : t.delimiter } : {}), ...(t.sheet ? { sheet: t.sheet, sheets: t.sheets } : {}), headerRow: t.headerRow, rows: t.rows.length }
  if (command === 'profile') return { ...common, columns: t.columns.map((name, i) => profileColumn(name, t.rows.map((r) => r.c[i]))) }
  const id = idFor(file, typeof args.id === 'string' ? args.id : undefined)
  const dir = importsDir(env)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  sweep(dir)
  const head = { kind: 'kybernos-import', version: 1, id, source: basename(file), format: t.format, sheet: t.sheet || null, columns: t.columns, rows: t.rows.length, created: new Date().toISOString() }
  const body = [JSON.stringify(head), ...t.rows.map((r) => JSON.stringify({ r: r.r, c: r.c }))].join('\n') + '\n'
  const target = join(dir, id + '.jsonl')
  writeFileSync(target + '.tmp', body, { mode: 0o600 })
  renameSync(target + '.tmp', target)
  return { ...common, id, file: target, columns: t.columns, sha256: createHash('sha256').update(body).digest('hex').slice(0, 16), next: 'records_import { object, import: "' + id + '", columns: { "<column title>": "<field key>" }, dryRun: true }' }
}

const isMain = () => { try { return process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href } catch (e) { return false } } // the path may go through a symlink (/var on macOS)
if (isMain()) {
  try {
    console.log(JSON.stringify(run(process.argv.slice(2))))
  } catch (e) {
    console.log(JSON.stringify({ ok: false, error: e.feed || 'failed', detail: e.message }))
    process.exit(1)
  }
}
