// kybernos-mobile: the QR encoder (qr.mjs), checked from the matrix back to the text.
//   cd packages/kybernos-mobile && node test-qr.mjs
// Everything below the encoder is re-implemented here on purpose (function-pattern map,
// alignment positions, GF(256) arithmetic, block layout, zig-zag read-back), so a mistake in
// qr.mjs cannot cancel itself out. The known-answer hashes were taken after the output
// decoded correctly in a real decoder (headless Chrome BarcodeDetector: 191 symbols covering
// versions 1..20, all four levels and all eight masks, plus these four exact inputs).
import { createHash } from 'node:crypto'
import { encodeQr, toSvg } from './qr.mjs'

let fail = 0
const ok = (name, cond, detail) => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (detail ? ' - ' + detail : '')); if (!cond) fail++ }

const enc = new TextEncoder()
const dec = new TextDecoder('utf-8', { fatal: true })
const ECCS = ['L', 'M', 'Q', 'H']

// ---- reference tables (ISO/IEC 18004), independent of qr.mjs ----

// Total codewords (data + error correction) of versions 1..20.
const TOTAL_CODEWORDS = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346, 404, 466, 532, 581, 655, 733, 815, 901, 991, 1085]

// [number of blocks, error correction codewords per block] per version, levels L, M, Q, H.
// Data codewords are then total - blocks * ecc, split over the blocks as evenly as possible with
// the longer blocks last.
const BLOCK_COUNT_ECC = [
  [[1, 7], [1, 10], [1, 13], [1, 17]], [[1, 10], [1, 16], [1, 22], [1, 28]], [[1, 15], [1, 26], [2, 18], [2, 22]],
  [[1, 20], [2, 18], [2, 26], [4, 16]], [[1, 26], [2, 24], [4, 18], [4, 22]], [[2, 18], [4, 16], [4, 24], [4, 28]],
  [[2, 20], [4, 18], [6, 18], [5, 26]], [[2, 24], [4, 22], [6, 22], [6, 26]], [[2, 30], [5, 22], [8, 20], [8, 24]],
  [[4, 18], [5, 26], [8, 24], [8, 28]], [[4, 20], [5, 30], [8, 28], [11, 24]], [[4, 24], [8, 22], [10, 26], [11, 28]],
  [[4, 26], [9, 22], [12, 24], [16, 22]], [[4, 30], [9, 24], [16, 20], [16, 24]], [[6, 22], [10, 24], [12, 30], [18, 24]],
  [[6, 24], [10, 28], [17, 24], [16, 30]], [[6, 28], [11, 28], [16, 28], [19, 28]], [[6, 30], [13, 26], [18, 28], [21, 28]],
  [[7, 28], [14, 26], [21, 26], [25, 26]], [[8, 28], [16, 26], [20, 30], [25, 28]],
]

// Published byte-mode capacity (bytes) of versions 1..20 per level.
const CAPACITY = {
  L: [17, 32, 53, 78, 106, 134, 154, 192, 230, 271, 321, 367, 425, 458, 520, 586, 644, 718, 792, 858],
  M: [14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287, 331, 362, 412, 450, 504, 560, 624, 666],
  Q: [11, 20, 32, 46, 60, 74, 86, 108, 130, 151, 177, 203, 241, 258, 292, 322, 364, 394, 442, 482],
  H: [7, 14, 24, 34, 44, 58, 64, 84, 98, 119, 137, 155, 177, 194, 220, 250, 280, 310, 338, 382],
}

const FORMAT_LEVEL = { 1: 'L', 0: 'M', 3: 'Q', 2: 'H' }

// The 8 data mask conditions, as a switch on the mask number (i = row, j = column).
function masked (mask, i, j) {
  switch (mask) {
    case 0: return (i + j) % 2 === 0
    case 1: return i % 2 === 0
    case 2: return j % 3 === 0
    case 3: return (i + j) % 3 === 0
    case 4: return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0
    case 5: return (i * j) % 2 + (i * j) % 3 === 0
    case 6: return ((i * j) % 2 + (i * j) % 3) % 2 === 0
    default: return ((i + j) % 2 + (i * j) % 3) % 2 === 0
  }
}

// GF(256) with x^8 + x^4 + x^3 + x^2 + 1, by shift-and-add (no log tables).
function gfMul (a, b) {
  let p = 0
  while (b) {
    if (b & 1) p ^= a
    a <<= 1
    if (a & 0x100) a ^= 0x11d
    b >>= 1
  }
  return p
}
const ALPHA = [1]
for (let i = 1; i < 40; i++) ALPHA.push(gfMul(ALPHA[i - 1], 2))

// True when the codewords (data followed by error correction) have a zero syndrome.
function syndromesZero (words, eccLen) {
  for (let j = 0; j < eccLen; j++) {
    let s = 0
    for (const w of words) s = gfMul(s, ALPHA[j]) ^ w
    if (s !== 0) return false
  }
  return true
}

// Alignment pattern centre coordinates from the formula of the standard (annex E).
function alignmentCentres (version) {
  if (version === 1) return []
  const count = Math.floor(version / 7) + 2
  const last = 4 * version + 10
  const step = Math.ceil((last - 6) / (count - 1) / 2) * 2
  const out = [6]
  for (let k = 1; k < count; k++) out.push(last - step * (count - 1 - k))
  return out
}

// Map of every module that is not data, built by marking whole regions.
function functionMap (version) {
  const size = 17 + 4 * version
  const f = Array.from({ length: size }, () => new Array(size).fill(false))
  const region = (r0, c0, h, w) => {
    for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + w; c++) f[r][c] = true
  }
  region(0, 0, 9, 9) // top-left finder, separator, format bits
  region(0, size - 8, 9, 8) // top-right finder, separator, format bits
  region(size - 8, 0, 8, 9) // bottom-left finder, separator, format bits, dark module
  for (let i = 0; i < size; i++) { f[6][i] = true; f[i][6] = true } // timing
  const centres = alignmentCentres(version)
  for (const r of centres) {
    for (const c of centres) {
      const onFinder = (r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)
      if (!onFinder) region(r - 2, c - 2, 5, 5)
    }
  }
  if (version >= 7) { region(0, size - 11, 6, 3); region(size - 11, 0, 3, 6) } // version information
  return f
}

// Remainder check of a BCH codeword: true when `word` is divisible by `gen` (degree `deg`).
function bchDivisible (word, gen, deg, width) {
  for (let i = width - 1; i >= deg; i--) if ((word >>> i) & 1) word ^= gen << (i - deg)
  return word === 0
}

// ---- the checks ----

const cats = new Map()
function note (cat, label, cond, detail) {
  let c = cats.get(cat)
  if (!c) { c = { n: 0, bad: [] }; cats.set(cat, c) }
  c.n++
  if (!cond) c.bad.push(label + (detail ? ' [' + detail + ']' : ''))
}

// Decode a symbol back to its text and record every structural check against `label`.
function verify (label, text, qr) {
  const { version, size, modules } = qr
  const expected = 17 + 4 * version
  note('size === 17 + 4 * version, rows are size strings of 0/1', label, size === expected && modules.length === expected && modules.every((row) => /^[01]+$/.test(row) && row.length === expected))
  if (size !== expected) return
  const m = modules.map((row) => [...row].map(Number))

  // finder patterns and their separators
  let finders = true
  for (const [r0, c0] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = r0 + r
        const cc = c0 + c
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue
        const inside = r >= 0 && r <= 6 && c >= 0 && c <= 6
        const dark = inside && (Math.max(Math.abs(r - 3), Math.abs(c - 3)) !== 2)
        if (m[rr][cc] !== (dark ? 1 : 0)) finders = false
      }
    }
  }
  note('the three finder patterns and separators are exact', label, finders)

  let timing = true
  for (let i = 8; i <= size - 9; i++) if (m[6][i] !== (i % 2 === 0 ? 1 : 0) || m[i][6] !== (i % 2 === 0 ? 1 : 0)) timing = false
  note('timing patterns alternate on row 6 and column 6', label, timing)

  note('the dark module is set', label, m[size - 8][8] === 1)

  let align = true
  const centres = alignmentCentres(version)
  for (const r of centres) {
    for (const c of centres) {
      if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) if (m[r + dr][c + dc] !== (Math.max(Math.abs(dr), Math.abs(dc)) === 1 ? 0 : 1)) align = false
    }
  }
  note('alignment patterns are exact', label, align)

  // format information: both copies read independently, BCH-valid, equal to the reported level and mask
  const copy1 = []
  for (let k = 0; k <= 5; k++) copy1[k] = m[k][8]
  copy1[6] = m[7][8]; copy1[7] = m[8][8]; copy1[8] = m[8][7]
  for (let k = 9; k < 15; k++) copy1[k] = m[8][14 - k]
  const copy2 = []
  for (let k = 0; k < 8; k++) copy2[k] = m[8][size - 1 - k]
  for (let k = 8; k < 15; k++) copy2[k] = m[size - 15 + k][8]
  const word = (bits) => bits.reduce((acc, b, k) => acc | (b << k), 0) ^ 0x5412
  const w1 = word(copy1)
  const w2 = word(copy2)
  note('format information: both copies equal and BCH(15,5) valid', label, w1 === w2 && bchDivisible(w1, 0x537, 10, 15), w1.toString(2) + ' / ' + w2.toString(2))
  const data = w1 >>> 10
  note('format information decodes to the reported level and mask', label, FORMAT_LEVEL[data >>> 3] === qr.ecc && (data & 7) === qr.mask)

  // version information, from version 7
  if (version >= 7) {
    const top = []
    const left = []
    for (let i = 0; i < 18; i++) {
      top[i] = m[Math.floor(i / 3)][size - 11 + (i % 3)]
      left[i] = m[size - 11 + (i % 3)][Math.floor(i / 3)]
    }
    const raw = (bits) => bits.reduce((acc, b, k) => acc | (b << k), 0)
    const v1 = raw(top)
    const v2 = raw(left)
    note('version information: both copies equal, BCH(18,6) valid and equal to the version', label, v1 === v2 && bchDivisible(v1, 0x1f25, 12, 18) && (v1 >>> 12) === version, v1.toString(2) + ' / ' + v2.toString(2))
  }

  // read the codewords back: undo the mask, walk the two-column strips from the bottom right
  const isFn = functionMap(version)
  const columns = []
  for (let c = size - 1; c >= 0; c--) if (c !== 6) columns.push(c)
  const bits = []
  for (let p = 0; p < columns.length; p += 2) {
    const up = (p / 2) % 2 === 0
    for (let k = 0; k < size; k++) {
      const r = up ? size - 1 - k : k
      for (const c of [columns[p], columns[p + 1]]) if (!isFn[r][c]) bits.push(m[r][c] ^ (masked(qr.mask, r, c) ? 1 : 0))
    }
  }
  const total = TOTAL_CODEWORDS[version - 1]
  note('data module count gives the published codeword total', label, Math.floor(bits.length / 8) === total, bits.length + ' modules')
  note('remainder bits are zero', label, bits.slice(total * 8).every((b) => b === 0))
  const words = []
  for (let i = 0; i < total; i++) words.push(parseInt(bits.slice(i * 8, i * 8 + 8).join(''), 2))

  // de-interleave with the reference block layout, check every block's syndromes
  const [blocks, eccLen] = BLOCK_COUNT_ECC[version - 1][ECCS.indexOf(qr.ecc)]
  const dataTotal = total - blocks * eccLen
  const short = Math.floor(dataTotal / blocks)
  const longCount = dataTotal % blocks
  const lens = []
  for (let b = 0; b < blocks; b++) lens.push(short + (b >= blocks - longCount ? 1 : 0))
  const dataBlocks = lens.map(() => [])
  const eccBlocks = lens.map(() => [])
  let at = 0
  for (let i = 0; i < Math.max(...lens); i++) for (let b = 0; b < blocks; b++) if (i < lens[b]) dataBlocks[b].push(words[at++])
  for (let i = 0; i < eccLen; i++) for (let b = 0; b < blocks; b++) eccBlocks[b].push(words[at++])
  note('every Reed-Solomon block has a zero syndrome', label, dataBlocks.every((d, b) => syndromesZero(d.concat(eccBlocks[b]), eccLen)))

  // parse the data codewords: mode, count, bytes, terminator, pad codewords
  const stream = dataBlocks.flat().map((w) => w.toString(2).padStart(8, '0')).join('')
  const ccBits = version < 10 ? 8 : 16
  const mode = stream.slice(0, 4)
  const count = parseInt(stream.slice(4, 4 + ccBits), 2)
  const bytes = new Uint8Array(count)
  for (let i = 0; i < count; i++) bytes[i] = parseInt(stream.slice(4 + ccBits + i * 8, 4 + ccBits + i * 8 + 8), 2)
  let decoded = null
  try { decoded = dec.decode(bytes) } catch (e) { decoded = null }
  note('mode indicator is byte mode (0100)', label, mode === '0100')
  note('the codewords parse back to the original text', label, decoded === text, decoded === null ? 'invalid UTF-8' : count + ' bytes')
  const used = 4 + ccBits + count * 8
  const terminator = Math.min(4, dataTotal * 8 - used)
  note('terminator bits are zero', label, /^0*$/.test(stream.slice(used, used + terminator)))
  let padOk = true
  const padStart = Math.ceil((used + terminator) / 8)
  for (let i = padStart; i < dataTotal; i++) if (parseInt(stream.slice(i * 8, i * 8 + 8), 2) !== ((i - padStart) % 2 === 0 ? 0xec : 0x11)) padOk = false
  note('pad codewords alternate 0xEC, 0x11', label, padOk)
}

// ---- inputs ----

let seed = 20261012
const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296 }
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~:/?#[]@!$&()*+,;= %'
const ascii = (n) => { let s = ''; for (let i = 0; i < n; i++) s += ALPHABET[Math.floor(rnd() * ALPHABET.length)]; return s }
const MIXED = ['é', '€', '😀', 'a', '漢', 'z', 'ü', 'Ω']
// Multi-byte text of an exact UTF-8 length.
const multibyte = (n) => {
  let s = ''
  let bytes = 0
  let i = 0
  while (bytes < n) {
    let ch = MIXED[i++ % MIXED.length]
    let len = enc.encode(ch).length
    if (bytes + len > n) { ch = 'x'; len = 1 }
    s += ch
    bytes += len
  }
  return s
}

const t0 = Date.now()
const LENGTHS = [1, 5, 17, 32, 53, 78, 106, 134, 154, 178, 220, 260]
let symbols = 0
const versionsSeen = new Set()
const masksSeen = new Set()
for (const ecc of ECCS) {
  for (const len of LENGTHS) {
    for (const [kind, text] of [['ascii', ascii(len)], ['utf8', multibyte(len)]]) {
      const label = kind + ' ' + len + ' bytes ' + ecc
      let qr = null
      try { qr = encodeQr(text, { ecc }) } catch (e) { note('encodes without throwing', label, false, String(e.message)) }
      if (qr === null) continue
      symbols++
      versionsSeen.add(qr.version)
      masksSeen.add(qr.mask)
      note('reported level is the requested one', label, qr.ecc === ecc)
      verify(label, text, qr)
    }
  }
}
// the empty string, and every version at every level filled to the last byte (exercises every block layout)
for (const ecc of ECCS) {
  const qr = encodeQr('', { ecc })
  symbols++
  verify('empty ' + ecc, '', qr)
  for (let v = 1; v <= 20; v++) {
    const text = ascii(CAPACITY[ecc][v - 1])
    const full = encodeQr(text, { ecc })
    symbols++
    versionsSeen.add(full.version)
    masksSeen.add(full.mask)
    note('full capacity lands on its own version', 'v' + v + ' ' + ecc, full.version === v, 'got v' + full.version)
    verify('full v' + v + ' ' + ecc, text, full)
  }
}
// every forced mask decodes
for (const [ecc, len] of [['M', 40], ['Q', 120], ['L', 400]]) {
  for (let mask = 0; mask < 8; mask++) {
    const text = ascii(len)
    const qr = encodeQr(text, { ecc, mask })
    symbols++
    note('a forced mask is the mask used', 'mask ' + mask, qr.mask === mask)
    verify('forced mask ' + mask + ' ' + ecc, text, qr)
  }
}

for (const [cat, c] of cats) ok(cat + ' (' + c.n + ' checks)', c.bad.length === 0, c.bad.slice(0, 3).join('; '))
ok('structural checks ran on many symbols', symbols >= 200, symbols + ' symbols, versions ' + [...versionsSeen].sort((a, b) => a - b).join(',') + ', masks ' + [...masksSeen].sort().join(','))
ok('versions 1 to 20 all exercised', versionsSeen.size === 20)

// ---- selection, limits, API ----

{
  let wrong = []
  for (const ecc of ECCS) {
    for (let v = 1; v <= 20; v++) {
      const [blocks, eccLen] = BLOCK_COUNT_ECC[v - 1][ECCS.indexOf(ecc)]
      const dataTotal = TOTAL_CODEWORDS[v - 1] - blocks * eccLen
      const cap = dataTotal - (v < 10 ? 2 : 3)
      if (cap !== CAPACITY[ecc][v - 1]) wrong.push('table ' + ecc + v)
      if (encodeQr('a'.repeat(cap), { ecc }).version !== v) wrong.push('fit ' + ecc + v)
      if (v < 20 && encodeQr('a'.repeat(cap + 1), { ecc }).version !== v + 1) wrong.push('next ' + ecc + v)
      if (v === 20) {
        try { encodeQr('a'.repeat(cap + 1), { ecc }); wrong.push('no throw ' + ecc) } catch (e) { if (!/^qr: too long/.test(e.message)) wrong.push('message ' + ecc + ': ' + e.message) }
      }
    }
  }
  ok('the smallest version that fits is chosen, and version 20 + 1 byte throws "qr: too long"', wrong.length === 0, wrong.slice(0, 4).join(', '))
}
{
  const a = encodeQr('https://example.test/x#y', { ecc: 'Q' })
  const b = encodeQr('https://example.test/x#y', { ecc: 'Q' })
  ok('deterministic: same input, same symbol', JSON.stringify(a) === JSON.stringify(b))
  ok('default level is M', encodeQr('hello').ecc === 'M')
  let msg = ''
  try { encodeQr('x', { ecc: 'Z' }) } catch (e) { msg = e.message }
  ok('an unknown level throws', /^qr:/.test(msg), msg)
  msg = ''
  try { encodeQr(42) } catch (e) { msg = e.message }
  ok('a non-string throws', /^qr:/.test(msg), msg)
  msg = ''
  try { encodeQr('x', { mask: 8 }) } catch (e) { msg = e.message }
  ok('a mask outside 0..7 throws', /^qr:/.test(msg), msg)
}

// ---- known answers (sha256 of modules.join('\n')) ----

const URL170 = 'https://r.example.test/m/AbCdEf0123456789#abcdefghijklmnopqrstuv.ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.slice(0, 170)
const VECTORS = [
  { name: 'HELLO WORLD, M', text: 'HELLO WORLD', ecc: 'M', version: 1, sha256: '2d21897bf5a7ac606d02da07bdd5e7f02a8b90097f12404b1f7d764f18ef618c' },
  { name: 'a 170-character URL, M', text: URL170, ecc: 'M', version: 9, sha256: '5fe7d2aed80091806ea2523e1d75047690e6d2c104cea38d92b550f14335081b' },
  { name: 'UTF-8 sentence, H', text: 'Kybernos ✓ café 日本語 😀', ecc: 'H', version: 4, sha256: '628a01e0e7f1b416bad37f52c9b33f908801c95cbb1eb238eebf297f49d2b8c6' },
  { name: 'repeated sentence, Q (version info, several groups)', text: 'The quick brown fox jumps over the lazy dog. '.repeat(5), ecc: 'Q', version: 13, sha256: 'b50e1738993d5b787c0957e9a528a5a72255ef33fefae38d5aa3f383c3035840' },
]
for (const v of VECTORS) {
  const qr = encodeQr(v.text, { ecc: v.ecc })
  const hash = createHash('sha256').update(qr.modules.join('\n')).digest('hex')
  ok('known answer: ' + v.name + ' (version ' + qr.version + ', mask ' + qr.mask + ')', hash === v.sha256 && qr.version === v.version, hash)
}

// ---- SVG ----

{
  const qr = encodeQr('https://example.test/svg', { ecc: 'M' })
  const svg = toSvg(qr)
  const n = qr.size + 8
  ok('toSvg starts with <svg and has a viewBox in module units', svg.startsWith('<svg') && svg.includes('viewBox="0 0 ' + n + ' ' + n + '"'))
  ok('toSvg is crispEdges, self-contained, with a single path', svg.includes('shape-rendering="crispEdges"') && svg.includes('xmlns="http://www.w3.org/2000/svg"') && svg.split('<path').length === 2 && svg.endsWith('</svg>'))
  // rebuild the matrix from the path and compare
  const grid = Array.from({ length: qr.size }, () => new Array(qr.size).fill('0'))
  const d = /<path d="([^"]*)"/.exec(svg)[1]
  let parsed = true
  for (const seg of d.split('z').filter(Boolean)) {
    const mm = /^M(\d+) (\d+)h(\d+)v1h-(\d+)$/.exec(seg)
    if (!mm || mm[3] !== mm[4]) { parsed = false; break }
    for (let k = 0; k < Number(mm[3]); k++) grid[Number(mm[2]) - 4][Number(mm[1]) - 4 + k] = '1'
  }
  ok('the path draws exactly the dark modules, offset by the quiet zone', parsed && grid.map((row) => row.join('')).join('\n') === qr.modules.join('\n'))
  const custom = toSvg(qr, { quiet: 2, dark: '#123456', light: 'rgb(1,2,3)' })
  ok('toSvg honours quiet, dark and light', custom.includes('viewBox="0 0 ' + (qr.size + 4) + ' ' + (qr.size + 4) + '"') && custom.includes('fill="#123456"') && custom.includes('fill="rgb(1,2,3)"'))
  ok('toSvg escapes attribute values', !toSvg(qr, { dark: '"><script>' }).includes('<script>'))
}

console.log((fail ? 'FAILED ' + fail : 'all passed') + ' in ' + (Date.now() - t0) + ' ms')
process.exit(fail ? 1 : 0)
