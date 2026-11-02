// fd-routes.mjs on a real socket: the guards (Host fence, DSH's signed session), the plugin's own routes, the forwarded pages and API.
import http from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'kb-fd-routes-'))
process.env.DSH_HOME = join(home, '.dsh')
const { installSession, sessionCookie, OTHER_SECRET } = await import('./lib-session-test.mjs')
installSession(process.env.DSH_HOME)
const { createConfigStore } = await import('./fd-config.mjs')
const { mountRoutes, ROUTE } = await import('./fd-routes.mjs')

let failed = 0
const ok = (name, cond, detail) => { console.log((cond ? '  ok   ' : '  FAIL ') + name + (cond || detail === undefined ? '' : '  -- ' + detail)); if (!cond) failed += 1 }

const KEY = 'sk-test-0123456789abcdef'
const config = createConfigStore({ home: join(home, '.dsh') })

// the service: records what reaches it
const seen = []
const svc = http.createServer((req, res) => {
  seen.push({ method: req.method, url: req.url, auth: req.headers.authorization })
  res.writeHead(200, { 'content-type': req.url.startsWith('/api/') ? 'application/json' : 'text/html; charset=utf-8', 'content-security-policy': "frame-ancestors 'self'" })
  if (req.url === '/api/status') res.end(JSON.stringify({ shop: { name: 'Atelier Lune', slug: 'atelier-lune' }, version: 3, channels: { telegram: { connected: false } }, killed: false }))
  else res.end(req.url.startsWith('/api/') ? '{"ok":true}' : '<html><body>page</body></html>')
})
await new Promise((r) => svc.listen(0, '127.0.0.1', r))
const svcPort = svc.address().port

// a supervisor double
let running = false
const calls = []
const supervisor = {
  status: () => ({ state: running ? 'running' : 'stopped', port: running ? svcPort : null, pid: running ? 1 : null, error: null }),
  target: () => (running ? { port: svcPort, token: config.ownerToken() } : null),
  start: async () => { calls.push('start'); if (!config.ready().ok) return { ok: false, error: 'not_ready', missing: config.ready().missing }; running = true; return { ok: true, ...supervisor.status() } },
  stop: async () => { calls.push('stop'); running = false; return { ok: true, ...supervisor.status() } },
  logs: () => 'line one\nline two',
}

const routes = []
const logs = []
mountRoutes({ register: (r) => { routes.push(r); return () => {} } }, { supervisor, config, log: (m) => logs.push(m) })
const front = http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname
  const r = routes.find((x) => x.path === p || (x.kind === 'prefix' && p.startsWith(x.path + '/')))
  if (!r) { res.writeHead(404); res.end(); return }
  Promise.resolve(r.handler(req, res)).catch(() => { try { res.writeHead(500); res.end() } catch (e) { /* closed */ } })
})
await new Promise((r) => front.listen(0, '127.0.0.1', r))
const port = front.address().port
const auth = `127.0.0.1:${port}`
const browser = (extra = {}) => ({ host: auth, origin: `http://${auth}`, cookie: sessionCookie(auth), ...extra })
const call = (method, path, headers, body) => new Promise((resolve) => {
  const h = { ...headers, ...(body !== undefined ? { 'content-type': headers['content-type'] || 'application/json', 'content-length': Buffer.byteLength(body) } : {}) }
  const r = http.request({ host: '127.0.0.1', port, path, method, headers: h }, (res) => {
    const cs = []
    res.on('data', (c) => cs.push(c)); res.on('end', () => { const text = Buffer.concat(cs).toString('utf8'); let json = null; try { json = JSON.parse(text) } catch (e) { /* html */ } resolve({ status: res.statusCode, headers: res.headers, text, json }) })
  })
  r.on('error', () => resolve({ status: 0, text: '', json: null }))
  if (body !== undefined) r.write(body)
  r.end()
})

ok('the routes: state, config, start, stop, logs, the three pages and the API prefix', ['state', 'config', 'start', 'stop', 'logs', 'atelier', 'boite', 'preview'].every((n) => routes.some((r) => r.path === `${ROUTE}/${n}` && r.kind === 'exact')) && routes.some((r) => r.kind === 'prefix' && r.path === `${ROUTE}/api`))

// ── the guards: every route, reads included ─────────────────────────────────────────────────────────────────────────────────────────────────
const every = [['GET', 'state'], ['GET', 'logs'], ['GET', 'atelier'], ['GET', 'boite'], ['GET', 'preview'], ['GET', 'api/overview'], ['POST', 'api/studio/ops'], ['POST', 'config'], ['POST', 'start'], ['POST', 'stop']]
for (const [m, p] of every) {
  const path = `${ROUTE}/${p}`
  const body = m === 'POST' ? '{}' : undefined
  const noCookie = await call(m, path, { host: auth, origin: `http://${auth}` }, body)
  const rebound = await call(m, path, { host: `attacker.example:${port}`, origin: `http://attacker.example:${port}`, cookie: sessionCookie(`attacker.example:${port}`) }, body)
  const foreign = await call(m, path, browser({ origin: 'http://evil.example' }), body)
  const forged = await call(m, path, browser({ cookie: sessionCookie(auth, { secret: OTHER_SECRET }) }), body)
  ok(`${m} ${p}: no session cookie -> 401; a rebound Host -> 403; a foreign Origin -> 403; a forged cookie -> 401`, noCookie.status === 401 && rebound.status === 403 && foreign.status === 403 && forged.status === 401, [noCookie.status, rebound.status, foreign.status, forged.status].join('/'))
}
// The Host fence on its own: a request that names a Host that is not this listener's (DNS rebinding), with a cookie that would otherwise pass, no Origin (a read needs none).
{
  const rebound = await call('GET', `${ROUTE}/state`, { host: `attacker.example:${port}`, cookie: sessionCookie(auth) })
  ok('a read through a rebound Host is refused by the fence even when its cookie is valid', rebound.status === 403, rebound.status)
}
ok('none of those refusals reached the service', seen.length === 0)

// ── state ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
let s = await call('GET', `${ROUTE}/state`, browser())
ok('state while stopped: not ready, what is missing, no shop', s.status === 200 && s.json.service.state === 'stopped' && s.json.ready.ok === false && s.json.ready.missing.includes('model_key') && s.json.shop === null && s.json.localLink === null)

const early = await call('POST', `${ROUTE}/start`, browser(), '{}')
ok('start with no model set: 409 not_ready listing what is missing, and autostart stays off', early.status === 409 && early.json.error === 'not_ready' && early.json.missing.includes('model_url') && config.read().autostart === false)

const cfg = await call('POST', `${ROUTE}/config`, browser(), JSON.stringify({ publicUrl: 'https://shop.example', model: { baseUrl: 'https://gw.example/v1', name: 'kimi', apiKey: KEY } }))
ok('config: written, answers ready, never echoes the key', cfg.status === 200 && cfg.json.ready.ok === true && cfg.json.secrets.modelKey === true && !cfg.text.includes(KEY))
ok('config: a bad value is a 400 with its code', (await call('POST', `${ROUTE}/config`, browser(), JSON.stringify({ model: { baseUrl: 'ftp://x' } }))).json.error === 'bad_model_url')
ok('config: not JSON content type -> 415; broken JSON -> 400; too big -> 413; GET -> 405', (await call('POST', `${ROUTE}/config`, browser({ 'content-type': 'text/plain' }), 'x')).status === 415 && (await call('POST', `${ROUTE}/config`, browser(), '{oops')).status === 400 && (await call('POST', `${ROUTE}/config`, browser(), JSON.stringify({ pad: 'x'.repeat(9000) }))).status === 413 && (await call('GET', `${ROUTE}/config`, browser())).status === 405)

// ── start / stop / forwarded pages and API ──────────────────────────────────────────────────────────────────────────────────────────────────
ok('a page or the API while the service is stopped: 503 service_stopped', (await call('GET', `${ROUTE}/boite`, browser())).status === 503 && (await call('GET', `${ROUTE}/api/overview`, browser())).json.error === 'service_stopped')
const st = await call('POST', `${ROUTE}/start`, browser(), '{}')
ok('start: runs it and remembers to start it again with DSH', st.status === 200 && st.json.state === 'running' && config.read().autostart === true)
s = await call('GET', `${ROUTE}/state`, browser())
ok('state while running: the shop, the links, the settings, no secret anywhere', s.json.shop.slug === 'atelier-lune' && s.json.localLink === `http://127.0.0.1:${svcPort}/c/atelier-lune` && s.json.publicLink === 'https://shop.example/c/atelier-lune' && !s.text.includes(KEY) && !s.text.includes(config.ownerToken()))
const page = await call('GET', `${ROUTE}/boite`, browser())
ok('a page is forwarded with the owner token and its CSP', page.status === 200 && page.text.includes('<body>page') && page.headers['content-security-policy'] === "frame-ancestors 'self'" && seen.at(-1).url === '/boite' && seen.at(-1).auth === 'Bearer ' + config.ownerToken())
const api = await call('POST', `${ROUTE}/api/studio/review`, browser(), '{}')
ok('an API call is forwarded the same way', api.status === 200 && seen.at(-1).url === '/api/studio/review' && seen.at(-1).method === 'POST' && seen.at(-1).auth === 'Bearer ' + config.ownerToken())
ok('a visitor route is not reachable through the plugin', (await call('GET', `${ROUTE}/c/atelier-lune`, browser())).status === 404 && !seen.some((x) => x.url.startsWith('/c/')))
const n = seen.length
ok('a path outside the allowlist is a 404 and not forwarded', (await call('GET', `${ROUTE}/api/`, browser())).status === 404 && seen.length === n)
ok('logs come back', (await call('GET', `${ROUTE}/logs?n=5`, browser())).json.text === 'line one\nline two')
const sp = await call('POST', `${ROUTE}/stop`, browser(), '{}')
ok('stop: stops it and turns autostart off', sp.status === 200 && sp.json.state === 'stopped' && config.read().autostart === false && calls.join() === 'start,start,stop')
front.close(); svc.close()
process.exit(failed ? 1 : 0)
