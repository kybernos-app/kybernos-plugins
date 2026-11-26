// Kybernos connections, the DSH side of the server's ADR 0008 (kybernos-server, docs/adr/0008-connections.md): the apps a person
// connects once (Gmail, GitHub...) through the server's own Composio Platform project, and that every agent of theirs can then use.
// This file is the pure half: where the routes are, what a row or a refusal means, how a tool call becomes a JSON-RPC message and
// its answer a result. No network, no file: index.js makes the calls with the device token.
//
// Two rules run through all of it. The page and the model only ever get WORDS for a refusal (the server's own text may echo what
// was sent), and an `api_key` typed for a toolkit with no OAuth goes to the server in one call and is never kept, logged or
// answered back, so nothing here returns, stores or formats one.

export const CONNECTIONS_BASE = '/v1/connections'

export const connectionsPaths = Object.freeze({
  list: CONNECTIONS_BASE,
  apps: CONNECTIONS_BASE + '/apps',
  // The same catalogue and its logos with no token: what a person who is not signed in sees (kybernos-server, ADR 0008 addendum).
  catalogue: CONNECTIONS_BASE + '/catalogue',
  catalogueLogo: (slug) => CONNECTIONS_BASE + '/catalogue/logo?slug=' + encodeURIComponent(slug),
  // The account's own logo route (older servers have only this one: it needs the token).
  logo: (slug) => CONNECTIONS_BASE + '/logo?slug=' + encodeURIComponent(slug),
  link: CONNECTIONS_BASE + '/link',
  one: (id) => CONNECTIONS_BASE + '/' + encodeURIComponent(id),
})

/** A connection id is the server's own UUID. Anything else is refused here, so nothing odd reaches a path. */
export const isConnectionId = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

/** A toolkit slug as Composio spells them (`github`, `googlecalendar`, `google_super`...): lower case, short. */
export const isToolkit = (v) => typeof v === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(v)

export const STATUSES = Object.freeze(['pending', 'active', 'failed', 'expired', 'disabled'])
const FAILURES = Object.freeze(['refused', 'upstream', 'unknown'])
/** The most an API key may be (the server's own bound); a longer one is not sent. */
export const MAX_API_KEY = 4096
export const MAX_ALIAS = 64

const code = (body) => (body !== null && body !== undefined && typeof body === 'object' && typeof body.error === 'string' ? body.error : '')
const obj = (v) => (v !== null && v !== undefined && typeof v === 'object' && !Array.isArray(v) ? v : {})
const num = (v) => (Number.isFinite(v) ? v : undefined)
const str = (v) => (typeof v === 'string' ? v : null)

/**
 * What a failed call to the REST routes means, or null for a success: `{ error, ...details }` where `error` is one word the page
 * translates. The server's own text never reaches the page. `named` says the call named a connection (or the toolkit of a link):
 * there a 404 means « not yours, gone, or not an app of this server » (the server answers all three the same), anywhere else it
 * means this server has no connections at all (an older one).
 */
export const connectionsFailure = (status, body, { named = false } = {}) => {
  const c = code(body)
  if (status >= 200 && status < 300) return null
  if (status === 0) return { error: 'network' }
  if (status === 401) return { error: 'reconnect_required' }
  if (status === 403) return { error: 'forbidden' }
  if (status === 404) return { error: named === true ? 'not_found' : 'not_on_this_server' }
  if (status === 409) {
    if (c === 'pending_exists') {
      const e = obj(body.existing)
      const existing = isConnectionId(e.id) && typeof e.toolkit === 'string' ? { id: e.id, toolkit: e.toolkit, status: STATUSES.includes(e.status) ? e.status : 'pending' } : undefined
      return { error: 'pending_exists', existing }
    }
    // `entitled: false` is the plan being the reason (the server's flat detail); absent on an older server, and then the page only knows a limit.
    if (c === 'connection_limit') return { error: 'connection_limit', limit: num(body.limit), count: num(body.count), ...(typeof body.entitled === 'boolean' ? { entitled: body.entitled } : {}) }
    return { error: 'conflict' }
  }
  if (status === 413) return { error: 'too_large' }
  if (status === 422) {
    if (c === 'no_managed_credentials') return { error: 'needs_api_key' }
    // The third party refused the key that was given (the server's `connection_failed`): the person is told to check it.
    return { error: c === 'connection_failed' ? 'connection_failed' : 'bad_request' }
  }
  if (status === 400) return { error: 'bad_request' }
  if (status === 429) return { error: 'too_many_requests' }
  if (status === 503 && c === 'connections_disabled') return { error: 'connections_disabled' }
  if (status === 502 || status === 503 || status === 504) {
    // `retry: "check_first"`: an add that may have gone through. The page lists the connections before it offers to try again.
    return { error: 'upstream_unavailable', checkFirst: obj(body).retry === 'check_first' }
  }
  return { error: 'refused_' + String(status) }
}

/** A server row → what the page uses. Nothing the server did not name (never a third-party account's e-mail or name). */
export const asConnection = (r) => {
  const row = obj(r)
  if (typeof row.id !== 'string' || row.id === '' || typeof row.toolkit !== 'string' || row.toolkit === '') return null
  const status = STATUSES.includes(row.status) ? row.status : 'unknown'
  return {
    id: row.id,
    toolkit: row.toolkit,
    status,
    accountType: row.account_type === 'oauth' || row.account_type === 'api_key' ? row.account_type : null,
    alias: str(row.alias),
    isDefault: row.is_default === true,
    createdAt: str(row.created_at),
    // A failure code only means something on a failed connection.
    failure: status === 'failed' ? (FAILURES.includes(row.failure) ? row.failure : 'unknown') : null,
  }
}

/** `GET /v1/connections` → `{ configured, connections, limit, entitled, count, stale }`, or null when the answer is not that. */
export const asConnectionList = (body) => {
  const b = obj(body)
  if (!Array.isArray(b.connections)) return null
  const connections = b.connections.map(asConnection).filter((c) => c !== null)
  return {
    configured: b.configured !== false,
    connections,
    limit: Number.isFinite(b.limit) ? b.limit : null,
    // Whether the plan includes connecting apps at all; null from a server that does not say (a limit of 0 is then only a limit).
    entitled: typeof b.entitled === 'boolean' ? b.entitled : null,
    // The server counts the pending ones too; without its number, what was actually read.
    count: Number.isFinite(b.count) ? b.count : connections.length,
    stale: b.stale === true,
  }
}

/** A toolkit of the catalogue. `logo` only says the server has one: the page asks this host for the picture (`/kybernos-cloud/connections/logo`),
 *  never a third-party address, so a page that is not signed in contacts nobody but the active server, through this machine. */
export const asApp = (r) => {
  const row = obj(r)
  if (!isToolkit(row.slug)) return null
  return {
    slug: row.slug,
    name: typeof row.name === 'string' && row.name !== '' ? row.name : row.slug,
    categories: Array.isArray(row.categories) ? row.categories.filter((x) => typeof x === 'string').slice(0, 8) : [],
    description: typeof row.description === 'string' ? row.description.slice(0, 400) : '',
    needsApiKey: row.needs_api_key === true,
    logo: typeof row.logo === 'string' && row.logo !== '',
  }
}

/** The most a logo may be: the server's own bound. */
export const MAX_LOGO_BYTES = 256 * 1024

/**
 * A logo is served by this host to an <img> (no script runs there), and the server already refused anything unsafe. Checked again here because this host
 * answers on a loopback address: a plain SVG only, no script, no embedded object, no event handler, no reference to anything but the file itself.
 */
export const safeLogo = (text) => {
  if (typeof text !== 'string' || text === '' || text.length > MAX_LOGO_BYTES) return false
  if (!/^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[^>[]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(text)) return false
  if (/<script|<foreignObject|<iframe|<object|<embed|<!ENTITY|<!DOCTYPE[^>]*\[|\son[a-z]+\s*=|javascript:|@import/i.test(text)) return false
  if (/(?:href|src)\s*=\s*["'](?!#)/i.test(text)) return false
  if (/url\(\s*(?!["']?#)/i.test(text)) return false
  return true
}

/** `GET /v1/connections/apps` → `{ configured, apps }`, or null. */
export const asAppList = (body) => {
  const b = obj(body)
  if (!Array.isArray(b.apps)) return null
  return { configured: b.configured !== false, apps: b.apps.map(asApp).filter((a) => a !== null) }
}

/**
 * What the page may ask to link, as the body of `POST /v1/connections/link`, or `{ error }`. Only the toolkit, the key and the
 * label go: never a `redirect_uri` (the server picks its own, because this page runs on a loopback address it does not list), never
 * a user id (the server derives it from the token).
 */
export const linkBody = (raw) => {
  const b = obj(raw)
  const toolkit = typeof b.toolkit === 'string' ? b.toolkit.trim().toLowerCase() : ''
  if (!isToolkit(toolkit)) return { error: 'bad_request' }
  const body = { toolkit }
  if (b.api_key !== undefined && b.api_key !== null && b.api_key !== '') {
    if (typeof b.api_key !== 'string' || b.api_key.trim() === '' || b.api_key.length > MAX_API_KEY) return { error: 'bad_request' }
    body.api_key = b.api_key.trim()
  }
  if (typeof b.alias === 'string' && b.alias.trim() !== '') body.alias = b.alias.trim().slice(0, MAX_ALIAS)
  return { body }
}

/** Where the person is sent to approve a connection. Only an https address (or a loopback one, for a test double): the page opens it. */
export const safeRedirect = (v) => {
  if (typeof v !== 'string' || v === '') return null
  try {
    const u = new URL(v)
    if (u.username !== '' || u.password !== '') return null
    if (u.protocol === 'https:') return u.href
    if (u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) return u.href
    return null
  } catch (e) { return null }
}

/** What a link answers → `{ connection, redirectUrl }`, or null when it is not an answer to a link. */
export const asLinked = (body) => {
  const b = obj(body)
  if (typeof b.id !== 'string' || b.id === '' || !STATUSES.includes(b.status)) return null
  return { id: b.id, status: b.status, redirectUrl: safeRedirect(b.redirect_url) }
}

// ── the MCP endpoint (ADR 0008 § 5) ───────────────────────────────────────────────────────────────────────────────────────

/** The three tools the endpoint serves, in the order an agent should use them. */
export const CONNECTION_TOOLS = Object.freeze(['connections_list', 'connections_search_tools', 'connections_execute'])

/** The most text one call may hand to the model (the server cuts at 1 MiB itself, with its own marker). */
export const MAX_RESULT_CHARS = 1024 * 1024
const CUT_MARK = '\n[cut: the result is longer than what the model is given]'

/** One JSON-RPC `tools/call`. No `initialize` first: the endpoint is stateless and serves a first request as it is. */
export const rpcCall = (name, args, id) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: obj(args) } })

const textOf = (result) => {
  const parts = Array.isArray(result.content) ? result.content.filter((p) => p !== null && typeof p === 'object' && p.type === 'text' && typeof p.text === 'string').map((p) => p.text) : []
  const text = parts.join('\n')
  return text.length > MAX_RESULT_CHARS ? text.slice(0, MAX_RESULT_CHARS) + CUT_MARK : text
}

/** The stable word a failed tool carries (`not_connected`, `connection_not_active`...), from its structured result or its JSON text. */
const toolCode = (result, text) => {
  const fromStructured = obj(result.structuredContent).code
  let c = typeof fromStructured === 'string' ? fromStructured : ''
  if (c === '') { try { const parsed = JSON.parse(text); if (typeof obj(parsed).code === 'string') c = parsed.code } catch (e) { /* plain text */ } }
  return /^[a-z][a-z0-9_]{0,39}$/.test(c) ? c : 'tool_error'
}

/**
 * What the endpoint answered to a `tools/call`: `{ ok: true, text }`, or `{ ok: false, error, text? }` where `error` is one word.
 * The door's own refusals (401, 403, 405, 413, 415, 429) are HTTP statuses; everything else, a tool's failure included, is a 200
 * whose body holds a JSON-RPC result or error. A tool's failure keeps its text, which says whether it is worth trying again.
 */
export const rpcOutcome = (status, body) => {
  if (status === 0) return { ok: false, error: 'network' }
  if (status === 401) return { ok: false, error: 'reconnect_required' }
  if (status === 403) return { ok: false, error: 'forbidden' }
  if (status === 429) return { ok: false, error: 'too_many_requests' }
  if (status !== 200) return { ok: false, error: 'refused_' + String(status) }
  const b = obj(body)
  if (b.error !== undefined) {
    const c = obj(b.error).code
    return { ok: false, error: c === -32602 ? 'invalid_params' : (c === -32601 ? 'not_on_this_server' : 'refused_rpc') }
  }
  const result = obj(b.result)
  if (!Array.isArray(result.content)) return { ok: false, error: 'invalid_response' }
  const text = textOf(result)
  if (result.isError === true) return { ok: false, error: toolCode(result, text), text }
  return { ok: true, text }
}

// ── the bridge (2026-11-20): the tools the server publishes ────────────────────────────────────────────────────────────
// The computer used to carry its own copy of the server's tools, so every new power of the server meant a new tool here and a new image. The endpoint now lists its tools (MCP `tools/list`)
// and the host registers the ones it does not already have, so a tool added at the server is there within a minute with nothing to build here. What it does to the world comes with it (the
// MCP `annotations`), and the gate reads that: a tool that only reads passes, one that changes nothing outside the person's own data passes in a request nobody found suspect, any other asks,
// and a tool with no annotation asks. Only names of this endpoint's own family are taken (`connections_…`): a published name can never replace a tool of the engine or of another plugin.

/** The `tools/list` message. */
export const rpcList = (id) => ({ jsonrpc: '2.0', id, method: 'tools/list' })

/**
 * Whether an action only reads, from what `connections_describe_tool` answered (its JSON text): `true` or `false` when the server said so in a boolean `read_only` (its own word: Composio's `readOnlyHint`),
 * `null` for anything else (no JSON, no field, not a boolean): no clear answer. The gate lets only `true` through with no tap.
 */
export const readOnlyOf = (text) => { try { const v = obj(JSON.parse(text)).read_only; return typeof v === 'boolean' ? v : null } catch (e) { return null } }
/** What a slug may look like before it is looked up: the same shape the server accepts. */
export const isActionSlug = (v) => typeof v === 'string' && /^[A-Za-z0-9_.-]{1,120}$/.test(v)

const BRIDGE_NAME = /^connections_[a-z0-9_]{1,48}$/
/** The most tools taken from one list: a list longer than this is a server gone wrong, not a catalogue. */
export const BRIDGE_MAX_TOOLS = 20

/** What a published tool does to the world: 'read' (it only reads), 'own' (it changes only the person's own Kybernos data: nothing destructive, nothing outside), 'ask' (anything else, and no annotation at all). */
export const bridgeKind = (annotations) => {
  const a = obj(annotations)
  if (a.readOnlyHint === true) return 'read'
  if (a.destructiveHint === false && a.openWorldHint === false) return 'own'
  return 'ask'
}

const words = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '')

/**
 * A published input schema in the small subset the engine enforces: types, properties, required, items, enum and descriptions, nothing else (a bound such as `minimum` is the server's to check).
 * An object with no declared property stays open (a free-form `params`); one the server closed stays closed.
 */
export const cleanSchema = (node, depth = 0) => {
  const n = obj(node)
  const description = words(n.description, 300)
  const base = description === '' ? {} : { description }
  if (depth > 4) return base
  switch (n.type) {
    case 'object': {
      const properties = {}
      for (const [k, v] of Object.entries(obj(n.properties)).slice(0, 30)) if (/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(k)) properties[k] = cleanSchema(v, depth + 1)
      const required = Array.isArray(n.required) ? n.required.filter((k) => typeof k === 'string' && Object.hasOwn(properties, k)) : []
      return { type: 'object', ...base, ...(Object.keys(properties).length > 0 ? { properties } : {}), ...(required.length > 0 ? { required } : {}), ...(n.additionalProperties === false ? { additionalProperties: false } : {}) }
    }
    case 'array': return { type: 'array', ...base, items: cleanSchema(n.items, depth + 1) }
    case 'string': case 'number': case 'integer': case 'boolean': {
      const kind = n.type === 'integer' ? 'number' : n.type
      const hasEnum = Array.isArray(n.enum) && n.enum.length > 0 && n.enum.length <= 50 && n.enum.every((e) => typeof e === kind)
      return { type: n.type, ...base, ...(hasEnum ? { enum: n.enum } : {}) }
    }
    default: return base
  }
}

/** What a `tools/list` answered → [{ name, description, parameters, kind }], or null when it is not a list (the tools already registered are then left as they are). */
export const asToolList = (status, body) => {
  if (status !== 200) return null
  const r = obj(obj(body).result)
  if (!Array.isArray(r.tools)) return null
  const out = new Map()
  for (const t of r.tools) {
    const o = obj(t)
    if (typeof o.name !== 'string' || !BRIDGE_NAME.test(o.name) || out.has(o.name)) continue
    const description = words(o.description, 1500)
    if (description === '') continue
    const parameters = cleanSchema(o.inputSchema)
    out.set(o.name, { name: o.name, description, parameters: parameters.type === 'object' ? parameters : { type: 'object', properties: {}, additionalProperties: false }, kind: bridgeKind(o.annotations) })
    if (out.size >= BRIDGE_MAX_TOOLS) break
  }
  return [...out.values()]
}
