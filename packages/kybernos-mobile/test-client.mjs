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
  const doc = {
    body, head,
    createElement: (t) => el(t),
    createElementNS: (ns, t) => el(t),
    getElementById: (id) => (id === 'kbmob-sheet' && sheet ? el('style') : null),
    querySelector: (sel) => {
      if (sel === '[data-slot="root"] > div') return frame
      if (sel === 'button[aria-keyshortcuts$="+B"]:not([aria-keyshortcuts*="Shift"])') return withToggle ? toggle : null
      if (sel === '[data-slot="sidebar"] button') return firstInSidebar
      return null
    },
    baseURI: 'http://127.0.0.1:3080/',
    addEventListener: (ev, fn, cap) => listeners.push({ ev, fn, cap }),
    removeEventListener: (ev, fn) => { const i = listeners.findIndex((l) => l.ev === ev && l.fn === fn); if (i >= 0) listeners.splice(i, 1) }
  }
  return { doc, frame, toggle, firstInSidebar, listeners, toggleClicks, body, head }
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
  try { new Function('window', 'document', SOURCE.replace("const MEDIA = '(max-width: 700px)'", "const MEDIA = (() => { throw new Error('init failed') })()"))(globalThis.window, globalThis.document); const p = defB.factory(); broke = p } catch (e) { broke = 'threw' } finally { console.warn = realWarn }
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

console.log('the file')
{
  check('user-visible text goes through the French/English picker', /kt\('Ouvrir le menu', 'Open the menu'\)/.test(SOURCE))
  check('no hard-coded theme colour', !/#[0-9a-fA-F]{3,8}\b/.test(SOURCE))
  check('the bundle keeps no state (no storage)', !/localStorage|sessionStorage|indexedDB/.test(SOURCE))
}

console.log(failed === 0 ? '\nOK' : `\n${failed} failure(s)`)
process.exit(failed === 0 ? 0 : 1)
