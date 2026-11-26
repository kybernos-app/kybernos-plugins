#!/usr/bin/env node
// UJ-39: on a FRESH profile (no activation file) the installer must not switch on the phone-only bundle.
// `@local/kybernos-no-process` swaps the engine's program launcher for an in-app one; loaded on a computer it misses `@deepseek-ai/dsh-subprocess`, nine entries stay
// inactive and the installer rolls the whole install back (seen on a clean Debian arm64, scripts/check-headless-linux.mjs). Hermetic: a throw-away HOME and a short PATH.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inactifsParDefaut, activesResolues } from './lifecycle-engine.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let fails = 0
const check = (name, ok, detail = '') => { if (!ok) fails += 1; console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`) }

check('a satellite marked inactif is named, the others are not', JSON.stringify([...inactifsParDefaut([{ nom: 'a', defaut: 'inactif' }, { nom: 'b', defaut: 'actif' }, { nom: 'c' }])]) === '["a"]')
// Marking a module inactif must not switch it off where it already runs: the activation file lists the active ones, and `activesResolues` keeps them; only a satellite that is absent from the file and not `actif` stays off.
const SAT = [{ nom: '@local/kybernos-bricks', defaut: 'inactif' }, { nom: '@local/kybernos-door', defaut: 'inactif' }, { nom: '@local/kybernos-log', defaut: 'actif' }]
const gardee = activesResolues({ brut: { actives: ['@local/kybernos-bricks'], desactives: [] }, satellites: SAT, socle: [] })
check('a profile that already lists a module keeps it when the manifest turns it inactif, and does not gain the other', gardee.includes('@local/kybernos-bricks') && !gardee.includes('@local/kybernos-door') && gardee.includes('@local/kybernos-log'), gardee)
check('no list, or an odd entry, gives an empty set', inactifsParDefaut(undefined).size === 0 && inactifsParDefaut([null, 3]).size === 0)

const manifest = JSON.parse(readFileSync(join(REPO, 'docs', 'beta', 'satellites.json'), 'utf8'))
const inactive = manifest.satellites.bundles.filter((s) => s.defaut === 'inactif').map((s) => s.dir)
check('the manifest marks exactly the bundles that start off inactif (the phone-only ones: the launcher swap and the small model of the phone; the local door, which opens a way into Kaby and is switched on by the person; and, since 2026-11-23, the Bricks POC, little used: a fresh profile does not switch it on, a profile that already has it keeps it)', JSON.stringify([...inactive].sort()) === '["kybernos-bricks","kybernos-door","kybernos-no-process","kybernos-phone-model"]', inactive.join(','))

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
