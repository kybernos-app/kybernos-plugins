// test-tables-team.mjs — the team side of the tables template, with no web server: the role → actor mapping, what the store keeps (members, invitations, spent links), the owner's
// people calls, the apps folder read through kybernos-db, and the vendoring (where kybernos-db is found, what gets copied). Needs node:sqlite only.
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { PROFILE_ID, actorOf, assignable, isSlug } from './templates/tables/lib/actor.mjs'
import { candidates, pickDb } from './templates/tables/lib/db-path.mjs'
import { readInvitationToken } from './templates/tables/lib/invitation.mjs'
import { installApp } from './templates/tables/lib/install.mjs'
import { makePeople } from './templates/tables/lib/people.mjs'
import { makeStore } from './templates/tables/lib/store.mjs'
import { ENTRIES, buildTablesApp, importClosure } from './templates/tables/scripts/build-tables-app.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const tpl = join(here, 'templates', 'tables')
let count = 0
const ok = async (label, fn) => { await fn(); count++; console.log('ok  ', label) }
const clock = () => { const c = { t: Date.UTC(2026, 9, 31, 9, 0, 0), now: () => c.t, advance: (ms) => { c.t += ms } }; return c }
const root = mkdtempSync(join(tmpdir(), 'kb-tables-team-'))

try {
  await ok('the owner is the reserved role; anything else is a profile id; nothing else is an actor', () => {
    assert.deepEqual(actorOf({ user_id: 'u0', role: 'owner' }), { kind: 'person', role: 'owner' })
    assert.deepEqual(actorOf({ user_id: 'u1', role: 'member' }), { kind: 'member', role: 'member', id: 'u1' })
    for (const bad of [null, undefined, {}, { user_id: '', role: 'member' }, { user_id: 'u1' }, { user_id: 'u1', role: 'Owner' }, { user_id: 'u1', role: 'a b' }, { user_id: 'u1', role: 'x'.repeat(30) }, { user_id: 'u1', role: '1abc' }]) assert.equal(actorOf(bad), null, JSON.stringify(bad))
    assert.equal(assignable('member'), true)
    assert.equal(assignable('owner'), false, 'the owner role is never handed out')
    assert.equal(assignable('../x'), false)
    assert.deepEqual(['shop', 'a-1'].map(isSlug), [true, true])
    assert.deepEqual(['', 'Shop', '1shop', '../x', 'a/b', 'a'.repeat(41)].map(isSlug), [false, false, false, false, false, false])
  })

  await ok('the profile-id pattern is the one of kybernos-db', async () => {
    const { PROFILE_ID: theirs } = await import('./templates/tables/lib/db.mjs')
    assert.equal(PROFILE_ID.source, theirs.source)
  })

  const c = clock()
  const db = new DatabaseSync(':memory:')
  const store = makeStore(db, c.now)

  await ok('the store: one owner at most, members, roles that never become owner', () => {
    store.addMember({ userId: 'u0', email: 'o@example.com', role: 'owner' })
    assert.throws(() => store.addMember({ userId: 'u9', email: 'o2@example.com', role: 'owner' }), 'a second owner is refused by the index')
    store.addMember({ userId: 'u1', email: 'max@example.com', role: 'member', invitedBy: 'u0' })
    assert.throws(() => store.addMember({ userId: 'u2', email: 'max@example.com', role: 'member' }), 'one row per e-mail')
    assert.equal(store.owner().user_id, 'u0')
    assert.deepEqual(store.members().map((m) => m.user_id), ['u0', 'u1'], 'the owner first')
    assert.equal(store.setRole('u1', 'viewer'), 1)
    assert.equal(store.setRole('u1', 'owner'), 0, 'nobody becomes owner by a role change')
    assert.equal(store.setRole('u0', 'viewer'), 0, 'the owner keeps their role')
    assert.equal(store.removeMember('u0'), 0, 'the owner is not removed')
    assert.equal(store.member('u1').role, 'viewer')
    assert.equal(store.removeMember('u1'), 1)
    assert.equal(store.member('u1'), null)
  })

  await ok('the store: an invitation is taken once, with the right nonce, before it expires', () => {
    store.invite({ id: 'i1', email: 'ann@example.com', role: 'member', nonce: 'n1', exp: c.t + 60_000, by: 'u0' })
    assert.equal(store.claimInvitation('i1', 'wrong'), false)
    assert.equal(store.claimInvitation('i1', 'n1'), true)
    assert.equal(store.claimInvitation('i1', 'n1'), false, 'once')
    assert.equal(store.pending().length, 0)
    assert.equal(store.releaseInvitation('i1'), 1, 'a sign-up that failed gives it back')
    assert.equal(store.pending().length, 1)
    c.advance(61_000)
    assert.equal(store.claimInvitation('i1', 'n1'), false, 'expired')
    assert.equal(store.renewInvitation('i1', 'n2', c.t + 60_000), 1)
    assert.equal(store.claimInvitation('i1', 'n1'), false, 'the old link died with the renewal')
    assert.equal(store.revokeInvitation('i1'), 1)
    assert.equal(store.invitation('i1'), null)
  })

  await ok('the store keeps the spent links of the owner bootstrap, and forgets them once they could not work anyway', () => {
    const exp = Math.floor(c.t / 1000) + 600
    assert.equal(store.claim('nonce-a', exp), true)
    assert.equal(store.claim('nonce-a', exp), false)
    c.advance(601_000)
    assert.equal(store.claim('nonce-b', Math.floor(c.t / 1000) + 600), true)
    assert.equal(db.prepare('SELECT count(*) AS n FROM used_nonce').get().n, 1, 'the expired entry was dropped')
  })

  const mails = []
  const roles = [{ id: 'member', label: 'Team member', apps: ['shop'] }, { id: 'viewer', label: 'Viewer', apps: ['shop'] }]
  const people = makePeople({ store, secret: 's'.repeat(40), publicUrl: 'https://team.example.com/', mailer: { send: async (m) => { mails.push(m); return { sent: true } } }, roles: () => roles, now: c.now })

  await ok('people: invite by e-mail sends the link and does not hand it back; the link names an invitation that gives the profile', async () => {
    const r = await people.invite({ email: ' Ann@Example.com ', role: 'member', by: 'u0' })
    assert.equal(r.ok, true)
    assert.equal(r.sent, true)
    assert.equal(r.link, undefined, 'a link that went by e-mail is not shown')
    assert.equal(mails.length, 1)
    assert.equal(mails[0].to, 'ann@example.com')
    assert.ok(mails[0].link.startsWith('https://team.example.com/invite?t='))
    const t = readInvitationToken(decodeURIComponent(mails[0].link.split('?t=')[1]), { secret: 's'.repeat(40), now: c.now })
    assert.equal(t.ok, true)
    assert.equal(store.invitation(t.id).role, 'member')
    assert.equal(people.list().invitations[0].sent, true)
  })

  await ok('people: a link-only invitation, a mailer that fails or sends nothing, and the refusals', async () => {
    const byLink = await people.invite({ role: 'viewer', by: 'u0' })
    assert.equal(byLink.ok, true)
    assert.equal(byLink.sent, false)
    assert.equal(byLink.invitation.email, null)
    assert.ok(byLink.link.includes('/invite?t='))
    const broken = makePeople({ store, secret: 's'.repeat(40), publicUrl: 'https://team.example.com', mailer: { send: async () => { throw new Error('smtp down') } }, roles: () => roles, now: c.now })
    const failed = await broken.invite({ email: 'bob@example.com', role: 'member', by: 'u0' })
    assert.equal(failed.ok, true)
    assert.equal(failed.sent, false)
    assert.ok(failed.link, 'the owner gets the link to pass on')
    for (const [input, error] of [[{ role: 'owner' }, 'invalid'], [{ role: 'ghost' }, 'invalid'], [{ role: '' }, 'invalid'], [{ email: 'not-an-address', role: 'member' }, 'invalid']]) {
      const r = await people.invite({ ...input, by: 'u0' })
      assert.equal(r.ok, false, JSON.stringify(input))
      assert.equal(r.error, error)
    }
    store.addMember({ userId: 'u5', email: 'dan@example.com', role: 'member' })
    assert.equal((await people.invite({ email: 'dan@example.com', role: 'member', by: 'u0' })).ok, false, 'someone already in the team')
  })

  await ok('people: resend makes the old link useless; changing the profile of a pending invitation changes what it gives; revoke ends it', async () => {
    const first = await people.invite({ role: 'member', by: 'u0' })
    const id = first.invitation.id
    const oldNonce = store.invitation(id).nonce
    const again = await people.resend(id)
    assert.equal(again.ok, true)
    assert.notEqual(store.invitation(id).nonce, oldNonce)
    assert.equal(people.setInvitationRole(id, 'viewer').ok, true)
    assert.equal(store.invitation(id).role, 'viewer')
    assert.equal(people.setInvitationRole(id, 'owner').ok, false)
    assert.equal(people.revoke(id).ok, true)
    assert.equal(people.revoke(id).ok, false)
    assert.equal((await people.resend(id)).ok, false)
  })

  await ok('people: a member’s profile can change, the owner’s cannot, and neither can become owner', () => {
    assert.equal(people.setMemberRole('u5', 'viewer').ok, true)
    assert.equal(store.member('u5').role, 'viewer')
    assert.equal(people.setMemberRole('u5', 'owner').ok, false)
    assert.equal(people.setMemberRole('u5', 'ghost').ok, false)
    assert.equal(people.setMemberRole('u0', 'member').error, 'owner')
    assert.equal(people.setMemberRole('nobody', 'member').error, 'unknown')
  })

  await ok('the apps folder is read through kybernos-db: its profiles are the roles the owner can hand out', async () => {
    const { makeService, buildStructure } = await import('./templates/tables/lib/db.mjs')
    const { makeApps } = await import('./templates/tables/lib/apps.mjs')
    const raw = JSON.parse(readFileSync(join(here, '..', 'kybernos-plugin', 'themes', 'ecommerce', 'db', 'ecommerce.json'), 'utf8'))
    const built = buildStructure(raw, 'en')
    const svc = makeService({ dir: join(root, 'dbs') })
    const made = svc.create({ name: built.name, by: 'template', objects: built.objects })
    assert.equal(made.ok, true)
    assert.equal(made.db.setProfiles(built.profiles, 'template').ok, true)
    const id = made.db.info().id
    svc.close()

    const appsDir = join(root, 'data', 'apps')
    assert.equal(installApp(appsDir, 'Bad Slug', join(root, 'dbs', id)).ok, false)
    assert.equal(installApp(appsDir, 'shop', join(root, 'dbs', 'nothing')).ok, false)
    assert.equal(installApp(appsDir, 'shop', join(root, 'dbs', id)).ok, true)
    assert.equal(installApp(appsDir, 'shop', join(root, 'dbs', id)).ok, false, 'an app is never overwritten')
    assert.ok(existsSync(join(appsDir, 'shop', id, 'db.sqlite')))

    const apps = makeApps({ dir: appsDir, today: () => '2026-10-31' })
    assert.deepEqual(apps.slugs(), ['shop'])
    assert.equal(apps.has('shop'), true)
    assert.equal(apps.has('../etc'), false)
    assert.equal(apps.door('nothing', { kind: 'person', role: 'owner' }), null)
    assert.deepEqual(apps.roles().map((r) => [r.id, r.apps]), [['member', ['shop']]])
    const owner = apps.door('shop', { kind: 'person', role: 'owner' })
    assert.equal(owner.state().dbs.length, 1)
    assert.equal(apps.door('shop', { kind: 'member', role: 'ghost', id: 'u1' }).state().dbs.length, 0, 'no profile of that id: the app is not listed')
    assert.equal(apps.door('shop', { kind: 'member', role: 'member', id: 'u1' }).state().dbs.length, 1)
    apps.close()
  })

  await ok('kybernos-db is looked for in the vendored copy first, then in the repository layout', () => {
    const lib = join(root, 'app', 'lib')
    const [vendored, repo] = candidates(lib)
    assert.equal(vendored, join(root, 'app', 'vendor', 'kybernos-db'))
    assert.equal(pickDb(lib, (f) => f === join(vendored, 'api.mjs') || f === join(repo, 'api.mjs')), vendored)
    assert.equal(pickDb(lib, (f) => f === join(repo, 'api.mjs')), repo)
    assert.equal(pickDb(lib, () => false), null)
    assert.equal(pickDb(join(tpl, 'lib'), existsSync), join(here, '..', 'kybernos-db'), 'inside this repository it finds packages/kybernos-db')
  })

  await ok('the build follows the imports of the door, copies nothing else, and lists every file with its hash', () => {
    const closure = importClosure(join(here, '..', 'kybernos-db'), ENTRIES)
    for (const must of ['api.mjs', 'agent/service.mjs', 'template.mjs', 'instantiate.mjs', 'serve-user-file.mjs', 'core/profiles.mjs', 'core/rights.mjs', 'store/db.mjs', 'store/root.mjs', 'remote/token.mjs', 'remote/bundle.mjs', 'remote/snapshot.mjs']) assert.ok(closure.includes(must), must)
    assert.equal(closure.some((f) => /^test|client\.js|routes\.mjs|index\.js$|^vendor\//.test(f)), false, 'no test, no page code, no plugin entry')
    assert.throws(() => importClosure('/x', ['a.mjs'], () => "import '../out.mjs'"), /outside kybernos-db/)

    const out = join(root, 'built')
    const made = buildTablesApp({ out })
    assert.equal(made.files, closure.length)
    assert.deepEqual(readdirSync(join(out, 'vendor', 'kybernos-db')).sort(), ['VENDORED.json', 'agent', 'api.mjs', 'core', 'instantiate.mjs', 'remote', 'serve-user-file.mjs', 'store', 'template.mjs'])
    const listed = JSON.parse(readFileSync(join(out, 'vendor', 'kybernos-db', 'VENDORED.json'), 'utf8')).files.map((f) => f.file)
    assert.deepEqual(listed, closure)
    assert.ok(existsSync(join(out, 'server.js')) && existsSync(join(out, 'app.mjs')) && existsSync(join(out, 'package-lock.json')))
    assert.equal(existsSync(join(out, 'node_modules')) || existsSync(join(out, 'data')), false)
    // a second build over the first leaves the same thing, and an old vendor/ is replaced, not merged
    cpSync(join(out, 'vendor', 'kybernos-db', 'api.mjs'), join(out, 'vendor', 'kybernos-db', 'stale.mjs'))
    buildTablesApp({ out })
    assert.equal(existsSync(join(out, 'vendor', 'kybernos-db', 'stale.mjs')), false)
  })

  await ok('the built copy finds its own vendored kybernos-db, not the repository', async () => {
    const probe = join(root, 'built', 'probe.mjs')
    writeFileSync(probe, "import { DB_DIR, makeApi } from './lib/db.mjs'\nimport { mintOwnerApiToken, verifyOwnerApiToken } from './lib/token.mjs'\nconst key = Buffer.alloc(32, 1)\nconsole.log(JSON.stringify({ dir: DB_DIR, api: typeof makeApi, token: verifyOwnerApiToken(mintOwnerApiToken({ key }), key).ok }))\n")
    const { execFileSync } = await import('node:child_process')
    const out = JSON.parse(execFileSync(process.execPath, ['--no-warnings', probe], { encoding: 'utf8', cwd: join(root, 'built') }))
    assert.equal(realpathSync(out.dir), realpathSync(join(root, 'built', 'vendor', 'kybernos-db')))
    assert.equal(out.api, 'function')
    assert.equal(out.token, true, 'the token code is the vendored copy, reached through lib/token.mjs')
    assert.equal(/createHmac|timingSafeEqual/.test(readFileSync(join(tpl, 'lib', 'token.mjs'), 'utf8')), false, 'the template keeps no second copy of the token code: it only re-exports kybernos-db remote/token.mjs')
  })

  await ok('the template carries what a runnable app needs, pins its dependencies exactly, and names no personal path', () => {
    for (const f of ['package.json', 'package-lock.json', 'server.js', 'app.mjs', 'README.md', 'lib/db.mjs', 'lib/bootstrap.mjs', 'lib/ratelimit.mjs', 'lib/bearer.mjs', 'lib/transfer.mjs', 'scripts/build-tables-app.mjs', 'scripts/mint-link.mjs']) assert.ok(existsSync(join(tpl, f)), f)
    const pkg = JSON.parse(readFileSync(join(tpl, 'package.json'), 'utf8'))
    assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['@hono/node-server', 'better-auth', 'hono'])
    for (const [name, version] of Object.entries(pkg.dependencies)) assert.match(version, /^\d+\.\d+\.\d+$/, name + ' is pinned to one version')
    const lock = JSON.parse(readFileSync(join(tpl, 'package-lock.json'), 'utf8'))
    for (const name of Object.keys(pkg.dependencies)) assert.equal(lock.packages['node_modules/' + name].version, pkg.dependencies[name], name + ' in the lock')
    const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]))
    for (const f of walk(tpl).filter((p) => /\.(mjs|js|json|md)$/.test(p) && !p.endsWith('package-lock.json'))) assert.equal(/\/Users\/|\/home\//.test(readFileSync(f, 'utf8')), false, f)
    assert.equal(walk(tpl).some((f) => /\/(node_modules|vendor|data)\//.test(f)), false, 'no dependency, no vendored copy, no data in the template folder')
  })
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log('\ntables template, team side: ' + count + ' checks passed')
