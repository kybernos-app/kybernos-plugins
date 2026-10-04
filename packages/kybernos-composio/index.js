// Plugin host Composio.
//
// Mesuré au boot 2026-09-17 : la clé ck_ n'ouvre que le serveur MCP
// connect.composio.dev/mcp (backend.composio.dev/api/v3 répond 401), et ce
// serveur autorise CORS depuis n'importe quelle origine. L'UI client (client.js)
// parle donc AUSSI directement au MCP, avec la même clé — une seule source.
//
// Ce half host sert aussi le catalogue Composio (412 Ko) sur
// GET /kybernos/composio/catalog : catalog.js reste la source de vérité sur
// disque, lue à la demande et gardée en mémoire — même modèle que icons.json
// côté kybernos-plugin. Le bundle client ne contient plus la donnée.
//
// Il expose en plus, en LECTURE SEULE, les vraies connexions de l'utilisateur sur
// GET /kybernos/composio/connections?toolkits=gmail,googlecalendar. Pourquoi côté
// host plutôt que navigateur : l'onglet Connectors doit montrer la vérité Composio
// sans dépendre d'une clé posée dans localStorage, sans PII (user_info jamais
// recopié) et sans qu'une panne réseau ne casse la page. Les ACTIONS (add/remove)
// restent, elles, pilotées par le client via MCP.
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, chmodSync, readdirSync, realpathSync, renameSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { Script } from 'node:vm'

export const name = 'kybernos-composio'

const CATALOG_PATH = fileURLToPath(new URL('./catalog.js', import.meta.url))
const CATALOG_ROUTE = '/kybernos/composio/catalog'
const CATALOG_CACHE_CONTROL = 'public, max-age=3600'
// Cache mémoire: { body, etag }. catalog.js n'est lu qu'au premier appel.
let catalogCache = null

// ── connexions réelles (lecture seule) ───────────────────────────────────────
const CONNECTIONS_ROUTE = '/kybernos/composio/connections'
const MCP_URL = 'https://connect.composio.dev/mcp'
// Ne jamais sonder Composio en boucle : 120 s de cache suffisent au confort de
// l'onglet, et deux requêtes concurrentes partagent la même promesse (coalescing).
const CONNECTIONS_TTL_MS = 120 * 1000
const MCP_TIMEOUT_MS = 12000
// Un lot de 40 toolkits reste très en deçà du batch mesuré (500 en ~760 ms).
const MAX_TOOLKITS = 40
// Grammaire volontairement stricte : un slug Composio est un identifiant plat.
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,40}$/
// Référence de credential passée en chaîne nue : la marque credentialRef est
// effacée à l'exécution (credentialRef('X') === 'X'), et un import statique de
// @deepseek-ai/dsh-credentials casserait les tests hermétiques hors arbre DSH.
const COMPOSIO_KEY_REF = 'COMPOSIO_API_KEY'

// Cache mémoire: { key, at, result } — result = { connections, summary }.
let connectionsCache = null
// Appel en vol partagé: { key, promise } — deux requêtes identiques = un fetch.
let connectionsInFlight = null
// Session MCP et initialize, rejoués seulement quand la clé change.
let mcpSessionId = null
let mcpInitPromise = null
let mcpInitKey = null

/**
 * Lit catalog.js (source de vérité) et en extrait le tableau JSON tel quel, sans
 * le re-sérialiser: le corps servi est identique à l'octet près au littéral du
 * dépôt. Refuse de servir un corps illisible.
 */
function loadCatalog() {
  if (catalogCache !== null) return catalogCache
  const text = readFileSync(CATALOG_PATH, 'utf8')
  const match = /export const CATALOG = (\[[\s\S]*\]);/.exec(text)
  if (match === null) throw new Error('CATALOG introuvable dans catalog.js')
  const body = match[1]
  JSON.parse(body)
  const etag = '"' + createHash('sha256').update(body).digest('hex').slice(0, 32) + '"'
  catalogCache = { body: body, etag: etag }
  return catalogCache
}

/**
 * Tous les slugs du catalogue local, dédupliqués. Sert au balayage « qu'est-ce
 * que ce compte a réellement connecté ? » : le MCP exige des noms et refuse une
 * liste vide (mesuré : « At least one toolkit is required »).
 */
const PROXY_APPS_URL = 'https://kybernos-proxy-production.up.railway.app/v1/connections/apps'
const SLUGS_TTL_MS = 60 * 60 * 1000
let candidateCache = null

/** Normalise une liste de slugs (dédupliquée, validée par SLUG_RE). */
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

/**
 * Slugs candidats du balayage. Le catalogue PUBLIC (proxy, ~1559 apps) d'abord ;
 * en cas de panne réseau, repli sur le catalogue local (100 apps, clé « s »).
 */
async function candidateSlugs() {
  if (candidateCache !== null && Date.now() - candidateCache.at < SLUGS_TTL_MS) return candidateCache.slugs
  let slugs = []
  try {
    const r = await fetch(PROXY_APPS_URL, { signal: AbortSignal.timeout(8000) })
    const j = await r.json()
    if (j !== null && j !== undefined && Array.isArray(j.apps) === true) slugs = slugsPropres(j.apps.map((a) => (a !== null && a !== undefined ? a.slug : '')))
  } catch (e) { slugs = [] }
  if (slugs.length === 0) {
    let apps = []
    try { apps = JSON.parse(loadCatalog().body) } catch (e2) { apps = [] }
    slugs = slugsPropres(apps.map((a) => (a !== null && a !== undefined ? (a.s || a.slug) : '')))
  }
  candidateCache = { at: Date.now(), slugs: slugs }
  return slugs
}

// Balayage du compte : ~1559 slugs par lots (mesuré : 4 lots de 400 en 3,5 s).
const SCAN_BATCH = 400
const SCAN_TTL_MS = 5 * 60 * 1000
let scanCache = null
let scanInFlight = null

/**
 * Ce que le COMPTE a connecté : on ne garde que les toolkits qui portent au
 * moins un compte — un « initiated » sans compte n'est pas une connexion.
 */
async function scanAccountConnections(apiKey) {
  if (scanCache !== null && Date.now() - scanCache.at < SCAN_TTL_MS) return scanCache
  if (scanInFlight !== null) return scanInFlight
  const promise = (async () => {
    const slugs = await candidateSlugs()
    const gardees = []
    for (let i = 0; i < slugs.length; i += SCAN_BATCH) {
      const lot = slugs.slice(i, i + SCAN_BATCH)
      const out = await readConnections(apiKey, lot)
      for (const c of out.result.connections) {
        if (c !== null && c !== undefined && Array.isArray(c.accounts) === true && c.accounts.length > 0) gardees.push(c)
      }
    }
    const actifs = gardees.filter((c) => String(c.status).toUpperCase() === 'ACTIVE').length
    const resultat = {
      connections: gardees,
      summary: { totalToolkits: gardees.length, activeConnections: actifs, initiatedConnections: 0, failedConnections: gardees.length - actifs },
    }
    // Un balayage vide n'est PAS mis en cache : un catalogue injoignable ne doit
    // pas coller « aucune connexion » pendant cinq minutes.
    if (gardees.length > 0) scanCache = Object.assign({ at: Date.now() }, resultat)
    return resultat
  })()
  scanInFlight = promise
  try { return await promise } finally { if (scanInFlight === promise) scanInFlight = null }
}

function sendJson(res, status, body, extraHeaders) {
  const headers = Object.assign({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, extraHeaders || {})
  res.writeHead(status, headers)
  res.end(JSON.stringify(body))
}

function serveCatalog(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'GET attendu' })
  let entry = null
  try { entry = loadCatalog() } catch (e) { return sendJson(res, 500, { ok: false, error: String((e && e.message) || e) }) }
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
 * Extrait la liste de toolkits demandée. Chaque slug est validé par SLUG_RE, les
 * doublons sont écartés et le lot est plafonné à 40 : un slug douteux est ignoré
 * en silence (jamais d'erreur — la page ne doit pas casser pour un paramètre).
 */
function parseToolkits(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return []
  const out = []
  const seen = {}
  for (const part of raw.split(',')) {
    const slug = part.trim()
    if (SLUG_RE.test(slug) !== true) continue
    if (seen[slug] === true) continue
    seen[slug] = true
    out.push(slug)
    if (out.length >= MAX_TOOLKITS) break
  }
  return out
}

/** Lit COMPOSIO_API_KEY dans ~/.dsh/.env — repli quand le service de credentials manque. */
function readEnvKey() {
  try {
    const text = readFileSync(join(DSH_HOME(), '.env'), 'utf8')
    const match = /^[ \t]*COMPOSIO_API_KEY[ \t]*=[ \t]*(.+)$/m.exec(text)
    if (match === null) return null
    let value = match[1].trim()
    if (value.length >= 2 && ((value[0] === '"' && value[value.length - 1] === '"') || (value[0] === "'" && value[value.length - 1] === "'"))) value = value.slice(1, -1).trim()
    return value.length === 0 ? null : { value: value, source: 'env-file' }
  } catch (e) { return null }
}

/**
 * Résout la clé Composio à CHAQUE requête (jamais de cache du secret : une clé
 * changée doit prendre effet sans redémarrer le plugin). Le service de credentials
 * couvre déjà env/.env/store ; il est autoritaire — s'il ne résout rien, on ne
 * retombe pas sur le fichier. Le repli fichier n'existe que s'il est absent ou en
 * panne, et ne lève jamais.
 */
async function resolveComposioKey(ctx) {
  let creds = undefined
  try { creds = typeof ctx.get === 'function' ? ctx.get('credentials') : undefined } catch (e) { creds = undefined }
  if (creds !== null && creds !== undefined && typeof creds.resolve === 'function') {
    try {
      const got = await creds.resolve(COMPOSIO_KEY_REF)
      if (got !== null && got !== undefined && typeof got.value === 'string' && got.value.length > 0) return { value: got.value, source: String(got.source || 'credentials') }
      return null
    } catch (e) { return readEnvKey() }
  }
  return readEnvKey()
}

// ── transport MCP (même mécanique que client.js, sans localStorage) ─────────
function mcpFailure(code) { const e = new Error(code); e.mcpCode = code; return e }

function failureCode(e) { return e !== null && e !== undefined && typeof e.mcpCode === 'string' ? e.mcpCode : 'offline' }

/**
 * Décode un corps JSON-RPC : JSON nu ou text/event-stream (`data: {...}`). Les
 * deux formes sont servies par connect.composio.dev selon l'accept négocié, donc
 * on essaie le SSE d'abord, puis le JSON brut, exactement comme le client.
 */
function decodeRpc(raw) {
  let payload = null
  for (const line of String(raw).split('\n')) {
    if (line.indexOf('data:') !== 0) continue
    try { payload = JSON.parse(line.slice(5).trim()) } catch (e) { /* bloc SSE partiel */ }
  }
  if (payload === null) { try { payload = JSON.parse(String(raw)) } catch (e) { payload = null } }
  return payload
}

async function mcpPost(apiKey, body) {
  const headers = {
    'content-type': 'application/json',
    'accept': 'application/json, text/event-stream',
    'x-consumer-api-key': apiKey,
  }
  if (mcpSessionId !== null) headers['mcp-session-id'] = mcpSessionId
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), MCP_TIMEOUT_MS)
  let res = null
  try {
    res = await fetch(MCP_URL, { method: 'POST', headers: headers, body: JSON.stringify(body), signal: controller.signal })
  } catch (e) {
    // AbortSignal → 'timeout', tout le reste (DNS, TLS, coupure) → 'offline'.
    throw mcpFailure(controller.signal.aborted === true || (e !== null && e !== undefined && e.name === 'AbortError') ? 'timeout' : 'offline')
  } finally { clearTimeout(timer) }
  if (res === null || res === undefined) throw mcpFailure('offline')
  const sid = res.headers !== null && res.headers !== undefined && typeof res.headers.get === 'function' ? res.headers.get('mcp-session-id') : null
  if (typeof sid === 'string' && sid.length > 0) mcpSessionId = sid
  if (res.status === 401) throw mcpFailure('401')
  if (res.status === 429) throw mcpFailure('429')
  if (res.ok !== true) throw mcpFailure(String(res.status))
  let raw = ''
  try { raw = await res.text() } catch (e) { throw mcpFailure('offline') }
  return decodeRpc(raw)
}

/** initialize une seule fois par clé ; un échec est réessayable au prochain appel. */
function mcpInitialize(apiKey) {
  if (mcpInitPromise !== null && mcpInitKey === apiKey) return mcpInitPromise
  mcpInitKey = apiKey
  mcpSessionId = null
  mcpInitPromise = mcpPost(apiKey, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'kybernos-host', version: '1.0' } },
  }).catch((e) => { mcpInitPromise = null; mcpInitKey = null; throw e })
  return mcpInitPromise
}

/** tools/call renvoie le texte JSON dans result.content[].text (parfois structure). */
function toolPayload(result) {
  if (result === null || result === undefined) return null
  const content = Array.isArray(result.content) ? result.content : []
  const block = content.find((item) => item !== null && item !== undefined && typeof item.text === 'string')
  if (block === undefined) return result
  try { return JSON.parse(block.text) } catch (e) { return block.text }
}

async function mcpListConnections(apiKey, slugs) {
  await mcpInitialize(apiKey)
  const reply = await mcpPost(apiKey, {
    jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: 'COMPOSIO_MANAGE_CONNECTIONS', arguments: { toolkits: slugs.map((name) => ({ name: name, action: 'list' })) } },
  })
  if (reply !== null && reply !== undefined && reply.error !== undefined && reply.error !== null) throw mcpFailure('offline')
  return toolPayload(reply === null || reply === undefined ? null : reply.result)
}

/**
 * Projette la réponse Composio sur le contrat figé du client Kybernos. Règle dure
 * de non-PII : seuls id, alias, status, accountType et isDefault sortent d'ici —
 * user_info et toute valeur de secret sont volontairement laissés de côté.
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

/** Le cache n'est valable que pour la MÊME liste de slugs (clé = slugs triés). */
function cachedConnections(key) { return connectionsCache !== null && connectionsCache.key === key ? connectionsCache : null }

/**
 * Lit les connexions avec cache TTL et coalescing des appels concurrents. Une
 * panne ne propage JAMAIS d'exception : on rend le dernier bon résultat (stale)
 * ou une liste vide, avec un code d'erreur que l'UI peut afficher.
 */
async function readConnections(apiKey, slugs) {
  const cacheKey = slugs.slice().sort().join(',')
  const fresh = cachedConnections(cacheKey)
  if (fresh !== null && Date.now() - fresh.at < CONNECTIONS_TTL_MS) return { result: fresh.result, stale: false, error: null }
  if (connectionsInFlight !== null && connectionsInFlight.key === cacheKey) {
    try { return { result: await connectionsInFlight.promise, stale: false, error: null } }
    catch (e) {
      const prior = cachedConnections(cacheKey)
      return { result: prior === null ? emptyConnections(slugs.length) : prior.result, stale: prior !== null, error: failureCode(e) }
    }
  }
  const promise = mcpListConnections(apiKey, slugs).then((payload) => normalizeConnections(payload, slugs))
  connectionsInFlight = { key: cacheKey, promise: promise }
  try {
    const result = await promise
    connectionsCache = { key: cacheKey, at: Date.now(), result: result }
    return { result: result, stale: false, error: null }
  } catch (e) {
    const prior = cachedConnections(cacheKey)
    return { result: prior === null ? emptyConnections(slugs.length) : prior.result, stale: prior !== null, error: failureCode(e) }
  } finally {
    if (connectionsInFlight !== null && connectionsInFlight.promise === promise) connectionsInFlight = null
  }
}

/**
 * GET /kybernos/composio/connections?toolkits=a,b — lecture seule, jamais 5xx :
 * une clé absente comme une panne MCP répondent 200 pour que la page survive.
 */
async function serveConnections(ctx, req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'GET attendu' })
  const demandes = parseToolkits(queryOf(req).get('toolkits'))
  const credential = await resolveComposioKey(ctx)
  if (credential === null) return sendJson(res, 200, { ok: true, configured: false, stale: false, error: 'no-credential', connections: [], summary: emptySummary(demandes.length) })
  // Aucun outil nommé : la page demande « ce qui est DÉJÀ connecté ». La clé ne
  // vit que côté hôte et le MCP n'a pas de « liste tout » : on balaie ici le
  // catalogue local par lots, et on ne rend que ce qui porte un compte.
  if (demandes.length === 0) {
    try {
      const scan = await scanAccountConnections(credential.value)
      return sendJson(res, 200, { ok: true, configured: true, stale: false, error: null, connections: scan.connections, summary: scan.summary, scan: true })
    } catch (e) {
      return sendJson(res, 200, { ok: true, configured: true, stale: false, error: failureCode(e), connections: [], summary: emptySummary(0), scan: true })
    }
  }
  const out = await readConnections(credential.value, demandes)
  sendJson(res, 200, { ok: true, configured: true, stale: out.stale, error: out.error, connections: out.result.connections, summary: out.result.summary })
}

// ── connecteurs personnalisés (POST/GET/DELETE, écrit par le formulaire) ─────
// Le formulaire de l'onglet Composio parle à CES routes ; l'utilisateur ne voit
// jamais ni le YAML ni le .env. Source de vérité structurée : le sidecar JSON
// (~/.dsh/kybernos/connecteurs.json) pour l'édition aller-retour ; le bloc
// marqué dans cordis.patch.yml est le rendu dérivé que le loader DSH consomme.
// Un connecteur écrit par la skill (bloc sans sidecar) reste listé en lecture.
const CONNECTEURS_ROUTE = '/kybernos/composio/connecteurs'
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
const NOM_RE = /^[a-z][a-z0-9-]{0,30}$/
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
const BANNER = '# ── CONNECTEURS PERSONNALISÉS (géré par le formulaire et la skill connecteur-personnalise) ────'
// Token de secret dans une valeur de formulaire : « Bearer $TAVILY_API_KEY » →
// la référence process.env est générée par le serveur, la valeur jamais stockée
// dans le patch ni renvoyée par GET.
const TOKEN_RE = /\$([A-Z_][A-Z0-9_]*)/g

// ── K-01 : gardes sur les routes qui agissent ──────────────────────────────
// Origine EXACTE de l'écoute réelle du socket (recette 2026-10 M-02/S-03) :
// un POST cross-site (drive-by) ne doit jamais enregistrer un connecteur
// stdio — il serait lancé au redémarrage de DSH.
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
// Les POST qui écrivent exigent du JSON explicite : un text/plain cross-site
// passe sans préflight — on le refuse.
function jsonSeulement(req) {
  return String(req.headers['content-type'] || '').toLowerCase().includes('application/json')
}
// La commande stdio d'un connecteur doit être un exécutable SYSTÈME connu :
// chemin absolu, existant, exécutable, sous une racine non inscriptible par
// l'utilisateur. Un binaire posé dans le home (ou /tmp) n'est pas acceptable
// via ce POST libre — passer par le setup validé (skill connecteur-personnalise).
// Choix ASSUMÉ (contradicteur, K-01) : /usr/local/bin et /opt/homebrew/bin
// sont inscriptibles par l'utilisateur local (brew). La menace visée est le
// DRIVE-BY cross-site (bloqué par l'origine exacte + JSON) — un attaquant
// local qui peut écrire dans /opt/homebrew/bin n'a pas besoin de cette
// route pour exécuter du code. La liste ne change donc PAS.
const RACINES_STDIO_OK = ['/usr/bin', '/bin', '/usr/sbin', '/sbin', '/usr/local/bin', '/usr/local/sbin', '/opt/homebrew/bin', '/opt/homebrew/sbin']
function commandStdioOK(command) {
  if (typeof command !== 'string' || command.length === 0) return false
  if (/[\s\0-\x1f]/.test(command) === true) return false // ni espaces ni contrôle : un seul chemin propre
  if (command.startsWith('/') !== true) return false
  const sousRacine = RACINES_STDIO_OK.some((r) => command === r || command.startsWith(r + '/'))
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
function patchBlocks(text) {
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

function readSidecar() {
  try { const j = JSON.parse(readFileSync(SIDECAR_PATH(), 'utf8')); return Array.isArray(j) ? j : [] } catch (e) { return [] }
}

function writeSidecar(list) {
  const p = SIDECAR_PATH()
  const dir = p.slice(0, p.lastIndexOf('/'))
  try { if (existsSync(dir) === false) mkdirSync(dir, { recursive: true }) } catch (e) { /* déjà là */ }
  writeFileSync(p, JSON.stringify(list, null, 2) + '\n', 'utf8')
}

// ── H-09 : échappement YAML ──────────────────────────────────────────────────
// Every value written to cordis.patch.yml is a JSON-quoted scalar (yamlScalaire), and
// line breaks are refused upstream: a multi-line arg or env used to inject arbitrary
// KEYS (autoApprove: true) into the loader configuration.
const sansMultiLigne = (v) => /[\r\n\0]/.test(String(v)) !== true

/** Rend le texte du bloc marqué pour un connecteur structuré. */
function renderBlock(c) {
  const ind = (n) => ' '.repeat(n)
  const L = ['# connecteur:' + c.nom, '- insert:', ind(2) + '- id: mcp-client-' + c.nom, ind(4) + "name: '@deepseek-ai/dsh-mcp-client'", ind(4) + 'config:']
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
  L.push(ind(6) + 'toolCallTimeoutMs: 180000')
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
function checkPatch(avant, apres, nom, expect) {
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

/**
 * Writes NAME=value into ~/.dsh/.env (updates the existing line). Returns false
 * when no value is given. Throws when the name is not a valid variable name or
 * the value holds a line break (CR, LF or NUL): a second line would define an
 * arbitrary extra variable. The error never carries the value.
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
  const re = new RegExp('^[ \\t]*' + nom + '[ \\t]*=.*$', 'm')
  const line = nom + '=' + valeur
  // A replacer FUNCTION: a string would expand `$&`, `$1`, `$$`, `$\`` and `$'`
  // inside the secret and corrupt it.
  if (re.test(text) === true) writeFileSync(path, text.replace(re, () => line), 'utf8')
  else writeFileSync(path, (text.length > 0 && text.endsWith('\n') === false ? text + '\n' : text) + line + '\n', 'utf8')
  return true
}

/**
 * Checks the secrets of a POST body BEFORE any file is written, so a bad one
 * cannot leave a half-applied request behind. Returns an error message (never
 * containing a value) or null. Entries with an invalid name are skipped, as
 * storeSecrets skips them.
 */
function verifierSecrets(body) {
  if (Array.isArray(body.secrets) === false) return null
  for (const s of body.secrets) {
    if (s === null || s === undefined) continue
    const nom = String(s.name || '').trim()
    if (SECRET_RE.test(nom) !== true) continue
    // An empty value is "no value": nothing is written, so the name does no harm.
    if (String(s.value || '').length > 0 && isBootstrapOnlyName(nom) === true) return bootstrapMessage(nom)
    if (sansMultiLigne(String(s.value || '')) !== true) return 'secret ' + nom + ': the value must not contain line breaks'
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

/** Validates the POST body: returns { erreur } or the normalized { connecteur }. */
function normalizeConnecteur(body) {
  if (body === null || body === undefined || typeof body !== 'object') return { erreur: 'a JSON object is expected' }
  const nom = String(body.nom || '').trim()
  if (NOM_RE.test(nom) !== true) return { erreur: 'invalid name (lowercase letters, digits and dashes, starting with a letter, 2 to 31 characters): ' + nom.slice(0, 40) }
  const transport = body.transport === 'stdio' ? 'stdio' : (body.transport === 'streamable-http' ? 'streamable-http' : null)
  if (transport === null) return { erreur: 'invalid transport' }
  const c = { nom: nom, transport: transport, updatedAt: new Date().toISOString() }
  if (transport === 'stdio') {
    const command = String(body.command || '').trim()
    if (commandStdioOK(command) !== true) return { erreur: 'command: a system executable is required (absolute path under /usr/bin, /bin, /opt/homebrew/bin..., an executable file); a binary elsewhere goes through the validated setup (connecteur-personnalise)' }
    c.command = command
    c.args = Array.isArray(body.args) ? body.args.map((x) => String(x)).filter((x) => x.length > 0)
      : String(body.args || '').split(' ').map((x) => x.trim()).filter((x) => x.length > 0)
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
    c.url = u.origin + (u.pathname || '/') + (u.search || '')
    const headers = normalizePairs(body.headers, 'headers', true)
    if (headers.erreur !== undefined) return { erreur: headers.erreur }
    c.headers = headers.pairs
  }
  return { connecteur: c }
}

/** The NAME=value secrets of the body (the form's password fields) go to the DSH .env. */
function storeSecrets(body) {
  if (Array.isArray(body.secrets) === false) return 0
  let n = 0
  for (const s of body.secrets) {
    if (s === null || s === undefined) continue
    const nom = String(s.name || '').trim()
    if (SECRET_RE.test(nom) !== true) continue
    if (upsertEnvSecret(nom, String(s.value || '')) === true) n += 1
  }
  return n
}

async function serveConnecteurs(ctx, req, res) {
  // K-01: reads are reserved to the machine (exact origin); writes also need explicit JSON.
  if (origineOK(req) !== true) return sendJson(res, 403, { ok: false, error: 'origin refused' })
  if (req.method === 'GET') {
    const sidecar = readSidecar()
    const seen = {}
    for (const c of sidecar) { seen[c.nom] = true }
    const fromPatch = []
    const blocks = patchBlocks(readPatchText())
    for (const nom of Object.keys(blocks)) {
      if (seen[nom] === true) continue
      fromPatch.push(Object.assign({ nom: nom, horsFormulaire: true }, blockSummary(blocks[nom])))
    }
    // Never a secret value here: only names and labels leave.
    return sendJson(res, 200, { ok: true, connecteurs: sidecar.concat(fromPatch) })
  }
  if (req.method === 'POST') {
    if (jsonSeulement(req) !== true) return sendJson(res, 415, { ok: false, error: 'content-type application/json expected' })
    let body = null
    try { body = JSON.parse(await readBody(req)) } catch (e) { return sendJson(res, 400, { ok: false, error: 'a JSON body is expected' }) }
    const n = normalizeConnecteur(body)
    if (n.erreur !== undefined) return sendJson(res, 400, { ok: false, error: n.erreur })
    const secretErreur = verifierSecrets(body)
    if (secretErreur !== null) return sendJson(res, 400, { ok: false, error: secretErreur })
    const c = n.connecteur
    // The patch is built and checked BEFORE any file is written: a refusal leaves everything untouched.
    let avant = ''
    try { avant = readPatchText() } catch (e) { return sendJson(res, 500, { ok: false, error: fsMessage('cordis.patch.yml cannot be read', e) }) }
    const apres = patchWithBlock(avant, c)
    const verdict = checkPatch(avant, apres, c.nom, 'present')
    if (verdict.ok !== true) return sendJson(res, verdict.status, { ok: false, error: verdict.error })
    const secretsWritten = storeSecrets(body)
    const list = readSidecar().filter((x) => x.nom !== c.nom)
    list.push(c)
    list.sort((a, b) => (a.nom < b.nom ? -1 : 1))
    writeSidecar(list)
    try { writePatch(avant, apres, verdict.empty) } catch (e) { return sendJson(res, 500, { ok: false, error: fsMessage('cordis.patch.yml cannot be written', e) }) }
    return sendJson(res, 200, { ok: true, connecteur: c, secretsWritten: secretsWritten, needRestart: true, validated: verdict.validated })
  }
  if (req.method === 'DELETE') {
    const nom = queryOf(req).get('nom') || ''
    if (NOM_RE.test(nom) !== true) return sendJson(res, 400, { ok: false, error: 'invalid name' })
    let avant = ''
    try { avant = readPatchText() } catch (e) { return sendJson(res, 500, { ok: false, error: fsMessage('cordis.patch.yml cannot be read', e) }) }
    const apres = patchWithoutBlock(avant, nom)
    let verdict = null
    if (apres !== null) {
      verdict = checkPatch(avant, apres, nom, 'absent')
      if (verdict.ok !== true) return sendJson(res, verdict.status, { ok: false, error: verdict.error })
    }
    writeSidecar(readSidecar().filter((x) => x.nom !== nom))
    if (apres !== null) {
      try { writePatch(avant, apres, verdict.empty) } catch (e) { return sendJson(res, 500, { ok: false, error: fsMessage('cordis.patch.yml cannot be written', e) }) }
    }
    const removed = apres !== null
    return sendJson(res, 200, { ok: true, removed: removed, needRestart: removed })
  }
  return sendJson(res, 405, { ok: false, error: 'GET/POST/DELETE expected' })
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => { data += chunk; if (data.length > 200000) reject(new Error('corps trop grand')) })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

export function apply(ctx) {
  const log = (message) => { try { if (ctx.logger !== undefined && ctx.logger !== null) ctx.logger.info(message) } catch (e) { /* logger optionnel */ } }

  // Filet ultime : la route de lecture ne doit jamais rejeter vers le serveur web,
  // sinon une requête imprévue ferait tomber la page Connectors.
  const serveConnectionsSafe = async (req, res) => {
    try { await serveConnections(ctx, req, res) } catch (e) {
      try {
        if (res.headersSent !== true) sendJson(res, 200, { ok: true, configured: true, stale: false, error: 'offline', connections: [], summary: emptySummary(0) })
      } catch (e2) { /* socket déjà fermé */ }
    }
  }
  // Idem pour les connecteurs : une exception ne doit jamais casser la page.
  const serveConnecteursSafe = async (req, res) => {
    try { await serveConnecteurs(ctx, req, res) } catch (e) {
      try { if (res.headersSent !== true) sendJson(res, 500, { ok: false, error: fsMessage('internal error', e) }) } catch (e2) { /* socket closed */ }
    }
  }
  const mount = (webServerSvc) => {
    if (webServerSvc === null || webServerSvc === undefined || typeof webServerSvc.register !== 'function') return
    ctx.effect(() => webServerSvc.register({ kind: 'exact', path: CATALOG_ROUTE, handler: serveCatalog }), 'kybernos-composio: route catalogue')
    ctx.effect(() => webServerSvc.register({ kind: 'exact', path: CONNECTIONS_ROUTE, handler: serveConnectionsSafe }), 'kybernos-composio: route connexions')
    ctx.effect(() => webServerSvc.register({ kind: 'exact', path: CONNECTEURS_ROUTE, handler: serveConnecteursSafe }), 'kybernos-composio: route connecteurs')
    log('[composio] catalogue servi sur ' + CATALOG_ROUTE)
    log('[composio] connexions reelles servies sur ' + CONNECTIONS_ROUTE)
    log('[composio] connecteurs personnalises servis sur ' + CONNECTEURS_ROUTE)
  }
  if (ctx.get('webServer') !== undefined) mount(ctx.get('webServer'))
  else ctx.inject(['webServer'], (hostCtx) => mount(hostCtx.webServer))
  log('[composio] attaché — actions client via MCP, lecture des connexions côté host')
}
