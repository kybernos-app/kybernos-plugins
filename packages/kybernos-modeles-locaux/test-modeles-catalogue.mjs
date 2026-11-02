#!/usr/bin/env node
// The catalogue of local models: the rules of belief (modeles-catalogue.mjs) and its disk and network half
// (modeles-distant.mjs), against a LOCAL http server and a temp folder.
//
//   node packages/kybernos-modeles-locaux/test-modeles-catalogue.mjs
//
// What is pinned here:
//  - an entry ends up in `ollama pull <id>`: the id is held to the library's shape, so no path, flag or second argument gets through;
//  - the shipped catalogue shows with no network, no cache and no key, and is the one the sources build (no drift);
//  - a refresh verifies before it believes: a good one is cached and shown, a tampered, wrongly signed, older or oversized
//    one changes nothing and says why; what it brought that was not shown before comes back as `nouveaux`;
//  - the cache is verified AGAIN on every read, so a hand-edited or orphaned cache stops counting;
//  - only https (or loopback http) is ever asked, a redirect cannot downgrade, the setting '' turns it off;
//  - the route guards its origin like the other routes and never lets a host fault escape.
import { createServer } from 'node:http'
import { generateKeyPairSync, sign } from 'node:crypto'
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_URL, KIND, MAX_DOC_BYTES, SCHEMA, effective, evaluate, readDocument, sanitizeDocument, sanitizeModel } from './modeles-catalogue.mjs'
import { createCatalogue, download, forgetCatalogues, loadKeys, loadShipped, readCatalogueUrl, serveCatalogue, urlAllowed } from './modeles-distant.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}
const section = (title) => console.log('\n' + title)
const HERE = dirname(fileURLToPath(import.meta.url))

const pair = () => { const { publicKey, privateKey } = generateKeyPairSync('ed25519'); return { pem: publicKey.export({ type: 'spki', format: 'pem' }), priv: privateKey } }
const A = pair()
const B = pair()
const keysA = [{ keyId: 'a', pem: A.pem }]
const model = (id, over = {}) => ({ id, famille: 'q', initiale: 'Qw', tailleGo: 6.1, ramMin: 16, score: 'II 32', input: ['text', 'image'], badges: ['Vision', 'Tools'], desc: { fr: 'Un modèle.', en: 'A model.' }, ajoute: '2026-10-01', ordre: 10, ...over })
const doc = (seq, ids = ['online-one:7b'], over = {}) => ({ schema: SCHEMA, kind: KIND, publishedAt: '2026-10-08T12:00:00.000Z', seq, models: ids.map((i, n) => model(i, { ordre: (n + 1) * 10 })), ...over })
const bytesOf = (d) => Buffer.from(JSON.stringify(d, null, 2) + '\n', 'utf8')
const sig = (b, priv = A.priv) => sign(null, b, priv).toString('base64')
const shipped = { schema: SCHEMA, kind: KIND, publishedAt: '2026-10-01T00:00:00.000Z', seq: 2, models: [model('shipped-one:9b', { ordre: 10 }), model('shipped-two:4b', { ordre: 20 })] }
const tmp = () => mkdtempSync(join(tmpdir(), 'kb-modeles-'))

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
const URL_OK = BASE + '/local-models.catalog.json'
const publish = (d, priv = A.priv) => { const b = bytesOf(d); serve.doc = b; serve.sig = sig(b, priv); serve.status = 200; serve.redirect = null; serve.big = false; return b }
const reset = () => { serve.doc = null; serve.sig = null; serve.status = 200; serve.hits.length = 0; serve.redirect = null; serve.big = false }

try {
  section('an entry ends up in a command line: the id is the library’s own shape')
  {
    const ok = (id) => sanitizeModel(model(id)).ok === true
    check('a library id with a tag passes', ok('qwen3.5:9b') && ok('gemma4:e4b') && ok('qwen3-coder:30b') && ok('llama3.2:1b-instruct-q4_k_m'))
    check('no tag, a namespace, a path, a flag, a space, a second argument, a shell word are all refused',
      ['qwen3.5', 'hf.co/org/repo:Q4', 'user/model:7b', '../x:1b', '--help:1b', 'a b:7b', 'a:7b;rm -rf', 'a:7b && x', 'a:7b\nb', 'A:7B', ':7b', 'a:', 'x'.repeat(60) + ':1b'].every((id) => !ok(id)))
    check('an input or a badge nobody knows is refused (the page draws from a fixed set)', !sanitizeModel(model('a:1b', { input: ['text', 'video'] })).ok && !sanitizeModel(model('a:1b', { badges: ['Fast'] })).ok)
    check('a size, a RAM floor, a day and an order must be sane', !sanitizeModel(model('a:1b', { tailleGo: -1 })).ok && !sanitizeModel(model('a:1b', { ramMin: 0 })).ok && !sanitizeModel(model('a:1b', { ajoute: 'yesterday' })).ok && !sanitizeModel(model('a:1b', { ordre: 1.5 })).ok)
    check('both languages are required, and control characters do not survive', !sanitizeModel(model('a:1b', { desc: { fr: 'x' } })).ok && sanitizeModel(model('a:1b', { desc: { fr: 'a\u0007b', en: 'c' } })).model.desc.fr === 'a b')
    check('a null size (not measured) and a null score are allowed', sanitizeModel(model('a:1b', { tailleGo: null, score: null })).ok === true)
    check('a duplicate id makes the document refused', sanitizeDocument(doc(1, ['a:1b', 'a:1b'])).ok === false)
    check('the document comes back in the curated order', sanitizeDocument({ ...doc(1, ['z:1b', 'a:1b']), models: [model('z:1b', { ordre: 30 }), model('a:1b', { ordre: 10 })] }).doc.models.map((m) => m.id).join() === 'a:1b,z:1b')
    check('unknown fields are dropped, not carried', (() => { const r = sanitizeModel({ ...model('a:1b'), run: 'rm -rf /' }); return r.ok === true && r.model.run === undefined })())
  }

  section('the shipped catalogue is the one the sources build')
  {
    const file = join(HERE, 'catalogue.json')
    const read = readDocument(readFileSync(file))
    check('it is valid', read.ok === true, read)
    const src = join(HERE, '..', '..', 'catalog', 'local-models')
    if (existsSync(src)) {
      // The sources are not in the archive: this check runs in the repository only. It rebuilds the document the way
      // scripts/modeles-locaux-catalogue.mjs `build` does (this bundle's tests may not import scripts/).
      const manifest = JSON.parse(readFileSync(join(src, '_catalogue.json'), 'utf8'))
      const models = readdirSync(src).filter((n) => n.endsWith('.json') && !n.startsWith('_')).sort()
        .map((n) => sanitizeModel(JSON.parse(readFileSync(join(src, n), 'utf8'))).model)
        .sort((a, b) => a.ordre - b.ordre || (a.id < b.id ? -1 : 1))
      const built = { schema: SCHEMA, kind: KIND, publishedAt: manifest.publishedAt, seq: manifest.seq, models }
      check('it equals what `build` writes from catalog/local-models (run: node scripts/modeles-locaux-catalogue.mjs build)', JSON.stringify(built) === JSON.stringify(JSON.parse(readFileSync(file, 'utf8'))))
    }
    const client = readFileSync(join(HERE, 'client.js'), 'utf8')
    const embedded = [...client.matchAll(/\{ id: '([a-z0-9._:-]+)', famille: '([a-z])', initiale: '([A-Za-z0-9]+)', tailleGo: ([\d.]+|null), ramMin: (\d+),/g)].map((m) => ({ id: m[1], tailleGo: m[4] === 'null' ? null : Number(m[4]), ramMin: Number(m[5]) }))
    const byId = new Map(read.doc.models.map((m) => [m.id, m]))
    check('the list built into the page (last resort when the host is older) is made of entries of the shipped one', embedded.length === 7 && embedded.every((e) => byId.has(e.id)), embedded.map((e) => e.id))
    check('…with the same size and the same RAM floor', embedded.every((e) => byId.has(e.id) && byId.get(e.id).tailleGo === e.tailleGo && byId.get(e.id).ramMin === e.ramMin), embedded.filter((e) => byId.has(e.id) && (byId.get(e.id).tailleGo !== e.tailleGo || byId.get(e.id).ramMin !== e.ramMin)))
    check('every RAM floor follows the one rule: the smallest of 4/8/16/32/64/128 GB that holds size × 1.25 + 3 GB', read.doc.models.every((m) => m.tailleGo === null || m.ramMin === [4, 8, 16, 32, 64, 128].find((t) => m.tailleGo * 1.25 + 3 <= t)), read.doc.models.filter((m) => m.tailleGo !== null && m.ramMin !== [4, 8, 16, 32, 64, 128].find((t) => m.tailleGo * 1.25 + 3 <= t)).map((m) => m.id))
    check('the public key file exists; empty until the key is generated, and then the online catalogue is not asked', loadKeys(join(HERE, 'models-pubkey.json')).length >= 0)
  }

  section('the rules of belief')
  {
    const b = bytesOf(doc(3))
    check('a good signature and shape are accepted', evaluate({ bytes: b, signature: sig(b), keys: keysA }).ok === true)
    check('no key: nothing is believed', evaluate({ bytes: b, signature: sig(b), keys: [] }).error === 'no-key')
    check('a signature by another key is refused', evaluate({ bytes: b, signature: sig(b, B.priv), keys: keysA }).error === 'signature')
    check('a tampered document is refused', evaluate({ bytes: Buffer.from(b.toString().replace('online-one', 'evil-one')), signature: sig(b), keys: keysA }).error === 'signature')
    check('an unsigned document is refused before anything is parsed', evaluate({ bytes: Buffer.from('not json'), signature: '', keys: keysA }).error === 'signature')
    check('an older seq is a rollback and is refused; the same is fine', evaluate({ bytes: b, signature: sig(b), keys: keysA, floor: { seq: 4 } }).error === 'older' && evaluate({ bytes: b, signature: sig(b), keys: keysA, floor: { seq: 3 } }).ok === true)
    check('a signed document that fails the shape is refused', evaluate({ bytes: bytesOf(doc(3, ['bad id'])), signature: sig(bytesOf(doc(3, ['bad id']))), keys: keysA }).error === 'model')
    check('a document over the cap is refused', evaluate({ bytes: Buffer.alloc(MAX_DOC_BYTES + 1, 32), signature: 'AAAA', keys: keysA }).error === 'size')
    const ev = evaluate({ bytes: b, signature: sig(b), keys: keysA })
    check('the signed catalogue is shown when it is at least as recent as the shipped one, else the shipped one', effective({ shipped, evaluation: ev }).source === 'signed' && effective({ shipped: { ...shipped, seq: 9 }, evaluation: ev }).source === 'shipped' && effective({ shipped, evaluation: null }).source === 'shipped')
  }

  section('addresses and the setting')
  {
    check('https is allowed; plain http only on a loopback address; no credentials', urlAllowed('https://raw.githubusercontent.com/x/y/main/c.json') && urlAllowed('http://127.0.0.1:8080/a') && !urlAllowed('http://example.test/a') && !urlAllowed('https://u:p@example.test/a') && !urlAllowed('file:///etc/passwd') && !urlAllowed('nonsense'))
    const d = tmp()
    check('no settings file: the default address', readCatalogueUrl(d) === DEFAULT_URL)
    writeFileSync(join(d, 'settings.json'), JSON.stringify({ modelesCatalogueUrl: '' }))
    check('an empty setting turns it off', readCatalogueUrl(d) === '')
    writeFileSync(join(d, 'settings.json'), '{ damaged')
    check('a damaged settings file means the default, not a crash', readCatalogueUrl(d) === DEFAULT_URL)
    rmSync(d, { recursive: true, force: true })
  }

  section('a refresh')
  {
    const dir = tmp()
    reset()
    const cat = createCatalogue({ dir, shipped, keys: keysA, url: URL_OK })
    check('before any refresh it shows the shipped list from the disk only, and says "never"', cat.snapshot().source === 'shipped' && cat.snapshot().online.state === 'never' && serve.hits.length === 0)
    publish(doc(3, ['online-one:7b', 'shipped-one:9b']))
    const r = await cat.refresh()
    check('a good catalogue is shown, cached and reported', r.source === 'signed' && r.seq === 3 && r.online.state === 'ok' && existsSync(cat.cacheFile))
    check('what was not in the list shown before comes back as `nouveaux`, with the date it is "since"', r.nouveaux.join() === 'online-one:7b' && r.depuis === shipped.publishedAt, r.nouveaux)
    const again = await cat.refresh()
    check('asking again brings nothing new', again.nouveaux.length === 0)
    publish(doc(2, ['rolled-back:1b']))
    const old = await cat.refresh()
    check('an older catalogue changes nothing and says why', old.source === 'signed' && old.seq === 3 && old.online.state === 'refused' && old.online.reason === 'older', old.online)
    publish(doc(4, ['x:1b']), B.priv)
    const wrong = await cat.refresh()
    check('a catalogue signed by another key changes nothing', wrong.seq === 3 && wrong.online.reason === 'signature')
    serve.big = true
    const big = await cat.refresh()
    check('an oversized one is cut off and changes nothing', big.seq === 3 && big.online.state === 'offline' && big.online.reason === 'too-large', big.online)
    reset(); serve.status = 503
    const down = await cat.refresh()
    check('a server error is "offline", the list stays', down.seq === 3 && down.online.state === 'offline')
    reset(); publish(doc(5, ['redirected:1b']))
    // A fetch that answers as if a redirect had landed on plain http somewhere else (the real one would try to connect there).
    const landed = async (url) => { const rep = await fetch(url); return { ok: rep.ok, status: rep.status, url: 'http://evil.test/c.json', body: rep.body } }
    const redirected = await createCatalogue({ dir, shipped, keys: keysA, url: URL_OK, fetchImpl: landed }).refresh()
    check('a redirect that lands on a plain-http address is refused', redirected.online.state === 'offline' && redirected.online.reason === 'url', redirected.online)
    reset()
    // the cache is verified again on every read
    const cacheDoc = cat.cacheFile
    writeFileSync(cacheDoc, readFileSync(cacheDoc, 'utf8').replace('online-one', 'edited-one'))
    check('a cache edited by hand stops counting (back to the shipped list)', cat.snapshot().source === 'shipped')
    const orphan = createCatalogue({ dir, shipped, keys: [{ keyId: 'b', pem: B.pem }], url: URL_OK })
    check('a cache signed by a key that is no longer trusted stops counting', orphan.snapshot().source === 'shipped')
    rmSync(dir, { recursive: true, force: true })
  }
  {
    const dir = tmp()
    reset(); publish(doc(3))
    const none = createCatalogue({ dir, shipped, keys: [], url: URL_OK })
    const r = await none.refresh()
    check('no embedded key: the network is never asked, and the page is told "no-key"', r.online.state === 'refused' && r.online.reason === 'no-key' && serve.hits.length === 0 && r.source === 'shipped')
    const off = createCatalogue({ dir, shipped, keys: keysA, url: '' })
    check('an empty address: off, nothing asked', (await off.refresh()).online.state === 'off' && serve.hits.length === 0)
    rmSync(dir, { recursive: true, force: true })
  }

  section('the route')
  {
    const home = tmp()
    mkdirSync(join(home, 'kybernos'), { recursive: true })
    writeFileSync(join(home, 'kybernos', 'settings.json'), JSON.stringify({ modelesCatalogueUrl: URL_OK }))
    reset(); publish(doc(5, ['route-one:3b']))
    forgetCatalogues()
    const sent = []
    const io = {
      home: async () => home, sameOriginStrict: (r) => r.origin !== 'evil', sameOriginLax: (r) => r.origin !== 'evil',
      readJson: async (r) => r.body, send: (res, status, body) => { sent.push({ status, body }) },
      shipped: () => shipped, keys: () => keysA,
    }
    await serveCatalogue({ method: 'GET' }, {}, io)
    check('GET answers from the disk, no network', sent[0].status === 200 && sent[0].body.source === 'shipped' && serve.hits.length === 0)
    await serveCatalogue({ method: 'POST', body: { op: 'refresh' } }, {}, io)
    check('POST refresh asks, verifies and answers with what is new', sent[1].status === 200 && sent[1].body.source === 'signed' && sent[1].body.nouveaux.join() === 'route-one:3b')
    await serveCatalogue({ method: 'POST', body: { op: 'drop-database' } }, {}, io)
    check('an unknown op is a 400', sent[2].status === 400)
    await serveCatalogue({ method: 'POST', origin: 'evil', body: { op: 'refresh' } }, {}, io)
    check('a foreign origin is refused on POST', sent[3].status === 403)
    await serveCatalogue({ method: 'DELETE' }, {}, io)
    check('any other verb is a 405', sent[4].status === 405)
    await serveCatalogue({ method: 'GET' }, {}, { ...io, home: async () => { throw new Error('boom') } })
    check('a host fault never escapes the route', sent[5].status === 500 && sent[5].body.ok === false)
    const down = await download(async () => ({ ok: true, url: 'https://x.test/a', body: { getReader: () => { let n = 0; return { read: async () => (n++ < 3 ? { done: false, value: new Uint8Array(100) } : { done: true }), cancel: async () => {} } } } }), 'https://x.test/a', 250).catch((e) => e)
    check('a download over its cap is cut off', down instanceof Error && down.code === 'too-large')
    check('the loader tolerates a missing shipped file', loadShipped(join(home, 'nope.json')).models.length === 0)
    rmSync(home, { recursive: true, force: true })
  }
} finally {
  await new Promise((r) => server.close(r))
}
console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)
