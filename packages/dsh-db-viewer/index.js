// ═══════════════════════════════════════════════════════════════════════════
// dsh-db-viewer — host half.
//
// Serves the right sidebar panel a read of the small SQLite databases of the kybers
// (`~/.dsh/kybers/<id>/donnees.sqlite`, checked by `crm.cjs`). FOUR read-ONLY routes —
// no write exists here, by design: the database is filled by the kyber (crm.cjs exec),
// not by the page.
//
//   GET /dsh-db-viewer/bases            → [{ id, tables: [{nom, compte}] }]
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
  return new Proxy(service, { get: (target, key) => (key === 'register' ? (route) => target.register(fence(route)) : (typeof target[key] === 'function' ? target[key].bind(target) : target[key])) })
}

export const name = 'dsh-db-viewer'

const ID_VALIDE = /^[a-z0-9][a-z0-9-]*$/
const TABLE_VALIDE = /^[A-Za-z_][A-Za-z0-9_]*$/

// ── pure functions ──────────────────────────────────────────────────────────

/** The databases found: one kyber = one folder = at most one `donnees.sqlite`. */
export function listerBases (kybersHome) {
  if (!existsSync(kybersHome)) return []
  const bases = []
  for (const entree of readdirSync(kybersHome, { withFileTypes: true })) {
    if (!entree.isDirectory() || !ID_VALIDE.test(entree.name)) continue
    const fichier = join(kybersHome, entree.name, 'donnees.sqlite')
    if (!existsSync(fichier) || !statSync(fichier).isFile()) continue
    let tables = []
    try { tables = listerTables(fichier) } catch (e) { tables = [] }
    bases.push({ id: entree.name, tables })
  }
  return bases.sort((a, b) => (a.id < b.id ? -1 : 1))
}

export function listerTables (dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const noms = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).all().map((r) => r.name)
    return noms.map((nom) => ({
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

/** Live schema: the real columns + the relations read from the REFERENCES. */
export function lireSchema (dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true })
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
        colonnes: info.map((c) => ({
          name: c.name,
          type: String(c.type || 'TEXT').toUpperCase(),
          pk: !!c.pk,
          fk: fkParColonne[c.name] !== undefined,
          fkVers: fkParColonne[c.name] || null,
          notnull: !!c.notnull,
        })),
      })
    }
    return { tables, relations }
  } finally { db.close() }
}

export function lireLignes (dbPath, table, limite) {
  if (!TABLE_VALIDE.test(table)) throw new Error('nom de table invalide')
  const max = Math.min(Math.max(parseInt(limite, 10) || 50, 1), 500)
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const info = db.prepare(`PRAGMA table_info("${table}")`).all()
    if (info.length === 0) throw new Error('table inconnue : ' + table)
    return {
      colonnes: info.map((c) => ({ name: c.name, type: String(c.type || 'TEXT').toUpperCase() })),
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
  if (texte === '') throw new Error('requête vide')
  if (!/^(SELECT|WITH|PRAGMA|EXPLAIN)\b/i.test(texte)) {
    throw new Error('lecture seule : SELECT / WITH / PRAGMA uniquement')
  }
  if (/;\s*\S/.test(texte)) throw new Error('une seule requête à la fois')
  const max = Math.min(Math.max(parseInt(limite, 10) || LIMITE_REQUETE, 1), LIMITE_REQUETE_MAX)
  const db = new DatabaseSync(dbPath, { readOnly: true })
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
function resoudreBase (kybersHome, id) {
  if (typeof id !== 'string' || !ID_VALIDE.test(id)) return null
  const fichier = join(kybersHome, id, 'donnees.sqlite')
  return existsSync(fichier) && statSync(fichier).isFile() ? fichier : null
}

export function monterRoutes (webServerSvc, opts = {}) {
  webServerSvc = kbFenced(webServerSvc)
  const kybersHome = opts.kybersHome || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'kybers')

  const lecture = (path, traiter) => webServerSvc.register({ kind: 'exact', path, handler: async (req, res) => {
    if (req.method !== 'GET') { res.writeHead(405); res.end('GET uniquement'); return }
    if (!origineOK(req)) { res.writeHead(403); res.end('origine refusee'); return }
    try {
      const u = new URL(req.url, 'http://127.0.0.1')
      envoyer(res, 200, await traiter(u.searchParams))
    } catch (e) {
      envoyer(res, 400, { erreur: String(e && e.message ? e.message : e) })
    }
  } })

  lecture('/dsh-db-viewer/bases', () => ({ bases: listerBases(kybersHome) }))

  lecture('/dsh-db-viewer/schema', (p) => {
    const fichier = resoudreBase(kybersHome, p.get('base'))
    if (fichier === null) throw new Error('base inconnue')
    return lireSchema(fichier)
  })

  lecture('/dsh-db-viewer/rows', (p) => {
    const fichier = resoudreBase(kybersHome, p.get('base'))
    if (fichier === null) throw new Error('base inconnue')
    return lireLignes(fichier, p.get('table') || '', p.get('limit'))
  })

  lecture('/dsh-db-viewer/query', (p) => {
    const fichier = resoudreBase(kybersHome, p.get('base'))
    if (fichier === null) throw new Error('base inconnue')
    return executerSelect(fichier, p.get('sql') || '', p.get('limit'))
  })

  if (opts.silencieux !== true) {
    console.log('[dsh-db-viewer] routes webServer /dsh-db-viewer/* enregistrees (bases, schema, rows, query)')
  }
  return { kybersHome }
}

export function apply (ctx) {
  const kybersHome = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'kybers')
  const demarrer = (hostCtx) => {
    try {
      monterRoutes(hostCtx.webServer, { ctx: hostCtx, kybersHome })
    } catch (e) {
      console.error('[dsh-db-viewer] montage des routes impossible', e)
    }
  }
  if (ctx.get('webServer') !== undefined) demarrer(ctx)
  else ctx.inject(['webServer'], demarrer)
}
