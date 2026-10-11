// kybernos-mobile: browser half.
//
// The look of the phone layout is mobile.css (the host puts it in the page before the first paint). This half is the
// three things a stylesheet cannot do:
//
//   · a menu button in the corner (on a phone the sidebar is a drawer; its own open button is hidden with it),
//   · a tap on the dimmed chat closes the drawer,
//   · picking a session or a page in the drawer closes it, so the chat is what you see next.
//
// It never keeps a state of its own: the drawer is open when DSH says its sidebar is not collapsed, and it is opened
// and closed by clicking DSH's own toggle (the button with the "<modifiers>+B" shortcut, found by that shortcut and
// not by its label, which is translated). Nothing here runs above 700 px.
//
// CONTRACT OF THE RUNNER: the factory must RETURN a plugin object (`apply`). On any failure it returns a disabled one:
// the GUI is preserved.
window.__ModuleLoader__.load({
  id: '@local/kybernos-mobile',
  factory() {
    try {
      const MEDIA = '(max-width: 700px)'
      const SHEET_ID = 'kbmob-sheet'
      const LINK_ID = 'kbmob-sheet-link'
      const MENU_CLASS = 'kbmob-menu'
      // The left sidebar's toggle carries the shortcut "<modifiers>+B" (Alt+Meta+B on a Mac, another pair elsewhere);
      // the right bar's has Shift in it. The label is translated, the shortcut is not.
      const TOGGLE = 'button[aria-keyshortcuts$="+B"]:not([aria-keyshortcuts*="Shift"])'
      const FIRST_IN_SIDEBAR = '[data-slot="sidebar"] button'
      // What a tap on closes the drawer: a session, one of our own sidebar entries, DSH's page list (Plugins, …).
      const PICKS = '[data-row-key^="session:"], .kb4-item, .kb4-newchat, [data-slot^="sidebar.panellist"] button'

      const lang = () => { try { return String(window.__KB_LANG_RESOLVE__ ? window.__KB_LANG_RESOLVE__() : '').split(/[-_]/)[0] } catch (e) { return 'fr' } }
      const kt = (fr, en) => (lang() === 'en' ? en : fr)

      const narrow = () => { try { return window.matchMedia(MEDIA).matches === true } catch (e) { return false } }
      const frame = () => { try { return document.querySelector('[data-slot="root"] > div') } catch (e) { return null } }
      /** Open = the frame exists and DSH does not mark its sidebar collapsed. Always false when the screen is not narrow. */
      const drawerOpen = () => {
        if (!narrow()) return false
        const f = frame()
        return f !== null && f !== undefined && !f.hasAttribute('data-sidebar-collapsed')
      }
      /** DSH's own sidebar toggle, found by its shortcut. A DSH where that shortcut was rebound: while the drawer is
       *  closed the first button of the sidebar is its open button (the close button is DSH's own, in the drawer). */
      const toggle = () => {
        try {
          const byShortcut = document.querySelector(TOGGLE)
          if (byShortcut !== null && byShortcut !== undefined) return byShortcut
          if (!drawerOpen()) return document.querySelector(FIRST_IN_SIDEBAR)
        } catch (e) { /* no toggle: the buttons do nothing */ }
        return null
      }
      const flip = () => {
        const b = toggle()
        if (b !== null && b !== undefined) { try { b.click() } catch (e) { /* the toggle went away */ } }
      }
      const closeDrawer = () => { if (drawerOpen()) flip() }

      /** Click handling, as a pure function of the event target: what the page should do with this tap. */
      const decide = (target, frameEl, open) => {
        if (open !== true || target === null || target === undefined) return 'none'
        if (frameEl !== null && frameEl !== undefined && target === frameEl) return 'close' // the mask is the frame's own ::before
        try {
          if (typeof target.closest === 'function' && target.closest('[data-slot="sidebar"]') !== null && target.closest(PICKS) !== null) return 'close-after'
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
        return svg
      }

      const mount = () => {
        const undo = []
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
        button.setAttribute('aria-label', kt('Ouvrir le menu', 'Open the menu'))
        button.appendChild(menuIcon())
        button.addEventListener('click', (e) => { e.stopPropagation(); flip() })
        document.body.appendChild(button)
        undo.push(() => button.remove())

        const onClick = (e) => {
          const act = decide(e.target, frame(), drawerOpen())
          if (act === 'close') { e.stopPropagation(); flip() } else if (act === 'close-after') setTimeout(closeDrawer, 120)
        }
        document.addEventListener('click', onClick, true)
        undo.push(() => document.removeEventListener('click', onClick, true))
        return () => { for (const f of undo.reverse()) { try { f() } catch (e) { /* already gone */ } } }
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
        },
        __test: { decide, drawerOpen, narrow, toggle, PICKS, TOGGLE, FIRST_IN_SIDEBAR, MEDIA, SHEET_ID, MENU_CLASS }
      }
    } catch (e) {
      try { console.warn('[kybernos-mobile] disabled:', e) } catch (e2) { /* no console */ }
      return { name: 'kybernos-mobile', apply () {} }
    }
  }
})
