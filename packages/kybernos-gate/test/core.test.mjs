// Unit tests of the gate's building blocks: password, session cookie, limiter, DSH cookie, config.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { hashPassword, verifyPassword, parseVerifier } from '../core/password.mjs'
import { signSession, verifySession, serializeCookie, readCookie, stripCookie, clearCookie, SESSION_COOKIE } from '../core/session.mjs'
import { createLimiter } from '../core/limiter.mjs'
import { readDshSecret, mintDshCookie, dshAuthority, dshCookieName } from '../core/dsh-session.mjs'
import { loadConfig, ConfigError } from '../core/config.mjs'
import { safeNext, pickLanguage } from '../core/page.mjs'

const CHEAP = { N: 1024, r: 8, p: 1 }
const tmp = () => mkdtempSync(join(tmpdir(), 'kb-gate-'))

// ── password ──
test('password: a verifier accepts the right password and refuses a wrong one', async () => {
  const stored = await hashPassword('correct horse', CHEAP)
  assert.ok(stored.startsWith('scrypt$1024$8$1$'))
  assert.equal(await verifyPassword('correct horse', stored), true)
  assert.equal(await verifyPassword('correct horsf', stored), false)
  assert.equal(await verifyPassword('', stored), false)
})
test('password: two hashes of the same password differ (random salt)', async () => {
  assert.notEqual(await hashPassword('same one', CHEAP), await hashPassword('same one', CHEAP))
})
test('password: a malformed verifier answers false, never throws', async () => {
  for (const bad of ['', 'x', 'scrypt$1$2$3', 'scrypt$1000$8$1$AAAA$BBBB', 'bcrypt$1024$8$1$AAAAAAAAAAAA$' + 'A'.repeat(43), null, undefined, 7]) {
    assert.equal(await verifyPassword('anything', bad), false, String(bad))
  }
})
test('password: parameters that would exhaust memory are refused before any work', () => {
  const salt = Buffer.alloc(16, 1).toString('base64url'), hash = Buffer.alloc(32, 2).toString('base64url')
  assert.equal(parseVerifier(`scrypt$${2 ** 24}$8$1$${salt}$${hash}`), null)
  assert.equal(parseVerifier(`scrypt$1024$64$1$${salt}$${hash}`), null)
  assert.equal(parseVerifier(`scrypt$1024$8$64$${salt}$${hash}`), null)
  assert.notEqual(parseVerifier(`scrypt$1024$8$1$${salt}$${hash}`), null)
})

// ── session cookie ──
const SECRET = randomBytes(32)
test('session: a signed value verifies until it expires', () => {
  const v = signSession(SECRET, { now: 1000, ttlMs: 5000 })
  assert.notEqual(verifySession(SECRET, v, 1000), null)
  assert.notEqual(verifySession(SECRET, v, 5999), null)
  assert.equal(verifySession(SECRET, v, 6001), null)
})
test('session: tampering, another secret and junk are all refused', () => {
  const v = signSession(SECRET, { now: Date.now(), ttlMs: 60000 })
  const [a, body, sig] = v.split('.')
  const forged = Buffer.from(JSON.stringify({ v: 1, iat: 1, exp: 9e15, sid: 'x' })).toString('base64url')
  assert.equal(verifySession(SECRET, `${a}.${forged}.${sig}`), null)
  assert.equal(verifySession(randomBytes(32), v), null)
  for (const junk of ['', 'v1', 'v1..', 'v2.a.b', undefined, null, 'v1.' + 'a'.repeat(600) + '.b']) assert.equal(verifySession(SECRET, junk), null)
})
test('session: cookie header helpers', () => {
  assert.match(serializeCookie('a', 'b', { maxAgeSeconds: 10, secure: true }), /^a=b; Max-Age=10; Path=\/; HttpOnly; SameSite=Strict; Secure$/)
  assert.doesNotMatch(serializeCookie('a', 'b', { maxAgeSeconds: 10, secure: false }), /Secure/)
  assert.throws(() => serializeCookie('a b', 'v', { maxAgeSeconds: 1, secure: false }))
  assert.throws(() => serializeCookie('a', 'v;x', { maxAgeSeconds: 1, secure: false }))
  assert.match(clearCookie('a', { secure: false }), /^a=; Max-Age=0/)
  assert.equal(readCookie('x=1; kybernos_gate=abc; y=2', SESSION_COOKIE), 'abc')
  assert.equal(readCookie('x=1', SESSION_COOKIE), undefined)
  assert.equal(stripCookie('x=1; kybernos_gate=abc; y=2', SESSION_COOKIE), 'x=1; y=2')
  assert.equal(stripCookie('kybernos_gate=abc', SESSION_COOKIE), undefined)
})

// ── limiter ──
test('limiter: five failures lock the client, the lock doubles, a success clears', () => {
  let t = 0
  const l = createLimiter({ now: () => t })
  assert.deepEqual(l.check('a'), { locked: false, triesLeft: 5 })
  for (let i = 1; i <= 4; i++) assert.deepEqual(l.fail('a'), { locked: false, triesLeft: 5 - i })
  assert.deepEqual(l.fail('a'), { locked: true, retryAfter: 45 })
  t += 10000
  assert.deepEqual(l.check('a'), { locked: true, retryAfter: 35 })
  assert.deepEqual(l.check('b'), { locked: false, triesLeft: 5 }, 'another client is unaffected')
  t += 36000
  assert.equal(l.check('a').locked, false)
  for (let i = 0; i < 4; i++) l.fail('a')
  assert.deepEqual(l.fail('a'), { locked: true, retryAfter: 90 }, 'the second lock is twice as long')
  t += 91000
  l.succeed('a')
  assert.deepEqual(l.check('a'), { locked: false, triesLeft: 5 })
})
test('limiter: old failures are forgotten', () => {
  let t = 0
  const l = createLimiter({ now: () => t })
  l.fail('a'); l.fail('a')
  t += 16 * 60000
  assert.deepEqual(l.check('a'), { locked: false, triesLeft: 5 })
})
test('limiter: a flood from many addresses locks everyone for a while', () => {
  let t = 0
  const l = createLimiter({ now: () => t, globalMax: 10, globalLockMs: 30000 })
  for (let i = 0; i < 11; i++) l.fail('ip' + i)
  assert.deepEqual(l.check('someone-new'), { locked: true, retryAfter: 30 })
  t += 31000
  assert.equal(l.check('someone-new').locked, false)
})
test('limiter: memory stays bounded', () => {
  const l = createLimiter({ maxKeys: 50 })
  for (let i = 0; i < 500; i++) l.fail('ip' + i)
  assert.ok(l.size() <= 50)
})

// ── DSH cookie ──
const b64 = (buf) => Buffer.from(buf).toString('base64url')
test('dsh-session: the secret is read from the credentials record, and only a 32-byte one is accepted', () => {
  const home = tmp()
  const secret = randomBytes(32)
  writeFileSync(join(home, '.credentials.yaml'), `other/thing:\n  kind: grant\n  payload:\n    secret: nope\nclient-connection/browser-session:\n  kind: grant\n  payload:\n    version: 1\n    secret: ${b64(secret)}\n`)
  assert.deepEqual(readDshSecret(home), secret)
  writeFileSync(join(home, '.credentials.yaml'), 'client-connection/browser-session:\n  payload:\n    secret: c2hvcnQ\n')
  assert.equal(readDshSecret(home), null)
  assert.equal(readDshSecret(join(home, 'missing')), null)
})
test('dsh-session: the minted cookie has exactly the shape DSH signs and checks', () => {
  const secret = randomBytes(32)
  const c = mintDshCookie({ secret, hostHeader: 'DSH.Example.com', now: 1_700_000_000_000, ttlMs: 86_400_000, secure: true })
  assert.equal(dshAuthority('DSH.Example.com'), 'dsh.example.com')
  assert.equal(c.name, 'dsh-auth-' + b64(createHash('sha256').update('dsh.example.com').digest()))
  assert.equal(dshCookieName('dsh.example.com'), c.name)
  const [pair, ...attrs] = c.header.split('; ')
  assert.ok(pair.startsWith(c.name + '='))
  assert.deepEqual(attrs, ['Max-Age=86400', 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Secure'])
  const [v, body, sig] = pair.slice(c.name.length + 1).split('.')
  assert.equal(v, 'v1')
  assert.equal(sig, b64(createHmac('sha256', secret).update(body).digest()))
  assert.deepEqual(JSON.parse(Buffer.from(body, 'base64url').toString('utf8')), { version: 1, authority: 'dsh.example.com', issuedAt: 1_700_000_000_000, expiresAt: 1_700_000_000_000 + 86_400_000 })
})
test('dsh-session: no secret or an unusable host mints nothing', () => {
  assert.equal(mintDshCookie({ secret: null, hostHeader: 'a.b', ttlMs: 1 }), null)
  assert.equal(mintDshCookie({ secret: randomBytes(32), hostHeader: '', ttlMs: 1 }), null)
  assert.equal(mintDshCookie({ secret: randomBytes(32), hostHeader: 'bad host', ttlMs: 1 }), null)
})
// ── page helpers ──
test('page: safeNext keeps same-site paths and nothing else', () => {
  assert.equal(safeNext('/settings/models'), '/settings/models')
  for (const bad of ['//evil.example', 'https://evil.example', '/\\evil.example', 'javascript:alert(1)', '', undefined, null, '/a\nb', '/' + 'a'.repeat(3000)]) assert.equal(safeNext(bad), '/', String(bad))
})
test('page: the language comes from Accept-Language', () => {
  assert.equal(pickLanguage('fr-FR,fr;q=0.9,en;q=0.8'), 'fr')
  assert.equal(pickLanguage('en-US,en;q=0.9,fr;q=0.8'), 'en')
  assert.equal(pickLanguage(undefined), 'en')
})

// ── config ──
test('config: it refuses to start without a password, and says why', async () => {
  await assert.rejects(loadConfig({ DSH_HOME: tmp() }), (e) => e instanceof ConfigError && /no default password/.test(e.message))
  await assert.rejects(loadConfig({ DSH_HOME: tmp(), KYBERNOS_GATE_PASSWORD: 'short' }), ConfigError)
})
test('config: defaults are the safe ones', async () => {
  const c = await loadConfig({ DSH_HOME: tmp(), KYBERNOS_GATE_PASSWORD: 'a long enough one' }, { hashParams: CHEAP })
  assert.equal(c.host, '127.0.0.1')
  assert.equal(c.port, 3080)
  assert.equal(c.user, 'kybernos')
  assert.equal(c.trustProxy, false)
  assert.equal(c.sessionDays, 30)
  assert.equal(c.upstream.origin, 'http://127.0.0.1:3081')
  assert.equal(await verifyPassword('a long enough one', c.verifier), true)
})
test('config: a verifier from the environment is validated, and wins over a plain password', async () => {
  await assert.rejects(loadConfig({ DSH_HOME: tmp(), KYBERNOS_GATE_PASSWORD_HASH: 'not a verifier' }), ConfigError)
  const stored = await hashPassword('from the hash', CHEAP)
  const warnings = []
  const c = await loadConfig({ DSH_HOME: tmp(), KYBERNOS_GATE_PASSWORD_HASH: stored, KYBERNOS_GATE_PASSWORD: 'ignored one' }, { warn: (m) => warnings.push(m) })
  assert.equal(c.verifier, stored)
  assert.equal(warnings.length, 1)
})
test('config: bad numbers and a non-http upstream are refused', async () => {
  const base = { DSH_HOME: tmp(), KYBERNOS_GATE_PASSWORD: 'a long enough one' }
  await assert.rejects(loadConfig({ ...base, KYBERNOS_GATE_PORT: '70000' }, { hashParams: CHEAP }), ConfigError)
  await assert.rejects(loadConfig({ ...base, KYBERNOS_GATE_SESSION_DAYS: '0' }, { hashParams: CHEAP }), ConfigError)
  await assert.rejects(loadConfig({ ...base, KYBERNOS_GATE_UPSTREAM: 'https://x.example' }, { hashParams: CHEAP }), ConfigError)
  await assert.rejects(loadConfig({ ...base, KYBERNOS_GATE_UPSTREAM: 'nope' }, { hashParams: CHEAP }), ConfigError)
})
test('config: the session secret is created once, private, and reused', async () => {
  const home = tmp()
  const env = { DSH_HOME: home, KYBERNOS_GATE_PASSWORD: 'a long enough one' }
  const a = await loadConfig(env, { hashParams: CHEAP })
  const file = join(home, 'kybernos', 'gate-secret')
  assert.ok(existsSync(file))
  assert.equal(statSync(file).mode & 0o077, 0, 'readable by its owner only')
  const b = await loadConfig(env, { hashParams: CHEAP })
  assert.deepEqual(a.secret, b.secret)
  const c = await loadConfig({ ...env, KYBERNOS_GATE_SECRET: 'x'.repeat(40) }, { hashParams: CHEAP })
  assert.equal(c.secret.toString(), 'x'.repeat(40))
  await assert.rejects(loadConfig({ ...env, KYBERNOS_GATE_SECRET: 'short' }, { hashParams: CHEAP }), ConfigError)
  assert.ok(readFileSync(file, 'utf8').trim().length >= 40)
})
