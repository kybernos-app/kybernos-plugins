// ═══════════════════════════════════════════════════════════════════════════
// kybernos-knowledge — Zero-dependency document extractor & chunker.
//
// Supported formats: .md, .markdown, .txt, .csv, .docx, .pdf.
// Every extracted chunk carries a section breadcrumb and a citable locator
// (line range, CSV row range, heading, or page number). Pure Node built-ins.
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { inflateRawSync, inflateSync } from 'node:zlib'

export const SUPPORTED_EXTENSIONS = ['.md', '.markdown', '.txt', '.csv', '.docx', '.pdf']
export const MAX_FILE_BYTES = 8 * 1024 * 1024
export const TARGET_CHUNK_CHARS = 900
export const OVERLAP_CHARS = 120
export const MAX_CHUNKS_PER_FILE = 400

// ── Text normalisation, tokenisation and secret masking ──────────────────────

const NEEDS_FOLD = /[A-Z]|[^\x00-\x7f]/g
const foldChar = (c) => {
  const code = c.charCodeAt(0)
  if (code < 128) return String.fromCharCode(code + 32)
  const f = c.normalize('NFD')[0].toLowerCase()
  return f.length === 1 ? f : c
}

/** Accent- and case-insensitive one-to-one fold (keeps offsets aligned). */
export function fold (s) {
  return String(s ?? '').replace(NEEDS_FOLD, foldChar)
}

const STOPWORDS = new Set([
  // English
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have', 'in',
  'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'was', 'were', 'with',
  // French
  'au', 'aux', 'avec', 'ce', 'ces', 'dans', 'de', 'des', 'du', 'elle', 'en', 'est', 'et',
  'il', 'ils', 'je', 'la', 'le', 'les', 'leur', 'lui', 'mais', 'me', 'ne', 'nos', 'notre',
  'nous', 'on', 'ou', 'par', 'pas', 'pour', 'que', 'qui', 'sa', 'se', 'ses', 'son', 'sur',
  'ta', 'te', 'tes', 'ton', 'tu', 'un', 'une', 'vos', 'votre', 'vous'
])

/** Tokenise text into lowercase folded terms for BM25 indexing and querying. */
export function tokenize (text, { keepStopwords = false } = {}) {
  const f = fold(text)
  const matches = f.match(/[a-z0-9][a-z0-9_-]{1,}/g)
  if (matches === null) return []
  const out = []
  for (const w of matches) {
    if (!keepStopwords && w.length <= 3 && STOPWORDS.has(w)) continue
    out.push(w)
  }
  return out
}

/** Masks long alphanumeric tokens that look like API keys before displaying snippets. */
export function maskSecrets (text) {
  return String(text ?? '')
    .replace(/\b(?:sk-[a-zA-Z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|xox[baprs]-[0-9A-Za-z-]{10,})\b/g, (m) => m.slice(0, 4) + '••••')
    .replace(/[A-Za-z0-9_\-|+/=]{32,}/g, (m) => (/[0-9]/.test(m) && /[A-Za-z]/.test(m) ? '\u2022'.repeat(Math.min(16, m.length)) : m))
}

const cleanSpace = (s) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')

function makeChunk (idx, section, locator, rawText) {
  const text = rawText.replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (text === '') return null
  return { idx, section: section || '', locator: locator || '', text }
}

/** Splits a long text block into overlapping chunks near sentence/line boundaries. */
function splitLongText (text, target = TARGET_CHUNK_CHARS, overlap = OVERLAP_CHARS) {
  const clean = text.trim()
  if (clean.length <= target) return clean === '' ? [] : [clean]
  const parts = []
  let pos = 0
  while (pos < clean.length && parts.length < MAX_CHUNKS_PER_FILE) {
    let end = Math.min(clean.length, pos + target)
    if (end < clean.length) {
      const nl = clean.lastIndexOf('\n', end)
      const dot = clean.lastIndexOf('. ', end)
      const sp = clean.lastIndexOf(' ', end)
      const cut = nl > pos + target * 0.5 ? nl : (dot > pos + target * 0.5 ? dot + 1 : (sp > pos + target * 0.4 ? sp : end))
      end = cut
    }
    const slice = clean.slice(pos, end).trim()
    if (slice !== '') parts.push(slice)
    if (end >= clean.length) break
    pos = Math.max(pos + 1, end - overlap)
  }
  return parts
}

// ── Markdown (.md / .markdown) ───────────────────────────────────────────────

export function extractMarkdown (rawText, fileName = 'document.md') {
  const lines = cleanSpace(rawText).split('\n')
  const headings = []
  let title = basename(fileName, extname(fileName))
  const stack = []
  const sections = []
  let current = { section: '', startLine: 1, lines: [] }
  let inFence = false

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (/^\s*(?:```|~~~)/.test(line)) {
      inFence = !inFence
      current.lines.push(line)
      continue
    }
    const hm = !inFence ? /^\s*(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line) : null
    if (hm !== null) {
      if (current.lines.join('\n').trim() !== '') {
        sections.push({ ...current, endLine: i })
      }
      const level = hm[1].length
      const headingText = hm[2].trim()
      headings.push({ level, text: headingText, line: i + 1 })
      if (level === 1 && title === basename(fileName, extname(fileName))) title = headingText
      while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop()
      stack.push({ level, text: headingText })
      current = {
        section: stack.map((h) => h.text).join(' > '),
        startLine: i + 1,
        lines: [line]
      }
    } else {
      current.lines.push(line)
    }
  }
  if (current.lines.join('\n').trim() !== '') {
    sections.push({ ...current, endLine: lines.length })
  }

  const chunks = []
  for (const sec of sections) {
    const body = sec.lines.join('\n').trim()
    const slices = splitLongText(body)
    for (let s = 0; s < slices.length && chunks.length < MAX_CHUNKS_PER_FILE; s += 1) {
      const loc = sec.startLine === sec.endLine ? 'L' + sec.startLine : 'L' + sec.startLine + '-L' + sec.endLine
      const c = makeChunk(chunks.length, sec.section, loc, slices[s])
      if (c !== null) chunks.push(c)
    }
  }
  return { format: 'md', title, headings: headings.map((h) => h.text).slice(0, 40), chunks }
}

// ── Plain text (.txt) ────────────────────────────────────────────────────────

export function extractText (rawText, fileName = 'document.txt') {
  const lines = cleanSpace(rawText).split('\n')
  const title = basename(fileName, extname(fileName))
  const chunks = []
  let buf = []
  let startLine = 1
  const flush = (endLine) => {
    const joined = buf.join('\n').trim()
    if (joined === '') { buf = []; return }
    for (const part of splitLongText(joined)) {
      if (chunks.length >= MAX_CHUNKS_PER_FILE) break
      const loc = startLine === endLine ? 'L' + startLine : 'L' + startLine + '-L' + endLine
      const c = makeChunk(chunks.length, '', loc, part)
      if (c !== null) chunks.push(c)
    }
    buf = []
  }

  let charAcc = 0
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.trim() === '' && charAcc >= TARGET_CHUNK_CHARS * 0.65) {
      flush(i)
      startLine = i + 2
      charAcc = 0
      continue
    }
    if (buf.length === 0) startLine = i + 1
    buf.push(line)
    charAcc += line.length + 1
    if (charAcc >= TARGET_CHUNK_CHARS) {
      flush(i + 1)
      startLine = i + 2
      charAcc = 0
    }
  }
  flush(lines.length)
  return { format: 'txt', title, headings: [], chunks }
}

// ── CSV (.csv) ───────────────────────────────────────────────────────────────

function detectCsvDelimiter (firstLine) {
  const commas = (firstLine.match(/,/g) || []).length
  const semis = (firstLine.match(/;/g) || []).length
  const tabs = (firstLine.match(/\t/g) || []).length
  if (tabs > commas && tabs >= semis) return '\t'
  if (semis > commas) return ';'
  return ','
}

function parseCsvRows (text, delim) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1 }
      else if (ch === '"') inQuotes = false
      else field += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === delim) {
      row.push(field.trim())
      field = ''
    } else if (ch === '\n') {
      row.push(field.trim())
      if (row.some((cell) => cell !== '')) rows.push(row)
      row = []
      field = ''
    } else if (ch !== '\r') {
      field += ch
    }
  }
  row.push(field.trim())
  if (row.some((cell) => cell !== '')) rows.push(row)
  return rows
}

export function extractCsv (rawText, fileName = 'data.csv') {
  const clean = cleanSpace(rawText).replace(/^\ufeff/, '')
  const firstLine = clean.split('\n', 1)[0] || ''
  const delim = detectCsvDelimiter(firstLine)
  const rows = parseCsvRows(clean, delim)
  const title = basename(fileName, extname(fileName))
  if (rows.length === 0) return { format: 'csv', title, headings: [], chunks: [] }

  const headers = rows[0].map((h, i) => h || 'col_' + (i + 1))
  const dataRows = rows.slice(1)
  const chunks = []
  let acc = []
  let startRow = 1
  let accLen = 0

  const flush = (endRow) => {
    if (acc.length === 0 || chunks.length >= MAX_CHUNKS_PER_FILE) return
    const loc = startRow === endRow ? 'row ' + startRow : 'rows ' + startRow + '-' + endRow
    const c = makeChunk(chunks.length, headers.slice(0, 6).join(', '), loc, acc.join('\n'))
    if (c !== null) chunks.push(c)
    acc = []
    accLen = 0
  }

  for (let i = 0; i < dataRows.length; i += 1) {
    const r = dataRows[i]
    const pairs = []
    for (let j = 0; j < Math.max(headers.length, r.length); j += 1) {
      const val = r[j] || ''
      if (val === '') continue
      pairs.push((headers[j] || 'col_' + (j + 1)) + ': ' + val)
    }
    if (pairs.length === 0) continue
    const line = pairs.join(' | ')
    if (acc.length === 0) startRow = i + 1
    if (accLen + line.length > TARGET_CHUNK_CHARS && acc.length > 0) {
      flush(i)
      startRow = i + 1
    }
    acc.push(line)
    accLen += line.length + 1
  }
  flush(dataRows.length)
  if (chunks.length === 0 && headers.length > 0) {
    const c = makeChunk(0, 'headers', 'row 0', headers.join(' | '))
    if (c !== null) chunks.push(c)
  }
  return { format: 'csv', title, headings: headers.slice(0, 30), chunks }
}

// ── DOCX (.docx — pure Node ZIP + OOXML extractor) ───────────────────────────

function readZipEntry (buf, targetName) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) return null
  // Locate End of Central Directory (PK\x05\x06) scanning backwards up to 64 KiB
  const minOffset = Math.max(0, buf.length - 65557)
  let eocd = -1
  for (let i = buf.length - 22; i >= minOffset; i -= 1) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
      eocd = i
      break
    }
  }
  if (eocd < 0) return null
  const cdEntries = buf.readUInt16LE(eocd + 10)
  const cdOffset = buf.readUInt32LE(eocd + 16)
  let ptr = cdOffset
  for (let n = 0; n < cdEntries && ptr + 46 <= buf.length; n += 1) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) break
    const method = buf.readUInt16LE(ptr + 10)
    const compSize = buf.readUInt32LE(ptr + 20)
    const nameLen = buf.readUInt16LE(ptr + 28)
    const extraLen = buf.readUInt16LE(ptr + 30)
    const commentLen = buf.readUInt16LE(ptr + 32)
    const localHeaderOff = buf.readUInt32LE(ptr + 42)
    const name = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString('utf8')
    ptr += 46 + nameLen + extraLen + commentLen
    if (name !== targetName) continue
    if (localHeaderOff + 30 > buf.length || buf.readUInt32LE(localHeaderOff) !== 0x04034b50) return null
    const lNameLen = buf.readUInt16LE(localHeaderOff + 26)
    const lExtraLen = buf.readUInt16LE(localHeaderOff + 28)
    const dataStart = localHeaderOff + 30 + lNameLen + lExtraLen
    const slice = buf.subarray(dataStart, dataStart + compSize)
    if (method === 0) return slice
    if (method === 8) return inflateRawSync(slice)
    return null
  }
  return null
}

function decodeXmlEntities (s) {
  return String(s ?? '')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, '\'')
}

export function extractDocx (buf, fileName = 'document.docx') {
  const titleDefault = basename(fileName, extname(fileName))
  const xmlBuf = readZipEntry(buf, 'word/document.xml')
  if (xmlBuf === null) return { format: 'docx', title: titleDefault, headings: [], chunks: [] }
  const xml = xmlBuf.toString('utf8')

  const paragraphs = []
  const pRe = /<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g
  let m
  while ((m = pRe.exec(xml)) !== null) {
    const inner = m[1]
    const styleMatch = /<w:pStyle\s+[^>]*w:val="([^"]+)"/.exec(inner)
    const style = styleMatch ? styleMatch[1] : ''
    const isHeading = /^(?:Heading|Titre|Title)\s*([1-6])?/i.exec(style)
    const texts = []
    const tRe = /<w:(?:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|tab\s*\/>|br\s*\/>)/g
    let tm
    while ((tm = tRe.exec(inner)) !== null) {
      if (tm[1] !== undefined) texts.push(decodeXmlEntities(tm[1]))
      else if (tm[0].includes('tab')) texts.push('\t')
      else texts.push('\n')
    }
    const text = cleanSpace(texts.join('')).trim()
    if (text === '') continue
    paragraphs.push({ text, headingLevel: isHeading ? (Number(isHeading[1]) || 1) : 0 })
  }

  let title = titleDefault
  const headings = []
  const chunks = []
  let currentSection = ''
  let acc = []
  let accLen = 0
  let startPara = 1

  const flush = (endPara) => {
    if (acc.length === 0 || chunks.length >= MAX_CHUNKS_PER_FILE) return
    const body = acc.join('\n')
    for (const part of splitLongText(body)) {
      if (chunks.length >= MAX_CHUNKS_PER_FILE) break
      const loc = startPara === endPara ? 'p.' + startPara : 'p.' + startPara + '-' + endPara
      const c = makeChunk(chunks.length, currentSection, loc, part)
      if (c !== null) chunks.push(c)
    }
    acc = []
    accLen = 0
  }

  for (let i = 0; i < paragraphs.length; i += 1) {
    const p = paragraphs[i]
    if (p.headingLevel > 0) {
      flush(i)
      headings.push(p.text)
      if (p.headingLevel === 1 && title === titleDefault) title = p.text
      currentSection = p.text
      startPara = i + 1
      acc.push(p.text)
      accLen = p.text.length
    } else {
      if (acc.length === 0) startPara = i + 1
      if (accLen + p.text.length > TARGET_CHUNK_CHARS && acc.length > 0) {
        flush(i)
        startPara = i + 1
      }
      acc.push(p.text)
      accLen += p.text.length + 1
    }
  }
  flush(paragraphs.length)
  return { format: 'docx', title, headings: headings.slice(0, 40), chunks }
}

// ── PDF (.pdf — pure Node text-stream extractor) ─────────────────────────────

function decodePdfLiteral (raw) {
  let out = ''
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]
    if (ch !== '\\') { out += ch; continue }
    i += 1
    if (i >= raw.length) break
    const esc = raw[i]
    if (esc === 'n') out += '\n'
    else if (esc === 'r') out += '\r'
    else if (esc === 't') out += '\t'
    else if (esc === 'b') out += '\b'
    else if (esc === 'f') out += '\f'
    else if (esc === '(' || esc === ')' || esc === '\\') out += esc
    else if (esc === '\r' || esc === '\n') { if (esc === '\r' && raw[i + 1] === '\n') i += 1 }
    else if (esc >= '0' && esc <= '7') {
      let oct = esc
      if (raw[i + 1] >= '0' && raw[i + 1] <= '7') { oct += raw[++i] }
      if (raw[i + 1] >= '0' && raw[i + 1] <= '7') { oct += raw[++i] }
      out += String.fromCharCode(parseInt(oct, 8))
    } else {
      out += esc
    }
  }
  return out
}

function decodePdfHex (hexStr) {
  const clean = hexStr.replace(/\s+/g, '')
  const padded = clean.length % 2 === 1 ? clean + '0' : clean
  const bytes = Buffer.from(padded, 'hex')
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let out = ''
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1])
    }
    return out
  }
  return bytes.toString('latin1')
}

function extractTextFromPdfStream (content) {
  const pieces = []
  const btRe = /BT\b([\s\S]*?)\bET/g
  let bm
  while ((bm = btRe.exec(content)) !== null) {
    const block = bm[1]
    const lineTokens = []
    let i = 0
    while (i < block.length) {
      const ch = block[i]
      if (ch === '(') {
        let depth = 1
        let j = i + 1
        let raw = ''
        while (j < block.length && depth > 0) {
          const c = block[j]
          if (c === '\\' && j + 1 < block.length) { raw += c + block[j + 1]; j += 2; continue }
          if (c === '(') depth += 1
          else if (c === ')') { depth -= 1; if (depth === 0) break }
          raw += c
          j += 1
        }
        lineTokens.push(decodePdfLiteral(raw))
        i = j + 1
      } else if (ch === '<' && block[i + 1] !== '<') {
        const end = block.indexOf('>', i + 1)
        if (end > i) {
          lineTokens.push(decodePdfHex(block.slice(i + 1, end)))
          i = end + 1
        } else {
          i += 1
        }
      } else if (block.startsWith('T*', i) || (block.startsWith('Td', i) && /\s/.test(block[i - 1] || ' '))) {
        lineTokens.push('\n')
        i += 2
      } else {
        i += 1
      }
    }
    const joined = cleanSpace(lineTokens.join('')).replace(/[ \t]{2,}/g, ' ').trim()
    if (joined !== '') pieces.push(joined)
  }
  return pieces.join('\n')
}

export function extractPdf (buf, fileName = 'document.pdf') {
  const title = basename(fileName, extname(fileName))
  if (!Buffer.isBuffer(buf) || buf.length < 8) return { format: 'pdf', title, headings: [], chunks: [] }
  const latin = buf.toString('latin1')
  const pageTexts = []

  let pos = 0
  while (pos < latin.length) {
    const sIdx = latin.indexOf('stream', pos)
    if (sIdx < 0) break
    const dictStart = Math.max(0, latin.lastIndexOf('<<', sIdx))
    const dict = latin.slice(dictStart, sIdx)
    let dataStart = sIdx + 6
    if (latin[dataStart] === '\r' && latin[dataStart + 1] === '\n') dataStart += 2
    else if (latin[dataStart] === '\n' || latin[dataStart] === '\r') dataStart += 1
    const eIdx = latin.indexOf('endstream', dataStart)
    if (eIdx < 0) break
    pos = eIdx + 9

    const rawSlice = buf.subarray(dataStart, eIdx)
    let decoded = ''
    if (/\/FlateDecode\b/.test(dict)) {
      try { decoded = inflateSync(rawSlice).toString('latin1') } catch {
        try { decoded = inflateRawSync(rawSlice).toString('latin1') } catch { decoded = '' }
      }
    } else if (!/\/DCTDecode\b|\/JPXDecode\b|\/CCITTFaxDecode\b/.test(dict)) {
      decoded = rawSlice.toString('latin1')
    }
    if (decoded.includes('BT')) {
      const txt = extractTextFromPdfStream(decoded)
      if (txt.trim() !== '') pageTexts.push(txt.trim())
    }
  }

  // Fallback for minimalist uncompressed PDFs with direct BT..ET outside streams
  if (pageTexts.length === 0 && latin.includes('BT')) {
    const txt = extractTextFromPdfStream(latin)
    if (txt.trim() !== '') pageTexts.push(txt.trim())
  }

  const chunks = []
  for (let p = 0; p < pageTexts.length && chunks.length < MAX_CHUNKS_PER_FILE; p += 1) {
    const slices = splitLongText(pageTexts[p])
    for (const s of slices) {
      if (chunks.length >= MAX_CHUNKS_PER_FILE) break
      const c = makeChunk(chunks.length, '', 'page ' + (p + 1), s)
      if (c !== null) chunks.push(c)
    }
  }
  return { format: 'pdf', title, headings: [], chunks }
}

// ── Unified file dispatcher ──────────────────────────────────────────────────

export function extractFile (filePath, relPath = basename(filePath)) {
  const st = statSync(filePath)
  if (!st.isFile()) return { ok: false, error: 'not-a-file' }
  if (st.size > MAX_FILE_BYTES) return { ok: false, error: 'file-too-large', size: st.size }
  const ext = extname(filePath).toLowerCase()
  if (!SUPPORTED_EXTENSIONS.includes(ext)) return { ok: false, error: 'unsupported-format', ext }

  const buf = readFileSync(filePath)
  let extracted
  if (ext === '.md' || ext === '.markdown') extracted = extractMarkdown(buf.toString('utf8'), relPath)
  else if (ext === '.txt') extracted = extractText(buf.toString('utf8'), relPath)
  else if (ext === '.csv') extracted = extractCsv(buf.toString('utf8'), relPath)
  else if (ext === '.docx') extracted = extractDocx(buf, relPath)
  else if (ext === '.pdf') extracted = extractPdf(buf, relPath)
  else return { ok: false, error: 'unsupported-format', ext }

  const totalChars = extracted.chunks.reduce((acc, c) => acc + c.text.length, 0)
  return { ok: true, ...extracted, size: st.size, mtimeMs: st.mtimeMs, totalChars }
}
