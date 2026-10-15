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
export const NOM_PRESET_LEGACY = 'Kybernos compact (legacy)'
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
 * Sets `disabled: false` on the Claude Code rows of EVERY definition of the live registry. Never throws (the boot does not
 * depend on it); returns a tally for the log.
 * @param {{agentPresets?: object}} ctx the plugin's cordis context
 */
export async function activerSubagentClaude(ctx) {
  const service = ctx?.agentPresets
  const definitions = service?.definitions
  if (definitions === undefined || definitions === null || typeof definitions.keys !== 'function') {
    return { bascules: 0, raison: 'unreadable registry (definitions)' }
  }
  let bascules = 0
  const touches = []
  let ids = []
  try { ids = Array.from(definitions.keys()) } catch { ids = [] }
  for (const id of ids) {
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
  return { bascules, presets: [...new Set(touches)] }
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
