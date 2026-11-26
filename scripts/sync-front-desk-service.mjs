// The front-desk service is one open-source package (packages/front-desk). The plugin kybernos-front-desk runs it as a child process, and a bundle is installed on its own
// and imports nothing from another folder, so the plugin carries a COPY of the service in packages/kybernos-front-desk/service/. This script makes that copy (the folder is
// deleted and written again, never edited by hand); packages/kybernos-front-desk/test-service-drift.mjs fails when the copy differs from the source.
//   node scripts/sync-front-desk-service.mjs          copy
//   node scripts/sync-front-desk-service.mjs --check  exit 1 when the copy is not current
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(root, 'packages', 'front-desk')
const DST = join(root, 'packages', 'kybernos-front-desk', 'service')
// What the running service needs. Not copied: its tests, its README, the example fiche, the live check (a developer's tool), any data folder.
export const INCLUDE = ['package.json', 'bin/front-desk.mjs', 'core', 'server', 'channels']

const walk = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p] })
export const filesOf = (base) => INCLUDE.flatMap((rel) => { const p = join(base, rel); return !existsSync(p) ? [] : statSync(p).isDirectory() ? walk(p) : [p] }).map((p) => relative(base, p)).sort()

export function differences () {
  const a = filesOf(SRC)
  const b = filesOf(DST)
  const out = []
  for (const f of a) { if (!b.includes(f)) out.push('missing: ' + f); else if (!readFileSync(join(SRC, f)).equals(readFileSync(join(DST, f)))) out.push('differs: ' + f) }
  for (const f of b) if (!a.includes(f)) out.push('extra: ' + f)
  return out
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const d = differences()
    if (d.length) { console.error('service copy is not current:\n  ' + d.join('\n  ')); process.exit(1) }
    console.log('ok   the service copy is identical to packages/front-desk (' + filesOf(DST).length + ' files)')
  } else {
    rmSync(DST, { recursive: true, force: true })
    for (const f of filesOf(SRC)) { mkdirSync(dirname(join(DST, f)), { recursive: true }); cpSync(join(SRC, f), join(DST, f)) }
    console.log('copied ' + filesOf(DST).length + ' files to packages/kybernos-front-desk/service')
  }
}
