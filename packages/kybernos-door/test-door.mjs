// The local door, end to end and piece by piece, with no DSH: the JSON-RPC core, the HTTP fence, the token, the task store, the answer reader, the two tools, and the whole door driven through a real
// HTTP listener with a fake engine behind it.
import { mkdtempSync, writeFileSync, statSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, request as httpRequest } from 'node:http'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Hermetic: nothing here may touch the real ~/.dsh.
const TMP = mkdtempSync(join(tmpdir(), 'kb-door-'))
process.env.DSH_HOME = join(TMP, 'dsh')

const { createMcp } = await import('./mcp.mjs')
const { createHandler, hostOk, bearerOk } = await import('./door-http.mjs')
const { createToken } = await import('./token.mjs')
const { createTasks, MAX_TASKS, KEEP_MS } = await import('./tasks.mjs')
const { answerOf } = await import('./answer.mjs')
const { createTools, WAIT_MAX } = await import('./tools.mjs')
const door = await import('./index.js')

let failed = 0
const ok = (name, cond, detail = '') => { if (cond) console.log('  ok  ' + name); else { failed += 1; console.log('  FAIL ' + name + (detail === '' ? '' : ' — ' + detail)) } }
const has = (v, re) => typeof v === 'string' && re.test(v)

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────────
const msg = (text, extra = []) => ({ type: 'assistant/message', data: { message: { content: [...extra, { type: 'text', text }] } } })
const toolUse = { type: 'assistant/message', data: { message: { content: [{ type: 'tool_use', name: 'x' }] } } }
const toolEv = { type: 'tool/result', data: {} }

console.log('answer reader')
ok('the last message with words is the answer', answerOf([msg('one'), toolEv, msg('two')]).text === 'two')
ok('messages with no tool between them make ONE answer', answerOf([msg('done'), msg('the writer has finished')]).text === 'done\n\nthe writer has finished')
ok('a message that only calls a tool has no words', answerOf([msg('before'), toolUse]).text === 'before')
ok('tools are counted', answerOf([toolEv, toolEv, msg('x')]).tools === 2)
ok('a model that could not be reached is a code, never a message', answerOf([{ type: 'llm/retry', data: { failure: { code: 'RATE_LIMIT', message: 'secret words' } } }]).failure === 'model_429')
ok('an unknown model failure is model_error', answerOf([{ type: 'llm/retry', data: { failure: { code: 'WEIRD' } } }]).failure === 'model_error')
ok('an error event is a code', has(answerOf([{ type: 'session/error', data: { code: 'BOOM' } }]).failure, /^session_error\.boom$/))
ok('words win over an earlier failure', answerOf([{ type: 'session/error', data: {} }, msg('fine')]).failure === '')
ok('garbage events are skipped', answerOf([null, 3, 'x', undefined, {}]).text === '' && answerOf(undefined).text === '')
ok('the answer is capped', answerOf([msg('x'.repeat(50000))]).text.length === 20000)

console.log('token')
{
  const file = join(TMP, 'token-a', 'door', 'token')
  const t = createToken({ file: () => file })
  ok('no token before it is made', t.current() === '')
  const made = t.ensure()
  ok('the token has the expected shape', /^kbd_[0-9a-f]{48}$/.test(made))
  ok('the file is readable by the owner alone', (statSync(file).mode & 0o777) === 0o600, (statSync(file).mode & 0o777).toString(8))
  ok('ensure keeps the token that is there', t.ensure() === made && t.current() === made)
  const next = t.rotate()
  ok('rotate makes a different token and the old one is gone', next !== made && t.current() === next)
  writeFileSync(file, 'not a token\n')
  ok('a malformed file is no token (the door is off)', t.current() === '')
  const bad = createToken({ file: () => '/dev/null/nope/token' })
  let threw = false
  try { bad.ensure() } catch (e) { threw = true }
  ok('ensure throws when the profile cannot be written (the caller decides)', threw)
}

console.log('task store')
{
  const file = join(TMP, 'tasks-a', 'tasks.json')
  let clock = 1000
  let n = 0
  const ids = () => '00000000-0000-4000-8000-' + String(++n).padStart(12, '0')
  const store = createTasks({ file: () => file, now: () => clock, newId: ids })
  const a = store.start({ session: 'sess_1', key: 'key-1' })
  ok('a task is recorded with its session', a !== null && a.session === 'sess_1' && a.key === 'key-1')
  ok('it can be read back by id and by key', store.get(a.id).session === 'sess_1' && store.byKey('key-1').id === a.id)
  ok('the file is readable by the owner alone', (statSync(file).mode & 0o777) === 0o600)
  ok('a bad id or key finds nothing', store.get('nope') === null && store.byKey('bad key!') === null && store.get(undefined) === null)
  ok('a bad session is refused', store.start({ session: '../x' }) === null)
  const b = store.start({ session: 'sess_2' })
  ok('the most recent comes first', store.recent(5)[0].id === b.id && store.recent(1).length === 1)
  clock += KEEP_MS + 1
  ok('a task older than seven days is forgotten', store.get(a.id) === null)
  clock = 1000
  for (let i = 0; i < MAX_TASKS + 5; i += 1) store.start({ session: 's' + i })
  ok('the file is bounded', store.recent(1000).length === MAX_TASKS)
  const dead = createTasks({ file: () => '/dev/null/x/tasks.json' })
  ok('a file that cannot be written means the task is not recorded', dead.start({ session: 's' }) === null)
  writeFileSync(file, '{broken')
  ok('a broken file is no memory, not a crash', store.get(a.id) === null && store.recent(5).length === 0)
}

console.log('the JSON-RPC core')
const echoTools = [{ name: 'echo', title: 'Echo', description: 'd', inputSchema: { type: 'object' }, parse: (a) => (typeof a.v === 'string' ? { ok: true, value: a.v } : { ok: false, error: 'v must be a string' }), run: async (v) => ({ data: { v } }) },
  { name: 'boom', title: 'Boom', description: 'd', inputSchema: { type: 'object' }, parse: () => ({ ok: true, value: 1 }), run: async () => { throw new Error('/Users/someone/secret stack') } }]
{
  const mcp = createMcp({ info: { name: 'x', version: '1' }, instructions: 'hello', tools: echoTools })
  const init = await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } })
  ok('initialize echoes a protocol it knows', init.result.protocolVersion === '2025-03-26' && init.result.serverInfo.name === 'x' && init.result.instructions === 'hello')
  ok('initialize offers its newest protocol to an unknown one', (await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } })).result.protocolVersion === '2025-06-18')
  ok('a notification gets no answer', (await mcp.handle({ jsonrpc: '2.0', method: 'notifications/initialized' })) === null)
  ok('a reply of the client gets no answer', (await mcp.handle({ jsonrpc: '2.0', id: 4, result: {} })) === null)
  ok('ping answers an empty result', JSON.stringify((await mcp.handle({ jsonrpc: '2.0', id: 2, method: 'ping' })).result) === '{}')
  const list = await mcp.handle({ jsonrpc: '2.0', id: 3, method: 'tools/list' })
  ok('tools/list shows names and schemas, never the code', list.result.tools.length === 2 && list.result.tools[0].inputSchema.type === 'object' && list.result.tools[0].run === undefined && list.result.tools[0].parse === undefined)
  ok('an unknown method is -32601', (await mcp.handle({ jsonrpc: '2.0', id: 5, method: 'resources/list' })).error.code === -32601)
  ok('a message that is not JSON-RPC 2.0 is -32600', (await mcp.handle({ id: 1, method: 'ping' })).error.code === -32600 && (await mcp.handle([])).error.code === -32600 && (await mcp.handle(null)).error.code === -32600)
  const call = await mcp.handle({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'echo', arguments: { v: 'hi' } } })
  ok('a tool answers text and structured content', call.result.structuredContent.v === 'hi' && call.result.content[0].type === 'text' && call.result.isError === undefined)
  const wrong = await mcp.handle({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'echo', arguments: { v: 3 } } })
  ok('wrong arguments are a result marked isError, readable by the model', wrong.result.isError === true && wrong.result.content[0].text === 'v must be a string' && wrong.error === undefined)
  ok('arguments that are not an object are refused the same way', (await mcp.handle({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'echo', arguments: [1] } })).result.isError === true)
  ok('an unknown tool is -32602', (await mcp.handle({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'nope' } })).error.code === -32602)
  const boom = await mcp.handle({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'boom', arguments: {} } })
  ok('a tool that throws says nothing of its stack or paths', boom.result.isError === true && !/Users|stack|secret/.test(JSON.stringify(boom)))
}

console.log('the HTTP fence')
const listen = (handler) => new Promise((resolve) => {
  const server = createServer((req, res) => { handler(req, res) })
  server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, close: () => new Promise((r) => server.close(r)) }))
})
const call = (port, { method = 'POST', headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const req = httpRequest({ host: '127.0.0.1', port, path: '/kybernos-door/mcp', method, headers: { ...headers } }, (res) => {
    let data = ''
    res.on('data', (c) => { data += c })
    res.on('end', () => { let json = null; try { json = JSON.parse(data) } catch (e) { /* no body */ } resolve({ status: res.statusCode, headers: res.headers, json, text: data }) })
  })
  req.on('error', reject)
  if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body))
  req.end()
})
{
  let secret = 'kbd_' + 'a'.repeat(48)
  const mcp = createMcp({ info: { name: 'x', version: '1' }, tools: echoTools })
  const srv = await listen(createHandler({ mcp, token: () => secret }))
  const good = { authorization: 'Bearer ' + secret, 'content-type': 'application/json' }
  const ping = { jsonrpc: '2.0', id: 1, method: 'ping' }
  ok('the right token and a JSON body is answered', (await call(srv.port, { headers: good, body: ping })).status === 200)
  const none = await call(srv.port, { headers: { 'content-type': 'application/json' }, body: ping })
  ok('no token is 401 with a Bearer challenge', none.status === 401 && none.headers['www-authenticate'] === 'Bearer')
  ok('a wrong token is 401', (await call(srv.port, { headers: { ...good, authorization: 'Bearer kbd_' + 'b'.repeat(48) }, body: ping })).status === 401)
  ok('a token of another length is 401 (no exception)', (await call(srv.port, { headers: { ...good, authorization: 'Bearer x' }, body: ping })).status === 401)
  ok('a browser origin is refused even with the right token', (await call(srv.port, { headers: { ...good, origin: 'http://evil.example' }, body: ping })).status === 403)
  ok('a same-site looking origin is refused too (no browser at all)', (await call(srv.port, { headers: { ...good, origin: 'http://127.0.0.1:' + srv.port }, body: ping })).status === 403)
  ok('a Host that is not this listener is refused (DNS rebinding)', (await call(srv.port, { headers: { ...good, host: 'evil.example:' + srv.port }, body: ping })).status === 403)
  ok('a Host with another port is refused', (await call(srv.port, { headers: { ...good, host: '127.0.0.1:1' }, body: ping })).status === 403)
  ok('localhost is an accepted Host', (await call(srv.port, { headers: { ...good, host: 'localhost:' + srv.port }, body: ping })).status === 200)
  const get = await call(srv.port, { method: 'GET', headers: { authorization: good.authorization } })
  ok('GET is 405 (no stream to open)', get.status === 405 && get.headers.allow === 'POST')
  ok('GET without the token is 401, not 405 (nothing is learned unauthenticated)', (await call(srv.port, { method: 'GET' })).status === 401)
  ok('a body that is not JSON by content type is 415', (await call(srv.port, { headers: { authorization: good.authorization, 'content-type': 'text/plain' }, body: 'x' })).status === 415)
  ok('a body that is not JSON is -32700', (await call(srv.port, { headers: good, body: '{nope' })).json.error.code === -32700)
  ok('a batch is refused', (await call(srv.port, { headers: good, body: [ping] })).status === 400)
  ok('a notification is 202 with no body', await call(srv.port, { headers: good, body: { jsonrpc: '2.0', method: 'notifications/initialized' } }).then((r) => r.status === 202 && r.text === ''))
  const big = await call(srv.port, { headers: good, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: { pad: 'x'.repeat(70000) } }) }).catch(() => ({ status: 413 }))
  ok('a body over 64 KiB is cut', big.status === 413)
  ok('the answer is never cached', (await call(srv.port, { headers: good, body: ping })).headers['cache-control'] === 'no-store')
  secret = ''
  ok('with no token on disk the door is off (503), whatever is sent', (await call(srv.port, { headers: good, body: ping })).status === 503)
  secret = 'kbd_' + 'c'.repeat(48)
  ok('a rotated token counts at once', (await call(srv.port, { headers: { ...good, authorization: 'Bearer ' + secret }, body: ping })).status === 200 && (await call(srv.port, { headers: good, body: ping })).status === 401)
  await srv.close()
  ok('hostOk and bearerOk refuse what they cannot read', hostOk({}) === false && hostOk({ headers: { host: '127.0.0.1:5' } }) === false && bearerOk(undefined, 'x') === false && bearerOk('Bearer x', '') === false)
}

console.log('the tools')
const fakeWorld = (over = {}) => {
  const w = { clock: 0, creates: 0, prompts: [], asked: [], order: [], polls: 0, state: { running: false, queue: [], pendingInput: [] }, events: {}, refuse: false, noCreate: false, ...over }
  w.facade = () => (w.off === true ? null : {
    create: async () => { if (w.noCreate) return null; w.creates += 1; return 'sess_' + w.creates },
    askFirst: async (sid) => { w.asked.push(sid); w.order.push('ask'); if (w.askThrows) throw new Error('boom'); return w.ask ?? { ok: true } },
    prompt: async (sid, text) => { w.order.push('prompt'); w.prompts.push([sid, text]); if (w.refuse) return false; w.onPrompt?.(sid); return true },
    state: async (sid) => { w.polls += 1; return typeof w.state === 'function' ? w.state(sid, w) : w.state },
    stop: async (sid) => { w.stops = [...(w.stops ?? []), sid]; if (w.stopThrows) throw new Error('boom'); return w.stopResult ?? { ok: true, stopped: 1 } },
  })
  w.events_ = async (sid) => w.events[sid] ?? []
  return w
}
const toolsOf = (w, file) => {
  let n = 0
  const tasks = createTasks({ file: () => file, now: () => w.clock, newId: () => '11111111-1111-4111-8111-' + String(++n).padStart(12, '0') })
  const tools = createTools({ facade: w.facade, events: w.events_, tasks, now: () => w.clock, sleep: async (ms) => { w.clock += ms }, settleMs: 0, pollMs: 500, graceMs: 5000 })
  const by = Object.fromEntries(tools.map((t) => [t.name, t]))
  const run = async (name, args) => { const p = by[name].parse(args); if (p.ok !== true) return { refused: p.error }; return by[name].run(p.value) }
  return { by, run, tasks }
}
{
  const kd = (name) => join(TMP, 'tools-' + name, 'tasks.json')

  // 1. finishes within the wait
  const w1 = fakeWorld()
  w1.state = (sid, w) => (w.polls <= 2 ? { running: true, queue: [], pendingInput: [] } : { running: false, queue: [], pendingInput: [] })
  w1.events.sess_1 = [msg('The answer is 42.')]
  const t1 = toolsOf(w1, kd(1))
  const r1 = await t1.run('kaby_do', { task: '  what is the answer?  ' })
  ok('a task that finishes in time returns its answer', r1.data.status === 'done' && r1.data.answer === 'The answer is 42.' && /^[0-9a-f-]{36}$/.test(r1.data.task_id) && r1.data.session_id === 'sess_1')
  ok('the prompt sent is the task, trimmed, nothing added', w1.prompts.length === 1 && w1.prompts[0][1] === 'what is the answer?')
  ok('the task id is the way back to it', t1.tasks.get(r1.data.task_id).session === 'sess_1')
  ok('the session is put under ask-first BEFORE the prompt is sent', w1.asked.join() === 'sess_1' && w1.order.join() === 'ask,prompt', w1.order.join())

  // 2. does not finish in time, then comes back by id
  const w2 = fakeWorld()
  w2.state = { running: true, queue: [], pendingInput: [] }
  w2.events.sess_1 = [msg('late answer')]
  const t2 = toolsOf(w2, kd(2))
  const r2 = await t2.run('kaby_do', { task: 'slow', wait_seconds: 3 })
  ok('a task still going says running and how to wait more', r2.data.status === 'running' && has(r2.data.next, /task_id/) && r2.data.answer === undefined)
  ok('it waited about as long as asked, and no more', w2.clock >= 3000 && w2.clock <= 4000, String(w2.clock))
  w2.state = { running: false, queue: [], pendingInput: [] }
  const r2b = await t2.run('kaby_do', { task_id: r2.data.task_id, wait_seconds: 5 })
  ok('asking again by task_id returns the answer and starts nothing', r2b.data.status === 'done' && r2b.data.answer === 'late answer' && w2.creates === 1 && w2.prompts.length === 1)

  // 3. waiting for the person
  const w3 = fakeWorld()
  w3.state = { running: true, queue: [], pendingInput: ['approval'] }
  const t3 = toolsOf(w3, kd(3))
  const r3 = await t3.run('kaby_do', { task: 'send an email' })
  ok('a step that needs approval is reported at once, with the reason it cannot be given here', r3.data.status === 'waiting_approval' && has(r3.data.next, /cannot approve/) && w3.clock < 2000)
  w3.state = { running: true, queue: [], pendingInput: ['question'] }
  ok('a question to the person is its own status', (await t3.run('kaby_do', { task_id: r3.data.task_id, wait_seconds: 0 })).data.status === 'waiting_answer')

  // 4. wait 0
  const w4 = fakeWorld()
  w4.onPrompt = () => { w4.state = { running: true, queue: [], pendingInput: [] } }
  const t4 = toolsOf(w4, kd(4))
  const r4 = await t4.run('kaby_do', { task: 'x', wait_seconds: 0 })
  ok('wait_seconds 0 starts it and answers running without waiting', r4.data.status === 'running' && w4.clock === 0)

  // 5. never started
  const w5 = fakeWorld()
  const t5 = toolsOf(w5, kd(5))
  const r5 = await t5.run('kaby_do', { task: 'x', wait_seconds: 45 })
  ok('a task that never starts ends as failed/no_answer after a short grace, not after the full wait', r5.data.status === 'failed' && r5.data.reason === 'no_answer' && w5.clock >= 5000 && w5.clock < 8000, String(w5.clock))

  // 6. failure codes
  const w6 = fakeWorld()
  w6.onPrompt = () => { w6.state = { running: false, queue: [], pendingInput: [] } }
  w6.state = { running: true, queue: [], pendingInput: [] }
  w6.events.sess_1 = [{ type: 'llm/retry', data: { failure: { code: 'RATE_LIMIT' } } }]
  const t6 = toolsOf(w6, kd(6))
  const r6 = await t6.run('kaby_do', { task: 'x', wait_seconds: 0 })
  w6.state = { running: false, queue: [], pendingInput: [] }
  const r6b = await t6.run('kaby_do', { task_id: r6.data.task_id })
  ok('a model that could not answer is failed with a code', r6b.data.status === 'failed' && r6b.data.reason === 'model_429')

  // 7. refusals
  const w7 = fakeWorld({ off: true })
  const t7 = toolsOf(w7, kd(7))
  const r7 = await t7.run('kaby_do', { task: 'x' })
  ok('sessions not ready is a refusal with a code', r7.isError === true && r7.data.error === 'sessions_unavailable' && w7.creates === 0)
  const w7b = fakeWorld({ noCreate: true })
  ok('no conversation is a refusal', (await toolsOf(w7b, kd('7b')).run('kaby_do', { task: 'x' })).data.error === 'no_session')
  const w7c = fakeWorld({ refuse: true })
  ok('a refused prompt is a refusal', (await toolsOf(w7c, kd('7c')).run('kaby_do', { task: 'x' })).data.error === 'prompt_refused')
  const w7a = fakeWorld({ ask: { ok: false, error: 'no_asking_preset' } })
  const t7a = toolsOf(w7a, kd('7a'))
  const r7a = await t7a.run('kaby_do', { task: 'x' })
  ok('a session that cannot be put under ask-first is never sent the task, and nothing is recorded', r7a.isError === true && r7a.data.error === 'approvals_unavailable' && has(r7a.data.hint, /no_asking_preset/) && w7a.prompts.length === 0 && t7a.tasks.recent(5).length === 0)
  const w7e = fakeWorld({ askThrows: true })
  const r7e = await toolsOf(w7e, kd('7e')).run('kaby_do', { task: 'x' })
  ok('an ask-first that throws is the same refusal', r7e.data.error === 'approvals_unavailable' && w7e.prompts.length === 0)
  const w7d = fakeWorld()
  const t7d = toolsOf(w7d, '/dev/null/x/tasks.json')
  const r7d = await t7d.run('kaby_do', { task: 'x' })
  ok('a task that cannot be recorded is not started (a running task always has its way back)', r7d.data.error === 'task_not_kept' && w7d.prompts.length === 0)
  ok('an unknown task id is a refusal', (await toolsOf(fakeWorld(), kd(8)).run('kaby_do', { task_id: '22222222-2222-4222-8222-222222222222' })).data.error === 'unknown_task')

  // 8. idempotency
  const w9 = fakeWorld()
  w9.state = { running: false, queue: [], pendingInput: [] }
  w9.onPrompt = () => { w9.state = { running: true, queue: [], pendingInput: [] } }
  const t9 = toolsOf(w9, kd(9))
  const a9 = await t9.run('kaby_do', { task: 'report', idempotency_key: 'req-1', wait_seconds: 0 })
  const b9 = await t9.run('kaby_do', { task: 'report', idempotency_key: 'req-1', wait_seconds: 0 })
  ok('the same idempotency key gives the same task and starts one session', a9.data.task_id === b9.data.task_id && w9.creates === 1 && w9.prompts.length === 1)

  // 9. list
  const w10 = fakeWorld()
  w10.state = (sid) => (sid === 'sess_1' ? { running: true, queue: [], pendingInput: [] } : (sid === 'sess_2' ? { running: true, queue: [], pendingInput: ['approval'] } : { running: false, queue: [], pendingInput: [] }))
  w10.onPrompt = () => {}
  const t10 = toolsOf(w10, kd(10))
  for (const k of [1, 2, 3]) await t10.run('kaby_do', { task: 't' + k, wait_seconds: 0 })
  const listed = (await t10.run('list_tasks', {})).data.tasks
  ok('list_tasks shows the most recent first with a status and a date', listed.length === 3 && listed[0].status === 'finished' && listed[1].status === 'waiting_approval' && listed[2].status === 'running' && /^\d{4}-\d\d-\d\dT/.test(listed[0].started_at))
  ok('list_tasks honours its limit', (await t10.run('list_tasks', { limit: 2 })).data.tasks.length === 2)

  // 9b. stop
  {
    const w = fakeWorld()
    w.state = (sid) => (w.stops !== undefined && w.stops.includes(sid) && w.idleAfterStop !== false ? { running: false, queue: [], pendingInput: [] } : { running: true, queue: [], pendingInput: [] })
    w.events.sess_1 = [msg('a late answer that must not be given back')]
    const t = toolsOf(w, kd(12))
    const given = await t.run('kaby_do', { task: 'long job', wait_seconds: 0 })
    ok('the task is going', given.data.status === 'running')
    const stopped = await t.run('kaby_stop', { task_id: given.data.task_id })
    ok('kaby_stop cancels the task\'s session and says canceled', stopped.data.status === 'canceled' && stopped.data.task_id === given.data.task_id && w.stops.join() === 'sess_1' && stopped.data.stopping === undefined, JSON.stringify(stopped))
    ok('the task id then says canceled, never an answer it did not give', (await t.run('kaby_do', { task_id: given.data.task_id, wait_seconds: 0 })).data.status === 'canceled' && t.tasks.get(given.data.task_id).stopped === true)
    ok('list_tasks says canceled too', (await t.run('list_tasks', {})).data.tasks[0].status === 'canceled')
    const again = await t.run('kaby_stop', { task_id: given.data.task_id })
    ok('stopping again is harmless and does not cancel twice', again.data.status === 'canceled' && w.stops.length === 1)
    ok('an unknown task id is refused', (await t.run('kaby_stop', { task_id: '99999999-9999-4999-8999-999999999999' })).isError === true)

    // A task that is already over is not stopped: its answer stays.
    const wd = fakeWorld()
    wd.events.sess_1 = [msg('All done.')]
    const td = toolsOf(wd, kd(13))
    const over = await td.run('kaby_do', { task: 'quick', wait_seconds: 5 })
    const late = await td.run('kaby_stop', { task_id: over.data.task_id })
    ok('a finished task is not stopped: its answer comes back as it was', over.data.status === 'done' && late.data.status === 'done' && late.data.answer === 'All done.' && wd.stops === undefined && td.tasks.get(over.data.task_id).stopped !== true)

    // An engine that does not show the task idle in time: the stop is sent, and it is said to be still stopping.
    const ws = fakeWorld({ idleAfterStop: false })
    ws.state = { running: true, queue: [], pendingInput: [] }
    const ts = toolsOf(ws, kd(14))
    const slow = await ts.run('kaby_do', { task: 'stubborn', wait_seconds: 0 })
    const slowStop = await ts.run('kaby_stop', { task_id: slow.data.task_id })
    ok('a task the engine has not yet shown idle is canceled but still stopping, with what to do', slowStop.data.status === 'canceled' && slowStop.data.stopping === true && has(slowStop.data.next, /Ask again/))

    // A stop that fails is said, and the task is NOT marked canceled (it may still be running).
    const wf = fakeWorld({ stopResult: { ok: false, error: 'sessions_unavailable' } })
    wf.state = { running: true, queue: [], pendingInput: [] }
    const tf = toolsOf(wf, kd(15))
    const live = await tf.run('kaby_do', { task: 'x', wait_seconds: 0 })
    const refused = await tf.run('kaby_stop', { task_id: live.data.task_id })
    ok('a stop the engine refuses is an error, and the task is not marked canceled', refused.isError === true && refused.data.error === 'stop_failed' && tf.tasks.get(live.data.task_id).stopped !== true)
    const wt = fakeWorld({ stopThrows: true })
    wt.state = { running: true, queue: [], pendingInput: [] }
    const tt = toolsOf(wt, kd(16))
    const live2 = await tt.run('kaby_do', { task: 'x', wait_seconds: 0 })
    ok('a stop that throws is the same error, never a crash', (await tt.run('kaby_stop', { task_id: live2.data.task_id })).data.error === 'stop_failed')
    const wo = fakeWorld({ off: true })
    const to = toolsOf(wo, kd(17))
    to.tasks.start({ session: 'sess_9' })
    ok('with the sessions not ready the stop says so', (await to.run('kaby_stop', { task_id: to.tasks.recent(1)[0].id })).data.error === 'sessions_unavailable')
  }

  // 10. arguments
  const T = toolsOf(fakeWorld(), kd(11))
  const bad = (name, args) => T.by[name].parse(args).ok === false
  ok('kaby_do needs exactly one of task and task_id', bad('kaby_do', {}) && bad('kaby_do', { task: 'x', task_id: '11111111-1111-4111-8111-111111111111' }))
  ok('an empty or oversized task is refused', bad('kaby_do', { task: '   ' }) && bad('kaby_do', { task: 'x'.repeat(8001) }) && !bad('kaby_do', { task: 'x'.repeat(8000) }))
  ok('a task_id must be an id', bad('kaby_do', { task_id: 'abc' }))
  ok('an idempotency key goes with a task and is plain', bad('kaby_do', { task_id: '11111111-1111-4111-8111-111111111111', idempotency_key: 'k' }) && bad('kaby_do', { task: 'x', idempotency_key: 'bad key!' }))
  ok('wait_seconds is a whole number from 0 to the cap', bad('kaby_do', { task: 'x', wait_seconds: -1 }) && bad('kaby_do', { task: 'x', wait_seconds: WAIT_MAX + 1 }) && bad('kaby_do', { task: 'x', wait_seconds: 1.5 }) && !bad('kaby_do', { task: 'x', wait_seconds: WAIT_MAX }))
  ok('an unknown argument is refused with the list of the allowed ones', has(T.by.kaby_do.parse({ task: 'x', model: 'y' }).error, /Unknown argument: model.*Allowed/) && bad('list_tasks', { limit: 0 }) && bad('list_tasks', { limit: 21 }) && bad('list_tasks', { x: 1 }))
  ok('kaby_stop takes exactly a task id', bad('kaby_stop', {}) && bad('kaby_stop', { task_id: 'abc' }) && bad('kaby_stop', { task_id: '11111111-1111-4111-8111-111111111111', force: true }) && !bad('kaby_stop', { task_id: '11111111-1111-4111-8111-111111111111' }))
  ok('all three tools have a title, a description and an object schema', Object.values(T.by).every((t) => t.title !== '' && t.description.length > 40 && t.inputSchema.type === 'object' && t.inputSchema.additionalProperties === false))
  ok('kaby_do says in its description that it cannot approve', has(T.by.kaby_do.description, /cannot approve/))
}

console.log('the whole door, through HTTP, over a fake engine')
{
  const sessions = new Map()
  let nextSession = 0
  const engine = {
    sessionController: {
      create: async () => { const id = 'sess_' + (++nextSession); sessions.set(id, { running: false, events: [] }); return { ok: true, value: { sessionId: id } } },
      prompt: async (req) => {
        const s = sessions.get(req.sessionId)
        if (req.mode !== 'queue' || !Array.isArray(req.content) || typeof req.requestId !== 'string') return { ok: false }
        s.running = true
        setTimeout(() => { s.events.push(msg('Done: ' + req.content[0].text)); s.running = false }, 700)
        return { ok: true, value: {} }
      },
      state: async (req) => ({ ok: true, value: { cursor: 0, active: true, running: sessions.get(req.sessionId).running, queue: [], pendingInput: [] } }),
    },
    sessionPersistence: { open: async (sid) => ({ read: async () => ({ events: sessions.get(sid).events }), close: async () => {} }) },
  }
  const home = join(TMP, 'whole')
  const asked = []
  globalThis[Symbol.for('kybernos.askSessions')] = { begin: (sid, options) => { asked.push([sid, options]); return { ok: true, preset: 'workspace-write' } } }
  const built = door.buildDoor((s) => engine[s], { home: () => home })
  const secret = built.token.ensure()
  const srv = await listen(built.handler)
  const h = { authorization: 'Bearer ' + secret, 'content-type': 'application/json' }
  const rpc = (id, method, params) => call(srv.port, { headers: h, body: { jsonrpc: '2.0', id, method, params } })
  ok('initialize works through HTTP', (await rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } })).json.result.serverInfo.name === 'kaby-mcp')
  ok('tools/list shows kaby_do, list_tasks and kaby_stop', (await rpc(2, 'tools/list')).json.result.tools.map((t) => t.name).join() === 'kaby_do,list_tasks,kaby_stop')
  const started = await rpc(3, 'tools/call', { name: 'kaby_do', arguments: { task: 'say hi', wait_seconds: 10 } })
  const out = started.json.result.structuredContent
  ok('a task given through HTTP runs and its answer comes back (real timers)', out.status === 'done' && out.answer === 'Done: say hi', JSON.stringify(out))
  ok('the task is on disk, readable by the owner alone', existsSync(join(home, 'kybernos', 'door', 'tasks.json')) && (statSync(join(home, 'kybernos', 'door', 'tasks.json')).mode & 0o777) === 0o600)
  const again = await rpc(4, 'tools/call', { name: 'kaby_do', arguments: { task_id: out.task_id } })
  ok('the answer can be read again by task id', again.json.result.structuredContent.answer === 'Done: say hi')
  ok('the answer text a model reads is JSON of the same data', JSON.parse(again.json.result.content[0].text).task_id === out.task_id)
  ok('the core plugin\'s ask-first seam was asked for that session, worded as a task of an outside assistant', asked.length === 1 && asked[0][0] === 'sess_1' && asked[0][1].door === true)
  globalThis[Symbol.for('kybernos.askSessions')] = { begin: () => ({ ok: false, error: 'no_asking_preset' }) }
  const refusedOut = (await rpc(5, 'tools/call', { name: 'kaby_do', arguments: { task: 'second' } })).json.result
  ok('when the seam refuses, the task is not started and the assistant is told why', refusedOut.isError === true && refusedOut.structuredContent.error === 'approvals_unavailable' && sessions.get('sess_2').events.length === 0 && sessions.get('sess_2').running === false)
  delete globalThis[Symbol.for('kybernos.askSessions')]
  const missingOut = (await rpc(6, 'tools/call', { name: 'kaby_do', arguments: { task: 'third' } })).json.result
  ok('without the seam at all (the core plugin is not loaded) the task is not started either', missingOut.isError === true && has(missingOut.structuredContent.hint, /seam_missing/) && sessions.get('sess_3').running === false)
  await srv.close()

  // the facade and the reader tolerate an engine that is not ready
  const f = door.sessionsFacade(() => undefined)
  ok('no sessionController means no facade', f() === null)
  ok('a sessionController without state means no facade', door.sessionsFacade(() => ({ create () {}, prompt () {} }))() === null)
  ok('no persistence reads no events', (await door.eventsReader(() => undefined)('s')).length === 0)
  const refusedState = door.sessionsFacade(() => ({ create: async () => ({ ok: false }), prompt: async () => ({ ok: false }), state: async () => ({ ok: false }) }))()
  ok('a refusing engine gives no session, no state and a refused prompt', (await refusedState.create()) === null && (await refusedState.state('s')) === null && (await refusedState.prompt('s', 'x')) === false)
}

console.log("the Settings page's routes, and the last call")
{
  const { installSession, sessionCookie } = await import('./lib-session-test.mjs')
  const { createActivity } = await import('./activity.mjs')
  const { messageFor, snippetsFor, addressOf } = await import('./setup.mjs')
  installSession(process.env.DSH_HOME)
  const home = join(TMP, 'setup')
  const callPath = (port, path, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method, headers: { ...headers } }, (res) => {
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => { let json = null; try { json = JSON.parse(data) } catch (e) { /* no body */ } resolve({ status: res.statusCode, json, text: data }) })
    })
    req.on('error', reject)
    if (body !== undefined) req.write(JSON.stringify(body))
    req.end()
  })
  let now = 1_000_000_000_000
  const built = door.buildDoor(() => undefined, { home: () => home })
  const secret = built.token.ensure()
  const byPath = { '/kybernos-door/setup': built.setup.state, '/kybernos-door/setup/token': built.setup.token, '/kybernos-door/setup/rotate': built.setup.rotate }
  const page = await listen((req, res) => { const h = byPath[new URL(req.url, 'http://x').pathname]; if (h === undefined) { res.writeHead(404); res.end(); return } h(req, res) })
  const door1 = await listen(built.handler)
  const authority = '127.0.0.1:' + page.port
  const browser = { origin: 'http://' + authority, cookie: sessionCookie(authority) }
  const get = (path, headers = browser) => callPath(page.port, path, { headers })
  const post = (path, headers = browser) => callPath(page.port, path, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: {} })

  for (const path of ['/kybernos-door/setup', '/kybernos-door/setup/token', '/kybernos-door/setup/rotate']) {
    const method = path.endsWith('setup') ? 'GET' : 'POST'
    const noCookie = await callPath(page.port, path, { method, headers: { origin: browser.origin } })
    ok(path + ': the right Origin without the signed session is refused (401), and says nothing of the token', noCookie.status === 401 && !noCookie.text.includes(secret))
    const foreign = await callPath(page.port, path, { method, headers: { origin: 'http://evil.example', cookie: browser.cookie } })
    ok(path + ': a foreign Origin is refused even with the cookie', foreign.status === 403)
  }
  for (const path of ['/kybernos-door/setup', '/kybernos-door/setup/token', '/kybernos-door/setup/rotate']) {
    const method = path.endsWith('setup') ? 'GET' : 'POST'
    const rebound = await callPath(page.port, path, { method, headers: { ...browser, host: 'attacker.example:' + page.port } })
    ok(path + ': a rebound Host is refused (403) even with the right Origin and the signed session, and says nothing of the token', rebound.status === 403 && !rebound.text.includes(secret))
  }
  ok('the state is only for GET and the token and rotate routes only for POST', (await post('/kybernos-door/setup')).status === 405 && (await get('/kybernos-door/setup/token')).status === 405 && (await get('/kybernos-door/setup/rotate')).status === 405)
  ok('a request that came through the phone link never reaches the token', (await post('/kybernos-door/setup/token', { ...browser, 'x-kybernos-tunnel': '1' })).status === 403)

  const st = await get('/kybernos-door/setup?lang=en')
  ok('the state names the address of the listener the page came from, and where the token file is', st.status === 200 && st.json.url === 'http://127.0.0.1:' + page.port + '/kybernos-door/mcp' && st.json.tokenFile === join(home, 'kybernos', 'door', 'token'))
  ok('the state never carries the token, in the message or the snippets', !st.text.includes(secret) && !st.text.includes(secret.slice(4)))
  ok('the message is for an assistant: address and token PLACE, in English', has(st.json.message, /Add an MCP server named "kaby"/) && st.json.message.includes(st.json.url) && st.json.message.includes(st.json.tokenFile))
  ok('French is asked for with lang=fr, anything else is English', has((await get('/kybernos-door/setup?lang=fr')).json.message, /^Ajoute à tes outils un serveur MCP/) && has((await get('/kybernos-door/setup?lang=xx')).json.message, /^Add an MCP server/))
  ok('three manual snippets, Claude Code reading the token from the file', st.json.snippets.map((x) => x.id).join() === 'claude-code,codex,json' && has(st.json.snippets[0].code, /^claude mcp add --scope user --transport http kaby http:\/\/127\.0\.0\.1:\d+\/kybernos-door\/mcp --header "Authorization: Bearer \$\(cat .*token\)"$/))
  ok('no assistant has called yet', st.json.lastCallAt === null && st.json.hasToken === true)

  ok('the page can read the token to copy it (never to draw it)', (await post('/kybernos-door/setup/token')).json.token === secret)
  const hit = await callPath(door1.port, '/kybernos-door/mcp', { method: 'POST', headers: { authorization: 'Bearer ' + secret, 'content-type': 'application/json' }, body: { jsonrpc: '2.0', id: 1, method: 'ping' } })
  const after = await get('/kybernos-door/setup')
  ok('a call with the right token is the « last call » of the page', hit.status === 200 && Number.isFinite(after.json.lastCallAt) && Date.now() - after.json.lastCallAt < 10000)
  const wrong = await callPath(door1.port, '/kybernos-door/mcp', { method: 'POST', headers: { authorization: 'Bearer kbd_' + 'b'.repeat(48), 'content-type': 'application/json' }, body: { jsonrpc: '2.0', id: 1, method: 'ping' } })
  const fresh = door.buildDoor(() => undefined, { home: () => join(TMP, 'setup-fresh') })
  fresh.token.ensure()
  const freshSrv = await listen(fresh.handler)
  await callPath(freshSrv.port, '/kybernos-door/mcp', { method: 'POST', headers: { authorization: 'Bearer kbd_' + 'b'.repeat(48), 'content-type': 'application/json' }, body: { jsonrpc: '2.0', id: 1, method: 'ping' } })
  ok('a call with the wrong token is refused and is not a « last call »', wrong.status === 401 && fresh.activity.lastAt() === null)
  const checkCall = await callPath(freshSrv.port, '/kybernos-door/mcp', { method: 'POST', headers: { authorization: 'Bearer ' + fresh.token.current(), 'x-kaby-check': '1', 'content-type': 'application/json' }, body: { jsonrpc: '2.0', id: 1, method: 'ping' } })
  ok('a check run by the maintainer (header x-kaby-check) is answered like any call but is not a « last call »: the page never says an assistant connected because of it', checkCall.status === 200 && fresh.activity.lastAt() === null)
  const realCall = await callPath(freshSrv.port, '/kybernos-door/mcp', { method: 'POST', headers: { authorization: 'Bearer ' + fresh.token.current(), 'content-type': 'application/json' }, body: { jsonrpc: '2.0', id: 1, method: 'ping' } })
  ok('the same call without that header is a « last call »', realCall.status === 200 && Number.isFinite(fresh.activity.lastAt()))
  await freshSrv.close()
  const afterRestart = door.buildDoor(() => undefined, { home: () => home })
  ok('the last call survives a restart of Kybernos (a time in a file only the owner reads)', afterRestart.activity.lastAt() === after.json.lastCallAt && (statSync(join(home, 'kybernos', 'door', 'activity.json')).mode & 0o777) === 0o600 && Object.keys(JSON.parse(readFileSync(join(home, 'kybernos', 'door', 'activity.json'), 'utf8'))).join() === 'at')

  const rotated = await post('/kybernos-door/setup/rotate')
  const newSecret = built.token.current()
  ok('a new token closes the old one at once', rotated.json.ok === true && newSecret !== secret && (await callPath(door1.port, '/kybernos-door/mcp', { method: 'POST', headers: { authorization: 'Bearer ' + secret, 'content-type': 'application/json' }, body: { jsonrpc: '2.0', id: 1, method: 'ping' } })).status === 401)
  rmSync(join(home, 'kybernos', 'door', 'token'))
  ok('with no token file the page is told so (503), not given an empty token', (await post('/kybernos-door/setup/token')).status === 503 && (await get('/kybernos-door/setup')).json.hasToken === false)
  await page.close(); await door1.close()

  // The pure parts.
  let wrote = 0
  const dir = join(TMP, 'act'); const f = join(dir, 'activity.json')
  const act = createActivity({ file: () => f, now: () => now, every: 20000 })
  ok('no file, no call', act.lastAt() === null)
  act.touch(); const first = now
  now += 5000; act.touch()
  ok('the second call within 20 s is kept in memory and not written again', act.lastAt() === now && JSON.parse(readFileSync(f, 'utf8')).at === first)
  now += 20000; act.touch()
  ok('after 20 s it is written again', JSON.parse(readFileSync(f, 'utf8')).at === now)
  ok('a time from the far future in the file is not believed', (() => { writeFileSync(f, JSON.stringify({ at: now + 10 * 3600_000 })); return createActivity({ file: () => f, now: () => now }).lastAt() === null })())
  ok('a file that is not ours is no call', (() => { writeFileSync(f, 'not json'); return createActivity({ file: () => f, now: () => now }).lastAt() === null })())
  ok('a profile that cannot be written never stops a call', (() => { const a = createActivity({ file: () => '/dev/null/x/activity.json', now: () => now }); a.touch(); return a.lastAt() === now })())
  ok('the address falls back to 3080 with no socket', addressOf({}) === 'http://127.0.0.1:3080/kybernos-door/mcp')
  ok('the snippets keep the placeholder the person fills', snippetsFor('http://x', '/t').filter((x) => x.code.includes('<token>')).length === 2 && messageFor('en', 'http://x', '/t').split('\n').length === 5)
  void wrote
}

console.log('the Settings page (client source, no browser here)')
{
  const client = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
  const keys = [...client.matchAll(/\bm\('(kdm\.[a-z.]+)'/g)].map((x) => x[1])
  const table = new Set([...client.matchAll(/^\s+'(kdm\.[a-z.]+)': \{ fr: '/gm)].map((x) => x[1]))
  ok('every sentence the page asks for exists in French and English', keys.length > 20 && keys.every((k) => table.has(k)), keys.filter((k) => !table.has(k)).join())
  ok('every entry of the table has both languages', [...client.matchAll(/^\s+'kdm\.[a-z.]+': \{ fr: '[^\n]*', en: '[^\n]*' \},$/gm)].length === table.size)
  ok('it calls the three routes of the host and no other', [...new Set([...client.matchAll(/'(\/kybernos-door\/[a-z/?=]+)/g)].map((x) => x[1]))].sort().join() === '/kybernos-door/setup/rotate,/kybernos-door/setup/token,/kybernos-door/setup?lang=')
  ok('it never draws the token: the token is only put on the clipboard', !/state\.token|\{ token\b|\.token\s*\)/.test(client.replace(/typeof r\.token === 'string'[^\n]*/g, '').replace(/r\.token/g, 'R')) && /copierTexte\('jeton', r\.token/.test(client))
  ok('it declares no class of the shared kbm- family (a prefix only grows by a decision)', !/['"\s.]kbm-[a-z]/.test(client.replace(/\/\*[^*]*\*\//g, '')))
  const words = [client, readFileSync(new URL('./plugin.json', import.meta.url), 'utf8'), readFileSync(new URL('./help.json', import.meta.url), 'utf8')].join('\n')
  ok('the assistant is never called an assistant of code: Cowork and others are assistants too', !/assistant de code|coding assistant|code assistant/i.test(words))
  const setupSource = readFileSync(new URL('./setup.mjs', import.meta.url), 'utf8')
  ok('the page knows the host half\'s « host refused » answer (the one the Host fence sends) and says plainly that a hosted Kybernos uses the account\'s door',
    /error: 'host refused'/.test(setupSource) && /r\.error === 'host refused'/.test(client) && /data-kdm': 'heberge'/.test(client) && /connecteur « Kaby »/.test(client) && /“Kaby” connector/.test(client))
  ok('it tells the person that Cowork and claude.ai cannot reach this computer', /Claude Cowork et claude\.ai/.test(client) && /Claude Cowork and claude\.ai/.test(client))
  const manifest = JSON.parse(readFileSync(new URL('./plugin.json', import.meta.url), 'utf8'))
  ok('the manifest declares the Settings slot and the client entry', manifest.entry.client === 'client.js' && manifest.permissions.includes('ui.slot:settings.section') && manifest.name.fr === 'Kaby MCP' && manifest.name.en === 'Kaby MCP')
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
  ok('package.json exports the client', pkg.exports['./client'] === './client.js')
}

console.log('the plugin')
{
  const log = []
  const lines = []
  const realLog = console.log
  console.log = (...a) => { lines.push(a.join(' ')) }
  const registered = []
  const effects = []
  const ctx = { get: (s) => (s === 'webServer' ? { register: (r) => { registered.push(r); return () => registered.splice(registered.indexOf(r), 1) } } : undefined), effect: (fn, label) => { effects.push(label); return fn() }, inject: () => { log.push('inject') } }
  let threw = false
  try { door.apply(ctx) } catch (e) { threw = true }
  console.log = realLog
  ok('apply mounts the MCP route and the three routes of the Settings page, all exact, all under the claimed prefix, all through ctx.effect', !threw && registered.length === 4 && registered.every((r) => r.kind === 'exact' && r.path.startsWith('/kybernos-door/')) && registered.map((r) => r.path).join() === '/kybernos-door/mcp,/kybernos-door/setup,/kybernos-door/setup/token,/kybernos-door/setup/rotate' && effects.length === 4)
  ok('apply made the token in the (temporary) profile and nowhere else', existsSync(join(process.env.DSH_HOME, 'kybernos', 'door', 'token')))
  ok('the route is the claimed prefix of the manifest', JSON.parse(readFileSync(new URL('./plugin.json', import.meta.url), 'utf8')).claims.routePrefixes.every((p) => registered.every((r) => r.path.startsWith(p))))

  const waiting = []
  let injected = null
  door.apply({ get: () => undefined, effect: (fn) => fn(), inject: (names, cb) => { waiting.push(names.join()); injected = cb } })
  ok('without the web server yet, apply waits for it instead of failing', waiting[0] === 'webServer' && typeof injected === 'function')
  let late = 0
  injected({ webServer: { register: () => { late += 1; return () => {} } } })
  ok('and mounts the routes when it arrives', late === 4)

  console.log = () => {}
  let bad = false
  try { door.apply({ get: () => { throw new Error('boom') }, effect: () => { throw new Error('boom') }, inject: () => { throw new Error('boom') } }) } catch (e) { bad = true }
  try { door.apply(undefined) } catch (e) { bad = true }
  console.log = realLog
  ok('apply never throws, whatever the host gives it (a bundle must not stop DSH from starting)', bad === false)
  ok('dshHome follows DSH_HOME, with ~ expanded', door.dshHome({ DSH_HOME: '~/x' }, () => '/home/u') === '/home/u/x' && door.dshHome({}, () => '/home/u') === '/home/u/.dsh' && door.dshHome({ DSH_HOME: '  ' }, () => '/h') === '/h/.dsh')
}

console.log('the stop module')
{
  // The facade's stop goes through the engine's own controller: the task's session and the sub-agent sessions below it, nothing else.
  const cancelled = []
  const engine = {
    sessionController: {
      create: async () => ({ ok: true, value: { sessionId: 's1' } }),
      prompt: async () => ({ ok: true }),
      state: async () => ({ ok: true, value: { running: true, queue: [], pendingInput: [] } }),
      cancel: async ({ sessionId }) => { cancelled.push(sessionId); return { ok: true } },
    },
    sessions: { list: () => [{ id: 'c1', header: { parentSession: 's1' } }, { id: 'c2', header: { parentSession: 'c1' } }, { id: 'x1', header: { parentSession: 'another-task' } }] },
  }
  const facade = door.sessionsFacade((svc) => engine[svc])()
  const r = await facade.stop('s1')
  ok('the facade stops the session and its sub-agents, not another task\'s', r.ok === true && r.stopped === 3 && cancelled.sort().join() === 'c1,c2,s1', JSON.stringify([r, cancelled]))
  ok('a session id that is not one is refused before anything is cancelled', (await facade.stop('../x')).ok === false && cancelled.length === 3)
}
ok('the door\'s stop.mjs is byte for byte the cloud bundle\'s turn-stop.mjs (a bundle is self-contained, so it is a copy)', readFileSync(new URL('./stop.mjs', import.meta.url), 'utf8') === readFileSync(new URL('../kybernos-cloud/turn-stop.mjs', import.meta.url), 'utf8'))

console.log('the setup script')
{
  const script = fileURLToPath(new URL('../../scripts/door-local.mjs', import.meta.url))
  const env = { ...process.env, DSH_HOME: join(TMP, 'script-home') }
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { env, encoding: 'utf8' })
  const none = run()
  ok('with no token yet it says what to do and exits 1', none.status === 1 && has(none.stderr, /switch the "Kaby MCP" plugin on/))
  const t = createToken({ file: () => join(env.DSH_HOME, 'kybernos', 'door', 'token') })
  const made = t.ensure()
  const shown = run('--port', '3099')
  ok('it prints the connect command with the url, the header and the token', shown.status === 0 && has(shown.stdout, /^claude mcp add --scope user --transport http kaby http:\/\/127\.0\.0\.1:3099\/kybernos-door\/mcp --header "Authorization: Bearer kbd_[0-9a-f]{48}"/) && shown.stdout.includes(made))
  const rotated = run('--rotate')
  ok('--rotate replaces the token and the old one is not printed', rotated.status === 0 && !rotated.stdout.includes(made) && t.current() !== made && rotated.stdout.includes(t.current()))
  ok('a bad port is refused', run('--port', 'x').status === 2)
  const down = run('--check', '--port', '1')
  ok('--check says the door cannot be reached and never prints the token', down.status === 1 && has(down.stderr, /Could not reach/) && !(down.stdout + down.stderr).includes(t.current()))
}

rmSync(TMP, { recursive: true, force: true })
console.log(failed === 0 ? '\nALL OK' : '\n' + failed + ' FAILED')
process.exit(failed === 0 ? 0 : 1)
