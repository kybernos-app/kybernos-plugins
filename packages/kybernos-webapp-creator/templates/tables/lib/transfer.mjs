// transfer.mjs — the machine-to-machine door of a team space: how the owner's computer moves an app in and out and keeps a copy of it. Owner only, over http, no cookie.
//
//   Authorization: Bearer <owner API token>   signed with KB_BOOT_KEY, five minutes at most, minted fresh for each request (kybernos-db remote/token.mjs)
//
//   PUT  /api/apps/:slug/bundle              bring an app in from a bundle (a new slug, a db the space does not hold yet; nothing is left behind when it fails)
//   GET  /api/apps/:slug/fingerprint         { ok, fingerprint }: cheap, to know whether anything changed
//   GET  /api/apps/:slug/snapshot            the app as one bundle
//   GET  /api/apps/:slug/snapshot/manifest   the same, in pieces: what a bundle would hold (the fingerprint, the size and hash of the db, the attachments)…
//   GET  /api/apps/:slug/snapshot/db         …the SQLite file of that snapshot…
//   GET  /api/apps/:slug/blobs/:hash         …and one attachment, by the hash of what it holds
//   POST /api/apps/:slug/release             take the app out of the space ({ confirm: <slug> }): closes it and deletes its files, ends nothing else
//
// A bearer request acts as the owner on the apps routes (`/api/apps…`, `/api/me`) and nowhere else: the people routes and the password stay with a person's own session.
// It is exempt from Origin and CSRF, which defend a browser's ambient cookies and a bearer request has none, and from nothing else of the edge: rate limits per client address
// (a bad token counts against a tighter one), body limits, headers. A request that carries cookies as well is treated as cookie-authenticated whatever it says in
// `Authorization` (Origin and CSRF apply, the session decides who it is), and a bearer that does not verify is a 401 that never falls back to the cookies.
//
// This file owns the edge of that door and its routes; app.mjs mounts it with `edge`, `limitFor`, `ownerSession`, `mount` and `close`.
import { randomBytes } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, openSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { bodyLimit } from 'hono/body-limit'
import { isSlug } from './actor.mjs'
import { judgeBearer } from './bearer.mjs'
import { DEFAULT_MAX_BYTES, bearerOf, bundleOf, decodeBundle, discardStage, isHash, isUlid, manifestOf, snapshotDb, stageBundle } from './db.mjs'
import { makeLimiter } from './ratelimit.mjs'

const BUNDLE_PATH = /^\/api\/apps\/[^/]+\/bundle$/
const OCTET = 'application/octet-stream'
/** How long a snapshot made for a manifest stays on disk for the pieces that follow it. */
const SNAPSHOT_TTL_MS = 2 * 60 * 1000

/**
 * `{ apps (lib/apps.mjs), appsDir, tmpDir, bootKey (Buffer), store (lib/store.mjs), now, ipOf(c), tooMany(c, limiterAnswer), bundleMaxBytes?, log?, ports? }`.
 * `tmpDir` must be on the same file system as `appsDir` (an import is one `rename`) and outside it (a folder in `apps/` is an app); it is emptied at start and at close.
 */
export function makeTransfer ({ apps, appsDir, tmpDir, bootKey, store, now = Date.now, ipOf, tooMany, bundleMaxBytes = DEFAULT_MAX_BYTES, log = () => {}, ports = {} }) {
  rmSync(tmpDir, { recursive: true, force: true })
  mkdirSync(tmpDir, { recursive: true, mode: 0o700 })

  const limits = {
    any: makeLimiter({ max: 600, windowMs: 60 * 1000, now }),
    bad: makeLimiter({ max: 30, windowMs: 15 * 60 * 1000, now }),
  }
  const bundleLimit = bodyLimit({ maxSize: bundleMaxBytes, onError: (c) => c.json({ ok: false, error: 'too-large', maxBytes: bundleMaxBytes }, 413) })
  const noApp = (c) => c.json({ ok: false, error: 'unknown', message: 'no such app' }, 404)

  // ── the edge: who a request is, before anything reads its body ──
  const edge = async (c, next) => {
    const authorization = c.req.header('authorization')
    if (bearerOf(authorization) === null) return next()
    const ip = ipOf(c)
    const all = limits.any.hit(ip)
    if (!all.ok) return tooMany(c, all)
    const verdict = judgeBearer({ authorization, cookie: c.req.header('cookie'), path: c.req.path, key: bootKey, now })
    if (verdict.who === 'refused') {
      if (verdict.status === 401) {
        const bad = limits.bad.hit(ip)
        if (!bad.ok) return tooMany(c, bad)
        c.header('www-authenticate', 'Bearer')
        return c.json({ ok: false, error: verdict.error }, 401)
      }
      return c.json({ ok: false, error: verdict.error, reason: verdict.reason }, 403)
    }
    if (verdict.who === 'bearer') c.set('bearer', true) // 'cookie': the bearer is ignored, Origin and CSRF apply, the session says who it is
    return next()
  }

  /** The body limit of a route of this file that has its own, or null. */
  const limitFor = (path) => (BUNDLE_PATH.test(path) ? bundleLimit : null)

  /** The session a bearer request has: the owner. The owner's row may not exist yet (nobody has opened the first link): the token is what proves it. */
  const ownerSession = () => {
    const owner = store.owner()
    return { user: { id: owner === null ? 'owner-api' : owner.user_id, email: owner === null ? null : owner.email, name: 'Owner' }, member: owner, actor: { kind: 'person', role: 'owner' } }
  }

  // ── snapshots: one per app at most, kept for a couple of minutes so the pieces of one pull (manifest, db, blobs) describe the same moment ──
  const kept = new Map()
  const forget = (slug) => {
    const k = kept.get(slug)
    if (k === undefined) return
    clearTimeout(k.timer)
    k.snap.dispose()
    kept.delete(slug)
  }
  /** The snapshot of an app as it is now: the one kept when nothing changed since, else a new one. */
  const snapshotOf = (slug, db) => {
    const k = kept.get(slug)
    if (k !== undefined && k.snap.fingerprint === db.fingerprint()) {
      k.timer.refresh()
      return k.snap
    }
    forget(slug)
    const snap = snapshotDb({ db, tmpDir })
    const timer = setTimeout(() => forget(slug), SNAPSHOT_TTL_MS)
    timer.unref()
    kept.set(slug, { snap, timer })
    return snap
  }

  /** The app's one db: `{ slug, db }`, or an answer to send. */
  const dbOf = (c) => {
    const slug = c.req.param('slug')
    const service = isSlug(slug) ? apps.service(slug) : null
    if (service === null) return { res: noApp(c) }
    const found = (() => { try { return readdirSync(join(appsDir, slug)).filter(isUlid) } catch (e) { return [] } })()
    if (found.length === 0) return { res: c.json({ ok: false, error: 'unknown_db', message: 'the app holds no database' }, 404) }
    if (found.length > 1) return { res: c.json({ ok: false, error: 'which_db', message: 'the app holds several databases' }, 409) }
    const opened = service.byId(found[0])
    if (!opened.ok) return { res: c.json({ ok: false, error: opened.code, message: opened.message }, 500) }
    return { slug, db: opened.db }
  }

  const octet = (body, size, extra = {}) => new Response(body, { headers: { 'content-type': OCTET, 'content-length': String(size), 'cache-control': 'no-store', ...extra } })
  const dbIdInSpace = (id) => apps.slugs().some((slug) => existsSync(join(appsDir, slug, id)))
  const refused = (c, r) => c.json({ ok: false, error: 'invalid-bundle', code: r.code, message: r.message }, r.code === 'too-big' ? 413 : 400)

  function mount (app, { needMember, needOwner }) {
    const owner = [needMember, needOwner]

    app.put('/api/apps/:slug/bundle', ...owner, async (c) => {
      const slug = c.req.param('slug')
      if (!isSlug(slug)) return c.json({ ok: false, error: 'invalid', message: 'a slug is lower-case letters, digits and -, starting with a letter, at most 40 characters' }, 400)
      if ((c.req.header('content-type') ?? '').split(';')[0].trim().toLowerCase() !== OCTET) return c.json({ ok: false, error: 'unsupported-type', message: 'send the bundle as ' + OCTET }, 415)
      const dest = join(appsDir, slug)
      if (existsSync(dest)) return c.json({ ok: false, error: 'exists', message: 'there is already an app called ' + slug }, 409)
      const decoded = decodeBundle(Buffer.from(await c.req.arrayBuffer()), { maxBytes: bundleMaxBytes })
      if (!decoded.ok) return refused(c, decoded)
      // from here to the rename nothing awaits: the checks and the move are one stretch, so two imports of a slug or of a db cannot both pass
      if (existsSync(dest)) return c.json({ ok: false, error: 'exists', message: 'there is already an app called ' + slug }, 409)
      if (dbIdInSpace(decoded.manifest.db.id)) return c.json({ ok: false, error: 'db-exists', message: 'this database is already in the space, in another app' }, 409)
      const staged = stageBundle({ decoded, tmpRoot: tmpDir, ports })
      if (!staged.ok) return refused(c, staged)
      try { renameSync(staged.dir, dest) } catch (e) { discardStage(staged.dir); throw e }
      log('transfer: imported ' + slug + ' (db ' + staged.id + ')')
      return c.json({ ok: true, slug, db: { id: staged.id, name: staged.name }, fingerprint: staged.fingerprint }, 201)
    })

    app.get('/api/apps/:slug/fingerprint', ...owner, (c) => {
      const t = dbOf(c)
      return t.res ?? c.json({ ok: true, fingerprint: t.db.fingerprint() })
    })

    app.get('/api/apps/:slug/snapshot', ...owner, (c) => {
      const t = dbOf(c)
      if (t.res) return t.res
      const snap = snapshotOf(t.slug, t.db)
      const packed = bundleOf(snap, t.db, { maxBytes: bundleMaxBytes })
      if (!packed.ok) return packed.code === 'too-big' ? c.json({ ok: false, error: 'too-large', maxBytes: bundleMaxBytes, message: 'too big for one bundle: pull snapshot/manifest, snapshot/db and the blobs' }, 413) : c.json({ ok: false, error: 'server-error' }, 500)
      return octet(packed.bytes, packed.bytes.length, { 'x-kb-fingerprint': snap.fingerprint, ...(packed.missing.length > 0 ? { 'x-kb-missing': String(packed.missing.length) } : {}) })
    })

    app.get('/api/apps/:slug/snapshot/manifest', ...owner, (c) => {
      const t = dbOf(c)
      if (t.res) return t.res
      const snap = snapshotOf(t.slug, t.db)
      const manifest = manifestOf(snap, { maxBytes: Number.MAX_SAFE_INTEGER })
      return manifest.ok === false ? c.json({ ok: false, error: 'server-error' }, 500) : c.json({ ok: true, ...manifest, ...(snap.missing.length > 0 ? { missing: snap.missing.length } : {}) })
    })

    app.get('/api/apps/:slug/snapshot/db', ...owner, (c) => {
      const t = dbOf(c)
      if (t.res) return t.res
      const snap = snapshotOf(t.slug, t.db)
      // the file is opened here, not when the stream starts: a newer snapshot may remove it, and an open file stays readable
      const stream = createReadStream(snap.file, { fd: openSync(snap.file, 'r'), autoClose: true })
      return octet(Readable.toWeb(stream), snap.size, { 'x-kb-fingerprint': snap.fingerprint })
    })

    app.get('/api/apps/:slug/blobs/:hash', ...owner, (c) => {
      const t = dbOf(c)
      if (t.res) return t.res
      const hash = c.req.param('hash')
      if (!isHash(hash)) return c.json({ ok: false, error: 'invalid', message: 'a blob is named by the 64 hex characters of its SHA-256' }, 400)
      const bytes = t.db.blobs.get(hash)
      return bytes === null ? c.json({ ok: false, error: 'missing', message: 'no such file' }, 404) : octet(bytes, bytes.length)
    })

    app.post('/api/apps/:slug/release', ...owner, async (c) => {
      const slug = c.req.param('slug')
      if (!isSlug(slug) || !apps.has(slug)) return noApp(c)
      const body = await c.req.json().catch(() => null)
      if (body === null || typeof body !== 'object' || body.confirm !== slug) return c.json({ ok: false, error: 'confirm', message: 'send { "confirm": "' + slug + '" } to take the app out of the space' }, 400)
      forget(slug)
      apps.release(slug, join(tmpDir, 'released-' + randomBytes(6).toString('hex')))
      log('transfer: released ' + slug)
      return c.json({ ok: true, released: slug })
    })
  }

  return {
    edge,
    limitFor,
    ownerSession,
    mount,
    /** Drops the snapshots and empties the temporary folder. */
    close () {
      for (const slug of [...kept.keys()]) forget(slug)
      rmSync(tmpDir, { recursive: true, force: true })
    },
  }
}
