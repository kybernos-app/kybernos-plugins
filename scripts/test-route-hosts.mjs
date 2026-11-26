// ── No plugin route answers a page that rebinds its own name to this machine ─────────────────────────────────────────
//
// DSH serves plugin routes BEFORE its own authentication, and the Host fence of its own `/api` does not cover them: every bundle's guard is the
// only fence. A page on `attacker.example` whose DNS answer is switched to 127.0.0.1 (DNS rebinding) reaches the routes of the person's DSH with
// `Host: attacker.example:<port>`, no cookie, and (for a write) `Origin: http://attacker.example:<port>` — the same authority twice, so a guard
// that compares the Origin with the Host header passes it. The guards that compare the Origin with the socket's real address already refuse
// the write but answered the reads (and every request that carries no Origin).
//
// Measured in the pre-production acceptance of 2026-10-10 against a real DSH: Host = Origin = attacker.example reached memory/add and
// space/create (kybernos-cloud), the E2B sandboxes' exec and key routes (kybernos-computers), the local lessons (kybernos-memory), the
// local-model installer (kybernos-modeles-locaux), the models' annotations and scores (kybernos-models), the slash commands, and the reads
// of a dozen more.
//
// This test mounts every bundle's routes on a REAL socket and sends each route the headers a rebound page sends: a GET and a POST with a
// foreign Host and no Origin, and a POST with the foreign authority as Host AND Origin. Every answer must be a refusal (403) or "no such
// method" (404 / 405), never the route's own answer. A bundle that cannot be mounted here must be listed in NOT_MOUNTED with the test that
// covers it, so the list cannot grow silently.
//
//   node scripts/test-route-hosts.mjs
import http from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const home = mkdtempSync(join(tmpdir(), 'kb-route-hosts-'))
process.env.HOME = home
process.env.DSH_HOME = join(home, '.dsh')
process.env.USERPROFILE = home
for (const key of ['KYBERNOS_CLOUD_STATE', 'KYBERNOS_SERVERS_FILE']) delete process.env[key]
process.env.KYBERNOS_CLOUD_API = 'http://127.0.0.1:9' // nothing listens: a bundle that boots cannot reach a real server from this test
mkdirSync(process.env.DSH_HOME, { recursive: true })

// Bundles whose routes are not mounted by this test, and where they are proven instead (none today: the master bundle is mounted with a bare `fs`).
const NOT_MOUNTED = {
  // extends engine classes (SubprocessRuntime, SandboxProvider): it only loads inside an engine profile, and it registers no web route; kybernos-host/payload/test-boot.mjs boots it for real
  'kybernos-no-process': 'kybernos-host/payload/test-boot.mjs',
}

// Routes that are PUBLIC BY DESIGN: a website's widget and its API (loaded from another site) and the webhook receiver (called by another service, secret
// in the request). They are reached under any host name through a tunnel, so the Host fence leaves them out and their own secret or scope is their fence.
// The list is exact: a route reached here that is not in it fails, and an entry that is no longer mounted fails too (it would be a stale hole in the fence).
const PUBLIC_BY_DESIGN = {
  'kybernos-plugin': ['/kybernos/widget.js', '/kybernos/widget/api/config', '/kybernos/widget/api/conversations', '/kybernos/widget/api/message',
    '/kybernos/widget/api/account', '/kybernos/widget/api/history-delete', '/kybernos/widget/api/reply', '/kybernos/hooks'],
}

let failed = 0
const check = (label, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + label + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}

/** A web-server service that keeps what is registered. */
const makeService = () => {
  const routes = []
  const register = (r) => { routes.push(r); return () => {} }
  return { routes, service: { register, registerRoute: register } }
}

/** The routes a bundle registers, by `apply` with a permissive context, else by the exported `monterRoutes`. */
const mount = async (pkg) => {
  const entry = join(root, 'packages', pkg, 'index.js')
  const { routes, service } = makeService()
  const services = { webServer: service, fs: {} }
  const ctx = new Proxy({
    get: (name) => services[name],
    inject: (_list, cb) => { try { cb(ctx) } catch (e) { /* a service that is not here */ } },
    effect: (fn) => { try { return fn() } catch (e) { return undefined } },
    on: () => {},
    systemPrompt: { context: () => {} },
    tools: { register: () => () => {} },
    config: {},
    log: { info: () => {}, warn: () => {}, error: () => {} },
    webServer: service,
  }, { get: (t, k) => (k in t ? t[k] : (() => undefined)) })
  let mod
  try { mod = await import(pathToFileURL(entry).href) } catch (e) { return { routes, error: 'import: ' + String(e.message).slice(0, 100) } }
  const apply = typeof mod.apply === 'function' ? mod.apply : (mod.default !== undefined && typeof mod.default.apply === 'function' ? mod.default.apply : null)
  if (apply !== null) {
    try { await Promise.race([Promise.resolve(apply(ctx)), new Promise((r) => setTimeout(r, 3000))]) } catch (e) { /* what registered before it threw still counts */ }
  }
  if (routes.length === 0 && typeof mod.monterRoutes === 'function') {
    const dir = join(home, pkg)
    mkdirSync(dir, { recursive: true })
    const opts = { home: dir, kybersHome: join(dir, 'kybers'), reglagesPath: join(dir, 'settings.json'), sessionsAutoPath: join(dir, 'auto-sessions.json'), sessionsHome: join(dir, 'sessions'), dshHome: dir }
    const store = { lire: () => ({}), ecrire: () => {}, get: () => ({}), set: () => {}, state: () => ({}) }
    for (const args of [[service, opts], [service, store], [service]]) {
      try { mod.monterRoutes(...args) } catch (e) { /* another shape */ }
      if (routes.length > 0) break
    }
  }
  return { routes }
}

const probe = (port, method, path, headers) => new Promise((resolve) => {
  const body = method === 'POST' ? '{}' : null
  const req = http.request({ host: '127.0.0.1', port, path, method, headers: { ...headers, ...(body === null ? {} : { 'content-type': 'application/json', 'content-length': '2' }) } }, (res) => {
    res.resume()
    res.on('end', () => resolve(res.statusCode))
    res.on('error', () => resolve(0))
  })
  req.on('error', () => resolve(0))
  req.setTimeout(3500, () => { req.destroy(); resolve(-1) })
  if (body !== null) req.write(body)
  req.end()
})

const REFUSED = new Set([403, 404, 405, 0, -1, 599])
let mounted = 0
let routeCount = 0
const packages = readdirSync(join(root, 'packages')).filter((p) => existsSync(join(root, 'packages', p, 'index.js'))).sort()
for (const pkg of packages) {
  if (NOT_MOUNTED[pkg] !== undefined) continue
  const { routes, error } = await mount(pkg)
  if (routes.length === 0) {
    // A bundle with no web routes at all is fine; one that could not be imported is a hole in this test.
    check(pkg + ': mounts routes here, or registers none', error === undefined, error)
    continue
  }
  const server = http.createServer((req, res) => {
    const p = new URL(req.url, 'http://x').pathname
    const r = routes.find((x) => x.path === p || (x.kind === 'prefix' && p.startsWith(x.path)))
    if (r === undefined) { res.writeHead(404); res.end(); return }
    const timer = setTimeout(() => { try { res.writeHead(599); res.end() } catch (e) { /* closed */ } }, 3000)
    res.on('close', () => clearTimeout(timer))
    try { Promise.resolve(r.handler(req, res)).catch(() => { try { res.writeHead(500); res.end() } catch (e) { /* closed */ } }) } catch (e) { try { res.writeHead(500); res.end() } catch (e2) { /* closed */ } }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const attacker = 'attacker.example:' + port
  const reached = []
  const seen = new Set()
  for (const r of routes) {
    if (typeof r.path !== 'string' || seen.has(r.path)) continue
    seen.add(r.path)
    const answers = [
      ['GET Host=attacker', await probe(port, 'GET', r.path, { host: attacker })],
      ['POST Host=attacker', await probe(port, 'POST', r.path, { host: attacker })],
      ['POST Host=Origin=attacker', await probe(port, 'POST', r.path, { host: attacker, origin: 'http://' + attacker })],
    ]
    for (const [label, status] of answers) if (!REFUSED.has(status)) reached.push({ path: r.path, text: r.path + ' (' + label + ' → ' + status + ')' })
  }
  server.close()
  mounted += 1
  routeCount += seen.size
  const open = new Set(PUBLIC_BY_DESIGN[pkg] || [])
  const unexpected = reached.filter((x) => open.has(x.path) !== true)
  check(pkg + ': ' + seen.size + ' route(s), none but the public ones answers a rebound Host', unexpected.length === 0, unexpected.slice(0, 6).map((x) => x.text).join('; ') + (unexpected.length > 6 ? ' … +' + (unexpected.length - 6) : ''))
  if (open.size > 0) {
    const stale = [...open].filter((p) => seen.has(p) !== true)
    check(pkg + ': every public-by-design route is still mounted (no stale entry)', stale.length === 0, stale.join(', '))
  }
}
console.log('\n' + mounted + ' bundles mounted, ' + routeCount + ' routes probed')
if (failed > 0) { console.log(failed + ' check(s) FAILED'); process.exit(1) }
console.log('all checks OK')
process.exit(0)
