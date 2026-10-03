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
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { join } from 'node:path'

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
    const text = readFileSync(join(homedir(), '.dsh', '.env'), 'utf8')
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
const PATCH_PATH = () => join(homedir(), '.dsh', 'profiles', 'web', 'cordis.patch.yml')
const SIDECAR_PATH = () => join(homedir(), '.dsh', 'kybernos', 'connecteurs.json')
const ENV_PATH = () => join(homedir(), '.dsh', '.env')
const NOM_RE = /^[a-z][a-z0-9-]{0,30}$/
const SECRET_RE = /^[A-Z_][A-Z0-9_]{0,63}$/
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

/** Rend une valeur de formulaire en expression !!js si elle porte un $NOM. */
function renderValue(raw) {
  const v = String(raw === null || raw === undefined ? '' : raw)
  if (v.indexOf('$') === -1) return { yaml: "'" + v.replace(/'/g, "''") + "'" }
  let expr = "'"
  let last = 0
  let m
  TOKEN_RE.lastIndex = 0
  while ((m = TOKEN_RE.exec(v)) !== null) {
    expr += v.slice(last, m.index).replace(/'/g, "\\'") + "' + (process.env." + m[1] + " || '') + '"
    last = m.index + m[0].length
  }
  expr += v.slice(last).replace(/'/g, "\\'") + "'"
  expr = expr.replace(/ \+ ''/g, '').replace(/'' \+/g, '').trim()
  if (expr.charAt(0) === "'" && expr.charAt(expr.length - 1) === "'" && expr.indexOf('+') === -1) expr = expr.slice(1, -1)
  return { yaml: '!!js "' + expr.replace(/"/g, '\\"') + '"', secrets: true }
}

function readPatchText() { return existsSync(PATCH_PATH()) ? readFileSync(PATCH_PATH(), 'utf8') : '' }

/** Blocs du patch : de « # connecteur:<nom> » au prochain marqueur ou à la fin. */
function patchBlocks(text) {
  const lines = String(text).split('\n')
  const out = {}
  let cur = null
  for (const line of lines) {
    const m = /^# connecteur:([a-z0-9-]+)\s*$/.exec(line)
    if (m !== null) { cur = m[1]; out[cur] = [line]; continue }
    if (cur !== null) {
      if (/^# connecteur:/.test(line) === true) { cur = null; continue }
      out[cur].push(line)
    }
  }
  return out
}

/** Extraction minimale d'un bloc (nom, transport, serverName, url|command). */
function blockSummary(lines) {
  const pick = (re) => { for (const l of lines) { const m = re.exec(l); if (m !== null) return m[1] } return null }
  const transport = pick(/^[ \t]+transport:[ ]*([a-z-]+)/)
  return {
    transport: transport === 'streamable-http' ? 'streamable-http' : 'stdio',
    serverName: pick(/^[ \t]+serverName:[ ]*([^\s'#]+)/),
    url: pick(/^[ \t]+url:[ ]*([^\s'#]+)/),
    command: pick(/^[ \t]+command:[ ]*([^\s'#]+)/),
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
// Toute valeur posée dans cordis.patch.yml est un scalaire QUOTÉ simple (les
// ' doublés), et les retours ligne sont refusés en amont : un arg ou un env
// multi-lignes injectait des CLÉS arbitraires (autoApprove: true) dans la
// configuration du loader.
const yamlScalaire = (v) => "'" + String(v === null || v === undefined ? '' : v).replace(/'/g, "''") + "'"
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
      for (const e of envs) L.push(ind(8) + yamlScalaire(e.name) + ': ' + renderValue(e.value).yaml)
    }
  } else {
    L.push(ind(6) + 'url: ' + yamlScalaire(c.url))
    const hs = c.headers || []
    if (hs.length > 0) {
      L.push(ind(6) + 'headers:')
      for (const e of hs) L.push(ind(8) + yamlScalaire(e.name) + ': ' + renderValue(e.value).yaml)
    }
  }
  L.push(ind(6) + 'toolCallTimeoutMs: 180000')
  L.push(ind(6) + 'failOnStartupError: false')
  L.push(ind(6) + 'reconnect:')
  L.push(ind(8) + 'enabled: true')
  L.push(ind(8) + 'maxAttempts: 10')
  return L.join('\n')
}

/** Réécrit le patch : remplace/insère le bloc marqué, pose le bandeau si absent. */
function upsertPatchBlock(c) {
  const path = PATCH_PATH()
  const text = readPatchText()
  const rendered = renderBlock(c)
  const blocks = patchBlocks(text)
  if (blocks[c.nom] !== undefined) {
    const old = blocks[c.nom].join('\n')
    writeFileSync(path, text.replace(old, rendered), 'utf8')
    return
  }
  const hasBanner = text.indexOf('CONNECTEURS PERSONNALISÉS') >= 0
  const add = (hasBanner ? '' : (text.endsWith('\n') || text.length === 0 ? '' : '\n') + '\n' + BANNER + '\n')
    + '\n' + rendered + '\n'
  writeFileSync(path, text + add, 'utf8')
}

function removePatchBlock(nom) {
  const text = readPatchText()
  const blocks = patchBlocks(text)
  const b = blocks[nom]
  if (b === undefined) return false
  const old = b.join('\n')
  const at = text.indexOf(old)
  if (at === -1) return false
  let head = text.slice(0, at)
  const tail = text.slice(at + old.length)
  // L'insertion pose le bloc precede d'une ligne vide (« \n » + rendered) :
  // le retrait doit reprendre CETTE ligne. Sans ça, chaque aller-retour
  // POST puis DELETE laissait une ligne vide de plus dans le patch — mesure
  // du 23/09/2026 sur la route reelle : 677a678, un saut ajoute a chaque cycle.
  if (head.endsWith('\n\n') === true) head = head.slice(0, -1)
  const out = tail.length === 0
    ? (head + tail).replace(/\n+$/, '\n')
    : (head + tail).replace(/\n{3,}/g, '\n\n')
  writeFileSync(PATCH_PATH(), out, 'utf8')
  return true
}

/** Écrit NOM=valeur dans ~/.dsh/.env (met à jour la ligne existante). Renvoie false si aucune valeur fournie. */
function upsertEnvSecret(nom, valeur) {
  if (typeof valeur !== 'string' || valeur.length === 0) return false
  const path = ENV_PATH()
  let text = ''
  try { text = existsSync(path) ? readFileSync(path, 'utf8') : '' } catch (e) { text = '' }
  const re = new RegExp('^[ \\t]*' + nom + '[ \\t]*=.*$', 'm')
  const line = nom + '=' + valeur
  if (re.test(text) === true) writeFileSync(path, text.replace(re, line), 'utf8')
  else writeFileSync(path, (text.length > 0 && text.endsWith('\n') === false ? text + '\n' : text) + line + '\n', 'utf8')
  return true
}

/** Valide le corps POST ; renvoie { erreur } ou { connecteur } normalisé. */
function normalizeConnecteur(body) {
  if (body === null || body === undefined || typeof body !== 'object') return { erreur: 'corps attendu' }
  const nom = String(body.nom || '').trim()
  if (NOM_RE.test(nom) !== true) return { erreur: "nom invalide (kebab-case, 2-31 caractères) : " + nom }
  const transport = body.transport === 'stdio' ? 'stdio' : (body.transport === 'streamable-http' ? 'streamable-http' : null)
  if (transport === null) return { erreur: 'transport invalide' }
  const c = { nom: nom, transport: transport, updatedAt: new Date().toISOString() }
  if (transport === 'stdio') {
    const command = String(body.command || '').trim()
    if (commandStdioOK(command) !== true) return { erreur: 'command : exécutable système requis (chemin absolu sous /usr/bin, /bin, /opt/homebrew/bin…, fichier exécutable) — un binaire ailleurs passe par le setup validé (connecteur-personnalise)' }
    c.command = command
    c.args = Array.isArray(body.args) ? body.args.map((x) => String(x)).filter((x) => x.length > 0)
      : String(body.args || '').split(' ').map((x) => x.trim()).filter((x) => x.length > 0)
    if (c.args.some((a) => sansMultiLigne(a) !== true)) return { erreur: 'args : pas de retours ligne (échappement YAML)' }
    // Surface résiduelle ASSUMÉE (contradicteur, K-01) : les args restent
    // libres en contenu (des args légitimes portent des chemins, des URL,
    // des drapeaux) — un attaquant same-origin pourrait poser un args du
    // genre « --config /chemin ». La défense de ce vecteur est l'ORIGINE
    // exacte + JSON requis sur ce POST : un drive-by cross-site ne passe
    // plus ; un attaquant same-origin a déjà la main sur la machine. On
    // borne la LONGUEUR et le NOMBRE pour contenir l'exfiltration.
    if (c.args.length > 8) return { erreur: 'args : 8 arguments maximum' }
    if (c.args.some((a) => a.length > 200)) return { erreur: 'args : 200 caractères maximum par argument' }
    if (typeof body.cwd === 'string' && body.cwd.trim().length > 0) c.cwd = body.cwd.trim()
    if (c.cwd !== undefined && sansMultiLigne(c.cwd) !== true) return { erreur: 'cwd : pas de retours ligne (échappement YAML)' }
    // H-09 (rebond contradicteur 03/10) : les NAMES multi-lignes permettent
    // d'injecter des clés YAML — on filtre name ET value, et le compteur
    // ci-dessous détecte alors l'écart (400).
    c.env = pairsOf(body.env).filter((e) => sansMultiLigne(e.value) === true && sansMultiLigne(e.name) === true)
    if ((body.env || []).length > 0 && c.env.length !== (body.env || []).filter((p) => p !== null && p !== undefined && typeof p.name === 'string' && p.name.trim().length > 0).length) return { erreur: 'env : name doit être un identifiant simple, value sans retours ligne (échappement YAML)' }
  } else {
    let u = null
    try { u = new URL(String(body.url || '')) } catch (e) { u = null }
    if (u === null || (u.protocol !== 'https:' && u.protocol !== 'http:')) return { erreur: 'url invalide (http/https)' }
    c.url = u.origin + (u.pathname || '/') + (u.search || '')
    c.headers = pairsOf(body.headers).filter((e) => sansMultiLigne(e.value) === true && sansMultiLigne(e.name) === true)
    if ((body.headers || []).length > 0 && c.headers.length !== (body.headers || []).filter((p) => p !== null && p !== undefined && typeof p.name === 'string' && p.name.trim().length > 0).length) return { erreur: 'headers : name doit être un identifiant simple, value sans retours ligne (échappement YAML)' }
  }
  return { connecteur: c }
}

// H-09 (reboucle) : le NAME d'une paire env/header est une CLÉ YAML au
// rendu — il doit être un identifiant simple (lettres, chiffres, _ . -),
// jamais de retour ligne, de ':' ni de quote : `X: 1\n  autoApprove`
// injectait une CLÉ arbitraire dans cordis.patch.yml.
const NAME_PAILLE_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/
function paireNameValide(p) {
  return p !== null && p !== undefined && typeof p.name === 'string' && NAME_PAILLE_RE.test(p.name.trim()) === true
}
function pairsOf(raw) {
  if (Array.isArray(raw) === false) return []
  return raw
    .filter(paireNameValide)
    .map((p) => ({ name: p.name.trim(), value: String(p.value === null || p.value === undefined ? '' : p.value) }))
}

/** Secrets NOM=valeur du corps (champ password du formulaire) → ~/.dsh/.env. */
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
  // K-01 : lecture réservée à la machine (origine exacte), écriture en plus
  // cantonnée au JSON explicite.
  if (origineOK(req) !== true) return sendJson(res, 403, { ok: false, error: 'origine refusee' })
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
    // Jamais de valeur de secret ici : seuls les noms et les libellés sortent.
    return sendJson(res, 200, { ok: true, connecteurs: sidecar.concat(fromPatch) })
  }
  if (req.method === 'POST') {
    if (jsonSeulement(req) !== true) return sendJson(res, 415, { ok: false, error: 'content-type application/json attendu' })
    let body = null
    try { body = JSON.parse(await readBody(req)) } catch (e) { return sendJson(res, 400, { ok: false, error: 'corps JSON attendu' }) }
    const n = normalizeConnecteur(body)
    if (n.erreur !== undefined) return sendJson(res, 400, { ok: false, error: n.erreur })
    const c = n.connecteur
    const secretsWritten = storeSecrets(body)
    const list = readSidecar().filter((x) => x.nom !== c.nom)
    list.push(c)
    list.sort((a, b) => (a.nom < b.nom ? -1 : 1))
    writeSidecar(list)
    try { upsertPatchBlock(c) } catch (e) { return sendJson(res, 500, { ok: false, error: 'écriture config: ' + String((e && e.message) || e) }) }
    return sendJson(res, 200, { ok: true, connecteur: c, secretsWritten: secretsWritten, needRestart: true })
  }
  if (req.method === 'DELETE') {
    const nom = queryOf(req).get('nom') || ''
    if (NOM_RE.test(nom) !== true) return sendJson(res, 400, { ok: false, error: 'nom invalide' })
    writeSidecar(readSidecar().filter((x) => x.nom !== nom))
    const removed = removePatchBlock(nom)
    return sendJson(res, 200, { ok: true, removed: removed, needRestart: removed })
  }
  return sendJson(res, 405, { ok: false, error: 'GET/POST/DELETE attendus' })
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
      try { if (res.headersSent !== true) sendJson(res, 500, { ok: false, error: String((e && e.message) || e) }) } catch (e2) { /* socket fermé */ }
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
