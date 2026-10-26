// kybernos-mobile: the remote half that runs on the computer. It pairs phones, keeps one outbound connection to the
// Kybernos relay per phone, and answers what a phone asks by replaying it against this DSH, end to end encrypted.
//
// It owns no network listener: the only sockets are the relay's (outbound) and DSH's own loopback page. Everything it
// needs from the outside is injected (`deps`), so the whole thing runs in a test with a fake relay and a fake server:
//
//   deps.dir        folder for the identity and the paired phones (0600 files)
//   deps.cloud()    the kybernos-cloud seam `{ call(path, { method, body }) }` or null; the account token never reaches us
//   deps.WebSocket  a WebSocket client class (the global one in Node >= 22)
//   deps.fetch      fetch, used for the local DSH
//   deps.local()    `{ base, cookie }` to reach this DSH's own page, or null while its port is unknown
//   deps.label()    this computer's name, shown on the phone
//
// What the person controls: pairing (a QR code, a 4-digit check, an approval on this screen), the list of phones, and
// revoking one (here and, as far as the server answers, there).
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as e2e from './remote-e2e.mjs'

export const REMOTE_TUNING = Object.freeze({
  verifyMs: 120000, // how long a 4-digit check may wait for the person
  retryMinMs: 2000,
  retryMaxMs: 60000,
  entitlementRetryMs: 10 * 60 * 1000,
  chunkBytes: 48 * 1024,
  maxInflight: 48,
  maxBodyBytes: 32 * 1024 * 1024,
  maxDevices: 8,
  highWater: 512 * 1024, // what may wait in the computer's socket: small answers queue behind at most this much
})

// ── what a phone may not ask for ─────────────────────────────────────────────────────────────────────────────────
// The phone has the power of the keyboard (it can talk to the agent, which can run commands under DSH's own approvals).
// What it must NOT reach is the machinery that changes who can reach this computer or what it trusts: a stolen phone
// must not be able to add another phone, change the server, install a plugin or rewrite a credential.
export const DENY_API = new Set([
  'credentials/set', 'credentials/unset',
  'settings/mutate', 'settings/replace', 'settings/update', 'settings/openSettingsDocument',
  'pluginManager/installBundle', 'pluginManager/removeBundle', 'pluginManager/setBundleEnabled', 'pluginManager/setPluginEnabled', 'pluginManager/setVersionExemption',
  'dynamicCordisRunner/invoke', 'dynamicCordisRunner/runHostHalf', 'dynamicCordisRunner/undefineFromPanel',
  'terminal/create', 'terminal/write',
  'account/startSignIn', 'account/signOut',
  'schedule/schedule', 'schedule/update',
])
export const DENY_PREFIX = ['/kybernos-mobile/remote/', '/kybernos-cloud/disconnect', '/kybernos-cloud/server/apply', '/kybernos-cloud/start']
// The lists are judged in one folded form (see `judgedForm`), so they are compared folded too.
const DENY_API_FOLDED = new Set([...DENY_API].map((name) => name.toLowerCase()))
const DENY_PREFIX_FOLDED = DENY_PREFIX.map((prefix) => prefix.toLowerCase())

/**
 * The one form a path is judged in: percent-escapes decoded (as often as they nest), case folded, dot segments resolved, slashes merged,
 * no trailing slash. It over-approximates whatever DSH's router makes of a path, so a variant the router would read as a listed route
 * is judged as that route. `null` when the path cannot be reduced safely (an escape that does not decode, a control character or a
 * backslash once decoded, escapes nested more than three deep).
 */
function judgedForm (pathname) {
  let p = pathname
  for (let round = 0; round < 3 && /%[0-9a-f]{2}/iu.test(p); round += 1) {
    try { p = decodeURIComponent(p) } catch (e) { return null }
  }
  if (/%[0-9a-f]{2}/iu.test(p) || /[\u0000-\u001f\u007f\\]/u.test(p)) return null
  const kept = []
  for (const segment of p.toLowerCase().split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') kept.pop()
    else kept.push(segment)
  }
  return '/' + kept.join('/')
}

/**
 * The path as it will be sent: what a URL parser makes of it (dot segments and escaped dots resolved, a tab or a fragment dropped), with the query kept.
 * `fetch` and the WebSocket client do this to `base + path` anyway, AFTER the lists have looked at the raw text, so the judgement and the request
 * must both use this form (L3-10: `/./api/credentials/set` was judged as written and sent as `/api/credentials/set`). `null` when it does not parse.
 */
export function sentPath (path) {
  try { const u = new URL(path, 'http://phone.invalid'); return u.pathname + u.search } catch (e) { return null }
}

/**
 * `null` when the request may go through, else the reason.
 *
 * What is judged is what is sent: the lists look at `sentPath(path)`, in the folded form of `judgedForm`, and `serveRequest` and `openLocalSocket`
 * send `sentPath(path)`, not the raw text.
 */
export function refusedOnPhone (method, path) {
  if (typeof path !== 'string' || path[0] !== '/' || path.startsWith('//') || /[\r\n\0\\]/u.test(path)) return 'bad_path'
  if (['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].indexOf(method) < 0) return 'bad_method'
  const sent = sentPath(path)
  if (sent === null) return 'bad_path'
  const folded = judgedForm(sent.split('?')[0])
  if (folded === null) return 'bad_path'
  for (const prefix of DENY_PREFIX_FOLDED) { if ((folded + '/').startsWith(prefix)) return 'refused_on_phone' }
  const [root, service, name] = folded.split('/').slice(1)
  if (root === 'api' && DENY_API_FOLDED.has(service + '/' + name)) return 'refused_on_phone'
  return null
}

const DROP_REQUEST = new Set(['host', 'origin', 'referer', 'cookie', 'connection', 'content-length', 'transfer-encoding', 'upgrade', 'accept-encoding', 'authorization', 'proxy-authorization', 'x-kybernos-tunnel', 'keep-alive', 'te'])
export function pickRequestHeaders (headers) {
  const out = {}
  if (headers === null || typeof headers !== 'object') return out
  let n = 0
  for (const [k, v] of Object.entries(headers)) {
    const key = String(k).toLowerCase()
    if (n >= 40 || typeof v !== 'string' || v.length > 4096 || DROP_REQUEST.has(key) || key.startsWith('sec-') || /[^a-z0-9-]/u.test(key)) continue
    out[key] = v
    n += 1
  }
  return out
}
const KEEP_RESPONSE = new Set(['content-type', 'content-disposition', 'cache-control', 'etag', 'last-modified', 'location', 'content-range', 'accept-ranges', 'vary', 'expires'])
export function pickResponseHeaders (headers) {
  const out = {}
  headers.forEach((v, k) => { const key = k.toLowerCase(); if (KEEP_RESPONSE.has(key) || key.startsWith('x-dsh-')) out[key] = v })
  return out
}
const COMPRESSIBLE = /^(text\/|application\/(json|javascript|x-javascript|xml|wasm|manifest\+json)|image\/svg)/iu
export const shouldCompress = (contentType) => typeof contentType === 'string' && COMPRESSIBLE.test(contentType)

// ── files ────────────────────────────────────────────────────────────────────────────────────────────────────────
function readJson (file, fallback) {
  try { const v = JSON.parse(readFileSync(file, 'utf8')); return v !== null && typeof v === 'object' ? v : fallback } catch (e) { return fallback }
}
function writeJson (file, value) {
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  try { chmodSync(tmp, 0o600) } catch (e) { /* exotic filesystem */ }
  renameSync(tmp, file)
}
const cleanLabel = (v, fallback) => {
  const s = typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, 60) : ''
  return s === '' ? fallback : s
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const te = new TextEncoder()
const td = new TextDecoder()

// ── the manager ──────────────────────────────────────────────────────────────────────────────────────────────────
export function createRemote (deps) {
  const T = Object.assign({}, REMOTE_TUNING, deps.tuning || {})
  const log = typeof deps.log === 'function' ? deps.log : () => {}
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now()
  const identityFile = () => join(deps.dir, 'identity.json')
  const devicesFile = () => join(deps.dir, 'devices.json')
  const settingsFile = () => join(deps.dir, 'settings.json')

  let running = false
  // The one switch of the screen (decision of 2026-10-22): ON by default, which means « ready to pair » and nothing more. No phone can reach this computer until one is linked
  // (a QR code, a 4-digit check, the person's OK), and OFF cuts every link and refuses new pairings. It is kept on disk, so a restart keeps it.
  let enabled = true
  let hostId = null
  let devices = []
  let pairing = null // the link of a pairing in progress
  const links = new Map() // sid -> link (devices and the pairing)
  let entitled = null // true | false | null (unknown)
  let signedIn = null
  let serverMaxDevices = null
  /** Whether the server offers the phone link at all (`configured` of `GET /v1/remote/devices`); null: not asked yet. */
  let serverConfigured = null
  let lastProbe = 0
  let refused = 0
  let lastError = null
  const listeners = new Set()
  const changed = () => { for (const f of listeners) { try { f() } catch (e) { /* a listener must not stop the others */ } } }

  const computerLabel = () => { try { return cleanLabel(deps.label(), 'Computer') } catch (e) { return 'Computer' } }
  const cloud = () => { try { return deps.cloud() } catch (e) { return null } }
  /** The server a failed call names (label, host, whether another one could be chosen), cut to what the page may show; null when the seam named none. */
  const cleanServer = (v) => {
    if (v === null || typeof v !== 'object') return null
    const text = (x) => (typeof x === 'string' ? x.replace(/[\u0000-\u001f\u007f]/gu, ' ').trim().slice(0, 80) : '')
    const out = { name: text(v.name), host: text(v.host), can_switch: v.can_switch === true }
    return out.name === '' && out.host === '' ? null : out
  }
  const call = async (path, options) => {
    const c = cloud()
    if (c === null || c === undefined || typeof c.call !== 'function') return { status: 0, body: null, error: 'not_connected' }
    try { return await c.call(path, options) } catch (e) { return { status: 0, body: null, error: String((e && e.message) || e) } }
  }
  const noteEntitlement = (r) => {
    if (r.error === 'not_connected') { signedIn = false; return }
    signedIn = true
    const before = entitled
    if (r.status === 403 && r.body !== null && typeof r.body === 'object' && r.body.error === 'remote_not_in_plan') entitled = false
    else if (r.status >= 200 && r.status < 300) entitled = true
    if (entitled !== before) lastProbe = 0 // the plan changed: the next status asks again, whatever the last minute said
  }

  // One cheap read tells the settings page whether the plan includes the phone link BEFORE the person asks for a QR code.
  async function probe () {
    if (!running || cloud() === null) return
    if (lastProbe > 0 && now() - lastProbe < 60000) return
    lastProbe = now()
    const r = await call('/v1/remote/devices', { method: 'GET' })
    noteEntitlement(r)
    if (r.status === 200 && r.body !== null && typeof r.body === 'object') {
      if (typeof r.body.configured === 'boolean') serverConfigured = r.body.configured
      if (typeof r.body.entitled === 'boolean') entitled = r.body.entitled
      if (Number.isInteger(r.body.max_devices) && r.body.max_devices >= 0) serverMaxDevices = r.body.max_devices
    }
  }

  async function loadIdentity () {
    if (hostId !== null) return hostId
    mkdirSync(deps.dir, { recursive: true, mode: 0o700 })
    const stored = readJson(identityFile(), null)
    if (stored !== null && stored.priv !== undefined && typeof stored.pub === 'string') {
      try { hostId = await e2e.importIdentity(stored); return hostId } catch (e) { log('identity unreadable, making a new one') }
    }
    hostId = await e2e.newIdentity(true)
    writeJson(identityFile(), await e2e.exportIdentity(hostId))
    return hostId
  }
  const loadDevices = () => {
    const f = readJson(devicesFile(), { devices: [] })
    devices = Array.isArray(f.devices) ? f.devices.filter((d) => d !== null && typeof d === 'object' && typeof d.id === 'string' && typeof d.sid === 'string' && typeof d.phoneId === 'string') : []
  }
  const loadSettings = () => {
    const f = readJson(settingsFile(), {})
    enabled = f === null || typeof f !== 'object' || f.enabled !== false
  }
  const saveSettings = () => { try { mkdirSync(deps.dir, { recursive: true, mode: 0o700 }); writeJson(settingsFile(), { v: 1, enabled }) } catch (e) { log('settings not saved: ' + e.message) } }
  const saveDevices = () => { try { mkdirSync(deps.dir, { recursive: true, mode: 0o700 }); writeJson(devicesFile(), { v: 1, devices }) } catch (e) { log('devices not saved: ' + e.message) } }

  // ── sending ──
  const rawSend = (link, data, binary) => {
    try { if (link.ws !== null && link.ws.readyState === 1) { link.ws.send(data); return true } } catch (e) { /* closed under us */ }
    return false
  }
  const sendJsonPlain = (link, obj) => rawSend(link, te.encode(JSON.stringify(obj)), true) // handshake: binary JSON
  /** One frame to the phone. The frames of a link leave ONE AT A TIME, in the order they were asked: the phone requires the
   *  counter of each frame to be exactly the next one, so a frame that is sealed first and sent last desynchronises the
   *  channel for good (every later frame is then dropped by the phone: measured 2026-10-13, a page that never loaded on a
   *  phone while the computer's uplink was slower than the answers). The wait for a backed-up socket is therefore inside
   *  the queue and BEFORE the seal: a request that arrives while the socket drains does not overtake the ones waiting. */
  function sendFrame (link, header, body) {
    const run = async () => {
      if (link.channel === null) return false
      // do not let a slow uplink pile up megabytes in memory, nor put a small answer behind them
      for (let i = 0; i < 1200 && link.ws !== null && link.ws.bufferedAmount > T.highWater; i += 1) await sleep(25)
      if (link.channel === null) return false
      return rawSend(link, await link.channel.seal(e2e.packFrame(header, body)), true)
    }
    const turn = (link.sendTail || Promise.resolve()).then(run, run)
    link.sendTail = turn.catch(() => false)
    return turn
  }

  // ── serving the phone ──
  async function serveRequest (link, h, body) {
    const id = String(h.id)
    const method = String(h.method || 'GET').toUpperCase()
    const refuse = async (status, code) => {
      await sendFrame(link, { t: 'res', id, status, headers: { 'content-type': 'application/json' } })
      await sendFrame(link, { t: 'chunk', id }, te.encode(JSON.stringify({ ok: false, error: code })))
      await sendFrame(link, { t: 'end', id })
    }
    const why = refusedOnPhone(method, h.path)
    if (why !== null) { refused += 1; changed(); return refuse(why === 'refused_on_phone' ? 403 : 400, why) }
    if (link.reqs.size >= T.maxInflight) return refuse(429, 'too_many_requests')
    if (body.length > T.maxBodyBytes) return refuse(413, 'too_large')
    const lo = (() => { try { return deps.local() } catch (e) { return null } })()
    if (lo === null || lo === undefined) return refuse(503, 'local_unavailable')
    const ctrl = new AbortController()
    link.reqs.set(id, ctrl)
    let headSent = false
    try {
      const headers = pickRequestHeaders(h.headers)
      headers.cookie = lo.cookie
      headers.origin = lo.base
      headers.host = new URL(lo.base).host
      headers['x-kybernos-tunnel'] = '1' // every guarded write refuses this marker (session-guard.mjs): a phone has the keyboard, not the machinery
      const res = await deps.fetch(lo.base + sentPath(h.path), { method, headers, body: method === 'GET' || method === 'HEAD' || body.length === 0 ? undefined : body, redirect: 'manual', signal: ctrl.signal })
      const outHeaders = pickResponseHeaders(res.headers)
      if (typeof outHeaders.location === 'string' && outHeaders.location.startsWith(lo.base)) outHeaders.location = outHeaders.location.slice(lo.base.length) || '/'
      const noBody = res.status === 204 || res.status === 304 || method === 'HEAD' || res.body === null
      const gz = !noBody && shouldCompress(outHeaders['content-type']) && typeof CompressionStream === 'function'
      await sendFrame(link, { t: 'res', id, status: res.status, headers: outHeaders, enc: gz ? 'gzip' : undefined })
      headSent = true
      if (!noBody) {
        const stream = gz ? res.body.pipeThrough(new CompressionStream('gzip')) : res.body
        for await (const chunk of stream) {
          for (let i = 0; i < chunk.length; i += T.chunkBytes) {
            if (ctrl.signal.aborted) throw new Error('aborted')
            await sendFrame(link, { t: 'chunk', id }, chunk.subarray(i, i + T.chunkBytes))
          }
        }
      }
      await sendFrame(link, { t: 'end', id })
    } catch (e) {
      if (!ctrl.signal.aborted) {
        // a head already went out (the local answer broke off mid-body): only close the request
        if (!headSent) {
          await sendFrame(link, { t: 'res', id, status: 502, headers: { 'content-type': 'application/json' } }).catch(() => {})
          await sendFrame(link, { t: 'chunk', id }, te.encode('{"ok":false,"error":"local_unavailable"}')).catch(() => {})
        }
        await sendFrame(link, { t: 'end', id }).catch(() => {})
      }
    } finally { link.reqs.delete(id) }
  }

  function openLocalSocket (link, h) {
    const id = String(h.id)
    const why = refusedOnPhone('GET', h.path)
    const target = why === null ? sentPath(h.path) : null
    const lo = (() => { try { return deps.local() } catch (e) { return null } })()
    if (why !== null || lo === null || lo === undefined || link.sockets.size >= T.maxInflight || typeof deps.WebSocket !== 'function' || !/^\/api\//u.test(String(target))) {
      void sendFrame(link, { t: 'ws-close', id, code: 1008 })
      return
    }
    let local = null
    try {
      const protocols = Array.isArray(h.protocols) ? h.protocols.filter((p) => typeof p === 'string' && /^[\w.+-]{1,64}$/u.test(p)).slice(0, 4) : []
      local = new deps.WebSocket(lo.base.replace(/^http/u, 'ws') + target, { protocols: protocols.length > 0 ? protocols : undefined, headers: { cookie: lo.cookie, origin: lo.base, 'x-kybernos-tunnel': '1' } })
      local.binaryType = 'arraybuffer'
    } catch (e) { void sendFrame(link, { t: 'ws-close', id, code: 1011 }); return }
    link.sockets.set(id, local)
    local.onopen = () => { void sendFrame(link, { t: 'ws-open', id, protocol: local.protocol || '' }) }
    local.onmessage = (ev) => {
      const d = ev.data
      if (typeof d === 'string') void sendFrame(link, { t: 'ws-msg', id, text: true }, te.encode(d))
      else void sendFrame(link, { t: 'ws-msg', id, text: false }, new Uint8Array(d))
    }
    local.onclose = (ev) => { link.sockets.delete(id); void sendFrame(link, { t: 'ws-close', id, code: ev && ev.code ? ev.code : 1006 }) }
    local.onerror = () => { /* the close event follows */ }
  }

  function dispatch (link, header, body) {
    switch (header.t) {
      case 'hello': link.phoneLabel = cleanLabel(header.label, 'Phone'); changed(); return
      case 'req': if (link.state === 'serving') void serveRequest(link, header, body); return
      case 'cancel': { const c = link.reqs.get(String(header.id)); if (c) c.abort(); return }
      case 'ws-open': if (link.state === 'serving') openLocalSocket(link, header); return
      case 'ws-msg': {
        const s = link.sockets.get(String(header.id))
        if (s && s.readyState === 1) { try { s.send(header.text === true ? td.decode(body) : body) } catch (e) { /* closed */ } }
        return
      }
      case 'ws-close': { const s = link.sockets.get(String(header.id)); if (s) { try { s.close(1000) } catch (e) { /* closed */ } } return }
      default: log('unknown frame ' + String(header.t).slice(0, 20))
    }
  }

  // ── a link = one relay connection for one sid ──
  function newLink (fields) {
    return Object.assign({
      sid: '', relayWs: '', ticket: '', deviceId: null, pairingId: null, code: null, expiresAt: 0,
      ws: null, up: false, peerUp: false, channel: null, state: 'connecting', sas: null, phoneIdPub: null, phoneLabel: null,
      reqs: new Map(), sockets: new Map(), retry: 0, timer: null, closed: false, error: null,
    }, fields)
  }

  function stopServing (link) {
    for (const c of link.reqs.values()) { try { c.abort() } catch (e) { /* done */ } }
    link.reqs.clear()
    for (const s of link.sockets.values()) { try { s.close(1000) } catch (e) { /* done */ } }
    link.sockets.clear()
    link.channel = null
  }

  function connect (link) {
    if (link.closed || typeof deps.WebSocket !== 'function') return
    let ws = null
    try { ws = new deps.WebSocket(link.relayWs) } catch (e) { scheduleRetry(link); return }
    ws.binaryType = 'arraybuffer'
    link.ws = ws
    ws.onopen = () => { try { ws.send(JSON.stringify({ t: 'auth', role: 'host', sid: link.sid, ticket: link.ticket })) } catch (e) { /* closing */ } }
    ws.onmessage = (ev) => { void onData(link, ev.data) }
    ws.onclose = () => {
      if (link.ws === ws) { link.ws = null; link.up = false; link.peerUp = false; stopServing(link) }
      if (link.closed) return
      // A pairing whose connection is lost is over (the QR code is single use anyway); a paired phone is retried.
      if (link.deviceId === null) { closeLink(link, 'relay_lost'); changed(); return }
      if (link.state === 'serving' || link.state === 'verify' || link.state === 'waiting') link.state = 'offline'
      changed()
      scheduleRetry(link)
    }
    ws.onerror = () => { /* the close event follows */ }
  }

  function scheduleRetry (link) {
    if (link.closed || !running) return
    link.retry = Math.min(T.retryMaxMs, Math.max(T.retryMinMs, link.retry * 2 || T.retryMinMs))
    clearTimeout(link.timer)
    link.timer = setTimeout(() => { void reopen(link) }, link.retry)
    if (typeof link.timer.unref === 'function') link.timer.unref()
  }

  async function reopen (link) {
    if (link.closed || !running || link.deviceId === null) return
    // The address of the channel goes with the request: the server keeps only its digest, so this is also what proves the caller made the channel.
    const r = await call('/v1/remote/devices/' + encodeURIComponent(link.deviceId) + '/ticket', { method: 'POST', body: { sid: link.sid } })
    noteEntitlement(r)
    if (r.status === 200 && r.body !== null && typeof r.body.host_ticket === 'string' && typeof r.body.relay_ws === 'string') {
      link.ticket = r.body.host_ticket
      link.relayWs = r.body.relay_ws
      connect(link)
      return
    }
    if (r.status === 404) { dropDevice(link.deviceId, 'server_forgot'); return }
    if (entitled === false) {
      link.state = 'locked'
      clearTimeout(link.timer)
      link.timer = setTimeout(() => { void reopen(link) }, T.entitlementRetryMs)
      if (typeof link.timer.unref === 'function') link.timer.unref()
      changed()
      return
    }
    scheduleRetry(link)
  }

  async function onData (link, data) {
    try {
      if (typeof data === 'string') { onControl(link, JSON.parse(data)); return }
      const u8 = new Uint8Array(data)
      if (u8.length > 0 && u8[0] === 0x7b) { await onHandshake(link, JSON.parse(td.decode(u8))); return }
      if (link.channel === null) return
      const { header, body } = e2e.unpackFrame(await link.channel.open(u8))
      dispatch(link, header, body)
    } catch (e) {
      log('frame refused: ' + String((e && e.message) || e).slice(0, 120))
      // a broken channel is dropped; the phone reconnects with a fresh handshake
      if (link.channel !== null && /e2e:/u.test(String((e && e.message) || e))) { stopServing(link); if (link.state === 'serving') link.state = 'waiting' }
    }
  }

  function onControl (link, m) {
    if (m.t === 'auth-ok') { link.up = true; link.retry = 0; if (link.state === 'connecting') link.state = 'waiting'; changed(); return }
    if (m.t === 'peer') {
      link.peerUp = m.state === 'up'
      if (!link.peerUp && link.state === 'serving') { stopServing(link); link.state = 'waiting' }
      changed()
      return
    }
    if (m.t === 'error') {
      link.error = String(m.code || 'relay_error').slice(0, 40)
      if (m.code === 'revoked' && link.deviceId !== null) dropDevice(link.deviceId, 'revoked_by_server')
      else if (m.code === 'not_in_plan') { entitled = false; link.state = 'locked' }
      changed()
    }
  }

  async function onHandshake (link, m) {
    if (hostId === null) return
    if (m.t === 'pair') {
      if (link.pairingId === null || link.state !== 'waiting' || now() > link.expiresAt) return
      const acc = await e2e.hostPairAccept(m, { sid: link.sid, code: link.code, hostId })
      link.code = null // one use
      link.channel = acc.channel
      link.sas = acc.sas
      link.phoneIdPub = acc.phoneIdPub
      link.state = 'verify'
      link.verifyUntil = now() + T.verifyMs
      clearTimeout(link.timer)
      link.timer = setTimeout(() => { void denyPairing('timeout') }, T.verifyMs)
      if (typeof link.timer.unref === 'function') link.timer.unref()
      sendJsonPlain(link, acc.reply)
      changed()
      return
    }
    if (m.t === 'resume') {
      if (link.deviceId === null) return
      const dev = devices.find((d) => d.id === link.deviceId)
      if (dev === undefined) return
      const r = await e2e.hostResumeAccept(m, { sid: link.sid, hostId, isKnown: (pub) => e2e.toB64u(pub) === dev.phoneId })
      stopServing(link)
      link.channel = r.channel
      link.state = 'serving'
      dev.lastSeenAt = now()
      saveDevices()
      sendJsonPlain(link, r.reply)
      await sendFrame(link, { t: 'ready', computer: computerLabel() })
      changed()
    }
  }

  function dropDevice (deviceId, why) {
    const link = [...links.values()].find((l) => l.deviceId === deviceId)
    if (link !== undefined) closeLink(link, why)
    const before = devices.length
    devices = devices.filter((d) => d.id !== deviceId)
    if (devices.length !== before) saveDevices()
    changed()
  }

  function closeLink (link, why) {
    link.closed = true
    clearTimeout(link.timer)
    if (link.channel !== null && link.ws !== null) { void sendFrame(link, { t: 'bye', reason: why || 'closed' }).catch(() => {}) }
    stopServing(link)
    const ws = link.ws
    link.ws = null
    if (ws !== null) setTimeout(() => { try { ws.close(1000) } catch (e) { /* gone */ } }, 80)
    links.delete(link.sid)
    if (pairing === link) pairing = null
  }

  // ── the person's gestures ──
  async function pair () {
    if (!running) return { ok: false, error: 'off' }
    if (!enabled) return { ok: false, error: 'disabled' }
    await loadIdentity()
    // The server's number is the authority (it answers 429); the local one is only a sanity bound, so that a stale answer of the last minute cannot refuse a plan that changed.
    if (devices.length >= T.maxDevices) return { ok: false, error: 'device_limit' }
    if (pairing !== null) await cancelPairing()
    const r = await call('/v1/remote/pairings', { method: 'POST', body: { label: computerLabel() } })
    noteEntitlement(r)
    if (r.status === 403) { changed(); return { ok: false, error: 'not_in_plan' } }
    if (r.status === 429) { changed(); return { ok: false, error: 'device_limit' } }
    if (r.status === 503) { serverConfigured = false; changed(); return { ok: false, error: 'not_offered' } }
    const b = r.body
    if (r.status !== 200 && r.status !== 201) {
      changed()
      if (r.error === 'not_connected') return { ok: false, error: 'not_connected' }
      // The server that does not answer is named, so the page can say WHICH one (and offer another) instead of a sentence that fits any server.
      const named = r.status === 0 ? cleanServer(r.server) : null
      return { ok: false, error: 'server_unavailable', ...(named !== null ? { server: named } : {}) }
    }
    if (b === null || typeof b.sid !== 'string' || typeof b.phone_url !== 'string' || typeof b.relay_ws !== 'string' || typeof b.host_ticket !== 'string' || typeof b.pairing_id !== 'string') return { ok: false, error: 'bad_server_answer' }
    const link = newLink({
      sid: b.sid, relayWs: b.relay_ws, ticket: b.host_ticket, pairingId: b.pairing_id, code: e2e.randomToken(16),
      expiresAt: Date.parse(b.expires_at) > now() ? Date.parse(b.expires_at) : now() + 5 * 60 * 1000,
      phoneUrl: b.phone_url,
    })
    link.url = e2e.pairingUrl(b.phone_url, b.sid, link.code, e2e.toB64u(hostId.pub))
    links.set(link.sid, link)
    pairing = link
    // a code nobody scanned is withdrawn when it expires (the server forgets it at the same moment)
    link.timer = setTimeout(() => { if (pairing === link && link.state !== 'verify') void cancelPairing() }, Math.max(1000, link.expiresAt - now() + 1000))
    if (typeof link.timer.unref === 'function') link.timer.unref()
    connect(link)
    changed()
    return { ok: true }
  }

  async function cancelPairing () {
    const link = pairing
    if (link === null) return { ok: true }
    const id = link.pairingId
    closeLink(link, 'cancelled')
    await call('/v1/remote/pairings/' + encodeURIComponent(id), { method: 'DELETE' })
    changed()
    return { ok: true }
  }

  async function denyPairing (why) {
    const link = pairing
    if (link === null) return { ok: false, error: 'no_pairing' }
    if (link.channel !== null) await sendFrame(link, { t: 'denied', reason: why || 'denied' }).catch(() => {})
    return cancelPairing()
  }

  async function approvePairing () {
    const link = pairing
    if (link === null || link.state !== 'verify' || link.channel === null) return { ok: false, error: 'no_pairing' }
    const label = cleanLabel(link.phoneLabel, 'Phone')
    const r = await call('/v1/remote/pairings/' + encodeURIComponent(link.pairingId) + '/confirm', { method: 'POST', body: { label } })
    noteEntitlement(r)
    if (r.status !== 200 && r.status !== 201) {
      await sendFrame(link, { t: 'denied', reason: 'server_refused' }).catch(() => {})
      await cancelPairing()
      return { ok: false, error: r.status === 403 ? 'not_in_plan' : 'server_refused' }
    }
    const deviceId = r.body !== null && typeof r.body.device_id === 'string' ? r.body.device_id : null
    if (deviceId === null) { await cancelPairing(); return { ok: false, error: 'bad_server_answer' } }
    clearTimeout(link.timer)
    devices.push({ id: deviceId, sid: link.sid, phoneId: e2e.toB64u(link.phoneIdPub), label, createdAt: now(), lastSeenAt: now() })
    saveDevices()
    link.deviceId = deviceId
    link.pairingId = null
    link.state = 'serving'
    pairing = null
    await sendFrame(link, { t: 'approved', computer: computerLabel() })
    changed()
    return { ok: true, device_id: deviceId }
  }

  async function revoke (deviceId) {
    const dev = devices.find((d) => d.id === deviceId)
    if (dev === undefined) return { ok: false, error: 'unknown_device' }
    dropDevice(deviceId, 'revoked')
    const r = await call('/v1/remote/devices/' + encodeURIComponent(deviceId), { method: 'DELETE' })
    return { ok: true, server: r.status >= 200 && r.status < 300 }
  }
  async function revokeAll () {
    const ids = devices.map((d) => d.id)
    let server = true
    for (const id of ids) { const r = await revoke(id); if (r.ok !== true || r.server !== true) server = false }
    if (pairing !== null) await cancelPairing()
    return { ok: true, revoked: ids.length, server }
  }

  // ── life cycle and view ──
  /** One link per linked phone, each reopening by itself: what makes a linked phone reachable. Nothing is opened for a phone twice. */
  async function openDeviceLinks () {
    if (devices.length > 0) await loadIdentity()
    for (const d of devices) {
      if (links.has(d.sid)) continue
      const link = newLink({ sid: d.sid, deviceId: d.id, state: 'connecting' })
      links.set(link.sid, link)
      void reopen(link)
    }
  }
  async function start () {
    if (running) return
    running = true
    try {
      // Nothing is written until the first pairing: a computer with no paired phone only reads two files.
      loadSettings()
      loadDevices()
      if (enabled) await openDeviceLinks()
    } catch (e) { lastError = String((e && e.message) || e); log('start failed: ' + lastError) }
    changed()
  }
  /** The switch. Off: the pairing in progress is withdrawn and every link is closed (the linked phones stay listed, offline, and come back when it is turned on). */
  async function setEnabled (on) {
    if (!running) return { ok: false, error: 'off' }
    const next = on === true
    if (next === enabled) return { ok: true, enabled }
    enabled = next
    saveSettings()
    try {
      if (enabled) await openDeviceLinks()
      else {
        if (pairing !== null) await cancelPairing()
        for (const link of [...links.values()]) closeLink(link, 'disabled')
        links.clear()
        pairing = null
      }
    } catch (e) { lastError = String((e && e.message) || e); log('switch failed: ' + lastError) }
    changed()
    return { ok: true, enabled }
  }
  function stop () {
    running = false
    for (const link of [...links.values()]) closeLink(link, 'stopped')
    links.clear()
    pairing = null
  }

  async function qrFor (url) {
    try {
      const mod = await import('./qr.mjs')
      const q = mod.encodeQr(url, { ecc: 'M' })
      return { size: q.size, modules: q.modules }
    } catch (e) { return null }
  }

  async function status () {
    try { await probe() } catch (e) { /* the status is still answered */ }
    const out = {
      ok: true,
      available: typeof deps.WebSocket === 'function',
      running,
      enabled,
      connected: signedIn,
      configured: serverConfigured,
      entitled,
      computer: computerLabel(),
      max_devices: serverMaxDevices !== null ? Math.min(serverMaxDevices, T.maxDevices) : T.maxDevices,
      relay: [...links.values()].some((l) => l.up) ? 'up' : (links.size > 0 ? 'down' : 'idle'),
      refused,
      error: lastError,
      pairing: null,
      devices: devices.map((d) => {
        const l = links.get(d.sid)
        return { id: d.id, label: d.label, created_at: d.createdAt, last_seen_at: d.lastSeenAt || null, online: l !== undefined && l.state === 'serving', state: l !== undefined ? l.state : 'offline' }
      }),
    }
    const p = pairing
    if (p !== null) {
      out.pairing = {
        state: p.state, // connecting | waiting | verify
        expires_at: p.expiresAt,
        qr: p.state === 'verify' ? null : await qrFor(p.url),
        url: p.state === 'verify' ? null : p.url,
        sas: p.state === 'verify' ? p.sas : null,
        phone_label: p.state === 'verify' ? cleanLabel(p.phoneLabel, 'Phone') : null,
        verify_until: p.state === 'verify' ? p.verifyUntil : null,
      }
    }
    return out
  }

  return {
    start, stop, status, setEnabled, pair, approve: approvePairing, deny: () => denyPairing('denied'), cancel: cancelPairing, revoke, revokeAll,
    onChange: (f) => { listeners.add(f); return () => listeners.delete(f) },
    __test: { links: () => links, devices: () => devices, hostId: () => hostId },
  }
}
