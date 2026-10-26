// kbpack: the single-file archive the mobile apps ship their runtime in (engine, profile, shims).
// Layout: "KBPACK1\n" | u32 length of the header | header JSON | one zstd stream holding the file contents back to back.
// The header lists every entry in stream order, so a reader needs no random access and holds one file at a time in memory.
// Node's own zlib does the zstd work (22.15+), which is what the embedded Node of the phone app has: no tar tool, no native module.
import { createReadStream, createWriteStream, mkdirSync, writeFileSync, openSync, readSync, closeSync, statSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, relative, sep } from 'node:path'
import { createZstdCompress, createZstdDecompress } from 'node:zlib'
import { once } from 'node:events'

const MAGIC = Buffer.from('KBPACK1\n')

/** Every regular file under `root` as { path (posix, relative), size, exec }, in a stable order. Symlinks and special files are not packed. */
export const listFiles = (root) => {
  const out = []
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.isFile()) { const st = statSync(p); out.push({ path: relative(root, p).split(sep).join('/'), size: st.size, exec: (st.mode & 0o111) !== 0 }) }
    }
  }
  walk(root)
  return out
}

/** Packs `root` into `outFile`. Returns { files, bytes (uncompressed), packed (file size), sha256 (of the pack file) }. */
export const pack = async (root, outFile, { level = 9 } = {}) => {
  const entries = listFiles(root)
  const header = Buffer.from(JSON.stringify({ v: 1, files: entries }))
  const len = Buffer.alloc(4); len.writeUInt32BE(header.length)
  const out = createWriteStream(outFile)
  out.write(MAGIC); out.write(len); out.write(header)
  const z = createZstdCompress({ params: { 100: level } }) // ZSTD_c_compressionLevel
  z.pipe(out, { end: false })
  for (const f of entries) {
    const rs = createReadStream(join(root, f.path))
    for await (const chunk of rs) if (!z.write(chunk)) await once(z, 'drain')
  }
  z.end()
  await once(z, 'end')
  await new Promise((res) => setImmediate(res))
  out.end()
  await once(out, 'close')
  const bytes = entries.reduce((n, f) => n + f.size, 0)
  const h = createHash('sha256'); for await (const c of createReadStream(outFile)) h.update(c)
  return { files: entries.length, bytes, packed: statSync(outFile).size, sha256: h.digest('hex') }
}

const readHeader = (file) => {
  const fd = openSync(file, 'r')
  try {
    const head = Buffer.alloc(MAGIC.length + 4)
    readSync(fd, head, 0, head.length, 0)
    if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('not a kbpack file: ' + file)
    const hl = head.readUInt32BE(MAGIC.length)
    const hb = Buffer.alloc(hl); readSync(fd, hb, 0, hl, head.length)
    return { header: JSON.parse(hb.toString('utf8')), dataOffset: head.length + hl }
  } finally { closeSync(fd) }
}

/** Unpacks `file` into `destDir` (created). Refuses any path that would leave it. `place(path)` may send an entry elsewhere (an absolute path) or return undefined to keep it in `destDir`.
 *  One synchronous write per file and a cache of the folders already made: without a JIT (the phone's Node) this loop is the cost, 30 000 small files must stay cheap. Returns { files, bytes }. */
export const unpack = async (file, destDir, { onProgress, place } = {}) => {
  const { header, dataOffset } = readHeader(file)
  const files = header.files
  mkdirSync(destDir, { recursive: true })
  const made = new Set()
  const z = createZstdDecompress({ chunkSize: 1 << 20 })
  createReadStream(file, { start: dataOffset, highWaterMark: 1 << 20 }).pipe(z)
  let i = 0; let parts = []; let got = 0
  const write = () => {
    const f = files[i]
    if (f.path.startsWith('/') || f.path.split('/').includes('..')) throw new Error('unsafe path in kbpack: ' + f.path)
    const target = (place && place(f.path)) || join(destDir, f.path)
    const dir = dirname(target)
    if (!made.has(dir)) { mkdirSync(dir, { recursive: true }); made.add(dir) }
    writeFileSync(target, parts.length === 1 ? parts[0] : Buffer.concat(parts), { mode: f.exec ? 0o755 : 0o644 })
    parts = []; got = 0; i += 1
    if (onProgress) onProgress(i, files.length)
  }
  while (i < files.length && files[i].size === 0) write()
  for await (const chunk of z) {
    let off = 0
    while (off < chunk.length) {
      if (i >= files.length) throw new Error('kbpack: data after the last file')
      const take = Math.min(files[i].size - got, chunk.length - off)
      parts.push(chunk.subarray(off, off + take)); got += take; off += take
      if (got === files[i].size) { write(); while (i < files.length && files[i].size === 0) write() }
    }
  }
  if (i !== files.length) throw new Error('kbpack: truncated archive (' + i + ' of ' + files.length + ' files)')
  return { files: files.length, bytes: files.reduce((n, f) => n + f.size, 0) }
}

export const sha256File = async (file) => { const h = createHash('sha256'); for await (const c of createReadStream(file)) h.update(c); return h.digest('hex') }

