// The skill-seeding module exists twice, because bundles cannot import each other: in
// kybernos-theme (it ships `loader` and `loading-text`) and in kybernos-plugin (the core, which ships
// `automation-creator`). The rules are the same on purpose (a skill the user wrote or edited is never
// overwritten), so a fix made in one must be made in both. This fails when the two copies differ from
// the first import down (their header comments are their own).
// Usage: node scripts/test-seed-skills-drift.mjs   (exit 0 = identical)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const body = (rel) => {
  const text = readFileSync(root + rel, 'utf8')
  const i = text.indexOf('import { createHash }')
  return i < 0 ? null : text.slice(i)
}
const theme = body('packages/kybernos-theme/seed-skills.mjs')
const core = body('packages/kybernos-plugin/seed-skills.mjs')
if (theme === null || core === null) { console.error('FAIL: a seed-skills.mjs has no `import { createHash }` line to compare from'); process.exit(1) }
if (theme !== core) {
  const a = theme.split('\n'); const b = core.split('\n')
  const at = a.findIndex((l, i) => l !== b[i])
  console.error('FAIL: the two seed-skills.mjs copies differ from line ' + (at + 1) + ' of the body:\n  theme: ' + a[at] + '\n  core:  ' + b[at])
  process.exit(1)
}
console.log('ok   the two seed-skills.mjs copies are identical (' + theme.split('\n').length + ' lines)')
