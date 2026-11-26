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

/** First free port of the range, or null; `exclus` are ports to skip (the ones a start just lost to someone else). */
export async function freePort (exclus = []) {
  for (let p = PORT_MIN; p <= PORT_MAX; p++) {
    if (exclus.indexOf(p) >= 0) continue
    if (await portLibre(p) === true) return p
  }
  return null
}

/** Wait (bounded) until something accepts connections on the port; false on timeout, or as soon as the child `pid` is gone: whoever listens
 *  there then is not our app (a port taken between the choice and the spawn must not be reported as ours). */
async function waitForPort (port, timeoutMs = 8000, pid = undefined) {
  const fin = Date.now() + timeoutMs
  while (Date.now() < fin) {
    if (pid !== undefined && isAlive(pid) !== true) return false
    const ok = await new Promise((resoudre) => {
      const sock = createServer()
      // The app owns the port: if WE can bind it, nothing is listening yet.
      sock.once('error', () => resoudre(true))
      sock.listen(port, '127.0.0.1', () => sock.close(() => resoudre(false)))
    })
    if (ok === true) {
      if (pid === undefined) return true
      // Something listens, but is it our child? A start that lost the port to another app dies on EADDRINUSE within moments of its spawn: give it
      // the time to do so before calling the port ours.
      await attendre(400)
      return isAlive(pid)
    }
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
  // Two starts can pick the same free port in the same instant (the check and the spawn are not one step): the loser dies on EADDRINUSE, and then
  // the next free port is tried instead of reporting a port that belongs to the other app.
  const perdus = []
  let dernier = null
  for (let essai = 0; essai < 8; essai++) {
    const port = await freePort(perdus)
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
      const vivant = await waitForPort(port, 8000, enfant.pid)
      if (vivant === true) return { ok: true, pid: etatNouveau.pid, port }
      // the child died before opening its port, or never opened it: do not leave a ghost state
      if (isAlive(enfant.pid) === true) { try { process.kill(enfant.pid, 'SIGTERM') } catch (e) { /* already gone */ } }
      rmSync(join(dir, RUNTIME_FILE), { force: true })
      dernier = { ok: false, error: 'the app did not open its port', log: readLogs(dir, 5) }
      // only a lost race is worth another port: an app that crashes for its own reasons is refused at once, with its log
      if (readLogs(dir, 20).some((l) => l.indexOf('EADDRINUSE') >= 0) !== true) return dernier
      perdus.push(port)
    } catch (e) {
      return { ok: false, error: 'start failed: ' + String(e && e.message || e).slice(0, 120) }
    }
  }
  return dernier
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
