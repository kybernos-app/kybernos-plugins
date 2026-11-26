// kybernos-registry: the registry of plugins (host half; the page half is client.js). It reads the data plugins installed on this computer, checks
// them, and gives the owner of an extension point what they contribute (docs/dev/plugin-contract.md). The rules are in registry.mjs and manifest.mjs
// (pure), the routes and the seam in host.mjs. No engine patch: a web-server route set and a global other bundles may reach.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureRegistry, mount } from './host.mjs'
import { dshHome } from './session-guard.mjs'
import { seedSkills } from './seed-skills.mjs'
export { ROUTES, SEAM, ensureRegistry } from './host.mjs'

export const name = 'kybernos-registry'
/** The skill this plugin ships: it lets the AI prepare a data plugin as a draft (skills/plugin-creator/SKILL.md). Seeded into <DSH home>/skills, never over a file the person edited. */
export const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'skills')
export const SEEDED_SKILLS = ['plugin-creator']

export function apply (ctx) {
  try {
    for (const r of seedSkills({ home: dshHome(), sourceDir: SKILLS_DIR, names: SEEDED_SKILLS })) {
      if (r.error) console.error('[kybernos-registry] skill ' + r.name + ': ' + r.error)
    }
  } catch (e) { console.error('[kybernos-registry] skills not seeded: ' + String((e && e.message) || e)) }
  try {
    const registry = ensureRegistry()
    if (ctx.get('webServer') !== undefined) mount(ctx, ctx.get('webServer'), registry)
    else ctx.inject(['webServer'], (hostCtx) => mount(ctx, hostCtx.webServer, registry))
  } catch (e) { console.error('[kybernos-registry] disabled: ' + String((e && e.message) || e)) }
}
