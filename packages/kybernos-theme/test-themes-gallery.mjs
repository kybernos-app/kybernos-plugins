#!/usr/bin/env node
// The disk and network half of the theme gallery (themes-gallery.mjs), against a LOCAL http server and a temp folder.
//
//   node test-themes-gallery.mjs
//
// What is pinned here:
//  - the shipped catalogue shows with no network, no cache and no key;
//  - a refresh verifies before it believes: a good one is cached and shown, a tampered, wrongly signed, older
//    or oversized one changes nothing and says why;
//  - the cache is verified AGAIN on every read, so a hand-edited or orphaned cache stops counting;
//  - only https (or loopback http) is ever asked, a redirect cannot downgrade, the setting '' turns it off;
//  - the route guards its origin like the other routes and never lets a host fault escape.
import { createServer } from 'node:http'
import { generateKeyPairSync, sign } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_URL, KIND, MAX_DOC_BYTES, SCHEMA } from './themes-catalogue.mjs'
import { createGallery, download, forgetGalleries, loadKeys, loadShipped, readCatalogueUrl, serveGallery, urlAllowed } from './themes-gallery.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}
const section = (title) => console.log('\n' + title)

const pair = () => { const { publicKey, privateKey } = generateKeyPairSync('ed25519'); return { pem: publicKey.export({ type: 'spki', format: 'pem' }), priv: privateKey } }
const A = pair()
const B = pair()
const keysA = [{ keyId: 'a', pem: A.pem }]
const theme = (id, over = {}) => ({ id, v: 1, name: id, author: 'Kybernos', description: { fr: 'Un thème.', en: 'A theme.' }, settings: { mode: 'dark', acc: '#22c55e' }, ...over })
const doc = (seq, ids = ['online-one'], over = {}) => ({ schema: SCHEMA, kind: KIND, publishedAt: '2026-10-08T12:00:00.000Z', seq, themes: ids.map((i) => theme(i)), ...over })
const bytesOf = (d) => Buffer.from(JSON.stringify(d, null, 2) + '\n', 'utf8')
const sig = (b, priv = A.priv) => sign(null, b, priv).toString('base64')
const shipped = { schema: SCHEMA, kind: KIND, publishedAt: '2026-10-01T00:00:00.000Z', seq: 2, themes: [theme('shipped-one'), theme('shipped-two')] }
const tmp = () => mkdtempSync(join(tmpdir(), 'kb-gallery-'))

// A local "catalogue server": what it serves is set per test.
const serve = { doc: null, sig: null, status: 200, hits: [], redirect: null, big: false }
const server = createServer((req, res) => {
  serve.hits.push(req.url)
  if (serve.redirect !== null) { res.writeHead(302, { location: serve.redirect }); res.end(); return }
  if (serve.status !== 200) { res.writeHead(serve.status); res.end('nope'); return }
  const body = req.url.endsWith('.sig') ? serve.sig : (serve.big ? Buffer.alloc(MAX_DOC_BYTES + 10, 32) : serve.doc)
  if (body === null) { res.writeHead(404); res.end(); return }
  res.writeHead(200, { 'content-type': 'application/octet-stream' }); res.end(body)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const BASE = 'http://127.0.0.1:' + server.address().port
const URL_OK = BASE + '/themes.catalog.json'
const publish = (d, priv = A.priv) => { const b = bytesOf(d); serve.doc = b; serve.sig = sig(b, priv); serve.status = 200; serve.redirect = null; serve.big = false; return b }
const reset = () => { serve.doc = null; serve.sig = null; serve.status = 200; serve.hits.length = 0; serve.redirect = null; serve.big = false }

try {
  section('which addresses may be asked for')
  {
    check('https is allowed, with or without a path', urlAllowed('https://raw.githubusercontent.com/x/y/main/c.json') && urlAllowed('https://example.test/'))
    check('plain http only on a loopback address', urlAllowed('http://127.0.0.1:8080/a') && urlAllowed('http://localhost/a') && urlAllowed('http://[::1]:3/a') && !urlAllowed('http://example.test/a') && !urlAllowed('http://10.0.0.5/a') && !urlAllowed('http://127.0.0.1.evil.test/a'))
    check('a user name or a password in the URL is refused', !urlAllowed('https://user:pw@example.test/a') && !urlAllowed('https://user@example.test/a'))
    check('other schemes and nonsense are refused', !urlAllowed('file:///etc/passwd') && !urlAllowed('ftp://example.test/') && !urlAllowed('javascript:alert(1)') && !urlAllowed('not a url') && !urlAllowed(''))
    const dir = tmp()
    check('no settings file: the default address', readCatalogueUrl(dir) === DEFAULT_URL)
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ themesCatalogueUrl: ' https://example.test/c.json ' }))
    check('the setting overrides it (trimmed)', readCatalogueUrl(dir) === 'https://example.test/c.json')
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ themesCatalogueUrl: '' }))
    check('an empty setting turns the online catalogue off', readCatalogueUrl(dir) === '')
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ themesCatalogueUrl: 42 }))
    check('a setting that is not a string is ignored', readCatalogueUrl(dir) === DEFAULT_URL)
    writeFileSync(join(dir, 'settings.json'), '{ broken')
    check('a damaged settings file is ignored', readCatalogueUrl(dir) === DEFAULT_URL)
    rmSync(dir, { recursive: true, force: true })
  }

  section('the shipped files load, or fall back')
  {
    const dir = tmp()
    check('a missing or damaged gallery.json gives an empty catalogue, not an error', loadShipped(join(dir, 'none.json')).themes.length === 0 && loadShipped(join(dir, 'none.json')).seq === 0)
    writeFileSync(join(dir, 'g.json'), '{ no')
    check('...and so does a malformed one', loadShipped(join(dir, 'g.json')).themes.length === 0)
    writeFileSync(join(dir, 'g.json'), JSON.stringify(shipped))
    check('a good one is read', loadShipped(join(dir, 'g.json')).themes.length === 2)
    writeFileSync(join(dir, 'k.json'), JSON.stringify({ keys: [{ keyId: 'a', pem: A.pem }, { nope: 1 }, null] }))
    check('keys: the well-formed ones are kept', loadKeys(join(dir, 'k.json')).length === 1)
    check('keys: a missing or damaged file means no key at all', loadKeys(join(dir, 'nope.json')).length === 0 && (writeFileSync(join(dir, 'k.json'), '{ x'), loadKeys(join(dir, 'k.json')).length === 0))
    const real = loadShipped(new URL('./gallery.json', import.meta.url).pathname)
    check('the gallery.json of this bundle is valid', real.seq >= 1 && real.themes.length >= 1, real.seq)
    rmSync(dir, { recursive: true, force: true })
  }

  section('before any refresh')
  {
    const dir = tmp()
    const g = createGallery({ dir, shipped, keys: keysA, url: URL_OK })
    const s = g.snapshot()
    check('the shipped catalogue shows, with no network and no cache', s.ok === true && s.source === 'shipped' && s.themes.length === 2 && s.seq === 2, s)
    check('...and says the online one was never asked', s.online.state === 'never' && serve.hits.length === 0)
    check('with the online catalogue turned off, it says « off »', createGallery({ dir, shipped, keys: keysA, url: '' }).snapshot().online.state === 'off')
    rmSync(dir, { recursive: true, force: true })
  }

  section('a refresh')
  {
    reset()
    const dir = tmp()
    let clock = 1000
    const g = createGallery({ dir, shipped, keys: keysA, url: URL_OK, now: () => clock })
    publish(doc(5, ['online-one', 'online-two', 'online-three']))
    const r = await g.refresh()
    check('a signed, newer catalogue is shown instead of the shipped one', r.source === 'signed' && r.seq === 5 && r.themes.length === 3 && r.themes[0].id === 'online-one', r)
    check('...the answer says it worked, and when', r.online.state === 'ok' && r.online.at === 1000 && r.online.reason === null)
    check('...both the document and its signature were asked for (the signature at <url>.sig)', serve.hits.join() === '/themes.catalog.json,/themes.catalog.json.sig', serve.hits)
    check('...and it is cached on disk', existsSync(g.cacheFile))
    const hits = serve.hits.length
    const again = createGallery({ dir, shipped, keys: keysA, url: URL_OK, fetchImpl: () => { throw new Error('no network is needed to read the cache') } }).snapshot()
    check('a fresh gallery over the same folder shows it with no network at all (the cache is re-verified on read)', again.source === 'signed' && again.seq === 5 && serve.hits.length === hits, again.source)
    check('a newer signed catalogue replaces the cached one', (publish(doc(6, ['online-six'])), (await g.refresh()).seq === 6) && g.snapshot().themes[0].id === 'online-six')
    check('the same age is fine (a republish of the same seq)', (publish(doc(6, ['online-six', 'online-extra'])), (await g.refresh()).themes.length === 2))
    clock = 2000
    const older = (publish(doc(4, ['rolled-back'])), await g.refresh())
    check('an OLDER one, genuinely signed, is refused as a rollback; what was shown stays', older.online.state === 'refused' && older.online.reason === 'older' && older.themes.length === 2 && older.seq === 6, older)
    check('...the time of the failed attempt is kept apart from the cache', older.online.at === 2000)
    const cacheBefore = readFileSync(g.cacheFile, 'utf8')
    const b = publish(doc(9, ['tampered']))
    serve.doc = Buffer.concat([b, Buffer.from(' ')])
    const tampered = await g.refresh()
    check('a document altered after signing is refused, the cache is untouched', tampered.online.reason === 'signature' && readFileSync(g.cacheFile, 'utf8') === cacheBefore)
    publish(doc(9, ['wrong-key']), B.priv)
    check('a document signed by a key nobody trusts is refused', (await g.refresh()).online.reason === 'signature')
    publish(doc(1, ['older-than-shipped']))
    const dir2 = tmp()
    const fresh = createGallery({ dir: dir2, shipped, keys: keysA, url: URL_OK })
    check('older than the SHIPPED catalogue is a rollback too (seq 1 < 2), with no cache at all', (await fresh.refresh()).online.reason === 'older' && fresh.snapshot().source === 'shipped')
    publish({ ...doc(9), themes: [theme('x', { settings: { mode: 'dark', contrastMode: 'max' } })] })
    check('signed but with an accessibility setting: refused for its shape', (await g.refresh()).online.reason === 'theme')
    serve.doc = Buffer.from('{ not json'); serve.sig = sig(serve.doc)
    check('signed but not JSON: refused', (await g.refresh()).online.reason === 'json')
    serve.big = true
    check('a document over the cap is never read in full (the refresh says offline: too-large)', (await g.refresh()).online.reason === 'too-large')
    serve.status = 500
    const off = await g.refresh()
    check('a server error means « offline », and the cached catalogue is still what is shown', off.online.state === 'offline' && off.online.reason === 'http' && off.source === 'signed' && off.seq === 6, off.online)
    serve.status = 200; serve.doc = null
    check('a missing signature file (404) is offline too, nothing is cached from it', (publish(doc(11, ['no-sig'])), serve.sig = null, (await g.refresh()).online.reason === 'http') && g.snapshot().seq === 6)
    rmSync(dir2, { recursive: true, force: true })

    // the cache is verified AGAIN on every read
    publish(doc(7, ['seven'])); await g.refresh()
    writeFileSync(g.cacheFile, readFileSync(g.cacheFile, 'utf8').replace('seven', 'EVIL!'))
    check('a cache edited by hand no longer verifies: the shipped catalogue shows again', g.snapshot().source === 'shipped')
    publish(doc(7, ['seven'])); await g.refresh()
    const dropped = createGallery({ dir, shipped, keys: [{ keyId: 'b', pem: B.pem }], url: URL_OK })
    check('a cache signed by a key that was since dropped stops counting', dropped.snapshot().source === 'shipped')
    rmSync(dir, { recursive: true, force: true })
  }

  section('what is never asked')
  {
    reset()
    const dir = tmp()
    publish(doc(5))
    const noKey = createGallery({ dir, shipped, keys: [], url: URL_OK })
    const a = await noKey.refresh()
    check('with no trusted key the online catalogue is not asked at all', a.online.state === 'refused' && a.online.reason === 'no-key' && serve.hits.length === 0, serve.hits)
    const off = await createGallery({ dir, shipped, keys: keysA, url: '' }).refresh()
    check('with the setting off, nothing is asked', off.online.state === 'off' && serve.hits.length === 0)
    const bad = await createGallery({ dir, shipped, keys: keysA, url: 'http://example.test/themes.catalog.json' }).refresh()
    check('a plain-http address that is not loopback is refused before any request', bad.online.state === 'offline' && bad.online.reason === 'url')
    check('...and a file: address', (await createGallery({ dir, shipped, keys: keysA, url: 'file:///etc/passwd' }).refresh()).online.reason === 'url')
    serve.redirect = 'http://evil.test/c.json'
    const redirected = fakeRedirect()
    check('a redirect to a URL that is not allowed is refused', (await createGallery({ dir, shipped, keys: keysA, url: URL_OK, fetchImpl: redirected }).refresh()).online.reason === 'url')
    const slow = createGallery({ dir, shipped, keys: keysA, url: URL_OK })
    publish(doc(5))
    const [r1, r2] = await Promise.all([slow.refresh(), slow.refresh()])
    check('two refreshes at once: the second does not start another one', r1.online.state === 'ok' && r2.online.state !== undefined && serve.hits.length === 2, serve.hits)
    rmSync(dir, { recursive: true, force: true })
  }

  section('download')
  {
    reset()
    publish(doc(1))
    const b = await download((...a) => fetch(...a), URL_OK, MAX_DOC_BYTES)
    check('a small document comes back whole', Buffer.isBuffer(b) && b.length > 100)
    let code = null
    try { await download((...a) => fetch(...a), URL_OK, 10) } catch (e) { code = e.code }
    check('over the cap: refused part way (too-large)', code === 'too-large', code)
    code = null
    try { await download((...a) => fetch(...a), 'http://example.test/x', 10) } catch (e) { code = e.code }
    check('a URL that is not allowed throws before fetching', code === 'url')
  }

  section('the route')
  {
    reset(); forgetGalleries()
    const home = tmp()
    const sent = []
    let net = 0
    const io = (over = {}) => ({
      home: async () => home,
      sameOriginStrict: (req) => req.origin === 'self',
      sameOriginLax: (req) => req.origin === undefined || req.origin === 'self',
      readJson: async (req) => req.body,
      send: (res, status, body) => { sent.push({ status, body }); return status },
      shipped: () => shipped, keys: () => keysA, fetchImpl: (...a) => { net += 1; return fetch(...a) },
      ...over,
    })
    const call = async (req, ioOver) => { sent.length = 0; await serveGallery(req, {}, io(ioOver)); return sent[0] }
    writeFileSync(join(home, 'settings.json'), '{}')
    // the folder the route uses is <home>/kybernos
    const { mkdirSync } = await import('node:fs')
    mkdirSync(join(home, 'kybernos'), { recursive: true })
    writeFileSync(join(home, 'kybernos', 'settings.json'), JSON.stringify({ themesCatalogueUrl: URL_OK }))
    const get = await call({ method: 'GET' })
    check('GET answers with the shipped catalogue and touches no network', get.status === 200 && get.body.source === 'shipped' && net === 0, get.body.source)
    check('GET from a foreign origin is refused; with no Origin it is allowed', (await call({ method: 'GET', origin: 'evil' })).status === 403 && (await call({ method: 'GET' })).status === 200)
    publish(doc(8, ['route-one']))
    check('POST refresh needs the strict same origin', (await call({ method: 'POST', body: { op: 'refresh' } })).status === 403 && net === 0)
    const post = await call({ method: 'POST', origin: 'self', body: { op: 'refresh' } })
    check('POST refresh asks, verifies, caches and answers with the signed catalogue', post.status === 200 && post.body.source === 'signed' && post.body.themes[0].id === 'route-one' && post.body.online.state === 'ok' && net === 2, post.body)
    check('GET then gives the cached one, still with no new request', (await call({ method: 'GET' })).body.source === 'signed' && net === 2)
    check('an unknown op is a 400', (await call({ method: 'POST', origin: 'self', body: { op: 'delete' } })).status === 400 && (await call({ method: 'POST', origin: 'self', body: null })).status === 400)
    check('an oversized body is a 413', (await call({ method: 'POST', origin: 'self' }, { readJson: async () => { throw new Error('too big') } })).status === 413)
    check('no DSH home is an ok:false answer', (await call({ method: 'GET' }, { home: async () => null })).body.ok === false)
    check('DELETE is a 405', (await call({ method: 'DELETE' })).status === 405)
    forgetGalleries()
    check('a host fault never escapes as an exception', (await call({ method: 'GET' }, { shipped: () => { throw new Error('boom') } })).status === 500)
    rmSync(home, { recursive: true, force: true })
  }
} finally {
  await new Promise((r) => { try { server.close(r) } catch (e) { r() } })
}

/** A fetch that answers as if a redirect had landed on plain http somewhere else. */
function fakeRedirect() {
  return async () => ({ ok: true, url: 'http://evil.test/c.json', body: { getReader: () => ({ read: async () => ({ done: true }) }) } })
}

console.log('\n' + (fail === 0 ? 'OK' : 'FAILED') + ' — themes gallery (' + (pass + fail) + ' checks)')
process.exit(fail === 0 ? 0 : 1)
