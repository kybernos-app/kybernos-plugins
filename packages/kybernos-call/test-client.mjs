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
  const win = {
    __KB_LANG_RESOLVE__: () => lang,
    __ModuleLoader__: { load: (def) => { loaded.push(def) } },
    LivekitClient: null
  }
  const doc = {
    documentElement: { lang },
    body: {},
    head: { appendChild: (el) => { setImmediate(() => { win.LivekitClient = fakeSdk(rooms); el.onload() }) } },
    createElement: (tag) => ({ tag })
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
  return { win, doc, requests, responses, rooms, run, React }
}
const fakeSdk = (rooms) => {
  class Room {
    constructor (opts) { this.opts = opts; this.handlers = {}; this.connected = null; this.micCalls = []; this.disconnected = false; rooms.push(this)
      this.localParticipant = { setMicrophoneEnabled: async (on) => { this.micCalls.push(on); return { stop: async () => { this.micStopped = true } } } } }
    on (event, fn) { this.handlers[event] = fn }
    async connect (url, token) { if (this.failConnect) throw new Error('boom'); this.connected = { url, token } }
    async disconnect () { this.disconnected = true }
  }
  return { Room, RoomEvent: { TrackSubscribed: 'trackSubscribed', TranscriptionReceived: 'transcriptionReceived', ParticipantDisconnected: 'participantDisconnected', Disconnected: 'disconnected' } }
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
  assert.equal(registered.length, 1)
  assert.equal(registered[0].name, 'shell.overlay')
  assert.equal(registered[0].r.meta.id, 'kybernos-call-overlay')
  assert.equal(typeof e.win.__KB_CALL__.open, 'function')
  assert.equal(e.win.__KB_CALL__.version, 1)
  ok('apply registers the panel in the overlay slot and publishes window.__KB_CALL__.open')
  cleanups.forEach((c) => { if (typeof c === 'function') c() })
  assert.equal(e.win.__KB_CALL__, undefined)
  ok('stopping the plugin removes the seam (the Call buttons of other surfaces hide again)')

  const broken = makeEnv()
  const p2 = broken.run()
  assert.doesNotThrow(() => p2.apply({ slots: null, effect: () => { throw new Error('x') } }))
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
  assert.deepEqual(JSON.parse(e.requests[1].init.body), { sessionId: 'session-aaaaaaaa', kyberId: 'team-1', roleId: 'm1', name: 'Alice', mode: 'voice', language: 'auto', voice: null, identity: 'moi' })
  assert.equal(e.requests[1].init.method, 'POST')
  ok('it asks the host for the status, then for a token carrying the session, the team, the member, the mode, the language and the voice')

  const room = e.rooms[0]
  assert.deepEqual(room.connected, { url: 'wss://lk.example.test', token: 'JWT' })
  assert.deepEqual(room.micCalls, [true])
  const s = t.getState()
  assert.equal(s.phase, 'live')
  assert.equal(s.name, 'Alice')
  assert.equal(typeof s.startedAt, 'number')
  assert.match(s.note, /voice wayne · room-1/)
  ok('it joins the room with that token, publishes the microphone, and goes live')

  room.handlers.transcriptionReceived([{ text: 'bonjour' }, { text: 'tout le monde' }], { identity: 'moi' })
  assert.deepEqual(plain(t.getState().lines), ['moi: bonjour tout le monde'])
  for (let i = 0; i < 8; i++) room.handlers.transcriptionReceived([{ text: 'l' + i }], { identity: 'agent' })
  assert.equal(t.getState().lines.length, 6)
  room.handlers.transcriptionReceived([{ text: '   ' }], { identity: 'agent' })
  assert.equal(t.getState().lines.length, 6)
  ok('what is transcribed is shown (the last 6 lines), blanks are ignored')

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

  const f = makeEnv()
  const ft = f.run().__test
  f.responses.push({ ok: true, secrets: 'posee' }, { ok: true, url: 'wss://x', token: 'T', room: 'r', agent: { dispatched: true } })
  await ft.open({ sessionId: 'session-aaaaaaaa', name: 'Alice', voice: { custom: true } })
  assert.deepEqual(JSON.parse(f.requests[1].init.body).voice, { custom: true })
  assert.match(ft.getState().note, /recorded voice: the default voice is used \(cloning is not available yet\)/)
  ok('a recording given to the member is announced as not spoken yet (the default voice is used), instead of being silently ignored')
}

console.log('kybernos-call: what goes wrong is said, never invented over')
{
  const cases = [
    { name: 'host routes not loaded', responses: [new Error('network')], expect: /call routes are not loaded/ },
    { name: 'status not ok', responses: [{ ok: false }], expect: /call routes are not loaded/ },
    { name: 'no secrets', responses: [{ ok: true, secrets: 'absente' }], expect: /no call secrets on this machine/ },
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

console.log('kybernos-call: the panel and the language')
{
  const draw = (lang, mode) => {
    const e = makeEnv({ lang })
    const plugin = e.run()
    let Panel = null
    plugin.apply({ slots: { inject: (n, fn) => { fn(); return () => {} }, register: (m, c) => { Panel = c; return {} } }, effect: (fn) => fn() })
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
  assert.ok(flat.includes('"height":"180px"'))
  ok('live, in French: the panel is a dialog with "Raccrocher" and "Couper le micro", and a 180 px picture area for a video call')

  const en = draw('en')
  en.e.responses.push({ ok: true, secrets: 'posee' }, { ok: true, url: 'wss://x', token: 'T', room: 'r', agent: { dispatched: true } })
  await en.plugin.__test.open({ sessionId: 'session-aaaaaaaa', name: 'Alice', mode: 'voice' })
  const flatEn = JSON.stringify(en.Panel())
  assert.ok(flatEn.includes('Hang up') && flatEn.includes('Mute me') && flatEn.includes('"height":"0px"'))
  ok('in English the same panel says "Hang up" and "Mute me"; a voice call has no picture area')
}

console.log('\nkybernos-call client: ' + pass + ' checks')
