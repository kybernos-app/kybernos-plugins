// kybernos-guard — host entry: deterministic Pass 1 security guard for DSH tools.
// Never stops DSH from starting; every hook and route disposes cleanly on unload.
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createGuardEngine, mountGuardHooks, mountRoutes, publishGuardSeam } from './guard-host.mjs'

export const name = 'kybernos-guard'

const guardDir = () => join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'kybernos', 'guard')

export function apply (ctx) {
  try {
    const engine = createGuardEngine({ dir: guardDir() })
    publishGuardSeam(engine)

    const startHooks = () => mountGuardHooks(ctx, engine)
    if (ctx !== null && ctx !== undefined && typeof ctx.effect === 'function') {
      ctx.effect(startHooks, 'kybernos-guard: tool hooks')
    } else {
      startHooks()
    }

    const startRoutes = (webServer) => {
      if (webServer === undefined || webServer === null || typeof webServer.register !== 'function') return () => {}
      try {
        const off = mountRoutes(webServer, engine)
        console.log('[kybernos-guard] active (mode: ' + engine.getSettings().mode + ', routes /kybernos-guard/* mounted)')
        return off
      } catch (e) {
        console.log('[kybernos-guard] routes not mounted: ' + String(e && e.message ? e.message : e))
        return () => {}
      }
    }

    if (ctx !== null && ctx !== undefined) {
      const ws = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined
      if (ws !== undefined) {
        if (typeof ctx.effect === 'function') ctx.effect(() => startRoutes(ws), 'kybernos-guard: routes')
        else startRoutes(ws)
      } else if (typeof ctx.inject === 'function') {
        ctx.inject(['webServer'], (host) => {
          const s = host && typeof host.get === 'function' ? host.get('webServer') : (host && host.webServer)
          if (typeof host.effect === 'function') host.effect(() => startRoutes(s), 'kybernos-guard: routes')
          else startRoutes(s)
        })
      }
    }
    return { engine }
  } catch (e) {
    console.log('[kybernos-guard] disabled: ' + String(e && e.message ? e.message : e))
    return null
  }
}
