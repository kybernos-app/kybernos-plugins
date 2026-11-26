// test-tables-privacy.mjs — the people's data rights and the activity log of the tables template, with no web server: the log (what it keeps, what it refuses to keep, that it is
// append-only, how long it lives), a person's export, the erasure of a person (searched for in every table and in the file itself), the owner's export of an app, and the pages
// that say all this. Needs node:sqlite and kybernos-db only (found in this repository).
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { GROUPS, KINDS, MAX_ROWS, RETENTION_DAYS, isFilter, makeAudit, maskEmail, sentence, silentAudit } from './templates/tables/lib/audit.mjs'
import { accountPage, activityPage, goodbye, invitePage, notice, peoplePage, privacyPage } from './templates/tables/lib/html.mjs'
import { DEFAULT_REGION, deviceOf, erasePerson, exportAppChunks, exportPerson, isoOf } from './templates/tables/lib/privacy.mjs'
import { makeStore } from './templates/tables/lib/store.mjs'
import { settingText } from './templates/tables/lib/boot.mjs'

let count = 0
const ok = async (label, fn) => { await fn(); count++; console.log('ok  ', label) }
const root = mkdtempSync(join(tmpdir(), 'kb-tables-privacy-'))
const DAY = 24 * 3600 * 1000
const clock = () => { const c = { t: Date.UTC(2026, 9, 31, 9, 0, 0), now: () => c.t, advance: (ms) => { c.t += ms } }; return c }
const SECRET = 'a'.repeat(40)

try {
  // ── the log ──

  await ok('masking: an address keeps its first letter and its domain; anything that is not shaped like an address is dropped, so a password typed in the wrong box is not kept', () => {
    assert.equal(maskEmail('Alice@Example.test'), 'a***@example.test')
    assert.equal(maskEmail(' bob.smith+tag@mail.example.co.uk '), 'b***@mail.example.co.uk')
    for (const bad of ['hunter2', 'P@ss word', 'x@y', 'a@b.c', '@example.test', 'a@@example.test', 'a@exa mple.test', 'Tr0ub4dor&3', 'p@55.w0rd', '', null, undefined, 42, 'a@' + 'x'.repeat(300) + '.test']) assert.equal(maskEmail(bad), undefined, String(bad))
  })

  await ok('the log keeps what a kind allows, as opaque ids, a masked address and a keyed hash; the rest is dropped, and no secret reaches the table', () => {
    const c = clock()
    const db = new DatabaseSync(':memory:')
    const audit = makeAudit(db, { secret: SECRET, now: c.now })
    const planted = ['hunter2-PASSWORD', 'https://team.example.com/invite?t=LINK-TOKEN-abcdef.0123456789', 'Bearer BEARER-SECRET-xyz', 'BODY: dear ann, click here', 'alice@example.test', 'Alice Martin']
    assert.equal(audit.record('signin.failed', { ip: '203.0.113.7', detail: { email: 'Alice@Example.test', password: planted[0], link: planted[1], authorization: planted[2], body: planted[3], name: planted[5] } }), true)
    assert.equal(audit.record('invite.sent', { actor: 'user_1', subject: 'inv_1', ip: '203.0.113.7', detail: { role: 'member', email: planted[4], mail: 'failed', link: planted[1], text: planted[3] } }), true)
    assert.equal(audit.record('ratelimit', { ip: '203.0.113.7', detail: { scope: 'signin' } }), true)
    // arguments in the wrong places: an address as the actor, a link as the subject, a password as a role
    assert.equal(audit.record('member.role', { actor: planted[4], subject: planted[1], detail: { role: planted[0] } }), true)
    assert.equal(audit.record('invite.sent', { actor: 'u2', subject: 'Alice Martin', detail: { role: 'Bearer abc', email: 'not an address', mail: planted[3] } }), true)
    assert.equal(audit.record('no.such.kind', { actor: 'u1' }), false, 'a kind the log does not know is refused')
    assert.equal(audit.record('__proto__', { actor: 'u1' }), false)
    assert.equal(audit.record('export.app', { detail: { app: '../etc/passwd' } }), true)
    const dump = JSON.stringify(db.prepare('SELECT * FROM audit').all())
    for (const secret of [...planted, '203.0.113.7', 'passwd', 'Bearer', 'BODY']) assert.equal(dump.includes(secret), false, 'the table does not hold: ' + secret)
    const rows = db.prepare('SELECT * FROM audit ORDER BY id').all()
    assert.equal(rows[0].detail, '{"email":"a***@example.test"}')
    assert.match(rows[0].ip, /^[0-9a-f]{8}$/, 'a short code, not an address')
    assert.equal(rows[0].ip, rows[1].ip, 'the same network gives the same code…')
    assert.equal(rows[0].ip, makeAudit(new DatabaseSync(':memory:'), { secret: SECRET }).hashIp('203.0.113.7'), '…across restarts with the same secret')
    assert.notEqual(rows[0].ip, makeAudit(new DatabaseSync(':memory:'), { secret: 'b'.repeat(40) }).hashIp('203.0.113.7'), '…and it cannot be recomputed without the secret')
    assert.deepEqual([rows[1].actor, rows[1].subject, rows[1].detail], ['user_1', 'inv_1', '{"role":"member","email":"a***@example.test","mail":"failed"}'])
    assert.deepEqual([rows[3].actor, rows[3].subject, rows[3].detail], [null, null, '{}'], 'what is not an id, a role or a masked address is not stored')
    assert.equal(rows[4].subject, null)
    assert.equal(rows[4].detail, '{}')
    assert.equal(rows[5].detail, '{}', 'a path is not an app')
    for (const spec of Object.values(KINDS)) assert.ok(Object.hasOwn(GROUPS, spec.group), spec.group)
  })

  await ok('append-only: no UPDATE and no DELETE of a row goes through from outside, and a maintenance that fails leaves the gate shut and the rows in place', () => {
    const c = clock()
    const db = new DatabaseSync(':memory:')
    const audit = makeAudit(db, { secret: SECRET, now: c.now })
    audit.record('signin.ok', { actor: 'u1', detail: { role: 'owner' } })
    assert.throws(() => db.exec("UPDATE audit SET kind = 'signin.failed'"), /append-only/)
    assert.throws(() => db.exec('DELETE FROM audit'), /append-only/)
    assert.equal(audit.count(), 1)
    // a maintenance that fails half way: the gate it opened closes again with the rest of its work
    c.advance(100 * DAY)
    db.exec("CREATE TRIGGER boom BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT, 'boom'); END")
    assert.throws(() => audit.prune(), /boom/)
    db.exec('DROP TRIGGER boom')
    assert.equal(db.prepare('SELECT count(*) AS n FROM audit_gate').get().n, 0, 'the gate is shut')
    assert.throws(() => db.exec('DELETE FROM audit'), /append-only/)
    assert.equal(audit.count(), 1, 'nothing was lost')
    assert.equal(audit.prune(), 1, 'the next pass works')
    // a log that was set up twice (a restart) keeps its rows and its triggers
    audit.record('signin.ok', { actor: 'u2' })
    const again = makeAudit(db, { secret: SECRET, now: c.now })
    assert.equal(again.count(), 1)
    assert.throws(() => db.exec('DELETE FROM audit'), /append-only/)
  })

  await ok('retention: 90 days, then the row goes (at start, daily, and every few hundred writes); a cap bounds a flood', () => {
    assert.equal(RETENTION_DAYS, 90)
    const c = clock()
    const db = new DatabaseSync(':memory:')
    const audit = makeAudit(db, { secret: SECRET, now: c.now })
    audit.record('signin.ok', { actor: 'old' })
    c.advance(89 * DAY)
    audit.record('signin.ok', { actor: 'mid' })
    c.advance(DAY - 1000)
    assert.equal(audit.prune(), 0, 'just under 90 days: nothing goes')
    c.advance(2000)
    assert.equal(audit.prune(), 1, 'past 90 days: the oldest row goes')
    assert.deepEqual(audit.list().events.map((e) => e.actor), ['mid'])
    const small = makeAudit(new DatabaseSync(':memory:'), { secret: SECRET, now: c.now, maxRows: 600 })
    for (let i = 0; i < 1300; i++) small.record('ratelimit', { detail: { scope: 'signin' } })
    assert.ok(small.count() <= 1100, 'the cap holds while writes go on: ' + small.count())
    assert.equal(small.prune() >= 0, true)
    assert.equal(small.count(), 600, 'a pass brings it to the cap, keeping the newest')
    assert.equal(MAX_ROWS, 100_000)
  })

  await ok('listing: newest first, paged by a cursor, filtered by a kind or a group; a bad filter is not a filter', () => {
    const c = clock()
    const audit = makeAudit(new DatabaseSync(':memory:'), { secret: SECRET, now: c.now })
    for (let i = 0; i < 7; i++) { audit.record(i % 2 === 0 ? 'signin.ok' : 'export.me', { actor: 'u' + i }); c.advance(1000) }
    const first = audit.list({ limit: 3 })
    assert.deepEqual(first.events.map((e) => e.actor), ['u6', 'u5', 'u4'])
    assert.equal(first.next, first.events[2].id)
    const second = audit.list({ limit: 3, before: first.next })
    assert.deepEqual(second.events.map((e) => e.actor), ['u3', 'u2', 'u1'])
    assert.deepEqual(audit.list({ limit: 3, before: second.next }).events.map((e) => e.actor), ['u0'])
    assert.equal(audit.list({ limit: 3, before: second.next }).next, null)
    assert.deepEqual(audit.list({ filter: 'signin' }).events.map((e) => e.actor), ['u6', 'u4', 'u2', 'u0'], 'by group')
    assert.deepEqual(audit.list({ filter: 'export.me' }).events.map((e) => e.actor), ['u5', 'u3', 'u1'], 'by kind')
    assert.deepEqual(audit.list({ filter: 'nonsense' }), { events: [], next: null })
    assert.equal(isFilter('nonsense'), false)
    assert.equal(isFilter(''), true)
    assert.equal(isFilter('signin'), true)
    assert.equal(isFilter('__proto__'), false)
    assert.equal(audit.list({ limit: 100000 }).events.length, 7, 'the page size is capped, not trusted')
    assert.equal(audit.list({ limit: 'x', before: -4 }).events.length, 7)
    assert.equal(silentAudit.record('signin.ok', {}), false, 'the stand-in used when the log cannot be set up writes nothing and fails nothing')
  })

  await ok('sentences: each kind reads as a sentence, names come from the people still in the team, and no sentence holds more than the event does', () => {
    const names = { actor: (id) => ({ u1: 'Olga', u2: 'max@example.test' })[id] ?? null, role: (id) => ({ member: 'Team member' })[id] }
    const s = (kind, rest = {}) => sentence({ kind, actor: null, detail: {}, ...rest }, names)
    assert.equal(s('signin.ok', { actor: 'u1' }), 'Olga signed in.')
    assert.equal(s('signin.ok', { actor: 'gone' }), 'A former member signed in.', 'a person who is gone is not named')
    assert.equal(s('signin.failed', { detail: { email: 'a***@example.test' } }), 'A sign-in failed for a***@example.test.')
    assert.equal(s('signin.failed'), 'A sign-in failed.')
    assert.equal(s('invite.sent', { actor: 'u1', detail: { role: 'member', email: 'a***@example.test', mail: 'failed' } }), 'Olga invited a***@example.test as Team member. The e-mail could not be sent; the owner got the link instead.')
    assert.equal(s('invite.sent', { actor: 'u1', detail: { role: 'member' } }), 'Olga invited someone by link as Team member.')
    assert.equal(s('invite.sent', { actor: 'u1', detail: { role: 'member', erased: true } }), 'Olga invited someone whose details were erased as Team member.')
    assert.equal(s('member.removed', { actor: 'u1', detail: { role: 'member' } }), 'Olga removed a member (Team member). Their account and address were erased.')
    assert.equal(s('member.self_deleted', { actor: 'gone', detail: { role: 'member' } }), 'A member (Team member) deleted their own account. Their account and address were erased.')
    assert.equal(s('export.app', { actor: 'u1', detail: { app: 'shop' } }), 'Olga downloaded the data of the app shop as a JSON file.')
    assert.equal(s('app.imported', { actor: 'owner-token', detail: { app: 'shop' } }), "The owner's computer put the app shop in this space.")
    assert.equal(s('owner.open.refused', { detail: { reason: 'reused' } }), 'An owner link was refused: it had been used already.')
    assert.match(s('ratelimit', { detail: { scope: 'signin' } }), /^Too many sign-in attempts/)
    for (const kind of Object.keys(KINDS)) assert.match(s(kind, { actor: 'u1', detail: { role: 'member', app: 'shop' } }), /^[A-Z].*\.( .*\.)?$/, kind)
    assert.match(s('mystery.kind'), /^Something happened/)
  })

  // ── a person's data, on a stand-in with Better-Auth's own columns ──

  const AUTH_TABLES = `
    CREATE TABLE "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null);
    CREATE TABLE "session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade);
    CREATE TABLE "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);
    CREATE TABLE "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);`
  const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
  const NAME = 'Zorica Vukovic'
  const MAIL = 'zorica.vukovic@example.test'
  const HASH = 'scrypt:HASH-OF-ZORICAS-PASSWORD-0123456789abcdef'
  const TOKEN = 'SESSION-TOKEN-ZORICA-0123456789'
  const iso = (ms) => new Date(ms).toISOString()

  /** A team space's auth.sqlite on disk (WAL, secure_delete as the app sets them): an owner, Zorica, and Max who must be left alone. */
  function team (c) {
    const file = join(root, 'auth-' + Math.random().toString(36).slice(2) + '.sqlite')
    const db = new DatabaseSync(file)
    db.exec('PRAGMA journal_mode = WAL; PRAGMA secure_delete = ON')
    db.exec(AUTH_TABLES)
    const store = makeStore(db, c.now)
    const audit = makeAudit(db, { secret: SECRET, now: c.now })
    const user = (id, name, email) => db.prepare('INSERT INTO "user" VALUES (?, ?, ?, 0, NULL, ?, ?)').run(id, name, email, iso(c.t), iso(c.t))
    const session = (id, token, uid, ua, ip) => db.prepare('INSERT INTO session VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, iso(c.t + 7 * DAY), token, iso(c.t), iso(c.t + 1000), ip, ua, uid)
    const account = (id, uid, hash) => db.prepare("INSERT INTO account VALUES (?, ?, 'credential', ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?)").run(id, uid, uid, hash, iso(c.t), iso(c.t))
    user('uo', 'Owner', 'olga@example.test'); store.addMember({ userId: 'uo', email: 'olga@example.test', role: 'owner' }); account('ao', 'uo', 'scrypt:OWNER-HASH'); session('so', 'OWNER-TOKEN', 'uo', CHROME, '')
    user('uz', NAME, MAIL); store.addMember({ userId: 'uz', email: MAIL, role: 'member', invitedBy: 'uo' }); account('az', 'uz', HASH)
    session('sz1', TOKEN + '-1', 'uz', CHROME, ''); session('sz2', TOKEN + '-2', 'uz', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', '')
    db.prepare("INSERT INTO verification VALUES ('v1', ?, 'v', ?, ?, ?)").run(MAIL, iso(c.t), iso(c.t), iso(c.t))
    user('um', 'Max Ortiz', 'max.ortiz@example.test'); store.addMember({ userId: 'um', email: 'max.ortiz@example.test', role: 'member' }); account('am', 'um', 'scrypt:MAX-HASH'); session('sm', 'MAX-TOKEN', 'um', CHROME, '')
    // invitations: one still open for Zorica's address, one she used, one for Max
    store.invite({ id: 'inv1', email: MAIL, role: 'member', nonce: 'n1', exp: c.t + 7 * DAY, by: 'uo' })
    store.invite({ id: 'inv2', email: MAIL, role: 'member', nonce: 'n2', exp: c.t + 7 * DAY, by: 'uo' }); store.claimInvitation('inv2', 'n2')
    store.invite({ id: 'inv3', email: 'max.ortiz@example.test', role: 'member', nonce: 'n3', exp: c.t + 7 * DAY, by: 'uo' })
    // the log: what an owner and Zorica did, and failed sign-ins for her address
    audit.record('invite.sent', { actor: 'uo', subject: 'inv1', detail: { role: 'member', email: MAIL, mail: 'sent' } })
    audit.record('invite.sent', { actor: 'uo', subject: 'inv2', detail: { role: 'member', email: MAIL, mail: 'sent' } })
    audit.record('invite.accepted', { actor: 'uz', subject: 'uz', detail: { role: 'member', email: MAIL } })
    audit.record('signin.failed', { ip: '198.51.100.4', detail: { email: MAIL } })
    audit.record('signin.ok', { actor: 'uz', detail: { role: 'member' } })
    audit.record('invite.sent', { actor: 'uo', subject: 'inv3', detail: { role: 'member', email: 'max.ortiz@example.test', mail: 'sent' } })
    return { db, file, store, audit }
  }
  /** Every place the text can be: each column of each table, read as text, and the bytes of the file and of its write-ahead log. */
  function whereIs (db, file, needle) {
    const found = []
    for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()) {
      for (const col of db.prepare('PRAGMA table_info("' + name + '")').all()) {
        const n = Number(db.prepare('SELECT count(*) AS n FROM "' + name + '" WHERE CAST("' + col.name + '" AS TEXT) LIKE ?').get('%' + needle + '%').n)
        if (n > 0) found.push(name + '.' + col.name)
      }
    }
    for (const f of [file, file + '-wal']) if (existsSync(f) && readFileSync(f).includes(Buffer.from(needle))) found.push('file:' + f.slice(-8))
    return found
  }

  await ok('a stand-in sees what it must: before the erasure the name, the address and the hash really are in the file and in several tables', () => {
    const c = clock()
    const { db, file } = team(c)
    for (const needle of [MAIL, NAME, HASH, TOKEN]) assert.ok(whereIs(db, file, needle).length >= 1, needle)
    assert.ok(whereIs(db, file, MAIL).length >= 5, 'the address is in the user, member, invitation, verification and the file')
    // a control: deleting the rows is not enough, the old pages still hold the text until the file is cleaned; this is what the erasure has to get rid of
    db.exec('DELETE FROM verification; DELETE FROM app_invitation; DELETE FROM session WHERE userId = \'uz\'; DELETE FROM account WHERE userId = \'uz\'; DELETE FROM app_member WHERE user_id = \'uz\'; DELETE FROM "user" WHERE id = \'uz\'')
    const left = whereIs(db, file, MAIL)
    assert.ok(left.length >= 1 && left.every((x) => x.startsWith('file:')), 'plain deletes leave the bytes in the file: ' + left.join(', '))
    db.close()
  })

  await ok('erasure: the person, their sign-in, sessions, invitations and masked address go; the owner and the others stay; the file itself no longer holds a trace', () => {
    const c = clock()
    const { db, file, store, audit } = team(c)
    const r = erasePerson({ db, store, audit, userId: 'uz' })
    assert.deepEqual(r, { ok: true, erased: { sessions: 2, invitations: 2 } })
    for (const needle of [MAIL, NAME, HASH, TOKEN, 'zorica', 'Vukovic', 'z***@example.test']) assert.deepEqual(whereIs(db, file, needle), [], 'no trace of: ' + needle)
    assert.equal(store.member('uz'), null)
    assert.equal(store.memberByEmail(MAIL), null)
    assert.equal(db.prepare('SELECT count(*) AS n FROM "user" WHERE id = ?').get('uz').n, 0)
    assert.equal(store.invitation('inv1'), null)
    assert.equal(store.invitation('inv2'), null)
    // what must be left alone
    assert.equal(store.owner().email, 'olga@example.test')
    assert.equal(store.member('um').email, 'max.ortiz@example.test')
    assert.equal(db.prepare('SELECT count(*) AS n FROM session WHERE userId = ?').get('um').n, 1)
    assert.equal(db.prepare('SELECT count(*) AS n FROM account WHERE userId = ?').get('um').n, 1)
    assert.ok(store.invitation('inv3'), 'another person’s invitation is not touched')
    assert.ok(whereIs(db, file, 'max.ortiz@example.test').length >= 3)
    // the log keeps that things happened, not to whom
    const events = audit.list().events
    assert.equal(events.length, 6, 'no row of the log was removed')
    assert.equal(events.filter((e) => e.detail.email === 'z***@example.test').length, 0)
    assert.equal(events.find((e) => e.kind === 'invite.accepted').detail.erased, true)
    assert.equal(events.find((e) => e.subject === 'inv3').detail.email, 'm***@example.test', 'another person’s masked address is kept')
    assert.equal(events.find((e) => e.kind === 'signin.failed').detail.erased, true, 'a failed sign-in for her address loses it too')
    // the rows an app holds keep an opaque author id: nothing here ties it back
    assert.ok(events.some((e) => e.actor === 'uz'), 'the opaque id stays as an actor')
    assert.deepEqual(whereIs(db, file, 'Zorica'), [])
    db.close()
  })

  await ok('erasure refuses the owner and an unknown id, and changes nothing when it does', () => {
    const c = clock()
    const { db, file, store, audit } = team(c)
    assert.deepEqual(erasePerson({ db, store, audit, userId: 'uo' }), { ok: false, error: 'owner' })
    assert.deepEqual(erasePerson({ db, store, audit, userId: 'nobody' }), { ok: false, error: 'unknown' })
    assert.equal(store.owner().email, 'olga@example.test')
    assert.ok(whereIs(db, file, 'olga@example.test').length >= 3)
    assert.equal(audit.count(), 6)
    db.close()
  })

  await ok('export of a person: details, profile, sessions as dates and a coarse device, nothing secret', () => {
    const c = clock()
    const { db, store } = team(c)
    const out = exportPerson({ db, store, userId: 'uz', sessionId: 'sz2', now: c.now, roleLabel: (r) => (r === 'member' ? 'Team member' : r) })
    assert.equal(out.format, 'kybernos-team-space-person-export/1')
    assert.deepEqual(out.person, { id: 'uz', name: NAME, email: MAIL, role: 'member', profile: 'Team member', joined: iso(c.t) })
    assert.equal(out.sessions.length, 2)
    assert.deepEqual(out.sessions.map((s) => [s.device, s.thisSession]).sort(), [['Chrome on macOS', false], ['Safari on iOS', true]])
    assert.deepEqual(Object.keys(out.sessions[0]).sort(), ['device', 'expires', 'lastUsed', 'started', 'thisSession'])
    assert.equal(out.sessions[0].started, iso(c.t))
    const text = JSON.stringify(out)
    for (const secret of [HASH, TOKEN, 'scrypt', 'Mozilla', 'AppleWebKit', 'ipAddress', 'MAX-TOKEN', 'max.ortiz', 'olga@']) assert.equal(text.includes(secret), false, 'not in the export: ' + secret)
    assert.equal(exportPerson({ db, store, userId: 'nobody', now: c.now }), null)
    assert.equal(exportPerson({ db, store, userId: 'uo', now: c.now }).person.profile, 'Owner')
    db.close()
  })

  await ok('devices are told coarsely (a browser, a system, no version), dates are read from text or numbers', () => {
    assert.equal(deviceOf(CHROME), 'Chrome on macOS')
    assert.equal(deviceOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0'), 'Firefox on Windows')
    assert.equal(deviceOf('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'), 'Chrome on Android')
    assert.equal(deviceOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0'), 'Edge on Windows')
    assert.equal(deviceOf('curl/8.4.0'), 'A command-line tool')
    for (const none of ['', null, undefined, 5, 'x']) assert.equal(deviceOf(none), 'Unknown device')
    assert.equal(/\d/.test(deviceOf(CHROME)), false, 'no version number')
    assert.equal(isoOf('2026-10-31T05:41:14.448Z'), '2026-10-31T05:41:14.448Z')
    assert.equal(isoOf(Date.UTC(2026, 9, 31)), '2026-10-31T00:00:00.000Z')
    assert.equal(isoOf(Date.UTC(2026, 9, 31) / 1000), '2026-10-31T00:00:00.000Z')
    assert.equal(isoOf('2026-10-31 05:41:14'), '2026-10-31T05:41:14.000Z')
    for (const none of [null, undefined, '', 'yesterday']) assert.equal(isoOf(none), null)
  })

  // ── the owner's export of an app ──

  await ok('export of an app: every table with its fields and views, every record including archived ones, the profiles and the list of files; valid JSON, written in pieces', async () => {
    const { makeService } = await import('./templates/tables/lib/db.mjs')
    const svc = makeService({ dir: join(root, 'dbs') })
    const made = svc.create({
      name: 'Ledger Coffee', by: 'template',
      objects: [
        { key: 'customers', label: 'Customers', title: 'name', fields: [{ key: 'name', type: 'text', label: 'Name', required: true }, { key: 'email', type: 'email', label: 'Email', protection: 'personal' }, { key: 'photo', type: 'attachment', label: 'Photo' }] },
        { key: 'orders', label: 'Orders', title: 'number', fields: [{ key: 'number', type: 'text', label: 'Order', required: true }, { key: 'customer', type: 'relation', label: 'Customer', to: 'customers' }] },
        { key: 'old', label: 'Old', title: 'label', fields: [{ key: 'label', type: 'text', label: 'Label', required: true }] },
      ],
    })
    const db = made.db
    db.setProfiles([{ id: 'member', label: 'Team member', grants: [{ object: 'customers', do: ['read'] }] }], 'template')
    const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4])
    const file = db.attach(bytes, { name: 'ada.png', type: 'image/png' }, 1024).file
    const ada = db.create('customers', { name: 'Ada', email: 'ada@example.test', photo: [file] }, 'member:u1').record
    const bob = db.create('customers', { name: 'Bob' }, 'person').record
    db.create('orders', { number: '#1', customer: ada.id }, 'person')
    db.remove('customers', bob.id, 'person')
    db.create('old', { label: 'x' }, 'person')
    db.archiveObject('old', 'person')
    const chunks = [...exportAppChunks({ service: svc, slug: 'shop', now: () => Date.UTC(2026, 9, 31, 9, 0, 0) })]
    assert.ok(chunks.length > 8, 'written in pieces, not one string: ' + chunks.length)
    const text = chunks.join('')
    const out = JSON.parse(text)
    assert.equal(out.format, 'kybernos-team-space-export/1')
    assert.equal(out.app, 'shop')
    assert.equal(out.exportedAt, '2026-10-31T09:00:00.000Z')
    assert.equal(out.databases.length, 1)
    const d = out.databases[0]
    assert.equal(d.name, 'Ledger Coffee')
    assert.deepEqual(d.profiles.map((p) => p.id), ['member'])
    assert.deepEqual(d.tables.map((t) => t.key), ['customers', 'orders', 'old'], 'the archived table is in it')
    assert.deepEqual(d.tables.find((t) => t.key === 'old').archived !== null, true)
    const customers = d.tables.find((t) => t.key === 'customers')
    assert.deepEqual(customers.definition.fields.map((f) => f.key), ['name', 'email', 'photo'], 'the definitions of the fields')
    assert.equal(customers.definition.fields.find((f) => f.key === 'email').protection, 'personal')
    assert.deepEqual(customers.records.map((r) => r.values.name), ['Ada', 'Bob'], 'every record, the archived one too')
    assert.ok(customers.records.find((r) => r.values.name === 'Bob').deleted !== null)
    assert.equal(customers.records.find((r) => r.values.name === 'Ada').values.email, 'ada@example.test', 'the owner’s export is in clear')
    assert.equal(customers.records.find((r) => r.values.name === 'Ada').created.by, 'member:u1')
    assert.equal(d.tables.find((t) => t.key === 'old').records.length, 1)
    assert.deepEqual(d.files, [{ table: 'customers', record: ada.id, field: 'photo', name: 'ada.png', type: 'image/png', size: 8, hash: file.hash }])
    assert.equal(text.includes('137'), false, 'the bytes of a file are not in it')
    assert.ok(text.split('\n').length > 30, 'readable: laid out on lines, not one blob')
    // an app with no database at all is still a valid document
    const empty = makeService({ dir: join(root, 'empty') })
    const nothing = JSON.parse([...exportAppChunks({ service: empty, slug: 'none' })].join(''))
    assert.deepEqual(nothing.databases, [])
    empty.close()
    svc.close()
  })

  // ── the pages ──

  const NO_INLINE = (html) => !/<script/i.test(html) && !/<style[\s>]/i.test(html) && !/\sstyle\s*=/i.test(html) && !/\son[a-z]+\s*=/i.test(html) && !/javascript:/i.test(html)
  const view = { contact: null, region: DEFAULT_REGION, sessionDays: 7, activityDays: 90, mailProvider: null }

  await ok('the privacy page says who, what, where, how long and how each right is used; with nothing set it asks the owner and invents no address', () => {
    const html = privacyPage(view)
    const text = html.replace(/<[^>]+>/g, ' ')
    assert.ok(html.includes('The owner of this team space') && html.includes('Kybernos runs the computer'), 'who is responsible')
    for (const kept of ['Your name and email address', 'password hash', 'Session cookies', 'activity log', 'Invitations']) assert.ok(text.includes(kept), kept)
    assert.ok(text.includes('in the EU region your team space was created in'), 'the default region')
    assert.ok(text.includes('90 days') && text.includes('7 days'), 'how long')
    for (const right of ['See', 'Take it with you', 'Correct', 'Delete', 'What stays']) assert.ok(html.includes('<b>' + right + '</b>'), right)
    assert.ok(text.includes('ask the owner of this space.'), 'no contact set')
    assert.equal(/mailto:/.test(html), false, 'no address made up')
    assert.equal(/@/.test(text.replace('a***@example.com', '')), false, 'no address anywhere on the page')
    assert.equal(/complian|certif|guarantee|GDPR|RGPD|legally/i.test(text), false, 'it claims nothing about the law')
    assert.equal(text.includes('Invitation emails are sent through'), false, 'no provider is named when none is set up')
    assert.ok(NO_INLINE(html) && html.includes('href="/app.css"'))
    assert.ok(html.includes('href="/account"'))
  })

  await ok('the privacy page uses what the operator set: region, contact (an address becomes a mail link), the mail provider; all of it escaped', () => {
    const set = privacyPage({ ...view, contact: 'privacy@example.com', region: 'Frankfurt (EU)', mailProvider: 'Resend' })
    assert.ok(set.includes('in Frankfurt (EU)'))
    assert.ok(set.includes('<a href="mailto:privacy@example.com">privacy@example.com</a>'))
    assert.ok(set.includes('Invitation emails are sent through Resend'))
    assert.ok(privacyPage({ ...view, contact: 'Ask Dana at the front desk' }).includes('Ask Dana at the front desk.'))
    const hostile = privacyPage({ ...view, contact: '<img src=x onerror=alert(1)>', region: '"><script>alert(1)</script>' })
    assert.ok(!hostile.includes('<img') && !hostile.includes('<script') && hostile.includes('&lt;img src=x onerror=alert(1)&gt;') && hostile.includes('&quot;&gt;&lt;script&gt;'), 'typed text is text')
    assert.equal(settingText('  <b>Paris</b>\r\n(EU)  ', 50), 'b Paris /b (EU)', 'angle brackets and line breaks become spaces')
    assert.equal(settingText('   ', 10), null)
    assert.equal(settingText(undefined, 10), null)
    assert.equal(settingText('x'.repeat(500), 20).length, 20)
  })

  await ok('every public page links to the privacy page: the invitation, the notices, the goodbye; the owner’s pages do in their footer; the pages hold no script or style', () => {
    const pages = {
      invite: invitePage({ token: 't', email: 'ann@example.test', csrf: 'c' }),
      inviteOpen: invitePage({ token: 't', email: null, csrf: 'c', error: 'x' }),
      notice: notice('Link not valid', 'Nope'),
      goodbye: goodbye(),
      people: peoplePage({ members: [], invitations: [], roles: [], csrf: 'c' }),
      activity: activityPage({ events: [], filter: '', groups: GROUPS, next: null, newer: false }),
      account: accountPage({ person: { name: 'Ann', email: 'ann@example.test', profile: 'Viewer', joined: null }, owner: false, apps: [], csrf: 'c' }),
    }
    for (const [name, html] of Object.entries(pages)) {
      assert.ok(html.includes('href="/privacy"'), name + ' links to /privacy')
      assert.ok(NO_INLINE(html), name + ' has no script, style or handler')
      assert.ok(html.includes('<meta name="referrer" content="same-origin">'), name + ' lets its forms carry the Origin (the app’s no-referrer would make a browser send « null »)')
      assert.ok(html.includes('href="/app.css"'), name)
    }
    assert.ok(pages.invite.includes('How your data is used'))
  })

  await ok('the account page: a member can download and delete (typing their address); the owner is told how to leave and finds the export of each app; names are escaped', () => {
    const base = { person: { name: '<b>Ann</b>', email: 'ann@example.test', profile: 'Viewer', joined: '2026-10-31T09:00:00.000Z' }, csrf: 'tok' }
    const member = accountPage({ ...base, owner: false, apps: [] })
    assert.ok(member.includes('href="/api/me/export"') && member.includes('download'))
    assert.ok(member.includes('action="/account/delete"') && member.includes('name="confirm"') && member.includes('name="_csrf" value="tok"'))
    assert.ok(member.includes('Type your email address to confirm'))
    assert.equal(member.includes('/export.json'), false)
    assert.equal(member.includes('<b>Ann</b>'), false, 'a name is text')
    assert.ok(member.includes('2026-10-31'))
    const owner = accountPage({ ...base, owner: true, apps: [{ slug: 'shop', name: 'Ledger' }] })
    assert.equal(owner.includes('action="/account/delete"'), false, 'the owner has no delete form')
    assert.ok(owner.includes('cannot delete their own account here'))
    assert.ok(owner.includes('href="/api/apps/shop/export.json"') && owner.includes('>Export data<'))
    assert.ok(accountPage({ ...base, owner: true, apps: [{ slug: 'a', name: 'A' }, { slug: 'b', name: 'B' }] }).includes('Export data: B'))
    assert.ok(accountPage({ ...base, owner: false, apps: [], notice: { text: 'Type your own email address to confirm.', bad: true } }).includes('role="alert"'))
  })

  await ok('the activity page: sentences, a pill per kind, a filter that is a plain form, a pager, everything escaped', () => {
    const events = [
      { id: 9, at: Date.UTC(2026, 9, 31, 9, 5), kind: 'signin.failed', group: 'signin', text: 'A sign-in failed for a***@example.test.', ip: 'ab12cd34' },
      { id: 8, at: Date.UTC(2026, 9, 31, 9, 0), kind: 'export.app', group: 'exports', text: '<script>alert(1)</script> downloaded the data', ip: null },
    ]
    const html = activityPage({ events, filter: 'signin', groups: GROUPS, next: 8, newer: true })
    assert.ok(html.includes('2026-10-31 09:05 UTC') && html.includes('A sign-in failed for a***@example.test.'))
    assert.ok(html.includes('<code>ab12cd34</code>'))
    assert.ok(html.includes('<select class="input" id="act-kind" name="kind">') && html.includes('<option value="signin" selected>Sign-ins</option>'))
    assert.ok(html.includes('method="get" action="/activity"'))
    assert.ok(html.includes('href="/activity?kind=signin&before=8"') && html.includes('href="/activity?kind=signin"'), 'older and newest')
    assert.equal(html.includes('<script>alert'), false)
    assert.ok(NO_INLINE(html))
    const none = activityPage({ events: [], filter: 'exports', groups: GROUPS, next: null, newer: false })
    assert.ok(none.includes('Nothing to show for this filter.') && !none.includes('class="pager"'))
    assert.ok(activityPage({ events: [], filter: '', groups: GROUPS, next: null, newer: false }).includes('Nothing to show yet.'))
  })
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log('\ntables template, privacy and activity: ' + count + ' checks passed')
