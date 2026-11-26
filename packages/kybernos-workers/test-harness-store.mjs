// Unit tests for harness-store.mjs (atomic 0600 store, revision conflict, secret guard, auto discovery).
//   node packages/kybernos-workers/test-harness-store.mjs
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DRIVER_CAPABILITIES } from './workers-host.mjs'
import {
  BUILTIN_WORKER,
  CURATED_MODELS,
  discoverModelsForDriver,
  emptyHarness,
  harnessPath,
  mergeDiscoveredModels,
  parseCliModelOutput,
  readHarnessFile,
  removeInstance,
  toggleFavorite,
  updateInstanceModels,
  updateRoleEngine,
  updateScopePolicy,
  upsertInstance,
  writeHarnessFile
} from './harness-store.mjs'

let passed = 0
let failed = 0
const check = (name, ok, detail) => {
  if (ok) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')) }
}

const now = () => new Date('2026-11-25T19:50:00Z')

console.log('── atomic 0600 file read/write ──')
{
  const dir = mkdtempSync(join(tmpdir(), 'kb-harness-test-'))
  try {
    const fp = harnessPath(dir)
    const empty = readHarnessFile(fp, now)
    check('missing file returns emptyHarness without throwing', empty.ok === true && empty.exists === false && empty.harness.revision === 0)

    const added = upsertInstance(empty.harness, { driverId: 'codex', id: 'codex-work', label: 'Codex Work', shadowHomePath: '~/.dsh/kybernos-workers/homes/codex/work' }, DRIVER_CAPABILITIES, now())
    check('upsertInstance creates Codex Work with curated models', added.ok === true && added.harness.revision === 1 && added.instance.models.length === CURATED_MODELS.codex.length)
    writeHarnessFile(fp, added.harness)
    const st = statSync(fp)
    check('harness.json is written with mode 0600', (st.mode & 0o777) === 0o600, (st.mode & 0o777).toString(8))
    const back = readHarnessFile(fp, now)
    check('readHarnessFile round-trips cleanly', back.ok === true && back.exists === true && back.harness.revision === 1 && back.harness.instances[0].id === 'codex-work')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

console.log('── Phase 0 capability & secret guards ──')
{
  let h = emptyHarness(now())
  const r1 = upsertInstance(h, { driverId: 'codex', id: 'codex-work', label: 'Codex Work' }, DRIVER_CAPABILITIES, now())
  h = r1.harness
  const r2 = upsertInstance(h, { driverId: 'codex', id: 'codex-personal', label: 'Codex Personal', active: true }, DRIVER_CAPABILITIES, now())
  check('proven multi-account driver (codex) allows second instance and switches active cleanly', r2.ok === true && r2.harness.instances.length === 2 && r2.harness.instances[0].active === false && r2.harness.instances[1].active === true)
  h = r2.harness

  const c1 = upsertInstance(h, { driverId: 'claude-code', id: 'claude-1', label: 'Claude Code' }, DRIVER_CAPABILITIES, now())
  h = c1.harness
  const c2 = upsertInstance(h, { driverId: 'claude-code', id: 'claude-2', label: 'Claude 2' }, DRIVER_CAPABILITIES, now())
  check('unproven multi-account driver (claude-code) refuses second instance', c2.ok === false && c2.error === 'multi-account-unsupported')

  const sec = upsertInstance(h, { driverId: 'codex', id: 'codex-work', envVars: [{ key: 'OPENAI_API_KEY', val: 'sk-live-secret', secretRef: false }] }, DRIVER_CAPABILITIES, now())
  check('raw secret-looking env var is refused', sec.ok === false && sec.error === 'secret-in-harness-refused')

  const secRef = upsertInstance(h, { driverId: 'gemini', id: 'gemini-prod', envVars: [{ key: 'GEMINI_API_KEY', val: 'GEMINI_API_KEY', secretRef: true }] }, DRIVER_CAPABILITIES, now())
  check('credential reference (secretRef: true) is accepted', secRef.ok === true)

  const trav = upsertInstance(h, { driverId: 'codex', id: 'codex-work', shadowHomePath: '../../../etc/passwd' }, DRIVER_CAPABILITIES, now())
  check('path traversal in shadowHomePath is refused', trav.ok === false && trav.error === 'invalid-path')

  const stale = upsertInstance(h, { driverId: 'codex', id: 'codex-work', expectedRevision: 0 }, DRIVER_CAPABILITIES, now())
  check('stale expectedRevision returns revision-conflict', stale.ok === false && stale.error === 'revision-conflict')

  const agy = upsertInstance(h, { driverId: 'antigravity', id: 'agy-1', label: 'Antigravity' }, DRIVER_CAPABILITIES, now())
  const agyDef = updateInstanceModels(agy.harness, { instanceId: 'agy-1', models: [{ id: 'x', label: 'X', isDefault: true }] }, DRIVER_CAPABILITIES, now())
  check('ACP driver (modelSelection: false) refuses default model override', agyDef.ok === false && agyDef.error === 'model-not-supported')
  const agyVis = updateInstanceModels(agy.harness, { instanceId: 'agy-1', models: [{ id: 'x', label: 'X', visible: false }] }, DRIVER_CAPABILITIES, now())
  check('ACP driver (modelSelection: false) allows UI visibility toggle without setting default', agyVis.ok === true && agyVis.instance.models[0].visible === false && agyVis.instance.models[0].isDefault === false)
}

console.log('── mergeDiscoveredModels preserves order, visibility, favorites & default ──')
{
  const existing = [
    { id: 'gpt-5.2', label: 'GPT-5.2', source: 'catalog', visible: true, isDefault: true, favorite: true },
    { id: 'gpt-5.1-codex-mini', label: 'Mini', source: 'catalog', visible: false, isDefault: false, favorite: false },
    { id: 'my-custom', label: 'Custom', source: 'manual', visible: true, isDefault: false, favorite: false }
  ]
  const discovered = [
    { id: 'gpt-5.1-codex-mini', label: 'GPT-5.1 Codex Mini', ctx: '200k', source: 'api' },
    { id: 'gpt-5.2', label: 'GPT-5.2', ctx: '200k', source: 'api' },
    { id: 'gpt-5.3-preview', label: 'GPT-5.3 Preview', ctx: '256k', source: 'api' }
  ]
  const merged = mergeDiscoveredModels(existing, discovered, true)
  check('keeps user order first and appends newly discovered model at end', merged.map((m) => m.id).join(',') === 'gpt-5.2,gpt-5.1-codex-mini,my-custom,gpt-5.3-preview', merged.map((m) => m.id).join(','))
  check('preserves hidden flag, favorite flag, manual source, and default', merged[0].isDefault === true && merged[0].favorite === true && merged[1].visible === false && merged[2].source === 'manual' && merged[3].visible === true)
}

console.log('── role engines, proven scopes, favorites & removal cleanup ──')
{
  let h = emptyHarness(now())
  check('BUILTIN_WORKER exposes Kybernos (Built-in) internal worker metadata', BUILTIN_WORKER.id === 'kybernos' && BUILTIN_WORKER.kind === 'internal' && BUILTIN_WORKER.badge === 'Built-in')
  const reserved = upsertInstance(h, { driverId: 'codex', id: 'kybernos', label: 'Kybernos' }, DRIVER_CAPABILITIES, now())
  check('cannot register an external instance with reserved id "kybernos"', reserved.ok === false && reserved.error === 'reserved-instance-id')
  const delBuiltin = removeInstance(h, 'kybernos', h.revision, now())
  check('cannot remove built-in Kybernos worker', delBuiltin.ok === false && delBuiltin.error === 'cannot-remove-builtin')

  h = upsertInstance(h, { driverId: 'codex', id: 'codex-work', label: 'Codex Work' }, DRIVER_CAPABILITIES, now()).harness
  const re = updateRoleEngine(h, { roleId: 'codeur', workerId: 'codex-work', workerModelId: 'gpt-5.2-codex', fallback: 'deepseek-v4.1-flash', delegateWorkers: ['codex-work'] }, now())
  check('updateRoleEngine persists unified external workerId cleanly', re.ok === true && re.harness.roleEngines.codeur.workerId === 'codex-work' && re.harness.roleEngines.codeur.engine === 'worker')
  h = re.harness
  const reBuiltin = updateRoleEngine(h, { roleId: 'cartographe', workerId: 'kybernos', delegateWorkers: ['codex-work'] }, now())
  check('updateRoleEngine supports Kybernos (Built-in) with external delegation chips', reBuiltin.ok === true && reBuiltin.harness.roleEngines.cartographe.workerId === 'kybernos' && reBuiltin.harness.roleEngines.cartographe.engine === 'llm' && reBuiltin.harness.roleEngines.cartographe.delegateWorkers[0] === 'codex-work')
  h = reBuiltin.harness

  const badScope = updateScopePolicy(h, { scope: 'role:codeur', allow: ['codex'] }, now())
  check('unproven runtime scope (role:*) is refused on policies', badScope.ok === false && badScope.error === 'unsupported-scope')
  const goodScope = updateScopePolicy(h, { scope: 'preset:standard', allow: ['codex'], deny: ['hermes'] }, now())
  check('proven scope (preset:standard) is accepted', goodScope.ok === true && goodScope.harness.policies['preset:standard'].deny[0] === 'hermes')
  h = goodScope.harness

  const favOn = toggleFavorite(h, { kind: 'worker', ownerId: 'codex-work', modelId: 'gpt-5.2-codex' }, now())
  check('toggleFavorite pins worker model and updates instance flag', favOn.ok === true && favOn.favorite === true && favOn.harness.instances[0].models[0].favorite === true)
  h = favOn.harness

  const rem = removeInstance(h, 'codex-work', h.revision, now())
  check('removeInstance cleans up roleEngines and favorites references', rem.ok === true && rem.harness.instances.length === 0 && rem.harness.roleEngines.codeur.workerInstanceId === '' && rem.harness.favorites.length === 0)
}

console.log('── automatic model discovery (CLI & provider API) ──')
{
  const parsed = parseCliModelOutput('Available models:\n  * nous/hermes-4-405b (active)\n  - nous/hermes-4-70b\n', 'hermes')
  check('parseCliModelOutput extracts CLI model IDs cleanly', parsed.length === 2 && parsed[0].id === 'nous/hermes-4-405b' && parsed[0].source === 'cli', JSON.stringify(parsed))

  const gem = await discoverModelsForDriver('gemini', {
    lireCle: async (n) => (n === 'GEMINI_API_KEY' ? 'AIza-test' : null),
    fetchJson: async (url, headers) => {
      assert.equal(headers['x-goog-api-key'], 'AIza-test')
      return { models: [{ name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', inputTokenLimit: 1000000, supportedGenerationMethods: ['generateContent'] }] }
    }
  })
  check('discoverModelsForDriver fetches Gemini /v1beta/models via API key without paid call', gem.ok === true && gem.source === 'api' && gem.models[0].id === 'gemini-2.5-pro' && gem.models[0].ctx === '1000k')

  const qwenOffline = await discoverModelsForDriver('qwen', {
    lireCle: async () => 'sk-test',
    fetchJson: async () => { throw new Error('offline') }
  })
  check('discoverModelsForDriver falls back cleanly to catalog when offline', qwenOffline.ok === true && qwenOffline.source === 'catalog' && qwenOffline.models.length > 0)

  // Tab-separated `agy models` groups -low/-medium/-high/-xhigh variants into clean base models with efforts + effortMap
  const agyParsed = parseCliModelOutput('Fetching available models...\ngemini-4-neon-high\tGemini 4 Neon (High)\ngemini-4-neon-medium\tGemini 4 Neon (Medium)\ngemini-4-neon-low\tGemini 4 Neon (Low)\nclaude-opus-5-5-high\tClaude Opus 5.5 (High)\nclaude-opus-5-5-low\tClaude Opus 5.5 (Low)\n', 'antigravity')
  check('parseCliModelOutput groups antigravity effort variants into clean base models with efforts + effortMap', agyParsed.length === 2 && agyParsed[0].id === 'gemini-4-neon' && agyParsed[0].label === 'Gemini 4 Neon' && agyParsed[0].efforts.join(',') === 'low,medium,high' && agyParsed[0].effortMap.high === 'gemini-4-neon-high' && agyParsed[1].id === 'claude-opus-5-5' && agyParsed[1].label === 'Claude Opus 5.5', JSON.stringify(agyParsed))

  // Local CLI cache discovery (Claude Code, Codex + shadow home, Qwen)
  const fakeHome = mkdtempSync(join(tmpdir(), 'kb-home-disc-'))
  try {
    mkdirSync(join(fakeHome, '.claude', 'cache', 'model-catalog'), { recursive: true })
    writeFileSync(join(fakeHome, '.claude', 'cache', 'model-catalog', 'org-cc.json'), JSON.stringify({
      fetchedAt: 2000,
      catalog: {
        config: {
          models: [
            { id: 'claude-opus-5-5', name: 'Opus 5.5', runtime: { max_input_tokens: 1000000 } },
            { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5', runtime: { max_input_tokens: 1000000 } }
          ]
        }
      }
    }))
    mkdirSync(join(fakeHome, '.codex'), { recursive: true })
    writeFileSync(join(fakeHome, '.codex', 'models_cache.json'), JSON.stringify({
      models: [
        { slug: 'gpt-hidden', display_name: 'Hidden', visibility: 'hide', context_window: 128000 },
        { slug: 'gpt-5.6-terra', display_name: 'GPT-5.6-Terra', visibility: 'list', context_window: 272000 },
        { slug: 'gpt-5.6-luna', display_name: 'GPT-5.6-Luna', visibility: 'list', context_window: 272000 }
      ]
    }))
    mkdirSync(join(fakeHome, 'shadow-codex'), { recursive: true })
    writeFileSync(join(fakeHome, 'shadow-codex', 'models_cache.json'), JSON.stringify({
      models: [{ slug: 'gpt-5.6-work', display_name: 'GPT-5.6-Work', visibility: 'list', context_window: 400000 }]
    }))
    mkdirSync(join(fakeHome, '.qwen'), { recursive: true })
    writeFileSync(join(fakeHome, '.qwen', 'model-registry.json'), JSON.stringify({
      models: {
        'claude-ignored': { context: 200000 },
        'qwen3-coder-plus': { context: 256000 },
        'qwen-max': { context: 128000 }
      }
    }))

    const cc = await discoverModelsForDriver('claude-code', { homeDir: fakeHome })
    check('claude-code discovers real models from ~/.claude/cache/model-catalog/*-cc.json', cc.ok === true && cc.source === 'cli' && cc.models.length === 2 && cc.models[0].id === 'claude-opus-5-5' && cc.models[0].label === 'Claude Opus 5.5' && cc.models[0].ctx === '1000k', JSON.stringify(cc))

    const cx = await discoverModelsForDriver('codex', { homeDir: fakeHome })
    check('codex discovers real listed models from ~/.codex/models_cache.json and skips hidden', cx.ok === true && cx.source === 'cli' && cx.models.length === 2 && cx.models[0].id === 'gpt-5.6-terra' && cx.models[0].ctx === '272k', JSON.stringify(cx))

    const cxShadow = await discoverModelsForDriver('codex', { homeDir: fakeHome, shadowHomePath: '~/shadow-codex' })
    check('codex shadowHomePath reads isolated models_cache.json', cxShadow.ok === true && cxShadow.source === 'cli' && cxShadow.models.length === 1 && cxShadow.models[0].id === 'gpt-5.6-work', JSON.stringify(cxShadow))

    const qw = await discoverModelsForDriver('qwen', { homeDir: fakeHome })
    check('qwen discovers real qwen models from ~/.qwen/model-registry.json when no API key', qw.ok === true && qw.source === 'cli' && qw.models.length === 2 && qw.models[0].id === 'qwen3-coder-plus' && qw.models[0].ctx === '256k', JSON.stringify(qw))

    // Upgrading from stale catalog placeholders to live CLI models replaces placeholders while keeping manual & favorite entries
    const upgraded = mergeDiscoveredModels([
      { id: 'old-placeholder', label: 'Old', source: 'catalog', visible: true, isDefault: true, favorite: false },
      { id: 'pinned-placeholder', label: 'Pinned', source: 'catalog', visible: true, isDefault: false, favorite: true },
      { id: 'my-manual-model', label: 'My Manual', source: 'manual', visible: true, isDefault: false, favorite: false }
    ], cx.models, true)
    check('mergeDiscoveredModels drops unpinned catalog placeholders when live CLI models arrive, keeps manual & pinned favorites', !upgraded.some((m) => m.id === 'old-placeholder') && upgraded.some((m) => m.id === 'pinned-placeholder') && upgraded.some((m) => m.id === 'my-manual-model') && upgraded.some((m) => m.id === 'gpt-5.6-terra'), JSON.stringify(upgraded))
  } finally {
    rmSync(fakeHome, { recursive: true, force: true })
  }
}

console.log(`\n${failed === 0 ? '✓' : '✗'} ${passed}/${passed + failed} checks`)
process.exit(failed === 0 ? 0 : 1)
