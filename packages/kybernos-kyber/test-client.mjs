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
  ok('the tab title is Kaby', types[0].title() === 'Kaby')
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
    telegram: { configured: true, enabled: true, bot: 'kybernos_bot', linked: { display: 'Miled @alex', linked_at: '2026-10-14T20:34:35.000Z', paused: false, blocked: false } },
    home: { state: 'suspended', desired: 'suspended', mode: 'sleep', region: 'ams', last_active_at: '2026-10-14T22:50:00.000Z', version: 'p12', network: 'public' },
  }, server)
  ok('connected: the name, the date, the bot and the account page', linked.kind === 'ok' && linked.telegram.state === 'linked' && linked.telegram.name === 'Miled @alex' && linked.telegram.botUrl === 'https://t.me/kybernos_bot' && linked.accountUrl === 'https://server-dev-7831.up.railway.app/account', JSON.stringify(linked))
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
  ok('scanned: the sender is carried', f({ id: 'x', state: 'scanned', expiresAt: exp, sender: 'Miled (@alex)' }).sender === 'Miled (@alex)')
  ok('past its expiry it is expired, whatever the state said', f({ id: 'x', state: 'waiting', expiresAt: '2026-10-15T09:59:00Z' }).kind === 'expired' && f({ id: 'x', state: 'expired' }).kind === 'expired')
  ok('declined carries one of three reasons, anything else is « user »', f({ state: 'declined', reason: 'taken' }).reason === 'taken' && f({ state: 'declined', reason: 'botmade' }).reason === 'botmade' && f({ state: 'declined', reason: 'sql' }).reason === 'user')
  ok('done and an error are their own faces', f({ state: 'done' }).kind === 'done' && f({ error: 'rate_limited' }).code === 'rate_limited')
  ok('the clock reads m:ss', T.clock(0) === '0:00' && T.clock(65) === '1:05' && T.clock(299.9) === '4:59')
}
{
  ok('the strip is open only when there is a code to scan, and the person\'s choice wins', T.stripIsOpen(null, 'unlinked') === true && T.stripIsOpen(null, 'linked') === false && T.stripIsOpen(null, 'off') === false && T.stripIsOpen(null, null) === false && T.stripIsOpen(true, 'off') === true && T.stripIsOpen(false, 'unlinked') === false)
  ok('WhatsApp and WeChat have a mark', typeof T.BRAND.whatsapp === 'function' && typeof T.BRAND.wechat === 'function' && typeof T.BRAND.telegram === 'function')
  ok('the assistant has one name, said through a token, in both languages, and no « Kyber » or « Kyby » is spelt out', T.NAME === 'Kaby' && T.L('title') === 'Kaby' && T.kt('{NAME}', '{NAME}') === '{NAME}' && !Object.values(T.S).some((p) => /\b(Kyber|Kyby|Kaby)\b/.test(p[0] + ' ' + p[1])) && /\{NAME\}/.test(JSON.stringify(T.S)))
  ok('the channels that are not there yet say « soon » in both languages', T.L('soon') === 'Bientôt' && T.kt('Bientôt', 'Soon') === 'Bientôt')
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
  ok('the strip is two tiles and a panel; no settings, no radio, no « Other channels » group', /h\(ChannelsTile, \{ view: v \}\), h\(ComputerTile, \{ view: v \}\)/.test(src) && /h\(TelegramPanel, \{ view: v \}\)/.test(src) && !/type: 'radio'/.test(src) && !/WhereCard|OtherChannels|SoonLine|kbky-more|otherChannels/.test(src))
  const srv = T.derive({ ok: true, connected: true, telegram: { configured: false, enabled: false, bot: null, linked: null }, home: null }, { ok: true, server: { id: 'kybernos-local', api: 'http://localhost:8791' } })
  ok('the server\'s name is known, so that « no Telegram bot » can say whose', (() => { const v = T.derive({ ok: true, connected: true, telegram: { configured: false, enabled: false, bot: null, linked: null }, home: null }, { ok: true, server: { id: 'kybernos-local', api: 'http://localhost:8791' } }); return v.serverId === 'kybernos-local' && T.L('ofSubS', { server: v.serverId }).includes('kybernos-local') })())
  ok('an odd server id is dropped', T.derive({ ok: true, connected: true, telegram: null, home: null }, { ok: true, server: { id: '<b>', api: 'http://x' } }).serverId === '')
  ok('the diagnostics hook tells whether a chat is Kaby\'s (the new-chat cards stay out of it)', /isKybySession \(sid\)/.test(src))
}

{
  ok('a computer that does not exist yet is « made at your first request that needs one », not a missing thing', T.L('noHome').startsWith('Créé') && T.S.onRequest !== undefined)
  ok('a choice among several computers is a plain select, and it is sent to the host', /'data-kb': 'kybernos-kyber-pick'/.test(src) && /\/kybernos-cloud\/kyby\/computer/.test(src) && /v\.computers\.length > 1/.test(src))
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
    Object.assign(T.state, { view: null, pairing: null, starting: false, confirmDisc: false, busy: '', computerError: '', stripPref: null, kybySid: null })
    calls.length = 0; timers.length = 0; stored.clear(); opened.length = 0; answer = () => ({ ok: true })
    T.listeners.clear()
  }
  const set = (o) => {
    T.state.view = T.derive({ ok: true, connected: true,
      telegram: Object.assign({ configured: true, enabled: true, bot: 'kybernos_bot', linked: null }, o.tg || {}),
      home: o.home === undefined ? null : o.home, computers: o.computers || [] }, o.srv || server)
  }
  const LINKED = { linked: { display: 'Miled (@alex)', linked_at: '2026-10-14T20:34:35.000Z', paused: false, blocked: false } }
  const soonFromNow = (s) => new Date(Date.now() + s * 1000).toISOString()
  const WAITING = () => ({ id: '0f3b1b72-1111-4222-8333-444455556666', link: 'https://t.me/kybernos_bot?start=pair_abc', bot: 'kybernos_bot', qr: { size: 21, modules: Array.from({ length: 21 }, (_, y) => '10101010101010101010' + String(y % 2)) }, expiresAt: soonFromNow(240), state: 'waiting', reason: null, sender: '', error: '' })

  // ── the strip: open to turn something on, folded to say how things stand ──
  reset(); set({ home: { id: 'aaaaaaaa-1111', name: 'Home', state: 'suspended', manual_control: true } })
  {
    const open = ui(T.views.Strip)
    ok('the strip is open while Telegram is not connected, headed with the assistant\'s name', byKb(open, 'kybernos-kyber-tile-channels').length === 1 && byKb(open, 'kybernos-kyber-computer').length === 1 && textOf(one(open, 'kybernos-kyber-strip-toggle')) === 'Kaby')
    ok('nothing above the two tiles files the computer under « Channels »', !textOf(one(open, 'kybernos-kyber-strip-toggle')).includes('Canaux') && byKb(open, 'kybernos-kyber-status').length === 0)
    ok('opening the strip asks for no code', calls.length === 0 && T.state.pairing === null && byKb(open, 'kybernos-kyber-telegram').length === 0 && byKb(open, 'kybernos-kyber-qr').length === 0)
    T.state.stripPref = false
    const folded = ui(T.views.Strip)
    ok('folded: no tiles, two chips say how Telegram and the computer stand', byKb(folded, 'kybernos-kyber-tile-channels').length === 0 && textOf(one(folded, 'kybernos-kyber-status')) === 'Telegram non connecté' && textOf(one(folded, 'kybernos-kyber-computer-chip')) === 'Home · En veille')
    ok('the fold button says whether it is open, for a screen reader', one(folded, 'kybernos-kyber-strip-toggle').props['aria-expanded'] === 'false' && one(open, 'kybernos-kyber-strip-toggle').props['aria-expanded'] === 'true')
    T.state.stripPref = null
    set({ tg: LINKED, home: { id: 'aaaaaaaa-1111', name: 'Home', state: 'running', manual_control: true } })
    ok('connected, the strip is folded by itself and the chips are green', byKb(ui(T.views.Strip), 'kybernos-kyber-tile-channels').length === 0 && /ok/.test(one(ui(T.views.Strip), 'kybernos-kyber-status').props.className) && /ok/.test(one(ui(T.views.Strip), 'kybernos-kyber-computer-chip').props.className))
    T.actions.toggleStrip()
    ok('the person\'s choice is kept, in memory and on disk', T.state.stripPref === true && stored.get('kybernos-kyber.strip') === '1' && byKb(ui(T.views.Strip), 'kybernos-kyber-tile-channels').length === 1)
  }

  // ── the channels tile ──
  reset(); set({ home: null })
  {
    const tile = ui(T.views.ChannelsTile, { view: T.state.view })
    const rows = ['kybernos-kyber-tg-row', 'kybernos-kyber-chan-whatsapp', 'kybernos-kyber-chan-wechat'].map((k) => one(tile, k))
    ok('Telegram, WhatsApp and WeChat are three rows of one list', rows.every((r) => r !== undefined) && textOf(rows[0]).includes('Telegram') && textOf(rows[1]).includes('WhatsApp') && textOf(rows[2]).includes('WeChat'))
    ok('WhatsApp and WeChat say « Bientôt » and offer nothing: no switch, no button, no link', [rows[1], rows[2]].every((r) => textOf(r).includes('Bientôt') && walk(r).every((n) => n.tag !== 'button' && n.tag !== 'a' && typeof n.props.onClick !== 'function')))
    const sw = one(tile, 'kybernos-kyber-tg-switch')
    ok('Telegram has one switch, a real one: role, state and name', sw.props.role === 'switch' && sw.props['aria-checked'] === 'false' && sw.props['aria-label'] === 'Telegram' && sw.props.disabled === false && textOf(rows[0]).includes('Pas connecté'))
  }

  // ── turning Telegram on: the code is asked for now, shown under the tiles, polled, and cancelled by the same switch ──
  reset(); set({ home: null })
  answer = (u) => (u.endsWith('/telegram/pairing') ? { ok: true, id: '0f3b1b72-1111-4222-8333-444455556666', link: 'https://t.me/kybernos_bot?start=pair_abc', bot: 'kybernos_bot', expires_at: soonFromNow(300), qr: { size: 21, modules: Array.from({ length: 21 }, () => '101010101010101010101') } } : { ok: true })
  {
    await press(ui(T.views.ChannelsTile, { view: T.state.view }), 'kybernos-kyber-tg-switch')
    ok('the switch asks the host for a code (one POST), nothing else', calls.length === 1 && calls[0].method === 'POST' && calls[0].url === '/kybernos-cloud/telegram/pairing', JSON.stringify(calls))
    ok('and the pairing is then polled', T.state.pairing !== null && T.state.pairing.state === 'waiting' && timers.some((x) => x.ms === 2000))
    const strip = ui(T.views.Strip)
    const panel = one(strip, 'kybernos-kyber-telegram')
    ok('the code is shown under the two tiles: QR, three steps, the bot\'s link, the time left', panel !== undefined && panel.props['data-state'] === 'waiting' && byKb(strip, 'kybernos-kyber-qr').length === 1 && nodes(strip).filter((n) => n.tag === 'li').length === 3 && one(strip, 'kybernos-kyber-open').props.href === 'https://t.me/kybernos_bot?start=pair_abc' && /Expire dans \d:\d\d/.test(textOf(one(strip, 'kybernos-kyber-left'))))
    ok('the panel comes after the tiles, not inside one of them', (() => { const order = nodes(strip).map((n) => n.props['data-kb']); const iTiles = order.indexOf('kybernos-kyber-computer'); const iPanel = order.indexOf('kybernos-kyber-telegram'); return iTiles >= 0 && iPanel > iTiles && byKb(ui(T.views.ChannelsTile, { view: T.state.view }), 'kybernos-kyber-telegram').length === 0 })())
    const sw = one(strip, 'kybernos-kyber-tg-switch')
    ok('the switch is on and the row says what is expected of the person', sw.props['aria-checked'] === 'true' && textOf(one(strip, 'kybernos-kyber-tg-row')).includes('Code à scanner'))
    calls.length = 0
    await press(strip, 'kybernos-kyber-tg-switch')
    ok('the same switch cancels the code: the host is told, the panel goes', calls.length === 1 && calls[0].url === '/kybernos-cloud/telegram/pairing/cancel' && calls[0].body.id === '0f3b1b72-1111-4222-8333-444455556666' && T.state.pairing === null && byKb(ui(T.views.Strip), 'kybernos-kyber-telegram').length === 0)
  }
  {
    // the person scanned: the panel names who and waits
    reset(); set({ home: null })
    T.state.pairing = Object.assign(WAITING(), { state: 'scanned', sender: 'Miled (@alex)' })
    const strip = ui(T.views.Strip)
    ok('scanned: the sender is named, the person is asked to confirm in Telegram, and can say it is not them', one(strip, 'kybernos-kyber-telegram').props['data-state'] === 'scanned' && /Miled \(@alex\)/.test(said(strip)) && byKb(strip, 'kybernos-kyber-qr').length === 0 && one(strip, 'kybernos-kyber-cancel') !== undefined && textOf(one(strip, 'kybernos-kyber-tg-row')).includes('En attente de votre accord'))
  }
  for (const [name, pairing, state, retry, row] of [
    ['expired', { id: 'x', state: 'expired' }, 'expired', true, 'Code expiré'],
    ['refused in Telegram', { id: 'x', state: 'declined', reason: 'user' }, 'declined', true, 'Refusé dans Telegram'],
    ['taken by another account', { id: 'x', state: 'declined', reason: 'taken' }, 'taken', true, 'Déjà utilisé par un autre compte'],
    ['the bot already made the account', { id: 'x', state: 'declined', reason: 'botmade' }, 'botmade', false, 'Compte déjà créé par le bot'],
    ['too many tries', { error: 'rate_limited' }, 'error', true, 'Impossible de préparer le code'],
    ['no Telegram route on this server', { error: 'not_found' }, 'off', false, 'Pas de bot sur ce serveur'],
  ]) {
    reset(); set({ home: null }); T.state.pairing = pairing
    const strip = ui(T.views.Strip)
    const panel = one(strip, 'kybernos-kyber-telegram')
    ok('a code that ended: ' + name + ' → its own panel' + (retry ? ' with a new code' : ' without one') + ', and its row says it', panel !== undefined && panel.props['data-state'] === state && (one(strip, 'kybernos-kyber-retry') !== undefined) === retry && textOf(one(strip, 'kybernos-kyber-tg-row')).includes(row), textOf(one(strip, 'kybernos-kyber-tg-row')))
  }
  {
    reset(); set({ home: null }); T.state.pairing = { id: 'x', state: 'expired' }
    answer = () => ({ ok: true, id: '0f3b1b72-1111-4222-8333-444455556666', link: 'https://t.me/kybernos_bot?start=pair_new', bot: 'kybernos_bot', expires_at: soonFromNow(300), qr: { size: 21, modules: Array.from({ length: 21 }, () => '101010101010101010101') } })
    await press(ui(T.views.Strip), 'kybernos-kyber-tg-switch')
    ok('after an expiry the switch is off, and turning it on again makes a new code', calls.length === 1 && T.state.pairing !== null && T.state.pairing.state === 'waiting' && /pair_new/.test(T.state.pairing.link))
  }

  // ── a connected chat: the switch asks before it disconnects ──
  reset(); set({ tg: LINKED, home: null }); T.state.stripPref = true
  {
    const strip = ui(T.views.Strip)
    const sw = one(strip, 'kybernos-kyber-tg-switch')
    ok('connected: the switch is on, the row names the chat, the bot has its link', sw.props['aria-checked'] === 'true' && textOf(one(strip, 'kybernos-kyber-tg-row')).includes('Miled (@alex)') && one(strip, 'kybernos-kyber-bot').props.href === 'https://t.me/kybernos_bot' && byKb(strip, 'kybernos-kyber-telegram').length === 0)
    await press(strip, 'kybernos-kyber-tg-switch')
    const asking = ui(T.views.Strip)
    ok('turning it off does not disconnect: it asks first, and nothing is sent', calls.length === 0 && one(asking, 'kybernos-kyber-telegram').props['data-state'] === 'disconnect' && one(asking, 'kybernos-kyber-unlink-yes') !== undefined)
    await press(asking, 'kybernos-kyber-unlink-no')
    ok('cancelling closes the question and sends nothing', calls.length === 0 && T.state.confirmDisc === false && byKb(ui(T.views.Strip), 'kybernos-kyber-telegram').length === 0)
    await press(ui(T.views.Strip), 'kybernos-kyber-tg-switch')
    await press(ui(T.views.Strip), 'kybernos-kyber-unlink-yes')
    ok('confirming disconnects, once, with the confirmation the host asks for', calls.some((c) => c.url === '/kybernos-cloud/telegram/unlink' && c.body.confirm === true) && calls.filter((c) => c.url === '/kybernos-cloud/telegram/unlink').length === 1 && T.state.confirmDisc === false)
  }
  {
    reset(); set({ tg: Object.assign({}, LINKED, { linked: Object.assign({}, LINKED.linked, { paused: true }) }), home: null })
    const row = one(ui(T.views.ChannelsTile, { view: T.state.view }), 'kybernos-kyber-tg-row')
    ok('a paused chat says so in its row, as a warning', textOf(row).includes('En pause') && walk(row).some((n) => n.tag === 'span' && /warn/.test(n.props.className || '')))
  }

  // ── a server with no bot ──
  reset(); set({ tg: { configured: false, enabled: false, bot: null, linked: null }, home: null, srv: { ok: true, server: { id: 'kybernos-local', api: 'http://localhost:8791' } } })
  {
    const tile = ui(T.views.ChannelsTile, { view: T.state.view })
    const sw = one(tile, 'kybernos-kyber-tg-switch')
    await press(tile, 'kybernos-kyber-tg-switch')
    ok('no bot: the switch is disabled, the row says whose server, nothing is requested', sw.props.disabled === true && textOf(one(tile, 'kybernos-kyber-tg-row')).includes('Pas de bot sur ce serveur (kybernos-local)') && calls.length === 0 && byKb(ui(T.views.Strip), 'kybernos-kyber-telegram').length === 0)
    ok('and the strip is folded by itself (nothing to turn on)', byKb(ui(T.views.Strip), 'kybernos-kyber-tile-channels').length === 0)
  }

  // ── the computer tile ──
  const computer = (home, computers, o) => { reset(); set(Object.assign({ home, computers: computers || [] }, o || {})); return ui(T.views.ComputerTile, { view: T.state.view }) }
  {
    const none = computer(null)
    ok('no computer yet: a select-like field named Home, « on request », made at the first request that needs one, no button', textOf(one(none, 'kybernos-kyber-field')).includes('Home') && textOf(one(none, 'kybernos-kyber-computer-state')) === 'À la demande' && said(none).includes('Créé à votre première demande') && byKb(none, 'kybernos-kyber-wake').length === 0 && byKb(none, 'kybernos-kyber-upsell').length === 0 && nodes(none).every((n) => n.tag !== 'select'))
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
    ok('being set up: « Initialisation », a spinner and the sentence for a machine dedicated to the person', textOf(one(creating, 'kybernos-kyber-computer-state')) === 'Initialisation' && /warn/.test(one(creating, 'kybernos-kyber-computer-state').props.className) && nodes(creating).some((n) => /kbky-spin/.test(n.props.className || '')) && said(creating).includes('Initialisation d’une machine dédiée pour vous. Environ une minute.'))
    const failed = computer({ id: 'aaaaaaaa-1111', name: 'Home', state: 'failed', manual_control: true })
    ok('a failure is a red chip, with its sentence', /err/.test(one(failed, 'kybernos-kyber-computer-state').props.className) && said(failed).includes('Il n’a pas démarré'))
    const paused = computer({ id: 'aaaaaaaa-1111', name: 'Home', state: 'suspended', manual_control: true, paused_reason: 'hours' })
    ok('hours used up is said as a warning', said(paused).includes('heures d’exécution du mois sont utilisées'))
  }
  {
    const many = computer({ id: 'bbbbbbbb-2222', name: 'Atelier', state: 'running', manual_control: true },
      [{ id: 'aaaaaaaa-1111', name: 'Home', state: 'suspended' }, { id: 'bbbbbbbb-2222', name: 'Atelier', state: 'running' }])
    const sel = one(many, 'kybernos-kyber-pick')
    ok('several computers: a real select, the linked one selected, named for a screen reader', sel !== undefined && sel.tag === 'select' && sel.props.value === 'bbbbbbbb-2222' && sel.kids.length === 2 && textOf(sel.kids[0]) === 'Home' && /Ordinateur lié à Kaby/.test(sel.props['aria-label']))
    answer = (u) => (u.endsWith('/kyby/computer') ? { ok: true, computer_id: 'aaaaaaaa-1111' } : { ok: true })
    await sel.props.onChange({ target: { value: 'aaaaaaaa-1111' } }); await flush()
    ok('choosing sends the id to the host, then reads the state again', calls[0].url === '/kybernos-cloud/kyby/computer' && calls[0].body.computer_id === 'aaaaaaaa-1111' && calls.some((c) => c.url === '/kybernos-cloud/kyber'))
    const kyberAnswer = { ok: true, connected: true, telegram: null, home: { id: 'bbbbbbbb-2222', name: 'Atelier', state: 'running' }, computers: [{ id: 'aaaaaaaa-1111', name: 'Home', state: 'suspended' }, { id: 'bbbbbbbb-2222', name: 'Atelier', state: 'running' }] }
    answer = (u) => (u.endsWith('/kyby/computer') ? { ok: false, error: 'not_found' } : (u === '/kybernos-cloud/kyber' ? kyberAnswer : { ok: true }))
    await sel.props.onChange({ target: { value: 'aaaaaaaa-1111' } }); await flush()
    ok('an older server that cannot keep the choice says so, in words', T.state.computerError === 'err_computer_old' && said(ui(T.views.ComputerTile, { view: T.state.view })).includes('Ce serveur ne sait pas encore enregistrer ce choix'))
    ok('one computer: nothing to select', nodes(computer({ id: 'aaaaaaaa-1111', name: 'Home', state: 'suspended', manual_control: true }, [{ id: 'aaaaaaaa-1111', name: 'Home', state: 'suspended' }])).every((n) => n.tag !== 'select'))
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
    const before = ui(T.views.Strip)
    const toggle = one(before, 'kybernos-kyber-code')
    ok('a waiting code offers « write a code instead », closed at first', toggle !== undefined && toggle.props['aria-expanded'] === 'false' && byKb(before, 'kybernos-kyber-code-box').length === 0)
    ok('and the panel says nothing of a console or an account page', !/console|account page|page du compte/i.test(textOf(one(before, 'kybernos-kyber-telegram'))))
    await press(before, 'kybernos-kyber-code')
    const opened = ui(T.views.Strip)
    ok('opened: the bot\'s name and the command to write, with the token of THIS pairing', one(opened, 'kybernos-kyber-code').props['aria-expanded'] === 'true' && textOf(one(opened, 'kybernos-kyber-code-box')).includes('@kybernos_bot') && textOf(one(opened, 'kybernos-kyber-code-text')) === '/start pair_abc', textOf(one(opened, 'kybernos-kyber-code-box')))
    ok('pressing it asked nothing of the host: no console link, no request at all', calls.length === 0, calls)
    await press(opened, 'kybernos-kyber-code-copy')
    ok('copy puts the command on the clipboard and says so', clip.length === 1 && clip[0] === '/start pair_abc' && textOf(one(ui(T.views.Strip), 'kybernos-kyber-code-copy')) === 'Copié')
    await press(opened, 'kybernos-kyber-code')
    ok('pressed again it closes', byKb(ui(T.views.Strip), 'kybernos-kyber-code-box').length === 0)
    T.state.showCode = true
    answer = (u) => (u.endsWith('/telegram/pairing/cancel') ? { ok: true } : { ok: true })
    await T.actions.pairCancel(); await flush()
    ok('a cancelled code closes the box with it', T.state.showCode === false && T.state.pairing === null)
    T.state.pairing = Object.assign(WAITING(), { state: 'scanned', sender: 'Miled' })
    T.state.showCode = true
    ok('once scanned there is no code to write any more', byKb(ui(T.views.Strip), 'kybernos-kyber-code-box').length === 0 && byKb(ui(T.views.Strip), 'kybernos-kyber-code').length === 0)
    T.state.pairing = Object.assign(WAITING(), { link: 'https://t.me/kybernos_bot?start=nothing' })
    T.state.showCode = false
    ok('a link that carries no token offers no code (nothing invented)', byKb(ui(T.views.Strip), 'kybernos-kyber-code').length === 0)
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
    ok('in the dock the strip is as wide as the composer\'s card (16 px in on each side) and has its radius (28 px)', /\.kbky-dock\{[^}]*padding:0 16px/.test(css) && /\.kbky-strip\{[^}]*border-radius:28px/.test(css))
    ok('the tiles and the panel have the radius that nests in it (16 px), the same one', /\.kbky-tile\{[^}]*border-radius:16px/.test(css) && /\.kbky-panel\{[^}]*border-radius:16px/.test(css))
  }

  globalThis.setTimeout = realTimeout
}

process.exit(fail > 0 ? 1 : 0)
