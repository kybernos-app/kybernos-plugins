// Kybernos connections, the host half (ADR 0008 of the server): the routes the connectors page calls and the three native tools the
// agents use. index.js hands over what it owns (the account's token, the call to the server, the active server) and mounts what
// comes back; the contract and every mapping are in connections.mjs. Nothing here keeps a connection, a key or a result on disk.
//
// The tools are registered natively and not as a `dsh-mcp-client` entry because an entry's headers are fixed when it loads: it would
// keep sending the token it started with through a re-pairing. Each call here reads the live token, and posts one JSON-RPC message
// to the server's endpoint (stateless: no `initialize` first).
import { connectionsEndpoint } from './server-profile.mjs'
import {
  asConnection, asConnectionList, asAppList, asLinked, connectionsFailure, connectionsPaths, isConnectionId, isToolkit, linkBody, rpcCall, rpcOutcome,
} from './connections.mjs'

/** A call to an app may run 30 s at the server (ADR 0008 § 5): wait a little longer than that, never less. */
const TOOL_TIMEOUT_MS = 40000
/** What an agent may send as `params` (the server's own bound, checked here first so nothing bigger is sent). */
const MAX_PARAMS_BYTES = 256 * 1024
const SYNC_EVERY_MS = 5000

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
  invalid_response: 'The server answered with something unexpected.',
  tool_error: 'The call failed.',
}
const explain = (error) => SAYS[error] !== undefined ? SAYS[error] : 'The call failed (' + String(error) + ').'

/**
 * @param {object} deps what index.js owns:
 *   apiCall(path, { method, token, body, base, timeoutMs }) → { status, body } (never throws, status 0 = network)
 *   readState() → the connection state (or null), isConnected(state), server() → { profile }
 */
export const createConnections = ({ apiCall, readState, isConnected, server, log = () => {} }) => {
  let rpcId = 0

  /** What this machine knows before any call: does this server offer connections, and is the account connected. */
  const gate = () => {
    const endpoint = connectionsEndpoint(server().profile)
    if (endpoint === null) return { done: { ok: true, offered: false, connected: isConnected(readState()) } }
    const state = readState()
    if (isConnected(state) !== true) return { done: { ok: false, offered: true, connected: false, error: 'non connecte' }, offered: true }
    return { endpoint, state }
  }

  const rest = async (g, path, { method = 'GET', body, named = false } = {}) => {
    const res = await apiCall(path, { method, token: g.state.token, ...(body === undefined ? {} : { body }) })
    const failure = connectionsFailure(res.status, res.body, { named })
    return failure === null ? { ok: true, body: res.body } : { ok: false, offered: true, connected: true, ...failure }
  }

  const listRoute = async (req) => {
    const g = gate()
    if (g.done !== undefined) return g.done
    const made = await rest(g, connectionsPaths.list + (queryOf(req).get('refresh') === '1' ? '?refresh=1' : ''))
    if (made.ok !== true) return made
    const list = asConnectionList(made.body)
    return list === null ? { ok: false, offered: true, connected: true, error: 'invalid_response' } : { ok: true, offered: true, connected: true, ...list }
  }

  const appsRoute = async () => {
    const g = gate()
    if (g.done !== undefined) return g.done
    const made = await rest(g, connectionsPaths.apps)
    if (made.ok !== true) return made
    const list = asAppList(made.body)
    return list === null ? { ok: false, offered: true, connected: true, error: 'invalid_response' } : { ok: true, offered: true, connected: true, ...list }
  }

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

  const wanted = () => connectionsEndpoint(server().profile) !== null && isConnected(readState()) === true

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
      const timer = setInterval(sync, SYNC_EVERY_MS)
      if (typeof timer.unref === 'function') timer.unref()
      return () => { clearInterval(timer); dropAll(); detach() }
    }, 'kybernos-cloud: connections tools')
  }

  return { listRoute, appsRoute, itemRoute, linkRoute, deleteRoute, toolDefs, sync, attach, detach, mount }
}
