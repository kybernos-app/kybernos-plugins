// The dbs an agent can reach: the folder of dbs (store/root.mjs) with the open ones kept, and the answer to « which db does this call mean ».
//
// One db is the common case, so a call that names none means the only one; with none the agent is told to create one, with several it is told which exist.
// A db that cannot be opened (a newer Kybernos wrote it, the file is damaged) is reported with its own code, never skipped silently.

import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { isUlid } from '../core/index.mjs'
import { openRegistry } from '../store/index.mjs'

const fail = (code, message) => ({ ok: false, code, message })

/** `dir` is the folder that holds the dbs; `ports` are the store's (`now`, `random`, `sqlite`). */
export function makeService ({ dir, ports = {} }) {
  const registry = openRegistry(dir, ports)
  const open = new Map()

  const byId = (id) => {
    if (!isUlid(id)) return fail('unknown_db', 'no such database')
    if (open.has(id)) return { ok: true, db: open.get(id) }
    const r = registry.open(id)
    if (!r.ok) return fail(r.code === 'missing' ? 'unknown_db' : r.code, r.code === 'missing' ? 'no such database' : r.message)
    open.set(id, r.db)
    // files nothing holds any more are taken once per process and db, when it is first opened (never inside a write)
    try { r.db.gc() } catch (e) { /* a collector that fails leaves the files where they are */ }
    return r
  }
  const ids = () => { try { return readdirSync(dir).filter(isUlid).sort() } catch (e) { return [] } }

  return {
    dir,
    /** The dbs on disk: `[{ id, name, format, created, file }]`, oldest first. */
    list: () => registry.list(),
    byId,
    /** The db a call means: the one it names, else the only one there is. */
    resolve (id) {
      if (id !== undefined && id !== null) return byId(id)
      const all = registry.list()
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
      if (!isUlid(id)) return
      const db = open.get(id)
      if (db !== undefined) { try { db.close() } catch (e) { /* already closed */ } open.delete(id) }
      rmSync(join(dir, id), { recursive: true, force: true })
    },
    /** What the prompt says about the dbs: `[{ id, name, version, objects }]`. A db that does not open is left out (db_list says why). */
    snapshot () {
      const out = []
      for (const id of ids()) {
        const r = byId(id)
        if (!r.ok) continue
        try { const info = r.db.info(); out.push({ id, name: info.name, version: info.version, objects: r.db.objects() }) } catch (e) { /* a db that fails here is reported by db_list */ }
      }
      return out
    },
    close () {
      for (const db of open.values()) { try { db.close() } catch (e) { /* already closed */ } }
      open.clear()
    },
  }
}
