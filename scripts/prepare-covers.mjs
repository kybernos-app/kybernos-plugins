#!/usr/bin/env node
// Prepares the Featured covers for a relay deployment, and records their hashes in the picks file.
//
//   node scripts/prepare-covers.mjs [--from <folder>] [--write-picks] [--check]
//
// Reads <id>.webp for every pick of packages/kybernos-skills/featured-picks.json from the covers folder (default
// <DSH home>/kybernos/skills-featured), checks each one (a real WebP, at most 600 KB), prints its size and SHA-256, and:
//   - copies it to services/skills-index/covers/ (ignored by git: media is not committed) unless --check;
//   - with --write-picks, writes the SHA-256 into the pick (`coverSha256`), which is what lets a machine accept the picture from ANY relay.
// It deploys nothing: publishing is `vercel deploy --prod` from services/skills-index, on purpose (see its README).
// Exit 0 all good, 1 a cover is missing or invalid.
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dshHome } from './dsh-home.mjs'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null }
const from = arg('--from') !== null ? resolve(arg('--from')) : join(dshHome(), 'kybernos', 'skills-featured')
const writePicks = process.argv.includes('--write-picks')
const checkOnly = process.argv.includes('--check')
const MAX = 600 * 1024

const picksPath = join(repo, 'packages', 'kybernos-skills', 'featured-picks.json')
const picks = JSON.parse(readFileSync(picksPath, 'utf8'))
const dest = join(repo, 'services', 'skills-index', 'covers')
if (!checkOnly) mkdirSync(dest, { recursive: true })

let bad = 0
let pending = 0
const rows = []
for (const it of picks.items) {
  const file = join(from, it.id + '.webp')
  if (!existsSync(file)) {
    // A pick that does not ship a cover yet (no hash): its card draws a tile, and the host makes a picture on the fly when the person has a key. Not an error.
    if (typeof it.coverSha256 !== 'string') { console.log('○ ' + it.id.padEnd(30) + '  no cover yet (a tile is drawn)'); pending += 1; continue }
    console.log('✗ ' + it.id + '  no file in ' + from); bad += 1; continue
  }
  const buf = readFileSync(file)
  if (buf.length < 12 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') { console.log('✗ ' + it.id + '  not a WebP'); bad += 1; continue }
  if (buf.length > MAX) { console.log('✗ ' + it.id + '  ' + buf.length + ' bytes, above the ' + MAX + ' cap'); bad += 1; continue }
  const sha = createHash('sha256').update(buf).digest('hex')
  if (!checkOnly) copyFileSync(file, join(dest, it.id + '.webp'))
  if (writePicks) it.coverSha256 = sha
  rows.push([it.id, buf.length, sha])
  console.log('✓ ' + it.id.padEnd(30) + String(buf.length).padStart(8) + ' bytes  ' + sha.slice(0, 16) + '…')
}
if (bad > 0) { console.error('\n' + bad + ' cover(s) missing or invalid: nothing was written to the picks file'); process.exit(1) }
if (writePicks) { writeFileSync(picksPath, JSON.stringify(picks, null, 2) + '\n'); console.log('\nhashes written to ' + picksPath.replace(repo + '/', '')) }
if (pending > 0) console.log('\n' + pending + ' pick(s) without a cover yet: they are not part of the relay\'s pictures')
console.log('\n' + rows.length + ' covers, ' + Math.round(rows.reduce((a, r) => a + r[1], 0) / 1024) + ' KB' + (checkOnly ? ' (checked, not copied)' : ' copied to services/skills-index/covers/'))
