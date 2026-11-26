// ── Every write of the maquette editor needs the signed session, not only an Origin ─────────────────────────────────────
//
// docs/dev/route-origin-rule.md: DSH serves plugin routes before its own login, so a route that writes (or hands out the token a page reads a
// folder by) takes a strict same-origin request AND DSH's signed session cookie. Its caller is the Maquettes page of the person's DSH, a
// same-origin fetch, so the browser sends the cookie itself. The reads keep the Host fence alone.
//
//   node packages/kybernos-maquettes/test-write-guard.mjs
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import * as fsp from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHost } from './maquette-host.mjs'
import { mountRoutes } from './routes.mjs'
import { sessionSource } from './session-guard.mjs'
import { OTHER_SECRET, SESSION_SECRET, sessionCookie } from './lib-session-test.mjs'
import { fixtures } from './lib-fixtures.mjs'

sessionSource.secret = () => SESSION_SECRET

const base0 = mkdtempSync(join(tmpdir(), 'kb-mq-guard-'))
const dir = join(base0, 'user', 'creator')
mkdirSync(dir, { recursive: true })
for (const [n, t] of Object.entries(fixtures().creator)) writeFileSync(join(dir, n), t)
const host = createHost({ fs: fsp, home: join(base0, 'dsh'), userHome: join(base0, 'user'), log: () => {} })
const routes = new Map()
mountRoutes({ register: (r) => { routes.set(r.path, r.handler); return () => {} } }, host, { editorScript: () => '// editor' })
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://127.0.0.1').pathname
  const exact = routes.get(path)
  const prefix = [...routes.keys()].find((k) => path === k || path.startsWith(k + '/'))
  const handler = exact || (prefix !== undefined ? routes.get(prefix) : undefined)
  if (handler === undefined) { res.writeHead(404); res.end('{}'); return }
  Promise.resolve(handler(req, res)).catch(() => { try { res.writeHead(500); res.end('{}') } catch (e) { /* closed */ } })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port
const base = 'http://127.0.0.1:' + port
const origin = base
const cookie = (opts) => sessionCookie('127.0.0.1:' + port, opts)
const send = (path, headers, body, ctype = 'application/json') => fetch(base + path, { method: 'POST', headers: { 'content-type': ctype, ...headers }, body: ctype === 'application/json' ? JSON.stringify(body) : body }).then(async (r) => ({ status: r.status, text: await r.text().catch(() => '') }))

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const files = () => readdirSync(dir).sort().join() + '|' + readFileSync(join(dir, 'index.html'), 'utf8').length
const registry = () => JSON.stringify(readdirSync(join(base0, 'dsh', 'kybernos', 'kybernos-maquettes')).sort())

try {
  console.log('Kybernos maquettes: every write needs the signed session')
  const good = { origin, cookie: cookie() }
  const added = await send('/kybernos-maquettes/folders/add', good, { path: dir })
  assert.equal(added.status, 200, 'the real pair registers a folder: ' + added.text)
  const id = JSON.parse(added.text).id
  const opened = await send('/kybernos-maquettes/open', good, { id })
  assert.equal(opened.status, 200, opened.text)
  const token = JSON.parse(opened.text).token
  const before = files()
  const regBefore = registry()
  const writes = [
    ['/kybernos-maquettes/folders/add', { path: dir }],
    ['/kybernos-maquettes/folders/remove', { id }],
    ['/kybernos-maquettes/open', { id }],
    ['/kybernos-maquettes/api', { op: 'apply', token, file: 'index.html', body: { baseHash: 'x', patches: [{ type: 'text', id: 1, node: 0, before: 'a', after: 'b' }] } }],
    ['/kybernos-maquettes/api', { op: 'undo', token }],
    ['/kybernos-maquettes/api', { op: 'reset', token, force: true }],
    ['/kybernos-maquettes/api', { op: 'hash', token, file: 'index.html' }],
  ]
  for (const [path, body] of writes) {
    for (const [headers, want, label] of [
      [{}, 403, 'no Origin and no cookie'],
      [{ origin: 'http://evil.example', cookie: cookie() }, 403, 'a foreign Origin, even with the real cookie'],
      [{ origin }, 401, 'the right Origin and no cookie'],
      [{ origin, cookie: cookie({ secret: OTHER_SECRET }) }, 401, 'the right Origin and a forged cookie'],
      [{ origin, cookie: cookie({ expiresAt: Date.now() - 1000 }) }, 401, 'the right Origin and an expired cookie'],
    ]) {
      const r = await send(path, headers, body)
      assert.equal(r.status, want, path + ' ' + body.op + ': ' + label + ' -> ' + r.status + ' ' + r.text.slice(0, 90))
    }
  }
  assert.equal(files(), before, 'refused requests wrote nothing in the maquette folder')
  assert.equal(registry(), regBefore, 'and nothing in the registry')
  ok(`${writes.length} write routes: no header 403 · foreign Origin 403 · no cookie 401 · forged 401 · expired 401 · nothing written`)

  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(30, 1)])
  for (const [headers, want, label] of [[{}, 403, 'no header'], [{ origin }, 401, 'no cookie'], [{ origin, cookie: cookie({ secret: OTHER_SECRET }) }, 401, 'forged cookie']]) {
    const r = await send('/kybernos-maquettes/upload?token=' + token + '&filename=a.png', headers, png, 'image/png')
    assert.equal(r.status, want, 'upload: ' + label + ' -> ' + r.status)
  }
  assert.equal(files(), before, 'a refused upload stored nothing')
  const up = await send('/kybernos-maquettes/upload?token=' + token + '&filename=a.png', good, png, 'image/png')
  assert.equal(up.status, 200, 'the real pair uploads: ' + up.text)
  ok('upload: the same three refusals, then the real pair stores the picture')

  for (const path of ['/kybernos-maquettes/folders', '/kybernos-maquettes/stats']) {
    const r = await fetch(base + path)
    assert.equal(r.status, 200, path + ' still answers with no header (a GET carries no Origin)')
  }
  const foreignRead = await fetch(base + '/kybernos-maquettes/folders', { headers: { origin: 'http://evil.example' } })
  assert.equal(foreignRead.status, 403, 'a read from a foreign Origin is refused')
  ok('the reads keep answering with no header, and refuse a foreign Origin')
  console.log('\nMAQUETTES WRITE GUARD — ' + pass + ' vérification(s), 0 échec')
} catch (e) {
  console.error('  ✗ ' + String(e && e.message ? e.message : e))
  process.exitCode = 1
} finally {
  server.close()
}
