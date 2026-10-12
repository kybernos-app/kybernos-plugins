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
// not by its label, which is translated). Nothing of the layout runs above 700 px, except on a touch device lying down
// (a phone in landscape is wider than 700 px but at most 500 px high).
//
// The second half of the file is the phone LINK (Settings › Mobile and the sidebar's phone panel): see buildRemoteUi.
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
      const ACTION_BUTTONS = '[data-slot="conversation.session.header.actions"] button, [data-slot="conversation.session.header.utilities"] button, [data-slot="conversation.session.header.corner"] button, [data-composer-card] button, [data-kb="computer-env-button"]'
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
            const label = String(el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim()
            if (label === '' || seen.indexOf(label) >= 0) continue
            seen.push(label)
            out.push({ label, el })
          } catch (err) { /* an element that went away */ }
        }
        return out
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


      // ── the phone link: Settings › Mobile and the sidebar's phone panel ───────────────────────────────────────────
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
          const live = React.useRef(true)
          const load = React.useCallback(async () => { const j = await api('status'); if (live.current && j !== null && typeof j === 'object') setS(j) }, [])
          React.useEffect(() => {
            live.current = true
            void load()
            const timer = setInterval(() => { if (document.visibilityState === 'visible') void load() }, 1500)
            return () => { live.current = false; clearInterval(timer) }
          }, [load])
          const act = React.useCallback(async (name, body) => { const j = await api(name, body === undefined ? {} : body); await load(); return j }, [load])
          return { s, act, reload: load }
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
          h('div', { className: 'kbmr-h' }, kt('Inclus dans les offres payantes', 'Included in paid plans')),
          h('div', { className: 'kbmr-sub' }, kt('Avec une offre payante, vous scannez un code et votre téléphone pilote cet ordinateur, où que vous soyez, sans rien ouvrir sur votre box ni créer de compte en plus. Votre poste reste utilisable en local, comme avant.', 'With a paid plan you scan a code and your phone drives this computer from anywhere, with nothing to open on your router and no extra account. Your computer stays usable locally, as before.')),
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
            if (props.autoPair === true && usable && s.pairing === null && started.current === false) { started.current = true; void run('pair') }
          }, [usable, s === null ? null : s.pairing === null])
          if (s === null) return h('div', { className: 'kbmr-sub' }, kt('Chargement…', 'Loading…'))
          if (s.available === false) return h('div', { className: 'kbmr-sub' }, kt('Cette version de DSH ne permet pas la connexion mobile.', 'This DSH version cannot do the phone link.'))
          if (s.configured === false) return h('div', { className: 'kbmr-sub', 'data-kb': 'mobile-not-offered' }, kt('Ce serveur Kybernos ne propose pas encore le mobile.', 'This Kybernos server does not offer the phone link yet.'))
          if (s.connected === false) return h('div', { className: 'kbmr-sub', 'data-kb': 'mobile-signin' }, kt('Connectez-vous à votre compte Kybernos pour utiliser le mobile.', 'Sign in to your Kybernos account to use the phone link.'))
          const devices = Array.isArray(s.devices) ? s.devices : []
          if (s.entitled === false) return h('div', null, h(Paywall, { web: props.web }), devices.length > 0 ? h(Devices, { devices, onRevoke: (id) => run('devices/revoke', { id }) }) : null)
          return h('div', { className: 'kbmr-body' },
            error !== null ? h('div', { className: 'kbmr-error', role: 'alert' }, error) : null,
            s.pairing !== null
              ? h(Pairing, { pairing: s.pairing, compact: props.compact, busy, onApprove: () => run('pair/approve'), onDeny: () => run('pair/deny'), onNew: () => run('pair') })
              : h('div', { className: 'kbmr-row kbmr-start' },
                h('button', { type: 'button', className: 'kbmr-btn kbmr-primary', 'data-kb': 'mobile-pair', disabled: busy, onClick: () => { void run('pair') } }, kt('Ajouter un téléphone', 'Add a phone'))),
            props.compact ? null : h('div', { className: 'kbmr-section' },
              h('div', { className: 'kbmr-sech' },
                h('span', null, kt('Téléphones appairés', 'Paired phones') + ' (' + devices.length + ')'),
                s.relay === 'up' ? h('span', { className: 'kbmr-sub kbmr-inline' }, h('span', { className: 'kbmr-dot on', 'aria-hidden': 'true' }), kt('Relais Kybernos joint', 'Kybernos relay reached')) : null),
              h(Devices, { devices, onRevoke: (id) => run('devices/revoke', { id }) }),
              devices.length > 1 ? h('button', { type: 'button', className: 'kbmr-link', 'data-kb': 'mobile-revoke-all', onClick: () => { void run('devices/revoke-all') } }, kt('Tout révoquer', 'Revoke all')) : null,
              s.refused > 0 ? h('div', { className: 'kbmr-sub' }, kt(s.refused + ' demande(s) refusée(s) depuis un téléphone (réglages, identifiants, extensions).', s.refused + ' request(s) refused from a phone (settings, credentials, plugins).')) : null))
        }

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
            h('div', { className: 'kbf-poptitle' }, kt('Connecter un téléphone', 'Connect a phone')),
            h(Body, { r, compact: true, autoPair: true, web: props.web }),
            typeof props.onManage === 'function'
              ? h('button', { type: 'button', className: 'kbmr-link', 'data-kb': 'mobile-manage', onClick: () => { keep.current = true; props.onManage() } }, kt('Gérer les téléphones', 'Manage phones') + (devices > 0 ? ' (' + devices + ')' : ''))
              : null)
        }

        // Settings › Mobile.
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
                h('h1', { className: 'kbmr-title' }, 'Mobile'),
                h('p', { className: 'kbmr-sub' }, kt('Pilotez cet ordinateur depuis votre téléphone : scannez le code, c’est tout. Rien à installer, aucun compte à créer.', 'Drive this computer from your phone: scan the code, that is all. Nothing to install, no account to create.'))),
              planChip !== null ? h('span', { className: 'kbmr-chip' }, planChip) : null,
              typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Help ? h(window.__KB_HELP__.Help, { id: 'kybernos-mobile' }) : null),
            h(Body, { r, compact: false, autoPair: false, web }))
        }

        const CSS = `
.kbmr-panel{display:flex;flex-direction:column;gap:12px;min-width:240px}
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
                      { name: 'settings.section', id: 'kybernos-mobile', order: 45, label: 'Mobile' },
                      () => React.createElement(ui.Page))), 'kybernos-mobile: settings section')
                  }
                } catch (e) { try { console.warn('[kybernos-mobile] phone link not mounted:', e) } catch (e2) { /* no console */ } }
              })
            }
          } catch (e) { try { console.warn('[kybernos-mobile] phone link disabled:', e) } catch (e2) { /* no console */ } }
        },
        __test: { decide, drawerOpen, narrow, toggle, PICKS, TOGGLE, FIRST_IN_SIDEBAR, MEDIA, SHEET_ID, MENU_CLASS, isParked, parkedActions, ACTION_BUTTONS, MORE_BUTTON }
      }
    } catch (e) {
      try { console.warn('[kybernos-mobile] disabled:', e) } catch (e2) { /* no console */ }
      return { name: 'kybernos-mobile', apply () {} }
    }
  }
})
