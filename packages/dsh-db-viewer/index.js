// ═══════════════════════════════════════════════════════════════════════════
// dsh-db-viewer — host half.
//
// Serves the right sidebar panel a read of the small SQLite databases of the kybers
// (`~/.dsh/kybers/<id>/donnees.sqlite`, checked by `crm.cjs`) and of the Kybernos plugins
// (`<DSH home>/kybernos/<dir>/donnees.sqlite`, listed as `kybernos-<dir>`) and of Tables (`<DSH home>/kybernos/kybernos-db/dbs/<ULID>/db.sqlite`, listed as
// `tables-<ulid>` under the database's own name). FOUR read-ONLY routes —
// no write exists here, by design: the database is filled by the kyber (crm.cjs exec),
// not by the page.
//
//   GET /dsh-db-viewer/bases            → [{ id, label?, tables: [{nom, compte}] }]
//   GET /dsh-db-viewer/schema?base=     → tables, columns, relations
//   GET /dsh-db-viewer/rows?base=&table=&limit=
//   GET /dsh-db-viewer/query?base=&sql=&limit= → SELECT/WITH/PRAGMA only, 500 rows (5 000 at most)
//
// The pure functions are exported for test/test-host.mjs and test-cap.mjs.
// ═══════════════════════════════════════════════════════════════════════════
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
// Hosted instance: also accept the authorities declared to DSH with --trusted-host. The core bundle publishes the predicate
// (kybernos-plugin/trusted-authority.mjs); absent or failing, it answers false and the guard stays loopback-only.
const kbTrusted = (host) => { try { const f = globalThis[Symbol.for('kybernos.trustedAuthority')]; return typeof f === 'function' && f(host) === true } catch (e) { return false } }
// Host fence (scripts/test-route-hosts.mjs). DSH serves plugin routes BEFORE its own authentication, and a page that rebinds its own name to this machine
// (DNS rebinding) reaches them with its own name as Host, no cookie and, on a same-origin GET, no Origin (a browser sends none): a guard that looks at the
// Origin alone lets every read through. Every route of this bundle refuses a Host that is not this listener's (the port the socket is bound to, on
// 127.0.0.1 / localhost / [::1], or an authority declared with --trusted-host) before its own guard runs. A request with no socket (a test) is not judged.
const kbHostOK = (req) => {
  try {
    const host = req.headers !== null && req.headers !== undefined && typeof req.headers.host === 'string' ? req.headers.host : null
    const sock = req.socket !== null && req.socket !== undefined ? req.socket : null
    if (host === null || sock === null || typeof sock.localPort !== 'number') return true
    const port = ':' + sock.localPort
    return ['127.0.0.1' + port, 'localhost' + port, '[::1]' + port].indexOf(host) >= 0 || kbTrusted(host)
  } catch (e) { return false }
}
// What `register` hands back takes the route off again. It is kept here and given to `ctx.effect` by `apply`, so that unloading the plugin removes every route it
// added: without it a hot reload met « duplicate exact route », logged « routes not mounted » and went on serving the OLD handlers (audit L4-05, L6-04).
const kbRetraits = []
const kbRetirerRoutes = () => { for (const retrait of kbRetraits.splice(0).reverse()) { try { retrait() } catch (e) { /* already gone */ } } }
const kbFenced = (service) => {
  if (service === null || service === undefined || typeof service.register !== 'function') return service
  const fence = (route) => (route !== null && typeof route === 'object' && typeof route.handler === 'function'
    ? Object.assign({}, route, {
      handler: (req, res, ...rest) => {
        if (kbHostOK(req) !== true) {
          try { res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' }); res.end('{"ok":false,"error":"origin refused"}') } catch (e) { /* closed */ }
          return undefined
        }
        return route.handler(req, res, ...rest)
      },
    })
    : route)
  return new Proxy(service, { get: (target, key) => (key === 'register' ? (route) => { const retrait = target.register(fence(route)); if (typeof retrait === 'function') kbRetraits.push(retrait); return retrait } : (typeof target[key] === 'function' ? target[key].bind(target) : target[key])) })
}

export const name = 'dsh-db-viewer'

const ID_VALIDE = /^[a-z0-9][a-z0-9-]*$/
const TABLE_VALIDE = /^[A-Za-z_][A-Za-z0-9_]*$/
const FICHIER = 'donnees.sqlite'
/** The id a database of `<DSH home>/kybernos/<dir>/` is listed under: a kyber of the same id keeps it. */
export const PREFIXE_KYBERNOS = 'kybernos-'
/** The id a database of Tables is listed under: `tables-` and the ULID of its folder in lower case (an id of this page is lower case). */
export const PREFIXE_TABLES = 'tables-'
const DOSSIER_TABLES = join('kybernos-db', 'dbs')
const FICHIER_TABLES = 'db.sqlite'
const ULID_TABLES = /^[0-9A-Za-z]{26}$/
/** How long a read waits for a writer that holds the file (the plugins write in WAL; measured: one `database is locked` in 680 reads without it). */
export const ATTENTE_MS = 3000

/** The one door to a database: read-only, and patient with a writer. */
export function ouvrirLecture (dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try { db.exec('PRAGMA busy_timeout = ' + ATTENTE_MS) } catch (e) { /* a Node that refuses the pragma reads without waiting */ }
  return db
}

// What this host refuses is said in English, with a code: the page maps the code to the language of the person (an error of the SQL
// engine itself carries no code and is shown as the engine worded it).
class Refus extends Error {
  constructor (code, message) { super(message); this.code = code }
}

// ── pure functions ──────────────────────────────────────────────────────────

/** The databases of one root: one folder = at most one `donnees.sqlite`; `prefixe` is put in front of the folder's name to make the id. */
function basesDe (racine, prefixe) {
  const bases = []
  if (typeof racine !== 'string' || !existsSync(racine)) return bases
  for (const entree of readdirSync(racine, { withFileTypes: true })) {
    if (!entree.isDirectory() || !ID_VALIDE.test(entree.name)) continue
    const fichier = join(racine, entree.name, FICHIER)
    if (!existsSync(fichier) || !statSync(fichier).isFile()) continue
    let tables = []
    try { tables = listerTables(fichier) } catch (e) { tables = [] }
    bases.push({ id: prefixe + entree.name, tables })
  }
  return bases
}

/**
 * The databases found: one kyber = one folder = at most one `donnees.sqlite`, then (when `kybernosHome` is given) the databases of the
 * plugins, `<kybernosHome>/<dir>/donnees.sqlite`, listed as `kybernos-<dir>`. A kyber that already has that id keeps it.
 */
export function listerBases (kybersHome, kybernosHome = null) {
  const bases = basesDe(kybersHome, '')
  for (const b of basesDe(kybernosHome, PREFIXE_KYBERNOS)) if (!bases.some((x) => x.id === b.id)) bases.push(b)
  for (const b of basesTables(kybernosHome)) if (!bases.some((x) => x.id === b.id)) bases.push(b)
  return bases.sort((a, b) => (a.id < b.id ? -1 : 1))
}

/** The folder of a Tables database, or null: `id` is `tables-<ulid in lower case>`, matched against the folders that exist (a path typed by the page is never built). */
function dossierTables (kybernosHome, id) {
  if (typeof kybernosHome !== 'string' || !id.startsWith(PREFIXE_TABLES)) return null
  const ulid = id.slice(PREFIXE_TABLES.length)
  const racine = join(kybernosHome, DOSSIER_TABLES)
  if (!/^[0-9a-z]{26}$/.test(ulid) || !existsSync(racine)) return null
  const dossier = readdirSync(racine, { withFileTypes: true }).find((e) => e.isDirectory() && ULID_TABLES.test(e.name) && e.name.toLowerCase() === ulid)
  return dossier === undefined ? null : join(racine, dossier.name, FICHIER_TABLES)
}

/** The name a Tables database carries (`meta.name`), or null: the picker shows it instead of the id. */
function nomDeTables (fichier) {
  try {
    const db = ouvrirLecture(fichier)
    try { const ligne = db.prepare("SELECT v FROM meta WHERE k = 'name'").get(); return ligne !== undefined && typeof ligne.v === 'string' && ligne.v !== '' ? ligne.v : null } finally { db.close() }
  } catch (e) { return null }
}

/** The databases of Tables: one folder of `<kybernosHome>/kybernos-db/dbs/` = one `db.sqlite`, listed as `tables-<ulid>` with its own name as `label`. */
function basesTables (kybernosHome) {
  const bases = []
  const racine = typeof kybernosHome === 'string' ? join(kybernosHome, DOSSIER_TABLES) : null
  if (racine === null || !existsSync(racine)) return bases
  for (const entree of readdirSync(racine, { withFileTypes: true })) {
    if (!entree.isDirectory() || !ULID_TABLES.test(entree.name)) continue
    const fichier = join(racine, entree.name, FICHIER_TABLES)
    if (!existsSync(fichier) || !statSync(fichier).isFile()) continue
    let tables = []
    try { tables = listerTables(fichier) } catch (e) { tables = [] }
    const label = nomDeTables(fichier)
    bases.push(label === null ? { id: PREFIXE_TABLES + entree.name.toLowerCase(), tables } : { id: PREFIXE_TABLES + entree.name.toLowerCase(), label, tables })
  }
  return bases
}

/** The columns every record table of Tables starts with (`id`, a revision count, who and when). */
const ENVELOPPE_TABLES = ['id', 'rev', 'created_by', 'created_at', 'modified_by', 'modified_at', 'deleted_by', 'deleted_at']

/** A record table of Tables (`r_<object>`, with the envelope): its columns read id, the object's own fields, then the rest of the envelope. Any other table is left as it is. */
function colonnesTables (nomTable, colonnes) {
  if (!nomTable.startsWith('r_') || !ENVELOPPE_TABLES.every((n) => colonnes.some((c) => c.name === n))) return colonnes
  const de = (n) => colonnes.find((c) => c.name === n)
  return [de('id'), ...colonnes.filter((c) => !ENVELOPPE_TABLES.includes(c.name)), ...ENVELOPPE_TABLES.slice(1).map(de)]
}

/** A Tables database keeps its records in `r_<object>` tables beside its bookkeeping (`catalog`, `meta`, `ops`, `views`, `ctl`): the records come first, so the charts read them. */
const ordreTables = (noms) => (['catalog', 'meta', 'ops'].every((n) => noms.includes(n)) ? [...noms.filter((n) => n.startsWith('r_')), ...noms.filter((n) => !n.startsWith('r_'))] : noms)

export function listerTables (dbPath) {
  const db = ouvrirLecture(dbPath)
  try {
    const noms = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).all().map((r) => r.name)
    return ordreTables(noms).map((nom) => ({
      nom,
      compte: db.prepare(`SELECT count(*) n FROM "${nom}"`).get().n,
    }))
  } finally { db.close() }
}

const corpsCreate = (sql) => {
  const debut = sql.indexOf('(')
  if (debut < 0) return []
  const parts = []
  let niveau = 0, courant = ''
  for (const c of sql.slice(debut + 1)) {
    if (c === '(') niveau++
    if (c === ')') { if (niveau === 0) { parts.push(courant); break } niveau-- }
    if (c === ',' && niveau === 0) { parts.push(courant); courant = '' } else courant += c
  }
  return parts.map((p) => p.trim()).filter(Boolean)
}

/**
 * A Tables database has no REFERENCES (a relation field holds a 26-character id): its links come from the relation fields of the latest catalog.
 * A table pointing at itself is marked on its column but not drawn as a link.
 */
function liensTables (db, tables) {
  const liens = []
  try {
    const noms = new Set(tables.map((t) => t.nom))
    if (!noms.has('catalog')) return liens
    const ligne = db.prepare('SELECT json FROM catalog ORDER BY version DESC LIMIT 1').get()
    const objets = ligne === undefined ? [] : (JSON.parse(ligne.json).objects || [])
    for (const objet of objets) {
      for (const champ of objet.fields || []) {
        if (champ.type !== 'relation' || typeof champ.to !== 'string') continue
        const enfant = 'r_' + objet.key
        const parent = 'r_' + champ.to
        if (noms.has(enfant) && noms.has(parent)) liens.push({ parent, enfant, colonne: champ.key })
      }
    }
  } catch (e) { /* a catalog this viewer cannot read: no links */ }
  return liens
}

/** Live schema: the real columns + the relations read from the REFERENCES (a Tables database: from its catalog). */
export function lireSchema (dbPath) {
  const db = ouvrirLecture(dbPath)
  try {
    const tables = []
    const relations = []
    for (const { nom, compte } of listerTables(dbPath)) {
      const info = db.prepare(`PRAGMA table_info("${nom}")`).all()
      const fks = db.prepare(`PRAGMA foreign_key_list("${nom}")`).all()
      const fkParColonne = {}
      for (const fk of fks) {
        fkParColonne[fk.from] = fk.table
        relations.push({ parent: fk.table, enfant: nom, colonne: fk.from })
      }
      tables.push({
        nom,
        compte,
        colonnes: colonnesTables(nom, info.map((c) => ({
          name: c.name,
          type: String(c.type || 'TEXT').toUpperCase(),
          pk: !!c.pk,
          fk: fkParColonne[c.name] !== undefined,
          fkVers: fkParColonne[c.name] || null,
          notnull: !!c.notnull,
        }))),
      })
    }
    for (const lien of liensTables(db, tables)) {
      const colonne = tables.find((t) => t.nom === lien.enfant).colonnes.find((c) => c.name === lien.colonne)
      if (colonne !== undefined) { colonne.fk = true; colonne.fkVers = lien.parent }
      if (lien.parent !== lien.enfant) relations.push(lien)
    }
    return { tables, relations }
  } finally { db.close() }
}

export function lireLignes (dbPath, table, limite) {
  if (!TABLE_VALIDE.test(table)) throw new Refus('bad-table', 'Invalid table name')
  const max = Math.min(Math.max(parseInt(limite, 10) || 50, 1), 500)
  const db = ouvrirLecture(dbPath)
  try {
    const info = db.prepare(`PRAGMA table_info("${table}")`).all()
    if (info.length === 0) throw new Refus('unknown-table', 'Unknown table: ' + table)
    return {
      colonnes: colonnesTables(table, info.map((c) => ({ name: c.name, type: String(c.type || 'TEXT').toUpperCase() }))),
      lignes: db.prepare(`SELECT * FROM "${table}" LIMIT ${max}`).all(),
      compte: db.prepare(`SELECT count(*) n FROM "${table}"`).get().n,
    }
  } finally { db.close() }
}

// Rows of a query sent to the page: 500 by default, 5 000 at most (a 200 000-row result used to be 54 MB of JSON
// and a million DOM nodes: the page froze for ~14 s). The real size is counted, up to a bound, so the page can say
// « the first 500 of 200 000 rows ».
export const LIMITE_REQUETE = 500
export const LIMITE_REQUETE_MAX = 5000
export const COMPTE_MAX = 1000000

/** Declared read-only: every write is refused before it reaches the database. */
export function executerSelect (dbPath, sql, limite) {
  const texte = String(sql || '').trim()
  if (texte === '') throw new Refus('empty-query', 'Empty query')
  if (!/^(SELECT|WITH|PRAGMA|EXPLAIN)\b/i.test(texte)) {
    throw new Refus('read-only', 'Read-only: SELECT / WITH / PRAGMA / EXPLAIN only')
  }
  if (/;\s*\S/.test(texte)) throw new Refus('one-statement', 'One statement at a time')
  const max = Math.min(Math.max(parseInt(limite, 10) || LIMITE_REQUETE, 1), LIMITE_REQUETE_MAX)
  const db = ouvrirLecture(dbPath)
  try {
    const stmt = db.prepare(texte)
    const lignes = []
    let total = 0
    let borne = false
    if (typeof stmt.iterate === 'function') {
      // Keep the first `max` rows and only count the others: nothing big stays in memory.
      for (const ligne of stmt.iterate()) {
        if (total < max) lignes.push(ligne)
        total += 1
        if (total >= COMPTE_MAX) { borne = true; break }
      }
    } else {
      // A Node without StatementSync.iterate: read everything, keep the first rows.
      const toutes = stmt.all()
      total = toutes.length
      lignes.push(...toutes.slice(0, max))
    }
    return {
      colonnes: lignes.length > 0 ? Object.keys(lignes[0]) : [],
      lignes,
      compte: lignes.length,
      total,
      tronque: total > lignes.length,
      borne,
    }
  } finally { db.close() }
}

// ── route mounting (webServer) ──────────────────────────────────────────────

const envoyer = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(obj))
}

const origineOK = (req) => {
  // Acceptance campaign 2026-10 (M-02/S-03): the EXACT host of the socket's real listener,
  // never a prefix (« localhost.evil.example » used to pass).
  const o = String(req.headers.origin || '')
  if (o === '') return true
  try {
    const u = new URL(o)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const port = (req.socket && typeof req.socket.localPort === 'number') ? ':' + req.socket.localPort : ''
    return (['127.0.0.1' + port, 'localhost' + port, '[::1]' + port].indexOf(u.host) >= 0 || kbTrusted(u.host))
  } catch { return false }
}

/** base=<id> → a controlled path, or null. A path typed by the page is never used. */
function resoudreBase (kybersHome, id, kybernosHome = null) {
  if (typeof id !== 'string' || !ID_VALIDE.test(id)) return null
  const fichier = join(kybersHome, id, FICHIER)
  if (existsSync(fichier) && statSync(fichier).isFile()) return fichier
  if (typeof kybernosHome === 'string' && id.startsWith(PREFIXE_KYBERNOS)) {
    const dossier = id.slice(PREFIXE_KYBERNOS.length)
    if (!ID_VALIDE.test(dossier)) return null
    const f = join(kybernosHome, dossier, FICHIER)
    return existsSync(f) && statSync(f).isFile() ? f : null
  }
  const tables = dossierTables(kybernosHome, id)
  return tables !== null && existsSync(tables) && statSync(tables).isFile() ? tables : null
}

export function monterRoutes (webServerSvc, opts = {}) {
  webServerSvc = kbFenced(webServerSvc)
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  const kybersHome = opts.kybersHome || join(dshHome, 'kybers')
  // The second root is the plugins' own folder. A caller that names only `kybersHome` (a test) gets no second root: it never reads a real home.
  const kybernosHome = opts.kybernosHome !== undefined ? opts.kybernosHome : (opts.kybersHome === undefined ? join(dshHome, 'kybernos') : null)

  const lecture = (path, traiter) => webServerSvc.register({ kind: 'exact', path, handler: async (req, res) => {
    if (req.method !== 'GET') { res.writeHead(405); res.end('GET only'); return }
    if (!origineOK(req)) { res.writeHead(403); res.end('origin refused'); return }
    try {
      const u = new URL(req.url, 'http://127.0.0.1')
      envoyer(res, 200, await traiter(u.searchParams))
    } catch (e) {
      envoyer(res, 400, e instanceof Refus ? { erreur: e.message, code: e.code } : { erreur: String(e && e.message ? e.message : e) })
    }
  } })

  lecture('/dsh-db-viewer/bases', () => ({ bases: listerBases(kybersHome, kybernosHome) }))

  lecture('/dsh-db-viewer/schema', (p) => {
    const fichier = resoudreBase(kybersHome, p.get('base'), kybernosHome)
    if (fichier === null) throw new Refus('unknown-base', 'Unknown database')
    return lireSchema(fichier)
  })

  lecture('/dsh-db-viewer/rows', (p) => {
    const fichier = resoudreBase(kybersHome, p.get('base'), kybernosHome)
    if (fichier === null) throw new Refus('unknown-base', 'Unknown database')
    return lireLignes(fichier, p.get('table') || '', p.get('limit'))
  })

  lecture('/dsh-db-viewer/query', (p) => {
    const fichier = resoudreBase(kybersHome, p.get('base'), kybernosHome)
    if (fichier === null) throw new Refus('unknown-base', 'Unknown database')
    return executerSelect(fichier, p.get('sql') || '', p.get('limit'))
  })

  if (opts.silencieux !== true) {
    console.log('[dsh-db-viewer] webServer routes /dsh-db-viewer/* registered (bases, schema, rows, query)')
  }
  return { kybersHome, kybernosHome }
}

export function apply (ctx) {
  if (ctx !== null && ctx !== undefined && typeof ctx.effect === 'function') ctx.effect(() => kbRetirerRoutes, 'dsh-db-viewer: routes')
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  const kybersHome = join(dshHome, 'kybers')
  const kybernosHome = join(dshHome, 'kybernos')
  const demarrer = (hostCtx) => {
    try {
      // `get`, not `hostCtx.webServer`: called with the plugin's own context when the service is already there, where a property read throws.
      monterRoutes(hostCtx.get('webServer'), { ctx: hostCtx, kybersHome, kybernosHome })
    } catch (e) {
      console.error('[dsh-db-viewer] cannot mount the routes', e)
    }
  }
  if (ctx.get('webServer') !== undefined) demarrer(ctx)
  else ctx.inject(['webServer'], demarrer)
}
