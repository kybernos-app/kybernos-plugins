#!/usr/bin/env node
// A team space on localhost for the SANDBOX: the hosted app of packages/kybernos-webapp-creator/templates/tables, built into the sandbox's state folder and started on a free
// port, so that Publish (the dev adapter `envHosting`) has something real to publish into. It changes nothing outside <sandbox state>/space and never touches the real ~/.dsh.
//
//   source scripts/sandbox/env.sh
//   node scripts/sandbox/space.mjs start     # builds, starts, and writes <state>/space.env (mode 0600: the space's address, its boot key, an order address)
//   source "$KB_SANDBOX_STATE/space.env" && scripts/sandbox/start.sh      # the sandbox DSH then offers Publish, onto « Your own team space »
//   node scripts/sandbox/space.mjs stop
//
// Needs the template's three dependencies: TABLES_APP_NODE_MODULES=<a node_modules that holds hono, @hono/node-server and better-auth>, else `npm ci` runs once (network).
// The boot key is written to space.env and nowhere else; this script never prints it. The order address is an invented `.test` one: the live check answers the button itself.
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { basename, dirname, join } from 'node:path'
import { buildTablesApp } from '../../packages/kybernos-webapp-creator/templates/tables/scripts/build-tables-app.mjs'

export const ORDER_URL = 'https://kybernos.example.test/computers'

const dshHome = process.env.DSH_HOME || ''
const state = dshHome === '' ? '' : dirname(dirname(dshHome))
if (state === '' || basename(dirname(state)) !== '.kybernos-sandbox') { console.error('○ not run: sandbox only. `source scripts/sandbox/env.sh` first (DSH_HOME is "' + dshHome + '")'); process.exit(3) }
const dir = join(state, 'space')
const pidFile = join(dir, 'space.pid')
const secretsFile = join(dir, 'secrets.json')
const logFile = join(dir, 'space.log')
const envFile = join(state, 'space.env')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const alive = () => {
  try { const pid = Number(readFileSync(pidFile, 'utf8')); process.kill(pid, 0); return pid } catch (e) { return 0 }
}
const freePort = () => new Promise((resolve) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) }) })

async function start () {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  if (alive() !== 0) {
    if (existsSync(envFile)) { console.log('already running; `source ' + envFile + '`'); return 0 }
    if (stop() !== 0) return 1 // running but without its address: start again from clean
  }
  let secrets = null
  try { secrets = JSON.parse(readFileSync(secretsFile, 'utf8')) } catch (e) { secrets = null }
  if (secrets === null || typeof secrets.auth !== 'string' || typeof secrets.boot !== 'string') {
    secrets = { auth: randomBytes(32).toString('base64url'), boot: randomBytes(32).toString('hex') }
    writeFileSync(secretsFile, JSON.stringify(secrets), { mode: 0o600 })
  }
  const app = join(dir, 'app')
  rmSync(app, { recursive: true, force: true })
  const built = buildTablesApp({ out: app })
  if (process.env.TABLES_APP_NODE_MODULES !== undefined && process.env.TABLES_APP_NODE_MODULES !== '') symlinkSync(process.env.TABLES_APP_NODE_MODULES, join(app, 'node_modules'), 'dir')
  else {
    const npm = spawnSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: app, encoding: 'utf8' })
    if (npm.status !== 0) { console.error('npm ci failed: ' + (npm.stderr || '').slice(-300)); return 1 }
  }
  const port = await freePort()
  if (port === 3080) return 1
  const out = openSync(logFile, 'w', 0o600)
  const child = spawn(process.execPath, ['--no-warnings', 'server.js'], {
    cwd: app, detached: true, stdio: ['ignore', out, out],
    env: { PATH: process.env.PATH, PORT: String(port), KB_AUTH_SECRET: secrets.auth, KB_BOOT_KEY: secrets.boot, KB_DATA_DIR: join(dir, 'data'), KB_TRUST_PROXY: '1', KB_BUNDLE_MAX_BYTES: String(64 * 1024 * 1024) },
  })
  child.unref()
  closeSync(out)
  writeFileSync(pidFile, String(child.pid), { mode: 0o600 })
  for (let i = 0; i < 80; i++) {
    if (readFileSync(logFile, 'utf8').includes('listening ' + port)) break
    if (alive() === 0) { console.error('the space exited early; see ' + logFile); return 1 }
    await sleep(100)
  }
  if (!readFileSync(logFile, 'utf8').includes('listening ' + port)) { console.error('the space never answered; see ' + logFile); return 1 }
  writeFileSync(envFile, 'export KYBERNOS_DB_SPACE_URL=http://127.0.0.1:' + port + '\nexport KYBERNOS_DB_SPACE_KEY=' + secrets.boot + '\nexport KYBERNOS_DB_ORDER_URL=' + ORDER_URL + '\n', { mode: 0o600 })
  chmodSync(envFile, 0o600)
  console.log('space up on 127.0.0.1:' + port + ' (' + built.files + ' kybernos-db files vendored); next: source ' + envFile + ' && scripts/sandbox/start.sh')
  return 0
}

function stop () {
  const pid = alive()
  if (pid === 0) { console.log('no space running'); rmSync(pidFile, { force: true }); return 0 }
  const cmd = spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).stdout || ''
  if (!/server\.js/.test(cmd)) { console.error('refusing: pid ' + pid + ' does not look like the space: ' + cmd.trim()); return 1 }
  process.kill(pid, 'SIGTERM')
  rmSync(pidFile, { force: true })
  rmSync(envFile, { force: true })
  console.log('stopped pid ' + pid)
  return 0
}

const what = process.argv[2]
if (what === 'start') process.exit(await start())
else if (what === 'stop') process.exit(stop())
else { console.error('usage: node scripts/sandbox/space.mjs start|stop'); process.exit(2) }
