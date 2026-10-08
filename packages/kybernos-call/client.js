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
@media (prefers-reduced-motion:reduce){.kbcl-hbtn{transition:none}.kbcl-status .kbcl-dot,.kbcl-bars i{animation:none!important}}
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

      const SettingsPage = () => {
        const [data, setData] = React.useState(null)
        const [voices, setVoices] = React.useState(null)
        const [tab, setTab] = React.useState('essential')
        const [notice, setNotice] = React.useState(null) // { bad, text }
        const [tests, setTests] = React.useState({})
        const [draft, setDraft] = React.useState({})
        const [busy, setBusy] = React.useState(false)
        const [listening, setListening] = React.useState(false)
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
        // Hears the chosen voice (the app's engine renders a sentence of its language): the way to compare voices without a call.
        const SAMPLES = { fr: 'Bonjour, je suis votre assistant. Comment puis-je vous aider ?', en: 'Hello, I am your assistant. How can I help you?', es: 'Hola, soy tu asistente. ¿En qué puedo ayudarte?', de: 'Hallo, ich bin dein Assistent. Wie kann ich dir helfen?', it: 'Ciao, sono il tuo assistente. Come posso aiutarti?', pt: 'Olá, sou o seu assistente. Como posso ajudar?' }
        const listen = async () => {
          const picked = set.defaultVoice
          const wanted = (picked !== null && picked.lang) ? String(picked.lang) : kt('fr', 'en')
          const lang = SAMPLES[wanted] !== undefined ? wanted : 'en'
          const body = Object.assign({ text: SAMPLES[lang], lang: lang }, picked !== null ? { engine: picked.engine, voice: picked.voice } : {})
          setListening(true)
          try {
            const r = await fetch('/kybernos/tts/speak', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
            const d = await r.json()
            if (d !== null && d.ok === true && typeof d.audio === 'string') {
              const audio = new Audio(d.audio)
              await new Promise((resolve) => { audio.onended = resolve; audio.onerror = resolve; audio.play().catch(resolve) })
              if (picked !== null && d.engine !== picked.engine) say(true, kt('Cette voix n’a pas pu parler : ', 'That voice could not speak: ') + (d.attempts && d.attempts[0] && d.attempts[0].error ? d.attempts[0].error : kt('l’app a utilisé un autre moteur', 'the app used another engine')))
              else setNotice(null)
            } else say(true, kt('Écoute impossible — ', 'Could not play — ') + ((d && d.error) || kt('le moteur de voix ne répond pas', 'the voice engine does not answer')))
          } catch (e) { say(true, kt('Écoute impossible — le moteur de voix ne répond pas', 'Could not play — the voice engine does not answer')) }
          setListening(false)
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
                [h('option', { key: '', value: '' }, kt('Voix par défaut de l’app (Réglages › Voix)', 'The app’s default voice (Settings › Voice)'))].concat(engines.map((e) => h('optgroup', { key: e.id, label: (e.name || e.id) + (e.kind === 'cloud' ? kt(' · en ligne', ' · online') : '') }, e.voices.map((v) => h('option', { key: e.id + '::' + v.id, value: e.id + '::' + v.id }, (v.label || v.id) + (v.lang ? ' (' + v.lang + ')' : ''))))))),
              h('button', { key: 'listen', type: 'button', className: 'kbcl-btn', 'data-act': 'listen-voice', disabled: busy || listening, onClick: listen }, listening ? kt('Lecture…', 'Playing…') : kt('Écouter', 'Listen'))
            ]),
            h('div', { key: 'tip', className: 'kbcl-sub' }, kt('Pour une voix plus naturelle : Piper (sur ce Mac) ou Edge (en ligne : le texte est envoyé à Microsoft). Écouter permet de comparer sans appeler.', 'For a more natural voice: Piper (on this Mac) or Edge (online: the text is sent to Microsoft). Listen lets you compare without a call.'))
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
        __test: { open: open, hangUp: hangUp, toggleMute: toggleMute, toggleSounds: toggleSounds, getState: () => state, setAudioHost: (el) => { audioHost = el }, switchMic: switchMic, CallHeader: CallHeader, SettingsPage: SettingsPage, CSS: CSS, cloneNote: cloneNote },
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
