// kybernos-db remote/: the signed tokens and the owner's API token, the bundle codec (with hostile input), and the disk half (a consistent snapshot of a live db, a bundle staged
// and proven). No dependency but Node 22.19+ (node:sqlite).
//
//   node packages/kybernos-db/test-remote.mjs
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { makeService } from './agent/service.mjs'
import { openDb } from './store/index.mjs'
import { BUNDLE_FORMAT, DEFAULT_MAX_BYTES, HEADER_BYTES, MAGIC, MAX_BLOBS, checkManifest, decodeBundle, encodeBundle, sha256 } from './remote/bundle.mjs'
import { discardStage, bundleOf, manifestOf, snapshotDb, stageBundle } from './remote/snapshot.mjs'
import { OWNER_API_MAX_TTL_SEC, OWNER_API_SKEW_SEC, bearerOf, hexKey, mintOwnerApiToken, signToken, verifyOwnerApiToken, verifyToken } from './remote/token.mjs'

let count = 0
const ok = (label, fn) => { fn(); count++; console.log('ok  ', label) }
const root = mkdtempSync(join(tmpdir(), 'kb-db-remote-'))
process.on('exit', () => rmSync(root, { recursive: true, force: true })) // a failed check leaves nothing behind either
const KEY = Buffer.alloc(32, 7)
const clock = (start = Date.UTC(2026, 9, 31, 9, 0, 0)) => { const c = { t: start, now: () => c.t, advance: (ms) => { c.t += ms } }; return c }
const flip = (token) => token.slice(0, -2) + (token.at(-2) === 'A' ? 'B' : 'A') + token.slice(-1)

// ── tokens ──

ok('a token verifies, carries its claims, expires, and is bound to its key and its kind', () => {
  const c = clock()
  const t = signToken('open', { n: 'abc' }, KEY, { now: c.now, ttlSec: 60 })
  assert.equal(verifyToken('open', t, KEY, { now: c.now }).claims.n, 'abc')
  assert.deepEqual(verifyToken('invite', t, KEY, { now: c.now }), { ok: false, reason: 'bad-signature' })
  assert.deepEqual(verifyToken('open', t, Buffer.alloc(32, 8), { now: c.now }), { ok: false, reason: 'bad-signature' })
  assert.deepEqual(verifyToken('open', flip(t), KEY, { now: c.now }), { ok: false, reason: 'bad-signature' })
  c.advance(60_000)
  assert.deepEqual(verifyToken('open', t, KEY, { now: c.now }), { ok: false, reason: 'expired' })
  assert.equal(hexKey('ab'.repeat(16)).length, 16)
  assert.equal(hexKey('zz'.repeat(16)), null)
  assert.throws(() => signToken('open', {}, 'short', { ttlSec: 60 }), /key/)
})

ok('the owner API token: five minutes at most, its own kind, its own lifetime checked', () => {
  const c = clock()
  const t = mintOwnerApiToken({ key: KEY, now: c.now })
  assert.deepEqual(verifyOwnerApiToken(t, KEY, { now: c.now }), { ok: true })
  assert.deepEqual(verifyOwnerApiToken(t, Buffer.alloc(32, 9), { now: c.now }), { ok: false, reason: 'bad-signature' })
  assert.deepEqual(verifyOwnerApiToken(flip(t), KEY, { now: c.now }), { ok: false, reason: 'bad-signature' })
  assert.deepEqual(verifyOwnerApiToken('', KEY, { now: c.now }), { ok: false, reason: 'malformed' })
  assert.deepEqual(verifyOwnerApiToken(undefined, KEY, { now: c.now }), { ok: false, reason: 'malformed' })
  c.advance((OWNER_API_MAX_TTL_SEC - 1) * 1000)
  assert.equal(verifyOwnerApiToken(t, KEY, { now: c.now }).ok, true)
  c.advance(1000)
  assert.deepEqual(verifyOwnerApiToken(t, KEY, { now: c.now }), { ok: false, reason: 'expired' })
  assert.throws(() => mintOwnerApiToken({ key: KEY, ttlSec: OWNER_API_MAX_TTL_SEC + 1 }), /ttl/)
  assert.throws(() => mintOwnerApiToken({ key: KEY, ttlSec: 0 }), /ttl/)
  assert.notEqual(mintOwnerApiToken({ key: KEY, now: c.now }), mintOwnerApiToken({ key: KEY, now: c.now }), 'two tokens made in the same second differ')
})

ok('a token of another kind, or one that claims a longer life, is not an owner token', () => {
  const c = clock()
  const wrongKind = signToken('open', { n: 'x', i: Math.floor(c.t / 1000) }, KEY, { now: c.now, ttlSec: 60 })
  assert.deepEqual(verifyOwnerApiToken(wrongKind, KEY, { now: c.now }), { ok: false, reason: 'bad-signature' })
  const hour = signToken('owner-api', { n: 'x', i: Math.floor(c.t / 1000) }, KEY, { now: c.now, ttlSec: 3600 })
  assert.deepEqual(verifyOwnerApiToken(hour, KEY, { now: c.now }), { ok: false, reason: 'lifetime' }, 'valid and unexpired, and still refused')
  const noIssue = signToken('owner-api', { n: 'x' }, KEY, { now: c.now, ttlSec: 60 })
  assert.deepEqual(verifyOwnerApiToken(noIssue, KEY, { now: c.now }), { ok: false, reason: 'malformed' })
  const backdated = signToken('owner-api', { n: 'x', i: Math.floor(c.t / 1000) + 10_000 }, KEY, { now: c.now, ttlSec: 60 })
  assert.equal(verifyOwnerApiToken(backdated, KEY, { now: c.now }).ok, false, 'issued after it expires')
  const future = mintOwnerApiToken({ key: KEY, now: () => c.t + (OWNER_API_SKEW_SEC + 30) * 1000 })
  assert.deepEqual(verifyOwnerApiToken(future, KEY, { now: c.now }), { ok: false, reason: 'not-yet' })
  const nearly = mintOwnerApiToken({ key: KEY, now: () => c.t + (OWNER_API_SKEW_SEC - 5) * 1000 })
  assert.equal(verifyOwnerApiToken(nearly, KEY, { now: c.now }).ok, true, 'a clock a little ahead is tolerated')
})

ok('the bearer of a header', () => {
  assert.equal(bearerOf('Bearer abc.def'), 'abc.def')
  assert.equal(bearerOf('bearer   abc.def  '), 'abc.def')
  assert.equal(bearerOf('BEARER abc'), 'abc')
  assert.equal(bearerOf('Bearer'), '')
  assert.equal(bearerOf('Basic dXNlcjpwYXNz'), null)
  assert.equal(bearerOf('Bearerx abc'), null)
  assert.equal(bearerOf(undefined), null)
  assert.equal(bearerOf(['Bearer a']), null)
})

// ── the codec ──

const SQLITE = Buffer.concat([Buffer.from('SQLite format 3\0', 'latin1'), Buffer.alloc(4080, 1)])
const ULID = '01HZZZZZZZZZZZZZZZZZZZZZZZ'
const blob = (text) => { const bytes = Buffer.from(text); return { hash: sha256(bytes), bytes } }
const A = blob('a picture')
const B = blob('another file')
const pack = (over = {}, opts) => {
  const r = encodeBundle({ db: { id: ULID, name: 'Shop', fingerprint: '3.12.4.9', bytes: SQLITE, ...(over.db || {}) }, blobs: over.blobs ?? [B, A] }, opts)
  assert.equal(r.ok, true, JSON.stringify(r))
  return r
}
/** A bundle by hand, so that a test can break exactly one thing. */
function hand ({ manifest, length, version = BUNDLE_FORMAT, magic = MAGIC, db = SQLITE, blobs = [A, B].sort((x, y) => (x.hash < y.hash ? -1 : 1)), tail = Buffer.alloc(0) }) {
  const m = manifest ?? { format: BUNDLE_FORMAT, db: { id: ULID, name: 'Shop', size: db.length, sha256: sha256(db) }, fingerprint: '3.12.4.9', blobs: blobs.map((b) => ({ hash: b.hash, size: b.bytes.length })) }
  const json = Buffer.from(typeof m === 'string' ? m : JSON.stringify(m))
  const head = Buffer.alloc(HEADER_BYTES)
  magic.copy(head, 0)
  head.writeUInt32BE(version, 8)
  head.writeUInt32BE(length ?? json.length, 12)
  return Buffer.concat([head, json, db, ...blobs.map((b) => b.bytes), tail])
}
const refused = (r, code) => { assert.equal(r.ok, false, 'should be refused: ' + JSON.stringify(r).slice(0, 200)); assert.equal(r.code, code, JSON.stringify(r)); assert.equal(typeof r.message, 'string') }

ok('a bundle round-trips: the db, every blob, in order of hash, whatever order they came in', () => {
  const p = pack()
  assert.deepEqual(p.manifest.blobs.map((b) => b.hash), [A.hash, B.hash].sort())
  assert.equal(p.manifest.db.sha256, sha256(SQLITE))
  const d = decodeBundle(p.bytes)
  assert.equal(d.ok, true)
  assert.deepEqual(d.manifest, p.manifest)
  assert.ok(d.db.equals(SQLITE))
  assert.deepEqual(d.blobs.map((b) => b.hash), p.manifest.blobs.map((b) => b.hash))
  assert.ok(d.blobs.find((b) => b.hash === A.hash).bytes.equals(A.bytes))
  assert.equal(decodeBundle(new Uint8Array(p.bytes)).ok, true, 'a Uint8Array works too')
  assert.equal(decodeBundle(pack({ blobs: [] }).bytes).blobs.length, 0, 'an app with no attachments')
  assert.deepEqual(encodeBundle({ db: { id: ULID, name: 'Shop', fingerprint: '3.12.4.9', bytes: SQLITE }, blobs: [B, A] }).bytes, p.bytes, 'the same bytes however the blobs are listed')
  assert.ok(hand({}).equals(p.bytes), 'and the layout is the documented one')
})

ok('the manifest is checked key by key, and comes back in its canonical form', () => {
  const good = pack().manifest
  assert.equal(checkManifest(good).ok, true)
  assert.deepEqual(checkManifest(JSON.parse(JSON.stringify(good))).manifest, good)
  const bad = (change) => { const m = JSON.parse(JSON.stringify(good)); change(m); return checkManifest(m) }
  refused(bad((m) => { m.extra = 1 }), 'manifest')
  refused(bad((m) => { delete m.fingerprint }), 'manifest')
  refused(bad((m) => { m.db.extra = 1 }), 'manifest')
  refused(bad((m) => { m.db.id = 'not-a-ulid' }), 'manifest')
  refused(bad((m) => { m.db.id = '../../etc/passwd' }), 'manifest')
  refused(bad((m) => { m.db.name = '' }), 'manifest')
  refused(bad((m) => { m.db.name = 'x'.repeat(81) }), 'manifest')
  refused(bad((m) => { m.db.name = 'a\u0000b' }), 'manifest')
  refused(bad((m) => { m.db.size = -1 }), 'manifest')
  refused(bad((m) => { m.db.size = 1.5 }), 'manifest')
  refused(bad((m) => { m.db.size = '10' }), 'manifest')
  refused(bad((m) => { m.db.sha256 = 'ABC' }), 'manifest')
  refused(bad((m) => { m.fingerprint = 'a b' }), 'manifest')
  refused(bad((m) => { m.fingerprint = 'x'.repeat(65) }), 'manifest')
  refused(bad((m) => { m.blobs = {} }), 'manifest')
  refused(bad((m) => { m.blobs[0].hash = '../' + 'a'.repeat(61) }), 'manifest')
  refused(bad((m) => { m.blobs[0].hash = m.blobs[0].hash.toUpperCase() }), 'manifest')
  refused(bad((m) => { m.blobs[0].size = 26 * 1024 * 1024 }), 'manifest')
  refused(bad((m) => { m.blobs[0].name = 'evil.html' }), 'manifest')
  refused(bad((m) => { m.blobs.push({ hash: 'f'.repeat(64), size: 1, path: '/etc' }) }), 'manifest')
  refused(bad((m) => { m.blobs = Array.from({ length: MAX_BLOBS + 1 }, (_, i) => ({ hash: String(i).padStart(64, '0'), size: 1 })) }), 'manifest')
  refused(bad((m) => { m.format = 2 }), 'version')
  refused(checkManifest(null), 'manifest')
  refused(checkManifest([]), 'manifest')
  refused(checkManifest('x'), 'manifest')
  refused(bad((m) => { m.blobs.push({ ...m.blobs[1] }) }), 'duplicate')
  refused(bad((m) => { m.blobs.reverse() }), 'order')
})

ok('hostile input: not bytes, too big, too short, the wrong magic or version', () => {
  const p = pack().bytes
  refused(decodeBundle('KBAPPBND'), 'type')
  refused(decodeBundle(null), 'type')
  refused(decodeBundle({ length: 3 }), 'type')
  refused(decodeBundle(Buffer.alloc(0)), 'truncated')
  refused(decodeBundle(p.subarray(0, HEADER_BYTES - 1)), 'truncated')
  refused(decodeBundle(p, { maxBytes: p.length - 1 }), 'too-big')
  assert.equal(decodeBundle(p, { maxBytes: p.length }).ok, true)
  refused(decodeBundle(Buffer.concat([Buffer.from('NOTABNDL'), p.subarray(8)])), 'magic')
  refused(decodeBundle(Buffer.from('PK\u0003\u0004' + 'x'.repeat(100))), 'magic')
  refused(decodeBundle(hand({ version: 2 })), 'version')
  refused(decodeBundle(hand({ version: 0 })), 'version')
  refused(decodeBundle(hand({ version: 0xffffffff })), 'version')
})

ok('hostile input: a header that lies about the manifest', () => {
  refused(decodeBundle(hand({ length: 0xffffffff })), 'manifest-size')
  refused(decodeBundle(hand({ length: 4 * 1024 * 1024 + 1 })), 'manifest-size')
  refused(decodeBundle(hand({ length: 0 })), 'manifest-size')
  refused(decodeBundle(hand({ length: 1 })), 'manifest-size')
  refused(decodeBundle(hand({ length: pack().bytes.length })), 'truncated')
  refused(decodeBundle(hand({ length: 20 })), 'manifest')
  refused(decodeBundle(hand({ manifest: '{not json' })), 'manifest')
  refused(decodeBundle(hand({ manifest: '[]' })), 'manifest')
  refused(decodeBundle(hand({ manifest: '{"format":1}' })), 'manifest')
  const badUtf8 = hand({ manifest: 'xx' })
  badUtf8[HEADER_BYTES] = 0xff
  badUtf8[HEADER_BYTES + 1] = 0xfe
  refused(decodeBundle(badUtf8), 'manifest')
})

ok('hostile input: sizes that do not match the bytes (short, long, trailing)', () => {
  const p = pack().bytes
  refused(decodeBundle(p.subarray(0, p.length - 1)), 'truncated')
  refused(decodeBundle(p.subarray(0, HEADER_BYTES + 40)), 'truncated')
  refused(decodeBundle(p.subarray(0, HEADER_BYTES + p.readUInt32BE(12) + 100)), 'truncated')
  refused(decodeBundle(Buffer.concat([p, Buffer.from([0])])), 'trailing')
  refused(decodeBundle(Buffer.concat([p, p])), 'trailing')
  refused(decodeBundle(hand({ tail: Buffer.from('<?php') })), 'trailing')
  const lie = hand({}).toString('latin1')
  const m = JSON.parse(hand({}).subarray(HEADER_BYTES, HEADER_BYTES + hand({}).readUInt32BE(12)).toString())
  m.db.size += 10
  refused(decodeBundle(hand({ manifest: m })), 'truncated')
  m.db.size -= 20
  refused(decodeBundle(hand({ manifest: m })), 'trailing')
  assert.ok(lie.length > 0)
  const huge = JSON.parse(JSON.stringify(m)); huge.db.size = Number.MAX_SAFE_INTEGER
  refused(decodeBundle(hand({ manifest: huge })), 'manifest')
})

ok('hostile input: hashes that do not match, a blob listed twice, an out-of-order list', () => {
  const p = pack().bytes
  const flipAt = (i) => { const q = Buffer.from(p); q[i] ^= 1; return q }
  refused(decodeBundle(flipAt(p.length - 1)), 'hash') // the last blob
  refused(decodeBundle(flipAt(p.length - 1 - B.bytes.length - A.bytes.length + 2)), 'hash') // the first
  const dbAt = HEADER_BYTES + p.readUInt32BE(12)
  refused(decodeBundle(flipAt(dbAt + 5000 > p.length ? dbAt + 2000 : dbAt + 2000)), 'hash') // inside the sqlite bytes
  const q = Buffer.from(p); q[dbAt] = 0x58
  refused(decodeBundle(q), 'sqlite')
  const other = Buffer.from(SQLITE); other[20] ^= 1
  refused(decodeBundle(hand({ db: other, manifest: { format: 1, db: { id: ULID, name: 'Shop', size: SQLITE.length, sha256: sha256(SQLITE) }, fingerprint: '1.1.1.1', blobs: [] }, blobs: [] })), 'hash')
  const [x, y] = [A, B].sort((m, n) => (m.hash < n.hash ? -1 : 1))
  refused(decodeBundle(hand({ blobs: [x, x], manifest: { format: 1, db: { id: ULID, name: 'Shop', size: SQLITE.length, sha256: sha256(SQLITE) }, fingerprint: '1.1.1.1', blobs: [{ hash: x.hash, size: x.bytes.length }, { hash: x.hash, size: x.bytes.length }] } })), 'duplicate')
  refused(decodeBundle(hand({ blobs: [y, x], manifest: { format: 1, db: { id: ULID, name: 'Shop', size: SQLITE.length, sha256: sha256(SQLITE) }, fingerprint: '1.1.1.1', blobs: [{ hash: y.hash, size: y.bytes.length }, { hash: x.hash, size: x.bytes.length }] } })), 'order')
  // a blob whose bytes are another blob's: the name says one thing, the content another
  refused(decodeBundle(hand({ blobs: [{ hash: x.hash, bytes: y.bytes }], manifest: { format: 1, db: { id: ULID, name: 'Shop', size: SQLITE.length, sha256: sha256(SQLITE) }, fingerprint: '1.1.1.1', blobs: [{ hash: x.hash, size: y.bytes.length }] } })), 'hash')
  // a sqlite part that is not a SQLite file, with a hash that is honest about it
  const text = Buffer.concat([Buffer.from('this is not a database file at all'), Buffer.alloc(100)])
  refused(decodeBundle(hand({ db: text, blobs: [], manifest: { format: 1, db: { id: ULID, name: 'Shop', size: text.length, sha256: sha256(text) }, fingerprint: '1.1.1.1', blobs: [] } })), 'sqlite')
})

ok('the packer refuses what it must not write', () => {
  const db = { id: ULID, name: 'Shop', fingerprint: '1.1.1.1', bytes: SQLITE }
  refused(encodeBundle({}), 'type')
  refused(encodeBundle({ db: { ...db, bytes: 'text' } }), 'type')
  refused(encodeBundle({ db: { ...db, bytes: Buffer.from('nope') } }), 'sqlite')
  refused(encodeBundle({ db, blobs: [{ hash: A.hash, bytes: B.bytes }] }), 'hash')
  refused(encodeBundle({ db, blobs: [{ hash: 'nope', bytes: A.bytes }] }), 'hash')
  refused(encodeBundle({ db, blobs: [A, A] }), 'duplicate')
  refused(encodeBundle({ db: { ...db, id: 'x' } }), 'manifest')
  refused(encodeBundle({ db }, { maxBytes: 1000 }), 'manifest')
  refused(encodeBundle({ db, blobs: [A] }, { maxBytes: SQLITE.length + 100 }), 'too-big')
  assert.equal(DEFAULT_MAX_BYTES, 256 * 1024 * 1024)
})

// ── the disk half ──

const clockMs = () => { let t = Date.UTC(2026, 9, 31, 9, 0, 0); return () => (t += 1) }
const randomBytes = () => { let i = 0; return (len) => { i += 1; return Uint8Array.from({ length: len }, (_, k) => (i * 31 + k * 7 + 1) & 255) } }
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082', 'hex')

/** A live app with rows, a link, a saved view, a file, and a second file that only a deleted row holds. */
function liveApp (dir) {
  const svc = makeService({ dir, ports: { now: clockMs(), random: randomBytes() } })
  const made = svc.create({
    name: 'Shop',
    by: 'agent',
    objects: [
      { key: 'contact', label: 'Contacts', title: 'name', fields: [{ key: 'name', type: 'text', label: 'Name', required: true }, { key: 'photo', type: 'attachment', label: 'Photo' }] },
      { key: 'orders', label: 'Orders', title: 'ref', fields: [{ key: 'ref', type: 'text', label: 'Ref' }, { key: 'contact', type: 'relation', label: 'Contact', to: 'contact' }] },
    ],
  })
  assert.equal(made.ok, true, JSON.stringify(made))
  const db = made.db
  const file = db.attach(PNG, { name: 'ada.png', type: 'image/png' })
  const gone = db.attach(Buffer.from('a file of a deleted row'), { name: 'old.txt', type: 'text/plain' })
  const loose = db.attach(Buffer.from('a file no row holds'), { name: 'loose.txt', type: 'text/plain' })
  assert.ok(file.ok && gone.ok && loose.ok)
  const ada = db.create('contact', { name: 'Ada', photo: [file.file] }, 'agent')
  const old = db.create('contact', { name: 'Old', photo: [gone.file] }, 'agent')
  assert.ok(ada.ok && old.ok)
  assert.ok(db.create('orders', { ref: '#1', contact: ada.record.id }, 'agent').ok)
  assert.ok(db.remove('contact', old.record.id, 'agent').ok)
  assert.ok(db.saveView('orders', { id: 'all', name: 'All', kind: 'table' }, 'agent').ok)
  return { svc, db, file: file.file, gone: gone.file, loose: loose.file }
}

ok('a snapshot is taken with SQLite itself and describes one moment: the fingerprint, the file, the attachments the rows hold', () => {
  const app = liveApp(join(root, 'live'))
  const tmp = join(root, 'tmp')
  const snap = snapshotDb({ db: app.db, tmpDir: tmp })
  assert.equal(snap.id, app.db.info().id)
  assert.equal(snap.fingerprint, app.db.fingerprint())
  assert.equal(snap.name, 'Shop')
  assert.ok(existsSync(snap.file) && snap.file.startsWith(tmp))
  const bytes = readFileSync(snap.file)
  assert.equal(bytes.length, snap.size)
  assert.equal(sha256(bytes), snap.sha256)
  assert.ok(bytes.subarray(0, 16).equals(Buffer.from('SQLite format 3\0')))
  assert.deepEqual(snap.blobs.map((b) => b.hash).sort(), [app.file.hash, app.gone.hash].sort(), 'what the rows hold (a deleted row still holds its file), not what lies loose in blobs/')
  assert.equal(snap.blobs.find((b) => b.hash === app.file.hash).size, PNG.length)
  assert.deepEqual(snap.missing, [])
  assert.equal(readdirSync(tmp).length, 1, 'one file, no journal beside it')
  // the writer carries on while and after: the snapshot is the moment it was taken
  assert.ok(app.db.create('contact', { name: 'Later' }, 'agent').ok)
  assert.notEqual(app.db.fingerprint(), snap.fingerprint)
  const copy = new DatabaseSync(snap.file, { readOnly: true })
  assert.equal(copy.prepare('SELECT count(*) AS n FROM r_contact').get().n, 2, 'Ada and the deleted Old; not Later')
  copy.close()
  snap.dispose()
  assert.equal(existsSync(snap.file), false)
  app.svc.close()
})

ok('a snapshot of a snapshot is stable: nothing changed, the same fingerprint and the same bytes of rows', () => {
  const app = liveApp(join(root, 'live2'))
  const a = snapshotDb({ db: app.db, tmpDir: join(root, 'tmp2') })
  const b = snapshotDb({ db: app.db, tmpDir: join(root, 'tmp2') })
  assert.equal(a.fingerprint, b.fingerprint)
  assert.equal(a.sha256, b.sha256, 'VACUUM INTO of an unchanged db is the same file')
  assert.throws(() => app.db.backup(a.file), /exist|already/i, 'it never writes over a file')
  assert.throws(() => app.db.backup(''), /path/)
  a.dispose(); b.dispose()
  app.svc.close()
})

ok('a missing or damaged attachment is reported, not shipped', () => {
  const app = liveApp(join(root, 'live3'))
  rmSync(join(app.db.blobs.dir, app.gone.hash))
  writeFileSync(join(app.db.blobs.dir, app.file.hash), 'damaged')
  const snap = snapshotDb({ db: app.db, tmpDir: join(root, 'tmp3') })
  assert.deepEqual(snap.missing, [app.gone.hash])
  const packed = bundleOf(snap, app.db)
  assert.equal(packed.ok, true)
  assert.deepEqual(packed.missing.sort(), [app.file.hash, app.gone.hash].sort(), 'the damaged one is left out too')
  assert.deepEqual(packed.manifest.blobs, [])
  snap.dispose()
  app.svc.close()
})

ok('a bundle of a live app opens as the same app: the rows, the link, the view, the files, the fingerprint, a verified journal', () => {
  const app = liveApp(join(root, 'live4'))
  const snap = snapshotDb({ db: app.db, tmpDir: join(root, 'tmp4') })
  assert.deepEqual(manifestOf(snap).blobs, snap.blobs)
  const packed = bundleOf(snap, app.db)
  assert.equal(packed.ok, true, JSON.stringify(packed))
  const decoded = decodeBundle(packed.bytes)
  assert.equal(decoded.ok, true, JSON.stringify(decoded))
  const staged = stageBundle({ decoded, tmpRoot: join(root, 'stage4') })
  assert.equal(staged.ok, true, JSON.stringify(staged))
  assert.equal(staged.id, app.db.info().id)
  assert.deepEqual(readdirSync(staged.dir), [staged.id])
  assert.deepEqual(readdirSync(join(staged.folder, 'blobs')).sort(), [app.file.hash, app.gone.hash].sort())
  const opened = openDb(join(staged.folder, 'db.sqlite'))
  assert.equal(opened.ok, true)
  const copy = opened.db
  assert.equal(copy.fingerprint(), snap.fingerprint)
  assert.deepEqual(copy.list('contact', { deleted: true }), app.db.list('contact', { deleted: true }), 'every row, the deleted one too')
  assert.deepEqual(copy.list('orders'), app.db.list('orders'))
  assert.deepEqual(copy.listViews('orders'), app.db.listViews('orders'))
  assert.deepEqual(copy.objects(), app.db.objects())
  assert.deepEqual(copy.journal(), app.db.journal())
  assert.equal(copy.verify().ok, true, JSON.stringify(copy.verify()))
  assert.ok(copy.blobs.get(app.file.hash).equals(PNG))
  copy.close()
  discardStage(staged.dir)
  assert.equal(existsSync(staged.dir), false)
  snap.dispose()
  app.svc.close()
})

ok('staging refuses what is not the app it says it is, and leaves nothing behind', () => {
  const tmp = join(root, 'stage5')
  const left = () => (existsSync(tmp) ? readdirSync(tmp) : [])
  const app = liveApp(join(root, 'live5'))
  const snap = snapshotDb({ db: app.db, tmpDir: join(root, 'tmp5') })
  const good = decodeBundle(bundleOf(snap, app.db).bytes)
  assert.equal(good.ok, true)
  const withDb = (bytes, over = {}) => {
    const manifest = { ...good.manifest, db: { ...good.manifest.db, size: bytes.length, sha256: sha256(bytes), ...(over.db || {}) }, ...(over.top || {}) }
    return { ok: true, manifest, db: bytes, blobs: over.blobs ?? good.blobs }
  }
  const stage = (decoded) => stageBundle({ decoded, tmpRoot: tmp })

  refused(stage(null), 'invalid')
  refused(stage({ manifest: good.manifest, db: 'x', blobs: [] }), 'invalid')
  refused(stage(withDb(good.db, { blobs: [{ hash: '../x', bytes: Buffer.from('x') }] })), 'invalid')
  // the id or the name in the manifest is not the db's own
  refused(stage(withDb(good.db, { db: { id: '01J00000000000000000000000' } })), 'mismatch')
  refused(stage(withDb(good.db, { db: { name: 'Another' } })), 'mismatch')
  refused(stage(withDb(good.db, { top: { fingerprint: '9.9.9.9' } })), 'mismatch')
  // a file that is SQLite and is not a Kybernos db
  const plain = join(root, 'plain.sqlite')
  const h = new DatabaseSync(plain); h.exec('CREATE TABLE t (x); INSERT INTO t VALUES (1)'); h.close()
  refused(stage(withDb(readFileSync(plain))), 'not_a_db')
  // a SQLite header with nothing valid behind it
  const junk = Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(8000, 7)])
  refused(stage(withDb(junk)), 'corrupt')
  // a db written by a newer Kybernos
  const newer = join(root, 'newer.sqlite')
  writeFileSync(newer, good.db)
  const nh = new DatabaseSync(newer); nh.exec('PRAGMA user_version = 999'); nh.close()
  refused(stage(withDb(readFileSync(newer))), 'db_newer')
  assert.deepEqual(left(), [], 'every refusal removed its folder')
  snap.dispose()
  app.svc.close()
})

ok('the folder of a staged bundle opens through the service like any db', () => {
  const app = liveApp(join(root, 'live6'))
  const snap = snapshotDb({ db: app.db, tmpDir: join(root, 'tmp6') })
  const decoded = decodeBundle(bundleOf(snap, app.db).bytes)
  const staged = stageBundle({ decoded, tmpRoot: join(root, 'stage6') })
  const target = join(root, 'dbs6')
  mkdirSync(target)
  writeFileSync(join(target, 'unrelated'), '')
  const svc = makeService({ dir: staged.dir })
  assert.deepEqual(svc.list().map((d) => d.id), [staged.id])
  assert.equal(svc.byId(staged.id).db.info().name, 'Shop')
  svc.close()
  snap.dispose()
  app.svc.close()
  rmSync(staged.dir, { recursive: true, force: true })
})

console.log('\nkybernos-db remote: ' + count + ' checks passed')
