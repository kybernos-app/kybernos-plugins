// kybernos-call: the host logic (call-host.mjs) against a temporary DSH_HOME and fake servers.
// No DSH, no browser, no network beyond 127.0.0.1.
//
//   node packages/kybernos-call/test-host.mjs
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { callMetadata, createCall } from './call-host.mjs'
import { createStore } from './call-store.mjs'
import { createWorkerToken } from './worker-token.mjs'
import { createSpeechFeed } from './speech-feed.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

const SECRET = 'k'.repeat(40)
const home = mkdtempSync(join(tmpdir(), 'kybernos-call-host-'))
const put = (rel, text) => { const f = join(home, rel); mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, text); return f }
const secretsText = (extra = '') => 'LIVEKIT_URL=wss://lk.example.test\nLIVEKIT_API_KEY=APIkey\nLIVEKIT_API_SECRET=' + SECRET + '\n' + extra
const b64urlDecode = (s) => JSON.parse(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
const decodeJwt = (jwt, secret) => {
  const [h, p, s] = jwt.split('.')
  const expected = createHmac('sha256', secret).update(h + '.' + p).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return { header: b64urlDecode(h), payload: b64urlDecode(p), signatureOk: s === expected }
}
// The host asks `pgrep` whether a call worker is running. The real answer depends on the machine (a worker of this very
// checkout, or another session's, makes it true), so every case starts from « no process »; a case that needs one passes its own execFile.
const noProcess = (cmd, args, opts, cb) => { setImmediate(() => cb(Object.assign(new Error('none'), { code: 1 }), '', '')); return undefined }
const base = (over = {}) => createCall(Object.assign({ env: { DSH_WEB_PORT: '1' }, dshHome: async () => home, execFile: noProcess }, over))

try {
  console.log('kybernos-call: secrets and status')

  let call = base()
  assert.equal(await call.readSecrets(), null)
  assert.deepEqual(await call.status(), { ok: true, secrets: 'absente', url: null, provider: 'none', avatar: null, sandbox: false })
  ok('no secrets file → "absente", no URL, no provider')

  put('kybernos/livekit.env', 'LIVEKIT_URL=wss://lk.example.test\nLIVEKIT_API_KEY=APIkey\nLIVEKIT_API_SECRET=short\n')
  assert.equal(await call.readSecrets(), null)
  ok('a secret shorter than 20 characters is refused')

  put('kybernos/livekit.env', '# comment\nLIVEKIT_URL="wss://lk.example.test"\nLIVEKIT_API_KEY=\'APIkey\'\nLIVEKIT_API_SECRET=' + SECRET + '\nLIVEAVATAR_API_KEY=face\nLIVEAVATAR_AVATAR_ID=wayne\nLIVEAVATAR_SANDBOX=1\n')
  const status = await call.status()
  assert.equal(status.secrets, 'posee')
  assert.equal(status.url, 'wss://lk.example.test')
  assert.equal(status.provider, 'liveavatar')
  assert.equal(status.avatar, 'wayne')
  assert.equal(status.sandbox, true)
  ok('quotes are stripped, comments ignored, the face provider and sandbox are reported')
  assert.equal(JSON.stringify(status).includes(SECRET), false)
  assert.equal(JSON.stringify(status).includes('APIkey'), false)
  ok('the status never carries a secret')

  console.log('kybernos-call: the room token')
  const secrets = await call.readSecrets()
  const t = call.accessToken(secrets, { room: 'room-1', identity: 'moi' })
  const dec = decodeJwt(t.token, SECRET)
  assert.deepEqual(dec.header, { alg: 'HS256', typ: 'JWT' })
  assert.equal(dec.signatureOk, true)
  assert.equal(dec.payload.iss, 'APIkey')
  assert.equal(dec.payload.sub, 'moi')
  assert.deepEqual(dec.payload.video, { roomJoin: true, room: 'room-1', canPublish: true, canSubscribe: true, canPublishData: true })
  assert.equal(t.expiresIn, 7200)
  ok('a client token is a signed HS256 JWT that can only join its own room')

  const admin = decodeJwt(call.accessToken(secrets, { room: 'room-1', identity: 'h', admin: true }).token, SECRET)
  assert.deepEqual(admin.payload.video, { room: 'room-1', roomAdmin: true, roomList: true })
  ok('an admin token carries roomAdmin and no join/publish rights')

  assert.equal(call.accessToken(secrets, { room: 'r', identity: 'i', ttlSeconds: 5 }).expiresIn, 60)
  assert.equal(call.accessToken(secrets, { room: 'r', identity: 'i', ttlSeconds: 99999 }).expiresIn, 21600)
  assert.equal(call.accessToken(secrets, { room: 'r', identity: 'i', ttlSeconds: 'x' }).expiresIn, 7200)
  ok('the lifetime is clamped to 60 s … 6 h, and defaults to 2 h')

  console.log('kybernos-call: mint (no worker)')
  rmSync(join(home, 'kybernos', 'livekit.env'))
  assert.deepEqual(await call.mint({ agent: false }), { ok: false, error: 'LiveKit secrets missing' })
  put('kybernos/livekit.env', secretsText())
  const m1 = await call.mint({ agent: false })
  assert.equal(m1.ok, true)
  assert.match(m1.room, /^kyber-appel-[a-z0-9]+$/)
  assert.match(m1.identity, /^moi-[0-9a-f]{8}$/)
  assert.deepEqual(m1.agent, { running: false, dispatched: false })
  assert.equal(m1.url, 'wss://lk.example.test')
  ok('without secrets: refused; with them: a fresh room, a default identity, no worker when agent:false')

  const m2 = await call.mint({ agent: false, room: 'my_room-1', identity: '  Alice  ' })
  assert.equal(m2.room, 'my_room-1')
  assert.equal(m2.identity, 'Alice')
  const m3 = await call.mint({ agent: false, room: 'bad room!', identity: 'x'.repeat(65) })
  assert.match(m3.room, /^kyber-appel-/)
  assert.match(m3.identity, /^moi-/)
  ok('a valid room and identity are kept (trimmed); invalid ones fall back to generated ones')

  const m4 = await call.mint({ sessionId: 'session-aaaaaaaa' })
  assert.equal(m4.ok, true)
  assert.equal(m4.agent.running, false)
  assert.match(m4.agent.error, /venv/)
  ok('no worker venv: the call is NOT refused, the answer says so (agent.error)')

  console.log('kybernos-call: mint (worker started and woken)')
  put('kybernos/appel-venv/bin/python', '')
  const log = join(home, 'kybernos', 'logs', 'appel-agent.log')
  mkdirSync(join(home, 'kybernos', 'logs'), { recursive: true })
  const execCalls = []
  const spawnCalls = []
  const twirpCalls = []
  let workerAlive = false
  const fakeExec = (cmd, args, opts, cb) => {
    execCalls.push({ cmd, args, opts })
    // pgrep: no worker until one was spawned, then the one we spawned, until it is killed
    if (cmd === 'kill') workerAlive = false
    setImmediate(() => (cmd === 'pgrep' && workerAlive ? cb(null, '4242\n', '') : cb(cmd === 'pgrep' ? Object.assign(new Error('none'), { code: 1 }) : null, '', '')))
    return undefined
  }
  const fakeSpawn = (cmd, args, opts) => {
    workerAlive = true
    spawnCalls.push({ cmd, args, opts })
    writeFileSync(log, 'registered worker\n', { flag: 'a' }) // the worker "registers" as soon as it starts
    const child = new EventEmitter()
    child.pid = 4242
    child.unref = () => { child.unrefCalled = true }
    spawnCalls[spawnCalls.length - 1].child = child
    setImmediate(() => child.emit('spawn'))
    return child
  }
  const fakeFetch = async (url, init) => {
    twirpCalls.push({ url, init })
    return { status: 200, text: async () => '{}' }
  }
  call = base({ execFile: fakeExec, spawn: fakeSpawn, fetch: fakeFetch })
  const m5 = await call.mint({ sessionId: 'session-aaaaaaaa', kyberId: 'team-1', room: 'room-xyz' })
  assert.equal(m5.ok, true)
  assert.equal(m5.agent.running, true)
  assert.equal(m5.agent.ready, true)
  assert.equal(m5.agent.dispatched, true)
  const start = spawnCalls[0]
  assert.ok(start.cmd.endsWith('/kybernos/appel-venv/bin/python'))
  assert.deepEqual(start.args, [call.agentScript(), 'start'])
  assert.equal(start.opts.detached, true)
  assert.deepEqual(start.opts.stdio.slice(0, 1), ['ignore'])
  assert.equal(typeof start.opts.stdio[1], 'number')
  assert.equal(start.opts.stdio[1], start.opts.stdio[2])
  assert.equal(start.child.unrefCalled, true)
  assert.equal(start.opts.env.DSH_HOME, home)
  assert.equal('KYBER_SESSION_ID' in start.opts.env && start.opts.env.KYBER_SESSION_ID === 'session-aaaaaaaa', false)
  assert.equal(start.opts.env.KYBER_ID === 'team-1', false)
  ok('the worker is started detached with the venv\'s interpreter and its output on the log, and nothing about the call in its environment')
  assert.equal(twirpCalls.length, 1)
  assert.equal(twirpCalls[0].url, 'https://lk.example.test/twirp/livekit.AgentDispatchService/CreateDispatch')
  const dispatched = JSON.parse(twirpCalls[0].init.body)
  assert.equal(dispatched.room, 'room-xyz')
  assert.equal(dispatched.agent_name, 'kybernos-appel')
  assert.deepEqual(JSON.parse(dispatched.metadata), { sessionId: 'session-aaaaaaaa', kyberId: 'team-1', roleId: null, name: null, mode: 'voice', language: 'auto', voice: null, brain: 'voice' })
  assert.deepEqual(m5.meta, JSON.parse(dispatched.metadata))
  ok('the call\'s identity travels with the room (dispatch metadata), and is echoed in the answer')
  const m5b = await call.mint({ sessionId: 'session-bbbbbbbb', kyberId: 'team-2', roleId: 'm2', name: 'Bob', mode: 'video', language: 'es', room: 'room-two' })
  const second = JSON.parse(JSON.parse(twirpCalls[1].init.body).metadata)
  assert.deepEqual(second, { sessionId: 'session-bbbbbbbb', kyberId: 'team-2', roleId: 'm2', name: 'Bob', mode: 'video', language: 'es', voice: null, brain: 'voice' })
  assert.equal(spawnCalls.length, 1, 'the second call reuses the worker')
  assert.equal(m5b.agent.dispatched, true)
  ok('a second call to another session is its own room with its own identity, on the same worker (the first call\'s session is not kept)')
  // The default voice of Settings › Calls fills a call that asks for none; Kaby asks for the app's own voice, or for its own, and the default is never applied over it.
  {
    const store = createStore({ dshHome: async () => home })
    await store.writeSettings({ defaultVoice: { engine: 'edge', voice: 'fr-FR-DeniseNeural', lang: 'fr' } })
    const withDefault = base({ store, execFile: fakeExec, spawn: fakeSpawn, fetch: fakeFetch })
    const metaOf = async (asked) => { const before = twirpCalls.length; await withDefault.mint(Object.assign({ sessionId: 'session-cccccccc', room: 'room-' + before }, asked)); return JSON.parse(JSON.parse(twirpCalls[before].init.body).metadata) }
    assert.deepEqual((await metaOf({})).voice, { engine: 'edge', voice: 'fr-FR-DeniseNeural', lang: 'fr' })
    ok('a call that asks for no voice gets the default voice of Settings › Calls')
    assert.equal((await metaOf({ voice: { app: true } })).voice, null)
    ok('a call that asks for the app\'s own voice ({ app: true }) gets none: the worker uses the app\'s voice, and Calls\' default is not applied')
    assert.deepEqual((await metaOf({ voice: { engine: 'say', voice: 'Amélie', lang: 'fr-FR' } })).voice, { engine: 'say', voice: 'Amélie', lang: 'fr' })
    ok('a call that asks for a voice of its own keeps it over the default')
    assert.equal((await metaOf({ roleId: 'm2' })).voice, null)
    ok('a team member\'s call without a voice is not given the default (unchanged)')
  }
  const bearer = decodeJwt(twirpCalls[0].init.headers.authorization.replace('Bearer ', ''), SECRET)
  assert.equal(bearer.signatureOk, true)
  assert.equal(bearer.payload.video.roomAdmin, true)
  assert.equal(bearer.payload.video.room, 'room-xyz')
  ok('the agent is woken on THAT room by one https Twirp call with an admin token (wss → https)')

  const failingFetch = async () => ({ status: 401, text: async () => JSON.stringify({ code: 'unauthenticated', msg: 'bad key' }) })
  const m6 = await base({ execFile: fakeExec, spawn: fakeSpawn, fetch: failingFetch }).mint({ room: 'room-abc' })
  assert.equal(m6.ok, true)
  assert.equal(m6.agent.dispatched, false)
  assert.equal(m6.agent.dispatchError, 'unauthenticated')
  assert.equal(m6.agent.dispatchDetail, 'bad key')
  ok('a refused dispatch does not refuse the call: agent.dispatched is false and says why')

  console.log('kybernos-call: one brain (the session\'s replies)')
  {
    const feed = createSpeechFeed()
    const wired = base({ execFile: fakeExec, spawn: fakeSpawn, fetch: fakeFetch, feed })
    const before = twirpCalls.length
    const mm = await wired.mint({ sessionId: 'session-aaaaaaaa', room: 'room-brain' })
    assert.equal(mm.agent.dispatched, true)
    assert.equal(mm.meta.brain, 'session')
    assert.equal(JSON.parse(JSON.parse(twirpCalls[before].init.body).metadata).brain, 'session')
    assert.equal(feed.sessionOf('room-brain'), 'session-aaaaaaaa')
    feed.ingest('session-aaaaaaaa', { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'Spoken reply.' }] } } })
    assert.deepEqual((await feed.poll('room-brain', 0, 0)).items.map((i) => i.text), ['Spoken reply.'])
    ok('a call with a session tells the worker "brain: session" and the host keeps that session\'s replies for the room')

    const noSession = await wired.mint({ room: 'room-nosession' })
    assert.equal(noSession.meta.brain, 'voice')
    assert.equal(feed.sessionOf('room-nosession'), null)
    ok('a call without a session keeps the worker\'s own voice model, and nothing is followed')

    const refused = await base({ execFile: fakeExec, spawn: fakeSpawn, fetch: failingFetch, feed }).mint({ sessionId: 'session-aaaaaaaa', room: 'room-refused' })
    assert.equal(refused.agent.dispatched, false)
    assert.equal(feed.sessionOf('room-refused'), null)
    ok('a worker that could not be woken leaves nothing registered')

    const noWorker = await base({ feed }).mint({ sessionId: 'session-aaaaaaaa', room: 'room-noworker' })
    assert.equal(noWorker.ok, true)
    assert.equal(feed.sessionOf('room-noworker'), null)
    ok('with no worker (no venv) nothing is registered either')
  }

  console.log('kybernos-call: the worker\'s one-run secret (L3-03)')
  {
    // A fake process table: `spawn` starts a worker, `kill` ends it, `pgrep` lists the running ones. The secret is in the environment the worker is started with, and only there.
    const running = new Set()
    const spawned = []
    const killed = []
    let nextPid = 5000
    const exec = (cmd, args, opts, cb) => {
      if (cmd === 'kill') for (const a of args) { if (a !== '-9') { running.delete(Number(a)); killed.push(Number(a)) } }
      setImmediate(() => (cmd === 'pgrep' ? (running.size > 0 ? cb(null, [...running].join('\n') + '\n', '') : cb(Object.assign(new Error('none'), { code: 1 }), '', '')) : cb(null, '', '')))
      return undefined
    }
    let failNext = false
    const spawn = (cmd, args, opts) => {
      const child = new EventEmitter()
      child.pid = nextPid++
      child.unref = () => {}
      spawned.push({ child, env: opts.env })
      if (failNext) { failNext = false; setImmediate(() => child.emit('error', new Error('spawn EACCES'))); return child }
      running.add(child.pid)
      writeFileSync(log, 'registered worker\n', { flag: 'a' })
      setImmediate(() => child.emit('spawn'))
      return child
    }
    const host = () => base({ execFile: exec, spawn: spawn, fetch: fakeFetch })
    const secretOf = (n) => spawned[n].env.KYBER_CALL_TOKEN
    const bearing = (secret, extra = {}) => ({ headers: Object.assign({ 'x-kybernos-call-token': secret }, extra) })
    // The credential itself: one live secret at a time, issued random, replaced (not added to) by the next.
    {
      const t = createWorkerToken()
      assert.equal(t.accepts(bearing('x')), false)
      const first = t.issue()
      const second = t.issue()
      assert.notEqual(first, second)
      assert.equal(t.accepts(bearing(first)), false)
      assert.equal(t.accepts(bearing(second)), true)
      t.revoke()
      assert.equal(t.accepts(bearing(second)), false)
      ok('issuing a new secret replaces the previous one (one live secret at a time), and revoking leaves none')
    }
    const call1 = host()

    assert.equal(call1.workerAccepts(bearing('anything')), false)
    ok('before any worker has been started, no secret is accepted')
    assert.equal((await call1.agentStart()).started, true)
    const one = secretOf(0)
    assert.match(one, /^[0-9a-f]{64}$/)
    assert.equal(call1.workerAccepts(bearing(one)), true)
    ok('a worker is started with a random 256-bit secret in its environment, and the host accepts it from the request header')
    for (const bad of [undefined, '', 'x', one.slice(0, -1), one + '0', one.toUpperCase(), ' ' + one, one.slice(0, -1) + (one.endsWith('0') ? '1' : '0')]) {
      assert.equal(call1.workerAccepts(bad === undefined ? { headers: {} } : bearing(bad)), false, String(bad))
    }
    assert.equal(call1.workerAccepts({ headers: { origin: 'http://127.0.0.1:3080' } }), false)
    assert.equal(call1.workerAccepts(undefined), false)
    assert.equal(call1.workerAccepts({}), false)
    ok('no header, an empty, truncated, extended, upper-cased, padded or one-character-off secret is refused (and so is a request with no headers at all)')
    assert.equal(call1.workerAccepts(bearing(one, { 'x-kybernos-tunnel': '1' })), false)
    ok('the right secret on a request relayed by the phone tunnel is refused')
    // Nothing the host says carries it.
    const said = JSON.stringify([await call1.agentState(), await call1.status(), await call1.mint({ room: 'room-secret' }), await call1.agentStart(), Object.keys(call1)])
    assert.equal(said.includes(one), false)
    assert.equal(readFileSync(log, 'utf8').includes(one), false)
    ok('the secret is in no answer of the host and not in the log: it is in the worker\'s environment only')
    assert.equal(spawned.length, 1)
    assert.equal(call1.workerAccepts(bearing(one)), true)
    ok('a second call (and a mint) reuse the running worker: no new process, the same secret still holds')

    await call1.agentStop()
    assert.equal(call1.workerAccepts(bearing(one)), false)
    assert.equal(spawned.length, 1)
    ok('once the worker is stopped its secret is refused')
    assert.equal((await call1.agentStart()).started, true)
    const two = secretOf(1)
    assert.notEqual(two, one)
    assert.equal(call1.workerAccepts(bearing(one)), false)
    assert.equal(call1.workerAccepts(bearing(two)), true)
    ok('a restarted worker gets a new secret; the old one stays refused')
    spawned[0].child.emit('exit', 0)
    assert.equal(call1.workerAccepts(bearing(two)), true)
    ok('the late exit of the OLD worker does not take the new worker\'s secret away')
    running.delete(spawned[1].child.pid)
    spawned[1].child.emit('exit', 1)
    assert.equal(call1.workerAccepts(bearing(two)), false)
    ok('a worker that exits by itself loses its secret')

    // A worker that outlived the host (a DSH restart): the new host never knew its secret, so it replaces it.
    const before = spawned.length
    const call2 = host()
    assert.equal((await call2.agentStart()).started, true)
    const three = secretOf(before)
    assert.equal(call2.workerAccepts(bearing(three)), true)
    const orphan = host()
    const killedBefore = killed.length
    assert.equal((await orphan.agentStart()).started, true)
    assert.equal(spawned.length, before + 2)
    assert.equal(killed.length > killedBefore, true)
    assert.equal(running.size, 1)
    assert.equal(orphan.workerAccepts(bearing(three)), false)
    assert.equal(orphan.workerAccepts(bearing(secretOf(before + 1))), true)
    ok('a worker this host did not start (it outlived a DSH restart) is ended and replaced, with a secret this host knows; the old process is gone')

    // The plugin stops: the secret goes, the worker (which outlives it) is replaced at the next call.
    const secretNow = secretOf(before + 1)
    orphan.dropWorker()
    assert.equal(orphan.workerAccepts(bearing(secretNow)), false)
    assert.equal(running.size, 1)
    ok('when the plugin stops its secret is withdrawn')

    // A failed start leaves nothing valid behind.
    running.clear()
    const failing = host()
    const tries = spawned.length
    failNext = true
    const bad = await failing.agentStart()
    assert.equal(bad.ok, false)
    assert.equal(failing.workerAccepts(bearing(secretOf(tries))), false)
    ok('a worker that fails to start leaves no valid secret')

    // Two starts at once make one worker.
    running.clear()
    const racing = host()
    const n = spawned.length
    await Promise.all([racing.agentStart(), racing.agentStart(), racing.agentStart()])
    assert.equal(spawned.length, n + 1)
    assert.equal(racing.workerAccepts(bearing(secretOf(n))), true)
    ok('three starts at once make one worker, with one secret that holds')
  }

  console.log('kybernos-call: the member\'s voice')
  assert.deepEqual(callMetadata({ voice: { engine: 'edge', voice: 'fr-FR-DeniseNeural', lang: 'fr-FR' } }).voice, { engine: 'edge', voice: 'fr-FR-DeniseNeural', lang: 'fr' })
  assert.deepEqual(callMetadata({ voice: { engine: 'say', voice: 'Eddy (English (UK))', lang: 'en' } }).voice, { engine: 'say', voice: 'Eddy (English (UK))', lang: 'en' })
  // The app's own French voice has an accent: a name checked as plain ASCII silently dropped it, and the call used another voice.
  assert.deepEqual(callMetadata({ voice: { engine: 'say', voice: 'Amélie', lang: 'fr' } }).voice, { engine: 'say', voice: 'Amélie', lang: 'fr' })
  assert.deepEqual(callMetadata({ voice: { engine: 'say', voice: 'Mónica', lang: 'es' } }).voice, { engine: 'say', voice: 'Mónica', lang: 'es' })
  assert.equal(callMetadata({ voice: { engine: 'say', voice: 'a\nb', lang: 'fr' } }).voice, null)
  assert.equal(callMetadata({ voice: { engine: 'say', voice: '../Amélie', lang: 'fr' } }).voice, null)
  assert.deepEqual(callMetadata({ voice: { engine: 'piper', voice: 'fr_FR-siwis-medium.onnx' } }).voice, { engine: 'piper', voice: 'fr_FR-siwis-medium.onnx', lang: '' })
  ok('an engine voice is kept (the language cut to two letters), including names with spaces, brackets and dots')
  assert.deepEqual(callMetadata({ voice: { custom: true, engine: 'edge', voice: 'x' } }).voice, { custom: true })
  ok('a recording no engine speaks is passed as { custom: true } and nothing else of it')
  for (const bad of [null, 'edge', [], {}, { engine: 'Edge!', voice: 'x' }, { engine: 'edge', voice: '' }, { engine: 'edge', voice: 'a/b' }, { engine: 'edge', voice: '../x' }, { engine: 'edge', voice: 'x'.repeat(101) }, { engine: 3, voice: 'x' }, { engine: 'edge' }]) {
    assert.equal(callMetadata({ voice: bad }).voice, null, JSON.stringify(bad))
  }
  ok('anything else (path characters, wrong types, missing parts, over-long) is dropped: the default voice is used')

  console.log('kybernos-call: who a call is with')
  assert.deepEqual(callMetadata({}), { sessionId: null, kyberId: null, roleId: null, name: null, mode: 'voice', language: 'auto', voice: null, brain: 'voice' })
  assert.deepEqual(callMetadata(null), callMetadata({}))
  ok('nothing asked: no session, no member, voice, language auto')
  const full = callMetadata({ sessionId: 'session-aaaaaaaa', kyberId: 'team-1', roleId: 'm1', name: '  Alice  ', mode: 'video', language: 'pt-BR' })
  assert.deepEqual(full, { sessionId: 'session-aaaaaaaa', kyberId: 'team-1', roleId: 'm1', name: 'Alice', mode: 'video', language: 'pt-BR', voice: null, brain: 'voice' })
  ok('a good request passes through (the name is trimmed)')
  const bad = callMetadata({ sessionId: 'nope', kyberId: '../etc', roleId: 'a b', name: 'Al\u0000i\nce' + 'x'.repeat(100), mode: 'hologram', language: 'Klingon!' })
  assert.equal(bad.sessionId, null)
  assert.equal(bad.kyberId, null)
  assert.equal(bad.roleId, null)
  assert.equal(bad.mode, 'voice')
  assert.equal(bad.language, 'auto')
  assert.equal(bad.name.length, 60)
  assert.equal(/[\u0000-\u001f]/.test(bad.name), false)
  ok('a bad session id, ids with path characters, an unknown mode or language are dropped; the name loses control characters and is cut at 60')
  assert.equal(callMetadata({ sessionId: 'session-aaaaaaaa' }, { sessionBrain: true }).brain, 'session')
  assert.equal(callMetadata({}, { sessionBrain: true }).brain, 'voice')
  assert.equal(callMetadata({ sessionId: 'session-aaaaaaaa' }).brain, 'voice')
  ok('"session" brain only when the call has a session AND this host can feed it; otherwise the worker answers with its voice model')
  assert.equal(callMetadata({ name: 42, sessionId: 7, language: 5 }).language, 'auto')
  assert.equal(JSON.stringify(callMetadata({ name: 'x'.repeat(5000), kyberId: 'k'.repeat(5000) })).length < 400, true)
  ok('wrong types are ignored and the metadata stays small')

  console.log('kybernos-call: what is heard enters the session')
  const calls = []
  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      calls.push({ url: req.url, headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) })
      const text = calls[calls.length - 1].body.payload.args.request.content[0].text
      res.writeHead(text === 'boom' ? 500 : 200, { 'content-type': 'application/json' })
      if (text === 'denied') return res.end(JSON.stringify({ result: { ok: false, error: { code: 'forbidden', message: 'no way' } } }))
      res.end(JSON.stringify({ result: { ok: true, value: { accepted: true } } }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const browserSecret = Buffer.alloc(32, 9)
  put('.credentials.yaml', 'client-connection/browser-session:\n  secret: ' + browserSecret.toString('base64url') + '\n')
  const talk = createCall({ env: { DSH_WEB_PORT: String(port) }, dshHome: async () => home })

  assert.deepEqual(await talk.utterance({ sessionId: 'nope', text: 'hi' }), { ok: false, error: 'unknown session' })
  assert.deepEqual(await talk.utterance({ sessionId: 'session-aaaaaaaa', text: '   ' }), { ok: false, error: 'text required' })
  assert.equal((await talk.utterance({ sessionId: 'session-aaaaaaaa', text: 'x'.repeat(4001) })).error, 'text too long (4000 characters max)')
  assert.equal(calls.length, 0)
  ok('a bad session id, an empty text and an over-long text are refused before any request')

  const sent = await talk.utterance({ sessionId: 'session-aaaaaaaa', text: '  hello there  ' })
  assert.deepEqual(sent, { ok: true, accepted: true, sessionId: 'session-aaaaaaaa', mode: 'queue' })
  assert.equal(calls[0].url, '/api/session/prompt')
  assert.deepEqual(calls[0].body.payload.args.request.content, [{ type: 'text', text: 'hello there' }])
  assert.equal(calls[0].body.payload.args.request.mode, 'queue')
  assert.equal(calls[0].body.method, 'session/prompt')
  ok('the text becomes a session/prompt turn (trimmed, queued by default)')

  assert.equal((await talk.utterance({ sessionId: 'session-aaaaaaaa', text: 'steer me', mode: 'steer' })).mode, 'steer')
  assert.equal((await talk.utterance({ sessionId: 'session-aaaaaaaa', text: 'x', mode: 'whatever' })).mode, 'queue')
  ok('mode "steer" is honoured, anything else is "queue"')

  const cookie = calls[0].headers.cookie
  const m = /^dsh-auth-([A-Za-z0-9_-]+)=v1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(cookie)
  assert.ok(m, 'cookie shape')
  const expectedSig = createHmac('sha256', browserSecret).update(m[2]).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  assert.equal(m[3], expectedSig)
  const claims = b64urlDecode(m[2])
  assert.equal(claims.authority, '127.0.0.1:' + port)
  assert.equal(claims.version, 1)
  assert.equal(calls[0].headers.origin, 'http://127.0.0.1:' + port)
  assert.equal(calls[0].headers['sec-fetch-site'], 'same-origin')
  ok('the request carries a dsh-auth cookie signed with the browser-session secret, scoped to the local authority')

  const denied = await talk.utterance({ sessionId: 'session-aaaaaaaa', text: 'denied' })
  assert.equal(denied.ok, false)
  assert.equal(denied.error, 'forbidden')
  assert.equal(denied.detail, 'no way')
  const boom = await talk.utterance({ sessionId: 'session-aaaaaaaa', text: 'boom' })
  assert.equal(boom.ok, false)
  assert.equal(boom.error, 'HTTP 500')
  ok('an RPC refusal and an HTTP error come back as { ok: false, error }, never as an exception')

  rmSync(join(home, '.credentials.yaml'))
  assert.deepEqual(await talk.utterance({ sessionId: 'session-aaaaaaaa', text: 'hi' }), { ok: false, error: 'session cookie unavailable' })
  ok('without the browser-session secret the turn is refused, not forged')
  await new Promise((resolve) => server.close(resolve))
} finally {
  rmSync(home, { recursive: true, force: true })
}
console.log('\nkybernos-call host: ' + pass + ' checks')
