#!/usr/bin/env node
/**
 * dsh-relance — relancer DSH web sans se couper soi-même, récupérer l'URL
 * (token), et faire repartir la conversation sans attendre un message humain.
 *
 * Le problème résolu : l'agent tourne DANS le processus `dsh web`. S'il tue ce
 * processus pour le relancer, il se tue lui-même et ne peut plus rien démarrer ;
 * et au redémarrage le token change et la session reste « froide », donc c'est
 * l'utilisateur qui doit réécrire pour réveiller le travail.
 *
 * Trois idées :
 *   1. le redémarrage est fait par un PROCESSUS DÉTACHÉ (ou par launchd) qui
 *      survit à la mort de DSH — `relance` se ré-exécute donc en enfant détaché ;
 *   2. l'URL/token se récupère dans le log de sortie de `dsh web` (le plist
 *      launchd l'y écrit), ou s'ignore complètement (voir 3) ;
 *   3. la reprise passe par l'API HTTP locale avec un cookie signé DÉRIVÉ DU
 *      SECRET PERSISTANT (~/.dsh/.credentials.yaml) : il survit aux
 *      redémarrages, contrairement au token de lancement. On peut alors
 *      `session/prompt` sur une session froide et l'agent repart.
 *
 * Usage :
 *   node ~/.dsh/tools/dsh-relance.mjs status
 *   node ~/.dsh/tools/dsh-relance.mjs url [--open]
 *   node ~/.dsh/tools/dsh-relance.mjs actives [--json] [--all]
 *   node ~/.dsh/tools/dsh-relance.mjs kick   [--session <id>] [--message <txt>] [--port 3080]
 *   node ~/.dsh/tools/dsh-relance.mjs intent [--session <id>] [--message <txt>] [--note <txt>]
 *   node ~/.dsh/tools/dsh-relance.mjs relance [--session <id>] [--message <txt>] [--open] [--wait-ms 120000] [--avec-autres]
 *   node ~/.dsh/tools/dsh-relance.mjs supervise [--once] [--interval 15] | supervise install | supervise uninstall | supervise status
 *   node ~/.dsh/tools/dsh-relance.mjs install [--force] | uninstall
 *
 * `relance` rend la main immédiatement : c'est l'enfant détaché qui coupe DSH,
 * attend que le port réponde, récupère l'URL et envoie le message de reprise.
 * Journal : ~/.dsh/logs/dsh-relance.log
 *
 * GARDE D'APPROBATION (22/09/2026) : si d'autres sessions tournent au moment de
 * la demande, `relance` REFUSE (code 3) tant que `--avec-autres` n'est pas
 * passé. C'est à l'agent — pas au script — de demander l'accord à l'utilisateur
 * (outil d'hôte `relancer_dsh` → panneau d'approbation natif
 * `dsh-client-ui-approval`, ou question dans le chat). Avec `--avec-autres`,
 * TOUTES les sessions qui tournaient à l'instant de la coupe sont journalisées
 * puis réveillées après le redémarrage (une seule fois chacune, via le fichier
 * de réservations `dsh-relance-claims.json`).
 *
 * SUPERVISION (`supervise`) : boucle détachée (LaunchAgent
 * `com.kybernos.dsh-relance`) qui échantillonne les sessions actives, surveille
 * le serveur ET le réseau, et reprend les sessions dont le tour est mort après
 * un retour de l'un ou de l'autre. Le cas « simple coupure réseau » est déjà
 * couvert nativement par `dsh-client-connection` (reconnexion backoff) et
 * `dsh-llm-retry` (réessais au pas de l'agent) ; la supervision est le filet
 * pour ce qui a réellement échoué.
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, openSync, statSync, rmSync } from 'node:fs'
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { connect } from 'node:net'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
// La couche portable : trouver le serveur et lire sa ligne de commande ne
// passent plus par `lsof`/`ps` en dur (absents sous Windows).
import { pidSurPortSync, commandeProcessusSync, demarrageProcessusSync, famille, nomSuperviseur } from './plateforme.mjs'

const SELF = fileURLToPath(import.meta.url)
const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const LOGS = join(HOME, 'logs')
const RELANCE_LOG = join(LOGS, 'dsh-relance.log')
const INTENT_FILE = join(LOGS, 'dsh-relance-intent.json')
const JOURNAL_FILE = join(LOGS, 'dsh-relance-journal.json')
const CLAIMS_FILE = join(LOGS, 'dsh-relance-claims.json')
const SUPERVISE_STATE = join(LOGS, 'dsh-relance-supervise.json')
const SUPERVISE_PAUSE = join(LOGS, 'dsh-relance-supervise.pause')
const SUPERVISE_LABEL = 'com.kybernos.dsh-relance'
const CLAIM_WINDOW_MS = 180_000
const CREDENTIALS = join(HOME, '.credentials.yaml')
const DOMAIN = `gui/${process.getuid?.() ?? ''}`

const DEFAULT_MESSAGE =
  "🔁 Reprise automatique : le serveur DSH vient d'être relancé. Reprends le travail " +
  "interrompu là où il s'est arrêté, sans attendre un message de l'utilisateur."

/** Message envoyé aux AUTRES sessions actives reprises par la relance (elles n'ont pas d'intention notée). */
const DEFAULT_MESSAGE_AUTRES =
  "🔁 Reprise automatique : le serveur DSH a redémarré pendant que cette session travaillait. " +
  "Reprends le travail interrompu là où il s'est arrêté, sans attendre un message de l'utilisateur. " +
  "Si le tour précédent était terminé, réponds simplement que la session est de nouveau disponible."

// ---------------------------------------------------------------- arguments

/**
 * Drapeaux sans valeur. Sans cette liste, `--dry "le titre"` mange le titre
 * (le parseur croit qu'il est la valeur de `--dry`) — un piège silencieux.
 */
const BOOLEENS = new Set(['dry', 'simuler', 'json', 'all', 'open', 'force', 'once', 'run', 'avec-autres', 'start-only', 'launchd', 'verbeux', 'aide', 'help'])

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') { out._.push(...argv.slice(i + 1)); break }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      const key = eq === -1 ? a.slice(2) : a.slice(2, eq)
      const inline = eq === -1 ? undefined : a.slice(eq + 1)
      const next = argv[i + 1]
      if (inline !== undefined) out[key] = inline
      else if (next !== undefined && !next.startsWith('--') && !BOOLEENS.has(key)) { out[key] = next; i++ }
      else out[key] = true
    } else out._.push(a)
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const cmd = args._[0] ?? 'status'
const port = String(args.port ?? 3080)
const authority = `${args.host ?? '127.0.0.1'}:${port}`
const base = `http://${authority}`
const LABEL = args.label && args.label !== true ? String(args.label) : 'com.kybernos.dsh-web'
const flag = (name) => args[name] === true || args[name] === 'true' || args[name] === '1'
const say = (...a) => console.log(...a)
const log = (line) => {
  try { mkdirSync(LOGS, { recursive: true }); appendFileSync(RELANCE_LOG, `[${new Date().toISOString()}] ${line}\n`) } catch {}
}

/** Les logs sont nommés par port : une instance de test ne touche pas ceux de 3080. */
const webOut = port === '3080' ? join(LOGS, 'dsh-web.out.log') : join(LOGS, `dsh-web-${port}.out.log`)
const webErr = port === '3080' ? join(LOGS, 'dsh-web.err.log') : join(LOGS, `dsh-web-${port}.err.log`)
const webUrlFile = port === '3080' ? join(LOGS, 'dsh-web.url') : join(LOGS, `dsh-web-${port}.url`)

// ------------------------------------------------------------ authentification

const b64url = (b) => Buffer.from(b).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')

/** Secret de signature du cookie navigateur, persisté par DSH (survit aux redémarrages). */
function browserSessionSecret() {
  if (!existsSync(CREDENTIALS)) throw new Error(`credentials introuvables: ${CREDENTIALS}`)
  const raw = readFileSync(CREDENTIALS, 'utf8')
  const at = raw.indexOf('client-connection/browser-session')
  if (at === -1) throw new Error('enregistrement client-connection/browser-session absent des credentials')
  const m = raw.slice(at).match(/secret:\s*(\S+)/)
  if (!m) throw new Error('secret du cookie navigateur introuvable')
  const secret = Buffer.from(m[1].replaceAll('-', '+').replaceAll('_', '/'), 'base64')
  if (secret.byteLength !== 32) throw new Error(`secret de taille inattendue (${secret.byteLength})`)
  return secret
}

/** Cookie `dsh-auth-<hash(authority)>` signé HMAC-SHA256, valable 24 h. */
function authCookie(maxAgeMs = 86_400_000) {
  const secret = browserSessionSecret()
  const name = 'dsh-auth-' + b64url(createHash('sha256').update(authority).digest())
  const now = Date.now()
  const body = b64url(Buffer.from(JSON.stringify({ version: 1, authority, issuedAt: now, expiresAt: now + maxAgeMs }), 'utf8'))
  const sig = b64url(createHmac('sha256', secret).update(body).digest())
  return `${name}=v1.${body}.${sig}`
}

/** Un appel RPC unary sur le canal /api de DSH. */
async function rpc(method, argObject, { cookie, timeoutMs = 20_000, sessionHeader } = {}) {
  const rpcId = randomUUID()
  const res = await fetch(`${base}/api/${method}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
      origin: base,
      'sec-fetch-site': 'same-origin',
      ...(sessionHeader ? { 'x-dsh-session': sessionHeader } : {}),
    },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args: argObject } }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = { raw: text } }
  if (res.status !== 200) throw new Error(`HTTP ${res.status} sur ${method}: ${text.trim().slice(0, 200)}`)
  if (body?.result && body.result.ok === false) throw new Error(`${method}: ${body.result.error?.code} — ${body.result.error?.message}`)
  return body?.result?.value
}

async function serverAlive(timeoutMs = 1500) {
  try {
    await fetch(base + '/', { signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' })
    return true
  } catch { return false }
}

// ------------------------------------------------------- sessions actives (natif)

/**
 * `session/list` : DSH expose nativement `running` par session (« l'Agent est en
 * train de tourner »), `agentAvailable`, `parentSessionId`/`origin: 'subagent'`.
 * C'est la seule source de vérité — on n'invente aucun état.
 */
async function sessionsList(timeoutMs = 8_000) {
  const value = await rpc('session/list', { _request: {} }, { cookie: authCookie(), timeoutMs })
  return Array.isArray(value?.items) ? value.items : []
}

/** Une session d'enfant subagent ne se réveille pas par `session/prompt` (session/agent-busy). */
function isSubagentSession(row) {
  return row?.origin === 'subagent' || row?.parentSessionId !== undefined && row.parentSessionId !== null
}

function sessionTitle(row) {
  const v = row?.projections?.values
  const title = v && typeof v.title === 'string' ? v.title : ''
  return title.length > 0 ? title : '(sans titre)'
}

/** Identifiant de la session courante : argument explicite, sinon $DSH_SESSION_ID. */
function currentSessionId() {
  return args.session ?? args['session-id'] ?? process.env.DSH_SESSION_ID
}

/**
 * Sessions qui tournent VRAIMENT, hors enfants subagents.
 * @param exclude - session à ne pas compter (la session courante, en général).
 * @param includeSubagents - garder les enfants (diagnostic seulement).
 */
async function runningSessions({ exclude, includeSubagents = false } = {}) {
  const items = await sessionsList()
  return items.filter((row) => row && row.running === true
    && (includeSubagents || !isSubagentSession(row))
    && (exclude === undefined || row.sessionId !== exclude))
}

function describeSession(row) {
  return `${row.sessionId}  ${sessionTitle(row)}`
}

// -------------------------------------------------- journal et réservations

function readJson(file, fallback) {
  if (!existsSync(file)) return fallback
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return fallback }
}

function writeJson(file, value) {
  try {
    mkdirSync(LOGS, { recursive: true })
    writeFileSync(file, JSON.stringify(value, null, 2) + '\n')
  } catch (error) { log(`écriture ${file} impossible — ${error?.message ?? error}`) }
}

/**
 * Photographie les sessions actives AVANT la coupe : c'est cette liste, et elle
 * seule, qui sera réveillée après le redémarrage.
 */
async function snapshotActives(primary) {
  const sessions = []
  if (primary) sessions.push({ id: primary, title: '(session courante)', primary: true })
  let observed = []
  try {
    observed = await runningSessions({ exclude: primary })
  } catch (error) {
    log(`snapshot: session/list indisponible — ${error?.message ?? error}`)
  }
  for (const row of observed) sessions.push({ id: row.sessionId, title: sessionTitle(row), updatedAt: row.updatedAt })
  return sessions
}

function writeJournal({ primary, sessions, reason }) {
  const journal = {
    at: new Date().toISOString(),
    reason: reason ?? 'relance demandée',
    primary: primary ?? null,
    sessions: sessions.filter((s) => typeof s?.id === 'string' && s.id.length > 0),
  }
  writeJson(JOURNAL_FILE, journal)
  log(`journal: ${journal.sessions.length} session(s) à reprendre — ${journal.sessions.map((s) => s.id).join(', ')}`)
  return journal
}

function readJournal() {
  return readJson(JOURNAL_FILE, undefined)
}

function claim(sessionId, reason) {
  const claims = readJson(CLAIMS_FILE, {})
  claims[sessionId] = { at: Date.now(), reason: reason ?? null }
  writeJson(CLAIMS_FILE, claims)
}

function claimedRecently(sessionId, windowMs = CLAIM_WINDOW_MS) {
  const claims = readJson(CLAIMS_FILE, {})
  const row = claims?.[sessionId]
  return typeof row?.at === 'number' && Date.now() - row.at < windowMs
}

/**
 * Réveille les sessions journalisées (et, à défaut, celles du dernier
 * échantillon de supervision). Chaque session n'est réveillée qu'une fois par
 * fenêtre de réservation — l'enfant de relance et le superviseur peuvent donc
 * appeler cette fonction tous les deux sans doubler les messages.
 *
 * @param reason - motif inscrit dans les réservations et le journal.
 * @param targets - liste explicite d'identifiants (le superviseur passe la sienne,
 *   gardée en mémoire) ; sinon le journal récent et le dernier échantillon.
 * @returns compteurs : `kicked` (messages envoyés), `skipped` (déjà réservées ou encore actives), `failed` (refus définitif).
 */
async function resumeActives({ reason, sessionId, message, targets: imposés } = {}) {
  const journal = readJournal()
  const frais = journal && Date.parse(journal.at) > Date.now() - 3_600_000 ? journal : undefined
  const samples = readJson(SUPERVISE_STATE, undefined)
  const primary = sessionId ?? frais?.primary ?? sessionIdFromArgs()

  const targets = new Map()
  if (Array.isArray(imposés)) {
    for (const id of imposés) if (typeof id === 'string' && id.length > 0) targets.set(id, { id })
  } else {
    if (primary) targets.set(primary, { id: primary, primary: true })
    for (const row of frais?.sessions ?? []) {
      if (row?.id && !targets.has(row.id)) targets.set(row.id, { id: row.id })
    }
    for (const row of samples?.running ?? []) {
      if (row?.id && !targets.has(row.id)) targets.set(row.id, { id: row.id })
    }
  }
  if (primary && targets.has(primary)) targets.get(primary).primary = true
  if (targets.size === 0) { log('reprise: aucune session à réveiller'); return { kicked: 0, skipped: 0, failed: 0 } }

  let live = new Set()
  try { live = new Set((await runningSessions()).map((row) => row.sessionId)) } catch {}

  let kicked = 0
  let skipped = 0
  let failed = 0
  for (const target of targets.values()) {
    const id = target.id
    if (claimedRecently(id)) { log(`reprise: ${id} déjà réveillée récemment — ignorée`); skipped++; continue }
    if (live.has(id)) { log(`reprise: ${id} tourne encore — inutile de la réveiller`); skipped++; continue }
    const text = target.primary
      ? (message && message !== true ? String(message) : composeMessage(message))
      : DEFAULT_MESSAGE_AUTRES
    if (await kickSession(id, text, 6)) {
      claim(id, reason ?? 'reprise')
      kicked++
      log(`reprise: envoyée à ${id}${target.primary ? ' (session courante)' : ''}`)
    } else {
      failed++
      log(`reprise: ÉCHEC pour ${id} (voir les tentatives ci-dessus)`)
    }
  }
  log(`reprise: ${kicked} relancée(s), ${skipped} ignorée(s), ${failed} échec(s) — motif: ${reason ?? 'manuel'}`)
  return { kicked, skipped, failed }
}

async function cmdActives() {
  const sessionId = currentSessionId()
  let rows
  try {
    rows = await runningSessions({ exclude: sessionId, includeSubagents: flag('all') })
  } catch (error) {
    say(`✗ lecture des sessions impossible : ${error?.message ?? error}`)
    return 1
  }
  const journal = readJournal()
  if (flag('json')) {
    say(JSON.stringify({
      current: sessionId ?? null,
      others: rows.map((row) => ({ sessionId: row.sessionId, title: sessionTitle(row), updatedAt: row.updatedAt, origin: row.origin ?? null })),
      journal: journal ? { at: journal.at, sessions: journal.sessions.map((s) => s.id) } : null,
      supervision: existsSync(SUPERVISE_STATE) ? readJson(SUPERVISE_STATE, null) : null,
    }, null, 2))
    return 0
  }
  if (rows.length === 0) {
    say(`aucune autre session en cours${sessionId ? ` (courante : ${sessionId})` : ''}`)
  } else {
    say(`${rows.length} autre(s) session(s) en cours :`)
    for (const row of rows) say(`  · ${describeSession(row)}`)
  }
  if (journal) say(`journal de reprise : ${journal.sessions.length} session(s) — ${journal.at} (${journal.reason})`)
  return rows.length > 0 ? 3 : 0
}

// ---------------------------------------------------------------------- nommage

/**
 * Appel RPC générique sur le canal local — la porte de secours quand aucune
 * commande dédiée n'existe (`commands/execute`, `session/list`, …). Le cookie
 * est forgé depuis le secret persistant : ça marche sans token et sans
 * navigateur, même sandbox fermé (aucun fichier touché).
 */
async function cmdRpc() {
  const methode = args._[1] ?? (typeof args.method === 'string' ? args.method : undefined)
  if (methode === undefined) {
    say('usage: rpc <méthode> [json]  — ex. rpc commands/list \'{"agentId":"session-…"}\'')
    return 2
  }
  const brut = args._[2] ?? (typeof args.json === 'string' ? args.json : '{}')
  let charge
  try { charge = JSON.parse(brut) } catch (e) {
    say(`✗ JSON invalide : ${e?.message ?? e}`)
    return 2
  }
  const valeur = await rpc(methode, charge, { cookie: authCookie() })
  say(JSON.stringify(valeur, null, 2))
  return 0
}

/** Slugs de catégorie connus du plugin (la liste de référence vit dans `kybernos-sessions`). */
const CATEGORIES = ['fonctionnalite', 'correctif', 'ui', 'doc', 'integration', 'donnees', 'nettoyage', 'question']

/**
 * Nomme une session SANS navigateur — l'outil de nommage habituel
 * (`session-titre.mjs`) exige le Chrome de debug et une page ouverte sur la
 * session, donc il ne sert à rien après un redémarrage ou dans un terminal nu.
 *
 * Deux écritures, les mêmes que la GUI :
 *   1. `session/rename` — l'événement `session/title` source « user », celui qui
 *      épingle le titre et supprime la génération automatique ;
 *   2. `POST /kybernos-sessions/categories` — SEUL écrivain du registre de
 *      catégories : c'est lui qui fait peindre l'icône SVG devant la ligne.
 */
async function cmdTitre() {
  const titre = typeof args.titre === 'string' ? args.titre : (args._[1] ?? '')
  const cat = typeof args.cat === 'string' ? args.cat : ''
  const sienne = process.env.DSH_SESSION_ID
  const sessionId = args.session ?? args['session-id'] ?? sienne
  if (typeof titre !== 'string' || titre.trim().length === 0 || cat.length === 0) {
    say('usage: titre "Le titre de la session" --cat <slug> [--session <id>] [--dry]')
    say(`  catégories : ${CATEGORIES.join(' · ')}`)
    return 2
  }
  if (sessionId === undefined) {
    say('✗ aucune session cible : $DSH_SESSION_ID absent et --session non fourni')
    return 1
  }
  if (sienne !== undefined && args.session !== undefined && args.session !== sienne) {
    say(`⚠ tu renommes une AUTRE session (${sessionId}) que la tienne (${sienne})`)
  }
  if (flag('dry')) {
    say(`(simulation) titre « ${titre} » — catégorie ${cat} — session ${sessionId}`)
    return 0
  }
  const cookie = authCookie()
  try {
    const r = await rpc('session/rename', { request: { sessionId, title: titre } }, { cookie })
    say(`titre posé : « ${r?.title ?? titre} » (seq ${r?.seq ?? '?'})`)
  } catch (error) {
    say(`✗ renommage refusé : ${error?.message ?? error}`)
    return 1
  }
  try {
    const res = await fetch(`${base}/kybernos-sessions/categories`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin: base, 'sec-fetch-site': 'same-origin' },
      body: JSON.stringify({ session: sessionId, cat, titre }),
      signal: AbortSignal.timeout(10_000),
    })
    const corps = await res.json().catch(() => ({}))
    if (!res.ok || corps?.ok === false) {
      say(`✗ catégorie non enregistrée (HTTP ${res.status}) : ${JSON.stringify(corps).slice(0, 200)}`)
      say('  le titre est posé, mais aucune icône ne sera peinte')
      return 1
    }
    say(`catégorie « ${cat} » enregistrée — l'icône SVG apparaît devant la ligne`)
  } catch (error) {
    say(`✗ catégorie non enregistrée : ${error?.message ?? error}`)
    return 1
  }
  log(`titre: « ${titre} » (${cat}) sur ${sessionId}`)
  return 0
}

// ------------------------------------------------------------------- services

/**
 * Dernière URL du log. `sinceOffset` restreint la lecture à ce qui a été écrit
 * APRÈS le redémarrage : sans ça on relit le token du processus précédent, qui
 * ne vaut plus rien (le nouveau `dsh web` publie son URL après avoir écouté).
 */
function webUrlFromLog(sinceOffset = 0) {
  if (!existsSync(webOut)) return undefined
  const raw = readFileSync(webOut, 'utf8')
  const lines = (sinceOffset > 0 ? raw.slice(sinceOffset) : raw).split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(new RegExp(`http://(?:127\\.0\\.0\\.1|localhost):${port}/\\S+`))
    if (m) return m[0]
  }
  return undefined
}

/** Millisecondes de démarrage du processus qui écoute sur le port. */
function processStartTime(pid) {
  try {
    const raw = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' }).trim()
    const t = Date.parse(raw)
    return Number.isNaN(t) ? undefined : t
  } catch { return undefined }
}

/**
 * L'URL du log est-elle celle du processus COURANT ? Un `dsh web` lancé à la
 * main dans un terminal n'écrit rien dans le log : l'URL qu'on y lit est alors
 * périmée, et le token qui va avec ne vaut plus rien.
 */
function urlIsFresh() {
  const url = webUrlFromLog()
  if (!url) return false
  const pid = pidOnPort()
  if (!pid) return false
  const started = processStartTime(pid)
  if (started === undefined) return true
  try { return statSync(webOut).mtimeMs >= started - 2000 } catch { return false }
}

function isLaunchdLoaded() {
  try { execFileSync('launchctl', ['print', `${DOMAIN}/${LABEL}`], { stdio: 'ignore' }); return true } catch { return false }
}

function pidOnPort() {
  const r = pidSurPortSync(port)
  return r.valeur === null || r.valeur === undefined ? undefined : Number(r.valeur)
}

function processCommand(pid) {
  const r = commandeProcessusSync(pid)
  return r.valeur === null || r.valeur === undefined ? '' : String(r.valeur)
}

function dshBinary() {
  for (const candidate of [process.env.DSH_BIN, '/opt/homebrew/bin/dsh', '/usr/local/bin/dsh']) {
    if (candidate && existsSync(candidate)) return candidate
  }
  try { return execFileSync('which', ['dsh'], { encoding: 'utf8' }).trim() } catch { throw new Error('binaire dsh introuvable') }
}

// ------------------------------------------------------------------ commandes

function sessionIdFromArgs() {
  return args.session ?? args['session-id'] ?? process.env.DSH_SESSION_ID
}

function readIntent() {
  if (!existsSync(INTENT_FILE)) return undefined
  try { return JSON.parse(readFileSync(INTENT_FILE, 'utf8')) } catch { return undefined }
}

function composeMessage(explicit) {
  if (explicit && explicit !== true) return String(explicit)
  const intent = readIntent()
  const parts = [DEFAULT_MESSAGE]
  if (intent?.message) parts.push(intent.message)
  if (intent?.note) parts.push(`Note laissée avant la relance : ${intent.note}`)
  return parts.join('\n\n')
}

async function cmdKick() {
  const sessionId = sessionIdFromArgs()
  if (!sessionId) throw new Error('session inconnue : passe --session <id> (ou lance depuis DSH pour hériter de $DSH_SESSION_ID)')
  const message = composeMessage(args.message)
  if (!(await serverAlive())) throw new Error(`le serveur ${base} ne répond pas`)
  if (!(await apiReady())) throw new Error(`l'API ${base} répond mais ses services ne sont pas montés`)
  await kickSession(sessionId, message, 1, true)
  log(`kick ok session=${sessionId}`)
  say(`✓ reprise envoyée à ${sessionId}`)
  say(`  message : ${message.split('\n')[0].slice(0, 90)}…`)
  return 0
}

/**
 * Envoie un message de reprise à UNE session, avec réessais.
 * @param sessionId - session à réveiller.
 * @param message - texte exact envoyé.
 * @param attempts - nombre de tentatives.
 * @param loud - dire à l'écran ce qui se passe (mode `kick`).
 */
async function kickSession(sessionId, message, attempts = 6, loud = false) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const value = await rpc('session/prompt', {
        request: { requestId: randomUUID(), sessionId, mode: args.mode === 'steer' ? 'steer' : 'queue', content: [{ type: 'text', text: message }] },
      }, { cookie: authCookie() })
      if (loud) say(`  accepté: ${value?.accepted === true ? 'oui' : JSON.stringify(value)}`)
      return true
    } catch (error) {
      const text = String(error?.message ?? error)
      log(`reprise: tentative ${i}/${attempts} pour ${sessionId} refusée — ${text}`)
      // Une session qui n'existe pas ne se réveillera pas en réessayant.
      if (text.includes('session/not-found')) return false
      await sleep(2000)
    }
  }
  return false
}

function cmdIntent() {
  const sessionId = sessionIdFromArgs()
  const payload = {
    sessionId: sessionId ?? null,
    message: args.message && args.message !== true ? String(args.message) : null,
    note: args.note && args.note !== true ? String(args.note) : null,
    at: new Date().toISOString(),
  }
  mkdirSync(LOGS, { recursive: true })
  writeFileSync(INTENT_FILE, JSON.stringify(payload, null, 2) + '\n')
  say(`✓ intention de reprise écrite : ${INTENT_FILE}`)
  if (payload.sessionId) say(`  session : ${payload.sessionId}`)
  return 0
}

function cmdStatus() {
  return (async () => {
  const pid = pidOnPort()
  const loaded = isLaunchdLoaded()
  const url = webUrlFromLog()
  const fresh = urlIsFresh()
  const sessionId = sessionIdFromArgs()
  say(`DSH_HOME        : ${HOME}`)
  say(`API             : ${base} ${serverAliveSync() ? '(répond)' : '(ne répond pas)'}`)
  say(`launchd         : ${loaded ? `chargé (${LABEL})` : 'NON chargé — DSH tourne sans supervision'}`)
  say(`port ${port}        : ${pid ? `pid ${pid} → ${processCommand(pid).slice(0, 70)}` : 'rien qui écoute'}`)
  say(`log web         : ${existsSync(webOut) ? webOut : 'absent (sortie non redirigée : le token sera perdu)'}`)
  say(`URL (token)     : ${url ?? 'introuvable dans le log'}${url && !fresh ? '  ⚠️ PÉRIMÉE (le processus courant n\'écrit pas dans ce log)' : ''}`)
  say(`cookie API      : ${fileHasSecret() ? 'secret persistant trouvé → cookie forgeable sans token' : 'secret ABSENT (API inaccessible en externe)'}`)
  say(`session courante: ${sessionId ?? '(hors DSH : passe --session <id>)'}`)
  let actives = 'serveur muet'
  if (serverAliveSync()) {
    try {
      const rows = await runningSessions({ exclude: sessionId })
      actives = rows.length === 0 ? 'aucune autre' : `${rows.length} autre(s) — ${rows.map((r) => r.sessionId).join(', ')}`
    } catch (error) { actives = `illisible (${String(error?.message ?? error).slice(0, 60)})` }
  }
  say(`sessions actives: ${actives}`)
  say(`supervision     : ${isSuperviseLoaded() ? `chargée (${SUPERVISE_LABEL})` : 'NON chargée (relance non surveillée)'}`)
  const journal = readJournal()
  say(`journal reprise : ${journal ? `${journal.sessions.length} session(s) — ${journal.at} (${journal.reason})` : 'aucun'}`)
  return 0
  })()
}

function serverAliveSync() {
  try {
    execFileSync('curl', ['-s', '-o', '/dev/null', '--max-time', '1', base + '/'])
    return true
  } catch { return false }
}

function fileHasSecret() {
  try { browserSessionSecret(); return true } catch { return false }
}

function cmdUrl() {
  const url = webUrlFromLog()
  if (!url) {
    say(`aucune URL dans ${webOut}`, 'stderr:')
    say(existsSync(webErr) ? readFileSync(webErr, 'utf8').split('\n').slice(-10).join('\n') : '(pas de log d\'erreur)')
    return 1
  }
  say(url)
  if (!urlIsFresh()) say(`⚠️  URL probablement périmée : le processus qui écoute sur ${port} n'écrit pas dans ${webOut}.`)
  if (args.open) { spawn('open', [url], { detached: true, stdio: 'ignore' }).unref(); say('→ ouverture dans le navigateur') }
  return 0
}

function launchdPlistPath() {
  return join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`)
}

/**
 * Bascule DSH sous le LaunchAgent (plist déjà présent, KeepAlive). `force` coupe
 * l'instance non supervisée qui occupe le port — sans ça launchd boucle sur
 * EADDRINUSE.
 */
async function ensureLaunchdAgent({ force = false } = {}) {
  const plist = launchdPlistPath()
  if (!existsSync(plist)) throw new Error(`plist absent : ${plist}`)
  const pid = pidOnPort()
  if (pid && !isLaunchdLoaded()) {
    if (!force) throw new Error(`un DSH non supervisé écoute sur ${port} (pid ${pid}) ; relance avec --force`)
    log(`relance: arrêt du pid ${pid} non supervisé`)
    try { process.kill(pid, 'SIGTERM') } catch {}
    const until = Date.now() + 15_000
    while (Date.now() < until && pidOnPort()) await sleep(500)
  }
  try { execFileSync('launchctl', ['bootout', `${DOMAIN}/${LABEL}`], { stdio: 'ignore' }) } catch {}
  execFileSync('launchctl', ['bootstrap', DOMAIN, plist], { stdio: 'ignore' })
  execFileSync('launchctl', ['kickstart', '-k', `${DOMAIN}/${LABEL}`], { stdio: 'ignore' })
}

async function cmdInstall() {
  try {
    await ensureLaunchdAgent({ force: flag('force') })
  } catch (error) {
    say(`✗ ${error?.message ?? error}`)
    if (String(error?.message ?? '').includes('non supervisé')) {
      say(`   Relance avec --force : cela COUPE la session en cours, puis launchd reprend la main`)
      say(`   et l'enfant détaché réveille la conversation tout seul.`)
    }
    return 1
  }
  say(`✓ launchd a repris DSH (${LABEL}) ; l'URL/token arrivera dans ${webOut}`)
  return 0
}

function cmdUninstall() {
  try { execFileSync('launchctl', ['bootout', `${DOMAIN}/${LABEL}`], { stdio: 'ignore' }); say(`✓ launchd déchargé (${LABEL})`) }
  catch { say('(déjà déchargé)') }
  say(`le plist reste en place : ${launchdPlistPath()}`)
  return 0
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

// ---- `relance` : se détache, coupe, attend, récupère l'URL, réveille ---------

/**
 * GARDE D'APPROBATION. Si d'autres sessions tournent, la relance refuse : c'est
 * à l'agent de demander l'accord (panneau d'approbation natif ou question dans
 * le chat), puis de repasser avec `--avec-autres`.
 * @returns 0 si la voie est libre, 3 si l'accord manque.
 */
async function guardOtherSessions(phase) {
  if (flag('avec-autres')) return 0
  const sessionId = sessionIdFromArgs()
  if (!(await serverAlive()) || !(await apiReady())) return 0 // serveur déjà à terre : rien à interrompre
  let others = []
  try {
    others = await runningSessions({ exclude: sessionId })
  } catch (error) {
    log(`garde (${phase}): session/list illisible — ${error?.message ?? error} ; on laisse passer`)
    return 0
  }
  if (others.length === 0) return 0
  log(`garde (${phase}): ${others.length} autre(s) session(s) active(s) — refus sans --avec-autres`)
  say(`✗ ${others.length} autre(s) session(s) en cours — redémarrage NON lancé :`)
  for (const row of others) say(`   · ${describeSession(row)}`)
  say('')
  say("Demande l'accord à l'utilisateur, puis relance avec `--avec-autres` :")
  say('   node ~/.dsh/tools/dsh-relance.mjs relance --avec-autres')
  say('Toutes les sessions ci-dessus seront réveillées après le redémarrage.')
  return 3
}

function cmdRelance() {
  if (flag('run')) return cmdRelanceRun() // déjà dans l'enfant détaché
  return (async () => {
    const gate = await guardOtherSessions('demande')
    if (gate !== 0) return gate
    if (flag('dry') || flag('simuler')) {
      const sessionId = sessionIdFromArgs()
      const sessions = await snapshotActives(sessionId)
      say(`✓ voie libre — simulation, RIEN n'a été coupé.`)
      say(`seraient reprises après redémarrage (${sessions.length}) :`)
      for (const s of sessions) say(`   · ${s.id}  ${s.title ?? ''}`)
      return 0
    }
    const passthrough = []
    for (const key of ['session', 'message', 'note', 'open', 'wait-ms', 'port', 'host', 'cwd', 'start-only', 'label', 'mode', 'delay', 'launchd', 'avec-autres', 'motif']) {
      if (args[key] !== undefined) passthrough.push(`--${key}`, String(args[key]))
    }
    const out = openSync(RELANCE_LOG, 'a')
    const child = spawn(process.execPath, [SELF, 'relance', '--run', ...passthrough], {
      detached: true,
      stdio: ['ignore', out, out],
      cwd: args.cwd && args.cwd !== true ? String(args.cwd) : process.cwd(),
    })
    child.unref()
    log(`relance détachée lancée (pid ${child.pid}) session=${sessionIdFromArgs() ?? '?'}`)
    say(`✓ relance détachée (pid ${child.pid}) — elle survit à la coupure de DSH`)
    say(`  journal : ${RELANCE_LOG}`)
    return 0
  })()
}

async function cmdRelanceRun() {
  const sessionId = sessionIdFromArgs()
  const waitMs = Number(args['wait-ms'] ?? 120_000)
  const launchd = isLaunchdLoaded()
  if (Number(args.delay) > 0) { log(`relance: attente de ${Number(args.delay)} s avant la coupure`); await sleep(Number(args.delay) * 1000) }
  log(`— relance: début (session=${sessionId ?? '?'}, launchd=${launchd}, port=${port}, avec-autres=${flag('avec-autres')})`)

  // Seconde garde, dans l'enfant : l'état a pu changer depuis la demande.
  if (!flag('start-only')) {
    const gate = await guardOtherSessions('enfant')
    if (gate !== 0) return gate
  }

  // Ce qui compte est écrit APRÈS la coupure : on repart de la taille actuelle du log.
  const sinceOffset = !flag('start-only') && existsSync(webOut) ? statSync(webOut).size : 0
  // Photographie AVANT la coupe : c'est la liste des sessions à réveiller.
  const sessions = await snapshotActives(sessionId)
  writeJournal({ primary: sessionId, sessions, reason: args.motif && args.motif !== true ? String(args.motif) : 'relance demandée' })
  say(`→ ${sessions.length} session(s) seront reprises après le redémarrage.`)

  try {
    if (!flag('start-only')) {
      if (!(await restartAndWait(waitMs))) { log("relance: le serveur n'est pas revenu prêt à temps"); return 1 }
    } else {
      log('relance: --start-only, aucun redémarrage demandé')
      if (!(await apiReady()) && !(await waitForNewServer(pidOnPort(), 15_000))) { log('relance: API non prête'); return 1 }
    }
    log('relance: API prête')
    const url = await waitForUrl(20_000, sinceOffset)
    if (url) {
      writeFileSync(webUrlFile, url + '\n')
      log(`relance: URL récupérée${urlIsFresh() ? '' : ' (périmée ?)'} → ${webUrlFile}`)
      if (flag('open')) spawn('open', [url], { detached: true, stdio: 'ignore' }).unref()
    } else log('relance: URL introuvable dans le log (sortie non redirigée ?)')
    if (sessions.length === 0) { log('relance: aucune session cible, rien à réveiller'); return 0 }
    const resumed = await resumeActives({ reason: 'relance', sessionId, message: args.message })
    return resumed.failed > 0 ? 1 : 0
  } catch (error) {
    log(`relance: échec — ${error?.message ?? error}`)
    return 1
  }
}

/** Coupe puis relance, et attend que l'API soit RÉELLEMENT servie (services montés). */
async function restartAndWait(timeoutMs) {
  const before = pidOnPort()
  if (flag('launchd')) {
    log('relance: bascule vers launchd (agent KeepAlive)')
    try { await ensureLaunchdAgent({ force: true }) } catch (error) { log(`relance: install launchd échoué — ${error?.message ?? error}`) }
    if (await waitForNewServer(before, Math.min(45_000, timeoutMs))) return true
    log('relance: launchd n\'a pas rendu un serveur prêt, repli sur un démarrage détaché')
  }
  if (isLaunchdLoaded()) {
    log('relance: launchctl kickstart -k')
    try { execFileSync('launchctl', ['kickstart', '-k', `${DOMAIN}/${LABEL}`], { stdio: 'ignore' }) } catch (error) {
      log(`relance: kickstart a échoué — ${error?.message ?? error}`)
    }
    if (await waitForNewServer(before, Math.min(45_000, timeoutMs))) return true
    log('relance: launchd n\'a pas rendu un serveur prêt, repli sur un démarrage détaché')
  }
  const pid = pidOnPort()
  if (pid) {
    log(`relance: kill ${pid} (${processCommand(pid).slice(0, 60)})`)
    try { process.kill(pid, 'SIGTERM') } catch {}
    const until = Date.now() + 15_000
    while (Date.now() < until && pidOnPort()) await sleep(400)
    const still = pidOnPort()
    if (still) { log(`relance: SIGTERM insuffisant, SIGKILL ${still}`); try { process.kill(still, 'SIGKILL') } catch {} }
  } else log('relance: rien sur le port, démarrage direct')
  startDetachedWeb()
  return await waitForNewServer(before, timeoutMs)
}

function startDetachedWeb() {
  const bin = dshBinary()
  const out = openSync(webOut, 'a')
  const err = openSync(webErr, 'a')
  const child = spawn(bin, ['web', '--no-open', '--port', port], {
    detached: true,
    stdio: ['ignore', out, err],
    cwd: args.cwd && args.cwd !== true ? String(args.cwd) : process.cwd(),
  })
  child.unref()
  log(`relance: dsh web démarré détaché (pid ${child.pid}), sortie → ${webOut}`)
}

/** Le port répond ET l'API dispatche : un simple TCP ouvert ne suffit pas
 *  (`dsh web` publie son URL bien après avoir écouté). */
async function apiReady(timeoutMs = 3_000) {
  try {
    await rpc('session/list', { _request: {} }, { cookie: authCookie(), timeoutMs })
    return true
  } catch (error) {
    const message = String(error?.message ?? error)
    // une erreur MÉTIER prouve que le service tourne ; les autres disent « pas encore ».
    return !/unavailable|fetch failed|ECONNREFUSED|ECONNRESET|aborted|timeout|socket/i.test(message)
  }
}

async function waitForNewServer(beforePid, timeoutMs) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    const pid = pidOnPort()
    if (pid !== undefined && pid !== beforePid && (await apiReady())) return true
    await sleep(500)
  }
  return false
}

async function waitForUrl(timeoutMs, sinceOffset = 0) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    const url = webUrlFromLog(sinceOffset)
    if (url) return url
    await sleep(500)
  }
  return undefined
}

// ---- `supervise` : veille serveur + réseau, reprise après retour ------------

function supervisePlistPath() {
  return join(homedir(), 'Library', 'LaunchAgents', `${SUPERVISE_LABEL}.plist`)
}

function isSuperviseLoaded() {
  try { execFileSync('launchctl', ['print', `${DOMAIN}/${SUPERVISE_LABEL}`], { stdio: 'ignore' }); return true } catch { return false }
}

/** Un TCP ouvert sur une IP publique suffit : pas de TLS, pas de DNS, pas d'API tierce. */
function tcpAlive(host, tport, timeoutMs = 3_000) {
  return new Promise((resolve) => {
    let settled = false
    const done = (ok) => { if (settled) return; settled = true; try { socket.destroy() } catch {}; resolve(ok) }
    const socket = connect({ host, port: tport })
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

/** Réseau sortant disponible ? (les deux sondes doivent échouer pour dire « coupé ») */
async function internetAlive() {
  if (await tcpAlive('1.1.1.1', 443)) return true
  return await tcpAlive('8.8.8.8', 443)
}

async function waitForApiReady(timeoutMs) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (await apiReady(5_000)) return true
    await sleep(1_000)
  }
  return false
}

function readSuperviseState() {
  const state = readJson(SUPERVISE_STATE, undefined)
  return state && Array.isArray(state.running) ? state : { at: null, running: [] }
}

/** Échantillonne les sessions actives : c'est la liste de reprise si le serveur tombe. */
async function sampleRunning() {
  const rows = await runningSessions()
  const state = { at: new Date().toISOString(), running: rows.map((row) => ({ id: row.sessionId, title: sessionTitle(row), updatedAt: row.updatedAt })) }
  writeJson(SUPERVISE_STATE, state)
  return state
}

async function superviseLoop() {
  const intervalSec = Math.max(5, Number(args.interval ?? 15))
  const graceMs = Math.max(5_000, Number(args['grace-ms'] ?? 45_000))
  log(`supervise: démarrage (pid ${process.pid}, intervalle ${intervalSec}s, grâce ${graceMs}ms, port ${port})`)
  const etat = readSuperviseState()
  const reprendreEtatPersiste = etat.at !== null && Date.now() - Date.parse(etat.at) < 15 * 60_000
  // Les cibles de reprise vivent en MÉMOIRE : un journal ou un échantillon
  // périmé réveillerait une session active il y a trois jours.
  let dernieres = reprendreEtatPersiste ? etat.running.map((row) => row.id) : []
  let prev = { server: await serverAlive(), net: await internetAlive() }
  if (prev.server && prev.net) { try { dernieres = (await sampleRunning()).running.map((row) => row.id) } catch (error) { log(`supervise: échantillon initial impossible — ${error?.message ?? error}`) } }
  let first = true
  for (;;) {
    const server = await serverAlive()
    const net = await internetAlive()
    const paused = existsSync(SUPERVISE_PAUSE)
    if (server && net && !paused) {
      try { dernieres = (await sampleRunning()).running.map((row) => row.id) } catch {}
    }
    const serverBack = server && !prev.server
    const netBack = net && !prev.net
    if (!first && (serverBack || netBack)) {
      const why = serverBack ? 'serveur revenu' : 'réseau revenu'
      if (paused) log(`supervise: ${why} — reprise suspendue (${SUPERVISE_PAUSE})`)
      else {
        log(`supervise: ${why} — attente de grâce (${graceMs} ms) avant reprise de ${dernieres.length} session(s)`)
        await waitForApiReady(serverBack ? 30_000 : 10_000)
        await sleep(graceMs)
        await resumeActives({ reason: why, targets: dernieres })
      }
    }
    prev = { server, net }
    first = false
    if (flag('once')) { log('supervise: --once terminé'); return 0 }
    await sleep(intervalSec * 1_000)
  }
}

function supervisePlistContent() {
  const node = process.execPath
  const logs = LOGS
  const extra = port === '3080' ? '' : `
    <string>--port</string>
    <string>${port}</string>`
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SUPERVISE_LABEL}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${node}</string>
    <string>${SELF}</string>
    <string>supervise</string>
    <string>--interval</string>
    <string>15</string>${extra}
  </array>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>ThrottleInterval</key>
  <integer>15</integer>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>DSH_HOME</key>
    <string>${HOME}</string>
  </dict>

  <key>StandardOutPath</key>
  <string>${logs}/dsh-relance-supervise.out.log</string>
  <key>StandardErrorPath</key>
  <string>${logs}/dsh-relance-supervise.err.log</string>

  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
`
}

function cmdSuperviseInstall() {
  mkdirSync(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true })
  writeFileSync(supervisePlistPath(), supervisePlistContent())
  try { execFileSync('launchctl', ['bootout', `${DOMAIN}/${SUPERVISE_LABEL}`], { stdio: 'ignore' }) } catch {}
  execFileSync('launchctl', ['bootstrap', DOMAIN, supervisePlistPath()], { stdio: 'ignore' })
  execFileSync('launchctl', ['kickstart', '-k', `${DOMAIN}/${SUPERVISE_LABEL}`], { stdio: 'ignore' })
  log(`supervise: installé (${SUPERVISE_LABEL})`)
  say(`✓ supervision permanente installée (${SUPERVISE_LABEL})`)
  say(`  plist   : ${supervisePlistPath()}`)
  say(`  journal : ${LOGS}/dsh-relance-supervise.out.log`)
  say(`  pause   : touch ${SUPERVISE_PAUSE}`)
  return 0
}

function cmdSuperviseUninstall() {
  try { execFileSync('launchctl', ['bootout', `${DOMAIN}/${SUPERVISE_LABEL}`], { stdio: 'ignore' }); say(`✓ supervision déchargée (${SUPERVISE_LABEL})`) }
  catch { say('(supervision déjà déchargée)') }
  say(`le plist reste : ${supervisePlistPath()} (supprime-le pour effacer)` )
  return 0
}

function cmdSuperviseStatus() {
  const state = readSuperviseState()
  say(`supervision : ${isSuperviseLoaded() ? `chargée (${SUPERVISE_LABEL})` : 'NON chargée'}`)
  say(`plist       : ${existsSync(supervisePlistPath()) ? supervisePlistPath() : 'absent'}`)
  say(`pause       : ${existsSync(SUPERVISE_PAUSE) ? 'ACTIVE (aucune reprise automatique)' : 'non'}`)
  say(`dernier échantillon : ${state.at ?? 'aucun'} — ${state.running.length} session(s) active(s)`)
  for (const row of state.running) say(`  · ${row.id}  ${row.title ?? ''}`)
  const claims = readJson(CLAIMS_FILE, {})
  const recent = Object.entries(claims).filter(([, v]) => typeof v?.at === 'number' && Date.now() - v.at < 3_600_000)
  say(`reprises < 1 h : ${recent.length === 0 ? 'aucune' : recent.map(([id, v]) => `${id}@${new Date(v.at).toISOString().slice(11, 19)}`).join(', ')}`)
  return 0
}

async function cmdSupervise() {
  const action = args._[1]
  if (action === 'install') return cmdSuperviseInstall()
  if (action === 'uninstall') return cmdSuperviseUninstall()
  if (action === 'status') return cmdSuperviseStatus()
  if (action === 'pause') {
    writeFileSync(SUPERVISE_PAUSE, `pause posée le ${new Date().toISOString()}\n`)
    say(`✓ reprise automatique suspendue (${SUPERVISE_PAUSE})`)
    return 0
  }
  if (action === 'resume') {
    rmSync(SUPERVISE_PAUSE, { force: true })
    say('✓ reprise automatique réarmée')
    return 0
  }
  return superviseLoop()
}

// ---------------------------------------------------------------------- main

const COMMANDS = {
  status: cmdStatus,
  url: cmdUrl,
  actives: cmdActives,
  titre: cmdTitre,
  rpc: cmdRpc,
  kick: cmdKick,
  intent: cmdIntent,
  relance: cmdRelance,
  supervise: cmdSupervise,
  install: cmdInstall,
  uninstall: cmdUninstall,
}

try {
  const run = COMMANDS[cmd]
  if (!run) {
    say(`commande inconnue: ${cmd}`)
    say('usage: status | url [--open] | actives [--json] | titre "…" --cat <slug> | rpc <méthode> [json] | kick | intent')
    say('       relance [--run] [--avec-autres] [--dry]')
    say('       supervise [--once] [--interval 15] | supervise install|uninstall|status|pause|resume | install | uninstall')
    process.exit(64)
  }
  const code = await run()
  process.exit(typeof code === 'number' ? code : 0)
} catch (error) {
  say(`✗ ${error?.message ?? error}`)
  process.exit(1)
}
