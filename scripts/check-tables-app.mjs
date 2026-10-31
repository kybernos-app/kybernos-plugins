// check-tables-app.mjs — the tables template (packages/kybernos-webapp-creator/templates/tables) booted for real and driven over http. Needs the network once to install
// hono, @hono/node-server and better-auth (pinned, --ignore-scripts) in a temporary folder, or TABLES_APP_NODE_MODULES=<a node_modules that holds them> to skip that.
//
//   node scripts/check-tables-app.mjs        # a few seconds (the install is a few more when the npm cache is cold)
//
// It builds the app (vendoring kybernos-db), boots it on a free port (never :3080) with a trusted proxy header so each « browser » below has its own address for the rate
// limits, and runs: the spike's checks, the page's files and policy (what is served and what is not, the headers, no inline script or style on any page), the e-commerce rights
// matrix for the owner and two members, the owner's link, invitations, removal, CSRF and Origin, cookie flags, uploads, the body limit and the rate limits. No secret or token is printed, and the server's output is searched for them at the end.
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomBytes } from 'node:crypto'
import { makeService } from '../packages/kybernos-db/agent/service.mjs'
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
let output = ''

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
  server = spawn(process.execPath, ['--no-warnings', 'server.js'], { cwd: app, env: { PATH: process.env.PATH, PORT: String(port), KB_AUTH_SECRET: authSecret, KB_BOOT_KEY: bootHex, KB_DATA_DIR: data, KB_TRUST_PROXY: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
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
    constructor (ip) { this.ip = ip; this.jar = new Map(); this.token = null }
    keep (res) { for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); const name = kv.slice(0, i); const val = kv.slice(i + 1); if (val === '' || /max-age=0/i.test(c)) this.jar.delete(name); else this.jar.set(name, val) } }
    get cookie () { return [...this.jar].map(([k, v]) => k + '=' + v).join('; ') }
    has (part) { return [...this.jar.keys()].some((k) => k.includes(part)) }
    async csrf () { if (this.token === null) { const r = await this.fetch('/api/csrf', { csrf: false }); this.token = (await r.json()).token } return this.token }
    /** `json` or `form` or `body`; `origin: null` sends none; `csrf: false` sends no token. */
    async fetch (path, { method = 'GET', json, form, body, headers = {}, origin = BASE, csrf = true } = {}) {
      const h = { 'x-forwarded-for': this.ip, ...headers }
      if (origin !== null) h.origin = origin
      let payload = body
      if (json !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(json) }
      if (form !== undefined) { h['content-type'] = 'application/x-www-form-urlencoded'; payload = new URLSearchParams(form).toString() }
      if (method !== 'GET' && csrf && h['x-csrf-token'] === undefined && form === undefined) h['x-csrf-token'] = await this.csrf()
      if (form !== undefined && csrf && form._csrf === undefined) payload = new URLSearchParams({ ...form, _csrf: await this.csrf() }).toString()
      if (this.cookie !== '') h.cookie = this.cookie
      const res = await fetch(BASE + path, { method, headers: h, body: payload, redirect: 'manual' }).catch((e) => { e.message += ' (' + method + ' ' + path.split('?')[0] + ')'; throw e })
      this.keep(res)
      return res
    }
    async j (path, o) { const r = await this.fetch(path, o); return { status: r.status, body: await r.json().catch(() => null) } }
  }
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
  const big = await owner.fetch('/api/apps/shop/write', { method: 'POST', body: JSON.stringify({ object: 'note', op: 'create', values: { body: 'x'.repeat(1.2 * 1024 * 1024) } }), headers: { 'content-type': 'application/json' } })
  check('a JSON body over 1 MiB is refused (413)', big.status === 413)
  await sleep(300) // the server answers before reading the whole body and drops that connection: let the client notice before it reuses one

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

  // ── 12. rate limits (each « browser » has its own address, so only these trip) ──
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
}

try {
  await main()
} catch (e) {
  fails++
  console.log('FAIL the check crashed: ' + String((e && e.stack) || e).split('\n').slice(0, 4).join(' | ') + (e && e.cause ? ' | cause: ' + String(e.cause.code || e.cause.message || e.cause) : '') + ' | server output tail: ' + output.split('\n').filter(Boolean).slice(-4).join(' / ').slice(-400))
} finally {
  if (server !== null) {
    server.kill('SIGTERM')
    await sleep(400)
  }
  // nothing secret may have reached the server's output: the secrets, a minted link or a password
  const leaked = ['owner-password-one', 'owner-password-two', 'member-password-1', 'session_token', '/open?t=', '/invite?t='].filter((s) => output.includes(s))
  console.log('\n' + (leaked.length === 0 ? 'ok   ' : 'FAIL ') + 'the server output holds no password, token or link (' + output.split('\n').filter(Boolean).length + ' lines)')
  if (leaked.length > 0) fails++
  rmSync(root, { recursive: true, force: true })
}
console.log('\n' + total + ' checks in ' + Math.round((Date.now() - t0) / 1000) + ' s; node ' + process.version)
console.log(fails === 0 ? 'ALL OK' : fails + ' FAILED')
process.exit(fails === 0 ? 0 : 1)
