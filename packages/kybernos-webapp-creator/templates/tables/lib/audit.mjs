// audit.mjs — the activity log of the team space: who did what, kept 90 days in auth.sqlite beside the rest. Takes a node:sqlite handle; no other dependency.
//
//   audit(id, at, kind, actor, subject, ip, detail)
//
// Append-only: triggers refuse any UPDATE or DELETE of a row unless the one maintenance function below (retention, the cap, the erasure of a person) has opened the gate for
// the length of its statement. Everything is written through ONE function, `record`, which redacts: it takes a kind it knows, two opaque ids, a network address and a few named
// details, and keeps only what its tables of allowed shapes accept.
//
//   - the actor and the subject are opaque ids (a user id, an invitation id) or a fixed label; never an address or a name;
//   - the network address is stored as a short keyed hash, never as an address;
//   - an e-mail address is stored masked (`a***@example.com`), and only when it has the shape of one: a password typed into the wrong box is dropped, not kept;
//   - a detail not on the kind's list is dropped, and so is one that fails its check. No secret, token, link, password or message body has a place in any column.
//
// A write that fails never reaches the request that caused it: `record` answers false and says why in the log, nothing more.
import { createHmac } from 'node:crypto'

export const RETENTION_DAYS = 90
const RETENTION_MS = RETENTION_DAYS * 24 * 3600 * 1000
/** The most rows the log keeps whatever their age: a flood of refused requests cannot fill the disk. The oldest go first. */
export const MAX_ROWS = 100_000

const ID = /^[A-Za-z0-9_-]{1,64}$/
const WORD = /^[a-z][a-z0-9_-]{0,23}$/
const SLUG = /^[a-z][a-z0-9-]{0,39}$/
const MAIL_LOCAL = /^[^\s@<>"',;]{1,64}$/
const MAIL_DOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/
/** The labels an actor may carry instead of a user id. */
const FIXED_ACTORS = new Set(['owner-token'])

/** `a***@example.com` for an address, or undefined for anything that does not have the shape of one. */
export function maskEmail (v) {
  if (typeof v !== 'string') return undefined
  const s = v.trim().toLowerCase()
  const at = s.lastIndexOf('@')
  if (at < 1 || s.length > 254) return undefined
  const local = s.slice(0, at)
  const domain = s.slice(at + 1)
  if (!MAIL_LOCAL.test(local) || !MAIL_DOMAIN.test(domain)) return undefined
  return Array.from(local)[0] + '***@' + domain
}

const oneOf = (...words) => (v) => (typeof v === 'string' && words.includes(v) ? v : undefined)
const word = (v) => (typeof v === 'string' && WORD.test(v) ? v : undefined)
const slug = (v) => (typeof v === 'string' && SLUG.test(v) ? v : undefined)
const DETAIL = {
  role: word,
  email: maskEmail,
  app: slug,
  mail: oneOf('sent', 'failed', 'link'),
  reason: oneOf('malformed', 'bad-signature', 'expired', 'reused'),
  scope: oneOf('signin', 'signin-ip', 'open', 'accept', 'invite', 'bearer', 'bearer-bad', 'erase', 'export'),
  what: oneOf('bundle', 'manifest', 'db'),
}

/** The kinds, each with the group it is filtered under and the details it may carry. */
export const KINDS = Object.freeze({
  'signin.ok': { group: 'signin', detail: ['role'] },
  'signin.failed': { group: 'signin', detail: ['email'] },
  'owner.open': { group: 'owner', detail: [] },
  'owner.open.refused': { group: 'owner', detail: ['reason'] },
  'password.changed': { group: 'owner', detail: [] },
  'invite.sent': { group: 'invitations', detail: ['role', 'email', 'mail'] },
  'invite.resent': { group: 'invitations', detail: ['role', 'email', 'mail'] },
  'invite.revoked': { group: 'invitations', detail: ['role', 'email'] },
  'invite.accepted': { group: 'invitations', detail: ['role', 'email'] },
  'invite.role': { group: 'invitations', detail: ['role'] },
  'member.removed': { group: 'people', detail: ['role'] },
  'member.role': { group: 'people', detail: ['role'] },
  'member.self_deleted': { group: 'people', detail: ['role'] },
  'export.app': { group: 'exports', detail: ['app'] },
  'export.me': { group: 'exports', detail: [] },
  'export.snapshot': { group: 'exports', detail: ['app', 'what'] },
  'app.imported': { group: 'transfers', detail: ['app'] },
  'app.released': { group: 'transfers', detail: ['app'] },
  'ratelimit': { group: 'refusals', detail: ['scope'] },
})

export const GROUPS = Object.freeze({
  signin: 'Sign-ins',
  invitations: 'Invitations',
  people: 'People',
  exports: 'Exports',
  owner: 'Owner link and password',
  transfers: 'App transfers',
  refusals: 'Refused requests',
})

const kindsOf = (filter) => {
  if (typeof filter !== 'string' || filter === '') return null
  if (Object.hasOwn(KINDS, filter)) return [filter]
  if (Object.hasOwn(GROUPS, filter)) return Object.keys(KINDS).filter((k) => KINDS[k].group === filter)
  return undefined
}

/** Is this a filter `list` understands: nothing, a kind, or a group? */
export const isFilter = (filter) => kindsOf(filter) !== undefined

/** The log over a node:sqlite handle. `secret` keys the hash of network addresses; `now` is the clock; `log(message)` hears about failures. */
export function makeAudit (db, { secret, now = Date.now, log = () => {}, maxRows = MAX_ROWS, retentionMs = RETENTION_MS } = {}) {
  const key = createHmac('sha256', String(secret ?? '')).update('kybernos-tables/audit-network').digest()
  const hashIp = (ip) => (typeof ip === 'string' && ip !== '' ? createHmac('sha256', key).update(ip).digest('hex').slice(0, 8) : null)

  db.exec(`
    CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, kind TEXT NOT NULL, actor TEXT, subject TEXT, ip TEXT, detail TEXT NOT NULL DEFAULT '{}');
    CREATE INDEX IF NOT EXISTS audit_at ON audit (at);
    CREATE INDEX IF NOT EXISTS audit_kind ON audit (kind, id);
    CREATE TABLE IF NOT EXISTS audit_gate (open INTEGER NOT NULL);
    CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit WHEN NOT EXISTS (SELECT 1 FROM audit_gate) BEGIN SELECT RAISE(ABORT, 'the activity log is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit WHEN NOT EXISTS (SELECT 1 FROM audit_gate) BEGIN SELECT RAISE(ABORT, 'the activity log is append-only'); END;
  `)
  const insert = db.prepare('INSERT INTO audit (at, kind, actor, subject, ip, detail) VALUES (?, ?, ?, ?, ?, ?)')
  let sinceCap = 0

  /** Runs `fn` with the gate open: a savepoint, so it nests in whatever transaction the connection is in, and a failure leaves the gate shut. */
  function maintenance (fn) {
    db.exec('SAVEPOINT audit_maintenance')
    try {
      db.exec('INSERT INTO audit_gate (open) VALUES (1)')
      const out = fn()
      db.exec('DELETE FROM audit_gate')
      db.exec('RELEASE audit_maintenance')
      return out
    } catch (e) {
      try { db.exec('ROLLBACK TO audit_maintenance; RELEASE audit_maintenance') } catch (e2) { /* the connection is gone */ }
      throw e
    }
  }

  function prune () {
    return maintenance(() => {
      let removed = db.prepare('DELETE FROM audit WHERE at < ?').run(now() - retentionMs).changes
      const over = Number(db.prepare('SELECT count(*) AS n FROM audit').get().n) - maxRows
      if (over > 0) removed += db.prepare('DELETE FROM audit WHERE id IN (SELECT id FROM audit ORDER BY id LIMIT ?)').run(over).changes
      return Number(removed)
    })
  }

  return {
    hashIp,

    /**
     * Writes one event. `kind` must be one of KINDS; `actor` a user id or a fixed label (`owner-token`); `subject` an opaque id; `ip` the raw network address (kept as a hash);
     * `detail` the named details of the kind. Answers true when a row was written, false (and a line in the log, no value in it) when it was refused or failed.
     */
    record (kind, { actor, subject, ip, detail } = {}) {
      try {
        const spec = Object.hasOwn(KINDS, kind) ? KINDS[kind] : undefined
        if (spec === undefined) { log('audit: unknown kind refused'); return false }
        const who = typeof actor === 'string' && (FIXED_ACTORS.has(actor) || ID.test(actor)) ? actor : null
        const what = typeof subject === 'string' && ID.test(subject) ? subject : null
        const kept = {}
        if (detail !== null && typeof detail === 'object') for (const name of spec.detail) { const v = DETAIL[name](detail[name]); if (v !== undefined) kept[name] = v }
        insert.run(now(), kind, who, what, hashIp(ip), JSON.stringify(kept))
        if (++sinceCap >= 500) { sinceCap = 0; try { prune() } catch (e) { log('audit: the cap pass failed') } }
        return true
      } catch (e) {
        log('audit: a write failed (' + String((e && e.code) || (e && e.name) || 'error').slice(0, 40) + ')')
        return false
      }
    },

    /** Newest first: `{ events: [{ id, at, kind, group, actor, subject, ip, detail }], next }` where `next` is the cursor for the older page (or null). `filter`: a kind or a group. */
    list ({ limit = 50, before, filter } = {}) {
      const kinds = kindsOf(filter)
      const n = Number.isInteger(limit) ? Math.min(200, Math.max(1, limit)) : 50
      const where = []
      const args = []
      if (Number.isInteger(before) && before > 0) { where.push('id < ?'); args.push(before) }
      if (kinds === undefined) return { events: [], next: null }
      if (kinds !== null) { where.push('kind IN (' + kinds.map(() => '?').join(',') + ')'); args.push(...kinds) }
      const rows = db.prepare('SELECT id, at, kind, actor, subject, ip, detail FROM audit' + (where.length === 0 ? '' : ' WHERE ' + where.join(' AND ')) + ' ORDER BY id DESC LIMIT ?').all(...args, n + 1)
      const page = rows.slice(0, n).map((r) => ({ id: Number(r.id), at: Number(r.at), kind: r.kind, group: Object.hasOwn(KINDS, r.kind) ? KINDS[r.kind].group : 'other', actor: r.actor, subject: r.subject, ip: r.ip, detail: JSON.parse(r.detail) }))
      return { events: page, next: rows.length > n ? page[page.length - 1].id : null }
    },

    count: () => Number(db.prepare('SELECT count(*) AS n FROM audit').get().n),

    /** Drops what is older than the retention and what is over the cap. Answers how many rows went. */
    prune,

    /**
     * The erasure of a person: the rows about these subjects (their user id), and every row that carries one of these masked addresses, lose the address they carried. The rows
     * stay: they say that something happened, no longer to whom. A row that only shares a masked address (`a***@example.com`) with the person loses it too: a hint is lost, nothing else.
     */
    forget ({ subjects = [], masks = [] } = {}) {
      const ids = subjects.filter((s) => typeof s === 'string' && ID.test(s))
      const needles = masks.filter((m) => typeof m === 'string' && m !== '').map((m) => '"email":' + JSON.stringify(m))
      if (ids.length === 0 && needles.length === 0) return 0
      return maintenance(() => {
        const rows = new Map()
        for (const id of ids) for (const r of db.prepare('SELECT id, detail FROM audit WHERE subject = ?').all(id)) rows.set(r.id, r.detail)
        for (const needle of needles) for (const r of db.prepare('SELECT id, detail FROM audit WHERE instr(detail, ?) > 0').all(needle)) rows.set(r.id, r.detail)
        let changed = 0
        for (const [id, detail] of rows) {
          const d = JSON.parse(detail)
          if (!('email' in d)) continue
          delete d.email
          d.erased = true
          db.prepare('UPDATE audit SET detail = ? WHERE id = ?').run(JSON.stringify(d), id)
          changed += 1
        }
        return changed
      })
    },
  }
}

/** A log that writes nothing: what the app runs on if the real one could not be set up. */
export const silentAudit = Object.freeze({ hashIp: () => null, record: () => false, list: () => ({ events: [], next: null }), count: () => 0, prune: () => 0, forget: () => 0 })

// ── the sentences ──

const ROLE_WORDS = { owner: 'the owner' }
const REASONS = { malformed: 'it was not a link of this space', 'bad-signature': 'it was not signed by this space', expired: 'it had expired', reused: 'it had been used already' }
const SCOPES = { signin: 'sign-in attempts', 'signin-ip': 'sign-in attempts', open: 'owner link attempts', accept: 'invitation attempts', invite: 'invitations', bearer: 'owner-token requests', 'bearer-bad': 'wrong owner tokens', erase: 'account deletions', export: 'exports' }

/**
 * One event as a sentence a person can read. `names.actor(id)` gives the name or address of a person still in the team (or null), `names.role(id)` a profile's label.
 * Pure: strings in, a string out.
 */
export function sentence (event, names = {}) {
  const d = event.detail ?? {}
  const roleLabel = (id) => (typeof id === 'string' ? (names.role?.(id) ?? ROLE_WORDS[id] ?? id) : '')
  const who = event.actor === 'owner-token' ? "The owner's computer" : event.actor === null || event.actor === undefined ? 'Someone' : (names.actor?.(event.actor) ?? 'A former member')
  const as = d.role === undefined ? '' : ' as ' + roleLabel(d.role)
  const to = d.email !== undefined ? d.email : d.erased === true ? 'someone whose details were erased' : 'someone by link'
  const mail = d.mail === 'sent' ? ' The e-mail was sent.' : d.mail === 'failed' ? ' The e-mail could not be sent; the owner got the link instead.' : ''
  switch (event.kind) {
    case 'signin.ok': return who + ' signed in.'
    case 'signin.failed': return 'A sign-in failed' + (d.email === undefined ? '' : ' for ' + d.email) + '.'
    case 'owner.open': return "The owner's link was opened: the owner is signed in."
    case 'owner.open.refused': return "An owner link was refused" + (REASONS[d.reason] === undefined ? '.' : ': ' + REASONS[d.reason] + '.')
    case 'password.changed': return who + ' set a new password.'
    case 'invite.sent': return who + ' invited ' + to + as + '.' + mail
    case 'invite.resent': return who + ' sent the invitation to ' + to + ' again.' + mail
    case 'invite.revoked': return who + ' revoked the invitation for ' + to + '.'
    case 'invite.accepted': return who + ' accepted an invitation and joined' + as + '.'
    case 'invite.role': return who + ' changed the profile of a pending invitation to ' + roleLabel(d.role) + '.'
    case 'member.removed': return who + ' removed a member' + (d.role === undefined ? '' : ' (' + roleLabel(d.role) + ')') + '. Their account and address were erased.'
    case 'member.role': return who + ' changed the profile of a member to ' + roleLabel(d.role) + '.'
    case 'member.self_deleted': return 'A member' + (d.role === undefined ? '' : ' (' + roleLabel(d.role) + ')') + ' deleted their own account. Their account and address were erased.'
    case 'export.app': return who + ' downloaded the data of the app ' + (d.app ?? '') + ' as a JSON file.'
    case 'export.me': return who + ' downloaded their own data.'
    case 'export.snapshot': return who + ' downloaded a copy of the app ' + (d.app ?? '') + ' (' + (d.what === 'db' ? 'its database file' : d.what === 'manifest' ? 'the list of its files' : 'database and files') + ').'
    case 'app.imported': return who + ' put the app ' + (d.app ?? '') + ' in this space.'
    case 'app.released': return who + ' took the app ' + (d.app ?? '') + ' out of this space.'
    case 'ratelimit': return 'Too many ' + (SCOPES[d.scope] ?? 'requests') + ' from one network address: further ones were refused for a while.'
    default: return 'Something happened (' + event.kind + ').'
  }
}
