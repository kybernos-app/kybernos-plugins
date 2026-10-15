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


// ── Kyby: the plan, the setting, the pairing, the strip, the chat words ──────────────────────────
{
  const k = (home, tg) => T.derive({ ok: true, connected: true, telegram: Object.assign({ configured: true, enabled: true, bot: 'kybernos_bot', linked: null }, tg || {}), home }, server)
  ok('a server that does not know manual_control keeps the buttons', k({ state: 'suspended' }).home.manualControl === true)
  ok('manual_control false (the Free plan) is carried', k({ state: 'suspended', manual_control: false }).home.manualControl === false)
  ok('the paused reason is a word of ours, not the server\'s', k({ state: 'suspended', paused_reason: 'hours' }).home.paused === 'hours' && k({ state: 'suspended', paused_reason: 'DROP TABLE' }).home.paused === 'other' && k({ state: 'suspended' }).home.paused === '')
  ok('the setting is cloud unless the server says ask', k(null).telegram.homeTarget === 'cloud' && k(null, { home_target: 'ask' }).telegram.homeTarget === 'ask' && k(null, { home_target: 'mac' }).telegram.homeTarget === 'cloud')
}
{
  const now = Date.parse('2026-10-15T10:00:00Z')
  const exp = '2026-10-15T10:04:00Z'
  const f = (p) => T.pairingFace(p, now)
  ok('no pairing yet', f(null).kind === 'none')
  ok('waiting: the seconds left, from the server\'s expiry', f({ id: 'x', state: 'waiting', expiresAt: exp }).kind === 'waiting' && f({ id: 'x', state: 'waiting', expiresAt: exp }).left === 240)
  ok('scanned: the sender is carried', f({ id: 'x', state: 'scanned', expiresAt: exp, sender: 'Miled (@milede)' }).sender === 'Miled (@milede)')
  ok('past its expiry it is expired, whatever the state said', f({ id: 'x', state: 'waiting', expiresAt: '2026-10-15T09:59:00Z' }).kind === 'expired' && f({ id: 'x', state: 'expired' }).kind === 'expired')
  ok('declined carries one of three reasons, anything else is « user »', f({ state: 'declined', reason: 'taken' }).reason === 'taken' && f({ state: 'declined', reason: 'botmade' }).reason === 'botmade' && f({ state: 'declined', reason: 'sql' }).reason === 'user')
  ok('done and an error are their own faces', f({ state: 'done' }).kind === 'done' && f({ error: 'rate_limited' }).code === 'rate_limited')
  ok('the clock reads m:ss', T.clock(0) === '0:00' && T.clock(65) === '1:05' && T.clock(299.9) === '4:59')
}
{
  ok('the strip is open until Telegram is connected, folded after, and the person\'s choice wins', T.stripIsOpen(null, false) === true && T.stripIsOpen(null, true) === false && T.stripIsOpen(true, true) === true && T.stripIsOpen(false, false) === false)
  ok('WhatsApp and WeChat have a mark', typeof T.BRAND.whatsapp === 'function' && typeof T.BRAND.wechat === 'function' && typeof T.BRAND.telegram === 'function')
  ok('the assistant has one name, in both languages, and no « Kyber »', T.NAME === 'Kyby' && T.S.title[0] === 'Kyby' && T.S.title[1] === 'Kyby' && !Object.values(T.S).some((p) => /\bKyber\b/.test(p[0] + ' ' + p[1])))
  ok('every other channel says « soon » and is never offered', T.L('soon') === 'Bientôt' && /BRAND\.\w+\(22\)/.test(src) && !/whatsapp[^\n]*onClick/i.test(src))
}

{
}

{
  // Kyby's chat is a native DSH conversation: the page owns no transcript and no composer, only the way in and the strip above it.
  ok('the page holds no chat of its own: no draft box, no send, no transcript', !/kybernos-kyber-draft|kybernos-kyber-send|kbky-msgs|kybernos-kyber\/kyby\/send|\/kybernos-cloud\/kyby['"]/.test(src.replace(/kyby\/native/g, '')))
  ok('the way in is the host\'s pointer and DSH\'s own sessions service', /\/kybernos-cloud\/kyby\/native/.test(src) && /uiSvc\.openSession\(sid\)/.test(src) && /sessionsSvc\.create\(state\.kybyCwd === null/.test(src))
  ok('the strip is registered above the composer, for Kyby\'s session only', /SLOT_DOCK = 'conversation\.input\.dock'/.test(src) && /state\.kybySid !== sid\) return null/.test(src))
  ok('the diagnostics hook can open the chat', /openChat \(\) \{ return openChat\(\) \}/.test(src))
  ok('the words for the way in exist in both languages', T.S.openChat !== undefined && T.S.openChatHint !== undefined && T.S.openChatFail !== undefined)
}

{
  // A sheet that was lost once (a cleanup of the debug code took the effect with it) and a re-applied plugin must both keep the page styled.
  ok('the plugin injects its sheet, replacing an older one, and removes only its own', /ctx\.effect\(\(\) => \{\s*const old = document\.getElementById\(STYLE_ID\)\s*if \(old\) old\.remove\(\)/.test(src))
  const made = []
  const doc = globalThis.document
  const store = new Map()
  globalThis.document = Object.assign({}, doc, {
    getElementById: (id) => store.get(id) || null,
    createElement: () => { const el = { setAttribute () {}, remove () { if (store.get(el.id) === el) store.delete(el.id); el.gone = true } }; made.push(el); return el },
    head: { appendChild: (el) => { store.set(el.id, el) } },
  })
  const ctx = { effect: (fn) => fn(), get: () => undefined, slots: { inject: (n, fn) => fn(), register () {} } }
  const first = plugin.apply(ctx)
  const second = plugin.apply(ctx)
  ok('applied twice, one sheet is in the page and it is the second', store.get('kybernos-kyber-styles') === made[1] && made[0].gone === true)
  globalThis.document = doc
}

process.exit(fail > 0 ? 1 : 0)
