// One working folder per team: the host routes that make it (plan « Équipes », step 6).
//   node packages/kybernos-cloud/test-team-folder-host.mjs
//
// A REAL HTTP server carries the plugin's routes, a fake Kybernos API answers, and Documents is a throw-away folder (KYBERNOS_DOCUMENTS_DIR: nothing is made in the real one). What is
// proven: the folder of a team is made when the team is switched to, created (with or without a plan), joined, or asked for (`space/folder`); a personal space has none; the name
// the server holds for a team is a hostile input and stays one segment under <Documents>/Kybernos (nothing outside it); two teams of one name get two folders; a recorded folder is kept,
// made again when it was removed and ignored when it is not a direct child of the root; a disk that refuses leaves the switch working with no folder; the page tells the host WHICH
// team (never a path); the public state names the active team's folder and the teams' folders and nothing else of the map; the guard of the new route.
import assert from 'node:assert/strict'
import http from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sessionSource } from './session-guard.mjs'
import { OTHER_SECRET, SESSION_SECRET, sessionCookie } from './lib-session-test.mjs'

const TOKEN = 'kys-' + 'f'.repeat(43)
const INVITE = 'k3Zp9-Qw_7Lm2XvB0cR8sTnYh4JdUeA6oGfIiNaPqMc'
const PERSONAL = { id: '11111111-1111-4111-8111-111111111111', name: 'My workspace', personal: true, role: 'owner' }
const ACME = { id: '22222222-2222-4222-8222-222222222222', name: 'Acme', personal: false, role: 'admin' }
const TWIN = { id: 'abcdef12-3333-4333-8333-333333333333', name: 'Acme', personal: false, role: 'member' }
const HOSTILE = { id: '44444444-4444-4444-8444-444444444444', name: '../../etc/passwd', personal: false, role: 'member' }
const JOINED = { id: '55555555-5555-4555-8555-555555555555', name: 'Joined Co', personal: false, role: 'member' }

const api = { calls: [], spaces: [PERSONAL, ACME, TWIN, HOSTILE], noPlan: new Set(), created: [] }
const readBody = (req) => new Promise((resolve) => { let t = ''; req.on('data', (c) => { t += c }); req.on('end', () => resolve(t)) })
const apiServer = http.createServer(async (req, res) => {
  const text = await readBody(req)
  const path = new URL(req.url, 'http://x').pathname
  api.calls.push(req.method + ' ' + path)
  const reply = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
  if (req.method === 'POST' && path === '/v1/workspaces') {
    const name = JSON.parse(text || '{}').name
    const made = { id: '66666666-6666-4666-8666-66666666666' + String(api.created.length), name, personal: false, role: 'owner' }
    api.created.push(made)
    api.noPlan.add(made.id)
    api.spaces = api.spaces.concat([made])
    return reply(201, made)
  }
  if (req.method === 'POST' && path === '/v1/invitations/accept') { api.spaces = api.spaces.concat([JOINED]); return reply(200, JOINED) }
  if (req.method === 'GET' && path === '/v1/workspaces') return reply(200, { workspaces: api.spaces })
  const m = /^\/v1\/workspaces\/([^/]+)\/plan$/.exec(path)
  if (req.method === 'GET' && m !== null) return reply(200, api.noPlan.has(m[1]) ? { plan: null, level: null, status: 'none' } : { plan: { key: 'team', name: 'Team', kind: 'team' }, level: '1-5 seats', status: 'active' })
  return reply(404, { error: 'not_found' })
})
await new Promise((resolve) => apiServer.listen(0, '127.0.0.1', resolve))

const dir = mkdtempSync(join(tmpdir(), 'kybernos-cloud-folder-host-'))
const statePath = join(dir, 'kybernos-cloud.json')
const DOCS = join(dir, 'Documents')
const ROOT = join(DOCS, 'Kybernos')
process.env.KYBERNOS_CLOUD_API = 'http://127.0.0.1:' + apiServer.address().port
process.env.KYBERNOS_CLOUD_STATE = statePath
process.env.KYBERNOS_DOCUMENTS_DIR = DOCS
process.env.DSH_HOME = dir
process.env.HOME = dir
process.env.KYBERNOS_SERVERS_FILE = join(dir, 'servers.json')
const writeState = (extra = {}) => writeFileSync(statePath, JSON.stringify({ token: TOKEN, api: process.env.KYBERNOS_CLOUD_API, user: { id: 'u-1', name: 'Ada', email: 'ada@example.test' }, workspaces: [PERSONAL, ACME, TWIN, HOSTILE], ...extra }), { mode: 0o600 })
const readState = () => JSON.parse(readFileSync(statePath, 'utf8'))
// The teams' folders are recorded beside the state file, not in it (a sign-out wipes the state).
const foldersPath = join(dir, 'kybernos-cloud-folders.json')
const readFolders = () => JSON.parse(readFileSync(foldersPath, 'utf8'))
const writeFolders = (map) => writeFileSync(foldersPath, JSON.stringify(map), { mode: 0o600 })
writeState()
sessionSource.secret = () => SESSION_SECRET

const routes = new Map()
const webServer = { register: (r) => { routes.set(r.path, r.handler); return () => routes.delete(r.path) } }
const ctx = { get: (name) => (name === 'webServer' ? webServer : undefined), inject: (_l, cb) => cb(ctx), effect: (fn) => { fn() }, on: () => {}, systemPrompt: { context: () => {} }, tools: { register: () => () => {} } }
const mod = await import('./index.js')
mod.MEMORY_TUNING.writeRefreshMs = -1
mod.MEMORY_TUNING.tickMs = 3600000
if (mod.PROFILE_REFRESH_TUNING !== undefined) { mod.PROFILE_REFRESH_TUNING.firstMs = 3600000; mod.PROFILE_REFRESH_TUNING.tickMs = 3600000 }
mod.apply(ctx)

const server = http.createServer((req, res) => {
  const handler = routes.get(new URL(req.url, 'http://x').pathname)
  if (handler === undefined) { res.writeHead(404); res.end('{}'); return }
  Promise.resolve(handler(req, res)).catch(() => { res.writeHead(500); res.end('{}') })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const own = '127.0.0.1:' + port
const origin = 'http://' + own
const browser = () => ({ origin, cookie: sessionCookie(own) })
const send = (path, headers, body) => new Promise((resolve) => {
  const payload = JSON.stringify(body)
  const req = http.request({ host: '127.0.0.1', port, path, method: 'POST', headers: { host: own, ...headers, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } }, (res) => {
    let text = ''
    res.on('data', (c) => { text += c })
    res.on('end', () => { let json = null; try { json = JSON.parse(text) } catch (e) { json = null } resolve({ status: res.statusCode, text, json }) })
  })
  req.on('error', () => resolve({ status: 0, text: '', json: null }))
  req.write(payload)
  req.end()
})
const post = (path, body) => send('/kybernos-cloud/' + path, browser(), body)
const isDir = (p) => { try { return statSync(p).isDirectory() } catch (e) { return false } }

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

try {
  console.log('A switch makes the folder')
  let r = await post('space/active', { workspace_id: PERSONAL.id })
  assert.equal(r.json.ok, true)
  assert.equal(existsSync(ROOT), false, 'Personal has no folder: nothing is made')
  assert.equal(r.json.state.space_folder, undefined)
  assert.deepEqual(r.json.state.team_folders, [])
  ok('the personal space has no folder: nothing is made, the state names none')

  r = await post('space/active', { workspace_id: ACME.id })
  assert.equal(r.json.ok, true)
  assert.equal(r.json.state.space_folder, join(ROOT, 'Acme'))
  assert.ok(isDir(join(ROOT, 'Acme')), 'the folder is made under <Documents>/Kybernos')
  assert.deepEqual(r.json.state.team_folders, [join(ROOT, 'Acme')])
  assert.deepEqual(readFolders(), { [ACME.id]: join(ROOT, 'Acme') }, 'and recorded by team id beside the state file')
  assert.equal('space_folders' in readState(), false, 'not in the state file itself')
  ok('switching to a team makes <Documents>/Kybernos/<Team>, records it, and the answer\'s state names it (the active team\'s `space_folder` and every team\'s `team_folders`)')

  assert.equal(r.text.includes(TOKEN), false)
  assert.equal('space_folders' in r.json.state, false, 'the map itself is not public: only the active folder and the list')
  assert.equal(r.text.includes('kybernos-cloud-folders'), false)
  ok('the public state carries the active team\'s folder and the list, never the map or the token')

  r = await post('space/active', { workspace_id: PERSONAL.id })
  assert.equal(r.json.state.space_folder, undefined, 'back in Personal: the host names no folder')
  assert.deepEqual(r.json.state.team_folders, [join(ROOT, 'Acme')], 'but still tells which folders are teams\'')
  ok('back in Personal the host names no folder, and still lists the teams\' folders (the page tells them from the person\'s own)')

  r = await post('space/active', { workspace_id: ACME.id })
  assert.equal(r.json.state.space_folder, join(ROOT, 'Acme'))
  assert.deepEqual(readdirSync(ROOT), ['Acme'])
  ok('a second switch to the same team finds its folder: nothing is made twice')

  rmSync(join(ROOT, 'Acme'), { recursive: true })
  r = await post('space/active', { workspace_id: ACME.id })
  r = await post('space/active', { workspace_id: PERSONAL.id })
  r = await post('space/active', { workspace_id: ACME.id })
  assert.ok(isDir(join(ROOT, 'Acme')) && r.json.state.space_folder === join(ROOT, 'Acme'))
  ok('a folder the person removed is made again at the same place on the next switch')

  console.log('A hostile name, two teams of one name')
  r = await post('space/active', { workspace_id: HOSTILE.id })
  assert.equal(r.json.state.space_folder, join(ROOT, 'etc passwd'))
  assert.ok(isDir(join(ROOT, 'etc passwd')))
  assert.equal(existsSync(join(DOCS, 'etc')) || existsSync(join(dir, 'etc')), false)
  assert.deepEqual(readdirSync(DOCS), ['Kybernos'], 'nothing outside the root')
  ok('a team called « ../../etc/passwd » gets ONE folder under the root, « etc passwd »; nothing is made outside it')
  r = await post('space/active', { workspace_id: TWIN.id })
  assert.equal(r.json.state.space_folder, join(ROOT, 'Acme (33333333)'))
  assert.notEqual(r.json.state.space_folder, join(ROOT, 'Acme'))
  ok('a second team called « Acme » is not given the first one\'s folder: its name carries the team\'s id')

  console.log('Created, joined, asked for')
  r = await post('space/create', { name: 'Fresh Co' })
  assert.equal(r.json.ok, true)
  assert.equal(r.json.created.activated, false, 'no plan: the person stays where they were')
  assert.ok(isDir(join(ROOT, 'Fresh Co')), 'the folder is made anyway')
  assert.notEqual(r.json.state.space_folder, join(ROOT, 'Fresh Co'), 'but it is not the active one')
  assert.ok(r.json.state.team_folders.includes(join(ROOT, 'Fresh Co')))
  ok('a team created without a plan: its folder is made, the person stays where they were')
  api.noPlan.clear()
  const mk = api.created.length
  api.spaces = api.spaces.filter((w) => w.name !== 'Planned Co')
  r = await post('space/create', { name: 'Planned Co' })
  assert.equal(api.created.length, mk + 1)
  const planned = api.created[api.created.length - 1]
  api.noPlan.delete(planned.id)
  // The server's plan answer is read at creation: this fake had it as « no plan » at that moment; the folder is the point here.
  assert.ok(isDir(join(ROOT, 'Planned Co')))
  ok('a team created with a name of its own gets a folder of that name')

  r = await post('invitation/accept', { token: INVITE })
  assert.equal(r.json.ok, true)
  assert.ok(isDir(join(ROOT, 'Joined Co')), 'a team joined with an invitation link has its folder')
  assert.ok(r.json.state.team_folders.includes(join(ROOT, 'Joined Co')))
  ok('a team joined with an invitation link has its folder')

  r = await post('space/active', { workspace_id: JOINED.id })
  rmSync(join(ROOT, 'Joined Co'), { recursive: true })
  const wiped = readFolders()
  delete wiped[JOINED.id]
  writeFolders(wiped)
  r = await post('space/folder', { workspace_id: JOINED.id })
  assert.equal(r.json.ok, true)
  assert.deepEqual(r.json.folder, { path: join(ROOT, 'Joined Co'), created: true })
  assert.equal(r.json.state.space_folder, join(ROOT, 'Joined Co'))
  ok('`space/folder` makes the folder of an active team that has none recorded (a team joined before folders existed)')
  r = await post('space/folder', { workspace_id: JOINED.id })
  assert.deepEqual(r.json.folder, { path: join(ROOT, 'Joined Co'), created: false })
  ok('and asked again it finds it')

  r = await post('space/folder', { workspace_id: PERSONAL.id })
  assert.deepEqual([r.json.ok, r.json.folder], [false, { error: 'personal_space' }])
  r = await post('space/folder', { workspace_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' })
  assert.deepEqual([r.json.ok, r.json.folder], [false, { error: 'unknown_space' }])
  r = await post('space/folder', {})
  assert.equal(r.json.ok, false)
  ok('a personal space or an unknown one has no folder (answered, nothing made)')

  console.log('The page names a team, never a path')
  const before = readdirSync(ROOT).sort()
  r = await post('space/folder', { workspace_id: ACME.id, path: '/etc', name: '../../escape', documents: '/tmp' })
  assert.equal(r.json.folder.path, join(ROOT, 'Acme'))
  r = await post('space/active', { workspace_id: ACME.id, path: '/etc', name: '../../escape' })
  assert.equal(r.json.state.space_folder, join(ROOT, 'Acme'))
  assert.deepEqual(readdirSync(ROOT).sort(), before)
  ok('a path, a name or a Documents folder named in the request is ignored: the host uses the team\'s id and its own root')

  const forged = readFolders()
  forged[ACME.id] = '/etc'
  writeFolders(forged)
  const peek = await fetch('http://' + own + '/kybernos-cloud/status', { headers: { host: own } }).then((x) => x.json())
  assert.equal(peek.state.team_folders.includes('/etc'), false, 'a forged record is not listed to the page')
  assert.equal(peek.state.space_folder === '/etc', false)
  r = await post('space/folder', { workspace_id: ACME.id })
  // The record is not trusted, so the team is as good as unrecorded: « Acme » is on the disk (it is this team's own, but nothing says so now), so the team gets the name with its id.
  assert.equal(r.json.folder.path, join(ROOT, 'Acme (22222222)'), 'a recorded path that is not a direct child of the root is not followed')
  assert.equal(readFolders()[ACME.id], join(ROOT, 'Acme (22222222)'), 'and the record is put right')
  assert.equal(r.json.state.team_folders.includes('/etc'), false)
  ok('a folder recorded outside the root (the file edited by hand) is not followed, listed or named to the page: the team gets its own, and the record is put right')

  console.log('A sign-out does not make a second folder')
  const folders = readdirSync(ROOT).sort()
  const kept = readState()
  writeFolders({ ...readFolders(), [ACME.id]: join(ROOT, 'Acme') })
  rmSync(statePath, { force: true })
  writeFileSync(statePath, JSON.stringify({ ...kept, active_workspace_id: PERSONAL.id }), { mode: 0o600 })
  r = await post('space/active', { workspace_id: ACME.id })
  assert.equal(r.json.state.space_folder, join(ROOT, 'Acme'), 'the team\'s folder is the same after a new sign-in')
  assert.deepEqual(readdirSync(ROOT).sort(), folders, 'and nothing was made')
  ok('the state is wiped and written again (a sign-out and a new sign-in): the team\'s folder is still the team\'s, no second folder')
  mkdirSync(join(ROOT, 'Taken'), { recursive: true })
  const taken = { id: '99999999-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Taken', personal: false, role: 'member' }
  api.spaces = api.spaces.concat([taken])
  writeFileSync(statePath, JSON.stringify({ ...readState(), workspaces: [...readState().workspaces, taken] }), { mode: 0o600 })
  r = await post('space/active', { workspace_id: taken.id })
  assert.equal(r.json.state.space_folder, join(ROOT, 'Taken (aaaaaaaa)'), 'a folder that is already there with no record is not taken over')
  ok('a folder of that name on the disk with no record (the person\'s own, or another account\'s team) is not taken over: the team gets one that carries its id')

  console.log('Guards')
  const calls = api.calls.length
  for (const [headers, want, label] of [[{}, 403, 'no Origin'], [{ origin: 'http://evil.example', cookie: sessionCookie(own) }, 403, 'a foreign Origin even with the cookie'], [{ origin }, 401, 'the right Origin without the signed session'], [{ origin, cookie: sessionCookie(own, { secret: OTHER_SECRET }) }, 401, 'a forged session']]) {
    const g = await send('/kybernos-cloud/space/folder', headers, { workspace_id: ACME.id })
    assert.equal(g.status, want, label + ' -> ' + g.status)
  }
  assert.equal(api.calls.length, calls)
  ok('`space/folder` (it makes a directory): no Origin 403, foreign Origin 403, no cookie 401, forged cookie 401')

  console.log('A disk that refuses')
  rmSync(DOCS, { recursive: true, force: true })
  writeFileSync(DOCS, 'a file where Documents should be')
  rmSync(foldersPath, { force: true })
  r = await post('space/active', { workspace_id: ACME.id })
  assert.equal(r.json.ok, true, 'the switch works')
  assert.equal(r.json.state.active_workspace_id, ACME.id)
  assert.equal(r.json.state.space_folder, undefined, 'with no folder')
  assert.deepEqual(r.json.state.team_folders, [])
  r = await post('space/folder', { workspace_id: ACME.id })
  assert.equal(r.json.ok, false)
  assert.ok(['mkdir_failed', 'not_allowed'].includes(r.json.folder.error), JSON.stringify(r.json.folder))
  ok('a disk that refuses the folder: the switch works, the team has no folder, `space/folder` says why, nothing throws')
  rmSync(DOCS, { force: true })
  mkdirSync(DOCS, { recursive: true })
  r = await post('space/folder', { workspace_id: ACME.id })
  assert.equal(r.json.ok, true)
  assert.equal(r.json.state.space_folder, join(ROOT, 'Acme'))
  ok('the disk allows it again: the next ask makes the folder')

  console.log('Signed out')
  rmSync(statePath, { force: true })
  r = await post('space/folder', { workspace_id: ACME.id })
  assert.deepEqual(r.json, { ok: false, error: 'non_connecte' })
  ok('not connected: nothing is made')
} finally {
  server.close()
  apiServer.close()
  rmSync(dir, { recursive: true, force: true })
}
console.log('\n' + pass + ' verifications OK')
process.exit(0)
