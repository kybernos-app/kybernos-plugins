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
import { createAdmin } from './call-admin.mjs'
import { createCall } from './call-host.mjs'
import { mountCallRoutes } from './call-routes.mjs'
import { createServices } from './call-services.mjs'
import { createSpeechFeed } from './speech-feed.mjs'
import { createStore } from './call-store.mjs'

export const name = 'kybernos-call'

const say = (message) => console.log('[kybernos-call] ' + message)

export function apply (ctx) {
  try {
    const pluginDir = dirname(fileURLToPath(import.meta.url))
    // One brain: the call speaks what the session's assistant writes. The host sees every session event;
    // without that event source (an engine that does not offer it) a call keeps the worker's own voice model.
    let feed = null
    try {
      if (typeof ctx.on === 'function') {
        const candidate = createSpeechFeed()
        ctx.on('session/event', (session, event) => { try { candidate.ingest(session && session.id, event) } catch (e) { /* never break a session */ } })
        feed = candidate
      }
    } catch (e) { feed = null; say('session events not followed: ' + String(e && e.message ? e.message : e)) }
    const store = createStore()
    const call = createCall({ pluginDir, feed, store })
    const admin = createAdmin({ store, services: createServices(), call })
    const effect = (fn, label) => ctx.effect(fn, label)
    const mount = (webServer) => {
      try { mountCallRoutes(webServer, call, pluginDir, effect, feed, admin); say('routes mounted' + (feed === null ? ' (the worker answers with its own voice model)' : '')) } catch (e) { say('routes not mounted: ' + String(e && e.message ? e.message : e)) }
    }
    if (ctx.get('webServer') !== undefined) mount(ctx.get('webServer'))
    else ctx.inject(['webServer'], (host) => mount(host.webServer))
  } catch (e) {
    say('disabled: ' + String(e && e.message ? e.message : e))
  }
}
