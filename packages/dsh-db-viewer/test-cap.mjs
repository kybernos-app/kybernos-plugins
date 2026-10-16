// A4-22: the SQL tab used to send every row of a result to the page (200 000 rows = 54 MB of JSON, one million DOM
// nodes, the page frozen ~14 s). The host now cuts the answer and says it did.
//
// The hostile sample of the audit is generated here (a 200 000-row table, 200-character payloads) in a temporary
// folder: nothing big is committed. No DSH, no network, no ~/.dsh.
//
//   node packages/dsh-db-viewer/test-cap.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { executerSelect, monterRoutes } from './index.js'

const home = mkdtempSync(join(tmpdir(), 'dbv-cap-'))
let n = 0
const ok = (label) => { n += 1; console.log('  ✓ ' + label) }

try {
  mkdirSync(join(home, 'a4-big'))
  const file = join(home, 'a4-big', 'donnees.sqlite')
  const db = new DatabaseSync(file)
  db.exec('CREATE TABLE events (id INTEGER PRIMARY KEY, ts TEXT, kind TEXT, payload TEXT)')
  const insert = db.prepare('INSERT INTO events (ts, kind, payload) VALUES (?, ?, ?)')
  const payload = 'x'.repeat(200)
  db.exec('BEGIN')
  for (let i = 0; i < 200000; i += 1) insert.run(new Date(1.7e12 + i * 1000).toISOString(), 'k' + (i % 7), payload)
  db.exec('COMMIT')
  db.close()

  // ── the pure function ────────────────────────────────────────────────────
  const all = executerSelect(file, 'SELECT * FROM events')
  assert.equal(all.lignes.length, 500, 'a query with no limit returns the first 500 rows, not 200 000')
  assert.equal(all.compte, 500)
  assert.equal(all.total, 200000, 'the real size of the result is reported')
  assert.equal(all.tronque, true)
  assert.equal(all.borne, false)
  assert.deepEqual(all.colonnes, ['id', 'ts', 'kind', 'payload'])
  assert.equal(all.lignes[0].id, 1, 'the rows kept are the first ones')
  ok('SELECT * on 200 000 rows: 500 rows back, total 200000, flagged as cut')

  assert.equal(executerSelect(file, 'SELECT * FROM events', 1000).lignes.length, 1000)
  assert.equal(executerSelect(file, 'SELECT * FROM events', '2000').lignes.length, 2000, 'the limit may arrive as a string (query string)')
  assert.equal(executerSelect(file, 'SELECT * FROM events', 999999).lignes.length, 5000, 'asking for more stops at 5 000')
  assert.equal(executerSelect(file, 'SELECT * FROM events', -3).lignes.length, 1, 'a nonsense limit is clamped, not obeyed')
  assert.equal(executerSelect(file, 'SELECT * FROM events', 'abc').lignes.length, 500, 'an unreadable limit falls back to the default')
  ok('the limit is honoured, clamped to 1..5000, and defaults to 500')

  const small = executerSelect(file, 'SELECT * FROM events LIMIT 20')
  assert.equal(small.lignes.length, 20)
  assert.equal(small.total, 20)
  assert.equal(small.tronque, false)
  const exact = executerSelect(file, 'SELECT * FROM events LIMIT 500')
  assert.equal(exact.tronque, false, 'exactly 500 rows is not « cut »')
  ok('a result that fits is returned whole and not flagged')

  // A query that would produce millions of rows must not hold the host for as long as it takes to count them.
  const t0 = Date.now()
  const runaway = executerSelect(file, 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 3000000) SELECT x FROM c')
  assert.equal(runaway.lignes.length, 500)
  assert.equal(runaway.borne, true, 'counting stops at a bound')
  assert.equal(runaway.total, 1000000)
  assert.ok(Date.now() - t0 < 20000, 'the runaway query is bounded in time (' + (Date.now() - t0) + ' ms)')
  ok('a 3-million-row query stops counting at 1 000 000 (' + (Date.now() - t0) + ' ms)')

  assert.equal(executerSelect(file, 'PRAGMA table_info(events)').lignes.length, 4)
  assert.equal(executerSelect(file, 'EXPLAIN QUERY PLAN SELECT * FROM events').compte > 0, true)
  assert.throws(() => executerSelect(file, 'DELETE FROM events'), /Read-only/)
  assert.throws(() => executerSelect(file, 'SELECT 1; DROP TABLE events'), /One statement at a time/)
  ok('PRAGMA and EXPLAIN still work; writes and stacked statements are still refused')

  // ── the route the page calls ─────────────────────────────────────────────
  const routes = {}
  monterRoutes({ register: (r) => { routes[r.path] = r.handler } }, { kybersHome: home, silencieux: true })
  const appelRoute = async (route, params) => {
    let corps = ''
    let code = 0
    const res = { writeHead: (c) => { code = c }, end: (s) => { corps = s } }
    // The origin guard compares with the socket's own port: a request without a socket is refused.
    await routes[route]({ method: 'GET', url: route + '?' + new URLSearchParams(params), headers: { origin: 'http://127.0.0.1:3080' }, socket: { localPort: 3080 } }, res)
    return { code, bytes: corps.length, json: JSON.parse(corps) }
  }
  const appel = (params) => appelRoute('/dsh-db-viewer/query', params)
  const def = await appel({ base: 'a4-big', sql: 'SELECT * FROM events' })
  assert.equal(def.code, 200)
  assert.equal(def.json.lignes.length, 500)
  assert.equal(def.json.total, 200000)
  assert.ok(def.bytes < 400000, 'the default answer is a few hundred KB, not 54 MB (' + def.bytes + ' bytes)')
  const more = await appel({ base: 'a4-big', sql: 'SELECT * FROM events', limit: '100000' })
  assert.equal(more.json.lignes.length, 5000, 'the route clamps the limit too')
  assert.ok(more.bytes < 3000000, 'even the largest page stays under 3 MB (' + more.bytes + ' bytes)')
  ok('GET /dsh-db-viewer/query?limit= answers ' + def.bytes + ' bytes by default and ' + more.bytes + ' at the cap')

  // ── A2-02: what the host refuses is said in English, with a code the page maps to the language of the person ──
  const refus = [
    ['an empty query', await appel({ base: 'a4-big', sql: '   ' }), 'empty-query', /^Empty query/],
    ['a write', await appel({ base: 'a4-big', sql: 'DELETE FROM events' }), 'read-only', /^Read-only: SELECT/],
    ['stacked statements', await appel({ base: 'a4-big', sql: 'SELECT 1; SELECT 2' }), 'one-statement', /^One statement at a time/],
    ['an unknown database', await appel({ base: 'nope', sql: 'SELECT 1' }), 'unknown-base', /^Unknown database/],
    ['a booby-trapped table name', await appelRoute('/dsh-db-viewer/rows', { base: 'a4-big', table: 'events"; DROP' }), 'bad-table', /^Invalid table name/],
    ['an unknown table', await appelRoute('/dsh-db-viewer/rows', { base: 'a4-big', table: 'nothing' }), 'unknown-table', /^Unknown table: nothing/],
  ]
  for (const [what, r, code, texte] of refus) {
    assert.equal(r.code, 400, what + ': HTTP 400')
    assert.equal(r.json.code, code, what + ': code ' + code + ' (got ' + r.json.code + ')')
    assert.match(r.json.erreur, texte, what + ': English sentence (got ' + r.json.erreur + ')')
    assert.doesNotMatch(r.json.erreur, /[éèêàçù]|requête|inconnue|invalide/, what + ': no French')
  }
  // An error that is not one of ours (the engine's own message) travels without a code: the page prints it as it is.
  const moteur = await appel({ base: 'a4-big', sql: 'SELECT * FROM table_that_does_not_exist' })
  assert.equal(moteur.code, 400)
  assert.equal(moteur.json.code, undefined, 'the engine message carries no code of ours')
  assert.match(moteur.json.erreur, /no such table/)
  ok('the six refusals answer in English with their code; an engine error keeps its own message and no code')
} finally {
  rmSync(home, { recursive: true, force: true })
}

console.log('dsh-db-viewer row cap: ' + n + ' checks')
