// apps.mjs — the apps of the team space: one folder per app under `<data>/apps/<slug>/`, which is a folder of dbs in kybernos-db's own layout (`<slug>/<db id>/db.sqlite`),
// holding the one app. Each is opened on first use with its own service and its own door (`api.as(actor)` decides every answer).
//
// How an app gets there (the publish) is not this file's business: it only reads the folder (lib/install.mjs copies one in, for the local run).
import { existsSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { isSlug } from './actor.mjs'
import { makeApi, makeService } from './db.mjs'

export function makeApps ({ dir, today, ports = {} }) {
  const open = new Map()

  const slugs = () => { try { return readdirSync(dir).filter((n) => isSlug(n) && statSync(join(dir, n)).isDirectory()).sort() } catch (e) { return [] } }
  const entry = (slug) => {
    if (!isSlug(slug) || !existsSync(join(dir, slug))) return null
    if (!open.has(slug)) {
      const service = makeService({ dir: join(dir, slug), ports })
      open.set(slug, { service, api: makeApi({ service, ports: { today } }) })
    }
    return open.get(slug)
  }

  return {
    slugs,
    has: (slug) => entry(slug) !== null,
    /** The service of an app (the store behind its door), for the owner's transfer routes (lib/transfer.mjs); null when there is no such app. */
    service: (slug) => entry(slug)?.service ?? null,
    /**
     * Takes an app out of the space: closes its handles and removes its folder (renamed out of `apps/` to `trash` first when given, so a half-removed app is never listed).
     * True when there was one.
     */
    release (slug, trash) {
      if (!isSlug(slug) || !existsSync(join(dir, slug))) return false
      const e = open.get(slug)
      if (e !== undefined) { e.service.close(); open.delete(slug) }
      if (trash === undefined) rmSync(join(dir, slug), { recursive: true, force: true })
      else { renameSync(join(dir, slug), trash); rmSync(trash, { recursive: true, force: true }) }
      return true
    },
    /** The door of an app for an actor (`api.as(actor)`), or null when there is no such app. */
    door: (slug, actor) => entry(slug)?.api.as(actor) ?? null,
    /** The profiles the apps define, by id: `[{ id, label, apps: [slug] }]`. An app that does not open is left out. */
    roles () {
      const by = new Map()
      for (const slug of slugs()) {
        const e = entry(slug)
        const r = e.service.resolve(undefined)
        if (!r.ok) continue
        for (const p of r.db.profiles()) {
          if (!by.has(p.id)) by.set(p.id, { id: p.id, label: p.label, apps: [] })
          by.get(p.id).apps.push(slug)
        }
      }
      return [...by.values()].sort((a, b) => a.id.localeCompare(b.id))
    },
    close () { for (const e of open.values()) e.service.close(); open.clear() },
  }
}
