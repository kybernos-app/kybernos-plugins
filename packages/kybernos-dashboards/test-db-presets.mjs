// kybernos-dashboards, the overviews the sector templates ship, read from the REAL database their template makes: each template is installed into a temp Tables
// database (kybernos-db), the routes the page calls (`/kybernos-db/state`, `/kybernos-db/records`) are answered by the bundle's own api, and every widget must find
// its table, its columns and rows (nothing "undefined", no widget empty, no warning). Hermetic: a temp folder, a real SQLite file, no network, no DSH.
// `cd packages/kybernos-dashboards && node test-db-presets.mjs`
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeService } from '../kybernos-db/agent/service.mjs'
import { makeApi } from '../kybernos-db/api.mjs'
import { MARKER_FILE, installTemplate, readMarkers } from '../kybernos-db/instantiate.mjs'
import * as M from './model.mjs'

let fail = 0
let passed = 0
const ok = (name, cond, detail) => {
  if (cond) { passed++; return }
  fail++
  console.log('FAIL ' + name + (detail === undefined ? '' : ' :: ' + JSON.stringify(detail)))
}

const THEMES = join(dirname(fileURLToPath(import.meta.url)), '..', 'kybernos-plugin', 'themes')
const root = mkdtempSync(join(tmpdir(), 'kb-dash-db-'))
const NOW = Date.now()
const json = (file) => JSON.parse(readFileSync(file, 'utf8'))

/** Reads one source the way the page does: the first round, then the second. */
function read (api, source) {
  const route = (path) => {
    const [p, q] = path.split('?')
    const a = Object.fromEntries(new URLSearchParams(q || ''))
    if (p === '/kybernos-db/state') return api.state()
    if (p === '/kybernos-db/records') return api.records(a)
    return null
  }
  const parts = {}
  for (const req of M.planFor(source, NOW)) parts[req.key] = route(req.path)
  for (const req of M.planNext(source, parts, NOW)) parts[req.key] = route(req.path)
  return M.buildTable(source, parts, NOW)
}

const themes = readdirSync(THEMES).filter((t) => existsSync(join(THEMES, t, 'db', t + '.json')) && existsSync(join(THEMES, t, 'dashboards', 'overview.json')))
ok('three sector templates ship a database and an overview', themes.length === 3, themes)

for (const lang of ['en', 'fr']) {
  for (const t of themes) {
    const home = join(root, lang + '-' + t)
    const service = makeService({ dir: join(home, 'dbs') })
    const sample = existsSync(join(THEMES, t, 'demo', 'db-sample.json')) ? json(join(THEMES, t, 'demo', 'db-sample.json')) : undefined
    const made = installTemplate({ service, template: json(join(THEMES, t, 'db', t + '.json')), sample, lang })
    ok(t + '/' + lang + ': the template installs', made.ok === true && made.skipped !== true, made)
    const api = makeApi({ service, ports: { markers: () => readMarkers(join(home, MARKER_FILE)) } })
    ok(t + '/' + lang + ': the state names the template the database came from', api.state().dbs.some((d) => d.template === t), api.state().dbs.map((d) => d.template))

    const overview = M.validateDashboard(json(join(THEMES, t, 'dashboards', 'overview.json')))
    ok(t + '/' + lang + ': the overview is a sound dashboard', overview.ok === true && overview.errors.length === 0, overview.errors)
    const d = overview.dashboard
    const warnings = M.inspectDashboard(d)
    ok(t + '/' + lang + ': it has nothing to warn about', warnings.length === 0, warnings)
    ok(t + '/' + lang + ': every widget reads Tables and names the template\'s database', d.widgets.every((w) => w.source !== undefined && w.source.provider === 'db.rows' && w.source.params.db === t), d.widgets.map((w) => w.source && w.source.provider))

    for (const w of d.widgets) {
      const table = read(api, w.source)
      const at = t + '/' + lang + ' "' + w.title + '"'
      ok(at + ': the table has rows', table.rows.length > 0, table.meta.note)
      if (table.rows.length === 0) continue
      ok(at + ': no cell says undefined', table.rows.every((r) => Object.values(r).every((v) => v !== undefined && !String(v).includes('undefined'))))
      if (w.type === 'card') {
        const c = M.cardData(table, w)
        ok(at + ': the card holds a number above zero', typeof c.value === 'number' && c.value > 0, c)
      } else if (w.type === 'chart') {
        const c = M.chartData(table, w)
        ok(at + ': the chart draws something', c.empty !== true && c.labels.length > 0 && c.series.some((s) => s.values.some((v) => v > 0)), c)
      } else if (w.type === 'list') {
        ok(at + ': the list has entries with a title', M.listData(table, w).length > 0 && M.listData(table, w).every((r) => r.title !== ''))
      } else if (w.type === 'table') {
        const td = M.tableData(table, w)
        ok(at + ': the table has rows', td.rows.length > 0)
      }
    }
  }
}

rmSync(root, { recursive: true, force: true })
console.log(fail === 0 ? 'db presets: ok (' + passed + ' checks)' : fail + ' failed of ' + (passed + fail))
process.exit(fail ? 1 : 0)
