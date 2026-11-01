#!/usr/bin/env node
/** The templates shelf, host half (templates-shelf.mjs): the catalogue shipped as text, the check of everything the server sends, the disk copy,
 *  the pictures kept on first ask, and the rule that a silent server changes nothing. No real network: the server is a function.
 *
 *  Usage: node packages/kybernos-plugin/test-templates-shelf.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SHELF_SCHEMA, createShelf, shelfBundled, shelfImageName, shelfValidate } from './templates-shelf.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))
const J = (v) => JSON.parse(JSON.stringify(v))
const webp = (n = 40) => Buffer.concat([Buffer.from('RIFF'), Buffer.from([n, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(n)])
const tmp = mkdtempSync(join(tmpdir(), 'kb-shelf-'))
process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }) } catch (e) { /* gone */ } })

// 1. the text shipped with the plugin: the floor of the page
{
  const raw = JSON.parse(readFileSync(join(here, 'templates-fallback.json'), 'utf8'))
  const b = shelfBundled()
  assert.ok(b !== null, 'the shipped catalogue is valid')
  assert.equal(b.schema, SHELF_SCHEMA)
  assert.equal(b.types.length, 16, 'the 16 types of the shelf')
  assert.equal(b.templates.length, raw.templates.length, 'no entry is dropped by the check (a drop would be a typo in the file)')
  assert.equal(b.templates.length, 144)
  for (const t of b.types) assert.equal(b.templates.filter((x) => x.type === t.id).length, 9, t.id + ' has nine examples')
  assert.equal(new Set(b.templates.map((t) => t.id)).size, b.templates.length, 'ids are unique')
  for (const t of b.templates) {
    assert.ok(t.image !== undefined && shelfImageName(t.image.src) === t.image.src, t.id + ' names a card picture')
    assert.ok(t.image.src === t.id + '.webp' && (t.image.large === undefined || t.image.large === 'large/' + t.id + '.webp'), t.id + ': pictures are named after the template')
  }
  // video and 3D keep their first pictures, which have no larger twin: the dialog shows the card picture
  assert.deepEqual([...new Set(b.templates.filter((t) => t.image.large === undefined).map((t) => t.type))].sort(), ['model3d', 'video'])
  // no picture, no personal path, no line separator in git (AGENTS rules 4 and 7)
  const file = readFileSync(join(here, 'templates-fallback.json'), 'utf8')
  assert.ok(!/\/Users\/|[\u2028\u2029]|data:image/.test(file), 'text only')
  // an App template that ships a kit names the folder of that kit; the folder exists
  const kits = b.templates.filter((t) => t.kit !== undefined)
  assert.deepEqual(kits.map((t) => t.kit).sort(), ['ecommerce', 'real-estate', 'recruitment'])
  for (const t of kits) assert.ok(existsSync(join(here, 'themes', t.kit, 'plugin.json')), t.id + ' → themes/' + t.kit + ' exists')
  // the two kinds of App entry: a template (a kit, sample rows) and a simple start
  assert.deepEqual(J(b.templates.filter((t) => t.type === 'app').map((t) => t.kind).sort()), ['start', 'start', 'start', 'template', 'template', 'template', 'template', 'template', 'template'])
  ok('the shipped catalogue is valid text: 16 types, 144 examples, 9 each, kits that exist, no picture in git')
}

// 2. everything the server sends is checked again
{
  const good = JSON.parse(readFileSync(join(here, 'templates-fallback.json'), 'utf8'))
  const mini = (extra) => Object.assign({ schema: SHELF_SCHEMA, version: 3, types: [{ id: 'doc', name: 'Document', group: 'Documents', blurb: 'b' }], templates: [{ id: 'doc_a', type: 'doc', name: 'A', tag: 't', line: 'l', meta: 'm', prompt: 'Write a document' }] }, extra)
  assert.equal(shelfValidate(null), null)
  assert.equal(shelfValidate({}), null)
  assert.equal(shelfValidate(mini({ schema: 'other/1' })), null, 'another schema is refused')
  assert.equal(shelfValidate(mini({ version: 0 })), null)
  assert.equal(shelfValidate(mini({ version: '2' })), null)
  assert.equal(shelfValidate(mini({ types: [] })), null)
  assert.equal(shelfValidate(mini({ templates: [] })), null)
  assert.equal(shelfValidate(mini({ types: [{ id: 'doc', name: 'x' }, { id: 'doc', name: 'y' }] })), null, 'a type twice')
  assert.equal(shelfValidate(mini({ types: [{ id: '../x', name: 'x' }] })), null, 'a type id that is not an id')
  // one bad entry costs only itself
  const mixed = shelfValidate(mini({ templates: [
    { id: 'doc_a', type: 'doc', name: 'A', prompt: 'p' },
    { id: 'doc_a', type: 'doc', name: 'again', prompt: 'p' },        // twice
    { id: 'Doc B', type: 'doc', name: 'B', prompt: 'p' },           // not an id
    { id: 'doc_c', type: 'nope', name: 'C', prompt: 'p' },          // an unknown type
    { id: 'doc_d', type: 'doc', name: '', prompt: 'p' },            // no name
    { id: 'doc_e', type: 'doc', name: 'E', prompt: '' },            // no request
    { id: 'doc_f', type: 'doc', name: 'F', prompt: 'p', kit: '../x' }, // a kit that is a path
    { id: 'doc_g', type: 'doc', name: 'G', prompt: 'p', kind: 'evil' },
    { id: 'doc_h', type: 'doc', name: 'H', prompt: 'p' },
  ] }))
  assert.deepEqual(J(mixed.templates.map((t) => t.id)), ['doc_a', 'doc_h'])
  // text is clipped and cleaned; unknown keys are not passed on
  const dirty = shelfValidate(mini({ templates: [{ id: 'doc_a', type: 'doc', name: 'N'.repeat(500), tag: 'a\u2028b\u0000c', line: 'l', meta: 'm', prompt: 'p', onclick: 'x()', html: '<img>' }], extraKey: 1 }))
  assert.equal(dirty.templates[0].name.length, 80)
  assert.equal(dirty.templates[0].tag, 'a b c')
  assert.equal(dirty.templates[0].onclick, undefined)
  assert.equal(dirty.extraKey, undefined)
  assert.equal(dirty.imageBase, 'shelf/', 'the picture folder is ours, not the server\'s')
  // picture names: only <id>.webp and large/<id>.webp
  for (const bad of ['../a.webp', 'large/../a.webp', 'a.png', 'a.webp/', '/a.webp', 'a b.webp', 'large/large/a.webp', '', null, 3, 'A.webp', '.webp', 'a.svg']) assert.equal(shelfImageName(bad), '', String(bad))
  for (const fine of ['a.webp', 'large/a.webp', 'app_ecommerce.webp', 'large/audio_lofi.webp']) assert.equal(shelfImageName(fine), fine)
  // a table link that points outside the tables is dropped, not kept
  const app = shelfValidate(mini({ templates: [{ id: 'app_a', type: 'doc', name: 'A', prompt: 'p', tables: ['One', 'Two'], links: [[0, 1], [0, 5], [-1, 0], 'x'], layout: [[0], [1]] }] })).templates[0]
  assert.deepEqual(J(app.links), [[0, 1]])
  assert.deepEqual(J(app.layout), [[0], [1]])
  // how an example was made: the model's id and the knobs are kept, anything that is not a plain id or a sensible number is dropped (the example stays)
  const made = (m) => shelfValidate(mini({ templates: [{ id: 'image_a', type: 'doc', name: 'A', prompt: 'p', made: m }] })).templates[0].made
  assert.deepEqual(J(made({ model: 'black-forest-labs/FLUX-2-dev', label: 'FLUX.2 dev', seed: 421, width: 1280, height: 800, steps: 28, extra: 1 })), { model: 'black-forest-labs/FLUX-2-dev', label: 'FLUX.2 dev', seed: 421, width: 1280, height: 800, steps: 28 })
  assert.deepEqual(J(made({ model: 'a/b', seed: -1, width: 1280, steps: 0 })), { model: 'a/b' }, 'a seed, a size or steps out of range are left out; a width with no height is no size')
  for (const bad of [{ model: '../x' }, { model: 'a b' }, { model: '' }, { model: 'x'.repeat(81) }, { model: 3 }, { label: 'no model' }, 'x', null, [1]]) assert.equal(made(bad), undefined, JSON.stringify(bad))
  assert.ok(shelfValidate(good) !== null)
  ok('what a server sends is checked: schema, ids, picture names, links; a bad entry costs only itself; text clipped')
}

// 3. no folder, no server: the page still has its catalogue
{
  const s = createShelf({ dir: () => null, api: () => '', fetchFn: () => { throw new Error('no network expected') } })
  const c = await s.catalogue()
  assert.equal(c.source, 'bundled')
  assert.equal(c.templates.length, 144)
  assert.ok(c.templates.every((t) => t.image.ready === false), 'no picture is claimed that is not there')
  assert.equal(await s.image('doc_a.webp'), null, 'no server, no folder: no picture')
  assert.equal(await s.image('../../etc/passwd'), null)
  assert.deepEqual(J(await s.load({ force: true })), { ok: false, error: 'no_server' })
  ok('with no folder and no server the page gets the shipped text and no picture')
}

// 4. a server: the catalogue and its pictures are kept; a silent or wrong server changes nothing
{
  const dir = join(tmp, 'home')
  const base = JSON.parse(readFileSync(join(here, 'templates-fallback.json'), 'utf8'))
  const docs = base.templates.filter((t) => t.type === 'doc')
  const A = docs[0].id
  const B = docs[1].id
  const server = { calls: [], catalogue: Object.assign({}, base, { version: 7 }), status: 200, pics: 'ok', slow: 0 }
  const fetchFn = async (url, opts) => {
    server.calls.push(String(url))
    assert.equal(opts.redirect, 'manual', 'redirects are not followed')
    assert.ok(opts.signal !== undefined, 'every call has a timeout')
    const u = new URL(url)
    assert.equal(u.search, '', 'nothing is sent in the query')
    assert.equal(opts.headers.authorization, undefined, 'no token')
    const reply = (status, body, type) => ({ status, headers: { get: (k) => (k.toLowerCase() === 'content-length' && body !== null ? String(body.length) : null) }, arrayBuffer: async () => (body === null ? new ArrayBuffer(0) : body.buffer.slice(body.byteOffset, body.byteOffset + body.length)) })
    if (server.status !== 200) return reply(server.status, null)
    if (u.pathname === '/v1/templates/catalogue.json') return reply(200, Buffer.from(JSON.stringify(server.catalogue)))
    if (u.pathname.startsWith('/v1/templates/shelf/')) {
      if (server.pics === 'missing') return reply(404, null)
      if (server.pics === 'html') return reply(200, Buffer.from('<html>not a picture</html>'))
      if (server.pics === 'huge') return reply(200, Buffer.alloc(2 * 1024 * 1024, 1))
      return reply(200, webp(60))
    }
    return reply(404, null)
  }
  let clock = 1_000_000_000_000
  const s = createShelf({ dir: () => dir, api: () => 'https://server.example.test/', fetchFn, now: () => clock, pace: { batch: 5, everyMs: 0 } })
  // before any load: shipped text
  assert.equal((await s.catalogue()).source, 'bundled')
  assert.equal(await s.due(), true, 'nothing kept: a load is due')
  const r = await s.load()
  assert.equal(r.ok, true)
  assert.equal(r.version, 7)
  assert.equal(r.images, 144, 'every card picture was asked once')
  assert.ok(server.calls[0] === 'https://server.example.test/v1/templates/catalogue.json', server.calls[0])
  assert.ok(server.calls.some((u) => u === 'https://server.example.test/v1/templates/shelf/app_ecommerce.webp'))
  assert.ok(!server.calls.some((u) => u.includes('/large/')), 'dialog pictures wait for a person to open one')
  const c = await s.catalogue()
  assert.equal(c.source, 'server')
  assert.equal(c.version, 7)
  assert.ok(c.templates.every((t) => t.image.ready === true && (t.image.large === undefined ? t.image.readyLarge === undefined : t.image.readyLarge === false)))
  assert.equal(readdirSync(join(dir, 'shelf')).filter((f) => f.endsWith('.webp')).length, 144)
  assert.ok(existsSync(join(dir, 'catalogue.json')))
  assert.equal(await s.due(), false, 'a copy under a day old is enough')
  const before = server.calls.length
  assert.deepEqual(J(await s.load()), { ok: true, skipped: true })
  assert.equal(server.calls.length, before, 'nothing is asked when the copy is fresh')
  // a picture on disk is served without the server
  assert.ok((await s.image(A + '.webp')).length > 12)
  assert.equal(server.calls.length, before)
  // the dialog picture comes on first ask, once, even asked together
  const [x, y] = await Promise.all([s.image('large/' + A + '.webp'), s.image('large/' + A + '.webp')])
  assert.ok(x.length > 12 && y.length > 12)
  assert.equal(server.calls.filter((u) => u.endsWith('/shelf/large/' + A + '.webp')).length, 1, 'one request for two asks')
  assert.equal((await s.catalogue()).templates.find((t) => t.id === A).image.readyLarge, true)
  // a restart reads the folder again
  const s2 = createShelf({ dir: () => dir, api: () => '', fetchFn: () => { throw new Error('offline') }, now: () => clock })
  const c2 = await s2.catalogue()
  assert.equal(c2.source, 'server')
  assert.equal(c2.version, 7)
  assert.ok(c2.templates.find((t) => t.id === A).image.ready)
  ok('the catalogue and the card pictures are loaded once, kept on disk, served offline after a restart; dialog pictures come on first ask')

  // a day later the copy is due; a server that answers 404 (nothing published) or garbage leaves the copy as it is
  clock += 25 * 3600 * 1000
  const old = new Date(clock - 25 * 3600 * 1000)
  utimesSync(join(dir, 'catalogue.json'), old, old)
  const s3 = createShelf({ dir: () => dir, api: () => 'https://server.example.test', fetchFn, now: () => clock, pace: { batch: 5, everyMs: 0 } })
  assert.equal(await s3.due(), true)
  server.status = 404
  assert.deepEqual(J(await s3.load()), { ok: false, error: 'not_published' })
  assert.equal((await s3.catalogue()).version, 7, 'the older copy stays')
  assert.equal(await s3.due(), false, 'a server with nothing published is not asked again at every check')
  clock += 7 * 3600 * 1000
  assert.equal(await s3.due(), true, 'but it is asked again a few hours later')
  server.status = 200
  server.catalogue = { schema: 'nope' }
  assert.deepEqual(J(await s3.load({ force: true })), { ok: false, error: 'unreadable' })
  assert.equal((await s3.catalogue()).version, 7, 'a catalogue that does not check is not kept')
  server.catalogue = Object.assign({}, base, { version: 8 })
  const up = await s3.load({ force: true })
  assert.equal(up.ok, true)
  assert.equal(up.version, 8)
  assert.equal(up.images, 0, 'the pictures already here are not asked again')
  assert.equal((await s3.catalogue()).version, 8)
  ok('a day later it is renewed; a silent, empty or wrong server leaves the older copy and is not hammered')

  // pictures that are not pictures are never kept
  rmSync(join(dir, 'shelf'), { recursive: true, force: true })
  const s4 = createShelf({ dir: () => dir, api: () => 'https://server.example.test', fetchFn, now: () => clock })
  server.pics = 'html'
  assert.equal(await s4.image(B + '.webp'), null, 'html is not a picture')
  server.pics = 'huge'
  assert.equal(await s4.image(B + '.webp'), null, 'too big')
  server.pics = 'missing'
  assert.equal(await s4.image(B + '.webp'), null)
  assert.ok(!existsSync(join(dir, 'shelf', B + '.webp')))
  server.pics = 'ok'
  const calls = server.calls.length
  for (const bad of ['../' + B + '.webp', 'large/../../x.webp', B + '.png', 'DOC.webp', '']) assert.equal(await s4.image(bad), null)
  assert.equal(server.calls.length, calls, 'a name outside the shape is never asked of the server')
  assert.ok((await s4.image(B + '.webp')).length > 12)
  ok('a reply that is not a picture, or too big, is not kept; a name outside the shape is never asked for')
}

// 5. an address that is not https (or the loopback) is never asked; the cycle can be stopped
{
  const calls = []
  const f = async (u) => { calls.push(u); return { status: 404, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) } }
  for (const api of ['http://server.example.test', 'ftp://x', 'file:///etc', 'not a url', '']) {
    const s = createShelf({ dir: () => null, api: () => api, fetchFn: f })
    assert.deepEqual(J(await s.load({ force: true })), { ok: false, error: 'no_server' }, api)
  }
  assert.equal(calls.length, 0)
  const local = createShelf({ dir: () => null, api: () => 'http://127.0.0.1:9', fetchFn: f })
  await local.load({ force: true })
  assert.equal(calls.length, 1, 'the loopback is allowed (a local server, tests)')
  const stop = createShelf({ dir: () => null, api: () => '', fetchFn: f }).start({ firstMs: 3_600_000, everyMs: 3_600_000 })
  assert.equal(typeof stop, 'function')
  stop()
  // the host glue wires both routes and the cycle, read only
  const idx = readFileSync(join(here, 'index.js'), 'utf8')
  assert.ok(idx.includes("path: '/kybernos/templates-catalogue'") && idx.includes("path: '/kybernos/templates-image'"))
  assert.ok(/route templates-catalogue[\s\S]{0,40}$/m.test(idx) || idx.includes("'kybernos: route templates-catalogue'"))
  assert.ok(idx.includes('KYBERNOS_NO_TEMPLATES_LOAD'), 'the background load can be switched off')
  ok('only an https address (or the loopback) is asked; the cycle stops; both routes are wired, read only')
}

console.log('\n' + pass + ' groups passed')
