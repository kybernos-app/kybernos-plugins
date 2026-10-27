// db.js — the mini base of the app: one SQLite file beside this folder's brief, opened with
// node:sqlite, and a tiny versioned migration runner (foundation piece: every schema change is a
// numbered file in migrations/, applied once and recorded in _migrations).
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const BASE = path.join(__dirname, 'donnees.sqlite')
const MIGRATIONS = path.join(__dirname, 'migrations')

let db = null

const open = () => {
  if (db !== null) return db
  db = new DatabaseSync(BASE)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applique_le TEXT NOT NULL)')
  const faites = new Set(db.prepare('SELECT id FROM _migrations').all().map((r) => r.id))
  const fichiers = fs.existsSync(MIGRATIONS) === true ? fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort() : []
  for (const fichier of fichiers) {
    const id = fichier.replace(/\.sql$/, '')
    if (faites.has(id) === true) continue
    db.exec('BEGIN')
    try {
      db.exec(fs.readFileSync(path.join(MIGRATIONS, fichier), 'utf8'))
      db.prepare('INSERT INTO _migrations (id, applique_le) VALUES (?, ?)').run(id, new Date().toISOString())
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw new Error('migration ' + id + ' failed: ' + String((e && e.message) || e).slice(0, 120))
    }
  }
  return db
}

exports.open = open
exports.close = () => { if (db !== null) { try { db.close() } catch (e) { /* already closed */ } db = null } }
