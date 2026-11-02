#!/usr/bin/env node
/** The Agent Teams Marketplace: what a template installed from the plugin carries, and how its « Published on kybernos.app » heading reads on a phone
 *  (R-V-03 and R-V-02 of the 2026-10-16 pre-production audit, round 3).
 *
 *  R-V-03: Inbound Closer (and the two other shipped templates) declared the skills `kyber-routing` and `kyber-memory`. No skill of that name ships
 *  with the plugin (the skills it seeds are the `skills/<name>/SKILL.md` folders of the bundles), so the first install on a machine that does not
 *  happen to have them made Atlas flag a broken link right away: « Declares the skill “kyber-routing”, which is not among your installed skills ».
 *  A template declares only skills that ship with the plugin.
 *
 *  R-V-02: at 390 px the heading sat next to « No kybernos.app account is linked. » in one row that does not wrap, and the heading was the one that
 *  gave way (« Published on ky… »): the word that says where the catalogue lives was lost. The heading keeps its width and the sentence drops under it.
 *
 *  Source-level (the bundle is a browser module); the pixels are `node scripts/check-pages-live.mjs` in a sandbox.
 *
 *  Usage: node packages/kybernos-plugin/test-marketplace-templates.mjs   (exit 0 = all pass; KB_PLUGIN_CLIENT=<file> to test another copy) */
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(process.env.KB_PLUGIN_CLIENT || join(here, 'client.js'), 'utf8')

// 1. the skills a shipped template declares are skills that ship
{
  const from = src.indexOf('const KB_MARKET_TEAMS = [')
  assert.ok(from > 0, 'the shipped templates are in the client')
  const to = src.indexOf('\n    ]\n', from)
  const block = src.slice(from, to)
  const ids = [...block.matchAll(/\bid: '([a-z0-9-]+)', name: '/g)].map((m) => m[1])
  assert.deepEqual(ids, ['inbound-closer', 'research-desk', 'studencik'], 'the three templates were found')
  const declared = [...block.matchAll(/^\s{8}skills: \[([^\]]*)\],$/gm)].map((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]))
  assert.equal(declared.length, 3, 'each template has a skills line')

  const shipped = new Set()
  const packages = join(here, '..')
  for (const bundle of readdirSync(packages)) {
    const dir = join(packages, bundle, 'skills')
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir)) if (existsSync(join(dir, name, 'SKILL.md'))) shipped.add(name)
  }
  assert.ok(shipped.has('report-feedback') && shipped.size >= 6, 'the skills the plugins ship were found: ' + [...shipped].join(', '))
  const missing = declared.flat().filter((name) => !shipped.has(name))
  assert.deepEqual(missing, [], 'a template declares skills that no bundle ships: ' + missing.join(', '))
  ok('every skill a shipped template declares ships with the plugin (' + declared.flat().length + ' declared)')
}

// 2. the heading of « Published on kybernos.app » keeps its words
{
  const first = src.indexOf("'data-kb': 'market-cloud'")
  const loaded = src.indexOf("'data-kb': 'market-cloud'", first + 1)
  assert.ok(first > 0 && loaded > first, 'the skeleton and the loaded block are both there')
  const head = src.slice(loaded, loaded + 900)
  const row = /h\('div', \{ style: \{ ([^}]*) \} \},\s*h\('span', \{ className: 'kb8-name'([^\n]*?) \}, kbt\('kbui\.market\.cloud\.title'\)\)/.exec(head)
  assert.ok(row !== null, 'the heading row of the loaded block was found')
  assert.match(row[1], /flexWrap: 'wrap'/, 'the row wraps: the sentence drops under the heading when they do not fit')
  assert.match(row[2], /flex: '0 0 auto'/, 'the heading does not give way (it was the ellipsised one)')
  ok('the heading keeps its width and the status sentence wraps under it (390 px)')
}

console.log('\n' + pass + ' checks passed')
