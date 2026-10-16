// The seam the other bundles use to make ONE authenticated call to the active server (kybernos-mobile's phone link).
//   node packages/kybernos-cloud/test-cloud-seam.mjs
// What is proven: only /v1/remote/ is reachable, the account token is added by the cloud host and never handed over,
// a signed-out DSH gets `not_connected` without any network call, and a body or method outside the rules is refused.
import { createServer } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}

const seen = []
const api = createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization || null, body: raw === '' ? null : JSON.parse(raw) })
    res.writeHead(req.url.endsWith('/denied') ? 403 : 201, { 'content-type': 'application/json' })
    res.end(JSON.stringify(req.url.endsWith('/denied') ? { error: 'remote_not_in_plan' } : { sid: 's1' }))
  })
})
await new Promise((r) => api.listen(0, '127.0.0.1', r))
const home = mkdtempSync(join(tmpdir(), 'kb-cloud-seam-'))
const stateFile = join(home, 'kybernos-cloud.json')
process.env.HOME = home
process.env.DSH_HOME = join(home, '.dsh')
process.env.KYBERNOS_CLOUD_API = 'http://127.0.0.1:' + api.address().port
process.env.KYBERNOS_CLOUD_STATE = stateFile
delete process.env.KYBERNOS_SERVERS_FILE

const TOKEN = 'kyd_' + 's'.repeat(40)
try {
  const { cloudSeamCall, publishCloudSeam, SEAM_PREFIXES } = await import('./index.js')

  const target = {}
  publishCloudSeam(target)
  const seam = target[Symbol.for('kybernos.cloud')]
  check('the seam is published, frozen, with only `call`', seam !== undefined && Object.isFrozen(seam) && typeof seam.call === 'function' && Object.keys(seam).sort().join(',') === 'call,version')
  check('only the remote routes are reachable', SEAM_PREFIXES.length === 1 && SEAM_PREFIXES[0] === '/v1/remote/')

  let r = await cloudSeamCall('/v1/remote/pairings', { method: 'POST', body: { label: 'x' } })
  check('signed out: not_connected, and no network call', r.status === 0 && r.error === 'not_connected' && seen.length === 0)

  writeFileSync(stateFile, JSON.stringify({ token: TOKEN, api: process.env.KYBERNOS_CLOUD_API }) + '\n', { mode: 0o600 })
  r = await cloudSeamCall('/v1/remote/pairings', { method: 'POST', body: { label: 'My Mac' } })
  check('signed in: the call reaches the server with the account token', r.status === 201 && r.body.sid === 's1' && seen.length === 1 && seen[0].auth === 'Bearer ' + TOKEN && seen[0].body.label === 'My Mac')
  check('the answer never carries the token', JSON.stringify(r).includes(TOKEN) === false)
  r = await cloudSeamCall('/v1/remote/devices/d1/ticket', { method: 'POST', body: {} })
  check('a path below the prefix works', r.status === 201 && seen.length === 2 && seen[1].url === '/v1/remote/devices/d1/ticket')
  r = await cloudSeamCall('/v1/remote/denied', { method: 'GET' })
  check('a refusal of the server is passed on as it is', r.status === 403 && r.body.error === 'remote_not_in_plan')

  const before = seen.length
  const refusals = [
    ['another prefix', '/v1/me'],
    ['the workspaces', '/v1/workspaces'],
    ['a traversal', '/v1/remote/../me'],
    ['a double slash', '/v1/remote//x'],
    ['a query string', '/v1/remote/devices?x=1'],
    ['a host in the path', '/v1/remote/@evil.test'],
    ['an absolute URL', 'http://evil.test/v1/remote/x'],
    ['no path', undefined],
  ]
  for (const [label, path] of refusals) {
    const x = await cloudSeamCall(path, { method: 'GET' })
    check('refused: ' + label, x.status === 0 && x.error === 'path_refused')
  }
  check('an odd method is refused', (await cloudSeamCall('/v1/remote/x', { method: 'PUT' })).error === 'method_refused')
  check('an array body is refused', (await cloudSeamCall('/v1/remote/x', { method: 'POST', body: [1] })).error === 'body_refused')
  check('a huge body is refused', (await cloudSeamCall('/v1/remote/x', { method: 'POST', body: { a: 'x'.repeat(9000) } })).error === 'body_refused')
  check('none of the refused calls reached the server', seen.length === before)

  // The server does not answer (a closed port): the caller can say WHICH server (label and host) and whether another one could be chosen (audit V-41).
  // Not the address in full, and never the token.
  const closed = await new Promise((r) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)) }) })
  process.env.KYBERNOS_CLOUD_API = 'http://127.0.0.1:' + closed
  r = await cloudSeamCall('/v1/remote/pairings', { method: 'POST', body: { label: 'My Mac' } })
  check('an unreachable server: status 0 and the answer names it (label, host)', r.status === 0 && r.server !== undefined && r.server.name === 'Kybernos Cloud' && r.server.host === '127.0.0.1:' + closed, JSON.stringify(r))
  check('and says whether there is another server to switch to (none: only the built-in one)', r.server !== undefined && r.server.can_switch === false, JSON.stringify(r))
  check('the answer still never carries the token', JSON.stringify(r).includes(TOKEN) === false)
  r = await cloudSeamCall('/v1/other', { method: 'GET' })
  check('a refused call does not name a server (it never left)', r.error === 'path_refused' && r.server === undefined)
} catch (e) {
  console.log('  ✗ exception — ' + (e && e.stack ? e.stack : e))
  failed += 1
} finally {
  api.close()
  if (typeof api.closeAllConnections === 'function') api.closeAllConnections()
  rmSync(home, { recursive: true, force: true })
}
console.log(failed === 0 ? '\nOK' : '\n' + failed + ' failure(s)')
process.exit(failed === 0 ? 0 : 1)
