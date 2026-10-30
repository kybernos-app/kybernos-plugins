// The sector templates the SANDBOX carries (it is a clone of the owner's profile, and scripts/sandbox/rewrite.mjs re-points their links at this checkout, so the
// registry reads them): the live checks of Contacts, Catalog and Pipeline were written for a profile with none, and with one active template the three pages speak
// that template's words and show its rows only (docs/dev/business-visuals.md). A check that is about the plain pages (or about a theme of its own) takes the templates out
// of the sandbox profile for its run and puts them back at the end, whatever happens.
//
//   const out = takeTemplatesOut(join(dshHome, 'profiles', 'web'))   // { count, restore() }; `restore` also runs when the process exits
//   if (out.count > 0) await sleep(3000)                               // the registry rescans every two seconds
//
// Sandbox only: the caller has already refused a DSH that is not the sandbox's.
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const isTemplate = (name) => typeof name === 'string' && name.startsWith('@kybernos-themes/')

export function takeTemplatesOut (profileDir) {
  const file = join(profileDir, 'package.json')
  const text = readFileSync(file, 'utf8')
  const pkg = JSON.parse(text)
  const bundles = pkg.dsh && pkg.dsh.profile && Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : []
  const had = Object.keys(pkg.dependencies || {}).filter(isTemplate).concat(bundles.filter(isTemplate))
  if (had.length === 0) return { count: 0, restore () {} }
  for (const name of Object.keys(pkg.dependencies || {})) if (isTemplate(name)) delete pkg.dependencies[name]
  pkg.dsh.profile.bundles = bundles.filter((b) => !isTemplate(b))
  writeFileSync(file + '.tmp', JSON.stringify(pkg, null, 2) + '\n')
  renameSync(file + '.tmp', file)
  let back = false
  const restore = () => {
    if (back) return
    back = true
    try { writeFileSync(file + '.tmp', text); renameSync(file + '.tmp', file) } catch (e) { /* the sandbox is throw-away */ }
  }
  process.on('exit', restore)
  return { count: had.length, restore }
}
