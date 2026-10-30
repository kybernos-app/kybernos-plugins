// Attached files: `<db folder>/blobs/<sha256>`, named by what they contain. Two records holding the same file share one blob; a blob is never rewritten.
//
// A record's attachment field holds `{ name, size, type, hash }` (see core/types.mjs), never the bytes. A blob that is read back is checked against its name, so a
// damaged or swapped file is reported as missing instead of being served as someone else's. A blob's age is its file's modification time, which `put` renews when the
// same bytes are stored again, so the garbage collector (db.mjs) never takes a file that was just handed over.

import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MAX_ATTACHMENT_BYTES } from '../core/index.mjs'

const HASH = /^[0-9a-f]{64}$/

export const isHash = (s) => typeof s === 'string' && HASH.test(s)
export const hashOf = (bytes) => createHash('sha256').update(bytes).digest('hex')
const isBytes = (b) => b instanceof Uint8Array

/** The blobs of one db folder. Nothing is created on disk until the first `put`. */
export function openBlobs (dir) {
  const fileOf = (hash) => join(dir, hash)
  return {
    dir,
    hash: hashOf,
    has: (hash) => isHash(hash) && existsSync(fileOf(hash)),
    /** Stores bytes: `{ ok: true, hash, size }`, or `{ ok: false, code, message }` when they are not bytes or are over `maxBytes` (25 MB by default). */
    put (bytes, maxBytes = MAX_ATTACHMENT_BYTES) {
      if (!isBytes(bytes)) return { ok: false, code: 'type', message: 'a file is bytes (a Buffer or a Uint8Array)' }
      if (bytes.length > maxBytes) return { ok: false, code: 'too-big', message: 'a file is at most ' + maxBytes + ' bytes' }
      const hash = hashOf(bytes)
      const file = fileOf(hash)
      if (existsSync(file)) {
        try { const now = new Date(); utimesSync(file, now, now) } catch (e) { /* the file is there; only its age was not renewed */ }
        return { ok: true, hash, size: bytes.length }
      }
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      const tmp = join(dir, '.' + hash + '.' + randomBytes(6).toString('hex') + '.tmp')
      try {
        writeFileSync(tmp, bytes, { mode: 0o600, flag: 'wx' })
        renameSync(tmp, file)
      } catch (e) {
        try { rmSync(tmp, { force: true }) } catch (e2) { /* nothing to remove */ }
        throw e
      }
      return { ok: true, hash, size: bytes.length }
    },
    /** The bytes of a blob, or null when there is none or its content does not match its name. */
    get (hash) {
      if (!isHash(hash)) return null
      let bytes
      try { bytes = readFileSync(fileOf(hash)) } catch (e) { return null }
      return hashOf(bytes) === hash ? bytes : null
    },
    list () {
      try { return readdirSync(dir).filter(isHash).sort() } catch (e) { return [] }
    },
    /** `{ size, mtimeMs }` of a blob, or null. */
    stat (hash) {
      if (!isHash(hash)) return null
      try { const st = statSync(fileOf(hash)); return { size: st.size, mtimeMs: st.mtimeMs } } catch (e) { return null }
    },
    /** Deletes a blob; true when it was there. Only the garbage collector calls it. */
    remove (hash) {
      if (!isHash(hash) || !existsSync(fileOf(hash))) return false
      try { rmSync(fileOf(hash), { force: true }); return true } catch (e) { return false }
    },
  }
}
