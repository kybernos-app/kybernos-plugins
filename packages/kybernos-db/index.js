// kybernos-db — host half.
//
// It gives the agents and the person their own databases: thirteen tools (db_list, db_create, object_define, field_add, relation_add, field_update, view_save,
// records_list, records_get, records_create, records_update, records_delete, records_restore), the short block of their system prompt that names the
// databases, the `db-builder` skill that says how to design one, and the routes the Tables page reads and writes through. The data is a SQLite file per database under `<DSH home>/kybernos/kybernos-db/dbs`
// (store/), the rules are the pure ones of core/. Nothing here reaches the network.
//
// The approval is the engine's own (`tools/pre-execute`): a change of structure, a write to a protected field and the reading of one in clear are put to the
// person on a card before they run; a session that never asks refuses them. A database that does not open (a newer Kybernos wrote it, `node:sqlite` is
// missing) is reported by the tools with its own code and never stops DSH from starting.
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeApi } from './api.mjs'
import { SECTION_NAME, SECTION_ORDER, renderBlock } from './agent/context.mjs'
import { makeService } from './agent/service.mjs'
import { approvalGate, tools as dbTools } from './agent/tools.mjs'
import { mountRoutes } from './routes.mjs'
import { seedSkills } from './seed-skills.mjs'

export const name = 'kybernos-db'

const pluginDir = dirname(fileURLToPath(import.meta.url))
/** The skills this bundle ships (`<bundle>/skills/<name>/SKILL.md`), seeded into the DSH home at host start. */
export const SKILLS_DIR = join(pluginDir, 'skills')
export const SEEDED_SKILLS = ['db-builder']

const say = (text) => { try { console.log('[kybernos-db] ' + text) } catch (e) { /* console unavailable */ } }
const why = (e) => String((e && e.message) || e)

/** `DSH_HOME` can move the home folder (a test aims it at a temporary one). */
export function dshHome () {
  const env = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== '' ? process.env.DSH_HOME : null
  return env !== null ? env : join(homedir(), '.dsh')
}
/** The folder that holds the databases. */
export const dbsDir = (home = dshHome()) => join(home, 'kybernos', 'kybernos-db', 'dbs')

/**
 * The service over the dbs folder, made when first asked (nothing is read at boot) and the same one after. A folder that cannot be read gives a service
 * that answers « no database » rather than throwing: the tools then say what is wrong when they are used.
 */
export function lazyService (dir, ports) {
  let service = null
  return () => {
    if (service === null) service = makeService({ dir, ports })
    return service
  }
}

/** The service with its methods looked up at each call, so the tools can be built before the folder is touched. */
const deferred = (get) => ({
  get dir () { return get().dir },
  list: () => get().list(),
  byId: (id) => get().byId(id),
  resolve: (id) => get().resolve(id),
  create: (def) => get().create(def),
  snapshot: () => get().snapshot(),
  close: () => get().close(),
})

/** Mounts the system prompt block for every agent; returns what to undo. Same two paths as kybernos-memory: a section per agent, the durable context as the last resort. */
function mountPrompt (ctx, service) {
  const fibers = new WeakMap()
  let fallback = null
  let installed = 0
  const text = () => { try { return renderBlock(service.snapshot()) } catch (e) { return '' } }
  const installFallback = () => {
    if (fallback !== null || installed > 0) return
    fallback = ctx.inject(['systemPrompt'], (scope) => { scope.systemPrompt.context({ name: SECTION_NAME, order: SECTION_ORDER, text }) })
  }
  const install = (agent) => {
    if (agent === null || typeof agent !== 'object' || fibers.has(agent)) return
    const agentCtx = agent.ctx
    if (agentCtx === null || typeof agentCtx !== 'object' || typeof agentCtx.inject !== 'function') { installFallback(); return }
    try {
      fibers.set(agent, agentCtx.inject(['systemPrompt'], (scope) => { scope.systemPrompt.section({ name: SECTION_NAME, order: SECTION_ORDER, text }) }))
      installed += 1
    } catch (e) {
      if (installed === 0) installFallback()
      say('prompt section not installed for an agent: ' + why(e))
    }
  }
  const dispose = (agent) => {
    const fiber = fibers.get(agent)
    if (fiber === undefined) return
    fibers.delete(agent)
    try { const task = typeof fiber.dispose === 'function' ? fiber.dispose() : undefined; if (task !== undefined && typeof task.catch === 'function') task.catch(() => {}) } catch (e) { /* the agent is going away */ }
  }
  let agents = null
  try { agents = ctx.get('agents') } catch (e) { agents = null }
  if (agents === null || agents === undefined || typeof ctx.on !== 'function') { installFallback(); return () => { fallback = null } }
  try { for (const agent of (typeof agents[Symbol.iterator] === 'function' ? agents : [])) install(agent) } catch (e) { /* no list of running agents: new ones are caught below */ }
  const offs = []
  for (const [event, fn] of [['agent/created', ({ agent }) => install(agent)], ['agent/disposed', ({ agent }) => dispose(agent)]]) {
    try { const off = ctx.on(event, fn); if (typeof off === 'function') offs.push(off) } catch (e) { /* an engine without this event */ }
  }
  if (offs.length === 0 && installed === 0) installFallback()
  return () => { for (const off of offs.splice(0)) { try { off() } catch (e) { /* already gone */ } } }
}

export function apply (ctx, options = {}) {
  try {
    if (ctx === null || ctx === undefined || typeof ctx.get !== 'function') return // no services to mount on: nothing to do, nothing to say
    const home = typeof options.home === 'string' && options.home !== '' ? options.home : dshHome()
    const service = deferred(lazyService(dbsDir(home), options.ports))
    const retraits = []
    if (typeof ctx.effect === 'function') {
      ctx.effect(() => () => {
        for (const retrait of retraits.splice(0).reverse()) { try { retrait() } catch (e) { /* already gone */ } }
        try { service.close() } catch (e) { /* never opened, or already closed */ }
      }, 'kybernos-db: tools, prompt block and approvals')
    }

    // The routes of the Tables page (routes.mjs): every data route needs DSH's signed session.
    const api = makeApi({ service, ports: options.toolPorts })
    const mountWeb = (c) => {
      try {
        const webServer = c.get('webServer')
        if (webServer !== undefined) retraits.push(...mountRoutes(webServer, api))
      } catch (e) { say('routes not mounted: ' + why(e)) }
    }
    if (ctx.get('webServer') !== undefined) mountWeb(ctx)
    else ctx.inject(['webServer'], mountWeb)

    const mountTools = (c) => {
      try {
        const registry = c.get('tools')
        if (registry === undefined) return
        for (const tool of dbTools(service, options.toolPorts)) { const retrait = registry.register(tool); if (typeof retrait === 'function') retraits.push(retrait) }
      } catch (e) { say('tools not registered: ' + why(e)) }
    }
    if (ctx.get('tools') !== undefined) mountTools(ctx)
    else ctx.inject(['tools'], mountTools)

    // The approval of a change of structure, of a write to a protected field and of reading one in clear: the engine asks the person before the tool runs.
    if (typeof ctx.on === 'function') {
      const retrait = ctx.on('tools/pre-execute', async (exec, next) => {
        let gate = null
        try { gate = approvalGate(service, exec) } catch (e) { gate = null }
        return gate === null ? next() : gate
      })
      if (typeof retrait === 'function') retraits.push(retrait)
    }

    try { retraits.push(mountPrompt(ctx, service)) } catch (e) { say('prompt block not mounted: ' + why(e)) }

    // The skill that says how to design a database is shipped here and seeded into <dsh home>/skills (a skill the user edited is never overwritten).
    try {
      for (const r of seedSkills({ home, sourceDir: SKILLS_DIR, names: SEEDED_SKILLS })) {
        if (r.action === 'created' || r.action === 'updated') say('skill ' + r.name + ' ' + r.action)
        else if (r.action === 'error' || r.action === 'no-source' || r.action === 'invalid-name') say('skill ' + r.name + ' not installed: ' + (r.error !== undefined ? r.error : r.action))
      }
    } catch (e) { say('skills not installed: ' + why(e)) }
  } catch (e) {
    say('host disabled: ' + why(e))
  }
}
