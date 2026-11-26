// The host half end to end: `apply` with a fake DSH context, then the routes on a real socket with the browser's headers.
// What a sandboxed page can reach (only a registered folder, only by token), what it is served with, what the guards refuse.
//
//   node packages/kybernos-maquettes/test-host.mjs
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const base0 = mkdtempSync(join(tmpdir(), 'kb-mq-host-'))
process.env.DSH_HOME = join(base0, 'dsh')
process.env.HOME = base0
const { apply } = await import('./index.js')
const { createHost } = await import('./maquette-host.mjs')
const { mountRoutes, API_OPS } = await import('./routes.mjs')
const { sessionSource } = await import('./session-guard.mjs')
const { SESSION_SECRET, sessionCookie } = await import('./lib-session-test.mjs')
const { fixtures } = await import('./lib-fixtures.mjs')
const fsp = await import('node:fs/promises')
sessionSource.secret = () => SESSION_SECRET

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

try {
  console.log('Kybernos maquettes: the host')

  // ── apply() with a fake context ──────────────────────────────────────────────
  {
    const fakeServer = () => { const routes = []; return { routes, register: (r) => { routes.push(r); return () => { r.gone = true } } } }
    const a = fakeServer()
    const effects = []
    apply({ get: (k) => (k === 'webServer' ? a : undefined), effect: (fn, label) => effects.push([fn, label]), inject: () => { throw new Error('should not wait') } })
    const paths = a.routes.map((r) => r.path).sort()
    assert.deepEqual(paths, ['/kybernos-maquettes/api', '/kybernos-maquettes/folders', '/kybernos-maquettes/folders/add', '/kybernos-maquettes/folders/remove', '/kybernos-maquettes/open', '/kybernos-maquettes/stats', '/kybernos-maquettes/upload', '/kybernos-maquettes/v'])
    assert.equal(a.routes.find((r) => r.path === '/kybernos-maquettes/v').kind, 'prefix')
    assert.equal(a.routes.filter((r) => r.kind === 'exact').length, 7)
    ok('apply mounts seven exact routes and one prefix route when the web server is there')
    assert.equal(effects.length, 1)
    effects[0][0]()()
    assert.ok(a.routes.every((r) => r.gone === true))
    ok('switching the plugin off takes every route back')

    let waited = null
    apply({ get: () => undefined, effect: () => {}, inject: (names, fn) => { waited = [names, fn] } })
    assert.deepEqual(waited[0], ['webServer'])
    const b = fakeServer()
    waited[1]({ webServer: b })
    assert.equal(b.routes.length, 8)
    ok('without the web server yet, apply waits for it and mounts when it comes')

    assert.doesNotThrow(() => apply({}))
    assert.doesNotThrow(() => apply(undefined))
    assert.doesNotThrow(() => apply({ get: () => { throw new Error('boom') }, effect: () => {} }))
    ok('apply never throws, whatever the context (a bundle must not stop DSH from starting)')
  }

  // ── the routes on a real socket ──────────────────────────────────────────────
  const dir = join(base0, 'user', 'creator')
  mkdirSync(join(dir, 'sub'), { recursive: true })
  const fx = fixtures().creator
  for (const [n, t] of Object.entries(fx)) writeFileSync(join(dir, n), t)
  writeFileSync(join(dir, 'sub', 'inner.css'), 'a{}')
  writeFileSync(join(base0, 'user', 'secret.css'), 'secret{}')
  const host = createHost({ fs: fsp, home: join(base0, 'dsh'), userHome: join(base0, 'user'), log: () => {} })
  const routes = new Map()
  mountRoutes({ register: (r) => { routes.set(r.path, r.handler); return () => {} } }, host, { editorScript: () => '// the editor' })
  const server = http.createServer((req, res) => {
    const path = new URL(req.url, 'http://127.0.0.1').pathname
    const prefix = [...routes.keys()].find((k) => path === k || path.startsWith(k + '/'))
    const handler = routes.get(path) || (prefix !== undefined ? routes.get(prefix) : undefined)
    if (handler === undefined) { res.writeHead(404); res.end('{}'); return }
    Promise.resolve(handler(req, res)).catch(() => { try { res.writeHead(500); res.end('{}') } catch (e) { /* closed */ } })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  const origin = 'http://127.0.0.1:' + port
  const good = { origin, cookie: sessionCookie('127.0.0.1:' + port) }
  const call = (method, path, { headers = {}, body, host: hostHeader } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: { host: hostHeader || '127.0.0.1:' + port, ...headers } }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    req.end(body)
  })
  const post = (path, obj, headers = good) => call('POST', path, { headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(obj) })
  try {
    const added = await post('/kybernos-maquettes/folders/add', { path: dir })
    const id = JSON.parse(added.text).id
    assert.equal(added.status, 200)
    const opened = JSON.parse((await post('/kybernos-maquettes/open', { id, lang: 'fr' })).text)
    assert.ok(opened.ok && opened.url === '/kybernos-maquettes/v/' + opened.token + '/index.html')
    ok('open gives the url the DSH page puts in its iframe (token, page)')

    const page = await call('GET', opened.url)
    assert.equal(page.status, 200)
    assert.match(page.headers['content-type'], /^text\/html/)
    assert.equal(page.headers['content-security-policy'], 'sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox')
    assert.ok(!/allow-same-origin/.test(page.headers['content-security-policy']))
    assert.equal(page.headers['referrer-policy'], 'no-referrer')
    assert.equal(page.headers['x-content-type-options'], 'nosniff')
    assert.equal(page.headers['cache-control'], 'no-store')
    assert.ok(page.text.includes('data-ky-i="1"') && page.text.includes(`/kybernos-maquettes/v/${opened.token}/__ky/edit.js`))
    ok('the page is served numbered, in a sandbox with no same-origin right, with no referrer and no cache')

    const head = await call('HEAD', opened.url)
    assert.equal(head.status, 200)
    assert.equal(head.text, '')
    assert.equal((await call('POST', opened.url, { headers: good })).status, 405)
    ok('HEAD answers without a body; a POST to the view is refused')

    const css = await call('GET', `/kybernos-maquettes/v/${opened.token}/dsh.css`)
    assert.equal(css.status, 200)
    assert.equal(css.text, fx['dsh.css'])
    assert.equal(css.headers['access-control-allow-origin'], '*')
    assert.equal((await call('GET', `/kybernos-maquettes/v/${opened.token}/sub/inner.css`)).status, 200)
    ok('a stylesheet and a file in a sub-folder are served as they are')

    const js = await call('GET', `/kybernos-maquettes/v/${opened.token}/__ky/edit.js`)
    assert.equal(js.status, 200)
    assert.match(js.headers['content-type'], /javascript/)
    assert.equal(js.text, '// the editor')
    assert.equal((await call('GET', '/kybernos-maquettes/v/nope/__ky/edit.js')).status, 404)
    ok('the editor script is served to a valid token only')

    const attempts = ['/..%2f..%2fsecret.css', '/%2e%2e/secret.css', '/..%2fsecret.css', '/sub/..%2f..%2fsecret.css', '/%00', '/sub/', '//etc/passwd', '/.hidden', '/index.html%00.css']
    for (const a of attempts) {
      const r = await call('GET', `/kybernos-maquettes/v/${opened.token}${a}`)
      assert.ok(r.status === 404 || r.status === 400, a + ' -> ' + r.status)
      assert.ok(!r.text.includes('secret{}'), a + ' leaked')
    }
    symlinkSync(join(base0, 'user', 'secret.css'), join(dir, 'link.css'))
    assert.equal((await call('GET', `/kybernos-maquettes/v/${opened.token}/link.css`)).status, 404)
    ok('paths that climb out of the folder, null bytes and a symlink out all answer not found; nothing leaks')

    assert.equal((await call('GET', '/kybernos-maquettes/v/not-a-token/index.html')).status, 404)
    assert.equal((await call('GET', '/kybernos-maquettes/v/')).status, 404)
    ok('an unknown token, or none, reads nothing')

    const rebound = [['GET', `/kybernos-maquettes/v/${opened.token}/index.html`], ['GET', '/kybernos-maquettes/folders'], ['GET', '/kybernos-maquettes/stats'], ['POST', '/kybernos-maquettes/open'], ['POST', '/kybernos-maquettes/api'], ['POST', '/kybernos-maquettes/upload']]
    for (const [m, p] of rebound) {
      const r = await call(m, p, { host: 'attacker.example:' + port, headers: { origin: 'http://attacker.example:' + port, cookie: sessionCookie('attacker.example:' + port) }, body: m === 'POST' ? '{}' : undefined })
      assert.equal(r.status, 403, m + ' ' + p + ' with a rebound Host -> ' + r.status)
    }
    ok('a page that rebinds its own name to this machine is refused on every route, reads and writes')

    // the editor's calls
    assert.equal((await post('/kybernos-maquettes/api', { op: 'drop-everything', token: opened.token })).status, 400)
    assert.equal((await call('POST', '/kybernos-maquettes/api', { headers: { ...good, 'content-type': 'text/plain' }, body: '{}' })).status, 415)
    assert.equal((await call('POST', '/kybernos-maquettes/api', { headers: { ...good, 'content-type': 'application/json' }, body: '[1]' })).status, 400)
    assert.equal((await call('POST', '/kybernos-maquettes/api', { headers: { ...good, 'content-type': 'application/json' }, body: 'x'.repeat(6_100_000) })).status, 413)
    assert.equal((await post('/kybernos-maquettes/api', { op: 'hash', token: 'nope', file: 'index.html' })).status, 404)
    assert.deepEqual(API_OPS, ['hash', 'find', 'apply', 'undo', 'reset', 'unupload', 'blocks'])
    ok('the api route knows seven operations; anything else, a wrong type, a huge body or a dead token is refused')

    const h = JSON.parse((await post('/kybernos-maquettes/api', { op: 'hash', token: opened.token, file: 'index.html' })).text)
    const patch = { type: 'text', id: 4, node: 0, before: 'Create your app', after: 'Build your app' }
    const idH1 = (await import('./maquette-lib.mjs')).index(fx['index.html']).byId
    const h1 = [...idH1.entries()].find(([, n]) => n.nodeName === 'h1')[0]
    patch.id = h1
    const saved = JSON.parse((await post('/kybernos-maquettes/api', { op: 'apply', token: opened.token, file: 'index.html', body: { baseHash: h.hash, baseFiles: h.files, patches: [patch] } })).text)
    assert.ok(saved.ok && saved.errors.length === 0)
    assert.ok(readFileSync(join(dir, 'index.html'), 'utf8').includes('Build your app'))
    const stale = await post('/kybernos-maquettes/api', { op: 'apply', token: opened.token, file: 'index.html', body: { baseHash: h.hash, baseFiles: h.files, patches: [patch] } })
    assert.equal(stale.status, 409)
    assert.equal(JSON.parse(stale.text).error, 'stale')
    const back = JSON.parse((await post('/kybernos-maquettes/api', { op: 'undo', token: opened.token })).text)
    assert.ok(back.ok && readFileSync(join(dir, 'index.html'), 'utf8') === fx['index.html'])
    const blocks = JSON.parse((await post('/kybernos-maquettes/api', { op: 'blocks', lang: 'fr' })).text)
    assert.equal(blocks.blocks.length, 15)
    ok('save, conflict, undo and the block list work through the route')

    const stats = JSON.parse((await call('GET', '/kybernos-maquettes/stats')).text)
    assert.ok(stats.ok && stats.stats.saves >= 1 && stats.stats.opens >= 1)
    ok('the use counter is readable')
  } finally {
    server.close()
  }
  console.log('\nMAQUETTES HOST — ' + pass + ' vérification(s), 0 échec')
} catch (e) {
  console.error('  ✗ ' + String(e && e.stack ? e.stack : e))
  process.exitCode = 1
}
