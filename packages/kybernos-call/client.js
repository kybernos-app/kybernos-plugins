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
      const post = async (path, body) => {
        try {
          const r = await fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
          return await r.json()
        } catch (e) { return null }
      }
      // Why a recording is not spoken in its own voice, said where the user looks (the panel).
      const cloneNote = (c) => {
        const why = (c === null || c === undefined) ? kt('le service de clonage ne répond pas', 'the clone service did not answer')
          : c.code === 'upload-off' ? kt('l’envoi des enregistrements est désactivé (Réglages › Appels)', 'sending recordings is off (Settings › Calls)')
            : c.code === 'no-key' ? kt('aucune clé ElevenLabs (Réglages › Appels › Service)', 'no ElevenLabs key (Settings › Calls › Service)')
              : c.code === 'no-sample' ? kt('l’enregistrement est introuvable sur cette machine', 'the recording is not on this machine')
                : (typeof c.error === 'string' && c.error !== '' ? c.error : kt('le service de clonage a refusé', 'the clone service refused'))
        return kt(' · voix enregistrée non utilisée : ', ' · recorded voice not used: ') + why + kt(' — voix par défaut', ' — default voice')
      }
      const AGENT_STATES = { listening: ['à l’écoute', 'listening'], thinking: ['réfléchit', 'thinking'], speaking: ['parle', 'speaking'], initializing: ['démarre', 'starting'] }

      const open = async (opts) => {
        const o = (opts !== null && typeof opts === 'object') ? opts : {}
        if (live !== null) await hangUp() // one call at a time
        setState({
          role: o.roleId, name: String(o.name ?? ''), mode: o.mode === 'video' ? 'video' : 'voice',
          phase: 'preparing', note: kt('lecture des réglages d’appel…', 'reading call settings…'),
          lines: [], startedAt: null, agent: null, muted: false, agentState: ''
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
          patch({ phase: 'error', note: kt('aucun secret d’appel sur cette machine — voir Réglages › Appels › Service', 'no call secrets on this machine — see Settings › Calls › Service') })
          return
        }
        // A recording given to the member is spoken in its own voice only if the host could give it a clone
        // (and the user allowed it): otherwise the call goes on with the default voice, and says so.
        let voice = (o.voice !== null && typeof o.voice === 'object') ? o.voice : null
        let voiceNote = ''
        if (voice !== null && voice.custom === true) {
          if (typeof voice.id === 'string' && voice.id !== '') {
            patch({ note: kt('préparation de la voix enregistrée…', 'preparing the recorded voice…') })
            const c = await post('/clone', { rootId: voice.rootId ?? null, voiceId: voice.id, name: voice.name ?? o.name })
            if (c !== null && c !== undefined && c.ok === true) voice = { custom: true, id: voice.id }
            else { voice = { custom: true }; voiceNote = cloneNote(c) }
          } else { voice = { custom: true }; voiceNote = cloneNote({ code: 'no-sample' }) }
        }
        // 2) The token: the host starts the agent, wakes it on a fresh room, and returns all of it.
        patch({ note: kt('démarrage de l’agent…', 'starting the agent…') })
        // What the surface did not say (the mode, the language) is left out: the host fills it from the settings.
        const body = Object.assign({ sessionId: o.sessionId ?? null, kyberId: o.kyberId ?? null, roleId: o.roleId ?? null, name: String(o.name ?? '') },
          (o.mode === 'video' || o.mode === 'voice') ? { mode: o.mode } : {},
          (typeof o.language === 'string' && o.language !== '') ? { language: o.language } : {},
          { voice: voice, identity: 'moi' })
        const token = await post('/token', body)
        if (token === null || token.ok !== true) {
          patch({ phase: 'error', note: (token !== null && typeof token.error === 'string') ? token.error : kt('pas de jeton d’appel', 'no call token') })
          return
        }
        const agent = (token.agent !== null && token.agent !== undefined) ? token.agent : null
        // 3) The join: microphone published, received tracks attached to the panel.
        patch(Object.assign({ note: kt('connexion à la salle…', 'joining the room…'), agent: agent }, (token.meta && (token.meta.mode === 'video' || token.meta.mode === 'voice')) ? { mode: token.meta.mode } : {}))
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
          if (typeof lib.RoomEvent.ParticipantAttributesChanged === 'string') {
            room.on(lib.RoomEvent.ParticipantAttributesChanged, (changed) => {
              try { if (changed !== null && changed !== undefined && typeof changed['lk.agent.state'] === 'string') patch({ agentState: changed['lk.agent.state'] }) } catch (e) { /* unreadable attributes */ }
            })
          }
          room.on(lib.RoomEvent.ParticipantDisconnected, () => patch({ note: kt('l’agent a quitté la salle', 'the agent left the room') }))
          room.on(lib.RoomEvent.Disconnected, () => patch({ phase: 'ended', note: kt('appel terminé', 'call ended') }))
          await room.connect(token.url, token.token)
          const mic = await room.localParticipant.setMicrophoneEnabled(true)
          live = { room: room, mic: mic }
          patch({
            phase: 'live', startedAt: Date.now(),
            note: ((agent !== null && agent.dispatched === true)
              ? (kt('voix ', 'voice ') + String(status.avatar !== null && status.avatar !== undefined ? status.avatar : '') + ' · ' + String(token.room))
              : kt('personne n’écoute encore de l’autre côté', 'nobody is listening on the other side yet')) + voiceNote
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
              h('span', { key: 'p', style: css.mono }, s.phase + (isLive ? ' · ' + clock(seconds(s)) : '') + (isLive && s.agentState && AGENT_STATES[s.agentState] ? ' · ' + kt(AGENT_STATES[s.agentState][0], AGENT_STATES[s.agentState][1]) : ''))
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

      // ── the styles (one <style>, removed when the plugin stops) ──
      const T = {
        line: 'var(--dsw-alias-border-l2,rgba(255,255,255,.12))', text: 'var(--dsw-alias-label-primary,#f9fafb)',
        mute: 'var(--dsw-alias-label-secondary,#adb2b8)', faint: 'var(--dsw-alias-label-tertiary,#8b9096)',
        layer: 'var(--dsw-alias-bg-layer-2,#2a2b2d)', hover: 'var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))',
        ok: 'var(--dsw-alias-state-success-primary,#22c55e)', warn: 'var(--dsw-alias-state-warn-primary,#f59e0b)',
        err: 'var(--dsw-alias-state-error-primary,#f25a5a)', brand: 'var(--dsw-alias-brand-primary,#7aaaff)'
      }
      const CSS = `
.kbcl-pill{appearance:none;display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px 0 8px;border:1px solid ${T.line};border-radius:24px;background:transparent;color:${T.mute};font:inherit;font-size:12.5px;line-height:1;cursor:pointer}
.kbcl-pill:hover{background:${T.hover};color:${T.text}}
.kbcl-pill:focus-visible{outline:2px solid ${T.brand};outline-offset:1px}
.kbcl-pill[aria-pressed="true"]{border-color:${T.err};color:${T.err}}
.kbcl-page{display:flex;flex-direction:column;gap:16px;max-width:780px;color:${T.text};font-size:14px}
.kbcl-page h2{margin:0;font-size:20px;font-weight:700}
.kbcl-sub{font-size:12.5px;line-height:1.5;color:${T.mute}}
.kbcl-tabs{display:flex;gap:2px;border-bottom:1px solid ${T.line}}
.kbcl-tab{appearance:none;border:0;background:transparent;color:${T.mute};font:inherit;font-size:13px;padding:9px 14px;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px}
.kbcl-tab[aria-selected="true"]{color:${T.text};font-weight:600;border-bottom-color:${T.text}}
.kbcl-tab:focus-visible{outline:2px solid ${T.brand};outline-offset:-2px}
.kbcl-block{border:1px solid ${T.line};border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:10px}
.kbcl-block h3{margin:0;font-size:14px;font-weight:700}
.kbcl-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.kbcl-grow{flex:1;min-width:0}
.kbcl-lab{font-size:12px;font-weight:600;color:${T.mute}}
.kbcl-in{box-sizing:border-box;height:32px;min-width:0;border:1px solid ${T.line};border-radius:8px;padding:0 10px;background:transparent;color:${T.text};font:inherit;font-size:13px}
.kbcl-in:focus-visible{outline:2px solid ${T.brand};outline-offset:1px}
.kbcl-in option{background:${T.layer};color:${T.text}}
.kbcl-num{width:72px;text-align:center}
.kbcl-btn{appearance:none;height:32px;padding:0 12px;border:1px solid ${T.line};border-radius:8px;background:transparent;color:${T.text};font:inherit;font-size:12.5px;cursor:pointer}
.kbcl-btn:hover{background:${T.hover}}
.kbcl-btn:disabled{opacity:.5;cursor:not-allowed}
.kbcl-btn.kbcl-pri{background:${T.text};color:var(--dsw-alias-bg-layer-1,#111);border-color:${T.text}}
.kbcl-btn.kbcl-red{color:${T.err};border-color:${T.err}}
.kbcl-btn:focus-visible{outline:2px solid ${T.brand};outline-offset:1px}
.kbcl-seg{display:inline-flex;border:1px solid ${T.line};border-radius:8px;overflow:hidden}
.kbcl-seg button{appearance:none;border:0;background:transparent;color:${T.mute};font:inherit;font-size:12.5px;padding:0 14px;height:30px;cursor:pointer}
.kbcl-seg button[aria-pressed="true"]{background:${T.hover};color:${T.text};font-weight:600}
.kbcl-chip{display:inline-flex;align-items:center;gap:5px;height:20px;padding:0 8px;border-radius:999px;border:1px solid ${T.line};font-size:11px;color:${T.mute}}
.kbcl-chip i{width:6px;height:6px;border-radius:50%;background:currentColor;display:inline-block}
.kbcl-chip.kbcl-ok{color:${T.ok};border-color:${T.ok}}
.kbcl-chip.kbcl-warn{color:${T.warn};border-color:${T.warn}}
.kbcl-chip.kbcl-err{color:${T.err};border-color:${T.err}}
.kbcl-eng{display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1px solid ${T.line};flex-wrap:wrap}
.kbcl-eng:first-of-type{border-top:0;padding-top:0}
.kbcl-notice{font-size:12.5px;padding:8px 12px;border-radius:8px;border:1px solid ${T.line};color:${T.mute}}
.kbcl-notice.kbcl-bad{border-color:${T.err};color:${T.err}}
.kbcl-check{display:flex;gap:10px;align-items:flex-start;font-size:13px;line-height:1.5}
.kbcl-check input{margin-top:3px}
@media (prefers-reduced-motion:reduce){.kbcl-pill{transition:none}}
`
      const PHONE = (size) => h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
        h('path', { d: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2' }))

      // ── a button in the composer of any session: the call belongs to the session, not to a team ──
      const useCall = () => {
        const [, rerender] = React.useReducer((n) => n + 1, 0)
        React.useEffect(() => { subscribers.add(rerender); return () => { subscribers.delete(rerender) } }, [])
        return state
      }
      const CallPill = (props) => {
        const current = useCall()
        const active = current !== null
        const sessionId = (props !== null && props !== undefined && typeof props.sessionId === 'string') ? props.sessionId : null
        const onClick = () => {
          if (active) return hangUp()
          return open({ sessionId: sessionId, kyberId: null, roleId: null, name: kt('Assistant', 'Assistant'), voice: null })
        }
        const label = active ? kt('Raccrocher', 'Hang up') : kt('Appeler', 'Call')
        return h('button', {
          type: 'button', className: 'kbcl-pill', 'data-kb': 'kybernos-call-pill', 'data-act': active ? 'hangup-pill' : 'call', 'aria-pressed': active ? 'true' : 'false',
          title: active ? kt('Raccrocher l’appel en cours', 'Hang up the call in progress') : kt('Parler à l’assistant de cette session, à voix haute', 'Talk to this session’s assistant, out loud'),
          onClick: onClick
        }, [PHONE(13), h('span', { key: 't' }, label)])
      }

      // ── Settings › Calls ──
      const LANGUAGES = [['fr', 'Français'], ['en', 'English'], ['es', 'Español'], ['de', 'Deutsch'], ['it', 'Italiano'], ['pt', 'Português'], ['nl', 'Nederlands'], ['ar', 'العربية'], ['zh', '中文'], ['ja', '日本語'], ['ko', '한국어'], ['ru', 'Русский'], ['tr', 'Türkçe'], ['pl', 'Polski'], ['hi', 'हिन्दी']]
      const getJson = async (url) => { try { const r = await fetch(url, { headers: { accept: 'application/json' } }); return await r.json() } catch (e) { return null } }
      const Chip = (kind, text) => h('span', { className: 'kbcl-chip' + (kind ? ' kbcl-' + kind : '') }, [h('i', { key: 'i' }), text])

      const SettingsPage = () => {
        const [data, setData] = React.useState(null)
        const [voices, setVoices] = React.useState(null)
        const [tab, setTab] = React.useState('essential')
        const [notice, setNotice] = React.useState(null) // { bad, text }
        const [tests, setTests] = React.useState({})
        const [draft, setDraft] = React.useState({})
        const [busy, setBusy] = React.useState(false)
        const load = async () => {
          const [d, v] = await Promise.all([getJson(API + '/settings'), getJson('/kybernos/tts/voices')])
          setData(d !== null && d.ok === true ? d : { ok: false })
          setVoices(v !== null && v.ok === true ? v : null)
        }
        React.useEffect(() => { load() }, [])
        const say = (bad, text) => setNotice({ bad: bad, text: text })
        const reasons = (r) => (r !== null && r !== undefined && r.refused ? Object.keys(r.refused).map((k) => k + ': ' + r.refused[k]).join(' · ') : '')
        const save = async (patch) => {
          setBusy(true)
          const r = await post('/settings', { patch: patch })
          setBusy(false)
          if (r !== null && r.ok === true) { setData((old) => Object.assign({}, old, { settings: r.settings })); setNotice(null) } else say(true, kt('Réglage refusé — ', 'Setting refused — ') + (reasons(r) || (r && r.error) || kt('l’hôte ne répond pas (relancez DSH une fois)', 'the host does not answer (relaunch DSH once)')))
        }
        const saveKeys = async (patch) => {
          setBusy(true)
          const r = await post('/keys', { patch: patch })
          setBusy(false)
          if (r !== null && r.ok === true) { setDraft({}); await load(); say(false, kt('Enregistré.', 'Saved.')) } else say(true, kt('Clé refusée — ', 'Key refused — ') + (reasons(r) || (r && r.error) || kt('l’hôte ne répond pas', 'the host does not answer')))
        }
        const runTest = async (service) => {
          setTests((old) => Object.assign({}, old, { [service]: { busy: true } }))
          const r = await post('/test', { service: service })
          setTests((old) => Object.assign({}, old, { [service]: r === null ? { ok: false, error: kt('l’hôte ne répond pas', 'the host does not answer') } : r }))
        }
        const removeClone = async (id) => {
          setBusy(true)
          const r = await post('/clone', { action: 'delete', voiceId: id })
          setBusy(false)
          if (r !== null && r.ok === true) { await load(); say(false, kt('Voix clonée supprimée chez le fournisseur.', 'Cloned voice deleted at the provider.')) } else say(true, (r && r.error) || kt('Suppression impossible', 'Could not delete'))
        }
        if (data === null) return h('div', { className: 'kbcl-page', 'data-kb': 'kybernos-call-settings' }, h('div', { className: 'kbcl-sub' }, kt('Lecture des réglages…', 'Reading the settings…')))
        if (data.ok !== true) return h('div', { className: 'kbcl-page', 'data-kb': 'kybernos-call-settings' }, h('div', { className: 'kbcl-notice kbcl-bad' }, kt('Les routes d’appel ne sont pas chargées — relancez DSH une fois.', 'The call routes are not loaded — relaunch DSH once.')))
        const set = data.settings
        const keys = data.keys
        const tabs = [['essential', kt('Essentiel', 'Essentials')], ['engines', kt('Moteurs', 'Engines')], ['service', kt('Service', 'Service')]]
        const engines = (voices !== null && Array.isArray(voices.engines)) ? voices.engines.filter((e) => e.ready === true && Array.isArray(e.voices) && e.voices.length > 0) : []
        const voiceValue = set.defaultVoice === null ? '' : set.defaultVoice.engine + '::' + set.defaultVoice.voice
        const onVoice = (e) => {
          const v = e.target.value
          if (v === '') { save({ defaultVoice: null }); return }
          const at = v.indexOf('::')
          const eng = engines.find((x) => x.id === v.slice(0, at))
          const voice = eng ? eng.voices.find((x) => x.id === v.slice(at + 2)) : null
          if (voice) save({ defaultVoice: { engine: eng.id, voice: voice.id, lang: voice.lang || '' } })
        }
        const field = (name, label, opts) => {
          const o = opts || {}
          return h('div', { key: name, className: 'kbcl-grow', style: { minWidth: '220px', display: 'flex', flexDirection: 'column', gap: '4px' } }, [
            h('label', { key: 'l', className: 'kbcl-lab', htmlFor: 'kbcl-' + name }, label),
            h('div', { key: 'c', className: 'kbcl-row', style: { flexWrap: 'nowrap' } }, [
              h('input', {
                key: 'i', id: 'kbcl-' + name, 'data-field': name, className: 'kbcl-in kbcl-grow', type: o.secret ? 'password' : 'text', autoComplete: 'off', spellCheck: false,
                placeholder: keys[name] && keys[name].set ? (keys[name].host ? keys[name].host + ' — ' : '') + kt('défini : saisissez pour remplacer', 'set: type to replace') : (o.hint || ''),
                value: draft[name] === undefined ? '' : draft[name], onChange: (e) => setDraft((old) => Object.assign({}, old, { [name]: e.target.value }))
              }),
              keys[name] && keys[name].set ? h('button', { key: 'x', type: 'button', className: 'kbcl-btn', 'data-act': 'remove-' + name, disabled: busy, onClick: () => { if (window.confirm(kt('Retirer cette clé ?', 'Remove this key?'))) saveKeys({ [name]: '' }) } }, kt('Retirer', 'Remove')) : null
            ])
          ])
        }
        const testRow = (service, label) => {
          const t = tests[service]
          return h('div', { key: 'test-' + service, className: 'kbcl-row' }, [
            h('button', { key: 'b', type: 'button', className: 'kbcl-btn', 'data-act': 'test-' + service, disabled: t && t.busy === true, onClick: () => runTest(service) }, label),
            t && t.busy === true ? h('span', { key: 'w', className: 'kbcl-sub' }, kt('Test en cours…', 'Testing…')) : null,
            t && t.busy !== true ? h('span', { key: 'r', 'data-test-result': service }, t.ok === true ? Chip('ok', kt('connexion réussie', 'connection works')) : Chip('err', t.error || kt('échec', 'failed'))) : null
          ])
        }
        const pending = Object.keys(draft).filter((k) => typeof draft[k] === 'string' && draft[k].trim() !== '')
        const essential = [
          h('section', { key: 'voice', className: 'kbcl-block' }, [
            h('h3', { key: 'h' }, kt('Assistant de la session', 'The session’s assistant')),
            h('div', { key: 'd', className: 'kbcl-sub' }, kt('La voix de l’assistant quand vous appelez depuis une session, sans choisir un membre d’équipe. Un membre garde sa propre voix.', 'The assistant’s voice when you call from a session without picking a team member. A member keeps its own voice.')),
            h('div', { key: 'r', className: 'kbcl-row' }, [
              h('label', { key: 'l', className: 'kbcl-lab', htmlFor: 'kbcl-voice' }, kt('Voix', 'Voice')),
              h('select', { key: 's', id: 'kbcl-voice', 'data-field': 'defaultVoice', className: 'kbcl-in kbcl-grow', value: voiceValue, disabled: busy, onChange: onVoice },
                [h('option', { key: '', value: '' }, kt('Voix par défaut de l’app (Réglages › Voix)', 'The app’s default voice (Settings › Voice)'))].concat(engines.map((e) => h('optgroup', { key: e.id, label: e.name || e.id }, e.voices.map((v) => h('option', { key: e.id + '::' + v.id, value: e.id + '::' + v.id }, (v.label || v.id) + (v.lang ? ' (' + v.lang + ')' : '')))))))
            ])
          ]),
          h('section', { key: 'lang', className: 'kbcl-block' }, [
            h('h3', { key: 'h' }, kt('Langue de l’appel', 'Call language')),
            h('div', { key: 'r', className: 'kbcl-row' }, [
              h('select', { key: 's', 'data-field': 'language', 'aria-label': kt('Langue de l’appel', 'Call language'), className: 'kbcl-in', value: set.language, disabled: busy, onChange: (e) => save({ language: e.target.value }) },
                [h('option', { key: 'auto', value: 'auto' }, kt('Auto — suit ce que vous dites', 'Auto — follows what you say'))].concat(LANGUAGES.map((l) => h('option', { key: l[0], value: l[0] }, l[1])))),
              h('span', { key: 'c', className: 'kbcl-sub' }, set.language === 'auto' ? kt('L’assistant répond dans la langue que vous venez de parler.', 'The assistant answers in the language you just spoke.') : kt('L’assistant parle et écoute toujours cette langue.', 'The assistant always speaks and listens in this language.'))
            ])
          ]),
          h('section', { key: 'mode', className: 'kbcl-block' }, [
            h('h3', { key: 'h' }, kt('Mode par défaut', 'Default mode')),
            h('div', { key: 'r', className: 'kbcl-row' }, [
              h('span', { key: 's', className: 'kbcl-seg', role: 'group', 'aria-label': kt('Mode par défaut', 'Default mode') }, [
                h('button', { key: 'v', type: 'button', 'data-field': 'mode-voice', 'aria-pressed': set.mode === 'voice' ? 'true' : 'false', disabled: busy, onClick: () => save({ mode: 'voice' }) }, kt('Voix seule', 'Voice only')),
                h('button', { key: 'f', type: 'button', 'data-field': 'mode-video', 'aria-pressed': set.mode === 'video' ? 'true' : 'false', disabled: busy, onClick: () => save({ mode: 'video' }) }, kt('Avec visage', 'With a face'))
              ]),
              h('span', { key: 'c', className: 'kbcl-sub' }, kt('Un visage demande un fournisseur (onglet Service) ; sans lui, l’appel reste en voix.', 'A face needs a provider (Service tab); without one the call stays voice only.'))
            ])
          ]),
          h('section', { key: 'limits', className: 'kbcl-block' }, [
            h('h3', { key: 'h' }, kt('Raccrocher tout seul', 'Hang up by itself')),
            h('div', { key: 'r', className: 'kbcl-row' }, [
              h('label', { key: 'a', className: 'kbcl-row' }, [kt('après', 'after'), h('input', { key: 'i', type: 'number', min: 1, max: 60, 'data-field': 'silenceMinutes', 'aria-label': kt('Minutes de silence', 'Minutes of silence'), className: 'kbcl-in kbcl-num', defaultValue: set.silenceMinutes, onBlur: (e) => { const n = parseInt(e.target.value, 10); if (n !== set.silenceMinutes) save({ silenceMinutes: n }) } }), kt('min de silence', 'min of silence')]),
              h('label', { key: 'b', className: 'kbcl-row' }, [kt('ou', 'or'), h('input', { key: 'i', type: 'number', min: 5, max: 240, 'data-field': 'maxMinutes', 'aria-label': kt('Durée maximale en minutes', 'Maximum length in minutes'), className: 'kbcl-in kbcl-num', defaultValue: set.maxMinutes, onBlur: (e) => { const n = parseInt(e.target.value, 10); if (n !== set.maxMinutes) save({ maxMinutes: n }) } }), kt('min au total', 'min in all')])
            ])
          ]),
          h('section', { key: 'clone', className: 'kbcl-block' }, [
            h('h3', { key: 'h' }, kt('Voix enregistrées', 'Recorded voices')),
            h('label', { key: 'c', className: 'kbcl-check' }, [
              h('input', { key: 'i', type: 'checkbox', 'data-field': 'cloneUpload', checked: set.cloneUpload === true, disabled: busy, onChange: (e) => save({ cloneUpload: e.target.checked }) }),
              h('span', { key: 't' }, kt('Autoriser l’envoi d’un enregistrement à ElevenLabs pour le transformer en voix (clonage). L’enregistrement quitte cette machine. N’envoyez que votre voix, ou celle d’une personne qui a donné son accord.', 'Allow sending a recording to ElevenLabs to turn it into a voice (cloning). The recording leaves this machine. Only send your own voice, or that of someone who agreed.'))
            ]),
            keys.ELEVENLABS_API_KEY.set ? null : h('div', { key: 'n', className: 'kbcl-sub' }, kt('Il faut aussi une clé ElevenLabs (onglet Service).', 'An ElevenLabs key is needed too (Service tab).'))
          ])
        ]
        const engineRows = [
          h('section', { key: 'engines', className: 'kbcl-block' }, [
            h('h3', { key: 'h' }, kt('Ce qu’un appel utilise', 'What a call uses')),
            h('div', { key: 'listen', className: 'kbcl-eng' }, [
              h('div', { key: 'd', className: 'kbcl-grow' }, [h('div', { key: 'a', style: { fontWeight: 600 } }, kt('Écoute', 'Listening')), h('div', { key: 'b', className: 'kbcl-sub' }, kt('Whisper (Groq) : transforme votre voix en texte, dans toutes les langues.', 'Whisper (Groq): turns your voice into text, in any language.'))]),
              keys.GROQ_API_KEY.set ? Chip('ok', kt('prêt', 'ready')) : Chip('warn', kt('clé Groq à ajouter', 'Groq key needed'))
            ]),
            h('div', { key: 'voice', className: 'kbcl-eng' }, [
              h('div', { key: 'd', className: 'kbcl-grow' }, [h('div', { key: 'a', style: { fontWeight: 600 } }, kt('Voix', 'Voice')), h('div', { key: 'b', className: 'kbcl-sub' }, kt('Le moteur de voix de l’app (le même que « Preview » sur la carte d’un membre) : ', 'The app’s own voice engine (the one behind “Preview” on a member card): ') + (voices !== null && voices.config ? [voices.config.engine, voices.config.fallback].filter(Boolean).join(' → ') : '—') + '. ' + kt('Réglages › Voix.', 'Settings › Voice.'))]),
              engines.length > 0 ? Chip('ok', engines.map((e) => e.id).join(', ')) : Chip('warn', kt('aucun moteur prêt', 'no engine ready'))
            ]),
            h('div', { key: 'clone', className: 'kbcl-eng' }, [
              h('div', { key: 'd', className: 'kbcl-grow' }, [h('div', { key: 'a', style: { fontWeight: 600 } }, kt('Voix clonées', 'Cloned voices')), h('div', { key: 'b', className: 'kbcl-sub' }, kt('ElevenLabs, seulement si vous l’autorisez (onglet Essentiel).', 'ElevenLabs, only if you allow it (Essentials tab).'))]),
              keys.ELEVENLABS_API_KEY.set && set.cloneUpload ? Chip('ok', kt('prêt', 'ready')) : Chip('warn', keys.ELEVENLABS_API_KEY.set ? kt('envoi désactivé', 'sending is off') : kt('clé à ajouter', 'key needed')),
              keys.ELEVENLABS_API_KEY.set ? testRow('elevenlabs', kt('Tester la clé', 'Test the key')) : null
            ]),
            h('div', { key: 'face', className: 'kbcl-eng' }, [
              h('div', { key: 'd', className: 'kbcl-grow' }, [h('div', { key: 'a', style: { fontWeight: 600 } }, kt('Visage', 'Face')), h('div', { key: 'b', className: 'kbcl-sub' }, kt('LiveAvatar. Facultatif : sans lui, l’appel reste en voix.', 'LiveAvatar. Optional: without it the call stays voice only.'))]),
              keys.LIVEAVATAR_API_KEY.set ? Chip('ok', keys.LIVEAVATAR_SANDBOX.set && keys.LIVEAVATAR_SANDBOX.value === '1' ? kt('prêt (bac à sable, 60 s)', 'ready (sandbox, 60 s)') : kt('prêt', 'ready')) : Chip('', kt('non connecté', 'not connected'))
            ])
          ])
        ]
        const clones = Array.isArray(data.clones) ? data.clones : []
        const service = [
          h('section', { key: 'livekit', className: 'kbcl-block' }, [
            h('h3', { key: 'h' }, 'LiveKit'),
            h('div', { key: 'd', className: 'kbcl-sub' }, kt('LiveKit transporte la voix et l’image entre le navigateur et l’assistant. Les clés restent sur cette machine, dans un fichier privé.', 'LiveKit carries the voice and the picture between the browser and the assistant. The keys stay on this machine, in a private file.')),
            h('div', { key: 'f1', className: 'kbcl-row' }, [field('LIVEKIT_URL', kt('Adresse', 'Address'), { hint: 'wss://your-project.livekit.cloud' })]),
            h('div', { key: 'f2', className: 'kbcl-row' }, [field('LIVEKIT_API_KEY', kt('Clé API', 'API key'), {}), field('LIVEKIT_API_SECRET', kt('Secret', 'Secret'), { secret: true })]),
            testRow('livekit', kt('Tester la connexion', 'Test the connection'))
          ]),
          h('section', { key: 'others', className: 'kbcl-block' }, [
            h('h3', { key: 'h' }, kt('Autres services', 'Other services')),
            h('div', { key: 'f1', className: 'kbcl-row' }, [field('GROQ_API_KEY', kt('Clé Groq (écoute)', 'Groq key (listening)'), { secret: true })]),
            testRow('groq', kt('Tester la clé Groq', 'Test the Groq key')),
            h('div', { key: 'f2', className: 'kbcl-row' }, [field('ELEVENLABS_API_KEY', kt('Clé ElevenLabs (voix clonées)', 'ElevenLabs key (cloned voices)'), { secret: true })]),
            h('div', { key: 'f3', className: 'kbcl-row' }, [field('LIVEAVATAR_API_KEY', kt('Clé LiveAvatar (visage)', 'LiveAvatar key (face)'), { secret: true }), field('LIVEAVATAR_AVATAR_ID', kt('Identifiant d’avatar', 'Avatar id'), {})]),
            h('label', { key: 'sb', className: 'kbcl-check' }, [
              h('input', { key: 'i', type: 'checkbox', 'data-field': 'LIVEAVATAR_SANDBOX', checked: keys.LIVEAVATAR_SANDBOX.set && keys.LIVEAVATAR_SANDBOX.value === '1', disabled: busy, onChange: (e) => saveKeys({ LIVEAVATAR_SANDBOX: e.target.checked ? '1' : '0' }) }),
              h('span', { key: 't' }, kt('Bac à sable LiveAvatar (gratuit, 60 s par appel)', 'LiveAvatar sandbox (free, 60 s per call)'))
            ])
          ]),
          h('div', { key: 'save', className: 'kbcl-row' }, [
            h('button', { key: 'b', type: 'button', className: 'kbcl-btn kbcl-pri', 'data-act': 'save-keys', disabled: busy || pending.length === 0, onClick: () => saveKeys(pending.reduce((acc, k) => Object.assign(acc, { [k]: draft[k].trim() }), {})) }, kt('Enregistrer les clés', 'Save the keys')),
            h('span', { key: 's', className: 'kbcl-sub' }, pending.length === 0 ? kt('Saisissez une valeur pour la remplacer ; une clé déjà enregistrée n’est jamais réaffichée.', 'Type a value to replace it; a key that is already saved is never shown again.') : pending.length + kt(' champ(s) à enregistrer', ' field(s) to save'))
          ]),
          clones.length > 0 ? h('section', { key: 'clones', className: 'kbcl-block' }, [
            h('h3', { key: 'h' }, kt('Voix clonées chez ElevenLabs', 'Voices cloned at ElevenLabs')),
            h('div', { key: 'd', className: 'kbcl-sub' }, kt('Supprimer une voix la retire chez le fournisseur. Votre enregistrement d’origine reste sur cette machine.', 'Deleting a voice removes it at the provider. Your original recording stays on this machine.'))
          ].concat(clones.map((c) => h('div', { key: c.id, className: 'kbcl-row', 'data-clone': c.id }, [
            h('span', { key: 'n', className: 'kbcl-grow' }, (c.name || c.id) + (c.createdAt ? ' · ' + String(c.createdAt).slice(0, 10) : '')),
            h('button', { key: 'x', type: 'button', className: 'kbcl-btn kbcl-red', 'data-act': 'delete-clone', disabled: busy, onClick: () => { if (window.confirm(kt('Supprimer cette voix chez ElevenLabs ?', 'Delete this voice at ElevenLabs?'))) removeClone(c.id) } }, kt('Supprimer', 'Delete'))
          ])))) : null
        ]
        return h('div', { className: 'kbcl-page', 'data-kb': 'kybernos-call-settings' }, [
          h('div', { key: 'top' }, [h('h2', { key: 'h' }, kt('Appels', 'Calls')), h('div', { key: 's', className: 'kbcl-sub' }, kt('Parler à votre assistant ou à un membre de votre équipe, à voix haute, depuis n’importe quelle session.', 'Talk to your assistant or a team member out loud, from any session.'))]),
          h('div', { key: 'tabs', className: 'kbcl-tabs', role: 'tablist' }, tabs.map((t) => h('button', { key: t[0], type: 'button', role: 'tab', className: 'kbcl-tab', 'data-act': 'tab-' + t[0], 'aria-selected': tab === t[0] ? 'true' : 'false', onClick: () => setTab(t[0]) }, t[1]))),
          notice !== null ? h('div', { key: 'n', className: 'kbcl-notice' + (notice.bad ? ' kbcl-bad' : ''), role: 'status', 'data-kb': 'kybernos-call-notice' }, notice.text) : null,
          tab === 'essential' ? essential : (tab === 'engines' ? engineRows : service)
        ])
      }

      // ── the seam ──
      const seam = { version: 1, open: open, hangUp: hangUp, isOpen: () => state !== null }

      return {
        name: 'kybernos-call',
        inject: ['slots'],
        __test: { open: open, hangUp: hangUp, toggleMute: toggleMute, getState: () => state, setAudioHost: (el) => { audioHost = el }, CallPill: CallPill, SettingsPage: SettingsPage, CSS: CSS, cloneNote: cloneNote },
        apply (ctx) {
          try {
            const slots = ctx.slots
            ctx.effect(() => {
              const el = document.createElement('style')
              el.setAttribute('data-plugin', '@local/kybernos-call')
              el.textContent = CSS
              document.head.appendChild(el)
              return () => { try { el.remove() } catch (e) { /* already gone */ } }
            }, 'kybernos-call: styles')
            ctx.effect(() => slots.inject('shell.overlay', () => slots.register(
              { name: 'shell.overlay', id: 'kybernos-call-overlay', order: 30 }, Panel)), 'kybernos-call: call panel')
            // A button in the composer of every session: the call belongs to the session, not to a team.
            ctx.effect(() => slots.inject('conversation.composer.dock', () => slots.register(
              { name: 'conversation.composer.dock', id: 'kybernos-call', order: 6 },
              (props) => { try { return h(CallPill, { sessionId: props !== null && props !== undefined ? props.sessionId : undefined }) } catch (e) { return null } })), 'kybernos-call: call button in the composer')
            ctx.effect(() => slots.inject('settings.section', () => slots.register(
              { name: 'settings.section', id: 'kybernos-call', order: 31, label: kt('Appels', 'Calls') },
              () => h(SettingsPage))), 'kybernos-call: settings page')
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
