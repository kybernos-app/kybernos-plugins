// The folder that holds a person's dbs: `<dir>/<id>/db.sqlite`, with the db's attachments in `<dir>/<id>/blobs/`. The folders ARE the registry (there is no second
// list to fall out of step with them): a db is listed by reading its own `meta` table. The caller picks `dir` (the engine plugin uses `<DSH home>/kybernos/dbs`).
//
// A db id is a ULID, and nothing else is ever joined to a path: an id from a tool call or a link cannot walk out of `dir`.

import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { isPlain, isUlid } from '../core/index.mjs'
import { createDb, openDb } from './db.mjs'
import { APPLICATION_ID } from './schema.mjs'
import { BUSY_MS, sqliteOf } from './sqlite.mjs'
import { makeUlid } from './ulid.mjs'

export const dbFile = (dir, id) => join(dir, id, 'db.sqlite')

const badId = () => ({ ok: false, code: 'invalid', message: 'a db id is a ULID', errors: [{ path: 'id', code: 'id', message: 'a db id is a ULID' }] })

/** What a db file says about itself without opening it for writing, or null when it is not a Kybernos db. */
function peek (lib, file) {
  if (!existsSync(file)) return null
  let handle = null
  try {
    handle = new lib.DatabaseSync(file, { readOnly: true })
    handle.exec('PRAGMA busy_timeout = ' + BUSY_MS)
    if (Number(handle.prepare('PRAGMA application_id').get().application_id) !== APPLICATION_ID) return null
    const format = Number(handle.prepare('PRAGMA user_version').get().user_version)
    const meta = Object.fromEntries(handle.prepare('SELECT k, v FROM meta').all().map((r) => [r.k, r.v]))
    return { id: meta.id, name: meta.name, format, created: { by: meta.created_by, at: meta.created_at }, archived: meta.archived_at === undefined ? null : { by: meta.archived_by, at: meta.archived_at }, file }
  } catch (e) {
    return null
  } finally {
    try { if (handle !== null) handle.close() } catch (e) { /* already closed */ }
  }
}

/** The dbs in `dir`. `ports` are the db's (`now`, `random`, `sqlite`). */
export function openRegistry (dir, ports = {}) {
  const now = typeof ports.now === 'function' ? ports.now : Date.now
  const random = typeof ports.random === 'function' ? ports.random : (n) => randomBytes(n)
  const nextId = makeUlid({ now, random })
  return {
    dir,
    /** A new db with a new id (or the `id` given): `{ ok: true, db }`, see `createDb`. */
    create (def) {
      const given = isPlain(def) ? def.id : undefined
      const id = given === undefined ? nextId() : given
      if (!isUlid(id)) return badId()
      return createDb(dbFile(dir, id), isPlain(def) ? { ...def, id } : def, ports)
    },
    open: (id) => (isUlid(id) ? openDb(dbFile(dir, id), ports) : badId()),
    /** `[{ id, name, format, created: { by, at }, archived: { by, at } | null, file }]`, oldest first. A folder that holds no db is skipped. */
    list () {
      const lib = sqliteOf(ports)
      if (lib === null) return []
      let names
      try { names = readdirSync(dir) } catch (e) { return [] }
      return names.filter(isUlid).sort().map((id) => peek(lib, dbFile(dir, id))).filter((info) => info !== null)
    },
    /**
     * Deletes a db for good, its folder and its attachments with it: `{ ok: true }`. Only a db that was archived first (the caller closes its own handle before): `missing`, `not-archived`.
     */
    remove (id) {
      if (!isUlid(id)) return badId()
      const lib = sqliteOf(ports)
      const info = lib === null ? null : peek(lib, dbFile(dir, id))
      if (info === null) return { ok: false, code: 'missing', message: 'no such db' }
      if (info.archived === null) return { ok: false, code: 'not-archived', message: 'archive the app first: only an archived app can be deleted' }
      rmSync(join(dir, id), { recursive: true, force: true })
      return { ok: true }
    },
  }
}
