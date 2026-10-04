// ── kybernos-auto honours DSH_HOME and never touches <HOME>/.dsh when it is set ──
//
// DSH_HOME IS the DSH folder. The default home of monterRoutes was
// join(DSH_HOME || homedir(), '.dsh'): with DSH_HOME set that is $DSH_HOME/.dsh, a second
// folder nobody else reads, so the Auto state and settings silently went to a different
// place than every other bundle's. The caller (apply) passed the right value, which hid it.
//
//   node kybernos-auto/test-dsh-home.mjs
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

const PORT = 3080
const requete = (method, path, corps) => {
  const body = corps === undefined ? '' : JSON.stringify(corps)
  return {
    method, url: path, headers: { origin: 'http://127.0.0.1:' + PORT }, socket: { localPort: PORT },
    on (ev, cb) { if (ev === 'data') cb(body); if (ev === 'end') cb() },
  }
}
const mount = (register) => {
  const routes = {}
  register({ register: (r) => { routes[r.path] = r.handler } })
  return async (method, path, corps) => {
    let out = null
    await routes[path.split('?')[0]](requete(method, path, corps), { writeHead () {}, end (s) { out = JSON.parse(s) } })
    return out
  }
}

const iso = makeIsolation('auto')

try {
  console.log('kybernos-auto — DSH_HOME')

  iso.useDshHome()
  const mod = await import('./index.js')

  assert.equal(mod.dshHome({ DSH_HOME: '' }, () => '/h'), join('/h', '.dsh'))
  assert.equal(mod.dshHome({ DSH_HOME: '   ' }, () => '/h'), join('/h', '.dsh'))
  assert.equal(mod.dshHome({}, () => '/h'), join('/h', '.dsh'))
  assert.equal(mod.dshHome({ DSH_HOME: '  /srv/dsh  ' }, () => '/h'), '/srv/dsh')
  assert.equal(mod.dshHome({ DSH_HOME: '~' }, () => '/h'), '/h')
  assert.equal(mod.dshHome({ DSH_HOME: '~/alt' }, () => '/h'), join('/h', 'alt'))
  ok('the resolver follows the DSH rule (blank = unset, ~ expanded, trimmed)')

  // DSH_HOME set, HOME elsewhere with a decoy full of canaries.
  iso.seedDecoy('kybernos/settings.json', JSON.stringify({ autoWhitelist: ['decoy/model'], autoClassifier: 'decoy/classifier' }))
  iso.seedDecoy('kybernos/auto-sessions.json', JSON.stringify({ 'decoy-session': true }))
  iso.seedDecoy('kybernos/auto-health.json', JSON.stringify({ 'decoy/model': { appels: 7, erreurs: 0 } }))
  iso.seedDshHome('kybernos/settings.json', JSON.stringify({ autoWhitelist: ['real/model'], autoClassifier: 'real/classifier' }))
  iso.seedDshHome('kybernos/auto-sessions.json', JSON.stringify({ 'real-session': true }))
  iso.freezeDecoy()

  // 1. monterRoutes with no `home`: the default is the DSH home itself.
  const bare = mount((ws) => mod.monterRoutes(ws, {}))
  const state = await bare('GET', '/kybernos-auto/state?sessionId=real-session')
  assert.deepEqual(state.whitelist, ['real/model'], 'the whitelist must come from DSH_HOME')
  assert.equal(state.sessionOn, true, 'the session state must come from DSH_HOME')
  const decoyState = await bare('GET', '/kybernos-auto/state?sessionId=decoy-session')
  assert.equal(decoyState.sessionOn, false, 'a session that only exists under <HOME>/.dsh is not Auto')
  ok('the default home of monterRoutes is $DSH_HOME (settings and per-session state are read there)')

  // 2. Writes land in the DSH home, not in $DSH_HOME/.dsh and not in <HOME>/.dsh.
  const turnedOn = await bare('POST', '/kybernos-auto/session', { sessionId: 'new-session', on: true })
  assert.equal(turnedOn.ok, true, JSON.stringify(turnedOn))
  assert.equal(JSON.parse(readFileSync(join(iso.dshHome, 'kybernos', 'auto-sessions.json'), 'utf8'))['new-session'], true)
  const saved = await bare('POST', '/kybernos-auto/settings', { autoWhitelist: ['real/model', 'real/other'] })
  assert.equal(saved.ok, true, JSON.stringify(saved))
  assert.deepEqual(JSON.parse(readFileSync(join(iso.dshHome, 'kybernos', 'settings.json'), 'utf8')).autoWhitelist, ['real/model', 'real/other'])
  const reported = await bare('POST', '/kybernos-auto/report', { modele: 'real/model', latenceMs: 120 })
  assert.equal(reported.ok, true, JSON.stringify(reported))
  assert.equal(existsSync(join(iso.dshHome, 'kybernos', 'auto-health.json')), true)
  assert.equal(existsSync(join(iso.dshHome, '.dsh')), false, 'no $DSH_HOME/.dsh folder (the old double .dsh)')
  ok('state, settings and health are written under $DSH_HOME/kybernos, never under $DSH_HOME/.dsh')

  // 3. apply(), the way DSH calls it.
  const ctx = { get: (name) => (name === 'webServer' ? ctx.webServer : undefined), inject: (_l, cb) => cb(ctx), webServer: null }
  const viaApply = mount((ws) => { ctx.webServer = ws; mod.apply(ctx) })
  assert.deepEqual((await viaApply('GET', '/kybernos-auto/state')).whitelist, ['real/model', 'real/other'])
  ok('apply() mounts the routes on $DSH_HOME')

  iso.assertDecoyUntouched('the auto bundle')
  ok('nothing was read or written under <HOME>/.dsh (canaries and listing unchanged)')

  // 4. DSH_HOME unset: the default location is unchanged.
  iso.useDefaultHome()
  const dflt = mount((ws) => mod.monterRoutes(ws, {}))
  assert.deepEqual((await dflt('GET', '/kybernos-auto/state?sessionId=decoy-session')).whitelist, ['decoy/model'])
  assert.equal((await dflt('GET', '/kybernos-auto/state?sessionId=decoy-session')).sessionOn, true)
  const viaApply2 = mount((ws) => { ctx.webServer = ws; mod.apply(ctx) })
  assert.deepEqual((await viaApply2('GET', '/kybernos-auto/state')).whitelist, ['decoy/model'])
  ok('with DSH_HOME unset, the routes still use <HOME>/.dsh')

  console.log('\n' + pass + ' verifications OK')
} finally {
  iso.cleanup()
}
