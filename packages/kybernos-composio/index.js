// Composio host plugin.
//
// Measured at boot on 2026-09-17: the ck_ key only opens the MCP server
// connect.composio.dev/mcp (backend.composio.dev/api/v3 answers 401), and that
// server allows CORS from any origin. The client UI (client.js) therefore ALSO talks to
// the MCP directly, with the same key: one source.
//
// This host half also serves the Composio catalog (412 KB) on
// GET /kybernos/composio/catalog: catalog.js stays the source of truth on disk, read on
// demand and kept in memory, the same model as icons.json in kybernos-plugin. The client
// bundle no longer carries the data.
//
// It also exposes, READ-ONLY, the user's real connections on
// GET /kybernos/composio/connections?toolkits=gmail,googlecalendar. Why on the host rather
// than in the browser: the Connectors tab must show what Composio says without depending on
// a key kept in localStorage, without PII (user_info is never copied) and without a network
// failure breaking the page. The ACTIONS (add/remove) stay driven by the client through MCP.
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, chmodSync, readdirSync, realpathSync, renameSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { Script } from 'node:vm'
import * as nodeUtil from 'node:util'
import { mcpFailure, failureCode, decodeRpc, exchange } from './mcp-http.mjs'
import { probeHttp, probeStdio, redactDeep } from './mcp-probe.mjs'
import { readConnector } from './block-read.mjs'

export const name = 'kybernos-composio'

const CATALOG_PATH = fileURLToPath(new URL('./catalog.js', import.meta.url))
const CATALOG_ROUTE = '/kybernos/composio/catalog'
const CATALOG_CACHE_CONTROL = 'public, max-age=3600'
// In-memory cache: { body, etag }. catalog.js is only read on the first call.
let catalogCache = null

// ── real connections (read only) ────────────────────────────────────────────
const CONNECTIONS_ROUTE = '/kybernos/composio/connections'
const MCP_URL = 'https://connect.composio.dev/mcp'
// Never poll Composio in a loop: 120 s of cache is enough for the tab, and two concurrent
// requests share one promise (coalescing).
const CONNECTIONS_TTL_MS = 120 * 1000
// How long an old answer may still be served (flagged stale) when Composio fails.
const STALE_MAX_MS = 30 * 60 * 1000
// Adjustable: the tests shorten them. mcpMs covers a whole exchange, headers AND body.
export const TIMEOUTS = { mcpMs: 12000, proxyMs: 8000, slugsFailMs: 30 * 1000, testHttpMs: 12000, testStdioMs: 20000, retryDelayMs: 150 }
// Composio's MCP gateway answers 502 for about half of the requests at times (measured 2026-10-06 on the real
// account: 11 of 20 with one session, 12 of 20 initializes, 7 of 20 with none; any method, any toolkit). A
// read can simply be asked again; a write is not repeated (an add could create a second pending account).
const TRANSIENT_STATUS = ['502', '503', '504']
const RETRIES = 4
// A batch of 40 toolkits stays far below the measured batch (500 in about 760 ms).
const MAX_TOOLKITS = 40
// Deliberately strict grammar: a Composio slug is a flat identifier. It may start with an
// underscore: `_1password`, `_21risk` and `_2chat` are real slugs (they used to be dropped).
const SLUG_RE = /^[a-z0-9_][a-z0-9_-]{0,40}$/
// Credential reference passed as a bare string: the credentialRef mark is erased at run
// time (credentialRef('X') === 'X'), and a static import of @deepseek-ai/dsh-credentials
// would break the hermetic tests outside the DSH tree.
const COMPOSIO_KEY_REF = 'COMPOSIO_API_KEY'

// What is cached is keyed by a hash of the API KEY as well as by what was asked: after a key
// rotation (or a typo fixed) the old account's answers were served for up to 5 minutes.
const CACHE_MAX = 80
const keyId = (apiKey) => createHash('sha256').update(String(apiKey)).digest('hex').slice(0, 16)
const digestOf = (slugs) => createHash('sha256').update(slugs.slice().sort().join(',')).digest('hex').slice(0, 16)
/** Puts `value` last in `map` and drops the oldest entries beyond CACHE_MAX. */
function remember(map, key, value) {
  map.delete(key)
  map.set(key, value)
  while (map.size > CACHE_MAX) map.delete(map.keys().next().value)
}
// { at, result } by key + slugs. Entries are kept past their TTL so a failure can serve them stale.
const connectionsCache = new Map()
// Call in flight, shared: two identical requests = one fetch.
const connectionsInFlight = new Map()
// MCP sessions: one per API key, never shared between keys.
const sessions = new Map()
function sessionOf(apiKey) {
  const id = keyId(apiKey)
  let s = sessions.get(id)
  if (s === undefined) {
    s = { id: null, init: null }
    sessions.set(id, s)
    while (sessions.size > 4) sessions.delete(sessions.keys().next().value)
  }
  return s
}

/**
 * Reads catalog.js (the source of truth) and extracts the JSON array as it is, without
 * serializing it again: the body served is identical, byte for byte, to the literal in the
 * repository. Refuses to serve an unreadable body.
 */
function loadCatalog() {
  if (catalogCache !== null) return catalogCache
  const text = readFileSync(CATALOG_PATH, 'utf8')
  const match = /export const CATALOG = (\[[\s\S]*\]);/.exec(text)
  if (match === null) throw new Error('CATALOG not found in catalog.js')
  const body = match[1]
  JSON.parse(body)
  const etag = '"' + createHash('sha256').update(body).digest('hex').slice(0, 32) + '"'
  catalogCache = { body: body, etag: etag }
  return catalogCache
}

/**
 * Every slug the account scan asks about. The scan needs names (the MCP refuses an empty
 * list: "At least one toolkit is required", measured). The PUBLIC catalog (proxy, about 1559
 * apps) comes first; when the network fails, the local catalog (100 apps, key "s") stands in.
 * That fallback is NOT the whole catalog: it is cached only briefly (a failure used to pin it
 * for an hour) and a scan that used it is never reported as complete.
 */
const PROXY_APPS_URL = 'https://kybernos-proxy-production.up.railway.app/v1/connections/apps'
const SLUGS_TTL_MS = 60 * 60 * 1000
let candidateCache = null

/** Normalizes a list of slugs (deduplicated, validated by SLUG_RE). */
function slugsPropres(liste) {
  const out = []
  const seen = {}
  for (const brut of (Array.isArray(liste) === true ? liste : [])) {
    const slug = (typeof brut === 'string') ? brut : ''
    if (SLUG_RE.test(slug) !== true || seen[slug] === true) continue
    seen[slug] = true
    out.push(slug)
  }
  return out
}

/** { slugs, complete }: complete is true when the list comes from the public catalog. */
async function candidateSlugs() {
  if (candidateCache !== null && Date.now() - candidateCache.at < candidateCache.ttl) return candidateCache
  let slugs = []
  try {
    const out = await exchange(PROXY_APPS_URL, { method: 'GET' }, TIMEOUTS.proxyMs)
    if (out.res.ok === true) {
      const j = JSON.parse(out.raw)
      if (j !== null && j !== undefined && Array.isArray(j.apps) === true) slugs = slugsPropres(j.apps.map((a) => (a !== null && a !== undefined ? a.slug : '')))
    }
  } catch (e) { slugs = [] }
  const complete = slugs.length > 0
  if (complete === false) {
    let apps = []
    try { apps = JSON.parse(loadCatalog().body) } catch (e2) { apps = [] }
    slugs = slugsPropres(apps.map((a) => (a !== null && a !== undefined ? (a.s || a.slug) : '')))
  }
  candidateCache = { at: Date.now(), slugs: slugs, complete: complete, ttl: complete ? SLUGS_TTL_MS : TIMEOUTS.slugsFailMs }
  return candidateCache
}

// Account scan: about 1559 slugs in batches (measured: 4 batches of 400 in 3.5 s).
const SCAN_BATCH = 400
const SCAN_TTL_MS = 5 * 60 * 1000
const scanCache = new Map()
const scanInFlight = new Map()

/**
 * What the ACCOUNT has connected: only the toolkits that carry at least one account are kept
 * (an "initiated" toolkit without an account is not a connection). Returns
 * { connections, summary, error, partial, stale }:
 *  - error is the first failure code of a batch (401, 429, timeout...). The scan stops there:
 *    the next batches would fail the same way, and a rejected key must not be asked 4 times;
 *  - partial is true when the result is not the whole account (a batch failed, or the list
 *    of apps came from the 100-app local fallback);
 *  - only a complete scan is cached. A failed one serves the last complete scan of the SAME
 *    key, flagged stale, when there is one.
 */
async function scanAccountConnections(apiKey) {
  const id = keyId(apiKey)
  const cached = scanCache.get(id)
  if (cached !== undefined && Date.now() - cached.at < SCAN_TTL_MS) return cached.scan
  const running = scanInFlight.get(id)
  if (running !== undefined) return running
  const promise = (async () => {
    const candidates = await candidateSlugs()
    const gardees = []
    let error = null
    for (let i = 0; i < candidates.slugs.length; i += SCAN_BATCH) {
      const out = await readConnections(apiKey, candidates.slugs.slice(i, i + SCAN_BATCH))
      if (out.error !== null) { error = out.error; break }
      for (const c of out.result.connections) {
        if (c !== null && c !== undefined && Array.isArray(c.accounts) === true && c.accounts.length > 0) gardees.push(c)
      }
    }
    const actifs = gardees.filter((c) => String(c.status).toUpperCase() === 'ACTIVE').length
    const scan = {
      connections: gardees,
      summary: { totalToolkits: gardees.length, activeConnections: actifs, initiatedConnections: 0, failedConnections: gardees.length - actifs },
      error: error,
      partial: error !== null || candidates.complete !== true,
      stale: false,
    }
    if (scan.partial === false) { remember(scanCache, id, { at: Date.now(), scan: scan }); return scan }
    if (error !== null && cached !== undefined && Date.now() - cached.at < STALE_MAX_MS) return Object.assign({}, cached.scan, { error: error, stale: true })
    return scan
  })()
  scanInFlight.set(id, promise)
  try { return await promise } finally { if (scanInFlight.get(id) === promise) scanInFlight.delete(id) }
}

function sendJson(res, status, body, extraHeaders) {
  const headers = Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, extraHeaders || {})
  res.writeHead(status, headers)
  res.end(JSON.stringify(body))
}

function serveCatalog(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'GET expected' })
  let entry = null
  // The error never carries a path (a failed read used to put the absolute path in the body).
  try { entry = loadCatalog() } catch (e) { return sendJson(res, 500, { ok: false, error: fsMessage('the catalog cannot be read', e) }) }
  const headers = req.headers !== undefined && req.headers !== null ? req.headers : {}
  const inm = headers['if-none-match']
  if (typeof inm === 'string' && inm.indexOf(entry.etag) >= 0) {
    res.writeHead(304, { etag: entry.etag, 'cache-control': CATALOG_CACHE_CONTROL })
    res.end('')
    return
  }
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': CATALOG_CACHE_CONTROL,
    'etag': entry.etag,
    'content-length': String(Buffer.byteLength(entry.body)),
  })
  res.end(entry.body)
}

function emptySummary(total) {
  return { totalToolkits: total, activeConnections: 0, initiatedConnections: 0, failedConnections: 0 }
}

function emptyConnections(total) {
  return { connections: [], summary: emptySummary(total) }
}

function queryOf(req) {
  try { return new URL((req && req.url) || '/', 'http://localhost').searchParams } catch (e) { return new URLSearchParams() }
}

/**
 * Extracts the requested toolkit list. Each slug is lower-cased and validated by SLUG_RE,
 * duplicates are dropped and the batch is capped at 40: a doubtful slug is ignored silently
 * (never an error: the page must not break over a parameter).
 */
function parseToolkits(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return []
  const out = []
  const seen = {}
  for (const part of raw.split(',')) {
    const slug = part.trim().toLowerCase()
    if (SLUG_RE.test(slug) !== true) continue
    if (seen[slug] === true) continue
    seen[slug] = true
    out.push(slug)
    if (out.length >= MAX_TOOLKITS) break
  }
  return out
}

/**
 * Reads COMPOSIO_API_KEY in the DSH .env: the fallback when the credentials service is missing.
 * The file is read the way DSH reads it (node:util parseEnv): an `export` prefix, quotes, an
 * inline comment and a variable defined twice (the last line wins) all give the value DSH
 * itself ends up with. The old regex took the first line and kept `ck_abc # work account`.
 */
function readEnvKey() {
  try {
    const text = readFileSync(join(DSH_HOME(), '.env'), 'utf8')
    const parsed = parseEnvText(text)
    let value = parsed !== null ? parsed.COMPOSIO_API_KEY : undefined
    if (parsed === null) {
      // No parseEnv (it exists in every Node DSH runs on): the plain rules, last line wins.
      const all = Array.from(text.matchAll(/^[ \t]*(?:export[ \t]+)?COMPOSIO_API_KEY[ \t]*=[ \t]*(.*)$/gm))
      if (all.length > 0) {
        value = all[all.length - 1][1].trim()
        const quoted = /^(["'`])(.*)\1/.exec(value)
        value = quoted !== null ? quoted[2] : value.replace(/\s+#.*$/, '')
      }
    }
    value = typeof value === 'string' ? value.trim() : ''
    return value.length === 0 ? null : { value: value, source: 'env-file' }
  } catch (e) { return null }
}

/**
 * Resolves the Composio key at EVERY request (the secret is never cached: a changed key must
 * take effect without restarting the plugin). The credentials service layers the environment DSH
 * was launched with, its own store and the `.env` files. Measured in its source: the `.env` layers
 * are what the launch read, not the file as it is now, so a key saved from the page a minute ago would
 * be invisible to it until the next start. The environment and the store (which DSH watches) are
 * taken as it says; a value that comes from a `.env` is read again from the file, and when the
 * service resolves nothing the file is read too. Never throws.
 */
async function resolveComposioKey(ctx) {
  let creds = undefined
  try { creds = typeof ctx.get === 'function' ? ctx.get('credentials') : undefined } catch (e) { creds = undefined }
  if (creds !== null && creds !== undefined && typeof creds.resolve === 'function') {
    try {
      const got = await creds.resolve(COMPOSIO_KEY_REF)
      if (got !== null && got !== undefined && typeof got.value === 'string' && got.value.length > 0) {
        const source = String(got.source || 'credentials')
        if (source === 'env' || source === 'file') return { value: got.value, source: source }
        const fresh = readEnvKey()
        return fresh !== null ? fresh : { value: got.value, source: source }
      }
      return readEnvKey()
    } catch (e) { return readEnvKey() }
  }
  return readEnvKey()
}

// ── MCP transport: the HTTP helpers live in mcp-http.mjs ─────────────────────

async function mcpPost(apiKey, body, retry) {
  const sess = sessionOf(apiKey)
  for (let attempt = 0; ; attempt += 1) {
    const headers = {
      'content-type': 'application/json',
      'accept': 'application/json, text/event-stream',
      'x-consumer-api-key': apiKey,
    }
    if (sess.id !== null) headers['mcp-session-id'] = sess.id
    const out = await exchange(MCP_URL, { method: 'POST', headers: headers, body: JSON.stringify(body) }, TIMEOUTS.mcpMs)
    const res = out.res
    const sid = res.headers !== null && res.headers !== undefined && typeof res.headers.get === 'function' ? res.headers.get('mcp-session-id') : null
    if (typeof sid === 'string' && sid.length > 0) sess.id = sid
    // Only a gateway error is asked again (a timeout already cost its whole deadline), and only a read.
    if (retry === true && attempt < RETRIES && TRANSIENT_STATUS.indexOf(String(res.status)) >= 0) {
      await new Promise((resolve) => setTimeout(resolve, TIMEOUTS.retryDelayMs * (attempt + 1)))
      continue
    }
    if (res.status === 401) throw mcpFailure('401')
    if (res.status === 429) throw mcpFailure('429')
    if (res.ok !== true) throw mcpFailure(String(res.status))
    return decodeRpc(out.raw)
  }
}

/** initialize once per key; a failure can be retried on the next call. */
function mcpInitialize(apiKey) {
  const sess = sessionOf(apiKey)
  if (sess.init !== null) return sess.init
  sess.id = null
  const init = mcpPost(apiKey, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'kybernos-host', version: '1.0' } },
  }, true).then((reply) => {
    if (reply === null || typeof reply !== 'object') throw mcpFailure('bad-response')
    if (reply.error !== undefined && reply.error !== null) throw mcpFailure('rpc-error')
    if (reply.result === undefined) throw mcpFailure('bad-response')
    return reply
  })
  sess.init = init
  init.catch(() => { if (sess.init === init) sess.init = null })
  return init
}

/** tools/call returns the JSON text in result.content[].text (sometimes structured). */
function toolPayload(result) {
  if (result === null || result === undefined) return null
  const content = Array.isArray(result.content) ? result.content : []
  const block = content.find((item) => item !== null && item !== undefined && typeof item.text === 'string')
  if (block === undefined) return result
  try { return JSON.parse(block.text) } catch (e) { return block.text }
}

// A tool error that says the key is the problem is a 401, whatever the transport said.
const AUTH_TEXT_RE = /unauthori[sz]ed|invalid[^a-z]{0,3}(api[^a-z]{0,3})?key|not authenticated|authentication|forbidden/i
const textOf = (result) => {
  const block = (result !== null && result !== undefined && Array.isArray(result.content) ? result.content : []).find((x) => x !== null && x !== undefined && typeof x.text === 'string')
  return block === undefined ? '' : block.text.slice(0, 400)
}

/**
 * Calls a tool. The session is initialized first (once per key); an expired session (the
 * server answers 404) is started again, once, instead of failing every call until the next
 * restart.
 */
async function mcpToolCall(apiKey, toolName, args) {
  // A call that only reads (every toolkit asks for a list) may be repeated on a gateway error; add and remove are not.
  const reads = args !== null && args !== undefined && Array.isArray(args.toolkits) && args.toolkits.length > 0 && args.toolkits.every((t) => t !== null && t !== undefined && t.action === 'list')
  const attempt = async () => {
    await mcpInitialize(apiKey)
    return mcpPost(apiKey, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: toolName, arguments: args } }, reads)
  }
  try { return await attempt() } catch (e) {
    if (failureCode(e) !== '404') throw e
    const sess = sessionOf(apiKey)
    sess.id = null
    sess.init = null
    return attempt()
  }
}

async function mcpListConnections(apiKey, slugs) {
  return mcpManage(apiKey, slugs.map((name) => ({ name: name, action: 'list' })))
}

/** COMPOSIO_MANAGE_CONNECTIONS for the given toolkit actions: the answer's payload, or a failure with a code. */
async function mcpManage(apiKey, toolkits) {
  const reply = await mcpToolCall(apiKey, 'COMPOSIO_MANAGE_CONNECTIONS', { toolkits: toolkits })
  // Every way the answer can be something other than a list of connections is a FAILURE with a
  // code: an HTML page, a JSON-RPC error and a tool error used to read as "no connection".
  if (reply === null || reply === undefined || typeof reply !== 'object') throw mcpFailure('bad-response')
  if (reply.error !== undefined && reply.error !== null) throw mcpFailure('rpc-error')
  const result = reply.result
  if (result === null || result === undefined || typeof result !== 'object') throw mcpFailure('bad-response')
  if (result.isError === true) throw mcpFailure(AUTH_TEXT_RE.test(textOf(result)) ? '401' : 'tool-error')
  const payload = toolPayload(result)
  if (payload === null || payload === undefined || typeof payload !== 'object') throw mcpFailure('bad-response')
  if (payload.successful === false) throw mcpFailure(AUTH_TEXT_RE.test(String(payload.error || '')) ? '401' : 'tool-error')
  return payload
}

/**
 * Projects the Composio answer onto the frozen contract of the Kybernos client. Hard no-PII
 * rule: only id, alias, status, accountType and isDefault leave here; user_info and any secret
 * value are deliberately left out.
 */
function normalizeConnections(payload, slugs) {
  const root = payload !== null && payload !== undefined && typeof payload === 'object' ? payload : {}
  const data = root.data !== null && root.data !== undefined && typeof root.data === 'object' ? root.data : root
  const results = data.results !== null && data.results !== undefined && typeof data.results === 'object' ? data.results : {}
  const rawSummary = data.summary !== null && data.summary !== undefined && typeof data.summary === 'object' ? data.summary : {}
  const connections = []
  let active = 0
  let initiated = 0
  let failed = 0
  for (const slug of slugs) {
    const info = results[slug] !== null && results[slug] !== undefined && typeof results[slug] === 'object' ? results[slug] : {}
    const accounts = Array.isArray(info.accounts) ? info.accounts : []
    const mapped = []
    for (const account of accounts) {
      const a = account !== null && account !== undefined && typeof account === 'object' ? account : {}
      const state = String(a.status !== undefined && a.status !== null ? a.status : '').toLowerCase()
      if (state === 'active') active += 1
      else if (state === 'initiated') initiated += 1
      else if (state === 'failed') failed += 1
      const alias = typeof a.alias === 'string' && a.alias.trim().length > 0 ? a.alias.trim() : null
      const rawType = typeof a.account_type === 'string' && a.account_type.length > 0 ? a.account_type : (typeof a.accountType === 'string' && a.accountType.length > 0 ? a.accountType : null)
      mapped.push({
        id: String(a.id !== undefined && a.id !== null ? a.id : (a.connectedAccountId !== undefined && a.connectedAccountId !== null ? a.connectedAccountId : '')),
        alias: alias,
        status: state,
        accountType: rawType === null ? null : rawType.toUpperCase(),
        isDefault: a.is_default === true || a.isDefault === true,
      })
    }
    connections.push({ toolkit: slug, status: String(info.status !== undefined && info.status !== null ? info.status : '').toLowerCase(), accounts: mapped })
  }
  const numberOr = (value, fallback) => (typeof value === 'number' && isFinite(value) === true ? value : fallback)
  return {
    connections: connections,
    summary: {
      totalToolkits: numberOr(rawSummary.total_toolkits, slugs.length),
      activeConnections: numberOr(rawSummary.active_connections, active),
      initiatedConnections: numberOr(rawSummary.initiated_connections, initiated),
      failedConnections: numberOr(rawSummary.failed_connections, failed),
    },
  }
}

/**
 * Reads the connections with a TTL cache and coalescing of concurrent calls. A failure never
 * propagates an exception: the last good result of the SAME key and slugs is returned (stale),
 * or an empty list, with an error code the UI can show.
 */
async function readConnections(apiKey, slugs, fresh) {
  const key = keyId(apiKey) + ':' + digestOf(slugs)
  const kept = () => { const c = connectionsCache.get(key); return c !== undefined && Date.now() - c.at < STALE_MAX_MS ? c : null }
  const cached = connectionsCache.get(key)
  if (fresh !== true && cached !== undefined && Date.now() - cached.at < CONNECTIONS_TTL_MS) return { result: cached.result, stale: false, error: null }
  let promise = connectionsInFlight.get(key)
  const owner = promise === undefined
  if (owner) {
    promise = mcpListConnections(apiKey, slugs).then((payload) => normalizeConnections(payload, slugs))
    connectionsInFlight.set(key, promise)
  }
  try {
    const result = await promise
    if (owner) remember(connectionsCache, key, { at: Date.now(), result: result })
    return { result: result, stale: false, error: null }
  } catch (e) {
    const prior = kept()
    return { result: prior === null ? emptyConnections(slugs.length) : prior.result, stale: prior !== null, error: failureCode(e) }
  } finally {
    if (owner && connectionsInFlight.get(key) === promise) connectionsInFlight.delete(key)
  }
}

/**
 * GET /kybernos/composio/connections?toolkits=a,b: read only, never a 5xx: a missing key and an
 * MCP failure both answer 200 so the page survives. `error` says what failed ('no-credential',
 * '401', '429', 'timeout'...): an empty list with an error is NOT "nothing connected".
 */
async function serveConnections(ctx, req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'GET expected' })
  const rawToolkits = queryOf(req).get('toolkits')
  const demandes = parseToolkits(rawToolkits)
  const credential = await resolveComposioKey(ctx)
  if (credential === null) return sendJson(res, 200, { ok: true, configured: false, stale: false, error: 'no-credential', connections: [], summary: emptySummary(demandes.length) })
  // A toolkits list was given but not one slug of it is valid (`Gmail` is fixed by the
  // lower-casing; "google calendar" or `bash(git *)` are not slugs): answer for those, which is
  // nothing. It used to fall through to the FULL account scan, a thousand probes for a typo.
  if (demandes.length === 0 && typeof rawToolkits === 'string' && rawToolkits.trim().length > 0) {
    return sendJson(res, 200, { ok: true, configured: true, stale: false, error: 'invalid-toolkits', connections: [], summary: emptySummary(0) })
  }
  // No tool named: the page asks "what is ALREADY connected". The key only lives on the host and
  // the MCP has no "list everything", so the account is scanned here in batches, and only what
  // carries an account is returned.
  if (demandes.length === 0) {
    try {
      const scan = await scanAccountConnections(credential.value)
      return sendJson(res, 200, { ok: true, configured: true, stale: scan.stale === true, error: scan.error, partial: scan.partial === true, connections: scan.connections, summary: scan.summary, scan: true })
    } catch (e) {
      return sendJson(res, 200, { ok: true, configured: true, stale: false, error: failureCode(e), partial: true, connections: [], summary: emptySummary(0), scan: true })
    }
  }
  // `fresh=1` skips the 2 minute cache for a few toolkits: the page polls an account while it is being authorized.
  const out = await readConnections(credential.value, demandes, queryOf(req).get('fresh') === '1' && demandes.length <= 5)
  sendJson(res, 200, { ok: true, configured: true, stale: out.stale, error: out.error, connections: out.result.connections, summary: out.result.summary })
}

// ── custom connectors (POST/GET/DELETE, written by the form) ────────────────
// The Composio tab's form talks to THESE routes; the user never sees the YAML or the .env.
// The structured source of truth is the JSON sidecar (~/.dsh/kybernos/connecteurs.json),
// for round-trip editing; the marked block in cordis.patch.yml is the derived rendering the
// DSH loader consumes. A connector written by the skill (a block without a sidecar entry)
// is still listed, read only.
const CONNECTEURS_ROUTE = '/kybernos/composio/connecteurs'
// The contract the page speaks with this half. The page reloads by itself when its file changes but this half only
// loads when DSH starts, so after an update the page can be newer than the host: GET /connecteurs and GET /key
// say which version they are, and a page that finds none (or another) tells the person to restart DSH instead of
// saving through routes that do not know the new fields (an old host would rewrite a skill's block without its args).
export const API_VERSION = 2
/**
 * The DSH home, the way DSH resolves it (dsh-home-paths) and kybernos-theme does: DSH_HOME
 * when it is set and not blank (`~` expanded), else <home of the OS user>/.dsh. Everything
 * this bundle reads or writes under the DSH home goes through here, so a person who moved
 * the home (DSH_HOME) gets the key, the .env, the patch and the sidecar where DSH looks.
 * Resolved at every call: nothing is cached, so a test or a restart-free change is honoured.
 */
export function resolveDshHome(env = process.env, osHome = homedir) {
  const fromEnv = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  if (fromEnv === '') return join(osHome(), '.dsh')
  if (fromEnv === '~') return osHome()
  return resolve(fromEnv.startsWith('~/') || fromEnv.startsWith('~\\') ? join(osHome(), fromEnv.slice(2)) : fromEnv)
}
const DSH_HOME = () => resolveDshHome()
const PATCH_PATH = () => join(DSH_HOME(), 'profiles', 'web', 'cordis.patch.yml')
const SIDECAR_PATH = () => join(DSH_HOME(), 'kybernos', 'connecteurs.json')
const ENV_PATH = () => join(DSH_HOME(), '.env')
// 2 to 31 characters (the error message always said so; a single letter used to pass).
const NOM_RE = /^[a-z][a-z0-9-]{1,30}$/
// Names the connector form must not take: the bundle's own MCP entry is `composio` (id and
// serverName), and dsh-mcp-client throws "serverName already in use" for a second one.
const RESERVED_NAMES = ['composio']
const SECRET_RE = /^[A-Z_][A-Z0-9_]{0,63}$/
// Variable names DSH refuses in a `.env` file: at boot, loadLayeredEnv throws
// "<file> sets <NAME>, which only the launching environment may set" and DSH does not
// start at all. A secret with one of these names must never reach ~/.dsh/.env.
// Hard-coded copy of BOOTSTRAP_NAMES / BOOTSTRAP_PREFIXES in @deepseek-ai/dsh-app-boot
// (lib/index.js), identical in every engine we validated (0.1.7-alpha.1 to 0.2.0-rc.2).
// The proxy names are refused too although DSH tolerates them in the home `.env`: a
// connector form has no business choosing the route of every request.
const BOOTSTRAP_NAMES = new Set([
  'PATH', 'HOME', 'USERPROFILE', 'SHELL', 'NODE_OPTIONS', 'NODE_PATH', 'NODE_EXTRA_CA_CERTS',
  'LD_PRELOAD', 'LD_LIBRARY_PATH', 'LD_AUDIT', 'BASH_ENV', 'ENV', 'SHELLOPTS', 'BASHOPTS',
  'PERL5OPT', 'PERL5LIB', 'PYTHONSTARTUP', 'PYTHONPATH', 'RUBYOPT', 'RUBYLIB',
  'JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS', 'JDK_JAVA_OPTIONS', 'PYTHONHOME',
  'GIT_SSH', 'GIT_SSH_COMMAND', 'GIT_EXTERNAL_DIFF', 'GIT_PAGER', 'GIT_EDITOR', 'GIT_ASKPASS', 'SSH_ASKPASS',
  'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_COUNT', 'EDITOR', 'VISUAL', 'PAGER', 'BROWSER',
  'DEEPSEEK_BASE_URL', 'DEEPSEEK_SEARCH_BASE_URL', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'REQUESTS_CA_BUNDLE', 'CURL_CA_BUNDLE', 'NODE_TLS_REJECT_UNAUTHORIZED',
])
const BOOTSTRAP_PREFIXES = ['DSH_', 'XDG_', 'DYLD_', 'BASH_FUNC_']

/** True when DSH would refuse `name` in a `.env` file (see BOOTSTRAP_NAMES above). Exported for test-host.mjs. */
export function isBootstrapOnlyName(name) {
  const upper = String(name).toUpperCase()
  return BOOTSTRAP_NAMES.has(upper) || BOOTSTRAP_PREFIXES.some((prefix) => upper.startsWith(prefix))
}
const bootstrapMessage = (nom) => 'secret ' + nom + ': DSH refuses this variable name in its .env file (only the launching environment may set it), so DSH would not start. Pick another name.'
// The banner is written into the user's patch and looked for by its first words: it stays as
// it was (French) so the files already on disk keep matching.
const DEFAULT_TOOL_TIMEOUT_MS = 180000
const BANNER = '# ── CONNECTEURS PERSONNALISÉS (géré par le formulaire et la skill connecteur-personnalise) ────'
// Secret token in a form value: "Bearer $TAVILY_API_KEY" -> the server generates the
// process.env reference; the value is never stored in the patch nor returned by GET.
const TOKEN_RE = /\$([A-Z_][A-Z0-9_]*)/g

// ── K-01: guards on the routes that act ─────────────────────────────────────
// EXACT origin of the real socket (2026-10 acceptance M-02/S-03): a cross-site (drive-by)
// POST must never register a stdio connector, it would be launched when DSH restarts.
function origineOK(req) {
  const o = String(req.headers.origin || '')
  if (o === '') return true
  try {
    const u = new URL(o)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const port = (req.socket && typeof req.socket.localPort === 'number') ? ':' + req.socket.localPort : ''
    return ['127.0.0.1' + port, 'localhost' + port, '[::1]' + port].indexOf(u.host) >= 0
  } catch (e) { return false }
}
// POSTs that write require explicit JSON: a cross-site text/plain goes through without a
// preflight, so it is refused.
function jsonSeulement(req) {
  return String(req.headers['content-type'] || '').toLowerCase().includes('application/json')
}
// The stdio command of a connector must be a known SYSTEM executable: an absolute path, an
// existing executable file under a root the user cannot write to. A binary put in the home
// (or /tmp) is not acceptable through this free POST: it goes through the validated setup
// (skill connecteur-personnalise).
// ASSUMED choice (K-01 review): /usr/local/bin and /opt/homebrew/bin are writable by the
// local user (brew). The threat aimed at is the cross-site DRIVE-BY (blocked by the exact
// origin + JSON): a local attacker who can write to /opt/homebrew/bin does not need this
// route to run code. The list therefore does NOT change.
const RACINES_STDIO_OK = ['/usr/bin', '/bin', '/usr/sbin', '/sbin', '/usr/local/bin', '/usr/local/sbin', '/opt/homebrew/bin', '/opt/homebrew/sbin']
// The person can add folders to that list (uvx lives in ~/.local/bin, a node from nvm under ~/.nvm): one
// explicit confirmation in the page, kept in <DSH home>/kybernos/connecteurs-roots.json. A folder is only
// ever a root while it is still one nobody else can write to, checked at every use, never once.
const ROOTS_PATH = () => join(DSH_HOME(), 'kybernos', 'connecteurs-roots.json')
const NEVER_ROOTS = () => {
  const list = ['/', '/tmp', '/var', '/var/tmp', '/private', '/private/tmp', '/Users', '/home', homedir(), tmpdir()]
  for (const d of list.slice()) { try { list.push(realpathSync(d)) } catch (e) { /* not there */ } }
  return list
}
/** Why `dir` cannot be a folder commands are accepted from, or null when it can. Exported for test-host.mjs. */
export function rootProblem(dir) {
  if (typeof dir !== 'string' || dir.length === 0 || dir.startsWith('/') !== true) return 'the folder must be an absolute path'
  if (dir.length > 400 || /[\0-\x1f]/.test(dir) === true || dir.split('/').indexOf('..') >= 0 || (dir.length > 1 && dir.endsWith('/'))) return 'the folder path is not clean'
  if (NEVER_ROOTS().some((n) => resolve(n) === dir)) return 'this folder is too broad to be trusted'
  let st = null
  try { st = statSync(dir) } catch (e) { return 'the folder does not exist' }
  if (st.isDirectory() !== true) return 'it is not a folder'
  try { if (realpathSync(dir) !== dir) return 'the folder is a link (or has one in its path): give the real folder' } catch (e) { return 'the folder cannot be resolved' }
  if ((st.mode & 0o022) !== 0) return 'other users can write in this folder, so a program could be swapped in it'
  if (typeof process.getuid === 'function' && st.uid !== 0 && st.uid !== process.getuid()) return 'the folder belongs to someone else'
  return null
}
/** The extra folders the person confirmed that still pass rootProblem. */
function extraRoots() {
  try {
    const j = JSON.parse(readFileSync(ROOTS_PATH(), 'utf8'))
    return (Array.isArray(j.extra) ? j.extra : []).filter((d) => rootProblem(d) === null)
  } catch (e) { return [] }
}
const writeExtraRoots = (list) => { mkdirSync(dirname(ROOTS_PATH()), { recursive: true, mode: 0o700 }); writeFileAtomic(ROOTS_PATH(), JSON.stringify({ extra: list }, null, 2) + '\n', 0o600) }
/**
 * Where a program of this name can be found, for the page to propose: [{ path, dir, allowed }]. `allowed`
 * says whether that folder is already accepted. Looks in the accepted folders first, then in this
 * process's PATH and a few places people install to; only executable regular files count.
 */
function commandHelp(command) {
  const name = basename(String(command === null || command === undefined ? '' : command))
  if (/^[A-Za-z0-9][A-Za-z0-9._+-]{0,60}$/.test(name) !== true) return []
  const ok = RACINES_STDIO_OK.concat(extraRoots())
  const h = homedir()
  const dirs = [].concat(ok, String(process.env.PATH || '').split(':'), [join(h, '.local', 'bin'), join(h, '.cargo', 'bin'), join(h, '.bun', 'bin'), join(h, '.volta', 'bin')])
  const seen = {}
  const out = []
  for (const d of dirs) {
    if (typeof d !== 'string' || d.startsWith('/') !== true || seen[d] === true) continue
    seen[d] = true
    try {
      const st = statSync(join(d, name))
      if (st.isFile() === true && (st.mode & 0o111) !== 0) out.push({ path: join(d, name), dir: d, allowed: ok.indexOf(d) >= 0 })
    } catch (e) { /* not there */ }
    if (out.length >= 6) break
  }
  return out
}
function commandStdioOK(command) {
  if (typeof command !== 'string' || command.length === 0) return false
  if (/[\s\0-\x1f]/.test(command) === true) return false // no whitespace or control character: one clean path
  if (command.startsWith('/') !== true) return false
  const sousRacine = RACINES_STDIO_OK.concat(extraRoots()).some((r) => command === r || command.startsWith(r + '/'))
  if (sousRacine !== true) return false
  try {
    const st = statSync(command)
    return st.isFile() === true && (st.mode & 0o111) !== 0
  } catch (e) { return false }
}

// A YAML double-quoted scalar. JSON.stringify output is valid YAML: every escape it
// writes (\" \\ \n \r \t \b \f \uXXXX) exists in YAML, so a value can neither end its
// scalar early nor carry a raw control character, whatever it holds.
const yamlScalaire = (v) => JSON.stringify(String(v === null || v === undefined ? '' : v))

/**
 * Renders a form value as a YAML scalar. A value without a valid `$NAME` token is a
 * plain quoted string, `$` included (a password like "pa$$word" stays as typed). A value
 * with tokens becomes a `!!js` expression made of JSON string literals joined to
 * `(process.env.NAME || '')` references: the secret is read at load time and never
 * stored in the patch. The expression is itself JSON-quoted as the YAML scalar.
 */
function renderValue(raw) {
  const v = String(raw === null || raw === undefined ? '' : raw)
  const parts = []
  let last = 0
  let m
  const re = new RegExp(TOKEN_RE.source, 'g')
  while ((m = re.exec(v)) !== null) {
    if (m.index > last) parts.push(JSON.stringify(v.slice(last, m.index)))
    parts.push("(process.env." + m[1] + " || '')")
    last = m.index + m[0].length
  }
  if (parts.length === 0) return yamlScalaire(v)
  if (last < v.length) parts.push(JSON.stringify(v.slice(last)))
  return '!!js ' + JSON.stringify(parts.join(' + '))
}

function readPatchText() { return existsSync(PATCH_PATH()) ? readFileSync(PATCH_PATH(), 'utf8') : '' }

const MARKER_RE = /^# connecteur:([a-z0-9-]+)\s*$/

/**
 * The marked blocks of the patch, as line ranges { nom, start, end } (end excluded).
 * A block starts at its `# connecteur:<nom>` marker and takes the lines that belong to
 * it: its own `- insert:` line and every blank or indented line after it. It ends at
 * the first other top-level line (a comment, or the `- insert:` of a block that another
 * writer appended: kybernos-workers and the Outils tab append such blocks) or at the next
 * marker. Trailing blank lines are not part of it. It used to run to the next marker or
 * to the end of the file, so editing or deleting a connector ate everything after it.
 * Blocks written before this rule have the same shape, so they are read the same way.
 */
function findBlocks(lines) {
  const out = []
  for (let i = 0; i < lines.length; i += 1) {
    const m = MARKER_RE.exec(lines[i])
    if (m === null) continue
    let end = i + 1
    let head = false
    for (let j = i + 1; j < lines.length; j += 1) {
      const l = lines[j]
      if (l.trim() === '') continue
      if (/^[ \t]/.test(l)) { end = j + 1; continue }
      if (head === false && end === i + 1 && /^-[ \t]/.test(l)) { head = true; end = j + 1; continue }
      break
    }
    out.push({ nom: m[1], start: i, end: end })
  }
  return out
}

/** The text of each marked block, by connector name (the first one when a name is repeated). */
export function patchBlocks(text) {
  const lines = String(text).split('\n')
  const out = {}
  for (const b of findBlocks(lines)) if (out[b.nom] === undefined) out[b.nom] = lines.slice(b.start, b.end)
  return out
}

/** The value of `key:` on a block line, whether bare, 'single' or "double" quoted. */
function scalarOf(lines, key) {
  const re = new RegExp('^[ \\t]+' + key + ':[ ]*(?:"((?:[^"\\\\]|\\\\.)*)"|\'((?:[^\']|\'\')*)\'|([^\\s\'"#]+))')
  for (const l of lines) {
    const m = re.exec(l)
    if (m === null) continue
    if (m[1] !== undefined) { try { return JSON.parse('"' + m[1] + '"') } catch (e) { return null } }
    if (m[2] !== undefined) return m[2].replace(/''/g, "'")
    return m[3]
  }
  return null
}

/** Minimal read of a block (transport, serverName, url or command). */
function blockSummary(lines) {
  const transport = scalarOf(lines, 'transport')
  return {
    transport: transport === 'streamable-http' ? 'streamable-http' : 'stdio',
    serverName: scalarOf(lines, 'serverName'),
    url: scalarOf(lines, 'url'),
    command: scalarOf(lines, 'command'),
  }
}

// ── the connectors sidecar (~/.dsh/kybernos/connecteurs.json) ───────────────
const CORRUPT_SUFFIX = '.corrupt-'
const CORRUPT_COPIES_MAX = 5

/**
 * The sidecar on disk, in one of three shapes:
 *   - `{ list }`               a JSON array of connectors; a MISSING or blank file is an empty list
 *   - `{ corrupt: true, text }` present but not such an array (truncated, hand-edited)
 *   - `{ unreadable: code }`   present but cannot be read (permissions, a directory...)
 * Only the first shape may be written over: the other two would lose the saved connectors
 * (a corrupt file used to be read as an empty list and overwritten by the next save).
 */
function readSidecarState() {
  let text = null
  try { text = readFileSync(SIDECAR_PATH(), 'utf8') } catch (e) {
    if (e !== null && e !== undefined && e.code === 'ENOENT') return { list: [], text: null }
    return { unreadable: e && e.code ? String(e.code) : 'unknown error' }
  }
  if (text.trim() === '') return { list: [], text: text }
  let data = null
  try { data = JSON.parse(text) } catch (e) { return { corrupt: true, text: text } }
  const plain = (x) => x !== null && typeof x === 'object' && Array.isArray(x) === false && typeof x.nom === 'string'
  return Array.isArray(data) && data.every(plain) ? { list: data, text: text } : { corrupt: true, text: text }
}

/**
 * Keeps a copy of a corrupt file next to it as <name>.corrupt-<time>. A copy with the same
 * content is reused and there are never more than CORRUPT_COPIES_MAX, so repeated attempts
 * do not pile up files. Returns the copy's path or null.
 */
function keepCorruptCopy(file, text) {
  try {
    const folder = dirname(file)
    const prefix = basename(file) + CORRUPT_SUFFIX
    const copies = readdirSync(folder).filter((n) => n.startsWith(prefix))
    for (const n of copies) {
      try { if (readFileSync(join(folder, n), 'utf8') === text) return join(folder, n) } catch (e) { /* unreadable copy: ignored */ }
    }
    if (copies.length >= CORRUPT_COPIES_MAX) return null
    const base = join(folder, prefix + Date.now())
    for (let i = 0; i < CORRUPT_COPIES_MAX; i += 1) {
      const copy = i === 0 ? base : base + '-' + i
      try { writeFileSync(copy, text, { mode: 0o600, flag: 'wx' }); return copy } catch (e) { if (!(e && e.code === 'EEXIST')) return null }
    }
    return null
  } catch (e) { return null }
}

/**
 * Why the sidecar must NOT be used (listed as empty, or written over), or null when it can.
 * `saving` says whether a write was asked for: only then is a copy of a corrupt file kept, so
 * a plain read never writes anything.
 */
function sidecarProblem(state, saving) {
  if (state.list !== undefined) return null
  const name = basename(SIDECAR_PATH())
  const tail = saving === true ? 'so nothing was saved' : 'so the saved connectors cannot be listed from it'
  if (state.unreadable !== undefined) return name + ' cannot be read (' + state.unreadable + '), ' + tail + '. Check its permissions, then try again.'
  const copy = saving === true ? keepCorruptCopy(SIDECAR_PATH(), state.text) : null
  return name + ' is not a valid list of connectors, ' + tail + (copy === null ? '' : ' (a copy is kept as ' + basename(copy) + ')') + '. Fix or remove the file, then try again.'
}

function writeSidecar(list) {
  const p = SIDECAR_PATH()
  mkdirSync(dirname(p), { recursive: true, mode: 0o700 })
  writeFileAtomic(p, JSON.stringify(list, null, 2) + '\n', 0o600)
}

// ── H-09: YAML escaping ──────────────────────────────────────────────────────
// Every value written to cordis.patch.yml is a JSON-quoted scalar (yamlScalaire), and
// line breaks are refused upstream: a multi-line arg or env used to inject arbitrary
// KEYS (autoApprove: true) into the loader configuration.
const sansMultiLigne = (v) => /[\r\n\0]/.test(String(v)) !== true

/** Renders the marked block text for a structured connector. */
function renderBlock(c) {
  const ind = (n) => ' '.repeat(n)
  const L = ['# connecteur:' + c.nom, '- insert:', ind(2) + '- id: mcp-client-' + c.nom, ind(4) + "name: '@deepseek-ai/dsh-mcp-client'"]
  if (c.disabled === true) L.push(ind(4) + 'disabled: true')
  L.push(ind(4) + 'config:')
  L.push(ind(6) + 'serverName: ' + yamlScalaire(c.nom))
  L.push(ind(6) + 'transport: ' + c.transport)
  if (c.transport === 'stdio') {
    L.push(ind(6) + '# DSH spawns with a scrubbed env: command must be an absolute path')
    L.push(ind(6) + 'command: ' + yamlScalaire(c.command))
    L.push(ind(6) + 'args:')
    for (const a of (c.args || [])) L.push(ind(8) + '- ' + yamlScalaire(a))
    if (c.cwd) L.push(ind(6) + 'cwd: ' + yamlScalaire(c.cwd))
    const envs = c.env || []
    if (envs.length > 0) {
      L.push(ind(6) + 'env:')
      for (const e of envs) L.push(ind(8) + yamlScalaire(e.name) + ': ' + renderValue(e.value))
    }
  } else {
    L.push(ind(6) + 'url: ' + yamlScalaire(c.url))
    const hs = c.headers || []
    if (hs.length > 0) {
      L.push(ind(6) + 'headers:')
      for (const e of hs) L.push(ind(8) + yamlScalaire(e.name) + ': ' + renderValue(e.value))
    }
  }
  L.push(ind(6) + 'toolCallTimeoutMs: ' + (Number.isInteger(c.toolCallTimeoutMs) ? c.toolCallTimeoutMs : DEFAULT_TOOL_TIMEOUT_MS))
  L.push(ind(6) + 'failOnStartupError: false')
  L.push(ind(6) + 'reconnect:')
  L.push(ind(8) + 'enabled: true')
  L.push(ind(8) + 'maxAttempts: 10')
  return L.join('\n')
}

/** Removes the lines of block `b`, and the blank line the insertion put before it. */
function dropBlock(lines, b) {
  let from = b.start
  if (from > 0 && lines[from - 1].trim() === '') from -= 1
  lines.splice(from, b.end - from)
  if (from > 0 && from < lines.length && lines[from - 1].trim() === '' && lines[from].trim() === '') lines.splice(from, 1)
  // At the end of the file, keep one final newline: ['a', ''] is "a\n".
  while (lines.length > 1 && lines[lines.length - 1] === '' && lines[lines.length - 2].trim() === '') lines.pop()
}

/**
 * The patch text with the block of `c` replaced (or added, with its banner when the file
 * has none). Pure: nothing is written. A repeated block of the same name is dropped.
 */
function patchWithBlock(text, c) {
  const rendered = renderBlock(c).split('\n')
  const lines = String(text).split('\n')
  const found = findBlocks(lines).filter((b) => b.nom === c.nom)
  if (found.length > 0) {
    for (let k = found.length - 1; k >= 1; k -= 1) dropBlock(lines, found[k])
    // A replacer is a list of lines here, never a string: `$&`, `$'` and `$$` in the
    // connector's url or args cannot be expanded (String.replace used to do that).
    lines.splice(found[0].start, found[0].end - found[0].start, ...rendered)
    return lines.join('\n')
  }
  // An empty list (`[]`) cannot be followed by a block sequence: it makes way for the block.
  const base = withoutEntries(text) ? String(text).split('\n').filter((l) => l.trim() !== '[]').join('\n') : String(text)
  const hasBanner = base.indexOf('CONNECTEURS PERSONNALISÉS') >= 0
  const add = (hasBanner ? '' : (base.endsWith('\n') || base.length === 0 ? '' : '\n') + '\n' + BANNER + '\n')
    + '\n' + rendered.join('\n') + '\n'
  return base + add
}

/** The patch text without the block `nom`, or null when it has none. Pure. */
function patchWithoutBlock(text, nom) {
  const lines = String(text).split('\n')
  const found = findBlocks(lines).filter((b) => b.nom === nom)
  if (found.length === 0) return null
  for (let k = found.length - 1; k >= 0; k -= 1) dropBlock(lines, found[k])
  return lines.join('\n')
}

// ── checking the patch before it is written ─────────────────────────────────
// DSH reads cordis.patch.yml at boot with js-yaml and "fails loud": a file that does not
// parse stops DSH from starting. So the WHOLE text we are about to write is parsed the way
// DSH parses it (JSON schema plus the `!!js` tag) first. js-yaml ships with DSH: it is looked
// up from the profile folder, the DSH home, this plugin and the launcher. When none is
// reachable the check is skipped (the reply says `validated: false`) and the text is
// still safe by construction: every scalar is a JSON string and names are deduplicated.
const here = dirname(fileURLToPath(import.meta.url))
function findYaml() {
  const dirs = [dirname(PATCH_PATH()), DSH_HOME(), here]
  try { dirs.push(dirname(realpathSync(process.argv[1]))) } catch (e) { /* no launcher path */ }
  for (const d of dirs) {
    try {
      const lib = createRequire(join(d, 'package.json'))('js-yaml')
      if (lib === null || lib === undefined || typeof lib.load !== 'function' || lib.JSON_SCHEMA === undefined) continue
      const jsExpr = new lib.Type('tag:yaml.org,2002:js', { kind: 'scalar', resolve: (s) => typeof s === 'string', construct: (s) => ({ __jsExpr: s }) })
      const schema = lib.JSON_SCHEMA.extend(jsExpr)
      return { load: (text) => lib.load(text, { schema: schema }) }
    } catch (e) { /* not reachable from this folder */ }
  }
  return null
}

/** Every `!!js` expression under `node`. */
function jsExpressions(node, out) {
  if (node === null || typeof node !== 'object') return out
  if (typeof node.__jsExpr === 'string') { out.push(node.__jsExpr); return out }
  for (const k of Object.keys(node)) jsExpressions(node[k], out)
  return out
}

/** Entries (at any depth of the `insert` lists) whose id is `id`. */
function entriesWithId(node, id, out) {
  if (node === null || typeof node !== 'object') return out
  if (Array.isArray(node) === false && node.id === id) out.push(node)
  for (const k of Object.keys(node)) entriesWithId(node[k], id, out)
  return out
}

/** True when the text holds nothing but comments, blank lines and `[]`. */
const withoutEntries = (text) => String(text).split('\n').every((l) => l.trim() === '' || l.trim().startsWith('#') || l.trim() === '[]')
/** Nothing but comments and blank lines: DSH refuses such a file ("must be a top-level YAML array"). */
const emptyPatch = (text) => withoutEntries(text) && String(text).split('\n').every((l) => l.trim() !== '[]')

/**
 * Loads `text` like DSH does. Returns { doc } when it loads, { problem } (one line) when
 * it does not, { skipped: true } when no js-yaml is reachable.
 */
function loadLikeDsh(text) {
  const lib = findYaml()
  if (lib === null) return { skipped: true }
  let doc
  try { doc = lib.load(text) } catch (e) { return { problem: String((e && e.message) || e).split('\n')[0] } }
  if (Array.isArray(doc) === false) return { problem: 'it must be a top-level YAML list of loader entries' }
  const nonMapping = doc.findIndex((x) => x === null || typeof x !== 'object' || Array.isArray(x))
  if (nonMapping >= 0) return { problem: 'entry ' + (nonMapping + 1) + ' is not a mapping' }
  return { doc: doc }
}

/**
 * Whether going from `avant` to `apres` leaves DSH able to boot, for the connector `nom`
 * that is being added or replaced (`present`) or removed (`absent`). A result that does
 * not load is refused with a status and a message; one that loads is allowed even when the
 * file was already broken (a delete can repair it). The entry of `nom` must then be there
 * exactly once, or not at all, and its `!!js` expressions must compile (compiled, never run).
 */
function checkPatch(avant, apres, nom, expect, alsoAbsent) {
  if (emptyPatch(apres)) return { ok: true, validated: true, empty: true }
  const after = loadLikeDsh(apres)
  if (after.skipped === true) return { ok: true, validated: false, empty: false }
  if (after.problem !== undefined) {
    const before = emptyPatch(avant) ? { doc: [] } : loadLikeDsh(avant)
    if (before.problem !== undefined) return { ok: false, status: 409, error: 'cordis.patch.yml is not valid YAML (' + before.problem + '), so it was left alone. Fix or restore it, then try again.' }
    return { ok: false, status: 500, error: 'the generated cordis.patch.yml would not load in DSH (' + after.problem + '), so nothing was saved' }
  }
  const mine = entriesWithId(after.doc, 'mcp-client-' + nom, [])
  if (mine.length !== (expect === 'present' ? 1 : 0)) return { ok: false, status: 500, error: 'the connector entry would not be written as expected, so nothing was changed' }
  if (typeof alsoAbsent === 'string' && entriesWithId(after.doc, 'mcp-client-' + alsoAbsent, []).length !== 0) return { ok: false, status: 500, error: 'the old entry would still be there after the rename, so nothing was changed' }
  for (const expr of jsExpressions(mine, [])) {
    try { new Script(expr) } catch (e) { return { ok: false, status: 500, error: 'a header or env value of ' + nom + ' would not compile in the loader, so nothing was saved' } }
  }
  return { ok: true, validated: true, empty: false }
}

// ── writing files: backup, temp file and rename ─────────────────────────────
const BACKUPS_KEPT = 10
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace('Z', '')

/**
 * Atomic write: a temp file next to the target, then a rename, so a crash never leaves a
 * truncated file. An existing file keeps its permissions (a new one gets `mode`), and a
 * symlinked file stays a symlink: its target is replaced.
 */
function writeFileAtomic(path, data, mode) {
  let target = path
  try { target = realpathSync(path) } catch (e) { target = path }
  let perms = mode
  try { perms = statSync(target).mode & 0o777 } catch (e) { /* new file: the default mode */ }
  const tmp = join(dirname(target), '.' + basename(target) + '.tmp-' + process.pid + '-' + Date.now())
  try {
    writeFileSync(tmp, data, { encoding: 'utf8', mode: perms, flag: 'wx' })
    chmodSync(tmp, perms)
    renameSync(tmp, target)
  } catch (e) {
    try { rmSync(tmp, { force: true }) } catch (e2) { /* nothing left to clean */ }
    throw e
  }
}

/** Copies `text` (the current content) next to `path` as <name>.bak-composio-<time>; keeps the newest BACKUPS_KEPT. */
function keepBackup(path, text) {
  const dir = dirname(path)
  const prefix = basename(path) + '.bak-composio-'
  const base = join(dir, prefix + stamp())
  for (let i = 0; i < 20; i += 1) {
    try { writeFileSync(i === 0 ? base : base + '-' + i, text, { encoding: 'utf8', mode: 0o600, flag: 'wx' }); break } catch (e) {
      if (!(e && e.code === 'EEXIST') || i === 19) throw e
    }
  }
  try {
    const old = readdirSync(dir).filter((n) => n.startsWith(prefix)).sort()
    for (const n of old.slice(0, Math.max(0, old.length - BACKUPS_KEPT))) rmSync(join(dir, n), { force: true })
  } catch (e) { /* pruning is best effort */ }
}

/** A filesystem error as a short message that carries no path. */
const fsMessage = (what, e) => what + (e !== null && e !== undefined && typeof e.code === 'string' ? ' (' + e.code + ')' : '')

/**
 * Writes the new patch: a backup of the old one first, then the atomic write. A text with
 * no entry left (the last connector was deleted from a file that held nothing else) is
 * not written as an empty file, which DSH refuses at boot ("must be a top-level YAML
 * array"): the file is removed instead, and the backup keeps its content.
 */
function writePatch(avant, apres, empty) {
  const path = PATCH_PATH()
  if (avant === apres) return
  if (existsSync(path) && avant.length > 0) keepBackup(path, avant)
  if (empty === true) { rmSync(path, { force: true }); return }
  writeFileAtomic(path, apres, 0o600)
}

// ── the DSH .env (secrets typed in the connector form) ──────────────────────
// DSH reads this file with node:util parseEnv, which is NOT a round trip for what a user can
// type: `abc#def` is cut at the `#`, a value wrapped in quotes loses them, edge spaces are
// trimmed, and `\n` inside double quotes becomes a line break. A value is therefore written
// in the first form that parseEnv reads back EXACTLY (bare, 'single', `backtick`, "double"),
// and the edit is refused when none does or when it would change any other variable.
const parseEnvText = (text) => (typeof nodeUtil.parseEnv === 'function' ? nodeUtil.parseEnv(String(text)) : null)
const envLineRe = (nom) => new RegExp('^[ \\t]*(?:export[ \\t]+)?' + nom + '[ \\t]*=')

/** The ways `valeur` can follow NAME=, each one read back exactly by parseEnv. */
function envRenderings(valeur) {
  const out = []
  for (const q of ['', "'", '`', '"']) {
    const text = q + valeur + q
    const parsed = parseEnvText('K=' + text + '\n')
    // Without parseEnv (it exists in every Node DSH runs on) fall back to the plain rules.
    const fits = parsed !== null ? parsed.K === valeur
      : (q === '' ? /#|^\s|\s$|^['"`]/.test(valeur) === false : (valeur.indexOf(q) === -1 && (q !== '"' || valeur.indexOf('\\') === -1)))
    if (fits) out.push(text)
  }
  return out
}

class EnvEditError extends Error {}

/** Whether the edit of `nom` left every other variable as it was, and `nom` as wanted (null: cannot tell). */
function envEditOk(before, after, nom, valeur) {
  if (before === null || after === null) return true
  if (valeur === undefined ? after[nom] !== undefined : after[nom] !== valeur) return false
  for (const k of Object.keys(before)) if (k !== nom && after[k] !== before[k]) return false
  for (const k of Object.keys(after)) if (k !== nom && before[k] === undefined) return false
  return true
}

/**
 * The .env text with NAME set to `valeur`: the first line that defines NAME (with or without
 * `export`) is replaced and the other lines that define it are removed, or the line is added at
 * the end. Pure. Throws an EnvEditError (its message never carries the value) when the value
 * cannot be stored or the edit would change another variable. Exported for test-host.mjs.
 */
export function envTextWith(text, nom, valeur) {
  const renderings = envRenderings(valeur)
  if (renderings.length === 0) throw new EnvEditError('secret ' + nom + ': the value holds every kind of quote (single, double and backtick), which a .env file cannot store')
  const re = envLineRe(nom)
  const before = parseEnvText(text)
  for (const r of renderings) {
    const lines = String(text).split('\n')
    const hits = []
    lines.forEach((l, i) => { if (re.test(l)) hits.push(i) })
    let next = null
    if (hits.length === 0) {
      const crlf = String(text).indexOf('\r\n') >= 0
      next = (text.length > 0 && text.endsWith('\n') === false ? text + (crlf ? '\r\n' : '\n') : text) + nom + '=' + r + (crlf ? '\r\n' : '\n')
    } else {
      lines[hits[0]] = nom + '=' + r + (lines[hits[0]].endsWith('\r') ? '\r' : '')
      for (let k = hits.length - 1; k >= 1; k -= 1) lines.splice(hits[k], 1)
      next = lines.join('\n')
    }
    if (envEditOk(before, parseEnvText(next), nom, valeur)) return next
  }
  throw new EnvEditError('the .env file cannot be edited safely for ' + nom + ' (another variable would change); edit it by hand')
}

/** The .env text without any line that defines `nom`, or null when that cannot be done without touching another variable. Pure. */
function envTextWithout(text, nom) {
  const re = envLineRe(nom)
  const lines = String(text).split('\n')
  if (lines.some((l) => re.test(l)) === false) return String(text)
  const next = lines.filter((l) => re.test(l) === false).join('\n')
  return envEditOk(parseEnvText(text), parseEnvText(next), nom, undefined) ? next : null
}

/**
 * Writes NAME=value into the DSH .env (replacing every line that defines NAME). Returns false
 * when no value is given. Throws when the name is not a valid variable name, is one DSH
 * refuses, or the value holds a line break (CR, LF or NUL) or cannot be stored: a second line
 * would define an arbitrary extra variable. The error never carries the value.
 * Exported for test-host.mjs.
 */
export function upsertEnvSecret(nom, valeur) {
  if (SECRET_RE.test(nom) !== true) throw new Error('secret name is not a valid variable name')
  if (typeof valeur !== 'string' || valeur.length === 0) return false
  if (isBootstrapOnlyName(nom) === true) throw new Error(bootstrapMessage(nom))
  if (sansMultiLigne(valeur) !== true) throw new Error('secret ' + nom + ': the value must not contain line breaks')
  const path = ENV_PATH()
  let text = ''
  try { text = existsSync(path) ? readFileSync(path, 'utf8') : '' } catch (e) { text = '' }
  writeFileAtomic(path, envTextWith(text, nom, valeur), 0o600)
  return true
}

/**
 * The secrets of a POST body: [{ nom, valeur }] for every entry with a valid name and a
 * value. The value is trimmed (a pasted key often carries a trailing space). An entry with an
 * invalid name is skipped.
 */
function secretsOf(body) {
  const out = []
  if (Array.isArray(body.secrets) === false) return out
  for (const s of body.secrets) {
    if (s === null || s === undefined) continue
    const nom = String(s.name || '').trim()
    if (SECRET_RE.test(nom) !== true) continue
    out.push({ nom: nom, valeur: String(s.value === null || s.value === undefined ? '' : s.value).trim() })
  }
  return out
}

/**
 * Checks the secrets of a POST body BEFORE any file is written, so a bad one cannot leave a
 * half-applied request behind. Returns an error message (never containing a value) or null.
 * An entry with an empty value is "no value": nothing is written, so it is not judged.
 */
function verifierSecrets(body) {
  for (const s of secretsOf(body)) {
    if (s.valeur.length === 0) continue
    if (isBootstrapOnlyName(s.nom) === true) return bootstrapMessage(s.nom)
    if (sansMultiLigne(s.valeur) !== true) return 'secret ' + s.nom + ': the value must not contain line breaks'
    if (envRenderings(s.valeur).length === 0) return 'secret ' + s.nom + ': the value holds every kind of quote (single, double and backtick), which a .env file cannot store'
  }
  return null
}

// Characters a value must not carry into the YAML patch: every control character
// except TAB (CR, LF and NUL among them), DEL, the C1 controls, and the Unicode line and
// paragraph separators. Lone surrogates are refused too: they are not text.
const CONTROL_RE = /[\x00-\x08\x0a-\x1f\x7f-\x9f\u2028\u2029]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/
const propre = (v) => CONTROL_RE.test(String(v)) !== true

// H-09: the NAME of an env/header pair is a YAML KEY once rendered, so it must be a
// plain identifier (letters, digits, _ . -): never a line break, a ':' or a quote.
// `X: 1\n  autoApprove` used to inject an arbitrary KEY into cordis.patch.yml.
const NAME_PAILLE_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/

/**
 * The env or header pairs of a body. A row without a name is a blank form row and is
 * dropped; every other row must have a plain name, a value without control characters,
 * and a name not used before (YAML refuses a repeated key at boot: "duplicated mapping
 * key"). Header names are compared without case, as HTTP does.
 */
function normalizePairs(raw, label, foldCase) {
  if (Array.isArray(raw) === false) return { pairs: [] }
  const pairs = []
  const seen = {}
  for (const p of raw) {
    if (p === null || p === undefined || typeof p.name !== 'string' || p.name.trim().length === 0) continue
    const name = p.name.trim()
    if (NAME_PAILLE_RE.test(name) !== true) return { erreur: label + ': a name must be a simple identifier (letters, digits, _ . -)' }
    const value = String(p.value === null || p.value === undefined ? '' : p.value)
    if (propre(value) !== true) return { erreur: label + ' ' + name + ': the value must not contain line breaks or control characters (YAML escaping)' }
    const key = foldCase === true ? name.toLowerCase() : name
    if (seen[key] === true) return { erreur: label + ': the name ' + name + ' is used twice' }
    seen[key] = true
    pairs.push({ name: name, value: value })
  }
  return { pairs: pairs }
}

/**
 * Splits an arguments line the way a shell would, for the quoting only: spaces separate
 * arguments unless they are inside 'single' or "double" quotes. Inside double quotes `\"` and
 * `\\` are the two escapes; everywhere else a backslash is a plain character (paths, regexes).
 * A path with a space (`"/Users/me/Jane Doe/server.mjs"`) used to be cut in two. Returns
 * { args } or { erreur } when a quote is not closed. Exported for test-host.mjs and the client test.
 */
export function splitArgs(text) {
  const s = String(text === null || text === undefined ? '' : text)
  const out = []
  let cur = null
  let quote = null
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]
    if (quote === "'") { if (ch === "'") quote = null; else cur += ch; continue }
    if (quote === '"') {
      if (ch === '"') quote = null
      else if (ch === '\\' && (s[i + 1] === '"' || s[i + 1] === '\\')) { i += 1; cur += s[i] } else cur += ch
      continue
    }
    if (/\s/.test(ch)) { if (cur !== null) { out.push(cur); cur = null } continue }
    if (ch === "'" || ch === '"') { quote = ch; if (cur === null) cur = ''; continue }
    cur = (cur === null ? '' : cur) + ch
  }
  if (quote !== null) return { erreur: 'args: a quote is opened and not closed' }
  if (cur !== null) out.push(cur)
  return { args: out }
}

const LOOPBACK_RE = /^(localhost|127(\.\d{1,3}){3}|\[::1\]|[^.]+\.localhost)$/i

/**
 * Whether `nom` is already the id or the serverName of another entry of the patch (outside the
 * block of that connector): dsh-mcp-client throws "serverName already in use" at load, and
 * the loader refuses a repeated id.
 */
function usedElsewhere(patchText, nom) {
  const lines = String(patchText).split('\n')
  const own = findBlocks(lines).filter((b) => b.nom === nom)
  const esc = nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp('^[ \\t]*(?:-[ \\t]+)?(?:id:[ \\t]*[\'"]?(?:mcp-client-)?' + esc + '|serverName:[ \\t]*[\'"]?' + esc + ')[\'"]?[ \\t]*(?:#.*)?$')
  return lines.some((l, i) => re.test(l) && own.some((b) => i >= b.start && i < b.end) === false)
}

/** Validates the POST body: returns { erreur } or the normalized { connecteur }. */
function normalizeConnecteur(body) {
  if (body === null || body === undefined || typeof body !== 'object') return { erreur: 'a JSON object is expected' }
  const nom = String(body.nom || '').trim()
  if (NOM_RE.test(nom) !== true) return { erreur: 'invalid name (lowercase letters, digits and dashes, starting with a letter, 2 to 31 characters): ' + nom.slice(0, 40) }
  if (RESERVED_NAMES.indexOf(nom) >= 0) return { erreur: 'the name ' + nom + ' is reserved (it is the name of the bundle\'s own MCP entry); pick another' }
  const transport = body.transport === 'stdio' ? 'stdio' : (body.transport === 'streamable-http' ? 'streamable-http' : null)
  if (transport === null) return { erreur: 'invalid transport' }
  const c = { nom: nom, transport: transport, updatedAt: new Date().toISOString() }
  if (body.disabled === true) c.disabled = true
  if (body.toolCallTimeoutMs !== undefined && body.toolCallTimeoutMs !== null && body.toolCallTimeoutMs !== '') {
    const t = Number(body.toolCallTimeoutMs)
    if (Number.isInteger(t) !== true || t < 1000 || t > 3600000) return { erreur: 'toolCallTimeoutMs: a whole number of milliseconds between 1000 and 3600000' }
    if (t !== DEFAULT_TOOL_TIMEOUT_MS) c.toolCallTimeoutMs = t
  }
  if (transport === 'stdio') {
    const command = String(body.command || '').trim()
    if (commandStdioOK(command) !== true) return { erreur: 'command: an executable file with an absolute path, in a folder that is accepted (/usr/bin, /bin, /opt/homebrew/bin... or one you confirmed) is required', code: 'command-refused', help: commandHelp(command) }
    c.command = command
    if (Array.isArray(body.args)) c.args = body.args.map((x) => String(x)).filter((x) => x.length > 0)
    else {
      const split = splitArgs(body.args)
      if (split.erreur !== undefined) return { erreur: split.erreur }
      c.args = split.args.filter((x) => x.length > 0)
    }
    if (c.args.some((a) => propre(a) !== true)) return { erreur: 'args: no line breaks or control characters (YAML escaping)' }
    // ASSUMED residual surface (K-01 review): the args stay free in content (legitimate
    // args carry paths, URLs, flags), so a same-origin attacker could set something like
    // "--config /path". That vector is defended by the EXACT origin and the required JSON
    // on this POST: a cross-site drive-by no longer gets through, and a same-origin
    // attacker already controls the machine. The COUNT and the LENGTH are bounded to
    // contain exfiltration.
    if (c.args.length > 8) return { erreur: 'args: 8 arguments at most' }
    if (c.args.some((a) => a.length > 200)) return { erreur: 'args: 200 characters at most per argument' }
    if (typeof body.cwd === 'string' && body.cwd.trim().length > 0) c.cwd = body.cwd.trim()
    if (c.cwd !== undefined && propre(c.cwd) !== true) return { erreur: 'cwd: no line breaks or control characters (YAML escaping)' }
    const env = normalizePairs(body.env, 'env', false)
    if (env.erreur !== undefined) return { erreur: env.erreur }
    c.env = env.pairs
  } else {
    let u = null
    try { u = new URL(String(body.url || '')) } catch (e) { u = null }
    if (u === null || (u.protocol !== 'https:' && u.protocol !== 'http:')) return { erreur: 'invalid url (http/https)' }
    // user:password@ in a URL used to be dropped silently, and would have been stored in clear text.
    if (u.username !== '' || u.password !== '') return { erreur: 'url: user:password@ in the address is not accepted; send it in a header with a $SECRET instead' }
    // Plain http would send the headers (the API key) in clear text over the network.
    if (u.protocol === 'http:' && LOOPBACK_RE.test(u.hostname) !== true) return { erreur: 'url: http is only accepted for this machine (localhost); use https' }
    c.url = u.origin + (u.pathname || '/') + (u.search || '')
    const headers = normalizePairs(body.headers, 'headers', true)
    if (headers.erreur !== undefined) return { erreur: headers.erreur }
    c.headers = headers.pairs
  }
  return { connecteur: c }
}

/** The secret names a connector refers to: its tokens ($NAME in header and env values) and the ones the form wrote for it. */
function secretNamesOf(c) {
  const names = new Set(Array.isArray(c.secrets) ? c.secrets.filter((n) => typeof n === 'string') : [])
  for (const e of [].concat(Array.isArray(c.headers) ? c.headers : [], Array.isArray(c.env) ? c.env : [])) {
    if (e === null || typeof e !== 'object') continue
    const re = new RegExp(TOKEN_RE.source, 'g')
    let m
    while ((m = re.exec(String(e.value))) !== null) names.add(m[1])
  }
  return names
}

/**
 * The secrets a deleted connector leaves behind that nothing else uses: the ones the form wrote
 * for it (recorded by name in the sidecar; connectors saved before that record keep theirs),
 * minus every name another connector or any entry of the patch still refers to, and never the
 * Composio key itself.
 */
function orphanSecrets(old, others, patchText) {
  if (old === undefined || Array.isArray(old.secrets) === false) return []
  const used = new Set()
  for (const o of others) for (const n of secretNamesOf(o)) used.add(n)
  const re = /process\.env\.([A-Z_][A-Z0-9_]*)/g
  let m
  while ((m = re.exec(String(patchText))) !== null) used.add(m[1])
  return old.secrets.filter((n) => typeof n === 'string' && SECRET_RE.test(n) && n !== COMPOSIO_KEY_REF && used.has(n) === false)
}

/** Puts a file back as it was: `previous` is its text, or null when it did not exist. Returns whether it worked. */
function restoreFile(path, previous) {
  try {
    if (previous === null) rmSync(path, { force: true })
    else writeFileAtomic(path, previous, 0o600)
    return true
  } catch (e) { return false }
}

/**
 * Writes the three files of a change in a fixed order (the patch first: it is the one DSH
 * refuses to start on), and puts back the ones already written when a later step fails, so a
 * failure never leaves a connector listed without its patch block or a secret half applied.
 * `plan`: { patch: { avant, apres, empty, existait }, env: { avant, apres }, sidecar: { liste } }.
 * Returns null on success, or a message that carries no path.
 */
function applyPlan(plan) {
  const done = []
  let stage = 'patch'
  try {
    if (plan.patch.apres !== plan.patch.avant) { writePatch(plan.patch.avant, plan.patch.apres, plan.patch.empty); done.push(['patch', PATCH_PATH(), plan.patch.existait ? plan.patch.avant : null]) }
    stage = 'secrets'
    if (plan.env.apres !== plan.env.avant) { writeFileAtomic(ENV_PATH(), plan.env.apres, 0o600); done.push(['env', ENV_PATH(), plan.env.avant]) }
    stage = 'connectors list'
    if (plan.sidecar.liste !== null) writeSidecar(plan.sidecar.liste)
    return null
  } catch (e) {
    let restored = true
    for (const d of done.reverse()) if (restoreFile(d[1], d[2]) !== true) restored = false
    return fsMessage('the ' + stage + ' could not be written', e) + (restored ? ', so nothing was changed' : ', and an earlier file could not be put back: check ' + done.map((d) => d[0]).join(' and '))
  }
}

// ── what DSH says about each connector ──────────────────────────────────────
// DSH watches cordis.patch.yml and reloads it by itself (about 2 to 3 seconds after a write: measured on
// DSH 0.2.0-rc.2 with its `hmr` watcher), so a saved connector is loaded without a restart. Whether it
// IS loaded is not guessed: pluginInventory.list() gives { entries: [{ entryId: 'include:<id>', enabled,
// fiberPhase }] } and tools.schemas() the registered tools, whose names start with mcp__<name>__. A connector
// whose server cannot be reached stays "active" with no tools (failOnStartupError is false), so
// "active, 0 tools" is shown as that, not as working. Null when DSH's services are not there (tests, an older engine).
async function liveStates(ctx, noms) {
  let inv = null
  let tools = null
  try { inv = ctx.get('pluginInventory') } catch (e) { inv = null }
  try { tools = ctx.get('tools') } catch (e) { tools = null }
  if (inv === null || inv === undefined || typeof inv.list !== 'function') return null
  let entries = null
  try {
    const got = await inv.list()
    entries = got !== null && typeof got === 'object' && Array.isArray(got.entries) ? got.entries : (Array.isArray(got) ? got : null)
  } catch (e) { entries = null }
  if (entries === null) return null
  let names = []
  try { if (tools !== null && tools !== undefined && typeof tools.schemas === 'function') names = tools.schemas().map((t) => (t !== null && t !== undefined ? t.name : '')).filter((n) => typeof n === 'string') } catch (e) { names = [] }
  const out = {}
  for (const nom of noms) {
    const e = entries.find((x) => x !== null && x !== undefined && typeof x.entryId === 'string' && (x.entryId === 'include:mcp-client-' + nom || x.entryId.endsWith(':mcp-client-' + nom)))
    const count = names.filter((n) => n.startsWith('mcp__' + nom + '__')).length
    out[nom] = e === undefined ? { loaded: false, tools: count } : { loaded: true, phase: String(e.fiberPhase === null || e.fiberPhase === undefined ? '' : e.fiberPhase), enabled: e.enabled !== false, tools: count }
  }
  return out
}

const envFileValues = () => { try { return parseEnvText(readFileSync(ENV_PATH(), 'utf8')) || {} } catch (e) { return {} } }
/** { NAME: true|false }: whether each secret a connector refers to has a value (never the value). */
function secretsSetFor(c) {
  const file = envFileValues()
  const out = {}
  for (const n of secretNamesOf(c)) out[n] = (typeof file[n] === 'string' && file[n].length > 0) || (typeof process.env[n] === 'string' && process.env[n].length > 0)
  return out
}

/** The connector list the page shows: the form's own, then the blocks nothing in the sidecar knows (read in full when the form could write them back), each with what DSH says of it. */
function listConnecteurs(sidecar, patchText, live) {
  const blocks = patchBlocks(patchText)
  const seen = {}
  const out = []
  for (const c of sidecar) {
    seen[c.nom] = true
    out.push(Object.assign({}, c, { source: 'form', editable: true, secretsSet: secretsSetFor(c) }))
  }
  const yaml = findYaml()
  for (const nom of Object.keys(blocks)) {
    if (seen[nom] === true) continue
    const lines = blocks[nom]
    const read = readConnector(nom, lines, yaml === null ? null : yaml.load)
    const item = Object.assign({ nom: nom, horsFormulaire: true, source: 'skill' }, blockSummary(lines))
    if (read.connecteur !== undefined) Object.assign(item, read.connecteur, { editable: true, secretsSet: secretsSetFor(read.connecteur) })
    else Object.assign(item, { editable: false, readOnlyReason: read.readOnly })
    out.push(item)
  }
  for (const c of out) c.live = live === null ? null : (live[c.nom] || { loaded: false, tools: 0 })
  return out
}

async function serveConnecteurs(ctx, req, res) {
  // K-01: reads are reserved to the machine (exact origin); writes also need explicit JSON.
  if (origineOK(req) !== true) return sendJson(res, 403, { ok: false, error: 'origin refused' })
  const readFail = (what, e) => sendJson(res, 500, { ok: false, error: fsMessage(what + ' cannot be read', e) })
  if (req.method === 'GET') {
    const state = readSidecarState()
    const problem = sidecarProblem(state, false)
    // A sidecar that is there but unusable is NOT an empty list: the blocks of the patch are
    // still listed (that is what DSH loads), and the problem is reported next to them.
    const sidecar = problem === null ? state.list : []
    let patchText = ''
    try { patchText = readPatchText() } catch (e) { return readFail('cordis.patch.yml', e) }
    const names = Object.keys(patchBlocks(patchText)).concat(sidecar.map((c) => c.nom))
    const live = await liveStates(ctx, names)
    // Never a secret value here: only names, labels and whether a secret has a value.
    return sendJson(res, 200, Object.assign({ ok: true, api: API_VERSION, connecteurs: listConnecteurs(sidecar, patchText, live), live: live !== null, roots: { base: RACINES_STDIO_OK, extra: extraRoots() } },
      problem === null ? {} : { state: state.corrupt === true ? 'corrupt' : 'unreadable', error: problem }))
  }
  if (req.method === 'POST') {
    if (jsonSeulement(req) !== true) return sendJson(res, 415, { ok: false, error: 'content-type application/json expected' })
    let body = null
    try { body = JSON.parse(await readBody(req)) } catch (e) {
      if (e instanceof BodyTooLarge) return sendJson(res, 413, { ok: false, error: 'the request body is too large (' + MAX_BODY_BYTES + ' bytes at most)' })
      return sendJson(res, 400, { ok: false, error: 'a JSON body is expected' })
    }
    const n = normalizeConnecteur(body)
    if (n.erreur !== undefined) return sendJson(res, 400, Object.assign({ ok: false, error: n.erreur }, n.code === undefined ? {} : { code: n.code, help: n.help }))
    const secretErreur = verifierSecrets(body)
    if (secretErreur !== null) return sendJson(res, 400, { ok: false, error: secretErreur })
    const c = n.connecteur
    // Everything is read, built and checked BEFORE any file is written: a refusal leaves
    // all of them untouched.
    const state = readSidecarState()
    const problem = sidecarProblem(state, true)
    if (problem !== null) return sendJson(res, 409, { ok: false, state: state.corrupt === true ? 'corrupt' : 'unreadable', error: problem })
    let avant = ''
    try { avant = readPatchText() } catch (e) { return readFail('cordis.patch.yml', e) }
    const existait = existsSync(PATCH_PATH())
    // A rename: the old connector goes, the new one takes its place, in ONE write. It must never
    // land on a name that is taken (the new block would silently replace that connector).
    const renameFrom = typeof body.renameFrom === 'string' && body.renameFrom.trim() !== c.nom ? body.renameFrom.trim() : ''
    let base = avant
    if (renameFrom !== '') {
      if (NOM_RE.test(renameFrom) !== true) return sendJson(res, 400, { ok: false, error: 'invalid name to rename from' })
      const old = findBlocks(avant.split('\n')).some((b) => b.nom === renameFrom) || state.list.some((x) => x.nom === renameFrom)
      if (old !== true) return sendJson(res, 404, { ok: false, error: 'there is no connector named ' + renameFrom })
      if (findBlocks(avant.split('\n')).some((b) => b.nom === c.nom) || state.list.some((x) => x.nom === c.nom)) return sendJson(res, 409, { ok: false, error: 'a connector named ' + c.nom + ' already exists; pick another name' })
      const without = patchWithoutBlock(avant, renameFrom)
      if (without !== null) base = without
    }
    if (usedElsewhere(base, c.nom)) return sendJson(res, 409, { ok: false, error: 'the name ' + c.nom + ' is already used by another entry of cordis.patch.yml (a repeated serverName makes dsh-mcp-client throw); pick another' })
    const apres = patchWithBlock(base, c)
    const verdict = checkPatch(avant, apres, c.nom, 'present', renameFrom === '' ? undefined : renameFrom)
    if (verdict.ok !== true) return sendJson(res, verdict.status, { ok: false, error: verdict.error })
    let envAvant = null
    try { envAvant = existsSync(ENV_PATH()) ? readFileSync(ENV_PATH(), 'utf8') : null } catch (e) { return readFail('the .env file', e) }
    const secrets = secretsOf(body).filter((s) => s.valeur.length > 0)
    let envApres = envAvant
    try { for (const s of secrets) envApres = envTextWith(envApres === null ? '' : envApres, s.nom, s.valeur) } catch (e) {
      return sendJson(res, e instanceof EnvEditError ? 409 : 500, { ok: false, error: e instanceof EnvEditError ? e.message : fsMessage('the secrets could not be prepared', e) })
    }
    const previous = state.list.find((x) => x.nom === (renameFrom === '' ? c.nom : renameFrom))
    const names = new Set((previous !== undefined && Array.isArray(previous.secrets) ? previous.secrets : []).concat(secrets.map((s) => s.nom)))
    if (names.size > 0) c.secrets = Array.from(names).sort()
    const list = state.list.filter((x) => x.nom !== c.nom && x.nom !== renameFrom)
    list.push(c)
    list.sort((a, b) => (a.nom < b.nom ? -1 : 1))
    const failure = applyPlan({ patch: { avant: avant, apres: apres, empty: verdict.empty, existait: existait }, env: { avant: envAvant, apres: envApres }, sidecar: { liste: list } })
    if (failure !== null) return sendJson(res, 500, { ok: false, error: failure })
    return sendJson(res, 200, Object.assign({ ok: true, connecteur: c, secretsWritten: secrets.length, validated: verdict.validated }, renameFrom === '' ? {} : { renamedFrom: renameFrom }))
  }
  if (req.method === 'DELETE') {
    const nom = queryOf(req).get('nom') || ''
    if (NOM_RE.test(nom) !== true) return sendJson(res, 400, { ok: false, error: 'invalid name' })
    const state = readSidecarState()
    const problem = sidecarProblem(state, true)
    if (problem !== null) return sendJson(res, 409, { ok: false, state: state.corrupt === true ? 'corrupt' : 'unreadable', error: problem })
    let avant = ''
    try { avant = readPatchText() } catch (e) { return readFail('cordis.patch.yml', e) }
    const existait = existsSync(PATCH_PATH())
    const apres = patchWithoutBlock(avant, nom)
    let verdict = { empty: false }
    if (apres !== null) {
      verdict = checkPatch(avant, apres, nom, 'absent')
      if (verdict.ok !== true) return sendJson(res, verdict.status, { ok: false, error: verdict.error })
    }
    // The secrets this connector brought and nothing else uses leave the .env with it.
    let envAvant = null
    try { envAvant = existsSync(ENV_PATH()) ? readFileSync(ENV_PATH(), 'utf8') : null } catch (e) { return readFail('the .env file', e) }
    let envApres = envAvant
    let secretsRemoved = 0
    if (envAvant !== null) {
      const orphans = orphanSecrets(state.list.find((x) => x.nom === nom), state.list.filter((x) => x.nom !== nom), apres === null ? avant : apres)
      for (const name of orphans) {
        const next = envTextWithout(envApres, name)
        if (next !== null && next !== envApres) { envApres = next; secretsRemoved += 1 }
      }
    }
    const had = state.list.some((x) => x.nom === nom)
    const failure = applyPlan({ patch: { avant: avant, apres: apres === null ? avant : apres, empty: verdict.empty, existait: existait }, env: { avant: envAvant, apres: envApres }, sidecar: { liste: had ? state.list.filter((x) => x.nom !== nom) : null } })
    if (failure !== null) return sendJson(res, 500, { ok: false, error: failure })
    const removed = apres !== null
    return sendJson(res, 200, { ok: true, removed: removed, secretsRemoved: secretsRemoved })
  }
  return sendJson(res, 405, { ok: false, error: 'GET/POST/DELETE expected' })
}

// ── the key and the accounts, from the host (the page no longer holds a key) ──
const KEY_ROUTE = '/kybernos/composio/key'
const ACCOUNTS_ROUTE = '/kybernos/composio/accounts'
const KEY_RE = /^ck_[A-Za-z0-9_-]{4,300}$/
const ACCOUNT_ID_RE = /^[A-Za-z0-9_.:-]{1,120}$/

/** An absolute http(s) address, normalized, or null: the only kind of link the page may open. */
function webUrl(raw) {
  if (typeof raw !== 'string') return null
  try { const u = new URL(raw); return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null } catch (e) { return null }
}

/** Forgets what was cached about this key's accounts: an account was just added or removed. */
function forgetAccounts(apiKey) {
  const id = keyId(apiKey)
  scanCache.delete(id)
  for (const k of Array.from(connectionsCache.keys())) if (k.startsWith(id + ':')) connectionsCache.delete(k)
}

async function credentialDescribe(ctx) {
  try {
    const creds = typeof ctx.get === 'function' ? ctx.get('credentials') : undefined
    if (creds !== null && creds !== undefined && typeof creds.describe === 'function') return await creds.describe(COMPOSIO_KEY_REF)
  } catch (e) { /* the service is optional */ }
  return null
}

/** Reads and checks a JSON body for a route that writes. Returns { body } or sends the refusal and returns null. */
async function jsonBody(req, res) {
  if (origineOK(req) !== true) { sendJson(res, 403, { ok: false, error: 'origin refused' }); return null }
  if (jsonSeulement(req) !== true) { sendJson(res, 415, { ok: false, error: 'content-type application/json expected' }); return null }
  try {
    const body = JSON.parse(await readBody(req))
    if (body === null || typeof body !== 'object' || Array.isArray(body)) { sendJson(res, 400, { ok: false, error: 'a JSON object is expected' }); return null }
    return { body: body }
  } catch (e) {
    sendJson(res, e instanceof BodyTooLarge ? 413 : 400, { ok: false, error: e instanceof BodyTooLarge ? 'the request body is too large' : 'a JSON body is expected' })
    return null
  }
}

/**
 * GET: is there a key, where does it come from, and do the running agents hold the same one
 * (their environment is read when DSH starts: a key saved since needs a restart to reach them).
 * POST { key }: checks it with Composio, then writes COMPOSIO_API_KEY to the DSH .env, the file the
 * agents read. DELETE: removes it. The key is never returned, nor written anywhere else.
 */
async function serveKey(ctx, req, res) {
  if (origineOK(req) !== true) return sendJson(res, 403, { ok: false, error: 'origin refused' })
  const agentsEnv = typeof process.env[COMPOSIO_KEY_REF] === 'string' ? process.env[COMPOSIO_KEY_REF] : ''
  if (req.method === 'GET') {
    const k = await resolveComposioKey(ctx)
    return sendJson(res, 200, { ok: true, api: API_VERSION, configured: k !== null, source: k === null ? null : k.source, agents: k === null ? 'none' : (agentsEnv.length === 0 ? 'none' : (agentsEnv === k.value ? 'same' : 'different')) })
  }
  const inherited = async () => { const d = await credentialDescribe(ctx); return d !== null && d.source === 'env' }
  if (req.method === 'POST') {
    const got = await jsonBody(req, res)
    if (got === null) return
    const key = typeof got.body.key === 'string' ? got.body.key.trim() : ''
    if (KEY_RE.test(key) !== true) return sendJson(res, 400, { ok: false, error: 'a Composio key starts with ck_ and has no spaces', code: 'invalid-key' })
    if (await inherited()) return sendJson(res, 409, { ok: false, error: 'the key comes from the environment DSH was started with: change it there', code: 'inherited' })
    let verified = false
    let code = null
    try { await mcpListConnections(key, ['gmail']); verified = true } catch (e) {
      code = failureCode(e)
      // A rejected key is not saved: it would replace one that works. A network failure is not the key's fault.
      if (code === '401' || code === '403') return sendJson(res, 400, { ok: false, error: 'Composio rejected this key', code: code })
    }
    try { upsertEnvSecret(COMPOSIO_KEY_REF, key) } catch (e) {
      return sendJson(res, e instanceof EnvEditError ? 409 : 500, { ok: false, error: e instanceof EnvEditError ? e.message : fsMessage('the .env file could not be written', e) })
    }
    forgetAccounts(key)
    return sendJson(res, 200, { ok: true, verified: verified, code: code, needRestart: agentsEnv !== key })
  }
  if (req.method === 'DELETE') {
    if (await inherited()) return sendJson(res, 409, { ok: false, error: 'the key comes from the environment DSH was started with: change it there', code: 'inherited' })
    let text = null
    try { text = existsSync(ENV_PATH()) ? readFileSync(ENV_PATH(), 'utf8') : null } catch (e) { return sendJson(res, 500, { ok: false, error: fsMessage('the .env file cannot be read', e) }) }
    if (text !== null) {
      const next = envTextWithout(text, COMPOSIO_KEY_REF)
      if (next === null) return sendJson(res, 409, { ok: false, error: 'the .env file cannot be edited safely (another variable would change): edit it by hand' })
      if (next !== text) { try { writeFileAtomic(ENV_PATH(), next, 0o600) } catch (e) { return sendJson(res, 500, { ok: false, error: fsMessage('the .env file could not be written', e) }) } }
    }
    return sendJson(res, 200, { ok: true, needRestart: agentsEnv.length > 0 })
  }
  return sendJson(res, 405, { ok: false, error: 'GET/POST/DELETE expected' })
}

/**
 * POST { action: 'add', toolkit } starts a connection and gives the address where the person
 * authorizes it; POST { action: 'remove', toolkit, accountId } removes one account. Both answer with
 * the toolkit's accounts as they are now. The page used to do this itself with a key kept in the browser.
 */
async function serveAccounts(ctx, req, res) {
  if (req.method !== 'POST') { if (origineOK(req) !== true) return sendJson(res, 403, { ok: false, error: 'origin refused' }); return sendJson(res, 405, { ok: false, error: 'POST expected' }) }
  const got = await jsonBody(req, res)
  if (got === null) return
  const action = got.body.action
  const toolkit = typeof got.body.toolkit === 'string' ? got.body.toolkit.trim().toLowerCase() : ''
  if (SLUG_RE.test(toolkit) !== true) return sendJson(res, 400, { ok: false, error: 'invalid toolkit' })
  if (action !== 'add' && action !== 'remove') return sendJson(res, 400, { ok: false, error: 'action must be add or remove' })
  const accountId = typeof got.body.accountId === 'string' ? got.body.accountId.trim() : ''
  if (action === 'remove' && ACCOUNT_ID_RE.test(accountId) !== true) return sendJson(res, 400, { ok: false, error: 'invalid account id' })
  const credential = await resolveComposioKey(ctx)
  if (credential === null) return sendJson(res, 409, { ok: false, error: 'no-credential', code: 'no-credential' })
  try {
    const entry = action === 'add' ? { name: toolkit, action: 'add' } : { name: toolkit, action: 'remove', account_id: accountId }
    const payload = await mcpManage(credential.value, [entry])
    forgetAccounts(credential.value)
    let redirectUrl = null
    if (action === 'add') {
      const data = payload.data !== null && typeof payload.data === 'object' ? payload.data : payload
      const info = data.results !== null && typeof data.results === 'object' && data.results[toolkit] !== null && typeof data.results[toolkit] === 'object' ? data.results[toolkit] : {}
      redirectUrl = webUrl(info.redirect_url !== undefined ? info.redirect_url : info.redirectUrl)
    }
    // The answer of add and of remove lists the toolkit's accounts as they are now, the pending one included: that is what
    // the page shows. (Measured: asking for the list right after is a second call, and Composio's gateway drops many.)
    const given = normalizeConnections(payload, [toolkit]).connections.find((c) => c.toolkit === toolkit)
    if (given !== undefined && (given.accounts.length > 0 || action === 'remove')) return sendJson(res, 200, { ok: true, redirectUrl: redirectUrl, connection: given, error: null })
    const out = await readConnections(credential.value, [toolkit], true)
    const connection = out.result.connections.find((c) => c.toolkit === toolkit) || { toolkit: toolkit, status: '', accounts: [] }
    return sendJson(res, 200, { ok: true, redirectUrl: redirectUrl, connection: connection, error: out.error })
  } catch (e) {
    return sendJson(res, 502, { ok: false, error: failureCode(e), code: failureCode(e) })
  }
}

// ── testing a connector (POST /connecteurs/test) ────────────────────────────
const CONNECTEURS_TEST_ROUTE = '/kybernos/composio/connecteurs/test'
const CONNECTEURS_CMD_ROUTE = '/kybernos/composio/connecteurs/commande'
let testsRunning = 0
const MAX_TESTS = 3

/**
 * Puts the secrets in the text of a header or env value: `$NAME` becomes the value typed in the form (not
 * saved yet), else the one in the DSH .env, else this process's own. Returns { text, missing } where
 * `missing` lists the names that have no value anywhere (the test says so instead of failing obscurely).
 */
function withSecrets(text, draft, fileEnv, used, missing) {
  const re = new RegExp(TOKEN_RE.source, 'g')
  return String(text).replace(re, (_all, name) => {
    let v = draft[name]
    if (typeof v !== 'string' || v.length === 0) v = fileEnv[name]
    if (typeof v !== 'string' || v.length === 0) v = process.env[name]
    if (typeof v !== 'string' || v.length === 0) { if (missing.indexOf(name) < 0) missing.push(name); return '' }
    used.push(v)
    return v
  })
}

async function serveConnecteurTest(ctx, req, res) {
  if (origineOK(req) !== true) return sendJson(res, 403, { ok: false, error: 'origin refused' })
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST expected' })
  if (jsonSeulement(req) !== true) return sendJson(res, 415, { ok: false, error: 'content-type application/json expected' })
  let body = null
  try { body = JSON.parse(await readBody(req)) } catch (e) {
    if (e instanceof BodyTooLarge) return sendJson(res, 413, { ok: false, error: 'the request body is too large (' + MAX_BODY_BYTES + ' bytes at most)' })
    return sendJson(res, 400, { ok: false, error: 'a JSON body is expected' })
  }
  if (body === null || typeof body !== 'object') return sendJson(res, 400, { ok: false, error: 'a JSON object is expected' })
  let c = null
  if (body.transport === undefined) {
    // A saved connector: the one DSH loads, so it is tested as it is, whatever folder its command is in.
    const nom = String(body.nom || '').trim()
    if (NOM_RE.test(nom) !== true) return sendJson(res, 400, { ok: false, error: 'invalid name' })
    const state = readSidecarState()
    const problem = sidecarProblem(state, false)
    if (problem !== null) return sendJson(res, 409, { ok: false, error: problem })
    c = state.list.find((x) => x.nom === nom)
    if (c === undefined) {
      let text = ''
      try { text = readPatchText() } catch (e) { return sendJson(res, 500, { ok: false, error: fsMessage('cordis.patch.yml cannot be read', e) }) }
      const lines = patchBlocks(text)[nom]
      if (lines === undefined) return sendJson(res, 404, { ok: false, error: 'there is no connector named ' + nom })
      const yaml = findYaml()
      const read = readConnector(nom, lines, yaml === null ? null : yaml.load)
      if (read.connecteur === undefined) return sendJson(res, 409, { ok: false, error: 'this connector cannot be read back for a test: ' + read.readOnly })
      c = read.connecteur
    }
  } else {
    // A draft from the form, not saved: held to the same rules as saving it.
    const n = normalizeConnecteur(Object.assign({}, body, { nom: NOM_RE.test(String(body.nom || '').trim()) ? body.nom : 'essai' }))
    if (n.erreur !== undefined) return sendJson(res, 400, Object.assign({ ok: false, error: n.erreur }, n.code === undefined ? {} : { code: n.code, help: n.help }))
    const bad = verifierSecrets(body)
    if (bad !== null) return sendJson(res, 400, { ok: false, error: bad })
    c = n.connecteur
  }
  if (testsRunning >= MAX_TESTS) return sendJson(res, 429, { ok: false, error: 'tests are already running; try again in a moment' })
  const draft = {}
  for (const sec of secretsOf(body)) if (sec.valeur.length > 0) draft[sec.nom] = sec.valeur
  const fileEnv = envFileValues()
  const used = Object.values(draft)
  const missing = []
  const resolveRows = (rows) => {
    const o = {}
    for (const r of (Array.isArray(rows) ? rows : [])) o[r.name] = withSecrets(r.value, draft, fileEnv, used, missing)
    return o
  }
  testsRunning += 1
  let result = null
  try {
    if (c.transport === 'stdio') {
      result = await probeStdio({ command: c.command, args: c.args || [], cwd: c.cwd, env: resolveRows(c.env), secrets: used, timeoutMs: TIMEOUTS.testStdioMs })
    } else {
      result = await probeHttp({ url: c.url, headers: resolveRows(c.headers), secrets: used, timeoutMs: TIMEOUTS.testHttpMs })
    }
  } catch (e) {
    result = { ok: false, ms: 0, code: 'internal', message: '' }
  } finally { testsRunning -= 1 }
  // Whatever the probe returned, no secret value leaves (a server can echo a header back in an error).
  const clean = redactDeep(result, used, 2000)
  return sendJson(res, 200, { ok: true, result: clean, missing: missing })
}

// ── the folders commands may be run from (GET/POST/DELETE /connecteurs/commande) ──
async function serveConnecteurCommande(ctx, req, res) {
  if (origineOK(req) !== true) return sendJson(res, 403, { ok: false, error: 'origin refused' })
  const roots = () => ({ base: RACINES_STDIO_OK, extra: extraRoots() })
  if (req.method === 'GET') return sendJson(res, 200, { ok: true, help: commandHelp(queryOf(req).get('command') || ''), roots: roots() })
  if (req.method === 'POST') {
    if (jsonSeulement(req) !== true) return sendJson(res, 415, { ok: false, error: 'content-type application/json expected' })
    let body = null
    try { body = JSON.parse(await readBody(req)) } catch (e) { return sendJson(res, e instanceof BodyTooLarge ? 413 : 400, { ok: false, error: e instanceof BodyTooLarge ? 'the request body is too large' : 'a JSON body is expected' }) }
    const dir = body !== null && typeof body === 'object' && typeof body.dir === 'string' ? body.dir : ''
    const why = rootProblem(dir)
    if (why !== null) return sendJson(res, 400, { ok: false, error: why })
    try { const now = extraRoots(); if (now.indexOf(dir) < 0) writeExtraRoots(now.concat([dir])) } catch (e) { return sendJson(res, 500, { ok: false, error: fsMessage('the folder list could not be written', e) }) }
    return sendJson(res, 200, { ok: true, roots: roots() })
  }
  if (req.method === 'DELETE') {
    const dir = queryOf(req).get('dir') || ''
    try { writeExtraRoots(extraRoots().filter((d) => d !== dir)) } catch (e) { return sendJson(res, 500, { ok: false, error: fsMessage('the folder list could not be written', e) }) }
    return sendJson(res, 200, { ok: true, roots: roots() })
  }
  return sendJson(res, 405, { ok: false, error: 'GET/POST/DELETE expected' })
}

// Largest request body read, in BYTES.
const MAX_BODY_BYTES = 200000
class BodyTooLarge extends Error {}

/**
 * Reads a request body as UTF-8. The chunks are collected as bytes and decoded once: decoding
 * each chunk on its own turned a character split across two chunks into U+FFFD. Past the limit
 * nothing more is kept (the buffering used to be unbounded) and the promise rejects with a
 * BodyTooLarge, which the route answers with a 413.
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let tooLarge = false
    req.on('data', (chunk) => {
      if (tooLarge) return
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
      size += bytes.length
      if (size > MAX_BODY_BYTES) { tooLarge = true; chunks.length = 0; return }
      chunks.push(bytes)
    })
    req.on('end', () => { if (tooLarge) reject(new BodyTooLarge('body too large')); else resolve(Buffer.concat(chunks).toString('utf8')) })
    req.on('error', reject)
  })
}

export function apply(ctx) {
  const log = (message) => { try { if (ctx.logger !== undefined && ctx.logger !== null) ctx.logger.info(message) } catch (e) { /* the logger is optional */ } }
  // AGENTS.md rule 2: a bundle must never stop DSH from starting. Nothing below may throw out
  // of apply(): a failure here only costs this bundle's routes.
  try { mountRoutes(ctx, log) } catch (e) { log('[composio] routes not mounted: ' + fsMessage('error', e)) }
}

function mountRoutes(ctx, log) {
  // Last-resort net: the read route must never reject towards the web server, or an
  // unexpected request would bring the Connectors page down.
  const serveConnectionsSafe = async (req, res) => {
    try { await serveConnections(ctx, req, res) } catch (e) {
      try {
        if (res.headersSent !== true) sendJson(res, 200, { ok: true, configured: true, stale: false, error: 'offline', connections: [], summary: emptySummary(0) })
      } catch (e2) { /* socket already closed */ }
    }
  }
  // Same for the connectors: an exception must never break the page.
  const serveConnecteursSafe = async (req, res) => {
    try { await serveConnecteurs(ctx, req, res) } catch (e) {
      try { if (res.headersSent !== true) sendJson(res, 500, { ok: false, error: fsMessage('internal error', e) }) } catch (e2) { /* socket closed */ }
    }
  }
  const guarded = (fn) => async (req, res) => {
    try { await fn(ctx, req, res) } catch (e) {
      try { if (res.headersSent !== true) sendJson(res, 500, { ok: false, error: fsMessage('internal error', e) }) } catch (e2) { /* socket closed */ }
    }
  }
  const mount = (webServerSvc) => {
    if (webServerSvc === null || webServerSvc === undefined || typeof webServerSvc.register !== 'function') return
    ctx.effect(() => webServerSvc.register({ kind: 'exact', path: KEY_ROUTE, handler: guarded(serveKey) }), 'kybernos-composio: key route')
    ctx.effect(() => webServerSvc.register({ kind: 'exact', path: ACCOUNTS_ROUTE, handler: guarded(serveAccounts) }), 'kybernos-composio: accounts route')
    ctx.effect(() => webServerSvc.register({ kind: 'exact', path: CONNECTEURS_TEST_ROUTE, handler: guarded(serveConnecteurTest) }), 'kybernos-composio: connector test route')
    ctx.effect(() => webServerSvc.register({ kind: 'exact', path: CONNECTEURS_CMD_ROUTE, handler: guarded(serveConnecteurCommande) }), 'kybernos-composio: connector folders route')
    ctx.effect(() => webServerSvc.register({ kind: 'exact', path: CATALOG_ROUTE, handler: serveCatalog }), 'kybernos-composio: catalog route')
    ctx.effect(() => webServerSvc.register({ kind: 'exact', path: CONNECTIONS_ROUTE, handler: serveConnectionsSafe }), 'kybernos-composio: connections route')
    ctx.effect(() => webServerSvc.register({ kind: 'exact', path: CONNECTEURS_ROUTE, handler: serveConnecteursSafe }), 'kybernos-composio: connectors route')
    log('[composio] catalog served on ' + CATALOG_ROUTE)
    log('[composio] real connections served on ' + CONNECTIONS_ROUTE)
    log('[composio] custom connectors served on ' + CONNECTEURS_ROUTE)
  }
  if (ctx.get('webServer') !== undefined) mount(ctx.get('webServer'))
  else ctx.inject(['webServer'], (hostCtx) => mount(hostCtx.webServer))
  log('[composio] attached: client actions go through MCP, connections are read on the host')
}
