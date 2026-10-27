// test-runtime.mjs — a real app process: start, serve, stop, and every refusal on the way.
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
