// The text of a PDF, with nothing but node:zlib: what Kaby reads of a document the person put in its knowledge folder (kyby-knowledge.mjs).
// It reads the page tree, the content streams (Flate, also inside object streams) and the fonts' ToUnicode maps, so that the text of the usual generators (Word, Chrome,
// LibreOffice, LaTeX) comes out in reading order. What it does NOT do, and says so: scanned pages (no text layer), encrypted files, fonts that carry no Unicode map,
// text drawn inside form XObjects, PNG-predicted object streams. A page it cannot read is reported, never invented. Pure and dependency-free: it takes a Buffer.
import { inflateSync } from 'node:zlib'

const MAX_STREAM_BYTES = 16 * 1024 * 1024
const MAX_OBJECTS = 200000
const MAX_PAGES = 400
const MAX_CHARS = 2_000_000

class Name { constructor (v) { this.v = v } }
class Ref { constructor (n) { this.n = n } }
class Str { constructor (v) { this.v = v } }

const isWs = (c) => c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0
const isDelim = (c) => c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37

const skipWs = (s, i) => {
  for (;;) {
    while (i < s.length && isWs(s.charCodeAt(i))) i += 1
    if (s.charCodeAt(i) === 37) { while (i < s.length && s.charCodeAt(i) !== 10 && s.charCodeAt(i) !== 13) i += 1; continue }
    return i
  }
}

const readToken = (s, i) => {
  const start = i
  while (i < s.length && !isWs(s.charCodeAt(i)) && !isDelim(s.charCodeAt(i))) i += 1
  return [s.slice(start, i), i]
}

const hexByte = (h) => String.fromCharCode(parseInt(h, 16))

/** One PDF value at `i` of the latin1 text `s`: a number, Name, Ref, Str, array, Map (dictionary), boolean, null, or { op } for a bare keyword. Returns [value, next]. */
function readValue (s, i, depth = 0) {
  if (depth > 40) throw new Error('too deep')
  i = skipWs(s, i)
  if (i >= s.length) return [undefined, i]
  const c = s.charCodeAt(i)
  if (c === 60 && s.charCodeAt(i + 1) === 60) { // <<
    const d = new Map()
    i += 2
    for (;;) {
      i = skipWs(s, i)
      if (i >= s.length) return [d, i]
      if (s.charCodeAt(i) === 62 && s.charCodeAt(i + 1) === 62) return [d, i + 2]
      const [k, afterKey] = readValue(s, i, depth + 1)
      if (!(k instanceof Name)) { i = afterKey > i ? afterKey : i + 1; continue }
      const [v, afterVal] = readValue(s, afterKey, depth + 1)
      d.set(k.v, v)
      i = afterVal
    }
  }
  if (c === 91) { // [
    const a = []
    i += 1
    for (;;) {
      i = skipWs(s, i)
      if (i >= s.length) return [a, i]
      if (s.charCodeAt(i) === 93) return [a, i + 1]
      const [v, next] = readValue(s, i, depth + 1)
      if (v === undefined) return [a, next]
      a.push(v)
      i = next > i ? next : i + 1
    }
  }
  if (c === 40) { // (literal string)
    let out = ''
    let nest = 1
    i += 1
    while (i < s.length && nest > 0) {
      const ch = s[i]
      if (ch === '\\') {
        const n = s[i + 1]
        if (n === 'n') out += '\n'
        else if (n === 'r') out += '\r'
        else if (n === 't') out += '\t'
        else if (n === 'b') out += '\b'
        else if (n === 'f') out += '\f'
        else if (n >= '0' && n <= '7') {
          let oct = n
          if (s[i + 2] >= '0' && s[i + 2] <= '7') { oct += s[i + 2]; if (s[i + 3] >= '0' && s[i + 3] <= '7') oct += s[i + 3] }
          out += String.fromCharCode(parseInt(oct, 8) & 255)
          i += oct.length - 1
        } else if (n === '\r') { if (s[i + 2] === '\n') i += 1 } else if (n === '\n') { /* line continuation */ } else out += n
        i += 2
        continue
      }
      if (ch === '(') nest += 1
      else if (ch === ')') { nest -= 1; if (nest === 0) { i += 1; break } }
      out += ch
      i += 1
    }
    return [new Str(out), i]
  }
  if (c === 60) { // <hex>
    const end = s.indexOf('>', i)
    const hex = s.slice(i + 1, end === -1 ? s.length : end).replace(/[^0-9a-fA-F]/gu, '')
    let out = ''
    for (let k = 0; k < hex.length; k += 2) out += hexByte(hex.slice(k, k + 2).padEnd(2, '0'))
    return [new Str(out), end === -1 ? s.length : end + 1]
  }
  if (c === 47) { // /Name
    const [tok, next] = readToken(s, i + 1)
    return [new Name(tok.replace(/#([0-9a-fA-F]{2})/gu, (m, h) => hexByte(h))), next]
  }
  if (c === 41 || c === 62 || c === 93 || c === 123 || c === 125) return [undefined, i + 1]
  const [tok, next] = readToken(s, i)
  if (tok === '') return [undefined, i + 1]
  if (/^[+-]?(\d+\.?\d*|\.\d+)$/u.test(tok)) {
    const num = Number(tok)
    if (/^\d+$/u.test(tok)) { // n g R
      const j = skipWs(s, next)
      const [g, afterG] = readToken(s, j)
      if (/^\d+$/u.test(g)) {
        const k = skipWs(s, afterG)
        if (s[k] === 'R' && (k + 1 >= s.length || isWs(s.charCodeAt(k + 1)) || isDelim(s.charCodeAt(k + 1)))) return [new Ref(num), k + 1]
      }
    }
    return [num, next]
  }
  if (tok === 'true') return [true, next]
  if (tok === 'false') return [false, next]
  if (tok === 'null') return [null, next]
  return [{ op: tok }, next]
}

const isOp = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Map) && !(v instanceof Name) && !(v instanceof Ref) && !(v instanceof Str) && typeof v.op === 'string'

// ── the file as a table of objects ───────────────────────────────────────────────────────────────────────────────

const filtersOf = (dict) => {
  const f = dict.get('Filter')
  const list = Array.isArray(f) ? f : f === undefined ? [] : [f]
  return list.map((x) => (x instanceof Name ? x.v : ''))
}

/** The decoded bytes of a stream, or null when its filter is not one we read (Flate only). */
function decodeStream (obj) {
  if (obj.stream === null) return null
  const filters = filtersOf(obj.dict)
  if (filters.length === 0) return obj.stream
  if (filters.length === 1 && (filters[0] === 'FlateDecode' || filters[0] === 'Fl')) {
    const parms = obj.dict.get('DecodeParms')
    const p = Array.isArray(parms) ? parms[0] : parms
    if (p instanceof Map && typeof p.get('Predictor') === 'number' && p.get('Predictor') > 1) return null
    try { return inflateSync(obj.stream, { maxOutputLength: MAX_STREAM_BYTES }) } catch (e) {
      // A stream cut short still gives what came before the cut.
      try { return inflateSync(obj.stream, { maxOutputLength: MAX_STREAM_BYTES, finishFlush: 2 }) } catch (e2) { return null }
    }
  }
  return null
}

function readObjects (buf) {
  const s = buf.toString('latin1')
  const objects = new Map()
  const re = /(\d+)\s+(\d+)\s+obj\b/gu
  let m
  let count = 0
  while ((m = re.exec(s)) !== null) {
    count += 1
    if (count > MAX_OBJECTS) break
    const num = Number(m[1])
    let value
    let next
    try { [value, next] = readValue(s, re.lastIndex) } catch (e) { continue }
    let stream = null
    if (value instanceof Map) {
      const j = skipWs(s, next)
      if (s.startsWith('stream', j)) {
        let from = j + 6
        if (s[from] === '\r' && s[from + 1] === '\n') from += 2
        else if (s[from] === '\n' || s[from] === '\r') from += 1
        let to = -1
        const len = value.get('Length')
        if (typeof len === 'number' && len >= 0 && from + len <= s.length && /^\s*endstream/u.test(s.slice(from + len, from + len + 12))) to = from + len
        if (to === -1) { to = s.indexOf('endstream', from); if (to === -1) to = s.length; else if (s[to - 1] === '\n') to -= s[to - 2] === '\r' ? 2 : 1; else if (s[to - 1] === '\r') to -= 1 }
        stream = buf.subarray(from, to)
        re.lastIndex = Math.max(re.lastIndex, to)
      }
    }
    if (!objects.has(num)) objects.set(num, { dict: value instanceof Map ? value : null, value, stream })
  }
  // Objects packed in object streams (PDF 1.5): their numbers and offsets are in the stream's own header.
  for (const [, obj] of [...objects]) {
    if (obj.dict === null || obj.stream === null) continue
    const type = obj.dict.get('Type')
    if (!(type instanceof Name) || type.v !== 'ObjStm') continue
    const data = decodeStream(obj)
    if (data === null) continue
    const t = data.toString('latin1')
    const n = obj.dict.get('N')
    const first = obj.dict.get('First')
    if (typeof n !== 'number' || typeof first !== 'number') continue
    const head = t.slice(0, first).trim().split(/\s+/u).map(Number)
    for (let k = 0; k < n && 2 * k + 1 < head.length; k += 1) {
      const num = head[2 * k]
      const off = head[2 * k + 1]
      if (!Number.isFinite(num) || !Number.isFinite(off) || objects.has(num)) continue
      try {
        const [value] = readValue(t, first + off)
        objects.set(num, { dict: value instanceof Map ? value : null, value, stream: null })
      } catch (e) { /* one object that does not read */ }
    }
  }
  return { objects, text: s }
}

// ── fonts: bytes to Unicode ───────────────────────────────────────────────────────────────────────────────────────

const utf16 = (bytes) => {
  let out = ''
  for (let i = 0; i + 1 < bytes.length; i += 2) out += String.fromCharCode((bytes.charCodeAt(i) << 8) | bytes.charCodeAt(i + 1))
  return out
}
const hexToStr = (h) => { let out = ''; for (let i = 0; i + 1 < h.length; i += 2) out += hexByte(h.slice(i, i + 2)); return out }

/** A ToUnicode CMap: { map: Map<code, text>, bytes: how many bytes make one code }. */
export function parseCMap (text) {
  const map = new Map()
  let bytes = 0
  const cs = /begincodespacerange([\s\S]*?)endcodespacerange/u.exec(text)
  if (cs !== null) { const h = /<([0-9a-fA-F]+)>/u.exec(cs[1]); if (h !== null) bytes = Math.max(1, Math.round(h[1].length / 2)) }
  for (const blk of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/gu)) {
    for (const p of blk[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/gu)) map.set(parseInt(p[1], 16), utf16(hexToStr(p[2])))
  }
  for (const blk of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/gu)) {
    for (const p of blk[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(\[[^\]]*\]|<[0-9a-fA-F]*>)/gu)) {
      const lo = parseInt(p[1], 16)
      const hi = Math.min(parseInt(p[2], 16), lo + 65535)
      if (p[3][0] === '[') {
        const items = [...p[3].matchAll(/<([0-9a-fA-F]*)>/gu)].map((x) => utf16(hexToStr(x[1])))
        for (let c = lo; c <= hi && c - lo < items.length; c += 1) map.set(c, items[c - lo])
      } else {
        const dst = utf16(hexToStr(p[3].slice(1, -1)))
        if (dst === '') continue
        for (let c = lo; c <= hi; c += 1) map.set(c, dst.slice(0, -1) + String.fromCharCode(dst.charCodeAt(dst.length - 1) + (c - lo)))
      }
    }
  }
  return { map, bytes: bytes || (map.size > 0 && Math.max(...[...map.keys()].slice(0, 2000)) > 255 ? 2 : 1) }
}

const CP1252 = { 128: '€', 130: '‚', 131: 'ƒ', 132: '„', 133: '…', 134: '†', 135: '‡', 136: 'ˆ', 137: '‰', 138: 'Š', 139: '‹', 140: 'Œ', 142: 'Ž', 145: '‘', 146: '’', 147: '“', 148: '”', 149: '•', 150: '–', 151: '—', 152: '˜', 153: '™', 154: 'š', 155: '›', 156: 'œ', 158: 'ž', 159: 'Ÿ' }

// ── the pages ─────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The text of a PDF: `{ text, pages, readable, note }`. `note` is '' when the text is complete as far as we can tell, else one of
 * 'encrypted', 'no_text' (scanned, or text we cannot decode), 'partial' (some pages or fonts could not be read), 'unreadable' (not a PDF we can parse).
 */
export function pdfText (buffer, { maxChars = MAX_CHARS } = {}) {
  const none = (note) => ({ text: '', pages: 0, readable: 0, note })
  if (!Buffer.isBuffer(buffer) || buffer.length < 8 || buffer.subarray(0, 1024).indexOf('%PDF-') === -1) return none('unreadable')
  let parsed
  try { parsed = readObjects(buffer) } catch (e) { return none('unreadable') }
  const { objects, text: raw } = parsed
  if (/\/Encrypt\s+\d+\s+\d+\s+R/u.test(raw)) return none('encrypted')
  const get = (v) => { let guard = 0; while (v instanceof Ref && guard < 20) { const o = objects.get(v.n); v = o === undefined ? undefined : o.value; guard += 1 } return v }
  const objOf = (v) => (v instanceof Ref ? objects.get(v.n) : undefined)

  // The page tree, in reading order, with the resources a page inherits.
  const pages = []
  const walk = (node, inherited, seen, depth) => {
    if (depth > 30 || pages.length >= MAX_PAGES) return
    const d = get(node)
    if (!(d instanceof Map)) return
    if (node instanceof Ref) { if (seen.has(node.n)) return; seen.add(node.n) }
    const own = d.has('Resources') ? d.get('Resources') : inherited
    const kids = get(d.get('Kids'))
    if (Array.isArray(kids)) { for (const k of kids) walk(k, own, seen, depth + 1); return }
    pages.push({ dict: d, resources: own })
  }
  let root
  for (const [, o] of objects) {
    const t = o.dict === null ? undefined : o.dict.get('Type')
    if (t instanceof Name && t.v === 'Catalog' && o.dict.has('Pages')) { root = o.dict.get('Pages'); break }
  }
  if (root !== undefined) walk(root, undefined, new Set(), 0)
  if (pages.length === 0) {
    for (const [, o] of [...objects].sort((a, b) => a[0] - b[0])) {
      const t = o.dict === null ? undefined : o.dict.get('Type')
      if (t instanceof Name && t.v === 'Page' && pages.length < MAX_PAGES) pages.push({ dict: o.dict, resources: o.dict.get('Resources') })
    }
  }
  if (pages.length === 0) return none('unreadable')

  /** How wide a code is, in thousandths of an em: the simple font's Widths, or the CID font's W and DW; undefined when the file does not say. */
  const widthsOf = (d) => {
    if (!(d instanceof Map)) return undefined
    const fromArray = get(d.get('Widths'))
    if (Array.isArray(fromArray) && typeof d.get('FirstChar') === 'number') {
      const first = d.get('FirstChar')
      return (code) => { const x = get(fromArray[code - first]); return typeof x === 'number' ? x : undefined }
    }
    const desc = get(d.get('DescendantFonts'))
    const cid = Array.isArray(desc) ? get(desc[0]) : undefined
    if (!(cid instanceof Map)) return undefined
    const dw = typeof cid.get('DW') === 'number' ? cid.get('DW') : 1000
    const table = new Map()
    const w = get(cid.get('W'))
    if (Array.isArray(w)) {
      for (let k = 0; k < w.length && table.size < 70000;) {
        const c = get(w[k])
        const nxt = get(w[k + 1])
        if (typeof c !== 'number') { k += 1; continue }
        if (Array.isArray(nxt)) { nxt.forEach((x, j) => { const wx = get(x); if (typeof wx === 'number') table.set(c + j, wx) }); k += 2 }
        else if (typeof nxt === 'number' && typeof get(w[k + 2]) === 'number') { const wx = get(w[k + 2]); for (let q = c; q <= Math.min(nxt, c + 65535); q += 1) table.set(q, wx); k += 3 }
        else k += 1
      }
    }
    return (code) => (table.has(code) ? table.get(code) : dw)
  }

  const fontCache = new Map()
  const fontOf = (ref) => {
    if (!(ref instanceof Ref)) return { plain: true }
    if (fontCache.has(ref.n)) return fontCache.get(ref.n)
    const d = get(ref)
    let info = { plain: true }
    if (d instanceof Map) {
      const tu = objOf(d.get('ToUnicode'))
      const sub = d.get('Subtype')
      const composite = sub instanceof Name && sub.v === 'Type0'
      if (tu !== undefined) {
        const data = decodeStream(tu)
        if (data !== null) { const cm = parseCMap(data.toString('latin1')); info = { map: cm.map, bytes: composite ? Math.max(2, cm.bytes) : cm.bytes } }
        else info = composite ? { lost: true } : { plain: true }
      } else if (composite) info = { lost: true }
    }
    info = Object.assign({}, info, { w: widthsOf(d) })
    fontCache.set(ref.n, info)
    return info
  }

  // What a page (or a form it draws) can name: its fonts, and the form XObjects it can draw, each with the resources of its own.
  const contextOf = (resources, parent) => {
    const res = get(resources)
    const fonts = res instanceof Map ? get(res.get('Font')) : undefined
    const xobjects = res instanceof Map ? get(res.get('XObject')) : undefined
    return {
      font: (name) => (fonts instanceof Map ? fontOf(fonts.get(name)) : parent !== undefined ? parent.font(name) : { plain: true }),
      form: (name) => {
        const ref = xobjects instanceof Map ? xobjects.get(name) : undefined
        const o = objOf(ref)
        if (o === undefined || o.dict === null) { return parent !== undefined ? parent.form(name) : null }
        const sub = o.dict.get('Subtype')
        if (!(sub instanceof Name) || sub.v !== 'Form') return null
        const data = decodeStream(o)
        if (data === null) return { src: '', ctx: undefined, matrix: null, lost: true }
        const mat = get(o.dict.get('Matrix'))
        return { src: data.toString('latin1'), ctx: o.dict.has('Resources') ? contextOf(o.dict.get('Resources'), undefined) : undefined, matrix: Array.isArray(mat) && mat.length === 6 && mat.every((x) => typeof x === 'number') ? mat : null, lost: false }
      },
      counter: parent !== undefined ? parent.counter : { forms: 0 },
    }
  }

  let partial = false
  const out = []
  let letters = 0
  let size = 0
  for (let p = 0; p < pages.length && size < maxChars; p += 1) {
    const page = pages[p]
    const ctx = contextOf(page.resources, undefined)
    const contents = get(page.dict.get('Contents'))
    const list = Array.isArray(contents) ? contents : contents === undefined ? [] : [page.dict.get('Contents')]
    const chunks = []
    for (const c of list) {
      const o = objOf(c)
      const data = o === undefined ? null : decodeStream(o)
      if (data === null) partial = true
      else chunks.push(data.toString('latin1'))
    }
    const st = { text: '', endX: null, endY: null, lost: false }
    showText(chunks.join('\n'), ctx, 0, st, IDENTITY)
    if (st.lost) partial = true
    const t = st.text.replace(/[ \t]+\n/gu, '\n').replace(/\n{3,}/gu, '\n\n').trim()
    letters += (t.match(/\p{L}/gu) || []).length
    out.push('[page ' + (p + 1) + ']\n' + t)
    size += t.length
  }
  const text = out.join('\n\n').slice(0, maxChars)
  const note = letters === 0 ? 'no_text' : partial ? 'partial' : ''
  return { text: note === 'no_text' ? '' : text, pages: pages.length, readable: letters, note }
}

const IDENTITY = [1, 0, 0, 1, 0, 0]
/** m × n, in the PDF's row-vector convention (m is applied first). */
const mul = (m, n) => [
  m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
]
const nums = (a) => a.filter((x) => typeof x === 'number')

/**
 * The text a content stream shows, in the order it is drawn. Where each piece lands is followed on the page (the current transformation, the text matrix, the font size, a
 * glyph as wide as its font says, half an em when it does not), so that a line break is a move down by more than about half a line, and a space is a gap of about a quarter of an em: text drawn in many small
 * pieces (small capitals, a word per run) still reads as words and lines. `st` is shared by the forms a page draws: its text, where the last piece ended, and whether a font was lost.
 */
function showText (src, ctx, depth, st, startCtm) {
  const fontByName = ctx.font
  let font = { plain: true }
  let size = 10
  let leading = 0
  let ctm = startCtm
  const stack = []
  let tm = IDENTITY
  let tlm = IDENTITY
  const brk = () => { if (st.text !== '' && !st.text.endsWith('\n')) st.text += '\n' }
  const gap = () => { if (st.text !== '' && !/\s$/u.test(st.text)) st.text += ' ' }
  /** The text of a shown string and how far it moves the pen (thousandths of an em; half an em a glyph where the font does not say). */
  const decode = (str) => {
    if (font.lost) { st.lost = true; return { piece: '', width: 0 } }
    const wOf = (code) => { const x = font.w === undefined ? undefined : font.w(code); return typeof x === 'number' ? x : 500 }
    let out = ''
    let width = 0
    if (font.map !== undefined) {
      const n = font.bytes || 1
      for (let i = 0; i + n <= str.length; i += n) {
        let code = 0
        for (let k = 0; k < n; k += 1) code = (code << 8) | str.charCodeAt(i + k)
        width += wOf(code)
        const ch = font.map.get(code)
        if (ch !== undefined) out += ch
        else if (n === 1 && code >= 32) out += String.fromCharCode(code)
      }
      return { piece: out, width }
    }
    for (let i = 0; i < str.length; i += 1) {
      const code = str.charCodeAt(i)
      width += wOf(code)
      out += CP1252[code] !== undefined ? CP1252[code] : code >= 32 || code === 10 ? String.fromCharCode(code) : ''
    }
    return { piece: out, width }
  }
  const show = (str) => {
    const { piece, width } = decode(str)
    if (piece === '') return
    const full = mul(tm, ctm)
    const h = Math.hypot(full[0], full[1]) || 1
    const v = Math.hypot(full[2], full[3]) || 1
    if (st.endX !== null) {
      if (Math.abs(full[5] - st.endY) > 0.45 * v * size) brk()
      else if (full[4] - st.endX > 0.25 * h * size || full[4] < st.endX - 2 * h * size) gap()
    }
    st.text += piece
    tm = mul([1, 0, 0, 1, width / 1000 * size, 0], tm)
    const after = mul(tm, ctm)
    st.endX = after[4]
    st.endY = after[5]
  }
  const nextLine = (tx, ty) => { tlm = mul([1, 0, 0, 1, tx, ty], tlm); tm = tlm }
  const operands = []
  let i = 0
  let steps = 0
  while (i < src.length && st.text.length < MAX_CHARS && steps < 2_000_000) {
    steps += 1
    i = skipWs(src, i)
    if (i >= src.length) break
    // An inline image's bytes are not operators.
    if (src.startsWith('BI', i) && isWs(src.charCodeAt(i + 2))) {
      const end = src.indexOf('EI', src.indexOf('ID', i))
      i = end === -1 ? src.length : end + 2
      operands.length = 0
      continue
    }
    let v
    let next
    try { [v, next] = readValue(src, i) } catch (e) { i += 1; continue }
    i = next > i ? next : i + 1
    if (v === undefined) continue
    if (!isOp(v)) { operands.push(v); if (operands.length > 64) operands.shift(); continue }
    const op = v.op
    const last = operands[operands.length - 1]
    if (op === 'Tf') { const n = operands[0]; if (n instanceof Name) font = fontByName(n.v); if (typeof operands[1] === 'number' && operands[1] !== 0) size = Math.abs(operands[1]) }
    else if (op === 'Tj') { if (last instanceof Str) show(last.v) }
    else if (op === "'" || op === '"') { nextLine(0, -(leading || size * 1.2)); if (last instanceof Str) show(last.v) }
    else if (op === 'TJ') {
      if (Array.isArray(last)) for (const it of last) { if (it instanceof Str) show(it.v); else if (typeof it === 'number') tm = mul([1, 0, 0, 1, -it / 1000 * size, 0], tm) }
    } else if (op === 'Td' || op === 'TD') {
      const [tx, ty] = nums(operands).slice(-2)
      if (typeof tx === 'number' && typeof ty === 'number') { if (op === 'TD') leading = -ty; nextLine(tx, ty) }
    } else if (op === 'T*') nextLine(0, -(leading || size * 1.2))
    else if (op === 'TL') { if (typeof last === 'number') leading = last }
    else if (op === 'Tm') { const m = nums(operands).slice(-6); if (m.length === 6) { tm = m; tlm = m } }
    else if (op === 'BT') { tm = IDENTITY; tlm = IDENTITY }
    else if (op === 'q') { stack.push(ctm); if (stack.length > 64) stack.shift() }
    else if (op === 'Q') { if (stack.length > 0) ctm = stack.pop() }
    else if (op === 'cm') { const m = nums(operands).slice(-6); if (m.length === 6) ctm = mul(m, ctm) }
    else if (op === 'Do') {
      // A form XObject is a piece of page drawn by name (macOS's PDF writer draws a whole page that way): its text is part of the page.
      const n = operands[0]
      if (n instanceof Name && depth < 6 && ctx.counter.forms < 3000) {
        ctx.counter.forms += 1
        const f = ctx.form(n.v)
        if (f !== null) {
          if (f.lost) st.lost = true
          else showText(f.src, f.ctx === undefined ? ctx : { font: f.ctx.font, form: f.ctx.form, counter: ctx.counter }, depth + 1, st, f.matrix === null ? ctm : mul(f.matrix, ctm))
        }
      }
    }
    operands.length = 0
  }
}
