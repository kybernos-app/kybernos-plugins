// test/test-host.mjs — bench for the pure functions + the host routes.
//
// No server, no DSH, no ~/.dsh: a fake webServer captures the handlers, and they are called with fake req/res
// against a small mini-CRM database built in a temporary folder (the shape the kybers ship: societes, contacts,
// affaires, activites, with REFERENCES between them).
//
// Usage: node test/test-host.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { listerBases, lireSchema, lireLignes, executerSelect, monterRoutes, ouvrirLecture, ATTENTE_MS } from '../index.js'

const kybersHome = mkdtempSync(join(tmpdir(), 'dbv-host-'))
const dbPoc = join(kybersHome, 'mini-crm', 'donnees.sqlite')
mkdirSync(join(kybersHome, 'mini-crm'))
{
  const db = new DatabaseSync(dbPoc)
  db.exec(`
    CREATE TABLE societes (id INTEGER PRIMARY KEY, nom TEXT NOT NULL);
    CREATE TABLE contacts (id INTEGER PRIMARY KEY, nom TEXT, email TEXT, societe_id INTEGER REFERENCES societes(id));
    CREATE TABLE affaires (id INTEGER PRIMARY KEY, titre TEXT, montant REAL, societe_id INTEGER REFERENCES societes(id));
    CREATE TABLE activites (id INTEGER PRIMARY KEY, type TEXT, contact_id INTEGER REFERENCES contacts(id));
    INSERT INTO societes (nom) VALUES ('Acme'), ('Globex'), ('Initech');
    INSERT INTO contacts (nom, email, societe_id) VALUES ('Ada', 'ada@acme.test', 1), ('Bob', 'bob@globex.test', 2), ('Cy', 'cy@initech.test', 3), ('Di', 'di@acme.test', 1);
    INSERT INTO affaires (titre, montant, societe_id) VALUES ('Licence', 1200, 1), ('Support', 300, 2), ('Audit', 4500, 3);
    INSERT INTO activites (type, contact_id) VALUES ('call', 1), ('mail', 2), ('visit', 3);
  `)
  db.close()
}

try {
  // ── pure functions ──────────────────────────────────────────────────────────
  const bases = listerBases(kybersHome)
  assert.ok(bases.some((b) => b.id === 'mini-crm'), 'mini-crm listed')
  const tables = bases.find((b) => b.id === 'mini-crm').tables
  for (const nom of ['activites', 'affaires', 'contacts', 'societes']) {
    assert.ok(tables.some((t) => t.nom === nom && t.compte > 0), nom + ' is filled')
  }
  console.log('[test] listerBases OK —', tables.map((t) => t.nom + ':' + t.compte).join(' '))

  const schema = lireSchema(dbPoc)
  // The mini-CRM contract tolerates extra tables (meetings, pack): ≥ 4, not = 4.
  assert.ok(schema.tables.length >= 4, '≥ 4 tables — ' + schema.tables.length)
  assert.ok(schema.relations.length >= 3, '≥ 3 relations — ' + schema.relations.length)
  assert.ok(schema.relations.some((r) => r.parent === 'societes' && r.enfant === 'contacts'), 'societes→contacts')
  const email = schema.tables.find((t) => t.nom === 'contacts').colonnes.find((c) => c.name === 'email')
  assert.equal(email.pk, false)
  assert.equal(schema.tables.find((t) => t.nom === 'contacts').colonnes.find((c) => c.name === 'societe_id').fkVers, 'societes')
  console.log('[test] lireSchema OK —', schema.relations.map((r) => r.parent + '→' + r.enfant).join(' '))

  const lignes = lireLignes(dbPoc, 'societes', 50)
  assert.equal(lignes.lignes.length, lignes.compte, 'all the companies')
  assert.ok(lignes.colonnes.some((c) => c.name === 'nom'), 'nom column')
  console.log('[test] lireLignes OK —', lignes.compte, 'companies')

  const q = executerSelect(dbPoc, 'SELECT titre, montant FROM affaires ORDER BY montant DESC')
  assert.ok(q.compte > 0, 'a SELECT returns rows')
  assert.throws(() => executerSelect(dbPoc, 'DELETE FROM contacts'), /Read-only/, 'DELETE refused')
  assert.throws(() => executerSelect(dbPoc, 'SELECT 1; DROP TABLE contacts'), /One statement at a time/, 'stacked statements refused')
  assert.throws(() => lireLignes(dbPoc, 'contacts"; DROP', 5), /Invalid table name/, 'booby-trapped table refused')
  console.log('[test] executerSelect OK — SELECT returns', q.compte, 'rows; writes refused')

  // ── routes through a fake webServer ─────────────────────────────────────────
  const routes = {}
  monterRoutes({ register: (r) => { routes[r.path] = r.handler } }, { kybersHome, silencieux: true })

  async function appel (path, params) {
    assert.ok(routes[path], 'route ' + path + ' mounted')
    let corps = null
    let code = 0
    const res = {
      writeHead: (c) => { code = c },
      end: (s) => { corps = s },
    }
    const url = path + (params ? '?' + new URLSearchParams(params) : '')
    // The origin guard compares the Origin host with the port the socket is really bound to: a request with no socket
    // never matches, so the fake request carries one (a real request always does).
    await routes[path]({ method: 'GET', url, headers: { origin: 'http://127.0.0.1:3080' }, socket: { localPort: 3080 } }, res)
    return { code, json: JSON.parse(corps) }
  }

  const rBases = await appel('/dsh-db-viewer/bases')
  assert.equal(rBases.code, 200)
  assert.ok(rBases.json.bases.some((b) => b.id === 'mini-crm'))
  const rSchema = await appel('/dsh-db-viewer/schema', { base: 'mini-crm' })
  assert.ok(rSchema.json.tables.length >= 4, '≥ 4 tables through the route')
  const rRows = await appel('/dsh-db-viewer/rows', { base: 'mini-crm', table: 'contacts', limit: 3 })
  assert.ok(rRows.json.lignes.length <= 3, 'limit respected')
  const rQ = await appel('/dsh-db-viewer/query', { base: 'mini-crm', sql: 'SELECT count(*) n FROM affaires' })
  assert.equal(rQ.json.colonnes[0], 'n')
  const rMauvais = await appel('/dsh-db-viewer/query', { base: 'mini-crm', sql: 'DELETE FROM contacts' })
  assert.equal(rMauvais.code, 400, 'write refused by the route')
  const rPion = await appel('/dsh-db-viewer/schema', { base: '../../etc' })
  assert.equal(rPion.code, 400, 'booby-trapped path refused')
  // Every other origin is refused with a 403 (and nothing is read): a remote site, a look-alike prefix, the right host on
  // another port. No Origin at all (a same-origin GET from a browser, or a plain local client) and the exact listener pass.
  const codeFor = async (headers) => {
    let code = 0
    let corps = ''
    await routes['/dsh-db-viewer/bases'](
      { method: 'GET', url: '/dsh-db-viewer/bases', headers, socket: { localPort: 3080 } },
      { writeHead: (c) => { code = c }, end: (s) => { corps = String(s || '') } })
    return { code, corps }
  }
  for (const origin of ['https://evil.example', 'http://localhost.evil.example:3080', 'http://127.0.0.1:3081', 'http://127.0.0.1', 'file://']) {
    const r = await codeFor({ origin })
    assert.equal(r.code, 403, 'origin ' + origin + ' refused')
    assert.ok(!r.corps.includes('mini-crm'), 'nothing is read for ' + origin)
  }
  assert.equal((await codeFor({})).code, 200, 'no Origin header passes')
  assert.equal((await codeFor({ origin: 'http://localhost:3080' })).code, 200, 'localhost on the listener port passes')
  console.log('[test] routes OK — bases/schema/rows/query; write, booby-trapped path and remote origin refused')

  // proof that the routes wrote NOTHING: the database still counts its rows
  const db = new DatabaseSync(dbPoc, { readOnly: true })
  const total = db.prepare('SELECT (SELECT count(*) FROM societes)+(SELECT count(*) FROM contacts)+(SELECT count(*) FROM affaires)+(SELECT count(*) FROM activites) n').get().n
  db.close()
  assert.ok(total > 0, 'database intact')
  console.log('[test] database intact —', total, 'rows in total')

  // ── the plugins' own root: <DSH home>/kybernos/<dir>/donnees.sqlite, listed as kybernos-<dir> ──────────────────────────────────
  const kybernosHome = mkdtempSync(join(tmpdir(), 'dbv-kybernos-'))
  try {
    // The REAL business base (kybernos-plugin/business-base.mjs), made on a temp tree: the viewer must list it and read it.
    const { createBusinessBase } = await import('../../kybernos-plugin/business-base.mjs')
    const business = createBusinessBase({ file: join(kybernosHome, 'business', 'donnees.sqlite') })
    assert.equal(business.seed({ contacts: [{ ref: 'a', name: 'Ada' }, { name: 'Bob', company_ref: undefined }], items: [{ title: 'Mug' }], cards: [{ flow: 'orders', stage: 'new', title: '#1' }] }, { theme: 'ecommerce' }).ok, true)
    business.close()
    mkdirSync(join(kybernosHome, 'moteur'))                                  // a folder with no database: ignored
    mkdirSync(join(kybernosHome, 'Not A Valid Id'))                          // an id the viewer would refuse: ignored
    writeFileSync(join(kybernosHome, 'loose-file.txt'), 'x')
    const both = listerBases(kybersHome, kybernosHome)
    const bus = both.find((b) => b.id === 'kybernos-business')
    assert.ok(bus, 'the business base is listed as kybernos-business')
    assert.deepEqual(bus.tables.map((t) => t.nom), ['changes', 'contact', 'flow_card', 'item', 'meta', 'note', 'pack'])
    assert.equal(bus.tables.find((t) => t.nom === 'contact').compte, 2)
    assert.ok(both.some((b) => b.id === 'mini-crm'), 'the kybers are still listed')
    assert.deepEqual(both.map((b) => b.id), [...both.map((b) => b.id)].sort(), 'sorted')
    assert.ok(!listerBases(kybersHome).some((b) => b.id === 'kybernos-business'), 'with no second root, nothing changes')
    assert.deepEqual(listerBases(kybersHome, join(kybernosHome, 'absent')).map((b) => b.id), listerBases(kybersHome).map((b) => b.id), 'a missing root is no error')
    console.log('[test] second root OK — kybernos-business listed with', bus.tables.length, 'tables')

    // A kyber that already has that id keeps it.
    mkdirSync(join(kybersHome, 'kybernos-business'))
    const clash = new DatabaseSync(join(kybersHome, 'kybernos-business', 'donnees.sqlite'))
    clash.exec('CREATE TABLE only_in_the_kyber (id INTEGER PRIMARY KEY)')
    clash.close()
    const clashed = listerBases(kybersHome, kybernosHome).filter((b) => b.id === 'kybernos-business')
    assert.equal(clashed.length, 1, 'listed once')
    assert.deepEqual(clashed[0].tables.map((t) => t.nom), ['only_in_the_kyber'], 'the kyber wins')
    rmSync(join(kybersHome, 'kybernos-business'), { recursive: true, force: true })

    // ── through the routes ───────────────────────────────────────────────────────────────────────────────────────────────────────
    const routes2 = {}
    const mounted = monterRoutes({ register: (r) => { routes2[r.path] = r.handler } }, { kybersHome, kybernosHome, silencieux: true })
    assert.equal(mounted.kybernosHome, kybernosHome)
    const call = async (path, params) => {
      let code = 0
      let body = null
      await routes2[path]({ method: 'GET', url: path + (params ? '?' + new URLSearchParams(params) : ''), headers: {}, socket: { localPort: 3080 } }, { writeHead: (c) => { code = c }, end: (t) => { body = t } })
      return { code, json: JSON.parse(body) }
    }
    assert.ok((await call('/dsh-db-viewer/bases')).json.bases.some((b) => b.id === 'kybernos-business'))
    const sch = await call('/dsh-db-viewer/schema', { base: 'kybernos-business' })
    assert.equal(sch.code, 200)
    assert.ok(sch.json.relations.some((r) => r.parent === 'contact' && r.enfant === 'note'), 'the relations of the base are drawn')
    assert.equal((await call('/dsh-db-viewer/rows', { base: 'kybernos-business', table: 'contact', limit: 5 })).json.lignes.length, 2)
    assert.equal((await call('/dsh-db-viewer/query', { base: 'kybernos-business', sql: "SELECT json_extract(contenu, '$.entites[0].table') AS t FROM pack" })).json.lignes[0].t, 'contact', 'the pack row is readable')
    assert.equal((await call('/dsh-db-viewer/query', { base: 'kybernos-business', sql: 'DELETE FROM contact' })).code, 400, 'still read-only')
    for (const bad of ['kybernos-', 'kybernos-..', 'kybernos-../mini-crm', 'kybernos-moteur', 'kybernos-Not A Valid Id', 'kybernos-absent']) {
      assert.equal((await call('/dsh-db-viewer/schema', { base: bad })).code, 400, bad + ' refused')
    }
    // a routes mount that names only the kybers root never reaches a second one
    const routes3 = {}
    assert.equal(monterRoutes({ register: (r) => { routes3[r.path] = r.handler } }, { kybersHome, silencieux: true }).kybernosHome, null)
    console.log('[test] second root through the routes OK — schema, rows, query, pack; hostile ids refused; still read-only')

    // ── the door: read-only, and patient with a writer ───────────────────────────────────────────────────────────────────────────
    const door = ouvrirLecture(join(kybernosHome, 'business', 'donnees.sqlite'))
    try {
      assert.equal(door.prepare('PRAGMA busy_timeout').get().timeout, ATTENTE_MS, 'a read waits for a writer')
      assert.ok(ATTENTE_MS >= 1000)
      assert.throws(() => door.exec('DELETE FROM contact'), /readonly|read-only/i, 'and it cannot write')
    } finally { door.close() }
    const nobody = ouvrirLecture(dbPoc)
    assert.equal(nobody.prepare('PRAGMA busy_timeout').get().timeout, ATTENTE_MS, 'the kybers get the same door')
    nobody.close()
    console.log('[test] read door OK — read-only, busy_timeout', ATTENTE_MS)
  } finally { rmSync(kybernosHome, { recursive: true, force: true }) }
  console.log('OK')
} finally { rmSync(kybersHome, { recursive: true, force: true }) }
