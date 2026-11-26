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
// The display mode's block (`// <kb-mode>` … `// </kb-mode>`) is the one place the bundle reads its own storage (the person's choice, per account) and carries the resolver's text; test-mode.mjs covers it.
const NO_MODE = SOURCE.replace(/\/\/ <kb-mode>[\s\S]*?\/\/ <\/kb-mode>/, '')

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
  const keeping = (keep) => ({ closest: (sel) => (sel === '[data-slot="sidebar"]' ? {} : (sel === t.PICKS ? {} : (sel === t.KEEP_OPEN ? (keep ? {} : null) : null))) })
  check('a control that marks itself data-kb-keep-open (the Business template selector, the group fold) leaves the drawer open although it is a button of the menu', t.KEEP_OPEN === '[data-kb-keep-open]' && t.decide(keeping(true), dom.frame, true) === 'none' && t.decide(keeping(false), dom.frame, true) === 'close-after')
  // a session's row opens the chat; a button INSIDE it (its "..." menu, its quick actions) acts in place and must not take the drawer, and its menu, away
  const inRow = (kind) => {
    const btn = { name: 'actions' }; const row = { contains: (x) => x === btn }
    return { closest: (sel) => (sel === '[data-slot="sidebar"]' ? {} : (sel === t.PICKS ? {} : (sel === 'button' ? (kind === 'button' ? btn : null) : (sel === '[data-row-key^="session:"]' ? row : null)))) }
  }
  check('the "..." button of a session\'s row leaves the drawer open (its menu is how a chat is pinned, renamed or deleted)', t.decide(inRow('button'), dom.frame, true) === 'none')
  check('a tap on the session\'s row itself (not on a button in it) still opens the chat and closes the drawer', t.decide(inRow('row'), dom.frame, true) === 'close-after')
  check('a pinned chat\'s row and its "..." are not picks: the selector of the picks names neither, so a tap there leaves the drawer open for its menu', !/kbpin/.test(t.PICKS))
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
  // DSH's sidebar now starts with the brand button "New session" (330 px wide, it starts a chat); the toggle is the second, 44 px
  const rectOf = (l, tp, w, h) => ({ left: l, top: tp, width: w, height: h, right: l + w, bottom: tp + h })
  dom.firstInSidebar.getBoundingClientRect = () => rectOf(-390, 6, 330, 44)
  dom.toggle.getBoundingClientRect = () => rectOf(-52, 6, 44, 44)
  dom.doc.querySelectorAll = (sel) => (/data-slot="sidebar"\] button/.test(sel) ? [dom.firstInSidebar, dom.toggle] : [])
  const plugin = load(dom).factory()
  let disposer = null
  plugin.apply({ effect: (fn) => { disposer = fn(); return disposer } })
  const button = dom.body.children.find((c) => c.className === 'kbmob-menu')
  let threw = null
  try { button.listeners.find((l) => l.ev === 'click').fn({ stopPropagation () {} }) } catch (e) { threw = e }
  check('with the drawer closed it opens through the narrow toggle, not the wide brand button that comes first (it would start a chat)', threw === null && dom.toggleClicks.length === 1 && dom.toggleClicks[0] === dom.toggle, dom.toggleClicks.length)
  const open = makeDom({ withToggle: false, collapsed: false })
  const p2 = load(open).factory()
  p2.apply({ effect: (fn) => fn() })
  const b2 = open.body.children.find((c) => c.className === 'kbmob-menu')
  b2.listeners.find((l) => l.ev === 'click').fn({ stopPropagation () {} })
  check('with the drawer open and no shortcut it does nothing rather than click something else', open.toggleClicks.length === 0)
}

console.log('the home\'s « + » sheet and the keyboard')
{
  const dom = makeDom({ collapsed: true })
  const field = { tagName: 'DIV', isContentEditable: true, blurs: 0, blur () { this.blurs += 1; dom.doc.activeElement = dom.body } }
  dom.doc.activeElement = field
  const slot = { querySelector: () => dom.modeButton, parentElement: { querySelectorAll: () => [] }, contains: () => false }
  dom.modeButton = Object.assign(Object.create(null), { textContent: 'Plan', querySelector: () => null, getAttribute: () => null })
  const orig = dom.doc.querySelector
  dom.doc.querySelector = (sel) => (sel === '[data-slot="conversation.hero.agentPreset"]' ? slot : (sel === '[data-kb-beta]' ? null : orig(sel)))
  dom.doc.querySelectorAll = () => []
  const plugin = load(dom).factory()
  plugin.apply({ effect: (fn) => fn() })
  const plus = { querySelector: (sel) => (/plus/.test(sel) ? {} : null), cloneNode: () => ({}) }
  // found by its popup mark, not by an icon name (0.2.1 draws every icon as data-icon="svg")
  const ev = { target: { closest: (sel) => (sel === '[data-composer-card] button[aria-haspopup="listbox"]' ? plus : null) }, preventDefault () {}, stopPropagation () {} }
  const clicks = dom.listeners.filter((l) => l.ev === 'click' && l.cap === true)
  clicks.forEach((l) => l.fn(ev))
  const sheet = dom.body.children.find((c) => c.className === 'kbmob-sheet')
  check('a tap on « + » opens the sheet of ours', sheet !== undefined)
  check('the composer lets go of the focus when the sheet opens, so the keyboard does not rise over it', field.blurs === 1 && dom.doc.activeElement === dom.body, field.blurs)
  const guard = dom.listeners.filter((l) => l.ev === 'focusin' && l.cap === true).pop()   // the sheet's own, the last one added (the composer's guard is always there, first)
  check('while the sheet is open a focus that comes back to a text field is taken away again', guard !== undefined && (() => { dom.doc.activeElement = field; guard.fn({}); return dom.doc.activeElement === dom.body && field.blurs === 2 })())
  const mask = dom.body.children.find((c) => c.className === 'kbmob-sheet-mask')
  mask.listeners.find((l) => l.ev === 'click').fn({ stopPropagation () {} })
  check('once the sheet is closed its guard is gone (only the composer\'s own, always there, is left)', dom.listeners.filter((l) => l.ev === 'focusin').length === 1)
  // the composer's own guard: on a touch screen the composer does not take the focus by itself, but keeps it when the card was tapped
  {
    const comp = dom.listeners.find((l) => l.ev === 'focusin' && l.cap === true)
    const down = dom.listeners.find((l) => l.ev === 'pointerdown' && l.cap === true)
    const card = { contains: (x) => x === inside }
    const inside = { id: 'inside the card' }
    const outside = { id: 'a button outside' }
    const mk = () => ({ tagName: 'DIV', isContentEditable: true, blurs: 0, blur () { this.blurs += 1 }, closest: (sel) => (sel === '[data-composer-card]' ? card : null) })
    const a = mk()
    comp.fn({ target: a })
    check('a composer that takes the focus by itself (nothing was tapped) is made to let go', a.blurs === 1, a.blurs)
    const b = mk()
    down.fn({ target: outside }); comp.fn({ target: b })
    check('a tap elsewhere that moves the focus to the composer (a new chat) does not give it the keyboard either', b.blurs === 1, b.blurs)
    const c = mk()
    down.fn({ target: inside }); comp.fn({ target: c })
    check('a tap inside the composer card keeps the focus: the person is typing', c.blurs === 0, c.blurs)
    const send = { id: 'the Send button inside the card', closest: (sel) => (/button/.test(sel) ? {} : null) }
    card.contains = (x) => x === inside || x === send
    const e = mk()
    down.fn({ target: send }); comp.fn({ target: e })
    check('sending (a tap on a button of the card) does not call the keyboard back', e.blurs === 1, e.blurs)
    const f = { tagName: 'DIV', isContentEditable: false, getAttribute: (n) => (n === 'contenteditable' ? 'true' : null), blurs: 0, blur () { this.blurs += 1 }, closest: (sel) => (sel === '[data-composer-card]' ? card : null) }
    comp.fn({ target: f })
    check('the composer is recognised by its own marks when isContentEditable reads false', f.blurs === 1, f.blurs)
    // the composer's « + »: the engine focuses the field and opens its command menu FROM that focus; a field made to let go closed the menu at once (phone test 2026-11-08)
    const PLUS = '[data-composer-card] button[aria-haspopup="listbox"]'
    const plusBtn = { id: 'the composer plus', closest: (sel) => (sel === PLUS || sel === 'button, [role="button"], a' ? {} : null) }
    card.contains = (x) => x === inside || x === send || x === plusBtn
    const g1 = mk()
    down.fn({ target: plusBtn }); comp.fn({ target: g1 })
    check('on the home a tap on « + » does not give the composer the keyboard (the sheet of ours opens)', g1.blurs === 1, g1.blurs)
    const homeQuery = dom.doc.querySelector
    dom.doc.querySelector = (sel) => (sel === '[data-slot="conversation.hero.agentPreset"]' ? null : homeQuery(sel))
    const g2 = mk()
    down.fn({ target: plusBtn }); comp.fn({ target: g2 })
    check('in a chat a tap on « + » keeps the composer\'s focus: the engine\'s command menu is anchored to it', g2.blurs === 0, g2.blurs)
    const g3 = mk()
    down.fn({ target: outside }); comp.fn({ target: g3 })
    check('...and the next tap that is not « + » is back to the rule', g3.blurs === 1, g3.blurs)
    // « New chat » (the dock's button, `.kbmob-newchat`): the field it opens keeps the focus and the keyboard rises, like the « + » of a chat (owner's wish, mockup 2 of 2026-11-23). Only that button.
    const newBtn = { id: 'the dock\'s New chat', closest: (sel) => (sel === '.kbmob-newchat, [data-kb-keyboard]' || sel === 'button, [role="button"], a' ? {} : null) }
    const n1 = mk()
    down.fn({ target: newBtn }); comp.fn({ target: n1 })
    check('a tap on « New chat » keeps the focus of the field it opens: the keyboard rises, ready to write', n1.blurs === 0, n1.blurs)
    const realNow = Date.now
    const n2 = mk()
    down.fn({ target: newBtn }); Date.now = () => realNow() + 2000
    try { comp.fn({ target: n2 }) } finally { Date.now = realNow }
    check('...for a moment only (1.5 s): a focus that arrives long after the tap is back to the rule', n2.blurs === 1, n2.blurs)
    const recentsRow = { id: 'a row of Recents', closest: () => null }
    const n3 = mk()
    down.fn({ target: recentsRow }); comp.fn({ target: n3 })
    check('reopening a chat from Recents (a tap on its row) does not give the field the keyboard', n3.blurs === 1, n3.blurs)
    down.fn({ target: newBtn }); down.fn({ target: outside })
    const n4 = mk()
    comp.fn({ target: n4 })
    check('...and the tap that follows a « New chat » tap ends its grant', n4.blurs === 1, n4.blurs)
    // a card of the empty chat (the Kybernos plugin's slider, its sheet, the chip and the suggestions: `data-kb-keyboard`) asks for the keyboard the same way, and only a control that carries the mark
    const cardBtn = { id: 'a card of the empty chat', closest: (sel) => (/\[data-kb-keyboard\]/.test(sel) || sel === 'button, [role="button"], a' ? {} : null) }
    const c1 = mk()
    down.fn({ target: cardBtn }); comp.fn({ target: c1 })
    check('a tap on a card of the empty chat (`data-kb-keyboard`) keeps the focus of the field it fills: the keyboard rises, or stays up', c1.blurs === 0, c1.blurs)
    check('the pointer, not a guess, decides: the guard only looks for the dock\'s own class (`.kbmob-newchat`) and the mark `data-kb-keyboard`, no other button of the page', /closest\('\.kbmob-newchat, \[data-kb-keyboard\]'\)/.test(SOURCE) && !/\.kb4-newchat'\)/.test(SOURCE.slice(SOURCE.indexOf('const isNewChat'), SOURCE.indexOf('const isNewChat') + 400)))
    const plusClicks = dom.listeners.filter((l) => l.ev === 'click' && l.cap === true)
    const g4 = mk()
    down.fn({ target: outside }); plusClicks.forEach((l) => l.fn({ target: plusBtn, preventDefault () {}, stopPropagation () {} })); comp.fn({ target: g4 })
    check('a click on « + » that had no pointer (a keyboard, a script) keeps the focus as well', g4.blurs === 0, g4.blurs)
    dom.doc.querySelector = homeQuery
    const d = { tagName: 'INPUT', isContentEditable: false, blurs: 0, blur () { this.blurs += 1 }, closest: () => null }
    comp.fn({ target: d })
    check('a text field outside the composer is left alone', d.blurs === 0, d.blurs)
  }
  dom.doc.activeElement = field
  check('and a sheet opened while a button has the focus does not touch it', (() => { const b = { tagName: 'BUTTON', isContentEditable: false, blur () { throw new Error('a button must keep the focus') } }; dom.doc.activeElement = b; clicks.forEach((l) => l.fn(ev)); return dom.doc.activeElement === b })())
}


console.log('« New chat » and the keyboard that goes down (the 7 Nov defect: the caret stayed after « Retour »)')
{
  const dom = makeDom({ collapsed: true })
  const orig = dom.doc.querySelector
  dom.doc.querySelector = (sel) => (sel === '[data-kb-beta]' ? null : orig(sel))
  dom.doc.querySelectorAll = () => []
  const plugin = load(dom).factory()
  // a visual viewport the test drives: the keyboard rises when its height shrinks
  const vvFns = []
  const vv = { height: 880, width: 406, offsetTop: 0, addEventListener: (ev, fn) => { if (ev === 'resize') vvFns.push(fn) }, removeEventListener () {} }
  globalThis.window.visualViewport = vv
  globalThis.window.innerHeight = 880
  globalThis.window.innerWidth = 406
  plugin.apply({ effect: (fn) => fn() })
  const comp = dom.listeners.find((l) => l.ev === 'focusin' && l.cap === true)
  const down = dom.listeners.find((l) => l.ev === 'pointerdown' && l.cap === true)
  const card = { contains: () => false }
  const field = { tagName: 'DIV', isContentEditable: true, blurs: 0, blur () { this.blurs += 1; dom.doc.activeElement = dom.body }, closest: (sel) => (sel === '[data-composer-card]' ? card : null) }
  const newBtn = { closest: (sel) => (sel === '.kbmob-newchat, [data-kb-keyboard]' || sel === 'button, [role="button"], a' ? {} : null) }
  const resize = (h) => { vv.height = h; vvFns.forEach((f) => f()) }
  down.fn({ target: newBtn }); dom.doc.activeElement = field; comp.fn({ target: field })
  resize(560)   // the keyboard rises over the field
  check('« New chat »: the keyboard rises with the field focused, nothing is taken away', field.blurs === 0, field.blurs)
  resize(880)   // Back, or the key that hides it: the keyboard goes down
  check('...the keyboard goes down (Back): the field lets go of the focus, no caret blinks in a field with no keyboard', field.blurs === 1 && dom.doc.activeElement === dom.body, field.blurs)
  // a field the person tapped themselves is theirs: the keyboard going down does not take it
  const mine = { tagName: 'DIV', isContentEditable: true, blurs: 0, blur () { this.blurs += 1; dom.doc.activeElement = dom.body }, closest: (sel) => (sel === '[data-composer-card]' ? card : null) }
  down.fn({ target: newBtn }); dom.doc.activeElement = mine; comp.fn({ target: mine })
  resize(560)
  down.fn({ target: mine }); card.contains = (x) => x === mine   // the person taps the field: their own focus
  resize(880)
  check('a field the person tapped after « New chat » is their own: the keyboard going down does not take the focus', mine.blurs === 0, mine.blurs)
  // a turn of the screen is not a keyboard
  const rot = { tagName: 'DIV', isContentEditable: true, blurs: 0, blur () { this.blurs += 1 }, closest: (sel) => (sel === '[data-composer-card]' ? card : null) }
  card.contains = () => false
  down.fn({ target: newBtn }); dom.doc.activeElement = rot; comp.fn({ target: rot })
  vv.width = 880; globalThis.window.innerHeight = 406; resize(406); vv.width = 406; globalThis.window.innerHeight = 880; resize(880)
  check('a turn of the screen (the viewport changes width) is not taken for a keyboard going down', rot.blurs === 0, rot.blurs)
  delete globalThis.window.visualViewport
}

console.log('Kaby\'s « + »: the engine\'s own list, not our sheet')
{
  const dom = makeDom({ collapsed: true })
  const slot = { querySelector: () => dom.modeButton, parentElement: { querySelectorAll: () => [] }, contains: () => false }
  dom.modeButton = Object.assign(Object.create(null), { textContent: 'Plan', querySelector: () => null, getAttribute: () => null })
  const orig = dom.doc.querySelector
  dom.doc.querySelector = (sel) => (sel === '[data-slot="conversation.hero.agentPreset"]' ? slot : (sel === '[data-kb-beta]' ? null : orig(sel)))
  dom.doc.querySelectorAll = () => []
  dom.doc.documentElement = { classList: { contains: (c) => c === 'kb-kaby', add () {}, remove () {} } }
  const plugin = load(dom).factory()
  plugin.apply({ effect: (fn) => fn() })
  const plus = { querySelector: (sel) => (/plus/.test(sel) ? {} : null), cloneNode: () => ({}) }
  let stopped = 0
  const ev = { target: { closest: (sel) => (sel === '[data-composer-card] button[aria-haspopup="listbox"]' ? plus : null) }, preventDefault () { stopped += 1 }, stopPropagation () { stopped += 1 } }
  dom.listeners.filter((l) => l.ev === 'click' && l.cap === true).forEach((l) => l.fn(ev))
  check('in Kaby mode a tap on « + » is left to the engine: no sheet of ours (its rows, the folder, the mode and the access shield, are all hidden there)', dom.body.children.find((c) => c.className === 'kbmob-sheet') === undefined && stopped === 0, stopped)
  // ...and its tap keeps the focus, as a chat's does: the engine opens its list FROM the focus, a field made to let go closed it at once (rc.5 on a blank Kaby chat: the tap did nothing)
  const comp = dom.listeners.find((l) => l.ev === 'focusin' && l.cap === true)
  const down = dom.listeners.find((l) => l.ev === 'pointerdown' && l.cap === true)
  const card = { contains: (x) => x === plusBtn }
  const plusBtn = { id: 'the composer plus', closest: (sel) => (sel === '[data-composer-card] button[aria-haspopup="listbox"]' || sel === 'button, [role="button"], a' ? {} : null) }
  const field = { tagName: 'DIV', isContentEditable: true, blurs: 0, blur () { this.blurs += 1 }, closest: (sel) => (sel === '[data-composer-card]' ? card : null) }
  down.fn({ target: plusBtn }); comp.fn({ target: field })
  check('in Kaby mode the tap on « + » keeps the composer\'s focus although the hidden hero parts are in the page: the engine\'s list opens from it', field.blurs === 0, field.blurs)
}
console.log('the phone link, mounted apart from the layout')
{
  const fakeReact = { createElement: (...a) => ({ a }), useState: (v) => [v, () => {}], useRef: () => ({ current: null }) }
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
  const fakeReact = { createElement: (...a) => ({ a }), useState: (v) => [v, () => {}], useRef: () => ({ current: null }) }
  const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KybernosHost/0.1.0 (ios)'
  const runApp = ({ ua = IOS_UA, rn = true, lang = 'en' } = {}) => {
    const dom = makeDom({ collapsed: true })
    const def = load(dom, { lang })
    const win = globalThis.window
    win.navigator = { userAgent: ua }
    const posted = []; const assigned = []
    win.location = { assign: (u) => assigned.push(u) }
    // `layers` has its own file, test-layers.mjs: it is kept out of the list the older checks count
    if (rn) win.ReactNativeWebView = { postMessage: (m) => { if (JSON.parse(m).kybernos !== 'layers') posted.push(m) } }
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
  check('inside the app the Settings section is « The Kybernos app » (same id as the phone link: the same place in the list), not the phone link', app.registered.filter((r) => r.name === 'settings.section').length === 1 && app.registered[0].id === 'kybernos-mobile' && app.registered[0].name === 'settings.section' && app.registered[0].label === 'The Kybernos app', app.registered)
  check('the phone link window is not offered (the account menu and Kaby\'s strip hide their entry without it)', app.win.__KB_MOBILE__ === undefined)
  check('the other bundles get a seam: platform, version, and a way to open the app screens', app.win.__KB_APP__ !== undefined && app.win.__KB_APP__.platform === 'ios' && app.win.__KB_APP__.appVersion === '0.1.0' && typeof app.win.__KB_APP__.openSettings === 'function' && typeof app.win.__KB_APP__.openLog === 'function')
  check('the page is marked with classes a stylesheet can use', app.classes.has('kb-app') && app.classes.has('kb-app-ios'), [...app.classes])
  check('the app is told once that the interface has its entry (it then drops its fallback gear)', app.posted.length === 1 && JSON.parse(app.posted[0]).kybernos === 'app-entry' && JSON.parse(app.posted[0]).entry === 'settings', app.posted)
  check('its styles are its own, under a prefix nobody else uses', app.styles.length === 1 && /\.kbapp-/.test(app.styles[0].textContent) && !/\.kbmr-|\.kbmob-/.test(app.styles[0].textContent))
  // report an AI answer (store rules, kybernos-host/STORES.md item 4): a control under each finished answer, in the app only, saved then sent, never silent
  const R = app.test !== undefined ? app.test : null
  const turnTail = app.registered.filter((r) => r.name === 'conversation.chat.turnTail')
  check('inside the app one entry is added under each finished answer, with an id of its own', turnTail.length === 1 && turnTail[0].id === 'kybernos-mobile-report' && typeof turnTail[0].order === 'number', turnTail)
  check('in a browser nothing is added under the answers', desk.registered.every((r) => r.name !== 'conversation.chat.turnTail'))
  const reportCss = app.styles[0].textContent.slice(app.styles[0].textContent.indexOf('.kbrp{'), app.styles[0].textContent.indexOf('.kbapp-page{'))
  check('the report control is styled with the page tokens only (no hard-coded hex colour)', /\.kbrp-open\{/.test(reportCss) && !/#[0-9a-f]{3,6}\b/i.test(reportCss), reportCss.slice(0, 80))
  if (R !== null) {
    const msg = R.reportMessage({ reason: 'dangerous', comment: '  too risky  ', excerpt: 'the answer', ref: 'session s1, turn 4' })
    check('the report says the reason in English, the reference, the comment and, only when given, the excerpt', msg.startsWith('[AI answer report] Reason: Dangerous or harmful') && msg.includes('Reference: session s1, turn 4') && msg.includes('Comment: too risky') && msg.includes('Answer excerpt (added by the sender):\nthe answer'), msg)
    const bare = R.reportMessage({ reason: 'wrong', comment: '', excerpt: '', ref: '' })
    check('without a comment or an excerpt neither is mentioned (nothing is attached by default)', bare === '[AI answer report] Reason: Wrong or misleading', bare)
    check('a made-up reason still gives a report, and the texts are bounded', R.reportMessage({ reason: 'zzz' }).includes('Something else') && R.reportMessage({ reason: 'other', excerpt: 'x'.repeat(5000), comment: 'y'.repeat(5000) }).length < 2700)
    check('the four reasons are offered, each in both languages', R.REPORT_REASONS.length === 4 && R.REPORT_REASONS.every((x) => x.en !== '' && x.fr !== ''))
    // the excerpt guess: the nearest block of text before the control, found a few levels up when it is not a sibling
    const sib = (text, prev) => ({ innerText: text, previousElementSibling: prev || null })
    const node = { previousElementSibling: sib('', sib('the answer', sib('the user message', null))), parentElement: null }
    check('the excerpt guess is the nearest block of text before the control (not the earlier messages)', R.textBefore(node) === 'the answer', R.textBefore(node))
    const deep = { previousElementSibling: null, parentElement: { previousElementSibling: null, parentElement: { previousElementSibling: sib('from three levels up', null), parentElement: null } } }
    check('with nothing before it the guess looks up through the parents', R.textBefore(deep) === 'from three levels up')
    let chain = { previousElementSibling: sib('found at level 7', null), parentElement: null }
    for (let i = 0; i < 7; i++) chain = { previousElementSibling: null, parentElement: chain }
    check('it looks as far as eight levels up (the interface draws the answer five levels above the control)', R.textBefore(chain) === 'found at level 7')
    check('a long answer keeps its first 1500 characters, and no text is not an error', R.textBefore({ previousElementSibling: sib('a'.repeat(4000), null), parentElement: null }).length === 1500 && R.textBefore({ previousElementSibling: null, parentElement: null }) === '' && R.textBefore(null) === '')
    // save, then send
    const calls = []
    const post = (script) => async (path, body) => { calls.push(path + ' ' + body.type); return script[path] }
    const ok = { status: 200, out: { ok: true } }
    calls.length = 0
    const sent = await R.submitReport('m', post({ '/kybernos/feedback': ok, '/kybernos/feedback/send': ok }))
    check('saved first, then sent: the team has it', sent.state === 'sent' && calls.join() === '/kybernos/feedback bug,/kybernos/feedback/send bug', [sent, calls])
    const signedOut = await R.submitReport('m', post({ '/kybernos/feedback': ok, '/kybernos/feedback/send': { status: 200, out: { ok: false, error: 'non_connecte' } } }))
    check('signed out: kept on the phone, and it says why (the e-mail route is offered)', signedOut.state === 'saved' && signedOut.why === 'signedout', signedOut)
    const guard = await R.submitReport('m', post({ '/kybernos/feedback': ok, '/kybernos/feedback/send': { status: 401, out: null } }))
    check('refused by the guard counts as signed out', guard.state === 'saved' && guard.why === 'signedout')
    const net = await R.submitReport('m', post({ '/kybernos/feedback': ok, '/kybernos/feedback/send': { status: 0, out: null } }))
    check('no answer from the relay: kept, with the network as the reason', net.state === 'saved' && net.why === 'net', net)
    calls.length = 0
    const lost = await R.submitReport('m', post({ '/kybernos/feedback': { status: 507, out: { ok: false, error: 'full' } }, '/kybernos/feedback/send': ok }))
    check('when it cannot even be kept it is not sent and it says so, with the code the page got', lost.state === 'failed' && calls.length === 1 && lost.code === '507 full', [lost, calls])
    const mailto = R.reportMailto('[AI answer report] Reason: x & y')
    check('the e-mail route goes to the one address of the product, with the report in the body', mailto.startsWith('mailto:contact@kybernos.app?subject=') && mailto.includes(encodeURIComponent('x & y')) && R.REPORT_CONTACT === 'contact@kybernos.app', mailto)
  }

  // store rules: no purchase flow and no sign-up inside the app (kybernos-host/STORES.md items 5 and 6), hidden under the app class only
  const css = app.styles[0].textContent
  const HIDDEN = ['menu-signup', 'menu-plans', 'menu-plan-cta', 'menu-plan-credits', 'upgrade-dialog', 'team-lock-plans', 'provider-plans', 'kc-pro-plans', 'kybernos-kyber-upgrade', 'plugins-add', 'plugins-add-empty', 'plugins-drafts']
  check('inside the app the purchase, sign-up and plugin-install controls are hidden, under the app class only', /html\.kb-app :is\(/.test(css) && HIDDEN.every((k) => css.includes('[data-kb="' + k + '"]')) && /display:none !important/.test(css), css.slice(0, 200))
  check('in a browser the stylesheet is not mounted, so the desktop keeps them', desk.styles.every((x) => !x.textContent.includes('kb-app :is(')))
  const bundles = ['kybernos-cloud', 'kybernos-plugin', 'kybernos-composio', 'kybernos-kyber', 'kybernos-hub'].map((d) => readFileSync(join(fileURLToPath(new URL('../' + d + '/', import.meta.url)), 'client.js'), 'utf8')).join('\n')
  check('every hidden hook is still drawn by the bundle that owns it (a rename would silently show the control again)', HIDDEN.every((k) => (k.startsWith('menu-') && !k.startsWith('menu-plan-') ? bundles.includes("entree('" + k.slice(5) + "'") : bundles.includes("'" + k + "'"))), HIDDEN.filter((k) => !(k.startsWith('menu-') && !k.startsWith('menu-plan-') ? bundles.includes("entree('" + k.slice(5) + "'") : bundles.includes("'" + k + "'"))))
  const page = expand(app.components[0]())
  const acts = walk(page).filter((n) => n.props['data-act'] !== undefined)
  check('the page has three buttons: the model key, the engine log and the open-source components', acts.map((n) => n.props['data-act']).join() === 'open-key,open-log,open-notices', acts.map((n) => n.props['data-act']))
  acts.forEach((n) => n.props.onClick())
  check('they open the app\'s own screens through its links', app.assigned.join() === 'kybernos://settings,kybernos://log', app.assigned)
  check('every card has a stable hook for live checks', ['mobile-app-page', 'mobile-app-key', 'mobile-app-log', 'mobile-app-notices', 'mobile-app-auto'].every((k) => walk(page).some((n) => n.props['data-kb'] === k)))
  const said = textOf(page)
  check('it says where the key lives, that the engine runs on the phone, and what happens to automations', /secure storage/.test(said) && /runs on this phone/.test(said) && /cloud computer/.test(said))
  check('it does not talk about linking a phone to a computer', !/QR|link a phone|relay/i.test(said))
  app.disposers.forEach((d) => { if (typeof d === 'function') d() })
  check('the cleanups take the seam, the classes and the styles away', app.win.__KB_APP__ === undefined && app.classes.size === 0 && app.styles[0].removed === true)

  const fr = runApp({ lang: 'fr' })
  check('in French the section is « L’app Kybernos » (every label goes through kt)', fr.registered[0].label === 'L’app Kybernos')
  const noBridge = runApp({ rn: false })
  check('without the app\'s message bridge nothing throws and the page is still there', noBridge.threw === null && noBridge.registered.filter((r) => r.name === 'settings.section').length === 1)
  const android = runApp({ ua: 'Mozilla/5.0 (Linux; Android 16) KybernosHost/0.1.0 (android)' })
  check('on Android the classes say so', android.classes.has('kb-app-android') && !android.classes.has('kb-app-ios'))
}

console.log('the file')
{
  check('the phone link uses its own class prefix, not the layout\'s', /className: 'kbmr-/.test(SOURCE) && !/className: 'kbmob-[a-z]/.test(SOURCE.slice(SOURCE.indexOf('buildRemoteUi'))))
  check('the QR code is the only place colours are named, as words (a scanner needs black on white)', /fill: 'white'/.test(SOURCE) && /fill: 'black'/.test(SOURCE))
  check('user-visible text goes through the French/English picker', /kt\('Ouvrir le menu', 'Open the menu'\)/.test(SOURCE))
  check('no hard-coded theme colour', !/#[0-9a-fA-F]{3,8}\b/.test(SOURCE))
  check('the bundle keeps no state (no storage), but for the display mode\'s block', !/localStorage|sessionStorage|indexedDB/.test(NO_MODE) && SOURCE.length > NO_MODE.length)
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
  check('closed: the narrow button at the top of the sidebar is its open button (DSH before the brand button)', tc.toggle() !== null && tc.toggle().name === 'open-sidebar')
  // DSH 0.2.2 and after: the brand button "New session" is the first of the sidebar, 331 px wide (measured on an Android phone, 2026-11-07); the toggle is the second
  const brandFirst = [btn('brand', rect(-390, 6, 331, 44)), btn('open-sidebar', rect(-52, 6, 44, 44)), btn('new-session', rect(0, 0, 0, 0)), btn('row', rect(-398, 54, 390, 54))]
  const tb = load(withButtons(true, brandFirst)).factory().__test
  check('closed, with the brand button first in the DOM: the toggle is still the narrow one, never the brand button', tb.toggle() !== null && tb.toggle().name === 'open-sidebar', tb.toggle() && tb.toggle().name)
  const to = load(withButtons(false, brandFirst.map((x) => (x.name === 'open-sidebar' ? btn('close-sidebar', rect(334, 6, 44, 44)) : x)))).factory().__test
  check('open, with the brand button first: the collapse button is the narrow one', to.toggle() !== null && to.toggle().name === 'close-sidebar', to.toggle() && to.toggle().name)
  check('closed and nothing narrow in the sidebar: nothing is clicked (the wide button would start a chat)', load(withButtons(true, [btn('brand', rect(-390, 6, 331, 44))])).factory().__test.toggle() === null)
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

console.log('Settings on a phone, DSH 0.2.2 (the panel is drawn flat: title strip, nav, header, page): the back bar is the title strip')
{
  const dom = makeDom({ collapsed: true })
  const plugin = load(dom, { lang: 'en' }).factory()
  let disposer = null
  plugin.apply({ effect: (fn) => { disposer = fn(); return disposer } })
  const modalAttrs = {}
  const stripAttrs = {}
  const kids = []
  const strip = { tagName: 'DIV', setAttribute: (k, v) => { stripAttrs[k] = v }, getBoundingClientRect: () => ({ top: 0 }), querySelector: (sel) => kids.find((k) => sel === '[data-kbmob-backbtn]' && k.attrs['data-kbmob-backbtn'] !== undefined) || null, appendChild: (c) => { kids.push(c); return c }, firstChild: null }
  const modal = { children: [strip, { tagName: 'NAV' }, { tagName: 'DIV' }, { tagName: 'DIV' }], hasAttribute: (k) => k in modalAttrs, setAttribute: (k, v) => { modalAttrs[k] = v }, removeAttribute: (k) => { delete modalAttrs[k] } }
  const fire = (target, clientY) => dom.listeners.filter((l) => l.ev === 'click' && l.cap === true).forEach((l) => l.fn({ target, clientY, preventDefault () {}, stopPropagation () {} }))
  const inModal = (extra) => ({ closest: (sel) => (sel === '[data-shortcut-modal="settings"]' ? modal : (extra && extra[sel]) || null) })
  fire(inModal({ 'nav > div:last-child > button': {} }), 100)
  await new Promise((r) => setTimeout(r, 20))
  check('picking a page shows the page', modalAttrs['data-kbmob-page'] === '1', modalAttrs)
  check('the back bar label sits on the title strip, not on the nav', stripAttrs['data-kbmob-back'] === 'Settings', stripAttrs)
  // the bar is a pseudo-element: no focus, no name for TalkBack. A real button lies over it (transparent), named, and it does what a tap on the bar does.
  {
    const btn = kids[0]
    check('a real button lies over the bar, named « Back to Settings »', kids.length === 1 && btn !== undefined && btn.type === 'button' && btn.attrs['data-kbmob-backbtn'] === '' && btn.attrs['aria-label'] === 'Back to Settings', btn && btn.attrs)
    fire(inModal({ 'nav > div:last-child > button': {} }), 100)   // picked again: still ONE button
    check('picking a page again does not add another', kids.length === 1, kids.length)
    const click = btn.listeners.find((l) => l.ev === 'click')
    let stopped = false
    check('the button goes back to the list', click !== undefined && (() => { click.fn({ stopPropagation () { stopped = true } }); return !('data-kbmob-page' in modalAttrs) && stopped })(), modalAttrs)
    modalAttrs['data-kbmob-page'] = '1'
  }
  fire(Object.assign(strip, { closest: (sel) => (sel === '[data-shortcut-modal="settings"]' ? modal : null) }), 60)
  check('a tap on the title strip goes back to the list', !('data-kbmob-page' in modalAttrs), modalAttrs)
  disposer()
}

console.log('a new chat on the phone never stays dead (the engine greys the composer when the chat on screen has no workspace)')
{
  const T = load(makeDom()).factory().__test
  const ws = (id, title, sessionIds = [], createdAt = '2026-11-01T00:00:00Z') => ({ workspaceId: id, title, sessionIds, createdAt })
  const engine = ({ items = [], byId = {}, main, wphase = 'ready', sphase = 'ready' } = {}) => {
    const calls = { start: [], init: 0 }
    const uw = {
      workspaces: { list: { getSnapshot: () => ({ phase: wphase, items }) }, initializeDefault: () => { calls.init += 1; return Promise.resolve({ workspaceId: 'made' }) } },
      sessions: { list: { getSnapshot: () => ({ phase: sphase, byId }) } },
      mainReference: main,
      startSession: (id) => { calls.start.push(id) }
    }
    return { uw, calls }
  }
  // what the stores say: the engine's own rule, without waiting for the chats to be loaded
  check('the workspaces still loading: nothing is judged', T.homeState(engine({ wphase: 'loading' }).uw).known === false && T.homeState(engine({ wphase: 'loading' }).uw).dead === false)
  check('the chats still loading (offline they may stay so): the stores are judged all the same', (() => { const s = T.homeState(engine({ items: [ws('a', 'Kaby')], sphase: 'loading' }).uw); return s.known === true && s.ready === false && s.dead === true })())
  check('no chat open: dead', T.homeState(engine({ items: [ws('a', 'Kaby')] }).uw).dead === true)
  check('a blank chat that no workspace holds: dead', T.homeState(engine({ items: [ws('a', 'Kaby')], byId: { s1: { blank: true, updatedAt: 1 } }, main: { sessionId: 's1' } }).uw).dead === true)
  check('a chat that is not in the chat list at all and that no workspace holds: dead too (the engine has no folder to show for it)', T.homeState(engine({ items: [ws('a', 'Kaby')], main: { sessionId: 'ghost' } }).uw).dead === true)
  check('a blank chat held by a workspace: alive', T.homeState(engine({ items: [ws('a', 'Kaby', ['s1'])], byId: { s1: { blank: true, updatedAt: 1 } }, main: { sessionId: 's1' } }).uw).dead === false)
  check('a chat with words in it, held by no workspace (opened from elsewhere): left alone', T.homeState(engine({ items: [ws('a', 'Kaby')], byId: { s1: { blank: false, updatedAt: 1 } }, main: { sessionId: 's1' } }).uw).dead === false)
  check('a main view that is not a chat (no session id): left alone', T.homeState(engine({ items: [ws('a', 'Kaby')], main: { subagentAddress: 'x' } }).uw).dead === false)
  // what the screen says
  const screen = ({ hero = true, editable = 'false' } = {}) => ({ querySelector: (sel) => (sel === '[data-composer-input]' ? { getAttribute: () => editable } : sel === '[data-kb-hero]' ? (hero ? {} : null) : null) })
  check('the screen: the headline is up and the field is not editable = dead', T.homeDomDead(screen()) === true)
  check('the screen: an editable field = alive', T.homeDomDead(screen({ editable: 'true' })) === false)
  check('the screen: no headline (a conversation) = not the Home, left alone', T.homeDomDead(screen({ hero: false })) === false)
  // which workspace
  check('the only workspace', T.homeTarget([ws('a', 'Kaby')], {}) === 'a')
  check('several: the one with the most recent chat', T.homeTarget([ws('a', 'Kaby', ['s1']), ws('b', 'Kybernos', ['s2'])], { s1: { updatedAt: 5 }, s2: { updatedAt: 9 } }) === 'b')
  check('several, no chat anywhere: the one called Kaby', T.homeTarget([ws('b', 'Kybernos'), ws('a', 'Kaby')], {}) === 'a')
  check('several, no chat, none called Kaby: the newest', T.homeTarget([ws('b', 'One', [], '2026-11-01T00:00:00Z'), ws('c', 'Two', [], '2026-11-05T00:00:00Z')], {}) === 'c')
  check('none: no target', T.homeTarget([], {}) === null)
  // the runner, on a fake clock and a fake page
  const run = (eng, { choosing = false, drawerDialog = false, drawerOpen = false, dom = null, noService = false } = {}) => {
    let clock = 0
    const lineEls = []
    const card = { parentNode: { insertBefore: (el) => { lineEls.push(el) } } }
    const editable = { value: dom === null ? 'true' : (dom ? 'false' : 'true') }
    const doc = {
      visibilityState: 'visible',
      addEventListener () {}, removeEventListener () {},
      createElement: () => ({ attrs: {}, setAttribute (k, v) { this.attrs[k] = v }, addEventListener (ev, fn) { this.click = fn }, remove () { const i = lineEls.indexOf(this); if (i >= 0) lineEls.splice(i, 1) } }),
      querySelectorAll: (sel) => (sel === '[role="dialog"], [role="menu"], [role="listbox"]' ? (choosing === true ? [{ getBoundingClientRect: () => ({ left: 50, right: 350, top: 100, bottom: 300, width: 300, height: 200 }) }] : drawerDialog === true ? [{ getBoundingClientRect: () => ({ left: -357, right: 0, top: 0, bottom: 757, width: 357, height: 757 }) }] : []) : []),
      querySelector: (sel) => {
        if (sel === '[data-slot="root"] > div') return { hasAttribute: () => drawerOpen !== true }
        if (sel === '[' + T.HOME_LINE_ATTR + ']') return lineEls[0] || null
        if (sel === '[data-composer-placeholder]') return { closest: () => card }
        if (sel === '[data-composer-input]') return { getAttribute: () => editable.value }
        if (sel === '[data-kb-hero]') return dom === null ? null : {}
        return null
      }
    }
    const win = { innerWidth: 406, innerHeight: 757, addEventListener () {}, removeEventListener () {} }
    let tickFn = null
    const r = T.startHomeRecovery(win, doc, () => (noService ? null : eng.uw), { now: () => clock, setInterval: (fn) => { tickFn = fn; return 1 }, clearInterval: () => { tickFn = null } })
    const advance = (ms) => { for (let i = 0; i < Math.floor(ms / 1500); i += 1) { clock += 1500; if (tickFn !== null) tickFn() } }
    return { r, win, advance, lineEls, at: () => clock, isRunning: () => tickFn !== null }
  }
  { // a dead start: waits for the engine's own restore, then opens a chat in the workspace used last
    const eng = engine({ items: [ws('a', 'Kaby', ['s1']), ws('b', 'Kybernos', ['s2'])], byId: { s1: { updatedAt: 5 }, s2: { updatedAt: 9 } } })
    const t = run(eng)
    t.advance(4500)
    check('it does not jump in before the engine has had its moment', eng.calls.start.length === 0, eng.calls)
    t.advance(4500)
    check('then it opens a chat in the workspace used last', eng.calls.start.length === 1 && eng.calls.start[0] === 'b', eng.calls)
    t.r.stop()
  }
  { // the case measured on the phone: the chats never load, and only the screen tells
    const eng = engine({ items: [ws('a', 'Kaby'), ws('b', 'Kybernos')], sphase: 'loading' })
    const t = run(eng, { dom: true })
    t.advance(12000)
    check('chats never loaded (offline), screen dead: it opens a chat all the same', eng.calls.start.length === 1 && eng.calls.start[0] === 'a', eng.calls)
    check('the line is not there yet before 14 s', t.lineEls.length === 0)
    t.advance(6000)
    check('the line is there after about 14 s, whatever the stores say', t.lineEls.length === 1, t.lineEls.length)
    t.r.stop()
  }
  { // no engine service at all: the screen alone still brings the line
    const t = run(engine(), { dom: true, noService: true })
    t.advance(21000)
    check('no engine service: nothing to call, but the line is written after about 14 s', t.lineEls.length === 1 && t.r.tries() === 0, [t.lineEls.length, t.r.tries()])
    check('state() says there is no service and that the screen is dead', (() => { const s = t.win.__KB_HOME_RECOVERY__.state(); return s.service === false && s.domDead === true && s.dead === true && s.line === true })())
    t.r.stop()
    check('state() goes away when the watcher stops', t.win.__KB_HOME_RECOVERY__ === undefined)
  }
  { // it never fights a chat that is alive, and never the person who is choosing (for a while)
    const alive = engine({ items: [ws('a', 'Kaby', ['s1'])], byId: { s1: { blank: true, updatedAt: 1 } }, main: { sessionId: 's1' } })
    const t1 = run(alive, { dom: false }); t1.advance(30000)
    check('a chat with a workspace and an editable field is left alone', alive.calls.start.length === 0 && t1.lineEls.length === 0, alive.calls); t1.r.stop()
    const dead = engine({ items: [ws('a', 'Kaby'), ws('b', 'Two')] })
    const t2 = run(dead, { choosing: true }); t2.advance(21000)
    check('while a menu or a sheet is open (the person is choosing) it waits', dead.calls.start.length === 0, dead.calls)
    t2.advance(15000)
    check('but not for ever: after 25 s dead it goes on', dead.calls.start.length >= 1, dead.calls); t2.r.stop()
    const drawer = engine({ items: [ws('a', 'Kaby'), ws('b', 'Two')] })
    const t4 = run(drawer, { drawerOpen: true }); t4.advance(21000)
    check('while the drawer is open (the person is in the sidebar) it waits', drawer.calls.start.length === 0, drawer.calls); t4.r.stop()
    const hidden = engine({ items: [ws('a', 'Kaby'), ws('b', 'Two')] })
    const t5 = run(hidden, { drawerDialog: true }); t5.advance(12000)
    check('the drawer\'s own dialog, parked off the screen while it is closed, does not count as « choosing »', hidden.calls.start.length >= 1, hidden.calls); t5.r.stop()
    const loading = engine({ items: [ws('a', 'Kaby')], wphase: 'loading' })
    const t3 = run(loading); t3.advance(30000)
    check('workspaces not loaded and a live screen: it does nothing', loading.calls.start.length === 0, loading.calls); t3.r.stop()
  }
  { // it tries four times, five seconds apart; the line stays until a chat opens
    const eng = engine({ items: [ws('a', 'Kaby')] })
    const t = run(eng)
    t.advance(90000)
    check('four tries at most', eng.calls.start.length === 4 && t.r.tries() === 4, eng.calls)
    check('one line above the composer says what to do, in the person\'s language, and it is a button', t.lineEls.length === 1 && /Ouvre le menu/.test(String(t.lineEls[0].textContent)) && t.lineEls[0].attrs.type === 'button', t.lineEls.length)
    check('the line is drawn once, not again at each tick', t.lineEls.length === 1, t.lineEls.length)
    eng.uw.mainReference = { sessionId: 's9' }; eng.uw.workspaces.list.getSnapshot = () => ({ phase: 'ready', items: [ws('a', 'Kaby', ['s9'])] }); eng.uw.sessions.list.getSnapshot = () => ({ phase: 'ready', byId: { s9: { blank: true, updatedAt: 2 } } })
    t.advance(3000)
    check('the line goes away as soon as a chat with a workspace is open', t.lineEls.length === 0, t.lineEls.length)
    t.r.stop()
  }
  { // no workspace at all: the engine makes its default one, then a chat is opened in it
    const eng = engine({ items: [] })
    const t = run(eng)
    t.advance(9000)
    await new Promise((r) => setTimeout(r, 10))
    check('no workspace at all: the engine creates its default one and a chat opens in it', eng.calls.init === 1 && eng.calls.start[0] === 'made', eng.calls)
    t.r.stop()
  }
  { // the watch ends after two minutes and wakes again when the app comes back to the front
    const eng = engine({ items: [ws('a', 'Kaby', ['s1'])], byId: { s1: { blank: true, updatedAt: 1 } }, main: { sessionId: 's1' } })
    const t = run(eng)
    t.advance(125000)
    check('the first watch ends after two minutes (no timer left running)', t.isRunning() === false)
    t.r.again()
    check('coming back to the foreground starts another short watch', t.isRunning() === true)
    t.r.stop()
    check('stopped for good: no timer', t.isRunning() === false)
  }
  check('the watcher starts at once inside the app (it does not wait for the engine\'s service), asks for the service by itself, and is in its own try/catch', /appHost\(\) !== null\) \{\s*let svc = null[\s\S]{0,600}ctx\.inject\(\['uiWorkspace'\][\s\S]{0,700}ctx\.effect\(\(\) => \{ const r = startHomeRecovery\(window, document, getSvc\)/.test(SOURCE) && /home recovery disabled/.test(SOURCE))
}

console.log('« New chat » on an empty chat: the page gives the field the focus when the engine gave it to nothing (real phone, 2026-11-23: no keyboard)')
{
  const t = load(makeDom({ collapsed: true })).factory().__test
  const mkInput = (o = {}) => {
    const el = { tagName: 'DIV', isContentEditable: true, attrs: { 'contenteditable': 'true', ...(o.attrs || {}) }, rect: o.rect || { width: 363, height: 60 }, inert: o.inert === true, focusCalls: 0, focusArgs: null }
    el.getAttribute = (n) => (n in el.attrs ? el.attrs[n] : null)
    el.getBoundingClientRect = () => el.rect
    el.closest = (sel) => (sel === '[inert]' && el.inert ? {} : null)
    el.focus = (arg) => { el.focusCalls += 1; el.focusArgs = arg; if (o.refuses !== true) doc.activeElement = el }
    return el
  }
  const body = { tagName: 'BODY' }
  let doc = { body, activeElement: body, querySelector: () => null }
  const withInput = (el, active) => { doc = { body, activeElement: active === undefined ? body : active, querySelector: (sel) => (sel === '[data-composer-input]' ? el : null) }; return doc }
  const ready = mkInput(); withInput(ready)
  check('the composer is there, editable, drawn and not inert: it gets the focus (no scroll), the attempt is done', t.composerFocusStep(doc) === 'done' && ready.focusCalls === 1 && ready.focusArgs.preventScroll === true && doc.activeElement === ready)
  const behind = mkInput({ inert: true }); withInput(behind)
  check('the page behind the open drawer is inert (measured): no focus is asked for, the attempt waits', t.composerFocusStep(doc) === 'wait' && behind.focusCalls === 0)
  behind.inert = false
  check('...and once the drawer has closed the same field gets the focus', t.composerFocusStep(doc) === 'done' && behind.focusCalls === 1)
  const engineGave = mkInput(); withInput(engineGave, engineGave)
  check('the engine focused the field itself (a new session): nothing is done, the guard keeps that focus', t.composerFocusStep(doc) === 'done' && engineGave.focusCalls === 0)
  const searching = { tagName: 'INPUT' }; const other = mkInput(); withInput(other, searching)
  check('another text field has the focus (the person is typing elsewhere): the composer does not take it', t.composerFocusStep(doc) === 'done' && other.focusCalls === 0)
  const locked = mkInput({ attrs: { contenteditable: 'false' } }); withInput(locked)
  check('a field that is not editable (the engine says « Session unavailable ») is left alone', t.composerFocusStep(doc) === 'wait' && locked.focusCalls === 0)
  const hidden = mkInput({ rect: { width: 0, height: 0 } }); withInput(hidden)
  check('a field that is not drawn (0 x 0) is not focused', t.composerFocusStep(doc) === 'wait' && hidden.focusCalls === 0)
  const refused = mkInput({ refuses: true }); withInput(refused)
  check('a focus the page refuses (nothing takes it) is not taken for a success: the attempt goes on', t.composerFocusStep(doc) === 'wait' && refused.focusCalls === 1)
  withInput(null)
  check('no composer yet (the chat is being made): the attempt waits, nothing throws', t.composerFocusStep(doc) === 'wait' && t.composerFocusStep({ body, get activeElement () { throw new Error('no page') }, querySelector: () => null }) === 'wait')
  // the schedule: the first look after 150 ms, then every 110 ms, at most 10, stopping at the first success; all of it inside the guard's 1.5 s grant
  const run = (becomesReadyAt) => {
    const el = mkInput({ inert: true }); withInput(el)
    const timers = []; let now = 0
    t.giveComposerFocus(doc, (fn, ms) => timers.push({ fn, at: now + ms }))
    let looks = 0; let last = 0
    while (timers.length > 0) { timers.sort((x, y) => x.at - y.at); const nx = timers.shift(); now = nx.at; if (now >= becomesReadyAt) el.inert = false; looks += 1; last = now; nx.fn() }
    return { looks, last, focused: doc.activeElement === el }
  }
  const quick = run(300)
  check('the drawer closes after ~300 ms: the field is focused at the first look after that, and the looking stops', quick.focused && quick.looks <= 3 && quick.last <= 400, quick)
  const never = run(1e9)
  check('the page stays inert (the drawer never closes): the looking stops by itself, ' + never.looks + ' looks, the last at ' + never.last + ' ms, before the guard\'s 1.5 s grant ends', never.focused === false && never.looks === t.COMPOSER_TRIES.max && never.last < 1300, never)
  check('the dock\'s « New chat » asks for it right after its click, and no other button does', /b\.click\(\)\s*\n\s*\} catch \(err\) \{ \/\* no menu: nothing starts \*\/ \}[\s\S]{0,400}giveComposerFocus\(document, /.test(SOURCE) && (SOURCE.match(/giveComposerFocus\(document/g) || []).length === 1)
}

console.log('the drawer opens at its top (round 3, item 2)')
{
  const t = load(makeDom({ collapsed: false })).factory().__test
  const area = (top, overflowY) => ({ scrollTop: top, overflowY })
  const sidebar = (areas) => ({ querySelectorAll: (sel) => (sel === '*' ? areas : []) })
  const win = { getComputedStyle: (e) => ({ overflowY: e.overflowY }) }
  const scrolled = area(386, 'auto'), still = area(0, 'auto'), hidden = area(40, 'hidden'), fixedBox = area(12, 'visible')
  const moved = t.drawerTop(sidebar([scrolled, still, hidden, fixedBox]), win)
  check('a scrolled area of the sidebar goes back to 0, and only that one (hidden or visible overflow is not a scroll area)', moved === 1 && scrolled.scrollTop === 0 && hidden.scrollTop === 40 && fixedBox.scrollTop === 12, { moved })
  check('nothing to move: 0, and a sidebar that is gone never throws', t.drawerTop(sidebar([still]), win) === 0 && t.drawerTop(null, win) === 0)
  check('the scroll areas are found by their scroll, no label is read (the labels are the engine\'s, translated)', /querySelectorAll\('\*'\)[\s\S]{0,260}overflowY/.test(SOURCE.slice(SOURCE.indexOf('const drawerTop'), SOURCE.indexOf('const startDrawerTop'))) && !/Automations|Apps/.test(SOURCE.slice(SOURCE.indexOf('const drawerTop'), SOURCE.indexOf('const startDrawerTop'))))

  // the watcher: a fake observer, fake timers, a fake document
  const run = ({ touchAt } = {}) => {
    let open = false, cb = null
    const timers = []
    const listeners = {}
    const scrolledArea = area(386, 'auto')
    const sb = sidebar([scrolledArea])
    const doc = { body: {}, querySelector: (sel) => (sel === '[data-slot="sidebar"]' ? sb : null), addEventListener: (ev, fn) => { listeners[ev] = fn }, removeEventListener: () => {} }
    const w = { getComputedStyle: win.getComputedStyle, MutationObserver: function (fn) { cb = fn; this.observe = () => {}; this.disconnect = () => {} }, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length }, clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].fn = null } }
    const stop = t.startDrawerTop(doc, w, () => open)
    return { open: () => { open = true; cb([]) }, close: () => { open = false; cb([]) }, timers, listeners, scrolledArea, stop, fire: () => timers.forEach((x) => { if (x.fn) x.fn() }) }
  }
  const a = run()
  check('while the drawer stays closed nothing is scheduled', a.timers.length === 0)
  a.open()
  check('opening it schedules the resets at ' + t.DRAWER_TOP_MS.join(', ') + ' ms (the engine\'s own scroll comes a few frames late)', a.timers.map((x) => x.ms).join(',') === t.DRAWER_TOP_MS.join(','), a.timers.map((x) => x.ms))
  a.fire()
  check('and the list is at the top when they ran', a.scrolledArea.scrollTop === 0)
  const b = run()
  b.open()
  b.listeners.touchstart({ target: { closest: (sel) => (sel === '[data-slot="sidebar"]' ? {} : null) } })
  b.fire()
  check('a touch inside the drawer hands the scroll to the person: nothing moves any more', b.scrolledArea.scrollTop === 386)
  const c = run()
  c.open()
  c.listeners.touchstart({ target: { closest: () => null } })
  c.fire()
  check('a touch outside the drawer (the menu button) does not', c.scrolledArea.scrollTop === 0)
  const d = run()
  d.open()
  d.close()
  d.fire()
  check('closing the drawer before they ran cancels them', d.scrolledArea.scrollTop === 386)
  const e = run()
  e.open(); e.listeners.touchstart({ target: { closest: () => ({}) } }); e.close(); e.scrolledArea.scrollTop = 386; e.open(); e.fire()
  check('each opening starts afresh: a touch of the last time does not keep the next list scrolled', e.scrolledArea.scrollTop === 0)
  check('it is mounted with the page and undone with it', /undo\.push\(startDrawerTop\(document, window, drawerOpen\)\)/.test(SOURCE))
}

process.exit(failed === 0 ? 0 : 1)
