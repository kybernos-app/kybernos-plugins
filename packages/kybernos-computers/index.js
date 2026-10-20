// ── kybernos-computers — host half: E2B cloud sandboxes for the agents ───────
//
// Phase 1 (the project's rule): the host half ONLY.
//   1. keep the E2B key OUT of the browser, in the credentials store
//      (reference E2B_API_KEY, ~/.dsh/.credentials.yaml, 0600);
//   2. sandbox life cycle: start / exec / write / read / stop, with
//      an automatic TTL and a cap on simultaneous sandboxes;
//   3. resolve the @e2b/sdk SDK lazily (bundle node_modules → profile
//      → auto-install in ~/.dsh/kybernos-computers/node_modules).
//
// BYOK model: the compute goes to the user's own E2B account. Kybernos
// filters nothing, bills nothing, manages no quota. The key NEVER leaves
// this module: the routes only return state booleans.
//
// Routes contract (same-origin, never exposed to the network):
//   GET  /kybernos-computers/status          → { keyPresent, sdkReady, sandboxCount }
//   POST /kybernos-computers/key/set         → sets the E2B_API_KEY credential
//   POST /kybernos-computers/key/clear       → removes the key + stops the sandboxes
//   GET  /kybernos-computers/sandboxes       → the locally tracked list (+ the live ones?)
//   POST /kybernos-computers/sandboxes/start → starts a sandbox {label?, ttlMs?}
//   POST /kybernos-computers/sandboxes/exec  → {sandboxId, command, timeoutMs?}
//   POST /kybernos-computers/sandboxes/write → {sandboxId, path, content}
//   GET  /kybernos-computers/sandboxes/read  → ?sandboxId=&path=
//   POST /kybernos-computers/sandboxes/stop  → {sandboxId, confirm:true}
//
// The SDK is INJECTABLE for the tests (setSdkForTests): test-computers-host.mjs
// runs with no key and no network.
import { chmodSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { writeGuard } from './session-guard.mjs'

const BUNDLE_DIR = dirname(fileURLToPath(import.meta.url))
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const DATA_DIR = join(DSH_HOME, 'kybernos-computers')
const STATE_FILE = join(DATA_DIR, 'state.json')
const SDK_INSTALL_DIR = join(DATA_DIR, 'node_modules')

const CRED_REF = 'E2B_API_KEY' // same convention as KYBERNOS_API_KEY (kybernos-cloud)
const SDK_PACKAGE = '@e2b/sdk'
const SDK_RANGE = '^2'

export const LIMITS = {
  maxSandboxes: 4,          // soft billing cap: simultaneous tracked sandboxes
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

// ── Config (settings schema served to the Plugins page) ─────────────────────
// Same mechanism as web-search-deepseek: dsh-settings derives an editable
// form from the Config the plugin exports. `apiKey` role « secret » → the page
// writes to the credentials store through remote.credentials (never into the
// settings file); `apiKeyEnv` role « credential-ref » names the reference.
// schemastery is loaded from candidates (bundle, then profile): without it, Config
// stays undefined and the plugin runs without a form (local routes intact).
let Config = undefined
try {
  // The real ESM entry point: lib/index.mjs (measured — main points at the .cjs).
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
  console.error('[kybernos-computers] Config not declared (schemastery not found): ' + String((e && e.message) || e))
}
export { Config }
let sdkForTests = null       // injected by the tests: bypasses loadSdk()

// ── local state ─────────────────────────────────────────────────────────────
// { version: 1, sandboxes: { <sandboxId>: { sandboxId, label, createdAt, expiresAt, template } } }
// No secret here. The persistence survives restarts: the TTL sweeper
// can stop a sandbox forgotten by a dead process.

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

// ── E2B key (credential, never returned) ────────────────────────────────────

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
      // The credentials service resolves a REFERENCE: resolve(ref) → { value, source }.
      // (svc.get does not exist — measured 29/09: keyPresent stayed false after set.)
      const resolved = await svc.resolve(CRED_REF)
      if (resolved !== undefined && resolved !== null && typeof resolved.value === 'string' && resolved.value !== '') return resolved.value
    } catch (e) {
      console.error('[kybernos-computers] lecture credential ' + CRED_REF + ' : ' + String((e && e.message) || e))
    }
  }
  // Environment fallback (developer / CI), the same low priority as the shell.
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
    console.error('[kybernos-computers] credential store refused: ' + String((e && e.message) || e))
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

// ── Lazy SDK: bundle → profile → auto-install ───────────────────────────────

const tryImportSdk = async (candidateDir) => {
  const entry = join(candidateDir, 'node_modules', SDK_PACKAGE)
  if (existsSync(join(entry, 'package.json')) !== true) return null
  // package.json read by readFileSync: an ESM import of a .json needs a
  // { type: 'json' } attribute on Node 26 (measured: ERR_IMPORT_ATTRIBUTE_MISSING).
  const pkg = JSON.parse(readFileSync(join(entry, 'package.json'), 'utf8'))
  const sub = typeof pkg.module === 'string' && pkg.module !== '' ? pkg.module : pkg.main
  const resolved = join(entry, sub || 'dist/index.js')
  if (existsSync(resolved) !== true) return null
  try {
    const sdk = await import(pathToFileURL(resolved).href)
    if (sdk === null || sdk.Sandbox === undefined) {
      console.error('[kybernos-computers] ' + resolved + ' loaded without a Sandbox export')
      return null
    }
    return sdk
  } catch (e) {
    // Diagnostic: without this log, an import failure is silent (a bare sdk_introuvable).
    console.error('[kybernos-computers] import ' + resolved + ' : ' + String((e && e.stack) || e).slice(0, 400))
    return null
  }
}

const autoInstallSdk = () => {
  mkdirSync(DATA_DIR, { recursive: true })
  console.log('[kybernos-computers] installation de ' + SDK_PACKAGE + '@' + SDK_RANGE + ' dans ' + SDK_INSTALL_DIR + '…')
  const made = spawnSync('npm', ['install', '--prefix', DATA_DIR, '--no-audit', '--no-fund', '--omit=dev', '--loglevel=error', SDK_PACKAGE + '@' + SDK_RANGE], { encoding: 'utf8', timeout: 180_000 })
  if (made.status !== 0) {
    console.error('[kybernos-computers] auto-install failed (npm status ' + String(made.status) + ') : ' + String(made.stderr || '').slice(0, 300))
    return false
  }
  return true
}

const loadSdk = async () => {
  if (sdkForTests !== null) return sdkForTests
  if (sdkPromise !== null) return sdkPromise
  sdkPromise = (async () => {
    // 1. the bundle's node_modules (dev checkout)
    const local = await tryImportSdk(BUNDLE_DIR).catch(() => null)
    if (local !== null) return local
    // 2. the DSH profile's node_modules
    const profile = await tryImportSdk(join(DSH_HOME, 'profiles', 'web')).catch(() => null)
    if (profile !== null) return profile
    // 3. the user's auto-install (~/.dsh/kybernos-computers/node_modules)
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

// ── E2B operations (all receive the key, none ever logs it) ─────────────────

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

// Known templates: 'base' (bare Linux) | 'kybernos-dsh' (embedded DSH agent,
// wired to the Kybernos proxy). The dsh template receives KYBERNOS_API_KEY through envs
// at creation — the client's kys-… token, read from the local credential, and
// NEVER logged nor returned.
const TEMPLATES = ['base', 'kybernos-dsh']
const DSH_TEMPLATE = 'kybernos-dsh'
const KYBERNOS_CRED_REF = 'KYBERNOS_API_KEY' // set by kybernos-cloud at claim time

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
    // the SDK's envs: passed at creation, never displayed.
    createOpts.envs = { KYBERNOS_API_KEY: kys }
  }
  const ttl = createOpts.timeoutMs
  try {
    // Template as the FIRST argument (SDK v2 overload): Sandbox.create('base', opts).
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

// ── embedded task: the agent runs INSIDE the VM (Manus model) ───────────────
// A kybernos-dsh sandbox receives a mission; `dsh headless --json` runs there
// with the client's key (LLM billed to the Kybernos account). The final message
// + a summary are returned, then we detach (stop by default — pause if asked).

const runDshTask = async ({ mission, ttlMs, keep }) => {
  if (typeof mission !== 'string' || mission.trim() === '') return { ok: false, error: 'mission_manquante' }
  const started = await startSandbox({ label: 'embedded task · ' + mission.slice(0, 40), ttlMs: ttlMs ?? 3_600_000, template: DSH_TEMPLATE })
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
    out.note = 'VM frozen (computer_resume to continue it, computer_stop to throw it away).'
  } else {
    await stopSandbox({ sandboxId })
    out.note = 'VM stopped — files that were not read back are lost (the answer above is the durable result).'
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

// ── pause / resume (SDK beta) ───────────────────────────────────────────────
// betaPause freezes the VM: CPU billing stops, the disk is kept,
// and `Sandbox.connect(sandboxId)` RESUMES it automatically. During the pause
// our local TTL is suspended (a frozen VM must not be killed by the
// sweeper); on resume a fresh deadline + the E2B timeout are set.

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
    entry.expiresAt = Number.MAX_SAFE_INTEGER // out of the sweep while frozen
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
    // connect() resumes a paused sandbox (SDK contract) and hands back a
    // live instance; the E2B timeout is also set again on the server side.
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

// Any activity pushes the local deadline back by a full TTL (the E2B SDK
// applies its own session timeout on its side). Capped at the max.
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

// ── TTL sweeper ─────────────────────────────────────────────────────────────
// Stops the expired sandboxes even if nobody calls the routes. Only
// runs when a key exists (otherwise kill would fail anyway).

let sweeperTimer = null

const sweepOnce = async () => {
  const state = readState()
  const now = Date.now()
  for (const entry of Object.values(state.sandboxes)) {
    // The state file is read from disk and the sweeper runs from a timer: an entry that is not a sandbox (a damaged file) is skipped,
    // it must not reject a `void sweepOnce()` (an unhandled rejection ends DSH) every 30 seconds.
    if (entry === null || typeof entry !== 'object' || typeof entry.sandboxId !== 'string') continue
    if (entry.expiresAt > now) continue
    console.log('[kybernos-computers] TTL expired for ' + entry.sandboxId + ' — stopping')
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

// Hosted instance: also accept the authorities declared to DSH with --trusted-host. The core bundle publishes the predicate
// (kybernos-plugin/trusted-authority.mjs); absent or failing, it answers false and the guard stays loopback-only.
const kbTrusted = (host) => { try { const f = globalThis[Symbol.for('kybernos.trustedAuthority')]; return typeof f === 'function' && f(host) === true } catch (e) { return false } }
// Host fence (scripts/test-route-hosts.mjs). DSH serves plugin routes BEFORE its own authentication, and a page that rebinds its own name to this machine
// (DNS rebinding) reaches them with its own name as Host, no cookie and, on a same-origin GET, no Origin (a browser sends none): a guard that looks at the
// Origin alone lets every read through. Every route of this bundle refuses a Host that is not this listener's (the port the socket is bound to, on
// 127.0.0.1 / localhost / [::1], or an authority declared with --trusted-host) before its own guard runs. A request with no socket (a test) is not judged.
const kbHostOK = (req) => {
  try {
    const host = req.headers !== null && req.headers !== undefined && typeof req.headers.host === 'string' ? req.headers.host : null
    const sock = req.socket !== null && req.socket !== undefined ? req.socket : null
    if (host === null || sock === null || typeof sock.localPort !== 'number') return true
    const port = ':' + sock.localPort
    return ['127.0.0.1' + port, 'localhost' + port, '[::1]' + port].indexOf(host) >= 0 || kbTrusted(host)
  } catch (e) { return false }
}
const kbFenced = (service) => {
  if (service === null || service === undefined || typeof service.register !== 'function') return service
  const fence = (route) => (route !== null && typeof route === 'object' && typeof route.handler === 'function'
    ? Object.assign({}, route, {
      handler: (req, res, ...rest) => {
        if (kbHostOK(req) !== true) {
          try { res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' }); res.end('{"ok":false,"error":"origin refused"}') } catch (e) { /* closed */ }
          return undefined
        }
        return route.handler(req, res, ...rest)
      },
    })
    : route)
  return new Proxy(service, { get: (target, key) => (key === 'register' ? (route) => target.register(fence(route)) : (typeof target[key] === 'function' ? target[key].bind(target) : target[key])) })
}

const sameOrigin = (req) => {
  try {
    const origin = req.headers && typeof req.headers.origin === 'string' ? req.headers.origin : ''
    if (origin === '') return true
    const u = new URL(origin)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const sock = req.socket !== null && req.socket !== undefined ? req.socket : null
    // A real connection: the origin is compared with what THIS listener really is (the socket's port), never with the client-supplied Host header
    // alone (a page that rebinds its own name sends the same authority as Host and as Origin). No socket = a synthetic caller (a test).
    if (sock === null || typeof sock.localPort !== 'number') return typeof req.headers.host === 'string' && u.host === req.headers.host
    const port = ':' + sock.localPort
    return (['127.0.0.1' + port, 'localhost' + port, '[::1]' + port].indexOf(u.host) >= 0 || kbTrusted(u.host))
  } catch (e) { return false }
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
    // The SDK is only loaded on use: only its presence on disk is reported.
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
    console.log('[kybernos-computers] key removed — stopping ' + entry.sandboxId)
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

// ── environment preference (composer selector) ──────────────────────────────
// 'desktop' (default: behaviour unchanged) | 'e2b' (the agent must prefer
// the computer_* tools over the local bash to run code). The value is
// injected into the system prompt — that is what makes the selector EFFECTIVE.

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
    '## Execution environment: E2B cloud computer',
    'The user selected “E2B” in the composer: for any code, command or script to run,',
    'use the computer_* tools (computer_start, then computer_exec/write/read) in an EPHEMERAL',
    'cloud sandbox rather than the local bash — unless asked otherwise or the operation is purely local',
    '(reading/editing the files of the current repository stays local). Stop (computer_stop) or freeze (computer_pause)',
    'the sandbox when the work is done; read the results BEFORE (computer_read): the VM is disposable.',
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

// `session: true` is a route that WRITES or SPENDS: besides the same-origin rule it needs DSH's signed browser-session cookie (session-guard.mjs, the
// terminal's rule). Plugin routes are served before DSH's own login and an Origin header is forgeable by any local program, so before this a
// `curl -X POST .../sandboxes/exec` with no header at all ran a command in the person's E2B sandbox, on the person's key and bill. Every caller is a page
// (Settings > Cloud computers, the composer's selector); the agent's computer_* tools call the same functions in-process, not these routes.
export const ROUTES = [
  { path: '/kybernos-computers/status', method: 'GET', guarded: true, run: statusRoute },
  { path: '/kybernos-computers/key/set', method: 'POST', guarded: true, session: true, body: true, cap: 4096, run: keySetRoute },
  { path: '/kybernos-computers/key/clear', method: 'POST', guarded: true, session: true, run: keyClearRoute },
  { path: '/kybernos-computers/sandboxes', method: 'GET', guarded: true, run: sandboxesRoute },
  { path: '/kybernos-computers/sandboxes/start', method: 'POST', guarded: true, session: true, body: true, cap: 4096, run: startRoute },
  { path: '/kybernos-computers/sandboxes/exec', method: 'POST', guarded: true, session: true, body: true, cap: 131_072, run: execRoute },
  { path: '/kybernos-computers/sandboxes/write', method: 'POST', guarded: true, session: true, body: true, cap: LIMITS.writeMaxBytes + 65_536, run: writeRoute },
  { path: '/kybernos-computers/sandboxes/read', method: 'GET', guarded: true, run: readRoute },
  { path: '/kybernos-computers/sandboxes/stop', method: 'POST', guarded: true, session: true, body: true, cap: 4096, run: stopRoute },
  { path: '/kybernos-computers/sandboxes/pause', method: 'POST', guarded: true, session: true, body: true, cap: 4096, run: pauseRoute },
  { path: '/kybernos-computers/sandboxes/resume', method: 'POST', guarded: true, session: true, body: true, cap: 4096, run: resumeRoute },
  { path: '/kybernos-computers/env', method: 'GET', guarded: true, run: envGetRoute },
  { path: '/kybernos-computers/env/set', method: 'POST', guarded: true, session: true, body: true, cap: 256, run: envSetRoute },
]

const mountWebRoutes = (ctx, webServer) => {
  webServer = kbFenced(webServer)
  for (const route of ROUTES) {
    const handler = async (req, res) => {
      if (req.method !== route.method) return sendJson(res, 405, { ok: false, error: route.method + ' expected' })
      if (sameOrigin(req) === false) return sendJson(res, 403, { ok: false, error: 'origin refused' })
      if (route.session === true) {
        const refused = writeGuard(req)
        if (refused !== null) return sendJson(res, refused.status, { ok: false, error: refused.error })
      }
      try {
        const body = route.body === true ? await readJsonBody(req, route.cap) : null
        sendJson(res, 200, await route.run(req, body))
      } catch (e) {
        console.error('[kybernos-computers] ' + route.path + ' : ' + String((e && e.message) || e))
        sendJson(res, 500, { ok: false, error: 'internal error' })
      }
    }
    ctx.effect(() => webServer.register({ kind: 'exact', path: route.path, handler }), 'kybernos-computers: route ' + route.path)
  }
  console.log('[kybernos-computers] routes /kybernos-computers/* registered (status, key/set, key/clear, env, env/set, sandboxes start/exec/write/read/stop/list)')
}

// ── Tools exposed to the model ──────────────────────────────────────────────
// Same contract as kybernos-cloud: `tools.register` only requires
// { name, parameters, output:{schema,render}, execute }. The tools NEVER
// handle the key — they go through the same functions as the
// routes (internal resolveKey). Common prefix `computer_` to tell them apart
// from the workstation's tools (local bash, cua-driver = desktop).

const TEXT_RESULT = (text) => [{ type: 'text', text }]

const describeError = (out) => out.error + (out.detail !== undefined ? ' — ' + out.detail : '')

const computerTools = () => {
  const startedHint = (out) => out.ok === true
    ? 'Sandbox ' + out.sandbox.sandboxId + ' started (' + out.sandbox.label + ', expires in ' + Math.round((out.sandbox.expiresAt - Date.now()) / 60000) + ' min). Use this identifier for computer_exec / computer_write / computer_read / computer_stop.'
    : 'Failed: ' + describeError(out) + (out.error === 'cle_absente' ? ' — ask the user to set up their E2B key in Settings › Cloud computers.' : '')
  return [
    {
      name: 'computer_start',
      description: 'Starts an ephemeral cloud computer (E2B microVM, Linux) to run code WITHOUT touching the user\'s machine. Billed to the user\'s E2B account, by the second. Default TTL 15 min, max 2 h, 4 simultaneous sandboxes. Templates: "base" (Linux + Python/Node, default) or "kybernos-dsh" (an embedded DSH agent connected to the customer\'s Kybernos account — see computer_task).',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          label: { type: 'string', description: 'Readable name of the job done in this sandbox (e.g. "competitor scraping").' },
          ttlMs: { type: 'number', description: 'Lifetime in milliseconds (60 000 min, 7 200 000 max, default 900 000).' },
          template: { type: 'string', enum: ['base', 'kybernos-dsh'], description: 'Sandbox image. "kybernos-dsh" embeds a DSH agent (needs the Kybernos Cloud sign-in).' },
        },
        required: [],
      },
      output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, sandboxId: { type: 'string' }, error: { type: 'string' } }, required: ['ok'] },
        render: (args, value) => TEXT_RESULT(startedHint(value)) },
      async execute(args) { return await startSandbox({ label: args.label, ttlMs: args.ttlMs, template: args.template }) },
    },
    {
      name: 'computer_task',
      description: 'Hands a MISSION to a DSH agent that runs INSIDE a cloud microVM (template kybernos-dsh): it plans and runs on its own, its LLM calls are billed to the customer\'s Kybernos account. Returns the final answer — one round trip, no intermediate stdout in this conversation. Waiting budget: ~10 min per call (beyond that, pass keep:true then continue with computer_resume). The VM is thrown away afterwards (files are lost — have them returned INSIDE the mission if needed).',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          mission: { type: 'string', description: 'The complete, self-contained mission (context included) given to the embedded agent.' },
          ttlMs: { type: 'number', description: 'Lifetime of the VM in milliseconds (default 3 600 000 = 1 h).' },
          keep: { type: 'boolean', description: 'true: freezes the VM at the end instead of stopping it (continue with computer_resume).' },
        },
        required: ['mission'],
      },
      output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, answer: { type: 'string' }, durationMs: { type: 'number' }, error: { type: 'string' } }, required: ['ok'] },
        render: (args, value) => TEXT_RESULT(value.ok === true
          ? 'Embedded mission done in ' + Math.round(Number(value.durationMs) / 1000) + ' s :\n' + String(value.answer)
          : 'Failed: ' + describeError(value)) },
      async execute(args) { return await runDshTask({ mission: args.mission, ttlMs: args.ttlMs, keep: args.keep }) },
    },
    {
      name: 'computer_exec',
      description: 'Runs a shell command in an E2B sandbox started with computer_start. Returns exitCode, stdout, stderr. Default cwd /home/user.',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          sandboxId: { type: 'string', description: 'Identifier returned by computer_start.' },
          command: { type: 'string', description: 'Shell command to run.' },
          timeoutMs: { type: 'number', description: 'Budget in milliseconds (5 000 min, 600 000 max, default 60 000).' },
        },
        required: ['sandboxId', 'command'],
      },
      output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, exitCode: { type: 'number' }, error: { type: 'string' } }, required: ['ok'] },
        render: (args, value) => TEXT_RESULT(value.ok === true ? '$ ' + String(args.command) + '\n(exit ' + String(value.exitCode) + ') ' + String(value.stdout).slice(0, 2000) : 'Failed: ' + describeError(value)) },
      async execute(args) { return await execCommand({ sandboxId: args.sandboxId, command: args.command, timeoutMs: args.timeoutMs }) },
    },
    {
      name: 'computer_write',
      description: 'Writes a text file in an E2B sandbox (creates the parent folders when needed).',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          sandboxId: { type: 'string', description: 'Identifier returned by computer_start.' },
          path: { type: 'string', description: 'Absolute path in the sandbox (e.g. /home/user/script.py).' },
          content: { type: 'string', description: 'UTF-8 content (max 4 MB).' },
        },
        required: ['sandboxId', 'path', 'content'],
      },
      output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, path: { type: 'string' }, error: { type: 'string' } }, required: ['ok'] },
        render: (args, value) => TEXT_RESULT(value.ok === true ? 'Written: ' + String(value.path) + ' (' + String(args.content).length + ' characters).' : 'Failed: ' + describeError(value)) },
      async execute(args) { return await writeFile({ sandboxId: args.sandboxId, path: args.path, content: args.content }) },
    },
    {
      name: 'computer_read',
      description: 'Reads a text file from an E2B sandbox (max 512 KB, truncated beyond).',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          sandboxId: { type: 'string', description: 'Identifier returned by computer_start.' },
          path: { type: 'string', description: 'Absolute path in the sandbox.' },
        },
        required: ['sandboxId', 'path'],
      },
      output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, content: { type: 'string' }, error: { type: 'string' } }, required: ['ok'] },
        render: (args, value) => TEXT_RESULT(value.ok === true ? String(value.content) : 'Failed: ' + describeError(value)) },
      async execute(args) { return await readFile({ sandboxId: args.sandboxId, path: args.path }) },
    },
    {
      name: 'computer_stop',
      description: 'Stops an E2B sandbox (stopping it as soon as you are done avoids useless billing — the TTL would cut it anyway).',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          sandboxId: { type: 'string', description: 'Identifier returned by computer_start.' },
        },
        required: ['sandboxId'],
      },
      output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, error: { type: 'string' } }, required: ['ok'] },
        render: (args, value) => TEXT_RESULT(value.ok === true ? 'Sandbox ' + String(args.sandboxId) + ' stopped.' : 'Failed: ' + describeError(value)) },
      async execute(args) { return await stopSandbox({ sandboxId: args.sandboxId }) },
    },
    {
      name: 'computer_pause',
      description: 'FREEZES a sandbox (E2B betaPause): CPU billing stops, the disk and the files are kept. Use it for a long task that will be continued later.',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          sandboxId: { type: 'string', description: 'Identifier returned by computer_start.' },
        },
        required: ['sandboxId'],
      },
      output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, error: { type: 'string' } }, required: ['ok'] },
        render: (args, value) => TEXT_RESULT(value.ok === true ? 'Sandbox ' + String(args.sandboxId) + ' frozen — disk kept, CPU not billed. computer_resume wakes it up with its files.' : 'Failed: ' + describeError(value)) },
      async execute(args) { return await pauseSandbox({ sandboxId: args.sandboxId }) },
    },
    {
      name: 'computer_resume',
      description: 'WAKES UP a sandbox frozen by computer_pause: files and disk processes intact, new TTL deadline.',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          sandboxId: { type: 'string', description: 'Identifier of the frozen sandbox.' },
          ttlMs: { type: 'number', description: 'New lifetime in milliseconds (default 900 000).' },
        },
        required: ['sandboxId'],
      },
      output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, error: { type: 'string' } }, required: ['ok'] },
        render: (args, value) => TEXT_RESULT(value.ok === true ? 'Sandbox ' + String(args.sandboxId) + ' woken up, expires in ' + Math.round((Number(value.expiresAt) - Date.now()) / 60000) + ' min.' : 'Failed: ' + describeError(value)) },
      async execute(args) { return await resumeSandbox({ sandboxId: args.sandboxId, ttlMs: args.ttlMs }) },
    },
    {
      name: 'computer_list',
      description: 'Lists the E2B code sandboxes tracked on this machine (identifier, label, time left before the TTL). These are scratch microVMs started with computer_start, NOT the person\'s cloud computers, workspaces or plan: read those with kaby_account.',
      parameters: { type: 'object', additionalProperties: false, properties: {}, required: [] },
      output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' }, sandboxes: { type: 'array' } }, required: ['ok'] },
        render: (args, value) => TEXT_RESULT(value.ok === true && Array.isArray(value.sandboxes) && value.sandboxes.length > 0
          ? value.sandboxes.map((s) => s.sandboxId + ' · ' + s.label + ' · ' + Math.round(s.remainingMs / 60000) + ' min left').join('\n')
          : 'No sandbox tracked.'), },
      async execute() { return await sandboxesRoute() },
    },
  ]
}

const mountTools = (ctx) => {
  ctx.inject(['tools'], (scope) => {
    for (const tool of computerTools()) scope.tools.register(tool)
    console.log('[kybernos-computers] tools computer_start/exec/write/read/stop/pause/resume/list/task registered')
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

// ── exported for the tests (no other public surface) ────────────────────────
export const testHooks = {
  setSdkForTests: (fake) => { sdkForTests = fake },
  setCredentialsForTests: (fake) => { credentialsService = fake },
  setHostCtxForTests: (fake) => { hostCtx = fake },
  readState, writeState, STATE_FILE,
  resolveKey, looksLikeE2bKey, storeKey, clearKey,
  startSandbox, execCommand, writeFile, readFile, stopSandbox,
  sweepOnce, clampTtl, touchExpiry, publicSandbox, computerTools, pauseSandbox, resumeSandbox, runDshTask, resolveKybernosKey,
}
