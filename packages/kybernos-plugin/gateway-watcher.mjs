// ── Brique gateway : watcher long-poll + file locale ───────────────────────
// Pont DSH local ↔ gateway cloud (ancienne pile), côté MACHINE de l'utilisateur. Inactif sauf token d'appairage ET `gatewayBase`.
// Sources de vérité : docs/handoff/gateway-contrat.md (§2.2 route long-poll,
// §3 file à 5 états, §4 appairage, §7 décisions d'arbitrage, §8 sync par
// catégorie — ici les RÉGLAGES `syncAllowed` seulement, pas encore de client
// sync : voir le point d'ancrage dans `boucle()`) et
// docs/widget-integration.md (le pont widget existant — on l'ÉTEND, jamais
// réécrit : mêmes étapes session/create → active-set → session/prompt, même
// magasin JSONL, mêmes formes de requêtes/réponses que le local).
//
// Règles dures du module :
// - SANS token d'appairage (`pairingToken` dans ~/.dsh/kybernos/settings.json),
//   le module reste INACTIF : rien ne sort de la machine, le comportement local
//   est strictement celui d'aujourd'hui.
// - SORTIE SEULE : aucune écoute, aucun port entrant nulle part. Le module ne
//   émet que des requêtes sortantes : GET <base>/gateway/poll (long-poll),
//   POST <base>/widget/api/reply, POST <base>/telecommande/action/<id>/decision,
//   GET <base>/telecommande/sync/settings (réglages de sync §8).
// - Le token ne sort QUE dans l'en-tête `Authorization: Bearer` — jamais dans
//   une URL, jamais dans un log, jamais dans la file locale (empreinte seule).
// - 401 = token révoqué → arrêt PROPRE du watcher, sans boucle de reconnexion.
//
// Le module est autonome (aucune dépendance au bundle index.js) : le branchement
// côté hôte lui injecte le RPC local et `setActiveKyber` du pont existant, mais
// sans injection il sait quand même parler au RPC local DSH (cookie signé).
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { createHash, createHmac } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

// ── Noyau pur (exporté, testable sans réseau ni fichier) ───────────────────

/** §7 : la route du long-poll, son curseur de reprise et sa réponse `{ok, cursor, items[]}`. */
export const GATEWAY_POLL_PATH = '/gateway/poll'
/** §2.1/§7 : le repoussage des réponses — mêmes requêtes/réponses que la route locale. */
export const GATEWAY_REPLY_PATH = '/widget/api/reply'
/** §7 : la route de décision de la télécommande, suffixée par l'identifiant d'action. */
export const GATEWAY_DECISION_PATH = '/telecommande/action/'
/** §3 : la file a CINQ états — le dernier (terminal télécommande) porte deux valeurs. */
export const GATEWAY_NB_ETATS = 5
export const GATEWAY_ETATS = ['empile', 'tire', 'en cours', 'repondu', 'approuve', 'refuse']
/** États d'où plus rien ne repart : l'item a atteint son sort. */
export const GATEWAY_ETATS_TERMINAUX = ['repondu', 'approuve', 'refuse', 'echec']
/** §7 : token d'appairage opaque 256 bits, préfixe `kya-`, illimité jusqu'à révocation. */
export const GATEWAY_TOKEN_PREFIXE = 'kya-'
/** Version du fichier de file local. */
export const GATEWAY_VERSION_FILE = 1
/** §8 : la route des réglages de sync par catégorie — auth famille télécommande. */
export const GATEWAY_SYNC_SETTINGS_PATH = '/telecommande/sync/settings'
/** §8 : catégories MVP de la sync. `memoire` est LOCALE au MVP, jamais synchronisée. */
export const GATEWAY_SYNC_CATEGORIES = ['equipes', 'taches', 'evenements', 'chiffres']
/** §8 : cache des réglages de sync — 60 s max, relecture après erreur incluse. */
export const GATEWAY_SYNC_CACHE_MS = 60000
/** §8 : la route du flux de changements (tirage — le cloud est la source). */
export const GATEWAY_SYNC_CHANGES_PATH = '/telecommande/sync/changes'
/** §8 : préfixe des dossiers kybers écrits par la sync — un kyber fait main
 * (sans le préfixe) n'est JAMAIS écrasé ni supprimé par le tirage. */
export const GATEWAY_SYNC_PREFIXE_DOSSIER = 'cloud-'
/** Version du fichier d'état du tirage de sync (curseur + idempotence + ledger). */
export const GATEWAY_SYNC_ETAT_VERSION = 1

/** Empreinte d'un texte pour la clé d'idempotence (jamais le texte lui-même dans la clé). */
export const empreinteTexte = (texte) => createHash('sha256').update(String(texte === null || texte === undefined ? '' : texte)).digest('hex').slice(0, 32)

/** Identifiant de session/tâche lisible et sûr pour un nom de fichier ou de route. */
const idSur = (v, max) => {
  const s = typeof v === 'string' ? v.trim() : ''
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,150}$/.test(s) === true ? s.slice(0, max === undefined ? 150 : max) : null
}

/** Dossier de conversation : même règle que les routes widget locales. */
export const slugSur = (v) => String(v === null || v === undefined ? '' : v).replace(/[^A-Za-z0-9._-]/g, '').slice(0, 60) || 'inconnu'

/**
 * §7 — clé d'idempotence :
 * - message : `(conversationId, vid, empreinte du texte)` ;
 * - tâche : `taskId` (UUID v4 généré par l'émetteur).
 * Un item qu'on ne peut pas identifier est rejeté (mieux vaut le signaler que
 * le traiter en double au prochain renvoi).
 * @param {object} item item NORMALISÉ (sortie de `normaliserItem`)
 * @returns {string|null}
 */
export function cleIdempotence (item) {
  const o = item !== null && item !== undefined && typeof item === 'object' ? item : {}
  if (o.kind === 'task') {
    const t = idSur(o.taskId, 120)
    return t === null ? null : 'tache:' + t
  }
  if (o.kind === 'message') {
    const c = idSur(o.conversationId, 120)
    if (c === null) return null
    return 'message:' + c + ':' + String(o.vid === null || o.vid === undefined ? '' : o.vid).slice(0, 40) + ':' + empreinteTexte(o.text)
  }
  return null
}

/**
 * Normalise un item du long-poll (schéma cloud : §2.2 « nouvelles conversations
 * + nouveaux messages visiteurs + tâches/approbations en attente », forme
 * exacte laissée ouverte par le contrat — on reste TOLÉRANT à la lecture).
 * @returns {object|null} item normalisé, ou `null` si illisible
 */
export function normaliserItem (brut) {
  const o = (brut !== null && brut !== undefined && typeof brut === 'object') ? brut : {}
  const type = String(o.type === undefined || o.type === null ? (o.kind === undefined || o.kind === null ? '' : o.kind) : o.type).toLowerCase()
  const texte = typeof o.text === 'string' ? o.text.trim().slice(0, 2000) : (typeof o.demande === 'string' ? o.demande.trim().slice(0, 2000) : '')
  const taskId = idSur(o.taskId, 120)
  if (taskId !== null || type === 'task' || type === 'tache' || type === 'approval' || type === 'approbation') {
    return {
      kind: 'task',
      taskId: taskId,
      text: texte,
      title: typeof o.title === 'string' ? o.title.trim().slice(0, 200) : (typeof o.titre === 'string' ? o.titre.trim().slice(0, 200) : ''),
      brut: o,
    }
  }
  const conversationId = idSur(o.conversationId, 120)
  if (texte !== '' && conversationId !== null && (type === '' || type === 'message' || type === 'msg')) {
    return {
      kind: 'message',
      conversationId: conversationId,
      vid: typeof o.vid === 'string' ? o.vid.slice(0, 40) : '',
      email: typeof o.email === 'string' ? o.email.slice(0, 120) : '',
      text: texte,
      team: typeof o.team === 'string' ? o.team.slice(0, 60) : '',
      kyberId: typeof o.kyberId === 'string' && o.kyberId !== '' ? slugSur(o.kyberId) : slugSur(typeof o.team === 'string' ? o.team : ''),
      brut: o,
    }
  }
  return null
}

/** Lit la base du gateway dans un objet de réglages (`gatewayBase`). `null` = aucune : le watcher reste inactif.
 *  Il n'y a PLUS de base par défaut : ce gateway (`/gateway/poll`, `/widget/api/reply`, `/telecommande/*`) n'existe que sur l'ancienne
 *  pile, et le serveur Kybernos par défaut ne l'a pas. Y parler est un choix explicite (réglage écrit à la main). */
export function lireBaseGateway (reglages) {
  const o = (reglages !== null && reglages !== undefined && typeof reglages === 'object') ? reglages : {}
  const b = typeof o.gatewayBase === 'string' ? o.gatewayBase.trim().replace(/\/+$/, '') : ''
  return b !== '' ? b : null
}

/** Lit le token d'appairage dans un objet de réglages. `null` = inactif. */
export function lireTokenAppairage (reglages) {
  const o = (reglages !== null && reglages !== undefined && typeof reglages === 'object') ? reglages : {}
  const t = typeof o.pairingToken === 'string' ? o.pairingToken.trim() : ''
  return t !== '' ? t : null
}

/** Empreinte du token, pour l'état affiché : le token en clair ne sort jamais. */
export const empreinteToken = (token) => createHash('sha256').update(String(token === null || token === undefined ? '' : token)).digest('hex').slice(0, 12)

/**
 * §8 — lecture TOLÉRANTE de `GET /telecommande/sync/settings` :
 * `{ok, workspace_id, categories:{equipes, taches, evenements, chiffres}}`.
 * Défaut SÛR du contrat : tout-false — une catégorie désactivée = feed vide
 * `{ok, syncAllowed:false}` + poussée 403 `sync_disabled` ; une réponse
 * illisible ou absente se lit pareil (aucune sync), jamais l’inverse.
 */
export function lireSyncSettings (brut) {
  const o = brut !== null && brut !== undefined && typeof brut === 'object' ? brut : {}
  const cats = o.categories !== null && o.categories !== undefined && typeof o.categories === 'object' ? o.categories : {}
  const categories = {}
  for (const c of GATEWAY_SYNC_CATEGORIES) categories[c] = cats[c] === true
  return {
    ok: o.ok === true,
    workspaceId: typeof o.workspace_id === 'string' ? o.workspace_id.slice(0, 120) : '',
    categories: categories,
  }
}

/** §8 : une catégorie n’est synchronisable QUE si les réglages sont lus (`ok`) et la marquent `true`. */
export function syncAutorisee (reglages, categorie) {
  const s = reglages !== null && reglages !== undefined && typeof reglages === 'object' ? reglages : {}
  if (s.ok !== true) return false
  const c = String(categorie === null || categorie === undefined ? '' : categorie)
  return GATEWAY_SYNC_CATEGORIES.indexOf(c) >= 0 && s.categories !== undefined && s.categories !== null && s.categories[c] === true
}

/** §8 : la liste des catégories à true, dans l’ordre du contrat. */
export function categoriesSyncAutorisees (reglages) {
  return GATEWAY_SYNC_CATEGORIES.filter((c) => syncAutorisee(reglages, c))
}

// ─── §8 : tirage « equipes » (le cloud est la source, la webapp décide) ─────

/** Ops du flux §8 — `removed` couvre delete ET archive (le payload porte alors
 * `archived_at`) ; `modified` couvre settings, color/glyph, rename, move, crew. */
export const GATEWAY_SYNC_OPS = ['new', 'modified', 'removed']

/** Corps de GET /telecommande/sync/changes — lecture tolérante : un item
 * incomplet est ignoré, jamais levé (le tirage est best-effort). */
export function lireChanges (brut) {
  const out = { ok: false, cursor: '', resync: false, changes: [] }
  if (brut === null || brut === undefined || typeof brut !== 'object') return out
  out.ok = brut.ok === true
  out.resync = brut.resync === true
  if (typeof brut.cursor === 'string') out.cursor = brut.cursor
  if (Array.isArray(brut.changes)) {
    for (const c of brut.changes) {
      if (c === null || c === undefined || typeof c !== 'object') continue
      const changeId = typeof c.changeId === 'string' ? c.changeId : ''
      const op = typeof c.op === 'string' ? c.op : ''
      if (changeId === '' || GATEWAY_SYNC_OPS.indexOf(op) < 0) continue
      out.changes.push({
        changeId: changeId,
        op: op,
        resourceId: typeof c.resourceId === 'string' ? c.resourceId : '',
        payload: (c.payload !== null && c.payload !== undefined && typeof c.payload === 'object') ? c.payload : {},
        updatedAt: typeof c.updatedAt === 'string' ? c.updatedAt : '',
      })
    }
  }
  return out
}

/** Échappement YAML double-quote (une seule ligne — les retours vont au bloc). */
const yEchapp = (v) => '"' + String(v === null || v === undefined ? '' : v).replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"'
/** Scalaire plié `>-` — les paragraphes du payload gardent leurs lignes. */
const yBloc = (v) => {
  const lignes = String(v === null || v === undefined ? '' : v).replaceAll('\r', '').split('\n').map((l) => l.trim()).filter((l) => l !== '')
  if (lignes.length === 0) return ' ""'
  return ' >-\n' + lignes.map((l) => '  ' + l).join('\n')
}

/** Projection kyber.yml (specVersion 2) d'un payload cloud — minime et
 * honnête : seuls les champs RÉELS du payload sont projetés (mission = pitch,
 * roles = crew avec leur rôle et leur description), jamais de champ inventé ;
 * l'étage unique `equipe` se borne à faire tourner l'équipage une fois. Le
 * nom et la catégorie du cloud vivent en commentaire (le spec local n'en a
 * pas) ; `archived_at` n'a pas de fichier (un archivé = dossier supprimé). */
export function kyberYml (payload) {
  const p = (payload !== null && payload !== undefined && typeof payload === 'object') ? payload : {}
  const crew = Array.isArray(p.crew) ? p.crew.filter((a) => a !== null && a !== undefined && typeof a === 'object') : []
  const sort = []
  sort.push('# Kyber synchronisé depuis kybernos.app — catégorie « equipes », contrat gateway §8.')
  sort.push('# Projection minimale écrite par le watcher @local/kybernos : ce fichier est')
  sort.push('# RÉÉCRIT à chaque changement cloud — une édition locale ne remonte pas.')
  sort.push('# Nom : ' + String(p.name === null || p.name === undefined ? '' : p.name))
  sort.push('# Catégorie : ' + String(p.cat === null || p.cat === undefined ? '' : p.cat))
  sort.push('id: ' + yEchapp(GATEWAY_SYNC_PREFIXE_DOSSIER + String(p.id === null || p.id === undefined ? '' : p.id)))
  sort.push('specVersion: 2')
  sort.push('mission:' + yBloc(p.pitch))
  if (crew.length > 0) {
    const ids = crew.map((a, i) => slugSur(a.role_key || a.name || ('agent-' + String(i + 1))))
    sort.push('roles:')
    for (let i = 0; i < crew.length; i++) {
      const a = crew[i]
      sort.push('  - id: ' + yEchapp(ids[i]))
      sort.push('    role: ' + yEchapp(String(a.role_key || 'analyst')))
      if (a.does !== null && a.does !== undefined && String(a.does).trim() !== '') sort.push('    prompt:' + yBloc(a.does))
    }
    sort.push('stages:')
    sort.push('  - id: equipe')
    sort.push('    roles: [' + ids.map((id) => yEchapp(id)).join(', ') + ']')
    sort.push('    mode: once')
  }
  return sort.join('\n') + '\n'
}

// ── Signaux internes ───────────────────────────────────────────────────────

class ErreurRevoquee extends Error {
  constructor () {
    super('token révoqué (401)')
    this.name = 'ErreurRevoquee'
    this.revoquee = true
  }
}
const estRevoquee = (e) => e !== null && e !== undefined && e.revoquee === true

// 4xx définitif (400/404/409…) : la livraison ne réussira JAMAIS en réessai —
// dead-letter (état terminal « echec ») au lieu d'une boucle de backoff infinie.
class ErreurDefinitive extends Error {
  constructor (status, chemin) {
    super('http ' + String(status) + ' ' + String(chemin))
    this.name = 'ErreurDefinitive'
    this.status = status
    this.definitive = true
  }
}
const estDefinitive = (e) => e !== null && e !== undefined && e.definitive === true

// ── Fabrication du watcher ─────────────────────────────────────────────────

/**
 * Crée le watcher long-poll + file locale.
 *
 * Options (toutes facultatives) :
 * - `dshHome`   : home DSH (string ou () => string|Promise<string>) — défaut
 *                 `$DSH_HOME` puis `~/.dsh` (même règle que le paquet DSH) ;
 * - `settingsPath` : chemin du settings.json — défaut `<home>/kybernos/settings.json` ;
 * - `stateDir`  : dossier de la file + des conversations JSONL — défaut
 *                 `<home>/kybernos-widget` (LE MÊME magasin que le pont local) ;
 * - `base`      : origine cloud — défaut `gatewayBase` des réglages ; sans
 *                 l'un ni l'autre, le watcher reste inactif (aucun hôte par défaut) ;
 * - `fetchImpl` : transport HTTP — défaut `fetch` global ;
 * - `rpc`       : `(method, args, timeoutMs)` RPC local DSH — défaut : RPC
 *                 local par cookie signé (transport du pont widget) ;
 * - `setActiveKyber` : `({sessionId, kyberId})` (active-set) — défaut : journal ;
 * - `log`       : journal — défaut `console.log`, tout passe par `journal()` ;
 * - `delaiPollMs`  : borne cliente du long-poll (25 s, §7) ;
 * - `delaiRepriseMs` / `delaiRepriseMaxMs` : backoff simple en cas d'échec ;
 * - `reactivationMs` : relecture des réglages quand le module est inactif (60 s,
 *                 `0` = désactivé) — un appairage tardif finit par démarrer le
 *                 watcher sans relance ;
 * - `antiTourbillonMs` : pause minimale si le cloud répond vide sans patienter.
 */
export function createGatewayWatcher (options) {
  const opts = options !== null && options !== undefined && typeof options === 'object' ? options : {}
  const logBrut = typeof opts.log === 'function' ? opts.log : console.log
  const journal = (msg) => { try { logBrut('[gateway] ' + String(msg)) } catch (e) { /* journal muet : le travail continue */ } }
  const fetchImpl = typeof opts.fetchImpl === 'function' ? opts.fetchImpl : (typeof globalThis.fetch === 'function' ? globalThis.fetch : null)

  const delaiPollMs = typeof opts.delaiPollMs === 'number' && opts.delaiPollMs > 0 ? opts.delaiPollMs : 25000
  const delaiRepriseMs = typeof opts.delaiRepriseMs === 'number' && opts.delaiRepriseMs > 0 ? opts.delaiRepriseMs : 1000
  const delaiRepriseMaxMs = typeof opts.delaiRepriseMaxMs === 'number' && opts.delaiRepriseMaxMs > 0 ? opts.delaiRepriseMaxMs : 60000
  const reactivationMs = typeof opts.reactivationMs === 'number' && opts.reactivationMs >= 0 ? opts.reactivationMs : 60000
  const antiTourbillonMs = typeof opts.antiTourbillonMs === 'number' && opts.antiTourbillonMs >= 0 ? opts.antiTourbillonMs : 1000

  // ── Chemins : home DSH, réglages, file, conversations ────────────────────
  // Home DSH en SYNCHRONE (même règle que le paquet DSH : `DSH_HOME`, sinon
  // `<home utilisateur>/.dsh`) — `demarrer()` doit savoir s'il y a un token
  // avant d'engager la moindre boucle.
  const homeDshSync = () => {
    if (typeof opts.dshHome === 'string' && opts.dshHome !== '') return opts.dshHome
    // Une fonction de home SYNCHRONE est aussi servie (la forme async ne peut
    // pas l'être : `demarrer()` doit savoir s'il y a un token sans attendre).
    if (typeof opts.dshHome === 'function') {
      try {
        const v = opts.dshHome()
        if (typeof v === 'string' && v !== '') return v
      } catch (e) { /* home non résoluble en synchrone : règle d'environnement */ }
    }
    const env = typeof process !== 'undefined' && process.env !== undefined ? process.env : {}
    if (typeof env.DSH_HOME === 'string' && env.DSH_HOME !== '') return env.DSH_HOME
    return join(homedir(), '.dsh')
  }
  const homeDsh = async () => {
    if (typeof opts.dshHome === 'function') {
      const v = await opts.dshHome()
      return typeof v === 'string' && v !== '' ? v : homeDshSync()
    }
    return homeDshSync()
  }
  const cheminSettingsSync = () => {
    if (typeof opts.settingsPath === 'string' && opts.settingsPath !== '') return opts.settingsPath
    return join(homeDshSync(), 'kybernos', 'settings.json')
  }
  const cheminSettings = async () => {
    if (typeof opts.settingsPath === 'string' && opts.settingsPath !== '') return opts.settingsPath
    return join(await homeDsh(), 'kybernos', 'settings.json')
  }
  const lireReglagesSync = () => {
    try { return JSON.parse(readFileSync(cheminSettingsSync(), 'utf8')) } catch (e) { return {} }
  }
  const dossierEtat = async () => {
    if (typeof opts.stateDir === 'string' && opts.stateDir !== '') return opts.stateDir
    return join(await homeDsh(), 'kybernos-widget')
  }
  const cheminFile = async () => join(await dossierEtat(), 'gateway-queue.json')
  const cheminPont = async () => join(await dossierEtat(), 'bridge-state.json')
  // Même magasin que les routes widget locales : conversations/<kyber>/<conv>.jsonl
  const cheminConv = async (conversation) => join(await dossierEtat(), 'conversations', slugSur(conversation.kyberId), String(conversation.id) + '.jsonl')

  const lireReglages = async () => {
    try { return JSON.parse(readFileSync(await cheminSettings(), 'utf8')) } catch (e) { return {} }
  }
  const baseCloud = async () => {
    if (typeof opts.base === 'string' && opts.base !== '') return opts.base.replace(/\/+$/, '')
    const r = await lireReglages()
    const b = lireBaseGateway(r)
    if (b === null) throw new Error('aucune base de gateway (réglage gatewayBase)')
    return b
  }

  // ── RPC local : par défaut, le MÊME transport que le pont widget ─────────
  let cookieRpc = null
  const rpcLocal = async (method, args, timeoutMs) => {
    let base = null
    try { base = readFileSync(join(await homeDsh(), 'logs', 'dsh-web.url'), 'utf8').trim().split('?')[0].replace(/\/$/, '') } catch (e) { throw new Error('url DSH introuvable') }
    if (cookieRpc === null) {
      // Les credentials DSH vivent DANS le home DSH (~/.dsh/.credentials.yaml).
      const raw = readFileSync(join(await homeDsh(), '.credentials.yaml'), 'utf8')
      const at = raw.indexOf('client-connection/browser-session')
      if (at === -1) throw new Error('secret navigateur absent des credentials')
      const m = raw.slice(at).match(/secret:\s*(\S+)/)
      if (m === null) throw new Error('secret du cookie introuvable')
      const secret = Buffer.from(m[1].replaceAll('-', '+').replaceAll('_', '/'), 'base64')
      const b64url = (b) => Buffer.from(b).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
      const authority = base.replaceAll('http://', '').replaceAll('https://', '').replace(/\/$/, '')
      const name = 'dsh-auth-' + b64url(createHash('sha256').update(authority).digest())
      const now = Date.now()
      const corps = b64url(JSON.stringify({ version: 1, authority: authority, issuedAt: now, expiresAt: now + 86400000 }))
      const sig = b64url(createHmac('sha256', secret).update(corps).digest())
      cookieRpc = name + '=v1.' + corps + '.' + sig
    }
    const rep = await fetchImpl(base + '/api/' + method, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieRpc, origin: base, 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({ type: 'client-request', rpcId: String(Date.now()) + '-' + Math.random().toString(36).slice(2, 10), method: method, payload: { args: args } }),
      signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(timeoutMs === undefined ? 20000 : timeoutMs) : undefined,
    })
    const texte = await rep.text()
    let out = null
    try { out = JSON.parse(texte) } catch (e) { throw new Error('RPC ' + method + ' illisible') }
    if (out && out.result && out.result.ok === false) throw new Error('RPC ' + method + ': ' + JSON.stringify(out.result.error).slice(0, 160))
    return (out && out.result && out.result.value !== undefined && out.result.value !== null) ? out.result.value : (out ? out.result : null)
  }
  const rpc = typeof opts.rpc === 'function' ? opts.rpc : rpcLocal
  const activeSet = typeof opts.setActiveKyber === 'function' ? opts.setActiveKyber : async (args) => {
    journal('active-set non branché (kyber ' + String(args && args.kyberId ? args.kyberId : '?') + ') — mémoire d’équipe non liée')
    return { ok: true, ignore: true }
  }

  // ── File locale (§3) : { version, cursor, items[] } ──────────────────────
  let file = { version: GATEWAY_VERSION_FILE, cursor: '', items: [] }
  let ecranDeFumee = false // évite de relire la file à chaque tick : elle est en mémoire
  const ecrireFile = async () => {
    const p = await cheminFile()
    try {
      mkdirSync(join(p, '..'), { recursive: true })
      const tmp = p + '.tmp'
      writeFileSync(tmp, JSON.stringify(file, null, 2) + '\n')
      renameSync(tmp, p)
    } catch (e) { /* écriture refusée : la file mémoire reste la vérité du run */ }
  }
  const chargerFile = async () => {
    try {
      const lue = JSON.parse(readFileSync(await cheminFile(), 'utf8'))
      if (lue !== null && typeof lue === 'object' && Array.isArray(lue.items) === true) {
        file = { version: GATEWAY_VERSION_FILE, cursor: typeof lue.cursor === 'string' ? lue.cursor : '', items: lue.items }
      }
    } catch (e) { /* première passe : file vide */ }
    ecranDeFumee = true
  }

  // ── Pont widget : JSONL des conversations + état de pont partagé ─────────
  const lireConv = async (conversation) => {
    let texte = null
    try { texte = readFileSync(await cheminConv(conversation), 'utf8') } catch (e) { return [] }
    const out = []
    for (const l of texte.split('\n')) {
      if (l.trim() === '') continue
      try { out.push(JSON.parse(l)) } catch (e) { /* ligne torn : ignorée */ }
    }
    return out
  }
  const ecrireConv = async (conversation, ligne) => {
    const p = await cheminConv(conversation)
    try {
      mkdirSync(join(p, '..'), { recursive: true })
      writeFileSync(p, JSON.stringify(ligne) + '\n', { flag: 'a' })
    } catch (e) { throw new Error('conversation illisible: ' + String(e && e.message ? e.message : e)) }
    return p
  }
  const lirePont = async () => {
    try { return JSON.parse(readFileSync(await cheminPont(), 'utf8')) } catch (e) { return {} }
  }
  const ecrirePont = async (etat) => {
    const p = await cheminPont()
    try {
      mkdirSync(join(p, '..'), { recursive: true })
      writeFileSync(p, JSON.stringify(etat, null, 2) + '\n')
    } catch (e) { /* best-effort : le pont retombera sur sa création de session */ }
  }

  // ── État du watcher ─────────────────────────────────────────────────────
  let enMarche = false
  let revoque = false
  let motifArret = null
  let jeton = null
  let derniereErreur = null
  let dernierPollAt = null
  let dernierJournalErreur = null
  let abortCourant = null
  let minuteurSommeil = null
  let reveilSommeil = null
  let minuteurReactivation = null
  const doublonsJournales = new Set()

  const dormir = (ms) => new Promise((resolve) => {
    reveilSommeil = () => {
      reveilSommeil = null
      if (minuteurSommeil !== null) { clearTimeout(minuteurSommeil); minuteurSommeil = null }
      resolve()
    }
    minuteurSommeil = setTimeout(reveilSommeil, ms)
  })
  const reveiller = () => { if (typeof reveilSommeil === 'function') reveilSommeil() }

  // ── Empilement (§3 état 1 : « empilé »), sans doublon (§7) ─────────────
  const empiler = (bruts) => {
    let poses = 0
    if (Array.isArray(bruts) === true) {
      for (const brut of bruts) {
        const item = normaliserItem(brut)
        if (item === null) { journal('item illisible ignoré — ' + JSON.stringify(brut).slice(0, 120)); continue }
        const cle = cleIdempotence(item)
        if (cle === null) { journal('item sans clé d’idempotence ignoré (§7) — ' + JSON.stringify(brut).slice(0, 120)); continue }
        if (file.items.some((i) => i !== null && i !== undefined && i.cle === cle) === true) {
          // Livraison au moins une fois : le renvoi du même item ne crée rien.
          if (doublonsJournales.has(cle) === false) { doublonsJournales.add(cle); journal('doublon ignoré (idempotence §7) — ' + cle) }
          continue
        }
        file.items.push({
          cle: cle,
          kind: item.kind,
          taskId: item.taskId === undefined ? null : item.taskId,
          conversationId: item.conversationId === undefined ? null : item.conversationId,
          vid: item.vid === undefined ? '' : item.vid,
          email: item.email === undefined ? '' : item.email,
          kyberId: item.kyberId === undefined ? '' : item.kyberId,
          team: item.team === undefined ? '' : item.team,
          text: item.text === undefined ? '' : item.text,
          title: item.title === undefined ? '' : item.title,
          etat: 'empile',
          recuA: new Date().toISOString(),
          majA: new Date().toISOString(),
          essais: 0,
          prochaineTentative: 0,
          derniereErreur: null,
          visiteurEcrit: false,
          session: null,
          reponse: null,
          approbation: null,
          aPousser: false,
        })
        poses += 1
      }
    }
    return poses
  }

  // ── Repoussage des réponses (§3 état 4 : « répondu ») ───────────────────
  const poster = async (chemin, corps) => {
    if (fetchImpl === null) throw new Error('fetch indisponible')
    const rep = await fetchImpl((await baseCloud()) + chemin, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', authorization: 'Bearer ' + String(jeton) },
      body: JSON.stringify(corps),
      signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(15000) : undefined,
    })
    if (rep.status === 401) throw new ErreurRevoquee()
    let out = null
    try { out = await rep.json() } catch (e) { out = null }
    if (rep.ok !== true) {
      // 4xx = refus définitif du relais (forme, inconnu, déjà décidé) : ne pas
      // retenter. SAUF 408 (timeout) et 429 (throttle) = transitoires par
      // nature, retentés comme les 5xx. Autres = transitoire, backoff normal.
      const transitoire = rep.status === 408 || rep.status === 429
      if (rep.status >= 400 && rep.status < 500 && transitoire === false) throw new ErreurDefinitive(rep.status, chemin)
      throw new Error('http ' + String(rep.status) + ' ' + chemin)
    }
    return out === null ? { ok: true } : out
  }
  const pousserReponse = async (item) => {
    // Même corps que la route locale POST /widget/api/reply : {kyberId, conversation, text}.
    const out = await poster(GATEWAY_REPLY_PATH, { kyberId: item.kyberId, conversation: item.conversationId, text: item.reponse })
    if (out !== null && out.ok === false) throw new Error('reply refusé: ' + JSON.stringify(out).slice(0, 120))
    item.etat = 'repondu'
    item.majA = new Date().toISOString()
    item.aPousser = false
    journal('réponse repoussée — ' + item.conversationId + ' (' + String(item.reponse).slice(0, 40) + '…)')
  }
  const pousserDecision = async (item) => {
    const d = item.approbation !== null && item.approbation.statut === 'refuser' ? 'refuser' : 'approuver'
    const out = await poster(GATEWAY_DECISION_PATH + encodeURIComponent(String(item.taskId)) + '/decision', { decision: d })
    if (out !== null && out.ok === false) throw new Error('décision refusée: ' + JSON.stringify(out).slice(0, 120))
    item.aPousser = false
    item.majA = new Date().toISOString()
    journal('décision poussée — ' + item.taskId + ' : ' + d)
  }

  // ── Traitement d'un item par le pont widget EXISTANT ────────────────────
  // Mêmes étapes que le pont local (docs/widget-integration.md) :
  // `session/create` → `active-set` → `session/prompt`, puis la réponse revient
  // par `session/projections` (turnOutline) et rejoint le JSONL, exactement
  // comme si elle était arrivée par la route locale.
  const traiterMessage = async (item) => {
    const conv = { kyberId: item.kyberId, id: item.conversationId }
    const etatPont = await lirePont()
    const precedent = etatPont[item.conversationId]
    const s = (precedent !== null && precedent !== undefined && typeof precedent === 'object') ? precedent : { kyberId: item.kyberId, sessionId: null, dispatched: 0, answered: 0 }
    // Comptage des messages visiteurs, AVANT notre append : l'append fera n.
    const n = (await lireConv(conv)).filter((m) => m !== null && m !== undefined && m.role === 'visitor').length + 1

    if (typeof s.sessionId !== 'string' || s.sessionId === '') {
      const cr = await rpc('session/create', { request: {} })
      const sid = cr !== null && cr !== undefined && typeof cr.sessionId === 'string' ? cr.sessionId : null
      if (typeof sid !== 'string' || sid === '') throw new Error('session/create sans sessionId')
      s.sessionId = sid
      try { await activeSet({ sessionId: sid, kyberId: item.kyberId }) } catch (e) { /* active-set est best-effort, comme dans le pont */ }
    }
    // Garde-fou PONT : `dispatched = answered = n` AVANT l'append — un tick du
    // pont pendant la fenêtre voit déjà le message comme dépêché (au moins une
    // fois, JAMAIS deux), et reste idle tant qu'aucun nouveau visiteur n'écrit.
    s.kyberId = item.kyberId
    s.dispatched = n
    s.answered = n
    etatPont[item.conversationId] = s
    await ecrirePont(etatPont)

    if (item.visiteurEcrit !== true) {
      try {
        await ecrireConv(conv, { role: 'visitor', text: item.text, at: new Date().toISOString(), vid: item.vid, email: item.email })
        item.visiteurEcrit = true
      } catch (e) {
        // L'append a échoué : on rend au pont sa vision réelle (n-1 visiteurs).
        s.dispatched = Math.max(0, n - 1); s.answered = s.dispatched
        await ecrirePont(etatPont)
        throw e
      }
    }

    // Base du turnOutline : on ne ramassera que NOTRE tour, jamais un précédent.
    let base = null
    try {
      const pr = await rpc('session/projections', { request: { sessionId: s.sessionId } })
      const ol = pr !== null && pr !== undefined && pr.values !== undefined && pr.values !== null ? pr.values.turnOutline : null
      if (Array.isArray(ol) === true) base = ol.length
    } catch (e) { base = null }
    await rpc('session/prompt', {
      request: {
        requestId: 'kbg-' + item.conversationId + '-' + String(n),
        sessionId: s.sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: '[Widget] Un visiteur de votre site public écrit : « ' + String(item.text).slice(0, 1800) + ' »' }],
      },
    })
    item.session = { id: s.sessionId, base: base }
    item.majA = new Date().toISOString()
    journal('message dépêché au pont — ' + item.conversationId + ' (' + String(item.text).slice(0, 40) + '…)')
  }

  // §3 état 5 : « approuvé / refusé » — la tâche télécommande attend une
  // décision humaine au lieu d'être exécutée en silence.
  const traiterTache = async (item) => {
    if (item.approbation === null || item.approbation === undefined) {
      item.approbation = { statut: 'attente', recuA: new Date().toISOString() }
      item.majA = new Date().toISOString()
      journal('demande d’approbation en attente — ' + String(item.taskId) + (item.title !== '' ? ' (' + item.title + ')' : ''))
    }
    // L'état reste « en cours » jusqu'à `decider()` — jamais d'exécution muette.
    if (item.etat === 'empile' || item.etat === 'tire') item.etat = 'en cours'
  }

  // ── Collecte des réponses IA (§3 état 3 → 4) ────────────────────────────
  const ramasserReponses = async () => {
    for (const item of file.items) {
      if (enMarche === false || revoque === true) return
      if (item.kind !== 'message' || item.etat !== 'en cours' || item.session === null || item.session === undefined || item.reponse !== null) continue
      try {
        const pr = await rpc('session/projections', { request: { sessionId: item.session.id } })
        const ol = pr !== null && pr !== undefined && pr.values !== undefined && pr.values !== null ? pr.values.turnOutline : null
        if (Array.isArray(ol) === false) continue
        if (item.session.base === null || item.session.base === undefined) {
          // Première lecture : on fixe la base au tour déjà présent, puis on attend.
          item.session.base = ol.length
          await ecrireFile()
          continue
        }
        if (ol.length > item.session.base) {
          const tour = ol[ol.length - 1]
          if (tour !== null && tour !== undefined && typeof tour.response === 'string' && tour.response.trim() !== '') {
            item.reponse = tour.response.trim().slice(0, 2000)
            item.majA = new Date().toISOString()
            // Même écriture que le pont : la réponse rejoint le JSONL (role: "kyber").
            await ecrireConv({ kyberId: item.kyberId, id: item.conversationId }, { role: 'kyber', text: item.reponse, at: new Date().toISOString() })
            await ecrireFile()
            journal('réponse du kyber reçue — ' + item.conversationId)
          }
        }
      } catch (e) {
        // Session morte ou RPC muet : on retente au prochain cycle, sans bruit.
        item.derniereErreur = String(e && e.message ? e.message : e)
      }
    }
  }
  const pousserEnAttente = async () => {
    for (const item of file.items) {
      if (enMarche === false || revoque === true) return
      if (item.kind === 'message' && item.etat === 'en cours' && item.reponse !== null) {
        try {
          await pousserReponse(item)
          await ecrireFile()
        } catch (e) {
          if (estRevoquee(e) === true) throw e
          item.derniereErreur = String(e && e.message ? e.message : e)
          item.majA = new Date().toISOString()
          if (estDefinitive(e) === true) {
            // Dead-letter : un refus définitif du relais ne se retente jamais.
            item.etat = 'echec'
            item.aPousser = false
            await ecrireFile()
            journal('livraison échouée définitivement (dead-letter) — ' + item.conversationId + ' : ' + item.derniereErreur)
          }
        }
        continue
      }
      if (item.kind === 'task' && item.aPousser === true && GATEWAY_ETATS_TERMINAUX.indexOf(item.etat) < 0) {
        try {
          await pousserDecision(item)
          await ecrireFile()
        } catch (e) {
          if (estRevoquee(e) === true) throw e
          item.derniereErreur = String(e && e.message ? e.message : e)
          item.majA = new Date().toISOString()
          if (estDefinitive(e) === true) {
            // Dead-letter : décision déjà appliquée ailleurs (409) ou refusée
            // définitivement — jamais de réessai.
            item.etat = 'echec'
            item.aPousser = false
            await ecrireFile()
            journal('livraison échouée définitivement (dead-letter) — ' + item.taskId + ' : ' + item.derniereErreur)
          }
        }
      }
    }
  }

  // ── Drainage strict (§3 : « drainage strict dans l'ordre d'arrivée ») ───
  const drainer = async () => {
    for (const item of file.items) {
      if (enMarche === false || revoque === true) return
      const terminal = GATEWAY_ETATS_TERMINAUX.indexOf(item.etat) >= 0
      const rejouable = item.etat === 'empile' || item.etat === 'tire' || (item.etat === 'en cours' && item.session === null && item.approbation === null)
      if (terminal === true || rejouable === false) continue
      if (typeof item.prochaineTentative === 'number' && item.prochaineTentative > Date.now()) continue
      // §3 état 2 : « tiré » — consommé par le drain (livraison au moins une
      // fois), PUIS §3 état 3 : « en cours » — le pont IA travaille.
      item.etat = 'tire'
      item.majA = new Date().toISOString()
      await ecrireFile()
      item.etat = 'en cours'
      item.majA = new Date().toISOString()
      await ecrireFile()
      try {
        if (item.kind === 'task') await traiterTache(item)
        else await traiterMessage(item)
      } catch (e) {
        if (estRevoquee(e) === true) throw e
        item.essais = (item.essais === undefined ? 0 : item.essais) + 1
        item.derniereErreur = String(e && e.message ? e.message : e)
        item.majA = new Date().toISOString()
        // Rien n'a été engagé (pas de session, pas d'approbation) : on reboucle
        // sur l'état « empilé » avec un pas de temps, jamais en tourbillon.
        if (item.session === null && item.approbation === null) {
          item.etat = 'empile'
          item.prochaineTentative = Date.now() + Math.min(60000, delaiRepriseMs * Math.pow(2, Math.min(item.essais, 6)))
        }
        const msg = 'échec de traitement (' + item.cle + ') — ' + item.derniereErreur
        if (dernierJournalErreur !== msg) { dernierJournalErreur = msg; journal(msg) }
      }
      await ecrireFile()
    }
  }

  // ── Long-poll (§7 : GET /gateway/poll, ?after=<curseur>, ≤ 25 s) ────────
  const sonder = async () => {
    if (fetchImpl === null) throw new Error('fetch indisponible')
    const base = await baseCloud()
    const url = base + GATEWAY_POLL_PATH + '?after=' + encodeURIComponent(String(file.cursor === undefined || file.cursor === null ? '' : file.cursor))
    const ctrl = new AbortController()
    abortCourant = ctrl
    let timeoutDeclenche = false
    // Borne cliente : 25 s au calme (§7), 5 s dès qu'un item est « en cours » —
    // une réponse IA à ramasser ou à repousser ne doit pas attendre la fin d'un
    // long-poll (c'est le tick local de 5 s qui fait la latence cible, §7).
    let borne = delaiPollMs
    if (file.items.some((i) => i !== null && i !== undefined && i.etat === 'en cours') === true) borne = Math.min(borne, 5000)
    const minuteur = setTimeout(() => { timeoutDeclenche = true; ctrl.abort() }, borne + 2000)
    try {
      const rep = await fetchImpl(url, {
        method: 'GET',
        headers: { accept: 'application/json', authorization: 'Bearer ' + String(jeton) },
        signal: ctrl.signal,
      })
      if (rep.status === 401) throw new ErreurRevoquee()
      if (rep.ok !== true) throw new Error('poll http ' + String(rep.status))
      let corps = null
      try { corps = await rep.json() } catch (e) { corps = null }
      dernierPollAt = new Date().toISOString()
      if (corps === null || typeof corps !== 'object') return { items: [], cursor: file.cursor }
      return {
        items: Array.isArray(corps.items) === true ? corps.items : [],
        cursor: typeof corps.cursor === 'string' || typeof corps.cursor === 'number' ? String(corps.cursor) : file.cursor,
      }
    } catch (e) {
      if (estRevoquee(e) === true) throw e
      if (timeoutDeclenche === true || (e !== null && e !== undefined && e.name === 'AbortError')) {
        // §7 : timeout long-poll → {ok:true, items:[]} + reconnexion silencieuse.
        if (enMarche === false) return null
        return { items: [], cursor: file.cursor }
      }
      throw e
    } finally {
      clearTimeout(minuteur)
      abortCourant = null
    }
  }

  // ── §8 : réglages de sync par catégorie (syncAllowed) ───────────────────
  // Le TIRAGE de la catégorie `equipes` vit ci-dessous ; cette couche porte
  // l'ÉTAT + la GARDE que toute sync consulte (la POUSSÉE POST par lot reste
  // à venir, même garde) :
  // - lecture de la route des réglages (même base, même Bearer que le poll) ;
  // - cache 60 s max ; après une erreur réseau : journal dédoublonné, état
  //   FAIL-CLOSED (aucune catégorie autorisée) et relecture au plus tôt 60 s
  //   plus tard — jamais de spam, jamais d'arrêt du poll ;
  // - défaut du contrat : tout-false (catégorie désactivée = feed vide + 403).
  let syncSettings = lireSyncSettings(null)
  let syncLuA = 0 // horodatage du DERNIER ESSAI (succès ou erreur) : borne anti-spam
  let syncErreur = null
  let syncSignature = null // dernière signature journalée : on ne parle qu'au changement
  const fetchSyncSettings = async (force) => {
    const maintenant = Date.now()
    if (force !== true && maintenant - syncLuA < GATEWAY_SYNC_CACHE_MS) return syncSettings
    syncLuA = maintenant
    // Inactivité dure : sans token, RIEN ne sort (même règle que le long-poll) ;
    // la garde reste tout-false jusqu'à la première lecture réussie.
    if (jeton === null || fetchImpl === null) return syncSettings
    try {
      const rep = await fetchImpl((await baseCloud()) + GATEWAY_SYNC_SETTINGS_PATH, {
        method: 'GET',
        headers: { accept: 'application/json', authorization: 'Bearer ' + String(jeton) },
        signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(10000) : undefined,
      })
      if (rep.status === 401) throw new ErreurRevoquee()
      if (rep.ok !== true) throw new Error('http ' + String(rep.status))
      let corps = null
      try { corps = await rep.json() } catch (e) { corps = null }
      syncSettings = lireSyncSettings(corps)
      const autori = categoriesSyncAutorisees(syncSettings).join(', ') || 'aucune'
      if (syncErreur !== null) {
        syncErreur = null
        journal('sync §8 rétablie — catégories autorisées : ' + autori)
      }
      const signature = String(syncSettings.ok) + ':' + JSON.stringify(syncSettings.categories)
      if (syncSignature !== signature) {
        syncSignature = signature
        journal('sync §8 — catégories autorisées : ' + autori)
      }
    } catch (e) {
      if (estRevoquee(e) === true) throw e
      const msg = 'réglages de sync §8 illisibles — sync par catégorie inactive : ' + String(e !== null && e !== undefined && e.message ? e.message : e)
      if (syncErreur !== msg) { syncErreur = msg; journal(msg + ' (relecture dans 60 s)') }
    }
    return syncSettings
  }
  // Garde de l'ÉTAT COURANT : toute poussée/tirage passe par ici —
  // fail-closed tant que les réglages n'ont pas été relus sans erreur.
  const syncAutoriseeCourante = (categorie) => syncErreur === null && syncAutorisee(syncSettings, categorie)
  const categoriesSyncAutoriseesCourantes = () => GATEWAY_SYNC_CATEGORIES.filter((c) => syncAutoriseeCourante(c))

  // ── §8 : tirage « equipes » — le cloud est la source, DSH reflète ────────
  // La webapp décide (interrupteurs du Group) : le tirage ne tourne QUE sur
  // les catégories autorisées (`syncAutoriseeCourante`). Application
  // idempotente par `changeId` (état persisté `gateway-sync-state.json`) ;
  // fichiers écrits sous `~/.dsh/kybers/cloud-<id>/kyber.yml` (préfixe — un
  // kyber fait main n'est JAMAIS écrasé ni supprimé : `removed` ne touche que
  // les chemins tenus dans le ledger `fichiers`). Écriture atomique
  // (tmp + rename). Best-effort TOTAL : une panne de tirage est journalisée
  // (dédoublonnée) et ne casse JAMAIS le long-poll — seul un 401 remonte.
  const cheminSyncEtat = async () => join(await homeDsh(), 'kybernos', 'gateway-sync-state.json')
  let syncEtat = null
  let syncTirageErreur = null
  const lireSyncEtat = async () => {
    if (syncEtat !== null) return syncEtat
    let lue = null
    try {
      const brut = JSON.parse(readFileSync(await cheminSyncEtat(), 'utf8'))
      if (brut !== null && brut !== undefined && typeof brut === 'object') lue = brut
    } catch (e) { lue = null }
    syncEtat = {
      version: GATEWAY_SYNC_ETAT_VERSION,
      cursor: (lue !== null && typeof lue.cursor === 'string') ? lue.cursor : '',
      appliques: (lue !== null && lue.appliques !== null && lue.appliques !== undefined && typeof lue.appliques === 'object') ? lue.appliques : {},
      fichiers: (lue !== null && lue.fichiers !== null && lue.fichiers !== undefined && typeof lue.fichiers === 'object') ? lue.fichiers : {},
    }
    return syncEtat
  }
  const ecrireSyncEtat = async () => {
    const chemin = await cheminSyncEtat()
    mkdirSync(dirname(chemin), { recursive: true })
    const tmp = chemin + '.tmp'
    writeFileSync(tmp, JSON.stringify(await lireSyncEtat()))
    renameSync(tmp, chemin)
  }
  /** Applique UN changement au disque. Retour : '' (rien à faire) ou le chemin
   * posé ; null = échec (le curseur reste bloqué, reprise au prochain cycle). */
  const appliquerChange = async (etatSync, ch) => {
    const rid = (typeof ch.resourceId === 'string' && ch.resourceId !== '') ? ch.resourceId : (typeof ch.payload.id === 'string' ? ch.payload.id : '')
    if (rid === '') {
      journal('sync §8 equipes — changement sans resourceId, ignoré (' + ch.changeId + ')')
      return ''
    }
    if (ch.op === 'removed') {
      const chemin = etatSync.fichiers[rid]
      if (typeof chemin === 'string' && chemin !== '') {
        try { unlinkSync(chemin) } catch (e) { /* déjà absent : l'objectif est atteint */ }
        delete etatSync.fichiers[rid]
        return chemin
      }
      return '' // pas un fichier posé par la sync : jamais un kyber fait main
    }
    try {
      const dossier = join(await homeDsh(), 'kybers', GATEWAY_SYNC_PREFIXE_DOSSIER + slugSur(rid))
      mkdirSync(dossier, { recursive: true })
      const fichier = join(dossier, 'kyber.yml')
      const tmp = fichier + '.tmp'
      writeFileSync(tmp, kyberYml(ch.payload))
      renameSync(tmp, fichier)
      etatSync.fichiers[rid] = fichier
      return fichier
    } catch (e) {
      const msg = 'sync §8 equipes — application impossible (' + ch.changeId + ') : ' + String(e !== null && e !== undefined && e.message ? e.message : e)
      if (syncTirageErreur !== msg) { syncTirageErreur = msg; journal(msg) }
      return null
    }
  }
  /** Un cycle de tirage — appelé EN TÊTE de boucle, après la relecture des
   * réglages (§8), avant le drainage : le poll n'attend jamais la sync. */
  const tirerEquipes = async () => {
    if (jeton === null || fetchImpl === null) return
    if (syncAutoriseeCourante('equipes') !== true) return
    const etatSync = await lireSyncEtat()
    const rep = await fetchImpl((await baseCloud()) + GATEWAY_SYNC_CHANGES_PATH + '?category=equipes&after=' + encodeURIComponent(etatSync.cursor), {
      method: 'GET',
      headers: { accept: 'application/json', authorization: 'Bearer ' + String(jeton) },
      signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(10000) : undefined,
    })
    if (rep.status === 401) throw new ErreurRevoquee()
    if (rep.ok !== true) throw new Error('http ' + String(rep.status))
    let corps = null
    try { corps = await rep.json() } catch (e) { corps = null }
    const lue = lireChanges(corps)
    if (lue.resync === true && (etatSync.cursor !== '' || Object.keys(etatSync.appliques).length > 0)) {
      // Hors fenêtre de rétention (30 j) : repartir du plein.
      etatSync.cursor = ''
      etatSync.appliques = {}
      await ecrireSyncEtat()
      journal('sync §8 equipes — resync complet demandé par le cloud')
      return
    }
    if (lue.ok !== true) return
    let appliques = 0
    for (const ch of lue.changes) {
      if (etatSync.appliques[ch.changeId] !== undefined) continue
      const fait = await appliquerChange(etatSync, ch)
      if (fait === null) return // le curseur n'avance PAS : l'item rejouera
      etatSync.appliques[ch.changeId] = ch.updatedAt !== '' ? ch.updatedAt : new Date().toISOString()
      appliques++
    }
    // Borne du ledger d'idempotence — les plus anciens partent d'abord.
    const ids = Object.keys(etatSync.appliques)
    if (ids.length > 500) { for (const k of ids.slice(0, ids.length - 500)) delete etatSync.appliques[k] }
    etatSync.cursor = lue.cursor
    await ecrireSyncEtat()
    if (appliques > 0) journal('sync §8 equipes — ' + String(appliques) + ' changement(s) appliqué(s), curseur ' + (lue.cursor === '' ? '(vide)' : lue.cursor))
  }

  // ── La boucle : finitions → drainage → long-poll → backoff ──────────────
  // `generation` verrouille l'unicité de la boucle : un arreter() suivi d'un
  // demarrer() rapide ne doit jamais faire tourner DEUX boucles en parallèle.
  let generation = 0
  const boucle = async (maGeneration) => {
    // La file persistée est la première chose chargée : un redémarrage de DSH
    // reprend la file là où elle en était (drainage de reconnexion, §3).
    await chargerFileAuBesoin()
    let attente = delaiRepriseMs
    while (enMarche === true && maGeneration === generation) {
      if (revoque === true) break
      const debutCycle = Date.now()
      try {
        // Le token se RELIT à chaque cycle : appairage tardif, retrait local,
        // rotation = ré-appairage (§4) sans relance de DSH.
        const r = await lireReglages()
        const t = lireTokenAppairage(r)
        if (t === null) {
          journal('token retiré des réglages — watcher inactif')
          motifArret = 'token retiré'
          enMarche = false
          break
        }
        jeton = t
        // §8 — point d'ancrage sync par catégorie : les réglages (syncAllowed)
        // se relisent EN TÊTE de cycle (cache 60 s — un GET léger, au plus une
        // fois par minute). Toute future boucle de sync (tirage
        // GET /telecommande/sync/changes?category=<cat>&after=<curseur>,
        // poussée POST par lot) DOIT passer par `categoriesSyncAutoriseesCourantes()`
        // et ne synchroniser QUE les catégories à true — une catégorie
        // désactivée = feed vide + poussée 403 sync_disabled. Une erreur réseau
        // ici n'arrête JAMAIS le poll ; seul un 401 remonte (arrêt propre, §4).
        await fetchSyncSettings()
        // §8 — tirage « equipes » (source cloud, gated par l'interrupteur) :
        // une panne de tirage n'arrête JAMAIS le poll — seul un 401 remonte.
        try { await tirerEquipes() } catch (e) {
          if (estRevoquee(e) === true) throw e
          const msg = 'tirage sync §8 en échec — ' + String(e !== null && e !== undefined && e.message ? e.message : e)
          if (syncTirageErreur !== msg) { syncTirageErreur = msg; journal(msg + ' (reprise au prochain cycle)') }
        }
        await ramasserReponses()
        await pousserEnAttente()
        await drainer()
        const rep = await sonder()
        if (rep === null) break
        const poses = empiler(rep.items)
        const curseurAvant = file.cursor
        if (rep.cursor !== file.cursor) { file.cursor = rep.cursor }
        // Le curseur avance même quand tout est doublon : le renvoi ne doit pas
        // faire rejouer la file, il doit la faire oublier (idempotence §7).
        if (poses > 0 || curseurAvant !== file.cursor) {
          await ecrireFile()
          if (poses > 0) journal(String(poses) + ' item(s) empilé(s) — curseur ' + String(file.cursor))
        }
        attente = delaiRepriseMs
        // Anti-tourbillon : un cloud qui répond vide SANS patienter ne doit pas
        // transformer la boucle en requêtes à 100 % CPU.
        if (poses === 0 && (Date.now() - debutCycle) < 300) await dormir(antiTourbillonMs > 0 ? antiTourbillonMs : 1000)
      } catch (e) {
        if (estRevoquee(e) === true) {
          revoque = true
          motifArret = 'token révoqué (401)'
          enMarche = false
          journal('token révoqué (401) — watcher arrêté, aucune reconnexion')
          break
        }
        if (enMarche === false) break
        derniereErreur = String(e !== null && e !== undefined && e.message ? e.message : e)
        const msg = 'sondage en échec — ' + derniereErreur
        if (dernierJournalErreur !== msg) { dernierJournalErreur = msg; journal(msg + ' (reprise silencieuse dans ' + String(Math.round(attente / 1000)) + ' s)') }
        await dormir(attente)
        attente = Math.min(delaiRepriseMaxMs, attente * 2)
      }
    }
  }
  let bouclePromesse = null

  const demarrer = () => {
    if (enMarche === true) return true
    if (revoque === true) return false
    const t = lireTokenAppairage(lireReglagesSync())
    if (t === null) {
      // §1 : sans token, RIEU ne sort — strictement local, comme aujourd'hui.
      journal('sans token d’appairage — inactif (strictement local)')
      if (reactivationMs > 0 && minuteurReactivation === null) {
        minuteurReactivation = setInterval(() => {
          if (enMarche === true || revoque === true) return
          if (lireTokenAppairage(lireReglagesSync()) !== null) {
            if (minuteurReactivation !== null) { clearInterval(minuteurReactivation); minuteurReactivation = null }
            journal('token d’appairage détecté — démarrage')
            demarrer()
          }
        }, reactivationMs)
        if (typeof minuteurReactivation.unref === 'function') minuteurReactivation.unref()
      }
      return false
    }
    // Sans base écrite à la main, rien ne sort : aucun hôte par défaut (le serveur Kybernos par défaut n'a pas ce gateway).
    if ((typeof opts.base !== 'string' || opts.base === '') && lireBaseGateway(lireReglagesSync()) === null) {
      journal('token d’appairage sans gatewayBase — inactif (le gateway est un choix explicite, aucun hôte par défaut)')
      return false
    }
    jeton = t
    enMarche = true
    motifArret = null
    derniereErreur = null
    const maGeneration = ++generation
    journal('démarrage — long-poll ' + (opts.base !== undefined ? String(opts.base) : String(lireBaseGateway(lireReglagesSync()))) + GATEWAY_POLL_PATH + ' (token ' + empreinteToken(t) + '…)')
    bouclePromesse = boucle(maGeneration).catch((e) => {
      journal('boucle interrompue — ' + String(e !== null && e !== undefined && e.message ? e.message : e))
      enMarche = false
    })
    return true
  }

  const arreter = () => {
    if (minuteurReactivation !== null) { clearInterval(minuteurReactivation); minuteurReactivation = null }
    if (enMarche === false && bouclePromesse === null) return false
    enMarche = false
    generation += 1
    if (abortCourant !== null) { try { abortCourant.abort() } catch (e) { /* déjà fini */ } }
    reveiller()
    if (motifArret === null) motifArret = 'arrêt demandé'
    journal('arrêt du watcher')
    return true
  }

  // ── Surface pour le branchement côté hôte (routes locales minimales) ────
  const etat = () => {
    const compte = {}
    for (const e of GATEWAY_ETATS) compte[e] = 0
    let approbations = 0
    for (const i of file.items) {
      if (i === null || i === undefined) continue
      if (compte[i.etat] === undefined) compte[i.etat] = 0
      compte[i.etat] += 1
      if (i.kind === 'task' && i.approbation !== null && i.approbation !== undefined && i.approbation.statut === 'attente') approbations += 1
    }
    return {
      ok: true,
      version: GATEWAY_VERSION_FILE,
      actif: enMarche === true,
      enMarche: enMarche === true,
      revoque: revoque === true,
      motifArret: motifArret,
      base: typeof opts.base === 'string' ? opts.base : null,
      tokenPresent: jeton !== null,
      tokenEmpreinte: jeton === null ? null : empreinteToken(jeton),
      curseur: file.cursor,
      dernierPollAt: dernierPollAt,
      derniereErreur: derniereErreur,
      file: compte,
      approbationsEnAttente: approbations,
      // §8 : état des réglages de sync par catégorie, tels que le module les voit.
      sync: {
        ok: syncSettings.ok,
        workspaceId: syncSettings.workspaceId,
        categories: { ...syncSettings.categories },
        luA: syncLuA > 0 ? new Date(syncLuA).toISOString() : null,
        erreur: syncErreur,
        tirageErreur: syncTirageErreur,
        equipesAutorisee: syncAutoriseeCourante('equipes'),
      },
    }
  }
  const demandesApprobation = () => file.items
    .filter((i) => i !== null && i !== undefined && i.kind === 'task' && i.approbation !== null && i.approbation !== undefined && i.approbation.statut === 'attente')
    .map((i) => ({ taskId: i.taskId, title: i.title, text: i.text, recuA: i.recuA, etat: i.etat }))
  /** Décision humaine sur une tâche télécommande : `approuver` ou `refuser`. */
  const decider = async (taskId, decision) => {
    const d = String(decision === null || decision === undefined ? '' : decision).toLowerCase()
    if (d !== 'approuver' && d !== 'refuser') return { ok: false, error: 'decision attendue : approuver ou refuser' }
    const id = idSur(taskId, 120)
    if (id === null) return { ok: false, error: 'taskId invalide' }
    const item = file.items.find((i) => i !== null && i !== undefined && i.kind === 'task' && i.taskId === id && i.approbation !== null && i.approbation !== undefined && i.approbation.statut === 'attente')
    if (item === undefined) return { ok: false, error: 'action inconnue ou deja decidee' }
    const etatDecision = d === 'approuver' ? 'approuve' : 'refuse'
    item.approbation = { statut: d, decideA: new Date().toISOString() }
    item.etat = etatDecision
    item.aPousser = true
    item.majA = new Date().toISOString()
    await ecrireFile()
    journal('décision locale — ' + id + ' : ' + d)
    // La DÉCISION locale est prise quoi qu'il arrive ; la POUSSÉE vers le
    // relais peut échouer — les deux sont rendues séparément (jamais de faux
    // « approuvé » sur la livraison).
    let poussee = true
    try {
      await pousserDecision(item)
      await ecrireFile()
    } catch (e) {
      poussee = false
      if (estRevoquee(e) === true) {
        revoque = true
        motifArret = 'token révoqué (401)'
        enMarche = false
      }
      item.derniereErreur = String(e !== null && e !== undefined && e.message ? e.message : e)
      if (estDefinitive(e) === true) {
        // Dead-letter IMMÉDIATE : sans ça, le cycle suivant retente une fois
        // (2 POST au lieu de 1) avant que pousserEnAttente ne dead-letterise.
        item.etat = 'echec'
        item.aPousser = false
        item.majA = new Date().toISOString()
        await ecrireFile()
        journal('livraison échouée définitivement (dead-letter) — ' + id + ' : ' + item.derniereErreur)
      }
    }
    return { ok: true, etat: etatDecision, taskId: id, pousse: poussee }
  }

  // Le module ne touche à la file qu'au démarrage : pas d'effet de bord à l'import.
  const chargerFileAuBesoin = async () => { if (ecranDeFumee === false) await chargerFile() }

  return {
    demarrer,
    arreter,
    etat: () => etat(),
    demandesApprobation,
    decider,
    // §8 : squelette sync par catégorie — garde + état ; le client de sync
    // (tirage/poussée /telecommande/sync/changes) reste À POSER, sur l'ancre
    // documentée dans boucle(). Ces accès servent les tests et le dépannage.
    fetchSyncSettings,
    syncAutorisee: (categorie) => syncAutoriseeCourante(categorie),
    categoriesSyncAutorisees: () => categoriesSyncAutoriseesCourantes(),
    // Petit accès test/dépannage : la file telle que le module la voit.
    file: () => file,
    // Noyau pur ré-exporté pour que le branchement n'ait qu'un seul import.
    cleIdempotence,
    normaliserItem,
    lireTokenAppairage,
    lireBaseGateway,
  }
}

export default createGatewayWatcher
