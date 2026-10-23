#!/usr/bin/env node
// packages/kybernos-plugin/icon-tags.json: the search words of every icon the pickers offer (UX audit 2026-10-20).
//
//   node scripts/build-icon-tags.mjs <lucide-static tags.json: a path or an https URL> [--check]
//   e.g. node scripts/build-icon-tags.mjs https://unpkg.com/lucide-static@1.59.0/tags.json
//
// The icon picker used to compare the typed word with the icon's NAME only: « sport » found `sport-shoe` and nothing else, while the
// library lists twenty icons tagged « sport » (medal, bike, kayak...). Lucide publishes those tags (ISC, see NOTICE). This script keeps, for
// the icons of packages/kybernos-plugin/icons.json, one string of lower-case words each. An icon that the library renamed (alert-circle,
// now circle-alert) has no tags under its old name: it takes those of the icon that draws exactly the same shapes. --check fails when the
// committed file is not what this script would write from that source.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = join(REPO, 'packages', 'kybernos-plugin')
const [src] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
if (src === undefined) { console.error('usage: node scripts/build-icon-tags.mjs <tags.json path or URL> [--check]'); process.exit(2) }

export const buildTags = (catalog, lucideTags) => {
  const names = Object.keys(catalog).sort()
  const shape = (n) => JSON.stringify(catalog[n])
  const byShape = new Map()
  for (const n of names) if (lucideTags[n] !== undefined && !byShape.has(shape(n))) byShape.set(shape(n), n)
  const out = {}
  let borrowed = 0
  for (const n of names) {
    let raw = lucideTags[n]
    if (raw === undefined) { const twin = byShape.get(shape(n)); if (twin !== undefined) { raw = lucideTags[twin]; borrowed += 1 } }
    if (!Array.isArray(raw)) continue
    const own = new Set(n.split('-'))
    const words = []
    for (const tag of raw) for (const w of String(tag).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').split(/[^a-z0-9]+/)) {
      if (w.length >= 2 && !own.has(w) && !words.includes(w)) words.push(w)
    }
    if (words.length > 0) out[n] = words.join(' ')
  }
  return { tags: out, borrowed }
}

const text = /^https?:/.test(src) ? await (await fetch(src)).text() : readFileSync(src, 'utf8')
const catalog = JSON.parse(readFileSync(join(DIR, 'icons.json'), 'utf8'))
const { tags, borrowed } = buildTags(catalog, JSON.parse(text))
const file = { source: 'Lucide tags.json (lucide-static), ISC License: see NOTICE', from: (/lucide-static@[0-9][0-9.]*/.exec(src) || ['a local copy'])[0], icons: Object.keys(tags).length, tags }
const next = JSON.stringify(file) + '\n'
if (process.argv.includes('--check')) {
  let now = ''
  try { now = readFileSync(join(DIR, 'icon-tags.json'), 'utf8') } catch (e) { /* absent */ }
  const same = (() => { try { const a = JSON.parse(now); return JSON.stringify(a.tags) === JSON.stringify(tags) } catch (e) { return false } })()
  console.log(same ? 'icon-tags.json is what the source gives' : 'icon-tags.json differs from the source')
  process.exit(same ? 0 : 1)
}
writeFileSync(join(DIR, 'icon-tags.json'), next)
console.log(Object.keys(tags).length + ' of ' + Object.keys(catalog).length + ' icons have words (' + borrowed + ' through an identical drawing), ' + Math.round(next.length / 1024) + ' KB')
