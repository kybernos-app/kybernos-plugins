// kybernos-registry: the registry of plugins (host half; the page half is client.js). It reads the data plugins installed on this computer, checks
// them, and gives the owner of an extension point what they contribute (docs/dev/plugin-contract.md). The rules are in registry.mjs and manifest.mjs
// (pure), the routes and the seam in host.mjs. No engine patch: a web-server route set and a global other bundles may reach.
import { ensureRegistry, mount } from './host.mjs'
export { ROUTES, SEAM, ensureRegistry } from './host.mjs'

export const name = 'kybernos-registry'

export function apply (ctx) {
  try {
    const registry = ensureRegistry()
    if (ctx.get('webServer') !== undefined) mount(ctx, ctx.get('webServer'), registry)
    else ctx.inject(['webServer'], (hostCtx) => mount(ctx, hostCtx.webServer, registry))
  } catch (e) { console.error('[kybernos-registry] disabled: ' + String((e && e.message) || e)) }
}
