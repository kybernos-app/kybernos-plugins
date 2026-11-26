// Workers Metaharness — end-to-end HTTP + filesystem + discovery test suite.
// Spins up a real local HTTP server with `monterWorkers` + `workersDeps`, signed DSH cookies,
// atomic `harness.json` & `runs.json` on disk, and exercises every user workflow end-to-end.
//   node packages/kybernos-workers/test-e2e.mjs
import { createServer } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { monterWorkers, blocActivation, trouverWorker } from './workers-host.mjs'
import { workersDeps } from './index.js'
import { sessionSource } from './session-guard.mjs'
import { SESSION_SECRET, sessionCookie } from './lib-session-test.mjs'

sessionSource.secret = () => SESSION_SECRET

let total = 0
let failed = 0
const check = (name, cond, detail) => {
  total += 1
  if (cond) console.log('  ✓ ' + name)
  else { failed += 1; console.log('  ✗ ' + name + (detail !== undefined ? ' — ' + detail : '')) }
}

const root = mkdtempSync(join(tmpdir(), 'kb-workers-e2e-'))
const dshHome = join(root, 'dsh')
const userHome = join(root, 'home')
const profileDir = join(dshHome, 'profiles', 'web')
mkdirSync(profileDir, { recursive: true })
mkdirSync(join(userHome, '.claude', 'cache', 'model-catalog'), { recursive: true })
mkdirSync(join(userHome, '.codex'), { recursive: true })
mkdirSync(join(userHome, '.qwen'), { recursive: true })

// Seed realistic local CLI caches in isolated temp HOME
writeFileSync(join(userHome, '.claude', 'cache', 'model-catalog', 'acct-cc.json'), JSON.stringify({
  fetchedAt: Date.now(),
  catalog: {
    config: {
      models: [
        { id: 'claude-opus-5-5', name: 'Opus 5.5', runtime: { max_input_tokens: 1000000 } },
        { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5', runtime: { max_input_tokens: 1000000 } },
        { id: 'claude-haiku-5-5', name: 'Haiku 5.5', runtime: { max_input_tokens: 1000000 } }
      ]
    }
  }
}))
writeFileSync(join(userHome, '.codex', 'models_cache.json'), JSON.stringify({
  models: [
    { slug: 'gpt-internal-hide', display_name: 'Hidden', visibility: 'hide', context_window: 128000 },
    { slug: 'gpt-5.6-terra', display_name: 'GPT-5.6-Terra', visibility: 'list', context_window: 272000 },
    { slug: 'gpt-5.6-luna', display_name: 'GPT-5.6-Luna', visibility: 'list', context_window: 272000 }
  ]
}))
writeFileSync(join(userHome, '.qwen', 'model-registry.json'), JSON.stringify({
  models: {
    'qwen3-coder-plus': { context: 256000 },
    'qwen3-coder-480b-a35b': { context: 256000 },
    'qwen-max': { context: 128000 }
  }
}))

// Seed profile patch with Claude Code, Codex, Antigravity, Qwen mounted (ZCode unmounted)
const patchInitial = [
  '# Profile patch',
  '- insert:',
  '    - id: claude-code',
  "      name: '@deepseek-ai/dsh-subagent-claude-code'",
  '- insert:',
  '    - id: codex',
  "      name: '@deepseek-ai/dsh-subagent-codex'",
  blocActivation(trouverWorker('antigravity'), '20261125-220000'),
  blocActivation(trouverWorker('qwen'), '20261125-220000')
].join('\n')
writeFileSync(join(profileDir, 'package.json'), '{}')
writeFileSync(join(profileDir, 'cordis.patch.yml'), patchInitial)

const realDeps = workersDeps(dshHome, { PATH: process.env.PATH, HOME: userHome })
// Override only external process execution so test-e2e runs deterministically without calling live network/CLIs
realDeps.io.executer = async (bin, args) => {
  if (bin === 'agy' && args[0] === 'models') {
    return {
      code: 0,
      sortie: 'Fetching available models...\ngemini-4-neon-high\tGemini 4 Neon (High)\ngemini-4-carbon-high\tGemini 4 Carbon (High)\nclaude-opus-5-5-high\tClaude Opus 5.5 (High)\n'
    }
  }
  if (bin === 'codex' && args[0] === 'login') return { code: 0, sortie: 'Logged in using ChatGPT' }
  if (bin === 'claude' && args[0] === 'auth') return { code: 0, sortie: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }) }
  return { code: 1, sortie: '' }
}

const routes = new Map()
monterWorkers({ register: (r) => routes.set(r.path, r.handler) }, realDeps)

const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://127.0.0.1').pathname
  const handler = routes.get(path)
  if (!handler) { res.writeHead(404); res.end('Not found'); return }
  Promise.resolve(handler(req, res)).catch((e) => { res.writeHead(500); res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e) })) })
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const base = 'http://127.0.0.1:' + port
const authHeaders = { origin: base, cookie: sessionCookie('127.0.0.1:' + port), 'content-type': 'application/json' }

const getJson = async (path) => {
  const r = await fetch(base + path, { headers: { origin: base } })
  return { status: r.status, json: await r.json() }
}
const postJson = async (path, body) => {
  const r = await fetch(base + path, { method: 'POST', headers: authHeaders, body: JSON.stringify(body) })
  return { status: r.status, json: await r.json() }
}

try {
  console.log('── E2E 1: initial state & empty harness ──')
  const st0 = await getJson('/kybernos-workers/state?profile=web')
  check('state returns mounted profile workers + builtinWorker + empty harness', st0.status === 200 && st0.json.ok === true && st0.json.builtinWorker.id === 'kybernos' && st0.json.harness.instances.length === 0)

  console.log('── E2E 2: auto-sync profile workers into harness.json ──')
  const sClaude = await postJson('/kybernos-workers/harness/models', {
    action: 'sync', instanceId: 'claude-code', driverId: 'claude-code', label: 'Claude Code', autoCreate: true, expectedRevision: 0
  })
  check('sync claude-code discovers real 1M models from local catalog and writes harness.json', sClaude.status === 200 && sClaude.json.source === 'cli' && sClaude.json.instance.models.length === 3 && sClaude.json.instance.models[0].id === 'claude-opus-5-5' && sClaude.json.instance.models[0].label === 'Claude Opus 5.5' && sClaude.json.instance.models[0].ctx === '1000k', JSON.stringify(sClaude.json))

  const sCodex = await postJson('/kybernos-workers/harness/models', {
    action: 'sync', instanceId: 'codex', driverId: 'codex', label: 'Codex', autoCreate: true, expectedRevision: sClaude.json.harness.revision
  })
  check('sync codex discovers real listed models from models_cache.json', sCodex.status === 200 && sCodex.json.source === 'cli' && sCodex.json.instance.models.length === 2 && sCodex.json.instance.models[0].id === 'gpt-5.6-terra' && sCodex.json.instance.models[0].label === 'GPT-5.6-Terra', JSON.stringify(sCodex.json))

  const sAgy = await postJson('/kybernos-workers/harness/models', {
    action: 'sync', instanceId: 'antigravity', driverId: 'antigravity', label: 'Antigravity', autoCreate: true, expectedRevision: sCodex.json.harness.revision
  })
  check('sync antigravity groups effort variants into clean base models with efforts + effortMap', sAgy.status === 200 && sAgy.json.source === 'cli' && sAgy.json.instance.models.length === 3 && sAgy.json.instance.models[0].id === 'gemini-4-neon' && sAgy.json.instance.models[0].label === 'Gemini 4 Neon' && sAgy.json.instance.models[0].efforts.join(',') === 'high' && sAgy.json.instance.models[0].effortMap.high === 'gemini-4-neon-high', JSON.stringify(sAgy.json))

  const sQwen = await postJson('/kybernos-workers/harness/models', {
    action: 'sync', instanceId: 'qwen', driverId: 'qwen', label: 'Qwen Code', autoCreate: true, expectedRevision: sAgy.json.harness.revision
  })
  check('sync qwen discovers real models from model-registry.json', sQwen.status === 200 && sQwen.json.source === 'cli' && sQwen.json.instance.models.length === 3 && sQwen.json.instance.models[0].id === 'qwen3-coder-plus', JSON.stringify(sQwen.json))

  console.log('── E2E 3: model edits (Def, reorder, hide, manual, ★) survive re-sync ──')
  const updatedModels = [
    { ...sClaude.json.instance.models[1], isDefault: true, visible: true },
    { ...sClaude.json.instance.models[0], isDefault: false, visible: false },
    { ...sClaude.json.instance.models[2], isDefault: false, visible: true },
    { id: 'claude-custom-staging', label: 'Claude Custom Staging', source: 'manual', visible: true, isDefault: false, favorite: false }
  ]
  const uMod = await postJson('/kybernos-workers/harness/models', {
    action: 'update', instanceId: 'claude-code', models: updatedModels, expectedRevision: sQwen.json.harness.revision
  })
  check('update models persists new default, hidden flag, order, and manual entry', uMod.status === 200 && uMod.json.instance.models[0].id === 'claude-sonnet-5-5' && uMod.json.instance.models[0].isDefault === true && uMod.json.instance.models[1].visible === false && uMod.json.instance.models[3].source === 'manual')

  const fav = await postJson('/kybernos-workers/harness/policy', {
    kind: 'favorite', ownerId: 'claude-code', modelId: 'claude-sonnet-5-5', expectedRevision: uMod.json.harness.revision
  })
  check('toggleFavorite pins worker model', fav.status === 200 && fav.json.favorite === true)

  const reSync = await postJson('/kybernos-workers/harness/models', {
    action: 'sync', instanceId: 'claude-code', expectedRevision: fav.json.harness.revision
  })
  const rsMods = reSync.json.instance.models
  check('re-sync preserves user order, hidden flag, favorite, default, and manual model', reSync.status === 200 && rsMods[0].id === 'claude-sonnet-5-5' && rsMods[0].isDefault === true && rsMods[0].favorite === true && rsMods[1].visible === false && rsMods.some((m) => m.id === 'claude-custom-staging' && m.source === 'manual'), JSON.stringify(rsMods))

  console.log('── E2E 4: Codex shadowHomePath syncs safely into cordis.patch.yml & refuses secrets ──')
  const saveCodex = await postJson('/kybernos-workers/harness/instance', {
    driverId: 'codex', id: 'codex', label: 'Codex Pro', accent: '#3b82f6',
    shadowHomePath: join(userHome, 'codex-pro'), active: true, enabled: true, syncPatch: true, profile: 'web',
    expectedRevision: reSync.json.harness.revision
  })
  const patchAfter = readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')
  check('saveInstance writes non-secret CODEX_HOME to cordis.patch.yml', saveCodex.status === 200 && patchAfter.includes('CODEX_HOME'), JSON.stringify(saveCodex.json))

  const secretRefused = await postJson('/kybernos-workers/harness/instance', {
    driverId: 'codex', id: 'codex', label: 'Codex Bad',
    envVars: [{ key: 'OPENAI_API_KEY', val: 'sk-live-secret', secretRef: false }],
    expectedRevision: saveCodex.json.harness.revision
  })
  check('saveInstance refuses raw secret in harness.json', secretRefused.status === 400 && secretRefused.json.error === 'secret-in-harness-refused')

  console.log('── E2E 5: Team members roleEngines + runtime quota probe + file mode 0600 ──')
  const roleRes = await postJson('/kybernos-workers/harness/policy', {
    kind: 'role', roleId: 'codeur', workerId: 'kybernos', delegateWorkers: ['claude-code', 'codex'],
    expectedRevision: saveCodex.json.harness.revision
  })
  check('role policy persists Kybernos (Built-in) with external delegation chips', roleRes.status === 200 && roleRes.json.harness.roleEngines.codeur.workerId === 'kybernos' && roleRes.json.harness.roleEngines.codeur.delegateWorkers.join(',') === 'claude-code,codex')

  const probe = await postJson('/kybernos-workers/runtime/route', { action: 'probe', profile: 'web' })
  check('runtime probe succeeds across configured instances with zero paid calls', probe.status === 200 && probe.json.probed >= 2, JSON.stringify(probe.json))

  const rt = await getJson('/kybernos-workers/runtime')
  check('GET /kybernos-workers/runtime exposes probed codex & claude-code quotas', rt.status === 200 && rt.json.quotas.some((q) => q.workerId === 'codex' && q.billingMode === 'subscription') && rt.json.quotas.some((q) => q.workerId === 'claude-code' && q.billingMode === 'subscription'), JSON.stringify(rt.json.quotas))

  if (process.platform !== 'win32') {
    const hMode = statSync(join(dshHome, 'kybernos-workers', 'harness.json')).mode & 0o777
    const rMode = statSync(join(dshHome, 'kybernos-workers', 'runs.json')).mode & 0o777
    check('harness.json and runs.json are written with 0600 permissions', hMode === 0o600 && rMode === 0o600, `harness=${hMode.toString(8)} runs=${rMode.toString(8)}`)
  }

  console.log('── E2E 6: Active Composer worker binding & delegation prompt ──')
  const { formatActiveWorkerPrompt } = await import('./workers-host.mjs')
  const setActive = await postJson('/kybernos-workers/active-worker', {
    active: { workerId: 'codex', driverId: 'codex', workerLabel: 'Codex', modelId: 'gpt-5.6-terra', modelLabel: 'GPT-5.6-Terra', resolvedModelId: 'gpt-5.6-terra', effort: 'high' }
  })
  check('POST /kybernos-workers/active-worker stores Codex binding with safe derived toolName', setActive.status === 200 && setActive.json.active?.toolName === 'subagent_codex' && setActive.json.active?.effort === 'high', JSON.stringify(setActive.json))
  const getActive = await getJson('/kybernos-workers/active-worker')
  check('GET /kybernos-workers/active-worker reads back persisted binding', getActive.status === 200 && getActive.json.active?.workerId === 'codex' && getActive.json.active?.toolName === 'subagent_codex', JSON.stringify(getActive.json))
  const directive = formatActiveWorkerPrompt(getActive.json.active)
  check('formatActiveWorkerPrompt instructs host agent to delegate via subagent_codex', directive.includes('`subagent_codex`') && directive.includes('GPT-5.6-Terra') && directive.includes('reasoning effort "high"'), directive)
  const clearActive = await postJson('/kybernos-workers/active-worker', { active: null })
  check('clearing active worker resets binding to null (native Kybernos LLM)', clearActive.status === 200 && clearActive.json.active === null && formatActiveWorkerPrompt(null) === '')

  console.log('── E2E 7: Official install/doc/uninstall links, shadow-home Codex cache fallback & deactivate/activate round-trip ──')
  const st7 = await getJson('/kybernos-workers/state?profile=web')
  const installable7 = st7.json.workers.filter((w) => w.genre === 'connexion')
  check('all 7 connection workers expose official doc, install cmd, and uninstall cmd', installable7.length === 7 && installable7.every((w) => w.install && /^https:\/\//.test(w.install.doc) && typeof w.install.cmd === 'string' && typeof w.install.uninstall === 'string'))

  // Codex with an empty shadowHomePath still discovers models from ~/.codex/models_cache.json
  const codexShadowSync = await postJson('/kybernos-workers/harness/models', { action: 'sync', driverId: 'codex', instanceId: 'codex', profile: 'web', autoCreate: true })
  const codexMods = codexShadowSync.json.instance?.models ?? codexShadowSync.json.discovered ?? []
  check('Codex sync with empty shadowHomePath falls back to ~/.codex/models_cache.json', codexShadowSync.status === 200 && codexShadowSync.json.source === 'cli' && codexMods.some((m) => m.id === 'gpt-5.6-terra'), JSON.stringify(codexShadowSync.json))

  // Deactivate and re-activate a workers-managed connection (antigravity) cleanly with backup
  mkdirSync(join(dshHome, 'profiles', 'web', 'node_modules', '@deepseek-ai', 'dsh-subagent-acp'), { recursive: true })
  const deact = await postJson('/kybernos-workers/deactivate', { worker: 'antigravity', profile: 'web' })
  const stAfterDeact = await getJson('/kybernos-workers/state?profile=web')
  const agyAfterDeact = stAfterDeact.json.workers.find((w) => w.id === 'antigravity')
  check('POST /kybernos-workers/deactivate switches off antigravity cleanly with backup', deact.status === 200 && deact.json.ok === true && typeof deact.json.backup === 'string' && agyAfterDeact.connexion === false && agyAfterDeact.desactivee === true, JSON.stringify({ deact: deact.json, agyAfterDeact }))

  const react = await postJson('/kybernos-workers/activate', { worker: 'antigravity', profile: 'web' })
  const stAfterReact = await getJson('/kybernos-workers/state?profile=web')
  const agyAfterReact = stAfterReact.json.workers.find((w) => w.id === 'antigravity')
  check('POST /kybernos-workers/activate cleanly re-enables deactivated antigravity', react.status === 200 && react.json.ok === true && agyAfterReact.connexion === true && agyAfterReact.desactivee === false, JSON.stringify({ react: react.json, agyAfterReact }))

  // Install route validation: rejects already-installed or unknown command safely
  const badInstall = await postJson('/kybernos-workers/install', { worker: 'opencode', command: 'rm -rf /' })
  check('POST /kybernos-workers/install refuses non-whitelisted command (409 or 501)', badInstall.status === 409 || badInstall.status === 501, JSON.stringify(badInstall))

  console.log('── E2E 8: Persisted check status survives restart & Antigravity model visibility toggle ──')
  const chkCodex = await postJson('/kybernos-workers/check', { worker: 'codex', profile: 'web' })
  const checksFile = join(dshHome, 'kybernos-workers', 'checks.json')
  check('POST /kybernos-workers/check persists check result to checks.json', chkCodex.status === 200 && existsSync(checksFile), JSON.stringify(chkCodex.json))
  const reloadedRoutes = new Map()
  monterWorkers({ register: (r) => reloadedRoutes.set(r.path, r.handler) }, workersDeps(dshHome, { ...process.env, HOME: userHome }))
  const mockRes = { statut: 0, body: '', writeHead (s) { this.statut = s }, end (b) { this.body = b } }
  await reloadedRoutes.get('/kybernos-workers/state')({ method: 'GET', url: '/kybernos-workers/state?profile=web', headers: {} }, mockRes)
  const reloadedState = JSON.parse(mockRes.body)
  const reloadedCodex = reloadedState.workers.find((w) => w.id === 'codex')
  check('fresh server instance hydrates persisted check status from checks.json', reloadedCodex?.dernier?.statut === chkCodex.json.statut && Array.isArray(reloadedCodex?.dernier?.controles), JSON.stringify(reloadedCodex?.dernier))

  // Toggle Antigravity model visibility off & verify it persists
  const stAgy = await getJson('/kybernos-workers/harness')
  const agyInst = stAgy.json.harness.instances.find((i) => i.id === 'antigravity')
  const agyToggled = agyInst.models.map((m, idx) => idx === 0 ? { ...m, visible: false } : m)
  const agyUpd = await postJson('/kybernos-workers/harness/models', { action: 'update', instanceId: 'antigravity', models: agyToggled, expectedRevision: stAgy.json.harness.revision })
  check('Antigravity model visibility toggle persists in harness.json', agyUpd.status === 200 && agyUpd.json.harness.instances.find((i) => i.id === 'antigravity').models[0].visible === false, JSON.stringify(agyUpd.json))
} finally {
  server.close()
  rmSync(root, { recursive: true, force: true })
}

console.log(`\n${failed === 0 ? '✓' : '✗'} ${total - failed}/${total} E2E checks`)
process.exit(failed === 0 ? 0 : 1)
