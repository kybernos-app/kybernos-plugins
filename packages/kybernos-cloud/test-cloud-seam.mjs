// The seam the other bundles use to make ONE authenticated call to the active server (kybernos-mobile's phone link).
//   node packages/kybernos-cloud/test-cloud-seam.mjs
// What is proven: only /v1/remote/ and the three team-space routes of the ACTIVE workspace are reachable, the account token is added by the cloud host and never handed over,
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
  check('the seam is published, frozen, with only `call` and `workspace`', seam !== undefined && Object.isFrozen(seam) && typeof seam.call === 'function' && Object.keys(seam).sort().join(',') === 'call,version,workspace' && typeof seam.workspace === 'function')
  check('only the remote routes are reachable', SEAM_PREFIXES.length === 1 && SEAM_PREFIXES[0] === '/v1/remote/')

  let r = await cloudSeamCall('/v1/remote/pairings', { method: 'POST', body: { label: 'x' } })
  check('signed out: not_connected, and no network call', r.status === 0 && r.error === 'not_connected' && seen.length === 0)
  check('signed out: no active workspace', seam.workspace() === null)
  r = await cloudSeamCall('/v1/workspaces/ws_main/team-space/hosts', { method: 'GET' })
  check('signed out: the team-space routes answer not_connected too, with no network call', r.status === 0 && r.error === 'not_connected' && seen.length === 0)

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

  // The team-space routes (Publish onto the person's own cloud computer): the active workspace only, three method/route pairs, one query.
  check('signed in, with no workspace known: no active workspace, and the team-space routes are refused', seam.workspace() === null && (await cloudSeamCall('/v1/workspaces/ws_main/team-space/hosts', { method: 'GET' })).error === 'workspace_refused')
  writeFileSync(stateFile, JSON.stringify({ token: TOKEN, api: process.env.KYBERNOS_CLOUD_API, workspaces: [{ id: 'ws_main', name: 'Main' }, { id: 'ws_other', name: 'Other' }], active_workspace_id: 'ws_main' }) + '\n', { mode: 0o600 })
  check('workspace() is the active workspace\'s id', seam.workspace() === 'ws_main')
  const mark = seen.length
  r = await cloudSeamCall('/v1/workspaces/ws_main/team-space/hosts', { method: 'GET' })
  check('the computers are read with GET on the active workspace, with the token added here', r.status === 201 && seen.length === mark + 1 && seen[mark].method === 'GET' && seen[mark].url === '/v1/workspaces/ws_main/team-space/hosts' && seen[mark].auth === 'Bearer ' + TOKEN)
  r = await cloudSeamCall('/v1/workspaces/ws_main/team-space', { method: 'POST', body: { host: 'srv_1' } })
  check('a space is made with POST and the computer in the body', r.status === 201 && seen[mark + 1].method === 'POST' && seen[mark + 1].url === '/v1/workspaces/ws_main/team-space' && seen[mark + 1].body.host === 'srv_1')
  r = await cloudSeamCall('/v1/workspaces/ws_main/team-space?space=sp_1', { method: 'DELETE' })
  check('a space is given back with DELETE and the space named in the query', r.status === 201 && seen[mark + 2].method === 'DELETE' && seen[mark + 2].url === '/v1/workspaces/ws_main/team-space?space=sp_1')
  r = await cloudSeamCall('/v1/workspaces/ws_main/team-space', { method: 'DELETE' })
  check('(with no space named, DELETE is the workspace\'s only space)', r.status === 201 && seen[mark + 3].url === '/v1/workspaces/ws_main/team-space')
  check('the answers never carry the token', JSON.stringify(r).includes(TOKEN) === false)

  const afterTeam = seen.length
  const teamRefusals = [
    ['another workspace than the active one', '/v1/workspaces/ws_other/team-space/hosts', 'GET', 'workspace_refused'],
    ['a workspace that does not exist', '/v1/workspaces/ws_nope/team-space', 'POST', 'workspace_refused'],
    ['PUT on the space', '/v1/workspaces/ws_main/team-space', 'PUT', 'method_refused'],
    ['POST on the computers', '/v1/workspaces/ws_main/team-space/hosts', 'POST', 'method_refused'],
    ['DELETE on the computers', '/v1/workspaces/ws_main/team-space/hosts', 'DELETE', 'method_refused'],
    ['GET on the space itself', '/v1/workspaces/ws_main/team-space', 'GET', 'method_refused'],
    ['a query on POST', '/v1/workspaces/ws_main/team-space?space=sp_1', 'POST', 'method_refused'],
    ['a query on the computers', '/v1/workspaces/ws_main/team-space/hosts?space=sp_1', 'GET', 'method_refused'],
    ['another team-space route (freeze)', '/v1/workspaces/ws_main/team-space/freeze', 'POST', 'path_refused'],
    ['another team-space route (open link)', '/v1/workspaces/ws_main/team-space/open-link', 'POST', 'path_refused'],
    ['the space\'s settings', '/v1/workspaces/ws_main/team-space/settings', 'PUT', 'path_refused'],
    ['the workspace itself', '/v1/workspaces/ws_main', 'GET', 'path_refused'],
    ['the plan', '/v1/workspaces/ws_main/plan', 'GET', 'path_refused'],
    ['a second query parameter', '/v1/workspaces/ws_main/team-space?space=sp_1&x=1', 'DELETE', 'path_refused'],
    ['another query parameter', '/v1/workspaces/ws_main/team-space?other=sp_1', 'DELETE', 'path_refused'],
    ['an empty space', '/v1/workspaces/ws_main/team-space?space=', 'DELETE', 'path_refused'],
    ['a traversal in the space', '/v1/workspaces/ws_main/team-space?space=../x', 'DELETE', 'path_refused'],
    ['a traversal in the workspace', '/v1/workspaces/../team-space', 'POST', 'path_refused'],
    ['a slash in the workspace', '/v1/workspaces/ws_main/x/team-space', 'POST', 'path_refused'],
    ['a trailing slash', '/v1/workspaces/ws_main/team-space/', 'POST', 'path_refused'],
    ['a fragment', '/v1/workspaces/ws_main/team-space#x', 'POST', 'path_refused'],
    ['a host in the path', '/v1/workspaces/@evil.test/team-space', 'POST', 'path_refused'],
    ['an absolute URL', 'http://evil.test/v1/workspaces/ws_main/team-space', 'POST', 'path_refused'],
  ]
  for (const [label, path, method, error] of teamRefusals) {
    const x = await cloudSeamCall(path, { method })
    check('refused: ' + label, x.status === 0 && x.error === error, JSON.stringify(x))
  }
  check('a huge body on the space is refused', (await cloudSeamCall('/v1/workspaces/ws_main/team-space', { method: 'POST', body: { host: 'x'.repeat(9000) } })).error === 'body_refused')
  check('none of the refused team-space calls reached the server', seen.length === afterTeam)
  writeFileSync(stateFile, JSON.stringify({ token: TOKEN, api: process.env.KYBERNOS_CLOUD_API, workspaces: [{ id: 'ws_main' }, { id: 'ws_other' }], active_workspace_id: 'ws_other' }) + '\n', { mode: 0o600 })
  check('switching the active workspace moves what is reachable', seam.workspace() === 'ws_other' && (await cloudSeamCall('/v1/workspaces/ws_main/team-space/hosts', { method: 'GET' })).error === 'workspace_refused' && (await cloudSeamCall('/v1/workspaces/ws_other/team-space/hosts', { method: 'GET' })).status === 201)
  writeFileSync(stateFile, JSON.stringify({ token: TOKEN, api: process.env.KYBERNOS_CLOUD_API }) + '\n', { mode: 0o600 })

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
