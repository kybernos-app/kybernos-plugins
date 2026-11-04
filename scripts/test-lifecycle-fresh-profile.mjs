#!/usr/bin/env node
// UJ-39: on a FRESH profile (no activation file) the installer must not switch on the phone-only bundle.
// `@local/kybernos-no-process` swaps the engine's program launcher for an in-app one; loaded on a computer it misses `@deepseek-ai/dsh-subprocess`, nine entries stay
// inactive and the installer rolls the whole install back (seen on a clean Debian arm64, scripts/check-headless-linux.mjs). Hermetic: a throw-away HOME and a short PATH.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inactifsParDefaut } from './lifecycle-engine.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let fails = 0
const check = (name, ok, detail = '') => { if (!ok) fails += 1; console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`) }

check('a satellite marked inactif is named, the others are not', JSON.stringify([...inactifsParDefaut([{ nom: 'a', defaut: 'inactif' }, { nom: 'b', defaut: 'actif' }, { nom: 'c' }])]) === '["a"]')
check('no list, or an odd entry, gives an empty set', inactifsParDefaut(undefined).size === 0 && inactifsParDefaut([null, 3]).size === 0)

const manifest = JSON.parse(readFileSync(join(REPO, 'docs', 'beta', 'satellites.json'), 'utf8'))
const inactive = manifest.satellites.bundles.filter((s) => s.defaut === 'inactif').map((s) => s.dir)
check('the manifest marks exactly the phone-only bundle inactif', JSON.stringify(inactive) === '["kybernos-no-process"]', inactive.join(','))

const home = mkdtempSync(join(tmpdir(), 'kb-fresh-profile-'))
try {
  const env = { HOME: home, DSH_HOME: join(home, '.dsh'), PATH: [dirname(process.execPath), '/usr/bin', '/bin'].join(':') }
  const r = spawnSync(process.execPath, [join(REPO, 'scripts', 'dsh-lifecycle.mjs'), 'satellites', '--liste'], { env, encoding: 'utf8', timeout: 60000 })
  const line = (name) => (r.stdout.split('\n').find((l) => l.includes(name)) || '')
  check('on a fresh profile the satellite list shows the phone-only bundle off', /inactive/.test(line('kybernos-no-process')) && !/ACTIVE/.test(line('kybernos-no-process')), line('kybernos-no-process').slice(0, 80))
  check('...and a computer bundle on', /ACTIVE/.test(line('kybernos-multi-device')))
  check('listing writes nothing in the home', !existsSync(join(home, '.dsh', 'kybernos', 'satellites-actives.json')) && readdirSync(home).filter((f) => f !== '.dsh').length === 0)
} finally { rmSync(home, { recursive: true, force: true }) }

process.exit(fails === 0 ? 0 : 1)
