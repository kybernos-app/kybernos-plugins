// Tests of Kybernos connections on the DSH side: the routes of the connectors page (/kybernos-cloud/connections*), the three native
// tools of the agents, and their pure half (connections.mjs).
//   node packages/kybernos-cloud/test-connections.mjs
//
// The server side is docs/adr/0008-connections.md of the Kybernos server, and nothing of it is deployed: a stand-in speaks its
// contract (REST and MCP). What matters here is what THIS side does: when anything leaves the machine (never when the server does
// not offer connections or the account is not connected), which call each route makes (path, method, body, the token only in the
// Authorization header, never a redirect_uri), that an API key is neither echoed nor kept, that every refusal becomes one word and
// the server's own text never reaches the page, and that the tools exist exactly while they can work.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CONNECTION_TOOLS, MAX_RESULT_CHARS, STATUSES, asApp, asAppList, asConnection, asConnectionList, asLinked, connectionsFailure, connectionsPaths, isConnectionId, isToolkit,
  linkBody, rpcCall, rpcOutcome, safeRedirect,
} from './connections.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

const C1 = '0b1c2d3e-aaaa-4bbb-8ccc-1234567890ab'
const C2 = '11111111-2222-4333-8444-555555555555'
const TOKEN = 'kyd-secret-token-0123456789'
const KEY = 'sk-live-THIS-IS-AN-API-KEY-9876543210'

// ── the pure half ──
{
  assert.equal(connectionsPaths.list, '/v1/connections')
  assert.equal(connectionsPaths.apps, '/v1/connections/apps')
  assert.equal(connectionsPaths.link, '/v1/connections/link')
  assert.equal(connectionsPaths.one(C1), '/v1/connections/' + C1)
  assert.equal(connectionsPaths.one('a/b?c'), '/v1/connections/a%2Fb%3Fc')
  for (const v of [C1, C2.toUpperCase()]) assert.equal(isConnectionId(v), true, v)
  for (const v of ['', 'abc', '1', C1 + 'x', 'x' + C1, '../' + C1, C1.replace(/-/g, ''), null, undefined, 5, {}, [C1]]) assert.equal(isConnectionId(v), false, String(v))
  for (const v of ['github', 'googlecalendar', 'google_super', 'a-b', 'x'.repeat(64)]) assert.equal(isToolkit(v), true, v)
  for (const v of ['', 'GitHub', '-x', '_x', 'a b', 'a/b', '../x', 'x'.repeat(65), 'é', null, 5]) assert.equal(isToolkit(v), false, String(v))
  ok('a connection id is the server\'s UUID and a toolkit a short lower-case slug; nothing else reaches a path')

  const f = (status, body, named) => connectionsFailure(status, body, { named })
  assert.equal(f(200, {}), null)
  assert.equal(f(201, {}), null)
  assert.deepEqual(f(401, { error: 'unauthorized' }), { error: 'reconnect_required' })
  assert.deepEqual(f(0, null), { error: 'network' })
  assert.deepEqual(f(403, { error: 'forbidden' }), { error: 'forbidden' })
  assert.deepEqual(f(404, { error: 'not_found' }, true), { error: 'not_found' })
  assert.deepEqual(f(404, { error: 'not_found', message: 'No such route.' }, false), { error: 'not_on_this_server' })
  assert.deepEqual(f(404, null), { error: 'not_on_this_server' })
  assert.deepEqual(f(409, { error: 'pending_exists', existing: { id: C1, toolkit: 'gmail', status: 'pending' } }), { error: 'pending_exists', existing: { id: C1, toolkit: 'gmail', status: 'pending' } })
  assert.deepEqual(f(409, { error: 'pending_exists', existing: { id: 'nope', toolkit: 'gmail' } }), { error: 'pending_exists', existing: undefined })
  assert.deepEqual(f(409, { error: 'connection_limit', limit: 3, count: 3 }), { error: 'connection_limit', limit: 3, count: 3 })
  assert.deepEqual(f(409, { error: 'whatever' }), { error: 'conflict' })
  assert.deepEqual(f(413, null), { error: 'too_large' })
  assert.deepEqual(f(422, { error: 'no_managed_credentials' }), { error: 'needs_api_key' })
  assert.deepEqual(f(422, { error: 'other' }), { error: 'bad_request' })
  assert.deepEqual(f(400, { error: 'redirect_uri_not_allowed' }), { error: 'bad_request' })
  assert.deepEqual(f(429, { error: 'rate_limited' }), { error: 'too_many_requests' })
  assert.deepEqual(f(503, { error: 'connections_disabled' }), { error: 'connections_disabled' })
  assert.deepEqual(f(503, { error: 'overloaded' }), { error: 'upstream_unavailable', checkFirst: false })
  assert.deepEqual(f(502, { error: 'upstream_unavailable', retry: 'check_first' }), { error: 'upstream_unavailable', checkFirst: true })
  assert.deepEqual(f(504, null), { error: 'upstream_unavailable', checkFirst: false })
  assert.deepEqual(f(500, { error: 'internal_error' }), { error: 'refused_500' })
  assert.equal(JSON.stringify([f(500, { error: 'SECRET ' + KEY, message: KEY }), f(400, { error: KEY, message: KEY }), f(409, { error: 'pending_exists', message: KEY, existing: { id: C1, toolkit: 'gmail', status: 'pending', email: 'a@b.test' } })]).includes('SECRET'), false)
  assert.equal(JSON.stringify(f(409, { error: 'pending_exists', existing: { id: C1, toolkit: 'gmail', status: 'pending', email: 'a@b.test' } })).includes('a@b.test'), false)
  ok('every refusal of the contract becomes one word; the server\'s own text never passes; a 404 is "not found" only where something was named')

  const row = asConnection({ id: C1, toolkit: 'gmail', status: 'active', account_type: 'oauth', alias: 'work', is_default: true, created_at: '2026-10-06T10:00:00Z', user_info: { email: 'a@b.test' }, token: 'T' })
  assert.deepEqual(row, { id: C1, toolkit: 'gmail', status: 'active', accountType: 'oauth', alias: 'work', isDefault: true, createdAt: '2026-10-06T10:00:00Z', failure: null })
  assert.equal(JSON.stringify(row).includes('a@b.test'), false)
  assert.deepEqual([asConnection({ id: C1, toolkit: 'github', status: 'failed', failure: 'refused' }).failure, asConnection({ id: C1, toolkit: 'github', status: 'failed', failure: 'Composio said: boom' }).failure, asConnection({ id: C1, toolkit: 'github', status: 'failed' }).failure, asConnection({ id: C1, toolkit: 'github', status: 'active', failure: 'refused' }).failure], ['refused', 'unknown', 'unknown', null])
  for (const s of STATUSES) assert.equal(asConnection({ id: C1, toolkit: 'x', status: s }).status, s)
  assert.equal(asConnection({ id: C1, toolkit: 'x', status: 'a-new-word' }).status, 'unknown')
  assert.deepEqual([asConnection({ id: C1, toolkit: 'x', status: 'pending' }).accountType, asConnection({ id: C1, toolkit: 'x', status: 'pending' }).alias, asConnection({ id: C1, toolkit: 'x', status: 'pending' }).isDefault], [null, null, false])
  for (const bad of [null, undefined, 5, 'x', [], {}, { id: '', toolkit: 'x' }, { id: C1 }, { id: C1, toolkit: '' }]) assert.equal(asConnection(bad), null, JSON.stringify(bad))
  ok('a connection row keeps its seven fields and nothing of the third party; an unknown status is "unknown"; a failure code only on a failed one')

  const list = asConnectionList({ configured: true, connections: [{ id: C1, toolkit: 'gmail', status: 'active' }, { nope: 1 }, { id: C2, toolkit: 'github', status: 'pending' }], limit: 3, count: 2, stale: true })
  assert.deepEqual([list.configured, list.connections.length, list.limit, list.count, list.stale], [true, 2, 3, 2, true])
  const bare = asConnectionList({ connections: [] })
  assert.deepEqual([bare.configured, bare.limit, bare.count, bare.stale], [true, null, 0, false])
  assert.equal(asConnectionList({ configured: false, connections: [] }).configured, false)
  for (const bad of [null, {}, { connections: 'x' }, []]) assert.equal(asConnectionList(bad), null)
  assert.equal(asConnectionList({ connections: [{ id: C1, toolkit: 'a', status: 'active' }, { id: C2, toolkit: 'b', status: 'pending' }] }).count, 2, 'without its number, what was read')
  ok('the list maps its rows, quietly drops what is no row, and keeps "2 of 3" and the stale flag')

  assert.deepEqual(asApp({ slug: 'gmail', name: 'Gmail', categories: ['email', 5], description: 'Mail', logo: 'https://logos.example/x.svg', needs_api_key: false }), { slug: 'gmail', name: 'Gmail', categories: ['email'], description: 'Mail', needsApiKey: false })
  assert.equal(asApp({ slug: 'x', name: 'X', needs_api_key: true }).needsApiKey, true)
  assert.equal(asApp({ slug: 'x' }).name, 'x')
  assert.equal(asApp({ slug: 'BAD SLUG', name: 'x' }), null)
  assert.equal(JSON.stringify(asApp({ slug: 'gmail', name: 'Gmail', logo: 'https://logos.example/x.svg' })).includes('logos.example'), false)
  assert.equal(asAppList({ configured: false, apps: [] }).configured, false)
  assert.equal(asAppList({ apps: [{ slug: 'a', name: 'A' }, { slug: 'B B' }] }).apps.length, 1)
  assert.equal(asAppList({}), null)
  ok('the catalogue maps its apps and never carries a third-party address the page would load by itself')

  assert.deepEqual(linkBody({ toolkit: ' GitHub ' }), { body: { toolkit: 'github' } })
  assert.deepEqual(linkBody({ toolkit: 'x', api_key: '  ' + KEY + '  ', alias: '  work  ', user_id: 'kyb_other', redirect_uri: 'https://evil.test', ignored: 1 }), { body: { toolkit: 'x', api_key: KEY, alias: 'work' } })
  assert.deepEqual(linkBody({ toolkit: 'x', api_key: '', alias: '   ' }), { body: { toolkit: 'x' } })
  assert.deepEqual(linkBody({ toolkit: 'x', alias: 'a'.repeat(200) }).body.alias.length, 64)
  for (const bad of [null, {}, { toolkit: '' }, { toolkit: 'A B' }, { toolkit: '../x' }, { toolkit: 5 }, { toolkit: 'x', api_key: 5 }, { toolkit: 'x', api_key: 'k'.repeat(4097) }, { toolkit: 'x', api_key: '   ' }]) assert.deepEqual(linkBody(bad), { error: 'bad_request' }, JSON.stringify(bad).slice(0, 60))
  assert.equal(linkBody({ toolkit: 'x', api_key: 'k'.repeat(4096) }).body.api_key.length, 4096)
  ok('a link body carries the toolkit, the key and the label and nothing else: never a redirect_uri, never a user id')

  assert.equal(safeRedirect('https://backend.composio.dev/api/v3/s/abc'), 'https://backend.composio.dev/api/v3/s/abc')
  assert.equal(safeRedirect('http://127.0.0.1:8080/x'), 'http://127.0.0.1:8080/x')
  for (const v of ['javascript:alert(1)', 'data:text/html,x', 'http://evil.test/x', 'ftp://a.test/x', 'https://u:p@a.test/x', 'not a url', '', null, 5]) assert.equal(safeRedirect(v), null, String(v))
  assert.deepEqual(asLinked({ id: C1, status: 'pending', redirect_url: 'https://a.test/go' }), { id: C1, status: 'pending', redirectUrl: 'https://a.test/go' })
  assert.deepEqual(asLinked({ id: C1, status: 'active', redirect_url: null }), { id: C1, status: 'active', redirectUrl: null })
  assert.equal(asLinked({ id: C1, status: 'pending', redirect_url: 'javascript:alert(1)' }).redirectUrl, null)
  assert.equal(asLinked({ id: C1, status: 'mystery' }), null)
  assert.equal(asLinked({ status: 'pending' }), null)
  ok('the address the person is sent to is https (or loopback for a test double): a page never opens a script, a data or a plain-http address')

  assert.deepEqual(CONNECTION_TOOLS, ['connections_list', 'connections_search_tools', 'connections_execute'])
  assert.deepEqual(rpcCall('connections_list', undefined, 7), { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'connections_list', arguments: {} } })
  const r = rpcOutcome
  assert.deepEqual(r(200, { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'a' }, { type: 'image', data: 'x' }, { type: 'text', text: 'b' }] } }), { ok: true, text: 'a\nb' })
  assert.deepEqual(r(200, { result: { content: [] } }), { ok: true, text: '' })
  assert.deepEqual(r(200, { result: { isError: true, content: [{ type: 'text', text: '{"code":"not_connected","message":"Connect gmail first"}' }] } }), { ok: false, error: 'not_connected', text: '{"code":"not_connected","message":"Connect gmail first"}' })
  assert.deepEqual(r(200, { result: { isError: true, structuredContent: { code: 'action_failed', retryable: true }, content: [{ type: 'text', text: 'It failed' }] } }), { ok: false, error: 'action_failed', text: 'It failed' })
  assert.equal(r(200, { result: { isError: true, content: [{ type: 'text', text: 'plain words' }] } }).error, 'tool_error')
  assert.equal(r(200, { result: { isError: true, structuredContent: { code: 'Not A Code!' }, content: [] } }).error, 'tool_error')
  assert.deepEqual(r(200, { error: { code: -32602, message: 'SECRET ' + KEY } }), { ok: false, error: 'invalid_params' })
  assert.deepEqual(r(200, { error: { code: -32601 } }), { ok: false, error: 'not_on_this_server' })
  assert.deepEqual(r(200, { error: { code: -32603, message: 'x' } }), { ok: false, error: 'refused_rpc' })
  assert.deepEqual(r(200, { result: {} }), { ok: false, error: 'invalid_response' })
  assert.deepEqual(r(200, null), { ok: false, error: 'invalid_response' })
  assert.deepEqual([r(0, null).error, r(401, {}).error, r(403, {}).error, r(429, {}).error, r(413, {}).error, r(405, {}).error, r(415, {}).error, r(500, {}).error], ['network', 'reconnect_required', 'forbidden', 'too_many_requests', 'refused_413', 'refused_405', 'refused_415', 'refused_500'])
  assert.equal(JSON.stringify(r(200, { error: { code: -32602, message: 'SECRET ' + KEY } })).includes('SECRET'), false)
  const huge = r(200, { result: { content: [{ type: 'text', text: 'x'.repeat(MAX_RESULT_CHARS + 500) }] } })
  assert.ok(huge.ok === true && huge.text.length < MAX_RESULT_CHARS + 200 && huge.text.endsWith(']'), 'a result past the bound is cut with a marker')
  ok('a JSON-RPC answer becomes a result or one word: the door\'s statuses, protocol errors, a tool\'s own failure with its text, an oversized result cut')
}

// ── the host, against a stand-in server ──
const seen = []
let answer = () => ({ status: 200, body: {} })
const api = createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    let body = null
    try { body = raw === '' ? null : JSON.parse(raw) } catch (e) { body = '<<not json>>' }
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization || null, body, raw })
    const a = answer(req, body)
    res.writeHead(a.status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(a.body))
  })
})
await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve))
const ORIGIN = 'http://127.0.0.1:' + api.address().port
const dir = mkdtempSync(join(tmpdir(), 'kb-connections-'))
const SERVERS = join(dir, 'servers.json')
const STATE = join(dir, 'state.json')
const writeState = (state) => writeFileSync(STATE, JSON.stringify(state))
const registry = (connections) => writeFileSync(SERVERS, JSON.stringify({ active: 'local', servers: [{ id: 'local', name: 'Local', api: ORIGIN, services: connections === undefined ? {} : { connections } }] }))
delete process.env.KYBERNOS_CLOUD_API
process.env.KYBERNOS_SERVERS_FILE = SERVERS
process.env.KYBERNOS_CLOUD_STATE = STATE
process.env.KYBERNOS_CLOUD_KYBERS = join(dir, 'kybers')
const connected = { token: TOKEN, user: { id: 'u-me', name: 'Sara M.', plan: 'studio' }, workspaces: [] }
const MCP = ORIGIN + '/v1/mcp/connections'

try {
  const mod = await import('./index.js')
  const route = (path) => mod.ROUTES.find((r) => r.path === path)
  const BASE = '/kybernos-cloud/connections'
  const call = async (path, query, body) => route(path).run({ url: path + (query === undefined ? '' : '?' + query) }, body)
  const reset = () => { seen.length = 0; answer = () => ({ status: 200, body: {} }) }
  const leaks = (v, needle = TOKEN) => JSON.stringify(v).includes(needle)

  // route table
  const paths = [BASE, BASE + '/apps', BASE + '/item', BASE + '/link', BASE + '/delete']
  for (const p of paths) {
    const r = route(p)
    assert.ok(r !== undefined, p)
    assert.equal(r.guarded, true, p + ' needs the same-origin guard')
  }
  assert.deepEqual(paths.map((p) => route(p).method), ['GET', 'GET', 'GET', 'POST', 'POST'])
  for (const p of [BASE + '/link', BASE + '/delete']) assert.ok(route(p).cap <= 16384, p + ' takes a small body')
  assert.equal(new Set(mod.ROUTES.map((r) => r.path)).size, mod.ROUTES.length, 'no two routes share a path')
  ok('five routes, all behind the same-origin guard, small bodies, no path shared')

  // a server that does not offer connections, and an account that is not connected: nothing leaves the machine
  writeState(connected)
  for (const connections of [undefined, false]) {
    registry(connections)
    reset()
    assert.deepEqual(await call(BASE), { ok: true, offered: false, connected: true })
    assert.deepEqual(await call(BASE + '/apps'), { ok: true, offered: false, connected: true })
    assert.deepEqual((await call(BASE + '/link', undefined, { toolkit: 'gmail' })).offered, false)
    assert.deepEqual((await call(BASE + '/delete', undefined, { id: C1 })).offered, false)
    assert.deepEqual((await call(BASE + '/item', 'id=' + C1)).offered, false)
    assert.equal(seen.length, 0, 'a server without connections is never asked')
  }
  registry(MCP)
  rmSync(STATE, { force: true })
  reset()
  for (const [p, q, b] of [[BASE], [BASE + '/apps'], [BASE + '/item', 'id=' + C1], [BASE + '/link', undefined, { toolkit: 'gmail' }], [BASE + '/delete', undefined, { id: C1 }]]) {
    assert.deepEqual(await call(p, q, b), { ok: false, offered: true, connected: false, error: 'non connecte' }, p)
  }
  assert.equal(seen.length, 0, 'not connected: not one call to the server')
  ok('not offered (absent or false) or not connected: answered with a word and not one call leaves the machine')

  // the list
  writeState(connected)
  reset()
  answer = () => ({ status: 200, body: { configured: true, limit: 3, count: 2, connections: [
    { id: C1, toolkit: 'gmail', status: 'active', account_type: 'oauth', alias: 'work', is_default: true, created_at: 't1', user_info: { email: 'leak@x.test' } },
    { id: C2, toolkit: 'github', status: 'pending', account_type: 'oauth', alias: null, is_default: false, created_at: 't2' }] } })
  const listed = await call(BASE)
  assert.deepEqual([listed.ok, listed.offered, listed.connected, listed.limit, listed.count, listed.connections.length, listed.connections[0].alias, listed.connections[1].status, listed.stale], [true, true, true, 3, 2, 2, 'work', 'pending', false])
  assert.deepEqual([seen[0].method, seen[0].url, seen[0].auth, seen[0].body], ['GET', '/v1/connections', 'Bearer ' + TOKEN, null])
  assert.equal(leaks(listed), false, 'the token never goes back to the page')
  assert.equal(leaks(listed, 'leak@x.test'), false, 'nothing of the third-party account goes back either')
  await call(BASE, 'refresh=1')
  await call(BASE, 'refresh=yes&x=1')
  assert.deepEqual(seen.map((c) => c.url), ['/v1/connections', '/v1/connections?refresh=1', '/v1/connections'])
  answer = () => ({ status: 200, body: { configured: true, connections: [], stale: true } })
  assert.equal((await call(BASE)).stale, true)
  answer = () => ({ status: 200, body: { nope: 1 } })
  assert.equal((await call(BASE)).error, 'invalid_response')
  ok('list: the account\'s own token in the header only, ?refresh=1 passed on only when it is exactly that, "2 of 3" and stale kept, nothing of the third party')

  // the catalogue
  reset()
  answer = () => ({ status: 200, body: { configured: true, apps: [{ slug: 'gmail', name: 'Gmail', categories: ['email'], logo: 'https://l.test/g.svg', description: 'Mail' }, { slug: 'notion', name: 'Notion', needs_api_key: true }] } })
  const apps = await call(BASE + '/apps')
  assert.deepEqual([apps.ok, apps.apps.map((a) => a.slug), apps.apps[1].needsApiKey], [true, ['gmail', 'notion'], true])
  assert.deepEqual([seen[0].method, seen[0].url, seen[0].auth], ['GET', '/v1/connections/apps', 'Bearer ' + TOKEN])
  assert.equal(leaks(apps, 'l.test'), false)
  answer = () => ({ status: 200, body: { configured: false, apps: [] } })
  assert.deepEqual([(await call(BASE + '/apps')).configured, (await call(BASE + '/apps')).apps], [false, []])
  ok('catalogue: fetched with the token, a module that is switched off says configured:false')

  // one connection, polled
  reset()
  answer = () => ({ status: 200, body: { id: C2, toolkit: 'github', status: 'active', account_type: 'oauth', alias: null, is_default: true, created_at: 't' } })
  const one = await call(BASE + '/item', 'id=' + C2)
  assert.deepEqual([one.ok, one.connection.id, one.connection.status], [true, C2, 'active'])
  assert.deepEqual([seen[0].method, seen[0].url], ['GET', '/v1/connections/' + C2])
  answer = () => ({ status: 200, body: { connection: { id: C2, toolkit: 'github', status: 'failed', failure: 'upstream' } } })
  assert.deepEqual([(await call(BASE + '/item', 'id=' + C2)).connection.failure], ['upstream'])
  seen.length = 0
  for (const id of ['abc', '', '../' + C1, C1 + '/x', C1 + '?x=1', '1; DROP', undefined]) {
    const r = await call(BASE + '/item', id === undefined ? undefined : 'id=' + encodeURIComponent(id))
    assert.deepEqual([r.ok, r.error], [false, 'not_found'], String(id))
  }
  assert.equal(seen.length, 0, 'an id that is no UUID is refused before any call')
  answer = () => ({ status: 404, body: { error: 'not_found' } })
  assert.equal((await call(BASE + '/item', 'id=' + C1)).error, 'not_found')
  answer = () => ({ status: 200, body: { id: C1 } })
  assert.equal((await call(BASE + '/item', 'id=' + C1)).error, 'invalid_response')
  ok('one connection: only a UUID reaches the path, someone else\'s or a missing one is "not_found", an answer that is no connection is "invalid_response"')

  // link: OAuth
  reset()
  answer = () => ({ status: 201, body: { id: C1, status: 'pending', redirect_url: 'https://backend.composio.dev/api/v3/s/xyz' } })
  const linked = await call(BASE + '/link', undefined, { toolkit: 'Gmail', alias: ' work ', user_id: 'kyb_someone_else', redirect_uri: 'https://evil.test/cb', extra: 1 })
  assert.deepEqual([linked.ok, linked.connection, linked.redirectUrl], [true, { id: C1, status: 'pending' }, 'https://backend.composio.dev/api/v3/s/xyz'])
  assert.deepEqual([seen[0].method, seen[0].url, seen[0].auth, seen[0].body], ['POST', '/v1/connections/link', 'Bearer ' + TOKEN, { toolkit: 'gmail', alias: 'work' }])
  assert.equal(seen[0].raw.includes('redirect_uri'), false, 'DSH never sends a redirect_uri')
  assert.equal(seen[0].raw.includes('kyb_'), false, 'DSH never sends a user id')
  // link: API key
  seen.length = 0
  answer = () => ({ status: 201, body: { id: C2, status: 'active', redirect_url: null } })
  const keyed = await call(BASE + '/link', undefined, { toolkit: 'notion', api_key: KEY })
  assert.deepEqual([keyed.ok, keyed.connection, keyed.redirectUrl], [true, { id: C2, status: 'active' }, null])
  assert.deepEqual(seen[0].body, { toolkit: 'notion', api_key: KEY })
  assert.equal(leaks(keyed, KEY), false, 'the key is not echoed')
  assert.equal(seen.filter((c) => c.url.includes(KEY)).length, 0, 'the key is never in a path or a query')
  assert.equal(seen.filter((c) => c.auth !== null && c.auth.includes(KEY)).length, 0)
  // link: a redirect that is not safe is not handed over
  answer = () => ({ status: 201, body: { id: C1, status: 'pending', redirect_url: 'javascript:alert(1)' } })
  assert.equal((await call(BASE + '/link', undefined, { toolkit: 'gmail' })).redirectUrl, null)
  // link: malformed bodies cost no call
  seen.length = 0
  for (const bad of [null, {}, { toolkit: '' }, { toolkit: 'a b' }, { toolkit: 'x', api_key: 5 }, { toolkit: 'x', api_key: 'k'.repeat(5000) }]) assert.deepEqual([(await call(BASE + '/link', undefined, bad)).ok, (await call(BASE + '/link', undefined, bad)).error], [false, 'bad_request'])
  assert.equal(seen.length, 0)
  // link: what the server may answer
  const refusals = [
    [409, { error: 'pending_exists', existing: { id: C1, toolkit: 'gmail', status: 'pending' } }, { error: 'pending_exists', existing: { id: C1, toolkit: 'gmail', status: 'pending' } }],
    [409, { error: 'connection_limit', limit: 3, count: 3 }, { error: 'connection_limit', limit: 3, count: 3 }],
    [422, { error: 'no_managed_credentials' }, { error: 'needs_api_key' }],
    [502, { error: 'upstream_unavailable', retry: 'check_first', message: KEY }, { error: 'upstream_unavailable', checkFirst: true }],
    [503, { error: 'connections_disabled' }, { error: 'connections_disabled' }],
    [404, { error: 'not_found' }, { error: 'not_found' }],
    [401, { error: 'unauthorized' }, { error: 'reconnect_required' }],
    [429, { error: 'rate_limited' }, { error: 'too_many_requests' }],
    [500, { error: 'SECRET internals ' + KEY, message: KEY }, { error: 'refused_500' }],
  ]
  for (const [status, body, want] of refusals) {
    answer = () => ({ status, body })
    const r = await call(BASE + '/link', undefined, { toolkit: 'notion', api_key: KEY })
    assert.deepEqual({ ...r, offered: undefined, connected: undefined }, { ok: false, ...want, offered: undefined, connected: undefined }, status + ' ' + JSON.stringify(body))
    assert.equal(leaks(r, KEY), false, 'the key never comes back in a refusal')
    assert.equal(leaks(r), false)
  }
  ok('link: toolkit, key and label only, never a redirect_uri or a user id; the key is sent once and never echoed; every refusal is its word; an unsafe redirect is dropped')

  // an add is never retried by this side
  seen.length = 0
  answer = () => ({ status: 502, body: { error: 'upstream_unavailable', retry: 'check_first' } })
  await call(BASE + '/link', undefined, { toolkit: 'gmail' })
  assert.equal(seen.length, 1, 'a failed add is not sent twice: it may have gone through')
  ok('a link that fails is sent once: the page lists the connections before it offers another try')

  // delete
  reset()
  answer = () => ({ status: 200, body: { ok: true } })
  const del = await call(BASE + '/delete', undefined, { id: C1 })
  assert.deepEqual([del.ok, seen[0].method, seen[0].url, seen[0].auth], [true, 'DELETE', '/v1/connections/' + C1, 'Bearer ' + TOKEN])
  answer = () => ({ status: 204, body: null })
  assert.equal((await call(BASE + '/delete', undefined, { id: C1 })).ok, true)
  seen.length = 0
  for (const body of [{}, { id: 'x' }, { id: '../' + C1 }, null]) assert.deepEqual([(await call(BASE + '/delete', undefined, body)).ok, (await call(BASE + '/delete', undefined, body)).error], [false, 'not_found'])
  assert.equal(seen.length, 0)
  answer = () => ({ status: 404, body: { error: 'not_found' } })
  assert.equal((await call(BASE + '/delete', undefined, { id: C1 })).error, 'not_found')
  ok('delete: a UUID or nothing, someone else\'s connection is "not_found"')

  // the server is unreachable
  writeFileSync(SERVERS, JSON.stringify({ active: 'local', servers: [{ id: 'local', name: 'Local', api: 'http://127.0.0.1:1', services: { connections: 'http://127.0.0.1:1/v1/mcp/connections' } }] }))
  const down = await call(BASE)
  assert.deepEqual([down.ok, down.error], [false, 'network'])
  registry(MCP)
  ok('an unreachable server is "network", not a crash')

  // ── the tools ──
  const conn = mod.connections
  const defs = conn.toolDefs()
  assert.deepEqual(defs.map((d) => d.name), CONNECTION_TOOLS)
  for (const d of defs) {
    assert.equal(typeof d.description, 'string')
    assert.ok(d.description.length > 40 && d.description.length < 500, d.name + ' says what it is for, briefly')
    assert.equal(d.parameters.type, 'object')
    assert.equal(d.parameters.additionalProperties, false)
    assert.equal(typeof d.execute, 'function')
    assert.equal(typeof d.output.render, 'function')
    assert.equal(d.output.schema.type, 'object')
    assert.deepEqual(d.output.schema.required, ['ok'])
    assert.equal(/[éèàçôù]/.test(d.description), false, 'English, like all new code')
  }
  assert.deepEqual(defs[1].parameters.required, ['toolkit'])
  assert.deepEqual(defs[2].parameters.required, ['tool_slug'])
  ok('three tools, each with a description, a closed parameter schema, an output schema and a render')

  // the real engine accepts them (every engine installed here: where DSH is absent, or NO_DSH_ENGINE=1, this is said and not counted)
  const toolsPaths = []
  if (typeof process.env.DSH_TOOLS_PATH === 'string' && existsSync(process.env.DSH_TOOLS_PATH)) toolsPaths.push(process.env.DSH_TOOLS_PATH)
  const engines = join(process.env.HOME ?? '', '.dsh', 'kybernos', 'moteur')
  if (existsSync(engines)) for (const v of readdirSync(engines)) { const p = join(engines, v, 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js'); if (existsSync(p)) toolsPaths.push(p) }
  if (process.env.NO_DSH_ENGINE === '1' || toolsPaths.length === 0) console.log('  · no DSH engine on this machine (or NO_DSH_ENGINE=1): the schemas are not checked against its rules, and this is not counted')
  else {
    for (const path of toolsPaths) {
      const { assertSupportedJsonSchema } = await import(path)
      for (const d of defs) {
        assert.doesNotThrow(() => assertSupportedJsonSchema(d.parameters), d.name + ' parameters ' + path)
        assert.doesNotThrow(() => assertSupportedJsonSchema(d.output.schema), d.name + ' output ' + path)
      }
    }
    ok('the engine\'s own JSON-schema rules accept every parameter and output schema (' + String(toolsPaths.length) + ' engine(s) installed here)')
  }

  // the model-facing text
  assert.equal(defs[0].output.render({}, { ok: true, text: 'two apps' })[0].text, 'two apps')
  assert.equal(defs[0].output.render({}, { ok: true, text: '' })[0].text, '(nothing)')
  assert.match(defs[0].output.render({}, { ok: false, error: 'not_connected' })[0].text, /not connected/)
  assert.equal(defs[0].output.render({}, { ok: false, error: 'action_failed', text: '{"code":"action_failed","retryable":true}' })[0].text, '{"code":"action_failed","retryable":true}')
  assert.match(defs[0].output.render({}, { ok: false, error: 'something_new' })[0].text, /something_new/)
  ok('what the model reads: the result, "(nothing)", or a sentence it can act on; a tool\'s own failure keeps its text')

  // each tool posts one JSON-RPC message with the live token and nothing else
  const rpc = (name) => seen.filter((c) => c.url === '/v1/mcp/connections' && c.body !== null && c.body.params !== undefined && c.body.params.name === name)
  const okAnswer = (text) => () => ({ status: 200, body: { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text }] } } })
  reset()
  answer = okAnswer('[{"id":"' + C1 + '","toolkit":"gmail"}]')
  const l = await defs[0].execute({})
  assert.deepEqual(l, { ok: true, text: '[{"id":"' + C1 + '","toolkit":"gmail"}]' })
  assert.deepEqual([seen[0].method, seen[0].url, seen[0].auth], ['POST', '/v1/mcp/connections', 'Bearer ' + TOKEN])
  assert.deepEqual([seen[0].body.jsonrpc, seen[0].body.method, seen[0].body.params], ['2.0', 'tools/call', { name: 'connections_list', arguments: {} }])
  assert.equal(seen.filter((c) => c.body !== null && c.body.method === 'initialize').length, 0, 'stateless: no handshake first')
  assert.equal(leaks(l), false)
  seen.length = 0
  await defs[1].execute({ toolkit: ' GitHub ', query: '  open issues  ', limit: 500, extra: 'dropped' })
  assert.deepEqual(seen[0].body.params, { name: 'connections_search_tools', arguments: { toolkit: 'github', query: 'open issues', limit: 50 } })
  seen.length = 0
  await defs[1].execute({ toolkit: 'github' })
  assert.deepEqual(seen[0].body.params.arguments, { toolkit: 'github' })
  seen.length = 0
  await defs[2].execute({ tool_slug: 'GITHUB_CREATE_AN_ISSUE', params: { title: 'x', body: 'y' }, connection_id: C1, user_id: 'kyb_other', extra: 1 })
  assert.deepEqual(seen[0].body.params, { name: 'connections_execute', arguments: { tool_slug: 'GITHUB_CREATE_AN_ISSUE', params: { title: 'x', body: 'y' }, connection_id: C1 } })
  assert.equal(seen[0].raw.includes('kyb_'), false, 'the person is named by the token alone, never by an argument')
  seen.length = 0
  await defs[2].execute({ tool_slug: 'GMAIL_FETCH_EMAILS' })
  assert.deepEqual(seen[0].body.params.arguments, { tool_slug: 'GMAIL_FETCH_EMAILS', params: {} })
  const ids = []
  seen.length = 0
  await defs[0].execute({}); await defs[0].execute({})
  seen.forEach((c) => ids.push(c.body.id))
  assert.equal(new Set(ids).size, 2, 'each call has its own JSON-RPC id')
  ok('each tool posts one tools/call with the live token and no handshake, forwards only its own arguments, names the person by the token alone')

  // bad arguments cost no call
  seen.length = 0
  for (const [d, args] of [
    [defs[1], {}], [defs[1], { toolkit: '' }], [defs[1], { toolkit: '../x' }], [defs[1], { toolkit: 5 }],
    [defs[2], {}], [defs[2], { tool_slug: '' }], [defs[2], { tool_slug: 'a b' }], [defs[2], { tool_slug: 'X', params: [] }], [defs[2], { tool_slug: 'X', params: 'x' }], [defs[2], { tool_slug: 'X', params: null }],
    [defs[2], { tool_slug: 'X', connection_id: 'nope' }], [defs[2], { tool_slug: 'X', connection_id: '../' + C1 }],
  ]) assert.deepEqual(await d.execute(args), { ok: false, error: 'invalid_params' }, d.name + ' ' + JSON.stringify(args))
  assert.deepEqual(await defs[2].execute({ tool_slug: 'X', params: { blob: 'x'.repeat(300 * 1024) } }), { ok: false, error: 'params_too_large' })
  assert.equal(seen.length, 0)
  ok('arguments that cannot be right (a toolkit, an action slug, params that are no object, a connection id that is no UUID, params past 256 KiB) cost no call')

  // what the endpoint may answer
  reset()
  answer = () => ({ status: 200, body: { result: { isError: true, content: [{ type: 'text', text: '{"code":"connection_not_active","retryable":false}' }] } } })
  assert.deepEqual(await defs[2].execute({ tool_slug: 'X' }), { ok: false, error: 'connection_not_active', text: '{"code":"connection_not_active","retryable":false}' })
  answer = () => ({ status: 200, body: { error: { code: -32602, message: 'SECRET ' + KEY } } })
  assert.deepEqual(await defs[2].execute({ tool_slug: 'X' }), { ok: false, error: 'invalid_params' })
  answer = () => ({ status: 401, body: { error: 'unauthorized' } })
  assert.equal((await defs[0].execute({})).error, 'reconnect_required')
  answer = () => ({ status: 429, body: { error: 'busy' } })
  assert.equal((await defs[0].execute({})).error, 'too_many_requests')
  answer = () => ({ status: 200, body: 'not an object' })
  assert.equal((await defs[0].execute({})).error, 'invalid_response')
  ok('a tool\'s own failure keeps its code and text, a protocol error and a door refusal are one word, and the server\'s message never reaches the model')

  // the tools exist exactly while they can work
  const registered = new Map()
  let registerThrows = false
  const fakeTools = { register: (def) => { if (registerThrows) throw new Error('tool "' + def.name + '" is already registered'); registered.set(def.name, def); return () => registered.delete(def.name) } }
  const logs = []
  const { createConnections } = await import('./connections-host.mjs')
  const apiCallLike = async () => ({ status: 200, body: {} })
  const profileWith = (connections) => ({ id: 'local', api: ORIGIN, services: { llm: null, gateway: 'https://g.test', connections } })
  let state = null
  let profile = profileWith(MCP)
  const mk = () => createConnections({ apiCall: apiCallLike, readState: () => state, isConnected: (s) => s !== null && typeof s.token === 'string' && s.token !== '', server: () => ({ profile }), log: (m) => logs.push(m) })
  const tc = mk()
  tc.sync()
  assert.deepEqual([...registered.keys()], [], 'nothing before DSH has the tools service')
  tc.attach(fakeTools)
  assert.deepEqual([...registered.keys()], [], 'offered but not connected: no tools')
  state = { token: TOKEN }
  tc.sync()
  assert.deepEqual([...registered.keys()], CONNECTION_TOOLS)
  tc.sync(); tc.sync()
  assert.deepEqual([...registered.keys()], CONNECTION_TOOLS, 'syncing again never registers twice')
  state = null
  tc.sync()
  assert.deepEqual([...registered.keys()], [], 'disconnected: the tools go')
  state = { token: TOKEN }
  tc.sync()
  assert.equal(registered.size, 3, 'connected again: the tools come back')
  profile = profileWith(undefined)
  tc.sync()
  assert.equal(registered.size, 0, 'a server that does not offer connections: no tools')
  profile = profileWith(false)
  tc.sync()
  assert.equal(registered.size, 0)
  profile = profileWith(MCP)
  tc.sync()
  assert.equal(registered.size, 3)
  profile = { ...profileWith(MCP), api: 'http://127.0.0.1:2' }
  tc.sync()
  assert.equal(registered.size, 0, 'an endpoint that is not on the server\'s own origin is not offered: the token stays with its server')
  profile = profileWith(MCP)
  tc.sync()
  tc.detach()
  assert.equal(registered.size, 3, 'detaching forgets the scope without calling into a scope that is gone')
  registered.clear()
  const tc2 = mk()
  registerThrows = true
  tc2.attach(fakeTools)
  tc2.sync(); tc2.sync(); tc2.sync()
  assert.equal(registered.size, 0)
  assert.equal(logs.length, 3, 'a name that is already taken is logged once per tool, not every tick')
  registerThrows = false
  tc2.sync()
  assert.equal(registered.size, 3, 'and it registers as soon as the name is free')
  ok('the tools exist exactly while the server offers connections and the account is connected: they come and go with no restart, never twice, never a throw')

  // mounting: the real thing, with a fake ctx
  const mounted = { injected: null, effects: [] }
  const ctx = { inject: (deps, cb) => { mounted.injected = { deps, cb } }, effect: (fn, label) => { mounted.effects.push({ fn, label }) } }
  registered.clear()
  const tc3 = mk()
  tc3.mount(ctx)
  assert.deepEqual(mounted.injected.deps, ['tools'])
  assert.equal(mounted.effects.length, 1)
  mounted.injected.cb({ tools: fakeTools })
  assert.equal(registered.size, 3, 'when DSH hands over the tools service, they are registered at once')
  const realSetInterval = globalThis.setInterval
  let timer = null
  globalThis.setInterval = (...a) => { timer = realSetInterval(...a); return timer }
  const stop = mounted.effects[0].fn()
  globalThis.setInterval = realSetInterval
  assert.equal(typeof stop, 'function')
  assert.ok(timer !== null && timer.hasRef() === false, 'the timer does not keep the process alive')
  stop()
  assert.equal(registered.size, 0, 'when the plugin goes, so do its tools and its timer')
  ok('mounted on the plugin: registered when the tools service arrives, removed with the plugin, the timer never keeps the process alive')

  assert.equal(mod.server().profile.services.connections, MCP)
  ok('the active server\'s endpoint is what the routes and the tools use')

  console.log('\n' + pass + ' verifications OK')
} finally {
  api.close()
  rmSync(dir, { recursive: true, force: true })
}
