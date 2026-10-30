// What the Dashboards page would read from a DSH where a shipped template is installed, with no server and no browser: the template's database is made in a temp
// Tables service (kybernos-db) with its sample rows, answered by the bundle's own api, and the theme is installed in a temp profile the real registry reads.
// For tests and the live checks' cross-checks; hermetic (a temp folder only).
//
//   const world = openWorld({ themeDir, now })       // makes the database, installs the theme in a temp profile, tells every point to the real registry
//   world.fetch({ method, path, body? })             // the JSON a route answers (a round trip through JSON, like a fetch)
//   const table = readTable(model, world, source, now)   // what the page does for one widget: the plan, the second round, the table
//   world.close()
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { makeService } from '../packages/kybernos-db/agent/service.mjs'
import { makeApi } from '../packages/kybernos-db/api.mjs'
import { MARKER_FILE, installTemplate, readMarkers } from '../packages/kybernos-db/instantiate.mjs'
import { dayKey } from '../packages/kybernos-dashboards/model.mjs'
import { DOMAIN_POINT, TEAM_POINT, AUTOMATION_POINT } from '../packages/kybernos-plugin/domain-pack.mjs'
import { THEME_POINT } from '../packages/kybernos-theme/themes-catalogue.mjs'
import { CONTACTS_POINT } from '../packages/kybernos-contacts/contacts-schema.mjs'
import { CATALOG_POINT } from '../packages/kybernos-catalog/catalog-type.mjs'
import { PIPELINE_POINT } from '../packages/kybernos-pipeline/pipeline-flow.mjs'
import { PRESET_POINT } from '../packages/kybernos-dashboards/preset-point.mjs'
import { createRegistry } from '../packages/kybernos-registry/registry.mjs'
import { OWNER_VALIDATORS } from './plugin-check.mjs'

/** The skills point, as its owner tells it (the object is private to that plugin; plugin-check keeps the same adapter). */
const SKILL_POINT = { owner: 'kybernos/skills', ownerVersion: '1.0.0', name: 'skill', version: '1.0', kind: 'data', class: 'instruction', files: 'folder', max: 32, validate: OWNER_VALIDATORS['kybernos/skills#skill'] }
export const ALL_POINTS = [DOMAIN_POINT, TEAM_POINT, AUTOMATION_POINT, THEME_POINT, SKILL_POINT, CONTACTS_POINT, CATALOG_POINT, PIPELINE_POINT, PRESET_POINT]

/**
 * `also`: the folders of other templates installed in the same profile, their databases in the same service (the owner's DSH holds several at once).
 * `sample: false`: the databases are made without their sample rows (the person cleared them).
 */
export function openWorld ({ themeDir, now, also = [], points = ALL_POINTS, sample = true }) {
  const dir = mkdtempSync(join(tmpdir(), 'kb-bizdash-'))
  const service = makeService({ dir: join(dir, 'tables', 'dbs') })
  const api = makeApi({ service, ports: { today: () => dayKey(now), markers: () => readMarkers(join(dir, 'tables', MARKER_FILE)) } })
  // the theme installed in a profile the real registry reads (the photographs stay behind: no media is needed to read a dashboard)
  const profileDir = join(dir, 'profile')
  const names = []
  for (const folderOf of [themeDir, ...also]) {
    const id = basename(folderOf)
    const rows = sample ? JSON.parse(readFileSync(join(folderOf, 'demo', 'db-sample.json'), 'utf8')) : undefined
    const made = installTemplate({ service, template: JSON.parse(readFileSync(join(folderOf, 'db', id + '.json'), 'utf8')), sample: rows, lang: 'en', markerFile: join(dir, 'tables', MARKER_FILE) })
    if (made.ok !== true) throw new Error('the template did not install: ' + JSON.stringify(made))
    const name = '@kybernos-themes/' + id
    const folder = join(profileDir, 'node_modules', ...name.split('/'))
    mkdirSync(folder, { recursive: true })
    cpSync(folderOf, folder, { recursive: true, filter: (src) => !/[\\/]photos([\\/]|$)/.test(src) && !src.endsWith('cover.jpg') })
    names.push(name)
  }
  const pkgName = names[0]
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ dependencies: Object.fromEntries(names.map((n) => [n, '1.0.0'])), dsh: { profile: { bundles: names } } }))
  const registry = createRegistry({ profileDir, stateFile: join(dir, 'state.json'), kybernosVersion: '0.1.1', ttlMs: 0 })
  for (const p of points) registry.definePoint(p)
  for (const p of registry.plugins()) if (p.status === 'needs-consent') registry.setConsent(p.id, true)

  const route = (req) => {
    const u = new URL(req.path, 'http://127.0.0.1')
    switch (u.pathname) {
      case '/kybernos-db/state': return api.state()
      case '/kybernos-db/records': return api.records(Object.fromEntries(u.searchParams))
      default: return { ok: false, error: 'no such route in this world: ' + u.pathname }
    }
  }
  return {
    registry, service, dir, plugin: () => registry.plugins().find((p) => p.package === pkgName) || null,
    fetch: (req) => JSON.parse(JSON.stringify(route(req))),
    close: () => { try { service.close() } catch (e) { /* closed */ } rmSync(dir, { recursive: true, force: true }) },
  }
}

/** What the Dashboards page does to read one widget's source: the plan, then the second round it asks for, then the table. `fail` lists the paths that answered ok:false. */
export function readTable (M, world, source, now) {
  const parts = {}
  const asked = []
  for (const req of M.planFor(source, now)) { asked.push(req.path); parts[req.key] = world.fetch(req) }
  for (const req of M.planNext(source, parts, now)) { asked.push(req.path); parts[req.key] = world.fetch(req) }
  const t = M.buildTable(source, parts, now)
  t.asked = asked
  return t
}
