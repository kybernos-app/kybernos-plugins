// Suite « Restart DSH » restarts the instance that asked, not whatever listens on 3080 (audit A6-19).
//   node packages/kybernos-hub/test-relaunch-port.mjs
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply as appliquer, outilRelance } from './index.js'
import { sessionSource } from './session-guard.mjs'
import { SESSION_SECRET, sessionCookie } from './lib-session-test.mjs'

// The route needs the signed session as well as the Origin (L3-14): the Suite panel's own request carries both.
sessionSource.secret = () => SESSION_SECRET
let total = 0; let echecs = 0
const ok = (nom, cond, detail = '') => { total++; if (cond) console.log('  ✓ ' + nom); else { echecs++; console.log('  ✗ ' + nom + (detail ? ' — ' + detail : '')) } }

// A DSH home whose relaunch tool only records the arguments it was given.
const home = mkdtempSync(join(tmpdir(), 'kb-hub-relance-'))
mkdirSync(join(home, 'tools'), { recursive: true })
const trace = join(home, 'argv.json')
writeFileSync(join(home, 'tools', 'dsh-relance.mjs'),
  "import { writeFileSync } from 'node:fs'\nwriteFileSync(" + JSON.stringify(trace) + ", JSON.stringify(process.argv.slice(2)))\n")
process.env.DSH_HOME = home
delete process.env.DSH_PORT

const routes = {}
const ctx = { get: (n) => (n === 'webServer' ? { register: (r) => { routes[r.path] = r.handler } } : undefined), effect: (fn) => fn(), inject: () => {} }
appliquer(ctx)

const demande = async (port) => {
  rmSync(trace, { force: true })
  const authority = '127.0.0.1:' + port
  const req = Object.assign((async function * () { yield Buffer.from(JSON.stringify({ confirm: true })) })(), {
    method: 'POST',
    headers: { host: authority, origin: 'http://' + authority, cookie: sessionCookie(authority), 'content-type': 'application/json' },
    socket: { localPort: port },
  })
  const res = { code: null, body: null, writeHead (c) { this.code = c }, end (b) { this.body = b === undefined ? null : JSON.parse(b) } }
  await routes['/kybernos-hub/relaunch'](req, res)
  for (let n = 0; n < 60 && !existsSync(trace); n += 1) await new Promise((r) => setTimeout(r, 50))
  await new Promise((r) => setTimeout(r, 50))
  return { res, argv: existsSync(trace) ? JSON.parse(readFileSync(trace, 'utf8')) : null }
}

console.log('── the relaunch tool is told which instance to restart ──')
{
  const a = await demande(3141)
  ok('the route answers 200', a.res.code === 200 && a.res.body.ok === true, JSON.stringify(a.res))
  ok('the tool runs the relaunch command', a.argv !== null && a.argv[0] === 'relance' && a.argv.includes('--avec-autres'), JSON.stringify(a.argv))
  ok('it gets --port with the port of the page that asked (not the 3080 default)', a.argv !== null && a.argv.join(' ').includes('--port 3141'), JSON.stringify(a.argv))
  const b = await demande(3080)
  ok('on 3080 it says 3080 (explicit, same as before)', b.argv !== null && b.argv.join(' ').includes('--port 3080'), JSON.stringify(b.argv))
}

// L3-85, with the REAL wiring of the hub (the lock file in the DSH home, not a stand-in function): the relaunch is refused while an installer holds the installation lock, and the
// relaunch tool is not started. The « installer » is a harmless node process that waits; the lock is written the way the robot writes its own.
console.log('── the relaunch waits for an installer that runs ──')
{
  const { spawn } = await import('node:child_process')
  const { fichierVerrou, prendreVerrou } = await import('./install-lock.mjs')
  const installateur = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  await new Promise((r) => installateur.once('spawn', r))
  prendreVerrou({ fichier: fichierVerrou(home), genre: 'suite', pid: installateur.pid })
  const occupe = await demande(3141)
  ok('while the installer lives: 409 busy with a sentence, and the relaunch tool is not started', occupe.res.code === 409 && occupe.res.body.error === 'busy' && /installation is running/.test(occupe.res.body.detail) && occupe.argv === null, JSON.stringify(occupe))
  await new Promise((r) => { installateur.once('exit', r); installateur.kill('SIGKILL') })
  const libre = await demande(3141)
  ok('once it is killed the lock is stale: the relaunch runs again', libre.res.code === 200 && libre.argv !== null && libre.argv.join(' ').includes('--port 3141'), JSON.stringify(libre))
}

// Where the tool is (T1-1, 2026-10-24): `POST /kybernos-hub/relaunch` answered 500 `relaunch-tool-missing` on any machine without `~/.dsh/tools/dsh-relance.mjs`, although the suite
// carries `scripts/dsh-relance.mjs`. Only the pure resolver is exercised here: running the real script would restart a DSH.
console.log('── where the relaunch tool is ──')
{
  const h = '/dsh-home'
  const racine = '/suite'
  const chez = h + '/tools/dsh-relance.mjs'
  const livre = racine + '/scripts/dsh-relance.mjs'
  const avec = (...presents) => (p) => presents.includes(p)
  ok('the person\'s own copy wins (an older hand-made copy keeps working)', outilRelance(h, racine, avec(chez, livre)) === chez)
  ok('without it, the suite\'s own script is used', outilRelance(h, racine, avec(livre)) === livre)
  ok('with only the person\'s copy it is that one', outilRelance(h, racine, avec(chez)) === chez)
  ok('with neither, null: the route then answers relaunch-tool-missing', outilRelance(h, racine, avec()) === null)
  ok('the suite really ships the script this resolver falls back to', existsSync(join(new URL('../..', import.meta.url).pathname, 'scripts', 'dsh-relance.mjs')))
}

rmSync(home, { recursive: true, force: true })
console.log(echecs === 0 ? `\nOK (${total})` : `\n${echecs} failure(s) of ${total}`)
process.exit(echecs === 0 ? 0 : 1)
