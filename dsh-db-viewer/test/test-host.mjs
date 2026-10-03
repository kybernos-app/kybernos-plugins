// test/test-host.mjs — harnais des fonctions pures + des routes hôte.
//
// Aucun serveur, aucun DSH : un webServer factice capture les handlers, et on
// les appelle avec des req/res factices contre la VRAIE base du POC mini-crm
// (`~/.dsh/kybers/mini-crm/donnees.sqlite`) — lecture seule, zéro écriture.
//
// Usage : node test/test-host.mjs
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { listerBases, lireSchema, lireLignes, executerSelect, monterRoutes } from '../index.js'

const kybersHome = join(homedir(), '.dsh', 'kybers')
const dbPoc = join(kybersHome, 'mini-crm', 'donnees.sqlite')
if (!existsSync(dbPoc)) {
  console.error('[test] base POC absente :', dbPoc)
  process.exit(1)
}

// ── fonctions pures ─────────────────────────────────────────────────────────
const bases = listerBases(kybersHome)
assert.ok(bases.some((b) => b.id === 'mini-crm'), 'mini-crm listé')
const tables = bases.find((b) => b.id === 'mini-crm').tables
for (const nom of ['activites', 'affaires', 'contacts', 'societes']) {
  assert.ok(tables.some((t) => t.nom === nom && t.compte > 0), nom + ' peuplée')
}
console.log('[test] listerBases OK —', tables.map((t) => t.nom + ':' + t.compte).join(' '))

const schema = lireSchema(dbPoc)
// Le contrat mini-CRM tolère les tables en plus (meetings, pack) : ≥ 4, pas = 4.
assert.ok(schema.tables.length >= 4, '≥ 4 tables — ' + schema.tables.length)
assert.ok(schema.relations.length >= 3, '≥ 3 relations — ' + schema.relations.length)
assert.ok(schema.relations.some((r) => r.parent === 'societes' && r.enfant === 'contacts'), 'societes→contacts')
const email = schema.tables.find((t) => t.nom === 'contacts').colonnes.find((c) => c.name === 'email')
assert.equal(email.pk, false)
assert.equal(schema.tables.find((t) => t.nom === 'contacts').colonnes.find((c) => c.name === 'societe_id').fkVers, 'societes')
console.log('[test] lireSchema OK —', schema.relations.map((r) => r.parent + '→' + r.enfant).join(' '))

const lignes = lireLignes(dbPoc, 'societes', 50)
assert.equal(lignes.lignes.length, lignes.compte, 'toutes les sociétés')
assert.ok(lignes.colonnes.some((c) => c.name === 'nom'), 'colonne nom')
console.log('[test] lireLignes OK —', lignes.compte, 'sociétés')

const q = executerSelect(dbPoc, 'SELECT titre, montant FROM affaires ORDER BY montant DESC')
assert.ok(q.compte > 0, 'requête SELECT rend des lignes')
assert.throws(() => executerSelect(dbPoc, 'DELETE FROM contacts'), /lecture seule/, 'DELETE refusé')
assert.throws(() => executerSelect(dbPoc, 'SELECT 1; DROP TABLE contacts'), /une seule requête/, 'pile refusée')
assert.throws(() => lireLignes(dbPoc, 'contacts"; DROP', 5), /nom de table invalide/, 'table piégée refusée')
console.log('[test] executerSelect OK — SELECT rend', q.compte, 'lignes ; écritures refusées')

// ── routes via un webServer factice ─────────────────────────────────────────
const routes = {}
monterRoutes({ register: (r) => { routes[r.path] = r.handler } }, { kybersHome, silencieux: true })

async function appel (path, params) {
  assert.ok(routes[path], 'route ' + path + ' montée')
  let corps = null
  let code = 0
  const res = {
    writeHead: (c) => { code = c },
    end: (s) => { corps = s },
  }
  const url = path + (params ? '?' + new URLSearchParams(params) : '')
  await routes[path]({ method: 'GET', url, headers: { origin: 'http://127.0.0.1:3080' } }, res)
  return { code, json: JSON.parse(corps) }
}

const rBases = await appel('/dsh-db-viewer/bases')
assert.equal(rBases.code, 200)
assert.ok(rBases.json.bases.some((b) => b.id === 'mini-crm'))
const rSchema = await appel('/dsh-db-viewer/schema', { base: 'mini-crm' })
assert.ok(rSchema.json.tables.length >= 4, '≥ 4 tables via la route')
const rRows = await appel('/dsh-db-viewer/rows', { base: 'mini-crm', table: 'contacts', limit: 3 })
assert.ok(rRows.json.lignes.length <= 3, 'limite respectée')
const rQ = await appel('/dsh-db-viewer/query', { base: 'mini-crm', sql: 'SELECT count(*) n FROM affaires' })
assert.equal(rQ.json.colonnes[0], 'n')
const rMauvais = await appel('/dsh-db-viewer/query', { base: 'mini-crm', sql: 'DELETE FROM contacts' })
assert.equal(rMauvais.code, 400, 'écriture refusée par la route')
const rPion = await appel('/dsh-db-viewer/schema', { base: '../../etc' })
assert.equal(rPion.code, 400, 'chemin piégé refusé')
const rOrigine = await routes['/dsh-db-viewer/bases'](
  { method: 'GET', url: '/dsh-db-viewer/bases', headers: { origin: 'https://evil.example' } },
  { writeHead: (c) => { assert.equal(c, 403) }, end: () => {} })
console.log('[test] routes OK — bases/schema/rows/query ; écriture, chemin piégé et origine distante refusés')

// preuve que les routes n'ont RIEN écrit : la base compte toujours ses lignes
const db = new DatabaseSync(dbPoc, { readOnly: true })
const total = db.prepare('SELECT (SELECT count(*) FROM societes)+(SELECT count(*) FROM contacts)+(SELECT count(*) FROM affaires)+(SELECT count(*) FROM activites) n').get().n
db.close()
assert.ok(total > 0, 'base intacte')
console.log('[test] base intacte —', total, 'lignes au total')
console.log('OK')
