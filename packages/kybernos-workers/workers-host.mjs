// ── kybernos-workers · host logic ───────────────────────────────────────────
// "Workers" are the external coding agents DSH can drive (Claude Code, Codex, Gemini,
// OpenCode, Qwen, Hermes, ZCode). This module does four things, and only those:
//
//   1. READ the profile: is the connection mounted? does the tool line that exposes the
//      worker to the lead exist, and in which state?
//   2. CHECK for real (no model is called, so nothing is spent on the worker's
//      subscription): connection mounted, package installed, binary found in the PATH DSH
//      sees, sign-in reported by the CLI (or the API key present in DSH's environment),
//      write test in a throw-away git worktree.
//   3. SET the one policy DSH really exposes: the `@deepseek-ai/dsh-tool-subagent` line
//      (exposed to the lead or not, background allowed or not). Model, permissions and the
//      account stay the native product's: the connection packages have no key for them.
//   4. HELP a person get a worker running: mount a connection of ours (`activate`) and
//      install the program itself (`install`) from a CLOSED list of official commands,
//      only after the page showed the exact command and the person confirmed it.
//
// All I/O is injected (`deps`, `io`): test-host.mjs plays this file without DSH, without a
// real disk and without a browser. No @deepseek-ai/* import.

import { writeGuard } from './session-guard.mjs'
import {
  BUILTIN_WORKER,
  CURATED_MODELS,
  DRIVER_DEFAULTS,
  discoverModelsForDriver,
  emptyHarness,
  mergeDiscoveredModels,
  removeInstance,
  toggleFavorite,
  updateInstanceModels,
  updateRoleEngine,
  updateScopePolicy,
  upsertInstance
} from './harness-store.mjs'
import {
  createRuntimeState,
  exportRuntimeStore,
  recordQuotaUpdate,
  recordRateLimit,
  recordRunFinish,
  recordRunStart,
  runtimeSnapshot,
  selectWorkerInstance
} from './runtime-router.mjs'
import { collectAllQuotas, parseRateLimitHeaders } from './quota-collectors.mjs'

export const PAQUET_OUTIL = '@deepseek-ai/dsh-tool-subagent'
export const PAQUET_MCP = '@deepseek-ai/dsh-mcp-client'

/**
 * The official install command of each worker. A closed list: the page never sends a command
 * to run, only the id of a worker (and the command it showed, which must match this one).
 *   needs : programs that must be on the PATH for the command to work
 *   alt   : the Homebrew / npm alternative shown for people who prefer to run it themselves
 *   src   : where the command downloads from, shown before the person confirms
 *   doc   : the vendor's own installation guide
 */
const INSTALL = Object.freeze({
  'claude-code': Object.freeze({ cmd: 'curl -fsSL https://claude.ai/install.sh | bash', alt: 'brew install --cask claude-code', uninstall: 'brew uninstall --cask claude-code || rm -f ~/.local/bin/claude', src: 'claude.ai', needs: ['curl', 'bash'], doc: 'https://code.claude.com/docs/en/setup' }),
  codex: Object.freeze({ cmd: 'npm install -g @openai/codex', alt: 'brew install --cask codex', uninstall: 'npm uninstall -g @openai/codex', src: 'npm', needs: ['npm'], doc: 'https://github.com/openai/codex' }),
  gemini: Object.freeze({ cmd: 'npm install -g @google/gemini-cli', alt: 'brew install gemini-cli', uninstall: 'npm uninstall -g @google/gemini-cli', src: 'npm', needs: ['npm'], doc: 'https://github.com/google-gemini/gemini-cli' }),
  opencode: Object.freeze({ cmd: 'curl -fsSL https://opencode.ai/install | bash', alt: 'npm install -g opencode-ai', uninstall: 'npm uninstall -g opencode-ai || rm -f ~/.opencode/bin/opencode', src: 'opencode.ai', needs: ['curl', 'bash'], doc: 'https://opencode.ai/docs/' }),
  qwen: Object.freeze({ cmd: 'npm install -g @qwen-code/qwen-code@latest', alt: 'brew install qwen-code', uninstall: 'npm uninstall -g @qwen-code/qwen-code', src: 'npm', needs: ['npm'], doc: 'https://github.com/QwenLM/qwen-code' }),
  hermes: Object.freeze({ cmd: 'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash', uninstall: 'rm -rf ~/.hermes && rm -f /opt/homebrew/bin/hermes ~/.local/bin/hermes', src: 'hermes-agent.nousresearch.com', needs: ['curl', 'bash'], doc: 'https://github.com/NousResearch/hermes-agent' }),
  antigravity: Object.freeze({ cmd: 'curl -fsSL https://antigravity.google/cli/install.sh | bash', uninstall: 'rm -f ~/.local/bin/agy', src: 'antigravity.google', needs: ['curl', 'bash'], doc: 'https://antigravity.google/docs/cli' })
})

// The home-made connectors ship in ONE package (packages/dsh-subagent-maison, linked into the profile by the Suite) and are
// loaded by a subpath name. `anciensNoms` are the bare names a hand-made setup used (a link in the profile's node_modules and a
// patch line `name: "dsh-subagent-<id>"`): they still count as turned on, so such a machine neither loses its connectors nor
// gets a second line that would register the same provider twice.
const MAISON = '@local/dsh-subagent-maison'
const maison = (id) => ({ paquet: `${MAISON}/${id}`, dossier: MAISON, anciensNoms: Object.freeze([`dsh-subagent-${id}`]) })

const tool = (id, provider) => Object.freeze({ id: 'kybernos-workers-' + id, provider, toolName: 'subagent_' + provider.replace(/-/g, '_') })

/**
 * Frozen registry of the known workers, in display order.
 *   genre      : 'connexion' (an official or home-made subagent package) | 'mcp' (a local MCP server)
 *   acp        : present when the connection is the official ACP backend: { command, args } it must spawn
 *   paquet     : the name the patch loads (`name:` of the insert line). `dossier` = the package that must be in the profile's
 *                node_modules for it to load, when that is not `paquet` itself (a subpath of a shared package).
 *   activation : who mounts the connection. 'outils' = the Tools screen of the main plugin
 *                (/kybernos/tools/apply), 'workers' = this module (/kybernos-workers/activate)
 *   auth       : how "signed in" is verified without calling a model
 *                { format: 'json-loggedIn' | 'code' | 'count' | 'hermes', args }  → run the CLI
 *                { format: 'env', names }                                         → key in DSH's environment
 *   connect    : what the person has to do once the program is installed
 *                { mode: 'cli', cmd }  sign in from a terminal
 *                { mode: 'key', env, refs }  paste an API key (stored under `env`, found under any of `refs`)
 */
/**
 * Phase 0 empirically verified capability matrix per driver (measured 2026-11-25, zero paid model calls).
 * "unknown" or "unsupported" blocks multi-account UI promises until proven with two isolated identities.
 *   multiAccount   : 'proven' | 'unsupported' | 'unknown'
 *   authIsolation  : 'credential-ref' | 'profile-dir' | 'native-single'
 *   isolationVar   : non-secret isolation environment variable, when applicable
 *   modelDiscovery : 'cli' | 'live' | 'manual'
 *   modelSelection : boolean (whether the connector accepts a model parameter)
 *   continuation   : 'one-shot' | 'native' | 'summary-handoff'
 *   hotReload      : 'published-survives-gap-risk' | 'not-applicable'
 */
export const DRIVER_CAPABILITIES = Object.freeze({
  'claude-code': Object.freeze({
    multiAccount: 'unknown',
    authIsolation: 'profile-dir',
    isolationVar: 'CLAUDE_CONFIG_DIR',
    modelDiscovery: 'manual',
    modelSelection: true,
    continuation: 'one-shot',
    hotReload: 'published-survives-gap-risk',
    note: 'CLAUDE_CONFIG_DIR isolates from default ~/.claude; two-identity macOS Keychain OAuth isolation still requires live login proof.'
  }),
  codex: Object.freeze({
    multiAccount: 'proven',
    authIsolation: 'profile-dir',
    isolationVar: 'CODEX_HOME',
    modelDiscovery: 'manual',
    modelSelection: true,
    continuation: 'one-shot',
    hotReload: 'published-survives-gap-risk',
    note: 'CODEX_HOME isolates auth.json per directory (proven with two synthetic identities + empty dir, zero leak from default login).'
  }),
  gemini: Object.freeze({
    multiAccount: 'proven',
    authIsolation: 'credential-ref',
    isolationVar: null,
    modelDiscovery: 'manual',
    modelSelection: true,
    continuation: 'one-shot',
    hotReload: 'published-survives-gap-risk',
    note: 'Per-run ctx.credentials resolution via cleDuRun; key passed via GEMINI_API_KEY env only, never argv or patch.'
  }),
  antigravity: Object.freeze({
    multiAccount: 'unknown',
    authIsolation: 'native-single',
    isolationVar: null,
    modelDiscovery: 'cli',
    modelSelection: false,
    continuation: 'one-shot',
    hotReload: 'published-survives-gap-risk',
    note: 'Official ACP connector exposes no model key; XDG alone does not isolate agy login (HOME override required, side effects unproven).'
  }),
  opencode: Object.freeze({
    multiAccount: 'unknown',
    authIsolation: 'native-single',
    isolationVar: null,
    modelDiscovery: 'manual',
    modelSelection: true,
    continuation: 'one-shot',
    hotReload: 'published-survives-gap-risk',
    note: 'Binary absent on test host; profile-dir isolation unproven.'
  }),
  qwen: Object.freeze({
    multiAccount: 'proven',
    authIsolation: 'credential-ref',
    isolationVar: null,
    modelDiscovery: 'manual',
    modelSelection: true,
    continuation: 'one-shot',
    hotReload: 'published-survives-gap-risk',
    note: 'Per-run ctx.credentials resolution via cleDuRun; key passed via OPENAI_API_KEY env only, never argv or patch.'
  }),
  hermes: Object.freeze({
    multiAccount: 'unsupported',
    authIsolation: 'native-single',
    isolationVar: null,
    modelDiscovery: 'live',
    modelSelection: true,
    continuation: 'one-shot',
    hotReload: 'published-survives-gap-risk',
    note: 'HERMES_HOME relocates auth.json but Qwen OAuth still reads ~/.qwen/oauth_creds.json; not fully isolated.'
  }),
  zcode: Object.freeze({
    multiAccount: 'unsupported',
    authIsolation: 'native-single',
    isolationVar: null,
    modelDiscovery: 'manual',
    modelSelection: false,
    continuation: 'one-shot',
    hotReload: 'not-applicable',
    note: 'Local MCP server with its own credential vault; outside the subagent dispatcher.'
  })
})

export const WORKERS = Object.freeze([
  Object.freeze({
    id: 'claude-code', nom: 'Claude Code', genre: 'connexion', via: 'claude-agent-sdk', activation: 'outils',
    paquet: '@deepseek-ai/dsh-subagent-claude-code', outil: tool('claude-code', 'claude-code'),
    binaire: 'claude', versionArgs: ['--version'], auth: Object.freeze({ format: 'json-loggedIn', args: Object.freeze(['auth', 'status']) }),
    install: INSTALL['claude-code'], connect: Object.freeze({ mode: 'cli', cmd: 'claude' })
  }),
  Object.freeze({
    id: 'codex', nom: 'Codex', genre: 'connexion', via: 'app-server', activation: 'outils',
    paquet: '@deepseek-ai/dsh-subagent-codex', outil: tool('codex', 'codex'),
    binaire: 'codex', versionArgs: ['--version'], auth: Object.freeze({ format: 'code', args: Object.freeze(['login', 'status']) }),
    install: INSTALL.codex, connect: Object.freeze({ mode: 'cli', cmd: 'codex' })
  }),
  Object.freeze({
    id: 'gemini', nom: 'Gemini CLI', genre: 'connexion', via: 'cli-one-shot', activation: 'workers',
    ...maison('gemini'), outil: tool('gemini', 'gemini'),
    binaire: 'gemini', versionArgs: ['--version'], auth: Object.freeze({ format: 'env', names: Object.freeze(['GEMINI_API_KEY', 'GOOGLE_API_KEY']) }),
    install: INSTALL.gemini, connect: Object.freeze({ mode: 'key', env: 'GEMINI_API_KEY', refs: Object.freeze(['GEMINI_API_KEY', 'GOOGLE_API_KEY']) })
  }),
  Object.freeze({
    // Antigravity CLI (`agy`) speaks ACP natively: the official ACP backend drives it, so no per-CLI adapter and no API key
    // (the person signs in with a Google account, `agy acp` reuses that sign-in). Doc: https://antigravity.google/docs/cli/acp
    id: 'antigravity', nom: 'Antigravity', genre: 'connexion', via: 'acp', activation: 'workers',
    paquet: '@deepseek-ai/dsh-subagent-acp', outil: tool('antigravity', 'antigravity'),
    binaire: 'agy', versionArgs: ['--version'], auth: Object.freeze({ format: 'code', args: Object.freeze(['models']), timeoutMs: 40000 }),
    install: INSTALL.antigravity, connect: Object.freeze({ mode: 'cli', cmd: 'agy' }),
    acp: Object.freeze({ command: 'agy', args: Object.freeze(['acp']) })
  }),
  Object.freeze({
    id: 'opencode', nom: 'OpenCode', genre: 'connexion', via: 'cli-one-shot', activation: 'workers',
    ...maison('opencode'), outil: tool('opencode', 'opencode'),
    binaire: 'opencode', versionArgs: ['--version'], auth: Object.freeze({ format: 'count', args: Object.freeze(['auth', 'list']) }),
    install: INSTALL.opencode, connect: Object.freeze({ mode: 'cli', cmd: 'opencode auth login' })
  }),
  Object.freeze({
    id: 'qwen', nom: 'Qwen Code', genre: 'connexion', via: 'cli-one-shot', activation: 'workers',
    ...maison('qwen'), outil: tool('qwen', 'qwen'),
    binaire: 'qwen', versionArgs: ['--version'], auth: Object.freeze({ format: 'env', names: Object.freeze(['QWEN_TOKEN_PLAN_API_KEY', 'DASHSCOPE_API_KEY']) }),
    install: INSTALL.qwen, connect: Object.freeze({ mode: 'key', env: 'QWEN_TOKEN_PLAN_API_KEY', refs: Object.freeze(['QWEN_TOKEN_PLAN_API_KEY', 'DASHSCOPE_API_KEY']) })
  }),
  Object.freeze({
    id: 'hermes', nom: 'Hermes', genre: 'connexion', via: 'cli-one-shot', activation: 'workers',
    ...maison('hermes'), outil: tool('hermes', 'hermes'),
    binaire: 'hermes', versionArgs: ['--version'], auth: Object.freeze({ format: 'hermes', args: Object.freeze(['status']), timeoutMs: 40000 }),
    install: INSTALL.hermes, connect: Object.freeze({ mode: 'cli', cmd: 'hermes model' })
  }),
  Object.freeze({
    id: 'zcode', nom: 'ZCode', genre: 'mcp', via: 'mcp-local', activation: 'outils', mcpId: 'mcp-client-zcode', serverName: 'zcode',
    install: null, connect: null
  })
])

export const trouverWorker = (id) => WORKERS.find((w) => w.id === id)

/** Every name under which a worker's connection may appear in the patch (the current one first, then the old ones). */
export const nomsDeConnexion = (worker) => [worker.paquet, ...(worker.anciensNoms ?? [])].filter((n) => typeof n === 'string')

/**
 * The package that must be in the profile for the connection to load. A line carries the name it was written with: the current
 * one needs the shared package, an old bare name needs its own bare package — so a line is never judged by a package it does
 * not load. With no line yet (`nomMonte` null) it is the package a new line would need: the current one.
 */
export const paquetAChercher = (worker, nomMonte = null) => (nomMonte !== null && nomMonte !== worker.paquet ? nomMonte : (worker.dossier ?? worker.paquet))

// ── reading the profile patch ───────────────────────────────────────────────

const nettoyer = (brut) => {
  let v = String(brut ?? '').replace(/\s+#.*$/, '').trim()
  if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1)
  return v
}

/**
 * Splits `cordis.patch.yml` into its `- id: …` lines (the inserted entries). This is not a
 * YAML reader: the patch is written by this repo and by the Tools screen in a fixed shape
 * (regular indentation, one-line scalars). What is not recognised is ignored, never guessed.
 * @returns {{id:string, debut:number, fin:number, indent:number, cles:string[], clesConfig:string[], champs:Record<string,string>, config:Record<string,string>}[]}
 */
export function analyserPatch (texte) {
  const lignes = String(texte ?? '').split('\n')
  const items = []
  let cur = null
  let enConfig = false
  let enEnv = false
  for (let i = 0; i < lignes.length; i++) {
    const l = lignes[i]
    if (/^\s*#/.test(l) || l.trim() === '') continue
    const m = /^(\s*)-\s+id:\s*(.+)$/.exec(l)
    if (m) {
      cur = { id: nettoyer(m[2]), debut: i, fin: i, indent: m[1].length, cles: [], clesConfig: [], champs: {}, config: {}, env: {} }
      items.push(cur)
      enConfig = false
      enEnv = false
      continue
    }
    if (/^\S/.test(l)) { cur = null; enConfig = false; enEnv = false; continue }
    if (cur === null) continue
    const ind = /^(\s*)/.exec(l)[1].length
    if (ind <= cur.indent) { cur = null; enConfig = false; enEnv = false; continue }
    cur.fin = i
    const kv = /^\s*([A-Za-z_][\w-]*):\s*(.*)$/.exec(l)
    if (kv === null) continue
    if (ind === cur.indent + 2) {
      cur.cles.push(kv[1])
      enConfig = kv[1] === 'config'
      enEnv = false
      if (!enConfig) cur.champs[kv[1]] = nettoyer(kv[2])
    } else if (enConfig && ind === cur.indent + 4) {
      cur.clesConfig.push(kv[1])
      if (kv[1] === 'env' && nettoyer(kv[2]) === '') {
        enEnv = true
      } else {
        enEnv = false
        cur.config[kv[1]] = nettoyer(kv[2])
      }
    } else if (enConfig && enEnv && ind === cur.indent + 6) {
      cur.env[kv[1]] = nettoyer(kv[2])
    }
  }
  return items
}

const ENV_KEY_SECRET = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|COOKIE|AUTH)/i
const ENV_KEY_VALID = /^[A-Za-z_][A-Za-z0-9_]*$/
const MODEL_VALID = /^[A-Za-z0-9._:@/-]{1,128}$/
const CLES_CONNEXION_CONNUES = ['name', 'disabled', 'config']
const CLES_CONNEXION_CONFIG_CONNUES = ['providerName', 'model', 'env', 'permissionMode', 'permission', 'command', 'args', 'disposeGraceMs', 'disposeEofGraceMs', 'bin', 'baseUrl']

/**
 * Computes a new patch updating `config.model` and non-secret `config.env` on a mounted connection row.
 * Refuses secret-looking env keys (secrets must live in ctx.credentials, never in cordis.patch.yml),
 * unknown hand-edited keys, or drivers without modelSelection when `model` is set.
 * @returns {{ok:true, action:'modification'|'inchange', apres:string} | {ok:false, error:string, detail?:unknown}}
 */
export function calculerConfigConnexion ({ worker, model, env, texte }) {
  if (worker === undefined) return { ok: false, error: 'worker-inconnu' }
  if (worker.genre !== 'connexion') return { ok: false, error: 'non-supporte' }
  const caps = DRIVER_CAPABILITIES[worker.id]
  if (model !== undefined && model !== null && model !== '') {
    if (caps?.modelSelection !== true) return { ok: false, error: 'model-non-supporte' }
    if (typeof model !== 'string' || !MODEL_VALID.test(model)) return { ok: false, error: 'bad-model' }
  }
  const nextEnv = {}
  if (env !== undefined && env !== null) {
    if (typeof env !== 'object' || Array.isArray(env)) return { ok: false, error: 'bad-env' }
    for (const [k, v] of Object.entries(env)) {
      if (!ENV_KEY_VALID.test(k)) return { ok: false, error: 'bad-env-key', detail: k }
      if (ENV_KEY_SECRET.test(k)) return { ok: false, error: 'secret-in-patch-refused', detail: k }
      if (typeof v !== 'string' || /[\r\n]/.test(v)) return { ok: false, error: 'bad-env-value', detail: k }
      if (v !== '') nextEnv[k] = v
    }
  }
  const avant = String(texte ?? '')
  const items = analyserPatch(avant)
  const noms = nomsDeConnexion(worker)
  const it = items.find((x) => noms.includes(x.champs.name))
  if (it === undefined || estCoupee(items, it.id)) return { ok: false, error: 'connexion-absente' }
  const inconnues = [...it.cles.filter((k) => !CLES_CONNEXION_CONNUES.includes(k)), ...it.clesConfig.filter((k) => !CLES_CONNEXION_CONFIG_CONNUES.includes(k))]
  if (inconnues.length > 0) return { ok: false, error: 'ligne-modifiee-a-la-main', detail: inconnues }
  const nextModel = model === undefined ? (it.config.model ?? '') : (model === null ? '' : model)
  const finalEnv = env === undefined ? it.env : nextEnv
  const sameModel = (it.config.model ?? '') === nextModel
  const prevEnvKeys = Object.keys(it.env).sort()
  const nextEnvKeys = Object.keys(finalEnv).sort()
  const sameEnv = prevEnvKeys.length === nextEnvKeys.length && prevEnvKeys.every((k, idx) => k === nextEnvKeys[idx] && it.env[k] === finalEnv[k])
  if (sameModel && sameEnv) return { ok: true, action: 'inchange', apres: avant }

  const p = ' '.repeat(it.indent)
  const quoteYaml = (s) => "'" + String(s).replace(/'/g, "''") + "'"
  const out = [
    `${p}- id: ${it.id}`,
    `${p}  name: ${quoteYaml(it.champs.name)}`,
    ...(it.champs.disabled !== undefined ? [`${p}  disabled: ${it.champs.disabled}`] : [])
  ]
  const cfgLines = []
  const scalarOrder = ['providerName', 'command', 'args', 'permission', 'permissionMode', 'bin', 'baseUrl', 'disposeGraceMs', 'disposeEofGraceMs']
  for (const k of scalarOrder) {
    if (it.config[k] !== undefined && it.config[k] !== '') cfgLines.push(`${p}    ${k}: ${it.config[k]}`)
  }
  if (nextModel !== '') cfgLines.push(`${p}    model: ${quoteYaml(nextModel)}`)
  if (nextEnvKeys.length > 0) {
    cfgLines.push(`${p}    env:`)
    for (const k of nextEnvKeys) cfgLines.push(`${p}      ${k}: ${quoteYaml(finalEnv[k])}`)
  }
  if (cfgLines.length > 0) {
    out.push(`${p}  config:`)
    out.push(...cfgLines)
  }
  const lignes = avant.split('\n')
  lignes.splice(it.debut, it.fin - it.debut + 1, ...out)
  const apres = lignes.join('\n')
  const relu = analyserPatch(apres).find((x) => x.id === it.id)
  if (relu === undefined || (relu.config.model ?? '') !== nextModel || Object.keys(relu.env).length !== nextEnvKeys.length) {
    return { ok: false, error: 'auto-controle' }
  }
  return { ok: true, action: 'modification', apres }
}

const estLigneOutil = (it, worker) => it.champs.name === PAQUET_OUTIL && it.config.provider === worker.outil?.provider

/**
 * Is the entry `id` switched off? The loader ends up with the value of the LAST entry of the file that names the id and carries `disabled`,
 * whether that is the connection's own row or a patch entry aimed at its id (Settings › Tools writes both shapes).
 */
const estCoupee = (items, id) => items.reduce((v, it) => (it.id === id && it.champs.disabled !== undefined ? it.champs.disabled === 'true' : v), false)

/**
 * What the profile says about a worker: is the connection mounted (and not switched off)? is there a tool line?
 * `desactivee` = the connection is in the file but switched off (`disabled: true`): DSH does not load it, so it reads as not turned on.
 * `nous` = the line carries the id THIS module writes (so it may be edited here).
 */
export function etatProfil (texte, worker) {
  const items = analyserPatch(texte)
  let connexion = false
  let desactivee = false
  let nomMonte = null
  if (worker.genre === 'connexion') {
    const ligneConnexion = items.find((it) => nomsDeConnexion(worker).includes(it.champs.name))
    desactivee = ligneConnexion !== undefined && estCoupee(items, ligneConnexion.id)
    connexion = ligneConnexion !== undefined && !desactivee
    nomMonte = connexion ? ligneConnexion.champs.name : null
  } else if (worker.genre === 'mcp') {
    const ligneMcp = items.find((it) => it.id === worker.mcpId || (it.champs.name === PAQUET_MCP && it.config.serverName === worker.serverName))
    desactivee = ligneMcp !== undefined && estCoupee(items, ligneMcp.id)
    connexion = ligneMcp !== undefined && !desactivee
  }
  let ligne = null
  if (worker.genre === 'connexion') {
    const it = items.find((x) => estLigneOutil(x, worker))
    if (it !== undefined) {
      ligne = {
        id: it.id,
        nous: it.id === worker.outil.id,
        expose: it.champs.disabled !== 'true',
        arrierePlan: it.config.enableRunInBackground === 'true',
        profondeur: it.config.maxDepth ?? null,
        nomOutil: it.config.toolName ?? null
      }
    }
  }
  return { connexion, desactivee, nomMonte, ligne }
}

// ── writing the policy ──────────────────────────────────────────────────────

const CLES_ITEM_CONNUES = ['name', 'disabled', 'config']
const CLES_CONFIG_CONNUES = ['provider', 'toolName', 'enableRunInBackground', 'maxDepth']

const lignesItem = (worker, { expose, arrierePlan }, indent) => {
  const p = ' '.repeat(indent)
  const o = worker.outil
  return [
    `${p}- id: ${o.id}`,
    `${p}  name: '${PAQUET_OUTIL}'`,
    ...(expose ? [] : [`${p}  disabled: true`]),
    `${p}  config:`,
    `${p}    provider: ${o.provider}`,
    `${p}    toolName: ${o.toolName}`,
    `${p}    enableRunInBackground: ${arrierePlan ? 'true' : 'false'}`,
    `${p}    maxDepth: provider-managed`
  ]
}

/** Block appended at the end of the patch when the tool line does not exist yet. */
export function blocOutil (worker, politique, horodatage) {
  return ['',
    `# ── Workers · ${worker.nom} — added ${horodatage} by the Workers screen (Kybernos)`,
    `# Rollback: restore cordis.patch.yml.bak-workers-${worker.id}-${horodatage}, then DSH picks it up by itself.`,
    '- insert:',
    ...lignesItem(worker, politique, 4)
  ].join('\n') + '\n'
}

/**
 * Computes the new patch text for the requested policy, writing nothing. Plain refusals
 * rather than guesses:
 *   worker-inconnu · non-supporte · connexion-absente · ligne-existante (defined somewhere
 *   other than by this module) · ligne-modifiee-a-la-main · auto-controle
 * @returns {{ok:true, action:'ajout'|'modification'|'inchange', apres:string} | {ok:false, error:string, detail?:unknown}}
 */
export function calculerPolitique ({ worker, expose, arrierePlan, texte, horodatage }) {
  if (worker === undefined) return { ok: false, error: 'worker-inconnu' }
  if (worker.genre !== 'connexion') return { ok: false, error: 'non-supporte' }
  const voulu = { expose: expose === true, arrierePlan: arrierePlan === true }
  const avant = String(texte ?? '')
  const etat = etatProfil(avant, worker)
  if (!etat.connexion) return { ok: false, error: 'connexion-absente' }
  let apres
  let action
  if (etat.ligne === null) {
    action = 'ajout'
    apres = (avant === '' || avant.endsWith('\n') ? avant : avant + '\n') + blocOutil(worker, voulu, horodatage)
  } else if (!etat.ligne.nous) {
    return { ok: false, error: 'ligne-existante', detail: etat.ligne }
  } else {
    if (etat.ligne.expose === voulu.expose && etat.ligne.arrierePlan === voulu.arrierePlan && etat.ligne.profondeur === 'provider-managed') {
      return { ok: true, action: 'inchange', apres: avant }
    }
    const it = analyserPatch(avant).find((x) => x.id === worker.outil.id)
    const inconnues = [...it.cles.filter((k) => !CLES_ITEM_CONNUES.includes(k)), ...it.clesConfig.filter((k) => !CLES_CONFIG_CONNUES.includes(k))]
    if (inconnues.length > 0) return { ok: false, error: 'ligne-modifiee-a-la-main', detail: inconnues }
    action = 'modification'
    const lignes = avant.split('\n')
    lignes.splice(it.debut, it.fin - it.debut + 1, ...lignesItem(worker, voulu, it.indent))
    apres = lignes.join('\n')
  }
  // Self-check: read back what we are about to write.
  const relu = etatProfil(apres, worker)
  if (!relu.connexion || relu.ligne === null || relu.ligne.nous !== true || relu.ligne.expose !== voulu.expose || relu.ligne.arrierePlan !== voulu.arrierePlan) {
    return { ok: false, error: 'auto-controle' }
  }
  return { ok: true, action, apres }
}

// ── mounting a connection of ours ───────────────────────────────────────────

/** The `- insert:` block that loads a worker's subagent package, with its rollback note. */
export function blocActivation (worker, horodatage) {
  // An ACP worker needs its recipe: the backend spawns `command` with `args` on every run, and registers it under
  // `providerName`, which must be the provider the tool line delegates to.
  // `permission: allow` is not optional: with the ACP backend's default (`reject`) every tool the agent asks for is
  // answered `cancelled`, so a task that explores a repository (ls, grep, a build) ends with an EMPTY closing message and
  // reads as "the worker did nothing". Measured 2026-11-24 on agy 1.5.16 against a real project.
  const config = worker.acp === undefined ? [] : [
    '      config:',
    `        providerName: ${worker.outil.provider}`,
    `        command: ${worker.acp.command}`,
    `        args: [${worker.acp.args.map((a) => `'${a}'`).join(', ')}]`,
    '        permission: allow'
  ]
  return ['',
    `# ── Workers · ${worker.nom} — added ${horodatage} by the Workers screen (Kybernos)`,
    `# Rollback: restore cordis.patch.yml.bak-workers-activate-${worker.id}-${horodatage}; DSH reloads the profile by itself.`,
    '- insert:',
    `    - id: subagent-${worker.id}`,
    `      name: "${worker.paquet}"`,
    ...config
  ].join('\n') + '\n'
}

/**
 * New patch text that mounts the worker's connection. Refusals: worker-inconnu,
 * non-supporte (not handled by this module), deja-montee, auto-controle.
 * @returns {{ok:true, apres:string} | {ok:false, error:string}}
 */
export function calculerActivation ({ worker, texte, horodatage }) {
  if (worker === undefined) return { ok: false, error: 'worker-inconnu' }
  if (worker.genre !== 'connexion' || worker.activation !== 'workers') return { ok: false, error: 'non-supporte' }
  const avant = String(texte ?? '')
  const etat = etatProfil(avant, worker)
  if (etat.connexion) return { ok: false, error: 'deja-montee' }
  // Re-enabling a line we previously switched off with a `- id: <mountedId>\n  disabled: true` override.
  if (etat.desactivee) {
    const items = analyserPatch(avant)
    const mounted = items.find((it) => nomsDeConnexion(worker).includes(it.champs.name))
    const cibleId = mounted?.id ?? `subagent-${worker.id}`
    const dis = items.find((x) => x.id === cibleId && x.champs.name === undefined && x.champs.disabled === 'true')
    if (dis !== undefined) {
      const lignes = avant.split('\n')
      lignes.splice(dis.debut, dis.fin - dis.debut + 1)
      const apres = lignes.join('\n')
      if (etatProfil(apres, worker).connexion) return { ok: true, apres }
    }
    return { ok: false, error: 'ligne-desactivee' }
  }
  const apres = (avant === '' || avant.endsWith('\n') ? avant : avant + '\n') + blocActivation(worker, horodatage)
  if (!etatProfil(apres, worker).connexion) return { ok: false, error: 'auto-controle' }
  return { ok: true, apres }
}

/**
 * Switches off a `workers`-managed connection in cordis.patch.yml without deleting the CLI binary,
 * by appending a clean `- id: <mountedId>\n  disabled: true` patch entry (reversible via `calculerActivation`).
 */
export function calculerDesactivation ({ worker, texte, horodatage }) {
  if (worker === undefined) return { ok: false, error: 'worker-inconnu' }
  if (worker.genre !== 'connexion' || worker.activation !== 'workers') return { ok: false, error: 'non-supporte' }
  const avant = String(texte ?? '')
  const etat = etatProfil(avant, worker)
  if (!etat.connexion) return { ok: false, error: 'deja-desactivee' }
  const items = analyserPatch(avant)
  const mounted = items.find((it) => nomsDeConnexion(worker).includes(it.champs.name))
  if (mounted === undefined || !mounted.id) return { ok: false, error: 'ligne-introuvable' }
  const bloc = [
    '',
    `# ── Workers · ${worker.nom} disabled ${horodatage} by the Workers screen (Kybernos)`,
    `- id: ${mounted.id}`,
    '  disabled: true'
  ].join('\n') + '\n'
  const apres = (avant === '' || avant.endsWith('\n') ? avant : avant + '\n') + bloc
  const relu = etatProfil(apres, worker)
  if (relu.connexion || !relu.desactivee) return { ok: false, error: 'auto-controle' }
  return { ok: true, apres }
}

// ── real checks ─────────────────────────────────────────────────────────────

const premiereLigne = (sortie) => String(sortie ?? '').split('\n').map((s) => s.trim()).find((s) => s !== '' && !/^WARNING:/i.test(s)) ?? ''

/** Reads the answer of `claude auth status` (JSON); falls back on the exit code. */
export function lireAuthJson (res) {
  const texte = String(res?.sortie ?? '')
  try {
    const debut = texte.indexOf('{')
    const fin = texte.lastIndexOf('}')
    if (debut >= 0 && fin > debut) {
      const j = JSON.parse(texte.slice(debut, fin + 1))
      if (typeof j.loggedIn === 'boolean') return { connecte: j.loggedIn, detail: j.loggedIn ? String(j.authMethod ?? '') : premiereLigne(texte) }
    }
  } catch { /* falls back on the code */ }
  return { connecte: res?.code === 0, detail: premiereLigne(texte) }
}

/** `opencode auth list` prints "N credentials" (or "1 credential"): signed in when N > 0. */
export function lireAuthCompte (res) {
  const m = /(\d+)\s+credentials?/i.exec(String(res?.sortie ?? ''))
  if (m === null) return null
  const n = Number(m[1])
  return { connecte: n > 0, detail: n + (n === 1 ? ' credential' : ' credentials') }
}

/**
 * `hermes status` is a report in `◆ Section` blocks. Only two of them say whether a model can be used: "Auth Providers"
 * ("✓ logged in") and "API-Key Providers" ("✓ configured"). The others tick things that have nothing to do with it
 * (messaging platforms such as WhatsApp or A2A also read "✓ configured"): they must never count.
 * Anything that does not look like that report is "cannot tell" (null).
 */
export function lireAuthHermes (res) {
  const lignes = String(res?.sortie ?? '').split('\n')
  let section = ''
  let vu = false
  let trouvee = null
  for (const l of lignes) {
    const titre = /^\s*◆\s*(.+?)\s*$/.exec(l)
    if (titre !== null) { section = titre[1]; continue }
    if (!/^(Auth Providers|API-Key Providers)$/i.test(section)) continue
    vu = true
    if (trouvee === null && /✓\s+(logged in|configured)/i.test(l)) trouvee = l
  }
  if (trouvee !== null) return { connecte: true, detail: trouvee.replace(/\s+/g, ' ').trim() }
  return vu ? { connecte: false, detail: '' } : null
}

const ok = (id, code, detail) => ({ id, etat: 'ok', code, ...(detail !== undefined && detail !== '' ? { detail } : {}) })
const ko = (id, code, detail) => ({ id, etat: 'ko', code, ...(detail !== undefined && detail !== '' ? { detail } : {}) })
const inconnu = (id, code, detail) => ({ id, etat: 'inconnu', code, ...(detail !== undefined && detail !== '' ? { detail } : {}) })

/** The sign-in control of a CLI worker. Never says "ok" for something it could not read. */
async function controleAuth (worker, io) {
  const a = worker.auth
  if (a.format === 'env') {
    const trouvee = await protege(() => io.cleDansEnv?.(a.names))
    return trouvee === true ? ok('auth', 'connecte', 'API key found') : ko('auth', 'non-connecte', a.names.join(' / '))
  }
  const r = await protege(() => io.executer(worker.binaire, a.args, { delaiMs: a.timeoutMs ?? 20000 }))
  if (!r || r.absent === true || r.delai === true) return inconnu('auth', 'non-verifiable', r?.delai ? 'delai' : 'illisible')
  let lu
  if (a.format === 'json-loggedIn') lu = lireAuthJson(r)
  else if (a.format === 'count') lu = lireAuthCompte(r)
  else if (a.format === 'hermes') lu = lireAuthHermes(r)
  else lu = { connecte: r.code === 0, detail: premiereLigne(r.sortie) }
  if (lu === null) return inconnu('auth', 'non-verifiable', 'illisible')
  return lu.connecte ? ok('auth', 'connecte', lu.detail) : ko('auth', 'non-connecte', lu.detail)
}

/**
 * The checks of a worker, in order. A check whose condition is false is not played: it is
 * marked `inconnu` with the reason, never "ok".
 * io : { paquetInstalle(paquet):boolean, fichierExiste(chemin):boolean,
 *        trouver(binaire):Promise<string|null>,
 *        executer(binaire,args,{delaiMs}):Promise<{code,sortie,delai?,absent?}>,
 *        cleDansEnv(names):boolean|Promise<boolean>  (the launch environment, else DSH's credentials store),
 *        worktreeJetable():Promise<{ok:boolean, detail?:string}>, fichierServeur?:string }
 */
export async function verifier ({ worker, texte, io }) {
  const c = []
  const etat = etatProfil(texte, worker)
  c.push(etat.connexion ? ok('connexion', 'montee') : ko('connexion', 'non-montee'))
  if (worker.genre === 'connexion') {
    c.push(await protege(() => io.paquetInstalle(paquetAChercher(worker, etat.nomMonte))) === true ? ok('paquet', 'installe') : ko('paquet', 'non-installe'))
    const chemin = await protege(() => io.trouver(worker.binaire))
    if (typeof chemin === 'string' && chemin !== '') {
      const v = await protege(() => io.executer(worker.binaire, worker.versionArgs, { delaiMs: 20000 }))
      c.push(ok('binaire', 'trouve', chemin + (v && v.code === 0 ? ' · ' + premiereLigne(v.sortie) : '')))
      c.push(await controleAuth(worker, io))
    } else {
      c.push(ko('binaire', 'absent'))
      c.push(inconnu('auth', 'binaire-absent'))
    }
  } else {
    const present = await protege(() => io.fichierExiste(io.fichierServeur ?? ''))
    c.push(present === true ? ok('paquet', 'serveur-present', io.fichierServeur) : ko('paquet', 'serveur-absent', io.fichierServeur))
    c.push(inconnu('auth', 'coffre-propre'))
  }
  const w = await protege(() => io.worktreeJetable())
  c.push(w && w.ok === true ? ok('worktree', 'ecriture-ok', w.detail) : ko('worktree', 'ecriture-ko', w?.detail))
  return { statut: statutGlobal(c), controles: c }
}

async function protege (fn) { try { return await fn() } catch (e) { return undefined } }

/** Pure. One word for the row, from the most blocking to the least. */
export function statutGlobal (controles) {
  const par = Object.fromEntries(controles.map((x) => [x.id, x]))
  if (par.connexion?.etat === 'ko') return 'a-connecter'
  if (par.paquet?.etat === 'ko') return par.paquet.code === 'serveur-absent' ? 'serveur-absent' : 'a-relancer'
  if (par.binaire?.etat === 'ko') return 'binaire-absent'
  if (par.auth?.etat === 'ko') return 'non-connecte'
  if (par.worktree?.etat === 'ko') return 'ecriture-impossible'
  if (controles.some((x) => x.etat === 'inconnu')) return 'incomplet'
  return 'pret'
}

// ── installing a program ────────────────────────────────────────────────────

const LIGNES_GARDEES = 40
const LIGNE_MAX = 240

/** Drops the terminal control sequences an installer prints (colours, cursor moves). */
export const sansAnsi = (t) => String(t).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '').replace(/\r/g, '\n')

/** Appends a chunk of installer output to a job's log: whole lines only, last ones kept. */
export function ajouterAuJournal (job, morceau) {
  const texte = (job.reste ?? '') + sansAnsi(morceau)
  const lignes = texte.split('\n')
  job.reste = lignes.pop() ?? ''
  for (const l of lignes) {
    const t = l.trim()
    if (t === '') continue
    job.journal.push(t.length > LIGNE_MAX ? t.slice(0, LIGNE_MAX) + '…' : t)
  }
  if (job.journal.length > LIGNES_GARDEES) job.journal.splice(0, job.journal.length - LIGNES_GARDEES)
}

const vueJob = (job) => (job === undefined ? null : {
  phase: job.phase, journal: [...job.journal, ...(job.reste ? [job.reste.slice(0, LIGNE_MAX)] : [])], code: job.code ?? null,
  surLePath: job.surLePath ?? null, raison: job.raison ?? null, commence: job.commence, fini: job.fini ?? null
})

// ── routes ──────────────────────────────────────────────────────────────────
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
const str = (v) => (typeof v === 'string' && v.length > 0 ? v : null)
const hotesLocaux = (req) => {
  const port = typeof req?.socket?.localPort === 'number' ? ':' + req.socket.localPort : ''
  return ['127.0.0.1' + port, 'localhost' + port, '[::1]' + port]
}
const origineOk = (req, strict) => {
  try {
    const source = str(req?.headers?.origin) ?? str(req?.headers?.referer)
    if (source === null) return strict === false
    const u = new URL(source)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    return (hotesLocaux(req).includes(u.host) || kbTrusted(u.host))
  } catch { return strict === false }
}
export const sameOriginStrict = (req) => origineOk(req, true)
export const sameOriginLax = (req) => origineOk(req, false)

const envoyer = (res, statut, charge) => {
  try {
    res.writeHead(statut, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(charge))
  } catch { /* socket closed */ }
}
const lireCorps = async (req, plafond = 4096) => {
  let taille = 0
  const morceaux = []
  for await (const m of req) { taille += m.length; if (taille > plafond) throw new Error('too-large'); morceaux.push(m) }
  return morceaux.length === 0 ? null : JSON.parse(Buffer.concat(morceaux).toString('utf8'))
}

const horodatage = (d) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

const PLATEFORMES_INSTALL = ['darwin', 'linux']

const SAFE_TOOL_RE = /^subagent_[a-z0-9_]{1,40}$/
const SAFE_ID_RE = /^[a-z0-9][a-z0-9._:/-]{0,120}$/i

/** Sanitizes the active Composer external worker binding (metadata only, never prompt text). */
export function sanitizeActiveWorker (raw, now = new Date()) {
  if (raw === null || raw === undefined || typeof raw !== 'object') return null
  const workerId = typeof raw.workerId === 'string' && SAFE_ID_RE.test(raw.workerId.trim()) ? raw.workerId.trim() : ''
  const driverId = typeof raw.driverId === 'string' && SAFE_ID_RE.test(raw.driverId.trim()) ? raw.driverId.trim() : ''
  if (workerId === '' || driverId === '') return null
  const w = trouverWorker(driverId)
  const derivedTool = w?.outil?.toolName ?? ('subagent_' + driverId.toLowerCase().replace(/[^a-z0-9]+/g, '_'))
  const toolName = SAFE_TOOL_RE.test(derivedTool) ? derivedTool : null
  if (toolName === null) return null
  const cleanStr = (v, max = 120) => (typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max) : '')
  const modelId = cleanStr(raw.modelId, 120)
  const resolvedModelId = cleanStr(raw.resolvedModelId || modelId, 120)
  const effort = cleanStr(raw.effort, 24).toLowerCase()
  return {
    workerId,
    driverId,
    workerLabel: cleanStr(raw.workerLabel || w?.nom || driverId, 80) || driverId,
    modelId,
    modelLabel: cleanStr(raw.modelLabel || modelId, 100) || modelId,
    resolvedModelId,
    effort: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(effort) ? effort : '',
    toolName,
    updatedAt: now instanceof Date ? now.toISOString() : new Date().toISOString()
  }
}

/** Formats the system prompt directive when the user explicitly selected an external worker in the Composer. */
export function formatActiveWorkerPrompt (active) {
  if (!active || typeof active !== 'object' || typeof active.toolName !== 'string' || !SAFE_TOOL_RE.test(active.toolName)) return ''
  const label = active.workerLabel || active.driverId || 'external worker'
  const modelPart = active.modelLabel
    ? ` with model "${active.modelLabel}"` + (active.resolvedModelId && active.resolvedModelId !== active.modelLabel ? ` (${active.resolvedModelId})` : '')
    : ''
  const effortPart = active.effort ? ` and reasoning effort "${active.effort}"` : ''
  return [
    '[Active external worker selected in Composer]',
    `The user explicitly selected the external worker "${label}" (${active.driverId})${modelPart}${effortPart}.`,
    `- MANDATORY: You MUST delegate this turn's user request directly to the \`${active.toolName}\` tool, even for short or simple prompts. Do NOT answer directly yourself.`,
    '- Pass the user\'s request faithfully to the tool, then return the external worker\'s answer concisely to the user.',
    `- If \`${active.toolName}\` is not exposed in your toolset or fails, do NOT silently answer with another model: report the exact error clearly and tell the user to enable "Exposed to the main agent" under Settings > Workers > ${label}.`
  ].join('\n')
}

/**
 * GET  /kybernos-workers/state?profile=         → registry + profile state + last check + install job
 * POST /kybernos-workers/check    {worker, profile?}                          → real checks
 * POST /kybernos-workers/policy   {worker, expose, background, profile?, dry?} → writes the patch (backup first)
 * POST /kybernos-workers/activate {worker, profile?}                           → mounts a connection of ours (backup first)
 * POST /kybernos-workers/install  {worker, command}                            → starts the install job (202)
 * GET  /kybernos-workers/install?worker=                                       → the install job: phase + last log lines
 * deps : { profils(), profilParDefaut(), lirePatch(profil), ecrirePatch(profil,texte),
 *          sauvegarder(profil,nom,contenu), cheminPatch(profil), io, maintenant() }
 * io.plateforme(), io.lancerInstallation(commande, {surDonnees}) and io.cleDansEnv(names) are
 * optional: without them the install is unavailable and a key is never found.
 */
export function monterWorkers (webServer, deps, liens = {}) {
  webServer = kbFenced(webServer)
  const dernier = new Map()
  if (typeof deps.lireChecks === 'function') {
    try {
      const saved = deps.lireChecks()
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
        let count = 0
        for (const [k, v] of Object.entries(saved)) {
          if (count >= 64) break
          if (typeof k === 'string' && (k.includes('/') || k.includes(':')) && v && typeof v === 'object' && typeof v.statut === 'string' && Array.isArray(v.controles)) {
            dernier.set(k, { quand: typeof v.quand === 'string' ? v.quand : deps.maintenant().toISOString(), statut: v.statut, controles: v.controles })
            count += 1
          }
        }
      }
    } catch { /* corrupt checks cache degrades to empty */ }
  }
  const persisterChecks = () => {
    if (typeof deps.ecrireChecks !== 'function') return
    try {
      const obj = {}
      for (const [k, v] of dernier.entries()) obj[k] = v
      deps.ecrireChecks(obj)
    } catch { /* best-effort persistence */ }
  }
  const jobs = new Map()
  // Scoped locks: concurrent checks on different workers never block each other;
  // patch writes are serialized per profile to prevent concurrent lost updates.
  const verificationsEnCours = new Set()
  const ecrituresPatchEnCours = new Set()
  let harnessWriteBusy = false
  let installEnCours = null
  const lireHarness = () => {
    if (typeof deps.lireHarness === 'function') {
      try {
        const r = deps.lireHarness()
        if (r && r.harness) return r
      } catch { /* fallback to empty */ }
    }
    return { ok: true, harness: emptyHarness(deps.maintenant()), exists: false }
  }
  const ecrireHarness = (nextHarness) => {
    if (typeof deps.ecrireHarness !== 'function') return { ok: false, error: 'harness-store-unavailable' }
    try { deps.ecrireHarness(nextHarness); return { ok: true } } catch (e) { return { ok: false, error: 'write-failed', detail: String(e?.message ?? e) } }
  }
  const initRuns = (() => {
    if (typeof deps.lireRuns === 'function') {
      try {
        const r = deps.lireRuns()
        if (r && r.store) return createRuntimeState(r.store)
      } catch { /* fallback to empty */ }
    }
    return createRuntimeState()
  })()
  const runtimeState = initRuns
  const persisterRuntime = (now) => {
    if (typeof deps.ecrireRuns !== 'function') return { ok: true }
    try { deps.ecrireRuns(exportRuntimeStore(runtimeState, now)); return { ok: true } } catch (e) { return { ok: false, error: 'write-failed', detail: String(e?.message ?? e) } }
  }
  const profilDe = (demande) => {
    const liste = deps.profils()
    if (demande === null || demande === undefined || demande === '') return { profil: deps.profilParDefaut(liste) }
    if (typeof demande !== 'string' || !liste.includes(demande)) return { erreur: 'profile-unknown' }
    return { profil: demande }
  }
  // Every POST here runs or writes something on the machine (it starts the install of a coding agent with « curl … | bash », mounts a package in the profile's cordis.patch.yml,
  // rewrites that patch, runs the agents' own binaries), so it needs DSH's signed browser session as well as the right Origin (session-guard.mjs, kybernos-terminal's rule, L3-15):
  // plugin routes are served before DSH's own login and an Origin header is forgeable by any local program. The only caller is the Workers page, which carries the cookie by itself;
  // a paired phone is refused (`refused_on_phone`).
  const corpsJson = async (req, res) => {
    if (req.method !== 'POST') { envoyer(res, 405, { ok: false, error: 'method-not-allowed' }); return undefined }
    if (sameOriginStrict(req) === false) { envoyer(res, 403, { ok: false, error: 'origin-refused' }); return undefined }
    const refuse = writeGuard(req)
    if (refuse !== null) { envoyer(res, refuse.status, { ok: false, error: refuse.error }); return undefined }
    if (!String(req.headers?.['content-type'] ?? '').toLowerCase().startsWith('application/json')) { envoyer(res, 415, { ok: false, error: 'json-required' }); return undefined }
    try { return (await lireCorps(req)) ?? {} } catch { envoyer(res, 400, { ok: false, error: 'bad-body' }); return undefined }
  }
  const cle = (profil, id) => profil + '/' + id
  const plateforme = () => { try { return typeof deps.io.plateforme === 'function' ? deps.io.plateforme() : process.platform } catch { return process.platform } }
  const installable = (w) => w.install != null && PLATEFORMES_INSTALL.includes(plateforme()) && typeof deps.io.lancerInstallation === 'function'

  const etat = (req, res) => {
    if (req.method !== 'GET') return envoyer(res, 405, { ok: false, error: 'method-not-allowed' })
    if (sameOriginLax(req) === false) return envoyer(res, 403, { ok: false, error: 'origin-refused' })
    let demande = null
    try { demande = new URL(req.url, 'http://localhost').searchParams.get('profile') } catch { demande = null }
    const p = profilDe(demande)
    if (p.erreur !== undefined) return envoyer(res, 400, { ok: false, error: p.erreur })
    let texte = null
    try { texte = deps.lirePatch(p.profil) } catch { texte = null }
    const workers = WORKERS.map((w) => {
      const e = etatProfil(texte ?? '', w)
      const installe = w.genre === 'connexion' ? deps.io.paquetInstalle(p.profil, paquetAChercher(w, e.nomMonte)) === true : deps.io.fichierExiste(deps.io.fichierServeur ?? '')
      return {
        id: w.id, nom: w.nom, genre: w.genre, via: w.via, paquet: w.paquet ?? null, binaire: w.binaire ?? null, activation: w.activation,
        capabilities: DRIVER_CAPABILITIES[w.id] ?? null,
        connect: w.connect, install: w.install == null ? null : { ...w.install, possible: installable(w) },
        connexion: e.connexion, desactivee: e.desactivee, installe, ligne: e.ligne, dernier: dernier.get(cle(p.profil, w.id)) ?? null, job: vueJob(jobs.get(w.id))
      }
    })
    const hState = lireHarness()
    return envoyer(res, 200, { ok: true, profil: p.profil, profils: deps.profils(), patch: deps.cheminPatch(p.profil), patchExiste: texte !== null, workers, builtinWorker: BUILTIN_WORKER, harness: hState.harness, defaults: DRIVER_DEFAULTS, curatedModels: CURATED_MODELS })
  }

  const verifierRoute = async (req, res) => {
    const corps = await corpsJson(req, res)
    if (corps === undefined) return undefined
    const worker = trouverWorker(corps.worker)
    if (worker === undefined) return envoyer(res, 404, { ok: false, error: 'unknown-worker' })
    const p = profilDe(corps.profile)
    if (p.erreur !== undefined) return envoyer(res, 400, { ok: false, error: p.erreur })
    const lockKey = cle(p.profil, worker.id)
    if (verificationsEnCours.has(lockKey)) return envoyer(res, 409, { ok: false, error: 'busy' })
    verificationsEnCours.add(lockKey)
    try {
      let texte = null
      try { texte = deps.lirePatch(p.profil) } catch { texte = null }
      const io = { ...deps.io, paquetInstalle: (paquet) => deps.io.paquetInstalle(p.profil, paquet) }
      const r = await verifier({ worker, texte: texte ?? '', io })
      const entree = { quand: deps.maintenant().toISOString(), statut: r.statut, controles: r.controles }
      dernier.set(cle(p.profil, worker.id), entree)
      persisterChecks()
      return envoyer(res, 200, { ok: true, worker: worker.id, ...entree })
    } finally { verificationsEnCours.delete(lockKey) }
  }

  const politique = async (req, res) => {
    const corps = await corpsJson(req, res)
    if (corps === undefined) return undefined
    const worker = trouverWorker(corps.worker)
    if (worker === undefined) return envoyer(res, 404, { ok: false, error: 'unknown-worker' })
    if (typeof corps.expose !== 'boolean' || typeof corps.background !== 'boolean') return envoyer(res, 400, { ok: false, error: 'bad-policy' })
    const p = profilDe(corps.profile)
    if (p.erreur !== undefined) return envoyer(res, 400, { ok: false, error: p.erreur })
    if (ecrituresPatchEnCours.has(p.profil)) return envoyer(res, 409, { ok: false, error: 'busy' })
    ecrituresPatchEnCours.add(p.profil)
    try {
      let texte = null
      try { texte = deps.lirePatch(p.profil) } catch { texte = null }
      if (texte === null) return envoyer(res, 409, { ok: false, error: 'patch-missing' })
      const stamp = horodatage(deps.maintenant())
      const calc = calculerPolitique({ worker, expose: corps.expose, arrierePlan: corps.background, texte, horodatage: stamp })
      if (!calc.ok) return envoyer(res, calc.error === 'non-supporte' ? 400 : 409, calc)
      if (corps.dry === true || calc.action === 'inchange') return envoyer(res, 200, { ok: true, dry: corps.dry === true, action: calc.action, patch: deps.cheminPatch(p.profil) })
      const nomSauvegarde = `cordis.patch.yml.bak-workers-${worker.id}-${stamp}`
      try {
        deps.sauvegarder(p.profil, nomSauvegarde, texte)
        deps.ecrirePatch(p.profil, calc.apres)
      } catch (e) { return envoyer(res, 500, { ok: false, error: 'write-failed', detail: String(e?.message ?? e) }) }
      return envoyer(res, 200, { ok: true, action: calc.action, backup: nomSauvegarde, patch: deps.cheminPatch(p.profil) })
    } finally { ecrituresPatchEnCours.delete(p.profil) }
  }

  const activer = async (req, res) => {
    const corps = await corpsJson(req, res)
    if (corps === undefined) return undefined
    const worker = trouverWorker(corps.worker)
    if (worker === undefined) return envoyer(res, 404, { ok: false, error: 'unknown-worker' })
    if (worker.genre !== 'connexion' || worker.activation !== 'workers') return envoyer(res, 400, { ok: false, error: 'non-supporte' })
    const p = profilDe(corps.profile)
    if (p.erreur !== undefined) return envoyer(res, 400, { ok: false, error: p.erreur })
    if (ecrituresPatchEnCours.has(p.profil)) return envoyer(res, 409, { ok: false, error: 'busy' })
    ecrituresPatchEnCours.add(p.profil)
    try {
      let texte = null
      try { texte = deps.lirePatch(p.profil) } catch { texte = null }
      if (texte === null) return envoyer(res, 409, { ok: false, error: 'patch-missing' })
      if (etatProfil(texte, worker).connexion) return envoyer(res, 200, { ok: true, already: true, patch: deps.cheminPatch(p.profil) })
      // Mounting a package DSH cannot load would be worse than not mounting it.
      let present = false
      // A NEW line is about to be written: it needs the current package (an old bare package would not load it).
      try { present = deps.io.paquetInstalle(p.profil, paquetAChercher(worker)) === true } catch { present = false }
      if (!present) return envoyer(res, 409, { ok: false, error: 'package-missing' })
      const stamp = horodatage(deps.maintenant())
      const calc = calculerActivation({ worker, texte, horodatage: stamp })
      if (!calc.ok) return envoyer(res, 409, calc)
      const nomSauvegarde = `cordis.patch.yml.bak-workers-activate-${worker.id}-${stamp}`
      try {
        deps.sauvegarder(p.profil, nomSauvegarde, texte)
        deps.ecrirePatch(p.profil, calc.apres)
      } catch (e) { return envoyer(res, 500, { ok: false, error: 'write-failed', detail: String(e?.message ?? e) }) }
      return envoyer(res, 200, { ok: true, already: false, backup: nomSauvegarde, patch: deps.cheminPatch(p.profil) })
    } finally { ecrituresPatchEnCours.delete(p.profil) }
  }

  const desactiver = async (req, res) => {
    const corps = await corpsJson(req, res)
    if (corps === undefined) return undefined
    const worker = trouverWorker(corps.worker)
    if (worker === undefined) return envoyer(res, 404, { ok: false, error: 'unknown-worker' })
    if (worker.genre !== 'connexion' || worker.activation !== 'workers') return envoyer(res, 400, { ok: false, error: 'non-supporte' })
    const p = profilDe(corps.profile)
    if (p.erreur !== undefined) return envoyer(res, 400, { ok: false, error: p.erreur })
    if (ecrituresPatchEnCours.has(p.profil)) return envoyer(res, 409, { ok: false, error: 'busy' })
    ecrituresPatchEnCours.add(p.profil)
    try {
      let texte = null
      try { texte = deps.lirePatch(p.profil) } catch { texte = null }
      if (texte === null) return envoyer(res, 409, { ok: false, error: 'patch-missing' })
      if (!etatProfil(texte, worker).connexion) return envoyer(res, 200, { ok: true, already: true, patch: deps.cheminPatch(p.profil) })
      const stamp = horodatage(deps.maintenant())
      const calc = calculerDesactivation({ worker, texte, horodatage: stamp })
      if (!calc.ok) return envoyer(res, 409, calc)
      const nomSauvegarde = `cordis.patch.yml.bak-workers-deactivate-${worker.id}-${stamp}`
      try {
        deps.sauvegarder(p.profil, nomSauvegarde, texte)
        deps.ecrirePatch(p.profil, calc.apres)
      } catch (e) { return envoyer(res, 500, { ok: false, error: 'write-failed', detail: String(e?.message ?? e) }) }
      return envoyer(res, 200, { ok: true, already: false, backup: nomSauvegarde, patch: deps.cheminPatch(p.profil) })
    } finally { ecrituresPatchEnCours.delete(p.profil) }
  }

  /** Runs the install command of a worker, off the request: the page polls the job. */
  const lancer = async (worker, commande) => {
    const job = { phase: 'running', journal: [], reste: '', commence: deps.maintenant().toISOString(), code: null }
    jobs.set(worker.id, job)
    installEnCours = worker.id
    // The outcome is worked out first and published in one go, `phase` LAST: a page that polls never sees "done" without
    // the rest of the answer (whether the program is on the PATH, when it ended).
    let phase = 'error'
    let raison = null
    let surLePath = null
    try {
      const fin = await deps.io.lancerInstallation(commande, { surDonnees: (t) => { try { ajouterAuJournal(job, t) } catch { /* the log is a courtesy */ } } })
      if (job.reste.trim() !== '') ajouterAuJournal(job, '\n')
      job.code = typeof fin?.code === 'number' ? fin.code : 1
      if (fin?.delai === true) raison = 'timeout'
      else if (job.code !== 0) raison = 'exit'
      else {
        phase = 'done'
        let chemin = null
        try { chemin = await deps.io.trouver(worker.binaire) } catch { chemin = null }
        surLePath = typeof chemin === 'string' && chemin !== ''
      }
    } catch (e) {
      raison = 'spawn'; job.code = 1
      try { ajouterAuJournal(job, String(e?.message ?? e) + '\n') } catch { /* ignore */ }
    } finally {
      job.raison = raison
      job.surLePath = surLePath
      job.fini = deps.maintenant().toISOString()
      job.phase = phase
      installEnCours = null
    }
  }

  const installer = async (req, res) => {
    if (req.method === 'GET') {
      if (sameOriginLax(req) === false) return envoyer(res, 403, { ok: false, error: 'origin-refused' })
      let id = null
      try { id = new URL(req.url, 'http://localhost').searchParams.get('worker') } catch { id = null }
      if (trouverWorker(id) === undefined) return envoyer(res, 404, { ok: false, error: 'unknown-worker' })
      return envoyer(res, 200, { ok: true, job: vueJob(jobs.get(id)) })
    }
    const corps = await corpsJson(req, res)
    if (corps === undefined) return undefined
    const worker = trouverWorker(corps.worker)
    if (worker === undefined) return envoyer(res, 404, { ok: false, error: 'unknown-worker' })
    if (worker.install == null) return envoyer(res, 400, { ok: false, error: 'not-installable' })
    if (typeof deps.io.lancerInstallation !== 'function') return envoyer(res, 501, { ok: false, error: 'install-unavailable' })
    if (!PLATEFORMES_INSTALL.includes(plateforme())) return envoyer(res, 400, { ok: false, error: 'unsupported-platform' })
    // The person confirmed the command the page showed: it must be the one this host would run.
    if (corps.command !== worker.install.cmd) return envoyer(res, 409, { ok: false, error: 'command-changed', command: worker.install.cmd })
    if (installEnCours !== null) return envoyer(res, 409, { ok: false, error: 'busy', worker: installEnCours })
    let present = null
    try { present = await deps.io.trouver(worker.binaire) } catch { present = null }
    if (typeof present === 'string' && present !== '') return envoyer(res, 409, { ok: false, error: 'already-installed', path: present })
    for (const besoin of worker.install.needs) {
      let chemin = null
      try { chemin = await deps.io.trouver(besoin) } catch { chemin = null }
      if (typeof chemin !== 'string' || chemin === '') return envoyer(res, 409, { ok: false, error: 'missing-tool', tool: besoin })
    }
    if (installEnCours !== null) return envoyer(res, 409, { ok: false, error: 'busy', worker: installEnCours })
    void lancer(worker, worker.install.cmd)
    return envoyer(res, 202, { ok: true, started: true })
  }

  // ── harness.json routes (instances, auto-discovered models, roles & favorites) ──

  const harnessGet = (req, res) => {
    if (req.method !== 'GET') return envoyer(res, 405, { ok: false, error: 'method-not-allowed' })
    if (sameOriginLax(req) === false) return envoyer(res, 403, { ok: false, error: 'origin-refused' })
    const r = lireHarness()
    return envoyer(res, 200, { ok: true, builtinWorker: BUILTIN_WORKER, harness: r.harness, capabilities: DRIVER_CAPABILITIES, defaults: DRIVER_DEFAULTS, curatedModels: CURATED_MODELS })
  }

  const harnessInstance = async (req, res) => {
    const corps = await corpsJson(req, res)
    if (corps === undefined) return undefined
    if (harnessWriteBusy) return envoyer(res, 409, { ok: false, error: 'busy' })
    harnessWriteBusy = true
    try {
      const cur = lireHarness().harness
      const now = deps.maintenant()
      const resOp = corps.action === 'remove'
        ? removeInstance(cur, corps.id ?? corps.instanceId, corps.expectedRevision, now)
        : upsertInstance(cur, corps, DRIVER_CAPABILITIES, now)
      if (!resOp.ok) {
        const st = resOp.error === 'revision-conflict' ? 409 : (resOp.error === 'unknown-instance' ? 404 : 400)
        return envoyer(res, st, resOp)
      }
      const wRes = ecrireHarness(resOp.harness)
      if (!wRes.ok) return envoyer(res, 500, wRes)
      // Optional safe patch sync for active Codex shadowHomePath or supported driver default model.
      let patchSync = null
      if (corps.action !== 'remove' && corps.syncPatch === true && resOp.instance?.active === true) {
        const w = trouverWorker(resOp.instance.driverId)
        const p = profilDe(corps.profile)
        if (w && p.erreur === undefined && !ecrituresPatchEnCours.has(p.profil)) {
          ecrituresPatchEnCours.add(p.profil)
          try {
            const texte = deps.lirePatch(p.profil)
            if (typeof texte === 'string') {
              const envUpdate = w.id === 'codex' && resOp.instance.shadowHomePath ? { CODEX_HOME: resOp.instance.shadowHomePath } : undefined
              const defModel = resOp.instance.models.find((m) => m.isDefault && m.visible)?.id
              const cap = DRIVER_CAPABILITIES[w.id]
              const calc = calculerConfigConnexion({
                worker: w,
                texte,
                env: envUpdate,
                model: cap?.modelSelection === true ? defModel : undefined
              })
              if (calc.ok && calc.action === 'modification') {
                const stamp = horodatage(now)
                const bak = `cordis.patch.yml.bak-workers-cfg-${w.id}-${stamp}`
                deps.sauvegarder(p.profil, bak, texte)
                deps.ecrirePatch(p.profil, calc.apres)
                patchSync = { ok: true, action: calc.action, backup: bak }
              } else {
                patchSync = { ok: calc.ok, action: calc.action ?? null, error: calc.error ?? null }
              }
            }
          } finally { ecrituresPatchEnCours.delete(p.profil) }
        }
      }
      return envoyer(res, 200, { ok: true, harness: resOp.harness, instance: resOp.instance ?? null, patchSync })
    } finally { harnessWriteBusy = false }
  }

  const harnessModels = async (req, res) => {
    const corps = await corpsJson(req, res)
    if (corps === undefined) return undefined
    if (harnessWriteBusy) return envoyer(res, 409, { ok: false, error: 'busy' })
    harnessWriteBusy = true
    try {
      const cur = lireHarness().harness
      const now = deps.maintenant()
      if (corps.action === 'sync') {
        // Preview discovery before instance exists (Add Worker Step 3) OR sync an existing instance.
        const existing = typeof corps.instanceId === 'string' ? cur.instances.find((i) => i.id === corps.instanceId) : null
        const driverId = existing ? existing.driverId : String(corps.driverId ?? '').trim()
        if (!(driverId in DRIVER_DEFAULTS)) return envoyer(res, 404, { ok: false, error: 'unknown-driver' })
        const disc = await discoverModelsForDriver(driverId, {
          executer: deps.io.executer,
          fetchJson: deps.io.fetchJson,
          lireCle: deps.io.lireCle,
          homeDir: deps.io.homeDir,
          homePath: existing?.homePath ?? corps.homePath,
          shadowHomePath: existing?.shadowHomePath ?? corps.shadowHomePath
        })
        if (!existing) {
          const modelSel = DRIVER_CAPABILITIES[driverId]?.modelSelection !== false
          const merged = mergeDiscoveredModels([], disc.models, modelSel)
          if (corps.autoCreate === true && typeof corps.instanceId === 'string' && corps.instanceId.trim() !== '') {
            const wDef = trouverWorker(driverId)
            const resOp = upsertInstance(cur, {
              id: corps.instanceId,
              driverId,
              label: corps.label || wDef?.nom || driverId,
              accent: corps.accent,
              binaryPath: corps.binaryPath || wDef?.binaire || '',
              homePath: corps.homePath,
              shadowHomePath: corps.shadowHomePath,
              launchArgs: corps.launchArgs,
              active: true,
              enabled: true,
              lastSync: now.toISOString(),
              models: merged,
              expectedRevision: corps.expectedRevision
            }, DRIVER_CAPABILITIES, now)
            if (!resOp.ok) {
              const st = resOp.error === 'revision-conflict' ? 409 : 400
              return envoyer(res, st, resOp)
            }
            const wRes = ecrireHarness(resOp.harness)
            if (!wRes.ok) return envoyer(res, 500, wRes)
            return envoyer(res, 200, { ok: true, source: disc.source, harness: resOp.harness, instance: resOp.instance })
          }
          return envoyer(res, 200, { ok: true, preview: true, source: disc.source, models: merged })
        }
        const modelSel = DRIVER_CAPABILITIES[driverId]?.modelSelection !== false
        const merged = mergeDiscoveredModels(existing.models, disc.models, modelSel)
        const nextInstances = cur.instances.map((i) => (i.id === existing.id ? { ...i, models: merged, lastSync: now.toISOString() } : i))
        const nextHarness = { ...cur, revision: cur.revision + 1, updatedAt: now.toISOString(), instances: nextInstances }
        const wRes = ecrireHarness(nextHarness)
        if (!wRes.ok) return envoyer(res, 500, wRes)
        return envoyer(res, 200, { ok: true, source: disc.source, harness: nextHarness, instance: nextInstances.find((i) => i.id === existing.id) })
      }
      const resOp = updateInstanceModels(cur, corps, DRIVER_CAPABILITIES, now)
      if (!resOp.ok) {
        const st = resOp.error === 'revision-conflict' ? 409 : (resOp.error === 'unknown-instance' ? 404 : 400)
        return envoyer(res, st, resOp)
      }
      const wRes = ecrireHarness(resOp.harness)
      if (!wRes.ok) return envoyer(res, 500, wRes)
      return envoyer(res, 200, { ok: true, harness: resOp.harness, instance: resOp.instance })
    } finally { harnessWriteBusy = false }
  }

  const harnessPolicy = async (req, res) => {
    const corps = await corpsJson(req, res)
    if (corps === undefined) return undefined
    if (harnessWriteBusy) return envoyer(res, 409, { ok: false, error: 'busy' })
    harnessWriteBusy = true
    try {
      const cur = lireHarness().harness
      const now = deps.maintenant()
      let resOp
      if (corps.kind === 'role') resOp = updateRoleEngine(cur, corps, now)
      else if (corps.kind === 'scope') resOp = updateScopePolicy(cur, corps, now)
      else if (corps.kind === 'favorite') {
        const favKind = corps.targetKind === 'worker' || corps.targetKind === 'llm'
          ? corps.targetKind
          : (cur.instances.some((i) => i.id === corps.ownerId) ? 'worker' : 'llm')
        resOp = toggleFavorite(cur, { ...corps, kind: favKind }, now)
      }
      else return envoyer(res, 400, { ok: false, error: 'unknown-kind' })
      if (!resOp.ok) {
        const st = resOp.error === 'revision-conflict' ? 409 : (resOp.error === 'unknown-instance' ? 404 : 400)
        return envoyer(res, st, resOp)
      }
      const wRes = ecrireHarness(resOp.harness)
      if (!wRes.ok) return envoyer(res, 500, wRes)
      return envoyer(res, 200, { ok: true, harness: resOp.harness, ...(resOp.favorite !== undefined ? { favorite: resOp.favorite } : {}) })
    } finally { harnessWriteBusy = false }
  }

  const runtimeGet = (req, res) => {
    if (req.method !== 'GET') return envoyer(res, 405, { ok: false, error: 'method-not-allowed' })
    if (sameOriginLax(req) === false) return envoyer(res, 403, { ok: false, error: 'origin-refused' })
    let sessionId = null
    try { sessionId = new URL(req.url, 'http://localhost').searchParams.get('session') } catch { sessionId = null }
    const h = lireHarness().harness
    return envoyer(res, 200, runtimeSnapshot(runtimeState, { harness: h, sessionId, now: deps.maintenant() }))
  }

  const runtimeRoute = async (req, res) => {
    const corps = await corpsJson(req, res)
    if (corps === undefined) return undefined
    const now = deps.maintenant()
    const action = corps.action
    if (action === 'select') {
      const h = lireHarness().harness
      const pick = selectWorkerInstance({
        harness: h,
        runtime: runtimeState,
        requestedWorkerId: corps.requestedWorkerId ?? corps.workerId ?? 'auto',
        roleId: corps.roleId ?? null,
        sessionId: corps.sessionId ?? null,
        workKey: corps.workKey ?? null,
        policy: corps.policy ?? null,
        includeBuiltin: corps.includeBuiltin !== false,
        now
      })
      return envoyer(res, pick.ok ? 200 : 409, pick)
    }
    let resOp
    if (action === 'quota') {
      resOp = recordQuotaUpdate(runtimeState, corps.workerId, corps, now)
    } else if (action === 'rate-limit') {
      resOp = recordRateLimit(runtimeState, corps, now)
    } else if (action === 'start') {
      resOp = recordRunStart(runtimeState, corps, now)
    } else if (action === 'finish') {
      resOp = recordRunFinish(runtimeState, corps, now)
    } else if (action === 'headers') {
      const parsed = parseRateLimitHeaders(corps.headers, now)
      const prev = runtimeState.quotas.get(corps.workerId)
      const byKey = new Map((prev?.windows ?? []).map((w) => [w.key, w]))
      for (const w of parsed.windows) byKey.set(w.key, w)
      resOp = recordQuotaUpdate(runtimeState, corps.workerId, {
        ...(corps.driverId ? { driverId: corps.driverId } : {}),
        ...(corps.label ? { label: corps.label } : {}),
        windows: Array.from(byKey.values()),
        ...(parsed.cooldownUntil ? { cooldownUntil: parsed.cooldownUntil } : {})
      }, now)
    } else if (action === 'probe') {
      const baseHarness = lireHarness().harness
      const effInstances = Array.isArray(baseHarness.instances) ? baseHarness.instances.slice() : []
      const seenIds = new Set(effInstances.map((i) => i.id))
      const seenDrivers = new Set(effInstances.map((i) => i.driverId))
      const p = profilDe(corps.profile)
      if (p.erreur === undefined) {
        let texte = null
        try { texte = deps.lirePatch(p.profil) } catch { texte = null }
        if (typeof texte === 'string') {
          for (const w of WORKERS) {
            if (w.genre === 'connexion' && etatProfil(texte, w).connexion && !seenDrivers.has(w.id) && !seenIds.has(w.id)) {
              const def = DRIVER_DEFAULTS[w.id] ?? {}
              effInstances.push({
                id: w.id,
                driverId: w.id,
                label: w.nom,
                binaryPath: def.binaryPath ?? w.binaire ?? '',
                shadowHomePath: '',
                enabled: true,
                active: true
              })
              seenIds.add(w.id)
              seenDrivers.add(w.id)
            }
          }
        }
      }
      if (typeof corps.workerId === 'string' && corps.workerId.trim() !== '' && !seenIds.has(corps.workerId) && !seenDrivers.has(corps.workerId)) {
        const wReq = trouverWorker(corps.workerId)
        if (wReq) {
          const def = DRIVER_DEFAULTS[wReq.id] ?? {}
          effInstances.push({
            id: wReq.id,
            driverId: wReq.id,
            label: wReq.nom,
            binaryPath: def.binaryPath ?? wReq.binaire ?? '',
            shadowHomePath: '',
            enabled: true,
            active: true
          })
        }
      }
      resOp = await collectAllQuotas({
        harness: { ...baseHarness, instances: effInstances },
        runtime: runtimeState,
        io: deps.io,
        workerId: corps.workerId ?? null,
        now
      })
    } else {
      return envoyer(res, 400, { ok: false, error: 'unknown-action' })
    }
    if (!resOp.ok) return envoyer(res, resOp.error === 'unknown-run' ? 404 : 400, resOp)
    const wRes = persisterRuntime(now)
    if (!wRes.ok) return envoyer(res, 500, wRes)
    return envoyer(res, 200, resOp)
  }

  let activeWorkerCache = typeof deps.lireActiveWorker === 'function' ? sanitizeActiveWorker(deps.lireActiveWorker()) : null

  const activeWorkerRoute = async (req, res) => {
    if (req.method === 'GET') {
      if (sameOriginLax(req) === false) return envoyer(res, 403, { ok: false, error: 'origin-refused' })
      const current = typeof deps.lireActiveWorker === 'function' ? sanitizeActiveWorker(deps.lireActiveWorker()) : activeWorkerCache
      activeWorkerCache = current
      return envoyer(res, 200, { ok: true, active: current })
    }
    const corps = await corpsJson(req, res)
    if (corps === undefined) return undefined
    const now = deps.maintenant()
    const next = corps.active === null || corps.active === undefined ? null : sanitizeActiveWorker(corps.active, now)
    if (corps.active !== null && corps.active !== undefined && next === null) {
      return envoyer(res, 400, { ok: false, error: 'invalid-active-worker' })
    }
    if (!('active' in corps)) return envoyer(res, 400, { ok: false, error: 'missing-active' })
    activeWorkerCache = next
    if (typeof deps.ecrireActiveWorker === 'function') {
      try { deps.ecrireActiveWorker(next) } catch (e) { return envoyer(res, 500, { ok: false, error: 'write-failed', detail: String(e?.message ?? e) }) }
    }
    return envoyer(res, 200, { ok: true, active: next })
  }

  const enregistrer = () => {
    webServer.register({ kind: 'exact', path: '/kybernos-workers/state', handler: etat })
    webServer.register({ kind: 'exact', path: '/kybernos-workers/check', handler: verifierRoute })
    webServer.register({ kind: 'exact', path: '/kybernos-workers/policy', handler: politique })
    webServer.register({ kind: 'exact', path: '/kybernos-workers/activate', handler: activer })
    webServer.register({ kind: 'exact', path: '/kybernos-workers/deactivate', handler: desactiver })
    webServer.register({ kind: 'exact', path: '/kybernos-workers/install', handler: installer })
    webServer.register({ kind: 'exact', path: '/kybernos-workers/harness', handler: harnessGet })
    webServer.register({ kind: 'exact', path: '/kybernos-workers/harness/instance', handler: harnessInstance })
    webServer.register({ kind: 'exact', path: '/kybernos-workers/harness/models', handler: harnessModels })
    webServer.register({ kind: 'exact', path: '/kybernos-workers/harness/policy', handler: harnessPolicy })
    webServer.register({ kind: 'exact', path: '/kybernos-workers/runtime', handler: runtimeGet })
    webServer.register({ kind: 'exact', path: '/kybernos-workers/runtime/route', handler: runtimeRoute })
    webServer.register({ kind: 'exact', path: '/kybernos-workers/active-worker', handler: activeWorkerRoute })
  }
  return typeof liens.effect === 'function' ? liens.effect(enregistrer, 'kybernos-workers: routes') : enregistrer()
}
