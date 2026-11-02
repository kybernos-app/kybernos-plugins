#!/usr/bin/env node
// "One brain" end to end in a real DSH: do the session's own events reach the call that listens to them?
//
//   source scripts/sandbox/env.sh && node scripts/check-call-brain-live.mjs
//
// Needs a sandbox instance that LOADS @local/kybernos-call (scripts/sandbox/setup.sh + start.sh); refuses the
// user's own DSH (exit 3). Everything is fake except DSH itself:
//   · a fake LiveKit server (a local HTTP server that answers the agent dispatch) and a fake secrets file;
//   · a fake worker (a shell script standing in for the venv's python: it only says "registered worker");
//   · a real session of the sandbox, created and prompted through the plugin's own routes.
// What it proves: the host listens to `session/event` in the real engine, the call's room is fed with what that
// session does, the speech route hands it to the worker. The sandbox has no model, so the session cannot
// answer: what must come out is the turn's own events (a tool start, an error, the end of the turn) — whatever
// arrives is printed, and an assistant text, when there is one, is shown as such.
//
// SAFETY: it writes only under the sandbox's DSH_HOME (kybernos/livekit.env and kybernos/appel-venv), removes
// both when done, and stops its fake worker. The prompt it sends is "ping from the call check" to a session it
// just created in the sandbox. Exit code 0 / 1 / 3.
import { createServer } from 'node:http'
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage } from './live-page.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}
const host = process.env.KB_HOST || '127.0.0.1:3080'
const dshHome = process.env.DSH_HOME
if (host === '127.0.0.1:3080' || !dshHome) { console.error('○ inconclusive: this check needs a sandbox instance (KB_HOST, DSH_HOME and HOME of scripts/sandbox/env.sh), not the one on :3080.'); process.exit(3) }

const dispatches = []
const lk = createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => { dispatches.push({ url: req.url, body: Buffer.concat(chunks).toString('utf8') }); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}') })
})
await new Promise((resolve) => lk.listen(0, '127.0.0.1', resolve))

const envFile = join(dshHome, 'kybernos', 'livekit.env')
const venvDir = join(dshHome, 'kybernos', 'appel-venv')
if (existsSync(envFile) || existsSync(venvDir)) { console.error('○ inconclusive: the sandbox already has a call setup (' + envFile + ' or ' + venvDir + '); refusing to overwrite it.'); lk.close(); process.exit(3) }

const live = await openLivePage({ width: 1200, height: 800 }).catch((e) => { console.error('○ inconclusive: ' + e.message); lk.close(); process.exit(3) })
const { page } = live
const val = async (expr, ms) => (await page.evalJs(expr, ms)).val
let stopped = false
try {
  mkdirSync(join(venvDir, 'bin'), { recursive: true })
  writeFileSync(envFile, 'LIVEKIT_URL=ws://127.0.0.1:' + lk.address().port + '\nLIVEKIT_API_KEY=fakekey\nLIVEKIT_API_SECRET=' + 'f'.repeat(40) + '\n', { mode: 0o600 })
  writeFileSync(join(venvDir, 'bin', 'python'), '#!/bin/sh\necho "registered worker"\nsleep 120\n')
  chmodSync(join(venvDir, 'bin', 'python'), 0o755)

  const post = (path, body) => val(`fetch(${JSON.stringify(path)}, { method: 'POST', headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))`, 40000)

  console.log('a real session of the sandbox')
  const created = await val(`fetch('/api/session/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method: 'session/create', payload: { args: { request: {} } } }) }).then((r) => r.json())`, 20000)
  const sessionId = created && created.result && created.result.value ? created.result.value.sessionId : null
  check('DSH created a session', typeof sessionId === 'string' && /^session-/.test(sessionId), created)
  if (typeof sessionId !== 'string') throw new Error('no session: cannot go on')

  console.log('a call attached to it (fake LiveKit, fake worker)')
  const minted = await post('/kybernos-call/token', { sessionId, kyberId: null, roleId: 'm1', name: 'Alice', mode: 'voice', language: 'auto', identity: 'moi' })
  check('the host minted a token and started the worker', minted && minted.status === 200 && minted.body && minted.body.agent && minted.body.agent.running === true, minted)
  check('the worker was woken on the room (the fake LiveKit saw the dispatch)', dispatches.length === 1 && /CreateDispatch/.test(dispatches[0].url), dispatches)
  const sent = dispatches.length > 0 ? JSON.parse(dispatches[0].body) : {}
  const meta = sent.metadata ? JSON.parse(sent.metadata) : {}
  check('its identity travelled as dispatch metadata, with brain "session" (the host follows session events in this DSH)', meta.sessionId === sessionId && meta.brain === 'session' && meta.name === 'Alice', meta)
  const room = minted && minted.body ? minted.body.room : null

  console.log('the session works, the call hears about it')
  const heard = await post('/kybernos-call/utterance', { sessionId, text: 'ping from the call check' })
  check('what the call heard became a turn of the session (session/prompt accepted)', heard && heard.status === 200 && heard.body && heard.body.ok === true, heard)
  const got = []
  const end = Date.now() + 40000
  let after = 0
  while (Date.now() < end) {
    const r = await val(`fetch('/kybernos-call/speech?room=${room}&after=${after}&wait=5000').then(async (x) => ({ status: x.status, body: await x.json().catch(() => null) }))`, 20000)
    if (!r || r.status !== 200 || !r.body) { check('the speech route answers', false, r); break }
    for (const item of r.body.items) got.push(item)
    after = r.body.next
    if (got.some((i) => i.kind === 'end')) break
  }
  console.log('    items received by the call: ' + JSON.stringify(got.map((i) => i.kind === 'text' ? { kind: 'text', text: String(i.text).slice(0, 80) } : i)))
  check('the session\'s own events reached the call\'s room through the real engine (at least the end of the turn)', got.some((i) => i.kind === 'end'), got)
  check('the items come with a rising seq', got.every((i, n) => n === 0 || i.seq > got[n - 1].seq), got)

  const wrongRoom = await val(`fetch('/kybernos-call/speech?room=some-other-room&wait=0').then((x) => x.json())`, 10000)
  check('a room the host does not follow is "known: false"', wrongRoom && wrongRoom.known === false, wrongRoom)
} catch (e) {
  fail += 1
  console.log('  ✗ ' + (e && e.message ? e.message : e))
} finally {
  try { await val(`fetch('/kybernos-call/agent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'stop' }) }).then((r) => r.status)`, 10000); stopped = true } catch (e) { /* page gone */ }
  rmSync(envFile, { force: true })
  rmSync(venvDir, { recursive: true, force: true })
  await live.close()
  lk.close()
}
console.log('\n' + (fail === 0 ? '✓' : '✗') + ' kybernos-call brain live: ' + pass + ' passed, ' + fail + ' failed' + (stopped ? '' : ' (the fake worker may still run: pkill -f appel-venv)'))
process.exit(fail === 0 ? 0 : 1)
