// The Kyby routes (kyby.mjs) against a fake server: what the page may rely on, what a refusal is called, and what never leaves.
import { createKybyRoutes, codeOf, messagesOf, pairingOf, pairingStateOf } from './kyby.mjs'

let fail = 0
const ok = (name, cond, detail) => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  ' + JSON.stringify(detail))); if (!cond) fail++ }

const KYBER = '11111111-1111-4111-8111-111111111111'
const THREAD = '22222222-2222-4222-8222-222222222222'
const PAIR = '33333333-3333-4333-8333-333333333333'
const LINK = 'https://t.me/kybernos_bot?start=pair_abcdefghij0123456789wxyz'
const TOKEN = 'kys-secret-token-never-returned'

const make = (answers, state = { token: TOKEN }) => {
  const calls = []
  const apiCall = async (path, o = {}) => {
    calls.push({ path, method: o.method || 'GET', token: o.token, body: o.body })
    const key = (o.method || 'GET') + ' ' + path.split('?')[0]
    const a = answers[key]
    return typeof a === 'function' ? a(path, o) : (a || { status: 404, body: { error: 'not_found' } })
  }
  const r = createKybyRoutes({ readState: () => state, isConnected: (s) => s !== null && typeof s.token === 'string' && s.token !== '', apiCall, deviceLabel: () => 'DSH testbox' })
  return { r, calls }
}
const req = (url) => ({ url })

// ── codes: words only ────────────────────────────────────────────────────────
ok('a network failure is unreachable', codeOf({ status: 0 }) === 'unreachable')
ok('a 401 is not_connected', codeOf({ status: 401, body: null }) === 'not_connected')
ok('a known code passes', codeOf({ status: 409, body: { error: 'already_linked' } }) === 'already_linked' && codeOf({ status: 409, body: { error: { code: 'turn_pending' } } }) === 'turn_pending')
ok('an unknown code, or text, becomes refused (the server\'s words never reach the page)', codeOf({ status: 400, body: { error: 'SELECT * FROM users', message: 'x' } }) === 'refused')

// ── shapes ───────────────────────────────────────────────────────────────────
ok('a message row keeps position, role, words, time; an odd one is dropped', (() => {
  const m = messagesOf([
    { position: 2, role: 'assistant', content: 'b', created_at: '2026-10-15T10:00:01Z', crew_meta: { source: 'telegram' } },
    { position: 1, role: 'user', content: 'a', created_at: '2026-10-15T10:00:00Z', crew_meta: null },
    { position: 3, role: 'system', content: 'x' }, { position: 'x', role: 'user', content: 'y' }, null, { role: 'user' },
  ])
  return m.length === 2 && m[0].position === 1 && m[1].via === 'telegram' && m[0].via === null
})())
ok('a pairing is drawn only for the bot\'s own t.me start link', pairingOf({ id: PAIR, link: LINK, expires_at: 'x' }) !== null && pairingOf({ id: PAIR, link: 'https://evil.example/?start=pair_abcdefgh' }) === null && pairingOf({ id: PAIR, link: 'https://t.me/kybernos_bot?start=pair_abc' }) === null && pairingOf({ id: 'nope', link: LINK }) === null)
ok('a pairing state outside the five is dropped, a reason outside the three is null', pairingStateOf({ state: 'weird' }) === null && pairingStateOf({ state: 'declined', reason: 'taken' }).reason === 'taken' && pairingStateOf({ state: 'declined', reason: 'sql' }).reason === null)

// ── pairing ──────────────────────────────────────────────────────────────────
{
  const { r, calls } = make({ 'POST /v1/me/telegram/pairing': { status: 201, body: { id: PAIR, link: LINK, expires_at: '2026-10-15T20:05:00Z', bot_username: 'kybernos_bot' } } })
  const out = await r.pairingStart()
  ok('start: id, link, expiry and a real QR of that link', out.ok === true && out.id === PAIR && out.link === LINK && out.qr !== null && out.qr.size >= 21 && out.qr.modules.length === out.qr.size && /^[01]+$/.test(out.qr.modules[0]), out)
  ok('start: the device label goes with the call, the token only as a header field of apiCall', calls[0].body.device_label === 'DSH testbox' && calls[0].token === TOKEN)
  ok('start: the answer carries no token', !JSON.stringify(out).includes(TOKEN))
}
{
  const { r } = make({ 'POST /v1/me/telegram/pairing': { status: 409, body: { error: 'already_linked' } } })
  ok('start: already linked is said in a word', (await r.pairingStart()).error === 'already_linked')
  const off = make({ 'POST /v1/me/telegram/pairing': { status: 404, body: { error: 'not_found' } } })
  ok('start: a door that is off is not_found', (await off.r.pairingStart()).error === 'not_found')
  const bad = make({ 'POST /v1/me/telegram/pairing': { status: 201, body: { id: PAIR, link: 'https://evil.example/x' } } })
  ok('start: a link that is not the bot\'s is refused, nothing is drawn', (await bad.r.pairingStart()).ok === false)
  const out = make({}, null)
  ok('start: signed out is not_connected and no call is made', (await out.r.pairingStart()).error === 'not_connected' && out.calls.length === 0)
}
{
  const { r, calls } = make({ 'GET /v1/me/telegram/pairing': { status: 200, body: { state: 'scanned', sender: 'Miled (@milede)', expires_at: 'x' } } })
  const s = await r.pairingState(req('/kybernos-cloud/telegram/pairing/state?id=' + PAIR))
  ok('state: scanned with the sender named', s.ok === true && s.state === 'scanned' && s.sender === 'Miled (@milede)', s)
  ok('state: the id is validated before any call', (await r.pairingState(req('/x?id=../../etc'))).error === 'invalid_request' && calls.length === 1)
  const done = make({ 'GET /v1/me/telegram/pairing': { status: 200, body: { state: 'declined', reason: 'botmade' } } })
  ok('state: declined with its reason', (await done.r.pairingState(req('/x?id=' + PAIR))).reason === 'botmade')
}
{
  const { r, calls } = make({ 'DELETE /v1/me/telegram/pairing': { status: 200, body: { cancelled: true } } })
  ok('cancel: the id goes in the query', (await r.pairingCancel(null, { id: PAIR })).ok === true && calls[0].path === '/v1/me/telegram/pairing?id=' + PAIR)
  ok('cancel: a bad id is refused', (await r.pairingCancel(null, { id: 'x' })).error === 'invalid_request')
}

// ── settings and unlink ──────────────────────────────────────────────────────
{
  const { r, calls } = make({ 'PUT /v1/me/telegram/settings': (p, o) => ({ status: 200, body: { home_target: o.body.home_target } }), 'DELETE /v1/me/telegram': { status: 200, body: { unlinked: true } } })
  ok('settings: cloud and ask pass', (await r.settings(null, { home_target: 'ask' })).home_target === 'ask' && (await r.settings(null, { home_target: 'cloud' })).home_target === 'cloud')
  ok('settings: anything else is refused before a call', (await r.settings(null, { home_target: 'mac' })).error === 'invalid_request' && calls.length === 2)
  ok('unlink', (await r.unlink()).ok === true)
  const nl = make({ 'PUT /v1/me/telegram/settings': { status: 404, body: { error: 'not_linked' } } })
  ok('settings: not linked is said', (await nl.r.settings(null, { home_target: 'ask' })).error === 'not_linked')
}

// ── the conversation ─────────────────────────────────────────────────────────
{
  let kybyCalls = 0
  const answers = {
    'GET /v1/me/kyby': () => { kybyCalls++; return { status: 200, body: { kyber_id: KYBER, thread_id: THREAD, workspace_id: PAIR, model: 'glm-5.3-flash' } } },
    ['GET /v1/threads/' + THREAD + '/messages']: (p) => ({ status: 200, body: { thread_id: THREAD, messages: [{ position: 1, role: 'user', content: 'hi', created_at: 't', crew_meta: null }], total: 1, has_older: false, has_newer: false, seenPath: p } }),
    ['POST /v1/kybers/' + KYBER + '/threads/dispatch']: (p, o) => ({ status: 202, body: { job: {}, thread_id: THREAD, message: { position: 2, id: 9, role: 'user', content: o.body.message }, deduplicated: false } }),
  }
  const { r, calls } = make(answers)
  const c = await r.chat(req('/kybernos-cloud/kyby'))
  ok('chat: the thread, the model and the messages', c.ok === true && c.thread_id === THREAD && c.model === 'glm-5.3-flash' && c.messages.length === 1, c)
  const c2 = await r.chat(req('/kybernos-cloud/kyby?after=7'))
  ok('chat: after= asks the server for what came after, and the identity is not asked again', c2.ok === true && calls.some((x) => x.path.endsWith('&after=7')) && kybyCalls === 1)
  const s = await r.send(null, { message: 'bonjour', client_turn_id: 'kyby_abcdefgh1234' })
  ok('send: dispatched on the person\'s kyber and thread with the door\'s model', s.ok === true && s.position === 2 && calls.at(-1).body.thread_id === THREAD && calls.at(-1).body.model === 'glm-5.3-flash', s)
  ok('send: empty, too long or a bad turn id never reach the server', (await r.send(null, { message: '  ', client_turn_id: 'kyby_abcdefgh1234' })).error === 'invalid_request' && (await r.send(null, { message: 'x'.repeat(100001), client_turn_id: 'kyby_abcdefgh1234' })).error === 'invalid_request' && (await r.send(null, { message: 'x', client_turn_id: '../' })).error === 'invalid_request')
  const busy = make({ ...answers, ['POST /v1/kybers/' + KYBER + '/threads/dispatch']: { status: 409, body: { error: 'turn_pending' } } })
  ok('send: a turn still pending is said in a word', (await busy.r.send(null, { message: 'x', client_turn_id: 'kyby_abcdefgh1234' })).error === 'turn_pending')
  const quota = make({ ...answers, ['POST /v1/kybers/' + KYBER + '/threads/dispatch']: { status: 402, body: { error: 'insufficient_quota', message: 'Your balance is 0.0001' } } })
  const q = await quota.r.send(null, { message: 'x', client_turn_id: 'kyby_abcdefgh1234' })
  ok('send: a used-up allowance is said in a word, never in the server\'s text', q.error === 'insufficient_quota' && !JSON.stringify(q).includes('balance'))
}
{
  const nokyby = make({ 'GET /v1/me/kyby': { status: 404, body: { error: 'not_found' } } })
  ok('chat: no Kyby on this server is a refusal, not a crash', (await nokyby.r.chat(req('/x'))).ok === false)
}

console.log(fail === 0 ? '\nall good' : '\n' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
