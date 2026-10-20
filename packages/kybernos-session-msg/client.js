// ═══════════════════════════════════════════════════════════════════════════
// kybernos-session-msg — client half.
//
// A message or an instruction from one chat session to another (or to a new one, or to this one). Three surfaces, each on
// a seam that already exists (no engine patch):
//   1. the inline form (`conversation.chat.turnTail`, last turn only) — Message / Instruction, an editable text, a
//      destination (here / a new session / another running or recent session), Send. It opens prefilled when the agent
//      proposes (tool `session_msg_propose`), or empty from the chat header button (`conversation.session.header.actions`);
//   2. the sent trail (same slot) — one summary per message sent: Sent → Received → Answer, read back from the host;
//   3. the received card (`conversation.user.text.node`, rule `kb-msg` on `ctx.uiConversation.userText`) — « Instruction
//      from X » / « Message from X », the text visible, what it means for the agent, the receipt, Reply / Open.
//
// Every registration is guarded: a slot that this build does not have simply never calls us, a route that is not mounted
// answers 503 and the surface says so — never a page that breaks.
window.__ModuleLoader__.load({
  id: '@local/kybernos-session-msg',
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

      // [fr, en] pairs, in ONE table so a test can check both sides of every pair.
      const S = {
        send: ['Envoyer à une session…', 'Send to a session…'],
        sendTip: ['Envoyer un message ou une instruction à une autre session', 'Send a message or an instruction to another session'],
        formTitle: ['Que veux-tu envoyer ?', 'What do you want to send?'],
        kindMessage: ['Message', 'Message'],
        kindMessageCap: ['Une information. Rien n’est lancé.', 'Information. Nothing is started.'],
        kindMessageOnly: ['Seulement vers une autre session.', 'Only to another session.'],
        kindInstruction: ['Instruction', 'Instruction'],
        kindInstructionCap: ['L’autre session agit, puis rapporte.', 'The other session acts, then reports.'],
        leadHere: ['à faire ici', 'to do here'],
        leadNew: ['pour une nouvelle session', 'for a new session'],
        leadFor: ['pour {name}', 'for {name}'],
        placeholderMessage: ['Ce que l’autre session doit savoir…', 'What the other session needs to know…'],
        placeholderInstruction: ['Ce que la session doit faire, et ce que tu attends en retour…', 'What the session must do, and what you expect back…'],
        where: ['Où', 'Where'],
        here: ['Ici', 'Here'],
        newSession: ['Nouvelle session', 'New session'],
        otherSession: ['Autre session', 'Another session'],
        listNote: ['Seules les sessions en cours ou récentes sont listées.', 'Only sessions that are running or recent are listed.'],
        listEmpty: ['Aucune autre session ouverte ou récente.', 'No other session open or recent.'],
        loading: ['Chargement…', 'Loading…'],
        hintHere: ['Pas d’envoi : cette session s’en charge.', 'Nothing is sent: this session takes it.'],
        hintNew: ['Nouvelle session : ce texte est son premier message.', 'New session: this text is its first message.'],
        hintNewFull: ['Nouvelle session : ce texte est son premier message. Même accès complet que celle-ci.', 'New session: this text is its first message. Same full access as this one.'],
        hintIdle: ['{name} est au repos : elle sera réveillée.', '{name} is idle: it will be woken up.'],
        hintRunning: ['{name} est en cours : lu à la fin de son tour.', '{name} is running: read at the end of its turn.'],
        hintFull: ['{name} a un accès complet : elle pourra modifier des fichiers.', '{name} has full access: it will be able to change files.'],
        hintTooLong: ['Trop long : 8 000 caractères au maximum.', 'Too long: 8,000 characters at most.'],
        btnHere: ['Le faire ici', 'Do it here'],
        btnNew: ['Créer la session', 'Create the session'],
        btnTo: ['Envoyer à {name}', 'Send to {name}'],
        btnPick: ['Choisir une session', 'Pick a session'],
        sending: ['Envoi…', 'Sending…'],
        close: ['Fermer', 'Close'],
        folded: ['Envoi fermé — le texte est gardé.', 'Send closed — your text is kept.'],
        reopen: ['Rouvrir', 'Reopen'],
        failedWith: ['L’envoi a échoué ({code}). Rien n’a été délivré.', 'The send failed ({code}). Nothing was delivered.'],
        routeMissing: ['L’hôte n’a pas la route du message (bundle non redémarré ?).', 'The host has no message route (bundle not restarted?).'],
        sentTitleMessage: ['Message → {name}', 'Message → {name}'],
        sentTitleInstruction: ['Instruction → {name}', 'Instruction → {name}'],
        stepSent: ['Envoyé', 'Sent'],
        stepReceived: ['Reçu', 'Received'],
        stepWorking: ['En cours', 'Working'],
        stepAnswer: ['Réponse', 'Answer'],
        seeAnswer: ['Voir la réponse', 'See the answer'],
        openSession: ['Ouvrir la session', 'Open the session'],
        recvMessage: ['Message de « {name} »', 'Message from “{name}”'],
        recvInstruction: ['Instruction de « {name} »', 'Instruction from “{name}”'],
        noteMessage: ['Pour l’agent : information, rien à exécuter d’office.', 'For the agent: information, nothing to run on its own.'],
        noteInstruction: ['Pour l’agent : consigne à exécuter, avec les droits de cette session.', 'For the agent: an instruction to carry out, with this session’s own permissions.'],
        ackMessage: ['Message reçu', 'Message received'],
        ackInstruction: ['Instruction reçue', 'Instruction received'],
        reply: ['Répondre', 'Reply'],
        running: ['en cours', 'running'],
        agoNow: ['à l’instant', 'just now'],
        agoMin: ['il y a {n} min', '{n} min ago'],
        agoHour: ['il y a {n} h', '{n} h ago'],
        unknown: ['—', '—'],
      }
      const T = (key, p) => fill(kt(S[key][0], S[key][1]), p)

      // ── the wire ────────────────────────────────────────────────────────────
      const post = async (url, body) => {
        let res
        try {
          res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
        } catch (e) {
          throw Object.assign(new Error(T('routeMissing')), { status: 0 })
        }
        let data = null
        try { data = await res.json() } catch (e) { data = null }
        if (data === null) throw Object.assign(new Error(res.status === 404 ? T('routeMissing') : 'HTTP ' + String(res.status)), { status: res.status })
        if (data.ok !== true && data.accepted !== true) throw Object.assign(new Error(String(data.error || ('HTTP ' + String(res.status)))), { status: res.status })
        return data
      }
      const get = async (url) => {
        let res
        try { res = await fetch(url) } catch (e) { throw Object.assign(new Error(T('routeMissing')), { status: 0 }) }
        let data = null
        try { data = await res.json() } catch (e) { data = null }
        if (data === null) throw Object.assign(new Error('HTTP ' + String(res.status)), { status: res.status })
        return data
      }
      /** A stable, short code for a failed send (the form shows it; a test pins it). */
      const CODE = (status, error) => {
        const e = String(error || '')
        if (status === 0) return 'host_unreachable'
        if (status === 401 || status === 403 || status === 503) return 'guard'
        if (status === 404) return /source/.test(e) ? 'source_not_found' : 'target_not_found'
        if (status === 409) return /steer/.test(e) ? 'steer_unavailable' : 'self'
        if (status === 429) return 'rate_limited'
        if (status === 400) return 'invalid'
        return 'failed'
      }

      // ── the conversation seams the surfaces use ─────────────────────────────
      let ctxRef = null
      const service = (nom) => {
        try {
          const c = ctxRef
          if (c === null) return null
          if (typeof c.get === 'function') { const v = c.get(nom); if (v !== null && v !== undefined) return v }
          const root = c.root
          return root !== null && root !== undefined && root[nom] !== undefined ? root[nom] : null
        } catch (e) { return null }
      }
      const navigate = (sessionId) => {
        try {
          const ui = service('uiWorkspace')
          if (ui !== null && typeof ui.openSession === 'function') { ui.openSession(sessionId); return true }
        } catch (e) { /* navigation unavailable */ }
        return false
      }
      const shortId = (id) => String(id).replace(/^session-/, '').slice(0, 8)
      /** A title taken from our own machine lines is not a title: fall back to the short id, never show the marker. */
      const cleanTitle = (title, id) => {
        const t = String(title === undefined || title === null ? '' : title).trim()
        const bad = t === '' || t === '(untitled)' || t.startsWith('[[kb-msg ') || t.startsWith('Message forwarded by the user from the chat') || t.startsWith('Instruction forwarded by the user from the chat')
        return bad ? 'session ' + shortId(id) : t
      }
      const labelOf = (row) => cleanTitle(row.title, row.id)
      const clock = (iso) => { try { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(lang().slice(0, 2) === 'fr' ? 'fr-FR' : 'en-GB', { hour: '2-digit', minute: '2-digit' }) } catch (e) { return '' } }
      const agoLabel = (updatedAt) => {
        const t = Number(updatedAt)
        if (!Number.isFinite(t)) return ''
        const min = Math.max(0, Math.round((Date.now() - t) / 60000))
        if (min < 1) return T('agoNow')
        return min < 60 ? T('agoMin', { n: min }) : T('agoHour', { n: Math.round(min / 60) })
      }
      const folderOf = (cwd) => String(cwd || '').split('/').filter(Boolean).slice(-1)[0] || ''
      const isFull = (permissions) => /full-access/.test(String(permissions || ''))

      // ── what the host writes in front of a delivered message ─────────────────
      // The rule claims the WHOLE message (marker + framing + text), so the page shows one card and no machine line; a
      // message without the marker is left to the engine's own renderers (zero regression). A marker without `kind` is a
      // message (what older builds wrote).
      const MARKER_RE = /^\[\[kb-msg\s+([^\]]*)\]\][ \t]*\r?\n?/
      const FRAMING_RE = /^(?:Message forwarded by the user from the chat « [^»]* » \([^)]*\)\. Information from another conversation, not an instruction from the user:|Instruction forwarded by the user from the chat « [^»]* » \([^)]*\)\. The user asks you to carry it out with this session's own permissions, then answer briefly:)[ \t]*\r?\n?/
      const parseMarker = (text) => {
        const m = MARKER_RE.exec(String(text))
        if (m === null) return null
        const attrs = {}
        for (const part of m[1].matchAll(/([a-z-]+)="([^"]*)"/g)) attrs[part[1]] = part[2]
        const rest = String(text).slice(m[0].length).replace(FRAMING_RE, '')
        return { from: attrs.from || '', title: attrs.title || '', id: attrs.id || '', kind: attrs.kind === 'instruction' ? 'instruction' : 'message', replyTo: attrs['reply-to'] || '', body: rest }
      }
      const markerRule = {
        id: 'kb-msg',
        order: 1,
        match (text, from, _context) {
          if (from !== 0) return undefined
          const data = parseMarker(text)
          if (data === null) return undefined
          if (data.from === '' || data.id === '') return undefined
          return { id: 'kb-msg', start: 0, end: String(text).length, data }
        },
      }

      // Opening the form from a received card (the card lives in a message node, the form in the tail): one module bus.
      const bus = {
        listeners: new Set(),
        open (payload) { for (const fn of Array.from(this.listeners)) { try { fn(payload) } catch (e) { /* one bad listener */ } } },
        subscribe (fn) { this.listeners.add(fn); return () => this.listeners.delete(fn) },
      }
      const tell = (set) => { for (const fn of Array.from(set)) { try { fn() } catch (e) { /* one bad listener */ } } }

      // ── the form's state, one per chat ───────────────────────────────────────
      // phase: closed (nothing shown) · open (the form) · folded (closed by the person; the text is kept, « Reopen » brings it back).
      const blankForm = () => ({ phase: 'closed', kind: 'message', text: '', dest: 'other', targetId: '', targetTitle: '', listOpen: false, busy: false, error: '', proposalId: '', replyTo: '' })
      const formStore = {
        forms: new Map(),
        listeners: new Set(),
        subscribe (fn) { this.listeners.add(fn); return () => this.listeners.delete(fn) },
        get (sessionId) { return this.forms.get(String(sessionId)) || blankForm() },
        set (sessionId, patch) { this.forms.set(String(sessionId), { ...this.get(sessionId), ...patch }); tell(this.listeners) },
        /** Open the form. With a preset: a fresh form from it. Without: bring back what the person already had. */
        openForm (sessionId, preset) {
          const fresh = preset !== null && preset !== undefined && Object.keys(preset).length > 0
          const base = fresh ? { ...blankForm(), ...preset } : this.get(sessionId)
          this.set(sessionId, { ...base, phase: 'open', busy: false, error: '', listOpen: false })
        },
        reset (sessionId) { this.forms.set(String(sessionId), blankForm()); tell(this.listeners) },
      }
      /** A message is information: only an instruction can be done here or in a new session. */
      const kindAllowed = (form, kind) => kind === 'instruction' || form.dest === 'other'

      // ── the other running or recent sessions (the picker) ─────────────────────
      const peerStore = {
        data: { current: null, sessions: [], loaded: false, error: '' },
        key: '',
        at: 0,
        listeners: new Set(),
        subscribe (fn) { this.listeners.add(fn); return () => this.listeners.delete(fn) },
        async load (sessionId, force) {
          if (force !== true && this.key === sessionId && Date.now() - this.at < 15000) return this.data
          try {
            const data = await get('/kybernos-session-msg/sessions?from=' + encodeURIComponent(sessionId))
            this.data = { current: data.current || null, sessions: Array.isArray(data.sessions) ? data.sessions : [], loaded: true, error: data.ok === false ? String(data.error || '') : '' }
            this.key = sessionId
            this.at = Date.now()
          } catch (e) { this.data = { ...this.data, loaded: true, error: e !== null && e.message !== undefined ? e.message : String(e) } }
          tell(this.listeners)
          return this.data
        },
      }

      // ── what this chat SENT, read back from the host (Sent → Received → Answer) ──────────────────────
      // The host's journal is the durable record, so the trail survives a reload and a restart of DSH. « Received » is the
      // target's acceptance; « Answer » is the target's own turn finishing (the host's heuristic, not a read of the answer:
      // the answer itself lives in the target chat, one click away).
      const statusStore = {
        server: new Map(),
        local: new Map(),
        listeners: new Set(),
        subscribe (fn) { this.listeners.add(fn); return () => this.listeners.delete(fn) },
        get (sessionId) {
          const srv = this.server.get(String(sessionId)) || []
          const ids = new Set(srv.map((i) => i.messageId))
          const loc = (this.local.get(String(sessionId)) || []).filter((i) => ids.has(i.messageId) !== true)
          return srv.concat(loc).filter((i) => i.to !== String(sessionId)).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).slice(-3)
        },
        live (sessionId) { return this.get(sessionId).some((i) => i.state !== 'answered') },
        addLocal (sessionId, item) { this.local.set(String(sessionId), (this.local.get(String(sessionId)) || []).concat([item])); tell(this.listeners) },
        async load (sessionId) {
          try {
            const data = await get('/kybernos-session-msg/status?from=' + encodeURIComponent(sessionId) + '&tail=20')
            if (Array.isArray(data.items)) {
              this.server.set(String(sessionId), data.items)
              const seen = new Set(data.items.map((i) => i.messageId))
              this.local.set(String(sessionId), (this.local.get(String(sessionId)) || []).filter((i) => seen.has(i.messageId) !== true))
            }
          } catch (e) { /* an unreadable status leaves what is already shown */ }
          tell(this.listeners)
          return this.get(sessionId)
        },
      }

      // ── the agent's proposal: the form opens prefilled ────────────────────────
      const dismissed = new Set()
      const loadProposal = async (sessionId) => {
        try {
          const data = await get('/kybernos-session-msg/proposal?sessionId=' + encodeURIComponent(sessionId))
          const p = data !== null && data.proposal !== undefined ? data.proposal : null
          if (p === null || typeof p !== 'object' || dismissed.has(String(p.id))) return null
          const f = formStore.get(sessionId)
          if (f.phase === 'open' || f.proposalId === p.id) return null
          formStore.openForm(sessionId, { kind: p.kind === 'instruction' ? 'instruction' : 'message', text: String(p.text || ''), dest: p.dest === 'here' || p.dest === 'new' ? p.dest : 'other', targetId: String(p.targetSessionId || ''), targetTitle: String(p.targetTitle || ''), proposalId: String(p.id || '') })
          return p
        } catch (e) { return null }
      }
      const clearProposal = (sessionId, id) => { if (id !== '') post('/kybernos-session-msg/proposal/clear', { sessionId, id }).catch(() => {}) }

      /** What the form tells the person under the text: the consequence of the choice, one line. */
      const hintFor = (form, row, current) => {
        if (form.text.length > 8000) return ['err', T('hintTooLong')]
        if (form.dest === 'here') return ['', T('hintHere')]
        if (form.dest === 'new') return isFull(current !== null && current !== undefined ? current.permissions : '') ? ['warn', T('hintNewFull')] : ['', T('hintNew')]
        if (row === null) return ['', '']
        const name = labelOf(row)
        if (form.kind === 'instruction' && isFull(row.permissions)) return ['warn', T('hintFull', { name })]
        return ['', row.running === true ? T('hintRunning', { name }) : T('hintIdle', { name })]
      }
      const canSendForm = (form) => form.busy !== true && form.text.trim().length > 0 && form.text.length <= 8000 && (form.dest !== 'other' || form.targetId !== '') && kindAllowed(form, form.kind)

      /** The one send: the host decides what each destination means (here / new / another session). */
      const dispatch = async (sessionId) => {
        const f = formStore.get(sessionId)
        if (canSendForm(f) !== true) return null
        formStore.set(sessionId, { busy: true, error: '' })
        try {
          const data = await post('/kybernos-session-msg/dispatch', {
            dest: f.dest,
            fromSessionId: sessionId,
            kind: f.kind,
            text: f.text,
            ...(f.dest === 'other' ? { targetSessionId: f.targetId } : {}),
            ...(f.proposalId !== '' ? { proposalId: f.proposalId } : {}),
            ...(f.replyTo !== '' ? { replyTo: f.replyTo } : {}),
          })
          if (f.dest !== 'here') {
            statusStore.addLocal(sessionId, {
              messageId: String(data.messageId || ('local-' + Date.now().toString(36))),
              kind: f.kind,
              mode: f.dest === 'new' ? 'new' : 'queue',
              to: String((data.target !== undefined && data.target !== null && data.target.id) || data.sessionId || f.targetId || ''),
              targetTitle: f.dest === 'new' ? '' : String((data.target !== undefined && data.target !== null && data.target.title) || f.targetTitle || ''),
              at: String(data.deliveredAt || new Date().toISOString()),
              replyTo: f.replyTo,
              state: 'received',
              textPrefix: f.text.slice(0, 200),
            })
          }
          if (f.proposalId !== '') dismissed.add(f.proposalId)
          formStore.reset(sessionId)
          statusStore.load(sessionId).catch(() => {})
          return data
        } catch (e) {
          formStore.set(sessionId, { busy: false, error: T('failedWith', { code: CODE(e !== null && e.status !== undefined ? e.status : 0, e !== null && e.message !== undefined ? e.message : '') }) })
          return null
        }
      }
      const closeForm = (sessionId) => {
        const f = formStore.get(sessionId)
        if (f.proposalId !== '') { dismissed.add(f.proposalId); clearProposal(sessionId, f.proposalId) }
        formStore.set(sessionId, { phase: f.text.trim() === '' ? 'closed' : 'folded', listOpen: false, proposalId: '' })
      }

      // ── tiny icons (16 px, currentColor) ────────────────────────────────────
      const Svg = (path, size) => h('svg', { width: size || 16, height: size || 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: path, stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }))
      const ICON_SEND = 'M2.5 8h10M8.5 3.5 13 8l-4.5 4.5'
      const ICON_MSG = 'M3 3.8h10v6.4H8.2L5.4 12.6V10.2H3z'
      const ICON_CHEV = 'M4 6l4 4 4-4'
      const ICON_CHECK = 'M3 8.5l3 3 7-7'
      const ICON_SHIELD = 'M8 2l5 2v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4z'
      const Icon = (d, size) => Svg(d, size)

      // ── CSS: DSH's own tokens (--dsw-alias-*) with the measured values as fallbacks ──────────────────
      const CSS = `
.kbmsg-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 12px;border:0;border-radius:16px;background:transparent;font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary,#0f1115);cursor:pointer;white-space:nowrap}
.kbmsg-btn:hover{background:var(--dsw-alias-interactive-bg-hover,#2631480f)}
.kbmsg-btn[disabled]{opacity:.4;cursor:not-allowed}
.kbmsg-btn-sm{height:28px;padding:0 11px;font-size:12px;border-radius:14px}
.kbmsg-btn-primary{height:36px;padding:0 18px;font-size:13.5px;font-weight:500;border-radius:18px;background:var(--dsw-alias-button-primary-fill,#0f1115);color:var(--dsw-alias-label-primary-foreground,#fff)}
.kbmsg-btn-primary:hover:not([disabled]){background:var(--dsw-alias-button-primary-hover,#43454a)}
.kbmsg-btn-outline{border:.5px solid var(--dsw-alias-border-l4,#00000029)}
.kbmsg-link{border:0;padding:0;background:none;font:inherit;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#61666b);text-decoration:underline;text-underline-offset:2px;cursor:pointer}
.kbmsg-link:hover{color:var(--dsw-alias-label-primary,#0f1115)}
.kbmsg-btn:focus-visible,.kbmsg-link:focus-visible,.kbmsg-pill:focus-visible,.kbmsg-row:focus-visible,.kbmsg-x:focus-visible,.kbmsg-kind button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4176e6);outline-offset:2px}
.kbmsg-hbtn{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#61666b);cursor:pointer}
.kbmsg-hbtn:hover{background:var(--dsw-alias-interactive-bg-hover,#2631480f);color:var(--dsw-alias-label-primary,#0f1115)}
.kbmsg-dot{display:inline-block;width:8px;height:8px;flex:none;border-radius:50%;background:var(--dsw-alias-label-tertiary,#81858c)}
.kbmsg-dot-run{background:var(--dsw-alias-state-success-primary,#22c55e);animation:kbmsg-pulse 1.6s ease-in-out infinite}
.kbmsg-dot-ok{background:var(--dsw-alias-state-success-primary,#22c55e)}
.kbmsg-dot-off{background:transparent;border:1.5px solid var(--dsw-alias-border-l4,#00000029)}
@keyframes kbmsg-pulse{0%,100%{box-shadow:0 0 0 0 #22c55e55}50%{box-shadow:0 0 0 5px #22c55e00}}
.kbmsg-form{display:block;width:100%;max-width:760px;margin:8px auto;padding:12px 16px 14px;border:1px solid var(--dsw-alias-border-l3,#0000001f);border-radius:20px;background:var(--dsw-alias-bg-layer-3,#fff);box-shadow:0 1px 2px #0000000d,0 4px 16px #0000000a;box-sizing:border-box}
.kbmsg-f-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.kbmsg-f-q{font-size:13px;line-height:20px;font-weight:600;color:var(--dsw-alias-label-primary,#0f1115)}
.kbmsg-x{width:28px;height:28px;margin-right:-6px;border:0;border-radius:50%;background:none;color:var(--dsw-alias-label-tertiary,#81858c);font-size:14px;cursor:pointer}
.kbmsg-x:hover{background:var(--dsw-alias-interactive-bg-hover,#2631480f);color:var(--dsw-alias-label-primary,#0f1115)}
.kbmsg-kind{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px}
.kbmsg-kind button{text-align:left;padding:8px 12px;border:1px solid var(--dsw-alias-border-l3,#0000001f);border-radius:14px;background:transparent;font:inherit;color:var(--dsw-alias-label-secondary,#61666b);cursor:pointer}
.kbmsg-kind button:hover:not([disabled]){background:var(--dsw-alias-interactive-bg-hover,#2631480f)}
.kbmsg-kind button b{display:block;font-size:13px;line-height:18px;font-weight:600;color:var(--dsw-alias-label-primary,#0f1115)}
.kbmsg-kind button small{display:block;font-size:11.5px;line-height:16px;color:var(--dsw-alias-label-tertiary,#81858c)}
.kbmsg-kind button[aria-checked=true]{border-color:var(--dsw-alias-button-primary-fill,#0f1115);box-shadow:inset 0 0 0 1px var(--dsw-alias-button-primary-fill,#0f1115)}
.kbmsg-kind button[disabled]{opacity:.45;cursor:not-allowed}
.kbmsg-box{padding:9px 12px 8px;border-radius:12px;background:var(--dsw-alias-bg-layer-2,#f7f7f8)}
.kbmsg-box:focus-within{outline:2px solid var(--dsw-alias-state-business-primary,#4176e6)}
.kbmsg-lead{display:flex;align-items:baseline;gap:6px;font-size:12.5px;line-height:18px}
.kbmsg-lead b{font-weight:700;color:var(--dsw-alias-label-primary,#0f1115)}
.kbmsg-lead span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary,#81858c)}
.kbmsg-text{display:block;width:100%;min-height:44px;padding:2px 0;border:0;background:transparent;resize:none;overflow:hidden;font:inherit;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary,#0f1115);box-sizing:border-box}
.kbmsg-text:focus{outline:none}
.kbmsg-dest{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:12px}
.kbmsg-dest-lbl{margin-right:2px;font-size:12px;color:var(--dsw-alias-label-tertiary,#81858c)}
.kbmsg-pill{display:inline-flex;align-items:center;gap:6px;height:30px;max-width:220px;padding:0 13px;border:.5px solid var(--dsw-alias-border-l4,#00000029);border-radius:15px;background:transparent;font:inherit;font-size:13px;color:var(--dsw-alias-label-secondary,#61666b);cursor:pointer;white-space:nowrap}
.kbmsg-pill span{overflow:hidden;text-overflow:ellipsis}
.kbmsg-pill:hover{background:var(--dsw-alias-interactive-bg-hover,#2631480f)}
.kbmsg-pill[aria-pressed=true]{border-color:transparent;background:var(--dsw-alias-button-primary-fill,#0f1115);color:var(--dsw-alias-label-primary-foreground,#fff)}
.kbmsg-list{margin:8px 0 0;padding:4px;border-radius:14px;background:var(--dsw-alias-bg-layer-2,#f7f7f8);max-height:240px;overflow:auto}
.kbmsg-row{display:flex;align-items:center;gap:10px;width:100%;padding:8px 10px;border:0;border-radius:10px;background:none;font:inherit;text-align:left;color:var(--dsw-alias-label-primary,#0f1115);cursor:pointer}
.kbmsg-row:hover{background:var(--dsw-alias-interactive-bg-hover,#2631480f)}
.kbmsg-row-n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}
.kbmsg-row-m{flex:none;font-size:12px;color:var(--dsw-alias-label-tertiary,#81858c);white-space:nowrap}
.kbmsg-row-ck{flex:none;width:14px;color:var(--dsw-alias-state-business-primary,#4176e6)}
.kbmsg-list-note{padding:6px 10px 4px;font-size:11.5px;color:var(--dsw-alias-label-tertiary,#81858c)}
.kbmsg-f-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:14px}
.kbmsg-hint{min-width:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#81858c)}
.kbmsg-hint[data-tone=warn]{color:var(--dsw-alias-state-warn-primary,#d97706)}
.kbmsg-hint[data-tone=err]{color:var(--dsw-alias-state-error-primary,#ec1313)}
.kbmsg-err{margin-top:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary,#ec1313)}
.kbmsg-folded{display:flex;align-items:center;justify-content:space-between;width:100%;max-width:760px;margin:8px auto;padding:8px 14px;border:1px dashed var(--dsw-alias-border-l4,#00000029);border-radius:16px;font-size:13px;color:var(--dsw-alias-label-tertiary,#81858c);box-sizing:border-box}
.kbmsg-sent{display:block;width:min(460px,100%);margin:8px 0 2px auto;padding:12px 16px;border-radius:18px;background:var(--dsw-alias-bg-layer-2,#f7f7f8);box-sizing:border-box}
.kbmsg-sent[data-kind=instruction]{box-shadow:inset 3px 0 0 var(--dsw-alias-state-business-primary,#4176e6)}
.kbmsg-s-top{display:flex;align-items:baseline;gap:8px;font-size:13px}
.kbmsg-s-top b{font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbmsg-s-top span{margin-left:auto;font-size:12px;color:var(--dsw-alias-label-tertiary,#81858c)}
.kbmsg-s-text{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin:4px 0 10px;font-size:13.5px;line-height:21px;color:var(--dsw-alias-label-secondary,#61666b);overflow-wrap:anywhere}
.kbmsg-steps{display:flex;flex-wrap:wrap;gap:4px 18px;font-size:12px;color:var(--dsw-alias-label-tertiary,#81858c)}
.kbmsg-step{display:inline-flex;align-items:center;gap:6px}
.kbmsg-step[data-done=true]{color:var(--dsw-alias-label-secondary,#61666b)}
.kbmsg-s-foot{display:flex;gap:8px;margin-top:8px}
.kbmsg-recv{display:block;width:min(100%,520px);margin:4px 0 2px;padding:12px 16px 10px;border-radius:18px;background:var(--dsw-alias-bg-layer-2,#f7f7f8);box-shadow:inset 3px 0 0 var(--dsw-alias-border-l4,#00000029);box-sizing:border-box}
.kbmsg-recv[data-kind=instruction]{box-shadow:inset 3px 0 0 var(--dsw-alias-state-business-primary,#4176e6)}
.kbmsg-r-top{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--dsw-alias-label-tertiary,#81858c)}
.kbmsg-r-top b{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#0f1115);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbmsg-avatar{flex:none;display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;font-size:11px;font-weight:600;color:var(--dsw-alias-state-business-primary,#4176e6);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4176e6) 14%,transparent)}
.kbmsg-r-text{display:block;margin:6px 0 2px;font-size:14px;line-height:22px;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary,#0f1115)}
.kbmsg-r-note{display:flex;align-items:flex-start;gap:6px;margin-top:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#81858c)}
.kbmsg-ack{display:flex;align-items:center;gap:6px;margin-top:6px;font-size:12px;color:var(--dsw-alias-label-secondary,#61666b)}
.kbmsg-ack svg{color:var(--dsw-alias-state-success-primary,#22c55e)}
.kbmsg-r-foot{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.kbmsg-recv-inline{display:inline-flex;align-items:center;gap:6px;max-width:100%;min-width:0;vertical-align:middle}
.kbmsg-recv-inline b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600}
.kbmsg-recv-inline span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:45%;color:var(--dsw-alias-label-tertiary,#81858c)}
@media (prefers-reduced-motion:reduce){.kbmsg-dot-run{animation:none}}
@media (max-width:480px){
  .kbmsg-form{padding:10px 12px 12px;border-radius:16px}
  .kbmsg-sent,.kbmsg-recv{padding:10px 12px}
  .kbmsg-f-foot{flex-wrap:wrap}
}
`

      // ── the received card ───────────────────────────────────────────────────
      const ReceivedCard = (props) => {
        const node = props !== null && props !== undefined ? props.node : null
        const data = node !== null && node !== undefined && node.data !== null && typeof node.data === 'object' ? node.data : {}
        const from = typeof data.from === 'string' ? data.from : ''
        const id = typeof data.id === 'string' ? data.id : ''
        const kind = data.kind === 'instruction' ? 'instruction' : 'message'
        const name = cleanTitle(data.title, from)
        const body = typeof data.body === 'string' ? data.body : ''
        const heading = T(kind === 'instruction' ? 'recvInstruction' : 'recvMessage', { name })
        // A one-line preview (the queue dock, a folded bubble) gets a line, not a card: a card inside an ellipsis row is
        // unreadable, and the full card belongs to the delivered message.
        const preview = props !== null && props !== undefined && (props.ellipsis === true || props.interactive === false)
        if (preview) {
          return h('span', { className: 'kbmsg-recv-inline', 'data-kb': 'session-msg-inline' },
            Icon(ICON_MSG), h('b', null, heading), body.trim() !== '' ? h('span', null, body.trim().slice(0, 120)) : null)
        }
        return h('span', { className: 'kbmsg-recv', 'data-kb': 'session-msg-card', 'data-kind': kind },
          h('span', { className: 'kbmsg-r-top' }, h('span', { className: 'kbmsg-avatar', 'aria-hidden': 'true' }, name.slice(0, 1).toUpperCase()), h('b', null, heading)),
          h('span', { className: 'kbmsg-r-text' }, body),
          h('span', { className: 'kbmsg-r-note' }, Icon(ICON_SHIELD, 14), h('span', null, T(kind === 'instruction' ? 'noteInstruction' : 'noteMessage'))),
          h('span', { className: 'kbmsg-ack', role: 'status' }, Icon(ICON_CHECK, 14), T(kind === 'instruction' ? 'ackInstruction' : 'ackMessage')),
          h('span', { className: 'kbmsg-r-foot' },
            h('button', { type: 'button', className: 'kbmsg-btn kbmsg-btn-sm kbmsg-btn-outline', onClick: () => bus.open({ targetSessionId: from, targetTitle: name, replyTo: id }) }, T('reply')),
            h('button', { type: 'button', className: 'kbmsg-btn kbmsg-btn-sm', onClick: () => { navigate(from) } }, T('openSession'))))
      }

      // ── the inline form ─────────────────────────────────────────────────────
      const grow = (el) => { try { if (el !== null && el !== undefined && el.style !== undefined) { el.style.height = 'auto'; el.style.height = Math.max(44, el.scrollHeight) + 'px' } } catch (e) { /* no layout */ } }
      const focusForm = () => {
        try {
          setTimeout(() => {
            try { const el = document.querySelector('[data-kb="session-msg-form"]'); if (el !== null && el !== undefined && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) } catch (e) { /* no DOM */ }
          }, 60)
        } catch (e) { /* no timers */ }
      }

      const SendForm = ({ sessionId, form, peers }) => {
        const area = React.useRef(null)
        React.useEffect(() => { grow(area.current) })
        const set = (patch) => formStore.set(sessionId, patch)
        const row = form.dest === 'other' ? (peers.sessions.find((r) => r.id === form.targetId) || null) : null
        const name = form.dest === 'other' ? (row !== null ? labelOf(row) : (form.targetTitle !== '' ? cleanTitle(form.targetTitle, form.targetId) : '')) : ''
        const instruction = form.kind === 'instruction'
        const [tone, hint] = hintFor(form, row, peers.current)
        const pickDest = (dest) => set({ dest, listOpen: false, kind: dest !== 'other' ? 'instruction' : form.kind })
        const toggleOther = () => {
          if (form.dest !== 'other') set({ dest: 'other', listOpen: true })
          else set({ listOpen: form.listOpen !== true })
        }
        const key = (e) => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeForm(sessionId) }
          if (e.key === 'Enter' && (e.metaKey === true || e.ctrlKey === true)) { e.preventDefault(); e.stopPropagation(); dispatch(sessionId) }
        }
        const lead = form.dest === 'here' ? T('leadHere') : form.dest === 'new' ? T('leadNew') : T('leadFor', { name: name !== '' ? name : T('otherSession') })
        const label = form.busy === true ? T('sending') : form.dest === 'here' ? T('btnHere') : form.dest === 'new' ? T('btnNew') : (name !== '' ? T('btnTo', { name }) : T('btnPick'))
        const kindButton = (kind, title, caption, disabled) => h('button', { type: 'button', role: 'radio', 'aria-checked': form.kind === kind, disabled, 'data-kind': kind, onClick: () => { if (disabled !== true) set({ kind }) } },
          h('b', null, title), h('small', null, caption))
        return h('div', { className: 'kbmsg-form', 'data-kb': 'session-msg-form', onKeyDown: key },
          h('div', { className: 'kbmsg-f-top' },
            h('span', { className: 'kbmsg-f-q' }, T('formTitle')),
            h('button', { type: 'button', className: 'kbmsg-x', 'aria-label': T('close'), title: T('close'), onClick: () => closeForm(sessionId) }, '✕')),
          h('div', { className: 'kbmsg-kind', role: 'radiogroup', 'aria-label': T('formTitle') },
            kindButton('message', T('kindMessage'), kindAllowed(form, 'message') ? T('kindMessageCap') : T('kindMessageOnly'), kindAllowed(form, 'message') !== true),
            kindButton('instruction', T('kindInstruction'), T('kindInstructionCap'), false)),
          h('div', { className: 'kbmsg-box' },
            h('div', { className: 'kbmsg-lead' }, h('b', null, instruction ? T('kindInstruction') : T('kindMessage')), h('span', null, lead)),
            h('textarea', {
              ref: area,
              className: 'kbmsg-text',
              rows: 2,
              value: form.text,
              'aria-label': instruction ? T('kindInstruction') : T('kindMessage'),
              placeholder: instruction ? T('placeholderInstruction') : T('placeholderMessage'),
              onChange: (e) => set({ text: e.target.value }),
            })),
          h('div', { className: 'kbmsg-dest' },
            h('span', { className: 'kbmsg-dest-lbl' }, T('where')),
            h('button', { type: 'button', className: 'kbmsg-pill', 'aria-pressed': form.dest === 'here', 'data-dest': 'here', onClick: () => pickDest('here') }, T('here')),
            h('button', { type: 'button', className: 'kbmsg-pill', 'aria-pressed': form.dest === 'new', 'data-dest': 'new', onClick: () => pickDest('new') }, T('newSession')),
            h('button', { type: 'button', className: 'kbmsg-pill', 'aria-pressed': form.dest === 'other', 'aria-expanded': form.listOpen === true, 'data-dest': 'other', onClick: toggleOther },
              h('span', null, form.dest === 'other' && name !== '' ? name : T('otherSession')), Icon(ICON_CHEV, 12))),
          form.listOpen === true
            ? h('div', { className: 'kbmsg-list', role: 'listbox', 'data-kb': 'session-msg-list' },
              peers.loaded !== true ? h('div', { className: 'kbmsg-list-note' }, T('loading')) : null,
              peers.loaded === true && peers.sessions.length === 0 ? h('div', { className: 'kbmsg-list-note' }, T('listEmpty')) : null,
              peers.sessions.map((r) => h('button', { type: 'button', className: 'kbmsg-row', role: 'option', key: r.id, 'aria-selected': form.dest === 'other' && r.id === form.targetId, 'data-id': r.id,
                onClick: () => set({ targetId: r.id, targetTitle: labelOf(r), dest: 'other', listOpen: false }) },
              h('span', { className: 'kbmsg-dot' + (r.running === true ? ' kbmsg-dot-run' : '') }),
              h('span', { className: 'kbmsg-row-n', title: labelOf(r) }, labelOf(r)),
              h('span', { className: 'kbmsg-row-m' }, [folderOf(r.cwd), r.running === true ? T('running') : agoLabel(r.updatedAt)].filter((x) => x !== '').join(' · ')),
              h('span', { className: 'kbmsg-row-ck' }, form.dest === 'other' && r.id === form.targetId ? Icon(ICON_CHECK, 14) : null))),
              h('div', { className: 'kbmsg-list-note' }, T('listNote')))
            : null,
          form.error !== '' ? h('div', { className: 'kbmsg-err', role: 'alert' }, form.error) : null,
          h('div', { className: 'kbmsg-f-foot' },
            h('span', { className: 'kbmsg-hint', 'data-tone': tone, role: 'status' }, hint),
            h('button', { type: 'button', className: 'kbmsg-btn kbmsg-btn-primary', disabled: canSendForm(form) !== true, 'data-act': 'send', onClick: () => dispatch(sessionId) }, label)))
      }

      // ── one sent message: what the person wrote, and where it stands ─────────────────────────────────
      const SentCard = ({ item }) => {
        const kind = item.kind === 'instruction' ? 'instruction' : 'message'
        const name = item.mode === 'new' ? (item.targetTitle !== '' && item.targetTitle !== undefined ? item.targetTitle : T('newSession')) : cleanTitle(item.targetTitle, item.to)
        const working = item.state === 'working'
        const answered = item.state === 'answered'
        const step = (done, label, running) => h('span', { className: 'kbmsg-step', 'data-done': done === true },
          h('span', { className: 'kbmsg-dot ' + (done === true ? 'kbmsg-dot-ok' : running === true ? 'kbmsg-dot-run' : 'kbmsg-dot-off') }), label)
        return h('div', { className: 'kbmsg-sent', 'data-kb': 'session-msg-sent', 'data-kind': kind, 'data-state': String(item.state || 'received') },
          h('div', { className: 'kbmsg-s-top' }, h('b', { title: name }, T(kind === 'instruction' ? 'sentTitleInstruction' : 'sentTitleMessage', { name })), h('span', null, clock(item.at))),
          item.textPrefix !== undefined && item.textPrefix !== '' ? h('div', { className: 'kbmsg-s-text' }, item.textPrefix) : null,
          h('div', { className: 'kbmsg-steps' },
            step(true, T('stepSent')),
            step(true, T('stepReceived')),
            step(answered, working ? T('stepWorking') : T('stepAnswer'), working)),
          h('div', { className: 'kbmsg-s-foot' },
            h('button', { type: 'button', className: 'kbmsg-btn kbmsg-btn-sm kbmsg-btn-outline', onClick: () => { navigate(item.to) } }, answered ? T('seeAnswer') : T('openSession'))))
      }

      // The flow slot is per turn (`conversation.chat.turnTail` runs for every answer): our cards belong to the END of the
      // conversation, so only the highest turn seen for this chat renders them — otherwise N answers, N forms.
      const lastTail = {
        max: new Map(),
        listeners: new Set(),
        notify () { tell(this.listeners) },
        subscribe (fn) { this.listeners.add(fn); return () => this.listeners.delete(fn) },
        turnOf (sessionId) { const v = this.max.get(String(sessionId)); return v === undefined ? -1 : v },
      }
      const useLastTail = (sessionId, turn) => {
        // No turn in the props (an engine build that does not pass it, or a direct mount): show the cards (fail open).
        const [last, setLast] = React.useState(() => typeof turn !== 'number' ? true : lastTail.turnOf(sessionId) === turn)
        React.useEffect(() => {
          if (typeof turn !== 'number' || sessionId === '') return undefined
          const stop = lastTail.subscribe(() => setLast(lastTail.turnOf(sessionId) === turn))
          if (turn > lastTail.turnOf(sessionId)) { lastTail.max.set(String(sessionId), turn); lastTail.notify() }
          setLast(lastTail.turnOf(sessionId) === turn)
          return () => { try { stop() } catch (e) { /* gone */ } }
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [sessionId, turn])
        return last
      }

      // ── the tail: what this chat sent, then the form ──────────────────────────
      const TailCards = (props) => {
        const sessionId = props !== null && props !== undefined && typeof props.sessionId === 'string' ? props.sessionId : ''
        const turn = props !== null && props !== undefined && typeof props.turn === 'number' ? props.turn : undefined
        const last = useLastTail(sessionId, turn)
        const [form, setForm] = React.useState(() => formStore.get(sessionId))
        const [items, setItems] = React.useState(() => statusStore.get(sessionId))
        const [peers, setPeers] = React.useState(() => peerStore.data)
        React.useEffect(() => {
          if (sessionId === '' || last !== true) return undefined
          const stops = [
            formStore.subscribe(() => setForm(formStore.get(sessionId))),
            statusStore.subscribe(() => setItems(statusStore.get(sessionId))),
            peerStore.subscribe(() => setPeers(peerStore.data)),
          ]
          setForm(formStore.get(sessionId))
          setItems(statusStore.get(sessionId))
          statusStore.load(sessionId).catch(() => {})
          peerStore.load(sessionId).catch(() => {})
          loadProposal(sessionId)
          // The agent can propose in the middle of a turn, and the target answers on its own time: a light local poll.
          let timer = null
          try {
            timer = setInterval(() => {
              if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
              loadProposal(sessionId)
              if (statusStore.live(sessionId)) statusStore.load(sessionId).catch(() => {})
            }, 3000)
            if (timer !== null && typeof timer.unref === 'function') timer.unref()
          } catch (e) { timer = null }
          return () => { for (const stop of stops) { try { stop() } catch (e) { /* gone */ } } if (timer !== null) clearInterval(timer) }
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [sessionId, last])
        // A form opened with « Another session » and no target yet takes the most recent one (the person can change it).
        React.useEffect(() => {
          if (form.phase === 'open' && form.dest === 'other' && form.targetId === '' && peers.sessions.length > 0) {
            formStore.set(sessionId, { targetId: peers.sessions[0].id, targetTitle: labelOf(peers.sessions[0]) })
          }
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [form.phase, form.dest, form.targetId, peers])
        if (sessionId === '' || last !== true) return null
        const cards = items.map((item) => h(SentCard, { key: item.messageId, item }))
        let formNode = null
        if (form.phase === 'open') formNode = h(SendForm, { sessionId, form, peers })
        else if (form.phase === 'folded') {
          formNode = h('div', { className: 'kbmsg-folded', 'data-kb': 'session-msg-folded' }, h('span', null, T('folded')),
            h('button', { type: 'button', className: 'kbmsg-link', onClick: () => { formStore.openForm(sessionId, {}); focusForm() } }, T('reopen')))
        }
        if (cards.length === 0 && formNode === null) return null
        return h(React.Fragment, null, cards, formNode)
      }

      // ── the header button: opens the form (also the target of a received card's Reply) ──────────────
      const SendHeaderButton = (props) => {
        const sessionId = props !== null && props !== undefined && typeof props.sessionId === 'string' ? props.sessionId : ''
        React.useEffect(() => bus.subscribe((payload) => {
          if (sessionId === '' || payload === null || payload === undefined || typeof payload.targetSessionId !== 'string') return
          formStore.openForm(sessionId, { kind: 'message', dest: 'other', targetId: payload.targetSessionId, targetTitle: String(payload.targetTitle || ''), replyTo: String(payload.replyTo || '') })
          focusForm()
        }), [sessionId])
        if (sessionId === '') return null
        return h('button', {
          type: 'button',
          className: 'kbmsg-hbtn',
          title: T('sendTip'),
          'aria-label': T('send'),
          'data-kb': 'session-msg-send',
          onClick: () => { formStore.openForm(sessionId, {}); peerStore.load(sessionId, true).catch(() => {}); focusForm() },
        }, Icon(ICON_SEND))
      }

      // ── mounting ────────────────────────────────────────────────────────────
      function apply (ctx) {
        ctxRef = ctx
        ctx.effect(() => {
          if (typeof document === 'undefined' || document.head === null) return undefined
          const el = document.createElement('style')
          el.setAttribute('data-plugin', '@local/kybernos-session-msg')
          el.textContent = CSS
          document.head.appendChild(el)
          return () => { try { el.remove() } catch (e) { /* gone */ } }
        }, 'kybernos-session-msg: styles')

        // 1. the received card: a userText rule + its renderer. The registry is a service of the conversation UI, and a
        //    client context only exposes what it declared: ask for it (a runtime inject, so a build without it leaves the
        //    plain rendering instead of refusing the whole entry).
        try {
          const registerRule = (c) => {
            try {
              const ui = c !== null && c !== undefined && c.uiConversation !== undefined ? c.uiConversation : (c !== null && c !== undefined && typeof c.get === 'function' ? c.get('uiConversation') : null)
              if (ui !== null && ui !== undefined && ui.userText !== null && ui.userText !== undefined && typeof ui.userText.register === 'function') {
                ctx.effect(() => ui.userText.register(markerRule), 'kybernos-session-msg: user-text rule kb-msg')
              }
            } catch (e) { /* a build without the registry: plain rendering */ }
          }
          const direct = service('uiConversation')
          if (direct !== null && direct !== undefined) registerRule(ctx)
          else if (ctx !== null && ctx !== undefined && typeof ctx.inject === 'function') ctx.inject(['uiConversation'], registerRule)
        } catch (e) { /* rule unavailable: messages keep their plain rendering */ }
        try {
          ctx.effect(() => ctx.slots.inject('conversation.user.text.node', () => ctx.slots.register(
            { name: 'conversation.user.text.node', key: 'kb-msg', priority: 200 }, ReceivedCard)), 'kybernos-session-msg: received card')
        } catch (e) { /* no slot: plain rendering, nothing breaks */ }

        // 2. the header button.
        try {
          ctx.effect(() => ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register(
            { name: 'conversation.session.header.actions', id: 'kybernos-session-msg', order: 45 }, SendHeaderButton)), 'kybernos-session-msg: header send button')
        } catch (e) { /* no header slot */ }

        // 3. in the flow, at the end of the last answer (`conversation.chat.turnTail`): the sent trail and the form. A slot
        //    this build does not have simply never calls us.
        try {
          ctx.effect(() => ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register(
            { name: 'conversation.chat.turnTail', id: 'kybernos-session-msg-tail', order: 60 }, TailCards)), 'kybernos-session-msg: form and sent trail in the flow')
        } catch (e) { /* no tail slot: neither appears */ }
      }

      const plugin = { name: 'kybernos-session-msg', inject: ['slots'], apply }
      // Handles for test-client.mjs (the other bundles expose theirs the same way): the strings table, the marker parser,
      // the surfaces and the little stores.
      plugin.__test = { S, T, CSS, CODE, parseMarker, markerRule, ReceivedCard, SendForm, SendHeaderButton, SentCard, TailCards, formStore, peerStore, statusStore, bus, dispatch, closeForm, hintFor, canSendForm, kindAllowed, cleanTitle, agoLabel, loadProposal, navigate }
      return plugin
    } catch (e) {
      try { console.error('[kybernos-session-msg] client disabled:', e) } catch (e2) { /* console gone */ }
      return { name: 'kybernos-session-msg', inject: [], apply: () => {} }
    }
  },
})
