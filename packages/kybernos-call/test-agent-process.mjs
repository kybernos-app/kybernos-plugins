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
import { createCall } from './call-host.mjs'

if (process.platform === 'win32') { console.log('kybernos-call process: skipped on Windows (pgrep / kill / shell script)'); process.exit(0) }

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const home = mkdtempSync(join(tmpdir(), 'kybernos-call-proc-'))
const secrets = 'LIVEKIT_URL=wss://lk.example.test\nLIVEKIT_API_KEY=APIkey\nLIVEKIT_API_SECRET=' + 'k'.repeat(40) + '\n'
mkdirSync(join(home, 'kybernos', 'appel-venv', 'bin'), { recursive: true })
writeFileSync(join(home, 'kybernos', 'livekit.env'), secrets)
// The fake worker: it announces itself, shows what it was given, then stays alive.
const fakePython = join(home, 'kybernos', 'appel-venv', 'bin', 'python')
writeFileSync(fakePython, '#!/bin/sh\necho "args: $@"\necho "session: [$KYBER_SESSION_ID]"\necho "registered worker"\nsleep 60\n')
chmodSync(fakePython, 0o755)
const log = join(home, 'kybernos', 'logs', 'appel-agent.log')

const dispatches = []
const call = createCall({
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

  const stopped = await call.agentStop()
  assert.equal(stopped.ok, true)
  assert.equal(typeof stopped.stopped, 'number')
  await sleep(300)
  assert.equal((await call.agentState()).running, false)
  ok('stop ends it')
} finally {
  if (pid !== null) { try { process.kill(pid) } catch (e) { /* already gone */ } }
  try { (await import('node:child_process')).execFileSync('pkill', ['-f', join(home, 'kybernos')]) } catch (e) { /* none left */ }
  rmSync(home, { recursive: true, force: true })
}
console.log('\nkybernos-call process: ' + pass + ' checks')
