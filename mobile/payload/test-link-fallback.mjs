// Android's SELinux policy refuses hard links to an app (`avc: denied { link }`); the engine saves a session with a temporary file linked into place, so every chat turn failed with EACCES
// (seen on an Android 16 emulator and phone, 2026-10-25). The payload's preload shim falls back to an exclusive copy. This forces link() to be refused and checks what the shim makes of it:
// the file appears, an existing destination still fails with EEXIST (a link would), a missing source still fails with ENOENT.
//   node mobile/payload/test-link-fallback.mjs
import fs from 'node:fs'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
const refuse = () => { const e = new Error('EACCES: permission denied, link'); e.code = 'EACCES'; throw e }
fs.linkSync = refuse; fs.link = (a, b, cb) => process.nextTick(() => { const e = new Error('EACCES'); e.code = 'EACCES'; cb(e) }); fs.promises.link = async () => refuse()
await import(new URL('./shims/preload.mjs', import.meta.url).href)
const d = mkdtempSync(join(tmpdir(), 'kb-link-'))
const src = join(d, 'a.tmp'); writeFileSync(src, 'hello')
fs.linkSync(src, join(d, 'b')); assert.equal(readFileSync(join(d, 'b'), 'utf8'), 'hello')
await new Promise((res, rej) => fs.link(src, join(d, 'c'), (e) => (e ? rej(e) : res()))); assert.equal(readFileSync(join(d, 'c'), 'utf8'), 'hello')
await fs.promises.link(src, join(d, 'd')); assert.equal(readFileSync(join(d, 'd'), 'utf8'), 'hello')
assert.throws(() => fs.linkSync(src, join(d, 'b')), (e) => e.code === 'EEXIST')
await assert.rejects(fs.promises.link(src, join(d, 'd')), (e) => e.code === 'EEXIST')
assert.throws(() => fs.linkSync(join(d, 'nope'), join(d, 'e')), (e) => e.code === 'ENOENT')
const { link } = await import('node:fs/promises'); await link(src, join(d, 'f')); assert.ok(existsSync(join(d, 'f')))
console.log('link fallback: PASS')
