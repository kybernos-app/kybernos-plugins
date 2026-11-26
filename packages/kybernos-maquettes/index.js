// @local/kybernos-maquettes, host half: the routes the Maquettes page talks to. The logic lives in maquette-host.mjs (disk, tested on a
// temporary folder) and maquette-lib.mjs (pure patching, tested on generated pages); routes.mjs is the web layer with its guards.
import { readFileSync } from 'node:fs'
import * as fsp from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHost } from './maquette-host.mjs'
import { mountRoutes } from './routes.mjs'

export const name = 'kybernos-maquettes'

const here = dirname(fileURLToPath(import.meta.url))
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const dire = (msg) => console.log(`[kybernos-maquettes] ${msg}`)

/** The editor script the sandboxed page loads, read from disk when first asked (a bundle that cannot read it still starts). */
let editorText = null
export const editorScript = () => {
  if (editorText === null) editorText = readFileSync(join(here, 'editor', 'ky-edit.js'), 'utf8')
  return editorText
}

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
    if (ctx !== null && ctx !== undefined && typeof ctx.effect === 'function') ctx.effect(() => kbRetirerRoutes, 'kybernos-maquettes: routes')
    const host = createHost({ fs: fsp, home: DSH_HOME, userHome: homedir(), log: dire })
    const start = (webServer) => {
      try { mountRoutes(kbSuivi(webServer), host, { editorScript, log: dire }) } catch (e) { dire(`routes not mounted: ${e?.message ?? e}`) }
    }
    const direct = ctx.get('webServer')
    if (direct !== undefined) start(direct)
    else ctx.inject(['webServer'], (h) => start(h.webServer))
  } catch (e) {
    console.log('[kybernos-maquettes] disabled: ' + String(e?.message ?? e))
  }
}
