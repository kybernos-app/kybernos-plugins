// kybernos-usage — host half: the ledger on disk and its routes. Never stops DSH from starting.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { createStore, mountRoutes } from './usage-host.mjs'

export const name = 'kybernos-usage'

const ledgerPath = () => join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'kybernos', 'usage', 'ledger.json')

export function apply (ctx) {
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
      try { mountRoutes(webServer, store); console.log('[kybernos-usage] routes mounted') } catch (e) { console.log('[kybernos-usage] routes not mounted: ' + String(e && e.message ? e.message : e)) }
    }
    if (ctx.get('webServer') !== undefined) mount(ctx.get('webServer'))
    else ctx.inject(['webServer'], (host) => mount(host.webServer))
  } catch (e) {
    console.log('[kybernos-usage] disabled: ' + String(e && e.message ? e.message : e))
  }
}
