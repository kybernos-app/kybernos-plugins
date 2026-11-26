// Starts, watches and stops the front-desk service (service/bin/front-desk.mjs) as a child process of the owner's machine.
//
// The service is a public face: it must not go down because DSH restarts. So the child is DETACHED (its output goes to a log file, not a pipe that
// would break), a pid file remembers it, and `start()` ADOPTS a service that is still answering with the owner token instead of starting a second one.
// It gets a hermetic environment (fd-config.mjs `childEnv`): none of the owner's DSH keys reach it. It only listens on 127.0.0.1.
// All I/O is injectable (spawn, fetch, process checks), so the whole life cycle is tested over fakes.

import { spawn as nodeSpawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'

const LOG_MAX = 512 * 1024
const START_WAIT_MS = 12_000
const STOP_WAIT_MS = 4000

const nap = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const lastLines = (text, n) => String(text).split('\n').filter((l) => l.trim() !== '').slice(-n)

/** 0 = let the OS choose. Tries the preferred port first, so a tunnel pointed at it keeps working across restarts. */
export async function freePort (preferred = 0, host = '127.0.0.1') {
  const attempt = (port) => new Promise((resolve) => {
    const srv = createServer()
    srv.once('error', () => resolve(null))
    srv.listen(port, host, () => { const p = srv.address().port; srv.close(() => resolve(p)) })
  })
  if (preferred > 0) { const p = await attempt(preferred); if (p !== null) return p }
  const p = await attempt(0)
  if (p === null) throw new Error('no free port')
  return p
}

const pidAlive = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return e && e.code === 'EPERM' } }
const killPid = (pid, sig) => { try { process.kill(pid, sig); return true } catch (e) { return false } }

export function createSupervisor ({
  config, serviceDir, script = join(serviceDir, 'bin', 'front-desk.mjs'), extraArgs = [], preferredPort = 8787,
  spawn = nodeSpawn, fetchImpl = globalThis.fetch, isAlive = pidAlive, kill = killPid, pickPort = freePort, wait = nap,
  log = () => {}, now = Date.now, startWaitMs = START_WAIT_MS, stopWaitMs = STOP_WAIT_MS, env = process.env,
}) {
  let state = { state: 'stopped', port: null, pid: null, since: now(), error: null, adopted: false }
  let starting = null

  const secrets = () => {
    const out = [config.ownerToken()]
    try { const e = config.childEnv({ port: 0, env }); for (const k of ['MODEL_API_KEY', 'TELEGRAM_BOT_TOKEN']) if (e[k]) out.push(e[k]) } catch (x) { /* nothing to scrub */ }
    return out.filter((s) => typeof s === 'string' && s.length >= 8)
  }
  const scrub = (text) => secrets().reduce((t, s) => t.split(s).join('***'), String(text))

  const set = (patch) => { state = { ...state, ...patch, since: now() } }
  const readPid = () => { try { const v = JSON.parse(readFileSync(config.pidFile, 'utf8')); return Number.isInteger(v.pid) && Number.isInteger(v.port) ? v : null } catch (e) { return null } }
  const dropPid = () => { try { rmSync(config.pidFile, { force: true }) } catch (e) { /* gone */ } }

  const api = (port, path) => fetchImpl(`http://127.0.0.1:${port}${path}`, { headers: { authorization: `Bearer ${config.ownerToken()}` }, signal: AbortSignal.timeout(2500) })

  /** Is the service on `port` ours (it answers the owner token)? */
  async function answering (port) {
    try { const r = await api(port, '/api/status'); return r.status === 200 } catch (e) { return false }
  }

  async function waitHealthy (port, child) {
    const end = now() + startWaitMs
    while (now() < end) {
      if (child.exited) return false
      if (await answering(port)) return true
      await wait(150)
    }
    return false
  }

  function rotateLog () {
    try { if (existsSync(config.logFile) && statSync(config.logFile).size > LOG_MAX) renameSync(config.logFile, config.logFile + '.1') } catch (e) { /* the log is a convenience */ }
  }

  async function doStart () {
    const ready = config.ready()
    if (!ready.ok) { set({ state: 'stopped', error: 'not_ready' }); return { ok: false, error: 'not_ready', missing: ready.missing } }
    config.ensureFiche()
    mkdirSync(config.dir, { recursive: true, mode: 0o700 })

    // A service from before this DSH start, still up: take it over rather than starting a second one.
    const old = readPid()
    if (old !== null && isAlive(old.pid) && await answering(old.port)) {
      set({ state: 'running', port: old.port, pid: old.pid, error: null, adopted: true })
      log(`adopted the running service (pid ${old.pid}, port ${old.port})`)
      return { ok: true, adopted: true, ...status() }
    }
    if (old !== null) dropPid()

    const port = await pickPort(preferredPort)
    rotateLog()
    const fd = openSync(config.logFile, 'a', 0o600)
    const child = { exited: false, code: null }
    let proc
    try {
      proc = spawn(process.execPath, [script, ...extraArgs], { cwd: serviceDir, env: config.childEnv({ port, env }), detached: true, stdio: ['ignore', fd, fd] })
    } finally { try { closeSync(fd) } catch (e) { /* already closed */ } }
    if (typeof proc.unref === 'function') proc.unref()
    set({ state: 'starting', port, pid: proc.pid, error: null, adopted: false })
    try { writeFileSync(config.pidFile, JSON.stringify({ pid: proc.pid, port }) + '\n', { mode: 0o600 }) } catch (e) { /* adoption is a convenience */ }
    proc.on('exit', (code, signal) => {
      child.exited = true; child.code = code
      if (state.pid !== proc.pid) return
      dropPid()
      const stopping = state.state === 'stopping'
      set({ state: stopping ? 'stopped' : 'failed', pid: null, port: null, error: stopping ? null : `exited (${signal || code})` })
      if (!stopping) log(`the service stopped by itself (${signal || code})`)
    })
    proc.on('error', (e) => { child.exited = true; set({ state: 'failed', pid: null, port: null, error: scrub(e.message) }) })

    if (!(await waitHealthy(port, child))) {
      const tail = scrub(lastLines(readLog(), 6).join(' | '))
      if (!child.exited) await stopPid(proc.pid)
      set({ state: 'failed', pid: null, port: null, error: tail || 'did not answer in time' })
      return { ok: false, error: 'start_failed', detail: state.error }
    }
    set({ state: 'running', error: null })
    log(`service up on port ${port} (pid ${proc.pid})`)
    return { ok: true, ...status() }
  }

  async function stopPid (pid) {
    kill(pid, 'SIGTERM')
    const end = now() + stopWaitMs
    while (now() < end && isAlive(pid)) await wait(100)
    if (isAlive(pid)) kill(pid, 'SIGKILL')
  }

  function readLog (n = 400) {
    try { return lastLines(readFileSync(config.logFile, 'utf8'), n).join('\n') } catch (e) { return '' }
  }

  function status () {
    return { state: state.state, port: state.port, pid: state.pid, since: state.since, error: state.error, adopted: state.adopted }
  }

  return {
    status,

    /** One start at a time; a second call while one is running waits for it. */
    start () {
      if (state.state === 'running') return Promise.resolve({ ok: true, ...status() })
      if (starting === null) starting = doStart().catch((e) => { set({ state: 'failed', error: scrub(e.message) }); return { ok: false, error: 'start_failed', detail: state.error } }).finally(() => { starting = null })
      return starting
    },

    async stop () {
      const pid = state.pid !== null ? state.pid : (readPid() || {}).pid
      if (pid === undefined || pid === null) { set({ state: 'stopped', port: null, pid: null, error: null }); return { ok: true, ...status() } }
      set({ state: 'stopping' })
      await stopPid(pid)
      dropPid()
      set({ state: 'stopped', port: null, pid: null, error: null, adopted: false })
      return { ok: true, ...status() }
    },

    /** Where the proxy and the tools reach the service, or null while it is not running. */
    target () {
      return state.state === 'running' && state.port !== null ? { port: state.port, token: config.ownerToken() } : null
    },

    /** The tail of the service's log, with every secret scrubbed. */
    logs (n = 100) { return scrub(readLog(Math.min(Math.max(1, n | 0), 400))) },
  }
}
