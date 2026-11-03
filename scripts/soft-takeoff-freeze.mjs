#!/usr/bin/env node
// Applies the bundle freeze of docs/tests/soft-takeoff/plugins.json to a SANDBOX profile: every bundle marked « off » is taken out of dsh.profile.bundles
// (its link stays in the dependencies, so putting it back is one line). The owner's real profile is never touched.
//
//   node scripts/soft-takeoff-freeze.mjs --profile <sandbox home>/.dsh/profiles/web [--plan <plugins.json>] [--dry-run] [--undo]
//
// The first run keeps the profile's package.json as package.json.takeoff-orig; --undo puts it back. The sandbox DSH must be restarted to load the change
// (scripts/sandbox/stop.sh, then start.sh). Refuses any profile that is not inside a `.kybernos-sandbox` folder (real path, links resolved).
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isSandboxFile } from './pin-model.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Pure. `bundles`: the profile's list; `plan`: plugins.json; `nameOf(dir)`: package name of a packages/<dir>. Returns { next, removed, absent, kept, unknown }. */
export const freeze = (bundles, plan, nameOf) => {
  const removed = []
  const absent = []
  const drop = new Set()
  for (const [dir, e] of Object.entries(plan.bundles || {})) {
    if (e.state !== 'off') continue
    const name = nameOf(dir)
    if (!name) { absent.push(dir); continue }
    if (bundles.includes(name)) { drop.add(name); removed.push(name) } else absent.push(name)
  }
  return { next: bundles.filter((b) => !drop.has(b)), removed, absent, kept: bundles.length - removed.length }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const argv = process.argv.slice(2)
  const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d }
  const refuse = (m) => { console.error('soft-takeoff-freeze: ' + m); process.exit(2) }
  const profile = opt('--profile', '')
  if (!profile) refuse('--profile <sandbox profile folder> is required')
  const pkgFile = join(resolve(profile), 'package.json')
  if (!isSandboxFile(pkgFile)) refuse('not a sandbox profile (the folder must be inside a .kybernos-sandbox folder): ' + profile)
  const backup = pkgFile + '.takeoff-orig'
  if (argv.includes('--undo')) {
    if (!existsSync(backup)) refuse('nothing to undo: no ' + backup)
    copyFileSync(backup, pkgFile)
    console.log('restored the profile package.json from its backup; restart the sandbox')
    process.exit(0)
  }
  const plan = JSON.parse(readFileSync(resolve(opt('--plan', join(REPO, 'docs/tests/soft-takeoff/plugins.json'))), 'utf8'))
  const nameOf = (dir) => { try { return JSON.parse(readFileSync(join(REPO, 'packages', dir, 'package.json'), 'utf8')).name } catch (e) { return null } }
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
  const list = pkg && pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles
  if (!Array.isArray(list)) refuse('this package.json has no dsh.profile.bundles')
  const r = freeze(list, plan, nameOf)
  console.log(`${r.removed.length} bundles taken out, ${r.absent.length} already absent, ${r.kept} kept${argv.includes('--dry-run') ? ' (dry run: nothing written)' : ''}`)
  for (const n of r.removed) console.log('  - ' + n)
  if (!argv.includes('--dry-run') && r.removed.length > 0) {
    if (!existsSync(backup)) copyFileSync(pkgFile, backup)
    pkg.dsh.profile.bundles = r.next
    writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n')
    console.log('written; restart the sandbox (scripts/sandbox/stop.sh, then start.sh)')
  }
}
