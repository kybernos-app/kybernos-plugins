// kybernos-call: installing the call engine (the listening worker's Python environment) from the settings, in one click.
//
// What a person would type in a terminal is run for them: a virtual environment under $DSH_HOME/kybernos/appel-venv, then the
// worker's packages (agent/requirements.txt). The tool is `uv` when the machine has it (it also fetches a Python when needed),
// else a Python of this machine, else the install says what is missing and does nothing.
//
// It runs as one detached shell command, so it survives a restart of DSH, and it tells how it is going through markers in its
// own log (kybernos/logs/engine-install.log): `__KB_STEP__ <name>`, `__KB_DONE__`, `__KB_FAIL__ <code>`. The state is read back
// from that log and from whether the process is still alive: nothing is kept in memory.
import { spawn as nodeSpawn, execFile as nodeExecFile } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { dshHomeSync } from './dsh-home.mjs'

const q = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'"
const text = (e) => (e && e.message ? String(e.message) : String(e))
const NO_TOOL = 'No uv and no Python 3.10 or newer was found on this computer. Install uv (https://docs.astral.sh/uv/) and try again.'

export function createInstaller (deps = {}) {
  const env = deps.env ?? process.env
  const dshHome = deps.dshHome ?? (async () => dshHomeSync(env))
  const pluginDir = deps.pluginDir
  const spawn = deps.spawn ?? nodeSpawn
  const alive = deps.alive ?? ((pid) => { try { process.kill(pid, 0); return true } catch (e) { return false } })
  const home = deps.homedir ?? homedir()

  /** `uv` first (it can fetch a Python itself), else a Python 3.10+ that is already here. */
  const findTool = deps.findTool ?? (async () => {
    const dirs = String(env.PATH ?? '').split(delimiter).concat(['/opt/homebrew/bin', '/usr/local/bin', join(home, '.local', 'bin'), join(home, '.cargo', 'bin')])
    for (const d of dirs) if (d !== '' && existsSync(join(d, 'uv'))) return { kind: 'uv', path: join(d, 'uv') }
    const ok = (bin) => new Promise((resolve) => nodeExecFile(bin, ['-c', 'import sys; print(1 if sys.version_info >= (3, 10) else 0)'], { timeout: 8000 }, (e, out) => resolve(e === null && String(out).trim() === '1')))
    for (const bin of ['python3.12', 'python3.11', 'python3.10', 'python3']) {
      for (const d of dirs) if (d !== '' && existsSync(join(d, bin)) && await ok(join(d, bin))) return { kind: 'python', path: join(d, bin) }
    }
    return null
  })

  const paths = async () => {
    const h = await dshHome()
    if (typeof h !== 'string' || h.length === 0) throw new Error('DSH home not found')
    const dir = join(h, 'kybernos', 'logs')
    return { dir, log: join(dir, 'engine-install.log'), state: join(dir, 'engine-install.json'), venv: join(h, 'kybernos', 'appel-venv') }
  }
  const readJson = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch (e) { return null } }

  /** { installed, state: 'idle' | 'running' | 'done' | 'failed', step?, code?, last? }: read from the log and the process, never remembered. */
  const status = async () => {
    const f = await paths()
    const installed = existsSync(join(f.venv, 'bin', 'python'))
    const saved = readJson(f.state)
    if (saved === null) return { ok: true, installed, state: 'idle' }
    let log = ''
    try { log = readFileSync(f.log, 'utf8') } catch (e) { log = '' }
    const lines = log.split(/\r?\n/).filter((l) => l.trim() !== '')
    const last = lines.length > 0 ? lines[lines.length - 1].replace(/__KB_[A-Z]+__\s*/, '').slice(0, 160) : ''
    const steps = lines.filter((l) => l.startsWith('__KB_STEP__ '))
    const step = steps.length > 0 ? steps[steps.length - 1].slice('__KB_STEP__ '.length) : 'venv'
    if (lines.includes('__KB_DONE__')) return { ok: true, installed, state: 'done', step, last }
    const fail = lines.find((l) => l.startsWith('__KB_FAIL__'))
    if (fail !== undefined) return { ok: true, installed, state: 'failed', code: fail.slice('__KB_FAIL__'.length).trim() || 'install', step, last: lines.filter((l) => !l.startsWith('__KB_')).slice(-1)[0] ?? '' }
    if (typeof saved.pid === 'number' && alive(saved.pid)) return { ok: true, installed, state: 'running', step, last }
    return { ok: true, installed, state: 'failed', code: 'interrupted', step, last }
  }

  /** Starts the install (once: asking again while it runs just reports it). */
  const start = async () => {
    const f = await paths()
    const now = await status()
    if (now.state === 'running') return now
    if (pluginDir === undefined) return { ok: false, code: 'no-plugin', error: 'the plugin folder is unknown' }
    const tool = await findTool()
    if (tool === null) return { ok: false, code: 'no-tool', error: NO_TOOL }
    const req = join(pluginDir, 'agent', 'requirements.txt')
    if (!existsSync(req)) return { ok: false, code: 'no-requirements', error: 'agent/requirements.txt is missing from the plugin' }
    const py = join(f.venv, 'bin', 'python')
    // An environment that exists (a damaged one) is repaired in place, never thrown away and rebuilt.
    const makeVenv = existsSync(py) ? 'true' : (tool.kind === 'uv' ? `${q(tool.path)} venv ${q(f.venv)} --python 3.12` : `${q(tool.path)} -m venv ${q(f.venv)}`)
    const install = tool.kind === 'uv' ? `${q(tool.path)} pip install --python ${q(py)} -r ${q(req)}` : `${q(py)} -m pip install --upgrade pip && ${q(py)} -m pip install -r ${q(req)}`
    const script = `echo "__KB_STEP__ venv"; { ${makeVenv}; } && echo "__KB_STEP__ packages" && { ${install}; } && echo "__KB_DONE__" || echo "__KB_FAIL__ install"`
    mkdirSync(f.dir, { recursive: true })
    writeFileSync(f.log, '', { mode: 0o600 })
    const fd = openSync(f.log, 'a')
    try {
      const child = spawn('/bin/sh', ['-c', script], { detached: true, stdio: ['ignore', fd, fd], env: Object.assign({}, env, { UV_NO_PROGRESS: '1', NO_COLOR: '1', PIP_PROGRESS_BAR: 'off', PIP_DISABLE_PIP_VERSION_CHECK: '1' }) })
      try { child.unref() } catch (e) { /* nothing to detach from */ }
      writeFileSync(f.state, JSON.stringify({ pid: child.pid ?? null, startedAt: new Date().toISOString(), tool: tool.kind }) + '\n', { mode: 0o600 })
    } catch (e) { return { ok: false, code: 'spawn', error: text(e) } } finally { closeSync(fd) }
    return status()
  }

  return { status, start, findTool }
}
