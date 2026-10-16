// Repository guard: keeps the repo small and clean. Run in CI and before every PR.
//   node scripts/garde-depot.mjs
// Fails (exit 1) on: tracked media/binaries, files over the size cap, secret-looking files.
// Warns (exit 0) on: hard-coded personal paths and mail addresses in any text file (code, READMEs, tests, data; debt to burn down,
// see AGENTS.md rule 4).
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const MAX_BYTES = 4 * 1024 * 1024
const MEDIA = /\.(png|jpe?g|gif|webp|mp4|mov|wav|mp3|ttf|otf|pdf)$/i
const SECRET = /(^|\/)(\.env(\..*)?|.*\.env|cles\.env|codes\.json|id_rsa.*)$/i
// Every text file a person or a maintainer reads: the code, its tests and live checks, the data, the READMEs and docs, the workflows.
// (Until 2026-10-16 only .m?js/.json/.sh were read, the test-/check- files were skipped and a file over 2 MB was not opened: the READMEs,
// the tests and the core's client.js were a blind spot, and the owner's home folder, a mail address and a handle were found there.)
const TEXT = /\.(m?js|cjs|json|sh|cmd|md|ya?ml|html|css|txt|plist|py|toml|webmanifest)$|(^|\/)(Dockerfile[^/]*|NOTICE|LICENSE|THIRD_PARTY_LICENSES|\.gitignore|kybernos-(install|update))$/
// Vendored or generated bundles are not ours to edit.
const SKIPPED = /\.min\.js$|\/vendor\/|(^|\/)package-lock\.json$/
// /opt/homebrew is a platform default (Homebrew on Apple silicon), not a personal path.
const PERSONAL = /\/Users\/(?!me\b|x\b)[A-Za-z0-9._-]+/
// A mail address is personal unless it is a role (people write to a team, not a person), an obvious placeholder (name@, you@,
// example@), a reserved example domain, or a git remote.
const MAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g
const ROLE = /^(noreply|no-reply|support|contact|hello|help|legal|privacy|security|billing|team|info|abuse|dpo|press|sales|admin|feedback|partners|git|example\d*|name|user|someone|you|me|your[._-]?name|john\.doe|jane\.doe|foo|bar|test|a|b|x)$/i
const RESERVED = /(^|\.)(example\.(com|org|net)|[a-z0-9-]+\.example|[a-z0-9-]+\.test|test|invalid|localhost|users\.noreply\.github\.com|anthropic\.com)$/i

/** Is this tracked file read for personal paths and addresses? (a file over the size cap is an error of its own, not read) */
export const isScanned = (file, size) => TEXT.test(file) && !SKIPPED.test(file) && size <= MAX_BYTES
export const personalPath = (line) => PERSONAL.test(line)
export const personalMails = (line) => (line.match(MAIL) || []).filter((m) => {
  const [local, domain] = m.split('@')
  return !ROLE.test(local) && !RESERVED.test(domain)
})
/** The warnings one file's text earns. */
export const warningsOf = (file, text) => {
  const lines = text.split('\n')
  const out = []
  const paths = lines.filter(personalPath).length
  if (paths > 0) out.push(`hard-coded personal path (${paths}x): ${file}`)
  const mails = lines.flatMap(personalMails)
  if (mails.length > 0) out.push(`mail address (${mails.length}x): ${file}`)
  return out
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
  const errors = []
  const warnings = []
  for (const f of files) {
    if (MEDIA.test(f)) errors.push(`media file tracked: ${f}`)
    if (SECRET.test(f)) errors.push(`secret-looking file tracked: ${f}`)
    const size = statSync(f).size
    if (size > MAX_BYTES) errors.push(`over ${MAX_BYTES / 1048576} MB: ${f} (${(size / 1048576).toFixed(1)} MB)`)
    if (isScanned(f, size)) warnings.push(...warningsOf(f, readFileSync(f, 'utf8')))
  }
  for (const w of warnings) console.log('⚠ ' + w)
  for (const e of errors) console.error('✗ ' + e)
  console.log(`${files.length} tracked files — ${errors.length} error(s), ${warnings.length} warning(s)`)
  process.exit(errors.length === 0 ? 0 : 1)
}
