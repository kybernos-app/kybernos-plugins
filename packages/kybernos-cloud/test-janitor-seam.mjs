// The janitor seam of kybernos-cloud: enabled / revision / scanAndClean against a local fake server.
//   node packages/kybernos-cloud/test-janitor-seam.mjs
//
// What is proven: the seam is published frozen under Symbol.for('kybernos.janitor.memory'); enabled() follows the
// account, the memories switch and the team rule; revision() is synchronous, stable, read-only and makes NO network
// call; SCAN-ONLY never asks the Study model and writes NOTHING (no tidy side file, no backup, no DELETE/PATCH);
// apply mode writes a backup BEFORE any change, merges exact duplicates through the store's own tidy path (pinned
// memory kept, pinned never removed, archive written), keeps contradictions without resolving them, honours every
// bound, and leaves the account untouched when the backup or the deletion path fails. No live ~/.dsh, no real API:
// a local HTTP server stands in for the Kybernos one.

import { createServer } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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

const ROOT = mkdtempSync(join(tmpdir(), 'kb-cloud-janitor-'))
const server = createServer((req, res) => {
  let raw = ''
  req.on('data', (chunk) => { raw += chunk })
  req.on('end', () => {
    const url = new URL(req.url, 'http://fixture')
    seen.push({ method: req.method, path: url.pathname })
    const json = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
    if (req.method === 'GET' && url.pathname === '/v1/memories') {
      const scope = url.searchParams.get('scope') || 'account'
      json(200, { memories: rows.filter((r) => r.scope === scope) })
      return
    }
    if (req.method === 'DELETE' && url.pathname.startsWith('/v1/memories/')) {
      const id = decodeURIComponent(url.pathname.slice('/v1/memories/'.length))
      const at = rows.findIndex((r) => String(r.id) === id)
      if (at >= 0) rows.splice(at, 1)
      json(200, { ok: true })
      return
    }
    if (req.method === 'PATCH' && url.pathname.startsWith('/v1/memories/')) {
      const id = decodeURIComponent(url.pathname.slice('/v1/memories/'.length))
      const at = rows.findIndex((r) => String(r.id) === id)
      if (at >= 0) { const patch = JSON.parse(raw || '{}'); if (typeof patch.content === 'string') rows[at].content = patch.content }
      json(200, { ok: true })
      return
    }
    json(404, { error: 'not_found' })
  })
})
const rows = []
const seen = []
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const apiUrl = 'http://127.0.0.1:' + String(server.address().port)

process.env.HOME = join(ROOT, 'home')
process.env.KYBERNOS_CLOUD_API = apiUrl
process.env.DSH_HOME = join(ROOT, 'home', '.dsh')
delete process.env.KYBERNOS_SERVERS_FILE
delete process.env.KYBERNOS_JANITOR

const writeJson = (file, value) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(value) + '\n') }
let caseNo = 0
const useCases = (options = {}) => {
  caseNo += 1
  const stateFile = join(ROOT, 'cloud-' + String(caseNo) + '.json')
  process.env.KYBERNOS_CLOUD_STATE = stateFile
  seen.length = 0
  rows.splice(0, rows.length)
  const connected = options.connected !== false
  const team = options.team === true
  const workspace = team ? { id: 't1', personal: false, name: 'Team' } : { id: 'w1', personal: true, name: 'My workspace' }
  writeJson(stateFile, {
    ...(connected ? { token: 'kyd_' + 's'.repeat(40), api: apiUrl } : {}),
    workspaces: [workspace],
    active_workspace_id: workspace.id,
  })
  writeJson(stateFile.replace(/\.json$/, '') + '-memory.json', { memories: options.memories !== false })
  const tidyFile = stateFile.replace(/\.json$/, '') + '-tidy.json'
  writeJson(tidyFile, { settings: { mode: 'auto', schedule: 'off', brain: options.brain === true }, scan: null, dismissed: [], log: [], last: null, judged: {} })
  return { stateFile, tidyFile, memorySettingsFile: stateFile.replace(/\.json$/, '') + '-memory.json' }
}
const setRows = (list) => {
  rows.splice(0, rows.length, ...list.map((row) => ({
    id: row.id, scope: 'account', kind: row.kind === undefined ? 'fact' : row.kind,
    content: row.content, pinned: row.pinned === true, source: 'conversation', retention_days: 180,
    created_at: row.createdAt === undefined ? '2026-01-01T00:00:00.000Z' : row.createdAt,
  })))
}
const deleteCalls = () => seen.filter((s) => s.method === 'DELETE' && s.path.startsWith('/v1/memories/'))

const fake = makeLlm('different')
const ctx = {
  get: (name) => (name === 'llm' ? fake.llm : undefined),
  inject: () => {},
  effect: () => () => {},
  on: () => {},
}

try {
  writeJson(join(ROOT, 'settings.json'), { brain: 'fixture/study' })
  process.env.KYBERNOS_SETTINGS_FILE = join(ROOT, 'settings.json')
  const host = await import('./index.js')
  host.apply(ctx)
  const seam = globalThis[host.JANITOR_MEMORY_SEAM]

  console.log('── published seam ──')
  check('published under Symbol.for("kybernos.janitor.memory")', host.JANITOR_MEMORY_SEAM === Symbol.for('kybernos.janitor.memory') && seam !== undefined)
  check('frozen, version 1, exactly the four keys', Object.isFrozen(seam) === true && seam.version === 1 && Object.keys(seam).sort().join(',') === 'enabled,revision,scanAndClean,version', seam && Object.keys(seam))
  check('publishing on a target object works (test seam)', (() => { const target = {}; host.publishJanitorSeam(target); return target[host.JANITOR_MEMORY_SEAM] !== undefined })())

  console.log('── enabled(): account + memories switch + team rule ──')
  useCases()
  check('connected, memories on, personal space: enabled', seam.enabled() === true)
  useCases({ memories: false })
  check('memories off: disabled', seam.enabled() === false)
  useCases({ connected: false })
  check('no account: disabled', seam.enabled() === false)
  useCases({ team: true })
  check('team space: disabled', seam.enabled() === false)
  useCases()
  check('back to a personal space: enabled again', seam.enabled() === true)

  console.log('── revision(): synchronous, stable, no network ──')
  {
    const cases = useCases()
    setRows([
      { id: 'r1', content: 'the office is in Paris' },
      { id: 'r2', content: 'deadlines are on Fridays' },
    ])
    const scan = await seam.scanAndClean({ apply: false, bounds: {} })
    check('a scan-only run reads the rows', scan.ok === true && scan.inspected === 2, scan)
    const first = seam.revision()
    check('a hash string', typeof first === 'string' && /^[0-9a-f]{40}$/.test(first), first)
    const requestsBefore = seen.length
    check('stable across two calls', seam.revision() === first)
    check('revision() made NO network call', seen.length === requestsBefore, seen.length - requestsBefore)
    check('revision() wrote no tidy side file', readFileSync(cases.tidyFile, 'utf8').includes('"scan":null'))
    setRows([
      { id: 'r1', content: 'the office is in Paris' },
      { id: 'r2', content: 'deadlines are on Fridays' },
      { id: 'r3', content: 'a new memory entirely' },
    ])
    await seam.scanAndClean({ apply: false, bounds: {} })
    check('a new memory changes the revision', seam.revision() !== first)
  }

  console.log('── scan-only: counts, never asks the model, writes nothing ──')
  {
    const cases = useCases({ brain: true })
    setRows([
      { id: 's1', content: 'the office is in Paris', pinned: true },
      { id: 's2', content: 'The office is in Paris', pinned: false },
      { id: 's3', content: 'the dev server listens on port 3000' },
      { id: 's4', content: 'the dev server listens on port 3080' },
    ])
    const tidyBefore = readFileSync(cases.tidyFile, 'utf8')
    const settingsBefore = readFileSync(cases.memorySettingsFile, 'utf8')
    const callsBefore = fake.calls.n
    const res = await seam.scanAndClean({ apply: false, bounds: {} })
    check('ok, inspected all rows', res.ok === true && res.inspected === 4, res)
    check('the near pair is a candidate (pass 1 output)', res.candidates >= 1, res.candidates)
    check('a deterministic clash (different numbers) is COUNTED as a conflict, not merged', res.conflicts >= 1 && res.merges === 0, { conflicts: res.conflicts, merges: res.merges })
    check('scan-only asks NO Study model even with brain on', fake.calls.n === callsBefore && res.model.calls === 0 && res.model.route === null, { calls: fake.calls.n - callsBefore, model: res.model })
    check('scan-only changes nothing on the account', res.merges === 0 && res.archives === 0 && res.changed === false && res.backupPath === null && rows.length === 4 && deleteCalls().length === 0, res)
    check('no DELETE / PATCH was sent', seen.filter((s) => s.method === 'DELETE' || s.method === 'PATCH').length === 0)
    check('the tidy side file is byte-identical', readFileSync(cases.tidyFile, 'utf8') === tidyBefore)
    check('the memory settings file is byte-identical', readFileSync(cases.memorySettingsFile, 'utf8') === settingsBefore)
    check('no backup file was written', existsSync(join(ROOT, 'backups')) === false || readFileSyncList(join(ROOT, 'backups')).length === 0)
  }

  console.log('── apply: backup first, pinned kept, archive before deletion ──')
  {
    useCases()
    setRows([
      { id: 'p1', content: 'never share the client list', pinned: true },
      { id: 'p2', content: 'never share the client list', pinned: false },
      { id: 'p3', content: 'a different memory entirely' },
    ])
    const backupPath = join(ROOT, 'backups', 'memory-apply.json')
    const res = await seam.scanAndClean({ apply: true, bounds: {}, backupPath })
    check('ok, changed, one merge and one archive', res.ok === true && res.changed === true && res.merges === 1 && res.archives === 1, res)
    check('the backup was written where the janitor asked', res.backupPath === backupPath && existsSync(backupPath))
    const backup = JSON.parse(readFileSync(backupPath, 'utf8'))
    check('the backup holds the rows as they were BEFORE the change', backup.kind === 'memory' && Array.isArray(backup.rows) && backup.rows.length === 3 && backup.rows.some((r) => r.id === 'p2'))
    check('the pinned memory is kept, the non-pinned duplicate deleted', rows.some((r) => r.id === 'p1') && !rows.some((r) => r.id === 'p2'))
    check('exactly one DELETE for the removed row', deleteCalls().length === 1 && deleteCalls()[0].path === '/v1/memories/p2', deleteCalls())
    const tidy = JSON.parse(readFileSync(join(ROOT, 'cloud-' + String(caseNo) + '-tidy.json'), 'utf8'))
    check('the store archive has the removed row (Undo)', tidy.log.length === 1 && JSON.parse(readFileSync(join(ROOT, 'cloud-' + String(caseNo) + '-tidy-archive.json'), 'utf8')).runs[tidy.log[0].id].removed.length === 1)
    check('before/after counts', res.before.items === 3 && res.after.items === 2)
    check('the revision changed after the merge', seam.revision() !== null)
  }

  console.log('── contradictions: counted, both kept ──')
  {
    useCases({ brain: true })
    setRows([
      { id: 'c1', content: 'the main office is located in Paris France' },
      { id: 'c2', content: 'the main office is located in Paris Texas' },
    ])
    fake.llm = makeLlm('replaces').llm
    const res = await seam.scanAndClean({ apply: true, bounds: {}, backupPath: join(ROOT, 'backups', 'conflict.json') })
    check('a « replaces » verdict is a conflict, not a merge', res.ok === true && res.conflicts === 1 && res.merges === 0 && res.changed === false, res)
    check('both contradictory memories are kept', rows.length === 2 && deleteCalls().length === 0)
    check('the model route and the call count are reported', res.model.route === 'fixture/study' && res.model.calls >= 1, res.model)
  }

  console.log('── pass 2 applies a high-confidence « same » ──')
  {
    useCases({ brain: true })
    setRows([
      { id: 'm1', content: 'the main office is located in Paris France' },
      { id: 'm2', content: 'the main office is located in Paris Texas' },
    ])
    fake.llm = makeLlm('same').llm
    const res = await seam.scanAndClean({ apply: true, bounds: {}, backupPath: join(ROOT, 'backups', 'same.json') })
    check('the semantic duplicate is merged', res.ok === true && res.merges === 1 && res.changed === true && rows.length === 1, res)
    check('one DELETE was sent', deleteCalls().length === 1)
  }

  console.log('── bounds ──')
  {
    useCases()
    const many = []
    for (let i = 0; i < 4; i += 1) { many.push({ id: 'g' + String(i) + 'a', content: 'duplicate fact number ' + String(i) }); many.push({ id: 'g' + String(i) + 'b', content: 'duplicate fact number ' + String(i) }) }
    setRows(many)
    let res = await seam.scanAndClean({ apply: false, bounds: { maxInspected: 3 } })
    check('maxInspected bounds the items looked at', res.inspected === 3, res.inspected)
    res = await seam.scanAndClean({ apply: true, bounds: { maxRemovals: 3 }, backupPath: join(ROOT, 'backups', 'bounds.json') })
    check('maxRemovals caps merges + archives together', res.merges + res.archives <= 3, { merges: res.merges, archives: res.archives })
    check('a caller cannot widen the bounds', (await seam.scanAndClean({ apply: false, bounds: { maxInspected: 9999 } })).inspected <= 200)
  }

  console.log('── atomic failure: the account is untouched ──')
  {
    useCases()
    setRows([
      { id: 'f1', content: 'never share the client list' },
      { id: 'f2', content: 'never share the client list' },
    ])
    const blocked = join(ROOT, 'blocked')
    writeFileSync(blocked, 'a file, not a folder')
    const res = await seam.scanAndClean({ apply: true, bounds: {}, backupPath: join(blocked, 'backup.json') })
    check('a refused backup returns ok:false', res.ok === false && typeof res.error === 'string', res)
    check('no DELETE was sent', deleteCalls().length === 0)
    check('the account rows are untouched', rows.length === 2)
  }

  console.log('── a server refusal is reported, never thrown ──')
  {
    useCases()
    setRows([{ id: 'n1', content: 'never share the client list' }, { id: 'n2', content: 'never share the client list' }])
    // Point the active server at a closed port: every call fails with a network error.
    const savedApi = process.env.KYBERNOS_CLOUD_API
    process.env.KYBERNOS_CLOUD_API = 'http://127.0.0.1:1'
    let res = null
    let threw = null
    try { res = await seam.scanAndClean({ apply: false, bounds: {} }) } catch (e) { threw = e } finally { process.env.KYBERNOS_CLOUD_API = savedApi }
    check('an unreachable server gives ok:false, never a throw', threw === null && res !== null && res.ok === false && (res.unavailable === true || typeof res.error === 'string'), { threw: threw && String(threw.message), res })
  }

  console.log('── disabled / team: scanAndClean declines ──')
  {
    useCases({ memories: false })
    let res = await seam.scanAndClean({ apply: false, bounds: {} })
    check('memories off: unavailable', res.ok === false && res.unavailable === true && res.error === 'memoires_desactivees', res)
    useCases({ team: true })
    res = await seam.scanAndClean({ apply: false, bounds: {} })
    check('team space: unavailable', res.ok === false && res.unavailable === true && res.error === 'espace_equipe', res)
  }
} catch (e) {
  ko += 1
  console.log('  ✗ the test crashed: ' + String((e && e.stack) || e))
} finally {
  try { server.close() } catch (e) { /* closed */ }
}

function readFileSyncList (dir) { try { return readdirSync(dir) } catch (e) { return [] } }

console.log('SKIPPED: the real Kybernos API: a local HTTP server stands in for it, exactly as test-cloud-seam.mjs does')
console.log('SKIPPED: the real DSH llm service: Study-model calls are proven with a fake `llm` returning the prompt\'s JSON shape')
console.log('SKIPPED: the live ~/.dsh account state: every state file here is a mkdtemp fixture (KYBERNOS_CLOUD_STATE)')
console.log('')
console.log(ok + ' passed, ' + ko + ' failed — ' + ROOT)
try { rmSync(ROOT, { recursive: true, force: true }) } catch (e) { /* keep it for inspection */ }
process.exit(ko === 0 ? 0 : 1)
