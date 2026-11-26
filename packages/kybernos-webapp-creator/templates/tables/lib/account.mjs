// account.mjs — the routes of a person's own data and of the owner's oversight: the privacy page, a person's account, the export of what the space holds about them, the
// erasure of their account, the owner's export of an app, and the activity log (page and API). app.mjs mounts it with the pieces of its edge it already has.
//
//   GET    /privacy                      the privacy page (public)
//   GET    /account                      a person's own page (details, download, delete)
//   POST   /account/delete               the form of « Delete my account » (members; typed confirmation)
//   GET    /api/me/export                what the space holds about the person who asks: JSON, an attachment, never cached
//   DELETE /api/me                       { confirm: <their address> } erases the account (members; not the owner)
//   GET    /api/apps/:slug/export.json   the owner's export of an app: every table, field, record (archived ones too) and the list of files, as JSON
//   GET    /activity                     the owner's activity page         GET /api/audit?limit&before&kind   the same as JSON
//
// Every one of them has the edge rules of the rest of the app: Origin and CSRF on what writes (app.mjs applies them to every request that changes something), a rate limit, the body
// limit. A bearer (the owner's computer) reaches none of them: /api/me/export, /api/audit and the pages are outside its scope, and the export of an app is refused to it here — it takes
// copies with the snapshot routes.
import { isSlug } from './actor.mjs'
import { GROUPS, isFilter, sentence } from './audit.mjs'
import { accountPage, activityPage, goodbye, privacyPage } from './html.mjs'
import { normEmail } from './invitation.mjs'
import { exportAppChunks, exportPerson } from './privacy.mjs'

const NO_STORE = { 'cache-control': 'no-store' }
const day = (ms) => new Date(ms).toISOString().slice(0, 10)

/**
 * `deps`: `app` (Hono), `guards` `{ needMember, needOwner, needHtml (owner? → middleware) }`, `store`, `audit`, `authDb`, `apps`, `limits` `{ read, erase, exports }`, `ipOf(c)`, `tooMany(c, answer, scope)`,
 * `now`, `csrfFor(c)`, `privacy` `{ region, contact, mailProvider }`, `days` `{ session, activity }`, `eraseAccount(userId) → Promise<{ ok, … }>`, `signOutCookies(headers) → Promise<string[]>`,
 * `roleLabel(id)`, `nameOf(userId) → string | null`.
 */
export function mountAccount (deps) {
  const { app, guards, store, audit, authDb, apps, limits, ipOf, tooMany, now, csrfFor, privacy, days, eraseAccount, signOutCookies, roleLabel, nameOf } = deps
  const { needMember, needOwner, needHtml } = guards
  const page = needHtml(false)
  const ownerPage = needHtml(true)
  const notBearer = async (c, next) => (c.get('bearer') === true ? c.json({ ok: false, error: 'forbidden', reason: 'bearer-scope' }, 403) : next())
  /** Null when the person may go on, else the 429 to send. */
  const slowDown = (c) => { const r = limits.read.hit(c.get('me')?.user?.id ?? ipOf(c)); return r.ok ? null : tooMany(c, r) }
  const attachment = (name, type) => ({ ...NO_STORE, 'content-type': type, 'content-disposition': 'attachment; filename="' + name + '"', 'x-content-type-options': 'nosniff' })

  // ── the privacy page: public ──
  app.get('/privacy', (c) => {
    const r = limits.read.hit(ipOf(c))
    if (!r.ok) return tooMany(c, r)
    return c.html(privacyPage({ contact: privacy.contact, region: privacy.region, sessionDays: days.session, activityDays: days.activity, mailProvider: privacy.mailProvider }))
  })

  // ── a person's own page ──
  const accountView = (c, notice, status = 200) => {
    const me = c.get('me')
    const owner = me.actor.role === 'owner'
    const names = owner ? apps.names() : []
    return c.html(accountPage({
      person: { name: me.user.name, email: me.user.email ?? '', profile: owner ? 'Owner' : roleLabel(me.member?.role), joined: me.member === null || me.member === undefined ? null : new Date(me.member.created_at).toISOString() },
      owner,
      apps: names,
      csrf: csrfFor(c),
      notice,
    }), status)
  }
  app.get('/account', page, (c) => slowDown(c) ?? accountView(c))

  const notOwner = { ok: false, error: 'owner', message: 'The owner cannot delete their own account here. Export the data, then take the app out of the space.' }
  /** The erasure of the signed-in member's own account. `{ status, body, cookies }`: the cookies end the session in this browser. */
  async function deleteMe (c, confirm) {
    const me = c.get('me')
    if (me.actor.role === 'owner') return { status: 403, body: notOwner }
    const lim = limits.erase.hit(me.user.id)
    if (!lim.ok) return { status: 429, limited: lim }
    if (normEmail(confirm) === null || normEmail(confirm) !== normEmail(me.member.email)) return { status: 400, body: { ok: false, error: 'confirm', message: 'Type your own email address to confirm.' } }
    const cookies = await signOutCookies(c.req.raw.headers)
    const done = await eraseAccount(me.user.id)
    if (!done.ok) return { status: 500, body: { ok: false, error: 'server-error' } }
    audit.record('member.self_deleted', { actor: me.user.id, ip: ipOf(c), detail: { role: me.member.role } })
    return { status: 200, body: { ok: true }, cookies }
  }
  app.delete('/api/me', needMember, async (c) => {
    const body = await c.req.json().catch(() => null)
    const r = await deleteMe(c, body !== null && typeof body === 'object' ? body.confirm : undefined)
    if (r.limited) return tooMany(c, r.limited, 'erase')
    const res = c.json(r.body, r.status)
    for (const ck of r.cookies ?? []) res.headers.append('set-cookie', ck)
    return res
  })
  app.post('/account/delete', page, async (c) => {
    const f = await c.req.parseBody()
    const r = await deleteMe(c, f.confirm)
    if (r.limited) return tooMany(c, r.limited, 'erase')
    if (r.status !== 200) return accountView(c, { text: r.body.message ?? 'That did not work.', bad: true }, r.status)
    const res = c.html(goodbye())
    for (const ck of r.cookies ?? []) res.headers.append('set-cookie', ck)
    return res
  })

  // ── what the space holds about the person ──
  app.get('/api/me/export', needMember, (c) => {
    const me = c.get('me')
    const lim = limits.exports.hit(me.user.id)
    if (!lim.ok) return tooMany(c, lim, 'export')
    const data = exportPerson({ db: authDb, store, userId: me.user.id, sessionId: me.sessionId, now, roleLabel })
    if (data === null) return c.json({ ok: false, error: 'unknown' }, 404)
    audit.record('export.me', { actor: me.user.id, ip: ipOf(c) })
    return new Response(JSON.stringify({ ok: true, ...data }, null, 2) + '\n', { headers: attachment('my-data-' + day(now()) + '.json', 'application/json; charset=utf-8') })
  })

  // ── the owner's export of an app ──
  app.get('/api/apps/:slug/export.json', needMember, needOwner, notBearer, (c) => {
    const slug = c.req.param('slug')
    const service = isSlug(slug) ? apps.service(slug) : null
    if (service === null) return c.json({ ok: false, error: 'unknown', message: 'no such app' }, 404)
    const me = c.get('me')
    const lim = limits.exports.hit(me.user.id)
    if (!lim.ok) return tooMany(c, lim, 'export')
    audit.record('export.app', { actor: me.user.id, ip: ipOf(c), detail: { app: slug } })
    const chunks = exportAppChunks({ service, slug, now })
    const enc = new TextEncoder()
    const body = new ReadableStream({
      pull (controller) {
        try {
          const next = chunks.next()
          if (next.done) controller.close(); else controller.enqueue(enc.encode(next.value))
        } catch (e) { controller.error(e) }
      },
      cancel () { chunks.return() },
    })
    return new Response(body, { headers: attachment(slug + '-export-' + day(now()) + '.json', 'application/json; charset=utf-8') })
  })

  // ── the activity log: the owner's ──
  const parse = (c) => {
    const limitText = c.req.query('limit')
    const beforeText = c.req.query('before')
    const filter = c.req.query('kind') ?? ''
    const limit = limitText === undefined ? 50 : Number(limitText)
    const before = beforeText === undefined ? undefined : Number(beforeText)
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) return { error: 'limit is a whole number from 1 to 200' }
    if (before !== undefined && (!Number.isInteger(before) || before < 1)) return { error: 'before is the id of an event' }
    if (!isFilter(filter)) return { error: 'kind is a kind of event or one of its groups' }
    return { limit, before, filter }
  }
  const names = {
    actor: (id) => nameOf(id),
    role: (id) => roleLabel(id),
  }
  const withText = (page) => ({ ...page, events: page.events.map((e) => ({ ...e, text: sentence(e, names) })) })
  app.get('/api/audit', needMember, needOwner, (c) => {
    const slow = slowDown(c)
    if (slow !== null) return slow
    const q = parse(c)
    if (q.error !== undefined) return c.json({ ok: false, error: 'invalid', message: q.error }, 400)
    const out = withText(audit.list(q))
    return c.json({ ok: true, ...out }, 200, NO_STORE)
  })
  app.get('/activity', ownerPage, (c) => {
    const slow = slowDown(c)
    if (slow !== null) return slow
    const q = parse(c)
    const bad = q.error !== undefined
    const out = withText(audit.list(bad ? {} : q))
    c.header('cache-control', 'no-store')
    return c.html(activityPage({ events: out.events, filter: bad ? '' : q.filter, groups: GROUPS, next: out.next, newer: !bad && q.before !== undefined }), bad ? 400 : 200)
  })
}
