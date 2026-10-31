// kybernos-db — host half.
//
// It gives the agents and the person their own databases: fifteen tools (db_list, db_create, object_define, field_add, relation_add, field_update, view_save,
// records_list, records_get, records_create, records_update, records_delete, records_restore, db_archive, db_restore), the short block of their system prompt that names the
// databases, the `db-builder` skill that says how to design one, and the routes the Tables page reads and writes through. The data is a SQLite file per database under `<DSH home>/kybernos/kybernos-db/dbs`
// (store/), the rules are the pure ones of core/. Nothing here reaches the network.
//
// The approval is the engine's own (`tools/pre-execute`): a change of structure, a write to a protected field and the reading of one in clear are put to the
// person on a card before they run; a session that never asks refuses them. A database that does not open (a newer Kybernos wrote it, `node:sqlite` is
// missing) is reported by the tools with its own code and never stops DSH from starting.
//
// An app can be PUBLISHED into a team space (remote/): the hosted copy becomes the truth, the folder here a read-only mirror, and the rows are written through the web app. The five
// publish routes, the poll that keeps the mirror fresh and the registry of published apps are built here, each guarded: a failure to build any of them leaves every db a plain local one
// and never stops DSH from starting. Publishing needs a hosting (remote/hosting.mjs, a port); without one nothing is offered.
//
// It also opens the point `kybernos/db#template` (template.mjs) for the themes that ship a ready database, and publishes the seam `Symbol.for('kybernos.db')` the core
// makes one through (instantiate.mjs): nothing is read or written until a template is installed.
import { homedir } from 'node:os'
import { rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeApi } from './api.mjs'
import { SECTION_NAME, SECTION_ORDER, renderBlock } from './agent/context.mjs'
import { makeService } from './agent/service.mjs'
import { approvalGate, tools as dbTools } from './agent/tools.mjs'
import { MARKER_FILE, installTemplate, readMarkers } from './instantiate.mjs'
import { mountRoutes } from './routes.mjs'
import { seedSkills } from './seed-skills.mjs'
import { cloudHosting } from './remote/cloud-hosting.mjs'
import { envHosting, unavailableHosting } from './remote/hosting.mjs'
import { makePublisher } from './remote/publisher.mjs'
import { REGISTRY_FILE, openPublishedRegistry } from './remote/registry.mjs'
import { DB_TEMPLATE_POINT } from './template.mjs'

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

// ── telling the registry ────────────────────────
const registrySeam = () => { try { const r = globalThis[Symbol.for('kybernos.registry')]; return r !== undefined && r !== null && r.version === 1 ? r : null } catch (e) { return null } }

/** Tells the registry the point this plugin owns. `true` when the registry was there to hear it (telling it twice changes nothing). */
export const tellPoint = () => {
  try {
    const registry = registrySeam()
    if (registry === null) return false
    registry.definePoint(DB_TEMPLATE_POINT)
    return true
  } catch (e) { return false }
}

/**
 * Tells the point now, and again after each delay until the registry has heard it: the registry mounts when DSH decides, maybe after this plugin
 * (measured in a sandbox: at boot the seam was not there yet, and nothing asked a question later). Never throws; the timers never hold DSH open.
 * `options.schedule` and `options.delays` are for the test.
 */
export function tellWhenReady (options = {}) {
  const schedule = options.schedule || setTimeout
  const delays = Array.isArray(options.delays) ? options.delays : [500, 1500, 4000, 10000, 30000]
  let told = tellPoint()
  let tries = 0
  const next = () => {
    if (told || tries >= delays.length) return
    const timer = schedule(() => { told = tellPoint(); next() }, delays[tries++])
    if (timer !== undefined && timer !== null && typeof timer.unref === 'function') timer.unref()
  }
  next()
  return () => told
}
// ── end of the telling ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

// ── the seam the core installs a template through ───────────────────────────────────────────────────────────
/** The key of the seam on `globalThis`: the core installs the sample of a shipped template through it, the way it reaches the business base. */
export const SEAM = Symbol.for('kybernos.db')

/** Publishes `{ version: 1, install }` and answers what takes it off again. The service is reached when a call comes, never at boot. */
export function publishSeam (service) {
  const seam = Object.freeze({ version: 1, install: (args) => installTemplate({ ...args, service }) })
  try { globalThis[SEAM] = seam } catch (e) { return () => {} }
  return () => { try { if (globalThis[SEAM] === seam) delete globalThis[SEAM] } catch (e) { /* already gone */ } }
}

/** The service with its methods looked up at each call, so the tools can be built before the folder is touched. */
export const deferred = (get) => ({
  get dir () { return get().dir },
  list: () => get().list(),
  byId: (id) => get().byId(id),
  resolve: (id) => get().resolve(id),
  raw: (id) => get().raw(id),
  replaceMirror: (id, folder) => get().replaceMirror(id, folder),
  create: (def) => get().create(def),
  discard: (id) => get().discard(id),
  archive: (id, by) => get().archive(id, by),
  unarchive: (id) => get().unarchive(id),
  remove: (id) => get().remove(id),
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

/**
 * The hosting a host process uses: the one it was given, else one pointed at a space somebody runs (two environment variables, development and self-hosting), else the person's own
 * cloud computers through their Kybernos account (`cloudHosting`: it offers nothing while no account is signed in or the server cannot host). Never throws.
 */
export function chooseHosting (given, env = process.env, cloud = cloudHosting) {
  try {
    if (given !== undefined && given !== null && typeof given.available === 'function') return given
    const own = envHosting(env)
    return own.available() ? own : cloud()
  } catch (e) { return unavailableHosting() }
}

/**
 * The publisher over a DSH home, or null when it cannot be built (then every db stays a local one). `holder.publisher` is what the service asks, through `ports.published` and
 * `ports.facade`, so the service can be made before the publisher exists.
 */
export function buildPublisher ({ home, service, options, holder }) {
  try {
    const root = dirname(dbsDir(home))
    const remote = options.remote !== null && typeof options.remote === 'object' ? options.remote : {}
    const registry = openPublishedRegistry({ file: join(root, REGISTRY_FILE) })
    const tmpRoot = join(root, 'tmp')
    try { rmSync(tmpRoot, { recursive: true, force: true }) } catch (e) { /* nothing left over from a cut-short pull */ }
    holder.publisher = makePublisher({ service, registry, hosting: chooseHosting(remote.hosting), tmpRoot, ports: { fetch: remote.fetch, now: remote.now, store: options.ports, log: say, timers: remote.timers } })
    return holder.publisher
  } catch (e) {
    holder.publisher = null
    say('publishing not available: ' + why(e))
    return null
  }
}

export function apply (ctx, options = {}) {
  try {
    if (ctx === null || ctx === undefined || typeof ctx.get !== 'function') return // no services to mount on: nothing to do, nothing to say
    const home = typeof options.home === 'string' && options.home !== '' ? options.home : dshHome()
    const holder = { publisher: null }
    const storePorts = {
      ...options.ports,
      published: (id) => { try { return holder.publisher !== null && holder.publisher.isPublished(id) } catch (e) { return false } },
      facade: (id, rawOf) => (holder.publisher === null ? null : holder.publisher.facade(id, rawOf)),
    }
    const service = deferred(lazyService(dbsDir(home), storePorts))
    const retraits = []
    const publisher = buildPublisher({ home, service, options, holder })
    tellWhenReady(options)
    retraits.push(publishSeam(service))
    if (typeof ctx.effect === 'function') {
      ctx.effect(() => () => {
        for (const retrait of retraits.splice(0).reverse()) { try { retrait() } catch (e) { /* already gone */ } }
        try { service.close() } catch (e) { /* never opened, or already closed */ }
      }, 'kybernos-db: tools, prompt block and approvals')
    }

    // The routes of the Tables page (routes.mjs): every data route needs DSH's signed session.
    const remote = publisher === null ? undefined : { info: (id) => publisher.info(id), hosting: () => publisher.hostingState() }
    const api = makeApi({ service, ports: { markers: () => readMarkers(join(dirname(dbsDir(home)), MARKER_FILE)), remote, ...options.toolPorts } })
    const mountWeb = (c) => {
      try {
        const webServer = c.get('webServer')
        if (webServer !== undefined) retraits.push(...mountRoutes(webServer, api, publisher === null ? undefined : publisher))
      } catch (e) { say('routes not mounted: ' + why(e)) }
    }
    // the mirror of a published app is kept fresh on a timer that never holds DSH open and is taken off with everything else
    if (publisher !== null) {
      try { publisher.start({ ...(options.remote && options.remote.pollMs ? { everyMs: options.remote.pollMs } : {}), ...(options.remote && options.remote.firstPollMs ? { firstMs: options.remote.firstPollMs } : {}) }); retraits.push(() => publisher.stop()) } catch (e) { say('the mirror is not kept fresh: ' + why(e)) }
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
