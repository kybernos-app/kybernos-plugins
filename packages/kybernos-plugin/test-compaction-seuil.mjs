// The auto-compaction threshold must reach the engine, and an empty retry cap must not zero every provider.
// Neither module had a test: the call in index.js passed `seuil` as part of the context instead of the options, so the
// engine kept its 80% while the chat gauge, the README and the boot log all said 70%.
//   node packages/kybernos-plugin/test-compaction-seuil.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { poserPresetKybernos, SEUIL_COMPACTAGE, PAQUET_COMPACTAGE, CHAMP_SEUIL } from './preset-compaction.mjs'
import { plafondDepuisEnv } from './retry-policy.mjs'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}

// A registry that holds a "standard" preset the way DSH does: a compaction row at the engine default (80%).
const registryWithStandard = () => {
  const registered = []
  const definitions = new Map([['standard', {
    config: {
      id: 'standard',
      plugins: [
        { name: PAQUET_COMPACTAGE, config: { [CHAMP_SEUIL]: 0.8, summarizationProvider: '', summarizationModel: '' } },
        { id: 'tool-subagent-claude-code', disabled: true, config: {} },
      ],
    },
  }]])
  return { service: { definitions, register: async (definition) => { registered.push(definition) } }, registered }
}
const thresholdOf = (definition) => definition.plugins.find((p) => p.name === PAQUET_COMPACTAGE).config[CHAMP_SEUIL]

console.log('the threshold reaches the cloned preset')
{
  check('default threshold is 70% (KB_SEUIL_COMPACTAGE unset)', process.env.KB_SEUIL_COMPACTAGE !== undefined || SEUIL_COMPACTAGE === 0.7, String(SEUIL_COMPACTAGE))
  const { service, registered } = registryWithStandard()
  const r = await poserPresetKybernos({ agentPresets: service }, { seuil: SEUIL_COMPACTAGE })
  check('preset registered', r.pose === true && registered.length === 1, JSON.stringify(r))
  check('thresholdRatio is the wanted one, not the engine 0.8', thresholdOf(registered[0]) === SEUIL_COMPACTAGE, String(thresholdOf(registered[0] ?? { plugins: [] })))
  check('the description says the same percentage', registered[0].description.includes(Math.round(SEUIL_COMPACTAGE * 100) + '%'), registered[0].description)
}
{
  // What index.js used to do: `seuil` inside the context object. It is not an option, so the engine default stays.
  const { service, registered } = registryWithStandard()
  await poserPresetKybernos({ agentPresets: service, seuil: 0.7 })
  check('the old call shape (seuil in the context) leaves 0.8: this is why the call site is pinned below', thresholdOf(registered[0]) === 0.8, String(thresholdOf(registered[0])))
}

console.log('the call site in index.js')
{
  const here = dirname(fileURLToPath(import.meta.url))
  const source = readFileSync(join(here, 'index.js'), 'utf8')
  const calls = source.match(/poserPresetKybernos\(([^;\n]*)\)/g) ?? []
  check('there is exactly one call', calls.length === 1, String(calls.length))
  check('it passes the threshold in the OPTIONS (2nd argument), not in the context',
    /poserPresetKybernos\(\s*\{[^{}]*\}\s*,\s*\{[^{}]*seuil\s*:\s*SEUIL_COMPACTAGE[^{}]*\}\s*\)/.test(calls[0] ?? '') &&
    /poserPresetKybernos\(\s*\{[^{}]*seuil[^{}]*\}\s*\)/.test(calls[0] ?? '') === false,
    calls[0])
}

console.log('KB_RETRY_PLAFOND')
{
  const cap = (value) => plafondDepuisEnv(value === undefined ? {} : { KB_RETRY_PLAFOND: value })
  check('unset → 10', cap(undefined) === 10)
  check('empty → 10 (it was 0: every provider cut to zero retries)', cap('') === 10, String(cap('')))
  check('blank → 10 (it was 0)', cap('   ') === 10, String(cap('   ')))
  check('"7" → 7', cap('7') === 7)
  check('" 7 " → 7', cap(' 7 ') === 7)
  check('"0" → 0 (an explicit zero is a choice)', cap('0') === 0)
  check('"abc" → 10', cap('abc') === 10)
  check('"-1" → 10', cap('-1') === 10)
  check('"1.5" → 10', cap('1.5') === 10)
  check('"0x10" → 10 (not read as 16)', cap('0x10') === 10, String(cap('0x10')))
  check('"1e1" → 10', cap('1e1') === 10)
  check('a number too large to be a safe integer → 10', cap('9'.repeat(30)) === 10)
  check('no env object at all → 10', plafondDepuisEnv(undefined) === 10 || process.env.KB_RETRY_PLAFOND !== undefined)
}

console.log(failed === 0 ? '\nOK' : `\n${failed} failure(s)`)
process.exit(failed === 0 ? 0 : 1)
