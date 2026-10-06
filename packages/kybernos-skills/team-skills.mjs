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

// The patterns of the server's own scan (core/middleware/skills/_skillrepos.py, and src/modules/skills/validate.ts of kybernos-server).
// The JWT one is not here: see `hasJwt`. A skill is text a stranger wrote, so every check below must be LINEAR in the size of the text:
// none of these expressions backtracks across a long run (each class is followed by a character the class does not hold, or by the end).
const SECRET_PATTERNS = Object.freeze([
  ['aws_access_key', /AKIA[0-9A-Z]{16}/],
  ['github_pat', /gh[pousr]_[A-Za-z0-9]{30,}/],
  ['slack_token', /xox[abp]-[A-Za-z0-9-]{10,}/],
  ['openai_key', /sk-[A-Za-z0-9]{20,}/],
  ['anthropic_key', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['private_key_block', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['generic_bearer', /bearer\s+[a-z0-9._~+/-]{22,}={0,2}/i],
  ['google_api_key', /AIza[0-9A-Za-z_-]{35}/]
])

const isWordChar = (c) => c !== undefined && /[A-Za-z0-9_]/.test(c)

/**
 * Pure. Whether a line holds a JWT: `\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b`. That regular expression is
 * QUADRATIC on a line such as `-eyJ-eyJ-eyJ…` (every `eyJ` scans to the end of the run, then backtracks): 160 000 characters took 6.7 s,
 * with the host frozen. The same rule is applied run by run instead. The class has no `.`, so the three parts are three maximal runs
 * joined by single dots, and for the first run only its earliest `eyJ` can matter (it leaves the longest tail). The test checks this
 * against the regular expression on random lines.
 */
export const hasJwt = (line) => {
  const runs = []
  for (const m of line.matchAll(/[A-Za-z0-9_-]+/g)) runs.push([m.index, m.index + m[0].length])
  for (let i = 0; i + 2 < runs.length; i += 1) {
    const [s1, e1] = runs[i]
    const [s2, e2] = runs[i + 1]
    const [s3, e3] = runs[i + 2]
    if (e1 + 1 !== s2 || e2 + 1 !== s3 || line[e1] !== '.' || line[e2] !== '.') continue
    if (e2 - s2 < 10) continue
    // The first run: an `eyJ` at a word boundary (the start of the run, or after a `-`) with ten more characters of the run after it.
    // Searched in the run, never past it: `indexOf` on the line would scan on to the next `eyJ` anywhere, for every run.
    const run = line.slice(s1, e1)
    let start = -1
    for (let p = run.indexOf('eyJ'); p !== -1 && p + 13 <= run.length; p = run.indexOf('eyJ', p + 1)) {
      if (p === 0 || run[p - 1] === '-') { start = p; break }
    }
    if (start === -1) continue
    // The last: ten characters or more of the run, ending at a word boundary (the end of the run counts, unless it ends on a `-`).
    for (let q = s3 + 10; q <= e3; q += 1) {
      if (isWordChar(line[q - 1]) !== isWordChar(line[q])) return true
    }
  }
  return false
}

/** Pure. `{ file, line, kind }` of the first secret-looking line, or null. The matched text is never returned. */
export const findSecret = (files) => {
  for (const f of files) {
    const lines = String(f.content).split(/\r?\n/)
    for (let i = 0; i < lines.length; i += 1) {
      const text = lines[i]
      // The shortest secret (`xoxa-` and ten characters) is 15 characters: most lines of a file are shorter.
      if (text.length < 15) continue
      for (const [kind, re] of SECRET_PATTERNS) {
        if (re.test(text)) return { file: f.path, line: i + 1, kind }
      }
      if (hasJwt(text)) return { file: f.path, line: i + 1, kind: 'jwt' }
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

/**
 * Pure. The `key: value` pairs of a SKILL.md frontmatter, unquoted the way DSH reads them (double quotes with \\ \" \n, single quotes).
 * Not one regular expression `^key:[ \t]*(.*)$`: its spaces and its `.*` overlap, and on `k:` followed by 250 000 spaces and a character `.` does
 * not match (a lone CR, U+2028, U+2029) it backtracks quadratically (24 s for one SKILL.md). The key first, then the rest: a line whose rest holds
 * what `.` does not match is no pair, exactly as before.
 */
// What `.` does not match: CR, U+2028, U+2029 (built from code points: a literal line terminator inside a regex literal would end it).
const NOT_DOT = new RegExp('[\\r' + String.fromCharCode(0x2028, 0x2029) + ']')

export const frontmatterOfText = (text) => {
  const out = {}
  const lines = String(text).split(/\r?\n/)
  if (lines[0] !== '---') return out
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (line === '---') break
    const m = /^([A-Za-z][A-Za-z0-9_-]*):/.exec(line)
    if (m === null) continue
    const rest = line.slice(m[0].length)
    if (NOT_DOT.test(rest)) continue
    const t = rest.trim()
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

// A text that can be stored and read back unchanged: no NUL (a picture, an archive) and no half of a surrogate pair (not UTF-8).
const isStorableText = (s) => {
  if (s.indexOf('\0') !== -1) return false
  if (typeof s.isWellFormed === 'function') return s.isWellFormed()
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1)
      if (d >= 0xdc00 && d <= 0xdfff) i += 1
      else return false
    } else if (c >= 0xdc00 && c <= 0xdfff) return false
  }
  return true
}

// What a Windows machine cannot write (a skill's paths go to every member's disk): a segment that ends with a dot, or is a device name
// (with or without an extension). The server refuses the same.
const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/i
const windowsUnsafe = (path) => path.split('/').some((seg) => seg.endsWith('.') || WINDOWS_DEVICE.test(seg.split('.')[0]))

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
  const folded = new Set()
  let bytes = 0
  for (const f of files) {
    if (f === null || typeof f !== 'object' || typeof f.path !== 'string' || typeof f.content !== 'string') return { ok: false, reason: 'bad_path' }
    if (f.path.length > TEAM_SKILL_LIMITS.pathChars || !PATH_RE.test(f.path) || seen.has(f.path) || windowsUnsafe(f.path)) return { ok: false, reason: 'bad_path', file: f.path.slice(0, TEAM_SKILL_LIMITS.pathChars) }
    // Two paths that differ only by case are one file on a Mac or a Windows disk.
    if (folded.has(f.path.toLowerCase())) return { ok: false, reason: 'bad_path', file: f.path }
    seen.add(f.path)
    folded.add(f.path.toLowerCase())
    if (!isStorableText(f.content)) return { ok: false, reason: 'binary', file: f.path }
    const size = Buffer.byteLength(f.content, 'utf8')
    if (size > TEAM_SKILL_LIMITS.fileBytes) return { ok: false, reason: 'file_too_large', file: f.path }
    bytes += size
  }
  if (bytes > TEAM_SKILL_LIMITS.totalBytes) return { ok: false, reason: 'too_large' }
  // A file that is also the folder of another one cannot be written.
  for (const path of seen) {
    const parts = path.toLowerCase().split('/')
    for (let n = 1; n < parts.length; n += 1) {
      if (folded.has(parts.slice(0, n).join('/'))) return { ok: false, reason: 'bad_path', file: path }
    }
  }
  const entry = files.find((f) => f.path === 'SKILL.md')
  if (entry === undefined) return { ok: false, reason: 'no_skill_md' }
  const fm = frontmatterOfText(entry.content)
  const description = typeof fm.description === 'string' ? fm.description.trim() : ''
  if (fm.name !== s.name || description === '' || description.length > TEAM_SKILL_LIMITS.description) return { ok: false, reason: 'frontmatter', file: 'SKILL.md' }
  if (!isStorableText(description)) return { ok: false, reason: 'description' }
  // The description is shown to every member and is its own field, not a file: a secret in it is as public as one in a file.
  const secret = findSecret([...files, { path: '<description>', content: description }])
  if (secret !== null) return { ok: false, reason: 'scan_rejected', file: secret.file, line: secret.line }
  return { ok: true, version: skillVersion(files), count: files.length, bytes, scripts: scriptFiles(files), description }
}
