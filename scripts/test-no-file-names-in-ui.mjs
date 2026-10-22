// ── The sentences of the interface do not name the files behind it ─────────────────────────────────────────────────────
//
// About forty sentences said « settings.yaml », « ~/.dsh/.env », « dsh-compat.json » or « lessons.archive.jsonl » for something the person does not touch: the settings, their
// key, the compatibility contract, the archive. They now say that (« your settings », « kept on this machine »). A file name stays where the person is told to open or
// repair that very file (cordis.patch.yml to edit by hand, settings.json that cannot be read, kyber.yml which IS the team's definition, the folders skills are put in).
// This guard keeps the four names that were cleaned out of the clients, line by line (comments are not the interface); the places that still name a file for a reason
// are not in it, so a new sentence naming one of THESE four fails.
//
//   node scripts/test-no-file-names-in-ui.mjs
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const BAD = /settings\.yaml|~\/\.dsh\/\.env|dsh-compat\.json|lessons\.archive\.jsonl/
const hits = []
let lines = 0
for (const pkg of readdirSync(join(root, 'packages')).sort()) {
  const file = join(root, 'packages', pkg, 'client.js')
  if (!existsSync(file)) continue
  let inBlock = false
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    lines += 1
    if (inBlock) { if (line.includes('*/')) inBlock = false; return }
    if (/^\s*\/\*/.test(line)) { if (!line.includes('*/')) inBlock = true; return }
    if (/^\s*(\/\/|\*)/.test(line)) return
    const code = line.replace(/\/\*.*?\*\//g, '').replace(/\s\/\/\s.*$/, '')
    const m = BAD.exec(code)
    if (m !== null) hits.push(pkg + '/client.js:' + String(i + 1) + '  ' + m[0] + '  ' + code.trim().slice(0, 90))
  })
}
let failed = 0
console.log((hits.length === 0 ? '  ✓ ' : '  ✗ ') + 'no sentence of a client names settings.yaml, ~/.dsh/.env, dsh-compat.json or lessons.archive.jsonl (' + lines + ' lines read)' + (hits.length === 0 ? '' : '\n    ' + hits.join('\n    ')))
if (hits.length > 0) failed += 1
console.log(failed === 0 ? '\nNO FILE NAMES — 0 échec' : '\n' + failed + ' check(s) failed')
process.exit(failed === 0 ? 0 : 1)
