// Test helper (not a test: the name starts with "lib-" and ends in "test"). An in-memory team space: the same calls as remote/space.mjs's client, answered over REAL store dbs in a
// temporary folder, with the same checks the hosted app makes (a bundle is decoded and staged before it is kept, a snapshot is the db's own backup). Knobs to break it on purpose:
// `down` (nothing answers), `failNext(method, answer)`, `before(method, fn)` (a hook that runs just before a call answers: a write that comes in between two calls of a pull).
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { makeService } from './agent/service.mjs'
import { makeApi } from './api.mjs'
import { isUlid } from './core/index.mjs'
import { decodeBundle } from './remote/bundle.mjs'
import { manifestOf, snapshotDb, stageBundle } from './remote/snapshot.mjs'
import { hexKey, signToken, verifyToken } from './remote/token.mjs'

export const SPACE_URL = 'https://team.example.test'
export const SPACE_KEY = 'ab'.repeat(32)
const SLUG = /^[a-z][a-z0-9-]{0,39}$/
const DOWN = { ok: false, code: 'unreachable', message: 'The web app could not be reached.' }
const doorToStore = (r) => (r.ok === true ? r : { ok: false, code: r.error, message: r.message, ...(Array.isArray(r.errors) ? { errors: r.errors } : {}) })

export function fakeSpace ({ root, ports = {} }) {
  const appsDir = join(root, 'apps')
  const tmp = join(root, 'tmp')
  mkdirSync(appsDir, { recursive: true })
  mkdirSync(tmp, { recursive: true })
  const apps = new Map() // slug → { service, api, id }
  const kept = new Map() // slug → snapshot
  const hooks = new Map()
  const queued = new Map()
  const space = { down: false, calls: [], url: SPACE_URL, bootKey: SPACE_KEY }

  const open = (slug) => {
    const dir = join(appsDir, slug)
    const service = makeService({ dir, ports })
    const id = readdirSync(dir).filter(isUlid)[0]
    const entry = { service, api: makeApi({ service, ports: { today: () => '2026-10-31' } }), id }
    apps.set(slug, entry)
    return entry
  }
  const entryOf = (slug) => {
    if (apps.has(slug)) return apps.get(slug)
    if (SLUG.test(slug) && existsSync(join(appsDir, slug))) return open(slug)
    return null
  }
  const snapOf = (e, slug) => {
    const k = kept.get(slug)
    const db = e.service.byId(e.id).db
    if (k !== undefined && k.fingerprint === db.fingerprint()) return k
    if (k !== undefined) k.dispose()
    const snap = snapshotDb({ db, tmpDir: tmp })
    kept.set(slug, snap)
    return snap
  }
  /** Every method goes through here: records the call, may be down, may be made to fail once, may run a hook first. */
  const gate = (method, fn) => async (...args) => {
    space.calls.push(method)
    if (hooks.has(method)) { const h = hooks.get(method); hooks.delete(method); await h(...args) }
    if (space.down) return DOWN
    if (queued.has(method)) { const a = queued.get(method); queued.delete(method); return a }
    return fn(...args)
  }
  const unknown = { ok: false, code: 'unknown', message: 'no such app', status: 404 }

  Object.assign(space, {
    appsDir,
    slugs: () => [...readdirSync(appsDir)],
    has: (slug) => existsSync(join(appsDir, slug)),
    /** The hosted db, as the hosted app's own service opens it. */
    dbOf: (slug) => { const e = entryOf(slug); return e === null ? null : e.service.byId(e.id).db },
    /** A write on the hosted side that does not go through the owner's door (a member, another session). */
    writeInside: (slug, fn) => fn(space.dbOf(slug)),
    failNext: (method, answer) => queued.set(method, answer),
    before: (method, fn) => hooks.set(method, fn),
    close: () => { for (const e of apps.values()) e.service.close(); for (const s of kept.values()) s.dispose(); apps.clear(); kept.clear() },

    fingerprint: gate('fingerprint', async (slug) => { const e = entryOf(slug); return e === null ? unknown : { ok: true, fingerprint: e.service.byId(e.id).db.fingerprint() } }),
    manifest: gate('manifest', async (slug) => { const e = entryOf(slug); if (e === null) return unknown; const m = manifestOf(snapOf(e, slug), { maxBytes: Number.MAX_SAFE_INTEGER }); return { ok: true, manifest: m } }),
    snapshotDb: gate('snapshotDb', async (slug) => { const e = entryOf(slug); if (e === null) return unknown; const snap = snapOf(e, slug); return { ok: true, bytes: readFileSync(snap.file), fingerprint: snap.fingerprint } }),
    blob: gate('blob', async (slug, hash) => { const e = entryOf(slug); if (e === null) return unknown; const bytes = e.service.byId(e.id).db.blobs.get(hash); return bytes === null ? { ok: false, code: 'missing', message: 'no such file', status: 404 } : { ok: true, bytes } }),
    putBundle: gate('putBundle', async (slug, bytes) => {
      if (!SLUG.test(slug)) return { ok: false, code: 'invalid', message: 'bad slug' }
      if (existsSync(join(appsDir, slug))) return { ok: false, code: 'exists', message: 'there is already an app called ' + slug, status: 409 }
      const decoded = decodeBundle(Buffer.from(bytes))
      if (!decoded.ok) return { ok: false, code: 'invalid-bundle', message: decoded.message, status: 400 }
      for (const other of readdirSync(appsDir)) if (existsSync(join(appsDir, other, decoded.manifest.db.id))) return { ok: false, code: 'db-exists', message: 'already in the space', status: 409 }
      const staged = stageBundle({ decoded, tmpRoot: tmp })
      if (!staged.ok) return { ok: false, code: 'invalid-bundle', message: staged.message, status: 400 }
      renameSync(staged.dir, join(appsDir, slug))
      return { ok: true, slug, fingerprint: staged.fingerprint }
    }),
    release: gate('release', async (slug) => {
      if (!SLUG.test(slug) || !existsSync(join(appsDir, slug))) return unknown
      const e = apps.get(slug)
      if (e !== undefined) { e.service.close(); apps.delete(slug) }
      const k = kept.get(slug); if (k !== undefined) { k.dispose(); kept.delete(slug) }
      rmSync(join(appsDir, slug), { recursive: true, force: true })
      return { ok: true }
    }),
    write: gate('write', async (slug, body) => { const e = entryOf(slug); return e === null ? unknown : doorToStore(e.api.write({ object: body.object, op: body.op, id: body.id, values: body.values })) }),
    upload: gate('upload', async (slug, q) => { const e = entryOf(slug); return e === null ? unknown : doorToStore(e.api.upload(q)) }),
    openLink: () => space.url + '/open?t=' + encodeURIComponent(signToken('open', { n: randomBytes(16).toString('base64url') }, hexKey(space.bootKey), { ttlSec: 600 })),
  })
  space.verifyOpenLink = (link) => verifyToken('open', decodeURIComponent(new URL(link).searchParams.get('t')), hexKey(space.bootKey))
  return space
}

/** A hosting port that hands back the fake space, with the facts a card shows. */
export function fakeHosting (space, extra = {}) {
  const calls = []
  const h = {
    calls,
    available: () => true,
    describe: () => ({ name: 'Kybernos team space', pricePerMonth: 7.3, currency: 'USD', alwaysOn: true, region: 'EU', budget: { label: 'Cloud budget', remaining: 3, enough: true } }),
    ensureSpace: async (arg) => { calls.push(arg); return { ok: true, space: { id: 'space-1', url: space.url, bootKey: space.bootKey } } },
    ...extra,
  }
  return h
}
