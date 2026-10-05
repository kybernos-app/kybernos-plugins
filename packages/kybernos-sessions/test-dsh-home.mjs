// ── kybernos-sessions honours DSH_HOME and never touches <HOME>/.dsh when it is set ──
//
// DSH's home is $DSH_HOME when set, else <os home>/.dsh. Several defaults here were
// hard-coded to <os home>/.dsh: the decision brain's gateway key (.credentials.yaml)
// and its settings file, and the fallbacks of the routes (which even pointed at
// <os home>/kybernos, with no .dsh at all, when no session store was given). With
// DSH_HOME set, the brain used the user's real key, or none when only DSH_HOME had one.
//
//   node kybernos-sessions/test-dsh-home.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
const creds = (key) => 'providers:\n  gateway:\n    VERCEL_AI_GATEWAY_API_KEY: ' + key + '\n'
const requete = (method, path, corps) => ({
  method, url: path, headers: { origin: 'http://127.0.0.1:' + PORT }, socket: { localPort: PORT },
  on (ev, cb) { if (ev === 'data' && corps !== undefined) cb(JSON.stringify(corps)); if (ev === 'end') cb() },
})
const reponse = () => { const r = { code: null, corps: null, writeHead (c) { r.code = c }, end (s) { try { r.corps = JSON.parse(s) } catch (e) { r.corps = s } } }; return r }
const monter = (mod, opts) => {
  const routes = {}
  mod.monterRoutes({ register: (r) => { routes[r.path] = r.handler } }, opts)
  return async (method, path, corps) => { const r = reponse(); await routes[path](requete(method, path, corps), r); return r }
}

const iso = makeIsolation('sessions')

try {
  console.log('kybernos-sessions — DSH_HOME')

  iso.useDshHome()
  const decision = await import('./decision.mjs')
  const mod = await import('./index.js')

  assert.equal(decision.dshHome({ DSH_HOME: '' }, () => '/h'), join('/h', '.dsh'))
  assert.equal(decision.dshHome({ DSH_HOME: '   ' }, () => '/h'), join('/h', '.dsh'))
  assert.equal(decision.dshHome({}, () => '/h'), join('/h', '.dsh'))
  assert.equal(decision.dshHome({ DSH_HOME: '  /srv/dsh  ' }, () => '/h'), '/srv/dsh')
  assert.equal(decision.dshHome({ DSH_HOME: '~' }, () => '/h'), '/h')
  assert.equal(decision.dshHome({ DSH_HOME: '~/alt' }, () => '/h'), join('/h', 'alt'))
  ok('the resolver follows the DSH rule (blank = unset, ~ expanded, trimmed)')

  // DSH_HOME set, HOME elsewhere with a decoy full of canaries.
  iso.seedDecoy('.credentials.yaml', creds('decoy-key'))
  iso.seedDecoy('kybernos/settings.json', JSON.stringify({ decisionBrain: 'none', brain: 'decoy/brain' }))
  iso.seedDecoy('kybernos/categories.json', JSON.stringify({ 'sess-decoy': { cat: 'ui', titre: 'Decoy', ts: '2026-09-20T10:00:00Z' } }))
  iso.seedDshHome('.credentials.yaml', creds('real-key'))
  iso.seedDshHome('kybernos/settings.json', JSON.stringify({ decisionBrain: 'typesafe-ai/jev', brain: 'real/brain' }))
  iso.seedDshHome('kybernos/categories.json', JSON.stringify({ 'sess-real': { cat: 'doc', titre: 'Real', ts: '2026-09-20T10:00:00Z' } }))
  iso.freezeDecoy()

  // 1. The decision brain's own defaults (what callers get when they pass no path).
  assert.equal(decision.lireCle({ env: {} }), 'real-key', 'the gateway key must come from DSH_HOME')
  assert.deepEqual(decision.lireModeleDecision(), { eteint: false, modele: 'typesafe-ai/jev' }, 'the decision model must come from DSH_HOME')
  const seen = []
  const verdict = await decision.decider({ q: { type: 'choice', criteria: { a: 'x' } } }, 'hello', {
    fetchImpl: async (url, init) => { seen.push(init.headers.authorization); return { ok: true, text: async () => JSON.stringify({ answers: {} }) } },
  })
  assert.equal(verdict.ok, true, JSON.stringify(verdict))
  assert.deepEqual(seen, ['Bearer real-key'])
  ok('the decision brain reads its key and its settings from $DSH_HOME')

  // 2. The routes with no path at all: the fallbacks must resolve to the DSH home.
  const bare = monter(mod, { decision: { decider: async (q, s, o) => { seen.push(o.fichierCredentials); return { ok: true } } } })
  const got = await bare('GET', '/kybernos-sessions/settings')
  assert.equal(got.corps.reglages.brain, 'real/brain', 'settings fall back to DSH_HOME/kybernos/settings.json')
  const saved = await bare('POST', '/kybernos-sessions/settings', { brain: 'new/brain' })
  assert.equal(saved.code, 200, JSON.stringify(saved.corps))
  assert.equal(JSON.parse(readFileSync(join(iso.dshHome, 'kybernos', 'settings.json'), 'utf8')).brain, 'new/brain')
  const cats = await bare('GET', '/kybernos-sessions/categories')
  assert.deepEqual(Object.keys(cats.corps.categories), ['sess-real'])
  const named = await bare('POST', '/kybernos-sessions/categories', { session: 'sess-new', cat: 'correctif', titre: 'Fixed' })
  assert.equal(named.code, 200, JSON.stringify(named.corps))
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(iso.dshHome, 'kybernos', 'categories.json'), 'utf8'))).sort(), ['sess-new', 'sess-real'])
  await bare('POST', '/kybernos-sessions/decision', { state: 'x', questions: { q: { type: 'choice', criteria: { a: 'x' } } } })
  assert.equal(seen[seen.length - 1], join(iso.dshHome, '.credentials.yaml'), 'the route hands the DSH_HOME credentials file to the brain')
  ok('routes mounted with no explicit path fall back to $DSH_HOME (settings, categories, credentials)')

  // 3. Routes mounted with a session store only: everything is derived from its parent.
  const derived = monter(mod, { sessionsHome: join(iso.dshHome, 'sessions'), decision: { decider: async (q, s, o) => { seen.push(o.fichierCredentials); return { ok: true } } } })
  assert.equal((await derived('GET', '/kybernos-sessions/settings')).corps.reglages.brain, 'new/brain')
  await derived('POST', '/kybernos-sessions/decision', { state: 'x', questions: { q: { type: 'choice', criteria: { a: 'x' } } } })
  assert.equal(seen[seen.length - 1], join(iso.dshHome, '.credentials.yaml'), 'the credentials follow the session store, not <HOME>/.dsh')
  ok('routes mounted with a session store derive settings, categories and credentials from its parent')

  // 4. apply(), the way DSH calls it.
  const registered = {}
  const ws = { register: (r) => { registered[r.path] = r.handler } }
  const ctx = { get: (name) => (name === 'webServer' ? ws : undefined), webServer: ws, inject: (_l, cb) => cb(ctx) }
  mod.apply(ctx)
  const viaApply = reponse()
  await registered['/kybernos-sessions/settings'](requete('GET', '/kybernos-sessions/settings'), viaApply)
  assert.equal(viaApply.corps.reglages.brain, 'new/brain')
  ok('apply() mounts the routes on $DSH_HOME')

  iso.assertDecoyUntouched('the sessions bundle')
  ok('nothing was read or written under <HOME>/.dsh (canaries and listing unchanged)')

  // 5. DSH_HOME unset: the default location is unchanged.
  iso.useDefaultHome()
  assert.equal(decision.lireCle({ env: {} }), 'decoy-key')
  assert.deepEqual(decision.lireModeleDecision(), { eteint: true, modele: 'typesafe-ai/jev' })
  const dflt = monter(mod, {})
  assert.equal((await dflt('GET', '/kybernos-sessions/settings')).corps.reglages.brain, 'decoy/brain')
  const registered2 = {}
  const ws2 = { register: (r) => { registered2[r.path] = r.handler } }
  const ctx2 = { get: (name) => (name === 'webServer' ? ws2 : undefined), webServer: ws2, inject: (_l, cb) => cb(ctx2) }
  mod.apply(ctx2)
  const viaApply2 = reponse()
  await registered2['/kybernos-sessions/settings'](requete('GET', '/kybernos-sessions/settings'), viaApply2)
  assert.equal(viaApply2.corps.reglages.brain, 'decoy/brain')
  ok('with DSH_HOME unset, key, settings and routes still use <HOME>/.dsh')

  console.log('\n' + pass + ' verifications OK')
} finally {
  iso.cleanup()
}
