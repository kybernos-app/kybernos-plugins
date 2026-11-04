#!/usr/bin/env node
// `--help` / `-h` of the installer print the usage and change nothing (UJ-38: `./kybernos-install --help` used to install).
// Hermetic: a throw-away HOME, a PATH of the system folders and the folder of this node only, so nothing here can reach the real profile or the real dsh.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let fails = 0
const check = (name, ok, detail = '') => { if (!ok) fails += 1; console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`) }

const home = mkdtempSync(join(tmpdir(), 'kb-lifecycle-help-'))
const env = { HOME: home, DSH_HOME: join(home, '.dsh'), PATH: [dirname(process.execPath), '/usr/bin', '/bin'].join(':'), KB_PORT: '3999' }
try {
  for (const [label, cmd, args] of [
    ['the shell wrapper', 'sh', [join(REPO, 'kybernos-install'), '--help']],
    ['the wrapper with -h', 'sh', [join(REPO, 'kybernos-install'), '-h']],
    ['the robot itself', process.execPath, [join(REPO, 'scripts', 'dsh-lifecycle.mjs'), 'install', '--help']]
  ]) {
    const r = spawnSync(cmd, args, { env, encoding: 'utf8', timeout: 60000 })
    check(`${label}: exit 0 and a usage`, r.status === 0 && /Kybernos installer/.test(r.stdout) && /--dry/.test(r.stdout), `exit ${r.status}`)
    check(`${label}: no safety photo, no profile, no journal`, !existsSync(join(home, '.dsh', 'lifecycle')) && !existsSync(join(home, '.dsh', 'profiles')))
  }
  check('the throw-away home holds nothing the installer would have written', readdirSync(home).filter((f) => f !== '.dsh').length === 0)
} finally { rmSync(home, { recursive: true, force: true }) }

process.exit(fails === 0 ? 0 : 1)
