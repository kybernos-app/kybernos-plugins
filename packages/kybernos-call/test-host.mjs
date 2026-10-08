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
import { createCall } from './call-host.mjs'

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
const base = (over = {}) => createCall(Object.assign({ env: { DSH_WEB_PORT: '1' }, dshHome: async () => home }, over))

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
  const fakeExec = (cmd, args, opts, cb) => {
    execCalls.push({ cmd, args, opts })
    setImmediate(() => cb(Object.assign(new Error('none'), { code: 1 }), '', '')) // pgrep: no worker yet
    return undefined
  }
  const fakeSpawn = (cmd, args, opts) => {
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
  assert.equal(start.opts.env.KYBER_SESSION_ID, 'session-aaaaaaaa')
  assert.equal(start.opts.env.KYBER_ID, 'team-1')
  assert.equal(start.opts.env.DSH_HOME, home)
  ok('the worker is started detached with the venv\'s interpreter, its output on the log, the session and the kyber in its environment')
  assert.equal(twirpCalls.length, 1)
  assert.equal(twirpCalls[0].url, 'https://lk.example.test/twirp/livekit.AgentDispatchService/CreateDispatch')
  assert.deepEqual(JSON.parse(twirpCalls[0].init.body), { room: 'room-xyz', agent_name: 'kybernos-appel' })
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
