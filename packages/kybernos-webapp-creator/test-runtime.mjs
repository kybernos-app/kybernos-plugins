// test-runtime.mjs — a real app process: start, serve, stop, and every refusal on the way.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freePort, readLogs, startApp, statusApp, stopApp } from './lib/runtime.mjs'

let echecs = 0
const check = (libelle, ok, detail) => {
  if (ok === true) { console.log('  \u2713 ' + libelle); return }
  echecs++
  console.log('  \u2717 ' + libelle + (detail !== undefined ? ' \u2014 ' + JSON.stringify(detail) : ''))
}

const SERVEUR_CJS = [
  "const http = require('node:http')",
  'const port = Number(process.env.PORT || 0)',
  "http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok') }).listen(port, '127.0.0.1', () => console.log('listening ' + port))",
].join('\n')

const dir = mkdtempSync(join(tmpdir(), 'kb-app-'))
const crash = mkdtempSync(join(tmpdir(), 'kb-app-crash-'))
const vide = mkdtempSync(join(tmpdir(), 'kb-app-vide-'))
try {
  writeFileSync(join(dir, 'server.js'), SERVEUR_CJS)
  writeFileSync(join(crash, 'server.js'), 'process.exit(3)\n')

  console.log('lifecycle')
  check('an unstarted app is not running', statusApp(dir).running === false)
  check('stop on a stopped app says so', (await stopApp(dir)).ok === false)
  check('the port range is real', (await freePort()) !== null)

  const d = await startApp(dir)
  check('start answers with a port of the range', d.ok === true && d.port >= 4400 && d.port <= 4499, d)
  check('status shows it running', statusApp(dir).running === true)
  const r = await fetch('http://127.0.0.1:' + d.port + '/')
  check('the app serves', r.status === 200 && (await r.text()) === 'ok')
  check('the log has a line', readLogs(dir, 10).some((l) => l.includes('listening')))
  const bis = await startApp(dir)
  check('starting twice is refused', bis.ok === false && bis.error === 'already running', bis)
  const s = await stopApp(dir)
  check('stop works', s.ok === true && statusApp(dir).running === false)

  console.log('starts at the same instant, from different processes')
  // Each start picks the first free port, then spawns: processes that start together pick the same one, and the losers die on EADDRINUSE. They must take
  // another port, never report the winner's. (The flake of 2026-10-29: test-templates.mjs starts apps in this port range while this file runs. Inside one
  // process the probes take turns, so the race needs real processes. The helper exits as soon as it has the answer: its app keeps running, like the plugin's.)
  const runtimeUrl = new URL('./lib/runtime.mjs', import.meta.url).href
  const lancer = (x) => new Promise((resolve) => {
    const c = spawn(process.execPath, ['--input-type=module', '-e', 'import { startApp } from ' + JSON.stringify(runtimeUrl) + '; console.log(JSON.stringify(await startApp(' + JSON.stringify(x) + '))); process.exit(0)'], { stdio: ['ignore', 'pipe', 'inherit'] })
    let out = ''
    c.stdout.on('data', (d) => { out += d })
    c.on('close', () => { try { resolve(JSON.parse(out.trim().split('\n').pop())) } catch (e) { resolve({ ok: false, error: 'no answer: ' + out }) } })
  })
  const quatre = [0, 1, 2, 3].map(() => { const x = mkdtempSync(join(tmpdir(), 'kb-app-par-')); writeFileSync(join(x, 'server.js'), SERVEUR_CJS); return x })
  try {
    const res = await Promise.all(quatre.map(lancer))
    check('four processes starting together all succeed', res.every((x) => x.ok === true), res)
    check('each gets its own port', new Set(res.map((x) => x.port)).size === 4, res.map((x) => x.port))
    const servis = await Promise.all(res.map((x) => fetch('http://127.0.0.1:' + x.port + '/').then((r) => r.status, () => 0)))
    check('and each port answers', servis.every((c) => c === 200), servis)
  } finally {
    for (const x of quatre) { try { await stopApp(x) } catch (e) { /* stopped */ } rmSync(x, { recursive: true, force: true }) }
  }

  console.log('refusals')
  const sc = await startApp(crash)
  check('a crashing app is refused with its log', sc.ok === false && Array.isArray(sc.log), sc)
  check('a crashing app leaves no ghost state', statusApp(crash).running === false)
  const sv = await startApp(vide)
  check('no server.js is refused with the skill hint', sv.ok === false && /webapp-build/.test(sv.error), sv)
} finally {
  for (const d of [dir, crash, vide]) rmSync(d, { recursive: true, force: true })
}

if (echecs > 0) { console.log('test-runtime: ' + echecs + ' failure(s)'); process.exit(1) }
console.log('test-runtime: all green')
