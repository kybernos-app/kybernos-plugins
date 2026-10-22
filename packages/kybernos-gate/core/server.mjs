// The gate: one HTTP server in front of DSH.
//
//   /__gate/*          the gate's own routes (sign-in page, login, logout, health)
//   anything else      proxied to DSH once the browser carries a valid gate session, otherwise sent to the sign-in page
//
// Why it exists: DSH serves plugin routes BEFORE its own authentication, so a hosted instance must put a real
// login in front of everything, and DSH itself only knows a launch token. After a good password the gate also
// gives the browser DSH's own session cookie (see dsh-session.mjs): one sign-in.
import http from 'node:http'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { verifyPassword } from './password.mjs'
import { SESSION_COOKIE, clearCookie, readCookie, serializeCookie, signSession, verifySession } from './session.mjs'
import { createLimiter } from './limiter.mjs'
import { createProxy } from './proxy.mjs'
import { pageCsp, pickLanguage, renderLogin, renderStarting, safeNext } from './page.mjs'
import { dshCookieName, mintDshCookie, readDshSecret } from './dsh-session.mjs'

const PREFIX = '/__gate/'
const MAX_BODY = 4096
const MAX_CONCURRENT_LOGINS = 8
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest()

/**
 * @param {Awaited<ReturnType<import('./config.mjs').loadConfig>>} config
 * @param {{ limiter?: ReturnType<typeof createLimiter>, log?: (line: string) => void, now?: () => number }} [deps]
 */
export function createGate (config, { limiter = createLimiter(), log = (line) => console.log(line), now = () => Date.now() } = {}) {
  const proxy = createProxy(config.upstream)
  const ttlMs = config.sessionDays * 86400000
  const userDigest = sha256(config.user)
  const attemptsInFlight = new Set()
  let activeLogins = 0
  let warnedDsh = false

  const firstValue = (header) => String(header ?? '').split(',')[0].trim()
  const isSecure = (req) => Boolean(req.socket.encrypted) || (config.trustProxy && firstValue(req.headers['x-forwarded-proto']).toLowerCase() === 'https')
  // Behind a trusted proxy the client is the LAST address it appended; the first ones are whatever the client claimed.
  const clientIp = (req) => {
    if (config.trustProxy && typeof req.headers['x-forwarded-for'] === 'string') {
      const parts = req.headers['x-forwarded-for'].split(',').map((s) => s.trim()).filter(Boolean)
      if (parts.length > 0) return parts[parts.length - 1]
    }
    return req.socket.remoteAddress ?? 'unknown'
  }
  const publicHost = (req) => (config.trustProxy && req.headers['x-forwarded-host'] ? firstValue(req.headers['x-forwarded-host']) : String(req.headers.host ?? '')).toLowerCase()

  /** A state-changing request must come from this very site: an Origin whose host is ours. */
  const originOk = (req) => {
    if (req.headers['sec-fetch-site'] === 'cross-site') return false
    if (typeof req.headers.origin !== 'string') return false
    try {
      const o = new URL(req.headers.origin)
      return (o.protocol === 'http:' || o.protocol === 'https:') && o.host.toLowerCase() === publicHost(req)
    } catch (e) { return false }
  }
  const isAuthed = (req) => verifySession(config.secret, readCookie(req.headers.cookie, SESSION_COOKIE), now()) !== null
  const isNavigation = (req) => (req.method === 'GET' || req.method === 'HEAD') && String(req.headers.accept ?? '').includes('text/html')

  const baseHeaders = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }
  const sendJson = (res, status, payload, extra = {}) => {
    const body = JSON.stringify(payload)
    res.writeHead(status, { ...baseHeaders, 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), ...extra })
    res.end(body)
  }
  const sendHtml = (res, status, html, nonce, extra = {}) => {
    res.writeHead(status, { ...baseHeaders, 'content-type': 'text/html; charset=utf-8', 'content-security-policy': pageCsp(nonce), 'x-frame-options': 'DENY', ...extra })
    res.end(html)
  }
  const sendText = (res, status, text, extra = {}) => {
    res.writeHead(status, { ...baseHeaders, 'content-type': 'text/plain; charset=utf-8', ...extra })
    res.end(text)
  }
  // A header value must be latin-1: a character above it (a hand-written `next`) is sent percent-encoded instead of throwing.
  const redirect = (res, location, extra = {}) => { res.writeHead(303, { ...baseHeaders, location: String(location).replace(/[^\x20-\x7e]/gu, (c) => encodeURIComponent(c)), ...extra }); res.end() }
  const nonce = () => randomBytes(16).toString('base64')
  // The sign-in page sends its own origin with the form post (no-referrer would make browsers send `Origin: null` there).
  const LOGIN_PAGE_HEADERS = { 'referrer-policy': 'same-origin' }

  const readBody = (req) => new Promise((resolve) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) { resolve(null); req.destroy(); return }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', () => resolve(null))
  })
  const readJson = async (req) => {
    const raw = await readBody(req)
    try { const v = JSON.parse(raw); return v !== null && typeof v === 'object' ? v : null } catch (e) { return null }
  }
  /** A plain form post (no script): `user` (or `username`) and `password`, the same shape the script sends as JSON. */
  const readForm = async (req) => {
    const raw = await readBody(req)
    if (raw === null) return null
    const form = new URLSearchParams(raw)
    // Trimmed like the page's script does (a phone keyboard often adds a trailing space after a user name).
    const user = form.get('user') ?? form.get('username')
    return { user: typeof user === 'string' ? user.trim() : user, password: form.get('password') }
  }

  /** The cookies of a signed-in browser: the gate's own session and, once, DSH's (one sign-in). */
  const signedInCookies = (req) => {
    const secure = isSecure(req)
    const cookies = [serializeCookie(SESSION_COOKIE, signSession(config.secret, { now: now(), ttlMs }), { maxAgeSeconds: Math.floor(ttlMs / 1000), secure })]
    if (config.dshSignIn) {
      const dsh = mintDshCookie({ secret: readDshSecret(config.dshHome), hostHeader: req.headers.host, now: now(), ttlMs, secure })
      if (dsh !== null) cookies.push(dsh.header)
      else if (!warnedDsh) { warnedDsh = true; log('[gate] DSH session secret unreadable: the user will meet DSH\'s own sign-in page') }
    }
    return cookies
  }

  /**
   * `GET /__gate/ticket?t=<link>`: the way into a cloud computer. The platform made the link when a person who may open this computer
   * asked to; the gate asks the platform, with the computer's own token, whether it is good (once, within a minute), and only then signs
   * the browser in. The answer is a page that navigates by script, not a redirect: the cookies are SameSite=Strict, and a redirect that
   * continues a cross-site navigation would be sent without them.
   */
  async function ticket (req, res, url) {
    if (config.ticket === null) return sendText(res, 404, 'not found')
    if (req.method !== 'GET') return sendText(res, 405, 'method not allowed', { allow: 'GET' })
    const key = clientIp(req)
    const state = limiter.check(key)
    if (state.locked) return sendText(res, 429, 'too many attempts', { 'retry-after': String(state.retryAfter) })
    const t = url.searchParams.get('t') ?? ''
    const refuse = () => {
      const after = limiter.fail(key)
      log(`[gate] ticket refused from ${key}${after.locked ? ` (locked ${after.retryAfter}s)` : ''}`)
      return sendText(res, 403, 'This link is not valid any more: open the computer again from the Kybernos console.')
    }
    if (!/^[A-Za-z0-9_-]{20,128}$/u.test(t)) return refuse()
    let answered
    try {
      const r = await fetch(config.ticket.url, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.ticket.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ticket: t }),
        signal: AbortSignal.timeout(8000)
      })
      answered = r.status
      await r.text().catch(() => '')
    } catch (e) {
      log('[gate] ticket service unreachable')
      return sendText(res, 502, 'The platform could not be reached: try again in a moment.', { 'retry-after': '3' })
    }
    if (answered === 429 || answered >= 500) return sendText(res, 503, 'The platform is busy: try again in a moment.', { 'retry-after': '3' })
    if (answered !== 200) return refuse()
    limiter.succeed(key)
    log(`[gate] ticket ok from ${key}`)
    const n = nonce()
    const next = safeNext(url.searchParams.get('next') ?? '/')
    const html = `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Opening…</title>` +
      `<p style="font:16px system-ui;margin:3rem auto;max-width:28rem">Opening your computer…</p>` +
      `<script nonce="${n}">location.replace(${JSON.stringify(next)})</script>`
    return sendHtml(res, 200, html, n, { 'set-cookie': signedInCookies(req) })
  }

  async function login (req, res, url) {
    if (config.verifier === null) return sendJson(res, 404, { ok: false, error: 'disabled' })
    if (!originOk(req)) return sendJson(res, 403, { ok: false, error: 'origin' })
    const contentType = String(req.headers['content-type'] ?? '')
    const asForm = /^application\/x-www-form-urlencoded\b/iu.test(contentType)
    if (!asForm && !/^application\/json\b/iu.test(contentType)) return sendJson(res, 415, { ok: false, error: 'content-type' })
    // The page's script sends JSON and reads the answer. A plain form post (no script, a policy that forbids it, a text-mode
    // reader) is answered like a page: a redirect when it worked, the sign-in page with the reason when it did not. Where it
    // goes next travels in the form's action, so even a refusal before the body is read can keep it.
    const next = asForm ? safeNext(url.searchParams.get('next') ?? '/') : '/'
    let typedUser = ''
    const reply = (status, payload, extra = {}) => {
      if (!asForm) return sendJson(res, status, payload, extra)
      const n = nonce()
      return sendHtml(res, status, renderLogin({ lang: pickLanguage(req.headers['accept-language']), nonce: n, next, sessionDays: config.sessionDays, user: typedUser, error: payload }), n, { ...LOGIN_PAGE_HEADERS, ...extra })
    }
    const key = clientIp(req)
    const state = limiter.check(key)
    if (state.locked) return reply(429, { ok: false, error: 'locked', retryAfter: state.retryAfter }, { 'retry-after': String(state.retryAfter) })
    // One guess at a time per client, and a cap overall: scrypt is deliberately expensive.
    if (attemptsInFlight.has(key)) return reply(429, { ok: false, error: 'busy', retryAfter: 1 }, { 'retry-after': '1' })
    if (activeLogins >= MAX_CONCURRENT_LOGINS) return reply(503, { ok: false, error: 'busy' }, { 'retry-after': '2' })
    attemptsInFlight.add(key)
    activeLogins += 1
    try {
      const body = asForm ? await readForm(req) : await readJson(req)
      if (body === null || typeof body.user !== 'string' || typeof body.password !== 'string' || body.user.length > 256 || body.password.length > 1024) {
        return reply(400, { ok: false, error: 'bad-request' })
      }
      if (asForm) {
        typedUser = body.user
        // Without the script nothing stops an empty form: say so, and do not spend one of the five tries on it.
        if (body.user.trim() === '' || body.password === '') return reply(400, { ok: false, error: 'empty' })
      }
      // Both checks always run, so the answer does not tell which of the two was wrong.
      const userOk = timingSafeEqual(sha256(body.user), userDigest)
      const passOk = await verifyPassword(body.password, config.verifier)
      if (userOk && passOk) {
        limiter.succeed(key)
        const cookies = signedInCookies(req)
        log(`[gate] login ok from ${key}`)
        if (asForm) return redirect(res, next, { 'set-cookie': cookies })
        return sendJson(res, 200, { ok: true, next: safeNext(body.next) }, { 'set-cookie': cookies })
      }
      const after = limiter.fail(key)
      log(`[gate] login failed from ${key}${after.locked ? ` (locked ${after.retryAfter}s)` : ''}`)
      if (after.locked) return reply(429, { ok: false, error: 'locked', retryAfter: after.retryAfter }, { 'retry-after': String(after.retryAfter) })
      return reply(401, { ok: false, error: 'invalid', triesLeft: after.triesLeft })
    } finally {
      attemptsInFlight.delete(key)
      activeLogins -= 1
    }
  }

  function logout (req, res) {
    if (!originOk(req)) return sendJson(res, 403, { ok: false, error: 'origin' })
    const secure = isSecure(req)
    const cookies = [clearCookie(SESSION_COOKIE, { secure })]
    const dshName = dshCookieName(req.headers.host)
    if (dshName !== null) cookies.push(clearCookie(dshName, { secure }))
    return sendJson(res, 200, { ok: true }, { 'set-cookie': cookies })
  }

  function gateRoute (req, res, url) {
    const route = url.pathname.slice(PREFIX.length)
    if (route === 'health') return req.method === 'GET' || req.method === 'HEAD' ? sendText(res, 200, 'ok') : sendText(res, 405, 'method not allowed')
    if (route === 'ticket') return ticket(req, res, url)
    if (route === 'login') {
      if (config.verifier === null) return sendText(res, 403, 'This computer is opened from the Kybernos console: use its Open button.')
      if (req.method === 'POST') return login(req, res, url)
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'method not allowed', { allow: 'GET, HEAD, POST' })
      const next = safeNext(url.searchParams.get('next') ?? '/')
      if (isAuthed(req)) return redirect(res, next)
      const n = nonce()
      return sendHtml(res, 200, renderLogin({ lang: pickLanguage(req.headers['accept-language']), nonce: n, next, sessionDays: config.sessionDays }), n, LOGIN_PAGE_HEADERS)
    }
    if (route === 'logout') return req.method === 'POST' ? logout(req, res) : sendText(res, 405, 'method not allowed', { allow: 'POST' })
    return sendText(res, 404, 'not found')
  }

  function unavailable (req, res) {
    if (!isNavigation(req)) return sendText(res, 502, 'bad gateway')
    const n = nonce()
    return sendHtml(res, 503, renderStarting({ lang: pickLanguage(req.headers['accept-language']), nonce: n }), n, { 'retry-after': '3' })
  }

  function handle (req, res) {
    let url
    try { url = new URL(req.url ?? '/', 'http://gate.invalid') } catch (e) { return sendText(res, 400, 'bad request') }
    if (url.pathname.startsWith(PREFIX)) return gateRoute(req, res, url)
    if (isAuthed(req)) return proxy.web(req, res, () => unavailable(req, res))
    // The query string is dropped on purpose: it may carry a token and has no business in the sign-in URL.
    if (isNavigation(req) && config.verifier === null) return sendText(res, 403, 'This computer is opened from the Kybernos console: use its Open button.')
    if (isNavigation(req)) return redirect(res, `${PREFIX}login?next=${encodeURIComponent(safeNext(url.pathname))}`)
    return sendJson(res, 401, { error: 'unauthorized' })
  }

  const server = http.createServer((req, res) => {
    Promise.resolve().then(() => handle(req, res)).catch(() => { if (!res.headersSent) sendText(res, 500, 'internal error'); else res.destroy() })
  })
  server.on('upgrade', (req, socket, head) => {
    const refuse = (line) => socket.end(`HTTP/1.1 ${line}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
    if (String(req.url ?? '').startsWith(PREFIX)) return refuse('404 Not Found')
    if (!isAuthed(req)) return refuse('401 Unauthorized')
    return proxy.upgrade(req, socket, head)
  })
  server.keepAliveTimeout = 65000

  return {
    server,
    listen: () => new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(config.port, config.host, () => { server.off('error', reject); resolve(server.address()) })
    }),
    close: () => new Promise((resolve) => { server.close(() => resolve()); server.closeAllConnections?.(); proxy.closeTunnels() })
  }
}
