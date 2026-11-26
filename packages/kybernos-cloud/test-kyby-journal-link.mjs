// The Journal link of a finished turn (kyby-journal-link.mjs): the token the computer's gate accepts, the cookie DSH accepts for one loopback call, the page saved on the disk, and what
// happens when anything is missing. The gate's own route is tested in packages/kybernos-gate/test/server.test.mjs; here the two packages are checked against each other.
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { LINK_TTL_MS, PAGES_KEEP, loopbackCookie, makeJournalLink, mintPageToken, pageKey, pagesDir, savePage } from './kyby-journal-link.mjs'
import { cookieSessionValide } from './session-guard.mjs'

// The gate's reader, loaded by a computed address: bundles are installed on their own and import nothing from one another (a static import would put the gate in this package's graph).
// The repository has both; a tree that has only this package skips the cross-check instead of failing.
const gateFile = new URL('../kybernos-gate/core/page-link.mjs', import.meta.url)
if (!existsSync(gateFile)) { console.log('SKIPPED: the gate is not next to this package (the cross-check with its reader runs in the repository)'); process.exit(0) }
const { pageKey: gateKey, readPageToken } = await import(gateFile.href)

let passed = 0
const check = async (name, fn) => { await fn(); passed += 1; console.log('ok - ' + name) }
const TOKEN = 'kyd_the-computers-own-token'
const NOW = 1_795_200_000_000

await check('what is made here is read by the gate: the same key from the same token, an end time a few minutes away, nothing else accepted', () => {
  assert.deepEqual(pageKey(TOKEN), gateKey(TOKEN), 'the two packages derive the same key')
  const m = mintPageToken({ key: pageKey(TOKEN), now: NOW })
  assert.match(m.token, /^[A-Za-z0-9_-]{22}\.\d{13}\.[A-Za-z0-9_-]{43}$/)
  assert.equal(m.expiresAt, NOW + LINK_TTL_MS)
  assert.ok(LINK_TTL_MS >= 5 * 60_000 && LINK_TTL_MS <= 30 * 60_000, 'a few minutes, not days')
  const read = readPageToken(gateKey(TOKEN), m.token, NOW + 1000)
  assert.deepEqual(read, { id: m.id, expiresAt: m.expiresAt, expired: false })
  assert.equal(readPageToken(gateKey(TOKEN), m.token, m.expiresAt - 1).expired, false)
  assert.equal(readPageToken(gateKey(TOKEN), m.token, m.expiresAt).expired, true, 'over at its end time')
  assert.equal(readPageToken(gateKey(TOKEN), m.token, NOW + 3_600_000).expired, true)
  // Another computer's token, a changed id, a changed end time (a later one is the attack), a changed signature, garbage: none is read.
  assert.equal(readPageToken(gateKey('kyd_another-computer'), m.token, NOW), null)
  const [id, exp, sig] = m.token.split('.')
  const other = mintPageToken({ key: pageKey(TOKEN), now: NOW }).id
  for (const t of [`${other}.${exp}.${sig}`, `${id}.${Number(exp) + 3_600_000}.${sig}`, `${id}.${exp}.${sig.slice(0, -1)}${sig.endsWith('A') ? 'B' : 'A'}`, `${id}.${exp}`, `${id}.${exp}.${sig}.x`, '', 'x', `../${id}.${exp}.${sig}`]) {
    assert.equal(readPageToken(gateKey(TOKEN), t, NOW), null, t)
  }
  assert.equal(readPageToken(gateKey(TOKEN), null, NOW), null)
  assert.equal(readPageToken(null, m.token, NOW), null)
})

await check('the cookie for the loopback call is the one DSH reads as a signed-in browser\'s: this listener, this secret, a minute', () => {
  const secret = randomBytes(32)
  const cookie = loopbackCookie({ secret, port: 3081, now: NOW })
  assert.match(cookie, /^dsh-auth-[A-Za-z0-9_-]+=v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
  assert.equal(cookieSessionValide(cookie, ['127.0.0.1:3081'], secret, NOW + 1000), true)
  assert.equal(cookieSessionValide(cookie, ['127.0.0.1:3081'], secret, NOW + 61_000), false, 'a minute')
  assert.equal(cookieSessionValide(cookie, ['127.0.0.1:3082'], secret, NOW + 1000), false, 'another port')
  assert.equal(cookieSessionValide(cookie, ['127.0.0.1:3081'], randomBytes(32), NOW + 1000), false, 'another secret')
  assert.equal(loopbackCookie({ secret: null, port: 3081 }), null)
  assert.equal(loopbackCookie({ secret: Buffer.alloc(0), port: 3081 }), null)
})

/** A DSH that answers `/kybernos/journal/page` the way the plugin does, and records what it was asked. */
const stand = (answer) => {
  const asked = []
  return { asked, fetchImpl: async (url, init) => { asked.push({ url: String(url), init }); return typeof answer === 'function' ? answer(url, init) : new Response(JSON.stringify(answer), { status: 200 }) } }
}
const HTML = '<!doctype html><html><body>journal</body></html>'

await check('a link: the page is asked for as the person\'s own page asks, saved under the id, and the path and end time come back', async () => {
  const dir = pagesDir(mkdtempSync(join(tmpdir(), 'kb-jl-')))
  const secret = randomBytes(32)
  const s = stand({ ok: true, name: 'journal.html', html: HTML })
  const out = await makeJournalLink({ port: 3081, sessionId: 'sess_abc-1', computerToken: TOKEN, secret, dir, now: NOW, fetchImpl: s.fetchImpl, random: () => 'AbCdEfGhIjKlMnOpQrStUv' })
  assert.equal(out.ok, true)
  assert.match(out.path, /^\/__gate\/page\/AbCdEfGhIjKlMnOpQrStUv\.\d{13}\.[A-Za-z0-9_-]{43}$/)
  assert.equal(out.expires_at, new Date(NOW + LINK_TTL_MS).toISOString())
  assert.equal(s.asked.length, 1)
  const q = s.asked[0]
  assert.equal(q.url, 'http://127.0.0.1:3081/kybernos/journal/page')
  assert.equal(q.init.method, 'POST')
  assert.equal(q.init.headers.origin, 'http://127.0.0.1:3081')
  assert.equal(cookieSessionValide(q.init.headers.cookie, ['127.0.0.1:3081'], secret, NOW + 1000), true, 'the plugin\'s write guard would accept it')
  assert.deepEqual(JSON.parse(q.init.body), { sessionId: 'sess_abc-1', lang: 'en' })
  assert.equal(readFileSync(join(dir, 'AbCdEfGhIjKlMnOpQrStUv.html'), 'utf8'), HTML)
  // The token that came back is the one the gate reads, for that very file.
  const token = out.path.slice('/__gate/page/'.length)
  assert.equal(readPageToken(gateKey(TOKEN), token, NOW + 1000).id, 'AbCdEfGhIjKlMnOpQrStUv')
  // French only when asked for in exactly that word.
  const f = stand({ ok: true, html: HTML })
  await makeJournalLink({ port: 3081, sessionId: 's1', computerToken: TOKEN, secret, dir, lang: 'fr', now: NOW, fetchImpl: f.fetchImpl })
  assert.equal(JSON.parse(f.asked[0].init.body).lang, 'fr')
  const g = stand({ ok: true, html: HTML })
  await makeJournalLink({ port: 3081, sessionId: 's1', computerToken: TOKEN, secret, dir, lang: 'FR; drop', now: NOW, fetchImpl: g.fetchImpl })
  assert.equal(JSON.parse(g.asked[0].init.body).lang, 'en')
})

await check('anything missing or wrong is a short code, never a throw and never a half-written link', async () => {
  const dir = pagesDir(mkdtempSync(join(tmpdir(), 'kb-jl-')))
  const secret = randomBytes(32)
  const base = { port: 3081, sessionId: 's1', computerToken: TOKEN, secret, dir, now: NOW }
  const run = (over) => makeJournalLink({ ...base, ...over })
  const good = stand({ ok: true, html: HTML })
  assert.deepEqual(await run({ secret: null, fetchImpl: good.fetchImpl }), { ok: false, error: 'no_secret' })
  assert.deepEqual(await run({ computerToken: '', fetchImpl: good.fetchImpl }), { ok: false, error: 'no_computer' })
  for (const sessionId of ['', '../x', 'a b', 'x'.repeat(81), undefined, 42]) assert.deepEqual(await run({ sessionId, fetchImpl: good.fetchImpl }), { ok: false, error: 'bad_session' }, String(sessionId))
  assert.equal(good.asked.length, 0, 'nothing was asked for with a missing piece')
  assert.deepEqual(await run({ fetchImpl: stand(() => new Response(JSON.stringify({ ok: false, error: 'no readable journal' }), { status: 404 })).fetchImpl }), { ok: false, error: 'no_journal' })
  assert.deepEqual(await run({ fetchImpl: stand(() => new Response('<html>login</html>', { status: 200 })).fetchImpl }), { ok: false, error: 'page_failed' })
  assert.deepEqual(await run({ fetchImpl: stand(() => new Response(JSON.stringify({ ok: true, html: '' }), { status: 200 })).fetchImpl }), { ok: false, error: 'page_failed' })
  assert.deepEqual(await run({ fetchImpl: stand(() => new Response(JSON.stringify({ ok: false }), { status: 401 })).fetchImpl }), { ok: false, error: 'page_failed' })
  assert.deepEqual(await run({ fetchImpl: async () => { throw new Error('connect ECONNREFUSED') } }), { ok: false, error: 'page_failed' })
  assert.deepEqual(await run({ fetchImpl: stand({ ok: true, html: 'x'.repeat(6 * 1024 * 1024 + 1) }).fetchImpl }), { ok: false, error: 'page_too_big' })
  assert.equal(existsSync(dir) ? readdirSync(dir).length : 0, 0, 'no failure left a file')
})

await check('the pages on the disk are the newest few and none is older than a day; the one just written stays whatever its age', () => {
  const dir = pagesDir(mkdtempSync(join(tmpdir(), 'kb-jl-')))
  const id = (n) => String(n).padStart(22, 'a')
  for (let i = 0; i < 25; i += 1) {
    const name = savePage({ dir, id: id(i), html: 'p' + i, now: NOW })
    const at = new Date(NOW - (25 - i) * 60_000)
    utimesSync(join(dir, name), at, at)
  }
  writeFileSync(join(dir, 'notes.txt'), 'not a page')
  savePage({ dir, id: id(99), html: 'new', now: NOW })
  const pages = readdirSync(dir).filter((f) => f.endsWith('.html'))
  assert.equal(pages.length, PAGES_KEEP, 'the newest ' + PAGES_KEEP)
  assert.ok(pages.includes(id(99) + '.html'))
  assert.ok(!pages.includes(id(0) + '.html'), 'the oldest went')
  assert.ok(readdirSync(dir).includes('notes.txt'), 'what is not a page is left alone')
  // Older than a day: gone, but never the page being written.
  const old = savePage({ dir, id: id(50), html: 'a', now: NOW })
  const long = new Date(NOW - 2 * 86_400_000)
  utimesSync(join(dir, old), long, long)
  savePage({ dir, id: id(51), html: 'b', now: NOW })
  assert.ok(!readdirSync(dir).includes(old), 'a page over a day old is removed')
  const mine = savePage({ dir, id: id(52), html: 'c', now: NOW + 5 * 86_400_000 })
  assert.ok(readdirSync(dir).includes(mine), 'the page just written stays')
})

console.log(`\n${passed} passed`)
