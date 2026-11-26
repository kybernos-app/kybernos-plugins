// ── The slash entries POST needs the signed session, not only an Origin ──────────────────────────────────────────────────
//
// A-16 (audit 2026-10-20): `POST /kybernos/slash/entries` was behind `sameOrigin` alone, which accepts a request with NO
// Origin at all — any local program wrote the person's commands and message actions. Its callers are two pages
// (Settings ▸ Commands and the core plugin's `/widget` upsert), whose same-origin fetch carries the signed session
// cookie. The agent's path is NOT this route any more: the `slash-msgaction-creator` skill calls the host tool
// `enregistrer_entree` (tool.mjs), which applies the same mutation in process, so no non-browser caller is left open.
//
//   node packages/kybernos-slash/test-write-guard.mjs
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from './index.js'
import { sessionSource } from './session-guard.mjs'
import { OTHER_SECRET, SESSION_SECRET, sessionCookie } from './lib-session-test.mjs'

sessionSource.secret = () => SESSION_SECRET

const root = mkdtempSync(join(tmpdir(), 'kb-slash-guard-'))
process.env.DSH_HOME = join(root, 'dsh-home')
const store = join(root, 'entries.json')
process.env.KYBERNOS_SLASH_STORE = store

// The routes, through the real `apply(ctx)`, exactly as the host mounts them.
const routes = new Map()
{
  const webServer = { register: (r) => { routes.set(r.path, r.handler); return () => {} } }
  const hostCtx = { get: (key) => (key === 'webServer' ? webServer : null), effect: (fn) => fn() }
  const log = console.log
  console.log = () => {}
  try { apply({ inject: (deps, fn) => fn(hostCtx) }) } finally { console.log = log }
}

const server = createServer((req, res) => {
  const handler = routes.get(new URL(req.url, 'http://127.0.0.1').pathname)
  if (handler === undefined) { res.writeHead(404); res.end('{}'); return }
  Promise.resolve(handler(req, res)).catch(() => { try { res.writeHead(500); res.end('{}') } catch (e) { /* closed */ } })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port
const base = 'http://127.0.0.1:' + port
const origin = base
const authority = '127.0.0.1:' + port
const cookie = (opts) => sessionCookie(authority, opts)
const send = (path, headers, body) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, text: await r.text().catch(() => '') }))
const lire = () => { try { return readFileSync(store, 'utf8') } catch (e) { return null } }

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

try {
  console.log('kybernos-slash: the entries POST needs the signed session')
  const path = '/kybernos/slash/entries'
  const body = { entry: { id: 'standup', kind: 'slash', slug: 'standup', label: 'Team standup', template: 'Daily standup' } }
  for (const [headers, want, label] of [
    [{}, 403, 'no Origin and no cookie'],
    [{ origin: 'http://evil.example', cookie: cookie() }, 403, 'a foreign Origin, even with the real cookie'],
    [{ origin }, 401, 'the right Origin and no cookie'],
    [{ origin, cookie: cookie({ secret: OTHER_SECRET }) }, 401, 'the right Origin and a forged cookie'],
  ]) {
    const r = await send(path, headers, body)
    assert.equal(r.status, want, path + ': ' + label + ' -> ' + r.status + ' ' + r.text.slice(0, 90))
  }
  assert.equal(lire(), null, path + ': a refused request wrote nothing (the store file was never created)')
  const real = await send(path, { origin, cookie: cookie() }, body)
  assert.notEqual(real.status, 401, path + ': the real pair is not refused as unsigned')
  assert.notEqual(real.status, 403, path + ': the real pair is not refused as foreign')
  assert.equal(real.status, 200, path + ': the real pair writes -> ' + real.text.slice(0, 120))
  assert.equal(JSON.parse(lire())[0].id, 'standup', path + ': the entry is on disk after the real pair')
  ok(path + ': no header 403 · foreign Origin 403 · no cookie 401 · forged cookie 401 · nothing written · the real pair writes')

  const read = await fetch(base + '/kybernos/slash/entries').then((r) => r.json())
  assert.equal(read.ok, true, 'the read still answers with no header (a GET carries no Origin)')
  assert.equal(read.entries.length, 1, 'the read sees the entry the page wrote')
  ok('the read (/entries) keeps answering with no header')
  console.log('\nSLASH WRITE GUARD — ' + pass + ' vérification(s), 0 échec')
} catch (e) {
  console.error('  ✗ ' + String(e && e.message ? e.message : e))
  process.exitCode = 1
} finally {
  server.close()
  rmSync(root, { recursive: true, force: true })
}
