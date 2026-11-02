// kybernos-multi-device — host half: the private-folder route. Never stops DSH from starting.
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { documentsDir, monterRoutes } from './multi-device-host.mjs'

export const name = 'kybernos-multi-device'

const xdgDocuments = () => {
  try { return String(execFileSync('xdg-user-dir', ['DOCUMENTS'], { timeout: 1500, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).trim() } catch (e) { return null }
}

export function apply (ctx) {
  try {
    const deps = {
      home: () => homedir(),
      documents: () => documentsDir({ platform: platform(), home: homedir(), env: process.env, xdgDocuments }),
      mkdir: (path, opts) => { mkdirSync(path, opts) },
    }
    const mount = (webServer) => {
      try { monterRoutes(webServer, deps); console.log('[kybernos-multi-device] routes mounted') } catch (e) { console.log('[kybernos-multi-device] routes not mounted: ' + String(e && e.message ? e.message : e)) }
    }
    if (ctx.get('webServer') !== undefined) mount(ctx.get('webServer'))
    else ctx.inject(['webServer'], (host) => mount(host.webServer))
  } catch (e) {
    console.log('[kybernos-multi-device] disabled: ' + String(e && e.message ? e.message : e))
  }
}
