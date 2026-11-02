#!/usr/bin/env node
// vendor-share.mjs — refreshes the files one plugin reads from another, copied as they are: two files of the Dashboards plugin into packages/kybernos-db/share/vendor/, and the
// password-seal code of kybernos-db into packages/kybernos-plugin/vendor/ (the shared chat Journal). The plugins are installed one by one, so one cannot import the other by a
// relative path; a copy that cannot drift is the way. packages/kybernos-db/test-share.mjs fails when a copy differs from its source (run this script to fix it).
//
//   node scripts/vendor-share.mjs [--check]
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages')
export const VENDORED = [
  ['kybernos-dashboards/model.mjs', 'kybernos-db/share/vendor/dashboards-model.mjs'],
  ['kybernos-dashboards/chart-core.mjs', 'kybernos-db/share/vendor/chart-core.mjs'],
  // the protected-link code of the shared dashboard, read by the shared chat Journal (the page opens a password-sealed document, the host seals one)
  ['kybernos-db/share/seal.mjs', 'kybernos-plugin/vendor/share-seal.mjs'],
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
