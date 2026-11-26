#!/usr/bin/env node
// Leaves out of a hosted image the bundles that are for the phone app only.
//
// `@local/kybernos-no-process` swaps the engine's real program launcher for an in-app one, which a computer has and needs; its README says « leave it off on a computer ».
// A fresh profile activates every package the lifecycle links, so the bundle would load, miss `@deepseek-ai/dsh-subprocess`, leave nine entries inactive and make the installer
// roll the whole build back. The image never carries it: the folder goes, and its row in `scripts/lifecycle-packages.json` with it.
//
//   node leave-out-phone-only.mjs <the plugins folder>
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PHONE_ONLY = ['kybernos-no-process']

const isRowOf = (item) => item !== null && typeof item === 'object' && PHONE_ONLY.includes(item.dir)
const strip = (node) => {
  if (Array.isArray(node)) return node.filter((item) => !isRowOf(item)).map(strip)
  if (node !== null && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, strip(value)]))
  return node
}

/** Removes the folders and the lifecycle rows of the phone-only bundles under `root`; returns what was left out. */
export const leaveOut = (root) => {
  const left = []
  for (const dir of PHONE_ONLY) {
    const folder = join(root, 'packages', dir)
    if (existsSync(folder)) { rmSync(folder, { recursive: true, force: true }); left.push(dir) }
  }
  const file = join(root, 'scripts', 'lifecycle-packages.json')
  if (existsSync(file)) {
    const before = readFileSync(file, 'utf8')
    const after = JSON.stringify(strip(JSON.parse(before)), null, 2) + '\n'
    if (after !== before) { writeFileSync(file, after); if (!left.length) left.push('lifecycle rows only') }
  }
  return left
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.argv[2]
  if (!root) { console.error('usage: leave-out-phone-only.mjs <the plugins folder>'); process.exit(2) }
  const left = leaveOut(root)
  console.log(left.length ? 'left out of the image: ' + left.join(', ') : 'nothing phone-only in ' + root)
}
