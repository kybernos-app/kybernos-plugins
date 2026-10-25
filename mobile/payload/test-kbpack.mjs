import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { pack, unpack, listFiles } from './kbpack.mjs'

const root = mkdtempSync(join(tmpdir(), 'kbpack-'))
const src = join(root, 'src'); const out = join(root, 'out'); const file = join(root, 'p.kbpack')
mkdirSync(join(src, 'a/b'), { recursive: true }); mkdirSync(join(src, 'empty-dir-is-not-packed'))
writeFileSync(join(src, 'a/b/x.js'), 'export default 1\n')
writeFileSync(join(src, 'a/zero.txt'), '')
writeFileSync(join(src, 'z-last-empty'), '')
writeFileSync(join(src, 'big.bin'), randomBytes(3 * 1024 * 1024 + 17))
writeFileSync(join(src, 'run.sh'), '#!/bin/sh\necho hi\n', { mode: 0o755 })
writeFileSync(join(src, 'ünï cödé.txt'), 'utf8 name')
const r = await pack(src, file)
assert.equal(r.files, 6); assert.ok(r.packed > 0)
const u = await unpack(file, out)
assert.equal(u.files, 6)
for (const f of listFiles(src)) {
  const a = readFileSync(join(src, f.path)); const b = readFileSync(join(out, f.path))
  assert.equal(createHash('sha256').update(a).digest('hex'), createHash('sha256').update(b).digest('hex'), f.path)
}
assert.ok((statSync(join(out, 'run.sh')).mode & 0o111) !== 0, 'exec bit kept')
// a hostile archive is refused
const evil = join(root, 'evil'); mkdirSync(evil); writeFileSync(join(evil, 'ok.txt'), 'x')
const e = await pack(evil, join(root, 'e.kbpack'))
const buf = readFileSync(join(root, 'e.kbpack')); const hl = buf.readUInt32BE(8); const header = JSON.parse(buf.subarray(12, 12 + hl).toString())
header.files[0].path = '../escape.txt'
const nh = Buffer.from(JSON.stringify(header)); const len = Buffer.alloc(4); len.writeUInt32BE(nh.length)
writeFileSync(join(root, 'e2.kbpack'), Buffer.concat([buf.subarray(0, 8), len, nh, buf.subarray(12 + hl)]))
await assert.rejects(unpack(join(root, 'e2.kbpack'), join(root, 'out2')), /unsafe path/)
// a truncated archive is refused
writeFileSync(join(root, 't.kbpack'), readFileSync(file).subarray(0, Math.floor(r.packed / 2)))
await assert.rejects(unpack(join(root, 't.kbpack'), join(root, 'out3')))
rmSync(root, { recursive: true, force: true })
console.log('kbpack: round trip of', r.files, 'files,', r.bytes, 'bytes ->', r.packed, 'packed; exec bit, utf8 names, empty files, hostile and truncated archives checked')
