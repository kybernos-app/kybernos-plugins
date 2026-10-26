// Skill vetting, one pass: reads the state of every source repository, compares it with the ledger, and analyses ONLY what changed.
//
//   unchanged  the folder (and the folders it hands over to) has the same git tree hash as when it was analysed: nothing is downloaded,
//              only the facts that move without a commit (archived, audits) are read again;
//   new        not in the ledger yet;
//   updated    its folder or a dependency changed, or it moved;
//   rules      the rules changed (RULES_VERSION): analysed once more;
//   forced     --all.
//
// The sources (GitHub, the audit relay) and the judge are injected: the tests run the whole pass on fakes. A RateLimited error from GitHub
// leaves the pass unfinished and the ledger untouched: nothing is written from half a picture.
import { PROMPT_VERSION } from './judge.mjs'
import { RULES_VERSION, analyseContent, applyWaivers, judgeFindings, keyOf, parseSkill, sameEntry, signalFindings, skillDirs, statusOf, verdictOf } from './core.mjs'

export const emptyLedger = () => ({ version: 1, rulesVersion: RULES_VERSION, lastPassAt: null, skills: {}, waivers: {}, calibration: {} })

const unique = (list) => Array.from(new Set(list))
// What the card already tells the person the skill needs (featured-picks.json `needs`): the judge must not count it as a defect.
const NEEDS_TEXT = { firecrawl: 'an account and an API key for Firecrawl', tavily: 'an account and an API key for Tavily', google: 'a Google account and the gws command-line tool signed in to it' }
const declaredOf = (pick) => (typeof pick.needs === 'string' && NEEDS_TEXT[pick.needs] !== undefined ? [NEEDS_TEXT[pick.needs]] : [])
const LICENCE_FILE_RE = /^licen[cs]e(\.[a-z]+)?$/i

const loadRepo = async (github, source) => {
  const repo = await github.repo(source)
  if (repo.status === 404) return { gone: true }
  if (repo.status !== 200) return { unreachable: `repository facts: HTTP ${repo.status || 'no answer'}` }
  const commit = await github.commit(source)
  if (commit === null) return { unreachable: 'could not read the latest commit' }
  const tree = await github.tree(source, commit)
  if (tree.status !== 200) return { unreachable: `tree: HTTP ${tree.status || 'no answer'}` }
  if (tree.truncated) return { unreachable: 'the tree is too large to read in one request' }
  const treeShas = new Map([['', tree.sha]])
  for (const e of tree.entries) if (e.type === 'tree') treeShas.set(e.path, e.sha)
  return { repo, commit, entries: tree.entries, treeShas, dirs: skillDirs(tree.entries) }
}

// The installer finds a skill by the `name` in its header (not by its folder name) and refuses an ambiguous one: so do we.
const resolveSkill = async ({ github, source, commit, dirs, id, cfg }) => {
  const read = async (dir) => {
    const text = await github.raw(source, commit, dir === '' ? 'SKILL.md' : dir + '/SKILL.md')
    return text === null ? null : { dir, text, parsed: parseSkill(text) }
  }
  const good = (r) => r !== null && r.parsed.fields.name === id && typeof r.parsed.fields.description === 'string' && r.parsed.fields.description !== ''
  const byFolder = dirs.filter((d) => d !== '' && d.split('/').pop() === id).slice(0, 4)
  const found = []
  for (const d of byFolder) { const r = await read(d); if (good(r)) found.push(r) }
  let scanned = 0
  const rest = dirs.filter((d) => byFolder.indexOf(d) < 0)
  if (found.length === 0) {
    for (const d of rest.slice(0, cfg.maxFrontmatterScan)) { scanned += 1; const r = await read(d); if (good(r)) found.push(r) }
  }
  if (found.length === 1) return { status: 'ok', dir: found[0].dir, text: found[0].text }
  if (found.length > 1) return { status: 'ambiguous', count: found.length }
  return { status: 'not_found', scanned, total: rest.length }
}

const folderFiles = (entries, dir) => {
  const prefix = dir === '' ? '' : dir + '/'
  return entries.filter((e) => e.type === 'blob' && e.path.startsWith(prefix)).map((e) => ({ path: e.path.slice(prefix.length), size: e.size }))
}

/**
 * picks: [{ id, source, title: { en }, outcome: { en } }]. opts: { all, only: [ids], judge, noAudits }.
 * Returns { ledger, results, removed, notes }; the caller decides whether to write the ledger.
 */
export const runPass = async ({ picks, ledger, config, github, relay = null, judge = null, opts = {}, now = () => new Date().toISOString() }) => {
  const next = { ...ledger, skills: { ...ledger.skills } }
  const only = Array.isArray(opts.only) && opts.only.length > 0 ? new Set(opts.only) : null
  const selected = picks.filter((p) => only === null || only.has(p.id))
  const results = []
  const notes = []

  const repos = new Map()
  for (const source of unique(selected.map((p) => p.source))) repos.set(source, await loadRepo(github, source))

  for (const pick of selected) {
    const old = ledger.skills[pick.id]
    const state = repos.get(pick.source)
    if (state.unreachable !== undefined) {
      results.push({ id: pick.id, status: 'unreachable', verdict: old === undefined ? 'unknown' : old.verdict, findings: old === undefined ? [] : old.findings, judge: null })
      notes.push(`could not check ${pick.source} (${state.unreachable}): its skills keep their last result`)
      continue
    }

    const treeShas = state.gone === true ? new Map() : state.treeShas
    const status = state.gone === true ? (old === undefined ? 'new' : 'unchanged') : statusOf({ entry: old, treeShas, forced: opts.all === true })

    // ── content: only when the folder is new or changed ─────────────────────────────────────────
    let content
    let text = null
    let files = []
    if (status === 'unchanged') {
      content = { path: old.path, treeSha: old.treeSha, deps: old.deps, key: old.key, commit: old.commit, bins: old.bins, contentFindings: old.contentFindings, rulesVersion: old.rulesVersion }
    } else if (state.gone === true) {
      content = { path: null, treeSha: null, deps: [], key: null, commit: null, bins: [], contentFindings: [], rulesVersion: RULES_VERSION }
    } else {
      const res = await resolveSkill({ github, source: pick.source, commit: state.commit, dirs: state.dirs, id: pick.id, cfg: config })
      if (res.status !== 'ok') {
        const message = res.status === 'ambiguous'
          ? `${res.count} folders of ${pick.source} carry this name: the installer refuses an ambiguous skill`
          : `no folder of ${pick.source} has a SKILL.md named "${pick.id}" (looked in the folder of that name, then in ${res.scanned} of ${res.total} others)`
        content = { path: old === undefined ? null : old.path, treeSha: null, deps: [], key: null, commit: state.commit, bins: [], contentFindings: [{ rule: res.status === 'ambiguous' ? 'repo_ambiguous' : 'skill_not_found', level: 'reject', message }], rulesVersion: RULES_VERSION }
      } else {
        text = res.text
        files = folderFiles(state.entries, res.dir)
        const licence = files.find((f) => LICENCE_FILE_RE.test(f.path))
        const prefix = res.dir === '' ? '' : res.dir + '/'
        const licenseText = licence === undefined ? '' : (await github.raw(pick.source, state.commit, prefix + licence.path, 4000)) || ''
        const siblingDirs = state.dirs.filter((d) => d !== res.dir && (prefix === '' || !d.startsWith(prefix)))
        const a = analyseContent({ text, files, siblingDirs, licenseText }, config)
        const depShas = a.deps.map((d) => ({ name: d.name, sha: treeShas.get(d.path) || 'missing' }))
        content = { path: res.dir, treeSha: treeShas.get(res.dir), deps: a.deps, key: keyOf(treeShas.get(res.dir), depShas), commit: state.commit, bins: a.bins, contentFindings: a.findings, rulesVersion: RULES_VERSION, description: a.description }
      }
    }

    // ── signals: read again every pass, they move without a commit ─────────────────────────────
    const prev = old === undefined ? null : old.signals
    let audits = prev === null ? null : prev.audits
    if (relay !== null && opts.noAudits !== true && state.gone !== true) {
      const a = await relay.audits(pick.source, pick.id)
      if (a.ok) audits = a.audits
    }
    const signals = state.gone === true
      ? { gone: true, archived: prev === null ? false : prev.archived, license: prev === null ? null : prev.license, audits }
      : { gone: false, archived: state.repo.archived, license: state.repo.license, audits }

    // ── the judge: only on a skill that passed the code, and only when its text has no verdict yet ──
    const waivers = (ledger.waivers || {})[pick.id]
    let judged = old === undefined ? null : old.judge
    if (judged !== null && judged !== undefined && (judged.key !== content.key || judged.promptVersion !== PROMPT_VERSION)) judged = null
    if (judged === undefined) judged = null
    const codeVerdict = verdictOf(applyWaivers(content.contentFindings.concat(signalFindings(signals)), waivers))
    let judgeError = null
    const cachedOk = judged !== null && (judge === null || (judge.chain().indexOf(judged.model) >= 0 && !judge.wantsSecondOpinion(judged)))
    if (judge !== null && opts.judge === true && codeVerdict !== 'reject' && content.key !== null && state.gone !== true && !cachedOk) {
      const skillText = text !== null ? text : await github.raw(pick.source, state.commit, (content.path === '' ? '' : content.path + '/') + 'SKILL.md')
      if (skillText === null) judgeError = 'could not read SKILL.md'
      else {
        const list = (files.length > 0 ? files : folderFiles(state.entries, content.path)).map((f) => f.path)
        const outcome = typeof pick.outcome === 'object' && pick.outcome !== null && pick.outcome.en ? pick.outcome.en : (content.description || old && old.description || '')
        const r = await judge.review({ card: { title: pick.title && pick.title.en ? pick.title.en : pick.id, outcome }, files: list, bins: content.bins, declared: declaredOf(pick), text: skillText })
        if (r.ok) judged = { model: r.model, promptVersion: PROMPT_VERSION, key: content.key, at: now(), verdict: r.answer.verdict, selfSufficient: r.answer.selfSufficient, deliversOutcome: r.answer.deliversOutcome, delegates: r.answer.delegates, injectionSuspected: r.answer.injectionSuspected, reasons: r.answer.reasons, opinions: r.opinions }
        else judgeError = r.error === 'no_calibrated_model' ? 'no model has passed the calibration (run --calibrate)' : `${r.error}${r.detail ? ' (' + r.detail.join('; ') + ')' : ''}`
      }
    }

    const findings = applyWaivers(content.contentFindings.concat(signalFindings(signals), judgeFindings(judged)), waivers)
    const verdict = verdictOf(findings)
    let entry = {
      source: pick.source,
      path: content.path,
      commit: content.commit,
      treeSha: content.treeSha,
      deps: content.deps,
      key: content.key,
      rulesVersion: content.rulesVersion,
      checkedAt: now(),
      bins: content.bins,
      contentFindings: content.contentFindings,
      signals,
      judge: judged,
      verdict,
      findings
    }
    if (content.description !== undefined) entry.description = content.description
    else if (old !== undefined && old.description !== undefined) entry.description = old.description
    if (sameEntry(old, entry)) entry = old
    next.skills[pick.id] = entry
    results.push({ id: pick.id, status, verdict, verdictBefore: old === undefined ? undefined : old.verdict, findings, judge: judged, judgeError })
  }

  const removed = []
  if (only === null) {
    const ids = new Set(picks.map((p) => p.id))
    for (const id of Object.keys(next.skills)) if (!ids.has(id)) { removed.push(id); delete next.skills[id] }
  }
  if (relay !== null && relay.stopped !== null && opts.noAudits !== true) notes.push(`audits not refreshed: the relay answered ${relay.stopped === 0 ? 'nothing' : 'HTTP ' + relay.stopped} (stopped at the first refusal)`)
  const failures = results.filter((r) => r.judgeError !== null && r.judgeError !== undefined)
  if (failures.length > 0) notes.push(`judge failed on ${failures.length} skill(s): ${failures[0].id} — ${failures[0].judgeError}`)
  if (judge !== null && opts.judge === true) notes.push(`judge: ${judge.calls} call(s) this run`)
  next.rulesVersion = RULES_VERSION
  next.lastPassAt = now()
  return { ledger: next, results, removed, notes }
}
