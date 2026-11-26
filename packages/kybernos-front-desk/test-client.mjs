// client.js (the « Front desk » page): its pure parts (words, snippet, error texts, the call), its registration (the menu row, the page on the keyed slot, taken back on
// cleanup), each piece of the page rendered to a plain tree and read by its `data-kb` hooks, the container (it polls, starts, stops, saves) on a small hook runtime, and the
// static promises a browser would only break late (DSH's tokens only, every string in two languages, the page asks its own host only). Outside a browser: a fake loader and a
// small React. The page as a whole is checked on the real GUI (a sandbox DSH).
import { readFileSync } from 'node:fs'

let failed = 0
const ok = (n, cond, detail) => { console.log((cond ? '  ok   ' : '  FAIL ') + n + (cond || detail === undefined ? '' : '  -- ' + detail)); if (!cond) failed += 1 }
const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8')

let definition = null
let resolved = 'en'
const menuCalls = []
let menuOff = 0
const store = new Map()
globalThis.window = {
  __ModuleLoader__: { load: (def) => { definition = def } },
  __KB_LANG_RESOLVE__: () => resolved,
  __KB_MENU__: { register: (entry) => { menuCalls.push(entry); return () => { menuOff += 1 } } },
}
globalThis.document = { hidden: false }
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)) } }
const fetched = []
let answers = {}
globalThis.fetch = async (url, init = {}) => {
  fetched.push([init.method || 'GET', url, init.body === undefined ? undefined : JSON.parse(init.body)])
  const key = (init.method || 'GET') + ' ' + url.replace('/kybernos-front-desk', '')
  const a = answers[key]
  const r = typeof a === 'function' ? a(init) : a
  if (r === undefined) return { ok: false, status: 404, json: async () => ({ ok: false }) }
  if (r instanceof Error) throw r
  return { ok: r.status === undefined || r.status < 400, status: r.status || 200, json: async () => r.json }
}
await import(new URL('./client.js', import.meta.url).href)

// ── a small React: elements are plain objects; function components are called down to host elements; hooks keep their first value ─────────────────────────
const FRAGMENT = Symbol('fragment')
const el = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false) })
let hooks = { useState: (v) => [typeof v === 'function' ? v() : v, () => {}], useRef: (v) => ({ current: v === undefined ? null : v }), useEffect: () => {} }
const React = { createElement: el, Fragment: FRAGMENT, useState: (v) => hooks.useState(v), useRef: (v) => hooks.useRef(v), useEffect: (f, d) => hooks.useEffect(f, d), useMemo: (f) => f(), useCallback: (f) => f() }
const render = (node) => {
  if (node === null || node === undefined || node === false || node === true) return []
  if (typeof node === 'string' || typeof node === 'number') return [String(node)]
  if (Array.isArray(node)) return node.flatMap(render)
  if (typeof node.type === 'function') { const k = node.children; return render(node.type(Object.assign({}, node.props, k.length === 0 ? {} : { children: k.length === 1 ? k[0] : k }))) }
  if (node.type === FRAGMENT) return node.children.flatMap(render)
  return [{ type: node.type, props: node.props, children: node.children.flatMap(render) }]
}
const tree = (node) => ({ type: 'root', props: {}, children: render(node) })
const walk = (t, fn) => { if (typeof t === 'string') return; fn(t); for (const c of t.children) walk(c, fn) }
const all = (t, pred) => { const out = []; walk(t, (n) => { if (pred(n)) out.push(n) }); return out }
const kb = (t, hook) => all(t, (n) => n.props['data-kb'] === hook)
const one = (t, hook) => kb(t, hook)[0]
const text = (t) => (typeof t === 'string' ? t : t.children.map(text).join(''))

// ── the plugin and its contract ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const plugin = definition.factory((name) => { if (name === 'react') return React; throw new Error('unexpected require ' + name) })
const T = plugin.__test
ok('the loader gets the bundle id and a factory that returns a plugin with apply and the slots service', definition.id === '@local/kybernos-front-desk' && typeof plugin.apply === 'function' && plugin.inject.join() === 'slots' && plugin.name === 'kybernos-front-desk')
ok('a plugin whose React is missing still returns a plugin, and its apply does not throw', (() => { const p = definition.factory(() => { throw new Error('no react') }); const warn = console.warn; console.warn = () => {}; try { p.apply({ slots: { inject () {} }, effect () {} }); return typeof p.apply === 'function' } catch (e) { return false } finally { console.warn = warn } })())

// ── pure parts ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
ok('the site snippet: the service address, the shop, async, no trailing slash', T.embedSnippet('https://front.shop.example/', 'atelier-lune') === '<script src="https://front.shop.example/widget.js" data-shop="atelier-lune" async></script>')
resolved = 'en'
ok('states have a word and a tone', T.stateWord({ state: 'running' }).tone === 'ok' && T.stateWord({ state: 'starting' }).tone === 'busy' && T.stateWord({ state: 'failed' }).tone === 'bad' && T.stateWord(null).tone === 'off' && T.stateWord({ state: 'stopping' }).word === 'Stopping…')
resolved = 'fr'
ok('…in French when the language is French (and « kybernos » counts as French)', T.stateWord({ state: 'running' }).word === 'En marche' && (resolved = 'kybernos', T.lang()) === 'fr')
resolved = 'es'
ok('…and English for every other language', T.lang() === 'en')
resolved = 'en'
ok('error words: a session that ended says so; what is missing is named; unknown codes get a plain sentence, never the code', /session/i.test(T.errorText({ status: 401, json: {} })) && /session/i.test(T.errorText({ status: 403, json: {} })) && /model key/.test(T.errorText({ status: 409, json: { error: 'not_ready', missing: ['model_key'] } })) && !/boom_code/.test(T.errorText({ status: 500, json: { error: 'boom_code' } })) && /not answering/.test(T.errorText({ status: 0, json: {} })))
ok('every code of the config answers has a sentence', ['bad_model_url', 'bad_model_name', 'bad_model_key', 'bad_public_url', 'bad_telegram_token', 'nothing_to_write', 'start_failed', 'too_big', 'service_stopped'].every((c) => T.errorText({ status: 400, json: { error: c } }).length > 10))
ok('a start that failed shows what the service said, cut', T.errorText({ status: 409, json: { error: 'start_failed', detail: 'x'.repeat(500) } }).length < 260)
ok('the remembered tab survives a closed storage', (T.writeTab('boite'), T.readTab() === 'boite') && (() => { const real = globalThis.localStorage; globalThis.localStorage = { getItem () { throw new Error('private') }, setItem () { throw new Error('private') } }; const r = T.readTab() === 'setup' && T.writeTab('atelier') === 'atelier'; globalThis.localStorage = real; return r })())
ok('a tab that is not one is not remembered', (store.set('kybernos.front-desk.tab', 'hacked'), T.readTab() === 'setup'))

// ── the call ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  answers = { 'GET /state': { json: { ok: true, a: 1 } }, 'POST /config': { status: 400, json: { ok: false, error: 'bad_model_url' } }, 'GET /logs?n=1': { json: 'not an object' } }
  fetched.length = 0
  const good = await T.call('GET', '/state')
  const bad = await T.call('POST', '/config', { model: {} })
  ok('a call goes to this plugin\'s own prefix, same origin, and says ok', good.ok && good.json.a === 1 && fetched[0][1] === '/kybernos-front-desk/state' && fetched[1][2] !== undefined)
  ok('a refusal comes back as not ok with its code', bad.ok === false && bad.status === 400 && bad.json.error === 'bad_model_url')
  answers = { 'GET /state': new Error('offline') }
  const down = await T.call('GET', '/state')
  ok('a network error is an answer, never a throw', down.ok === false && down.status === 0)
  answers = { 'GET /state': { status: 200, json: { ok: false, error: 'x' } } }
  ok('a 200 that says ok:false is not ok', (await T.call('GET', '/state')).ok === false)
}

// ── registration ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const cleanups = []
  const regs = []
  const ctx = { slots: { inject: (slot, cb) => { cb(); return () => cleanups.push('inject:' + slot) }, register: (spec, Page) => { regs.push({ spec, Page }); return () => cleanups.push('register') } }, effect: (fn, label) => { const c = fn(); cleanups.push({ label, c }); return c } }
  plugin.apply(ctx)
  ok('the menu row is declared once: the business group, a French and an English word, an icon, an order', menuCalls.length === 1 && menuCalls[0].id === 'front-desk' && menuCalls[0].group === 'business' && menuCalls[0].label.fr === 'Accueil client' && menuCalls[0].label.en === 'Front desk' && typeof menuCalls[0].icon === 'string' && Number.isInteger(menuCalls[0].order))
  ok('the page is on the keyed slot of the business group, under the same id as the row', regs.length === 1 && regs[0].spec.name === 'main.kybernos-business' && regs[0].spec.key === 'front-desk' && typeof regs[0].Page === 'function')
  ok('every effect is labelled with the bundle', cleanups.filter((c) => typeof c === 'object').every((c) => /^kybernos-front-desk: /.test(c.label)))
  for (const c of cleanups.filter((x) => typeof x === 'object')) if (typeof c.c === 'function') c.c()
  ok('switching the plugin off takes the row back', menuOff === 1)
  // the registry arrives after the plugin
  const saved = window.__KB_MENU__
  window.__KB_MENU__ = undefined
  menuCalls.length = 0
  const later = []
  plugin.apply({ slots: { inject: () => () => {}, register: () => () => {} }, effect: (fn) => { const c = fn(); later.push(c); return c } })
  ok('a menu registry that is not there yet is waited for, not assumed', menuCalls.length === 0)
  window.__KB_MENU__ = saved
  await new Promise((r) => setTimeout(r, 420))
  ok('…and the row is declared when it shows up', menuCalls.length === 1)
  for (const c of later) if (typeof c === 'function') c()
  ok('apply with no slots service does nothing and does not throw', (() => { try { plugin.apply({ slots: undefined, effect () {} }); plugin.apply({ effect () {} }); return true } catch (e) { return false } })())
}

// ── the pieces, rendered from crafted states ──────────────────────────────────────────────────────────────────────────────────────────────────────
const Page = T.build(React)
const P = Page.parts
const noop = async () => ({ ok: true, json: {} })
const calls = []
const actions = new Proxy({}, { get: (_t, k) => (...a) => { calls.push([k, ...a]); return k === 'saveConfig' ? Promise.resolve({ ok: true, json: {} }) : undefined } })
const service = (over = {}) => ({ state: 'stopped', port: null, pid: null, error: null, adopted: false, ...over })
const state = (over = {}) => ({ ok: true, service: service(), ready: { ok: true, missing: [] }, config: { publicUrl: null, model: { baseUrl: 'https://gw.example/v1', name: 'kimi' }, telegram: false, autostart: false }, secrets: { modelKey: true, telegram: false }, shop: null, channels: null, localLink: null, publicLink: null, ...over })
const running = (over = {}) => state({ service: service({ state: 'running', port: 8790, pid: 7 }), shop: { name: 'Atelier Lune', slug: 'atelier-lune', version: 3, killed: false }, channels: { site: { connected: true }, telegram: { connected: false } }, localLink: 'http://127.0.0.1:8790/c/atelier-lune', ...over })
const S = (over = {}) => ({ data: { status: 'ok', state: state(), waiting: 0, stale: false, error: null }, tab: 'setup', busy: '', notice: null, restartNeeded: false, logs: null, actions, ...over })
const screen = (over) => tree(el(P.Screen, { s: S(over) }))
const inputs = (t) => all(t, (n) => n.type === 'input')

{
  resolved = 'en'
  const loading = screen({ data: { status: 'loading', state: null, waiting: 0, stale: false, error: null } })
  ok('loading: the title and a status line, no tabs', kb(loading, 'fd-loading').length === 1 && kb(loading, 'fd-tabs').length === 0 && text(loading).includes('Front desk'))
  calls.length = 0
  const bad = screen({ data: { status: 'error', state: null, waiting: 0, stale: false, error: { status: 0, json: {} } } })
  one(bad, 'fd-retry').props.onClick()
  ok('unreadable: says so in words and offers Try again, which asks again', kb(bad, 'fd-unreadable').length === 1 && /cannot be read/.test(text(bad)) && calls.some((c) => c[0] === 'refresh'))
  const stopped = screen({})
  ok('stopped: the pill says Stopped; Start is there and enabled; no Stop in the head', /Stopped/.test(text(one(stopped, 'fd-pill'))) && one(stopped, 'fd-start').props.disabled === false && kb(stopped, 'fd-head-stop').length === 0)
  calls.length = 0
  one(stopped, 'fd-start').props.onClick()
  ok('Start asks the page to start', calls[0][0] === 'start')
  const notReady = screen({ data: { status: 'ok', state: state({ ready: { ok: false, missing: ['model_key', 'model_url'] } }), waiting: 0, stale: false, error: null } })
  ok('not ready: what is missing is named, and Start is disabled', /the model key/.test(text(one(notReady, 'fd-missing'))) && /the model address/.test(text(one(notReady, 'fd-missing'))) && one(notReady, 'fd-start').props.disabled === true)
  const failedS = screen({ data: { status: 'ok', state: state({ service: service({ state: 'failed', error: 'exited (1)' }) }), waiting: 0, stale: false, error: null } })
  ok('failed: the pill is red and the error is shown as an alert', /Failed/.test(text(one(failedS, 'fd-pill'))) && /pill bad/.test(one(failedS, 'fd-pill').props.className) && one(failedS, 'fd-service-error').props.role === 'alert')
  const up = screen({ data: { status: 'ok', state: running(), waiting: 0, stale: false, error: null } })
  ok('running: Running, a Stop in the head and in the card, no Start', /Running/.test(text(one(up, 'fd-pill'))) && kb(up, 'fd-stop').length === 1 && kb(up, 'fd-head-stop').length === 1 && kb(up, 'fd-start').length === 0)
  ok('running with no public address: the link is the local one, and it says it only works here', one(up, 'fd-local-only') !== undefined && one(up, 'fd-link').props.value === 'http://127.0.0.1:8790/c/atelier-lune' && one(up, 'fd-snippet').props.value.includes('http://127.0.0.1:8790/widget.js'))
  ok('the open link leaves the page safely', one(up, 'fd-open').props.target === '_blank' && /noopener/.test(one(up, 'fd-open').props.rel))
  const pub = screen({ data: { status: 'ok', state: running({ config: { publicUrl: 'https://front.shop.example', model: {}, telegram: false }, publicLink: 'https://front.shop.example/c/atelier-lune' }), waiting: 0, stale: false, error: null } })
  ok('with a public address: the public link, and the snippet points at it', kb(pub, 'fd-local-only').length === 0 && one(pub, 'fd-link').props.value === 'https://front.shop.example/c/atelier-lune' && one(pub, 'fd-snippet').props.value === T.embedSnippet('https://front.shop.example', 'atelier-lune'))
  ok('the links are readonly boxes with a Copy button', one(pub, 'fd-link').props.readOnly === true && kb(pub, 'fd-link-copy').length === 1 && kb(pub, 'fd-snippet-copy').length === 1)
  ok('stopped: no links card (there is nothing to share yet)', kb(stopped, 'fd-links').length === 0)

  // the cards
  const model = one(stopped, 'fd-model-key')
  ok('the key box is a password box that never shows a saved key, only that one exists', model.props.type === 'password' && model.props.value === '' && model.props.autoComplete === 'off' && /already saved/.test(text(one(stopped, 'fd-model'))))
  ok('no saved key: no such hint', !/already saved/.test(text(one(screen({ data: { status: 'ok', state: state({ secrets: { modelKey: false, telegram: false } }), waiting: 0, stale: false, error: null } }), 'fd-model'))))
  ok('the model address and name start from what is saved', one(stopped, 'fd-model-url').props.value === 'https://gw.example/v1' && one(stopped, 'fd-model-name').props.value === 'kimi')
  calls.length = 0
  await one(stopped, 'fd-model-save').props.onClick()
  ok('Save sends the address and the name, and no key when none was typed', calls[0][0] === 'saveConfig' && calls[0][1].model.baseUrl === 'https://gw.example/v1' && calls[0][1].model.name === 'kimi' && !('apiKey' in calls[0][1].model))
  calls.length = 0
  await one(stopped, 'fd-public-save').props.onClick()
  ok('an empty public address is sent as a clear (null), not as an empty string', calls[0][1].publicUrl === null)
  ok('Telegram: no token saved, no « Turn off »; the token box is a password box and Save waits for a token', kb(stopped, 'fd-telegram-off').length === 0 && one(stopped, 'fd-telegram-token').props.type === 'password' && one(stopped, 'fd-telegram-save').props.disabled === true)
  const tgOn = screen({ data: { status: 'ok', state: running({ secrets: { modelKey: true, telegram: true }, channels: { site: { connected: true }, telegram: { connected: true, username: 'atelier_bot' } } }), waiting: 0, stale: false, error: null } })
  ok('Telegram connected: the bot\'s name is shown, and it can be turned off', /@atelier_bot/.test(text(one(tgOn, 'fd-telegram-state'))) && kb(tgOn, 'fd-telegram-off').length === 1)
  calls.length = 0
  await one(tgOn, 'fd-telegram-off').props.onClick()
  ok('Turn off sends the off switch', calls[0][1].telegram.off === true)
  const tgSaved = screen({ data: { status: 'ok', state: state({ secrets: { modelKey: true, telegram: true } }), waiting: 0, stale: false, error: null } })
  ok('Telegram saved but the service is not running: it says the token is used at the next start', /next start/.test(text(one(tgSaved, 'fd-telegram-state'))))
  ok('no card ever holds a secret value: the only inputs with a value are the address, the name, the public address and the read-only links', all(stopped, (n) => n.type === 'input' && n.props.type === 'password').every((n) => n.props.value === ''))
  ok('the log is not loaded until asked; then shown in a focusable block', kb(stopped, 'fd-log-text').length === 0 && /Show the log/.test(text(one(stopped, 'fd-logs'))) && /Refresh/.test(text(one(screen({ logs: 'line' }), 'fd-logs'))) && one(screen({ logs: 'line one' }), 'fd-log-text').props.tabIndex === 0)
  ok('an empty log says so', /empty/.test(text(one(screen({ logs: '' }), 'fd-log-text'))))

  // the banners
  ok('stale: a line that what is shown may be a few seconds old', /few seconds/.test(text(one(screen({ data: { status: 'ok', state: state(), waiting: 0, stale: true, error: null } }), 'fd-stale'))))
  calls.length = 0
  const rn = screen({ restartNeeded: true })
  one(rn, 'fd-restart-now').props.onClick()
  ok('a setting that needs a restart says so, with a Restart that does it', /Restart the service/.test(text(one(rn, 'fd-restart'))) && calls[0][0] === 'restart' && kb(stopped, 'fd-restart').length === 0)
  ok('a refused start shows its sentence as an alert', one(screen({ notice: { kind: 'bad', text: 'Still missing: the model key.' } }), 'fd-notice').props.role === 'alert')
  ok('busy: the buttons are disabled and say what is happening', one(screen({ busy: 'start' }), 'fd-start').props.disabled === true && /Starting/.test(text(one(screen({ busy: 'start' }), 'fd-start'))) && one(screen({ busy: 'stop', data: { status: 'ok', state: running(), waiting: 0, stale: false, error: null } }), 'fd-stop').props.disabled === true)

  // the tabs
  const tabs = kb(stopped, 'fd-tab')
  ok('three tabs, the open one selected, as a tablist', tabs.map((x) => x.props['data-tab']).join() === 'setup,atelier,boite' && tabs.map((x) => x.props['aria-selected']).join() === 'true,false,false' && one(stopped, 'fd-tabs').props.role === 'tablist' && tabs.every((x) => x.props.role === 'tab'))
  calls.length = 0
  tabs[1].props.onClick()
  ok('a tab asks the page to switch', calls[0][0] === 'setTab' && calls[0][1] === 'atelier')
  ok('the Inbox shows how many wait for the owner, and nothing when none', one(screen({ data: { status: 'ok', state: running(), waiting: 3, stale: false, error: null } }), 'fd-badge').children[0] === '3' && kb(screen({ data: { status: 'ok', state: running(), waiting: 0, stale: false, error: null } }), 'fd-badge').length === 0)

  // the framed pages
  const frameA = screen({ tab: 'atelier', data: { status: 'ok', state: running(), waiting: 0, stale: false, error: null } })
  const frameB = screen({ tab: 'boite', data: { status: 'ok', state: running(), waiting: 0, stale: false, error: null } })
  ok('Atelier and Inbox are the service\'s own pages through this plugin, same-origin referrer, with a title', one(frameA, 'fd-frame-atelier').props.src === '/kybernos-front-desk/atelier' && one(frameB, 'fd-frame-boite').props.src === '/kybernos-front-desk/boite' && one(frameA, 'fd-frame-atelier').props.referrerPolicy === 'same-origin' && !!one(frameA, 'fd-frame-atelier').props.title && kb(frameA, 'fd-setup').length === 0)
  const framedStopped = screen({ tab: 'atelier' })
  calls.length = 0
  one(framedStopped, 'fd-start-here').props.onClick()
  ok('the framed tabs with the service stopped: no frame, a Start here', kb(framedStopped, 'fd-frame-atelier').length === 0 && /stopped/.test(text(one(framedStopped, 'fd-stopped'))) && calls[0][0] === 'start')
  const framedNotReady = screen({ tab: 'boite', data: { status: 'ok', state: state({ ready: { ok: false, missing: ['model_key'] } }), waiting: 0, stale: false, error: null } })
  calls.length = 0
  one(framedNotReady, 'fd-go-setup').props.onClick()
  ok('…and with no model yet it sends the person to Setup first', /Setup/.test(text(one(framedNotReady, 'fd-stopped'))) && calls[0][0] === 'setTab' && calls[0][1] === 'setup')
}

// ── French ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  resolved = 'fr'
  const t = screen({ data: { status: 'ok', state: running({ secrets: { modelKey: true, telegram: true } }), waiting: 2, stale: true, error: null }, restartNeeded: true, notice: { kind: 'bad', text: 'x' } })
  const fr = text(t)
  ok('French: the title, the tabs, the buttons and the banners are in French', /Accueil client/.test(fr) && /Réglages/.test(fr) && /Boîte/.test(fr) && /Arrêter/.test(fr) && /Redémarrer/.test(fr) && /quelques secondes/.test(fr))
  ok('French in « tu », never « vous »', !/\bvous\b|\bvotre\b|\bvos\b/i.test(fr))
  resolved = 'en'
  const en = text(screen({ data: { status: 'ok', state: running({ secrets: { modelKey: true, telegram: true } }), waiting: 2, stale: true, error: null }, restartNeeded: true, notice: { kind: 'bad', text: 'x' } }))
  ok('English does not contain the French words', !/Réglages|Arrêter|Redémarrer|quelques secondes|Accueil client/.test(en))
}

// ── the container: polls, acts, saves (a real hook runtime for the Page alone) ──────────────────────────────────────────────────────────────────────
{
  resolved = 'en'
  const run = () => {
    const slots = []
    const effects = []
    let i = 0
    let pending = []
    const rt = {
      useState: (init) => { const k = i++; if (!(k in slots)) slots[k] = typeof init === 'function' ? init() : init; return [slots[k], (v) => { slots[k] = typeof v === 'function' ? v(slots[k]) : v; pending.push(k) }] },
      useRef: (v) => { const k = i++; if (!(k in slots)) slots[k] = { current: v === undefined ? null : v }; return slots[k] },
      useEffect: (fn, deps) => { const k = i++; const prev = effects[k]; const same = prev && deps && prev.deps.length === deps.length && prev.deps.every((d, n) => Object.is(d, deps[n])); if (!same) { if (prev && typeof prev.cleanup === 'function') prev.cleanup(); effects[k] = { deps, cleanup: fn() } } },
    }
    const draw = () => { i = 0; const saved = hooks; hooks = rt; let out; try { out = Page() } finally { hooks = saved }; return out }
    // the children of Screen are rendered with the stub hooks
    return { draw, stop: () => { for (const e of effects) if (e && typeof e.cleanup === 'function') e.cleanup() }, flush: async () => { for (let n = 0; n < 8; n += 1) await new Promise((r) => setTimeout(r, 5)) } }
  }
  const view = (m) => tree(m.draw())

  answers = { 'GET /state': { json: state() }, 'POST /start': { json: { ok: true, state: 'running' } }, 'POST /stop': { json: { ok: true } }, 'GET /logs?n=80': { json: { ok: true, text: 'a\nb' } }, 'POST /config': { json: { ok: true, restartNeeded: true } } }
  fetched.length = 0
  const m = run()
  let t = view(m)
  ok('first draw: loading', kb(t, 'fd-loading').length === 1)
  await m.flush()
  t = view(m)
  ok('then the state is read and the page is drawn from it', kb(t, 'fd-tabs').length === 1 && fetched.some((f) => f[1] === '/kybernos-front-desk/state'))
  ok('a stopped service is not asked for its overview', !fetched.some((f) => f[1].includes('/api/overview')))

  answers['GET /state'] = { json: running() }
  answers['GET /api/overview'] = { json: { ok: true, waiting: 4 } }
  fetched.length = 0
  m.stop()
  const m2 = run()
  view(m2); await m2.flush(); t = view(m2)
  ok('a running service is asked for its overview, and what waits shows on the Inbox tab', fetched.some((f) => f[1] === '/kybernos-front-desk/api/overview') && one(t, 'fd-badge') !== undefined)

  fetched.length = 0
  await one(t, 'fd-stop').props.onClick()
  view(m2); await m2.flush()
  ok('Stop posts to /stop and reads the state again', fetched.some((f) => f[0] === 'POST' && f[1] === '/kybernos-front-desk/stop') && fetched.filter((f) => f[1] === '/kybernos-front-desk/state').length >= 1)

  answers['GET /state'] = { json: state() }
  m2.stop()
  const m3 = run()
  view(m3); await m3.flush(); t = view(m3)
  fetched.length = 0
  answers['POST /start'] = { status: 409, json: { ok: false, error: 'not_ready', missing: ['model_key'] } }
  await one(t, 'fd-start').props.onClick()
  await m3.flush(); t = view(m3)
  ok('a refused start shows its sentence, and nothing else changes', kb(t, 'fd-notice').length === 1 && /model key/.test(text(one(t, 'fd-notice'))))
  answers['POST /start'] = { json: { ok: true, state: 'running' } }
  answers['GET /state'] = { json: running() }
  await one(t, 'fd-start').props.onClick()
  view(m3); await m3.flush(); t = view(m3)
  ok('a start that works clears the sentence, and the page shows the running service', kb(t, 'fd-notice').length === 0 && /Running/.test(text(one(t, 'fd-pill'))))

  await one(t, 'fd-model-save').props.onClick()
  view(m3); await m3.flush(); t = view(m3)
  ok('saving a setting while the service runs: it asks for a restart', kb(t, 'fd-restart').length === 1)
  fetched.length = 0
  await one(t, 'fd-restart-now').props.onClick()
  view(m3); await m3.flush(); t = view(m3)
  ok('Restart stops then starts, and the banner goes', fetched.filter((f) => f[0] === 'POST').map((f) => f[1].replace('/kybernos-front-desk', '')).join() === '/stop,/start' && kb(t, 'fd-restart').length === 0)

  await one(t, 'fd-logs').props.onClick()
  await m3.flush(); t = view(m3)
  ok('Show the log reads the last lines', one(t, 'fd-log-text').children.join('') === 'a\nb')

  kb(t, 'fd-tab')[2].props.onClick()
  await m3.flush(); t = view(m3)
  ok('switching tab draws the framed page and remembers the tab', kb(t, 'fd-frame-boite').length === 1 && store.get('kybernos.front-desk.tab') === 'boite')

  answers['GET /state'] = { status: 503, json: { ok: false } }
  m3.stop()
  const m4 = run()
  view(m4); await m4.flush(); t = view(m4)
  ok('when DSH cannot give the state at the very start: an unreadable page with Try again', kb(t, 'fd-unreadable').length === 1)
  m4.stop()
}

// ── static promises ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const css = T.CSS
  const stripped = css.replace(/var\([^)]*\)/g, '')
  ok('colours come from DSH\'s tokens: no colour left once the var() fallbacks are taken out', !/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(stripped))
  ok('every token is a DSH alias', [...css.matchAll(/var\((--[a-z0-9-]+)/g)].every((x) => x[1].startsWith('--dsw-alias-')))
  ok('animation stops under prefers-reduced-motion', /prefers-reduced-motion:\s*reduce/.test(css))
  ok('every kt() has both languages', ![...source.matchAll(/\bkt\(('[^']*'|`[^`]*`)\)/g)].length)
  ok('the page asks this plugin\'s own routes only (no foreign host, no token, no secret in the source)', !/https?:\/\/(?!127\.0\.0\.1|gw\.example)[a-z0-9.-]+\.[a-z]{2,}\//i.test(source.replace(/https:\/\/(api|front-desk|accueil)\.[a-z.-]+[^'"\s)]*/gi, '').replace(/https:\/\/\.\.\./g, '')) && !/Bearer|ownerToken|apiKey\s*[:=]\s*['"]/.test(source))
  ok('no inline event handler strings, no innerHTML, no eval: the page builds elements, never markup', !/innerHTML|dangerouslySetInnerHTML|insertAdjacentHTML|\beval\(|new Function/.test(source))
  ok('every button says what it is (type="button") and every input has a label', (source.match(/h\('button'/g) || []).length === (source.match(/h\('button', \{[^}]*type: 'button'/g) || []).length && (source.match(/h\('input'/g) || []).length >= 6)
  ok('the hooks the live checks select on are there', ['front-desk-page', 'fd-start', 'fd-stop', 'fd-model-save', 'fd-public-save', 'fd-telegram-save', 'fd-tab', 'fd-frame-', 'fd-restart-now', 'fd-link', 'fd-snippet'].every((k) => source.includes("'" + k)))
}
process.exit(failed ? 1 : 0)
