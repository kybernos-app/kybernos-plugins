// bundle.mjs — one binary container for a whole app: its SQLite file and the attachments it holds. Pure: Buffers in, Buffers out, node:crypto for the hashes, no disk and no clock.
//
// It is what an app travels in between a computer and a team space (and back): the same bytes on the way out and on the way in, checked at both ends.
//
//   bytes 0-7    the magic « KBAPPBND »
//   bytes 8-11   the format, a big-endian unsigned integer (1)
//   bytes 12-15  the length M of the manifest, big-endian
//   next M       the manifest, UTF-8 JSON: { format, db: { id, name, size, sha256 }, fingerprint, blobs: [{ hash, size }] }
//   next db.size the SQLite file
//   then         each blob, in the manifest's order (ascending by hash), `size` bytes each
//
// Nothing else follows. The reader trusts none of it: the magic and the version, the manifest's size and every key and value in it, the sizes against the bytes actually there
// (a short bundle and a long one are both refused), the SQLite header, and every hash recomputed from the bytes and compared. A blob is named by the SHA-256 of what it holds,
// so a name never comes from the input: a hash that is not 64 hex characters is refused, and nothing here makes a path.
import { createHash } from 'node:crypto'
import { MAX_ATTACHMENT_BYTES, isUlid } from '../core/index.mjs'

export const BUNDLE_FORMAT = 1
export const MAGIC = Buffer.from('KBAPPBND', 'latin1')
export const HEADER_BYTES = 16
/** The default cap of a whole bundle; a caller passes its own (`maxBytes`). */
export const DEFAULT_MAX_BYTES = 256 * 1024 * 1024
export const MAX_MANIFEST_BYTES = 4 * 1024 * 1024
export const MAX_BLOBS = 20000
export const MAX_BLOB_BYTES = MAX_ATTACHMENT_BYTES
const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'latin1')
const HASH = /^[0-9a-f]{64}$/
const FINGERPRINT = /^[0-9A-Za-z._-]{1,64}$/
const CONTROL = /[\u0000-\u001f\u007f]/

const refuse = (code, message) => ({ ok: false, code, message })
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const hasOnly = (o, keys) => Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k))
const bytesOf = (b) => (Buffer.isBuffer(b) ? b : b instanceof Uint8Array ? Buffer.from(b.buffer, b.byteOffset, b.byteLength) : null)
const sizeOk = (n, max) => Number.isSafeInteger(n) && n >= 0 && n <= max
const nameOk = (s) => typeof s === 'string' && s.trim().length >= 1 && s.trim().length <= 80 && !CONTROL.test(s)

/**
 * Checks a manifest (from a bundle, or the answer of a team space's `snapshot/manifest`) and gives it back in its canonical form: `{ ok: true, manifest }`, or `{ ok: false, code:
 * 'manifest', message }`. Every key must be the expected one, in no other shape; the blobs are in strictly ascending order, so none is named twice.
 */
export function checkManifest (m, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const bad = (message) => refuse('manifest', message)
  if (!isObject(m) || !hasOnly(m, ['format', 'db', 'fingerprint', 'blobs'])) return bad('a manifest is { format, db, fingerprint, blobs }')
  if (m.format !== BUNDLE_FORMAT) return refuse('version', 'bundle format ' + String(m.format).slice(0, 20) + ' is not one this reader knows (' + BUNDLE_FORMAT + ')')
  if (!isObject(m.db) || !hasOnly(m.db, ['id', 'name', 'size', 'sha256'])) return bad('db is { id, name, size, sha256 }')
  if (!isUlid(m.db.id)) return bad('db.id is a ULID')
  if (!nameOk(m.db.name)) return bad('db.name is 1 to 80 characters')
  if (!sizeOk(m.db.size, maxBytes) || m.db.size < SQLITE_HEADER.length) return bad('db.size is a whole number of bytes')
  if (typeof m.db.sha256 !== 'string' || !HASH.test(m.db.sha256)) return bad('db.sha256 is 64 hex characters')
  if (typeof m.fingerprint !== 'string' || !FINGERPRINT.test(m.fingerprint)) return bad('fingerprint is a short plain text')
  if (!Array.isArray(m.blobs) || m.blobs.length > MAX_BLOBS) return bad('blobs is a list of at most ' + MAX_BLOBS)
  let previous = ''
  for (const [i, b] of m.blobs.entries()) {
    if (!isObject(b) || !hasOnly(b, ['hash', 'size'])) return bad('blobs.' + i + ' is { hash, size }')
    if (typeof b.hash !== 'string' || !HASH.test(b.hash)) return bad('blobs.' + i + '.hash is 64 hex characters')
    if (!sizeOk(b.size, MAX_BLOB_BYTES)) return bad('blobs.' + i + '.size is at most ' + MAX_BLOB_BYTES + ' bytes')
    if (b.hash === previous) return refuse('duplicate', 'blob ' + b.hash.slice(0, 12) + ' is listed twice')
    if (b.hash < previous) return refuse('order', 'blobs are listed in ascending order of hash')
    previous = b.hash
  }
  return {
    ok: true,
    manifest: { format: BUNDLE_FORMAT, db: { id: m.db.id, name: m.db.name, size: m.db.size, sha256: m.db.sha256 }, fingerprint: m.fingerprint, blobs: m.blobs.map((b) => ({ hash: b.hash, size: b.size })) },
  }
}

/**
 * Packs an app. `db` is `{ id, name, fingerprint, bytes }` (the SQLite file) and `blobs` is `[{ hash, bytes }]`; each hash is recomputed and must be the one given. Answers `{ ok: true,
 * bytes, manifest }` or `{ ok: false, code, message }`. The blobs are ordered by hash, whatever order they come in.
 */
export function encodeBundle ({ db, blobs = [] } = {}, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
  if (!isObject(db)) return refuse('type', 'db is { id, name, fingerprint, bytes }')
  const file = bytesOf(db.bytes)
  if (file === null) return refuse('type', 'db.bytes is bytes')
  if (file.length < SQLITE_HEADER.length || !file.subarray(0, SQLITE_HEADER.length).equals(SQLITE_HEADER)) return refuse('sqlite', 'db.bytes is not a SQLite file')
  if (!Array.isArray(blobs)) return refuse('type', 'blobs is a list')
  const entries = []
  for (const [i, b] of blobs.entries()) {
    const bytes = isObject(b) ? bytesOf(b.bytes) : null
    if (bytes === null || typeof b.hash !== 'string') return refuse('type', 'blobs.' + i + ' is { hash, bytes }')
    if (bytes.length > MAX_BLOB_BYTES) return refuse('manifest', 'blobs.' + i + ' is over ' + MAX_BLOB_BYTES + ' bytes')
    if (sha256(bytes) !== b.hash) return refuse('hash', 'blobs.' + i + ' does not hold what its hash says')
    entries.push({ hash: b.hash, size: bytes.length, bytes })
  }
  entries.sort((x, y) => (x.hash < y.hash ? -1 : x.hash > y.hash ? 1 : 0))
  const checked = checkManifest({ format: BUNDLE_FORMAT, db: { id: db.id, name: db.name, size: file.length, sha256: sha256(file) }, fingerprint: db.fingerprint, blobs: entries.map((e) => ({ hash: e.hash, size: e.size })) }, { maxBytes })
  if (!checked.ok) return checked
  const json = Buffer.from(JSON.stringify(checked.manifest), 'utf8')
  if (json.length > MAX_MANIFEST_BYTES) return refuse('manifest', 'the manifest is over ' + MAX_MANIFEST_BYTES + ' bytes')
  const total = HEADER_BYTES + json.length + file.length + entries.reduce((n, e) => n + e.size, 0)
  if (total > maxBytes) return refuse('too-big', 'the bundle would be ' + total + ' bytes, over the ' + maxBytes + ' allowed')
  const head = Buffer.alloc(HEADER_BYTES)
  MAGIC.copy(head, 0)
  head.writeUInt32BE(BUNDLE_FORMAT, 8)
  head.writeUInt32BE(json.length, 12)
  return { ok: true, bytes: Buffer.concat([head, json, file, ...entries.map((e) => e.bytes)], total), manifest: checked.manifest }
}

/**
 * Opens a bundle, trusting nothing: `{ ok: true, manifest, db (the SQLite bytes), blobs: [{ hash, size, bytes }] }`, or `{ ok: false, code, message }`. The bytes are views into
 * `input`, not copies. Codes: type, too-big, truncated, magic, version, manifest-size, manifest, duplicate, order, trailing, sqlite, hash.
 */
export function decodeBundle (input, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const buf = bytesOf(input)
  if (buf === null) return refuse('type', 'a bundle is bytes')
  if (buf.length > maxBytes) return refuse('too-big', 'a bundle is at most ' + maxBytes + ' bytes')
  if (buf.length < HEADER_BYTES) return refuse('truncated', 'too short to be a bundle')
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) return refuse('magic', 'not an app bundle')
  const format = buf.readUInt32BE(8)
  if (format !== BUNDLE_FORMAT) return refuse('version', 'bundle format ' + format + ' is not one this reader knows (' + BUNDLE_FORMAT + ')')
  const length = buf.readUInt32BE(12)
  if (length < 2 || length > MAX_MANIFEST_BYTES) return refuse('manifest-size', 'the manifest is 2 to ' + MAX_MANIFEST_BYTES + ' bytes')
  if (HEADER_BYTES + length > buf.length) return refuse('truncated', 'the bundle ends inside its manifest')
  let parsed
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(HEADER_BYTES, HEADER_BYTES + length))) } catch (e) { return refuse('manifest', 'the manifest is not JSON') }
  const checked = checkManifest(parsed, { maxBytes })
  if (!checked.ok) return checked
  const { manifest } = checked
  const expected = HEADER_BYTES + length + manifest.db.size + manifest.blobs.reduce((n, b) => n + b.size, 0)
  if (buf.length < expected) return refuse('truncated', 'the bundle is ' + (expected - buf.length) + ' bytes short of what its manifest says')
  if (buf.length > expected) return refuse('trailing', 'the bundle has ' + (buf.length - expected) + ' bytes after what its manifest says')
  let at = HEADER_BYTES + length
  const db = buf.subarray(at, at + manifest.db.size)
  at += manifest.db.size
  if (!db.subarray(0, SQLITE_HEADER.length).equals(SQLITE_HEADER)) return refuse('sqlite', 'the database is not a SQLite file')
  if (sha256(db) !== manifest.db.sha256) return refuse('hash', 'the database does not match its hash')
  const blobs = []
  for (const b of manifest.blobs) {
    const bytes = buf.subarray(at, at + b.size)
    at += b.size
    if (sha256(bytes) !== b.hash) return refuse('hash', 'blob ' + b.hash.slice(0, 12) + ' does not match its hash')
    blobs.push({ hash: b.hash, size: b.size, bytes })
  }
  return { ok: true, manifest, db, blobs }
}
