// Skill vetting, the pure half: what a SKILL.md is checked against, how a verdict is reached, when a skill counts as changed.
// No network, no clock, no disk: scripts/vet-skills/pass.mjs feeds this module, scripts/test-vet-skills.mjs pins it.
//
// A finding is { rule, level, message } with level `reject` (would ship a broken or unsafe skill), `flag` (a person looks) or `info`
// (a fact, never blocks). The verdict of a skill is its worst unwaived level: reject, flag, or pass. A waiver is a person's written
// reason to accept one rule for one skill (ledger.json `waivers`); it never hides the finding, it only stops it from counting.
import { createHash } from 'node:crypto'

// Bump when a rule below changes: every skill is analysed again once, on the next pass.
export const RULES_VERSION = 1

export const sha256 = (s) => createHash('sha256').update(s).digest('hex')

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
  [/(?:curl|wget)\b[^\n|]*\|\s*(?:ba|z)?sh\b/i, 'pipes a download into a shell'],
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
  const add = (rule, level, message) => findings.push({ rule, level, message })

  if (!skill.hasHeader || fields.name === undefined || fields.name === '' || fields.description === undefined || fields.description === '') {
    add('frontmatter_incomplete', 'reject', 'SKILL.md has no name or no description in its header: the installer would refuse it')
  }
  if (body.length < cfg.minBodyChars) add('empty_body', 'reject', `the body is ${body.length} characters long (minimum ${cfg.minBodyChars})`)

  const bySiblingName = new Map()
  for (const d of siblingDirs) {
    const n = baseName(d)
    bySiblingName.set(n, (bySiblingName.get(n) || []).concat(d))
  }
  const handsTo = unique(allMatches(SKILL_TOOL_RE, body, 1))
  if (handsTo.length > 0) {
    add('delegates', body.length < cfg.shortBodyChars ? 'reject' : 'flag', `hands the work to another skill through the Skill tool: ${handsTo.join(', ')}`)
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
  if (hard.length > 0) add('needs_sibling', 'reject', `must read the folder of another skill that is not installed with it: ${hard.join(', ')}`)
  if (soft.length > 0) add('sibling_reference', 'flag', `points to the folder of other skill(s) that are not installed with it: ${soft.join(', ')}`)
  const reads = hard.concat(soft)

  const depNames = unique(handsTo.concat(reads)).filter((n) => bySiblingName.get(n) !== undefined && bySiblingName.get(n).length === 1)
  const deps = depNames.map((n) => ({ name: n, path: bySiblingName.get(n)[0] }))

  const mentioned = Array.from(bySiblingName.keys()).filter((n) => n.includes('-') && !depNames.includes(n) && new RegExp('(?<![\\w-])[`"\']' + escapeRe(n) + '[`"\'](?![\\w-])').test(body))
  if (mentioned.length > 0) add('mentions_sibling', 'info', `names other skills of its repository: ${mentioned.slice(0, 5).join(', ')}`)

  if (skill.bins.length > 0) add('needs_binary', 'flag', `needs a command-line tool installed on the machine: ${skill.bins.join(', ')}`)

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

/** Facts that can change with no commit: the repository's state and the security audits. `repo` and `audits` come from sources.mjs. */
export const signalFindings = ({ gone = false, archived = false, license = null, audits = null }) => {
  const findings = []
  const add = (rule, level, message) => findings.push({ rule, level, message })
  if (gone) add('repo_gone', 'reject', 'the source repository no longer exists or is private')
  if (archived) add('repo_archived', 'flag', 'the source repository is archived: nobody will fix it')
  if (!gone && (license === null || license === 'NOASSERTION')) add('licence_unspecified', 'info', 'the repository declares no standard licence')
  if (audits !== null) {
    if (audits.fail > 0) add('audit_fail', 'reject', `a security audit fails: ${audits.failed.join(', ')}`)
    if (audits.warn > 0) add('audit_warn', 'info', `${audits.warn} security audit(s) warn`)
    if (audits.pass + audits.warn + audits.fail === 0) add('audits_missing', 'info', 'no security audit is published for it')
  }
  return findings
}

/**
 * The answer of the judge as findings. The judge can raise a flag; it never rejects a skill by itself: only a person does.
 * `opinions` are the answers it was built from (the first model's, then the second opinion that decided): an alert says whether it was
 * confirmed, and a first alert that the second opinion overruled stays on the record as information, never as a flag.
 */
export const judgeFindings = (judge) => {
  if (judge === null || judge === undefined) return []
  const out = []
  const opinions = Array.isArray(judge.opinions) ? judge.opinions : []
  const why = Array.isArray(judge.reasons) && judge.reasons.length > 0 ? ': ' + judge.reasons.join(' ') : ''
  const how = opinions.length >= 2 ? `, confirmed by ${judge.model}` : ', one opinion only, not confirmed'
  if (judge.verdict === 'reject') out.push({ rule: 'judge_reject', level: 'flag', message: `the judge would reject it${how}${why}` })
  else if (judge.verdict === 'flag') out.push({ rule: 'judge_flag', level: 'flag', message: `the judge has a doubt${how}${why}` })
  else if (opinions.length >= 2 && opinions[0].verdict !== 'ok') {
    const first = opinions[0]
    out.push({ rule: 'judge_overruled', level: 'info', message: `${first.model} said ${first.verdict} (${first.reasons.join(' ')}); ${judge.model} said ok` })
  }
  return out
}

const RANK = { info: 0, flag: 1, reject: 2 }

/** Marks the findings a person waived (`waivers[rule] = { reason }`), keeps them in the list. */
export const applyWaivers = (findings, waivers) => findings.map((f) => (
  waivers !== undefined && waivers !== null && waivers[f.rule] !== undefined && f.level !== 'info'
    ? { ...f, waived: String(waivers[f.rule].reason || 'waived') }
    : f
))

export const verdictOf = (findings) => {
  let worst = 0
  for (const f of findings) if (f.waived === undefined && RANK[f.level] > worst) worst = RANK[f.level]
  return worst === 2 ? 'reject' : worst === 1 ? 'flag' : 'pass'
}

/** One key for "did this skill change": its own folder and the folders it hands over to or reads from. */
export const keyOf = (treeSha, depShas) => sha256([treeSha].concat(depShas.map((d) => d.name + ':' + d.sha).sort()).join('\n')).slice(0, 20)

/** What a skill is in this pass: new, updated (folder or dependency changed, or it moved), rules (the rules changed), forced, unchanged. */
export const statusOf = ({ entry, treeShas, forced, rulesVersion = RULES_VERSION }) => {
  if (entry === undefined || entry === null) return 'new'
  if (forced) return 'forced'
  if (entry.rulesVersion !== rulesVersion) return 'rules'
  if (entry.path === null || entry.key === null || !treeShas.has(entry.path)) return 'updated'
  const deps = (entry.deps || []).map((d) => ({ name: d.name, sha: treeShas.get(d.path) || 'missing' }))
  return keyOf(treeShas.get(entry.path), deps) === entry.key ? 'unchanged' : 'updated'
}

const withoutStamp = (entry) => JSON.stringify({ ...entry, checkedAt: undefined })
/** True when a pass learned nothing about this skill: the old entry is kept as it was, date included, so the ledger does not churn. */
export const sameEntry = (a, b) => a !== undefined && b !== undefined && withoutStamp(a) === withoutStamp(b)

const oneLine = (f) => `${f.rule}${f.waived !== undefined ? ' (waived)' : ''}: ${f.message}`

/** The report: a header line, then one block per skill that is new, changed or not a plain pass. */
export const formatReport = ({ results, removed = [], notes = [], verbose = false, rulesVersion = RULES_VERSION, today = '' }) => {
  const count = (pred) => results.filter(pred).length
  const lines = []
  lines.push(`Skills vetting · ${results.length} skill(s) · rules v${rulesVersion}${today === '' ? '' : ' · ' + today}`)
  lines.push(`  ${['new', 'updated', 'rules', 'forced', 'unchanged', 'unreachable'].map((s) => `${s} ${count((r) => r.status === s)}`).join(' · ')}`)
  lines.push(`  ${['pass', 'flag', 'reject'].map((v) => `${count((r) => r.verdict === v)} ${v}`).join(' · ')}`)
  for (const r of results) {
    const quiet = r.status === 'unchanged' && r.verdict === 'pass'
    if (!verbose && (quiet || (r.verdict === 'pass' && r.status === 'unreachable'))) continue
    const open = r.findings.filter((f) => f.waived === undefined && f.level !== 'info')
    const head = `${r.verdict.toUpperCase().padEnd(6)} ${r.id}  [${r.status}${r.verdictBefore !== undefined && r.verdictBefore !== r.verdict ? `, was ${r.verdictBefore}` : ''}]`
    lines.push(head)
    for (const f of (verbose ? r.findings : open)) lines.push('       ' + oneLine(f))
    if (r.judge !== undefined && r.judge !== null) lines.push(`       judge (${r.judge.model}): ${r.judge.verdict}${r.judge.reasons.length > 0 ? ' — ' + r.judge.reasons.join(' ') : ''}`)
  }
  for (const id of removed) lines.push(`removed from the picks, dropped from the ledger: ${id}`)
  for (const n of notes) lines.push(n)
  return lines.join('\n')
}
