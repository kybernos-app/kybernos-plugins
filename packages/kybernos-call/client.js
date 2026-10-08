// kybernos-call: browser half.
//
// The call panel: it joins a LiveKit room (the SDK comes from this bundle's host, loaded at the
// first call only), publishes the microphone, attaches the tracks it receives, and shows what is
// said. The host starts the listening worker and wakes it on THIS room; what is heard goes back to
// the session as a real turn (see call-host.mjs). The browser never sees a secret: it receives a
// room-join token only.
//
// Entry point: `window.__KB_CALL__.open({ sessionId, kyberId, roleId, name, mode })`, called by any
// surface that wants a call (today: the Call / Video buttons of a team member in @local/kybernos).
// Without this bundle the seam does not exist and those buttons stay hidden.
//
// Loaded through window.__ModuleLoader__.load. The factory must RETURN a plugin object; on any
// evaluation error a disabled one is returned, so the GUI is preserved.
window.__ModuleLoader__.load({
  id: '@local/kybernos-call',
  factory (require) {
    try {
      const React = require('react')
      const ReactDOM = (() => { try { return require('react-dom') } catch (e) { return null } })()
      const h = React.createElement
      const API = '/kybernos-call'
      const SDK_URL = API + '/vendor/livekit-client.js'

      // ── language: French is the source, English the pair; a translated language is looked up by its French text ──
      const lang = () => {
        try { return String(typeof window.__KB_LANG_RESOLVE__ === 'function' ? window.__KB_LANG_RESOLVE__() : (document.documentElement.lang || 'en')) } catch (e) { return 'en' }
      }
      const kt = (fr, en) => {
        const l = lang()
        if (l === 'kybernos' || l.slice(0, 2) === 'fr') return fr
        if (l === 'en') return en
        try {
          const tr = typeof window.__KB_LANG_T__ === 'function' ? window.__KB_LANG_T__(fr) : null
          return (typeof tr === 'string' && tr !== '') ? tr : en
        } catch (e) { return en }
      }

      // ── the call state: one call at a time, outside React so any surface can open it ──
      let state = null // { role, name, mode, phase, note, lines, startedAt, agent, muted }
      let live = null // { room, mic }: the live room, kept out of the render
      let audioHost = null // the element that receives the attached tracks
      const subscribers = new Set()
      const setState = (next) => {
        state = (typeof next === 'function') ? next(state) : next
        subscribers.forEach((fn) => { try { fn() } catch (e) { /* a dead subscriber */ } })
      }
      const patch = (fields) => setState((old) => ((old === null) ? null : Object.assign({}, old, fields)))

      const loadSdk = () => new Promise((resolve, reject) => {
        if (window.LivekitClient !== undefined && window.LivekitClient !== null) { resolve(window.LivekitClient); return }
        const s = document.createElement('script')
        s.src = SDK_URL
        s.onload = () => ((window.LivekitClient !== undefined && window.LivekitClient !== null) ? resolve(window.LivekitClient) : reject(new Error('LiveKit SDK unavailable')))
        s.onerror = () => reject(new Error('LiveKit SDK unavailable'))
        document.head.appendChild(s)
      })

      const hangUp = async (reason) => {
        const current = live
        live = null
        if (current !== null) {
          try { if (current.mic !== null && current.mic !== undefined) await current.mic.stop() } catch (e) { /* already stopped */ }
          try { await current.room.disconnect() } catch (e) { /* already gone */ }
        }
        setState((old) => ((old === null) ? null : (reason === undefined ? null : Object.assign({}, old, { phase: 'ended', note: reason }))))
      }

      const messageOf = (e) => String((e !== null && e !== undefined && e.message !== undefined) ? e.message : e)

      const open = async (opts) => {
        const o = (opts !== null && typeof opts === 'object') ? opts : {}
        if (live !== null) await hangUp() // one call at a time
        setState({
          role: o.roleId, name: String(o.name ?? ''), mode: o.mode === 'video' ? 'video' : 'voice',
          phase: 'preparing', note: kt('lecture des réglages d’appel…', 'reading call settings…'),
          lines: [], startedAt: null, agent: null, muted: false
        })
        // 1) The machine's secrets: without them we say so, we do not invent a call.
        let status = null
        try {
          const r = await fetch(API + '/status', { headers: { accept: 'application/json' } })
          status = await r.json()
        } catch (e) { status = null }
        if (status === null || status.ok !== true) {
          patch({ phase: 'error', note: kt('les routes d’appel ne sont pas chargées — relancez DSH une fois', 'the call routes are not loaded — relaunch DSH once') })
          return
        }
        if (status.secrets !== 'posee') {
          patch({ phase: 'error', note: kt('aucun secret d’appel sur cette machine — voir kybernos/livekit.env dans le dossier DSH', 'no call secrets on this machine — see kybernos/livekit.env in the DSH folder') })
          return
        }
        // 2) The token: the host starts the agent, wakes it on a fresh room, and returns all of it.
        patch({ note: kt('démarrage de l’agent…', 'starting the agent…') })
        let token = null
        try {
          const r = await fetch(API + '/token', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              sessionId: o.sessionId ?? null, kyberId: o.kyberId ?? null, roleId: o.roleId ?? null,
              name: String(o.name ?? ''), mode: o.mode === 'video' ? 'video' : 'voice',
              language: typeof o.language === 'string' ? o.language : 'auto',
              voice: (o.voice !== null && typeof o.voice === 'object') ? o.voice : null, identity: 'moi'
            })
          })
          token = await r.json()
        } catch (e) { token = null }
        if (token === null || token.ok !== true) {
          patch({ phase: 'error', note: (token !== null && typeof token.error === 'string') ? token.error : kt('pas de jeton d’appel', 'no call token') })
          return
        }
        const agent = (token.agent !== null && token.agent !== undefined) ? token.agent : null
        // 3) The join: microphone published, received tracks attached to the panel.
        patch({ note: kt('connexion à la salle…', 'joining the room…'), agent: agent })
        try {
          const lib = await loadSdk()
          const room = new lib.Room({ adaptiveStream: false, dynacast: false })
          const attach = (track) => {
            try {
              const el = track.attach()
              if (audioHost !== null) audioHost.appendChild(el)
              el.autoplay = true
              el.playsInline = true
              if (track.kind === 'video') { el.style.width = '100%'; el.style.height = '100%'; el.style.objectFit = 'cover' }
            } catch (e) { /* a track without picture */ }
          }
          room.on(lib.RoomEvent.TrackSubscribed, (track) => attach(track))
          if (typeof lib.RoomEvent.TranscriptionReceived === 'string') {
            room.on(lib.RoomEvent.TranscriptionReceived, (segments, participant) => {
              try {
                const text = segments.map((s) => String(s.text || '')).join(' ').trim()
                if (text === '') return
                const who = (participant !== null && participant !== undefined && participant.identity !== undefined) ? String(participant.identity) : ''
                setState((old) => ((old === null) ? null : Object.assign({}, old, { lines: old.lines.concat([who + ': ' + text]).slice(-6) })))
              } catch (e) { /* unreadable segments */ }
            })
          }
          room.on(lib.RoomEvent.ParticipantDisconnected, () => patch({ note: kt('l’agent a quitté la salle', 'the agent left the room') }))
          room.on(lib.RoomEvent.Disconnected, () => patch({ phase: 'ended', note: kt('appel terminé', 'call ended') }))
          await room.connect(token.url, token.token)
          const mic = await room.localParticipant.setMicrophoneEnabled(true)
          live = { room: room, mic: mic }
          // A recording given to the member is not spoken by any engine yet: say which voice is used instead.
          const recorded = (o.voice !== null && typeof o.voice === 'object' && o.voice.custom === true)
            ? kt(' · voix enregistrée : la voix par défaut est utilisée (le clonage n’existe pas encore)', ' · recorded voice: the default voice is used (cloning is not available yet)')
            : ''
          patch({
            phase: 'live', startedAt: Date.now(),
            note: ((agent !== null && agent.dispatched === true)
              ? (kt('voix ', 'voice ') + String(status.avatar !== null && status.avatar !== undefined ? status.avatar : '') + ' · ' + String(token.room))
              : kt('personne n’écoute encore de l’autre côté', 'nobody is listening on the other side yet')) + recorded
          })
        } catch (e) {
          patch({ phase: 'error', note: kt('impossible de rejoindre la salle — ', 'could not join the room — ') + messageOf(e) })
        }
      }

      const toggleMute = () => {
        if (live === null || state === null) return
        const next = state.muted !== true
        try { live.room.localParticipant.setMicrophoneEnabled(next === false) } catch (e) { /* the room is going away */ }
        patch({ muted: next })
      }

      // ── the panel ──
      const css = {
        card: { position: 'fixed', right: '20px', bottom: '20px', zIndex: 1000, width: '340px', boxSizing: 'border-box', background: 'var(--dsw-alias-bg-layer-2, #FFFFFF)', color: 'var(--dsw-alias-label-primary, #16161A)', border: '1px solid var(--dsw-alias-border-l2, #E4E4E4)', borderRadius: '14px', boxShadow: '0 18px 48px rgba(0,0,0,0.22)', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' },
        row: { display: 'flex', alignItems: 'center', gap: '10px' },
        badge: { width: '38px', height: '38px', borderRadius: '10px', background: 'var(--dsw-alias-label-primary, #16161A)', color: 'var(--dsw-alias-bg-layer-2, #FFFFFF)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '12px' },
        col: { display: 'flex', flexDirection: 'column', gap: '2px', flexGrow: 1, minWidth: 0 },
        name: { fontSize: '14px', fontWeight: 700 },
        mono: { fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', fontSize: '11.5px', color: 'var(--dsw-alias-label-secondary, #6B7280)' },
        note: { fontSize: '12px', lineHeight: 1.45, color: 'var(--dsw-alias-label-secondary, #6B7280)' },
        hangUp: { height: '30px', padding: '0 12px', borderRadius: '8px', border: 'none', background: '#DC2626', color: '#FFFFFF', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer' },
        ghost: { height: '30px', padding: '0 12px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l2, #E4E4E4)', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: '12.5px' },
        lines: { display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '120px', overflow: 'auto' },
        line: { fontSize: '12.5px', lineHeight: 1.45 }
      }
      const seconds = (s) => (s.startedAt === null ? 0 : Math.max(0, Math.round((Date.now() - s.startedAt) / 1000)))
      const clock = (sec) => String(Math.floor(sec / 60)) + ':' + String(sec % 60).padStart(2, '0')

      const Panel = () => {
        const [, rerender] = React.useReducer((n) => n + 1, 0)
        React.useEffect(() => {
          subscribers.add(rerender)
          return () => { subscribers.delete(rerender) }
        }, [])
        // The clock ticks while the call is live (the state itself does not change every second).
        React.useEffect(() => {
          if (state === null || state.phase !== 'live') return undefined
          const id = setInterval(rerender, 1000)
          return () => clearInterval(id)
        }, [state === null ? null : state.phase])
        if (state === null) return null
        const s = state
        const isLive = s.phase === 'live'
        const note = (s.agent !== null && s.agent !== undefined && s.agent.dispatched === false && s.agent.dispatchError !== undefined)
          ? ('agent not dispatched: ' + String(s.agent.dispatchError))
          : ((typeof s.note === 'string') ? s.note : '')
        const node = h('div', { role: 'dialog', 'aria-label': kt('Panneau d’appel', 'Call panel'), 'data-kb': 'kybernos-call-panel', style: css.card }, [
          h('div', { key: 'head', style: css.row }, [
            h('span', { key: 'badge', style: css.badge }, s.mode === 'video' ? 'VID' : 'AUD'),
            h('div', { key: 'who', style: css.col }, [
              h('span', { key: 'n', style: css.name }, s.name),
              h('span', { key: 'p', style: css.mono }, s.phase + (isLive ? ' · ' + clock(seconds(s)) : ''))
            ]),
            h('button', { key: 'hang', type: 'button', 'data-act': 'hangup', 'aria-label': kt('Raccrocher', 'Hang up'), onClick: () => hangUp(), style: css.hangUp }, kt('Raccrocher', 'Hang up'))
          ]),
          note !== '' ? h('span', { key: 'note', style: css.note }, note) : null,
          h('div', { key: 'media', ref: (el) => { audioHost = el }, style: { height: s.mode === 'video' ? '180px' : '0px', borderRadius: '10px', overflow: 'hidden', background: '#16161A' } }),
          s.lines.length > 0 ? h('div', { key: 'lines', style: css.lines }, s.lines.map((l, i) => h('span', { key: i, style: css.line }, l))) : null,
          isLive ? h('div', { key: 'tools', style: css.row }, [
            h('button', { key: 'mute', type: 'button', 'data-act': 'mute', onClick: toggleMute, style: css.ghost }, s.muted === true ? kt('Réactiver', 'Unmute') : kt('Couper le micro', 'Mute me')),
            h('span', { key: 'hint', style: css.mono }, kt('ce qui se dit ici entre dans le fil', 'what is said here enters the thread'))
          ]) : null
        ])
        const canPortal = ReactDOM !== null && ReactDOM !== undefined && typeof ReactDOM.createPortal === 'function' && typeof document !== 'undefined' && document.body
        return canPortal ? ReactDOM.createPortal(node, document.body) : node
      }

      // ── the seam ──
      const seam = { version: 1, open: open, hangUp: hangUp, isOpen: () => state !== null }

      return {
        name: 'kybernos-call',
        inject: ['slots'],
        __test: { open: open, hangUp: hangUp, toggleMute: toggleMute, getState: () => state, setAudioHost: (el) => { audioHost = el } },
        apply (ctx) {
          try {
            const slots = ctx.slots
            ctx.effect(() => slots.inject('shell.overlay', () => slots.register(
              { name: 'shell.overlay', id: 'kybernos-call-overlay', order: 30 }, Panel)), 'kybernos-call: call panel')
            ctx.effect(() => {
              window.__KB_CALL__ = seam
              return () => { try { if (window.__KB_CALL__ === seam) delete window.__KB_CALL__ } catch (e) { /* window gone */ } }
            }, 'kybernos-call: seam')
          } catch (e) { console.warn('[kybernos-call] apply failed:', e) }
        }
      }
    } catch (e) {
      console.warn('[kybernos-call] disabled:', e)
      return { apply () {} }
    }
  }
})
