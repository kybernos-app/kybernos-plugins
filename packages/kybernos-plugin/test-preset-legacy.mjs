// « Kybernos compact » (id kybernos-standard) is retired as a choice and kept as an id: stored sessions carry it and the
// registry rejects an id it does not know on reload. This pins what the boot does with it.
//   node packages/kybernos-plugin/test-preset-legacy.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DESCRIPTION_PRESET_LEGACY, ID_PRESET_KYBERNOS, ID_PRESET_STANDARD, NOM_PRESET_LEGACY, NS_REGLAGES_PRESET,
  activerSubagentClaude, clonerPresetLegacy, poserPresetLegacy, replierSurStandard,
} from './preset-legacy.mjs'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}

// A registry that holds a "standard" preset the way DSH does: compaction at the engine default, a disabled Claude Code row.
const standard = () => ({
  id: 'standard', name: 'Standard', order: 0,
  plugins: [
    { id: 'compaction', name: 'cordis:group', group: true, config: [{ id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic' }] },
    { id: 'tool-subagent-claude-code', disabled: true, config: {} },
  ],
})
const registry = (extra = []) => {
  const registered = []
  const definitions = new Map([['standard', { config: standard() }], ...extra])
  return { service: { definitions, register: async (d) => { registered.push(d); definitions.set(d.id, { config: d }) } }, registered }
}

console.log('the alias is a plain copy of Standard')
{
  const { service, registered } = registry()
  const r = await poserPresetLegacy({ agentPresets: service })
  check('it is registered under the id the stored sessions carry', r.pose === true && r.id === ID_PRESET_KYBERNOS && registered.length === 1 && registered[0].id === 'kybernos-standard')
  const compaction = JSON.stringify(registered[0].plugins[0])
  check('no summary model is pinned and no threshold is set (the native compaction applies)', !/summarizationProvider|summarizationModel|thresholdRatio/.test(compaction), compaction)
  check('its name and description say what it is', registered[0].name === NOM_PRESET_LEGACY && registered[0].description === DESCRIPTION_PRESET_LEGACY && /Standard mode/.test(NOM_PRESET_LEGACY) && /older chats/i.test(NOM_PRESET_LEGACY) && !/legacy|compact/i.test(NOM_PRESET_LEGACY))
  check('the source is untouched', JSON.stringify(service.definitions.get('standard').config) === JSON.stringify(standard()))
  const again = await poserPresetLegacy({ agentPresets: service })
  check('a second boot registers nothing more', again.pose === false && again.deja === true && registered.length === 1)
}
{
  check('no registry, no source preset, a refusing register: a reason, never a throw',
    (await poserPresetLegacy({})).pose === false &&
    (await poserPresetLegacy({ agentPresets: { definitions: new Map(), register: async () => {} } })).pose === false &&
    (await poserPresetLegacy({ agentPresets: { definitions: new Map([['standard', { config: standard() }]]), register: async () => { throw new Error('no') } } })).pose === false)
  check('an unreadable source is refused', clonerPresetLegacy(null).ok === false)
}

console.log('the default of new chats')
{
  const updates = []
  const settings = { update: async (ns, patch) => { updates.push([ns, patch]) } }
  const withDefault = (value) => {
    const { service } = registry([[ID_PRESET_KYBERNOS, { config: { id: ID_PRESET_KYBERNOS } }]])
    service.config = { selectedDefault: { get: () => value } }
    return service
  }
  const moved = await replierSurStandard({ agentPresets: withDefault(ID_PRESET_KYBERNOS), settings })
  check('a default still pointing at the old preset goes back to Standard, through the settings service', moved.ecrit === true && updates.length === 1 && updates[0][0] === NS_REGLAGES_PRESET && updates[0][1].selectedDefault === ID_PRESET_STANDARD, JSON.stringify(updates))
  updates.length = 0
  check('another explicit choice is never touched', (await replierSurStandard({ agentPresets: withDefault('ptc'), settings })).ecrit === false && updates.length === 0)
  check('no explicit choice: nothing is written', (await replierSurStandard({ agentPresets: withDefault(undefined), settings })).ecrit === false && updates.length === 0)
  const noStandard = { definitions: new Map(), config: { selectedDefault: { get: () => ID_PRESET_KYBERNOS } } }
  check('when Standard is not in the registry, the default is left alone rather than pointed at nothing', (await replierSurStandard({ agentPresets: noStandard, settings })).ecrit === false && updates.length === 0)
  check('a refusing settings service is a reason, not a throw', (await replierSurStandard({ agentPresets: withDefault(ID_PRESET_KYBERNOS), settings: { update: async () => { throw new Error('read-only') } } })).ecrit === false)
}

console.log('the Claude Code sub-agent is still turned on everywhere')
{
  const { service } = registry()
  const r = await activerSubagentClaude({ agentPresets: service })
  check('the disabled row of every definition is switched', r.bascules === 1 && service.definitions.get('standard').config.plugins[1].disabled === false, JSON.stringify(r))
}

console.log('the boot and the surface')
{
  const here = dirname(fileURLToPath(import.meta.url))
  const src = readFileSync(join(here, 'index.js'), 'utf8')
  check('index.js registers the alias and migrates the default, and nothing of the retired preset is left (pin, threshold, route)',
    /poserPresetLegacy\(\{ agentPresets: service \}\)/.test(src) && /replierSurStandard\(/.test(src) && !/SEUIL_COMPACTAGE|PROVIDER_FILET|MODELE_FILET|KB_FILET|KB_SEUIL_COMPACTAGE|\/kybernos\/compaction/.test(src))
  const mod = readFileSync(join(here, 'preset-legacy.mjs'), 'utf8')
  check('the module pins nothing: no summary provider, no model, no threshold in code', !/deepseek-official|deepseek-flash|summarizationProvider|thresholdRatio/.test(mod.replace(/\/\/.*$/gm, '')))
}

console.log(failed === 0 ? '\nOK' : `\n${failed} failure(s)`)
process.exit(failed === 0 ? 0 : 1)
