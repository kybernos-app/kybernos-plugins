// The rules a skill is checked against, as pure functions: no network, no disk, no clock. Two readers share them, so that they cannot drift:
//   - Discover (this package's host, index.js `previewSkill`) warns before an install when the SKILL.md would be rejected;
//   - the maintainer tool scripts/vet-skills.mjs (scripts/vet-skills/core.mjs re-exports them) vets the Featured picks with the same rules.
// A finding is { rule, level, message, facts? } with level `reject` (would ship a broken or unsafe skill), `flag` (a person looks) or `info` (a fact).
// `facts` are what a screen needs to word the finding in its own language (names, a count): the message is English and for the maintainer's report.

// Bump when a rule below changes: every vetted skill is analysed again once, on the next pass of the maintainer tool.
export const RULES_VERSION = 2 // 2: the `curl ... | sh` marker looks 200 characters ahead, not to the end of the line (the text is a stranger's, read by Discover)

// The thresholds Discover uses. scripts/vet-skills/config.json carries the same numbers for the maintainer tool; a test (scripts/test-vet-skills.mjs)
// fails when they differ.
export const DEFAULT_RULES = Object.freeze({ minBodyChars: 500, shortBodyChars: 800, maxSkillMdBytes: 24576, maxFolderBytes: 5242880, maxFolderFiles: 200 })

const unquote = (s) => (s.length >= 2 && (s[0] === '"' || s[0] === "'") && s[s.length - 1] === s[0] ? s.slice(1, -1) : s)

const binsOf = (head) => {
  const lines = head.split(/\r?\n/)
  const out = []
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(\s*)bins:\s*(.*)$/.exec(lines[i])
    if (m === null) continue
    if (m[2].startsWith('[')) {
      for (const x of m[2].replace(/[[\]]/g, '').split(',')) { const v = unquote(x.trim()); if (v !== '') out.push(v) }
      continue
    }
    for (let j = i + 1; j < lines.length; j += 1) {
      const item = /^(\s*)-\s*(\S.*)$/.exec(lines[j])
      if (item === null || item[1].length <= m[1].length) break
      out.push(unquote(item[2].trim()))
    }
  }
  return out
}

/** A SKILL.md as the installer reads it: top-level header fields, the body after the header, the command-line tools it declares. */
export const parseSkill = (text) => {
  const raw = typeof text === 'string' ? text.replace(/^﻿/, '') : ''
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(raw)
  const head = m === null ? '' : m[1]
  const fields = {}
  for (const line of head.split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):[ \t]*(.*)$/.exec(line)
    if (kv !== null) fields[kv[1]] = unquote(kv[2].trim())
  }
  return { fields, body: (m === null ? raw : raw.slice(m[0].length)).trim(), bins: binsOf(head), hasHeader: m !== null }
}

// Pointers to other skills. `Skill tool ... "x"` is the whole skill handing over; `../x/` is a read of a folder the installer does not copy.
const SKILL_TOOL_RE = /\bSkill tool\b[^\n"'`]{0,80}["'`]([a-z0-9][a-z0-9-]*)["'`]/gi
const RELATIVE_RE = /\.\.\/([A-Za-z0-9][\w.-]*)\//g
const NEED_RE = /\b(?:prerequisites?|required?|requirements?|must|before you|first)\b/i
const SECRET_RES =[/\bsk-[A-Za-z0-9_-]{24,}/, /\bghp_[A-Za-z0-9]{30,}/, /\bgithub_pat_[A-Za-z0-9_]{30,}/, /\bAKIA[0-9A-Z]{16}\b/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bxox[baprs]-[A-Za-z0-9-]{10,}/]
const INJECTION_RES = [
  [/ignore\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above)\s+(?:instructions|messages)/i, 'tells the model to ignore earlier instructions'],
  [/(?:do\s+not|don't|never)\s+(?:tell|mention|reveal|inform)\s+(?:this\s+to\s+)?the\s+user/i, 'asks to hide something from the user'],
  [/(?:curl|wget)\b[^\n|]{0,200}\|\s*(?:ba|z)?sh\b/i, 'pipes a download into a shell'],
  [/base64\s+(?:-d|--decode)/i, 'decodes base64 at run time']
]

const allMatches = (re, text, group) => {
  const out = []
  for (const m of text.matchAll(re)) out.push(m[group])
  return out
}
const unique = (list) => Array.from(new Set(list))
const baseName = (dir) => dir.split('/').pop()
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Directories of a repository that hold a SKILL.md ('' is the repository root), from its recursive tree. */
export const skillDirs = (entries) => entries
  .filter((e) => e.type === 'blob' && (e.path === 'SKILL.md' || e.path.endsWith('/SKILL.md')))
  .map((e) => (e.path === 'SKILL.md' ? '' : e.path.slice(0, -'/SKILL.md'.length)))

/**
 * What the text and the files of ONE skill folder say about it. `siblingDirs` are the other skill folders of the same repository.
 * `deps` are the sibling folders the skill hands over to or reads from: they are part of what "this skill changed" means.
 */
export const analyseContent = ({ text, files = [], siblingDirs = [], licenseText = '' }, cfg) => {
  const skill = parseSkill(text)
  const { fields, body } = skill
  const findings = []
  const add = (rule, level, message, facts) => findings.push(facts === undefined ? { rule, level, message } : { rule, level, message, facts })

  if (!skill.hasHeader || fields.name === undefined || fields.name === '' || fields.description === undefined || fields.description === '') {
    add('frontmatter_incomplete', 'reject', 'SKILL.md has no name or no description in its header: the installer would refuse it')
  }
  if (body.length < cfg.minBodyChars) add('empty_body', 'reject', `the body is ${body.length} characters long (minimum ${cfg.minBodyChars})`, { chars: body.length })

  const bySiblingName = new Map()
  for (const d of siblingDirs) {
    const n = baseName(d)
    bySiblingName.set(n, (bySiblingName.get(n) || []).concat(d))
  }
  const handsTo = unique(allMatches(SKILL_TOOL_RE, body, 1))
  if (handsTo.length > 0) {
    add('delegates', body.length < cfg.shortBodyChars ? 'reject' : 'flag', `hands the work to another skill through the Skill tool: ${handsTo.join(', ')}`, { names: handsTo })
  }
  // A read of a sibling folder is a hard need when its line says so ("PREREQUISITE: read ../x/SKILL.md"), a pointer otherwise ("see also").
  const hardReads = []
  const softReads = []
  for (const line of body.split('\n')) {
    for (const n of unique(allMatches(RELATIVE_RE, line, 1))) {
      if (bySiblingName.has(n)) (NEED_RE.test(line) ? hardReads : softReads).push(n)
    }
  }
  const hard = unique(hardReads)
  const soft = unique(softReads).filter((n) => hard.indexOf(n) < 0)
  if (hard.length > 0) add('needs_sibling', 'reject', `must read the folder of another skill that is not installed with it: ${hard.join(', ')}`, { names: hard })
  if (soft.length > 0) add('sibling_reference', 'flag', `points to the folder of other skill(s) that are not installed with it: ${soft.join(', ')}`, { names: soft })
  const reads = hard.concat(soft)

  const depNames = unique(handsTo.concat(reads)).filter((n) => bySiblingName.get(n) !== undefined && bySiblingName.get(n).length === 1)
  const deps = depNames.map((n) => ({ name: n, path: bySiblingName.get(n)[0] }))

  const mentioned = Array.from(bySiblingName.keys()).filter((n) => n.includes('-') && !depNames.includes(n) && new RegExp('(?<![\\w-])[`"\']' + escapeRe(n) + '[`"\'](?![\\w-])').test(body))
  if (mentioned.length > 0) add('mentions_sibling', 'info', `names other skills of its repository: ${mentioned.slice(0, 5).join(', ')}`, { names: mentioned.slice(0, 5) })

  if (skill.bins.length > 0) add('needs_binary', 'flag', `needs a command-line tool installed on the machine: ${skill.bins.join(', ')}`, { names: skill.bins })

  const mdBytes = Buffer.byteLength(typeof text === 'string' ? text : '')
  if (mdBytes > cfg.maxSkillMdBytes) add('skill_md_big', 'flag', `SKILL.md is ${mdBytes} bytes (above ${cfg.maxSkillMdBytes})`)
  const folderBytes = files.reduce((n, f) => n + (f.size || 0), 0)
  if (folderBytes > cfg.maxFolderBytes) add('folder_big', 'flag', `the folder weighs ${folderBytes} bytes (above ${cfg.maxFolderBytes})`)
  if (files.length > cfg.maxFolderFiles) add('folder_many_files', 'flag', `the folder holds ${files.length} files (above ${cfg.maxFolderFiles})`)

  if (SECRET_RES.some((re) => re.test(typeof text === 'string' ? text : ''))) add('secret_like', 'reject', 'SKILL.md contains something that looks like a key or a token')
  const markers = INJECTION_RES.filter(([re]) => re.test(body)).map(([, why]) => why)
  if (markers.length > 0) add('injection_marker', 'flag', `the text ${markers.join('; ')}`)

  if (/all rights reserved|governed by your agreement with/i.test(licenseText)) {
    add('licence_restricted', 'info', 'its licence file reserves all rights: install it from the source, never copy it into this repository')
  }
  return { findings, deps, bins: skill.bins, name: fields.name || '', description: fields.description || '', bodyChars: body.length }
}

// ── what Discover shows before an install ───────────────────────────────────────────────────────────────────────────────────────────
// Only the rules that need nothing but the SKILL.md and the list of the repository's skills (the size of a folder, a licence file and the
// audits are not known there). `names` come from the skill's own text: plain characters, cut short, to be drawn as text.
const DISCOVER_RULES = ['frontmatter_incomplete', 'empty_body', 'delegates', 'needs_sibling', 'sibling_reference', 'needs_binary', 'secret_like', 'injection_marker']
const cleanNames = (names) => names.slice(0, 5).map((n) => String(n).slice(0, 60))

/**
 * { level: 'ok' | 'warn' | 'bad', findings: [{ rule, level: 'reject' | 'flag', names?, chars? }] }. `siblingDirs`: the other skill folders of the repository.
 * 'bad' = the install would bring nothing usable, or something worse; 'warn' = a person should look first.
 */
export const checkSkillText = (text, siblingDirs = []) => {
  const a = analyseContent({ text, files: [], siblingDirs }, DEFAULT_RULES)
  const findings = a.findings
    .filter((f) => DISCOVER_RULES.indexOf(f.rule) >= 0)
    .map((f) => {
      const out = { rule: f.rule, level: f.level }
      if (f.facts !== undefined && Array.isArray(f.facts.names)) out.names = cleanNames(f.facts.names)
      if (f.facts !== undefined && Number.isInteger(f.facts.chars)) out.chars = f.facts.chars
      return out
    })
  return { level: findings.some((f) => f.level === 'reject') ? 'bad' : findings.length > 0 ? 'warn' : 'ok', findings }
}
