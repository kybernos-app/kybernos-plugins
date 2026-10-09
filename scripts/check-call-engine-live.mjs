#!/usr/bin/env node
// The one-click install of the call engine, for real, on a sandbox instance: the host runs uv (or a Python) to make the worker's
// environment under the sandbox's own DSH_HOME, and the health check then finds it whole.
//
//   source scripts/sandbox/env.sh && UV_CACHE_DIR=~/.cache/uv node scripts/check-call-engine-live.mjs
//
// It needs a sandbox instance that LOADS @local/kybernos-call and refuses the user's own DSH (exit 3). It downloads packages
// (a few minutes the first time; seconds with a warm uv cache: start the sandbox with UV_CACHE_DIR and UV_PYTHON_INSTALL_DIR
// pointing at the real ones). Nothing outside the sandbox's folder is written.
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const host = process.env.KB_HOST || '127.0.0.1:3080'
const dshHome = process.env.DSH_HOME
if (host === '127.0.0.1:3080' || !dshHome) { console.error('○ inconclusive: this check needs a sandbox instance (KB_HOST and DSH_HOME of scripts/sandbox/env.sh), not the one on :3080.'); process.exit(3) }
const base = 'http://' + host
let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const post = async (path, body) => { const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(body ?? {}) }); return { status: r.status, body: await r.json() } }

console.log('the call engine, installed from the host')
const venv = join(dshHome, 'kybernos', 'appel-venv', 'bin', 'python')
check('the sandbox starts without an environment', existsSync(venv) === false)
const before = await post('/kybernos-call/engine', { action: 'status' })
check('the installer says it is idle and nothing is installed', before.body.ok === true && before.body.state === 'idle' && before.body.installed === false, before.body)
const started = await post('/kybernos-call/engine', { action: 'install' })
check('starting the install answers at once, running', started.status === 200 && started.body.state === 'running', started.body)
let last = started.body
const deadline = Date.now() + 12 * 60 * 1000
while (Date.now() < deadline && last.state === 'running') { await sleep(2500); last = (await post('/kybernos-call/engine', { action: 'status' })).body }
check('it ends by itself, done', last.state === 'done', last)
check('the environment is there', existsSync(venv) === true)
const health = await post('/kybernos-call/health', {})
const engine = health.body.checks && health.body.checks.find((c) => c.id === 'engine')
check('and the health check finds it whole (the worker\'s packages import)', engine && engine.status === 'ok' && ['installed', 'running'].includes(engine.code), engine)
const again = await post('/kybernos-call/engine', { action: 'install' })
check('installing again repairs in place: it is accepted and ends done too', again.status === 200)
let l2 = again.body
const d2 = Date.now() + 5 * 60 * 1000
while (Date.now() < d2 && l2.state === 'running') { await sleep(2000); l2 = (await post('/kybernos-call/engine', { action: 'status' })).body }
check('with the environment still there', l2.state === 'done' && existsSync(venv) === true, l2)
console.log('\n' + (fail === 0 ? '✓' : '✗') + ' kybernos-call engine live: ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
