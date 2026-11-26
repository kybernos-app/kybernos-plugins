// privacy.mjs — what the team space does with a person's data on their request: show it, take it with them, erase it. And what the owner takes out: everything of an app, as JSON.
//
// The sign-in data is Better-Auth's own tables in auth.sqlite (`user`, `session`, `account`, `verification`) beside ours (`app_member`, `app_invitation`, `audit`). These functions
// take the node:sqlite handle and read or delete from those tables by name, so a test can run them on a stand-in with the same columns.
//
// What an erasure leaves, on purpose: rows of an app keep the opaque id of whoever wrote them (`member:<id>`), which after the erasure points at nobody; the activity log keeps
// that something happened, not to whom. Nothing else of the person is kept in auth.sqlite: the tests search every table and the file itself for the address and the name.
import { maskEmail } from './audit.mjs'

/** What the privacy page says about where the space lives when the operator has not said. */
export const DEFAULT_REGION = 'the EU region your team space was created in'

const nowIso = (ms) => new Date(ms).toISOString()

/** A stored date (Better-Auth writes them as text or as numbers) as an ISO string, or null. */
export function isoOf (v) {
  if (v === null || v === undefined || v === '') return null
  const d = typeof v === 'number' ? new Date(v < 1e11 ? v * 1000 : v) : new Date(/^\d+$/.test(String(v)) ? Number(v) : String(v).includes('T') ? String(v) : String(v).replace(' ', 'T') + 'Z')
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** A browser and a system in two words, from a User-Agent: « Chrome on macOS ». No version, nothing that tells one machine from another. */
export function deviceOf (ua) {
  if (typeof ua !== 'string' || ua === '') return 'Unknown device'
  const browser = /Edg(e|A|iOS)?\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\/|FxiOS\//.test(ua) ? 'Firefox' : /Chrome\/|CriOS\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /^curl\//i.test(ua) ? 'A command-line tool' : null
  const system = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux|X11/.test(ua) ? 'Linux' : null
  if (browser === null && system === null) return 'Unknown device'
  return (browser ?? 'A browser') + (system === null ? '' : ' on ' + system)
}

/**
 * What the space holds about one person, as a readable object: their name, address, profile and the date they joined, and their sessions as dates and a coarse device. No token,
 * no password hash, no network address. `sessionId` marks the session the request came with.
 */
export function exportPerson ({ db, store, userId, sessionId, now = Date.now, roleLabel = (r) => r }) {
  const member = store.member(userId)
  const user = db.prepare('SELECT id, name, email, createdAt FROM "user" WHERE id = ?').get(userId)
  if (member === null || user === undefined) return null
  const sessions = db.prepare('SELECT id, createdAt, updatedAt, expiresAt, userAgent FROM session WHERE userId = ? ORDER BY createdAt DESC').all(userId)
  return {
    format: 'kybernos-team-space-person-export/1',
    exportedAt: nowIso(now()),
    person: { id: user.id, name: user.name, email: user.email, role: member.role, profile: member.role === 'owner' ? 'Owner' : roleLabel(member.role), joined: isoOf(member.created_at) ?? isoOf(user.createdAt) },
    sessions: sessions.map((s) => ({ started: isoOf(s.createdAt), lastUsed: isoOf(s.updatedAt), expires: isoOf(s.expiresAt), device: deviceOf(s.userAgent), thisSession: s.id === sessionId })),
    notes: [
      'The rows you added or changed in an app carry an opaque id (member:' + user.id + ') as their author. It is not your name or your address; once your account is erased it points at nobody.',
      'Ask the owner of this space for the rows themselves: they belong to the team.',
    ],
  }
}

/**
 * Erases a member: their sessions, their sign-in (password hash included), their account, every invitation made for their address (used or not), their membership, and every
 * trace of the address and the name in the activity log. Then it checkpoints the write-ahead log and rebuilds the file, so the old bytes are not left lying in free pages.
 * Never the owner. `{ ok: true, erased: { sessions, invitations } }`, or `{ ok: false, error }`.
 */
export function erasePerson ({ db, store, audit, userId }) {
  const member = store.member(userId)
  if (member === null) return { ok: false, error: 'unknown' }
  if (member.role === 'owner') return { ok: false, error: 'owner' }
  const user = db.prepare('SELECT email, name FROM "user" WHERE id = ?').get(userId)
  const addresses = [...new Set([member.email, user === undefined ? null : user.email].filter((x) => typeof x === 'string' && x !== ''))]
  const run = (sql, ...args) => Number(db.prepare(sql).run(...args).changes)
  let sessions = 0
  let invitations = 0
  const invitationIds = []
  db.exec('SAVEPOINT erase_person')
  try {
    for (const a of addresses) invitationIds.push(...store.invitationsFor(a))
    sessions = run('DELETE FROM session WHERE userId = ?', userId)
    run('DELETE FROM account WHERE userId = ?', userId)
    for (const a of addresses) run('DELETE FROM verification WHERE identifier = ?', a)
    run('DELETE FROM "user" WHERE id = ?', userId)
    for (const a of addresses) invitations += run('DELETE FROM app_invitation WHERE email = ?', a)
    store.removeMember(userId)
    if (audit !== undefined) audit.forget({ subjects: [userId, ...invitationIds], masks: addresses.map(maskEmail).filter(Boolean) })
    db.exec('RELEASE erase_person')
  } catch (e) {
    try { db.exec('ROLLBACK TO erase_person; RELEASE erase_person') } catch (e2) { /* the connection is gone */ }
    throw e
  }
  scrub(db)
  return { ok: true, erased: { sessions, invitations } }
}

/** Takes the old pages out of the file: a checkpoint that empties the log, a rebuild of the file, and a second checkpoint for the log that rebuild wrote. Best effort. */
export function scrub (db) {
  for (const sql of ['PRAGMA wal_checkpoint(TRUNCATE)', 'VACUUM', 'PRAGMA wal_checkpoint(TRUNCATE)']) {
    try { db.exec(sql) } catch (e) { /* a busy or in-memory database: the rows are gone either way */ }
  }
}

// ── the owner's export of an app ──

const J = (v) => JSON.stringify(v)
const indent = (v, by) => J2(v).split('\n').map((l, i) => (i === 0 ? l : by + l)).join('\n')
const J2 = (v) => JSON.stringify(v, null, 2)

/**
 * The whole of an app as JSON text, in pieces: the definitions of every table (fields, views), every record (archived ones too, one per line), the profiles, and the list of
 * files the records hold with their names, types, sizes and hashes (the files themselves are not in it: the full copy of the app has them). `service` is the app's
 * kybernos-db service (agent/service.mjs). A generator, so a big app is written as it is read.
 */
export function * exportAppChunks ({ service, slug, now = Date.now }) {
  yield '{\n  "format": "kybernos-team-space-export/1",\n  "exportedAt": ' + J(nowIso(now())) + ',\n  "app": ' + J(slug) + ',\n  "note": ' +
    J('Everything of this app, as the owner sees it: tables with their fields and views, every record (archived ones carry a "deleted" stamp), the profiles, and the list of files. The files themselves are in the full copy of the app.') + ',\n  "databases": ['
  let firstDb = true
  for (const entry of service.list()) {
    yield (firstDb ? '\n' : ',\n') + '    {\n      "id": ' + J(entry.id) + ',\n      "name": ' + J(entry.name) + ',\n      "archived": ' + J(entry.archived ?? null) + ','
    firstDb = false
    const opened = service.byId(entry.id)
    if (!opened.ok) { yield '\n      "error": ' + J('this database could not be opened (' + opened.code + ')') + ',\n      "profiles": [],\n      "tables": [],\n      "files": []\n    }'; continue }
    const db = opened.db
    yield '\n      "profiles": ' + indent(db.profiles(), '      ') + ',\n      "tables": ['
    const files = []
    let firstTable = true
    for (const object of db.objects({ all: true })) {
      const attachments = object.fields.filter((f) => f.type === 'attachment').map((f) => f.key)
      yield (firstTable ? '\n' : ',\n') + '        {\n          "key": ' + J(object.key) + ',\n          "label": ' + J(object.label) + ',\n          "archived": ' + J(object.archived ?? null) + ',\n          "definition": ' + indent(object, '          ') + ',\n          "views": ' + indent(db.listViews(object.key), '          ') + ',\n          "records": ['
      firstTable = false
      let firstRecord = true
      for (const rec of db.list(object.key, { deleted: 'all' })) {
        yield (firstRecord ? '\n' : ',\n') + '            ' + J({ id: rec.id, values: rec.values, rev: rec.rev, created: rec.created, modified: rec.modified, deleted: rec.deleted })
        firstRecord = false
        for (const field of attachments) for (const f of Array.isArray(rec.values[field]) ? rec.values[field] : []) files.push({ table: object.key, record: rec.id, field, name: f.name, type: f.type, size: f.size, hash: f.hash })
      }
      yield (firstRecord ? '' : '\n          ') + ']\n        }'
    }
    yield (firstTable ? '' : '\n      ') + '],\n      "files": ' + indent(files, '      ') + '\n    }'
  }
  yield (firstDb ? '' : '\n  ') + ']\n}\n'
}
