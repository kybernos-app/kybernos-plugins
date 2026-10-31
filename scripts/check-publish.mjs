// check-publish.mjs — Publish, the mirror and Unpublish of an app, against the REAL team-space template (packages/kybernos-webapp-creator/templates/tables) booted for real and
// driven over http, with this repository's own client of it (packages/kybernos-db/remote). Needs the network once to install hono, @hono/node-server and better-auth (pinned,
// --ignore-scripts) in a temporary folder, or TABLES_APP_NODE_MODULES=<a node_modules that holds them> to skip that.
//
//   node scripts/check-publish.mjs           # a few seconds; it can be run as often as you like (everything it makes is in one temporary folder)
//
// What it proves, in order: an app is published (the owner's bearer, the bundle, the hosted fingerprint equal to the local one, the registry written with mode 0600); the owner's
// one-time link made on this side is accepted by the hosted app's own /open; a row written on this side (the page's route, the agent's tools) lands in the hosted app and in the
// local mirror before the answer returns; a row written by an invited member in the hosted app reaches the mirror (on demand and by the timer), with the member named in the copy's
// journal; a file goes up and comes back byte for byte; every change of structure is refused with `published`; an app with a sensitive field is not published; a wrong key, a
// server that is down in the middle of a write and a server that comes back are all told plainly and never damage the mirror; Unpublish brings the last state back and the app is an
// ordinary local one again (and can be published again); and the way out when the space cannot be reached. Publish goes onto a computer the person chose among the ones
// the hosting lists (an unlisted one is refused), and the state names it. No secret, key or link is printed, and everything that was said (the
// server's output, the publisher's log, every answer collected below) is searched for them at the end.
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeService } from '../packages/kybernos-db/agent/service.mjs'
import { tools } from '../packages/kybernos-db/agent/tools.mjs'
import { makeApi } from '../packages/kybernos-db/api.mjs'
import { sha256 } from '../packages/kybernos-db/remote/bundle.mjs'
import { makePublisher } from '../packages/kybernos-db/remote/publisher.mjs'
import { openPublishedRegistry } from '../packages/kybernos-db/remote/registry.mjs'
import { makeSpaceClient } from '../packages/kybernos-db/remote/space.mjs'
import { buildStructure } from '../packages/kybernos-db/template.mjs'
import { buildTablesApp } from '../packages/kybernos-webapp-creator/templates/tables/scripts/build-tables-app.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = mkdtempSync(join(tmpdir(), 'kb-publish-check-'))
let fails = 0
const check = (label, cond, detail = '') => { console.log((cond ? 'ok   ' : 'FAIL ') + label + (!cond && detail !== '' ? '  [' + String(detail).slice(0, 300) + ']' : '')); if (!cond) fails++ }
const group = (name) => console.log('\n' + name)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const until = async (fn, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(25) } return false }
const seen = [] // every answer collected below: none may carry a secret

let server = null
let output = ''
let app = null
let port = 0
let BASE = ''
const authSecret = randomBytes(32).toString('base64url')
const bootHex = randomBytes(32).toString('hex')
const data = join(root, 'data')

function startServer () {
  return new Promise((resolve) => {
    const before = output.length
    server = spawn(process.execPath, ['--no-warnings', 'server.js'], { cwd: app, env: { PATH: process.env.PATH, PORT: String(port), KB_AUTH_SECRET: authSecret, KB_BOOT_KEY: bootHex, KB_DATA_DIR: data, KB_TRUST_PROXY: '1', KB_BUNDLE_MAX_BYTES: String(64 * 1024 * 1024) }, stdio: ['ignore', 'pipe', 'pipe'] })
    server.stdout.on('data', (d) => { output += d })
    server.stderr.on('data', (d) => { output += d })
    const timer = setInterval(() => { if (output.slice(before).includes('listening ' + port)) { clearInterval(timer); resolve(true) } }, 50)
    setTimeout(() => { clearInterval(timer); resolve(output.slice(before).includes('listening ' + port)) }, 8000)
  })
}
function stopServer () {
  return new Promise((resolve) => {
    if (server === null || server.exitCode !== null) return resolve()
    server.once('exit', () => resolve())
    server.kill('SIGTERM')
    setTimeout(() => { try { server.kill('SIGKILL') } catch (e) { /* gone */ } }, 3000)
  })
}

/** One « browser » at the hosted app: its own cookies and its own address for the rate limits, its CSRF token fetched the way a page would. */
class Browser {
  constructor (ip) { this.ip = ip; this.jar = new Map(); this.token = null }
  keep (res) { for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); const name = kv.slice(0, i); const val = kv.slice(i + 1); if (val === '' || /max-age=0/i.test(c)) this.jar.delete(name); else this.jar.set(name, val) } }
  get cookie () { return [...this.jar].map(([k, v]) => k + '=' + v).join('; ') }
  async csrf () { if (this.token === null) { const r = await this.fetch('/api/csrf', { csrf: false }); this.token = (await r.json()).token } return this.token }
  async fetch (path, { method = 'GET', json, body, headers = {}, origin = BASE, csrf = true } = {}) {
    const h = { 'x-forwarded-for': this.ip, ...headers }
    if (origin !== null) h.origin = origin
    let payload = body
    if (json !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(json) }
    if (method !== 'GET' && csrf && h['x-csrf-token'] === undefined) h['x-csrf-token'] = await this.csrf()
    if (this.cookie !== '') h.cookie = this.cookie
    const res = await fetch(BASE + path, { method, headers: h, body: payload, redirect: 'manual' })
    this.keep(res)
    return res
  }
  async j (path, o) { const r = await this.fetch(path, o); return { status: r.status, body: await r.json().catch(() => null) } }
}

async function main () {
  // ── 1. the hosted app: built with kybernos-db vendored, dependencies installed ──
  group('the team space')
  app = join(root, 'app')
  const built = buildTablesApp({ out: app })
  check('the template is built with ' + built.files + ' kybernos-db files vendored', built.files > 10)
  if (process.env.TABLES_APP_NODE_MODULES !== undefined && process.env.TABLES_APP_NODE_MODULES !== '') symlinkSync(process.env.TABLES_APP_NODE_MODULES, join(app, 'node_modules'), 'dir')
  else {
    const npm = spawnSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: app, encoding: 'utf8' })
    check('npm ci --ignore-scripts installed the pinned dependencies', npm.status === 0, (npm.stderr || '').slice(-200))
    if (npm.status !== 0) return
  }
  port = await new Promise((resolve) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) }) })
  BASE = 'http://127.0.0.1:' + port
  check('it listens on an OS-picked free port (never :3080)', (await startServer()) && port !== 3080, output.slice(0, 200))
  if (!output.includes('listening ' + port)) return

  // ── 2. this computer: a service, a registry, a publisher with the real client, and an e-commerce app with a picture ──
  const logs = []
  // the hosting port, with one computer: the space is the template booted above, and "the computer it runs on" is a name here
  const ORDER = 'https://kybernos.example.test/computers'
  const hostList = [{ id: 'check-host', name: 'Check computer', state: 'running', region: 'Nowhere, EU' }]
  const hosting = {
    available: () => true,
    describe: () => ({ name: 'Check space', orderUrl: ORDER }),
    hosts: async () => ({ ok: true, hosts: hostList }),
    ensureSpace: async ({ host }) => (host === 'check-host' ? { ok: true, space: { id: 'check-space', url: BASE, bootKey: bootHex } } : { ok: false, code: 'unknown-host', message: 'No such computer.' }),
  }
  const HOST = 'check-host'
  const local = join(root, 'local')
  const buildSide = () => {
    const registry = openPublishedRegistry({ file: join(local, 'published.json') })
    const holder = { publisher: null }
    const service = makeService({ dir: join(local, 'dbs'), ports: { published: (id) => registry.published(id), facade: (id, rawOf) => holder.publisher.facade(id, rawOf) } })
    holder.publisher = makePublisher({ service, registry, hosting, tmpRoot: join(local, 'tmp'), ports: { log: (t) => logs.push(t) } })
    const api = makeApi({ service, ports: { today: () => '2026-10-31', remote: { info: (id) => holder.publisher.info(id), hosting: () => holder.publisher.hostingState() } } })
    return { registry, service, publisher: holder.publisher, api }
  }
  let side = buildSide()
  const raw = JSON.parse(readFileSync(join(here, '..', 'packages', 'kybernos-plugin', 'themes', 'ecommerce', 'db', 'ecommerce.json'), 'utf8'))
  const shop = buildStructure(raw, 'en')
  const made = side.service.create({ name: shop.name, by: 'template', objects: shop.objects })
  const db0 = made.db
  db0.setProfiles(shop.profiles, 'template')
  const shopId = db0.info().id
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082', 'hex')
  const png2 = Buffer.concat([png, Buffer.from('a second picture')])
  const att = db0.attach(png, { name: 'ada.png', type: 'image/png' })
  const ada = db0.create('contact', { name: 'Ada', email: 'ada@example.com', photo: [att.file] }, 'agent')
  db0.create('product', { title: 'Candle', price: 12, stock: 4 }, 'agent')
  db0.create('orders', { title: '#1001' }, 'agent')
  db0.create('note', { body: 'Likes beeswax' }, 'agent')
  check('an e-commerce app with a picture exists on this computer', ada.ok === true && att.ok === true, JSON.stringify(ada).slice(0, 200))
  const adaId = ada.record.id
  const probe = makeSpaceClient({ url: BASE, bootKey: bootHex })
  const mirror = () => side.service.byId(shopId).db
  const titles = (object, key) => mirror().list(object).map((r) => r.values[key]).sort()

  // ── 3. Publish ──
  group('publish')
  const card = await side.publisher.check(shopId)
  seen.push(card)
  check('the card says it can be published, with its numbers and no blocked field', card.ok && card.can && card.tables >= 4 && card.rows >= 4 && card.files === 1 && card.blocked.length === 0, JSON.stringify(card).slice(0, 200))
  check('and lists the person\'s computers and the address that orders another', card.hosts.map((h) => h.id).join() === HOST && card.hosts[0].name === 'Check computer' && card.hosting.orderUrl === ORDER && card.lastHost === null)
  const unconfirmed = await side.publisher.publish(shopId, { host: HOST })
  check('Publish does nothing without the confirm button', unconfirmed.ok === false && unconfirmed.code === 'confirm' && side.registry.apps().length === 0)
  const stranger = await side.publisher.publish(shopId, { confirm: true, host: 'not-mine' })
  check('nor onto a computer that is not one of the person\'s', stranger.ok === false && stranger.code === 'unknown-host' && side.registry.apps().length === 0 && side.registry.spaces().length === 0)
  const before = mirror().fingerprint()
  const pub = await side.publisher.publish(shopId, { confirm: true, host: HOST })
  seen.push(pub)
  check('published', pub.ok === true, JSON.stringify(pub).slice(0, 300))
  if (!pub.ok) return
  const slug = pub.published.slug
  check('the app has a plain name there, and the registry says where, and on which computer', /^[a-z][a-z0-9-]*$/.test(slug) && side.registry.published(shopId) && pub.published.url === BASE && pub.published.host.id === HOST && pub.published.host.name === 'Check computer' && pub.published.hostGone === false && side.registry.lastHost() === HOST)
  const hostedFp = await probe.fingerprint(slug)
  check('the hosted copy is exactly what was sent (same fingerprint)', hostedFp.ok && hostedFp.fingerprint === before && mirror().fingerprint() === before, JSON.stringify(hostedFp))
  check('the registry file is private (0600) and is the only place the key is kept', (statSync(join(local, 'published.json')).mode & 0o777) === 0o600 && readFileSync(join(local, 'published.json'), 'utf8').includes(bootHex))
  check('the agent now gets the read-only copy', side.service.byId(shopId).db.published === true && titles('contact', 'name').join() === 'Ada')
  check('no working copy is left behind', !existsSync(join(local, 'tmp')) || readdirSync(join(local, 'tmp')).every((d) => readdirSync(join(local, 'tmp', d)).length === 0))
  const state = side.api.state()
  seen.push(state)
  check('the state says it is published, and carries no key', state.dbs.find((d) => d.id === shopId).published.slug === slug && state.dbs.find((d) => d.id === shopId).published.host.id === HOST && state.hosting.available === true && !JSON.stringify(state).includes(bootHex))

  // ── 4. Open web app: the one-time link made on this side, redeemed by the hosted app's own /open ──
  group('open web app')
  const opened = side.publisher.openWeb(shopId)
  check('a one-time link is made without a request to the space', opened.ok === true && opened.url.startsWith(BASE + '/open?t='))
  const owner = new Browser('10.0.1.1')
  const entry = await owner.fetch(opened.url.slice(BASE.length))
  check('the hosted app accepts it: 303 to / with a session cookie', entry.status === 303 && entry.headers.get('location') === '/' && owner.jar.size > 0, String(entry.status))
  const me = await owner.j('/api/me')
  check('and the person is its owner', me.status === 200 && me.body.role === 'owner')
  check('the same link a second time is refused', (await new Browser('10.0.1.2').fetch(opened.url.slice(BASE.length))).status === 403)
  const list = await owner.j('/api/apps')
  check('the owner sees the app in the web app, with its tables', list.status === 200 && list.body.apps.some((a) => a.slug === slug && a.objects.length >= 4))
  const hostedContacts = (await owner.j('/api/apps/' + slug + '/records?object=contact')).body
  check('and its rows, the personal email in clear for the owner', hostedContacts.records.length === 1 && hostedContacts.records[0].values.email === 'ada@example.com')

  // ── 5. rows written on this side ──
  group('rows written from this computer')
  const page = await side.publisher.forwardWrite({ db: shopId, object: 'contact', op: 'create', values: { name: 'Bob', email: 'bob@example.com' } })
  seen.push(page)
  check('the page\'s write lands in the web app and in the mirror before the answer returns', page.ok === true && titles('contact', 'name').join() === 'Ada,Bob' && (await owner.j('/api/apps/' + slug + '/records?object=contact')).body.records.length === 2, JSON.stringify(page).slice(0, 200))
  const T = Object.fromEntries(tools(side.service, { today: () => '2026-10-31' }).map((t) => [t.name, t]))
  const agent = await T.records_create.execute({ object: 'note', records: [{ body: 'Written by Kaby' }, { body: 'And another' }] })
  seen.push(agent)
  check('the agent\'s tool does the same, row by row', agent.ok === true && agent.created.length === 2 && titles('note', 'body').join() === 'And another,Likes beeswax,Written by Kaby')
  const bobId = mirror().list('contact').find((r) => r.values.name === 'Bob').id
  const upd = await side.publisher.forwardWrite({ db: shopId, object: 'contact', op: 'update', id: bobId, values: { name: 'Robert' } })
  const del = await side.publisher.forwardWrite({ db: shopId, object: 'contact', op: 'delete', id: bobId })
  const res = await side.publisher.forwardWrite({ db: shopId, object: 'contact', op: 'restore', id: bobId })
  check('update, delete and restore too', upd.ok && del.ok && res.ok && titles('contact', 'name').join() === 'Ada,Robert')
  const refusedRow = await side.publisher.forwardWrite({ db: shopId, object: 'contact', op: 'create', values: {} })
  const ghost = await side.publisher.forwardWrite({ db: shopId, object: 'ghost', op: 'create', values: { name: 'x' } })
  check('what the web app refuses comes back with its reason, and the mirror is unchanged', refusedRow.ok === false && refusedRow.error === 'invalid' && ghost.ok === false && ghost.error === 'unknown_object' && titles('contact', 'name').join() === 'Ada,Robert', JSON.stringify([refusedRow, ghost]).slice(0, 200))
  const fpNow = (await probe.fingerprint(slug)).fingerprint
  check('the mirror and the web app are at the same state', mirror().fingerprint() === fpNow)
  const hostedBy = (() => { const s = makeService({ dir: join(data, 'apps', slug) }); try { return s.byId(shopId).db.journal({ object: 'contact', record: bobId }).map((e) => e.by) } finally { s.close() } })()
  check('the web app\'s own journal names the writer (the owner, as « person »)', hostedBy.length > 0 && hostedBy.every((b) => b === 'person'), JSON.stringify(hostedBy))

  // ── 6. files ──
  group('files')
  const up = await side.publisher.forwardUpload({ db: shopId, object: 'contact', field: 'photo', name: 'robert.png', type: 'image/png', bytes: png2 })
  seen.push(up)
  check('a file goes up through the web app', up.ok === true && up.file.hash === sha256(png2), JSON.stringify(up).slice(0, 200))
  const withFile = await side.publisher.forwardWrite({ db: shopId, object: 'contact', op: 'update', id: bobId, values: { photo: [up.file] } })
  check('a row holds it, and the mirror has the very bytes', withFile.ok === true && mirror().blobs.get(sha256(png2))?.equals(png2) === true && mirror().blobs.get(att.file.hash)?.equals(png) === true)
  const served = await owner.fetch('/api/apps/' + slug + '/file?object=contact&id=' + bobId + '&field=photo&hash=' + up.file.hash)
  check('and the web app serves it back to its owner', served.status === 200 && Buffer.from(await served.arrayBuffer()).equals(png2))

  // ── 7. a member writes in the web app ──
  group('another person writes in the web app')
  const invite = await owner.j('/api/people/invitations', { method: 'POST', json: { email: 'max@example.test', role: 'member' } })
  const member = new Browser('10.0.2.1')
  const accepted = await member.j('/api/invitations/accept', { method: 'POST', json: { token: new URL(invite.body.link).searchParams.get('t'), name: 'Max', password: 'member-password-1' } })
  check('a member is invited and joins', invite.status === 200 && accepted.status === 200 && accepted.body.role === 'member')
  const noteByMember = await member.j('/api/apps/' + slug + '/write', { method: 'POST', json: { object: 'note', op: 'create', values: { body: 'From a member' } } })
  check('the member writes a note in the web app', noteByMember.status === 200 && noteByMember.body.ok === true)
  check('the mirror does not have it yet (nothing has asked)', !titles('note', 'body').includes('From a member'))
  const pulled = await side.publisher.refresh(shopId)
  check('a refresh on demand brings it', pulled.ok === true && pulled.changed === true && titles('note', 'body').includes('From a member'))
  const memberMe = await member.j('/api/me')
  const memberBy = mirror().journal({ object: 'note', record: noteByMember.body.record.id }).map((e) => e.by)
  check('the copy\'s journal says who wrote it: the member, by id', memberBy.includes('member:' + memberMe.body.id), JSON.stringify(memberBy))
  const again = await side.publisher.refresh(shopId)
  check('a refresh when nothing changed asks for nothing more', again.ok === true && again.changed === false)
  side.publisher.start({ everyMs: 150, firstMs: 40 })
  const second = await member.j('/api/apps/' + slug + '/write', { method: 'POST', json: { object: 'note', op: 'create', values: { body: 'Picked up by the timer' } } })
  check('the timer brings the next one without anybody asking', second.status === 200 && (await until(() => titles('note', 'body').includes('Picked up by the timer'), 4000)))
  side.publisher.stop()
  await member.j('/api/apps/' + slug + '/write', { method: 'POST', json: { object: 'note', op: 'create', values: { body: 'Written after the timer was stopped' } } })
  await sleep(600)
  check('and once the timer is stopped nothing polls any more', !titles('note', 'body').includes('Written after the timer was stopped'))
  await side.publisher.refresh(shopId)

  // ── 8. what is refused ──
  group('what is refused while an app is published')
  const dbNow = side.service.byId(shopId).db
  const notesBefore = titles('note', 'body').length
  const structure = [
    dbNow.addField('note', { key: 'tag', type: 'text', label: 'Tag' }, 'agent'),
    dbNow.saveView('note', { name: 'All', kind: 'table' }, 'agent'),
    side.api.view({ db: shopId, object: 'note', op: 'save', view: { name: 'All', kind: 'table' } }),
    side.api.app({ db: shopId, op: 'archive' }),
    side.api.write({ db: shopId, object: 'note', op: 'create', values: { body: 'sneaked in' } }),
    await T.field_add.execute({ db: shopId, object: 'note', field: { key: 'tag', type: 'text', label: 'Tag' } }),
    await T.object_define.execute({ db: shopId, key: 'extra', label: 'Extras', fields: [{ key: 'name', type: 'text', label: 'Name' }] }),
    await T.db_archive.execute({ db: shopId }),
  ]
  check('every change of structure, view or app is refused with `published`, by the api, the store facade and the agent alike', structure.every((r) => r.ok === false && (r.code === 'published' || r.error === 'published')), JSON.stringify(structure.map((r) => r.code || r.error)))
  check('nothing moved', mirror().objects().length === shop.objects.length && titles('note', 'body').length === notesBefore && !titles('note', 'body').includes('sneaked in'))
  check('the person is not asked to approve something that cannot happen', (await import('../packages/kybernos-db/agent/tools.mjs')).approvalGate(side.service, { name: 'field_add', arguments: { db: shopId, object: 'note', field: { key: 'tag', type: 'text', label: 'Tag' } } }) === null)
  const bank = side.service.create({ name: 'Bank', by: 'agent', objects: [{ key: 'account', label: 'Accounts', title: 'name', fields: [{ key: 'name', type: 'text', label: 'Name', required: true }, { key: 'iban', type: 'text', label: 'IBAN', protection: 'sensitive' }, { key: 'pin', type: 'text', label: 'PIN', protection: 'secret' }] }] })
  const bankId = bank.db.info().id
  const bankCard = await side.publisher.check(bankId)
  const bankTry = await side.publisher.publish(bankId, { confirm: true, host: HOST })
  check('an app with a sensitive or a secret field is not published, and the fields are named', bankCard.can === false && bankCard.reason === 'sensitive' && bankTry.ok === false && bankTry.code === 'sensitive' && bankTry.fields.map((f) => f.field).join() === 'iban,pin')
  check('and nothing of it reached the space', (await owner.j('/api/apps')).body.apps.map((a) => a.slug).join() === slug)

  // ── 9. a wrong key ──
  group('a wrong key')
  const spare = side.service.create({ name: 'Spare', by: 'agent', objects: [{ key: 'item', label: 'Items', title: 'name', fields: [{ key: 'name', type: 'text', label: 'Name', required: true }] }] })
  const spareId = spare.db.info().id
  const wrong = makePublisher({ service: side.service, registry: openPublishedRegistry({ file: join(root, 'other-registry.json') }), hosting: { ...hosting, ensureSpace: async () => ({ ok: true, space: { id: 'wrong', url: BASE, bootKey: randomBytes(32).toString('hex') } }) }, tmpRoot: join(root, 'wrong-tmp'), ports: {} })
  const refusedKey = await wrong.publish(spareId, { confirm: true, host: HOST })
  seen.push(refusedKey)
  check('a space that does not accept the key is told "refused", and nothing is published or left there', refusedKey.ok === false && refusedKey.code === 'refused' && wrong.isPublished(spareId) === false && (await owner.j('/api/apps')).body.apps.map((a) => a.slug).join() === slug)
  check('the right key still works afterwards (a refusal locks nobody out)', (await probe.fingerprint(slug)).ok === true)

  // ── 10. the space goes down in the middle of things ──
  group('the space goes down')
  const names = titles('contact', 'name').join()
  await stopServer()
  const lost = await side.publisher.forwardWrite({ db: shopId, object: 'contact', op: 'create', values: { name: 'Lost?' } })
  seen.push(lost)
  check('a write while it is down says it may not have been saved, and the mirror is as it was', lost.ok === false && lost.error === 'unreachable' && /may not have been saved/.test(lost.message) && titles('contact', 'name').join() === names)
  await side.publisher.tick()
  const sick = side.api.state().dbs.find((d) => d.id === shopId).published
  check('the state says the sync failed and when it last worked', sick.syncError?.code === 'unreachable' && typeof sick.lastSync === 'string', JSON.stringify(sick).slice(0, 200))
  check('and, as the hosting still lists its computer, that the computer is not gone', sick.hostGone === false && sick.host.id === HOST)
  check('the page still reads the copy it has', titles('contact', 'name').join() === names && side.service.byId(shopId).db.count('contact') === 2)
  const stuck = await side.publisher.unpublish(shopId)
  check('Unpublish says it cannot reach the space, offers the way out, and changes nothing', stuck.ok === false && stuck.code === 'unreachable' && stuck.canForget === true && side.publisher.isPublished(shopId))
  check('the open link needs no request, so it still comes (it will not open until the space is back)', side.publisher.openWeb(shopId).ok === true)
  check('the server really started again', await startServer(), output.slice(-200))
  const back = await side.publisher.refresh(shopId)
  check('when it is back the next refresh works and the error is gone', back.ok === true && side.publisher.info(shopId).syncError === null)
  const afterRestart = await side.publisher.forwardWrite({ db: shopId, object: 'contact', op: 'create', values: { name: 'After the restart' } })
  check('writes work again, and nothing written before the outage was lost', afterRestart.ok === true && titles('contact', 'name').join() === 'Ada,After the restart,Robert')

  // ── 11. this computer restarts ──
  group('this computer restarts')
  side.publisher.stop()
  side.service.close()
  side = buildSide()
  check('the registry remembers what is published', side.publisher.isPublished(shopId) && side.publisher.info(shopId).slug === slug)
  const memberTwice = await member.j('/api/apps/' + slug + '/write', { method: 'POST', json: { object: 'note', op: 'create', values: { body: 'While this computer was off' } } })
  const caught = await side.publisher.refresh(shopId)
  check('a restart is just a gap: the next refresh catches up', memberTwice.status === 200 && caught.ok === true && titles('note', 'body').includes('While this computer was off'))
  check('and the app is still the read-only copy', side.service.byId(shopId).db.published === true && side.service.byId(shopId).db.addField('note', { key: 'x', type: 'text', label: 'X' }, 'agent').code === 'published')
  const T2 = Object.fromEntries(tools(side.service, { today: () => '2026-10-31' }).map((t) => [t.name, t]))
  check('the agent writes through the web app after the restart too', (await T2.records_create.execute({ db: shopId, object: 'note', records: [{ body: 'After the restart, by Kaby' }] })).ok === true)

  // ── 12. Unpublish ──
  group('unpublish')
  await member.j('/api/apps/' + slug + '/write', { method: 'POST', json: { object: 'note', op: 'create', values: { body: 'Last word from the web app' } } })
  const hostedLast = (await probe.fingerprint(slug)).fingerprint
  const gone = await side.publisher.unpublish(shopId)
  seen.push(gone)
  check('unpublished', gone.ok === true, JSON.stringify(gone).slice(0, 300))
  const after = side.service.byId(shopId).db
  check('the app is an ordinary local one: no facade, no registry entry', after.published === undefined && side.registry.published(shopId) === false && side.publisher.info(shopId) === null)
  check('it holds the very last state of the web app, even a write nobody had pulled', after.fingerprint() === hostedLast && after.list('note').some((r) => r.values.body === 'Last word from the web app'))
  check('the hosted copy is gone from the space', (await probe.fingerprint(slug)).code === 'unknown' && (await owner.j('/api/apps')).body.apps.length === 0)
  check('its structure can change again', after.addField('note', { key: 'tag', type: 'text', label: 'Tag' }, 'person').ok === true && after.create('note', { body: 'Local again', tag: 'x' }, 'person').ok === true)
  check('the picture is still there, byte for byte', after.blobs.get(sha256(png2))?.equals(png2) === true)
  check('a second Unpublish says there is nothing to unpublish', (await side.publisher.unpublish(shopId)).code === 'not-published')

  group('publish again, and the way out')
  const again2 = await side.publisher.publish(shopId, { confirm: true, host: HOST })
  check('the same app can be published again (a new copy, the local changes included)', again2.ok === true && (await probe.fingerprint(again2.published.slug)).fingerprint === side.service.byId(shopId).db.fingerprint(), JSON.stringify(again2).slice(0, 200))
  const slug2 = again2.published.slug
  await stopServer()
  const noForget = await side.publisher.unpublish(shopId, { forget: true, confirm: 'not the name' })
  const forgot = await side.publisher.unpublish(shopId, { forget: true, confirm: shop.name })
  seen.push(forgot)
  check('with the space down, "keep my local copy and forget the hosted one" needs the app\'s exact name', noForget.ok === false && noForget.code === 'confirm' && forgot.ok === true && forgot.forgotten === true)
  check('the local copy stays as it was, ordinary again', side.registry.published(shopId) === false && side.service.byId(shopId).db.published === undefined && side.service.byId(shopId).db.list('note').length >= 5)
  check('the server really started again', await startServer(), output.slice(-200))
  check('and the hosted copy was left alone, as promised', (await probe.fingerprint(slug2)).ok === true)
  const clean = await probe.release(slug2)
  check('(it is released by hand here, to leave the space clean)', clean.ok === true && (await probe.fingerprint(slug2)).code === 'unknown')

  // ── 13. nothing secret was said ──
  group('secrets')
  const said = JSON.stringify([seen, logs, side.api.state()]) + output
  check('the boot key never appears in an answer, a log line, the state or the server\'s output', !said.includes(bootHex))
  check('neither does the auth secret', !said.includes(authSecret))
  check('nor the one-time link', !said.includes(new URL(opened.url).searchParams.get('t')))
  check('the publisher said something, and only about ids', logs.length > 0 && logs.every((l) => !/https?:\/\//.test(l)))
}

try { await main() } catch (e) { console.log('FAIL the check itself broke: ' + String((e && e.stack) || e).slice(0, 600)); fails++ } finally {
  await stopServer()
  rmSync(root, { recursive: true, force: true })
}
console.log('\n' + (fails === 0 ? 'all checks passed' : fails + ' check(s) failed'))
process.exit(fails === 0 ? 0 : 1)
