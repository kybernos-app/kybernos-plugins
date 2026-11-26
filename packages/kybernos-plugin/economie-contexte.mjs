// Compaction economy (2026-10-27, extended 2026-11-25): compact earlier in every preset, without touching the engine.
//
// Measured on this machine before writing this file (526 sessions, 7 days, request/header + assistant usage):
//   kimi/k3.1-pro                    550 requests, prompt 155 731 tokens/request, cache 93.2 %
//   opencode-go/deepseek-v4.1-flash 12 874 requests, prompt 227 678 tokens/request, cache 97.5 %
// The cache is used; what burns is the VOLUME. Native compaction triggers at
// min(80 % of the window, window - output - 64K), so a 262K Kimi route lets a chat grow to ~188K before it is
// condensed. Lowering the threshold ratio to 0.5 caps that route at ~131K: 16M of the 86M prompt tokens of the sample
// sat above 131K, i.e. roughly 19 % of the volume - and every subscription metered in tokens pays the volume, not the
// cache discount.
//
// The same boot seam as activerSubagentClaude: at boot, in every definition of the LIVE registry, in memory. No file
// is written, so it survives a DSH upgrade, and the source definitions of the engine are never edited on disk.
//
// What this file deliberately does NOT do: pin summarizationProvider/summarizationModel. The retired
// kybernos-compact alias did, and it cost the provider's prefix cache and an extra key. Here the summary keeps the
// session's own routed model, so the warm prefix stays warm.
//
// 2026-11-25 - the tool-result pruner, everywhere.
//
// Why this is the reliable half of the compaction story, measured on session 46d551e6 (50 turns, 565 K tokens when a
// model switch needed a summary on an exhausted Kimi quota, so MODEL_SWITCH_COMPACTION_FAILED):
//   - 720 tool results held 1 937 582 chars, about 484 K tokens, i.e. 85 % of the surface;
//   - that session ran the `minimal` preset, whose compaction group mounts NO tool-result pruner, so the trigger went
//     straight to a full 565 K summarization call: the one call that must not fail, and the only one that could not
//     fall back;
//   - replaying the trimming policies on its real tool results:
//       defaults 8192/4096/1024 -> surface about 476 K (-89 K): below the 500 K threshold, no summary needed at all;
//       4096/2048/512          -> surface about 356 K (-209 K);
//       2048/1024/256          -> surface about 255 K (-310 K).
// Pruning makes NO model call: compactPressure lands it before choosing a summary range, then skips summarization
// outright when the remeasured surface fell below the threshold. It is the only path that compacts without depending
// on a model, a quota or a route - the exact failure class above.
//
// The budget below is deliberately tighter than the engine default (which only trims results above 8 K chars): it
// runs on a surface already twice the threshold, where old tool dumps are dead weight. One line to change it.
//
// The seams never throw: the boot does not depend on them.

/** Compaction row id, as the engine presets mount it. */
export const ID_RANGEE_COMPACTION = 'compaction-basic'

/** Engine default is 0.8; 0.2 is the economy policy measured above (2026-11-25: median Kimi prompt 502k at 0.5). */
export const RATIO_ECONOMIE = 0.2

/** Tool-result pruner row: a sibling of the compaction row, inside the same isolate group. */
export const ID_PRUNEUR = 'tool-result-pruner'
export const NOM_PRUNEUR = '@deepseek-ai/dsh-compaction-tool-result-pruner'

/**
 * Trimming budget written into a preset that has no pruner. thresholdChars is a code-point budget per tool result:
 * anything longer becomes head + marker + tail. Head + tail + marker must stay within the threshold (engine rule).
 */
export const BUDGET_PRUNEUR = { thresholdChars: 2000, headChars: 800, tailChars: 300 }

const NOM_COMPACTION = '@deepseek-ai/dsh-compaction-basic'
const estCompaction = (row) => row.id === ID_RANGEE_COMPACTION || row.name === NOM_COMPACTION
const estPruneur = (row) => row.id === ID_PRUNEUR || row.name === NOM_PRUNEUR

/**
 * Every compaction row of a preset. `plugins` and the LIST form of `config` are walked (a `group: true` row carries its
 * children in `config`), with no assumption about depth.
 * @param {object} definition preset definition
 * @returns {object[]} the rows found (references, not copies)
 */
export function rangerCompaction(definition) {
  const rows = []
  const visit = (row) => {
    if (row === null || typeof row !== 'object') return
    if (Array.isArray(row)) {
      for (const child of row) visit(child)
      return
    }
    if (estCompaction(row) === true) rows.push(row)
    if (Array.isArray(row.config)) for (const child of row.config) visit(child)
    if (Array.isArray(row.plugins)) for (const child of row.plugins) visit(child)
  }
  visit(definition?.plugins)
  return rows
}

/**
 * Every group carrying a compaction row among its LIST-form children. The pruner must be mounted INSIDE that group:
 * the group isolates compaction/toolResultPruner, and compaction-basic reaches the pruner through ctx.get(), which
 * cannot cross an isolate boundary.
 * @param {object} definition preset definition
 * @returns {object[]} the group rows, in walk order (references, not copies)
 */
export function rangerGroupesCompaction(definition) {
  const groups = []
  const visit = (row) => {
    if (row === null || typeof row !== 'object') return
    if (Array.isArray(row)) {
      for (const child of row) visit(child)
      return
    }
    if (Array.isArray(row.config)) {
      const carries = row.config.some((child) => child !== null && typeof child === 'object'
        && !Array.isArray(child) && estCompaction(child) === true)
      if (carries) groups.push(row)
      for (const child of row.config) visit(child)
    }
    if (Array.isArray(row.plugins)) for (const child of row.plugins) visit(child)
  }
  visit(definition?.plugins)
  return groups
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
 * Mounts the tool-result pruner in every compaction group that has none, keeping the group's isolate list coherent. A
 * preset that already carries a pruner keeps its own budget: the author's choice wins, we only fill the gap.
 * @param {object} definition preset definition
 * @param {{thresholdChars: number, headChars: number, tailChars: number}} [budget] budget for the rows we add
 * @returns {number} how many rows were mounted
 */
export function poserPruneur(definition, budget = BUDGET_PRUNEUR) {
  let mounted = 0
  for (const group of rangerGroupesCompaction(definition)) {
    const hasPruner = group.config.some((child) => child !== null && typeof child === 'object'
      && !Array.isArray(child) && estPruneur(child) === true)
    if (hasPruner) continue
    group.config.push({ id: ID_PRUNEUR, name: NOM_PRUNEUR, config: { ...budget } })
    if (group.isolate === null || typeof group.isolate !== 'object' || Array.isArray(group.isolate)) group.isolate = {}
    group.isolate.toolResultPruner = true
    mounted += 1
  }
  return mounted
}

/**
 * Applies the economy ratio and mounts the missing pruner in EVERY definition of the live registry. Never throws (the
 * boot does not depend on it); returns a tally for the log.
 * @param {{agentPresets?: object}} ctx the plugin's cordis context
 * @param {number} [ratio] threshold ratio to write
 * @param {{thresholdChars: number, headChars: number, tailChars: number}} [budget] budget for the rows we add
 */
export async function poserEconomieContexte(ctx, ratio = RATIO_ECONOMIE, budget = BUDGET_PRUNEUR) {
  const definitions = ctx?.agentPresets?.definitions
  if (definitions === undefined || definitions === null || typeof definitions.keys !== 'function') {
    return {
      rows: 0, presets: [], ratio, pruneurs: 0, presetsPruneur: [], raison: 'unreadable registry (definitions)',
    }
  }
  let ids = []
  try { ids = Array.from(definitions.keys()) } catch { ids = [] }
  let rows = 0
  let pruneurs = 0
  const touched = []
  const equipped = []
  for (const id of ids) {
    let registration = null
    try { registration = definitions.get(id) } catch { continue }
    try {
      const changed = appliquerRatio(registration?.config, ratio)
      if (changed > 0) {
        rows += changed
        touched.push(id)
      }
      const mounted = poserPruneur(registration?.config, budget)
      if (mounted > 0) {
        pruneurs += mounted
        equipped.push(id)
      }
    } catch { continue }
  }
  return { rows, presets: touched, ratio, pruneurs, presetsPruneur: equipped }
}
