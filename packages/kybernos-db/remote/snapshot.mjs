// snapshot.mjs — the disk half of moving an app: a consistent copy of a live db to send, and a received bundle checked and laid out as a db folder, ready to be moved into place.
// The bundle format itself is bundle.mjs (pure); this file reads and writes files, and needs `node:sqlite` like the store does.
//
//   snapshotDb({ db, tmpDir })    a copy of a live db made by SQLite itself (`db.backup`, VACUUM INTO), never by copying the file being written, with what goes with it
//   manifestOf(snap)              the bundle's manifest for that copy
//   bundleOf(snap, db)            the whole bundle, in memory
//   stageBundle({ decoded, tmpRoot })   a decoded bundle written to `<tmpRoot>/in-xxxx/<db id>/` and opened once to prove it is the db it says it is
//
// Nothing here puts a thing where a person's data lives: the caller moves the staged folder with one `rename`, so an import either happens whole or leaves nothing behind.
import { createHash, randomBytes } from 'node:crypto'
import { chmodSync, closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isUlid } from '../core/index.mjs'
import { isHash, openDb } from '../store/index.mjs'
import { sqliteOf } from '../store/sqlite.mjs'
import { BUNDLE_FORMAT, DEFAULT_MAX_BYTES, checkManifest, encodeBundle } from './bundle.mjs'

const refuse = (code, message) => ({ ok: false, code, message })

/** Size and SHA-256 of a file, read in pieces. */
function digest (file) {
  const fd = openSync(file, 'r')
  const hash = createHash('sha256')
  const piece = Buffer.allocUnsafe(1024 * 1024)
  let size = 0
  try {
    for (;;) {
      const n = readSync(fd, piece, 0, piece.length, null)
      if (n === 0) break
      hash.update(piece.subarray(0, n))
      size += n
    }
  } finally { closeSync(fd) }
  return { size, sha256: hash.digest('hex') }
}

/**
 * A copy of a live db, as a file under `tmpDir`: `{ id, name, fingerprint, file, size, sha256, blobs: [{ hash, size }], missing: [hash], dispose() }`. `db` is an open store db.
 * The fingerprint, the list of attachments the rows hold and the copy are taken in one synchronous stretch, so they describe the same moment. `blobs` are the attachments
 * the copy's rows hold that are on disk; `missing` are the ones a row names and the disk does not have (the source was already damaged there). `dispose()` removes the file.
 */
export function snapshotDb ({ db, tmpDir }) {
  mkdirSync(tmpDir, { recursive: true, mode: 0o700 })
  const file = join(tmpDir, 'snap-' + randomBytes(8).toString('hex') + '.sqlite')
  let info
  let fingerprint
  let held
  try {
    info = db.info()
    fingerprint = db.fingerprint()
    held = [...db.referenced()].filter(isHash).sort()
    db.backup(file)
    chmodSync(file, 0o600)
  } catch (e) {
    rmSync(file, { force: true })
    throw e
  }
  const blobs = []
  const missing = []
  for (const hash of held) {
    const st = db.blobs.stat(hash)
    if (st === null) missing.push(hash)
    else blobs.push({ hash, size: st.size })
  }
  const { size, sha256 } = digest(file)
  return { id: info.id, name: info.name, fingerprint, file, size, sha256, blobs, missing, dispose () { rmSync(file, { force: true }) } }
}

/** The manifest of a snapshot, in the form bundle.mjs reads. */
export function manifestOf (snap, opts) {
  const checked = checkManifest({ format: BUNDLE_FORMAT, db: { id: snap.id, name: snap.name, size: snap.size, sha256: snap.sha256 }, fingerprint: snap.fingerprint, blobs: snap.blobs }, opts)
  return checked.ok ? checked.manifest : checked
}

/**
 * The whole bundle of a snapshot, in memory: `{ ok: true, bytes, manifest, missing }`. Each attachment is read back and checked against its name; one that no longer holds what
 * its name says is left out and counted in `missing`.
 */
export function bundleOf (snap, db, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const blobs = []
  const missing = [...snap.missing]
  for (const b of snap.blobs) {
    const bytes = db.blobs.get(b.hash)
    if (bytes === null) missing.push(b.hash)
    else blobs.push({ hash: b.hash, bytes })
  }
  const packed = encodeBundle({ db: { id: snap.id, name: snap.name, fingerprint: snap.fingerprint, bytes: readFileSync(snap.file) }, blobs }, { maxBytes })
  return packed.ok ? { ...packed, missing } : packed
}

/**
 * Lays a decoded bundle (from decodeBundle) out as `<tmpRoot>/in-xxxx/<db id>/{db.sqlite, blobs/<hash>}`, then proves it: SQLite's own quick check, the file opens as a Kybernos db
 * (not newer than this Kybernos), and its id, name and fingerprint are the ones the manifest says. Answers `{ ok: true, dir, folder, id, name, fingerprint }` (`dir` holds
 * `folder`; the caller moves one of them into place, then removes `dir`) or `{ ok: false, code, message }` with nothing left on disk. Codes: invalid, corrupt, not_a_db, db_newer,
 * mismatch, sqlite_unavailable.
 */
export function stageBundle ({ decoded, tmpRoot, ports = {} }) {
  const m = decoded !== null && typeof decoded === 'object' ? decoded.manifest : null
  if (m === null || m === undefined || !isUlid(m.db && m.db.id) || !Buffer.isBuffer(decoded.db) || !Array.isArray(decoded.blobs)) return refuse('invalid', 'a decoded bundle (decodeBundle) is needed')
  const lib = sqliteOf(ports)
  if (lib === null) return refuse('sqlite_unavailable', 'node:sqlite is not available in this Node')
  mkdirSync(tmpRoot, { recursive: true, mode: 0o700 })
  const dir = mkdtempSync(join(tmpRoot, 'in-'))
  const folder = join(dir, m.db.id)
  const fail = (code, message) => { rmSync(dir, { recursive: true, force: true }); return refuse(code, message) }
  try {
    mkdirSync(join(folder, 'blobs'), { recursive: true, mode: 0o700 })
    const file = join(folder, 'db.sqlite')
    writeFileSync(file, decoded.db, { mode: 0o600, flag: 'wx' })
    for (const b of decoded.blobs) {
      if (!isHash(b.hash) || !Buffer.isBuffer(b.bytes)) return fail('invalid', 'a decoded bundle (decodeBundle) is needed')
      writeFileSync(join(folder, 'blobs', b.hash), b.bytes, { mode: 0o600, flag: 'wx' })
    }
    let quick = null
    let probe = null
    try {
      probe = new lib.DatabaseSync(file, { readOnly: true })
      quick = probe.prepare('PRAGMA quick_check').all().map((r) => r.quick_check)
    } catch (e) { quick = null } finally { try { if (probe !== null) probe.close() } catch (e) { /* already closed */ } }
    if (quick === null || quick.length !== 1 || quick[0] !== 'ok') return fail('corrupt', 'the database file is damaged')
    const opened = openDb(file, ports)
    if (!opened.ok) return fail(opened.code === 'sqlite_unavailable' ? opened.code : opened.code === 'db_newer' ? 'db_newer' : 'not_a_db', opened.message)
    try {
      const info = opened.db.info()
      if (info.id !== m.db.id || info.name !== m.db.name) return fail('mismatch', 'the database is not the one the manifest names')
      if (opened.db.fingerprint() !== m.fingerprint) return fail('mismatch', 'the database is not at the state the manifest names')
    } finally { opened.db.close() }
    return { ok: true, dir, folder, id: m.db.id, name: m.db.name, fingerprint: m.fingerprint }
  } catch (e) {
    rmSync(dir, { recursive: true, force: true })
    throw e
  }
}

/** Removes what `stageBundle` left (a folder it made under `tmpRoot`). */
export const discardStage = (dir) => rmSync(dir, { recursive: true, force: true })
