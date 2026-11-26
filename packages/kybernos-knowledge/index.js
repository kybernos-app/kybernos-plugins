// kybernos-knowledge — host entry: local document index, Markdown wiki,
// Kaby tools (`knowledge_search`, `knowledge_list`), system prompt brief,
// guarded HTTP routes, and runtime seam for `kybernos-front-desk`.
// Never stops DSH from starting; every hook, tool, and route disposes cleanly.

import { join } from 'node:path'
import { dshHome } from './session-guard.mjs'
import { createKnowledgeStore } from './knowledge-store.mjs'
import { renderBrief } from './knowledge-brief.mjs'
import { registerKnowledgeTools } from './knowledge-tools.mjs'
import { mountRoutes, publishKnowledgeSeam } from './knowledge-host.mjs'

export const name = 'kybernos-knowledge'

const say = (msg) => console.log('[kybernos-knowledge] ' + msg)
const why = (e) => String(e && e.message ? e.message : e)

export function apply (ctx) {
  try {
    const home = dshHome()
    const store = createKnowledgeStore({ dir: join(home, 'kybernos', 'knowledge') })
    const unpublish = publishKnowledgeSeam(store)

    if (ctx !== null && ctx !== undefined && typeof ctx.effect === 'function') {
      ctx.effect(() => unpublish, 'kybernos-knowledge: seam')
    }

    // Kaby brief — empty string until at least one collection is indexed.
    try {
      if (ctx !== null && ctx !== undefined && typeof ctx.inject === 'function') {
        ctx.inject(['systemPrompt'], (scope) => {
          try {
            const sp = typeof scope.get === 'function' ? scope.get('systemPrompt') : scope.systemPrompt
            if (sp && typeof sp.context === 'function') {
              sp.context({ name: 'kybernos:knowledge', order: 9150, text: () => renderBrief(() => store.listCollections()) })
            }
          } catch (e) { say('prompt brief not registered: ' + why(e)) }
        })
      }
    } catch (e) { say('prompt brief skipped: ' + why(e)) }

    const startRoutes = (webServer) => {
      if (!webServer || typeof webServer.register !== 'function') return () => {}
      try {
        const off = mountRoutes(webServer, store)
        say('routes /kybernos-knowledge/* mounted (' + store.listCollections().length + ' collection(s))')
        return off
      } catch (e) {
        say('routes not mounted: ' + why(e))
        return () => {}
      }
    }

    const startTools = (tools) => {
      if (!tools || typeof tools.register !== 'function') return
      registerKnowledgeTools(tools, store, home, say).catch((e) => say('tools not registered: ' + why(e)))
    }

    if (ctx !== null && ctx !== undefined) {
      const ws = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined
      const tools = typeof ctx.get === 'function' ? ctx.get('tools') : undefined
      if (ws !== undefined) {
        if (typeof ctx.effect === 'function') ctx.effect(() => startRoutes(ws), 'kybernos-knowledge: routes')
        else startRoutes(ws)
      } else if (typeof ctx.inject === 'function') {
        ctx.inject(['webServer'], (host) => {
          const s = host && typeof host.get === 'function' ? host.get('webServer') : (host && host.webServer)
          if (typeof host.effect === 'function') host.effect(() => startRoutes(s), 'kybernos-knowledge: routes')
          else startRoutes(s)
        })
      }
      if (tools !== undefined) {
        startTools(tools)
      } else if (typeof ctx.inject === 'function') {
        ctx.inject(['tools'], (host) => {
          const t = host && typeof host.get === 'function' ? host.get('tools') : (host && host.tools)
          startTools(t)
        })
      }
    }

    return { store }
  } catch (e) {
    say('disabled: ' + why(e))
    return null
  }
}
