// ── The phone link honours DSH_HOME, and never touches <HOME>/.dsh when it is set ─
//
// DSH's home is $DSH_HOME when set, else <os home>/.dsh. The phone link keeps its identity and its paired phones under
// <DSH home>/kybernos/mobile-remote/ and reads DSH's session secret from <DSH home>/.credentials.yaml. With DSH_HOME set
// (an isolated instance, a second profile, CI) it must use THAT folder and leave the user's real <HOME>/.dsh alone.
//
//   node packages/kybernos-mobile/test-dsh-home.mjs
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
// DSH-HOME-HARNESS-BEGIN
import * as kbAssert from 'node:assert/strict'
import * as kbFs from 'node:fs'
import * as kbOs from 'node:os'
import * as kbPath from 'node:path'

/** Every file under `dir` as { 'rel/path': content } (a directory is a 'rel/dir/' key with null); {} when `dir` is absent. */
const snapshot = (dir) => {
  const out = {}
  const walk = (current) => {
    let entries = []
    try { entries = kbFs.readdirSync(current, { withFileTypes: true }) } catch (e) { return }
    for (const entry of entries) {
      const full = kbPath.join(current, entry.name)
      if (entry.isDirectory()) { out[kbPath.relative(dir, full) + '/'] = null; walk(full) } else out[kbPath.relative(dir, full)] = kbFs.readFileSync(full, 'utf8')
    }
  }
  walk(dir)
  return out
}

/** What differs between two snapshots, as readable lines ([] when identical). */
const diffSnapshots = (before, after) => {
  const lines = []
  for (const key of Object.keys(after)) {
    if (!(key in before)) lines.push('created ' + key)
    else if (before[key] !== after[key]) lines.push('changed ' + key)
  }
  for (const key of Object.keys(before)) if (!(key in after)) lines.push('removed ' + key)
  return lines.sort()
}

const makeIsolation = (label) => {
  const root = kbFs.mkdtempSync(kbPath.join(kbOs.tmpdir(), 'kybernos-dsh-home-' + label + '-'))
  const home = kbPath.join(root, 'home')
  const decoy = kbPath.join(home, '.dsh')
  const dshHome = kbPath.join(root, 'dsh')
  kbFs.mkdirSync(decoy, { recursive: true })
  kbFs.mkdirSync(dshHome, { recursive: true })
  const savedEnv = {}
  for (const key of ['HOME', 'USERPROFILE', 'DSH_HOME']) savedEnv[key] = process.env[key]
  let frozen = null

  const put = (base, rel, content) => {
    const file = kbPath.join(base, rel)
    kbFs.mkdirSync(kbPath.dirname(file), { recursive: true })
    kbFs.writeFileSync(file, content)
    return file
  }

  const iso = {
    root, home, decoy, dshHome,
    /** Seed a canary under <home>/.dsh. Call before `freezeDecoy()`. */
    seedDecoy: (rel, content) => put(decoy, rel, content),
    /** Seed what the bundle should find under $DSH_HOME. */
    seedDshHome: (rel, content) => put(dshHome, rel, content),
    /** The OS home is `home` and $DSH_HOME is set: the scene of the bug. */
    useDshHome: () => {
      process.env.HOME = home
      process.env.USERPROFILE = home
      process.env.DSH_HOME = dshHome
    },
    /** The OS home is `home` and $DSH_HOME is unset: the default, <home>/.dsh, must still work. */
    useDefaultHome: () => {
      process.env.HOME = home
      process.env.USERPROFILE = home
      delete process.env.DSH_HOME
    },
    /** Remember the decoy's exact content; every later change is a leak. */
    freezeDecoy: () => { frozen = snapshot(decoy) },
    decoyChanges: () => diffSnapshots(frozen === null ? {} : frozen, snapshot(decoy)),
    assertDecoyUntouched: (what = 'nothing') => {
      kbAssert.ok(frozen !== null, 'freezeDecoy() was not called')
      kbAssert.deepEqual(iso.decoyChanges(), [], what + ' must touch <HOME>/.dsh while DSH_HOME is set')
    },
    cleanup: () => {
      for (const key of Object.keys(savedEnv)) { if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key] }
      try { kbFs.rmSync(root, { recursive: true, force: true }) } catch (e) { /* the OS cleans tmp */ }
    },
  }
  return iso
}
// DSH-HOME-HARNESS-END

import { createRemote } from './remote-host.mjs'
import { dshHome, localReach, readDshSecret, remoteDir } from './remote-local.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  \u2713 ' + label) }

const secret = (byte) => Buffer.alloc(32, byte).toString('base64url')
const credentials = (byte) => 'client-connection/browser-session:\n  secret: ' + secret(byte) + '\n'

const iso = makeIsolation('mobile')
try {
  console.log('kybernos-mobile: DSH_HOME')

  // the resolver follows DSH's own rule
  assert.equal(dshHome({ DSH_HOME: '' }, () => '/h'), join('/h', '.dsh'))
  assert.equal(dshHome({ DSH_HOME: '   ' }, () => '/h'), join('/h', '.dsh'))
  assert.equal(dshHome({}, () => '/h'), join('/h', '.dsh'))
  assert.equal(dshHome({ DSH_HOME: '  /srv/dsh  ' }, () => '/h'), '/srv/dsh')
  assert.equal(dshHome({ DSH_HOME: '~' }, () => '/h'), '/h')
  assert.equal(dshHome({ DSH_HOME: '~/alt' }, () => '/h'), join('/h', 'alt'))
  ok('the resolver follows the DSH rule (blank = unset, ~ expanded, trimmed)')

  // the scene of the bug: the OS home has a DIFFERENT, working setup under .dsh
  iso.seedDecoy('.credentials.yaml', credentials(9))
  iso.seedDecoy('kybernos/mobile-remote/devices.json', JSON.stringify({ v: 1, devices: [{ id: 'decoy', sid: 'x', phoneId: 'y' }] }))
  iso.seedDshHome('.credentials.yaml', credentials(7))
  iso.freezeDecoy()
  iso.useDshHome()

  assert.equal(remoteDir(), join(iso.dshHome, 'kybernos', 'mobile-remote'))
  ok('the link keeps its files under $DSH_HOME/kybernos/mobile-remote')

  assert.equal(readDshSecret(dshHome()).equals(Buffer.alloc(32, 7)), true)
  const reach = localReach({ webServer: { listenedPort: 4321 } })
  const cookie = reach().cookie
  assert.match(cookie, /^dsh-auth-[A-Za-z0-9_-]+=v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
  assert.equal(reach().base, 'http://127.0.0.1:4321')
  const { createHmac } = await import('node:crypto')
  const [, body, signature] = cookie.split('=')[1].split('.').length === 3 ? ['v1', ...cookie.split('=')[1].split('.').slice(1)] : []
  const expected = createHmac('sha256', Buffer.alloc(32, 7)).update(body).digest('base64url')
  assert.equal(signature, expected, 'the replay cookie must be signed with the secret of $DSH_HOME')
  assert.notEqual(signature, createHmac('sha256', Buffer.alloc(32, 9)).update(body).digest('base64url'))
  ok('the replay cookie is signed with the session secret of $DSH_HOME, not the decoy\'s')

  // a manager started with the default wiring reads $DSH_HOME and, with nothing paired, writes nothing at all
  const mgr = createRemote({ dir: remoteDir(), cloud: () => null, WebSocket: null, fetch: globalThis.fetch, local: () => null, label: () => 'Test' })
  await mgr.start()
  assert.equal(existsSync(join(iso.dshHome, 'kybernos')), false)
  ok('starting with no paired phone writes nothing')

  // the first pairing attempt creates the identity under $DSH_HOME and nowhere else
  const result = await mgr.pair()
  assert.equal(result.ok, false) // signed out: not_connected
  assert.equal(existsSync(join(remoteDir(), 'identity.json')), true)
  assert.equal(JSON.parse(readFileSync(join(remoteDir(), 'identity.json'), 'utf8')).pub.length > 80, true)
  mgr.stop()
  ok('the identity is made under $DSH_HOME on the first pairing')

  iso.assertDecoyUntouched('the phone link')
  ok('nothing was created, changed or removed under <HOME>/.dsh')

  // unset: the default location is unchanged
  iso.useDefaultHome()
  assert.equal(remoteDir(), join(iso.decoy, 'kybernos', 'mobile-remote'))
  assert.equal(readDshSecret(dshHome()).equals(Buffer.alloc(32, 9)), true)
  ok('with DSH_HOME unset, <HOME>/.dsh is the home')
} finally {
  iso.cleanup()
}
console.log('\nDSH_HOME (kybernos-mobile): ' + pass + ' checks')
