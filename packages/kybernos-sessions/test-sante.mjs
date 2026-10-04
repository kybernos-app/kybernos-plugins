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
const { santeVue, santeCause, suivreSante } = mod.__test

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
check('a total below the failing count is repaired, never trusted', santeVue(verdict({ total: 0 }), 0, 1).total === 1)

console.log('the causes')
const causes = { UNKNOWN_MODEL: 'gone', INVALID_REQUEST: 'refused', PI_AI_ERROR: 'refused', AUTH: 'key', CONTEXT_WINDOW_EXCEEDED: 'text', TIMEOUT: 'silent', 'SANS-REPONSE': 'silent', ABORTED: 'silent' }
for (const k of Object.keys(causes)) check(k + ' → ' + causes[k], santeCause(k) === causes[k])
check('an unknown code is "other", never undefined', santeCause('WHATEVER') === 'other' && santeCause('') === 'other')
check('a prototype name is not a cause', santeCause('constructor') === 'other' && santeCause('__proto__') === 'other' && santeCause('toString') === 'other')

console.log('the bus')
const probe = { settings: 0, health: 0, body: null, answer: null }
globalThis.fetch = async (url, opts) => {
  if (String(url) === '/kybernos-sessions/settings') { probe.settings += 1; return { ok: true, json: async () => ({ reglages: { brain: 'groq/llama-3.1-8b' } }) } }
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
