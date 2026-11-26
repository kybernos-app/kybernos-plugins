// fd-proxy.mjs: what may be forwarded to the service, what is added, what never goes through.
import http from 'node:http'
import { createProxy, servicePath } from './fd-proxy.mjs'

let failed = 0
const ok = (name, cond, detail) => { console.log((cond ? '  ok   ' : '  FAIL ') + name + (cond || detail === undefined ? '' : '  -- ' + detail)); if (!cond) failed += 1 }

// ── the allowlist of paths ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
ok('the three pages map to the service\'s own', servicePath('atelier') === '/atelier' && servicePath('boite') === '/boite' && servicePath('preview') === '/preview')
ok('the owner API maps, query kept', servicePath('api/overview') === '/api/overview' && servicePath('api/conversations/c_abc/reply') === '/api/conversations/c_abc/reply' && servicePath('api/studio?x=1') === '/api/studio?x=1')
for (const bad of ['', 'c/shop/messages', 'v1/admin/overview', 'widget.js', 'api/', 'api/../c/x', 'api/./x', 'api//x', 'api/%2e%2e/x', 'api/a b', 'atelier/x', 'Atelier', '..', 'api/' + 'a'.repeat(200), 'api/x?' + 'q'.repeat(600)]) {
  ok('refused: ' + JSON.stringify(bad.length > 40 ? bad.slice(0, 40) + '…' : bad), servicePath(bad) === null)
}
ok('a non-string is refused', servicePath(undefined) === null && servicePath(null) === null && servicePath(42) === null)

// ── a fake service that records what reached it ─────────────────────────────────────────────────────────────────────────────────────────────
const seen = []
const svc = http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    seen.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') })
    res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'evil=1', 'x-secret': 'nope', 'content-security-policy': "frame-ancestors 'self'", 'access-control-allow-origin': '*' })
    res.end(JSON.stringify({ ok: true, path: req.url }))
  })
})
await new Promise((r) => svc.listen(0, '127.0.0.1', r))
const port = svc.address().port
let target = { port, token: 'TOKEN-OWNER-123' }
const forward = createProxy({ getTarget: () => target })
const front = http.createServer((req, res) => { const rest = req.url.slice(1); forward(req, res, rest) })
await new Promise((r) => front.listen(0, '127.0.0.1', r))
const fport = front.address().port
const call = (method, path, { headers = {}, body } = {}) => new Promise((resolve) => {
  const r = http.request({ host: '127.0.0.1', port: fport, path: '/' + path, method, headers: { ...headers, ...(body !== undefined ? { 'content-length': Buffer.byteLength(body) } : {}) } }, (res) => {
    const cs = []
    res.on('data', (c) => cs.push(c))
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(cs).toString('utf8') }))
  })
  r.on('error', () => resolve({ status: 0, headers: {}, text: '' }))
  if (body !== undefined) r.write(body)
  r.end()
})

const r1 = await call('GET', 'api/overview?a=1', { headers: { cookie: 'dsh-auth-x=SESSION', origin: 'http://127.0.0.1:3080', referer: 'http://127.0.0.1:3080/x', authorization: 'Bearer BROWSER', accept: 'application/json', 'x-forwarded-for': '6.6.6.6' } })
const q1 = seen.at(-1)
ok('a GET is forwarded with the owner token added', r1.status === 200 && q1.url === '/api/overview?a=1' && q1.headers.authorization === 'Bearer TOKEN-OWNER-123')
ok('the browser\'s cookie, Origin, Referer, Authorization and forwarded-for never reach the service', q1.headers.cookie === undefined && q1.headers.origin === undefined && q1.headers.referer === undefined && q1.headers['x-forwarded-for'] === undefined && !JSON.stringify(q1.headers).includes('BROWSER') && !JSON.stringify(q1.headers).includes('SESSION'))
ok('the Host the service sees is its own', q1.headers.host === `127.0.0.1:${port}`)
ok('what comes back: the content type and the CSP stay, Set-Cookie and unknown headers are dropped, never cached', r1.headers['content-type'].startsWith('application/json') && r1.headers['content-security-policy'] === "frame-ancestors 'self'" && r1.headers['set-cookie'] === undefined && r1.headers['x-secret'] === undefined && r1.headers['access-control-allow-origin'] === undefined && r1.headers['cache-control'] === 'no-store')

const r2 = await call('POST', 'api/studio/ops', { headers: { 'content-type': 'application/json' }, body: '{"ops":[{"op":"add_fact","text":"x"}]}' })
const q2 = seen.at(-1)
ok('a POST carries its JSON body and content type', r2.status === 200 && q2.method === 'POST' && q2.body === '{"ops":[{"op":"add_fact","text":"x"}]}' && q2.headers['content-type'] === 'application/json')
const r3 = await call('DELETE', 'api/conversations/c_000000000000000000000000')
ok('DELETE passes (erasing a conversation)', r3.status === 200 && seen.at(-1).method === 'DELETE')

const before = seen.length
ok('a path that may not pass is a 404 and never reaches the service', (await call('GET', 'c/shop/messages')).status === 404 && (await call('GET', 'v1/admin/overview')).status === 404 && seen.length === before)
ok('another method is refused', (await call('PUT', 'api/studio', { body: '{}' })).status === 405 && (await call('PATCH', 'api/studio', { body: '{}' })).status === 405 && seen.length === before)
const big = await call('POST', 'api/studio/ops', { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pad: 'x'.repeat(20000) }) })
ok('a body above 16 KB is refused with 413 and not forwarded', big.status === 413 && seen.length === before)

target = null
const down = await call('GET', 'api/overview')
ok('service stopped: 503 service_stopped', down.status === 503 && JSON.parse(down.text).error === 'service_stopped')
target = { port: 1, token: 'T' }
const dead = await call('GET', 'api/overview')
ok('service not answering: 502, no crash', dead.status === 502 && JSON.parse(dead.text).error === 'service_unreachable')
front.close(); svc.close()
process.exit(failed ? 1 : 0)
