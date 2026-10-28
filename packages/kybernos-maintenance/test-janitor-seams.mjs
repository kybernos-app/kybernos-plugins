// The janitor over the REAL store seams (kybernos-cloud + kybernos-memory), with fixture stores only.
//   node packages/kybernos-maintenance/test-janitor-seams.mjs
//
// What is proven end to end: createJanitor() with NO injected store port finds both published seams on the global
// symbol registry and writes ONE bounded report line per run; the first run is scan-only (nothing changes, no
// backup, no notification, no Study-model call); a second run is skipped as not due (dirty-only + five hours); when
// the stores change and the apply gate is open (KYBERNOS_JANITOR=apply), the run writes a timestamped backup per
// store BEFORE the change, merges through the stores' own tidy paths, and emits exactly one change notification;
// once cleaned, the unchanged revisions make the next run silent. The account is a local HTTP server, the lessons
// are mkdtemp files, the janitor lives under a mkdtemp directory: the live ~/.dsh is never touched.

import { createServer } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

let ok = 0
let ko = 0
const check = (name, cond, detail) => {
  if (cond) { ok += 1; console.log('  ✓ ' + name) } else { ko += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const ROOT = mkdtempSync(join(tmpdir(), 'kb-janitor-seams-'))
const HOUR = 3600 * 1000
const clock = { t: Date.now() }
const now = () => clock.t
const isoAgo = (ms) => new Date(clock.t - ms).toISOString()

// ── a local account server (the memories the janitor will inspect) ─────────
const rows = []
const seen = []
const server = createServer((req, res) => {
  let raw = ''
  req.on('data', (chunk) => { raw += chunk })
  req.on('end', () => {
    const url = new URL(req.url, 'http://fixture')
    seen.push({ method: req.method, path: url.pathname })
    const json = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
    if (req.method === 'GET' && url.pathname === '/v1/memories') { json(200, { memories: rows }); return }
    if (req.method === 'DELETE' && url.pathname.startsWith('/v1/memories/')) {
      const id = decodeURIComponent(url.pathname.slice('/v1/memories/'.length))
      const at = rows.findIndex((r) => String(r.id) === id)
      if (at >= 0) rows.splice(at, 1)
      json(200, { ok: true })
      return
    }
    json(404, { error: 'not_found' })
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const apiUrl = 'http://127.0.0.1:' + String(server.address().port)

// ── the fixture environment, set BEFORE the bundles are imported ───────────
const HOME = join(ROOT, 'home')
const KYBERS = join(ROOT, 'kybers')
const CLOUD_STATE = join(ROOT, 'cloud.json')
const MEMORY_SETTINGS = join(ROOT, 'kybernos-memory.json')
const STUDY_SETTINGS = join(ROOT, 'settings.json')
const JANITOR_DIR = join(ROOT, 'janitor')
process.env.HOME = HOME
process.env.DSH_HOME = join(HOME, '.dsh')
process.env.KYBERNOS_CLOUD_API = apiUrl
process.env.KYBERNOS_CLOUD_STATE = CLOUD_STATE
process.env.KYBERNOS_MEMORY_KYBERS = KYBERS
process.env.KYBERNOS_MEMORY_SETTINGS = MEMORY_SETTINGS
process.env.KYBERNOS_SETTINGS_FILE = STUDY_SETTINGS
process.env.KYBERNOS_JANITOR_DIR = JANITOR_DIR
delete process.env.KYBERNOS_SERVERS_FILE
delete process.env.KYBERNOS_JANITOR

const writeJson = (file, value) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(value) + '\n') }
writeJson(CLOUD_STATE, {
  token: 'kyd_' + 's'.repeat(40),
  api: apiUrl,
  workspaces: [{ id: 'w1', personal: true, name: 'My workspace' }],
  active_workspace_id: 'w1',
})
writeJson(CLOUD_STATE.replace(/\.json$/, '') + '-memory.json', { memories: true })
writeJson(CLOUD_STATE.replace(/\.json$/, '') + '-tidy.json', { settings: { mode: 'auto', schedule: 'off', brain: false }, scan: null, dismissed: [], log: [], last: null, judged: {} })
writeJson(MEMORY_SETTINGS, { lessons: true })
writeJson(MEMORY_SETTINGS.replace(/\.json$/, '') + '.tidy.json', { settings: { mode: 'auto', schedule: 'off', brain: false }, scan: null, dismissed: [], log: [], last: null, judged: {} })
writeJson(STUDY_SETTINGS, { brain: 'none' })   // no Study model: pass 2 stays out of the way

const seedLessons = (kyber, lessons) => {
  const dir = join(KYBERS, kyber, 'memory')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'lessons.jsonl'), lessons.map((l) => JSON.stringify(l)).join('\n') + '\n')
}
const lessonsOf = (kyber) => { try { return readFileSync(join(KYBERS, kyber, 'memory', 'lessons.jsonl'), 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l)) } catch (e) { return [] } }
const setRows = (list) => {
  rows.splice(0, rows.length, ...list.map((row) => ({
    id: row.id, scope: 'account', kind: row.kind === undefined ? 'fact' : row.kind, content: row.content,
    pinned: row.pinned === true, source: 'conversation', retention_days: 180, created_at: row.createdAt === undefined ? '2026-01-01T00:00:00.000Z' : row.createdAt,
  })))
}
const reportLines = (file) => { try { return readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l)) } catch (e) { return [] } }

try {
  // ── the two real seams, published by their own bundles ────────────────────
  const fakeCtx = { get: () => undefined, inject: () => {}, effect: () => () => {}, on: () => {} }
  const cloud = await import('../kybernos-cloud/index.js')
  const memory = await import('../kybernos-memory/index.js')
  cloud.apply(fakeCtx)
  memory.apply(fakeCtx)
  const janitorModule = await import('./janitor.mjs')
  const { createJanitor, JANITOR } = janitorModule

  console.log('── the janitor finds both real seams ──')
  const notices = []
  const makeJanitor = (env) => createJanitor({
    dir: JANITOR_DIR,
    env: env === undefined ? {} : env,
    ports: { now, notify: (notice) => notices.push(notice) },
  })
  const janitor = makeJanitor()
  check('the memory seam is found and available', janitor.ports.memory.available === true)
  check('the lessons seam is found and available', janitor.ports.lessons.available === true)
  check('scan-only is the gate by default', janitor.status().apply === false)

  // ── first run: dirty stores, scan-only ────────────────────────────────────
  console.log('── first run (scan-only): both stores inspected, nothing written ──')
  setRows([
    { id: 'm1', content: 'the main office address is Paris France', pinned: true },
    { id: 'm2', content: 'the main office address is Paris France', pinned: false },
    { id: 'm3', content: 'deadlines are on Fridays' },
  ])
  seedLessons('default', [
    { ts: '2026-01-01T00:00:00.000Z', text: 'always run the focused tests first', tags: ['tests'], uses: 1, lastUsed: null },
    { ts: '2026-01-02T00:00:00.000Z', text: 'always run the focused tests first', tags: ['discipline'], uses: 2, lastUsed: null },
  ])
  const lessonsBefore = readFileSync(join(KYBERS, 'default', 'memory', 'lessons.jsonl'), 'utf8')
  const deletesBefore = seen.filter((s) => s.method === 'DELETE').length
  const first = await janitor.run()
  check('status dirty (both stores had changed)', first.status === 'dirty', { status: first.status, reason: first.reason })
  check('both stores are named as dirty', first.dirtyStores.slice().sort().join(',') === 'lessons,memory', first.dirtyStores)
  check('nothing was applied, no backup, no model call', first.merges === 0 && first.archives === 0 && first.backupPath === null && first.model.calls === 0 && first.model.route === null, first)
  check('the account rows are untouched', rows.length === 3 && seen.filter((s) => s.method === 'DELETE').length === deletesBefore)
  check('the lessons file is byte-identical', readFileSync(join(KYBERS, 'default', 'memory', 'lessons.jsonl'), 'utf8') === lessonsBefore)
  check('no backup was written', existsSync(join(JANITOR_DIR, 'backups')) === false)
  check('no notification for a scan-only run', notices.length === 0)
  check('each store reported its inspected/before/after numbers', first.stores.memory.inspected === 3 && first.stores.lessons.inspected === 2, first.stores)
  const reportAfterFirst = reportLines(janitor.reportPath)
  check('exactly one JSONL report line', reportAfterFirst.length === 1 && reportAfterFirst[0].runId === first.runId, reportAfterFirst.length)
  check('the report line carries the documented fields', ['runId', 'start', 'end', 'durationMs', 'status', 'dirtyStores', 'before', 'after', 'merges', 'archives', 'conflicts', 'model', 'errors', 'backupPath', 'lock'].every((key) => key in reportAfterFirst[0]), Object.keys(reportAfterFirst[0]))

  // ── second run, straight away: not due (dirty-only + five hours) ──────────
  console.log('── second run immediately: not due, no store touched ──')
  const second = await janitor.run()
  check('status skipped / not_due', second.status === 'skipped' && second.reason === 'not_due', { status: second.status, reason: second.reason })
  check('the stores were not scanned again', second.dirtyStores.length === 0 && Object.keys(second.stores || {}).length === 0)

  // ── five hours later, the stores changed, the apply gate is open ──────────
  console.log('── apply run: backup before each change, one change notification ──')
  clock.t += JANITOR.INTERVAL_MS + 1000
  // the stores changed since the last successful inspection
  rows.push({ id: 'm4', scope: 'account', kind: 'fact', content: 'the main office address is Paris France', pinned: false, source: 'conversation', retention_days: 180, created_at: '2026-01-02T00:00:00.000Z' })
  // the host keeps its memory cache fresh on its own timer (~30 s); simulate that, so revision() sees the new row
  await cloud.refreshMemoryCache({ token: 'kyd_' + 's'.repeat(40), kyberMap: {} }, true)
  const lessons = lessonsOf('default')
  lessons.push({ ts: '2026-01-03T00:00:00.000Z', text: 'Always run the focused tests first', tags: [], uses: 0, lastUsed: null })
  writeFileSync(join(KYBERS, 'default', 'memory', 'lessons.jsonl'), lessons.map((l) => JSON.stringify(l)).join('\n') + '\n')
  const applyJanitor = makeJanitor({ KYBERNOS_JANITOR: 'apply' })
  const applied = await applyJanitor.run()
  check('status changed', applied.status === 'changed', { status: applied.status, errors: applied.errors })
  check('one merge and one archive on the memory store', applied.merges >= 1 && applied.archives >= 1, { merges: applied.merges, archives: applied.archives })
  check('the cloud DELETE went through the store path', rows.length === 2 && seen.filter((s) => s.method === 'DELETE').length > deletesBefore, { rows: rows.length })
  check('the pinned memory survived', rows.some((r) => r.id === 'm1' && r.pinned === true))
  check('the lessons duplicate was merged', lessonsOf('default').length === 1, lessonsOf('default').map((l) => l.text))
  const backups = Object.values(applied.backups)
  check('one timestamped backup per changed store, under <state dir>/backups', backups.length === 2 && backups.every((file) => file.startsWith(join(JANITOR_DIR, 'backups')) && existsSync(file)), backups)
  const memoryBackup = JSON.parse(readFileSync(applied.backups.memory, 'utf8'))
  check('the memory backup holds the rows as they were BEFORE the change', memoryBackup.kind === 'memory' && memoryBackup.rows.length === 4, memoryBackup.rows && memoryBackup.rows.length)
  const lessonsBackup = JSON.parse(readFileSync(applied.backups.lessons, 'utf8'))
  check('the lessons backup holds the lessons as they were BEFORE the change', lessonsBackup.kind === 'lessons' && lessonsBackup.kybers.default.length === 3, lessonsBackup.kybers && lessonsBackup.kybers.default.length)
  check('exactly one change notification, naming what changed', notices.length === 1 && notices[0].kind === 'changed' && /duplicate/.test(notices[0].message), notices)
  check('the state remembers the successful apply', janitorModule.readState(JANITOR_DIR).appliedOnce === true)
  check('the journal last line is the apply run', reportLines(applyJanitor.reportPath).slice(-1)[0].runId === applied.runId && reportLines(applyJanitor.reportPath).length >= 2, reportLines(applyJanitor.reportPath).slice(-1)[0])

  // ── the following five-hour run: revisions unchanged, silent clean skip ───
  console.log('── next run after a clean: revisions unchanged, silent clean ──')
  clock.t += JANITOR.INTERVAL_MS + 1000
  const clean = await applyJanitor.run()
  check('status clean / unchanged', clean.status === 'clean' && clean.reason === 'unchanged', { status: clean.status, reason: clean.reason })
  check('no store was scanned', clean.dirtyStores.length === 0 && clean.stores.memory.clean === true && clean.stores.lessons.clean === true, clean.stores)
  check('no new notification', notices.length === 1)
  check('a clean line is still written', reportLines(applyJanitor.reportPath).slice(-1)[0].runId === clean.runId, reportLines(applyJanitor.reportPath).slice(-1)[0])

  // ── the report is bounded ─────────────────────────────────────────────────
  console.log('── bounded report ──')
  const reportFile = applyJanitor.reportPath
  for (let i = 0; i < JANITOR.REPORT_MAX_LINES + 20; i += 1) janitorModule.appendBounded(reportFile, JSON.stringify({ i }), { maxLines: JANITOR.REPORT_MAX_LINES, maxBytes: JANITOR.REPORT_MAX_BYTES })
  check('the report keeps the last 200 lines', readFileSync(reportFile, 'utf8').split('\n').filter((l) => l.trim() !== '').length === JANITOR.REPORT_MAX_LINES)
} catch (e) {
  ko += 1
  console.log('  ✗ the test crashed: ' + String((e && e.stack) || e))
} finally {
  try { server.close() } catch (e) { /* closed */ }
}

console.log('SKIPPED: a real five-hour wall-clock wait: the interval is exercised on an injected clock')
console.log('SKIPPED: the real Kybernos API and the live ~/.dsh stores: a local HTTP server and mkdtemp fixtures stand in for them')
console.log('')
console.log(ok + ' passed, ' + ko + ' failed — ' + ROOT)
try { rmSync(ROOT, { recursive: true, force: true }) } catch (e) { /* keep it for inspection */ }
process.exit(ko === 0 ? 0 : 1)
