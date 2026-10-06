// ── kybernos-skills honours DSH_HOME and never touches <HOME>/.dsh when it is set ──
//
// DSH's home is $DSH_HOME when set, else <os home>/.dsh. This bundle built its two
// writable roots, the toggle journal, the featured list and covers
// and the session lookup from <os home>/.dsh. With DSH_HOME set it listed, created, toggled
// and deleted skills in the user's real folder, and its "writable roots" did not even match
// the ones DSH's own registry was reading.
//
//   node kybernos-skills/test-dsh-home.mjs
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zstdCompressSync } from 'node:zlib'
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
const here = dirname(fileURLToPath(import.meta.url))
const skillMd = (name) => '---\nname: ' + name + '\ndescription: "a skill called ' + name + '"\n---\n\n# ' + name + '\n'
const session = (cwd) => zstdCompressSync(Buffer.from(JSON.stringify({ type: 'session', version: 3, id: 'x', cwd }) + '\n'))
const providers = (key) => JSON.stringify({ providers: { 'qwen-token-plan': { cle: key } } })

const iso = makeIsolation('skills')
const sandboxes = []

try {
  console.log('kybernos-skills — DSH_HOME')

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
  iso.seedDecoy('skills/decoy-on/SKILL.md', skillMd('decoy-on'))
  iso.seedDecoy('skills/decoy-off/SKILL.md.disabled', skillMd('decoy-off'))
  iso.seedDecoy('kybernos/skills-featured.json', JSON.stringify({ items: [{ name: 'decoy-feat', why: '', addedAt: '2026-09-20T10:00:00Z' }] }))
  iso.seedDecoy('kybernos/skills-featured/decoy-feat.png', 'DECOY-COVER')
  iso.seedDecoy('sessions/--proj--/session-decoyonly/session.v3.jsonl.zstd', session('/tmp/decoy-project'))
  iso.seedDecoy('kybernos-models/providers.json', providers('decoy-key'))
  iso.seedDshHome('skills/real-on/SKILL.md', skillMd('real-on'))
  iso.seedDshHome('skills/real-off/SKILL.md.disabled', skillMd('real-off'))
  iso.seedDshHome('kybernos/skills-featured.json', JSON.stringify({ items: [{ name: 'real-feat', why: '', addedAt: '2026-09-20T10:00:00Z' }] }))
  iso.seedDshHome('kybernos/skills-featured/real-feat.png', 'REAL-COVER')
  iso.seedDshHome('sessions/--proj--/session-realonly/session.v3.jsonl.zstd', session('/tmp/real-project'))
  iso.freezeDecoy()

  // A fake DSH skill registry: it lists the active skills of the DSH home it is told about.
  let registryHome = iso.dshHome
  const registry = {
    async snapshot() {
      const root = join(registryHome, 'skills')
      let names = []
      try { names = readdirSync(root) } catch (e) { names = [] }
      return {
        complete: true,
        skills: names.filter((n) => existsSync(join(root, n, 'SKILL.md'))).map((n) => ({ name: n, path: join(root, n, 'SKILL.md'), source: 'user-dsh', description: 'd' })),
      }
    },
    invalidateCache() {},
  }
  const registered = {}
  const ctx = {
    effect: (fn) => { fn() },
    inject: (_list, cb) => cb(ctx),
  }
  ctx.get = (name) => (name === 'webServer' ? { register: (r) => { registered[r.path] = r } } : (name === 'skills' ? registry : undefined))
  mod.apply(ctx)
  const call = async (method, path, body) => {
    const pathname = path.split('?')[0]
    const route = registered[pathname] ?? Object.values(registered).find((r) => r.kind === 'prefix' && pathname.startsWith(r.path + '/'))
    assert.ok(route !== undefined, 'missing route: ' + path)
    const handler = route.handler
    const res = { code: 0, raw: null, writeHead(c) { this.code = c }, end(p) { this.raw = p === undefined ? null : String(p) } }
    await handler({
      method, url: path, headers: { origin: 'http://127.0.0.1:' + PORT }, socket: { localPort: PORT },
      async *[Symbol.asyncIterator]() { if (body !== undefined) yield Buffer.from(JSON.stringify(body)) },
    }, res)
    let json = null
    try { json = JSON.parse(res.raw) } catch (e) { json = null }
    return { code: res.code, raw: res.raw, json }
  }

  // 1. The config and the roots.
  const cfg = mod.configOf()
  assert.equal(cfg.dsh, iso.dshHome)
  assert.equal(cfg.home, iso.home, 'the OS home is still where .agents lives')
  const harness = mkdtempSync(join(tmpdir(), 'kybernos-skills-harness-'))
  sandboxes.push(harness)
  assert.equal(mod.configOf({ home: harness }).dsh, join(harness, '.dsh'), 'a harness that passes its own home keeps its own .dsh')
  ok('the DSH home follows $DSH_HOME; a harness-provided home keeps its own .dsh')

  const status = await call('GET', '/kybernos-skills/status')
  assert.deepEqual(status.json.roots.map((r) => [r.path, r.source]), [[join(iso.dshHome, 'skills'), 'user-dsh'], [join(iso.home, '.agents', 'skills'), 'user-agents']])
  assert.equal(status.json.index, undefined, 'the status no longer carries a token state')
  ok('the writable roots live in $DSH_HOME')

  // 2. Reading: the catalogue and the disabled view.
  const catalogue = await mod.catalogueOf(ctx, cfg)
  assert.deepEqual(catalogue.skills.map((s) => [s.name, s.active]).sort(), [['real-off', false], ['real-on', true]])
  assert.equal(catalogue.skills.find((s) => s.name === 'real-on').writable, true, 'a skill of the DSH home is writable')
  ok('the catalogue and the disabled skills come from $DSH_HOME/skills')

  // 3. Writing: create, toggle (+ journal), refuse the decoy root.
  const made = await mod.createSkill({ ctx, name: 'made-here', description: 'created by the test', config: cfg })
  assert.equal(made.ok, true, JSON.stringify(made))
  assert.equal(existsSync(join(iso.dshHome, 'skills', 'made-here', 'SKILL.md')), true)
  const off = await mod.toggleSkill({ ctx, root: join(iso.dshHome, 'skills'), name: 'real-on', active: false, config: cfg })
  assert.equal(off.ok, true, JSON.stringify(off))
  assert.equal(existsSync(join(iso.dshHome, 'skills', 'real-on', 'SKILL.md.disabled')), true)
  const journal = JSON.parse(readFileSync(mod.journalPath(cfg), 'utf8'))
  assert.equal(mod.journalPath(cfg), join(iso.dshHome, 'kybernos-skills.json'))
  assert.equal(journal.toggles[0].name, 'real-on')
  const refused = await mod.toggleSkill({ ctx, root: join(iso.decoy, 'skills'), name: 'decoy-on', active: false, config: cfg })
  assert.equal(refused.ok, false, 'a root under <HOME>/.dsh is not a writable root while DSH_HOME is set')
  ok('create and toggle write under $DSH_HOME (journal included); the decoy root is refused')

  // 4. Featured list, covers and the session lookup, through the real routes.
  const added = await call('POST', '/kybernos-skills/featured/toggle', { name: 'made-here', action: 'add' })
  assert.equal(added.json.ok, true, added.raw)
  const featured = await call('GET', '/kybernos-skills/featured')
  assert.deepEqual(featured.json.items.map((i) => i.name).sort(), ['made-here', 'real-feat'])
  assert.equal(featured.json.path, join(iso.dshHome, 'kybernos', 'skills-featured.json'))
  assert.equal(JSON.parse(readFileSync(featured.json.path, 'utf8')).items.length, 2)
  assert.equal((await call('GET', '/kybernos-skills/cover/real-feat')).raw, 'REAL-COVER')
  assert.equal((await call('GET', '/kybernos-skills/cover/decoy-feat')).code, 404)
  ok('the featured list and its covers are read and written under $DSH_HOME')

  const real = await call('GET', '/kybernos-skills/status?sessionId=session-realonly')
  assert.equal(real.json.view.cwd, '/tmp/real-project')
  const decoyOnly = await call('GET', '/kybernos-skills/status?sessionId=session-decoyonly')
  assert.notEqual(decoyOnly.json.view.cwd, '/tmp/decoy-project', 'a session that only exists under <HOME>/.dsh is not looked up there')
  ok('a resting session is looked up in $DSH_HOME/sessions only')

  // 5. The cover generator script (a maintainer CLI) follows the same rule. No network: it
  //    either stops on a missing key or on an empty list.
  const script = join(here, 'generer-pochettes.mjs')
  const run = (extra) => spawnSync(process.execPath, [script], { encoding: 'utf8', env: { ...process.env, HOME: iso.home, USERPROFILE: iso.home, DSH_HOME: iso.dshHome, ...extra } })
  const noKey = run({})
  assert.equal(noKey.status, 1, noKey.stdout + noKey.stderr)
  assert.match(noKey.stderr, /no qwen-token-plan key/, 'the key of <HOME>/.dsh must not be used while DSH_HOME is set')
  iso.seedDshHome('kybernos-models/providers.json', providers('real-key'))
  iso.seedDshHome('kybernos/skills-featured.json', JSON.stringify({ items: [] }))
  const empty = run({})
  assert.equal(empty.status, 0, empty.stdout + empty.stderr)
  assert.match(empty.stdout, /featured list empty/)
  ok('the cover generator reads its key and its list from $DSH_HOME')

  iso.assertDecoyUntouched('the skills bundle')
  ok('nothing was read or written under <HOME>/.dsh (canaries and listing unchanged)')

  // 6. DSH_HOME unset: the default location is unchanged.
  iso.useDefaultHome()
  registryHome = iso.decoy
  const dflt = mod.configOf()
  assert.equal(dflt.dsh, iso.decoy)
  const catalogue2 = await mod.catalogueOf(ctx, dflt)
  assert.deepEqual(catalogue2.skills.map((s) => s.name).sort(), ['decoy-off', 'decoy-on'])
  const made2 = await mod.createSkill({ ctx, name: 'made-default', description: 'created by the test', config: dflt })
  assert.equal(made2.ok, true, JSON.stringify(made2))
  assert.equal(existsSync(join(iso.decoy, 'skills', 'made-default', 'SKILL.md')), true)
  assert.deepEqual((await call('GET', '/kybernos-skills/featured')).json.items.map((i) => i.name), ['decoy-feat'])
  ok('with DSH_HOME unset, roots, journal and featured list still live under <HOME>/.dsh')

  console.log('\n' + pass + ' verifications OK')
} finally {
  for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true })
  iso.cleanup()
}
