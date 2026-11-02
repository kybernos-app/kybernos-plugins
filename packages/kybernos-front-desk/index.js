// @local/kybernos-front-desk, host half: starts and watches the front-desk service (service/), shows its Atelier and Inbox pages through guarded routes,
// and gives Kaby the `front_desk` tool, its approval card, a short prompt block and the skill that drives them.
//
// The service is the public face of a shop: it runs apart from Kaby, with its own model key and data folder, behind a closed action menu and blocking budget
// caps (service/core). This file only wires DSH to it; the logic is in fd-*.mjs (pure, tested over fakes). Everything in apply() is guarded: an error
// here must never stop DSH from starting. No @deepseek-ai/* import (an @local/… plugin does not resolve them).
//
// Switching the plugin off (or DSH quitting) stops the service; `autostart` brings it back at the next start. A service orphaned by a crash is adopted, not duplicated.
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createConfigStore, dshHome } from './fd-config.mjs'
import { createSupervisor } from './fd-supervisor.mjs'
import { mountRoutes } from './fd-routes.mjs'
import { createServiceCall, createToolHost, TOOL } from './fd-tools.mjs'
import { renderBrief } from './fd-brief.mjs'
import { seedSkills } from './seed-skills.mjs'

export const name = 'kybernos-front-desk'

const say = (message) => console.log('[kybernos-front-desk] ' + message)
const why = (e) => String(e && e.message ? e.message : e)
export const SEEDED_SKILLS = ['front-desk-fiche']

// ── tool registration (same recipe as the other tool-carrying bundles) ───────────────────────────────────────────────────────────────────────
const candidates = (home) => [
  join(home, 'profiles', 'web', 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js'),
  '/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js',
  '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tools/lib/index.js',
]
async function loadDefineTool (home) {
  for (const file of candidates(home)) {
    if (!existsSync(file)) continue
    try {
      const m = await import(file)
      if (typeof m?.defineTool === 'function') return m.defineTool
    } catch (e) { say('defineTool unreadable from ' + file + ': ' + why(e)) }
  }
  return undefined
}
/** The exact shape defineTool produces, for when dsh-tools cannot be imported. */
export const literalDefinition = (o) => ({ name: o.name, description: o.description, parameters: { type: 'object', properties: o.parameters }, output: { schema: {}, render: (args, value) => o.render(args, value) }, execute: o.execute })
export const specDefinition = (o) => ({ name: o.name, description: o.description, parameters: o.parameters, output: { schema: { type: 'json' }, render: (args, value) => o.render(args, value) }, execute: o.execute })

export async function registerTool (tools, toolHost, home) {
  const options = toolHost.toolOptions()
  const defineTool = await loadDefineTool(home)
  tools.register(defineTool !== undefined ? defineTool(specDefinition(options)) : literalDefinition(options))
  say('tool "' + TOOL + '" registered')
}

// What `register` hands back takes the route off again; `apply` gives it to `ctx.effect` so that unloading the plugin removes every route it added.
const kbRetraits = []
const kbRetirerRoutes = () => { for (const retrait of kbRetraits.splice(0).reverse()) { try { retrait() } catch (e) { /* already gone */ } } }
const kbSuivi = (service) => (service === null || service === undefined || typeof service.register !== 'function'
  ? service
  : new Proxy(service, { get: (target, key) => (key === 'register' ? (route) => { const retrait = target.register(route); if (typeof retrait === 'function') kbRetraits.push(retrait); return retrait } : (typeof target[key] === 'function' ? target[key].bind(target) : target[key])) }))

export function apply (ctx) {
  try {
    const pluginDir = dirname(fileURLToPath(import.meta.url))
    const home = dshHome()
    const config = createConfigStore({ home })
    const supervisor = createSupervisor({ config, serviceDir: join(pluginDir, 'service'), log: say })
    const toolHost = createToolHost({ call: createServiceCall({ getTarget: () => supervisor.target() }) })

    if (ctx !== null && ctx !== undefined && typeof ctx.effect === 'function') {
      ctx.effect(() => kbRetirerRoutes, 'kybernos-front-desk: routes')
      ctx.effect(() => () => { supervisor.stop().catch(() => {}) }, 'kybernos-front-desk: service')
    }

    try {
      for (const r of seedSkills({ home, sourceDir: join(pluginDir, 'skills'), names: SEEDED_SKILLS })) {
        if (r.action === 'created' || r.action === 'updated') say('skill ' + r.name + ' ' + r.action)
        else if (r.action === 'error' || r.action === 'no-source' || r.action === 'invalid-name') say('skill ' + r.name + ' not installed: ' + (r.error !== undefined ? r.error : r.action))
      }
    } catch (e) { say('skills not seeded: ' + why(e)) }

    // Kaby is told about the front desk only once one is set up.
    try {
      ctx.inject(['systemPrompt'], (scope) => {
        try { scope.systemPrompt.context({ name: 'kybernos:front-desk', order: 9100, text: () => renderBrief(() => config.ready().ok) }) } catch (e) { say('prompt block not registered: ' + why(e)) }
      })
    } catch (e) { say('prompt block not registered: ' + why(e)) }

    // The owner's approval before publishing, restoring or throwing a draft away: the engine's own (`tools/pre-execute`).
    try {
      if (typeof ctx.on === 'function') {
        const off = ctx.on('tools/pre-execute', async (exec, next) => { const gate = await toolHost.approvalGate(exec); return gate === null ? next() : gate })
        if (typeof off === 'function' && typeof ctx.effect === 'function') ctx.effect(() => off, 'kybernos-front-desk: approval gate')
      }
    } catch (e) { say('approval gate not registered: ' + why(e)) }

    const start = (c) => {
      const tools = c.get('tools')
      const webServer = c.get('webServer')
      if (tools !== undefined) registerTool(tools, toolHost, home).catch((e) => say('tool not registered: ' + why(e)))
      if (webServer !== undefined) {
        try { mountRoutes(kbSuivi(webServer), { supervisor, config, log: say }); say('routes mounted') } catch (e) { say('routes not mounted: ' + why(e)) }
      }
    }
    if (ctx.get('tools') !== undefined && ctx.get('webServer') !== undefined) start(ctx)
    else ctx.inject(['tools', 'webServer'], start)

    // A service that was running when DSH last stopped comes back by itself (an orphan from a crash is adopted).
    try {
      if (config.read().autostart && config.ready().ok) {
        const timer = setTimeout(() => { supervisor.start().then((r) => { if (!r.ok) say('autostart: ' + (r.error || 'failed')) }).catch(() => {}) }, 1500)
        if (timer !== undefined && typeof timer.unref === 'function') timer.unref()
      }
    } catch (e) { say('autostart skipped: ' + why(e)) }
  } catch (e) {
    say('disabled: ' + why(e))
  }
}
