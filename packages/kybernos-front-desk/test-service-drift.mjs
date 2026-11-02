// The service copy inside this bundle (service/) is generated from packages/front-desk by scripts/sync-front-desk-service.mjs.
// This fails when it is stale, so the bundle never runs a different service from the open-source package it claims to ship.
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, '..', '..', 'scripts', 'sync-front-desk-service.mjs')
let failed = 0
const ok = (name, cond, detail) => { console.log((cond ? '  ok   ' : '  FAIL ') + name + (cond || detail === undefined ? '' : '  -- ' + detail)); if (!cond) failed += 1 }

ok('the service entry is in the bundle', existsSync(join(here, 'service', 'bin', 'front-desk.mjs')))
if (existsSync(script)) {
  const { differences } = await import(pathToFileURL(script).href)
  const d = differences()
  ok('the service copy is identical to packages/front-desk (run: node scripts/sync-front-desk-service.mjs)', d.length === 0, d.slice(0, 5).join('; '))
} else {
  // An installed bundle has no repository around it: only the entry has to be there.
  console.log('  SKIPPED: the drift check, not inside the repository (it is a repository test)')
}
process.exit(failed ? 1 : 0)
