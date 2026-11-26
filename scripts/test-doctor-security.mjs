#!/usr/bin/env node
// `doctor --security`: the judgement, the readers and the support bundle (scripts/doctor-security.mjs).
//   - the listener parser reads lsof and ss output and keeps only the asked port;
//   - an open listener, a readable secret file or a key in the profile is a FAIL; a permission preset that never asks is a WARN;
//   - the bundle never carries the value of a secret, a personal path or an e-mail address;
//   - the command line exits 1 on a fail, writes the bundle only when asked, and makes no network call.
//
//   node scripts/test-doctor-security.mjs
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildBundle, collectFacts, countSecrets, isLoopback, judge, parseListeners, readDefaultPreset, realIo, redact, securityDoctorCli, summarise } from './doctor-security.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + detail)) } }
const status = (lines, id) => (lines.find((l) => l.id === id) || {}).status

const KEY = 'sk-' + 'a1B2c3D4e5F6g7H8i9J0k1L2'
const KBD = 'kbd_' + '0123456789abcdef0123456789abcdef0123456789abcdef'

console.log('the listener parser')
{
  const lsof = [
    'COMMAND   PID  USER   FD   TYPE DEVICE SIZE/OFF NODE NAME',
    'node    93455 miled   20u  IPv4 0xabc      0t0  TCP 127.0.0.1:3080 (LISTEN)',
    'node    93455 miled   21u  IPv6 0xdef      0t0  TCP [::1]:3080 (LISTEN)',
    'node    93455 miled   22u  IPv4 0x123      0t0  TCP *:3080 (LISTEN)',
    'node    93455 miled   23u  IPv4 0x124      0t0  TCP *:4000 (LISTEN)'
  ].join('\n')
  const got = parseListeners(lsof, 3080)
  check('lsof: loopback v4, loopback v6 and a wildcard on the asked port, nothing from another port', got.length === 3 && got[0].address === '127.0.0.1' && got[1].address === '::1' && got[2].address === '*', JSON.stringify(got))
  const ss = 'LISTEN 0 511 127.0.0.1:3080 0.0.0.0:*\nLISTEN 0 511 0.0.0.0:3080 0.0.0.0:*\nLISTEN 0 511 [::]:3080 [::]:*\nLISTEN 0 511 0.0.0.0:22 0.0.0.0:*'
  const g2 = parseListeners(ss, 3080)
  check('ss: three listeners on the port, the other port is ignored', g2.length === 3 && g2[2].address === '::', JSON.stringify(g2))
  check('empty or odd output gives no listener', parseListeners('', 3080).length === 0 && parseListeners('garbage\n\n', 3080).length === 0)
  check('loopback: 127.x, ::1 and localhost; not * and not a LAN address', isLoopback('127.0.0.1') && isLoopback('127.1.2.3') && isLoopback('::1') && isLoopback('localhost') && !isLoopback('*') && !isLoopback('0.0.0.0') && !isLoopback('192.168.1.5') && !isLoopback('::'))
}

console.log('the readers of text')
{
  check('the default preset is read from the profile patch', readDefaultPreset('config:\n    defaultPreset: danger-full-access\n') === 'danger-full-access' && readDefaultPreset("defaultPreset: 'workspace-write'") === 'workspace-write' && readDefaultPreset('nothing here') === null)
  check('secret shapes are counted, never returned', countSecrets('a ' + KEY + ' b ' + KBD + ' c') === 2 && countSecrets('Bearer ' + 'x'.repeat(30)) === 1 && countSecrets('nothing to see, sk-short') === 0)
}

console.log('the judgement (pure)')
{
  const good = { platform: 'darwin', arch: 'arm64', node: '22.1.0', version: '0.1.2', port: 3080, listeners: [{ address: '127.0.0.1', port: 3080 }], listenersSource: 'lsof', files: [{ rel: '.env', mode: 0o600 }], configSecrets: [], defaultPreset: 'workspace-write', satellites: [], tunnels: [] }
  const l0 = judge(good)
  check('a clean installation has no fail and no warn', summarise(l0).fail === 0 && summarise(l0).warn === 0, JSON.stringify(summarise(l0)))
  check('loopback only is a pass', status(l0, 'listen') === 'pass')
  check('a wildcard listener is a FAIL that says what to do', status(judge({ ...good, listeners: [{ address: '*', port: 3080 }] }), 'listen') === 'fail' && judge({ ...good, listeners: [{ address: '0.0.0.0', port: 3080 }] }).find((l) => l.id === 'listen').fix.includes('127.0.0.1'))
  check('nothing listening, or not measurable, is information, not a fail', status(judge({ ...good, listeners: [] }), 'listen') === 'info' && status(judge({ ...good, listeners: null }), 'listen') === 'info')
  check('a secret file other users can read is a FAIL, one that only its owner reads is a pass', status(judge({ ...good, files: [{ rel: '.env', mode: 0o644 }] }), 'secret-files') === 'fail' && status(judge({ ...good, files: [{ rel: '.env', mode: 0o640 }] }), 'secret-files') === 'fail' && status(l0, 'secret-files') === 'pass')
  check('file modes are not judged on Windows', status(judge({ ...good, platform: 'win32', files: [{ rel: '.env', mode: 0o666 }] }), 'secret-files') === 'info')
  check('a key in the profile is a FAIL', status(judge({ ...good, configSecrets: [{ rel: 'profile/package.json', count: 1 }] }), 'config-secrets') === 'fail')
  check('a permission preset that never asks is a WARN, an asking one a pass, an unset one information', status(judge({ ...good, defaultPreset: 'danger-full-access' }), 'permission') === 'warn' && status(l0, 'permission') === 'pass' && status(judge({ ...good, defaultPreset: null }), 'permission') === 'info')
  check('a tunnel process or plugin is a WARN; the local door alone is information', status(judge({ ...good, tunnels: ['ngrok'] }), 'outside') === 'warn' && status(judge({ ...good, satellites: ['kybernos-tunnel'] }), 'outside') === 'warn' && status(judge({ ...good, satellites: ['@local/kybernos-door'] }), 'outside') === 'info' && status(judge({ ...good, satellites: ['@local/kybernos-tunnel'] }), 'outside') === 'warn' && status(l0, 'outside') === 'pass')
  check('the version line says no network call was made', judge(good).find((l) => l.id === 'version').detail.includes('no network call'))
}

console.log('the readers of the machine, on a throwaway home')
const root = mkdtempSync(join(tmpdir(), 'kb-doctor-sec-'))
try {
  const home = join(root, 'home', '.dsh')
  const profil = join(home, 'profiles', 'web')
  mkdirSync(join(home, 'kybernos', 'door'), { recursive: true })
  mkdirSync(profil, { recursive: true })
  writeFileSync(join(home, '.env'), 'OPENAI_API_KEY=' + KEY + '\n', { mode: 0o644 })
  chmodSync(join(home, '.env'), 0o644)
  writeFileSync(join(home, 'kybernos', 'door', 'token'), KBD, { mode: 0o600 })
  writeFileSync(join(home, 'kybernos', 'servers.json'), '{}', { mode: 0o600 })
  writeFileSync(join(home, 'kybernos', 'satellites-actives.json'), JSON.stringify({ actives: ['@local/kybernos-door', '@local/kybernos-hub'], desactives: ['@local/kybernos-tunnel'], maj: 'x' }))
  writeFileSync(join(profil, 'package.json'), JSON.stringify({ dependencies: {}, note: 'pasted ' + KEY }))
  writeFileSync(join(profil, 'cordis.patch.yml'), 'config:\n  defaultPreset: danger-full-access\n')
  const calls = []
  const run = async (argv) => {
    calls.push(argv.join(' '))
    if (argv[0] === 'lsof') return { code: 0, out: 'node 1 me 20u IPv4 0x1 0t0 TCP *:3080 (LISTEN)\n' }
    if (argv[0] === 'ps') return { code: 0, out: '/usr/bin/node\n/opt/homebrew/bin/ngrok\n' }
    return { code: -1, out: '' }
  }
  const facts = await collectFacts({ fs: realIo().fs, run, home, profilDir: profil, port: 3080, platform: 'darwin', version: '0.1.2', node: '22.1.0', arch: 'arm64' })
  check('the reader finds the listener, the tunnel process, the active plugins and the preset', facts.listeners.length === 1 && facts.listeners[0].address === '*' && facts.tunnels[0] === 'ngrok' && facts.satellites.includes('@local/kybernos-door') && !facts.satellites.includes('@local/kybernos-tunnel') && facts.defaultPreset === 'danger-full-access', JSON.stringify(facts).slice(0, 300))
  check('it lists the secret files with their mode, and the readable one is the keys file', facts.files.some((f) => f.rel === '.env' && f.mode === 0o644) && facts.files.some((f) => f.rel === join('kybernos', 'door', 'token') && f.mode === 0o600))
  check('it counts the key pasted in the profile without keeping it', facts.configSecrets.length === 1 && facts.configSecrets[0].count === 1 && !JSON.stringify(facts).includes(KEY))
  check('it only asks read-only questions of the system', calls.every((c) => /^(lsof|ps|ss) /.test(c)), calls.join(' | '))
  const lines = judge(facts)
  check('the verdict on this home: three fails (listen, files, keys), two warns (preset, tunnel)', summarise(lines).fail === 3 && summarise(lines).warn === 2, JSON.stringify(summarise(lines)))

  console.log('the support bundle')
  const text = buildBundle({ facts, lines, now: new Date('2026-11-23T10:00:00Z'), home })
  check('the bundle is JSON with the schema, the date, the checks and no network note missing', JSON.parse(text).schema === 'kybernos-support-bundle/1' && JSON.parse(text).generatedAt === '2026-11-23T10:00:00.000Z' && JSON.parse(text).checks.length === lines.length && text.includes('no network call'))
  check('it carries no value of any secret', !text.includes(KEY) && !text.includes(KBD) && !text.includes('a1B2c3D4'))
  check('it carries no personal path', !text.includes(home) && !text.includes(root))
  const dirty = redact('mail me at someone@example.com, token=abcdef123456, ' + KEY + ', ' + KBD + ', ' + 'f'.repeat(40) + ', /Users/miled/secret and ' + home + '/x', { home })
  check('redaction removes e-mails, token parameters, keys, long hex and user folders', !dirty.includes('someone@') && !dirty.includes('abcdef123456') && !dirty.includes(KEY) && !dirty.includes(KBD) && !dirty.includes('ffffffff') && !dirty.includes('miled') && dirty.includes('~/x'), dirty)

  console.log('the command line')
  const out = []
  const written = {}
  const io = { fs: realIo().fs, run, write: (t) => out.push(t), writeFile: (f, t) => { written[f] = t } }
  const base = { args: ['doctor', '--security'], env: {}, home, profilDir: profil, version: '0.1.2', platform: 'darwin', node: '22.1.0', arch: 'arm64', io }
  const code = await securityDoctorCli(base)
  check('it exits 1 when a check fails, prints each line and a fix, and writes no file unless asked', code === 1 && out.join('').includes('✗ Who can reach DSH') && out.join('').includes('→') && Object.keys(written).length === 0)
  check('the printed text carries no secret and no personal path', !out.join('').includes(KEY) && !out.join('').includes(home))
  await securityDoctorCli({ ...base, args: ['doctor', '--security', '--bundle', '/x/bundle.json'] })
  check('--bundle writes the bundle through the writer, once', Object.keys(written).length === 1 && written['/x/bundle.json'].includes('kybernos-support-bundle/1'))
  out.length = 0
  await securityDoctorCli({ ...base, args: ['doctor', '--security', '--json'] })
  check('--json prints one JSON document with the summary', JSON.parse(out.join('')).summary.fail === 3)
  const clean = { ...base, io: { ...io, run: async (argv) => (argv[0] === 'lsof' ? { code: 0, out: 'node 1 me 20u IPv4 0x1 0t0 TCP 127.0.0.1:3080 (LISTEN)\n' } : { code: 0, out: '' }) } }
  chmodSync(join(home, '.env'), 0o600)
  writeFileSync(join(profil, 'package.json'), '{}')
  writeFileSync(join(profil, 'cordis.patch.yml'), 'config:\n  defaultPreset: workspace-write\n')
  writeFileSync(join(home, 'kybernos', 'satellites-actives.json'), JSON.stringify({ actives: [], desactives: [] }))
  check('a clean home exits 0', (await securityDoctorCli(clean)) === 0)

  console.log('the real command, on a throwaway home (read-only, no network)')
  const r = spawnSync(process.execPath, [join(REPO, 'scripts', 'dsh-lifecycle.mjs'), 'doctor', '--security', '--json', '--port', '1'], { env: { ...process.env, DSH_HOME: home, KBLIFE_PROFIL: profil }, encoding: 'utf8', timeout: 30000 })
  let parsed = null
  try { parsed = JSON.parse(r.stdout) } catch (e) { /* reported below */ }
  check('doctor --security answers with a JSON verdict and does not touch the engine', parsed !== null && Array.isArray(parsed.checks) && parsed.checks.some((c) => c.id === 'secret-files' && c.status === 'pass'), (r.stdout || '').slice(0, 200) + (r.stderr || '').slice(0, 200))
  check('it does not print the planted secret', !String(r.stdout).includes(KEY) && !String(r.stdout).includes(KBD))
  check('it wrote nothing in the home', readFileSync(join(profil, 'package.json'), 'utf8') === '{}')
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
