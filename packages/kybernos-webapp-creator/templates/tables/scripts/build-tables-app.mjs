// build-tables-app.mjs — makes a runnable copy of the tables template with kybernos-db vendored in.
//
//   node scripts/build-tables-app.mjs <out dir> [--kybernos-db <dir>]
//
// The copy holds the template (without node_modules, data or an older vendor/) and `vendor/kybernos-db/`: the door (api.mjs), the service, the template and instantiate code, the
// way a person's file is answered (serve-user-file.mjs) and core/ and store/, plus whatever those import, found by following their relative imports. `vendor/kybernos-db/VENDORED.json` lists every file with its hash. Run `npm ci` in the
// copy to install the three dependencies.
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The files lib/db.mjs loads, from the root of kybernos-db. */
export const ENTRIES = ['api.mjs', 'agent/service.mjs', 'template.mjs', 'instantiate.mjs', 'serve-user-file.mjs', 'core/index.mjs', 'store/index.mjs']
const IMPORT = /(?:import|export)\s[^'";]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)|import\s*['"](\.{1,2}\/[^'"]+)['"]/g

/** Every file reachable from `entries` by relative imports, as paths relative to `root`, sorted. `read(path)` gives a file's text. */
export function importClosure (root, entries, read = (p) => readFileSync(p, 'utf8')) {
  const seen = new Set()
  const walk = (rel) => {
    if (seen.has(rel)) return
    seen.add(rel)
    for (const m of read(join(root, rel)).matchAll(IMPORT)) {
      const spec = m[1] ?? m[2] ?? m[3]
      const next = relative(root, resolve(root, dirname(rel), spec))
      if (next.startsWith('..')) throw new Error(rel + ' imports ' + spec + ', outside kybernos-db')
      walk(next)
    }
  }
  entries.forEach(walk)
  return [...seen].sort()
}

const here = dirname(fileURLToPath(import.meta.url))
const SKIP = new Set(['node_modules', 'vendor', 'data'])

/** Puts `vendor/kybernos-db/` (and its VENDORED.json) in an app folder: `{ files }`. */
export function vendorKybernosDb ({ out, dbDir = join(here, '..', '..', '..', '..', 'kybernos-db') }) {
  const vendor = join(resolve(out), 'vendor', 'kybernos-db')
  rmSync(vendor, { recursive: true, force: true })
  const files = importClosure(dbDir, ENTRIES)
  const listed = []
  for (const rel of files) {
    mkdirSync(dirname(join(vendor, rel)), { recursive: true })
    const bytes = readFileSync(join(dbDir, rel))
    writeFileSync(join(vendor, rel), bytes)
    listed.push({ file: rel, sha256: createHash('sha256').update(bytes).digest('hex') })
  }
  writeFileSync(join(vendor, 'VENDORED.json'), JSON.stringify({ source: 'packages/kybernos-db', license: 'Apache-2.0', note: 'a copy: change the source and build again, never this folder', files: listed }, null, 2) + '\n')
  return { files: files.length }
}

/** The template copied to `out` (without node_modules, data or an older vendor/), with kybernos-db vendored in. */
export function buildTablesApp ({ out, templateDir = join(here, '..'), dbDir }) {
  const target = resolve(out)
  mkdirSync(target, { recursive: true })
  cpSync(templateDir, target, { recursive: true, filter: (src) => !SKIP.has(relative(templateDir, src).split('/')[0]) })
  return { out: target, ...vendorKybernosDb({ out: target, ...(dbDir === undefined ? {} : { dbDir }) }) }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const at = args.indexOf('--kybernos-db')
  const dbDir = at >= 0 ? resolve(args.splice(at, 2)[1]) : undefined
  if (args.length !== 1) { console.error('usage: node scripts/build-tables-app.mjs <out dir> [--kybernos-db <dir>]'); process.exit(2) }
  const done = buildTablesApp({ out: args[0], ...(dbDir === undefined ? {} : { dbDir }) })
  console.log('built ' + done.out + ' (' + done.files + ' kybernos-db files vendored); next: npm ci --ignore-scripts')
}
