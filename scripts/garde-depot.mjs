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
// The ONE media exception (AGENTS.md rule 4): the cover picture of a shipped theme, a small JPEG (themes-shipped.mjs serves it). Anywhere else a picture
// is still an error.
export const COVER_MAX = 160 * 1024
const COVER_PATH = /^packages\/kybernos-plugin\/themes\/(_next\/[a-z][a-z0-9-]{1,39}|[a-z][a-z0-9-]{1,39}\/cover)\.jpg$/
// The second, decided 2026-10-29 with the sample data and widened the same day (high resolution): the invented pictures a shipped theme's sample rows show,
// the photographs of its items (a property, a product, a job) and the portraits of its sample people, JPEGs at `themes/<dir>/demo/photos/<name>.jpg`, made by
// scripts/theme-photos.mjs. Each is at most PHOTO_WIDTH_MAX px wide and PHOTO_MAX heavy; a theme holds PHOTOS_PER_THEME of them at most (photographs and
// portraits together).
export const PHOTO_MAX = 220 * 1024
export const PHOTO_WIDTH_MAX = 1280
export const PHOTOS_PER_THEME = 24
const PHOTO_PATH = /^packages\/kybernos-plugin\/themes\/([a-z][a-z0-9-]{1,39})\/demo\/photos\/[a-z0-9][a-z0-9-]{1,59}\.jpg$/
/** A tracked sample picture of a shipped theme, at most PHOTO_MAX. */
export const isAllowedPhoto = (file, size) => PHOTO_PATH.test(file) && size <= PHOTO_MAX
/** The theme folder a tracked sample picture belongs to, or null. */
export const photoThemeOf = (file) => { const m = PHOTO_PATH.exec(file); return m === null ? null : m[1] }
/** The pixel size `{ width, height }` a JPEG declares (its first start-of-frame marker), or null when the bytes are not a JPEG that says. */
export const jpegSize = (bytes) => {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let at = 2
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) { at += 1; continue }
    const marker = bytes[at + 1]
    if (marker === 0xff) { at += 1; continue }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { at += 2; continue }
    const length = (bytes[at + 2] << 8) | bytes[at + 3]
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: (bytes[at + 5] << 8) | bytes[at + 6], width: (bytes[at + 7] << 8) | bytes[at + 8] }
    at += 2 + length
  }
  return null
}
/** A tracked file that may be a picture: a shipped theme's cover (`themes/<dir>/cover.jpg`) or a next trade's (`themes/_next/<id>.jpg`), at most COVER_MAX. */
export const isAllowedCover = (file, size) => COVER_PATH.test(file) && size <= COVER_MAX
/** The cover of a theme folder a stranger installs (its own `cover.jpg`, at its root), at most COVER_MAX: the same exception, seen from inside the folder. */
export const isThemeCover = (rel, size) => rel === 'cover.jpg' && size <= COVER_MAX
/** Whether the first bytes are a JPEG's (a renamed GIF is not a cover). */
export const looksLikeJpeg = (bytes) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
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
  const photos = new Map()
  for (const f of files) {
    const size = statSync(f).size
    if (MEDIA.test(f)) {
      if (!isAllowedCover(f, size) && !isAllowedPhoto(f, size)) errors.push(`media file tracked: ${f}`)
      else if (!looksLikeJpeg(readFileSync(f))) errors.push(`a cover or a sample picture that is not a JPEG: ${f}`)
      else if (photoThemeOf(f) !== null) {
        photos.set(photoThemeOf(f), (photos.get(photoThemeOf(f)) ?? 0) + 1)
        const px = jpegSize(readFileSync(f))
        if (px === null || px.width > PHOTO_WIDTH_MAX) errors.push(`a sample picture wider than ${PHOTO_WIDTH_MAX} px (or whose size cannot be read): ${f}`)
      }
    }
    if (SECRET.test(f)) errors.push(`secret-looking file tracked: ${f}`)
    if (size > MAX_BYTES) errors.push(`over ${MAX_BYTES / 1048576} MB: ${f} (${(size / 1048576).toFixed(1)} MB)`)
    if (isScanned(f, size)) warnings.push(...warningsOf(f, readFileSync(f, 'utf8')))
  }
  for (const [theme, n] of photos) if (n > PHOTOS_PER_THEME) errors.push(`${n} sample pictures in the theme ${theme} (at most ${PHOTOS_PER_THEME})`)
  for (const w of warnings) console.log('⚠ ' + w)
  for (const e of errors) console.error('✗ ' + e)
  console.log(`${files.length} tracked files — ${errors.length} error(s), ${warnings.length} warning(s)`)
  process.exit(errors.length === 0 ? 0 : 1)
}
