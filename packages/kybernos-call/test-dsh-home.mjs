// ── The call half honours DSH_HOME, and never touches <HOME>/.dsh when it is set ─
//
// DSH's home is $DSH_HOME when set, else <os home>/.dsh. The call code reads the secrets file
// (kybernos/livekit.env), the browser-session secret (.credentials.yaml), the worker's log and its
// venv from there. With DSH_HOME set (an isolated instance, a second profile, CI) it must read
// THAT folder and leave the user's real <HOME>/.dsh alone.
//
//   node packages/kybernos-call/test-dsh-home.mjs
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
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

import { createCall } from './call-host.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

const SECRET = 'S'.repeat(32)
const envFile = (url) => 'LIVEKIT_URL=' + url + '\nLIVEKIT_API_KEY=APIkey\nLIVEKIT_API_SECRET=' + SECRET + '\n'

const iso = makeIsolation('call')
try {
  console.log('kybernos-call: DSH_HOME')

  // The scene of the bug: the OS home has a DIFFERENT, working setup under .dsh.
  iso.seedDecoy('kybernos/livekit.env', envFile('wss://decoy.example.test'))
  iso.seedDshHome('kybernos/livekit.env', envFile('wss://real.example.test'))
  iso.freezeDecoy()
  iso.useDshHome()

  // The default wiring (no injected dshHome): it must follow DSH_HOME.
  const call = createCall({ env: process.env })
  const status = await call.status()
  assert.equal(status.secrets, 'posee')
  assert.equal(status.url, 'wss://real.example.test')
  ok('the secrets are read from $DSH_HOME, not from <HOME>/.dsh')

  const minted = await call.mint({ agent: false, identity: 'tester' })
  assert.equal(minted.ok, true)
  assert.equal(minted.url, 'wss://real.example.test')
  ok('a room token is minted against the $DSH_HOME secrets')

  // The worker: without a venv under $DSH_HOME it refuses, even though the decoy home has none either.
  iso.seedDecoy('kybernos/appel-venv/bin/python', '#!/bin/sh\n')
  iso.freezeDecoy()
  const started = await call.agentStart({ sessionId: 'session-aaaaaaaa' })
  assert.equal(started.ok, false)
  assert.match(started.error, /venv/)
  ok('the worker venv is looked up under $DSH_HOME (a decoy venv under <HOME>/.dsh is ignored)')

  // The session cookie comes from $DSH_HOME/.credentials.yaml.
  assert.equal(await call.sessionCookie(), null)
  iso.seedDecoy('.credentials.yaml', 'client-connection/browser-session:\n  secret: ' + Buffer.alloc(32, 7).toString('base64url') + '\n')
  iso.freezeDecoy()
  assert.equal(await call.sessionCookie(), null)
  ok('the browser-session secret of <HOME>/.dsh is not used when $DSH_HOME is set')

  iso.assertDecoyUntouched('the call code')
  ok('nothing was created, changed or removed under <HOME>/.dsh')

  // Unset: the default <HOME>/.dsh still works.
  iso.useDefaultHome()
  const fallback = await createCall({ env: process.env }).status()
  assert.equal(fallback.url, 'wss://decoy.example.test')
  ok('with DSH_HOME unset, <HOME>/.dsh is the home')
} finally {
  iso.cleanup()
}
console.log('\nDSH_HOME (kybernos-call): ' + pass + ' checks')
