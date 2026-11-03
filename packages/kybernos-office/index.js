// @local/kybernos-office, host half: the routes the Office editors talk to. The logic lives in office-host.mjs (disk, tested on a
// temporary folder) and office-guard.mjs / zip-lite.mjs (pure, tested on generated files); routes.mjs is the web layer with its guards.
import { existsSync } from 'node:fs'
import * as fsp from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { deliverTool, writeCard } from './deliver.mjs'
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

// `defineTool` lives in DSH's own `dsh-tools`, which a plugin of ours cannot import by name: it is looked for where the profile and the global install keep it.
const DEFINE_TOOL_CANDIDATES = [
  join(DSH_HOME, 'profiles', 'web', 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js'),
  '/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js',
  '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js'
]
async function loadDefineTool () {
  for (const path of DEFINE_TOOL_CANDIDATES) {
    if (!existsSync(path)) continue
    try {
      const mod = await import(path)
      if (typeof mod?.defineTool === 'function') return mod.defineTool
    } catch (e) { dire(`defineTool unreadable from ${path}: ${e?.message ?? e}`) }
  }
  return undefined
}

/** What `defineTool` is given, and what it produces when it cannot be found (the shape it makes on dsh-tools 0.1.7). */
const toDefinition = (o) => ({ name: o.name, description: o.description, parameters: o.parameters, output: { schema: { type: 'json' }, render: (args, value) => o.render(args, value) }, execute: o.execute })
const literalDefinition = (o) => ({ name: o.name, description: o.description, parameters: { type: 'object', properties: o.parameters }, output: { schema: {}, render: (args, value) => o.render(args, value) }, execute: o.execute })

/**
 * The `deliver_files` tool and the observer that writes the card. Every service is read at call time with `get` (a property read of a service this plugin did not inject throws), and
 * nothing here may stop DSH from starting: a missing service or a refusal is logged and the editors go on without the tool.
 */
export function mountDeliver (ctx) {
  const wanted = ['tools', 'fs', 'agents', 'workingDirectory']
  const start = (c) => {
    try {
      const get = (n) => c.get(n)
      if (wanted.some((n) => get(n) === undefined)) { dire('deliver_files not registered: a DSH service is missing'); return }
      const tool = deliverTool(() => ({ fs: get('fs'), agents: get('agents'), workingDirectory: get('workingDirectory') }))
      loadDefineTool().then((defineTool) => {
        try { get('tools').register(defineTool !== undefined ? defineTool(toDefinition(tool.options)) : literalDefinition(tool.options)) } catch (e) { dire(`deliver_files not registered: ${e?.message ?? e}`) }
      }).catch((e) => dire(`deliver_files not registered: ${e?.message ?? e}`))
      ctx.on('tools/result', (exec, result) => { try { writeCard(tool.pending, exec, result) } catch (e) { dire(`card not written: ${e?.message ?? e}`) } })
    } catch (e) { dire(`deliver_files not registered: ${e?.message ?? e}`) }
  }
  if (wanted.every((n) => ctx.get(n) !== undefined)) start(ctx)
  else ctx.inject(wanted, start)
}

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
    try { mountDeliver(ctx) } catch (e) { dire(`deliver_files not registered: ${e?.message ?? e}`) }
  } catch (e) {
    console.log('[kybernos-office] disabled: ' + String(e?.message ?? e))
  }
}
