// Handing a task to a cloud computer from a chat (computer-turn.mjs): the dispatch, the bounded wait, each refusal in words, the prompt section and the tool.
// Nothing leaves the machine: the server, the clock and the token are fakes.
import assert from 'node:assert/strict'
import { ANSWER_MAX, MAX_WAIT_MS, MISSION_MAX, POLL_MS, cloudComputerTaskTool, createComputerTurn, renderTargetPrompt, targetOf } from './computer-turn.mjs'

let passed = 0
const ok = (name) => { passed += 1; console.log('  ✓ ' + name) }

const COMPUTER = '3f0c2a52-8d2f-4a35-9c11-0a5e6f6a7b01'
const KYBER = 'kyby_abc123'
const THREAD = '7a6b5c4d-1111-4222-8333-444455556666'

/** A fake server and a fake clock: `routes` answers by `METHOD path-prefix`, `now` moves by the sleeps. */
const world = (routes, opts = {}) => {
  const calls = []
  let clock = 1_000_000
  let turns = 0
  const deps = {
    apiCall: async (path, options) => {
      calls.push({ path, method: options.method, token: options.token, body: options.body })
      for (const [key, answer] of Object.entries(routes)) {
        const [method, prefix] = key.split(' ')
        if (options.method === method && path.startsWith(prefix)) return typeof answer === 'function' ? answer(path, options, calls) : answer
      }
      return { status: 404, body: { error: 'not_found' } }
    },
    token: () => (opts.signedOut === true ? null : 'tok-secret'),
    target: () => (opts.target === undefined ? COMPUTER : opts.target),
    sleep: async (ms) => { clock += ms },
    now: () => clock,
    turnId: () => 'dshct_test' + String((turns += 1)),
  }
  return { calls, turn: createComputerTurn(deps), clock: () => clock }
}

const IDENTITY = { status: 200, body: { kyber_id: KYBER, thread_id: THREAD } }
const ACCEPTED = { status: 202, body: { job: { id: 'j1' }, thread_id: THREAD, message: { id: 41, position: 7, role: 'user' }, deduplicated: false } }

{
  // The happy path: the mission goes to the chosen computer, the answer is read after the person's message.
  let reads = 0
  const w = world({
    'GET /v1/me/kyby': IDENTITY,
    'POST /v1/kybers/': ACCEPTED,
    'GET /v1/threads/': () => { reads += 1; return reads < 3 ? { status: 200, body: { messages: [] } } : { status: 200, body: { messages: [{ role: 'assistant', content: 'Done: 3 files.', position: 8 }] } } },
  })
  const out = await w.turn.run({ mission: '  Count the files.  ' })
  assert.deepEqual(out, { ok: true, answer: 'Done: 3 files.' })
  const sent = w.calls.find((c) => c.method === 'POST')
  assert.equal(sent.path, '/v1/kybers/' + KYBER + '/threads/dispatch')
  assert.deepEqual(sent.body, { thread_id: THREAD, message: 'Count the files.', client_turn_id: 'dshct_test1', computer_id: COMPUTER })
  assert.equal(sent.token, 'tok-secret')
  assert.ok(w.calls.filter((c) => c.method === 'GET' && c.path.startsWith('/v1/threads/')).every((c) => c.path === '/v1/threads/' + THREAD + '/messages?after=7&limit=5'), 'the answer is read after the person\'s message')
  assert.equal(reads, 3, 'it asks again every few seconds until the answer is there')
  assert.equal(w.clock() - 1_000_000, 3 * POLL_MS, 'the wait is the polls, nothing else')
  ok('the mission goes to the chosen computer and the answer is read back after it')
}

{
  // Only the first answer after the message counts, and a long one is cut.
  const w = world({
    'GET /v1/me/kyby': IDENTITY, 'POST /v1/kybers/': ACCEPTED,
    'GET /v1/threads/': { status: 200, body: { messages: [{ role: 'user', content: 'x' }, { role: 'assistant', content: 'a'.repeat(ANSWER_MAX + 50) }] } },
  })
  const out = await w.turn.run({ mission: 'go' })
  assert.equal(out.ok, true)
  assert.equal(out.answer.length, ANSWER_MAX)
  ok('a long answer is cut, the first assistant message after the person\'s is the answer')
}

{
  // The wait is bounded: no answer means « still running », said so, with no second send.
  const w = world({ 'GET /v1/me/kyby': IDENTITY, 'POST /v1/kybers/': ACCEPTED, 'GET /v1/threads/': { status: 200, body: { messages: [] } } })
  const out = await w.turn.run({ mission: 'long job' })
  assert.equal(out.ok, false)
  assert.equal(out.error, 'toujours_en_cours')
  assert.equal(out.pending, true)
  assert.ok(/Kaby conversation/.test(out.hint) && /do not send the task again/.test(out.hint))
  assert.equal(w.calls.filter((c) => c.method === 'POST').length, 1, 'one dispatch only')
  assert.ok(w.clock() - 1_000_000 >= MAX_WAIT_MS && w.clock() - 1_000_000 <= MAX_WAIT_MS + POLL_MS, 'it gives up at the bound')
  ok('the wait is bounded and a task still running is said so, never sent twice')
}

{
  // Each refusal of the server is carried in words, the member's extra budget first.
  const cases = [
    [402, 'extra_cap_exhausted', /extra budget/],
    [402, 'insufficient_quota', /budget of this workspace is used up/],
    [403, 'feature_not_in_plan', /does not include running a task/],
    [409, 'computer_unavailable', /cannot take a task/],
    [409, 'turn_pending', /still busy/],
    [409, 'personal_workspace', /not offered in a personal workspace/],
    [429, 'rate_limited', /Too many tasks/],
    [500, 'weird_new_code', /weird_new_code/],
  ]
  for (const [status, code, words] of cases) {
    const w = world({ 'GET /v1/me/kyby': IDENTITY, 'POST /v1/kybers/': { status, body: { error: code } } })
    const out = await w.turn.run({ mission: 'go' })
    assert.equal(out.ok, false)
    assert.equal(out.error, code)
    assert.ok(words.test(out.hint), code + ': ' + out.hint)
    assert.equal(w.calls.filter((c) => c.method === 'GET' && c.path.startsWith('/v1/threads/')).length, 0, 'a refused task is not waited for')
  }
  const odd = world({ 'GET /v1/me/kyby': IDENTITY, 'POST /v1/kybers/': { status: 502, body: null } })
  assert.equal((await odd.turn.run({ mission: 'go' })).error, 'http_502', 'a body that is not JSON still gives a code')
  const evil = world({ 'GET /v1/me/kyby': IDENTITY, 'POST /v1/kybers/': { status: 400, body: { error: '<script>alert(1)</script>' } } })
  assert.equal((await evil.turn.run({ mission: 'go' })).error, 'http_400', 'a code that is not a word is never echoed')
  ok('every refusal of the server comes back in words (the member\'s extra budget included), and nothing odd is echoed')
}

{
  // What is checked before the network is touched.
  const none = world({}, { signedOut: true })
  assert.equal((await none.turn.run({ mission: 'go' })).error, 'compte_kybernos_non_connecte')
  const noComputer = world({}, { target: null })
  assert.equal((await noComputer.turn.run({ mission: 'go' })).error, 'aucun_ordinateur_choisi')
  const badTarget = world({}, { target: 'not-a-uuid' })
  assert.equal((await badTarget.turn.run({ mission: 'go' })).error, 'aucun_ordinateur_choisi')
  const empty = world({})
  assert.equal((await empty.turn.run({ mission: '   ' })).error, 'mission_vide')
  assert.equal((await empty.turn.run({})).error, 'mission_vide')
  assert.equal((await empty.turn.run({ mission: 'x'.repeat(MISSION_MAX + 1) })).error, 'mission_trop_longue')
  for (const w of [none, noComputer, badTarget, empty]) assert.equal(w.calls.length, 0, 'no call before the checks pass')
  const oldServer = world({ 'GET /v1/me/kyby': { status: 404, body: { error: 'not_found' } } })
  assert.equal((await oldServer.turn.run({ mission: 'go' })).error, 'assistant_indisponible')
  const noPos = world({ 'GET /v1/me/kyby': IDENTITY, 'POST /v1/kybers/': { status: 202, body: { message: {} } } })
  assert.equal((await noPos.turn.run({ mission: 'go' })).error, 'reponse_inattendue')
  ok('signed out, no computer, an empty or huge mission, an older server and an answer with no position are refused before or without a wait')
}

{
  // Kaby's conversation is read once and reused; a 404 on the dispatch makes the next call read it again.
  let identityReads = 0
  const w = world({
    'GET /v1/me/kyby': () => { identityReads += 1; return IDENTITY },
    'POST /v1/kybers/': ACCEPTED,
    'GET /v1/threads/': { status: 200, body: { messages: [{ role: 'assistant', content: 'ok' }] } },
  })
  await w.turn.run({ mission: 'one' })
  await w.turn.run({ mission: 'two' })
  assert.equal(identityReads, 1, 'the conversation is read once')
  ok('Kaby\'s conversation is read once and reused')
}

{
  // The tool: the model gives a mission and nothing else; it never names a computer.
  const w = world({ 'GET /v1/me/kyby': IDENTITY, 'POST /v1/kybers/': ACCEPTED, 'GET /v1/threads/': { status: 200, body: { messages: [{ role: 'assistant', content: 'All good' }] } } })
  const tool = cloudComputerTaskTool(w.turn, (text) => [{ type: 'text', text }])
  assert.equal(tool.name, 'cloud_computer_task')
  assert.deepEqual(Object.keys(tool.parameters.properties), ['mission'], 'the model chooses no computer')
  assert.equal(tool.parameters.additionalProperties, false)
  assert.deepEqual(tool.parameters.required, ['mission'])
  const value = await tool.execute({ mission: 'do it' })
  assert.deepEqual(tool.output.render({ mission: 'do it' }, value), [{ type: 'text', text: 'All good' }])
  const refused = { ok: false, error: 'extra_cap_exhausted', hint: 'The member\'s extra budget of this workspace is used up for this month: an owner or an admin can allow more.' }
  assert.ok(/did not answer: The member/.test(tool.output.render({}, refused)[0].text))
  assert.deepEqual(await tool.execute({}), { ok: false, error: 'mission_vide', hint: 'The mission is empty.' })
  ok('the tool takes a mission and nothing else, and renders both an answer and a refusal')
}

{
  // The choice on disk, and the prompt that follows it.
  assert.equal(targetOf(null), null)
  assert.equal(targetOf({ computer_id: 'nope' }), null)
  assert.deepEqual(targetOf({ computer_id: COMPUTER.toUpperCase(), name: '  Home' + String.fromCharCode(0x2028) + ' office  ' }), { computer_id: COMPUTER, name: 'Home office' })
  assert.equal(targetOf({ computer_id: COMPUTER, name: 'x'.repeat(200) }).name.length, 60)
  assert.equal(targetOf({ computer_id: COMPUTER, name: 5 }).name, '')
  assert.equal(renderTargetPrompt(null), '', 'no choice: no section, nothing changes in a chat')
  const text = renderTargetPrompt({ computer_id: COMPUTER, name: 'Home' })
  assert.ok(text.includes('“Home”') && text.includes('cloud_computer_task') && text.includes('do not send the task again') && text.includes('a budget is used up'))
  assert.ok(renderTargetPrompt({ computer_id: COMPUTER, name: '' }).includes('their cloud computer'))
  ok('the chosen computer is read safely from disk and told to the agent; no choice, no section')
}

console.log('\ncomputer-turn: ' + passed + ' groups of checks OK')
