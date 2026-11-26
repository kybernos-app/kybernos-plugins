// store.mjs — what the app keeps in auth.sqlite beside Better-Auth's own tables: who is in the team space and with which role, the invitations, the links already used.
// Takes a node:sqlite handle; no other dependency, so a test runs it on an in-memory database.
//
//   app_member      one row per signed-in-able person: the user id Better-Auth knows, the e-mail, the role (`owner` or a profile id). At most one owner, by an index.
//   app_invitation  a pending (or accepted) invitation: the profile id it gives, the address it is for (or none: link only), the current nonce, the expiry (ms).
//   used_nonce      the one-time links already spent (lib/bootstrap.mjs), until they would have expired.
//   app_meta        a few flags (`owner_pw_set`).
export function makeStore (db, now = Date.now) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_member (user_id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, role TEXT NOT NULL, invited_by TEXT, created_at INTEGER NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS app_member_one_owner ON app_member (role) WHERE role = 'owner';
    CREATE TABLE IF NOT EXISTS app_invitation (id TEXT PRIMARY KEY, email TEXT, role TEXT NOT NULL, nonce TEXT NOT NULL, exp INTEGER NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, sent_at INTEGER, accepted_at INTEGER);
    CREATE TABLE IF NOT EXISTS used_nonce (nonce TEXT PRIMARY KEY, exp INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS app_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
  `)
  const one = (sql, ...args) => db.prepare(sql).get(...args) ?? null
  const run = (sql, ...args) => db.prepare(sql).run(...args).changes

  return {
    member: (userId) => one('SELECT user_id, email, role, invited_by, created_at FROM app_member WHERE user_id = ?', userId),
    memberByEmail: (email) => one('SELECT user_id, email, role, invited_by, created_at FROM app_member WHERE email = ?', email),
    members: () => db.prepare("SELECT user_id, email, role, invited_by, created_at FROM app_member ORDER BY role = 'owner' DESC, created_at, email").all(),
    owner: () => one("SELECT user_id, email, role, invited_by, created_at FROM app_member WHERE role = 'owner'"),
    addMember: ({ userId, email, role, invitedBy = null }) => run('INSERT INTO app_member (user_id, email, role, invited_by, created_at) VALUES (?, ?, ?, ?, ?)', userId, email, role, invitedBy, now()),
    /** Changes a role; the owner's row is never touched, and nobody becomes owner this way. */
    setRole: (userId, role) => run("UPDATE app_member SET role = ? WHERE user_id = ? AND role <> 'owner' AND ? <> 'owner'", role, userId, role),
    removeMember: (userId) => run("DELETE FROM app_member WHERE user_id = ? AND role <> 'owner'", userId),

    invite: ({ id, email, role, nonce, exp, by }) => run('INSERT INTO app_invitation (id, email, role, nonce, exp, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, email, role, nonce, exp, by, now()),
    invitation: (id) => one('SELECT id, email, role, nonce, exp, created_by, created_at, sent_at, accepted_at FROM app_invitation WHERE id = ?', id),
    /** The invitations nobody has accepted yet, newest first. */
    pending: () => db.prepare('SELECT id, email, role, nonce, exp, created_by, created_at, sent_at FROM app_invitation WHERE accepted_at IS NULL ORDER BY created_at DESC, id').all(),
    setInvitationRole: (id, role) => run('UPDATE app_invitation SET role = ? WHERE id = ? AND accepted_at IS NULL', role, id),
    /** A new nonce and expiry: the link sent before stops working. */
    renewInvitation: (id, nonce, exp) => run('UPDATE app_invitation SET nonce = ?, exp = ?, sent_at = NULL WHERE id = ? AND accepted_at IS NULL', nonce, exp, id),
    markSent: (id) => run('UPDATE app_invitation SET sent_at = ? WHERE id = ?', now(), id),
    revokeInvitation: (id) => run('DELETE FROM app_invitation WHERE id = ? AND accepted_at IS NULL', id),
    /** Takes the invitation for one person, once: true for the first caller with the right nonce, false for everyone else. */
    claimInvitation: (id, nonce) => run('UPDATE app_invitation SET accepted_at = ? WHERE id = ? AND nonce = ? AND accepted_at IS NULL AND exp > ?', now(), id, nonce, now()) === 1,
    releaseInvitation: (id) => run('UPDATE app_invitation SET accepted_at = NULL WHERE id = ?', id),
    /** Forgets an invitation once it has done its work: the address it was made for goes with it. */
    dropInvitation: (id) => run('DELETE FROM app_invitation WHERE id = ?', id),
    /** Drops the invitations that were used and those that expired before `before` (ms), with the addresses they hold. */
    purgeInvitations: (before) => run('DELETE FROM app_invitation WHERE accepted_at IS NOT NULL OR exp < ?', before),
    /** The id of every invitation made for this address, in any state. */
    invitationsFor: (email) => db.prepare('SELECT id FROM app_invitation WHERE email = ?').all(email).map((r) => r.id),

    /** The ledger of lib/bootstrap.mjs: true the first time a nonce is seen. `exp` is in seconds; spent links that would have expired are forgotten. */
    claim (nonce, exp) {
      run('DELETE FROM used_nonce WHERE exp < ?', Math.floor(now() / 1000))
      return run('INSERT OR IGNORE INTO used_nonce (nonce, exp) VALUES (?, ?)', nonce, exp) === 1
    },

    meta: (k) => one('SELECT v FROM app_meta WHERE k = ?', k)?.v ?? null,
    setMeta: (k, v) => run('INSERT INTO app_meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v', k, String(v)),
  }
}
