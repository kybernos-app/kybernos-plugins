// Team skills, the pure half: what a skill must look like to travel to a Team (and to be installed from one), the version that pins it,
// and the secret scan. No network, no file: index.js reads and writes the disk, kybernos-cloud talks to the server.
//
// The rules are the contract of docs/dev/team-skills-contract.md, applied on BOTH ends: the plugin checks before it sends (so the
// user is told why, with the file), the server checks again (it never trusts the plugin), and an install checks what it received
// before it writes anything.
import { createHash } from 'node:crypto'

export const TEAM_SKILL_LIMITS = Object.freeze({
  files: 50,                 // per skill
  fileBytes: 256 * 1024,     // per file
  totalBytes: 1024 * 1024,   // per skill
  description: 1024,         // what DSH requires of a skill
  name: 64,
  pathChars: 200
})

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
// A relative path of `/`-separated segments, each starting with a letter, a digit or `_` (so no `.git`, no `..`, no hidden file).
const PATH_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_][A-Za-z0-9._-]*)*$/
const SCRIPT_EXT = /\.(?:sh|bash|zsh|fish|py|rb|pl|php|js|mjs|cjs|ts|ps1|bat|cmd)$/i

// The patterns of the server's own scan (core/middleware/skills/_skillrepos.py). A match is reported as a file and a line, never as text.
const SECRET_PATTERNS = Object.freeze([
  ['aws_access_key', /AKIA[0-9A-Z]{16}/],
  ['github_pat', /gh[pousr]_[A-Za-z0-9]{30,}/],
  ['slack_token', /xox[abp]-[A-Za-z0-9-]{10,}/],
  ['openai_key', /sk-[A-Za-z0-9]{20,}/],
  ['anthropic_key', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['private_key_block', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['generic_bearer', /bearer\s+[a-z0-9._~+/-]{22,}={0,2}/i],
  ['google_api_key', /AIza[0-9A-Za-z_-]{35}/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/]
])

/** Pure. `{ file, line, kind }` of the first secret-looking line, or null. The matched text is never returned. */
export const findSecret = (files) => {
  for (const f of files) {
    const lines = String(f.content).split(/\r?\n/)
    for (let i = 0; i < lines.length; i += 1) {
      for (const [kind, re] of SECRET_PATTERNS) {
        if (re.test(lines[i])) return { file: f.path, line: i + 1, kind }
      }
    }
  }
  return null
}

/**
 * Pure. SHA-256 (hex) of the files, the version the server and every client compute the same way: for each file sorted by `path`,
 * the path, a NUL byte, the content's byte length in decimal, a NUL byte, then the content bytes (UTF-8). Paths are ASCII (PATH_RE),
 * so the order is the same in any language.
 */
export const skillVersion = (files) => {
  const hash = createHash('sha256')
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : (a.path > b.path ? 1 : 0)))
  for (const f of sorted) {
    const bytes = Buffer.from(String(f.content), 'utf8')
    hash.update(f.path)
    hash.update('\0')
    hash.update(String(bytes.length))
    hash.update('\0')
    hash.update(bytes)
  }
  return hash.digest('hex')
}

/** Pure. The `key: value` pairs of a SKILL.md frontmatter, unquoted the way DSH reads them (double quotes with \\ \" \n, single quotes). */
export const frontmatterOfText = (text) => {
  const out = {}
  const lines = String(text).split(/\r?\n/)
  if (lines[0] !== '---') return out
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] === '---') break
    const m = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(lines[i])
    if (m === null) continue
    const t = m[2].trim()
    if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) out[m[1]] = t.slice(1, -1).replace(/\\(.)/g, (all, c) => (c === 'n' ? '\n' : (c === '\\' || c === '"' ? c : all)))
    else if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) out[m[1]] = t.slice(1, -1).replace(/''/g, "'")
    else out[m[1]] = t
  }
  return out
}

/** Pure. The paths among `files` that look executable: a script by extension, under scripts/, or with a shebang. For the reviewer's eyes. */
export const scriptFiles = (files) => files
  .filter((f) => SCRIPT_EXT.test(f.path) || /^scripts?\//i.test(f.path) || String(f.content).startsWith('#!'))
  .map((f) => f.path)

/**
 * Pure. `{ ok: true, version, count, bytes, scripts, description }` when the skill may travel, else `{ ok: false, reason, file? }` with a
 * reason of the contract: name, description, no_skill_md, frontmatter, bad_path, binary, too_many_files, file_too_large, too_large,
 * scan_rejected. The first problem found, in that order of seriousness.
 */
export const validateTeamSkill = (skill) => {
  const s = skill !== null && typeof skill === 'object' ? skill : {}
  if (typeof s.name !== 'string' || !NAME_RE.test(s.name) || s.name.length > TEAM_SKILL_LIMITS.name) return { ok: false, reason: 'name' }
  const files = Array.isArray(s.files) ? s.files : []
  if (files.length === 0) return { ok: false, reason: 'no_skill_md' }
  if (files.length > TEAM_SKILL_LIMITS.files) return { ok: false, reason: 'too_many_files' }
  const seen = new Set()
  let bytes = 0
  for (const f of files) {
    if (f === null || typeof f !== 'object' || typeof f.path !== 'string' || typeof f.content !== 'string') return { ok: false, reason: 'bad_path' }
    if (f.path.length > TEAM_SKILL_LIMITS.pathChars || !PATH_RE.test(f.path) || seen.has(f.path)) return { ok: false, reason: 'bad_path', file: f.path.slice(0, TEAM_SKILL_LIMITS.pathChars) }
    seen.add(f.path)
    if (f.content.indexOf('\0') !== -1) return { ok: false, reason: 'binary', file: f.path }
    const size = Buffer.byteLength(f.content, 'utf8')
    if (size > TEAM_SKILL_LIMITS.fileBytes) return { ok: false, reason: 'file_too_large', file: f.path }
    bytes += size
  }
  if (bytes > TEAM_SKILL_LIMITS.totalBytes) return { ok: false, reason: 'too_large' }
  const entry = files.find((f) => f.path === 'SKILL.md')
  if (entry === undefined) return { ok: false, reason: 'no_skill_md' }
  const fm = frontmatterOfText(entry.content)
  const description = typeof fm.description === 'string' ? fm.description.trim() : ''
  if (fm.name !== s.name || description === '' || description.length > TEAM_SKILL_LIMITS.description) return { ok: false, reason: 'frontmatter', file: 'SKILL.md' }
  const secret = findSecret(files)
  if (secret !== null) return { ok: false, reason: 'scan_rejected', file: secret.file, line: secret.line }
  return { ok: true, version: skillVersion(files), count: files.length, bytes, scripts: scriptFiles(files), description }
}
