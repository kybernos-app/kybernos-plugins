// kybernos-call: the worker is started for real (a child process), with a fake interpreter.
//
// What the host promises: the worker's output lands in <DSH_HOME>/kybernos/logs/appel-agent.log
// (the host reads that file to know the worker REGISTERED before it wakes it), and the worker
// outlives the host. A fake "python" (a shell script) stands in for the venv's interpreter.
//
// Unix only (pgrep / kill, a shell script as interpreter).
//
//   node packages/kybernos-call/test-agent-process.mjs
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { agentPattern, createCall } from './call-host.mjs'

if (process.platform === 'win32') { console.log('SKIPPED: the kybernos-call worker process tests — Windows has no pgrep / kill / shell script'); process.exit(0) }

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const home = mkdtempSync(join(tmpdir(), 'kybernos-call-proc-'))
const secrets = 'LIVEKIT_URL=wss://lk.example.test\nLIVEKIT_API_KEY=APIkey\nLIVEKIT_API_SECRET=' + 'k'.repeat(40) + '\n'
mkdirSync(join(home, 'kybernos', 'appel-venv', 'bin'), { recursive: true })
writeFileSync(join(home, 'kybernos', 'livekit.env'), secrets)
// The fake worker: it announces itself, shows what it was given, then stays alive. Its one-run secret goes to a file the test reads (never to the log, as the real worker never prints it).
const fakePython = join(home, 'kybernos', 'appel-venv', 'bin', 'python')
const seenSecret = join(home, 'kybernos', 'secret-seen')
writeFileSync(fakePython, '#!/bin/sh\necho "args: $@"\necho "session: [$KYBER_SESSION_ID]"\necho "secret length: ${#KYBER_CALL_TOKEN}"\nprintf %s "$KYBER_CALL_TOKEN" > "$DSH_HOME/kybernos/secret-seen"\necho "registered worker"\nsleep 60\n')
chmodSync(fakePython, 0o755)
const log = join(home, 'kybernos', 'logs', 'appel-agent.log')

const dispatches = []
let call = createCall({
  env: Object.assign({}, process.env, { DSH_HOME: home }),
  dshHome: async () => home,
  fetch: async (url, init) => { dispatches.push(JSON.parse(init.body)); return { status: 200, text: async () => '{}' } }
})

let pid = null
try {
  console.log('kybernos-call: a real worker process')
  const t0 = Date.now()
  const m = await call.mint({ sessionId: 'session-aaaaaaaa', kyberId: 'team-1', room: 'room-proc' })
  const took = Date.now() - t0
  pid = m.agent && m.agent.pid ? m.agent.pid : null
  assert.equal(m.ok, true)
  assert.equal(m.agent.running, true)
  ok('the worker starts')

  assert.equal(existsSync(log), true, 'the log file exists')
  const text = readFileSync(log, 'utf8')
  assert.match(text, /registered worker/)
  assert.match(text, /args: .*agent\.py start/)
  assert.match(text, /session: \[\]/)
  ok('its output lands in the log file, with the subcommand "start", and the call\'s session is NOT in its environment')

  assert.equal(m.agent.ready, true)
  assert.ok(took < 8000, 'the call did not wait for the whole 12 s budget (took ' + took + ' ms)')
  ok('the host SAW it register (agent.ready) without waiting out its 12 s budget')
  assert.equal(m.agent.dispatched, true)
  assert.equal(dispatches.length, 1)
  assert.equal(JSON.parse(dispatches[0].metadata).sessionId, 'session-aaaaaaaa')
  ok('and then woke it on the room, with the session of THIS call as dispatch metadata')

  const state = await call.agentState()
  assert.equal(state.running, true)
  assert.equal(typeof state.pid, 'number')
  assert.match(state.last, /registered worker/)
  ok('agentState sees the process and the last line of its log')

  const second = await call.agentStart({ sessionId: 'session-bbbbbbbb' })
  assert.equal(second.already, true)
  ok('a second start while it runs does nothing (one worker)')

  // L3-03: the worker is started with a one-run secret in its environment; the host accepts it from a request header, for as long as that process runs.
  const secret = readFileSync(seenSecret, 'utf8')
  assert.match(secret, /^[0-9a-f]{64}$/)
  assert.match(readFileSync(log, 'utf8'), /secret length: 64/)
  assert.equal(readFileSync(log, 'utf8').includes(secret), false)
  assert.equal(call.workerAccepts({ headers: { 'x-kybernos-call-token': secret } }), true)
  assert.equal(call.workerAccepts({ headers: { 'x-kybernos-call-token': secret.replace(/.$/, (c) => (c === '0' ? '1' : '0')) } }), false)
  assert.equal(call.workerAccepts({ headers: {} }), false)
  ok('the real worker process receives a 64-character secret in its environment (not in its log), and the host accepts exactly that one')

  // A worker that outlived the host (a DSH restart) is a worker whose secret nobody here knows: the next host replaces it.
  const restartedHost = createCall({ env: Object.assign({}, process.env, { DSH_HOME: home }), dshHome: async () => home, fetch: async () => ({ status: 200, text: async () => '{}' }) })
  assert.equal(restartedHost.workerAccepts({ headers: { 'x-kybernos-call-token': secret } }), false)
  const replaced = await restartedHost.agentStart()
  assert.equal(replaced.started, true)
  await sleep(300)
  const secret2 = readFileSync(seenSecret, 'utf8')
  assert.match(secret2, /^[0-9a-f]{64}$/)
  assert.notEqual(secret2, secret)
  assert.equal(restartedHost.workerAccepts({ headers: { 'x-kybernos-call-token': secret2 } }), true)
  assert.equal(restartedHost.workerAccepts({ headers: { 'x-kybernos-call-token': secret } }), false)
  let oldAlive = true
  try { process.kill(pid, 0) } catch (e) { oldAlive = false }
  assert.equal(oldAlive, false, 'the worker of the previous host is gone')
  pid = replaced.pid
  ok('a worker this host did not start is replaced by a new process with a new secret (the old process is gone, its secret is refused)')
  call = restartedHost

  const stopped = await call.agentStop()
  assert.equal(stopped.ok, true)
  assert.equal(typeof stopped.stopped, 'number')
  await sleep(300)
  assert.equal((await call.agentState()).running, false)
  assert.equal(call.workerAccepts({ headers: { 'x-kybernos-call-token': readFileSync(seenSecret, 'utf8') } }), false)
  ok('stop ends it, and its secret is refused from then on')

  // T2-15 (2026-10-24): `pgrep -f <path>` also matched the `pgrep -f <path>` of an overlapping check, so two checks at once each saw the other, answered « already running » and no
  // worker started. With the pattern of `agentPattern` the checks see the worker and only the worker. Real pgrep, a real process whose command line holds a unique path.
  {
    const script = join(home, 'kyb (x)+y', 'agent', 'agent.py')
    const sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)', script], { stdio: 'ignore' })
    await sleep(300)
    const pgrep = (args) => new Promise((resolve) => execFile('pgrep', args, (error, stdout) => resolve(String(stdout || '').trim().split(/\s+/).filter((x) => x !== '').map(Number))))
    try {
      const alone = await Promise.all(Array.from({ length: 8 }, () => pgrep(['-f', agentPattern(script)])))
      assert.deepEqual(alone.map((pids) => pids.join(',')), Array.from({ length: 8 }, () => String(sleeper.pid)), 'eight overlapping checks each see the worker and nothing else')
      assert.deepEqual(await pgrep(['-f', agentPattern(join(home, 'no', 'such', 'agent.py'))]), [], 'and a worker that is not there is not found')
      const raw = await Promise.all(Array.from({ length: 8 }, () => pgrep(['-f', script])))
      ok('eight overlapping `pgrep` checks on a path with ( ) + each find exactly the worker (the raw path ' + (raw.some((pids) => pids.length > 1) ? 'also matched its siblings' : 'happened not to overlap this time') + ')')
    } finally { sleeper.kill() }
  }
} finally {
  if (pid !== null) { try { process.kill(pid) } catch (e) { /* already gone */ } }
  try { (await import('node:child_process')).execFileSync('pkill', ['-f', join(home, 'kybernos')]) } catch (e) { /* none left */ }
  rmSync(home, { recursive: true, force: true })
}
console.log('\nkybernos-call process: ' + pass + ' checks')
