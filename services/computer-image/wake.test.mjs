// What the runner and the reporter do about a request that never comes back because the machine was suspended while it was in flight. Measured on dev (2026-10-20): a message that woke a sleeping
// Home started its turn 18.8 s after it was queued, against 7 to 10 s on an awake one; the machine's own log, 12 s after the wake: « [runner] POST /v1/runner/claim could not be sent
// (TimeoutError) » and 1 s later the same for the reporter's heartbeat. A suspended machine's timers count only the time it ran, so a request whose timeout is 15 s keeps the loop blind for
// what is left of it after the wake. Real sockets: a platform that accepts a request and never answers is exactly what a poll in flight at the suspend becomes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let mode = 'blackhole'
const seen = []
const platform = createServer((req, res) => {
  seen.push({ path: req.url, connection: req.headers.connection, socket: req.socket.remotePort })
  if (mode === 'blackhole') return // the request was sent and nothing ever comes back
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ jobs: [] }))
})
await new Promise((resolve) => platform.listen(0, '127.0.0.1', resolve))

process.env.KYBERNOS_API = `http://127.0.0.1:${platform.address().port}`
process.env.KYBERNOS_COMPUTER_TOKEN = 'kyd_wake_test_token'
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'kb-wake-'))
process.env.KYBERNOS_RUNNER_CLAIM_TIMEOUT_MS = '200'
process.env.KYBERNOS_REPORT_BEAT_TIMEOUT_MS = '200'
const { claimOnce, CLAIM_TIMEOUT_MS } = await import('./runner.mjs')
const { call, HEARTBEAT_TIMEOUT_MS } = await import('./reporter.mjs')

test.after(() => { platform.closeAllConnections(); platform.close() })

test('an idle poll that never comes back is given up after its own short timeout, and the next one goes on a connection of its own', async () => {
  assert.equal(CLAIM_TIMEOUT_MS, 200)
  const state = { fresh: false }
  mode = 'blackhole'
  seen.length = 0
  const started = Date.now()
  const lost = await claimOnce(state)
  assert.equal(lost.status, 0)
  assert.ok(Date.now() - started < 2000, 'the stall is the poll\'s timeout, not the 15 s of every other call')
  assert.equal(state.fresh, true)

  mode = 'answer'
  const back = await claimOnce(state)
  assert.equal(back.status, 200)
  assert.equal(seen[1].connection, 'close', 'after a lost poll: a connection of its own')
  assert.notEqual(seen[1].socket, seen[0].socket, 'not the socket the lost poll used')
  assert.equal(state.fresh, false)

  await claimOnce(state)
  assert.notEqual(seen[2].connection, 'close', 'polls that work go back to keeping their connection')
})

test('the default idle-poll timeout is far below the 15 s of the other calls', async () => {
  // Read in a child process: this file sets the variable for its own tests.
  const { spawnSync } = await import('node:child_process')
  const out = spawnSync(process.execPath, ['-e', "process.env.KYBERNOS_API='http://127.0.0.1:1';process.env.DSH_HOME='/tmp';import('./runner.mjs').then(m=>console.log(m.CLAIM_TIMEOUT_MS))"], { cwd: new URL('.', import.meta.url).pathname, encoding: 'utf8', env: { PATH: process.env.PATH } })
  const ms = Number(out.stdout.trim())
  assert.ok(ms >= 1000 && ms <= 5000, `the idle poll\'s timeout is ${ms} ms`)
})

test('the reporter\'s beat is bounded the same way, and the call after a failed one goes on a connection of its own', async () => {
  assert.equal(HEARTBEAT_TIMEOUT_MS, 200)
  mode = 'blackhole'
  seen.length = 0
  const started = Date.now()
  const lost = await call('POST', '/v1/computer/heartbeat', {}, HEARTBEAT_TIMEOUT_MS)
  assert.equal(lost.status, 0)
  assert.ok(Date.now() - started < 2000)
  mode = 'answer'
  const back = await call('POST', '/v1/computer/heartbeat', {}, HEARTBEAT_TIMEOUT_MS)
  assert.equal(back.status, 200)
  assert.equal(seen[1].connection, 'close')
  assert.notEqual(seen[1].socket, seen[0].socket)
  await call('POST', '/v1/computer/heartbeat', {}, HEARTBEAT_TIMEOUT_MS)
  assert.notEqual(seen[2].connection, 'close')
})
