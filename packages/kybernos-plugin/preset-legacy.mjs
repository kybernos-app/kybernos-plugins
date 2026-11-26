// « Kybernos compact » (id `kybernos-standard`) is retired as a CHOICE, not as an id.
//
// It was a clone of the Standard preset that pinned the summary model of the compaction to `deepseek-official/deepseek-flash`
// and lowered the threshold to 70 %. DSH now compacts natively in the Standard preset: the trigger is
// `min(80 % of the window, window − output − 64K)`, an overflow is recovered by condensing and retrying, `/compact` is
// there, and the summary reuses the warm prefix of the session's own model. The pin did the opposite of that: it sent the
// whole history to one provider whatever model the chat used, lost the provider's prefix cache, and needed that provider's
// key. So the default goes back to Standard.
//
// The id stays registered. A session keeps the id of the preset it started with, and on reload the registry REJECTS a
// definition it does not know: at the time of this change 1,239 of the 2,238 stored sessions on the author's machine carry
// `kybernos-standard`. It is registered as a plain copy of Standard (no pin, no threshold) under a name that says what it
// is, and nothing else points at it.
//
// Same contract as agents-proposition.mjs: a boot seam, in memory, never writes into the engine, never throws, and the
// boot does not depend on it.

export const ID_PRESET_KYBERNOS = 'kybernos-standard'
export const ID_PRESET_STANDARD = 'standard'
export const NOM_PRESET_LEGACY = 'Standard mode (older chats)'
export const DESCRIPTION_PRESET_LEGACY = 'Identical to Standard mode. Kept so the chats started with it keep opening; new chats use Standard mode.'
export const NS_REGLAGES_PRESET = 'agent-preset-registry'

const cloner = (valeur) =>
  typeof structuredClone === 'function' ? structuredClone(valeur) : JSON.parse(JSON.stringify(valeur))

// ── Claude Code sub-agent (migrated from an engine patch, 2026-10-04) ────────
// The old `patch-dsh-subagent-claude-code.mjs` edited `disabled: true → false` in the engine's `presets/*.patch.yml`: an
// engine upgrade erased it. The same switch now lives here, at boot, in every definition of the live registry
// (`activerSubagentClaude`): no file written, it survives DSH upgrades.
export const ID_RANGEE_SUBAGENT_CLAUDE = 'tool-subagent-claude-code'

/**
 * Every row of a preset that mounts the Claude Code sub-agent. `plugins` and the LIST form of `config` are walked (a
 * `group: true` row carries its children in `config`), with no assumption about depth.
 * @param {object} definition preset definition
 * @returns {object[]} the rows found (references, not copies)
 */
export function rangerSubagentClaude(definition) {
  const trouvees = []
  const estClaudeCode = (rang) =>
    rang.id === ID_RANGEE_SUBAGENT_CLAUDE ||
    rang.config?.provider === 'claude-code' ||
    rang.config?.toolName === 'subagent_claude_code'
  const visite = (rang) => {
    if (rang === null || typeof rang !== 'object') return
    if (Array.isArray(rang)) {
      for (const r of rang) visite(r)
      return
    }
    if (estClaudeCode(rang) === true) trouvees.push(rang)
    if (Array.isArray(rang.config)) for (const r of rang.config) visite(r)
    if (Array.isArray(rang.plugins)) for (const r of rang.plugins) visite(r)
  }
  visite(definition?.plugins)
  return trouvees
}

/**
 * Whether an explicit user policy already governs a worker (for instance Claude Code disabled in the profile patch or
 * declared in `harness.json`). When true, the legacy boot force-enable yields to the explicit user policy.
 * @param {string} workerId worker identifier (e.g. `'claude-code'`)
 * @param {{patchText?: string|null, harnessPolicy?: object|null, presetId?: string}} [sources]
 * @returns {boolean}
 */
export function hasExplicitWorkerPolicy(workerId, sources = {}) {
  if (typeof workerId !== 'string' || workerId === '') return false
  const harness = sources.harnessPolicy
  if (harness !== null && harness !== undefined && typeof harness === 'object') {
    const policies = harness.agentPolicies
    if (policies !== null && policies !== undefined && typeof policies === 'object') {
      const presetKey = typeof sources.presetId === 'string' && sources.presetId !== '' ? 'preset:' + sources.presetId : null
      for (const scopeKey of [presetKey, 'default']) {
        if (scopeKey === null) continue
        const scope = policies[scopeKey]
        if (scope !== null && scope !== undefined && typeof scope === 'object' && Object.prototype.hasOwnProperty.call(scope, workerId)) {
          const entry = scope[workerId]
          if (entry !== null && entry !== undefined && typeof entry === 'object' && typeof entry.enabled === 'boolean') return true
        }
      }
    }
  }
  const patchText = typeof sources.patchText === 'string' ? sources.patchText : ''
  if (patchText !== '') {
    // Check for an explicit `@deepseek-ai/dsh-tool-subagent` block targeting this provider (or a patch override on
    // `kybernos-workers-<workerId>` / `tool-subagent-<workerId>`) that sets `disabled: true`.
    const lines = patchText.split('\n')
    const blocks = []
    let cur = null
    let inConfig = false
    for (const raw of lines) {
      if (/^\s*#/.test(raw) || raw.trim() === '') continue
      const m = /^(\s*)-\s+id:\s*(.+)$/.exec(raw)
      if (m) {
        cur = { id: m[2].replace(/\s+#.*$/, '').trim().replace(/^['"]|['"]$/g, ''), indent: m[1].length, fields: {}, config: {} }
        blocks.push(cur)
        inConfig = false
        continue
      }
      if (/^\S/.test(raw)) { cur = null; inConfig = false; continue }
      if (cur === null) continue
      const ind = /^(\s*)/.exec(raw)[1].length
      if (ind <= cur.indent) { cur = null; inConfig = false; continue }
      const kv = /^\s*([A-Za-z_][\w-]*):\s*(.*)$/.exec(raw)
      if (kv === null) continue
      const val = kv[2].replace(/\s+#.*$/, '').trim().replace(/^['"]|['"]$/g, '')
      if (ind === cur.indent + 2) {
        inConfig = kv[1] === 'config'
        if (!inConfig) cur.fields[kv[1]] = val
      } else if (inConfig && ind === cur.indent + 4) {
        cur.config[kv[1]] = val
      }
    }
    const targetIds = new Set(['kybernos-workers-' + workerId, 'tool-subagent-' + workerId])
    let sawToolBlock = false
    let disabledState = null
    for (const b of blocks) {
      if (b.fields.name === '@deepseek-ai/dsh-tool-subagent' && b.config.provider === workerId) {
        sawToolBlock = true
        targetIds.add(b.id)
        disabledState = b.fields.disabled === 'true'
      } else if (targetIds.has(b.id) && b.fields.disabled !== undefined) {
        sawToolBlock = true
        disabledState = b.fields.disabled === 'true'
      }
    }
    if (sawToolBlock && disabledState === true) return true
  }
  return false
}

/**
 * Sets `disabled: false` on the Claude Code rows of EVERY definition of the live registry, unless an explicit user
 * policy governs Claude Code for that preset (or globally). Never throws (the boot does not depend on it); returns a
 * tally for the log.
 * @param {{agentPresets?: object}} ctx the plugin's cordis context
 * @param {{explicitPolicy?: boolean, hasExplicitPolicy?: (presetId: string) => boolean, patchText?: string|null, harnessPolicy?: object|null}} [options]
 */
export async function activerSubagentClaude(ctx, options = {}) {
  const service = ctx?.agentPresets
  const definitions = service?.definitions
  if (definitions === undefined || definitions === null || typeof definitions.keys !== 'function') {
    return { bascules: 0, skipped: [], raison: 'unreadable registry (definitions)' }
  }
  let bascules = 0
  const touches = []
  const skipped = []
  let ids = []
  try { ids = Array.from(definitions.keys()) } catch { ids = [] }
  const isGated = (presetId) => {
    if (options.explicitPolicy === true) return true
    if (typeof options.hasExplicitPolicy === 'function') {
      try { if (options.hasExplicitPolicy(presetId) === true) return true } catch { /* safe default */ }
    }
    if (options.patchText !== undefined || options.harnessPolicy !== undefined) {
      return hasExplicitWorkerPolicy('claude-code', {
        patchText: options.patchText,
        harnessPolicy: options.harnessPolicy,
        presetId,
      })
    }
    return false
  }
  for (const id of ids) {
    if (isGated(id) === true) {
      skipped.push(id)
      continue
    }
    let enregistrement = null
    try { enregistrement = definitions.get(id) } catch { continue }
    const rangées = rangerSubagentClaude(enregistrement?.config)
    for (const rangée of rangées) {
      if (rangée.disabled !== false) {
        rangée.disabled = false
        bascules += 1
        touches.push(id)
      }
    }
  }
  return { bascules, presets: [...new Set(touches)], skipped }
}

/**
 * The alias's definition: a copy of the source preset with no retouch, under the id and the name that say what it is. The
 * source is never modified.
 * @param {object} source definition of the source preset (as the registry holds it)
 * @param {{id?: string, nom?: string, description?: string}} [options]
 * @returns {{ok: true, definition: object} | {ok: false, raison: string}}
 */
export function clonerPresetLegacy(source, options = {}) {
  const { id = ID_PRESET_KYBERNOS, nom = NOM_PRESET_LEGACY, description = DESCRIPTION_PRESET_LEGACY } = options
  if (source === null || typeof source !== 'object') return { ok: false, raison: 'source definition missing' }
  const definition = cloner(source)
  definition.id = id
  definition.name = nom
  definition.description = description
  if (typeof definition.order !== 'number') definition.order = 0
  return { ok: true, definition }
}

/**
 * Registers the alias with the live registry (the sessions that still carry this id must be able to reopen). Never throws:
 * a convenience must not take the plugin's boot down.
 * @param {{agentPresets?: object}} ctx the plugin's cordis context
 * @param {{source?: string, id?: string, nom?: string, description?: string}} [options]
 */
export async function poserPresetLegacy(ctx, options = {}) {
  const { source = ID_PRESET_STANDARD, id = ID_PRESET_KYBERNOS, nom, description } = options
  const service = ctx?.agentPresets
  if (service === undefined || service === null) return { pose: false, raison: 'agentPresets service missing' }
  const definitions = service.definitions
  if (definitions === undefined || definitions === null || typeof definitions.get !== 'function') {
    return { pose: false, raison: 'unreadable registry (definitions.get)' }
  }
  if (typeof definitions.has === 'function' && definitions.has(id)) return { pose: false, deja: true, raison: 'preset "' + id + '" already registered' }
  const enregistrement = definitions.get(source)
  if (enregistrement === undefined) return { pose: false, raison: 'source preset "' + source + '" not found' }
  const clonage = clonerPresetLegacy(enregistrement.config, { id, nom, description })
  if (clonage.ok === false) return { pose: false, raison: clonage.raison }
  try {
    await service.register(clonage.definition)
  } catch (erreur) {
    return { pose: false, raison: 'agentPresets.register refused: ' + (erreur?.message ?? String(erreur)) }
  }
  return { pose: true, id }
}

/**
 * Puts the default of new chats back on Standard, ONLY when it still points at the old preset: any other explicit choice
 * is never touched. `selectedDefault` is the volatile field the GUI writes when a preset is picked; the same one is
 * written here, through the `settings` service.
 * @param {{agentPresets?: object, settings?: object}} ctx cordis context
 */
export async function replierSurStandard(ctx) {
  const service = ctx?.agentPresets
  const courant = (() => {
    try {
      const champ = service?.config?.selectedDefault
      return typeof champ?.get === 'function' ? champ.get() : champ
    } catch { return undefined }
  })()
  if (courant !== ID_PRESET_KYBERNOS) return { ecrit: false, raison: courant === undefined || courant === '' ? 'no explicit choice' : 'explicit choice kept ("' + String(courant) + '")' }
  const definitions = service?.definitions
  if (definitions === undefined || definitions === null || typeof definitions.has !== 'function' || definitions.has(ID_PRESET_STANDARD) !== true) {
    return { ecrit: false, raison: 'preset "' + ID_PRESET_STANDARD + '" is not in the registry' }
  }
  const settings = ctx?.settings
  if (settings === undefined || settings === null || typeof settings.update !== 'function') {
    return { ecrit: false, raison: 'settings service missing' }
  }
  try {
    await settings.update(NS_REGLAGES_PRESET, { selectedDefault: ID_PRESET_STANDARD })
  } catch (erreur) {
    return { ecrit: false, raison: 'settings.update refused: ' + (erreur?.message ?? String(erreur)) }
  }
  return { ecrit: true, id: ID_PRESET_STANDARD, ns: NS_REGLAGES_PRESET }
}
