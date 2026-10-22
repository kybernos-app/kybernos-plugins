#!/usr/bin/env node
// Model health, the publishing side: the verdict of the host's probe becomes a small view and a public bus
// (`window.__kybernosHealth` + a `kybernos-health` event) that the Models tab chip reads. No browser: the pure view
// is called as written, and the bus runs against a fake window, a fake fetch and a fake settings service.
//
//   node packages/kybernos-sessions/test-sante.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 200))) } }

const SOURCE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')
const React = { createElement: () => null, useState: (v) => [v, () => {}], useEffect: () => {}, useRef: () => ({ current: null }), useCallback: (f) => f, useMemo: (f) => f(), Fragment: 'fragment' }

// A fake window: an in-memory localStorage, and an event log.
const store = {}
const events = []
const win = {
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v) }, removeItem: (k) => { delete store[k] } },
  dispatchEvent: (e) => { events.push(e.type); return true },
  __ModuleLoader__: null
}
let definition = null
win.__ModuleLoader__ = { load: (def) => { definition = def } }
globalThis.window = win
globalThis.CustomEvent = class { constructor (type) { this.type = type } }
globalThis.document = { createElement: () => ({ style: {} }), head: { append() {} }, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} }
new Function('window', SOURCE)(win)
const mod = definition.factory((spec) => { if (spec === 'react') return React; throw new Error('unexpected require ' + spec) })
const { santeVue, santeCause, suivreSante, etudeVue, choixCorrespondants } = mod.__test

console.log('the view')
const verdict = (over) => ({ actif: true, total: 5, tousEnEchec: false, verifieA: '2026-10-05T09:00:00Z', alertes: [{ cle: 'groq/llama-3.1-8b', route: 'groq', modele: 'llama-3.1-8b', code: 'AUTH' }], ...over })
check('no verdict: nothing to say', santeVue(null, 0, 1) === null && santeVue(undefined, 0, 1) === null)
check('nobody is watching (no study model): nothing to say', santeVue(verdict({ actif: false }), 0, 1) === null)
check('no failing model: nothing to say', santeVue(verdict({ alertes: [] }), 0, 1) === null)
check('alertes that is not a list: nothing to say, never a throw', santeVue(verdict({ alertes: 'x' }), 0, 1) === null)
check('the hour of silence hides it', santeVue(verdict(), 2000, 1000) === null)
check('a silence that ended shows it again', santeVue(verdict(), 1000, 2000) !== null)
const v = santeVue(verdict(), 0, 1)
check('a failing model: key, provider, model id, code and cause id', v.alertes.length === 1 && v.alertes[0].cle === 'groq/llama-3.1-8b' && v.alertes[0].route === 'groq' && v.alertes[0].id === 'llama-3.1-8b' && v.alertes[0].code === 'AUTH' && v.alertes[0].cause === 'key', v)
check('the totals ride along', v.total === 5 && v.tousEnEchec === false && v.verifieA === '2026-10-05T09:00:00Z')
const nu = santeVue(verdict({ alertes: [{ cle: 'vercel-ai-gateway/typesafe-ai/jev', code: 'INVALID_REQUEST' }] }), 0, 1)
check('route and id come from the key when the host omits them (a model id may hold slashes)', nu.alertes[0].route === 'vercel-ai-gateway' && nu.alertes[0].id === 'typesafe-ai/jev', nu)
check('nothing answered at all is told as a general failure', santeVue(verdict({ tousEnEchec: true }), 0, 1).tousEnEchec === true)
// A2-22: the probe's own sentence (the host makes up two of them, « timeout » and « no answer ») never reaches the page: the view keeps the
// code and a cause id, and whoever draws it (the Models tab chip) words the cause itself, in the language of the page.
const sentence = santeVue(verdict({ alertes: [{ cle: 'a/b', code: 'TIMEOUT', message: 'aucune réponse dans le délai' }, { cle: 'a/c', code: 'SANS-REPONSE', message: 'le flux s’est terminé sans verdict' }, { cle: 'a/d', code: 'AUTH', message: 'invalid api key' }] }), 0, 1)
check('a probe sentence is never passed through: only the code and the cause id reach the view', sentence.alertes.length === 3 && sentence.alertes.every((a) => a.message === undefined) && !/aucune|flux|invalid api key/.test(JSON.stringify(sentence)) && sentence.alertes.map((a) => a.cause).join() === 'silent,silent,key', sentence)
check('a total below the failing count is repaired, never trusted', santeVue(verdict({ total: 0 }), 0, 1).total === 1)

console.log('the causes')
const causes = { UNKNOWN_MODEL: 'gone', INVALID_REQUEST: 'refused', PI_AI_ERROR: 'refused', AUTH: 'key', CONTEXT_WINDOW_EXCEEDED: 'text', TIMEOUT: 'silent', 'SANS-REPONSE': 'silent', ABORTED: 'silent' }
for (const k of Object.keys(causes)) check(k + ' → ' + causes[k], santeCause(k) === causes[k])
check('an unknown code is "other", never undefined', santeCause('WHATEVER') === 'other' && santeCause('') === 'other')
check('a prototype name is not a cause', santeCause('constructor') === 'other' && santeCause('__proto__') === 'other' && santeCause('toString') === 'other')

console.log('the bus')
const probe = { settings: 0, health: 0, body: null, answer: null, reglages: { reglages: { brain: 'groq/llama-3.1-8b' } } }
globalThis.fetch = async (url, opts) => {
  if (String(url) === '/kybernos-sessions/settings') { probe.settings += 1; return { ok: true, json: async () => probe.reglages } }
  if (String(url) === '/kybernos-sessions/brain/health') {
    probe.health += 1
    probe.body = JSON.parse(opts.body)
    if (probe.answer === null) return { ok: false, json: async () => ({}) }
    return { ok: true, json: async () => probe.answer }
  }
  throw new Error('unexpected fetch ' + url)
}
const fakeSettings = {
  describe: async () => ({ ok: true, value: { namespaces: [{ ns: 'llm-pi-ai', value: { providers: {
    groq: { models: [{ id: 'llama-3.1-8b', input: ['text'] }, { id: 'whisper', input: ['audio'] }, { id: 'undeclared', input: [] }] },
    zai: { modelOverrides: { 'glm-4': { input: ['text', 'image'] } } }
  } } }] } })
}
mod.apply({ effect: () => {}, slots: { inject: () => {}, register: () => {} }, get: (n) => (n === 'remote.settings' ? fakeSettings : null) })
const stop = suivreSante()
const bus = win.__kybernosHealth
check('the bus is published, versioned, with the three calls', bus !== undefined && bus.version === 1 && typeof bus.get === 'function' && typeof bus.recheck === 'function' && typeof bus.hide === 'function')
check('before any verdict there is nothing to show', bus.get() === null)

// a failed probe leaves the state alone
await bus.recheck()
check('a probe that says nothing (host down) changes no state', bus.get() === null && probe.health === 1)
check('the probe asks about models that can take TEXT (declared or undeclared), not the audio-only one', JSON.stringify(probe.body.models) === JSON.stringify(['groq/llama-3.1-8b', 'groq/undeclared', 'zai/glm-4']), probe.body)
check('a forced check says so', probe.body.force === true)

probe.answer = verdict({ total: 3, alertes: [{ cle: 'groq/undeclared', route: 'groq', modele: 'undeclared', code: 'AUTH' }, { cle: 'zai/glm-4', route: 'zai', modele: 'glm-4', code: 'TIMEOUT' }] })
events.length = 0
const asked = probe.health
const run = bus.recheck()
const again = bus.recheck()
check('while a check runs, asking twice starts one probe and announces it once', events.length === 1, events)
await run
await again
check('…and the host was asked once', probe.health === asked + 1, probe.health - asked)
const got = bus.get()
check('after the check the verdict is the view', got !== null && got.alertes.length === 2 && got.total === 3 && got.checking === false, got)
check('listeners were told when the check started and when it ended', events.length === 2 && events.every((t) => t === 'kybernos-health'), events)
const second = bus.recheck()
const during = bus.get()
check('a check running shows `checking` on a standing alert', during !== null && during.checking === true, during)
await second

console.log('who is watching: the Study model IN FORCE, not the raw setting')
{
  const demande = async (reglages) => { probe.reglages = reglages; probe.answer = verdict(); const avant = probe.health; await bus.recheck(); return probe.health - avant }
  check('Automatic with a model found (the setting is empty): the models are probed', await demande({ reglages: { brain: '' }, etude: { actif: true, cle: 'kybernos/auto', mode: 'auto' } }) === 1)
  check('Automatic with nothing connected: nobody watches, no probe', await demande({ reglages: { brain: '' }, etude: { actif: false, cle: '', mode: 'aucun' } }) === 0)
  check('None: no probe', await demande({ reglages: { brain: 'none' }, etude: { actif: false, cle: '', mode: 'none' } }) === 0)
  check('the person\'s own pick: probed', await demande({ reglages: { brain: 'groq/llama-3.1-8b' }, etude: { actif: true, cle: 'groq/llama-3.1-8b', mode: 'choisi' } }) === 1)
  check('an older host that says nothing of the Study model in force: the old rule (a pick is watching, empty is not)', await demande({ reglages: { brain: 'groq/llama-3.1-8b' } }) === 1 && await demande({ reglages: { brain: '' } }) === 0 && await demande({ reglages: { brain: 'none' } }) === 0)
  probe.reglages = { reglages: { brain: 'groq/llama-3.1-8b' } }
}

console.log('the Study model search')
{
  const items = [{ value: '', label: 'Automatic — kybernos/auto' }, { value: 'gmicloud/Kimi-K3', label: 'Kimi-K3', group: 'gmicloud' }, { value: 'nvidia/Kimi-K3', label: 'Kimi-K3', group: 'nvidia' }, { value: 'openai/gpt-5.5', label: 'gpt-5.5', group: 'openai' }, { value: 'none', label: 'None' }]
  const ids = (q) => choixCorrespondants(items, q).map((it) => it.value).join(' ')
  check('an empty search keeps every choice, in order', choixCorrespondants(items, '') === items && choixCorrespondants(items, '  ') === items)
  check('the search reads the name, the route and the value, in any case', ids('KIMI') === 'gmicloud/Kimi-K3 nvidia/Kimi-K3' && ids('nvidia') === 'nvidia/Kimi-K3' && ids('gpt') === 'openai/gpt-5.5')
  check('every word typed must match, in any order, and nothing matching shows nothing', ids('kimi gmicloud') === 'gmicloud/Kimi-K3' && ids('gmicloud kimi') === 'gmicloud/Kimi-K3' && ids('zzz') === '')
  check('Automatic and None are choices like the others (found by their words)', ids('automatic') === '' && ids('none') === 'none')
  const SRC = SOURCE
  check('the choice is a button that opens a searchable listbox, not a native select', /h\(ChoixRecherche, \{/.test(SRC) && /type: 'search', placeholder: props\.recherche/.test(SRC) && !/h\('select'/.test(SRC))
}

console.log('the Study model row')
{
  const MODELES = [{ cle: 'groq/llama-3.1-8b', route: 'groq', id: 'llama-3.1-8b' }]
  const auto = etudeVue({ brain: '' }, { mode: 'auto', cle: 'kybernos/auto', auto: 'kybernos/auto', raison: 'cloud' }, MODELES)
  check('Automatic: the select reads « Automatic — <model> » and stays on the empty value', auto.valeur === '' && auto.libelleAuto === 'Automatic — kybernos/auto' && auto.mode === 'auto', auto)
  check('...and the row says which model it uses', /kybernos\/auto/.test(auto.description), auto.description)
  const rien = etudeVue({ brain: '' }, { mode: 'aucun', cle: '', auto: '' }, MODELES)
  check('Automatic with nothing connected says so, and that nothing is watched', /no model is connected yet/.test(rien.libelleAuto) && /nothing is watched/i.test(rien.description) && rien.mode === 'auto', rien)
  const pas = etudeVue({ brain: 'none' }, { mode: 'none', cle: '', auto: 'kybernos/auto' }, MODELES)
  check('None: the value is « none », the label of Automatic still names what it would use, nothing is sent', pas.valeur === 'none' && pas.mode === 'none' && pas.libelleAuto === 'Automatic — kybernos/auto' && /nothing is sent/i.test(pas.description), pas)
  const pick = etudeVue({ brain: 'groq/llama-3.1-8b' }, { mode: 'choisi', cle: 'groq/llama-3.1-8b', auto: 'kybernos/auto' }, MODELES)
  check('a pick that is still configured: shown as it is', pick.valeur === 'groq/llama-3.1-8b' && pick.introuvable === false && pick.mode === 'choisi', pick)
  const parti = etudeVue({ brain: 'old/gone' }, { mode: 'choisi', cle: 'old/gone', auto: '' }, MODELES)
  check('a pick that is no longer configured stays visible, flagged (the screen must not lie about the file)', parti.introuvable === true && parti.valeur === 'old/gone', parti)
  check('...but an unreadable model list claims nothing', etudeVue({ brain: 'old/gone' }, { mode: 'choisi', cle: 'old/gone' }, null).introuvable === false && etudeVue({ brain: 'old/gone' }, { mode: 'choisi', cle: 'old/gone' }, undefined).introuvable === false)
  const vieux = etudeVue({ brain: '' }, undefined, MODELES)
  check('an older host that sends no Study model in force: the row still reads as Automatic, without inventing a model', vieux.mode === 'auto' && vieux.libelleAuto === 'Automatic' && vieux.valeur === '', vieux)
  const tous = [auto, rien, pas, pick, parti, vieux]
  check('no row mentions the retired « Decision Brain », the evaluation API or a probability', tous.every((v) => !/decision brain|evaluation|\/v1\/|probabilit/i.test(v.description + v.libelleAuto)), tous.map((v) => v.description))
  check('the row says what leaves the machine: a title only when the word rules cannot place it, and nothing for a local model', [auto, pick].every((v) => /word rules/i.test(v.description) && /local model/i.test(v.description)), [auto.description, pick.description])
  check('no jargon a person cannot act on: no « closed questions », « brain » or « evaluation »', tous.every((v) => !/closed question|brain|evaluation/i.test(v.description + v.libelleAuto)), tous.map((v) => v.description))
  check('plain English, no French word', tous.every((v) => !/\b(le|la|les|des|une?|pour|avec|aucun)\b|[éèêàùç]/i.test(v.description + v.libelleAuto)), tous.map((v) => v.description))
}

console.log('hide for one hour')
events.length = 0
bus.hide()
check('hide silences the view and tells the listeners', bus.get() === null && events.length === 1)
check('the silence is stored for about an hour, and survives a reload', Number(store['kb-sante-silence']) - Date.now() > 3500000 && Number(store['kb-sante-silence']) - Date.now() <= 3600000)
const before = probe.health
await bus.recheck()
check('asking for a check lifts the silence and shows the alert again', bus.get() !== null && store['kb-sante-silence'] === undefined && probe.health === before + 1)

console.log('the probe says all is well')
probe.answer = verdict({ alertes: [] })
await bus.recheck()
check('no failing model any more: the chip has nothing to show', bus.get() === null)

console.log('cleanup')
stop()
check('the bus is withdrawn when the plugin is disposed', win.__kybernosHealth === undefined)

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
