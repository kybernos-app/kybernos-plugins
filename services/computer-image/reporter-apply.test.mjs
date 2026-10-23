// What the reporter does with the definitions the person's laptop published: fetch them from the platform, hand each to the plugin's apply door on the
// loopback, tell the platform how it went. A stand-in platform and a stand-in DSH on the loopback; nothing leaves the machine.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, statSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const listen = (handler) => new Promise((resolve) => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => resolve(s)) })
const readBody = (req) => new Promise((resolve) => { const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8'))) } catch (e) { resolve(null) } }) })

const home = mkdtempSync(join(tmpdir(), 'kb-reporter-apply-'))
const platform = { ops: [], acks: [], status: 200, auth: [] }
const dsh = { calls: [], seen: [] }
const platformServer = await listen(async (req, res) => {
  platform.auth.push(req.headers.authorization)
  const send = (status, json) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(json)) }
  if (req.method === 'GET' && req.url === '/v1/computer/tasks/pending') return send(platform.status, { ops: platform.ops })
  const m = /^\/v1\/computer\/tasks\/([^/]+)\/ack$/.exec(req.url)
  if (req.method === 'POST' && m !== null) { platform.acks.push({ id: decodeURIComponent(m[1]), body: await readBody(req) }); return send(200, { op_id: decodeURIComponent(m[1]), state: 'applied' }) }
  send(404, { error: 'not_found' })
})
const dshServer = await listen(async (req, res) => {
  const body = await readBody(req)
  dsh.seen.push({ url: req.url, method: req.method, origin: req.headers.origin, token: req.headers['x-kybernos-apply-token'], body })
  const ref = body && body.ref
  const answer = ref === 'bad-ref' ? { ok: false, code: 'approval_path_missing' } : ref === 'weird-ref' ? { ok: false, code: 'Not A Code!' } : ref === 'html-ref' ? null : { ok: true, state: 'applied' }
  if (answer === null) { res.writeHead(200); return res.end('<html>not json</html>') }
  res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(answer))
})
process.env.DSH_HOME = home
process.env.KYBERNOS_API = 'http://127.0.0.1:' + platformServer.address().port
process.env.KYBERNOS_COMPUTER_TOKEN = 'kyd_test'
process.env.DSH_PORT = String(dshServer.address().port)
const { ensureApplyToken, applyBodyOf, ackOf, applyPending } = await import('./reporter.mjs')
const UUID = (n) => '3f2a1c10-0000-4000-8000-0000000000' + String(n).padStart(2, '0')
const body = (o) => ({ name: 'Collecteur', prompt: 'Collect', schedule: { mode: 'cron', cron: '0 3 * * *', tz: 'Europe/Paris' }, active: true, approvals: 'auto', ...(o || {}) })

test('the apply token is 32 random bytes in a private file, and stays the same', () => {
  const token = ensureApplyToken()
  assert.match(token, /^[0-9a-f]{64}$/u)
  assert.equal((statSync(join(home, 'kybernos', 'apply-token')).mode & 0o777).toString(8), '600')
  assert.equal(readFileSync(join(home, 'kybernos', 'apply-token'), 'utf8').trim(), token)
  assert.equal(ensureApplyToken(), token)
})

test('an op of the platform becomes the plugin\'s apply call; what cannot be read is not guessed at', () => {
  assert.deepEqual(applyBodyOf({ op_id: UUID(1), op: 'put', task_ref: 'task-a', body: body() }), { op: 'put', ref: 'task-a', task: body() })
  assert.deepEqual(applyBodyOf({ op_id: UUID(2), op: 'delete', task_ref: 'task-a', body: null }), { op: 'delete', ref: 'task-a' })
  for (const bad of [null, undefined, 'x', {}, { op: 'run', task_ref: 'a' }, { op: 'put', task_ref: 'bad ref', body: body() }, { op: 'put', task_ref: 'a', body: null }, { op: 'put', task_ref: 'a', body: [1] }, { op: 'put', task_ref: 'a' }]) assert.equal(applyBodyOf(bad), null, JSON.stringify(bad))
})

test('what is told to the platform: applied, or an error with a code it accepts', () => {
  assert.deepEqual(ackOf({ ok: true, state: 'applied' }), { status: 'applied' })
  assert.deepEqual(ackOf({ ok: false, code: 'approval_path_missing' }), { status: 'error', code: 'approval_path_missing' })
  for (const odd of [null, undefined, 'x', {}, { ok: false }, { ok: false, code: 'Not A Code!' }, { ok: false, code: 'x'.repeat(80) }, { ok: 'true' }]) assert.deepEqual(ackOf(odd), { status: 'error', code: 'apply_failed' }, JSON.stringify(odd))
})

test('the reporter fetches what waits, applies each op on the loopback with the token, and acknowledges each one', async () => {
  platform.ops = [
    { op_id: UUID(1), op: 'put', task_ref: 'task-a', body: body() },
    { op_id: UUID(2), op: 'put', task_ref: 'bad-ref', body: body() },
    { op_id: UUID(3), op: 'delete', task_ref: 'task-gone', body: null },
    { op_id: UUID(4), op: 'run', task_ref: 'task-x', body: null },
    { op_id: 'not-a-uuid', op: 'put', task_ref: 'task-y', body: body() },
    { op_id: UUID(5), op: 'put', task_ref: 'weird-ref', body: body() },
    { op_id: UUID(6), op: 'put', task_ref: 'html-ref', body: body() }
  ]
  const answered = await applyPending()
  assert.equal(answered, 6, 'six acknowledged; the op with no id is not one')
  assert.deepEqual(platform.acks.map((a) => [a.id, a.body]), [
    [UUID(1), { status: 'applied' }],
    [UUID(2), { status: 'error', code: 'approval_path_missing' }],
    [UUID(3), { status: 'applied' }],
    [UUID(4), { status: 'error', code: 'invalid_op' }],
    [UUID(5), { status: 'error', code: 'apply_failed' }],
    [UUID(6), { status: 'error', code: 'apply_failed' }]
  ])
  assert.equal(dsh.seen.length, 5, 'the op the reporter cannot read is not sent to the plugin')
  const token = readFileSync(join(home, 'kybernos', 'apply-token'), 'utf8').trim()
  for (const c of dsh.seen) {
    assert.equal(c.url, '/kybernos/tasks/apply'); assert.equal(c.method, 'POST')
    assert.equal(c.origin, 'http://127.0.0.1:' + dshServer.address().port, 'the loopback Origin the plugin\'s same-origin rule wants')
    assert.equal(c.token, token)
  }
  assert.deepEqual(dsh.seen[0].body, { op: 'put', ref: 'task-a', task: body() })
  assert.deepEqual(dsh.seen[2].body, { op: 'delete', ref: 'task-gone' })
  assert.ok(platform.auth.every((a) => a === 'Bearer kyd_test'))
})

test('a platform with nothing to say, or an error, applies nothing', async () => {
  const before = dsh.seen.length
  platform.ops = []
  assert.equal(await applyPending(), 0)
  platform.status = 503
  platform.ops = [{ op_id: UUID(9), op: 'put', task_ref: 'task-a', body: body() }]
  assert.equal(await applyPending(), 0)
  platform.status = 200
  assert.equal(dsh.seen.length, before)
})

test('when DSH does not answer nothing is acknowledged, so the platform offers it again', async () => {
  platform.acks.length = 0
  platform.ops = [{ op_id: UUID(10), op: 'put', task_ref: 'task-a', body: body() }, { op_id: UUID(11), op: 'put', task_ref: 'task-b', body: body() }]
  await new Promise((r) => dshServer.close(r))
  assert.equal(await applyPending(), 0)
  assert.deepEqual(platform.acks, [])
  platformServer.close()
})
