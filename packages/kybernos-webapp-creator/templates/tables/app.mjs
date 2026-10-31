// app.mjs — the hosted app of a team space: Hono for the routes, Better-Auth for who is signed in, kybernos-db behind one door for what they may do.
//
//   session → user → role (`owner`, or a profile id) → api.as(actor) → the app's own profile decides, on every call.
//
// Nothing in here decides a right: it finds the actor and hands the request to the door of the app. What this file does own is the edge: Origin and CSRF on every request that
// changes something, the headers, the body limits, the rate limits, how the owner gets in (lib/bootstrap.mjs) and how the owner brings people in (lib/people.mjs).
import { randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { betterAuth } from 'better-auth'
import { getMigrations } from 'better-auth/db/migration'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { getCookie } from 'hono/cookie'
import { actorOf, isSlug } from './lib/actor.mjs'
import { assetResponse, loadAssets } from './lib/assets.mjs'
import { redeemOpenToken } from './lib/bootstrap.mjs'
import { makeApps } from './lib/apps.mjs'
import { userFileHeaders } from './lib/db.mjs'
import { invitationFault, normEmail, readInvitationToken } from './lib/invitation.mjs'
import { invitePage, notice, peoplePage } from './lib/html.mjs'
import { linkOnlyMailer } from './lib/mailer.mjs'
import { makePeople } from './lib/people.mjs'
import { makeLimiter } from './lib/ratelimit.mjs'
import { CSRF_FIELD, CSRF_HEADER, SAFE_METHODS, allowedOrigins, clientIp, csrfCookie, csrfCookieName, csrfOk, csrfToken, isHttps, newCsrfValue, originOk, securityHeaders } from './lib/safety.mjs'
import { makeStore } from './lib/store.mjs'

export const MIN_PASSWORD = 10
export const JSON_MAX = 1024 * 1024
export const UPLOAD_MAX = 26 * 1024 * 1024
const OWNER_FALLBACK_EMAIL = 'owner@app.invalid'
const AUTH_OPEN = new Set(['POST /api/auth/sign-in/email', 'POST /api/auth/sign-out', 'GET /api/auth/get-session'])
const STATUS = { forbidden: 403, owner: 403, unknown: 404, unknown_db: 404, unknown_object: 404, missing: 404, no_db: 404, which_db: 409, archived: 409, invalid: 400, confirm: 400 }
const WINDOW = 15 * 60 * 1000

/** What a door (or the people service) answered, as an http answer. */
const reply = (c, r) => c.json(r, r !== null && typeof r === 'object' && r.ok === false ? (STATUS[r.error] ?? 400) : 200)
const redirect = (to, cookies) => {
  const h = new Headers({ location: to, 'cache-control': 'no-store' })
  for (const ck of cookies) h.append('set-cookie', ck)
  return new Response(null, { status: 303, headers: h })
}

/**
 * `{ dataDir, authSecret, bootKey (Buffer), publicUrl?, port?, trustProxy?, ports? }`. `ports`: `now()` in ms, `today()` as YYYY-MM-DD, `mailer`, `log(message)`.
 * Answers `{ app (a Hono app: `app.fetch`), close() }`.
 */
export async function buildApp ({ dataDir, authSecret, bootKey, publicUrl, port, trustProxy = false, ports = {} }) {
  const now = ports.now ?? Date.now
  const log = ports.log ?? ((m) => console.error(m))
  const origins = allowedOrigins({ publicUrl, port })
  const https = isHttps(origins)
  const base = origins[0]
  const csrfName = csrfCookieName(https)

  mkdirSync(join(dataDir, 'apps'), { recursive: true, mode: 0o700 })
  const authFile = join(dataDir, 'auth.sqlite')
  const authDb = new DatabaseSync(authFile)
  authDb.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000')
  try { chmodSync(authFile, 0o600) } catch (e) { /* a file system without modes */ }
  const store = makeStore(authDb, now)

  const options = {
    database: authDb,
    secret: authSecret,
    baseURL: base,
    trustedOrigins: origins,
    telemetry: { enabled: false },
    rateLimit: { enabled: false },
    emailAndPassword: { enabled: true, minPasswordLength: MIN_PASSWORD, maxPasswordLength: 128 },
    advanced: { useSecureCookies: https },
  }
  await (await getMigrations(options)).runMigrations()
  const auth = betterAuth(options)
  const ctx = await auth.$context

  const apps = makeApps({ dir: join(dataDir, 'apps'), today: ports.today })
  const people = makePeople({ store, secret: authSecret, publicUrl: base, mailer: ports.mailer ?? linkOnlyMailer, roles: () => apps.roles(), now })

  const limits = {
    signIn: makeLimiter({ max: 10, windowMs: WINDOW, now }),
    signInIp: makeLimiter({ max: 40, windowMs: WINDOW, now }),
    open: makeLimiter({ max: 10, windowMs: WINDOW, now }),
    accept: makeLimiter({ max: 10, windowMs: WINDOW, now }),
    invite: makeLimiter({ max: 30, windowMs: 60 * 60 * 1000, now }),
  }
  const ipOf = (c) => clientIp({ forwardedFor: c.req.header('x-forwarded-for'), remote: c.env?.incoming?.socket?.remoteAddress, trustProxy })
  const tooMany = (c, r) => { c.header('retry-after', String(r.retryAfterSec)); return c.json({ ok: false, error: 'rate-limited', retryAfterSec: r.retryAfterSec }, 429) }

  const app = new Hono()
  const edge = securityHeaders(https)

  // every answer carries the headers; a handler that sets one of its own (a user's file) keeps it
  app.use('*', async (c, next) => {
    await next()
    const res = new Response(c.res.body, c.res)
    for (const [k, v] of Object.entries(edge)) if (!res.headers.has(k)) res.headers.set(k, v)
    c.res = res
  })

  const tooBig = (c) => c.json({ ok: false, error: 'too-large' }, 413)
  const small = bodyLimit({ maxSize: JSON_MAX, onError: tooBig })
  const large = bodyLimit({ maxSize: UPLOAD_MAX, onError: tooBig })
  app.use('*', (c, next) => (/^\/api\/apps\/[^/]+\/upload$/.test(c.req.path) ? large : small)(c, next))

  // Origin first, then the token: a request that changes something needs both
  app.use('*', async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next()
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
    const s = await auth.api.getSession({ headers: c.req.raw.headers }).catch(() => null)
    if (s === null || s === undefined) return null
    const member = store.member(s.user.id)
    const actor = actorOf(member)
    return actor === null ? null : { user: s.user, member, actor }
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

  app.get('/api/csrf', (c) => { c.header('cache-control', 'no-store'); return c.json({ ok: true, token: csrfFor(c) }) })

  // ── Better-Auth: sign-in, sign-out and the session, nothing else (no public sign-up, no reset, no OAuth) ──
  app.all('/api/auth/*', async (c) => {
    if (!AUTH_OPEN.has(c.req.method + ' ' + c.req.path)) return c.json({ ok: false, error: 'not-found' }, 404)
    if (c.req.method === 'POST' && c.req.path.endsWith('/sign-in/email')) {
      const body = await c.req.raw.clone().json().catch(() => null)
      const ip = ipOf(c)
      const email = body !== null && typeof body.email === 'string' ? body.email.trim().toLowerCase().slice(0, 254) : ''
      const a = limits.signIn.hit(ip + '|' + email)
      if (!a.ok) return tooMany(c, a)
      const b = limits.signInIp.hit(ip)
      if (!b.ok) return tooMany(c, b)
    }
    return auth.handler(c.req.raw)
  })

  // ── the owner gets in with a link only the person who started the app can mint ──
  async function openOwner (email) {
    const owner = store.owner()
    const password = randomBytes(24).toString('base64url')
    try {
      if (owner === null) {
        const address = normEmail(email) ?? OWNER_FALLBACK_EMAIL
        const up = await auth.api.signUpEmail({ body: { email: address, password, name: 'Owner' }, returnHeaders: true })
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
      const inn = await auth.api.signInEmail({ body: { email: owner.email, password }, returnHeaders: true })
      store.setMeta('owner_pw_set', '0')
      return { ok: true, headers: inn.headers }
    } catch (e) {
      log('open: ' + String((e && e.message) || e).slice(0, 120))
      return { ok: false }
    }
  }

  app.get('/open', async (c) => {
    const lim = limits.open.hit(ipOf(c))
    if (!lim.ok) return tooMany(c, lim)
    const r = redeemOpenToken(c.req.query('t'), { key: bootKey, now, ledger: store })
    if (!r.ok) return c.html(notice('Link not valid', 'This link is not valid any more. Ask for a new one.'), 403)
    const done = await openOwner(r.email)
    if (!done.ok) return c.html(notice('Could not open', 'The owner could not be opened. Try a new link.'), 500)
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
    return c.json({ ok: true, apps: out })
  })
  app.get('/api/apps/:slug/records', needMember, (c) => { const d = door(c); return d === null ? noApp(c) : reply(c, d.records(asks(c, 'object', 'deleted'))) })
  app.get('/api/apps/:slug/links', needMember, (c) => { const d = door(c); return d === null ? noApp(c) : reply(c, d.links(asks(c, 'object', 'id'))) })
  app.post('/api/apps/:slug/write', needMember, async (c) => {
    const d = door(c)
    if (d === null) return noApp(c)
    const b = await c.req.json().catch(() => null)
    if (b === null || typeof b !== 'object' || Array.isArray(b)) return c.json({ ok: false, error: 'invalid', message: 'a JSON object' }, 400)
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

  // ── people: the owner's, as an API and as a plain page over the same calls ──
  async function removeMember (me, userId) {
    const m = store.member(userId)
    if (m === null) return { ok: false, error: 'unknown', message: 'no such member' }
    if (m.role === 'owner' || userId === me.user.id) return { ok: false, error: 'owner', message: 'the owner cannot be removed' }
    await ctx.internalAdapter.deleteUserSessions(userId)
    store.removeMember(userId)
    await ctx.internalAdapter.deleteUser(userId).catch((e) => log('remove: ' + String((e && e.message) || e).slice(0, 120)))
    return { ok: true }
  }
  const invite = (c, input) => { const lim = limits.invite.hit(c.get('me').user.id); return lim.ok ? people.invite({ ...input, by: c.get('me').user.id }) : { ok: false, error: 'rate-limited', message: 'too many invitations, try again later' } }

  app.get('/api/people', needMember, needOwner, (c) => c.json({ ok: true, ...people.list() }))
  app.post('/api/people/invitations', needMember, needOwner, async (c) => { const b = await c.req.json().catch(() => ({})); return reply(c, await invite(c, { email: b?.email, role: b?.role })) })
  app.post('/api/people/invitations/:id/resend', needMember, needOwner, async (c) => reply(c, await people.resend(c.req.param('id'))))
  app.patch('/api/people/invitations/:id', needMember, needOwner, async (c) => reply(c, people.setInvitationRole(c.req.param('id'), (await c.req.json().catch(() => ({})))?.role)))
  app.delete('/api/people/invitations/:id', needMember, needOwner, (c) => reply(c, people.revoke(c.req.param('id'))))
  app.patch('/api/people/members/:uid', needMember, needOwner, async (c) => reply(c, people.setMemberRole(c.req.param('uid'), (await c.req.json().catch(() => ({})))?.role)))
  app.delete('/api/people/members/:uid', needMember, needOwner, async (c) => reply(c, await removeMember(c.get('me'), c.req.param('uid'))))

  const peopleView = (c, note, status = 200) => c.html(peoplePage({ ...people.list(), csrf: csrfFor(c), notice: note }), status)
  const said = (r, text, who) => (r.ok ? { text, who, ...(r.link === undefined ? {} : { link: r.link }) } : { text: r.message ?? 'That did not work.', bad: true })
  const html = needHtml(true)
  app.get('/people', html, (c) => peopleView(c))
  app.post('/people/invitations', html, async (c) => {
    const f = await c.req.parseBody()
    const r = await invite(c, { email: f.email, role: f.role })
    return peopleView(c, said(r, r.ok && r.sent ? 'Invitation sent.' : 'Invitation created.', r.ok ? (r.invitation.email ?? 'whoever you give it to') : ''))
  })
  app.post('/people/invitations/:id/resend', html, async (c) => { const r = await people.resend(c.req.param('id')); return peopleView(c, said(r, r.ok && r.sent ? 'Invitation sent again.' : 'A new link was made; the old one no longer works.', r.ok ? (r.invitation.email ?? 'whoever you give it to') : '')) })
  app.post('/people/invitations/:id/role', html, async (c) => peopleView(c, said(people.setInvitationRole(c.req.param('id'), (await c.req.parseBody()).role), 'Profile changed.')))
  app.post('/people/invitations/:id/revoke', html, (c) => peopleView(c, said(people.revoke(c.req.param('id')), 'Invitation revoked.')))
  app.post('/people/members/:uid/role', html, async (c) => peopleView(c, said(people.setMemberRole(c.req.param('uid'), (await c.req.parseBody()).role), 'Profile changed.')))
  app.post('/people/members/:uid/remove', html, async (c) => peopleView(c, said(await removeMember(c.get('me'), c.req.param('uid')), 'Member removed; they are signed out.')))

  // ── an invitation: a page to read, then one call that spends it ──
  async function accept ({ token, email, name, password }) {
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
      const up = await auth.api.signUpEmail({ body: { email: address, password, name: shown }, returnHeaders: true })
      try { store.addMember({ userId: up.response.user.id, email: address, role: row.role, invitedBy: row.created_by }) } catch (e) {
        await ctx.internalAdapter.deleteUser(up.response.user.id)
        throw e
      }
      return { status: 200, headers: up.headers, role: row.role }
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
    if (!lim.ok) return tooMany(c, lim)
    const f = await c.req.parseBody()
    const r = await accept({ token: f.token, email: f.email, name: f.name, password: f.password })
    if (r.status !== 200) return c.html(invitePage({ token: String(f.token ?? ''), email: normEmail(f.email), csrf: csrfFor(c), error: r.message }), r.status)
    return redirect('/', r.headers.getSetCookie())
  })
  app.post('/api/invitations/accept', async (c) => {
    const lim = limits.accept.hit(ipOf(c))
    if (!lim.ok) return tooMany(c, lim)
    const b = await c.req.json().catch(() => null)
    const r = await accept(b !== null && typeof b === 'object' ? { token: b.token, email: b.email, name: b.name, password: b.password } : {})
    if (r.status !== 200) return c.json({ ok: false, error: r.error, message: r.message }, r.status)
    const res = c.json({ ok: true, role: r.role })
    for (const ck of r.headers.getSetCookie()) res.headers.append('set-cookie', ck)
    return res
  })

  app.notFound((c) => c.json({ ok: false, error: 'not-found' }, 404))
  app.onError((err, c) => { log('error: ' + String((err && err.message) || err).slice(0, 160)); return c.json({ ok: false, error: 'server-error' }, 500) })

  return { app, close () { apps.close(); authDb.close() } }
}
