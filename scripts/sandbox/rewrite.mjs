// Re-points a CLONED dsh profile (the sandbox copy, never the real one) at a worktree.
// Idempotent: it derives every target from the basename of the link it finds, so running it
// on an already rewritten profile gives the same result.
//
//   node sandbox-rewrite.mjs <profileDir> <worktree> <dshHome> <realHome>
//
// What it does:
//   1. package.json: every `link:` dependency whose package folder exists in <worktree>/packages
//      is re-pointed there (absolute path). Others (the paid kybernos-servers module, which lives
//      in a private repo) keep their current absolute target. @local/kybernos-relance is taken out
//      of dsh.profile.bundles (it restarts DSH on port 3080 by default).
//   2. pnpm-lock.yaml and node_modules/.pnpm/lock.yaml: the `specifier:`/`version:` link pairs.
//   3. node_modules/@local/*: symlinks recreated (absolute) from the resulting package.json.
//   4. node_modules/.pnpm-workspace-state-v1.json: the project key (the profile's absolute path).
//   5. cordis.patch.yml: ~/.dsh/mcp/*.mjs paths -> <dshHome>/mcp/, the lsp `cwd` -> the worktree.
//   6. A bundle the worktree has and the profile does not list yet (a NEW plugin) is added, as a link and as a
//      bundle, so it can be tried here before anyone links it into a real profile.
//   7. One workspace, the worktree itself, when the sandbox has none: a chat started there lives in a git folder,
//      which the git chip needs. An existing workspace file is never touched.
import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'

const [profileDir, worktree, dshHome, realHome] = process.argv.slice(2).map((p) => resolve(p))
if (!profileDir || !worktree || !dshHome || !realHome) {
  console.error('usage: sandbox-rewrite.mjs <profileDir> <worktree> <dshHome> <realHome>')
  process.exit(2)
}
// Hard stop: never touch the real profile.
if (profileDir === join(realHome, '.dsh', 'profiles', 'web') || profileDir.startsWith(join(realHome, '.dsh') + '/')) {
  console.error('refusing to rewrite a profile under the real ~/.dsh: ' + profileDir)
  process.exit(3)
}

const pkgsDir = join(worktree, 'packages')
const readText = (p) => readFileSync(p, 'utf8')
const writeIfChanged = (p, next) => { if (readText(p) !== next) writeFileSync(p, next) }

/** abs path -> new abs path (worktree when the package exists there, else unchanged). */
const retarget = (abs) => {
  const name = basename(abs)
  return existsSync(join(pkgsDir, name, 'package.json')) ? join(pkgsDir, name) : abs
}

// 1. package.json
const pkgPath = join(profileDir, 'package.json')
const pkg = JSON.parse(readText(pkgPath))
const links = {} // dep name -> new absolute target
for (const [dep, spec] of Object.entries(pkg.dependencies || {})) {
  if (typeof spec !== 'string' || !spec.startsWith('link:')) continue
  const raw = spec.slice(5)
  const abs = raw.startsWith('/') ? raw : resolve(profileDir, raw)
  links[dep] = retarget(abs)
  pkg.dependencies[dep] = 'link:' + links[dep]
}
const bundles = pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles
let relanceDropped = false
if (Array.isArray(bundles)) {
  const kept = bundles.filter((b) => b !== '@local/kybernos-relance')
  relanceDropped = kept.length !== bundles.length
  pkg.dsh.profile.bundles = kept
}
// 1b. New bundles of the worktree (never the paid module nor the relaunch tool, which does not belong in a sandbox).
const SKIP = new Set(['@local/kybernos-relance', '@local/kybernos-servers'])
const bundlesAdded = []
for (const dir of readdirSync(pkgsDir)) {
  let meta = null
  try { meta = JSON.parse(readText(join(pkgsDir, dir, 'package.json'))) } catch (e) { continue }
  if (meta === null || meta.dsh === undefined || typeof meta.name !== 'string' || !meta.name.startsWith('@local/') || SKIP.has(meta.name)) continue
  if (pkg.dependencies && pkg.dependencies[meta.name] !== undefined) continue
  pkg.dependencies = pkg.dependencies || {}
  pkg.dependencies[meta.name] = 'link:' + join(pkgsDir, dir)
  links[meta.name] = join(pkgsDir, dir)
  if (pkg.dsh && pkg.dsh.profile && Array.isArray(pkg.dsh.profile.bundles) && !pkg.dsh.profile.bundles.includes(meta.name)) pkg.dsh.profile.bundles.push(meta.name)
  bundlesAdded.push(meta.name)
}
writeIfChanged(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

// 2. lockfiles: pairs of `specifier: link:<abs>` + `version: link:<rel to profileDir>`
const pairRe = /^(\s+)specifier: link:(.+)\n(\s+)version: link:(.+)$/gm
const fixLock = (file) => {
  if (!existsSync(file)) return 0
  let n = 0
  const next = readText(file).replace(pairRe, (m, i1, spec, i2) => {
    const abs = spec.startsWith('/') ? spec : resolve(profileDir, spec)
    const target = retarget(abs)
    n += 1
    return i1 + 'specifier: link:' + target + '\n' + i2 + 'version: link:' + relative(profileDir, target)
  })
  writeIfChanged(file, next)
  return n
}
const lockPairs = fixLock(join(profileDir, 'pnpm-lock.yaml')) + fixLock(join(profileDir, 'node_modules', '.pnpm', 'lock.yaml'))

// 3. node_modules/@local symlinks
const localDir = join(profileDir, 'node_modules', '@local')
mkdirSync(localDir, { recursive: true })
for (const entry of readdirSync(localDir)) {
  const p = join(localDir, entry)
  if (lstatSync(p).isSymbolicLink()) rmSync(p)
}
let linked = 0
for (const [dep, target] of Object.entries(links)) {
  if (!dep.startsWith('@local/')) continue
  if (!existsSync(target)) { console.error('WARN: missing target for ' + dep + ': ' + target); continue }
  symlinkSync(target, join(localDir, dep.slice('@local/'.length)))
  linked += 1
}

// 4. pnpm workspace state: the project key is the profile's absolute path
const statePath = join(profileDir, 'node_modules', '.pnpm-workspace-state-v1.json')
if (existsSync(statePath)) {
  const st = JSON.parse(readText(statePath))
  if (st.projects && typeof st.projects === 'object') {
    const keys = Object.keys(st.projects)
    if (keys.length === 1 && keys[0] !== profileDir) {
      st.projects = { [profileDir]: st.projects[keys[0]] }
      writeIfChanged(statePath, JSON.stringify(st))
    }
  }
}

// 5. cordis.patch.yml
const patchPath = join(profileDir, 'cordis.patch.yml')
let patch = readText(patchPath)
const realMcp = join(realHome, '.dsh', 'mcp') + '/'
const sbMcp = join(dshHome, 'mcp') + '/'
const mcpHits = patch.split(realMcp).length - 1
patch = patch.split(realMcp).join(sbMcp)
patch = patch.replace(/^([ \t]+cwd: )[^\n]*dyad-apps\/kybernos[ \t]*$/m, '$1' + worktree)
writeIfChanged(patchPath, patch)

// 7. The workspace
const wsFile = join(dshHome, 'storages', 'workspace.json')
let workspaceSeeded = false
if (!existsSync(wsFile)) {
  mkdirSync(dirname(wsFile), { recursive: true })
  const id = randomUUID()
  const now = new Date().toISOString()
  writeFileSync(wsFile, JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: [id], archivedSessionIds: [], pinnedSessionIds: [] },
    tables: { workspaces: { [id]: { path: worktree, title: basename(worktree), sessionIds: [], createdAt: now, updatedAt: now } } }
  }))
  workspaceSeeded = true
}

console.log(JSON.stringify({ links: Object.keys(links).length, linkedLocal: linked, lockPairs, relanceDropped, mcpPathsRepointed: mcpHits, bundlesAdded, workspaceSeeded }))
