#!/usr/bin/env node
// vendor-share.mjs — refreshes the two files of the Dashboards plugin that the shared-dashboard code of kybernos-db reads, copied as they are into
// packages/kybernos-db/share/vendor/. The plugins are installed one by one, so one cannot import the other by a relative path; a copy that cannot drift is the way.
// packages/kybernos-db/test-share.mjs fails when a copy differs from its source (run this script to fix it). Nothing is changed in the Dashboards plugin.
//
//   node scripts/vendor-share.mjs [--check]
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages')
export const VENDORED = [
  ['kybernos-dashboards/model.mjs', 'kybernos-db/share/vendor/dashboards-model.mjs'],
  ['kybernos-dashboards/chart-core.mjs', 'kybernos-db/share/vendor/chart-core.mjs'],
]
export const drifted = () => VENDORED.filter(([from, to]) => { try { return !readFileSync(join(root, from)).equals(readFileSync(join(root, to))) } catch (e) { return true } })

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const bad = drifted()
    for (const [, to] of bad) console.log('drifted: ' + to)
    process.exit(bad.length === 0 ? 0 : 1)
  }
  for (const [from, to] of VENDORED) { mkdirSync(dirname(join(root, to)), { recursive: true }); copyFileSync(join(root, from), join(root, to)); console.log('copied ' + from + ' -> ' + to) }
}
