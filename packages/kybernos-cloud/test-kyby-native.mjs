// Kaby as a native DSH conversation (kyby-native.mjs): which session it is, who Kaby is there, and the end of a turn written on the
// person's thread. A fake DSH agent and a fake server; no network, no real DSH home.
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { contextLines, createKybyNative, isSessionId, kybyPrompt, lastTurn, readPointer, writePointer } from './kyby-native.mjs'

let fail = 0
const ok = (name, cond, detail) => { console.log((cond ? 'ok   ' : 'FAIL ') + name + (cond ? '' : '  ' + JSON.stringify(detail))); if (!cond) fail++ }

const SID = 'session-0f1e2d3c-aaaa-bbbb-cccc-ddddeeeeffff'
const OTHER = 'session-99999999-aaaa-bbbb-cccc-ddddeeeeffff'
const TOKEN = 'kys-secret-token-never-in-any-output'
const KYBER = 'kg766524afbe0e'
const THREAD = '01a1414e-b730-7ad4-a0b4-93d9e2a4cf3e'
const dir = mkdtempSync(join(tmpdir(), 'kyby-native-'))
const file = join(dir, 'kybernos-kyby.json')

// ── the pointer file ─────────────────────────────────────────────────────────
ok('an absent or damaged pointer reads as none', readPointer(file) === null && (() => { writeFileSync(file, '{oops'); return readPointer(file) === null })())
ok('a session id is written, privately, and read back', writePointer(file, SID).ok === true && readPointer(file) === SID && (statSync(file).mode & 0o077) === 0)
ok('an odd id is refused and nothing is written', writePointer(file, '../../etc/passwd').ok === false && readPointer(file) === SID)
ok('null clears the pointer', writePointer(file, null).ok === true && readPointer(file) === null)
ok('what is a session id', isSessionId(SID) && !isSessionId('a b') && !isSessionId('') && !isSessionId(42) && !isSessionId('x'.repeat(200)))
writePointer(file, SID)

// ── the words of a turn ──────────────────────────────────────────────────────
{
  const msgs = [
    { role: 'user', content: [{ type: 'text', text: 'Bonjour' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'Salut !' }] },
    { role: 'user', content: [{ type: 'text', text: '[KYBERNOS MEMORY]\n- vit à Paris\nmemory_search pour en chercher.\nFais-moi un plan' }, { type: 'image', url: 'x' }] },
    { role: 'assistant', content: [{ type: 'thinking', text: 'hmm' }, { type: 'text', text: 'Voici un plan.' }, { type: 'text', text: 'Bonne semaine.' }] },
  ]
  const t = lastTurn(msgs)
  ok('the last words of the person, without the memory block', t.user === 'Fais-moi un plan', t)
  ok('the last words of the assistant, text blocks only', t.assistant === 'Voici un plan.\nBonne semaine.', t)
  ok('a turn with no assistant words yields nothing to keep', lastTurn([{ role: 'user', content: 'x' }]).assistant === '')
  ok('a string content is read too', lastTurn([{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' }]).user === 'hello')
}
{
  const lines = contextLines([
    { role: 'user', content: 'Rappelle-moi le dentiste' }, { role: 'assistant', content: 'C\'est noté pour demain.' },
    { role: 'user', content: 'ce que j\'ai écrit ici' }, { role: 'system', content: 'x' }, { role: 'assistant' },
  ], new Set(['ce que j\'ai écrit ici']))
  ok('context lines: roles named, the chat\'s own words left out, odd rows dropped', lines.length === 2 && lines[0] === 'Person: Rappelle-moi le dentiste' && lines[1] === 'Kaby: C\'est noté pour demain.', lines)
  const long = contextLines([{ role: 'user', content: 'x'.repeat(1000) }])
  ok('a long line is cut', long[0].length <= 'Person: '.length + 240)
  ok('only the last few lines are kept', contextLines(Array.from({ length: 30 }, (_, i) => ({ role: 'user', content: 'm' + i }))).length === 8)
}
ok('the prompt names Kaby, the shared memory and Telegram, and carries the lines', (() => {
  const p = kybyPrompt(['Person: salut'])
  return p.startsWith('[KYBY]') && p.endsWith('[/KYBY]') && /Kaby/.test(p) && /Telegram/.test(p) && /Person: salut/.test(p)
})())

// ── the hooks ────────────────────────────────────────────────────────────────
const make = (answers, state = { token: TOKEN }) => {
  const calls = []
  let clock = 1_000_000
  const apiCall = async (path, o = {}) => {
    calls.push({ path, method: o.method || 'GET', token: o.token, body: o.body })
    const a = answers[(o.method || 'GET') + ' ' + path.split('?')[0]]
    return typeof a === 'function' ? a(path, o) : (a || { status: 404, body: { error: 'not_found' } })
  }
  const n = createKybyNative({ pointerFile: file, readState: () => state, isConnected: (s) => s !== null && typeof s.token === 'string' && s.token !== '', apiCall, now: () => clock })
  return { n, calls, tick: (ms) => { clock += ms } }
}
const agent = (sid, messages) => ({ session: { id: sid, deriveMessages: () => messages } })
const TURN = [{ role: 'user', content: [{ type: 'text', text: 'Fais-moi un plan' }] }, { role: 'assistant', content: [{ type: 'text', text: 'Voici un plan.' }] }]
const SERVER = {
  'GET /v1/me/kyby': { status: 200, body: { kyber_id: KYBER, thread_id: THREAD, workspace_id: THREAD, model: 'glm' } },
  ['POST /v1/threads/' + THREAD + '/messages']: (p, o) => ({ status: 201, body: { thread_id: THREAD, messages: [], deduplicated: false } }),
  ['GET /v1/threads/' + THREAD + '/messages']: { status: 200, body: { thread_id: THREAD, messages: [{ role: 'user', content: 'Je pars en voyage lundi' }, { role: 'assistant', content: 'Bon voyage !' }], total: 2, has_older: false, has_newer: false } },
}
{
  const { n } = make({})
  ok('only Kaby\'s own session gets the identity block', n.promptFor(SID).startsWith('[KYBY]') && n.promptFor(OTHER) === '' && n.promptFor(undefined) === '')
  ok('isKyby follows the pointer', n.isKyby(SID) && !n.isKyby(OTHER))
}
{
  const { n, calls } = make(SERVER)
  ok('a turn of another session is not written anywhere', (await n.mirrorTurn(agent(OTHER, TURN))) === 'not_kyby' && calls.length === 0)
  ok('an aborted turn is not written', (await n.mirrorTurn(agent(SID, TURN), { aborted: true })) === 'aborted' && calls.length === 0)
  ok('a turn with no answer is not written', (await n.mirrorTurn(agent(SID, [TURN[0]]))) === 'nothing')
  const r = await n.mirrorTurn(agent(SID, TURN))
  const post = calls.find((c) => c.method === 'POST')
  ok('the end of a turn goes on the person\'s thread, with the device\'s token and an idempotent id', r === 'mirrored' && post !== undefined && post.token === TOKEN && post.body.user_message === 'Fais-moi un plan' && post.body.assistant_message === 'Voici un plan.' && /^kybydsh_[A-Za-z0-9]{1,12}_\d+$/.test(post.body.client_turn_id), { r, post })
  ok('the thread\'s identity is asked once, not at every turn', calls.filter((c) => c.path === '/v1/me/kyby').length === 1 && (await n.mirrorTurn(agent(SID, TURN.concat(TURN)))) === 'mirrored' && calls.filter((c) => c.path === '/v1/me/kyby').length === 1)
}
{
  const { n, calls } = make({}, null)
  ok('signed out: nothing is called', (await n.mirrorTurn(agent(SID, TURN))) === 'signed_out' && calls.length === 0)
}
{
  const { n, calls, tick } = make({})
  ok('a server with no Kaby thread (older) is said once, then left alone', (await n.mirrorTurn(agent(SID, TURN))) === 'no_thread' && (await n.mirrorTurn(agent(SID, TURN))) === 'no_thread' && calls.length === 1)
  tick(11 * 60 * 1000)
  await n.mirrorTurn(agent(SID, TURN))
  ok('and asked again after a while', calls.length === 2)
}
{
  const { n } = make({ ...SERVER, ['POST /v1/threads/' + THREAD + '/messages']: { status: 409, body: { error: 'thread_full' } } })
  ok('a refusal of the thread never breaks the turn', (await n.mirrorTurn(agent(SID, TURN))) === 'refused')
  const boom = { session: { id: SID, deriveMessages: () => { throw new Error('boom') } } }
  ok('a broken agent never throws into DSH', (await n.mirrorTurn(boom)) === 'error')
}
{
  const { n, calls } = make(SERVER)
  n.noteClaim(SID)
  await new Promise((r) => setTimeout(r, 30))
  const p = n.promptFor(SID)
  ok('after a claim the shared thread\'s last words are in the prompt', /Person: Je pars en voyage lundi/.test(p) && /Kaby: Bon voyage !/.test(p), p)
  ok('a message of another session does not read the thread', (n.noteClaim(OTHER), calls.length === 2))
  ok('no token ever reaches the prompt', !p.includes(TOKEN))
}
{
  // what this chat wrote itself is not told back as « lately said elsewhere »
  const { n } = make(SERVER)
  await n.mirrorTurn(agent(SID, [{ role: 'user', content: 'Je pars en voyage lundi' }, { role: 'assistant', content: 'Bon voyage !' }]))
  n.noteClaim(SID)
  await new Promise((r) => setTimeout(r, 30))
  ok('the words this chat mirrored are left out of its own context', !/Je pars en voyage lundi/.test(n.promptFor(SID)))
}

console.log(fail === 0 ? '\nall good' : '\n' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
