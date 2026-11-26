// app.mjs — the hosted app of a team space: Hono for the routes, Better-Auth for who is signed in, kybernos-db behind one door for what they may do.
//
//   session → user → role (`owner`, or a profile id) → api.as(actor) → the app's own profile decides, on every call.
//
// Nothing in here decides a right: it finds the actor and hands the request to the door of the app. What this file does own is the edge: Origin and CSRF on every request that
// changes something, the headers, the body limits, the rate limits, how the owner gets in (lib/bootstrap.mjs), how the owner brings people in (lib/people.mjs), the activity log
// every one of those writes to (lib/audit.mjs) and the people's data rights (lib/account.mjs, lib/privacy.mjs).
import { randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { betterAuth } from 'better-auth'
import { getMigrations } from 'better-auth/db/migration'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { getCookie } from 'hono/cookie'
import { mountAccount } from './lib/account.mjs'
import { actorOf, isSlug } from './lib/actor.mjs'
import { RETENTION_DAYS, makeAudit, silentAudit } from './lib/audit.mjs'
import { assetResponse, loadAssets } from './lib/assets.mjs'
import { redeemOpenToken } from './lib/bootstrap.mjs'
import { makeApps } from './lib/apps.mjs'
import { userFileHeaders } from './lib/db.mjs'
import { FREEZE_PATH, isWrite, makeFreeze } from './lib/freeze.mjs'
import { invitationFault, normEmail, readInvitationToken } from './lib/invitation.mjs'
import { invitePage, notice, peoplePage } from './lib/html.mjs'
import { linkOnlyMailer, makeResendMailer } from './lib/mailer.mjs'
import { makePeople } from './lib/people.mjs'
import { DEFAULT_REGION, erasePerson } from './lib/privacy.mjs'
import { makeLimiter } from './lib/ratelimit.mjs'
import { CSRF_FIELD, CSRF_HEADER, SAFE_METHODS, allowedOrigins, clientIp, csrfCookie, csrfCookieName, csrfOk, csrfToken, isHttps, newCsrfValue, originOk, securityHeaders } from './lib/safety.mjs'
import { makeStore } from './lib/store.mjs'
import { makeTransfer } from './lib/transfer.mjs'

export const MIN_PASSWORD = 10
export const JSON_MAX = 1024 * 1024
export const UPLOAD_MAX = 26 * 1024 * 1024
const OWNER_FALLBACK_EMAIL = 'owner@app.invalid'
const AUTH_OPEN = new Set(['POST /api/auth/sign-in/email', 'POST /api/auth/sign-out', 'GET /api/auth/get-session'])
const STATUS = { forbidden: 403, owner: 403, unknown: 404, unknown_db: 404, unknown_object: 404, missing: 404, no_db: 404, which_db: 409, archived: 409, invalid: 400, confirm: 400, conflict: 409 }
const WINDOW = 15 * 60 * 1000
const DAY = 24 * 3600 * 1000
/** How long a session lasts after its last use: Better-Auth's own default, stated so that the privacy page is true by construction. */
const SESSION_DAYS = 7
/** An invitation that expired this long ago is forgotten with the address it holds. */
const STALE_INVITATION_MS = 30 * DAY

/** What a door (or the people service) answered, as an http answer. */
const reply = (c, r) => c.json(r, r !== null && typeof r === 'object' && r.ok === false ? (STATUS[r.error] ?? 400) : 200)
const redirect = (to, cookies) => {
  const h = new Headers({ location: to, 'cache-control': 'no-store' })
  for (const ck of cookies) h.append('set-cookie', ck)
  return new Response(null, { status: 303, headers: h })
}

/**
 * `{ dataDir, authSecret, bootKey (Buffer), publicUrl?, port?, trustProxy?, bundleMaxBytes?, mail?, privacy?, ports? }`. `mail` is `{ apiKey, from, replyTo?, base }` (lib/mailer.mjs `mailConfig`): with
 * it invitations go out by e-mail; `privacy` is `{ region, contact }` for the privacy page. `ports`: `now()` in ms, `today()` as YYYY-MM-DD, `mailer` (replaces `mail`), `fetch` (for the
 * mailer), `log(message)`. Answers `{ app (a Hono app: `app.fetch`), close() }`.
 */
export async function buildApp ({ dataDir, authSecret, bootKey, publicUrl, port, trustProxy = false, bundleMaxBytes, mail, privacy = {}, ports = {} }) {
  const now = ports.now ?? Date.now
  const log = ports.log ?? ((m) => console.error(m))
  const origins = allowedOrigins({ publicUrl, port })
  const https = isHttps(origins)
  const base = origins[0]
  const csrfName = csrfCookieName(https)

  mkdirSync(join(dataDir, 'apps'), { recursive: true, mode: 0o700 })
  const authFile = join(dataDir, 'auth.sqlite')
  const authDb = new DatabaseSync(authFile)
  // secure_delete: what is deleted is overwritten, not left in a free page (an erased person's address must not linger in the file)
  authDb.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA secure_delete = ON')
  try { chmodSync(authFile, 0o600) } catch (e) { /* a file system without modes */ }
  const store = makeStore(authDb, now)
  // the activity log must never stop the app from starting: if it cannot be set up the app runs without one
  let audit = silentAudit
  try { audit = makeAudit(authDb, { secret: authSecret, now, log }) } catch (e) { log('audit: the activity log could not be set up (' + String((e && e.code) || (e && e.name) || 'error').slice(0, 40) + '); the app runs without it') }

  const options = {
    database: authDb,
    secret: authSecret,
    baseURL: base,
    trustedOrigins: origins,
    telemetry: { enabled: false },
    rateLimit: { enabled: false },
    emailAndPassword: { enabled: true, minPasswordLength: MIN_PASSWORD, maxPasswordLength: 128 },
    session: { expiresIn: SESSION_DAYS * 24 * 3600 },
    // a session keeps its dates and the browser's user agent, not the network address (the privacy page says so)
    advanced: { useSecureCookies: https, ipAddress: { disableIpTracking: true } },
  }
  await (await getMigrations(options)).runMigrations()
  const auth = betterAuth(options)
  const ctx = await auth.$context

  const apps = makeApps({ dir: join(dataDir, 'apps'), today: ports.today })
  const mailer = ports.mailer ?? (mail === undefined ? linkOnlyMailer : makeResendMailer({ ...mail, ...(ports.fetch === undefined ? {} : { fetch: ports.fetch }), log }))
  const roleLabel = (id) => apps.roles().find((r) => r.id === id)?.label ?? (typeof id === 'string' ? id : '')
  const userRow = authDb.prepare('SELECT name, email FROM "user" WHERE id = ?')
  /** The words for a person still in the team in a sentence of the activity log: their name, « The owner » for the owner who gave none, else their address (null when they are gone). */
  const nameOf = (userId) => {
    const m = store.member(userId)
    const u = m === null ? undefined : userRow.get(userId)
    if (m === null || u === undefined) return null
    if (u.name !== '' && u.name !== 'Owner') return u.name
    return m.role === 'owner' ? 'The owner' : u.email
  }
  /** How an invitation e-mail names whoever sends it: a name, or an address that is real, else « The owner ». */
  const inviterOf = async (userId) => {
    const u = userRow.get(userId)
    if (u === undefined) return ''
    if (u.name !== '' && u.name !== 'Owner') return u.name
    return typeof u.email === 'string' && !u.email.endsWith('@app.invalid') ? u.email : 'The owner'
  }
  const spaceName = () => { const all = apps.names(); return all.length === 1 ? all[0].name : '' }
  const people = makePeople({ store, secret: authSecret, publicUrl: base, mailer, roles: () => apps.roles(), now, inviter: inviterOf, space: spaceName })

  const limits = {
    signIn: makeLimiter({ max: 10, windowMs: WINDOW, now }),
    signInIp: makeLimiter({ max: 40, windowMs: WINDOW, now }),
    open: makeLimiter({ max: 10, windowMs: WINDOW, now }),
    accept: makeLimiter({ max: 10, windowMs: WINDOW, now }),
    invite: makeLimiter({ max: 30, windowMs: 60 * 60 * 1000, now }),
    erase: makeLimiter({ max: 5, windowMs: 60 * 60 * 1000, now }),
    exports: makeLimiter({ max: 10, windowMs: 10 * 60 * 1000, now }),
    read: makeLimiter({ max: 120, windowMs: 60 * 1000, now }),
  }
  const ipOf = (c) => clientIp({ forwardedFor: c.req.header('x-forwarded-for'), remote: c.env?.incoming?.socket?.remoteAddress, trustProxy })
  // a refusal is logged once per kind and network a while, so a flood fills no disk
  const refusedAt = new Map()
  const logRefusal = (scope, ip) => {
    const key = scope + '|' + audit.hashIp(ip)
    const t = now()
    if (t - (refusedAt.get(key) ?? 0) < 10 * 60 * 1000) return
    if (refusedAt.size >= 1000) refusedAt.clear()
    refusedAt.set(key, t)
    audit.record('ratelimit', { ip, detail: { scope } })
  }
  const tooMany = (c, r, scope) => {
    if (scope !== undefined) logRefusal(scope, ipOf(c))
    c.header('retry-after', String(r.retryAfterSec))
    return c.json({ ok: false, error: 'rate-limited', retryAfterSec: r.retryAfterSec }, 429)
  }
  /** One line in the activity log for the request `c`. */
  const note = (kind, c, extra = {}) => audit.record(kind, { ip: c === undefined ? undefined : ipOf(c), ...extra })

  const transfer = makeTransfer({ apps, appsDir: join(dataDir, 'apps'), tmpDir: join(dataDir, 'tmp'), bootKey, store, now, ipOf, tooMany, bundleMaxBytes, log, audit: (kind, c, detail) => note(kind, c, { actor: c.get('bearer') === true ? 'owner-token' : c.get('me')?.user?.id, detail }) })

  const freeze = makeFreeze({ dir: dataDir, now, log })
  /** When a member (a person with a session, never the owner's computer with its token) last made a request; in memory, so a restart forgets it. */
  let lastMemberRequest = null

  const app = new Hono()
  const edge = securityHeaders(https)

  // every answer carries the headers; a handler that sets one of its own (a user's file) keeps it
  app.use('*', async (c, next) => {
    await next()
    const res = new Response(c.res.body, c.res)
    for (const [k, v] of Object.entries(edge)) if (!res.headers.has(k)) res.headers.set(k, v)
    c.res = res
  })

  // who a request is when it carries the owner's API token (lib/transfer.mjs), settled before any body is read
  app.use('*', transfer.edge)

  // while the server that hosts the space has frozen it (lib/freeze.mjs) every write is refused; reads, /health and the call that lifts the freeze stay up
  app.use('*', (c, next) => (freeze.frozen() && isWrite(c.req.method, c.req.path) && c.req.path !== FREEZE_PATH
    ? c.json({ ok: false, error: 'frozen', message: 'This web app is read-only for a moment. Try again in a minute.' }, 503)
    : next()))

  const tooBig = (c) => c.json({ ok: false, error: 'too-large' }, 413)
  const small = bodyLimit({ maxSize: JSON_MAX, onError: tooBig })
  const large = bodyLimit({ maxSize: UPLOAD_MAX, onError: tooBig })
  app.use('*', (c, next) => (/^\/api\/apps\/[^/]+\/upload$/.test(c.req.path) ? large : (transfer.limitFor(c.req.path) ?? small))(c, next))

  // Origin first, then the token: a request that changes something needs both
  app.use('*', async (c, next) => {
    if (SAFE_METHODS.has(c.req.method) || c.get('bearer') === true) return next() // a bearer request has no ambient cookie to protect
    if (!originOk(c.req.header('origin'), origins)) return c.json({ ok: false, error: 'bad-origin' }, 403)
    let given = c.req.header(CSRF_HEADER)
    if (given === undefined && (c.req.header('content-type') ?? '').startsWith('application/x-www-form-urlencoded')) {
      const form = await c.req.parseBody()
      given = typeof form[CSRF_FIELD] === 'string' ? form[CSRF_FIELD] : undefined
    }
    if (!csrfOk(authSecret, getCookie(c, csrfName), given)) return c.json({ ok: false, error: 'bad-csrf' }, 403)
    return next()
  })

  /** The token for this browser; the cookie it is tied to is set when there is none yet. */
  const csrfFor = (c) => {
    let value = getCookie(c, csrfName)
    if (typeof value !== 'string' || value === '') {
      value = newCsrfValue()
      c.header('set-cookie', csrfCookie(csrfName, value, https), { append: true })
    }
    return csrfToken(authSecret, value)
  }

  const session = async (c) => {
    if (c.get('bearer') === true) return transfer.ownerSession()
    const s = await auth.api.getSession({ headers: c.req.raw.headers }).catch(() => null)
    if (s === null || s === undefined) return null
    const member = store.member(s.user.id)
    const actor = actorOf(member)
    if (actor === null) return null
    lastMemberRequest = now()
    return { user: s.user, member, actor, sessionId: s.session?.id }
  }
  const needMember = async (c, next) => {
    const me = await session(c)
    if (me === null) return c.json({ ok: false, error: 'unauthenticated' }, 401)
    c.set('me', me)
    return next()
  }
  const needOwner = async (c, next) => (c.get('me').actor.role === 'owner' ? next() : c.json({ ok: false, error: 'forbidden', reason: 'owner-only' }, 403))
  const needHtml = (guard) => async (c, next) => {
    const me = await session(c)
    if (me === null) return c.html(notice('Sign in first', 'You are not signed in.'), 401)
    if (guard && me.actor.role !== 'owner') return c.html(notice('Not allowed', 'Only the owner can do that.'), 403)
    c.set('me', me)
    return next()
  }

  app.get('/health', (c) => c.json({ ok: true }))

  // the server that hosts the space asks for a freeze with the owner's API token and nothing else: a person's session, the owner's included, cannot
  app.post(FREEZE_PATH, async (c) => {
    if (c.get('bearer') !== true) return c.json({ ok: false, error: 'forbidden', reason: 'owner-api-only' }, 403)
    const b = await c.req.json().catch(() => null)
    if (b === null || typeof b !== 'object' || typeof b.frozen !== 'boolean') return c.json({ ok: false, error: 'invalid', message: 'a JSON object { "frozen": true or false }' }, 400)
    const r = freeze.set(b.frozen)
    if (!r.ok) return c.json({ ok: false, error: r.error, message: 'The state could not be saved, so nothing changed.' }, 500)
    return c.json({ ok: true, frozen: r.frozen })
  })

  app.get('/api/csrf', (c) => { c.header('cache-control', 'no-store'); return c.json({ ok: true, token: csrfFor(c) }) })

  // ── Better-Auth: sign-in, sign-out and the session, nothing else (no public sign-up, no reset, no OAuth) ──
  app.all('/api/auth/*', async (c) => {
    if (!AUTH_OPEN.has(c.req.method + ' ' + c.req.path)) return c.json({ ok: false, error: 'not-found' }, 404)
    if (c.req.method === 'POST' && c.req.path.endsWith('/sign-in/email')) {
      const body = await c.req.raw.clone().json().catch(() => null)
      const ip = ipOf(c)
      const email = body !== null && typeof body.email === 'string' ? body.email.trim().toLowerCase().slice(0, 254) : ''
      const a = limits.signIn.hit(ip + '|' + email)
      if (!a.ok) return tooMany(c, a, 'signin')
      const b = limits.signInIp.hit(ip)
      if (!b.ok) return tooMany(c, b, 'signin-ip')
      const res = await auth.handler(c.req.raw)
      // what happened is written down, with a masked address and a short code for the network: never the password
      const who = res.status === 200 ? await res.clone().json().then((j) => j?.user?.id, () => undefined) : undefined
      const member = typeof who === 'string' ? store.member(who) : null
      if (member !== null) note('signin.ok', c, { actor: who, detail: { role: member.role } })
      else if (res.status !== 429) note('signin.failed', c, { detail: { email } })
      return res
    }
    return auth.handler(c.req.raw)
  })

  // ── the owner gets in with a link only the person who started the app can mint ──
  /** What the session should remember of the browser that makes it: its User-Agent and nothing else (no cookie, no address) — the person's export shows it as a coarse device. */
  const deviceHeaders = (c) => new Headers({ 'user-agent': (c.req.header('user-agent') ?? '').slice(0, 300) })
  async function openOwner (email, headers) {
    const owner = store.owner()
    const password = randomBytes(24).toString('base64url')
    try {
      if (owner === null) {
        const address = normEmail(email) ?? OWNER_FALLBACK_EMAIL
        const up = await auth.api.signUpEmail({ body: { email: address, password, name: 'Owner' }, headers, returnHeaders: true })
        try { store.addMember({ userId: up.response.user.id, email: address, role: 'owner' }) } catch (e) {
          await ctx.internalAdapter.deleteUser(up.response.user.id)
          return { ok: false }
        }
        store.setMeta('owner_pw_set', '0')
        return { ok: true, headers: up.headers }
      }
      // break-glass: the owner is signed in again with a password nobody knows, every other session ends, and they set a new password
      await ctx.internalAdapter.updatePassword(owner.user_id, await ctx.password.hash(password))
      await ctx.internalAdapter.deleteUserSessions(owner.user_id)
      const inn = await auth.api.signInEmail({ body: { email: owner.email, password }, headers, returnHeaders: true })
      store.setMeta('owner_pw_set', '0')
      return { ok: true, headers: inn.headers }
    } catch (e) {
      log('open: ' + String((e && e.message) || e).slice(0, 120))
      return { ok: false }
    }
  }

  app.get('/open', async (c) => {
    const lim = limits.open.hit(ipOf(c))
    if (!lim.ok) return tooMany(c, lim, 'open')
    const r = redeemOpenToken(c.req.query('t'), { key: bootKey, now, ledger: store })
    if (!r.ok) { note('owner.open.refused', c, { detail: { reason: r.reason } }); return c.html(notice('Link not valid', 'This link is not valid any more. Ask for a new one.'), 403) }
    const done = await openOwner(r.email, deviceHeaders(c))
    if (!done.ok) return c.html(notice('Could not open', 'The owner could not be opened. Try a new link.'), 500)
    note('owner.open', c, { actor: store.owner()?.user_id })
    return redirect('/', done.headers.getSetCookie())
  })

  // ── the page: the same files for everyone, held in memory; the page asks /api/me who is there and shows the sign-in when nobody is ──
  for (const [address, asset] of loadAssets()) app.get(address, (c) => assetResponse(asset, c.req.header('if-none-match')))

  app.get('/api/me', needMember, (c) => {
    const { user, actor } = c.get('me')
    return c.json({ ok: true, id: user.id, email: user.email, name: user.name, role: actor.role, ...(actor.role === 'owner' ? { passwordSet: store.meta('owner_pw_set') === '1' } : {}) })
  })

  // the owner's first password: once, because the link gave them a password nobody knows
  app.post('/api/me/password', needMember, needOwner, async (c) => {
    if (store.meta('owner_pw_set') === '1') return c.json({ ok: false, error: 'already-set' }, 409)
    const body = await c.req.json().catch(() => null)
    const password = body !== null && typeof body === 'object' ? body.password : undefined
    if (typeof password !== 'string' || password.length < MIN_PASSWORD || password.length > 128) return c.json({ ok: false, error: 'weak-password', message: 'a password is ' + MIN_PASSWORD + ' to 128 characters' }, 400)
    await ctx.internalAdapter.updatePassword(c.get('me').user.id, await ctx.password.hash(password))
    store.setMeta('owner_pw_set', '1')
    note('password.changed', c, { actor: c.get('me').user.id })
    return c.json({ ok: true })
  })

  // ── the apps: every answer is the door's ──
  const door = (c) => (isSlug(c.req.param('slug')) ? apps.door(c.req.param('slug'), c.get('me').actor) : null)
  const noApp = (c) => c.json({ ok: false, error: 'unknown', message: 'no such app' }, 404)
  const asks = (c, ...keys) => Object.fromEntries(keys.map((k) => [k, c.req.query(k)]))

  app.get('/api/apps', needMember, (c) => {
    const out = []
    for (const slug of apps.slugs()) {
      const s = apps.door(slug, c.get('me').actor).state()
      if (s.ok) for (const d of s.dbs) out.push({ slug, ...d })
    }
    // the server that hosts the space reads when a member last used it, to know whether the computer may sleep; a member is not told when others last came
    return c.json({ ok: true, apps: out, ...(c.get('bearer') === true && lastMemberRequest !== null ? { last_request_at: new Date(lastMemberRequest).toISOString() } : {}) })
  })
  app.get('/api/apps/:slug/records', needMember, (c) => { const d = door(c); return d === null ? noApp(c) : reply(c, d.records(asks(c, 'object', 'deleted'))) })
  app.get('/api/apps/:slug/links', needMember, (c) => { const d = door(c); return d === null ? noApp(c) : reply(c, d.links(asks(c, 'object', 'id'))) })
  app.post('/api/apps/:slug/write', needMember, async (c) => {
    const d = door(c)
    if (d === null) return noApp(c)
    const b = await c.req.json().catch(() => null)
    if (b === null || typeof b !== 'object' || Array.isArray(b)) return c.json({ ok: false, error: 'invalid', message: 'a JSON object' }, 400)
    // `rev` (optional, on an update): the revision the person last read. A row that has moved on since is refused as a conflict and nothing is written. The door has no such
    // precondition of its own, so it is checked here: the read and the write below run in one tick of this single process, nothing else writes in between.
    if (b.op === 'update' && b.rev !== undefined) {
      if (!Number.isInteger(b.rev) || b.rev < 1) return c.json({ ok: false, error: 'invalid', message: 'rev is the revision you read, a whole number' }, 400)
      const fresh = d.records({ object: b.object })
      if (!fresh.ok) return reply(c, fresh)
      const row = fresh.records.find((r) => r.id === b.id)
      if (row !== undefined && row.rev !== b.rev) return c.json({ ok: false, error: 'conflict', message: 'this row was changed by someone else since you read it', rev: row.rev }, 409)
    }
    return reply(c, d.write({ object: b.object, op: b.op, id: b.id, values: b.values }))
  })
  app.post('/api/apps/:slug/upload', needMember, async (c) => {
    const d = door(c)
    if (d === null) return noApp(c)
    const bytes = new Uint8Array(await c.req.arrayBuffer())
    return reply(c, d.upload({ ...asks(c, 'object', 'field', 'name'), type: c.req.header('content-type') ?? 'application/octet-stream', bytes }))
  })
  app.get('/api/apps/:slug/file', needMember, (c) => {
    const d = door(c)
    if (d === null) return noApp(c)
    const r = d.file(asks(c, 'object', 'id', 'field', 'hash'))
    if (!r.ok) return reply(c, r)
    // a person's file is served from this origin: its type comes from its first bytes and never from what was said at upload, a picture is shown in place, anything else is a
    // download, and the answer shuts the document (kybernos-db's serve-user-file.mjs)
    const bytes = Buffer.from(r.bytes)
    return new Response(bytes, { headers: userFileHeaders(bytes) })
  })

  // ── the owner's way in and out for an app: bundles, snapshots, release (lib/transfer.mjs) ──
  transfer.mount(app, { needMember, needOwner })

  // ── people: the owner's, as an API and as a plain page over the same calls ──
  /** Ends a person's sessions and erases their account, their sign-in, their invitations and their address in the activity log (lib/privacy.mjs). */
  async function eraseAccount (userId) {
    await ctx.internalAdapter.deleteUserSessions(userId).catch((e) => log('erase: ' + String((e && e.message) || e).slice(0, 120)))
    return erasePerson({ db: authDb, store, audit, userId })
  }
  async function removeMember (c, userId) {
    const me = c.get('me')
    const m = store.member(userId)
    if (m === null) return { ok: false, error: 'unknown', message: 'no such member' }
    if (m.role === 'owner' || userId === me.user.id) return { ok: false, error: 'owner', message: 'the owner cannot be removed' }
    const done = await eraseAccount(userId)
    if (!done.ok) return { ok: false, error: 'unknown', message: 'no such member' }
    note('member.removed', c, { actor: me.user.id, detail: { role: m.role } })
    return { ok: true }
  }
  /** An invitation or a resend is an e-mail that costs something: both count against the same limit. */
  const asked = (c) => { const lim = limits.invite.hit(c.get('me').user.id); if (lim.ok) return true; logRefusal('invite', ipOf(c)); return false }
  const tooManyInvitations = { ok: false, error: 'rate-limited', message: 'too many invitations, try again later' }
  const mailState = (r) => (r.invitation.email === null ? undefined : r.sent ? 'sent' : r.mailFailed === true ? 'failed' : 'link')
  const invite = async (c, input) => {
    if (!asked(c)) return tooManyInvitations
    const r = await people.invite({ ...input, by: c.get('me').user.id })
    if (r.ok) note('invite.sent', c, { actor: c.get('me').user.id, subject: r.invitation.id, detail: { role: r.invitation.role, email: r.invitation.email, mail: mailState(r) } })
    return r
  }
  const resend = async (c, id) => {
    if (!asked(c)) return tooManyInvitations
    const r = await people.resend(id, c.get('me').user.id)
    if (r.ok) note('invite.resent', c, { actor: c.get('me').user.id, subject: r.invitation.id, detail: { role: r.invitation.role, email: r.invitation.email, mail: mailState(r) } })
    return r
  }
  const revoke = (c, id) => {
    const inv = store.invitation(id)
    const r = people.revoke(id)
    if (r.ok && inv !== null) note('invite.revoked', c, { actor: c.get('me').user.id, subject: id, detail: { role: inv.role, email: inv.email } })
    return r
  }
  const setInvitationRole = (c, id, role) => {
    const r = people.setInvitationRole(id, role)
    if (r.ok) note('invite.role', c, { actor: c.get('me').user.id, subject: id, detail: { role } })
    return r
  }
  const setMemberRole = (c, uid, role) => {
    const r = people.setMemberRole(uid, role)
    if (r.ok) note('member.role', c, { actor: c.get('me').user.id, subject: uid, detail: { role } })
    return r
  }

  app.get('/api/people', needMember, needOwner, (c) => c.json({ ok: true, ...people.list() }))
  app.post('/api/people/invitations', needMember, needOwner, async (c) => { const b = await c.req.json().catch(() => ({})); return reply(c, await invite(c, { email: b?.email, role: b?.role })) })
  app.post('/api/people/invitations/:id/resend', needMember, needOwner, async (c) => reply(c, await resend(c, c.req.param('id'))))
  app.patch('/api/people/invitations/:id', needMember, needOwner, async (c) => reply(c, setInvitationRole(c, c.req.param('id'), (await c.req.json().catch(() => ({})))?.role)))
  app.delete('/api/people/invitations/:id', needMember, needOwner, (c) => reply(c, revoke(c, c.req.param('id'))))
  app.patch('/api/people/members/:uid', needMember, needOwner, async (c) => reply(c, setMemberRole(c, c.req.param('uid'), (await c.req.json().catch(() => ({})))?.role)))
  app.delete('/api/people/members/:uid', needMember, needOwner, async (c) => reply(c, await removeMember(c, c.req.param('uid'))))

  const peopleView = (c, note, status = 200) => c.html(peoplePage({ ...people.list(), csrf: csrfFor(c), notice: note }), status)
  const said = (r, text, who) => (!r.ok ? { text: r.message ?? 'That did not work.', bad: true } : r.mailFailed === true ? { text: r.message, who, bad: true, link: r.link } : { text, who, ...(r.link === undefined ? {} : { link: r.link }) })
  const html = needHtml(true)
  app.get('/people', html, (c) => peopleView(c))
  app.post('/people/invitations', html, async (c) => {
    const f = await c.req.parseBody()
    const r = await invite(c, { email: f.email, role: f.role })
    return peopleView(c, said(r, r.ok && r.sent ? 'Invitation sent.' : 'Invitation created.', r.ok ? (r.invitation.email ?? 'whoever you give it to') : ''))
  })
  app.post('/people/invitations/:id/resend', html, async (c) => { const r = await resend(c, c.req.param('id')); return peopleView(c, said(r, r.ok && r.sent ? 'Invitation sent again.' : 'A new link was made; the old one no longer works.', r.ok ? (r.invitation.email ?? 'whoever you give it to') : '')) })
  app.post('/people/invitations/:id/role', html, async (c) => peopleView(c, said(setInvitationRole(c, c.req.param('id'), (await c.req.parseBody()).role), 'Profile changed.')))
  app.post('/people/invitations/:id/revoke', html, (c) => peopleView(c, said(revoke(c, c.req.param('id')), 'Invitation revoked.')))
  app.post('/people/members/:uid/role', html, async (c) => peopleView(c, said(setMemberRole(c, c.req.param('uid'), (await c.req.parseBody()).role), 'Profile changed.')))
  app.post('/people/members/:uid/remove', html, async (c) => peopleView(c, said(await removeMember(c, c.req.param('uid')), 'Member removed and signed out. Their account and address were erased; the rows they added keep an opaque id that points at nobody.')))

  // ── an invitation: a page to read, then one call that spends it ──
  async function accept ({ token, email, name, password, headers }) {
    const t = readInvitationToken(token, { secret: authSecret, now })
    const row = t.ok ? store.invitation(t.id) : null
    if (!t.ok || invitationFault(row, t.nonce, now) !== null) return { status: 400, error: 'invalid-link', message: 'This invitation is not valid any more. Ask for a new one.' }
    if (typeof password !== 'string' || password.length < MIN_PASSWORD || password.length > 128) return { status: 400, error: 'weak-password', message: 'A password is ' + MIN_PASSWORD + ' to 128 characters.' }
    const address = row.email ?? normEmail(email)
    if (address === null) return { status: 400, error: 'bad-email', message: 'That is not an e-mail address.' }
    if (store.memberByEmail(address) !== null) return { status: 409, error: 'email-taken', message: 'That address is already in the team.' }
    if (!store.claimInvitation(row.id, row.nonce)) return { status: 400, error: 'invalid-link', message: 'This invitation is not valid any more. Ask for a new one.' }
    const shown = typeof name === 'string' && name.trim() !== '' ? name.trim().slice(0, 80) : address.split('@')[0]
    try {
      const up = await auth.api.signUpEmail({ body: { email: address, password, name: shown }, headers, returnHeaders: true })
      try { store.addMember({ userId: up.response.user.id, email: address, role: row.role, invitedBy: row.created_by }) } catch (e) {
        await ctx.internalAdapter.deleteUser(up.response.user.id)
        throw e
      }
      store.dropInvitation(row.id) // it has done its work: the address it held is not kept twice
      return { status: 200, headers: up.headers, role: row.role, userId: up.response.user.id, address }
    } catch (e) {
      store.releaseInvitation(row.id)
      return { status: 409, error: 'email-taken', message: 'That address could not be added.' }
    }
  }

  app.get('/invite', (c) => {
    const token = c.req.query('t') ?? ''
    const t = readInvitationToken(token, { secret: authSecret, now })
    const row = t.ok ? store.invitation(t.id) : null
    if (!t.ok || invitationFault(row, t.nonce, now) !== null) return c.html(notice('Invitation not valid', 'This invitation is not valid any more. Ask for a new one.'), 400)
    return c.html(invitePage({ token, email: row.email, csrf: csrfFor(c) }))
  })
  app.post('/invite', async (c) => {
    const lim = limits.accept.hit(ipOf(c))
    if (!lim.ok) return tooMany(c, lim, 'accept')
    const f = await c.req.parseBody()
    const r = await accept({ token: f.token, email: f.email, name: f.name, password: f.password, headers: deviceHeaders(c) })
    if (r.status !== 200) return c.html(invitePage({ token: String(f.token ?? ''), email: normEmail(f.email), csrf: csrfFor(c), error: r.message }), r.status)
    note('invite.accepted', c, { actor: r.userId, subject: r.userId, detail: { role: r.role, email: r.address } })
    return redirect('/', r.headers.getSetCookie())
  })
  app.post('/api/invitations/accept', async (c) => {
    const lim = limits.accept.hit(ipOf(c))
    if (!lim.ok) return tooMany(c, lim, 'accept')
    const b = await c.req.json().catch(() => null)
    const r = await accept(b !== null && typeof b === 'object' ? { token: b.token, email: b.email, name: b.name, password: b.password, headers: deviceHeaders(c) } : {})
    if (r.status !== 200) return c.json({ ok: false, error: r.error, message: r.message }, r.status)
    note('invite.accepted', c, { actor: r.userId, subject: r.userId, detail: { role: r.role, email: r.address } })
    const res = c.json({ ok: true, role: r.role })
    for (const ck of r.headers.getSetCookie()) res.headers.append('set-cookie', ck)
    return res
  })

  // ── a person's data: the privacy page, their account and export, the owner's export of an app, the activity log (lib/account.mjs) ──
  mountAccount({
    app, guards: { needMember, needOwner, needHtml }, store, audit, authDb, apps, limits, ipOf, tooMany, now, csrfFor, eraseAccount, roleLabel, nameOf,
    privacy: { region: privacy.region ?? DEFAULT_REGION, contact: privacy.contact ?? null, mailProvider: mail !== undefined ? 'Resend' : (mailer.configured === false ? null : 'an email provider') },
    days: { session: SESSION_DAYS, activity: RETENTION_DAYS },
    signOutCookies: async (headers) => { try { return (await auth.api.signOut({ headers, returnHeaders: true })).headers.getSetCookie() } catch (e) { return [] } },
  })

  // ── housekeeping: at start and once a day, the log keeps its 90 days and an invitation that is used or long expired is forgotten with its address ──
  const housekeeping = () => {
    try { audit.prune() } catch (e) { log('audit: the retention pass failed') }
    try { store.purgeInvitations(now() - STALE_INVITATION_MS) } catch (e) { log('invitations: the clean-up failed') }
  }
  housekeeping()
  const daily = setInterval(housekeeping, DAY)
  daily.unref()

  app.notFound((c) => c.json({ ok: false, error: 'not-found' }, 404))
  app.onError((err, c) => { log('error: ' + String((err && err.message) || err).slice(0, 160)); return c.json({ ok: false, error: 'server-error' }, 500) })

  return { app, close () { clearInterval(daily); transfer.close(); apps.close(); authDb.close() } }
}
