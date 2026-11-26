// Request bodies are bounded (recette 2026-10-25, fix 14: L3-43, L3-51).
//
// A POST of 540 MB with no Origin ended DSH with all its sessions: `corps += d` in the 'data' listener of kybernos-auto raised `RangeError: Invalid string length`
// past 512 MB, in a callback nobody catches, and the same unbounded read sat in kybernos-sessions, -bricks, -miniapps and -modeleur. Each of these bundles now counts the
// bytes as they arrive (the rule of `readBody(req, cap)` in kybernos-search/guard.mjs, copied into each bundle) and answers 413 past the cap of the route.
//
// One table, one row per bundle: the routes that read a body with their cap in bytes, and the routes that never do. A route that is in neither list fails the test, so a new
// route cannot be forgotten. For each route that reads a body, three things are played:
//   1. over the cap, on a real socket: a body of cap + 1 KiB, sent in chunks, answers 413 with `Connection: close` and a JSON refusal (`ok: false`);
//   2. at the cap: a body of exactly `cap` bytes (`{}` and blanks) is NOT refused (the limit is not off by one, and the route still answers what it answered before);
//   3. an endless stream (never sent for real: a stand-in request that pushes 16 KiB blocks for as long as someone reads it, up to cap + 2 MiB): the route answers 413 and the
//      stream is destroyed after at most a few blocks past the cap, so what a hostile sender can make DSH read is bounded by the cap, not by what it sends.
// And nothing in the whole run may end the process (no uncaught exception, no unhandled rejection).
//
// The discovery document of kybernos-servers (L3-25) has its own test (packages/kybernos-servers/test-discovery.mjs, SRV-05): a response, not a request.
//
// Last, the text check of scripts/lib-body-reads.mjs (also run by `node scripts/audit-routes.mjs --check`): fixtures that must be caught and accepted, then the real tree. It
// is a net for the old mistake (`req.on('data', (d) => { corps += d })`, a loop that grows with what is sent), not a proof; its blind spots are listed in that file.
//
//   node scripts/test-body-caps.mjs
import http from 'node:http'
import { Readable } from 'node:stream'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const KIB = 1024
const MIB = 1024 * KIB
const BLOCK = 16 * KIB
const load = (bundle, file) => import(pathToFileURL(join(ROOT, 'packages', bundle, file)).href)

let failed = 0
let passed = 0
const check = (label, ok, detail) => {
  console.log((ok ? '  ok   ' : '  FAIL ') + label + (ok || detail === undefined ? '' : '  -- ' + String(detail).slice(0, 240)))
  if (ok) passed += 1; else failed += 1
}
setTimeout(() => { console.error('test-body-caps: timed out'); process.exit(2) }, 120_000).unref()

const crashes = []
process.on('uncaughtException', (e) => { crashes.push(String(e && e.stack ? e.stack : e).slice(0, 300)) })
process.on('unhandledRejection', (e) => { crashes.push(String(e && e.stack ? e.stack : e).slice(0, 300)) })

// ── The table ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const BUNDLES = [
  {
    bundle: 'kybernos-auto',
    mount: async (web, home) => {
      const { monterRoutes } = await load('kybernos-auto', 'index.js')
      monterRoutes(web, { home, reglagesPath: join(home, 'settings.json'), sessionsAutoPath: join(home, 'auto-sessions.json'), santePath: join(home, 'auto-health.json'), ollama: 'http://127.0.0.1:1' })
    },
    // 64 KiB: the largest honest body is `settings` with 64 model ids of 200 characters (about 14 KiB); report and router carry one id, a code and one sentence.
    bodies: Object.fromEntries(['session', 'settings', 'report', 'probe', 'router'].map((r) => ['/kybernos-auto/' + r, 64 * KIB])),
    none: ['/kybernos-auto/state', '/kybernos-auto/models'],
  },
  {
    bundle: 'kybernos-sessions',
    mount: async (web, home) => {
      const { monterRoutes } = await load('kybernos-sessions', 'index.js')
      monterRoutes(web, { reglagesPath: join(home, 'settings.json'), categoriesPath: join(home, 'categories.json'), sessionsHome: join(home, 'sessions'), kybersHome: join(home, 'kybers') })
    },
    // 256 KiB: every honest body is a few lines (a session id, a folder, a commit message, at most 50 file paths, the configured models, the `kybers` of a decision).
    bodies: Object.fromEntries(['isolate', 'commit', 'close-check', 'brain/health', 'decision', 'settings', 'categories', 'close', 'reclaim', 'push', 'fetch', 'sync', 'pr'].map((r) => ['/kybernos-sessions/' + r, 256 * KIB])),
    none: ['/kybernos-sessions/state'],
  },
  {
    bundle: 'kybernos-bricks',
    mount: async (web) => {
      const { creerMagasin, monterRoutes } = await load('kybernos-bricks', 'index.js')
      monterRoutes(web, creerMagasin())
    },
    // 2 MiB: `ops` is cut to 4000 batches of about 110 bytes by the store, so an honest push is about 0.5 MiB.
    bodies: { '/kybernos-bricks/push': 2 * MIB },
    none: ['/kybernos-bricks/state'],
  },
  {
    bundle: 'kybernos-modeleur',
    mount: async (web) => {
      const { creerMagasin, monterRoutes } = await load('kybernos-modeleur', 'index.js')
      monterRoutes(web, creerMagasin())
    },
    // 2 MiB: a push is at most 4000 batches (about 110 bytes each); an annotation at most 60 strokes of 800 points (1.8 MB at the very most, a few KB for a real brush).
    bodies: { '/kybernos-modeleur/push': 2 * MIB, '/kybernos-modeleur/annote': 2 * MIB },
    none: ['/kybernos-modeleur/state'],
  },
  {
    bundle: 'kybernos-miniapps',
    // `~/Applications/Kybernos` and `~/Library/LaunchAgents` are read when the module is loaded: the run happens in a throw-away HOME, and uninstall gets an id nothing has.
    mount: async (web, home) => {
      const keep = process.env.HOME
      process.env.HOME = home
      try {
        const { apply } = await load('kybernos-miniapps', 'index.js')
        apply({ get: (n) => (n === 'webServer' ? web : undefined), effect: (fn) => fn(), inject: (_n, fn) => fn() })
      } finally { process.env.HOME = keep }
    },
    // install: 16 MiB, 4 times the 4,000,000 characters of html that `installer` accepts (JSON escapes, UTF-8 takes up to 4 bytes); uninstall: `{ id }`, 8 KiB.
    bodies: { '/kybernos-miniapps/install': 16 * MIB, '/kybernos-miniapps/uninstall': 8 * KIB },
    exact: { '/kybernos-miniapps/uninstall': '{"id":"zz-body-cap-probe"}' },
    none: ['/kybernos-miniapps/list'],
  },
]

// ── What a client and a handler see ─────────────────────────────────────────────────────────────────────────────────────────
/** A POST on a real socket. The body is cut into 16 KiB blocks and written with the socket's back-pressure. */
const post = (port, path, headers, size, filler) => new Promise((resolve) => {
  const req = http.request({ host: '127.0.0.1', port, path, method: 'POST', headers: { 'content-type': 'application/json', ...headers } }, (res) => {
    let text = ''
    res.on('data', (c) => { text += c })
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }))
    res.on('error', (e) => resolve({ error: e.code || String(e) }))
  })
  req.on('error', (e) => resolve({ error: e.code || String(e) }))
  let sent = 0
  const pump = () => {
    while (sent < size) {
      const n = Math.min(BLOCK, size - sent)
      const block = Buffer.alloc(n, 0x20)
      if (sent === 0) filler.copy(block, 0, 0, Math.min(filler.length, n))
      sent += n
      if (req.write(block) === false) { req.once('drain', pump); return }
    }
    req.end()
  }
  pump()
})

/** A stand-in request that pushes blocks for as long as it is read, up to `total` bytes: nothing is stored anywhere. */
const endlessRequest = (route, total) => {
  const stats = { pushed: 0, destroyed: false }
  const block = Buffer.alloc(BLOCK, 0x20)
  const req = new Readable({
    highWaterMark: BLOCK,
    // One block per turn of the event loop, like a socket: a synchronous push would deliver everything before the handler could answer.
    read () {
      setImmediate(() => {
        if (this.destroyed) return
        if (stats.pushed >= total) { this.push(null); return }
        stats.pushed += BLOCK
        this.push(block)
      })
    },
    destroy (err, cb) { stats.destroyed = true; cb(err) },
  })
  Object.assign(req, route)
  return { req, stats }
}
const standInResponse = () => {
  const r = { status: 0, headers: {}, text: '', ended: false, listeners: {} }
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v }
  r.getHeader = (k) => r.headers[String(k).toLowerCase()]
  r.writeHead = (s, h) => { r.status = s; for (const [k, v] of Object.entries(h || {})) r.headers[k.toLowerCase()] = v; return r }
  r.once = (ev, fn) => { (r.listeners[ev] ||= []).push(fn) }
  r.end = (b) => { r.text = b === undefined ? '' : String(b); r.ended = true; for (const fn of r.listeners.finish || []) fn() }
  return r
}
const jsonOf = (text) => { try { return JSON.parse(text) } catch (e) { return null } }

// ── The run ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
for (const spec of BUNDLES) {
  console.log('\n' + spec.bundle)
  const home = mkdtempSync(join(tmpdir(), 'kb-body-caps-'))
  const { SESSION_SECRET, sessionCookie } = await load(spec.bundle, 'lib-session-test.mjs')
  const guard = await load(spec.bundle, 'session-guard.mjs')
  guard.sessionSource.secret = () => SESSION_SECRET
  const routes = {}
  const web = { register: (r) => { routes[r.path] = r.handler; return () => {} } }
  await spec.mount(web, home)

  const registered = Object.keys(routes).sort()
  const declared = [...Object.keys(spec.bodies), ...spec.none].sort()
  check('every route is classified: it reads a body (with its cap) or it never does', JSON.stringify(registered) === JSON.stringify(declared),
    'registered ' + JSON.stringify(registered.filter((p) => declared.indexOf(p) < 0)) + ', declared but not mounted ' + JSON.stringify(declared.filter((p) => registered.indexOf(p) < 0)))

  const server = http.createServer((req, res) => {
    const handler = routes[new URL(req.url, 'http://x').pathname]
    if (handler === undefined) { res.writeHead(404); res.end(); return }
    Promise.resolve(handler(req, res)).catch(() => { try { res.destroy() } catch (e) { /* closed */ } })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  const authority = '127.0.0.1:' + port
  const headers = { origin: 'http://' + authority, cookie: sessionCookie(authority) }

  for (const [path, cap] of Object.entries(spec.bodies)) {
    const name = path
    const over = await post(port, path, headers, cap + KIB, Buffer.from('{"x":"'))
    const refusal = jsonOf(over.text ?? '')
    check(name + ': ' + cap + ' bytes + 1 KiB -> 413, a JSON refusal, the connection closed', over.status === 413 && refusal !== null && refusal.ok === false && String(over.headers['connection']).toLowerCase() === 'close', JSON.stringify({ status: over.status, error: over.error, text: String(over.text).slice(0, 80) }))

    const exact = await post(port, path, headers, cap, Buffer.from((spec.exact ?? {})[path] ?? '{}'))
    check(name + ': exactly the cap is read (not refused)', exact.status !== undefined && exact.status !== 413, JSON.stringify({ status: exact.status, error: exact.error, text: String(exact.text).slice(0, 80) }))

    const route = { method: 'POST', url: path, headers: { 'content-type': 'application/json', ...headers }, socket: { localPort: port } }
    const { req, stats } = endlessRequest(route, cap + 2 * MIB)
    const res = standInResponse()
    // The stand-in response ends the stream the way a real socket would once the answer is out (its 'finish' reaches the handler's `once`).
    await Promise.race([Promise.resolve(routes[path](req, res)), new Promise((r) => setTimeout(r, 4000))])
    await new Promise((r) => setTimeout(r, 50))
    check(name + ': an endless stream is answered 413 and cut within 8 blocks of the cap (' + Math.round((stats.pushed - cap) / KIB) + ' KiB past it)', res.status === 413 && stats.destroyed === true && stats.pushed <= cap + 8 * BLOCK, JSON.stringify({ status: res.status, destroyed: stats.destroyed, pushed: stats.pushed, cap }))
  }
  // After all of that, the same server still serves a plain request.
  const [path] = Object.keys(spec.bodies)
  const after = await post(port, path, headers, 2, Buffer.from('{}'))
  check('the process still serves a normal request afterwards', after.status !== undefined && after.status !== 413, JSON.stringify(after.status))
  server.closeAllConnections?.()
  await new Promise((r) => server.close(r))
  rmSync(home, { recursive: true, force: true })
}

// ── The text check that keeps the old mistake out (scripts/lib-body-reads.mjs, run by `audit-routes.mjs --check`) ───────────────────────────────────
console.log('\nthe text check on small sources')
{
  const { unboundedReads } = await import(pathToFileURL(join(ROOT, 'scripts', 'lib-body-reads.mjs')).href)
  const flagged = (file, text) => unboundedReads([{ file, text }]).length
  const OLD = [
    ['the event form of the bug (auto, sessions, bricks, miniapps, modeleur)', "const lireCorps = (req) => new Promise((res) => {\n  let corps = ''\n  req.on('data', (d) => { corps += d })\n  req.on('end', () => { res(JSON.parse(corps || '{}')) })\n})"],
    ['the iterator form', "async function lire (req) {\n  let raw = ''\n  for await (const c of req) raw += c\n  return JSON.parse(raw)\n}"],
    ['chunks pushed with no look at their size', "req.on('data', (c) => chunks.push(c))\nreq.on('end', () => go(Buffer.concat(chunks)))"],
    ['the whole body handed to Response', 'const texte = await new Response(req).text()'],
    ['stream/consumers', "import { json } from 'node:stream/consumers'\nconst corps = await json(req)"],
  ]
  for (const [what, code] of OLD) check('caught: ' + what, flagged('packages/kybernos-x/index.js', code) === 1, code.slice(0, 60))
  const FINE = [
    ['a counter compared with a cap, then a throw (kybernos-search/guard.mjs)', "const readBody = async (req, limit = 4096) => {\n  let size = 0\n  const chunks = []\n  for await (const c of req) { size += c.length; if (size > limit) throw new Error('too-large'); chunks.push(c) }\n}"],
    ['the event form with a cap', "req.on('data', (d) => {\n  taille += d.length\n  if (taille > cap) { envoyer(res, 413, {}); return }\n  morceaux.push(d)\n})"],
    ['a string cut at a limit', "req.on('data', (chunk) => { raw += chunk; if (raw.length > 200_000) raw = raw.slice(0, 200_000) })"],
    ['a read said to be bounded some other way', "// body-cap: the stand-in server of a replay script\nreq.on('data', (d) => { raw += d })"],
    ['a child process output (not a request)', "child.stdout.on('data', (d) => { out += d })"],
    ['a comment that quotes the pattern', "// before: req.on('data', (d) => { corps += d })"],
  ]
  for (const [what, code] of FINE) check('accepted: ' + what, flagged('packages/kybernos-x/index.js', code) === 0, code.slice(0, 60))
  check('a test file, a page (client.js), a vendor folder, a proof of concept and a script are not host sources', ['packages/kybernos-x/test-host.mjs', 'packages/kybernos-x/client.js', 'packages/kybernos-x/vendor/a.js', 'packages/kybernos-x/poc/b.mjs', 'scripts/run.mjs'].every((f) => flagged(f, OLD[0][1]) === 0))
  check('a comparison far from the read does not count (the window is 10 lines)', flagged('packages/kybernos-x/index.js', "req.on('data', (d) => { corps += d })\n" + '\n'.repeat(12) + 'if (taille > cap) {}') === 1)

  // The real tree, the way `audit-routes.mjs --check` reads it: a new route that goes back to `corps += d` fails here, in the suite, not only in a command nobody runs.
  const sources = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.claude') continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(m?js|cjs)$/.test(entry.name) && statSync(full).size < 3 * MIB) sources.push({ file: relative(ROOT, full), text: readFileSync(full, 'utf8') })
    }
  }
  for (const top of ['packages', 'services']) walk(join(ROOT, top))
  const unbounded = unboundedReads(sources)
  check('no host source of this checkout reads a request with no cap (' + sources.length + ' files)', unbounded.length === 0, unbounded.map((u) => u.file + ':' + u.line).join(', '))
}

check('nothing ended the process (no uncaught exception, no unhandled rejection)', crashes.length === 0, crashes.join(' | '))
console.log('\n' + (failed === 0 ? 'all green' : failed + ' failure(s)') + ' (' + passed + ' checks)')
process.exit(failed === 0 ? 0 : 1)
