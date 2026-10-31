// install.mjs — puts an app in the team space: a copy of a db folder (`<dbs>/<db id>/`, as kybernos-db keeps it) under `<data>/apps/<slug>/`. For the local run and the tests;
// a hosted space is filled by `PUT /api/apps/:slug/bundle` (lib/transfer.mjs). Plain file work, no kybernos-db.
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { isSlug } from './actor.mjs'

/** `{ ok: true }` or `{ ok: false, error }`. Never overwrites an app. */
export function installApp (appsDir, slug, source) {
  if (!isSlug(slug)) return { ok: false, error: 'a slug is lower-case letters, digits and -, starting with a letter' }
  const target = join(appsDir, slug)
  if (existsSync(target)) return { ok: false, error: 'there is already an app called ' + slug }
  if (!existsSync(join(source, 'db.sqlite'))) return { ok: false, error: 'not a db folder: no db.sqlite in ' + source }
  mkdirSync(appsDir, { recursive: true, mode: 0o700 })
  cpSync(source, join(target, basename(source)), { recursive: true })
  return { ok: true }
}
