// backup.mjs — the restore drill of the plan's RPO/RTO numbers. `VACUUM INTO` snapshots the mini
// base consistently even while the app writes (WAL); restore puts the snapshot back and the drill
// measures both durations, so the numbers are real instead of promised.
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const snapshotBase = (dir, sortie = null) => {
  const base = join(dir, 'donnees.sqlite')
  if (existsSync(base) !== true) return { ok: false, error: 'no donnees.sqlite in this app' }
  const cible = sortie ?? join(dir, '.deploy', 'backup-' + new Date().toISOString().replace(/[:.]/g, '-') + '.sqlite')
  const debut = Date.now()
  try {
    mkdirSync(join(cible, '..'), { recursive: true })
    const db = new DatabaseSync(base)
    db.exec("VACUUM INTO '" + cible.replace(/'/g, "''") + "'")
    db.close()
    return { ok: true, fichier: cible, ms: Date.now() - debut }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 120) }
  }
}

/** Restore a snapshot over the app's base. The app must be stopped — the drill asserts it. */
export function restoreBase (dir, fichier) {
  if (existsSync(fichier) !== true) return { ok: false, error: 'snapshot not found' }
  const base = join(dir, 'donnees.sqlite')
  const debut = Date.now()
  try {
    // sanity: the snapshot must open and hold _migrations before it replaces anything
    const db = new DatabaseSync(fichier)
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)
    db.close()
    if (tables.includes('_migrations') !== true) return { ok: false, error: 'the snapshot is not an app base' }
    rmSync(base, { force: true })
    rmSync(base + '-wal', { force: true })
    rmSync(base + '-shm', { force: true })
    copyFileSync(fichier, base)
    return { ok: true, ms: Date.now() - debut }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 120) }
  }
}
