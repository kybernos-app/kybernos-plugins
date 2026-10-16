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
// The second half of the file is the phone LINK (Settings › Remote Control and the sidebar's phone panel): see buildRemoteUi.
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
      const FIRST_IN_SIDEBAR = '[data-slot="sidebar"] button'
      // What a tap on closes the drawer: a session, one of our own sidebar entries, DSH's page list (Plugins, ...) and its
      // global panels (Automation tasks: the buttons of a nav in the sidebar).
      const PICKS = '[data-row-key^="session:"], .kb4-item, .kb4-newchat, [data-slot^="sidebar.panellist"] button, [data-slot="sidebar"] nav > button'

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

      const narrow = () => { try { return window.matchMedia(MEDIA).matches === true } catch (e) { return false } }
      const frame = () => { try { return document.querySelector('[data-slot="root"] > div') } catch (e) { return null } }
      /** Open = the frame exists and DSH does not mark its sidebar collapsed. Always false when the screen is not narrow. */
      const drawerOpen = () => {
        if (!narrow()) return false
        const f = frame()
        return f !== null && f !== undefined && !f.hasAttribute('data-sidebar-collapsed')
      }
      /** The collapse button of the OPEN drawer, found by where it is: the narrow button at the end of the sidebar's first
       *  row. DSH draws no `aria-keyshortcuts` on a phone (measured on Android, 2026-10-13: none at all), and its label is
       *  translated. Of the narrow buttons of the sidebar, the highest one (ties: the right-most). */
      const collapseButton = () => {
        try {
          let best = null
          for (const b of Array.prototype.slice.call(document.querySelectorAll(FIRST_IN_SIDEBAR))) {
            const r = b.getBoundingClientRect()
            if (r.width < 1 || r.height < 1 || r.width > 56) continue
            if (best === null || r.top < best.top - 1 || (Math.abs(r.top - best.top) <= 1 && r.left > best.left)) best = { el: b, top: r.top, left: r.left }
          }
          return best === null ? null : best.el
        } catch (e) { return null }
      }
      /** DSH's own sidebar toggle: by its shortcut where DSH draws one; else, while the drawer is closed, the first button
       *  of the sidebar is its open button; else, while it is open, its collapse button (see collapseButton). */
      const toggle = () => {
        try {
          const byShortcut = document.querySelector(TOGGLE)
          if (byShortcut !== null && byShortcut !== undefined) return byShortcut
          if (!drawerOpen()) return document.querySelector(FIRST_IN_SIDEBAR)
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
        const relabel = () => { try { button.setAttribute('aria-label', kt('Ouvrir le menu', 'Open the menu')) } catch (e) { /* the button went away */ } }
        relabel()
        for (const ev of ['focus', 'pointerenter', 'touchstart']) button.addEventListener(ev, relabel, { passive: true })
        try { window.addEventListener('kybernos-lang-change', relabel); undo.push(() => window.removeEventListener('kybernos-lang-change', relabel)) } catch (e) { /* no window */ }
        button.appendChild(menuIcon())
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
          sheet = null
        }
        const row = (label, icon, run) => {
          const b = document.createElement('button')
          b.type = 'button'
          b.className = 'kbmob-sheet-row'
          if (icon !== null && icon !== undefined) b.appendChild(icon)
          else { const none = document.createElement('span'); none.className = 'kbmob-sheet-noico'; try { if (none.style) none.style.cssText = 'flex:none;width:22px;height:22px' } catch (err) { /* no style */ } b.appendChild(none) }
          const t = document.createElement('span')
          t.textContent = label
          b.appendChild(t)
          b.addEventListener('click', (e) => { try { e.stopPropagation() } catch (err) { /* synthetic */ } closeSheet(); setTimeout(run, 60) })
          return b
        }
        const openSheet = (items, more) => {
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
          title.textContent = kt('Cette session', 'This session')
          panel.appendChild(title)
          for (const it of items) {
            let icon = null
            try { const svg = it.el.querySelector('svg'); if (svg !== null && svg !== undefined) icon = svg.cloneNode(true) } catch (err) { icon = null }
            panel.appendChild(row(it.label, icon, () => { try { it.el.click() } catch (err) { /* the action went away */ } }))
          }
          const sep = document.createElement('div')
          sep.className = 'kbmob-sheet-sep'
          panel.appendChild(sep)
          panel.appendChild(row(kt('Autres actions', 'More actions'), null, () => {
            bypass = true
            try { more.click() } catch (err) { /* the button went away */ } finally { bypass = false }
          }))
          const onKey = (e) => { if (e && e.key === 'Escape') closeSheet() }
          document.addEventListener('keydown', onKey, true)
          document.body.appendChild(mask)
          document.body.appendChild(panel)
          sheet = { mask, panel, onKey }
        }
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

        // Settings on a phone: a list of pages, then the page. A pick sets data-kbmob-page (mobile.css hides the list and
        // shows the page under a "back" bar, a pseudo-element of the page); a tap on that bar clears it.
        const onSettings = (e) => {
          try {
            if (!narrow()) return
            const t = e.target
            if (t === null || t === undefined || typeof t.closest !== 'function') return
            const modal = t.closest('[data-shortcut-modal="settings"]')
            if (modal === null) return
            const page = modal.children !== undefined ? modal.children[1] : null
            if (!modal.hasAttribute('data-kbmob-page')) {
              const btn = t.closest('nav > div:last-child > button')
              if (btn !== null && page !== null && page !== undefined) {
                setTimeout(() => {
                  try { modal.setAttribute('data-kbmob-page', '1'); page.setAttribute('data-kbmob-back', kt('Réglages', 'Settings')) } catch (err) { /* gone */ }
                }, 0)
              }
            } else if (page !== null && page !== undefined && t === page) {
              const r = page.getBoundingClientRect()
              if (e.clientY - r.top < 56) { e.stopPropagation(); modal.removeAttribute('data-kbmob-page') }
            }
          } catch (err) { /* DSH's own settings then */ }
        }
        document.addEventListener('click', onSettings, true)
        undo.push(() => document.removeEventListener('click', onSettings, true))

        // The rating card under an answer is one star on a phone (mobile.css): the first tap opens the five.
        const onRate = (e) => {
          try {
            if (!narrow()) return
            const t = e.target
            if (t === null || t === undefined || typeof t.closest !== 'function') return
            const card = t.closest('.kbq-rating')
            if (card === null || card.hasAttribute('data-kbmob-open')) return
            e.preventDefault()
            e.stopPropagation()
            card.setAttribute('data-kbmob-open', '1')
          } catch (err) { /* the card is DSH's: leave it alone */ }
        }
        document.addEventListener('click', onRate, true)
        undo.push(() => document.removeEventListener('click', onRate, true))

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


      // ── the phone link: Settings › Remote Control and the sidebar's phone panel ───────────────────────────────────────────
      // Everything the person sees is decided by the host half (GET /kybernos-mobile/remote/status): this is only a view
      // and five buttons. The QR code is drawn from the modules the host computed; it is black on white on purpose,
      // whatever the theme (a scanner needs the contrast), the only colours this file names.
      const buildRemoteUi = (React) => {
        const h = React.createElement
        const BASE = (() => { try { return new URL('kybernos-mobile/remote/', document.baseURI).pathname } catch (e) { return '/kybernos-mobile/remote/' } })()
        const api = async (name, body) => {
          try {
            const init = body === undefined
              ? { credentials: 'same-origin', cache: 'no-store' }
              : { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
            const r = await fetch(BASE + name, init)
            return await r.json()
          } catch (e) { return { ok: false, error: 'network' } }
        }
        const ERRORS = {
          not_in_plan: () => kt('Votre offre n’inclut pas le mobile.', 'Your plan does not include the phone link.'),
          device_limit: () => kt('Le nombre maximum de téléphones est atteint : retirez-en un.', 'The maximum number of phones is reached: remove one.'),
          not_connected: () => kt('Connectez-vous à votre compte Kybernos.', 'Sign in to your Kybernos account.'),
          server_unavailable: () => kt('Le serveur Kybernos ne répond pas. Réessayez dans un instant.', 'The Kybernos server does not answer. Try again in a moment.'),
          server_refused: () => kt('Le serveur a refusé l’appairage.', 'The server refused the pairing.'),
          not_offered: () => kt('Ce serveur Kybernos ne propose pas encore le mobile.', 'This Kybernos server does not offer the phone link yet.'),
          network: () => kt('Connexion impossible avec DSH.', 'Cannot reach DSH.'),
        }
        const errorText = (code) => (ERRORS[code] !== undefined ? ERRORS[code]() : kt('Une erreur est survenue.', 'Something went wrong.'))

        const useRemote = () => {
          const [s, setS] = React.useState(null)
          // Why the last poll failed (null when it worked): the page keeps the last good status and says so, instead of drawing a status that is not one.
          const [err, setErr] = React.useState(null)
          const live = React.useRef(true)
          const load = React.useCallback(async () => {
            const j = await api('status')
            if (!live.current) return
            if (j !== null && typeof j === 'object' && j.ok === true) { setS(j); setErr(null) } else setErr(j !== null && typeof j === 'object' && typeof j.error === 'string' ? j.error : 'network')
          }, [])
          React.useEffect(() => {
            live.current = true
            void load()
            const timer = setInterval(() => { if (document.visibilityState === 'visible') void load() }, 1500)
            return () => { live.current = false; clearInterval(timer) }
          }, [load])
          const act = React.useCallback(async (name, body) => { const j = await api(name, body === undefined ? {} : body); await load(); return j }, [load])
          return { s, err, act, reload: load }
        }
        const useTick = () => {
          const [n, setN] = React.useState(Date.now())
          React.useEffect(() => { const t = setInterval(() => setN(Date.now()), 1000); return () => clearInterval(t) }, [])
          return n
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
          h('li', null, kt('Ouvrez l’appareil photo de votre téléphone.', 'Open your phone’s camera.')),
          h('li', null, kt('Visez ce code et ouvrez le lien.', 'Aim at this code and open the link.')),
          h('li', null, kt('Vérifiez que le code à 4 chiffres est le même ici et sur le téléphone.', 'Check that the 4-digit code is the same here and on the phone.')))

        const Lock = () => h('div', { className: 'kbmr-lock' },
          h('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
            h('rect', { x: 4, y: 11, width: 16, height: 10, rx: 2 }), h('path', { d: 'M8 11V7a4 4 0 0 1 8 0v4' })),
          h('span', null, kt('Chiffré de bout en bout : Kybernos fait passer les messages sans pouvoir les lire.', 'End-to-end encrypted: Kybernos carries the messages and cannot read them.')))

        // The pairing in progress: the QR code to scan, then the 4-digit check to approve.
        const Pairing = (props) => {
          const p = props.pairing
          const now = useTick()
          const [copied, setCopied] = React.useState(false)
          if (p.state === 'verify') {
            const left = typeof p.verify_until === 'number' ? p.verify_until - now : null
            return h('div', { className: 'kbmr-verify', 'data-kb': 'mobile-verify' },
              h('div', { className: 'kbmr-h' }, kt('Un téléphone demande l’accès', 'A phone asks for access')),
              h('div', { className: 'kbmr-sub' }, (p.phone_label || '') + (p.phone_label ? ' · ' : '') + kt('vérifiez que ce code est le même sur son écran', 'check that this code is the same on its screen')),
              h('div', { className: 'kbmr-sas', 'data-kb': 'mobile-sas' }, p.sas),
              left !== null ? h('div', { className: 'kbmr-sub' }, kt('Expire dans ', 'Expires in ') + clock(left)) : null,
              h('div', { className: 'kbmr-row' },
                h('button', { type: 'button', className: 'kbmr-btn', 'data-kb': 'mobile-deny', disabled: props.busy, onClick: props.onDeny }, kt('Refuser', 'Refuse')),
                h('button', { type: 'button', className: 'kbmr-btn kbmr-primary', 'data-kb': 'mobile-approve', disabled: props.busy, onClick: props.onApprove }, kt('Autoriser', 'Allow'))))
          }
          const left = p.expires_at - now
          const expired = left <= 0
          return h('div', { className: 'kbmr-pairing', 'data-kb': 'mobile-pairing' },
            expired ? h('div', { className: 'kbmr-qr kbmr-qr-off' }, h('span', null, kt('Code expiré', 'Code expired'))) : h(Qr, { qr: p.qr }),
            h('div', { className: 'kbmr-sub kbmr-center' }, expired ? kt('Faites un nouveau code.', 'Make a new code.') : kt('À usage unique · expire dans ', 'Single use · expires in ') + clock(left)),
            props.compact ? null : h(Steps),
            h('div', { className: 'kbmr-row' },
              h('button', { type: 'button', className: 'kbmr-btn', 'data-kb': 'mobile-new-code', disabled: props.busy, onClick: props.onNew }, kt('Nouveau code', 'New code')),
              typeof p.url === 'string' && !expired
                ? h('button', { type: 'button', className: 'kbmr-btn', 'data-kb': 'mobile-copy', onClick: () => { try { void navigator.clipboard.writeText(p.url); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch (e) { /* no clipboard */ } } }, copied ? kt('Copié', 'Copied') : kt('Copier le lien', 'Copy the link'))
                : null),
            h(Lock))
        }

        const Devices = (props) => {
          const [confirm, setConfirm] = React.useState(null)
          const list = props.devices
          if (list.length === 0) return h('div', { className: 'kbmr-sub' }, kt('Aucun téléphone appairé pour l’instant.', 'No phone paired yet.'))
          const stateText = (d) => (d.state === 'locked' ? kt('Verrouillé : hors de votre offre', 'Locked: not in your plan') : d.online ? kt('Connecté maintenant', 'Connected now') : kt('Hors ligne', 'Offline') + ' · ' + ago(d.last_seen_at))
          return h('div', { className: 'kbmr-devices', 'data-kb': 'mobile-devices' },
            list.map((d) => h('div', { key: d.id, className: 'kbmr-device', 'data-kb': 'mobile-device' },
              h('span', { className: 'kbmr-dot' + (d.online ? ' on' : ''), 'aria-hidden': 'true' }),
              h('div', { className: 'kbmr-devtxt' }, h('div', { className: 'kbmr-devname' }, d.label), h('div', { className: 'kbmr-sub' }, stateText(d))),
              confirm === d.id
                ? h('button', { type: 'button', className: 'kbmr-btn kbmr-danger', 'data-kb': 'mobile-revoke-confirm', onClick: () => { setConfirm(null); props.onRevoke(d.id) } }, kt('Confirmer', 'Confirm'))
                : h('button', { type: 'button', className: 'kbmr-btn', 'data-kb': 'mobile-revoke', onClick: () => setConfirm(d.id) }, kt('Révoquer', 'Revoke')))))
        }

        const Paywall = (props) => h('div', { className: 'kbmr-paywall', 'data-kb': 'mobile-paywall' },
          h('div', { className: 'kbmr-lockbox', 'aria-hidden': 'true' },
            h('svg', { width: 36, height: 36, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' },
              h('rect', { x: 4, y: 11, width: 16, height: 10, rx: 2 }), h('path', { d: 'M8 11V7a4 4 0 0 1 8 0v4' }))),
          h('div', { className: 'kbmr-h' }, kt('Non inclus dans votre offre', 'Not included in your plan')),
          h('div', { className: 'kbmr-sub' }, kt('Votre offre actuelle n’inclut pas le lien téléphone. Avec une offre qui l’inclut, vous scannez un code et votre téléphone pilote cet ordinateur, où que vous soyez, sans rien ouvrir sur votre box ni créer de compte en plus. Votre poste reste utilisable en local, comme avant.', 'Your current plan does not include the phone link. With a plan that does, you scan a code and your phone drives this computer from anywhere, with nothing to open on your router and no extra account. Your computer stays usable locally, as before.')),
          typeof props.web === 'string' && props.web !== ''
            ? h('button', { type: 'button', className: 'kbmr-btn kbmr-primary', 'data-kb': 'mobile-plans', onClick: () => { try { window.open(props.web, '_blank', 'noopener') } catch (e) { /* cannot open */ } } }, kt('Voir les offres', 'See the plans'))
            : null)

        // One body for the panel and the page: they differ by `compact` only.
        const Body = (props) => {
          const s = props.r.s
          const [error, setError] = React.useState(null)
          const [busy, setBusy] = React.useState(false)
          const started = React.useRef(false)
          const run = async (name, body) => { setBusy(true); const j = await props.r.act(name, body); setBusy(false); setError(j && j.ok === false ? errorText(j.error) : null); return j }
          const usable = s !== null && s.available !== false && s.connected !== false && s.entitled !== false
          // Opening the panel IS asking for a code: the QR appears without a further click.
          React.useEffect(() => {
            if (props.autoPair === true && usable && s.pairing == null && started.current === false) { started.current = true; void run('pair') }
          }, [usable, s === null ? null : s.pairing == null])
          // A failed poll keeps what was shown and adds the reason on top; with nothing shown yet it is the whole page until the next good poll.
          const polled = props.r.err !== null && props.r.err !== undefined ? h('div', { className: 'kbmr-error', role: 'alert', 'data-kb': 'mobile-poll-error' }, errorText(props.r.err)) : null
          if (s === null) return polled !== null ? polled : h('div', { className: 'kbmr-sub' }, kt('Chargement…', 'Loading…'))
          if (s.available === false) return h('div', { className: 'kbmr-sub' }, kt('Cette version de DSH ne permet pas la connexion mobile.', 'This DSH version cannot do the phone link.'))
          if (s.configured === false) return h('div', { className: 'kbmr-sub', 'data-kb': 'mobile-not-offered' }, kt('Ce serveur Kybernos ne propose pas encore le mobile.', 'This Kybernos server does not offer the phone link yet.'))
          if (s.connected === false) return h('div', { className: 'kbmr-sub', 'data-kb': 'mobile-signin' }, kt('Connectez-vous à votre compte Kybernos pour utiliser le mobile.', 'Sign in to your Kybernos account to use the phone link.'))
          const devices = Array.isArray(s.devices) ? s.devices : []
          if (s.entitled === false) return h('div', null, h(Paywall, { web: props.web }), devices.length > 0 ? h(Devices, { devices, onRevoke: (id) => run('devices/revoke', { id }) }) : null)
          return h('div', { className: 'kbmr-body' },
            polled,
            error !== null ? h('div', { className: 'kbmr-error', role: 'alert' }, error) : null,
            s.pairing != null
              ? h(Pairing, { pairing: s.pairing, compact: props.compact, busy, onApprove: () => run('pair/approve'), onDeny: () => run('pair/deny'), onNew: () => run('pair') })
              : h('div', { className: 'kbmr-row kbmr-start' },
                h('button', { type: 'button', className: 'kbmr-btn kbmr-primary', 'data-kb': 'mobile-pair', disabled: busy, onClick: () => { void run('pair') } }, kt('Ajouter un téléphone', 'Add a phone'))),
            props.compact ? null : h('div', { className: 'kbmr-section' },
              h('div', { className: 'kbmr-sech' },
                h('span', null, kt('Téléphones appairés', 'Paired phones') + ' (' + devices.length + ')'),
                s.relay === 'up' ? h('span', { className: 'kbmr-sub kbmr-inline' }, h('span', { className: 'kbmr-dot on', 'aria-hidden': 'true' }), kt('Relais Kybernos joint', 'Kybernos relay reached')) : null),
              h(Devices, { devices, onRevoke: (id) => run('devices/revoke', { id }) }),
              devices.length > 1 ? h('button', { type: 'button', className: 'kbmr-link', 'data-kb': 'mobile-revoke-all', onClick: () => { void run('devices/revoke-all') } }, kt('Tout révoquer', 'Revoke all')) : null,
              s.refused > 0 ? h('div', { className: 'kbmr-sub' }, (s.refused === 1
                ? kt('1 demande refusée depuis un téléphone (réglages, identifiants, extensions).', '1 request refused from a phone (settings, credentials, plugins).')
                : kt(s.refused + ' demandes refusées depuis un téléphone (réglages, identifiants, extensions).', s.refused + ' requests refused from a phone (settings, credentials, plugins).'))) : null))
        }

        // The « ? How it works » button of this bundle (the Suite publishes it; without the Suite there is none). The card it opens is
        // help.json: the same text on the panel's title row and on the Settings page.
        const helpButton = () => (typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Help ? h(window.__KB_HELP__.Help, { id: 'kybernos-mobile' }) : null)

        // The button as the panel's title row carries it: the card is fixed to the window (the sidebar clips anything wider than the
        // popover), and the popover's box is read when the button is pressed, before the card opens.
        const PopHelp = () => {
          const box = React.useRef(null)
          const anchor = () => {
            try {
              const pop = box.current !== null && box.current.closest ? box.current.closest('.kbf-pop') : null
              if (pop === null || pop === undefined) return
              const r = pop.getBoundingClientRect()
              box.current.style.setProperty('--kbmr-x', Math.max(8, Math.round(r.left)) + 'px')
              box.current.style.setProperty('--kbmr-b', Math.max(8, Math.round(window.innerHeight - r.bottom)) + 'px')
            } catch (e) { /* the card keeps its default place */ }
          }
          return h('span', { ref: box, className: 'kbmr-helpbox', onClickCapture: anchor }, helpButton())
        }

        // The animated help of the Settings page (the Suite publishes it): opens the first time the page is visited, and the card of the
        // « ? How it works » button can bring it back. The words are the ones of the real screen.
        const introNode = () => (typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Intro
          ? h(window.__KB_HELP__.Intro, {
            id: 'kybernos-mobile',
            title: kt('Relier un téléphone en trois étapes', 'Link a phone in three steps'),
            caption: kt('Le code QR est affiché sur l’ordinateur, scanné avec le téléphone, puis autorisé sur l’ordinateur.', 'The QR code is shown on the computer, scanned with the phone, then allowed on the computer.'),
            steps: [
              { t: kt('Affichez le code', 'Show the code'), b: kt('Sur l’ordinateur, ouvrez le menu du compte › « Contrôle à distance » : un code QR s’affiche.', 'On the computer, open the account menu › “Remote control”: a QR code appears.') },
              { t: kt('Scannez-le', 'Scan it'), b: kt('Sur le téléphone, scannez le code avec l’appareil photo et ouvrez le lien : un code à 4 chiffres s’affiche.', 'On the phone, scan the code with the camera and open the link: a 4-digit code appears.') },
              { t: kt('Autorisez', 'Allow'), b: kt('Sur l’ordinateur, vérifiez que le code est le même et touchez Autoriser : votre téléphone pilote cet ordinateur.', 'On the computer, check the code is the same and click Allow: your phone now drives this computer.') }
            ],
            mock: { bar: 'Remote Control', rows: [kt('Cet ordinateur', 'This computer')], hot: kt('Votre téléphone', 'Your phone'), states: [kt('Pas lié', 'Not linked'), kt('Code : 4821', 'Code: 4821'), kt('Lié', 'Linked')], actions: [kt('Afficher le QR', 'Show the QR'), kt('Scan…', 'Scanning…'), kt('Autoriser', 'Allow')] }
          })
          : null)

        // The sidebar's phone button opens this (kybernos-cloud renders it inside its popover).
        const Panel = (props) => {
          const r = useRemote()
          const devices = r.s !== null && Array.isArray(r.s.devices) ? r.s.devices.length : 0
          // Closing the panel withdraws a code nobody scanned. It does not withdraw one a phone is waiting on (the check
          // can still be approved from Settings), nor the one the person carries to the Settings page.
          const latest = React.useRef(null)
          latest.current = r.s
          const keep = React.useRef(false)
          React.useEffect(() => () => {
            const p = latest.current !== null && latest.current !== undefined ? latest.current.pairing : null
            if (keep.current !== true && !(p !== null && p !== undefined && p.state === 'verify')) void api('pair/cancel', {})
          }, [])
          return h('div', { className: 'kbmr-panel' },
            h('div', { className: 'kbmr-pophead' },
              h('div', { className: 'kbf-poptitle' }, kt('Connecter un téléphone', 'Connect a phone')),
              h(PopHelp)),
            h(Body, { r, compact: true, autoPair: true, web: props.web }),
            typeof props.onManage === 'function'
              ? h('button', { type: 'button', className: 'kbmr-link', 'data-kb': 'mobile-manage', onClick: () => { keep.current = true; props.onManage() } }, kt('Gérer les téléphones', 'Manage phones') + (devices > 0 ? ' (' + devices + ')' : ''))
              : null)
        }

        // Settings › Remote Control.
        const Page = () => {
          const r = useRemote()
          // The address of the Kybernos web app (for « See the plans »): the cloud half already knows it.
          const [web, setWeb] = React.useState('')
          React.useEffect(() => {
            let live = true
            void (async () => {
              try {
                const j = await (await fetch(new URL('kybernos-cloud/status', document.baseURI).pathname, { credentials: 'same-origin' })).json()
                const w = j && j.state && typeof j.state.web_url === 'string' ? j.state.web_url : ''
                if (live) setWeb(w)
              } catch (e) { /* the page still works, without the button */ }
            })()
            return () => { live = false }
          }, [])
          const planChip = r.s !== null && r.s.entitled === true ? kt('Inclus dans votre offre', 'Included in your plan') : null
          return h('div', { className: 'kbmr-page', 'data-kb': 'mobile-page' },
            h('div', { className: 'kbmr-head' },
              h('div', { className: 'kbmr-headtxt' },
                h('h1', { className: 'kbmr-title' }, 'Remote Control'),
                h('p', { className: 'kbmr-sub' }, kt('Pilotez cet ordinateur depuis votre téléphone : scannez le code, c’est tout. Rien à installer, aucun compte à créer.', 'Drive this computer from your phone: scan the code, that is all. Nothing to install, no account to create.'))),
              planChip !== null ? h('span', { className: 'kbmr-chip' }, planChip) : null,
              helpButton()),
            introNode(),
            h(Body, { r, compact: false, autoPair: false, web }))
        }

        const CSS = `
.kbmr-panel{display:flex;flex-direction:column;gap:12px;min-width:240px}
.kbmr-pophead{display:flex;gap:8px;align-items:center;justify-content:space-between}
.kbmr-pophead .kbf-poptitle{flex:1 1 auto;min-width:0;padding-block:0}
/* The card of the « ? How it works » button is wider than the popover and the sidebar clips what leaves it: it is fixed to the window, its left and bottom edges are the popover's (measured when the button is pressed, see PopHelp), so it opens upward over the popover and scrolls when the window is short. */
.kbmr-panel .kbmr-pophead [data-kb="help-panel"]{position:fixed;top:auto;right:auto;inset-inline:auto;left:var(--kbmr-x,8px);bottom:var(--kbmr-b,72px)}
.kbmr-page{display:flex;flex-direction:column;gap:20px;padding:4px 2px;max-width:720px}
.kbmr-head{display:flex;gap:12px;align-items:flex-start}
.kbmr-headtxt{flex:1;min-width:0}
.kbmr-title{margin:0;font-size:22px;font-weight:650;color:var(--dsw-alias-label-primary, rgb(243,243,245))}
.kbmr-h{font-size:15px;font-weight:650;color:var(--dsw-alias-label-primary, rgb(243,243,245))}
.kbmr-sub{margin:4px 0 0;font-size:13px;line-height:1.45;color:var(--dsw-alias-label-secondary, rgb(161,161,171))}
.kbmr-center{text-align:center}
.kbmr-chip{flex:none;padding:3px 10px;border:1px solid var(--dsw-alias-border-l2, rgb(46,46,52));border-radius:999px;font-size:12px;color:var(--dsw-alias-label-secondary, rgb(161,161,171))}
.kbmr-body,.kbmr-pairing,.kbmr-verify,.kbmr-paywall{display:flex;flex-direction:column;gap:12px}
.kbmr-pairing,.kbmr-verify,.kbmr-paywall{align-items:center;padding:16px;border:1px solid var(--dsw-alias-border-l2, rgb(46,46,52));border-radius:14px;background:var(--dsw-alias-bg-layer-2, rgb(27,27,31))}
.kbmr-panel .kbmr-pairing,.kbmr-panel .kbmr-verify,.kbmr-panel .kbmr-paywall{border:0;background:transparent;padding:0}
.kbmr-qr{width:196px;height:196px;border-radius:10px;overflow:hidden;background:white;display:flex;align-items:center;justify-content:center}
.kbmr-qr svg{display:block;width:100%;height:100%}
.kbmr-qr-off{background:transparent;border:1px dashed var(--dsw-alias-border-l2, rgb(46,46,52));color:var(--dsw-alias-label-secondary, rgb(161,161,171));font-size:13px}
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
.kbmr-section{display:flex;flex-direction:column;gap:10px}
.kbmr-sech{display:flex;gap:10px;align-items:center;justify-content:space-between;font-weight:650;font-size:15px;color:var(--dsw-alias-label-primary, rgb(243,243,245))}
.kbmr-inline{display:inline-flex;gap:6px;align-items:center;margin:0;font-weight:400}
.kbmr-devices{border:1px solid var(--dsw-alias-border-l2, rgb(46,46,52));border-radius:12px;background:var(--dsw-alias-bg-layer-2, rgb(27,27,31))}
.kbmr-device{display:flex;gap:12px;align-items:center;padding:12px 16px}
.kbmr-device+.kbmr-device{border-top:1px solid var(--dsw-alias-border-l2, rgb(46,46,52))}
.kbmr-devtxt{flex:1;min-width:0}
.kbmr-devname{font-weight:600;color:var(--dsw-alias-label-primary, rgb(243,243,245));overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbmr-dot{flex:none;width:8px;height:8px;border-radius:999px;background:rgb(112,112,122)}
.kbmr-dot.on{background:rgb(74,222,128)}
.kbmr-lockbox{color:var(--dsw-alias-label-secondary, rgb(161,161,171))}
.kbmr-paywall .kbmr-sub{text-align:center;max-width:440px}
`
        return { Panel, Page, CSS }
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
          // The phone link, apart: it needs React and the settings slots, and nothing it does may touch the layout.
          try {
            if (typeof ctx.inject === 'function' && typeof require === 'function') {
              const React = require('react')
              const ui = buildRemoteUi(React)
              ctx.inject(['slots'], (scope) => {
                try {
                  const slots = scope !== undefined && scope !== null ? scope.slots : null
                  ctx.effect(() => {
                    const mine = { version: 1, Panel: ui.Panel }
                    try { window.__KB_MOBILE__ = mine } catch (e) { /* frozen window */ }
                    return () => { try { if (window.__KB_MOBILE__ === mine) delete window.__KB_MOBILE__ } catch (e) { /* gone */ } }
                  }, 'kybernos-mobile: phone panel for the sidebar')
                  ctx.effect(() => {
                    const style = document.createElement('style')
                    style.dataset.plugin = '@local/kybernos-mobile'
                    style.textContent = ui.CSS
                    document.head.appendChild(style)
                    return () => style.remove()
                  }, 'kybernos-mobile: phone link styles')
                  if (slots !== null && slots !== undefined && typeof slots.inject === 'function') {
                    ctx.effect(() => slots.inject('settings.section', () => slots.register(
                      { name: 'settings.section', id: 'kybernos-mobile', order: 45, label: 'Remote Control' },
                      () => React.createElement(ui.Page))), 'kybernos-mobile: settings section')
                  }
                } catch (e) { try { console.warn('[kybernos-mobile] phone link not mounted:', e) } catch (e2) { /* no console */ } }
              })
            }
          } catch (e) { try { console.warn('[kybernos-mobile] phone link disabled:', e) } catch (e2) { /* no console */ } }
        },
        __test: { decide, drawerOpen, narrow, toggle, PICKS, TOGGLE, FIRST_IN_SIDEBAR, MEDIA, SHEET_ID, MENU_CLASS, isParked, parkedActions, ACTION_BUTTONS, MORE_BUTTON, swipeCloses, fitKinds, FIT_ATTR, collapseButton, leadTarget, LEAD_ATTR }
      }
    } catch (e) {
      try { console.warn('[kybernos-mobile] disabled:', e) } catch (e2) { /* no console */ }
      return { name: 'kybernos-mobile', apply () {} }
    }
  }
})
