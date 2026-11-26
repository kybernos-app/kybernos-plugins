// The dbs an agent can reach: the folder of dbs (store/root.mjs) with the open ones kept, and the answer to « which db does this call mean ».
//
// One db is the common case, so a call that names none means the only one; with none the agent is told to create one, with several it is told which exist.
// A db that cannot be opened (a newer Kybernos wrote it, the file is damaged) is reported with its own code, never skipped silently.
// An archived db is put away: `list()` still lists it (with `archived`), but a call that names none never means it, `snapshot()` leaves it out, and a call that names it
// is told it is archived. Only an archived db can be deleted, and `ports.published(id)` (when the host has one) can refuse it while the app is still published.
//
// A PUBLISHED db (`ports.published(id)` true) is a read-only mirror of the hosted app: `byId` and `resolve` give a facade over it instead of the store's handle, built by
// `ports.facade(id, rawOf)` (remote/facade.mjs): reads from the mirror, row writes to the hosted app, a refusal for the rest. The handle itself is `raw(id)`, for the code that
// publishes and refreshes. `replaceMirror(id, folder)` swaps a freshly pulled, already checked copy in with two renames, in one synchronous stretch, closing the old handle first.
// A host with no `ports.published` is a host with only local dbs, which is what the hosted team space is.

import { randomBytes } from 'node:crypto'
import { existsSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { isUlid } from '../core/index.mjs'
import { openRegistry } from '../store/index.mjs'

const fail = (code, message) => ({ ok: false, code, message })

/** `dir` is the folder that holds the dbs; `ports` are the store's (`now`, `random`, `sqlite`). */
const TRASH = /^\.old-([0-9A-Z]{26})-[0-9a-f]{8}$/

/** A swap that was cut short by a crash left `.old-<id>-<hex>` beside the dbs: put the old copy back if the new one never arrived, else drop it. */
function recoverSwaps (dir) {
  let names = []
  try { names = readdirSync(dir) } catch (e) { return }
  for (const name of names) {
    const m = TRASH.exec(name)
    if (m === null) continue
    try {
      if (existsSync(join(dir, m[1]))) rmSync(join(dir, name), { recursive: true, force: true })
      else renameSync(join(dir, name), join(dir, m[1]))
    } catch (e) { /* left for the next start */ }
  }
}

export function makeService ({ dir, ports = {} }) {
  recoverSwaps(dir)
  const registry = openRegistry(dir, ports)
  const open = new Map()
  const facades = new Map()
  const isPublished = (id) => { try { return typeof ports.published === 'function' && ports.published(id) === true } catch (e) { return false } }

  /** The store's own handle on a db, opened once and kept. */
  const raw = (id) => {
    if (!isUlid(id)) return fail('unknown_db', 'no such database')
    if (open.has(id)) return { ok: true, db: open.get(id) }
    const r = registry.open(id)
    if (!r.ok) return fail(r.code === 'missing' ? 'unknown_db' : r.code, r.code === 'missing' ? 'no such database' : r.message)
    open.set(id, r.db)
    // files nothing holds any more are taken once per process and db, when it is first opened (never inside a write); a mirror holds exactly what the hosted app does
    if (!isPublished(id)) { try { r.db.gc() } catch (e) { /* a collector that fails leaves the files where they are */ } }
    return r
  }
  /** What a call means by this id: the handle, or for a published db the facade over its mirror. */
  const byId = (id) => {
    const r = raw(id)
    if (!r.ok || !isPublished(id) || typeof ports.facade !== 'function') return r
    let f = facades.get(id)
    if (f === undefined) {
      try { f = ports.facade(id, () => raw(id)) } catch (e) { f = null }
      if (f === null || f === undefined) return r
      facades.set(id, f)
    }
    return { ok: true, db: f }
  }
  const ids = () => { try { return readdirSync(dir).filter(isUlid).sort() } catch (e) { return [] } }

  return {
    dir,
    /** The dbs on disk: `[{ id, name, format, created, file }]`, oldest first. */
    list: () => registry.list(),
    byId,
    /** The store's own handle, even for a published db: for the code that publishes it and refreshes its mirror. */
    raw,
    /**
     * Swaps a pulled copy in for a published db's mirror: `folder` is `<staging>/<id>/` (db.sqlite and blobs/), on the same file system as the dbs. The open handle is closed first;
     * the old folder is renamed aside, the new one renamed in, the old one removed. If the second rename fails the first is undone. `{ ok: true }`, or `{ ok: false, code: 'swap', message }`
     * with the mirror as it was.
     */
    replaceMirror (id, folder) {
      if (!isUlid(id)) return fail('unknown_db', 'no such database')
      const live = join(dir, id)
      const trash = join(dir, '.old-' + id + '-' + randomBytes(4).toString('hex'))
      const handle = open.get(id)
      if (handle !== undefined) { try { handle.close() } catch (e) { /* already closed */ } open.delete(id) }
      try { renameSync(live, trash) } catch (e) { return fail('swap', 'the copy of this app could not be replaced') }
      try { renameSync(folder, live) } catch (e) {
        try { renameSync(trash, live) } catch (e2) { /* recoverSwaps puts it back at the next start */ }
        return fail('swap', 'the copy of this app could not be replaced')
      }
      try { rmSync(trash, { recursive: true, force: true }) } catch (e) { /* removed at the next start */ }
      return { ok: true }
    },
    /** The db a call means: the one it names, else the only live one there is. An archived db is not a target: it is restored first. */
    resolve (id) {
      if (id !== undefined && id !== null) {
        const r = byId(id)
        return r.ok && r.db.info().archived !== null ? fail('archived', 'This database is archived: restore it first (db_restore).') : r
      }
      const all = registry.list().filter((d) => d.archived === null)
      if (all.length === 0) return fail('no_db', 'There is no database yet: create one with db_create first.')
      if (all.length > 1) return fail('which_db', 'There are several databases: pass `db` with one of these ids: ' + all.map((d) => d.id + ' (' + d.name + ')').join(', ') + '.')
      return byId(all[0].id)
    },
    create (def) {
      const r = registry.create(def)
      if (r.ok) open.set(r.db.info().id, r.db)
      return r
    },
    /** Closes a db and removes its folder: for a db that was only half made (an installer that failed), never for one a person has used. */
    discard (id) {
      if (!isUlid(id) || isPublished(id)) return
      const db = open.get(id)
      if (db !== undefined) { try { db.close() } catch (e) { /* already closed */ } open.delete(id) }
      rmSync(join(dir, id), { recursive: true, force: true })
    },
    /** Puts a db away (hidden, read-only): `{ ok: true, applied }`. */
    archive (id, by) {
      const r = byId(id)
      return r.ok ? r.db.archive(by) : r
    },
    /** Brings an archived db back. */
    unarchive (id) {
      const r = byId(id)
      return r.ok ? r.db.unarchive() : r
    },
    /** Deletes an archived db for good, with its files: `{ ok: true }`. Codes: unknown_db, not-archived, published (the host says the app is still published). */
    remove (id) {
      if (!isUlid(id)) return fail('unknown_db', 'no such database')
      const found = registry.list().find((d) => d.id === id)
      if (found === undefined) return fail('unknown_db', 'no such database')
      if (found.archived === null) return fail('not-archived', 'archive the app first: only an archived app can be deleted')
      if (typeof ports.published === 'function' && ports.published(id) === true) return fail('published', 'the app is still published: unpublish it first')
      const db = open.get(id)
      if (db !== undefined) { try { db.close() } catch (e) { /* already closed */ } open.delete(id) }
      facades.delete(id)
      return registry.remove(id)
    },
    /** What the prompt says about the dbs: `[{ id, name, version, objects }]`. A db that does not open is left out (db_list says why). */
    snapshot () {
      const out = []
      for (const id of ids()) {
        const r = byId(id)
        if (!r.ok) continue
        try { const info = r.db.info(); if (info.archived !== null) continue; out.push({ id, name: info.name, version: info.version, objects: r.db.objects(), ...(r.db.published === true ? { published: true } : {}) }) } catch (e) { /* a db that fails here is reported by db_list */ }
      }
      return out
    },
    close () {
      for (const db of open.values()) { try { db.close() } catch (e) { /* already closed */ } }
      open.clear()
    },
  }
}
