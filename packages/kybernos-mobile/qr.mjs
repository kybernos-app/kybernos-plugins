// A small, dependency-free QR Code encoder (ISO/IEC 18004, Model 2).
// Byte mode only (input is UTF-8), versions 1 to 20, error correction L / M / Q / H.
// Pure and deterministic: no Buffer, no require, only TextEncoder, so the same file runs
// unchanged in Node >= 22 and in a browser. Written from the standard, not from a library.
//
//   encodeQr(text, { ecc: 'M' }) -> { version, size, ecc, mask, modules }
//   toSvg(qr, { quiet, dark, light }) -> '<svg ...>...</svg>'
//
// `modules` is `size` strings of `size` characters, '1' = dark, '0' = light, row-major,
// without the quiet zone (the standard asks for 4 light modules around the symbol).

const LEVELS = ['L', 'M', 'Q', 'H']

// 2-bit error correction indicator stored in the format information (ISO/IEC 18004 table 12).
// Note the order is not alphabetical: L = 01, M = 00, Q = 11, H = 10.
const FORMAT_LEVEL_BITS = { L: 1, M: 0, Q: 3, H: 2 }

// Error correction block structure, one row per version 1..20, one entry per level in the
// order L, M, Q, H (ISO/IEC 18004 table 9). Each entry is
//   [ecc codewords per block, blocks in group 1, data codewords per group-1 block,
//     blocks in group 2, data codewords per group-2 block]
// Group 2 blocks always carry one more data codeword than group 1 blocks.
// encodeQr() checks every entry it uses against the symbol's geometry, so a typo fails loudly.
const BLOCKS = [
  [[7, 1, 19, 0, 0], [10, 1, 16, 0, 0], [13, 1, 13, 0, 0], [17, 1, 9, 0, 0]], // v1
  [[10, 1, 34, 0, 0], [16, 1, 28, 0, 0], [22, 1, 22, 0, 0], [28, 1, 16, 0, 0]], // v2
  [[15, 1, 55, 0, 0], [26, 1, 44, 0, 0], [18, 2, 17, 0, 0], [22, 2, 13, 0, 0]], // v3
  [[20, 1, 80, 0, 0], [18, 2, 32, 0, 0], [26, 2, 24, 0, 0], [16, 4, 9, 0, 0]], // v4
  [[26, 1, 108, 0, 0], [24, 2, 43, 0, 0], [18, 2, 15, 2, 16], [22, 2, 11, 2, 12]], // v5
  [[18, 2, 68, 0, 0], [16, 4, 27, 0, 0], [24, 4, 19, 0, 0], [28, 4, 15, 0, 0]], // v6
  [[20, 2, 78, 0, 0], [18, 4, 31, 0, 0], [18, 2, 14, 4, 15], [26, 4, 13, 1, 14]], // v7
  [[24, 2, 97, 0, 0], [22, 2, 38, 2, 39], [22, 4, 18, 2, 19], [26, 4, 14, 2, 15]], // v8
  [[30, 2, 116, 0, 0], [22, 3, 36, 2, 37], [20, 4, 16, 4, 17], [24, 4, 12, 4, 13]], // v9
  [[18, 2, 68, 2, 69], [26, 4, 43, 1, 44], [24, 6, 19, 2, 20], [28, 6, 15, 2, 16]], // v10
  [[20, 4, 81, 0, 0], [30, 1, 50, 4, 51], [28, 4, 22, 4, 23], [24, 3, 12, 8, 13]], // v11
  [[24, 2, 92, 2, 93], [22, 6, 36, 2, 37], [26, 4, 20, 6, 21], [28, 7, 14, 4, 15]], // v12
  [[26, 4, 107, 0, 0], [22, 8, 37, 1, 38], [24, 8, 20, 4, 21], [22, 12, 11, 4, 12]], // v13
  [[30, 3, 115, 1, 116], [24, 4, 40, 5, 41], [20, 11, 16, 5, 17], [24, 11, 12, 5, 13]], // v14
  [[22, 5, 87, 1, 88], [24, 5, 41, 5, 42], [30, 5, 24, 7, 25], [24, 11, 12, 7, 13]], // v15
  [[24, 5, 98, 1, 99], [28, 7, 45, 3, 46], [24, 15, 19, 2, 20], [30, 3, 15, 13, 16]], // v16
  [[28, 1, 107, 5, 108], [28, 10, 46, 1, 47], [28, 1, 22, 15, 23], [28, 2, 14, 17, 15]], // v17
  [[30, 5, 120, 1, 121], [26, 9, 43, 4, 44], [28, 17, 22, 1, 23], [28, 2, 14, 19, 15]], // v18
  [[28, 3, 113, 4, 114], [26, 3, 44, 11, 45], [26, 17, 21, 4, 22], [26, 9, 13, 16, 14]], // v19
  [[28, 3, 107, 5, 108], [26, 3, 41, 13, 42], [30, 15, 24, 5, 25], [28, 15, 15, 10, 16]], // v20
]

// Row/column coordinates of the alignment pattern centres, versions 1..20
// (ISO/IEC 18004 table E.1). A pattern is drawn at every pair of coordinates except the
// three that would land on a finder pattern.
const ALIGNMENT = [
  [],
  [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62],
  [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90],
]

// The 8 data mask conditions (ISO/IEC 18004 table 10); a module is flipped when the
// condition is true. i = row, j = column.
const MASKS = [
  (i, j) => (i + j) % 2 === 0,
  (i) => i % 2 === 0,
  (i, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
  (i, j) => ((((i + j) % 2) + ((i * j) % 3)) % 2) === 0,
]

// ---- Reed-Solomon over GF(256), primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11D) ----

const EXP = new Uint8Array(512) // EXP[i] = alpha^i, doubled so a sum of two logs needs no modulo
const LOG = new Uint8Array(256)
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x
  LOG[x] = i
  x <<= 1
  if (x & 0x100) x ^= 0x11d
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]

const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]])

const generators = new Map()
// Generator polynomial of the given degree, (x - a^0)(x - a^1)...(x - a^(degree-1)),
// coefficients from the highest power down, without the leading 1.
function generator (degree) {
  let g = generators.get(degree)
  if (g) return g
  let poly = [1]
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0)
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j]
      next[j + 1] ^= gfMul(poly[j], EXP[i])
    }
    poly = next
  }
  g = poly.slice(1)
  generators.set(degree, g)
  return g
}

// Remainder of data(x) * x^degree divided by the generator: the error correction codewords.
function rsRemainder (data, degree) {
  const gen = generator(degree)
  const rem = new Array(degree).fill(0)
  for (const byte of data) {
    const factor = byte ^ rem.shift()
    rem.push(0)
    for (let i = 0; i < degree; i++) rem[i] ^= gfMul(gen[i], factor)
  }
  return rem
}

// ---- codewords ----

function layout (version, eccIndex) {
  const [eccLen, n1, d1, n2, d2] = BLOCKS[version - 1][eccIndex]
  const dataLens = []
  for (let i = 0; i < n1; i++) dataLens.push(d1)
  for (let i = 0; i < n2; i++) dataLens.push(d2)
  return { eccLen, dataLens, dataTotal: n1 * d1 + n2 * d2 }
}

// Mode indicator 0100 (byte), character count (8 bits up to v9, 16 bits from v10),
// the bytes, a terminator of up to 4 zero bits, zero bits to a byte boundary, then the
// pad codewords 0xEC and 0x11 alternating until the data capacity is full.
function dataCodewords (bytes, version, dataTotal) {
  const bits = []
  const put = (value, n) => { for (let i = n - 1; i >= 0; i--) bits.push((value >> i) & 1) }
  put(0b0100, 4)
  put(bytes.length, version < 10 ? 8 : 16)
  for (const b of bytes) put(b, 8)
  put(0, Math.min(4, dataTotal * 8 - bits.length))
  while (bits.length % 8 !== 0) bits.push(0)
  const words = []
  for (let i = 0; i < bits.length; i += 8) {
    let w = 0
    for (let j = 0; j < 8; j++) w = (w << 1) | bits[i + j]
    words.push(w)
  }
  for (let pad = 0xec; words.length < dataTotal; pad ^= 0xec ^ 0x11) words.push(pad)
  return words
}

// Split the data into blocks, add each block's error correction, then interleave:
// all data codewords column by column, then all error correction codewords the same way.
function interleave (words, eccLen, dataLens) {
  const data = []
  const ecc = []
  let at = 0
  for (const len of dataLens) {
    const block = words.slice(at, at + len)
    at += len
    data.push(block)
    ecc.push(rsRemainder(block, eccLen))
  }
  const out = []
  for (let i = 0; i < Math.max(...dataLens); i++) for (const block of data) if (i < block.length) out.push(block[i])
  for (let i = 0; i < eccLen; i++) for (const block of ecc) out.push(block[i])
  return out
}

// ---- matrix ----

// BCH(15,5) format word: 2 bits error correction level + 3 bits mask, remainder modulo
// the generator 10100110111 (0x537), then XOR with the fixed mask 101010000010010 (0x5412).
function formatWord (eccName, mask) {
  const data = (FORMAT_LEVEL_BITS[eccName] << 3) | mask
  let rem = data
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  return ((data << 10) | rem) ^ 0x5412
}

// BCH(18,6) version word (versions 7 and up): 6 bits of version + remainder modulo the
// generator 1111100100101 (0x1F25).
function versionWord (version) {
  let rem = version
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
  return (version << 12) | rem
}

// Where the 15 format bits go, as [row, column, bit] with bit 0 the least significant.
// Copy 1 wraps the top-left finder; copy 2 is split between the bottom-left and top-right ones.
function formatCells (size) {
  const cells = []
  for (let k = 0; k <= 5; k++) cells.push([k, 8, k])
  cells.push([7, 8, 6], [8, 8, 7], [8, 7, 8])
  for (let k = 9; k < 15; k++) cells.push([8, 14 - k, k])
  for (let k = 0; k < 8; k++) cells.push([8, size - 1 - k, k])
  for (let k = 8; k < 15; k++) cells.push([size - 15 + k, 8, k])
  return cells
}

// Builds the function patterns of a version. `mod` holds their colours (1 = dark) and `fn`
// marks every module that is not data: finders, separators, timing, alignment, the format
// and version areas (format left blank here) and the always-dark module.
function baseMatrix (version) {
  const size = 17 + 4 * version
  const mod = new Uint8Array(size * size)
  const fn = new Uint8Array(size * size)
  const put = (r, c, dark) => { mod[r * size + c] = dark ? 1 : 0; fn[r * size + c] = 1 }

  // 7x7 finder with its 1-module light separator; the separator is clipped by the symbol edge.
  const finder = (r0, c0) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = r0 + dr
        const c = c0 + dc
        if (r < 0 || c < 0 || r >= size || c >= size) continue
        const inside = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6
        const ring = dr === 0 || dr === 6 || dc === 0 || dc === 6
        const core = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4
        put(r, c, inside && (ring || core))
      }
    }
  }
  finder(0, 0)
  finder(0, size - 7)
  finder(size - 7, 0)

  // Timing patterns: alternating, dark on even indexes, between the separators.
  for (let i = 8; i < size - 8; i++) {
    put(6, i, i % 2 === 0)
    put(i, 6, i % 2 === 0)
  }

  // Alignment patterns: dark 5x5 ring, light 3x3 ring, dark centre.
  const centres = ALIGNMENT[version - 1]
  const last = centres.length - 1
  for (let a = 0; a <= last; a++) {
    for (let b = 0; b <= last; b++) {
      if ((a === 0 && b === 0) || (a === 0 && b === last) || (a === last && b === 0)) continue
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) put(centres[a] + dr, centres[b] + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1)
      }
    }
  }

  // Reserve the format areas (the real bits are drawn once the mask is known) and the dark module.
  for (const [r, c] of formatCells(size)) fn[r * size + c] = 1
  put(size - 8, 8, true)

  // Version information (two 6x3 blocks), only from version 7.
  if (version >= 7) {
    const word = versionWord(version)
    for (let i = 0; i < 18; i++) {
      const dark = (word >>> i) & 1
      const near = size - 11 + (i % 3)
      const far = Math.floor(i / 3)
      put(far, near, dark) // top-right block: rows 0..5, columns size-11..size-9
      put(near, far, dark) // bottom-left block: rows size-11..size-9, columns 0..5
    }
  }
  return { size, mod, fn }
}

// Zig-zag placement: two-column strips from the bottom-right corner, moving left, going up
// then down alternately, skipping the vertical timing column. Bits past the end of the
// stream (the remainder bits of some versions) are light.
function placeData (mod, fn, size, bits) {
  let n = 0
  for (let right = size - 1, strip = 0; right > 0; right -= 2, strip++) {
    if (right === 6) right = 5
    for (let k = 0; k < size; k++) {
      const r = strip % 2 === 0 ? size - 1 - k : k
      for (let c = right; c >= right - 1; c--) {
        if (fn[r * size + c]) continue
        mod[r * size + c] = n < bits.length ? bits[n] : 0
        n++
      }
    }
  }
}

// Penalty score of ISO/IEC 18004 section 7.8.3: N1 runs of five or more same-colour
// modules in a row or column, N2 2x2 blocks, N3 finder-like 1:1:3:1:1 patterns with four
// light modules on a side (the quiet zone counts as light), N4 deviation from 50% dark.
function penalty (m, size) {
  let score = 0
  for (let vertical = 0; vertical < 2; vertical++) {
    for (let line = 0; line < size; line++) {
      const at = (k) => (k < 0 || k >= size ? 0 : (vertical ? m[k * size + line] : m[line * size + k]))
      let run = 1
      for (let k = 1; k < size; k++) {
        if (at(k) === at(k - 1)) run++
        else {
          if (run >= 5) score += run - 2 // 3 + (run - 5)
          run = 1
        }
      }
      if (run >= 5) score += run - 2
      for (let k = 0; k + 7 <= size; k++) {
        if (at(k) && !at(k + 1) && at(k + 2) && at(k + 3) && at(k + 4) && !at(k + 5) && at(k + 6)) {
          const before = !at(k - 1) && !at(k - 2) && !at(k - 3) && !at(k - 4)
          const after = !at(k + 7) && !at(k + 8) && !at(k + 9) && !at(k + 10)
          if (before) score += 40
          if (after) score += 40
        }
      }
    }
  }
  let dark = 0
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const v = m[r * size + c]
      dark += v
      if (r + 1 < size && c + 1 < size && v === m[r * size + c + 1] && v === m[(r + 1) * size + c] && v === m[(r + 1) * size + c + 1]) score += 3
    }
  }
  const total = size * size
  score += 10 * Math.floor(Math.abs(dark * 100 - total * 50) / (total * 5))
  return score
}

/**
 * Encode `text` (as UTF-8, byte mode) into a QR Code.
 * @param {string} text
 * @param {{ ecc?: 'L'|'M'|'Q'|'H', mask?: number }} [opts]  ecc defaults to 'M'. `mask` (0..7)
 *   forces a data mask instead of picking the lowest penalty; it exists for tests.
 * @returns {{ version: number, size: number, ecc: string, mask: number, modules: string[] }}
 */
export function encodeQr (text, opts = {}) {
  if (typeof text !== 'string') throw new Error('qr: text must be a string')
  const ecc = opts.ecc === undefined ? 'M' : opts.ecc
  const eccIndex = LEVELS.indexOf(ecc)
  if (eccIndex < 0) throw new Error('qr: ecc must be one of L, M, Q, H')
  if (opts.mask !== undefined && !(Number.isInteger(opts.mask) && opts.mask >= 0 && opts.mask <= 7)) throw new Error('qr: mask must be an integer from 0 to 7')

  const bytes = new TextEncoder().encode(text)
  let version = 0
  for (let v = 1; v <= 20 && version === 0; v++) {
    if (4 + (v < 10 ? 8 : 16) + 8 * bytes.length <= 8 * layout(v, eccIndex).dataTotal) version = v
  }
  if (version === 0) throw new Error('qr: too long (' + bytes.length + ' bytes does not fit version 20 at level ' + ecc + ')')

  const { eccLen, dataLens, dataTotal } = layout(version, eccIndex)
  const codewords = interleave(dataCodewords(bytes, version, dataTotal), eccLen, dataLens)
  const bits = []
  for (const w of codewords) for (let i = 7; i >= 0; i--) bits.push((w >> i) & 1)

  const { size, mod, fn } = baseMatrix(version)
  let dataModules = 0
  for (let i = 0; i < fn.length; i++) if (!fn[i]) dataModules++
  if (Math.floor(dataModules / 8) !== codewords.length) throw new Error('qr: internal block table mismatch for version ' + version)
  placeData(mod, fn, size, bits)

  let best = null
  let bestMask = -1
  let bestScore = Infinity
  for (let mask = 0; mask < 8; mask++) {
    if (opts.mask !== undefined && opts.mask !== mask) continue
    const m = mod.slice()
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) if (!fn[r * size + c] && MASKS[mask](r, c)) m[r * size + c] ^= 1
    }
    const word = formatWord(ecc, mask)
    for (const [r, c, bit] of formatCells(size)) m[r * size + c] = (word >>> bit) & 1
    const score = penalty(m, size)
    if (score < bestScore) { best = m; bestMask = mask; bestScore = score }
  }

  const modules = []
  for (let r = 0; r < size; r++) {
    let row = ''
    for (let c = 0; c < size; c++) row += best[r * size + c] ? '1' : '0'
    modules.push(row)
  }
  return { version, size, ecc, mask: bestMask, modules }
}

const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/**
 * Render a symbol as a self-contained SVG string. The viewBox is in module units and includes
 * the quiet zone; dark modules are one path (horizontal runs merged into rectangles).
 * @param {{ size: number, modules: string[] }} qr  result of encodeQr()
 * @param {{ quiet?: number, dark?: string, light?: string }} [opts]
 * @returns {string}
 */
export function toSvg (qr, { quiet = 4, dark = '#000', light = '#fff' } = {}) {
  const total = qr.size + 2 * quiet
  let d = ''
  for (let r = 0; r < qr.size; r++) {
    const row = qr.modules[r]
    let c = 0
    while (c < qr.size) {
      if (row[c] !== '1') { c++; continue }
      let end = c
      while (end < qr.size && row[end] === '1') end++
      d += 'M' + (c + quiet) + ' ' + (r + quiet) + 'h' + (end - c) + 'v1h-' + (end - c) + 'z'
      c = end
    }
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + total + '" shape-rendering="crispEdges" role="img" aria-label="QR code">' +
    '<rect width="' + total + '" height="' + total + '" fill="' + attr(light) + '"/>' +
    '<path d="' + d + '" fill="' + attr(dark) + '"/></svg>'
}
