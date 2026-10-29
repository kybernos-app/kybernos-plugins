// The read routes of the three Business plugins, answered by their real logic over a real shared base seeded with a shipped theme's sample rows: what the Dashboards
// page would read from a DSH where that theme is installed, with no server and no browser. For tests and the live check's cross-checks; hermetic (a temp folder only).
//
//   const world = openWorld({ themeDir, now })       // seeds a base, installs the theme in a temp profile, tells every point to the real registry
//   world.fetch({ method, path, body? })             // the JSON a route answers (a round trip through JSON, like a fetch)
//   const table = readTable(model, world, source, now)   // what the page does for one widget: the plan, the second round, the table
//   world.close()
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { createBusinessBase } from '../packages/kybernos-plugin/business-base.mjs'
import { DOMAIN_POINT, TEAM_POINT, AUTOMATION_POINT } from '../packages/kybernos-plugin/domain-pack.mjs'
import { THEME_POINT } from '../packages/kybernos-theme/themes-catalogue.mjs'
import { CONTACTS_POINT } from '../packages/kybernos-contacts/contacts-schema.mjs'
import { CATALOG_POINT } from '../packages/kybernos-catalog/catalog-type.mjs'
import { PIPELINE_POINT } from '../packages/kybernos-pipeline/pipeline-flow.mjs'
import { PRESET_POINT } from '../packages/kybernos-dashboards/preset-point.mjs'
import { createCatalog } from '../packages/kybernos-catalog/catalog-core.mjs'
import { createApi } from '../packages/kybernos-contacts/contacts-api.mjs'
import { schemaFrom } from '../packages/kybernos-contacts/contacts-words.mjs'
import { createPipelineHost } from '../packages/kybernos-pipeline/pipeline-host.mjs'
import { createRegistry } from '../packages/kybernos-registry/registry.mjs'
import { OWNER_VALIDATORS } from './plugin-check.mjs'

/** The skills point, as its owner tells it (the object is private to that plugin; plugin-check keeps the same adapter). */
const SKILL_POINT = { owner: 'kybernos/skills', ownerVersion: '1.0.0', name: 'skill', version: '1.0', kind: 'data', class: 'instruction', files: 'folder', max: 32, validate: OWNER_VALIDATORS['kybernos/skills#skill'] }
export const ALL_POINTS = [DOMAIN_POINT, TEAM_POINT, AUTOMATION_POINT, THEME_POINT, SKILL_POINT, CONTACTS_POINT, CATALOG_POINT, PIPELINE_POINT, PRESET_POINT]

export function openWorld ({ themeDir, now, points = ALL_POINTS }) {
  const dir = mkdtempSync(join(tmpdir(), 'kb-bizdash-'))
  const base = createBusinessBase({ file: join(dir, 'donnees.sqlite'), now: () => now })
  const sample = JSON.parse(readFileSync(join(themeDir, 'demo', 'sample.json'), 'utf8'))
  const seeded = base.seed(sample, { theme: 'kybernos-themes/' + basename(themeDir) })
  if (seeded.ok !== true) throw new Error('the sample did not seed: ' + JSON.stringify(seeded))
  // the theme installed in a profile the real registry reads (the photographs stay behind: no media is needed to read a dashboard)
  const profileDir = join(dir, 'profile')
  const pkgName = '@kybernos-themes/' + basename(themeDir)
  const folder = join(profileDir, 'node_modules', ...pkgName.split('/'))
  mkdirSync(folder, { recursive: true })
  cpSync(themeDir, folder, { recursive: true, filter: (src) => !/[\\/]photos([\\/]|$)/.test(src) && !src.endsWith('cover.jpg') })
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ dependencies: { [pkgName]: '1.0.0' }, dsh: { profile: { bundles: [pkgName] } } }))
  const registry = createRegistry({ profileDir, stateFile: join(dir, 'state.json'), kybernosVersion: '0.1.1', ttlMs: 0 })
  for (const p of points) registry.definePoint(p)
  const plugin = registry.plugins().find((p) => p.package === pkgName)
  if (plugin !== undefined && plugin.status === 'needs-consent') registry.setConsent(plugin.id, true)

  const catalog = createCatalog({ base: () => base, registry: () => registry })
  const contacts = createApi({ base: () => base, schema: () => schemaFrom(registry) })
  const pipeline = createPipelineHost({ business: () => base, registry: () => registry })
  const route = (req) => {
    const u = new URL(req.path, 'http://127.0.0.1')
    const q = u.searchParams
    switch (u.pathname) {
      case '/kybernos-catalog/types': return catalog.types()
      case '/kybernos-catalog/list': return catalog.list({ q: '', type: q.get('type') || '', status: '', archived: '', limit: q.get('limit'), offset: q.get('offset') })
      case '/kybernos-contacts/schema': return contacts.schema()
      case '/kybernos-contacts/list': return contacts.list({ limit: q.get('limit') || undefined, offset: q.get('offset') || undefined })
      case '/kybernos-pipeline/flows': return pipeline.flows()
      case '/kybernos-pipeline/board': return pipeline.board({ flow: q.get('flow') || '' })
      default: return { ok: false, error: 'no such route in this world: ' + u.pathname }
    }
  }
  return {
    registry, base, sample, dir, plugin: () => registry.plugins().find((p) => p.package === pkgName) || null,
    fetch: (req) => JSON.parse(JSON.stringify(route(req))),
    close: () => { try { base.close() } catch (e) { /* closed */ } rmSync(dir, { recursive: true, force: true }) },
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
