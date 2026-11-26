#!/usr/bin/env node
// The sandbox keeper of the soft-takeoff recette (scripts/soft-takeoff-sandbox-up.sh): what it refuses, what it leaves alone, what it would restart.
// It starts no real sandbox: a refusal exits before anything runs, a sandbox that answers is left alone, and a stopped one is only reported (--dry-run).
//
//   node scripts/test-soft-takeoff-sandbox-up.mjs
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(REPO, 'scripts/soft-takeoff-sandbox-up.sh')
const BOX = join(process.env.KB_REAL_HOME || homedir(), '.kybernos-sandbox')
let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + detail)) } }
// Async, so the stand-in server below can answer while the script runs (a synchronous spawn would block the event loop that serves it).
const { spawn } = await import('node:child_process')
const run = (args) => new Promise((done) => {
  const child = spawn('bash', [SCRIPT, ...args], { env: { PATH: process.env.PATH, HOME: process.env.HOME, KB_REAL_HOME: process.env.KB_REAL_HOME || homedir() } })
  let out = ''
  child.stdout.on('data', (d) => { out += d })
  child.stderr.on('data', (d) => { out += d })
  child.on('close', (status) => done({ status, out }))
})

const syntax = spawnSync('bash', ['-n', SCRIPT], { encoding: 'utf8' })
check('the script is well formed', syntax.status === 0, syntax.stderr)

check('no pair: usage, exit 2', (await run([])).status === 2)
check('an unknown option is refused', (await run(['--now', BOX + '/x:3098'])).status === 2)
check('--keep needs a number', (await run(['--keep', 'soon', BOX + '/x:3098'])).status === 2)
check('the owner\'s own ports are refused (3080, 8791, 8792)', [3080, 8791, 8792].every((p) => spawnSync('bash', [SCRIPT, '--dry-run', BOX + '/x:' + p], { encoding: 'utf8' }).status === 2))
check('a folder outside ~/.kybernos-sandbox is refused', (await run(['--dry-run', '/tmp/x:3098'])).status === 2 && (await run(['--dry-run', join(homedir(), 'Documents:3098')])).status === 2)
check('the sandbox folder itself, or a .. in the path, is refused', (await run(['--dry-run', BOX + ':3098'])).status === 2 && (await run(['--dry-run', BOX + '/x/../../y:3098'])).status === 2)
check('a pair without a numeric port is refused', (await run(['--dry-run', BOX + '/x:abc'])).status === 2 && (await run(['--dry-run', BOX + '/x'])).status === 2)
check('a refusal on any pair stops the whole call (nothing is started for the good one)', (await run(['--dry-run', BOX + '/x:3098', BOX + '/y:3080'])).status === 2)

// A free port: nothing answers, so --dry-run says it would restart, and starts nothing.
const free = await new Promise((done) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => done(p)) }) })
const stopped = await run(['--dry-run', BOX + '/x:' + free])
check('a sandbox that does not answer is reported, not started, with --dry-run', stopped.status === 0 && stopped.out.includes('would restart') && stopped.out.includes(':' + free), stopped.out)

// A server that answers 401 (what a DSH waiting for its cookie does): left alone.
const up = createServer((req, res) => { res.statusCode = 401; res.end('no') })
await new Promise((done) => up.listen(0, '127.0.0.1', done))
const upPort = up.address().port
const alive = await run(['--dry-run', BOX + '/x:' + upPort])
check('a sandbox that answers 401 is left alone', alive.status === 0 && !alive.out.includes('would restart'), alive.out)
const mixed = await run(['--dry-run', BOX + '/x:' + upPort, BOX + '/y:' + free])
check('with two sandboxes only the stopped one is reported', mixed.status === 0 && mixed.out.includes(':' + free) && !mixed.out.includes(':' + upPort), mixed.out)
const watch = await run(['--dry-run', '--keep', '1', BOX + '/x:' + upPort])
check('--keep with everything up ends after the time given, clean', watch.status === 0, watch.out)
up.close()

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
