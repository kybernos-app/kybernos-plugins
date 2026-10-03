// Repository guard: keeps the repo small and clean. Run in CI and before every PR.
//   node scripts/garde-depot.mjs
// Fails (exit 1) on: tracked media/binaries, files over the size cap, secret-looking files.
// Warns (exit 0) on: hard-coded personal paths in code (debt to burn down, see AGENTS.md).
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'

const MAX_BYTES = 4 * 1024 * 1024
const MEDIA = /\.(png|jpe?g|gif|webp|mp4|mov|wav|mp3|ttf|otf|pdf)$/i
const SECRET = /(^|\/)(\.env(\..*)?|.*\.env|cles\.env|codes\.json|id_rsa.*)$/i
const CODE = /\.(m?js|json|sh)$/
const PERSONAL = /\/Users\/[A-Za-z0-9._-]+|\/opt\/homebrew/

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
const errors = []
const warnings = []
for (const f of files) {
  if (MEDIA.test(f)) errors.push(`media file tracked: ${f}`)
  if (SECRET.test(f)) errors.push(`secret-looking file tracked: ${f}`)
  const size = statSync(f).size
  if (size > MAX_BYTES) errors.push(`over ${MAX_BYTES / 1048576} MB: ${f} (${(size / 1048576).toFixed(1)} MB)`)
  if (CODE.test(f) && !/(^|\/)(test-|check-)|\.min\.js$|\/vendor\//.test(f) && size < 2 * 1048576) {
    const hits = readFileSync(f, 'utf8').split('\n').filter((l) => PERSONAL.test(l)).length
    if (hits > 0) warnings.push(`hard-coded personal path (${hits}x): ${f}`)
  }
}
for (const w of warnings) console.log('⚠ ' + w)
for (const e of errors) console.error('✗ ' + e)
console.log(`${files.length} tracked files — ${errors.length} error(s), ${warnings.length} warning(s)`)
process.exit(errors.length === 0 ? 0 : 1)
