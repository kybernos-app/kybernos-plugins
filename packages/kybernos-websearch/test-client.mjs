#!/usr/bin/env node
// kybernos-websearch: browser half, contract only (the page itself is checked on a real GUI: scripts/check-websearch-live.mjs).
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(HERE, 'client.js'), 'utf8')

let fail = 0
const ok = (name, cond, detail) => {
  if (cond === true) console.log('  ✓ ' + name)
  else { fail += 1; console.log('  ✗ ' + name + (detail !== undefined ? ' → ' + String(detail).slice(0, 200) : '')) }
}

// ── load the factory the way DSH does, with a fake React and a fake slots service ──────────────────
let loaded = null
const slotsLog = []
const sandbox = {
  window: {
    __KB_LANG_RESOLVE__: () => 'en',
    __ModuleLoader__: { load: (m) => { loaded = m } }
  },
  document: { createElement: () => ({ dataset: {}, remove () {} }), head: { append () {} } },
  console,
  URL
}
vm.createContext(sandbox)
vm.runInContext(src, sandbox)
ok('the module registers itself with the loader under its package name', loaded !== null && loaded.id === '@local/kybernos-websearch' && typeof loaded.factory === 'function')

const React = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  useState: (v) => [v, () => {}],
  useEffect: () => {}
}
const plugin = loaded.factory((name) => (name === 'react' ? React : null))
ok('the factory returns a plugin object that waits for slots', plugin !== null && typeof plugin === 'object' && typeof plugin.apply === 'function' && Array.isArray(plugin.inject) && plugin.inject.includes('slots'))

const registered = []
const ctx = {
  slots: { inject: (name, fn) => { slotsLog.push(name); registered.push(fn()); return () => {} }, register: (meta, render) => ({ meta, render }) },
  effect: (fn) => fn()
}
plugin.apply(ctx)
ok('apply() adds exactly one Settings section', slotsLog.length === 1 && slotsLog[0] === 'settings.section' && registered.length === 1)
const registerArgs = registered[0]
ok('the section is « Web Search », order 15, id kybernos-websearch-page', registerArgs.meta.id === 'kybernos-websearch-page' && registerArgs.meta.label === 'Web Search' && registerArgs.meta.order === 15 && registerArgs.meta.name === 'settings.section')
ok('a missing slots service is not an error', (() => { try { plugin.apply({}); return true } catch (e) { return false } })())

// ── what the page says about an engine ─────────────────────────────────────────────────────────────
const { statusOf, accessBadge } = plugin.__test
const base = { id: 'x', access: 'free', enabled: true, configured: true, health: {} }
ok('status: switched off, key missing, paused, answered, ready', [
  statusOf({ ...base, enabled: false }).cls === 'off',
  statusOf({ ...base, access: 'key', configured: false }).cls === 'warn',
  statusOf({ ...base, health: { pausedUntil: Date.now() + 1000, kind: 'blocked' } }).cls === 'down',
  statusOf({ ...base, health: { lastOkAt: Date.now(), lastCount: 5, lastMs: 800 } }).cls === 'ok',
  statusOf(base).txt === 'Ready'
].every(Boolean))
ok('badge: free engines say NO KEY, keyed ones KEY', accessBadge({ access: 'free' }).txt === 'NO KEY' && accessBadge({ access: 'key' }).txt === 'KEY')

// ── an address that cannot be saved says so; a failed test says why (A3-26) ──────────────────────────────
const { addressProblem, testDetail } = plugin.__test
const bad = ['not a url', 'javascript:alert(1)', 'ftp://x.example', '127.0.0.1:8080', 'http://', 'http://user:pw@host.example/', 'a b']
ok('an address that is not http(s) is refused with a sentence, for SearXNG and for the custom address', bad.every((t) => typeof addressProblem('searxngUrl', t) === 'string' && addressProblem('customUrl', t) !== null), bad.filter((t) => addressProblem('searxngUrl', t) === null).join())
ok('a good address, and a blank one (which clears the field), pass', addressProblem('searxngUrl', 'http://127.0.0.1:8080') === null && addressProblem('customUrl', 'https://search.example.com/query') === null && addressProblem('searxngUrl', '   ') === null && addressProblem('searxngUrl', '') === null)
ok('the sentence shows an example', /http:\/\/127\.0\.0\.1:8080/.test(addressProblem('searxngUrl', 'nope')))
ok('the search engine id and the language code are checked too (the host drops them silently)', addressProblem('googleCx', 'a b!') !== null && addressProblem('googleCx', 'a1b2c3:d_e-f') === null && addressProblem('wikiLang', 'English') !== null && addressProblem('wikiLang', 'fr') === null && addressProblem('wikiLang', 'pt-br') === null)
ok('a failed test names the cause, never the raw « fetch failed »', testDetail({ ok: false, kind: 'network', message: 'fetch failed', reason: 'refused' }) === 'Nothing is listening at this address (connection refused).' && testDetail({ ok: false, kind: 'network', message: 'fetch failed' }) === 'Nothing answered at this address.' && !/fetch failed/.test(testDetail({ ok: false, kind: 'network', message: 'fetch failed', reason: 'tls' })) && /not allowed/.test(testDetail({ ok: false, kind: 'network', message: 'fetch failed', reason: 'badport' })))
ok('other failures keep their own message, and « missing » / « empty » say nothing more', testDetail({ ok: false, kind: 'server', message: 'HTTP 502' }) === 'HTTP 502' && testDetail({ ok: false, kind: 'missing', message: 'x' }) === '' && testDetail({ ok: false, kind: 'empty', message: 'x' }) === '')
ok('an address engine nobody has asked is not « Ready » (it is only a saved string)', statusOf({ ...base, access: 'url', health: {} }).txt === 'Address saved · not tested yet' && statusOf({ ...base, access: 'url', health: { lastOkAt: Date.now(), lastCount: 3, lastMs: 100 } }).cls === 'ok')
ok('Save waits for a valid address and the reason is drawn under the field', /disabled: addr === null \|\| addrBad !== null/.test(src) && /data-kb': 'websearch-address-error'/.test(src))

// ── which engine is the default (V-35) ─────────────────────────────────────────────────────────────────
const { defaultEngine } = plugin.__test
const eng = (id, over = {}) => ({ id, enabled: true, configured: true, access: 'free', ...over })
ok('the default is the first engine of the list that is switched on and ready', defaultEngine([eng('a', { enabled: false }), eng('b', { configured: false }), eng('c'), eng('d')]).id === 'c')
ok('the order of the list is the priority: moving an engine up makes it the default', defaultEngine([eng('d'), eng('c')]).id === 'd')
ok('no engine on, or none ready: no default (the page says so)', defaultEngine([eng('a', { enabled: false })]) === null && defaultEngine([]) === null && defaultEngine(undefined) === null)
ok('the default is marked on its row and named under the title', /isDefault: fixed !== true && defaultId === e\.id/.test(src) && src.includes("'data-kb': 'websearch-default'") && src.includes("'data-kb': 'websearch-default-line'"))

// ── A3-34: a host half that does not answer is a sentence and a Retry, never « Failed to fetch » ────
// The four ways the audit saw it fail (refused connection, 404 after an update without restart, a 500, an HTML page),
// then the page that shows the result.
const { api, hostDown } = plugin.__test
const SENTENCE = 'This page’s helper is not answering. If DSH was just updated, restart DSH, then press Retry.'
const answer = (status, text) => async () => ({ status, ok: status < 400, json: async () => JSON.parse(text), text: async () => text })
const whatApiSays = async (fetchImpl) => {
  sandbox.fetch = fetchImpl
  try { return { value: await api('/kybernos-websearch/state') } } catch (e) { return { error: e } }
}
{
  const refused = await whatApiSays(async () => { throw new TypeError('Failed to fetch') })
  ok('a refused connection says the helper is not answering', refused.error !== undefined && refused.error.message === SENTENCE, refused.error && refused.error.message)
  const gone = await whatApiSays(answer(404, '<html>Not found</html>'))
  ok('a 404 (DSH not restarted after an update) says the same', gone.error !== undefined && gone.error.message === SENTENCE, gone.error && gone.error.message)
  const crashed = await whatApiSays(answer(500, '{"ok":false,"error":"boom"}'))
  ok('a 500 says the same', crashed.error !== undefined && crashed.error.message === SENTENCE, crashed.error && crashed.error.message)
  const html = await whatApiSays(async () => ({ status: 200, ok: true, json: async () => JSON.parse('<!doctype html><title>Sign in</title>') }))
  ok('a page that is not JSON says the same (a captive portal, a proxy)', html.error !== undefined && html.error.message === SENTENCE, html.error && html.error.message)
  ok('never the browser\'s own words', [refused, gone, crashed, html].every((r) => !/Failed to fetch|Unexpected token|JSON/.test(r.error.message)))
  const fine = await whatApiSays(answer(200, '{"ok":true,"engines":[]}'))
  ok('a good answer passes through untouched', fine.value !== undefined && fine.value.ok === true)
  const refusal = await whatApiSays(answer(400, '{"ok":false,"error":"invalid-key"}'))
  ok('a 400 with its own reason is still the host\'s answer, not « not answering »', refusal.value !== undefined && refusal.value.error === 'invalid-key')
  ok('hostDown() carries the sentence', hostDown().message === SENTENCE)
}

// The page itself, rendered with a fake React whose first hooks are set: state null and msg = the sentence.
{
  const walk = (node, hit, out = []) => {
    if (node === null || typeof node !== 'object') return out
    if (hit(node)) out.push(node)
    for (const c of [].concat(node.children || [])) walk(c, hit, out)
    return out
  }
  const textOf = (node) => (node === null || node === undefined ? '' : (typeof node === 'object' ? [].concat(node.children || []).map(textOf).join('') : String(node)))
  const renderPage = (over) => {
    let n = 0
    const React2 = { ...React, Fragment: 'Fragment', useState: (v) => { const i = n; n += 1; return [i in over ? over[i] : v, () => {}] }, useEffect: () => {} }
    const p2 = loaded.factory((name) => (name === 'react' ? React2 : null))
    let reg = null
    p2.apply({ slots: { inject: (name, fn) => { reg = fn(); return () => {} }, register: (meta, render) => ({ meta, render }) }, effect: (fn) => fn() })
    return reg.render().type()
  }
  const failed = renderPage({ 1: SENTENCE })
  const panel = walk(failed, (nd) => nd.props && nd.props['data-kb'] === 'websearch-down')
  ok('first read failed: a panel with the sentence', panel.length === 1 && textOf(panel[0]).includes(SENTENCE), panel.length && textOf(panel[0]))
  ok('…and a Retry button', walk(failed, (nd) => nd.type === 'button' && nd.props['data-act'] === 'retry' && textOf(nd) === 'Retry').length === 1)
  ok('…under the page\'s own title, which stays', walk(failed, (nd) => nd.type === 'h4' && textOf(nd) === 'Web Search').length === 1)
  ok('…and no bare red line any more', walk(failed, (nd) => nd.props && nd.props.className === 'kwse-err').length === 0)
  const loading = renderPage({})
  ok('while it loads (no error yet) there is no failure panel', walk(loading, (nd) => nd.props && nd.props['data-kb'] === 'websearch-down').length === 0)
}

// ── hygiene (same rules as the other bundles) ───────────────────────────────────────────────────────
const hook = (id) => src.indexOf("'data-kb': '" + id + "'") !== -1
ok('stable data-kb hooks for tests and live scripts', ['websearch-page', 'websearch-list', 'websearch-engine', 'websearch-switch', 'websearch-key-input', 'websearch-test-result', 'websearch-domains', 'websearch-last'].every(hook))
ok('no six-digit hard-coded colour (theme tokens with a fallback only)', !/#[0-9a-fA-F]{6}\b/.test(src), (src.match(/#[0-9a-fA-F]{6}\b/g) || []).slice(0, 3))
ok('no French in a title or aria-label that does not go through kt()', !/(title|aria-label)'?:\s*'[^']*[éèàêçù][^']*'/.test(src))
ok('the key is typed in a password field and never rendered back', /type: 'password'/.test(src) && !/value: secretRef/.test(src))
ok('external links carry noopener', /rel: 'noopener noreferrer'/.test(src))
ok('only this plugin\'s own routes are called', (src.match(/'\/[a-z-]+\/[a-z]+'/g) || []).every((p) => p.startsWith("'/kybernos-websearch/")))
ok('the style tag is removed with the plugin', /tag\.remove\(\)/.test(src))
ok('the CSS prefix is private to this bundle', (src.match(/\.kwse-/g) || []).length > 20 && !/\.kbws-|\.kws-/.test(src))

console.log('\n' + (fail === 0 ? 'ALL CHECKS OK' : fail + ' check(s) FAILED'))
process.exit(fail === 0 ? 0 : 1)
