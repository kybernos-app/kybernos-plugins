// Compaction economy: earlier compaction in every preset, in memory, at boot.
//   node packages/kybernos-plugin/test-economie-contexte.mjs
import {
  ID_RANGEE_COMPACTION, RATIO_ECONOMIE, appliquerRatio, poserEconomieContexte, rangerCompaction,
} from './economie-contexte.mjs'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}

// A preset the way DSH mounts it: the compaction plugin sits inside a group whose children are in the LIST form of
// `config`, next to a second row that must keep its own settings.
const preset = () => ({
  id: 'standard', name: 'Standard', order: 0,
  plugins: [
    {
      id: 'compaction', name: 'cordis:group', group: true,
      isolate: { compaction: true, toolResultPruner: true },
      config: [
        { id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic', config: { headroomTokens: 65536, retainRatio: 0.16 } },
        { id: 'tool-result-pruner', name: '@deepseek-ai/dsh-compaction-tool-result-pruner', config: { thresholdChars: 8192 } },
      ],
    },
    { id: 'delegation', name: 'cordis:group', group: true, config: [{ id: 'subagent' }] },
  ],
})
const registry = (definitions) => ({
  agentPresets: {
    definitions: new Map(Object.entries(definitions).map(([id, config]) => [id, { config }])),
  },
})

console.log('the compaction row is found wherever the preset puts it')
{
  const found = rangerCompaction(preset())
  check('one row, at depth, under the group', found.length === 1 && found[0].id === ID_RANGEE_COMPACTION)
  check('a preset without compaction yields nothing', rangerCompaction({ plugins: [{ id: 'tools' }] }).length === 0)
  check('a definition full of holes does not throw', rangerCompaction({ plugins: [null, { config: [null, 3] }] }).length === 0)
}

console.log('the ratio is written, nothing else is touched')
{
  const def = preset()
  const changed = appliquerRatio(def)
  const row = rangerCompaction(def)[0]
  check('one row changed', changed === 1)
  check('ratio is the economy default', row.config.thresholdRatio === RATIO_ECONOMIE && RATIO_ECONOMIE === 0.5)
  check('the other settings of the row survive', row.config.headroomTokens === 65536 && row.config.retainRatio === 0.16)
  check('no summary model is pinned (that would cost the prefix cache)', !/summarizationProvider|summarizationModel/.test(JSON.stringify(row.config)))
  check('the neighbour row is untouched', def.plugins[0].config[1].config.thresholdChars === 8192)
  check('applying twice changes nothing more', appliquerRatio(def) === 0)
}

console.log('a custom ratio overrides the policy')
{
  const def = preset()
  appliquerRatio(def, 0.35)
  check('ratio 0.35 written', rangerCompaction(def)[0].config.thresholdRatio === 0.35)
}

console.log('every definition of the live registry is covered')
{
  const ctx = registry({ standard: preset(), minimal: { plugins: [{ id: 'tools' }] }, cordis: preset() })
  const r = await poserEconomieContexte(ctx)
  check('two presets touched, two rows', r.rows === 2 && r.presets.length === 2, JSON.stringify(r))
  check('the ratio came back in the tally', r.ratio === RATIO_ECONOMIE)
  check('the preset without compaction is left alone', !r.presets.includes('minimal'))
}

console.log('the seam never takes the boot down')
{
  const r = await poserEconomieContexte({})
  check('missing registry yields a reason, not a throw', r.rows === 0 && typeof r.raison === 'string')
  const broken = { agentPresets: { definitions: { keys() { throw new Error('nope') } } } }
  const r2 = await poserEconomieContexte(broken)
  check('an unreadable registry is survivable', r2.rows === 0 && r2.presets.length === 0, JSON.stringify(r2))
}

console.log(failed === 0 ? '\nall green' : '\n' + failed + ' red')
process.exit(failed === 0 ? 0 : 1)
