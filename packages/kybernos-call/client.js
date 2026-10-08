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
      let meterEl = null // the bar that follows the user's voice (its width is written straight to the element, 11 times a second)
      const subscribers = new Set()
      const setState = (next) => {
        state = (typeof next === 'function') ? next(state) : next
        subscribers.forEach((fn) => { try { fn() } catch (e) { /* a dead subscriber */ } })
      }
      let assist = null // { step: 1..4, pending } while the setup assistant is open: pending is the call that was asked for
      const setAssist = (next) => { assist = next; subscribers.forEach((fn) => { try { fn() } catch (e) { /* a dead subscriber */ } }) }
      const patch = (fields) => {
        if (fields.phase === 'error') cue('error')
        setState((old) => ((old === null) ? null : Object.assign({}, old, fields)))
      }

      // ── sounds: short soft cues made here (no audio file), one click to silence them, remembered per device ──
      const SOUND_KEY = 'kybernos-call:sounds'
      const soundsOn = () => { try { return window.localStorage.getItem(SOUND_KEY) !== '0' } catch (e) { return true } }
      let audioCtx = null
      const audioContext = () => {
        try {
          if (audioCtx === null) { const C = window.AudioContext || window.webkitAudioContext; if (typeof C !== 'function') return null; audioCtx = new C() }
          if (audioCtx.state === 'suspended' && typeof audioCtx.resume === 'function') audioCtx.resume()
          return audioCtx
        } catch (e) { return null }
      }
      // [frequency Hz, start s, length s]: connected = two rising notes, heard = one blip, end = two falling notes, error = one low note.
      const CUES = { connected: [[660, 0, 0.11], [880, 0.12, 0.17]], heard: [[560, 0, 0.07]], end: [[740, 0, 0.1], [520, 0.11, 0.17]], error: [[220, 0, 0.24]] }
      const cue = (name) => {
        if (state === null || state.sounds !== true) return
        const c = audioContext()
        if (c === null) return
        try {
          const t0 = c.currentTime + 0.01
          for (const [freq, at, len] of (CUES[name] || [])) {
            const osc = c.createOscillator()
            const gain = c.createGain()
            osc.type = 'sine'
            osc.frequency.value = freq
            gain.gain.setValueAtTime(0.0001, t0 + at)
            gain.gain.exponentialRampToValueAtTime(0.07, t0 + at + 0.015)
            gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len)
            osc.connect(gain)
            gain.connect(c.destination)
            osc.start(t0 + at)
            osc.stop(t0 + at + len + 0.02)
          }
        } catch (e) { /* no sound is better than a broken call */ }
      }
      const toggleSounds = () => {
        if (state === null) return
        const next = state.sounds !== true
        try { window.localStorage.setItem(SOUND_KEY, next ? '1' : '0') } catch (e) { /* storage blocked: it lasts for this call only */ }
        patch({ sounds: next })
        if (next) { audioContext(); cue('heard') }
      }

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
        if (current !== null && state !== null && state.phase === 'live') cue('end')
        if (current !== null && current.meter !== undefined && current.meter !== null) {
          try { clearInterval(current.meter.timer) } catch (e) { /* nothing to stop */ }
          try { current.meter.cleanup() } catch (e) { /* already closed */ }
        }
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
          lines: [], startedAt: null, agent: null, muted: false, agentState: '', mics: [], micId: '', joined: false,
          working: false, sounds: soundsOn()
        })
        audioContext() // created inside the click, or the browser keeps it silent
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
          if (status.setupDone === true) {
            // The assistant has been through: do not send the user round it again, say where to look.
            patch({ phase: 'error', note: kt('les appels ne sont pas configurés : voir Réglages › Appels › Bilan de santé', 'calls are not set up: see Settings › Calls › Health') })
            return
          }
          // Nothing is set up on this machine: the setup assistant takes over (it opens the call it was asked for when it is done).
          setState(null)
          setAssist({ step: 1, pending: o })
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
          // The worker is a participant of the room: until one shows up, nobody can hear the user (a busy or stopped worker is silent).
          let assistantSeen = false
          const assistantHere = () => {
            if (assistantSeen) return
            assistantSeen = true
            patch({ joined: true, note: voiceNote.replace(/^ · /, '') })
            cue('connected')
          }
          room.on(lib.RoomEvent.TrackSubscribed, (track) => { attach(track); assistantHere() })
          if (typeof lib.RoomEvent.ParticipantConnected === 'string') room.on(lib.RoomEvent.ParticipantConnected, () => assistantHere())
          if (typeof lib.RoomEvent.TranscriptionReceived === 'string') {
            room.on(lib.RoomEvent.TranscriptionReceived, (segments, participant) => {
              try {
                const text = segments.map((s) => String(s.text || '')).join(' ').trim()
                if (text === '') return
                const who = (participant !== null && participant !== undefined && participant.identity !== undefined) ? String(participant.identity) : ''
                // A transcript arrives in growing pieces under one segment id: the line is rewritten, not repeated.
                const segmentId = (segments.length > 0 && segments[0] !== null && typeof segments[0].id === 'string') ? segments[0].id : null
                setState((old) => {
                  if (old === null) return null
                  const lines = old.lines.slice()
                  const ids = (Array.isArray(old.lineIds) ? old.lineIds : []).slice()
                  while (ids.length < lines.length) ids.unshift(null)
                  const label = (who === 'moi') ? kt('Moi', 'Me') : (old.name !== '' ? old.name : who)
                  const at = segmentId === null ? -1 : ids.lastIndexOf(segmentId)
                  if (at >= 0) lines[at] = label + ': ' + text
                  else { lines.push(label + ': ' + text); ids.push(segmentId) }
                  return Object.assign({}, old, { lines: lines.slice(-6), lineIds: ids.slice(-6) })
                })
              } catch (e) { /* unreadable segments */ }
            })
          }
          if (typeof lib.RoomEvent.ParticipantAttributesChanged === 'string') {
            room.on(lib.RoomEvent.ParticipantAttributesChanged, (changed) => {
              try {
                if (changed === null || changed === undefined) return
                if (typeof changed['lk.agent.state'] === 'string') { patch({ agentState: changed['lk.agent.state'] }); assistantHere() }
                // The worker says the session is working on what was just said: a soft "heard you" and the thinking indicator.
                if (typeof changed['kb.working'] === 'string') {
                  const working = changed['kb.working'] === '1'
                  const was = state !== null && state.working === true
                  patch({ working: working })
                  if (working && !was) cue('heard')
                }
              } catch (e) { /* unreadable attributes */ }
            })
          }
          room.on(lib.RoomEvent.ParticipantDisconnected, () => patch({ note: kt('l’agent a quitté la salle', 'the agent left the room') }))
          room.on(lib.RoomEvent.Disconnected, () => { if (state !== null && state.phase === 'live') cue('end'); patch({ phase: 'ended', note: kt('appel terminé', 'call ended') }) })
          await room.connect(token.url, token.token)
          const mic = await room.localParticipant.setMicrophoneEnabled(true)
          live = { room: room, mic: mic, meter: null }
          // The user sees that the microphone hears them (the first thing to know when nothing answers).
          try {
            if (typeof lib.createAudioAnalyser === 'function' && mic && mic.track) {
              const analyser = lib.createAudioAnalyser(mic.track)
              const timer = setInterval(() => {
                try { if (meterEl !== null && meterEl.style) meterEl.style.transform = 'scaleX(' + Math.min(1, Math.max(0.02, analyser.calculateVolume() * 2.2)).toFixed(3) + ')' } catch (e) { /* the element is gone */ }
              }, 90)
              live.meter = { timer: timer, cleanup: analyser.cleanup }
            }
          } catch (e) { /* no meter: the call goes on */ }
          // With several microphones (a laptop and a headset) the wrong one is the usual first-call surprise: let the user switch.
          let mics = []
          try {
            const found = (typeof lib.Room.getLocalDevices === 'function') ? await lib.Room.getLocalDevices('audioinput') : []
            mics = (Array.isArray(found) ? found : []).filter((d) => d && typeof d.deviceId === 'string' && d.deviceId !== '').map((d) => ({ id: d.deviceId, label: String(d.label || d.deviceId).slice(0, 60) }))
          } catch (e) { mics = [] }
          const current = (mic && mic.track && mic.track.mediaStreamTrack && typeof mic.track.mediaStreamTrack.getSettings === 'function') ? String(mic.track.mediaStreamTrack.getSettings().deviceId || '') : ''
          patch({ mics: mics, micId: current })
          const present = assistantSeen || (room.remoteParticipants !== undefined && room.remoteParticipants !== null && room.remoteParticipants.size > 0)
          patch({
            phase: 'live', startedAt: Date.now(), joined: present,
            note: present ? voiceNote.replace(/^ · /, '')
              : ((agent !== null && agent.dispatched === true)
                ? kt('en attente de l’assistant…', 'waiting for the assistant…')
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

      const switchMic = async (id) => {
        if (live === null || typeof id !== 'string' || id === '') return
        try { await live.room.switchActiveDevice('audioinput', id); patch({ micId: id }) } catch (e) { patch({ note: kt('impossible de changer de micro — ', 'could not switch microphone — ') + messageOf(e) }) }
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

      // The one word for where the call is: [kind (drives the colours and the animation), label].
      const moodOf = (s) => {
        if (s.phase === 'error') return ['err', kt('erreur', 'error')]
        if (s.phase === 'ended') return ['off', kt('terminé', 'ended')]
        if (s.phase !== 'live') return ['warn', kt('préparation…', 'preparing…')]
        if (s.joined !== true) return ['warn', kt('connexion à l’assistant…', 'connecting to the assistant…')]
        if (s.agentState === 'speaking') return ['speak', kt('parle', 'speaking')]
        if (s.working === true || s.agentState === 'thinking') return ['work', kt('réfléchit…', 'thinking…')]
        return ['ok', kt('à l’écoute', 'listening')]
      }

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
        // Why nobody answers is said first: the worker that did not start, then the one that could not be woken.
        const note = (s.agent !== null && s.agent !== undefined && s.agent.running === false && typeof s.agent.error === 'string')
          ? (kt('agent non démarré : ', 'worker not started: ') + s.agent.error)
          : ((s.agent !== null && s.agent !== undefined && s.agent.dispatched === false && s.agent.dispatchError !== undefined)
            ? ('agent not dispatched: ' + String(s.agent.dispatchError))
            : ((isLive && s.joined !== true && s.agent !== null && s.agent !== undefined && s.agent.dispatched === true && seconds(s) >= 15)
              ? kt('personne n’a rejoint l’appel : le worker est peut-être saturé ou arrêté. Raccrochez et rappelez ; sinon voir kybernos/logs/appel-agent.log', 'nobody joined the call: the worker may be busy or stopped. Hang up and call again; if it repeats, see kybernos/logs/appel-agent.log')
              : ((typeof s.note === 'string') ? s.note : '')))
        const mood = moodOf(s)
        const node = h('div', { role: 'dialog', 'aria-label': kt('Panneau d’appel', 'Call panel'), 'data-kb': 'kybernos-call-panel', 'data-state': mood[0], style: css.card }, [
          h('div', { key: 'head', style: css.row }, [
            h('span', { key: 'badge', style: css.badge }, s.mode === 'video' ? 'VID' : 'AUD'),
            h('div', { key: 'who', style: css.col }, [
              h('span', { key: 'n', style: css.name }, s.name),
              h('span', { key: 'p', className: 'kbcl-status', 'data-state': mood[0], role: 'status', 'aria-live': 'polite' }, [h('i', { key: 'd', className: 'kbcl-dot' }), mood[1] + (isLive ? ' · ' + clock(seconds(s)) : '')])
            ]),
            h('button', { key: 'hang', type: 'button', 'data-act': 'hangup', 'aria-label': kt('Raccrocher', 'Hang up'), onClick: () => hangUp(), style: css.hangUp }, kt('Raccrocher', 'Hang up'))
          ]),
          note !== '' ? h('span', { key: 'note', style: css.note }, note) : null,
          // Once the call is live: what the microphone hears (left), and what the assistant is doing (right).
          isLive ? h('div', { key: 'act', className: 'kbcl-activity', 'data-state': mood[0] }, [
            h('span', { key: 'w', className: 'kbcl-who' }, kt('Vous', 'You')),
            h('span', { key: 'm', className: 'kbcl-meter', 'aria-hidden': 'true' }, h('span', { className: 'kbcl-meter-fill', ref: (el) => { meterEl = el } })),
            h('span', { key: 'b', className: 'kbcl-bars', 'aria-hidden': 'true' }, [h('i', { key: 1 }), h('i', { key: 2 }), h('i', { key: 3 }), h('i', { key: 4 })])
          ]) : null,
          h('div', { key: 'media', ref: (el) => { audioHost = el }, style: { height: s.mode === 'video' ? '180px' : '0px', borderRadius: '10px', overflow: 'hidden', background: '#16161A' } }),
          s.lines.length > 0 ? h('div', { key: 'lines', style: css.lines }, s.lines.map((l, i) => h('span', { key: i, style: css.line }, l))) : null,
          (isLive && Array.isArray(s.mics) && s.mics.length > 1) ? h('select', { key: 'mic', 'data-act': 'mic', 'aria-label': kt('Micro', 'Microphone'), className: 'kbcl-in', value: s.micId, onChange: (e) => switchMic(e.target.value) },
            s.mics.map((m) => h('option', { key: m.id, value: m.id }, m.label))) : null,
          isLive ? h('div', { key: 'tools', style: Object.assign({}, css.row, { flexWrap: 'wrap' }) }, [
            h('button', { key: 'mute', type: 'button', 'data-act': 'mute', onClick: toggleMute, style: css.ghost }, s.muted === true ? kt('Réactiver', 'Unmute') : kt('Couper le micro', 'Mute me')),
            h('button', { key: 'snd', type: 'button', 'data-act': 'sounds', 'aria-pressed': s.sounds === true ? 'true' : 'false', title: kt('Petits sons : connexion, « j’ai entendu », fin d’appel', 'Small sounds: connected, “heard you”, call ended'), onClick: toggleSounds, style: css.ghost }, s.sounds === true ? kt('Sons : oui', 'Sounds: on') : kt('Sons : non', 'Sounds: off')),
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
        err: 'var(--dsw-alias-state-error-primary,#f25a5a)', brand: 'var(--dsw-alias-brand-primary,#7aaaff)', info: 'var(--dsw-alias-state-info-primary,#3b82f6)'
      }
      const CSS = `
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
.kbcl-btn[aria-pressed="true"]{background:${T.hover};border-color:${T.text};font-weight:600}
.kbcl-chip{display:inline-flex;align-items:center;gap:5px;height:20px;padding:0 8px;border-radius:999px;border:1px solid ${T.line};font-size:11px;color:${T.mute}}
.kbcl-chip i{width:6px;height:6px;border-radius:50%;background:currentColor;display:inline-block}
.kbcl-chip.kbcl-ok{color:${T.ok};border-color:${T.ok}}
.kbcl-chip.kbcl-warn{color:${T.warn};border-color:${T.warn}}
.kbcl-chip.kbcl-err{color:${T.err};border-color:${T.err}}
.kbcl-notice{font-size:12.5px;padding:8px 12px;border-radius:8px;border:1px solid ${T.line};color:${T.mute}}
.kbcl-notice.kbcl-bad{border-color:${T.err};color:${T.err}}
.kbcl-check{display:flex;gap:10px;align-items:flex-start;font-size:13px;line-height:1.5}
.kbcl-check input{margin-top:3px}
@keyframes kbcl-blink{0%,100%{opacity:1}50%{opacity:.25}}
@keyframes kbcl-ring{0%{box-shadow:0 0 0 0 currentColor}100%{box-shadow:0 0 0 7px transparent}}
@keyframes kbcl-bar{0%,100%{height:25%}50%{height:100%}}
@keyframes kbcl-think{0%,100%{height:25%;opacity:.35}50%{height:55%;opacity:1}}
.kbcl-status{display:inline-flex;align-items:center;gap:6px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;color:${T.mute}}
.kbcl-dot{width:8px;height:8px;border-radius:50%;background:currentColor;display:inline-block;flex:none}
.kbcl-status[data-state="ok"]{color:${T.ok}}
.kbcl-status[data-state="speak"]{color:${T.ok}}
.kbcl-status[data-state="speak"] .kbcl-dot{animation:kbcl-ring 1.1s ease-out infinite}
.kbcl-status[data-state="work"]{color:${T.info}}
.kbcl-status[data-state="work"] .kbcl-dot{animation:kbcl-blink .9s ease-in-out infinite}
.kbcl-status[data-state="warn"]{color:${T.warn}}
.kbcl-status[data-state="warn"] .kbcl-dot{animation:kbcl-blink 1s ease-in-out infinite}
.kbcl-status[data-state="err"]{color:${T.err}}
.kbcl-activity{display:flex;align-items:center;gap:10px}
.kbcl-who{font-size:11.5px;color:${T.mute};flex:none}
.kbcl-meter{flex:1;height:6px;border-radius:3px;background:${T.line};overflow:hidden;min-width:60px}
.kbcl-meter-fill{display:block;width:100%;height:100%;border-radius:3px;background:${T.ok};transform-origin:left center;transform:scaleX(.02);transition:transform 90ms linear}
.kbcl-bars{display:inline-flex;align-items:flex-end;gap:2px;height:16px;flex:none}
.kbcl-bars i{width:3px;height:25%;border-radius:2px;background:${T.faint};display:block}
.kbcl-activity[data-state="speak"] .kbcl-bars i{background:${T.ok};animation:kbcl-bar .8s ease-in-out infinite}
.kbcl-activity[data-state="work"] .kbcl-bars i{background:${T.info};animation:kbcl-think 1.1s ease-in-out infinite}
.kbcl-bars i:nth-child(2){animation-delay:.15s!important}
.kbcl-bars i:nth-child(3){animation-delay:.3s!important}
.kbcl-bars i:nth-child(4){animation-delay:.45s!important}
.kbcl-activity[data-state="ok"] .kbcl-bars i{background:${T.ok}}
.kbcl-hdr{display:flex;align-items:center;gap:4px;margin-left:auto;order:99}
[class*="_headerActions"]:has(.kbcl-hdr){flex:1 1 auto}
.kbcl-hbtn{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:30px;min-width:30px;padding:0 6px;box-sizing:border-box;border:1px solid transparent;border-radius:9px;background:transparent;color:${T.mute};cursor:pointer;font:inherit;font-size:12.5px;transition:background .12s,color .12s}
.kbcl-hbtn:hover:not(:disabled){background:${T.hover};color:${T.text}}
.kbcl-hbtn:focus-visible{outline:2px solid ${T.brand};outline-offset:1px}
.kbcl-hbtn:disabled{opacity:.4;cursor:default}
.kbcl-hbtn.kbcl-hlive{background:#DC2626;color:#FFFFFF;padding:0 10px}
@keyframes kbcl-spin{to{transform:rotate(360deg)}}
.kbcl-veil{position:fixed;inset:0;z-index:1002;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px}
.kbcl-modal{box-sizing:border-box;width:min(620px,100%);max-height:88vh;overflow:auto;background:${T.layer};color:${T.text};border:1px solid ${T.line};border-radius:16px;padding:20px 22px;display:flex;flex-direction:column;gap:14px;box-shadow:0 24px 64px rgba(0,0,0,.35);font-size:14px}
.kbcl-hh{display:flex;align-items:center;gap:8px}
.kbcl-prov a,.kbcl-modal a{color:${T.brand}}
.kbcl-hl{appearance:none;display:inline-flex;align-items:center;gap:8px;border:0;background:transparent;color:${T.mute};font:inherit;font-size:12.5px;cursor:pointer;padding:0}
.kbcl-hl:hover{color:${T.text}}
.kbcl-hl:focus-visible{outline:2px solid ${T.brand};outline-offset:2px;border-radius:6px}
.kbcl-q{appearance:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;box-sizing:border-box;border-radius:50%;border:1px solid ${T.line};background:transparent;color:${T.mute};font:inherit;font-size:13px;line-height:1;cursor:pointer;flex:none;padding:0}
.kbcl-q:hover{background:${T.hover};color:${T.text}}
.kbcl-q:focus-visible{outline:2px solid ${T.brand};outline-offset:1px}
.kbcl-helpbox{display:flex;flex-direction:column;gap:4px;font-size:12.5px;line-height:1.5;color:${T.text};background:${T.hover};border-radius:10px;padding:10px 14px}
.kbcl-slots{display:flex;flex-direction:column;gap:8px}
.kbcl-slot{border:1px solid ${T.line};border-radius:12px;padding:10px 14px;display:flex;flex-direction:column;gap:8px}
.kbcl-preset{appearance:none;text-align:left;border:1px solid ${T.line};border-radius:12px;background:transparent;color:${T.text};font:inherit;font-size:13px;padding:8px 12px;cursor:pointer}
.kbcl-preset:hover:not(:disabled){background:${T.hover}}
.kbcl-preset[aria-pressed="true"]{border-color:${T.brand};box-shadow:0 0 0 1px ${T.brand}}
.kbcl-preset:disabled{opacity:.55;cursor:default}
.kbcl-found{border:1px dashed ${T.brand};border-radius:12px;padding:10px 14px;display:flex;flex-direction:column;gap:2px}
.kbcl-cost{border:1px solid ${T.line};border-radius:12px;padding:10px 14px;gap:16px}
.kbcl-grid{display:grid;grid-template-columns:minmax(150px,210px) minmax(0,1fr);gap:14px;align-items:start}
@media (max-width:640px){.kbcl-grid{grid-template-columns:minmax(0,1fr)}}
.kbcl-provnav{display:flex;flex-direction:column;gap:2px;min-width:0}
.kbcl-provbtn{appearance:none;display:flex;align-items:center;gap:8px;text-align:left;width:100%;min-width:0;box-sizing:border-box;white-space:normal;border:0;border-radius:8px;background:transparent;color:${T.text};font:inherit;font-size:13px;padding:7px 8px;cursor:pointer}
.kbcl-provbtn:hover{background:${T.hover}}
.kbcl-provbtn[aria-current="true"]{background:${T.hover};box-shadow:inset 0 0 0 1px ${T.line}}
.kbcl-dotmark{width:9px;height:9px;border-radius:50%;border:1px solid ${T.faint};flex:none;display:inline-block}
.kbcl-dotmark.kbcl-rdy{border-color:${T.ok};background:${T.ok}}
.kbcl-dotmark.kbcl-on{border-color:${T.brand};background:${T.brand}}
.kbcl-prov{border:1px solid ${T.line};border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:12px;min-width:0}
.kbcl-f{display:flex;flex-direction:column;gap:5px}
.kbcl-foot{border-top:1px solid ${T.line};padding-top:12px}
.kbcl-hic-ok{color:${T.ok}}
.kbcl-hic-warn{color:${T.warn}}
.kbcl-hic-bad{color:${T.err}}
.kbcl-hic-run{animation:kbcl-spin 1s linear infinite}
@media (prefers-reduced-motion:reduce){.kbcl-hbtn{transition:none}.kbcl-status .kbcl-dot,.kbcl-bars i,.kbcl-hic-run{animation:none!important}}
`
      const PHONE = (size) => h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
        h('path', { d: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2' }))

      // ── two buttons at the top right of the chat of any session (voice, video): the call belongs to the session, not to a team ──
      const CAMERA = (size) => h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' }, [
        h('rect', { key: 'r', x: 3, y: 6, width: 12, height: 12, rx: 2 }), h('path', { key: 'p', d: 'M15 10l5-3v10l-5-3z' })])
      const useCall = () => {
        const [, rerender] = React.useReducer((n) => n + 1, 0)
        React.useEffect(() => { subscribers.add(rerender); return () => { subscribers.delete(rerender) } }, [])
        return state
      }
      // Whether a face can be shown (a provider is set), read once when a header mounts: without one, a video call would be a voice call.
      const headerStatus = { provider: null, asked: false }
      const loadHeaderStatus = async () => {
        if (headerStatus.asked) return
        headerStatus.asked = true
        try {
          const r = await fetch(API + '/status', { headers: { accept: 'application/json' } })
          const d = await r.json()
          if (d !== null && d !== undefined && d.ok === true && typeof d.provider === 'string') headerStatus.provider = d.provider
        } catch (e) { headerStatus.asked = false /* try again at the next mount */ }
        subscribers.forEach((fn) => { try { fn() } catch (e) { /* a dead subscriber */ } })
      }
      const useAssistState = () => {
        const [, rerender] = React.useReducer((n) => n + 1, 0)
        React.useEffect(() => { subscribers.add(rerender); return () => { subscribers.delete(rerender) } }, [])
        return assist
      }
      const CallHeader = (props) => {
        const current = useCall()
        React.useEffect(() => { loadHeaderStatus() }, [])
        const active = current !== null
        const sessionId = (props !== null && props !== undefined && typeof props.sessionId === 'string') ? props.sessionId : null
        const start = (mode) => open({ sessionId: sessionId, kyberId: null, roleId: null, name: kt('Assistant', 'Assistant'), mode: mode, voice: null })
        if (active) {
          return h('div', { className: 'kbcl-hdr', 'data-kb': 'kybernos-call-header' },
            h('button', { type: 'button', className: 'kbcl-hbtn kbcl-hlive', 'data-act': 'hangup-header', title: kt('Raccrocher l’appel en cours', 'Hang up the call in progress'), 'aria-label': kt('Raccrocher', 'Hang up'), onClick: () => hangUp() }, [PHONE(15), h('span', { key: 't' }, kt('Raccrocher', 'Hang up'))]))
        }
        const noFace = headerStatus.provider === 'none'
        return h('div', { className: 'kbcl-hdr', 'data-kb': 'kybernos-call-header' }, [
          h('button', { key: 'v', type: 'button', className: 'kbcl-hbtn', 'data-act': 'call-voice', title: kt('Appel vocal : parler à l’assistant de cette session', 'Voice call: talk to this session’s assistant'), 'aria-label': kt('Appel vocal', 'Voice call'), onClick: () => start('voice') }, PHONE(17)),
          h('button', { key: 'c', type: 'button', className: 'kbcl-hbtn', 'data-act': 'call-video', disabled: noFace, title: noFace ? kt('Appel vidéo : ajoutez une clé LiveAvatar (Réglages › Appels › Service)', 'Video call: add a LiveAvatar key (Settings › Calls › Service)') : kt('Appel vidéo : l’assistant a un visage', 'Video call: the assistant has a face'), 'aria-label': kt('Appel vidéo', 'Video call'), onClick: () => start('video') }, CAMERA(17))
        ])
      }

      // ── Settings › Calls ──
      const LANGUAGES = [['fr', 'Français'], ['en', 'English'], ['es', 'Español'], ['de', 'Deutsch'], ['it', 'Italiano'], ['pt', 'Português'], ['nl', 'Nederlands'], ['ar', 'العربية'], ['zh', '中文'], ['ja', '日本語'], ['ko', '한국어'], ['ru', 'Русский'], ['tr', 'Türkçe'], ['pl', 'Polski'], ['hi', 'हिन्दी']]
      const getJson = async (url) => { try { const r = await fetch(url, { headers: { accept: 'application/json' } }); return await r.json() } catch (e) { return null } }
      const Chip = (kind, text) => h('span', { className: 'kbcl-chip' + (kind ? ' kbcl-' + kind : '') }, [h('i', { key: 'i' }), text])
      // Small line icons (24 grid, 2 px stroke; after the Lucide set, ISC). The app does not ship an icon font, so they are drawn here.
      const ICONS = {
        ear: [['path', 'M6 8.5a6.5 6.5 0 1 1 13 0c0 6-6 6-6 10a3.5 3.5 0 1 1-7 0'], ['path', 'M15 8.5a2.5 2.5 0 0 0-5 0v1a2 2 0 1 1 0 4']],
        bulb: [['path', 'M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5'], ['path', 'M9 18h6'], ['path', 'M10 22h4']],
        speaker: [['path', 'M11 5 6 9H2v6h4l5 4V5z'], ['path', 'M15.54 8.46a5 5 0 0 1 0 7.07'], ['path', 'M19.07 4.93a10 10 0 0 1 0 14.14']],
        face: [['circle', 12, 12, 10], ['circle', 12, 10, 3], ['path', 'M18 19a6 6 0 0 0-12 0']],
        radio: [['path', 'M4.9 19.1C1 15.2 1 8.8 4.9 4.9'], ['path', 'M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5'], ['circle', 12, 12, 2], ['path', 'M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5'], ['path', 'M19.1 4.9C23 8.8 23 15.1 19.1 19']],
        ok: [['circle', 12, 12, 10], ['path', 'm9 12 2 2 4-4']],
        warn: [['circle', 12, 12, 10], ['path', 'M12 8v4'], ['path', 'M12 16h.01']],
        bad: [['circle', 12, 12, 10], ['path', 'm15 9-6 6'], ['path', 'm9 9 6 6']],
        idle: [['circle', 12, 12, 10]],
        run: [['path', 'M21 12a9 9 0 1 1-6.219-8.56']]
      }
      const Ico = (name, size, cls) => h('svg', { width: size || 20, height: size || 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', className: cls || undefined, style: { flex: 'none' } },
        (ICONS[name] || ICONS.idle).map((d, i) => (d[0] === 'circle' ? h('circle', { key: i, cx: d[1], cy: d[2], r: d[3] }) : h('path', { key: i, d: d[1] }))))
      // A text of the catalogue is { fr, en }.
      const tx = (o) => ((o !== null && o !== undefined && typeof o === 'object') ? kt(o.fr, o.en) : String(o === undefined || o === null ? '' : o))

      // What the page says in its "?" helps: what it is, what it is for. One place, so the help and the page cannot drift apart.
      const HELP = () => ({
        overview: [
          [kt('Ce que c’est.', 'What it is.'), kt('Un appel est une chaîne de cinq maillons : votre voix, Écoute, Cerveau, Voix, Visage, le tout porté par la Ligne. Chaque maillon a un fournisseur.', 'A call is a chain of five slots: your voice, Listen, Think, Speak, Face, all carried by the Line. Each slot has one provider.')],
          [kt('Préréglages.', 'Presets.'), kt('Ils remplissent les maillons d’un coup. Vous pouvez ensuite changer chacun.', 'They fill the slots at once. You can change each one afterwards.')]
        ],
        providers: [
          [kt('Ce que c’est.', 'What it is.'), kt('Une page par fournisseur, avec la même disposition : prix, lien pour obtenir une clé, réglages propres, test.', 'One page per provider, same layout: price, where to get a key, its own settings, a test.')],
          [kt('Mode d’emploi.', 'How to use.'), kt('Collez la clé, appuyez sur Tester, puis sur Utiliser pour les appels.', 'Paste the key, press Test, then Use for calls.')],
          [kt('Sécurité.', 'Safety.'), kt('Les clés restent sur cet ordinateur, dans un fichier privé, et ne sont jamais réaffichées. Si un fournisseur de voix échoue, la voix du Mac prend le relais.', 'Keys stay on this computer, in a private file, and are never shown again. If a voice provider fails, the Mac voice takes over.')]
        ],
        health: [
          [kt('Ce que c’est.', 'What it is.'), kt('Un seul bouton vérifie le micro, chaque fournisseur utilisé, la voix, le visage, la ligne et le moteur d’appel.', 'One button checks the microphone, every provider in use, the voice, the face, the line and the call engine.')],
          [kt('Quand.', 'When.'), kt('Après avoir changé de fournisseur, ou quand un appel reste muet. Chaque ligne en échec dit quoi faire.', 'After changing a provider, or when a call is silent. Each failing row says what to do.')]
        ]
      })
      const Help = (props) => {
        const lines = props.lines
        return [
          h('div', { key: 'hd', className: 'kbcl-hh' }, [
            h('button', { key: 'b', type: 'button', className: 'kbcl-hl', 'data-act': 'help-' + props.id, 'aria-expanded': props.open === true ? 'true' : 'false', onClick: props.onToggle }, [h('span', { key: 'q', className: 'kbcl-q', 'aria-hidden': 'true' }, props.open === true ? '×' : '?'), h('span', { key: 't' }, kt('À quoi sert cette page ?', 'What is this page for?'))])
          ]),
          props.open === true ? h('div', { key: 'tx', className: 'kbcl-helpbox', 'data-help': props.id }, lines.map((l, i) => h('div', { key: i }, [h('b', { key: 'a' }, l[0] + ' '), l[1]]))) : null
        ]
      }

      // The settings, loaded once and changed through the host: all-or-nothing, the host's reasons shown as they are.
      const useCalls = () => {
        const [data, setData] = React.useState(null)
        const [voices, setVoices] = React.useState(null)
        const [models, setModels] = React.useState([]) // the audio models of the providers already set up in Models: [{ provider, models: [{ id, kind }] }]
        const [notice, setNotice] = React.useState(null) // { bad, text }
        const [busy, setBusy] = React.useState(false)
        const load = async () => {
          const [d, v, m] = await Promise.all([getJson(API + '/settings'), getJson('/kybernos/tts/voices'), getJson('/kybernos/models/audio')])
          setData(d !== null && d.ok === true ? d : { ok: false })
          setVoices(v !== null && v.ok === true ? v : null)
          setModels(m !== null && m.ok === true && Array.isArray(m.providers) ? m.providers : [])
        }
        React.useEffect(() => { load() }, [])
        const say = (bad, text) => setNotice({ bad: bad, text: text })
        const reasons = (r) => (r !== null && r !== undefined && r.refused ? Object.keys(r.refused).map((k) => k + ': ' + r.refused[k]).join(' · ') : '')
        const save = async (patch) => {
          setBusy(true)
          const r = await post('/settings', { patch: patch })
          setBusy(false)
          if (r !== null && r.ok === true) { await load(); setNotice(null); return true }
          say(true, kt('Réglage refusé — ', 'Setting refused — ') + (reasons(r) || (r && r.error) || kt('l’hôte ne répond pas (relancez DSH une fois)', 'the host does not answer (relaunch DSH once)')))
          return false
        }
        const saveKeys = async (patch) => {
          setBusy(true)
          const r = await post('/keys', { patch: patch })
          setBusy(false)
          if (r !== null && r.ok === true) { await load(); setNotice(null); return true }
          say(true, kt('Valeur refusée — ', 'Value refused — ') + (reasons(r) || (r && r.error) || kt('l’hôte ne répond pas', 'the host does not answer')))
          return false
        }
        // A preset fills several slots: the page is "busy" until what it shows is what was saved (a Continue clicked too soon would read the old choice).
        const preset = async (id) => {
          setBusy(true)
          const r = await post('/preset', { id: id })
          if (r !== null && r.ok === true) { await load(); setNotice(null) } else say(true, (r && r.error) || kt('Préréglage refusé', 'Preset refused'))
          setBusy(false)
        }
        return { data: data, voices: voices, models: models, notice: notice, busy: busy, load: load, save: save, saveKeys: saveKeys, preset: preset, say: say, setNotice: setNotice }
      }
      const usedProvider = (d, slot) => {
        const s = d.settings
        if (slot === 'listen') return s.use.listen
        if (slot === 'face') return s.use.face
        if (slot === 'speak') return s.defaultVoice === null ? 'app' : s.defaultVoice.engine
        if (slot === 'think') return 'session'
        return 'livekit'
      }
      // The provider of the user's Models that holds the model a catalogue entry points to ('qwen-audio-3.0-asr-flash'), or null.
      const inModels = (c, p) => { const hit = (c.models || []).find((g) => g.models.some((m) => m.id === p.model)); return hit === undefined ? null : hit.provider }
      const providerOf = (d, id) => d.providers.find((p) => p.id === id) || null
      const stateChip = (p) => (p.available !== true ? Chip('warn', kt('Bientôt', 'Coming soon')) : (p.ready === true ? Chip('ok', kt('Prêt', 'Ready')) : Chip('warn', kt('Clé manquante', 'Needs a key'))))
      const SAMPLES = { fr: 'Bonjour, je suis votre assistant. Comment puis-je vous aider ?', en: 'Hello, I am your assistant. How can I help you?', es: 'Hola, soy tu asistente. ¿En qué puedo ayudarte?', de: 'Hallo, ich bin dein Assistent. Wie kann ich dir helfen?', it: 'Ciao, sono il tuo assistente. Come posso aiutarti?', pt: 'Olá, sou o seu assistente. Como posso ajudar?' }

      // One provider's page. The same layout for every provider of every slot, drawn from the catalogue the host sends.
      const ProviderForm = (props) => {
        const p = props.provider
        const c = props.calls
        const d = c.data
        const [draft, setDraft] = React.useState({})
        const [test, setTest] = React.useState(null) // null | { busy } | { ok, ... }
        const [avatars, setAvatars] = React.useState(null)
        const [pickV, setPickV] = React.useState('')
        const [listening, setListening] = React.useState(false)
        const keys = d.keys
        const used = usedProvider(d, p.slot) === p.id
        const engine = (c.voices !== null && Array.isArray(c.voices.engines) && p.engine) ? c.voices.engines.find((e) => e.id === p.engine) : null
        const engineVoices = engine && Array.isArray(engine.voices) ? engine.voices : []
        const dv = d.settings.defaultVoice
        const chosen = pickV !== '' ? pickV : ((dv !== null && dv.engine === p.engine) ? dv.voice : ((engineVoices.find((v) => v.lang === kt('fr', 'en')) || engineVoices[0] || {}).id || ''))
        const voiceOf = (id) => engineVoices.find((v) => v.id === id) || null
        const runTest = async () => {
          setTest({ busy: true })
          const r = await post('/test', { service: p.test })
          setTest(r === null ? { ok: false, error: kt('l’hôte ne répond pas', 'the host does not answer') } : r)
        }
        const useIt = () => {
          if (p.slot === 'listen') return c.save({ use: { listen: p.id } })
          if (p.slot === 'face') return c.save({ use: { face: p.id } })
          if (p.id === 'app') return c.save({ defaultVoice: null })
          const v = voiceOf(chosen)
          return c.save({ defaultVoice: { engine: p.engine, voice: chosen, lang: v && v.lang ? v.lang : '' } })
        }
        const listen = async () => {
          const v = voiceOf(chosen)
          const wanted = v && v.lang ? String(v.lang) : kt('fr', 'en')
          const lang = SAMPLES[wanted] !== undefined ? wanted : 'en'
          const body = Object.assign({ text: SAMPLES[lang], lang: lang }, p.engine ? { engine: p.engine, voice: chosen } : {})
          setListening(true)
          try {
            const r = await fetch('/kybernos/tts/speak', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
            const out = await r.json()
            if (out !== null && out.ok === true && typeof out.audio === 'string') {
              const audio = new Audio(out.audio)
              await new Promise((resolve) => { audio.onended = resolve; audio.onerror = resolve; audio.play().catch(resolve) })
              if (p.engine && out.engine !== p.engine) c.say(true, kt('Cette voix n’a pas pu parler : ', 'That voice could not speak: ') + (out.attempts && out.attempts[0] && out.attempts[0].error ? out.attempts[0].error : kt('l’app a utilisé un autre moteur', 'the app used another engine')))
              else c.setNotice(null)
            } else c.say(true, kt('Écoute impossible — ', 'Could not play — ') + ((out && out.error) || kt('le moteur de voix ne répond pas', 'the voice engine does not answer')))
          } catch (e) { c.say(true, kt('Écoute impossible — le moteur de voix ne répond pas', 'Could not play — the voice engine does not answer')) }
          setListening(false)
        }
        const field = (f) => {
          const label = h('label', { key: 'l', className: 'kbcl-lab', htmlFor: 'kbcl-f-' + f.name }, tx(f.label))
          if (f.kind === 'setting') {
            const cur = (p.config || {})[f.name]
            return h('div', { key: f.name, className: 'kbcl-f' }, [label, h('select', { key: 's', id: 'kbcl-f-' + f.name, 'data-field': f.name, className: 'kbcl-in', value: cur, disabled: c.busy, onChange: (e) => c.save({ providers: { [p.id]: { [f.name]: e.target.value } } }) }, f.options.map((o) => h('option', { key: o.value, value: o.value }, tx(o.label))))])
          }
          if (f.kind === 'switch') {
            const on = keys[f.name] && keys[f.name].set && keys[f.name].value === '1'
            return h('label', { key: f.name, className: 'kbcl-check' }, [h('input', { key: 'i', type: 'checkbox', 'data-field': f.name, checked: on === true, disabled: c.busy, onChange: (e) => c.saveKeys({ [f.name]: e.target.checked ? '1' : '0' }) }), h('span', { key: 't' }, tx(f.label))])
          }
          const isSecret = f.kind === 'secret'
          const st = keys[f.name] || {}
          const typed = typeof draft[f.name] === 'string' ? draft[f.name] : ''
          return h('div', { key: f.name, className: 'kbcl-f' }, [label, h('div', { key: 'r', className: 'kbcl-row', style: { flexWrap: 'nowrap' } }, [
            h('input', { key: 'i', id: 'kbcl-f-' + f.name, 'data-field': f.name, className: 'kbcl-in kbcl-grow', type: isSecret ? 'password' : 'text', autoComplete: 'off', spellCheck: false, placeholder: st.set ? (isSecret ? kt('Défini : saisissez pour remplacer', 'Set: type to replace') : String(st.value || '')) : (isSecret ? kt('Collez la clé ici', 'Paste the key here') : ''), value: typed, onChange: (e) => setDraft((old) => Object.assign({}, old, { [f.name]: e.target.value })) }),
            h('button', { key: 's', type: 'button', className: 'kbcl-btn', 'data-act': 'save-' + f.name, disabled: c.busy || typed.trim() === '', onClick: async () => { if (await c.saveKeys({ [f.name]: typed })) setDraft((old) => Object.assign({}, old, { [f.name]: '' })) } }, kt('Enregistrer', 'Save')),
            isSecret && st.set ? h('button', { key: 'x', type: 'button', className: 'kbcl-btn', 'data-act': 'remove-' + f.name, disabled: c.busy, onClick: () => { if (window.confirm(kt('Retirer cette clé ?', 'Remove this key?'))) c.saveKeys({ [f.name]: '' }) } }, kt('Retirer', 'Remove')) : null
          ]),
          f.avatars && keys.LIVEAVATAR_API_KEY && keys.LIVEAVATAR_API_KEY.set ? h('div', { key: 'av', className: 'kbcl-row' }, [
            h('button', { key: 'b', type: 'button', className: 'kbcl-btn', 'data-act': 'list-avatars', disabled: c.busy, onClick: async () => { const r = await post('/avatars', {}); if (r !== null && r.ok === true) setAvatars(r.avatars); else c.say(true, (r && r.error) || kt('liste indisponible', 'list unavailable')) } }, kt('Choisir un visage', 'Choose a face')),
            avatars !== null ? h('select', { key: 's', className: 'kbcl-in kbcl-grow', 'data-field': 'avatar-pick', value: st.value || '', onChange: (e) => { if (e.target.value !== '') c.saveKeys({ LIVEAVATAR_AVATAR_ID: e.target.value }) } }, [h('option', { key: '', value: '' }, kt('Choisir…', 'Choose…'))].concat(avatars.map((a) => h('option', { key: a.id, value: a.id }, a.name + (a.source === 'yours' ? kt(' · à vous', ' · yours') : '') + (a.type === 'IMAGE' ? kt(' · photo', ' · photo') : ''))))) : null
          ]) : null])
        }
        const clones = Array.isArray(d.clones) ? d.clones : []
        return h('section', { className: 'kbcl-prov', 'data-kb': 'kybernos-call-provider', 'data-provider': p.id }, [
          h('div', { key: 'hd', className: 'kbcl-row' }, [h('div', { key: 'n', style: { fontSize: '17px', fontWeight: 700 } }, tx(p.name)), Chip('', tx(d.slots.find((s) => s.id === p.slot).name)), p.source === 'models' ? (inModels(c, p) !== null ? Chip('ok', kt('Dans vos Modèles', 'In your Models') + ' · ' + inModels(c, p)) : Chip('warn', kt('Pas trouvé dans vos Modèles', 'Not found in your Models'))) : null, stateChip(p), used && props.compact !== true ? Chip('ok', kt('Utilisé pour les appels', 'Used for calls')) : null]),
          h('div', { key: 'nt', className: 'kbcl-sub' }, tx(p.note)),
          h('div', { key: 'pr', className: 'kbcl-row kbcl-sub' }, [h('span', { key: 'p' }, tx(p.price)), p.url ? h('a', { key: 'u', href: p.url, target: '_blank', rel: 'noreferrer noopener' }, kt('Obtenir une clé ↗', 'Get a key ↗')) : null]),
          p.available !== true ? h('div', { key: 'soon', className: 'kbcl-notice' }, kt('Ce fournisseur est listé pour montrer ce qui est prévu. Il ne peut pas encore être utilisé.', 'This provider is listed to show what is planned. It cannot be used yet.')) : [
            p.fields.map(field),
            typeof p.engine === 'string' ? h('div', { key: 'eng', className: 'kbcl-f' }, [
              h('label', { key: 'l', className: 'kbcl-lab', htmlFor: 'kbcl-voice' }, kt('Voix', 'Voice')),
              engine && engine.ready === true ? h('div', { key: 'r', className: 'kbcl-row', style: { flexWrap: 'nowrap' } }, [
                h('select', { key: 's', id: 'kbcl-voice', 'data-field': 'voice', className: 'kbcl-in kbcl-grow', value: chosen, disabled: c.busy, onChange: (e) => setPickV(e.target.value) }, engineVoices.map((v) => h('option', { key: v.id, value: v.id }, (v.label || v.id) + (v.lang ? ' (' + v.lang + ')' : '')))),
                h('button', { key: 'l', type: 'button', className: 'kbcl-btn', 'data-act': 'listen-voice', disabled: c.busy || listening, onClick: listen }, listening ? kt('Lecture…', 'Playing…') : kt('Écouter', 'Listen'))
              ]) : h('div', { key: 'nr', className: 'kbcl-notice' }, kt('Ce moteur n’est pas prêt sur cet ordinateur', 'This engine is not ready on this computer') + (engine && engine.reason ? ' — ' + engine.reason : ''))
            ]) : null,
            p.id === 'app' ? h('div', { key: 'appv', className: 'kbcl-row' }, [h('button', { key: 'l', type: 'button', className: 'kbcl-btn', 'data-act': 'listen-voice', disabled: c.busy || listening, onClick: listen }, listening ? kt('Lecture…', 'Playing…') : kt('Écouter', 'Listen'))]) : null,
            p.clone ? h('label', { key: 'cl', className: 'kbcl-check' }, [h('input', { key: 'i', type: 'checkbox', 'data-field': 'cloneUpload', checked: d.settings.cloneUpload === true, disabled: c.busy, onChange: (e) => c.save({ cloneUpload: e.target.checked }) }), h('span', { key: 't' }, kt('Autoriser l’envoi de mes enregistrements pour cloner une voix', 'Allow sending my recordings to clone a voice'))]) : null,
            p.clone && clones.length > 0 ? h('div', { key: 'cls', className: 'kbcl-f' }, [h('div', { key: 'h', className: 'kbcl-lab' }, kt('Voix clonées', 'Cloned voices'))].concat(clones.map((cl) => h('div', { key: cl.id, className: 'kbcl-row', 'data-clone': cl.id }, [
              h('span', { key: 'n', className: 'kbcl-grow' }, (cl.name || cl.id) + (cl.createdAt ? ' · ' + String(cl.createdAt).slice(0, 10) : '')),
              h('button', { key: 'x', type: 'button', className: 'kbcl-btn kbcl-red', 'data-act': 'delete-clone', disabled: c.busy, onClick: async () => { if (window.confirm(kt('Supprimer cette voix chez ElevenLabs ?', 'Delete this voice at ElevenLabs?'))) { const r = await post('/clone', { action: 'delete', voiceId: cl.id }); if (r !== null && r.ok === true) c.load(); else c.say(true, (r && r.error) || kt('Suppression impossible', 'Could not delete')) } } }, kt('Supprimer', 'Delete'))
            ])))) : null,
            h('div', { key: 'ft', className: 'kbcl-row kbcl-foot' }, [
              p.test ? h('button', { key: 't', type: 'button', className: 'kbcl-btn', 'data-act': 'test-' + p.test, disabled: test !== null && test.busy === true, onClick: runTest }, kt('Tester', 'Test')) : null,
              test !== null && test.busy === true ? h('span', { key: 'w', className: 'kbcl-sub' }, kt('Test en cours…', 'Testing…')) : null,
              test !== null && test.busy !== true ? h('span', { key: 'r', 'data-test-result': p.test }, test.ok === true ? Chip('ok', kt('connexion réussie', 'connection works') + (test.detail ? ' · ' + test.detail : '')) : Chip('err', test.error || kt('échec', 'failed'))) : null,
              (p.slot === 'listen' || p.slot === 'face' || p.slot === 'speak') && !p.clone && props.compact !== true ? h('button', { key: 'u', type: 'button', className: 'kbcl-btn kbcl-pri', style: { marginLeft: 'auto' }, 'data-act': 'use-' + p.id, disabled: c.busy || (used && typeof p.engine !== 'string'), onClick: useIt }, used ? (typeof p.engine === 'string' ? kt('Utiliser cette voix', 'Use this voice') : kt('Utilisé', 'In use')) : kt('Utiliser pour les appels', 'Use for calls')) : null
            ]),
            p.slot === 'speak' && !p.clone && props.compact !== true ? h('div', { key: 'fb', className: 'kbcl-sub' }, kt('Si ce fournisseur échoue, la voix du Mac prend le relais : l’appel n’est jamais muet.', 'If this provider fails, the Mac voice takes over: a call is never silent.')) : null,
            p.clone ? h('div', { key: 'cn', className: 'kbcl-sub' }, kt('Sert quand la voix d’un Kyber est un enregistrement. Créez la voix depuis la carte du Kyber.', 'Used when a Kyber’s voice is a recording. Create the voice from the Kyber’s card.')) : null
          ]
        ])
      }

      // Overview: the five slots, the presets, and the few options that are not a provider.
      const Overview = (props) => {
        const c = props.calls
        const d = c.data
        const s = d.settings
        const [openSlot, setOpenSlot] = React.useState({})
        const [sound, setSound] = React.useState(soundsOn())
        const used = {}
        let cents = 0
        for (const sl of d.slots) { const p = providerOf(d, usedProvider(d, sl.id)); used[sl.id] = p; if (p) cents += p.cost || 0 }
        const audio = (c.models || []).filter((g) => g.models.length > 0)
        const kinds = (g) => ['listen', 'speak', 'realtime'].filter((k) => g.models.some((m) => m.kind === k)).map((k) => (k === 'listen' ? kt('écoute', 'speech-to-text') : k === 'speak' ? kt('voix', 'text-to-speech') : kt('conversation en temps réel', 'realtime conversation')))
        return [
          audio.length > 0 ? h('div', { key: 'found', className: 'kbcl-found', 'data-kb': 'kybernos-call-found-models' }, [
            h('div', { key: 't', style: { fontWeight: 600 } }, kt('Trouvé dans vos Modèles : ', 'Found in your Models: ') + audio.map((g) => g.provider).join(', ')),
            h('div', { key: 'd', className: 'kbcl-sub' }, audio.map((g) => g.provider + ' — ' + kinds(g).join(', ')).join(' · ') + '. ' + kt('Déjà payé par votre offre, sans nouvelle clé. Leur usage dans les appels est la prochaine étape.', 'Already paid by your plan, no new key. Using them in calls is the next step.'))
          ]) : null,
          h('div', { key: 'pre', className: 'kbcl-row', 'data-kb': 'kybernos-call-presets' }, d.presets.map((pr) => h('button', { key: pr.id, type: 'button', className: 'kbcl-preset', 'data-act': 'preset-' + pr.id, 'aria-pressed': pr.active === true ? 'true' : 'false', disabled: c.busy || pr.available !== true, onClick: () => c.preset(pr.id) }, [
            h('div', { key: 'n', style: { fontWeight: 600 } }, tx(pr.name) + (pr.available !== true ? ' · ' + kt('bientôt', 'soon') : '')), h('div', { key: 'd', className: 'kbcl-sub' }, tx(pr.desc))]))),
          h('div', { key: 'slots', className: 'kbcl-slots' }, d.slots.map((sl) => {
            const p = used[sl.id]
            const off = false
            return h('div', { key: sl.id, className: 'kbcl-slot', 'data-call-slot': sl.id }, [
              h('div', { key: 'r', className: 'kbcl-row', style: { flexWrap: 'nowrap' } }, [
                Ico(sl.icon, 22),
                h('div', { key: 't', style: { width: '170px', flex: 'none' } }, [h('div', { key: 'a', style: { fontWeight: 600 } }, tx(sl.name)), h('div', { key: 'b', className: 'kbcl-sub' }, tx(sl.sub))]),
                h('div', { key: 'p', className: 'kbcl-row kbcl-grow', style: { opacity: off ? 0.5 : 1 } }, p ? [h('span', { key: 'n', style: { fontWeight: 600 } }, tx(p.name)), stateChip(p), h('span', { key: 'pr', className: 'kbcl-sub' }, tx(p.price))] : null),
                h('button', { key: 'q', type: 'button', className: 'kbcl-q', 'data-act': 'help-slot-' + sl.id, 'aria-expanded': openSlot[sl.id] ? 'true' : 'false', 'aria-label': kt('Aide : ', 'Help: ') + tx(sl.name), onClick: () => setOpenSlot((o) => Object.assign({}, o, { [sl.id]: !o[sl.id] })) }, openSlot[sl.id] ? '×' : '?'),
                sl.locked ? null : h('button', { key: 'c', type: 'button', className: 'kbcl-btn', 'data-act': 'change-' + sl.id, onClick: () => props.onChange(sl.id, usedProvider(d, sl.id)) }, kt('Changer', 'Change'))
              ]),
              openSlot[sl.id] ? h('div', { key: 'h', className: 'kbcl-helpbox', 'data-help': 'slot-' + sl.id }, tx(sl.help)) : null
            ])
          })),
          h('div', { key: 'cost', className: 'kbcl-row kbcl-cost' }, [
            h('div', { key: 'v' }, [h('div', { key: 'l', className: 'kbcl-sub' }, kt('Estimation par minute d’appel', 'Estimated cost per call minute')), h('div', { key: 'n', style: { fontSize: '22px', fontWeight: 700 }, 'data-kb': 'kybernos-call-cost' }, (cents < 1 ? cents.toFixed(2) : cents.toFixed(1)) + ' ¢')]),
            h('div', { key: 'n', className: 'kbcl-sub kbcl-grow' }, kt('L’assistant parle la moitié du temps. Hors offres gratuites. Prix relevés sur les sites des fournisseurs en octobre 2026 : à confirmer avant de payer.', 'The assistant speaks half the time. Free tiers not deducted. Prices read on the providers’ own sites in October 2026: confirm before paying.'))
          ]),
          h('section', { key: 'opt', className: 'kbcl-block' }, [
            h('h3', { key: 'h' }, kt('Options', 'Options')),
            h('div', { key: 'lang', className: 'kbcl-row' }, [
              h('label', { key: 'l', className: 'kbcl-lab', htmlFor: 'kbcl-lang' }, kt('Langue de l’appel', 'Call language')),
              h('select', { key: 's', id: 'kbcl-lang', 'data-field': 'language', className: 'kbcl-in', value: s.language, disabled: c.busy, onChange: (e) => c.save({ language: e.target.value }) }, [h('option', { key: 'auto', value: 'auto' }, kt('Automatique : suit ce que vous dites', 'Automatic: follows what you say'))].concat(LANGUAGES.map((l) => h('option', { key: l[0], value: l[0] }, l[1]))))
            ]),
            h('label', { key: 'snd', className: 'kbcl-check' }, [h('input', { key: 'i', type: 'checkbox', 'data-field': 'sounds', checked: sound, onChange: (e) => { try { window.localStorage.setItem(SOUND_KEY, e.target.checked ? '1' : '0') } catch (x) { /* storage blocked */ } setSound(e.target.checked) } }), h('span', { key: 't' }, kt('Petits sons pendant l’appel (sur ce navigateur)', 'Small sounds during a call (on this browser)'))]),
            h('div', { key: 'lim', className: 'kbcl-row' }, [
              h('span', { key: 'a', className: 'kbcl-lab' }, kt('Raccrocher tout seul après', 'Hang up by itself after')),
              h('input', { key: 'n1', type: 'number', min: 1, max: 60, 'data-field': 'silenceMinutes', className: 'kbcl-in kbcl-num', defaultValue: s.silenceMinutes, disabled: c.busy, onBlur: (e) => { const v = Number.parseInt(e.target.value, 10); if (Number.isInteger(v) && v !== s.silenceMinutes) c.save({ silenceMinutes: v }) } }),
              h('span', { key: 'b', className: 'kbcl-sub' }, kt('min sans parole, ou', 'min of silence, or')),
              h('input', { key: 'n2', type: 'number', min: 5, max: 240, 'data-field': 'maxMinutes', className: 'kbcl-in kbcl-num', defaultValue: s.maxMinutes, disabled: c.busy, onBlur: (e) => { const v = Number.parseInt(e.target.value, 10); if (Number.isInteger(v) && v !== s.maxMinutes) c.save({ maxMinutes: v }) } }),
              h('span', { key: 'c', className: 'kbcl-sub' }, kt('min au maximum', 'min at the most'))
            ])
          ])
        ]
      }

      // Providers: the list by slot on the left, one provider's page on the right.
      const Providers = (props) => {
        const c = props.calls
        const d = c.data
        const slot = props.slot
        const list = d.providers.filter((p) => p.slot === slot)
        const sel = list.find((p) => p.id === props.prov) || list.find((p) => p.id === usedProvider(d, slot)) || list[0]
        return [
          h('div', { key: 'sl', className: 'kbcl-row', role: 'group', 'aria-label': kt('Maillon', 'Slot') }, d.slots.filter((s) => !s.locked).map((s) => h('button', { key: s.id, type: 'button', className: 'kbcl-btn', 'data-act': 'slot-' + s.id, 'aria-pressed': s.id === slot ? 'true' : 'false', onClick: () => props.onSlot(s.id) }, tx(s.name)))),
          h('div', { key: 'grid', className: 'kbcl-grid' }, [
            h('nav', { key: 'nav', className: 'kbcl-provnav', 'aria-label': kt('Fournisseurs', 'Providers') }, list.map((p) => {
              const isUsed = usedProvider(d, slot) === p.id
              return h('button', { key: p.id, type: 'button', className: 'kbcl-provbtn', 'data-act': 'prov-' + p.id, 'aria-current': sel && sel.id === p.id ? 'true' : 'false', onClick: () => props.onProv(p.id) }, [
                h('i', { key: 'd', className: 'kbcl-dotmark' + (isUsed ? ' kbcl-on' : p.ready ? ' kbcl-rdy' : ''), 'aria-hidden': 'true' }), h('span', { key: 'n', className: 'kbcl-grow' }, tx(p.name)), p.available !== true ? h('span', { key: 's', className: 'kbcl-sub' }, kt('bientôt', 'soon')) : null])
            })),
            sel ? h(ProviderForm, { key: sel.id, provider: sel, calls: c }) : null
          ])
        ]
      }

      // Health: one button, every slot. The microphone is the browser's to check; the rest is the host's.
      const micCheck = async () => {
        try {
          const md = navigator.mediaDevices
          if (!md || typeof md.getUserMedia !== 'function') return { id: 'mic', status: 'bad', code: 'no-api' }
          const stream = await md.getUserMedia({ audio: true })
          const AC = window.AudioContext || window.webkitAudioContext
          let peak = 0
          if (typeof AC === 'function') {
            const ac = new AC()
            const an = ac.createAnalyser()
            an.fftSize = 512
            ac.createMediaStreamSource(stream).connect(an)
            const buf = new Uint8Array(an.fftSize)
            const until = Date.now() + 1500
            while (Date.now() < until) { an.getByteTimeDomainData(buf); for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128)); await new Promise((r) => setTimeout(r, 60)) }
            try { ac.close() } catch (e) { /* closed */ }
          }
          stream.getTracks().forEach((t) => t.stop())
          return { id: 'mic', status: peak > 6 ? 'ok' : 'warn', code: peak > 6 ? 'ok' : 'quiet' }
        } catch (e) { return { id: 'mic', status: 'bad', code: 'blocked', detail: String(e && e.name ? e.name : e) } }
      }
      const HEALTH_ORDER = ['mic', 'listen', 'speak', 'face', 'line', 'engine']
      const healthName = (id) => ({ mic: kt('Microphone', 'Microphone'), listen: kt('Écoute', 'Listen'), speak: kt('Voix', 'Speak'), face: kt('Visage', 'Face'), line: kt('Ligne', 'Line'), engine: kt('Moteur d’appel', 'Call engine') })[id]
      const healthText = (r) => {
        const k = r.id + ':' + r.code
        const detail = r.detail ? ' ' + String(r.detail) : ''
        const T = {
          'mic:ok': kt('Il vous entend.', 'It hears you.'), 'mic:quiet': kt('Aucun son détecté. Parlez, ou choisissez un autre micro.', 'No sound detected. Speak, or pick another microphone.'),
          'mic:no-answer': kt('Pas de réponse du navigateur : autorisez le micro.', 'No answer from the browser: allow the microphone.'), 'mic:blocked': kt('Le navigateur bloque le micro.', 'The browser blocks the microphone.') + detail, 'mic:no-api': kt('Ce navigateur n’a pas accès au micro.', 'This browser has no microphone access.'),
          'listen:ok': kt('La clé fonctionne.', 'The key works.'), 'listen:no-key': kt('Aucune clé enregistrée.', 'No key saved.'), 'listen:refused': kt('La clé est refusée : collez-la de nouveau.', 'The key is refused: paste it again.'), 'listen:failed': detail, 'listen:not-wired': kt('Ce fournisseur n’est pas encore branché.', 'This provider is not wired yet.'),
          'speak:ok': kt('La voix répond en ', 'The voice answers in ') + (r.ms / 1000).toFixed(1) + ' s.', 'speak:fell-back': kt('Cette voix n’a pas pu parler, une autre a pris le relais.', 'That voice could not speak, another took over.') + detail, 'speak:failed': detail,
          'face:ok': kt('Le compte répond', 'The account answers') + (r.detail ? ' · ' + r.detail + kt(' crédits', ' credits') : '') + '.', 'face:voice-only': kt('Pas de visage choisi : appels à la voix seule.', 'No face chosen: calls are voice only.'), 'face:no-key': kt('Pas de clé : l’appel se fera à la voix seule.', 'No key: the call will be voice only.'), 'face:refused': kt('La clé est refusée : collez-la de nouveau.', 'The key is refused: paste it again.'), 'face:failed': detail,
          'line:ok': kt('La connexion est bonne.', 'The connection is good.'), 'line:no-key': kt('Adresse, clé ou secret manquants.', 'Address, key or secret missing.'), 'line:refused': kt('La clé ou le secret sont refusés.', 'The key or the secret is refused.'), 'line:failed': detail,
          'engine:installed': kt('Installé sur cet ordinateur.', 'Installed on this computer.'), 'engine:running': kt('Installé et démarré.', 'Installed and running.'), 'engine:not-installed': kt('Le moteur d’appel n’est pas installé sur cet ordinateur.', 'The call engine is not installed on this computer.'), 'engine:broken': kt('Le moteur d’appel est abîmé.', 'The call engine is damaged.') + detail
        }
        return T[k] !== undefined ? T[k] : (r.code === 'timeout' ? kt('Pas de réponse à temps.', 'No answer in time.') : (r.code === 'failed' ? (r.detail ? String(r.detail) : kt('Échec.', 'Failed.')) : String(r.code)))
      }
      const Health = (props) => {
        const [rows, setRows] = React.useState({})
        const [running, setRunning] = React.useState(false)
        const [inst, setInst] = React.useState(null) // the call engine's install: null | { state, step, last, code, error }
        const mounted = React.useRef(true)
        React.useEffect(() => () => { mounted.current = false }, [])
        const merge = (more) => setRows((old) => Object.assign({}, old, more))
        const run = async () => {
          setRunning(true)
          setRows({ mic: { status: 'run' }, listen: { status: 'run' }, speak: { status: 'run' }, face: { status: 'run' }, line: { status: 'run' }, engine: { status: 'run' } })
          // The two answers are shown as they come: a browser that waits for the user to allow the microphone must not hold back the rest.
          const hostDone = post('/health', {}).then((host) => {
            const next = {}
            if (host !== null && host.ok === true) for (const ck of host.checks) next[ck.id] = ck
            else for (const id of HEALTH_ORDER) if (id !== 'mic') next[id] = { id: id, status: 'bad', code: 'failed', detail: (host && host.error) || kt('l’hôte ne répond pas (relancez DSH une fois)', 'the host does not answer (relaunch DSH once)') }
            merge(next)
          })
          const micDone = Promise.race([micCheck(), new Promise((resolve) => setTimeout(() => resolve({ id: 'mic', status: 'warn', code: 'no-answer' }), 12000))]).then((m) => merge({ mic: m }))
          await Promise.all([hostDone, micDone])
          setRunning(false)
        }
        // The engine is installed by the host in the background (minutes): follow it, then check again.
        const follow = async () => {
          const r = await post('/engine', { action: 'status' })
          if (!mounted.current) return
          setInst(r)
          if (r !== null && r.state === 'running') setTimeout(follow, 2500)
          else if (r !== null && r.state === 'done') run()
        }
        const install = async () => {
          const r = await post('/engine', { action: 'install' })
          if (!mounted.current) return
          if (r === null || r.ok === false) { setInst({ state: 'failed', code: (r && r.code) || 'failed', error: (r && r.error) || kt('l’hôte ne répond pas', 'the host does not answer') }); return }
          setInst(r)
          setTimeout(follow, 1500)
        }
        React.useEffect(() => { if (props.autorun === true) run() }, [])
        return [
          h('div', { key: 'top', className: 'kbcl-row' }, [h('button', { key: 'b', type: 'button', className: 'kbcl-btn kbcl-pri', 'data-act': 'run-health', disabled: running, onClick: run }, running ? kt('Vérification…', 'Checking…') : kt('Tout vérifier', 'Check everything'))]),
          h('div', { key: 'rows', className: 'kbcl-slots', 'data-kb': 'kybernos-call-health' }, HEALTH_ORDER.map((id) => {
            const r = rows[id]
            const st = r === undefined ? 'idle' : r.status
            const icon = st === 'ok' || st === 'warn' || st === 'bad' || st === 'run' ? st : 'idle'
            return h('div', { key: id, className: 'kbcl-slot kbcl-hrow', 'data-check': id, 'data-status': st }, h('div', { className: 'kbcl-row', style: { flexWrap: 'nowrap' } }, [
              Ico(icon, 22, 'kbcl-hic-' + st),
              h('span', { key: 'n', style: { fontWeight: 600, minWidth: '120px' } }, healthName(id)),
              h('span', { key: 'm', className: 'kbcl-sub kbcl-grow', 'data-kb': id === 'engine' ? 'kybernos-call-engine-state' : undefined }, id === 'engine' && inst !== null && inst.state === 'running' ? kt('Installation en cours (', 'Installing (') + (inst.step === 'packages' ? kt('paquets', 'packages') : kt('environnement', 'environment')) + ')… ' + (inst.last || '') : id === 'engine' && inst !== null && inst.state === 'failed' ? kt('L’installation a échoué : ', 'The install failed: ') + (inst.error || inst.last || inst.code) : st === 'idle' ? kt('Pas encore vérifié', 'Not checked yet') : st === 'run' ? kt('Vérification…', 'Checking…') : healthText(r)),
              id === 'engine' && (st === 'bad') && r && (r.code === 'not-installed' || r.code === 'broken') && !(inst !== null && inst.state === 'running') ? h('button', { key: 'ins', type: 'button', className: 'kbcl-btn kbcl-pri', 'data-act': 'install-engine', onClick: install }, inst !== null && inst.state === 'failed' ? kt('Réessayer', 'Try again') : (r.code === 'broken' ? kt('Réparer', 'Repair') : kt('Installer en un clic', 'Install in one click'))) : null,
              (st === 'bad' || st === 'warn') && ['listen', 'face', 'line'].indexOf(id) >= 0 ? h('button', { key: 'f', type: 'button', className: 'kbcl-btn', 'data-act': 'fix-' + id, onClick: () => props.onFix(id) }, kt('Ouvrir le fournisseur', 'Open the provider')) : null
            ]))
          }))
        ]
      }

      const SettingsPage = () => {
        const c = useCalls()
        const [tab, setTab] = React.useState('overview')
        const [slot, setSlot] = React.useState('speak')
        const [prov, setProv] = React.useState(null)
        const [open, setOpen] = React.useState({})
        if (c.data === null) return h('div', { className: 'kbcl-page', 'data-kb': 'kybernos-call-settings' }, h('div', { className: 'kbcl-sub' }, kt('Lecture des réglages…', 'Reading the settings…')))
        if (c.data.ok !== true) return h('div', { className: 'kbcl-page', 'data-kb': 'kybernos-call-settings' }, h('div', { className: 'kbcl-notice kbcl-bad' }, kt('Les routes d’appel ne sont pas chargées — relancez DSH une fois.', 'The call routes are not loaded — relaunch DSH once.')))
        const helps = HELP()
        const tabs = [['overview', kt('Vue d’ensemble', 'Overview')], ['providers', kt('Fournisseurs', 'Providers')], ['health', kt('Bilan de santé', 'Health')]]
        const toggle = (id) => () => setOpen((o) => Object.assign({}, o, { [id]: !o[id] }))
        const goProvider = (s, p) => { setSlot(s); setProv(p || null); setTab('providers') }
        const body = tab === 'overview' ? h(Overview, { calls: c, onChange: goProvider })
          : tab === 'providers' ? h(Providers, { calls: c, slot: slot, prov: prov, onSlot: (s) => { setSlot(s); setProv(null) }, onProv: setProv })
            : h(Health, { onFix: (id) => goProvider(id === 'line' ? 'line' : id, null) })
        return h('div', { className: 'kbcl-page', 'data-kb': 'kybernos-call-settings' }, [
          h('div', { key: 'top' }, [h('h2', { key: 'h' }, kt('Appels', 'Calls')), h('div', { key: 's', className: 'kbcl-sub' }, kt('Parler à votre assistant ou à un membre de votre équipe, à voix haute, depuis n’importe quelle session.', 'Talk to your assistant, or to a team member, out loud, from any session.'))]),
          h('div', { key: 'again', className: 'kbcl-row' }, [h('button', { key: 'b', type: 'button', className: 'kbcl-btn', 'data-act': 'run-assistant', onClick: () => setAssist({ step: 1, pending: null }) }, kt('Lancer l’assistant de configuration', 'Run the setup assistant'))]),
          h('div', { key: 'tabs', className: 'kbcl-tabs', role: 'tablist' }, tabs.map((t) => h('button', { key: t[0], type: 'button', role: 'tab', className: 'kbcl-tab', 'data-act': 'tab-' + t[0], 'aria-selected': tab === t[0] ? 'true' : 'false', onClick: () => setTab(t[0]) }, t[1]))),
          h('div', { key: 'help' }, h(Help, { id: tab, title: tabs.find((t) => t[0] === tab)[1], lines: helps[tab], open: open[tab] === true, onToggle: toggle(tab) })),
          c.notice !== null ? h('div', { key: 'n', className: 'kbcl-notice' + (c.notice.bad ? ' kbcl-bad' : ''), role: 'status', 'data-kb': 'kybernos-call-notice' }, c.notice.text) : null,
          body
        ])
      }

      // ── The setup assistant: a first call on a machine with nothing set up. Four screens, once; Settings › Calls has all of it afterwards. ──
      const AssistantBody = (props) => {
        const cur = props.cur
        const c = useCalls()
        const step = cur.step
        const go = (n) => setAssist(Object.assign({}, assist, { step: n }))
        const [heard, setHeard] = React.useState(false)
        const [micErr, setMicErr] = React.useState('')
        const [devices, setDevices] = React.useState([])
        const [deviceId, setDeviceId] = React.useState('')
        const bar = React.useRef(null)
        // Step 1: the microphone, live. The bar must move when the user speaks: that is the whole step.
        React.useEffect(() => {
          if (step !== 1) return undefined
          let stopped = false
          let stream = null
          let ac = null
          let timer = null
          ;(async () => {
            try {
              stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId === '' ? true : { deviceId: { exact: deviceId } } })
              if (stopped) { stream.getTracks().forEach((t) => t.stop()); return }
              setMicErr('')
              const list = await navigator.mediaDevices.enumerateDevices()
              setDevices(list.filter((d) => d.kind === 'audioinput' && d.deviceId !== ''))
              const AC = window.AudioContext || window.webkitAudioContext
              ac = new AC()
              const an = ac.createAnalyser()
              an.fftSize = 512
              ac.createMediaStreamSource(stream).connect(an)
              const buf = new Uint8Array(an.fftSize)
              timer = setInterval(() => {
                an.getByteTimeDomainData(buf)
                let peak = 0
                for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128))
                const v = peak / 128
                if (bar.current) bar.current.style.transform = 'scaleX(' + Math.min(1, Math.max(0.02, v * 2.5)).toFixed(3) + ')'
                if (v > 0.1) setHeard(true)
              }, 90)
            } catch (e) { setMicErr(String(e && e.name ? e.name : e)) }
          })()
          return () => { stopped = true; if (timer !== null) clearInterval(timer); if (stream !== null) stream.getTracks().forEach((t) => t.stop()); try { if (ac !== null) ac.close() } catch (e) { /* closed */ } }
        }, [step, deviceId])
        React.useEffect(() => {
          const onKey = (e) => { if (e.key === 'Escape') setAssist(null) }
          document.addEventListener('keydown', onKey)
          return () => document.removeEventListener('keydown', onKey)
        }, [])
        const d = c.data
        const titles = [kt('Vérifiez votre micro', 'Check your microphone'), kt('Comment voulez-vous appeler ?', 'How do you want to call?'), kt('Connectez les services', 'Connect the services'), kt('Dernière vérification', 'Final check')]
        const finish = async () => {
          if (await c.save({ setupDone: true })) {
            const p = cur.pending
            setAssist(null)
            if (p !== null && p !== undefined) open(p)
          }
        }
        let body = null
        if (d === null) body = h('div', { className: 'kbcl-sub' }, kt('Lecture des réglages…', 'Reading the settings…'))
        else if (d.ok !== true) body = h('div', { className: 'kbcl-notice kbcl-bad' }, kt('Les routes d’appel ne sont pas chargées — relancez DSH une fois.', 'The call routes are not loaded — relaunch DSH once.'))
        else if (step === 1) {
          body = [
            h('div', { key: 'd', className: 'kbcl-sub' }, kt('Dites quelques mots : la barre doit bouger. Un casque ou des écouteurs sont conseillés, sinon l’assistant entend sa propre voix et se coupe la parole.', 'Say a few words: the bar should move. Headphones are recommended, or the assistant hears its own voice and cuts itself off.')),
            devices.length > 1 ? h('select', { key: 's', className: 'kbcl-in', 'data-field': 'assist-mic', 'aria-label': kt('Micro', 'Microphone'), value: deviceId, onChange: (e) => setDeviceId(e.target.value) }, devices.map((x) => h('option', { key: x.deviceId, value: x.deviceId }, x.label || x.deviceId))) : null,
            h('div', { key: 'm', className: 'kbcl-activity' }, [h('span', { key: 'w', className: 'kbcl-who' }, kt('Vous', 'You')), h('span', { key: 'b', className: 'kbcl-meter', 'aria-hidden': 'true' }, h('span', { className: 'kbcl-meter-fill', ref: bar }))]),
            micErr !== '' ? h('div', { key: 'e', className: 'kbcl-notice kbcl-bad', 'data-kb': 'kybernos-call-mic-error' }, kt('Le navigateur ne donne pas accès au micro (', 'The browser does not give access to the microphone (') + micErr + kt('). Autorisez-le pour ce site, puis revenez ici.', '). Allow it for this site, then come back.')) : h('div', { key: 'h', className: 'kbcl-sub', 'data-kb': 'kybernos-call-mic-state' }, heard ? kt('Je vous entends bien.', 'I hear you well.') : kt('J’écoute…', 'Listening…'))
          ]
        } else if (step === 2) {
          body = [
            h('div', { key: 'd', className: 'kbcl-sub' }, kt('Un préréglage remplit les cinq maillons d’un coup. Vous pourrez changer chacun dans Réglages › Appels.', 'A preset fills the five slots at once. You can change each one in Settings › Calls.')),
            h('div', { key: 'p', className: 'kbcl-slots' }, d.presets.map((pr) => h('button', { key: pr.id, type: 'button', className: 'kbcl-preset', 'data-act': 'assist-preset-' + pr.id, 'aria-pressed': pr.active === true ? 'true' : 'false', disabled: c.busy || pr.available !== true, onClick: () => c.preset(pr.id) }, [
              h('div', { key: 'n', style: { fontWeight: 600 } }, tx(pr.name) + (pr.available !== true ? ' · ' + kt('bientôt', 'soon') : '')), h('div', { key: 'd', className: 'kbcl-sub' }, tx(pr.desc))])))
          ]
        } else if (step === 3) {
          const need = [providerOf(d, d.settings.use.listen), providerOf(d, 'livekit')].concat(d.settings.use.face === 'liveavatar' ? [providerOf(d, 'liveavatar')] : []).filter((x) => x !== null)
          body = [h('div', { key: 'd', className: 'kbcl-sub' }, kt('Ces services ont besoin d’une clé. Chacun a un lien pour l’obtenir, et un bouton Tester.', 'These services need a key. Each has a link to get one, and a Test button.'))].concat(need.map((p) => h(ProviderForm, { key: p.id, provider: p, calls: c, compact: true })))
        } else {
          body = [h('div', { key: 'd', className: 'kbcl-sub' }, kt('Le même bilan existe dans Réglages › Appels › Bilan de santé.', 'The same check lives in Settings › Calls › Health.')), h(Health, { key: 'h', autorun: true, onFix: () => go(3) })]
        }
        return [
          h('div', { key: 'hd', className: 'kbcl-row' }, [Chip('ok', kt('Assistant · étape ', 'Setup assistant · step ') + step + kt(' sur 4', ' of 4')), h('span', { key: 'once', className: 'kbcl-sub' }, kt('une seule fois', 'runs once'))]),
          h('h2', { key: 't', style: { margin: 0, fontSize: '18px' } }, titles[step - 1]),
          c.notice !== null ? h('div', { key: 'n', className: 'kbcl-notice' + (c.notice.bad ? ' kbcl-bad' : ''), role: 'status' }, c.notice.text) : null,
          h('div', { key: 'b', className: 'kbcl-f' }, body),
          h('div', { key: 'ft', className: 'kbcl-row', style: { justifyContent: 'space-between' } }, [
            h('button', { key: 'bk', type: 'button', className: 'kbcl-btn', 'data-act': 'assist-back', onClick: () => (step === 1 ? setAssist(null) : go(step - 1)) }, step === 1 ? kt('Annuler', 'Cancel') : kt('Retour', 'Back')),
            h('button', { key: 'nx', type: 'button', className: 'kbcl-btn kbcl-pri', 'data-act': 'assist-next', disabled: c.busy, onClick: () => (step === 4 ? finish() : go(step + 1)) }, step === 4 ? (cur.pending ? kt('Terminer et appeler', 'Finish and call') : kt('Terminer', 'Finish')) : kt('Continuer', 'Continue'))
          ])
        ]
      }
      const Assistant = () => {
        const cur = useAssistState()
        if (cur === null) return null
        const node = h('div', { className: 'kbcl-veil', role: 'presentation' }, h('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': kt('Assistant de configuration des appels', 'Call setup assistant'), className: 'kbcl-modal', 'data-kb': 'kybernos-call-assistant', 'data-step': String(cur.step) }, h(AssistantBody, { cur: cur })))
        const canPortal = ReactDOM !== null && ReactDOM !== undefined && typeof ReactDOM.createPortal === 'function' && typeof document !== 'undefined' && document.body
        return canPortal ? ReactDOM.createPortal(node, document.body) : node
      }

      // ── the seam ──
      const seam = { version: 1, open: open, hangUp: hangUp, isOpen: () => state !== null }

      return {
        name: 'kybernos-call',
        inject: ['slots'],
        __test: { getAssist: () => assist, closeAssist: () => setAssist(null), open: open, hangUp: hangUp, toggleMute: toggleMute, toggleSounds: toggleSounds, getState: () => state, setAudioHost: (el) => { audioHost = el }, switchMic: switchMic, CallHeader: CallHeader, SettingsPage: SettingsPage, CSS: CSS, cloneNote: cloneNote },
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
            ctx.effect(() => slots.inject('shell.overlay', () => slots.register(
              { name: 'shell.overlay', id: 'kybernos-call-assistant', order: 31 }, Assistant)), 'kybernos-call: setup assistant')
            // Voice and video buttons at the top right of the chat of every session: the call belongs to the session, not to a team.
            ctx.effect(() => slots.inject('conversation.session.header.actions', () => slots.register(
              { name: 'conversation.session.header.actions', id: 'kybernos-call-header', order: 50 },
              (props) => { try { return h(CallHeader, { sessionId: props !== null && props !== undefined ? props.sessionId : undefined }) } catch (e) { return null } })), 'kybernos-call: call buttons in the chat header')
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
