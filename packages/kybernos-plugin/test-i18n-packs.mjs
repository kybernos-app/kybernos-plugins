#!/usr/bin/env node
// Ready-made language packs (i18n-packs.mjs): the rules of belief, what installing does to a language, the disk and network
// half against a LOCAL http server and a temp folder, and the route.
//
//   node packages/kybernos-plugin/test-i18n-packs.mjs
import { createServer } from 'node:http'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createI18nStore } from './i18n-store.mjs'
import {
  DEFAULT_BASE, INDEX_FILE, KIND_INDEX, KIND_PACK, MAX_INDEX_BYTES, SCHEMA, applyPack, createPacks, download, evaluateIndex, evaluatePack,
  forgetPacks, readBase, sanitizeIndex, sanitizePack, servePacks, urlAllowed,
} from './i18n-packs.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}
const section = (t) => console.log('\n' + t)
const tmp = () => mkdtempSync(join(tmpdir(), 'kb-packs-'))
const sha = (b) => createHash('sha256').update(b).digest('hex')
const pair = () => { const { publicKey, privateKey } = generateKeyPairSync('ed25519'); return { pem: publicKey.export({ type: 'spki', format: 'pem' }), priv: privateKey } }
const A = pair()
const B = pair()
const keysA = [{ keyId: 'a', pem: A.pem }]
const sig = (b, priv = A.priv) => sign(null, b, priv).toString('base64')
const bytesOf = (d) => Buffer.from(JSON.stringify(d, null, 2) + '\n', 'utf8')

const packDoc = (lang, seq, over = {}) => ({ schema: SCHEMA, kind: KIND_PACK, lang, seq, label: 'Español', kb: { 'a.title': 'Título', 'a.body': 'Cuerpo' }, dsh: { 'common::cancel': 'Cancelar' }, src: { 'kb:a.title': 'aaaaaaaa', 'kb:a.body': 'bbbbbbbb', 'dsh:common::cancel': 'cccccccc' }, ...over })
const entryOf = (doc, over = {}) => { const b = bytesOf(doc); return { lang: doc.lang, label: doc.label, file: doc.lang + '.pack.json', sha256: sha(b), size: b.length, seq: doc.seq, counts: { kb: Object.keys(doc.kb).length, dsh: Object.keys(doc.dsh).length }, reviewed: true, ...over } }
const indexDoc = (seq, entries) => ({ schema: SCHEMA, kind: KIND_INDEX, publishedAt: '2026-10-16T09:00:00.000Z', seq, packs: entries })

// A local "catalogue server": what it serves, by file name.
const files = new Map()
const hits = []
const server = createServer((req, res) => {
  const name = decodeURIComponent(req.url.split('/').pop())
  hits.push(name)
  const body = files.get(name)
  if (body === undefined) { res.writeHead(404); res.end(); return }
  if (body.status !== undefined) { res.writeHead(body.status); res.end('no'); return }
  res.writeHead(200, { 'content-type': 'application/octet-stream' }); res.end(body)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const BASE = 'http://127.0.0.1:' + server.address().port + '/'
const publish = (seq, docs, priv = A.priv) => {
  files.clear(); hits.length = 0
  const entries = docs.map((d) => { files.set(d.lang + '.pack.json', bytesOf(d)); return entryOf(d) })
  const idx = bytesOf(indexDoc(seq, entries))
  files.set(INDEX_FILE, idx)
  files.set(INDEX_FILE + '.sig', Buffer.from(sig(idx, priv)))
  return { idx, entries }
}

try {
  section('the shape of an index and of a pack')
  {
    const e = entryOf(packDoc('es', 1))
    check('a good index passes and comes back clean', sanitizeIndex(indexDoc(1, [e])).ok === true && sanitizeIndex(indexDoc(1, [e])).doc.packs[0].lang === 'es')
    check('a reserved language, a repeated language, a file that is not its own name are refused', sanitizeIndex(indexDoc(1, [{ ...e, lang: 'en', file: 'en.pack.json' }])).ok === false && sanitizeIndex(indexDoc(1, [e, e])).ok === false && sanitizeIndex(indexDoc(1, [{ ...e, file: '../es.pack.json' }])).ok === false && sanitizeIndex(indexDoc(1, [{ ...e, file: 'fr.pack.json' }])).ok === false)
    check('a hash that is not a hash, a size out of bounds are refused', sanitizeIndex(indexDoc(1, [{ ...e, sha256: 'xyz' }])).ok === false && sanitizeIndex(indexDoc(1, [{ ...e, size: 99999999 }])).ok === false)
    check('a wrong kind, schema or seq is refused', sanitizeIndex({ ...indexDoc(1, [e]), kind: 'other' }).ok === false && sanitizeIndex({ ...indexDoc(1, [e]), schema: 2 }).ok === false && sanitizeIndex({ ...indexDoc(1, [e]), seq: -1 }).ok === false)
    check('a pack: kb and dsh texts and the source hashes it carries', (() => { const v = sanitizePack(packDoc('es', 1), { lang: 'es', seq: 1 }); return v.ok === true && v.pack.kb['a.title'] === 'Título' && v.pack.src['kb:a.title'] === 'aaaaaaaa' })())
    check('a pack for another language or another seq than the index says is refused', sanitizePack(packDoc('de', 1), { lang: 'es', seq: 1 }).ok === false && sanitizePack(packDoc('es', 2), { lang: 'es', seq: 1 }).ok === false)
    check('a prototype name as a key, a non-string, an empty text, an empty pack are refused', sanitizePack(packDoc('es', 1, { kb: { __proto__x: 'a', constructor: 'b' } })).ok === false && sanitizePack(packDoc('es', 1, { kb: { a: 5 } })).ok === false && sanitizePack(packDoc('es', 1, { kb: { a: '' } })).ok === false && sanitizePack(packDoc('es', 1, { kb: {}, dsh: {} })).ok === false)
    check('a bad source hash is dropped, not trusted', sanitizePack(packDoc('es', 1, { src: { 'kb:a.title': 'ZZ', 'kb:a.body': 'bbbbbbbb' } })).pack.src['kb:a.title'] === undefined)
  }

  section('the rules of belief')
  {
    const { idx } = publish(3, [packDoc('es', 3)])
    check('a good signature and shape are accepted', evaluateIndex({ bytes: idx, signature: sig(idx), keys: keysA }).ok === true)
    check('no key: nothing is believed', evaluateIndex({ bytes: idx, signature: sig(idx), keys: [] }).error === 'no-key')
    check('another key, a tampered index, a missing signature are refused', evaluateIndex({ bytes: idx, signature: sig(idx, B.priv), keys: keysA }).error === 'signature' && evaluateIndex({ bytes: Buffer.from(idx.toString().replace('"seq": 3', '"seq": 9')), signature: sig(idx), keys: keysA }).error === 'signature' && evaluateIndex({ bytes: idx, signature: '', keys: keysA }).error === 'signature')
    check('an older seq is a rollback; the same is fine', evaluateIndex({ bytes: idx, signature: sig(idx), keys: keysA, floor: { seq: 4 } }).error === 'older' && evaluateIndex({ bytes: idx, signature: sig(idx), keys: keysA, floor: { seq: 3 } }).ok === true)
    check('an index over its cap is refused', evaluateIndex({ bytes: Buffer.alloc(MAX_INDEX_BYTES + 1, 32), signature: 'AAAA', keys: keysA }).error === 'size')
    const d = packDoc('es', 3); const b = bytesOf(d); const e = entryOf(d)
    check('a pack matches its entry by size and hash', evaluatePack({ bytes: b, entry: e }).ok === true)
    check('one byte changed: refused before it is parsed', evaluatePack({ bytes: Buffer.from(b.toString().replace('Título', 'Titulo')), entry: { ...e, size: Buffer.byteLength(b.toString().replace('Título', 'Titulo')) } }).error === 'hash')
    check('a pack of another size than the index says is refused', evaluatePack({ bytes: b, entry: { ...e, size: e.size + 1 } }).error === 'size')
  }

  section('what installing does to a language')
  {
    const dir = tmp()
    const store = createI18nStore({ dir })
    store.write('es', { kb: { 'a.title': 'Mi título', 'a.body': '⟦Cuerpo⟧' }, label: '' })
    const pack = sanitizePack(packDoc('es', 3), { lang: 'es', seq: 3 }).pack
    const r = applyPack(store, pack, () => 5000)
    const got = store.read('es')
    check('a text that is there stands; a test mark and what is missing are filled', r.ok === true && r.added === 2 && r.kept === 1 && r.total === 3 && got.kb['a.title'] === 'Mi título' && got.kb['a.body'] === 'Cuerpo' && got.dsh['common::cancel'] === 'Cancelar', got)
    check('the source hash of each text written is kept (only those)', got.src['kb:a.body'] === 'bbbbbbbb' && got.src['dsh:common::cancel'] === 'cccccccc' && got.src['kb:a.title'] === undefined, got.src)
    check('the language gets its name when it had none, and the bilan is stamped so a browser takes the host\'s copy', got.label === 'Español' && got.meta.at === 5000 && got.meta.fromPack === 3)
    const again = applyPack(store, pack, () => 6000)
    check('installing again changes nothing', again.ok === true && again.added === 0 && again.kept === 3 && store.read('es').meta.at === 5000)
    rmSync(dir, { recursive: true, force: true })
    const fresh = createI18nStore({ dir: tmp() })
    check('a language that did not exist is created whole', applyPack(fresh, pack, () => 1).added === 3 && fresh.read('es').kb['a.title'] === 'Título')
  }

  section('addresses and the setting')
  {
    check('https and loopback http only, no credentials', urlAllowed('https://raw.githubusercontent.com/x/main/catalog/languages/') && urlAllowed('http://127.0.0.1:1/') && !urlAllowed('http://example.test/') && !urlAllowed('https://u:p@x.test/') && !urlAllowed('file:///etc/passwd'))
    const d = tmp()
    check('no settings: the default folder', readBase(d) === DEFAULT_BASE)
    writeFileSync(join(d, 'settings.json'), JSON.stringify({ languagePacksUrl: 'https://x.test/langs' }))
    check('a folder given without its slash gets one', readBase(d) === 'https://x.test/langs/')
    writeFileSync(join(d, 'settings.json'), JSON.stringify({ languagePacksUrl: '' }))
    check('an empty setting turns it off', readBase(d) === '')
    writeFileSync(join(d, 'settings.json'), '{ damaged')
    check('a damaged settings file is the default, not a crash', readBase(d) === DEFAULT_BASE)
    rmSync(d, { recursive: true, force: true })
  }

  section('refresh and install against a server')
  {
    const dir = tmp()
    const store = createI18nStore({ dir: join(dir, 'i18n') })
    publish(3, [packDoc('es', 3), packDoc('de', 3, { label: 'Deutsch', kb: { 'a.title': 'Titel' }, dsh: {}, src: {} })])
    const set = createPacks({ dir, store, keys: keysA, base: BASE })
    check('before any refresh: nothing listed, nothing asked', set.snapshot().packs.length === 0 && set.snapshot().online.state === 'never' && hits.length === 0)
    const r = await set.refresh()
    check('a refresh lists the packs of the verified index', r.online.state === 'ok' && r.packs.map((p) => p.lang).join() === 'de,es' && r.seq === 3)
    check('…with their counts and whether the language is installed', r.packs.find((p) => p.lang === 'es').counts.kb === 2 && r.packs.every((p) => p.installed === false))
    const i = await set.install('es')
    check('install fills the language from its pack', i.ok === true && i.added === 3 && store.read('es').kb['a.title'] === 'Título')
    check('…and the listing now says it is installed', set.snapshot().packs.find((p) => p.lang === 'es').installed === true)
    check('a language that is not in the index is « no-pack »', (await set.install('fr')).error === 'no-pack')
    check('a language id that is not one never reaches the network', (await set.install('../x')).ok === false && (await set.install('en')).ok === false)
    // a pack that does not match the signed index
    const same = bytesOf(packDoc('de', 3, { label: 'Deutsch', kb: { 'a.title': 'Titel' }, dsh: {}, src: {} })).toString().replace('Titel', 'Titek')
    files.set('de.pack.json', Buffer.from(same))
    check('a pack of the right size that is not what the signed index says is refused, and nothing is written', (await set.install('de')).error === 'hash' && store.read('de') === null)
    files.set('de.pack.json', Buffer.from(same + ' '))
    check('…and so is one of another size', (await set.install('de')).error === 'size' && store.read('de') === null)
    // rollback and tampering
    publish(2, [packDoc('es', 2)])
    const old = await set.refresh()
    check('an older index changes nothing and says why', old.seq === 3 && old.online.state === 'refused' && old.online.reason === 'older', old.online)
    publish(5, [packDoc('es', 5)], B.priv)
    const wrong = await set.refresh()
    check('an index signed by another key changes nothing', wrong.seq === 3 && wrong.online.reason === 'signature')
    files.clear()
    const down = await set.refresh()
    check('a server with nothing is « offline », the cached list stays', down.online.state === 'offline' && down.packs.length === 2)
    writeFileSync(join(dir, 'language-packs', INDEX_FILE), readFileSync(join(dir, 'language-packs', INDEX_FILE), 'utf8').replace('"seq": 3', '"seq": 4'))
    check('a cache edited by hand stops counting', set.snapshot().packs.length === 0)
    rmSync(dir, { recursive: true, force: true })
  }
  {
    const dir = tmp()
    const store = createI18nStore({ dir: join(dir, 'i18n') })
    publish(3, [packDoc('es', 3)])
    const none = createPacks({ dir, store, keys: [], base: BASE })
    const r = await none.refresh()
    check('no embedded key: the network is never asked and the page is told « no-key »', r.online.state === 'refused' && r.online.reason === 'no-key' && hits.length === 0)
    check('install without an index says so', (await none.install('es')).error === 'no-index')
    const off = createPacks({ dir, store, keys: keysA, base: '' })
    check('off: nothing asked', (await off.refresh()).online.state === 'off' && (await off.install('es')).error === 'off' && hits.length === 0)
    const redirected = createPacks({ dir, store, keys: keysA, base: BASE, fetchImpl: async (url) => { const rep = await fetch(url); return { ok: rep.ok, status: rep.status, url: 'http://evil.test/x', body: rep.body } } })
    check('a redirect that lands on a plain-http address is refused', (await redirected.refresh()).online.reason === 'url')
    const cap = await download(async () => ({ ok: true, url: 'https://x.test/a', body: { getReader: () => { let n = 0; return { read: async () => (n++ < 3 ? { done: false, value: new Uint8Array(100) } : { done: true }), cancel: async () => {} } } } }), 'https://x.test/a', 250).catch((e) => e)
    check('a download over its cap is cut off', cap instanceof Error && cap.code === 'too-large')
    rmSync(dir, { recursive: true, force: true })
  }

  section('the route')
  {
    const home = tmp()
    mkdirSync(join(home, 'kybernos'), { recursive: true })
    writeFileSync(join(home, 'kybernos', 'settings.json'), JSON.stringify({ languagePacksUrl: BASE }))
    publish(7, [packDoc('es', 7)])
    forgetPacks()
    const sent = []
    const io = {
      home: async () => home, store: (d) => createI18nStore({ dir: join(d, 'i18n') }), keys: () => keysA,
      sameOriginStrict: (r) => r.origin !== 'evil', sameOriginLax: (r) => r.origin !== 'evil',
      readJson: async (r) => r.body, send: (res, status, body) => { sent.push({ status, body }) },
    }
    await servePacks({ method: 'GET' }, {}, io)
    check('GET answers from the disk: no packs, nothing asked', sent[0].status === 200 && sent[0].body.packs.length === 0 && hits.length === 0)
    await servePacks({ method: 'POST', body: { op: 'install', lang: 'es' } }, {}, io)
    check('install with no index yet asks for it once, then installs', sent[1].status === 200 && sent[1].body.ok === true && sent[1].body.added === 3 && hits.includes(INDEX_FILE), sent[1].body)
    await servePacks({ method: 'GET' }, {}, io)
    check('the listing then says it is installed', sent[2].body.packs[0].installed === true && sent[2].body.seq === 7)
    await servePacks({ method: 'POST', origin: 'evil', body: { op: 'refresh' } }, {}, io)
    await servePacks({ method: 'POST', body: { op: 'rm' } }, {}, io)
    await servePacks({ method: 'POST', body: { op: 'install', lang: '../etc' } }, {}, io)
    await servePacks({ method: 'DELETE' }, {}, io)
    await servePacks({ method: 'GET' }, {}, { ...io, home: async () => { throw new Error('boom') } })
    check('a foreign origin 403, an unknown op 400, a bad language 400, another verb 405, a host fault 500', sent[3].status === 403 && sent[4].status === 400 && sent[5].status === 400 && sent[6].status === 405 && sent[7].status === 500 && sent[7].body.ok === false, sent.slice(3).map((s) => s.status))
    rmSync(home, { recursive: true, force: true })
  }
} finally {
  await new Promise((r) => server.close(r))
}
console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)
