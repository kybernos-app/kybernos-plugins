// ── kybernos-workers · harness store & automatic model discovery ─────────────
// Versioned, secret-free configuration store at `$DSH_HOME/kybernos-workers/harness.json`.
// Holds configured worker instances (multi-account where Phase 0 proved isolation),
// auto-discovered models (display order, visibility, independent default, favorites),
// Team members role execution settings (`llm` vs `worker`), and runtime worker policies.
//
// All I/O is injectable so test-harness-store.mjs runs cleanly without DSH or network.
// English only (enforced by scripts/test-no-french-literals.mjs).

import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const HARNESS_VERSION = 1

export const BUILTIN_WORKER = Object.freeze({
  id: 'kybernos',
  kind: 'internal',
  driverId: 'kybernos',
  label: 'Kybernos',
  badge: 'Built-in',
  accent: '#e67a2e',
  enabled: true
})

export const SECRET_KEY_RE = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|COOKIE|AUTH)/i
const INSTANCE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/
const ACCENT_RE = /^#[0-9a-fA-F]{6}$/
const MAX_INSTANCES = 48
const MAX_MODELS_PER_INSTANCE = 120
const MAX_ENV_VARS = 32
const MAX_FAVORITES = 64
const EFFORT_ORDER = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max', 'ultra'])
const EFFORT_SET = new Set(EFFORT_ORDER)
const EFFORT_SUFFIX_RE = /-(low|medium|high|xhigh|max|ultra)$/i

export const CURATED_MODELS = Object.freeze({
  codex: Object.freeze([
    Object.freeze({ id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex', ctx: '200k', source: 'catalog', efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'medium' }),
    Object.freeze({ id: 'gpt-5.2', label: 'GPT-5.2', ctx: '200k', source: 'catalog', efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'medium' }),
    Object.freeze({ id: 'gpt-5.1-codex-mini', label: 'GPT-5.1 Codex Mini', ctx: '200k', source: 'catalog', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' }),
    Object.freeze({ id: 'o3-pro', label: 'o3 Pro', ctx: '200k', source: 'catalog', efforts: ['medium', 'high'], defaultEffort: 'high' })
  ]),
  'claude-code': Object.freeze([
    Object.freeze({ id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', ctx: '200k', source: 'catalog', efforts: ['low', 'medium', 'high', 'max'], defaultEffort: 'medium' }),
    Object.freeze({ id: 'claude-opus-4-6', label: 'Claude Opus 4.6', ctx: '200k', source: 'catalog', efforts: ['low', 'medium', 'high', 'max'], defaultEffort: 'medium' }),
    Object.freeze({ id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', ctx: '200k', source: 'catalog' })
  ]),
  gemini: Object.freeze([
    Object.freeze({ id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', ctx: '1000k', source: 'catalog', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' }),
    Object.freeze({ id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', ctx: '1000k', source: 'catalog' }),
    Object.freeze({ id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', ctx: '1000k', source: 'catalog' })
  ]),
  qwen: Object.freeze([
    Object.freeze({ id: 'qwen3-coder-plus', label: 'Qwen3 Coder Plus', ctx: '256k', source: 'catalog' }),
    Object.freeze({ id: 'qwen3-coder-480b-a35b', label: 'Qwen3 Coder 480B', ctx: '256k', source: 'catalog' }),
    Object.freeze({ id: 'qwen-max-latest', label: 'Qwen Max Latest', ctx: '128k', source: 'catalog' })
  ]),
  hermes: Object.freeze([
    Object.freeze({ id: 'nous/hermes-4-405b', label: 'Hermes 4 405B', ctx: '128k', source: 'catalog' }),
    Object.freeze({ id: 'nous/hermes-4-70b', label: 'Hermes 4 70B', ctx: '128k', source: 'catalog' })
  ]),
  opencode: Object.freeze([
    Object.freeze({ id: 'anthropic/claude-sonnet-4-6', label: 'Claude Sonnet 4.6', ctx: '200k', source: 'catalog' }),
    Object.freeze({ id: 'openai/gpt-5.2-codex', label: 'GPT-5.2 Codex', ctx: '200k', source: 'catalog' })
  ]),
  antigravity: Object.freeze([]),
  zcode: Object.freeze([]),
  acp: Object.freeze([])
})

export const DRIVER_DEFAULTS = Object.freeze({
  codex: Object.freeze({ binaryPath: 'codex', homePath: '~/.codex', supportsShadow: true, accent: '#3b82f6', discoveryLabel: 'OpenAI / Codex catalog' }),
  'claude-code': Object.freeze({ binaryPath: 'claude', homePath: '~/.claude', supportsShadow: false, accent: '#e67a2e', discoveryLabel: 'Anthropic catalog' }),
  gemini: Object.freeze({ binaryPath: 'gemini', homePath: 'ctx.credentials', supportsShadow: false, accent: '#a78bfa', discoveryLabel: 'Google /v1beta/models' }),
  antigravity: Object.freeze({ binaryPath: 'agy', homePath: 'agy acp', supportsShadow: false, accent: '#38bdf8', discoveryLabel: 'agy models (read-only)' }),
  qwen: Object.freeze({ binaryPath: 'qwen', homePath: 'ctx.credentials', supportsShadow: false, accent: '#615ced', discoveryLabel: 'DashScope /v1/models' }),
  hermes: Object.freeze({ binaryPath: 'hermes', homePath: '~/.hermes', supportsShadow: false, accent: '#f59e0b', discoveryLabel: 'hermes model (live CLI)' }),
  opencode: Object.freeze({ binaryPath: 'opencode', homePath: '~/.config/opencode', supportsShadow: false, accent: '#14b8a6', discoveryLabel: 'opencode models (CLI)' }),
  zcode: Object.freeze({ binaryPath: 'zcode', homePath: 'mcp-client-zcode', supportsShadow: false, accent: '#0f766e', discoveryLabel: 'MCP native' }),
  acp: Object.freeze({ binaryPath: '', homePath: '', supportsShadow: false, accent: '#64748b', discoveryLabel: 'ACP native' })
})

export const emptyHarness = (now = new Date()) => ({
  version: HARNESS_VERSION,
  revision: 0,
  updatedAt: now.toISOString(),
  instances: [],
  roleEngines: {},
  policies: {},
  favorites: []
})

export function harnessPath (dshHome) {
  return join(dshHome, 'kybernos-workers', 'harness.json')
}

export function slugifyInstanceId (raw) {
  const s = String(raw ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  return s.slice(0, 64)
}

function safePathString (val) {
  if (val === null || val === undefined) return ''
  const s = String(val).trim()
  if (s.length > 320 || /[\0\r\n]/.test(s)) return null
  if (/(^|[\\/])\.\.([\\/]|$)/.test(s)) return null
  return s
}

export function sanitizeEnvVars (raw) {
  if (!Array.isArray(raw)) return { ok: true, value: [] }
  if (raw.length > MAX_ENV_VARS) return { ok: false, error: 'too-many-env-vars' }
  const out = []
  const seen = new Set()
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue
    const key = String(item.key ?? '').trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key)) return { ok: false, error: 'invalid-env-key', key }
    if (seen.has(key)) continue
    seen.add(key)
    const secretRef = item.secretRef === true
    if (SECRET_KEY_RE.test(key) && !secretRef) {
      return { ok: false, error: 'secret-in-harness-refused', key }
    }
    const val = String(item.val ?? '').trim()
    if (/[\0\r\n]/.test(val) || val.length > 512) return { ok: false, error: 'invalid-env-value', key }
    // Even with secretRef: true, val must be a credential reference name (never a raw API key with whitespace or > 80 chars).
    if (secretRef && !/^[A-Za-z0-9_.:-]{1,80}$/.test(val)) {
      return { ok: false, error: 'invalid-credential-ref', key }
    }
    out.push({ key, val, secretRef })
  }
  return { ok: true, value: out }
}

function sanitizeEfforts (raw) {
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  const out = []
  for (const x of raw) {
    const v = String(x ?? '').trim().toLowerCase()
    if (EFFORT_SET.has(v) && !seen.has(v)) { seen.add(v); out.push(v) }
  }
  out.sort((a, b) => EFFORT_ORDER.indexOf(a) - EFFORT_ORDER.indexOf(b))
  return out
}

function sanitizeEffortMap (raw, efforts) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || efforts.length === 0) return undefined
  const out = {}
  let count = 0
  for (const ef of efforts) {
    const v = String(raw[ef] ?? '').trim()
    if (v !== '' && v.length <= 160 && !/[\0\r\n]/.test(v)) { out[ef] = v; count += 1 }
  }
  return count > 0 ? out : undefined
}

export function sanitizeModels (raw, modelSelection = true) {
  if (!Array.isArray(raw)) return []
  const out = []
  const seen = new Set()
  let hasDefault = false
  for (const item of raw) {
    if (out.length >= MAX_MODELS_PER_INSTANCE) break
    if (item === null || typeof item !== 'object') continue
    const id = String(item.id ?? '').trim()
    if (id === '' || id.length > 160 || /[\0\r\n]/.test(id) || seen.has(id)) continue
    seen.add(id)
    const label = String(item.label ?? id).trim().slice(0, 120) || id
    const ctx = String(item.ctx ?? '').trim().slice(0, 24)
    const source = ['cli', 'api', 'catalog', 'manual'].includes(item.source) ? item.source : 'catalog'
    const visible = item.visible !== false
    const favorite = item.favorite === true
    const isDefault = modelSelection && visible && item.isDefault === true && !hasDefault
    if (isDefault) hasDefault = true
    const efforts = sanitizeEfforts(item.efforts)
    const rawDef = String(item.defaultEffort ?? '').trim().toLowerCase()
    const defaultEffort = efforts.length > 0 ? (efforts.includes(rawDef) ? rawDef : (efforts.includes('medium') ? 'medium' : (efforts.includes('high') ? 'high' : efforts[0]))) : ''
    const effortMap = sanitizeEffortMap(item.effortMap, efforts)
    const entry = { id, label, ctx, source, visible, isDefault, favorite }
    if (efforts.length > 0) {
      entry.efforts = efforts
      entry.defaultEffort = defaultEffort
      if (effortMap !== undefined) entry.effortMap = effortMap
    }
    out.push(entry)
  }
  if (modelSelection && !hasDefault) {
    const firstVisible = out.find((m) => m.visible)
    if (firstVisible) firstVisible.isDefault = true
  }
  return out
}

/**
 * Merges newly discovered models into an existing model list WITHOUT losing the user's
 * display order, visibility preferences, favorites, custom manual entries, or default choice.
 */
export function mergeDiscoveredModels (existing, discovered, modelSelection = true) {
  const prev = sanitizeModels(existing, modelSelection)
  const fresh = Array.isArray(discovered) ? discovered : []
  const freshById = new Map()
  for (const m of fresh) {
    const id = String(m?.id ?? '').trim()
    if (id !== '' && !freshById.has(id)) freshById.set(id, m)
  }
  const merged = []
  const seen = new Set()
  const hasLive = fresh.some((m) => m && (m.source === 'cli' || m.source === 'api'))
  const hasGroupedLive = fresh.some((m) => Array.isArray(m?.efforts) && m.efforts.length > 0 && m.effortMap)
  for (const m of prev) {
    // When fresh live models arrive from CLI/cache/API, drop stale catalog-only placeholders unless pinned as favorite.
    if (hasLive && m.source === 'catalog' && !freshById.has(m.id) && m.favorite !== true) continue
    // When fresh live models collapsed `-low/-medium/-high` variants into grouped base models, drop superseded unpinned raw variants.
    if (hasGroupedLive && m.source !== 'manual' && m.favorite !== true && !freshById.has(m.id) && EFFORT_SUFFIX_RE.test(m.id)) {
      const baseId = m.id.replace(EFFORT_SUFFIX_RE, '')
      if (freshById.has(baseId)) continue
    }
    seen.add(m.id)
    const hit = freshById.get(m.id)
    const entry = {
      id: m.id,
      label: hit && typeof hit.label === 'string' && hit.label.trim() !== '' ? hit.label.trim().slice(0, 120) : m.label,
      ctx: hit && typeof hit.ctx === 'string' && hit.ctx.trim() !== '' ? hit.ctx.trim().slice(0, 24) : m.ctx,
      source: m.source === 'manual' ? 'manual' : (hit?.source ?? m.source),
      visible: m.visible,
      isDefault: m.isDefault,
      favorite: m.favorite
    }
    const ef = Array.isArray(hit?.efforts) && hit.efforts.length > 0 ? hit.efforts : m.efforts
    if (Array.isArray(ef) && ef.length > 0) {
      entry.efforts = ef
      entry.defaultEffort = hit?.defaultEffort ?? m.defaultEffort
      if (hit?.effortMap || m.effortMap) entry.effortMap = hit?.effortMap ?? m.effortMap
    }
    merged.push(entry)
  }
  for (const m of fresh) {
    const id = String(m?.id ?? '').trim()
    if (id === '' || seen.has(id)) continue
    seen.add(id)
    const entry = {
      id,
      label: String(m.label ?? id).trim().slice(0, 120) || id,
      ctx: String(m.ctx ?? '').trim().slice(0, 24),
      source: ['cli', 'api', 'catalog', 'manual'].includes(m.source) ? m.source : 'catalog',
      visible: true,
      isDefault: false,
      favorite: false
    }
    if (Array.isArray(m.efforts) && m.efforts.length > 0) {
      entry.efforts = m.efforts
      entry.defaultEffort = m.defaultEffort
      if (m.effortMap) entry.effortMap = m.effortMap
    }
    merged.push(entry)
  }
  return sanitizeModels(merged, modelSelection)
}

export function normalizeHarness (raw, now = new Date()) {
  if (raw === null || raw === undefined || typeof raw !== 'object') return emptyHarness(now)
  const base = emptyHarness(now)
  base.revision = typeof raw.revision === 'number' && Number.isInteger(raw.revision) && raw.revision >= 0 ? raw.revision : 0
  base.updatedAt = typeof raw.updatedAt === 'string' && raw.updatedAt !== '' ? raw.updatedAt : base.updatedAt
  if (Array.isArray(raw.instances)) {
    const seen = new Set()
    for (const item of raw.instances) {
      if (base.instances.length >= MAX_INSTANCES) break
      if (item === null || typeof item !== 'object') continue
      const id = slugifyInstanceId(item.id)
      const driverId = String(item.driverId ?? '').trim()
      if (!INSTANCE_ID_RE.test(id) || seen.has(id) || !(driverId in DRIVER_DEFAULTS)) continue
      seen.add(id)
      const envCheck = sanitizeEnvVars(item.envVars)
      const binaryPath = safePathString(item.binaryPath) ?? DRIVER_DEFAULTS[driverId].binaryPath
      const homePath = safePathString(item.homePath) ?? DRIVER_DEFAULTS[driverId].homePath
      const shadowHomePath = safePathString(item.shadowHomePath) ?? ''
      const launchArgs = String(item.launchArgs ?? '').replace(/[\0\r\n]/g, '').trim().slice(0, 240)
      const accent = ACCENT_RE.test(String(item.accent ?? '')) ? String(item.accent) : DRIVER_DEFAULTS[driverId].accent
      const modelSel = driverId !== 'antigravity' && driverId !== 'zcode' && driverId !== 'acp'
      base.instances.push({
        id,
        driverId,
        label: String(item.label ?? id).trim().slice(0, 80) || id,
        accent,
        binaryPath,
        homePath,
        shadowHomePath,
        launchArgs,
        envVars: envCheck.ok ? envCheck.value : [],
        enabled: item.enabled !== false,
        active: item.active === true,
        lastSync: typeof item.lastSync === 'string' ? item.lastSync : null,
        models: sanitizeModels(item.models, modelSel)
      })
    }
  }
  if (raw.roleEngines !== null && typeof raw.roleEngines === 'object' && !Array.isArray(raw.roleEngines)) {
    for (const [roleId, cfg] of Object.entries(raw.roleEngines)) {
      if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(roleId) || cfg === null || typeof cfg !== 'object') continue
      const rawWorkerId = typeof cfg.workerId === 'string' && cfg.workerId.trim() !== ''
        ? slugifyInstanceId(cfg.workerId)
        : (cfg.engine === 'worker' && typeof cfg.workerInstanceId === 'string' && cfg.workerInstanceId.trim() !== '' ? slugifyInstanceId(cfg.workerInstanceId) : BUILTIN_WORKER.id)
      const isExternal = rawWorkerId !== BUILTIN_WORKER.id
      base.roleEngines[roleId] = {
        workerId: isExternal ? rawWorkerId : BUILTIN_WORKER.id,
        engine: isExternal ? 'worker' : 'llm',
        workerInstanceId: isExternal ? rawWorkerId : '',
        workerModelId: typeof cfg.workerModelId === 'string' ? cfg.workerModelId.trim().slice(0, 160) : '',
        fallback: typeof cfg.fallback === 'string' ? cfg.fallback.trim().slice(0, 160) : '',
        delegateWorkers: Array.isArray(cfg.delegateWorkers)
          ? [...new Set(cfg.delegateWorkers.map((x) => slugifyInstanceId(x)).filter((x) => INSTANCE_ID_RE.test(x) && x !== BUILTIN_WORKER.id))].slice(0, 32)
          : []
      }
    }
  }
  if (raw.policies !== null && typeof raw.policies === 'object' && !Array.isArray(raw.policies)) {
    for (const [scope, pol] of Object.entries(raw.policies)) {
      if (!/^(default|automation|preset:[A-Za-z0-9_.:-]{1,64})$/.test(scope)) continue
      if (pol === null || typeof pol !== 'object') continue
      const cleanList = (arr) => Array.isArray(arr)
        ? [...new Set(arr.map((x) => String(x ?? '').trim()).filter((x) => /^[a-z0-9_-]{1,64}$/.test(x)))].slice(0, 32)
        : []
      base.policies[scope] = { allow: cleanList(pol.allow), deny: cleanList(pol.deny) }
    }
  }
  if (Array.isArray(raw.favorites)) {
    const seen = new Set()
    for (const f of raw.favorites) {
      if (base.favorites.length >= MAX_FAVORITES) break
      if (f === null || typeof f !== 'object') continue
      const kind = f.kind === 'worker' ? 'worker' : 'llm'
      const ownerId = String(f.ownerId ?? '').trim().slice(0, 80)
      const modelId = String(f.modelId ?? '').trim().slice(0, 160)
      if (ownerId === '' || modelId === '') continue
      const k = `${kind}|${ownerId}|${modelId}`
      if (seen.has(k)) continue
      seen.add(k)
      base.favorites.push({ kind, ownerId, modelId })
    }
  }
  return base
}

/** Reads `$DSH_HOME/kybernos-workers/harness.json`. Never throws; returns emptyHarness on missing/corrupt file. */
export function readHarnessFile (filePath, now = () => new Date()) {
  try {
    if (!existsSync(filePath)) return { ok: true, harness: emptyHarness(now()), exists: false }
    const raw = readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'harness-corrupt', harness: emptyHarness(now()), exists: true }
    }
    return { ok: true, harness: normalizeHarness(parsed, now()), exists: true }
  } catch (e) {
    return { ok: false, error: 'harness-unreadable', detail: String(e?.message ?? e), harness: emptyHarness(now()), exists: existsSync(filePath) }
  }
}

/** Atomic 0600 write of harness.json with parent directory creation (0700). */
export function writeHarnessFile (filePath, harness) {
  const dir = dirname(filePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  const tmp = filePath + '.tmp-' + process.pid + '-' + Date.now()
  const payload = JSON.stringify(harness, null, 2) + '\n'
  writeFileSync(tmp, payload, { encoding: 'utf8', mode: 0o600 })
  try { chmodSync(tmp, 0o600) } catch { /* Windows */ }
  renameSync(tmp, filePath)
  try { chmodSync(filePath, 0o600) } catch { /* Windows */ }
}

/**
 * Pure state transition: upsert a worker instance with Phase 0 capability enforcement
 * and optimistic concurrency (`expectedRevision`).
 */
export function upsertInstance (harness, input, capabilities, now = new Date()) {
  if (typeof input?.expectedRevision === 'number' && input.expectedRevision !== harness.revision) {
    return { ok: false, error: 'revision-conflict', revision: harness.revision }
  }
  const driverId = String(input?.driverId ?? '').trim()
  if (!(driverId in DRIVER_DEFAULTS)) return { ok: false, error: 'unknown-driver' }
  const id = slugifyInstanceId(input?.id || input?.label || driverId)
  if (!INSTANCE_ID_RE.test(id)) return { ok: false, error: 'invalid-instance-id' }
  if (id === BUILTIN_WORKER.id) return { ok: false, error: 'reserved-instance-id' }

  const existingIdx = harness.instances.findIndex((i) => i.id === id)
  const cap = capabilities?.[driverId] ?? null
  if (existingIdx < 0) {
    if (harness.instances.length >= MAX_INSTANCES) return { ok: false, error: 'instance-limit-reached' }
    const sameDriver = harness.instances.filter((i) => i.driverId === driverId)
    if (sameDriver.length > 0 && driverId !== 'acp' && cap?.multiAccount !== 'proven') {
      return { ok: false, error: 'multi-account-unsupported', driverId }
    }
  }

  const binaryPath = safePathString(input?.binaryPath ?? (existingIdx >= 0 ? harness.instances[existingIdx].binaryPath : DRIVER_DEFAULTS[driverId].binaryPath))
  const homePath = safePathString(input?.homePath ?? (existingIdx >= 0 ? harness.instances[existingIdx].homePath : DRIVER_DEFAULTS[driverId].homePath))
  const shadowHomePath = safePathString(input?.shadowHomePath ?? (existingIdx >= 0 ? harness.instances[existingIdx].shadowHomePath : ''))
  if (binaryPath === null || homePath === null || shadowHomePath === null) {
    return { ok: false, error: 'invalid-path' }
  }
  const envCheck = sanitizeEnvVars(input?.envVars ?? (existingIdx >= 0 ? harness.instances[existingIdx].envVars : []))
  if (!envCheck.ok) return envCheck

  const modelSel = cap ? cap.modelSelection === true : (driverId !== 'antigravity' && driverId !== 'zcode' && driverId !== 'acp')
  const prev = existingIdx >= 0 ? harness.instances[existingIdx] : null
  const models = Array.isArray(input?.models)
    ? sanitizeModels(input.models, modelSel)
    : (prev ? prev.models : sanitizeModels(CURATED_MODELS[driverId] ?? [], modelSel))

  const accent = ACCENT_RE.test(String(input?.accent ?? '')) ? String(input.accent) : (prev?.accent ?? DRIVER_DEFAULTS[driverId].accent)
  const makeActive = input?.active === true || (prev ? prev.active : !harness.instances.some((i) => i.driverId === driverId && i.active))

  const nextInst = {
    id,
    driverId,
    label: String(input?.label ?? prev?.label ?? id).trim().slice(0, 80) || id,
    accent,
    binaryPath,
    homePath,
    shadowHomePath,
    launchArgs: String(input?.launchArgs ?? prev?.launchArgs ?? '').replace(/[\0\r\n]/g, '').trim().slice(0, 240),
    envVars: envCheck.value,
    enabled: input?.enabled !== undefined ? input.enabled === true : (prev ? prev.enabled : true),
    active: makeActive,
    lastSync: typeof input?.lastSync === 'string' ? input.lastSync : (prev?.lastSync ?? null),
    models
  }

  const nextInstances = harness.instances.map((inst) => (
    makeActive && inst.driverId === driverId && inst.id !== id ? { ...inst, active: false } : { ...inst }
  ))
  if (existingIdx >= 0) nextInstances[existingIdx] = nextInst
  else nextInstances.push(nextInst)

  const nextHarness = {
    ...harness,
    revision: harness.revision + 1,
    updatedAt: now.toISOString(),
    instances: nextInstances
  }
  return { ok: true, harness: nextHarness, instance: nextInst }
}

export function removeInstance (harness, instanceId, expectedRevision, now = new Date()) {
  if (typeof expectedRevision === 'number' && expectedRevision !== harness.revision) {
    return { ok: false, error: 'revision-conflict', revision: harness.revision }
  }
  const id = slugifyInstanceId(instanceId)
  if (id === BUILTIN_WORKER.id) return { ok: false, error: 'cannot-remove-builtin' }
  const target = harness.instances.find((i) => i.id === id)
  if (!target) return { ok: false, error: 'unknown-instance' }
  const remaining = harness.instances.filter((i) => i.id !== id).map((i) => ({ ...i }))
  if (target.active) {
    const replacement = remaining.find((i) => i.driverId === target.driverId)
    if (replacement) replacement.active = true
  }
  const nextRoleEngines = {}
  for (const [rk, rv] of Object.entries(harness.roleEngines)) {
    const resetToBuiltin = rv.workerId === id || rv.workerInstanceId === id
    nextRoleEngines[rk] = {
      ...rv,
      workerId: resetToBuiltin ? BUILTIN_WORKER.id : (rv.workerId || BUILTIN_WORKER.id),
      engine: resetToBuiltin ? 'llm' : rv.engine,
      workerInstanceId: resetToBuiltin ? '' : rv.workerInstanceId,
      delegateWorkers: (rv.delegateWorkers ?? []).filter((x) => x !== id)
    }
  }
  const nextFavorites = harness.favorites.filter((f) => !(f.kind === 'worker' && f.ownerId === id))
  return {
    ok: true,
    harness: {
      ...harness,
      revision: harness.revision + 1,
      updatedAt: now.toISOString(),
      instances: remaining,
      roleEngines: nextRoleEngines,
      favorites: nextFavorites
    }
  }
}

export function updateInstanceModels (harness, { instanceId, models, expectedRevision }, capabilities, now = new Date()) {
  if (typeof expectedRevision === 'number' && expectedRevision !== harness.revision) {
    return { ok: false, error: 'revision-conflict', revision: harness.revision }
  }
  const id = slugifyInstanceId(instanceId)
  const idx = harness.instances.findIndex((i) => i.id === id)
  if (idx < 0) return { ok: false, error: 'unknown-instance' }
  const inst = harness.instances[idx]
  const cap = capabilities?.[inst.driverId] ?? null
  const modelSel = !(cap && cap.modelSelection === false)
  if (!modelSel && Array.isArray(models) && models.some((m) => m && m.isDefault === true)) {
    return { ok: false, error: 'model-not-supported', driverId: inst.driverId }
  }
  const clean = sanitizeModels(models, modelSel)
  const nextInstances = harness.instances.map((x, i) => (i === idx ? { ...x, models: clean } : x))
  return {
    ok: true,
    harness: { ...harness, revision: harness.revision + 1, updatedAt: now.toISOString(), instances: nextInstances },
    instance: nextInstances[idx]
  }
}

export function updateRoleEngine (harness, { roleId, workerId, engine, workerInstanceId, workerModelId, fallback, delegateWorkers, expectedRevision }, now = new Date()) {
  if (typeof expectedRevision === 'number' && expectedRevision !== harness.revision) {
    return { ok: false, error: 'revision-conflict', revision: harness.revision }
  }
  const rid = String(roleId ?? '').trim()
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(rid)) return { ok: false, error: 'invalid-role-id' }
  const resolvedWorkerId = typeof workerId === 'string' && workerId.trim() !== ''
    ? slugifyInstanceId(workerId)
    : (engine === 'worker' && typeof workerInstanceId === 'string' && workerInstanceId.trim() !== '' ? slugifyInstanceId(workerInstanceId) : BUILTIN_WORKER.id)
  const isExternal = resolvedWorkerId !== BUILTIN_WORKER.id
  if (isExternal && !harness.instances.some((i) => i.id === resolvedWorkerId)) {
    return { ok: false, error: 'unknown-instance' }
  }
  const nextRoleEngines = {
    ...harness.roleEngines,
    [rid]: {
      workerId: isExternal ? resolvedWorkerId : BUILTIN_WORKER.id,
      engine: isExternal ? 'worker' : 'llm',
      workerInstanceId: isExternal ? resolvedWorkerId : '',
      workerModelId: typeof workerModelId === 'string' ? workerModelId.trim().slice(0, 160) : '',
      fallback: typeof fallback === 'string' ? fallback.trim().slice(0, 160) : '',
      delegateWorkers: Array.isArray(delegateWorkers)
        ? [...new Set(delegateWorkers.map((x) => slugifyInstanceId(x)).filter((x) => INSTANCE_ID_RE.test(x) && x !== BUILTIN_WORKER.id))].slice(0, 32)
        : []
    }
  }
  return {
    ok: true,
    harness: { ...harness, revision: harness.revision + 1, updatedAt: now.toISOString(), roleEngines: nextRoleEngines }
  }
}

export function updateScopePolicy (harness, { scope, allow, deny, expectedRevision }, now = new Date()) {
  if (typeof expectedRevision === 'number' && expectedRevision !== harness.revision) {
    return { ok: false, error: 'revision-conflict', revision: harness.revision }
  }
  const sc = String(scope ?? '').trim()
  if (!/^(default|automation|preset:[A-Za-z0-9_.:-]{1,64})$/.test(sc)) {
    return { ok: false, error: 'unsupported-scope' }
  }
  const clean = (arr) => Array.isArray(arr)
    ? [...new Set(arr.map((x) => String(x ?? '').trim()).filter((x) => /^[a-z0-9_-]{1,64}$/.test(x)))].slice(0, 32)
    : []
  const nextPolicies = { ...harness.policies, [sc]: { allow: clean(allow), deny: clean(deny) } }
  return {
    ok: true,
    harness: { ...harness, revision: harness.revision + 1, updatedAt: now.toISOString(), policies: nextPolicies }
  }
}

export function toggleFavorite (harness, { kind, ownerId, modelId, expectedRevision }, now = new Date()) {
  if (typeof expectedRevision === 'number' && expectedRevision !== harness.revision) {
    return { ok: false, error: 'revision-conflict', revision: harness.revision }
  }
  const k = kind === 'worker' ? 'worker' : 'llm'
  const o = String(ownerId ?? '').trim().slice(0, 80)
  const m = String(modelId ?? '').trim().slice(0, 160)
  if (o === '' || m === '') return { ok: false, error: 'invalid-favorite' }
  const exists = harness.favorites.some((f) => f.kind === k && f.ownerId === o && f.modelId === m)
  const nextFavorites = exists
    ? harness.favorites.filter((f) => !(f.kind === k && f.ownerId === o && f.modelId === m))
    : [...harness.favorites.slice(0, MAX_FAVORITES - 1), { kind: k, ownerId: o, modelId: m }]
  // Keep instance model favorite flag synchronized when kind === 'worker'.
  const nextInstances = harness.instances.map((inst) => {
    if (k !== 'worker' || inst.id !== o) return inst
    return { ...inst, models: inst.models.map((x) => (x.id === m ? { ...x, favorite: !exists } : x)) }
  })
  return {
    ok: true,
    favorite: !exists,
    harness: { ...harness, revision: harness.revision + 1, updatedAt: now.toISOString(), favorites: nextFavorites, instances: nextInstances }
  }
}

// ── Automatic model discovery (zero paid inference calls) ───────────────────

/** Collapses `-(low|medium|high|xhigh|max|ultra)` variant rows into clean base models with `efforts` + `effortMap`. */
export function groupEffortVariants (items) {
  if (!Array.isArray(items) || items.length === 0) return []
  const byBase = new Map()
  const order = []
  for (const item of items) {
    const id = String(item?.id ?? '').trim()
    if (id === '') continue
    const match = EFFORT_SUFFIX_RE.exec(id)
    if (!match) {
      if (!byBase.has(id)) {
        byBase.set(id, { ...item })
        order.push(id)
      }
      continue
    }
    const effort = match[1].toLowerCase()
    const baseId = id.slice(0, -match[0].length)
    const rawLabel = String(item.label ?? id).trim()
    const cleanLabel = rawLabel.replace(/\s*\((low|medium|high|xhigh|extra high|max|ultra)\)\s*$/i, '').replace(EFFORT_SUFFIX_RE, '').trim() || baseId
    let group = byBase.get(baseId)
    if (!group) {
      group = { ...item, id: baseId, label: cleanLabel, efforts: [], defaultEffort: '', effortMap: {} }
      byBase.set(baseId, group)
      order.push(baseId)
    }
    if (!group.efforts.includes(effort)) group.efforts.push(effort)
    group.effortMap[effort] = id
  }
  return order.map((k) => {
    const g = byBase.get(k)
    if (Array.isArray(g.efforts) && g.efforts.length > 0) {
      g.efforts.sort((a, b) => EFFORT_ORDER.indexOf(a) - EFFORT_ORDER.indexOf(b))
      g.defaultEffort = g.efforts.includes('medium') ? 'medium' : (g.efforts.includes('high') ? 'high' : g.efforts[0])
    }
    return g
  })
}

/** Parses lines from CLI model list commands (`hermes model`, `agy models`, `opencode models`). */
export function parseCliModelOutput (rawText, driverId) {
  const lines = String(rawText ?? '').split(/\r?\n/)
  const out = []
  const seen = new Set()
  for (const rawLine of lines) {
    const line = rawLine.replace(/\x1b\[[0-9;]*m/g, '').trim()
    if (line === '' || line.startsWith('#') || line.startsWith('---') || /^usage:/i.test(line)) continue
    // Tab-separated `id\tDisplay Name` (e.g. `agy models`)
    if (line.includes('\t')) {
      const cols = line.split(/\t+/).map((s) => s.trim()).filter(Boolean)
      const id = cols[0] ?? ''
      if (/^[a-zA-Z0-9][a-zA-Z0-9._/-]{2,80}$/.test(id) && (/[-/.]/.test(id) || /\d/.test(id)) && !seen.has(id)) {
        seen.add(id)
        const label = (cols[1] && cols[1].length <= 120) ? cols[1] : id
        out.push({ id, label, ctx: '', source: 'cli' })
        if (out.length >= 60) break
        continue
      }
    }
    // Match tokens that look like model identifiers (e.g. `nous/hermes-4-405b`, `gpt-5.2-codex`, `gemini-2.5-pro`).
    const m = line.match(/(?:^|[\s*•-])([a-zA-Z0-9][a-zA-Z0-9._/-]{2,80})(?:\s|$|\()/)
    if (!m) continue
    const id = m[1]
    if (/^(models?|available|current|default|provider|active|error|warning|http|https|usage|version|status|none)$/i.test(id)) continue
    if (!/[-/.]/.test(id) && !/\d/.test(id)) continue
    if (seen.has(id)) continue
    seen.add(id)
    out.push({ id, label: id, ctx: '', source: 'cli' })
    if (out.length >= 60) break
  }
  if (out.length === 0) return (CURATED_MODELS[driverId] ?? []).map((x) => ({ ...x }))
  return driverId === 'antigravity' ? groupEffortVariants(out) : out
}

function resolveUserPath (raw, homeDir) {
  if (typeof raw !== 'string' || raw.trim() === '') return null
  const s = raw.trim()
  if (/(^|[\\/])\.\.([\\/]|$)/.test(s) || /[\0\r\n]/.test(s)) return null
  if (s === '~') return homeDir
  if (s.startsWith('~/') || s.startsWith('~\\')) return join(homeDir, s.slice(2))
  if (s.startsWith('/')) return s
  return null
}

function fmtCtx (tokens) {
  if (typeof tokens !== 'number' || !Number.isFinite(tokens) || tokens <= 0) return ''
  return tokens >= 1000 ? Math.round(tokens / 1000) + 'k' : String(tokens)
}

/** Reads Claude Code's local model-catalog JSON cache (`~/.claude/cache/model-catalog/*-cc.json`). */
function readClaudeLocalCatalog (baseDir) {
  try {
    const dir = join(baseDir, 'cache', 'model-catalog')
    if (!existsSync(dir)) return []
    const files = readdirSync(dir).filter((f) => f.endsWith('.json') && !f.endsWith('.badges.json'))
    if (files.length === 0) return []
    // Prefer `*-cc.json` over `*-ccd.json`, then highest `fetchedAt`.
    const candidates = []
    for (const f of files) {
      try {
        const parsed = JSON.parse(readFileSync(join(dir, f), 'utf8'))
        const models = parsed?.catalog?.config?.models
        if (Array.isArray(models) && models.length > 0) {
          candidates.push({
            ccRank: f.endsWith('-cc.json') ? 2 : (f.endsWith('-ccd.json') ? 1 : 0),
            fetchedAt: typeof parsed.fetchedAt === 'number' ? parsed.fetchedAt : 0,
            models
          })
        }
      } catch { /* skip corrupt cache entry */ }
    }
    if (candidates.length === 0) return []
    candidates.sort((a, b) => (b.ccRank - a.ccRank) || (b.fetchedAt - a.fetchedAt))
    const out = []
    const seen = new Set()
    for (const m of candidates[0].models) {
      const id = String(m?.id ?? '').trim()
      if (id === '' || seen.has(id)) continue
      seen.add(id)
      const rawName = String(m?.name ?? id).trim()
      const label = /^claude\b/i.test(rawName) ? rawName : 'Claude ' + rawName
      const ctx = fmtCtx(m?.runtime?.max_input_tokens)
      const efforts = sanitizeEfforts(m?.runtime?.effort_levels ?? (Array.isArray(m?.thinking?.effort_options) ? m.thinking.effort_options.map((o) => o?.id) : []))
      const defEf = String(m?.runtime?.default_effort ?? '').trim().toLowerCase()
      const entry = { id, label, ctx, source: 'cli' }
      if (efforts.length > 0) {
        entry.efforts = efforts
        entry.defaultEffort = efforts.includes(defEf) ? defEf : (efforts.includes('medium') ? 'medium' : efforts[0])
      }
      out.push(entry)
      if (out.length >= 60) break
    }
    return out
  } catch { return [] }
}

/** Reads Codex CLI's local model cache (`~/.codex/models_cache.json` or `<shadowHomePath>/models_cache.json`). */
function readCodexLocalCache (baseDir) {
  try {
    const file = join(baseDir, 'models_cache.json')
    if (!existsSync(file)) return []
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    const raw = Array.isArray(parsed?.models) ? parsed.models : []
    if (raw.length === 0) return []
    const listed = raw.filter((m) => m && m.visibility !== 'hide')
    const pool = (listed.length > 0 ? listed : raw).slice().sort((a, b) => {
      const pa = typeof a?.priority === 'number' ? a.priority : 999
      const pb = typeof b?.priority === 'number' ? b.priority : 999
      return pa - pb
    })
    const out = []
    const seen = new Set()
    for (const m of pool) {
      const id = String(m?.slug ?? m?.id ?? '').trim()
      if (id === '' || seen.has(id)) continue
      seen.add(id)
      const label = String(m?.display_name ?? m?.name ?? id).trim() || id
      const ctx = fmtCtx(m?.context_window)
      const efforts = sanitizeEfforts(Array.isArray(m?.supported_reasoning_levels) ? m.supported_reasoning_levels.map((x) => x?.effort ?? x) : [])
      const defEf = String(m?.default_reasoning_level ?? '').trim().toLowerCase()
      const entry = { id, label, ctx, source: 'cli' }
      if (efforts.length > 0) {
        entry.efforts = efforts
        entry.defaultEffort = efforts.includes(defEf) ? defEf : (efforts.includes('medium') ? 'medium' : efforts[0])
      }
      out.push(entry)
      if (out.length >= 60) break
    }
    return out
  } catch { return [] }
}

/** Reads Qwen Code's local model registry (`~/.qwen/model-registry.json`). */
function readQwenLocalRegistry (baseDir) {
  try {
    const file = join(baseDir, 'model-registry.json')
    if (!existsSync(file)) return []
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    const map = parsed?.models
    if (map === null || typeof map !== 'object' || Array.isArray(map)) return []
    const entries = Object.entries(map)
      .filter(([k]) => /^qwen/i.test(k))
      .map(([k, v]) => {
        let rank = 0
        if (/^qwen3/i.test(k)) rank += 40
        if (/coder/i.test(k)) rank += 30
        if (/(max|plus)/i.test(k)) rank += 15
        if (/(turbo|flash|long)/i.test(k)) rank += 10
        return { id: k, ctx: fmtCtx(v?.context), rank }
      })
    entries.sort((a, b) => (b.rank - a.rank) || a.id.localeCompare(b.id))
    return entries.slice(0, 40).map((e) => ({ id: e.id, label: e.id, ctx: e.ctx, source: 'cli' }))
  } catch { return [] }
}

/**
 * Discovers available models for a driver without spending any inference tokens.
 * `io`: { executer?(bin, args, opts), fetchJson?(url, headers), lireCle?(name), homeDir?, homePath?, shadowHomePath? }
 */
export async function discoverModelsForDriver (driverId, io = {}) {
  const fallback = (CURATED_MODELS[driverId] ?? []).map((x) => ({ ...x }))
  const homeDir = typeof io.homeDir === 'string' && io.homeDir.trim() !== '' ? io.homeDir.trim() : null
  const customDir = homeDir
    ? (resolveUserPath(io.shadowHomePath, homeDir) || resolveUserPath(io.homePath, homeDir))
    : null
  try {
    if (driverId === 'claude-code') {
      if (homeDir !== null) {
        const defaultDir = join(homeDir, '.claude')
        const local = (customDir && customDir !== defaultDir ? readClaudeLocalCatalog(customDir) : [])
        const resolved = local.length > 0 ? local : readClaudeLocalCatalog(defaultDir)
        if (resolved.length > 0) return { ok: true, source: 'cli', models: resolved }
      }
      return { ok: true, source: 'catalog', models: fallback }
    }
    if (driverId === 'codex') {
      if (homeDir !== null) {
        const defaultDir = join(homeDir, '.codex')
        const local = (customDir && customDir !== defaultDir ? readCodexLocalCache(customDir) : [])
        const resolved = local.length > 0 ? local : readCodexLocalCache(defaultDir)
        if (resolved.length > 0) return { ok: true, source: 'cli', models: resolved }
      }
      return { ok: true, source: 'catalog', models: fallback }
    }
    if (driverId === 'hermes' && typeof io.executer === 'function') {
      const r = await io.executer('hermes', ['model', '--list'], { delaiMs: 12000 })
      if (r && r.code === 0 && typeof r.sortie === 'string' && r.sortie.trim() !== '') {
        const parsed = parseCliModelOutput(r.sortie, driverId)
        return { ok: true, source: parsed[0]?.source === 'cli' ? 'cli' : 'catalog', models: parsed }
      }
      const st = await io.executer('hermes', ['status'], { delaiMs: 12000 })
      if (st && st.code === 0 && typeof st.sortie === 'string') {
        const mm = st.sortie.match(/^\s*Model:\s*([^\s(][^\r\n]*)$/im)
        const id = mm ? mm[1].trim() : ''
        if (id !== '' && !/not set|none/i.test(id)) {
          const rest = fallback.filter((x) => x.id !== id)
          return { ok: true, source: 'cli', models: [{ id, label: id, ctx: '', source: 'cli' }, ...rest] }
        }
      }
      return { ok: true, source: 'catalog', models: fallback }
    }
    if (driverId === 'antigravity' && typeof io.executer === 'function') {
      const r = await io.executer('agy', ['models'], { delaiMs: 15000 })
      if (r && r.code === 0 && typeof r.sortie === 'string' && r.sortie.trim() !== '') {
        const parsed = parseCliModelOutput(r.sortie, driverId)
        return { ok: true, source: parsed[0]?.source === 'cli' ? 'cli' : 'catalog', models: parsed }
      }
      return { ok: true, source: 'catalog', models: fallback }
    }
    if (driverId === 'opencode' && typeof io.executer === 'function') {
      const r = await io.executer('opencode', ['models'], { delaiMs: 12000 })
      if (r && r.code === 0 && typeof r.sortie === 'string' && r.sortie.trim() !== '') {
        const parsed = parseCliModelOutput(r.sortie, driverId)
        return { ok: true, source: parsed[0]?.source === 'cli' ? 'cli' : 'catalog', models: parsed }
      }
      return { ok: true, source: 'catalog', models: fallback }
    }
    if (driverId === 'gemini' && typeof io.fetchJson === 'function' && typeof io.lireCle === 'function') {
      const key = (await io.lireCle('GEMINI_API_KEY')) || (await io.lireCle('GOOGLE_API_KEY'))
      if (typeof key === 'string' && key.trim() !== '') {
        const data = await io.fetchJson('https://generativelanguage.googleapis.com/v1beta/models', { 'x-goog-api-key': key.trim() })
        if (data && Array.isArray(data.models)) {
          const apiModels = data.models
            .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
            .map((m) => {
              const id = String(m.name ?? '').replace(/^models\//, '')
              return { id, label: String(m.displayName ?? id), ctx: typeof m.inputTokenLimit === 'number' ? Math.round(m.inputTokenLimit / 1000) + 'k' : '', source: 'api' }
            })
            .filter((m) => m.id !== '' && /gemini/i.test(m.id))
            .slice(0, 40)
          if (apiModels.length > 0) return { ok: true, source: 'api', models: apiModels }
        }
      }
      return { ok: true, source: 'catalog', models: fallback }
    }
    if (driverId === 'qwen') {
      if (typeof io.fetchJson === 'function' && typeof io.lireCle === 'function') {
        try {
          const key = (await io.lireCle('QWEN_TOKEN_PLAN_API_KEY')) || (await io.lireCle('DASHSCOPE_API_KEY'))
          if (typeof key === 'string' && key.trim() !== '') {
            const data = await io.fetchJson('https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models', { authorization: 'Bearer ' + key.trim() })
            if (data && Array.isArray(data.data)) {
              const apiModels = data.data
                .map((m) => ({ id: String(m.id ?? ''), label: String(m.id ?? ''), ctx: '', source: 'api' }))
                .filter((m) => m.id !== '' && /qwen/i.test(m.id))
                .slice(0, 40)
              if (apiModels.length > 0) return { ok: true, source: 'api', models: apiModels }
            }
          }
        } catch { /* fall through to local registry or catalog */ }
      }
      if (homeDir !== null) {
        const local = readQwenLocalRegistry(customDir || join(homeDir, '.qwen'))
        if (local.length > 0) return { ok: true, source: 'cli', models: local }
      }
      return { ok: true, source: 'catalog', models: fallback }
    }
    return { ok: true, source: 'catalog', models: fallback }
  } catch {
    return { ok: true, source: 'catalog', models: fallback }
  }
}
