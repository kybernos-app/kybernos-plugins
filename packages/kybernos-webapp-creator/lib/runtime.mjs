// runtime.mjs — one small Node process per app, on this computer.
//
// Contract of an app folder: `server.js` reads `PORT` from the environment and listens on
// 127.0.0.1. Nothing else is started, ever. The process is a plain child (not detached): closing
// the host ends the apps it started. Logs append to `<dir>/logs/server.log`; the live state lives
// in `<dir>/.runtime.json` and only ever names a pid we started.
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'

export const PORT_MIN = 4400
export const PORT_MAX = 4499
export const RUNTIME_FILE = '.runtime.json'
export const LOG_REP = 'logs'
export const LOG_FILE = 'server.log'
const LOG_MAX = 256 * 1024

const attendre = (ms) => new Promise((r) => setTimeout(r, ms))
const logPath = (dir) => join(dir, LOG_REP, LOG_FILE)

/** The recorded state of an app, tolerant: a missing or broken file reads as "not running". */
export function runtimeState (dir) {
  try {
    const file = join(dir, RUNTIME_FILE)
    if (existsSync(file) !== true) return null
    const brut = JSON.parse(readFileSync(file, 'utf8'))
    if (brut === null || typeof brut !== 'object' || typeof brut.pid !== 'number') return null
    return brut
  } catch (e) { return null }
}

export function isAlive (pid) {
  if (typeof pid !== 'number' || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (e) { return e && e.code === 'EPERM' }
}

/** Last lines of the app log (bounded read). */
export function readLogs (dir, max = 50) {
  try {
    const file = logPath(dir)
    if (existsSync(file) !== true) return []
    const brut = statSync(file).size > LOG_MAX ? readFileSync(file).subarray(-LOG_MAX).toString('utf8') : readFileSync(file, 'utf8')
    return brut.split('\n').filter((l) => l !== '').slice(-max)
  } catch (e) { return [] }
}

const portLibre = (port) => new Promise((resoudre) => {
  const s = createServer()
  s.once('error', () => resoudre(false))
  s.listen(port, '127.0.0.1', () => s.close(() => resoudre(true)))
})

/** First free port of the range, or null. */
export async function freePort () {
  for (let p = PORT_MIN; p <= PORT_MAX; p++) {
    if (await portLibre(p) === true) return p
  }
  return null
}

/** Wait (bounded) until something accepts connections on the port; false on timeout. */
async function waitForPort (port, timeoutMs = 3000) {
  const fin = Date.now() + timeoutMs
  while (Date.now() < fin) {
    const ok = await new Promise((resoudre) => {
      const sock = createServer()
      // The app owns the port: if WE can bind it, nothing is listening yet.
      sock.once('error', () => resoudre(true))
      sock.listen(port, '127.0.0.1', () => sock.close(() => resoudre(false)))
    })
    if (ok === true) return true
    await attendre(120)
  }
  return false
}

/** Start one app. Refuses when there is no server.js or when it is already running. */
export async function startApp (dir) {
  const serveur = join(dir, 'server.js')
  if (existsSync(serveur) !== true) return { ok: false, error: 'this app has no server.js — build it with the webapp-build skill' }
  const etat = runtimeState(dir)
  if (etat !== null && isAlive(etat.pid) === true) return { ok: false, error: 'already running', pid: etat.pid, port: etat.port }
  const port = await freePort()
  if (port === null) return { ok: false, error: 'no free port in ' + PORT_MIN + '-' + PORT_MAX }
  try {
    mkdirSync(join(dir, LOG_REP), { recursive: true })
    appendFileSync(logPath(dir), '\n--- start ' + new Date().toISOString() + ' ---\n')
    const fd = openSync(logPath(dir), 'a')
    const enfant = spawn(process.execPath, ['server.js'], {
      cwd: dir,
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', PORT: String(port), NODE_ENV: 'production' },
      stdio: ['ignore', fd, fd],
    })
    const etatNouveau = { pid: enfant.pid, port, startedAt: new Date().toISOString() }
    writeFileSync(join(dir, RUNTIME_FILE), JSON.stringify(etatNouveau, null, 2) + '\n')
    const vivant = await waitForPort(port, 3000)
    if (vivant !== true) {
      // the child died before opening its port, or never opened it: do not leave a ghost state
      if (isAlive(enfant.pid) === true) { try { process.kill(enfant.pid, 'SIGTERM') } catch (e) { /* already gone */ } }
      rmSync(join(dir, RUNTIME_FILE), { force: true })
      return { ok: false, error: 'the app did not open its port', log: readLogs(dir, 5) }
    }
    return { ok: true, pid: etatNouveau.pid, port }
  } catch (e) {
    return { ok: false, error: 'start failed: ' + String(e && e.message || e).slice(0, 120) }
  }
}

/** Stop one app (SIGTERM, then SIGKILL after a bounded wait). Idempotent in spirit, honest in words. */
export async function stopApp (dir) {
  const etat = runtimeState(dir)
  if (etat === null) return { ok: false, error: 'not running' }
  if (isAlive(etat.pid) !== true) {
    rmSync(join(dir, RUNTIME_FILE), { force: true })
    return { ok: true, note: 'the process was already gone; the stale state is cleared' }
  }
  try { process.kill(etat.pid, 'SIGTERM') } catch (e) { /* raced */ }
  for (let i = 0; i < 20; i++) {
    if (isAlive(etat.pid) !== true) break
    await attendre(100)
  }
  if (isAlive(etat.pid) === true) {
    try { process.kill(etat.pid, 'SIGKILL') } catch (e) { /* raced */ }
    await attendre(120)
  }
  rmSync(join(dir, RUNTIME_FILE), { force: true })
  return { ok: true, pid: etat.pid, forced: isAlive(etat.pid) === true }
}

export function statusApp (dir) {
  const etat = runtimeState(dir)
  if (etat === null) return { running: false }
  return { running: isAlive(etat.pid), pid: etat.pid, port: etat.port, startedAt: etat.startedAt ?? null }
}
