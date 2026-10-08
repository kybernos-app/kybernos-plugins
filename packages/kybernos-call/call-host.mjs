// kybernos-call: the host logic of a call, testable without DSH.
//
// A call is three things: a LiveKit room, an access token for the browser, and a listening worker
// (agent/agent.py) woken up on that room. Moved as is from @local/kybernos (index.js, "Appel"),
// with I/O injected so the tests can run it against a temporary DSH_HOME and fake servers.
//
// What it never does: hand a secret to the browser. The browser gets a room-join token only.
import { execFile as nodeExecFile, spawn as nodeSpawn } from 'node:child_process'
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dshHomeSync } from './dsh-home.mjs'

export const AGENT_NAME = 'kybernos-appel'
export const ENV_REL = 'kybernos/livekit.env'
export const ROOM_RE = /^[A-Za-z0-9_-]{3,64}$/
export const SESSION_RE = /^session-[A-Za-z0-9-]{6,80}$/

const str = (v) => (typeof v === 'string' ? v : null)
const errText = (e) => (e && e.message ? String(e.message) : String(e))
const CONTROL = /[\u0000-\u001f\u007f]/g
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const LANG_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/
const ENGINE_RE = /^[a-z0-9_-]{1,32}$/
const VOICE_RE = /^[A-Za-z0-9._:() -]{1,100}$/

/**
 * Who a call is with, as the worker will read it (the dispatch metadata of the room). Every field is
 * checked here: the browser asked for it, the host decides what the worker is told.
 *   sessionId  the session the words go to, or null (a call without a thread)
 *   kyberId / roleId  the team and the member, or null
 *   name       the member's name, to speak as, or null
 *   mode       'voice' (no face) unless 'video' was asked
 *   language   'auto' (follow the speaker) or a language code
 *   voice      the member's voice on the app's voice engine: { engine, voice, lang }; { custom: true, id } for a
 *              recording (the host swaps it for its clone at the provider when it has one); or null (the default voice)
 *   brain      'session' when the answer spoken is the session's own (the host feeds the worker with it),
 *              'voice' when it is the worker's small model (no session, or no feed): `sessionBrain` says
 *              whether this host can feed a call
 */
export function callMetadata (asked, { sessionBrain = false } = {}) {
  const a = (asked !== null && asked !== undefined && typeof asked === 'object') ? asked : {}
  const id = (v) => { const t = str(v); return (t !== null && ID_RE.test(t)) ? t : null }
  const sessionId = str(a.sessionId)
  const name = str(a.name) === null ? '' : String(a.name).replace(CONTROL, ' ').trim().slice(0, 60)
  const language = str(a.language) === null ? 'auto' : String(a.language).trim()
  const session = (sessionId !== null && SESSION_RE.test(sessionId)) ? sessionId : null
  const v = (a.voice !== null && typeof a.voice === 'object') ? a.voice : null
  let voice = null
  if (v !== null && v.custom === true) voice = (str(v.id) !== null && ID_RE.test(v.id)) ? { custom: true, id: v.id } : { custom: true }
  else if (v !== null && str(v.engine) !== null && ENGINE_RE.test(v.engine) && str(v.voice) !== null && VOICE_RE.test(v.voice)) {
    voice = { engine: v.engine, voice: v.voice, lang: (str(v.lang) !== null && /^[A-Za-z]{2}/.test(v.lang)) ? v.lang.slice(0, 2).toLowerCase() : '' }
  }
  return {
    sessionId: session,
    kyberId: id(a.kyberId),
    roleId: id(a.roleId),
    name: name === '' ? null : name,
    mode: a.mode === 'video' ? 'video' : 'voice',
    language: (language === 'auto' || LANG_RE.test(language)) ? language : 'auto',
    voice: voice,
    brain: (sessionBrain === true && session !== null) ? 'session' : 'voice'
  }
}

/**
 * deps (all optional, the defaults are the real ones):
 *   dshHome()  → the DSH folder (async)          execFile / spawn → child_process
 *   fetch      → global fetch                    env        → process.env
 *   pluginDir  → this bundle's folder           feed       → speech-feed.mjs (the session's replies)
 *   store      → call-store.mjs (the settings, the clones); without it a call uses the built-in defaults
 */
export function createCall (deps = {}) {
  const env = deps.env ?? process.env
  const dshHome = deps.dshHome ?? (async () => dshHomeSync(env))
  const execFile = deps.execFile ?? nodeExecFile
  const spawn = deps.spawn ?? nodeSpawn
  const doFetch = deps.fetch ?? ((...a) => globalThis.fetch(...a))
  const pluginDir = deps.pluginDir ?? dirname(fileURLToPath(import.meta.url))
  const feed = deps.feed ?? null
  const store = deps.store ?? null

  // ── The secrets, and the LiveKit room token ────────────────────────────────
  // Secrets do NOT go in `settings.json` (readable by the client and the settings screen): a
  // separate file, chmod 600, of which we only say "set" or "missing". The LiveKit access token
  // is an HS256 JWT (the protocol's format), so `node:crypto` is enough, no dependency.

  /** The secrets file, or `null` when it is not there (never a hard error). */
  const readSecrets = async () => {
    try {
      const home = await dshHome()
      if (typeof home !== 'string' || home.length === 0) return null
      const text = readFileSync(join(home, ENV_REL), 'utf8')
      const out = {}
      for (const line of String(text).split(/\r?\n/)) {
        const m = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line)
        if (m === null) continue
        out[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')
      }
      if (typeof out.LIVEKIT_URL !== 'string' || out.LIVEKIT_URL.length === 0) return null
      if (typeof out.LIVEKIT_API_KEY !== 'string' || out.LIVEKIT_API_KEY.length === 0) return null
      if (typeof out.LIVEKIT_API_SECRET !== 'string' || out.LIVEKIT_API_SECRET.length < 20) return null
      return out
    } catch (e) { return null }
  }
  const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  /** LiveKit access token: {exp, iss: API key, sub: identity, video: {...}}. */
  const accessToken = (secrets, args) => {
    const now = Math.floor(Date.now() / 1000)
    const askedTtl = (typeof args.ttlSeconds === 'number' && isFinite(args.ttlSeconds) === true) ? Math.round(args.ttlSeconds) : 7200
    // Clamped, not replaced: a requested duration is honoured when it makes sense, brought back
    // into the bounds otherwise, never silently ignored.
    const ttl = Math.min(Math.max(askedTtl, 60), 21600)
    const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    // An admin token never leaves the machine: it only serves the Twirp calls (waking the agent).
    // The client receives roomJoin only.
    const video = (args.admin === true)
      ? { room: String(args.room), roomAdmin: true, roomList: true }
      : { roomJoin: true, room: String(args.room), canPublish: true, canSubscribe: true, canPublishData: true }
    const payload = b64url(JSON.stringify({
      exp: now + ttl,
      iss: String(secrets.LIVEKIT_API_KEY),
      sub: String(args.identity),
      nbf: now - 10,
      jti: randomUUID(),
      name: String(args.identity),
      video: video
    }))
    const sig = b64url(createHmac('sha256', String(secrets.LIVEKIT_API_SECRET)).update(header + '.' + payload).digest())
    return { token: header + '.' + payload + '.' + sig, expiresIn: ttl }
  }

  /** What the client may know about the call chain: never a secret. */
  const status = async () => {
    const secrets = await readSecrets()
    return {
      ok: true,
      secrets: (secrets === null ? 'absente' : 'posee'),
      url: (secrets === null ? null : String(secrets.LIVEKIT_URL)),
      provider: (secrets === null || typeof secrets.LIVEAVATAR_API_KEY !== 'string' || secrets.LIVEAVATAR_API_KEY.length === 0) ? 'none' : 'liveavatar',
      avatar: (secrets === null || typeof secrets.LIVEAVATAR_AVATAR_ID !== 'string' ? null : String(secrets.LIVEAVATAR_AVATAR_ID)),
      sandbox: (secrets !== null && String(secrets.LIVEAVATAR_SANDBOX) === '1')
    }
  }

  // ── The call agent: a LiveKit worker started by the host ───────────────────
  // It lives in this bundle (`agent/agent.py`), reads the machine's secrets, and receives its room
  // by explicit dispatch. The text it hears goes back to the session through `utterance` below.
  const run = (cmd, argv, options) => new Promise((resolve) => {
    const o = Object.assign({ timeout: 8000, maxBuffer: 4194304 }, (options !== null && typeof options === 'object') ? options : {})
    execFile(cmd, argv, o, (error, stdout, stderr) => resolve({ error: (error === null || error === undefined) ? null : error, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') }))
  })
  const logPath = async () => {
    const home = await dshHome()
    if (typeof home !== 'string' || home.length === 0) return null
    return join(home, 'kybernos', 'logs', 'appel-agent.log')
  }
  /** Twirp calls speak https, never wss. */
  const twirp = async (secrets, service, method, body, token) => {
    const base = String(secrets.LIVEKIT_URL).replace(/^wss:/, 'https:').replace(/^ws:/, 'http:')
    try {
      const res = await doFetch(base + '/twirp/' + service + '/' + method, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(10000)
      })
      const text = await res.text()
      let payload = null
      try { payload = JSON.parse(text) } catch (e) { payload = null }
      return { status: res.status, payload: payload, text: text.slice(0, 200) }
    } catch (e) { return { status: 0, payload: null, text: errText(e) } }
  }
  /**
   * Wakes the agent on THIS room, never twice: a single send. `metadata` is who the call is with: the
   * worker serves many rooms, so it must come with each room, not with the process.
   */
  const dispatch = async (secrets, room, metadata) => {
    const admin = accessToken(secrets, { room: room, identity: 'kybernos-host', ttlSeconds: 600, admin: true })
    const r = await twirp(secrets, 'livekit.AgentDispatchService', 'CreateDispatch', { room: room, agent_name: AGENT_NAME, metadata: JSON.stringify(metadata ?? {}) }, admin.token)
    if (r.status === 200) return { ok: true }
    const code = (r.payload !== null && typeof r.payload.code === 'string') ? r.payload.code : ('HTTP ' + String(r.status))
    return { ok: false, error: code, detail: (r.payload !== null && typeof r.payload.msg === 'string') ? String(r.payload.msg).slice(0, 160) : r.text }
  }
  /** The agent's interpreter: the dedicated venv, never the system python. */
  const venvPython = async () => {
    const home = await dshHome()
    if (typeof home !== 'string' || home.length === 0) return null
    const p = join(home, 'kybernos', 'appel-venv', 'bin', 'python')
    try { return existsSync(p) === true ? p : null } catch (e) { return null }
  }
  const agentScript = () => join(pluginDir, 'agent', 'agent.py')
  const agentPid = async () => {
    const r = await run('pgrep', ['-f', agentScript()])
    const pid = Number(String(r.stdout).trim().split(/\s+/)[0])
    return (Number.isInteger(pid) === true && pid > 0) ? pid : null
  }
  const agentState = async () => {
    const pid = await agentPid()
    const python = await venvPython()
    const log = await logPath()
    let last = null
    try {
      if (log !== null && existsSync(log) === true) {
        const lines = String(readFileSync(log, 'utf8')).trim().split(/\r?\n/)
        last = (lines.length > 0) ? String(lines[lines.length - 1]).slice(0, 200) : null
      }
    } catch (e) { last = null }
    return { ok: true, running: pid !== null, pid: pid, python: (python === null ? null : 'appel-venv'), log: log, last: last }
  }
  /** Waits for the worker to be REGISTERED (log), so we never dispatch into the void. */
  const waitRegistered = async (from, budgetMs) => {
    const log = await logPath()
    if (log === null) return false
    const end = Date.now() + budgetMs
    while (Date.now() < end) {
      try {
        const tail = String(readFileSync(log, 'utf8')).slice(typeof from === 'number' ? from : 0)
        if (/registered worker/i.test(tail) === true) return true
      } catch (e) { /* not written yet */ }
      await new Promise((resolve) => setTimeout(resolve, 400))
    }
    return false
  }
  const agentStart = async () => {
    const already = await agentPid()
    if (already !== null) return { ok: true, running: true, pid: already, already: true, depart: 0 }
    const python = await venvPython()
    if (python === null) return { ok: false, running: false, error: 'call venv missing (<DSH_HOME>/kybernos/appel-venv)' }
    const home = await dshHome()
    if (typeof home !== 'string' || home.length === 0) return { ok: false, running: false, error: 'DSH home not found' }
    const log = await logPath()
    // The worker's output goes to this file; the host reads it to know the worker REGISTERED.
    try { mkdirSync(dirname(log), { recursive: true }) } catch (e) { /* the open below says so */ }
    let from = 0
    try { from = statSync(log).size } catch (e) { from = 0 }
    let fd = null
    try { fd = openSync(log, 'a') } catch (e) { fd = null }
    // Nothing about a call in the environment: the worker outlives the call that started it.
    const childEnv = Object.assign({}, env, { DSH_HOME: home })
    return await new Promise((resolve) => {
      const done = (answer) => {
        if (fd !== null) { try { closeSync(fd) } catch (e) { /* already closed */ } fd = null }
        resolve(answer)
      }
      try {
        // `start`: the production worker. Without a subcommand LiveKit Agents' CLI prints its
        // help and exits (measured). Detached with its output in the log: the worker outlives its
        // parent, intended. (child_process.execFile ignores `detached` and `stdio`: it would pipe
        // the output into memory, leave the log empty, and die with a 1 MB buffer.)
        const child = spawn(python, [agentScript(), 'start'], {
          detached: true,
          cwd: join(pluginDir, 'agent'),
          env: childEnv,
          stdio: (fd === null) ? 'ignore' : ['ignore', fd, fd]
        })
        child.once('error', (e) => done({ ok: false, running: false, error: errText(e) }))
        child.once('spawn', () => {
          try { child.unref() } catch (e) { /* nothing to detach from */ }
          done({ ok: true, running: true, pid: child.pid ?? null, started: true, depart: from })
        })
      } catch (e) { done({ ok: false, running: false, error: errText(e) }) }
    })
  }
  const agentStop = async () => {
    const pid = await agentPid()
    if (pid === null) return { ok: true, running: false, stopped: null }
    await run('kill', [String(pid)])
    return { ok: true, running: false, stopped: pid }
  }

  /** A room token for the browser: the client gets it, the agent forges the same. */
  const mint = async (body) => {
    const secrets = await readSecrets()
    if (secrets === null) return { ok: false, error: 'LiveKit secrets missing' }
    const asked = (body !== null && body !== undefined && typeof body === 'object') ? body : {}
    const askedRoom = str(asked.room)
    const room = (askedRoom !== null && ROOM_RE.test(String(askedRoom)) === true) ? String(askedRoom) : ('kyber-appel-' + Date.now().toString(36))
    const askedIdentity = str(asked.identity)
    const identity = (askedIdentity !== null && String(askedIdentity).trim().length >= 1 && String(askedIdentity).trim().length <= 64) ? String(askedIdentity).trim() : ('moi-' + randomUUID().slice(0, 8))
    const token = accessToken(secrets, { room: room, identity: identity, ttlSeconds: asked.ttlSeconds })
    // What the user set in the settings fills in what the surface that opened the call did not say.
    const settings = store !== null ? await store.readSettings() : null
    const wanted = Object.assign({}, asked)
    if (settings !== null) {
      if (str(asked.language) === null || asked.language === 'auto') wanted.language = settings.language
      if (asked.mode !== 'voice' && asked.mode !== 'video') wanted.mode = settings.mode
      if ((asked.voice === null || asked.voice === undefined) && str(asked.roleId) === null && settings.defaultVoice !== null) wanted.voice = settings.defaultVoice
    }
    const meta = callMetadata(wanted, { sessionBrain: feed !== null })
    if (settings !== null) meta.limits = { silenceMs: settings.silenceMinutes * 60000, maxMs: settings.maxMinutes * 60000 }
    // A recording that was cloned at the provider is spoken with its clone; one that was not, with the default voice.
    if (meta.voice !== null && meta.voice.custom === true && store !== null && meta.voice.id !== undefined) {
      const clone = (await store.readClones())[meta.voice.id]
      meta.voice = clone !== undefined ? { custom: true, remote: { provider: clone.provider, id: clone.remoteId } } : { custom: true }
    }
    // A call is three things: a room, a token, and a woken agent. The agent is started on the first
    // call and left alive; the explicit dispatch keeps it from entering a room by accident. An agent
    // failure does not refuse the call: the human can speak alone, and the answer says so
    // (`agent.dispatched: false`) instead of lying by omission.
    const agent = { running: false, dispatched: false }
    if (asked.agent !== false) {
      const started = await agentStart()
      agent.running = started.running === true
      if (typeof started.error === 'string') agent.error = started.error
      if (agent.running === true) {
        agent.ready = await waitRegistered(started.depart, 12000)
        // The session's replies are kept for this room from the moment the worker is woken.
        if (meta.brain === 'session') feed.register(room, meta.sessionId)
        const sent = await dispatch(secrets, room, meta)
        agent.dispatched = sent.ok === true
        if (sent.ok !== true) {
          agent.dispatchError = sent.error
          if (typeof sent.detail === 'string') agent.dispatchDetail = sent.detail
          if (feed !== null) feed.unregister(room)
        }
      }
    }
    return { ok: true, url: String(secrets.LIVEKIT_URL), room: room, identity: identity, token: token.token, expiresIn: token.expiresIn, agent: agent, meta: meta }
  }

  // ── What is heard enters the session as a REAL turn ────────────────────────
  /** `dsh-auth-*` cookie signed with the machine's persisted browser secret. */
  const sessionCookie = async () => {
    const home = await dshHome()
    if (typeof home !== 'string' || home.length === 0) return null
    let raw = null
    try { raw = readFileSync(join(home, '.credentials.yaml'), 'utf8') } catch (e) { return null }
    const at = String(raw).indexOf('client-connection/browser-session')
    if (at < 0) return null
    const m = String(raw).slice(at).match(/secret:\s*(\S+)/)
    if (m === null) return null
    const secret = Buffer.from(m[1].replaceAll('-', '+').replaceAll('_', '/'), 'base64')
    if (secret.byteLength !== 32) return null
    const authority = '127.0.0.1:' + String(env.DSH_WEB_PORT ?? '3080')
    const now = Date.now()
    const body = b64url(Buffer.from(JSON.stringify({ version: 1, authority: authority, issuedAt: now, expiresAt: now + 86400000 }), 'utf8'))
    const sig = b64url(createHmac('sha256', secret).update(body).digest())
    return { cookie: 'dsh-auth-' + b64url(createHash('sha256').update(authority).digest()) + '=v1.' + body + '.' + sig, base: 'http://' + authority }
  }
  /** A local RPC: same envelope and same cookie as `dsh-relance.mjs`. */
  const rpc = async (auth, method, args) => {
    try {
      const res = await doFetch(auth.base + '/api/' + method, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: auth.cookie, origin: auth.base, 'sec-fetch-site': 'same-origin' },
        body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method: method, payload: { args: args } }),
        signal: AbortSignal.timeout(15000)
      })
      const text = await res.text()
      let payload = null
      try { payload = JSON.parse(text) } catch (e) { payload = null }
      if (res.status !== 200) return { ok: false, error: 'HTTP ' + String(res.status), detail: text.slice(0, 160) }
      const result = (payload !== null && payload.result !== undefined) ? payload.result : null
      if (result !== null && result.ok === false) return { ok: false, error: String((result.error ?? {}).code ?? 'rpc'), detail: String((result.error ?? {}).message ?? '').slice(0, 160) }
      return { ok: true, value: (result === null ? null : result.value) }
    } catch (e) { return { ok: false, error: errText(e) } }
  }
  /** A text said on the call becomes a turn of the targeted session. */
  const utterance = async (body) => {
    const asked = (body !== null && body !== undefined && typeof body === 'object') ? body : {}
    const sessionId = str(asked.sessionId)
    if (sessionId === null || SESSION_RE.test(String(sessionId)) === false) return { ok: false, error: 'unknown session' }
    const text = str(asked.text)
    if (text === null || String(text).trim().length === 0) return { ok: false, error: 'text required' }
    if (String(text).length > 4000) return { ok: false, error: 'text too long (4000 characters max)' }
    const mode = (str(asked.mode) === 'steer') ? 'steer' : 'queue'
    const auth = await sessionCookie()
    if (auth === null) return { ok: false, error: 'session cookie unavailable' }
    const sent = await rpc(auth, 'session/prompt', { request: { requestId: randomUUID(), sessionId: String(sessionId), mode: mode, content: [{ type: 'text', text: String(text).trim() }] } })
    if (sent.ok !== true) return { ok: false, error: sent.error, detail: sent.detail ?? null }
    return { ok: true, accepted: (sent.value !== null && sent.value !== undefined && sent.value.accepted === true), sessionId: String(sessionId), mode: mode }
  }

  /** Is the LiveKit server there, and does it accept this key and secret? A read-only call (list the rooms). */
  const testLiveKit = async () => {
    const secrets = await readSecrets()
    if (secrets === null) return { ok: false, service: 'LiveKit', error: 'the LiveKit address, key and secret are not all set' }
    const admin = accessToken(secrets, { room: 'kybernos-test', identity: 'kybernos-host', ttlSeconds: 60, admin: true })
    const r = await twirp(secrets, 'livekit.RoomService', 'ListRooms', {}, admin.token)
    if (r.status === 200) return { ok: true, service: 'LiveKit' }
    if (r.status === 401 || r.status === 403) return { ok: false, service: 'LiveKit', error: 'LiveKit refused the key or the secret' }
    if (r.status === 0) return { ok: false, service: 'LiveKit', error: 'LiveKit is unreachable: ' + r.text }
    return { ok: false, service: 'LiveKit', error: 'LiveKit answered HTTP ' + String(r.status) }
  }

  return { readSecrets, accessToken, status, mint, agentStart, agentStop, agentState, utterance, sessionCookie, agentScript, testLiveKit }
}
