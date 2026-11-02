// test-team-instances.mjs — the launcher of a team's own DSH (docs/dev/team-profiles-cadrage.md, step 1): the home it builds, the port it keeps, the process it starts and stops, and the rule
// that stops an idle one. A stand-in script plays `dsh`: no real DSH is ever started.
//
//   node kybernos-cloud/test-team-instances.mjs
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  PERSONAL_ONLY_BUNDLES, TEAM_IDLE_MS, activeAutomationsIn, createTeamInstances, ensureTeamHome, leaveOutPersonalBundles, personalOnlyRoute, pickPort, seedOnboarding, readRegistry, retarget, shouldExit, spawnSpec, teamHomeOf, teamOfEnv, personalHomeOf, signedAddressOf } from './team-instances.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

const root = realpathSync(mkdtempSync(join(tmpdir(), 'kb-team-instances-')))
const personal = join(root, 'personal')
const plugins = join(root, 'plugins')
const standin = join(root, 'standin-dsh.mjs')
const copy = (from, to) => cpSync(from, to, { recursive: true, verbatimSymlinks: true })

// The stand-in listens on --port like `dsh web`, prints the line a mounted DSH prints, and leaves a note of its environment in its own home.
writeFileSync(standin, `import { createServer } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const args = process.argv.slice(2)
const port = Number(args[args.indexOf('--port') + 1])
mkdirSync(process.env.DSH_HOME, { recursive: true })
const keep = ['DSH_HOME', 'DSH_WEB_PORT', 'DSH_WEB_URL', 'KYBERNOS_PERSONAL_HOME', 'KYBERNOS_TEAM_ID', 'KYBERNOS_CLOUD_STATE', 'SOME_KEY']
writeFileSync(join(process.env.DSH_HOME, 'standin-env.json'), JSON.stringify({ args, env: Object.fromEntries(keep.map((k) => [k, process.env[k] ?? null])) }))
if (process.env.STANDIN_MODE === 'crash') { console.error('boom'); process.exit(1) }
const server = createServer((req, res) => { res.writeHead(401); res.end('no session') })
server.listen(port, '127.0.0.1', () => { if (process.env.STANDIN_MODE !== 'silent') console.log('dsh web: http://127.0.0.1:' + port + '/?token=SECRET') })
process.on('SIGTERM', () => server.close(() => process.exit(0)))
`)

/** A personal profile as a pnpm one is laid out: a link out of the profile by a relative path, a link inside it, the files that name the home, and the leftovers a copy must drop. */
const seedPersonal = () => {
  const profile = join(personal, 'profiles', 'web')
  mkdirSync(join(plugins, 'pkg'), { recursive: true })
  writeFileSync(join(plugins, 'pkg', 'index.js'), '// a plugin\n')
  mkdirSync(join(profile, 'node_modules', '@local'), { recursive: true })
  mkdirSync(join(profile, 'node_modules', '.pnpm', 'inner@1'), { recursive: true })
  mkdirSync(join(profile, '.plugin-manager'), { recursive: true })
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'web', dsh: { profile: { bundles: ['@local/kybernos-cloud', '@local/kybernos-relance', '@local/kybernos-miniapps', '@local/kybernos-kyber', '@local/kybernos-kaby-customisation', '@local/kybernos-mobile', '@local/kybernos-memory'] } } }, null, 2) + '\n')
  writeFileSync(join(profile, 'cordis.patch.yml'), 'mcp: ' + personal + '/mcp/horloge.mjs\nother: ' + personal + 'x/keep\n')
  writeFileSync(join(profile, 'cordis.patch.yml.bak-old'), 'old\n')
  writeFileSync(join(profile, 'node_modules', '.pnpm-workspace-state-v1.json'), JSON.stringify({ projects: { [profile]: {} } }))
  symlinkSync('../../../../../plugins/pkg', join(profile, 'node_modules', '@local', 'pkg'))
  symlinkSync('.pnpm/inner@1', join(profile, 'node_modules', 'inner'))
  mkdirSync(join(personal, 'mcp'), { recursive: true })
  writeFileSync(join(personal, 'mcp', 'horloge.mjs'), '// an MCP server\n')
}

const freeBase = await new Promise((done) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => done(p)) }) })
const instances = []
const spawned = []
const ENV_KEYS = ['KYBERNOS_DOCUMENTS_DIR', 'DSH_HOME', 'KYBERNOS_CLOUD_STATE', 'KYBERNOS_SERVERS_FILE', 'KYBERNOS_CLOUD_API', 'KYBERNOS_TEAM_DSH_BIN', 'KYBERNOS_PERSONAL_HOME', 'KYBERNOS_TEAM_ID']
const savedEnv = {}

try {
  console.log('kybernos-cloud — team DSH launcher')

  // ── names and paths ──
  assert.equal(teamHomeOf('/h', 'abc-123'), join('/h', 'teams', 'abc-123'))
  for (const bad of ['', '..', '../x', 'a/b', 'a\\b', '.hidden', 'x'.repeat(65), null, undefined, 7]) assert.equal(teamHomeOf('/h', bad), null, String(bad))
  assert.equal(teamOfEnv({ KYBERNOS_TEAM_ID: ' t1 ' }), 't1')
  assert.equal(teamOfEnv({}), '')
  assert.equal(personalHomeOf('/own', { KYBERNOS_PERSONAL_HOME: '/personal' }), '/personal')
  assert.equal(personalHomeOf('/own', { KYBERNOS_PERSONAL_HOME: 'relative' }), '/own')
  assert.equal(personalHomeOf('/own', {}), '/own')
  ok('a team id becomes a folder name only when it is a plain one; the personal home follows the environment')

  const text = 'a: /p/mcp/x\nb: /px/keep\nc: /p/teams/t1/mcp/x\nd: /p'
  assert.equal(retarget(text, '/p', '/p/teams/t1'), 'a: /p/teams/t1/mcp/x\nb: /px/keep\nc: /p/teams/t1/mcp/x\nd: /p')
  assert.equal(retarget(retarget(text, '/p', '/p/teams/t1'), '/p', '/p/teams/t1'), retarget(text, '/p', '/p/teams/t1'))
  ok('the personal home becomes the team home in a text, a similar prefix is left alone and a second pass changes nothing')

  // A name with a typo would leave a bundle of the computer in every team's profile without anyone noticing.
  for (const id of PERSONAL_ONLY_BUNDLES) {
    const dir = join(import.meta.dirname, '..', id.replace('@local/', ''))
    assert.equal(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name, id, id + ' must name a bundle of this repository')
  }
  ok('every bundle kept out of a team\'s profile is a real bundle of this repository (' + PERSONAL_ONLY_BUNDLES.length + ')')

  for (const path of ['/kybernos-cloud/kyber', '/kybernos-cloud/kyby/mandate', '/kybernos-cloud/kyby/native/set', '/kybernos-cloud/telegram/pairing', '/kybernos-cloud/whatsapp/unlink', '/kybernos-cloud/computer/open', '/kybernos-cloud/computer/claimed']) {
    assert.equal(personalOnlyRoute(path), true, path + ' belongs to the account')
  }
  for (const path of ['/kybernos-cloud/status', '/kybernos-cloud/computers', '/kybernos-cloud/computers/publish', '/kybernos-cloud/kyberx', '/kybernos-cloud/space/active', '/kybernos-cloud/team-dsh/open', '/kybernos-cloud/memory/list', '/other/kybernos-cloud/kyber', undefined, 7]) {
    assert.equal(personalOnlyRoute(path), false, String(path) + ' stays')
  }
  ok('the routes of Kaby, its Telegram and WhatsApp doors and the Home computer are told apart from the others')

  // ── the rule that stops an idle DSH ──
  const base = { now: 10 * TEAM_IDLE_MS, lastSeenAt: 0, runningReplies: 0, activeAutomations: 0 }
  assert.equal(shouldExit(base), true)
  assert.equal(shouldExit({ ...base, lastSeenAt: base.now - TEAM_IDLE_MS + 1 }), false)
  assert.equal(shouldExit({ ...base, runningReplies: 1 }), false)
  assert.equal(shouldExit({ ...base, activeAutomations: 2 }), false)
  assert.equal(shouldExit({ ...base, runningReplies: null }), false)
  assert.equal(shouldExit({ ...base, activeAutomations: null }), false)
  assert.equal(shouldExit({ ...base, lastSeenAt: undefined }), false)
  ok('an idle DSH stops only with no reply running, no active automation and no page for the idle time; anything unknown keeps it')

  const automationsHome = join(root, 'auto-home')
  mkdirSync(join(automationsHome, 'storages'), { recursive: true })
  assert.equal(activeAutomationsIn(automationsHome), 0)
  const schedule = join(automationsHome, 'storages', 'schedule.json')
  writeFileSync(schedule, JSON.stringify({ tables: { tasks: { a: { status: 'active' }, b: { status: 'inactive' }, c: { status: 'active' } } } }))
  assert.equal(activeAutomationsIn(automationsHome), 2)
  writeFileSync(schedule, '{not json')
  assert.equal(activeAutomationsIn(automationsHome), null)
  writeFileSync(schedule, JSON.stringify({ tables: {} }))
  assert.equal(activeAutomationsIn(automationsHome), null)
  ok('the active automations are counted from the engine store; an unreadable or unfamiliar file is unknown, not zero')

  // ── ports ──
  const never = async () => false
  const always = async () => true
  assert.equal(await pickPort({ remembered: 3310, taken: new Set(), isFree: always }), 3310)
  assert.equal(await pickPort({ remembered: 3310, taken: new Set([3310]), isFree: always }), 3300)
  assert.equal(await pickPort({ remembered: 3310, taken: new Set(), isFree: async (p) => p !== 3310 }), 3300)
  assert.equal(await pickPort({ remembered: 80, taken: new Set(), isFree: always }), 3300)
  assert.equal(await pickPort({ remembered: null, taken: new Set([3300, 3301]), isFree: always, first: 3300, last: 3302 }), 3302)
  assert.equal(await pickPort({ remembered: null, taken: new Set(), isFree: never }), null)
  ok('a team keeps its port; one another team holds, one that is busy and one out of range are skipped')

  // ── the spawn ──
  const spec = spawnSpec({ node: '/n', dshBin: '/b/dsh', port: 3301, teamId: 't1', teamHome: '/p/teams/t1', personalHome: '/p', env: { PATH: '/bin', KYBERNOS_CLOUD_STATE: '/p/state.json', DSH_WEB_PORT: '3080', DSH_WEB_URL: 'http://x', DSH_HOME: '/p', N: 1 } })
  assert.deepEqual(spec.args, ['/b/dsh', 'web', '--no-open', '--host', '127.0.0.1', '--port', '3301'])
  assert.deepEqual(spec.env, { PATH: '/bin', DSH_HOME: '/p/teams/t1', DSH_WEB_PORT: '3301', KYBERNOS_PERSONAL_HOME: '/p', KYBERNOS_TEAM_ID: 't1' })
  ok('a team DSH starts on loopback with its own home and port, and does not inherit the personal state or port')

  // ── the home of a team ──
  seedPersonal()
  assert.deepEqual(ensureTeamHome({ personalHome: personal, teamId: '../x', copy }), { ok: false, error: 'invalid_team' })
  assert.equal(ensureTeamHome({ personalHome: join(root, 'nowhere'), teamId: 't1', copy }).error, 'profile_missing')
  mkdirSync(join(personal, 'kybernos'), { recursive: true })
  writeFileSync(join(personal, 'kybernos', 'onboarding.json'), JSON.stringify({
    version: 1, completed: true, installedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-02T00:00:00.000Z', profil: 'lawyer', uiMode: 'simple', model: 'key', lang: 'fr', memoryId: 'mem-1',
    goals: ['draft'], customGoals: ['my own goal'], agents: 'auto', theme: 'paper', about: { site: 'https://me.example.test', profile: null, words: 'private words' },
  }))
  const made = ensureTeamHome({ personalHome: personal, teamId: 't1', copy })
  assert.equal(made.ok, true)
  assert.equal(made.created, true)
  const teamProfile = join(made.home, 'profiles', 'web')
  const link = join(teamProfile, 'node_modules', '@local', 'pkg')
  assert.equal(lstatSync(link).isSymbolicLink(), true)
  assert.equal(readlinkSync(link), join(plugins, 'pkg'), 'a link out of the profile is made absolute')
  assert.equal(readFileSync(join(link, 'index.js'), 'utf8'), '// a plugin\n', 'and it still reaches the plugin')
  assert.equal(readlinkSync(join(teamProfile, 'node_modules', 'inner')), '.pnpm/inner@1', 'a link inside the profile stays relative')
  assert.equal(existsSync(join(teamProfile, 'node_modules', 'inner')), true)
  assert.match(readFileSync(join(teamProfile, 'cordis.patch.yml'), 'utf8'), new RegExp('mcp: ' + made.home.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&') + '/mcp/horloge.mjs'))
  assert.match(readFileSync(join(teamProfile, 'cordis.patch.yml'), 'utf8'), new RegExp('other: ' + personal.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&') + 'x/keep'))
  assert.equal(JSON.parse(readFileSync(join(teamProfile, 'node_modules', '.pnpm-workspace-state-v1.json'), 'utf8')).projects[teamProfile] !== undefined, true)
  assert.equal(existsSync(join(made.home, 'mcp', 'horloge.mjs')), true)
  const wizard = JSON.parse(readFileSync(join(made.home, 'kybernos', 'onboarding.json'), 'utf8'))
  assert.deepEqual([wizard.version, wizard.completed], [1, true], 'a team\'s home opens on its work, not on the first-run wizard')
  assert.deepEqual([wizard.lang, wizard.uiMode, wizard.theme], ['fr', 'simple', 'paper'], 'the tastes of the person follow')
  assert.deepEqual([wizard.profil, wizard.memoryId, wizard.about, wizard.goals, wizard.customGoals, wizard.agents, wizard.model], [null, null, null, [], [], null, null], 'who they are and what they said about themselves stay in Personal')
  assert.equal(statSync(join(made.home, 'kybernos', 'onboarding.json')).mode & 0o777, 0o600)
  assert.equal(JSON.parse(readFileSync(join(personal, 'kybernos', 'onboarding.json'), 'utf8')).about.words, 'private words', 'the personal record is not touched')
  assert.deepEqual(JSON.parse(readFileSync(join(teamProfile, 'package.json'), 'utf8')).dsh.profile.bundles, ['@local/kybernos-cloud', '@local/kybernos-memory'], 'the bundles of the computer and of the account are not loaded by a team')
  assert.equal(JSON.parse(readFileSync(join(personal, 'profiles', 'web', 'package.json'), 'utf8')).dsh.profile.bundles.length, 7, 'the personal profile keeps them')
  assert.equal(existsSync(join(teamProfile, 'cordis.patch.yml.bak-old')), false)
  assert.equal(existsSync(join(teamProfile, '.plugin-manager')), false)
  assert.equal(existsSync(join(personal, 'profiles', 'web', 'cordis.patch.yml.bak-old')), true, 'the personal profile is left as it was')
  assert.match(readFileSync(join(personal, 'profiles', 'web', 'cordis.patch.yml'), 'utf8'), new RegExp(personal.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&') + '/mcp/horloge.mjs'))
  assert.equal(ensureTeamHome({ personalHome: personal, teamId: 't1', copy }).created, false)
  // A home made before the list grew is brought up to date the next time it is opened; the personal profile is not touched.
  const teamManifest = join(teamProfile, 'package.json')
  const older = JSON.parse(readFileSync(teamManifest, 'utf8'))
  older.dsh.profile.bundles.push('@local/kybernos-kyber', '@local/kybernos-mobile')
  writeFileSync(teamManifest, JSON.stringify(older))
  assert.equal(ensureTeamHome({ personalHome: personal, teamId: 't1', copy }).created, false)
  assert.deepEqual(JSON.parse(readFileSync(teamManifest, 'utf8')).dsh.profile.bundles, ['@local/kybernos-cloud', '@local/kybernos-memory'])
  writeFileSync(join(made.home, 'kybernos', 'onboarding.json'), JSON.stringify({ version: 1, completed: false, lang: 'de' }))
  assert.equal(ensureTeamHome({ personalHome: personal, teamId: 't1', copy }).created, false)
  assert.equal(JSON.parse(readFileSync(join(made.home, 'kybernos', 'onboarding.json'), 'utf8')).lang, 'de', 'a record the team DSH already has is never replaced')
  rmSync(join(made.home, 'kybernos', 'onboarding.json'))
  assert.equal(seedOnboarding(personal, made.home), true, 'a home that has none gets one')
  assert.equal(seedOnboarding(personal, made.home), false, 'and only once')
  rmSync(join(personal, 'kybernos', 'onboarding.json'))
  rmSync(join(made.home, 'kybernos', 'onboarding.json'))
  assert.equal(seedOnboarding(personal, made.home), true)
  assert.deepEqual([JSON.parse(readFileSync(join(made.home, 'kybernos', 'onboarding.json'), 'utf8')).completed, JSON.parse(readFileSync(join(made.home, 'kybernos', 'onboarding.json'), 'utf8')).lang], [true, null], 'with no personal record, the wizard is still done, with no taste')
  assert.equal(leaveOutPersonalBundles(teamProfile), 0, 'a second pass finds nothing to take out')
  assert.equal(leaveOutPersonalBundles(join(root, 'nowhere')), 0, 'no manifest: nothing happens')
  writeFileSync(teamManifest, '{not json')
  assert.equal(leaveOutPersonalBundles(teamProfile), 0, 'an unreadable manifest is left as it is')
  assert.equal(readFileSync(teamManifest, 'utf8'), '{not json')
  mkdirSync(join(personal, 'teams', 'stranger'), { recursive: true })
  assert.equal(ensureTeamHome({ personalHome: personal, teamId: 'stranger', copy }).error, 'home_unmarked')
  assert.equal(existsSync(join(personal, 'teams', 'stranger')), true, 'a folder the launcher did not make is never replaced')
  rmSync(join(personal, 'teams'), { recursive: true, force: true })
  ok('a team home is a copy of the profile re-pointed at itself: links, paths, MCP folder, no leftovers; the personal profile is untouched; a foreign folder is refused')

  // ── the processes ──
  const make = (extra = {}) => {
    const created = createTeamInstances({
      personalHome: () => personal,
      env: { PATH: process.env.PATH, SOME_KEY: 'k', KYBERNOS_CLOUD_STATE: '/x/state.json', DSH_WEB_PORT: '3080', ...(extra.env || {}) },
      dshBin: extra.dshBin || (() => standin),
      copy,
      ...(extra.seed !== undefined ? { seed: extra.seed } : {}),
      spawnFn: (...args) => { const child = spawn(...args); spawned.push(child); return child },
      portFirst: freeBase + 1,
      portLast: freeBase + 40,
      startTimeoutMs: extra.startTimeoutMs || 20000
    })
    instances.push(created)
    return created
  }
  const registryFile = join(personal, 'kybernos', 'team-instances.json')
  const teams = make()

  assert.equal((await teams.open('../x')).error, 'invalid_team')
  const first = await teams.open('t1')
  assert.equal(first.ok, true, JSON.stringify(first))
  assert.equal(first.started, true)
  assert.ok(first.port > freeBase && first.port <= freeBase + 40)
  assert.equal(first.url, 'http://127.0.0.1:' + first.port + '/')
  const note = JSON.parse(readFileSync(join(personal, 'teams', 't1', 'standin-env.json'), 'utf8'))
  assert.equal(note.env.DSH_HOME, join(personal, 'teams', 't1'))
  assert.equal(note.env.KYBERNOS_TEAM_ID, 't1')
  assert.equal(note.env.KYBERNOS_PERSONAL_HOME, personal)
  assert.equal(note.env.DSH_WEB_PORT, String(first.port))
  assert.equal(note.env.SOME_KEY, 'k', 'the keys of the DSH that starts it reach it')
  assert.equal(note.env.KYBERNOS_CLOUD_STATE, null)
  assert.equal(note.env.DSH_WEB_URL, null)
  assert.deepEqual(note.args.slice(0, 1), ['web'])
  assert.equal(statSync(join(personal, 'teams', 't1', 'logs', 'team-dsh.log')).mode & 0o777, 0o600)
  assert.equal(statSync(registryFile).mode & 0o777, 0o600)
  assert.deepEqual(readRegistry(registryFile).teams.t1.port, first.port)
  ok('opening a team starts its DSH on its own home and port, with the keys of the one that starts it, and records it')

  const again = await teams.open('t1')
  assert.deepEqual([again.started, again.pid, again.port], [false, first.pid, first.port])
  assert.equal(first.signed_url, 'http://127.0.0.1:' + first.port + '/?token=SECRET', 'a team that starts hands over its signed address')
  assert.equal(again.signed_url, first.signed_url, 'and so does one that was already running')
  assert.equal(spawned.length, 1)
  ok('opening a team that is running starts nothing')

  const [a, b] = await Promise.all([teams.open('t2'), teams.open('t2')])
  assert.equal(a.ok && b.ok, true)
  assert.equal(a.pid, b.pid)
  assert.equal(spawned.length, 2, 'two openings at once start one DSH')
  assert.notEqual(a.port, first.port)
  const other = make()
  const third = await other.open('t2')
  assert.deepEqual([third.started, third.pid], [false, a.pid], 'another DSH asking about the same team finds the one that runs')
  assert.deepEqual((await teams.list()).map((row) => [row.team_id, row.running]).sort(), [['t1', true], ['t2', true]])
  ok('two openings at once start one DSH, two teams get two ports, and any DSH sees the same registry')

  const stopped = await teams.stop('t1')
  assert.deepEqual(stopped, { ok: true, stopped: true })
  assert.equal((await teams.status('t1')).running, false)
  assert.equal(readRegistry(registryFile).teams.t1, undefined)
  assert.deepEqual(await teams.stop('t1'), { ok: true, stopped: false })
  await teams.stop('t2')
  // Without a memory the lowest free port would go to whoever asks first: t2 must get back the one it had, then t1.
  const back2 = await teams.open('t2')
  assert.deepEqual([back2.ok, back2.started, back2.port], [true, true, a.port], 'a team gets its port back')
  const back1 = await teams.open('t1')
  assert.deepEqual([back1.ok, back1.started, back1.port], [true, true, first.port])
  ok('a team is stopped, forgotten as a process, and comes back on the same port')

  const crashing = make({ env: { STANDIN_MODE: 'crash' } })
  const crashed = await crashing.open('t3')
  assert.equal(crashed.error, 'start_failed')
  assert.equal(readRegistry(registryFile).teams.t3, undefined)
  const silent = make({ env: { STANDIN_MODE: 'silent' }, startTimeoutMs: 1200 })
  const waited = await silent.open('t4')
  assert.equal(waited.error, 'start_timeout')
  assert.equal(readRegistry(registryFile).teams.t4, undefined)
  assert.equal((await make({ dshBin: () => null }).open('t5')).error, 'dsh_not_found')
  ok('a DSH that dies, one that never says it is ready and a missing dsh are refused with a word, and leave nothing in the registry')

  for (const id of ['t1', 't2']) await teams.stop(id)
  assert.equal((await teams.list()).length, 0)

  // ── the seed: what a new home starts from ──
  const seeds = []
  const seeding = make({ seed: (args) => { seeds.push(args); return { ok: true } } })
  const seededOpen = await seeding.open('t6')
  assert.equal(seededOpen.ok, true, JSON.stringify(seededOpen))
  assert.deepEqual(seeds.map((s) => [s.teamId, s.teamHome, s.personalHome]), [['t6', join(personal, 'teams', 't6'), personal]], 'the seed runs once, on the home, before the start')
  assert.equal((await seeding.open('t6')).started, false)
  assert.equal(seeds.length, 2, 'it runs again when the DSH is already up (a sign-out there is followed by a fresh copy)')
  await seeding.stop('t6')
  const before = spawned.length
  const refused = await make({ seed: () => ({ ok: false, error: 'non_connecte' }) }).open('t7')
  assert.equal(refused.error, 'non_connecte')
  assert.equal((await make({ seed: () => { throw new Error('disk') } }).open('t8')).error, 'seed_failed')
  assert.equal(spawned.length, before, 'a refused seed starts nothing')
  assert.equal(readRegistry(registryFile).teams.t7, undefined)
  ok('a seed runs before the start and at every opening, and a refusal or a failure of it starts nothing')

  const log = 'noise\ndsh web: http://127.0.0.1:3301/?token=old\nmore\ndsh web: http://127.0.0.1:3301/?token=new  \n'
  assert.equal(signedAddressOf(log, 3301), 'http://127.0.0.1:3301/?token=new', 'the last address of the log')
  assert.equal(signedAddressOf(log, 3302), null, 'an address of another port is never handed out')
  assert.equal(signedAddressOf('dsh web: http://evil.test:3301/?token=x\n', 3301), null)
  assert.equal(signedAddressOf('', 3301), null)
  assert.equal(signedAddressOf(undefined, 3301), null)
  ok('the signed address is the last one the log printed for this port, and nothing else')

  // ── the routes of the plugin, on a made-up account ──
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key]
  const statePath = join(root, 'kybernos-cloud.json')
  Object.assign(process.env, { DSH_HOME: personal, KYBERNOS_CLOUD_STATE: statePath, KYBERNOS_SERVERS_FILE: join(root, 'servers.json'), KYBERNOS_CLOUD_API: 'http://127.0.0.1:9', KYBERNOS_TEAM_DSH_BIN: standin })
  for (const key of ['KYBERNOS_PERSONAL_HOME', 'KYBERNOS_TEAM_ID']) delete process.env[key]
  const mod = await import('./index.js')
  const route = (path) => mod.ROUTES.find((r) => r.path === path)
  const call = (path, body) => route(path).run({ headers: {} }, body)

  for (const path of ['/kybernos-cloud/team-dsh/open', '/kybernos-cloud/team-dsh/stop']) {
    const r = route(path)
    assert.deepEqual([r.method, r.guarded, r.strict, r.session, r.body], ['POST', true, true, true, true], path + ' writes on the person\'s behalf')
  }
  assert.deepEqual([route('/kybernos-cloud/team-dsh/list').method, route('/kybernos-cloud/team-dsh/list').guarded], ['GET', true])
  assert.equal((await call('/kybernos-cloud/team-dsh/open', { workspace_id: 't1' })).error, 'non_connecte')
  writeFileSync(statePath, JSON.stringify({
    token: 'kys-' + 'o'.repeat(43),
    api: 'http://127.0.0.1:9',
    user: { id: 'u-1', name: 'Ada', email: 'ada@example.test' },
    workspaces: [{ id: 'w-personal', name: 'Ada', personal: true }, { id: 't1', name: 'Acme', personal: false }]
  }))
  for (const [body, error] of [[{}, 'espace_inconnu'], [{ workspace_id: 'nope' }, 'espace_inconnu'], [{ workspace_id: 7 }, 'espace_inconnu'], [{ workspace_id: 'w-personal' }, 'espace_personnel']]) {
    assert.equal((await call('/kybernos-cloud/team-dsh/open', body)).error, error, JSON.stringify(body))
  }
  const opened = await call('/kybernos-cloud/team-dsh/open', { workspace_id: 't1' })
  assert.equal(opened.ok, true, JSON.stringify(opened))
  assert.equal(opened.started, true)
  assert.deepEqual((await call('/kybernos-cloud/team-dsh/list')).teams.map((row) => [row.team_id, row.running]), [['t1', true]])
  assert.equal(existsSync(join(personal, 'teams', 't1', 'team-home.json')), true)
  const stateOf = (team) => readdirSync(join(personal, 'teams', team)).filter((n) => /^kybernos-cloud.*\.json$/u.test(n))
  const seededFile = join(personal, 'teams', 't1', stateOf('t1')[0])
  const seededState = JSON.parse(readFileSync(seededFile, 'utf8'))
  assert.equal(stateOf('t1').length, 1, 'one connection file in the team home')
  assert.equal(seededState.token, 'kys-' + 'o'.repeat(43), 'the team starts signed in as the person')
  assert.equal(seededState.active_workspace_id, 't1', 'and with its team as the active space')
  assert.deepEqual(Object.keys(seededState).filter((k) => ['workspaces', 'models', 'space_plan', 'device_secret'].includes(k)), [], 'the list of teams, the model record and the plan are read by the team DSH itself')
  assert.equal(statSync(seededFile).mode & 0o777, 0o600)
  assert.equal(JSON.parse(readFileSync(statePath, 'utf8')).active_workspace_id, undefined, 'the personal connection is not touched')
  writeFileSync(seededFile, JSON.stringify({ ...seededState, marker: 'kept' }))
  await call('/kybernos-cloud/team-dsh/open', { workspace_id: 't1' })
  assert.equal(JSON.parse(readFileSync(seededFile, 'utf8')).marker, 'kept', 'a connection the team DSH already has is never overwritten')
  rmSync(seededFile)
  await call('/kybernos-cloud/team-dsh/open', { workspace_id: 't1' })
  assert.equal(JSON.parse(readFileSync(seededFile, 'utf8')).token, seededState.token, 'after a sign-out there, the next opening copies it again')
  ok('a team home starts signed in with the person\'s session and its team as active space, once, and never touches the personal connection')
  assert.deepEqual(await call('/kybernos-cloud/team-dsh/stop', { workspace_id: 't1' }), { ok: true, stopped: true })
  assert.deepEqual((await call('/kybernos-cloud/team-dsh/list')).teams, [])
  ok('the routes refuse what is not a team of this account, open and stop one, and are guarded like the other writes')

  // ── in a team's own DSH the team is fixed ──
  savedEnv.KYBERNOS_DOCUMENTS_DIR = process.env.KYBERNOS_DOCUMENTS_DIR
  process.env.KYBERNOS_DOCUMENTS_DIR = join(root, 'Docs')
  const t2dir = join(root, 'Docs', 'Kybernos', 'T2')
  mkdirSync(t2dir, { recursive: true })
  const stateNow = JSON.parse(readFileSync(statePath, 'utf8'))
  writeFileSync(statePath, JSON.stringify({ ...stateNow, workspaces: [...stateNow.workspaces, { id: 't2', name: 'Other', personal: false }] }))
  writeFileSync(join(root, 'kybernos-cloud-folders.json'), JSON.stringify({ t2: t2dir }))
  const asked = await call('/kybernos-cloud/space/for-folder', { path: t2dir })
  assert.deepEqual([asked.ok, asked.space_id, asked.follow], [true, 't2', true], 'in the personal DSH the active space follows the folder of the chat')
  // The record of the folders is the personal home's, whichever DSH reads it (here the personal connection file is elsewhere, so the two places differ).
  writeFileSync(join(personal, 'kybernos-cloud-folders.json'), JSON.stringify({ t2: t2dir }))
  assert.equal((await route('/kybernos-cloud/status').run({ headers: {} })).state.team_dsh, null, 'the personal DSH is no team\'s')
  assert.equal((await call('/kybernos-cloud/team-dsh/personal')).url, 'http://127.0.0.1:3080/', 'the default port while the personal DSH has not said which')
  mkdirSync(join(personal, 'kybernos'), { recursive: true })
  writeFileSync(join(personal, 'kybernos', 'personal-dsh.json'), JSON.stringify({ port: 3091 }))
  process.env.KYBERNOS_TEAM_ID = 't1'
  process.env.KYBERNOS_PERSONAL_HOME = personal
  const fixed = await call('/kybernos-cloud/space/for-folder', { path: t2dir })
  assert.deepEqual([fixed.ok, fixed.space_id, fixed.active_id, fixed.follow], [true, 't2', 't1', false], 'in a team DSH nothing follows a chat: its active space is its team')
  for (const other of ['w-personal', 't2', 'nope']) assert.equal((await call('/kybernos-cloud/space/active', { workspace_id: other })).error, 'espace_fixe', other)
  const status = await route('/kybernos-cloud/status').run({ headers: {} })
  assert.equal(status.state.active_workspace_id, 't1', 'the footer and the plan card read the team')
  assert.equal(status.state.team_dsh, 't1', 'and the page learns it is in a team\'s own DSH')
  assert.equal((await call('/kybernos-cloud/team-dsh/personal')).url, 'http://127.0.0.1:3091/', 'a team\'s DSH sends "Personal" to the personal DSH, where it said it answers')
  writeFileSync(join(personal, 'kybernos', 'personal-dsh.json'), JSON.stringify({ port: 'x' }))
  assert.equal((await call('/kybernos-cloud/team-dsh/personal')).url, 'http://127.0.0.1:3080/', 'a record that is not a port is ignored')
  ok('in a team\'s own DSH the active space is the team: no switch, no follow-the-chat')

  // Leaving a team's DSH must not revoke the session it shares with the personal one.
  let revokes = 0
  const api = createHttpServer((req, res) => { if (req.method === 'DELETE' && req.url === '/v1/session') revokes += 1; res.writeHead(204); res.end() })
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve))
  process.env.KYBERNOS_CLOUD_API = 'http://127.0.0.1:' + api.address().port
  const connected = readFileSync(statePath, 'utf8')
  assert.equal((await call('/kybernos-cloud/disconnect', {})).ok, true)
  assert.equal(revokes, 0, 'a team DSH signs itself out without revoking the shared session')
  assert.equal(existsSync(statePath), false)
  delete process.env.KYBERNOS_TEAM_ID
  writeFileSync(statePath, connected)
  assert.equal((await call('/kybernos-cloud/disconnect', {})).revoked, true)
  assert.equal(revokes, 1, 'the personal DSH revokes it')
  api.close()
  ok('signing out of a team\'s DSH does not revoke the session the personal DSH uses')
  delete process.env.KYBERNOS_TEAM_ID
  delete process.env.KYBERNOS_PERSONAL_HOME

  console.log('\n' + pass + ' verifications OK')
} finally {
  for (const key of ENV_KEYS) { if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key] }
  for (const instance of instances) { try { for (const row of await instance.list()) await instance.stop(row.team_id) } catch (e) { /* the folder is removed below */ } }
  for (const child of spawned) { try { child.kill('SIGKILL') } catch (e) { /* already gone */ } }
  rmSync(root, { recursive: true, force: true })
}

// index.js keeps timers of its own; the test is over.
process.exit(0)
