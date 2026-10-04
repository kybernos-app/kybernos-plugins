// ── Kybernos Cloud — appairage par code d'appareil + profil + catalogue (half host) ─
//
// Ce half fait trois choses :
//   1. parler à l'API Kybernos (https://api.dev.kybernos.app par défaut) ;
//   2. garder le secret d'appareil HORS du navigateur et HORS du dépôt, dans
//      ~/.dsh/kybernos-cloud.json (mode 0600) ;
//   3. quand l'utilisateur est connecté, importer AUTOMATIQUEMENT le catalogue
//      de modèles du proxy Kybernos LiteLLM (glm, deepseek…) dans le harnais :
//      route provider `kybernos` de settings.yaml + credential KYBERNOS_API_KEY.
//
// Il ne connaît NI mot de passe NI clé Supabase. L'utilisateur s'authentifie
// dans SON navigateur, sur la page d'activation servie par Kybernos (device
// code flow, RFC 8628) ; ce plugin ne stocke ensuite que le `kys-…` opaque
// minté au claim — le même genre de jeton qu'une session web, révocable depuis
// l'app Kybernos (Sécurité → Sessions).
//
// Contrat des routes (toutes en same-origin, jamais exposées au réseau) :
//   POST /kybernos-cloud/start         → crée une demande d'appairage
//   POST /kybernos-cloud/poll          → état de la demande / claim du jeton
//   GET  /kybernos-cloud/status        → état local, sans réseau
//   POST /kybernos-cloud/refresh       → rafraîchit le profil depuis l'API
//   POST /kybernos-cloud/disconnect    → révoque côté serveur + oublie le local
//                                         (+ retire le catalogue importé)
//   GET  /kybernos-cloud/models        → détail du catalogue importé
//   POST /kybernos-cloud/models/sync   → resynchronise le catalogue maintenant
//   GET  /kybernos-cloud/artifacts     → les livrables poussés (?limit=)
//   POST /kybernos-cloud/artifacts/push    → pousse un livrable (idempotent)
//   POST /kybernos-cloud/artifacts/detail  → détail + URL signée {id}
//
// Les routes d'artefacts (phase A) sont le seul chemin par lequel un livrable
// du chat local rejoint le magasin de l'app (`kybernos.artifacts` — la table
// où l'EF `kybernos-chat` écrit déjà). Le jeton ne quitte jamais ce module.
//
// Invariant : le `token` n'est JAMAIS renvoyé au client, jamais loggé. Le
// client ne voit que `publicState()` (profil, workspaces, état, résumé du
// catalogue). L'abonnement (glm, deepseek… accessibles selon la formule) est
// appliqué par le proxy à chaque requête — ce plugin ne filtre rien.
import { chmodSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { dirname, join } from 'node:path'
import { normaliserCatalogue, ymlDuKyber, verdictInstallation } from './marketplace-kyber.mjs'
import { rank as rankByRelevance } from './relevance.mjs'
import { zstdDecompressSync } from 'node:zlib'

const STATE_DIR = join(homedir(), '.dsh')
const STATE_FILE = join(STATE_DIR, 'kybernos-cloud.json')
const DEFAULT_API = 'https://api.dev.kybernos.app'
/** Web du même tier que l'API (api.dev.… → dev.…) : c'est là que vit la page
 *  de l'espace, et le plugin n'a pas à recopier l'hôte dans son coin. */
const DEFAULT_WEB = DEFAULT_API.replace('//api.', '//')
const CLIENT_VERSION = '0.1.0'
const CLIENT_NAME = 'dsh'
const REQUEST_TIMEOUT_MS = 15000
const MAX_LABEL = 64

/** Base d'API : dev par défaut, surchargée par KYBERNOS_CLOUD_API. */
const resolveApi = () => {
  const raw = process.env.KYBERNOS_CLOUD_API
  const value = typeof raw === 'string' ? raw.trim() : ''
  return value === '' ? DEFAULT_API : value.replace(/\/+$/, '')
}

/** Fichier d'état : surchargeable par KYBERNOS_CLOUD_STATE (tests, multi-profil). */
const stateFile = () => {
  const raw = process.env.KYBERNOS_CLOUD_STATE
  const value = typeof raw === 'string' ? raw.trim() : ''
  return value === '' ? STATE_FILE : value
}

/** Libellé d'appareil tel qu'il apparaîtra dans « Sécurité → Sessions ». */
const deviceLabel = () => {
  let host = 'dsh'
  try { host = hostname() || 'dsh' } catch (e) { host = 'dsh' }
  return ('DSH ' + host).slice(0, MAX_LABEL)
}

const readState = () => {
  try {
    const parsed = JSON.parse(readFileSync(stateFile(), 'utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : null
  } catch (e) {
    return null
  }
}

const writeState = (state) => {
  const file = stateFile()
  try { mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 }) } catch (e) { /* deja la */ }
  writeFileSync(file, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 })
  // writeFileSync ne resserre pas un fichier existant : on force le 0600.
  try { chmodSync(file, 0o600) } catch (e) { /* FS exotique (Windows) */ }
}

const clearState = () => {
  try { rmSync(stateFile(), { force: true }) } catch (e) { /* deja absent */ }
}

const isConnected = (state) => state !== null && typeof state.token === 'string' && state.token !== ''

/** Vue publique : ni token, ni device_secret, ni code une fois consommé.
 *  L'import de catalogue est résumé (fait/quantité/formule) — jamais les ids
 *  complets ici : la route /kybernos-cloud/models les détaille à la demande. */
const publicState = (state) => ({
  connected: true,
  user: state.user !== undefined && state.user !== null ? state.user : null,
  workspaces: Array.isArray(state.workspaces) ? state.workspaces : [],
  // L'espace ACTIF — ce que la rangée de pied de sidebar affiche, et ce que le
  // sélecteur change. Tant que l'utilisateur n'a rien choisi, on DÉRIVE le
  // premier espace (le perso, créé à la connexion) sans rien écrire : un défaut
  // dérivé n'est pas un choix, et l'écrire ferait croire à une décision.
  active_workspace_id: espaceActif(state),
  web_url: DEFAULT_WEB,
  device_label: state.device_label !== undefined ? state.device_label : null,
  expires_at: state.expires_at !== undefined ? state.expires_at : null,
  refreshed_at: state.refreshed_at !== undefined ? state.refreshed_at : null,
  models: state.models !== undefined && state.models !== null ? publicModels(state.models) : null,
  // Annuaire des chats DSH : dernier envoi (métadonnées, jamais de contenu).
  chats_last_push: state.chats_last_push !== undefined ? state.chats_last_push : null,
})

/** Id de l'espace actif : le choix explicite s'il est encore valide, sinon le
 *  premier espace connu. Jamais un id qui n'existe plus dans la liste. */
const espaceActif = (state) => {
  const espaces = state !== null && state !== undefined && Array.isArray(state.workspaces) ? state.workspaces : []
  const ids = espaces.map((w) => (w !== null && typeof w.id === 'string' ? w.id : null)).filter((id) => id !== null)
  const choisi = typeof state.active_workspace_id === 'string' ? state.active_workspace_id : null
  if (choisi !== null && ids.indexOf(choisi) !== -1) return choisi
  return ids.length > 0 ? ids[0] : null
}

/** Route : choisir l'espace actif. Fail-closed — un id inconnu est REFUSÉ et
 *  jamais écrit : un espace qu'on ne voit pas ne devient pas actif. */
const setActiveSpace = (req, body) => {
  const state = readState()
  if (!isConnected(state)) return { ok: false, error: 'non_connecte' }
  const voulu = body !== null && typeof body === 'object' && typeof body.workspace_id === 'string' ? body.workspace_id : ''
  if (voulu === '') return { ok: false, error: 'espace_absent' }
  const espaces = Array.isArray(state.workspaces) ? state.workspaces : []
  if (espaces.some((w) => w !== null && w.id === voulu) !== true) return { ok: false, error: 'espace_inconnu' }
  const next = Object.assign({}, state, { active_workspace_id: voulu })
  writeState(next)
  return { ok: true, state: publicState(next) }
}

/** Route : créer un espace. Le serveur hébergé reste maître — on transmet le
 *  nom à POST /v1/workspaces ; en cas de refus (route absente, plan limité,
 *  permission manquante) on ne fabrique RIEN localement : on rend l'URL de
 *  l'app pour que la création se fasse là où elle est réellement décidée. */
const createSpace = async (req, body) => {
  const state = readState()
  if (!isConnected(state)) return { ok: false, error: 'non_connecte', web_url: DEFAULT_WEB }
  const nom = body !== null && typeof body === 'object' && typeof body.name === 'string' ? body.name.trim().slice(0, 60) : ''
  if (nom === '') return { ok: false, error: 'nom_absent' }
  const res = await apiCall('/v1/workspaces', { method: 'POST', token: state.token, body: { name: nom } })
  if (res.status !== 200 && res.status !== 201) {
    return { ok: false, error: 'creation_refusee', status: res.status, web_url: DEFAULT_WEB }
  }
  const brut = res.body !== null && typeof res.body === 'object' ? (res.body.workspace !== undefined && res.body.workspace !== null ? res.body.workspace : res.body) : null
  const id = brut !== null && typeof brut.id === 'string' ? brut.id : null
  const espaces = Array.isArray(state.workspaces) ? state.workspaces.slice() : []
  if (id !== null && espaces.some((w) => w !== null && w.id === id) !== true) espaces.push(brut)
  const next = Object.assign({}, state, { workspaces: espaces, active_workspace_id: id !== null ? id : state.active_workspace_id })
  writeState(next)
  return { ok: true, state: publicState(next) }
}

const publicPairing = (state) => ({
  user_code: state.user_code !== undefined ? state.user_code : null,
  activation_url: state.activation_url !== undefined ? state.activation_url : null,
  expires_at: state.expires_at !== undefined ? state.expires_at : null,
})

/** Fusionne le profil serveur (/v1/me) dans le `user` en cache.
 *
 * Seules les valeurs RENSEIGNÉES écrasent : un `name` null côté serveur
 * (colonne `kybernos_users.name` vide) ne doit pas effacer un nom déjà connu,
 * et l'email n'est jamais touché — il ne vient que du claim, l'identité /v1/*
 * ne le porte pas. */
const mergeUser = (cached, profile) => {
  const base = cached !== null && typeof cached === 'object' ? cached : {}
  if (profile === null || typeof profile !== 'object') return base
  const next = Object.assign({}, base)
  for (const key of ['id', 'name', 'plan']) {
    const value = profile[key]
    if (typeof value === 'string' && value.trim() !== '') next[key] = value.trim()
  }
  return next
}

/** Appel API : ne throw jamais, renvoie { status, body } (status 0 = réseau). */
const apiCall = async (path, options = {}) => {
  const method = typeof options.method === 'string' ? options.method : 'GET'
  const token = typeof options.token === 'string' ? options.token : null
  const body = options.body !== undefined && options.body !== null ? options.body : null
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
  try {
    const headers = { 'content-type': 'application/json' }
    if (token !== null) headers.authorization = 'Bearer ' + token
    const res = await fetch(resolveApi() + path, {
      method,
      headers,
      signal: ctrl.signal,
      body: body === null ? undefined : JSON.stringify(body),
    })
    let parsed = null
    try { parsed = await res.json() } catch (e) { parsed = null }
    return { status: res.status, body: parsed }
  } catch (e) {
    return { status: 0, body: null, error: String((e && e.message) || e) }
  } finally {
    clearTimeout(timer)
  }
}

// ── Opérations ──────────────────────────────────────────────────────────────

const startPairing = async () => {
  const current = readState()
  if (isConnected(current)) return { ok: true, connected: true, state: publicState(current) }
  const res = await apiCall('/v1/device/start', {
    method: 'POST',
    body: { client: CLIENT_NAME, version: CLIENT_VERSION, device_label: deviceLabel() },
  })
  if (res.status !== 200 || res.body === null || typeof res.body.device_id !== 'string') {
    return { ok: false, error: res.status === 429 ? 'trop_de_demandes' : 'demarrage_impossible', status: res.status }
  }
  const ttl = typeof res.body.expires_in === 'number' ? res.body.expires_in : 600
  const state = {
    device_id: res.body.device_id,
    device_secret: res.body.device_secret,
    user_code: res.body.user_code,
    activation_url: res.body.activation_url,
    expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
    created_at: new Date().toISOString(),
    api: resolveApi(),
    device_label: deviceLabel(),
  }
  writeState(state)
  return { ok: true, connected: false, status: 'pending', pairing: publicPairing(state) }
}

const pollPairing = async () => {
  const state = readState()
  if (isConnected(state)) return { ok: true, connected: true, state: publicState(state) }
  if (state === null || typeof state.device_secret !== 'string') {
    return { ok: true, connected: false, status: 'none' }
  }
  const res = await apiCall('/v1/device/poll', {
    method: 'POST',
    body: { device_id: state.device_id, device_secret: state.device_secret },
  })
  if (res.status === 0) return { ok: false, error: 'reseau', status: 0 }
  const status = res.body !== null && typeof res.body.status === 'string' ? res.body.status : 'expired'
  if (status === 'claimed' && typeof res.body.token === 'string') {
    // Fin de l'appairage : le secret d'appareil et le code disparaissent ici.
    const next = {
      token: res.body.token,
      user: res.body.user !== undefined ? res.body.user : null,
      expires_at: res.body.expires_at !== undefined ? res.body.expires_at : null,
      connected_at: new Date().toISOString(),
      api: state.api !== undefined ? state.api : resolveApi(),
      device_label: state.device_label !== undefined ? state.device_label : deviceLabel(),
    }
    writeState(next)
    // Connexion = import du catalogue (fonctionnalité cloud n°1). L'import ne
    // throw jamais et ne remet jamais en cause le claim qui vient d'aboutir :
    // un catalogue indisponible se voit, se resynchronise, ne bloque rien.
    const imported = await importCatalog('claim')
    return {
      ok: true,
      connected: true,
      state: publicState(next),
      models: imported.summary !== undefined ? imported.summary : null,
      import_error: imported.ok === true ? undefined : imported.error,
    }
  }
  if (status === 'pending') {
    return { ok: true, connected: false, status: 'pending', pairing: publicPairing(state) }
  }
  // denied / expired : la demande est morte, on oublie tout (l'utilisateur en
  // relancera une ; le serveur ne re-mint jamais une demande déjà traitée).
  clearState()
  return { ok: true, connected: false, status }
}

const statusRoute = () => {
  const state = readState()
  if (isConnected(state)) return { ok: true, connected: true, state: publicState(state) }
  if (state !== null && typeof state.device_secret === 'string') {
    return { ok: true, connected: false, status: 'pending', pairing: publicPairing(state) }
  }
  return { ok: true, connected: false, status: 'none' }
}

const refreshProfile = async () => {
  const state = readState()
  if (!isConnected(state)) return { ok: true, connected: false, status: 'none' }
  // Deux lectures en parallèle : le profil (/v1/me, ajouté côté serveur pour
  // ce plugin) et les workspaces. Le profil rend le NOM et la FORMULE vivants
  // — sans lui, l'identité resterait figée à l'instant du claim : un nom
  // renseigné ou une montée de formule plus tard ne remonterait jamais.
  const [me, ws] = await Promise.all([
    apiCall('/v1/me', { token: state.token }),
    apiCall('/v1/workspaces', { token: state.token }),
  ])
  // La révocation se décide sur /v1/workspaces, la route historique : elle
  // répond 401/403 dès que le jeton est mort. /v1/me est un ENRICHISSEMENT —
  // un 401 dessus ne déconnecte jamais. Ce n'est pas théorique : au premier
  // déploiement de /v1/me, la route répondait 401 à un jeton valide (elle
  // tombait dans le régime « master key » du middleware) ; s'y fier pour
  // déconnecter aurait éjecté tous les utilisateurs sur un bug serveur.
  if (ws.status === 401 || ws.status === 403) {
    // Jeton révoqué depuis l'app Kybernos → « Reconnexion requise ». Les
    // modèles importés ne serviraient plus à rien (le proxy refuserait les
    // appels) : ils partent avec la session.
    await removeImportedCatalog(state)
    clearState()
    return { ok: true, connected: false, status: 'revoked' }
  }
  if (ws.status !== 200) return { ok: false, error: 'profil_indisponible', status: ws.status }
  const workspaces = ws.body !== null && Array.isArray(ws.body.workspaces) ? ws.body.workspaces : []
  // /v1/me absent (serveur plus ancien : 404), cassé (401/403) ou en panne :
  // on garde le user en cache et on ne casse PAS le rafraîchissement. L'email
  // n'est jamais écrasé — il ne vient que du claim (l'identité /v1/* ne le
  // porte pas).
  const profile = me.status === 200 && me.body !== null && typeof me.body === 'object' ? me.body : null
  const user = mergeUser(state.user, profile)
  const next = Object.assign({}, state, { user, workspaces, refreshed_at: new Date().toISOString() })
  writeState(next)
  // Fonctionnalité cloud n°1 : si rien n'a encore été importé (vieux fichier
  // d'état, DSH mis à jour), le refresh importe à son tour. Sinon, la formule
  // remontée par /v1/me est reflétée dans le résumé — le catalogue lui-même
  // n'est re-téléchargé qu'au sync manuel (il n'est pas filtré par formule :
  // l'abonnement est appliqué par le proxy, requête par requête).
  let models = null
  let import_error
  const known = state.models !== undefined && state.models !== null ? state.models : null
  if (known === null || known.provider !== PROVIDER_ID) {
    const imported = await importCatalog('refresh')
    models = imported.summary !== undefined ? imported.summary : null
    if (imported.ok !== true) import_error = imported.error
  } else if (known.plan !== userPlan(next)) {
    const merged = Object.assign({}, known, { plan: userPlan(next) })
    writeState(Object.assign({}, next, { models: merged }))
    models = publicModels(merged)
  } else {
    models = publicModels(known)
  }
  return { ok: true, connected: true, state: publicState(readState()), models, ...(import_error !== undefined ? { import_error } : {}) }
}

const disconnect = async () => {
  const state = readState()
  const token = isConnected(state) ? state.token : null
  // L'import de catalogue vit dans settings.yaml + le store de credentials :
  // il part avec la session, AVANT que le fichier d'état ne disparaisse
  // (removeImportedCatalog a besoin de l'état pour savoir ce qu'il a posé).
  await removeImportedCatalog(state)
  clearState()
  // Le cache du compte précédent ne doit jamais survivre à la déconnexion : après
  // une re-connexion à un AUTRE compte, il aurait été servi dans le prompt.
  emptyMemoryCache()
  if (token === null) return { ok: true, revoked: false, status: 0 }
  const res = await apiCall('/v1/session', { method: 'DELETE', token })
  return { ok: true, revoked: res.status === 204 || res.status === 200, status: res.status }
}

// ── Catalogue de modèles Kybernos LiteLLM ───────────────────────────────────
//
// Quand l'utilisateur est connecté, DSH importe AUTOMATIQUEMENT les modèles
// que le proxy Kybernos LiteLLM expose (`GET /v1/models`, liste standard
// OpenAI-compatible) dans le harnais : une route provider `kybernos` de
// `settings.yaml` (namespace `llm-pi-ai`) + le jeton `kys-…` posé comme
// credential `KYBERNOS_API_KEY`. Le proxy fait lui-même l'échange
// session→clé personnelle (session_token_swap) : le jeton de session EST
// l'identifiant d'appel, et l'abonnement est appliqué côté proxy, à chaque
// requête (gating par formule, fail-closed) — jamais dupliqué ici.
//
// Déclencheurs : au claim (connexion), au démarrage de DSH si déjà connecté,
// au refresh si rien n'a encore été importé, et à la demande (POST
// /kybernos-cloud/models/sync, bouton « Réimporter »). La déconnexion et la
// révocation retirent la route et le credential — mais UNIQUEMENT ce que
// CETTE fonctionnalité a posé (traçé dans l'état : models.provider).
//
// Invariants : le jeton ne sort jamais d'ici (ni réponse, ni log) ; un
// catalogue 401 ne déconnecte JAMAIS (leçon /v1/me : la révocation se décide
// sur /v1/workspaces) ; l'écriture settings passe par le service `settings`
// (le même chemin que la page Models native), les erreurs dégradent sans
// jamais casser l'appairage.

const CRED_REF = 'KYBERNOS_API_KEY'
const PROVIDER_ID = 'kybernos'
const PROVIDER_DISPLAY = 'Kybernos Cloud'
const KB_ROUTE_PREFIX = 'kybernos/'

let hostCtx = null

/** Un service du harnais, ou null quand le déploiement n'en monte pas :
 *  settings et credentials sont optionnels — leur absence dégrade l'import
 *  (catalogue mémorisé, écritures sautées) au lieu de le casser. */
const service = (name) => {
  if (hostCtx === null || typeof hostCtx.get !== 'function') return null
  const svc = hostCtx.get(name)
  return svc === undefined ? null : svc
}

/** La formule courante (peut être absente du profil). */
const userPlan = (state) => {
  const user = state !== null && state.user !== undefined && state.user !== null ? state.user : {}
  return typeof user.plan === 'string' ? user.plan : null
}

/** Base OpenAI-compatible du proxy : l'API Kybernos + /v1 (chat completions,
 *  models). Le swap kys→sk du serveur couvre ces routes natives. */
const baseUrl = (state) => {
  const api = state !== null && typeof state.api === 'string' && state.api !== '' ? state.api : resolveApi()
  return api.replace(/\/+$/, '') + '/v1'
}

const intOf = (...candidates) => {
  for (const raw of candidates) {
    const n = typeof raw === 'number' ? raw : Number(raw)
    if (Number.isFinite(n) && n > 0 && Number.isInteger(n) === true) return n
  }
  return null
}

/** Ne garde que les routes produit `kybernos/*` appelables en chat :
 *  pas les jumeaux de fallback (-fb1, -fb2…), pas les pools de routage infra
 *  (*_rg), pas la route embeddings. Les autres ids du catalogue LiteLLM
 *  (modèles bruts des backends, groupes de tiers) ne sont pas une surface
 *  produit — les appeler directement contournerait le gating Kybernos. */
const keepChatModels = (ids) => {
  const kept = []
  const seen = new Set()
  for (const id of ids) {
    if (typeof id !== 'string' || id.indexOf(KB_ROUTE_PREFIX) !== 0) continue
    if (/-fb[0-9]+$/.test(id) === true) continue
    if (/_rg$/.test(id) === true) continue
    if (id === 'kybernos/embed' || id.indexOf('kybernos/embed-') === 0) continue
    if (seen.has(id) === true) continue
    seen.add(id)
    kept.push(id)
  }
  return kept
}

/** `kybernos/orchestrator-expert` → « Kybernos Orchestrator Expert ». */
const humanizeModelName = (id) => {
  const segment = id.slice(KB_ROUTE_PREFIX.length) || id
  const words = segment.split(/[-_.]/).filter((w) => w.length > 0)
  return 'Kybernos ' + words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

/** Entrée settings d'un modèle : {id, name}, enrichie des capacités quand le
 *  catalogue en fournit (LiteLLM expose parfois max_tokens / context_length).
 *  Un modèle non dimensionné prend les replis de la route (262 144 / 32 768). */
const modelEntry = (id, info) => {
  const entry = { id, name: humanizeModelName(id) }
  if (info !== null && typeof info === 'object' && Array.isArray(info) === false) {
    const context = intOf(info.context_length, info.max_input_tokens, info.max_model_len)
    const output = intOf(info.max_output_tokens, info.max_tokens)
    if (context !== null) entry.contextWindow = context
    if (output !== null) entry.maxTokens = output
  }
  return entry
}

/** Formes acceptées : `{data: [{id, …}]}` (LiteLLM natif) ou `{models: {id: …}}`
 *  (variante enrichie). Rien d'autre = illisible. */
const parseCatalogIds = (body) => {
  if (body === null || typeof body !== 'object') return null
  if (Array.isArray(body.data) === true) {
    const infos = new Map()
    const ids = []
    for (const entry of body.data) {
      if (entry === null || typeof entry !== 'object' || typeof entry.id !== 'string') continue
      ids.push(entry.id)
      infos.set(entry.id, entry)
    }
    const kept = keepChatModels(ids)
    return kept.map((id) => modelEntry(id, infos.get(id)))
  }
  if (body.models !== null && typeof body.models === 'object' && Array.isArray(body.models) === false) {
    return keepChatModels(Object.keys(body.models)).map((id) => modelEntry(id, body.models[id]))
  }
  return null
}

const fetchCatalog = async (state) => {
  const res = await apiCall('/v1/models', { token: state.token })
  if (res.status === 401 || res.status === 403) return { ok: false, error: 'catalogue_refuse', status: res.status }
  if (res.status !== 200 || res.body === null) {
    return { ok: false, error: res.status === 0 ? 'reseau' : 'catalogue_indisponible', status: res.status }
  }
  const models = parseCatalogIds(res.body)
  if (models === null) return { ok: false, error: 'catalogue_illisible', status: res.status }
  return { ok: true, models }
}

/** La route provider écrite dans `llm-pi-ai.providers.kybernos`. apiKeyEnv est
 *  une RÉFÉRENCE : le jeton vit dans le store de credentials, pas ici. */
const providerValue = (state, entries) => ({
  displayName: PROVIDER_DISPLAY,
  api: 'openai-completions',
  baseURL: baseUrl(state),
  apiKeyEnv: CRED_REF,
  models: entries,
})

/** Déjà importé à l'identique ? (comparaison ids triés + formule + base) */
const catalogFingerprint = (state, entries, plan) => JSON.stringify([
  baseUrl(state),
  plan,
  entries.map((e) => e.id).slice().sort(),
])

/** Import (ou rafraîchissement) : catalogue → settings → credential → état.
 *  Ne throw jamais : chaque échec est un motif explicite dans la réponse. */
const importCatalog = async (cause, options = {}) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: true, connected: false, status: 'none' }
  const cat = await fetchCatalog(state)
  if (cat.ok !== true) {
    // Un 401 du catalogue ne déconnecte PAS (même leçon que /v1/me) : la
    // révocation reste décidée sur /v1/workspaces ; l'import précédent reste
    // en place (stale) jusqu'à ce verdict.
    return { ok: false, error: cat.error, status: cat.status, summary: publicModels(state.models) }
  }
  const plan = userPlan(state)
  // Déjà importé à l'identique → aucune écriture (pas de churn settings à
  // chaque refresh) ; la resynchronisation manuelle réécrit toujours.
  const known = state.models !== undefined && state.models !== null ? state.models : null
  if (options.force !== true && known !== null && known.provider === PROVIDER_ID
    && known.settings === true && known.credential === true
    && known.plan === plan && known.base_url === baseUrl(state)
    && Array.isArray(known.ids) === true
    && catalogFingerprint(state, known.ids.map((id) => ({ id })), plan) === catalogFingerprint(state, cat.models, plan)) {
    return { ok: true, connected: true, current: true, summary: publicModels(known) }
  }
  const settingsOut = await writeProviderRoute(state, cat.models)
  let credentialStored = false
  if (settingsOut.wrote === true) credentialStored = await storeCredential(state.token)
  const models = {
    imported_at: new Date().toISOString(),
    cause: typeof cause === 'string' ? cause : 'auto',
    plan,
    count: cat.models.length,
    ids: cat.models.map((e) => e.id),
    provider: PROVIDER_ID,
    base_url: baseUrl(state),
    settings: settingsOut.wrote === true,
    credential: credentialStored,
    reason: settingsOut.wrote === true ? null : (settingsOut.reason || 'settings_absent'),
  }
  writeState(Object.assign({}, state, { models }))
  return {
    ok: true,
    connected: true,
    current: false,
    wrote: settingsOut.wrote === true,
    reason: settingsOut.wrote === true ? null : (settingsOut.reason || 'settings_absent'),
    summary: publicModels(models),
  }
}

const writeProviderRoute = async (state, entries) => {
  const svc = service('settings')
  if (svc === null || typeof svc.mutate !== 'function') return { wrote: false, reason: 'settings_absent' }
  try {
    await svc.mutate('llm-pi-ai', [{ op: 'set', path: ['providers', PROVIDER_ID], value: providerValue(state, entries) }], undefined)
    return { wrote: true }
  } catch (e) {
    console.error('[kybernos-cloud] ecriture settings llm-pi-ai refusee : ' + String((e && e.message) || e))
    return { wrote: false, reason: 'settings_refuse' }
  }
}

const storeCredential = async (token) => {
  const cred = service('credentials')
  if (cred === null || typeof cred.set !== 'function') return false
  try { await cred.set(CRED_REF, token); return true } catch (e) {
    console.error('[kybernos-cloud] stockage credential ' + CRED_REF + ' refuse : ' + String((e && e.message) || e))
    return false
  }
}

/** Retire CE QUE CETTE FONCTIONNALITÉ a posé : la route `providers.kybernos`
 *  et le credential — jamais une route kybernos écrite à la main avant
 *  l'appairage (models.provider absent → no-op). */
const removeImportedCatalog = async (state) => {
  const imported = state !== null && state.models !== undefined && state.models !== null
    && state.models.provider === PROVIDER_ID
  if (imported !== true) return { removed: false }
  const out = { removed: true, settings: false, credential: false }
  const svc = service('settings')
  if (svc !== null && typeof svc.mutate === 'function') {
    try { await svc.mutate('llm-pi-ai', [{ op: 'unset', path: ['providers', PROVIDER_ID] }], undefined); out.settings = true } catch (e) {
      console.error('[kybernos-cloud] retrait providers.kybernos refuse : ' + String((e && e.message) || e))
    }
  }
  if (state.models.provider === PROVIDER_ID) {
    // Le credential est toujours le nôtre après un import (le set l'écrase à
    // chaque import réussi) : on le retire sans condition sur le DERNIER
    // résumé — un sync dégradé peut avoir laissé un credential d'un import
    // antérieur. Retirer une ref absente est un no-op.
    const cred = service('credentials')
    if (cred !== null && typeof cred.unset === 'function') {
      try { await cred.unset(CRED_REF); out.credential = true } catch (e) { /* resté, sans consommateur */ }
    }
  }
  return out
}

/** Vue publique de l'import : aucun jeton, aucun secret — que le fait. */
const publicModels = (models) => {
  if (models === undefined || models === null) return null
  return {
    provider: models.provider !== undefined ? models.provider : PROVIDER_ID,
    base_url: models.base_url !== undefined ? models.base_url : null,
    imported_at: models.imported_at !== undefined ? models.imported_at : null,
    plan: models.plan !== undefined ? models.plan : null,
    count: typeof models.count === 'number' ? models.count : 0,
    ids: Array.isArray(models.ids) ? models.ids.slice() : [],
    settings: models.settings === true,
    credential: models.credential === true,
    cause: models.cause !== undefined ? models.cause : null,
  }
}

/** Import au démarrage de DSH quand la session est déjà vivante : sans ça, un
 *  harnais relancé n'aurait les modèles qu'après une ouverture de carte. */
const autoImportAtBoot = (ctx) => {
  if (isConnected(readState()) !== true) return
  const kick = () => { void importCatalog('boot').catch(() => {}) }
  if (ctx.get('settings') !== undefined && ctx.get('credentials') !== undefined) kick()
  else ctx.inject(['settings', 'credentials'], kick)
}

const modelsRoute = async () => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: true, connected: false, status: 'none' }
  return { ok: true, connected: true, plan: userPlan(state), models: publicModels(state.models) }
}

/**
 * Le catalogue distant : ce que kybernos.app publie, tel quel.
 * Non lie -> motif explicite ; plateau injoignable -> motif avec le code HTTP.
 * On ne retombe JAMAIS sur une fixture locale en la faisant passer pour le
 * catalogue distant : c'est exactement le mensonge que ce module remplace.
 */
const marketplaceRoute = async () => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, items: [], motif: 'aucun compte lie a kybernos.app' }
  let res = null
  try {
    res = await apiCall('/v1/marketplace', { token: state.token })
  } catch (e) {
    return { ok: false, connected: true, items: [], motif: 'catalogue injoignable : ' + String(e !== null && e.message !== undefined ? e.message : e) }
  }
  if (res === null || res.status !== 200 || res.body === null) {
    return { ok: false, connected: true, items: [], motif: 'catalogue indisponible (code ' + String(res === null ? 'inconnu' : res.status) + ')' }
  }
  const cat = normaliserCatalogue(res.body)
  return Object.assign({ connected: true }, cat)
}

const modelsSyncRoute = async () => {
  const out = await importCatalog('manuel', { force: true })
  // Même contrat que poll/refresh : le résumé se lit dans `models`.
  return Object.assign({}, out, { models: out.summary !== undefined ? out.summary : null, summary: undefined })
}

/**
 * Le code de parrainage du compte lié (carte d'invitation du pied de sidebar).
 *
 * Pourquoi une route ici : le code vit dans `kybernos.profiles.referral_code`
 * (RLS « select own »), et le seul service qui le rendait — l'Edge Function
 * `kybernos-referral-info` — exige un JWT WEB. Le plugin n'a que le jeton
 * d'appareil `kys-…` : mesuré le 24/09/2026, la fonction répond 401
 * UNAUTHORIZED_INVALID_JWT_FORMAT. La route /v1/referral a été ajoutée au
 * proxy pour rendre la même vérité au compte DSH.
 *
 * Jamais de code inventé : `code` reste null tant que le serveur ne l'a pas
 * rendu — la carte retombe alors sur le collage manuel, elle ne ment pas.
 * Non lié → motif explicite ; plateau injoignable → motif + code HTTP.
 */
const referralRoute = async () => {
  const state = readState()
  if (isConnected(state) !== true) {
    return { ok: false, connected: false, code: null, share_url: null, motif: 'aucun compte lie a kybernos.app' }
  }
  let res = null
  try {
    res = await apiCall('/v1/referral', { token: state.token })
  } catch (e) {
    return { ok: false, connected: true, code: null, share_url: null, motif: 'parrainage injoignable : ' + String(e !== null && e.message !== undefined ? e.message : e) }
  }
  if (res === null || res.status !== 200 || res.body === null) {
    return { ok: false, connected: true, code: null, share_url: null, motif: 'parrainage indisponible (code ' + String(res === null ? 'inconnu' : res.status) + ')' }
  }
  const brut = res.body.code
  const code = typeof brut === 'string' && brut.trim() !== '' ? brut.trim() : null
  const lien = res.body.share_url
  const brutLien = typeof lien === 'string' && lien.trim() !== '' ? lien.trim() : null
  // Pas de code → pas de lien : un share_url sans code mene a /r/ vide. Le
  // serveur ne le produit pas (il ne construit le lien qu'avec un code), mais
  // le plugin ne relaie jamais un lien mort.
  const share = code === null ? null : brutLien
  // `ok: true` même sans code : le compte répond, il n'a simplement pas encore
  // de code — la carte doit pouvoir dire ça au lieu de demander un collage.
  return { ok: true, connected: true, code: code, share_url: share, motif: code === null ? 'ce compte n a pas encore de code de parrainage' : null }
}

// ── Routes ──────────────────────────────────────────────────────────────────

const sendJson = (res, status, payload) => {
  try {
    const body = JSON.stringify(payload === undefined ? null : payload)
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(body)
  } catch (e) {
    try { res.writeHead(500); res.end('{}') } catch (e2) { /* socket ferme */ }
  }
}

/** Corps JSON d'une requête locale (borné) : `{}` si absent ou illisible. */
const readJsonBody = async (req, cap) => {
  const max = typeof cap === 'number' ? cap : 65536
  try {
    let size = 0
    const chunks = []
    for await (const chunk of req) {
      size += chunk.length
      if (size > max) return {}
      chunks.push(chunk)
    }
    const text = Buffer.concat(chunks).toString('utf8')
    if (text.length === 0) return {}
    const parsed = JSON.parse(text)
    return (parsed !== null && typeof parsed === 'object') ? parsed : {}
  } catch (e) { return {} }
}

/** Même garde que les autres routes locales : jamais cross-origin. */
const sameOrigin = (req) => {
  try {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : null
    const host = typeof req.headers.host === 'string' ? req.headers.host : null
    if (origin === null || host === null) return true
    return new URL(origin).host === host
  } catch (e) {
    return false
  }
}

// ── Artefacts (phase A) ─────────────────────────────────────────────────────
// Le livrable du chat local part vers `kybernos.artifacts` par `/v1/artifacts`
// (l'app calcule le sha256, résout l'objectif implicite, uploade dans le bucket
// privé). Ici on ne fait que porter le jeton : le client n'y touche jamais.
// Contenu borné côté plugin (le corps local est borné à 64 Kio par défaut) ;
// l'app refuse au-delà de 8 Mio.
const ARTIFACT_CONTENT_MAX = 4 * 1024 * 1024

const artifactError = (res, fallback) => {
  const detail = res && res.body && typeof res.body.error === 'string' ? res.body.error : null
  return detail !== null ? detail : (res && res.error ? res.error : fallback)
}

const artifactPush = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, status: 'none', error: 'non connecte' }
  const text = (v) => (typeof v === 'string' ? v.trim() : '')
  const deliverableType = text(body.deliverable_type)
  const filename = text(body.filename)
  const title = text(body.title)
  const contentB64 = typeof body.content_b64 === 'string' ? body.content_b64 : ''
  if (contentB64 === '') return { ok: false, error: 'content_b64 requis' }
  if (title === '' && filename === '') return { ok: false, error: 'title ou filename requis' }
  if (contentB64.length > ARTIFACT_CONTENT_MAX) {
    return { ok: false, error: 'contenu trop gros (max ' + ARTIFACT_CONTENT_MAX + ' octets)' }
  }
  const payload = { content_b64: contentB64 }
  if (deliverableType !== '') payload.deliverable_type = deliverableType
  if (filename !== '') payload.filename = filename
  if (title !== '') payload.title = title
  if (text(body.mime) !== '') payload.mime = text(body.mime)
  if (text(body.kind) !== '') payload.kind = text(body.kind)
  const push = {}
  for (const key of ['session_id', 'run_id', 'workspace_id']) {
    if (text(body[key]) !== '') push[key] = text(body[key])
  }
  if (Object.keys(push).length > 0) payload.push = push
  const res = await apiCall('/v1/artifacts', { method: 'POST', token: state.token, body: payload })
  if (res.status !== 200 && res.status !== 201) {
    return { ok: false, status: res.status, error: artifactError(res, 'poussee refusee') }
  }
  const out = res.body !== null && typeof res.body === 'object' ? res.body : {}
  return { ok: true, created: out.created === true, artifact: out.artifact, status: res.status }
}


// ── Partage (core.shares) ────────────────────────────────────────────
// Trois chemins DISTINCTS : le routeur indexe par chemin, deux routes sur
// `/shares` se masqueraient l'une l'autre (constaté sur `/memory`).
// L'audience est dérivée côté serveur (only_me | link | password) ; le mot de
// passe n'est rendu qu'UNE fois, par l'appel qui le pose ou le tourne.
const shareError = (res, fallback) => {
  const detail = res && res.body && typeof res.body.error === 'string' ? res.body.error : null
  return detail !== null ? detail : (res && res.error ? res.error : fallback)
}

// ── Chats DSH → webapp (annuaire de sessions) ────────────────────────────────
// Pousse la LISTE des sessions locales (~/.dsh/sessions) vers
// POST /v1/dsh/sessions — MÉTADONNÉES SEULEMENT (id de session, projet, date,
// rien du contenu des conversations : les .jsonl.zstd ne sont jamais ouverts).
// La webapp lit la même liste (GET /v1/dsh/sessions) pour afficher
// « Conversations DSH ». Idempotent : le serveur upsert par (user, dsh_id).
const SESSIONS_HOME = join(homedir(), '.dsh', 'sessions')
const CHATS_PUSH_MAX = 100

const projetDuSlug = (slug) => {
  // « --Users-miled-dyad-apps-kybernos-- » → « kybernos » ; « ~0020 » = espace.
  const segments = String(slug || '').split('-').filter((s) => s !== '')
  const dernier = segments.length > 0 ? segments[segments.length - 1] : ''
  return dernier.split('~').join(' ').trim()
}

const chatsScan = () => {
  const items = []
  let slugs = []
  try {
    slugs = readdirSync(SESSIONS_HOME)
  } catch (e) {
    return { items, error: 'sessions illisibles' }
  }
  // Titres réels des sessions renommées (~/.dsh/kybernos/categories.json,
  // tenu par le plugin kybernos-sessions) — repli : nom du projet du slug.
  let titres = {}
  try {
    titres = JSON.parse(readFileSync(join(homedir(), '.dsh', 'kybernos', 'categories.json'), 'utf8')) || {}
  } catch (e) { /* pas de renommages : projet du slug pour tous */ }
  const titreDe = (sessionId, projet) => {
    const t = titres[sessionId] && typeof titres[sessionId].titre === 'string' ? titres[sessionId].titre.trim() : ''
    return t !== '' ? t : (projet !== '' ? projet : 'Session DSH')
  }
  for (const slug of slugs) {
    let sessionDirs = []
    try {
      sessionDirs = readdirSync(join(SESSIONS_HOME, slug))
    } catch (e) {
      continue
    }
    for (const dir of sessionDirs) {
      if (!dir.startsWith('session-')) continue
      const dossier = join(SESSIONS_HOME, slug, dir)
      let dernierMtimeMs = 0
      try {
        for (const f of readdirSync(dossier)) {
          if (!f.endsWith('.zstd')) continue
          const st = statSync(join(dossier, f))
          if (st.mtimeMs > dernierMtimeMs) dernierMtimeMs = st.mtimeMs
        }
      } catch (e) { /* session illisible : on la saute */ }
      if (dernierMtimeMs === 0) continue
      const projet = projetDuSlug(slug)
      items.push({
        dsh_id: dir,
        title: titreDe(dir, projet),
        kyber_name: '',
        preview: '',
        last_active: new Date(dernierMtimeMs).toISOString(),
      })
    }
  }
  items.sort((a, b) => (a.last_active < b.last_active ? 1 : -1))
  return { items: items.slice(0, CHATS_PUSH_MAX) }
}

const chatsPushRoute = async () => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  const { items, error } = chatsScan()
  if (error !== undefined) return { ok: false, error }
  if (items.length === 0) return { ok: false, error: 'aucune session locale trouvee' }
  const res = await apiCall('/v1/dsh/sessions', {
    method: 'POST',
    token: state.token,
    body: { sessions: items },
  })
  const ok = res.status === 200 || res.status === 201
  const detail = res && res.body && typeof res.body.error === 'string' ? res.body.error : null
  const out = {
    ok,
    scanned: items.length,
    pushed: ok && res.body && typeof res.body.pushed === 'number' ? res.body.pushed : 0,
    status: res.status,
    error: ok ? null : (detail !== null ? detail : (res.error || 'poussee refusee')),
  }
  if (ok || res.status >= 400) {
    try {
      const fresh = readState()
      fresh.chats_last_push = { at: new Date().toISOString(), ok, scanned: out.scanned, pushed: out.pushed, error: out.error }
      writeState(fresh)
    } catch (e) { /* l'état ne bloque jamais le résultat */ }
  }
  return out
}

const chatsStatusRoute = async () => {
  const state = readState()
  return {
    ok: true,
    connected: isConnected(state),
    last_push: state && state.chats_last_push ? state.chats_last_push : null,
  }
}

// Matérialise un chat local (DSH) en `kybernos.chat_sessions` : un chat de DSH
// n'a aucun pendant hébergé, il faut le créer avant de pouvoir le partager. Le
// transcript est REMPLACÉ, jamais concaténé (repousser le même fil ne duplique
// pas les bulles), et `external_ref` rend l'appel idempotent : deux partages du
// même fil retombent sur la même session.
const chatEnsure = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, status: 'none', error: 'non connecte' }
  const ref = typeof body.external_ref === 'string' ? body.external_ref.trim() : ''
  if (ref === '') return { ok: false, error: 'external_ref requis' }
  const payload = { external_ref: ref }
  const titre = typeof body.title === 'string' ? body.title.trim() : ''
  if (titre !== '') payload.title = titre
  if (Array.isArray(body.messages)) {
    payload.messages = body.messages.filter((m) => m !== null && typeof m === 'object').slice(0, 500)
  }
  const res = await apiCall('/v1/chats', { method: 'POST', token: state.token, body: payload })
  if (res.status !== 200 && res.status !== 201) {
    return { ok: false, status: res.status, error: shareError(res, 'materialisation refusee') }
  }
  const out = res.body !== null && typeof res.body === 'object' ? res.body : {}
  return {
    ok: true,
    id: typeof out.id === 'string' ? out.id : null,
    title: typeof out.title === 'string' ? out.title : '',
    created: out.created === true,
    messages: typeof out.messages === 'number' ? out.messages : 0,
    status: res.status,
  }
}

const shareGet = async (req) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, status: 'none', error: 'non connecte' }
  let q = ''
  try {
    const p = new URL(req.url, 'http://localhost').searchParams
    const rt = (p.get('resource_type') || '').trim()
    const rid = (p.get('resource_id') || '').trim()
    if (rt === '' || rid === '') return { ok: false, error: 'resource_type et resource_id requis' }
    q = '?resource_type=' + encodeURIComponent(rt) + '&resource_id=' + encodeURIComponent(rid)
  } catch (e) { return { ok: false, error: 'URL illisible' } }
  const res = await apiCall('/v1/shares' + q, { token: state.token })
  if (res.status !== 200) return { ok: false, status: res.status, error: shareError(res, 'lecture refusee') }
  const out = res.body !== null && typeof res.body === 'object' ? res.body : {}
  return { ok: true, share: out.share === undefined ? null : out.share, status: 200 }
}

const shareSet = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, status: 'none', error: 'non connecte' }
  const payload = {}
  for (const k of ['resource_type', 'resource_id', 'audience', 'password', 'expires_in']) {
    const v = typeof body[k] === 'string' ? body[k].trim() : ''
    if (v !== '') payload[k] = v
  }
  if (payload.resource_type === undefined || payload.resource_id === undefined) {
    return { ok: false, error: 'resource_type et resource_id requis' }
  }
  const res = await apiCall('/v1/shares', { method: 'POST', token: state.token, body: payload })
  if (res.status !== 200 && res.status !== 201) {
    return { ok: false, status: res.status, error: shareError(res, 'ecriture refusee') }
  }
  const out = res.body !== null && typeof res.body === 'object' ? res.body : {}
  return { ok: true, share: out.share === undefined ? null : out.share, status: res.status }
}

const shareRevoke = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, status: 'none', error: 'non connecte' }
  const payload = {}
  for (const k of ['resource_type', 'resource_id']) {
    const v = typeof body[k] === 'string' ? body[k].trim() : ''
    if (v !== '') payload[k] = v
  }
  if (payload.resource_type === undefined || payload.resource_id === undefined) {
    return { ok: false, error: 'resource_type et resource_id requis' }
  }
  const res = await apiCall('/v1/shares/revoke', { method: 'POST', token: state.token, body: payload })
  if (res.status !== 200) return { ok: false, status: res.status, error: shareError(res, 'revocation refusee') }
  const out = res.body !== null && typeof res.body === 'object' ? res.body : {}
  return { ok: true, count: typeof out.count === 'number' ? out.count : 0, status: 200 }
}

// ── Membres d'un espace (fiche « Partager ») ─────────────────────────────────
// Lecture : GET /v1/workspaces/:id/members (clé membre acceptée). Écriture
// (invitation, retrait) : le serveur ne l'ouvre aujourd'hui qu'à la master key
// (l'EF kybernos-workspace-invite l'appelle avec requesting_user_id) — une clé
// utilisateur reçoit 403/404/405/501. Ces cas rendent `{ok:false,
// error:'indisponible'}` : la fiche l'affiche tel quel, sans faux succès.
const MEMBER_ROLES = ['owner', 'admin', 'member']
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Espace visé : celui demandé s'il existe dans le compte, sinon l'actif. */
const memberSpace = (state, wanted) => {
  const espaces = Array.isArray(state.workspaces) ? state.workspaces : []
  const w = typeof wanted === 'string' ? wanted.trim() : ''
  if (w !== '' && espaces.some((e) => e !== null && e.id === w)) return w
  return espaceActif(state)
}

const memberUnavailable = (res) => {
  const detail = res && res.body && typeof res.body.error === 'string' ? res.body.error : ''
  if (res.status === 404 || res.status === 405 || res.status === 501) return true
  return res.status === 403 && /master/i.test(detail)
}

const membersGet = async (req) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, status: 'none', error: 'non connecte' }
  let wanted = ''
  try { wanted = new URL(req.url, 'http://localhost').searchParams.get('workspace_id') || '' } catch (e) { /* defaut */ }
  const wid = memberSpace(state, wanted)
  if (wid === null) return { ok: false, error: 'espace_absent' }
  const res = await apiCall('/v1/workspaces/' + encodeURIComponent(wid) + '/members', { token: state.token })
  if (memberUnavailable(res)) return { ok: false, error: 'indisponible', status: res.status }
  if (res.status !== 200) return { ok: false, status: res.status, error: shareError(res, 'lecture refusee') }
  const out = res.body !== null && typeof res.body === 'object' ? res.body : {}
  const members = (Array.isArray(out.members) ? out.members : [])
    .filter((m) => m !== null && typeof m === 'object' && typeof m.user_id === 'string')
    .map((m) => ({ user_id: m.user_id, role: MEMBER_ROLES.indexOf(m.role) !== -1 ? m.role : 'member', status: typeof m.status === 'string' ? m.status : 'active', created_at: typeof m.created_at === 'string' ? m.created_at : null }))
  return { ok: true, workspace_id: wid, members, status: 200 }
}

const membersInvite = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, status: 'none', error: 'non connecte' }
  const wid = memberSpace(state, body.workspace_id)
  if (wid === null) return { ok: false, error: 'espace_absent' }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const userId = typeof body.user_id === 'string' ? body.user_id.trim() : ''
  if (email === '' && userId === '') return { ok: false, error: 'email requis' }
  if (email !== '' && EMAIL_RE.test(email) !== true) return { ok: false, error: 'email invalide' }
  if (userId !== '' && UUID_RE.test(userId) !== true) return { ok: false, error: 'user_id invalide' }
  // Contrat de l'EF : admin | member — jamais owner depuis ici.
  const role = body.role === 'admin' ? 'admin' : (body.role === 'member' ? 'member' : '')
  if (role === '') return { ok: false, error: 'role invalide (admin|member)' }
  const payload = { role }
  if (email !== '') payload.email = email
  else payload.user_id = userId
  const res = await apiCall('/v1/workspaces/' + encodeURIComponent(wid) + '/members', { method: 'POST', token: state.token, body: payload })
  if (memberUnavailable(res)) return { ok: false, error: 'indisponible', status: res.status }
  if (res.status !== 200 && res.status !== 201) return { ok: false, status: res.status, error: shareError(res, 'invitation refusee') }
  return { ok: true, status: res.status }
}

const membersRemove = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, status: 'none', error: 'non connecte' }
  const wid = memberSpace(state, body.workspace_id)
  if (wid === null) return { ok: false, error: 'espace_absent' }
  const userId = typeof body.user_id === 'string' ? body.user_id.trim() : ''
  if (UUID_RE.test(userId) !== true) return { ok: false, error: 'user_id invalide' }
  const res = await apiCall('/v1/workspaces/' + encodeURIComponent(wid) + '/members', { method: 'DELETE', token: state.token, body: { user_id: userId } })
  if (memberUnavailable(res)) return { ok: false, error: 'indisponible', status: res.status }
  if (res.status !== 200) return { ok: false, status: res.status, error: shareError(res, 'retrait refuse') }
  return { ok: true, status: 200 }
}

const artifactList = async (req) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, status: 'none', error: 'non connecte' }
  let limit = 50
  try {
    const raw = new URL(req.url, 'http://localhost').searchParams.get('limit')
    if (raw !== null) limit = Math.max(1, Math.min(200, parseInt(raw, 10) || 50))
  } catch (e) { /* URL illisible → defaut */ }
  const res = await apiCall('/v1/artifacts?limit=' + limit, { token: state.token })
  if (res.status !== 200) {
    return { ok: false, status: res.status, error: artifactError(res, 'lecture refusee') }
  }
  const out = res.body !== null && typeof res.body === 'object' ? res.body : {}
  return { ok: true, artifacts: Array.isArray(out.artifacts) ? out.artifacts : [], count: out.count, status: 200 }
}

const artifactDetail = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, status: 'none', error: 'non connecte' }
  const id = typeof body.id === 'string' ? body.id.trim() : ''
  if (id === '') return { ok: false, error: 'id requis' }
  const res = await apiCall('/v1/artifacts/' + encodeURIComponent(id), { token: state.token })
  if (res.status !== 200) {
    return { ok: false, status: res.status, error: artifactError(res, 'artefact introuvable') }
  }
  const out = res.body !== null && typeof res.body === 'object' ? res.body : {}
  return { ok: true, artifact: out.artifact, status: 200 }
}

// ── Fonctionnalité cloud n°2 : la mémoire du compte ─────────────────────────
//
// Le serveur Kybernos porte déjà tout le modèle (migration 003) : une table
// `kybernos.memories` à deux portées (account | kyber), quatre genres
// (fact|preference|event|policy), une source obligatoire, un épinglage et une
// rétention (180 jours par défaut, jamais expiré si `pinned`). Contrat relevé
// sur l'API le 22/09/2026 : POST → 201 + l'objet, GET → {memories:[…]},
// DELETE → 200 ; tout en snake_case.
//
// Ce half ne fait que trois choses :
//   1. lire/écrire ces souvenirs avec le jeton du compte ;
//   2. les réinjecter dans le prompt à chaque assemblage, dans l'ordre
//      déterministe que la spec impose (pinned DESC, created_at ASC, id ASC) —
//      un ordre instable casse le prompt caching du proxy ;
//   3. laisser le modèle écrire (`memory_write`), chercher (`memory_search`) et
//      retenir ce qui vient d'être enseigné, en fin de tour.
//
// Invariants :
//   - hors connexion, rien n'existe : chunk vide, outils qui refusent, aucune
//     requête réseau, et surtout pas un cache laissé par le compte précédent ;
//   - le contenu est neutralisé avant d'entrer dans le prompt : un souvenir ne
//     peut pas fabriquer une ligne de chunk (même règle que `_sanitize` côté
//     serveur) ;
//   - l'injection est SYNCHRONE : `systemPrompt.context` appelle son texte à
//     chaque assemblage, donc il lit un cache — jamais le réseau ;
//   - toute erreur est fail-open : pas de chunk, le tour continue.

const MEMORY_KINDS = ['fact', 'preference', 'event', 'policy']
const MEMORY_SOURCES = ['conversation', 'call', 'correction', 'taught', 'admin']
const MEMORY_MAX_CONTENT = 2000
const MEMORY_CACHE_MS = 60000
const MEMORY_MAX_INJECT_CHARS = 6000
const MEMORY_INJECT_ORDER = 130
const MEMORY_PUSH_MAX = 40
const CAPTURE_MAX_TOKENS = 300
const CAPTURE_MIN_CHARS = 60
// Part du budget d'injection réservée aux souvenirs épinglés, et part laissée
// à la mémoire des kybers reliés quand il y en a : sans ces plafonds, un seul
// groupe peut affamer tous les autres (constaté : 47 épinglés = tout le budget,
// donc aucun des 543 souvenirs captés n'arrivait jamais au modèle).
const MEMORY_PINNED_SHARE = 0.6
const MEMORY_KYBER_SHARE = 0.3
// Le CADRE du chunk (en-tête, ligne « autres souvenirs », consigne finale) compte dans
// le plafond : MEMORY_MAX_INJECT_CHARS borne le texte injecté en entier, pas seulement
// les lignes de souvenirs (mesuré : l'ancien rendu dépassait 6 000 de plus de 130).
const MEMORY_FRAME_CHARS = 450
const MEMORY_KYBER_FRAME_CHARS = 120
// Réglages de rafraîchissement, exportés pour que la suite host puisse les
// couper (un minuteur qui tire sur un faux serveur pendant un test le fausse).
const MEMORY_TUNING = { writeRefreshMs: 400, tickMs: 30000 }

// ── Fichiers voisins de l'état ──────────────────────────────────────────────
// Réglages et origines vivent À CÔTÉ du fichier d'état (même dossier, mêmes
// permissions) mais PAS dedans : le fichier d'état disparaît à la déconnexion
// (clearState), alors qu'un interrupteur « Mémoire : non » doit survivre à une
// reconnexion — et qu'on doit pouvoir le poser hors connexion.
const sideFile = (suffix) => stateFile().replace(/\.json$/, '') + '-' + suffix + '.json'

const readSide = (suffix, fallback) => {
  try {
    const parsed = JSON.parse(readFileSync(sideFile(suffix), 'utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : fallback
  } catch (e) {
    return fallback
  }
}

const writeSide = (suffix, value) => {
  const file = sideFile(suffix)
  try { mkdirSync(dirname(file), { recursive: true, mode: 0o700 }) } catch (e) { /* deja la */ }
  writeFileSync(file, JSON.stringify(value) + '\n', { mode: 0o600 })
  try { chmodSync(file, 0o600) } catch (e) { /* FS exotique (Windows) */ }
}

/**
 * Interrupteurs de la page « Memory & Lessons learned ». Tous vrais par défaut :
 * c'est le comportement d'avant l'existence des réglages, donc rien ne change
 * pour qui ne les touche pas. Lus à chaque assemblage de prompt (fichier minuscule,
 * lecture synchrone) — pas de cache à invalider quand un autre processus écrit.
 */
const MEMORY_SETTING_KEYS = ['memories', 'context', 'capture', 'meaning']
// `meaning` (search by meaning) is OFF until the user turns it on: it sends the text of a memory to the
// embedding model of the Kybernos cloud, which nothing else in this plugin does outside a chat turn.
const MEMORY_SETTING_DEFAULTS = { memories: true, context: true, capture: true, meaning: false }
const readMemorySettings = () => {
  const raw = readSide('memory', {})
  const out = {}
  for (const key of MEMORY_SETTING_KEYS) out[key] = typeof raw[key] === 'boolean' ? raw[key] : MEMORY_SETTING_DEFAULTS[key]
  return out
}

/**
 * Origine d'un souvenir : le serveur ne distingue que `source` (conversation,
 * taught…), et la capture automatique, l'outil d'un agent et la poussée de
 * leçons écrivent TOUS `conversation` — indiscernables côté compte. Le plugin
 * note donc localement qui a écrit quoi ; ce qui n'a pas été écrit d'ici est
 * déduit de `source` et marqué « non connu » (`originKnown: false`).
 */
const MEMORY_ORIGINS = ['capture', 'agent', 'taught', 'sync']
const MEMORY_ORIGINS_MAX = 5000

const noteOrigins = (ids, origin) => {
  if (MEMORY_ORIGINS.indexOf(origin) < 0) return
  try {
    const map = readSide('memory-origins', {})
    for (const id of ids) map[String(id)] = origin
    const keys = Object.keys(map)
    // Les ids sont croissants : au-delà du plafond on oublie les plus anciens.
    if (keys.length > MEMORY_ORIGINS_MAX) {
      keys.sort((a, b) => Number(a) - Number(b)).slice(0, keys.length - MEMORY_ORIGINS_MAX).forEach((k) => { delete map[k] })
    }
    writeSide('memory-origins', map)
  } catch (e) { /* le journal d'origine est un confort : jamais bloquant */ }
}

const originOf = (m, ledger) => {
  const known = ledger[String(m.id)]
  if (MEMORY_ORIGINS.indexOf(known) >= 0) return { origin: known, originKnown: true }
  const derived = (m.source === 'taught' || m.source === 'correction' || m.source === 'admin') ? 'taught' : m.source === 'call' ? 'agent' : 'capture'
  return { origin: derived, originKnown: false }
}

/** Cache d'injection : lu par le prompt (synchrone), rempli par le réseau. */
const memoryCache = { at: 0, account: [], kyber: {}, error: null }

const emptyMemoryCache = () => {
  memoryCache.at = 0
  memoryCache.account = []
  memoryCache.kyber = {}
  memoryCache.error = null
}

/** Marque le cache périmé ; `scheduleMemoryRefresh` le recharge juste après. */
const bumpMemoryCache = () => {
  memoryCache.at = 0
}

// Un assemblage de prompt ne lit QUE le cache (jamais le réseau). Sans rechargement
// programmé, un souvenir écrit — par l'outil, la capture ou la carte — restait
// absent du prompt jusqu'au prochain redémarrage : le TTL ne servait à rien
// parce que tous les appelants forçaient. Une écriture déclenche donc un
// rechargement court (regroupé), et un minuteur rafraîchit le cache périmé.
let memoryRefreshTimer = null
const scheduleMemoryRefresh = () => {
  if (memoryRefreshTimer !== null || MEMORY_TUNING.writeRefreshMs < 0) return
  memoryRefreshTimer = setTimeout(() => {
    memoryRefreshTimer = null
    void refreshMemoryCache(readState(), false)
  }, MEMORY_TUNING.writeRefreshMs)
  if (typeof memoryRefreshTimer.unref === 'function') memoryRefreshTimer.unref()
}

const afterMemoryWrite = () => {
  bumpMemoryCache()
  scheduleMemoryRefresh()
}

const asMemory = (m) => ({
  id: m.id,
  scope: m.scope,
  kyberId: m.kyber_id === undefined ? null : m.kyber_id,
  kind: m.kind,
  content: m.content,
  source: m.source,
  pinned: m.pinned === true,
  retentionDays: m.retention_days === undefined ? null : m.retention_days,
  expiresAt: m.expires_at === undefined ? null : m.expires_at,
  createdAt: m.created_at === undefined ? null : m.created_at,
})

const memoryFailure = (res) => {
  if (res.status === 401) return 'reconnexion_requise'
  if (res.status === 0) return 'reseau'
  if (res.status >= 400) return 'refus_' + String(res.status)
  return null
}

const listMemories = async (state, scope, kyberId) => {
  let path = '/v1/memories?scope=' + encodeURIComponent(scope)
  if (scope === 'kyber' && typeof kyberId === 'string' && kyberId !== '') path += '&kyber_id=' + encodeURIComponent(kyberId)
  const res = await apiCall(path, { token: state.token })
  const failure = memoryFailure(res)
  if (failure !== null) return { ok: false, error: failure, items: [] }
  const raw = res.body !== null && Array.isArray(res.body.memories) ? res.body.memories : []
  return { ok: true, error: null, items: raw.map(asMemory) }
}

/**
 * Valide un souvenir avant de l'envoyer. Fail-closed comme le serveur : un
 * genre hors énumération est refusé, jamais rabattu sur `fact`.
 */
const validateMemory = (body) => {
  const content = typeof body.content === 'string' ? body.content.trim() : ''
  if (content === '') return { error: 'contenu_vide' }
  if (content.length > MEMORY_MAX_CONTENT) return { error: 'contenu_trop_long' }
  if (MEMORY_KINDS.indexOf(body.kind) < 0) return { error: 'genre_invalide' }
  const source = MEMORY_SOURCES.indexOf(body.source) >= 0 ? body.source : 'conversation'
  const scope = body.scope === 'kyber' ? 'kyber' : 'account'
  const pinned = body.pinned === true
  let retention = 180
  if (body.retentionDays !== undefined && body.retentionDays !== null) {
    const n = parseInt(body.retentionDays, 10)
    if (!Number.isFinite(n) || n < 0) return { error: 'retention_invalide' }
    retention = n
  }
  const payload = { scope, kind: body.kind, content, source, pinned, retention_days: retention }
  if (scope === 'kyber') {
    const cloud = typeof body.kyberId === 'string' ? body.kyberId : ''
    if (cloud === '') return { error: 'kyber_requis' }
    payload.kyber_id = cloud
  }
  return { error: null, payload }
}

const createMemory = async (state, body, origin) => {
  const checked = validateMemory(body)
  if (checked.error !== null) return { ok: false, error: checked.error }
  const res = await apiCall('/v1/memories', { method: 'POST', token: state.token, body: checked.payload })
  const failure = memoryFailure(res)
  if (failure !== null) return { ok: false, error: failure, status: res.status }
  afterMemoryWrite()
  const memory = res.body !== null && typeof res.body === 'object' ? asMemory(res.body) : null
  if (memory !== null && origin !== undefined) noteOrigins([memory.id], origin)
  indexOneInBackground(state, memory)
  return { ok: true, memory }
}

const patchMemory = async (state, body) => {
  const id = body.id === undefined || body.id === null ? '' : String(body.id)
  if (id === '') return { ok: false, error: 'id_manquant' }
  const sets = {}
  if (typeof body.content === 'string') {
    const content = body.content.trim()
    if (content === '' || content.length > MEMORY_MAX_CONTENT) return { ok: false, error: 'contenu_invalide' }
    sets.content = content
  }
  if (typeof body.pinned === 'boolean') sets.pinned = body.pinned
  if (body.retentionDays !== undefined && body.retentionDays !== null) {
    const n = parseInt(body.retentionDays, 10)
    if (!Number.isFinite(n) || n < 0) return { ok: false, error: 'retention_invalide' }
    sets.retention_days = n
  }
  if (Object.keys(sets).length === 0) return { ok: false, error: 'rien_a_modifier' }
  const res = await apiCall('/v1/memories/' + encodeURIComponent(id), { method: 'PATCH', token: state.token, body: sets })
  const failure = memoryFailure(res)
  if (failure !== null) return { ok: false, error: failure, status: res.status }
  afterMemoryWrite()
  const patched = res.body !== null && typeof res.body === 'object' ? asMemory(res.body) : null
  // The server drops the vector of a memory whose text changed: give it a new one.
  if (sets.content !== undefined) indexOneInBackground(state, patched)
  return { ok: true, memory: patched }
}

const deleteMemory = async (state, body) => {
  const id = body.id === undefined || body.id === null ? '' : String(body.id)
  if (id === '') return { ok: false, error: 'id_manquant' }
  const res = await apiCall('/v1/memories/' + encodeURIComponent(id), { method: 'DELETE', token: state.token })
  const failure = memoryFailure(res)
  if (failure !== null) return { ok: false, error: failure, status: res.status }
  afterMemoryWrite()
  return { ok: true }
}

const searchMemories = async (state, q) => {
  const needle = typeof q === 'string' ? q.trim() : ''
  if (needle === '') return { ok: false, error: 'requete_vide', items: [] }
  const res = await apiCall('/v1/memories/search?q=' + encodeURIComponent(needle), { token: state.token })
  const failure = memoryFailure(res)
  if (failure !== null) return { ok: false, error: failure, items: [] }
  const raw = res.body !== null && Array.isArray(res.body.memories) ? res.body.memories : []
  return { ok: true, error: null, items: raw.map(asMemory) }
}

// ── Correspondance kybers locaux ↔ kybers cloud ─────────────────────────────
// Les identifiants n'ont rien à voir : chez moi `default`, `dev-team`… ; côté
// cloud `kg52d53f4ce522`, `kga9ad6e`. Aucune correspondance automatique n'est
// fiable, donc elle est EXPLICITE et inspectable (`state.kyberMap`). Sans
// entrée, une leçon n'est pas poussée — on n'écrit jamais dans le kyber d'un
// autre au hasard.

const stateKyberMap = (state) => (state !== null && typeof state.kyberMap === 'object' && state.kyberMap !== null ? state.kyberMap : {})

const localKybers = () => {
  try {
    return readdirSync(kybersDir(), { withFileTypes: true })
      // Les entrées cachées (`.git`, `.active`, `.kyber-avatars`) ne sont pas
      // des kybers : les proposer dans la correspondance serait un faux choix.
      .filter((entry) => entry.isDirectory() === true && entry.name.startsWith('.') !== true)
      .map((entry) => entry.name)
      .sort()
  } catch (e) {
    return []
  }
}

/** Racine des kybers locaux : surchargeable pour que la suite host soit déterministe. */
const kybersDir = () => (typeof process.env.KYBERNOS_CLOUD_KYBERS === 'string' && process.env.KYBERNOS_CLOUD_KYBERS !== '' ? process.env.KYBERNOS_CLOUD_KYBERS : join(homedir(), '.dsh', 'kybers'))

const readJsonl = (path) => {
  try {
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => {
        try { return JSON.parse(line) } catch (e) { return null }
      })
      .filter((row) => row !== null)
  } catch (e) {
    return []
  }
}

const localLessons = (kyber) => readJsonl(join(kybersDir(), kyber, 'memory', 'lessons.jsonl'))

const listCloudKybers = async (state) => {
  const spaces = Array.isArray(state.workspaces) ? state.workspaces : []
  const out = []
  for (const ws of spaces) {
    if (ws === null || typeof ws.id !== 'string') continue
    const res = await apiCall('/v1/memories/kybers?workspace_id=' + encodeURIComponent(ws.id), { token: state.token })
    if (res.status !== 200 || res.body === null || Array.isArray(res.body.kybers) === false) continue
    for (const k of res.body.kybers) {
      out.push({
        id: k.id,
        name: k.name,
        glyph: k.glyph === undefined ? null : k.glyph,
        color: k.color === undefined ? null : k.color,
        workspaceId: ws.id,
        workspaceName: ws.name === undefined ? null : ws.name,
        memoryCount: k.memory_count === undefined ? 0 : k.memory_count,
      })
    }
  }
  return out
}

/**
 * Pousse les leçons d'un kyber local vers son kyber cloud (scope=kyber).
 * Déduplication avant écriture (la spec serveur la liste en suite, on la fait
 * ici) : un souvenir de contenu identique n'est jamais réécrit.
 */
const pushLessons = async (state, options = {}) => {
  const map = stateKyberMap(state)
  const dry = options.dryRun === true
  const report = []
  for (const local of Object.keys(map)) {
    const cloud = map[local]
    if (typeof cloud !== 'string' || cloud === '') continue
    const lessons = localLessons(local)
    const row = { local, cloud, lessons: lessons.length, added: 0, skipped: 0, error: null }
    if (lessons.length === 0) { report.push(row); continue }
    const existing = await listMemories(state, 'kyber', cloud)
    if (existing.ok !== true) { row.error = existing.error; report.push(row); continue }
    const known = new Set(existing.items.map((m) => String(m.content).trim()))
    // Les plus récentes d'abord : si le plafond coupe, il coupe le vieux.
    const ordered = lessons.slice().reverse().slice(0, MEMORY_PUSH_MAX)
    for (const lesson of ordered) {
      const text = typeof lesson.text === 'string' ? lesson.text.trim() : ''
      if (text === '') continue
      if (known.has(text) === true) { row.skipped = row.skipped + 1; continue }
      if (dry === true) { row.added = row.added + 1; continue }
      const made = await createMemory(state, { scope: 'kyber', kyberId: cloud, kind: 'policy', content: text, source: 'conversation' }, 'sync')
      if (made.ok === true) row.added = row.added + 1
      else { row.error = made.error; break }
    }
    report.push(row)
  }
  return { ok: true, dryRun: dry, report }
}

// ── Injection dans le prompt ────────────────────────────────────────────────

/**
 * Neutralise le contenu d'un souvenir avant de le mettre dans le prompt : un
 * utilisateur ne doit pas pouvoir écrire une fausse ligne de chunk en
 * enregistrant « [KYBERNOS MEMORY] … ». On rogne le marqueur et on écrase les
 * retours à la ligne, exactement comme `_sanitize` côté serveur.
 */
const sanitizeMemory = (text) => String(text)
  .replace(/\r?\n+/g, ' · ')
  .replace(/\[\s*KYBERNOS\s*MEMORY/gi, '[KYBERNOS-MEMORY')
  .replace(/\[\s*MEMORY/gi, '[MEMORY-')
  .slice(0, MEMORY_MAX_CONTENT)

/** Ordre de RENDU imposé par la spec : épinglés d'abord, puis du plus ancien au plus récent (stable pour le cache de prompt du proxy). */
const sortMemories = (items) => items.slice().sort((a, b) => {
  if (a.pinned !== b.pinned) return a.pinned === true ? -1 : 1
  const ka = String(a.createdAt === null || a.createdAt === undefined ? '' : a.createdAt)
  const kb = String(b.createdAt === null || b.createdAt === undefined ? '' : b.createdAt)
  if (ka !== kb) return ka < kb ? -1 : 1
  return Number(a.id) - Number(b.id)
})

const memoryLine = (m) => '- (' + String(m.kind) + (m.pinned === true ? ', épinglé' : '') + ') ' + sanitizeMemory(m.content)

const newestFirst = (a, b) => {
  const ka = String(a.createdAt === null || a.createdAt === undefined ? '' : a.createdAt)
  const kb = String(b.createdAt === null || b.createdAt === undefined ? '' : b.createdAt)
  if (ka !== kb) return ka < kb ? 1 : -1
  return Number(b.id) - Number(a.id)
}

/**
 * CHOIX de ce qui part au modèle dans un budget de caractères. La sélection se
 * fait par fraîcheur (épinglés d'abord, plafonnés à `pinnedShare` du budget,
 * puis les plus récents), le RENDU reste dans l'ordre stable de `sortMemories`.
 * Le tri « du plus ancien au plus récent + coupe au premier dépassement » que
 * faisait ce code gardait toujours les plus vieux : sur un compte à 631 souvenirs
 * seuls 12 épinglés entraient, et rien de ce que le modèle venait d'apprendre.
 * Un souvenir trop long pour le reste du budget est sauté (on essaie plus petit).
 */
const selectForPrompt = (items, budget, pinnedShare) => {
  const cost = (m) => memoryLine(m).length + 1
  const chosen = new Set()
  let used = 0
  const take = (m, cap) => {
    const c = cost(m)
    if (chosen.has(m) || used + c > cap) return
    chosen.add(m)
    used += c
  }
  const pinned = items.filter((m) => m.pinned === true).sort(newestFirst)
  const loose = items.filter((m) => m.pinned !== true).sort(newestFirst)
  const pinCap = Math.floor(budget * pinnedShare)
  pinned.forEach((m) => take(m, pinCap))
  loose.forEach((m) => take(m, budget))
  // Du budget resté libre (peu de souvenirs libres) : on y remet des épinglés.
  pinned.forEach((m) => take(m, budget))
  return { chosen: sortMemories(items.filter((m) => chosen.has(m))), used, omitted: items.length - chosen.size }
}

/**
 * Le plan d'injection — UNE seule source de vérité : le texte du prompt, le
 * compteur « 12 of 631 » de la page et le drapeau `sent` de chaque ligne en
 * sortent tous. Sinon l'écran peut annoncer autre chose que ce que le modèle lit.
 */
const planInjection = (state) => {
  const empty = { account: { chosen: [], used: 0, omitted: 0 }, kyber: {}, used: 0, budget: MEMORY_MAX_INJECT_CHARS }
  if (isConnected(state) !== true) return empty
  const cfg = readMemorySettings()
  if (cfg.memories !== true || cfg.context !== true) return empty
  const kyberKeys = Object.keys(memoryCache.kyber).filter((k) => memoryCache.kyber[k].length > 0)
  const lineBudget = Math.max(0, MEMORY_MAX_INJECT_CHARS - MEMORY_FRAME_CHARS - MEMORY_KYBER_FRAME_CHARS * kyberKeys.length)
  const accountBudget = kyberKeys.length > 0 ? Math.floor(lineBudget * (1 - MEMORY_KYBER_SHARE)) : lineBudget
  const account = selectForPrompt(memoryCache.account, accountBudget, MEMORY_PINNED_SHARE)
  const kyber = {}
  let used = account.used
  const left = lineBudget - used
  for (const local of kyberKeys) {
    const sel = selectForPrompt(memoryCache.kyber[local], Math.max(0, Math.floor(left / Math.max(1, kyberKeys.length))), MEMORY_PINNED_SHARE)
    kyber[local] = sel
    used += sel.used
  }
  return { account, kyber, used, budget: MEMORY_MAX_INJECT_CHARS }
}

/**
 * Le texte injecté. Rendu à chaque assemblage : il doit être synchrone et ne
 * jamais lever — d'où le `try` total et le retour de chaîne vide en cas de doute.
 */
const renderMemoryChunk = (state) => {
  try {
    if (isConnected(state) !== true) return ''
    const plan = planInjection(state)
    const parts = []
    if (plan.account.chosen.length > 0) {
      parts.push(MEMORY_MARKER + ' Souvenirs du compte Kybernos de l\'utilisateur (partagés avec tous ses agents) :')
      plan.account.chosen.forEach((m) => parts.push(memoryLine(m)))
      if (plan.account.omitted > 0) parts.push('- … (' + String(plan.account.omitted) + ' autres souvenirs non envoyés ce tour : memory_search pour les retrouver)')
    }
    for (const local of Object.keys(plan.kyber)) {
      if (plan.kyber[local].chosen.length === 0) continue
      parts.push('', 'Mémoire du kyber « ' + local + ' » :')
      plan.kyber[local].chosen.forEach((m) => parts.push(memoryLine(m)))
      if (plan.kyber[local].omitted > 0) parts.push('- … (' + String(plan.kyber[local].omitted) + ' autres non envoyés)')
    }
    if (parts.length === 0) return ''
    // The proxy looks for this exact token to avoid adding its own copy: it must lead every non-empty chunk,
    // including one that only carries kyber memories.
    if (parts[0].indexOf(MEMORY_MARKER) !== 0) parts.unshift(MEMORY_MARKER + ' Mémoire du compte Kybernos de l\'utilisateur :')
    parts.push('', 'Ces souvenirs viennent du compte de l\'utilisateur. N\'en invente jamais : appelle memory_write pour en ajouter (genre fact|preference|event|policy), memory_search pour en chercher.')
    return parts.join('\n')
  } catch (e) {
    return ''
  }
}

/**
 * Tokens the Kybernos proxy reads in the system prompt (core/middleware/kybernos/_hook.py, server repo):
 * with either one present it does NOT add its own MEMORY chunk, so the model never gets the memories
 * twice and a user who switched them off is not overruled server-side. Keep both strings in step with it.
 */
const MEMORY_MARKER = '[KYBERNOS MEMORY]'
const MEMORY_OFF_MARKER = '[KYBERNOS MEMORY OFF] Saved memories are not included in this request.'

/**
 * What the prompt really gets: the memories (they carry MEMORY_MARKER), or the off marker when the user
 * switched memories / their context off, or nothing (no account, or nothing to send yet — the proxy
 * may then still add its own copy, which is the safety net on a cold start).
 */
const renderMemoryPrompt = (state) => {
  try {
    if (isConnected(state) !== true) return ''
    const cfg = readMemorySettings()
    if (cfg.memories !== true || cfg.context !== true) return MEMORY_OFF_MARKER
    return renderMemoryChunk(state)
  } catch (e) {
    return ''
  }
}

/** Recharge le cache depuis l'API. Best-effort : une lecture qui échoue GARDE l'ancien contenu. */
const refreshMemoryCache = async (state, force) => {
  try {
    if (isConnected(state) !== true) { emptyMemoryCache(); return }
    if (force !== true && Date.now() - memoryCache.at < MEMORY_CACHE_MS) return
    const account = await listMemories(state, 'account', null)
    // Une lecture refusée (401, réseau coupé) ne vide JAMAIS le cache : le prompt
    // continue de porter le dernier état connu, et l'erreur remonte par la route.
    if (account.ok !== true) { memoryCache.error = account.error; return }
    const kyber = {}
    const map = stateKyberMap(state)
    const seen = new Set()
    for (const local of Object.keys(map)) {
      const cloud = map[local]
      if (typeof cloud !== 'string' || cloud === '' || seen.has(cloud)) continue
      seen.add(cloud)
      const got = await listMemories(state, 'kyber', cloud)
      if (got.ok === true) kyber[local] = got.items
      else if (memoryCache.kyber[local] !== undefined) kyber[local] = memoryCache.kyber[local]
    }
    memoryCache.account = account.items
    memoryCache.kyber = kyber
    memoryCache.error = null
    memoryCache.at = Date.now()
  } catch (e) {
    memoryCache.error = 'interne'
  }
}

// ── Routes locales ──────────────────────────────────────────────────────────

const memoryRoute = async (req) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  await refreshMemoryCache(state, true)
  // Une lecture qui échoue ne doit JAMAIS se présenter comme « aucun
  // souvenir » : une liste vide et un 401 ne se ressemblent pas.
  if (memoryCache.error !== null) return { ok: false, connected: true, error: memoryCache.error }
  const map = stateKyberMap(state)
  return {
    ok: true,
    connected: true,
    account: sortMemories(memoryCache.account),
    kyber: memoryCache.kyber,
    map,
    locals: localKybers(),
    cloud: await listCloudKybers(state),
    lessonCounts: Object.fromEntries(localKybers().map((k) => [k, localLessons(k).length])),
    cache: { at: memoryCache.at, ttlMs: MEMORY_CACHE_MS, error: memoryCache.error },
    capture: lastCapture,
  }
}

/**
 * Installe un kyber publie dans la racine locale `~/.dsh/kybers/`.
 * On ne remplace JAMAIS un kyber du testeur : si l'id est pris, la route
 * refuse et le dit, sauf `ecraser: true` demande explicitement.
 * La reponse porte `aCompleter` : ce que le catalogue ne publie pas (route de
 * modele, stages, prompt manquant) et que le testeur devra ecrire.
 */
const marketplaceInstallRoute = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  const demande = body !== null && typeof body === 'object' ? body : {}
  const slug = typeof demande.slug === 'string' ? demande.slug.trim() : ''
  if (slug === '') return { ok: false, error: 'slug manquant' }
  if (verdictInstallation([], slug).cible !== slug) return { ok: false, error: 'slug invalide' }
  let res = null
  try {
    res = await apiCall('/v1/marketplace', { token: state.token })
  } catch (e) {
    return { ok: false, error: 'catalogue injoignable : ' + String(e !== null && e.message !== undefined ? e.message : e) }
  }
  if (res === null || res.status !== 200 || res.body === null) {
    return { ok: false, error: 'catalogue indisponible (code ' + String(res === null ? 'inconnu' : res.status) + ')' }
  }
  const cat = normaliserCatalogue(res.body)
  const item = cat.items.filter((i) => i.slug === slug)[0]
  if (item === undefined) return { ok: false, error: 'ce kyber n\'est plus publie sous l\'id « ' + slug + ' »' }
  const construit = ymlDuKyber(item)
  if (construit.yml === null) return { ok: false, error: 'manifeste inexploitable : ' + construit.aCompleter.join(' ; ') }
  const racine = kybersDir()
  let existants = []
  try { existants = readdirSync(racine, { withFileTypes: true }).filter((d) => d.isDirectory() === true).map((d) => d.name) } catch (e) { existants = [] }
  const verdict = verdictInstallation(existants, slug, { ecraser: demande.ecraser === true })
  if (verdict.action !== 'ecrire') return { ok: false, refuse: true, action: 'refus', error: verdict.motif, racine }
  const dir = join(racine, slug)
  const cible = join(dir, 'kyber.yml')
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(cible, construit.yml, 'utf8')
  } catch (e) {
    return { ok: false, error: 'ecriture impossible : ' + String(e !== null && e.message !== undefined ? e.message : e) }
  }
  return {
    ok: true, slug, chemin: cible, origine: 'kybernos.app/' + slug,
    roles: construit.roles.map((r) => r.id), aCompleter: construit.aCompleter,
  }
}

const memoryCreateRoute = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  return await createMemory(state, body === null ? {} : body, 'taught')
}

const memoryUpdateRoute = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  return await patchMemory(state, body === null ? {} : body)
}

const memoryDeleteRoute = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  return await deleteMemory(state, body === null ? {} : body)
}

const memorySearchRoute = async (req) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte', items: [] }
  let q = ''
  try { q = new URL(req.url, 'http://localhost').searchParams.get('q') || '' } catch (e) { q = '' }
  return await searchMemories(state, q)
}

const memoryMapRoute = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  const incoming = body !== null && typeof body.map === 'object' && body.map !== null ? body.map : null
  if (incoming === null) return { ok: false, error: 'map_manquante' }
  const clean = {}
  for (const local of Object.keys(incoming)) {
    const cloud = incoming[local]
    if (typeof cloud === 'string' && cloud !== '') clean[local] = cloud
  }
  writeState({ ...state, kyberMap: clean })
  bumpMemoryCache()
  void refreshMemoryCache(readState(), true)
  return { ok: true, map: clean }
}

// ── Réglages + liste paginée (page « Memory & Lessons learned ») ─────────────

// `capture` rides along: the page shows « last capture: … » in the options, and the full
// `/kybernos-cloud/memory` route that also carries it re-reads the whole account from the API.
const memorySettingsRoute = async () => ({ ok: true, settings: readMemorySettings(), capture: lastCapture })

const memorySettingsSetRoute = async (req, body) => {
  const incoming = body !== null && typeof body === 'object' && Array.isArray(body) === false ? body : null
  if (incoming === null) return { ok: false, error: 'corps_invalide' }
  const next = readMemorySettings()
  for (const key of Object.keys(incoming)) {
    // Fail-closed : une clé inconnue ou une valeur qui n'est pas un booléen est
    // refusée en bloc — on n'applique jamais « à moitié » un réglage.
    if (MEMORY_SETTING_KEYS.indexOf(key) < 0) return { ok: false, error: 'cle_inconnue', key }
    if (typeof incoming[key] !== 'boolean') return { ok: false, error: 'valeur_invalide', key }
    next[key] = incoming[key]
  }
  writeSide('memory', next)
  return { ok: true, settings: next }
}

/** Date serveur (`2026-09-22 18:57:52.777496+00:00`) → ms ; NaN si illisible. */
const parseWhen = (value) => {
  if (typeof value !== 'string' || value === '') return NaN
  const iso = value.replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1')
  return Date.parse(iso)
}

const ADDED_WINDOW_MIN = { '1m': 1, '1h': 60, today: 1440, '7d': 10080 }

const intParam = (raw, fallback, min, max) => {
  const n = parseInt(raw, 10)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

// ── Search by meaning (client half; server half: GET/PUT/POST /v1/memories… embeddings) ─────────
// The plugin embeds the text itself with the Kybernos embeddings route (kybernos/embed = bge-m3, 1024
// dimensions, free tier, billed to the account like chat) and sends the vector; the server only stores
// and ranks. EVERYTHING here is behind the `meaning` switch and never runs on its own at start-up.

const EMBED_MODEL = 'kybernos/embed'
const EMBED_DIM = 1024
const EMBED_BATCH = 16
const INDEX_BATCH_MAX = 64
const MEANING_BACKOFF_MS = 10 * 60 * 1000
// What we last learned, so a write or a search does not hammer a server (or a plan) that already said no.
const meaningCache = { unavailableAt: 0, planBlockedAt: 0, requiredTier: null, plan: null, lastError: null, lastIndexedAt: 0 }

/** Why we are not even trying right now ('sens_indisponible' | 'offre_requise'), or null. Both lift after 10 minutes or on a good status probe. */
const meaningPaused = () => {
  const now = Date.now()
  if (now - meaningCache.planBlockedAt < MEANING_BACKOFF_MS) return 'offre_requise'
  if (now - meaningCache.unavailableAt < MEANING_BACKOFF_MS) return 'sens_indisponible'
  return null
}

/**
 * The embeddings route is gated by plan: on the dev tier a `free` key gets
 * 403 { error: { provider_specific_fields: { error: 'model-not-available-plan', required_tier: 'solo', plan: 'free' } } }.
 * 402 = no credits left. Everything else keeps the generic words.
 */
const embedFailure = (res) => {
  if (res.status === 402) return { error: 'credits_epuises' }
  if (res.status === 403) {
    const f = res.body !== null && res.body.error !== null && typeof res.body.error === 'object' ? res.body.error.provider_specific_fields : null
    if (f !== null && typeof f === 'object' && f.error === 'model-not-available-plan') {
      return { error: 'offre_requise', requiredTier: typeof f.required_tier === 'string' ? f.required_tier : null, plan: typeof f.plan === 'string' ? f.plan : null }
    }
    return { error: 'refus_403' }
  }
  const generic = memoryFailure(res)
  return generic === null ? null : { error: generic }
}

/** Remembers a refusal: the plan one stops us trying for 10 minutes and says which tier is needed. */
const noteEmbedFailure = (failure) => {
  meaningCache.lastError = failure.error
  if (failure.error === 'offre_requise') {
    meaningCache.planBlockedAt = Date.now()
    meaningCache.requiredTier = failure.requiredTier === undefined ? null : failure.requiredTier
    meaningCache.plan = failure.plan === undefined ? null : failure.plan
  }
}

/** Vectors for `texts`, in order. Never throws; every failure is `{ ok:false, error }` (+ requiredTier / plan for 'offre_requise'). */
const embedTexts = async (state, texts) => {
  if (!Array.isArray(texts) || texts.length === 0) return { ok: true, vectors: [] }
  const res = await apiCall('/v1/embeddings', { method: 'POST', token: state.token, body: { model: EMBED_MODEL, input: texts } })
  const failure = embedFailure(res)
  if (failure !== null) return { ok: false, ...failure }
  const data = res.body !== null && Array.isArray(res.body.data) ? res.body.data.slice() : []
  data.sort((a, b) => (Number(a && a.index) || 0) - (Number(b && b.index) || 0))
  const vectors = data.map((d) => (d !== null && typeof d === 'object' ? d.embedding : null))
  const sane = vectors.length === texts.length && vectors.every((v) => Array.isArray(v) && v.length === EMBED_DIM && v.every((x) => typeof x === 'number' && Number.isFinite(x)))
  if (sane !== true) return { ok: false, error: 'embedding_invalide' }
  meaningCache.planBlockedAt = 0
  return { ok: true, vectors }
}

/** Stores one vector on a memory. 503 = this server cannot (no pgvector); 404 = gone (or an older server). */
const putEmbedding = async (state, id, vector) => {
  const res = await apiCall('/v1/memories/' + encodeURIComponent(String(id)) + '/embedding', { method: 'PUT', token: state.token, body: { embedding: vector, model: EMBED_MODEL } })
  if (res.status === 200) return { ok: true }
  if (res.status === 503) return { ok: false, error: 'sens_indisponible' }
  if (res.status === 404) {
    const unknownRoute = res.body !== null && typeof res.body.error === 'string' && res.body.error.indexOf('Unknown memories route') >= 0
    return { ok: false, error: unknownRoute ? 'serveur_ancien' : 'souvenir_introuvable' }
  }
  return { ok: false, error: memoryFailure(res) || 'refus_' + String(res.status) }
}

const noteMeaningUnavailable = (error) => {
  meaningCache.lastError = error
  if (error === 'sens_indisponible' || error === 'serveur_ancien') meaningCache.unavailableAt = Date.now()
}

/** One page of the account's memories as the server filters it (`embedded=false|true`). */
const serverPage = async (state, query) => apiCall('/v1/memories?scope=account&' + query, { token: state.token })

/**
 * What this server can do, whether the plan allows it, and how much is indexed.
 * `available`: true / false (no pgvector, or a server that predates the routes) / null (could not tell).
 * `allowed`: true / false (the plan does not include the embeddings model; `requiredTier` says which does) / null
 * (never tried). `probe` spends ONE embedding call (a 2-letter text) to find out, only when asked.
 */
const meaningStatus = async (state, options) => {
  const settings = readMemorySettings()
  const base = { ok: true, enabled: settings.meaning, available: null, allowed: null, requiredTier: null, plan: null, reason: null, total: null, indexed: null, remaining: null, last: meaningCache.lastError }
  const todo = await serverPage(state, 'embedded=false&limit=1')
  if (todo.status === 503) return { ...base, available: false, reason: 'sens_indisponible' }
  const failure = memoryFailure(todo)
  if (failure !== null) return { ...base, reason: failure }
  if (todo.body === null || typeof todo.body.total !== 'number') return { ...base, available: false, reason: 'serveur_ancien' }
  const done = await serverPage(state, 'embedded=true&limit=1')
  const indexed = done.body !== null && typeof done.body.total === 'number' ? done.body.total : null
  const remaining = todo.body.total
  meaningCache.unavailableAt = 0
  if (options !== undefined && options.probe === true) {
    const probe = await embedTexts(state, ['ok'])
    if (probe.ok !== true) noteEmbedFailure(probe)
  }
  const blocked = Date.now() - meaningCache.planBlockedAt < MEANING_BACKOFF_MS
  const probed = options !== undefined && options.probe === true
  return {
    ...base, available: true,
    allowed: blocked ? false : (probed ? true : null),
    requiredTier: blocked ? meaningCache.requiredTier : null, plan: blocked ? meaningCache.plan : null,
    total: indexed === null ? null : indexed + remaining, indexed, remaining, last: meaningCache.lastError,
  }
}

/** Indexes up to `max` (≤ INDEX_BATCH_MAX) memories that have no vector yet, newest first. */
const indexMemories = async (state, max) => {
  if (readMemorySettings().meaning !== true) return { ok: false, error: 'sens_desactive', indexed: 0 }
  const paused = meaningPaused()
  if (paused !== null) return { ok: false, error: paused, indexed: 0, requiredTier: paused === 'offre_requise' ? meaningCache.requiredTier : undefined }
  const cap = Math.min(INDEX_BATCH_MAX, Math.max(1, Number.isFinite(max) ? Math.floor(max) : INDEX_BATCH_MAX))
  let indexed = 0
  let remaining = null
  while (indexed < cap) {
    const want = Math.min(EMBED_BATCH, cap - indexed)
    const page = await serverPage(state, 'embedded=false&order=recent&limit=' + String(want))
    if (page.status === 503) { noteMeaningUnavailable('sens_indisponible'); return { ok: false, error: 'sens_indisponible', indexed } }
    const failure = memoryFailure(page)
    if (failure !== null) return { ok: false, error: failure, indexed }
    if (page.body === null || typeof page.body.total !== 'number') { noteMeaningUnavailable('serveur_ancien'); return { ok: false, error: 'serveur_ancien', indexed } }
    const rows = Array.isArray(page.body.memories) ? page.body.memories : []
    remaining = Math.max(0, page.body.total - rows.length)
    if (rows.length === 0) break
    const emb = await embedTexts(state, rows.map((r) => String(r.content)))
    if (emb.ok !== true) { noteEmbedFailure(emb); return { ok: false, error: emb.error, requiredTier: emb.requiredTier, indexed } }
    for (let i = 0; i < rows.length; i++) {
      const put = await putEmbedding(state, rows[i].id, emb.vectors[i])
      if (put.ok !== true && put.error !== 'souvenir_introuvable') { noteMeaningUnavailable(put.error); return { ok: false, error: put.error, indexed } }
      if (put.ok === true) indexed += 1
    }
  }
  meaningCache.lastError = null
  meaningCache.lastIndexedAt = Date.now()
  return { ok: true, indexed, remaining: remaining === null ? 0 : remaining }
}

/** Fire-and-forget: a memory that was just written or edited gets its vector. A miss is fine: the next indexing run covers it. */
const indexOneInBackground = (state, memory) => {
  try {
    if (memory === null || memory === undefined || readMemorySettings().meaning !== true) return
    if (meaningPaused() !== null) return
    void (async () => {
      const emb = await embedTexts(state, [String(memory.content)])
      if (emb.ok !== true) { noteEmbedFailure(emb); return }
      const put = await putEmbedding(state, memory.id, emb.vectors[0])
      if (put.ok !== true) noteMeaningUnavailable(put.error)
    })().catch(() => {})
  } catch (e) { /* never break a write */ }
}

/** The memories nearest to `q` by meaning: `{ ok, items:[{…memory, distance}] }`. */
const findByMeaning = async (state, q, limit) => {
  const settings = readMemorySettings()
  if (settings.meaning !== true) return { ok: false, error: 'sens_desactive' }
  const paused = meaningPaused()
  if (paused !== null) return { ok: false, error: paused, requiredTier: paused === 'offre_requise' ? meaningCache.requiredTier : undefined }
  const emb = await embedTexts(state, [q])
  if (emb.ok !== true) { noteEmbedFailure(emb); return { ok: false, error: emb.error, requiredTier: emb.requiredTier } }
  const res = await apiCall('/v1/memories/search', { method: 'POST', token: state.token, body: { embedding: emb.vectors[0], scope: 'account', limit } })
  if (res.status === 503) { noteMeaningUnavailable('sens_indisponible'); return { ok: false, error: 'sens_indisponible' } }
  if (res.status === 404 || res.status === 405) { noteMeaningUnavailable('serveur_ancien'); return { ok: false, error: 'serveur_ancien' } }
  const failure = memoryFailure(res)
  if (failure !== null) return { ok: false, error: failure }
  const raw = res.body !== null && Array.isArray(res.body.memories) ? res.body.memories : []
  return { ok: true, items: raw.map((m) => ({ ...asMemory(m), distance: typeof m.distance === 'number' ? m.distance : null })) }
}

/**
 * Liste paginée et filtrée des souvenirs du COMPTE. Tout est calculé ici, sur le
 * cache : le serveur ne pagine pas encore (`GET /v1/memories` renvoie tout), donc
 * la page ne doit pas recevoir 631 lignes pour en afficher 25. `sent` vient de
 * `planInjection` — la même sélection que le prompt. La recherche est textuelle
 * (`mode: exact`) : la pertinence demandera un index côté serveur.
 */
const memoryListRoute = async (req) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  await refreshMemoryCache(state, false)
  if (memoryCache.error !== null && memoryCache.account.length === 0) return { ok: false, connected: true, error: memoryCache.error }
  let params = new URLSearchParams('')
  try { params = new URL(req.url, 'http://localhost').searchParams } catch (e) { /* requete sans query */ }
  const limit = intParam(params.get('limit'), 25, 1, 200)
  const offset = intParam(params.get('offset'), 0, 0, 1000000)
  const show = ['pinned', 'sent'].indexOf(params.get('show')) >= 0 ? params.get('show') : 'all'
  const src = ['capture', 'agent', 'you', 'sync'].indexOf(params.get('src')) >= 0 ? params.get('src') : 'any'
  const added = ADDED_WINDOW_MIN[params.get('added')] !== undefined ? params.get('added') : 'any'
  const qRaw = String(params.get('q') || '').trim()
  const q = qRaw.toLowerCase()
  const wantMeaning = params.get('mode') === 'meaning' && q !== ''

  const plan = planInjection(state)
  const sentIds = new Set(plan.account.chosen.map((m) => String(m.id)))
  const ledger = readSide('memory-origins', {})
  const now = Date.now()
  const rows = memoryCache.account.slice().sort(newestFirst).map((m) => {
    const o = originOf(m, ledger)
    const when = parseWhen(m.createdAt)
    return {
      id: m.id, kind: m.kind, content: m.content, source: m.source, origin: o.origin, originKnown: o.originKnown,
      pinned: m.pinned === true, sent: sentIds.has(String(m.id)), createdAt: m.createdAt, expiresAt: m.expiresAt, retentionDays: m.retentionDays,
      ageMinutes: Number.isFinite(when) ? Math.max(0, Math.round((now - when) / 60000)) : null,
    }
  })
  const youOrigin = (r) => r.origin === 'taught'
  const counts = {
    all: rows.length, pinned: rows.filter((r) => r.pinned).length, sent: rows.filter((r) => r.sent).length,
    capture: rows.filter((r) => r.origin === 'capture').length, agent: rows.filter((r) => r.origin === 'agent').length,
    you: rows.filter(youOrigin).length, sync: rows.filter((r) => r.origin === 'sync').length,
  }
  let list = rows
  if (show === 'pinned') list = list.filter((r) => r.pinned)
  if (show === 'sent') list = list.filter((r) => r.sent)
  if (src !== 'any') list = list.filter((r) => (src === 'you' ? youOrigin(r) : r.origin === src))
  if (added !== 'any') list = list.filter((r) => r.ageMinutes !== null && r.ageMinutes <= ADDED_WINDOW_MIN[added])
  // The words search ranks by relevance, locally (relevance.mjs): no model, no network, any plan. The order is
  // best first, and each item says how many of the query's words it matched.
  const byRelevance = (items) => rankByRelevance(items, qRaw).map((r) => ({ ...r.doc, matched: r.matched, of: r.of }))
  let search = { mode: 'relevance', relevance: true }
  if (wantMeaning) {
    // Search by meaning: the server ranks, we only decorate and filter. Any failure falls back to the words
    // search below, with the reason, so the page always shows something and says why it is not by meaning.
    const found = await findByMeaning(state, String(params.get('q')).trim(), 50)
    if (found.ok === true) {
      const byId = new Map(rows.map((r) => [String(r.id), r]))
      list = found.items.map((m) => {
        const known = byId.get(String(m.id))
        const base = known !== undefined ? known : { id: m.id, kind: m.kind, content: m.content, source: m.source, origin: 'sync', originKnown: false, pinned: m.pinned, sent: false, createdAt: m.createdAt, expiresAt: m.expiresAt, retentionDays: m.retentionDays, ageMinutes: null }
        return { ...base, closeness: typeof m.distance === 'number' ? Math.max(0, Math.min(100, Math.round((1 - m.distance) * 100))) : null }
      })
      if (show === 'pinned') list = list.filter((r) => r.pinned)
      if (show === 'sent') list = list.filter((r) => r.sent)
      if (src !== 'any') list = list.filter((r) => (src === 'you' ? youOrigin(r) : r.origin === src))
      if (added !== 'any') list = list.filter((r) => r.ageMinutes !== null && r.ageMinutes <= ADDED_WINDOW_MIN[added])
      search = { mode: 'meaning', relevance: true }
    } else {
      search = { mode: 'relevance', relevance: true, fallback: found.error, requiredTier: found.requiredTier === undefined ? null : found.requiredTier }
      list = byRelevance(list)
    }
  } else if (q !== '') {
    list = byRelevance(list)
  }
  return {
    ok: true, connected: true,
    total: list.length, limit, offset, items: list.slice(offset, offset + limit),
    counts, filters: { show, src, added, q },
    search,
    budget: { cap: plan.budget, used: renderMemoryChunk(state).length, sent: plan.account.chosen.length, omitted: plan.account.omitted },
    settings: readMemorySettings(),
    cache: { at: memoryCache.at, error: memoryCache.error },
  }
}

/** Search by meaning: is it on, can this server do it, how much is indexed. Two light reads, no embedding call. */
const memoryIndexStatusRoute = async (req) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  let probe = false
  try { probe = new URL(req.url, 'http://localhost').searchParams.get('probe') === '1' } catch (e) { probe = false }
  // A probe embeds a 2-letter text: only when the switch is on, never on its own.
  return await meaningStatus(state, { probe: probe && readMemorySettings().meaning === true })
}

/** Indexes one batch (≤ 64) of the memories without a vector. The page calls it again until `remaining` is 0. */
const memoryIndexRunRoute = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  const max = body !== null && typeof body === 'object' && body.max !== undefined ? Number(body.max) : INDEX_BATCH_MAX
  return await indexMemories(state, max)
}

const memoryLessonsRoute = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  const dry = body === null ? true : body.dryRun !== false
  return await pushLessons(state, { dryRun: dry })
}

// ── Outils exposés au modèle ────────────────────────────────────────────────
// Construits à la main : `defineTool` vit dans `@deepseek-ai/dsh-tools`, que ce
// plugin (sans dépendances) ne peut pas importer, mais `tools.register` exige
// seulement { name, parameters, output:{schema,render}, execute }.
// `kyber_id` n'est VOLONTAIREMENT pas exposé : un modèle ne doit pas pouvoir
// viser le kyber d'un autre (spec serveur §7, checker F4). La portée kyber est
// choisie par l'appelant côté DSH, jamais par le modèle.

const TEXT_RESULT = (text) => [{
  type: 'text',
  text,
}]

const memoryWriteTool = () => ({
  name: 'memory_write',
  description: 'Enregistre un souvenir durable dans le compte Kybernos (partagé avec les autres agents de l\'utilisateur). À n\'utiliser que pour un enseignement explicite ou une correction — jamais pour deviner.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      content: { type: 'string', description: 'Le souvenir, en une phrase.' },
      kind: { type: 'string', enum: MEMORY_KINDS, description: 'fact | preference | event | policy' },
      source: { type: 'string', enum: MEMORY_SOURCES, description: 'D\'où vient le souvenir. Défaut : conversation.' },
      pinned: { type: 'boolean', description: 'Épinglé : n\'expire jamais.' },
    },
    required: ['content', 'kind'],
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean' },
        id: { type: 'integer' },
        error: { type: 'string' },
      },
      required: ['ok'],
    },
    render: (args, value) => TEXT_RESULT(value.ok === true ? 'Souvenir enregistré dans le compte Kybernos (' + String(args.kind) + ').' : 'Souvenir non enregistré : ' + String(value.error)),
  },
  async execute(args) {
    const state = readState()
    if (isConnected(state) !== true) return { ok: false, error: 'compte_kybernos_non_connecte' }
    if (readMemorySettings().memories !== true) return { ok: false, error: 'memoire_desactivee' }
    const made = await createMemory(state, {
      scope: 'account',
      kind: args.kind,
      content: args.content,
      source: typeof args.source === 'string' ? args.source : 'conversation',
      pinned: args.pinned === true,
    }, 'agent')
    return made.ok === true ? { ok: true, id: made.memory === null ? 0 : Number(made.memory.id) } : { ok: false, error: made.error }
  },
})

const memorySearchTool = () => ({
  name: 'memory_search',
  description: 'Cherche dans les souvenirs du compte Kybernos (faits, préférences, événements, politiques).',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      q: { type: 'string', description: 'Mots à chercher.' },
    },
    required: ['q'],
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean' },
        count: { type: 'integer' },
        found: { type: 'string' },
        error: { type: 'string' },
      },
      required: ['ok'],
    },
    render: (args, value) => TEXT_RESULT(value.ok === true ? (value.count === 0 ? 'Aucun souvenir pour « ' + String(args.q) + ' ».' : String(value.found)) : 'Recherche impossible : ' + String(value.error)),
  },
  async execute(args) {
    const state = readState()
    if (isConnected(state) !== true) return { ok: false, error: 'compte_kybernos_non_connecte' }
    if (readMemorySettings().memories !== true) return { ok: false, error: 'memoire_desactivee' }
    const found = await searchMemories(state, args.q)
    if (found.ok !== true) return { ok: false, error: found.error }
    const lines = sortMemories(found.items).slice(0, 10).map((m) => '#' + String(m.id) + ' (' + String(m.kind) + (m.scope === 'kyber' ? ', kyber' : '') + ') ' + String(m.content))
    return { ok: true, count: found.items.length, found: lines.join('\n') }
  },
})

// ── Capture en fin de tour ──────────────────────────────────────────────────
// Équivalent DSH de l'« option C » de la plateforme : après un tour réussi, une
// complétion en tâche de fond (maxTokens 300) extrait ce qui mérite d'être
// retenu et l'écrit dans le compte. Ne bloque jamais, ne lève jamais, et ne
// fait rien hors connexion.

// Marqueurs du bloc que CE plugin injecte dans le prompt. La capture relit les
// messages du tour en cours : quand le tour a recu l'injection, l'extraction
// relisait donc le bloc memoire et REECRIVAIT le meme souvenir — boucle de
// retroaction constatee en live le 22/09/2026 (souvenir #53, duplicata exact de
// #51, apparu a la fin du tour d'un sous-agent qui portait l'injection). Le bloc
// est retire AVANT de soumettre le texte.
const MEMORY_BLOCK_HEAD = '[KYBERNOS MEMORY]'
const MEMORY_BLOCK_TAIL = 'memory_search pour en chercher.'

const stripMemoryBlock = (value) => {
  let text = String(value)
  for (;;) {
    const start = text.indexOf(MEMORY_BLOCK_HEAD)
    if (start < 0) break
    const end = text.indexOf(MEMORY_BLOCK_TAIL, start)
    text = text.slice(0, start) + (end < 0 ? '' : text.slice(end + MEMORY_BLOCK_TAIL.length))
  }
  return text.trim()
}

// Forme comparable d'un souvenir, pour l'idempotence.
const normalizeMemory = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const lastTurnText = (messages) => {
  const text = (m) => {
    if (m === null || typeof m !== 'object' || Array.isArray(m.content) === false) return ''
    return m.content.filter((block) => block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('\n')
  }
  const user = messages.filter((m) => m.role === 'user').slice(-1)[0]
  const assistant = messages.filter((m) => m.role === 'assistant').slice(-1)[0]
  const left = stripMemoryBlock(user === undefined ? '' : text(user))
  const right = stripMemoryBlock(assistant === undefined ? '' : text(assistant))
  // Les roles sont NOMMES : sans etiquette, le modele d'extraction ne peut pas
  // distinguer ce que l'utilisateur a enseigne de ce que l'agent a affirme —
  // et la consigne « n'extrais que l'enseignement de l'utilisateur » devient
  // inapplicable (risque observe : l'agent se cite lui-meme).
  const both = (left === '' ? '' : 'UTILISATEUR :\n' + left + '\n\n') + (right === '' ? '' : 'AGENT :\n' + right)
  return both.trim() === '' ? null : both.trim().slice(0, 6000)
}

const CAPTURE_PROMPT = 'Tu lis la fin d\'un tour de conversation entre un utilisateur et son agent de code. '
  + 'Extrais UNIQUEMENT ce que l\'utilisateur a enseigné sur lui-même, son environnement ou ses préférences durables '
  + '(par exemple « j\'habite à Paris », « je préfère les réponses en français », « ce projet se déploie sur Fly.io »). '
  + 'N\'extrais rien qui soit un détail de la tâche en cours, un chemin de fichier temporaire ou une supposition. '
  + 'Réponds en JSON strict : {"memories":[{"content":"…","kind":"fact|preference|event|policy"},…]} '
  + 'ou {"memories":[]} s\'il n\'y a rien. Aucun texte autour du JSON.'

const extractFacts = async (ctx, agent, text, signal) => {
  const llm = ctx.get('llm')
  if (llm === undefined) return []
  const options = agent.options === undefined ? {} : agent.options
  const header = typeof agent.session.requestHeader === 'function' ? agent.session.requestHeader() : undefined
  const latest = header === undefined || header === null ? undefined : header.config
  const target = (typeof options.provider === 'string' && typeof options.model === 'string')
    ? { provider: options.provider, model: options.model }
    : latest
  if (target === undefined || typeof target.provider !== 'string' || typeof target.model !== 'string') return []
  const messages = [{ role: 'user', content: [{ type: 'text', text: CAPTURE_PROMPT + '\n\n---\n' + text }] }]
  let raw = ''
  const stream = llm.stream({
    provider: target.provider,
    model: target.model,
    messages,
    maxTokens: CAPTURE_MAX_TOKENS,
    sessionId: agent.session.id,
    purpose: 'memory-capture',
    ...signal === undefined ? {} : { signal },
  })
  for await (const chunk of stream) {
    if (chunk !== null && typeof chunk === 'object' && chunk.type === 'text-delta' && typeof chunk.text === 'string') raw += chunk.text
  }
  const open = raw.indexOf('{')
  const close = raw.lastIndexOf('}')
  if (open < 0 || close <= open) return []
  let parsed = null
  try { parsed = JSON.parse(raw.slice(open, close + 1)) } catch (e) { return [] }
  const rows = parsed !== null && Array.isArray(parsed.memories) ? parsed.memories : []
  return rows
    .filter((r) => r !== null && typeof r === 'object' && typeof r.content === 'string' && MEMORY_KINDS.indexOf(r.kind) >= 0)
    .map((r) => ({ content: r.content.trim(), kind: r.kind }))
    .filter((r) => r.content.length >= 8 && r.content.length <= MEMORY_MAX_CONTENT)
    .slice(0, 3)
}

/**
 * Dernier passage de la capture. Observabilité volontairement minimale (en
 * mémoire, pas persistée) : sans elle, un `llm` indisponible ou une extraction
 * qui échoue serait indiscernable de « rien à retenir » — le même angle mort
 * que « le panneau est sélectionné » sans « le panneau est visible ».
 */
const lastCapture = { at: 0, status: 'jamais', facts: 0 }

const noteCapture = (status, facts) => {
  lastCapture.at = Date.now()
  lastCapture.status = status
  lastCapture.facts = facts
}

const captureTurn = async (ctx, agent, signal) => {
  try {
    const state = readState()
    if (isConnected(state) !== true) return noteCapture('hors_connexion', 0)
    // Les interrupteurs passent AVANT tout appel réseau ou LLM : « Capture : non »
    // ne doit pas coûter un seul jeton.
    const cfg = readMemorySettings()
    if (cfg.memories !== true || cfg.capture !== true) return noteCapture('desactivee', 0)
    if (agent === undefined || agent === null || agent.session === undefined) return noteCapture('sans_session', 0)
    const messages = typeof agent.session.deriveMessages === 'function' ? agent.session.deriveMessages() : []
    const text = lastTurnText(messages)
    if (text === null || text.length < CAPTURE_MIN_CHARS) return noteCapture('tour_trop_court', 0)
    if (ctx.get('llm') === undefined) return noteCapture('llm_indisponible', 0)
    const facts = await extractFacts(ctx, agent, text, signal)
    if (facts.length === 0) return noteCapture('rien_a_retenir', 0)
    // Idempotence : un fait deja present dans le compte n'est pas reecrit. Sans
    // cette garde, un meme fait s'ecrit a chaque tour qui le porte — le compte
    // se remplit de doublons (constate en live : #53 = #51). La lecture est
    // fail-open : si elle echoue, on ecrit quand meme (le retrait du bloc
    // injecte reste le premier rempart).
    const existing = await listMemories(state, 'account')
    const known = new Set(existing.ok === true ? existing.items.map((m) => normalizeMemory(m.content)) : [])
    let written = 0
    let skipped = 0
    let failed = 0
    for (const fact of facts) {
      const key = normalizeMemory(fact.content)
      if (key === '' || known.has(key) === true) { skipped += 1; continue }
      known.add(key)
      const made = await createMemory(state, { scope: 'account', kind: fact.kind, content: fact.content, source: 'conversation' }, 'capture')
      if (made.ok === true) written += 1
      else failed += 1
    }
    // Rien d'écrit parce que TOUT a échoué n'est pas « écrit : 0 » : la carte
    // doit pouvoir dire que la capture est en panne.
    if (written === 0 && failed > 0) return noteCapture('erreur', 0)
    if (written === 0 && skipped > 0) return noteCapture('deja_connu', 0)
    noteCapture('ecrit', written)
  } catch (e) {
    // Fire-and-forget : la capture ne casse jamais un tour.
    noteCapture('erreur', 0)
  }
}

const mountMemoryPrompt = (ctx) => {
  // `inject` (et non `get`) : c'est la forme des plugins natifs, et elle
  // donne un scope ou `scope.systemPrompt` est le service. Sans lui, rien.
  ctx.inject(['systemPrompt'], (scope) => {
    scope.systemPrompt.context({
      name: 'kybernos:memory',
      order: MEMORY_INJECT_ORDER,
      text: () => renderMemoryPrompt(readState()),
    })
  })
  const state = readState()
  if (isConnected(state) === true) setTimeout(() => { void refreshMemoryCache(readState(), true) }, 1500)
}

const mountMemoryTools = (ctx) => {
  ctx.inject(['tools'], (scope) => {
    scope.tools.register(memoryWriteTool())
    scope.tools.register(memorySearchTool())
  })
}

/**
 * Rafraîchit le cache dès qu'il est périmé. `force` reste faux : le TTL est
 * enfin respecté (avant, tous les appelants forçaient et il ne servait à rien).
 * Le minuteur est libéré avec le plugin et ne retient pas le processus.
 */
const mountMemoryRefresh = (ctx) => {
  ctx.effect(() => {
    const timer = setInterval(() => { void refreshMemoryCache(readState(), false) }, MEMORY_TUNING.tickMs)
    if (typeof timer.unref === 'function') timer.unref()
    return () => clearInterval(timer)
  }, 'kybernos-cloud: rafraichissement memoire')
}

const mountMemoryCapture = (ctx) => {
  ctx.on('agent/turn-stopping', ({ agent, signal }) => {
    void captureTurn(ctx, agent, signal)
  })
}

// ── Détail d'un chat DSH — LECTURE LOCALE EXCLUSIVE ─────────────────────────
// Le contenu d'une conversation ne quitte JAMAIS la machine : la route lit le
// journal de session sur disque (~/.dsh/sessions/<slug>/<id>/session.v4.jsonl.zstd)
// et répond directement. Rien ne passe par Supabase, contrairement au push
// métadonnées (titre + projet + date seulement). CORS restreint aux origines
// de la webapp en dev (localhost:8081) — jamais « * » : une page web arbitraire
// ne doit pas pouvoir lire les conversations locales par drive-by.
const DSH_CORS_ORIGINS = ['http://localhost:8081', 'http://127.0.0.1:8081']
const DSH_DETAIL_MAX_MESSAGES = 300
const DSH_DETAIL_MAX_CHARS = 4000

const zstdFrames = (buf) => {
  // Le journal est une suite de frames zstd CONCATÉNÉES (un frame par flush).
  // zstdDecompressSync s'arrête au premier frame : on chase la magie
  // 0x28B52FFD frame par frame, en validant chaque décompression (un candidat
  // magie peut tomber DANS les données compressées du frame précédent —
  // slice faussé = decompress error = candidat suivant).
  const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
  const parts = []
  let cursor = 0
  while (cursor < buf.length - 4) {
    let start = cursor
    let out = null
    while (start <= buf.length - 4) {
      const at = buf.indexOf(magic, start)
      if (at < 0) break
      const next = buf.indexOf(magic, at + 4)
      const end = next < 0 ? buf.length : next
      try {
        const txt = zstdDecompressSync(buf.subarray(at, end)).toString('utf8')
        if (txt.startsWith('{')) { out = { txt, end: next < 0 ? buf.length : next }; break }
      } catch { /* candidat faux ou frame tassée : on essaie le suivant */ }
      start = at + 1
    }
    if (!out) break
    parts.push(out.txt)
    cursor = out.end
  }
  return parts.join('')
}

const blocsTexte = (contenu) => {
  if (typeof contenu === 'string') return contenu
  if (Array.isArray(contenu)) {
    return contenu.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n')
  }
  return ''
}

const chatsDetail = (req) => {
  const url = new URL(req.url, 'http://local')
  const dshId = String(url.searchParams.get('dsh_id') || '').trim()
  if (!/^[\w-]{8,80}$/.test(dshId)) return { ok: false, error: 'dsh_id manquant' }
  let dossier = null
  try {
    for (const slug of readdirSync(SESSIONS_HOME)) {
      const candidat = join(SESSIONS_HOME, slug, dshId)
      try {
        if (statSync(candidat).isDirectory()) { dossier = candidat; break }
      } catch { /* pas ce slug */ }
    }
  } catch { /* home illisible */ }
  if (!dossier) return { ok: false, error: 'session introuvable sur cette machine' }
  let journal = ''
  try {
    const fichiers = readdirSync(dossier).filter((f) => f.endsWith('.jsonl.zstd')).sort()
    if (fichiers.length === 0) return { ok: false, error: 'aucun journal de session' }
    journal = zstdFrames(readFileSync(join(dossier, fichiers[0])))
  } catch (e) {
    return { ok: false, error: 'journal illisible : ' + String((e && e.message) || e).slice(0, 80) }
  }
  const messages = []
  for (const ligne of journal.split('\n')) {
    if (messages.length >= DSH_DETAIL_MAX_MESSAGES) break
    let e = null
    try { e = JSON.parse(ligne) } catch { continue }
    const d = e && e.data ? e.data : {}
    if (e.type === 'user/message') {
      // source.kind distingue le vrai propos ('user') des injections
      // (agent-instructions, runtime-context, skill-catalog…).
      const kind = d.source && typeof d.source === 'object' ? d.source.kind : null
      if (kind && kind !== 'user') continue
      let txt = blocsTexte(d.content)
      txt = txt.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim()
      if (txt !== '') messages.push({ role: 'user', text: txt.slice(0, DSH_DETAIL_MAX_CHARS), time: e.time || null })
    } else if (e.type === 'assistant/message') {
      const m = d.message || {}
      const txt = blocsTexte(m.content).trim()
      if (txt !== '') messages.push({ role: 'assistant', text: txt.slice(0, DSH_DETAIL_MAX_CHARS), time: e.time || null })
    }
  }
  let titre = ''
  try {
    const cats = JSON.parse(readFileSync(join(homedir(), '.dsh', 'kybernos', 'categories.json'), 'utf8'))
    if (cats[dshId] && typeof cats[dshId].titre === 'string') titre = cats[dshId].titre
  } catch { /* pas de renommage */ }
  return { ok: true, dsh_id: dshId, title: titre, messages, tronque: messages.length >= DSH_DETAIL_MAX_MESSAGES }
}

const ROUTES = [
  { path: '/kybernos-cloud/start', method: 'POST', guarded: true, run: startPairing },
  { path: '/kybernos-cloud/poll', method: 'POST', guarded: true, run: pollPairing },
  { path: '/kybernos-cloud/status', method: 'GET', guarded: false, run: statusRoute },
  { path: '/kybernos-cloud/space/active', method: 'POST', guarded: true, body: true, run: setActiveSpace },
  { path: '/kybernos-cloud/space/create', method: 'POST', guarded: true, body: true, run: createSpace },
  { path: '/kybernos-cloud/refresh', method: 'POST', guarded: true, run: refreshProfile },
  // `disconnect` révoque la session côté serveur : irréversible. Un POST nu
  // (constat de campagne : `curl -X POST /kybernos-cloud/disconnect`) suffisait à
  // la déclencher. Il faut désormais un corps EXPRÈS `{confirm:true}`.
  { path: '/kybernos-cloud/disconnect', method: 'POST', guarded: true, confirm: true, run: disconnect },
  // Catalogue LiteLLM importé : état détaillé + resynchronisation manuelle.
  // Catalogue de kybers publies sur kybernos.app (lecture seule, aucun jeton
  // requis pour la route locale : la liaison est verifiee cote plugin).
  { path: '/kybernos-cloud/marketplace', method: 'GET', guarded: false, run: marketplaceRoute },
  { path: '/kybernos-cloud/marketplace/install', method: 'POST', guarded: true, body: true, cap: 32768, run: marketplaceInstallRoute },
  { path: '/kybernos-cloud/models', method: 'GET', guarded: false, run: modelsRoute },
  { path: '/kybernos-cloud/models/sync', method: 'POST', guarded: true, run: modelsSyncRoute },
  // Code de parrainage du compte lié (carte d'invitation du pied de sidebar) :
  // la carte est servie par la même origine, donc `guarded` — un onglet tiers
  // n'a pas à lire le code du compte.
  { path: '/kybernos-cloud/referral', method: 'GET', guarded: true, run: referralRoute },
  // Artefacts (phase A). `body: true` → le corps JSON est lu (borné par `cap`)
  // et passé au handler ; le contenu peut être un livrable entier en base64.
  { path: '/kybernos-cloud/artifacts', method: 'GET', guarded: true, run: artifactList },
  { path: '/kybernos-cloud/artifacts/push', method: 'POST', guarded: true, body: true, cap: ARTIFACT_CONTENT_MAX + 131072, run: artifactPush },
  { path: '/kybernos-cloud/artifacts/detail', method: 'POST', guarded: true, body: true, run: artifactDetail },
  // Chats DSH → webapp : pousse l'ANNUAIRE des sessions locales (métadonnées
  // seulement) vers /v1/dsh/sessions ; GET = état du dernier push.
  // Détail d'un chat DSH : contenu complet lu SUR PLACE, servi uniquement aux
  // origines webapp locales (CORS ciblé + guarded:false — le sameOrigin
  // standard refuserait la webapp de dev sur :8081).
  { path: '/kybernos-cloud/chats/detail', method: 'GET', guarded: false, cors: true, run: chatsDetail },
  { path: '/kybernos-cloud/chats', method: 'GET', guarded: true, run: chatsStatusRoute },
  { path: '/kybernos-cloud/chats/push', method: 'POST', guarded: true, run: chatsPushRoute },
  // Partage d'un artefact ou d'un chat (core.shares). Trois chemins distincts.
  // Chat local → session hébergée (prérequis du partage d'un chat).
  { path: '/kybernos-cloud/chat/ensure', method: 'POST', guarded: true, body: true, cap: 4194304, run: chatEnsure },
  { path: '/kybernos-cloud/shares', method: 'GET', guarded: true, run: shareGet },
  { path: '/kybernos-cloud/shares/set', method: 'POST', guarded: true, body: true, run: shareSet },
  { path: '/kybernos-cloud/shares/revoke', method: 'POST', guarded: true, body: true, run: shareRevoke },
  // Membres d'un espace : lecture réelle ; invitation et retrait renvoient
  // {ok:false,error:'indisponible'} tant que le serveur les réserve à la master key.
  { path: '/kybernos-cloud/members', method: 'GET', guarded: true, run: membersGet },
  { path: '/kybernos-cloud/members/invite', method: 'POST', guarded: true, body: true, cap: 8192, run: membersInvite },
  { path: '/kybernos-cloud/members/remove', method: 'POST', guarded: true, body: true, cap: 8192, run: membersRemove },
  // Mémoire du compte (fonctionnalité cloud n°2) : lecture, écriture, recherche,
  // correspondance kybers locaux ↔ cloud, et poussée des leçons.
  // Chaque chemin est DISTINCT (le routeur indexe par chemin : deux routes sur
  // `/memory` se masqueraient l'une l'autre — constaté par le test host).
  { path: '/kybernos-cloud/memory', method: 'GET', guarded: true, run: memoryRoute },
  { path: '/kybernos-cloud/memory/add', method: 'POST', guarded: true, body: true, run: memoryCreateRoute },
  { path: '/kybernos-cloud/memory/update', method: 'POST', guarded: true, body: true, run: memoryUpdateRoute },
  { path: '/kybernos-cloud/memory/delete', method: 'POST', guarded: true, body: true, run: memoryDeleteRoute },
  { path: '/kybernos-cloud/memory/search', method: 'GET', guarded: true, run: memorySearchRoute },
  { path: '/kybernos-cloud/memory/map', method: 'POST', guarded: true, body: true, run: memoryMapRoute },
  // `dryRun` par défaut : la poussée des leçons écrit dans le compte, elle ne
  // part jamais sans un corps qui dit explicitement `{"dryRun":false}`.
  { path: '/kybernos-cloud/memory/lessons', method: 'POST', guarded: true, body: true, run: memoryLessonsRoute },
  // Page « Memory & Lessons learned » : liste paginée/filtrée et réglages. Chemins
  // distincts (GET et POST ne peuvent pas partager un chemin).
  { path: '/kybernos-cloud/memory/list', method: 'GET', guarded: true, run: memoryListRoute },
  { path: '/kybernos-cloud/memory/settings', method: 'GET', guarded: true, run: memorySettingsRoute },
  { path: '/kybernos-cloud/memory/settings/set', method: 'POST', guarded: true, body: true, run: memorySettingsSetRoute },
  // Search by meaning (off by default): status, then one indexing batch per POST — each batch calls the embeddings route.
  { path: '/kybernos-cloud/memory/index', method: 'GET', guarded: true, run: memoryIndexStatusRoute },
  { path: '/kybernos-cloud/memory/index/run', method: 'POST', guarded: true, body: true, cap: 4096, run: memoryIndexRunRoute },
]

const mountWebRoutes = (ctx, webServer) => {
  for (const route of ROUTES) {
    const handler = async (req, res) => {
      if (route.cors === true) {
        // CORS ciblé : uniquement les origines webapp de dev connues — jamais
        // « * » (le contenu des conversations est local et privé).
        const origin = String((req.headers && req.headers.origin) || '')
        const autorise = DSH_CORS_ORIGINS.includes(origin)
        res.setHeader('Access-Control-Allow-Origin', autorise ? origin : 'null')
        res.setHeader('Vary', 'Origin')
        if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
      }
      if (req.method !== route.method) return sendJson(res, 405, { ok: false, error: route.method + ' attendu' })
      if (route.guarded === true && sameOrigin(req) === false) return sendJson(res, 403, { ok: false, error: 'origine refusee' })
      if (route.confirm === true) {
        const body = await readJsonBody(req)
        if (body.confirm !== true) return sendJson(res, 400, { ok: false, error: 'confirmation requise : POST avec {"confirm":true}' })
      }
      try {
        // `body: true` → corps JSON lu ici (borné par `cap`) et passé au
        // handler avec la requête ; les autres handlers ignorent ces arguments.
        const body = route.body === true ? await readJsonBody(req, route.cap) : null
        sendJson(res, 200, await route.run(req, body))
      } catch (e) {
        console.error('[kybernos-cloud] ' + route.path + ': ' + String((e && e.message) || e))
        sendJson(res, 500, { ok: false, error: 'erreur interne' })
      }
    }
    ctx.effect(() => webServer.register({ kind: 'exact', path: route.path, handler }), 'kybernos-cloud: route ' + route.path)
  }
  console.log('[kybernos-cloud] routes /kybernos-cloud/* enregistrees (start, poll, status, refresh, disconnect, models, models/sync, referral, artifacts, memory/*)')
}

export function apply(ctx) {
  hostCtx = ctx
  if (ctx.get('webServer') !== undefined) mountWebRoutes(ctx, ctx.get('webServer'))
  else ctx.inject(['webServer'], (hostCtx) => mountWebRoutes(ctx, hostCtx.webServer))
  // Mémoire : le chunk dans le prompt, les deux outils, la capture de fin de
  // tour. Chaque montage est indépendant et tolère l'absence de son service.
  try { mountMemoryPrompt(ctx) } catch (e) { console.error('[kybernos-cloud] prompt mémoire: ' + String((e && e.message) || e)) }
  try { mountMemoryTools(ctx) } catch (e) { console.error('[kybernos-cloud] outils mémoire: ' + String((e && e.message) || e)) }
  try { mountMemoryCapture(ctx) } catch (e) { console.error('[kybernos-cloud] capture mémoire: ' + String((e && e.message) || e)) }
  try { mountMemoryRefresh(ctx) } catch (e) { console.error('[kybernos-cloud] rafraîchissement mémoire: ' + String((e && e.message) || e)) }
  autoImportAtBoot(ctx)
}

// Exportés pour le test hors-DSH (scripts/test-cloud-host.mjs) : aucune autre
// surface publique n'est promise.
export {
  resolveApi, stateFile, deviceLabel, publicState, ROUTES, importCatalog, CRED_REF, PROVIDER_ID,
  // Mémoire — exportés pour la suite host (faux serveur, aucune vraie API).
  asMemory, validateMemory, createMemory, patchMemory, deleteMemory, searchMemories,
  sanitizeMemory, sortMemories, renderMemoryChunk, renderMemoryPrompt, MEMORY_MARKER, MEMORY_OFF_MARKER,
  embedTexts, putEmbedding, meaningStatus, indexMemories, findByMeaning, meaningCache, EMBED_DIM, EMBED_MODEL,
  refreshMemoryCache, memoryCache,
  emptyMemoryCache, bumpMemoryCache, pushLessons, localLessons, localKybers, stateKyberMap,
  listMemories, lastTurnText, memoryWriteTool, memorySearchTool, MEMORY_KINDS, MEMORY_SOURCES,
  captureTurn, lastCapture, extractFacts, stripMemoryBlock, normalizeMemory,
  MEMORY_MAX_CONTENT, MEMORY_MAX_INJECT_CHARS, MEMORY_TUNING,
  selectForPrompt, planInjection, readMemorySettings, noteOrigins, originOf, scheduleMemoryRefresh, parseWhen,
}
