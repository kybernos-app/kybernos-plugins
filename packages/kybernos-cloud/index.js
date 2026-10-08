// ── Kybernos Cloud — appairage par code d'appareil + profil + catalogue (half host) ─
//
// Ce half fait trois choses :
//   1. parler à l'API Kybernos (https://api.dev.kybernos.app par défaut) ;
//   2. garder le secret d'appareil HORS du navigateur et HORS du dépôt, dans
//      <DSH home>/kybernos-cloud.json (~/.dsh by default, mode 0600) ;
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
import { dirname, join, resolve } from 'node:path'
import { lireCatalogue, resoudreItem, slugSur, ymlDuKyber, verdictInstallation } from './marketplace-kyber.mjs'
import { rank as rankByRelevance } from './relevance.mjs'
import { findDuplicateGroups, unclearPairs } from './dedupe.mjs'
import { MAP_TUNING, textHash, packVector, unpackVector, buildMap } from './mapproj.mjs'
import { TEAM_CHUNK_NAME, TEAM_CHUNK_ORDER, TEAM_TUNING, teamWorkspace, displayName, asTeamLesson, teamFailure, teamPlan, renderTeamChunk, applicable } from './team-lessons.mjs'
import { teamSkillsBase, isSkillId, teamSkillsFailure, asTeamSkill } from './team-skills.mjs'
import { createConnections } from './connections-host.mjs'
import { normalizeTidySettings, patchTidySettings, tidyDue, tidyNext, pickAuto, removalChunks, readStudyModel, brainGroups } from './tidy.mjs'
import { zstdDecompressSync } from 'node:zlib'
import { activeServer, stateFileName, llmBase, publicProfile } from './server-profile.mjs'

/**
 * The DSH home, resolved the way DSH does (@deepseek-ai/dsh-home-paths): a non-blank
 * $DSH_HOME (trimmed, a leading ~ expanded), else <os home>/.dsh. Resolved at each use,
 * never cached: with DSH_HOME set (a second profile, an isolated instance, CI) every path
 * below must stay inside it and leave the user's real ~/.dsh alone.
 */
const dshHome = (env = process.env, osHome = homedir) => {
  const raw = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  if (raw === '') return join(osHome(), '.dsh')
  if (raw === '~') return osHome()
  return resolve(raw.startsWith('~/') || raw.startsWith('~\\') ? join(osHome(), raw.slice(2)) : raw)
}
const serversFile = () => {
  const raw = typeof process.env.KYBERNOS_SERVERS_FILE === 'string' ? process.env.KYBERNOS_SERVERS_FILE.trim() : ''
  return raw === '' ? join(dshHome(), 'kybernos', 'servers.json') : raw
}
/** The server this DSH talks to (server-profile.mjs): read at each use, like the state, so a registry written by the
 *  Select server module is seen without a restart. */
const server = () => activeServer({ env: process.env, registryFile: serversFile() })
const defaultStateFile = (profile = server().profile) => join(dshHome(), stateFileName(profile))
const appliedFile = () => join(dshHome(), 'kybernos', 'server-applied.json')
const sessionsHome = () => join(dshHome(), 'sessions')
const categoriesFile = () => join(dshHome(), 'kybernos', 'categories.json')
const CLIENT_VERSION = '0.1.0'
const CLIENT_NAME = 'dsh'
const REQUEST_TIMEOUT_MS = 15000
const MAX_LABEL = 64

/** Base d'API du serveur actif (Kybernos Cloud par défaut ; KYBERNOS_CLOUD_API ou le registre des serveurs la remplacent). */
const resolveApi = () => server().profile.api
/** Web du serveur actif : c'est là que vit la page de l'espace. */
const resolveWeb = () => server().profile.web

/** State file: <DSH home>/kybernos-cloud.json for the built-in server, kybernos-cloud-<id>.json for another one (each server
 *  keeps its own connection), overridable by KYBERNOS_CLOUD_STATE (tests, multi-profile). */
const stateFile = (profile) => {
  const raw = process.env.KYBERNOS_CLOUD_STATE
  const value = typeof raw === 'string' ? raw.trim() : ''
  return value === '' ? defaultStateFile(profile) : value
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
  // The folder of the file actually written: with KYBERNOS_CLOUD_STATE set, creating the default folder would touch ~/.dsh for nothing.
  try { mkdirSync(dirname(file), { recursive: true, mode: 0o700 }) } catch (e) { /* already there */ }
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
  ...(spacePlanView(state) !== null ? { space_plan: spacePlanView(state) } : {}),
  web_url: resolveWeb(),
  server: { id: server().profile.id, name: server().profile.name },
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

/** The plan of ONE space, as the server's `/plan` of that space answers it. The profile's `plan` (/v1/me) is the ACCOUNT's word and says « team »
 *  as soon as the person is in any team; the footer, the menu and the team features belong to the ACTIVE space, so they read this instead.
 *  Never throws and never disconnects: a server that does not answer leaves the account-level word as the fallback. */
const readSpacePlan = async (state, id) => {
  if (typeof id !== 'string' || id === '' || isConnected(state) !== true) return null
  const res = await apiCall('/v1/workspaces/' + encodeURIComponent(id) + '/plan', { token: state.token })
  if (res.status !== 200 || res.body === null || typeof res.body !== 'object') return null
  const b = res.body
  const plan = b.plan !== null && typeof b.plan === 'object' ? b.plan : null
  const key = plan !== null && typeof plan.key === 'string' && plan.key !== '' ? plan.key : 'none'
  const name = plan !== null && typeof plan.name === 'string' && plan.name !== '' ? plan.name : null
  const level = typeof b.level === 'string' && b.level !== '' ? b.level : null
  // « Solo Studio »: for an individual plan the level is part of what the person bought (Solo, at the Studio level). A team plan's level is a
  // price band (« 1-5 seats »), not a name, and « Free » / « Free » is just « Free ».
  const kind = plan !== null && typeof plan.kind === 'string' ? plan.kind : null
  const label = name === null ? null : (kind === 'individual' && level !== null && level.toLowerCase() !== name.toLowerCase() ? name + ' ' + level : name)
  const credits = Number(b.credit_balance_credits)
  return { workspace_id: id, key, name, level, label, status: typeof b.status === 'string' ? b.status : null,
    credit_balance_credits: Number.isFinite(credits) ? credits : null }
}

/** What the page may know of it: only when it was read for the space that is active NOW. */
const spacePlanView = (state) => {
  const sp = state !== null && state !== undefined && state.space_plan !== null && typeof state.space_plan === 'object' ? state.space_plan : null
  return sp !== null && sp.workspace_id === espaceActif(state) ? sp : null
}

/** Route : choisir l'espace actif. Fail-closed — un id inconnu est REFUSÉ et
 *  jamais écrit : un espace qu'on ne voit pas ne devient pas actif. */
const setActiveSpace = async (req, body) => {
  const state = readState()
  if (!isConnected(state)) return { ok: false, error: 'non_connecte' }
  const voulu = body !== null && typeof body === 'object' && typeof body.workspace_id === 'string' ? body.workspace_id : ''
  if (voulu === '') return { ok: false, error: 'espace_absent' }
  const espaces = Array.isArray(state.workspaces) ? state.workspaces : []
  if (espaces.some((w) => w !== null && w.id === voulu) !== true) return { ok: false, error: 'espace_inconnu' }
  const next = Object.assign({}, state, { active_workspace_id: voulu, space_plan: await readSpacePlan(state, voulu) })
  writeState(next)
  return { ok: true, state: publicState(next) }
}

/** Route : créer un espace. Le serveur hébergé reste maître — on transmet le
 *  nom à POST /v1/workspaces ; en cas de refus (route absente, plan limité,
 *  permission manquante) on ne fabrique RIEN localement : on rend l'URL de
 *  l'app pour que la création se fasse là où elle est réellement décidée. */
const createSpace = async (req, body) => {
  const state = readState()
  if (!isConnected(state)) return { ok: false, error: 'non_connecte', web_url: resolveWeb() }
  const nom = body !== null && typeof body === 'object' && typeof body.name === 'string' ? body.name.trim().slice(0, 60) : ''
  if (nom === '') return { ok: false, error: 'nom_absent' }
  const res = await apiCall('/v1/workspaces', { method: 'POST', token: state.token, body: { name: nom } })
  if (res.status !== 200 && res.status !== 201) {
    return { ok: false, error: 'creation_refusee', status: res.status, web_url: resolveWeb() }
  }
  const brut = res.body !== null && typeof res.body === 'object' ? (res.body.workspace !== undefined && res.body.workspace !== null ? res.body.workspace : res.body) : null
  const id = brut !== null && typeof brut.id === 'string' ? brut.id : null
  // A success that does not describe the space (an empty body, a page) did not create one: nothing is written.
  if (id === null) return { ok: false, error: 'creation_refusee', status: res.status, web_url: resolveWeb() }
  const espaces = Array.isArray(state.workspaces) ? state.workspaces.slice() : []
  if (id !== null && espaces.some((w) => w !== null && w.id === id) !== true) espaces.push(brut)
  const next = Object.assign({}, state, { workspaces: espaces, active_workspace_id: id !== null ? id : state.active_workspace_id })
  next.space_plan = await readSpacePlan(state, espaceActif(next))
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

/** The most an answer of the server may weigh. The biggest legitimate one is an artifact (8 MiB of content, base64: ~11 MiB). Without
 *  a cap the whole body is held, then parsed: a 400 MB answer (a faulty endpoint, a proxy page) took DSH down for every session. */
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024

/** The body of a response as text, never holding more than `max` bytes. `tooLarge` (the stream is cancelled, the socket dropped), or
 *  `error` when the body could not be read to its end (cut connection, timeout): a half answer is not an answer. */
const readBoundedText = async (res, max) => {
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > max) {
    try { await res.body.cancel() } catch (e) { /* already closed */ }
    return { tooLarge: true }
  }
  if (res.body === null) return { text: '' }
  const reader = res.body.getReader()
  const chunks = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > max) {
        await reader.cancel().catch(() => {})
        return { tooLarge: true }
      }
      chunks.push(value)
    }
  } catch (e) {
    return { error: String((e && e.message) || e) }
  }
  return { text: Buffer.concat(chunks).toString('utf8') }
}

/** Appel API : ne throw jamais, renvoie { status, body } (status 0 = réseau).
 *  Le serveur est une API JSON, pas un site : une redirection n'est jamais suivie (elle emporterait le corps de la requête vers un
 *  autre hôte et la réponse de cet hôte passerait pour celle du serveur), une réponse trop grosse ou coupée est un échec réseau,
 *  et un statut de succès avec un corps qui n'est pas du JSON (la page d'un portail captif) n'est pas un succès. */
const apiCall = async (path, options = {}) => {
  const method = typeof options.method === 'string' ? options.method : 'GET'
  const token = typeof options.token === 'string' ? options.token : null
  const body = options.body !== undefined && options.body !== null ? options.body : null
  const ctrl = new AbortController()
  // A longer wait only for what is known to take longer (an action of a connected app: up to 30 s at the server).
  const timer = setTimeout(() => ctrl.abort(), Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : REQUEST_TIMEOUT_MS)
  try {
    const headers = { 'content-type': 'application/json' }
    if (token !== null) headers.authorization = 'Bearer ' + token
    const res = await fetch((typeof options.base === 'string' ? options.base : resolveApi()) + path, {
      method,
      headers,
      signal: ctrl.signal,
      redirect: 'manual',
      body: body === null ? undefined : JSON.stringify(body),
    })
    if (res.status >= 300 && res.status < 400) {
      try { await res.body.cancel() } catch (e) { /* nothing to cancel */ }
      return { status: 0, body: null, error: 'redirect_refused' }
    }
    const got = await readBoundedText(res, Number.isFinite(options.maxBytes) && options.maxBytes > 0 ? options.maxBytes : MAX_RESPONSE_BYTES)
    if (got.tooLarge === true) return { status: 0, body: null, error: 'response_too_large' }
    if (got.error !== undefined) return { status: 0, body: null, error: got.error }
    let parsed = null
    let readable = true
    try { parsed = JSON.parse(got.text) } catch (e) { parsed = null; readable = got.text.trim() === '' }
    if (readable !== true && res.status >= 200 && res.status < 300) return { status: 0, body: null, error: 'invalid_response' }
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
  // Only the server's own verdict ends a pairing. A rate limit, a 5xx, a proxy page or a reply without a status says nothing about
  // the request: the pairing stays (it expires by itself), and the page tries again. Forgetting it here also lost a claim whose
  // answer had not come through.
  if (res.status === 429) return { ok: false, error: 'trop_de_demandes', status: 429 }
  const verdicts = ['pending', 'claimed', 'denied', 'expired']
  if (res.status !== 200 || res.body === null || typeof res.body !== 'object' || verdicts.indexOf(res.body.status) < 0) return { ok: false, error: 'reponse_illisible', status: res.status }
  const status = res.body.status
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
  // Anything but the list itself (a portal's page, an empty body, another shape) keeps the list the person has: only the server's own
  // `{ workspaces: [] }` empties it.
  if (ws.status !== 200 || ws.body === null || typeof ws.body !== 'object' || Array.isArray(ws.body.workspaces) !== true) return { ok: false, error: 'profil_indisponible', status: ws.status }
  const workspaces = ws.body.workspaces
  // /v1/me absent (serveur plus ancien : 404), cassé (401/403) ou en panne :
  // on garde le user en cache et on ne casse PAS le rafraîchissement. L'email
  // n'est jamais écrasé — il ne vient que du claim (l'identité /v1/* ne le
  // porte pas).
  const profile = me.status === 200 && me.body !== null && typeof me.body === 'object' ? me.body : null
  const user = mergeUser(state.user, profile)
  const next = Object.assign({}, state, { user, workspaces, refreshed_at: new Date().toISOString() })
  // The plan of the active space; a read that fails keeps the one already known for the SAME space, never another's.
  const activeId = espaceActif(next)
  const spacePlan = await readSpacePlan(state, activeId)
  next.space_plan = spacePlan !== null ? spacePlan : (state.space_plan !== undefined && state.space_plan !== null && state.space_plan.workspace_id === activeId ? state.space_plan : null)
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
  const profile = server().profile
  // The profile names its LLM service when it has a separate one (DSH never deduces it from the account address); a server
  // with no LLM has no base at all, and importCatalog() does not reach this.
  if (typeof profile.services.llm === 'string') return llmBase(profile)
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
  const shown = info !== null && typeof info === 'object' && typeof info.display_name === 'string' && info.display_name.trim() !== '' ? info.display_name.trim() : null
  const entry = { id, name: shown !== null ? shown : humanizeModelName(id) }
  if (info !== null && typeof info === 'object' && Array.isArray(info) === false) {
    const context = intOf(info.context_length, info.max_input_tokens, info.max_model_len)
    const output = intOf(info.max_output_tokens, info.max_tokens)
    if (context !== null) entry.contextWindow = context
    if (output !== null) entry.maxTokens = output
  }
  return entry
}

/** The catalogue of a Kybernos server built on vanilla provider models (`GET /v1/models` answers entries with a `kind`): every chat model is
 *  offered, named as the server names it; the embeddings model is remembered apart (it is not a chat route). The old role routes
 *  (`kybernos/*` twins, `_rg` pools, raw backend ids) are told apart by having no `kind`: they keep the filter below. */
const isServerCatalog = (entries) => entries.length > 0 && entries.every((e) => typeof e.kind === 'string')

const serverCatalog = (entries) => {
  const chat = []
  let embed = null
  for (const entry of entries) {
    if (entry.kind === 'chat') chat.push(entry)
    else if (entry.kind === 'embeddings' && embed === null) embed = entry.id
  }
  return { models: chat.map((e) => modelEntry(e.id, e)), embed }
}

/** Formes acceptées : `{data: [{id, …}]}` (LiteLLM natif, ou serveur Kybernos avec `kind`) ou `{models: {id: …}}`
 *  (variante enrichie). Rien d'autre = illisible. Rend `{models, embed}` : `embed` est l'id du modèle d'embeddings, ou null. */
const parseCatalogIds = (body) => {
  if (body === null || typeof body !== 'object') return null
  if (Array.isArray(body.data) === true) {
    const entries = body.data.filter((entry) => entry !== null && typeof entry === 'object' && typeof entry.id === 'string')
    if (isServerCatalog(entries) === true) return serverCatalog(entries)
    const infos = new Map()
    const ids = []
    for (const entry of entries) {
      ids.push(entry.id)
      infos.set(entry.id, entry)
    }
    const kept = keepChatModels(ids)
    return { models: kept.map((id) => modelEntry(id, infos.get(id))), embed: null }
  }
  if (body.models !== null && typeof body.models === 'object' && Array.isArray(body.models) === false) {
    return { models: keepChatModels(Object.keys(body.models)).map((id) => modelEntry(id, body.models[id])), embed: null }
  }
  return null
}

const fetchCatalog = async (state) => {
  // The catalogue is read where the route will point: the profile's LLM service when it has one, else the account API.
  const llm = server().profile.services.llm
  const res = await apiCall('/v1/models', { token: state.token, base: typeof llm === 'string' ? llm : undefined })
  if (res.status === 401 || res.status === 403) return { ok: false, error: 'catalogue_refuse', status: res.status }
  if (res.status !== 200 || res.body === null) {
    return { ok: false, error: res.status === 0 ? 'reseau' : 'catalogue_indisponible', status: res.status }
  }
  const parsed = parseCatalogIds(res.body)
  if (parsed === null) return { ok: false, error: 'catalogue_illisible', status: res.status }
  return { ok: true, models: parsed.models, embed: parsed.embed }
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
const catalogFingerprint = (state, entries, plan, embed) => JSON.stringify([
  baseUrl(state),
  plan,
  entries.map((e) => e.id).slice().sort(),
  embed === undefined || embed === null ? null : embed,
])

/** Import (ou rafraîchissement) : catalogue → settings → credential → état.
 *  Ne throw jamais : chaque échec est un motif explicite dans la réponse. */
const importCatalog = async (cause, options = {}) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: true, connected: false, status: 'none' }
  if (server().profile.services.llm === false) {
    const gone = await removeImportedCatalog(state)
    if (gone.removed === true) { const next = Object.assign({}, state); delete next.models; writeState(next) }
    return { ok: true, connected: true, no_llm: true, summary: null }
  }
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
    && catalogFingerprint(state, known.ids.map((id) => ({ id })), plan, known.embed) === catalogFingerprint(state, cat.models, plan, cat.embed)) {
    if (appliedServerId() === null) markApplied()   // an install from before servers existed: this route is the active server's
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
    embed: cat.embed,
    provider: PROVIDER_ID,
    base_url: baseUrl(state),
    settings: settingsOut.wrote === true,
    credential: credentialStored,
    reason: settingsOut.wrote === true ? null : (settingsOut.reason || 'settings_absent'),
  }
  writeState(Object.assign({}, state, { models }))
  if (settingsOut.wrote === true) markApplied()
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
    embed: typeof models.embed === 'string' ? models.embed : null,
    settings: models.settings === true,
    credential: models.credential === true,
    cause: models.cause !== undefined ? models.cause : null,
  }
}

/** Import au démarrage de DSH quand la session est déjà vivante : sans ça, un
 *  harnais relancé n'aurait les modèles qu'après une ouverture de carte. */
const autoImportAtBoot = (ctx) => {
  // The registry may have changed while DSH was down: then the previous server's route must go, connected or not.
  const changed = appliedServerId() !== null && appliedServerId() !== server().profile.id
  if (changed !== true && isConnected(readState()) !== true) return
  const kick = () => { void (changed === true ? serverApply() : importCatalog('boot')).catch(() => {}) }
  if (ctx.get('settings') !== undefined && ctx.get('credentials') !== undefined) kick()
  else ctx.inject(['settings', 'credentials'], kick)
}

/** Which server owns the « kybernos » model route now: the one whose catalogue was imported last. */
const markApplied = () => {
  try {
    mkdirSync(dirname(appliedFile()), { recursive: true, mode: 0o700 })
    writeFileSync(appliedFile(), JSON.stringify({ id: server().profile.id, at: new Date().toISOString() }) + '\n', { mode: 0o600 })
  } catch (e) { /* the marker is a convenience: the next apply just cleans nothing */ }
}

const appliedServerId = () => {
  try {
    const marker = JSON.parse(readFileSync(appliedFile(), 'utf8'))
    return marker !== null && typeof marker === 'object' && typeof marker.id === 'string' ? marker.id : null
  } catch (e) { return null }
}

/** GET /kybernos-cloud/server: the active server and the others the registry names. Nothing secret lives in a profile. */
const serverRoute = async () => {
  const active = server()
  // `connected`: this DSH holds a sign-in for that server (its own connection file), never anything of the token itself.
  // The active server's own file is whatever stateFile() says (KYBERNOS_CLOUD_STATE included); the others have the usual name.
  const connectedTo = (id) => {
    if (id === active.profile.id) return isConnected(readState())
    try { return isConnected(JSON.parse(readFileSync(join(dshHome(), stateFileName({ id })), 'utf8'))) } catch (e) { return false }
  }
  return { ok: true, server: publicProfile(active.profile), source: active.source, error: active.error, servers: active.servers.map((x) => Object.assign({ active: x.id === active.profile.id, connected: connectedTo(x.id) }, x)), rejected: active.rejected }
}

/** POST /kybernos-cloud/server/apply: the registry changed (the Select server module wrote it): make DSH follow. What the
 *  previous server left (the « kybernos » model route and its credential) is removed FIRST, so chat never keeps talking to a
 *  server the user left; then the new server's catalogue is imported if this DSH is connected to it. Idempotent. */
const serverApply = async () => {
  const active = server()
  const previousId = appliedServerId()
  let cleaned = false
  if (previousId !== null && previousId !== active.profile.id) {
    try {
      const before = JSON.parse(readFileSync(join(dshHome(), stateFileName({ id: previousId })), 'utf8'))
      cleaned = (await removeImportedCatalog(before)).removed === true
    } catch (e) { /* no connection file for it: nothing was imported */ }
  }
  markApplied()
  connections.sync()
  const out = { ok: true, server: publicProfile(active.profile), source: active.source, error: active.error, cleaned, connected: isConnected(readState()) }
  if (out.connected === true) {
    const imported = await importCatalog('server', { force: true })
    out.models = imported.summary !== undefined ? imported.summary : null
    if (imported.no_llm === true) out.no_llm = true
    if (imported.ok !== true) out.import_error = imported.error
  }
  return out
}

const modelsRoute = async () => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: true, connected: false, status: 'none' }
  return { ok: true, connected: true, plan: userPlan(state), models: publicModels(state.models) }
}

/** One page of the remote catalogue (`before`: the id of the last item of the previous page; null for the first page). */
const marketplacePage = (state) => (before) => apiCall('/v1/marketplace' + (before === null ? '' : '?before=' + encodeURIComponent(before)), { token: state.token })

/**
 * The remote catalogue: what kybernos.app publishes, as it is.
 * Not linked -> an explicit `motif`; server unreachable -> a `motif` with the HTTP code.
 * It NEVER falls back on a local fixture passed off as the remote catalogue: that is exactly the lie this module replaces.
 *
 * The server pages the catalogue (200 at a time, `has_more`): every page is read (marketplace-kyber.mjs, `lireCatalogue`,
 * with hard limits). When a later page cannot be read the answer is still `ok` with the pages read, `partiel: true` and
 * a `motif` that says what is missing: the panel shows the first pages with a note, never an empty catalogue.
 */
const marketplaceRoute = async () => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, items: [], motif: 'aucun compte lie a kybernos.app' }
  const cat = await lireCatalogue(marketplacePage(state))
  if (cat.echec === true) return { ok: false, connected: true, items: [], motif: cat.motif }
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

/** Strict variant for a route that hands out the account's data with its token: a request that names no origin at all is
 *  refused (any local process can omit a header; a browser page always sends Origin or Referer), and the origin must be
 *  this server's own address, taken from the socket and not from the client-supplied Host header. */
const sameOriginStrict = (req) => {
  try {
    const headers = req !== null && req !== undefined && req.headers !== null && req.headers !== undefined ? req.headers : {}
    const source = typeof headers.origin === 'string' && headers.origin !== '' ? headers.origin : (typeof headers.referer === 'string' && headers.referer !== '' ? headers.referer : null)
    if (source === null) return false
    const u = new URL(source)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const sock = req.socket !== null && req.socket !== undefined ? req.socket : null
    const port = sock !== null && typeof sock.localPort === 'number' ? ':' + sock.localPort : ''
    return ['127.0.0.1' + port, 'localhost' + port, '[::1]' + port].indexOf(u.host) >= 0
  } catch (e) { return false }
}

// ── Relay for the Team settings console (read only, phase 1) ───────────────────
// The console is a page of another origin shown in an iframe: it must never hold a session token. It asks its parent page,
// the parent calls THIS route, and this route adds the token and calls the main API: only on the allowlist below, only GET,
// only for a workspace of this account. The server checks the caller's role again (docs/specs/2026-10-05-team-console-wiring.md).
const UUID_SRC = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const RELAY_DATE = /^\d{4}-\d{2}-\d{2}([T ][0-9:.]{1,16}(Z|[+-]\d{2}:?\d{2})?)?$/
const RELAY_RULES = [
  { re: /^\/v1\/me$/, query: [] },
  { re: /^\/v1\/workspaces$/, query: [] },
  { re: new RegExp('^/v1/workspaces/(' + UUID_SRC + ')/(members|providers|models)$', 'i'), query: [] },
  { re: new RegExp('^/v1/workspaces/(' + UUID_SRC + ')/llm/(budget|models|catalog|billing)$', 'i'), query: [] },
  // `group_by` is one of the server's four groupings (the team console asks for `detail`: one row per day, member and model).
  { re: new RegExp('^/v1/workspaces/(' + UUID_SRC + ')/llm/usage$', 'i'), query: ['from', 'to', 'group_by'], choices: { group_by: ['model', 'day', 'member', 'detail'] } },
]

/** `{ ok, path }` (the canonical path to call) or `{ ok: false, error }`. Pure: a path the allowlist does not name, a
 *  workspace that is not one of the account's, a query parameter other than a date `from` / `to` (or a known `group_by` on usage), is refused. */
const relayCheck = (target, state) => {
  const refused = { ok: false, error: 'chemin refuse' }
  if (typeof target !== 'string' || target.length === 0 || target.length > 300 || target[0] !== '/') return refused
  let u = null
  try { u = new URL(target, 'http://relay.invalid') } catch (e) { return refused }
  // A path the URL parser rewrites (dot segments, doubled slashes, an encoded trick) is not the path we were asked for.
  if (u.origin !== 'http://relay.invalid' || u.pathname !== target.split('?')[0]) return refused
  const rule = RELAY_RULES.find((r) => r.re.test(u.pathname))
  if (rule === undefined) return refused
  const seen = new Set()
  const query = []
  for (const [k, v] of u.searchParams) {
    if (rule.query.indexOf(k) < 0 || seen.has(k)) return refused
    const choices = rule.choices !== undefined ? rule.choices[k] : undefined
    if (choices !== undefined ? choices.indexOf(v) < 0 : RELAY_DATE.test(v) !== true) return refused
    seen.add(k)
    query.push(k + '=' + encodeURIComponent(v))
  }
  const m = u.pathname.match(new RegExp('^/v1/workspaces/(' + UUID_SRC + ')/', 'i'))
  if (m !== null) {
    const known = (state !== null && state !== undefined && Array.isArray(state.workspaces) ? state.workspaces : [])
    if (known.some((w) => w !== null && typeof w === 'object' && String(w.id).toLowerCase() === m[1].toLowerCase()) !== true) return { ok: false, error: 'espace_inconnu' }
  }
  return { ok: true, path: u.pathname + (query.length > 0 ? '?' + query.join('&') : '') }
}

const relayRoute = async (req) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, status: 'none', error: 'non connecte' }
  let target = ''
  try { target = new URL(req.url, 'http://localhost').searchParams.get('p') || '' } catch (e) { target = '' }
  const verdict = relayCheck(target, state)
  if (verdict.ok !== true) return { ok: false, error: verdict.error }
  const res = await apiCall(verdict.path, { token: state.token })
  return { ok: res.status >= 200 && res.status < 300, status: res.status, body: res.body }
}

// ── The team console in the user's browser (the new server, ADR 0005 § 5) ──────
// The console page is served by the server and, in a browser, uses the person's own session. DSH holds a device token and a token never goes through a
// browser: it asks the server for a single-use link (valid 60 seconds) and hands THAT to the browser. The link is a bearer capability, so it is only
// returned when it points at the server this account is connected to (a hostile or broken answer cannot send the browser elsewhere), and the route is strict
// (a page of another origin cannot ask DSH for it).
const consoleLink = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, status: 'none', error: 'non connecte' }
  const asked = body !== null && typeof body === 'object' && typeof body.workspace_id === 'string' ? body.workspace_id.trim().toLowerCase() : ''
  const known = Array.isArray(state.workspaces) ? state.workspaces : []
  const mine = (id) => known.some((w) => w !== null && typeof w === 'object' && String(w.id).toLowerCase() === id)
  if (asked !== '' && (new RegExp('^' + UUID_SRC + '$', 'i').test(asked) !== true || mine(asked) !== true)) return { ok: false, error: 'espace_inconnu' }
  const res = await apiCall('/v1/console/link', { method: 'POST', token: state.token, body: asked === '' ? {} : { workspace_id: asked } })
  if (res.status !== 200 || res.body === null || typeof res.body !== 'object') return { ok: false, status: res.status, error: res.status === 0 ? 'injoignable' : 'refuse' }
  let url = null
  try {
    const u = new URL(String(res.body.url))
    if ((u.protocol === 'https:' || u.protocol === 'http:') && u.origin === new URL(resolveApi()).origin) url = u.toString()
  } catch (e) { url = null }
  if (url === null) return { ok: false, status: res.status, error: 'lien_invalide' }
  return { ok: true, url, expires_in: typeof res.body.expires_in === 'number' ? res.body.expires_in : 60 }
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
// Pousse la LISTE des sessions locales (<DSH home>/sessions) vers
// POST /v1/dsh/sessions — MÉTADONNÉES SEULEMENT (id de session, projet, date,
// rien du contenu des conversations : les .jsonl.zstd ne sont jamais ouverts).
// La webapp lit la même liste (GET /v1/dsh/sessions) pour afficher
// « Conversations DSH ». Idempotent : le serveur upsert par (user, dsh_id).
const CHATS_PUSH_MAX = 100

const projetDuSlug = (slug) => {
  // « --Users-miled-dyad-apps-kybernos-- » → « kybernos » ; « ~0020 » = espace.
  const segments = String(slug || '').split('-').filter((s) => s !== '')
  const dernier = segments.length > 0 ? segments[segments.length - 1] : ''
  return dernier.split('~').join(' ').trim()
}

const chatsScan = () => {
  const items = []
  const sessions = sessionsHome()
  let slugs = []
  try {
    slugs = readdirSync(sessions)
  } catch (e) {
    return { items, error: 'sessions illisibles' }
  }
  // Titres réels des sessions renommées (<DSH home>/kybernos/categories.json,
  // tenu par le plugin kybernos-sessions) — repli : nom du projet du slug.
  let titres = {}
  try {
    titres = JSON.parse(readFileSync(categoriesFile(), 'utf8')) || {}
  } catch (e) { /* pas de renommages : projet du slug pour tous */ }
  const titreDe = (sessionId, projet) => {
    const t = titres[sessionId] && typeof titres[sessionId].titre === 'string' ? titres[sessionId].titre.trim() : ''
    return t !== '' ? t : (projet !== '' ? projet : 'Session DSH')
  }
  for (const slug of slugs) {
    let sessionDirs = []
    try {
      sessionDirs = readdirSync(join(sessions, slug))
    } catch (e) {
      continue
    }
    for (const dir of sessionDirs) {
      if (!dir.startsWith('session-')) continue
      const dossier = join(sessions, slug, dir)
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
const MEMORY_SETTING_KEYS = ['memories', 'context', 'capture', 'meaning', 'relevant', 'team_use', 'team_share']
// `meaning` (search by meaning) is OFF until the user turns it on: it sends the text of a memory to the
// embedding model of the Kybernos cloud, which nothing else in this plugin does outside a chat turn.
// `relevant` (pick the memories that match the current question, on top of the pinned and the newest) is ON: it is
// local, nothing goes anywhere extra, and the page lets the user turn it off.
// `team_use` (the agents also read the lessons the team approved) and `team_share` (« Propose to team » is offered) only mean something on a Team
// workspace; both are on by default there, and the page locks them with the reason everywhere else.
const MEMORY_SETTING_DEFAULTS = { memories: true, context: true, capture: true, meaning: false, relevant: true, team_use: true, team_share: true }
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

/** Root of the local kybers: <DSH home>/kybers, overridable so the host suite stays deterministic. */
const kybersDir = () => (typeof process.env.KYBERNOS_CLOUD_KYBERS === 'string' && process.env.KYBERNOS_CLOUD_KYBERS !== '' ? process.env.KYBERNOS_CLOUD_KYBERS : join(dshHome(), 'kybers'))

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

// ── The memories that matter to THIS question ───────────────────────────────
// The base selection (pinned, then the newest) cannot know what the user is asking: on a 640-memory account the one
// about Docker on this Mac is 9 days old and never goes. So the human's latest message of each session is kept here
// and ranked against the memories (relevance.mjs, local: nothing is sent anywhere), and the ones that clearly match
// are added to what goes to the model.
//
// Cost: the engine appends a new "runtime context" snapshot to the history whenever this text CHANGES (and keeps the
// older ones), so the pick is made to stay put: it is computed once per user message, kept while the topic is the same
// (overlap), and not changed again for a few turns. Never per step, never per tool call.
const RELEVANCE_TUNING = {
  maxTerms: 12,           // judge the question by its 12 rarest words that can match something
  minCoverage: 0.25,      // ≥ 2 words matched and a quarter of the question's rarity …
  strongCoverage: 0.5,    // … or 1 word that is half of it (a rare word: « tev1 »)
  relative: 0.5,          // and never less than this fraction of the best match's coverage (the tail of a long list is noise)
  maxPicked: 6,           // at most this many memories picked
  maxCandidates: 15,      // … and only when the question is SELECTIVE: if more than this many memories qualify, none stands out
  share: 0.4,             // … and at most this share of the memories budget
  keepOverlap: 0.6,       // a new pick that overlaps the last one this much changes nothing
  minTurnsBetweenChanges: 3,
  queryChars: 1200,
  sessions: 64,
}
const sessionQuery = new Map()   // sessionId -> { key, text, turn }
const sessionPick = new Map()    // sessionId -> { key, ids, turn }

const forgetOldest = (map) => { while (map.size > RELEVANCE_TUNING.sessions) map.delete(map.keys().next().value) }

/** The text of a HUMAN prompt (source.kind 'user'); injected context, file notices, skills and goal rounds are not a question. */
const userPromptText = (message) => {
  if (message === null || typeof message !== 'object') return ''
  const kind = message.source !== null && typeof message.source === 'object' ? message.source.kind : undefined
  if (kind !== 'user') return ''
  const blocks = Array.isArray(message.content) ? message.content : []
  return stripMemoryBlock(blocks.filter((b) => b !== null && typeof b === 'object' && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n')).trim()
}

const noteUserTurn = (sessionId, message, turn) => {
  try {
    const text = userPromptText(message)
    if (typeof sessionId !== 'string' || sessionId === '' || text === '') return
    const cut = text.slice(0, RELEVANCE_TUNING.queryChars)
    sessionQuery.delete(sessionId)
    sessionQuery.set(sessionId, { key: String(Number.isFinite(turn) ? turn : 0) + ':' + String(text.length) + ':' + cut.slice(0, 40), text: cut, turn: Number.isFinite(turn) ? turn : 0 })
    forgetOldest(sessionQuery)
  } catch (e) { /* never break a turn */ }
}

const overlapOf = (a, b) => {
  if (a.length === 0 && b.length === 0) return 1
  const set = new Set(a)
  let both = 0
  for (const id of b) if (set.has(id)) both += 1
  return both / (a.length + b.length - both)
}

/** The memories of `candidates` that match this session's latest question, best first; [] when nothing clearly does. */
const pickRelevant = (sessionId, candidates, picks = sessionPick, tuning = RELEVANCE_TUNING) => {
  const q = sessionQuery.get(sessionId)
  if (q === undefined) return []
  const byId = new Map(candidates.map((m) => [String(m.id), m]))
  const prev = picks.get(sessionId)
  if (prev !== undefined && prev.key === q.key) return prev.ids.map((id) => byId.get(id)).filter((m) => m !== undefined)   // same message, next step: byte-identical
  const T = tuning
  const ranked = rankByRelevance(candidates.map((m) => ({ content: m.content, createdAt: m.createdAt, pinned: false, mem: m })), q.text, { maxTerms: T.maxTerms })
  const passing = ranked.filter((r) => (r.matched >= 2 && r.coverage >= T.minCoverage) || (r.matched >= 1 && r.coverage >= T.strongCoverage))
  const best = passing.reduce((top, r) => Math.max(top, r.coverage), 0)
  const strong = passing.filter((r) => r.coverage >= best * T.relative)
  // "kybernos" or "note" matches hundreds of memories equally: that is not a question about any of them.
  const ids = strong.length > T.maxCandidates ? [] : strong.slice(0, T.maxPicked).map((r) => String(r.doc.mem.id))
  let next = ids
  let turn = q.turn
  if (prev !== undefined) {
    const spaced = q.turn - prev.turn >= T.minTurnsBetweenChanges
    if (overlapOf(ids, prev.ids) >= T.keepOverlap || !spaced) { next = prev.ids; turn = prev.turn }
  }
  picks.delete(sessionId)
  picks.set(sessionId, { key: q.key, ids: next, turn })
  forgetOldest(picks)
  return next.map((id) => byId.get(id)).filter((m) => m !== undefined)
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
const selectForPrompt = (items, budget, pinnedShare, preferred = [], preferredShare = 0) => {
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
  // What matches the current question comes right after the pinned and BEFORE the newest, within its own share.
  let relevantUsed = 0
  const relevantCap = Math.floor(budget * preferredShare)
  for (const m of preferred) {
    const c = cost(m)
    if (chosen.has(m) || relevantUsed + c > relevantCap || used + c > budget) continue
    take(m, budget)
    relevantUsed += c
  }
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
const planInjection = (state, info) => {
  const empty = { account: { chosen: [], used: 0, omitted: 0 }, kyber: {}, used: 0, budget: MEMORY_MAX_INJECT_CHARS }
  if (isConnected(state) !== true) return empty
  const cfg = readMemorySettings()
  if (cfg.memories !== true || cfg.context !== true) return empty
  const kyberKeys = Object.keys(memoryCache.kyber).filter((k) => memoryCache.kyber[k].length > 0)
  const lineBudget = Math.max(0, MEMORY_MAX_INJECT_CHARS - MEMORY_FRAME_CHARS - MEMORY_KYBER_FRAME_CHARS * kyberKeys.length)
  const accountBudget = kyberKeys.length > 0 ? Math.floor(lineBudget * (1 - MEMORY_KYBER_SHARE)) : lineBudget
  // `info.sessionId` is only given by the prompt itself: the page's counts and « sent » flags stay the base selection.
  const preferred = cfg.relevant === true && info !== undefined && typeof info.sessionId === 'string'
    ? pickRelevant(info.sessionId, memoryCache.account.filter((m) => m.pinned !== true))
    : []
  const account = selectForPrompt(memoryCache.account, accountBudget, MEMORY_PINNED_SHARE, preferred, RELEVANCE_TUNING.share)
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
const renderMemoryChunk = (state, info) => {
  try {
    if (isConnected(state) !== true) return ''
    const plan = planInjection(state, info)
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
const renderMemoryPrompt = (state, info) => {
  try {
    if (isConnected(state) !== true) return ''
    const cfg = readMemorySettings()
    if (cfg.memories !== true || cfg.context !== true) return MEMORY_OFF_MARKER
    return renderMemoryChunk(state, info)
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
 * Installs a published kyber into the local root `<DSH home>/kybers/`.
 * A tester's kyber is NEVER replaced: when the id is taken the route refuses and says so, unless `ecraser: true` is
 * asked for explicitly. The answer carries `aCompleter`: what the catalogue does not publish (model route, stages, a
 * missing prompt) and the tester will have to write.
 *
 * The item is found by its address first (`GET /v1/marketplace/{slug}`: any item, listed or not, whatever page of the
 * catalogue it would be on), then, on a 404 (an older server has no such route, or the item is not there), by reading
 * the pages of the list (marketplace-kyber.mjs, `resoudreItem`).
 */
const marketplaceInstallRoute = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  const demande = body !== null && typeof body === 'object' ? body : {}
  const slug = typeof demande.slug === 'string' ? demande.slug.trim() : ''
  if (slug === '') return { ok: false, error: 'slug manquant' }
  // The slug goes into a URL and into a folder name: only a plain one is let through.
  if (slugSur(slug) !== true) return { ok: false, error: 'slug invalide' }
  const trouve = await resoudreItem(slug, {
    lireItem: (id) => apiCall('/v1/marketplace/' + encodeURIComponent(id), { token: state.token }),
    lirePage: marketplacePage(state),
  })
  if (trouve.item === undefined) return { ok: false, error: trouve.erreur }
  const item = trouve.item
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

const EMBED_MODEL = 'kybernos/embed'   // the role route of the older servers; a server with a vanilla catalogue names its own (below)
/** The embeddings model of the server we are connected to: the one its catalogue named at the last import, else the legacy route. */
const embedModelId = () => {
  const state = readState()
  const named = state !== null && state.models !== undefined && state.models !== null ? state.models.embed : null
  return typeof named === 'string' && named !== '' ? named : EMBED_MODEL
}
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
  const res = await apiCall('/v1/embeddings', { method: 'POST', token: state.token, body: { model: embedModelId(), input: texts } })
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
  const res = await apiCall('/v1/memories/' + encodeURIComponent(String(id)) + '/embedding', { method: 'PUT', token: state.token, body: { embedding: vector, model: embedModelId() } })
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
    rememberVectors(rows.map((r) => String(r.content)), emb.vectors)
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
      rememberVectors([String(memory.content)], emb.vectors)
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

// ── The map: memories placed by meaning ─────────────────────────────────────────────────────────────────
// Close dots mean close meaning. The positions are worked out HERE (mapproj.mjs) from the embedding vectors of a sample of memories
// (pinned first, then the ones sent to the model, then the newest). The vectors come from the same route as the search by meaning and
// sit behind the same `meaning` switch (the text of a memory goes to the embeddings model, nothing else); they are kept in a side file
// next to the state (`memory-vectors`: int8 + scale, keyed by a hash of the text, so an edited memory is simply a new key), which also
// fills while the memories are indexed, so opening the map is usually free. No server route is involved.

const MAP_VECTORS_MAX = 800
const MAP_TEXT_MAX = 1000
let mapInFlight = null

const readVectorCache = () => {
  const raw = readSide('memory-vectors', {})
  if (raw.model !== embedModelId() || raw.dim !== EMBED_DIM || raw.v === null || typeof raw.v !== 'object' || Array.isArray(raw.v)) return {}
  return raw.v
}

const writeVectorCache = (cache, keep) => {
  let keys = Object.keys(cache)
  if (keep !== undefined) keys = keys.filter((k) => keep.has(k))
  if (keys.length > MAP_VECTORS_MAX) keys = keys.slice(keys.length - MAP_VECTORS_MAX)
  const v = {}
  for (const k of keys) v[k] = cache[k]
  try { writeSide('memory-vectors', { model: embedModelId(), dim: EMBED_DIM, v }) } catch (e) { /* the map just recomputes next time */ }
}

/** Keeps vectors that were just paid for (indexing, a new memory) so the map does not ask for them again. Never throws. */
const rememberVectors = (texts, vectors) => {
  try {
    const cache = readVectorCache()
    texts.forEach((t, i) => { if (Array.isArray(vectors[i]) && vectors[i].length === EMBED_DIM) cache[textHash(String(t).slice(0, MAP_TEXT_MAX))] = packVector(vectors[i]) })
    writeVectorCache(cache)
  } catch (e) { /* a cache, nothing more */ }
}

/** At most `limit` memories: the pinned ones, then the ones sent to the model, then the newest. */
const mapSample = (rows, limit) => {
  if (rows.length <= limit) return rows
  const out = []
  const seen = new Set()
  const add = (r) => { if (out.length < limit && !seen.has(r.id)) { seen.add(r.id); out.push(r) } }
  rows.filter((r) => r.pinned).forEach(add)
  rows.filter((r) => r.sent).forEach(add)
  rows.forEach(add)
  return out
}

const buildMemoryMap = async (state, limit) => {
  if (readMemorySettings().meaning !== true) return { ok: false, error: 'sens_desactive' }
  const paused = meaningPaused()
  if (paused !== null) return { ok: false, error: paused, requiredTier: paused === 'offre_requise' ? meaningCache.requiredTier : undefined, plan: paused === 'offre_requise' ? meaningCache.plan : undefined }
  await refreshMemoryCache(state, false)
  if (memoryCache.error !== null && memoryCache.account.length === 0) return { ok: false, connected: true, error: memoryCache.error }
  const { rows: all } = accountRows(state)
  const rows = all.map((r) => ({ ...r, text: String(r.content).slice(0, MAP_TEXT_MAX) }))
  const sample = mapSample(rows, limit)
  const cache = readVectorCache()
  const vectors = new Array(sample.length).fill(null)
  const missing = []
  sample.forEach((r, i) => {
    const hit = cache[textHash(r.text)]
    const v = hit === undefined ? null : unpackVector(hit, EMBED_DIM)
    if (v !== null) vectors[i] = v; else missing.push(i)
  })
  let changed = false
  for (let at = 0; at < missing.length; at += EMBED_BATCH) {
    const part = missing.slice(at, at + EMBED_BATCH)
    const emb = await embedTexts(state, part.map((i) => sample[i].text))
    if (emb.ok !== true) {
      noteEmbedFailure(emb)
      if (changed) writeVectorCache(cache)   // what was paid for is kept: the next try goes on from here
      return { ok: false, error: emb.error, requiredTier: emb.requiredTier, plan: emb.plan }
    }
    part.forEach((i, k) => { cache[textHash(sample[i].text)] = packVector(emb.vectors[k]); vectors[i] = unpackVector(cache[textHash(sample[i].text)], EMBED_DIM); changed = true })
  }
  if (changed) writeVectorCache(cache, new Set(rows.map((r) => textHash(r.text))))
  meaningCache.lastError = null
  const map = buildMap(sample.map((r) => ({ id: r.id, text: r.text })), vectors)
  return {
    ok: true, total: rows.length, shown: sample.length, embedded: missing.length,
    // each dot carries the memory as the list shows it, so the page can open it as it does from the list
    nodes: sample.map((r, i) => { const { text, ...memory } = r; return { ...memory, x: map.nodes[i].x, y: map.nodes[i].y, cl: map.nodes[i].cl } }),
    clusters: map.clusters, links: map.links,
  }
}

const memoryMeaningMapRoute = async (req) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  let params = new URLSearchParams('')
  try { params = new URL(req.url, 'http://localhost').searchParams } catch (e) { /* requete sans query */ }
  const limit = intParam(params.get('limit'), MAP_TUNING.sample, 10, MAP_TUNING.sample)
  // two openings at once (the page remounts) share one computation, so the texts are embedded once
  if (mapInFlight === null) mapInFlight = buildMemoryMap(state, limit).finally(() => { mapInFlight = null })
  return await mapInFlight
}

// ── Tidy up: near-duplicates among the account's memories (dedupe.mjs, local, no model) ─────────────────
// A scan only LOOKS: it groups near-duplicates and stores the groups, nothing is changed. Applying a group keeps one
// memory (the pinned one if any, else the most complete, or the one the user picks, optionally edited) and deletes
// the others — and the server deletes for good, so BEFORE any delete the removed rows (and the kept one's old text)
// are written to a local archive, which is what Undo restores from, for 30 days. A pinned memory is never removed.
// Side files next to the state: `tidy` (last scan, groups the user kept apart, log of runs) and `tidy-archive`.

const TIDY_UNDO_DAYS = 30
const TIDY_MAX_REMOVALS = 50
const TIDY_DISMISSED_MAX = 500
const TIDY_LOG_MAX = 50

const tidyState = () => {
  const raw = readSide('tidy', {})
  return {
    scan: raw.scan !== null && typeof raw.scan === 'object' ? raw.scan : null,
    dismissed: Array.isArray(raw.dismissed) ? raw.dismissed.map(String) : [],
    log: Array.isArray(raw.log) ? raw.log : [],
    settings: normalizeTidySettings(raw.settings),
    last: raw.last !== null && typeof raw.last === 'object' && typeof raw.last.at === 'string' ? raw.last : null,
    judged: raw.judged !== null && typeof raw.judged === 'object' && !Array.isArray(raw.judged) ? raw.judged : {},
  }
}
const writeTidy = (t) => writeSide('tidy', { scan: t.scan, dismissed: t.dismissed.slice(-TIDY_DISMISSED_MAX), log: t.log.slice(0, TIDY_LOG_MAX), settings: t.settings, last: t.last, judged: t.judged })

// The Study model (Kybernos Settings → `brain`, « route/id ») and the `llm` service that can talk to it.
const kybernosSettingsFile = () => {
  const own = process.env.KYBERNOS_SETTINGS_FILE
  return typeof own === 'string' && own.trim() !== '' ? own.trim() : join(dshHome(), 'kybernos', 'settings.json')
}
const studyModel = () => readStudyModel(() => readFileSync(kybernosSettingsFile(), 'utf8'))
const tidyLlm = () => { try { return hostCtx === null ? undefined : hostCtx.get('llm') } catch (e) { return undefined } }
// A run that starts by itself, and the process-wide flags it needs.
const TIDY_TUNING = { firstMs: 90000, tickMs: 600000 }
const tidyFlags = { running: false, bootDone: false, retryAt: 0 }
const tidyArchive = () => { const raw = readSide('tidy-archive', {}); return { runs: raw.runs !== null && typeof raw.runs === 'object' ? raw.runs : {} } }
const writeTidyArchive = (a) => writeSide('tidy-archive', a)

const forgetOldArchive = () => {
  const limit = Date.now() - TIDY_UNDO_DAYS * 86400000
  const a = tidyArchive()
  let changed = false
  for (const id of Object.keys(a.runs)) { if (!(Date.parse(a.runs[id].at) > limit)) { delete a.runs[id]; changed = true } }
  if (changed) writeTidyArchive(a)
  return a
}

/** What the page needs: the groups of the last scan (without the ones the user kept apart), the log and what can still be undone. */
const tidyView = () => {
  const t = tidyState()
  const a = forgetOldArchive()
  const now = Date.now()
  const groups = t.scan === null ? [] : t.scan.groups.filter((g) => t.dismissed.indexOf(g.id) < 0).map((g) => ({
    ...g, items: g.items.map((i) => { const when = parseWhen(i.createdAt); return { ...i, ageMinutes: Number.isFinite(when) ? Math.max(0, Math.round((now - when) / 60000)) : null } }),
  }))
  return {
    ok: true, scannedAt: t.scan === null ? null : t.scan.at, total: t.scan === null ? null : t.scan.total, groups,
    saves: groups.reduce((n, g) => n + g.saves, 0),
    log: t.log.slice(0, 20).map((l) => ({ ...l, canUndo: l.undone !== true && a.runs[l.id] !== undefined })),
    settings: t.settings, last: t.last,
    next: tidyNext({ schedule: t.settings.schedule, last: t.last, now, total: memoryCache.account.length > 0 ? memoryCache.account.length : null, bootDone: tidyFlags.bootDone }),
    brain: { model: studyModel(), llm: tidyLlm() !== undefined },
    unclear: t.scan === null || !Number.isFinite(t.scan.unclear) ? 0 : t.scan.unclear,
  }
}

/**
 * One run: look (local detection, and — when the user allowed it and a Study model is set — its judgement of the pairs
 * the word count cannot decide), then, in `auto` mode, merge by itself the local groups at or above the line. Anything
 * else is left for the review. A run that was started by the schedule is `trigger: 'schedule'`.
 */
const tidyRun = async (state, trigger, now = Date.now()) => {
  if (tidyFlags.running) return { ok: false, error: 'deja_en_cours' }
  tidyFlags.running = true
  try {
    await refreshMemoryCache(state, true)
    if (memoryCache.error !== null && memoryCache.account.length === 0) return { ok: false, error: memoryCache.error }
    const items = memoryCache.account.map((m) => ({ id: m.id, content: m.content, createdAt: m.createdAt, pinned: m.pinned === true, bucket: m.kind }))
    const t = tidyState()
    const local = findDuplicateGroups(items)
    const taken = new Set(local.flatMap((g) => g.items.map((i) => i.id)))
    let suggestions = []
    let unclear = 0
    const brain = { asked: 0, error: null, detail: null, model: '' }
    if (t.settings.brain === true) {
      brain.model = studyModel()
      const llm = tidyLlm()
      const judged = await brainGroups({ items, taken, judged: t.judged, dismissed: t.dismissed, llm: brain.model === '' ? null : llm, model: brain.model, maxMerged: MEMORY_MAX_CONTENT, noun: 'memories' })
      suggestions = judged.groups
      unclear = judged.unclear
      brain.asked = judged.asked
      brain.error = brain.model === '' ? 'pas_de_modele_detude' : (llm === undefined ? 'llm_indisponible' : judged.error)
      t.judged = judged.judged
      brain.detail = brain.error === null ? null : (judged.detail === undefined ? null : judged.detail)
      if (brain.error !== null && brain.error !== 'pas_de_modele_detude' && brain.error !== 'llm_indisponible') console.error('[kybernos-cloud] tidy-up: the Study model could not be asked (' + brain.error + (brain.detail === null ? '' : ': ' + brain.detail) + ')')
    } else {
      unclear = unclearPairs(items, { taken }).filter((p) => t.dismissed.indexOf(p.id) < 0).length
    }
    t.scan = { at: new Date(now).toISOString(), total: items.length, unclear, groups: [...local, ...suggestions] }
    writeTidy(t)
    // 2. what the user allowed to be merged without asking
    const auto = { groups: 0, removed: 0, runs: [], failed: 0 }
    const picked = pickAuto(local.filter((g) => t.dismissed.indexOf(g.id) < 0), t.settings)
    for (const chunk of removalChunks(picked, TIDY_MAX_REMOVALS)) {
      const done = await applyGroups(state, chunk.map((g) => ({ id: g.id })), 'auto', now)
      if (done.error !== undefined) { auto.failed += chunk.length; continue }
      for (const r of done.results) {
        if (r.ok === true) { auto.groups += 1; auto.removed += r.removed || 0; if (r.run) auto.runs.push(r.run) } else auto.failed += 1
      }
    }
    const after = tidyState()
    after.last = { at: new Date(now).toISOString(), trigger, total: items.length - auto.removed, found: local.length + suggestions.length, autoGroups: auto.groups, autoRemoved: auto.removed, brainAsked: brain.asked, brainError: brain.error, ok: true }
    writeTidy(after)
    return { ...tidyView(), auto, brain }
  } finally {
    tidyFlags.running = false
  }
}
const tidyScan = (state) => tidyRun(state, 'manual')

const tidySettings = (body) => {
  const t = tidyState()
  const patched = patchTidySettings(t.settings, body)
  if (patched.ok !== true) return patched
  t.settings = patched.settings
  writeTidy(t)
  return { ok: true, settings: t.settings, view: tidyView() }
}

/** One look at whether a scheduled run is due; a run that fails waits an hour. Never throws, never runs offline. */
const tidyTick = async (now = Date.now()) => {
  try {
    const state = readState()
    if (isConnected(state) !== true || readMemorySettings().memories !== true) return { ran: false, why: 'hors_connexion' }
    const t = tidyState()
    const total = memoryCache.account.length > 0 ? memoryCache.account.length : null
    const due = tidyDue({ schedule: t.settings.schedule, last: t.last, now, total, bootDone: tidyFlags.bootDone, retryAt: tidyFlags.retryAt })
    if (t.settings.schedule === 'start') tidyFlags.bootDone = true
    if (!due) return { ran: false, why: 'pas_echu' }
    const res = await tidyRun(state, 'schedule', now)
    if (res.ok !== true) { tidyFlags.retryAt = now + 3600000; return { ran: false, why: res.error } }
    return { ran: true, auto: res.auto }
  } catch (e) {
    tidyFlags.retryAt = now + 3600000
    return { ran: false, why: 'erreur' }
  }
}

const mountTidySchedule = (ctx) => {
  ctx.effect(() => {
    const first = setTimeout(() => { void tidyTick() }, TIDY_TUNING.firstMs)
    const timer = setInterval(() => { void tidyTick() }, TIDY_TUNING.tickMs)
    if (typeof first.unref === 'function') first.unref()
    if (typeof timer.unref === 'function') timer.unref()
    return () => { clearTimeout(first); clearInterval(timer) }
  }, 'kybernos-cloud: nettoyage planifie')
}

const tidyDismiss = (body) => {
  const ids = body !== null && typeof body === 'object' && Array.isArray(body.groups) ? body.groups.map(String) : []
  if (ids.length === 0) return { ok: false, error: 'groupes_manquants' }
  const t = tidyState()
  if (body.restore === true) t.dismissed = t.dismissed.filter((d) => ids.indexOf(d) < 0)   // Undo of « Keep both »
  else for (const id of ids) if (t.dismissed.indexOf(id) < 0) t.dismissed.push(id)
  writeTidy(t)
  return tidyView()
}

/**
 * Applies the groups the user accepted. `body = { confirm: true, groups: [{ id, keep?, edit? }] }`. Every group is checked
 * against what the account holds NOW (a memory that changed or vanished since the scan is skipped, never guessed).
 */
const tidyApply = async (state, body) => {
  if (body === null || typeof body !== 'object' || body.confirm !== true) return { ok: false, error: 'confirmation_requise' }
  const asked = Array.isArray(body.groups) ? body.groups : []
  if (asked.length === 0) return { ok: false, error: 'groupes_manquants' }
  const done = await applyGroups(state, asked, 'you')
  if (done.error !== undefined) return { ok: false, error: done.error, ...(done.max === undefined ? {} : { max: done.max, wanted: done.wanted }) }
  return { ok: done.results.every((r) => r.ok === true), results: done.results, view: tidyView() }
}

/** The work of an apply, for the user's click (`by: 'you'`) and for a run that merges by itself (`by: 'auto'`). */
const applyGroups = async (state, asked, by, now = Date.now()) => {
  const t = tidyState()
  if (t.scan === null) return { error: 'aucun_scan', results: [] }
  await refreshMemoryCache(state, true)
  if (memoryCache.error !== null && memoryCache.account.length === 0) return { error: memoryCache.error, results: [] }
  const live = new Map(memoryCache.account.map((m) => [String(m.id), m]))
  // plan first (nothing is written until every group is judged): a request that would remove too much is refused whole
  const plan = []
  const results = []
  let removals = 0
  for (const want of asked) {
    const id = want !== null && typeof want === 'object' ? String(want.id) : ''
    const group = t.scan.groups.find((g) => g.id === id)
    if (group === undefined) { results.push({ id, ok: false, error: 'groupe_inconnu' }); continue }
    const members = group.items.map((i) => live.get(String(i.id)))
    if (members.some((m, k) => m === undefined || m.content !== group.items[k].content)) { results.push({ id, ok: false, error: 'a_change' }); continue }
    const pinned = members.filter((m) => m.pinned === true)
    let keepId = want.keep === undefined || want.keep === null ? String(group.keeperId) : String(want.keep)
    if (members.every((m) => String(m.id) !== keepId)) { results.push({ id, ok: false, error: 'garde_invalide' }); continue }
    if (pinned.length > 0 && pinned.some((m) => String(m.id) !== keepId)) { results.push({ id, ok: false, error: 'epingle_protege' }); continue }
    let edit = null
    if (typeof want.edit === 'string' && want.edit.trim() !== '') {
      edit = want.edit.trim()
      if (edit.length > MEMORY_MAX_CONTENT) { results.push({ id, ok: false, error: 'contenu_trop_long' }); continue }
    }
    const keeper = live.get(keepId)
    const removed = members.filter((m) => String(m.id) !== keepId)
    removals += removed.length
    plan.push({ group, keeper, removed, edit: edit !== null && edit !== keeper.content ? edit : null })
  }
  if (removals > TIDY_MAX_REMOVALS) return { error: 'trop_de_suppressions', max: TIDY_MAX_REMOVALS, wanted: removals, results: [] }
  const log = []
  for (const step of plan) {
    const runId = 't' + Date.now().toString(36) + step.group.id
    const archive = tidyArchive()
    const row = (m) => ({ id: m.id, content: m.content, kind: m.kind, scope: m.scope, kyberId: m.kyberId, source: m.source, pinned: m.pinned === true, retentionDays: m.retentionDays, createdAt: m.createdAt })
    // 1. the archive FIRST: if anything below fails half way, what was removed can always be put back
    archive.runs[runId] = { at: new Date().toISOString(), removed: step.removed.map(row), edited: step.edit === null ? [] : [{ id: step.keeper.id, before: step.keeper.content }] }
    writeTidyArchive(archive)
    let edited = false
    if (step.edit !== null) {
      const patched = await patchMemory(state, { id: step.keeper.id, content: step.edit })
      if (patched.ok !== true) { delete archive.runs[runId]; writeTidyArchive(archive); results.push({ id: step.group.id, ok: false, error: patched.error }); continue }
      edited = true
    }
    const gone = []
    let failure = null
    for (const m of step.removed) {
      const del = await deleteMemory(state, { id: m.id })
      if (del.ok !== true) { failure = del.error; break }
      gone.push(m.id)
    }
    // the archive keeps ONLY what was really deleted (and the old text only if it was really edited)
    const kept = tidyArchive()
    kept.runs[runId].removed = kept.runs[runId].removed.filter((r) => gone.indexOf(r.id) >= 0)
    if (!edited) kept.runs[runId].edited = []
    if (kept.runs[runId].removed.length === 0 && kept.runs[runId].edited.length === 0) delete kept.runs[runId]
    writeTidyArchive(kept)
    if (gone.length > 0 || edited) log.push({ id: runId, at: new Date(now).toISOString(), by, groupId: step.group.id, kept: step.keeper.id, removed: gone.length, edited, partial: failure !== null, undone: false })
    results.push({ id: step.group.id, ok: failure === null, removed: gone.length, edited, run: gone.length > 0 || edited ? runId : null, error: failure === null ? undefined : failure })
  }
  const after = tidyState()
  const done = new Set(results.filter((r) => r.ok === true).map((r) => r.id))
  if (after.scan !== null) after.scan.groups = after.scan.groups.filter((g) => !done.has(g.id))
  after.log = [...log.reverse(), ...after.log]
  writeTidy(after)
  return { results }
}

/** Puts a run back: the removed memories come back as NEW memories (new ids), the edited keeper gets its old text. */
const tidyUndo = async (state, body) => {
  const runId = body !== null && typeof body === 'object' ? String(body.run || '') : ''
  if (runId === '') return { ok: false, error: 'run_manquant' }
  const t = tidyState()
  const entry = t.log.find((l) => l.id === runId)
  if (entry === undefined) return { ok: false, error: 'run_inconnu' }
  if (entry.undone === true) return { ok: false, error: 'deja_annule' }
  const archive = tidyArchive()
  const run = archive.runs[runId]
  if (run === undefined) return { ok: false, error: 'archive_perimee' }
  let restored = 0
  const failed = []
  for (const r of run.removed) {
    const made = await createMemory(state, { scope: r.scope === 'kyber' ? 'kyber' : 'account', kind: r.kind, content: r.content, source: r.source, pinned: r.pinned === true, retentionDays: r.retentionDays, kyberId: r.kyberId === null ? undefined : r.kyberId }, 'taught')
    if (made.ok === true) restored += 1
    else failed.push(r)
  }
  let reverted = 0
  for (const e of run.edited) {
    const back = await patchMemory(state, { id: e.id, content: e.before })
    if (back.ok === true) reverted += 1
  }
  // what could not be put back stays in the archive, and the run stays undoable
  if (failed.length === 0) {
    delete archive.runs[runId]
    entry.undone = true
  } else {
    run.removed = failed
    run.edited = []
  }
  writeTidyArchive(archive)
  writeTidy(t)
  return { ok: failed.length === 0, restored, reverted, failed: failed.length, view: tidyView() }
}

// ── Team lessons ─────────────────────────────────────────────────────────────────────────────────────
// What the owners and admins of a TEAM workspace approved, read by every agent of it (team-lessons.mjs holds the rules; the server
// is /v1/workspaces/{id}/lessons). Three jobs here: keep the approved list in a small cache (the prompt only ever reads the cache),
// answer the page (list, propose, approve, reject, retire, withdraw) and add one block to the system prompt.
// The workspace is the ACTIVE one of the plugin (the sidebar's switcher); membership and roles are the server's business.

const teamCache = { at: 0, workspaceId: null, lessons: [], role: null, counts: { approved: 0, pending: 0 }, error: null }
const teamPickStore = new Map()   // sessionId -> { key, ids, turn } : the relevance pick of the team block, apart from the memories'
const TEAM_RELEVANCE = { ...RELEVANCE_TUNING, maxPicked: 3, maxCandidates: 8, share: 0.5 }

const emptyTeamCache = () => {
  teamCache.at = 0
  teamCache.workspaceId = null
  teamCache.lessons = []
  teamCache.role = null
  teamCache.counts = { approved: 0, pending: 0 }
  teamCache.error = null
  teamPickStore.clear()
}

const teamNow = (state) => teamWorkspace(state, state === null || state === undefined ? null : espaceActif(state))
const teamBase = (workspaceId) => '/v1/workspaces/' + encodeURIComponent(workspaceId) + '/lessons'

/** Re-reads the approved lessons of the active team workspace when the cache is older than its TTL (or `force`). Never throws. */
const refreshTeamCache = async (state, force) => {
  const ws = teamNow(state)
  if (ws.available !== true) { if (teamCache.workspaceId !== null) emptyTeamCache(); return ws }
  if (teamCache.workspaceId !== ws.workspaceId) emptyTeamCache()
  if (force !== true && teamCache.workspaceId === ws.workspaceId && Date.now() - teamCache.at < TEAM_TUNING.ttlMs) return ws
  const res = await apiCall(teamBase(ws.workspaceId) + '?view=approved&limit=' + String(TEAM_TUNING.fetchMax), { token: state.token })
  const failure = teamFailure(res.status, res.body)
  teamCache.workspaceId = ws.workspaceId
  if (failure !== null || res.body === null || !Array.isArray(res.body.lessons)) {
    teamCache.error = failure !== null ? failure : 'reponse_invalide'
    // a short retry delay, not the whole TTL; what was read before stays until the workspace is no longer ours
    teamCache.at = Date.now() - TEAM_TUNING.ttlMs + 60000
    if (teamCache.error === 'espace_introuvable') { teamCache.lessons = []; teamCache.role = null; teamCache.counts = { approved: 0, pending: 0 } }
    return ws
  }
  teamCache.at = Date.now()
  teamCache.error = null
  teamCache.lessons = res.body.lessons.map(asTeamLesson)
  teamCache.role = typeof res.body.role === 'string' ? res.body.role : null
  teamCache.counts = res.body.counts !== null && typeof res.body.counts === 'object' ? { approved: Number(res.body.counts.approved) || 0, pending: Number(res.body.counts.pending) || 0 } : { approved: teamCache.lessons.length, pending: 0 }
  return ws
}

/** The personal-lessons plugin's own switches (`kybernos-memory.json`): turning its context off also silences the team block. */
const lessonsSwitches = () => {
  const own = process.env.KYBERNOS_MEMORY_SETTINGS
  const file = typeof own === 'string' && own.trim() !== '' ? own.trim() : join(dshHome(), 'kybernos-memory.json')
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    return { lessons: raw.lessons !== false, context: raw.context !== false }
  } catch (e) { return { lessons: true, context: true } }
}

/** The kyber a chat runs (`<kybers>/.active/<session>`, written by the lessons plugin); null when unknown. */
const activeKyberOf = (sessionId) => {
  if (typeof sessionId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{5,79}$/.test(sessionId)) return null
  try {
    const row = JSON.parse(readFileSync(join(kybersDir(), '.active', sessionId), 'utf8'))
    return typeof row.kyber === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(row.kyber) && row.kyber.indexOf('..') < 0 ? row.kyber : null
  } catch (e) { return null }
}

/** What a session receives: from the cache only (synchronous), and nothing unless every switch says so. */
const teamSelection = (state, sessionId) => {
  const none = { plan: { chosen: [], omitted: 0, used: 0 }, ws: teamNow(state), kyber: null, picked: [] }
  if (state === null || state === undefined) return none
  const ws = none.ws
  const cfg = readMemorySettings()
  const sw = lessonsSwitches()
  if (ws.available !== true || cfg.team_use !== true || sw.lessons !== true || sw.context !== true || teamCache.workspaceId !== ws.workspaceId) return none
  const kyber = activeKyberOf(sessionId)
  const pool = applicable(teamCache.lessons, kyber)
  let preferred = []
  if (cfg.relevant === true && typeof sessionId === 'string' && sessionId !== '') {
    const hits = pickRelevant(sessionId, pool.map((l) => ({ id: l.id, content: l.text + ' ' + l.tags.join(' '), createdAt: l.updatedAt })), teamPickStore, TEAM_RELEVANCE)
    preferred = hits.map((h) => pool.find((l) => l.id === h.id)).filter((l) => l !== undefined)
  }
  return { plan: teamPlan(teamCache.lessons, kyber, preferred), ws, kyber, picked: preferred.map((l) => l.id) }
}

/** The block of the system prompt. Synchronous and never throws: '' on any doubt. */
const renderTeamPrompt = (state, sessionId) => {
  try {
    const sel = teamSelection(state, sessionId)
    return renderTeamChunk(sel.plan, sel.ws.workspaceName === undefined ? '' : sel.ws.workspaceName)
  } catch (e) { return '' }
}

const isLessonId = (v) => (typeof v === 'number' && Number.isInteger(v) && v > 0) || (typeof v === 'string' && /^\d{1,18}$/.test(v))

const teamCall = async (state, method, suffix, body) => {
  const ws = teamNow(state)
  if (ws.available !== true) return { ok: false, error: ws.reason }
  const res = await apiCall(teamBase(ws.workspaceId) + suffix, { method, token: state.token, ...(body === undefined ? {} : { body }) })
  const failure = teamFailure(res.status, res.body)
  if (failure !== null) return { ok: false, error: failure }
  return { ok: true, body: res.body, ws }
}

const teamStatusRoute = async (req) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  const ws = teamNow(state)
  if (ws.available === true) await refreshTeamCache(state, false)
  const cfg = readMemorySettings()
  let params = new URLSearchParams('')
  try { params = new URL(req.url, 'http://localhost').searchParams } catch (e) { /* no query */ }
  const sid = String(params.get('session') || '')
  const sel = sid === '' ? null : teamSelection(state, sid.replace(/^session-/, ''))
  const mine = ws.available === true && teamCache.workspaceId === ws.workspaceId
  return {
    ok: true, connected: true,
    team: { available: ws.available, reason: ws.reason, plan: ws.plan === undefined ? null : ws.plan, workspaceId: ws.workspaceId === undefined ? null : ws.workspaceId, workspaceName: ws.workspaceName === undefined ? null : ws.workspaceName,
      role: mine ? teamCache.role : null, counts: mine ? teamCache.counts : { approved: 0, pending: 0 }, error: mine ? teamCache.error : null },
    settings: { use: cfg.team_use === true, share: cfg.team_share === true },
    sent: sel === null ? null : { count: sel.plan.chosen.length, omitted: sel.plan.omitted, picked: sel.picked.length, kyber: sel.kyber },
  }
}

const teamListRoute = async (req) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  const ws = teamNow(state)
  if (ws.available !== true) return { ok: false, error: ws.reason }
  let params = new URLSearchParams('')
  try { params = new URL(req.url, 'http://localhost').searchParams } catch (e) { /* no query */ }
  const view = ['approved', 'proposed', 'mine', 'all'].indexOf(params.get('view')) >= 0 ? params.get('view') : 'approved'
  let query = 'view=' + view + '&limit=' + String(intParam(params.get('limit'), 100, 1, 200)) + '&offset=' + String(intParam(params.get('offset'), 0, 0, 100000))
  if (params.get('kyber') !== null) query += '&kyber=' + encodeURIComponent(String(params.get('kyber')).slice(0, 64))
  const made = await teamCall(state, 'GET', '?' + query)
  if (made.ok !== true) return made
  const b = made.body !== null && typeof made.body === 'object' ? made.body : {}
  if (!Array.isArray(b.lessons)) return { ok: false, error: 'reponse_invalide' }
  return { ok: true, connected: true, role: typeof b.role === 'string' ? b.role : null, view: b.view, total: b.total, limit: b.limit, offset: b.offset, counts: b.counts, lessons: b.lessons.map(asTeamLesson), workspaceName: ws.workspaceName }
}

/** After a write: the cache is stale, and the next reading must see it. */
const afterTeamWrite = (state) => { teamCache.at = 0; void refreshTeamCache(state, true) }

const teamAddRoute = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  if (readMemorySettings().team_share !== true) return { ok: false, error: 'partage_desactive' }
  const b = body !== null && typeof body === 'object' ? body : {}
  if (typeof b.text !== 'string' || b.text.trim() === '') return { ok: false, error: 'texte_invalide' }
  const payload = { text: b.text, name: displayName(state) }
  if (typeof b.kyber === 'string' && b.kyber !== '') payload.kyber = b.kyber
  if (Array.isArray(b.tags)) payload.tags = b.tags
  if (typeof b.note === 'string' && b.note.trim() !== '') payload.note = b.note
  const made = await teamCall(state, 'POST', '', payload)
  if (made.ok !== true) return made
  afterTeamWrite(state)
  return { ok: true, lesson: asTeamLesson(made.body) }
}

const teamReviewRoute = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  const b = body !== null && typeof body === 'object' ? body : {}
  if (!isLessonId(b.id)) return { ok: false, error: 'lecon_introuvable' }
  if (b.decision !== 'approve' && b.decision !== 'reject') return { ok: false, error: 'requete_invalide' }
  const payload = { decision: b.decision, name: displayName(state) }
  if (typeof b.note === 'string' && b.note.trim() !== '') payload.note = b.note
  if (b.decision === 'approve' && typeof b.text === 'string' && b.text.trim() !== '') payload.text = b.text
  if (b.decision === 'approve' && typeof b.kyber === 'string') payload.kyber = b.kyber
  const made = await teamCall(state, 'POST', '/' + String(b.id) + '/review', payload)
  if (made.ok !== true) return made
  afterTeamWrite(state)
  return { ok: true, lesson: asTeamLesson(made.body) }
}

const teamRetireRoute = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  const b = body !== null && typeof body === 'object' ? body : {}
  if (!isLessonId(b.id)) return { ok: false, error: 'lecon_introuvable' }
  const made = await teamCall(state, 'POST', '/' + String(b.id) + '/retire', { name: displayName(state) })
  if (made.ok !== true) return made
  afterTeamWrite(state)
  return { ok: true, lesson: asTeamLesson(made.body) }
}

const teamDeleteRoute = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  const b = body !== null && typeof body === 'object' ? body : {}
  if (!isLessonId(b.id)) return { ok: false, error: 'lecon_introuvable' }
  const made = await teamCall(state, 'DELETE', '/' + String(b.id))
  if (made.ok !== true) return made
  afterTeamWrite(state)
  return { ok: true }
}

// ── Team skills ──────────────────────────────────────────────────────────────────────
// A Team's private catalogue of skills (docs/dev/team-skills-contract.md): any member proposes one, an owner or admin approves it, every
// member can install it. Reserved to the Team plan by the same rule as the lessons (`teamWorkspace`). This side only talks to the server
// with the account token; reading a local skill and writing an installed one is kybernos-skills' business (the page carries the files
// from one to the other), so no skill content is ever kept here.
const teamSkillsCall = async (state, method, suffix, body) => {
  const ws = teamNow(state)
  if (ws.available !== true) return { ok: false, error: ws.reason }
  const res = await apiCall(teamSkillsBase(ws.workspaceId) + suffix, { method, token: state.token, ...(body === undefined ? {} : { body }) })
  const failure = teamSkillsFailure(res.status, res.body)
  if (failure !== null) return { ok: false, ...failure }
  return { ok: true, body: res.body, ws }
}

const paramsOf = (req) => {
  try { return new URL(req.url, 'http://localhost').searchParams } catch (e) { return new URLSearchParams('') }
}

const teamSkillsListRoute = async (req) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  const params = paramsOf(req)
  const view = ['approved', 'proposed', 'mine', 'all'].indexOf(params.get('view')) >= 0 ? params.get('view') : 'approved'
  const query = 'view=' + view + '&limit=' + String(intParam(params.get('limit'), 100, 1, 200)) + '&offset=' + String(intParam(params.get('offset'), 0, 0, 100000))
  const made = await teamSkillsCall(state, 'GET', '?' + query)
  if (made.ok !== true) return made
  const b = made.body !== null && typeof made.body === 'object' ? made.body : {}
  if (!Array.isArray(b.skills)) return { ok: false, error: 'invalid_response' }
  return { ok: true, connected: true, role: typeof b.role === 'string' ? b.role : null, view: b.view, total: b.total, limit: b.limit, offset: b.offset, counts: b.counts, skills: b.skills.map(asTeamSkill), workspaceName: made.ws.workspaceName }
}

const teamSkillsItemRoute = async (req) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  const id = paramsOf(req).get('id')
  if (!isSkillId(id)) return { ok: false, error: 'skill_not_found' }
  const made = await teamSkillsCall(state, 'GET', '/' + String(id))
  if (made.ok !== true) return made
  if (made.body === null || typeof made.body !== 'object' || !Array.isArray(made.body.files)) return { ok: false, error: 'invalid_response' }
  return { ok: true, skill: asTeamSkill(made.body) }
}

const teamSkillsAddRoute = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  const b = body !== null && typeof body === 'object' ? body : {}
  if (typeof b.name !== 'string' || b.name === '' || typeof b.description !== 'string' || !Array.isArray(b.files) || b.files.length === 0) return { ok: false, error: 'bad_request' }
  const payload = { name: b.name, description: b.description, files: b.files, display_name: displayName(state) }
  if (typeof b.note === 'string' && b.note.trim() !== '') payload.note = b.note
  const made = await teamSkillsCall(state, 'POST', '', payload)
  if (made.ok !== true) return made
  return { ok: true, skill: asTeamSkill(made.body) }
}

const teamSkillsReviewRoute = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  const b = body !== null && typeof body === 'object' ? body : {}
  if (!isSkillId(b.id)) return { ok: false, error: 'skill_not_found' }
  if (b.decision !== 'approve' && b.decision !== 'reject') return { ok: false, error: 'bad_request' }
  const payload = { decision: b.decision, display_name: displayName(state) }
  if (typeof b.note === 'string' && b.note.trim() !== '') payload.note = b.note
  const made = await teamSkillsCall(state, 'POST', '/' + String(b.id) + '/review', payload)
  if (made.ok !== true) return made
  return { ok: true, skill: asTeamSkill(made.body) }
}

const teamSkillsRetireRoute = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  const b = body !== null && typeof body === 'object' ? body : {}
  if (!isSkillId(b.id)) return { ok: false, error: 'skill_not_found' }
  const made = await teamSkillsCall(state, 'POST', '/' + String(b.id) + '/retire', { display_name: displayName(state) })
  if (made.ok !== true) return made
  return { ok: true, skill: asTeamSkill(made.body) }
}

const teamSkillsDeleteRoute = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  const b = body !== null && typeof body === 'object' ? body : {}
  if (!isSkillId(b.id)) return { ok: false, error: 'skill_not_found' }
  const made = await teamSkillsCall(state, 'DELETE', '/' + String(b.id))
  if (made.ok !== true) return made
  return { ok: true }
}

/**
 * Liste paginée et filtrée des souvenirs du COMPTE. Tout est calculé ici, sur le
 * cache : le serveur ne pagine pas encore (`GET /v1/memories` renvoie tout), donc
 * la page ne doit pas recevoir 631 lignes pour en afficher 25. `sent` vient de
 * `planInjection` — la même sélection que le prompt. La recherche est textuelle
 * (`mode: exact`) : la pertinence demandera un index côté serveur.
 */
/** The account's memories as the page shows them (newest first, with what is sent to the model), and the injection plan they were measured against. */
const accountRows = (state) => {
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
  return { plan, rows }
}

const memoryListRoute = async (req) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  let params = new URLSearchParams('')
  try { params = new URL(req.url, 'http://localhost').searchParams } catch (e) { /* requete sans query */ }
  // `fresh=1` is the page's own « look again » (it opens, or the person refreshes): a memory written on the web or by another
  // device is there at once. Without it the 60 s cache serves paging and filters, which must not call the server each time.
  await refreshMemoryCache(state, params.get('fresh') === '1')
  if (memoryCache.error !== null && memoryCache.account.length === 0) return { ok: false, connected: true, error: memoryCache.error }
  const limit = intParam(params.get('limit'), 25, 1, 200)
  const offset = intParam(params.get('offset'), 0, 0, 1000000)
  const show = ['pinned', 'sent'].indexOf(params.get('show')) >= 0 ? params.get('show') : 'all'
  const src = ['capture', 'agent', 'you', 'sync'].indexOf(params.get('src')) >= 0 ? params.get('src') : 'any'
  const added = ADDED_WINDOW_MIN[params.get('added')] !== undefined ? params.get('added') : 'any'
  const qRaw = String(params.get('q') || '').trim()
  const q = qRaw.toLowerCase()
  const wantMeaning = params.get('mode') === 'meaning' && q !== ''

  const { plan, rows } = accountRows(state)
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
  // The chat this page is open next to (`?session=`): how many memories were picked for its latest message.
  const sid = String(params.get('session') || '')
  const pick = sid === '' ? undefined : (sessionPick.get(sid) || sessionPick.get(sid.replace(/^session-/, '')))
  const picked = pick === undefined ? null : { count: pick.ids.length, turn: pick.turn }
  return {
    ok: true, connected: true,
    total: list.length, limit, offset, items: list.slice(offset, offset + limit),
    counts, filters: { show, src, added, q },
    search, picked,
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

const memoryTidyRoute = async () => tidyView()
const memoryTidyScanRoute = async () => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  return await tidyScan(state)
}
const memoryTidyApplyRoute = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  return await tidyApply(state, body)
}
const memoryTidyDismissRoute = async (req, body) => tidyDismiss(body)
const memoryTidySettingsRoute = async (req, body) => tidySettings(body)
const memoryTidyUndoRoute = async (req, body) => {
  const state = readState()
  if (isConnected(state) !== true) return { ok: false, connected: false, error: 'non connecte' }
  return await tidyUndo(state, body)
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

const sessionIdOfContext = (context) => {
  try { return context.agent.session.id } catch (e) { return undefined }
}

const mountMemoryPrompt = (ctx) => {
  // `inject` (et non `get`) : c'est la forme des plugins natifs, et elle
  // donne un scope ou `scope.systemPrompt` est le service. Sans lui, rien.
  ctx.inject(['systemPrompt'], (scope) => {
    scope.systemPrompt.context({
      name: 'kybernos:memory',
      order: MEMORY_INJECT_ORDER,
      text: (context) => renderMemoryPrompt(readState(), { sessionId: sessionIdOfContext(context) }),
    })
    // The lessons the team approved: a block of its own, from the cache only (refreshed below and by the tick).
    scope.systemPrompt.context({
      name: TEAM_CHUNK_NAME,
      order: TEAM_CHUNK_ORDER,
      text: (context) => renderTeamPrompt(readState(), sessionIdOfContext(context)),
    })
  })
  // The human's message of each turn, to pick the memories that match it (see « The memories that matter »).
  ctx.on('agent/inbox/claimed', ({ agent, message, turn }) => {
    try { noteUserTurn(agent.session.id, message, turn) } catch (e) { /* never break a turn */ }
  })
  const state = readState()
  if (isConnected(state) === true) setTimeout(() => { void refreshMemoryCache(readState(), true); void refreshTeamCache(readState(), true) }, 1500)
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
    const timer = setInterval(() => { void refreshMemoryCache(readState(), false); void refreshTeamCache(readState(), false) }, MEMORY_TUNING.tickMs)
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
// journal de session sur disque (<DSH home>/sessions/<slug>/<id>/session.v4.jsonl.zstd)
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
  const sessions = sessionsHome()
  try {
    for (const slug of readdirSync(sessions)) {
      const candidat = join(sessions, slug, dshId)
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
    const cats = JSON.parse(readFileSync(categoriesFile(), 'utf8'))
    if (cats[dshId] && typeof cats[dshId].titre === 'string') titre = cats[dshId].titre
  } catch { /* pas de renommage */ }
  return { ok: true, dsh_id: dshId, title: titre, messages, tronque: messages.length >= DSH_DETAIL_MAX_MESSAGES }
}

// Kybernos connections (ADR 0008 of the server): the routes the connectors page calls, and three native tools for the agents. Nothing is
// asked of a server that does not offer them (`services.connections`), and nothing is sent without the account's own token.
const connections = createConnections({ apiCall, readState, isConnected, server, log: (m) => console.error('[kybernos-cloud] connexions: ' + m) })

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
  { path: '/kybernos-cloud/server', method: 'GET', guarded: false, run: serverRoute },
  { path: '/kybernos-cloud/server/apply', method: 'POST', guarded: true, run: serverApply },
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
  // Relais lecture seule pour la console Team (iframe d'une autre origine) : liste blanche, jeton ajouté ici, origine STRICTE.
  { path: '/kybernos-cloud/relay', method: 'GET', guarded: true, strict: true, run: relayRoute },
  // La console Team dans le navigateur : un lien à usage unique (60 s) demandé au serveur avec le jeton d'appareil, jamais le jeton lui-même.
  { path: '/kybernos-cloud/console/link', method: 'POST', guarded: true, strict: true, body: true, cap: 2048, run: consoleLink },
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
  { path: '/kybernos-cloud/memory/meaning-map', method: 'GET', guarded: true, run: memoryMeaningMapRoute },
  // Tidy up (near-duplicates): the last scan and the log, a scan (it only looks), what to apply / keep apart / undo.
  { path: '/kybernos-cloud/team/status', method: 'GET', guarded: true, run: teamStatusRoute },
  { path: '/kybernos-cloud/team/lessons', method: 'GET', guarded: true, run: teamListRoute },
  { path: '/kybernos-cloud/team/lessons/add', method: 'POST', guarded: true, body: true, cap: 16384, run: teamAddRoute },
  { path: '/kybernos-cloud/team/lessons/review', method: 'POST', guarded: true, body: true, cap: 16384, run: teamReviewRoute },
  { path: '/kybernos-cloud/team/lessons/retire', method: 'POST', guarded: true, body: true, cap: 4096, run: teamRetireRoute },
  { path: '/kybernos-cloud/team/lessons/delete', method: 'POST', guarded: true, body: true, cap: 4096, run: teamDeleteRoute },
  // Team skills: the server half only (files are read and written by kybernos-skills). A proposal carries up to 1 MiB of files.
  { path: '/kybernos-cloud/team/skills', method: 'GET', guarded: true, run: teamSkillsListRoute },
  { path: '/kybernos-cloud/team/skills/item', method: 'GET', guarded: true, run: teamSkillsItemRoute },
  { path: '/kybernos-cloud/team/skills/add', method: 'POST', guarded: true, body: true, cap: 4 * 1024 * 1024, run: teamSkillsAddRoute },
  { path: '/kybernos-cloud/team/skills/review', method: 'POST', guarded: true, body: true, cap: 4096, run: teamSkillsReviewRoute },
  { path: '/kybernos-cloud/team/skills/retire', method: 'POST', guarded: true, body: true, cap: 4096, run: teamSkillsRetireRoute },
  { path: '/kybernos-cloud/team/skills/delete', method: 'POST', guarded: true, body: true, cap: 4096, run: teamSkillsDeleteRoute },
  // Kybernos connections: the account's connected apps. The routes sit here (the token does) and the connectors page calls them. A
  // link may carry the API key of a toolkit that has no OAuth, so its body is small and its handler never logs or echoes it.
  { path: '/kybernos-cloud/connections', method: 'GET', guarded: true, run: connections.listRoute },
  { path: '/kybernos-cloud/connections/apps', method: 'GET', guarded: true, run: connections.appsRoute },
  { path: '/kybernos-cloud/connections/item', method: 'GET', guarded: true, run: connections.itemRoute },
  { path: '/kybernos-cloud/connections/link', method: 'POST', guarded: true, body: true, cap: 16384, run: connections.linkRoute },
  { path: '/kybernos-cloud/connections/delete', method: 'POST', guarded: true, body: true, cap: 4096, run: connections.deleteRoute },
  { path: '/kybernos-cloud/memory/tidy', method: 'GET', guarded: true, run: memoryTidyRoute },
  { path: '/kybernos-cloud/memory/tidy/scan', method: 'POST', guarded: true, run: memoryTidyScanRoute },
  { path: '/kybernos-cloud/memory/tidy/apply', method: 'POST', guarded: true, body: true, cap: 65536, run: memoryTidyApplyRoute },
  { path: '/kybernos-cloud/memory/tidy/dismiss', method: 'POST', guarded: true, body: true, cap: 16384, run: memoryTidyDismissRoute },
  { path: '/kybernos-cloud/memory/tidy/undo', method: 'POST', guarded: true, body: true, cap: 4096, run: memoryTidyUndoRoute },
  { path: '/kybernos-cloud/memory/tidy/settings', method: 'POST', guarded: true, body: true, cap: 4096, run: memoryTidySettingsRoute },
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
      if (route.strict === true && sameOriginStrict(req) === false) return sendJson(res, 403, { ok: false, error: 'origine refusee' })
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
  try { connections.mount(ctx) } catch (e) { console.error('[kybernos-cloud] connexions: ' + String((e && e.message) || e)) }
  try { mountMemoryCapture(ctx) } catch (e) { console.error('[kybernos-cloud] capture mémoire: ' + String((e && e.message) || e)) }
  try { mountMemoryRefresh(ctx) } catch (e) { console.error('[kybernos-cloud] rafraîchissement mémoire: ' + String((e && e.message) || e)) }
  try { mountTidySchedule(ctx) } catch (e) { console.error('[kybernos-cloud] nettoyage planifié: ' + String((e && e.message) || e)) }
  autoImportAtBoot(ctx)
}

// Exportés pour le test hors-DSH (scripts/test-cloud-host.mjs) : aucune autre
// surface publique n'est promise.
export {
  dshHome, resolveApi, stateFile, server, serverApply, serverRoute, deviceLabel, publicState, ROUTES, importCatalog, CRED_REF, PROVIDER_ID, connections,
  // Relais de la console Team (exportés pour la suite dédiée).
  relayCheck, sameOriginStrict, RELAY_RULES,
  // Mémoire — exportés pour la suite host (faux serveur, aucune vraie API).
  consoleLink,
  asMemory, validateMemory, createMemory, patchMemory, deleteMemory, searchMemories,
  sanitizeMemory, sortMemories, renderMemoryChunk, renderMemoryPrompt, MEMORY_MARKER, MEMORY_OFF_MARKER, RELEVANCE_TUNING, noteUserTurn, userPromptText, pickRelevant, sessionQuery, sessionPick,
  embedTexts, putEmbedding, meaningStatus, indexMemories, findByMeaning, meaningCache, EMBED_DIM, EMBED_MODEL,
  teamCache, teamPickStore, refreshTeamCache, emptyTeamCache, teamSelection, renderTeamPrompt, activeKyberOf, lessonsSwitches, TEAM_RELEVANCE,
  tidyScan, tidyRun, tidyApply, tidyUndo, tidyDismiss, tidySettings, tidyTick, tidyView, tidyFlags, TIDY_TUNING, TIDY_MAX_REMOVALS, studyModel,
  refreshMemoryCache, memoryCache,
  emptyMemoryCache, bumpMemoryCache, pushLessons, localLessons, localKybers, stateKyberMap,
  listMemories, lastTurnText, memoryWriteTool, memorySearchTool, MEMORY_KINDS, MEMORY_SOURCES,
  captureTurn, lastCapture, extractFacts, stripMemoryBlock, normalizeMemory,
  MEMORY_MAX_CONTENT, MEMORY_MAX_INJECT_CHARS, MEMORY_TUNING,
  selectForPrompt, planInjection, readMemorySettings, noteOrigins, originOf, scheduleMemoryRefresh, parseWhen,
}
