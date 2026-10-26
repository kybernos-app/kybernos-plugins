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
const React = { Fragment: 'fragment', createElement: (type, props, ...kids) => ({ type, props, kids }), useState: (v) => [typeof v === 'function' ? v() : v, () => {}], useRef: (v) => ({ current: v }), useEffect: () => {} }
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
  ok('the tab title is Kaby', types[0].title() === 'Kaby')
  ok('the pane never throws before anything was read', (() => { try { return pane.comp() !== undefined } catch (e) { return false } })())
  ok('apply tolerates a missing registry', (() => {
    try { plugin.apply({ effect: (fn) => fn(), get () { throw new Error('absent') }, slots: { inject: (n, fn) => fn(), register () {} } }); return true } catch (e) { return false }
  })())
}

// ── the phone's Kaby app: only a frame of /__kb/kaby/ opens Kaby's chat ──────────────────────────────
{
  const realParent = globalThis.window.parent
  ok('outside any frame it is not the Kaby app', T.inKabyApp() === false)
  globalThis.window.parent = { location: { pathname: T.KABY_APP_PATH } }
  ok('a frame of /__kb/kaby/ is the Kaby app', T.inKabyApp() === true)
  globalThis.window.parent = { location: { pathname: '/__kb/' } }
  ok('a frame of the remote page is not', T.inKabyApp() === false)
  globalThis.window.parent = { get location () { throw new Error('cross-origin') } }
  ok('a frame that may not be read is not (and does not throw)', T.inKabyApp() === false)
  globalThis.window.parent = globalThis.window
  ok('a page that is its own parent is not', T.inKabyApp() === false)
  if (realParent === undefined) delete globalThis.window.parent; else globalThis.window.parent = realParent
  ok('the bridge is one effect of apply, and opens the chat with the sidebar row\'s own call', /ctx\.effect\(\(\) => openKabyApp\(\)/.test(src) && /if \(!\(await openChat\(\)\)\)/.test(src))
  ok('the bridge waits for the shell, then lets DSH\'s restoration go first', /shellReady\(\)/.test(src) && /await pause\(600\)/.test(src))
}

// ── strings: both languages, same placeholders ───────────────────────────────
{
  const keys = Object.keys(T.S)
  const holes = (t) => (t.match(/\{\w+\}/g) || []).sort().join()
  const bad = keys.filter((k) => !Array.isArray(T.S[k]) || T.S[k].length !== 2 || T.S[k][0].trim() === '' || T.S[k][1].trim() === '' || holes(T.S[k][0]) !== holes(T.S[k][1]))
  ok('every string has a French and an English side with the same holes', keys.length > 15 && bad.length === 0, bad.join())
  ok('a hole is filled', T.L('linked', { name: 'Amina' }) === 'Connecté : Amina')
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
    telegram: { configured: true, enabled: true, bot: 'kybernos_bot', linked: { display: 'Amina @alex', linked_at: '2026-10-14T20:34:35.000Z', paused: false, blocked: false } },
    home: { state: 'suspended', desired: 'suspended', mode: 'sleep', region: 'ams', last_active_at: '2026-10-14T22:50:00.000Z', version: 'p12', network: 'public' },
  }, server)
  ok('connected: the name, the date, the bot and the account page', linked.kind === 'ok' && linked.telegram.state === 'linked' && linked.telegram.name === 'Amina @alex' && linked.telegram.botUrl === 'https://t.me/kybernos_bot' && linked.accountUrl === 'https://server-dev-7831.up.railway.app/account', JSON.stringify(linked))
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


// ── Kaby: the plan, the setting, the pairing, the strip, the chat words ──────────────────────────
{
  const k = (home, tg) => T.derive({ ok: true, connected: true, telegram: Object.assign({ configured: true, enabled: true, bot: 'kybernos_bot', linked: null }, tg || {}), home }, server)
  ok('a server that does not know manual_control keeps the buttons', k({ state: 'suspended' }).home.manualControl === true)
  ok('manual_control false (the Free plan) is carried', k({ state: 'suspended', manual_control: false }).home.manualControl === false)
  ok('the paused reason is a word of ours, not the server\'s', k({ state: 'suspended', paused_reason: 'hours' }).home.paused === 'hours' && k({ state: 'suspended', paused_reason: 'DROP TABLE' }).home.paused === 'other' && k({ state: 'suspended' }).home.paused === '')
  ok('the computers of the account are listed, and the one linked to the assistant is the home', (() => { const v = T.derive({ ok: true, connected: true, telegram: null, computers: [{ id: 'aaaaaaaa-1111', name: 'Home', state: 'suspended' }, { id: 'bbbbbbbb-2222', name: 'Atelier', state: 'running' }, { id: '../x', name: 'bad' }], home: { id: 'bbbbbbbb-2222', name: 'Atelier', state: 'running' } }, server); return v.computers.length === 2 && v.home.id === 'bbbbbbbb-2222' && v.home.name === 'Atelier' })())
}
{
  const now = Date.parse('2026-10-15T10:00:00Z')
  const exp = '2026-10-15T10:04:00Z'
  const f = (p) => T.pairingFace(p, now)
  ok('no pairing yet', f(null).kind === 'none')
  ok('waiting: the seconds left, from the server\'s expiry', f({ id: 'x', state: 'waiting', expiresAt: exp }).kind === 'waiting' && f({ id: 'x', state: 'waiting', expiresAt: exp }).left === 240)
  ok('scanned: the sender is carried', f({ id: 'x', state: 'scanned', expiresAt: exp, sender: 'Amina (@alex)' }).sender === 'Amina (@alex)')
  ok('past its expiry it is expired, whatever the state said', f({ id: 'x', state: 'waiting', expiresAt: '2026-10-15T09:59:00Z' }).kind === 'expired' && f({ id: 'x', state: 'expired' }).kind === 'expired')
  ok('declined carries one of three reasons, anything else is « user »', f({ state: 'declined', reason: 'taken' }).reason === 'taken' && f({ state: 'declined', reason: 'botmade' }).reason === 'botmade' && f({ state: 'declined', reason: 'sql' }).reason === 'user')
  ok('done and an error are their own faces', f({ state: 'done' }).kind === 'done' && f({ error: 'rate_limited' }).code === 'rate_limited')
  ok('the clock reads m:ss', T.clock(0) === '0:00' && T.clock(65) === '1:05' && T.clock(299.9) === '4:59')
  // Measured on dev, 2026-10-20: two real phone rounds, the code stayed « waiting » and no Start ever reached the server. On a bot the person already used, the link only opens the
  // chat and the Start (or Restart) must be pressed, so a code that has waited a while with nothing says what to do instead of just counting down.
  const stuck = (p) => f(Object.assign({ id: 'x', state: 'waiting', expiresAt: exp }, p)).stuck
  // The page renews a lapsed code by itself within a poll (2 s): in between it must not flash « this code has expired » with a button; once it cannot renew any more, it says so.
  const lapsed = { id: 'x', state: 'waiting', expiresAt: '2026-10-15T09:59:00Z' }
  ok('a lapsed code that the page is about to renew still reads as waiting (0:00), not as expired', T.pairingFace(lapsed, now, true).kind === 'waiting' && T.pairingFace(lapsed, now, true).left === 0 && T.pairingFace(lapsed, now, false).kind === 'expired' && T.pairingFace(lapsed, now).kind === 'expired')
  ok('a scanned code that ran out is expired, renewable or not (it is never replaced under the person\'s hand)', T.pairingFace(Object.assign({}, lapsed, { state: 'scanned' }), now, true).kind === 'expired')
  ok('a code that a poll already marked expired shows as expired once there is no renewal left', T.pairingFace({ id: 'x', state: 'expired' }, now, false).kind === 'expired')
  ok('a code that has waited 20 s with no Start is stuck; younger, scanned, or of unknown age it is not', stuck({ startedAt: now - 25000 }) === true && stuck({ startedAt: now - 10000 }) === false && stuck({ startedAt: now - 25000, state: 'scanned' }) === false && stuck({}) === false)
}
{
  ok('WhatsApp and WeChat have a mark', typeof T.BRAND.whatsapp === 'function' && typeof T.BRAND.wechat === 'function' && typeof T.BRAND.telegram === 'function')
  ok('the assistant has one name, said through a token, in both languages, and no « Kyber » or « Kyby » is spelt out', T.NAME === 'Kaby' && T.L('title') === 'Kaby' && T.kt('{NAME}', '{NAME}') === '{NAME}' && !Object.values(T.S).some((p) => /\b(Kyber|Kyby|Kaby)\b/.test(p[0] + ' ' + p[1])) && /\{NAME\}/.test(JSON.stringify(T.S)))
  ok('the channels that are not there yet say « soon » in both languages', T.L('soon') === 'Bientôt' && T.kt('Bientôt', 'Soon') === 'Bientôt')
  ok('a channel that is not there yet says « Soon » once: the chip says it, the line under the name says what it means (C-09)', /later\('wechat', 'WeChat', L\('soon'\), L\('notYet'\)\)/.test(src) && !/sub: L\('soon'\)/.test(src) && T.L('notYet') === 'Pas encore disponible' && T.L('notYet') !== T.L('soon'))
}

{
}

{
  // Kaby's chat is a native DSH conversation: the page owns no transcript and no composer, only the way in and the strip above it.
  ok('the page holds no chat of its own: no draft box, no send, no transcript', !/kybernos-kyber-draft|kybernos-kyber-send|kbky-msgs|kybernos-kyber\/kyby\/send|\/kybernos-cloud\/kyby['"]/.test(src.replace(/kyby\/native/g, '')))
  ok('the way in is the host\'s pointer and DSH\'s own sessions service', /\/kybernos-cloud\/kyby\/native/.test(src) && /uiSvc\.openSession\(sid\)/.test(src) && /wsSvc\.create\(\{ path: state\.kybyCwd \}\)/.test(src) && /sessionsSvc\.create\(workspaceId !== null \? \{ workspaceId \}/.test(src))
  ok('the strip is registered above the composer, for Kaby\'s session only', /SLOT_DOCK = 'conversation\.input\.dock'/.test(src) && /state\.kybySid !== sid\) return null/.test(src))
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

{
  // Calm: what there is to DO, not everything there is.
  ok('Kaby\'s chat is made in a workspace of its own, already chosen, and a chat made without one is made again', /ws\.items\.some\(\(i\) => i !== null && Array\.isArray\(i\.sessionIds\) && i\.sessionIds\.includes\(sid\)\)/.test(src))
  ok('the strip is as wide as the composer\'s card and centred like it, by the engine\'s own variables (and the dock is padded by the engine\'s side clearance), with the old full width as the fallback', /\.kbky-strip\{box-sizing:border-box;width:100%;max-width:var\(--dsh-composer-card-max-width,none\);margin-inline:auto/.test(src) && /\.kbky-dock\{margin:0 0 8px;padding:0 var\(--dsh-composer-side-clearance,16px\)\}/.test(src))
  ok('the strip is ONE line (a name, three chips, one button, a list that opens above it); the code panel lives under Telegram\'s row on the « Phone and channels » screen; the computer is a sub-block of Kaby\'s block there; no settings, no radio, no « Other channels » group', /const Strip = \(\) => \{/.test(src) && /chip\('remote'/.test(src) && /chip\('telegram'/.test(src) && /chip\('computer'/.test(src) && /h\(ComputerBlock, \{ view: v \}\)/.test(src) && !/ChannelsTile|ComputerTile|stripIsOpen|toggleStrip|stripPref|kybernos-kyber\.strip/.test(src) && !/radio|Other channels|Autres canaux/.test(src))
  ok('the server the host names is kept, with whether another can be switched to', (() => { const v = T.derive({ ok: true, connected: true, telegram: null, home: null, server: { name: 'Kybernos (local)', host: 'localhost:8791', can_switch: true } }, server); return v.server.name === 'Kybernos (local)' && v.server.host === 'localhost:8791' && v.server.canSwitch === true })())
  ok('an odd or missing server is dropped, and then there is nothing to switch to', (() => { const a = T.derive({ ok: true, connected: true, telegram: null, home: null, server: { name: '<b>x</b>'.repeat(40), host: 7, can_switch: 'yes' } }, server); const b = T.derive({ ok: true, connected: true, telegram: null, home: null }, server); return a.server.canSwitch === false && a.server.name.length <= 60 && a.server.host === '' && b.server.canSwitch === false && b.server.name === '' })())
  ok('the diagnostics hook tells whether a chat is Kaby\'s (the new-chat cards stay out of it)', /isKybySession \(sid\)/.test(src))
}

{
  ok('a computer that does not exist yet is « made at your first request that needs one », not a missing thing', T.L('noHome').startsWith('Créé') && T.S.onRequest !== undefined)
  ok('the computer is always a plain select (this computer and the cloud ones), and a cloud choice is sent to the host', /'data-kb': 'kybernos-kyber-pick'/.test(src) && /\/kybernos-cloud\/kyby\/computer/.test(src) && /whereOf\(state\.where, v\)/.test(src))
  ok('no setting of where a message runs is left in the page', !/telegram\/settings|home_target|homeTarget/.test(src))
}

// ═══ the views, rendered for real ═══════════════════════════════════════════════════════════════
// The factory's React is a stub that records elements; here function components are expanded (hooks stubbed) so that what a person
// would see and press is read from the real views: the tiles, the switch, the panel under them, the computer. fetch and timers are
// recorded, so what a press SENDS is asserted too.
{
  const expand = (n) => {
    if (n === null || n === undefined || n === false || n === true) return []
    if (Array.isArray(n)) return n.flatMap(expand)
    if (typeof n === 'string' || typeof n === 'number') return [String(n)]
    if (typeof n.type === 'function') return expand(n.type(Object.assign({}, n.props, { children: n.kids.length === 1 ? n.kids[0] : n.kids })))
    if (n.type === 'fragment') return n.kids.flatMap(expand)
    return [{ tag: n.type, props: n.props || {}, kids: n.kids.flatMap(expand) }]
  }
  const walk = (n, out = []) => { if (typeof n === 'string') return out; out.push(n); n.kids.forEach((k) => walk(k, out)); return out }
  const textOf = (n) => (typeof n === 'string' ? n : n.kids.map(textOf).join(' ')).replace(/\s+/g, ' ').trim()
  const ui = (component, props) => expand(component(props || {}))
  const nodes = (tree) => tree.flatMap((n) => walk(n))
  const byKb = (tree, kb) => nodes(tree).filter((n) => n.props['data-kb'] === kb)
  const one = (tree, kb) => byKb(tree, kb)[0]
  const said = (tree) => tree.map(textOf).join(' ')

  const calls = []
  let answer = () => ({ ok: true })
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), method: (opts && opts.method) || 'GET', body: opts && opts.body ? JSON.parse(opts.body) : null })
    const r = answer(String(url))
    return { ok: r !== null, json: async () => r }
  }
  const timers = []
  const realTimeout = globalThis.setTimeout
  globalThis.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length }
  const stored = new Map()
  globalThis.window.localStorage = { getItem: (k) => (stored.has(k) ? stored.get(k) : null), setItem: (k, v) => { stored.set(k, String(v)) }, removeItem: (k) => { stored.delete(k) } }
  const opened = []
  globalThis.window.open = (u) => { opened.push(u) }
  const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)) }
  const press = async (tree, kb, arg) => { const n = one(tree, kb); if (n === undefined) throw new Error('no ' + kb); await n.props.onClick(arg); await flush() }

  const reset = () => {
    Object.assign(T.state, { view: null, pairing: null, starting: false, confirmDisc: false, showCode: false, copied: false, busy: '', computerError: '', remote: null, kybySid: null, where: null })
    Object.assign(T.state.wa, { pairing: null, starting: false, confirmDisc: false, showCode: false, copied: false })
    calls.length = 0; timers.length = 0; stored.clear(); opened.length = 0; answer = () => ({ ok: true })
    T.listeners.clear()
  }
  const set = (o) => {
    T.state.view = T.derive({ ok: true, connected: true,
      telegram: Object.assign({ configured: true, enabled: true, bot: 'kybernos_bot', linked: null }, o.tg || {}), whatsapp: o.wa,
      home: o.home === undefined ? null : o.home, computers: o.computers || [] }, o.srv || server)
  }
  const setK = (telegram, extra) => {
    T.state.view = T.derive(Object.assign({ ok: true, connected: true, telegram, home: null, computers: [] }, extra || {}), server)
  }
  const LINKED = { linked: { display: 'Amina (@alex)', linked_at: '2026-10-14T20:34:35.000Z', paused: false, blocked: false } }
  const soonFromNow = (s) => new Date(Date.now() + s * 1000).toISOString()
  const WAITING = () => ({ id: '0f3b1b72-1111-4222-8333-444455556666', link: 'https://t.me/kybernos_bot?start=pair_abc', bot: 'kybernos_bot', qr: { size: 21, modules: Array.from({ length: 21 }, (_, y) => '10101010101010101010' + String(y % 2)) }, expiresAt: soonFromNow(240), state: 'waiting', reason: null, sender: '', error: '' })

  // ── the strip: ONE line above the composer: the name, three chips that say how things stand, one button to the screen that sets them up ──
  const phoneOpens = []
  globalThis.window.__KB_MOBILE__ = { version: 3, open () { phoneOpens.push('open'); return true } }
  const REMOTE_READY = { ok: true, available: true, enabled: true, configured: true, devices: [] }
  reset(); set({ home: { id: 'aaaaaaaa-1111', name: 'Home', state: 'suspended', manual_control: true } }); T.state.remote = REMOTE_READY
  {
    const line = ui(T.views.Strip)
    ok('the strip is one line headed with the assistant\'s name: no tiles, no fold button, and it never opens by itself', textOf(one(line, 'kybernos-kyber-strip')).startsWith('Kaby') && byKb(line, 'kybernos-kyber-tile-channels').length === 0 && byKb(line, 'kybernos-kyber-computer').length === 0 && byKb(line, 'kybernos-kyber-strip-toggle').length === 0 && byKb(line, 'kybernos-kyber-pop').length === 0)
    ok('three chips: the remote control, Telegram and the computer, each a button that announces a list', ['kybernos-kyber-remote-chip', 'kybernos-kyber-status', 'kybernos-kyber-computer-chip'].every((k) => { const c = one(line, k); return c !== undefined && c.tag === 'button' && c.props['aria-haspopup'] === 'true' && c.props['aria-expanded'] === 'false' }))
    ok('the remote control reads « prêt » (on by default, ready to pair), Telegram says it is not connected (amber: it can be), the computer says what it is', textOf(one(line, 'kybernos-kyber-remote-chip')) === 'Contrôle à distance · prêt' && /ok/.test(one(line, 'kybernos-kyber-remote-chip').props.className) && textOf(one(line, 'kybernos-kyber-status')) === 'Telegram · inactif' && /warn/.test(one(line, 'kybernos-kyber-status').props.className) && /Home · En veille/.test(textOf(one(line, 'kybernos-kyber-computer-chip'))))
    ok('one button, « Régler… », opens the Phone and channels screen and calls no server', textOf(one(line, 'kybernos-kyber-open-phone')) === 'Régler…' && (await (async () => { phoneOpens.length = 0; calls.length = 0; await press(line, 'kybernos-kyber-open-phone'); return phoneOpens.length === 1 && calls.length === 0 })()))
    ok('it asks for no code, and draws none (the code lives on the Phone and channels screen)', T.state.pairing === null && byKb(line, 'kybernos-kyber-telegram').length === 0 && byKb(line, 'kybernos-kyber-qr').length === 0)
    set({ tg: LINKED, home: { id: 'aaaaaaaa-1111', name: 'Home', state: 'running', manual_control: true } })
    const on = ui(T.views.Strip)
    ok('connected: the Telegram chip is green and says so; an awake computer is green too', /ok/.test(one(on, 'kybernos-kyber-status').props.className) && textOf(one(on, 'kybernos-kyber-status')) === 'Telegram · actif' && /ok/.test(one(on, 'kybernos-kyber-computer-chip').props.className))
    T.state.remote = { ...REMOTE_READY, devices: [{ id: 'a' }] }
    ok('one phone linked: « 1 téléphone »', textOf(one(ui(T.views.Strip), 'kybernos-kyber-remote-chip')) === 'Contrôle à distance · 1 téléphone')
    T.state.remote = { ...REMOTE_READY, devices: [{ id: 'a' }, { id: 'b' }] }
    ok('two: « 2 téléphones »', textOf(one(ui(T.views.Strip), 'kybernos-kyber-remote-chip')) === 'Contrôle à distance · 2 téléphones')
    T.state.remote = { ...REMOTE_READY, enabled: false }
    ok('switched off: « désactivé », not green', textOf(one(ui(T.views.Strip), 'kybernos-kyber-remote-chip')) === 'Contrôle à distance · désactivé' && !/ok/.test(one(ui(T.views.Strip), 'kybernos-kyber-remote-chip').props.className))
    T.state.remote = { ...REMOTE_READY, configured: false }
    ok('a server that does not offer the phone link: « pas encore proposé »', textOf(one(ui(T.views.Strip), 'kybernos-kyber-remote-chip')) === 'Contrôle à distance · pas encore proposé')
    // L1-104 (recette 2026-10-25): a plan that does not include the phone link was drawn « prêt », in green, while the window « Set up… » opens said « Not included in your plan ».
    T.state.remote = { ...REMOTE_READY, entitled: false }
    {
      const chip = one(ui(T.views.Strip), 'kybernos-kyber-remote-chip')
      ok('a plan without the phone link: « hors de ton offre », not green, and never « prêt »', textOf(chip) === 'Contrôle à distance · hors de ton offre' && !/ok/.test(chip.props.className) && !/prêt/.test(textOf(chip)), textOf(chip))
      globalThis.window.__KB_LANG_RESOLVE__ = () => 'en'
      const en = textOf(one(ui(T.views.Strip), 'kybernos-kyber-remote-chip'))
      globalThis.window.__KB_LANG_RESOLVE__ = () => 'fr'
      ok('and in English', en === 'Remote control · not in your plan' && !/ready/.test(en), en)
      T.state.remote = { ...REMOTE_READY, entitled: false, devices: [{ id: 'a' }] }
      ok('even with a phone still linked from the earlier plan: the window shows the paywall first, so the strip says the same', textOf(one(ui(T.views.Strip), 'kybernos-kyber-remote-chip')) === 'Contrôle à distance · hors de ton offre')
      T.state.remote = { ...REMOTE_READY, entitled: false, enabled: false }
      ok('switched off AND not in the plan: « désactivé » (the window draws its « off » state before the paywall, so does the strip)', textOf(one(ui(T.views.Strip), 'kybernos-kyber-remote-chip')) === 'Contrôle à distance · désactivé')
      T.state.remote = { ...REMOTE_READY, entitled: false, configured: false }
      ok('a server that does not offer the phone link AND a plan without it: « pas encore proposé » (the window says that first)', textOf(one(ui(T.views.Strip), 'kybernos-kyber-remote-chip')) === 'Contrôle à distance · pas encore proposé')
      T.state.remote = { ...REMOTE_READY, entitled: false, connected: false }
      ok('signed out AND a plan without it: no claim about the plan (the window says « Sign in needed » first)', !/hors de ton offre/.test(textOf(one(ui(T.views.Strip), 'kybernos-kyber-remote-chip'))))
      for (const known of [true, null, undefined]) {
        T.state.remote = { ...REMOTE_READY, entitled: known }
        ok('entitled ' + known + ' (in the plan, or not known yet): « prêt » as before', textOf(one(ui(T.views.Strip), 'kybernos-kyber-remote-chip')) === 'Contrôle à distance · prêt')
      }
    }
    for (const none of [null, { ok: false }, { ok: true, available: false }]) {
      T.state.remote = none
      ok('no phone link on this DSH (' + JSON.stringify(none) + '): the strip says nothing of it, and still says the rest', byKb(ui(T.views.Strip), 'kybernos-kyber-remote-chip').length === 0 && byKb(ui(T.views.Strip), 'kybernos-kyber-computer-chip').length === 1)
    }
    T.state.view = T.derive({ ok: true, connected: false }, server)
    T.state.remote = REMOTE_READY
    const out = ui(T.views.Strip)
    ok('signed out: no Telegram chip (nothing to say), the remote control and this computer are still there', byKb(out, 'kybernos-kyber-status').length === 0 && byKb(out, 'kybernos-kyber-remote-chip').length === 1 && /Cet ordinateur · Prêt/.test(textOf(one(out, 'kybernos-kyber-computer-chip'))))
    delete globalThis.window.__KB_MOBILE__
    ok('without the bundle that draws the screen there is no button (never a dead one), the chips remain', byKb(ui(T.views.Strip), 'kybernos-kyber-open-phone').length === 0 && byKb(ui(T.views.Strip), 'kybernos-kyber-computer-chip').length === 1)
    globalThis.window.__KB_MOBILE__ = { version: 3, open () { phoneOpens.push('open'); return true } }

    // ── the name and the portrait the person gave Kaby (kybernos-kaby-customisation, through window.__KB_KABY__) ──
    ok('without that bundle the strip keeps the glyph and the product name, with no customise button', byKb(ui(T.views.Strip), 'kybernos-kyber-customise').length === 0 && textOf(one(ui(T.views.Strip), 'kybernos-kyber-strip')).startsWith('Kaby'))
    const kabyAsked = []
    globalThis.window.__KB_KABY__ = { profile: () => ({ name: 'Léa', portrait: null }), open () { kabyAsked.push('open'); return true } }
    {
      const mine = ui(T.views.Strip)
      const btn = one(mine, 'kybernos-kyber-customise')
      ok('with it, the strip heads with the name the person chose, in ONE button that says what it does', btn !== undefined && btn.tag === 'button' && btn.props['aria-label'] === 'Personnaliser Léa' && nodes([btn]).some((n) => n.tag === 'b' && textOf(n) === 'Léa') && textOf(one(mine, 'kybernos-kyber-strip')).includes('Léa'))
      ok('no portrait yet: the first letter of the name, drawn in a round monogram, and no image', byKb(mine, 'kybernos-kyber-portrait').length === 0 && nodes([btn]).some((n) => n.tag === 'text' && textOf(n) === 'L'))
      ok('a click opens Settings › Kaby, through the seam', (() => { kabyAsked.length = 0; btn.props.onClick(); return kabyAsked.length === 1 })())
      ok('the chips and the button of the strip are still there', byKb(mine, 'kybernos-kyber-computer-chip').length === 1 && byKb(mine, 'kybernos-kyber-open-phone').length === 1)
      globalThis.window.__KB_KABY__ = { profile: () => ({ name: 'Léa', portrait: { url: '/kybernos-kaby-customisation/portrait?v=1' } }), open () {} }
      const withPic = ui(T.views.Strip)
      const pic = one(withPic, 'kybernos-kyber-portrait')
      ok('with a portrait: the picture the host serves, round, with no alt text (the button already says it)', pic !== undefined && pic.tag === 'img' && pic.props.src === '/kybernos-kaby-customisation/portrait?v=1' && pic.props.alt === '')
      globalThis.window.__KB_KABY__ = { profile: () => { throw new Error('not ready') }, open () {} }
      ok('a seam that throws leaves the strip as it was, never breaks it', byKb(ui(T.views.Strip), 'kybernos-kyber-customise').length === 0 && textOf(one(ui(T.views.Strip), 'kybernos-kyber-strip')).startsWith('Kaby'))
      globalThis.window.__KB_KABY__ = { open () {} }
      ok('a seam without a profile reader is no seam', byKb(ui(T.views.Strip), 'kybernos-kyber-customise').length === 0)
    }
    delete globalThis.window.__KB_KABY__
    ok('the strip re-reads the profile when the bundle says it changed (window event kb-kaby-profile), and stops listening when it goes', /addEventListener\('kb-kaby-profile', again\)/.test(src) && /removeEventListener\('kb-kaby-profile', again\)/.test(src))
  }

  // ── the list the chips open (and the tab shows): the same three lines in words, each with one button to the screen that sets it up ──
  reset(); set({ home: null }); T.state.remote = REMOTE_READY
  {
    const tile = ui(T.views.StatusList)
    const row = one(tile, 'kybernos-kyber-tg-row')
    ok('the list says where Telegram stands (not connected), the remote control (ready) and the computer, in this order', row !== undefined && textOf(row).includes('Telegram') && textOf(row).includes('Pas connecté') && /Actif, prêt à relier un téléphone · aucun téléphone relié/.test(textOf(one(tile, 'kybernos-kyber-row-remote'))) && /Ordinateur de Kaby/.test(textOf(one(tile, 'kybernos-kyber-row-computer'))) && nodes(tile).map((n) => n.props['data-kb']).filter((k) => /^kybernos-kyber-(row-remote|tg-row|row-computer)$/.test(k)).join() === 'kybernos-kyber-row-remote,kybernos-kyber-tg-row,kybernos-kyber-row-computer')
    ok('it has no switch, no code, no link to the bot: the list shows states, it does not act', byKb(tile, 'kybernos-kyber-tg-switch').length === 0 && byKb(tile, 'kybernos-kyber-telegram').length === 0 && byKb(tile, 'kybernos-kyber-bot').length === 0 && byKb(tile, 'kybernos-kyber-tg-switch-server').length === 0)
    const buttons = nodes(tile).filter((n) => n.tag === 'button' || n.tag === 'a')
    ok('one button per line, all to the same screen: Régler…, Connecter (Telegram is not connected yet), Régler…', buttons.map((b) => textOf(b)).join() === 'Régler…,Connecter,Régler…', buttons.map((b) => textOf(b)))
    phoneOpens.length = 0
    await press(tile, 'kybernos-kyber-set-telegram')
    ok('each opens the window of the Phone and channels screen (kybernos-mobile\'s open), calling no server', phoneOpens.length === 1 && calls.length === 0)
    const was = globalThis.window.__KB_MOBILE__
    delete globalThis.window.__KB_MOBILE__
    const bare = ui(T.views.StatusList)
    ok('without the bundle that draws the screen there is no button (never a dead one), the states are still said', byKb(bare, 'kybernos-kyber-set-telegram').length === 0 && textOf(one(bare, 'kybernos-kyber-tg-row')).includes('Pas connecté'))
    globalThis.window.__KB_MOBILE__ = { version: 2, Dialog () {} }
    ok('an older bundle (no open) offers none either', byKb(ui(T.views.StatusList), 'kybernos-kyber-set-telegram').length === 0)
    globalThis.window.__KB_MOBILE__ = was
    set({ tg: LINKED, home: null })
    ok('connected: the row says who (Connecté : …) and the button is « Gérer »', textOf(one(ui(T.views.StatusList), 'kybernos-kyber-tg-row')).includes('Connecté : Amina (@alex)') && textOf(one(ui(T.views.StatusList), 'kybernos-kyber-set-telegram')) === 'Gérer')
    T.state.remote = { ...REMOTE_READY, entitled: false }
    {
      const locked = ui(T.views.StatusList)
      const line = one(locked, 'kybernos-kyber-row-remote')
      ok('a plan without the phone link: the list says « Non inclus dans ton offre » and nothing of « Actif » or « prêt », and the row is marked locked', textOf(line) === 'Contrôle à distance Non inclus dans ton offre Régler…' && !/Actif|prêt/.test(textOf(line)) && line.props['data-state'] === 'locked', textOf(line))
      ok('the tab, which is this list, says the same', textOf(one(ui(T.views.Pane), 'kybernos-kyber-row-remote')).includes('Non inclus dans ton offre'))
      globalThis.window.__KB_LANG_RESOLVE__ = () => 'en'
      const en = textOf(one(ui(T.views.StatusList), 'kybernos-kyber-row-remote'))
      globalThis.window.__KB_LANG_RESOLVE__ = () => 'fr'
      ok('in English: « Not included in your plan » (the words of the window)', en.includes('Not included in your plan') && !/On, ready|Actif/.test(en), en)
      ok('the list has no switch for it (it shows states, it does not act)', byKb(locked, 'kybernos-kyber-remote-switch').length === 0 && nodes(locked).filter((n) => n.props !== undefined && n.props.role === 'switch').length === 0)
    }
    T.state.remote = null
    ok('with no phone link on this DSH the list has no remote line', byKb(ui(T.views.StatusList), 'kybernos-kyber-row-remote').length === 0)
    ok('the tab is this list under the assistant\'s name, with the refresh button', (() => { const pane = ui(T.views.Pane); return byKb(pane, 'kybernos-kyber-status-list').length === 1 && byKb(pane, 'kybernos-kyber-refresh').length === 1 })())
  }

  // ── the column of the « Phone and channels » screen: the same doors, told honestly ──
  reset(); set({ home: null })
  {
    const col = ui(T.views.ChannelsColumn)
    const rowOf = (id) => one(col, 'kybernos-kyber-' + id)
    ok('the block is headed with the assistant\'s name and the tag « always asks first », leads with one sentence, and says in two lines what the messaging apps do (Kaby answers, computer off or not) and never do (control the computer)',
      textOf(one(col, 'kybernos-kyber-column-title')).startsWith('Kaby') && textOf(one(col, 'kybernos-kyber-column-tag')) === 'Demande toujours d’abord' && /Ton assistant\. Il te répond sur les messageries et travaille sur un ordinateur\./.test(textOf(one(col, 'kybernos-kyber-column-lead'))) && /Ce que ça fait/.test(textOf(one(col, 'kybernos-kyber-column-rights'))) && /même quand cet ordinateur est éteint/.test(said(col)) && /Jamais/.test(textOf(one(col, 'kybernos-kyber-column-rights'))) && /ne contrôle jamais cet ordinateur/.test(said(col)))
    ok('four rows in this order: Telegram, WhatsApp, WeChat, iMessage',
      (() => { const order = nodes(col).map((n) => n.props['data-kb']).filter((k) => ['kybernos-kyber-tg-row', 'kybernos-kyber-chan-whatsapp', 'kybernos-kyber-chan-wechat', 'kybernos-kyber-chan-imessage'].includes(k)); return order.join() === 'kybernos-kyber-tg-row,kybernos-kyber-chan-whatsapp,kybernos-kyber-chan-wechat,kybernos-kyber-chan-imessage' })())
    ok('WhatsApp is a beta, and says it is not available on this server (no server announces it)', /WhatsApp/.test(textOf(rowOf('chan-whatsapp'))) && /Bêta/.test(textOf(rowOf('chan-whatsapp'))) && /Pas encore disponible sur ce serveur/.test(textOf(rowOf('chan-whatsapp'))) && rowOf('chan-whatsapp').props['data-state'] === 'off')
    ok('WeChat and iMessage say « Bientôt »; iMessage says it is for Macs', /Bientôt/.test(textOf(rowOf('chan-wechat'))) && /Bientôt/.test(textOf(rowOf('chan-imessage'))) && /Réservé aux Mac/.test(textOf(rowOf('chan-imessage'))))
    ok('the three rows have a switch that is off, greyed and named; WeChat and iMessage have nothing behind it', ['whatsapp', 'wechat', 'imessage'].every((id) => { const sw = one(col, 'kybernos-kyber-' + id + '-switch'); return sw !== undefined && sw.props.role === 'switch' && sw.props['aria-checked'] === 'false' && sw.props.disabled === true && (id === 'whatsapp' || typeof sw.props.onClick !== 'function') }))
    calls.length = 0
    await press(col, 'kybernos-kyber-whatsapp-switch')
    ok('and WhatsApp\'s greyed switch asks for nothing even if it is pressed', calls.length === 0 && T.state.wa.pairing === null && T.state.wa.starting === false)
    ok('and nothing to press or follow on those rows: no button, no link', ['chan-whatsapp', 'chan-wechat', 'chan-imessage'].every((k) => walk(rowOf(k)).every((n) => (n.tag !== 'a') && (n.tag !== 'button' || n.props.role === 'switch'))))
    ok('« It does » says that several apps share one conversation and one memory', /une seule conversation et une seule mémoire/.test(textOf(one(col, 'kybernos-kyber-column-rights'))))
    ok('Telegram has the same row and the same working switch as in the strip', one(col, 'kybernos-kyber-tg-switch').props['aria-checked'] === 'false' && one(col, 'kybernos-kyber-tg-switch').props.disabled === false)
    // a server that has the door but whose bridge is not open: the row says so and stays greyed
    T.state.view = T.derive({ ok: true, connected: true, telegram: { configured: true, enabled: true, bot: 'kybernos_bot', linked: null }, whatsapp: { configured: true, enabled: true, available: false, linked: null }, home: null }, server)
    const ann = ui(T.views.ChannelsColumn)
    ok('a server whose WhatsApp bridge is not open: the row says the number is not reachable, and the switch stays greyed', /n’est pas joignable/.test(textOf(one(ann, 'kybernos-kyber-chan-whatsapp'))) && one(ann, 'kybernos-kyber-chan-whatsapp').props['data-state'] === 'closed' && one(ann, 'kybernos-kyber-whatsapp-switch').props.disabled === true)
    T.state.view = T.derive({ ok: true, connected: true, telegram: { configured: true, enabled: true, bot: 'kybernos_bot', linked: null }, whatsapp: { configured: true, enabled: true, available: true, linked: null }, home: null }, server)
    const idle = ui(T.views.ChannelsColumn)
    ok('with a bridge open the row is « Pas connecté » and the switch can be turned on', /Pas connecté/.test(textOf(one(idle, 'kybernos-kyber-chan-whatsapp'))) && one(idle, 'kybernos-kyber-chan-whatsapp').props['data-state'] === 'idle' && one(idle, 'kybernos-kyber-whatsapp-switch').props.disabled === false)
    T.state.view = T.derive({ ok: true, connected: true, telegram: { configured: true, enabled: true, bot: 'kybernos_bot', linked: null }, whatsapp: { configured: true, enabled: false }, home: null }, server)
    ok('a WhatsApp that is configured but not enabled is not announced', T.state.view.whatsapp.state === 'off')
  }
  reset(); set({ tg: { configured: false, enabled: false, bot: null }, home: null, srv: server })
  {
    const col = ui(T.views.ChannelsColumn)
    ok('on a server with no Telegram bot the column says why, on the row, and the switch is greyed', /n’a pas de bot Telegram/.test(textOf(one(col, 'kybernos-kyber-tg-row'))) && one(col, 'kybernos-kyber-tg-switch').props.disabled === true)
    T.state.view = T.derive({ ok: true, connected: false }, server)
    const out = ui(T.views.ChannelsColumn)
    ok('signed out: the column keeps its heading, asks to sign in, and lists no channel', textOf(one(out, 'kybernos-kyber-column-title')).startsWith('Kaby') && /Connecte-toi à Kybernos/.test(said(out)) && byKb(out, 'kybernos-kyber-tg-row').length === 0)
    T.state.view = null
    ok('before anything was read it says it is reading', /Lecture/.test(said(ui(T.views.ChannelsColumn))))
  }
  reset(); set({ home: null })
  answer = (u) => (u.endsWith('/telegram/pairing') ? { ok: true, id: '0f3b1b72-1111-4222-8333-444455556666', link: 'https://t.me/kybernos_bot?start=pair_abc', bot: 'kybernos_bot', expires_at: soonFromNow(300), qr: { size: 21, modules: Array.from({ length: 21 }, () => '101010101010101010101') } } : { ok: true })
  {
    await press(ui(T.views.ChannelsColumn), 'kybernos-kyber-tg-switch')
    ok('from the column the switch asks the host for a code, one POST, as in the strip', calls.length === 1 && calls[0].method === 'POST' && calls[0].url === '/kybernos-cloud/telegram/pairing', JSON.stringify(calls))
    const col = ui(T.views.ChannelsColumn)
    const order = nodes(col).map((n) => n.props['data-kb'])
    ok('the code (QR, steps, the bot link) sits right under the Telegram row and above WhatsApp', byKb(col, 'kybernos-kyber-qr').length === 1 && one(col, 'kybernos-kyber-open').props.href === 'https://t.me/kybernos_bot?start=pair_abc' && order.indexOf('kybernos-kyber-telegram') > order.indexOf('kybernos-kyber-tg-row') && order.indexOf('kybernos-kyber-telegram') < order.indexOf('kybernos-kyber-chan-whatsapp'))
    ok('the list the strip opens says the same thing (one pairing, wherever it is looked at), and draws none of the code', /Code à scanner/.test(textOf(one(ui(T.views.StatusList), 'kybernos-kyber-tg-row'))) && byKb(ui(T.views.StatusList), 'kybernos-kyber-qr').length === 0 && byKb(ui(T.views.Strip), 'kybernos-kyber-qr').length === 0)
    calls.length = 0
    await press(col, 'kybernos-kyber-tg-switch')
    ok('and the same switch cancels it', calls.length === 1 && calls[0].url === '/kybernos-cloud/telegram/pairing/cancel' && byKb(ui(T.views.ChannelsColumn), 'kybernos-kyber-telegram').length === 0)
  }
  ok('the seam hands the column to the screen that draws it', /ChannelsColumn,\n/.test(src) && /window\.__KB_KYBER__ = \{/.test(src))
  reset(); set({ home: null })

  // ── turning Telegram on: the code is asked for now, shown under Telegram's row on the screen, polled, and cancelled by the same switch ──
  reset(); set({ home: null })
  answer = (u) => (u.endsWith('/telegram/pairing') ? { ok: true, id: '0f3b1b72-1111-4222-8333-444455556666', link: 'https://t.me/kybernos_bot?start=pair_abc', bot: 'kybernos_bot', expires_at: soonFromNow(300), qr: { size: 21, modules: Array.from({ length: 21 }, () => '101010101010101010101') } } : { ok: true })
  {
    await press(ui(T.views.ChannelsColumn), 'kybernos-kyber-tg-switch')
    ok('the switch asks the host for a code (one POST), nothing else', calls.length === 1 && calls[0].method === 'POST' && calls[0].url === '/kybernos-cloud/telegram/pairing', JSON.stringify(calls))
    ok('and the pairing is then polled', T.state.pairing !== null && T.state.pairing.state === 'waiting' && timers.some((x) => x.ms === 2000))
    const strip = ui(T.views.ChannelsColumn)
    const panel = one(strip, 'kybernos-kyber-telegram')
    ok('the code is shown on the screen, under the Telegram row: QR, three steps, the bot\'s link, the time left', panel !== undefined && panel.props['data-state'] === 'waiting' && byKb(strip, 'kybernos-kyber-qr').length === 1 && nodes(strip).filter((n) => n.tag === 'li').length === 3 && one(strip, 'kybernos-kyber-open').props.href === 'https://t.me/kybernos_bot?start=pair_abc' && /Expire dans \d:\d\d/.test(textOf(one(strip, 'kybernos-kyber-left'))))
    ok('the panel sits right under the Telegram row, and the strip and its list draw none of it', (() => { const order = nodes(strip).map((n) => n.props['data-kb']); return order.indexOf('kybernos-kyber-telegram') === order.indexOf('kybernos-kyber-tg-row') + order.slice(order.indexOf('kybernos-kyber-tg-row')).findIndex((k) => k === 'kybernos-kyber-telegram') && byKb(ui(T.views.StatusList), 'kybernos-kyber-telegram').length === 0 && byKb(ui(T.views.Strip), 'kybernos-kyber-telegram').length === 0 })())
    const sw = one(strip, 'kybernos-kyber-tg-switch')
    ok('the switch is on and the row says what is expected of the person', sw.props['aria-checked'] === 'true' && textOf(one(strip, 'kybernos-kyber-tg-row')).includes('Code à scanner'))
    calls.length = 0
    await press(strip, 'kybernos-kyber-tg-switch')
    ok('the same switch cancels the code: the host is told, the panel goes', calls.length === 1 && calls[0].url === '/kybernos-cloud/telegram/pairing/cancel' && calls[0].body.id === '0f3b1b72-1111-4222-8333-444455556666' && T.state.pairing === null && byKb(ui(T.views.ChannelsColumn), 'kybernos-kyber-telegram').length === 0)
  }
  {
    // the person scanned: the panel names who and waits
    reset(); set({ home: null })
    T.state.pairing = Object.assign(WAITING(), { state: 'scanned', sender: 'Amina (@alex)' })
    const strip = ui(T.views.ChannelsColumn)
    ok('scanned: the sender is named, the person is asked to confirm in Telegram, and can say it is not them', one(strip, 'kybernos-kyber-telegram').props['data-state'] === 'scanned' && /Amina \(@alex\)/.test(said(strip)) && byKb(strip, 'kybernos-kyber-qr').length === 0 && one(strip, 'kybernos-kyber-cancel') !== undefined && textOf(one(strip, 'kybernos-kyber-tg-row')).includes('En attente de ton accord'))
  }
  for (const [name, pairing, state, retry, row] of [
    ['expired', { id: 'x', state: 'expired' }, 'expired', true, 'Code expiré'],
    ['refused in Telegram', { id: 'x', state: 'declined', reason: 'user' }, 'declined', true, 'Refusé dans Telegram'],
    ['taken by another account', { id: 'x', state: 'declined', reason: 'taken' }, 'taken', true, 'Déjà utilisé par un autre compte'],
    ['the bot already made the account', { id: 'x', state: 'declined', reason: 'botmade' }, 'botmade', false, 'Compte déjà créé par le bot'],
    ['too many tries', { error: 'rate_limited' }, 'error', true, 'Impossible de préparer le code'],
    ['the door is off on this server', { error: 'not_found' }, 'off', false, 'Ce serveur n’a pas de bot Telegram'],
    ['a server too old for the pairing routes', { error: 'unsupported' }, 'old', false, 'Ce serveur ne sait pas encore relier Telegram'],
  ]) {
    reset(); set({ home: null }); T.state.pairing = pairing
    const strip = ui(T.views.ChannelsColumn)
    const panel = one(strip, 'kybernos-kyber-telegram')
    ok('a code that ended: ' + name + ' → its own panel' + (retry ? ' with a new code' : ' without one') + ', and its row says it', panel !== undefined && panel.props['data-state'] === state && (one(strip, 'kybernos-kyber-retry') !== undefined) === retry && textOf(one(strip, 'kybernos-kyber-tg-row')).includes(row), textOf(one(strip, 'kybernos-kyber-tg-row')))
  }
  {
    reset(); set({ home: null }); T.state.pairing = { id: 'x', state: 'expired' }
    answer = () => ({ ok: true, id: '0f3b1b72-1111-4222-8333-444455556666', link: 'https://t.me/kybernos_bot?start=pair_new', bot: 'kybernos_bot', expires_at: soonFromNow(300), qr: { size: 21, modules: Array.from({ length: 21 }, () => '101010101010101010101') } })
    await press(ui(T.views.ChannelsColumn), 'kybernos-kyber-tg-switch')
    ok('after an expiry the switch is off, and turning it on again makes a new code', calls.length === 1 && T.state.pairing !== null && T.state.pairing.state === 'waiting' && /pair_new/.test(T.state.pairing.link))
  }

  // ── nothing arrives: the page says what to do (Start, or Restart on a bot already used), shows the message to send, and renews the code by itself a few times ──
  {
    ok('the second step says Start, or Restart for a bot the person already used', /Démarrer/.test(T.L('s2')) && /Redémarrer/.test(T.L('s2')), T.L('s2'))
    reset(); set({ home: null })
    T.state.pairing = Object.assign(WAITING(), { startedAt: Date.now() - 2000 })
    const fresh = ui(T.views.ChannelsColumn)
    ok('a fresh code has no extra help and keeps the message to send folded', one(fresh, 'kybernos-kyber-stuck') === undefined && one(fresh, 'kybernos-kyber-code-box') === undefined)
    ok('the app link opens Telegram itself on this computer (tg://), the web link stays the main button', one(fresh, 'kybernos-kyber-open-app').props.href === 'tg://resolve?domain=kybernos_bot&start=pair_abc' && one(fresh, 'kybernos-kyber-open').props.href === 'https://t.me/kybernos_bot?start=pair_abc')
    T.state.pairing = Object.assign(WAITING(), { startedAt: Date.now() - 30000 })
    const late = ui(T.views.ChannelsColumn)
    const help = one(late, 'kybernos-kyber-stuck')
    ok('after 20 s with no Start the panel says what to do: tap Start or Restart in the chat, or send the message', help !== undefined && /Démarrer/.test(textOf(help)) && /Redémarrer/.test(textOf(help)) && /@kybernos_bot/.test(textOf(help)), help && textOf(help))
    ok('the fold button is gone while the help is there (the message sits right under it)', one(late, 'kybernos-kyber-code') === undefined && one(fresh, 'kybernos-kyber-code') !== undefined)
    ok('and the message to send is already shown, ready to copy, without a click', one(late, 'kybernos-kyber-code-box') !== undefined && textOf(one(late, 'kybernos-kyber-code-text')) === '/start pair_abc' && one(late, 'kybernos-kyber-code-copy') !== undefined)
    T.state.pairing = Object.assign(WAITING(), { startedAt: Date.now() - 30000, state: 'scanned', sender: 'Amina (@alex)' })
    ok('once scanned there is no stuck help (the person has pressed Start)', one(ui(T.views.ChannelsColumn), 'kybernos-kyber-stuck') === undefined)

    // The code renews by itself, with the old one cancelled, while the page is open and in view; three times at most; never a scanned one.
    const NEW_ID = '9a8b7c6d-1111-4222-8333-444455556666'
    const QR = { size: 21, modules: Array.from({ length: 21 }, () => '101010101010101010101') }
    const expiredCode = (extra) => Object.assign(WAITING(), { expiresAt: new Date(Date.now() - 1000).toISOString(), startedAt: Date.now() - 301000 }, extra || {})
    const renewing = () => { answer = (u) => (u.includes('/pairing/state') ? { ok: true, state: 'waiting', reason: null, sender: '' } : u.endsWith('/telegram/pairing') ? { ok: true, id: NEW_ID, link: 'https://t.me/kybernos_bot?start=pair_new', bot: 'kybernos_bot', expires_at: soonFromNow(300), qr: QR } : { ok: true }) }
    reset(); set({ home: null }); renewing()
    T.listeners.add(() => {})
    T.state.pairing = expiredCode(); T.state.renewals = 0
    await T.actions.pairPoll('telegram'); await flush()
    ok('an expired code on an open page is cancelled and replaced, in that order', calls.map((c) => c.method + ' ' + c.url.replace('/kybernos-cloud/telegram', '')).join(' | ') === 'GET /pairing/state?id=0f3b1b72-1111-4222-8333-444455556666 | POST /pairing/cancel | POST /pairing' && calls[1].body.id === '0f3b1b72-1111-4222-8333-444455556666', calls.map((c) => c.method + c.url).join(' | '))
    ok('the new code is the one shown, polled again, and counted', T.state.pairing !== null && T.state.pairing.id === NEW_ID && T.state.pairing.state === 'waiting' && T.state.renewals === 1 && typeof T.state.pairing.startedAt === 'number' && timers.some((x) => x.ms === 2000))
    reset(); set({ home: null }); renewing()
    T.listeners.add(() => {})
    T.state.pairing = expiredCode(); T.state.renewals = 3
    await T.actions.pairPoll('telegram'); await flush()
    ok('after three renewals it stops: the code is shown as expired with the button for a new one, and nothing more is asked', calls.every((c) => c.method === 'GET') && T.state.pairing.state === 'expired' && one(ui(T.views.ChannelsColumn), 'kybernos-kyber-retry') !== undefined && !timers.some((x) => x.ms === 2000), calls.map((c) => c.method + c.url).join(' | '))
    reset(); set({ home: null }); renewing()
    T.listeners.add(() => {})
    T.state.pairing = expiredCode({ state: 'scanned', sender: 'Amina (@alex)' }); T.state.renewals = 0
    answer = (u) => (u.includes('/pairing/state') ? { ok: true, state: 'scanned', reason: null, sender: 'Amina (@alex)' } : { ok: true })
    await T.actions.pairPoll('telegram'); await flush()
    ok('a code that was scanned is never replaced under the person\'s hand', !calls.some((c) => c.method === 'POST') && T.state.renewals === 0, calls.map((c) => c.method + c.url).join(' | '))
    reset(); set({ home: null }); renewing()
    T.listeners.add(() => {})
    T.state.pairing = expiredCode(); T.state.renewals = 0
    globalThis.document.visibilityState = 'hidden'
    await T.actions.pairPoll('telegram'); await flush()
    globalThis.document.visibilityState = 'visible'
    ok('a page that is not in view does not renew (it would make a code nobody sees)', !calls.some((c) => c.method === 'POST'), calls.map((c) => c.method + c.url).join(' | '))
    reset(); set({ home: null }); renewing()
    T.state.pairing = { id: 'x', state: 'expired' }; T.state.renewals = 3
    await press(ui(T.views.ChannelsColumn), 'kybernos-kyber-tg-switch')
    ok('the person turning the switch on again starts the count over', T.state.renewals === 0 && T.state.pairing !== null && T.state.pairing.id === NEW_ID)
  }

  // ── WhatsApp: the same pairing as Telegram's, on its own routes and its own state; the code is the wa.me link with the message typed, and the last step is « answer 1 » ──
  {
    const WA_LINK = 'https://wa.me/33600000012?text=pair_abc'
    const WA_ID = '1a2b3c4d-1111-4222-8333-444455556666'
    const qr = { size: 21, modules: Array.from({ length: 21 }, () => '101010101010101010101') }
    const w = (o) => T.derive({ ok: true, connected: true, telegram: null, whatsapp: o, home: null }, server).whatsapp
    ok('WhatsApp in the model: no door, or a door off, is off', w(undefined).state === 'off' && w(null).state === 'off' && w({ configured: true, enabled: false, available: true, linked: null }).state === 'off' && w({ configured: false, enabled: true, available: true, linked: null }).state === 'off')
    ok('a door with no bridge open is closed, with one open it is unlinked', w({ configured: true, enabled: true, available: false, linked: null }).state === 'closed' && w({ configured: true, enabled: true, available: true, linked: null }).state === 'unlinked')
    ok('linked: the name and the pause are carried, and a link wins over a bridge that is down', (() => { const l = w({ configured: true, enabled: true, available: false, linked: { display: 'Amina', linked_at: '2026-10-20T10:00:00.000Z', paused: true } }); return l.state === 'linked' && l.name === 'Amina' && l.paused === true })())

    reset(); set({ home: null, wa: { configured: true, enabled: true, available: true, linked: null } })
    answer = (u) => (u.endsWith('/whatsapp/pairing') ? { ok: true, id: WA_ID, link: WA_LINK, number: '33600000012', expires_at: soonFromNow(300), qr } : { ok: true })
    await press(ui(T.views.ChannelsColumn), 'kybernos-kyber-whatsapp-switch')
    ok('turning WhatsApp on asks the host for a code on WhatsApp\'s route, one POST, and Telegram is left alone', calls.length === 1 && calls[0].method === 'POST' && calls[0].url === '/kybernos-cloud/whatsapp/pairing' && T.state.pairing === null && T.state.starting === false, JSON.stringify(calls))
    ok('and that pairing is polled', T.state.wa.pairing !== null && T.state.wa.pairing.state === 'waiting' && timers.some((x) => x.ms === 2000))
    {
      const col = ui(T.views.ChannelsColumn)
      const panel = one(col, 'kybernos-kyber-whatsapp')
      ok('the code is shown under WhatsApp\'s row: QR, three steps, the wa.me link, the time left; none of it for Telegram', panel !== undefined && panel.props['data-state'] === 'waiting' && byKb(col, 'kybernos-kyber-qr').length === 1 && nodes(col).filter((n) => n.tag === 'li').length === 3 && one(col, 'kybernos-kyber-wa-open').props.href === WA_LINK && /Expire dans/.test(textOf(one(col, 'kybernos-kyber-wa-left'))) && byKb(col, 'kybernos-kyber-telegram').length === 0)
      ok('the steps say to send the typed message and to answer 1', /message déjà écrit/.test(textOf(panel)) && /Réponds 1/.test(textOf(panel)) && !/Telegram/.test(textOf(panel)))
      ok('the row says what is expected and the switch is on', textOf(one(col, 'kybernos-kyber-chan-whatsapp')).includes('Code à scanner') && one(col, 'kybernos-kyber-whatsapp-switch').props['aria-checked'] === 'true' && one(col, 'kybernos-kyber-tg-switch').props['aria-checked'] === 'false')
      const order = nodes(col).map((n) => n.props['data-kb'])
      ok('the panel sits between WhatsApp\'s row and WeChat\'s', order.indexOf('kybernos-kyber-whatsapp') > order.indexOf('kybernos-kyber-chan-whatsapp') && order.indexOf('kybernos-kyber-whatsapp') < order.indexOf('kybernos-kyber-chan-wechat'))
      // the poll reads WhatsApp's own state route (a poll runs only while a view listens)
      T.listeners.add(() => {})
      calls.length = 0
      answer = (u) => (u.includes('/whatsapp/pairing/state') ? { ok: true, state: 'scanned', reason: null, sender: 'Amina' } : { ok: true })
      timers.find((x) => x.ms === 2000).fn(); await flush()
      ok('the poll asks WhatsApp\'s state route with the pairing\'s id', calls.length === 1 && calls[0].method === 'GET' && calls[0].url === '/kybernos-cloud/whatsapp/pairing/state?id=' + WA_ID, JSON.stringify(calls))
      const sc = ui(T.views.ChannelsColumn)
      ok('scanned: the sender is named, the person is asked to answer in WhatsApp, the QR is gone', one(sc, 'kybernos-kyber-whatsapp').props['data-state'] === 'scanned' && /Amina/.test(textOf(one(sc, 'kybernos-kyber-whatsapp'))) && /Réponds 1/.test(textOf(one(sc, 'kybernos-kyber-whatsapp'))) && byKb(sc, 'kybernos-kyber-qr').length === 0 && /En attente de ta réponse/.test(textOf(one(sc, 'kybernos-kyber-chan-whatsapp'))))
      // done: the pairing is dropped and the state is read again
      calls.length = 0
      answer = (u) => (u.includes('/whatsapp/pairing/state') ? { ok: true, state: 'done', reason: null, sender: 'Amina' } : { ok: true })
      timers.filter((x) => x.ms === 2000 || x.ms === 6000).slice(-1)[0].fn(); await flush()
      ok('done: the pairing is dropped and the page reads the state again', T.state.wa.pairing === null && calls.some((c) => c.url === '/kybernos-cloud/kyber'), JSON.stringify(calls.map((c) => c.url)))
    }
    // the code written by hand: the message to the number, with the token of THIS pairing
    reset(); set({ home: null, wa: { configured: true, enabled: true, available: true, linked: null } })
    T.state.wa.pairing = { id: WA_ID, link: WA_LINK, number: '33600000012', qr, expiresAt: soonFromNow(240), state: 'waiting', reason: null, sender: '', error: '' }
    {
      const clip = []
      Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async (v) => { clip.push(v) } } }, configurable: true, writable: true })
      const before = ui(T.views.ChannelsColumn)
      ok('a waiting WhatsApp code offers « write a code instead », closed at first', one(before, 'kybernos-kyber-wa-code').props['aria-expanded'] === 'false' && byKb(before, 'kybernos-kyber-wa-code-box').length === 0)
      await press(before, 'kybernos-kyber-wa-code')
      const opened = ui(T.views.ChannelsColumn)
      ok('opened: the number to write to and the message, with the token of THIS pairing', textOf(one(opened, 'kybernos-kyber-wa-code-box')).includes('+33600000012') && textOf(one(opened, 'kybernos-kyber-wa-code-text')) === 'pair_abc' && T.state.showCode === false && T.state.wa.showCode === true)
      await press(opened, 'kybernos-kyber-wa-code-copy')
      ok('copy puts the message on the clipboard and says so', clip.length === 1 && clip[0] === 'pair_abc' && textOf(one(ui(T.views.ChannelsColumn), 'kybernos-kyber-wa-code-copy')) === 'Copié')
      T.state.wa.pairing = Object.assign({}, T.state.wa.pairing, { number: '' })
      ok('a pairing with no number offers no code (nothing invented)', byKb(ui(T.views.ChannelsColumn), 'kybernos-kyber-wa-code').length === 0)
      T.state.wa.pairing = Object.assign({}, T.state.wa.pairing, { number: '33600000012' })
      calls.length = 0
      await press(ui(T.views.ChannelsColumn), 'kybernos-kyber-wa-cancel')
      ok('cancelling tells the host on WhatsApp\'s route and closes the box with it', calls.length === 1 && calls[0].url === '/kybernos-cloud/whatsapp/pairing/cancel' && calls[0].body.id === WA_ID && T.state.wa.pairing === null && T.state.wa.showCode === false)
    }
    // what ended a code
    for (const [name, pairing, state, retry, row] of [
      ['expired', { id: 'x', state: 'expired' }, 'expired', true, 'Code expiré'],
      ['refused in WhatsApp', { id: 'x', state: 'declined', reason: 'user' }, 'declined', true, 'Refusé dans WhatsApp'],
      ['taken by another account', { id: 'x', state: 'declined', reason: 'taken' }, 'taken', true, 'Déjà utilisé par un autre compte'],
      ['too many tries', { error: 'rate_limited' }, 'error', true, 'Impossible de préparer le code'],
      ['no bridge is open any more', { error: 'not_found' }, 'closed', true, 'n’est pas joignable'],
    ]) {
      reset(); set({ home: null, wa: { configured: true, enabled: true, available: true, linked: null } }); T.state.wa.pairing = pairing
      const col = ui(T.views.ChannelsColumn)
      const panel = one(col, 'kybernos-kyber-whatsapp')
      ok('a WhatsApp code that ended: ' + name + ' → its own panel' + (retry ? ' with a new code' : '') + ', and its row says it', panel !== undefined && panel.props['data-state'] === state && (one(col, 'kybernos-kyber-wa-retry') !== undefined) === retry && textOf(one(col, 'kybernos-kyber-chan-whatsapp')).includes(row) && !/Telegram|bot/.test(textOf(panel)), textOf(panel))
    }
    {
      // the bridge was closed between the page and the click: the host answers not_found, and the page reads the state again (the row becomes « not reachable »)
      reset(); set({ home: null, wa: { configured: true, enabled: true, available: true, linked: null } })
      answer = (u) => (u.endsWith('/whatsapp/pairing') ? { ok: false, error: 'not_found' } : { ok: true, connected: true, telegram: null, whatsapp: { configured: true, enabled: true, available: false, linked: null } })
      await press(ui(T.views.ChannelsColumn), 'kybernos-kyber-whatsapp-switch')
      ok('a refused start (no bridge) reads the state again and says why', calls.some((c) => c.url === '/kybernos-cloud/kyber') && T.state.wa.pairing !== null && T.state.wa.pairing.error === 'not_found')
    }
    // connected: the row says who and the 24-hour rule; the switch asks before it disconnects, on WhatsApp's route
    reset(); set({ home: null, wa: { configured: true, enabled: true, available: true, linked: { display: 'Amina', linked_at: '2026-10-20T10:00:00.000Z', paused: false } } })
    {
      const col = ui(T.views.ChannelsColumn)
      ok('connected: the row says who and that Kaby answers within 24 hours', /Connecté : Amina/.test(textOf(one(col, 'kybernos-kyber-chan-whatsapp'))) && /24 h/.test(textOf(one(col, 'kybernos-kyber-chan-whatsapp'))) && one(col, 'kybernos-kyber-whatsapp-switch').props['aria-checked'] === 'true' && byKb(col, 'kybernos-kyber-whatsapp').length === 0)
      await press(col, 'kybernos-kyber-whatsapp-switch')
      const ask = ui(T.views.ChannelsColumn)
      ok('turning it off asks first: nothing is sent, and the question is about WhatsApp', calls.length === 0 && T.state.wa.confirmDisc === true && T.state.confirmDisc === false && /Déconnecter WhatsApp/.test(textOf(one(ask, 'kybernos-kyber-whatsapp'))))
      await press(ask, 'kybernos-kyber-wa-unlink-no')
      ok('« Annuler » leaves it connected and sends nothing', T.state.wa.confirmDisc === false && calls.length === 0 && byKb(ui(T.views.ChannelsColumn), 'kybernos-kyber-whatsapp').length === 0)
      await press(ui(T.views.ChannelsColumn), 'kybernos-kyber-whatsapp-switch')
      answer = (u) => (u.endsWith('/whatsapp/unlink') ? { ok: true } : { ok: true, connected: true, telegram: null, whatsapp: { configured: true, enabled: true, available: true, linked: null } })
      await press(ui(T.views.ChannelsColumn), 'kybernos-kyber-wa-unlink-yes')
      ok('« Confirmer » disconnects on WhatsApp\'s route (one POST) and the state is read again', calls.filter((c) => c.method === 'POST').length === 1 && calls.find((c) => c.method === 'POST').url === '/kybernos-cloud/whatsapp/unlink' && calls.some((c) => c.url === '/kybernos-cloud/kyber'))
    }
    reset(); set({ home: null, wa: { configured: true, enabled: true, available: true, linked: { display: 'Amina', linked_at: '2026-10-20T10:00:00.000Z', paused: true } } })
    ok('paused: the row says how to resume, in WhatsApp\'s own words', /resume/.test(textOf(one(ui(T.views.ChannelsColumn), 'kybernos-kyber-chan-whatsapp'))) && !/\/resume/.test(textOf(one(ui(T.views.ChannelsColumn), 'kybernos-kyber-chan-whatsapp'))))
    {
      // the two doors do not share a pairing: a Telegram code in flight does not show on WhatsApp's row, nor the other way round
      reset(); set({ home: null, wa: { configured: true, enabled: true, available: true, linked: null } })
      T.state.pairing = WAITING()
      const col = ui(T.views.ChannelsColumn)
      ok('a Telegram code in flight leaves WhatsApp\'s row idle and draws no WhatsApp panel', /Pas connecté/.test(textOf(one(col, 'kybernos-kyber-chan-whatsapp'))) && byKb(col, 'kybernos-kyber-whatsapp').length === 0 && one(col, 'kybernos-kyber-telegram') !== undefined)
    }
    reset()
  }

  // ── a connected chat: the switch asks before it disconnects ──
  reset(); set({ tg: LINKED, home: null }); T.state.stripPref = true
  {
    const strip = ui(T.views.ChannelsColumn)
    const sw = one(strip, 'kybernos-kyber-tg-switch')
    ok('connected: the switch is on, the row names the chat, the bot has its link', sw.props['aria-checked'] === 'true' && textOf(one(strip, 'kybernos-kyber-tg-row')).includes('Amina (@alex)') && one(strip, 'kybernos-kyber-bot').props.href === 'https://t.me/kybernos_bot' && byKb(strip, 'kybernos-kyber-telegram').length === 0)
    await press(strip, 'kybernos-kyber-tg-switch')
    const asking = ui(T.views.ChannelsColumn)
    ok('turning it off does not disconnect: it asks first, and nothing is sent', calls.length === 0 && one(asking, 'kybernos-kyber-telegram').props['data-state'] === 'disconnect' && one(asking, 'kybernos-kyber-unlink-yes') !== undefined)
    await press(asking, 'kybernos-kyber-unlink-no')
    ok('cancelling closes the question and sends nothing', calls.length === 0 && T.state.confirmDisc === false && byKb(ui(T.views.ChannelsColumn), 'kybernos-kyber-telegram').length === 0)
    await press(ui(T.views.ChannelsColumn), 'kybernos-kyber-tg-switch')
    await press(ui(T.views.ChannelsColumn), 'kybernos-kyber-unlink-yes')
    ok('confirming disconnects, once, with the confirmation the host asks for', calls.some((c) => c.url === '/kybernos-cloud/telegram/unlink' && c.body.confirm === true) && calls.filter((c) => c.url === '/kybernos-cloud/telegram/unlink').length === 1 && T.state.confirmDisc === false)
  }
  {
    reset(); set({ tg: Object.assign({}, LINKED, { linked: Object.assign({}, LINKED.linked, { paused: true }) }), home: null })
    const row = one(ui(T.views.ChannelsColumn), 'kybernos-kyber-tg-row')
    ok('a paused chat says so in its row, as a warning', textOf(row).includes('En pause') && walk(row).some((n) => n.tag === 'span' && /warn/.test(n.props.className || '')))
  }

  // ── the three states of the Telegram door: a bot, no bot on this server, a server too old for the pairing routes (the owner, 2026-10-16) ──
  {
    const BOT = { configured: true, enabled: true, bot: 'kybernos_bot', linked: null }
    const NOBOT = { configured: false, enabled: false, bot: null, linked: null }
    const SRV = { name: 'Kybernos (local)', host: 'localhost:8791', can_switch: true }
    const events = []
    globalThis.window.dispatchEvent = (e) => { events.push(e.type); return true }
    const stateOf = (view) => view.telegram.state
    // the model: three states, and which one wins
    ok('a bot there: the door is offered', (setK(BOT, { pairing: 'supported', server: SRV }), stateOf(T.state.view)) === 'unlinked')
    ok('no bot on this server: off', (setK(NOBOT, { pairing: 'supported', server: SRV }), stateOf(T.state.view)) === 'off')
    ok('a server too old for the pairing routes: old, whether or not its door answered', (setK(null, { pairing: 'unsupported', server: SRV }), stateOf(T.state.view)) === 'old' && (setK(BOT, { pairing: 'unsupported', server: SRV }), stateOf(T.state.view)) === 'old')
    ok('no bot AND too old reads « no bot »: the answer that tells where to go', (setK(NOBOT, { pairing: 'unsupported', server: SRV }), stateOf(T.state.view)) === 'off')
    ok('a host that says nothing (older host, unreadable): as before, nothing is claimed', (setK(BOT), stateOf(T.state.view)) === 'unlinked' && (setK(null), stateOf(T.state.view)) === 'off' && (setK(BOT, { pairing: 'unknown' }), stateOf(T.state.view)) === 'unlinked')

    // what each state shows
    const rowOf = () => { const t = ui(T.views.ChannelsColumn); return { tile: t, row: one(t, 'kybernos-kyber-tg-row'), sw: one(t, 'kybernos-kyber-tg-switch'), btn: one(t, 'kybernos-kyber-tg-switch-server') } }
    reset(); setK(BOT, { pairing: 'supported', server: SRV })
    {
      const r = rowOf()
      ok('bot present: the switch works, and no explanation or server button is in the way', r.sw.props.disabled === false && r.btn === undefined && !/serveur/.test(textOf(r.row)))
    }
    reset(); setK(NOBOT, { pairing: 'supported', server: SRV })
    {
      const r = rowOf()
      ok('no bot: one sentence says why and what to do, the switch stays greyed', textOf(r.row).includes('Ce serveur n’a pas de bot Telegram. Passe sur un serveur qui en a un, comme Kybernos Cloud.') && r.sw.props.disabled === true && r.row.props['data-state'] === 'off')
      ok('no bot, another server registered: a « Changer de serveur » button', r.btn !== undefined && textOf(r.btn) === 'Changer de serveur')
      events.length = 0; calls.length = 0
      await r.btn.props.onClick()
      ok('and it asks for Settings › Servers (the footer\'s window event), calling no server', events.length === 1 && events[0] === 'kybernos-cloud:servers' && calls.length === 0, events)
      await r.sw.props.onClick()
      ok('the greyed switch asks for nothing even if it is pressed', calls.length === 0 && T.state.pairing === null && T.state.starting === false)
    }
    reset(); setK(NOBOT, { pairing: 'supported', server: Object.assign({}, SRV, { can_switch: false }) })
    ok('no bot and no other server registered: the sentence, no button (there is nowhere to go)', (() => { const r = rowOf(); return /pas de bot Telegram/.test(textOf(r.row)) && r.btn === undefined && r.sw.props.disabled === true })())
    reset(); setK(null, { pairing: 'unsupported', server: SRV })
    {
      const r = rowOf()
      ok('server too old: it says so, instead of failing silently', textOf(r.row).includes('Ce serveur ne sait pas encore relier Telegram.') && r.sw.props.disabled === true && r.row.props['data-state'] === 'old')
      ok('and offers the way out when another server is registered', r.btn !== undefined)
    }
    reset(); setK(BOT, { pairing: 'unsupported', server: Object.assign({}, SRV, { can_switch: false }) })
    ok('a bot on a server too old for the routes: still « old », still greyed, no button without another server', (() => { const r = rowOf(); return /ne sait pas encore relier/.test(textOf(r.row)) && r.sw.props.disabled === true && r.btn === undefined })())

    // the strip: open only while Telegram is not connected yet (that is the thing to do), folded otherwise; the person's fold wins
    reset(); setK(NOBOT, { pairing: 'supported', server: SRV })
    ok('no bot, even with a server to switch to: the strip stays folded (the way out is on the screen\'s Telegram row, one button away)', byKb(ui(T.views.Strip), 'kybernos-kyber-tile-channels').length === 0)
    reset(); setK(NOBOT, { pairing: 'supported', server: Object.assign({}, SRV, { can_switch: false }) })
    ok('no bot and nowhere to go: folded, as before', byKb(ui(T.views.Strip), 'kybernos-kyber-tile-channels').length === 0)
    reset(); setK(null, { pairing: 'unsupported', server: SRV })
    ok('too old with a server to switch to: folded too', byKb(ui(T.views.Strip), 'kybernos-kyber-tile-channels').length === 0)
    reset(); setK(NOBOT, { pairing: 'supported', server: SRV }); T.state.stripPref = false
    ok('the person\'s fold wins over all of it', byKb(ui(T.views.Strip), 'kybernos-kyber-tile-channels').length === 0)
    ok('the chip says Telegram is unavailable in both states (no bot, a server too old)', textOf(one(ui(T.views.Strip), 'kybernos-kyber-status')) === 'Telegram · indisponible' && (setK(null, { pairing: 'unsupported', server: SRV }), textOf(one(ui(T.views.Strip), 'kybernos-kyber-status'))) === 'Telegram · indisponible')
    // T2-16: a person already on Kybernos Cloud is not told to switch to Kybernos Cloud
    {
      const CLOUD = { name: 'Kybernos Cloud', host: 'server.kybernos.app', can_switch: true }
      reset(); setK(NOBOT, { pairing: 'supported', server: CLOUD })
      const r = rowOf()
      ok('T2-16: no Telegram bot on Kybernos Cloud itself: the row says it is not switched on yet, and does not send the person to Kybernos Cloud', textOf(r.row).includes('Telegram n’est pas encore activé sur ce serveur.') && !/comme Kybernos Cloud/.test(textOf(r.row)) && r.row.props['data-state'] === 'off' && r.sw.props.disabled === true)
      reset(); setK(BOT, { pairing: 'unknown', server: CLOUD }); T.state.pairing = { error: 'not_found' }
      const p = rowOf()
      ok('T2-16: the same when the pairing answers « not found » (the second place the sentence was drawn)', textOf(p.row).includes('pas encore activé') && !/comme Kybernos Cloud/.test(textOf(p.row)) && p.row.props['data-state'] === 'off')
      reset(); setK(BOT, { pairing: 'unknown', server: SRV }); T.state.pairing = { error: 'not_found' }
      ok('T2-16: on any other server both places still say to switch to a server that has a bot', /comme Kybernos Cloud/.test(textOf(rowOf().row)) && (reset(), setK(NOBOT, { pairing: 'supported', server: SRV }), /comme Kybernos Cloud/.test(textOf(rowOf().row))))
      ok('T2-16: the new sentence has its English pair', T.S.offWhyHere[1] === 'Telegram is not switched on yet on this server.' && !/Kybernos Cloud/.test(T.S.offWhyHere[0] + T.S.offWhyHere[1]))
    }
    // the words, in both languages
    ok('the sentences are the coordinator\'s, in English', T.S.offWhy[1] === 'This server has no Telegram bot. Switch to a server that has one, such as Kybernos Cloud.' && T.S.oldWhy[1] === 'This server does not support linking Telegram yet.' && T.S.switchServer[1] === 'Switch server')
    // a pairing that the server answers « unsupported » to (a stale « supported ») is its own panel, never a silent failure
    reset(); setK(BOT, { pairing: 'unknown', server: SRV }); T.state.pairing = { error: 'unsupported' }
    {
      const p = one(ui(T.views.ChannelsColumn), 'kybernos-kyber-telegram')
      ok('a pairing refused as unsupported says the server is too old', p !== undefined && p.props['data-state'] === 'old' && /ne sait pas encore relier/.test(textOf(p)))
    }
    // the computer choice on such a server is said in words too
    reset(); setK(BOT, { pairing: 'unknown', server: SRV })
    answer = (u) => (u.endsWith('/kyby/computer') ? { ok: false, error: 'unsupported' } : (u === '/kybernos-cloud/kyber' ? { ok: true, connected: true, telegram: null, home: null, computers: [] } : { ok: true }))
    await T.actions.setComputer('aaaaaaaa-1111'); await flush()
    ok('a computer choice that an old server cannot keep is said so', T.state.computerError === 'err_computer_old', T.state.computerError)
  }

  // ── the computer tile ──
  const computer = (home, computers, o) => { reset(); set(Object.assign({ home, computers: computers || [] }, o || {})); return ui(T.views.ComputerBlock, { view: T.state.view }) }
  {
    const none = computer(null)
    ok('no cloud computer yet and no choice made: this computer, ready, no button', textOf(one(none, 'kybernos-kyber-field')).includes('Cet ordinateur') && textOf(one(none, 'kybernos-kyber-computer-state')) === 'Prêt' && byKb(none, 'kybernos-kyber-wake').length === 0 && byKb(none, 'kybernos-kyber-upsell').length === 0)
    T.state.where = 'cloud'
    const cloudNone = ui(T.views.ComputerBlock, { view: T.state.view })
    ok('the cloud one chosen before it exists: named Home, « on request », made at the first request that needs one, no button', textOf(one(cloudNone, 'kybernos-kyber-field')).includes('Home') && textOf(one(cloudNone, 'kybernos-kyber-computer-state')) === 'À la demande' && said(cloudNone).includes('Créé à ta première demande') && byKb(cloudNone, 'kybernos-kyber-wake').length === 0 && byKb(cloudNone, 'kybernos-kyber-upsell').length === 0)
    const asleep = computer({ id: 'aaaaaaaa-1111', name: 'Home', state: 'suspended', manual_control: true })
    ok('asleep, on a paid plan: the chip says so and the person may wake it', textOf(one(asleep, 'kybernos-kyber-computer-state')) === 'En veille' && one(asleep, 'kybernos-kyber-wake') !== undefined && byKb(asleep, 'kybernos-kyber-sleep').length === 0)
    await press(asleep, 'kybernos-kyber-wake')
    ok('waking posts to the host, then reads the state again', calls[0].url === '/kybernos-cloud/computer/resume' && calls.some((c) => c.url === '/kybernos-cloud/kyber') && timers.some((x) => x.ms === 2500))
    const awake = computer({ id: 'aaaaaaaa-1111', name: 'Home', state: 'running', manual_control: true })
    ok('awake: sleep and open, and a green chip', /ok/.test(one(awake, 'kybernos-kyber-computer-state').props.className) && one(awake, 'kybernos-kyber-sleep') !== undefined && one(awake, 'kybernos-kyber-pcopen') !== undefined && byKb(awake, 'kybernos-kyber-wake').length === 0)
    await press(awake, 'kybernos-kyber-sleep')
    ok('sleeping posts suspend', calls[0].url === '/kybernos-cloud/computer/suspend')
    await press(computer({ id: 'aaaaaaaa-1111', name: 'Home', state: 'running', manual_control: true }), 'kybernos-kyber-pcopen')
    ok('open asks the host for the address and opens it in a new tab', calls[0].url === '/kybernos-cloud/computer/open')
  }
  {
    const running = computer({ id: 'aaaaaaaa-1111', name: 'Home', state: 'running', manual_control: true })
    answer = (u) => (u.endsWith('/computer/open') ? { ok: true, url: 'https://computer.example.test/x' } : { ok: true })
    await press(running, 'kybernos-kyber-pcopen')
    ok('the opened address is the one the host gave, opened outside the page', opened.length === 1 && opened[0] === 'https://computer.example.test/x')
    const free = computer({ id: 'aaaaaaaa-1111', name: 'Home', state: 'suspended', manual_control: false })
    ok('Free plan: no wake, no sleep; the short note and the upgrade button instead', byKb(free, 'kybernos-kyber-wake').length === 0 && byKb(free, 'kybernos-kyber-sleep').length === 0 && textOf(one(free, 'kybernos-kyber-upsell')) === 'Offre Free : réveil automatique seulement.' && one(free, 'kybernos-kyber-upgrade') !== undefined)
    const creating = computer({ id: 'aaaaaaaa-1111', name: 'Home', state: 'creating', manual_control: true })
    ok('being set up: « Initialisation », a spinner and the sentence for a machine dedicated to the person', textOf(one(creating, 'kybernos-kyber-computer-state')) === 'Initialisation' && /warn/.test(one(creating, 'kybernos-kyber-computer-state').props.className) && nodes(creating).some((n) => /kbky-spin/.test(n.props.className || '')) && said(creating).includes('Initialisation d’une machine dédiée pour toi. Environ une minute.'))
    const failed = computer({ id: 'aaaaaaaa-1111', name: 'Home', state: 'failed', manual_control: true })
    ok('a failure is a red chip, with its sentence', /err/.test(one(failed, 'kybernos-kyber-computer-state').props.className) && said(failed).includes('Il n’a pas démarré'))
    const paused = computer({ id: 'aaaaaaaa-1111', name: 'Home', state: 'suspended', manual_control: true, paused_reason: 'hours' })
    ok('hours used up is said as a warning', said(paused).includes('heures d’exécution du mois sont utilisées'))
  }
  {
    const many = computer({ id: 'bbbbbbbb-2222', name: 'Atelier', state: 'running', manual_control: true },
      [{ id: 'aaaaaaaa-1111', name: 'Home', state: 'suspended' }, { id: 'bbbbbbbb-2222', name: 'Atelier', state: 'running' }])
    const sel = one(many, 'kybernos-kyber-pick')
    ok('several computers: a real select, this computer first, the linked cloud one selected, named for a screen reader', sel !== undefined && sel.tag === 'select' && sel.props.value === 'bbbbbbbb-2222' && sel.kids.length === 3 && textOf(sel.kids[0]) === 'Cet ordinateur' && textOf(sel.kids[1]) === 'Home (cloud)' && /Ordinateur lié à Kaby/.test(sel.props['aria-label']))
    answer = (u) => (u.endsWith('/kyby/computer') ? { ok: true, computer_id: 'aaaaaaaa-1111' } : { ok: true })
    await sel.props.onChange({ target: { value: 'aaaaaaaa-1111' } }); await flush()
    ok('choosing sends the id to the host, then reads the state again', calls[0].url === '/kybernos-cloud/kyby/computer' && calls[0].body.computer_id === 'aaaaaaaa-1111' && calls.some((c) => c.url === '/kybernos-cloud/kyber'))
    const kyberAnswer = { ok: true, connected: true, telegram: null, home: { id: 'bbbbbbbb-2222', name: 'Atelier', state: 'running' }, computers: [{ id: 'aaaaaaaa-1111', name: 'Home', state: 'suspended' }, { id: 'bbbbbbbb-2222', name: 'Atelier', state: 'running' }] }
    answer = (u) => (u.endsWith('/kyby/computer') ? { ok: false, error: 'not_found' } : (u === '/kybernos-cloud/kyber' ? kyberAnswer : { ok: true }))
    await sel.props.onChange({ target: { value: 'aaaaaaaa-1111' } }); await flush()
    ok('an older server that cannot keep the choice says so, in words', T.state.computerError === 'err_computer_old' && said(ui(T.views.ComputerBlock, { view: T.state.view })).includes('Ce serveur ne sait pas encore enregistrer ce choix'))
    ok('one cloud computer: this computer and that one', (() => { const s = one(computer({ id: 'aaaaaaaa-1111', name: 'Home', state: 'suspended', manual_control: true }, [{ id: 'aaaaaaaa-1111', name: 'Home', state: 'suspended' }]), 'kybernos-kyber-pick'); return s.kids.length === 2 && s.props.value === 'aaaaaaaa-1111' && s.props.disabled === false })())
  }

  // ── « this computer » (V-04): selectable next to the cloud one, remembered, and needing no server ──
  {
    const home = { id: 'aaaaaaaa-1111', name: 'Home', state: 'suspended', manual_control: true }
    const tile = computer(home, [{ id: 'aaaaaaaa-1111', name: 'Home', state: 'suspended' }])
    ok('with a cloud computer already made, it is the one shown until the person says otherwise', one(tile, 'kybernos-kyber-pick').props.value === 'aaaaaaaa-1111' && one(tile, 'kybernos-kyber-wake') !== undefined)
    calls.length = 0
    one(tile, 'kybernos-kyber-pick').props.onChange({ target: { value: 'local' } }); await flush()
    ok('choosing this computer calls no server at all', calls.length === 0 && timers.length === 0, JSON.stringify(calls))
    ok('and is remembered, in memory and on disk', T.state.where === 'local' && stored.get('kybernos-kyber.where') === 'local')
    const local = ui(T.views.ComputerBlock, { view: T.state.view })
    ok('the tile then names this computer, ready, with what it means and no wake / sleep / open', one(local, 'kybernos-kyber-pick').props.value === 'local' && textOf(one(local, 'kybernos-kyber-computer-state')) === 'Prêt' && /Kaby travaille sur cet ordinateur/.test(textOf(one(local, 'kybernos-kyber-local-line'))) && ['wake', 'sleep', 'pcopen', 'upgrade', 'upsell'].every((k) => byKb(local, 'kybernos-kyber-' + k).length === 0))
    ok('the folded strip says it too', (() => { T.state.stripPref = false; const c = one(ui(T.views.Strip), 'kybernos-kyber-computer-chip'); T.state.stripPref = null; return textOf(c) === 'Cet ordinateur · Prêt' && /ok/.test(c.props.className) })())
    one(local, 'kybernos-kyber-pick').props.onChange({ target: { value: 'aaaaaaaa-1111' } }); await flush()
    ok('going back to the cloud computer asks the host and is remembered', T.state.where === 'cloud' && stored.get('kybernos-kyber.where') === 'cloud' && calls[0].url === '/kybernos-cloud/kyby/computer' && calls[0].body.computer_id === 'aaaaaaaa-1111')
    // remembered across a page load: a second copy of the bundle reads it back
    const saved = captured
    stored.set('kybernos-kyber.where', 'local')
    new Function(src)()
    const again = captured.factory((n) => (n === 'react' ? React : undefined))
    ok('a new page load starts from the remembered choice', again.__test.state.where === 'local')
    stored.set('kybernos-kyber.where', 'nonsense')
    new Function(src)()
    ok('a stored value that is not a choice is ignored', captured.factory((n) => (n === 'react' ? React : undefined)).__test.state.where === null)
    captured = saved
    // the pure rule
    const okView = { kind: 'ok', home: null }
    ok('no choice and no cloud computer: this computer; with one: that one; a choice wins', T.whereOf(null, okView) === 'local' && T.whereOf(null, { kind: 'ok', home: {} }) === 'cloud' && T.whereOf('local', { kind: 'ok', home: {} }) === 'local' && T.whereOf('cloud', okView) === 'cloud')
    ok('with no account or no readable server it can only be this computer, whatever was remembered', T.whereOf('cloud', { kind: 'signedOut' }) === 'local' && T.whereOf('cloud', { kind: 'failed' }) === 'local' && T.whereOf('cloud', null) === 'local')
  }
  {
    // no account, no server: Kaby's block still offers the one choice that needs neither, and calls nobody
    for (const kind of ['signedOut', 'failed']) {
      reset(); T.state.view = { kind }
      const ch = ui(T.views.ChannelsColumn)
      const sel = one(ch, 'kybernos-kyber-pick')
      ok(kind + ': the note and the computer sub-block with this computer only (a select with nothing else to pick), and no messaging app', byKb(ch, 'kybernos-kyber-column-note').length === 1 && byKb(ch, 'kybernos-kyber-messaging').length === 0 && sel !== undefined && sel.kids.length === 1 && sel.props.disabled === true && calls.length === 0)
    }
  }

  // ── what Kaby is (the page's intro), and one short line under the computer sub-block's title (V-02, V-03) ──
  {
    reset(); set({ home: { id: 'aaaaaaaa-1111', name: 'Home', state: 'suspended', manual_control: true } })
    const page = ui(T.views.Page)
    ok('the page says what Kaby is: a phone with a remote control, in French here', /téléphone avec télécommande/.test(said(page)) && /Kaby/.test(said(page)))
    ok('and in English: a phone with a remote control that works on the desktop', /phone with a remote control/.test(T.S.intro[1]) && /works on your desktop/.test(T.S.intro[1]))
    ok('the strip above the composer is one line and carries no paragraph of help', byKb(ui(T.views.Strip), 'kybernos-kyber-intro').length === 0 && byKb(ui(T.views.Strip), 'kybernos-kyber-computer-help').length === 0)
    const col = ui(T.views.ChannelsColumn)
    ok('the computer sub-block has ONE short line under its title (what it is), not the long explanation of « on request »', /La machine sur laquelle Kaby travaille\./.test(textOf(one(col, 'kybernos-kyber-computer-help'))) && !/À la demande/.test(textOf(one(col, 'kybernos-kyber-computer-help'))))
    ok('in English too', T.S.compLead[1] === 'The machine {NAME} works on.' && T.S.compH[1] === '{NAME}’s computer')
  }
  {
    // the « ? How it works » pill: the Suite's own, called by id, on the strip's line; nothing where the Suite does not offer it
    reset(); set({ home: null })
    const had = globalThis.window.__KB_HELP__
    globalThis.window.__KB_HELP__ = { Help: (p) => React.createElement('span', { 'data-kb': 'help-stub', 'data-id': p.id }) }
    const strip = ui(T.views.Strip)
    const pill = one(strip, 'help-stub')
    ok('the strip carries the Suite\'s help pill for this bundle', pill !== undefined && pill.props['data-id'] === 'kybernos-kyber')
    ok('on the same line as the chips, not inside one of them', ['kybernos-kyber-remote-chip', 'kybernos-kyber-status', 'kybernos-kyber-computer-chip'].every((k) => byKb(strip, k).length === 0 || walk(one(strip, k)).every((n) => n.props['data-kb'] !== 'help-stub')))
    ok('the page carries it too', byKb(ui(T.views.Page), 'help-stub').length === 1)
    delete globalThis.window.__KB_HELP__
    ok('without the Suite\'s help nothing is drawn and nothing throws', byKb(ui(T.views.Strip), 'help-stub').length === 0 && byKb(ui(T.views.Page), 'help-stub').length === 0)
    if (had !== undefined) globalThis.window.__KB_HELP__ = had
  }

  // ── a computer that is being set up is read again until it has settled ──
  {
    reset(); T.listeners.add(() => {})
    answer = (u) => (u === '/kybernos-cloud/kyber' ? { ok: true, connected: true, telegram: null, home: { id: 'aaaaaaaa-1111', name: 'Home', state: 'creating' }, computers: [] } : { ok: true, server: { api: 'http://x' } })
    await T.actions.load(); await flush()
    ok('creating: the page reads again in three seconds by itself', T.state.view.home.state === 'creating' && timers.filter((x) => x.ms === 3000).length === 1)
    timers.length = 0
    answer = (u) => (u === '/kybernos-cloud/kyber' ? { ok: true, connected: true, telegram: null, home: { id: 'aaaaaaaa-1111', name: 'Home', state: 'suspended' }, computers: [] } : { ok: true, server: { api: 'http://x' } })
    await T.actions.load(); await flush()
    ok('once asleep, it stops reading faster', T.state.view.home.state === 'suspended' && timers.filter((x) => x.ms === 3000).length === 0)
    T.listeners.clear(); timers.length = 0
    answer = (u) => (u === '/kybernos-cloud/kyber' ? { ok: true, connected: true, telegram: null, home: { id: 'aaaaaaaa-1111', name: 'Home', state: 'creating' }, computers: [] } : { ok: true, server: { api: 'http://x' } })
    await T.actions.load(); await flush()
    ok('with nothing on screen it does not keep polling', timers.length === 0)
  }

  // ── the dock: Kaby's own chat and no other ──
  {
    reset(); set({ home: null })
    T.state.kybySid = 'sid-kaby'
    ok('the strip is above the composer of Kaby\'s chat', byKb(ui(T.views.KybyDock, { sessionId: 'sid-kaby' }), 'kybernos-kyber-strip').length === 1)
    ok('and above no other chat, nor with no session', ui(T.views.KybyDock, { sessionId: 'sid-other' }).length === 0 && ui(T.views.KybyDock, {}).length === 0)
  }


  // ── « no camera or no app? »: the same token written by hand, in DSH, nothing sent anywhere ──
  {
    reset(); set({ home: null })
    T.state.pairing = WAITING()
    const clip = []
    Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async (v) => { clip.push(v) } } }, configurable: true, writable: true })
    const before = ui(T.views.ChannelsColumn)
    const toggle = one(before, 'kybernos-kyber-code')
    ok('a waiting code offers « write a code instead », closed at first', toggle !== undefined && toggle.props['aria-expanded'] === 'false' && byKb(before, 'kybernos-kyber-code-box').length === 0)
    ok('and the panel says nothing of a console or an account page', !/console|account page|page du compte/i.test(textOf(one(before, 'kybernos-kyber-telegram'))))
    await press(before, 'kybernos-kyber-code')
    const opened = ui(T.views.ChannelsColumn)
    ok('opened: the bot\'s name and the command to write, with the token of THIS pairing', one(opened, 'kybernos-kyber-code').props['aria-expanded'] === 'true' && textOf(one(opened, 'kybernos-kyber-code-box')).includes('@kybernos_bot') && textOf(one(opened, 'kybernos-kyber-code-text')) === '/start pair_abc', textOf(one(opened, 'kybernos-kyber-code-box')))
    ok('pressing it asked nothing of the host: no console link, no request at all', calls.length === 0, calls)
    await press(opened, 'kybernos-kyber-code-copy')
    ok('copy puts the command on the clipboard and says so', clip.length === 1 && clip[0] === '/start pair_abc' && textOf(one(ui(T.views.ChannelsColumn), 'kybernos-kyber-code-copy')) === 'Copié')
    await press(opened, 'kybernos-kyber-code')
    ok('pressed again it closes', byKb(ui(T.views.ChannelsColumn), 'kybernos-kyber-code-box').length === 0)
    T.state.showCode = true
    answer = (u) => (u.endsWith('/telegram/pairing/cancel') ? { ok: true } : { ok: true })
    await T.actions.pairCancel(); await flush()
    ok('a cancelled code closes the box with it', T.state.showCode === false && T.state.pairing === null)
    T.state.pairing = Object.assign(WAITING(), { state: 'scanned', sender: 'Amina' })
    T.state.showCode = true
    ok('once scanned there is no code to write any more', byKb(ui(T.views.ChannelsColumn), 'kybernos-kyber-code-box').length === 0 && byKb(ui(T.views.ChannelsColumn), 'kybernos-kyber-code').length === 0)
    T.state.pairing = Object.assign(WAITING(), { link: 'https://t.me/kybernos_bot?start=nothing' })
    T.state.showCode = false
    ok('a link that carries no token offers no code (nothing invented)', byKb(ui(T.views.ChannelsColumn), 'kybernos-kyber-code').length === 0)
  }

  // ── what the strip tells the page about Kaby's chat, and how it sits above the composer ──
  {
    reset()
    const events = []
    const realDispatch = globalThis.window.dispatchEvent
    const realCustom = globalThis.CustomEvent
    globalThis.CustomEvent = class { constructor (type, init) { this.type = type; this.detail = init && init.detail } }
    globalThis.window.dispatchEvent = (e) => { events.push({ type: e.type, sid: e.detail && e.detail.sessionId }); return true }
    answer = (u) => (u === '/kybernos-cloud/kyby/native' ? { ok: true, sessionId: 'sid-kaby', cwd: '/home/x/kyby' } : { ok: true })
    await T.actions.readSessionPointer()
    ok('when Kaby\'s chat becomes known, the page is told by an event (the new-chat cards render before it is read on a load)', events.length === 1 && events[0].type === 'kb-kyby-session' && events[0].sid === 'sid-kaby', events)
    await T.actions.readSessionPointer()
    ok('read again, unchanged: no second event', events.length === 1)
    answer = (u) => (u === '/kybernos-cloud/kyby/native' ? { ok: true, sessionId: null } : { ok: true })
    await T.actions.readSessionPointer()
    ok('and told again when it is forgotten', events.length === 2 && events[1].sid === null)
    globalThis.window.dispatchEvent = realDispatch
    globalThis.CustomEvent = realCustom
    ok('a window with no dispatch does not break the read', await (async () => { try { globalThis.window.dispatchEvent = undefined; answer = (u) => (u === '/kybernos-cloud/kyby/native' ? { ok: true, sessionId: 'another' } : { ok: true }); await T.actions.readSessionPointer(); return T.state.kybySid === 'another' } finally { globalThis.window.dispatchEvent = realDispatch } })())
    const css = T.CSS
    ok('in the dock the strip is as wide as the composer\'s card (the engine\'s side clearance, 16 px without it) and has its radius (28 px)', /\.kbky-dock\{[^}]*padding:0 var\(--dsh-composer-side-clearance,16px\)/.test(css) && /\.kbky-strip\{[^}]*border-radius:28px/.test(css))
    ok('the tiles and the panel have the radius that nests in it (16 px), the same one', /\.kbky-tile\{[^}]*border-radius:16px/.test(css) && /\.kbky-panel\{[^}]*border-radius:16px/.test(css))
  }

  globalThis.setTimeout = realTimeout
}

// ── a chat made for Kaby starts in DSH's ask mode, once (the person's own pick later is theirs) ──────────────
{
  ok('a chat is switched with DSH\'s own command, to the preset that asks', T.ASK_PRESET === 'workspace-write' && /\/permission '/.test(src))
  ok('it is applied only when the chat is made, never to an existing one', /made = true/.test(src) && /if \(made\) void askFirst\(sessionsSvc, sid\)/.test(src))
  const sent = []
  const live = { command: async (c) => { sent.push(c); return { ok: true, value: { matched: true } } } }
  ok('a materialized chat is switched and says so', (await T.askFirst({ binding: () => ({ session: live }) }, 'session-aaaaaaaa', 3, 1)) === true && sent.join() === '/permission workspace-write', sent)
  let n = 0
  ok('a chat that is not materialized yet is tried again, then switched', (await T.askFirst({ binding: () => (++n < 3 ? undefined : { session: live }) }, 'session-aaaaaaaa', 6, 1)) === true && n === 3, n)
  ok('a chat that never materializes ends false and throws nothing', (await T.askFirst({ binding: () => undefined }, 'session-aaaaaaaa', 3, 1)) === false)
  ok('a host with no such command (matched false) or a refusal ends false', (await T.askFirst({ binding: () => ({ session: { command: async () => ({ ok: true, value: { matched: false } }) } }) }, 's', 2, 1)) === false && (await T.askFirst({ binding: () => ({ session: { command: async () => ({ ok: false, error: { code: 'x' } }) } }) }, 's', 2, 1)) === false)
  ok('a service that throws is survived', (await T.askFirst({ binding: () => { throw new Error('boom') } }, 's', 2, 1)) === false)
}

process.exit(fail > 0 ? 1 : 0)
