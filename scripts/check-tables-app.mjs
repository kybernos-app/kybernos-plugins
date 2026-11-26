// check-tables-app.mjs — the tables template (packages/kybernos-webapp-creator/templates/tables) booted for real and driven over http. Needs the network once to install
// hono, @hono/node-server and better-auth (pinned, --ignore-scripts) in a temporary folder, or TABLES_APP_NODE_MODULES=<a node_modules that holds them> to skip that.
//
//   node scripts/check-tables-app.mjs        # a few seconds (the install is a few more when the npm cache is cold)
//
// It builds the app (vendoring kybernos-db), boots it on a free port (never :3080) with a trusted proxy header so each « browser » below has its own address for the rate
// limits, and runs: the spike's checks, the page's files and policy (what is served and what is not, the headers, no inline script or style on any page), the e-commerce rights
// matrix for the owner and two members, the owner's link, invitations, removal, CSRF and Origin, cookie flags, uploads, the body limit and the rate limits, then the owner's API
// token (a bearer, no cookie) and the transfer routes: import a bundle, snapshot it back, release it.
// No secret or token is printed, and the server's output is searched for them at the end.
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { createServer as createHttpServer, request as httpRequest } from 'node:http'
import { createServer } from 'node:net'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomBytes } from 'node:crypto'
import { makeService } from '../packages/kybernos-db/agent/service.mjs'
import { decodeBundle, checkManifest } from '../packages/kybernos-db/remote/bundle.mjs'
import { bundleOf, snapshotDb, stageBundle } from '../packages/kybernos-db/remote/snapshot.mjs'
import { openDb } from '../packages/kybernos-db/store/index.mjs'
import { buildStructure } from '../packages/kybernos-db/template.mjs'
import { buildTablesApp } from '../packages/kybernos-webapp-creator/templates/tables/scripts/build-tables-app.mjs'
import { installApp } from '../packages/kybernos-webapp-creator/templates/tables/lib/install.mjs'

const t0 = Date.now()
const here = dirname(fileURLToPath(import.meta.url))
const root = mkdtempSync(join(tmpdir(), 'kb-tables-check-'))
let fails = 0
let total = 0
const check = (label, cond, detail = '') => { total++; console.log((cond ? 'ok   ' : 'FAIL ') + label + (!cond && detail !== '' ? '  [' + detail + ']' : '')); if (!cond) fails++ }
const group = (name) => console.log('\n' + name)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let server = null
let serverB = null // the second instance, the one with a (fake) mail provider
let serverC = null // the third, a bare one that a freeze is tried on across a restart
let output = ''
let outputB = ''
const MAIL_KEY = 're_test_' + randomBytes(12).toString('hex') // never printed, searched for in everything the servers say
const BUNDLE_CAP = 4 * 1024 * 1024
const issued = [] // every API token minted below: none may reach the server's output

async function main () {
  // ── 1. the app: built with kybernos-db vendored, dependencies installed ──
  group('build')
  const app = join(root, 'app')
  const built = buildTablesApp({ out: app })
  check('built with ' + built.files + ' kybernos-db files vendored', built.files > 10)
  const t1 = Date.now()
  if (process.env.TABLES_APP_NODE_MODULES !== undefined && process.env.TABLES_APP_NODE_MODULES !== '') {
    symlinkSync(process.env.TABLES_APP_NODE_MODULES, join(app, 'node_modules'), 'dir')
    check('dependencies reused from TABLES_APP_NODE_MODULES', true)
  } else {
    const npm = spawnSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: app, encoding: 'utf8' })
    check('npm ci --ignore-scripts installed the three pinned dependencies in ' + Math.round((Date.now() - t1) / 1000) + ' s', npm.status === 0, (npm.stderr || '').slice(-200))
    if (npm.status !== 0) return
  }

  // ── 2. two apps in the space: the e-commerce one (with a personal phone and a sensitive IBAN the member profile does not name) and one with no profile ──
  const raw = JSON.parse(readFileSync(join(here, '..', 'packages', 'kybernos-plugin', 'themes', 'ecommerce', 'db', 'ecommerce.json'), 'utf8'))
  const shop = buildStructure(raw, 'en')
  const svc = makeService({ dir: join(root, 'dbs') })
  const made = svc.create({ name: shop.name, by: 'template', objects: shop.objects })
  const db = made.db
  db.setProfiles([...shop.profiles, { id: 'viewer', label: 'Viewer', grants: [{ object: 'orders', do: ['read'] }, { object: 'product', do: ['read'] }] }], 'template')
  db.addField('contact', { key: 'phone', type: 'text', label: 'Phone', protection: 'personal' }, 'agent')
  db.addField('contact', { key: 'iban', type: 'text', label: 'IBAN', protection: 'sensitive' }, 'agent')
  const seed = (object, values) => db.create(object, values, 'agent').record.id
  seed('contact', { name: 'Ada', email: 'ada@example.com', phone: '0102030405', iban: 'FR7612345' })
  seed('product', { title: 'Candle', price: 12, stock: 4 })
  seed('orders', { title: '#1001' })
  seed('note', { body: 'Likes beeswax' })
  const shopId = db.info().id
  const ledger = svc.create({ name: 'Ledger', by: 'agent', objects: [{ key: 'entry', label: 'Entries', title: 'label', fields: [{ key: 'label', type: 'text', label: 'Label', required: true }] }] })
  const ledgerId = ledger.db.info().id
  svc.close()
  const data = join(root, 'data')
  check('two apps installed in the space', installApp(join(data, 'apps'), 'shop', join(root, 'dbs', shopId)).ok && installApp(join(data, 'apps'), 'ledger', join(root, 'dbs', ledgerId)).ok)

  // ── 3. boot on a free port ──
  const port = await new Promise((resolve) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) }) })
  const authSecret = randomBytes(32).toString('base64url')
  const bootHex = randomBytes(32).toString('hex')
  const BASE = 'http://127.0.0.1:' + port
  server = spawn(process.execPath, ['--no-warnings', 'server.js'], { cwd: app, env: { PATH: process.env.PATH, PORT: String(port), KB_AUTH_SECRET: authSecret, KB_BOOT_KEY: bootHex, KB_DATA_DIR: data, KB_TRUST_PROXY: '1', KB_BUNDLE_MAX_BYTES: String(BUNDLE_CAP) }, stdio: ['ignore', 'pipe', 'pipe'] })
  server.stdout.on('data', (d) => { output += d })
  server.stderr.on('data', (d) => { output += d })
  for (let i = 0; i < 100 && !output.includes('listening ' + port); i++) await sleep(100)
  check('the server listens on an OS-picked free port', output.includes('listening ' + port) && port !== 3080, output.slice(0, 200))
  if (!output.includes('listening ' + port)) return

  // the app's own modules, for minting links and for the https instance (same code, resolved from the built copy)
  const { mintOpenToken } = await import(pathToFileURL(join(app, 'lib', 'bootstrap.mjs')).href)
  const { buildApp } = await import(pathToFileURL(join(app, 'app.mjs')).href)
  const bootKey = Buffer.from(bootHex, 'hex')
  const link = (opts = {}) => '/open?t=' + encodeURIComponent(mintOpenToken({ key: bootKey, ...opts }))

  /** One browser: its own cookies, its own address for the rate limits, its CSRF token fetched the way a page would. */
  class Browser {
    constructor (ip, base = BASE) { this.ip = ip; this.base = base; this.jar = new Map(); this.token = null }
    keep (res) { for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); const name = kv.slice(0, i); const val = kv.slice(i + 1); if (val === '' || /max-age=0/i.test(c)) this.jar.delete(name); else this.jar.set(name, val) } }
    get cookie () { return [...this.jar].map(([k, v]) => k + '=' + v).join('; ') }
    has (part) { return [...this.jar.keys()].some((k) => k.includes(part)) }
    async csrf () { if (this.token === null) { const r = await this.fetch('/api/csrf', { csrf: false }); this.token = (await r.json()).token } return this.token }
    /** `json` or `form` or `body`; `origin: null` sends none; `csrf: false` sends no token. */
    async fetch (path, { method = 'GET', json, form, body, headers = {}, origin = this.base, csrf = true } = {}) {
      const h = { 'x-forwarded-for': this.ip, ...headers }
      if (origin !== null) h.origin = origin
      let payload = body
      if (json !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(json) }
      if (form !== undefined) { h['content-type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(form).toString() }
      if (method !== 'GET' && csrf && h['x-csrf-token'] === undefined && form === undefined) h['x-csrf-token'] = await this.csrf()
      if (form !== undefined && csrf && form._csrf === undefined) payload = new URLSearchParams({ ...form, _csrf: await this.csrf() }).toString()
      if (this.cookie !== '') h.cookie = this.cookie
      const res = await fetch(this.base + path, { method, headers: h, body: payload, redirect: 'manual' }).catch((e) => { e.message += ' (' + method + ' ' + path.split('?')[0] + ')'; throw e })
      this.keep(res)
      return res
    }
    async j (path, o) { const r = await this.fetch(path, o); return { status: r.status, body: await r.json().catch(() => null) } }
  }
  /** A request on a connection of its own (never the shared pool): `{ status }`, or `{ status: 0, dropped }` when the server hung up first. With no `body` only the headers are sent. */
  const lone = (path, { method, headers, body }) => new Promise((resolve) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method, headers, agent: false }, (res) => { res.resume(); res.on('end', () => { resolve({ status: res.statusCode }); req.destroy() }) })
    req.on('error', (e) => resolve({ status: 0, dropped: e.code }))
    req.setTimeout(5000, () => { resolve({ status: 0, dropped: 'timeout' }); req.destroy() })
    if (body !== undefined) req.end(body)
    else req.flushHeaders()
  })
  const PW = { owner1: 'owner-password-one', owner2: 'owner-password-two', member: 'member-password-1' }
  const signIn = async (b, email, password) => b.j('/api/auth/sign-in/email', { method: 'POST', json: { email, password } })
  const api = (b, slug, what, o) => b.j('/api/apps/' + slug + '/' + what, o)
  const write = (b, values, object, op, id) => api(b, 'shop', 'write', { method: 'POST', json: { object, op, id, values } })
  const records = async (b, object) => (await api(b, 'shop', 'records?object=' + object)).body

  // ── 4. anonymous, and the edge on every answer ──
  group('anonymous and the edge')
  const anon = new Browser('10.0.9.1')
  check('GET /health -> 200', (await anon.fetch('/health')).status === 200)
  check('anonymous GET /api/me -> 401', (await anon.fetch('/api/me')).status === 401)
  check('anonymous GET /api/apps -> 401', (await anon.fetch('/api/apps')).status === 401)
  check('anonymous GET /api/apps/shop/records -> 401', (await anon.fetch('/api/apps/shop/records?object=orders')).status === 401)
  check('anonymous GET /people -> 401', (await anon.fetch('/people')).status === 401)
  const nf = await anon.fetch('/nothing-here')
  check('a 404 carries the security headers too', nf.status === 404 && nf.headers.get('x-content-type-options') === 'nosniff' && /frame-ancestors 'none'/.test(nf.headers.get('content-security-policy') ?? '') && nf.headers.get('referrer-policy') === 'no-referrer')
  check('only sign-in, sign-out and get-session are open under /api/auth', (await anon.fetch('/api/auth/sign-up/email', { method: 'POST', json: { email: 'x@example.test', password: 'whatever-123456', name: 'X' } })).status === 404 && (await anon.fetch('/api/auth/list-sessions')).status === 404 && (await anon.fetch('/api/auth/reset-password', { method: 'POST', json: {} })).status === 404)
  check('public sign-up creates nobody', (await anon.j('/api/auth/sign-in/email', { method: 'POST', json: { email: 'x@example.test', password: 'whatever-123456' } })).status === 401)

  // ── 4b. the page: its files, and the policy on every page ──
  group('the page: files and policy')
  const POLICY = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
  /** True when the html has no inline script, no <style>, no style attribute and no handler attribute: what the policy would refuse to run anyway. */
  const noInline = (html) => !/<script(?![^>]*\ssrc=)/i.test(html) && !/<style[\s>]/i.test(html) && !/\sstyle\s*=/i.test(html) && !/\son[a-z]+\s*=/i.test(html) && !/javascript:/i.test(html)
  /** A request with the path exactly as given (fetch would tidy `..` away). */
  const rawGet = (path, { method = 'GET', headers = {} } = {}) => new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method, headers: { 'x-forwarded-for': '10.0.9.9', ...headers } }, (res) => { const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })) })
    req.on('error', reject)
    req.end()
  })
  const { ASSETS } = await import(pathToFileURL(join(app, 'lib', 'assets.mjs')).href)
  const walk = (dir, base = '') => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n), base + n + '/') : [base + n]))
  check('the served list and the public/ folder of the built app hold the same files', JSON.stringify(walk(join(app, 'public')).sort()) === JSON.stringify(Object.values(ASSETS).map(([f]) => f).sort()))
  const bad = []
  for (const [address, [file, type]] of Object.entries(ASSETS)) {
    const r = await rawGet(address)
    const ok = r.status === 200 && r.headers['content-type'] === type && r.headers['x-content-type-options'] === 'nosniff' && r.headers['content-security-policy'] === POLICY && r.headers['cache-control'] === 'no-cache' && /^"[A-Za-z0-9_-]{22}"$/.test(r.headers.etag ?? '') && r.body.equals(readFileSync(join(app, 'public', file)))
    if (!ok) bad.push(address + ' ' + r.status + ' ' + r.headers['content-type'])
  }
  check('every file of the page is served with its own content type, nosniff, the policy exactly as before, no-cache and an ETag', bad.length === 0, bad.join('; '))
  const first = await rawGet('/app.css')
  const cached = await rawGet('/app.css', { headers: { 'if-none-match': first.headers.etag } })
  const head = await rawGet('/js/main.mjs', { method: 'HEAD' })
  check('a browser that holds the current version gets a 304 with no body; HEAD has none either', cached.status === 304 && cached.body.length === 0 && cached.headers.etag === first.headers.etag && head.status === 200 && head.body.length === 0)
  const shell = await anon.fetch('/')
  const shellHtml = await shell.text()
  check('GET / is the same page for everyone, signed in or not: the shell with one module script and the stylesheet', shell.status === 200 && shellHtml === readFileSync(join(app, 'public', 'index.html'), 'utf8') && /<script type="module" src="\/js\/main\.mjs">/.test(shellHtml) && shellHtml.includes('href="/app.css"') && noInline(shellHtml))
  const notListed = ['/index.html', '/js', '/js/', '/app.mjs', '/server.js', '/package.json', '/package-lock.json', '/lib/safety.mjs', '/lib/assets.mjs', '/public/app.css', '/public/', '/vendor/kybernos-db/api.mjs', '/node_modules/hono/package.json', '/.gitignore', '/README.md', '/scripts/build-tables-app.mjs', '/secrets.json', '/auth.sqlite', '/app.css/', '/APP.CSS', '/js/MAIN.MJS']
  const exposed = []
  for (const path of notListed) { const r = await rawGet(path); if (r.status !== 404) exposed.push(path + ' ' + r.status) }
  check('anything that is not on the list is a 404: the source, the manifest, the vendored code, folders, other spellings', exposed.length === 0, exposed.join('; '))
  const hops = ['/js/../app.mjs', '/js/..%2fapp.mjs', '/js/%2e%2e/app.mjs', '/%2e%2e/%2e%2e/etc/passwd', '/js/..%5capp.mjs', '/js/%2e%2e%2f%2e%2e%2fpackage.json', '/app.css%00.js', '/js/./main.mjs/../../app.mjs', '//etc/passwd', '/..%252fapp.mjs']
  const hopped = []
  for (const path of hops) { const r = await rawGet(path); const body = r.body.toString('utf8'); if (![400, 404].includes(r.status) || body.includes('buildApp') || body.includes('root:')) hopped.push(path + ' ' + r.status) }
  check('a path that climbs out of the folder, however it is spelled, reaches nothing', hopped.length === 0, hopped.join('; '))
  const stray = await rawGet('/js/main.mjs', { method: 'POST' })
  check('a file of the page cannot be written or posted to', [403, 404].includes(stray.status))
  const four04 = await rawGet('/nothing-here')
  const api401 = await rawGet('/api/apps')
  check('the policy is the same string on a 404 and on an API answer', four04.headers['content-security-policy'] === POLICY && api401.headers['content-security-policy'] === POLICY)
  const scripts = Object.values(ASSETS).filter(([, type]) => type.startsWith('text/javascript')).map(([file]) => readFileSync(join(app, 'public', file), 'utf8'))
  check('the page\'s own code builds nodes from text: no innerHTML, outerHTML, insertAdjacentHTML, eval, new Function, document.write, style attribute or data: address', scripts.length >= 7 && scripts.every((js) => !/innerHTML|outerHTML|insertAdjacentHTML|\beval\s*\(|new Function|document\.write|setAttribute\(\s*['"]style|['"`]data:[a-z]/.test(js.replace(/\/\/.*$/gm, ''))))
  const needSignIn = await anon.fetch('/people')
  const badOpen = await anon.fetch('/open?t=nope')
  check('the notice pages (sign in first, link not valid) have no inline script, style or handler and use the stylesheet', noInline(await needSignIn.text()) && noInline(await badOpen.text()) && needSignIn.status === 401 && badOpen.status === 403)

  // ── 5. the owner's link ──
  group('owner bootstrap')
  const attacker = new Browser('10.0.9.2')
  const good = link({ email: 'olga@example.test' })
  const flipped = good.slice(0, -2) + (good.at(-2) === 'A' ? 'B' : 'A') + good.slice(-1)
  check('a tampered link is refused', (await attacker.fetch(flipped)).status === 403 && (await attacker.fetch('/api/me')).status === 401)
  check('an expired link is refused', (await attacker.fetch(link({ now: () => Date.now() - 3600_000 }))).status === 403)
  check('a link signed with another key is refused', (await attacker.fetch('/open?t=' + encodeURIComponent(mintOpenToken({ key: randomBytes(32) })))).status === 403)
  check('no link at all is refused', (await attacker.fetch('/open')).status === 403)
  let owner = new Browser('10.0.1.1')
  const opened = await owner.fetch(good)
  check('the good link: 303 to / with a session cookie', opened.status === 303 && opened.headers.get('location') === '/' && owner.has('session_token'), String(opened.status))
  const flags = opened.headers.getSetCookie().find((c) => c.includes('session_token')) ?? ''
  check('the session cookie is HttpOnly and SameSite=Lax (no Secure on http)', /HttpOnly/i.test(flags) && /SameSite=Lax/i.test(flags) && !/Secure/i.test(flags))
  check('the same link a second time is refused', (await attacker.fetch(good)).status === 403 && (await attacker.fetch('/api/me')).status === 401)
  const me = await owner.j('/api/me')
  check('/api/me says owner, with the address from the link, password not set', me.status === 200 && me.body.role === 'owner' && me.body.email === 'olga@example.test' && me.body.passwordSet === false)
  check('the owner sets their own password once', (await owner.j('/api/me/password', { method: 'POST', json: { password: 'short' } })).status === 400 && (await owner.j('/api/me/password', { method: 'POST', json: { password: PW.owner1 } })).status === 200)
  check('a second set is refused', (await owner.j('/api/me/password', { method: 'POST', json: { password: PW.owner2 } })).status === 409)
  // break-glass: another link, no master password
  const second = new Browser('10.0.1.2')
  check('break-glass: a fresh link signs the owner in again…', (await second.fetch(link())).status === 303 && (await second.j('/api/me')).body?.role === 'owner')
  check('…ends every other session…', (await owner.fetch('/api/me')).status === 401)
  check('…and allows one new password', (await second.j('/api/me')).body.passwordSet === false && (await second.j('/api/me/password', { method: 'POST', json: { password: PW.owner2 } })).status === 200)
  owner = new Browser('10.0.1.3')
  check('wrong password refused (401)', (await signIn(owner, 'olga@example.test', 'wrong-password-123')).status === 401)
  check('the old password no longer works', (await signIn(owner, 'olga@example.test', PW.owner1)).status === 401)
  check('real HTTP: sign-in with the new password, then /api/me', (await signIn(owner, 'olga@example.test', PW.owner2)).status === 200 && (await owner.j('/api/me')).body?.role === 'owner')
  check('the session survives GET get-session', (await owner.fetch('/api/auth/get-session')).status === 200)

  // ── 6. the owner's data, over the door ──
  group('owner: apps, relations, attribution')
  const list = await owner.j('/api/apps')
  check('the owner lists both apps with every table', list.status === 200 && list.body.apps.map((a) => a.slug).join() === 'ledger,shop' && list.body.apps.find((a) => a.slug === 'shop').objects.length === 4)
  const ownerContacts = await records(owner, 'contact')
  check('the owner sees every field, personal and sensitive ones in clear', ownerContacts.records[0].values.phone === '0102030405' && ownerContacts.records[0].values.iban === 'FR7612345')
  const adaId = ownerContacts.records[0].id
  const candleId = (await records(owner, 'product')).records[0].id
  const created = await write(owner, { title: '#2001', contact: adaId, product: candleId }, 'orders', 'create')
  check('the owner creates an order linked to a contact and a product', created.status === 200 && created.body.ok === true, created.status + ' ' + JSON.stringify(created.body).slice(0, 100))
  const orderId = created.body.record.id
  const orders = await records(owner, 'orders')
  check('the owner lists the orders', orders.records.length === 2 && orders.records.some((r) => r.id === orderId))
  const links = (await api(owner, 'shop', 'links?object=contact&id=' + adaId)).body
  const g = links.groups.find((x) => x.object === 'orders')
  check('the relation is seen from the other side (contact -> Orders)', g !== undefined && g.count === 1 && g.records[0].id === orderId, JSON.stringify(links).slice(0, 100))
  check('an unknown app is a 404, a bad slug too', (await owner.fetch('/api/apps/nothing/records?object=x')).status === 404 && (await owner.fetch('/api/apps/..%2Fetc/records?object=x')).status === 404)
  check('an unknown table is a 404', (await api(owner, 'shop', 'records?object=ghost')).status === 404)
  check('a write names no database: a smuggled db id is ignored', (await api(owner, 'shop', 'write', { method: 'POST', json: { db: ledgerId, object: 'orders', op: 'create', values: { title: '#2002' } } })).status === 200 && (await records(owner, 'orders')).records.length === 3)

  // ── 7. invitations ──
  group('invitations')
  const inviter = await owner.j('/api/people/invitations', { method: 'POST', json: { email: ' Max@Example.test ', role: 'member' } })
  check('invite by e-mail: the default mailer sends nothing, the owner gets the link', inviter.status === 200 && inviter.body.sent === false && typeof inviter.body.link === 'string' && inviter.body.invitation.email === 'max@example.test')
  const tokenOf = (l) => new URL(l).searchParams.get('t')
  const maxToken = tokenOf(inviter.body.link)
  const byLink = await owner.j('/api/people/invitations', { method: 'POST', json: { role: 'viewer' } })
  check('invite by link: no address', byLink.status === 200 && byLink.body.invitation.email === null && typeof byLink.body.link === 'string')
  const people = await owner.j('/api/people')
  check('the people list: the owner, two pending invitations, the profile ids of the apps', people.body.members.length === 1 && people.body.invitations.length === 2 && people.body.roles.map((r) => r.id).join() === 'member,viewer')
  check('"owner" cannot be invited, an unknown profile neither, nor a bad address', (await owner.j('/api/people/invitations', { method: 'POST', json: { role: 'owner' } })).status === 400 && (await owner.j('/api/people/invitations', { method: 'POST', json: { role: 'ghost' } })).status === 400 && (await owner.j('/api/people/invitations', { method: 'POST', json: { email: 'nope', role: 'member' } })).status === 400)
  const stranger = new Browser('10.0.9.3')
  const page = await stranger.fetch('/invite?t=' + encodeURIComponent(maxToken))
  const pageHtml = await page.text()
  check('the invitation page is plain html with the address, no inline script or style, and the stylesheet', page.status === 200 && pageHtml.includes('max@example.test') && noInline(pageHtml) && pageHtml.includes('href="/app.css"') && /name="_csrf"/.test(pageHtml))
  check('a tampered invitation is refused', (await stranger.j('/api/invitations/accept', { method: 'POST', json: { token: maxToken.slice(0, -3) + 'abc', password: PW.member } })).status === 400)
  check('a weak password is refused and does not spend the invitation', (await stranger.j('/api/invitations/accept', { method: 'POST', json: { token: maxToken, password: 'short' } })).status === 400)
  const m1 = new Browser('10.0.2.1')
  const acc = await m1.j('/api/invitations/accept', { method: 'POST', json: { token: maxToken, email: 'someone-else@example.test', name: 'Max', password: PW.member } })
  check('accepted: signed in as the invited profile', acc.status === 200 && acc.body.role === 'member' && m1.has('session_token'))
  const meM1 = await m1.j('/api/me')
  check('the address is the one the invitation was made for, not the one sent', meM1.body.email === 'max@example.test' && meM1.body.role === 'member' && meM1.body.passwordSet === undefined)
  check('the invitation is spent', (await stranger.j('/api/invitations/accept', { method: 'POST', json: { token: maxToken, password: PW.member } })).status === 400)
  // by link: whoever holds it joins; the profile changed before it was used is the profile given
  const viewerToken = tokenOf(byLink.body.link)
  check('changing the profile of a pending invitation (not to owner)', (await owner.j('/api/people/invitations/' + byLink.body.invitation.id, { method: 'PATCH', json: { role: 'owner' } })).status === 400 && (await owner.j('/api/people/invitations/' + byLink.body.invitation.id, { method: 'PATCH', json: { role: 'member' } })).status === 200)
  const resent = await owner.j('/api/people/invitations/' + byLink.body.invitation.id + '/resend', { method: 'POST', json: {} })
  check('a resend makes a new link and kills the old one', resent.status === 200 && tokenOf(resent.body.link) !== viewerToken && (await stranger.j('/api/invitations/accept', { method: 'POST', json: { token: viewerToken, email: 'vera@example.test', password: PW.member } })).status === 400)
  check('the profile is changed back before use', (await owner.j('/api/people/invitations/' + byLink.body.invitation.id, { method: 'PATCH', json: { role: 'viewer' } })).status === 200)
  const m2 = new Browser('10.0.2.2')
  check('a link-only invitation needs an address', (await m2.j('/api/invitations/accept', { method: 'POST', json: { token: tokenOf(resent.body.link), password: PW.member } })).status === 400)
  const acc2 = await m2.j('/api/invitations/accept', { method: 'POST', json: { token: tokenOf(resent.body.link), email: 'vera@example.test', name: 'Vera', password: PW.member } })
  check('accepted with the profile it has now (viewer)', acc2.status === 200 && acc2.body.role === 'viewer' && (await m2.j('/api/me')).body.role === 'viewer')
  const gone = await owner.j('/api/people/invitations', { method: 'POST', json: { email: 'gone@example.test', role: 'member' } })
  check('a revoked invitation cannot be used', (await owner.j('/api/people/invitations/' + gone.body.invitation.id, { method: 'DELETE' })).status === 200 && (await stranger.j('/api/invitations/accept', { method: 'POST', json: { token: tokenOf(gone.body.link), password: PW.member } })).status === 400)
  // the html path: page, form post with the token in the form
  const formInv = await owner.j('/api/people/invitations', { method: 'POST', json: { email: 'fay@example.test', role: 'member' } })
  const m3 = new Browser('10.0.2.3')
  const formPage = await (await m3.fetch('/invite?t=' + encodeURIComponent(tokenOf(formInv.body.link)))).text()
  const posted = await m3.fetch('/invite', { method: 'POST', form: { token: tokenOf(formInv.body.link), name: 'Fay', password: PW.member } })
  check('the invitation form posts (urlencoded + _csrf) and signs the person in', formPage.includes('fay@example.test') && posted.status === 303 && m3.has('session_token') && (await m3.j('/api/me')).body?.email === 'fay@example.test')
  const peoplePage = await owner.fetch('/people')
  const peopleHtml = await peoplePage.text()
  check('the owner’s people page lists the team and offers the actions', peoplePage.status === 200 && peopleHtml.includes('max@example.test') && peopleHtml.includes('vera@example.test') && peopleHtml.includes('/remove') && noInline(peopleHtml) && peopleHtml.includes('href="/app.css"'))
  check('a member gets no people page and no people API', (await m1.fetch('/people')).status === 403 && (await m1.fetch('/api/people')).status === 403 && (await m1.j('/api/people/invitations', { method: 'POST', json: { role: 'member' } })).status === 403)
  const formRole = peopleHtml.match(/action="(\/people\/members\/[^"/]+\/role)"/)
  check('the page changes a profile through its form (owner stays owner)', formRole !== null && (await owner.fetch(formRole[1], { method: 'POST', form: { role: 'viewer' } })).status === 200 && (await owner.j('/api/people')).body.members.filter((m) => m.role === 'viewer').length === 2)
  await owner.fetch(formRole[1], { method: 'POST', form: { role: 'member' } })

  // ── 8. the rights matrix over http ──
  group('rights matrix (e-commerce profile)')
  const mList = await m1.j('/api/apps')
  check('a member lists only the apps they have a profile in, and only the tables of their grants', mList.body.apps.map((a) => a.slug).join() === 'shop' && mList.body.apps[0].objects.map((o) => o.key).sort().join() === 'contact,note,orders,product')
  const mContacts = await records(m1, 'contact')
  const raw2 = JSON.stringify(mContacts) + JSON.stringify(mList.body) + JSON.stringify((await api(m1, 'shop', 'links?object=contact&id=' + adaId)).body)
  check('a member reads orders', (await records(m1, 'orders')).records.length === 3)
  check('a member reads contacts without phone and iban — not as a key, not as a value, anywhere', mContacts.ok && mContacts.records[0].values.email === 'ada@example.com' && !('phone' in mContacts.records[0].values) && !('iban' in mContacts.records[0].values) && !raw2.includes('0102030405') && !raw2.includes('FR7612345'))
  check('a member edits an order', (await write(m1, { title: '#2001 rush' }, 'orders', 'update', orderId)).status === 200 && (await records(owner, 'orders')).records.find((r) => r.id === orderId).values.title === '#2001 rush')
  check('a member creates an order and a note', (await write(m1, { title: '#3001' }, 'orders', 'create')).status === 200 && (await write(m1, { body: 'Call back' }, 'note', 'create')).status === 200)
  check('a member edits product.stock…', (await write(m1, { stock: 3 }, 'product', 'update', candleId)).status === 200 && (await records(owner, 'product')).records[0].values.stock === 3)
  const priceTry = await write(m1, { price: 1 }, 'product', 'update', candleId)
  const bothTry = await write(m1, { stock: 2, price: 1 }, 'product', 'update', candleId)
  const prodNow = (await records(owner, 'product')).records[0].values
  check('…and nothing else of the product: price refused (403), a mixed write changes nothing', priceTry.status === 403 && bothTry.status === 403 && prodNow.price === 12 && prodNow.stock === 3, priceTry.status + '/' + bothTry.status)
  check('a member cannot create a product', (await write(m1, { title: 'New' }, 'product', 'create')).status === 403)
  check('a member cannot write the hidden phone or iban', (await write(m1, { phone: '1' }, 'contact', 'update', adaId)).status === 403 && (await write(m1, { iban: 'x' }, 'contact', 'update', adaId)).status === 403 && (await records(owner, 'contact')).records[0].values.iban === 'FR7612345')
  check('a member cannot delete a contact, an order or restore anything', (await write(m1, undefined, 'contact', 'delete', adaId)).status === 403 && (await write(m1, undefined, 'orders', 'delete', orderId)).status === 403 && (await write(m1, undefined, 'orders', 'restore', orderId)).status === 403 && (await records(owner, 'contact')).records.length === 1)
  const before = JSON.stringify((await owner.j('/api/apps')).body.apps.find((a) => a.slug === 'shop').objects.map((o) => [o.key, o.fields.map((f) => f.key), o.views]))
  const attempts = [
    write(m1, undefined, 'orders', 'addField'), write(m1, { key: 'x' }, 'orders', 'view'),
    m1.j('/api/apps/shop/view', { method: 'POST', json: { object: 'orders', op: 'save', view: { id: 'x', name: 'X', kind: 'table' } } }),
    m1.j('/api/apps/shop', { method: 'DELETE' }), m1.j('/api/apps/shop/app', { method: 'POST', json: { op: 'archive' } }), m1.j('/api/apps/shop/impact?object=orders'),
  ]
  const results = await Promise.all(attempts)
  const after = JSON.stringify((await owner.j('/api/apps')).body.apps.find((a) => a.slug === 'shop').objects.map((o) => [o.key, o.fields.map((f) => f.key), o.views]))
  check('a member cannot change a view, the structure or the app: nothing is reachable, nothing changed', results.every((r) => r.status >= 400 && r.status < 500) && before === after, results.map((r) => r.status).join())
  check('a member cannot read an app without a profile of theirs', (await api(m1, 'ledger', 'records?object=entry')).status === 403 && (await api(m1, 'ledger', 'write', { method: 'POST', json: { object: 'entry', op: 'create', values: { label: 'x' } } })).status === 403)
  const doomed = (await write(owner, { body: 'to be deleted' }, 'note', 'create')).body.record.id
  await write(owner, undefined, 'note', 'delete', doomed)
  check('a member cannot read what was deleted (the owner can)', (await records(owner, 'note')).records.every((r) => r.id !== doomed) && (await api(owner, 'shop', 'records?object=note&deleted=1')).body.records.some((r) => r.id === doomed) && !JSON.stringify((await api(m1, 'shop', 'records?object=note&deleted=1')).body).includes(doomed))
  check('a member cannot hand the server a richer profile or role', (await api(m1, 'shop', 'write', { method: 'POST', json: { object: 'contact', op: 'update', id: adaId, values: { phone: '9' }, profile: { id: 'member', grants: [{ object: 'contact', do: ['update'], fields: { phone: 'write' } }] }, role: 'owner', actor: { kind: 'person', role: 'owner' } }, headers: { 'x-role': 'owner' } })).status === 403)
  check('a member cannot reach the owner’s routes by their own id', (await m1.j('/api/people/members/' + meM1.body.id, { method: 'PATCH', json: { role: 'owner' } })).status === 403 && (await m1.j('/api/me/password', { method: 'POST', json: { password: 'owner-password-x' } })).status === 403)
  const vOrders = await records(m2, 'orders')
  check('a viewer reads orders and products, no other table', vOrders.ok && (await records(m2, 'product')).ok && (await api(m2, 'shop', 'records?object=contact')).status === 403 && (await api(m2, 'shop', 'records?object=note')).status === 403)
  check('a viewer cannot create or update anything', (await write(m2, { title: 'x' }, 'orders', 'create')).status === 403 && (await write(m2, { title: 'x' }, 'orders', 'update', orderId)).status === 403 && (await write(m2, { stock: 1 }, 'product', 'update', candleId)).status === 403)

  // in-place editing: an update may name the revision it read, and a row that has moved on is a conflict (the door has no such precondition; the edge checks it)
  const withRev = (b, object, id, values, rev) => api(b, 'shop', 'write', { method: 'POST', json: { object, op: 'update', id, values, rev } })
  const titleNow = async () => (await records(owner, 'orders')).records.find((r) => r.id === orderId)
  const read0 = await titleNow()
  const revOk = await withRev(m1, 'orders', orderId, { title: '#2001 by revision' }, read0.rev)
  check('an update that names the revision it read is applied, and answers the next revision', revOk.status === 200 && revOk.body.record.values.title === '#2001 by revision' && revOk.body.record.rev === read0.rev + 1, revOk.status + ' ' + revOk.body?.record?.rev + '/' + read0.rev)
  const revStale = await withRev(owner, 'orders', orderId, { title: '#2001 from a stale read' }, read0.rev)
  const read1 = await titleNow()
  check('the same revision again is a conflict (409, « conflict », the current revision) and nothing is written', revStale.status === 409 && revStale.body.ok === false && revStale.body.error === 'conflict' && revStale.body.rev === read1.rev && read1.values.title === '#2001 by revision' && read1.rev === read0.rev + 1, revStale.status + ' ' + JSON.stringify(revStale.body))
  const revMixed = await withRev(m1, 'orders', orderId, { title: '#2001 mixed', status: read1.values.status }, read0.rev)
  check('a member with a stale revision is refused the same way, whatever the fields', revMixed.status === 409 && (await titleNow()).values.title === '#2001 by revision')
  const revNone = await write(owner, { title: '#2001 no revision' }, 'orders', 'update', orderId)
  check('an update with no revision is last-writer-wins, as before', revNone.status === 200 && (await titleNow()).values.title === '#2001 no revision')
  const revBad = await Promise.all([withRev(owner, 'orders', orderId, { title: 'x' }, '3'), withRev(owner, 'orders', orderId, { title: 'x' }, 0), withRev(owner, 'orders', orderId, { title: 'x' }, 1.5), withRev(owner, 'orders', orderId, { title: 'x' }, null)])
  check('a revision that is not a whole number from 1 is refused (400) and nothing is written', revBad.every((r) => r.status === 400) && (await titleNow()).values.title === '#2001 no revision', revBad.map((r) => r.status).join())
  const cur = await titleNow()
  const revRights = [await withRev(m1, 'product', candleId, { price: 1 }, (await records(owner, 'product')).records[0].rev), await withRev(m2, 'orders', orderId, { title: 'x' }, cur.rev), await withRev(m1, 'orders', 'NOT-A-ROW', { title: 'x' }, 1)]
  check('naming a current revision opens nothing: a field the profile refuses (403), a viewer (403), an unknown row (404)', revRights.map((r) => r.status).join() === '403,403,404' && (await titleNow()).values.title === '#2001 no revision', revRights.map((r) => r.status).join())

  // the journal says who: the owner as « person », a member as member:<id>
  const spy = makeService({ dir: join(data, 'apps', 'shop') })
  const j = spy.byId(shopId).db.journal({ object: 'orders', record: orderId })
  const bys = j.map((e) => e.by)
  spy.close()
  check('the journal names who wrote: the owner as « person », the member as member:<user id>', bys.includes('person') && bys.includes('member:' + meM1.body.id), JSON.stringify(bys))

  // ── 9. files ──
  group('files')
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082', 'hex')
  const up = await owner.j('/api/apps/shop/upload?object=contact&field=photo&name=ada.png', { method: 'POST', body: png, headers: { 'content-type': 'image/png' } })
  check('the owner uploads a picture for an attachment field', up.status === 200 && up.body.ok === true, up.status + ' ' + JSON.stringify(up.body).slice(0, 120))
  if (up.body?.ok) {
    await write(owner, { photo: [up.body.file] }, 'contact', 'update', adaId)
    const file = await owner.fetch('/api/apps/shop/file?object=contact&id=' + adaId + '&field=photo&hash=' + up.body.file.hash)
    const bytes = Buffer.from(await file.arrayBuffer())
    check('it comes back as a picture (type from its bytes), sandboxed and not cached', file.status === 200 && file.headers.get('content-type') === 'image/png' && file.headers.get('x-content-type-options') === 'nosniff' && bytes.equals(png) && /sandbox/.test(file.headers.get('content-security-policy') ?? '') && /no-store/.test(file.headers.get('cache-control') ?? ''))
    const mfile = await m1.fetch('/api/apps/shop/file?object=contact&id=' + adaId + '&field=photo&hash=' + up.body.file.hash)
    check('a member whose profile shows the field gets it too', mfile.status === 200)
    check('a member cannot upload into a field they only read', (await m1.j('/api/apps/shop/upload?object=product&field=photo&name=x.png', { method: 'POST', body: png, headers: { 'content-type': 'image/png' } })).status === 403)
    check('a wrong hash is a 404', (await owner.fetch('/api/apps/shop/file?object=contact&id=' + adaId + '&field=photo&hash=' + '0'.repeat(64))).status === 404)
  }
  const html = Buffer.from('<script>alert(1)</script>')
  const upHtml = await owner.j('/api/apps/shop/upload?object=contact&field=photo&name=evil.html', { method: 'POST', body: html, headers: { 'content-type': 'text/html' } })
  if (upHtml.body?.ok) {
    await write(owner, { photo: [upHtml.body.file] }, 'contact', 'update', adaId)
    const served = await owner.fetch('/api/apps/shop/file?object=contact&id=' + adaId + '&field=photo&hash=' + upHtml.body.file.hash)
    check('anything that is not a raster picture is a download, never page content', served.headers.get('content-type') !== 'text/html' && /^attachment/.test(served.headers.get('content-disposition') ?? ''))
  } else check('a non-picture upload is refused by the field, or served as a download', upHtml.status >= 400, String(upHtml.status))
  // the server answers an oversize body before reading it and then drops that connection: such a request gets a connection of its own, so that the shared pool never reuses a dead one
  const big = await lone('/api/apps/shop/write', { method: 'POST', body: JSON.stringify({ object: 'note', op: 'create', values: { body: 'x'.repeat(1.2 * 1024 * 1024) } }), headers: { 'content-type': 'application/json', cookie: owner.cookie, origin: BASE, 'x-csrf-token': await owner.csrf(), 'x-forwarded-for': owner.ip } })
  check('a JSON body over 1 MiB is refused (413)', big.status === 413, JSON.stringify(big))

  // ── 10. removal ──
  group('removal')
  const meV = await m2.j('/api/me')
  check('the owner removes a member', (await owner.j('/api/people/members/' + meV.body.id, { method: 'DELETE' })).status === 200)
  check('their very next request is 401', (await m2.fetch('/api/me')).status === 401 && (await m2.fetch('/api/apps')).status === 401)
  check('they cannot sign in again', (await signIn(new Browser('10.0.2.9'), 'vera@example.test', PW.member)).status === 401)
  check('the owner cannot be removed, nor remove themselves', (await owner.j('/api/people/members/' + (await owner.j('/api/me')).body.id, { method: 'DELETE' })).status === 403)
  const again = await owner.j('/api/people/invitations', { method: 'POST', json: { email: 'vera@example.test', role: 'viewer' } })
  const m2b = new Browser('10.0.2.8')
  check('the same person can be invited again', again.status === 200 && (await m2b.j('/api/invitations/accept', { method: 'POST', json: { token: tokenOf(again.body.link), name: 'Vera', password: PW.member } })).status === 200)
  check('a member signs in with their own password, and signs out for good', (await signIn(new Browser('10.0.2.7'), 'max@example.test', PW.member)).status === 200)
  const out = await m1.fetch('/api/auth/sign-out', { method: 'POST', json: {} })
  const stale = m1.cookie
  check('sign-out 200, and the old cookie no longer works', out.status === 200 && (await fetch(BASE + '/api/me', { headers: { cookie: stale } })).status === 401)

  // ── 11. CSRF, Origin, cookies ──
  group('CSRF, Origin, cookies')
  const csrfPost = (b, o = {}) => b.fetch('/api/apps/shop/write', { method: 'POST', json: { object: 'note', op: 'create', values: { body: 'csrf' } }, ...o })
  const before2 = (await records(owner, 'note')).records.length
  check('a foreign Origin is refused', (await csrfPost(owner, { origin: 'https://evil.example' })).status === 403)
  check('no Origin at all is refused', (await csrfPost(owner, { origin: null })).status === 403)
  check('the right Origin without a token is refused', (await csrfPost(owner, { csrf: false })).status === 403)
  check('a wrong token is refused', (await csrfPost(owner, { headers: { 'x-csrf-token': 'AAAA' } })).status === 403)
  const other = new Browser('10.0.9.4')
  check('a token made for another browser is refused', (await csrfPost(owner, { headers: { 'x-csrf-token': await other.csrf() } })).status === 403)
  check('sign-in from a foreign Origin is refused', (await new Browser('10.0.9.5').fetch('/api/auth/sign-in/email', { method: 'POST', json: { email: 'olga@example.test', password: PW.owner2 }, origin: 'https://evil.example' })).status === 403)
  check('nothing was written by the refused calls', (await records(owner, 'note')).records.length === before2)
  check('the right Origin and token pass', (await csrfPost(owner)).status === 200)
  const c1 = await new Browser('10.0.9.6').fetch('/api/csrf')
  const csrfCookie = c1.headers.getSetCookie()[0] ?? ''
  check('the CSRF cookie is HttpOnly and SameSite=Lax', /HttpOnly/i.test(csrfCookie) && /SameSite=Lax/i.test(csrfCookie) && csrfCookie.startsWith('kb_csrf='))

  // the https instance: same code in-process, a public https address
  const httpsData = join(root, 'data-https')
  mkdirSync(httpsData, { recursive: true })
  const secure = await buildApp({ dataDir: httpsData, authSecret, bootKey, publicUrl: 'https://team.example.com' })
  const sc = await secure.app.request('https://team.example.com/api/csrf')
  const csrfSecure = sc.headers.getSetCookie()[0] ?? ''
  check('on https the CSRF cookie is __Host- prefixed and Secure', csrfSecure.startsWith('__Host-kb_csrf=') && /; Secure/i.test(csrfSecure) && /HttpOnly/i.test(csrfSecure) && /SameSite=Lax/i.test(csrfSecure))
  const so = await secure.app.request('https://team.example.com' + link())
  const sess = so.headers.getSetCookie().find((c) => c.includes('session_token')) ?? ''
  check('on https the session cookie is Secure, HttpOnly, SameSite=Lax; HSTS is sent', so.status === 303 && /; Secure/i.test(sess) && /HttpOnly/i.test(sess) && /SameSite=Lax/i.test(sess) && /max-age/.test(so.headers.get('strict-transport-security') ?? ''), sess.slice(0, 40))
  check('the https instance refuses the http origin', (await secure.app.request('https://team.example.com/api/csrf', { method: 'POST', headers: { origin: BASE, 'x-csrf-token': 'x' } })).status === 403)
  secure.close()

  // ── 12. the owner's API token and the transfer routes ──
  group('owner API token')
  const { mintOwnerApiToken, signToken } = await import(pathToFileURL(join(app, 'lib', 'token.mjs')).href)
  const mint = (o = {}) => { const t = mintOwnerApiToken({ key: bootKey, ...o }); issued.push(t); return t }
  const sha = (b) => createHash('sha256').update(b).digest('hex')
  let nextIp = 0
  /** One machine call: a bearer and nothing else (no cookie, no Origin, no CSRF), from an address of its own. `token: null` sends no Authorization at all. */
  const machine = (path, { method = 'GET', token = mint(), body, json, headers = {}, ip = '10.0.8.' + (nextIp++ % 250 + 1) } = {}) => {
    const h = { 'x-forwarded-for': ip, ...headers }
    if (token !== null) h.authorization = 'Bearer ' + token
    let payload = body
    if (json !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(json) }
    return fetch(BASE + path, { method, headers: h, body: payload, redirect: 'manual' })
  }
  const mj = async (path, o) => { const r = await machine(path, o); return { status: r.status, body: await r.json().catch(() => null), headers: r.headers } }
  const put = (slug, bytes, o = {}) => mj('/api/apps/' + slug + '/bundle', { method: 'PUT', body: bytes, headers: { 'content-type': 'application/octet-stream' }, ...o })
  const slugsNow = async () => (await owner.j('/api/apps')).body.apps.map((a) => a.slug).join()

  const viaBearer = await mj('/api/me')
  check('a bearer alone acts as the owner: /api/me', viaBearer.status === 200 && viaBearer.body.role === 'owner' && viaBearer.body.email === 'olga@example.test', JSON.stringify(viaBearer.body))
  check('…and sets no cookie', (await machine('/api/me')).headers.getSetCookie().length === 0)
  check('it lists the apps', (await mj('/api/apps')).body?.apps?.map((a) => a.slug).join() === 'ledger,shop')
  const fpCookie = await owner.j('/api/apps/shop/fingerprint')
  const fpBearer = await mj('/api/apps/shop/fingerprint')
  check('the fingerprint route: a cheap { ok, fingerprint }, the same for the owner’s session and the owner’s bearer', fpBearer.status === 200 && fpBearer.body.ok === true && /^\d+\.\d+\.\d+\.\d+$/.test(fpBearer.body.fingerprint) && fpCookie.body.fingerprint === fpBearer.body.fingerprint, JSON.stringify(fpBearer.body))
  const notesBefore = (await records(owner, 'note')).records.length
  const bearerWrite = await mj('/api/apps/shop/write', { method: 'POST', json: { object: 'note', op: 'create', values: { body: 'written with the owner token' } } })
  check('a bearer writes with no Origin and no CSRF token (it has no cookie to ride on)', bearerWrite.status === 200 && bearerWrite.body.ok === true && (await records(owner, 'note')).records.length === notesBefore + 1, JSON.stringify(bearerWrite.body).slice(0, 100))
  check('the journal names the bearer as « person », the owner', new Set((() => { const s = makeService({ dir: join(data, 'apps', 'shop') }); try { return s.byId(shopId).db.journal({ object: 'note', record: bearerWrite.body.record.id }).map((e) => e.by) } finally { s.close() } })()).has('person'))
  const fpAfter = await mj('/api/apps/shop/fingerprint')
  check('the fingerprint moved with the write', fpAfter.body.fingerprint !== fpBearer.body.fingerprint)
  const edgeHeaders = (await machine('/api/me')).headers
  check('a bearer answer carries the same security headers', edgeHeaders.get('x-content-type-options') === 'nosniff' && /frame-ancestors 'none'/.test(edgeHeaders.get('content-security-policy') ?? '') && edgeHeaders.get('referrer-policy') === 'no-referrer')

  group('owner API token: what is refused')
  const refusals = {
    expired: mint({ now: () => Date.now() - 3600_000 }),
    forged: (() => { const t = mint(); return t.slice(0, -2) + (t.at(-2) === 'A' ? 'B' : 'A') + t.slice(-1) })(),
    'another key': mintOwnerApiToken({ key: randomBytes(32) }),
    'an owner link': mintOpenToken({ key: bootKey }),
    'a token that claims an hour': signToken('owner-api', { n: 'x', i: Math.floor(Date.now() / 1000) }, bootKey, { ttlSec: 3600 }),
    'a token with no issue time': signToken('owner-api', { n: 'x' }, bootKey, { ttlSec: 60 }),
    'a token about to be issued': mint({ now: () => Date.now() + 3600_000 }),
    garbage: 'not.a.token',
    empty: '',
  }
  for (const [what, token] of Object.entries(refusals)) issued.push(token)
  const refusedAll = []
  for (const [what, token] of Object.entries(refusals)) {
    const r = await machine('/api/me', { token })
    refusedAll.push([what, r.status, r.headers.get('www-authenticate'), r.headers.getSetCookie().length])
  }
  check('expired, forged, another key, the owner’s link, a longer life, no issue time, a future one, garbage, nothing: all 401 with WWW-Authenticate: Bearer', refusedAll.every(([, status, auth, cookies]) => status === 401 && auth === 'Bearer' && cookies === 0), JSON.stringify(refusedAll.filter(([, s]) => s !== 401)))
  check('a refused bearer reaches no data and does no write', (await machine('/api/apps/shop/write', { method: 'POST', token: refusals.forged, json: { object: 'note', op: 'create', values: { body: 'nope' } } })).status === 401 && (await records(owner, 'note')).records.length === notesBefore + 1)
  check('no Authorization header at all is anonymous: 401', (await machine('/api/apps/shop/fingerprint', { token: null })).status === 401)
  check('another scheme (Basic) is not a bearer and gives nothing', (await machine('/api/me', { token: null, headers: { authorization: 'Basic ' + Buffer.from('owner:password').toString('base64') } })).status === 401)
  const owner2 = new Browser('10.0.1.9')
  await signIn(owner2, 'olga@example.test', PW.owner2)
  check('an owner session, a bad bearer: refused (401), the bad bearer never falls back to the cookie', (await owner2.fetch('/api/me', { headers: { authorization: 'Bearer ' + refusals.forged } })).status === 401 && (await owner2.fetch('/api/me', { headers: { authorization: 'Bearer ' + refusals.expired } })).status === 401 && (await owner2.fetch('/api/me')).status === 200)
  check('an owner session, a good bearer: cookie-authenticated, so Origin and CSRF stay in force', (await owner2.fetch('/api/apps/shop/write', { method: 'POST', json: { object: 'note', op: 'create', values: { body: 'x' } }, csrf: false, headers: { authorization: 'Bearer ' + mint() } })).status === 403 && (await owner2.fetch('/api/apps/shop/write', { method: 'POST', json: { object: 'note', op: 'create', values: { body: 'x' } }, origin: null, headers: { authorization: 'Bearer ' + mint() } })).status === 403 && (await owner2.fetch('/api/apps/shop/write', { method: 'POST', json: { object: 'note', op: 'create', values: { body: 'x' } }, origin: 'https://evil.example', headers: { authorization: 'Bearer ' + mint() } })).status === 403)
  const vera = m2b
  const veraMe = await vera.j('/api/me', { headers: { authorization: 'Bearer ' + mint() } })
  check('a member session with the owner’s bearer stays a member (the bearer gives nothing on top of a cookie)', veraMe.status === 200 && veraMe.body.role === 'viewer' && (await vera.fetch('/api/apps/shop/snapshot', { headers: { authorization: 'Bearer ' + mint() } })).status === 403)
  const scopeRefusals = [await machine('/api/people'), await machine('/api/people/invitations', { method: 'POST', json: { role: 'member' } }), await machine('/api/me/password', { method: 'POST', json: { password: 'owner-password-new1' } }), await machine('/people'), await machine('/api/csrf'), await machine('/api/auth/sign-out', { method: 'POST', json: {} })]
  check('a bearer is for the apps routes only: not the people, the password, the pages or sign-in (403)', scopeRefusals.every((r) => r.status === 403), scopeRefusals.map((r) => r.status).join())
  const pageRefusals = []
  for (const path of ['/', '/app.css', '/favicon.svg', '/js/main.mjs', '/invite']) pageRefusals.push(await machine(path))
  const pageBad = await machine('/app.css', { token: 'not-a-token' })
  check('a bearer reaches neither the files of the page nor the invitation page (403, no file in the answer); a bad one is 401', pageRefusals.every((r) => r.status === 403 && !(r.headers.get('content-type') ?? '').includes('javascript') && !(r.headers.get('content-type') ?? '').includes('css') && !(r.headers.get('content-type') ?? '').includes('html')) && pageBad.status === 401, pageRefusals.map((r) => r.status).join())
  check('and the same files stay public GETs for anyone who sends no token', (await Promise.all(['/', '/app.css', '/js/main.mjs'].map((a) => anon.fetch(a)))).every((r) => r.status === 200))
  check('and the owner’s password was not touched', (await signIn(new Browser('10.0.1.10'), 'olga@example.test', PW.owner2)).status === 200)

  // ── 12a. what the server that hosts the space asks of it: when a member last used it, and a freeze ──
  group('the hosting server: activity and freeze')
  const lastSeen = async () => (await mj('/api/apps')).body?.last_request_at
  const seen1 = await lastSeen()
  check('the owner’s token is told when a member last used the space, as an ISO time', typeof seen1 === 'string' && new Date(seen1).toISOString() === seen1, String(seen1))
  await sleep(40)
  await Promise.all([mj('/api/me'), mj('/api/apps'), mj('/api/apps/shop/fingerprint')])
  check('its own calls (the token) are not a member’s use: the time did not move', (await lastSeen()) === seen1)
  await anon.fetch('/api/me')
  await anon.fetch('/api/apps')
  check('nor is a request with no session (a visitor, a scanner)', (await lastSeen()) === seen1)
  check('a member’s request moves it', (await vera.j('/api/me')).status === 200 && (await lastSeen()) > seen1)
  const viewOf = async (b) => (await b.j('/api/apps')).body
  check('a person (a member, or the owner in a browser) is not told when the others last came', (await viewOf(vera))?.ok === true && (await viewOf(vera)).last_request_at === undefined && (await viewOf(owner)).last_request_at === undefined)

  const writeNote = (via, body) => (via === 'token'
    ? mj('/api/apps/shop/write', { method: 'POST', json: { object: 'note', op: 'create', values: { body } } })
    : owner.j('/api/apps/shop/write', { method: 'POST', json: { object: 'note', op: 'create', values: { body } } }))
  const noteCount = async () => (await records(owner, 'note')).records.length
  const freezeCall = (json, o = {}) => mj('/api/freeze', { method: 'POST', json, ...o })
  const asCookie = await owner.j('/api/freeze', { method: 'POST', json: { frozen: true } })
  const asNobody = await machine('/api/freeze', { method: 'POST', token: null, json: { frozen: true } })
  const asForged = await machine('/api/freeze', { method: 'POST', token: refusals.forged, json: { frozen: true } })
  check('only the owner’s token can freeze: the owner’s own session (403), nobody (403) and a forged token (401) cannot', asCookie.status === 403 && asCookie.body?.reason === 'owner-api-only' && asNobody.status === 403 && asForged.status === 401, [asCookie.status, asNobody.status, asForged.status].join())
  const malformed = [await freezeCall({}), await freezeCall({ frozen: 'yes' }), await freezeCall({ frozen: 1 }), await freezeCall([true]), await mj('/api/freeze', { method: 'POST', body: 'frozen', headers: { 'content-type': 'application/json' } })]
  check('a body that is not { "frozen": true or false } is 400', malformed.every((r) => r.status === 400 && r.body?.ok === false), malformed.map((r) => r.status).join())
  check('and none of those froze anything', (await writeNote('token', 'before the freeze')).status === 200)

  const notes0 = await noteCount()
  const on = await freezeCall({ frozen: true })
  const onAgain = await freezeCall({ frozen: true })
  check('the token freezes the space: 200 { ok, frozen: true }, and asking again says the same', on.status === 200 && on.body?.ok === true && on.body.frozen === true && onAgain.status === 200 && onAgain.body.frozen === true, JSON.stringify(on.body))
  const refused = [
    await writeNote('token', 'frozen, by the token'),
    await writeNote('cookie', 'frozen, by the owner'),
    await owner.j('/api/apps/shop/upload?object=contact&field=photo&name=a.png', { method: 'POST', body: Buffer.from('x'), headers: { 'content-type': 'image/png' } }),
    await owner.j('/api/people/invitations', { method: 'POST', json: { email: 'late@example.test', role: 'member' } }),
    await owner.j('/api/apps/nothere/release', { method: 'POST', json: { confirm: 'nothere' } }),
    await put('frozen-app', Buffer.from('not a bundle')),
    await new Browser('10.0.11.2').j('/api/auth/sign-in/email', { method: 'POST', json: { email: 'nobody@example.test', password: 'whatever-1234' } }),
    await new Browser('10.0.11.3').j('/open?t=not-a-link'),
  ]
  check('while frozen every write is 503 “frozen”: rows, a file, a person, a release, a bundle, a sign-in and the owner’s link', refused.every((r) => r.status === 503 && r.body?.error === 'frozen' && r.body?.ok === false), refused.map((r) => r.status).join())
  const readsOk = [await owner.j('/api/apps'), await owner.j('/api/me'), await owner.j('/api/apps/shop/records?object=note'), await mj('/api/apps/shop/fingerprint')]
  const healthy = await anon.j('/health')
  check('reads stay up while frozen: the apps, who I am, the rows, the fingerprint and the health check', readsOk.every((r) => r.status === 200) && healthy.status === 200 && healthy.body?.ok === true)
  check('and so does the snapshot, how a restore or an Unpublish takes its last copy', (await machine('/api/apps/shop/snapshot')).status === 200)
  check('nothing was written, and nothing was released or invited', (await noteCount()) === notes0 && (await slugsNow()) === 'ledger,shop' && !(await owner.j('/api/people')).body.invitations.some((i) => i.email === 'late@example.test'))
  const off = await freezeCall({ frozen: false })
  check('the same call lifts it: 200 { ok, frozen: false }', off.status === 200 && off.body?.ok === true && off.body.frozen === false, JSON.stringify(off.body))
  check('writes go through again', (await writeNote('token', 'after the freeze')).status === 200 && (await noteCount()) === notes0 + 1)
  const caller = new Browser('10.0.11.4')
  check('and the owner’s link and sign-in answer for themselves again (a refused link is 403, a wrong password 401)', (await caller.fetch('/open?t=not-a-link')).status === 403 && (await caller.j('/api/auth/sign-in/email', { method: 'POST', json: { email: 'nobody@example.test', password: 'whatever-1234' } })).status === 401)

  // the state lives in a file: a machine that restarts while frozen comes back frozen (a bare instance on a folder of its own, no sessions needed: a write is refused 403 when free, 503 when frozen)
  const dataC = join(root, 'data-freeze')
  const portC = await new Promise((resolve) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) }) })
  const BASE_C = 'http://127.0.0.1:' + portC
  const bootC = async () => {
    const child = spawn(process.execPath, ['--no-warnings', 'server.js'], { cwd: app, env: { PATH: process.env.PATH, PORT: String(portC), KB_AUTH_SECRET: authSecret, KB_BOOT_KEY: bootHex, KB_DATA_DIR: dataC, KB_TRUST_PROXY: '1' } })
    let text = ''
    child.stdout.on('data', (d) => { text += d })
    child.stderr.on('data', (d) => { text += d })
    for (let i = 0; i < 100 && !text.includes('listening ' + portC); i++) await sleep(100)
    return { child, up: text.includes('listening ' + portC), text: () => text }
  }
  const stopC = (c) => new Promise((resolve) => { if (c.child.exitCode !== null) return resolve(); c.child.once('exit', resolve); c.child.kill('SIGTERM') })
  const tryWrite = async () => (await fetch(BASE_C + '/api/apps/x/write', { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE_C, 'x-forwarded-for': '10.0.12.2' }, body: '{}' })).status
  const hostSays = (json) => fetch(BASE_C + '/api/freeze', { method: 'POST', headers: { authorization: 'Bearer ' + mint(), 'content-type': 'application/json', 'x-forwarded-for': '10.0.12.1' }, body: JSON.stringify(json) }).then((r) => r.status)
  let inst = await bootC()
  serverC = inst.child
  check('a second instance starts on a folder of its own, not frozen', inst.up && (await tryWrite()) === 403, inst.text().slice(0, 160))
  check('the token freezes it', (await hostSays({ frozen: true })) === 200 && (await tryWrite()) === 503)
  check('the state is a private file in the data folder', existsSync(join(dataC, 'frozen.json')) && (statSync(join(dataC, 'frozen.json')).mode & 0o777) === 0o600)
  await stopC(inst)
  inst = await bootC()
  serverC = inst.child
  check('after a restart it is still frozen (a write is 503, the health check answers)', inst.up && (await tryWrite()) === 503 && (await fetch(BASE_C + '/health')).status === 200, inst.text().slice(0, 160))
  check('lifting it removes the file, and the next restart is free', (await hostSays({ frozen: false })) === 200 && !existsSync(join(dataC, 'frozen.json')) && (await tryWrite()) === 403)
  await stopC(inst)
  inst = await bootC()
  serverC = inst.child
  check('(and it did start free)', inst.up && (await tryWrite()) === 403)
  await stopC(inst)
  serverC = null

  // ── 12b. L7: what the space holds about a person, the owner's export of an app, erasure ──
  group('privacy: the page, and a person’s own data')
  const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
  const authFile = join(data, 'auth.sqlite')
  /** Runs `fn` on a connection of its own to auth.sqlite, closed at once so that the server's checkpoints are never held up by it. */
  const withAuth = (fn, readOnly = true) => { const h = new DatabaseSync(authFile, { readOnly }); try { return fn(h) } finally { h.close() } }
  const authQuery = (sql, ...args) => withAuth((h) => h.prepare(sql).all(...args))
  /** Every table of auth.sqlite as text. */
  const authDump = () => withAuth((h) => Object.fromEntries(h.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(({ name }) => [name, JSON.stringify(h.prepare('SELECT * FROM "' + name + '"').all())])))
  /** Where a text is: the tables whose rows hold it, and the file or its write-ahead log when their bytes do. */
  const whereIs = (needle) => {
    const found = Object.entries(authDump()).filter(([, text]) => text.includes(needle)).map(([name]) => name)
    for (const f of [authFile, authFile + '-wal']) if (existsSync(f) && readFileSync(f).includes(Buffer.from(needle))) found.push('file:' + f.slice(-6))
    return found
  }
  const rawToken = (b) => decodeURIComponent([...b.jar].find(([k]) => k.includes('session_token'))?.[1] ?? '').split('.')[0]
  const roleLabelOf = (people0, id) => people0.roles.find((r) => r.id === id)?.label

  const privacy = await anon.fetch('/privacy')
  const privacyHtml = await privacy.text()
  check('/privacy is public, plain html with the stylesheet and nothing inline; with nothing set it says where it lives in general words and asks the owner', privacy.status === 200 && noInline(privacyHtml) && privacyHtml.includes('href="/app.css"') && privacyHtml.includes('in the EU region your team space was created in') && privacyHtml.includes('ask the owner of this space.') && !/mailto:/.test(privacyHtml))
  check('…and claims nothing about the law', !/complian|certif|guarantee|GDPR|RGPD|legally/i.test(privacyHtml.replace(/<[^>]+>/g, ' ')))
  const inviteAgain = await anon.fetch('/invite?t=nope')
  check('the invitation page, the notices and the owner’s pages link to it; so does the sign-in screen of the page', pageHtml.includes('href="/privacy"') && (await inviteAgain.text()).includes('href="/privacy"') && peopleHtml.includes('href="/privacy"') && readFileSync(join(app, 'public', 'js', 'views.mjs'), 'utf8').includes('/privacy'))

  // three people with something to find: Zorica (two invitations for her address, a failed sign-in before she exists), and a typed password in the address box
  const people0 = (await owner.j('/api/people')).body
  const zInv1 = await owner.j('/api/people/invitations', { method: 'POST', json: { email: 'Zorica.Vukovic@Example.test', role: 'member' } })
  const zInv2 = await owner.j('/api/people/invitations', { method: 'POST', json: { email: 'zorica.vukovic@example.test', role: 'viewer' } })
  check('two invitations are made for one address', zInv1.status === 200 && zInv2.status === 200 && zInv1.body.invitation.email === 'zorica.vukovic@example.test')
  await signIn(new Browser('10.0.6.1'), 'zorica.vukovic@example.test', 'wrong-password-zz1')
  await signIn(new Browser('10.0.6.2'), 'my-typed-PASSWORD-in-the-wrong-box', 'wrong-password-zz2')
  const zo = new Browser('10.0.6.3')
  const zAcc = await zo.j('/api/invitations/accept', { method: 'POST', json: { token: tokenOf(zInv1.body.link), name: 'Zorica Vukovic', password: PW.member }, headers: { 'user-agent': CHROME } })
  const zo2 = new Browser('10.0.6.4')
  const zSign = await zo2.j('/api/auth/sign-in/email', { method: 'POST', json: { email: 'zorica.vukovic@example.test', password: PW.member }, headers: { 'user-agent': IPHONE } })
  check('she joins on one device and signs in on another', zAcc.status === 200 && zSign.status === 200 && rawToken(zo) !== '' && rawToken(zo) !== rawToken(zo2))
  const zId = (await zo.j('/api/me')).body.id
  const zNote = await write(zo, { body: 'a note from the new member' }, 'note', 'create')
  const zHash = authQuery('SELECT password FROM account WHERE userId = ?', zId)[0]?.password
  const zTokens = authQuery('SELECT token FROM session WHERE userId = ?', zId).map((r) => r.token)
  check('she has a password hash and two sessions in auth.sqlite', typeof zHash === 'string' && zHash.length > 20 && zTokens.length === 2)

  const zExp = await zo.fetch('/api/me/export')
  const zExpText = await zExp.text()
  const zExpJson = (() => { try { return JSON.parse(zExpText) } catch (e) { return {} } })()
  check('a person downloads what the space holds about them: an attachment, JSON, never cached', zExp.status === 200 && /^attachment; filename="my-data-\d{4}-\d{2}-\d{2}\.json"$/.test(zExp.headers.get('content-disposition') ?? '') && /no-store/.test(zExp.headers.get('cache-control') ?? '') && (zExp.headers.get('content-type') ?? '').startsWith('application/json'))
  check('…their name, address and profile, and their sessions as dates and a coarse device', zExpJson.person?.name === 'Zorica Vukovic' && zExpJson.person?.email === 'zorica.vukovic@example.test' && zExpJson.person?.role === 'member' && zExpJson.person?.profile === roleLabelOf(people0, 'member') && zExpJson.sessions?.length === 2 && zExpJson.sessions.map((s) => s.device).sort().join() === 'Chrome on macOS,Safari on iOS' && zExpJson.sessions.filter((s) => s.thisSession).length === 1, JSON.stringify(zExpJson.sessions))
  check('…and no token, no password hash, no network address, no user agent string', ![zHash, ...zTokens, rawToken(zo), 'Mozilla', 'AppleWebKit', '10.0.6.', 'ipAddress'].some((x) => zExpText.includes(x)))
  check('without a session the export is 401; a bearer does not reach it (403)', (await anon.fetch('/api/me/export')).status === 401 && (await machine('/api/me/export')).status === 403)
  const zAccount = await zo.fetch('/account')
  const zAccountHtml = await zAccount.text()
  check('her account page: details, a download, and the delete form with a typed confirmation, nothing inline', zAccount.status === 200 && zAccountHtml.includes('zorica.vukovic@example.test') && zAccountHtml.includes('href="/api/me/export"') && zAccountHtml.includes('action="/account/delete"') && zAccountHtml.includes('name="confirm"') && noInline(zAccountHtml) && zAccountHtml.includes('href="/privacy"'))
  const ownerAccountHtml = await (await owner.fetch('/account')).text()
  check('the owner’s page has no delete form, says why, and offers the export of each app', !ownerAccountHtml.includes('action="/account/delete"') && ownerAccountHtml.includes('cannot delete their own account') && ownerAccountHtml.includes('/api/apps/shop/export.json') && ownerAccountHtml.includes('/api/apps/ledger/export.json'))
  check('/account needs a session', (await anon.fetch('/account')).status === 401)

  group('privacy: a member deletes their own account')
  const dInv = await owner.j('/api/people/invitations', { method: 'POST', json: { email: 'dario.ortiz@example.test', role: 'member' } })
  const dario = new Browser('10.0.6.5')
  await dario.j('/api/invitations/accept', { method: 'POST', json: { token: tokenOf(dInv.body.link), name: 'Dario Ortiz', password: PW.member }, headers: { 'user-agent': CHROME } })
  const darioPlanted = authQuery('SELECT password FROM account WHERE userId = ?', (await dario.j('/api/me')).body.id)[0]?.password
  check('Dario is in, and his address and name are in auth.sqlite', (await dario.j('/api/me')).status === 200 && whereIs('dario.ortiz@example.test').length >= 2 && whereIs('Dario Ortiz').length >= 1)
  const delJ = (b, o) => b.j('/api/me', { method: 'DELETE', ...o })
  check('the delete needs the Origin and the CSRF token like any write', (await delJ(dario, { json: { confirm: 'dario.ortiz@example.test' }, origin: 'https://evil.example' })).status === 403 && (await delJ(dario, { json: { confirm: 'dario.ortiz@example.test' }, csrf: false })).status === 403 && (await dario.j('/api/me')).status === 200)
  check('typing nothing, or someone else’s address, erases nothing (400)', (await delJ(dario, { json: {} })).status === 400 && (await delJ(dario, { json: { confirm: 'someone.else@example.test' } })).status === 400 && (await delJ(dario, { body: 'not json', headers: { 'content-type': 'application/json' } })).status === 400 && (await dario.j('/api/me')).status === 200)
  const wrongForm = await dario.fetch('/account/delete', { method: 'POST', form: { confirm: 'nobody@example.test' } })
  const wrongFormHtml = await wrongForm.text()
  check('the form says so in a visible message and keeps the account', wrongForm.status === 400 && wrongFormHtml.includes('role="alert"') && wrongFormHtml.includes('Type your own email address') && (await dario.j('/api/me')).status === 200)
  const bye = await dario.fetch('/account/delete', { method: 'POST', form: { confirm: ' Dario.Ortiz@Example.test ' } })
  const byeHtml = await bye.text()
  check('with his own address (any case) the account is erased: a goodbye page, the cookie cleared', bye.status === 200 && byeHtml.includes('Your account was erased') && noInline(byeHtml) && byeHtml.includes('href="/privacy"') && !dario.has('session_token'))
  const gonePlaces = ['dario.ortiz@example.test', 'Dario Ortiz', 'Ortiz', 'd***@example.test', darioPlanted].map((x) => [x.slice(0, 8), whereIs(x)]).filter(([, w]) => w.length > 0)
  check('no table of auth.sqlite and no byte of the file or its log holds his name, address or password hash', gonePlaces.length === 0, JSON.stringify(gonePlaces))
  check('his next request is 401, he cannot sign in, and the address is free to be invited again', (await dario.fetch('/api/me')).status === 401 && (await signIn(new Browser('10.0.6.6'), 'dario.ortiz@example.test', PW.member)).status === 401 && (await owner.j('/api/people/invitations', { method: 'POST', json: { email: 'dario.ortiz@example.test', role: 'member' } })).status === 200)
  const eInv = await owner.j('/api/people/invitations', { method: 'POST', json: { email: 'ema.ruiz@example.test', role: 'member' } })
  const ema = new Browser('10.0.6.7')
  await ema.j('/api/invitations/accept', { method: 'POST', json: { token: tokenOf(eInv.body.link), name: 'Ema Ruiz', password: PW.member } })
  const emaGone = await delJ(ema, { json: { confirm: 'EMA.RUIZ@example.test' } })
  check('the JSON route does the same: 200, the cookie cleared, 401 after, and nothing left in the file', emaGone.status === 200 && emaGone.body.ok === true && !ema.has('session_token') && (await ema.fetch('/api/me')).status === 401 && ['ema.ruiz@example.test', 'Ema Ruiz', 'e***@example.test'].every((x) => whereIs(x).length === 0))
  const ownerDel = await delJ(owner, { json: { confirm: 'olga@example.test' } })
  const ownerDelForm = await owner.fetch('/account/delete', { method: 'POST', form: { confirm: 'olga@example.test' } })
  check('the owner cannot delete themselves: 403 with the reason, and still signed in', ownerDel.status === 403 && /owner/.test(ownerDel.body?.message ?? '') && ownerDelForm.status === 403 && (await owner.j('/api/me')).body?.role === 'owner')
  check('a bearer cannot delete an account (403), nor can an anonymous visitor (401)', (await machine('/api/me', { method: 'DELETE', json: { confirm: 'olga@example.test' } })).status === 403 && (await delJ(anon, { json: { confirm: 'x@example.test' } })).status === 401)

  group('privacy: the owner removes a person')
  const beforeRemoval = [...['zorica.vukovic@example.test', 'Zorica Vukovic', 'Vukovic', zHash, ...zTokens].map((x) => [x, whereIs(x)])]
  check('before the removal Zorica’s address, name, hash and tokens are in auth.sqlite', beforeRemoval.every(([, w]) => w.length >= 1) && whereIs('zorica.vukovic@example.test').length >= 4, JSON.stringify(beforeRemoval.map(([x, w]) => [x.slice(0, 8), w.length])))
  check('she wrote a row while she was in', zNote.status === 200 && zNote.body.ok === true)
  const removed = await owner.j('/api/people/members/' + zId, { method: 'DELETE' })
  check('the owner removes her', removed.status === 200 && removed.body.ok === true, JSON.stringify(removed.body))
  const stillThere = ['zorica.vukovic@example.test', 'Zorica Vukovic', 'Zorica', 'Vukovic', 'z***@example.test', zHash, ...zTokens].map((x) => [x.slice(0, 10), whereIs(x)]).filter(([, w]) => w.length > 0)
  check('no table of auth.sqlite (user, session, account, verification, members, invitations, activity) and no byte of the file or its log holds her address, name, hash or tokens', stillThere.length === 0, JSON.stringify(stillThere))
  const idLeft = [['user', 'id'], ['session', 'userId'], ['account', 'userId'], ['app_member', 'user_id']].filter(([t, c]) => authQuery('SELECT count(*) AS n FROM "' + t + '" WHERE "' + c + '" = ?', zId)[0].n > 0)
  check('her id is in no table of the people (the activity log keeps it as an opaque id, nothing else about her)', idLeft.length === 0, JSON.stringify(idLeft))
  check('both of her devices are signed out at once and she cannot sign in (a failed attempt keeps a masked address, as any does)', (await zo.fetch('/api/me')).status === 401 && (await zo2.fetch('/api/me')).status === 401 && (await signIn(new Browser('10.0.6.8'), 'zorica.vukovic@example.test', PW.member)).status === 401)
  const peopleAfter = (await owner.j('/api/people')).body
  check('neither the members nor the pending invitations list her any more (both of her invitations went)', !JSON.stringify(peopleAfter).includes('zorica') && peopleAfter.invitations.length >= 1)
  const noteJournal = (() => { const s = makeService({ dir: join(data, 'apps', 'shop') }); try { return s.byId(shopId).db.journal({ object: 'note', record: zNote.body.record.id }).map((e) => e.by) } finally { s.close() } })()
  const appBytes = walk(join(data, 'apps')).flatMap((f) => readFileSync(join(data, 'apps', f)))
  check('what stays: her row is still in the app, written by an opaque id that names nobody; the apps’ files hold neither her address nor her name', (await records(owner, 'note')).records.some((r) => r.id === zNote.body.record.id) && noteJournal.includes('member:' + zId) && !appBytes.some((b) => b.includes('zorica.vukovic') || b.includes('Zorica Vukovic')))
  const nInv = await owner.j('/api/people/invitations', { method: 'POST', json: { email: 'noel.park@example.test', role: 'viewer' } })
  const noel = new Browser('10.0.6.9')
  await noel.j('/api/invitations/accept', { method: 'POST', json: { token: tokenOf(nInv.body.link), name: 'Noel Park', password: PW.member } })
  const noelId = (await noel.j('/api/me')).body.id
  const noelPage = await owner.fetch('/people/members/' + noelId + '/remove', { method: 'POST', form: {} })
  const noelHtml = await noelPage.text()
  check('the people page removes through its form and says what is erased and what stays', noelPage.status === 200 && noelHtml.includes('Their account and address were erased') && noelHtml.includes('opaque id') && (await noel.fetch('/api/me')).status === 401 && whereIs('noel.park@example.test').length === 0 && whereIs('Noel Park').length === 0)
  check('the removal question on the page says the same before it is asked', peopleHtml.includes('their account and address are erased') && peopleHtml.includes('opaque id'))
  check('the owner cannot be removed this way, and a member cannot remove anyone (403)', (await owner.j('/api/people/members/' + (await owner.j('/api/me')).body.id, { method: 'DELETE' })).status === 403 && (await m3.j('/api/people/members/' + noelId, { method: 'DELETE' })).status === 403)

  group('privacy: the owner’s export of an app')
  const noteList = (await records(owner, 'note')).records
  const noteToArchive = noteList.find((r) => r.id !== zNote.body.record.id)
  const archived = await write(owner, {}, 'note', 'delete', noteToArchive.id)
  check('one row is archived first (deleted, kept)', archived.status === 200 && archived.body.ok === true, JSON.stringify(archived.body).slice(0, 100))
  const ex = await owner.fetch('/api/apps/shop/export.json')
  const exText = await ex.text()
  const exJson = (() => { try { return JSON.parse(exText) } catch (e) { return {} } })()
  check('the export is an attachment named after the app, JSON, never cached', ex.status === 200 && /^attachment; filename="shop-export-\d{4}-\d{2}-\d{2}\.json"$/.test(ex.headers.get('content-disposition') ?? '') && /no-store/.test(ex.headers.get('cache-control') ?? '') && (ex.headers.get('content-type') ?? '').startsWith('application/json') && ex.headers.get('x-content-type-options') === 'nosniff')
  const exShop = exJson.databases?.[0]
  const exContact = exShop?.tables?.find((t) => t.key === 'contact')
  const exNote = exShop?.tables?.find((t) => t.key === 'note')
  check('it holds the definitions of every table (fields with their protection) and the profiles', exJson.format === 'kybernos-team-space-export/1' && exJson.app === 'shop' && exShop?.tables?.map((t) => t.key).sort().join() === 'contact,note,orders,product' && exContact?.definition?.fields?.some((f) => f.key === 'iban' && f.protection === 'sensitive') && exShop?.profiles?.some((p) => p.id === 'member'))
  check('…every record, personal and sensitive fields in clear (it is the owner’s), and the archived row with its stamp', exContact?.records?.[0]?.values?.phone === '0102030405' && exContact.records[0].values.iban === 'FR7612345' && exNote?.records?.some((r) => r.id === noteToArchive.id && r.deleted !== null) && exNote.records.some((r) => r.id === zNote.body.record.id && r.deleted === null))
  check('…and the list of files with names, types and hashes (the bytes are not in it)', exShop?.files?.length >= 1 && exShop.files.every((f) => f.table === 'contact' && typeof f.name === 'string' && /^[0-9a-f]{64}$/.test(f.hash) && Number.isInteger(f.size)) && !exText.includes('PNG'), JSON.stringify(exShop?.files))
  const exLedger = await owner.j('/api/apps/ledger/export.json')
  check('an app with no profile is exported too', exLedger.status === 200 && exLedger.body?.databases?.[0]?.name === 'Ledger')
  const exRefused = [await m3.fetch('/api/apps/shop/export.json'), await m2b.fetch('/api/apps/shop/export.json'), await anon.fetch('/api/apps/shop/export.json'), await machine('/api/apps/shop/export.json')]
  check('a member and a viewer are refused (403), a visitor too (401), and so is the owner’s token: the owner’s session only (403)', exRefused.map((r) => r.status).join() === '403,403,401,403' && (await exRefused[3].json()).reason === 'bearer-scope')
  check('an unknown app is a 404, and so is a bad name', (await owner.fetch('/api/apps/nothing/export.json')).status === 404 && (await owner.fetch('/api/apps/..%2Fetc/export.json')).status === 404)
  check('the client has a visible « Export data » control for the owner, a plain download link', readFileSync(join(app, 'public', 'js', 'views.mjs'), 'utf8').includes('Export data') && readFileSync(join(app, 'public', 'js', 'views.mjs'), 'utf8').includes('/export.json'))
  check('a copy of the app taken with the session is written down too (manifest)', (await owner.fetch('/api/apps/shop/snapshot/manifest')).status === 200)

  group('transfer routes: who may call them')
  const png2 = png
  const shopBlob = (await mj('/api/apps/shop/snapshot/manifest')).body?.blobs?.[0]?.hash ?? '0'.repeat(64)
  const doors = [
    ['PUT', '/api/apps/nothere/bundle', { body: Buffer.alloc(32), headers: { 'content-type': 'application/octet-stream' } }],
    ['GET', '/api/apps/shop/fingerprint', {}],
    ['GET', '/api/apps/shop/snapshot', {}],
    ['GET', '/api/apps/shop/snapshot/manifest', {}],
    ['GET', '/api/apps/shop/snapshot/db', {}],
    ['GET', '/api/apps/shop/blobs/' + shopBlob, {}],
    ['POST', '/api/apps/shop/release', { json: { confirm: 'shop' } }],
  ]
  const anonymous = []
  const asMember = []
  for (const [method, path, o] of doors) {
    anonymous.push((await anon.fetch(path, { method, ...o })).status)
    asMember.push((await vera.fetch(path, { method, ...o })).status)
  }
  check('anonymous: 401 on every one of the seven', anonymous.every((c) => c === 401), anonymous.join())
  check('a member (any profile): 403 on every one of the seven', asMember.every((c) => c === 403), asMember.join())
  check('and the member’s release removed nothing', (await slugsNow()) === 'ledger,shop')

  group('transfer: a live app out, as one bundle')
  const snapOut = await machine('/api/apps/shop/snapshot')
  const outBytes = Buffer.from(await snapOut.arrayBuffer())
  const shopBundle = decodeBundle(outBytes)
  check('the snapshot of a live app is one octet-stream bundle that the codec accepts', snapOut.status === 200 && snapOut.headers.get('content-type') === 'application/octet-stream' && snapOut.headers.get('cache-control') === 'no-store' && shopBundle.ok, snapOut.status + ' ' + JSON.stringify(shopBundle).slice(0, 120))
  check('it names the db, the fingerprint of the moment, and only the attachments the rows hold (the page; the picture it replaced is not shipped)', shopBundle.ok && shopBundle.manifest.db.id === shopId && shopBundle.manifest.fingerprint === snapOut.headers.get('x-kb-fingerprint') && shopBundle.manifest.fingerprint === (await mj('/api/apps/shop/fingerprint')).body.fingerprint && shopBundle.blobs.some((b) => b.bytes.equals(html)) && !shopBundle.blobs.some((b) => b.bytes.equals(png)), JSON.stringify(shopBundle.manifest ?? shopBundle).slice(0, 160))
  const looked = stageBundle({ decoded: shopBundle, tmpRoot: join(root, 'looked') })
  check('it opens as the same app: contact, orders, the owner’s notes, a verified journal', looked.ok && (() => { const o = openDb(join(looked.folder, 'db.sqlite')); try { return o.ok && o.db.list('contact').length === 1 && o.db.list('contact')[0].values.name === 'Ada' && o.db.list('orders').length >= 3 && o.db.verify().ok } finally { if (o.ok) o.db.close() } })())

  group('transfer: the same in pieces')
  const man = await mj('/api/apps/shop/snapshot/manifest')
  const { ok: _ok, ...manifestBody } = man.body ?? {}
  check('manifest: the fingerprint, the size and hash of the db, the attachments', man.status === 200 && man.body.ok === true && checkManifest(manifestBody, { maxBytes: Number.MAX_SAFE_INTEGER }).ok && man.body.blobs.length >= 1, JSON.stringify(man.body).slice(0, 160))
  const dbRes = await machine('/api/apps/shop/snapshot/db')
  const dbBytes = Buffer.from(await dbRes.arrayBuffer())
  check('snapshot/db: the SQLite bytes, of the very snapshot the manifest described', dbRes.status === 200 && dbRes.headers.get('content-type') === 'application/octet-stream' && dbRes.headers.get('x-kb-fingerprint') === man.body.fingerprint && dbBytes.length === man.body.db.size && Number(dbRes.headers.get('content-length')) === dbBytes.length && sha(dbBytes) === man.body.db.sha256)
  const htmlBlob = man.body.blobs.find((b) => b.size === html.length)
  const blobRes = await machine('/api/apps/shop/blobs/' + htmlBlob.hash)
  check('blobs/:hash: one attachment, as octet-stream, whatever it is', blobRes.status === 200 && blobRes.headers.get('content-type') === 'application/octet-stream' && Buffer.from(await blobRes.arrayBuffer()).equals(html) && sha(html) === htmlBlob.hash)
  const hashes = await Promise.all([machine('/api/apps/shop/blobs/zz'), machine('/api/apps/shop/blobs/' + '0'.repeat(63)), machine('/api/apps/shop/blobs/..%2F..%2Fauth.sqlite'), machine('/api/apps/shop/blobs/' + 'F'.repeat(64)), machine('/api/apps/shop/blobs/' + '0'.repeat(64))])
  check('a blob is named by 64 lower-case hex characters only (anything else is 400), an unknown one is 404, and a path is never read', hashes.slice(0, 4).every((r) => r.status === 400) && hashes[4].status === 404, hashes.map((r) => r.status).join())
  check('an unknown app is 404 on every read route; a bad slug too', (await Promise.all(['fingerprint', 'snapshot', 'snapshot/manifest', 'snapshot/db', 'blobs/' + '0'.repeat(64)].map((w) => machine('/api/apps/ghost/' + w)))).every((r) => r.status === 404) && (await machine('/api/apps/..%2Fetc/snapshot')).status === 404)
  await owner.j('/api/apps/shop/write', { method: 'POST', json: { object: 'note', op: 'create', values: { body: 'after the manifest' } } })
  const dbLater = await machine('/api/apps/shop/snapshot/db')
  await dbLater.arrayBuffer()
  check('a write after the manifest: the db that follows says its own fingerprint, so the puller can tell', dbLater.headers.get('x-kb-fingerprint') !== man.body.fingerprint && dbLater.headers.get('x-kb-fingerprint') === (await mj('/api/apps/shop/fingerprint')).body.fingerprint)

  group('transfer: a whole app in')
  const tripSvc = makeService({ dir: join(root, 'trip-src') })
  const tripDb = tripSvc.create({ name: 'Trip', by: 'agent', objects: [{ key: 'item', label: 'Items', title: 'label', fields: [{ key: 'label', type: 'text', label: 'Label', required: true }, { key: 'photo', type: 'attachment', label: 'Photo' }, { key: 'qty', type: 'number', label: 'Qty' }] }] }).db
  const tripFile = tripDb.attach(png2, { name: 'trip.png', type: 'image/png' }).file
  const tripOne = tripDb.create('item', { label: 'one', qty: 3, photo: [tripFile] }, 'agent').record.id
  tripDb.create('item', { label: 'two', qty: 5 }, 'agent')
  tripDb.saveView('item', { id: 'all', name: 'All', kind: 'table' }, 'agent')
  const tripSnap = snapshotDb({ db: tripDb, tmpDir: join(root, 'trip-tmp') })
  const tripPacked = bundleOf(tripSnap, tripDb)
  const tripId = tripDb.info().id
  check('a bundle of a local app is made with SQLite’s own copy', tripPacked.ok && tripSnap.fingerprint === tripDb.fingerprint())
  const imported = await put('trip', tripPacked.bytes)
  check('PUT bundle: 201, the slug, the db, the fingerprint', imported.status === 201 && imported.body.ok === true && imported.body.slug === 'trip' && imported.body.db.id === tripId && imported.body.db.name === 'Trip' && imported.body.fingerprint === tripSnap.fingerprint, JSON.stringify(imported.body))
  check('the app is in the space and listed', (await slugsNow()) === 'ledger,shop,trip' && existsSync(join(data, 'apps', 'trip', tripId, 'db.sqlite')))
  const tripRows = (await api(owner, 'trip', 'records?object=item')).body
  check('its rows are the original’s, field for field', tripRows.ok && JSON.stringify(tripRows.records.map((r) => r.values)) === JSON.stringify(tripDb.list('item').map((r) => r.values)), JSON.stringify(tripRows).slice(0, 120))
  const tripPic = await owner.fetch('/api/apps/trip/file?object=item&id=' + tripOne + '&field=photo&hash=' + tripFile.hash)
  check('its picture is served, byte for byte', tripPic.status === 200 && Buffer.from(await tripPic.arrayBuffer()).equals(png2))
  check('its fingerprint is the original’s', (await mj('/api/apps/trip/fingerprint')).body.fingerprint === tripDb.fingerprint())
  const back = await machine('/api/apps/trip/snapshot')
  const backBundle = decodeBundle(Buffer.from(await back.arrayBuffer()))
  const backStage = backBundle.ok ? stageBundle({ decoded: backBundle, tmpRoot: join(root, 'back') }) : backBundle
  const sameAsOriginal = (stage) => {
    const o = openDb(join(stage.folder, 'db.sqlite'))
    try { return o.ok && JSON.stringify(o.db.list('item')) === JSON.stringify(tripDb.list('item')) && JSON.stringify(o.db.journal()) === JSON.stringify(tripDb.journal()) && o.db.blobs.get(tripFile.hash).equals(png2) && o.db.verify().ok } finally { if (o.ok) o.db.close() }
  }
  check('the snapshot of the import is the original: same db id, fingerprint, rows, picture and journal — a round trip', backStage.ok && backStage.id === tripId && backStage.fingerprint === tripDb.fingerprint() && sameAsOriginal(backStage))
  const sameSlug = await put('trip', tripPacked.bytes)
  const dupSlug = await put('trip-copy', tripPacked.bytes)
  check('the same slug again: 409 exists', sameSlug.status === 409 && sameSlug.body.error === 'exists')
  check('another slug, a db the space already holds: 409 db-exists, and nothing was made', dupSlug.status === 409 && dupSlug.body.error === 'db-exists' && !existsSync(join(data, 'apps', 'trip-copy')) && (await slugsNow()) === 'ledger,shop,trip')

  const bigSvc = makeService({ dir: join(root, 'big-src') })
  const bigDb = bigSvc.create({ name: 'Big', by: 'agent', objects: [{ key: 'item', label: 'Items', title: 'label', fields: [{ key: 'label', type: 'text', label: 'Label' }, { key: 'scan', type: 'attachment', label: 'Scan' }] }] }).db
  const scanBytes = randomBytes(2 * 1024 * 1024)
  bigDb.create('item', { label: 'scan', scan: [bigDb.attach(scanBytes, { name: 'scan.bin', type: 'application/octet-stream' }).file] }, 'agent')
  const bigSnap = snapshotDb({ db: bigDb, tmpDir: join(root, 'big-tmp') })
  const bigPacked = bundleOf(bigSnap, bigDb)
  const bigIn = await put('big', bigPacked.bytes)
  check('the bundle route has its own, larger body limit: a ' + Math.round(bigPacked.bytes.length / 1024 / 1024 * 10) / 10 + ' MiB bundle (the JSON limit is 1 MiB) comes in', bigPacked.bytes.length > 2 * 1024 * 1024 && bigPacked.bytes.length < BUNDLE_CAP && bigIn.status === 201, bigIn.status + ' ' + JSON.stringify(bigIn.body).slice(0, 100))
  const bigBack = decodeBundle(Buffer.from(await (await machine('/api/apps/big/snapshot')).arrayBuffer()))
  check('and comes out whole: the 2 MiB attachment is in the snapshot, byte for byte', bigBack.ok && bigBack.blobs.length === 1 && bigBack.blobs[0].bytes.equals(scanBytes))
  await mj('/api/apps/big/release', { method: 'POST', json: { confirm: 'big' } })
  bigSnap.dispose()
  bigSvc.close()

  group('transfer: what an import refuses leaves nothing behind')
  const strays = () => readdirSync(join(data, 'tmp')).filter((n) => n.startsWith('in-') || n.startsWith('released-')).length
  const goodBundle = tripPacked.bytes
  const mangled = (at) => { const b = Buffer.from(goodBundle); b[at] ^= 1; return b }
  const cases = [
    ['not a bundle', Buffer.from('PK\u0003\u0004 definitely a zip'), 'magic'],
    ['truncated', goodBundle.subarray(0, goodBundle.length - 5), 'truncated'],
    ['trailing bytes', Buffer.concat([goodBundle, Buffer.from('x')]), 'trailing'],
    ['a flipped byte in the last attachment', mangled(goodBundle.length - 1), 'hash'],
    ['a flipped byte in the database', mangled(16 + goodBundle.readUInt32BE(12) + 2000), 'hash'],
    ['a manifest length that lies', (() => { const b = Buffer.from(goodBundle); b.writeUInt32BE(0xfffffff0, 12); return b })(), 'manifest-size'],
    ['another format version', (() => { const b = Buffer.from(goodBundle); b.writeUInt32BE(9, 8); return b })(), 'version'],
  ]
  for (const [what, bytes, code] of cases) {
    const r = await put('refused', bytes)
    check('PUT ' + what + ': 400 invalid-bundle (' + code + ')', r.status === 400 && r.body.error === 'invalid-bundle' && r.body.code === code, r.status + ' ' + JSON.stringify(r.body).slice(0, 100))
  }
  await owner.j('/api/apps/trip/write', { method: 'POST', json: { object: 'item', op: 'update', id: tripOne, values: { qty: 9 } } })
  check('a bad slug is 400, a wrong content type 415, an empty body 400', (await put('Bad_Slug', goodBundle)).status === 400 && (await put('refused', goodBundle, { headers: { 'content-type': 'application/json' } })).status === 415 && (await put('refused', Buffer.alloc(0))).status === 400)
  const huge = await lone('/api/apps/refused/bundle', { method: 'PUT', body: Buffer.alloc(BUNDLE_CAP + 1024), headers: { authorization: 'Bearer ' + mint(), 'content-type': 'application/octet-stream', 'x-forwarded-for': '10.0.6.2' } })
  check('a body over the cap (KB_BUNDLE_MAX_BYTES) is 413 and nothing is made', huge.status === 413, JSON.stringify(huge))
  const lied = await lone('/api/apps/refused/bundle', { method: 'PUT', headers: { authorization: 'Bearer ' + mint(), 'content-type': 'application/octet-stream', 'content-length': String(300 * 1024 * 1024), 'x-forwarded-for': '10.0.6.1' } })
  check('a body that announces more than the cap is refused before a byte is read (413 on the headers alone)', lied.status === 413, JSON.stringify(lied))
  const early = await lone('/api/apps/shop/bundle', { method: 'PUT', headers: { authorization: 'Bearer ' + mint(), 'content-type': 'application/octet-stream', 'content-length': '2000000', 'x-forwarded-for': '10.0.6.3' } })
  const earlySlug = await lone('/api/apps/Bad_Slug/bundle', { method: 'PUT', headers: { authorization: 'Bearer ' + mint(), 'content-type': 'application/octet-stream', 'content-length': '2000000', 'x-forwarded-for': '10.0.6.4' } })
  check('a slug that is taken or not a slug is refused before the body is read (409, 400 on the headers alone)', early.status === 409 && earlySlug.status === 400, JSON.stringify([early, earlySlug]))
  check('after every refusal: no app made, no staging folder left', (await slugsNow()) === 'ledger,shop,trip' && !existsSync(join(data, 'apps', 'refused')) && strays() === 0)

  group('transfer: release')
  const before3 = await owner.j('/api/me')
  const rel0 = await Promise.all([mj('/api/apps/trip/release', { method: 'POST', json: {} }), mj('/api/apps/trip/release', { method: 'POST', json: { confirm: 'shop' } }), mj('/api/apps/trip/release', { method: 'POST', body: 'nope', headers: { 'content-type': 'text/plain' } }), mj('/api/apps/nothing/release', { method: 'POST', json: { confirm: 'nothing' } })])
  check('release needs { confirm: <slug> }: 400 without or with another name, 404 for an app that is not there', rel0[0].status === 400 && rel0[1].status === 400 && rel0[2].status === 400 && rel0[3].status === 404 && (await slugsNow()) === 'ledger,shop,trip')
  const rel = await mj('/api/apps/trip/release', { method: 'POST', json: { confirm: 'trip' } })
  check('release with the slug: 200, the app is gone from the space, the list and the disk', rel.status === 200 && rel.body.ok === true && rel.body.released === 'trip' && (await slugsNow()) === 'ledger,shop' && !existsSync(join(data, 'apps', 'trip')) && strays() === 0)
  check('a later request for it is 404, by session or by bearer', (await api(owner, 'trip', 'records?object=item')).status === 404 && (await mj('/api/apps/trip/fingerprint')).status === 404 && (await mj('/api/apps/trip/snapshot')).status === 404 && (await mj('/api/apps/trip/release', { method: 'POST', json: { confirm: 'trip' } })).status === 404)
  check('release ends nothing else: the other apps answer, the owner’s and the members’ sessions are alive', (await records(owner, 'orders')).ok && (await owner.j('/api/me')).status === 200 && before3.status === 200 && (await vera.j('/api/me')).status === 200)
  const racers = await Promise.all([put('race-a', tripPacked.bytes), put('race-b', tripPacked.bytes)])
  const won = racers.filter((r) => r.status === 201)
  const lost = racers.filter((r) => r.status === 409)
  check('two imports of one db at once: exactly one wins, the other is told the db is in the space, and one app exists', won.length === 1 && lost.length === 1 && lost[0].body.error === 'db-exists' && (await slugsNow()).split(',').filter((x) => x.startsWith('race-')).length === 1 && strays() === 0, racers.map((r) => r.status).join())
  await mj('/api/apps/' + won[0].body.slug + '/release', { method: 'POST', json: { confirm: won[0].body.slug } })
  const reimport = await put('trip', tripPacked.bytes)
  check('the db is free again: the same bundle imports once more (and the rows are those of the bundle, not of the released copy)', reimport.status === 201 && (await api(owner, 'trip', 'records?object=item')).body.records.find((r) => r.id === tripOne).values.qty === 3)
  const viaCookie = await owner.fetch('/api/apps/trip/release', { method: 'POST', json: { confirm: 'trip' } })
  check('the owner’s session can release too (Origin and CSRF as for any change)', viaCookie.status === 200 && (await slugsNow()) === 'ledger,shop')
  const putCookie = await owner.fetch('/api/apps/trip/bundle', { method: 'PUT', body: tripPacked.bytes, headers: { 'content-type': 'application/octet-stream' } })
  check('and import: PUT from the owner’s session', putCookie.status === 201 && (await slugsNow()) === 'ledger,shop,trip')
  check('…but not without its CSRF token', (await owner.fetch('/api/apps/trip2/bundle', { method: 'PUT', body: tripPacked.bytes, headers: { 'content-type': 'application/octet-stream' }, csrf: false })).status === 403)
  check('the imported app is a normal app for the team: a member with a profile there is refused where the profile says so', (await api(m2b, 'trip', 'records?object=item')).status === 403)
  await mj('/api/apps/trip/release', { method: 'POST', json: { confirm: 'trip' } })
  tripSnap.dispose()
  tripSvc.close()

  group('owner API token: a space that has no owner yet, and the edge')
  const freshData = join(root, 'data-fresh')
  mkdirSync(freshData, { recursive: true })
  const fresh = await buildApp({ dataDir: freshData, authSecret, bootKey, port: 4999, trustProxy: false, bundleMaxBytes: BUNDLE_CAP, ports: { log () {} } })
  const call = (path, o = {}) => fresh.app.request('http://127.0.0.1:4999' + path, { ...o, headers: { authorization: 'Bearer ' + mint(), ...(o.headers ?? {}) } })
  const meFresh = await call('/api/me')
  const meFreshBody = await meFresh.json()
  check('before anyone has opened the first link the token still opens the door: the first publish needs no browser', meFresh.status === 200 && meFreshBody.role === 'owner' && meFreshBody.email === null)
  const firstPut = await call('/api/apps/trip/bundle', { method: 'PUT', body: tripPacked.bytes, headers: { 'content-type': 'application/octet-stream' } })
  check('…and imports an app', firstPut.status === 201 && existsSync(join(freshData, 'apps', 'trip', tripId, 'db.sqlite')))
  const openFresh = await fresh.app.request('http://127.0.0.1:4999' + link())
  check('the owner’s first link then creates the owner as usual, and the app is theirs to open', openFresh.status === 303 && (await (await call('/api/me')).json()).email === 'owner@app.invalid')
  const dupFresh = await call('/api/apps/trip2/bundle', { method: 'PUT', body: tripPacked.bytes, headers: { 'content-type': 'application/octet-stream' } })
  check('…and refuses the same db under another name', dupFresh.status === 409 && (await dupFresh.json()).error === 'db-exists')
  let last = 0
  for (let i = 0; i < 601; i++) last = (await fresh.app.request('http://127.0.0.1:4999/health', { headers: { authorization: 'Bearer ' + mint() } })).status
  check('a bearer is not exempt from the rate limit: 600 a minute per address, then 429', last === 429, String(last))
  fresh.close()

  group('owner API token: bad tokens are rate-limited too')
  const bads = []
  for (let i = 0; i < 32; i++) bads.push((await machine('/api/me', { token: 'bad-token-' + i, ip: '10.0.7.9' })).status)
  check('thirty wrong tokens an address in 15 minutes are answered 401, the next ones 429', bads.slice(0, 30).every((c) => c === 401) && bads.slice(30).every((c) => c === 429), bads.join())
  check('another address is not slowed', (await machine('/api/me', { ip: '10.0.7.10' })).status === 200)

  // ── 12c. L7: invitations that really send, against a fake provider (a second instance of the same app, configured by its environment) ──
  group('e-mail invitations (a second instance, a fake provider)')
  const provider = { calls: [], mode: 'ok' }
  const fakeProvider = createHttpServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      provider.calls.push({ method: req.method, url: req.url, headers: req.headers, raw: Buffer.concat(chunks).toString('utf8') })
      res.writeHead(provider.mode === 'fail' ? 422 : 200, { 'content-type': 'application/json' })
      res.end(provider.mode === 'fail' ? JSON.stringify({ name: 'validation_error', message: 'PROVIDER-SECRET-BODY the domain is not verified' }) : JSON.stringify({ id: 're_' + randomBytes(6).toString('hex') }))
    })
  })
  await new Promise((resolve) => fakeProvider.listen(0, '127.0.0.1', resolve))
  const fakePort = fakeProvider.address().port
  const mailDbs = join(root, 'dbs-mail')
  const mailSvc = makeService({ dir: mailDbs })
  const mailMade = mailSvc.create({ name: 'Notes', by: 'template', objects: [{ key: 'note', label: 'Notes', title: 'body', fields: [{ key: 'body', type: 'text', label: 'Body' }] }] })
  mailMade.db.setProfiles([{ id: 'member', label: 'Team member', grants: [{ object: 'note', do: ['read'] }] }], 'template')
  const mailDbId = mailMade.db.info().id
  mailSvc.close()
  const mailData = join(root, 'data-mail')
  installApp(join(mailData, 'apps'), 'notes', join(mailDbs, mailDbId))
  const portB = await new Promise((resolve) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) }) })
  const BASE_B = 'http://127.0.0.1:' + portB
  serverB = spawn(process.execPath, ['--no-warnings', 'server.js'], { cwd: app, env: { PATH: process.env.PATH, PORT: String(portB), KB_AUTH_SECRET: authSecret, KB_BOOT_KEY: bootHex, KB_DATA_DIR: mailData, KB_TRUST_PROXY: '1', KB_MAIL_API_KEY: MAIL_KEY, KB_MAIL_FROM: 'Team space <team@example.test>', KB_MAIL_REPLY_TO: 'owner@example.test', KB_MAIL_API_BASE: 'http://127.0.0.1:' + fakePort, KB_PRIVACY_CONTACT: 'privacy@example.test', KB_REGION_LABEL: 'Test region (EU)' }, stdio: ['ignore', 'pipe', 'pipe'] })
  serverB.stdout.on('data', (d) => { outputB += d })
  serverB.stderr.on('data', (d) => { outputB += d })
  for (let i = 0; i < 100 && !outputB.includes('listening ' + portB); i++) await sleep(100)
  check('the second instance listens, with a provider key in its environment', outputB.includes('listening ' + portB), outputB.slice(0, 200))
  const boss = new Browser('10.0.5.1', BASE_B)
  check('its owner opens the first link', (await boss.fetch(link({ email: 'boss@example.test' }))).status === 303)
  const mailed = await boss.j('/api/people/invitations', { method: 'POST', json: { email: 'mia@example.test', role: 'member' } })
  const call1 = provider.calls[0]
  const sent1 = (() => { try { return JSON.parse(call1.raw) } catch (e) { return {} } })()
  check('an invitation by e-mail goes out: the answer says sent, and gives no link (it is in the mail)', mailed.status === 200 && mailed.body.sent === true && mailed.body.link === undefined && mailed.body.mailFailed === undefined && provider.calls.length === 1, JSON.stringify(mailed.body).slice(0, 160))
  check('the provider got one POST /emails with the key as a bearer and JSON', call1?.method === 'POST' && call1.url === '/emails' && call1.headers.authorization === 'Bearer ' + MAIL_KEY && (call1.headers['content-type'] ?? '').startsWith('application/json'))
  const mailedLink = (sent1.text ?? '').split('\n').find((l) => l.startsWith(BASE_B + '/invite?t=')) ?? ''
  check('…from the configured sender, to the invited address only, with a reply-to, a subject, a text and a small html', sent1.from === 'Team space <team@example.test>' && JSON.stringify(sent1.to) === '["mia@example.test"]' && sent1.reply_to === 'owner@example.test' && /^You are invited to /.test(sent1.subject ?? '') && typeof sent1.text === 'string' && typeof sent1.html === 'string' && !('cc' in sent1) && !('bcc' in sent1), Object.keys(sent1).join())
  const urlsInHtml = (sent1.html ?? '').match(/https?:\/\/[^\s"'<>]+/g) ?? []
  check('the text says who invited, the space, the link, and that it expires in 7 days', (sent1.text ?? '').startsWith('boss@example.test invited you to join Notes.') && sent1.subject === 'You are invited to Notes' && mailedLink !== '' && /expires in 7 days/.test(sent1.text ?? '') && /You will join as Team member/.test(sent1.text ?? ''), (sent1.text ?? '').slice(0, 200))
  check('the html has no image, no script, no style, no tracking, and no address but the invitation link', !/<img|<script|<style|<link|<iframe|src=|pixel|track/i.test(sent1.html ?? '') && urlsInHtml.length > 0 && urlsInHtml.every((u) => u.replace(/&amp;/g, '&').startsWith(BASE_B + '/invite?t=')), (sent1.html ?? '').slice(0, 200))
  const stranger2 = new Browser('10.0.5.2', BASE_B)
  const joined = await stranger2.j('/api/invitations/accept', { method: 'POST', json: { token: new URL(mailedLink).searchParams.get('t'), name: 'Mia', password: PW.member } })
  check('the link in the mail works: she joins as the profile it gave', joined.status === 200 && joined.body.role === 'member' && (await stranger2.j('/api/me')).body?.email === 'mia@example.test')
  provider.mode = 'fail'
  const failed = await boss.j('/api/people/invitations', { method: 'POST', json: { email: 'noa@example.test', role: 'member' } })
  const failedText = JSON.stringify(failed.body)
  check('when the provider refuses, the owner is told the e-mail could not be sent and gets the link; nothing of the provider’s answer or the key is shown', failed.status === 200 && failed.body.sent === false && failed.body.mailFailed === true && failed.body.message === 'The e-mail could not be sent. Here is the link to give them yourself.' && typeof failed.body.link === 'string' && !failedText.includes('PROVIDER-SECRET-BODY') && !failedText.includes('not verified') && !failedText.includes(MAIL_KEY) && provider.calls.length === 2, failedText.slice(0, 200))
  const failedForm = await boss.fetch('/people/invitations', { method: 'POST', form: { email: 'otto@example.test', role: 'member' } })
  const failedFormHtml = await failedForm.text()
  check('the people page says it too, in a visible message with the link to copy, and shows nothing of the provider', failedForm.status === 200 && failedFormHtml.includes('role="alert"') && failedFormHtml.includes('The e-mail could not be sent') && failedFormHtml.includes('/invite?t=') && !failedFormHtml.includes('PROVIDER-SECRET-BODY') && !failedFormHtml.includes(MAIL_KEY) && noInline(failedFormHtml))
  provider.mode = 'ok'
  const pendingNoa = (await boss.j('/api/people')).body.invitations.find((i) => i.email === 'noa@example.test')
  const callsBefore = provider.calls.length
  const resentMail = await boss.j('/api/people/invitations/' + pendingNoa.id + '/resend', { method: 'POST', json: {} })
  const sentAgain = (() => { try { return JSON.parse(provider.calls[callsBefore]?.raw ?? '{}') } catch (e) { return {} } })()
  const firstLink = (failed.body.link ?? '')
  const secondLink = (sentAgain.text ?? '').split('\n').find((l) => l.startsWith(BASE_B + '/invite?t=')) ?? ''
  check('a resend goes through the same path: one more mail, a new link, the old one dead', resentMail.status === 200 && resentMail.body.sent === true && provider.calls.length === callsBefore + 1 && secondLink !== '' && secondLink !== firstLink && (await new Browser('10.0.5.3', BASE_B).j('/api/invitations/accept', { method: 'POST', json: { token: new URL(firstLink).searchParams.get('t'), email: 'noa@example.test', password: PW.member } })).status === 400)
  const nobody = await boss.j('/api/people/invitations', { method: 'POST', json: { role: 'member' } })
  check('an invitation by link alone sends nothing and gives the link', nobody.status === 200 && nobody.body.sent === false && nobody.body.mailFailed === undefined && typeof nobody.body.link === 'string' && provider.calls.length === callsBefore + 1)
  const privacyB = await (await new Browser('10.0.5.4', BASE_B).fetch('/privacy')).text()
  check('/privacy on that instance says what the operator set: the region, the contact as a mail link, and that invitation e-mails go through the provider', privacyB.includes('in Test region (EU)') && privacyB.includes('<a href="mailto:privacy@example.test">privacy@example.test</a>') && privacyB.includes('Invitation emails are sent through'))
  const feedB = (await boss.j('/api/audit?kind=invitations&limit=50')).body
  const sentEvents = feedB?.events?.filter((e) => e.kind === 'invite.sent') ?? []
  check('the activity log says which invitations went by e-mail and which failed, without the key, a link or a provider word', sentEvents.some((e) => e.detail.mail === 'sent') && sentEvents.some((e) => e.detail.mail === 'failed') && !JSON.stringify(feedB).includes(MAIL_KEY) && !JSON.stringify(feedB).includes('PROVIDER-SECRET-BODY') && !JSON.stringify(feedB).includes('/invite?t='))
  const defaultNoMail = await owner.j('/api/people/invitations', { method: 'POST', json: { email: 'nomail@example.test', role: 'member' } })
  check('the first instance, with no key, still sends nothing and gives the link (no “could not be sent”)', defaultNoMail.status === 200 && defaultNoMail.body.sent === false && defaultNoMail.body.mailFailed === undefined && typeof defaultNoMail.body.link === 'string' && provider.calls.length === callsBefore + 1)
  await owner.j('/api/people/invitations/' + defaultNoMail.body.invitation.id, { method: 'DELETE' })
  serverB.kill('SIGTERM')
  await new Promise((resolve) => fakeProvider.close(resolve))

  // ── 13. rate limits (each « browser » has its own address, so only these trip) ──
  group('rate limits')
  const guess = new Browser('10.0.7.1')
  const codes = []
  for (let i = 0; i < 12; i++) codes.push((await signIn(guess, 'olga@example.test', 'guess-' + i + '-password')).status)
  check('sign-in: ten wrong guesses are answered, the next ones are 429', codes.slice(0, 10).every((c) => c === 401) && codes.slice(10).every((c) => c === 429), codes.join())
  check('and then even the right password waits', (await signIn(guess, 'olga@example.test', PW.owner2)).status === 429)
  check('another address is not slowed', (await signIn(new Browser('10.0.7.2'), 'olga@example.test', PW.owner2)).status === 200)
  const burst = new Browser('10.0.7.3')
  const open = []
  for (let i = 0; i < 12; i++) open.push((await burst.fetch('/open?t=junk')).status)
  check('/open: the ones over the limit are 429', open.slice(0, 10).every((c) => c === 403) && open.slice(10).every((c) => c === 429), open.join())
  const flood = new Browser('10.0.7.4')
  const acceptCodes = []
  for (let i = 0; i < 12; i++) acceptCodes.push((await flood.j('/api/invitations/accept', { method: 'POST', json: { token: 'junk', password: PW.member } })).status)
  check('invitation accept: the ones over the limit are 429', acceptCodes.slice(0, 10).every((c) => c === 400) && acceptCodes.slice(10).every((c) => c === 429), acceptCodes.join())
  const invites = []
  for (let i = 0; i < 32; i++) invites.push(await owner.j('/api/people/invitations', { method: 'POST', json: { role: 'viewer' } }))
  check('invitations sent: thirty an hour, then 400 rate-limited', invites[0].status === 200 && invites.at(-1).status === 400 && invites.at(-1).body.error === 'rate-limited', invites.map((r) => r.status).join())

  // ── 14. L7: the activity log, once everything above has happened ──
  group('activity log: the owner’s view, and what it must never hold')
  const feed = (b, q = '') => b.j('/api/audit' + q)
  check('anonymous: 401, a member: 403, a viewer: 403, the owner’s token: 403 (the log is the owner’s session’s)', (await feed(anon)).status === 401 && (await feed(m3)).status === 403 && (await feed(m2b)).status === 403 && (await machine('/api/audit')).status === 403)
  const pageStatuses = [(await anon.fetch('/activity')).status, (await m3.fetch('/activity')).status, (await machine('/activity')).status, (await owner.fetch('/activity')).status]
  check('the page /activity: anonymous 401, a member 403, a bearer 403, the owner 200', pageStatuses.join() === '401,403,403,200', pageStatuses.join())
  const top = await feed(owner, '?limit=5')
  const topBad = top.body.events.filter((e, i, all) => !(typeof e.text === 'string' && /^[A-Z].*\.$/.test(e.text) && (i === 0 || all[i - 1].id > e.id))).map((e) => e.id + ': ' + e.text)
  check('newest first, five at a time, each with a sentence and an opaque cursor for the older page', top.status === 200 && top.body.ok === true && top.body.events.length === 5 && topBad.length === 0 && Number.isInteger(top.body.next), topBad.join(' | ') + ' ' + JSON.stringify(top.body.next))
  const older = await feed(owner, '?limit=5&before=' + top.body.next)
  check('the older page continues where the first stopped', older.status === 200 && older.body.events.length === 5 && older.body.events[0].id < top.body.events[4].id)
  const asked = [await feed(owner, '?limit=0'), await feed(owner, '?limit=abc'), await feed(owner, '?limit=201'), await feed(owner, '?before=-3'), await feed(owner, '?before=x'), await feed(owner, '?kind=nope'), await feed(owner, '?kind=__proto__')]
  check('a bad limit, cursor or filter is a 400 that names the problem, never a crash', asked.every((r) => r.status === 400 && r.body.ok === false && typeof r.body.message === 'string'), asked.map((r) => r.status).join())
  const all = []
  for (let before; ;) {
    const r = await feed(owner, '?limit=200' + (before === undefined ? '' : '&before=' + before))
    all.push(...r.body.events)
    if (r.body.next === null) break
    before = r.body.next
  }
  const kinds = new Set(all.map((e) => e.kind))
  const wanted = ['signin.ok', 'signin.failed', 'owner.open', 'owner.open.refused', 'password.changed', 'invite.sent', 'invite.resent', 'invite.revoked', 'invite.accepted', 'invite.role', 'member.removed', 'member.role', 'member.self_deleted', 'export.app', 'export.me', 'export.snapshot', 'app.imported', 'app.released', 'ratelimit']
  check('every kind of event the brief names has happened above and is in the log', wanted.every((k) => kinds.has(k)), 'missing: ' + wanted.filter((k) => !kinds.has(k)).join())
  check('the whole log, page by page, is newest first with no repeat', all.length > 60 && all.every((e, i) => i === 0 || all[i - 1].id > e.id) && new Set(all.map((e) => e.id)).size === all.length, String(all.length))
  const failedSignins = all.filter((e) => e.kind === 'signin.failed')
  check('a failed sign-in keeps a masked address (a***@domain) and a short code for the network, never the password', failedSignins.length >= 10 && failedSignins.every((e) => e.detail.email === undefined || /^[a-z0-9]\*\*\*@[a-z0-9.-]+$/.test(e.detail.email)) && failedSignins.some((e) => e.detail.email === 'o***@example.test') && failedSignins.every((e) => e.ip === null || /^[0-9a-f]{8}$/.test(e.ip)))
  const viaToken = all.filter((e) => (e.kind === 'app.imported' || e.kind === 'app.released') && e.actor === 'owner-token')
  check('actions through the owner’s token are named as the owner’s computer; the same actions with a session name the owner', viaToken.length >= 2 && viaToken.every((e) => /^The owner's computer /.test(e.text)) && all.filter((e) => (e.kind === 'app.imported' || e.kind === 'app.released') && e.actor !== 'owner-token').every((e) => !/^The owner's computer /.test(e.text)), String(viaToken.length))
  check('removals and erasures say what happened without naming the person', all.filter((e) => e.kind === 'member.removed' || e.kind === 'member.self_deleted').every((e) => /Their account and address were erased\.$/.test(e.text) && e.detail.email === undefined) && all.filter((e) => e.kind === 'member.removed').length >= 2 && all.filter((e) => e.kind === 'member.self_deleted').length >= 2)
  // nothing secret, nothing personal beyond a masked address: in the answer, in the page, and in the table itself
  const logTable = authDump().audit
  const planted = [PW.owner1, PW.owner2, PW.member, 'wrong-password', 'guess-', 'my-typed', 'PASSWORD-in', 'Bearer', 'session_token', '/invite?t=', '/open?t=', 'Zorica', 'Vukovic', 'Dario', 'Ortiz', 'Ema Ruiz', 'Noel', 'Mozilla', '10.0.', 'x-forwarded', ...issued.filter((t) => t.length > 20), maxToken, viewerToken, tokenOf(zInv1.body.link), tokenOf(zInv2.body.link)]
  const feedText = JSON.stringify(all)
  const activityHtml = await (await owner.fetch('/activity')).text()
  const leaksIn = (name, text) => planted.filter((x) => text.includes(x)).map((x) => name + ': ' + x.slice(0, 12))
  const mail = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/
  const net = /\b\d{1,3}(\.\d{1,3}){3}\b/
  check('no password, token, link, user agent or planted name in the log: the API answer, the page, the table', [...leaksIn('api', feedText), ...leaksIn('page', activityHtml), ...leaksIn('table', logTable)].length === 0, [...leaksIn('api', feedText), ...leaksIn('page', activityHtml), ...leaksIn('table', logTable)].join(' | '))
  // the sentences name the people who are in the team now (as the People page does), so their own addresses may show; nobody else's, and the stored rows hold none at all
  const present = new Set([...(await owner.j('/api/people')).body.members.map((m) => m.email.toLowerCase()), 'olga@example.test'])
  const strangers = (text) => [...text.matchAll(new RegExp(mail.source, 'g'))].map((m) => m[0].toLowerCase()).filter((x) => !present.has(x))
  const found = [...strangers(feedText).map((x) => 'api: ' + x), ...strangers(activityHtml).map((x) => 'page: ' + x), ...(mail.test(logTable) ? ['table: an address'] : []), ...[feedText, activityHtml, logTable].filter((t) => net.test(t)).map(() => 'a network address')]
  check('no address of anyone who is not in the team, and no network address, in the log: the API answer, the page, the table (which holds no whole address at all)', found.length === 0, found.join(' | '))
  const filtered = await feed(owner, '?kind=exports&limit=200')
  check('a group filters to its own kinds', filtered.body.events.length >= 3 && filtered.body.events.every((e) => e.group === 'exports') && (await feed(owner, '?kind=member.removed')).body.events.every((e) => e.kind === 'member.removed'))
  const pageOne = await (await owner.fetch('/activity')).text()
  const olderLink = pageOne.match(/href="(\/activity\?before=\d+)"/)
  const pageTwo = olderLink === null ? '' : await (await owner.fetch(olderLink[1].replace(/&amp;/g, '&'))).text()
  const pill = (html, label) => (html.match(new RegExp('<span class="pill [a-z]+">' + label + '</span>', 'g')) ?? []).length
  check('the page: a table of sentences, a filter that is a plain form, newest first, an “Older” link that leads to a page with “Newest”, nothing inline', pageOne.includes('<table class="activity">') && pageOne.includes('name="kind"') && noInline(pageOne) && pageOne.includes('href="/app.css"') && pageOne.includes('href="/privacy"') && olderLink !== null && pageTwo.includes('>Newest<') && noInline(pageTwo) && pageOne.includes('href="/people"'))
  const exportsPage = await (await owner.fetch('/activity?kind=exports')).text()
  check('the page filtered on exports shows only exports', pill(exportsPage, 'Exports') >= 3 && pill(exportsPage, 'Sign-ins') === 0 && pill(exportsPage, 'People') === 0)
  check('a bad filter on the page is a 400 with the whole list, not a crash', (await owner.fetch('/activity?kind=nope')).status === 400 && (await owner.fetch('/activity?before=zz')).status === 400)
  check('the people page links to the activity page', peopleHtml.includes('href="/activity"'))
  const tamper = withAuth((h) => { const out = []; for (const sql of ["UPDATE audit SET kind = 'signin.ok'", 'DELETE FROM audit', "DELETE FROM audit WHERE kind = 'signin.failed'"]) { try { h.exec(sql); out.push('went through') } catch (e) { out.push(/append-only/.test(String(e.message)) ? 'refused' : 'other: ' + e.message) } } return out }, false)
  check('the log is append-only in the file itself: an UPDATE or a DELETE is refused by the table', tamper.every((x) => x === 'refused') && authQuery('SELECT count(*) AS n FROM audit')[0].n === all.length, tamper.join())
}

try {
  await main()
} catch (e) {
  fails++
  console.log('FAIL the check crashed: ' + String((e && e.stack) || e).split('\n').slice(0, 4).join(' | ') + (e && e.cause ? ' | cause: ' + String(e.cause.code || e.cause.message || e.cause) : '') + ' | server output tail: ' + output.split('\n').filter(Boolean).slice(-4).join(' / ').slice(-400))
} finally {
  if (server !== null) {
    server.kill('SIGTERM')
  }
  if (serverB !== null) serverB.kill('SIGTERM')
  if (serverC !== null) serverC.kill('SIGTERM')
  await sleep(400)
  // nothing secret may have reached the server's output: the secrets, a minted link or a password
  const leaked = ['owner-password-one', 'owner-password-two', 'member-password-1', 'session_token', '/open?t=', '/invite?t=', 'Bearer ', MAIL_KEY, 'PROVIDER-SECRET-BODY', 'zorica', 'vukovic', 'dario.ortiz', 'ema.ruiz', 'noel.park', 'mia@example', ...issued.filter((t) => t.length > 20)].filter((s) => (output + outputB).toLowerCase().includes(String(s).toLowerCase()))
  console.log('\n' + (leaked.length === 0 ? 'ok   ' : 'FAIL ') + 'the output of both instances holds no password, token (owner link or API), link, mail provider key, planted name or address (' + (output + outputB).split('\n').filter(Boolean).length + ' lines)')
  if (leaked.length > 0) fails++
  rmSync(root, { recursive: true, force: true })
}
console.log('\n' + total + ' checks in ' + Math.round((Date.now() - t0) / 1000) + ' s; node ' + process.version)
console.log(fails === 0 ? 'ALL OK' : fails + ' FAILED')
process.exit(fails === 0 ? 0 : 1)
