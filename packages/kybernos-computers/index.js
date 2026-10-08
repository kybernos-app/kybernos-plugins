// ── kybernos-computers — half host : sandboxes cloud E2B pour les agents ──────
//
// Phase 1 (règle du chantier) : le half host SEULEMENT.
//   1. garder la clé E2B HORS du navigateur, dans le store de credentials
//      (référence E2B_API_KEY, ~/.dsh/.credentials.yaml, 0600) ;
//   2. cycle de vie des sandboxes : start / exec / write / read / stop, avec
//      TTL automatique et cap de sandboxes simultanées ;
//   3. résoudre le SDK @e2b/sdk paresseusement (bundle node_modules → profil
//      → auto-install dans ~/.dsh/kybernos-computers/node_modules).
//
// Modèle BYOK : le calcul part sur le compte E2B de l'utilisateur. Kybernos
// ne filtre rien, ne facture rien, ne gère aucun quota. La clé ne quitte
// JAMAIS ce module : les routes ne renvoient que des booléens d'état.
//
// Contrat des routes (same-origin, jamais exposées au réseau) :
//   GET  /kybernos-computers/status          → { keyPresent, sdkReady, sandboxCount }
//   POST /kybernos-computers/key/set         → pose le credential E2B_API_KEY
//   POST /kybernos-computers/key/clear       → retire la clé + arrête les sandboxes
//   GET  /kybernos-computers/sandboxes       → liste suivie localement (+ vivantes ?)
//   POST /kybernos-computers/sandboxes/start → démarre une sandbox {label?, ttlMs?}
//   POST /kybernos-computers/sandboxes/exec  → {sandboxId, command, timeoutMs?}
//   POST /kybernos-computers/sandboxes/write → {sandboxId, path, content}
//   GET  /kybernos-computers/sandboxes/read  → ?sandboxId=&path=
//   POST /kybernos-computers/sandboxes/stop  → {sandboxId, confirm:true}
//
// Le SDK est INJECTABLE pour les tests (setSdkForTests) : test-computers-host.mjs
// tourne sans clé et sans réseau.
import { chmodSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const BUNDLE_DIR = dirname(fileURLToPath(import.meta.url))
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const DATA_DIR = join(DSH_HOME, 'kybernos-computers')
const STATE_FILE = join(DATA_DIR, 'state.json')
const SDK_INSTALL_DIR = join(DATA_DIR, 'node_modules')

const CRED_REF = 'E2B_API_KEY' // même convention que KYBERNOS_API_KEY (kybernos-cloud)
const SDK_PACKAGE = '@e2b/sdk'
const SDK_RANGE = '^2'

export const LIMITS = {
  maxSandboxes: 4,          // cap de facturation douce : simultanées suivies
  defaultTtlMs: 15 * 60_000,
  maxTtlMs: 2 * 60 * 60_000,
  minTtlMs: 60_000,
  sweepMs: 30_000,
  execDefaultTimeoutMs: 60_000,
  execMaxTimeoutMs: 10 * 60_000,
  readMaxBytes: 512 * 1024,
  writeMaxBytes: 4 * 1024 * 1024,
  keyMaxLen: 200,
}

let hostCtx = null
let credentialsService = null
let sdkPromise = null        // Promise<{ Sandbox } | { error }>

// ── Config (schéma de réglages servi à la page Plugins) ─────────────────────
// Même mécanisme que web-search-deepseek : dsh-settings dérive un formulaire
// éditable du Config exporté par le plugin. `apiKey` role « secret » → la page
// écrit dans le store de credentials via remote.credentials (jamais dans le
// fichier de réglages) ; `apiKeyEnv` role « credential-ref » nomme la référence.
// schemastery est chargé par candidats (bundle, puis profil) : sans lui, Config
// reste undefined et le plugin tourne sans formulaire (routes locales intactes).
let Config = undefined
try {
  // Point d'entrée ESM réel : lib/index.mjs (mesuré — main pointe le .cjs).
  const loadZ = async (dir) => {
    for (const entry of ['lib/index.mjs', 'lib/index.js']) {
      const file = join(dir, 'node_modules', '@deepseek-ai', 'schemastery', entry)
      if (existsSync(file) !== true) continue
      return (await import(pathToFileURL(file).href)).default
    }
    throw new Error('schemastery absent de ' + dir)
  }
  const z = await loadZ(BUNDLE_DIR).catch(() => loadZ(join(DSH_HOME, 'profiles', 'web')))
  Config = z.object({
    apiKey: z.string().role('secret').volatile(),
    apiKeyEnv: z.string().role('credential-ref').default('E2B_API_KEY').volatile(),
    defaultTtlMinutes: z.number().step(1).min(1).max(120).default(15).volatile(),
  })
} catch (e) {
  console.error('[kybernos-computers] Config non déclaré (schemastery introuvable) : ' + String((e && e.message) || e))
}
export { Config }
let sdkForTests = null       // injecté par les tests : contourne loadSdk()

// ── état local ──────────────────────────────────────────────────────────────
// { version: 1, sandboxes: { <sandboxId>: { sandboxId, label, createdAt, expiresAt, template } } }
// Aucun secret ici. La persistance survit aux redémarrages : le balayeur TTL
// peut arrêter une sandbox oubliée par un processus mort.

const emptyState = () => ({ version: 1, sandboxes: {}, env: 'desktop' })

const readState = () => {
  try {
    const raw = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
    if (raw === null || typeof raw !== 'object' || raw.sandboxes === null || typeof raw.sandboxes !== 'object') return emptyState()
    return { version: 1, sandboxes: raw.sandboxes, env: raw.env === 'e2b' ? 'e2b' : 'desktop' }
  } catch { return emptyState() }
}

const writeState = (state) => {
  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(STATE_FILE, JSON.stringify(state), { mode: 0o600 })
  try { chmodSync(STATE_FILE, 0o600) } catch { /* best effort */ }
}

const trackSandbox = (entry) => {
  const state = readState()
  state.sandboxes[entry.sandboxId] = entry
  writeState(state)
}

const untrackSandbox = (sandboxId) => {
  const state = readState()
  if (Object.prototype.hasOwnProperty.call(state.sandboxes, sandboxId) !== true) return false
  delete state.sandboxes[sandboxId]
  writeState(state)
  return true
}

const trackedCount = () => Object.keys(readState().sandboxes).length

// ── clé E2B (credential, jamais renvoyée) ───────────────────────────────────

const serviceCredentials = () => {
  if (credentialsService !== null) return credentialsService
  if (hostCtx === null) return null
  try { credentialsService = hostCtx.get('credentials') ?? null } catch { credentialsService = null }
  return credentialsService
}

const resolveKey = async () => {
  const svc = serviceCredentials()
  if (svc !== null) {
    try {
      // Le service credentials résout une RÉFÉRENCE : resolve(ref) → { value, source }.
      // (svc.get n'existe pas — mesuré 29/09 : keyPresent restait faux après set.)
      const resolved = await svc.resolve(CRED_REF)
      if (resolved !== undefined && resolved !== null && typeof resolved.value === 'string' && resolved.value !== '') return resolved.value
    } catch (e) {
      console.error('[kybernos-computers] lecture credential ' + CRED_REF + ' : ' + String((e && e.message) || e))
    }
  }
  // Repli environnement (développeur / CI), même priorité basse que le shell.
  const env = process.env.E2B_API_KEY
  return typeof env === 'string' && env !== '' ? env : null
}

const looksLikeE2bKey = (key) => typeof key === 'string' && key.length >= 20 && key.length <= LIMITS.keyMaxLen && /^[A-Za-z0-9_-]+$/.test(key)

const storeKey = async (key) => {
  if (looksLikeE2bKey(key) !== true) return { ok: false, error: 'cle_invalide' }
  const svc = serviceCredentials()
  if (svc === null) return { ok: false, error: 'store_credentials_indisponible' }
  try { await svc.set(CRED_REF, key); return { ok: true } }
  catch (e) {
    console.error('[kybernos-computers] stockage credential refusé : ' + String((e && e.message) || e))
    return { ok: false, error: 'stockage_refuse' }
  }
}

const clearKey = async () => {
  const svc = serviceCredentials()
  let credential = false
  if (svc !== null) {
    try { await svc.unset(CRED_REF); credential = true } catch { /* resté, sans consommateur */ }
  }
  return { ok: true, credential }
}

// ── SDK paresseux : bundle → profil → auto-install ──────────────────────────

const tryImportSdk = async (candidateDir) => {
  const entry = join(candidateDir, 'node_modules', SDK_PACKAGE)
  if (existsSync(join(entry, 'package.json')) !== true) return null
  // package.json lu par readFileSync : l'import ESM d'un .json exige un
  // attribut { type: 'json' } sur Node 26 (mesuré : ERR_IMPORT_ATTRIBUTE_MISSING).
  const pkg = JSON.parse(readFileSync(join(entry, 'package.json'), 'utf8'))
  const sub = typeof pkg.module === 'string' && pkg.module !== '' ? pkg.module : pkg.main
  const resolved = join(entry, sub || 'dist/index.js')
  if (existsSync(resolved) !== true) return null
  try {
    const sdk = await import(pathToFileURL(resolved).href)
    if (sdk === null || sdk.Sandbox === undefined) {
      console.error('[kybernos-computers] ' + resolved + ' chargé sans export Sandbox')
      return null
    }
    return sdk
  } catch (e) {
    // Diagnostic : sans ce log, l'échec d'import est muet (sdk_introuvable sec).
    console.error('[kybernos-computers] import ' + resolved + ' : ' + String((e && e.stack) || e).slice(0, 400))
    return null
  }
}

const autoInstallSdk = () => {
  mkdirSync(DATA_DIR, { recursive: true })
  console.log('[kybernos-computers] installation de ' + SDK_PACKAGE + '@' + SDK_RANGE + ' dans ' + SDK_INSTALL_DIR + '…')
  const made = spawnSync('npm', ['install', '--prefix', DATA_DIR, '--no-audit', '--no-fund', '--omit=dev', '--loglevel=error', SDK_PACKAGE + '@' + SDK_RANGE], { encoding: 'utf8', timeout: 180_000 })
  if (made.status !== 0) {
    console.error('[kybernos-computers] auto-install échouée (npm status ' + String(made.status) + ') : ' + String(made.stderr || '').slice(0, 300))
    return false
  }
  return true
}

const loadSdk = async () => {
  if (sdkForTests !== null) return sdkForTests
  if (sdkPromise !== null) return sdkPromise
  sdkPromise = (async () => {
    // 1. node_modules du bundle (dépôt de dev)
    const local = await tryImportSdk(BUNDLE_DIR).catch(() => null)
    if (local !== null) return local
    // 2. node_modules du profil DSH
    const profile = await tryImportSdk(join(DSH_HOME, 'profiles', 'web')).catch(() => null)
    if (profile !== null) return profile
    // 3. auto-install utilisateur (~/.dsh/kybernos-computers/node_modules)
    if (existsSync(join(SDK_INSTALL_DIR, SDK_PACKAGE)) !== true && autoInstallSdk() !== true) {
      return { error: 'sdk_introuvable' }
    }
    const installed = await tryImportSdk(DATA_DIR).catch(() => null)
    if (installed !== null) return installed
    return { error: 'sdk_introuvable' }
  })()
  sdkPromise.catch(() => { sdkPromise = null })
  return sdkPromise
}

// ── opérations E2B (toutes reçoivent la clé, jamais ne la loggent) ───────────

const connect = async (sandboxId) => {
  const key = await resolveKey()
  if (key === null) return { error: 'cle_absente' }
  const sdk = await loadSdk()
  if (sdk.error !== undefined) return { error: sdk.error }
  try {
    const sandbox = await sdk.Sandbox.connect(sandboxId, { apiKey: key, requestTimeoutMs: 15_000 })
    if (sandbox === null || sandbox.sandboxId === undefined) return { error: 'connexion_impossible' }
    return { sandbox }
  } catch (e) {
    return { error: 'connexion_impossible', detail: String((e && e.message) || e).slice(0, 200) }
  }
}

// Templates connus : 'base' (Linux nu) | 'kybernos-dsh' (agent DSH embarqué,
// câblé au proxy Kybernos). Le template dsh reçoit KYBERNOS_API_KEY par envs
// à la création — le jeton kys-… du client, lu dans le credential local, et
// JAMAIS loggé ni renvoyé.
const TEMPLATES = ['base', 'kybernos-dsh']
const DSH_TEMPLATE = 'kybernos-dsh'
const KYBERNOS_CRED_REF = 'KYBERNOS_API_KEY' // posé par kybernos-cloud au claim

const resolveKybernosKey = async () => {
  const svc = serviceCredentials()
  if (svc !== null) {
    try {
      const resolved = await svc.resolve(KYBERNOS_CRED_REF)
      if (resolved !== undefined && resolved !== null && typeof resolved.value === 'string' && resolved.value !== '') return resolved.value
    } catch { /* pas de compte kybernos : le template dsh est inutilisable */ }
  }
  const env = process.env.KYBERNOS_API_KEY
  return typeof env === 'string' && env !== '' ? env : null
}

const startSandbox = async ({ label, ttlMs, template }) => {
  const key = await resolveKey()
  if (key === null) return { ok: false, error: 'cle_absente' }
  const sdk = await loadSdk()
  if (sdk.error !== undefined) return { ok: false, error: sdk.error }
  if (trackedCount() >= LIMITS.maxSandboxes) return { ok: false, error: 'quota_local_atteint', max: LIMITS.maxSandboxes }
  const chosen = TEMPLATES.includes(template) === true ? template : 'base'
  const createOpts = { apiKey: key, timeoutMs: clampTtl(ttlMs) }
  if (chosen === 'base') createOpts.timeoutMs = clampTtl(ttlMs)
  if (chosen === DSH_TEMPLATE) {
    const kys = await resolveKybernosKey()
    if (kys === null) return { ok: false, error: 'compte_kybernos_absent', detail: 'le template kybernos-dsh exige KYBERNOS_API_KEY (connexion Kybernos Cloud requise)' }
    createOpts.timeoutMs = clampTtl(ttlMs)
    // envs du SDK : transmis à la création, jamais affiché.
    createOpts.envs = { KYBERNOS_API_KEY: kys }
  }
  const ttl = createOpts.timeoutMs
  try {
    // Template en PREMIER argument (surcharge SDK v2) : Sandbox.create('base', opts).
    const sandbox = await sdk.Sandbox.create(chosen, createOpts)
    const entry = {
      sandboxId: sandbox.sandboxId,
      label: typeof label === 'string' && label !== '' ? label.slice(0, 80) : 'sans-nom',
      createdAt: Date.now(),
      expiresAt: Date.now() + ttl,
      template: chosen,
    }
    trackSandbox(entry)
    return { ok: true, sandbox: publicSandbox(entry) }
  } catch (e) {
    return { ok: false, error: 'demarrage_impossible', detail: String((e && e.message) || e).slice(0, 200) }
  }
}

// ── tâche embarquée : l'agent tourne DANS la VM (modèle Manus) ───────────────
// Une sandbox kybernos-dsh reçoit une mission ; `dsh headless --json` y tourne
// avec la clé du client (LLM facturés au compte Kybernos). On rend le message
// final + un résumé, puis on détache (stop par défaut — pause si demandé).

const runDshTask = async ({ mission, ttlMs, keep }) => {
  if (typeof mission !== 'string' || mission.trim() === '') return { ok: false, error: 'mission_manquante' }
  const started = await startSandbox({ label: 'tâche embarquée · ' + mission.slice(0, 40), ttlMs: ttlMs ?? 3_600_000, template: DSH_TEMPLATE })
  if (started.ok !== true) return started
  const sandboxId = started.sandbox.sandboxId
  const t0 = Date.now()
  const ran = await execCommand({
    sandboxId,
    command: 'dsh headless --patch /home/user/agent-patch.yml ' + JSON.stringify(mission),
    timeoutMs: LIMITS.execMaxTimeoutMs,
  })
  const durationMs = Date.now() - t0
  if (ran.ok !== true) {
    await stopSandbox({ sandboxId })
    return { ok: false, error: ran.error, detail: ran.detail, sandboxId }
  }
  const out = {
    ok: true,
    sandboxId,
    exitCode: ran.exitCode,
    durationMs,
    answer: String(ran.stdout || '').trim().slice(0, 30_000),
    stderr: String(ran.stderr || '').trim().slice(0, 4_000),
  }
  if (keep === true) {
    const froze = await pauseSandbox({ sandboxId })
    out.paused = froze.ok === true
    out.note = 'VM gelée (computer_resume pour la reprendre, computer_stop pour la jeter).'
  } else {
    await stopSandbox({ sandboxId })
    out.note = 'VM arrêtée — les fichiers non récupérés sont perdus (la réponse ci-dessus est le résultat durable).'
  }
  return out
}

const clampTtl = (ttlMs) => {
  const asked = Number(ttlMs)
  if (Number.isFinite(asked) !== true) return LIMITS.defaultTtlMs
  return Math.min(LIMITS.maxTtlMs, Math.max(LIMITS.minTtlMs, Math.round(asked)))
}

const publicSandbox = (entry) => ({
  sandboxId: entry.sandboxId,
  label: entry.label,
  createdAt: entry.createdAt,
  expiresAt: entry.expiresAt,
  template: entry.template,
  paused: entry.paused === true,
})

const execCommand = async ({ sandboxId, command, timeoutMs }) => {
  if (typeof sandboxId !== 'string' || sandboxId === '') return { ok: false, error: 'sandboxId_manquant' }
  if (typeof command !== 'string' || command === '') return { ok: false, error: 'commande_manquante' }
  const budget = Math.min(LIMITS.execMaxTimeoutMs, Math.max(5_000, Number.isFinite(Number(timeoutMs)) ? Math.round(Number(timeoutMs)) : LIMITS.execDefaultTimeoutMs))
  const got = await connect(sandboxId)
  if (got.error !== undefined) return { ok: false, error: got.error, detail: got.detail }
  try {
    const result = await got.sandbox.commands.run(command, { timeoutMs: budget, cwd: '/home/user' })
    touchExpiry(sandboxId)
    return {
      ok: true,
      exitCode: result.exitCode,
      stdout: typeof result.stdout === 'string' ? result.stdout.slice(0, 64_000) : '',
      stderr: typeof result.stderr === 'string' ? result.stderr.slice(0, 16_000) : '',
    }
  } catch (e) {
    return { ok: false, error: 'execution_echouee', detail: String((e && e.message) || e).slice(0, 200) }
  }
}

const writeFile = async ({ sandboxId, path: target, content }) => {
  if (typeof sandboxId !== 'string' || sandboxId === '') return { ok: false, error: 'sandboxId_manquant' }
  if (typeof target !== 'string' || target === '') return { ok: false, error: 'chemin_manquant' }
  if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > LIMITS.writeMaxBytes) return { ok: false, error: 'contenu_invalide' }
  const got = await connect(sandboxId)
  if (got.error !== undefined) return { ok: false, error: got.error, detail: got.detail }
  try {
    await got.sandbox.files.write(target, content)
    touchExpiry(sandboxId)
    return { ok: true, path: target }
  } catch (e) {
    return { ok: false, error: 'ecriture_echouee', detail: String((e && e.message) || e).slice(0, 200) }
  }
}

const readFile = async ({ sandboxId, path: target }) => {
  if (typeof sandboxId !== 'string' || sandboxId === '') return { ok: false, error: 'sandboxId_manquant' }
  if (typeof target !== 'string' || target === '') return { ok: false, error: 'chemin_manquant' }
  const got = await connect(sandboxId)
  if (got.error !== undefined) return { ok: false, error: got.error, detail: got.detail }
  try {
    const content = await got.sandbox.files.read(target, { format: 'text' })
    touchExpiry(sandboxId)
    const text = typeof content === 'string' ? content : String(content)
    return { ok: true, path: target, truncated: text.length > LIMITS.readMaxBytes, content: text.slice(0, LIMITS.readMaxBytes) }
  } catch (e) {
    return { ok: false, error: 'lecture_echouee', detail: String((e && e.message) || e).slice(0, 200) }
  }
}

const stopSandbox = async ({ sandboxId }) => {
  if (typeof sandboxId !== 'string' || sandboxId === '') return { ok: false, error: 'sandboxId_manquant' }
  const key = await resolveKey()
  if (key === null) return { ok: false, error: 'cle_absente' }
  const sdk = await loadSdk()
  if (sdk.error !== undefined) return { ok: false, error: sdk.error }
  try { await sdk.Sandbox.kill(sandboxId, { apiKey: key }) }
  catch (e) { /* déjà morte : on détache quand même */ }
  untrackSandbox(sandboxId)
  return { ok: true, sandboxId }
}

// ── pause / reprise (SDK beta) ──────────────────────────────────────────────
// betaPause gèle la VM : la facturation CPU s'arrête, le disque est conservé,
// et `Sandbox.connect(sandboxId)` la RÉSUME automatiquement. Pendant la pause
// on suspend notre TTL local (une VM gelée ne doit pas être tuée par le
// balayeur) ; à la reprise on remet une échéance neuve + le timeout E2B.

const pauseSandbox = async ({ sandboxId }) => {
  if (typeof sandboxId !== 'string' || sandboxId === '') return { ok: false, error: 'sandboxId_manquant' }
  const key = await resolveKey()
  if (key === null) return { ok: false, error: 'cle_absente' }
  const sdk = await loadSdk()
  if (sdk.error !== undefined) return { ok: false, error: sdk.error }
  let paused = false
  try { paused = await sdk.Sandbox.betaPause(sandboxId, { apiKey: key }) === true }
  catch (e) { return { ok: false, error: 'pause_echouee', detail: String((e && e.message) || e).slice(0, 200) } }
  if (paused !== true) return { ok: false, error: 'pause_refusee' }
  const state = readState()
  const entry = state.sandboxes[sandboxId]
  if (entry !== undefined) {
    entry.paused = true
    entry.pausedAt = Date.now()
    entry.savedExpiresAt = entry.expiresAt
    entry.expiresAt = Number.MAX_SAFE_INTEGER // hors balayage tant que gelée
    writeState(state)
  }
  return { ok: true, sandboxId, paused: true }
}

const resumeSandbox = async ({ sandboxId, ttlMs }) => {
  if (typeof sandboxId !== 'string' || sandboxId === '') return { ok: false, error: 'sandboxId_manquant' }
  const key = await resolveKey()
  if (key === null) return { ok: false, error: 'cle_absente' }
  const sdk = await loadSdk()
  if (sdk.error !== undefined) return { ok: false, error: sdk.error }
  const ttl = clampTtl(ttlMs)
  try {
    // connect() résume une sandbox en pause (contrat SDK) et redonne une
    // instance vivante ; on repose aussi le timeout E2B côté serveur.
    const sandbox = await sdk.Sandbox.connect(sandboxId, { apiKey: key, requestTimeoutMs: 15_000 })
    if (sandbox === null || sandbox.sandboxId === undefined) return { ok: false, error: 'reprise_impossible' }
    try { await sandbox.setTimeout(ttl, { apiKey: key }) } catch { /* le défaut SDK reste */ }
  } catch (e) {
    return { ok: false, error: 'reprise_impossible', detail: String((e && e.message) || e).slice(0, 200) }
  }
  const state = readState()
  const entry = state.sandboxes[sandboxId]
  if (entry !== undefined) {
    entry.paused = false
    entry.expiresAt = Date.now() + ttl
    delete entry.savedExpiresAt
    delete entry.pausedAt
    writeState(state)
  }
  return { ok: true, sandboxId, paused: false, expiresAt: Date.now() + ttl }
}

// Toute activité repousse l'échéance locale d'un TTL complet (le SDK E2B
// applique de son côté son propre timeout de session). borné au max.
const touchExpiry = (sandboxId) => {
  const state = readState()
  const entry = state.sandboxes[sandboxId]
  if (entry === undefined || entry.paused === true) return
  const next = Date.now() + LIMITS.defaultTtlMs
  if (next > entry.expiresAt) {
    entry.expiresAt = Math.min(next, entry.createdAt + LIMITS.maxTtlMs)
    writeState(state)
  }
}

// ── balayeur TTL ────────────────────────────────────────────────────────────
// Arrête les sandboxes expirées même si personne n'appelle les routes. Ne
// tourne que si une clé existe (sinon kill échouerait de toute façon).

let sweeperTimer = null

const sweepOnce = async () => {
  const state = readState()
  const now = Date.now()
  for (const entry of Object.values(state.sandboxes)) {
    // The state file is read from disk and the sweeper runs from a timer: an entry that is not a sandbox (a damaged file) is skipped,
    // it must not reject a `void sweepOnce()` (an unhandled rejection ends DSH) every 30 seconds.
    if (entry === null || typeof entry !== 'object' || typeof entry.sandboxId !== 'string') continue
    if (entry.expiresAt > now) continue
    console.log('[kybernos-computers] TTL échu pour ' + entry.sandboxId + ' — arrêt')
    await stopSandbox({ sandboxId: entry.sandboxId })
  }
}

const mountSweeper = (ctx) => {
  if (sweeperTimer !== null) return
  ctx.effect(() => {
    sweeperTimer = setInterval(() => { void sweepOnce().catch((e) => console.error('[kybernos-computers] balayeur TTL : ' + String((e && e.message) || e))) }, LIMITS.sweepMs)
    sweeperTimer.unref?.()
  }, 'kybernos-computers: balayeur TTL')
}

// ── routes ──────────────────────────────────────────────────────────────────

const sendJson = (res, code, payload) => {
  const body = JSON.stringify(payload)
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
}

const sameOrigin = (req) => {
  const origin = String((req.headers && req.headers.origin) || '')
  const host = String((req.headers && req.headers.host) || '')
  if (origin === '' ) return true // même origine, pas d'en-tête Origin
  try { return new URL(origin).host === host } catch { return false }
}

const readJsonBody = (req, cap) => new Promise((resolve) => {
  const chunks = []
  let size = 0
  req.on('data', (chunk) => {
    size += chunk.length
    if (size > cap) { req.destroy(); resolve(null); return }
    chunks.push(chunk)
  })
  req.on('end', () => {
    if (chunks.length === 0) return resolve(null)
    try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { resolve(null) }
  })
  req.on('error', () => resolve(null))
})

const statusRoute = async () => {
  const key = await resolveKey()
  return {
    ok: true,
    backend: 'e2b',
    keyPresent: key !== null,
    // Le SDK n'est chargé qu'à l'usage : on ne rapporte que sa présence disque.
    sdkBundled: existsSync(join(BUNDLE_DIR, 'node_modules', SDK_PACKAGE)) || existsSync(join(SDK_INSTALL_DIR, SDK_PACKAGE)),
    sandboxCount: trackedCount(),
    limits: LIMITS,
  }
}

const keySetRoute = async (req, body) => {
  if (body === null || typeof body.key !== 'string') return { ok: false, error: 'corps_invalide : {"key":"e2b_…"}' }
  return await storeKey(body.key.trim())
}

const keyClearRoute = async () => {
  const state = readState()
  for (const entry of Object.values(state.sandboxes)) {
    console.log('[kybernos-computers] clé retirée — arrêt de ' + entry.sandboxId)
    await stopSandbox({ sandboxId: entry.sandboxId })
  }
  return await clearKey()
}

const sandboxesRoute = async () => {
  const state = readState()
  const now = Date.now()
  return {
    ok: true,
    sandboxes: Object.values(state.sandboxes).map((entry) => ({
      ...publicSandbox(entry),
      remainingMs: Math.max(0, entry.expiresAt - now),
    })),
  }
}

const startRoute = async (req, body) => await startSandbox({
  label: body === null ? undefined : body.label,
  ttlMs: body === null ? undefined : body.ttlMs,
})

const execRoute = async (req, body) => {
  if (body === null) return { ok: false, error: 'corps_invalide' }
  return await execCommand({ sandboxId: body.sandboxId, command: body.command, timeoutMs: body.timeoutMs })
}

const writeRoute = async (req, body) => {
  if (body === null) return { ok: false, error: 'corps_invalide' }
  return await writeFile({ sandboxId: body.sandboxId, path: body.path, content: body.content })
}

const readRoute = async (req) => {
  const url = new URL(req.url, 'http://localhost')
  return await readFile({ sandboxId: url.searchParams.get('sandboxId') ?? '', path: url.searchParams.get('path') ?? '' })
}

const stopRoute = async (req, body) => {
  if (body === null || body.confirm !== true) return { ok: false, error: 'confirmation requise : POST avec {"confirm":true}' }
  return await stopSandbox({ sandboxId: body.sandboxId })
}

const pauseRoute = async (req, body) => {
  if (body === null) return { ok: false, error: 'corps_invalide' }
  return await pauseSandbox({ sandboxId: body.sandboxId })
}

const resumeRoute = async (req, body) => {
  if (body === null) return { ok: false, error: 'corps_invalide' }
  return await resumeSandbox({ sandboxId: body.sandboxId, ttlMs: body.ttlMs })
}

// ── préférence d'environnement (sélecteur composer) ─────────────────────────
// 'desktop' (défaut : comportement inchangé) | 'e2b' (l'agent doit préférer
// les outils computer_* au bash local pour exécuter du code). La valeur est
// injectée dans le prompt système — c'est ce qui rend le sélecteur AGISSANT.

const envGetRoute = async () => ({ ok: true, env: readState().env })

const envSetRoute = async (req, body) => {
  if (body === null || (body.env !== 'desktop' && body.env !== 'e2b')) {
    return { ok: false, error: 'env invalide : "desktop" ou "e2b"' }
  }
  const state = readState()
  state.env = body.env
  writeState(state)
  return { ok: true, env: state.env }
}

const ENV_PROMPT_ORDER = 8700
const renderEnvChunk = (state) => {
  if (state.env !== 'e2b') return ''
  return [
    '## Environnement d\'exécution : ordinateur cloud E2B',
    'L\'utilisateur a sélectionné « E2B » dans le composer : pour tout code, commande ou script à exécuter,',
    'utilise les outils computer_* (computer_start puis computer_exec/write/read) dans une sandbox cloud',
    'ÉPHÉMÈRE plutôt que le bash local — sauf demande explicite du contraire ou opération purement locale',
    '(lire/éditer les fichiers du dépôt courant reste local). Arrête (computer_stop) ou gèle (computer_pause)',
    'la sandbox quand le travail est fait ; récupère les résultats AVANT (computer_read) : la VM est jetable.',
  ].join('\n')
}

const mountEnvPrompt = (ctx) => {
  ctx.inject(['systemPrompt'], (scope) => {
    scope.systemPrompt.context({
      name: 'kybernos:computers-env',
      order: ENV_PROMPT_ORDER,
      text: () => renderEnvChunk(readState()),
    })
  })
}

export const ROUTES = [
  { path: '/kybernos-computers/status', method: 'GET', guarded: true, run: statusRoute },
  { path: '/kybernos-computers/key/set', method: 'POST', guarded: true, body: true, cap: 4096, run: keySetRoute },
  { path: '/kybernos-computers/key/clear', method: 'POST', guarded: true, run: keyClearRoute },
  { path: '/kybernos-computers/sandboxes', method: 'GET', guarded: true, run: sandboxesRoute },
  { path: '/kybernos-computers/sandboxes/start', method: 'POST', guarded: true, body: true, cap: 4096, run: startRoute },
  { path: '/kybernos-computers/sandboxes/exec', method: 'POST', guarded: true, body: true, cap: 131_072, run: execRoute },
  { path: '/kybernos-computers/sandboxes/write', method: 'POST', guarded: true, body: true, cap: LIMITS.writeMaxBytes + 65_536, run: writeRoute },
  { path: '/kybernos-computers/sandboxes/read', method: 'GET', guarded: true, run: readRoute },
  { path: '/kybernos-computers/sandboxes/stop', method: 'POST', guarded: true, body: true, cap: 4096, run: stopRoute },
  { path: '/kybernos-computers/sandboxes/pause', method: 'POST', guarded: true, body: true, cap: 4096, run: pauseRoute },
  { path: '/kybernos-computers/sandboxes/resume', method: 'POST', guarded: true, body: true, cap: 4096, run: resumeRoute },
  { path: '/kybernos-computers/env', method: 'GET', guarded: true, run: envGetRoute },
  { path: '/kybernos-computers/env/set', method: 'POST', guarded: true, body: true, cap: 256, run: envSetRoute },
]

const mountWebRoutes = (ctx, webServer) => {
  for (const route of ROUTES) {
    const handler = async (req, res) => {
      if (req.method !== route.method) return sendJson(res, 405, { ok: false, error: route.method + ' attendu' })
      if (sameOrigin(req) === false) return sendJson(res, 403, { ok: false, error: 'origine refusee' })
      try {
        const body = route.body === true ? await readJsonBody(req, route.cap) : null
        sendJson(res, 200, await route.run(req, body))
      } catch (e) {
        console.error('[kybernos-computers] ' + route.path + ' : ' + String((e && e.message) || e))
        sendJson(res, 500, { ok: false, error: 'erreur interne' })
      }
    }
    ctx.effect(() => webServer.register({ kind: 'exact', path: route.path, handler }), 'kybernos-computers: route ' + route.path)
  }
  console.log('[kybernos-computers] routes /kybernos-computers/* enregistrées (status, key/set, key/clear, env, env/set, sandboxes start/exec/write/read/stop/list)')
}

// ── Outils exposés au modèle ────────────────────────────────────────────────
// Même contrat que kybernos-cloud : `tools.register` exige seulement
// { name, parameters, output:{schema,render}, execute }. Les outils ne
// manipulent JAMAIS la clé — ils passent par les mêmes fonctions que les
// routes (resolveKey interne). Préfixe commun `computer_` pour les distinguer
// des outils du poste (bash local, cua-driver = desktop).

const TEXT_RESULT = (text) => [{ type: 'text', text }]

const describeError = (out) => out.error + (out.detail !== undefined ? ' — ' + out.detail : '')

const computerTools = () => {
  const startedHint = (out) => out.ok === true
    ? 'Sandbox ' + out.sandbox.sandboxId + ' démarrée (' + out.sandbox.label + ', échéance dans ' + Math.round((out.sandbox.expiresAt - Date.now()) / 60000) + ' min). Utilise cet identifiant pour computer_exec / computer_write / computer_read / computer_stop.'
    : 'Échec : ' + describeError(out) + (out.error === 'cle_absente' ? ' — demande à l\'utilisateur de configurer sa clé E2B dans Réglages ▸ Plugins ▸ Cloud computers.' : '')
  return [
    {
      name: 'computer_start',
      description: 'Démarre un ordinateur cloud éphémère (microVM E2B, Linux) pour exécuter du code SANS toucher au poste de l\'utilisateur. Facturé au compte E2B de l\'utilisateur, à la seconde. TTL par défaut 15 min, max 2 h, 4 sandbox simultanées. Templates : "base" (Linux + Python/Node, défaut) ou "kybernos-dsh" (agent DSH embarqué connecté au compte Kybernos du client — voir computer_task).',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          label: { type: 'string', description: 'Nom lisible du chantier mené dans cette sandbox (ex. "scraping concurrents").' },
          ttlMs: { type: 'number', description: 'Durée de vie en millisecondes (60 000 min, 7 200 000 max, défaut 900 000).' },
          template: { type: 'string', enum: ['base', 'kybernos-dsh'], description: 'Image de la sandbox. "kybernos-dsh" embarque un agent DSH (nécessite la connexion Kybernos Cloud).' },
        },
        required: [],
      },
      output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, sandboxId: { type: 'string' }, error: { type: 'string' } }, required: ['ok'] },
        render: (args, value) => TEXT_RESULT(startedHint(value)) },
      async execute(args) { return await startSandbox({ label: args.label, ttlMs: args.ttlMs, template: args.template }) },
    },
    {
      name: 'computer_task',
      description: 'Délègue une MISSION à un agent DSH qui tourne DANS une microVM cloud (template kybernos-dsh) : il planifie et exécute seul, ses appels LLM sont facturés au compte Kybernos du client. Rend la réponse finale — un seul aller-retour, aucun stdout intermédiaire dans cette conversation. Budget d\'attente : ~10 min par appel (au-delà, passe keep:true puis reprends avec computer_resume). La VM est jetée après (fichiers perdus — fais-les rendre DANS la mission si besoin).',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          mission: { type: 'string', description: 'La mission complète et autonome (contexte inclus) confiée à l\'agent embarqué.' },
          ttlMs: { type: 'number', description: 'Durée de vie de la VM en millisecondes (défaut 3 600 000 = 1 h).' },
          keep: { type: 'boolean', description: 'true : gèle la VM à la fin au lieu de l\'arrêter (reprise par computer_resume).' },
        },
        required: ['mission'],
      },
      output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, answer: { type: 'string' }, durationMs: { type: 'number' }, error: { type: 'string' } }, required: ['ok'] },
        render: (args, value) => TEXT_RESULT(value.ok === true
          ? 'Mission embarquée accomplie en ' + Math.round(Number(value.durationMs) / 1000) + ' s :\n' + String(value.answer)
          : 'Échec : ' + describeError(value)) },
      async execute(args) { return await runDshTask({ mission: args.mission, ttlMs: args.ttlMs, keep: args.keep }) },
    },
    {
      name: 'computer_exec',
      description: 'Exécute une commande shell dans une sandbox E2B démarrée via computer_start. Retourne exitCode, stdout, stderr. cwd par défaut /home/user.',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          sandboxId: { type: 'string', description: 'Identifiant rendu par computer_start.' },
          command: { type: 'string', description: 'Commande shell à exécuter.' },
          timeoutMs: { type: 'number', description: 'Budget en millisecondes (5 000 min, 600 000 max, défaut 60 000).' },
        },
        required: ['sandboxId', 'command'],
      },
      output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, exitCode: { type: 'number' }, error: { type: 'string' } }, required: ['ok'] },
        render: (args, value) => TEXT_RESULT(value.ok === true ? '$ ' + String(args.command) + '\n(exit ' + String(value.exitCode) + ') ' + String(value.stdout).slice(0, 2000) : 'Échec : ' + describeError(value)) },
      async execute(args) { return await execCommand({ sandboxId: args.sandboxId, command: args.command, timeoutMs: args.timeoutMs }) },
    },
    {
      name: 'computer_write',
      description: 'Écrit un fichier texte dans une sandbox E2B (crée les dossiers parents au besoin).',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          sandboxId: { type: 'string', description: 'Identifiant rendu par computer_start.' },
          path: { type: 'string', description: 'Chemin absolu dans la sandbox (ex. /home/user/script.py).' },
          content: { type: 'string', description: 'Contenu UTF-8 (max 4 Mo).' },
        },
        required: ['sandboxId', 'path', 'content'],
      },
      output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, path: { type: 'string' }, error: { type: 'string' } }, required: ['ok'] },
        render: (args, value) => TEXT_RESULT(value.ok === true ? 'Écrit : ' + String(value.path) + ' (' + String(args.content).length + ' caractères).' : 'Échec : ' + describeError(value)) },
      async execute(args) { return await writeFile({ sandboxId: args.sandboxId, path: args.path, content: args.content }) },
    },
    {
      name: 'computer_read',
      description: 'Lit un fichier texte d\'une sandbox E2B (max 512 Ko, tronqué au-delà).',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          sandboxId: { type: 'string', description: 'Identifiant rendu par computer_start.' },
          path: { type: 'string', description: 'Chemin absolu dans la sandbox.' },
        },
        required: ['sandboxId', 'path'],
      },
      output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, content: { type: 'string' }, error: { type: 'string' } }, required: ['ok'] },
        render: (args, value) => TEXT_RESULT(value.ok === true ? String(value.content) : 'Échec : ' + describeError(value)) },
      async execute(args) { return await readFile({ sandboxId: args.sandboxId, path: args.path }) },
    },
    {
      name: 'computer_stop',
      description: 'Arrête une sandbox E2B (l\'arrêter dès que tu as fini évite la facturation inutile — le TTL la couperait de toute façon).',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          sandboxId: { type: 'string', description: 'Identifiant rendu par computer_start.' },
        },
        required: ['sandboxId'],
      },
      output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, error: { type: 'string' } }, required: ['ok'] },
        render: (args, value) => TEXT_RESULT(value.ok === true ? 'Sandbox ' + String(args.sandboxId) + ' arrêtée.' : 'Échec : ' + describeError(value)) },
      async execute(args) { return await stopSandbox({ sandboxId: args.sandboxId }) },
    },
    {
      name: 'computer_pause',
      description: 'GÈLE une sandbox (betaPause E2B) : la facturation CPU s\'arrête, le disque et les fichiers sont conservés. Utilise-la pour une tâche longue qu\'on reprendra plus tard.',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          sandboxId: { type: 'string', description: 'Identifiant rendu par computer_start.' },
        },
        required: ['sandboxId'],
      },
      output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, error: { type: 'string' } }, required: ['ok'] },
        render: (args, value) => TEXT_RESULT(value.ok === true ? 'Sandbox ' + String(args.sandboxId) + ' gelée — disque conservé, CPU non facturé. computer_resume la réveillera avec ses fichiers.' : 'Échec : ' + describeError(value)) },
      async execute(args) { return await pauseSandbox({ sandboxId: args.sandboxId }) },
    },
    {
      name: 'computer_resume',
      description: 'RÉVEILLE une sandbox gelée par computer_pause : fichiers et processus disque intacts, nouvelle échéance TTL.',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          sandboxId: { type: 'string', description: 'Identifiant de la sandbox gelée.' },
          ttlMs: { type: 'number', description: 'Nouvelle durée de vie en millisecondes (défaut 900 000).' },
        },
        required: ['sandboxId'],
      },
      output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, error: { type: 'string' } }, required: ['ok'] },
        render: (args, value) => TEXT_RESULT(value.ok === true ? 'Sandbox ' + String(args.sandboxId) + ' réveillée, échéance dans ' + Math.round((Number(value.expiresAt) - Date.now()) / 60000) + ' min.' : 'Échec : ' + describeError(value)) },
      async execute(args) { return await resumeSandbox({ sandboxId: args.sandboxId, ttlMs: args.ttlMs }) },
    },
    {
      name: 'computer_list',
      description: 'Liste les sandboxes E2B suivies sur ce poste (identifiant, libellé, temps restant avant TTL).',
      parameters: { type: 'object', additionalProperties: false, properties: {}, required: [] },
      output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, sandboxes: { type: 'array' } }, required: ['ok'] },
        render: (args, value) => TEXT_RESULT(value.ok === true && Array.isArray(value.sandboxes) && value.sandboxes.length > 0
          ? value.sandboxes.map((s) => s.sandboxId + ' · ' + s.label + ' · ' + Math.round(s.remainingMs / 60000) + ' min restantes').join('\n')
          : 'Aucune sandbox suivie.'), },
      async execute() { return await sandboxesRoute() },
    },
  ]
}

const mountTools = (ctx) => {
  ctx.inject(['tools'], (scope) => {
    for (const tool of computerTools()) scope.tools.register(tool)
    console.log('[kybernos-computers] outils computer_start/exec/write/read/stop/pause/resume/list/task enregistrés')
  })
}

export function apply(ctx) {
  hostCtx = ctx
  if (ctx.get('webServer') !== undefined) mountWebRoutes(ctx, ctx.get('webServer'))
  else ctx.inject(['webServer'], (scope) => mountWebRoutes(ctx, scope.webServer))
  try { mountTools(ctx) } catch (e) { console.error('[kybernos-computers] outils : ' + String((e && e.message) || e)) }
  try { mountEnvPrompt(ctx) } catch (e) { console.error('[kybernos-computers] prompt environnement : ' + String((e && e.message) || e)) }
  try { mountSweeper(ctx) } catch (e) { console.error('[kybernos-computers] balayeur TTL : ' + String((e && e.message) || e)) }
}

// ── exportés pour les tests (aucune autre surface publique) ─────────────────
export const testHooks = {
  setSdkForTests: (fake) => { sdkForTests = fake },
  setCredentialsForTests: (fake) => { credentialsService = fake },
  setHostCtxForTests: (fake) => { hostCtx = fake },
  readState, writeState, STATE_FILE,
  resolveKey, looksLikeE2bKey, storeKey, clearKey,
  startSandbox, execCommand, writeFile, readFile, stopSandbox,
  sweepOnce, clampTtl, touchExpiry, publicSandbox, computerTools, pauseSandbox, resumeSandbox, runDshTask, resolveKybernosKey,
}
