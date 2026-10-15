import { zstdDecompressSync } from 'node:zlib'

/**
 * A session journal is a run of CONCATENATED zstd frames (one per flush); `zstdDecompressSync` stops after the first one. This walks the
 * frame magic (0x28B52FFD), validating each decompression: a magic candidate can fall INSIDE the compressed data of the previous frame,
 * and a wrong slice then fails to decompress, which moves to the next candidate. Same method as `kybernos-cloud` (duplicated on purpose).
 * @param {Buffer} buf
 * @returns {string} the journal, as JSON lines
 */
export function zstdFrames (buf) {
  const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
  const parts = []
  let cursor = 0
  while (cursor < buf.length - 4) {
    let start = cursor
    let out = null
    while (start <= buf.length - 4) {
      const at = buf.indexOf(magic, start)
      if (at < 0) break
      const next = buf.indexOf(magic, at + 4)
      const end = next < 0 ? buf.length : next
      try {
        const txt = zstdDecompressSync(buf.subarray(at, end)).toString('utf8')
        if (txt.startsWith('{')) { out = { txt, end }; break }
      } catch (e) { /* a false candidate, or a frame split by one: the next one */ }
      start = at + 1
    }
    if (out === null) break
    parts.push(out.txt)
    cursor = out.end
  }
  return parts.join('')
}
