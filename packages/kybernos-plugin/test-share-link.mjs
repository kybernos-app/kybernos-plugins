// ── A share link is served by THIS host, and dies when the sheet goes back to Private ────────────────────────────────────────────────
//
// The cloud's `/v1/shares` is paused on the server (ADR 0007 § 7), so a public or team link of a deliverable is served here:
// `/kybernos/s/<token>`, with NO session — the token is the whole right, minted by `/kybernos/share` and deleted with the entry.
// This test plays the real routes of the bundle over a small host made of node:fs:
//
//   1. the sheet asks for Public → the entry carries a 24-hex token and answers `/kybernos/s/<token>` (the client builds the absolute link);
//   2. a caller with NO cookie and NO origin reads the file (text escaped, image inline, HTML inside a sandbox);
//   3. a wrong token, a file outside the workspace, and a revoked link all answer 404 — the sheet's « Private » deletes the entry.
//
//   node packages/kybernos-plugin/test-share-link.mjs
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { sessionSource } from './session-guard.mjs'
import { SESSION_SECRET, sessionCookie } from './lib-session-test.mjs'

const watchdog = setTimeout(() => { console.error('WATCHDOG: the routes did not answer in 25 s'); process.exit(2) }, 25000)
watchdog.unref()
const here = dirname(fileURLToPath(import.meta.url))
const base = realpathSync(mkdtempSync(join(tmpdir(), 'kb-plugin-share-link-')))
const home = join(base, 'home')
const dshHome = join(base, 'dsh-home')
const project = join(home, 'proj')
const artifacts = join(project, 'artifacts')
for (const d of [home, dshHome, project, artifacts]) mkdirSync(d, { recursive: true })
process.env.HOME = base
process.env.DSH_HOME = dshHome
process.env.USERPROFILE = base
for (const key of ['KYBERNOS_CLOUD_STATE', 'KYBERNOS_SERVERS_FILE']) delete process.env[key]
sessionSource.secret = () => SESSION_SECRET

const NOTE = join(artifacts, 'plan.md')
const PAGE = join(artifacts, 'page.html')
const IMAGE = join(artifacts, 'shot.png')
const SECRET = join(home, 'secret.txt')
writeFileSync(NOTE, '# Plan\n\nUn texte <b>lisible</b> et échappé.\n')
writeFileSync(PAGE, '<!doctype html><html><body><p>bonjour</p><script>document.title = "ran"</script></body></html>')
writeFileSync(IMAGE, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]))
writeFileSync(SECRET, 'SECRET-OUTSIDE-ANY-PROJECT')

const handleOf = (p) => ({ p })
const fsSvc = {
  resolve: async (p, o) => handleOf(o !== undefined && o !== null && typeof o.cwd === 'string' ? join(o.cwd, p) : p),
  stat: async (h) => {
    const st = statSync(h.p)
    return { type: st.isDirectory() ? 'directory' : (st.isFile() ? 'file' : 'other'), size: st.size, version: ['0', '0', String(st.size), '0', '0'].join(':') }
  },
  readText: async (h) => readFileSync(h.p, 'utf8'),
  processPath: (h) => h.p,
  listDir: async (h) => readdirSync(h.p, { withFileTypes: true }).map((e) => ({ name: e.name, type: e.isDirectory() ? 'directory' : 'file', target: handleOf(join(h.p, e.name)) })),
  writeText: async (h, text) => { const t = typeof h === 'string' ? h : h.p; mkdirSync(dirname(t), { recursive: true }); writeFileSync(t, String(text)) },
}
const routes = []
const service = { register: (r) => { routes.push(r); return () => {} }, registerRoute: (r) => { routes.push(r); return () => {} } }
const registry = { list: () => [{ id: 'w-proj', title: 'proj', path: project }] }
const ctx = new Proxy({
  get: (name) => (name === 'webServer' ? service : (name === 'fs' ? fsSvc : (name === 'sandboxPolicy' ? { workspaceRoot: home } : (name === 'workspaceRegistry' ? registry : undefined)))),
  inject: (_list, cb) => { try { cb(ctx) } catch (e) { /* a service that is not here */ } },
  effect: (fn) => { try { return fn() } catch (e) { return undefined } },
  on: () => {}, systemPrompt: { context: () => {} }, tools: { register: () => () => {} }, config: {},
  log: { info: () => {}, warn: () => {}, error: () => {} }, webServer: service,
}, { get: (t, k) => (k in t ? t[k] : (() => undefined)) })
const mod = await import(pathToFileURL(join(here, 'index.js')).href)
await Promise.race([Promise.resolve(mod.apply(ctx)), new Promise((r) => setTimeout(r, 5000))])

// Exact routes first, then the one prefix route of this feature (`/kybernos/s/<token>`).
const routeOf = (pathname) => routes.find((r) => r.path === pathname && typeof r.handler === 'function')
  // The router takes the LONGEST prefix that matches (a broader `/kybernos/...` route may sit before this one in the list).
  || routes.filter((r) => r.kind === 'prefix' && typeof r.handler === 'function' && (pathname === r.path || pathname.indexOf(r.path + '/') === 0))
    .sort((a, b) => b.path.length - a.path.length)[0]
const server = http.createServer((req, res) => {
  const route = routeOf(new URL(req.url, 'http://x').pathname)
  if (route === undefined) { res.writeHead(404); res.end('{}'); return }
  Promise.resolve(route.handler(req, res)).catch(() => { try { res.writeHead(500); res.end('{}') } catch (e) { /* closed */ } })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const own = '127.0.0.1:' + port
const origin = 'http://' + own

// Two callers: the sheet (a page: strict origin + DSH's signed session), and a stranger (nothing at all — a link pasted in a browser).
const sheet = (path, body) => new Promise((resolve) => {
  const payload = JSON.stringify(body)
  const req = http.request({ host: '127.0.0.1', port, path, method: 'POST', headers: { host: own, origin, cookie: sessionCookie(own), 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } }, (res) => {
    const chunks = []
    res.on('data', (c) => chunks.push(c))
    res.on('end', () => resolve({ status: res.statusCode, json: (() => { try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch (e) { return null } })() }))
  })
  req.on('error', () => resolve({ status: 0, json: null }))
  req.write(payload)
  req.end()
})
const stranger = (path) => new Promise((resolve) => {
  const req = http.request({ host: '127.0.0.1', port, path, method: 'GET', headers: { host: own } }, (res) => {
    const chunks = []
    res.on('data', (c) => chunks.push(c))
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }))
  })
  req.on('error', () => resolve({ status: 0, headers: {}, text: '' }))
  req.end()
})

let pass = 0
const check = (label, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + label) } else { console.log('  ✗ ' + label + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))); process.exitCode = 1 }
}
const share = (id, access) => sheet('/kybernos/share', { kind: 'deliverable', id, access, role: 'view' })

console.log('the sheet asks for a link')
{
  const r = await share(NOTE, 'public')
  const token = r.json && r.json.lien ? String(r.json.lien).replace('/kybernos/s/', '') : ''
  check('« Public » answers a link of this host, with a 24-char token', r.status === 200 && r.json.ok === true && /^[a-f0-9]{24}$/.test(token), r.json)
  check('the level is written in the local store with that token', r.json.partage.access === 'public' && r.json.partage.token === token, r.json.partage)

  console.log('a stranger opens it (no cookie, no origin)')
  const got = await stranger('/kybernos/s/' + token)
  check('the link answers 200 without any session', got.status === 200, got.status)
  check('it is a page of its own, not the DSH shell', /<html/.test(got.text) && /Kybernos/.test(got.text) && !/dsh-auth/.test(got.text))
  check('the text of the file is shown, escaped', got.text.indexOf('# Plan') >= 0 && got.text.indexOf('&lt;b&gt;lisible&lt;/b&gt;') >= 0, got.text.slice(0, 200))
  check('the page forbids being embedded elsewhere and any script of its own', /content-security-policy/.test(JSON.stringify(got.headers)) && /default-src 'none'/.test(String(got.headers['content-security-policy'])))
  check('the CSP header refuses the referrer', got.headers['referrer-policy'] === 'no-referrer')

  console.log('and it dies when the sheet goes back to Private')
  const back = await share(NOTE, 'me')
  check('« Private » removes the entry', back.status === 200 && back.json.partage.access === 'me' && back.json.lien === null, back.json)
  const dead = await stranger('/kybernos/s/' + token)
  check('the very same link now answers 404', dead.status === 404, dead.status)
}

console.log('what a link never serves')
{
  const bad = await stranger('/kybernos/s/' + '0'.repeat(24))
  check('an unknown token is a 404, not an empty page', bad.status === 404 && /Link not found/.test(bad.text))
  const probe = await stranger('/kybernos/s/../.kyber-shares.json')
  check('a token that is a path is refused before any disk access', probe.status === 404)

  // A token can only be minted for a file the sheet could show, but the store is a file on disk: the route re-checks the path itself.
  const minted = await share(SECRET, 'public')
  const token = minted.json && minted.json.lien ? String(minted.json.lien).replace('/kybernos/s/', '') : ''
  if (token !== '') {
    const refused = await stranger('/kybernos/s/' + token)
    check('a file outside the workspace is never served, even when its entry exists', refused.status === 404, refused.status)
  } else {
    check('a file outside the workspace is refused, even when its entry exists', false, minted.json)
  }
  await share(SECRET, 'me')
}

console.log('an HTML artifact runs nowhere near this origin')
{
  const r = await share(PAGE, 'public')
  const token = r.json && r.json.lien ? String(r.json.lien).replace('/kybernos/s/', '') : ''
  const wrapper = await stranger('/kybernos/s/' + token)
  check('the link shows the page inside a sandboxed frame', wrapper.status === 200 && /<iframe[^>]*sandbox=/.test(wrapper.text) && wrapper.text.indexOf(token + '/raw') >= 0, wrapper.text.slice(0, 200))
  const raw = await stranger('/kybernos/s/' + token + '/raw')
  check('the raw bytes are the artifact, served as HTML', raw.status === 200 && String(raw.headers['content-type']).indexOf('text/html') === 0, raw.headers)
  check('…under a CSP sandbox: an opaque origin cannot reach this host\'s routes', /^sandbox /.test(String(raw.headers['content-security-policy'])) && /nosniff/.test(String(raw.headers['x-content-type-options'])))
  check('…and no referrer leaves the page', raw.headers['referrer-policy'] === 'no-referrer')
  await share(PAGE, 'me')
}

console.log('a picture is served as itself')
{
  const r = await share(IMAGE, 'public')
  const token = r.json && r.json.lien ? String(r.json.lien).replace('/kybernos/s/', '') : ''
  const got = await stranger('/kybernos/s/' + token)
  check('the bytes of the image come back with the image type', got.status === 200 && String(got.headers['content-type']).indexOf('image/png') === 0, got.headers)
  check('…and the browser is told not to sniff', got.headers['x-content-type-options'] === 'nosniff')
  await share(IMAGE, 'me')
}

console.log('the sheet keeps the link it already had')
{
  const first = await share(NOTE, 'public')
  const t1 = String(first.json.lien || '')
  const team = await share(NOTE, 'team')
  check('Team access keeps the same token, so a printed link does not break on a change of level', String(team.json.lien || '') === t1 && team.json.partage.token === first.json.partage.token)
  const opened = await stranger(t1)
  check('…and a team link opens without a session too', opened.status === 200 && opened.text.indexOf('# Plan') >= 0)
  await share(NOTE, 'me')
}

rmSync(base, { recursive: true, force: true })
process.exit(process.exitCode === undefined ? 0 : process.exitCode)
console.log('\n' + pass + ' ✓')
