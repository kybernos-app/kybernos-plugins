// What the phone link talks to, for the live checks and the real-phone script. Two backends with one shape:
//
//   fake  the stand-in relay of the bundle (packages/kybernos-mobile/remote-fake-relay.mjs): nothing leaves the machine.
//   real  the REAL Kybernos server (kybernos-server, scripts/replica.ts: the application on an embedded Postgres, with
//         the outside world replaced by stand-ins) behind a public https tunnel (ngrok), so the phone page is served
//         from a real https origin and the relay is reached the way a person's phone reaches it.
//
// Both point the isolated DSH (scripts/sandbox/) at their API, signed in, and put its files back on close().
//
//   const backend = await startBackend({ real: true, serverDir })
//   backend.phoneOrigin    where the phone page is served
//   backend.serverDevices() how many phones the server lists for the signed-in person
//   backend.setPhoneLink(on)  the person's plan lists the phone link, or stops listing it
//   await backend.close()
import { spawn } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startFakeRelay } from '../packages/kybernos-mobile/remote-fake-relay.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── the isolated DSH's own files ─────────────────────────────────────────────────────────────────────────────────
/** Point the isolated DSH at a server, signed in. Returns the function that puts its files back. */
export function pointSandboxAt ({ id, name, api, web, token, user }) {
  const dshHome = process.env.DSH_HOME || ''
  if (!dshHome.includes('.kybernos-sandbox')) throw new Error('DSH_HOME is not an isolated instance (' + (dshHome || 'unset') + '). Run: source scripts/sandbox/env.sh')
  const servers = join(dshHome, 'kybernos', 'servers.json')
  const state = join(dshHome, 'kybernos-cloud-' + id + '.json')
  const keep = (file) => { if (existsSync(file)) { const bak = file + '.live-mobile-bak'; renameSync(file, bak); return bak } return null }
  const bakServers = keep(servers)
  const bakState = keep(state)
  mkdirSync(join(dshHome, 'kybernos'), { recursive: true })
  writeFileSync(servers, JSON.stringify({ active: id, servers: [{ id, name, api, web, services: { llm: false } }] }))
  writeFileSync(state, JSON.stringify({ token, user, workspaces: [] }))
  const put = (file, bak) => { rmSync(file, { force: true }); if (bak !== null) renameSync(bak, file) }
  return () => { put(servers, bakServers); put(state, bakState) }
}

// ── the stand-in ─────────────────────────────────────────────────────────────────────────────────────────────────
async function startFake () {
  const relay = await startFakeRelay({ entitled: true, maxDevices: 4 })
  const restore = pointSandboxAt({ id: 'live-mobile', name: 'Live stand-in', api: relay.url, web: relay.url, token: 'kyd-live-mobile-token', user: { id: 'u1', name: 'Live Tester', plan: 'solo' } })
  return {
    kind: 'fake',
    phoneOrigin: relay.url,
    api: relay.url,
    relay,
    pairingsAsked: () => relay.state.authCalls.filter((c) => c === 'POST /v1/remote/pairings').length,
    serverDevices: async () => relay.state.devices.size,
    setPhoneLink: async (on) => { relay.state.entitled = on === true },
    /** Cut the phone's connection to the relay while its page stays open (what a locked phone does). Returns how many were cut. */
    dropPhoneLink: async () => {
      let n = 0
      for (const room of relay.state.rooms.values()) if (room.phone) { room.phone.close(); n += 1 }
      return n
    },
    ciphertextOnly: () => {
      const sealed = relay.state.samples.filter((s) => !s.startsWith('{'))
      return relay.state.framesBinary > 50 && sealed.length > 40 && sealed.every((s) => !/"t"\s*:|<html|"method"/u.test(s))
    },
    close: async () => { await relay.close(); restore() },
  }
}

// ── the real server ──────────────────────────────────────────────────────────────────────────────────────────────
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
function totp (secret, steps = 0) {
  let bits = 0
  let acc = 0
  const bytes = []
  for (const ch of secret.replace(/=+$/u, '').toUpperCase()) {
    acc = (acc << 5) | B32.indexOf(ch)
    bits += 5
    if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); acc &= (1 << bits) - 1 }
  }
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + steps))
  const mac = createHmac('sha1', Buffer.from(bytes)).update(msg).digest()
  const o = mac[mac.length - 1] & 15
  const n = ((mac[o] & 0x7f) << 24) | (mac[o + 1] << 16) | (mac[o + 2] << 8) | mac[o + 3]
  return String(n % 1000000).padStart(6, '0')
}

function spawnLogged (cmd, args, options, onLine) {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options })
  const lines = []
  const feed = (buf) => {
    for (const line of String(buf).split('\n')) {
      if (line.trim() === '') continue
      lines.push(line)
      if (lines.length > 200) lines.shift()
      if (onLine) onLine(line)
    }
  }
  child.stdout.on('data', feed)
  child.stderr.on('data', feed)
  return { child, lines }
}

async function waitUntil (what, test, ms) {
  const end = Date.now() + ms
  for (;;) {
    const v = await test()
    if (v) return v
    if (Date.now() > end) throw new Error('timed out waiting for ' + what)
    await sleep(250)
  }
}

async function startReal ({ serverDir, port = 8797, log = () => {} }) {
  if (typeof serverDir !== 'string' || serverDir === '' || !existsSync(join(serverDir, 'scripts', 'replica.ts'))) {
    throw new Error('the kybernos-server checkout is needed (KYBERNOS_SERVER_DIR=<its folder>, with scripts/replica.ts)')
  }
  const cleanups = []
  const close = async () => { for (const f of cleanups.reverse()) { try { await f() } catch (e) { /* closing */ } } }
  try {
    // 1. the public https address, before the server, because the server wants to know it.
    log('opening the https tunnel (ngrok)')
    let tunnelUrl = null
    let tunnelError = null
    // ngrok keeps its account in the person's own home; the isolated DSH's HOME is another one (scripts/sandbox/env.sh).
    const ngrokEnv = process.env.KB_REAL_HOME ? { ...process.env, HOME: process.env.KB_REAL_HOME } : process.env
    const tunnel = spawnLogged('ngrok', ['http', '127.0.0.1:' + port, '--log=stdout', '--log-format=json'], { env: ngrokEnv }, (line) => {
      try {
        const o = JSON.parse(line)
        if (o.msg === 'started tunnel' && typeof o.url === 'string') tunnelUrl = o.url
        if (typeof o.err === 'string' && o.err !== 'nil' && o.err !== '') tunnelError = o.err
      } catch (e) { /* not a log line */ }
    })
    cleanups.push(() => { try { tunnel.child.kill('SIGTERM') } catch (e) { /* gone */ } })
    await waitUntil('the tunnel (' + (tunnelError || 'no error yet') + ')', () => tunnelUrl !== null || tunnelError !== null, 30000)
    if (tunnelUrl === null) throw new Error('the tunnel did not open: ' + String(tunnelError).split('\n')[0].slice(0, 200))
    const phoneOrigin = new URL(tunnelUrl).origin
    log('tunnel ' + phoneOrigin)

    // 2. the server: the real application on an embedded Postgres, seeded with the catalogue's plans.
    log('starting the server')
    const work = mkdtempSync(join(tmpdir(), 'kb-real-'))
    cleanups.push(() => rmSync(work, { recursive: true, force: true }))
    const stateFile = join(work, 'replica-state.json')
    let ready = false
    const server = spawnLogged(process.execPath, ['scripts/replica.ts'], {
      cwd: serverDir,
      env: { ...process.env, REPLICA_PORT: String(port), REPLICA_STATE: stateFile, REPLICA_SEED: 'catalogue', REMOTE_PHONE_URL: phoneOrigin, LOG_LEVEL: 'warn' },
    }, (line) => { if (line.startsWith('replica ready')) ready = true })
    cleanups.push(async () => {
      try { server.child.kill('SIGTERM') } catch (e) { /* gone */ }
      await sleep(1500)
      try { server.child.kill('SIGKILL') } catch (e) { /* gone */ }
    })
    let exited = false
    server.child.on('exit', () => { exited = true })
    await waitUntil('the server (' + server.lines.slice(-3).join(' | ') + ')', () => ready === true || exited === true, 180000)
    if (!ready) throw new Error('the server stopped: ' + server.lines.slice(-6).join(' | '))
    const state = JSON.parse(readFileSync(stateFile, 'utf8'))
    const api = state.api
    log('server ' + api)

    // 3. the owner (made up, replica only): signs in with a second factor, publishes the plan, connects the DSH.
    let n = 0
    const call = async (method, path, init = {}) => {
      const headers = { origin: state.web, 'x-test-ip': '198.19.' + Math.floor(n / 250) + '.' + ((n++ % 250) + 1) }
      if (init.json !== undefined) headers['content-type'] = 'application/json'
      if (init.cookie !== undefined) headers.cookie = init.cookie
      if (init.token !== undefined) headers.authorization = 'Bearer ' + init.token
      const res = await fetch(api + path, { method, headers, body: init.json === undefined ? undefined : JSON.stringify(init.json) })
      let body = null
      try { body = await res.json() } catch (e) { /* an empty answer */ }
      return { status: res.status, body, res }
    }
    const cookieOf = (res) => res.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => c !== '').join('; ')
    const must = (what, r, ok = 200) => { if (r.status !== ok) throw new Error(what + ' answered ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 200)); return r }
    const { email, password, totp_secret: secret } = state.owner
    const first = must('sign-in', await call('POST', '/api/auth/sign-in/email', { json: { email, password } }))
    let session = null
    for (const steps of [0, 1, -1]) {
      const r = await call('POST', '/api/auth/two-factor/verify-totp', { cookie: cookieOf(first.res), json: { code: totp(secret, steps) } })
      if (r.status === 200) { session = cookieOf(r.res); break }
    }
    if (session === null) throw new Error('second factor refused')

    const catalogue = JSON.parse(readFileSync(join(serverDir, 'catalogue', 'free.json'), 'utf8'))
    const publishFree = async (withRemote) => {
      const features = catalogue.definition.features.filter((f) => f !== 'remote').concat(withRemote ? ['remote'] : [])
      const body = { kind: catalogue.plan.kind, name: catalogue.plan.name, visible: true, sort: catalogue.plan.sort || 0, definition: { ...catalogue.definition, features }, prices: catalogue.prices }
      must('plan draft', await call('PUT', '/v1/admin/billing/plans/free/draft', { cookie: session, json: body }))
      must('plan publish', await call('POST', '/v1/admin/billing/plans/free/publish', { cookie: session }))
    }
    await publishFree(true)

    // The DSH is connected the way a person's is: a device asks, the person approves, the device claims its token.
    const started = must('device start', await call('POST', '/v1/device/start', { json: { client: 'dsh', version: 'live-check', device_label: 'Live check DSH' } }))
    must('device approve', await call('POST', '/v1/device/approve', { cookie: session, json: { device_id: started.body.device_id, user_code: started.body.user_code } }))
    const claimed = must('device claim', await call('POST', '/v1/device/poll', { json: { device_id: started.body.device_id, device_secret: started.body.device_secret } }))
    if (claimed.body.status !== 'claimed' || typeof claimed.body.token !== 'string') throw new Error('device claim: ' + JSON.stringify(claimed.body).slice(0, 200))
    const token = claimed.body.token
    const restore = pointSandboxAt({ id: 'live-real', name: 'Local server', api, web: state.web, token, user: claimed.body.user })
    cleanups.push(restore)
    log('the DSH is connected to ' + api)

    return {
      kind: 'real',
      phoneOrigin,
      api,
      owner: { email },
      pairingsAsked: () => null,
      serverDevices: async () => {
        const r = await call('GET', '/v1/remote/devices', { token })
        return r.status === 200 && Array.isArray(r.body.devices) ? r.body.devices.length : null
      },
      remoteStatus: async () => (await call('GET', '/v1/remote/devices', { token })).body,
      setPhoneLink: async (on) => { await publishFree(on === true) },
      dropPhoneLink: async () => null,
      ciphertextOnly: () => null,
      serverLog: () => server.lines.slice(),
      close,
    }
  } catch (e) {
    await close()
    throw e
  }
}

export async function startBackend (options = {}) {
  return options.real === true ? startReal(options) : startFake()
}
