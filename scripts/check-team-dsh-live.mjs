#!/usr/bin/env node
// Live check of the team DSH launcher (packages/kybernos-cloud/team-instances.mjs) on the SANDBOX: a made-up team gets a home copied from the sandbox's profile, a REAL
// `dsh web` starts on it, answers, serves this worktree's cloud plugin from its own home, and stops. It never touches the real ~/.dsh or :3080.
//
//   bash scripts/sandbox/setup.sh && source scripts/sandbox/env.sh && node scripts/check-team-dsh-live.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createTeamInstances, answers } from '../packages/kybernos-cloud/team-instances.mjs'

const home = process.env.DSH_HOME || ''
if (!home.includes('/.kybernos-sandbox/') || process.env.HOME === process.env.KB_REAL_HOME) {
  console.error('○ not run: sandbox only. `source scripts/sandbox/env.sh` first (DSH_HOME is "' + home + '")')
  process.exit(2)
}
if (!existsSync(join(home, 'profiles', 'web', 'package.json'))) { console.error('○ not run: no sandbox profile; `bash scripts/sandbox/setup.sh` first'); process.exit(2) }

const TEAM = 'live-check-team'
const dshBin = realpathSync(execFileSync('which', ['dsh'], { encoding: 'utf8' }).trim())
const teamHome = join(home, 'teams', TEAM)
let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const teams = createTeamInstances({ personalHome: () => home, dshBin: () => dshBin, startTimeoutMs: 180000 })

try {
  console.log('team DSH — live, on the sandbox')
  rmSync(teamHome, { recursive: true, force: true })
  const began = Date.now()
  const opened = await teams.open(TEAM)
  assert.equal(opened.ok, true, JSON.stringify(opened))
  ok('a real DSH started on a copy of the profile and said it was mounted (' + Math.round((Date.now() - began) / 1000) + ' s, port ' + opened.port + ')')
  assert.equal(opened.started, true)
  assert.notEqual(opened.port, 3080)

  const env = execFileSync('ps', ['eww', '-o', 'command=', '-p', String(opened.pid)], { encoding: 'utf8' })
  const named = (key, value) => new RegExp(key + '=' + value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&') + '(\\s|$)', 'u').test(env)
  assert.ok(named('DSH_HOME', teamHome), 'the process runs with the team home as DSH_HOME')
  assert.ok(named('KYBERNOS_TEAM_ID', TEAM), 'and knows which team it is')
  ok('it runs with its own DSH_HOME and knows its team')

  assert.equal(await answers(opened.port), true)
  const status = await fetch(opened.url + 'kybernos-cloud/status')
  assert.equal(status.status, 200, 'the cloud plugin answers')
  const body = await status.json()
  assert.equal(typeof body, 'object')
  ok('the cloud plugin of this worktree answers from the team DSH (' + JSON.stringify(body).slice(0, 80) + ')')

  const log = readFileSync(join(teamHome, 'logs', 'team-dsh.log'), 'utf8')
  assert.equal(/kybernos-relance|kybernos-miniapps/u.test(log.replace(/token=[^\s]+/gu, '')), false, 'the bundles of the computer are not loaded')
  const entries = readdirSync(teamHome)
  console.log('    team home holds: ' + entries.join(', '))
  assert.ok(entries.includes('profiles') && entries.includes('team-home.json'))
  ok('the log shows no bundle of the computer, and the team home holds what the DSH wrote')

  // Every link of the copy that leaves the profile still reaches something.
  const modules = join(teamHome, 'profiles', 'web', 'node_modules')
  const broken = []
  const visit = (dir, depth) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.pnpm' || entry.name === '.bin') continue
      const path = join(dir, entry.name)
      if (entry.isSymbolicLink() && !existsSync(path)) broken.push(path.slice(modules.length + 1))
      else if (entry.isDirectory() && depth === 0 && entry.name.startsWith('@')) visit(path, 1)
    }
  }
  visit(modules, 0)
  assert.deepEqual(broken, [], 'links that lead nowhere: ' + broken.join(', '))
  ok('no link of the copied profile leads nowhere')

  const again = await teams.open(TEAM)
  assert.deepEqual([again.started, again.pid], [false, opened.pid])
  ok('opening it again starts nothing')

  assert.deepEqual(await teams.stop(TEAM), { ok: true, stopped: true })
  assert.equal(await answers(opened.port), false)
  assert.throws(() => process.kill(opened.pid, 0))
  ok('it stops, and the port is free again')

  console.log('\n' + pass + ' verifications OK')
} finally {
  try { await teams.stop(TEAM) } catch (e) { /* nothing left to stop */ }
  rmSync(teamHome, { recursive: true, force: true })
}
