// ═══════════════════════════════════════════════════════════════════════════
// dsh-db-viewer — moitié hôte.
//
// Sert au panneau sidebar droite la lecture des petites bases SQLite des
// kybers (`~/.dsh/kybers/<id>/donnees.sqlite`, contrôles `crm.cjs`). QUATRE
// routes en lecture SEULE — aucune écriture n'existe ici, par conception : la
// base se remplit par le kyber (crm.cjs exec), pas par la page.
//
//   GET /dsh-db-viewer/bases            → [{ id, tables: [{nom, compte}] }]
//   GET /dsh-db-viewer/schema?base=     → tables, colonnes, relations
//   GET /dsh-db-viewer/rows?base=&table=&limit=
//   GET /dsh-db-viewer/query?base=&sql= → SELECT/WITH/PRAGMA uniquement
//
// Les fonctions pures sont exportées pour le harnais test/test-host.mjs.
// ═══════════════════════════════════════════════════════════════════════════
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
// Hosted instance: also accept the authorities declared to DSH with --trusted-host. The core bundle publishes the predicate
// (kybernos-plugin/trusted-authority.mjs); absent or failing, it answers false and the guard stays loopback-only.
const kbTrusted = (host) => { try { const f = globalThis[Symbol.for('kybernos.trustedAuthority')]; return typeof f === 'function' && f(host) === true } catch (e) { return false } }

export const name = 'dsh-db-viewer'

const ID_VALIDE = /^[a-z0-9][a-z0-9-]*$/
const TABLE_VALIDE = /^[A-Za-z_][A-Za-z0-9_]*$/

// ── fonctions pures ─────────────────────────────────────────────────────────

/** Les bases trouvées : un kyber = un dossier = au plus une `donnees.sqlite`. */
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

/** Schéma vivant : colonnes réelles + relations lues dans les REFERENCES. */
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

/** Lecture seule DECLARÉE : toute écriture est refusée avant la base. */
export function executerSelect (dbPath, sql) {
  const texte = String(sql || '').trim()
  if (texte === '') throw new Error('requête vide')
  if (!/^(SELECT|WITH|PRAGMA|EXPLAIN)\b/i.test(texte)) {
    throw new Error('lecture seule : SELECT / WITH / PRAGMA uniquement')
  }
  if (/;\s*\S/.test(texte)) throw new Error('une seule requête à la fois')
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const lignes = db.prepare(texte).all()
    return {
      colonnes: lignes.length > 0 ? Object.keys(lignes[0]) : [],
      lignes,
      compte: lignes.length,
    }
  } finally { db.close() }
}

// ── montage des routes (webServer) ─────────────────────────────────────────

const envoyer = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(obj))
}

const origineOK = (req) => {
  // Recette 2026-10 (M-02/S-03) : hôte EXACT de l'écoute réelle du socket,
  // jamais un préfixe (« localhost.evil.example » passait).
  const o = String(req.headers.origin || '')
  if (o === '') return true
  try {
    const u = new URL(o)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const port = (req.socket && typeof req.socket.localPort === 'number') ? ':' + req.socket.localPort : ''
    return (['127.0.0.1' + port, 'localhost' + port, '[::1]' + port].indexOf(u.host) >= 0 || kbTrusted(u.host))
  } catch { return false }
}

/** base=<id> → chemin contrôlé, ou null. Jamais de chemin entré par la page. */
function resoudreBase (kybersHome, id) {
  if (typeof id !== 'string' || !ID_VALIDE.test(id)) return null
  const fichier = join(kybersHome, id, 'donnees.sqlite')
  return existsSync(fichier) && statSync(fichier).isFile() ? fichier : null
}

export function monterRoutes (webServerSvc, opts = {}) {
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
    return executerSelect(fichier, p.get('sql') || '')
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
