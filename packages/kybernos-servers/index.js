// kybernos-servers: add a Kybernos server from its address, switch between servers, rename and remove them (host half; the page is client.js).
// The routes are in host.mjs, the rules in discovery.mjs and registry.mjs (pure). No engine patch: a web-server route set and a Settings page.
import { mount } from './host.mjs'
export { ROUTES, sameOriginStrict, status, check, add, switchTo, rename, remove } from './host.mjs'

export const name = 'kybernos-servers'

export function apply (ctx) {
  try {
    if (ctx.get('webServer') !== undefined) mount(ctx, ctx.get('webServer'))
    else ctx.inject(['webServer'], (hostCtx) => mount(ctx, hostCtx.webServer))
  } catch (e) { console.error('[kybernos-servers] routes not mounted: ' + String((e && e.message) || e)) }
}
