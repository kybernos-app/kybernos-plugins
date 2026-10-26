// Skill vetting, the pure half: what a SKILL.md is checked against, how a verdict is reached, when a skill counts as changed.
// No network, no clock, no disk: scripts/vet-skills/pass.mjs feeds this module, scripts/test-vet-skills.mjs pins it.
//
// A finding is { rule, level, message } with level `reject` (would ship a broken or unsafe skill), `flag` (a person looks) or `info`
// (a fact, never blocks). The verdict of a skill is its worst unwaived level: reject, flag, or pass. A waiver is a person's written
// reason to accept one rule for one skill (ledger.json `waivers`); it never hides the finding, it only stops it from counting.
import { createHash } from 'node:crypto'

import { RULES_VERSION, analyseContent, parseSkill, skillDirs } from '../../packages/kybernos-skills/skill-rules.mjs'

// The rules themselves live in the skills package (Discover uses them too); this tool re-exports them. Bump RULES_VERSION there when a rule changes.
export { RULES_VERSION, analyseContent, parseSkill, skillDirs }

export const sha256 = (s) => createHash('sha256').update(s).digest('hex')

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
