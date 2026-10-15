// The Kaby routes (kyby.mjs) against a fake server: what the page may rely on, what a refusal is called, and what never leaves.
import { createKybyRoutes, codeOf, pairingOf, pairingStateOf } from './kyby.mjs'

let fail = 0
const ok = (name, cond, detail) => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  ' + JSON.stringify(detail))); if (!cond) fail++ }

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

// ── the computer linked to the assistant, and unlink ───────────────────────────
{
  const C1 = '44444444-4444-4444-8444-444444444444'
  const { r, calls } = make({ 'PUT /v1/me/kyby/computer': (p, o) => ({ status: 200, body: { computer_id: o.body.computer_id } }), 'DELETE /v1/me/telegram': { status: 200, body: { unlinked: true } } })
  ok('computer: an id is sent to the server and echoed', (await r.computer(null, { computer_id: C1 })).computer_id === C1 && calls[0].body.computer_id === C1 && calls[0].token === TOKEN)
  ok('computer: null goes back to the default', (await r.computer(null, { computer_id: null })).computer_id === null)
  ok('computer: anything that is not an id is refused before a call', (await r.computer(null, { computer_id: '../x' })).error === 'invalid_request' && (await r.computer(null, {})).error === 'invalid_request' && calls.length === 2)
  ok('unlink', (await r.unlink()).ok === true)
  const old = make({ 'PUT /v1/me/kyby/computer': { status: 404, body: { error: 'not_found' } } })
  ok('computer: a server that does not know the route says not_found', (await old.r.computer(null, { computer_id: C1 })).error === 'not_found')
  const nope = make({ 'PUT /v1/me/kyby/computer': { status: 404, body: { error: 'computer_not_found' } } })
  ok('computer: a computer that is not the person\'s is said in a word', (await nope.r.computer(null, { computer_id: C1 })).error === 'computer_not_found')
}

console.log(fail === 0 ? '\nall good' : '\n' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
