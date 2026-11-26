// kybernos-mobile: browser half.
//
// The look of the phone layout is mobile.css (the host puts it in the page before the first paint). This half is what
// a stylesheet cannot do:
//
//   · a menu button in the corner (on a phone the sidebar is a drawer; its own open button is hidden with it),
//   · a tap on the dimmed chat, or a swipe to the left, closes the drawer,
//   · picking a session or a page in the drawer closes it, so the chat is what you see next,
//   · a page's grid or toolbar that is wider than the screen is marked, and mobile.css makes it fit.
//
// It never keeps a state of its own: the drawer is open when DSH says its sidebar is not collapsed, and it is opened
// and closed by clicking DSH's own toggle (the button with the "<modifiers>+B" shortcut, found by that shortcut and
// not by its label, which is translated). Nothing of the layout runs above 700 px, except on a touch device lying down
// (a phone in landscape is wider than 700 px but at most 500 px high).
//
// The second half of the file is the « Phone and channels » screen (a window the account menu opens, and Settings › Phone and channels): the
// phone LINK on its left, Kaby's messaging apps on its right (kybernos-kyber draws those). See buildRemoteUi.
// It is mounted apart, in its own try/catch, and only when DSH offers the `slots` service: whatever happens there, the
// layout above is already in place.
//
// CONTRACT OF THE RUNNER: the factory must RETURN a plugin object (`apply`). On any failure it returns a disabled one:
// the GUI is preserved.
window.__ModuleLoader__.load({
  id: '@local/kybernos-mobile',
  factory(require) {
    try {
      const MEDIA = '(max-width: 700px), (max-height: 500px) and (pointer: coarse)'
      const SHEET_ID = 'kbmob-sheet'
      const LINK_ID = 'kbmob-sheet-link'
      const MENU_CLASS = 'kbmob-menu'
      // The left sidebar's toggle carries the shortcut "<modifiers>+B" (Alt+Meta+B on a Mac, another pair elsewhere);
      // the right bar's has Shift in it. The label is translated, the shortcut is not. A phone has none (see collapseButton).
      const TOGGLE = 'button[aria-keyshortcuts$="+B"]:not([aria-keyshortcuts*="Shift"])'
      const SIDEBAR_BUTTONS = '[data-slot="sidebar"] button'
      // What a tap on closes the drawer: a session, one of our own sidebar entries, DSH's page list (Plugins, ...) and its
      // global panels (Automation tasks: the buttons of a nav in the sidebar).
      const SESSION_ROW = '[data-row-key^="session:"]'
      const PICKS = SESSION_ROW + ', .kb4-item, .kb4-newchat, [data-slot^="sidebar.panellist"] button, [data-slot="sidebar"] nav > button'
      // A control of the drawer that is not a destination (the template selector of the Business group, the fold of that group) marks itself with this attribute: tapping it
      // must not close the drawer, or the person could never reach what it opens.
      const KEEP_OPEN = '[data-kb-keep-open]'

      // ── language: French is the source, English the pair; French only for a French UI, a translated language is looked up by its
      // French text, and every other language (and a language not known yet) reads English ──
      const lang = () => {
        try { return String(typeof window.__KB_LANG_RESOLVE__ === 'function' ? window.__KB_LANG_RESOLVE__() : (document.documentElement.lang || 'en')) } catch (e) { return 'en' }
      }
      const kt = (fr, en) => {
        const l = lang()
        if (l === 'kybernos' || l.slice(0, 2) === 'fr') return fr
        if (l === 'en') return en
        try {
          const a = window.__KB_I18N_ACTIVE__
          if (a !== null && a !== undefined && a.dict !== null && typeof a.dict === 'object' && typeof a.dict[fr] === 'string') return a.dict[fr]
        } catch (e) { /* no dictionary: English */ }
        return en
      }

      // ── the Kybernos app: its WebView puts `KybernosHost/<version> (ios|android)` in the user agent (kybernos-host/app/App.tsx). Inside it the engine runs ON the phone, so the phone link (a
      // QR code that links a phone to a computer) has no meaning and the app's own page takes its place. Anywhere else this is null and nothing below changes. ──
      const APP_UA = /KybernosHost\/([0-9][0-9A-Za-z.+-]*) \((ios|android)\)/
      const parseAppHost = (ua) => {
        try { const m = APP_UA.exec(String(ua === undefined || ua === null ? '' : ua)); return m === null ? null : { version: m[1], platform: m[2] } } catch (e) { return null }
      }
      const appHost = () => { try { return parseAppHost(window.navigator.userAgent) } catch (e) { return null } }

      const narrow = () => { try { return window.matchMedia(MEDIA).matches === true } catch (e) { return false } }
      const frame = () => { try { return document.querySelector('[data-slot="root"] > div') } catch (e) { return null } }
      /** Open = the frame exists and DSH does not mark its sidebar collapsed. Always false when the screen is not narrow. */
      const drawerOpen = () => {
        if (!narrow()) return false
        const f = frame()
        return f !== null && f !== undefined && !f.hasAttribute('data-sidebar-collapsed')
      }
      /** DSH's sidebar toggle (its open button while the drawer is closed, its collapse button while it is open), found by where
       *  it is: the narrow button at the end of the sidebar's first row. DSH draws no `aria-keyshortcuts` on a phone (measured
       *  on Android, 2026-10-13: none at all), and its label is translated. Of the narrow buttons of the sidebar (at most 56 px
       *  wide: the brand button "New session" that now comes first is 330 px, and clicking it starts a chat), the highest one
       *  (ties: the right-most). The order of the buttons is DSH's to change: only their size is read. */
      const collapseButton = () => {
        try {
          let best = null
          for (const b of Array.prototype.slice.call(document.querySelectorAll(SIDEBAR_BUTTONS))) {
            const r = b.getBoundingClientRect()
            if (r.width < 1 || r.height < 1 || r.width > 56) continue
            if (best === null || r.top < best.top - 1 || (Math.abs(r.top - best.top) <= 1 && r.left > best.left)) best = { el: b, top: r.top, left: r.left }
          }
          return best === null ? null : best.el
        } catch (e) { return null }
      }
      /** DSH's own sidebar toggle: by its shortcut where DSH draws one, else by where it is (see collapseButton), open or closed. */
      const toggle = () => {
        try {
          const byShortcut = document.querySelector(TOGGLE) || document.querySelector('[data-slot="sidebar"] [data-sidebar-toggle]')
          if (byShortcut !== null && byShortcut !== undefined) return byShortcut
          return collapseButton()
        } catch (e) { /* no toggle: the buttons do nothing */ }
        return null
      }
      // set when the person opens the drawer with the menu button: a turn of the screen must not close that one.
      let opened = false
      const flip = () => {
        const b = toggle()
        if (b !== null && b !== undefined) { try { b.click() } catch (e) { /* the toggle went away */ } }
      }
      const closeDrawer = () => { opened = false; if (drawerOpen()) flip() }

      // The drawer opens at its top. The engine scrolls the active chat into view when the drawer opens, and that hid « New chat », Automations and Apps under the header (measured on the owner's
      // phone, rc5u: the scroll area at 82 px, and at 386 px once a chat low in Recents was open). Any scrolled area inside the sidebar is put back to 0 for the first second after the drawer
      // opens (the engine's scroll comes a few frames late), and only until the person touches the drawer: once they scroll, it is theirs. No label is read: the areas are found by their scroll.
      const DRAWER_TOP_MS = Object.freeze([0, 80, 200, 450, 900])
      const drawerTop = (sidebar, win) => {
        let moved = 0
        try {
          for (const e of Array.prototype.slice.call(sidebar.querySelectorAll('*'))) {
            if (!(e.scrollTop > 0)) continue
            const oy = win.getComputedStyle(e).overflowY
            if (oy !== 'auto' && oy !== 'scroll') continue
            e.scrollTop = 0
            moved += 1
          }
        } catch (err) { /* the drawer is gone */ }
        return moved
      }
      const startDrawerTop = (doc, win, isOpen) => {
        let was = isOpen()
        let touched = false
        let timers = []
        const sidebar = () => { try { return doc.querySelector('[data-slot="sidebar"]') } catch (e) { return null } }
        const clear = () => { for (const id of timers) { try { win.clearTimeout(id) } catch (e) { /* gone */ } } timers = [] }
        const reset = () => { if (touched) return; const sb = sidebar(); if (sb !== null && sb !== undefined) drawerTop(sb, win) }
        const onChange = () => {
          const now = isOpen()
          if (now && !was) { touched = false; clear(); timers = DRAWER_TOP_MS.map((ms) => win.setTimeout(reset, ms)) }
          if (!now) clear()
          was = now
        }
        const onUser = (e) => { try { if (e.target !== null && e.target !== undefined && typeof e.target.closest === 'function' && e.target.closest('[data-slot="sidebar"]') !== null) touched = true } catch (err) { /* not an element */ } }
        let watch = null
        try {
          watch = new win.MutationObserver(onChange)
          watch.observe(doc.body, { attributes: true, subtree: true, attributeFilter: ['data-sidebar-collapsed'] })
          doc.addEventListener('touchstart', onUser, { capture: true, passive: true })
          doc.addEventListener('wheel', onUser, { capture: true, passive: true })
        } catch (err) { watch = null }
        return () => {
          clear()
          try { if (watch !== null) watch.disconnect(); doc.removeEventListener('touchstart', onUser, true); doc.removeEventListener('wheel', onUser, true) } catch (err) { /* gone */ }
        }
      }

      // ── what the shell can open: `KybernosCaps/<list>` in the user agent (docs/dev/kaby-mode-shell-contract.md §1b) ──
      const CAPS_RE = /(?:^|\s)KybernosCaps\/([a-z][a-z0-9,-]{0,63})(?=\s|$)/
      // `mode` (2026-11-20): the shell can switch between Simple and Advanced (the `set-mode` message, docs/dev/kaby-mode-shell-contract.md §9); only then does the page draw the line that asks for it.
      const CAPS_KNOWN = Object.freeze(['account', 'plans', 'referral', 'where', 'signout', 'mode'])
      /** The names the shell lists, in the order of CAPS_KNOWN, no duplicates, a name we do not know dropped; `[]` without the app's own token or without a list. */
      const parseCaps = (ua) => {
        try {
          const text = String(ua === undefined || ua === null ? '' : ua)
          if (parseAppHost(text) === null) return []
          const m = CAPS_RE.exec(text)
          if (m === null) return []
          const named = m[1].split(',')
          return CAPS_KNOWN.filter((c) => named.indexOf(c) >= 0)
        } catch (e) { return [] }
      }
      const caps = () => { try { return parseCaps(window.navigator.userAgent) } catch (e) { return [] } }
      /** A message for the shell (`{ kybernos: type, version: 1, ... }`); `false` outside the app's WebView. Never throws. */
      const shellPost = (type, fields) => {
        try {
          if (appHost() === null) return false
          const w = window.ReactNativeWebView
          if (w === undefined || w === null || typeof w.postMessage !== 'function') return false
          w.postMessage(JSON.stringify({ kybernos: type, version: 1, ...fields }))
          return true
        } catch (e) { return false }
      }

      // ── layers (docs/dev/kaby-mode-shell-contract.md §8): what the person dismisses with Back without leaving the screen ──
      const LAYER_MAX = 8
      // The dropdown of a page's floating action (Skills « Create a skill », Agent Teams « Create »): the sheet rules in mobile.css draw it from the bottom, here it is a layer too.
      const DROPDOWN_SEL = '.kb6-headrow .kb8-primary + .kb-menu, .kb6-headrow .kb8-primary + .kb8-newmenu'
      const SHEET_SEL = '[role="menu"], [data-trigger-menu], .kbmob-sheet, ' + DROPDOWN_SEL
      const DIALOG_SEL = '[role="dialog"], [aria-modal="true"]'
      const SETTINGS_SEL = '[data-shortcut-modal="settings"]'
      const SETTINGS_PAGE_ATTR = 'data-kbmob-page' // set on the Settings dialog while it shows one page instead of the list of pages (the arrow of its title strip clears it)
      const SIDEBAR_SEL = '[data-shortcut-modal="sidebar"]'
      const PHONE_MEDIA = '(max-width: 600px)'
      const phone = () => { try { return window.matchMedia(PHONE_MEDIA).matches === true } catch (e) { return false } }
      const shown = (el, win) => {
        try {
          if (typeof el.closest === 'function' && el.closest('[inert]') !== null) return false
          const r = el.getBoundingClientRect()
          return r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < win.innerWidth && r.top < win.innerHeight
        } catch (e) { return false }
      }
      /** The layers open in the page, top first: `[{ kind: 'sheet' | 'dialog' | 'settings' | 'menu' | 'page', el }]`, at most LAYER_MAX. A sheet is an engine menu or popover (or one of ours), a dialog is any other dialog (not the drawer, which is the menu, nor Settings).
   *  A `page` (step 6, contract §8: Reminders, Apps, Skills… = `data-kbmob-view="page"`) is the LOWEST layer: Back leaves it before the app is left. */
      const layerList = (doc, win, menuOpen, pageOpen) => {
        const out = []
        const seen = new Set()
        const add = (kind, el) => { if (!seen.has(el)) { seen.add(el); out.push({ kind, el }) } }
        try { for (const el of Array.prototype.slice.call(doc.querySelectorAll(SHEET_SEL), 0, 12)) { if (shown(el, win)) add('sheet', el) } } catch (e) { /* no query */ }
        try { for (const el of Array.prototype.slice.call(doc.querySelectorAll(DIALOG_SEL), 0, 12)) { if (!el.matches(SIDEBAR_SEL + ', ' + SETTINGS_SEL) && shown(el, win)) add('dialog', el) } } catch (e) { /* no query */ }
        try { const el = doc.querySelector(SETTINGS_SEL); if (el !== null && shown(el, win)) add('settings', el) } catch (e) { /* no query */ }
        if (menuOpen === true) add('menu', doc.documentElement)
        if (pageOpen === true) add('page', doc.body)
        return out.slice(0, LAYER_MAX)
      }
      /**
       * The layers of the page, as the contract says: tells the shell how many are open and which is on top (`layers`), closes the top one on `close-layer` or on the system Back
       * (one history entry per layer: the same address and the router's own state, plus a marker), dims the page behind the engine's sheets and closes a sheet on a swipe down.
       * `hooks`: menuOpen(), closeMenu(), phone() (the sheets are drawn), history() (whether to keep entries), post(type, fields), tick() (called on every change),
       * and, for the page layer, pageOpen() (an in-page screen is in view) and leavePage() (leave it for the screen it was opened from and open the drawer over that one).
       */
      const createLayers = (win, doc, hooks) => {
        let last = ''
        let pushed = 0
        let ignorePop = 0
        let timer = null
        let scrim = null
        let scrimTimer = null
        let drag = null
        const undo = []
        const list = () => layerList(doc, win, hooks.menuOpen(), typeof hooks.pageOpen === 'function' ? hooks.pageOpen() : false)
        const pressEscape = (el) => {
          const target = doc.activeElement !== null && doc.activeElement !== undefined && doc.activeElement !== doc.body ? doc.activeElement : (el || doc.body)
          for (const type of ['keydown', 'keyup']) {
            try { target.dispatchEvent(new win.KeyboardEvent(type, { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true })) } catch (e) { /* no keyboard events */ }
          }
        }
        /** A page's dropdown does not all listen to Escape or to a press outside it (Agent Teams' « Create » closes by its own button only): if it is still there a moment after,
         *  the button before it, the one that opened it, is pressed. */
        const shutDropdown = (el) => {
          try {
            if (typeof el.matches !== 'function' || !el.matches(DROPDOWN_SEL)) return
            win.setTimeout(() => {
              try {
                const opener = el.previousElementSibling
                if (el.isConnected !== false && !el.removed && shown(el, win) && opener !== null && opener !== undefined && typeof opener.click === 'function') { opener.click(); later(60) }
              } catch (e) { /* gone */ }
            }, 90)
          } catch (e) { /* no matches */ }
        }
        /** Closes the top layer; `false` when none is open. The shell's `close-layer` and the system Back end here. A Settings page that shows one of its pages (not the list)
         *  goes back to the list first: Back stepped over it and left Settings altogether (measured on a phone: Settings > Auto Routing > Back landed on the menu). */
        const close = () => {
          const top = list()[0]
          if (top === undefined) return false
          if (top.kind === 'settings' && typeof top.el.hasAttribute === 'function' && top.el.hasAttribute(SETTINGS_PAGE_ATTR)) {
            top.el.removeAttribute(SETTINGS_PAGE_ATTR)
            later(60)
            return true
          }
          // The account menu (the web's footer card) closes by its own card button: an Escape on the page also reaches the engine, which closes the drawer under the sheet with it.
          if (top.kind === 'sheet' && typeof top.el.matches === 'function' && top.el.matches('.kbfp-menu')) {
            try {
              const card = doc.querySelector('[data-kb="workspace-card"] .kbfp-cardmain')
              if (card !== null && card !== undefined && card.getAttribute('aria-expanded') === 'true') { card.click(); later(60); return true }
            } catch (e) { /* no card: the Escape below */ }
          }
          // An in-page screen is left by ONE level: the page goes, and the drawer opens over the screen it was opened from, so the next Back closes the drawer, the next one asks to quit (no loop).
          if (top.kind === 'page') { try { if (typeof hooks.leavePage === 'function') hooks.leavePage() } catch (e) { /* the page stays: the next report says so */ } later(60); later(520); return true }
          if (top.kind === 'menu') hooks.closeMenu(); else pressEscape(top.el)
          if (top.kind === 'sheet') shutDropdown(top.el)
          later(60)
          return true
        }
        const showScrim = (on) => {
          try {
            if (on) {
              if (scrimTimer !== null) { win.clearTimeout(scrimTimer); scrimTimer = null }
              if (scrim !== null) return
              const el = doc.createElement('div')
              el.className = 'kbmob-scrim'
              // the engine closes its menu on the press outside it: this element is outside; the tap itself only has to stay here. A page's dropdown that
              // ignores a press outside (Agent Teams) is closed here: by now a menu that does listen has already gone, so this never opens one again.
              el.addEventListener('click', (e) => {
                try { e.stopPropagation(); e.preventDefault() } catch (err) { /* synthetic */ }
                try { const top = list()[0]; if (top !== undefined && top.kind === 'sheet' && typeof top.el.matches === 'function' && top.el.matches(DROPDOWN_SEL)) close() } catch (err) { /* nothing to close */ }
              })
              doc.body.appendChild(el)
              scrim = el
              win.requestAnimationFrame(() => { if (scrim === el) el.setAttribute('data-on', '') })
            } else if (scrim !== null && scrimTimer === null) {
              const el = scrim
              el.removeAttribute('data-on')
              // kept for a moment: the click that ends a tap lands here and not on what is under it
              scrimTimer = win.setTimeout(() => { scrimTimer = null; el.remove(); if (scrim === el) scrim = null }, 320)
            }
          } catch (e) { /* no scrim: the sheet still works */ }
        }
        // A sheet drawn inside a box that has its own z-index (the composer's) cannot rise over the scrim: while it is open, those boxes lose their z-index (mobile.css).
        // So does a box that is a stacking context for another reason: DSH 0.2.2's composer seat is sticky (made a plain relative box meanwhile) and has `will-change: transform`
        // (cleared meanwhile, which also stops it being the containing block of the fixed sheet), and on 0.2.2-rc.5 the conversation's root is `isolation: isolate` (made `auto` meanwhile):
        // the model picker's sheet sat under the scrim there, dimmed and out of reach of a tap (measured on a phone, 2026-11-20).
        const lifted = new Map()
        const lift = (layers) => {
          try {
            const want = new Map()
            for (const l of layers) {
              if (l.kind !== 'sheet' || l.el.matches('.kbmob-sheet')) continue
              let a = l.el.parentElement
              while (a !== null && a !== undefined && a !== doc.body) {
                if (lifted.has(a)) want.set(a, lifted.get(a)) // a box already lifted reads `auto` (and `relative`): it stays in the set while the sheet is open
                else {
                  const cs = win.getComputedStyle(a)
                  if (cs.position === 'sticky') want.set(a, 'sticky')
                  else if (cs.zIndex !== 'auto' || cs.isolation === 'isolate' || /transform|opacity|filter|perspective/.test(String(cs.willChange))) want.set(a, '')
                }
                a = a.parentElement
              }
            }
            for (const a of Array.from(lifted.keys())) { if (!want.has(a)) { a.removeAttribute('data-kbmob-lift'); lifted.delete(a) } }
            for (const [a, kind] of want) { if (!lifted.has(a)) { a.setAttribute('data-kbmob-lift', kind); lifted.set(a, kind) } }
          } catch (e) { /* the sheet stays under the scrim: the scrim still closes it */ }
        }
        const stateOf = () => { try { const s = win.history.state; return s !== null && typeof s === 'object' ? s : {} } catch (e) { return {} } }
        const syncHistory = (depth) => {
          try {
            if (!hooks.history()) return
            while (pushed < depth) {
              win.history.pushState(Object.assign({}, stateOf(), { kbLayer: pushed + 1 }), '')
              pushed += 1
            }
            if (pushed > depth) {
              // a layer closed by the page: its entry goes too, unless the router has moved on (then the entry stays behind, and is one dead Back press)
              const mine = stateOf().kbLayer === pushed
              const n = pushed - depth
              pushed = depth
              if (mine) { ignorePop += 1; win.history.go(-n) }
            }
          } catch (e) { /* no history: the message is the way */ }
        }
        const report = () => {
          timer = null
          try { hooks.tick() } catch (e) { /* the page's marks failed: the layers are still told */ }
          const layers = list()
          const depth = layers.length
          const top = depth > 0 ? layers[0].kind : ''
          const dim = hooks.phone() && layers.some((l) => l.kind === 'sheet' && !l.el.matches('.kbmob-sheet'))
          showScrim(dim)
          lift(dim ? layers : [])
          syncHistory(depth)
          const key = depth + ':' + top
          if (key === last) return
          last = key
          hooks.post('layers', depth > 0 ? { depth, top } : { depth })
        }
        /** A report soon, once for a burst of changes; and once more after `again` ms, for what leaves with an animation. */
        function later (again) {
          if (timer === null) timer = win.setTimeout(report, 60)
          if (typeof again === 'number') win.setTimeout(() => { if (timer === null) timer = win.setTimeout(report, 0) }, again)
        }
        const onPop = () => {
          if (ignorePop > 0) { ignorePop -= 1; return }
          if (pushed > 0) { pushed -= 1; close() }
        }
        const onTouchStart = (e) => {
          drag = null
          try {
            if (!hooks.phone() || e.touches.length !== 1 || typeof e.target.closest !== 'function') return
            const el = e.target.closest(SHEET_SEL)
            if (el === null || el.scrollTop > 0) return
            drag = { el, y0: e.touches[0].clientY, dy: 0 }
          } catch (err) { drag = null }
        }
        const onTouchMove = (e) => {
          if (drag === null) return
          try {
            const dy = e.touches[0].clientY - drag.y0
            drag.dy = dy > 0 ? dy : 0
            drag.el.style.transition = 'none'
            if (drag.dy > 0) drag.el.style.setProperty('--kbmob-drag', drag.dy + 'px'); else drag.el.style.removeProperty('--kbmob-drag')
          } catch (err) { drag = null }
        }
        const onTouchEnd = () => {
          if (drag === null) return
          const d = drag
          drag = null
          try {
            d.el.style.transition = 'transform .2s'
            if (d.dy > 96) close(); else d.el.style.removeProperty('--kbmob-drag')
            win.setTimeout(() => { try { d.el.style.transition = '' } catch (err) { /* gone */ } }, 240)
          } catch (err) { /* gone */ }
        }
        return {
          close,
          depth: () => list().length,
          report,
          start () {
            try {
              const watch = new win.MutationObserver(() => later())
              watch.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-sidebar-collapsed', 'inert', 'aria-hidden', 'data-state'] })
              undo.push(() => watch.disconnect())
            } catch (e) { /* no observer: the layers are told on resize and on every touch end below */ }
            const on = (target, type, fn, opts) => { try { target.addEventListener(type, fn, opts); undo.push(() => target.removeEventListener(type, fn, opts)) } catch (e) { /* no such event */ } }
            on(win, 'resize', () => later())
            on(win, 'popstate', onPop)
            on(doc, 'touchstart', onTouchStart, { passive: true })
            on(doc, 'touchmove', onTouchMove, { passive: true })
            on(doc, 'touchend', onTouchEnd, { passive: true })
            on(doc, 'touchend', () => later(300), { passive: true })
            report()
          },
          stop () { for (const f of undo.reverse()) { try { f() } catch (e) { /* gone */ } } undo.length = 0; if (timer !== null) win.clearTimeout(timer); showScrim(false); lift([]) }
        }
      }
      let layerCtl = null
      const closeTopLayer = () => { try { return layerCtl !== null && layerCtl.close() === true } catch (e) { return false } }
      /** What the shell says to the full app (the Kaby bridge has its own `receive`): only `close-layer`. */
      /**
       * The messages of the contract that belong to ANOTHER bundle of this page (today: the small model's `local-llm`, bundle kybernos-phone-model) are handed on as a
       * cancelable `kb-app-message` event on the window: the message is understood (`true`) only when a listener claims it with `preventDefault()`. Anything else, or no
       * listener, stays `false`, as before. The list is closed on purpose: a message of another name is never passed on.
       */
      const OTHER_BUNDLES = Object.freeze(['local-llm'])
      const handOn = (win, m) => {
        try {
          if (m === null || typeof m !== 'object' || OTHER_BUNDLES.indexOf(m.kybernos) < 0) return false
          const ev = new win.CustomEvent('kb-app-message', { detail: m, cancelable: true })
          win.dispatchEvent(ev)
          return ev.defaultPrevented === true
        } catch (e) { return false }
      }
      const receiveShell = (raw) => {
        try {
          let m = raw
          if (typeof raw === 'string') { if (raw.length > 8192) return false; m = JSON.parse(raw) }
          if (m !== null && typeof m === 'object' && m.kybernos === 'close-layer') return closeTopLayer()
          return handOn(window, m)
        } catch (e) { return false }
      }

      /** Click handling, as a pure function of the event target: what the page should do with this tap. */
      const decide = (target, frameEl, open) => {
        if (open !== true || target === null || target === undefined) return 'none'
        if (frameEl !== null && frameEl !== undefined && target === frameEl) return 'close' // the mask is the frame's own ::before
        try {
          if (typeof target.closest === 'function' && target.closest('[data-slot="sidebar"]') !== null && target.closest(KEEP_OPEN) === null && target.closest(PICKS) !== null) {
            // A button inside a session's row (its "..." menu, its quick actions) acts in place: only the row itself opens the chat. Closing the drawer on it
            // took the menu away with it (measured on a phone: no way to pin, rename or delete a chat from the drawer).
            const inner = target.closest('button')
            const row = target.closest(SESSION_ROW)
            if (inner !== null && row !== null && typeof row.contains === 'function' && row.contains(inner)) return 'none'
            return 'close-after'
          }
        } catch (e) { /* not an element */ }
        return 'none'
      }

      const menuIcon = () => {
        const NS = 'http://www.w3.org/2000/svg'
        const svg = document.createElementNS(NS, 'svg')
        svg.setAttribute('viewBox', '0 0 24 24')
        svg.setAttribute('width', '20')
        svg.setAttribute('height', '20')
        svg.setAttribute('fill', 'none')
        svg.setAttribute('stroke', 'currentColor')
        svg.setAttribute('stroke-width', '2')
        svg.setAttribute('stroke-linecap', 'round')
        svg.setAttribute('aria-hidden', 'true')
        for (const y of [6, 12, 18]) {
          const l = document.createElementNS(NS, 'line')
          l.setAttribute('x1', '4'); l.setAttribute('x2', '20'); l.setAttribute('y1', String(y)); l.setAttribute('y2', String(y))
          svg.appendChild(l)
        }
        svg.setAttribute('class', 'kbmob-menu-ico')
        return svg
      }
      /** The arrow of a page's corner button (it opens the menu the page was reached from). */
      const backIcon = () => {
        const NS = 'http://www.w3.org/2000/svg'
        const svg = document.createElementNS(NS, 'svg')
        svg.setAttribute('viewBox', '0 0 24 24')
        svg.setAttribute('width', '22')
        svg.setAttribute('height', '22')
        svg.setAttribute('fill', 'none')
        svg.setAttribute('stroke', 'currentColor')
        svg.setAttribute('stroke-width', '2.2')
        svg.setAttribute('stroke-linecap', 'round')
        svg.setAttribute('stroke-linejoin', 'round')
        svg.setAttribute('aria-hidden', 'true')
        svg.setAttribute('class', 'kbmob-back-ico')
        const path = document.createElementNS(NS, 'path')
        path.setAttribute('d', 'M15 5l-7 7 7 7')
        svg.appendChild(path)
        return svg
      }

      // ── the "..." sheet: the header actions a phone has no room for ───────────────────────────────────────────────
      // mobile.css PARKS them (fixed, invisible, 1 px, still rendered: DSH's popovers keep an anchor). The phone's
      // "More actions" button opens this sheet instead of DSH's menu; its last row hands over to DSH's own menu.
      const ACTION_BUTTONS = '[data-slot="conversation.session.header.actions"] button, [data-slot="conversation.session.header.utilities"] button, [data-slot="conversation.session.header.corner"] button, [data-composer-card] button, [data-kb="computer-env-button"], [role="tablist"][data-conversation-tabs] button'
      const MORE_BUTTON = '[data-slot="conversation.session.header.utilities"] button'
      /** Parked by mobile.css: the element or one of its four nearest ancestors is fixed and invisible. */
      const isParked = (el, styleOf) => {
        let e = el
        for (let i = 0; i < 5 && e !== null && e !== undefined; i += 1) {
          let st = null
          try { st = styleOf(e) } catch (err) { st = null }
          if (st !== null && st !== undefined && st.position === 'fixed' && String(st.opacity) === '0') return true
          e = e.parentElement
        }
        return false
      }
      /** The parked actions of the page, by label (DSH's own, so they are in the language of the page), no duplicates. */
      const parkedActions = (root, styleOf) => {
        const out = []
        const seen = []
        let list = []
        try { list = Array.prototype.slice.call(root.querySelectorAll(ACTION_BUTTONS)) } catch (err) { list = [] }
        for (const el of list) {
          try {
            if (typeof el.closest === 'function' && el.closest('[data-open-target]') !== null) continue
            // a button that is only the opener of a menu whose entries are listed on their own (the chat tools « + », the call arrow) is not an action
            if (typeof el.closest === 'function' && el.closest('[data-kb-sheet="skip"]') !== null) continue
            if (!isParked(el, styleOf)) continue
            // the view that is shown is not an action (the other views are)
            if (el.getAttribute('aria-selected') === 'true') continue
            const long = String(el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim()
            // "Commands: browse, run, edit or create slash commands and actions": the name is what comes before the colon
            const label = long.length > 24 && long.indexOf(':') > 1 ? long.slice(0, long.indexOf(':')).trim() : long
            if (label === '' || seen.indexOf(label) >= 0) continue
            seen.push(label)
            out.push({ label, el })
          } catch (err) { /* an element that went away */ }
        }
        return out
      }

      /** A swipe to the left (from a finger down at `from` to a finger up at `to`) is a request to close the drawer. */
      const swipeCloses = (from, to) => {
        if (from === null || from === undefined || to === null || to === undefined) return false
        const dx = to.x - from.x
        const dy = to.y - from.y
        return dx <= -56 && Math.abs(dy) < Math.abs(dx) * 0.6
      }

      /** What a page's element needs to fit a phone, from what it does now, as a list of kinds:
       *   'grid'   a card grid whose columns are wider than its box gets columns that fit;
       *   'wrap'   a toolbar that does not wrap and is wider than its box, or squeezes one of its items below what that
       *            item needs (a search field of 4 px, a button whose label runs under the next one), wraps;
       *   'scroll' a strip of tabs or a segmented control wider than its box slides sideways;
       *   'keep'   an item of a row that was squeezed below its content (min-width: 0) keeps its content's width, so the
       *            row has to wrap;
       *   'stack'  a row whose first item is the text that takes what is left (flex: 1 1 0%) and the rest are its
       *            controls (a setting: label and select): the controls go under the text when the text would be left
       *            with less than 180 px.
       *  A scroller or a clipped box is that on purpose (a code block): left alone, unless it clips cards. */
      const fitKinds = (el, styleOf) => {
        const out = []
        try {
          const st = styleOf(el)
          if (el.clientWidth < 1) return out
          if (st.overflowX === 'hidden' || st.overflowX === 'clip') {
            // A strip of cards that hides what does not fit and cannot be scrolled: the cards beyond the edge are out of
            // reach. They wrap (a row of text that is cut with an ellipsis has no cards in it: left alone).
            if ((st.display === 'flex' || st.display === 'inline-flex') && st.flexDirection === 'row' && st.flexWrap === 'nowrap') {
              const box = el.getBoundingClientRect()
              for (const kid of Array.prototype.slice.call(el.children, 0, 40)) {
                const r = kid.getBoundingClientRect()
                const isCard = typeof kid.querySelector === 'function' && (kid.tagName === 'BUTTON' || kid.querySelector('button, a, [role="button"]') !== null)
                if (r.width >= 120 && isCard && r.right > box.right + 2) { out.push('wrap'); break }
              }
            }
            return out
          }
          if (st.overflowX !== 'visible') return out
          const wide = el.scrollWidth > el.clientWidth + 1
          if (typeof el.getAttribute === 'function' && /^(tablist|radiogroup)$/.test(String(el.getAttribute('role') || ''))) {
            if (wide) out.push('scroll')
            return out
          }
          if (st.display === 'grid' || st.display === 'inline-grid') {
            if (wide) out.push('grid')
            return out
          }
          if ((st.display === 'flex' || st.display === 'inline-flex') && st.flexDirection === 'row' && st.flexWrap === 'nowrap') {
            let squeezed = wide
            if (!squeezed) {
              // Pushed out on the left (justify-content: flex-end) leaves no scrollWidth to show for it, and a squeezed item
              // keeps its text but not its box: both are read from the items.
              const box = el.getBoundingClientRect()
              const kids = Array.prototype.slice.call(el.children, 0, 40)
              for (const kid of kids) {
                const r = kid.getBoundingClientRect()
                if (r.width < 1) continue
                if (r.left < box.left - 1 || r.right > box.right + 1) { squeezed = true; break }
                if (kid.scrollWidth > kid.clientWidth + 1 && styleOf(kid).overflowX === 'visible') { squeezed = true; break }
                if (r.width < 120 && typeof kid.querySelector === 'function' && kid.querySelector('input') !== null) { squeezed = true; break }
              }
            }
            if (squeezed) out.push('wrap')
            const first = el.children.length >= 2 ? el.children[0] : null
            if (first !== null && first !== undefined) {
              const fs = styleOf(first)
              if (parseFloat(fs.flexGrow) >= 1 && /^0(px|%)?$/.test(String(fs.flexBasis))) out.push('stack')
            }
          }
          // an item of a flex row that was squeezed below its content: its content runs out of its box
          const up = el.parentElement
          if (wide && up !== null && up !== undefined && st.minWidth === '0px' && st.flexShrink !== '0') {
            const ps = styleOf(up)
            if ((ps.display === 'flex' || ps.display === 'inline-flex') && /^row/.test(String(ps.flexDirection))) out.push('keep')
          }
        } catch (err) { /* an element that went away */ }
        return out
      }
      /** The element to move down so that a page's title does not start under the menu button (fixed in the top-left
       *  corner, 44 px high): the title and the ancestors that start at the same height, the outermost of them. `null` when
       *  the title is already clear of the button or there is none. */
      const leadTarget = (title, clearTop) => {
        try {
          if (title === null || title === undefined) return null
          const top = title.getBoundingClientRect().top
          if (top >= clearTop) return null
          let el = title
          for (let i = 0; i < 6; i += 1) {
            const up = el.parentElement
            if (up === null || up === undefined) break
            if (typeof up.matches === 'function' && up.matches('[data-slot="main"], body')) break
            if (Math.abs(up.getBoundingClientRect().top - top) > 2) break
            el = up
          }
          return el
        } catch (err) { return null }
      }
      const LEAD_ATTR = 'data-kbmob-lead'
      /** The title of the page in view: its h1, else (Skills draws a div) the largest text of the first 110 px. */
      const pageTitle = () => {
        try {
          const h = document.querySelector('[data-slot="main"] h1')
          if (h !== null && h !== undefined) return h
          let best = null
          let size = 0
          for (const e of Array.prototype.slice.call(document.querySelectorAll('[data-slot="main"] *'), 0, 600)) {
            if (e.children.length > 0) continue
            const r = e.getBoundingClientRect()
            if (r.width < 1 || r.top > 110 || r.bottom < 0 || String(e.textContent || '').trim() === '') continue
            const fs = parseFloat(getComputedStyle(e).fontSize)
            if (fs >= 22 && fs > size) { best = e; size = fs }
          }
          return best
        } catch (err) { return null }
      }
      const FIT_ATTR = 'data-kbmob-fit'
      const BOXES = ':is(div, nav, ul, ol, section, header, form, fieldset)'
      const PAGE_BOXES = '[data-slot="main"] ' + BOXES
      const SETTINGS_BOXES = '[data-shortcut-modal="settings"] ' + BOXES

      const mount = () => {
        const undo = []
        // The display mode (Auto, Simple, Complete): the seam `window.__KB_MODE__` and the sheet, wherever this bundle runs (the sheet's rules arrive in the head). Its own try/catch: it never costs the layout.
        undo.push(mountMode())
        // The stylesheet normally arrives with the page (index-inject). When it did not, link it.
        if (document.getElementById(SHEET_ID) === null && document.getElementById(LINK_ID) === null) {
          const link = document.createElement('link')
          link.id = LINK_ID
          link.rel = 'stylesheet'
          try { link.href = new URL('kybernos-mobile/mobile.css', document.baseURI).pathname } catch (e) { link.href = '/kybernos-mobile/mobile.css' }
          document.head.appendChild(link)
          undo.push(() => link.remove())
        }
        const button = document.createElement('button')
        button.type = 'button'
        button.className = MENU_CLASS
        button.setAttribute('data-kb', 'mobile-menu')
        // The label follows the language: it is written now, again when the language changes, and again when the button is
        // reached (the language is often not known yet at the first paint, and a label written once stayed in the wrong one).
        const relabel = () => {
          let page = false
          try { page = document.documentElement.getAttribute('data-kbmob-view') === 'page' } catch (e) { page = false }
          try { button.setAttribute('aria-label', page ? kt('Retour au menu', 'Back to the menu') : kt('Ouvrir le menu', 'Open the menu')) } catch (e) { /* the button went away */ }
        }
        relabel()
        for (const ev of ['focus', 'pointerenter', 'touchstart']) button.addEventListener(ev, relabel, { passive: true })
        try { window.addEventListener('kybernos-lang-change', relabel); undo.push(() => window.removeEventListener('kybernos-lang-change', relabel)) } catch (e) { /* no window */ }
        button.appendChild(menuIcon())
        button.appendChild(backIcon())
        button.addEventListener('click', (e) => { e.stopPropagation(); opened = !drawerOpen(); flip() })
        document.body.appendChild(button)
        undo.push(() => button.remove())

        const onClick = (e) => {
          const act = decide(e.target, frame(), drawerOpen())
          if (act === 'close') { e.stopPropagation(); flip() } else if (act === 'close-after') setTimeout(closeDrawer, 120)
        }
        document.addEventListener('click', onClick, true)
        undo.push(() => document.removeEventListener('click', onClick, true))

        // The "..." sheet: a tap on the header's "More actions" lists what the phone parked, then DSH's own menu.
        let sheet = null
        let bypass = false
        const closeSheet = () => {
          if (sheet === null) return
          try { sheet.mask.remove(); sheet.panel.remove() } catch (err) { /* gone */ }
          try { document.removeEventListener('keydown', sheet.onKey, true) } catch (err) { /* gone */ }
          try { document.removeEventListener('focusin', sheet.onFocus, true) } catch (err) { /* gone */ }
          sheet = null
        }
        /** The on-screen keyboard rises when a text field has the focus, and covers a sheet of ours (and the first Back press only lowers it): while a sheet of ours is open the text fields let go of the focus. */
        const isTyping = (el) => {
          try { if (el === null || el === undefined || el === document.body) return false
            if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable === true) return true
            // The composer is a contenteditable div; `isContentEditable` can read false on it, so its own marks count as well.
            return typeof el.getAttribute === 'function' && (el.getAttribute('contenteditable') === 'true' || el.getAttribute('role') === 'textbox')
          } catch (err) { return false }
        }
        const dropKeyboard = () => {
          try { const a = document.activeElement; if (isTyping(a) && typeof a.blur === 'function') a.blur() } catch (err) { /* nothing focused */ }
        }
        // The composer's « + » (the one button of the card that opens a list box: its label is in the page's language and 0.2.1 draws every icon the same, so
        // neither is a way to find it). The engine's « + » gives the composer the focus and opens the command menu FROM that focus: a composer made to let go of it
        // closed the menu at once (phone test, 2026-11-08: « + » in a chat did nothing).
        const PLUS_BUTTON = '[data-composer-card] button[aria-haspopup="listbox"]'
        const HOME_MODE_SLOT = '[data-slot="conversation.hero.agentPreset"]'   // only the home has it
        // Kaby's blank conversation is not the home for this: its hero parts are in the page but hidden, the sheet below (the folder, the mode, the access shield) has nothing to list there, and the engine's
        // own « + » (a list with « File » only, `kaby-mode.mjs`) must open from the focus like a chat's: counted as the home, its tap let the field go and closed the list at once.
        const inKaby = () => { try { const root = document.documentElement; return root !== null && root !== undefined && root.classList !== undefined && root.classList.contains('kb-kaby') } catch (err) { return false } }
        const onHome = () => { try { return !inKaby() && document.querySelector(HOME_MODE_SLOT) !== null } catch (err) { return false } }
        const isPlus = (el) => { try { return el !== null && el !== undefined && typeof el.closest === 'function' && el.closest(PLUS_BUTTON) !== null } catch (err) { return false } }
        // The composer does not take the focus by itself on a touch screen: the engine focuses it when Home or a new chat opens, and the on-screen
        // keyboard rises at once (and the caret stays there after Back lowers it). It keeps the focus when the person tapped the field (not a button of the card: sending does not call the keyboard back),
        // or its « + » (the command menu is anchored to the field), a tap or the sheet's « Files and commands » that clicks it.
        {
          let tap = { at: 0, el: null }
          let plusAt = 0
          // « New chat » (the dock's button): the person asked to write, so the field it opens keeps the focus and the keyboard rises, like the « + » of a chat. Only that button: opening a chat from Recents, or
          // any other tap that ends on the composer, does not. `granted` says the focus is the one this tap gave, so that the keyboard lowered by Back (the first press only lowers it) does not leave
          // the caret blinking in a field with no keyboard (the 7 Nov defect): the field then lets go of the focus (see `sync` below). A tap inside the field is the person's own focus: it clears it.
          // A control that says `data-kb-keyboard` asks the same: the cards of the empty chat (the Kybernos plugin's slider and its sheet) and their chip, suggestions and cross put a sentence in the field
          // and give it the focus, so the keyboard rises (or stays up) at the tap. Only a control that carries the mark, never any other tap.
          let newAt = 0
          let granted = false
          const isNewChat = (el) => { try { return el !== null && el !== undefined && typeof el.closest === 'function' && el.closest('.kbmob-newchat, [data-kb-keyboard]') !== null } catch (err) { return false } }
          // On the home a tap on « + » opens the sheet of ours, which wants no keyboard: only a chat's « + » (and the sheet's own click on it) keeps the focus.
          const onDown = (e) => { tap = { at: Date.now(), el: e.target }; plusAt = isPlus(e.target) && !onHome() ? tap.at : 0; newAt = isNewChat(e.target) ? tap.at : 0; granted = false }
          const onPlusClick = (e) => { if (isPlus(e.target) && (bypass || !onHome())) plusAt = Date.now() }
          /** The composer, when `el` is it, on a phone with a touch screen, and nobody tapped the field (or the card's bare part) a moment ago: it lets go of the focus. */
          const letGo = (el) => {
            try {
              if (!phone() || !isTyping(el) || typeof el.closest !== 'function') return
              if (window.matchMedia('(pointer: coarse)').matches !== true) return
              const card = el.closest('[data-composer-card]')
              if (card === null) return
              if (Date.now() - plusAt < 1500) return
              if (newAt > 0 && Date.now() - newAt < 1500) { granted = true; return }
              // Only a tap on the field itself (or the card's bare part) keeps the focus: the Send button's tap does not call the keyboard back.
              const onButton = tap.el !== null && typeof tap.el.closest === 'function' && tap.el.closest('button, [role="button"], a') !== null
              const mine = tap.el !== null && !onButton && Date.now() - tap.at < 1500 && typeof card.contains === 'function' && card.contains(tap.el)
              if (!mine && typeof el.blur === 'function') el.blur()
            } catch (err) { /* nothing to decide */ }
          }
          const onFocusIn = (e) => letGo(e.target)
          document.addEventListener('pointerdown', onDown, true)
          document.addEventListener('click', onPlusClick, true)
          document.addEventListener('focusin', onFocusIn, true)
          undo.push(() => {
            document.removeEventListener('pointerdown', onDown, true)
            document.removeEventListener('click', onPlusClick, true)
            document.removeEventListener('focusin', onFocusIn, true)
          })
          // The keyboard and the engine's bottom sheets (the « + » list): the part of the page the keyboard covers and the height left above it, from the visual viewport (mobile.css lifts the sheet by the
          // first and caps it by the second). On a web view that is resized by the keyboard the page's height shrinks with the visual viewport: the covered part is 0.
          try {
            const vv = window.visualViewport
            if (vv !== undefined && vv !== null && typeof vv.addEventListener === 'function') {
              const root = document.documentElement
              let fullH = 0
              let fullW = 0
              let kbdUp = false
              const sync = () => {
                try {
                  const covered = phone() ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0
                  // the keyboard that « New chat » raised goes down (Back, or the key that hides it) while the field it gave the focus to still has it: the field lets go, no caret left in a field with no keyboard
                  if (Math.round(vv.width) !== fullW) { fullW = Math.round(vv.width); fullH = 0 }   // a turn of the screen is not a keyboard
                  fullH = Math.max(fullH, Math.round(vv.height))
                  const up = covered > 120 || fullH - Math.round(vv.height) > 120
                  if (kbdUp && !up && granted) { granted = false; dropKeyboard() }
                  kbdUp = up
                  root.style.setProperty('--kbmob-kbd', covered + 'px')
                  root.style.setProperty('--kbmob-vvh', phone() ? Math.round(vv.height) + 'px' : '100dvh')
                } catch (err) { /* no measure: the sheet stays where the engine put it */ }
              }
              vv.addEventListener('resize', sync)
              vv.addEventListener('scroll', sync)
              sync()
              undo.push(() => { try { vv.removeEventListener('resize', sync); vv.removeEventListener('scroll', sync); root.style.removeProperty('--kbmob-kbd'); root.style.removeProperty('--kbmob-vvh') } catch (err) { /* gone */ } })
            }
          } catch (err) { /* no visual viewport */ }
          // The engine can have focused the composer before this plugin started (the app opens on Home): that focus raised no event for the guard.
          letGo(document.activeElement)
          const again = [800, 2500].map((ms) => setTimeout(() => letGo(document.activeElement), ms))   // a layout that is not a phone's yet at the first look
          undo.push(() => again.forEach((id) => clearTimeout(id)))
        }
        const row = (label, icon, run, value) => {
          const b = document.createElement('button')
          b.type = 'button'
          b.className = 'kbmob-sheet-row'
          if (icon !== null && icon !== undefined) b.appendChild(icon)
          else { const none = document.createElement('span'); none.className = 'kbmob-sheet-noico'; try { if (none.style) none.style.cssText = 'flex:none;width:22px;height:22px' } catch (err) { /* no style */ } b.appendChild(none) }
          const t = document.createElement('span')
          t.textContent = label
          b.appendChild(t)
          if (typeof value === 'string' && value !== '') {
            const v = document.createElement('span')
            v.className = 'kbmob-sheet-val'
            v.textContent = value
            b.appendChild(v)
          }
          b.addEventListener('click', (e) => { try { e.stopPropagation() } catch (err) { /* synthetic */ } closeSheet(); setTimeout(run, 60) })
          return b
        }
        /** A bottom sheet of rows: `entries` are `{ label, icon, run, value }` or `{ sep: true }`; `tag` is a small word after the title. */
        const openRows = (titleText, entries, tag) => {
          closeSheet()
          const mask = document.createElement('button')
          mask.type = 'button'
          mask.className = 'kbmob-sheet-mask'
          mask.setAttribute('aria-label', kt('Fermer', 'Close'))
          mask.addEventListener('click', (e) => { try { e.stopPropagation() } catch (err) { /* synthetic */ } closeSheet() })
          const panel = document.createElement('div')
          panel.className = 'kbmob-sheet'
          panel.setAttribute('role', 'menu')
          const title = document.createElement('div')
          title.className = 'kbmob-sheet-title'
          title.textContent = titleText
          if (typeof tag === 'string' && tag !== '') {
            const t = document.createElement('span')
            t.className = 'kbmob-sheet-tag'
            t.textContent = tag
            title.appendChild(t)
          }
          panel.appendChild(title)
          for (const en of entries) {
            if (en.sep === true) {
              const sep = document.createElement('div')
              sep.className = 'kbmob-sheet-sep'
              panel.appendChild(sep)
            } else panel.appendChild(row(en.label, en.icon, en.run, en.value))
          }
          const onKey = (e) => { if (e && e.key === 'Escape') closeSheet() }
          // the engine hands the focus back to the composer after the tap that opened the sheet: it is taken away again, whenever it happens
          const onFocus = () => dropKeyboard()
          document.addEventListener('keydown', onKey, true)
          document.addEventListener('focusin', onFocus, true)
          document.body.appendChild(mask)
          document.body.appendChild(panel)
          sheet = { mask, panel, onKey, onFocus }
          dropKeyboard()
        }
        const iconOf = (el) => { try { const svg = el.querySelector('svg'); return svg !== null && svg !== undefined ? svg.cloneNode(true) : null } catch (err) { return null } }
        const openSheet = (items, more) => {
          const entries = items.map((it) => ({ label: it.label, icon: iconOf(it.el), run: () => { try { it.el.click() } catch (err) { /* the action went away */ } } }))
          entries.push({ sep: true })
          entries.push({
            label: kt('Autres actions', 'More actions'),
            icon: null,
            run: () => {
              bypass = true
              try { more.click() } catch (err) { /* the button went away */ } finally { bypass = false }
            }
          })
          openRows(kt('Cette session', 'This session'), entries)
        }
        // The home's "+": what the home parked (the folder, the mode, the access shield and the BETA tag) is here, then the engine's own "+" menu. The chips stay in the page, parked: the engine's menus anchor to them.
        const homeChips = () => {
          try {
            const slot = document.querySelector(HOME_MODE_SLOT)
            if (slot === null) return null
            const mode = slot.querySelector('button')
            const rowEl = slot.parentElement
            let folder = null
            if (rowEl !== null) for (const b of Array.prototype.slice.call(rowEl.querySelectorAll('button'))) { if (!slot.contains(b)) { folder = b; break } }
            // the access chip: the composer button with a chevron that is not the model's (its shield has no icon name, its label is in the page's language)
            let access = null
            for (const b of Array.prototype.slice.call(document.querySelectorAll('[data-composer-card] button'))) {
              if (b.getAttribute('data-kb') !== 'model-seat' && b.querySelector('svg[data-icon*="chevron-down"]') !== null) { access = b; break }
            }
            return { mode, folder, access }
          } catch (err) { return null }
        }
        const chipText = (b) => { try { return String(b.textContent || '').replace(/\s+/g, ' ').trim() } catch (err) { return '' } }
        const openPlus = (plusButton) => {
          const chips = homeChips()
          if (chips === null) return false
          const entries = []
          const add = (label, el, value) => { if (el !== null && el !== undefined) entries.push({ label, icon: iconOf(el), value, run: () => { try { el.click() } catch (err) { /* the chip went away */ } } }) }
          add(kt('Dossier', 'Folder'), chips.folder, chipText(chips.folder))
          add(kt('Mode', 'Mode'), chips.mode, chipText(chips.mode))
          // the shield says "<label>, current: <value>" in the page's language: the part after the colon is the value
          let access = ''
          try { const a = String(chips.access !== null ? (chips.access.getAttribute('aria-label') || '') : ''); const k = a.lastIndexOf(':'); access = k >= 0 ? a.slice(k + 1).trim() : '' } catch (err) { access = '' }
          add(kt('Accès', 'Access'), chips.access, access)
          entries.push({ sep: true })
          entries.push({
            label: kt('Fichiers et commandes', 'Files and commands'),
            icon: iconOf(plusButton),
            run: () => {
              bypass = true
              try { plusButton.click() } catch (err) { /* the button went away */ } finally { bypass = false }
            }
          })
          let beta = ''
          try { const b = document.querySelector('[data-kb-beta]'); beta = b !== null ? chipText(b) : '' } catch (err) { beta = '' }
          openRows(kt('Nouvelle conversation', 'New chat'), entries, beta)
          return true
        }
        const onPlus = (e) => {
          try {
            if (bypass || !phone()) return
            const t = e.target
            if (t === null || t === undefined || typeof t.closest !== 'function') return
            const btn = t.closest(PLUS_BUTTON)
            if (btn === null || !onHome()) return
            e.preventDefault()
            e.stopPropagation()
            openPlus(btn)
          } catch (err) { /* the engine's own "+" opens then */ }
        }
        document.addEventListener('click', onPlus, true)
        undo.push(() => document.removeEventListener('click', onPlus, true))
        const onMore = (e) => {
          try {
            if (bypass || !narrow()) return
            const t = e.target
            if (t === null || t === undefined || typeof t.closest !== 'function') return
            const hit = t.closest(MORE_BUTTON)
            if (hit === null || hit.closest('[data-open-target]') !== null) return
            const items = parkedActions(document, (x) => window.getComputedStyle(x))
            if (items.length === 0) return
            e.preventDefault()
            e.stopPropagation()
            openSheet(items, hit)
          } catch (err) { /* DSH's own menu opens then */ }
        }
        document.addEventListener('click', onMore, true)
        undo.push(() => { document.removeEventListener('click', onMore, true); closeSheet() })

        /** The bar over a Settings page is drawn by a pseudo-element (mobile.css), which is no control: no focus, no name for a screen reader. A real button lies over it (transparent: the bar stays
         *  as drawn), named « Back to Settings » and doing what a tap on the bar does. Made once per page box, kept (mobile.css hides it while the list shows). */
        const backButton = (modal, bar) => {
          try {
            if (typeof bar.querySelector !== 'function' || typeof bar.appendChild !== 'function') return
            let b = bar.querySelector('[data-kbmob-backbtn]')
            if (b === null || b === undefined) {
              b = document.createElement('button')
              b.type = 'button'
              b.setAttribute('data-kbmob-backbtn', '')
              b.addEventListener('click', (e) => { try { e.stopPropagation() } catch (err) { /* synthetic */ } modal.removeAttribute(SETTINGS_PAGE_ATTR) })
              if (typeof bar.insertBefore === 'function' && bar.firstChild !== null && bar.firstChild !== undefined) bar.insertBefore(b, bar.firstChild)
              else bar.appendChild(b)
            }
            b.setAttribute('aria-label', kt('Retour aux Réglages', 'Back to Settings'))
          } catch (err) { /* the bar still works as a tap */ }
        }
        // Settings on a phone: a list of pages, then the page. A pick sets data-kbmob-page (mobile.css hides the list and
        // shows the page under a "back" bar, a pseudo-element of the page); a tap on that bar clears it.
        const onSettings = (e) => {
          try {
            if (!narrow()) return
            const t = e.target
            if (t === null || t === undefined || typeof t.closest !== 'function') return
            const modal = t.closest('[data-shortcut-modal="settings"]')
            if (modal === null) return
            // The box that carries the "back" bar: the title strip when DSH draws the panel flat (0.2.2: strip, nav, header, page), the page next to the nav before.
            const first = modal.children !== undefined ? modal.children[0] : null
            const flat = first !== undefined && first !== null && first.tagName === 'DIV'
            const page = flat ? first : (modal.children !== undefined ? modal.children[1] : null)
            if (!modal.hasAttribute(SETTINGS_PAGE_ATTR)) {
              const btn = t.closest('nav > div:last-child > button')
              if (btn !== null && page !== null && page !== undefined) {
                setTimeout(() => {
                  try { modal.setAttribute(SETTINGS_PAGE_ATTR, '1'); page.setAttribute('data-kbmob-back', kt('Réglages', 'Settings')); backButton(modal, page) } catch (err) { /* gone */ }
                }, 0)
              }
            } else if (page !== null && page !== undefined && t === page) {
              const r = page.getBoundingClientRect()
              if (e.clientY - r.top < 64) { e.stopPropagation(); modal.removeAttribute(SETTINGS_PAGE_ATTR) }
            }
          } catch (err) { /* DSH's own settings then */ }
        }
        document.addEventListener('click', onSettings, true)
        undo.push(() => document.removeEventListener('click', onSettings, true))

        // A swipe to the left on the open drawer, or on the dimmed chat beside it, closes it (as a tap there does).
        let from = null
        const onTouchStart = (e) => {
          try {
            const t = e.touches !== undefined && e.touches.length === 1 ? e.touches[0] : null
            from = t !== null && drawerOpen() ? { x: t.clientX, y: t.clientY } : null
          } catch (err) { from = null }
        }
        const onTouchEnd = (e) => {
          try {
            const start = from
            from = null
            const t = e.changedTouches !== undefined ? e.changedTouches[0] : null
            if (start === null || t === null || t === undefined || !drawerOpen()) return
            if (swipeCloses(start, { x: t.clientX, y: t.clientY })) closeDrawer()
          } catch (err) { /* no touch data */ }
        }
        try {
          document.addEventListener('touchstart', onTouchStart, { passive: true })
          document.addEventListener('touchend', onTouchEnd, { passive: true })
          undo.push(() => { try { document.removeEventListener('touchstart', onTouchStart); document.removeEventListener('touchend', onTouchEnd) } catch (err) { /* gone */ } })
        } catch (err) { /* no touch events */ }

        // The pages' own grids and toolbars are sized for a desktop (a card column of 330 px in a 304 px page, a row of
        // 592 px): the ones that do not fit are marked, mobile.css gives the mark its rule. A mark stays (a fitted box no
        // longer overflows, it would flip back at once) and only acts inside the phone media query. A conversation is left to
        // DSH. The scan follows the page's own changes, a few hundred ms after the last one.
        let fitTimer = null
        let fitLater = null
        let fitSince = 0
        const fit = () => {
          try {
            if (!narrow()) return
            // The chat's title is cut when the header is narrow (A5-17): its whole name is one long press away, as a tooltip.
            const name = document.querySelector('[data-slot="conversation.session.header"] nav[aria-label]')
            if (name !== null && name !== undefined) {
              const full = String(name.textContent || '').replace(/\s+/g, ' ').trim()
              if (full !== '' && name.getAttribute('title') !== full) name.setAttribute('title', full)
            }
            // a conversation is DSH's own; a page, and the Settings window over anything, are measured
            const chat = document.querySelector('[data-composer-card]') !== null
            const boxes = Array.prototype.slice.call(document.querySelectorAll(chat ? SETTINGS_BOXES : PAGE_BOXES + ', ' + SETTINGS_BOXES), 0, 4000)
            for (const el of boxes) {
              if (el.hasAttribute(FIT_ATTR)) continue
              const kinds = fitKinds(el, (x) => getComputedStyle(x))
              if (kinds.length > 0) el.setAttribute(FIT_ATTR, kinds.join(' '))
            }
            // a page's title starts under the menu button: the title row is moved down (the mark stays, the page is the same)
            if (!chat) {
              const lead = leadTarget(pageTitle(), 60)
              if (lead !== null && !lead.hasAttribute(LEAD_ATTR)) lead.setAttribute(LEAD_ATTR, '1')
            }
          } catch (err) { /* DSH's own layout then */ }
        }
        // 350 ms after the last change, at the latest 1.5 s after the first; then once more, for what a page draws late.
        const askFit = () => {
          const now = Date.now()
          if (fitTimer === null) fitSince = now
          else clearTimeout(fitTimer)
          fitTimer = setTimeout(() => {
            fitTimer = null
            fit()
            if (fitLater === null) fitLater = setTimeout(() => { fitLater = null; fit() }, 1200)
          }, now - fitSince > 1500 ? 0 : 350)
        }
        try {
          const watch = new MutationObserver(askFit)
          watch.observe(document.body, { childList: true, subtree: true })
          window.addEventListener('resize', askFit)
          askFit()
          undo.push(() => {
            try {
              watch.disconnect()
              window.removeEventListener('resize', askFit)
              if (fitTimer !== null) clearTimeout(fitTimer)
              if (fitLater !== null) clearTimeout(fitLater)
            } catch (err) { /* gone */ }
          })
        } catch (err) { /* no observer: the pages are DSH's own */ }

        // The view the page shows (home, chat, page) is on <html>: the corner button is a back arrow on a page, the home parks its chips (they are in the "+" sheet).
        // ── MENU C2 (mobile.css), the app only: the Workspaces filter, the « Recents » label and the dock at the foot of the drawer ──
        /** The app's menu, drawn in the app's phone shape: the Kybernos app on a phone. Simple (Kaby mode) is the same drawer: its rows are the ones its locked preset keeps (the Kybernos plugin applies it), nothing is drawn twice. */
        const c2On = () => { try { return appHost() !== null && phone() } catch (err) { return false } }
        // An attribute is written only when its value changes: a write that changes nothing is still a mutation for the observers.
        const mark = (el, name, value) => { try { if (value === null) { if (el.hasAttribute(name)) el.removeAttribute(name) } else if (el.getAttribute(name) !== value) el.setAttribute(name, value) } catch (err) { /* gone */ } }
        let wsPick = '' // the row key of the picked workspace, '' = none: the chats below are those of this workspace
        let selfClick = false
        const autoOpened = new Set()
        let dockEl = null
        let segEl = null
        let segOff = null
        /** The account as the cloud plugin keeps it on this machine (`GET /kybernos-cloud/status`, no network): `{ name }` (the avatar's letter), an empty string when nobody is signed in or it cannot be read. */
        const account = { name: '', at: 0, busy: false }
        const readAccount = (force) => {
          try {
            if (account.busy || typeof window.fetch !== 'function' || (force !== true && Date.now() - account.at < 30000)) return
            account.busy = true
            window.fetch('/kybernos-cloud/status', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)).then((j) => {
              account.busy = false
              account.at = Date.now()
              const st = j !== null && typeof j === 'object' && j.connected === true && j.state !== null && typeof j.state === 'object' ? j.state : null
              const u = st !== null && st.user !== null && typeof st.user === 'object' ? st.user : {}
              const word = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : '')
              const name = word(u.name) !== '' ? word(u.name) : word(u.email).split('@')[0]
              account.name = st === null ? '' : name
              syncMenu()
            }).catch(() => { account.busy = false; account.at = Date.now() })
          } catch (err) { account.busy = false }
        }
        const svgOf = (paths, size) => {
          const NS = 'http://www.w3.org/2000/svg'
          const svg = document.createElementNS(NS, 'svg')
          svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', String(size)); svg.setAttribute('height', String(size))
          svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round')
          svg.setAttribute('aria-hidden', 'true')
          for (const d of paths) { const path = document.createElementNS(NS, 'path'); path.setAttribute('d', d); svg.appendChild(path) }
          return svg
        }
        /** « + New chat »: the Kybernos menu's own button does it (it keeps the chat's state), found by its class; the engine's brand button is the way when that plugin is not there. */
        const startNewChat = () => {
          try {
            const b = document.querySelector('[data-slot="sidebar"] .kb4-newchat') || document.querySelector('[data-slot="sidebar"] [data-window-drag] > button')
            if (b !== null && b !== undefined) b.click()
          } catch (err) { /* no menu: nothing starts */ }
          // the engine reuses the blank chat that is already open and focuses nothing then (and a page under the drawer is inert): the field is given the focus here (see giveComposerFocus)
          try { giveComposerFocus(document, (fn, ms) => setTimeout(fn, ms)) } catch (err) { /* the engine's own focus, if any, stays the only one */ }
        }
        /** The avatar: the web's account menu (below) opens from it. */
        let openAccountMenu = () => {}
        const buildDock = () => {
          const el = document.createElement('div')
          el.className = 'kbmob-dock'
          el.setAttribute('data-kb', 'mobile-dock')
          const avatar = document.createElement('button')
          avatar.type = 'button'
          avatar.className = 'kbmob-avatar'
          avatar.setAttribute('data-kb', 'mobile-avatar')
          avatar.addEventListener('click', (e) => { try { e.stopPropagation() } catch (err) { /* synthetic */ } openAccountMenu() })
          const nc = document.createElement('button')
          nc.type = 'button'
          nc.className = 'kbmob-newchat'
          nc.setAttribute('data-kb', 'mobile-newchat')
          nc.appendChild(svgOf(['M12 5v14', 'M5 12h14'], 20))
          const label = document.createElement('span')
          nc.appendChild(label)
          nc.addEventListener('click', (e) => { try { e.stopPropagation() } catch (err) { /* synthetic */ } startNewChat() })
          el.appendChild(avatar)
          el.appendChild(nc)
          document.body.appendChild(el)
          return el
        }
        /** What mobile.css reads from the drawer's list, and what the dock says. Called on every change of the page (tick) and when the account is read. */
        const syncMenu = () => {
          try {
            if (!c2On()) { if (dockEl !== null) { dockEl.remove(); dockEl = null } if (segEl !== null) { segEl.el.remove(); segEl = null; mark(document.documentElement, 'data-kbmob-modeseg', null) } return }
            if (dockEl === null) dockEl = buildDock()
            // the display mode's segment (Auto · Simple · Complete) over the dock: drawn with the dock, once the seam exists; it follows the seam
            if (modeSeam !== null) {
              if (segEl === null) { segEl = buildModeSegment(document, modeSeam); document.body.appendChild(segEl.el); segOff = modeSeam.subscribe(() => { if (segEl !== null) segEl.sync() }); mark(document.documentElement, 'data-kbmob-modeseg', '1') } else segEl.sync()
            }
            readAccount(false)
            const avatar = dockEl.firstChild
            const who = account.name === '' ? '?' : account.name.charAt(0).toUpperCase()
            if (avatar.textContent !== who) avatar.textContent = who
            mark(avatar, 'aria-label', kt('Compte', 'Account'))
            const nct = document.querySelector('[data-slot="sidebar"] .kb4-nct')
            // The Kybernos menu's own button gives the word (its team names, its wording), except its French source, which is the English « New chat »: a French phone says « Nouveau chat ».
            const own = nct !== null ? String(nct.textContent || '').trim() : ''
            const word = own !== '' && own !== 'New chat' ? own : kt('Nouveau chat', 'New chat')
            const label = dockEl.lastChild.lastChild
            if (label.textContent !== word) label.textContent = word
            const tree = document.querySelector('[data-slot="sidebar"] [data-slot="sidebar.workspaces"] [role="tree"]')
            if (tree === null) return
            const rows = Array.prototype.slice.call(tree.querySelectorAll('[data-row-key^="workspace:"]'))
            // The engine draws the chats of an open workspace only: open each workspace once, so that « Recents » lists every chat (a tap on a workspace is a filter now, it cannot close one).
            for (const r of rows) {
              const key = r.getAttribute('data-row-key')
              if (r.getAttribute('aria-expanded') === 'false' && !autoOpened.has(key)) { autoOpened.add(key); selfClick = true; try { r.click() } catch (err) { /* the engine's row */ } selfClick = false }
            }
            if (wsPick !== '' && !rows.some((r) => r.getAttribute('data-row-key') === wsPick)) wsPick = ''
            for (const r of rows) {
              const mine = r.getAttribute('data-row-key') === wsPick
              mark(r, 'data-kbmob-on', mine ? '1' : null)
              let g = r
              while (g.parentElement !== null && g.parentElement !== tree) g = g.parentElement
              if (g.parentElement === tree) mark(g, 'data-kbmob-picked', mine ? '1' : null)
            }
            mark(tree, 'data-kbmob-filter', wsPick === '' ? null : '1')
            mark(tree, 'data-kbmob-recents', tree.querySelector('[data-row-key^="session:"]') !== null ? kt('Récents', 'Recents') : null)
          } catch (err) { /* the engine's list is not there: nothing to mark */ }
        }
        /** A tap on a workspace row picks it (a second tap clears it); a button inside the row (its actions, « New chat in this workspace ») is the engine's own. */
        const onWorkspaceTap = (e) => {
          try {
            if (selfClick || !c2On()) return
            const t = e.target
            if (t === null || t === undefined || typeof t.closest !== 'function') return
            const row = t.closest('[data-slot="sidebar"] [data-row-key^="workspace:"]')
            if (row === null) return
            const inner = t.closest('button')
            if (inner !== null && row.contains(inner)) return
            e.preventDefault()
            e.stopPropagation()
            const key = row.getAttribute('data-row-key')
            wsPick = wsPick === key ? '' : key
            syncMenu()
          } catch (err) { /* the engine's row: leave it alone */ }
        }
        document.addEventListener('click', onWorkspaceTap, true)
        undo.push(() => { document.removeEventListener('click', onWorkspaceTap, true); if (dockEl !== null) { dockEl.remove(); dockEl = null } if (segOff !== null) { segOff(); segOff = null } if (segEl !== null) { segEl.el.remove(); segEl = null; mark(document.documentElement, 'data-kbmob-modeseg', null) } })
        const tick = () => {
          const root = document.documentElement
          if (!phone()) { if (root.hasAttribute('data-kbmob-view')) root.removeAttribute('data-kbmob-view'); return }
          syncMenu()
          const view = document.querySelector(HOME_MODE_SLOT) !== null ? 'home'
            : (document.querySelector('[data-composer-card]') !== null ? 'chat'
              : (document.querySelector('[data-slot="main"] .kb6-headrow') !== null ? 'page' : 'other'))
          if (root.getAttribute('data-kbmob-view') !== view) { root.setAttribute('data-kbmob-view', view); relabel() }
          syncWhere()
        }
        // ── « Where Kybernos runs » (menu C2): a pill under the chat's title, « ● On Kaby's computer ˅ », drawn here and only when the shell lists `where` (it lists it when more than one place exists)
        // AND the page is on a cloud computer; a tap asks the shell for its own bottom sheet (`kybernos://where`). The place comes from the user agent (`KybernosPlace/local|cloud`), « local » when the
        // shell does not say. On the phone's own engine (`local`) there is no pill: it would only say « On this phone » over the web app's own chat, which has nothing like it (owner, 2026-11-22: « should
        // it appear here? »); where a choice of places really exists, the web app's composer has its own « Run on » / « Execution environment » control, which Simple keeps. ──
        let whereEl = null
        const placeKind = () => { try { const m = /(?:^|\s)KybernosPlace\/(local|cloud)(?=\s|$)/.exec(String(window.navigator.userAgent)); return m === null ? 'local' : m[1] } catch (err) { return 'local' } }
        const syncWhere = () => {
          try {
            const want = c2On() && capList.indexOf('where') >= 0 && placeKind() === 'cloud' && document.documentElement.getAttribute('data-kbmob-view') === 'chat'
            if (!want) { if (whereEl !== null) { whereEl.remove(); whereEl = null } return }
            if (whereEl === null) {
              const b = document.createElement('button')
              b.type = 'button'
              b.className = 'kbmob-where'
              b.setAttribute('data-kb', 'mobile-where')
              b.setAttribute('aria-haspopup', 'dialog')
              const dot = document.createElement('i'); dot.className = 'kbmob-where-dot'
              const label = document.createElement('span')
              b.appendChild(dot); b.appendChild(label); b.appendChild(svgOf(['M6 9l6 6 6-6'], 12))
              b.addEventListener('click', (e) => { try { e.stopPropagation() } catch (err) { /* synthetic */ } openLink('where') })
              document.body.appendChild(b)
              whereEl = b
            }
            const kind = placeKind()
            const word = kind === 'cloud' ? kt('Sur l’ordinateur de Kaby', 'On Kaby’s computer') : kt('Sur ce téléphone', 'On this phone')   // `local` never reaches here (see above); the word stays for a page whose place is read late
            const label = whereEl.children[1]
            if (label.textContent !== word) label.textContent = word
            mark(whereEl, 'data-place', kind)
            mark(whereEl, 'aria-label', kt('Où tourne Kybernos : ', 'Where Kybernos runs: ') + word)
            // under the title's first letter: the engine's own title box is found by what it holds (its first line of text), its place read
            let left = 56
            try {
              const head = document.querySelector('[data-slot="conversation.session.header"]')
              const row = head !== null && head.firstElementChild !== null ? head.firstElementChild : null
              // the first text node (its own box can start left of its letters: the real phone's title box began 8 px before the word), measured by a range over the letters
              const walk = (e) => { for (const n of Array.prototype.slice.call(e.childNodes)) { if (n.nodeType === 3 && String(n.textContent).trim() !== '') return n } for (const c of Array.prototype.slice.call(e.children)) { const f = walk(c); if (f !== null) return f } return null }
              const t = row !== null ? walk(row) : null
              if (t !== null) { const rg = document.createRange(); rg.selectNodeContents(t); const r = rg.getBoundingClientRect(); if (r.width > 0 && r.left > 0) left = Math.round(r.left) }
            } catch (err) { /* the title's place is not known: after the burger */ }
            const css = left + 'px'
            if (whereEl.style.getPropertyValue('--kbmob-where-left') !== css) whereEl.style.setProperty('--kbmob-where-left', css)
          } catch (err) { /* no pill */ }
        }
        undo.push(() => { if (whereEl !== null) { whereEl.remove(); whereEl = null } })
        // The shell's own screens (contract §1b): the account menu below opens them as links, only the ones the user agent lists; `data-kbmob-caps` is the list, on <html>, for whatever else reads it.
        const capList = caps()
        if (capList.length > 0) {
          try { document.documentElement.setAttribute('data-kbmob-caps', capList.join(' ')); undo.push(() => document.documentElement.removeAttribute('data-kbmob-caps')) } catch (err) { /* no <html> */ }
        }
        const openLink = (name) => { try { window.location.assign('kybernos://' + name) } catch (err) { /* the shell handles the link; nothing to do without it */ } }
        /** DSH's Settings window, by the seam of the Kybernos plugin (the call its account menu makes), then the plain trigger of the sidebar. */
        const openEngineSettings = () => {
          try { const seam = window.__kbOpenDshSettings; if (typeof seam === 'function' && seam() === true) return } catch (err) { /* the seam threw: the plain trigger is next */ }
          try { const t = document.querySelector('[data-slot="sidebar.settings"] button[aria-haspopup="dialog"]'); if (t !== null && t !== undefined) t.click() } catch (err) { /* no trigger: nothing to open */ }
        }
        // ── The avatar opens the web's account menu (kybernos-cloud's footer card: the same entries in the same order). The card is in the page but not drawn (mobile.css), and its own button
        // opens the menu, which the sheet rule of mobile.css draws from the bottom (a layer: scrim, Back, swipe down). Without the card, DSH's Settings window. ──
        const accountCard = () => document.querySelector('[data-slot="sidebar.footer.action"] [data-kb="workspace-card"] .kbfp-cardmain, [data-slot="sidebar.footer.action"] [data-kb="signin-card"] .kbfp-cardmain')
        const closeAccountMenu = () => { try { const card = accountCard(); if (card !== null && card !== undefined && card.getAttribute('aria-expanded') === 'true') card.click() } catch (err) { /* gone */ } }
        openAccountMenu = () => {
          try {
            if (!c2On()) return
            const card = accountCard()
            if (card !== null && card !== undefined) { card.click(); return }
            openEngineSettings()
          } catch (err) { /* nothing to open */ }
        }
        // Rows of that menu the shell draws natively, only when it lists the screen: Account, Referral, Sign out. The others keep the web's act (Upgrade, Team settings, Website, Help leave
        // the app by a browser link as on the web; Settings, Phone and channels, Send feedback open the page they open on the web). A row that opens a page also puts the drawer away; Appearance
        // (a control: the menu stays open) and the space header (it lists the spaces) do not.
        const NATIVE_ROWS = { 'menu-account': 'account', 'menu-referral': 'referral', 'menu-logout': 'signout' }
        const onAccountMenuTap = (e) => {
          try {
            if (!c2On()) return
            const t = e.target
            if (t === null || t === undefined || typeof t.closest !== 'function') return
            const row = t.closest('[role="menu"] [data-kb^="menu-"]')
            if (row === null) return
            const key = row.getAttribute('data-kb')
            if (row.closest('[data-kb="menu-block-appearance"]') !== null || key === 'menu-switch' || key.indexOf('menu-block') === 0) return
            const name = NATIVE_ROWS[key]
            if (name !== undefined && capList.indexOf(name) >= 0) {
              e.preventDefault()
              e.stopPropagation()
              closeAccountMenu()
              openLink(name)
            }
            setTimeout(() => { try { closeDrawer() } catch (err) { /* no drawer */ } }, 160)
          } catch (err) { /* not an element */ }
        }
        document.addEventListener('click', onAccountMenuTap, true)
        undo.push(() => document.removeEventListener('click', onAccountMenuTap, true))
        // The layers (contract §8): told to the shell, closed on its `close-layer` or on the system Back, a scrim behind the sheets, a swipe down closes one.
        try {
          // An in-page screen (Reminders, Apps…) is the lowest layer (contract §8). Leaving it goes to the Kaby row (the screen it was opened from, the chat) and opens the drawer over that
          // screen. With no Kaby row (the phone's Simple hides it) the row's own action is done without it: Kaby's conversation is opened by the Kaby plugin's hook, the way the row does; with no hook
          // either, the drawer opens over the page so the person can choose.
          const pageOpen = () => { try { return phone() && document.documentElement.getAttribute('data-kbmob-view') === 'page' } catch (e) { return false } }
          const leavePage = () => {
            let row = null
            try { row = document.querySelector('[data-kb-row="kyber"]') } catch (e) { row = null }
            let hook = null
            try { const k = window.__KB_KYBER__; hook = k !== undefined && k !== null && typeof k.openChat === 'function' ? k : null } catch (e) { hook = null }
            if ((row !== null && row !== undefined && typeof row.click === 'function') || hook !== null) {
              try { if (row !== null && row !== undefined && typeof row.click === 'function') row.click(); else hook.openChat() } catch (e) { /* the row went away */ }
              // a tap on a row closes the drawer a moment later (`decide`): the drawer is opened after that
              setTimeout(() => { try { if (!drawerOpen()) { opened = true; flip() } } catch (e) { /* no drawer */ } }, 300)
              return true
            }
            try { if (!drawerOpen()) { opened = true; flip() } } catch (e) { /* no drawer */ }
            return false
          }
          const layers = createLayers(window, document, { menuOpen: drawerOpen, closeMenu: closeDrawer, phone, history: narrow, post: shellPost, tick, pageOpen, leavePage })
          layerCtl = layers
          layers.start()
          undo.push(() => { layers.stop(); if (layerCtl === layers) layerCtl = null })
        } catch (err) { try { console.warn('[kybernos-mobile] layers not mounted:', err) } catch (e2) { /* no console */ } }

        // The drawer opens at its top (see drawerTop).
        try { undo.push(startDrawerTop(document, window, drawerOpen)) } catch (err) { /* the drawer keeps the engine's scroll */ }

        // iOS only draws under the notch and the home indicator with viewport-fit=cover; mobile.css pads with env().
        try {
          const meta = document.querySelector('meta[name="viewport"]')
          const before = meta !== null && meta !== undefined ? String(meta.getAttribute('content') || '') : null
          if (before !== null && !/viewport-fit/.test(before)) {
            meta.setAttribute('content', before + ', viewport-fit=cover')
            undo.push(() => { try { meta.setAttribute('content', before) } catch (err) { /* gone */ } })
          }
        } catch (err) { /* no meta */ }

        // An open sidebar is an open drawer over the chat. DSH leaves its sidebar open above its own breakpoint, which a
        // phone in landscape is: close it when the phone condition starts to hold, at start and after a turn of the
        // screen, unless the person opened the drawer themselves (the menu button marks that).
        const settle = () => { try { if (narrow() && drawerOpen() && !opened) closeDrawer() } catch (err) { /* no shell yet */ } }
        let tries = 0
        const first = setInterval(() => {
          tries += 1
          if (frame() !== null && frame() !== undefined) { settle(); clearInterval(first) } else if (tries > 24) clearInterval(first)
        }, 250)
        undo.push(() => clearInterval(first))
        let turn = null
        const onTurn = () => { if (turn !== null) clearTimeout(turn); turn = setTimeout(settle, 300) }
        try { window.addEventListener('resize', onTurn); undo.push(() => { try { window.removeEventListener('resize', onTurn) } catch (err) { /* gone */ } }) } catch (err) { /* no window events */ }
        return () => { for (const f of undo.reverse()) { try { f() } catch (e) { /* already gone */ } } }
      }


      // ── the « Phone and channels » screen ────────────────────────────────────────────────────────────────────────────────
      // ONE screen, drawn in two places: a window (`window.__KB_MOBILE__.open()`: the account menu's entry and Kaby's strip ask for it) and
      // Settings › Phone and channels. Two columns:
      //   · left, this bundle's: the phone link — a QR code, a 4-digit check, the phones linked. It gives a phone the CONTROL OF THIS
      //     computer, and the card says so in a sentence of its own;
      //   · right, Kaby's (kybernos-kyber draws it, through `window.__KB_KYBER__.ChannelsColumn`): the messaging apps Kaby answers from,
      //     which never give control of the computer. Without that bundle the card says it is not there.
      // What the left column shows is decided by the host half (GET /kybernos-mobile/remote/status): this is only a view and a few
      // buttons. The QR code is drawn from the modules the host computed; it is black on white on purpose, whatever the theme (a
      // scanner needs the contrast), the only colours this file names.
      const buildRemoteUi = (React, roots) => {
        const h = React.createElement
        const BASE = (() => { try { return new URL('kybernos-mobile/remote/', document.baseURI).pathname } catch (e) { return '/kybernos-mobile/remote/' } })()
        const api = async (name, body) => {
          try {
            const init = body === undefined
              ? { credentials: 'same-origin', cache: 'no-store' }
              : { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
            const r = await fetch(BASE + name, init)
            // The phone app's own engine has no phone link: its host answers 404 for this whole family of routes, and always will (`absent`).
            if (r.status === 404) return { ok: false, error: 'network', absent: true }
            return await r.json()
          } catch (e) { return { ok: false, error: 'network' } }
        }
        const ERRORS = {
          not_in_plan: () => kt('Ton offre n’inclut pas le mobile.', 'Your plan does not include the phone link.'),
          device_limit: () => kt('Le nombre maximum de téléphones est atteint : retires-en un.', 'The maximum number of phones is reached: remove one.'),
          not_connected: () => kt('Connecte-toi à ton compte Kybernos.', 'Sign in to your Kybernos account.'),
          // The server that does not answer is named when the host knows which one it is (label and host): with several servers « the Kybernos server » says nothing.
          server_unavailable: (server) => {
            const has = (v) => typeof v === 'string' && v !== ''
            const named = server !== null && typeof server === 'object' && has(server.name)
            const label = server !== null && typeof server === 'object' ? [named ? '“' + server.name + '”' : '', has(server.host) ? (named ? '(' + server.host + ')' : server.host) : ''].filter((x) => x !== '').join(' ') : ''
            return label === ''
              ? kt('Le serveur Kybernos ne répond pas. Réessaie dans un instant.', 'The Kybernos server does not answer. Try again in a moment.')
              : kt('Le serveur ' + label.replace('“', '« ').replace('”', ' »') + ' ne répond pas. Réessaie dans un instant.', 'The server ' + label + ' does not answer. Try again in a moment.')
          },
          server_refused: () => kt('Le serveur a refusé l’appairage.', 'The server refused the pairing.'),
          not_offered: () => kt('Ce serveur Kybernos ne propose pas encore le mobile.', 'This Kybernos server does not offer the phone link yet.'),
          network: () => kt('Connexion impossible avec Kybernos.', 'Cannot reach Kybernos.'),
        }
        const errorText = (code, server) => (ERRORS[code] !== undefined ? ERRORS[code](server) : kt('Une erreur est survenue.', 'Something went wrong.'))
        // « Switch server »: the footer (kybernos-cloud) opens Settings › Servers when it hears this. Nothing listens (no footer, no servers page): nothing happens.
        const switchServer = () => { try { window.dispatchEvent(new Event('kybernos-cloud:servers')) } catch (e) { /* no window events */ } }

        const useRemote = () => {
          const [s, setS] = React.useState(null)
          // Why the last poll failed (null when it worked): the page keeps the last good status and says so, instead of drawing a status that is not one.
          const [err, setErr] = React.useState(null)
          const live = React.useRef(true)
          const gone = React.useRef(false) // the status route does not exist here: the page stops asking (the console filled with 404s, phone test 2026-11-08)
          const load = React.useCallback(async () => {
            const j = await api('status')
            if (!live.current) return
            if (j !== null && typeof j === 'object' && j.absent === true) gone.current = true
            if (j !== null && typeof j === 'object' && j.ok === true) { setS(j); setErr(null) } else setErr(j !== null && typeof j === 'object' && typeof j.error === 'string' ? j.error : 'network')
          }, [])
          React.useEffect(() => {
            live.current = true
            void load()
            const timer = setInterval(() => { if (document.visibilityState === 'visible' && gone.current !== true) void load() }, 1500)
            return () => { live.current = false; clearInterval(timer) }
          }, [load])
          // After a gesture the page reads the status again, and tells the rest of the page (Kaby's strip shows the phone link's state too).
          const act = React.useCallback(async (name, body) => {
            const j = await api(name, body === undefined ? {} : body)
            await load()
            try { window.dispatchEvent(new Event('kybernos-mobile:changed')) } catch (e) { /* no window events */ }
            return j
          }, [load])
          return { s, err, act, reload: load }
        }
        // A clock for a code that runs out: it ticks only while `on` (a pairing is in progress), so an idle screen is not redrawn every second.
        const useTick = (on) => {
          const [n, setN] = React.useState(Date.now())
          React.useEffect(() => {
            if (on === false) return undefined
            const t = setInterval(() => setN(Date.now()), 1000)
            return () => clearInterval(t)
          }, [on])
          return n
        }
        // The address of the Kybernos web app (for « See the plans »): the cloud half already knows it. The window is handed it; the Settings page reads it.
        const useWeb = (given) => {
          const [web, setWeb] = React.useState(typeof given === 'string' ? given : '')
          React.useEffect(() => {
            if (typeof given === 'string' && given !== '') return undefined
            let live = true
            void (async () => {
              try {
                const j = await (await fetch(new URL('kybernos-cloud/status', document.baseURI).pathname, { credentials: 'same-origin' })).json()
                const w = j && j.state && typeof j.state.web_url === 'string' ? j.state.web_url : ''
                if (live) setWeb(w)
              } catch (e) { /* the screen still works, without the button */ }
            })()
            return () => { live = false }
          }, [given])
          return web
        }
        const clock = (ms) => { const t = Math.max(0, Math.round(ms / 1000)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0') }
        const ago = (ms) => {
          if (typeof ms !== 'number') return kt('jamais vu', 'never seen')
          const m = Math.max(0, Math.round((Date.now() - ms) / 60000))
          if (m < 1) return kt('à l’instant', 'just now')
          if (m < 60) return kt('il y a ' + m + ' min', m + ' min ago')
          const hrs = Math.round(m / 60)
          if (hrs < 48) return kt('il y a ' + hrs + ' h', hrs + ' h ago')
          return kt('il y a ' + Math.round(hrs / 24) + ' j', Math.round(hrs / 24) + ' d ago')
        }
        /** Where the phone link stands, in one word: a code to scan (`waiting`), a code that ran out (`expired`), a phone asking for the check (`verify`), a phone connected now, linked phones that are off, or none. */
        const faceOf = (s, now) => {
          const p = s.pairing
          if (p !== null && p !== undefined) {
            if (p.state === 'verify') return 'verify'
            return typeof p.expires_at === 'number' && p.expires_at - now <= 0 ? 'expired' : 'waiting'
          }
          const devices = Array.isArray(s.devices) ? s.devices : []
          if (devices.some((d) => d.online === true)) return 'connected'
          return devices.length > 0 ? 'offline' : 'none'
        }
        const Chip = (props) => h('span', { className: 'kbpc-chip' + (props.kind ? ' ' + props.kind : ''), 'data-kb': props.kb, 'data-face': props.face }, h('span', { className: 'kbpc-dot', 'aria-hidden': 'true' }), props.children)
        const FACE_CHIP = {
          waiting: () => ['warn', kt('En attente du téléphone', 'Waiting for the phone')],
          verify: () => ['warn', kt('En attente de ton accord', 'Waiting for your OK')],
          expired: () => ['err', kt('Code expiré', 'Code expired')],
          connected: (s) => ['ok', s.devices.filter((d) => d.online === true).length > 1 ? kt('Téléphones connectés', 'Phones connected') : kt('Téléphone connecté', 'Phone connected')],
          offline: () => ['', kt('Aucun téléphone connecté', 'No phone connected')],
          none: () => ['', kt('Prêt à relier un téléphone', 'Ready to pair')],
        }

        const Qr = (props) => {
          const q = props.qr
          if (q === null || q === undefined || !Array.isArray(q.modules)) return null
          const n = q.size
          let d = ''
          for (let y = 0; y < n; y += 1) { const row = q.modules[y]; for (let x = 0; x < n; x += 1) { if (row.charCodeAt(x) === 49) d += 'M' + (x + 4) + ' ' + (y + 4) + 'h1v1h-1z' } }
          return h('div', { className: 'kbmr-qr', 'data-kb': 'mobile-qr' },
            h('svg', { viewBox: '0 0 ' + (n + 8) + ' ' + (n + 8), shapeRendering: 'crispEdges', role: 'img', 'aria-label': kt('Code QR à scanner avec le téléphone', 'QR code to scan with the phone') },
              h('rect', { width: n + 8, height: n + 8, fill: 'white' }),
              h('path', { d, fill: 'black' })))
        }

        const Steps = () => h('ol', { className: 'kbmr-steps' },
          h('li', null, kt('Ouvre l’appareil photo de ton téléphone.', 'Open your phone’s camera.')),
          h('li', null, kt('Vise ce code et ouvre le lien.', 'Aim at this code and open the link.')),
          h('li', null, kt('Vérifie que le code à 4 chiffres est le même ici et sur le téléphone.', 'Check that the 4-digit code is the same here and on the phone.')))

        const Lock = () => h('div', { className: 'kbmr-lock' },
          h('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
            h('rect', { x: 4, y: 11, width: 16, height: 10, rx: 2 }), h('path', { d: 'M8 11V7a4 4 0 0 1 8 0v4' })),
          h('span', null, kt('Chiffré de bout en bout : Kybernos fait passer les messages sans pouvoir les lire.', 'End-to-end encrypted: Kybernos carries the messages and cannot read them.')))

        // The pairing in progress: the QR code to scan, then the 4-digit check to approve.
        const Pairing = (props) => {
          const p = props.pairing
          const now = useTick(true)
          const [copied, setCopied] = React.useState(false)
          if (p.state === 'verify') {
            const left = typeof p.verify_until === 'number' ? p.verify_until - now : null
            return h('div', { className: 'kbmr-verify', 'data-kb': 'mobile-verify' },
              h('div', { className: 'kbmr-h' }, kt('Un téléphone demande l’accès', 'A phone asks for access')),
              h('div', { className: 'kbmr-sub' }, (p.phone_label || '') + (p.phone_label ? ' · ' : '') + kt('vérifie que ce code est le même sur son écran', 'check that this code is the same on its screen')),
              h('div', { className: 'kbmr-sas', 'data-kb': 'mobile-sas' }, p.sas),
              left !== null ? h('div', { className: 'kbmr-sub' }, kt('Expire dans ', 'Expires in ') + clock(left)) : null,
              h('div', { className: 'kbmr-row' },
                h('button', { type: 'button', className: 'kbmr-btn', 'data-kb': 'mobile-deny', disabled: props.busy, onClick: props.onDeny }, kt('Refuser', 'Refuse')),
                h('button', { type: 'button', className: 'kbmr-btn kbmr-primary', 'data-kb': 'mobile-approve', disabled: props.busy, onClick: props.onApprove }, kt('Autoriser', 'Allow'))))
          }
          const left = p.expires_at - now
          const expired = left <= 0
          if (expired) {
            return h('div', { className: 'kbmr-pairing', 'data-kb': 'mobile-pairing', 'data-expired': 'true' },
              h('div', { className: 'kbmr-sub kbmr-center' }, kt('Le code QR n’est plus valable. Fais-en un nouveau pour relier un téléphone.', 'The QR code is no longer valid. Make a new one to link a phone.')),
              h('div', { className: 'kbmr-row' },
                h('button', { type: 'button', className: 'kbmr-btn kbmr-primary', 'data-kb': 'mobile-new-code', disabled: props.busy, onClick: props.onNew }, kt('Nouveau code QR', 'New QR code')),
                h('button', { type: 'button', className: 'kbmr-btn', 'data-kb': 'mobile-stop', disabled: props.busy, onClick: props.onStop }, kt('Arrêter', 'Stop'))))
          }
          return h('div', { className: 'kbmr-pairing', 'data-kb': 'mobile-pairing' },
            h(Qr, { qr: p.qr }),
            h('div', { className: 'kbmr-sub kbmr-center' }, kt('À usage unique · expire dans ', 'Single use · expires in ') + clock(left)),
            h(Steps),
            h('div', { className: 'kbmr-row' },
              h('button', { type: 'button', className: 'kbmr-btn', 'data-kb': 'mobile-new-code', disabled: props.busy, onClick: props.onNew }, kt('Actualiser le QR', 'Refresh the QR')),
              typeof p.url === 'string'
                ? h('button', { type: 'button', className: 'kbmr-btn', 'data-kb': 'mobile-copy', onClick: () => { try { void navigator.clipboard.writeText(p.url); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch (e) { /* no clipboard */ } } }, copied ? kt('Copié', 'Copied') : kt('Copier le lien', 'Copy the link'))
                : null,
              h('button', { type: 'button', className: 'kbmr-btn', 'data-kb': 'mobile-stop', disabled: props.busy, onClick: props.onStop }, kt('Arrêter', 'Stop'))),
            h(Lock))
        }

        const Devices = (props) => {
          const [confirm, setConfirm] = React.useState(null)
          const list = props.devices
          if (list.length === 0) return h('div', { className: 'kbmr-sub' }, kt('Aucun téléphone relié pour l’instant.', 'No phone linked yet.'))
          const stateText = (d) => (d.state === 'locked' ? kt('Verrouillé : hors de ton offre', 'Locked: not in your plan') : d.online ? kt('Connecté maintenant', 'Connected now') : kt('Hors ligne', 'Offline') + ' · ' + ago(d.last_seen_at))
          return h('div', { className: 'kbmr-devices', 'data-kb': 'mobile-devices' },
            list.map((d) => h('div', { key: d.id, className: 'kbmr-device', 'data-kb': 'mobile-device' },
              h('span', { className: 'kbmr-dot' + (d.online ? ' on' : ''), 'aria-hidden': 'true' }),
              h('div', { className: 'kbmr-devtxt' }, h('div', { className: 'kbmr-devname', title: d.label }, d.label), h('div', { className: 'kbmr-sub' }, stateText(d))),
              confirm === d.id
                ? h('button', { type: 'button', className: 'kbmr-btn kbmr-danger', 'data-kb': 'mobile-revoke-confirm', onClick: () => { setConfirm(null); props.onRevoke(d.id) } }, kt('Confirmer', 'Confirm'))
                : h('button', { type: 'button', className: 'kbmr-btn', 'data-kb': 'mobile-revoke', onClick: () => setConfirm(d.id) }, kt('Déconnecter', 'Disconnect')))))
        }

        const Paywall = (props) => h('div', { className: 'kbmr-paywall', 'data-kb': 'mobile-paywall' },
          h('div', { className: 'kbmr-lockbox', 'aria-hidden': 'true' },
            h('svg', { width: 36, height: 36, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' },
              h('rect', { x: 4, y: 11, width: 16, height: 10, rx: 2 }), h('path', { d: 'M8 11V7a4 4 0 0 1 8 0v4' }))),
          h('div', { className: 'kbmr-h' }, kt('Non inclus dans ton offre', 'Not included in your plan')),
          h('div', { className: 'kbmr-sub' }, kt('Ton offre actuelle n’inclut pas le lien téléphone. Avec une offre qui l’inclut, tu scannes un code et ton téléphone pilote cet ordinateur, où que tu sois, sans rien ouvrir sur ta box ni créer de compte en plus. Ton poste reste utilisable en local, comme avant.', 'Your current plan does not include the phone link. With a plan that does, you scan a code and your phone drives this computer from anywhere, with nothing to open on your router and no extra account. Your computer stays usable locally, as before.')),
          typeof props.web === 'string' && props.web !== ''
            ? h('button', { type: 'button', className: 'kbmr-btn kbmr-primary', 'data-kb': 'mobile-plans', onClick: () => { try { window.open(props.web, '_blank', 'noopener') } catch (e) { /* cannot open */ } } }, kt('Voir les offres', 'See the plans'))
            : null)

        // The left column's body, the same in the window and on the Settings page.
        const Body = (props) => {
          const s = props.r.s
          useTick(s !== null && s.pairing != null)
          const [error, setError] = React.useState(null)
          const [busy, setBusy] = React.useState(false)
          // The way out of a server that does not answer is offered only when the host says there is another server to go to.
          const [switchable, setSwitchable] = React.useState(false)
          const run = async (name, body) => {
            setBusy(true)
            const j = await props.r.act(name, body)
            setBusy(false)
            setError(j && j.ok === false ? errorText(j.error, j.server) : null)
            setSwitchable(j !== null && j !== undefined && j.ok === false && j.error === 'server_unavailable' && j.server !== null && typeof j.server === 'object' && j.server.can_switch === true)
            return j
          }
          // A failed poll keeps what was shown and adds the reason on top; with nothing shown yet it is the whole card until the next good poll.
          const polled = props.r.err !== null && props.r.err !== undefined ? h('div', { className: 'kbmr-error', role: 'alert', 'data-kb': 'mobile-poll-error' }, errorText(props.r.err)) : null
          if (s === null) return polled !== null ? polled : h('div', { className: 'kbmr-sub' }, kt('Chargement…', 'Loading…'))
          // The states that say why there is nothing to do yet are drawn like the others: the same shaded box, a chip, one sentence.
          const said = (face, chip, sentence, kb) => h('div', { className: 'kbmr-body', 'data-kb': kb },
            h('div', { className: 'kbpc-state' },
              h('div', { className: 'kbmr-row kbmr-start' }, h(Chip, { kind: '', face, kb: 'mobile-chip' }, chip)),
              h('div', { className: 'kbmr-sub' }, sentence)))
          if (s.available === false) return said('unavailable', kt('Indisponible', 'Unavailable'), kt('Cette version de Kybernos ne permet pas la connexion mobile.', 'This Kybernos version cannot do the phone link.'), 'mobile-unavailable')
          if (s.configured === false) return said('not-offered', kt('Pas encore proposé', 'Not offered yet'), kt('Ce serveur Kybernos ne propose pas encore le mobile. Rien ne peut être relié pour l’instant : ça marchera ici dès que ce sera le cas.', 'This Kybernos server does not offer the phone link yet. Nothing can be linked for now: it will work here as soon as it does.'), 'mobile-not-offered')
          if (s.connected === false) return said('signin', kt('Connexion requise', 'Sign in needed'), kt('Connecte-toi à ton compte Kybernos pour utiliser le mobile.', 'Sign in to your Kybernos account to use the phone link.'), 'mobile-signin')
          const devices = Array.isArray(s.devices) ? s.devices : []
          if (s.entitled === false) return h('div', null, h(Paywall, { web: props.web }), devices.length > 0 ? h(Devices, { devices, onRevoke: (id) => run('devices/revoke', { id }) }) : null)
          const face = faceOf(s, Date.now())
          const chip = FACE_CHIP[face](s)
          return h('div', { className: 'kbmr-body' },
            polled,
            error !== null
              ? h('div', { className: 'kbmr-error', role: 'alert' }, error,
                switchable === true ? h('button', { type: 'button', className: 'kbmr-link', 'data-kb': 'mobile-switch-server', onClick: typeof props.onSwitchServer === 'function' ? props.onSwitchServer : switchServer }, kt('Changer de serveur', 'Switch server')) : null)
              : null,
            h('div', { className: 'kbpc-state', 'data-kb': 'mobile-state', 'data-face': face },
              h('div', { className: 'kbmr-row kbmr-start' }, h(Chip, { kind: chip[0], face, kb: 'mobile-chip' }, chip[1])),
              face === 'none' && s.pairing == null ? h('div', { className: 'kbmr-sub', 'data-kb': 'mobile-none-note' }, kt('Aucun téléphone n’est relié : rien ne peut atteindre cet ordinateur.', 'No phone is linked yet, so nothing can reach this computer.')) : null,
              s.pairing != null
                ? h(Pairing, { pairing: s.pairing, busy, onApprove: () => run('pair/approve'), onDeny: () => run('pair/deny'), onNew: () => run('pair'), onStop: () => run('pair/cancel') })
                : h('div', { className: 'kbmr-row kbmr-start' },
                  h('button', { type: 'button', className: 'kbmr-btn' + (devices.length === 0 ? ' kbmr-primary' : ''), 'data-kb': 'mobile-pair', disabled: busy, onClick: () => { void run('pair') } }, kt('Ajouter un téléphone', 'Add a phone')))),
            // With no phone linked the state above already says so: no empty « Linked phones (0) » section under it.
            devices.length === 0 && !(s.refused > 0) ? null : h('div', { className: 'kbmr-section' },
              h('div', { className: 'kbmr-sech' },
                h('span', null, kt('Téléphones reliés', 'Linked phones') + ' (' + devices.length + ')'),
                s.relay === 'up' ? h('span', { className: 'kbmr-sub kbmr-inline' }, h('span', { className: 'kbmr-dot on', 'aria-hidden': 'true' }), kt('Relais Kybernos joint', 'Kybernos relay reached')) : null),
              h(Devices, { devices, onRevoke: (id) => run('devices/revoke', { id }) }),
              devices.length > 1 ? h('button', { type: 'button', className: 'kbmr-link', 'data-kb': 'mobile-revoke-all', onClick: () => { void run('devices/revoke-all') } }, kt('Tout déconnecter', 'Disconnect all')) : null,
              s.refused > 0 ? h('div', { className: 'kbmr-sub' }, (s.refused === 1
                ? kt('1 demande refusée depuis un téléphone (réglages, identifiants, extensions).', '1 request refused from a phone (settings, credentials, plugins).')
                : kt(s.refused + ' demandes refusées depuis un téléphone (réglages, identifiants, extensions).', s.refused + ' requests refused from a phone (settings, credentials, plugins).'))) : null))
        }

        // ── the two cards ──
        // The assistant's name is kybernos-kyber's (one constant there); this bundle asks for it, and says « Kaby » when that bundle is not there.
        const kyberSeam = () => { try { const k = window.__KB_KYBER__; return k !== undefined && k !== null && typeof k.ChannelsColumn === 'function' ? k : null } catch (e) { return null } }
        const assistantName = () => { const k = kyberSeam(); return k !== null && typeof k.name === 'string' && k.name !== '' ? k.name : 'Kaby' }
        // A column that fails to draw must not take the window with it: a boundary around the right-hand one (a stub React without classes draws it bare).
        const Guard = typeof React.Component === 'function'
          ? class Guard extends React.Component {
            constructor (p) { super(p); this.state = { failed: false } }
            static getDerivedStateFromError () { return { failed: true } }
            componentDidCatch (e) { try { console.warn('[kybernos-mobile] the channels column failed to draw:', e) } catch (e2) { /* no console */ } }
            render () { return this.state.failed ? this.props.fallback : this.props.children }
          }
          : null

        /** The one switch of the phone link. A button with a role, a name and a state: it is what a screen reader and the keyboard use. */
        const Switch = (props) => h('button', {
          type: 'button', role: 'switch', className: 'kbpc-sw', 'data-kb': props.kb, 'aria-checked': props.on ? 'true' : 'false', 'aria-label': props.label, title: props.title,
          disabled: props.disabled === true, onClick: props.onClick,
        })
        /** Left: this computer's phone link, WALLED OFF from Kaby (2026-10-22): it is the only thing on this screen that gives control of the computer. A switch (on by default: ready to
         *  pair, nothing reachable until a phone is linked), the state, and in three lines what it does, what it needs and what to be careful about. */
        const RemoteCard = (props) => {
          const s = props.r.s
          const computer = s !== null && typeof s.computer === 'string' && s.computer !== '' ? s.computer : ''
          // The switch is this computer's own: it works whenever the host half answers, even while the server does not offer the phone link yet (nothing can be linked then, and
          // the choice is kept for when it does).
          const reachable = s !== null && s.available !== false
          const enabled = s === null || s.enabled !== false
          // A plan without the phone link (the host's `entitled` is false; null is « not known yet »): the paywall below says so, and the switch does not claim a link that cannot exist:
          // drawn off and greyed, with the same words as a title (recette L1-104). Only when the paywall IS what the card shows: «not offered», «unavailable» and «sign in» come first (Body).
          const locked = s !== null && s.available !== false && s.configured !== false && s.connected !== false && s.entitled === false
          const [error, setError] = React.useState(null)
          const [busy, setBusy] = React.useState(false)
          const turn = async (on) => {
            setBusy(true)
            const j = await props.r.act('enable', { on })
            setBusy(false)
            setError(j !== null && j !== undefined && j.ok === false ? errorText(j.error, j.server) : null)
          }
          const linked = s !== null && Array.isArray(s.devices) ? s.devices : []
          const body = enabled
            ? h(Body, { r: props.r, web: props.web, onSwitchServer: props.onSwitchServer })
            : h('div', { className: 'kbmr-body', 'data-kb': 'phone-remote-off' },
              h('div', { className: 'kbpc-state' },
                h('div', { className: 'kbmr-row kbmr-start' }, h(Chip, { kind: '', kb: 'mobile-chip', face: 'off' }, kt('Désactivé : aucun téléphone ne peut se connecter à cet ordinateur.', 'Off. No phone can connect to this computer.'))),
                h('div', { className: 'kbmr-row kbmr-start' }, h('button', { type: 'button', className: 'kbmr-btn kbmr-primary', 'data-kb': 'phone-remote-turn-on', disabled: busy || !reachable, onClick: () => { void turn(true) } }, kt('Activer', 'Turn on')))),
              linked.length > 0
                ? h('div', { className: 'kbmr-section' },
                  h('div', { className: 'kbmr-sech' }, h('span', null, kt('Téléphones reliés', 'Linked phones') + ' (' + linked.length + ')')),
                  h(Devices, { devices: linked, onRevoke: (id) => { void props.r.act('devices/revoke', { id }) } }))
                : null)
          return h('section', { className: 'kbpc-card', 'data-kb': 'phone-remote', 'data-enabled': enabled ? 'true' : 'false' },
            h('h2', { className: 'kbpc-h' },
              h('span', { className: 'kbpc-hico', 'aria-hidden': 'true' }, h(PhoneIcon)),
              h('span', null, kt('Contrôle à distance', 'Remote control')),
              h('span', { className: 'kbpc-tag warn', 'data-kb': 'phone-remote-tag' }, kt('Contrôle complet', 'Full control'))),
            h('div', { className: 'kbpc-swrow' },
              h('span', { className: 'kbmr-sub', 'data-kb': 'phone-remote-lead' }, kt('Ouvrir cet ordinateur sur ton téléphone.', 'Open this computer on your phone.')),
              h(Switch, { on: enabled && !locked, disabled: busy || !reachable || locked, kb: 'phone-remote-switch', label: kt('Contrôle à distance', 'Remote control'), title: locked ? kt('Non inclus dans ton offre', 'Not included in your plan') : undefined, onClick: () => { void turn(!enabled) } })),
            error !== null ? h('div', { className: 'kbmr-error', role: 'alert', 'data-kb': 'phone-remote-error' }, error) : null,
            body,
            h('div', { className: 'kbpc-does', 'data-kb': 'phone-remote-does' },
              h('b', null, kt('Ce que ça fait', 'It does')), h('span', null, kt('Montre le Kybernos de cet ordinateur sur ton téléphone, par un relais qui ne lit rien (chiffré de bout en bout).', 'Shows this computer’s Kybernos on your phone, through a relay that reads nothing (end-to-end encrypted).')),
              h('b', null, kt('Ce qu’il faut', 'It needs')), h('span', null, kt('Cet ordinateur allumé et connecté.', 'This computer switched on and online.')),
              h('b', { 'data-kb': 'phone-remote-rights' }, kt('Attention', 'Be careful')), h('span', null, h('b', null, kt('Contrôle complet', 'Full control')), ' ',
                kt('de cet ordinateur' + (computer !== '' ? ' (' + computer + ')' : '') + '. À utiliser seulement sur un téléphone à toi.', 'of this computer' + (computer !== '' ? ' (' + computer + ')' : '') + '. Use it only on a phone that is yours.'))))
        }
        /** Right: the messaging apps Kaby answers from (kybernos-kyber's column), or the line that says why it is not there. */
        const ChannelsCard = () => {
          const k = kyberSeam()
          if (k === null) {
            return h('section', { className: 'kbpc-card', 'data-kb': 'phone-channels-off' },
              h('h2', { className: 'kbpc-h' }, h('span', null, assistantName())),
              h('p', { className: 'kbmr-sub' }, kt('Les messageries ne sont pas disponibles : le module ' + assistantName() + ' n’est pas actif.', 'Messaging apps are not available: the ' + assistantName() + ' module is not active.')))
          }
          const column = h(k.ChannelsColumn, null)
          return h('section', { className: 'kbpc-card', 'data-kb': 'phone-channels-card' }, Guard === null ? column : h(Guard, { fallback: h('p', { className: 'kbmr-sub' }, kt('Les messageries ne peuvent pas s’afficher pour l’instant.', 'Messaging apps cannot be shown right now.')) }, column))
        }
        const columns = (r, web, onSwitchServer) => h('div', { className: 'kbpc-cols', 'data-kb': 'phone-channels-cols' }, h(RemoteCard, { r, web, onSwitchServer }), h(ChannelsCard))

        const TITLE = () => kt('Téléphone et canaux', 'Phone and channels')
        // The one sentence the screen says about itself. It lives in the « ? » card (`lead`); it is drawn under the title only where the Suite's Help does not exist.
        const LEAD = () => kt('Ouvre cet ordinateur depuis ton téléphone, et joins ' + assistantName() + ' depuis tes messageries.', 'Open this computer from your phone, and reach ' + assistantName() + ' from your messaging apps.')
        // The « ? How it works » button of this bundle (the Suite publishes it; without the Suite there is none). The card it opens is
        // help.json, with the screen's own sentence first: the same card in the window and on the Settings page.
        const helpButton = () => (typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Help ? h(window.__KB_HELP__.Help, { id: 'kybernos-mobile', lead: LEAD(), title: TITLE() }) : null)
        // True where that button does not exist (no Suite): only then is the sentence drawn under the title. Read at render time, never at load.
        const helpAbsent = () => { try { return !(typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Help) } catch (e) { return true } }
        /** The page's head: its title and its « ? » through the Suite's Title (one style for every page title, the button right after the text); the bare title where the Suite is not there. */
        const pageHead = (props) => { try { if (window.__KB_HELP__ && window.__KB_HELP__.Title) return h(window.__KB_HELP__.Title, props) } catch (e) { /* the bare title below */ } return h(props.as || 'h2', { className: 'kbhp-title' + (props.className ? ' ' + props.className : '') }, props.title, props.after) }
        const PhoneIcon = () => h('svg', { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
          h('rect', { x: 3, y: 4, width: 12, height: 9, rx: 1.5 }), h('path', { d: 'M6 17h6' }), h('rect', { x: 16, y: 9, width: 5, height: 10, rx: 1.2 }))
        /** The title row, the same in both places: the mark, the name, and (window) the cross or (page) the plan chip, with the help button which carries the one sentence the
         *  screen says about itself. On the Settings page the name and the button are one head (pageHead: the page title style, the button right after the text); the window,
         *  which is no page of Settings, keeps its own title and its button in a column of the row. Only without the Suite is that sentence drawn under the title (a second
         *  grid row), so the row is one line high when the card has it. */
        const head = (o) => {
          const card = !helpAbsent()
          const page = o.page === true
          // `data-kbmob-fit` is the phone's fit script's own mark (it skips a box that already has one): the open « ? » card hangs from this grid and runs past its box, which the
          // script would read as a grid too wide for the phone and re-lay out (the title one word per line) while the card is open. The head is built for the phone already.
          return h('div', { className: 'kbpc-head' + (card ? ' kbpc-head-solo' : '') + (page ? ' kbpc-head-page' : ''), 'data-kbmob-fit': '' },
            h('span', { className: 'kbpc-ic' }, h(PhoneIcon)),
            page ? h('div', { className: 'kbpc-ttl' }, pageHead({ id: 'kybernos-mobile', lead: LEAD(), title: TITLE(), as: 'h1', className: 'kbpc-page-title' })) : h('h1', { className: 'kbpc-title', id: o.titleId }, TITLE()),
            card ? null : h('p', { className: 'kbmr-sub kbpc-lead' }, LEAD()),
            o.chip ? h('span', { className: 'kbmr-chip kbpc-chip2' }, o.chip) : null,
            page ? null : h('span', { className: 'kbpc-help' }, helpButton()),
            typeof o.onClose === 'function' ? h('button', { type: 'button', className: 'kbpc-x', 'data-kb': 'phone-channels-close', 'aria-label': kt('Fermer', 'Close'), onClick: o.onClose }, '×') : null)
        }

        /** The window the account menu opens (kybernos-cloud mounts it). Closing it withdraws a code nobody scanned; it does not withdraw one a phone is waiting on. */
        const Dialog = (props) => {
          const r = useRemote()
          const web = useWeb(props.web)
          const card = React.useRef(null)
          const latest = React.useRef(null)
          latest.current = r.s
          const closeRef = React.useRef(props.onClose)
          closeRef.current = props.onClose
          const close = () => { try { if (typeof closeRef.current === 'function') closeRef.current() } catch (e) { /* closed already */ } }
          React.useEffect(() => {
            let before = null
            try { before = document.activeElement } catch (e) { before = null }
            try { if (card.current !== null && card.current !== undefined && typeof card.current.focus === 'function') card.current.focus() } catch (e) { /* not focusable */ }
            // Captured, because DSH's own dialogs underneath also close on Escape.
            const onKey = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); close() } }
            window.addEventListener('keydown', onKey, true)
            // Anything on this screen that asks for Settings › Servers (« Switch server », here or on Telegram's row) must not leave the window over the page it opens.
            window.addEventListener('kybernos-cloud:servers', close)
            return () => {
              window.removeEventListener('keydown', onKey, true)
              window.removeEventListener('kybernos-cloud:servers', close)
              const p = latest.current !== null && latest.current !== undefined ? latest.current.pairing : null
              if (p !== null && p !== undefined && p.state !== 'verify') void api('pair/cancel', {})
              try { if (before !== null && before !== undefined && typeof before.focus === 'function') before.focus() } catch (e) { /* gone */ }
            }
          }, [])
          return h('div', { className: 'kbpc-scrim', 'data-kb': 'phone-channels-scrim', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) close() } },
            h('div', { className: 'kbpc-dialog', ref: card, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'kbpc-title', tabIndex: -1, 'data-kb': 'phone-channels' },
              head({ titleId: 'kbpc-title', onClose: close }),
              columns(r, web, () => { close(); switchServer() })))
        }

        // The window opens itself, in a React root of its own on <body>: it does not depend on the account menu, on the sidebar's footer or on the drawer the footer lives in (a fixed
        // box inside a parent that slides with a transform is placed in that parent: measured, the window sat 354 px off to the left of the screen, and it would slide away with the
        // drawer). Anyone may ask for it (the account menu's entry, Kaby's strip); one window at a time; false when this DSH offers no React root to draw it in.
        let shown = null
        const openWindow = () => {
          if (shown !== null) return true
          try {
            if (roots === null || roots === undefined || typeof roots.createRoot !== 'function' || !document.body) return false
            const node = document.createElement('div')
            node.setAttribute('data-kb', 'phone-channels-root')
            document.body.appendChild(node)
            const mine = { node, root: roots.createRoot(node) }
            shown = mine
            const onClose = () => {
              if (shown === mine) shown = null
              // Not from inside the render that asked for it: a root is taken down on the next turn.
              setTimeout(() => { try { mine.root.unmount() } catch (e) { /* gone */ } try { mine.node.remove() } catch (e) { /* gone */ } }, 0)
            }
            mine.root.render(h(Dialog, { onClose }))
            return true
          } catch (e) {
            shown = null
            try { console.warn('[kybernos-mobile] the phone and channels window could not open:', e) } catch (e2) { /* no console */ }
            return false
          }
        }

        // The animated help of the Settings page (the Suite publishes it): opens the first time the page is visited, and the card of the
        // « ? How it works » button can bring it back. The words are the ones of the real screen.
        const introNode = () => (typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Intro
          ? h(window.__KB_HELP__.Intro, {
            id: 'kybernos-mobile',
            title: kt('Relier un téléphone en trois étapes', 'Link a phone in three steps'),
            caption: kt('Le code QR est affiché sur l’ordinateur, scanné avec le téléphone, puis autorisé sur l’ordinateur.', 'The QR code is shown on the computer, scanned with the phone, then allowed on the computer.'),
            steps: [
              { t: kt('Affiche le code', 'Show the code'), b: kt('Sur l’ordinateur, ouvre le menu du compte › « Téléphone et canaux » et touche « Ajouter un téléphone » : un code QR s’affiche.', 'On the computer, open the account menu › “Phone and channels” and click “Add a phone”: a QR code appears.') },
              { t: kt('Scanne-le', 'Scan it'), b: kt('Sur le téléphone, scanne le code avec l’appareil photo et ouvre le lien : un code à 4 chiffres s’affiche.', 'On the phone, scan the code with the camera and open the link: a 4-digit code appears.') },
              { t: kt('Autorise', 'Allow'), b: kt('Sur l’ordinateur, vérifie que le code est le même et touche Autoriser : ton téléphone pilote cet ordinateur.', 'On the computer, check the code is the same and click Allow: your phone now drives this computer.') }
            ],
            mock: { bar: 'Phone and channels', rows: [kt('Cet ordinateur', 'This computer')], hot: kt('Ton téléphone', 'Your phone'), states: [kt('Pas lié', 'Not linked'), kt('Code : 4821', 'Code: 4821'), kt('Lié', 'Linked')], actions: [kt('Afficher le QR', 'Show the QR'), kt('Scan…', 'Scanning…'), kt('Autoriser', 'Allow')] }
          })
          : null)

        // Settings › Phone and channels.
        const Page = () => {
          const r = useRemote()
          const web = useWeb('')
          const planChip = r.s !== null && r.s.entitled === true ? kt('Inclus dans ton offre', 'Included in your plan') : null
          return h('div', { className: 'kbmr-page kbpc-page', 'data-kb': 'mobile-page' },
            head({ page: true, chip: planChip }),
            introNode(),
            columns(r, web, switchServer))
        }

        const CSS = `
.kbmr-page{display:flex;flex-direction:column;gap:20px;padding:0;max-width:1040px}
[data-slot="settings.section"]:has(.kbpc-page){width:100%;max-width:none}
/* The title row is a grid so that on a phone the sentence drops under the title and takes the whole width, instead of a column of five words. */
.kbpc-head{display:grid;grid-template-columns:44px minmax(0,1fr) auto auto auto;grid-template-areas:"ic ttl chip help x" "ic lead chip help x";column-gap:12px;align-items:start}
.kbpc-ic{grid-area:ic}
.kbpc-dialog .kbpc-title{grid-area:ttl;align-self:end}
.kbpc-ttl{grid-area:ttl;align-self:end;min-width:0}
.kbpc-lead{grid-area:lead}
.kbpc-chip2{grid-area:chip}
.kbpc-help{grid-area:help;display:flex}
.kbpc-x{grid-area:x}
/* The window is no page of Settings: its title keeps its own size. The page's title takes the Settings frame's (kbhp-title). */
.kbpc-dialog .kbpc-title{margin:0;font-size:20px;font-weight:650;line-height:1.25;color:var(--dsw-alias-label-primary, rgb(243,243,245))}
.kbpc-ic{flex:none;width:44px;height:44px;border-radius:12px;display:grid;place-items:center;border:1px solid var(--dsw-alias-border-l2, rgb(46,46,52));background:var(--dsw-alias-bg-layer-1, rgb(27,27,31));color:var(--dsw-alias-label-primary, rgb(243,243,245))}
.kbpc-head .kbmr-sub{margin-top:2px}
/* The sentence is in the « ? » card (Suite present): the row is one line, no empty second grid row (and no row-gap under it on a phone). The doubled class outranks the narrow rule below. */
.kbpc-head.kbpc-head-solo{grid-template-areas:"ic ttl chip help x";align-items:center}
.kbpc-head.kbpc-head-solo .kbpc-title,.kbpc-head.kbpc-head-solo .kbpc-ttl{align-self:center}
/* The page has no help column and no cross: the « ? » is inside its title. */
.kbpc-head.kbpc-head-page .kbpc-ic{box-sizing:border-box;width:30px;height:30px;border-radius:9px}
.kbpc-head.kbpc-head-page .kbpc-ic svg{width:16px;height:16px}
.kbpc-head.kbpc-head-page{grid-template-columns:30px minmax(0,1fr) auto;grid-template-areas:"ic ttl chip" "ic lead chip"}
.kbpc-head.kbpc-head-page.kbpc-head-solo{grid-template-areas:"ic ttl chip"}
@media (max-width:520px){.kbpc-head.kbpc-head-page{grid-template-columns:30px minmax(0,1fr);grid-template-areas:"ic ttl" "lead lead"}.kbpc-head.kbpc-head-page.kbpc-head-solo{grid-template-areas:"ic ttl"}}
@media (max-width:520px){.kbpc-head.kbpc-head-solo{grid-template-areas:"ic ttl help x";row-gap:0}}
.kbpc-cols{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,6fr);gap:16px;align-items:start}
@media (max-width:760px){.kbpc-cols{grid-template-columns:minmax(0,1fr)}}
.kbpc-card{display:flex;flex-direction:column;gap:14px;min-width:0;padding:16px;border-radius:14px;border:1px solid var(--dsw-alias-border-l1, rgb(46,46,52));background:var(--dsw-alias-bg-layer-2, rgb(27,27,31))}
.kbpc-h{margin:0;font-size:15px;font-weight:650;line-height:1.3;color:var(--dsw-alias-label-primary, rgb(243,243,245))}
.kbpc-h{display:flex;align-items:center;gap:8px}
.kbpc-hico{display:inline-flex;color:var(--dsw-alias-label-secondary, rgb(161,161,171))}
.kbpc-hico svg{width:18px;height:18px}
.kbpc-tag{margin-inline-start:auto;flex:none;padding:2px 9px;border-radius:999px;font-size:11.5px;font-weight:600;white-space:nowrap}
.kbpc-tag.warn{background:var(--dsw-alias-state-warn-bg, rgba(245,158,11,.18));color:color-mix(in srgb,var(--dsw-alias-state-warn-label, rgb(168,83,10)) 60%,var(--dsw-alias-label-primary, rgb(243,243,245)))}
.kbpc-tag.ok{background:var(--dsw-alias-state-success-bg, rgba(34,197,94,.16));color:color-mix(in srgb,var(--dsw-alias-state-success-primary, rgb(21,128,61)) 60%,var(--dsw-alias-label-primary, rgb(243,243,245)))}
.kbpc-swrow{display:flex;align-items:center;gap:12px}
.kbpc-swrow .kbmr-sub{flex:1;margin:0}
.kbpc-sw{position:relative;flex:none;width:36px;height:20px;padding:0;border:0;border-radius:10px;background:var(--dsw-alias-border-l3, rgba(127,127,127,.45));cursor:pointer}
.kbpc-sw::before{content:"";position:absolute;inset:-2px 0}
.kbpc-sw::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-primary-foreground, rgb(255,255,255));box-shadow:0 1px 2px rgba(0,0,0,.3);transition:left .12s ease}
.kbpc-sw[aria-checked="true"]{background:var(--dsw-alias-state-success-primary, rgb(31,157,85))}
.kbpc-sw[aria-checked="true"]::after{left:18px}
.kbpc-sw:disabled{opacity:.45;cursor:default}
.kbpc-sw:focus-visible{outline:2px solid var(--dsw-alias-brand-primary, rgb(76,110,245));outline-offset:2px}
@media (prefers-reduced-motion:reduce){.kbpc-sw::after{transition:none}}
/* « It does / It needs / Be careful »: three short lines under each block, the same on both sides of the screen. */
.kbpc-does{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 12px;padding:10px 12px;border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-label-primary, rgb(243,243,245)) 5%,transparent);font-size:12.5px;line-height:1.45;color:var(--dsw-alias-label-secondary, rgb(161,161,171))}
.kbpc-does>b{color:var(--dsw-alias-label-primary, rgb(243,243,245));font-weight:600;white-space:nowrap}
.kbpc-does span b{color:var(--dsw-alias-label-primary, rgb(243,243,245));font-weight:600}
.kbpc-state{display:flex;flex-direction:column;gap:12px;padding:12px;border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-label-primary, rgb(243,243,245)) 5%,transparent)}
.kbpc-chip{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px;border-radius:999px;font-size:12px;white-space:nowrap;border:1px solid var(--dsw-alias-border-l2, rgb(46,46,52));color:var(--dsw-alias-label-secondary, rgb(161,161,171))}
/* The text of a status chip leans toward the theme's own ink, so it reads on its tinted fill in light and in dark (measured: the bare state colours gave 2.2:1 and 4.05:1). */
.kbpc-chip.ok{border-color:transparent;background:var(--dsw-alias-state-success-bg, rgba(34,197,94,.16));color:color-mix(in srgb,var(--dsw-alias-state-success-primary, rgb(21,128,61)) 55%,var(--dsw-alias-label-primary, rgb(243,243,245)))}
.kbpc-chip.warn{border-color:transparent;background:var(--dsw-alias-state-warn-bg, rgba(245,158,11,.18));color:color-mix(in srgb,var(--dsw-alias-state-warn-label, rgb(168,83,10)) 55%,var(--dsw-alias-label-primary, rgb(243,243,245)))}
.kbpc-chip.err{border-color:transparent;background:var(--dsw-alias-state-error-bg, rgba(236,19,19,.12));color:color-mix(in srgb,var(--dsw-alias-state-error-primary, rgb(185,28,28)) 55%,var(--dsw-alias-label-primary, rgb(243,243,245)))}
.kbpc-dot{flex:none;width:7px;height:7px;border-radius:999px;background:currentColor}
.kbpc-scrim{position:fixed;inset:0;z-index:9998;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:max(16px,var(--kb-sat,env(safe-area-inset-top))) 16px 16px;background:rgba(0,0,0,.45)}
.kbpc-dialog{position:relative;width:100%;max-width:1040px;margin:auto;display:flex;flex-direction:column;gap:20px;padding:24px;border-radius:16px;border:1px solid var(--dsw-alias-border-l2, rgb(46,46,52));background:var(--dsw-alias-bg-base, rgb(21,21,23));color:var(--dsw-alias-label-primary, rgb(243,243,245));box-shadow:0 18px 50px rgba(0,0,0,.35);outline:none}
.kbpc-x{flex:none;width:32px;height:32px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary, rgb(161,161,171));font-size:20px;line-height:1;cursor:pointer}
.kbpc-x:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.22))}
.kbpc-x:focus-visible,.kbmr-btn:focus-visible,.kbmr-link:focus-visible{outline:2px solid var(--dsw-alias-brand-primary, rgb(76,110,245));outline-offset:2px}
@media (max-width:520px){.kbpc-dialog{padding:16px;border-radius:20px}.kbpc-scrim{padding:8px}.kbpc-head{grid-template-columns:44px minmax(0,1fr) auto auto;grid-template-areas:"ic ttl help x" "lead lead lead lead";row-gap:10px;align-items:center}.kbpc-chip2{display:none}}
.kbmr-sub{margin:4px 0 0;font-size:13px;line-height:1.45;color:var(--dsw-alias-label-secondary, rgb(161,161,171))}
.kbmr-h{font-size:15px;font-weight:650;color:var(--dsw-alias-label-primary, rgb(243,243,245))}
.kbmr-center{text-align:center}
.kbmr-chip{flex:none;padding:3px 10px;border:1px solid var(--dsw-alias-border-l2, rgb(46,46,52));border-radius:999px;font-size:12px;color:var(--dsw-alias-label-secondary, rgb(161,161,171))}
.kbmr-body,.kbmr-pairing,.kbmr-verify,.kbmr-paywall{display:flex;flex-direction:column;gap:12px}
.kbmr-pairing,.kbmr-verify,.kbmr-paywall{align-items:center}
.kbmr-paywall{padding:16px;border:1px solid var(--dsw-alias-border-l2, rgb(46,46,52));border-radius:14px;background:var(--dsw-alias-bg-layer-2, rgb(27,27,31))}
.kbmr-qr{width:196px;height:196px;border-radius:10px;overflow:hidden;background:white;display:flex;align-items:center;justify-content:center}
.kbmr-qr svg{display:block;width:100%;height:100%}
.kbmr-steps{margin:0;padding-left:20px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary, rgb(243,243,245));align-self:stretch}
.kbmr-row{display:flex;gap:8px;align-items:center;justify-content:center;flex-wrap:wrap}
.kbmr-start{justify-content:flex-start}
.kbmr-btn{min-height:34px;padding:6px 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2, rgb(46,46,52));background:var(--dsw-alias-bg-layer-2, rgb(35,35,40));color:var(--dsw-alias-label-primary, rgb(243,243,245));font:inherit;font-size:13px;cursor:pointer}
.kbmr-btn:disabled{opacity:.55;cursor:default}
.kbmr-primary{background:var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, rgb(240,68,55)));border-color:var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, rgb(240,68,55)));color:var(--dsw-alias-label-primary-foreground, white);font-weight:600}
.kbmr-danger{border-color:rgb(240,68,55);color:rgb(240,68,55)}
.kbmr-link{align-self:flex-start;border:0;background:transparent;padding:4px 0;color:var(--dsw-alias-label-secondary, rgb(161,161,171));font:inherit;font-size:13px;cursor:pointer;text-decoration:underline}
.kbmr-lock{display:flex;gap:8px;align-items:flex-start;font-size:12px;color:var(--dsw-alias-label-secondary, rgb(161,161,171))}
.kbmr-lock svg{flex:none;margin-top:2px}
.kbmr-sas{font-size:40px;font-weight:700;letter-spacing:.2em;padding-left:.2em;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary, rgb(243,243,245))}
.kbmr-error{padding:8px 12px;border-radius:8px;border:1px solid rgb(240,68,55);color:var(--dsw-alias-label-primary, rgb(243,243,245));font-size:13px}
.kbmr-error .kbmr-link{display:block;margin-top:4px}
.kbmr-section{display:flex;flex-direction:column;gap:10px}
.kbmr-sech{display:flex;gap:10px;align-items:center;justify-content:space-between;font-weight:650;font-size:14px;color:var(--dsw-alias-label-primary, rgb(243,243,245))}
.kbmr-inline{display:inline-flex;gap:6px;align-items:center;margin:0;font-weight:400}
.kbmr-devices{border:1px solid var(--dsw-alias-border-l2, rgb(46,46,52));border-radius:12px;background:var(--dsw-alias-bg-layer-1, rgb(27,27,31))}
.kbmr-device{display:flex;gap:12px;align-items:center;padding:10px 14px}
.kbmr-device+.kbmr-device{border-top:1px solid var(--dsw-alias-border-l2, rgb(46,46,52))}
.kbmr-devtxt{flex:1;min-width:0}
.kbmr-devname{font-weight:600;color:var(--dsw-alias-label-primary, rgb(243,243,245));overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbmr-dot{flex:none;width:8px;height:8px;border-radius:999px;background:rgb(112,112,122)}
.kbmr-dot.on{background:rgb(74,222,128)}
.kbmr-lockbox{color:var(--dsw-alias-label-secondary, rgb(161,161,171))}
.kbmr-paywall .kbmr-sub{text-align:center;max-width:440px}
`
        return { Dialog, Page, CSS, open: openWindow }
      }

      // ── Report an AI answer (store rules: kybernos-host/STORES.md item 4) ──
      // A small « Report » control under each finished answer, inside the app only. It reuses the feedback box of the core plugin: the report is SAVED on the phone first (POST /kybernos/feedback),
      // then SENT to the Kybernos team through the signed-in account's relay (POST /kybernos/feedback/send). When it cannot be sent (signed out, no network) the person is told so and offered the
      // e-mail route: the report never silently stays on the phone. The answer's text is added ONLY when the person ticks the box, and what goes is what the box shows (editable).
      const REPORT_REASONS = [
        { id: 'offensive', en: 'Offensive or inappropriate', fr: 'Choquante ou inappropriée' },
        { id: 'dangerous', en: 'Dangerous or harmful', fr: 'Dangereuse ou nuisible' },
        { id: 'wrong', en: 'Wrong or misleading', fr: 'Fausse ou trompeuse' },
        { id: 'other', en: 'Something else', fr: 'Autre chose' },
      ]
      const REPORT_EXCERPT_MAX = 1500
      const REPORT_COMMENT_MAX = 1000
      // The one address the owner gave for the product (packages/kybernos-plugin/test-feedback-form.mjs: none is invented).
      const REPORT_CONTACT = 'contact@kybernos.app'
      /** The report's text, in English whatever the screen's language (the team reads it): reason, optional reference, optional comment, optional excerpt. */
      const reportMessage = (r) => {
        const reason = REPORT_REASONS.find((x) => x.id === r.reason)
        const lines = ['[AI answer report] Reason: ' + (reason !== undefined ? reason.en : 'Something else')]
        if (typeof r.ref === 'string' && r.ref !== '') lines.push('Reference: ' + r.ref)
        const comment = typeof r.comment === 'string' ? r.comment.trim().slice(0, REPORT_COMMENT_MAX) : ''
        if (comment !== '') lines.push('', 'Comment: ' + comment)
        const excerpt = typeof r.excerpt === 'string' ? r.excerpt.trim().slice(0, REPORT_EXCERPT_MAX) : ''
        if (excerpt !== '') lines.push('', 'Answer excerpt (added by the sender):', excerpt)
        return lines.join('\n')
      }
      /** A first guess of the answer a node follows: the nearest block of text before it, looking at its previous siblings and then up through its parents (the interface draws the answer as an earlier
       *  sibling of the turn's tail, a few levels up; measured on the simulator: 5). The first REPORT_EXCERPT_MAX characters of that block. The person reads and edits it before anything is sent. */
      const textBefore = (node) => {
        let el = node
        for (let up = 0; up < 8 && el !== null && el !== undefined; up++) {
          let sib = el.previousElementSibling
          while (sib !== null && sib !== undefined) {
            const t = String(sib.innerText !== undefined ? sib.innerText : (sib.textContent || '')).trim()
            if (t !== '') return t.slice(0, REPORT_EXCERPT_MAX)
            sib = sib.previousElementSibling
          }
          el = el.parentElement
        }
        return ''
      }
      /** Save, then send. `post(path, body)` answers `{ status, out }` (status 0 when there was no answer). `sent`: the team has it. `saved`: kept on the phone, `why` says why it did not go. `failed`: not even kept. */
      const submitReport = async (message, post) => {
        const body = { type: 'bug', message }
        const saved = await post('/kybernos/feedback', body)
        if (!(saved.status === 200 && saved.out !== null && typeof saved.out === 'object' && saved.out.ok === true)) return { state: 'failed', code: saved.status + (saved.out !== null && typeof saved.out === 'object' && typeof saved.out.error === 'string' ? ' ' + saved.out.error.slice(0, 60) : '') }
        const sent = await post('/kybernos/feedback/send', body)
        if (sent.status === 200 && sent.out !== null && typeof sent.out === 'object' && sent.out.ok === true) return { state: 'sent' }
        const code = sent.out !== null && typeof sent.out === 'object' && typeof sent.out.error === 'string' ? sent.out.error : ''
        const signedOut = code === 'non_connecte' || code === 'reconnexion_requise' || sent.status === 401 || sent.status === 403 || sent.status === 503
        return { state: 'saved', why: signedOut ? 'signedout' : 'net' }
      }
      const reportMailto = (message) => 'mailto:' + REPORT_CONTACT + '?subject=' + encodeURIComponent('AI answer report') + '&body=' + encodeURIComponent(String(message).slice(0, 1800))

      /** Files a part under « About » (the maintenance bundle draws it: `window.__KB_ABOUT_EXTRA__`, event `kb-about-extra`; see its README). Load order is not promised, so the list is made here when this comes first; an entry with the same id is replaced. Returns the way to take it back. Never throws. */
      const aboutAdd = (entry) => {
        const tell = () => { try { window.dispatchEvent(new Event('kb-about-extra')) } catch (e) { /* no window events */ } }
        try {
          if (!Array.isArray(window.__KB_ABOUT_EXTRA__)) window.__KB_ABOUT_EXTRA__ = []
          const list = window.__KB_ABOUT_EXTRA__
          for (let i = list.length - 1; i >= 0; i--) { if (list[i] !== null && typeof list[i] === 'object' && list[i].id === entry.id) list.splice(i, 1) }
          list.push(entry)
          tell()
          return () => { try { const l = window.__KB_ABOUT_EXTRA__; const i = Array.isArray(l) ? l.indexOf(entry) : -1; if (i >= 0) l.splice(i, 1); tell() } catch (e) { /* gone */ } }
        } catch (e) { return () => {} }
      }
      // ── « The Kybernos app » page: what only the app can do (its secure model key, its engine log) and what a phone changes for automations ──
      // The app's WebView catches `kybernos://settings` and `kybernos://log` and opens its own screens; this page is the way in from the interface. It keeps the section id of the phone link
      // (`kybernos-mobile`): the Settings organiser files that id under « Devices & cloud », and the page it replaces never exists in the same place.
      const buildAppUi = (React, host) => {
        const h = React.createElement
        const open = (what) => { try { window.location.assign('kybernos://' + what) } catch (e) { /* the app handles the link; nothing to do without it */ } }
        // read at each draw: the language is not known yet when this is built, and « iPhone or iPad » sat in the middle of a French sentence
        const where = () => (host.platform === 'ios' ? kt('iPhone ou iPad', 'iPhone or iPad') : kt('Android', 'Android'))
        const Card = (props) => h('section', { className: 'kbapp-card', 'data-kb': props.kb },
          h('h3', { className: 'kbapp-h' }, props.title),
          h('p', { className: 'kbapp-sub' }, props.text),
          props.act === undefined ? null : h('div', { className: 'kbapp-row' }, h('button', { type: 'button', className: 'kbapp-btn', 'data-act': props.act, onClick: props.onClick }, props.button)))
        // The list of open-source components the app is made of (served by the host half from the payload; absent in a build that did not write it).
        const Notices = () => {
          const [st, setSt] = React.useState({ phase: 'closed', text: '' })
          const load = async () => {
            setSt({ phase: 'loading', text: '' })
            try { const r = await fetch('/kybernos-mobile/notices'); const t = r.ok ? await r.text() : ''; setSt(t === '' ? { phase: 'missing', text: '' } : { phase: 'open', text: t }) } catch (e) { setSt({ phase: 'missing', text: '' }) }
          }
          return h('section', { className: 'kbapp-card', 'data-kb': 'mobile-app-notices' },
            h('h3', { className: 'kbapp-h' }, kt('Composants open source', 'Open-source components')),
            h('p', { className: 'kbapp-sub' }, kt('Les licences de tout ce dont cette app est faite.', 'The licences of everything this app is made of.')),
            h('div', { className: 'kbapp-row' }, h('button', { type: 'button', className: 'kbapp-btn', 'data-act': 'open-notices', onClick: st.phase === 'open' ? () => setSt({ phase: 'closed', text: '' }) : load }, st.phase === 'open' ? kt('Masquer', 'Hide') : kt('Afficher', 'Show'))),
            st.phase === 'missing' ? h('p', { className: 'kbapp-sub', 'data-kb': 'notices-missing' }, kt('La liste n’est pas disponible dans cette version.', 'The list is not available in this build.')) : null,
            st.phase === 'open' ? h('pre', { className: 'kbapp-notices', 'data-kb': 'notices-text' }, st.text) : null)
        }
        // « Simple mode »: the line that asks the shell to switch to Simple (the app's other mode: one conversation with Kaby and a few settings). Drawn only when the user agent lists `mode`
        // (contract §9): a shell that cannot switch has no such line. The display seam keeps the choice with the account, then asks the shell, which reloads the page in the other mode: the button only says it is working.
        const ModeCard = () => {
          const [busy, setBusy] = React.useState(false)
          return h('section', { className: 'kbapp-card', 'data-kb': 'mobile-mode-switch' },
            h('h3', { className: 'kbapp-h' }, kt('Mode Simple', 'Simple mode')),
            h('p', { className: 'kbapp-sub' }, kt('Une seule conversation avec Kaby et quelques réglages, sans rien de technique. Tu peux revenir ici quand tu veux : tes conversations et ta mémoire restent les mêmes.', 'One conversation with Kaby and a few settings, nothing technical. You can come back here whenever you want: your conversations and your memory stay the same.')),
            h('div', { className: 'kbapp-row' }, h('button', { type: 'button', className: 'kbapp-btn', 'data-act': 'mode-simple', disabled: busy, onClick: () => { const seam = window.__KB_MODE__; if (seam !== undefined && seam !== null && typeof seam.set === 'function') { setBusy(true); seam.set('simple') } else if (shellPost(KABY_OUT.mode, { mode: 'simple' })) setBusy(true) } }, busy ? kt('Changement de mode…', 'Switching mode…') : kt('Passer en Simple', 'Switch to Simple'))))
        }
        // `simple` (Kaby mode): the parts of the app, in Simple's About. The line that switches to Simple makes no sense there, so `lead` (what Simple supplies: Kaby's own sections) is drawn in its place.
        // `embedded` (Simple): the same content drawn INSIDE « About » (the Settings page is gone from the list; `aboutAdd` files this under About): no title of its own, the page's own is About.
        const Page = (props) => h('div', { className: 'kbapp-page', 'data-kb': props !== undefined && props !== null && props.embedded === true ? 'mobile-app-about' : 'mobile-app-page' },
          props !== undefined && props !== null && props.embedded === true ? null : h('h2', { className: 'kbapp-title' }, kt('L’app Kybernos', 'The Kybernos app')),
          h('p', { className: 'kbapp-sub' }, kt('Le moteur de Kybernos tourne sur ce téléphone, dans l’app. Version ' + host.version + ' · ' + where() + '.', 'The Kybernos engine runs on this phone, inside the app. Version ' + host.version + ' · ' + where() + '.')),
          props !== undefined && props !== null && props.simple === true ? props.lead : (caps().indexOf('mode') >= 0 ? h(ModeCard, null) : null),
          // The model key is bring-your-own-key (the person's own Anthropic key): in Simple the models come from Kybernos Models, so the key card has no use there (owner, 2026-11-22). The full app on a phone keeps it.
          // But the card's button is ALSO the only way from the Simple page to the app's own Settings screen (language, the agreement, models on this phone, the account server: `kybernos://settings`), now that the
          // shell's floating gear is gone in Simple (native request, PAGE-REQUESTS.md §2): in Simple ONE row replaces it, with no word of a key.
          props !== undefined && props !== null && props.simple === true ? h(Card, { kb: 'mobile-app-settings', title: kt('Réglages de l’app', 'App settings'), text: kt('Les réglages de l’app elle-même, que ce menu n’a pas : langue, accord d’utilisation, modèles sur ce téléphone, serveur du compte.', 'The settings of the app itself, which this menu does not have: language, the agreement, models on this phone, the account server.'), act: 'open-app-settings', button: kt('Ouvrir', 'Open'), onClick: () => open('settings') }) : h(Card, { kb: 'mobile-app-key', title: kt('Clé du modèle', 'Model key'), text: kt('Ta clé Anthropic est gardée dans le coffre sécurisé du téléphone (Trousseau sur iPhone, Keystore sur Android), jamais dans un fichier. Un changement de clé demande de fermer puis rouvrir l’app.', 'Your Anthropic key is kept in the phone’s secure storage (Keychain on iPhone, Keystore on Android), never in a file. A changed key needs the app closed and opened again.'), act: 'open-key', button: kt('Ouvrir', 'Open'), onClick: () => open('settings') }),
          props !== undefined && props !== null && props.simple === true && presetAppPage().log === false ? null : h(Card, { kb: 'mobile-app-log', title: kt('Journal du moteur', 'Engine log'), text: kt('Ce que dit le moteur, avec les clés masquées : utile pour comprendre un souci ou le partager.', 'What the engine says, with keys hidden: useful to understand a problem or to share it.'), act: 'open-log', button: kt('Afficher', 'Show'), onClick: () => open('log') }),
          h(Notices, null),
          h(Card, { kb: 'mobile-app-auto', title: kt('Automatisations sur le téléphone', 'Automations on this phone'), text: kt('Elles tournent pendant que l’app est ouverte ou vient d’être utilisée. Si le téléphone a suspendu l’app, une tâche arrivée à échéance attend et s’exécute dès que tu reviens. Pour une tâche à heure fixe, téléphone verrouillé, utilise un ordinateur cloud.', 'They run while the app is open or was just used. If the phone has suspended the app, a task that came due waits and runs as soon as you come back. For a task at a fixed time with the phone locked, use a cloud computer.') }))
        // Purchase, sign-up and plugin-install controls the app never shows (store rules: no purchase flow inside the app, no sign-up in the first version, only the plugins the app carries; kybernos-host/STORES.md items 1, 5 and 6). They are hidden by their
        // data-kb hooks, not removed: the desktop and the browser keep them. test-client.mjs checks every hook still exists in the bundle that draws it.
        const STORE_HIDDEN = ['menu-signup', 'menu-plans', 'menu-plan-cta', 'menu-plan-credits', 'upgrade-dialog', 'team-lock-plans', 'provider-plans', 'kc-pro-plans', 'kybernos-kyber-upgrade', 'plugins-add', 'plugins-add-empty', 'plugins-drafts']
        // The control under each finished answer. State is local; nothing leaves the phone until « Send ».
        const ReportTail = (props) => {
          const rootRef = React.useRef(null)
          const [open, setOpen] = React.useState(false)
          const [reason, setReason] = React.useState('')
          const [comment, setComment] = React.useState('')
          const [withText, setWithText] = React.useState(false)
          const [excerpt, setExcerpt] = React.useState('')
          const [phase, setPhase] = React.useState('form')
          const [why, setWhy] = React.useState('')
          const [message, setMessage] = React.useState('')
          const sid = props !== null && props !== undefined && typeof props.sessionId === 'string' ? props.sessionId : ''
          // In the help card of Simple the control is not under an answer: it says so in words (« Report an answer »), where the phone's CSS turns the one under an answer into a flag
          const labelled = props !== null && props !== undefined && props.labelled === true
          const openWords = labelled ? kt('Signaler une réponse', 'Report an answer') : kt('Signaler cette réponse', 'Report this answer')
          const seq = props !== null && props !== undefined && typeof props.seq === 'number' ? props.seq : null
          const ref = sid === '' ? '' : 'session ' + sid + (seq !== null ? ', turn ' + seq : '')
          const toggleText = (on) => {
            setWithText(on)
            if (on && excerpt === '') { try { setExcerpt(textBefore(rootRef.current)) } catch (e) { setExcerpt('') } }
          }
          const post = async (path, body) => {
            try {
              const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
              let out = null
              try { out = await r.json() } catch (e) { out = null }
              return { status: r.status, out }
            } catch (e) { return { status: 0, out: null } }
          }
          const send = async () => {
            const text = reportMessage({ reason, comment, excerpt: withText ? excerpt : '', ref })
            setMessage(text); setPhase('sending')
            const r = await submitReport(text, post)
            setWhy(r.why !== undefined ? r.why : (r.code !== undefined ? r.code : '')); setPhase(r.state)
          }
          const reset = () => { setOpen(false); setPhase('form'); setReason(''); setComment(''); setWithText(false); setExcerpt(''); setWhy('') }
          const mail = () => { try { window.location.assign(reportMailto(message)) } catch (e) { /* the app opens the mail composer */ } }
          const field = (kb, node) => h('div', { className: 'kbrp-field', 'data-kb': kb }, node)
          let body = null
          if (open && phase === 'form') {
            body = h('div', { className: 'kbrp-card', 'data-kb': 'report-form', role: 'group', 'aria-label': kt('Signaler cette réponse', 'Report this answer') },
              h('p', { className: 'kbrp-h' }, kt('Signaler cette réponse', 'Report this answer')),
              h('div', { className: 'kbrp-reasons', role: 'radiogroup' }, REPORT_REASONS.map((x) => h('label', { key: x.id, className: 'kbrp-radio' },
                h('input', { type: 'radio', name: 'kbrp-reason', value: x.id, checked: reason === x.id, 'data-act': 'report-reason-' + x.id, onChange: () => setReason(x.id) }), h('span', null, kt(x.fr, x.en))))),
              field('report-comment', h('textarea', { className: 'kbrp-text', rows: 2, maxLength: REPORT_COMMENT_MAX, value: comment, placeholder: kt('Un mot de plus (facultatif)', 'Anything to add (optional)'), onChange: (e) => setComment(e.target.value) })),
              props !== null && props !== undefined && props.noText === true ? null : h('label', { className: 'kbrp-radio' },
                h('input', { type: 'checkbox', checked: withText, 'data-act': 'report-include', onChange: (e) => toggleText(e.target.checked === true) }), h('span', null, kt('Joindre le texte de la réponse', 'Include the answer’s text'))),
              withText ? field('report-excerpt', h('textarea', { className: 'kbrp-text', rows: 5, maxLength: REPORT_EXCERPT_MAX, value: excerpt, onChange: (e) => setExcerpt(e.target.value), 'aria-label': kt('Texte joint, modifiable', 'Text that will be sent, editable') })) : null,
              h('p', { className: 'kbrp-note' }, kt('Le signalement est gardé sur ce téléphone, puis envoyé à l’équipe Kybernos si tu es connecté. Rien d’autre n’est joint.', 'The report is kept on this phone, then sent to the Kybernos team if you are signed in. Nothing else is attached.')),
              h('div', { className: 'kbrp-row' },
                h('button', { type: 'button', className: 'kbrp-btn kbrp-primary', 'data-act': 'report-send', disabled: reason === '', onClick: send }, kt('Envoyer', 'Send')),
                h('button', { type: 'button', className: 'kbrp-btn', 'data-act': 'report-cancel', onClick: reset }, kt('Annuler', 'Cancel'))))
          } else if (open && phase === 'sending') {
            body = h('div', { className: 'kbrp-card', 'data-kb': 'report-sending', role: 'status' }, h('p', { className: 'kbrp-note' }, kt('Envoi…', 'Sending…')))
          } else if (open && phase === 'sent') {
            body = h('div', { className: 'kbrp-card', 'data-kb': 'report-sent', role: 'status' }, h('p', { className: 'kbrp-h' }, kt('Merci, c’est envoyé à l’équipe Kybernos.', 'Thank you, it was sent to the Kybernos team.')),
              h('div', { className: 'kbrp-row' }, h('button', { type: 'button', className: 'kbrp-btn', 'data-act': 'report-done', onClick: reset }, kt('Fermer', 'Close'))))
          } else if (open && phase === 'saved') {
            body = h('div', { className: 'kbrp-card', 'data-kb': 'report-saved', role: 'status' },
              h('p', { className: 'kbrp-h' }, kt('Gardé sur ce téléphone, pas encore envoyé.', 'Kept on this phone, not sent yet.')),
              h('p', { className: 'kbrp-note' }, why === 'signedout'
                ? kt('Tu n’es pas connecté à Kybernos : tu peux l’envoyer par e-mail à ' + REPORT_CONTACT + '.', 'You are not signed in to Kybernos: you can send it by e-mail to ' + REPORT_CONTACT + '.')
                : kt('Le réseau n’a pas répondu : tu peux l’envoyer par e-mail à ' + REPORT_CONTACT + '.', 'The network did not answer: you can send it by e-mail to ' + REPORT_CONTACT + '.')),
              h('div', { className: 'kbrp-row' },
                h('button', { type: 'button', className: 'kbrp-btn kbrp-primary', 'data-act': 'report-mail', onClick: mail }, kt('Envoyer par e-mail', 'Send by e-mail')),
                h('button', { type: 'button', className: 'kbrp-btn', 'data-act': 'report-done', onClick: reset }, kt('Fermer', 'Close'))))
          } else if (open && phase === 'failed') {
            body = h('div', { className: 'kbrp-card', 'data-kb': 'report-failed', role: 'alert' },
              h('p', { className: 'kbrp-h' }, kt('Le signalement n’a pas pu être gardé.', 'The report could not be kept.')),
              h('p', { className: 'kbrp-note' }, kt('Tu peux l’envoyer par e-mail à ' + REPORT_CONTACT + '.', 'You can send it by e-mail to ' + REPORT_CONTACT + '.') + (why !== '' ? ' (' + why + ')' : '')),
              h('div', { className: 'kbrp-row' },
                h('button', { type: 'button', className: 'kbrp-btn kbrp-primary', 'data-act': 'report-mail', onClick: mail }, kt('Envoyer par e-mail', 'Send by e-mail')),
                h('button', { type: 'button', className: 'kbrp-btn', 'data-act': 'report-done', onClick: reset }, kt('Fermer', 'Close'))))
          }
          return h('div', { className: 'kbrp', 'data-kb': 'report-tail', ref: rootRef },
            open ? null : h('button', { type: 'button', className: 'kbrp-open', 'data-act': 'report-open', title: openWords, 'aria-label': openWords, onClick: () => setOpen(true) }, labelled ? openWords : kt('Signaler', 'Report')),
            body)
        }
        const CSS = `
html.kb-app :is(${STORE_HIDDEN.map((k) => '[data-kb="' + k + '"]').join(',')}){display:none !important}
.kbrp{display:flex;flex-direction:column;align-items:flex-start;gap:8px;margin:2px 0 6px}
.kbrp-open,.kbrp-radio,.kbrp-btn,.kbrp-h{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
.kbrp-open{min-height:32px;padding:4px 10px;border:0;background:transparent;font:inherit;font-size:12px;color:var(--dsw-alias-label-tertiary, rgb(130,130,140));text-decoration:underline;text-underline-offset:3px}
.kbrp-card{display:flex;flex-direction:column;gap:10px;width:100%;box-sizing:border-box;padding:14px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2, rgb(46,46,52));background:var(--dsw-alias-bg-layer-2, rgb(27,27,31))}
.kbrp-h{margin:0;font-size:14px;font-weight:650;color:var(--dsw-alias-label-primary, rgb(243,243,245))}
.kbrp-note{margin:0;font-size:12px;line-height:1.45;color:var(--dsw-alias-label-secondary, rgb(161,161,171))}
.kbrp-reasons{display:flex;flex-direction:column}
.kbrp-radio{display:flex;gap:10px;align-items:center;min-height:44px;font-size:14px;color:var(--dsw-alias-label-primary, rgb(243,243,245))}
.kbrp-radio input{width:20px;height:20px;flex:none;margin:0}
.kbrp-text{width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2, rgb(46,46,52));background:var(--dsw-alias-bg-layer-1, rgb(18,18,23));color:var(--dsw-alias-label-primary, rgb(243,243,245));font:inherit;font-size:16px;resize:vertical}
.kbrp-row{display:flex;gap:8px;flex-wrap:wrap}
.kbrp-btn{min-height:44px;padding:8px 18px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2, rgb(46,46,52));background:var(--dsw-alias-bg-layer-2, rgb(35,35,40));color:var(--dsw-alias-label-primary, rgb(243,243,245));font:inherit;font-size:14px}
.kbrp-primary{background:var(--dsw-alias-label-primary, rgb(243,243,245));color:var(--dsw-alias-bg-layer-1, rgb(18,18,23));font-weight:600}
.kbrp-btn:disabled{opacity:.4}
.kbapp-page{display:flex;flex-direction:column;gap:14px;max-width:640px}
.kbapp-notices{margin:8px 0 0;max-height:50vh;overflow:auto;white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.45;color:var(--dsw-alias-label-secondary, rgb(161,161,171))}
.kbapp-title{margin:0;font-size:20px;font-weight:650;line-height:1.25;color:var(--dsw-alias-label-primary, rgb(243,243,245))}
.kbapp-sub{margin:0;font-size:13px;line-height:1.45;color:var(--dsw-alias-label-secondary, rgb(161,161,171))}
.kbapp-card{display:flex;flex-direction:column;gap:8px;min-width:0;padding:16px;border-radius:14px;border:1px solid var(--dsw-alias-border-l1, rgb(46,46,52));background:var(--dsw-alias-bg-layer-2, rgb(27,27,31))}
.kbapp-h{margin:0;font-size:15px;font-weight:650;line-height:1.3;color:var(--dsw-alias-label-primary, rgb(243,243,245))}
.kbapp-row{display:flex;gap:8px;flex-wrap:wrap}
.kbapp-btn{min-height:44px;padding:8px 18px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2, rgb(46,46,52));background:var(--dsw-alias-bg-layer-2, rgb(35,35,40));color:var(--dsw-alias-label-primary, rgb(243,243,245));font:inherit;font-size:14px;cursor:pointer}
.kbapp-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary, rgb(76,110,245));outline-offset:2px}
[data-slot="settings.section"]:has(.kbapp-page){width:100%;max-width:none}
`
        return { Page, CSS, open, STORE_HIDDEN, ReportTail }
      }


      // ═══ The display mode: Auto, Simple, Complete (owner's list items 35, 36, 37; mode.mjs says it all) ═════════════════════════════════
      // ONE mode with two effects (the navigation preset and the technical view), resolved once per load in the page head (`kb-simple` on <html>, `data-kb-mode`), kept per ACCOUNT by the host
      // (`/kybernos-mobile/mode`, written here) with a copy in this page's storage. This block is the seam other bundles read (`window.__KB_MODE__`) and the two places this bundle draws it: the
      // segment at the foot of the phone's drawer and the sheet « Display » (the account menu's row opens it, so does the ⌘K palette). The resolver below is a marked copy of mode.mjs `bootMode`
      // (a page that refuses the head's inline script still gets its mode; test-mode.mjs keeps the two texts equal).
      // <kb-mode>
      // <kb-mode-boot>
      const bootMode = function (w) {
        var out = { mode: 'complete', pref: 'auto', source: 'default' }
        try {
          var root = w.document.documentElement
          var ua = String(w.navigator.userAgent || '')
          var doc = null
          try { doc = JSON.parse(w.localStorage.getItem('kybernos.mode.v1') || 'null') } catch (e) { doc = null }
          // the account's choice, put in the head by the host (the page's own storage may be empty: the phone's engine changes its port, so its origin, at every start); the newer of the two wins
          var host = w.__KB_MODE_HOST__
          if (host !== null && typeof host === 'object' && typeof host.pref === 'string' && !(doc !== null && typeof doc === 'object' && typeof doc.pref === 'string' && Number(doc.at) > Number(host.at))) doc = host
          var pref = doc !== null && typeof doc === 'object' && typeof doc.pref === 'string' ? doc.pref.toLowerCase() : 'auto'
          if (pref === 'advanced') pref = 'complete'
          if (pref !== 'simple' && pref !== 'complete') pref = 'auto'
          out.pref = pref
          var app = /KybernosHost\/[0-9][0-9A-Za-z.+-]* \((?:ios|android)\)/.test(ua)
          var shellSimple = /KybernosHost\/[0-9][0-9A-Za-z.+-]* \((?:ios|android)\) KabyMode\/[1-9]/.test(ua)
          var touch = false
          try { touch = w.navigator.maxTouchPoints > 0 && w.matchMedia('(pointer: coarse)').matches === true } catch (e) { touch = false }
          if (pref !== 'auto') { out.mode = pref; out.source = 'choice' } else if (app) { out.mode = shellSimple ? 'simple' : 'complete'; out.source = 'shell' } else if (touch) { out.mode = 'simple'; out.source = 'touch' }
          if (out.mode === 'simple') root.classList.add('kb-simple'); else root.classList.remove('kb-simple')
          root.setAttribute('data-kb-mode', out.mode)
          root.setAttribute('data-kb-mode-pref', out.pref)
          root.setAttribute('data-kb-mode-source', out.source)
        } catch (e) { /* a page with no storage or no document keeps the full app */ }
        return out
      }
      // </kb-mode-boot>
      const MODE_STORE_KEY = 'kybernos.mode.v1'
      const MODE_PATH = '/kybernos-mobile/mode'
      const MODE_PREFS = Object.freeze(['auto', 'simple', 'complete'])
      const MODE_WORD = (v) => { const w = typeof v === 'string' ? v.trim().toLowerCase() : ''; const x = w === 'advanced' ? 'complete' : w; return MODE_PREFS.indexOf(x) >= 0 ? x : null }
      /** What the person reads, in the page's language: the name of a choice and the line under it. */
      const modeText = (id) => ({
        display: kt('Affichage', 'Display'),
        auto: kt('Auto', 'Auto'), simple: kt('Simple', 'Simple'), complete: kt('Complet', 'Complete'),
        autoSub: kt('Simple sur un téléphone tactile, Complet ailleurs.', 'Simple on a touch phone, Complete elsewhere.'),
        simpleSub: kt('Menu court, étapes repliées.', 'Short menu, folded steps.'),
        completeSub: kt('Menu complet, toutes les étapes.', 'Full menu, all steps.'),
        now: (m) => kt('Actuellement : ', 'Currently: ') + (m === 'simple' ? kt('Simple', 'Simple') : kt('Complet', 'Complete')),
        note: kt('Changer de mode ne fait rien perdre.', 'Switching modes loses nothing.'),
        reloading: kt('Rechargement…', 'Reloading…')
      })[id]
      /**
       * The seam. `win` is the window; `hooks` = `{ shellMode(mode) -> true when the shell took it and will reload by itself, reload() }`. Every method answers and none throws.
       *   state()      `{ pref, mode, source, busy }`: what the person chose, what the page is, why (choice, shell, touch, default), and whether a change is being made
       *   set(pref)    keeps the choice (the page's copy at once, the host's right after), tells the shell when it can switch (it reloads its WebView), else reloads the page; a choice that
       *                leaves the mode as it is changes nothing on screen but the choice. Resolves true when the choice was taken.
       *   subscribe()  `fn` is called when the state moves; returns what stops it
       * The page also hears `kb-mode-change` (a window event) when the state moves.
       */
      const buildModeSeam = (win, hooks) => {
        /** A timer that never keeps a process alive on its own (a page has no such thing; a test harness does). */
        const later = (fn, ms) => { const h = setTimeout(fn, ms); try { if (h !== null && typeof h === 'object' && typeof h.unref === 'function') h.unref() } catch (e) { /* a number */ } return h }
        const subs = new Set()
        let busy = false
        const root = () => { try { return win.document.documentElement } catch (e) { return null } }
        const attr = (name) => { try { return root().getAttribute(name) } catch (e) { return null } }
        const read = () => {
          let mode = attr('data-kb-mode')
          if (mode !== 'simple' && mode !== 'complete') { const r = bootMode(win); return { pref: r.pref, mode: r.mode, source: r.source, busy } }
          const pref = MODE_WORD(attr('data-kb-mode-pref')) || 'auto'
          const source = attr('data-kb-mode-source') || 'default'
          return { pref, mode, source, busy }
        }
        const emit = () => {
          for (const f of Array.from(subs)) { try { f() } catch (e) { /* a listener failed: the others still hear */ } }
          try { win.dispatchEvent(new win.CustomEvent('kb-mode-change')) } catch (e) { /* no events */ }
        }
        /** What the resolver would answer for `pref` on this page, without touching it (the same function, on a shim whose <html> is a throw-away). */
        const wouldBe = (pref) => {
          const attrs = new Map()
          const shim = {
            document: { documentElement: { classList: { add () {}, remove () {} }, setAttribute: (k, v) => attrs.set(k, v) } },
            navigator: win.navigator, matchMedia: (q) => win.matchMedia(q),
            localStorage: { getItem: () => JSON.stringify({ v: 1, pref, at: Number.MAX_SAFE_INTEGER }) }
          }
          return bootMode(shim)
        }
        /** The word the shell keeps for this choice: its own « advanced » is our Complete. Auto is what Auto means on THIS device. */
        const shellWord = (pref) => (wouldBe(pref).mode === 'simple' ? 'simple' : 'advanced')
        const set = (value) => {
          const pref = MODE_WORD(value)
          if (pref === null || busy) return Promise.resolve(false)
          const before = read()
          const after = wouldBe(pref)
          const at = Date.now()
          try { win.localStorage.setItem(MODE_STORE_KEY, JSON.stringify({ v: 1, pref, at })) } catch (e) { /* the host's copy still keeps it */ }
          busy = true
          emit()
          let post = Promise.resolve(null)
          try {
            post = Promise.resolve(win.fetch(MODE_PATH, { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ pref, at }), keepalive: true })).catch(() => null)
          } catch (e) { post = Promise.resolve(null) }
          let waitTimer = null
          const wait = Promise.race([post, new Promise((r) => { waitTimer = later(r, 1500) })])
          return wait.then(() => {
            try { clearTimeout(waitTimer) } catch (e) { /* gone */ }
            if (after.mode === before.mode) {
              // nothing to reload: the same mode, another word for it (Auto → Simple on a phone that is already Simple)
              try { const r = root(); r.setAttribute('data-kb-mode-pref', pref); r.setAttribute('data-kb-mode-source', after.source) } catch (e) { /* no root */ }
              busy = false
              emit()
              try { hooks.shellMode(shellWord(pref)) } catch (e) { /* the shell keeps its own word */ }
              return true
            }
            let taken = false
            try { taken = hooks.shellMode(shellWord(pref)) === true } catch (e) { taken = false }
            // the shell rebuilds its WebView; when it cannot (or is not there) the page reloads itself
            if (!taken) { try { hooks.reload() } catch (e) { /* the next load */ } } else later(() => { try { hooks.reload() } catch (e) { /* the next load */ } }, 6000)
            return true
          })
        }
        return Object.freeze({
          v: 1, state: read, set, subscribe: (fn) => { subs.add(fn); return () => { subs.delete(fn) } }, wouldBe,
          openSheet: () => { try { return typeof hooks.openSheet === 'function' ? hooks.openSheet() : false } catch (e) { return false } }
        })
      }
      /** The three buttons of the segment (the drawer's foot): a group whose pressed button is the person's choice. The seam moves them; a tap asks the seam. */
      const buildModeSegment = (doc, seam) => {
        const el = doc.createElement('div')
        el.className = 'kbmob-modeseg'
        el.setAttribute('role', 'group')
        el.setAttribute('data-kb', 'mode-segment')
        const buttons = MODE_PREFS.map((id) => {
          const b = doc.createElement('button')
          b.type = 'button'
          b.setAttribute('data-act', 'mode-' + id)
          b.addEventListener('click', (e) => { try { e.stopPropagation() } catch (err) { /* synthetic */ } seam.set(id) })
          el.appendChild(b)
          return b
        })
        const sync = () => {
          const s = seam.state()
          el.setAttribute('aria-label', modeText('display'))
          el.setAttribute('aria-busy', s.busy ? 'true' : 'false')
          buttons.forEach((b, i) => {
            const id = MODE_PREFS[i]
            const text = modeText(id)
            if (b.textContent !== text) b.textContent = text
            const on = s.pref === id ? 'true' : 'false'
            if (b.getAttribute('aria-pressed') !== on) b.setAttribute('aria-pressed', on)
            b.disabled = s.busy
          })
        }
        sync()
        return { el, sync }
      }
      /** The sheet « Display »: the three choices with a line each, what Auto means now, the note, and the way to the Theme page. A bottom sheet on a phone, a dialog elsewhere. */
      const buildModeSheet = (doc, win, seam, openTheme) => {
        let box = null
        let off = null
        let back = null
        const close = () => {
          if (box === null) return
          try { box.remove() } catch (e) { /* gone */ }
          box = null
          try { if (off !== null) off() } catch (e) { /* gone */ }
          off = null
          try { doc.removeEventListener('keydown', onKey, true) } catch (e) { /* gone */ }
          try { if (back !== null && back.isConnected) back.focus() } catch (e) { /* gone */ }
          back = null
        }
        const onKey = (e) => {
          if (box === null) return
          if (e.key === 'Escape') { try { e.stopPropagation(); e.preventDefault() } catch (err) { /* synthetic */ } close(); return }
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            const radios = Array.prototype.slice.call(box.querySelectorAll('[role="radio"]'))
            const at = radios.indexOf(doc.activeElement)
            if (at < 0) return
            try { e.preventDefault() } catch (err) { /* synthetic */ }
            radios[(at + (e.key === 'ArrowDown' ? 1 : radios.length - 1)) % radios.length].focus()
          }
        }
        const draw = () => {
          if (box === null) return
          const s = seam.state()
          const panel = box.querySelector('.kbmob-modesheet')
          while (panel.firstChild) panel.removeChild(panel.firstChild)
          const grab = doc.createElement('div'); grab.className = 'kbmob-modegrab'; panel.appendChild(grab)
          const h = doc.createElement('h2'); h.id = 'kbmob-mode-title'; h.textContent = modeText('display'); panel.appendChild(h)
          const group = doc.createElement('div'); group.setAttribute('role', 'radiogroup'); group.setAttribute('aria-labelledby', 'kbmob-mode-title'); panel.appendChild(group)
          for (const id of MODE_PREFS) {
            const b = doc.createElement('button')
            b.type = 'button'; b.className = 'kbmob-modeopt'; b.setAttribute('role', 'radio'); b.setAttribute('data-act', 'mode-' + id)
            b.setAttribute('aria-checked', s.pref === id ? 'true' : 'false'); b.disabled = s.busy
            b.tabIndex = s.pref === id ? 0 : -1
            const t = doc.createElement('span'); t.className = 'kbmob-modeopt-t'
            const name = doc.createElement('b'); name.textContent = modeText(id); t.appendChild(name)
            const sub = doc.createElement('span'); sub.textContent = modeText(id + 'Sub'); t.appendChild(sub)
            if (id === 'auto' && s.pref === 'auto') { const now = doc.createElement('span'); now.className = 'kbmob-modenow'; now.setAttribute('data-kb', 'mode-now'); now.textContent = modeText('now')(s.mode); t.appendChild(now) }
            b.appendChild(t)
            const dot = doc.createElement('span'); dot.className = 'kbmob-modedot'; dot.setAttribute('aria-hidden', 'true'); b.appendChild(dot)
            b.addEventListener('click', () => { if (id === s.pref) { close(); return } seam.set(id).then(() => { if (box !== null && !seam.state().busy) close() }) })
            group.appendChild(b)
          }
          const note = doc.createElement('p'); note.className = 'kbmob-modenote'; note.textContent = s.busy ? modeText('reloading') : modeText('note'); note.setAttribute('role', 'status'); panel.appendChild(note)
          if (typeof openTheme === 'function') {
            const link = doc.createElement('button'); link.type = 'button'; link.className = 'kbmob-modelink'; link.setAttribute('data-act', 'mode-theme')
            link.textContent = kt('Thème', 'Theme')
            link.addEventListener('click', () => { close(); try { openTheme() } catch (e) { /* the page is not there */ } })
            panel.appendChild(link)
          }
        }
        const open = () => {
          if (box !== null) return true
          try {
            back = doc.activeElement
            box = doc.createElement('div')
            box.className = 'kbmob-modeback'; box.setAttribute('data-kb', 'mode-sheet')
            const scrim = doc.createElement('div'); scrim.className = 'kbmob-modescrim'; scrim.addEventListener('click', close); box.appendChild(scrim)
            const panel = doc.createElement('div'); panel.className = 'kbmob-modesheet'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-labelledby', 'kbmob-mode-title'); box.appendChild(panel)
            doc.body.appendChild(box)
            doc.addEventListener('keydown', onKey, true)
            off = seam.subscribe(draw)
            draw()
            const first = box.querySelector('[role="radio"][aria-checked="true"]') || box.querySelector('[role="radio"]')
            if (first !== null) first.focus()
            return true
          } catch (e) { close(); return false }
        }
        return { open, close, isOpen: () => box !== null }
      }
      /** The commands of the palette (⌘K's box, kybernos-search): « Display… » opens the sheet, one command per choice sets it. They are listed in `window.__KB_COMMANDS__` while the layout lives. */
      const buildModeCommands = (seam, sheet) => {
        const keywords = ['mode', 'display', 'affichage', 'view', 'vue', 'simple', 'complete', 'complet', 'auto']
        const list = [{ id: 'display-open', label: () => modeText('display') + '…', keywords, hint: () => modeText('now')(seam.state().mode), run: () => { sheet.open() } }]
        for (const id of MODE_PREFS) list.push({ id: 'display-' + id, label: () => modeText('display') + kt(' : ', ': ') + modeText(id), keywords, hint: () => modeText(id + 'Sub'), run: () => { seam.set(id) } })
        return list
      }
      let modeSeam = null
      let modeSheet = null
      /** Settings › Theme, from the sheet: the dialog first (the core plugin's seam), then the cell of the page (found by the hook the organiser writes, never by its label). */
      const openThemePage = () => {
        try {
          if (typeof window.__kbOpenDshSettings !== 'function' || window.__kbOpenDshSettings() !== true) return false
          let tries = 0
          const tick = () => {
            tries += 1
            const cell = document.querySelector('[data-kb-t="theme"]')
            if (cell !== null) { cell.click(); return }
            if (tries < 25) setTimeout(tick, 120)
          }
          setTimeout(tick, 150)
          return true
        } catch (e) { return false }
      }
      /** The shell's side of a change: its `set-mode` (contract §9) from whichever door the page has (the Kaby bridge's, or the full app's `KybernosCaps/mode`). `true` when it was handed over: the shell then rebuilds its WebView. */
      const shellModeRequest = (mode) => {
        try {
          const a = window.__KB_APP__
          if (a !== undefined && a !== null && typeof a.requestMode === 'function' && a.requestMode(mode) === true) return true
          // the shell that listed `mode` in its agent's capabilities (the full app) takes the message even before its first `shell-state`
          if (caps().indexOf('mode') >= 0) return shellPost(KABY_OUT.mode, { mode })
        } catch (e) { /* no shell */ }
        return false
      }
      /** Mounts the seam and the sheet (their rules arrive in the head, mode.mjs). Called from the layout's effect; never throws. Returns what undoes it. */
      const mountMode = () => {
        try {
          const seam = buildModeSeam(window, {
            shellMode: shellModeRequest,
            reload: () => window.location.reload(),
            openSheet: () => (modeSheet === null ? false : modeSheet.open())
          })
          const sheet = buildModeSheet(document, window, seam, openThemePage)
          modeSeam = seam
          modeSheet = sheet
          // the page's copy follows the account's: what the host put in the head is newer than a copy this origin has not seen (the phone's engine changes its port at every start)
          try {
            const host = window.__KB_MODE_HOST__
            const mine = JSON.parse(window.localStorage.getItem(MODE_STORE_KEY) || 'null')
            if (host !== undefined && host !== null && MODE_WORD(host.pref) !== null && !(mine !== null && typeof mine === 'object' && Number(mine.at) > Number(host.at))) window.localStorage.setItem(MODE_STORE_KEY, JSON.stringify({ v: 1, pref: MODE_WORD(host.pref), at: Number(host.at) || 0 }))
          } catch (e) { /* no storage */ }
          try { window.__KB_MODE__ = seam } catch (e) { /* frozen window */ }
          // the palette: ⌘K's box lists these when a word matches (the array is shared with whoever else registers commands)
          const commands = buildModeCommands(seam, sheet)
          let registry = null
          try { registry = Array.isArray(window.__KB_COMMANDS__) ? window.__KB_COMMANDS__ : (window.__KB_COMMANDS__ = []); commands.forEach((c) => registry.push(c)) } catch (e) { registry = null }
          return () => {
            try { sheet.close() } catch (e) { /* gone */ }
            try { if (registry !== null) commands.forEach((c) => { const i = registry.indexOf(c); if (i >= 0) registry.splice(i, 1) }) } catch (e) { /* gone */ }
            try { if (window.__KB_MODE__ === seam) delete window.__KB_MODE__ } catch (e) { /* gone */ }
            modeSeam = null
            modeSheet = null
          }
        } catch (e) { try { console.warn('[kybernos-mobile] display mode not mounted:', e) } catch (e2) { /* no console */ } return () => {} }
      }
      // </kb-mode>

      // ═══ Kaby mode ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
      // A switch the app's shell sets: its WebView's user agent ends with `KybernosHost/<v> (ios|android) KabyMode/<n>`. Then, and only then, the page is Kaby's conversation inside the phone's
      // own screens (the drawer, the account menu, Settings), which the locked Simple preset filters (the Kybernos plugin applies it); the parts of the chat the preset has no entry for stay
      // hidden (the stylesheet: kaby-mode.mjs, the one list of what is shown and hidden). Where DSH runs does not matter: a cloud computer, the
      // person's own computer through the phone link, or an engine on the phone. Without the token nothing here runs and the full app is exactly as it was.
      // The messages between the page and the shell are listed in docs/dev/kaby-mode-shell-contract.md; every one is `{ kybernos: <type>, version: 1, ... }`.
      const KABY_UA = /KybernosHost\/[0-9][0-9A-Za-z.+-]* \((?:ios|android)\) KabyMode\/([1-9][0-9]{0,2})/
      const KABY_SUPPORTED = 1
      const KABY_CLASS = 'kb-kaby'
      const KABY_STYLE_ID = 'kbmob-kaby'
      const KABY_LINK_ID = 'kbmob-kaby-link'
      /** `{ version, asked }` when the user agent asks for Kaby mode (`version` is the one this build speaks: at most `asked`), else null. `KabyMode/0` is off. */
      const parseKabyMode = (ua) => {
        try {
          const m = KABY_UA.exec(String(ua === undefined || ua === null ? '' : ua))
          if (m === null) return null
          const asked = Number(m[1])
          return asked >= 1 ? { version: Math.min(asked, KABY_SUPPORTED), asked } : null
        } catch (e) { return null }
      }
      const kabyMode = () => { try { return parseKabyMode(window.navigator.userAgent) } catch (e) { return null } }

      // The words of the contract. DSH → shell: `postMessage(JSON.stringify({ kybernos: <OUT>, version: 1, ... }))`. Shell → DSH: `window.__KB_APP__.receive(<IN message>)`.
      const KABY_OUT = Object.freeze({ ready: 'kaby-ready', screen: 'open-screen', authorize: 'authorize', notifications: 'notifications-ask', mode: 'set-mode' })
      /** The two modes the shell can switch between (contract §9). `simple` is Kaby mode (the `KabyMode/<n>` token), `advanced` is the full app. */
      const MODES = Object.freeze(['simple', 'advanced'])
      const KABY_IN = Object.freeze({ shell: 'shell-state', authorized: 'authorize-result', notifications: 'notifications-state' })
      const KABY_SCREENS = Object.freeze(['account', 'plan', 'help', 'where', 'notification-settings'])
      const KABY_NOTIF_STATES = Object.freeze(['granted', 'denied', 'undetermined', 'unavailable'])
      const KABY_AUTH_STATES = Object.freeze(['returned', 'dismissed', 'failed', 'unsupported'])
      const KABY_CONNECTIONS = Object.freeze(['cloud', 'remote', 'local'])
      const KABY_WHY = Object.freeze(['approval', 'reply', 'settings'])
      const KABY_APPROVAL = '[data-slot*="approval"], [data-kb="connector-ask"]'
      const LOOPBACK = Object.freeze(['127.0.0.1', 'localhost', '[::1]'])
      const TOOLKIT = /^[a-z0-9][a-z0-9_-]{0,63}$/
      const ID_RE = /^[A-Za-z0-9_-]{6,64}$/
      const cap = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '')

      /**
       * The page's end of the contract, with nothing of DSH in it: it posts to the shell, takes what the shell says (through `receive`, which never throws and answers whether it
       * understood), and keeps the little state the page needs. `win` is the window (or what stands for it in a test).
       */
      const buildKabyBridge = (win, host, kaby, opts = {}) => {
        const subs = new Set()
        const authSubs = new Set()
        const shell = { answered: false, authorize: false, notifications: false, mode: false, screens: [], notificationState: 'unknown', connection: null }
        const waiting = new Map()
        let notifAsking = null
        let askedThisLoad = false
        let counter = 0
        const rand = typeof opts.random === 'function' ? opts.random : () => { try { return win.crypto.getRandomValues(new Uint32Array(2)).join('') } catch (e) { return String(Math.random()).slice(2) } }
        const newId = () => { counter += 1; return 'k' + counter + '-' + rand().slice(0, 12) }
        const emit = () => { for (const f of Array.from(subs)) { try { f() } catch (e) { /* a listener failed: the others still hear */ } } }
        /** `true` when the shell was handed the message. Never throws. */
        const post = (type, fields) => {
          try {
            const w = win.ReactNativeWebView
            if (w === undefined || w === null || typeof w.postMessage !== 'function') return false
            w.postMessage(JSON.stringify({ kybernos: type, version: 1, ...fields }))
            return true
          } catch (e) { return false }
        }
        const receive = (raw) => {
          try {
            let m = raw
            if (typeof raw === 'string') { if (raw.length > 8192) return false; m = JSON.parse(raw) }
            if (m === null || typeof m !== 'object' || Array.isArray(m) || typeof m.kybernos !== 'string') return false
            if (m.kybernos === 'close-layer') return closeTopLayer()
            if (m.kybernos === KABY_IN.shell) {
              const c = m.capabilities !== null && typeof m.capabilities === 'object' && !Array.isArray(m.capabilities) ? m.capabilities : {}
              shell.answered = true
              shell.authorize = c.authorize === true
              shell.notifications = c.notifications === true
              shell.mode = c.mode === true
              shell.screens = Array.isArray(c.screens) ? c.screens.filter((s) => KABY_SCREENS.indexOf(s) >= 0) : []
              if (KABY_NOTIF_STATES.indexOf(m.notifications) >= 0) { shell.notificationState = m.notifications; if (m.notifications !== 'undetermined') notifAsking = null }
              if (KABY_CONNECTIONS.indexOf(m.connection) >= 0) shell.connection = m.connection
              emit()
              return true
            }
            if (m.kybernos === KABY_IN.authorized) {
              if (typeof m.id !== 'string' || !waiting.has(m.id) || KABY_AUTH_STATES.indexOf(m.state) < 0) return false
              waiting.delete(m.id)
              for (const f of Array.from(authSubs)) { try { f(m.id, m.state) } catch (e) { /* the flow failed: the card says so */ } }
              emit()
              return true
            }
            if (m.kybernos === KABY_IN.notifications) {
              if (KABY_NOTIF_STATES.indexOf(m.state) < 0) return false
              shell.notificationState = m.state
              notifAsking = null
              emit()
              return true
            }
            return handOn(win, m)
          } catch (e) { return false }
        }
        const urlOk = (u) => {
          try {
            if (typeof u !== 'string' || u.length > 2048) return false
            const x = new URL(u)
            return x.protocol === 'https:' || (x.protocol === 'http:' && LOOPBACK.indexOf(x.hostname) >= 0)
          } catch (e) { return false }
        }
        /** Hands an authorization address to the shell, which opens it in the system's sign-in sheet (Google refuses a page's own embedded view). `{ ok: true, id }`, or `{ ok: false, reason }`. */
        const authorize = (req) => {
          if (shell.authorize !== true) return { ok: false, reason: 'unsupported' }
          if (!urlOk(req.url)) return { ok: false, reason: 'bad_url' }
          const id = newId()
          waiting.set(id, true)
          const fields = { id, url: req.url, app: cap(req.app, 64) }
          if (typeof req.name === 'string' && req.name !== '') fields.name = cap(req.name, 64)
          if (!post(KABY_OUT.authorize, fields)) { waiting.delete(id); return { ok: false, reason: 'unsupported' } }
          return { ok: true, id }
        }
        const openScreen = (screen) => {
          if (KABY_SCREENS.indexOf(screen) < 0 || shell.screens.indexOf(screen) < 0) return false
          return post(KABY_OUT.screen, { screen })
        }
        /** Asks the shell to ask the system for the notification permission: once per page load, when it is still undecided, and only at a moment the person has reason to want it (`why`). The shell keeps the permission and is the one to rate-limit: the page keeps nothing. */
        const askNotifications = (why) => {
          if (KABY_WHY.indexOf(why) < 0 || shell.notifications !== true || shell.notificationState !== 'undetermined') return false
          // the person's own tap on « Turn on » always goes through (a shell that never answered the first ask must not leave the button dead); the two automatic reasons wait for the shell's answer and ask once per load
          if (why !== 'settings' && (askedThisLoad || notifAsking !== null)) return false
          const id = newId()
          if (!post(KABY_OUT.notifications, { id, why })) return false
          notifAsking = id
          if (why !== 'settings') askedThisLoad = true
          emit()
          return true
        }
        /** Asks the shell to switch mode (the shell stores it and reloads its WebView). Only when the shell said it can (`capabilities.mode`), and only for a mode we know: `true` when the message was handed over. */
        const setMode = (mode) => {
          if (shell.mode !== true || MODES.indexOf(mode) < 0) return false
          return post(KABY_OUT.mode, { mode })
        }
        const ready = () => post(KABY_OUT.ready, { mode: 'kaby', modeVersion: kaby.version, platform: host.platform, appVersion: host.version })
        return {
          post, receive, authorize, openScreen, askNotifications, setMode, ready,
          shell: () => ({ ...shell, screens: shell.screens.slice() }),
          canAskNotifications: () => shell.notifications === true && shell.notificationState === 'undetermined' && notifAsking === null && !askedThisLoad,
          /** Whether the question may still be asked in this load: not yet asked, and the shell either has not answered `shell-state` yet or has a permission that is still open. A watcher stops only when this is false. */
          notificationsOpen: () => !askedThisLoad && (shell.answered !== true || (shell.notifications === true && (shell.notificationState === 'undetermined' || shell.notificationState === 'unknown'))),
          subscribe: (fn) => { subs.add(fn); return () => { subs.delete(fn) } },
          onAuthorizeResult: (fn) => { authSubs.add(fn); return () => { authSubs.delete(fn) } }
        }
      }

      /**
       * The moments at which the page has reason to ask for notifications (the shell still decides whether and how). Two: DSH's own approval card appears (something waits for the person), and a
       * reply finishes while the person was away (the page was hidden, or came back just now). Both stop watching once the question is asked. `turnDone` is called for each finished answer.
       */
      const startNotificationTriggers = (win, doc, bridge, opts = {}) => {
        const now = typeof opts.now === 'function' ? opts.now : () => Date.now()
        const bootAt = now()
        let hiddenAt = null
        let backAt = null
        let hiddenFor = 0
        let observer = null
        let timer = null
        const stopObserver = () => { try { if (observer !== null) observer.disconnect() } catch (e) { /* gone */ } observer = null; try { if (timer !== null) clearTimeout(timer) } catch (e) { /* gone */ } timer = null }
        const look = () => {
          timer = null
          try {
            if (bridge.canAskNotifications() !== true) {
              // the shell answers `shell-state` a moment after the page is up, while DSH is still drawing: until it has, or while an earlier ask waits for its answer, keep watching
              if (bridge.notificationsOpen() !== true) stopObserver()
              return
            }
            if (doc.querySelector(KABY_APPROVAL) !== null && doc.querySelector(KABY_APPROVAL) !== undefined) { bridge.askNotifications('approval'); stopObserver() }
          } catch (e) { /* the page is changing: the next change looks again */ }
        }
        const onChange = () => { if (timer === null) { try { timer = setTimeout(look, 600) } catch (e) { timer = null } } }
        try {
          const MO = win.MutationObserver
          if (typeof MO === 'function' && doc.body !== null && doc.body !== undefined) { observer = new MO(onChange); observer.observe(doc.body, { childList: true, subtree: true }) }
        } catch (e) { observer = null }
        const onVisibility = () => {
          try {
            if (doc.visibilityState === 'hidden') { hiddenAt = now(); backAt = null } else if (hiddenAt !== null) { hiddenFor = now() - hiddenAt; backAt = now(); hiddenAt = null }
          } catch (e) { /* no visibility */ }
        }
        try { doc.addEventListener('visibilitychange', onVisibility) } catch (e) { /* no listener */ }
        // a card that was already there when the shell's answer arrives is looked at too
        let unsubscribe = null
        try { unsubscribe = bridge.subscribe(onChange) } catch (e) { unsubscribe = null }
        const turnDone = () => {
          try {
            // the turns the page draws when it opens are history, not a reply that came while the person was away
            if (now() - bootAt < 8000) return false
            const away = doc.visibilityState === 'hidden' || (backAt !== null && now() - backAt < 10000 && hiddenFor >= 3000)
            if (away !== true) return false
            const asked = bridge.askNotifications('reply')
            if (asked) stopObserver()
            return asked
          } catch (e) { return false }
        }
        return { turnDone, stop: () => { stopObserver(); try { if (unsubscribe !== null) unsubscribe() } catch (e) { /* gone */ } try { doc.removeEventListener('visibilitychange', onVisibility) } catch (e) { /* gone */ } } }
      }

      /**
       * « Kaby wants to connect <app> »: the requests waiting for the person, and what each one is doing. A request starts only from the page (`request`, which the window event
       * `kb-connect-request` and `__KB_APP__.requestConnect` call) and goes on only on the person's tap (`accept`): the card says what it asks, and nothing leaves the phone before. The authorization address
       * is made by the cloud half (`/kybernos-cloud/connections/link`), handed to the shell (`authorize`), and the page then asks the server (`/connections/item`) until the connection is active:
       * the shell's word that the person came back proves nothing, the server's does. `io` = `{ fetchJson(method, path, body) → { status, json }, setTimeout, clearTimeout }`.
       */
      const buildConnectFlow = (bridge, io, opts = {}) => {
        const POLL_MS = typeof opts.pollMs === 'number' ? opts.pollMs : 3000
        const POLL_MAX = typeof opts.pollMax === 'number' ? opts.pollMax : 40
        const subs = new Set()
        const list = []
        let seq = 0
        const emit = () => { for (const f of Array.from(subs)) { try { f() } catch (e) { /* a listener failed */ } } }
        const byId = (id) => list.find((r) => r.id === id)
        const set = (r, patch) => { Object.assign(r, patch); emit() }
        const failureOf = (res) => {
          const j = res !== null && res.json !== null && typeof res.json === 'object' ? res.json : {}
          const e = typeof j.error === 'string' ? j.error : ''
          // through the phone link the cloud routes answer 403 `refused_on_phone` (session-guard.mjs); this bundle's own routes say `refused-on-phone`
          if (res.status === 403 && (e === 'refused_on_phone' || e === 'refused-on-phone')) return 'on_computer'
          if (e === 'needs_api_key') return 'needs_key'
          if (e === 'connection_limit') return j.entitled === false ? 'plan' : 'limit'
          if (e === 'pending_exists') return 'pending_exists'
          if (e === 'reconnect_required' || e === 'not_connected' || j.connected === false) return 'signin'
          if (e === 'network' || res.status === 0) return 'network'
          if (e === 'not_on_this_server' || j.offered === false) return 'unavailable'
          return 'other'
        }
        const stopPoll = (r) => { if (r.timer !== null && r.timer !== undefined) { try { io.clearTimeout(r.timer) } catch (e) { /* gone */ } r.timer = null } }
        const check = async (r) => {
          stopPoll(r)
          if (typeof r.connectionId !== 'string') return
          let res = null
          try { res = await io.fetchJson('GET', '/kybernos-cloud/connections/item?id=' + encodeURIComponent(r.connectionId), null) } catch (e) { res = null }
          if (r.phase !== 'checking') return
          const c = res !== null && res.json !== null && typeof res.json === 'object' && res.json.ok === true && res.json.connection !== null && typeof res.json.connection === 'object' ? res.json.connection : null
          if (c !== null && c.status === 'active') { set(r, { phase: 'connected' }); return }
          if (c !== null && (c.status === 'failed' || c.status === 'expired' || c.status === 'disabled')) { set(r, { phase: 'failed', error: 'refused' }); return }
          r.polls += 1
          if (r.polls >= POLL_MAX) { set(r, { phase: 'not_yet' }); return }
          r.timer = io.setTimeout(() => { void check(r) }, POLL_MS)
        }
        const startChecking = (r) => { set(r, { phase: 'checking', polls: 0 }); void check(r) }
        bridge.onAuthorizeResult((id, state) => {
          const r = list.find((x) => x.authId === id)
          if (r === undefined || r.phase !== 'authorizing') return
          if (state === 'unsupported') { set(r, { phase: 'failed', error: 'unsupported' }); return }
          if (state === 'failed') { set(r, { phase: 'failed', error: 'sheet' }); return }
          // `returned` and `dismissed` both mean the sheet is gone: the server says whether it worked
          startChecking(r)
        })
        const hand = (r) => {
          const sent = bridge.authorize({ url: r.url, app: r.toolkit, name: r.name })
          if (sent.ok !== true) { set(r, { phase: 'failed', error: sent.reason === 'bad_url' ? 'other' : 'unsupported' }); return }
          set(r, { phase: 'authorizing', authId: sent.id })
        }
        return {
          list: () => list.slice(),
          subscribe: (fn) => { subs.add(fn); return () => { subs.delete(fn) } },
          /** Adds a request for an app; one for the same app that is still open is not added twice. Returns it, or null when the app is not a toolkit slug. */
          request: (req) => {
            const toolkit = req !== null && typeof req === 'object' && typeof req.toolkit === 'string' ? req.toolkit.trim().toLowerCase() : ''
            if (!TOOLKIT.test(toolkit)) return null
            const open = list.find((r) => r.toolkit === toolkit && r.phase !== 'declined' && r.phase !== 'connected' && r.phase !== 'closed')
            if (open !== undefined) return open
            seq += 1
            const r = { id: 'req' + seq, toolkit, name: cap(typeof req.name === 'string' && req.name.trim() !== '' ? req.name.trim() : toolkit, 40), phase: 'asking', error: '', url: '', connectionId: null, authId: null, polls: 0, timer: null }
            list.push(r)
            emit()
            return r
          },
          /** The person's tap on « Connect »: asks the server for the address, then hands it to the shell. */
          accept: async (id) => {
            const r = byId(id)
            if (r === undefined || (r.phase !== 'asking' && r.phase !== 'failed' && r.phase !== 'not_yet')) return false
            if (r.url !== '' && r.phase !== 'asking') { hand(r); return true }
            // a shell that cannot open the sign-in sheet is found out BEFORE the server starts a connection nobody could finish
            if (bridge.shell().authorize !== true) { set(r, { phase: 'failed', error: 'unsupported' }); return false }
            set(r, { phase: 'linking', error: '' })
            let res = null
            try { res = await io.fetchJson('POST', '/kybernos-cloud/connections/link', { toolkit: r.toolkit }) } catch (e) { res = { status: 0, json: null } }
            const j = res.json !== null && typeof res.json === 'object' ? res.json : {}
            if (res.status < 200 || res.status >= 300 || j.ok !== true || typeof j.redirectUrl !== 'string' || j.redirectUrl === '' || j.connection === null || typeof j.connection !== 'object') {
              // an app that needs no sign-in page (already active) comes back with no address
              if (res.status >= 200 && res.status < 300 && j.ok === true && j.connection !== null && typeof j.connection === 'object' && j.connection.status === 'active') { set(r, { phase: 'connected' }); return true }
              set(r, { phase: 'failed', error: failureOf(res) })
              return false
            }
            r.connectionId = typeof j.connection.id === 'string' ? j.connection.id : null
            r.url = j.redirectUrl
            hand(r)
            return true
          },
          /** « Not now »: nothing was sent anywhere; the card goes away. */
          decline: (id) => {
            const r = byId(id)
            if (r === undefined) return false
            stopPoll(r)
            const had = r.connectionId
            const was = r.phase
            set(r, { phase: 'declined' })
            // a connection the person started and gave up on would keep counting against the plan: it is removed unless the server says it is active now
            if (typeof had === 'string' && was !== 'connected') {
              void (async () => {
                try {
                  const res = await io.fetchJson('GET', '/kybernos-cloud/connections/item?id=' + encodeURIComponent(had), null)
                  const c = res !== null && res.json !== null && typeof res.json === 'object' && res.json.connection !== null && typeof res.json.connection === 'object' ? res.json.connection : null
                  if (c !== null && c.status !== 'active') await io.fetchJson('POST', '/kybernos-cloud/connections/delete', { id: had })
                } catch (e) { /* the connection stays in the list: the person can remove it there */ }
              })()
            }
            return true
          },
          /** « Check again »: asks the server now (the person may have finished while the page was asleep). */
          checkNow: (id) => { const r = byId(id); if (r === undefined || typeof r.connectionId !== 'string') return false; startChecking(r); return true },
          /** The card's close button once it is over (connected, failed). */
          close: (id) => { const r = byId(id); if (r === undefined) return false; stopPoll(r); set(r, { phase: 'closed' }); return true },
          /** What the card shows: the first request that is still open. */
          current: () => list.find((r) => r.phase !== 'declined' && r.phase !== 'closed') || null
        }
      }

      /** The two fetches the connect flow and the settings page make, against the cloud half of this DSH (same origin, DSH's own session cookie). Never throws. */
      const kabyFetchJson = async (method, path, body) => {
        try {
          const init = { method, credentials: 'same-origin', headers: { accept: 'application/json' } }
          if (body !== null && body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body) }
          const r = await fetch(path, init)
          let json = null
          try { json = await r.json() } catch (e) { json = null }
          return { status: r.status, json }
        } catch (e) { return { status: 0, json: null } }
      }

      /** What the state of the person's computer is called, in words. */
      const computerWords = (st) => {
        if (st === 'running') return kt('éveillé', 'awake')
        if (st === 'suspended') return kt('en veille', 'asleep')
        if (st === 'creating') return kt('en préparation', 'being set up')
        return typeof st === 'string' && st !== '' ? st : kt('inconnu', 'unknown')
      }

      // ── « New chat » (the dock's button): the field is given the focus by this page when the engine gave it to nothing ──
      // The engine focuses the composer of a session it has JUST made, and the guard of `mount` keeps that focus, so the keyboard rises. It does not when it REUSES the blank chat that is already open (a
      // « New chat » on an empty chat: same session, nothing to refocus), and a focus it asks for while the drawer is still closing misses: the whole page behind the drawer is `inert` (measured, DSH
      // 0.2.3-alpha.2). Real phone, 2026-11-23, no account and no model, an empty chat open: « New chat » raised no keyboard (`mInputShown=false` 1 s and 5 s after). So the page looks for the field a few
      // times after the tap and focuses it itself once it is there, editable, drawn and no longer inert. It never takes a focus a text field already has, and it stops after ~1.1 s: the guard keeps a
      // focus given within 1.5 s of the tap, and a later one is not « New chat »'s. The calls on the page are `doc`'s and `later`'s, so a test drives it without a clock.
      const COMPOSER_TRIES = Object.freeze({ first: 150, every: 110, max: 10 })
      const isTypingEl = (el, doc) => {
        try { return el !== null && el !== undefined && el !== doc.body && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable === true || (typeof el.getAttribute === 'function' && (el.getAttribute('contenteditable') === 'true' || el.getAttribute('role') === 'textbox'))) } catch (e) { return false }
      }
      /** One attempt: `'done'` when a text field has the focus (the engine's, or ours now), `'wait'` when the composer is not ready (absent, not editable, not drawn, under an inert box). Never throws. */
      const composerFocusStep = (doc) => {
        try {
          if (isTypingEl(doc.activeElement, doc)) return 'done'
          const input = doc.querySelector('[data-composer-input]')
          if (input === null || input === undefined) return 'wait'
          if (input.getAttribute('contenteditable') === 'false' || input.getAttribute('aria-disabled') === 'true') return 'wait'
          if (typeof input.closest === 'function' && input.closest('[inert]') !== null) return 'wait'
          const r = input.getBoundingClientRect()
          if (!(r.width > 0 && r.height > 0)) return 'wait'
          input.focus({ preventScroll: true })
          return isTypingEl(doc.activeElement, doc) ? 'done' : 'wait'
        } catch (e) { return 'wait' }
      }
      const giveComposerFocus = (doc, later) => {
        let n = 0
        const run = () => { n += 1; if (composerFocusStep(doc) === 'done' || n >= COMPOSER_TRIES.max) return; later(run, COMPOSER_TRIES.every) }
        later(run, COMPOSER_TRIES.first)
      }

      // ── Simple's small helper of its own: the composer's sentence. Everything else of Simple is the full app's screens, filtered by the locked preset
      // (the Kybernos plugin applies it: the drawer's rows, the account menu, the Settings pages). Pure helpers first, so that the tests read them without a page. ──
      // ── The composer's empty text, in the person's words (Simple) ──
      // The engine says « Describe what you want to build, / commands, @ files or sessions » on the blank page and « Message or run a task, … » in a chat: developer words, and a phone has no « / » or « @ »
      // key. Simple draws its own sentence instead. It touches the engine's nodes without changing their structure: the value of the placeholder's text node, and the field's `data-placeholder` and
      // accessible name. A field that is not editable (the engine says « Session unavailable ») keeps the engine's sentence. React writes its own text back when the engine changes it (the blank page
      // becomes a chat), so a watch puts ours back in the same microtask, before the next paint.
      const kabyAsk = () => kt('Demande quelque chose à Kaby', 'Ask Kaby anything')
      const placeholderPass = (doc, text) => {
        try {
          const input = doc.querySelector('[data-composer-input]')
          if (input === null || input === undefined) return false
          if (input.getAttribute('contenteditable') === 'false' || input.getAttribute('aria-disabled') === 'true') return false
          let changed = false
          const ph = doc.querySelector('[data-composer-placeholder]')
          if (ph !== null && ph !== undefined && ph.childNodes.length === 1 && ph.firstChild.nodeType === 3 && ph.firstChild.nodeValue !== text) { ph.firstChild.nodeValue = text; changed = true }
          for (const a of ['data-placeholder', 'aria-label']) { if (input.getAttribute(a) !== text) { input.setAttribute(a, text); changed = true } }
          return changed
        } catch (e) { return false }
      }
      const startPlaceholder = (win, doc, words) => {
        let queued = false
        let mo = null
        const run = () => { queued = false; try { placeholderPass(doc, words()) } catch (e) { /* cosmetic */ } }
        try {
          mo = new win.MutationObserver(() => { if (!queued) { queued = true; Promise.resolve().then(run) } })
          mo.observe(doc.body || doc.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-placeholder', 'aria-label', 'contenteditable'] })
        } catch (e) { mo = null }
        // the language may change while the page is up; a page with no observer still gets the sentence
        const timer = typeof win.setInterval === 'function' ? win.setInterval(run, 3000) : null
        run()
        return { run, stop () { try { if (mo !== null) mo.disconnect() } catch (e) { /* gone */ } try { if (timer !== null) win.clearInterval(timer) } catch (e) { /* gone */ } } }
      }

      // ── The phone's own words (Simple) ──
      // Pages written for the desktop say « cet ordinateur », « cette machine », « this computer » (the load strip of the Automations, the « Where Kaby works » card, the Kaby, Memory and
      // Language pages…). On the phone's own engine (`KybernosPlace/local`) that machine IS the phone: the words are « ce téléphone » / « this phone ». The texts live in the tables of a dozen
      // plugins, so the swap is made once, here, on what is drawn (the way the Hub says « Kybernos » for « DSH » on the engine's own pages), instead of one more phone variant in each table.
      // Only the demonstrative forms are swapped, on the Settings pages, the menus, the search and the Automations load strip: a text node (or an aria-label, a title), never code, a field, a chat, nor a text the
      // person wrote (a memory lesson). On a cloud computer (`KybernosPlace/cloud`) « this computer » really is the computer, so nothing is swapped. Idempotent, no state, nothing stored.
      // the phone, as a [fr, en] pair (with its capital and without): the French is only ever written in a pair, and each pattern takes the side of its own language
      const PHONE_CAP = Object.freeze(['Ce téléphone', 'This phone'])
      const PHONE_LOW = Object.freeze(['ce téléphone', 'this phone'])
      const PHONE_WORDS = Object.freeze([
        [/\bCet ordinateur\b/g, PHONE_CAP[0]], [/\bcet ordinateur\b/g, PHONE_LOW[0]], [/\bCette machine\b/g, PHONE_CAP[0]], [/\bcette machine\b/g, PHONE_LOW[0]],
        [/\bThis computer\b/g, PHONE_CAP[1]], [/\bthis computer\b/g, PHONE_LOW[1]], [/\bThis machine\b/g, PHONE_CAP[1]], [/\bthis machine\b/g, PHONE_LOW[1]]
      ])
      const PHONE_WORDS_ROOTS = '[data-slot="settings.section"], [role="menu"], [data-kb="load-strip"], [data-kb="load-pop"], [data-kb="where-here"], [data-kb="search-dialog"]'
      const PHONE_WORDS_SKIP = 'code, pre, textarea, input, script, style, [contenteditable], .kbmem-tx'
      const PHONE_WORDS_ATTRS = ['aria-label', 'title']
      /** What the locked Simple preset says about « The Kybernos app » page (`options.appPage`, read through the Theme plugin's seam): `{}` when it cannot be read, and then everything is drawn, as in the full app. */
      const presetAppPage = () => {
        try {
          const l = window.__KB_THEME_LOCKED__
          const o = l !== undefined && l !== null && typeof l.options === 'function' ? l.options('locked-simple') : null
          return o !== null && typeof o === 'object' && o.appPage !== null && typeof o.appPage === 'object' ? o.appPage : {}
        } catch (e) { return {} }
      }
      const kabyPlace = (ua) => { try { const m = /(?:^|\s)KybernosPlace\/(local|cloud)(?=\s|$)/.exec(String(ua === undefined || ua === null ? '' : ua)); return m === null ? 'local' : m[1] } catch (e) { return 'local' } }
      /** `text` with the desktop's machine called the phone. Pure. */
      const phoneWordsText = (text) => {
        if (typeof text !== 'string' || text === '') return text
        let out = text
        for (const [re, to] of PHONE_WORDS) out = out.replace(re, to)
        return out
      }
      /** One pass over the open pages: how many texts were swapped. Never throws. */
      const phoneWordsPass = (doc) => {
        let changed = 0
        try {
          if (typeof doc.querySelectorAll !== 'function') return 0
          const skipped = (el) => el !== null && el !== undefined && typeof el.closest === 'function' && el.closest(PHONE_WORDS_SKIP) !== null
          for (const root of Array.from(doc.querySelectorAll(PHONE_WORDS_ROOTS))) {
            if (typeof doc.createTreeWalker === 'function') {
              const walker = doc.createTreeWalker(root, 4)
              const hit = []
              for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) { const v = n.nodeValue; if (typeof v === 'string' && phoneWordsText(v) !== v) hit.push(n) }
              for (const n of hit) { if (skipped(n.parentElement)) continue; n.nodeValue = phoneWordsText(n.nodeValue); changed += 1 }
            }
            for (const el of [root].concat(Array.from(root.querySelectorAll('[aria-label], [title]')))) {
              if (skipped(el)) continue
              for (const a of PHONE_WORDS_ATTRS) {
                const v = el.getAttribute(a)
                if (typeof v === 'string' && phoneWordsText(v) !== v) { el.setAttribute(a, phoneWordsText(v)); changed += 1 }
              }
            }
          }
        } catch (e) { /* cosmetic */ }
        return changed
      }
      /** The watch: a pass now, and one in the microtask after each batch of changes (before the next paint). Nothing to do on a cloud computer, or without a page. */
      const startPhoneWords = (win, doc) => {
        let queued = false
        let mo = null
        const on = () => { try { return kabyPlace(win.navigator.userAgent) === 'local' } catch (e) { return false } }
        const run = () => { queued = false; try { if (on()) phoneWordsPass(doc) } catch (e) { /* cosmetic */ } }
        try {
          mo = new win.MutationObserver(() => { if (!queued) { queued = true; Promise.resolve().then(run) } })
          mo.observe(doc.body || doc.documentElement, { childList: true, subtree: true, characterData: true })
        } catch (e) { mo = null }
        const timer = typeof win.setInterval === 'function' ? win.setInterval(run, 3000) : null
        run()
        return { run, stop () { try { if (mo !== null) mo.disconnect() } catch (e) { /* gone */ } try { if (timer !== null) win.clearInterval(timer) } catch (e) { /* gone */ } } }
      }

      const buildKabyUi = (React, roots, host, kaby, bridge, flow, appUi) => {
        const h = React.createElement
        const kyber = () => { try { const k = window.__KB_KYBER__; return k !== undefined && k !== null ? k : null } catch (e) { return null } }
        const useTick = (subscribe) => {
          const [, setN] = React.useState(0)
          React.useEffect(() => { const off = subscribe(() => setN((n) => n + 1)); return () => { try { off() } catch (e) { /* gone */ } } }, [])
        }
        const Btn = (p) => h('button', { type: 'button', className: 'kbk-btn' + (p.primary ? ' kbk-primary' : ''), 'data-act': p.act, disabled: p.disabled === true, onClick: p.onClick }, p.children)

        // ── the sections Simple adds to « The Kybernos app » page of the real Settings: what only the phone can offer ──
        const Section = (p) => h('section', { className: 'kbk-card', 'data-kb': p.kb }, h('h3', { className: 'kbk-h' }, p.title), p.children)
        const NotificationsSection = () => {
          useTick(bridge.subscribe)
          const s = bridge.shell()
          // A shell that does not handle notifications (an older app) has nothing to offer here: no card, rather than a line about what the app cannot do yet.
          if (s.notifications !== true) return null
          let line = kt('Indisponibles sur ce téléphone.', 'Not available on this phone.')
          let action = null
          if (s.notificationState === 'granted') line = kt('Activées. Une notification dit seulement que Kaby a besoin de toi, jamais ce qui a été dit.', 'On. A notification only says Kaby needs you, never what was said.')
          else if (s.notificationState === 'undetermined') { line = kt('Désactivées. Kaby te préviendra quand il attend ta réponse, sans jamais écrire ce qui a été dit.', 'Off. Kaby will tell you when it is waiting for you, without ever writing what was said.'); action = h(Btn, { act: 'kaby-notifications-on', primary: true, onClick: () => { bridge.askNotifications('settings') } }, kt('Activer', 'Turn on')) }
          else if (s.notificationState === 'denied') { line = kt('Refusées dans les réglages du téléphone.', 'Turned off in your phone’s settings.'); action = s.screens.indexOf('notification-settings') >= 0 ? h(Btn, { act: 'kaby-notifications-phone-settings', onClick: () => { bridge.openScreen('notification-settings') } }, kt('Ouvrir les réglages du téléphone', 'Open your phone’s settings')) : null }
          return h(Section, { kb: 'kaby-notifications', title: kt('Notifications', 'Notifications') }, h('p', { className: 'kbk-sub', 'data-kb': 'kaby-notifications-line' }, line), action)
        }
        const ComputerSection = () => {
          useTick((f) => { const k = kyber(); let off = () => {}; try { if (k !== null && typeof k.subscribe === 'function') off = k.subscribe(f) } catch (e) { /* no seam */ } const off2 = bridge.subscribe(f); return () => { try { off() } catch (e) { /* gone */ } off2() } })
          const s = bridge.shell()
          let w = null
          try { const k = kyber(); w = k !== null && typeof k.where === 'function' ? k.where() : null } catch (e) { w = null }
          // Words by where Kaby works: on this phone the « computer » IS the phone (the card says where Kaby works and that heavier jobs need a computer); on the person's own computer it is theirs;
          // on a cloud computer it is Kaby's own.
          let title = kt('Ton ordinateur', 'Your computer')
          let line
          let action = null
          if (s.connection === 'remote') line = kt('Ton propre ordinateur, relié par le lien téléphone.', 'Your own computer, through the phone link.')
          else if (s.connection === 'local') {
            title = kt('Où Kaby travaille', 'Where Kaby works')
            line = kt('Sur ce téléphone, avec le petit modèle de l’app. Pour les travaux plus lourds, Kaby travaille sur un ordinateur : le tien ou un ordinateur dans le cloud.', 'On this phone, with the app’s small model. For heavier jobs Kaby works on a computer: yours or one in the cloud.')
            if (Array.isArray(s.screens) && s.screens.indexOf('where') >= 0) {
              action = h(Btn, { act: 'kaby-connect-computer', onClick: () => { bridge.openScreen('where') } }, kt('Connecter un ordinateur', 'Connect a computer'))
            }
          }
          else if (w === null) { if (presetAppPage().computer === 'linked') return null; line = kt('Pas encore d’information.', 'No information yet.') }
          // the page's own engine is the phone: « Your computer: ready » says nothing to someone with no computer, so the preset (`computer: 'linked'`) leaves the card out until one is linked
          else if (w.local === true) { if (presetAppPage().computer === 'linked') return null; line = kt('Ton ordinateur : prêt.', 'Your computer: ready.') }
          else { const mine = Array.isArray(w.computers) ? w.computers.find((c) => c.id === w.picked) : undefined; title = kt('L’ordinateur de Kaby', 'Kaby’s computer'); line = kt('Ordinateur cloud de Kaby', 'Kaby’s cloud computer') + (mine !== undefined && typeof mine.name === 'string' && mine.name !== '' ? ' « ' + mine.name + ' »' : '') + ' : ' + computerWords(w.state) + '.' }
          return h(Section, { kb: 'kaby-computer', title }, h('p', { className: 'kbk-sub', 'data-kb': 'kaby-computer-line' }, line), action)
        }
        // `referral` (the real Settings page of Simple, not the fallback sheet): Referral is a native screen the shell lists in the user agent (`KybernosCaps/…referral`), opened by the link the full app's
        // account menu uses (`kybernos://referral`), not by `open-screen`.
        const AccountSection = (p) => {
          useTick(bridge.subscribe)
          const s = bridge.shell()
          const can = (x) => s.screens.indexOf(x) >= 0
          const referral = p !== undefined && p !== null && p.referral === true && caps().indexOf('referral') >= 0
          return h(Section, { kb: 'kaby-account', title: kt('Compte et offre', 'Account and plan') },
            can('account') || can('plan') || can('where') || referral ? h('div', { className: 'kbk-inline' },
              can('account') ? h(Btn, { act: 'kaby-open-account', onClick: () => { bridge.openScreen('account') } }, kt('Mon compte', 'My account')) : null,
              can('plan') ? h(Btn, { act: 'kaby-open-plan', onClick: () => { bridge.openScreen('plan') } }, kt('Mon offre', 'My plan')) : null,
              can('where') ? h(Btn, { act: 'kaby-open-where', onClick: () => { bridge.openScreen('where') } }, kt('Où tourne Kybernos', 'Where Kybernos runs')) : null,
              referral ? h(Btn, { act: 'kaby-open-referral', onClick: () => { try { window.location.assign('kybernos://referral') } catch (e) { /* the shell handles the link */ } } }, kt('Parrainage', 'Referral')) : null)
              : h('p', { className: 'kbk-sub', 'data-kb': 'kaby-account-missing' }, kt('Ton compte et ton offre se gèrent dans l’écran de l’app. Cette version ne sait pas encore l’ouvrir d’ici.', 'Your account and plan are managed in the app’s own screen. This version cannot open it from here yet.')))
        }
        const HelpSection = () => {
          useTick(bridge.subscribe)
          const s = bridge.shell()
          return h(Section, { kb: 'kaby-help', title: kt('Aide et signalement', 'Help and report') },
            h('p', { className: 'kbk-sub' }, kt('Si une réponse est fausse ou déplacée, signale-la : le texte n’est joint que si tu le coches.', 'If an answer is wrong or inappropriate, report it: its text is attached only if you tick it.')),
            h('div', { className: 'kbk-inline kbk-help' }, h(appUi.ReportTail, { noText: true, labelled: true }), s.screens.indexOf('help') >= 0 ? h(Btn, { act: 'kaby-open-help', onClick: () => { bridge.openScreen('help') } }, kt('Aide', 'Help')) : null))
        }
        // « Need more? »: the line that asks the shell to switch to Advanced (the full app), in About (the app’s parts). Drawn only when the shell said, in `shell-state`, that it can (`capabilities.mode`, contract §9): the Kaby app of
        // the stores, which has no Advanced mode, never says so and never shows the line. The shell reloads the page in the other mode, so the button only says it is working.
        const ModeSection = () => {
          useTick(bridge.subscribe)
          const [busy, setBusy] = React.useState(false)
          if (bridge.shell().mode !== true) return null
          return h(Section, { kb: 'kaby-mode-switch', title: kt('Besoin de plus ?', 'Need more?') },
            h('p', { className: 'kbk-sub' }, kt('Le mode Avancé montre tout Kybernos : les modèles, les outils, les réglages du moteur. Tes conversations et ta mémoire restent les mêmes. Tu peux revenir au mode Simple quand tu veux.', 'Advanced mode shows all of Kybernos: the models, the tools, the engine settings. Your conversations and your memory stay the same. You can come back to Simple whenever you want.')),
            // one choice for the whole app: the display seam keeps it for the account, tells the shell (`set-mode`) and reloads; the shell's own message is the way when the seam is not there
            h(Btn, { act: 'kaby-mode-advanced', primary: true, disabled: busy, onClick: () => { const seam = window.__KB_MODE__; if (seam !== undefined && seam !== null && typeof seam.set === 'function') { setBusy(true); seam.set('complete') } else if (bridge.setMode('advanced')) setBusy(true) } }, busy ? kt('Changement de mode…', 'Switching mode…') : kt('Passer en Avancé', 'Switch to Advanced')))

        }

        // ── the card: « Kaby wants to connect X » ──
        const ConnectCard = () => {
          useTick(flow.subscribe)
          const r = flow.current()
          if (r === null) return null
          const name = r.name
          const errWords = {
            unsupported: kt('Cette version de l’app ne sait pas encore ouvrir la page de connexion. Mets l’app à jour.', 'This version of the app cannot open the sign-in page yet. Update the app.'),
            sheet: kt('La page de connexion n’a pas pu s’ouvrir.', 'The sign-in page could not be opened.'),
            needs_key: kt('Cette application demande une clé : à ajouter depuis l’ordinateur.', 'This app needs a key: add it from the computer.'),
            plan: kt('Ton offre ne comprend pas les applications connectées.', 'Your plan does not include connected apps.'),
            limit: kt('Tu as atteint le nombre d’applications que ton offre permet.', 'You have reached the number of apps your plan allows.'),
            pending_exists: kt('Une connexion à cette application attend déjà : termine-la dans le navigateur ou retire-la dans les réglages.', 'A connection to this app is already waiting: finish it in the browser or remove it in settings.'),
            signin: kt('Connecte-toi d’abord à ton compte Kybernos.', 'Sign in to your Kybernos account first.'),
            network: kt('Le réseau n’a pas répondu.', 'The network did not answer.'),
            on_computer: kt('Ça se fait depuis l’ordinateur, pas depuis le lien téléphone.', 'This is done from the computer, not through the phone link.'),
            unavailable: kt('Cette version de Kybernos n’offre pas encore les applications connectées.', 'This version of Kybernos does not offer connected apps yet.'),
            refused: kt('La connexion a été refusée. Tu peux réessayer.', 'The connection was refused. You can try again.'),
            other: kt('La connexion n’a pas abouti.', 'The connection did not work.')
          }
          let title = kt('Kaby veut se connecter à ' + name, 'Kaby wants to connect ' + name)
          let sub = kt('Kaby en a besoin pour faire ce que tu as demandé. Tu te connectes sur la page de ' + name + ', pas ici : Kaby ne voit pas ton mot de passe.', 'Kaby needs it to do what you asked. You sign in on ' + name + '’s own page, not here: Kaby never sees your password.')
          let buttons = [h(Btn, { key: 'y', act: 'kaby-connect-accept', primary: true, onClick: () => { void flow.accept(r.id) } }, kt('Connecter', 'Connect')), h(Btn, { key: 'n', act: 'kaby-connect-decline', onClick: () => { flow.decline(r.id) } }, kt('Pas maintenant', 'Not now'))]
          let busy = false
          if (r.phase === 'linking') { sub = kt('Préparation…', 'Getting ready…'); buttons = []; busy = true }
          else if (r.phase === 'authorizing') { title = kt('Termine dans la page de connexion', 'Finish in the sign-in page'); sub = kt('Une page s’est ouverte pour ' + name + '. Quand tu as fini, reviens ici.', 'A page opened for ' + name + '. When you are done, come back here.'); buttons = [h(Btn, { key: 'c', act: 'kaby-connect-cancel', onClick: () => { flow.decline(r.id) } }, kt('Annuler', 'Cancel'))]; busy = true }
          else if (r.phase === 'checking') { title = kt('Vérification…', 'Checking…'); sub = kt('Kaby vérifie que ' + name + ' est bien connecté.', 'Kaby is checking that ' + name + ' is connected.'); buttons = []; busy = true }
          else if (r.phase === 'not_yet') { title = kt(name + ' n’est pas encore connecté', name + ' is not connected yet'); sub = kt('Si tu as fini dans la page de connexion, vérifie à nouveau ; sinon rouvre-la.', 'If you finished in the sign-in page, check again; otherwise open it again.'); buttons = [h(Btn, { key: 'k', act: 'kaby-connect-check', primary: true, onClick: () => { flow.checkNow(r.id) } }, kt('Vérifier', 'Check again')), h(Btn, { key: 'o', act: 'kaby-connect-retry', onClick: () => { void flow.accept(r.id) } }, kt('Rouvrir la page', 'Open the page again')), h(Btn, { key: 'x', act: 'kaby-connect-close', onClick: () => { flow.decline(r.id) } }, kt('Fermer', 'Close'))] }
          else if (r.phase === 'connected') { title = kt(name + ' est connecté', name + ' is connected'); sub = kt('Kaby peut maintenant l’utiliser. Tu peux lui redemander.', 'Kaby can now use it. You can ask again.'); buttons = [h(Btn, { key: 'ok', act: 'kaby-connect-done', primary: true, onClick: () => { flow.close(r.id) } }, 'OK')] }
          else if (r.phase === 'failed') { title = kt('Connexion à ' + name + ' impossible', 'Could not connect ' + name); sub = errWords[r.error] || errWords.other; buttons = [(r.error === 'plan' || r.error === 'needs_key' || r.error === 'on_computer' || r.error === 'pending_exists' || r.error === 'unavailable' || r.error === 'unsupported') ? null : h(Btn, { key: 'r', act: 'kaby-connect-retry', primary: true, onClick: () => { void flow.accept(r.id) } }, kt('Réessayer', 'Try again')), h(Btn, { key: 'x', act: 'kaby-connect-close', onClick: () => { flow.decline(r.id) } }, kt('Fermer', 'Close'))].filter((b) => b !== null) }
          return h('div', { className: 'kbk-cardwrap' },
            h('div', { className: 'kbk-connect', 'data-kb': 'kaby-connect-card', 'data-kb-app': r.toolkit, 'data-kb-phase': r.phase, role: 'alertdialog', 'aria-label': title },
              h('p', { className: 'kbk-ctitle' }, busy ? h('span', { className: 'kbk-spin', 'aria-hidden': 'true' }) : null, title),
              h('p', { className: 'kbk-sub' }, sub),
              buttons.length > 0 ? h('div', { className: 'kbk-inline' }, buttons) : null))
        }

        // What only the phone can offer, put at the top of the app’s parts in About (they were the page « The Kybernos app » of Settings until item 28): notifications, where Kaby works, account and
        // plan (the shell's native screens), help and report, and « Need more? » (the way out of Simple). DSH's Settings has no page for any of them.
        const SimpleLead = () => h(React.Fragment, null, h(NotificationsSection, null), h(ComputerSection, null), h(AccountSection, { referral: true }), h(HelpSection, null), h(ModeSection, null))
        // What Simple draws of its own, in a React root on `<body>`: the connect card. Nothing else: the drawer, the account menu, Settings and the composer (its model picker included) are the full app's.
        const Root = () => h('div', { className: 'kbk-root' }, h(ConnectCard, null))

        const CSS = `
/* no box of its own: the card takes its place in the page's stacking order (over everything) */
html.${KABY_CLASS} .kbk-root{display:contents;font-family:inherit;color:var(--dsw-alias-label-primary, rgb(20,20,24))}
.kbk-card{display:flex;flex-direction:column;gap:10px;min-width:0;padding:16px;border-radius:14px;border:1px solid var(--dsw-alias-border-l1, rgba(128,128,140,.3));background:var(--dsw-alias-bg-layer-2, rgba(128,128,140,.06))}
.kbk-h{margin:0;font-size:15px;font-weight:650}
.kbk-sub{margin:0;font-size:14px;line-height:1.45;color:var(--dsw-alias-label-secondary, rgb(100,100,112))}
.kbk-inline{display:flex;flex-wrap:wrap;gap:8px}
.kbk-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary, rgb(76,110,245));outline-offset:2px}
.kbk-btn{min-height:44px;padding:8px 16px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2, rgba(128,128,140,.4));background:var(--dsw-alias-bg-layer-2, rgba(128,128,140,.08));color:inherit;font:inherit;font-size:15px;cursor:pointer}
.kbk-primary{background:var(--dsw-alias-label-primary, rgb(17,17,17));color:var(--dsw-alias-bg-layer-1, rgb(255,255,255));border-color:transparent;font-weight:600}
.kbk-btn:disabled{opacity:.45}
.kbk-help .kbrp{margin:0}.kbk-help .kbrp-open{min-height:44px;font-size:15px;padding:8px 16px;border:1px solid var(--dsw-alias-border-l2, rgba(128,128,140,.4));border-radius:10px;text-decoration:none}
/* the phone's CSS (mobile.css) makes every report button a 36 px flag with its word shifted out of sight: in this card the word is the point */
.kbk-help [data-kb="report-tail"] > button[data-act="report-open"]{display:inline-block;position:static;width:auto;height:auto;min-height:44px;padding:8px 16px;overflow:visible;white-space:normal;text-indent:0;font-size:15px;color:var(--dsw-alias-label-primary, inherit);background:transparent;border:1px solid var(--dsw-alias-border-l2, rgba(128,128,140,.4));border-radius:10px}
.kbk-help [data-kb="report-tail"] > button[data-act="report-open"]::before{content:none;display:none}
.kbk-cardwrap{position:fixed;left:0;right:0;bottom:0;z-index:73;display:flex;justify-content:center;box-sizing:border-box;padding:12px 12px calc(12px + var(--kb-sab, env(safe-area-inset-bottom, 0px)));background:linear-gradient(to top,rgba(0,0,0,.18),transparent);pointer-events:none}
.kbk-connect{pointer-events:auto;display:flex;flex-direction:column;gap:10px;width:100%;max-width:520px;box-sizing:border-box;padding:18px;border-radius:18px;border:1px solid var(--dsw-alias-border-l2, rgba(128,128,140,.35));background:var(--dsw-alias-bg-layer-1, rgb(255,255,255));box-shadow:0 10px 40px rgba(0,0,0,.28)}
.kbk-ctitle{display:flex;align-items:center;gap:8px;margin:0;font-size:17px;font-weight:650;line-height:1.3}
.kbk-spin{flex:none;width:16px;height:16px;border-radius:50%;border:2px solid rgba(128,128,140,.35);border-top-color:currentColor;animation:kbk-turn .9s linear infinite}
@keyframes kbk-turn{to{transform:rotate(360deg)}}
`

        /** Draws the chip and the card in a React root of their own on `<body>` (no slot, no DSH page). */
        const mount = () => {
          if (roots === null || roots === undefined || typeof roots.createRoot !== 'function') throw new Error('no React root')
          const box = document.createElement('div')
          box.setAttribute('data-kb', 'kaby-root')
          document.body.appendChild(box)
          const root = roots.createRoot(box)
          root.render(h(Root, null))
          return () => { try { root.unmount() } catch (e) { /* gone */ } try { box.remove() } catch (e) { /* gone */ } }
        }
        return { CSS, mount, Root, ConnectCard, NotificationsSection, ComputerSection, AccountSection, HelpSection, ModeSection, SimpleLead }
      }

      /** Mounts Kaby mode: the extended `__KB_APP__`, the classes, the styles, the report link, the app’s parts in About and the card. Called once, in the app branch of `apply`. */
      const mountKaby = (ctx, React, roots, app, kaby) => {
        const appUi = buildAppUi(React, app)
        const bridge = buildKabyBridge(window, app, kaby)
        const flow = buildConnectFlow(bridge, { fetchJson: kabyFetchJson, setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (t) => clearTimeout(t) })
        const ui = buildKabyUi(React, roots, app, kaby, bridge, flow, appUi)
        ctx.inject(['slots'], (scope) => {
          try {
            const slots = scope !== undefined && scope !== null ? scope.slots : null
            let triggers = null
            // a component that draws nothing: it only tells the triggers that an answer finished
            const TurnProbe = () => { React.useEffect(() => { try { if (triggers !== null) triggers.turnDone() } catch (e) { /* never drawn */ } }, []); return null }
            ctx.effect(() => {
              const mine = {
                version: 1, platform: app.platform, appVersion: app.version,
                // `openSettings()` is the app's own key screen as before; `openSettings('account' | 'plan' | 'help' | 'notification-settings')` asks the shell for that screen (only those it said it has)
                openSettings: (screen) => (screen === undefined ? appUi.open('settings') : bridge.openScreen(screen)),
                openLog: () => appUi.open('log'),
                mode: 'kaby', modeVersion: kaby.version, receive: bridge.receive, shell: bridge.shell, requestMode: (m) => bridge.setMode(m),
                requestConnect: (r) => flow.request(r), askNotifications: (why) => bridge.askNotifications(why)
              }
              try { window.__KB_APP__ = mine } catch (e) { /* frozen window */ }
              let root = null
              try { root = document.documentElement; root.classList.add('kb-app', 'kb-app-' + app.platform, KABY_CLASS) } catch (e) { root = null }
              // the same words, from a bundle that has no handle on __KB_APP__: `window.dispatchEvent(new CustomEvent('kb-connect-request', { detail: { toolkit, name } }))`
              const onRequest = (e) => { try { flow.request(e.detail) } catch (err) { /* a malformed request is dropped */ } }
              try { window.addEventListener('kb-connect-request', onRequest) } catch (e) { /* no window */ }
              return () => {
                try { window.removeEventListener('kb-connect-request', onRequest) } catch (e) { /* gone */ }
                try { if (window.__KB_APP__ === mine) delete window.__KB_APP__ } catch (e) { /* gone */ }
                try { if (root !== null) root.classList.remove('kb-app', 'kb-app-' + app.platform, KABY_CLASS) } catch (e) { /* gone */ }
              }
            }, 'kybernos-mobile: kaby mode hooks')
            ctx.effect(() => {
              const style = document.createElement('style')
              style.dataset.plugin = '@local/kybernos-mobile'
              style.textContent = appUi.CSS + ui.CSS
              document.head.appendChild(style)
              const undo = [() => style.remove()]
              // the rules normally arrive with the page (index-inject); when they did not, link them
              if (document.getElementById(KABY_STYLE_ID) === null && document.getElementById(KABY_LINK_ID) === null) {
                const link = document.createElement('link')
                link.id = KABY_LINK_ID
                link.rel = 'stylesheet'
                try { link.href = new URL('kybernos-mobile/kaby.css', document.baseURI).pathname } catch (e) { link.href = '/kybernos-mobile/kaby.css' }
                document.head.appendChild(link)
                undo.push(() => link.remove())
              }
              return () => { for (const f of undo) { try { f() } catch (e) { /* gone */ } } }
            }, 'kybernos-mobile: kaby mode styles')
            ctx.effect(() => { try { return ui.mount() } catch (e) { try { console.warn('[kybernos-mobile] kaby chip not drawn:', e) } catch (e2) { /* no console */ } return () => {} } }, 'kybernos-mobile: kaby answer chip and connect card')
            ctx.effect(() => { triggers = startNotificationTriggers(window, document, bridge); return () => { try { triggers.stop() } catch (e) { /* gone */ } triggers = null } }, 'kybernos-mobile: kaby notification triggers')
            ctx.effect(() => { try { const w = startPlaceholder(window, document, kabyAsk); return () => w.stop() } catch (e) { return () => {} } }, 'kybernos-mobile: kaby composer sentence')
            ctx.effect(() => { try { const w = startPhoneWords(window, document); return () => w.stop() } catch (e) { return () => {} } }, 'kybernos-mobile: kaby phone wording')
            ctx.effect(() => aboutAdd({ id: 'kybernos-app', order: 20, component: () => React.createElement(appUi.Page, { simple: true, embedded: true, lead: React.createElement(ui.SimpleLead) }) }), 'kybernos-mobile: the app’s parts in About (Kaby mode)')
            if (slots !== null && slots !== undefined && typeof slots.inject === 'function') {
              // the report control under each finished answer (store rules), as in the full app
              ctx.effect(() => slots.inject('conversation.chat.turnTail', () => slots.register(
                { name: 'conversation.chat.turnTail', id: 'kybernos-mobile-report', order: 90 },
                (p) => React.createElement(appUi.ReportTail, p))), 'kybernos-mobile: report an AI answer')
              // « The Kybernos app » is no longer a Settings page of Simple (owner's list, item 28: it doubled About): its parts (notifications, where Kaby works, account and plan, help and report, « Need more? »,
              // app settings, licences, automations on this phone) are drawn INSIDE « About » (the maintenance bundle), nothing deleted. See `aboutAdd`.
              // a finished answer is a moment the page may have reason to ask for notifications (never drawn)
              ctx.effect(() => slots.inject('conversation.chat.turnTail', () => slots.register(
                { name: 'conversation.chat.turnTail', id: 'kybernos-mobile-kaby-turn', order: 1 },
                () => React.createElement(TurnProbe))), 'kybernos-mobile: kaby finished answers')
            }
            // the shell hears that Kaby mode is on (and answers with `shell-state`); the old entry message is kept for a shell that still waits for it
            bridge.ready()
            try { if (window.ReactNativeWebView !== undefined && typeof window.ReactNativeWebView.postMessage === 'function') window.ReactNativeWebView.postMessage(JSON.stringify({ kybernos: 'app-entry', entry: 'settings', version: 1 })) } catch (e) { /* the app keeps its gear */ }
          } catch (e) { try { console.warn('[kybernos-mobile] kaby mode not mounted:', e) } catch (e2) { /* no console */ } }
        })
      }

      // ── A new chat on the phone never stays dead ──
      // The engine greys the composer and writes « Choose a workspace to start » when the chat on screen has no workspace: no chat is open, or the blank one is held by no workspace. At the start of
      // the app it restores the last chat by itself, but that step can end without a chat (measured twice on a phone cold-started in airplane mode: the page up, the composer dead, the model chip
      // and the type cards gone, nothing saying what to do, still dead two minutes later; picking a workspace by hand brought everything back). So, inside the app, the page watches for that state after
      // the start. It does NOT wait for the engine's stores to say « loaded » (offline they may never): it reads the screen itself (the Home headline is up and the composer's field is not editable) as well
      // as the stores. When the state has lasted a few seconds it does what the person would do: opens a chat, through the engine's own `startSession`, in the workspace used last, or the only one, or Kaby's.
      // And whatever the stores say, after about 14 s it writes one line above the composer telling what to do (a button that opens the menu). It does nothing once a chat with a workspace is open.
      // `window.__KB_HOME_RECOVERY__.state()` reads, without changing anything, what it sees (service, stores, screen, timers) for a person who has to find out why it did not act.
      const HOME_STABLE_MS = 6000   // dead this long in a row before the first try: the engine's own restore has had its chance
      const HOME_RETRY_MS = 5000
      const HOME_TRIES = 4
      const HOME_LINE_MS = 14000    // dead this long, whatever the stores say: the line
      const HOME_FORCE_MS = 25000   // dead this long: an open menu or sheet no longer holds the recovery back
      const HOME_WATCH_MS = 120000
      const HOME_LINE_ATTR = 'data-kbmob-pick-line'
      const holderOf = (items, sessionId) => {
        for (const it of items) { if (it !== null && typeof it === 'object' && Array.isArray(it.sessionIds) && it.sessionIds.indexOf(sessionId) >= 0) return it }
        return null
      }
      /** The workspace to open a chat in: the only one; else the one with the most recent chat (the engine's own « recent » rule); with no chat anywhere, the one called Kaby, else the newest. */
      const homeTarget = (items, byId) => {
        const list = items.filter((it) => it !== null && typeof it === 'object' && typeof it.workspaceId === 'string' && it.workspaceId.length > 0)
        if (list.length === 0) return null
        if (list.length === 1) return list[0].workspaceId
        let best = null
        let bestAt = -Infinity
        for (const it of list) {
          let latest = -Infinity
          for (const sid of Array.isArray(it.sessionIds) ? it.sessionIds : []) { const s = byId[sid]; if (s !== null && s !== undefined && typeof s.updatedAt === 'number' && s.updatedAt > latest) latest = s.updatedAt }
          if (latest > bestAt) { best = it; bestAt = latest }
        }
        if (best !== null) return best.workspaceId
        const kaby = list.find((it) => /^kaby$/i.test(String(it.title === undefined || it.title === null ? '' : it.title).trim()))
        if (kaby !== undefined) return kaby.workspaceId
        let newest = list[0]
        for (const it of list) { if (Date.parse(String(it.createdAt)) > Date.parse(String(newest.createdAt))) newest = it }
        return newest.workspaceId
      }
      /** What the engine's stores say. `known`: the workspaces are loaded (the chats may still be loading, offline they may stay so: they are not waited for). `dead`: the engine's own rule for the greyed composer: no chat is
       *  open, or the open one is blank (or not in the chat list at all) and no workspace holds it. `target`: the workspace to open a chat in. */
      const homeState = (uw) => {
        const out = { known: false, ready: false, dead: false, target: null, none: false, wphase: null, sphase: null, items: 0, sid: null, blank: null, held: null }
        try {
          const wl = uw.workspaces.list.getSnapshot()
          const sl = uw.sessions.list.getSnapshot()
          out.wphase = wl === null || wl === undefined ? null : wl.phase
          out.sphase = sl === null || sl === undefined ? null : sl.phase
          if (wl === null || wl === undefined || wl.phase !== 'ready') return out
          out.known = true
          out.ready = out.sphase === 'ready'
          const items = Array.isArray(wl.items) ? wl.items : []
          const byId = sl !== null && sl !== undefined && sl.byId !== null && sl.byId !== undefined && typeof sl.byId === 'object' ? sl.byId : {}
          out.items = items.length
          const ref = uw.mainReference
          if (ref === null || ref === undefined) out.dead = true
          else if (typeof ref.sessionId === 'string' && ref.sessionId.length > 0) {
            const summary = byId[ref.sessionId]
            out.sid = ref.sessionId
            out.blank = summary === null || summary === undefined ? null : summary.blank === true
            out.held = holderOf(items, ref.sessionId) !== null
            out.dead = out.held === false && (summary === null || summary === undefined || summary.blank === true)
          }
          out.target = homeTarget(items, byId)
          out.none = items.length === 0
        } catch (e) { out.known = false; out.dead = false }
        return out
      }
      /** What the screen says: the Home headline is up and the composer's field is not editable (the engine's greyed composer; a conversation never has the headline). No store is read. */
      const homeDomDead = (doc) => {
        try {
          const input = doc.querySelector('[data-composer-input]')
          return input !== null && input !== undefined && doc.querySelector('[data-kb-hero]') !== null && input.getAttribute('contenteditable') === 'false'
        } catch (e) { return false }
      }
      const startHomeRecovery = (win, doc, getService, opts = {}) => {
        const now = typeof opts.now === 'function' ? opts.now : () => Date.now()
        const every = typeof opts.setInterval === 'function' ? opts.setInterval : (fn, ms) => win.setInterval(fn, ms)
        const unevery = typeof opts.clearInterval === 'function' ? opts.clearInterval : (id) => win.clearInterval(id)
        const startedAt = now()
        let until = startedAt + HOME_WATCH_MS
        let rawSince = null    // since when the screen or the stores say dead (whatever else)
        let deadSince = null   // the same, restarted while the person is choosing: what the first try waits for
        let tries = 0
        let lastTry = -Infinity
        let lastTickAt = null
        let lineOn = false
        let timer = null
        let stopped = false
        // The person is choosing when the drawer is open, or a menu, a list or a sheet is on screen. The drawer is also a dialog that is always in the page, parked just off the left edge while it is closed: only what is
        // on the screen counts.
        const choosing = () => {
          try {
            const f = doc.querySelector('[data-slot="root"] > div')
            if (f !== null && f !== undefined && !f.hasAttribute('data-sidebar-collapsed')) return true
            const w = typeof win.innerWidth === 'number' ? win.innerWidth : 0
            const h = typeof win.innerHeight === 'number' ? win.innerHeight : 0
            for (const e of Array.prototype.slice.call(doc.querySelectorAll('[role="dialog"], [role="menu"], [role="listbox"]'))) {
              const r = e.getBoundingClientRect()
              if (r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < w && r.top < h) return true
            }
            return false
          } catch (e) { return false }
        }
        const line = (on) => {
          try {
            const have = doc.querySelector('[' + HOME_LINE_ATTR + ']')
            if (!on) { if (have !== null) have.remove(); lineOn = false; return }
            if (have !== null) { lineOn = true; return }
            const ph = doc.querySelector('[data-composer-placeholder]')
            const card = ph === null ? null : ph.closest('[data-composer-card]')
            if (card === null || card.parentNode === null) return
            // A button, not a bare sentence: the engine's own workspace chip of the home is parked out of sight on a phone, and the drawer is where the workspaces are (the « + » of a workspace row starts a chat in it).
            const p = doc.createElement('button')
            p.setAttribute('type', 'button')
            p.setAttribute(HOME_LINE_ATTR, '')
            p.textContent = kt('Ouvre le menu (en haut à gauche) et touche « + » à côté d’un espace de travail pour commencer.', 'Open the menu (top left) and tap “+” next to a workspace to start.')
            p.addEventListener('click', () => { try { const m = doc.querySelector('.' + MENU_CLASS); if (m !== null) m.click() } catch (e) { /* no menu button */ } })
            card.parentNode.insertBefore(p, card)
            lineOn = true
          } catch (e) { /* cosmetic */ }
        }
        const service = () => { try { const v = getService(); return v === null || v === undefined ? null : v } catch (e) { return null } }
        /** Everything the recovery sees, computed fresh, changing nothing. */
        const look = () => {
          const uw = service()
          const st = uw === null ? { known: false, ready: false, dead: false, target: null, none: false, wphase: null, sphase: null, items: 0, sid: null, blank: null, held: null } : homeState(uw)
          const dom = homeDomDead(doc)
          return { service: uw !== null, ...st, storeDead: st.dead, domDead: dom, dead: dom || st.dead, choosing: choosing(), rawSince, deadSince, tries, lastTry: lastTry === -Infinity ? null : lastTry, line: lineOn, running: timer !== null, startedAt, until, lastTickAt, now: now(), visible: doc.visibilityState }
        }
        const open = (uw, st) => {
          try {
            if (st.target !== null) { uw.startSession(st.target); return }
            if (st.none === true && uw.workspaces !== undefined && typeof uw.workspaces.initializeDefault === 'function') {
              const made = uw.workspaces.initializeDefault(new AbortController().signal)
              Promise.resolve(made).then((w) => { if (w !== null && w !== undefined && typeof w.workspaceId === 'string') uw.startSession(w.workspaceId) }, () => { /* the engine says it itself */ })
            }
          } catch (e) { /* the next try; the line is there anyway */ }
        }
        const tick = () => {
          if (stopped) return
          const t = now()
          lastTickAt = t
          if (t > until) { pause(); return }
          const uw = service()
          const st = uw === null ? { dead: false, target: null, none: false } : homeState(uw)
          const dead = homeDomDead(doc) || st.dead
          if (!dead) { rawSince = null; deadSince = null; line(false); return }
          if (rawSince === null) rawSince = t
          if (t - rawSince >= HOME_LINE_MS) line(true)
          // someone choosing in the drawer, a menu or a sheet holds the recovery back, but not for ever
          if (choosing() && t - rawSince < HOME_FORCE_MS) { deadSince = null; return }
          if (deadSince === null) deadSince = t
          if (t - deadSince < HOME_STABLE_MS) return
          if (uw === null || tries >= HOME_TRIES) return
          if (t - lastTry < HOME_RETRY_MS) return
          tries += 1
          lastTry = t
          open(uw, st)
        }
        const pause = () => { if (timer !== null) { try { unevery(timer) } catch (e) { /* gone */ } timer = null } line(false) }
        // back in the foreground (or the network came back) after a watch ended: one more watch, with fresh tries
        const again = () => { if (stopped) return; until = now() + 30000; tries = 0; deadSince = null; rawSince = null; if (timer === null) timer = every(tick, 1500) }
        const onVisible = () => { try { if (doc.visibilityState === 'visible') again() } catch (e) { /* gone */ } }
        timer = every(tick, 1500)
        try { doc.addEventListener('visibilitychange', onVisible); win.addEventListener('online', again) } catch (e) { /* no events */ }
        const api = Object.freeze({ state: () => look() })
        try { win.__KB_HOME_RECOVERY__ = api } catch (e) { /* frozen window */ }
        const stop = () => {
          stopped = true
          try { doc.removeEventListener('visibilitychange', onVisible); win.removeEventListener('online', again) } catch (e) { /* gone */ }
          try { if (win.__KB_HOME_RECOVERY__ === api) delete win.__KB_HOME_RECOVERY__ } catch (e) { /* gone */ }
          pause()
        }
        return { tick, stop, again, state: look, tries: () => tries, running: () => timer !== null }
      }

      return {
        name: 'kybernos-mobile',
        apply (ctx) {
          const start = () => {
            ctx.effect(() => {
              try { return mount() } catch (e) { try { console.warn('[kybernos-mobile] not mounted:', e) } catch (e2) { /* no console */ } return () => {} }
            }, 'kybernos-mobile: menu button and drawer taps')
          }
          // The body may not exist yet when the bundle activates.
          if (document.body) start()
          else document.addEventListener('DOMContentLoaded', start, { once: true })
          // Inside the app only: a new chat never stays dead (see startHomeRecovery). The watcher starts at once and finds the engine's workspace service when it is there (it must not wait for it: the
          // line it writes, and the screen it reads, need no service). Apart from the layout and from the phone link, each in its own try/catch.
          try {
            if (appHost() !== null) {
              let svc = null
              const getSvc = () => {
                if (svc !== null) return svc
                try { const v = ctx.get('uiWorkspace'); if (v !== undefined && v !== null) svc = v } catch (e) { /* not there yet */ }
                return svc
              }
              try {
                if (typeof ctx.inject === 'function') {
                  ctx.inject(['uiWorkspace'], (scope) => {
                    try { const v = scope !== undefined && scope !== null && scope.uiWorkspace !== undefined && scope.uiWorkspace !== null ? scope.uiWorkspace : ctx.get('uiWorkspace'); if (v !== undefined && v !== null) svc = v } catch (e) { /* the watcher asks again */ }
                  })
                }
              } catch (e) { /* the watcher asks by itself */ }
              ctx.effect(() => { const r = startHomeRecovery(window, document, getSvc); return () => { try { r.stop() } catch (e) { /* gone */ } } }, 'kybernos-mobile: a new chat never stays dead')
            }
          } catch (e) { try { console.warn('[kybernos-mobile] home recovery disabled:', e) } catch (e2) { /* no console */ } }
          // The phone link, apart: it needs React and the settings slots, and nothing it does may touch the layout.
          try {
            if (typeof ctx.inject === 'function' && typeof require === 'function') {
              const React = require('react')
              // A React root to draw the window in: `react-dom/client` (React 19), else `react-dom` when it still offers createRoot (React 18).
              let roots = null
              for (const name of ['react-dom/client', 'react-dom']) {
                try { const m = require(name); if (roots === null && m !== undefined && m !== null && typeof m.createRoot === 'function') roots = m } catch (e) { /* not offered */ }
              }
              const app = appHost()
              // Kaby mode (the shell asked for it in the user agent): the conversation and its small settings page instead of the whole workbench. Without the token this is null and nothing below changes.
              const kabyAsked = app !== null ? kabyMode() : null
              if (app !== null && kabyAsked !== null) { mountKaby(ctx, React, roots, app, kabyAsked); return }
              if (app !== null) {
                // Inside the Kybernos app: its own page instead of the phone link, a few hooks for the other bundles, and a word to the app so it can drop its fallback gear button.
                const appUi = buildAppUi(React, app)
                ctx.inject(['slots'], (scope) => {
                  try {
                    const slots = scope !== undefined && scope !== null ? scope.slots : null
                    ctx.effect(() => {
                      const mine = { version: 1, platform: app.platform, appVersion: app.version, openSettings: () => appUi.open('settings'), openLog: () => appUi.open('log'), receive: receiveShell }
                      try { window.__KB_APP__ = mine } catch (e) { /* frozen window */ }
                      let root = null
                      try { root = document.documentElement; root.classList.add('kb-app', 'kb-app-' + app.platform) } catch (e) { root = null }
                      return () => {
                        try { if (window.__KB_APP__ === mine) delete window.__KB_APP__ } catch (e) { /* gone */ }
                        try { if (root !== null) root.classList.remove('kb-app', 'kb-app-' + app.platform) } catch (e) { /* gone */ }
                      }
                    }, 'kybernos-mobile: app host hooks')
                    ctx.effect(() => {
                      const style = document.createElement('style')
                      style.dataset.plugin = '@local/kybernos-mobile'
                      style.textContent = appUi.CSS
                      document.head.appendChild(style)
                      return () => style.remove()
                    }, 'kybernos-mobile: app page styles')
                    if (slots !== null && slots !== undefined && typeof slots.inject === 'function') {
                      ctx.effect(() => slots.inject('settings.section', () => slots.register(
                        { name: 'settings.section', id: 'kybernos-mobile', order: 45, label: kt('L’app Kybernos', 'The Kybernos app') },
                        () => React.createElement(appUi.Page))), 'kybernos-mobile: app settings section')
                    }
                    // The report control under each finished answer (store rules: a way to flag an AI answer from inside the app). `turnTail` runs for completed turns only.
                    if (slots !== null && slots !== undefined && typeof slots.inject === 'function') {
                      ctx.effect(() => slots.inject('conversation.chat.turnTail', () => slots.register(
                        { name: 'conversation.chat.turnTail', id: 'kybernos-mobile-report', order: 90 },
                        (p) => React.createElement(appUi.ReportTail, p))), 'kybernos-mobile: report an AI answer')
                    }
                    // The app shows a small gear button until the interface says it has the entry (kybernos://settings is caught by its WebView).
                    try { if (window.ReactNativeWebView !== undefined && typeof window.ReactNativeWebView.postMessage === 'function') window.ReactNativeWebView.postMessage(JSON.stringify({ kybernos: 'app-entry', entry: 'settings', version: 1 })) } catch (e) { /* the app keeps its gear */ }
                  } catch (e) { try { console.warn('[kybernos-mobile] app page not mounted:', e) } catch (e2) { /* no console */ } }
                })
                return
              }
              const ui = buildRemoteUi(React, roots)
              ctx.inject(['slots'], (scope) => {
                try {
                  const slots = scope !== undefined && scope !== null ? scope.slots : null
                  ctx.effect(() => {
                    // `open()` draws the window (the account menu's entry in kybernos-cloud and Kaby's strip call it); the entry is offered only while this is there.
                    const mine = { version: 3, Dialog: ui.Dialog, open: ui.open }
                    try { window.__KB_MOBILE__ = mine } catch (e) { /* frozen window */ }
                    return () => { try { if (window.__KB_MOBILE__ === mine) delete window.__KB_MOBILE__ } catch (e) { /* gone */ } }
                  }, 'kybernos-mobile: phone and channels window for the account menu')
                  ctx.effect(() => {
                    const style = document.createElement('style')
                    style.dataset.plugin = '@local/kybernos-mobile'
                    style.textContent = ui.CSS
                    document.head.appendChild(style)
                    return () => style.remove()
                  }, 'kybernos-mobile: phone and channels styles')
                  if (slots !== null && slots !== undefined && typeof slots.inject === 'function') {
                    ctx.effect(() => slots.inject('settings.section', () => slots.register(
                      { name: 'settings.section', id: 'kybernos-mobile', order: 45, label: kt('Téléphone et canaux', 'Phone and channels') },
                      () => React.createElement(ui.Page))), 'kybernos-mobile: settings section')
                  }
                } catch (e) { try { console.warn('[kybernos-mobile] phone link not mounted:', e) } catch (e2) { /* no console */ } }
              })
            }
          } catch (e) { try { console.warn('[kybernos-mobile] phone link disabled:', e) } catch (e2) { /* no console */ } }
        },
        __test: { buildModeSeam, buildModeSegment, buildModeSheet, buildModeCommands, bootMode, MODE_PREFS, modeText, shellModeRequest, handOn, homeState, homeTarget, homeDomDead, startHomeRecovery, HOME_TRIES, HOME_STABLE_MS, HOME_RETRY_MS, HOME_LINE_MS, HOME_FORCE_MS, HOME_LINE_ATTR, parseKabyMode, buildKabyBridge, buildConnectFlow, startNotificationTriggers, buildKabyUi, KABY_OUT, KABY_IN, KABY_SCREENS, KABY_WHY, KABY_APPROVAL, computerWords, kabyFetchJson, REPORT_REASONS, REPORT_CONTACT, reportMessage, textBefore, submitReport, reportMailto, parseAppHost, decide, drawerTop, startDrawerTop, DRAWER_TOP_MS, drawerOpen, narrow, toggle, PICKS, KEEP_OPEN, TOGGLE, SIDEBAR_BUTTONS, MEDIA, SHEET_ID, MENU_CLASS, isParked, parkedActions, ACTION_BUTTONS, MORE_BUTTON, swipeCloses, fitKinds, FIT_ATTR, collapseButton, leadTarget, LEAD_ATTR, parseCaps, layerList, createLayers, receiveShell, shellPost, SHEET_SEL, DROPDOWN_SEL, SETTINGS_PAGE_ATTR, buildAppUi, MODES, kabyAsk, placeholderPass, startPlaceholder, COMPOSER_TRIES, composerFocusStep, giveComposerFocus, PHONE_WORDS, PHONE_WORDS_ROOTS, phoneWordsText, phoneWordsPass, startPhoneWords, kabyPlace }
      }
    } catch (e) {
      try { console.warn('[kybernos-mobile] disabled:', e) } catch (e2) { /* no console */ }
      return { name: 'kybernos-mobile', apply () {} }
    }
  }
})
