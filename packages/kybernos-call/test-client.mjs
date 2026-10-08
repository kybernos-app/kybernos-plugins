// kybernos-call: the browser half (client.js), run in a fake browser. No DSH, no network.
//
// The factory is evaluated with a fake window / document / React; a fake LiveKit SDK and a fake
// fetch stand in for the room and the host. What is checked is the state of the call through its
// whole life, the seam other surfaces use, and what the panel draws.
//
//   node packages/kybernos-call/test-client.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))
// values created inside the vm context have another Array/Object realm: compare them as plain JSON
const plain = (x) => JSON.parse(JSON.stringify(x))
const source = readFileSync(join(here, 'client.js'), 'utf8')

console.log('kybernos-call: client contract')
assert.ok(source.includes("id: '@local/kybernos-call'"))
assert.ok(source.includes("shell.overlay"))
assert.equal(/unpkg|jsdelivr|https?:\/\//.test(source), false)
ok('it loads under its own id, uses the overlay slot, and never fetches a script from a third party')
assert.equal(/h\('nav'/.test(source), false)
ok('no nav element: DSH sets the width of every nav inside its settings dialog (it pushed the provider list over the provider page)')
assert.ok(source.includes("data-kb': 'kybernos-call-panel'") && source.includes("'data-act': 'hangup'") && source.includes("'data-act': 'mute'"))
ok('the panel and its two actions carry stable data-kb / data-act hooks')
const withoutTokens = source.replace(/var\([^)]*\)/g, '')
const fixedColours = [...new Set(withoutTokens.match(/#[0-9A-Fa-f]{6}\b/g) ?? [])].sort()
assert.deepEqual(fixedColours, ['#16161A', '#DC2626', '#FFFFFF'])
ok('colours come from DSH tokens (with a fallback); only the hang-up red, its white text and the video backdrop are fixed')

// ── a fake browser ──
const makeEnv = ({ lang = 'en' } = {}) => {
  const requests = []
  const responses = []
  const loaded = []
  const rooms = []
  const styles = []
  const win = {
    __KB_LANG_RESOLVE__: () => lang,
    __ModuleLoader__: { load: (def) => { loaded.push(def) } },
    LivekitClient: null
  }
  const doc = {
    documentElement: { lang },
    body: {},
    head: { appendChild: (el) => { if (el.tag === 'script') setImmediate(() => { win.LivekitClient = fakeSdk(rooms); el.onload() }); else styles.push(el) } },
    createElement: (tag) => ({ tag, attrs: {}, setAttribute (k, v) { this.attrs[k] = v }, remove () { const i = styles.indexOf(this); if (i >= 0) styles.splice(i, 1) } })
  }
  const fetchFake = async (url, init) => {
    requests.push({ url, init })
    const next = responses.shift()
    if (next instanceof Error) throw next
    return { json: async () => next }
  }
  const React = {
    createElement: (type, props, children) => ({ type, props: props || {}, children }),
    useReducer: () => [0, () => {}],
    useEffect: () => {}
  }
  const ctx = vm.createContext({ window: win, document: doc, fetch: fetchFake, console, setInterval, clearInterval, setImmediate, Date, Promise, String, Number, Math, JSON, Object, Array, Set, Error, undefined })
  const run = () => {
    vm.runInContext(source, ctx)
    const plugin = loaded[0].factory((name) => { if (name === 'react') return React; throw new Error('no ' + name) })
    return plugin
  }
  return { win, doc, requests, responses, rooms, styles, run, React }
}
const fakeSdk = (rooms) => {
  class Room {
    static async getLocalDevices (kind) { return Room.devices === undefined ? [] : Room.devices.filter((d) => d.kind === kind) }
    async switchActiveDevice (kind, id) { if (this.failSwitch) throw new Error('device busy'); this.switched = [kind, id] }
    constructor (opts) { this.opts = opts; this.handlers = {}; this.connected = null; this.micCalls = []; this.disconnected = false; rooms.push(this)
      this.localParticipant = { setMicrophoneEnabled: async (on) => { this.micCalls.push(on); return { stop: async () => { this.micStopped = true } } } } }
    on (event, fn) { this.handlers[event] = fn }
    async connect (url, token) { if (this.failConnect) throw new Error('boom'); this.connected = { url, token }; this.remoteParticipants = new Map(rooms.present === true ? [['agent', {}]] : []) }
    async disconnect () { this.disconnected = true }
  }
  return { Room, RoomEvent: { TrackSubscribed: 'trackSubscribed', TranscriptionReceived: 'transcriptionReceived', ParticipantDisconnected: 'participantDisconnected', ParticipantConnected: 'participantConnected', ParticipantAttributesChanged: 'participantAttributesChanged', Disconnected: 'disconnected' } }
}

console.log('kybernos-call: the plugin object and the seam')
{
  const e = makeEnv()
  const plugin = e.run()
  assert.equal(plugin.name, 'kybernos-call')
  assert.deepEqual(plain(plugin.inject), ['slots'])
  assert.equal(typeof plugin.apply, 'function')
  ok('the factory returns a plugin object that asks for the slots service')

  const registered = []
  const cleanups = []
  const slots = { inject: (name, fn) => { const r = fn(); registered.push({ name, r }); return () => {} }, register: (meta, comp) => ({ meta, comp }) }
  plugin.apply({ slots, effect: (fn) => { const c = fn(); cleanups.push(c) } })
  assert.deepEqual(registered.map((r) => [r.name, r.r.meta.id]), [
    ['shell.overlay', 'kybernos-call-overlay'],
    ['shell.overlay', 'kybernos-call-assistant'],
    ['conversation.session.header.actions', 'kybernos-call-header'],
    ['settings.section', 'kybernos-call']
  ])
  assert.equal(registered[2].r.meta.order, 50)
  assert.equal(registered[3].r.meta.label, 'Calls')
  assert.equal(typeof e.win.__KB_CALL__.open, 'function')
  assert.equal(e.win.__KB_CALL__.version, 1)
  assert.equal(e.styles.length, 1)
  assert.equal(e.styles[0].attrs['data-plugin'], '@local/kybernos-call')
  assert.match(e.styles[0].textContent, /\.kbcl-hbtn\{/)
  ok('apply registers the panel and the setup assistant (overlay), the voice and video buttons in the header of every chat, and the Calls settings page; it publishes window.__KB_CALL__.open and one stylesheet')
  cleanups.forEach((c) => { if (typeof c === 'function') c() })
  assert.equal(e.win.__KB_CALL__, undefined)
  assert.equal(e.styles.length, 0)
  ok('stopping the plugin removes the seam (the Call buttons of other surfaces hide again) and its stylesheet')

  const broken = makeEnv()
  const p2 = broken.run()
  const warn = console.warn
  console.warn = () => {}
  try { assert.doesNotThrow(() => p2.apply({ slots: null, effect: () => { throw new Error('x') } })) } finally { console.warn = warn }
  ok('apply never throws, even with a broken context')
}

console.log('kybernos-call: a call, from the first click to hang-up')
{
  const e = makeEnv()
  const plugin = e.run()
  const t = plugin.__test
  e.responses.push({ ok: true, secrets: 'posee', avatar: 'wayne' })
  e.responses.push({ ok: true, url: 'wss://lk.example.test', token: 'JWT', room: 'room-1', agent: { running: true, dispatched: true } })
  const states = []
  const opening = t.open({ sessionId: 'session-aaaaaaaa', kyberId: 'team-1', roleId: 'm1', name: 'Alice', mode: 'voice' })
  assert.equal(t.getState().phase, 'preparing')
  await opening
  assert.equal(e.requests[0].url, '/kybernos-call/status')
  assert.equal(e.requests[1].url, '/kybernos-call/token')
  assert.deepEqual(JSON.parse(e.requests[1].init.body), { sessionId: 'session-aaaaaaaa', kyberId: 'team-1', roleId: 'm1', name: 'Alice', mode: 'voice', voice: null, identity: 'moi' })
  assert.equal(e.requests[1].init.method, 'POST')
  ok('it asks the host for the status, then for a token carrying the session, the team, the member, the mode and the voice (no language: the host fills it from the settings)')

  const room = e.rooms[0]
  assert.deepEqual(room.connected, { url: 'wss://lk.example.test', token: 'JWT' })
  assert.deepEqual(room.micCalls, [true])
  const s = t.getState()
  assert.equal(s.phase, 'live')
  assert.equal(s.name, 'Alice')
  assert.equal(typeof s.startedAt, 'number')
  assert.match(s.note, /waiting for the assistant/)
  assert.equal(s.joined, false)
  ok('it joins the room with that token, publishes the microphone, and goes live')

  room.handlers.transcriptionReceived([{ text: 'bonjour' }, { text: 'tout le monde' }], { identity: 'moi' })
  assert.deepEqual(plain(t.getState().lines), ['Me: bonjour tout le monde'])
  for (let i = 0; i < 8; i++) room.handlers.transcriptionReceived([{ text: 'l' + i }], { identity: 'agent' })
  assert.equal(t.getState().lines.length, 6)
  assert.equal(plain(t.getState().lines)[5], 'Alice: l7')
  room.handlers.transcriptionReceived([{ text: '   ' }], { identity: 'agent' })
  assert.equal(t.getState().lines.length, 6)
  ok('what is transcribed is shown (the last 6 lines), blanks are ignored')

  // The same sentence arrives in growing pieces under one segment id (seen on the real call): one line, rewritten.
  for (const piece of ['Oui, je t’entends', 'Oui, je t’entends bien !', 'Oui, je t’entends bien ! — le canal est bon.']) room.handlers.transcriptionReceived([{ id: 'SG_1', text: piece }], { identity: 'agent-AJ_x' })
  const growing = plain(t.getState().lines).filter((l) => l.includes('t’entends'))
  assert.deepEqual(growing, ['Alice: Oui, je t’entends bien ! — le canal est bon.'])
  room.handlers.transcriptionReceived([{ id: 'SG_2', text: 'Autre phrase.' }], { identity: 'agent-AJ_x' })
  assert.equal(plain(t.getState().lines).filter((l) => l.includes('t’entends')).length, 1)
  assert.equal(plain(t.getState().lines).slice(-1)[0], 'Alice: Autre phrase.')
  ok('a transcript that grows under one segment id is one line, rewritten; the other side is named after who is called, not after a worker id')

  t.toggleMute()
  assert.equal(t.getState().muted, true)
  assert.deepEqual(room.micCalls, [true, false])
  t.toggleMute()
  assert.equal(t.getState().muted, false)
  assert.deepEqual(room.micCalls, [true, false, true])
  ok('"Mute me" now toggles: the microphone is switched off and back on')

  room.handlers.participantDisconnected()
  assert.match(t.getState().note, /the agent left the room/)
  ok('when the agent leaves the room the panel says so, and stays up')

  await t.hangUp()
  assert.equal(room.disconnected, true)
  assert.equal(room.micStopped, true)
  assert.equal(t.getState(), null)
  ok('hanging up stops the microphone, leaves the room, and closes the panel')
}

console.log('kybernos-call: the member\'s voice')
{
  const e = makeEnv()
  const t = e.run().__test
  e.responses.push({ ok: true, secrets: 'posee' }, { ok: true, url: 'wss://x', token: 'T', room: 'r', agent: { dispatched: true } })
  const voice = { engine: 'edge', voice: 'fr-FR-DeniseNeural', lang: 'fr' }
  await t.open({ sessionId: 'session-aaaaaaaa', name: 'Alice', voice: voice })
  assert.deepEqual(JSON.parse(e.requests[1].init.body).voice, voice)
  assert.doesNotMatch(t.getState().note, /recorded voice|voix enregistrée/)
  ok('the voice picked on the member\'s card goes with the token request')

  // a recording: the host is asked to give it a clone first, then the call goes on with the clone's id
  const f = makeEnv()
  const ft = f.run().__test
  f.responses.push({ ok: true, secrets: 'posee' }, { ok: true, remote: { provider: 'elevenlabs', id: 'Remote12345' } }, { ok: true, url: 'wss://x', token: 'T', room: 'r', agent: { dispatched: true }, meta: { mode: 'voice' } })
  await ft.open({ sessionId: 'session-aaaaaaaa', name: 'Alice', voice: { custom: true, id: 'v-1abc', name: 'Claire', rootId: 'root-1' } })
  assert.equal(f.requests[1].url, '/kybernos-call/clone')
  assert.deepEqual(JSON.parse(f.requests[1].init.body), { rootId: 'root-1', voiceId: 'v-1abc', name: 'Claire' })
  assert.equal(f.requests[2].url, '/kybernos-call/token')
  assert.deepEqual(JSON.parse(f.requests[2].init.body).voice, { custom: true, id: 'v-1abc' })
  assert.doesNotMatch(ft.getState().note, /not used|non utilisée/)
  ok('a recording given to the member is cloned (once, by the host) before the call, and the call asks for it by its id: no audio goes through the page')

  for (const [code, words] of [['upload-off', /sending recordings is off \(Settings › Calls\)/], ['no-key', /no ElevenLabs key/], ['no-sample', /not on this machine/], ['provider', /ElevenLabs answered HTTP 422/]]) {
    const g = makeEnv()
    const gt = g.run().__test
    g.responses.push({ ok: true, secrets: 'posee' }, { ok: false, code: code, error: 'ElevenLabs answered HTTP 422' }, { ok: true, url: 'wss://x', token: 'T', room: 'r', agent: { dispatched: true }, meta: { mode: 'voice' } })
    await gt.open({ sessionId: 'session-aaaaaaaa', name: 'Alice', voice: { custom: true, id: 'v-1abc', name: 'Claire', rootId: 'root-1' } })
    assert.deepEqual(JSON.parse(g.requests[2].init.body).voice, { custom: true })
    assert.equal(gt.getState().phase, 'live')
    assert.match(gt.getState().note, /recorded voice not used: /)
    assert.match(gt.getState().note, words)
    assert.match(gt.getState().note, /default voice/)
  }
  ok('when the recording cannot be cloned (switch off, no key, no recording, the provider refuses) the call still goes on with the default voice, and the panel says which reason')

  const h = makeEnv()
  const ht = h.run().__test
  h.responses.push({ ok: true, secrets: 'posee' }, null, { ok: true, url: 'wss://x', token: 'T', room: 'r', agent: { dispatched: true }, meta: { mode: 'voice' } })
  await ht.open({ sessionId: 'session-aaaaaaaa', name: 'Alice', voice: { custom: true, id: 'v-1abc', rootId: 'root-1' } })
  assert.match(ht.getState().note, /the clone service did not answer/)
  const i = makeEnv()
  const it = i.run().__test
  i.responses.push({ ok: true, secrets: 'posee' }, { ok: true, url: 'wss://x', token: 'T', room: 'r', agent: { dispatched: true }, meta: { mode: 'voice' } })
  await it.open({ sessionId: 'session-aaaaaaaa', name: 'Alice', voice: { custom: true } })
  assert.equal(i.requests.length, 2)
  assert.match(it.getState().note, /not on this machine/)
  ok('a host that does not answer, or a recording without an id, never blocks the call')

  const j = makeEnv()
  const jt = j.run().__test
  j.responses.push({ ok: true, secrets: 'posee' }, { ok: true, url: 'wss://x', token: 'T', room: 'r', agent: { dispatched: true }, meta: { mode: 'video' } })
  await jt.open({ sessionId: 'session-aaaaaaaa', name: 'Assistant' })
  assert.deepEqual(JSON.parse(j.requests[1].init.body), { sessionId: 'session-aaaaaaaa', kyberId: null, roleId: null, name: 'Assistant', voice: null, identity: 'moi' })
  assert.equal(jt.getState().mode, 'video')
  ok('a call opened with nothing but a session (the composer button) asks for no mode and no language, and shows the mode the host picked from the settings')
}

console.log('kybernos-call: what goes wrong is said, never invented over')
{
  const cases = [
    { name: 'host routes not loaded', responses: [new Error('network')], expect: /call routes are not loaded/ },
    { name: 'status not ok', responses: [{ ok: false }], expect: /call routes are not loaded/ },
    { name: 'token refused', responses: [{ ok: true, secrets: 'posee' }, { ok: false, error: 'LiveKit secrets missing' }], expect: /LiveKit secrets missing/ },
    { name: 'token without an error text', responses: [{ ok: true, secrets: 'posee' }, new Error('network')], expect: /no call token/ }
  ]
  for (const c of cases) {
    const e = makeEnv()
    const t = e.run().__test
    e.responses.push(...c.responses)
    await t.open({ sessionId: 'session-aaaaaaaa', name: 'A' })
    assert.equal(t.getState().phase, 'error', c.name)
    assert.match(t.getState().note, c.expect, c.name)
    assert.equal(e.rooms.length, 0, c.name + ': no room is created')
  }
  ok('routes not loaded, no secrets, a refused token, an unreachable host: an error with a reason, and no room is created')

  const e = makeEnv()
  const t = e.run().__test
  e.responses.push({ ok: true, secrets: 'posee' }, { ok: true, url: 'wss://x', token: 'T', room: 'r', agent: { dispatched: false, dispatchError: 'unauthenticated' } })
  const origCreate = e.doc.head.appendChild
  e.doc.head.appendChild = (el) => { setImmediate(() => { e.win.LivekitClient = fakeSdk(e.rooms); e.win.LivekitClient.Room = class extends e.win.LivekitClient.Room { constructor (o) { super(o); this.failConnect = true } }; el.onload() }) }
  await t.open({ sessionId: 'session-aaaaaaaa', name: 'A' })
  assert.equal(t.getState().phase, 'error')
  assert.match(t.getState().note, /could not join the room — boom/)
  ok('a room that cannot be joined is reported with the SDK\'s message')
  void origCreate

  const f = makeEnv()
  const ft = f.run().__test
  f.responses.push({ ok: true, secrets: 'posee' }, { ok: true, url: 'wss://x', token: 'T', room: 'r', agent: { running: true, dispatched: false, dispatchError: 'unauthenticated' } })
  await ft.open({ sessionId: 'session-aaaaaaaa', name: 'A' })
  assert.equal(ft.getState().phase, 'live')
  assert.match(ft.getState().note, /nobody is listening on the other side yet/)
  ok('an agent that was not woken does not refuse the call: it goes live and says nobody is listening')

  const g = makeEnv()
  const gt = g.run().__test
  g.responses.push({ ok: true, secrets: 'posee' }, { ok: true, url: 'wss://x', token: 'T', room: 'r', agent: { dispatched: true } })
  await gt.open({ sessionId: 'session-aaaaaaaa', name: 'A' })
  g.responses.push({ ok: true, secrets: 'posee' }, { ok: true, url: 'wss://x', token: 'T2', room: 'r2', agent: { dispatched: true } })
  await gt.open({ sessionId: 'session-bbbbbbbb', name: 'B' })
  assert.equal(g.rooms[0].disconnected, true)
  assert.equal(g.rooms[1].connected.token, 'T2')
  assert.equal(gt.getState().name, 'B')
  ok('a second call hangs up the first one: one call at a time')
}

console.log('kybernos-call: microphones and why nobody answers')
{
  const e = makeEnv()
  const t = e.run().__test
  e.win.LivekitClient = fakeSdk(e.rooms)
  e.win.LivekitClient.Room.devices = [{ kind: 'audioinput', deviceId: 'built-in', label: 'MacBook Microphone' }, { kind: 'audioinput', deviceId: 'airpods', label: 'AirPods' }, { kind: 'videoinput', deviceId: 'cam', label: 'Camera' }]
  e.responses.push({ ok: true, secrets: 'posee' }, { ok: true, url: 'wss://x', token: 'T', room: 'r', agent: { running: true, dispatched: true }, meta: { mode: 'voice' } })
  await t.open({ sessionId: 'session-aaaaaaaa', name: 'Alice' })
  assert.deepEqual(plain(t.getState().mics), [{ id: 'built-in', label: 'MacBook Microphone' }, { id: 'airpods', label: 'AirPods' }])
  ok('once the call is live the panel knows the microphones (inputs only, with their names)')
  await t.switchMic('airpods')
  assert.deepEqual(e.rooms[0].switched, ['audioinput', 'airpods'])
  assert.equal(t.getState().micId, 'airpods')
  e.rooms[0].failSwitch = true
  await t.switchMic('built-in')
  assert.match(t.getState().note, /could not switch microphone — device busy/)
  assert.equal(t.getState().micId, 'airpods')
  ok('choosing another microphone switches the live call to it; a device that cannot be used is reported and the call stays on the old one')
}
{
  const e = makeEnv()
  const plugin = e.run()
  let Panel = null
  plugin.apply({ slots: { inject: (n, fn) => { fn(); return () => {} }, register: (m, c) => { if (m.id === 'kybernos-call-overlay') Panel = c; return {} } }, effect: (fn) => fn() })
  e.win.LivekitClient = fakeSdk(e.rooms)
  e.win.LivekitClient.Room.devices = [{ kind: 'audioinput', deviceId: 'a', label: 'One' }, { kind: 'audioinput', deviceId: 'b', label: 'Two' }]
  e.responses.push({ ok: true, secrets: 'posee' }, { ok: true, url: 'wss://x', token: 'T', room: 'r', agent: { running: true, dispatched: true }, meta: { mode: 'voice' } })
  await plugin.__test.open({ sessionId: 'session-aaaaaaaa', name: 'Alice' })
  const withMics = JSON.stringify(Panel())
  assert.ok(withMics.includes('"data-act":"mic"') && withMics.includes('One') && withMics.includes('Two'))
  ok('with several microphones the panel offers a choice')
  const one = makeEnv()
  const p1 = one.run()
  let Panel1 = null
  p1.apply({ slots: { inject: (n, fn) => { fn(); return () => {} }, register: (m, c) => { if (m.id === 'kybernos-call-overlay') Panel1 = c; return {} } }, effect: (fn) => fn() })
  one.win.LivekitClient = fakeSdk(one.rooms)
  one.win.LivekitClient.Room.devices = [{ kind: 'audioinput', deviceId: 'a', label: 'One' }]
  one.responses.push({ ok: true, secrets: 'posee' }, { ok: true, url: 'wss://x', token: 'T', room: 'r', agent: { running: true, dispatched: true }, meta: { mode: 'voice' } })
  await p1.__test.open({ sessionId: 'session-aaaaaaaa', name: 'Alice' })
  assert.equal(JSON.stringify(Panel1()).includes('"data-act":"mic"'), false)
  ok('with only one it offers nothing')

  const bad = makeEnv()
  const pb = bad.run()
  let PanelB = null
  pb.apply({ slots: { inject: (n, fn) => { fn(); return () => {} }, register: (m, c) => { if (m.id === 'kybernos-call-overlay') PanelB = c; return {} } }, effect: (fn) => fn() })
  bad.responses.push({ ok: true, secrets: 'posee' }, { ok: true, url: 'wss://x', token: 'T', room: 'r', agent: { running: false, dispatched: false, error: 'call venv missing (<DSH_HOME>/kybernos/appel-venv)' }, meta: { mode: 'voice' } })
  await pb.__test.open({ sessionId: 'session-aaaaaaaa', name: 'Alice' })
  assert.ok(JSON.stringify(PanelB()).includes('worker not started: call venv missing'))
  ok('a worker that could not start is named in the panel, with the reason (not just "nobody is listening")')
}

console.log('kybernos-call: the call buttons at the top right of a chat')
{
  const e = makeEnv()
  const plugin = e.run()
  const t = plugin.__test
  const hooks = []
  e.React.useReducer = () => [0, () => {}]
  e.React.useEffect = (fn) => { hooks.push(fn) }
  const header = t.CallHeader({ sessionId: 'session-aaaaaaaa' })
  assert.equal(header.props['data-kb'], 'kybernos-call-header')
  const [voiceButton, videoButton] = header.children
  assert.equal(voiceButton.props['data-act'], 'call-voice')
  assert.equal(videoButton.props['data-act'], 'call-video')
  assert.equal(voiceButton.props['aria-label'], 'Voice call')
  assert.equal(videoButton.props['aria-label'], 'Video call')
  assert.equal(videoButton.props.disabled, false)
  ok('the chat header carries a voice button and a video button, each with a name for screen readers')

  e.responses.push({ ok: true, secrets: 'posee' }, { ok: true, url: 'wss://x', token: 'T', room: 'r', agent: { dispatched: true }, meta: { mode: 'voice' } })
  await voiceButton.props.onClick()
  assert.deepEqual(JSON.parse(e.requests[1].init.body), { sessionId: 'session-aaaaaaaa', kyberId: null, roleId: null, name: 'Assistant', mode: 'voice', voice: null, identity: 'moi' })
  assert.equal(t.getState().name, 'Assistant')
  assert.equal(t.getState().phase, 'live')
  ok('the voice button calls the session\'s assistant (no team, no member) as a voice call: the session is asked, the host picks voice and language from the settings')
  const active = t.CallHeader({ sessionId: 'session-aaaaaaaa' })
  assert.equal(active.children.props['data-act'], 'hangup-header')
  assert.ok(JSON.stringify(active.children.children).includes('Hang up'))
  await active.children.props.onClick()
  assert.equal(t.getState(), null)
  assert.equal(e.rooms[0].disconnected, true)
  ok('during a call the two buttons become one red "Hang up"')

  e.responses.push({ ok: true, secrets: 'posee' }, { ok: true, url: 'wss://x', token: 'T', room: 'r2', agent: { dispatched: true }, meta: { mode: 'video' } })
  await videoButton.props.onClick()
  assert.equal(JSON.parse(e.requests[e.requests.length - 1].init.body).mode, 'video')
  assert.equal(t.getState().mode, 'video')
  await t.hangUp()
  ok('the video button asks for a video call')

  const none = t.CallHeader({}).children[0]
  e.responses.push({ ok: true, secrets: 'absente' })
  await none.props.onClick()
  assert.equal(t.getState(), null)
  assert.equal(t.getAssist().step, 1)
  assert.equal(t.getAssist().pending.mode, 'voice')
  ok('with nothing set up, a click on the phone opens the setup assistant, remembering the call it was asked for (and no call state is left behind)')
  t.closeAssist()
  assert.equal(t.getAssist(), null)
  e.responses.push({ ok: true, secrets: 'absente' })
  await t.open({ sessionId: 'session-aaaaaaaa', name: 'Alice', mode: 'video' })
  assert.deepEqual(plain(t.getAssist().pending), { sessionId: 'session-aaaaaaaa', name: 'Alice', mode: 'video' })
  t.closeAssist()
  ok('the same from the seam (the Call and Video buttons of a team member); cancelling the assistant closes it')
  e.responses.push({ ok: true, secrets: 'absente', setupDone: true })
  await t.open({ sessionId: 'session-aaaaaaaa', name: 'Alice' })
  assert.equal(t.getAssist(), null)
  assert.equal(t.getState().phase, 'error')
  assert.match(t.getState().note, /Settings › Calls › Health/)
  ok('once the assistant has been through, a call with nothing set up says where to look instead of sending the user round it again')

  e.responses.push({ ok: true, secrets: 'posee', setupDone: false })
  await t.open({ sessionId: 'session-aaaaaaaa', name: 'Alice', mode: 'voice' })
  assert.equal(t.getState(), null)
  assert.equal(t.getAssist().step, 1)
  assert.equal(t.getAssist().ready, true)
  assert.equal(t.getAssist().pending.mode, 'voice')
  t.closeAssist()
  ok('keys already set but the assistant never run: the first call opens it (microphone and voice check, "Skip and call" goes on), remembering the call')
  e.responses.push({ ok: true, secrets: 'posee', setupDone: true }, { ok: true, url: 'wss://x', token: 'T', room: 'r3', agent: { dispatched: true } })
  await t.open({ sessionId: 'session-aaaaaaaa', name: 'Alice', mode: 'voice' })
  assert.equal(t.getAssist(), null)
  assert.equal(t.getState().phase === 'error', false)
  await t.hangUp()
  ok('once it has been through, the call goes straight on')
  const gear = t.CallHeader({}).children[2]
  assert.equal(gear.props['data-act'], 'call-setup')
  assert.match(gear.props.title, /Set up calls/)
  gear.props.onClick()
  assert.equal(t.getAssist().step, 1)
  assert.equal(t.getAssist().pending, null)
  assert.equal(t.getAssist().ready === true, false)
  t.closeAssist()
  ok('a gear at the top right of the chat opens the same assistant at any time (no call pending, so it can be cancelled)')

  // A face needs a provider: without one the video button is off and says why.
  const f = makeEnv()
  const ft2 = f.run().__test
  const fhooks = []
  f.React.useReducer = () => [0, () => {}]
  f.React.useEffect = (fn) => { fhooks.push(fn) }
  f.responses.push({ ok: true, provider: 'none' })
  ft2.CallHeader({ sessionId: 'session-aaaaaaaa' })
  fhooks.forEach((fn) => fn())
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  const noFace = ft2.CallHeader({ sessionId: 'session-aaaaaaaa' }).children
  assert.equal(noFace[1].props.disabled, true)
  assert.match(noFace[1].props.title, /LiveAvatar/)
  assert.equal(noFace[0].props.disabled === true, false)
  ok('with no face provider the video button is disabled and says to add a LiveAvatar key; the voice button stays')
}

console.log('kybernos-call: the indicators, and the sounds')
{
  const played = []
  class FakeAudio {
    constructor () { this.state = 'running'; this.currentTime = 0; this.destination = {} }
    createOscillator () { const o = { frequency: {}, connect () {}, start () { played.push(o.frequency.value) }, stop () {} }; return o }
    createGain () { return { gain: { setValueAtTime () {}, exponentialRampToValueAtTime () {} }, connect () {} } }
  }
  const start = async () => {
    const e = makeEnv()
    e.win.AudioContext = FakeAudio
    const plugin = e.run()
    let Panel = null
    plugin.apply({ slots: { inject: (n, fn) => { fn(); return () => {} }, register: (m, c) => { if (m.id === 'kybernos-call-overlay') Panel = c; return {} } }, effect: (fn) => fn() })
    e.responses.push({ ok: true, secrets: 'posee' }, { ok: true, url: 'wss://x', token: 'T', room: 'r', agent: { running: true, dispatched: true } })
    await plugin.__test.open({ sessionId: 'session-aaaaaaaa', name: 'Alice' })
    return { e, t: plugin.__test, Panel, room: e.rooms[0] }
  }
  const mood = (c) => JSON.parse(JSON.stringify(c.Panel())).props['data-state']
  played.length = 0
  const c = await start()
  assert.equal(mood(c), 'warn')
  assert.deepEqual(played, [])
  ok('connected to the room but not yet to the assistant: amber, and no sound yet')

  c.room.handlers.participantConnected()
  assert.equal(mood(c), 'ok')
  assert.deepEqual(played, [660, 880])
  c.room.handlers.participantConnected()
  assert.deepEqual(played, [660, 880])
  ok('when the assistant joins: green "listening" and a soft two-note chime, once')

  c.room.handlers.participantAttributesChanged({ 'kb.working': '1' })
  assert.equal(mood(c), 'work')
  assert.deepEqual(played.slice(2), [560])
  c.room.handlers.participantAttributesChanged({ 'kb.working': '1' })
  assert.deepEqual(played.slice(2), [560])
  ok('when the session starts working on what was said: "thinking" and one soft blip (a heard-you), not repeated')

  c.room.handlers.participantAttributesChanged({ 'kb.working': '0', 'lk.agent.state': 'speaking' })
  assert.equal(mood(c), 'speak')
  c.room.handlers.participantAttributesChanged({ 'lk.agent.state': 'listening' })
  assert.equal(mood(c), 'ok')
  ok('while the assistant speaks: "speaking"; afterwards back to "listening"')

  const flat = JSON.stringify(c.Panel())
  assert.ok(flat.includes('kbcl-meter-fill') && flat.includes('kbcl-bars') && flat.includes('"data-act":"sounds"'))
  ok('the panel shows the microphone level bar, the assistant activity and the sounds switch')

  const before = played.length
  await c.t.hangUp()
  assert.deepEqual(played.slice(before), [740, 520])
  ok('hanging up plays a two-note falling tone')

  const quiet = await start()
  quiet.room.handlers.participantConnected()
  quiet.t.toggleSounds()
  assert.equal(quiet.t.getState().sounds, false)
  const n = played.length
  quiet.room.handlers.participantAttributesChanged({ 'kb.working': '1' })
  await quiet.t.hangUp()
  assert.equal(played.length, n)
  ok('with the sounds switched off, nothing plays')
}
{
  // the microphone level: written straight to the bar, and stopped with the call
  const e = makeEnv()
  let cleaned = false
  const origCreate = e.doc.head.appendChild
  e.doc.head.appendChild = (el) => { if (el.tag !== 'script') { origCreate(el); return } setImmediate(() => { const sdk = fakeSdk(e.rooms); sdk.createAudioAnalyser = () => ({ calculateVolume: () => 0.25, cleanup () { cleaned = true } }); const R = sdk.Room; sdk.Room = class extends R { constructor (o) { super(o); this.localParticipant.setMicrophoneEnabled = async (on) => { this.micCalls.push(on); return { track: {}, stop: async () => {} } } } }; e.win.LivekitClient = sdk; el.onload() }) }
  const plugin = e.run()
  let Panel = null
  plugin.apply({ slots: { inject: (n, fn) => { fn(); return () => {} }, register: (m, c) => { if (m.id === 'kybernos-call-overlay') Panel = c; return {} } }, effect: (fn) => fn() })
  e.responses.push({ ok: true, secrets: 'posee' }, { ok: true, url: 'wss://x', token: 'T', room: 'r', agent: { running: true, dispatched: true } })
  await plugin.__test.open({ sessionId: 'session-aaaaaaaa', name: 'Alice' })
  const refOf = (node) => { if (node === null || typeof node !== 'object') return null; if (node.props && typeof node.props.ref === 'function') return node.props.ref; for (const k of (Array.isArray(node.children) ? node.children : [node.children])) { const r = refOf(k); if (r !== null) return r } return null }
  const bar = { style: {} }
  refOf(Panel())(bar)
  await new Promise((resolve) => setTimeout(resolve, 260))
  assert.match(bar.style.transform, /^scaleX\(0\.55/)
  ok('the microphone level bar follows the voice (written to the element, not through a render)')
  await plugin.__test.hangUp()
  assert.equal(cleaned, true)
  const stamp = bar.style.transform
  bar.style.transform = 'x'
  await new Promise((resolve) => setTimeout(resolve, 200))
  assert.equal(bar.style.transform, 'x', stamp)
  ok('hanging up stops the meter and releases the analyser')
  void origCreate
}

console.log('kybernos-call: nobody comes to the call')
{
  const start = async (present) => {
    const e = makeEnv()
    const plugin = e.run()
    let Panel = null
    plugin.apply({ slots: { inject: (n, fn) => { fn(); return () => {} }, register: (m, c) => { if (m.id === 'kybernos-call-overlay') Panel = c; return {} } }, effect: (fn) => fn() })
    e.rooms.present = present
    e.responses.push({ ok: true, secrets: 'posee' }, { ok: true, url: 'wss://x', token: 'T', room: 'r', agent: { running: true, dispatched: true } })
    await plugin.__test.open({ sessionId: 'session-aaaaaaaa', name: 'Alice' })
    return { e, t: plugin.__test, Panel }
  }
  const a = await start(false)
  assert.equal(a.t.getState().joined, false)
  assert.ok(JSON.stringify(a.Panel()).includes('waiting for the assistant'))
  assert.equal(JSON.stringify(a.Panel()).includes('nobody joined the call'), false)
  ok('right after the join the panel says it is waiting for the assistant, not that something is wrong')

  a.t.getState().startedAt -= 20000
  const late = JSON.stringify(a.Panel())
  assert.ok(late.includes('nobody joined the call') && late.includes('appel-agent.log'))
  ok('after 15 seconds with nobody in the room, the panel says so and where to look (a busy or stopped worker is otherwise silent)')

  a.e.rooms[0].handlers.participantConnected()
  assert.equal(a.t.getState().joined, true)
  assert.equal(JSON.stringify(a.Panel()).includes('nobody joined the call'), false)
  assert.equal(JSON.stringify(a.Panel()).includes('waiting for the assistant'), false)
  ok('when the assistant joins, the waiting and the warning are gone')

  const b = await start(false)
  b.e.rooms[0].handlers.participantAttributesChanged({ 'lk.agent.state': 'listening' })
  assert.equal(b.t.getState().joined, true)
  assert.equal(b.t.getState().agentState, 'listening')
  ok('the agent announcing its state counts as joined')

  const c = await start(true)
  assert.equal(c.t.getState().joined, true)
  assert.equal(JSON.stringify(c.Panel()).includes('waiting for the assistant'), false)
  ok('an assistant already in the room when we connect is not waited for')
}

console.log('kybernos-call: the panel and the language')
{
  const draw = (lang, mode) => {
    const e = makeEnv({ lang })
    const plugin = e.run()
    let Panel = null
    plugin.apply({ slots: { inject: (n, fn) => { fn(); return () => {} }, register: (m, c) => { if (m.id === 'kybernos-call-overlay') Panel = c; return {} } }, effect: (fn) => fn() })
    return { e, plugin, Panel }
  }
  const { e, plugin, Panel } = draw('fr')
  assert.equal(Panel(), null)
  ok('with no call, the panel draws nothing')
  e.responses.push({ ok: true, secrets: 'posee' }, { ok: true, url: 'wss://x', token: 'T', room: 'r', agent: { dispatched: true } })
  await plugin.__test.open({ sessionId: 'session-aaaaaaaa', name: 'Alice', mode: 'video' })
  const tree = Panel()
  assert.equal(tree.props['data-kb'], 'kybernos-call-panel')
  assert.equal(tree.props.role, 'dialog')
  const flat = JSON.stringify(tree)
  assert.ok(flat.includes('Raccrocher'))
  assert.ok(flat.includes('Couper le micro'))
  assert.ok(flat.includes('"aspectRatio":"16 / 9"') && flat.includes('"width":"560px"') && flat.includes('"height":"180px"') === false)
  ok('live, in French: the panel is a dialog with "Raccrocher" and "Couper le micro"; a video call opens 560 px wide with a 16:9 picture area')

  const find = (node, act) => {
    if (node === null || node === undefined || typeof node !== 'object') return null
    if (node.props && node.props['data-act'] === act) return node
    const kids = Array.isArray(node.children) ? node.children : [node.children]
    for (const k of kids) { const f = find(k, act); if (f !== null) return f }
    return null
  }
  const grip = find(tree, 'resize')
  assert.ok(grip !== null && grip.props.role === 'separator' && /Redimensionner/.test(grip.props['aria-label']))
  grip.props.onKeyDown({ key: 'ArrowLeft', shiftKey: false, preventDefault () {} })
  assert.ok(JSON.stringify(Panel()).includes('"width":"600px"'))
  grip.props.onKeyDown({ key: 'ArrowRight', shiftKey: true, preventDefault () {} })
  assert.ok(JSON.stringify(Panel()).includes('"width":"480px"'))
  for (let i = 0; i < 30; i += 1) grip.props.onKeyDown({ key: 'ArrowRight', shiftKey: true, preventDefault () {} })
  assert.ok(JSON.stringify(Panel()).includes('"width":"300px"'))
  for (let i = 0; i < 30; i += 1) grip.props.onKeyDown({ key: 'ArrowLeft', shiftKey: true, preventDefault () {} })
  assert.ok(JSON.stringify(Panel()).includes('"width":"1240px"'))
  ok('the grip at the top left resizes the video window (keys here, the mouse in the browser), never below 300 px nor wider than the window')

  const fullBtn = find(Panel(), 'panel-full')
  assert.equal(fullBtn.props['aria-pressed'], 'false')
  assert.match(fullBtn.props['aria-label'], /Plein écran/)
  fullBtn.props.onClick()
  const fullTree = Panel()
  assert.equal(fullTree.props['data-full'], 'true')
  const fullFlat = JSON.stringify(fullTree)
  assert.ok(fullFlat.includes('"top":"16px"') && fullFlat.includes('"bottom":"16px"') && fullFlat.includes('"flex":"1 1 0"'))
  assert.equal(find(fullTree, 'resize'), null)
  assert.match(find(fullTree, 'panel-full').props['aria-label'], /Réduire/)
  find(fullTree, 'panel-full').props.onClick()
  assert.equal(Panel().props['data-full'], 'false')
  ok('a button fills the whole window with the video, and brings it back')

  await plugin.__test.hangUp()
  e.responses.push({ ok: true, secrets: 'posee' }, { ok: true, url: 'wss://x', token: 'T', room: 'r', agent: { dispatched: true } })
  await plugin.__test.open({ sessionId: 'session-aaaaaaaa', name: 'Alice', mode: 'voice' })
  const voiceTree = Panel()
  assert.equal(find(voiceTree, 'resize'), null)
  assert.equal(find(voiceTree, 'panel-full'), null)
  assert.ok(JSON.stringify(voiceTree).includes('"width":"340px"'))
  ok('a voice call keeps its small 340 px card, with nothing to resize')

  const en = draw('en')
  en.e.responses.push({ ok: true, secrets: 'posee' }, { ok: true, url: 'wss://x', token: 'T', room: 'r', agent: { dispatched: true } })
  await en.plugin.__test.open({ sessionId: 'session-aaaaaaaa', name: 'Alice', mode: 'voice' })
  const flatEn = JSON.stringify(en.Panel())
  assert.ok(flatEn.includes('Hang up') && flatEn.includes('Mute me') && flatEn.includes('"height":"0px"'))
  ok('in English the same panel says "Hang up" and "Mute me"; a voice call has no picture area')
}

console.log('\nkybernos-call client: ' + pass + ' checks')
