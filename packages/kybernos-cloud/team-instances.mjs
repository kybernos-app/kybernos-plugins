// kybernos-cloud — one DSH per team (docs/dev/team-profiles-cadrage.md, step 1). The disk, the processes, the network and the clock are injected, so
// test-team-instances.mjs plays all of it with a stand-in `dsh` and never starts a real one.
//
// A team's DSH is a whole second DSH: its own home (`<personal home>/teams/<team id>`), its own port, its own copy of the profile. It starts the first time the
// person opens the team (`open`) and stops by itself when it has nothing to do (`shouldExit`). The personal DSH never stops.
import { execFileSync, spawn } from 'node:child_process'
import { closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { createServer } from 'node:net'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'

export const TEAM_PORT_FIRST = 3300
export const TEAM_PORT_LAST = 3399
export const TEAM_PROFILE = 'web'
/** How long a team's DSH may sit with no page open, no reply running and no active automation before it stops. */
export const TEAM_IDLE_MS = 30 * 60 * 1000
const START_TIMEOUT_MS = 90 * 1000
const STOP_GRACE_MS = 10 * 1000
const READY_LINE = 'dsh web: http'

/** The address `dsh web` printed for its last run (`dsh web: http://127.0.0.1:PORT/?token=…`), the one that signs a browser in; null when the log has none for this port. It is the person's alone: it goes to
 *  the page that asked for the team, never to a log or a file of ours. */
export const signedAddressOf = (logText, port) => {
  const lines = String(logText === undefined || logText === null ? '' : logText).split('\n').filter((line) => line.includes(READY_LINE))
  if (lines.length === 0) return null
  const last = lines[lines.length - 1]
  const found = last.slice(last.indexOf('http')).trim().split(/\s+/u)[0]
  return found.startsWith('http://127.0.0.1:' + port + '/') ? found : null
}
/** What a team's DSH must not inherit from the DSH that starts it: those would point it back at the personal home or the personal port. */
const NOT_INHERITED = ['KYBERNOS_CLOUD_STATE', 'DSH_WEB_PORT', 'DSH_WEB_URL']

/** Bundles that belong to the computer and not to a team: the tool that restarts the personal DSH on :3080, and the one that installs apps and LaunchAgents under the person's own
 *  folders. A team's DSH does not load them. The others were read on 2026-11-02 (docs/dev/team-profiles-cadrage.md, step 1b): none starts a machine-level service by itself,
 *  each keeps its state in its own DSH home, and none binds a fixed port. Add one here only when it does. */
export const PERSONAL_ONLY_BUNDLES = ['@local/kybernos-relance', '@local/kybernos-miniapps']

const TEAM_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u

/** The home of a team's DSH, or null when the id is not one this plugin would have been given (it becomes a folder name). */
export const teamHomeOf = (personalHome, teamId) => (typeof teamId === 'string' && TEAM_ID_RE.test(teamId) && !teamId.includes('..') ? join(personalHome, 'teams', teamId) : null)

/** The team a DSH was started for (set by `spawnSpec`), '' in the personal DSH. */
export const teamOfEnv = (env = process.env) => (typeof env.KYBERNOS_TEAM_ID === 'string' ? env.KYBERNOS_TEAM_ID.trim() : '')

/** The personal home: where the registry lives and what a team's profile is copied from. A team's DSH is told it (KYBERNOS_PERSONAL_HOME), so any DSH can open any team. */
export const personalHomeOf = (ownHome, env = process.env) => {
  const given = typeof env.KYBERNOS_PERSONAL_HOME === 'string' ? env.KYBERNOS_PERSONAL_HOME.trim() : ''
  return given !== '' && isAbsolute(given) ? given : ownHome
}

// ── the registry: which team has which port and process ───────────────────────────────────────────────────────

const emptyRegistry = () => ({ version: 1, teams: {}, ports: {} })

/** `teams`: the DSH that run (port, process, start time); `ports`: the port each team had last, kept after it stops so that its address does not change. */
export const readRegistry = (file) => {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || parsed.teams === null || typeof parsed.teams !== 'object') return emptyRegistry()
    const teams = {}
    for (const [id, row] of Object.entries(parsed.teams)) {
      if (row !== null && typeof row === 'object' && Number.isInteger(row.port) && Number.isInteger(row.pid)) teams[id] = { port: row.port, pid: row.pid, started_at: Number.isFinite(row.started_at) ? row.started_at : 0 }
    }
    const ports = {}
    if (parsed.ports !== null && typeof parsed.ports === 'object') for (const [id, port] of Object.entries(parsed.ports)) if (Number.isInteger(port)) ports[id] = port
    return { version: 1, teams, ports }
  } catch (e) { return emptyRegistry() }
}

export const writeRegistry = (file, registry) => {
  mkdirSync(dirname(file), { recursive: true })
  const temp = file + '.tmp-' + process.pid
  writeFileSync(temp, JSON.stringify(registry, null, 2) + '\n', { mode: 0o600 })
  renameSync(temp, file)
}

// ── port ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** A team keeps its port from one start to the next (its address stays the same); a port another team holds, or one that is busy, is skipped. */
export const pickPort = async ({ remembered, taken, isFree, first = TEAM_PORT_FIRST, last = TEAM_PORT_LAST }) => {
  const usable = async (port) => Number.isInteger(port) && port >= first && port <= last && !taken.has(port) && (await isFree(port)) === true
  if (await usable(remembered)) return remembered
  for (let port = first; port <= last; port += 1) if (await usable(port)) return port
  return null
}

export const portIsFree = (port) => new Promise((done) => {
  const server = createServer()
  server.once('error', () => done(false))
  server.listen(port, '127.0.0.1', () => server.close(() => done(true)))
})

/** Does something answer HTTP on this port the way a DSH does (a page, a redirect, or a refusal for a visitor with no session)? */
export const answers = (port) => new Promise((done) => {
  const req = request({ host: '127.0.0.1', port, path: '/', method: 'GET', timeout: 2000 }, (res) => {
    res.resume()
    done(res.statusCode >= 200 && res.statusCode < 500)
  })
  req.once('error', () => done(false))
  req.once('timeout', () => { req.destroy(); done(false) })
  req.end()
})

// ── what starts, and when it stops ─────────────────────────────────────────────────────────────────────────────

/** The command, arguments and environment that start a team's DSH. */
export const spawnSpec = ({ node, dshBin, port, teamId, teamHome, personalHome, env }) => {
  const childEnv = {}
  for (const [key, value] of Object.entries(env)) if (typeof value === 'string' && !NOT_INHERITED.includes(key)) childEnv[key] = value
  Object.assign(childEnv, { DSH_HOME: teamHome, DSH_WEB_PORT: String(port), KYBERNOS_PERSONAL_HOME: personalHome, KYBERNOS_TEAM_ID: teamId })
  return { command: node, args: [dshBin, 'web', '--no-open', '--host', '127.0.0.1', '--port', String(port)], env: childEnv }
}

/** Should a team's DSH stop now? Only when nothing needs it: no reply running, no active automation, no page seen for `idleMs`. Anything unknown (null) keeps it alive:
 *  a team's automations must never stop because a probe failed. */
export const shouldExit = ({ now, lastSeenAt, idleMs = TEAM_IDLE_MS, runningReplies, activeAutomations }) => {
  if (!Number.isInteger(runningReplies) || !Number.isInteger(activeAutomations)) return false
  if (runningReplies > 0 || activeAutomations > 0) return false
  return Number.isFinite(lastSeenAt) && now - lastSeenAt >= idleMs
}

/** How many automations of this DSH home are active, read from the engine's own schedule store (`storages/schedule.json`, rows with `status: 'active'`, engine 0.2.2-alpha.2).
 *  No file is no automation; a file that cannot be read or has another shape is null (unknown). */
export const activeAutomationsIn = (home) => {
  const file = join(home, 'storages', 'schedule.json')
  if (!existsSync(file)) return 0
  try {
    const tasks = JSON.parse(readFileSync(file, 'utf8')).tables.tasks
    if (tasks === null || typeof tasks !== 'object') return null
    return Object.values(tasks).filter((row) => row !== null && typeof row === 'object' && row.status === 'active').length
  } catch (e) { return null }
}

// ── the home of a team ─────────────────────────────────────────────────────────────────────────────────────────

/** Copies a folder with copy-on-write where the file system has it (macOS APFS `cp -c`, Linux `--reflink=auto`): the copy of a 1 GB profile costs next to nothing and symbolic links stay links. */
export const copyTree = (from, to) => {
  if (process.platform === 'darwin') execFileSync('cp', ['-cR', from, to])
  else if (process.platform === 'win32') cpSync(from, to, { recursive: true, verbatimSymlinks: true })
  else execFileSync('cp', ['-R', '--reflink=auto', from, to])
}

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')

/** A text with every path of the personal home pointed at the team's home instead (and a path already inside it left alone: running it twice changes nothing more). */
export const retarget = (text, personalHome, teamHome) => text.replace(new RegExp(escapeRe(personalHome) + '(?=/)(?!/teams/)', 'gu'), teamHome)

/** The links of `<profile>/node_modules` (one level, and one inside a scope) that point out of the profile by a relative path. A copy at another depth breaks them: they are made absolute. */
const relinkEscaping = (fromProfile, toProfile) => {
  const modules = join(fromProfile, 'node_modules')
  if (!existsSync(modules)) return 0
  let relinked = 0
  const visit = (dir, depth) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.pnpm' || entry.name === '.bin') continue
      const source = join(dir, entry.name)
      if (entry.isSymbolicLink()) {
        const target = readlinkSync(source)
        if (isAbsolute(target)) continue
        const real = resolve(dirname(source), target)
        if (real === fromProfile || real.startsWith(fromProfile + sep)) continue
        const copy = join(toProfile, 'node_modules', source.slice(modules.length + 1))
        unlinkSync(copy)
        symlinkSync(real, copy)
        relinked += 1
      } else if (entry.isDirectory() && depth === 0 && entry.name.startsWith('@')) visit(source, 1)
    }
  }
  visit(modules, 0)
  return relinked
}

/** Makes the home of a team: a copy of the personal profile and of the MCP folder, re-pointed at the team's own folders. Done in a temporary folder and renamed, so a home is either whole or absent.
 *  `{ ok: true, created }`, or `{ ok: false, error }` (`profile_missing`, `home_failed`). */
export const ensureTeamHome = ({ personalHome, teamId, profile = TEAM_PROFILE, copy = copyTree }) => {
  const home = teamHomeOf(personalHome, teamId)
  if (home === null) return { ok: false, error: 'invalid_team' }
  const marker = join(home, 'team-home.json')
  if (existsSync(marker)) return { ok: true, created: false, home }
  // A folder with no marker is not one this made: it is never replaced.
  if (existsSync(home)) return { ok: false, error: 'home_unmarked' }
  const fromProfile = join(personalHome, 'profiles', profile)
  if (!existsSync(join(fromProfile, 'package.json'))) return { ok: false, error: 'profile_missing' }
  const building = home + '.building-' + process.pid
  try {
    rmSync(building, { recursive: true, force: true })
    mkdirSync(join(building, 'profiles'), { recursive: true, mode: 0o700 })
    const profileCopy = join(building, 'profiles', profile)
    copy(fromProfile, profileCopy)
    for (const entry of readdirSync(profileCopy)) if (entry.includes('.bak')) rmSync(join(profileCopy, entry), { recursive: true, force: true })
    rmSync(join(profileCopy, '.plugin-manager'), { recursive: true, force: true })
    if (existsSync(join(personalHome, 'mcp'))) copy(join(personalHome, 'mcp'), join(building, 'mcp'))
    relinkEscaping(fromProfile, profileCopy)
    const manifest = join(profileCopy, 'package.json')
    const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
    const bundles = pkg.dsh !== undefined && pkg.dsh !== null && pkg.dsh.profile !== undefined && pkg.dsh.profile !== null ? pkg.dsh.profile.bundles : undefined
    if (Array.isArray(bundles)) {
      pkg.dsh.profile.bundles = bundles.filter((id) => !PERSONAL_ONLY_BUNDLES.includes(id))
      writeFileSync(manifest, JSON.stringify(pkg, null, 2) + '\n')
    }
    // What names the personal home inside the copy is made to name the team's home. The folder is still called `building` until the rename below, so the text is written with its final name.
    for (const file of [join(profileCopy, 'cordis.patch.yml'), join(profileCopy, 'node_modules', '.pnpm-workspace-state-v1.json')]) {
      if (existsSync(file)) writeFileSync(file, retarget(readFileSync(file, 'utf8'), personalHome, home))
    }
    writeFileSync(join(building, 'team-home.json'), JSON.stringify({ version: 1, team_id: teamId, created_at: new Date().toISOString() }, null, 2) + '\n', { mode: 0o600 })
    renameSync(building, home)
    return { ok: true, created: true, home }
  } catch (e) {
    try { rmSync(building, { recursive: true, force: true }) } catch (ignored) { /* the next try removes it first */ }
    return { ok: false, error: 'home_failed', detail: String((e && e.message) || e).slice(0, 200) }
  }
}

// ── the instances ──────────────────────────────────────────────────────────────────────────────────────────────

const pidAlive = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } }
const defaultSleep = (ms) => new Promise((done) => setTimeout(done, ms))

/** The path of the `dsh` script this DSH runs under (or KYBERNOS_TEAM_DSH_BIN), null when it is neither. */
export const dshBinOf = (env = process.env, argv = process.argv) => {
  const own = typeof env.KYBERNOS_TEAM_DSH_BIN === 'string' ? env.KYBERNOS_TEAM_DSH_BIN.trim() : ''
  if (own !== '') return existsSync(own) ? own : null
  return typeof argv[1] === 'string' && basename(argv[1]) === 'dsh' && existsSync(argv[1]) ? argv[1] : null
}

/** `deps`: `{ personalHome(), env, node, dshBin(), now, sleep, spawnFn, alive, kill, probe, free, copy, seed({ teamId, teamHome, personalHome }), ready(logFile), portFirst, portLast, startTimeoutMs }`,
 *  all optional but `personalHome`. `seed` gives a new home what it starts from (the host's sign-in copy); it runs at every opening, before the start, and answers `{ ok: false, error }` to refuse it. */
export const createTeamInstances = (deps) => {
  const env = deps.env || process.env
  const now = deps.now || Date.now
  const sleep = deps.sleep || defaultSleep
  const spawnFn = deps.spawnFn || spawn
  const alive = deps.alive || pidAlive
  const kill = deps.kill || ((pid, signal) => process.kill(pid, signal))
  const probe = deps.probe || answers
  const free = deps.free || portIsFree
  const copy = deps.copy || copyTree
  const seed = deps.seed || (() => ({ ok: true }))
  const node = deps.node || process.execPath
  const dshBin = deps.dshBin || (() => dshBinOf(env))
  const ready = deps.ready || ((logFile) => { try { return readFileSync(logFile, 'utf8').includes(READY_LINE) } catch (e) { return false } })
  const registryFile = () => join(deps.personalHome(), 'kybernos', 'team-instances.json')
  const urlOf = (port) => 'http://127.0.0.1:' + port + '/'
  const signedOf = (home, port) => { try { return signedAddressOf(readFileSync(logOf(home), 'utf8'), port) } catch (e) { return null } }
  const logOf = (home) => join(home, 'logs', 'team-dsh.log')
  const opening = new Map()

  const running = async (row) => row !== undefined && alive(row.pid) && (await probe(row.port)) === true

  /** Runs the host's seed on a team's home; a seed that throws refuses like one that says no. */
  const seeded = (teamId, home) => {
    try {
      const out = seed({ teamId, teamHome: home, personalHome: deps.personalHome() })
      return out !== undefined && out !== null && out.ok === false ? { ok: false, error: typeof out.error === 'string' ? out.error : 'seed_failed' } : { ok: true }
    } catch (e) { return { ok: false, error: 'seed_failed' } }
  }

  const status = async (teamId) => {
    const row = readRegistry(registryFile()).teams[teamId]
    const up = await running(row)
    return up ? { running: true, port: row.port, pid: row.pid, url: urlOf(row.port) } : { running: false }
  }

  const list = async () => {
    const out = []
    for (const [id, row] of Object.entries(readRegistry(registryFile()).teams)) out.push({ team_id: id, port: row.port, pid: row.pid, running: await running(row) })
    return out
  }

  const start = async (teamId) => {
    const personal = deps.personalHome()
    // Before the home is made: a profile is not copied for a DSH that cannot be started.
    const bin = dshBin()
    if (bin === null || bin === undefined) return { ok: false, error: 'dsh_not_found' }
    const made = ensureTeamHome({ personalHome: personal, teamId, copy })
    if (made.ok !== true) return made
    const given = seeded(teamId, made.home)
    if (given.ok !== true) return given
    const logFile = logOf(made.home)
    const timeoutMs = deps.startTimeoutMs || START_TIMEOUT_MS
    const registry = readRegistry(registryFile())
    const known = registry.teams[teamId]
    // A DSH of this team that another one has just started, and that does not answer yet, is waited for: a second one on the same home would corrupt it.
    if (known !== undefined && alive(known.pid) && now() - known.started_at < timeoutMs) {
      const deadline = now() + timeoutMs
      while (now() < deadline && alive(known.pid)) {
        if (ready(logFile) && (await probe(known.port)) === true) return { ok: true, started: false, port: known.port, pid: known.pid, url: urlOf(known.port), signed_url: signedOf(made.home, known.port) }
        await sleep(250)
      }
      return { ok: false, error: 'start_timeout', log: logFile }
    }
    const taken = new Set(Object.entries(registry.teams).filter(([id, row]) => id !== teamId && alive(row.pid)).map(([, row]) => row.port))
    const port = await pickPort({ remembered: registry.ports[teamId], taken, isFree: free, first: deps.portFirst, last: deps.portLast })
    if (port === null) return { ok: false, error: 'no_free_port' }
    mkdirSync(dirname(logFile), { recursive: true, mode: 0o700 })
    // The log holds DSH's own sign-in address: it is the person's alone.
    writeFileSync(logFile, '', { mode: 0o600 })
    const spec = spawnSpec({ node, dshBin: bin, port, teamId, teamHome: made.home, personalHome: personal, env })
    const fd = openSync(logFile, 'a')
    let child = null
    let exited = null
    try {
      child = spawnFn(spec.command, spec.args, { env: spec.env, cwd: made.home, detached: true, stdio: ['ignore', fd, fd], windowsHide: true })
    } catch (e) { return { ok: false, error: 'spawn_failed' } } finally { closeSync(fd) }
    child.once('exit', (code) => { exited = code === null || code === undefined ? 1 : code })
    child.once('error', () => { exited = 1 })
    if (typeof child.unref === 'function') child.unref()
    const written = readRegistry(registryFile())
    written.teams[teamId] = { port, pid: child.pid, started_at: now() }
    written.ports[teamId] = port
    writeRegistry(registryFile(), written)
    const deadline = now() + timeoutMs
    while (now() < deadline && exited === null) {
      if (ready(logFile) && (await probe(port)) === true) return { ok: true, started: true, port, pid: child.pid, url: urlOf(port), signed_url: signedOf(made.home, port) }
      await sleep(250)
    }
    if (exited === null) { try { kill(child.pid, 'SIGTERM') } catch (e) { /* already gone */ } }
    const after = readRegistry(registryFile())
    delete after.teams[teamId]
    writeRegistry(registryFile(), after)
    return { ok: false, error: exited === null ? 'start_timeout' : 'start_failed', log: logFile }
  }

  /** Opens a team: its DSH is started when it is not already running. Two calls at once start one. */
  const open = async (teamId) => {
    if (teamHomeOf(deps.personalHome(), teamId) === null) return { ok: false, error: 'invalid_team' }
    const current = await status(teamId)
    if (current.running) {
      // A DSH that is already up reads its state at each use: a fresh copy of the sign-in (after a sign-out there) reaches it without a restart. A refusal here does not stop it being opened.
      seeded(teamId, teamHomeOf(deps.personalHome(), teamId))
      return { ok: true, started: false, port: current.port, pid: current.pid, url: current.url, signed_url: signedOf(teamHomeOf(deps.personalHome(), teamId), current.port) }
    }
    if (!opening.has(teamId)) opening.set(teamId, start(teamId).finally(() => opening.delete(teamId)))
    return opening.get(teamId)
  }

  const stop = async (teamId) => {
    const registry = readRegistry(registryFile())
    const row = registry.teams[teamId]
    if (row === undefined) return { ok: true, stopped: false }
    if (alive(row.pid)) {
      try { kill(row.pid, 'SIGTERM') } catch (e) { /* gone between the two calls */ }
      const deadline = now() + STOP_GRACE_MS
      while (alive(row.pid) && now() < deadline) await sleep(100)
      if (alive(row.pid)) { try { kill(row.pid, 'SIGKILL') } catch (e) { /* gone */ } }
    }
    delete registry.teams[teamId]
    writeRegistry(registryFile(), registry)
    return { ok: true, stopped: true }
  }

  return { open, status, list, stop }
}
