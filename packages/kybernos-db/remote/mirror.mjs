// mirror.mjs — the pull half of keeping a read-only copy of a published app: what the hosted app holds now, fetched, checked and laid out as a db folder in a staging place.
//
//   pullMirror({ space, slug, dbId, current, tmpRoot })      → { ok: true, changed: false, fingerprint }
//                                                              { ok: true, changed: true, fingerprint, staged: { dir, folder } }
//                                                              { ok: false, code, message }
//
// The copy is never built in place. The steps: ask the hosted fingerprint (cheap; equal means nothing to do); read the manifest of a snapshot, then that snapshot's SQLite file
// (its fingerprint must be the manifest's, else a write came between the two and the pull starts again, a few times at most); fetch only the attachments the copy does not
// already hold (they are named by the SHA-256 of what they contain, so a name that is there is the right bytes) and check each one's size and hash; lay the whole thing out
// under `tmpRoot` with bundle.mjs's checks (SQLite's quick check, the file opens as a Kybernos db, its id, name and fingerprint are the manifest's); give the attachments the copy
// already had to the new folder (a hard link, else a copy). Nothing of the live copy is touched: the caller swaps the folder in with one rename (service.replaceMirror) and
// removes `staged.dir`. A failure leaves nothing behind in `tmpRoot` and the live copy exactly as it was.
//
// `current` describes the live copy: `{ fingerprint, blobSize(hash) → bytes | null, blobFile(hash) → path }`.
import { copyFileSync, linkSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_MAX_BYTES, sha256 } from './bundle.mjs'
import { discardStage, stageBundle } from './snapshot.mjs'

export const PULL_ATTEMPTS = 3
const fail = (code, message) => ({ ok: false, code, message })

/** The code a failed staging gets for the person's sake: all of them mean the hosted copy cannot be trusted as it arrived. */
const STAGE_CODES = new Set(['corrupt', 'not_a_db', 'db_newer', 'mismatch', 'sqlite_unavailable', 'invalid'])

export async function pullMirror ({ space, slug, dbId, current, tmpRoot, ports = {}, maxBytes = DEFAULT_MAX_BYTES, attempts = PULL_ATTEMPTS }) {
  const head = await space.fingerprint(slug)
  if (!head.ok) return head
  if (typeof current.fingerprint === 'string' && head.fingerprint === current.fingerprint) return { ok: true, changed: false, fingerprint: head.fingerprint }

  let manifest = null
  let db = null
  for (let attempt = 0; attempt < attempts && db === null; attempt++) {
    const m = await space.manifest(slug)
    if (!m.ok) return m
    if (m.manifest.db.id !== dbId) return fail('mismatch', 'The web app holds a different database than the one published from here.')
    const d = await space.snapshotDb(slug)
    if (!d.ok) return d
    if (d.fingerprint !== m.manifest.fingerprint) continue // a write came between the two calls: start again from a new manifest
    if (d.bytes.length !== m.manifest.db.size || sha256(d.bytes) !== m.manifest.db.sha256) return fail('mismatch', 'The web app’s data did not arrive intact.')
    manifest = m.manifest
    db = d.bytes
  }
  if (db === null) return fail('busy', 'The web app kept changing while it was being copied. Try again in a moment.')

  // what has to come over: the attachments whose name is not already here at the right size
  const need = manifest.blobs.filter((b) => current.blobSize(b.hash) !== b.size)
  const incoming = need.reduce((n, b) => n + b.size, 0) + db.length
  if (incoming > maxBytes) return fail('too-large', 'That app is bigger than this computer will copy in one go.')
  const fetched = []
  for (const b of need) {
    const r = await space.blob(slug, b.hash)
    if (!r.ok) return r.code === 'unknown' || r.code === 'missing' ? fail('mismatch', 'The web app no longer has a file it listed.') : r
    if (r.bytes.length !== b.size || sha256(r.bytes) !== b.hash) return fail('mismatch', 'A file did not arrive intact.')
    fetched.push({ hash: b.hash, size: b.size, bytes: r.bytes })
  }

  const staged = stageBundle({ decoded: { manifest, db, blobs: fetched }, tmpRoot, ports })
  if (!staged.ok) return fail(STAGE_CODES.has(staged.code) ? 'mismatch' : staged.code, staged.code === 'db_newer' ? staged.message : 'The web app’s data could not be checked: ' + staged.message)
  try {
    const have = new Set(fetched.map((b) => b.hash))
    for (const b of manifest.blobs) {
      if (have.has(b.hash)) continue
      const to = join(staged.folder, 'blobs', b.hash)
      const from = current.blobFile(b.hash)
      try { linkSync(from, to) } catch (e) {
        try { copyFileSync(from, to) } catch (e2) { discardStage(staged.dir); return fail('mismatch', 'A file this computer had is gone, so the copy could not be completed.') }
      }
    }
    const laid = readdirSync(join(staged.folder, 'blobs')).length
    if (laid !== manifest.blobs.length) { discardStage(staged.dir); return fail('mismatch', 'The copy does not hold every file it should.') }
  } catch (e) {
    try { rmSync(staged.dir, { recursive: true, force: true }) } catch (e2) { /* nothing to remove */ }
    return fail('failed', 'The copy could not be completed.')
  }
  return { ok: true, changed: true, fingerprint: manifest.fingerprint, staged: { dir: staged.dir, folder: staged.folder } }
}
