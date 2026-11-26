// ── The Webapp Creator honours DSH_HOME, and never touches <HOME>/.dsh when it is set ─
//
// A team gets its own DSH home. This bundle built <os home>/.dsh itself for the apps folder (kybers), the seeded skills and
// the shared settings.json, so a DSH started with DSH_HOME elsewhere read and wrote the personal home instead.
//
//   node kybernos-webapp-creator/test-dsh-home.mjs
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

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

const iso = makeIsolation('webapp-creator')

try {
  console.log('kybernos-webapp-creator — DSH_HOME')

  iso.useDshHome()
  const mod = await import('./index.js')
  const apps = await import('./lib/apps.mjs')

  // DSH_HOME set, HOME elsewhere with a decoy: the settings and the apps folder must tell the two apart.
  iso.seedDecoy('kybernos/settings.json', JSON.stringify({ webappCreator: { deployTarget: 'fly' } }) + '\n')
  iso.seedDshHome('kybernos/settings.json', JSON.stringify({ webappCreator: { deployTarget: 'cloud-computer' } }) + '\n')
  iso.freezeDecoy()

  assert.equal(apps.appsRoot(), join(iso.dshHome, 'kybers'))
  ok('the apps folder is $DSH_HOME/kybers')

  assert.equal(mod.lireReglages().deployTarget, 'cloud-computer', 'the settings must come from DSH_HOME')
  ok('the settings are read from $DSH_HOME/kybernos/settings.json')

  const seeded = mod.seedSkills()
  assert.ok(seeded.length > 0, 'the bundle ships skills to seed')
  for (const name of seeded) assert.ok(existsSync(join(iso.dshHome, 'skills', name, 'SKILL.md')), name + ' must be seeded under $DSH_HOME/skills')
  ok('the skills are seeded under $DSH_HOME/skills (' + seeded.length + ')')

  iso.assertDecoyUntouched('the Webapp Creator')
  ok('nothing was read or written under <HOME>/.dsh (canaries and listing unchanged)')

  // DSH_HOME unset: the default location is unchanged.
  iso.useDefaultHome()
  assert.equal(apps.appsRoot(), join(iso.home, '.dsh', 'kybers'))
  assert.equal(mod.lireReglages().deployTarget, 'fly')
  ok('with DSH_HOME unset, the bundle still uses <HOME>/.dsh')

  console.log('\n' + pass + ' verifications OK')
} finally {
  iso.cleanup()
}
