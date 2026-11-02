// ── kybernos-memory honours DSH_HOME, switches and lessons in the SAME home ──
//
// DSH's home is $DSH_HOME when set, else <os home>/.dsh. The lessons store already
// followed DSH_HOME, but the switches (`kybernos-memory.json`) were hard-coded to
// <os home>/.dsh: with DSH_HOME set, the page showed one home's lessons next to the
// other home's switches, and flipping a switch wrote into the user's real folder.
//
//   node kybernos-memory/test-dsh-home.mjs
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

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

// The two test-only overrides stay UNSET: the point is the default location.
delete process.env.KYBERNOS_MEMORY_KYBERS
delete process.env.KYBERNOS_MEMORY_SETTINGS

const iso = makeIsolation('memory')
const SESSION = 'sess-aaaaaaaa-1111'
const lesson = (text) => JSON.stringify({ ts: '2026-09-20T10:00:00Z', text, tags: [], uses: 0, lastUsed: null }) + '\n'
const route = (mod, path) => mod.ROUTES.find((r) => r.path === path)

try {
  console.log('kybernos-memory — DSH_HOME')

  iso.useDshHome()
  const store = await import('./lessons-store.mjs')
  const mod = await import('./index.js')

  assert.equal(store.dshHome({ DSH_HOME: '' }, () => '/h'), join('/h', '.dsh'))
  assert.equal(store.dshHome({ DSH_HOME: '   ' }, () => '/h'), join('/h', '.dsh'))
  assert.equal(store.dshHome({}, () => '/h'), join('/h', '.dsh'))
  assert.equal(store.dshHome({ DSH_HOME: '  /srv/dsh  ' }, () => '/h'), '/srv/dsh')
  assert.equal(store.dshHome({ DSH_HOME: '~' }, () => '/h'), '/h')
  assert.equal(store.dshHome({ DSH_HOME: '~/alt' }, () => '/h'), join('/h', 'alt'))
  ok('the resolver follows the DSH rule (blank = unset, ~ expanded, trimmed)')

  // DSH_HOME set, HOME elsewhere with a decoy: switches and lessons must tell the two apart.
  iso.seedDecoy('kybernos-memory.json', JSON.stringify({ lessons: false, context: false }) + '\n')
  iso.seedDecoy('kybers/decoy-kyber/memory/lessons.jsonl', lesson('a decoy lesson'))
  iso.seedDecoy('kybers/default/memory/lessons.jsonl', lesson('a decoy default lesson'))
  iso.seedDshHome('kybernos-memory.json', JSON.stringify({ lessons: true, context: false }) + '\n')
  iso.seedDshHome('kybers/default/memory/lessons.jsonl', lesson('a real default lesson'))
  iso.seedDshHome('kybers/real-kyber/memory/lessons.jsonl', lesson('a real lesson'))
  iso.seedDshHome('kybers/.active/' + SESSION, JSON.stringify({ kyber: 'real-kyber', ts: 1 }))
  iso.freezeDecoy()

  assert.deepEqual(mod.readSettings(), { lessons: true, context: false, relevant: true }, 'the switches must come from DSH_HOME')
  ok('the switches are read from $DSH_HOME/kybernos-memory.json')

  assert.deepEqual(store.listKybers(), ['default', 'real-kyber'])
  assert.deepEqual(store.readLessons('default').map((l) => l.text), ['a real default lesson'])
  assert.equal(store.activeKyber(SESSION), 'real-kyber')
  ok('the kybers, their lessons and the active kyber are read from $DSH_HOME/kybers')

  const set = await route(mod, '/kybernos-memory/settings/set').run(null, { lessons: false, context: true })
  assert.equal(set.ok, true)
  assert.deepEqual(JSON.parse(readFileSync(join(iso.dshHome, 'kybernos-memory.json'), 'utf8')), { lessons: false, context: true, relevant: true })
  assert.deepEqual(mod.readSettings(), { lessons: false, context: true, relevant: true })
  ok('flipping a switch writes $DSH_HOME/kybernos-memory.json')

  const added = store.addLesson('real-kyber', { text: 'a new real lesson' })
  assert.equal(added.ok, true)
  assert.equal(readFileSync(join(iso.dshHome, 'kybers', 'real-kyber', 'memory', 'lessons.jsonl'), 'utf8').includes('a new real lesson'), true)
  ok('a new lesson is written under $DSH_HOME/kybers')

  iso.assertDecoyUntouched('the memory bundle')
  ok('nothing was read or written under <HOME>/.dsh (canaries and listing unchanged)')

  // DSH_HOME unset: the default location is unchanged, for the switches and the lessons alike.
  iso.useDefaultHome()
  assert.deepEqual(mod.readSettings(), { lessons: false, context: false, relevant: true })
  assert.deepEqual(store.listKybers(), ['decoy-kyber', 'default'])
  const flipped = await route(mod, '/kybernos-memory/settings/set').run(null, { lessons: true })
  assert.equal(flipped.ok, true)
  assert.deepEqual(JSON.parse(readFileSync(join(iso.decoy, 'kybernos-memory.json'), 'utf8')), { lessons: true, context: false, relevant: true })
  assert.equal(existsSync(join(iso.dshHome, 'kybernos-memory.json')), true, 'the DSH_HOME file of the first phase is left alone')
  ok('with DSH_HOME unset, switches and lessons still live under <HOME>/.dsh')

  console.log('\n' + pass + ' verifications OK')
} finally {
  iso.cleanup()
}
