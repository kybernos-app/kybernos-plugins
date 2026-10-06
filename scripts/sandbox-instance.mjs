#!/usr/bin/env node
// A second, isolated `dsh web` that serves THIS checkout's bundles — to try a new bundle, or host code, on a
// real GUI without touching the user's own DSH (port 3080, ~/.dsh) and without restarting it.
//
//   node scripts/sandbox-instance.mjs setup [--name dev] [--port 3091]    build ~/.kybernos-sandbox/<name>
//   node scripts/sandbox-instance.mjs start [--name dev] [--port 3091]    start it (background), print how to drive it
//   node scripts/sandbox-instance.mjs stop  [--name dev] [--port 3091]    stop that instance (and only it)
//   node scripts/sandbox-instance.mjs env   [--name dev] [--port 3091]    the three variables the live checks need
//
// What `setup` does: an APFS clone of the real `web` profile (nothing copied twice), every `@local/*` link pointed at
// this checkout, the paid server module and the relaunch tool (it targets :3080) left out, and the new bundles of this
// checkout added to `dsh.profile.bundles`. Nothing else is copied: no credentials, no keys, no sessions. The instance
// has its own HOME and DSH_HOME, because several bundles still write under ~/.dsh when only DSH_HOME is set.
//
// Host code is not hot-reloaded: `stop` then `start` after editing an `index.js`. Client code is read from the
// checkout on every page load. Drive the instance with, e.g.
//   KB_HOST=127.0.0.1:3091 DSH_HOME=<root>/.dsh HOME=<root> node scripts/check-changes-live.mjs
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync, copyFileSync, openSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// Bundles that must not run in a sandbox: the paid module (private repo) and the tool that relaunches :3080.
export const LEFT_OUT = ['@local/kybernos-servers', '@local/kybernos-relance']

/**
 * Pure: the profile's package.json and lock, rewritten to link `repoPackages` instead of wherever they linked.
 * `bundlesHere` are the bundles of this checkout (`@local/<dir>` → `<dir>`): any not yet in the profile is added.
 */
export function rewriteProfile ({ packageJson, lockText, repoPackages, bundlesHere }) {
  const pkg = JSON.parse(JSON.stringify(packageJson))
  const deps = pkg.dependencies || {}
  const old = new Set()
  for (const k of Object.keys(deps)) {
    if (!k.startsWith('@local/')) continue
    const m = /^link:(.*)\/packages\/[^/]+$/.exec(String(deps[k]))
    if (m !== null) old.add(m[1])
    deps[k] = 'link:' + repoPackages + '/' + (bundlesHere[k] || String(deps[k]).split('/').pop())
  }
  for (const k of LEFT_OUT) delete deps[k]
  for (const k of Object.keys(bundlesHere)) if (deps[k] === undefined && !LEFT_OUT.includes(k)) deps[k] = 'link:' + repoPackages + '/' + bundlesHere[k]
  const profile = pkg.dsh.profile
  profile.bundles = profile.bundles.filter((b) => !LEFT_OUT.includes(b))
  for (const k of Object.keys(bundlesHere)) if (!profile.bundles.includes(k) && !LEFT_OUT.includes(k)) profile.bundles.push(k)
  let lock = String(lockText || '')
  for (const prefix of old) lock = lock.split('link:' + prefix + '/packages/').join('link:' + repoPackages + '/')
  return { packageJson: pkg, lockText: lock }
}

const arg = (name, dflt) => { const i = process.argv.indexOf('--' + name); return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : dflt }
const realHome = () => process.env.KB_REAL_DSH_HOME || join(homedir(), '.dsh')
const roots = (name) => { const root = join(homedir(), '.kybernos-sandbox', name); return { root, dsh: join(root, '.dsh'), profile: join(root, '.dsh', 'profiles', 'web') } }

/** `{ '@local/kybernos-plugin-name': 'dir' }` for every DSH bundle of this checkout. */
export function bundlesOfCheckout (repo = REPO) {
  const out = {}
  for (const dir of readdirSync(join(repo, 'packages'))) {
    try {
      const p = JSON.parse(readFileSync(join(repo, 'packages', dir, 'package.json'), 'utf8'))
      if (p.dsh !== undefined && typeof p.name === 'string' && p.name.startsWith('@local/')) out[p.name] = dir
    } catch (e) { /* not a bundle */ }
  }
  return out
}

function setup (name) {
  const { root, dsh, profile } = roots(name)
  if (root.startsWith(realHome())) throw new Error('refusing: the sandbox would live inside the real DSH home')
  if (existsSync(root)) throw new Error('already there: ' + root + ' (remove it by hand to start over)')
  const real = join(realHome(), 'profiles', 'web')
  if (!existsSync(real)) throw new Error('no real profile at ' + real)
  mkdirSync(join(dsh, 'profiles'), { recursive: true })
  mkdirSync(join(dsh, 'kybernos'), { recursive: true })
  const cp = spawnSync('cp', ['-cR', real, profile], { stdio: 'inherit' }) // APFS clone: instant, no second copy
  if (cp.status !== 0) throw new Error('cp -cR failed (an APFS volume is needed)')
  for (const f of readdirSync(profile)) if (/\.bak/.test(f)) rmSync(join(profile, f), { force: true })
  const here = bundlesOfCheckout()
  const byDir = new Set(Object.values(here))
  const links = join(profile, 'node_modules', '@local')
  for (const l of readdirSync(links)) {
    const full = join(links, l)
    let target = ''
    try { target = readlinkSync(full) } catch (e) { continue }
    rmSync(full, { force: true })
    const dir = basename(target)
    if (byDir.has(dir) && !LEFT_OUT.includes('@local/' + l)) symlinkSync(join(REPO, 'packages', dir), full)
  }
  for (const [pkgName, dir] of Object.entries(here)) {
    const full = join(links, pkgName.split('/')[1])
    if (!existsSync(full) && !LEFT_OUT.includes(pkgName)) symlinkSync(join(REPO, 'packages', dir), full)
  }
  const out = rewriteProfile({
    packageJson: JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8')),
    lockText: existsSync(join(profile, 'pnpm-lock.yaml')) ? readFileSync(join(profile, 'pnpm-lock.yaml'), 'utf8') : '',
    repoPackages: join(REPO, 'packages'),
    bundlesHere: here
  })
  writeFileSync(join(profile, 'package.json'), JSON.stringify(out.packageJson, null, 2) + '\n')
  if (out.lockText !== '') writeFileSync(join(profile, 'pnpm-lock.yaml'), out.lockText)
  // One workspace, this checkout: a chat started in the sandbox then lives in a git folder, which is what the git chip needs.
  mkdirSync(join(dsh, 'storages'), { recursive: true })
  const now = new Date().toISOString()
  writeFileSync(join(dsh, 'storages', 'workspace.json'), JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: [], archivedSessionIds: [], pinnedSessionIds: [] },
    tables: { workspaces: {} }
  }))
  const wid = randomUUID()
  const ws = JSON.parse(readFileSync(join(dsh, 'storages', 'workspace.json'), 'utf8'))
  ws.global.workspaceIds.push(wid)
  ws.tables.workspaces[wid] = { path: REPO, title: basename(REPO), sessionIds: [], createdAt: now, updatedAt: now }
  writeFileSync(join(dsh, 'storages', 'workspace.json'), JSON.stringify(ws))
  const ob = join(realHome(), 'kybernos', 'onboarding.json')
  if (existsSync(ob)) copyFileSync(ob, join(dsh, 'kybernos', 'onboarding.json'))
  console.log('✓ sandbox ready: ' + root)
  console.log('  next: node scripts/sandbox-instance.mjs start --name ' + name)
}

const envLine = (name, port) => { const { root, dsh } = roots(name); return 'KB_HOST=127.0.0.1:' + port + ' DSH_HOME=' + dsh + ' HOME=' + root }
const pidsOf = (port) => {
  const r = spawnSync('pgrep', ['-f', '--', '--port ' + port + ' '], { encoding: 'utf8' }) // `--`: the pattern itself starts with dashes
  return String(r.stdout || '').split('\n').map((x) => parseInt(x, 10)).filter((n) => Number.isFinite(n) && n !== process.pid)
}

async function start (name, port) {
  if (port === 3080) throw new Error('refusing: 3080 is the real DSH')
  const { root, dsh } = roots(name)
  if (!existsSync(root)) throw new Error('no sandbox: run `setup` first')
  if (pidsOf(port).length > 0) { console.log('already running on :' + port); console.log('  ' + envLine(name, port)); return }
  const log = join(root, 'dsh.log')
  const out = openSync(log, 'w')
  const child = spawn('dsh', ['--profile', 'web', '--host', '127.0.0.1', '--port', String(port), '--no-open'], {
    detached: true, stdio: ['ignore', out, out], env: { ...process.env, HOME: root, DSH_HOME: dsh, DSH_WEB_PORT: String(port) }
  })
  child.unref()
  for (let i = 0; i < 90; i += 1) {
    await new Promise((r) => setTimeout(r, 1000))
    try { const r = await fetch('http://127.0.0.1:' + port + '/'); if (r.status === 401 || r.status === 200) { console.log('✓ running on :' + port + '  (log: ' + log + ')'); console.log('  ' + envLine(name, port)); return } } catch (e) { /* not up yet */ }
  }
  throw new Error('did not answer on :' + port + ' — see ' + log)
}

function stop (port) {
  if (port === 3080) throw new Error('refusing: 3080 is the real DSH')
  const pids = pidsOf(port)
  for (const p of pids) { try { process.kill(p, 'SIGTERM') } catch (e) { /* gone */ } }
  console.log(pids.length > 0 ? '✓ stopped ' + pids.join(', ') : 'nothing running on :' + port)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2]
  const name = arg('name', 'dev')
  const port = parseInt(arg('port', '3091'), 10)
  try {
    if (cmd === 'setup') setup(name)
    else if (cmd === 'start') await start(name, port)
    else if (cmd === 'stop') stop(port)
    else if (cmd === 'env') console.log(envLine(name, port))
    else { console.log('usage: sandbox-instance.mjs setup|start|stop|env [--name dev] [--port 3091]'); process.exit(2) }
  } catch (e) { console.error('✗ ' + e.message); process.exit(1) }
}
