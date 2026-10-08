// kybernos-call: the one-click install of the call engine (engine-install.mjs). A fake shell and a fake clock: nothing is installed.
//
//   node packages/kybernos-call/test-engine.mjs
import assert from 'node:assert/strict'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInstaller } from './engine-install.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const mk = (over = {}) => {
  const home = mkdtempSync(join(tmpdir(), 'kybernos-call-engine-'))
  const pluginDir = join(home, 'plugin with space and \'quote')
  mkdirSync(join(pluginDir, 'agent'), { recursive: true })
  writeFileSync(join(pluginDir, 'agent', 'requirements.txt'), 'livekit-agents==1.8.3\n')
  const spawned = []
  const state = { alive: true }
  const spawn = (cmd, args, opts) => { spawned.push({ cmd, args, opts }); return { pid: 4242, unref () {} } }
  const installer = createInstaller(Object.assign({ dshHome: async () => home, pluginDir, spawn, alive: () => state.alive, env: { PATH: '/nowhere' }, findTool: async () => ({ kind: 'uv', path: '/opt/homebrew/bin/uv' }) }, over))
  return { home, pluginDir, spawned, state, installer, log: join(home, 'kybernos', 'logs', 'engine-install.log'), venv: join(home, 'kybernos', 'appel-venv') }
}

console.log('kybernos-call: installing the call engine')
{
  const t = mk()
  assert.deepEqual(await t.installer.status(), { ok: true, installed: false, state: 'idle' })
  const r = await t.installer.start()
  assert.equal(r.state, 'running')
  assert.equal(t.spawned.length, 1)
  assert.equal(t.spawned[0].cmd, '/bin/sh')
  assert.equal(t.spawned[0].args[0], '-c')
  assert.equal(t.spawned[0].opts.detached, true)
  const script = t.spawned[0].args[1]
  assert.match(script, /^echo "__KB_STEP__ venv"; \{ '\/opt\/homebrew\/bin\/uv' venv '.*appel-venv' --python 3\.12; \}/)
  assert.match(script, /uv' pip install --python '.*appel-venv\/bin\/python' -r '.*requirements\.txt'/)
  assert.match(script, /echo "__KB_DONE__" \|\| echo "__KB_FAIL__ install"$/)
  assert.ok(script.includes("plugin with space and '\\''quote"), 'a path with a space and a quote is quoted, not broken')
  assert.equal(t.spawned[0].opts.env.UV_NO_PROGRESS, '1')
  ok('the install is one detached shell command: the environment, then the packages, with the paths quoted whatever they hold')

  assert.equal((await t.installer.start()).state, 'running')
  assert.equal(t.spawned.length, 1)
  ok('asking again while it runs only reports it: nothing is started twice')

  appendFileSync(t.log, '__KB_STEP__ packages\nDownloading onnxruntime\n')
  const mid = await t.installer.status()
  assert.equal(mid.state, 'running')
  assert.equal(mid.step, 'packages')
  assert.equal(mid.last, 'Downloading onnxruntime')
  ok('how far it is comes from its own log: the step and the last line')

  appendFileSync(t.log, '__KB_DONE__\n')
  t.state.alive = false
  assert.equal((await t.installer.status()).state, 'done')
  mkdirSync(join(t.venv, 'bin'), { recursive: true })
  writeFileSync(join(t.venv, 'bin', 'python'), '')
  assert.equal((await t.installer.status()).installed, true)
  ok('the end marker says it is done, and the environment is then there')
}
{
  const t = mk()
  await t.installer.start()
  appendFileSync(t.log, 'error: no matching distribution\n__KB_FAIL__ install\n')
  t.state.alive = false
  const s = await t.installer.status()
  assert.equal(s.state, 'failed')
  assert.equal(s.code, 'install')
  assert.equal(s.last, 'error: no matching distribution')
  ok('a failure keeps its marker and the line before it, which is the reason')
}
{
  const t = mk()
  await t.installer.start()
  t.state.alive = false
  const s = await t.installer.status()
  assert.equal(s.state, 'failed')
  assert.equal(s.code, 'interrupted')
  await t.installer.start()
  assert.equal(t.spawned.length, 2)
  ok('an install whose process is gone without an end marker is reported as interrupted, and can be started again')
}
{
  const t = mk({ findTool: async () => null })
  const r = await t.installer.start()
  assert.equal(r.ok, false)
  assert.equal(r.code, 'no-tool')
  assert.match(r.error, /uv/)
  assert.equal(t.spawned.length, 0)
  ok('with no uv and no Python 3.10+, it says so and starts nothing')
}
{
  const t = mk({ findTool: async () => ({ kind: 'python', path: '/usr/local/bin/python3.12' }) })
  await t.installer.start()
  const script = t.spawned[0].args[1]
  assert.match(script, /'\/usr\/local\/bin\/python3\.12' -m venv '.*appel-venv'/)
  assert.match(script, /python' -m pip install --upgrade pip && '.*python' -m pip install -r '.*requirements\.txt'/)
  ok('with only a Python, it makes the environment and installs with pip')
}
{
  const t = mk()
  mkdirSync(join(t.venv, 'bin'), { recursive: true })
  writeFileSync(join(t.venv, 'bin', 'python'), '')
  await t.installer.start()
  const script = t.spawned[0].args[1]
  assert.match(script, /^echo "__KB_STEP__ venv"; \{ true; \} && /)
  assert.equal(script.includes(' venv '), false)
  ok('a damaged environment that exists is repaired in place: the packages are installed again, nothing is deleted or rebuilt')
}
{
  const t = mk({ pluginDir: undefined })
  assert.equal((await t.installer.start()).code, 'no-plugin')
  const u = mk()
  writeFileSync(join(u.pluginDir, 'agent', 'requirements.txt'), '')
  // an empty file is still a file: only a missing one is refused
  assert.equal((await u.installer.start()).state, 'running')
  assert.equal(existsSync(join(u.pluginDir, 'agent', 'requirements.txt')), true)
  ok('without the plugin folder it refuses; the requirements are read from the plugin itself')
}
console.log('\nkybernos-call engine: ' + pass + ' checks')
