// Kybernos connections, the host half (ADR 0008 of the server): the routes the connectors page calls and the three native tools the
// agents use. index.js hands over what it owns (the account's token, the call to the server, the active server) and mounts what
// comes back; the contract and every mapping are in connections.mjs. Nothing here keeps a connection, a key or a result on disk: the only
// files are the server's PUBLIC catalogue and its logos (the same for everyone), under `cacheDir`, loaded in the background and renewed daily.
//
// The tools are registered natively and not as a `dsh-mcp-client` entry because an entry's headers are fixed when it loads: it would
// keep sending the token it started with through a re-pairing. Each call here reads the live token, and posts one JSON-RPC message
// to the server's endpoint (stateless: no `initialize` first).
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { connectionsEndpoint } from './server-profile.mjs'
import {
  asConnection, asConnectionList, asAppList, asLinked, connectionsFailure, connectionsPaths, isConnectionId, isToolkit, linkBody, MAX_LOGO_BYTES, rpcCall, rpcOutcome, safeLogo,
} from './connections.mjs'

/** A call to an app may run 30 s at the server (ADR 0008 § 5): wait a little longer than that, never less. */
const TOOL_TIMEOUT_MS = 40000
/** What an agent may send as `params` (the server's own bound, checked here first so nothing bigger is sent). */
const MAX_PARAMS_BYTES = 256 * 1024
const SYNC_EVERY_MS = 5000
/** A logo is kept a day in memory (the page's browser keeps it a day too); never more than this many, the oldest out first. */
const LOGO_TTL_MS = 24 * 60 * 60 * 1000
const LOGO_CACHE_MAX = 600
const LOGO_TIMEOUT_MS = 8000
/** The whole catalogue and every logo are loaded in the background and renewed once a day (the files on disk are the page's source, so it opens at once, even offline). */
const DAY_MS = 24 * 60 * 60 * 1000
/** The first load waits a little after the start (DSH is not slowed down), then a check every hour says whether a day has passed or a load was cut short. */
const FIRST_LOAD_MS = 20000
const DUE_EVERY_MS = 60 * 60 * 1000
/** The load asks a few logos at once and at most about 6 a second: far under the server's own limit (600 a minute), so nothing else of the person is refused meanwhile. */
const LOAD_PACE = Object.freeze({ batch: 3, everyMs: 500 })
/** After a refusal or a server that does not answer, the load stops and the next try is this far away. */
const LOAD_PAUSE_MS = 10 * 60 * 1000
const wait = (ms) => (ms > 0 ? new Promise((resolve) => { setTimeout(resolve, ms) }) : Promise.resolve())

const TEXT_RESULT = (text) => [{ type: 'text', text }]
const queryOf = (req) => { try { return new URL(req.url, 'http://localhost').searchParams } catch (e) { return new URLSearchParams('') } }
const obj = (v) => (v !== null && v !== undefined && typeof v === 'object' && !Array.isArray(v) ? v : {})

/** Why a call failed, in a sentence a model can act on. Words, never the server's own text. */
const SAYS = {
  not_connected: 'The Kybernos account is not connected on this machine. Connect it in Kybernos Cloud first.',
  network: 'The Kybernos server cannot be reached right now. Try again in a moment.',
  reconnect_required: 'The Kybernos session has ended. The person has to connect their account again in Kybernos Cloud.',
  forbidden: 'This account may not use connected apps.',
  too_many_requests: 'Too many calls in a short time. Wait a little before the next one.',
  invalid_params: 'The server refused the arguments. Check them against the tool description.',
  not_on_this_server: 'This server does not offer connected apps.',
  connections_disabled: 'This server does not offer connected apps right now.',
  invalid_response: 'The server answered with something unexpected.',
  tool_error: 'The call failed.',
}
const explain = (error) => SAYS[error] !== undefined ? SAYS[error] : 'The call failed (' + String(error) + ').'

/**
 * @param {object} deps what index.js owns:
 *   apiCall(path, { method, token, body, base, timeoutMs }) → { status, body } (never throws, status 0 = network)
 *   readState() → the connection state (or null), isConnected(state), server() → { profile }
 *   providerChoice() → 'composio' | 'kybernos' | null: the Settings › Connectors choice (optional)
 *   cacheDir() → the folder where the public catalogue and its logos are kept, or null for memory only (optional)
 *   pace: { batch, everyMs } of the background load of the logos (optional; tests make it instant)
 */
export const createConnections = ({ apiCall, readState, isConnected, server, providerChoice = () => null, cacheDir = () => null, pace = LOAD_PACE, log = () => {} }) => {
  let rpcId = 0

  /** What this machine knows before any call: does this server offer connections, and is the account connected. */
  const gate = () => {
    const endpoint = connectionsEndpoint(server().profile)
    if (endpoint === null) return { done: { ok: true, offered: false, connected: isConnected(readState()) } }
    const state = readState()
    if (isConnected(state) !== true) return { done: { ok: false, offered: true, connected: false, error: 'non connecte' }, offered: true }
    return { endpoint, state }
  }

  /** This server has no connections at all: Composio is not configured on it (503 `connections_disabled`) or it is an older one without the routes (404 on a route that names no connection). */
  const notOffered = (made) => made.ok !== true && (made.error === 'connections_disabled' || made.error === 'not_on_this_server')

  const rest = async (g, path, { method = 'GET', body, named = false } = {}) => {
    const res = await apiCall(path, { method, token: g.state.token, ...(body === undefined ? {} : { body }) })
    const failure = connectionsFailure(res.status, res.body, { named })
    return failure === null ? { ok: true, body: res.body } : { ok: false, offered: true, connected: true, ...failure }
  }

  const listRoute = async (req) => {
    const g = gate()
    if (g.done !== undefined) return g.done
    const made = await rest(g, connectionsPaths.list + (queryOf(req).get('refresh') === '1' ? '?refresh=1' : ''))
    // The profile of the built-in server says « connections » without asking: the server is the one that knows. Told « not here », the page does not offer the Kybernos mode (and does not make it
    // the default of a person with no key of their own), as it does for a server whose discovery says so.
    if (notOffered(made)) return { ok: true, offered: false, connected: true }
    if (made.ok !== true) return made
    const list = asConnectionList(made.body)
    // `web`: the active server's web app, where the plans are: the page offers it when the plan does not include connections. The profile's address is
    // the one the open half already vetted (https, or loopback in development).
    const web = server().profile !== null && typeof server().profile === 'object' && typeof server().profile.web === 'string' ? server().profile.web : null
    return list === null ? { ok: false, offered: true, connected: true, error: 'invalid_response' } : { ok: true, offered: true, connected: true, ...list, web }
  }

  // ── what is kept on disk ──────────────────────────────────────────────────────────────────────────────────────────────
  // Only the server's public list and its logos, one folder per endpoint (another server has its own). Every read is checked again as if it came from outside, every
  // failure is a miss and never a throw: a cache that cannot be read or written is a cache that is not there.

  const storeDir = () => {
    let root = null
    try { root = cacheDir() } catch (e) { root = null }
    const endpoint = connectionsEndpoint(server().profile)
    if (typeof root !== 'string' || root === '' || endpoint === null) return null
    return join(root, createHash('sha256').update(endpoint).digest('hex').slice(0, 12))
  }
  const writeAtomic = async (file, text) => {
    const tmp = file + '.' + process.pid + '.tmp'
    await writeFile(tmp, text, { mode: 0o600 })
    await rename(tmp, file)
  }
  const ageOf = async (file) => { try { return Date.now() - (await stat(file)).mtimeMs } catch (e) { return null } }
  const rowOf = (a) => ({ slug: a.slug, name: a.name, categories: a.categories, description: a.description, needs_api_key: a.needsApiKey, logo: a.logo ? '1' : '' })

  /** The catalogue kept for this server, whatever its age: `{ at, source, configured, apps }` or null. */
  const keptCatalogue = async (dir) => {
    try {
      const j = JSON.parse(await readFile(join(dir, 'catalogue.json'), 'utf8'))
      const list = asAppList({ configured: j.configured, apps: j.apps })
      if (list === null || !Number.isFinite(j.at) || (j.source !== 'public' && j.source !== 'account')) return null
      return { at: j.at, source: j.source, ...list }
    } catch (e) { return null }
  }
  const keepCatalogue = async (dir, made) => {
    try {
      await mkdir(join(dir, 'logos'), { recursive: true, mode: 0o700 })
      await writeAtomic(join(dir, 'catalogue.json'), JSON.stringify({ at: Date.now(), source: made.source, configured: made.configured, apps: made.apps.map(rowOf) }))
    } catch (e) { log('catalogue not kept: ' + String((e && e.message) || e)) }
  }
  const logoFile = (dir, slug) => join(dir, 'logos', slug + '.svg')
  const keptLogo = async (dir, slug) => {
    try {
      const text = await readFile(logoFile(dir, slug), 'utf8')
      return safeLogo(text) === true ? text : null
    } catch (e) { return null }
  }
  const keepLogo = async (dir, slug, svg) => {
    try {
      await mkdir(join(dir, 'logos'), { recursive: true, mode: 0o700 })
      await writeAtomic(logoFile(dir, slug), svg)
    } catch (e) { /* the picture is served from memory this time */ }
  }

  /**
   * The catalogue. The public route comes first and needs no token: a person who is not signed in sees the whole of it (the reason to sign in is to
   * connect one, not to look). A server that has no public route yet (older) still answers a signed-in person on the account's route.
   */
  // Which way the last catalogue came: false = from the account route (a server with no public routes yet), so its logos come from the account's logo route.
  let publicRoutes = null
  const fetchCatalogue = async (connected) => {
    const open = await apiCall(connectionsPaths.catalogue, { timeoutMs: 15000 })
    if (open.status === 200) {
      const list = asAppList(open.body)
      if (list !== null) { publicRoutes = true; return { ok: true, offered: true, connected, ...list, source: 'public' } }
    }
    const g = gate()
    if (g.done !== undefined) return g.done
    const made = await rest(g, connectionsPaths.apps)
    if (notOffered(made)) return { ok: true, offered: false, connected: true }
    if (made.ok !== true) return made
    const list = asAppList(made.body)
    if (list !== null) publicRoutes = false
    return list === null ? { ok: false, offered: true, connected: true, error: 'invalid_response' } : { ok: true, offered: true, connected: true, ...list, source: 'account' }
  }
  /**
   * What the page gets: the copy kept on this machine while it is less than a day old (`?refresh=1` asks the server anyway), otherwise the server's list, which is then kept.
   * When the server cannot be asked, the copy kept whatever its age: a day-old list is better than none.
   */
  const loadCatalogue = async (force) => {
    const endpoint = connectionsEndpoint(server().profile)
    if (endpoint === null) return { ok: true, offered: false, connected: isConnected(readState()) }
    const connected = isConnected(readState()) === true
    const dir = storeDir()
    const copy = dir === null ? null : await keptCatalogue(dir)
    if (copy !== null && force !== true && Date.now() - copy.at < DAY_MS) {
      publicRoutes = copy.source === 'public'
      return { ok: true, offered: true, connected, configured: copy.configured, apps: copy.apps, source: copy.source }
    }
    const made = await fetchCatalogue(connected)
    if (made.ok === true && made.offered === true && dir !== null && made.configured !== false && made.apps.length > 0) await keepCatalogue(dir, made)
    if (made.ok !== true && copy !== null) {
      publicRoutes = copy.source === 'public'
      return { ok: true, offered: true, connected, configured: copy.configured, apps: copy.apps, source: copy.source, stale: true }
    }
    return made
  }
  const appsRoute = (req) => loadCatalogue(req !== undefined && queryOf(req).get('refresh') === '1')

  // One logo at a time per slug, a day in memory, then the file kept on disk. The PUBLIC route, with no token. Only a server that has no public routes (its catalogue came from the account
  // route) is asked on the account's logo route, with the token, from here and never from the page: the token goes to the person's own server and nowhere else.
  const logos = new Map()
  const flights = new Map()
  /** `{ svg, status }`: the picture, or null with the status that said why (0 = the server could not be reached). */
  const fetchLogo = async (slug) => {
    let res
    if (publicRoutes === false) {
      const g = gate()
      if (g.done !== undefined) return { svg: null, status: 401 }
      res = await apiCall(connectionsPaths.logo(slug), { raw: true, token: g.state.token, timeoutMs: LOGO_TIMEOUT_MS, maxBytes: MAX_LOGO_BYTES })
    } else res = await apiCall(connectionsPaths.catalogueLogo(slug), { raw: true, timeoutMs: LOGO_TIMEOUT_MS, maxBytes: MAX_LOGO_BYTES })
    return { svg: res.status === 200 && safeLogo(res.text) === true ? res.text : null, status: res.status }
  }
  const remember = (slug, svg) => {
    logos.delete(slug)
    logos.set(slug, { svg, at: Date.now() })
    while (logos.size > LOGO_CACHE_MAX) logos.delete(logos.keys().next().value)
  }
  /** `{ status, type, body, maxAge }` for the route to send as it is (the one route here that is not JSON). */
  const logoRoute = async (req) => {
    const slug = queryOf(req).get('slug')
    if (!isToolkit(slug) || connectionsEndpoint(server().profile) === null) return { status: 404, maxAge: 0 }
    const hit = logos.get(slug)
    if (hit !== undefined && Date.now() - hit.at < LOGO_TTL_MS) return { status: 200, type: 'image/svg+xml', body: hit.svg, maxAge: 86400 }
    const dir = storeDir()
    const onDisk = dir === null ? null : await keptLogo(dir, slug)
    if (onDisk !== null) { remember(slug, onDisk); return { status: 200, type: 'image/svg+xml', body: onDisk, maxAge: 86400 } }
    if (!flights.has(slug)) flights.set(slug, fetchLogo(slug).finally(() => flights.delete(slug)))
    const { svg } = await flights.get(slug)
    if (svg === null) return { status: 404, maxAge: 300 }
    remember(slug, svg)
    if (dir !== null) await keepLogo(dir, slug, svg)
    return { status: 200, type: 'image/svg+xml', body: svg, maxAge: 86400 }
  }

  // ── the background load: the whole catalogue and every logo, once a day ─────────────────────────────────────────────────
  // Started a little after DSH starts and checked every hour (a computer that slept through the day catches up). It asks the server for the list when the copy is a day old, then for every logo whose
  // file is missing or a day old, a few at a time. Nothing waits for it: the page reads what is on disk and asks the server itself for what is not there yet. A refusal or a silent server stops it
  // for a while (the next hourly check starts it again); a logo the server does not have is skipped, and tried again the next day.

  let loading = null
  let stopped = false
  let cutShort = false
  let pausedUntil = 0

  const loadLogos = async (dir, apps) => {
    await mkdir(join(dir, 'logos'), { recursive: true, mode: 0o700 })
    const todo = []
    for (const a of apps) {
      if (a.logo !== true) continue
      const age = await ageOf(logoFile(dir, a.slug))
      if (age === null || age >= DAY_MS) todo.push(a.slug)
    }
    let trouble = 0
    for (let i = 0; i < todo.length && stopped !== true; i += pace.batch) {
      const began = Date.now()
      const done = await Promise.all(todo.slice(i, i + pace.batch).map(async (slug) => {
        const { svg, status } = await fetchLogo(slug)
        if (svg !== null) { await keepLogo(dir, slug, svg); return true }
        return status === 404 || status === 200
      }))
      trouble = done.every((d) => d === false) ? trouble + 1 : 0
      if (trouble >= 3) { cutShort = true; pausedUntil = Date.now() + LOAD_PAUSE_MS; return }
      await wait(pace.everyMs - (Date.now() - began))
    }
  }
  const runLoad = async () => {
    const dir = storeDir()
    if (dir === null) return
    cutShort = false
    const made = await loadCatalogue(false)
    // Not signed in on a server with no public list: nothing to ask until the person signs in (the hourly check looks again). Any other failure is a pause.
    if (made.ok !== true) { if (made.connected !== false) { cutShort = true; pausedUntil = Date.now() + LOAD_PAUSE_MS }; return }
    if (made.offered !== true || !Array.isArray(made.apps)) return
    await loadLogos(dir, made.apps)
  }
  /** One load at a time; never throws. */
  const load = () => {
    if (loading === null) loading = runLoad().catch((e) => { cutShort = true; log('background load: ' + String((e && e.message) || e)) }).finally(() => { loading = null })
    return loading
  }
  /** Is a load due: a day since the list, or the last one was cut short and its pause is over. */
  const loadDue = async () => {
    if (loading !== null || Date.now() < pausedUntil) return false
    const dir = storeDir()
    if (dir === null) return false
    if (cutShort === true) return true
    const copy = await keptCatalogue(dir)
    return copy === null || Date.now() - copy.at >= DAY_MS
  }
  const check = async () => { try { if (await loadDue()) await load() } catch (e) { /* the next hour */ } }

  /** One connection, reconciled at the server on the spot: what the page polls while an add is pending. */
  const itemRoute = async (req) => {
    const g = gate()
    if (g.done !== undefined) return g.done
    const id = queryOf(req).get('id')
    if (!isConnectionId(id)) return { ok: false, offered: true, connected: true, error: 'not_found' }
    const made = await rest(g, connectionsPaths.one(id), { named: true })
    if (made.ok !== true) return made
    const connection = asConnection(obj(made.body).connection !== undefined ? made.body.connection : made.body)
    return connection === null ? { ok: false, offered: true, connected: true, error: 'invalid_response' } : { ok: true, offered: true, connected: true, connection }
  }

  /**
   * Start a connection. The key of an API-key toolkit goes to the server in this one call: it is not stored, not logged, and the
   * answer carries nothing of it. No `redirect_uri` is sent (ADR 0008 § 4): the server uses its own page, and the page polls.
   */
  const linkRoute = async (req, body) => {
    const made = linkBody(body)
    if (made.error !== undefined) return { ok: false, error: made.error }
    const g = gate()
    if (g.done !== undefined) return g.done
    const sent = await rest(g, connectionsPaths.link, { method: 'POST', body: made.body, named: true })
    if (sent.ok !== true) return sent
    const linked = asLinked(sent.body)
    return linked === null ? { ok: false, offered: true, connected: true, error: 'invalid_response' } : { ok: true, offered: true, connected: true, connection: { id: linked.id, status: linked.status }, redirectUrl: linked.redirectUrl }
  }

  const deleteRoute = async (req, body) => {
    const g = gate()
    if (g.done !== undefined) return g.done
    const id = obj(body).id
    if (!isConnectionId(id)) return { ok: false, offered: true, connected: true, error: 'not_found' }
    const made = await rest(g, connectionsPaths.one(id), { method: 'DELETE', named: true })
    return made.ok === true ? { ok: true, offered: true, connected: true } : made
  }

  // ── the three tools ────────────────────────────────────────────────────────────────────────────────────────────────────

  const call = async (name, args) => {
    const g = gate()
    if (g.done !== undefined) return { ok: false, error: g.done.offered === false ? 'not_on_this_server' : 'not_connected' }
    rpcId += 1
    const res = await apiCall(g.endpoint, { base: '', method: 'POST', token: g.state.token, body: rpcCall(name, args, rpcId), timeoutMs: TOOL_TIMEOUT_MS })
    return rpcOutcome(res.status, res.body)
  }

  const outputOf = () => ({
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean' },
        text: { type: 'string' },
        error: { type: 'string' },
      },
      required: ['ok'],
    },
    render: (args, value) => TEXT_RESULT(value.ok === true ? (value.text === '' ? '(nothing)' : String(value.text)) : (typeof value.text === 'string' && value.text !== '' ? value.text : explain(value.error))),
  })

  const toolDefs = () => [
    {
      name: 'connections_list',
      description: 'The apps the person has connected to their Kybernos account (Gmail, GitHub, Slack...), with the id, the app and the label of each. Start here: only an app listed as active can be used, and the person connects a new one on the Connectors page.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: outputOf(),
      async execute() { return call('connections_list', {}) },
    },
    {
      name: 'connections_search_tools',
      description: 'The actions a connected app offers (their slug, what they do and the arguments they take). Use it before connections_execute: the list of actions is not known in advance, so search the app for the one that fits the task.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          toolkit: { type: 'string', description: 'The app, by its slug as connections_list shows it (github, gmail...).' },
          query: { type: 'string', description: 'What to do, in a few words (send an email, list open issues...).' },
          limit: { type: 'integer', description: 'The most actions to return, 1 to 50. Default 10.' },
        },
        required: ['toolkit'],
      },
      output: outputOf(),
      async execute(args) {
        const toolkit = typeof args.toolkit === 'string' ? args.toolkit.trim().toLowerCase() : ''
        if (!isToolkit(toolkit)) return { ok: false, error: 'invalid_params' }
        const out = { toolkit }
        if (typeof args.query === 'string' && args.query.trim() !== '') out.query = args.query.trim().slice(0, 200)
        if (Number.isInteger(args.limit)) out.limit = Math.min(50, Math.max(1, args.limit))
        return call('connections_search_tools', out)
      },
    },
    {
      name: 'connections_execute',
      description: 'Runs one action of a connected app with the person\'s own account (send the email, create the issue...). It acts for real and is not retried: an action that fails may have been done, so check before trying again. Get the action slug and its arguments from connections_search_tools.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          tool_slug: { type: 'string', description: 'The action, as connections_search_tools names it (GITHUB_CREATE_AN_ISSUE...).' },
          params: { type: 'object', description: 'The arguments of the action, as its input schema describes them.' },
          connection_id: { type: 'string', description: 'Which connected account to use when the person has several for this app. Optional: the default one is used otherwise.' },
        },
        required: ['tool_slug'],
      },
      output: outputOf(),
      async execute(args) {
        const slug = typeof args.tool_slug === 'string' ? args.tool_slug.trim() : ''
        if (!/^[A-Za-z0-9_.-]{1,120}$/.test(slug)) return { ok: false, error: 'invalid_params' }
        const params = args.params === undefined ? {} : args.params
        if (params === null || typeof params !== 'object' || Array.isArray(params)) return { ok: false, error: 'invalid_params' }
        if (Buffer.byteLength(JSON.stringify(params)) > MAX_PARAMS_BYTES) return { ok: false, error: 'params_too_large' }
        const out = { tool_slug: slug, params }
        if (args.connection_id !== undefined) {
          if (!isConnectionId(args.connection_id)) return { ok: false, error: 'invalid_params' }
          out.connection_id = args.connection_id
        }
        return call('connections_execute', out)
      },
    },
  ]

  // ── which tools exist right now ─────────────────────────────────────────────────────────────────────────────────────────
  // They exist only while this server offers connections AND the account is connected: an agent is not shown tools it can do
  // nothing with. Registered and removed through the disposer `tools.register` returns, so a change of server or a disconnect
  // takes them away without a restart. A name that is already taken (another plugin) is logged, never thrown.

  let tools = null
  const live = new Map()
  const warned = new Set()

  // The person's choice in Settings › Connectors: with « composio » selected the agents are not offered these tools (nothing
  // chosen = as before: they exist while the server offers them and the account is connected).
  const chosenAway = () => { try { return providerChoice() === 'composio' } catch (e) { return false } }
  const wanted = () => connectionsEndpoint(server().profile) !== null && isConnected(readState()) === true && chosenAway() !== true

  const dropAll = () => {
    for (const dispose of live.values()) { try { dispose() } catch (e) { /* already gone with its scope */ } }
    live.clear()
  }

  const sync = () => {
    if (tools === null) return
    if (wanted() !== true) { dropAll(); return }
    for (const def of toolDefs()) {
      if (live.has(def.name)) continue
      try { live.set(def.name, tools.register(def)) } catch (e) {
        // Every few seconds this would say the same thing again: once per name and reason is enough.
        const why = def.name + ': ' + String((e && e.message) || e)
        if (!warned.has(why)) { warned.add(why); log('tool ' + why) }
      }
    }
  }

  /** `scope.tools`, when DSH has the tools service; `null` when it goes away. */
  const attach = (toolsService) => { dropAll(); tools = toolsService; sync() }
  const detach = () => { tools = null; live.clear() }

  /** Mounted from apply(): the tools follow the connection and the server, checked at start and every few seconds. */
  const mount = (ctx) => {
    ctx.inject(['tools'], (scope) => { attach(scope.tools) })
    ctx.effect(() => {
      stopped = false
      const timer = setInterval(sync, SYNC_EVERY_MS)
      if (typeof timer.unref === 'function') timer.unref()
      const first = setTimeout(() => { load() }, FIRST_LOAD_MS)
      if (typeof first.unref === 'function') first.unref()
      const hourly = setInterval(check, DUE_EVERY_MS)
      if (typeof hourly.unref === 'function') hourly.unref()
      return () => { stopped = true; clearInterval(timer); clearTimeout(first); clearInterval(hourly); dropAll(); detach() }
    }, 'kybernos-cloud: connections tools')
  }

  return { listRoute, appsRoute, logoRoute, itemRoute, linkRoute, deleteRoute, toolDefs, sync, attach, detach, mount, load }
}
