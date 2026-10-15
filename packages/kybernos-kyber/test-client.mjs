// The browser half: contract (plugin object, slots, strings in both languages, tokens not colours) and the pure model behind
// the two cards. Runs without DSH and without a browser: client.js is evaluated against a stub loader.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

let fail = 0
const ok = (name, cond, detail) => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  ' + (detail || ''))); if (!cond) fail++ }
const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, 'client.js'), 'utf8')

let captured = null
globalThis.window = { __ModuleLoader__: { load: (m) => { captured = m } }, __KB_LANG_RESOLVE__: () => 'fr' }
globalThis.document = { documentElement: { lang: 'fr' }, visibilityState: 'visible', getElementById: () => null, head: { appendChild () {} }, createElement: () => ({ setAttribute () {}, remove () {} }) }
const React = { Fragment: 'fragment', createElement: (type, props, ...kids) => ({ type, props, kids }), useState: (v) => [typeof v === 'function' ? v() : v, () => {}], useEffect: () => {} }
// eslint-disable-next-line no-new-func
new Function(src)()
ok('registers one module with the loader', captured !== null && captured.id === '@local/kybernos-kyber')
const plugin = captured.factory((n) => (n === 'react' ? React : undefined))
ok('factory returns a plugin object with apply and the two services', plugin !== undefined && typeof plugin.apply === 'function' && plugin.inject.includes('slots') && plugin.inject.includes('sidebarRightTabs'))
const T = plugin.__test

// ── slots and tab type ───────────────────────────────────────────────
{
  const regs = []
  const types = []
  const ctx = {
    effect: (fn) => fn(),
    get: (n) => (n === 'sidebarRightTabs' ? { register: (d) => { types.push(d); return () => {} } } : undefined),
    slots: { inject: (n, fn) => fn(), register: (meta, comp) => { regs.push({ meta, comp }) } },
  }
  plugin.apply(ctx)
  const pane = regs.find((r) => r.meta.name === 'sidebar.right.pane.tab')
  ok('the tab body is registered under the tab type id', pane !== undefined && pane.meta.key === T.TYPE_ID)
  ok('one tab type, with a guide entry', types.length === 1 && types[0].id === T.TYPE_ID && types[0].kind === T.KIND && types[0].guide.length === 1)
  ok('the tab title is Kyby', types[0].title() === 'Kyby')
  ok('the pane never throws before anything was read', (() => { try { return pane.comp() !== undefined } catch (e) { return false } })())
  ok('apply tolerates a missing registry', (() => {
    try { plugin.apply({ effect: (fn) => fn(), get () { throw new Error('absent') }, slots: { inject: (n, fn) => fn(), register () {} } }); return true } catch (e) { return false }
  })())
}

// ── strings: both languages, same placeholders ───────────────────────────────
{
  const keys = Object.keys(T.S)
  const holes = (t) => (t.match(/\{\w+\}/g) || []).sort().join()
  const bad = keys.filter((k) => !Array.isArray(T.S[k]) || T.S[k].length !== 2 || T.S[k][0].trim() === '' || T.S[k][1].trim() === '' || holes(T.S[k][0]) !== holes(T.S[k][1]))
  ok('every string has a French and an English side with the same holes', keys.length > 15 && bad.length === 0, bad.join())
  ok('a hole is filled', T.L('linked', { name: 'Miled' }) === 'Connecté : Miled')
}

// ── no hard-coded theme colour outside a var() fallback ──────────────────────
{
  const stripped = T.CSS.replace(/var\([^)]*\)/g, '')
  ok('colours come from DSH tokens', !/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(stripped), (stripped.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) || []).join())
}

// ── the model ────────────────────────────────────────────────────────────
const server = { ok: true, server: { api: 'https://server-dev-7831.up.railway.app/', web: 'https://dev.kybernos.app' } }
{
  const linked = T.derive({
    ok: true,
    connected: true,
    telegram: { configured: true, enabled: true, bot: 'kybernos_bot', linked: { display: 'Miled @milede', linked_at: '2026-10-14T20:34:35.000Z', paused: false, blocked: false } },
    home: { state: 'suspended', desired: 'suspended', mode: 'sleep', region: 'ams', last_active_at: '2026-10-14T22:50:00.000Z', version: 'p12', network: 'public' },
  }, server)
  ok('connected: the name, the date, the bot and the account page', linked.kind === 'ok' && linked.telegram.state === 'linked' && linked.telegram.name === 'Miled @milede' && linked.telegram.botUrl === 'https://t.me/kybernos_bot' && linked.accountUrl === 'https://server-dev-7831.up.railway.app/account', JSON.stringify(linked))
  ok('the home computer: state, image and network as the server said them', linked.home.state === 'suspended' && linked.home.version === 'p12' && linked.home.network === 'public')
}
{
  const none = T.derive({ ok: true, connected: true, telegram: { configured: true, enabled: true, bot: 'kybernos_bot', linked: null }, home: null }, server)
  ok('not connected yet: the bot is offered, no computer is said to exist', none.telegram.state === 'unlinked' && none.home === null)
  const off = T.derive({ ok: true, connected: true, telegram: { configured: false, enabled: false, bot: null, linked: null }, home: null }, server)
  ok('a door that is not set up says so and offers no bot', off.telegram.state === 'off' && off.telegram.botUrl === undefined)
  // the page must not draw a button for it: a link with no address is a dead button
  ok('the bot button is drawn only for an address', /typeof tg\.botUrl === 'string' && tg\.botUrl !== ''/.test(src))
  ok('signed out and unreadable are their own states', T.derive({ ok: true, connected: false }, server).kind === 'signedOut' && T.derive(null, server).kind === 'failed' && T.derive({ ok: false }, server).kind === 'failed')
}
{
  // What a hostile or odd answer cannot do: a bot name that is not a handle makes no link; an address that is not http(s) makes no account link.
  const odd = T.derive({ ok: true, connected: true, telegram: { configured: true, enabled: true, bot: 'x" onclick="y', linked: null }, home: null }, { ok: true, server: { api: 'javascript:alert(1)' } })
  ok('an odd bot name or address makes no link', odd.telegram.botUrl === '' && odd.accountUrl === '')
  ok('a network word that is not one is dropped', T.derive({ ok: true, connected: true, telegram: null, home: { state: 'running', network: '<b>' } }, server).home.network === '')
}

process.exit(fail > 0 ? 1 : 0)
