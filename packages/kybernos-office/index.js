// @local/kybernos-office, host half: the routes the Office editors talk to. The logic lives in office-host.mjs (disk, tested on a
// temporary folder) and office-guard.mjs / zip-lite.mjs (pure, tested on generated files); routes.mjs is the web layer with its guards.
import * as fsp from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createHost } from './office-host.mjs'
import { mountRoutes } from './routes.mjs'

export const name = 'kybernos-office'

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const dire = (msg) => console.log(`[kybernos-office] ${msg}`)

// What `register` hands back takes the route off again. Kept here and given to `ctx.effect` by `apply`, so that unloading the plugin
// removes every route it added (a hot reload would otherwise meet « duplicate route » and go on serving the OLD handlers).
const kbRetraits = []
const kbRetirerRoutes = () => { for (const retrait of kbRetraits.splice(0).reverse()) { try { retrait() } catch (e) { /* already gone */ } } }
/** `service` with a `register` that keeps the way to remove each route it adds (see kbRetirerRoutes). */
const kbSuivi = (service) => (service === null || service === undefined || typeof service.register !== 'function'
  ? service
  : new Proxy(service, { get: (target, key) => (key === 'register' ? (route) => { const retrait = target.register(route); if (typeof retrait === 'function') kbRetraits.push(retrait); return retrait } : (typeof target[key] === 'function' ? target[key].bind(target) : target[key])) }))

export function apply (ctx) {
  try {
    if (ctx !== null && ctx !== undefined && typeof ctx.effect === 'function') ctx.effect(() => kbRetirerRoutes, 'kybernos-office: routes')
    const host = createHost({ fs: fsp, home: DSH_HOME, userHome: homedir(), log: dire })
    const start = (webServer) => {
      try { mountRoutes(kbSuivi(webServer), host, { log: dire }) } catch (e) { dire(`routes not mounted: ${e?.message ?? e}`) }
    }
    const direct = ctx.get('webServer')
    if (direct !== undefined) start(direct)
    else ctx.inject(['webServer'], (h) => start(h.webServer))
  } catch (e) {
    console.log('[kybernos-office] disabled: ' + String(e?.message ?? e))
  }
}
