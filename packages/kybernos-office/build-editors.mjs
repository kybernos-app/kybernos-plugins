// Builds the light Office editors (spreadsheet, document, Markdown, PDF and slide deck) from the versions pinned in editors/ (next to this file) and writes them where the
// kybernos-office plugin serves them from: <DSH home>/kybernos/kybernos-office/editors/{sheet,doc,md,pdf,deck}/… plus manifest.json with the sha256 of every file.
// They are heavy (about 17 MB with the fonts, the spreadsheet engine and the PDF engine), so they are never in git (AGENTS.md rule 4): this script makes them on demand.
//
//   node packages/kybernos-office/build-editors.mjs [--home <DSH home>] [--work <folder>]
//
// `npm ci --ignore-scripts` installs exactly what package-lock.json says (integrity hashes included); the work folder is kept, so a second run is quick.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkg = dirname(fileURLToPath(import.meta.url))

export const EDITORS = ['sheet', 'doc', 'md', 'pdf', 'deck']
// Folders served next to the editors: the fonts the document editor loads as `../assets/<name>.ttf` from its own address.
export const SHARED = ['assets']

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const walk = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p] })

/** The `{ version, editors, files }` of a folder holding built editors: every file under <editor>/ and the shared folders, with its hash. */
export function manifestOf (dir, editors, version) {
  const files = {}
  for (const id of [...editors, ...SHARED.filter((d) => existsSync(join(dir, d)))]) {
    for (const p of walk(join(dir, id)).sort()) files[relative(dir, p).split(sep).join('/')] = { sha256: sha256(readFileSync(p)), size: statSync(p).size }
  }
  return { version, editors, files }
}

function main () {
  const args = process.argv.slice(2)
  const arg = (name) => { const i = args.indexOf(name); return i < 0 ? null : (args[i + 1] || null) }
  const home = arg('--home') || process.env.DSH_HOME || join(homedir(), '.dsh')
  const base = join(home, 'kybernos', 'kybernos-office')
  const work = arg('--work') || join(base, 'build')
  const target = join(base, 'editors')
  mkdirSync(work, { recursive: true })

  // 1. the pinned editors, installed as the lockfile says
  const lock = readFileSync(join(pkg, 'editors', 'package-lock.json'))
  const stamp = join(work, '.lock-sha')
  if (!existsSync(join(work, 'node_modules')) || !existsSync(stamp) || readFileSync(stamp, 'utf8') !== sha256(lock)) {
    rmSync(join(work, 'node_modules'), { recursive: true, force: true })
    cpSync(join(pkg, 'editors', 'package.json'), join(work, 'package.json'))
    cpSync(join(pkg, 'editors', 'package-lock.json'), join(work, 'package-lock.json'))
    console.log('installing the pinned editors…')
    execFileSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: work, stdio: 'inherit' })
    writeFileSync(stamp, sha256(lock))
  }

  // 2. the sources of the frames, built into a folder next to the target
  rmSync(join(work, 'src'), { recursive: true, force: true })
  cpSync(join(pkg, 'editor-src'), join(work, 'src'), { recursive: true })
  const fresh = join(base, 'editors.new')
  rmSync(fresh, { recursive: true, force: true })
  mkdirSync(fresh, { recursive: true })
  console.log('building…')
  execFileSync(process.execPath, ['src/build.mjs', fresh], { cwd: work, stdio: 'inherit' })

  // 3. the manifest, then the swap (the old editors stay in place until the new ones are complete)
  const present = EDITORS.filter((id) => existsSync(join(fresh, id)))
  const version = sha256(Buffer.concat([lock, ...walk(join(pkg, 'editor-src')).sort().map((p) => readFileSync(p))])).slice(0, 12)
  const manifest = manifestOf(fresh, present, version)
  writeFileSync(join(fresh, 'manifest.json'), JSON.stringify(manifest, null, 1))
  const old = join(base, 'editors.old')
  rmSync(old, { recursive: true, force: true })
  if (existsSync(target)) renameSync(target, old)
  renameSync(fresh, target)
  rmSync(old, { recursive: true, force: true })
  const total = Object.values(manifest.files).reduce((n, f) => n + f.size, 0)
  console.log(`editors ${present.join(' + ')}: ${Object.keys(manifest.files).length} files, ${(total / 1048576).toFixed(1)} MB, version ${version}, in ${target}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
