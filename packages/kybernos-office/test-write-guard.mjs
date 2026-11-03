// ── Every route of the Office editors that opens, writes or restores a file needs the signed session, not only an Origin ──────────────
//
// docs/dev/route-origin-rule.md: DSH serves plugin routes before its own login, so a route that writes (or hands out the token a page reads a
// file by) takes a strict same-origin request AND DSH's signed session cookie. Its caller is the DSH page of the person, a same-origin
// fetch, so the browser sends the cookie itself. The reads keep the Host fence alone.
//
//   node packages/kybernos-office/test-write-guard.mjs
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import * as fsp from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createHost } from './office-host.mjs'
import { mountRoutes } from './routes.mjs'
import { sessionSource } from './session-guard.mjs'
import { OTHER_SECRET, SESSION_SECRET, sessionCookie } from './lib-session-test.mjs'
import { xlsx } from './lib-test-files.mjs'

sessionSource.secret = () => SESSION_SECRET

const base0 = mkdtempSync(join(tmpdir(), 'kb-office-guard-'))
const work = join(base0, 'user', 'Documents')
mkdirSync(work, { recursive: true })
const file = join(work, 'budget.xlsx')
const original = xlsx({ cell: 'original' })
writeFileSync(file, original)
const host = createHost({ fs: fsp, home: join(base0, 'dsh'), userHome: join(base0, 'user'), log: () => {} })
const routes = new Map()
mountRoutes({ register: (r) => { routes.set(r.path, r.handler); return () => {} } }, host, {})
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
const folder = () => readdirSync(work).sort().join() + '|' + createHash('sha256').update(readFileSync(file)).digest('hex')
const storage = () => { try { return JSON.stringify(readdirSync(join(base0, 'dsh', 'kybernos', 'kybernos-office')).sort()) } catch (e) { return '[]' } }

try {
  console.log('Kybernos office: every write needs the signed session')
  const good = { origin, cookie: cookie() }
  const opened = await send('/kybernos-office/open', good, { path: file })
  assert.equal(opened.status, 200, 'the real pair opens a file: ' + opened.text)
  const { token, hash } = JSON.parse(opened.text)
  const before = folder()
  const storeBefore = storage()
  const attempts = [
    ['/kybernos-office/open', { path: file }, 'application/json', null],
    ['/kybernos-office/undo', { token, force: true }, 'application/json', null],
    [`/kybernos-office/save?token=${token}&base=${hash}`, xlsx({ cell: 'hijacked' }), 'application/octet-stream', null],
    [`/kybernos-office/save?token=${token}&mode=copy`, xlsx({ cell: 'hijacked copy' }), 'application/octet-stream', null],
  ]
  for (const [path, body, ctype] of attempts) {
    for (const [headers, want, label] of [
      [{}, 403, 'no Origin and no cookie'],
      [{ origin: 'http://evil.example', cookie: cookie() }, 403, 'a foreign Origin, even with the real cookie'],
      [{ origin }, 401, 'the right Origin and no cookie'],
      [{ origin, cookie: cookie({ secret: OTHER_SECRET }) }, 401, 'the right Origin and a forged cookie'],
      [{ origin, cookie: cookie({ expiresAt: Date.now() - 1000 }) }, 401, 'the right Origin and an expired cookie'],
    ]) {
      const r = await send(path, headers, body, ctype)
      assert.equal(r.status, want, path.split('?')[0] + ': ' + label + ' -> ' + r.status + ' ' + r.text.slice(0, 90))
    }
  }
  assert.equal(folder(), before, 'refused requests wrote nothing in the person\'s folder and left the file as it was')
  assert.equal(storage(), storeBefore, 'and nothing in the plugin\'s own storage')
  ok(`${attempts.length} routes: no header 403 · foreign Origin 403 · no cookie 401 · forged 401 · expired 401 · nothing written`)

  const real = await send(`/kybernos-office/save?token=${token}&base=${hash}`, good, xlsx({ cell: 'saved' }), 'application/octet-stream')
  assert.equal(real.status, 200, 'the real pair saves: ' + real.text)
  ok('the real pair (same origin + signed cookie) does save')

  for (const path of ['/kybernos-office/status', '/kybernos-office/stats']) {
    const r = await fetch(base + path)
    assert.equal(r.status, 200, path + ' still answers with no header (a GET carries no Origin)')
  }
  const foreignRead = await fetch(base + '/kybernos-office/status', { headers: { origin: 'http://evil.example' } })
  assert.equal(foreignRead.status, 403, 'a read from a foreign Origin is refused')
  const fileRoute = await fetch(base + `/kybernos-office/v/${token}/__file`, { headers: { origin: 'null' } })
  assert.equal(fileRoute.status, 200, 'the sandboxed page (Origin: null) reads its own file by token: the token is its key, and it cannot write')
  ok('the reads answer with no header, refuse a foreign Origin; only the token route is open to the sandboxed page')
  console.log('\nOFFICE WRITE GUARD — ' + pass + ' vérification(s), 0 échec')
} catch (e) {
  console.error('  ✗ ' + String(e && e.message ? e.message : e))
  process.exitCode = 1
} finally {
  server.close()
}
