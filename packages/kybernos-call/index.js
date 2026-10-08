// ═══════════════════════════════════════════════════════
// kybernos-call: host half.
//
// Voice (and, later, face) calls from any chat session. The logic lives in call-host.mjs and
// call-routes.mjs (testable without DSH); this file only plugs them into DSH's web server.
//
// Everything in apply() is guarded: an error here must never stop DSH from starting.
// No @deepseek-ai/* import (an @local/… plugin does not resolve them).
// ═══════════════════════════════════════════════════════
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCall } from './call-host.mjs'
import { mountCallRoutes } from './call-routes.mjs'

export const name = 'kybernos-call'

const say = (message) => console.log('[kybernos-call] ' + message)

export function apply (ctx) {
  try {
    const pluginDir = dirname(fileURLToPath(import.meta.url))
    const call = createCall({ pluginDir })
    const effect = (fn, label) => ctx.effect(fn, label)
    const mount = (webServer) => {
      try { mountCallRoutes(webServer, call, pluginDir, effect); say('routes mounted') } catch (e) { say('routes not mounted: ' + String(e && e.message ? e.message : e)) }
    }
    if (ctx.get('webServer') !== undefined) mount(ctx.get('webServer'))
    else ctx.inject(['webServer'], (host) => mount(host.webServer))
  } catch (e) {
    say('disabled: ' + String(e && e.message ? e.message : e))
  }
}
