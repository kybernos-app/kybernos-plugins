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
    if (c === 'connection_limit') return { error: 'connection_limit', limit: num(body.limit), count: num(body.count) }
    return { error: 'conflict' }
  }
  if (status === 413) return { error: 'too_large' }
  if (status === 422) return { error: c === 'no_managed_credentials' ? 'needs_api_key' : 'bad_request' }
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

/** `GET /v1/connections` → `{ configured, connections, limit, count, stale }`, or null when the answer is not that. */
export const asConnectionList = (body) => {
  const b = obj(body)
  if (!Array.isArray(b.connections)) return null
  const connections = b.connections.map(asConnection).filter((c) => c !== null)
  return {
    configured: b.configured !== false,
    connections,
    limit: Number.isFinite(b.limit) ? b.limit : null,
    // The server counts the pending ones too; without its number, what was actually read.
    count: Number.isFinite(b.count) ? b.count : connections.length,
    stale: b.stale === true,
  }
}

/** A toolkit of the catalogue. The logo is left out on purpose: it is a third-party address the page must not load by itself. */
export const asApp = (r) => {
  const row = obj(r)
  if (!isToolkit(row.slug)) return null
  return {
    slug: row.slug,
    name: typeof row.name === 'string' && row.name !== '' ? row.name : row.slug,
    categories: Array.isArray(row.categories) ? row.categories.filter((x) => typeof x === 'string').slice(0, 8) : [],
    description: typeof row.description === 'string' ? row.description.slice(0, 400) : '',
    needsApiKey: row.needs_api_key === true,
  }
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
