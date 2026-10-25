// kybernos-mobile, browser half: the contract of the runner, what a tap does, and the mounting, on a minimal fake DOM.
//   node packages/kybernos-mobile/test-client.mjs
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + JSON.stringify(detail)))
  if (!ok) failed += 1
}
const SOURCE = readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), 'client.js'), 'utf8')

// ── a fake DOM just big enough ────────────────────────────────────────────────
const makeDom = ({ narrow = true, collapsed = true, sheet = true, withToggle = true } = {}) => {
  const listeners = []
  const toggleClicks = []
  const el = (tag) => ({
    tag, attrs: {}, children: [], className: '', id: '', removed: false,
    setAttribute (k, v) { this.attrs[k] = String(v) },
    getAttribute (k) { return this.attrs[k] },
    appendChild (c) { this.children.push(c); c.parent = this; return c },
    addEventListener (ev, fn) { this.listeners = (this.listeners || []).concat([{ ev, fn }]) },
    remove () { this.removed = true },
    hasAttribute (k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) },
    click () { toggleClicks.push(this) }
  })
  const frame = el('div')
  if (collapsed) frame.attrs['data-sidebar-collapsed'] = 'true'
  const toggle = el('button')
  const firstInSidebar = el('button')
  const body = el('body'); const head = el('head')
  const meta = el('meta'); meta.attrs.content = 'width=device-width, initial-scale=1'
  const doc = {
    body, head,
    createElement: (t) => el(t),
    createElementNS: (ns, t) => el(t),
    getElementById: (id) => (id === 'kbmob-sheet' && sheet ? el('style') : null),
    querySelector: (sel) => {
      if (sel === '[data-slot="root"] > div') return frame
      if (sel === 'button[aria-keyshortcuts$="+B"]:not([aria-keyshortcuts*="Shift"])') return withToggle ? toggle : null
      if (sel === '[data-slot="sidebar"] button') return firstInSidebar
      if (sel === 'meta[name="viewport"]') return meta
      return null
    },
    baseURI: 'http://127.0.0.1:3080/',
    addEventListener: (ev, fn, cap) => listeners.push({ ev, fn, cap }),
    removeEventListener: (ev, fn) => { const i = listeners.findIndex((l) => l.ev === ev && l.fn === fn); if (i >= 0) listeners.splice(i, 1) }
  }
  return { doc, frame, toggle, firstInSidebar, listeners, toggleClicks, body, head, meta }
}
const load = (dom, { narrow = true, lang = 'fr' } = {}) => {
  let def = null
  globalThis.window = { __ModuleLoader__: { load: (d) => { def = d } }, matchMedia: () => ({ matches: narrow }), __KB_LANG_RESOLVE__: () => lang }
  globalThis.document = dom.doc
  new Function('window', 'document', SOURCE)(globalThis.window, globalThis.document)
  return def
}

console.log('the runner contract')
{
  const dom = makeDom()
  const def = load(dom)
  check('registers as @local/kybernos-mobile', def.id === '@local/kybernos-mobile')
  const plugin = def.factory()
  check('the factory RETURNS a plugin with apply (a factory that returns nothing breaks the whole entry)', plugin !== undefined && plugin !== null && typeof plugin.apply === 'function')
  check('it needs no DSH service', plugin.inject === undefined)
  // a factory that fails inside must return a disabled plugin, not throw
  const broken = makeDom()
  let broke = null
  let defB = null
  globalThis.window = { __ModuleLoader__: { load: (d) => { defB = d } }, matchMedia: () => { throw new Error('boom') } }
  globalThis.document = broken.doc
  const realWarn = console.warn; console.warn = () => {}
  try { new Function('window', 'document', SOURCE.replace("const MEDIA = '(max-width: 700px), (max-height: 500px) and (pointer: coarse)'", "const MEDIA = (() => { throw new Error('init failed') })()"))(globalThis.window, globalThis.document); const p = defB.factory(); broke = p } catch (e) { broke = 'threw' } finally { console.warn = realWarn }
  check('a failing initialisation degrades to an inert plugin', broke !== 'threw' && typeof broke.apply === 'function')
}

console.log('what a tap does')
{
  const dom = makeDom({ collapsed: false })
  const t = load(dom).factory().__test
  const target = (inside) => ({ closest: (sel) => (sel === '[data-slot="sidebar"]' ? (inside.sidebar ? {} : null) : (sel === t.PICKS ? (inside.pick ? {} : null) : null)) })
  check('the dimmed chat (the frame itself, mask) closes the drawer', t.decide(dom.frame, dom.frame, true) === 'close')
  check('picking a session or a page in the drawer closes it after the click', t.decide(target({ sidebar: true, pick: true }), dom.frame, true) === 'close-after')
  check('anything else in the drawer leaves it open (search, expand, menus)', t.decide(target({ sidebar: true, pick: false }), dom.frame, true) === 'none')
  check('a pick outside the sidebar is not ours', t.decide(target({ sidebar: false, pick: true }), dom.frame, true) === 'none')
  check('with the drawer closed nothing is decided', t.decide(dom.frame, dom.frame, false) === 'none')
  check('a target that is not an element is ignored', t.decide({}, dom.frame, true) === 'none' && t.decide(null, dom.frame, true) === 'none')
  check('the toggle is found by its shortcut, not by a label that is translated', /aria-keyshortcuts\$="\+B"/.test(t.TOGGLE))
  check('the right bar\'s toggle (Shift+…+B) is not taken for it', /:not\(\[aria-keyshortcuts\*="Shift"\]\)/.test(t.TOGGLE))
  check('the shortcut is matched whatever the modifiers (Alt+Meta+B on a Mac, another pair elsewhere)', ['Alt+Meta+B', 'Alt+Control+B', 'Control+Alt+B'].every((a) => /\+B$/.test(a)) && !/Meta/.test(t.TOGGLE))
}

console.log('the drawer state is DSH\'s, not ours')
{
  const closed = makeDom({ collapsed: true }); const tc = load(closed).factory().__test
  check('collapsed on a phone: closed', tc.drawerOpen() === false)
  const open = makeDom({ collapsed: false }); const to = load(open).factory().__test
  check('not collapsed on a phone: open', to.drawerOpen() === true)
  const wide = makeDom({ collapsed: false }); const tw = load(wide, { narrow: false }).factory().__test
  check('on a wide screen it is never "open" (the desktop sidebar is not a drawer)', tw.drawerOpen() === false)
}

console.log('mounting')
{
  const dom = makeDom({ collapsed: true })
  const plugin = load(dom, { lang: 'en' }).factory()
  const effects = []; let disposer = null
  plugin.apply({ effect: (fn, label) => { effects.push(label); disposer = fn(); return disposer } })
  const button = dom.body.children.find((c) => c.className === 'kbmob-menu')
  check('a menu button is added to the page', button !== undefined && button.attrs['data-kb'] === 'mobile-menu' && button.type === 'button')
  check('labelled in the page language', button.attrs['aria-label'] === 'Open the menu')
  check('one effect, with a label', effects.length === 1 && /kybernos-mobile/.test(effects[0]))
  check('no link is added when DSH already delivered the stylesheet', dom.head.children.length === 0)
  const click = button.listeners.find((l) => l.ev === 'click')
  click.fn({ stopPropagation () {} })
  check('the button clicks DSH\'s own toggle', dom.toggleClicks.length === 1 && dom.toggleClicks[0] === dom.toggle)
  const doc = dom.listeners.find((l) => l.ev === 'click')
  check('taps are watched at the document, in the capture phase', doc !== undefined && doc.cap === true)
  // the mask: a click whose target is the frame, with the drawer open
  dom.frame.attrs = {}
  let stopped = false
  doc.fn({ target: dom.frame, stopPropagation () { stopped = true } })
  check('a tap on the mask clicks the toggle and goes no further', dom.toggleClicks.length === 2 && stopped === true)
  disposer()
  check('the effect\'s cleanup removes the button and the watcher', button.removed === true && dom.listeners.length === 0)
}

console.log('the menu button is named in the language of the page (A1-23): English until the language is known, then it follows')
{
  const mountWith = (resolve) => {
    const dom = makeDom({ collapsed: true })
    const def = load(dom, { lang: 'en' })
    const fire = []
    globalThis.window.__KB_LANG_RESOLVE__ = resolve
    globalThis.window.addEventListener = (ev, fn) => { fire.push({ ev, fn }) }
    globalThis.window.removeEventListener = () => {}
    const plugin = def.factory()
    plugin.apply({ effect: (fn) => fn() })
    const button = dom.body.children.find((c) => c.className === 'kbmob-menu')
    return { button, fire }
  }
  const early = mountWith(() => { throw new Error('the language is not known yet') })
  check('before the language is known the label is English, not French', early.button.attrs['aria-label'] === 'Open the menu', early.button.attrs['aria-label'])
  let now = 'en'
  const live = mountWith(() => now)
  check('an English page: English', live.button.attrs['aria-label'] === 'Open the menu')
  now = 'kybernos'
  for (const l of live.fire.filter((f) => f.ev === 'kybernos-lang-change')) l.fn()
  check('the language changes to French: the label follows without a reload', live.button.attrs['aria-label'] === 'Ouvrir le menu', live.button.attrs['aria-label'])
  now = 'es'
  for (const l of live.fire.filter((f) => f.ev === 'kybernos-lang-change')) l.fn()
  check('Spanish (no table of ours): English, never French', live.button.attrs['aria-label'] === 'Open the menu', live.button.attrs['aria-label'])
  now = 'ar'
  live.button.listeners.filter((l) => l.ev === 'focus').forEach((l) => l.fn())
  check('the label is also written again when the button is reached', live.button.attrs['aria-label'] === 'Open the menu')
}

console.log('the stylesheet did not arrive')
{
  const dom = makeDom({ sheet: false })
  const plugin = load(dom).factory()
  plugin.apply({ effect: (fn) => fn() })
  const link = dom.head.children[0]
  check('the browser half links it', link !== undefined && link.rel === 'stylesheet' && link.id === 'kbmob-sheet-link' && /\/kybernos-mobile\/mobile\.css$/.test(link.href), link && link.href)
}

console.log('when the shortcut was rebound')
{
  const dom = makeDom({ withToggle: false, collapsed: true })
  const plugin = load(dom).factory()
  let disposer = null
  plugin.apply({ effect: (fn) => { disposer = fn(); return disposer } })
  const button = dom.body.children.find((c) => c.className === 'kbmob-menu')
  let threw = null
  try { button.listeners.find((l) => l.ev === 'click').fn({ stopPropagation () {} }) } catch (e) { threw = e }
  check('with the drawer closed it opens through the first button of the sidebar', threw === null && dom.toggleClicks.length === 1 && dom.toggleClicks[0] === dom.firstInSidebar)
  const open = makeDom({ withToggle: false, collapsed: false })
  const p2 = load(open).factory()
  p2.apply({ effect: (fn) => fn() })
  const b2 = open.body.children.find((c) => c.className === 'kbmob-menu')
  b2.listeners.find((l) => l.ev === 'click').fn({ stopPropagation () {} })
  check('with the drawer open and no shortcut it does nothing rather than click something else', open.toggleClicks.length === 0)
}

console.log('the phone link, mounted apart from the layout')
{
  const fakeReact = { createElement: (...a) => ({ a }) }
  const run = ({ withSlots = true, withRequire = true, injectThrows = false } = {}) => {
    const dom = makeDom({ collapsed: true })
    const def = load(dom, { lang: 'en' })
    const plugin = def.factory(withRequire ? (name) => (name === 'react' ? fakeReact : undefined) : undefined)
    const effects = []; const disposers = []; const injected = []; const registered = []; const styles = []
    dom.head.appendChild = (c) => { styles.push(c); return c }
    const origCreate = dom.doc.createElement
    dom.doc.createElement = (t) => { const e = origCreate(t); e.dataset = {}; return e }
    const slots = { inject: (name, fn) => { injected.push(name); return fn() }, register: (spec, comp) => { registered.push(spec); return () => {} } }
    const ctx = {
      effect: (fn, label) => { effects.push(label); const d = fn(); disposers.push(d); return d },
      inject: (names, cb) => { if (injectThrows) throw new Error('no inject'); injected.push(names.join(',')); cb(withSlots ? { slots } : {}) },
    }
    let threw = null
    try { plugin.apply(ctx) } catch (e) { threw = e }
    return { dom, plugin, effects, disposers, injected, registered, styles, threw }
  }
  const full = run()
  check('it needs no DSH service up front (the layout must always mount)', full.plugin.inject === undefined)
  check('the « Phone and channels » window is published: it opens itself (`open`), for the account menu and Kaby\'s strip', typeof globalThis.window.__KB_MOBILE__ === 'object' && typeof globalThis.window.__KB_MOBILE__.open === 'function' && typeof globalThis.window.__KB_MOBILE__.Dialog === 'function' && globalThis.window.__KB_MOBILE__.version === 3 && globalThis.window.__KB_MOBILE__.Panel === undefined)
  check('the Settings section is « Phone and channels »', full.registered.length === 1 && full.registered[0].name === 'settings.section' && full.registered[0].id === 'kybernos-mobile' && full.registered[0].label === 'Phone and channels', full.registered)
  check('its styles are its own, under a prefix nobody else uses', full.styles.length === 1 && /\.kbmr-/.test(full.styles[0].textContent) && !/\.kbmob-/.test(full.styles[0].textContent))
  check('every effect is labelled', full.effects.every((l) => /^kybernos-mobile: /.test(l)) && full.effects.length === 4, full.effects)
  full.disposers.forEach((d) => { if (typeof d === 'function') d() })
  check('the cleanups take the seam and the styles away', globalThis.window.__KB_MOBILE__ === undefined && full.styles[0].removed === true)

  const noSlots = run({ withSlots: false })
  check('without the slots service the window still works and nothing throws', noSlots.threw === null && typeof globalThis.window.__KB_MOBILE__.Dialog === 'function' && noSlots.registered.length === 0)
  const noReq = run({ withRequire: false })
  check('without React the layout still mounts and the link stays off', noReq.threw === null && noReq.dom.body.children.some((c) => c.className === 'kbmob-menu') && globalThis.window.__KB_MOBILE__ === undefined)
  const noInject = run({ injectThrows: true })
  check('a DSH that refuses inject cannot break the layout', noInject.threw === null && noInject.dom.body.children.some((c) => c.className === 'kbmob-menu'))
}

console.log('inside the Kybernos app')
{
  const fakeReact = { createElement: (...a) => ({ a }) }
  const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KybernosHost/0.1.0 (ios)'
  const runApp = ({ ua = IOS_UA, rn = true, lang = 'en' } = {}) => {
    const dom = makeDom({ collapsed: true })
    const def = load(dom, { lang })
    const win = globalThis.window
    win.navigator = { userAgent: ua }
    const posted = []; const assigned = []
    win.location = { assign: (u) => assigned.push(u) }
    if (rn) win.ReactNativeWebView = { postMessage: (m) => posted.push(m) }
    const classes = new Set()
    dom.doc.documentElement = { classList: { add: (...c) => c.forEach((x) => classes.add(x)), remove: (...c) => c.forEach((x) => classes.delete(x)) } }
    const plugin = def.factory((name) => (name === 'react' ? fakeReact : undefined))
    const disposers = []; const registered = []; const components = []; const styles = []
    dom.head.appendChild = (c) => { styles.push(c); return c }
    const origCreate = dom.doc.createElement
    dom.doc.createElement = (t) => { const e = origCreate(t); e.dataset = {}; return e }
    const slots = { inject: (name, fn) => fn(), register: (spec, comp) => { registered.push(spec); components.push(comp); return () => {} } }
    const ctx = { effect: (fn) => { const d = fn(); disposers.push(d); return d }, inject: (names, cb) => cb({ slots }) }
    let threw = null
    try { plugin.apply(ctx) } catch (e) { threw = e }
    return { win, plugin, posted, assigned, classes, disposers, registered, components, styles, threw, test: plugin.__test }
  }
  // the page, drawn on a fake React that only builds a tree: expand the function components, then look for what has a data-act
  const expand = (n) => {
    if (n === null || n === undefined || typeof n !== 'object' || !Array.isArray(n.a)) return n
    const [type, props, ...kids] = n.a
    if (typeof type === 'function') return expand(type(props))
    return { type, props: props || {}, kids: kids.map(expand) }
  }
  const walk = (n, out = []) => { if (n && typeof n === 'object') { if (n.props) out.push(n); (n.kids || []).forEach((k) => walk(k, out)) } return out }
  const textOf = (n) => (typeof n === 'string' ? n : n && n.kids ? n.kids.map(textOf).join(' ') : '')

  const t = runApp().test
  check('the user agent of the app is recognised, with its version and platform', JSON.stringify(t.parseAppHost(IOS_UA)) === JSON.stringify({ version: '0.1.0', platform: 'ios' }))
  check('on Android too, with a pre-release version', JSON.stringify(t.parseAppHost('Mozilla/5.0 (Linux; Android 16) KybernosHost/1.2.3-beta.4 (android)')) === JSON.stringify({ version: '1.2.3-beta.4', platform: 'android' }))
  check('a browser, an empty agent or a made-up platform is not the app', [null, undefined, '', 'Mozilla/5.0 (Macintosh) Safari/605', 'KybernosHost/ (ios)', 'KybernosHost/0.1.0 (windows)', 'KybernosHost/0.1.0'].every((ua) => t.parseAppHost(ua) === null))

  const desk = runApp({ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15' })
  check('in a browser nothing of the app is mounted: the phone link stays, no app seam, no class', desk.registered.length === 1 && desk.registered[0].id === 'kybernos-mobile' && desk.win.__KB_APP__ === undefined && desk.classes.size === 0 && desk.posted.length === 0)

  const app = runApp()
  check('inside the app the Settings section is « The Kybernos app » (same id as the phone link: the same place in the list), not the phone link', app.registered.length === 1 && app.registered[0].id === 'kybernos-mobile' && app.registered[0].name === 'settings.section' && app.registered[0].label === 'The Kybernos app', app.registered)
  check('the phone link window is not offered (the account menu and Kaby\'s strip hide their entry without it)', app.win.__KB_MOBILE__ === undefined)
  check('the other bundles get a seam: platform, version, and a way to open the app screens', app.win.__KB_APP__ !== undefined && app.win.__KB_APP__.platform === 'ios' && app.win.__KB_APP__.appVersion === '0.1.0' && typeof app.win.__KB_APP__.openSettings === 'function' && typeof app.win.__KB_APP__.openLog === 'function')
  check('the page is marked with classes a stylesheet can use', app.classes.has('kb-app') && app.classes.has('kb-app-ios'), [...app.classes])
  check('the app is told once that the interface has its entry (it then drops its fallback gear)', app.posted.length === 1 && JSON.parse(app.posted[0]).kybernos === 'app-entry' && JSON.parse(app.posted[0]).entry === 'settings', app.posted)
  check('its styles are its own, under a prefix nobody else uses', app.styles.length === 1 && /\.kbapp-/.test(app.styles[0].textContent) && !/\.kbmr-|\.kbmob-/.test(app.styles[0].textContent))
  // store rules: no purchase flow and no sign-up inside the app (mobile/STORES.md items 5 and 6), hidden under the app class only
  const css = app.styles[0].textContent
  const HIDDEN = ['menu-signup', 'menu-plans', 'menu-plan-cta', 'menu-plan-credits', 'upgrade-dialog', 'team-lock-plans', 'provider-plans', 'kc-pro-plans', 'kybernos-kyber-upgrade', 'plugins-add', 'plugins-add-empty', 'plugins-drafts']
  check('inside the app the purchase, sign-up and plugin-install controls are hidden, under the app class only', /html\.kb-app :is\(/.test(css) && HIDDEN.every((k) => css.includes('[data-kb="' + k + '"]')) && /display:none !important/.test(css), css.slice(0, 200))
  check('in a browser the stylesheet is not mounted, so the desktop keeps them', desk.styles.every((x) => !x.textContent.includes('kb-app :is(')))
  const bundles = ['kybernos-cloud', 'kybernos-plugin', 'kybernos-composio', 'kybernos-kyber', 'kybernos-hub'].map((d) => readFileSync(join(fileURLToPath(new URL('../' + d + '/', import.meta.url)), 'client.js'), 'utf8')).join('\n')
  check('every hidden hook is still drawn by the bundle that owns it (a rename would silently show the control again)', HIDDEN.every((k) => (k.startsWith('menu-') && !k.startsWith('menu-plan-') ? bundles.includes("entree('" + k.slice(5) + "'") : bundles.includes("'" + k + "'"))), HIDDEN.filter((k) => !(k.startsWith('menu-') && !k.startsWith('menu-plan-') ? bundles.includes("entree('" + k.slice(5) + "'") : bundles.includes("'" + k + "'"))))
  const page = expand(app.components[0]())
  const acts = walk(page).filter((n) => n.props['data-act'] !== undefined)
  check('the page has two buttons: the model key and the engine log', acts.map((n) => n.props['data-act']).join() === 'open-key,open-log', acts.map((n) => n.props['data-act']))
  acts.forEach((n) => n.props.onClick())
  check('they open the app\'s own screens through its links', app.assigned.join() === 'kybernos://settings,kybernos://log', app.assigned)
  check('every card has a stable hook for live checks', ['mobile-app-page', 'mobile-app-key', 'mobile-app-log', 'mobile-app-auto'].every((k) => walk(page).some((n) => n.props['data-kb'] === k)))
  const said = textOf(page)
  check('it says where the key lives, that the engine runs on the phone, and what happens to automations', /secure storage/.test(said) && /runs on this phone/.test(said) && /cloud computer/.test(said))
  check('it does not talk about linking a phone to a computer', !/QR|link a phone|relay/i.test(said))
  app.disposers.forEach((d) => { if (typeof d === 'function') d() })
  check('the cleanups take the seam, the classes and the styles away', app.win.__KB_APP__ === undefined && app.classes.size === 0 && app.styles[0].removed === true)

  const fr = runApp({ lang: 'fr' })
  check('in French the section is « L’app Kybernos » (every label goes through kt)', fr.registered[0].label === 'L’app Kybernos')
  const noBridge = runApp({ rn: false })
  check('without the app\'s message bridge nothing throws and the page is still there', noBridge.threw === null && noBridge.registered.length === 1)
  const android = runApp({ ua: 'Mozilla/5.0 (Linux; Android 16) KybernosHost/0.1.0 (android)' })
  check('on Android the classes say so', android.classes.has('kb-app-android') && !android.classes.has('kb-app-ios'))
}

console.log('the file')
{
  check('the phone link uses its own class prefix, not the layout\'s', /className: 'kbmr-/.test(SOURCE) && !/className: 'kbmob-[a-z]/.test(SOURCE.slice(SOURCE.indexOf('buildRemoteUi'))))
  check('the QR code is the only place colours are named, as words (a scanner needs black on white)', /fill: 'white'/.test(SOURCE) && /fill: 'black'/.test(SOURCE))
  check('user-visible text goes through the French/English picker', /kt\('Ouvrir le menu', 'Open the menu'\)/.test(SOURCE))
  check('no hard-coded theme colour', !/#[0-9a-fA-F]{3,8}\b/.test(SOURCE))
  check('the bundle keeps no state (no storage)', !/localStorage|sessionStorage|indexedDB/.test(SOURCE))
}

console.log(failed === 0 ? '\nOK' : `\n${failed} failure(s)`)

console.log('a phone lying down')
{
  const dom = makeDom({ collapsed: false })
  const t = load(dom).factory().__test
  check('the phone condition also holds for a touch device at most 500 px high', /max-height: 500px\) and \(pointer: coarse\)/.test(t.MEDIA) && /max-width: 700px/.test(t.MEDIA), t.MEDIA)
}
{
  // DSH leaves its sidebar open above its own breakpoint: on a phone in landscape that is an open drawer over the chat
  const dom = makeDom({ collapsed: false })
  const plugin = load(dom).factory()
  let disposer = null
  plugin.apply({ effect: (fn) => { disposer = fn(); return disposer } })
  await new Promise((r) => setTimeout(r, 450))
  check('an open sidebar the person did not ask for is closed once the shell is there', dom.toggleClicks.length === 1 && dom.toggleClicks[0] === dom.toggle, dom.toggleClicks.length)
  disposer()
}
{
  const dom = makeDom({ collapsed: true })
  const plugin = load(dom).factory()
  let disposer = null
  plugin.apply({ effect: (fn) => { disposer = fn(); return disposer } })
  await new Promise((r) => setTimeout(r, 450))
  check('a closed drawer is left alone', dom.toggleClicks.length === 0, dom.toggleClicks.length)
  const button = dom.body.children.find((c) => c.className === 'kbmob-menu')
  button.listeners.find((l) => l.ev === 'click').fn({ stopPropagation () {} })
  dom.frame.attrs = {}
  check('the menu button opened it', dom.toggleClicks.length === 1)
  disposer()
}
{
  const dom = makeDom({ collapsed: true })
  const plugin = load(dom).factory()
  let disposer = null
  plugin.apply({ effect: (fn) => { disposer = fn(); return disposer } })
  check('the viewport lets the page draw under the notch (env() safe areas)', /viewport-fit=cover/.test(dom.meta.attrs.content) && /width=device-width/.test(dom.meta.attrs.content), dom.meta.attrs.content)
  disposer()
  check('and the viewport is put back when the plugin leaves', dom.meta.attrs.content === 'width=device-width, initial-scale=1', dom.meta.attrs.content)
}
{
  const dom = makeDom({ collapsed: false })
  const plugin = load(dom, { narrow: false }).factory()
  let disposer = null
  plugin.apply({ effect: (fn) => { disposer = fn(); return disposer } })
  await new Promise((r) => setTimeout(r, 450))
  check('on a wide screen the sidebar is never closed for the person', dom.toggleClicks.length === 0, dom.toggleClicks.length)
  disposer()
}


console.log('the "..." sheet: what a phone parked')
{
  // pure helpers, on fake elements
  const mk = (label, parked, extra) => {
    const parent = { parentElement: null, st: { position: parked ? 'fixed' : 'static', opacity: parked ? '0' : '1' } }
    const el = Object.assign({ parentElement: parent, st: { position: 'static', opacity: '1' }, getAttribute: (k) => (k === 'aria-label' ? label : null), closest: () => null, textContent: label }, extra || {})
    return el
  }
  const dom = makeDom({ collapsed: true })
  const t = load(dom).factory().__test
  const styleOf = (e) => e.st
  const parkedEl = mk('Share…', true)
  const shownEl = mk('More actions', false)
  const dupEl = mk('Share…', true)
  const finderEl = mk('Open in Finder', true, { closest: (sel) => (sel === '[data-open-target]' ? {} : null) })
  const root = { querySelectorAll: () => [parkedEl, shownEl, dupEl, finderEl] }
  const out = t.parkedActions(root, styleOf)
  check('only parked actions are listed', out.length === 1 && out[0].label === 'Share…', out.map((x) => x.label))
  check('"open in Finder" is never offered on a phone', !out.some((x) => /Finder/.test(x.label)))
  check('an element is parked when an ancestor is fixed and invisible', t.isParked(parkedEl, styleOf) === true && t.isParked(shownEl, styleOf) === false)
  check('a style that cannot be read means "not parked"', t.isParked({ parentElement: null }, () => { throw new Error('gone') }) === false)
  const longEl = mk('Commands: browse, run, edit or create slash commands and actions', true)
  const shortLabels = t.parkedActions({ querySelectorAll: () => [longEl, mk('Share…', true)] }, styleOf).map((x) => x.label)
  check('a long label is shortened to its name (what comes before the colon)', shortLabels[0] === 'Commands' && shortLabels[1] === 'Share…', shortLabels)
  check('the selectors name DSH\'s stable slots, not hashed classes', /conversation\.session\.header\.actions/.test(t.ACTION_BUTTONS) && /data-composer-card/.test(t.ACTION_BUTTONS) && !/\._[A-Za-z0-9]{4,}_/.test(t.ACTION_BUTTONS))
}
{
  // the tap on "More actions": the sheet opens, a row clicks the parked action, the last row hands over to DSH's menu
  const dom = makeDom({ collapsed: true })
  const clicks = []
  const parked = { tag: 'button', parentElement: { parentElement: null, st: { position: 'fixed', opacity: '0' } }, st: { position: 'static', opacity: '1' }, getAttribute: (k) => (k === 'aria-label' ? 'Share…' : null), closest: () => null, textContent: 'Share…', querySelector: () => null, click () { clicks.push('share') } }
  const more = { tag: 'button', closest: (sel) => (sel === '[data-slot="conversation.session.header.utilities"] button' ? more : null), click () { clicks.push('more') } }
  const realQuery = dom.doc.querySelector
  dom.doc.querySelectorAll = (sel) => (/conversation\.session\.header\.actions/.test(sel) ? [parked] : [])
  dom.body.removeChild = undefined
  const plugin = load(dom).factory()
  let disposer = null
  globalThis.window.getComputedStyle = (e) => e.st
  plugin.apply({ effect: (fn) => { disposer = fn(); return disposer } })
  const watcher = dom.listeners.filter((l) => l.ev === 'click' && l.cap === true)
  let prevented = false; let stopped = false
  const ev = { target: more, preventDefault () { prevented = true }, stopPropagation () { stopped = true } }
  watcher.forEach((l) => l.fn(ev))
  const panel = dom.body.children.find((c) => c.className === 'kbmob-sheet')
  check('a tap on "More actions" opens the sheet instead of DSH\'s menu', panel !== undefined && prevented === true && stopped === true)
  check('the sheet lists the parked action and DSH\'s own menu last', panel !== undefined && panel.children.length >= 4, panel && panel.children.map((c) => c.className))
  const rows = panel.children.filter((c) => c.className === 'kbmob-sheet-row')
  await new Promise((r) => { rows[0].listeners.find((l) => l.ev === 'click').fn({ stopPropagation () {} }); setTimeout(r, 120) })
  check('a row clicks the parked action', clicks.indexOf('share') >= 0, clicks)
  check('the sheet closed with it', dom.body.children.find((c) => c.className === 'kbmob-sheet') === undefined || dom.body.children.find((c) => c.className === 'kbmob-sheet').removed === true)
  // second open, last row: DSH's own menu, and our watcher lets that click through
  watcher.forEach((l) => l.fn({ target: more, preventDefault () {}, stopPropagation () {} }))
  const panel2 = dom.body.children.filter((c) => c.className === 'kbmob-sheet').pop()
  const rows2 = panel2.children.filter((c) => c.className === 'kbmob-sheet-row')
  await new Promise((r) => { rows2[rows2.length - 1].listeners.find((l) => l.ev === 'click').fn({ stopPropagation () {} }); setTimeout(r, 120) })
  check('the last row clicks DSH\'s own "More actions" button', clicks.indexOf('more') >= 0, clicks)
  void realQuery
  disposer()
}
{
  // nothing parked (a page without a conversation): DSH's menu is left alone
  const dom = makeDom({ collapsed: true })
  dom.doc.querySelectorAll = () => []
  const plugin = load(dom).factory()
  let disposer = null
  globalThis.window.getComputedStyle = (e) => e.st
  plugin.apply({ effect: (fn) => { disposer = fn(); return disposer } })
  const more = { closest: (sel) => (/utilities/.test(sel) ? more : null) }
  let prevented = false
  dom.listeners.filter((l) => l.ev === 'click' && l.cap === true).forEach((l) => l.fn({ target: more, preventDefault () { prevented = true }, stopPropagation () {} }))
  check('with nothing parked the tap goes through to DSH', prevented === false && dom.body.children.every((c) => c.className !== 'kbmob-sheet'))
  disposer()
}
{
  const dom = makeDom({ collapsed: true })
  dom.doc.querySelectorAll = () => []
  const plugin = load(dom, { narrow: false }).factory()
  let disposer = null
  plugin.apply({ effect: (fn) => { disposer = fn(); return disposer } })
  let prevented = false
  const more = { closest: (sel) => (/utilities/.test(sel) ? more : null) }
  dom.listeners.filter((l) => l.ev === 'click' && l.cap === true).forEach((l) => l.fn({ target: more, preventDefault () { prevented = true }, stopPropagation () {} }))
  check('on a wide screen the sheet never opens', prevented === false)
  disposer()
}


console.log('views and rating on a phone')
{
  const dom = makeDom({ collapsed: true })
  const t = load(dom).factory().__test
  const styleOf = (e) => e.st
  const tab = (label, selected, parked) => ({
    parentElement: { parentElement: null, st: { position: parked ? 'fixed' : 'static', opacity: parked ? '0' : '1' } }, st: { position: 'static', opacity: '1' },
    getAttribute: (k) => (k === 'aria-label' ? null : (k === 'aria-selected' ? String(selected) : null)), closest: () => null, textContent: label,
  })
  const out = t.parkedActions({ querySelectorAll: () => [tab('Chat', true, true), tab('Journal', false, true), tab('Trajectory', false, true)] }, styleOf).map((x) => x.label)
  check('the other views are listed, the one shown is not', out.length === 2 && out[0] === 'Journal' && out[1] === 'Trajectory', out)
  const shown = t.parkedActions({ querySelectorAll: () => [tab('Chat', false, false), tab('Journal', true, false)] }, styleOf)
  check('with the tab row visible nothing is parked, so nothing is listed', shown.length === 0)
  check('the tab row is among the candidates', /data-conversation-tabs/.test(t.ACTION_BUTTONS))
}
{
  const dom = makeDom({ collapsed: true })
  dom.doc.querySelectorAll = () => []
  const plugin = load(dom).factory()
  let disposer = null
  globalThis.window.getComputedStyle = (e) => e.st
  plugin.apply({ effect: (fn) => { disposer = fn(); return disposer } })
  const attrs = {}
  const card = { attrs, hasAttribute: (k) => Object.prototype.hasOwnProperty.call(attrs, k), setAttribute: (k, v) => { attrs[k] = String(v) } }
  const star = { closest: (sel) => (sel === '.kbq-rating' ? card : null) }
  let prevented = false; let stopped = false
  const fire = () => dom.listeners.filter((l) => l.ev === 'click' && l.cap === true).forEach((l) => l.fn({ target: star, preventDefault () { prevented = true }, stopPropagation () { stopped = true } }))
  fire()
  check('the first tap on the collapsed rating opens the five stars and goes no further', attrs['data-kbmob-open'] === '1' && prevented === true && stopped === true, attrs)
  prevented = false; stopped = false
  fire()
  check('once open, a tap is DSH\'s (it rates)', prevented === false && stopped === false)
  disposer()
}
{
  const dom = makeDom({ collapsed: true })
  dom.doc.querySelectorAll = () => []
  const plugin = load(dom, { narrow: false }).factory()
  let disposer = null
  plugin.apply({ effect: (fn) => { disposer = fn(); return disposer } })
  const attrs = {}
  const card = { hasAttribute: (k) => k in attrs, setAttribute: (k, v) => { attrs[k] = v } }
  dom.listeners.filter((l) => l.ev === 'click' && l.cap === true).forEach((l) => l.fn({ target: { closest: () => card }, preventDefault () {}, stopPropagation () {} }))
  check('on a wide screen the rating card is left as it is', Object.keys(attrs).length === 0)
  disposer()
}

console.log('a swipe closes the drawer')
{
  const t = load(makeDom({ collapsed: false })).factory().__test
  check('a swipe to the left closes', t.swipeCloses({ x: 200, y: 400 }, { x: 100, y: 410 }) === true)
  check('a short move does not', t.swipeCloses({ x: 200, y: 400 }, { x: 160, y: 400 }) === false)
  check('a swipe to the right does not', t.swipeCloses({ x: 100, y: 400 }, { x: 220, y: 400 }) === false)
  check('a diagonal (a scroll that drifts) does not', t.swipeCloses({ x: 200, y: 300 }, { x: 130, y: 400 }) === false)
  check('without a start or an end it does not', t.swipeCloses(null, { x: 0, y: 0 }) === false && t.swipeCloses({ x: 0, y: 0 }, undefined) === false)

  const run = (collapsed, from, to) => {
    const dom = makeDom({ collapsed })
    const plugin = load(dom).factory()
    let disposer = null
    plugin.apply({ effect: (fn) => { disposer = fn(); return disposer } })
    const start = dom.listeners.find((l) => l.ev === 'touchstart')
    const end = dom.listeners.find((l) => l.ev === 'touchend')
    if (start !== undefined) start.fn({ touches: [{ clientX: from.x, clientY: from.y }] })
    if (end !== undefined) end.fn({ changedTouches: [{ clientX: to.x, clientY: to.y }] })
    const out = { registered: start !== undefined && end !== undefined, clicks: dom.toggleClicks.length }
    disposer()
    out.removed = dom.listeners.filter((l) => l.ev === 'touchstart' || l.ev === 'touchend').length === 0
    return out
  }
  const open = run(false, { x: 250, y: 300 }, { x: 120, y: 310 })
  check('the touch listeners are registered and removed with the plugin', open.registered && open.removed, open)
  check('a swipe to the left on an open drawer clicks DSH\'s toggle', open.clicks === 1, open)
  check('the same swipe with the drawer closed does nothing', run(true, { x: 250, y: 300 }, { x: 120, y: 310 }).clicks === 0)
}

console.log('the toggle of a phone: DSH draws no keyboard shortcut there')
{
  const rect = (l, tp, w, h) => ({ left: l, top: tp, width: w, height: h, right: l + w, bottom: tp + h })
  const btn = (name, r) => ({ name, getBoundingClientRect: () => r })
  const withButtons = (collapsed, buttons) => {
    const dom = makeDom({ collapsed, withToggle: false })
    dom.doc.querySelectorAll = (sel) => (/data-slot="sidebar"\] button/.test(sel) ? buttons : [])
    dom.doc.querySelector = ((orig) => (sel) => (/data-slot="sidebar"\] button/.test(sel) ? (buttons[0] || null) : orig(sel)))(dom.doc.querySelector)
    return dom
  }
  const header = [btn('new-session', rect(16, 14, 230, 44)), btn('collapse', rect(254, 14, 36, 44)), btn('start-chat', rect(252, 73, 38, 52)), btn('row-icon', rect(250, 400, 36, 44))]
  const open = withButtons(false, header)
  const t = load(open).factory().__test
  check('open: the collapse button is the narrow one at the end of the first row', t.toggle() !== null && t.toggle().name === 'collapse', t.toggle() && t.toggle().name)
  check('the wide "new session" button and the narrow ones lower down are not taken for it', t.collapseButton().name === 'collapse')
  const closed = withButtons(true, [btn('open-sidebar', rect(-309, 14, 36, 44)), btn('kybernos', rect(-309, 66, 36, 366))])
  const tc = load(closed).factory().__test
  check('closed: the first button of the sidebar is its open button', tc.toggle() !== null && tc.toggle().name === 'open-sidebar')
  // a tap on the dimmed chat reaches DSH's collapse button even with no shortcut
  const plugin = load(open).factory()
  let disposer = null
  plugin.apply({ effect: (fn) => { disposer = fn(); return disposer } })
  const clicked = []
  header.forEach((b) => { b.click = () => clicked.push(b.name) })
  open.listeners.filter((l) => l.ev === 'click' && l.cap === true).forEach((l) => l.fn({ target: open.frame, stopPropagation () {}, preventDefault () {} }))
  check('a tap on the dimmed chat clicks that collapse button', clicked.length === 1 && clicked[0] === 'collapse', clicked)
  disposer()
  const none = withButtons(false, [])
  check('with no sidebar button at all, nothing is clicked and nothing throws', load(none).factory().__test.toggle() === null)
}

console.log('what a page needs to fit a phone')
{
  const t = load(makeDom()).factory().__test
  const box = (o) => ({
    clientWidth: 304, scrollWidth: 304, children: [], parentElement: null,
    getAttribute: () => null, getBoundingClientRect: () => ({ left: 0, right: o.clientWidth || 304, width: o.clientWidth || 304 }),
    ...o
  })
  const styles = new Map()
  const styleOf = (e) => styles.get(e) || { overflowX: 'visible', display: 'block', flexDirection: 'row', flexWrap: 'nowrap', flexGrow: '0', flexBasis: 'auto', flexShrink: '1', minWidth: 'auto' }
  const st = (e, s) => { styles.set(e, { overflowX: 'visible', display: 'block', flexDirection: 'row', flexWrap: 'nowrap', flexGrow: '0', flexBasis: 'auto', flexShrink: '1', minWidth: 'auto', ...s }); return e }

  const wideGrid = st(box({ scrollWidth: 330 }), { display: 'grid' })
  check('a card grid wider than its box gets columns that fit', JSON.stringify(t.fitKinds(wideGrid, styleOf)) === '["grid"]')
  check('a grid that fits is left alone', t.fitKinds(st(box({}), { display: 'grid' }), styleOf).length === 0)
  const wideRow = st(box({ scrollWidth: 592 }), { display: 'flex' })
  check('a toolbar wider than its box wraps', t.fitKinds(wideRow, styleOf).indexOf('wrap') >= 0)
  check('a row that wraps already is left alone', t.fitKinds(st(box({ scrollWidth: 592 }), { display: 'flex', flexWrap: 'wrap' }), styleOf).length === 0)
  check('a clipped or scrolling box is that on purpose', t.fitKinds(st(box({ scrollWidth: 592 }), { display: 'flex', overflowX: 'auto' }), styleOf).length === 0)
  const strip = box({ scrollWidth: 604, clientWidth: 304 })
  strip.getBoundingClientRect = () => ({ left: 0, right: 304, width: 304 })
  strip.children = [box({ getBoundingClientRect: () => ({ left: 0, right: 300, width: 300 }), querySelector: () => ({}) }), box({ getBoundingClientRect: () => ({ left: 308, right: 608, width: 300 }), querySelector: () => ({}) })]
  st(strip, { display: 'flex', overflowX: 'hidden' })
  check('a strip of cards that hides the ones beyond its edge wraps', JSON.stringify(t.fitKinds(strip, styleOf)) === '["wrap"]')
  const ellipsis = box({ scrollWidth: 604, clientWidth: 304 })
  ellipsis.getBoundingClientRect = () => ({ left: 0, right: 304, width: 304 })
  ellipsis.children = [box({ getBoundingClientRect: () => ({ left: 0, right: 600, width: 600 }), querySelector: () => null })]
  st(ellipsis, { display: 'flex', overflowX: 'hidden' })
  check('a row of text cut with an ellipsis is left alone', t.fitKinds(ellipsis, styleOf).length === 0)
  check('a column is not a toolbar', t.fitKinds(st(box({ scrollWidth: 592 }), { display: 'flex', flexDirection: 'column' }), styleOf).length === 0)
  check('a plain block that is wide (a long word) is left alone', t.fitKinds(st(box({ scrollWidth: 592 }), {}), styleOf).length === 0)

  const tabs = st(box({ scrollWidth: 316, clientWidth: 264, getAttribute: (k) => (k === 'role' ? 'tablist' : null) }), { display: 'flex' })
  check('a strip of tabs wider than its box slides sideways', JSON.stringify(t.fitKinds(tabs, styleOf)) === '["scroll"]')

  const pushedOut = box({ children: [], scrollWidth: 304 })
  pushedOut.children = [box({ getBoundingClientRect: () => ({ left: -66, right: -40, width: 26 }) }), box({})]
  st(pushedOut, { display: 'flex' })
  check('a row that pushes an item out on the left (justify-content: flex-end) wraps', t.fitKinds(pushedOut, styleOf).indexOf('wrap') >= 0)

  const squeezedText = box({ scrollWidth: 304 })
  squeezedText.children = [box({ clientWidth: 80, scrollWidth: 134, getBoundingClientRect: () => ({ left: 0, right: 80, width: 80 }) }), box({})]
  st(squeezedText, { display: 'flex' })
  check('a row that squeezes an item below its content wraps', t.fitKinds(squeezedText, styleOf).indexOf('wrap') >= 0)

  const search = box({ scrollWidth: 304 })
  search.children = [box({ clientWidth: 26, scrollWidth: 26, querySelector: () => ({}), getBoundingClientRect: () => ({ left: 0, right: 26, width: 26 }) }), box({})]
  st(search, { display: 'flex' })
  check('a search field squeezed to nothing wraps its row', t.fitKinds(search, styleOf).indexOf('wrap') >= 0)

  const setting = box({ scrollWidth: 304 })
  const text = st(box({}), { display: 'flex', flexDirection: 'column', flexGrow: '1', flexBasis: '0%' })
  setting.children = [text, box({})]
  st(setting, { display: 'flex' })
  check('a setting (text that takes what is left, then its control) stacks', t.fitKinds(setting, styleOf).indexOf('stack') >= 0)
  const card = box({ scrollWidth: 304 })
  card.children = [st(box({}), { display: 'block', flexGrow: '0', flexBasis: 'auto' }), box({})]
  st(card, { display: 'flex' })
  check('a row that starts with an icon is not a setting', t.fitKinds(card, styleOf).indexOf('stack') < 0)

  const parent = st(box({}), { display: 'flex', flexDirection: 'row' })
  const squeezed = st(box({ clientWidth: 80, scrollWidth: 134, parentElement: parent }), { display: 'block', minWidth: '0px' })
  check('an item squeezed below its content keeps its content width', t.fitKinds(squeezed, styleOf).indexOf('keep') >= 0)
  const inColumn = st(box({ clientWidth: 80, scrollWidth: 134, parentElement: st(box({}), { display: 'flex', flexDirection: 'column' }) }), { display: 'block', minWidth: '0px' })
  check('an item of a column is not squeezed sideways', t.fitKinds(inColumn, styleOf).indexOf('keep') < 0)
  check('an element that throws is left alone', t.fitKinds({ get clientWidth () { throw new Error('gone') } }, styleOf).length === 0)
}

console.log('a page title is not left under the menu button')
{
  const t = load(makeDom()).factory().__test
  const at = (top) => ({ getBoundingClientRect: () => ({ top }), matches: () => false })
  const title = Object.assign(at(30), {})
  const row = Object.assign(at(30), {})
  const head = Object.assign(at(30), {})
  const page = Object.assign(at(0), {})
  title.parentElement = row; row.parentElement = head; head.parentElement = page; page.parentElement = null
  check('the outermost ancestor that starts at the title\'s height is the one to move', t.leadTarget(title, 60) === head)
  const clear = Object.assign(at(70), { parentElement: null })
  check('a title that is already clear of the button is left alone', t.leadTarget(clear, 60) === null)
  check('no title: nothing to do', t.leadTarget(null, 60) === null)
  const inMain = Object.assign(at(30), {})
  inMain.parentElement = Object.assign(at(30), { matches: (sel) => /data-slot="main"/.test(sel) })
  check('the page container is never moved', t.leadTarget(inMain, 60) === inMain)
}

console.log('Settings on a phone: a list of pages, then a page under a back bar')
{
  const dom = makeDom({ collapsed: true })
  const plugin = load(dom, { lang: 'en' }).factory()
  let disposer = null
  plugin.apply({ effect: (fn) => { disposer = fn(); return disposer } })
  const modalAttrs = {}
  const pageAttrs = {}
  const page = { setAttribute: (k, v) => { pageAttrs[k] = v }, getBoundingClientRect: () => ({ top: 0 }) }
  const modal = { children: [{}, page], hasAttribute: (k) => k in modalAttrs, setAttribute: (k, v) => { modalAttrs[k] = v }, removeAttribute: (k) => { delete modalAttrs[k] } }
  const fire = (target, clientY) => dom.listeners.filter((l) => l.ev === 'click' && l.cap === true).forEach((l) => l.fn({ target, clientY, preventDefault () {}, stopPropagation () {} }))
  const inModal = (extra) => ({ closest: (sel) => (sel === '[data-shortcut-modal="settings"]' ? modal : (extra && extra[sel]) || null) })
  fire(inModal({ 'nav > div:last-child > button': {} }), 100)
  await new Promise((r) => setTimeout(r, 20))
  check('picking a page in the list shows the page', modalAttrs['data-kbmob-page'] === '1', modalAttrs)
  check('the back bar is labelled in the page language', pageAttrs['data-kbmob-back'] === 'Settings', pageAttrs)
  fire(page, 300)
  check('a tap in the page is the page\'s own', 'data-kbmob-page' in modalAttrs)
  fire(Object.assign(page, { closest: (sel) => (sel === '[data-shortcut-modal="settings"]' ? modal : null) }), 20)
  check('a tap on the back bar goes back to the list', !('data-kbmob-page' in modalAttrs), modalAttrs)
  disposer()
}

process.exit(failed === 0 ? 0 : 1)
