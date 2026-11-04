#!/usr/bin/env node
// Applies the bundle freeze of docs/tests/soft-takeoff/plugins.json to a SANDBOX profile: every bundle marked « off » is taken out of dsh.profile.bundles
// (its link stays in the dependencies, so putting it back is one line), and every bundle marked « on » that the profile's patch (cordis.patch.yml) carries
// as « disabled: true » (a sandbox is cloned from the owner's profile, where he has switched some off) has that line taken out, or it would never load.
// A bundle marked « on » that the profile links in its dependencies but does not list in dsh.profile.bundles (a sandbox cloned before the owner added it) is listed.
// The owner's real profile is never touched.
//
//   node scripts/soft-takeoff-freeze.mjs --profile <sandbox home>/.dsh/profiles/web [--plan <plugins.json>] [--dry-run] [--undo]
//
// The first run keeps the profile's package.json and cordis.patch.yml as <file>.takeoff-orig; --undo puts them back. The sandbox DSH must be restarted to load the change
// (scripts/sandbox/stop.sh, then start.sh). Refuses any profile that is not inside a `.kybernos-sandbox` folder (real path, links resolved).
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isSandboxFile } from './pin-model.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Pure. `bundles`: the profile's list; `plan`: plugins.json; `nameOf(dir)`: package name of a packages/<dir>; `deps`: the profile's dependencies (package name -> link), or null to leave
 * the « on » bundles alone. Returns { next, removed, absent, kept, added }: `added` are the « on » bundles the profile links and does not list (listed last: the bundle's own patch places it).
 */
export const freeze = (bundles, plan, nameOf, deps = null) => {
  const removed = []
  const absent = []
  const added = []
  const drop = new Set()
  for (const [dir, e] of Object.entries(plan.bundles || {})) {
    if (e.state === 'on' && deps !== null) {
      const on = nameOf(dir)
      if (on && deps[on] !== undefined && !bundles.includes(on)) added.push(on)
      continue
    }
    if (e.state !== 'off') continue
    const name = nameOf(dir)
    if (!name) { absent.push(dir); continue }
    if (bundles.includes(name)) { drop.add(name); removed.push(name) } else absent.push(name)
  }
  return { next: [...bundles.filter((b) => !drop.has(b)), ...added], removed, absent, kept: bundles.length - removed.length, added }
}

/** Pure. `patchText`: the profile's cordis.patch.yml. A « - id: X » entry followed by « disabled: true » loses that line when the plan marks X on. Returns { next, enabled }. */
export const enableOn = (patchText, plan) => {
  const lines = patchText.split('\n')
  const out = []
  const enabled = []
  for (let i = 0; i < lines.length; i += 1) {
    out.push(lines[i])
    const m = /^- id: (\S+)\s*$/.exec(lines[i])
    if (m !== null && i + 1 < lines.length && /^\s+disabled: true\s*$/.test(lines[i + 1]) && plan.bundles && plan.bundles[m[1]] && plan.bundles[m[1]].state === 'on') { enabled.push(m[1]); i += 1 }
  }
  return { next: out.join('\n'), enabled }
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
  const patchFile = join(resolve(profile), 'cordis.patch.yml')
  const patchBackup = patchFile + '.takeoff-orig'
  if (argv.includes('--undo')) {
    if (!existsSync(backup)) refuse('nothing to undo: no ' + backup)
    copyFileSync(backup, pkgFile)
    if (existsSync(patchBackup)) copyFileSync(patchBackup, patchFile)
    console.log('restored the profile package.json and patch from their backups; restart the sandbox')
    process.exit(0)
  }
  const plan = JSON.parse(readFileSync(resolve(opt('--plan', join(REPO, 'docs/tests/soft-takeoff/plugins.json'))), 'utf8'))
  const nameOf = (dir) => { try { return JSON.parse(readFileSync(join(REPO, 'packages', dir, 'package.json'), 'utf8')).name } catch (e) { return null } }
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
  const list = pkg && pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles
  if (!Array.isArray(list)) refuse('this package.json has no dsh.profile.bundles')
  const r = freeze(list, plan, nameOf, pkg.dependencies && typeof pkg.dependencies === 'object' ? pkg.dependencies : {})
  console.log(`${r.removed.length} bundles taken out, ${r.absent.length} already absent, ${r.kept} kept, ${r.added.length} marked on and listed${argv.includes('--dry-run') ? ' (dry run: nothing written)' : ''}`)
  for (const n of r.removed) console.log('  - ' + n)
  for (const n of r.added) console.log('  + ' + n + ' (marked on, linked, not listed)')
  const patch = existsSync(patchFile) ? enableOn(readFileSync(patchFile, 'utf8'), plan) : { next: '', enabled: [] }
  console.log(`${patch.enabled.length} bundles marked on were disabled in the patch${argv.includes('--dry-run') ? ' (dry run: nothing written)' : ''}`)
  for (const n of patch.enabled) console.log('  + ' + n)
  if (!argv.includes('--dry-run') && (r.removed.length > 0 || r.added.length > 0 || patch.enabled.length > 0)) {
    if (!existsSync(backup)) copyFileSync(pkgFile, backup)
    if (r.removed.length > 0 || r.added.length > 0) {
      pkg.dsh.profile.bundles = r.next
      writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n')
    }
    if (patch.enabled.length > 0) {
      if (!existsSync(patchBackup)) copyFileSync(patchFile, patchBackup)
      writeFileSync(patchFile, patch.next)
    }
    console.log('written; restart the sandbox (scripts/sandbox/stop.sh, then start.sh)')
  }
}
