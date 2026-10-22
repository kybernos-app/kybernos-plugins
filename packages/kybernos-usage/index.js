// kybernos-usage — host half: the ledger on disk and its routes. Never stops DSH from starting.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { createStore, mountRoutes } from './usage-host.mjs'

export const name = 'kybernos-usage'

const ledgerPath = () => join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'kybernos', 'usage', 'ledger.json')

// What `register` hands back takes the route off again. It is kept here and given to `ctx.effect` by `apply`, so that unloading the plugin removes every route it
// added: without it a hot reload met « duplicate exact route », logged « routes not mounted » and went on serving the OLD handlers (audit L4-05, L6-04).
const kbRetraits = []
const kbRetirerRoutes = () => { for (const retrait of kbRetraits.splice(0).reverse()) { try { retrait() } catch (e) { /* already gone */ } } }
/** `service` with a `register` that keeps the way to remove each route it adds (see kbRetirerRoutes). */
const kbSuivi = (service) => (service === null || service === undefined || typeof service.register !== 'function'
  ? service
  : new Proxy(service, { get: (target, key) => (key === 'register' ? (route) => { const retrait = target.register(route); if (typeof retrait === 'function') kbRetraits.push(retrait); return retrait } : (typeof target[key] === 'function' ? target[key].bind(target) : target[key])) }))

export function apply (ctx) {
  if (ctx !== null && ctx !== undefined && typeof ctx.effect === 'function') ctx.effect(() => kbRetirerRoutes, 'kybernos-usage: routes')
  try {
    const file = ledgerPath()
    const store = createStore({
      read: () => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch (e) { return null } },
      write: (ledger) => {
        mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
        const tmp = file + '.tmp-' + process.pid
        writeFileSync(tmp, JSON.stringify(ledger), { mode: 0o600 })
        renameSync(tmp, file)
      },
    })
    const mount = (webServer) => {
      try { mountRoutes(kbSuivi(webServer), store); console.log('[kybernos-usage] routes mounted') } catch (e) { console.log('[kybernos-usage] routes not mounted: ' + String(e && e.message ? e.message : e)) }
    }
    if (ctx.get('webServer') !== undefined) mount(ctx.get('webServer'))
    else ctx.inject(['webServer'], (host) => mount(host.webServer))
  } catch (e) {
    console.log('[kybernos-usage] disabled: ' + String(e && e.message ? e.message : e))
  }
}
