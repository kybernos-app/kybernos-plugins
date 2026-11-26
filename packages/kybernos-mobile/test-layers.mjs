// kybernos-mobile, slice 2: what the shell can open (`KybernosCaps/<list>` in the user agent) and the layers (docs/dev/kaby-mode-shell-contract.md §1b and §8),
// on a minimal fake window and document. The real page is read by hand in the sandbox (see the slice-2 report).
//   node packages/kybernos-mobile/test-layers.mjs
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + JSON.stringify(detail).slice(0, 400)))
  if (!ok) failed += 1
}
const here = fileURLToPath(new URL('.', import.meta.url))
const SOURCE = readFileSync(join(here, 'client.js'), 'utf8')
const CONTRACT = readFileSync(join(here, '..', '..', 'docs', 'dev', 'kaby-mode-shell-contract.md'), 'utf8')

const IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KybernosHost/0.1.0 (ios)'

// ── the plugin, loaded on a bare window (its test exports only) ──────────────────
const load = (ua) => {
  let def = null
  globalThis.window = { __ModuleLoader__: { load: (d) => { def = d } }, matchMedia: () => ({ matches: true }), navigator: { userAgent: ua === undefined ? IOS : ua } }
  const bare = { body: {}, createElement: () => ({}), querySelector: () => null, addEventListener () {}, removeEventListener () {} }
  globalThis.document = bare
  new Function('window', 'document', SOURCE)(globalThis.window, globalThis.document)
  return def.factory().__test
}
const T = load()

// ── a fake world: timers you advance by hand, a history, a document with sheets you add and remove ───────────────
const makeWorld = ({ phone = true, historyOn = true } = {}) => {
  let clock = 0
  let seq = 0
  const timers = []
  const docListeners = []
  const winListeners = []
  const events = []
  const posted = []
  const state = { sheets: [], dialogs: [], settings: null, card: null, menuOpen: false, closedMenu: 0, ticks: 0 }
  const el = (tokens, extra = {}) => {
    const e = {
      tokens, parentElement: null, attrs: {}, style: { props: {}, setProperty (k, v) { this.props[k] = v }, removeProperty (k) { delete this.props[k] } }, scrollTop: 0,
      matches (sel) { return String(sel).split(',').some((s) => tokens.indexOf(s.trim()) >= 0) },
      closest (sel) { return this.matches(sel) ? this : (this.parentElement !== null ? this.parentElement.closest(sel) : null) },
      getBoundingClientRect: () => ({ width: 300, height: 200, left: 0, top: 400, right: 300, bottom: 600 }),
      dispatchEvent (ev) { events.push({ el: e, type: ev.type, key: ev.key }) },
      setAttribute (k, v) { this.attrs[k] = String(v) },
      removeAttribute (k) { delete this.attrs[k] },
      hasAttribute (k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) },
      remove () { this.removed = true },
      addEventListener () {},
      className: ''
    }
    return Object.assign(e, extra)
  }
  const body = el(['body'], { children: [], appendChild (c) { this.children.push(c); return c } })
  const root = el(['html'])
  const doc = {
    body,
    documentElement: root,
    activeElement: null,
    createElement: () => el(['div']),
    querySelectorAll: (sel) => (sel.indexOf('role="menu"') >= 0 ? state.sheets : (sel.indexOf('role="dialog"') >= 0 ? state.dialogs : [])),
    querySelector: (sel) => (sel.indexOf('workspace-card') >= 0 ? state.card : (sel.indexOf('settings') >= 0 ? state.settings : null)),
    addEventListener: (type, fn) => docListeners.push({ type, fn }),
    removeEventListener: (type, fn) => { const i = docListeners.findIndex((l) => l.type === type && l.fn === fn); if (i >= 0) docListeners.splice(i, 1) }
  }
  const history = {
    state: null,
    pushes: [],
    gos: [],
    pushState (s) { this.state = s; this.pushes.push(s) },
    go (n) { this.gos.push(n) }
  }
  const win = {
    innerWidth: 390,
    innerHeight: 844,
    history,
    setTimeout: (fn, ms) => { seq += 1; timers.push({ fn, at: clock + ms, id: seq }); return seq },
    clearTimeout: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1) },
    requestAnimationFrame: (fn) => { fn(); return 1 },
    getComputedStyle: (e) => ({ zIndex: e.z === undefined ? 'auto' : String(e.z), position: e.pos === undefined ? 'static' : e.pos, willChange: e.wc === undefined ? 'auto' : e.wc, isolation: e.iso === undefined ? 'auto' : e.iso }),
    KeyboardEvent: class { constructor (type, init) { this.type = type; Object.assign(this, init) } },
    MutationObserver: class { observe () {} disconnect () {} },
    addEventListener: (type, fn) => winListeners.push({ type, fn }),
    removeEventListener: (type, fn) => { const i = winListeners.findIndex((l) => l.type === type && l.fn === fn); if (i >= 0) winListeners.splice(i, 1) }
  }
  const hooks = {
    menuOpen: () => state.menuOpen,
    closeMenu: () => { state.closedMenu += 1; state.menuOpen = false },
    phone: () => phone,
    history: () => historyOn,
    post: (type, fields) => { posted.push(Object.assign({ type }, fields)); return true },
    tick: () => { state.ticks += 1 }
  }
  const advance = (ms) => {
    const end = clock + ms
    for (;;) {
      timers.sort((a, b) => a.at - b.at)
      if (timers.length === 0 || timers[0].at > end) break
      const t = timers.shift(); clock = Math.max(clock, t.at); t.fn()
    }
    clock = end
  }
  const fire = (target, type, ev) => { for (const l of (target === 'win' ? winListeners : docListeners).filter((x) => x.type === type)) l.fn(ev) }
  return { win, doc, hooks, state, posted, events, history, advance, fire, el, body, timers, docListeners, winListeners }
}
const sheet = (w, extra) => { const s = w.el(['[role="menu"]'], extra); w.state.sheets.push(s); return s }
const layerMessages = (w) => w.posted.filter((m) => m.type === 'layers')

console.log('what the user agent lists')
{
  const P = T.parseCaps
  check('the names the shell lists, in the order we know them', JSON.stringify(P(IOS + ' KybernosCaps/where,account,plans')) === '["account","plans","where"]', P(IOS + ' KybernosCaps/where,account,plans'))
  check('a name we do not know is dropped, a repeated one counts once', JSON.stringify(P(IOS + ' KybernosCaps/plans,beta,plans')) === '["plans"]', P(IOS + ' KybernosCaps/plans,beta,plans'))
  check('no list, an empty list, a malformed list: nothing is drawn', P(IOS).length === 0 && P(IOS + ' KybernosCaps/').length === 0 && P(IOS + ' KybernosCaps/ACCOUNT').length === 0 && P(IOS + ' KybernosCaps/;rm').length === 0)
  check('a list without the app\'s own token is not read (a web page cannot ask for the shell\'s entries)', P('Mozilla/5.0 KybernosCaps/account,plans,where').length === 0 && P('').length === 0 && P(undefined).length === 0 && P(null).length === 0)
  check('the token may come before the app\'s own token or after it', JSON.stringify(P('Mozilla/5.0 KybernosCaps/account KybernosHost/0.1.0 (ios)')) === '["account"]')
  check('`signout` (the account menu\'s last row) is a name we know, after the others', JSON.stringify(P(IOS + ' KybernosCaps/signout,where,account')) === '["account","where","signout"]', P(IOS + ' KybernosCaps/signout,where,account'))
  check('`referral` (the account menu\'s Referral row) is a name we know, between Plans and Where', JSON.stringify(P(IOS + ' KybernosCaps/where,referral,account,plans')) === '["account","plans","referral","where"]', P(IOS + ' KybernosCaps/where,referral,account,plans'))
  check('`mode` (the Simple/Advanced switch line) is a name we know, after the others', JSON.stringify(P(IOS + ' KybernosCaps/mode,where,account')) === '["account","where","mode"]', P(IOS + ' KybernosCaps/mode,where,account'))
}

console.log('the layers in the page')
{
  const w = makeWorld()
  check('nothing open: no layer', T.layerList(w.doc, w.win, false).length === 0)
  const s = sheet(w)
  const dialog = w.el(['[role="dialog"]']); w.state.dialogs.push(dialog)
  const drawer = w.el(['[role="dialog"]', '[data-shortcut-modal="sidebar"]']); w.state.dialogs.push(drawer)
  w.state.settings = w.el(['[data-shortcut-modal="settings"]'])
  const list = T.layerList(w.doc, w.win, true)
  check('top first: a sheet, a dialog, Settings, the menu; the drawer\'s own dialog is the menu and counts once', list.map((l) => l.kind).join() === 'sheet,dialog,settings,menu', list.map((l) => l.kind))
  check('the menu is the root: the sheet is on top of it', list[0].el === s && list[3].kind === 'menu')
  w.state.sheets[0] = w.el(['[role="menu"]'], { getBoundingClientRect: () => ({ width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 }) })
  check('an element with no size is not a layer', T.layerList(w.doc, w.win, false).every((l) => l.kind !== 'sheet'))
  const hidden = w.el(['[role="menu"]'], { closest: (sel) => (sel === '[inert]' ? {} : null) })
  w.state.sheets[0] = hidden
  check('what sits in an inert tree (the shut drawer) is not a layer', T.layerList(w.doc, w.win, false).every((l) => l.kind !== 'sheet'))
  w.state.sheets.length = 0
  for (let i = 0; i < 20; i += 1) w.state.dialogs.push(w.el(['[role="dialog"]']))
  check('never more than eight layers, whatever the page holds', T.layerList(w.doc, w.win, true).length <= 8)
}

console.log('the layers told to the shell and closed by it')
{
  const w = makeWorld()
  const layers = T.createLayers(w.win, w.doc, w.hooks)
  layers.start()
  check('at start the shell is told nothing is open (depth 0, no top)', JSON.stringify(layerMessages(w)) === '[{"type":"layers","depth":0}]', layerMessages(w))
  const s = sheet(w)
  layers.report()
  check('a sheet opens: depth 1, top is a sheet', JSON.stringify(layerMessages(w).slice(-1)) === '[{"type":"layers","depth":1,"top":"sheet"}]', layerMessages(w))
  layers.report()
  check('the same state is not told twice', layerMessages(w).length === 2, layerMessages(w))
  check('one history entry for the layer, the address left alone', w.history.pushes.length === 1 && w.history.pushes[0].kbLayer === 1, w.history.pushes)
  check('the page dims behind an engine sheet: one scrim', w.body.children.filter((c) => c.className === 'kbmob-scrim').length === 1)
  const ours = w.el(['.kbmob-sheet', '[role="menu"]'])
  w.state.sheets.push(ours)
  layers.report()
  check('a second layer is told (depth 2) and gets its own history entry', layerMessages(w).slice(-1)[0].depth === 2 && w.history.pushes.length === 2, { m: layerMessages(w).slice(-1), p: w.history.pushes })
  check('our own sheets draw their own mask: no second scrim', w.body.children.filter((c) => c.className === 'kbmob-scrim').length === 1)
  w.state.sheets.length = 0
  w.state.sheets.push(s)
  w.state.menuOpen = true
  layers.report()
  check('the drawer is a layer too: it is the root, under the sheet', layerMessages(w).slice(-1)[0].depth === 2 && layerMessages(w).slice(-1)[0].top === 'sheet')
  // close, the shell's way: the sheet is closed with Escape, and the drawer with its own hook
  check('close-layer closes the top layer and answers true', layers.close() === true)
  check('a sheet is closed by an Escape key sent to it (the engine closes its own menus on it)', w.events.some((e) => e.key === 'Escape' && e.type === 'keydown' && e.el === s), w.events)
  w.state.sheets.length = 0
  w.advance(500)
  check('the layer left: the shell is told depth 1, top menu', JSON.stringify(layerMessages(w).slice(-1)) === '[{"type":"layers","depth":1,"top":"menu"}]', layerMessages(w).slice(-1))
  layers.close()
  check('with the drawer on top, close-layer shuts the drawer by its own hook', w.state.closedMenu === 1)
  w.advance(500)
  check('nothing is left open: depth 0, the scrim is gone, and close-layer answers false', JSON.stringify(layerMessages(w).slice(-1)) === '[{"type":"layers","depth":0}]' && layers.close() === false && w.body.children.every((c) => c.className !== 'kbmob-scrim' || c.removed === true), layerMessages(w).slice(-1))
  layers.stop()
  check('stopping takes the page\'s listeners away', w.docListeners.length === 0 && w.winListeners.length === 0, { d: w.docListeners.length, w: w.winListeners.length })
}

console.log('the system Back and the history')
{
  const w = makeWorld()
  const layers = T.createLayers(w.win, w.doc, w.hooks)
  layers.start()
  const s = sheet(w)
  layers.report()
  w.fire('win', 'popstate', {})
  check('Back with a layer open closes it (Escape on the sheet) and does not leave the screen', w.events.some((e) => e.key === 'Escape' && e.el === s) && w.history.gos.length === 0, { ev: w.events, gos: w.history.gos })
  w.state.sheets.length = 0
  layers.report()
  check('the entry was spent by the Back itself: nothing more to undo', w.history.gos.length === 0, w.history.gos)
  const s2 = sheet(w)
  layers.report()
  w.state.sheets.length = 0
  layers.report()
  check('a layer closed by the page itself takes its history entry with it (one step back)', w.history.gos.length === 1 && w.history.gos[0] === -1, w.history.gos)
  w.fire('win', 'popstate', {})
  check('and that step back is not read as a Back press', w.events.filter((e) => e.key === 'Escape' && e.el === s2).length === 0, w.events)
  const off = makeWorld({ historyOn: false })
  const l2 = T.createLayers(off.win, off.doc, off.hooks)
  l2.start(); sheet(off); l2.report()
  check('where the page keeps no history (a wide screen) there is no entry, the message still goes', off.history.pushes.length === 0 && layerMessages(off).slice(-1)[0].depth === 1)
  const desk = makeWorld({ phone: false })
  const l3 = T.createLayers(desk.win, desk.doc, desk.hooks)
  l3.start(); sheet(desk); l3.report()
  check('off a phone nothing is dimmed and nothing is dragged', desk.body.children.length === 0)
}

console.log('the sheets under the scrim, and the swipe')
{
  const w = makeWorld()
  const layers = T.createLayers(w.win, w.doc, w.hooks)
  layers.start()
  const box = w.el(['box'], { z: 1 })
  const s = sheet(w)
  s.parentElement = box
  layers.report()
  check('a box with its own z-index around a sheet is lifted while the sheet is open (it would keep the sheet under the scrim)', box.attrs['data-kbmob-lift'] === '', box.attrs)
  box.z = 'auto'
  layers.report()
  check('a box already lifted stays lifted (it reads `auto` now): no flicker', box.attrs['data-kbmob-lift'] === '', box.attrs)
  w.state.sheets.length = 0
  layers.report()
  check('the sheet closes: the box gets its z-index back', box.attrs['data-kbmob-lift'] === undefined, box.attrs)
  // DSH 0.2.2 keeps the composer's seat `position: sticky` with no z-index: still a stacking context, the « + » sheet inside it stayed under the scrim and its rows could not be tapped (2026-11-08)
  const seat = w.el(['seat'], { pos: 'sticky' })
  const s3 = sheet(w)
  s3.parentElement = seat
  layers.report()
  check('a sticky box around a sheet is lifted too, and told apart from the z-index ones', seat.attrs['data-kbmob-lift'] === 'sticky', seat.attrs)
  seat.pos = 'relative'
  layers.report()
  check('...it reads relative once lifted and stays lifted (the value is kept)', seat.attrs['data-kbmob-lift'] === 'sticky', seat.attrs)
  w.state.sheets.length = 0
  layers.report()
  check('the sheet closes: the sticky box is itself again', seat.attrs['data-kbmob-lift'] === undefined, seat.attrs)
  const will = w.el(['will'], { wc: 'transform' })
  sheet(w).parentElement = will
  layers.report()
  check('a box with `will-change: transform` (the seat\'s) is lifted too: it is a stacking context and the fixed sheet\'s containing block', will.attrs['data-kbmob-lift'] === '', will.attrs)
  w.state.sheets.length = 0
  layers.report()
  check('...and gets it back when the sheet closes', will.attrs['data-kbmob-lift'] === undefined, will.attrs)
  // DSH 0.2.2-rc.5: the conversation's root is `isolation: isolate`, a stacking context with no z-index: the model picker's sheet stayed under the scrim, dimmed, and a tap on its search field closed it (2026-11-20)
  const iso = w.el(['iso'], { iso: 'isolate' })
  sheet(w).parentElement = iso
  layers.report()
  check('an isolating box around a sheet is lifted too (a stacking context with no z-index): the sheet would stay under the scrim', iso.attrs['data-kbmob-lift'] === '', iso.attrs)
  w.state.sheets.length = 0
  layers.report()
  check('...and isolates again when the sheet closes', iso.attrs['data-kbmob-lift'] === undefined, iso.attrs)
  sheet(w).parentElement = box
  box.z = 1
  layers.report()
  const target = w.state.sheets[0]
  w.fire('doc', 'touchstart', { target, touches: [{ clientY: 420 }] })
  w.fire('doc', 'touchmove', { target, touches: [{ clientY: 480 }] })
  check('the finger drags the sheet down by the distance (--kbmob-drag)', target.style.props['--kbmob-drag'] === '60px', target.style.props)
  w.fire('doc', 'touchend', {})
  check('a short pull lets go: the sheet comes back, nothing is closed', target.style.props['--kbmob-drag'] === undefined && w.events.length === 0, { p: target.style.props, ev: w.events })
  w.fire('doc', 'touchstart', { target, touches: [{ clientY: 420 }] })
  w.fire('doc', 'touchmove', { target, touches: [{ clientY: 600 }] })
  w.fire('doc', 'touchend', {})
  check('a pull of more than 96 px closes the sheet', w.events.some((e) => e.key === 'Escape' && e.el === target), w.events)
  const scrolled = sheet(w, { scrollTop: 30 })
  w.events.length = 0
  w.fire('doc', 'touchstart', { target: scrolled, touches: [{ clientY: 420 }] })
  w.fire('doc', 'touchmove', { target: scrolled, touches: [{ clientY: 700 }] })
  w.fire('doc', 'touchend', {})
  check('a list that is scrolled down scrolls: the pull does not close it', w.events.length === 0, w.events)
  w.fire('doc', 'touchstart', { target: w.el(['plain']), touches: [{ clientY: 100 }, { clientY: 200 }] })
  w.fire('doc', 'touchend', {})
  check('two fingers, or a touch outside a sheet, are not a pull', w.events.length === 0)
  layers.stop()
  check('stopping gives every lifted box back its z-index', box.attrs['data-kbmob-lift'] === undefined)
}

console.log('what the shell says to the page, and what the page says to the shell')
{
  check('without a mounted page, close-layer finds nothing to close', T.receiveShell(JSON.stringify({ kybernos: 'close-layer', version: 1 })) === false)
  check('an unknown message, a broken one, a huge one: false, never a throw', T.receiveShell('{"kybernos":"other"}') === false && T.receiveShell('not json') === false && T.receiveShell(null) === false && T.receiveShell(undefined) === false && T.receiveShell('x'.repeat(9000)) === false && T.receiveShell(42) === false)
  const sent = []
  globalThis.window.ReactNativeWebView = { postMessage: (m) => sent.push(m) }
  check('a message for the shell is `{ kybernos, version: 1, ... }` in the app\'s WebView', T.shellPost('layers', { depth: 1, top: 'sheet' }) === true && sent.length === 1 && JSON.parse(sent[0]).version === 1 && JSON.parse(sent[0]).kybernos === 'layers' && JSON.parse(sent[0]).top === 'sheet', sent)
  globalThis.window.navigator.userAgent = 'Mozilla/5.0 (Macintosh)'
  check('outside the app\'s WebView nothing is posted', T.shellPost('layers', { depth: 0 }) === false && sent.length === 1)
  globalThis.window.navigator.userAgent = IOS
  delete globalThis.window.ReactNativeWebView
  check('without the WebView bridge it is false, not a throw', T.shellPost('layers', { depth: 0 }) === false)
  check('Kaby mode can open the new screen `where`, with the others', Array.isArray(T.KABY_SCREENS) ? T.KABY_SCREENS.indexOf('where') >= 0 : Object.keys(T.KABY_SCREENS).indexOf('where') >= 0, T.KABY_SCREENS)
}

console.log('a page\'s create dropdown and a Settings page, as layers (measured on a phone: the dropdown hung from the button\'s old place; Back left Settings from one of its pages)')
{
  check('the dropdowns of the two floating actions (Skills « Create a skill », Agent Teams « Create ») are sheets', T.SHEET_SEL.includes(T.DROPDOWN_SEL) && /\.kb-menu/.test(T.DROPDOWN_SEL) && /\.kb8-newmenu/.test(T.DROPDOWN_SEL) && /\.kb6-headrow \.kb8-primary \+ /.test(T.DROPDOWN_SEL), T.DROPDOWN_SEL)
  // a dropdown that does not listen to Escape (Agent Teams): the button before it, the one that opened it, shuts it
  const w = makeWorld()
  w.doc.createElement = () => { const e = w.el(['div']); e.addEventListener = (t, fn) => { e.handlers = Object.assign(e.handlers || {}, { [t]: fn }) }; return e }
  const layers = T.createLayers(w.win, w.doc, w.hooks)
  layers.start()
  let clicks = 0
  const opener = w.el(['button'], { click () { clicks += 1; w.state.sheets.length = 0; menu.isConnected = false } })
  const menu = w.el(['.kb6-headrow .kb8-primary + .kb-menu'], { previousElementSibling: opener })
  w.state.sheets.push(menu)
  layers.report()
  check('the open dropdown is a layer: depth 1, top is a sheet, the page dims behind it', JSON.stringify(layerMessages(w).slice(-1)) === '[{"type":"layers","depth":1,"top":"sheet"}]' && w.body.children.filter((c) => c.className === 'kbmob-scrim').length === 1, layerMessages(w).slice(-1))
  check('close-layer sends it an Escape, and a dropdown that ignores it is shut by its opener a moment later', layers.close() === true && w.events.some((e) => e.key === 'Escape' && e.el === menu) && clicks === 0)
  w.advance(150)
  check('…the opener is pressed once', clicks === 1, clicks)
  w.advance(500)
  check('…and the layer is gone: the shell is told depth 0', JSON.stringify(layerMessages(w).slice(-1)) === '[{"type":"layers","depth":0}]', layerMessages(w).slice(-1))
  // a dropdown that closes on Escape by itself (Skills): the opener is NOT pressed, which would open it again
  const menu2 = w.el(['.kb6-headrow .kb8-primary + .kb-menu'], { previousElementSibling: opener })
  w.state.sheets.push(menu2)
  layers.report()
  layers.close()
  w.state.sheets.length = 0; menu2.isConnected = false
  w.advance(500)
  check('a dropdown that closed by itself is not toggled back open', clicks === 1, clicks)
  // the tap on the dimmed page closes a dropdown the engine does not watch
  const menu3 = w.el(['.kb6-headrow .kb8-primary + .kb8-newmenu'], { previousElementSibling: opener })
  menu3.isConnected = true
  w.state.sheets.push(menu3)
  opener.click = () => { clicks += 1; w.state.sheets.length = 0; menu3.isConnected = false }
  layers.report()
  const scrim = w.body.children.filter((c) => c.className === 'kbmob-scrim').pop()
  check('the scrim listens to a tap', scrim !== undefined && scrim.handlers !== undefined && typeof scrim.handlers.click === 'function')
  scrim.handlers.click({ stopPropagation () {}, preventDefault () {} })
  w.advance(150)
  check('a tap on the scrim closes the dropdown through its opener', clicks === 2 && w.events.some((e) => e.key === 'Escape' && e.el === menu3), { clicks })
  layers.stop()
}
{
  // Settings: Back from one of its pages goes to the list first, and only a Back from the list leaves Settings
  const w = makeWorld()
  const layers = T.createLayers(w.win, w.doc, w.hooks)
  layers.start()
  const settings = w.el(['[data-shortcut-modal="settings"]'])
  w.state.settings = settings
  w.state.menuOpen = true
  layers.report()
  check('Settings open on its list: two layers (the menu under it), one history entry each', layerMessages(w).slice(-1)[0].depth === 2 && layerMessages(w).slice(-1)[0].top === 'settings' && w.history.pushes.length === 2, { m: layerMessages(w).slice(-1), p: w.history.pushes.length })
  settings.setAttribute(T.SETTINGS_PAGE_ATTR, '1') // a page is picked
  check('the page mark is the one the phone look reads (data-kbmob-page)', T.SETTINGS_PAGE_ATTR === 'data-kbmob-page')
  check('Back from a page answers true, shows the list again, sends no Escape and does not close the menu under it', layers.close() === true && !settings.hasAttribute(T.SETTINGS_PAGE_ATTR) && w.events.length === 0 && w.state.closedMenu === 0, { ev: w.events.length, closed: w.state.closedMenu })
  w.advance(500)
  check('Settings is still the top layer', JSON.stringify(layerMessages(w).slice(-1)) === '[{"type":"layers","depth":2,"top":"settings"}]', layerMessages(w).slice(-1))
  // the system Back: the browser has already taken the layer\'s history entry; it is given back because Settings stays open
  settings.setAttribute(T.SETTINGS_PAGE_ATTR, '1')
  w.history.go = function (n) { this.gos.push(n) }
  const before = w.history.pushes.length
  w.fire('win', 'popstate', {})
  w.advance(500)
  check('the system Back from a page goes to the list, and its history entry is pushed again (the next Back finds one)', !settings.hasAttribute(T.SETTINGS_PAGE_ATTR) && w.history.pushes.length === before + 1 && w.events.length === 0, { attr: settings.hasAttribute(T.SETTINGS_PAGE_ATTR), pushes: w.history.pushes.length, before, ev: w.events.length })
  check('Back from the list closes Settings as before (an Escape sent to it)', layers.close() === true && w.events.some((e) => e.key === 'Escape' && e.el === settings), w.events)
  layers.stop()
}

console.log('the web\'s account menu is a sheet that closes by its own card')
{
  // An Escape on the page also reaches the engine, which closes the DRAWER under the sheet with it (measured on the app, 2026-11-08): the menu is closed by the card's button.
  const w = makeWorld()
  const layers = T.createLayers(w.win, w.doc, w.hooks)
  layers.start()
  let clicks = 0
  w.state.card = w.el(['x'], { click () { clicks += 1 }, getAttribute: (k) => (k === 'aria-expanded' ? 'true' : null) })
  w.state.sheets.push(w.el(['[role="menu"]', '.kbfp-menu']))
  check('the account menu is a layer, reported as a sheet', layers.depth() === 1)
  check('Back presses the card\'s button and sends no Escape', layers.close() === true && clicks === 1 && w.events.length === 0, { clicks, ev: w.events.length })
  w.state.card = null
  check('without the card, the Escape is the way', layers.close() === true && w.events.some((e) => e.key === 'Escape'), w.events)
  layers.stop()
}

console.log('an in-page screen is the lowest layer: Back leaves the page, then the drawer, then the app (step 6, contract §8)')
{
  // The real page: `pageOpen` reads `data-kbmob-view="page"`; `leavePage` clicks the Kaby row (the page goes) and, 300 ms later, opens the drawer over the screen it was opened from.
  const world = () => {
    const w = makeWorld()
    w.state.page = false
    w.state.leftPage = 0
    w.hooks.pageOpen = () => w.state.page === true
    w.hooks.leavePage = () => { w.state.leftPage += 1; w.state.page = false; w.win.setTimeout(() => { w.state.menuOpen = true }, 300); return true }
    return w
  }
  const last = (w) => layerMessages(w).slice(-1)[0]
  {
    const w = world()
    w.state.page = true
    const l = T.layerList(w.doc, w.win, false, true)
    check('a page alone is one layer of kind `page`', l.length === 1 && l[0].kind === 'page', l.map((x) => x.kind))
    check('no page without the hook (a world that does not tell): no layer, as before', T.layerList(w.doc, w.win, false).length === 0 && T.layerList(w.doc, w.win, false, false).length === 0)
    sheet(w)
    const dialog = w.el(['[role="dialog"]']); w.state.dialogs.push(dialog)
    w.state.settings = w.el(['[data-shortcut-modal="settings"]'])
    const all = T.layerList(w.doc, w.win, true, true)
    check('top first: a sheet, a dialog, Settings, the menu, then the page: the page is the LOWEST', all.map((x) => x.kind).join() === 'sheet,dialog,settings,menu,page', all.map((x) => x.kind))
  }
  {
    const w = world()
    const layers = T.createLayers(w.win, w.doc, w.hooks)
    layers.start()
    w.state.page = true
    layers.report()
    check('on a page the shell is told `layers {depth: 1, top: "page"}`', JSON.stringify(last(w)) === '{"type":"layers","depth":1,"top":"page"}', last(w))
    w.state.menuOpen = true
    layers.report()
    check('the drawer open over a page: `depth: 2, top: "menu"`', JSON.stringify(last(w)) === '{"type":"layers","depth":2,"top":"menu"}', last(w))
    sheet(w)
    layers.report()
    check('a sheet on top of a page (and the drawer): `top: "sheet"`', last(w).top === 'sheet' && last(w).depth === 3, last(w))
    w.state.sheets.length = 0
    layers.report()
    // the sequence the owner expects from « Reminders »: Back closes the drawer, Back leaves the page for the chat and opens the drawer over it, Back closes the drawer, Back asks to quit
    check('Back 1 (drawer over the page): the drawer shuts, the page is still counted', layers.close() === true && w.state.closedMenu === 1, { closed: w.state.closedMenu })
    w.advance(700)
    check('...`depth: 1, top: "page"`', JSON.stringify(last(w)) === '{"type":"layers","depth":1,"top":"page"}', last(w))
    check('Back 2 (the page): `close-layer` answers true and the page is left once', layers.close() === true && w.state.leftPage === 1, { left: w.state.leftPage })
    w.advance(700)
    check('...the page is gone and the drawer is open over the chat: `depth: 1, top: "menu"`', JSON.stringify(last(w)) === '{"type":"layers","depth":1,"top":"menu"}', last(w))
    check('Back 3 (the drawer over the chat): the drawer shuts', layers.close() === true && w.state.closedMenu === 2)
    w.advance(700)
    check('...`depth: 0`: the chat is what is under it', JSON.stringify(last(w)) === '{"type":"layers","depth":0}', last(w))
    check('Back 4: no layer is left (`false`): the shell asks « Press back again to exit »; the page is not entered again (no loop)', layers.close() === false && w.state.leftPage === 1 && w.state.page === false)
    layers.stop()
  }
  {
    // the loop of the request, point 4: if « Back » only opened the drawer and left the page open behind it, Back would cycle page, drawer, page, drawer for ever
    const w = world()
    const layers = T.createLayers(w.win, w.doc, w.hooks)
    layers.start()
    w.state.page = true
    layers.report()
    let presses = 0
    while (presses < 10 && layers.close() === true) { presses += 1; w.advance(700) }
    check('from a page alone, the exit question is reached after TWO Backs (page, then the drawer it opens), not never', presses === 2, { presses, left: w.state.leftPage })
    layers.stop()
  }
  {
    // a page left by a tap on a row (the engine's router) while the layer is told: the count goes down by itself
    const w = world()
    const layers = T.createLayers(w.win, w.doc, w.hooks)
    layers.start()
    w.state.page = true
    layers.report()
    w.state.page = false
    layers.report()
    check('a page left by a tap on a row (not by Back): the shell is told depth 0 again', JSON.stringify(last(w)) === '{"type":"layers","depth":0}', last(w))
    layers.stop()
  }
  check('the page half: it says `page` only on a phone (the same view mark the page already keeps) and leaves through the Kaby row', /pageOpen = \(\) => \{ try \{ return phone\(\) && document\.documentElement\.getAttribute\('data-kbmob-view'\) === 'page'/.test(SOURCE) && /querySelector\('\[data-kb-row="kyber"\]'\)/.test(SOURCE))
  check('...and with the Kaby row hidden (the phone\'s Simple) the row\'s own action is done by the Kaby plugin\'s hook (`__KB_KYBER__.openChat`), then the drawer opens as before; neither row nor hook = the drawer opens over the page', /const k = window\.__KB_KYBER__; hook = k !== undefined && k !== null && typeof k\.openChat === 'function' \? k : null/.test(SOURCE) && /if \(row !== null && row !== undefined && typeof row\.click === 'function'\) row\.click\(\); else hook\.openChat\(\)/.test(SOURCE) && /\|\| hook !== null\) \{/.test(SOURCE))
}

console.log('the contract says what the page does')
{
  check('§1b: the list in the user agent, its three names, the entry drawn only when listed', /KybernosCaps\/<list>/.test(CONTRACT) && /`account`/.test(CONTRACT) && /`plans`/.test(CONTRACT) && /`where`/.test(CONTRACT))
  check('§8: the two messages (`layers`, `close-layer`) and the order the layers close in', /`layers`/.test(CONTRACT) && /`close-layer`/.test(CONTRACT) && /depth/.test(CONTRACT) && /top/.test(CONTRACT))
  check('the page half exists: the contract says which version of the page does it', /page half/i.test(CONTRACT))
  check('§8: `top` has a fifth value, `page`, the lowest layer, and a page is no longer « not a layer »', /`top`: `menu`[^\n]*`dialog`[^\n]*`page`/.test(CONTRACT) && !/A page \(Automations, Skills…\) is not a layer/.test(CONTRACT) && /sheet or popover, a dialog, the Settings window, the menu \(the drawer\), a page/.test(CONTRACT))
}

console.log(failed === 0 ? '\nlayers: all green' : `\nlayers: ${failed} red`)
process.exit(failed === 0 ? 0 : 1)
