// The composer's model seat: Kybernos first, and an honest line when the account is missing.
//
// The native picker pins DeepSeek's groups first (`orderModelProviders` in
// @deepseek-ai/dsh-client-ui-model-selection: deepseek-account 0, deepseek-official 1, everyone else 2), so a
// deployment cannot reorder it — the seat has to be held. This test plays the seat's PURE rules exactly as
// they ship (the marked block of client.js is cut out and run on its own), then pins the wiring that cannot
// be simulated without a browser: the slot, the shadowing priority, and the aria contract two other plugins
// of this repo depend on (`button[aria-label^="Select model"]`).
//
//   node packages/kybernos-plugin/test-model-seat.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}
const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, 'client.js'), 'utf8')

const start = source.indexOf('// KB-MODELSEL-PURE-BEGIN')
const end = source.indexOf('// KB-MODELSEL-PURE-END')
assert.ok(start > 0 && end > start, 'the seat\'s pure block is marked in client.js')
const block = source.slice(start, end)
const rules = new Function(block + '\nreturn { kbSelSay, kbSelOrder, kbSelFilter, kbSelBand, kbSelEfforts, kbSelGroupName, KB_SEL_KYBERNOS }')()
const { kbSelOrder, kbSelFilter, kbSelBand, kbSelEfforts, kbSelGroupName } = rules

const group = (id, name, models) => ({ id, name, models })
const model = (id, name, extra) => Object.assign({ id, name }, extra || {})
const DEEPSEEK = group('deepseek-official', 'DeepSeek', [model('deepseek-v4.1-flash', 'DeepSeek-V4.1-Flash'), model('deepseek-v4-pro', 'DeepSeek-V4-Pro')])
const OPENCODE = group('opencode-go', 'opencode-go', [model('hy3', 'Hy3')])
const KYBERNOS = group('kybernos', 'Kybernos Cloud', [model('kybernos/orchestrator-expert', 'Kybernos Orchestrator Expert')])

console.log('the order: Kybernos first, the catalogue\'s order after it')
{
  const ordered = kbSelOrder([DEEPSEEK, OPENCODE, KYBERNOS])
  check('the Kybernos Cloud group comes first', ordered[0].id === 'kybernos', ordered.map((g) => g.id).join(','))
  check('the other groups keep the engine\'s order (we do not re-sort them)', ordered.slice(1).map((g) => g.id).join(',') === 'deepseek-official,opencode-go', ordered.map((g) => g.id).join(','))
  const without = kbSelOrder([DEEPSEEK, OPENCODE])
  check('no Kybernos group: the list is left exactly as it was', without.map((g) => g.id).join(',') === 'deepseek-official,opencode-go')
  check('malformed entries are dropped, never thrown on', kbSelOrder([null, 42, { id: 'x' }, DEEPSEEK]).map((g) => g.id).join(',') === 'deepseek-official')
  check('not an array → empty list', kbSelOrder(undefined).length === 0 && kbSelOrder('kybernos').length === 0)
  check('the group keeps its models (nothing is dropped)', kbSelOrder([KYBERNOS, DEEPSEEK])[1].models.length === 2)
}

console.log('the search')
{
  check('an empty query keeps everything', kbSelFilter([DEEPSEEK, OPENCODE, KYBERNOS], '   ').length === 3)
  const byName = kbSelFilter([DEEPSEEK, OPENCODE, KYBERNOS], 'haiku')
  check('a model name that matches nothing leaves nothing', byName.length === 0)
  const flash = kbSelFilter([DEEPSEEK, OPENCODE, KYBERNOS], 'flash')
  check('a model name narrows to its group and its model', flash.length === 1 && flash[0].id === 'deepseek-official' && flash[0].models.length === 1, JSON.stringify(flash.map((g) => g.id + ':' + g.models.length)))
  const byId = kbSelFilter([DEEPSEEK, OPENCODE, KYBERNOS], 'deepseek-v4-pro')
  check('a model id works too', byId.length === 1 && byId[0].models[0].id === 'deepseek-v4-pro')
  const byGroup = kbSelFilter([DEEPSEEK, OPENCODE, KYBERNOS], 'opencode')
  check('a group name keeps the whole group', byGroup.length === 1 && byGroup[0].id === 'opencode-go')
  const kb = kbSelFilter([DEEPSEEK, KYBERNOS], 'kybernos')
  check('searching Kybernos still puts its group first', kb.length >= 1 && kb[0].id === 'kybernos')
  check('the search case-folds', kbSelFilter([DEEPSEEK], 'DEEPSEEK-V4').length === 1)
  check('the filter never mutates the catalogue it is given', (() => {
    const list = [DEEPSEEK, KYBERNOS]
    const before = JSON.stringify(list)
    kbSelFilter(list, 'flash')
    return JSON.stringify(list) === before
  })())
}

console.log('the Kybernos line at the top')
{
  check('the group is there → no line, the group speaks for itself', kbSelBand([DEEPSEEK, KYBERNOS], null).kind === 'none')
  check('no account read yet → the sign-in line (never a guess)', kbSelBand([DEEPSEEK], null).kind === 'signin')
  check('not connected → sign-in', kbSelBand([DEEPSEEK], { connected: false, status: 'none' }).kind === 'signin')
  check('a revoked/ended connection → sign-in too', kbSelBand([DEEPSEEK], { connected: false, status: 'revoked' }).kind === 'signin')
  const planned = kbSelBand([DEEPSEEK], { connected: true, state: { user: { plan: 'solo-studio' } } })
  check('connected without any Kybernos model → the plan line, naming the plan', planned.kind === 'plan' && planned.plan === 'solo-studio', JSON.stringify(planned))
  const anon = kbSelBand([DEEPSEEK], { connected: true, state: { user: {} } })
  check('connected with no plan name → plan line, no invented plan', anon.kind === 'plan' && anon.plan === null)
  check('a malformed host answer never throws', kbSelBand([DEEPSEEK], { connected: true, state: 'nope' }).kind === 'plan')
}

console.log('reasoning levels')
{
  const withEfforts = model('reasoner', 'Reasoner', { reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'low' } })
  check('a model that takes levels exposes them in order', kbSelEfforts(withEfforts).map((e) => e.id).join(',') === 'low,high')
  check('a model without levels exposes none', kbSelEfforts(model('plain', 'Plain')).length === 0)
  check('a malformed reasoning field exposes none instead of throwing', kbSelEfforts({ id: 'x', reasoning: { efforts: [null, 3, { id: 'ok' }] } }).length === 1)
  check('no model → no levels', kbSelEfforts(null).length === 0 && kbSelEfforts(undefined).length === 0)
}

console.log('the names')
{
  check('the Kybernos route reads as its product name', kbSelGroupName({ id: 'kybernos', name: '' }, 'fr') === 'Kybernos Cloud' && kbSelGroupName({ id: 'kybernos', name: '' }, 'en') === 'Kybernos Cloud')
  check('any other group keeps the catalogue\'s name', kbSelGroupName({ id: 'opencode-go', name: 'OpenCode Go' }, 'fr') === 'OpenCode Go')
  check('a group with no name falls back to its id', kbSelGroupName({ id: 'kimi' }, 'en') === 'kimi')
}

console.log('the wiring (read from the shipped source)')
{
  const seat = source.slice(source.indexOf('const KbModelSeat = (props) => {'), source.indexOf("'kybers: styles of the model seat'"))
  check('the seat holds `conversation.input.model`', /slots\.inject\('conversation\.input\.model'/.test(seat))
  check('it shadows the shipped picker with the lowest priority (the documented mechanism)', /name: 'conversation\.input\.model', id: 'kybernos-model-seat', priority: -1/.test(seat))
  check('it never registers when the engine has no modelDirectories (the native picker then keeps its place)', /ctx\.inject\(\['slots', 'modelDirectories'(?:, 'remote\.session')?\]/.test(seat) && /typeof models\.directoryFor !== 'function'\) return/.test(seat))
  check('the session id comes from the slot\'s own inject hook, not from the owner props (measured)', /inject: \(sessionId\) =>/.test(seat) && /models\.directoryFor\(sessionId\)/.test(seat))
  check('the slot permission is declared (plugin.json)', readFileSync(join(here, 'plugin.json'), 'utf8').includes('"ui.slot:conversation.input.model"'))
  check('the engine plugin that provides modelDirectories is injected before this one', readFileSync(join(here, 'package.json'), 'utf8').includes('"@deepseek-ai/dsh-client-ui-model-selection"'))
  check('it selects through the engine\'s directory, never through a second read', /dir\.select\(/.test(seat) && /store\.subscribe\(/.test(seat))
  check('the aria starts with "Select model" and carries the current model (kybernos-auto and kybernos-sessions read it)', /'Select model, current ' \+ currentName/.test(seat) && /: 'Select model'/.test(seat))
  check('the Kybernos account state is read lazily, once, when the menu opens', /if \(open !== true \|\| cloud !== null\) return undefined/.test(seat) && /fetch\('\/kybernos-cloud\/status'/.test(seat))
  check('the sign-in button opens Settings ON the models page (the Kybernos Cloud card lives there)', /kbOpenSettingsPage\(\['kybernos-models', 'models'\]\)/.test(seat))
  check('the seat draws no model list of its own: no provider endpoint is called', /fetch\('\/kybernos-models/.test(seat) === false && /modelCatalog/.test(seat) === false)
  check('its styles are inserted under their own prefix', /\.kbmsl-trigger\{/.test(source) && /'kybers: styles of the model seat'/.test(source))
  check('every visible string has a French AND an English row', (() => {
    // A row is `say(['fr', 'en'])`: exactly one separator between two quoted texts (a comma INSIDE a
    // sentence, as in « Kybernos Cloud, avec ton abonnement », is not a separator).
    const rows = seat.match(/say\(\[[^\]]*\]\)/g) || []
    return rows.length >= 8 && rows.every((r) => r.split("', '").length === 2)
  })())
}

console.log(failed === 0 ? '\nOK' : `\n${failed} failure(s)`)
process.exit(failed === 0 ? 0 : 1)
