// kybernos-kyber — browser half.
//
// One tab in the right sidebar, « Kyber »: where the person's assistant answers them (Telegram) and the cloud computer it works on.
// It only READS: `/kybernos-cloud/kyber` (the cloud plugin asks the server with the account's token) and `/kybernos-cloud/server` (where
// the account page is). A device cannot link or unlink a chat, so the tab sends the person to the bot and to their account.
//
// Loaded through window.__ModuleLoader__.load; the factory RETURNS a plugin object and, on any error, a disabled one, so the GUI is preserved.
window.__ModuleLoader__.load({
  id: '@local/kybernos-kyber',
  factory (require) {
    try {
      const React = require('react')
      const h = React.createElement

      // ── language: French is the source, English the pair; a translated language is looked up by its French text ──
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
      const fill = (text, p) => (p === undefined ? text : text.replace(/\{(\w+)\}/g, (m, k) => (p[k] !== undefined ? String(p[k]) : m)))
      // [fr, en] pairs, by key, in ONE table so that a test can check both sides of every pair.
      const S = {
        title: ['Kyber', 'Kyber'],
        tabHint: ['Où votre assistant vous répond (Telegram) et l’ordinateur cloud sur lequel il travaille.', 'Where your assistant answers you (Telegram) and the cloud computer it works on.'],
        telegram: ['Telegram', 'Telegram'],
        computer: ['Mon ordinateur', 'My computer'],
        off: ['La porte Telegram n’est pas activée sur ce serveur.', 'The Telegram door is not turned on on this server.'],
        unlinked: ['Pas encore connecté. Écrivez /start au bot : il vous crée un compte ou vous donne un code à saisir dans votre compte.', 'Not connected yet. Write /start to the bot: it makes you an account or gives you a code to type in your account.'],
        linked: ['Connecté : {name}', 'Connected: {name}'],
        since: ['depuis le {date}', 'since {date}'],
        paused: ['En pause : écrivez /resume au bot pour reprendre.', 'Paused: write /resume to the bot to resume.'],
        blocked: ['Le bot est bloqué dans Telegram : débloquez-le pour recevoir les réponses.', 'The bot is blocked in Telegram: unblock it to receive answers.'],
        openBot: ['Ouvrir le bot', 'Open the bot'],
        manage: ['Gérer dans mon compte', 'Manage in my account'],
        noHome: ['Pas encore d’ordinateur : il est créé à votre premier message Telegram qui demande d’agir.', 'No computer yet: it is made at your first Telegram message that asks it to act.'],
        st_running: ['Éveillé', 'Awake'],
        st_suspended: ['En veille', 'Asleep'],
        st_creating: ['En création', 'Being made'],
        st_resuming: ['Se réveille', 'Waking up'],
        st_suspending: ['S’endort', 'Going to sleep'],
        st_failed: ['En échec', 'Failed'],
        st_other: ['{state}', '{state}'],
        image: ['Image {v}', 'Image {v}'],
        lastActive: ['Dernière activité : {when}', 'Last active: {when}'],
        net_public: ['Réseau : toutes les adresses publiques', 'Network: any public address'],
        net_closed: ['Réseau : seulement les serveurs Kybernos', 'Network: Kybernos servers only'],
        net_list: ['Réseau : une liste d’adresses', 'Network: a list of addresses'],
        approvals: ['Votre ordinateur vous demande l’accord dans Telegram avant d’agir : Autoriser, Refuser, ou Autoriser pour cette tâche.', 'Your computer asks for your approval in Telegram before it acts: Allow, Refuse, or Allow for this task.'],
        refresh: ['Actualiser', 'Refresh'],
        signedOut: ['Connectez-vous à Kybernos pour voir votre Kyber.', 'Sign in to Kybernos to see your Kyber.'],
        failed: ['Impossible de lire l’état pour l’instant.', 'The state cannot be read right now.'],
        loading: ['Lecture…', 'Reading…'],
      }
      const L = (key, p) => { const pair = S[key]; return pair === undefined ? key : fill(kt(pair[0], pair[1]), p) }

      // ═══ the model: pure, no DOM, tested without a browser ═══════════════════════════════════════════════════════
      const asObj = (v) => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v : null)
      const when = (iso) => {
        const t = Date.parse(String(iso || ''))
        if (!Number.isFinite(t)) return ''
        try { return new Date(t).toLocaleString(lang() === 'en' ? 'en' : lang().slice(0, 2), { dateStyle: 'medium', timeStyle: 'short' }) } catch (e) { return new Date(t).toISOString().slice(0, 16).replace('T', ' ') }
      }
      const day = (iso) => {
        const t = Date.parse(String(iso || ''))
        if (!Number.isFinite(t)) return ''
        try { return new Date(t).toLocaleDateString(lang() === 'en' ? 'en' : lang().slice(0, 2), { dateStyle: 'medium' }) } catch (e) { return new Date(t).toISOString().slice(0, 10) }
      }
      /** What the tab shows, from what the two routes said. `kyber` is the answer of /kybernos-cloud/kyber (or null), `server` the one of /kybernos-cloud/server. */
      const derive = (kyber, server) => {
        const k = asObj(kyber)
        if (k === null || k.ok !== true) return { kind: 'failed' }
        if (k.connected !== true) return { kind: 'signedOut' }
        const s = asObj(server) !== null ? asObj(asObj(server).server) : null
        const api = s !== null && typeof s.api === 'string' && /^https?:\/\//.test(s.api) ? s.api.replace(/\/+$/, '') : ''
        const t = asObj(k.telegram)
        let telegram = { state: 'off' }
        if (t !== null && t.configured === true && t.enabled === true) {
          const linked = asObj(t.linked)
          const bot = typeof t.bot === 'string' && /^[A-Za-z0-9_]{3,64}$/.test(t.bot) ? t.bot : ''
          telegram = linked === null
            ? { state: 'unlinked', botUrl: bot === '' ? '' : 'https://t.me/' + bot }
            : { state: 'linked', name: String(linked.display || ''), since: String(linked.linked_at || ''), paused: linked.paused === true, blocked: linked.blocked === true, botUrl: bot === '' ? '' : 'https://t.me/' + bot }
        }
        const hm = asObj(k.home)
        const home = hm === null ? null : {
          state: String(hm.state || ''),
          version: typeof hm.version === 'string' && hm.version !== '' ? hm.version : '',
          lastActive: typeof hm.last_active_at === 'string' ? hm.last_active_at : '',
          network: ['public', 'closed', 'list'].indexOf(String(hm.network)) >= 0 ? String(hm.network) : '',
        }
        return { kind: 'ok', telegram, home, accountUrl: api === '' ? '' : api + '/account' }
      }

      // ═══ the page ════════════════════════════════════════════════════════════════════════════════════════════════
      const state = { loading: true, view: null, timer: null, at: 0 }
      const listeners = new Set()
      const emit = () => { listeners.forEach((fn) => { try { fn() } catch (e) { /* a view that went away */ } }) }
      const readJson = async (path) => {
        try {
          const r = await fetch(path, { credentials: 'same-origin' })
          if (!r.ok) return null
          return await r.json()
        } catch (e) { return null }
      }
      const load = async () => {
        state.loading = true
        emit()
        const [kyber, server] = await Promise.all([readJson('/kybernos-cloud/kyber'), readJson('/kybernos-cloud/server')])
        state.view = derive(kyber, server)
        state.loading = false
        state.at = Date.now()
        emit()
      }

      const Link = (props) => h('a', { className: 'kbky-btn', href: props.href, target: '_blank', rel: 'noopener noreferrer', 'data-kb': props.kb }, props.children)

      const Pane = () => {
        const [, setTick] = React.useState(0)
        React.useEffect(() => {
          const fn = () => setTick((n) => n + 1)
          listeners.add(fn)
          if (state.view === null && state.loading === false) load()
          else if (state.view === null) load()
          const poll = setInterval(() => { if (document.visibilityState !== 'hidden') load() }, 30000)
          return () => { listeners.delete(fn); clearInterval(poll) }
        }, [])
        const v = state.view
        const head = h('div', { className: 'kbky-head' },
          h('h2', { className: 'kbky-h' }, L('title')),
          h('button', { type: 'button', className: 'kbky-btn', onClick: () => load(), disabled: state.loading, 'data-kb': 'kybernos-kyber-refresh' }, state.loading ? L('loading') : L('refresh')))
        if (v === null) return h('div', { className: 'kbky', 'data-kb': 'kybernos-kyber-pane' }, head, h('p', { className: 'kbky-note' }, L('loading')))
        if (v.kind !== 'ok') return h('div', { className: 'kbky', 'data-kb': 'kybernos-kyber-pane' }, head, h('p', { className: 'kbky-note' }, L(v.kind)))
        const tg = v.telegram
        const telegram = h('section', { className: 'kbky-card', 'data-kb': 'kybernos-kyber-telegram' },
          h('h3', { className: 'kbky-sec' }, L('telegram')),
          tg.state === 'off' ? h('p', { className: 'kbky-note' }, L('off')) : null,
          tg.state === 'unlinked' ? h('p', { className: 'kbky-note' }, L('unlinked')) : null,
          tg.state === 'linked' ? h('p', { className: 'kbky-line' }, L('linked', { name: tg.name }), tg.since !== '' ? ' · ' + L('since', { date: day(tg.since) }) : '') : null,
          tg.state === 'linked' && tg.paused ? h('p', { className: 'kbky-warn' }, L('paused')) : null,
          tg.state === 'linked' && tg.blocked ? h('p', { className: 'kbky-warn' }, L('blocked')) : null,
          h('div', { className: 'kbky-actions' },
            tg.botUrl !== '' ? h(Link, { href: tg.botUrl, kb: 'kybernos-kyber-bot' }, L('openBot')) : null,
            v.accountUrl !== '' ? h(Link, { href: v.accountUrl, kb: 'kybernos-kyber-account' }, L('manage')) : null))
        const hm = v.home
        const stateKey = hm === null ? '' : 'st_' + hm.state
        const computer = h('section', { className: 'kbky-card', 'data-kb': 'kybernos-kyber-computer' },
          h('h3', { className: 'kbky-sec' }, L('computer')),
          hm === null ? h('p', { className: 'kbky-note' }, L('noHome')) : h('div', null,
            h('p', { className: 'kbky-line' }, S[stateKey] !== undefined ? L(stateKey) : L('st_other', { state: hm.state }), hm.version !== '' ? ' · ' + L('image', { v: hm.version }) : ''),
            hm.lastActive !== '' ? h('p', { className: 'kbky-sub' }, L('lastActive', { when: when(hm.lastActive) })) : null,
            hm.network !== '' ? h('p', { className: 'kbky-sub' }, L('net_' + hm.network)) : null),
          h('p', { className: 'kbky-note' }, L('approvals')))
        return h('div', { className: 'kbky', 'data-kb': 'kybernos-kyber-pane' }, head, telegram, computer)
      }

      // ═══ style: DSH tokens with a fallback, never a hard-coded theme colour ══════════════════════════════════════
      const CSS = [
        '.kbky{box-sizing:border-box;height:100%;overflow:auto;padding:10px 12px 20px;color:var(--dsw-alias-label-primary,#222);font-size:var(--dsh-content-font-size-secondary,13.5px)}',
        '.kbky-page{box-sizing:border-box;height:100%;max-width:760px;margin:0 auto;padding:18px 20px}',
        '.kbky-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:2px 2px 10px}',
        '.kbky-h{margin:0;font-size:16px;font-weight:600}',
        '.kbky-card{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.1));border-radius:14px;padding:6px 14px 12px;margin-top:10px}',
        '.kbky-sec{margin:10px 0 6px;font-size:13px;font-weight:600}',
        '.kbky-line{margin:4px 0;font-weight:500}',
        '.kbky-sub{margin:2px 0;color:var(--dsw-alias-label-secondary,#666);font-size:12.5px}',
        '.kbky-note{margin:8px 0;color:var(--dsw-alias-label-secondary,#666)}',
        '.kbky-warn{margin:6px 0;color:var(--dsw-alias-state-warn-primary,#a8530a)}',
        '.kbky-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}',
        '.kbky-btn{display:inline-flex;align-items:center;border:0;border-radius:9px;padding:6px 12px;cursor:pointer;font:inherit;color:inherit;text-decoration:none;background:var(--dsw-alias-bg-base,rgba(127,127,127,.14))}',
        '.kbky-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.22))}',
        '.kbky-btn[disabled]{opacity:.6;cursor:default}',
        '.kbky-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4c6ef5);outline-offset:2px}',
      ].join('\n')

      /** The page the menu row opens: the same two cards, with room. */
      const Page = () => h('div', { className: 'kbky-page', 'data-kb': 'kybernos-kyber-page' }, h(Pane))

      const TYPE_ID = 'kybernos-kyber'
      const SLOT_PAGE = 'main.kybernos-kyber'
      const KIND = 'kybernos-kyber'
      const SLOT_PANE = 'sidebar.right.pane.tab'
      const STYLE_ID = 'kybernos-kyber-styles'
      let CTX = null

      return {
        name: 'kybernos-kyber',
        // `sidebarRightTabs` must be declared: ui-sidebar-right provides it, and without this `apply` could run before.
        inject: ['slots', 'sidebarRightTabs'],
        __test: { S, L, kt, derive, CSS, TYPE_ID, KIND, state },
        apply (ctx) {
          CTX = ctx
          ctx.effect(() => {
            if (document.getElementById(STYLE_ID)) return undefined
            const el = document.createElement('style')
            el.id = STYLE_ID
            el.setAttribute('data-plugin', '@local/kybernos-kyber')
            el.textContent = CSS
            document.head.appendChild(el)
            return () => { el.remove() }
          }, 'kybernos-kyber: styles')

          // the tab type: it shows in the sidebar's « + » guide, and opens like any other tab
          let registre = null
          try { registre = ctx.get('sidebarRightTabs') } catch (e) { registre = null }
          if (registre && typeof registre.register === 'function') {
            ctx.effect(() => registre.register({
              id: TYPE_ID,
              kind: KIND,
              title: () => L('title'),
              guide: [{ title: () => L('title'), description: () => L('tabHint') }],
            }), 'kybernos-kyber: sidebar tab type')
          }
          // the page: the child slot the core's menu row opens
          ctx.effect(() => ctx.slots.inject(SLOT_PAGE, () => ctx.slots.register({ name: SLOT_PAGE }, () => { try { return h(Page) } catch (e) { return null } })), 'kybernos-kyber: page')
          ctx.effect(() => ctx.slots.inject(SLOT_PANE, () => ctx.slots.register(
            { name: SLOT_PANE, key: TYPE_ID },
            () => { try { return h(Pane) } catch (e) { return null } }
          )), 'kybernos-kyber: tab body')

          try {
            window.__KB_KYBER__ = {
              /** What the tab shows now (diagnostics, live checks). */
              state () { return { loading: state.loading, view: state.view, at: state.at } },
              /** Opens the tab, the same call the sidebar's « + » guide makes. False when no chat is on screen. */
              open () {
                try {
                  const sb = CTX && CTX.get('sidebarRight')
                  if (sb && typeof sb.openTab === 'function') { sb.openTab(KIND, {}); return true }
                } catch (e) { /* no chat on screen */ }
                return false
              },
            }
          } catch (e) { /* no window */ }
        },
      }
    } catch (error) {
      try { console.error('[kybernos-kyber] load failed — plugin disabled, GUI preserved', error) } catch (e) { /* no console */ }
      return { apply () { /* disabled after a load error */ } }
    }
  },
})
