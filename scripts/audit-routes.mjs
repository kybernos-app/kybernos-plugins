// ── The table of every host route the bundles mount ──────────────────────────────────────────────────────────────────
//
// DSH serves plugin routes BEFORE its own authentication (measured), so each bundle's guard is the only fence of its routes. This script
// builds the table that says, for every route, which methods it answers, how strongly each one is guarded, and who calls it. It is the
// evidence behind the origin rule (docs/dev/route-origin-rule.md): what was changed, and what was left open and why.
//
//   node scripts/audit-routes.mjs                  the summary: routes by guard level, by bundle, and the write routes left open
//   node scripts/audit-routes.mjs --table          every route, one line each (bundle, path, per-method level, callers)
//   node scripts/audit-routes.mjs --json           the raw rows
//   node scripts/audit-routes.mjs --check          the origin rule, enforced: exit 1 when a write route that an Origin alone lets through is not written down, with its reason, in
//                                                  scripts/route-guard-exceptions.mjs (or when an entry there matches no such route any more); CI runs it through scripts/test-route-guards.mjs
//                                                  It also fails on a host source that reads a request with no cap (scripts/lib-body-reads.mjs: `req.on('data', …)` or
//                                                  `for await (… of req)` with no length compared with a limit), so a route cannot go back to `corps += d` (recette L3-43)
//   node scripts/audit-routes.mjs --bundle NAME    only the routes of one bundle
//   node scripts/audit-routes.mjs --root DIR       judge another checkout (a `git archive` of an earlier commit gives the "before" column)
//   node scripts/audit-routes.mjs --tunnel-probes JSON   for the routes it names, also send bodies with the phone-link marker (see scripts/test-tunnel-routes.mjs, which owns the table)
//
// Needs Node 22.13 or later (`--permission`). It is read-only and offline by construction, not by promise: the worker runs under Node's permission model (`--permission`), which
// denies spawning a process, every network call, and every write outside a throw-away folder, and it can read only the checkout and that
// folder. The home folder it hands the bundles is that folder (a fake DSH home with a fake session secret), never the person's.
// Handlers are called in-process with fake request and response objects: there is no socket and no listening port.
//
// Per route and method it sends five requests (Host = the listener's own, so the Host fence is never what answers):
//   A  a foreign Origin, no cookie        B  no Origin, no cookie
//   C  the right Origin, no cookie        D  the right Origin and DSH's signed session cookie
//   E  D plus the phone-link marker (`x-kybernos-tunnel`): what a paired phone's request looks like once the computer has replayed it
// A 401 or 403 is a refusal; a 405 (on D) means the route does not answer that method. From the four answers, a method is:
//   open          A passes: a page of any site can drive it
//   origin        A refused, B passes: a foreign page is refused, any local program (no header) is not
//   strict        B refused, C passes: an Origin or Referer is required, but a local program can send one
//   cookie        C refused, D passes: needs DSH's signed browser-session cookie too (what kybernos-terminal's run route does)
//   closed        D is refused as well (needs a state this fake home does not have: read the statuses)
import { spawnSync } from 'node:child_process'
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { Readable, Writable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = realpathSync(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const option = (name) => { const i = argv.indexOf(name); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null }

const PORT = 3080 // the listener's port as the fake socket reports it (nothing listens)
const HOST = '127.0.0.1:' + PORT
const FOREIGN = 'http://evil.example'
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const REFUSED = new Set([401, 403])
const NOT_SERVED = new Set([405]) // a 404 is the route's own answer to an empty body ("no such worker"), not the path missing: it is mounted
const LEVELS = ['open', 'origin', 'strict', 'cookie', 'closed']
const TUNNEL_HEADER = 'x-kybernos-tunnel'
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

// ── Parent: build the throw-away home, then run the worker under the permission model ─────────────────────────────
if (flag('--worker') === false) {
  const root = realpathSync(option('--root') ?? join(dirname(HERE), '..'))
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'kb-audit-routes-')))
  const home = join(tmp, 'home')
  mkdirSync(join(home, '.dsh'), { recursive: true })
  // The fake DSH session secret, in the record the bundles read (`client-connection/browser-session`).
  writeFileSync(join(home, '.dsh', '.credentials.yaml'), 'client-connection/browser-session:\n  secret: ' + b64url(randomBytes(32)) + '\n')
  const run = spawnSync(process.execPath, [
    '--permission', '--allow-fs-read=' + root, '--allow-fs-read=' + dirname(HERE), '--allow-fs-read=' + tmp, '--allow-fs-write=' + tmp,
    HERE, '--worker', '--root', root, '--tmp', tmp, ...argv.filter((a, i) => a !== '--root' && argv[i - 1] !== '--root'),
  ], {
    stdio: ['ignore', 'inherit', 'inherit'], timeout: 15 * 60 * 1000,
    // A clean environment: no key, token or path of the person reaches a bundle.
    env: { PATH: '/usr/bin:/bin', HOME: home, USERPROFILE: home, DSH_HOME: join(home, '.dsh'), TMPDIR: tmp, LANG: 'C', KYBERNOS_CLOUD_API: 'http://127.0.0.1:9' },
  })
  try { rmSync(tmp, { recursive: true, force: true }) } catch (e) { /* the system clears its temp folder */ }
  process.exit(run.status ?? 1)
}

// ── Worker ────────────────────────────────────────────────────────────────────────────────────────────────────
const root = option('--root')
const tmp = option('--tmp')
const secret = Buffer.from(/secret:\s*(\S+)/.exec(readFileSync(join(tmp, 'home', '.dsh', '.credentials.yaml'), 'utf8'))[1].replaceAll('-', '+').replaceAll('_', '/'), 'base64')
// An async failure inside a handler must not end the run: it is that route's answer.
process.on('uncaughtException', () => {})
process.on('unhandledRejection', () => {})
// The bundles log while they mount and answer: only this script writes to the output.
const out = (text) => process.stdout.write(text + '\n')
for (const level of ['log', 'info', 'warn', 'error', 'debug']) console[level] = () => {}

/** DSH's session cookie for the listener's authority, signed like DSH does (docs/dev/live-testing.md). */
const sessionCookie = () => {
  const body = b64url(Buffer.from(JSON.stringify({ version: 1, authority: HOST, issuedAt: Date.now(), expiresAt: Date.now() + 3600_000 })))
  return 'dsh-auth-' + b64url(createHash('sha256').update(HOST).digest()) + '=v1.' + body + '.' + b64url(createHmac('sha256', secret).update(body).digest())
}

/** A web-server service that keeps what is registered. */
const makeService = () => {
  const routes = []
  const register = (r) => { routes.push(r); return () => {} }
  return { routes, service: { register, registerRoute: register } }
}

/** The routes a bundle registers, by `apply` with a permissive context, else by the exported `monterRoutes` (as scripts/test-route-hosts.mjs does). */
const mount = async (pkg) => {
  const { routes, service } = makeService()
  const services = { webServer: service, fs: {} }
  const ctx = new Proxy({
    get: (name) => services[name],
    inject: (_list, cb) => { try { cb(ctx) } catch (e) { /* a service that is not here */ } },
    effect: (fn) => { try { return fn() } catch (e) { return undefined } },
    on: () => {}, systemPrompt: { context: () => {} }, tools: { register: () => () => {} }, config: {},
    log: { info: () => {}, warn: () => {}, error: () => {} }, webServer: service,
  }, { get: (t, k) => (k in t ? t[k] : (() => undefined)) })
  try {
    let mod
    try { mod = await import(pathToFileURL(join(root, 'packages', pkg, 'index.js')).href) } catch (e) { return { routes, error: 'import: ' + String(e.message).slice(0, 120) } }
    const apply = typeof mod.apply === 'function' ? mod.apply : (mod.default !== undefined && typeof mod.default.apply === 'function' ? mod.default.apply : null)
    if (apply !== null) {
      try { await Promise.race([Promise.resolve(apply(ctx)), new Promise((r) => setTimeout(r, 3000))]) } catch (e) { /* what registered before it threw still counts */ }
    }
    if (routes.length === 0 && typeof mod.monterRoutes === 'function') {
      const dir = join(tmp, pkg)
      mkdirSync(dir, { recursive: true })
      const opts = { home: dir, kybersHome: join(dir, 'kybers'), reglagesPath: join(dir, 'settings.json'), sessionsAutoPath: join(dir, 'auto-sessions.json'), sessionsHome: join(dir, 'sessions'), dshHome: dir }
      const store = { lire: () => ({}), ecrire: () => {}, get: () => ({}), set: () => {}, state: () => ({}) }
      for (const args of [[service, opts], [service, store], [service]]) {
        try { mod.monterRoutes(...args) } catch (e) { /* another shape */ }
        if (routes.length > 0) break
      }
    }
  } finally { /* nothing to restore: the console stays silent, see `out` */ }
  return { routes }
}

/** A request the way a handler reads it: a stream with headers, a method, a url and a socket that knows the listener's port. */
const fakeRequest = (method, path, headers, body) => {
  const req = Readable.from(body === null ? [] : [Buffer.from(body)], { objectMode: false })
  req.method = method
  req.url = path
  req.headers = headers
  req.httpVersion = '1.1'
  req.socket = req.connection = { localPort: PORT, remoteAddress: '127.0.0.1', remotePort: 50000, encrypted: false, destroyed: false, setTimeout: () => {}, on: () => {}, destroy: () => {} }
  return req
}
class FakeResponse extends Writable {
  constructor () { super(); this.statusCode = 200; this.headersSent = false; this.chunks = []; this.headerMap = {}; this.socket = null }
  setHeader (k, v) { this.headerMap[String(k).toLowerCase()] = v; return this }
  getHeader (k) { return this.headerMap[String(k).toLowerCase()] }
  getHeaders () { return { ...this.headerMap } }
  hasHeader (k) { return String(k).toLowerCase() in this.headerMap }
  removeHeader (k) { delete this.headerMap[String(k).toLowerCase()] }
  writeHead (status, a, b) {
    this.statusCode = status
    const headers = a !== null && typeof a === 'object' ? a : b
    if (headers !== null && typeof headers === 'object') for (const [k, v] of Object.entries(headers)) this.setHeader(k, v)
    this.headersSent = true
    return this
  }
  flushHeaders () { this.headersSent = true }
  setTimeout () { return this }
  get finished () { return this.writableEnded }
  _write (chunk, _enc, cb) { this.headersSent = true; if (this.chunks.length < 4) this.chunks.push(Buffer.from(chunk)); cb() }
}

/** What a handler answers to one request: its status (0: nothing was written before the time ran out), and the start of the body. */
const ask = (route, method, origin, withCookie, extraHeaders = {}, bodyText = '{}') => new Promise((resolve) => {
  const headers = { host: HOST, ...extraHeaders }
  if (origin !== null) headers.origin = origin
  if (withCookie) headers.cookie = sessionCookie()
  const body = method === 'GET' ? null : bodyText
  if (body !== null) { headers['content-type'] = 'application/json'; headers['content-length'] = String(Buffer.byteLength(body)) }
  const path = route.kind === 'prefix' ? route.path + (route.path.endsWith('/') ? '' : '/') + 'audit-probe' : route.path
  const req = fakeRequest(method, path, headers, body)
  const res = new FakeResponse()
  let settled = false
  const done = (hung) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    resolve({ status: res.headersSent ? res.statusCode : 0, hung, body: Buffer.concat(res.chunks).toString('utf8').slice(0, 300) })
    try { res.destroy() } catch (e) { /* closed */ }
  }
  const timer = setTimeout(() => done(true), 600)
  res.on('finish', () => done(false))
  try { Promise.resolve(route.handler(req, res)).catch(() => done(false)) } catch (e) { done(false) }
})

/** The guard level of one method from the four answers (see the header). */
const levelOf = (a, b, c, d) => {
  if (REFUSED.has(d.status) || NOT_SERVED.has(d.status)) return 'closed'
  if (REFUSED.has(c.status)) return 'cookie'
  if (REFUSED.has(b.status)) return 'strict'
  if (REFUSED.has(a.status)) return 'origin'
  return 'open'
}

const probeRoute = async (route) => {
  const methods = {}
  const all = await Promise.all(METHODS.map((m) => ask(route, m, 'http://' + HOST, true)))
  await Promise.all(METHODS.map(async (m, i) => {
    if (NOT_SERVED.has(all[i].status)) return
    const [a, b, c, e] = await Promise.all([ask(route, m, FOREIGN, false), ask(route, m, null, false), ask(route, m, 'http://' + HOST, false), ask(route, m, 'http://' + HOST, true, { [TUNNEL_HEADER]: '1' })])
    methods[m] = { level: levelOf(a, b, c, all[i]), A: a.status, B: b.status, C: c.status, D: all[i].status, E: e.status, ...(m === 'GET' ? { sample: a.body } : {}) }
  }))
  return methods
}

// ── Where a route is defined, and who calls it ─────────────────────────────────────────────────────────────────
const SKIP_DIR = new Set(['node_modules', '.git', '.claude', 'vendor'])
const TEXT = /\.(m?js|cjs|json|md|ya?ml|sh|html)$/
const sources = [] // { file (repo-relative), text }
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (TEXT.test(entry.name) && statSync(full).size < 3 * 1024 * 1024 && /\.min\./.test(entry.name) === false) sources.push({ file: relative(root, full), text: readFileSync(full, 'utf8') })
  }
}
for (const top of ['packages', 'scripts', 'docs', 'services', 'catalog']) if (existsSync(join(root, top))) walk(join(root, top))

const isTest = (file) => /(^|\/)(test[-.][^/]*|[^/]*\.test\.[^/]*|lib-test[^/]*)$/.test(file) || /\/test\//.test(file)
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** `file:line` of the first non-test host source that spells the path out, and the comment right above (or beside) it. */
const definition = (bundle, path) => {
  const re = new RegExp("['\"`]" + escapeRe(path) + "['\"`/?]")
  for (const s of sources) {
    if (s.file.startsWith('packages/' + bundle + '/') === false || /client[^/]*\.js$/.test(s.file) || isTest(s.file) || /\.(md|json)$/.test(s.file)) continue
    const lines = s.text.split('\n')
    const at = lines.findIndex((l) => re.test(l))
    if (at < 0) continue
    const above = []
    for (let i = at - 1; i >= 0 && i >= at - 4 && /^\s*(\/\/|\/\*|\*)/.test(lines[i]); i -= 1) above.unshift(lines[i].replace(/^\s*(\/\/+|\/\*+|\*+\/?)\s?/, '').trim())
    const beside = /\/\/\s*(.+)$/.exec(lines[at])
    const what = (above.join(' ') || (beside === null ? '' : beside[1])).replace(/\s+/g, ' ').slice(0, 160)
    return { where: s.file + ':' + (at + 1), what }
  }
  return { where: '', what: '' }
}

/** Who spells the path out: the bundle's own page, another bundle, a script, a live check, a skill or document (tests are left out). */
const callers = (bundle, path, definedIn) => {
  const re = new RegExp(escapeRe(path) + "(?![A-Za-z0-9_\\-/])")
  const found = new Set()
  for (const s of sources) {
    if (isTest(s.file) || s.file === definedIn || re.test(s.text) === false) continue
    const owner = /^packages\/([^/]+)\//.exec(s.file)
    if (/\.md$/.test(s.file)) found.add(/SKILL\.md$|\/skills\//.test(s.file) ? 'skill:' + (owner === null ? s.file : owner[1]) : 'doc')
    else if (/^scripts\/check-.*-live\.mjs$|^scripts\/live-page\.mjs$|^scripts\/audit-/.test(s.file)) found.add('live-check')
    else if (s.file.startsWith('scripts/')) found.add('script:' + s.file.slice(8))
    else if (owner !== null && /client[^/]*\.js$/.test(s.file) && owner[1] === bundle) found.add('page')
    else if (owner !== null && /client[^/]*\.js$/.test(s.file)) found.add('page:' + owner[1])
    else if (owner !== null && owner[1] === bundle) found.add(/tools\.register|registerTool/.test(s.text) ? 'tool' : 'bundle-host')
    else if (owner !== null) found.add('bundle:' + owner[1])
  }
  return [...found].sort()
}

// ── Run ───────────────────────────────────────────────────────────────────────────────────────────────────────
const only = option('--bundle')
// Routes whose phone-link behaviour depends on the body: `[{ bundle, path, read: {...}, writes: [{...}] }]`. Each body is sent as a POST with the right Origin, the cookie and the marker.
const tunnelProbes = JSON.parse(option('--tunnel-probes') ?? '[]')
const rows = []
const problems = []
// Engine-only bundles extend engine classes, so they cannot be imported outside an engine profile, and they register no web route (test-routes-unload.mjs says the same).
const ENGINE_ONLY = new Set(['kybernos-no-process'])
const bundles = readdirSync(join(root, 'packages')).filter((p) => existsSync(join(root, 'packages', p, 'index.js')) && ENGINE_ONLY.has(p) === false && (only === null || only === p)).sort()
for (const bundle of bundles) {
  const { routes, error } = await mount(bundle)
  if (error !== undefined) problems.push(bundle + ': ' + error)
  const seen = new Set()
  const unique = routes.filter((r) => typeof r.path === 'string' && typeof r.handler === 'function' && seen.has(r.path) === false && seen.add(r.path))
  for (let i = 0; i < unique.length; i += 6) {
    await Promise.all(unique.slice(i, i + 6).map(async (route) => {
      const methods = await probeRoute(route)
      const def = definition(bundle, route.path)
      const wanted = tunnelProbes.find((p) => p.path === route.path && (p.bundle === undefined || p.bundle === bundle))
      const marker = { [TUNNEL_HEADER]: '1' }
      const tunnel = wanted === undefined ? undefined : { read: await ask(route, 'POST', 'http://' + HOST, true, marker, JSON.stringify(wanted.read)), writes: await Promise.all(wanted.writes.map((w) => ask(route, 'POST', 'http://' + HOST, true, marker, JSON.stringify(w)))) }
      rows.push({ bundle, path: route.path, kind: route.kind, methods, ...(tunnel === undefined ? {} : { tunnel }), ...def, callers: callers(bundle, route.path, def.where.replace(/:\d+$/, '')) })
    }))
  }
}
rows.sort((x, y) => (x.bundle + x.path < y.bundle + y.path ? -1 : 1))

const writeLevels = (row) => Object.entries(row.methods).filter(([m]) => WRITES.has(m)).map(([m, v]) => [m, v.level])
/** A route that answers at least one write method. A route that answers every method the same way takes any method for a read: it is listed apart. */
const anyMethod = (row) => Object.keys(row.methods).length === METHODS.length
const isWrite = (row) => writeLevels(row).length > 0 && anyMethod(row) === false
const weakest = (levels) => levels.reduce((w, l) => (LEVELS.indexOf(l) < LEVELS.indexOf(w) ? l : w), 'closed')
const rowLevel = (row) => weakest(writeLevels(row).map(([, l]) => l))

if (flag('--json')) {
  out(JSON.stringify({ rows, problems }, null, 1))
  process.stdout.write('', () => process.exit(0))
  await new Promise(() => {})
}

const count = (list, key) => list.reduce((acc, r) => { acc[key(r)] = (acc[key(r)] ?? 0) + 1; return acc }, {})
const writeRows = rows.filter(isWrite)
const getRows = rows.filter((r) => r.methods.GET !== undefined)
out(rows.length + ' routes mounted by ' + new Set(rows.map((r) => r.bundle)).size + ' bundles; ' + writeRows.length + ' answer a write method (POST, PUT, PATCH, DELETE), ' +
  rows.filter(anyMethod).length + ' answer every method alike, ' + getRows.length + ' answer GET')
out('write routes by guard level (the weakest of their write methods): ' + JSON.stringify(count(writeRows, rowLevel)))
out('every-method routes by guard level (judged on POST):            ' + JSON.stringify(count(rows.filter(anyMethod), (r) => r.methods.POST.level)))
out('GET routes by guard level:                                       ' + JSON.stringify(count(getRows, (r) => r.methods.GET.level)))
for (const p of problems) out('! ' + p)
// The phone link: a write that reaches a cookie-guarded route through the tunnel (the right Origin, the real cookie, the marker) must be refused (403).
const tunnelPasses = writeRows.flatMap((r) => writeLevels(r).filter(([m, l]) => l === 'cookie' && r.methods[m].E !== 403).map(([m]) => r.bundle + ' ' + m + ' ' + r.path + ' -> ' + r.methods[m].E))
out('cookie-guarded writes a tunnelled request still passes: ' + tunnelPasses.length + (tunnelPasses.length === 0 ? '' : '\n  ' + tunnelPasses.join('\n  ')))

// The origin rule, enforced (--check): a write route that an Origin alone lets through must be written down with its reason in scripts/route-guard-exceptions.mjs (lib-route-guards.mjs is
// the judge); a route that is not, an entry that matches no such route any more, an entry with no reason, and a bundle that could not be mounted (its routes would vanish from the table)
// all fail the run with exit status 1. scripts/test-route-guards.mjs runs this in CI.
let exitCode = 0
if (flag('--check')) {
  const { judge, report } = await import(pathToFileURL(join(dirname(HERE), 'lib-route-guards.mjs')).href)
  let lists = null
  try { lists = await import(pathToFileURL(join(root, 'scripts', 'route-guard-exceptions.mjs')).href) } catch (e) { lists = null; out('! --check: scripts/route-guard-exceptions.mjs cannot be read in ' + root + ' (' + String(e && e.message).slice(0, 100) + ')') }
  const verdict = lists === null ? null : judge(rows, lists.EXCEPTIONS, lists.QUEUED)
  if (verdict !== null) out('\n' + report(verdict))
  exitCode = verdict !== null && verdict.ok === true && problems.length === 0 ? 0 : 1
  out(exitCode === 0 ? 'route guard check: OK' : 'route guard check: FAILED')
  // The body rule, enforced by text (lib-body-reads.mjs says what it catches and what it cannot): no host source reads a request with a loop that grows with what is sent.
  const { unboundedReads, reportBodyReads } = await import(pathToFileURL(join(dirname(HERE), 'lib-body-reads.mjs')).href)
  const unbounded = unboundedReads(sources)
  out('\n' + reportBodyReads(unbounded))
  if (unbounded.length > 0) exitCode = 1
  out(unbounded.length === 0 ? 'request body check: OK' : 'request body check: FAILED')
}

const line = (r) => r.bundle.padEnd(24) + r.path.padEnd(52) + Object.entries(r.methods).map(([m, v]) => m + ':' + v.level).join(' ').padEnd(40) + ' ' + r.callers.join(',')
if (flag('--check')) {
  // nothing more: the report above is the output
} else if (flag('--table')) {
  out('\n' + rows.map(line).join('\n'))
} else {
  out('\nwrite routes at "open" or "origin" (a program with no header, or any site, can drive them):')
  out(writeRows.filter((r) => rowLevel(r) === 'open' || rowLevel(r) === 'origin').map(line).join('\n'))
  out('\nwrite routes at "strict" (an Origin is required but a local program can send one):')
  out(writeRows.filter((r) => rowLevel(r) === 'strict').map(line).join('\n'))
}
// Bundles leave timers and watchers behind: end explicitly, once the output is flushed.
process.stdout.write('', () => process.exit(exitCode))
