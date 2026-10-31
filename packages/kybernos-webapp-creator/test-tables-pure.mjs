// test-tables-pure.mjs — the dependency-free logic of the tables template (templates/tables/lib): signed tokens, the owner's one-time link, invitations, the rate limiter, the
// CSRF and Origin rules, the secrets. Runs anywhere Node runs: no Hono, no Better-Auth, no network.
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OPEN_TTL_SEC, memoryLedger, mintOpenToken, redeemOpenToken } from './templates/tables/lib/bootstrap.mjs'
import { INVITE_TTL_SEC, invitationFault, inviteKey, mintInvitationToken, newNonce, normEmail, readInvitationToken } from './templates/tables/lib/invitation.mjs'
import { makeLimiter } from './templates/tables/lib/ratelimit.mjs'
import { SECRETS_FILE, resolveSecrets } from './templates/tables/lib/secrets.mjs'
import { allowedOrigins, clientIp, csrfCookie, csrfCookieName, csrfOk, csrfToken, isHttps, originOk, securityHeaders } from './templates/tables/lib/safety.mjs'
import { signToken, verifyToken, hexKey, mintOwnerApiToken } from './templates/tables/lib/token.mjs'
import { BEARER_SCOPE, judgeBearer } from './templates/tables/lib/bearer.mjs'
import { BUNDLE_MAX_CEILING, BUNDLE_MAX_FLOOR, bundleCap, loadConfig } from './templates/tables/lib/boot.mjs'
import { esc, invitePage, peoplePage } from './templates/tables/lib/html.mjs'

let count = 0
const ok = (label, fn) => { fn(); count++; console.log('ok  ', label) }
const KEY = Buffer.alloc(32, 7)
const clock = (start = Date.UTC(2026, 9, 31, 9, 0, 0)) => { const c = { t: start, now: () => c.t, advance: (ms) => { c.t += ms } }; return c }
const flip = (token) => token.slice(0, -2) + (token.at(-2) === 'A' ? 'B' : 'A') + token.slice(-1)

ok('a token verifies, carries its claims, and expires', () => {
  const c = clock()
  const t = signToken('open', { n: 'abc' }, KEY, { now: c.now, ttlSec: 60 })
  assert.equal(verifyToken('open', t, KEY, { now: c.now }).claims.n, 'abc')
  c.advance(59_000)
  assert.equal(verifyToken('open', t, KEY, { now: c.now }).ok, true)
  c.advance(1_000)
  assert.deepEqual(verifyToken('open', t, KEY, { now: c.now }), { ok: false, reason: 'expired' })
})

ok('a token is bound to its key and its kind, and a changed byte breaks it', () => {
  const c = clock()
  const t = signToken('open', { n: 'abc' }, KEY, { now: c.now, ttlSec: 60 })
  assert.equal(verifyToken('open', t, Buffer.alloc(32, 8), { now: c.now }).reason, 'bad-signature')
  assert.equal(verifyToken('invite', t, KEY, { now: c.now }).reason, 'bad-signature', 'a link for one purpose is no link for another')
  assert.equal(verifyToken('open', flip(t), KEY, { now: c.now }).reason, 'bad-signature')
  const [body, mac] = t.split('.')
  const forged = Buffer.from(JSON.stringify({ n: 'abc', x: 4102444800 })).toString('base64url')
  assert.equal(verifyToken('open', forged + '.' + mac, KEY, { now: c.now }).reason, 'bad-signature', 'the claims cannot be changed under the same signature')
  for (const junk of ['', 'x', '.', 'a.', '.b', 'a.b.c', 'a'.repeat(2000), null, undefined, 42, {}]) assert.equal(verifyToken('open', junk, KEY, { now: c.now }).ok, false)
  assert.equal(verifyToken('open', t, 'short', { now: c.now }).ok, false, 'a weak key verifies nothing')
  assert.throws(() => signToken('open', {}, 'short', { now: c.now, ttlSec: 60 }))
  assert.ok(body.length > 0)
})

ok('hexKey takes 16 bytes or more of hexadecimal and nothing else', () => {
  assert.equal(hexKey('ab'.repeat(16)).length, 16)
  assert.equal(hexKey('AB'.repeat(32)).length, 32)
  for (const bad of ['', 'ab', 'zz'.repeat(16), 'ab'.repeat(15), 'ab'.repeat(16) + 'a', 'ab'.repeat(200), null, undefined, 5]) assert.equal(hexKey(bad), null)
})

ok('the owner link: good once, then reused; tampered, expired and foreign-key links are refused', () => {
  const c = clock()
  const ledger = memoryLedger()
  const token = mintOpenToken({ key: KEY, now: c.now, email: 'olga@example.com' })
  const redeem = (t, o = {}) => redeemOpenToken(t, { key: KEY, now: c.now, ledger, ...o })
  assert.deepEqual(redeem(flip(token)), { ok: false, reason: 'bad-signature' })
  assert.deepEqual(redeem(token, { key: Buffer.alloc(32, 9) }), { ok: false, reason: 'bad-signature' })
  assert.deepEqual(redeem(token), { ok: true, email: 'olga@example.com' })
  assert.deepEqual(redeem(token), { ok: false, reason: 'reused' })
  const late = mintOpenToken({ key: KEY, now: c.now })
  c.advance((OPEN_TTL_SEC + 1) * 1000)
  assert.deepEqual(redeem(late), { ok: false, reason: 'expired' })
  assert.equal(redeem(mintOpenToken({ key: KEY, now: c.now })).email, null, 'a link with no address says so')
  assert.notEqual(mintOpenToken({ key: KEY, now: c.now }), mintOpenToken({ key: KEY, now: c.now }), 'two links are never the same')
  assert.ok(OPEN_TTL_SEC <= 15 * 60, 'minutes, not days')
})

ok('an invitation token only names the invitation; the row says what it gives and whether it is still good', () => {
  const c = clock()
  const secret = 'a'.repeat(40)
  const nonce = newNonce()
  const t = mintInvitationToken({ secret, id: 'inv1', nonce, now: c.now })
  assert.deepEqual(readInvitationToken(t, { secret, now: c.now }), { ok: true, id: 'inv1', nonce })
  assert.equal(readInvitationToken(t, { secret: 'b'.repeat(40), now: c.now }).ok, false)
  assert.equal(readInvitationToken(flip(t), { secret, now: c.now }).reason, 'bad-signature')
  assert.equal(readInvitationToken(mintOpenToken({ key: inviteKey(secret), now: c.now }), { secret, now: c.now }).ok, false, 'an owner link is not an invitation')
  c.advance(INVITE_TTL_SEC * 1000)
  assert.equal(readInvitationToken(t, { secret, now: c.now }).reason, 'expired')
  assert.equal(INVITE_TTL_SEC, 7 * 24 * 3600)

  const row = { nonce, exp: c.t + 1000, accepted_at: null }
  assert.equal(invitationFault(row, nonce, c.now), null)
  assert.equal(invitationFault(row, 'other', c.now), 'replaced', 'a resend (a new nonce) kills the old link')
  assert.equal(invitationFault({ ...row, accepted_at: c.t }, nonce, c.now), 'used')
  assert.equal(invitationFault({ ...row, exp: c.t }, nonce, c.now), 'expired')
  assert.equal(invitationFault(null, nonce, c.now), 'unknown')
})

ok('e-mail addresses are normalised and the odd ones refused', () => {
  assert.equal(normEmail('  Max@Example.COM '), 'max@example.com')
  for (const bad of ['', 'max', 'max@', '@example.com', 'max@example', 'a b@example.com', 'max@@example.com', 'max@exa mple.com', 'max@.com', null, 42, 'a'.repeat(250) + '@example.com']) assert.equal(normEmail(bad), null, String(bad))
})

ok('the limiter lets max through per window, then waits, per key, and stays bounded', () => {
  const c = clock()
  const l = makeLimiter({ max: 3, windowMs: 60_000, now: c.now, maxKeys: 5 })
  assert.deepEqual([l.hit('a').ok, l.hit('a').ok, l.hit('a').ok, l.hit('a').ok], [true, true, true, false])
  assert.equal(l.hit('a').retryAfterSec, 60)
  assert.equal(l.hit('b').ok, true, 'another key is not slowed')
  c.advance(30_000)
  assert.equal(l.hit('a').retryAfterSec, 30)
  c.advance(30_000)
  assert.equal(l.hit('a').ok, true, 'the window frees up as attempts age out')
  l.reset('a')
  assert.equal(l.hit('a').remaining, 2)
  for (let i = 0; i < 50; i++) l.hit('k' + i)
  assert.ok(l.size() <= 5, 'at most maxKeys keys are kept')
  assert.throws(() => makeLimiter({ max: 0, windowMs: 10 }))
})

ok('only the right Origin passes, and the CSRF token needs the cookie it was made for', () => {
  const local = allowedOrigins({ port: 4411 })
  assert.deepEqual(local, ['http://127.0.0.1:4411', 'http://localhost:4411'])
  assert.deepEqual(allowedOrigins({ publicUrl: 'https://team.example.com/', port: 1 }), ['https://team.example.com'])
  assert.throws(() => allowedOrigins({ publicUrl: 'ftp://x.example' }))
  assert.equal(originOk('http://localhost:4411', local), true)
  for (const bad of ['https://evil.example', 'http://localhost:4412', 'null', '', undefined, null]) assert.equal(originOk(bad, local), false)
  assert.equal(isHttps(['https://team.example.com']), true)
  assert.equal(isHttps(local), false)

  const secret = 'c'.repeat(40)
  const token = csrfToken(secret, 'cookie-value')
  assert.equal(csrfOk(secret, 'cookie-value', token), true)
  assert.equal(csrfOk(secret, 'other-cookie', token), false, 'a token of another browser')
  assert.equal(csrfOk('d'.repeat(40), 'cookie-value', token), false)
  for (const bad of [undefined, '', 'x', token + 'x', token.slice(1)]) assert.equal(csrfOk(secret, 'cookie-value', bad), false)
  assert.equal(csrfOk(secret, undefined, token), false)
})

ok('the cookie and the headers: HttpOnly, SameSite, Secure on https; a policy that allows no script and no frame', () => {
  assert.equal(csrfCookie('kb_csrf', 'v', false), 'kb_csrf=v; Path=/; HttpOnly; SameSite=Lax')
  assert.equal(csrfCookie('__Host-kb_csrf', 'v', true), '__Host-kb_csrf=v; Path=/; HttpOnly; SameSite=Lax; Secure')
  assert.equal(csrfCookieName(true), '__Host-kb_csrf')
  const h = securityHeaders(false)
  assert.match(h['content-security-policy'], /default-src 'self'/)
  assert.match(h['content-security-policy'], /frame-ancestors 'none'/)
  assert.doesNotMatch(h['content-security-policy'], /unsafe-inline|unsafe-eval/)
  assert.equal(h['x-content-type-options'], 'nosniff')
  assert.equal(h['referrer-policy'], 'no-referrer')
  assert.equal(h['strict-transport-security'], undefined)
  assert.ok(securityHeaders(true)['strict-transport-security'])
})

ok('the client address comes from the socket, and from x-forwarded-for only when the operator says a proxy is there', () => {
  assert.equal(clientIp({ forwardedFor: '1.2.3.4', remote: '10.0.0.1', trustProxy: false }), '10.0.0.1')
  assert.equal(clientIp({ forwardedFor: '1.2.3.4, 10.0.0.9', remote: '10.0.0.1', trustProxy: true }), '1.2.3.4')
  assert.equal(clientIp({ trustProxy: true }), 'local')
})

ok('secrets: the environment wins and is never written; the rest is generated once and kept', () => {
  let stored = null
  const io = { read: () => stored, write: (o) => { stored = o } }
  const seq = () => { let i = 0; return (n) => Buffer.alloc(n, ++i) }
  const first = resolveSecrets({ env: {}, ...io, random: seq() })
  assert.deepEqual(first.from, { authSecret: 'generated', bootKey: 'generated' })
  assert.equal(first.bootKey.length, 32)
  assert.equal(stored.bootKey.length, 64)
  const again = resolveSecrets({ env: {}, ...io, random: seq() })
  assert.deepEqual(again.from, { authSecret: 'file', bootKey: 'file' })
  assert.equal(again.authSecret, first.authSecret)
  assert.deepEqual(again.bootKey, first.bootKey)

  stored = null
  const env = { KB_AUTH_SECRET: 'e'.repeat(40), KB_BOOT_KEY: 'ab'.repeat(16) }
  const fromEnv = resolveSecrets({ env, ...io, random: seq() })
  assert.deepEqual(fromEnv.from, { authSecret: 'env', bootKey: 'env' })
  assert.equal(stored, null, 'nothing is written when the environment gives both')
  const mixed = resolveSecrets({ env: { KB_AUTH_SECRET: env.KB_AUTH_SECRET }, ...io, random: seq() })
  assert.deepEqual(mixed.from, { authSecret: 'env', bootKey: 'generated' })
  assert.equal(JSON.stringify(stored).includes(env.KB_AUTH_SECRET), false, 'a secret from the environment never lands on disk')

  assert.throws(() => resolveSecrets({ env: { KB_AUTH_SECRET: 'short' }, ...io }), /KB_AUTH_SECRET/)
  assert.throws(() => resolveSecrets({ env: { KB_BOOT_KEY: 'nothex' }, ...io }), (e) => /KB_BOOT_KEY/.test(e.message) && !e.message.includes('nothex'))
  assert.equal(SECRETS_FILE, 'secrets.json')
})

ok('the pages escape what people type and carry no script, no inline style and no handler', () => {
  assert.equal(esc('<a href="x">\'&'), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;')
  const roles = [{ id: 'member', label: 'Team <member>', apps: ['shop'] }]
  const evil = '"><script>alert(1)</script>'
  const people = peoplePage({ members: [{ user_id: 'u1', email: 'a' + evil + '@example.com', role: 'member' }, { user_id: 'u0', email: 'o@example.com', role: 'owner' }], invitations: [{ id: 'i1', email: null, role: 'member', exp: Date.UTC(2026, 10, 7) }], roles, csrf: 'tok', notice: { text: evil, link: 'https://x.example/invite?t=1', who: evil } })
  const invite = invitePage({ token: evil, email: null, csrf: 'tok', error: evil })
  for (const html of [people, invite]) {
    assert.equal(html.includes('<script'), false)
    assert.doesNotMatch(html, /\son[a-z]+=|style=|javascript:/i)
    assert.ok(html.includes('name="_csrf" value="tok"'))
  }
  assert.ok(people.includes('Team &lt;member&gt;'))
  assert.ok(people.includes('(link only)'))
  assert.equal((people.match(/<form /g) ?? []).length, 6, 'the owner row has no actions; the member has two, the invitation three, plus the invite form')
})

ok('the owner API token is the shared copy: the template re-exports it and mints/verifies the same way', () => {
  const c = clock()
  const t = mintOwnerApiToken({ key: KEY, now: c.now })
  assert.equal(verifyToken('owner-api', t, KEY, { now: c.now }).ok, true)
  assert.equal(verifyToken('open', t, KEY, { now: c.now }).ok, false, 'not an owner link')
  assert.equal(redeemOpenToken(t, { key: KEY, now: c.now, ledger: memoryLedger() }).ok, false, 'an API token cannot open the owner’s link')
  assert.equal(verifyToken('owner-api', mintOpenToken({ key: KEY, now: c.now }), KEY, { now: c.now }).ok, false, 'and the owner’s link is not an API token')
})

ok('bearer rules at the edge: who a request is, from its Authorization header, its cookies and its path', () => {
  const c = clock()
  const good = () => mintOwnerApiToken({ key: KEY, now: c.now })
  const judge = (over) => judgeBearer({ authorization: 'Bearer ' + good(), cookie: undefined, path: '/api/apps/shop/snapshot', key: KEY, now: c.now, ...over })
  const refused = (v, status, reason) => { assert.equal(v.who, 'refused', JSON.stringify(v)); assert.equal(v.status, status); if (reason !== undefined) assert.equal(v.reason, reason) }

  assert.deepEqual(judge({ authorization: undefined }), { who: 'none' })
  assert.deepEqual(judge({ authorization: 'Basic dXNlcjpwYXNz' }), { who: 'none' }, 'another scheme is not ours to judge')
  assert.deepEqual(judge({}), { who: 'bearer' })
  assert.deepEqual(judge({ authorization: 'bearer   ' + good() + '  ' }), { who: 'bearer' }, 'the scheme is case-insensitive')
  for (const path of ['/api/apps', '/api/apps/shop/records', '/api/apps/shop/write', '/api/apps/shop/bundle', '/api/me', '/health']) assert.equal(judge({ path }).who, 'bearer', path)
  // a bad bearer is a 401 and never falls back: with or without cookies
  for (const authorization of ['Bearer', 'Bearer ', 'Bearer x', 'Bearer ' + flip(good()), 'Bearer ' + good() + 'x', 'Bearer ' + signToken('open', { n: 'x' }, KEY, { now: c.now, ttlSec: 60 }), 'Bearer ' + mintOwnerApiToken({ key: Buffer.alloc(32, 9), now: c.now })]) {
    refused(judge({ authorization }), 401)
    refused(judge({ authorization, cookie: 'kb_session=abc' }), 401)
  }
  const old = mintOwnerApiToken({ key: KEY, now: () => c.t - 3600_000 })
  refused(judge({ authorization: 'Bearer ' + old }), 401, 'expired')
  refused(judge({ authorization: 'Bearer ' + signToken('owner-api', { n: 'x', i: Math.floor(c.t / 1000) }, KEY, { now: c.now, ttlSec: 3600 }) }), 401, 'lifetime')
  // a good bearer with a cookie is a cookie request: Origin and CSRF stay in force, the bearer gives nothing
  assert.deepEqual(judge({ cookie: 'kb_session=abc' }), { who: 'cookie' })
  assert.deepEqual(judge({ cookie: 'kb_session=abc', path: '/api/people' }), { who: 'cookie' })
  assert.deepEqual(judge({ cookie: '' }), { who: 'bearer' }, 'an empty Cookie header carries nothing')
  // a good bearer is for the apps routes only: not the people, not the password, not the pages
  for (const path of ['/api/people', '/api/people/members/u1', '/api/me/password', '/people', '/invite', '/open', '/', '/api/csrf', '/api/auth/sign-out', '/api/applications', '/api/apps-evil', '/api/me/x']) refused(judge({ path }), 403, 'bearer-scope')
  assert.equal(BEARER_SCOPE.test('/api/apps'), true)
  assert.equal(BEARER_SCOPE.test('/api/apps/'), true)
})

ok('KB_BUNDLE_MAX_BYTES: a default of 256 MiB, a whole number between 1 MiB and 2 GiB, nothing else', () => {
  assert.equal(bundleCap(undefined), 256 * 1024 * 1024)
  assert.equal(bundleCap(''), 256 * 1024 * 1024)
  assert.equal(bundleCap(String(5 * 1024 * 1024)), 5 * 1024 * 1024)
  assert.equal(bundleCap(String(BUNDLE_MAX_FLOOR)), BUNDLE_MAX_FLOOR)
  assert.equal(bundleCap(String(BUNDLE_MAX_CEILING)), BUNDLE_MAX_CEILING)
  for (const bad of ['0', '-5', '1.5', 'lots', String(BUNDLE_MAX_FLOOR - 1), String(BUNDLE_MAX_CEILING + 1), '1e9x', ' ']) assert.throws(() => bundleCap(bad), /KB_BUNDLE_MAX_BYTES/, bad)
  assert.equal(loadConfig({ KB_AUTH_SECRET: 'e'.repeat(40), KB_BOOT_KEY: 'ab'.repeat(16), KB_DATA_DIR: join(tmpdir(), 'kb-boot-' + process.pid), KB_BUNDLE_MAX_BYTES: '3145728' }, tmpdir(), { needPort: false }).bundleMaxBytes, 3145728)
  rmSync(join(tmpdir(), 'kb-boot-' + process.pid), { recursive: true, force: true })
})

console.log('\ntables template, pure logic: ' + count + ' checks passed')
