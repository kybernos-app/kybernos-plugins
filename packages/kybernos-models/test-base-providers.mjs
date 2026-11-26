#!/usr/bin/env node
/** Host harness for the built-in (« base ») providers of kybernos-models: the DeepSeek adapters are engine plugin rows, so their
 *  OFF/ON goes through the host's `pluginManager` service and never through a settings profile (no engine patch). These routes
 *  exist on the host half only: what the page draws is covered by test-client.mjs, and the real page by the GUI pass.
 *
 *  Everything runs on a fake webServer and a fake pluginManager: no port, no network, nothing written outside a temp DSH_HOME.
 *
 *    node kybernos-models/test-base-providers.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionSource } from './session-guard.mjs'
import { SESSION_SECRET, browserHeaders } from './lib-session-test.mjs'
sessionSource.secret = () => SESSION_SECRET // the machine secret the write routes check the session cookie against

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'kbm-base-'))
const { KB_BASE_ROWS, kbBaseRead, kbBaseSwitch, kbBaseMount } = await import('./index.js')

let pass = 0
let fail = 0
const ok = (name, cond, detail) => {
  if (cond === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' → ' + JSON.stringify(detail).slice(0, 240))) }
}
/** The same check through node:assert (deep equality), so a shape drift is named by assert itself. */
const same = (name, actual, want) => {
  let equal = false
  try { assert.deepEqual(actual, want); equal = true } catch (e) { /* reported below */ }
  ok(name, equal, { actual, want })
}

const PORT = 3080
const request = (method, path, body, headers) => {
  const text = body === undefined ? '' : (typeof body === 'string' ? body : JSON.stringify(body))
  return {
    method, url: path, socket: { localPort: PORT },
    headers: headers === undefined ? browserHeaders() : headers,
    on (ev, cb) { if (ev === 'data' && text !== '') cb(text); if (ev === 'end') cb() },
  }
}
const response = () => {
  const r = { status: 0, body: null }
  r.writeHead = (s) => { r.status = s }
  r.end = (s) => { try { r.body = JSON.parse(s) } catch (e) { r.body = s } }
  return r
}

/** The Loader rows a live profile reports, as `pluginManager.listPlugins()` shapes them. */
const loader = (opts = {}) => [
  { entryId: 'include:llm-deepseek', patchId: 'llm-deepseek', moduleName: '@deepseek-ai/dsh-llm-deepseek', enabled: opts.official !== false },
  { entryId: 'include:llm-deepseek-account', patchId: 'llm-deepseek-account', moduleName: '@deepseek-ai/dsh-llm-deepseek-account', enabled: opts.account !== false },
]
const manager = (list, result) => {
  const calls = []
  return {
    calls,
    listPlugins: async () => list,
    setPluginEnabled: async (id, enabled) => {
      calls.push([id, enabled])
      if (result !== undefined && result !== null) return result
      return { changed: true, application: 'applied', stage: 'enable', target: id, enabled }
    },
  }
}
const mount = (pm) => {
  const routes = {}
  kbBaseMount((route) => { routes[route.path] = route.handler }, () => ({ pluginManager: pm }))
  return routes
}
const call = async (routes, method, body, headers) => {
  const r = response()
  await routes['/kybernos-models/providers/base'](request(method, '/kybernos-models/providers/base', body, headers), r)
  return r
}

console.log('\n── the map is total and names Loader entries ──')
{
  const slugs = Object.keys(KB_BASE_ROWS)
  same('the two DeepSeek adapters are the only switchable rows', slugs.sort(), ['deepseek-account', 'deepseek-official'])
  const ids = slugs.reduce((all, slug) => all.concat(KB_BASE_ROWS[slug].entryIds), [])
  ok('every mapped id is a Loader entry id (`include:` prefixed)', ids.length === 2 && ids.every((id) => /^include:[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)), ids)
  ok('the exact measured ids are mapped', KB_BASE_ROWS['deepseek-official'].entryIds.join() === 'include:llm-deepseek' && KB_BASE_ROWS['deepseek-account'].entryIds.join() === 'include:llm-deepseek-account')
}

console.log('\n── reading the rows (pure) ──')
{
  same('both rows present and on', kbBaseRead(loader()), {
    'deepseek-official': { entryIds: ['include:llm-deepseek'], present: true, enabled: true },
    'deepseek-account': { entryIds: ['include:llm-deepseek-account'], present: true, enabled: true },
  })
  const oneOff = kbBaseRead(loader({ official: false }))
  ok('a disabled row reads as present, not enabled; the other is untouched', oneOff['deepseek-official'].enabled === false && oneOff['deepseek-official'].present === true && oneOff['deepseek-account'].enabled === true, oneOff)
  const none = kbBaseRead([])
  ok('an empty Loader lists nothing: present false, enabled false (never a phantom row)', none['deepseek-official'].present === false && none['deepseek-official'].enabled === false, none)
  ok('an unreadable answer never throws and reads as nothing', [null, undefined, {}, 'x', [null], [{}]].every((v) => kbBaseRead(v)['deepseek-official'].present === false))
  ok('a row with no entryId is matched through `include:` + patchId', kbBaseRead([{ patchId: 'llm-deepseek', enabled: true }])['deepseek-official'].enabled === true)
  ok('a row that answers another Loader entry is ignored', kbBaseRead([{ entryId: 'include:llm-pi-ai', enabled: true }])['deepseek-official'].present === false)
  const copy = kbBaseRead(loader())
  copy['deepseek-official'].entryIds.push('include:evil')
  ok('the map is not exposed by the read (the page gets a copy)', KB_BASE_ROWS['deepseek-official'].entryIds.length === 1)
}

console.log('\n── switching (pure) ──')
{
  const pm = manager(loader())
  const off = await kbBaseSwitch(pm, 'deepseek-official', false)
  same('one call, with the exact entry id and the wanted state', pm.calls, [['include:llm-deepseek', false]])
  same('the answer is the applied change', off, { ok: true, slug: 'deepseek-official', enabled: false })
  const pm2 = manager(loader())
  await kbBaseSwitch(pm2, 'deepseek-account', true)
  same('the account adapter switches its own row', pm2.calls, [['include:llm-deepseek-account', true]])
  const pm3 = manager(loader())
  same('an unknown slug is refused before any call', await kbBaseSwitch(pm3, 'ghost', false), { ok: false, error: 'bad-slug' })
  same('a non-string slug is refused too', await kbBaseSwitch(pm3, null, false), { ok: false, error: 'bad-slug' })
  ok('...and the manager was never called', pm3.calls.length === 0, pm3.calls)
  same('a host without pluginManager says so', await kbBaseSwitch(null, 'deepseek-official', false), { ok: false, error: 'no-plugin-manager' })
  same('...and so does a service without the switch', await kbBaseSwitch({ listPlugins: async () => [] }, 'deepseek-official', false), { ok: false, error: 'no-plugin-manager' })
  const refused = await kbBaseSwitch(manager(loader(), { changed: false, application: 'failed', stage: 'enable', target: 'include:llm-deepseek', error: { code: 'unknown-plugin' } }), 'deepseek-official', false)
  ok('a refused switch surfaces the manager code, never a silent success', refused.ok === false && refused.error === 'switch-failed' && refused.code === 'unknown-plugin' && refused.application === 'failed', refused)
  const later = await kbBaseSwitch(manager(loader(), { changed: true, application: 'restart-required', restartReason: 'no-hmr', stage: 'enable', target: 'include:llm-deepseek' }), 'deepseek-official', false)
  ok('a change that only lands at the next start is not reported as applied', later.ok === false && later.application === 'restart-required' && later.restartReason === 'no-hmr', later)
  const overridden = await kbBaseSwitch(manager(loader(), { changed: true, application: 'overridden', stage: 'enable', target: 'include:llm-deepseek' }), 'deepseek-official', true)
  ok('an overridden change is not a success either (a higher layer wins)', overridden.ok === false && overridden.code === 'overridden', overridden)
  const thrower = { setPluginEnabled: async () => { throw new Error('profile locked') } }
  const thrown = await kbBaseSwitch(thrower, 'deepseek-official', false)
  ok('a throwing manager becomes a reported failure', thrown.ok === false && thrown.code === 'threw' && /profile locked/.test(thrown.detail), thrown)
}

console.log('\n── the GET route ──')
{
  const pm = manager(loader())
  const r = await call(mount(pm), 'GET')
  ok('GET answers the two rows', r.status === 200 && r.body.ok === true && r.body.rows['deepseek-official'].enabled === true && r.body.rows['deepseek-account'].present === true, r.body)
  ok('the read never switches anything', pm.calls.length === 0, pm.calls)
  const noPm = await call(mount(null), 'GET')
  ok('no pluginManager is a 501 the page can degrade on, not a crash', noPm.status === 501 && noPm.body.ok === false && noPm.body.error === 'no-plugin-manager', noPm.body)
  const broken = mount({ listPlugins: async () => { throw new Error('loader busy') } })
  const br = await call(broken, 'GET')
  ok('a manager that throws answers 502 with its message, never a 500 stack', br.status === 502 && br.body.error === 'plugin-manager-failed' && /loader busy/.test(br.body.detail), br.body)
  ok('a GET from a foreign Origin is refused (DNS rebinding)', (await call(mount(manager(loader())), 'GET', undefined, { origin: 'http://evil.example' })).status === 403)
  ok('a GET with no Origin passes (direct navigation)', (await call(mount(manager(loader())), 'GET', undefined, {})).status === 200)
}

console.log('\n── the POST route (the switch) ──')
{
  const pm = manager(loader())
  const r = await call(mount(pm), 'POST', { slug: 'deepseek-official', enabled: false })
  ok('disabling answers ok with the slug and the state', r.status === 200 && r.body.ok === true && r.body.slug === 'deepseek-official' && r.body.enabled === false, r.body)
  same('setPluginEnabled was called exactly once, with the mapped id', pm.calls, [['include:llm-deepseek', false]])
  const pm2 = manager(loader({ official: false }))
  const on = await call(mount(pm2), 'POST', { slug: 'deepseek-official', enabled: true })
  ok('enabling answers ok and calls the same row with true', on.status === 200 && on.body.ok === true && on.body.enabled === true && pm2.calls[0].join() === 'include:llm-deepseek,true', pm2.calls)
  const pm3 = manager(loader())
  const bad = await call(mount(pm3), 'POST', { slug: 'llm-pi-ai', enabled: false })
  ok('an unknown slug is a 400 `bad-slug` and switches nothing', bad.status === 400 && bad.body.error === 'bad-slug' && pm3.calls.length === 0, bad.body)
  const pm4 = manager(loader())
  const noEnabled = await call(mount(pm4), 'POST', { slug: 'deepseek-official' })
  ok('a missing `enabled` is refused (never read as « disable »)', noEnabled.status === 400 && noEnabled.body.error === 'bad-enabled' && pm4.calls.length === 0, noEnabled.body)
  const pm5 = manager(loader())
  const notBool = await call(mount(pm5), 'POST', { slug: 'deepseek-official', enabled: 'false' })
  ok('a non-boolean `enabled` is refused too', notBool.status === 400 && notBool.body.error === 'bad-enabled' && pm5.calls.length === 0)
  const noPm = await call(mount(null), 'POST', { slug: 'deepseek-official', enabled: false })
  ok('no pluginManager is a 501', noPm.status === 501 && noPm.body.error === 'no-plugin-manager', noPm.body)
  const failedPm = manager(loader(), { changed: false, application: 'failed', stage: 'enable', target: 'include:llm-deepseek', error: { code: 'host-module' } })
  const failed = await call(mount(failedPm), 'POST', { slug: 'deepseek-official', enabled: false })
  ok('a manager failure is a 502 carrying its code (the page shows it, no fake success)', failed.status === 502 && failed.body.ok === false && failed.body.code === 'host-module', failed.body)
}

console.log('\n── the guards of the write route ──')
{
  const pm = manager(loader())
  const routes = mount(pm)
  ok('a POST with no Origin is refused (403)', (await call(routes, 'POST', { slug: 'deepseek-official', enabled: false }, {})).status === 403)
  ok('a POST from a foreign Origin is refused (403)', (await call(routes, 'POST', { slug: 'deepseek-official', enabled: false }, { origin: 'http://evil.example' })).status === 403)
  ok('the right Origin without the signed session is refused (401)', (await call(routes, 'POST', { slug: 'deepseek-official', enabled: false }, { origin: 'http://127.0.0.1:' + PORT })).status === 401)
  ok('...and none of the refused calls reached the plugin manager', pm.calls.length === 0, pm.calls)
  ok('another method is a 405', (await call(routes, 'PUT', { slug: 'deepseek-official', enabled: false })).status === 405)
  ok('malformed JSON is a 400, never a crash', (await call(routes, 'POST', '{not json')).status === 400)
  ok('a non-object body is a 400 too', (await call(routes, 'POST', 'null')).status === 400)
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
