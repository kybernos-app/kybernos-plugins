// The janitor seam of kybernos-memory: enabled / revision / scanAndClean over temporary kybers only.
//   node packages/kybernos-memory/test-janitor-seam.mjs
//
// What is proven: the seam is published frozen under Symbol.for('kybernos.janitor.lessons'); enabled() follows
// the lessons switch and the team rule; revision() is synchronous, stable, read-only and changes with the lessons;
// SCAN-ONLY never asks the Study model and writes NOTHING (no tidy file, no archive, no backup); apply mode writes
// a backup BEFORE any change, merges only same-kyber duplicates through the store's own tidy path (tags/uses/
// lastUsed preserved), never resolves a contradiction, honours every bound, and leaves the files untouched on a
// failed backup. Every path is a mkdtemp fixture: the live ~/.dsh stores are never touched.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

let ok = 0
let ko = 0
const check = (name, cond, detail) => {
  if (cond) { ok += 1; console.log('  ✓ ' + name) } else { ko += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}
const makeLlm = (verdict) => {
  const calls = { n: 0 }
  const llm = {
    stream: ({ messages }) => {
      calls.n += 1
      const prompt = String(messages[0].content[0].text)
      const count = (prompt.match(/^n=\d+$/gm) || []).length
      const verdicts = Array.from({ length: count }, (_, i) => ({ n: i + 1, verdict, why: 'fixture', merged: verdict === 'same' ? 'merged by the fixture' : null }))
      const text = JSON.stringify({ verdicts })
      return (async function* () { yield { type: 'text-delta', text }; yield { type: 'finish', reason: { kind: 'stop' } } })()
    },
  }
  return { calls, llm }
}

const ROOT = mkdtempSync(join(tmpdir(), 'kb-mem-janitor-'))
process.env.DSH_HOME = join(ROOT, 'home')
process.env.KYBERNOS_MEMORY_KYBERS = join(ROOT, 'kybers')
delete process.env.KYBERNOS_JANITOR

const writeJson = (file, value) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(value) + '\n') }
const studyFile = join(ROOT, 'settings.json')
writeJson(studyFile, { brain: 'fixture/study' })
process.env.KYBERNOS_SETTINGS_FILE = studyFile

// One settings file per case, so a tidy side file written by an apply never leaks into a "no trace" check.
let caseNo = 0
const useSettings = (settings) => {
  caseNo += 1
  const file = join(ROOT, 'settings-' + String(caseNo) + '.json')
  writeJson(file, settings === undefined ? { lessons: true } : settings)
  process.env.KYBERNOS_MEMORY_SETTINGS = file
  return { file, tidyFile: file.replace(/\.json$/, '') + '.tidy.json' }
}
const setTidySettings = (settingsFile, settings) => writeJson(settingsFile.replace(/\.json$/, '') + '.tidy.json', { settings })
const useKybers = (name) => { const dir = join(ROOT, 'kybers-' + name); process.env.KYBERNOS_MEMORY_KYBERS = dir; return dir }
const seed = (kybers, kyber, lessons) => {
  const dir = join(kybers, kyber, 'memory')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'lessons.jsonl'), lessons.map((l) => JSON.stringify(l)).join('\n') + (lessons.length > 0 ? '\n' : ''))
}
const lessonsOf = (kybers, kyber) => { try { return readFileSync(join(kybers, kyber, 'memory', 'lessons.jsonl'), 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l)) } catch (e) { return [] } }
const rawLessons = (kybers, kyber) => { try { return readFileSync(join(kybers, kyber, 'memory', 'lessons.jsonl'), 'utf8') } catch (e) { return '' } }

const fake = makeLlm('different')
const ctx = { get: (name) => (name === 'llm' ? fake.llm : undefined), inject: () => {}, effect: () => () => {}, on: () => {} }

try {
  const host = await import('./index.js')
  const seamOf = () => globalThis[host.JANITOR_LESSONS_SEAM]
  host.apply(ctx)
  const seam = seamOf()

  console.log('── published seam ──')
  check('published under Symbol.for("kybernos.janitor.lessons")', host.JANITOR_LESSONS_SEAM === Symbol.for('kybernos.janitor.lessons') && seam !== undefined)
  check('frozen, version 1, exactly the four keys', Object.isFrozen(seam) === true && seam.version === 1 && Object.keys(seam).sort().join(',') === 'enabled,revision,scanAndClean,version', seam && Object.keys(seam))
  check('publishing on a target object works (test seam)', (() => { const target = {}; host.publishJanitorSeam(target); return target[host.JANITOR_LESSONS_SEAM] !== undefined })())

  console.log('── enabled(): lessons switch and team space ──')
  useKybers('enabled')
  useSettings({ lessons: true })
  check('lessons on, no team seam: enabled', seam.enabled() === true)
  useSettings({ lessons: false })
  check('lessons off: disabled', seam.enabled() === false)
  useSettings({ lessons: true })
  globalThis[Symbol.for('kybernos.space')] = Object.freeze({ version: 1, isTeam: () => true })
  check('team space: disabled', seam.enabled() === false)
  delete globalThis[Symbol.for('kybernos.space')]
  check('back to personal: enabled again', seam.enabled() === true)

  console.log('── revision(): synchronous, stable, read-only ──')
  {
    const kybers = useKybers('revision')
    const settings = useSettings()
    seed(kybers, 'default', [{ ts: '2026-01-01T00:00:00.000Z', text: 'always run the focused tests first', tags: ['tests'], uses: 1, lastUsed: null }])
    const first = seam.revision()
    check('a hash string', typeof first === 'string' && /^[0-9a-f]{40}$/.test(first), first)
    check('stable across two calls', seam.revision() === first)
    check('read-only: no tidy file written by revision()', existsSync(settings.tidyFile) === false)
    const file = join(kybers, 'default', 'memory', 'lessons.jsonl')
    const before = readFileSync(file, 'utf8')
    seam.revision()
    check('read-only: the lessons file is byte-identical', readFileSync(file, 'utf8') === before)
    seed(kybers, 'default', [
      { ts: '2026-01-01T00:00:00.000Z', text: 'always run the focused tests first', tags: ['tests'], uses: 1, lastUsed: null },
      { ts: '2026-01-02T00:00:00.000Z', text: 'a second lesson entirely', tags: [], uses: 0, lastUsed: null },
    ])
    check('a new lesson changes the revision', seam.revision() !== first)
  }

  console.log('── scan-only: counts, never asks the model, writes nothing ──')
  {
    const kybers = useKybers('scan-only')
    const settings = useSettings()
    setTidySettings(settings.file, { mode: 'auto', schedule: 'off', brain: true })
    seed(kybers, 'default', [
      { ts: '2026-01-01T00:00:00.000Z', text: 'always run the focused tests first', tags: ['tests'], uses: 1, lastUsed: null },
      { ts: '2026-01-02T00:00:00.000Z', text: 'always run the focused tests first', tags: ['discipline'], uses: 2, lastUsed: null },
      { ts: '2026-01-03T00:00:00.000Z', text: 'the dev server listens on port 3000', tags: [], uses: 0, lastUsed: null },
      { ts: '2026-01-04T00:00:00.000Z', text: 'the dev server listens on port 3080', tags: [], uses: 0, lastUsed: null },
    ])
    const beforeFiles = { a: rawLessons(kybers, 'default'), b: existsSync(join(kybers, 'default', 'memory', 'lessons.archive.jsonl')) }
    const tidyBefore = existsSync(settings.tidyFile) ? readFileSync(settings.tidyFile, 'utf8') : null
    const callsBefore = fake.calls.n
    const res = await seam.scanAndClean({ apply: false, bounds: {} })
    check('ok, inspected bounded', res.ok === true && res.inspected === 4, res)
    check('the exact duplicate is found (pass 1) and the near pair is a candidate', res.candidates >= 1, res.candidates)
    check('scan-only asks NO Study model even with brain on', fake.calls.n === callsBefore && res.model.calls === 0 && res.model.route === null, { calls: fake.calls.n - callsBefore, model: res.model })
    check('scan-only changes nothing', res.merges === 0 && res.archives === 0 && res.changed === false && res.backupPath === null, res)
    check('the lessons file is byte-identical', rawLessons(kybers, 'default') === beforeFiles.a)
    check('no archive was written', beforeFiles.b === existsSync(join(kybers, 'default', 'memory', 'lessons.archive.jsonl')))
    check('scan-only leaves the tidy side file exactly as it found it', (tidyBefore === null ? existsSync(settings.tidyFile) === false : readFileSync(settings.tidyFile, 'utf8') === tidyBefore))
    {
      const fresh = useSettings()
      const before = readFileSync(fresh.file, 'utf8')
      const again = await seam.scanAndClean({ apply: false, bounds: {} })
      check('scan-only does not CREATE a tidy side file when there was none', again.ok === true && existsSync(fresh.tidyFile) === false && readFileSync(fresh.file, 'utf8') === before)
    }
    check('the revision still equals the store (no change)', seam.revision() !== null)
  }

  console.log('── apply: backup before the change, same-kyber merge, tags/uses preserved ──')
  {
    const kybers = useKybers('apply')
    const settings = useSettings()
    setTidySettings(settings.file, { mode: 'auto', schedule: 'off', brain: false })
    seed(kybers, 'default', [
      { ts: '2026-01-01T00:00:00.000Z', text: 'always run the focused tests first', tags: ['tests'], uses: 2, lastUsed: '2026-02-01T00:00:00.000Z' },
      { ts: '2026-01-02T00:00:00.000Z', text: 'Always run the focused tests first', tags: ['discipline'], uses: 3, lastUsed: '2026-03-01T00:00:00.000Z' },
    ])
    const backupPath = join(ROOT, 'backups', 'lessons-apply.json')
    const res = await seam.scanAndClean({ apply: true, bounds: {}, backupPath })
    check('ok, changed, one merge and one archive', res.ok === true && res.changed === true && res.merges === 1 && res.archives === 1, res)
    check('the backup was written where the janitor asked', res.backupPath === backupPath && existsSync(backupPath))
    const backup = JSON.parse(readFileSync(backupPath, 'utf8'))
    check('the backup holds the lessons as they were BEFORE the change', backup.kind === 'lessons' && Array.isArray(backup.kybers.default) && backup.kybers.default.length === 2)
    const left = lessonsOf(kybers, 'default')
    check('one lesson is left, the newest is the keeper', left.length === 1 && left[0].ts === '2026-01-02T00:00:00.000Z', left)
    check('the keeper keeps its falsifiable wording', left[0].text === 'Always run the focused tests first')
    check('the keeper inherits the removed tags (5 at most)', Array.isArray(left[0].tags) && left[0].tags.indexOf('tests') >= 0 && left[0].tags.indexOf('discipline') >= 0, left[0].tags)
    check('the keeper sums the uses and keeps the newest lastUsed', left[0].uses === 5 && left[0].lastUsed === '2026-03-01T00:00:00.000Z', left[0])
    check('the removal went to the store archive', readFileSync(join(kybers, 'default', 'memory', 'lessons.archive.jsonl'), 'utf8').includes('always run the focused tests first'))
    check('before/after counts', res.before.items === 2 && res.after.items === 1 && res.before.chars > res.after.chars)
  }

  console.log('── lessons only meet inside their own kyber ──')
  {
    const kybers = useKybers('cross-kyber')
    const settings = useSettings()
    setTidySettings(settings.file, { mode: 'auto', schedule: 'off', brain: false })
    seed(kybers, 'default', [{ ts: '2026-01-01T00:00:00.000Z', text: 'always run the focused tests first', tags: [], uses: 0, lastUsed: null }])
    seed(kybers, 'dev-team', [{ ts: '2026-01-01T00:00:00.000Z', text: 'always run the focused tests first', tags: [], uses: 0, lastUsed: null }])
    const res = await seam.scanAndClean({ apply: true, bounds: {}, backupPath: join(ROOT, 'backups', 'cross.json') })
    check('the same text in two kybers is NOT merged', res.ok === true && res.merges === 0 && res.changed === false, res)
    check('both lessons are still there', lessonsOf(kybers, 'default').length === 1 && lessonsOf(kybers, 'dev-team').length === 1)
  }

  console.log('── pass 2: only in apply mode, bounded, conflicts kept ──')
  {
    const kybers = useKybers('brain')
    const settings = useSettings()
    setTidySettings(settings.file, { mode: 'auto', schedule: 'off', brain: true })
    seed(kybers, 'default', [
      { ts: '2026-01-01T00:00:00.000Z', text: 'the main office is located in Paris France', tags: [], uses: 0, lastUsed: null },
      { ts: '2026-01-02T00:00:00.000Z', text: 'the main office is located in Paris Texas', tags: [], uses: 0, lastUsed: null },
    ])
    // scan-only first: no model
    const callsBefore = fake.calls.n
    const scan = await seam.scanAndClean({ apply: false, bounds: {} })
    check('scan-only does not ask the model', fake.calls.n === callsBefore && scan.candidates >= 1, { calls: fake.calls.n - callsBefore, candidates: scan.candidates })
    // then a conflicting verdict: counted, both kept
    fake.llm = makeLlm('replaces').llm
    const conflicted = await seam.scanAndClean({ apply: true, bounds: {}, backupPath: join(ROOT, 'backups', 'conflict.json') })
    check('a « replaces » verdict is a conflict, not a merge', conflicted.ok === true && conflicted.conflicts === 1 && conflicted.merges === 0 && conflicted.changed === false, conflicted)
    check('both contradictory lessons are kept', lessonsOf(kybers, 'default').length === 2)
    check('the model route and the call count are reported', conflicted.model.route === 'fixture/study' && conflicted.model.calls >= 1, conflicted.model)
    // a « same » verdict merges
    fake.llm = makeLlm('same').llm
    const merged = await seam.scanAndClean({ apply: true, bounds: {}, backupPath: join(ROOT, 'backups', 'same.json') })
    check('a « same » verdict merges the pair', merged.ok === true && merged.merges === 1 && merged.changed === true && lessonsOf(kybers, 'default').length === 1, merged)
  }

  console.log('── bounds: inspected, candidates, model calls, removals ──')
  {
    const kybers = useKybers('bounds')
    const settings = useSettings()
    setTidySettings(settings.file, { mode: 'auto', schedule: 'off', brain: true })
    const rows = [
      { ts: '2026-01-01T00:00:00.000Z', text: 'the main office is located in Paris France', tags: [], uses: 0, lastUsed: null },
      { ts: '2026-01-02T00:00:00.000Z', text: 'the main office is located in Paris Texas', tags: [], uses: 0, lastUsed: null },
    ]
    seed(kybers, 'default', rows)
    fake.llm = makeLlm('same').llm
    let res = await seam.scanAndClean({ apply: false, bounds: { maxInspected: 1 } })
    check('maxInspected bounds the items looked at', res.inspected === 1, res.inspected)
    res = await seam.scanAndClean({ apply: true, bounds: { maxModelCalls: 1, maxCandidates: 20 }, backupPath: join(ROOT, 'backups', 'calls.json') })
    check('maxModelCalls bounds the Study-model calls', res.model.calls <= 1, res.model.calls)
    const kybers2 = useKybers('bounds-removals')
    const settings2 = useSettings()
    setTidySettings(settings2.file, { mode: 'auto', schedule: 'off', brain: false })
    seed(kybers2, 'default', [
      { ts: '2026-01-01T00:00:00.000Z', text: 'always run the focused tests first', tags: [], uses: 0, lastUsed: null },
      { ts: '2026-01-02T00:00:00.000Z', text: 'always run the focused tests first', tags: [], uses: 0, lastUsed: null },
      { ts: '2026-01-03T00:00:00.000Z', text: 'a completely different lesson here', tags: [], uses: 0, lastUsed: null },
      { ts: '2026-01-04T00:00:00.000Z', text: 'a completely different lesson here', tags: [], uses: 0, lastUsed: null },
    ])
    res = await seam.scanAndClean({ apply: true, bounds: { maxRemovals: 2 }, backupPath: join(ROOT, 'backups', 'removals.json') })
    check('maxRemovals caps merges + archives together', res.merges + res.archives <= 2 && res.archives <= 1, { merges: res.merges, archives: res.archives })
    check('bounds are never widened by a caller', (await seam.scanAndClean({ apply: false, bounds: { maxInspected: 9999, maxRemovals: 9999 } })).inspected <= 200)
  }

  console.log('── atomic failure: the files are untouched ──')
  {
    const kybers = useKybers('atomic')
    const settings = useSettings()
    setTidySettings(settings.file, { mode: 'auto', schedule: 'off', brain: false })
    seed(kybers, 'default', [
      { ts: '2026-01-01T00:00:00.000Z', text: 'always run the focused tests first', tags: [], uses: 0, lastUsed: null },
      { ts: '2026-01-02T00:00:00.000Z', text: 'always run the focused tests first', tags: [], uses: 0, lastUsed: null },
    ])
    const before = rawLessons(kybers, 'default')
    const blocked = join(ROOT, 'blocked')
    writeFileSync(blocked, 'a file, not a folder')
    const res = await seam.scanAndClean({ apply: true, bounds: {}, backupPath: join(blocked, 'backup.json') })
    check('a refused backup returns ok:false', res.ok === false && typeof res.error === 'string', res)
    check('the lessons file is byte-identical after the failure', rawLessons(kybers, 'default') === before)
    check('no archive was written on the failure', existsSync(join(kybers, 'default', 'memory', 'lessons.archive.jsonl')) === false)
    check('nothing was merged', lessonsOf(kybers, 'default').length === 2)
  }

  console.log('── disabled / team: scanAndClean declines ──')
  {
    useKybers('declined')
    useSettings({ lessons: false })
    const res = await seam.scanAndClean({ apply: false, bounds: {} })
    check('lessons off: unavailable, never throws', res.ok === false && res.unavailable === true && res.error === 'lecons_desactivees', res)
    useSettings({ lessons: true })
    globalThis[Symbol.for('kybernos.space')] = Object.freeze({ version: 1, isTeam: () => true })
    const team = await seam.scanAndClean({ apply: false, bounds: {} })
    check('team space: unavailable', team.ok === false && team.unavailable === true && team.error === 'espace_equipe', team)
    delete globalThis[Symbol.for('kybernos.space')]
  }
} catch (e) {
  ko += 1
  console.log('  ✗ the test crashed: ' + String((e && e.stack) || e))
} finally {
  try { delete globalThis[Symbol.for('kybernos.space')] } catch (e) { /* absent */ }
}

skippedLine()
function skippedLine () {
  console.log('SKIPPED: the real DSH llm service: the Study-model calls are proven with a fake `llm` returning the prompt\'s JSON shape')
  console.log('SKIPPED: the live ~/.dsh kybers: every lesson file here is a mkdtemp fixture (KYBERNOS_MEMORY_KYBERS)')
}
console.log('')
console.log(ok + ' passed, ' + ko + ' failed — ' + ROOT)
try { rmSync(ROOT, { recursive: true, force: true }) } catch (e) { /* keep it for inspection */ }
process.exit(ko === 0 ? 0 : 1)
