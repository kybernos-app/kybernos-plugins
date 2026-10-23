// The page half: window.__KB__, the one versioned seam (docs/dev/plugin-contract.md, 6.5).   node packages/kybernos-registry/test-client.mjs
// client.js is run as it is in a fake `window`, so what is tested is the file that ships. No DOM, no network.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { satisfies as hostSatisfies } from './version.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(HERE, 'client.js'), 'utf8')
let failed = 0
const check = (name, ok, detail) => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + JSON.stringify(detail))); if (!ok) failed += 1 }

/** Evaluates client.js in a window of our own; returns `{ window, plugin, fetched }`. `answer` is what fetch gives back. */
const boot = (answer = { ok: true, json: async () => ({ ok: true, plugins: [], points: [] }) }, preset = {}) => {
  let factory = null
  const fetched = []
  const window = { __ModuleLoader__: { load: (m) => { factory = m.factory } } }
  Object.defineProperties(window, Object.getOwnPropertyDescriptors(preset)) // keeps getters as getters
  const sandbox = { window, fetch: (url) => { fetched.push(String(url)); return Promise.resolve(typeof answer === 'function' ? answer() : answer) }, console, Promise, Map, Array, Object, String, Number, RegExp }
  vm.runInNewContext(source, sandbox)
  return { window, plugin: factory(), fetched }
}

console.log('the file')
{
  const { window, plugin } = boot()
  check('the factory returns a plugin object with apply, and a test hook', typeof plugin === 'object' && typeof plugin.apply === 'function' && plugin.name === 'kybernos-registry')
  check('window.__KB__ exists as soon as the file is evaluated (before apply), version 1', window.__KB__ !== undefined && window.__KB__.version === 1)
  check('apply asks the host once and returns a cleanup function', await (async () => { const b = boot(); const un = b.plugin.apply(); await new Promise((r) => setTimeout(r, 5)); return typeof un === 'function' && b.fetched.join() === '/kybernos-registry/state' })())
  check('a seam that already exists is kept (a reload does not lose the providers)', (() => { const first = boot(); first.window.__KB__.provide('kybernos/core', '1.0.0', { x: 1 }); const second = boot(undefined, { __KB__: first.window.__KB__ }); return second.window.__KB__ === first.window.__KB__ && second.window.__KB__.use('kybernos/core', '^1') !== null })())
  check('a load error returns a disabled plugin, not nothing', (() => { const preset = {}; Object.defineProperty(preset, '__KB__', { get () { throw new Error('boom') } }); const warn = console.warn; console.warn = () => {}; try { const { plugin } = boot(undefined, preset); return typeof plugin === 'object' && typeof plugin.apply === 'function' && plugin.name === undefined } catch (e) { return false } finally { console.warn = warn } })())
  check('there is no DOM work in this file: no document, no observer, no slot', !/\bdocument\b|MutationObserver|slots\./.test(source.replace(/^\s*\/\/.*$/gm, '')))
}

console.log('provide, use, reason')
{
  const { window } = boot()
  const kb = window.__KB__
  const service = { hello: () => 'hi' }
  check('provide accepts a plugin id, a full version and a service', kb.provide('kybernos/dashboards', '1.2.0', service) === true)
  check('provide refuses a bad id, a bad version, no service', kb.provide('Dashboards', '1.0.0', {}) === false && kb.provide('kybernos/x', '1', {}) === false && kb.provide('kybernos/x', '1.0.0', null) === false && kb.provide('kybernos/x', '1.0.0') === false)
  check('use gives the service when the range matches', kb.use('kybernos/dashboards', '^1') === service && kb.use('kybernos/dashboards', '>=1.2.0') === service && kb.use('kybernos/dashboards') === service)
  check('use gives null, never an error, when it does not', kb.use('kybernos/dashboards', '^2') === null && kb.use('kybernos/nobody', '^1') === null && kb.use('nope', '^1') === null && kb.use('kybernos/dashboards', '^1 || ^2') === null)
  check('reason says why', kb.reason('kybernos/dashboards', '^2') === 'version' && kb.reason('kybernos/nobody', '^1') === 'absent' && kb.reason('kybernos/dashboards', '^1') === null)
  check('a later provide replaces the service', (() => { kb.provide('kybernos/dashboards', '1.3.0', { v: 2 }); return kb.use('kybernos/dashboards', '^1').v === 2 })())
}

console.log('extend, status, on, refresh')
{
  let clock = 0
  const state = { ok: true, plugins: [{ id: 'local/vet', status: 'disabled' }, { id: 'local/legal', status: 'invalid' }], points: [{ id: 'kybernos/core#domain-pack', contributions: 1 }] }
  const { window } = boot({ ok: true, json: async () => state })
  const kb = window.__KB__
  const seen = []
  const off = kb.on('change', () => seen.push(++clock))
  check('status of a plugin nobody knows is absent', kb.status('local/vet') === 'absent' && kb.plugins().length === 0)
  check('refresh reads the host\'s list and tells the listeners', await kb.refresh() === true && seen.length === 1 && kb.status('local/vet') === 'disabled' && kb.status('local/legal') === 'invalid' && kb.points()[0].id === 'kybernos/core#domain-pack')
  check('a service this page holds is ok', (kb.provide('kybernos/core', '1.0.0', {}), kb.status('kybernos/core') === 'ok'))
  const impl = { run() {} }
  const withdraw = kb.extend('kybernos/dashboards#source', impl)
  check('extend keeps a code contribution and returns how to withdraw it', kb.extensions('kybernos/dashboards#source')[0] === impl && (withdraw(), kb.extensions('kybernos/dashboards#source').length === 0))
  check('extend refuses what is not a point or has no implementation', typeof kb.extend('nope', {}) === 'function' && kb.extensions('nope').length === 0 && typeof kb.extend('kybernos/x#y', null) === 'function' && kb.extensions('kybernos/x#y').length === 0)
  off(); const n = seen.length; kb.provide('kybernos/zzz', '1.0.0', {})
  check('a listener that unsubscribed hears nothing more; one that throws breaks nothing', seen.length === n && (kb.on('change', () => { throw new Error('boom') }), kb.provide('kybernos/yyy', '1.0.0', {}) === true))
  const bad = boot({ ok: false, json: async () => null })
  check('refresh never rejects: a host that says no, or nonsense, leaves the list as it was', await bad.window.__KB__.refresh() === false && bad.window.__KB__.plugins().length === 0)
  const odd = boot({ ok: true, json: async () => ({ plugins: 'x' }) })
  check('an answer of the wrong shape is ignored', await odd.window.__KB__.refresh() === false)
  const down = boot(() => { throw new Error('offline') })
  check('a network failure is false, not an exception', await down.window.__KB__.refresh() === false)
}

console.log('the copy of the version code agrees with the host\'s')
{
  const { plugin } = boot()
  const { satisfies } = plugin.__test
  const CASES = [['1.0.0', '^1'], ['2.0.0', '^1'], ['0.1.1', '^0.1'], ['0.2.0', '^0.1'], ['0.0.3', '^0.0.3'], ['0.0.4', '^0.0.3'], ['1.2.9', '~1.2'], ['1.3.0', '~1.2'], ['1.0.0', '>=1 <2'], ['2.0.0', '>=1 <2'], ['0.2.1-rc.2', '>=0.1.6-alpha.2 <=0.2.1-rc.2'], ['0.2.1', '>=0.1.6-alpha.2 <=0.2.1-rc.2'], ['1.0.0', '=1.0.0'], ['1.0.0', '1.0.0'], ['1.0.0', '^1 || ^2'], ['1.0.0', ''], ['x', '^1'], ['1.0.0-rc.1', '^1.0.0-rc.1']]
  check('the page and the host answer alike on a table', CASES.every(([v, r]) => satisfies(v, r) === hostSatisfies(v, r)), CASES.filter(([v, r]) => satisfies(v, r) !== hostSatisfies(v, r)))
}

console.log(failed === 0 ? '\nCLIENT OK' : '\nCLIENT: ' + failed + ' failed')
process.exit(failed === 0 ? 0 : 1)
