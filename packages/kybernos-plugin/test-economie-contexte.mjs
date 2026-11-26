// Compaction economy: earlier compaction in every preset, in memory, at boot.
//   node packages/kybernos-plugin/test-economie-contexte.mjs
import {
  BUDGET_PRUNEUR, ID_PRUNEUR, ID_RANGEE_COMPACTION, NOM_PRUNEUR, RATIO_ECONOMIE, appliquerRatio,
  poserEconomieContexte, poserPruneur, rangerCompaction, rangerGroupesCompaction,
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
  check('ratio is the economy default', row.config.thresholdRatio === RATIO_ECONOMIE && RATIO_ECONOMIE === 0.2)
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

console.log('the pruner is mounted where the preset lacks one')
{
  // `minimal` as the engine ships it: the group exists, the pruner does not, and the isolate list only names compaction.
  const minimal = () => ({
    id: 'minimal', name: 'Minimal', order: 1,
    plugins: [
      {
        id: 'compaction', name: 'cordis:group', group: true,
        isolate: { compaction: true },
        config: [
          { id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic' },
          { id: 'command-compact', name: '@deepseek-ai/dsh-command-compact' },
        ],
      },
      { id: 'delegation', name: 'cordis:group', group: true, config: [{ id: 'subagent' }] },
    ],
  })

  const groups = rangerGroupesCompaction(minimal())
  check('one group carries the compaction row', groups.length === 1 && groups[0].id === 'compaction')
  check('the delegation group is not mistaken for it', groups.every((g) => g.id !== 'delegation'))

  const def = minimal()
  const mounted = poserPruneur(def)
  const group = def.plugins[0]
  check('one row mounted', mounted === 1)
  check('inside the compaction group, next to compaction-basic',
    group.config.length === 3 && group.config[2].id === ID_PRUNEUR
    && group.config[0].id === 'compaction-basic')
  check('the row names the engine package', group.config[2].name === NOM_PRUNEUR)
  check('the budget is the measured one',
    group.config[2].config.thresholdChars === BUDGET_PRUNEUR.thresholdChars
    && group.config[2].config.thresholdChars === 2000
    && group.config[2].config.headChars + group.config[2].config.tailChars < 2000)
  check('the isolate list admits the pruner service', group.isolate.toolResultPruner === true)
  check('commander-compact is untouched', group.config[1].id === 'command-compact')

  check('mounting twice adds nothing', poserPruneur(def) === 0 && group.config.length === 3)
  check('a preset without any compaction is left alone', poserPruneur({ plugins: [{ id: 'tools' }] }) === 0)
  const bare = { plugins: [{ id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic' }] }
  check('a compaction row outside a group is skipped, not forced', poserPruneur(bare) === 0)
  check('a definition full of holes does not throw', poserPruneur({ plugins: [null, { config: [null, 3] }] }) === 0)
}

console.log('a preset that already trims keeps its own budget')
{
  const def = preset()
  const before = JSON.stringify(def)
  const mounted = poserPruneur(def)
  check('nothing mounted', mounted === 0)
  check('the preset is byte-identical', JSON.stringify(def) === before)
  check('the engine default survives', def.plugins[0].config[1].config.thresholdChars === 8192)
}

console.log('the boot tally reports both halves')
{
  const ctx = registry({ standard: preset(), minimal: { plugins: [
    { id: 'compaction', name: 'cordis:group', group: true, isolate: { compaction: true },
      config: [{ id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic' }] },
  ] } })
  const r = await poserEconomieContexte(ctx)
  check('both presets got the ratio', r.rows === 2 && r.presets.length === 2, JSON.stringify(r))
  check('only the bare preset got a pruner', r.pruneurs === 1 && r.presetsPruneur.length === 1
    && r.presetsPruneur[0] === 'minimal', JSON.stringify(r))
}

console.log(failed === 0 ? '\nall green' : '\n' + failed + ' red')
process.exit(failed === 0 ? 0 : 1)
