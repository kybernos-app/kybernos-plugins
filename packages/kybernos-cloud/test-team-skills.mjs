// Tests of the Team skills routes of the cloud host (/kybernos-cloud/team/skills*) and of their pure half (team-skills.mjs).
//   node packages/kybernos-cloud/test-team-skills.mjs
//
// The server side is docs/dev/team-skills-contract.md and no server implements it yet: a stand-in answers with the contract's
// codes. What matters here is what THIS side does: who may use the feature (the Team plan, a workspace), which call each route
// makes (path, method, body, the token only in the Authorization header), what it refuses before any call, and that every
// refusal of the server becomes one word the page can translate, with the server's own text never reaching the page.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { teamSkillsBase, isSkillId, teamSkillsFailure, asTeamSkill } from './team-skills.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

// ── the pure half ──
{
  assert.equal(teamSkillsBase('0b1c2d3e-aaaa-bbbb-cccc-1234567890ab'), '/v1/workspaces/0b1c2d3e-aaaa-bbbb-cccc-1234567890ab/skills')
  assert.equal(teamSkillsBase('a/b?c'), '/v1/workspaces/a%2Fb%3Fc/skills')
  for (const v of [1, '12', '999999999999999999']) assert.equal(isSkillId(v), true, String(v))
  for (const v of [0, -1, 1.5, '', '0', '007', '+5', ' 5', 'abc', '1; DROP', '1/2', '1000000000000000000', null, undefined, {}, [], '١٢']) assert.equal(isSkillId(v), false, String(v))
  ok('the base path encodes the workspace id, and a skill id is a positive integer and nothing else')

  const f = (status, body) => teamSkillsFailure(status, body)
  assert.equal(f(200, {}), null)
  assert.equal(f(201, {}), null)
  assert.deepEqual(f(401, { error: 'Unauthorized' }), { error: 'reconnect_required' })
  assert.deepEqual(f(0, null), { error: 'network' })
  assert.deepEqual(f(404, { error: 'Team skill not found' }), { error: 'skill_not_found' })
  assert.deepEqual(f(404, { error: 'Workspace not found' }), { error: 'workspace_not_found' })
  assert.deepEqual(f(404, { error: 'Not Found' }), { error: 'not_on_this_server' })
  assert.deepEqual(f(404, null), { error: 'not_on_this_server' })
  assert.deepEqual(f(403, { error: 'admin_required' }), { error: 'admin_required' })
  assert.deepEqual(f(403, { error: 'whatever the server says' }), { error: 'forbidden' })
  assert.deepEqual(f(409, { error: 'duplicate', id: 7, status: 'approved' }), { error: 'duplicate', id: 7, status: 'approved' })
  assert.deepEqual(f(409, { error: 'team_full', max: 100 }), { error: 'team_full', max: 100 })
  assert.deepEqual(f(409, { error: 'not_pending', status: 'approved' }), { error: 'not_pending' })
  assert.deepEqual(f(409, { error: 'not_approved' }), { error: 'not_approved' })
  assert.deepEqual(f(409, { error: 'something' }), { error: 'conflict' })
  assert.deepEqual(f(413, null), { error: 'too_large' })
  assert.deepEqual(f(429, { error: 'too_many_proposals', max: 5 }), { error: 'too_many_proposals', max: 5 })
  assert.deepEqual(f(400, { error: 'invalid_skill', reason: 'bad_path' }), { error: 'invalid_skill', reason: 'bad_path' })
  assert.deepEqual(f(400, { error: 'scan_rejected', file: 'scripts/x.sh' }), { error: 'scan_rejected', file: 'scripts/x.sh' })
  assert.deepEqual(f(400, { error: 'free text' }), { error: 'bad_request' })
  assert.deepEqual(f(500, { error: 'boom' }), { error: 'refused_500' })
  assert.equal(JSON.stringify([f(403, { error: 'SECRET server wording' }), f(500, { error: 'SECRET server wording' }), f(400, { error: 'SECRET server wording' })]).includes('SECRET'), false)
  ok('every refusal of the contract becomes one word; an unknown 404 means "not on this server"; the server\'s own text never passes')

  const list = asTeamSkill({ id: 12, name: 'release-notes', description: 'd', version: 'abc', status: 'approved', files: 4, bytes: 5120, proposed_by_name: 'Ana', proposed_at: 't1', reviewed_by_name: 'Sam', reviewed_at: 't2', note: 'n', review_note: null, replaces: null, superseded_by: null, mine: true })
  assert.deepEqual([list.id, list.fileCount, list.files, list.proposedName, list.reviewedName, list.mine, list.replaces], [12, 4, undefined, 'Ana', 'Sam', true, null])
  const one = asTeamSkill({ id: 12, name: 'release-notes', description: 'd', version: 'abc', status: 'approved', files_count: 2, files: [{ path: 'SKILL.md', content: 'x' }, { path: 'a.md', content: 'y' }, null] })
  assert.deepEqual([one.fileCount, one.files], [2, [{ path: 'SKILL.md', content: 'x' }, { path: 'a.md', content: 'y' }]])
  const bare = asTeamSkill({ id: 1, name: 'x', status: 'proposed', replaces: 9 })
  assert.deepEqual([bare.description, bare.version, bare.fileCount, bare.bytes, bare.proposedName, bare.replaces, bare.mine], ['', '', 0, 0, null, 9, false])
  ok('a list row and a single skill both map to the same shape; missing fields have a quiet default')
}

// ── the host, against a stand-in server ──
const W1 = '11111111-1111-4111-8111-111111111111'
const W2 = '22222222-2222-4222-8222-222222222222'
const TOKEN = 'kys-secret-token-0123456789'
const seen = []
let answer = () => ({ status: 200, body: {} })
const api = createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    let body = null
    try { body = raw === '' ? null : JSON.parse(raw) } catch (e) { body = '<<not json>>' }
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization || null, body })
    const a = answer(req, body)
    res.writeHead(a.status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(a.body))
  })
})
await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve))
const dir = mkdtempSync(join(tmpdir(), 'kb-teamskills-'))
process.env.KYBERNOS_CLOUD_API = 'http://127.0.0.1:' + api.address().port
process.env.KYBERNOS_CLOUD_STATE = join(dir, 'state.json')
process.env.KYBERNOS_CLOUD_KYBERS = join(dir, 'kybers')
const writeState = (state) => writeFileSync(process.env.KYBERNOS_CLOUD_STATE, JSON.stringify(state))
const team = { token: TOKEN, user: { id: 'u-me', name: 'Sara M.', email: 'sara@example.test', plan: 'team-solo' }, workspaces: [{ id: W1, name: 'Acme Studio' }, { id: W2, name: 'Perso' }], active_workspace_id: W1 }

try {
  const mod = await import('./index.js')
  const route = (path) => mod.ROUTES.find((r) => r.path === path)
  const LIST = '/kybernos-cloud/team/skills'
  const ITEM = LIST + '/item'
  const call = async (path, query, body) => route(path).run({ url: path + (query === undefined ? '' : '?' + query) }, body)
  const reset = () => { seen.length = 0; answer = () => ({ status: 200, body: {} }) }
  const leaks = (v) => JSON.stringify(v).includes(TOKEN)

  // route table
  const paths = [LIST, ITEM, LIST + '/add', LIST + '/review', LIST + '/retire', LIST + '/delete']
  for (const p of paths) {
    const r = route(p)
    assert.ok(r !== undefined, p)
    assert.equal(r.guarded, true, p + ' needs the same-origin guard')
  }
  assert.deepEqual(paths.map((p) => route(p).method), ['GET', 'GET', 'POST', 'POST', 'POST', 'POST'])
  assert.ok(route(LIST + '/add').cap >= 4 * 1024 * 1024, 'a proposal carries up to a megabyte of files')
  for (const p of [LIST + '/review', LIST + '/retire', LIST + '/delete']) assert.ok(route(p).cap <= 65536, p + ' takes a small body')
  assert.equal(new Set(mod.ROUTES.map((r) => r.path)).size, mod.ROUTES.length, 'no two routes share a path')
  ok('six routes, all behind the same-origin guard, a big body only for a proposal, no path shared')

  // who may use it
  rmSync(process.env.KYBERNOS_CLOUD_STATE, { force: true })
  reset()
  assert.deepEqual(await call(LIST), { ok: false, connected: false, error: 'non connecte' })
  assert.deepEqual(await call(LIST + '/add', undefined, { name: 'a', description: 'd', files: [{ path: 'SKILL.md', content: 'x' }] }), { ok: false, connected: false, error: 'non connecte' })
  writeState({ ...team, user: { id: 'u-me', plan: 'studio' } })
  assert.deepEqual(await call(LIST), { ok: false, error: 'offre_requise' })
  assert.equal((await call(LIST + '/add', undefined, { name: 'a', description: 'd', files: [{ path: 'SKILL.md', content: 'x' }] })).error, 'offre_requise')
  assert.equal((await call(LIST + '/review', undefined, { id: 1, decision: 'approve' })).error, 'offre_requise')
  writeState({ ...team, workspaces: [], active_workspace_id: null })
  assert.equal((await call(LIST)).error, 'aucun_espace')
  assert.equal(seen.length, 0, 'not connected, not on the Team plan, no workspace: not one call to the server')
  ok('not connected, not on the Team plan, no workspace: refused with a word, and nothing leaves the machine')

  // list
  writeState(team)
  answer = () => ({ status: 200, body: { workspace_id: W1, role: 'member', view: 'approved', total: 1, limit: 100, offset: 0, counts: { approved: 1, pending: 0 },
    skills: [{ id: 5, name: 'release-notes', description: 'Drafts', version: 'v1', status: 'approved', files: 4, bytes: 5120, proposed_by_name: 'Ana', mine: false }] } })
  const listed = await call(LIST)
  assert.equal(listed.ok, true, JSON.stringify(listed))
  assert.deepEqual([listed.role, listed.total, listed.counts, listed.workspaceName, listed.skills.length, listed.skills[0].name, listed.skills[0].fileCount], ['member', 1, { approved: 1, pending: 0 }, 'Acme Studio', 1, 'release-notes', 4])
  assert.deepEqual([seen[0].method, seen[0].url, seen[0].auth, seen[0].body], ['GET', '/v1/workspaces/' + W1 + '/skills?view=approved&limit=100&offset=0', 'Bearer ' + TOKEN, null])
  assert.equal(leaks(listed), false, 'the token never goes back to the page')
  seen.length = 0
  await call(LIST, 'view=all&limit=9999&offset=-5')
  await call(LIST, 'view=nonsense&limit=0')
  assert.deepEqual(seen.map((c) => c.url.split('?')[1]), ['view=all&limit=200&offset=0', 'view=approved&limit=1&offset=0'])
  ok('list: the workspace routes of the ACTIVE workspace, the token in the header only, view and paging clamped before the call')

  writeState({ ...team, active_workspace_id: W2 })
  seen.length = 0
  await call(LIST)
  assert.ok(seen[0].url.startsWith('/v1/workspaces/' + W2 + '/skills?'), 'switching workspace switches the catalogue')
  writeState(team)
  answer = () => ({ status: 200, body: { nope: true } })
  assert.equal((await call(LIST)).error, 'invalid_response')
  ok('list: another active workspace reads another catalogue; an answer without skills is "invalid_response"')

  // one skill, with its files
  reset()
  answer = () => ({ status: 200, body: { id: 5, name: 'release-notes', description: 'd', version: 'v1', status: 'approved', files_count: 1, files: [{ path: 'SKILL.md', content: 'hello' }] } })
  const item = await call(ITEM, 'id=5')
  assert.deepEqual([item.ok, item.skill.files, item.skill.fileCount], [true, [{ path: 'SKILL.md', content: 'hello' }], 1])
  assert.equal(seen[0].url, '/v1/workspaces/' + W1 + '/skills/5')
  seen.length = 0
  for (const id of ['abc', '', '1; DROP TABLE', '../5', '5/review', '0', undefined]) {
    const r = await call(ITEM, id === undefined ? undefined : 'id=' + encodeURIComponent(id))
    assert.deepEqual([r.ok, r.error], [false, 'skill_not_found'], String(id))
  }
  assert.equal(seen.length, 0, 'a bad id is refused before any call')
  answer = () => ({ status: 200, body: { id: 5, name: 'x' } })
  assert.equal((await call(ITEM, 'id=5')).error, 'invalid_response', 'a single skill without its files is not a skill')
  ok('one skill: fetched by a numeric id only (nothing else reaches the path), and it must come with its files')

  // propose
  reset()
  const files = [{ path: 'SKILL.md', content: '---\nname: incident-report\ndescription: "d"\n---\n' }]
  answer = () => ({ status: 201, body: { id: 9, name: 'incident-report', description: 'd', version: 'v9', status: 'proposed', files: 1, mine: true } })
  const added = await call(LIST + '/add', undefined, { name: 'incident-report', description: 'd', files, note: '  for the retro  ', ignored: 'x' })
  assert.deepEqual([added.ok, added.skill.id, added.skill.status, added.skill.mine], [true, 9, 'proposed', true])
  assert.deepEqual([seen[0].method, seen[0].url, seen[0].auth], ['POST', '/v1/workspaces/' + W1 + '/skills', 'Bearer ' + TOKEN])
  assert.deepEqual(seen[0].body, { name: 'incident-report', description: 'd', files, display_name: 'Sara M.', note: '  for the retro  ' })
  seen.length = 0
  await call(LIST + '/add', undefined, { name: 'incident-report', description: 'd', files, note: '   ' })
  assert.equal('note' in seen[0].body, false, 'a blank note is not sent')
  seen.length = 0
  for (const bad of [null, {}, { name: '', description: 'd', files }, { name: 'a', files }, { name: 'a', description: 'd' }, { name: 'a', description: 'd', files: [] }, { name: 'a', description: 'd', files: 'x' }, { name: 5, description: 'd', files }]) {
    assert.deepEqual([(await call(LIST + '/add', undefined, bad)).ok, (await call(LIST + '/add', undefined, bad)).error], [false, 'bad_request'], JSON.stringify(bad))
  }
  assert.equal(seen.length, 0)
  ok('propose: the name shown is the user\'s, what the page adds besides name, description, files and note is dropped, and a malformed body costs no call')

  // what the server may answer to a proposal
  const refusals = [
    [400, { error: 'invalid_skill', reason: 'bad_path' }, { error: 'invalid_skill', reason: 'bad_path' }],
    [400, { error: 'scan_rejected', file: 'scripts/deploy.sh' }, { error: 'scan_rejected', file: 'scripts/deploy.sh' }],
    [409, { error: 'duplicate', id: 3, status: 'proposed' }, { error: 'duplicate', id: 3, status: 'proposed' }],
    [409, { error: 'team_full', max: 100 }, { error: 'team_full', max: 100 }],
    [413, { error: 'too_large' }, { error: 'too_large' }],
    [429, { error: 'too_many_proposals', max: 5 }, { error: 'too_many_proposals', max: 5 }],
    [403, { error: 'Forbidden' }, { error: 'forbidden' }],
    [401, { error: 'Unauthorized' }, { error: 'reconnect_required' }],
    [404, { error: 'Workspace not found' }, { error: 'workspace_not_found' }],
    [404, { error: 'Not Found' }, { error: 'not_on_this_server' }],
    [500, { error: 'SECRET internals ' + TOKEN }, { error: 'refused_500' }]
  ]
  for (const [status, body, want] of refusals) {
    answer = () => ({ status, body })
    const r = await call(LIST + '/add', undefined, { name: 'a', description: 'd', files })
    assert.deepEqual({ ok: r.ok, ...r, ws: undefined }, { ok: false, ...want, ws: undefined }, status + ' ' + JSON.stringify(body))
    assert.equal(leaks(r), false)
  }
  ok('every answer of the server to a proposal reaches the page as its word, with the details it needs, and nothing else')

  // review, retire, delete
  reset()
  answer = (req) => ({ status: 200, body: { id: 9, name: 'incident-report', status: req.url.endsWith('/retire') ? 'retired' : 'approved' } })
  const rev = await call(LIST + '/review', undefined, { id: 9, decision: 'approve', note: ' nice ', text: 'ignored', files: ['ignored'] })
  assert.deepEqual([rev.ok, rev.skill.status], [true, 'approved'])
  assert.deepEqual([seen[0].method, seen[0].url, seen[0].body], ['POST', '/v1/workspaces/' + W1 + '/skills/9/review', { decision: 'approve', display_name: 'Sara M.', note: ' nice ' }])
  await call(LIST + '/review', undefined, { id: '9', decision: 'reject' })
  assert.deepEqual(seen[1].body, { decision: 'reject', display_name: 'Sara M.' })
  const ret = await call(LIST + '/retire', undefined, { id: 9 })
  assert.deepEqual([ret.ok, ret.skill.status, seen[2].url, seen[2].body], [true, 'retired', '/v1/workspaces/' + W1 + '/skills/9/retire', { display_name: 'Sara M.' }])
  answer = () => ({ status: 200, body: { ok: true } })
  const del = await call(LIST + '/delete', undefined, { id: 9 })
  assert.deepEqual([del, seen[3].method, seen[3].url], [{ ok: true }, 'DELETE', '/v1/workspaces/' + W1 + '/skills/9'])
  seen.length = 0
  for (const body of [{ decision: 'approve' }, { id: 'x', decision: 'approve' }, { id: 9, decision: 'maybe' }, { id: 9 }, null]) assert.equal((await call(LIST + '/review', undefined, body)).ok, false)
  for (const body of [{}, { id: 'x' }, null]) { assert.equal((await call(LIST + '/retire', undefined, body)).ok, false); assert.equal((await call(LIST + '/delete', undefined, body)).ok, false) }
  assert.equal(seen.length, 0)
  ok('review, retire and delete: a numeric id and a known decision or nothing is sent; the files of a skill can never be edited at review')

  answer = () => ({ status: 403, body: { error: 'admin_required' } })
  assert.equal((await call(LIST + '/review', undefined, { id: 9, decision: 'approve' })).error, 'admin_required')
  assert.equal((await call(LIST + '/retire', undefined, { id: 9 })).error, 'admin_required')
  answer = () => ({ status: 409, body: { error: 'not_pending', status: 'approved' } })
  assert.equal((await call(LIST + '/review', undefined, { id: 9, decision: 'approve' })).error, 'not_pending')
  answer = () => ({ status: 409, body: { error: 'not_approved' } })
  assert.equal((await call(LIST + '/retire', undefined, { id: 9 })).error, 'not_approved')
  answer = () => ({ status: 404, body: { error: 'Team skill not found' } })
  assert.equal((await call(LIST + '/delete', undefined, { id: 9 })).error, 'skill_not_found')
  ok('a member who tries to decide, a decision that came too late, a skill that is gone: each is its own word')

  // the server is unreachable
  const realApi = process.env.KYBERNOS_CLOUD_API
  process.env.KYBERNOS_CLOUD_API = 'http://127.0.0.1:1'
  const down = await call(LIST)
  assert.deepEqual([down.ok, down.error], [false, 'network'])
  process.env.KYBERNOS_CLOUD_API = realApi
  ok('an unreachable server is "network", not a crash')

  console.log('\n' + pass + ' verifications OK')
} finally {
  api.close()
  rmSync(dir, { recursive: true, force: true })
}
