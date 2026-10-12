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
  check('the phone panel is published for the sidebar\'s button', typeof globalThis.window.__KB_MOBILE__ === 'object' && typeof globalThis.window.__KB_MOBILE__.Panel === 'function' && globalThis.window.__KB_MOBILE__.version === 1)
  check('the Settings section is « Mobile »', full.registered.length === 1 && full.registered[0].name === 'settings.section' && full.registered[0].id === 'kybernos-mobile' && full.registered[0].label === 'Mobile', full.registered)
  check('its styles are its own, under a prefix nobody else uses', full.styles.length === 1 && /\.kbmr-/.test(full.styles[0].textContent) && !/\.kbmob-/.test(full.styles[0].textContent))
  check('every effect is labelled', full.effects.every((l) => /^kybernos-mobile: /.test(l)) && full.effects.length === 4, full.effects)
  full.disposers.forEach((d) => { if (typeof d === 'function') d() })
  check('the cleanups take the seam and the styles away', globalThis.window.__KB_MOBILE__ === undefined && full.styles[0].removed === true)

  const noSlots = run({ withSlots: false })
  check('without the slots service the panel still works and nothing throws', noSlots.threw === null && typeof globalThis.window.__KB_MOBILE__.Panel === 'function' && noSlots.registered.length === 0)
  const noReq = run({ withRequire: false })
  check('without React the layout still mounts and the link stays off', noReq.threw === null && noReq.dom.body.children.some((c) => c.className === 'kbmob-menu') && globalThis.window.__KB_MOBILE__ === undefined)
  const noInject = run({ injectThrows: true })
  check('a DSH that refuses inject cannot break the layout', noInject.threw === null && noInject.dom.body.children.some((c) => c.className === 'kbmob-menu'))
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

process.exit(failed === 0 ? 0 : 1)
