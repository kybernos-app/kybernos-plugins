// ── The core plugin honours DSH_HOME and never touches <HOME>/.dsh when it is set ──
//
// DSH's home is $DSH_HOME when set, else <os home>/.dsh. Several places of the core plugin
// built paths from $HOME or homedir() plus '.dsh': the kyber.yml writer (with a .bak), the
// beta-report outbox and the cloud state it reads its token from, the feedback skill it
// installs at boot, the declared-kyber scan behind /kybernos/calls, the ZCode MCP server
// path of the Tools tab, and the "force de proposition" rule appended to AGENTS.md. With
// DSH_HOME set, an isolated instance read and wrote the user's real folder.
//
// The routes are driven through the real apply(), on a fake context: no network, no DSH.
// The scheduled-tasks store is out of scope here (it resolves through dshHome() already).
//
// The plugin is loaded from a scratch copy of its folder (without client.js and the tests)
// because the feedback skill it installs at boot is read from `skills/signaler-retour/`
// next to it, a source this repository does not carry: the copy gets a stand-in.
//
//   node kybernos-plugin/test-dsh-home.mjs
import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
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
const YML = 'topology: pool\nmission: test\nstages:\n  - id: a\n    roles: [x]\n'
const cloudState = (token) => JSON.stringify({ token, api: 'http://127.0.0.1:9' })

// The two test-only overrides stay UNSET: the point is the default location.
delete process.env.KYBERNOS_CLOUD_STATE

const iso = makeIsolation('plugin')
const disposers = []

const here = dirname(fileURLToPath(import.meta.url))
const copy = mkdtempSync(join(tmpdir(), 'kybernos-plugin-copy-'))
for (const file of readdirSync(here)) {
  if (file === 'client.js' || file.startsWith('test-') || statSync(join(here, file)).isFile() === false) continue
  copyFileSync(join(here, file), join(copy, file))
}
mkdirSync(join(copy, 'skills', 'signaler-retour'), { recursive: true })
const SKILL_TEXT = '---\nname: signaler-retour\ndescription: a stand-in for the test\n---\n'
writeFileSync(join(copy, 'skills', 'signaler-retour', 'SKILL.md'), SKILL_TEXT)
const load = (file) => import(pathToFileURL(join(copy, file)).href)

try {
  console.log('kybernos-plugin — DSH_HOME')

  iso.useDshHome()
  const dshHomeMod = await load('dsh-home.mjs')
  const proposition = await load('agents-proposition.mjs')
  const mod = await load('index.js')

  const { dshHomeSync } = dshHomeMod
  assert.equal(dshHomeSync({ DSH_HOME: '' }, () => '/h'), join('/h', '.dsh'))
  assert.equal(dshHomeSync({ DSH_HOME: '   ' }, () => '/h'), join('/h', '.dsh'))
  assert.equal(dshHomeSync({}, () => '/h'), join('/h', '.dsh'))
  assert.equal(dshHomeSync({ DSH_HOME: '  /srv/dsh  ' }, () => '/h'), '/srv/dsh')
  assert.equal(dshHomeSync({ DSH_HOME: '~' }, () => '/h'), '/h')
  assert.equal(dshHomeSync({ DSH_HOME: '~/alt' }, () => '/h'), join('/h', 'alt'))
  ok('the resolver follows the DSH rule (blank = unset, ~ expanded, trimmed)')

  // DSH_HOME set, HOME elsewhere with a decoy full of canaries.
  iso.seedDecoy('AGENTS.md', '# the user\'s own agent rules\n')
  iso.seedDecoy('kybernos-cloud.json', cloudState('tok-decoy'))
  iso.seedDecoy('kybers/decoy-kyber/kyber.yml', YML)
  iso.seedDecoy('mcp/zcode-mcp-server.mjs', '// decoy\n')
  iso.seedDshHome('kybernos-cloud.json', cloudState('tok-real'))
  iso.seedDshHome('kybers/real-kyber/kyber.yml', YML)
  iso.seedDshHome('kybers/existing-kyber/kyber.yml', 'topology: pool\nmission: before\n')
  iso.freezeDecoy()

  // 1. The module-level helpers.
  const laid = proposition.poserForceProposition()
  assert.equal(laid.etat, 'pose', JSON.stringify(laid))
  assert.equal(laid.chemin, join(iso.dshHome, 'AGENTS.md'))
  assert.match(readFileSync(laid.chemin, 'utf8'), /kybernos:force-proposition/)
  ok('the "force de proposition" rule is appended to $DSH_HOME/AGENTS.md')

  const posts = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    posts.push({ url, auth: init.headers.authorization })
    return { status: 201, text: async () => JSON.stringify({ issue: { url: 'https://example.invalid/issues/1' } }) }
  }
  let sent
  try { sent = await mod.kbFeedbackExecute({ kind: 'bug', title: 'a title', body: 'a body' }) } finally { globalThis.fetch = realFetch }
  assert.equal(sent.ok, true, JSON.stringify(sent))
  assert.deepEqual(posts.map((p) => p.auth), ['Bearer tok-real'], 'the token must come from $DSH_HOME/kybernos-cloud.json')
  assert.equal(sent.outbox_file.startsWith(join(iso.dshHome, 'beta-reports') + '/'), true, sent.outbox_file)
  assert.equal(JSON.parse(readFileSync(sent.outbox_file, 'utf8')).status, 'envoye')
  ok('a beta report reads the cloud token from, and traces itself in, $DSH_HOME')

  // 2. The routes, through the real apply() on a fake context.
  const registered = {}
  const webServer = { register: (r) => { registered[r.path] = r.handler; return () => { delete registered[r.path] } } }
  const persistence = { open: async () => ({ read: async () => ({ events: [] }), close: async () => {} }) }
  const services = { fs: {}, webServer, sessionPersistence: persistence }
  const ctx = {
    get: (name) => services[name],
    inject: () => {},
    effect: (fn) => { const d = fn(); if (typeof d === 'function') disposers.push(d); return d },
    on: () => {},
  }
  mod.apply(ctx)
  const call = async (method, path, body) => {
    const handler = registered[path.split('?')[0]]
    assert.ok(handler !== undefined, 'missing route: ' + path)
    const res = { code: 0, raw: null, writeHead(c) { this.code = c }, end(p) { this.raw = p === undefined ? null : String(p) } }
    await handler({
      method, url: path, headers: { origin: 'http://127.0.0.1:' + PORT, host: '127.0.0.1:' + PORT }, socket: { localPort: PORT },
      async *[Symbol.asyncIterator]() { if (body !== undefined) yield Buffer.from(JSON.stringify(body)) },
    }, res)
    let json = null
    try { json = JSON.parse(res.raw) } catch (e) { json = null }
    return { code: res.code, json, raw: res.raw }
  }

  const skill = join(iso.dshHome, 'skills', 'signaler-retour', 'SKILL.md')
  assert.equal(existsSync(skill), true, 'the feedback skill must be installed under $DSH_HOME/skills at boot')
  assert.equal(readFileSync(skill, 'utf8'), SKILL_TEXT)
  ok('the feedback skill is installed under $DSH_HOME/skills at boot')

  const calls = await call('GET', '/kybernos/calls?sessionId=session-aaaaaaaa')
  assert.equal(calls.json.ok, true, calls.raw)
  assert.deepEqual(calls.json.kyberIds.sort(), ['existing-kyber', 'real-kyber'], 'the declared kybers come from $DSH_HOME/kybers')
  ok('the declared kybers behind /kybernos/calls are read from $DSH_HOME/kybers')

  const wrote = await call('POST', '/kybernos/yml-appliquer', { kyberId: 'existing-kyber', yml: YML })
  assert.equal(wrote.json.ok, true, wrote.raw)
  assert.equal(wrote.json.path, join(iso.dshHome, 'kybers', 'existing-kyber', 'kyber.yml'))
  assert.equal(readFileSync(wrote.json.path, 'utf8'), YML)
  assert.equal(readFileSync(wrote.json.backup, 'utf8'), 'topology: pool\nmission: before\n', 'the previous kyber.yml is kept as .bak next to it')
  const fresh = await call('POST', '/kybernos/yml-appliquer', { kyberId: 'brand-new', yml: YML })
  assert.equal(fresh.json.ok, true, fresh.raw)
  assert.equal(existsSync(join(iso.dshHome, 'kybers', 'brand-new', 'kyber.yml')), true)
  ok('a kyber.yml (and its .bak) is written under $DSH_HOME/kybers')

  const zcode = (await call('GET', '/kybernos/tools/state')).json.entries.find((e) => e.id === 'zcode')
  assert.equal(zcode.installed, false, 'the ZCode MCP server of <HOME>/.dsh is not the one of $DSH_HOME')
  iso.seedDshHome('mcp/zcode-mcp-server.mjs', '// real\n')
  const zcodeAfter = (await call('GET', '/kybernos/tools/state')).json.entries.find((e) => e.id === 'zcode')
  assert.equal(zcodeAfter.installed, true, 'the server installed under $DSH_HOME/mcp is seen')
  ok('the ZCode MCP server path of the Tools tab is $DSH_HOME/mcp, never <HOME>/.dsh/mcp')

  iso.assertDecoyUntouched('the core plugin')
  ok('nothing was read or written under <HOME>/.dsh (canaries and listing unchanged)')

  // 3. DSH_HOME unset: the default location is unchanged.
  iso.useDefaultHome()
  assert.equal(dshHomeSync(), iso.decoy)
  const laid2 = proposition.poserForceProposition()
  assert.equal(laid2.chemin, join(iso.decoy, 'AGENTS.md'))
  assert.equal(laid2.etat, 'pose')
  assert.match(readFileSync(laid2.chemin, 'utf8'), /^# the user's own agent rules/)
  posts.length = 0
  globalThis.fetch = async (url, init) => { posts.push({ auth: init.headers.authorization }); return { status: 201, text: async () => JSON.stringify({ issue: { url: 'https://example.invalid/issues/2' } }) } }
  let sent2
  try { sent2 = await mod.kbFeedbackExecute({ kind: 'bug', title: 'a title', body: 'a body' }) } finally { globalThis.fetch = realFetch }
  assert.equal(sent2.ok, true, JSON.stringify(sent2))
  assert.deepEqual(posts.map((p) => p.auth), ['Bearer tok-decoy'])
  assert.equal(sent2.outbox_file.startsWith(join(iso.decoy, 'beta-reports') + '/'), true)
  const wrote2 = await call('POST', '/kybernos/yml-appliquer', { kyberId: 'decoy-kyber', yml: YML })
  assert.equal(wrote2.json.path, join(iso.decoy, 'kybers', 'decoy-kyber', 'kyber.yml'))
  assert.deepEqual((await call('GET', '/kybernos/calls?sessionId=session-aaaaaaaa')).json.kyberIds.sort(), ['decoy-kyber'])
  ok('with DSH_HOME unset, the same helpers and routes still use <HOME>/.dsh')

  console.log('\n' + pass + ' verifications OK')
} finally {
  for (const dispose of disposers) { try { dispose() } catch (e) { /* best effort */ } }
  rmSync(copy, { recursive: true, force: true })
  iso.cleanup()
}
// The plugin may leave timers running (bridge tick, trim): the test is over.
process.exit(0)
