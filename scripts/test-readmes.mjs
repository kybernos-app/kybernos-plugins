#!/usr/bin/env node
// The READMEs say the truth about the repository, without a browser (audit 2026-10-16):
//   - a README is one document: one title, and that title is not pasted again into the middle of a sentence
//     (the README of kybernos-terminal had its own title and first paragraphs pasted into two sentences);
//   - every bundle under packages/ is listed in the README of the repository (kybernos-atlas and kybernos-free-llms were not);
//   - a count in a README matches the thing it counts (the hub README said 26 modules; the catalogue lists 41).
//
//   node scripts/test-readmes.mjs
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }
const read = (rel) => readFileSync(join(REPO, rel), 'utf8')

const readmes = execFileSync('git', ['ls-files', '-z'], { cwd: REPO, encoding: 'utf8' }).split('\0').filter((f) => /(^|\/)README\.md$/.test(f))

console.log('one document each')
{
  const broken = []
  for (const f of readmes) {
    const lines = read(f).split('\n')
    let fence = false
    const titles = []
    lines.forEach((l, i) => {
      if (/^```/.test(l)) fence = !fence
      if (!fence && /^# /.test(l)) titles.push(i)
    })
    if (titles.length !== 1) { broken.push(f + ': ' + titles.length + ' title(s)'); continue }
    const title = lines[titles[0]]
    const again = lines.findIndex((l, i) => i !== titles[0] && l.includes(title))
    if (again >= 0) broken.push(f + ':' + (again + 1) + ' repeats its own title « ' + title + ' »')
  }
  check('there are READMEs to look at', readmes.length > 30, readmes.length)
  check('every README has one title, and does not repeat it inside a sentence', broken.length === 0, broken)
}

console.log('the README of the repository lists every bundle')
{
  const root = read('README.md')
  const dirs = readdirSync(join(REPO, 'packages')).filter((d) => statSync(join(REPO, 'packages', d)).isDirectory() && existsSync(join(REPO, 'packages', d, 'README.md')))
  const missing = dirs.filter((d) => !root.includes('packages/' + d + '/README.md') && !root.includes('(packages/' + d + ')'))
  check('there are bundles to look at', dirs.length > 30, dirs.length)
  check('each one is linked from README.md (the Bundles table, or the standalone tools)', missing.length === 0, missing)
}

console.log('a count in a README is the count of the thing')
{
  const catalogue = JSON.parse(read('packages/kybernos-hub/catalog.json'))
  const hub = read('packages/kybernos-hub/README.md')
  const said = [...hub.matchAll(/\b(\d+) modules\b/g)].map((m) => Number(m[1]))
  check('the hub README gives no module count that is not the catalogue\'s', said.every((n) => n === catalogue.modules.length), { said, catalogue: catalogue.modules.length })
}

console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)
