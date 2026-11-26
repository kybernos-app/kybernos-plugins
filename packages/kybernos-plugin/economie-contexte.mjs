// Compaction economy (2026-10-27): compact earlier in every preset, without touching the engine.
//
// Measured on this machine before writing this file (526 sessions, 7 days, request/header + assistant usage):
//   kimi/k3.1-pro                 550 requests, prompt 155 731 tokens/request, cache 93.2 %
//   opencode-go/deepseek-v4.1-flash 12 874 requests, prompt 227 678 tokens/request, cache 97.5 %
// The cache is used; what burns is the VOLUME. Native compaction triggers at
// `min(80 % of the window, window − output − 64K)`, so a 262K Kimi route lets a chat grow to ~188K before it is
// condensed. Lowering the threshold ratio to 0.5 caps that route at ~131K: 16M of the 86M prompt tokens of the sample
// sat above 131K, i.e. roughly 19 % of the volume — and every subscription metered in tokens pays the volume, not the
// cache discount.
//
// The same boot seam as `activerSubagentClaude`: at boot, in every definition of the LIVE registry, in memory. No file
// is written, so it survives a DSH upgrade, and the source definitions of the engine are never edited on disk.
//
// What this file deliberately does NOT do: pin `summarizationProvider`/`summarizationModel`. The retired
// `kybernos-compact` alias did, and it cost the provider's prefix cache and an extra key. Here the summary keeps the
// session's own routed model, so the warm prefix stays warm.
//
// The seams never throw: the boot does not depend on them.

/** Compaction row id, as the engine presets mount it. */
export const ID_RANGEE_COMPACTION = 'compaction-basic'

/** Engine default is 0.8; 0.5 is the economy policy measured above. One line to change the policy. */
export const RATIO_ECONOMIE = 0.5

/**
 * Every compaction row of a preset. `plugins` and the LIST form of `config` are walked (a `group: true` row carries its
 * children in `config`), with no assumption about depth.
 * @param {object} definition preset definition
 * @returns {object[]} the rows found (references, not copies)
 */
export function rangerCompaction(definition) {
  const rows = []
  const isCompaction = (row) => row.id === ID_RANGEE_COMPACTION || row.name === '@deepseek-ai/dsh-compaction-basic'
  const visit = (row) => {
    if (row === null || typeof row !== 'object') return
    if (Array.isArray(row)) {
      for (const child of row) visit(child)
      return
    }
    if (isCompaction(row) === true) rows.push(row)
    if (Array.isArray(row.config)) for (const child of row.config) visit(child)
    if (Array.isArray(row.plugins)) for (const child of row.plugins) visit(child)
  }
  visit(definition?.plugins)
  return rows
}

/**
 * Applies the economy threshold ratio to every compaction row of one definition, in place. A row that already carries
 * the ratio is left untouched, so calling this twice changes nothing.
 * @param {object} definition preset definition
 * @param {number} [ratio] threshold ratio to write
 * @returns {number} how many rows were changed
 */
export function appliquerRatio(definition, ratio = RATIO_ECONOMIE) {
  let changed = 0
  for (const row of rangerCompaction(definition)) {
    const config = row.config !== null && typeof row.config === 'object' && !Array.isArray(row.config) ? row.config : {}
    if (config.thresholdRatio === ratio) continue
    row.config = { ...config, thresholdRatio: ratio }
    changed += 1
  }
  return changed
}

/**
 * Applies the economy ratio to EVERY definition of the live registry. Never throws (the boot does not depend on it);
 * returns a tally for the log.
 * @param {{agentPresets?: object}} ctx the plugin's cordis context
 * @param {number} [ratio] threshold ratio to write
 */
export async function poserEconomieContexte(ctx, ratio = RATIO_ECONOMIE) {
  const definitions = ctx?.agentPresets?.definitions
  if (definitions === undefined || definitions === null || typeof definitions.keys !== 'function') {
    return { rows: 0, presets: [], raison: 'unreadable registry (definitions)' }
  }
  let ids = []
  try { ids = Array.from(definitions.keys()) } catch { ids = [] }
  let rows = 0
  const touched = []
  for (const id of ids) {
    let registration = null
    try { registration = definitions.get(id) } catch { continue }
    const changed = appliquerRatio(registration?.config, ratio)
    if (changed > 0) {
      rows += changed
      touched.push(id)
    }
  }
  return { rows, presets: touched, ratio }
}
