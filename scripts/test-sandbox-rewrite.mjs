#!/usr/bin/env node
// scripts/sandbox/rewrite.mjs on a FAKE cloned profile: what it re-points, what it adds, what it refuses, and that a second run
// changes nothing. No DSH, no real ~/.dsh.
//
//   node scripts/test-sandbox-rewrite.mjs
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REWRITE = join(dirname(fileURLToPath(import.meta.url)), 'sandbox', 'rewrite.mjs')
let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }

const root = mkdtempSync(join(tmpdir(), 'kb-rewrite-'))
const real = join(root, 'real')
const sb = join(root, 'sb')
const work = join(root, 'work')
const profile = join(sb, '.dsh', 'profiles', 'web')
const dshHome = join(sb, '.dsh')
const pkg = (dir, name, extra) => { mkdirSync(join(work, 'packages', dir), { recursive: true }); writeFileSync(join(work, 'packages', dir, 'package.json'), JSON.stringify({ name, version: '0.1.0', ...extra })) }
try {
  // the worktree: two bundles the profile knows, one NEW bundle, the relaunch tool, the paid-module-less case, a standalone daemon
  pkg('kybernos-plugin', '@local/kybernos', { dsh: {} })
  pkg('kybernos-sessions', '@local/kybernos-sessions', { dsh: {} })
  pkg('kybernos-changes', '@local/kybernos-changes', { dsh: {} })
  pkg('kybernos-relance', '@local/kybernos-relance', { dsh: {} })
  pkg('messaging', 'messaging-daemon', {})
  // the cloned profile: links to the shared tree (and one to a private repo), relance in the bundles, an mcp path under the real home
  mkdirSync(join(profile, 'node_modules', '@local'), { recursive: true })
  mkdirSync(join(real, '.dsh', 'mcp'), { recursive: true })
  const SHARED = join(real, 'kybernos-plugins', 'packages')
  writeFileSync(join(profile, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web',
    dependencies: { '@local/kybernos': 'link:' + SHARED + '/kybernos-plugin', '@local/kybernos-sessions': 'link:' + SHARED + '/kybernos-sessions', '@local/kybernos-servers': 'link:/private/paid/packages/kybernos-servers' },
    dsh: { profile: { bundles: ['@local/kybernos', '@local/kybernos-relance', '@local/kybernos-sessions'] } }
  }, null, 2))
  writeFileSync(join(profile, 'pnpm-lock.yaml'), "  '@local/kybernos':\n    specifier: link:" + SHARED + '/kybernos-plugin\n    version: link:../../../../real/kybernos-plugins/packages/kybernos-plugin\n')
  writeFileSync(join(profile, 'cordis.patch.yml'), 'mcp:\n  - ' + join(real, '.dsh', 'mcp') + '/lsp.mjs\n')
  const run = (a) => spawnSync(process.execPath, [REWRITE, ...(a || [profile, work, dshHome, real])], { encoding: 'utf8' })

  console.log('the first run')
  const r1 = run()
  check('it succeeds and says what it did', r1.status === 0 && /"bundlesAdded":\["@local\/kybernos-changes"\]/.test(r1.stdout), r1.stderr || r1.stdout)
  const p1 = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
  check('a link whose package exists in the worktree goes there', p1.dependencies['@local/kybernos'] === 'link:' + join(work, 'packages', 'kybernos-plugin') && p1.dependencies['@local/kybernos-sessions'] === 'link:' + join(work, 'packages', 'kybernos-sessions'), p1.dependencies)
  check('the paid module, which has no copy in the worktree, keeps its own target', p1.dependencies['@local/kybernos-servers'] === 'link:/private/paid/packages/kybernos-servers')
  check('a NEW bundle of the worktree is added, as a dependency and as a bundle', p1.dependencies['@local/kybernos-changes'] === 'link:' + join(work, 'packages', 'kybernos-changes') && p1.dsh.profile.bundles.includes('@local/kybernos-changes'), p1.dsh.profile.bundles)
  check('the relaunch tool is dropped from the bundles and never added (it targets port 3080)', !p1.dsh.profile.bundles.includes('@local/kybernos-relance') && p1.dependencies['@local/kybernos-relance'] === undefined)
  check('a package that is not a DSH bundle (the standalone daemon) is not added', Object.keys(p1.dependencies).every((k) => !/messaging/.test(k)))
  check('the symlinks of node_modules/@local land in the worktree, new bundle included', ['kybernos', 'kybernos-sessions', 'kybernos-changes'].every((n) => { const l = join(profile, 'node_modules', '@local', n); return existsSync(l) && lstatSync(l).isSymbolicLink() && resolve(dirname(l), readlinkSync(l)).startsWith(work) }))
  check('the lock file follows', !readFileSync(join(profile, 'pnpm-lock.yaml'), 'utf8').includes(SHARED) && readFileSync(join(profile, 'pnpm-lock.yaml'), 'utf8').includes(join(work, 'packages', 'kybernos-plugin')))
  check('the mcp paths leave the real home', !readFileSync(join(profile, 'cordis.patch.yml'), 'utf8').includes(join(real, '.dsh', 'mcp')))
  const ws = JSON.parse(readFileSync(join(dshHome, 'storages', 'workspace.json'), 'utf8'))
  const w = Object.values(ws.tables.workspaces)[0]
  check('the sandbox gets ONE workspace, the worktree itself (a git folder)', Object.keys(ws.tables.workspaces).length === 1 && w.path === work && ws.global.workspaceIds.length === 1, ws)

  console.log('the second run')
  const before = readFileSync(join(profile, 'package.json'), 'utf8')
  const wsBefore = readFileSync(join(dshHome, 'storages', 'workspace.json'), 'utf8')
  const r2 = run()
  check('it is idempotent: nothing more added, the profile identical, the workspace file untouched', r2.status === 0 && /"bundlesAdded":\[\]/.test(r2.stdout) && /"workspaceSeeded":false/.test(r2.stdout) && readFileSync(join(profile, 'package.json'), 'utf8') === before && readFileSync(join(dshHome, 'storages', 'workspace.json'), 'utf8') === wsBefore, r2.stdout)
  check('a bundle is listed once', new Set(JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8')).dsh.profile.bundles).size === 3)

  console.log('the refusals')
  const bad = run([join(real, '.dsh', 'profiles', 'web'), work, dshHome, real])
  check('it refuses a profile under the real ~/.dsh', bad.status === 3 && /refusing/.test(bad.stderr), bad.stderr)
  check('it refuses a call with a missing argument', run([profile, work, dshHome]).status === 2)
} finally { rmSync(root, { recursive: true, force: true }) }

console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)
