// The skill-seeding module exists four times, because bundles cannot import each other: in
// kybernos-theme (it ships `loader` and `loading-text`), in kybernos-plugin (the core, which ships
// `automation-creator`), in kybernos-dashboards (`dashboard-builder`, `dashboard-sources`) and in kybernos-registry (`plugin-creator`). The rules are the
// same on purpose (a skill the user wrote or edited is never overwritten), so a fix made in one must be made in
// all. This fails when the copies differ from the first import down (their header comments are their own).
// Usage: node scripts/test-seed-skills-drift.mjs   (exit 0 = identical)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const body = (rel) => {
  const text = readFileSync(root + rel, 'utf8')
  const i = text.indexOf('import { createHash }')
  return i < 0 ? null : text.slice(i)
}
const COPIES = ['packages/kybernos-theme/seed-skills.mjs', 'packages/kybernos-plugin/seed-skills.mjs', 'packages/kybernos-dashboards/seed-skills.mjs', 'packages/kybernos-registry/seed-skills.mjs', 'packages/kybernos-slash/seed-skills.mjs']
const bodies = COPIES.map((rel) => ({ rel, text: body(rel) }))
const missing = bodies.find((b) => b.text === null)
if (missing !== undefined) { console.error('FAIL: ' + missing.rel + ' has no `import { createHash }` line to compare from'); process.exit(1) }
const ref = bodies[0]
for (const other of bodies.slice(1)) {
  if (other.text !== ref.text) {
    const x = ref.text.split('\n'); const y = other.text.split('\n')
    const at = x.findIndex((l, i) => l !== y[i])
    console.error('FAIL: the seed-skills.mjs copies differ from line ' + (at + 1) + ' of the body:\n  ' + ref.rel + ': ' + x[at] + '\n  ' + other.rel + ': ' + y[at])
    process.exit(1)
  }
}
console.log('ok   the ' + COPIES.length + ' seed-skills.mjs copies are identical (' + ref.text.split('\n').length + ' lines)')
