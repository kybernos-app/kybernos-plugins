// ── The installation lock ───────────────────────────────────────────────────────────────────────────────────────────────────
// One installer at a time, and DSH knows it even after DSH itself was killed.
//
// The Suite panel launches the lifecycle robot (scripts/dsh-lifecycle.mjs) as a child process. That the robot is running used to be a boolean in the memory of
// the hub: after a `kill -9` of DSH in the middle of an update, the robot kept running as an orphan (its parent gone), the restarted DSH said "idle" and accepted a
// second update, and two robots wrote the same profile (recette L3-85). The fact now lives on disk, in `<DSH home>/lifecycle/install.lock`:
//
//   { "v": 1, "pid": 4242, "debut": 1761400000000, "genre": "suite", "source": "/tmp/kybernos-update-x/contenu" }
//
// · WRITTEN BY THE ROBOT, with its own pid, when it starts an order that changes the profile (install, upgrade, bootstrap, rollback, uninstall; not --dry), and removed
//   when it ends. Whoever starts it (the Suite panel, ./kybernos-update by hand, a terminal) is covered the same way, and the robot refuses to start beside a live holder.
//   `genre` is `install`, `suite` (an upgrade from an archive), `engine` (an upgrade to a DSH version), `bootstrap`, `rollback` or `uninstall`; `source` is the folder the
//   robot was told to install from (a temp folder, for the Suite update), kept so that the clean-up of temp folders never takes it from under a running installer.
// · READ BY THE HUB, which treats the installer as running while the pid is alive (and, to survive pid reuse, the lock is younger than `AGE_MAX_MS`). A lock whose pid is
//   gone, whose age is over the limit, or which cannot be read is STALE: reading it removes it (only if the file is still the one that was judged).
// · TAKEN EXCLUSIVELY: the record is written to a temp file and hard-linked to the final name, which fails if the name exists, so two robots starting together cannot both win
//   and a reader never sees a half-written record. A file system with no hard links falls back to an exclusive create.
//
// Bundles read on their own: scripts/dsh-lifecycle.mjs imports this file from the hub bundle (it already imports boot-guard.mjs from it), the hub imports it as a neighbour.
// Every function takes its I/O as options so that test-install-lock.mjs plays it with a stand-in process.
import { randomBytes } from 'node:crypto'
import { linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const NOM_VERROU = 'install.lock'
/** A live pid older than this is taken for a reused pid: the longest honest run is the robot's own 20-minute limit when the hub starts it. */
export const AGE_MAX_MS = 30 * 60 * 1000

export const fichierVerrou = (dshHome) => join(dshHome, 'lifecycle', NOM_VERROU)

/** Is a process with this pid running? A pid that belongs to someone else (EPERM) is running. */
export const pidVivant = (pid, tuer = process.kill) => {
  if (Number.isInteger(pid) === false || pid <= 0) return false
  try { tuer(pid, 0); return true } catch (e) { return e !== null && typeof e === 'object' && e.code === 'EPERM' }
}

/** Pure. `{ etat: 'tenu' }` when a live installer holds the record, else `{ etat: 'perime', raison }` with `raison` one of illisible, pid-mort, trop-ancien. */
export function juger (verrou, { vivant = pidVivant, maintenant = Date.now, ageMax = AGE_MAX_MS } = {}) {
  if (verrou === null || typeof verrou !== 'object' || Number.isInteger(verrou.pid) === false || verrou.pid <= 0 || Number.isFinite(verrou.debut) === false) return { etat: 'perime', raison: 'illisible' }
  if (vivant(verrou.pid) !== true) return { etat: 'perime', raison: 'pid-mort' }
  if (maintenant() - verrou.debut > ageMax) return { etat: 'perime', raison: 'trop-ancien' }
  return { etat: 'tenu' }
}

const lireTexte = (fichier) => readFileSync(fichier, 'utf8')
const retirerFichier = (fichier) => rmSync(fichier, { force: true })

/**
 * The state of the lock. `{ etat: 'libre' }` when there is none, or when the one found was stale (then it is removed, and `nettoye` says why);
 * `{ etat: 'tenu', verrou }` when a live installer holds it. Never throws.
 */
export function lireVerrou ({ fichier, lire = lireTexte, retirer = retirerFichier, vivant, maintenant, ageMax } = {}) {
  let texte
  try { texte = lire(fichier) } catch (e) { return { etat: 'libre' } }
  let verrou = null
  try { verrou = JSON.parse(texte) } catch (e) { verrou = null }
  const verdict = juger(verrou, { vivant, maintenant, ageMax })
  if (verdict.etat === 'tenu') return { etat: 'tenu', verrou }
  // Stale. Another robot may have taken the name since this one was read: remove it only if it is still the record that was judged.
  try { if (lire(fichier) === texte) retirer(fichier) } catch (e) { /* gone already, or not removable: the next reader judges again */ }
  return { etat: 'libre', nettoye: verdict.raison }
}

/**
 * Takes the lock for `pid` (this process by default). `{ ok: true }` when taken (or already held by `pid`); `{ ok: false, erreur: 'occupe', verrou }` when another live
 * installer holds it; `{ ok: true, sansVerrou: true, detail }` when the folder cannot be written at all (a read-only profile): the caller goes on, as it did before the
 * lock existed, and says so. A stale record is removed and replaced.
 */
export function prendreVerrou ({ fichier, genre, source = null, pid = process.pid, maintenant = Date.now, vivant, ageMax, lire, retirer } = {}) {
  const contenu = JSON.stringify({ v: 1, pid, debut: maintenant(), genre, source }) + '\n'
  const tmp = fichier + '.tmp-' + pid + '-' + randomBytes(4).toString('hex')
  try {
    mkdirSync(dirname(fichier), { recursive: true })
    writeFileSync(tmp, contenu)
    // 'ok' | 'existe' | 'erreur'
    const creer = () => {
      try { linkSync(tmp, fichier); return 'ok' } catch (e) {
        if (e !== null && typeof e === 'object' && e.code === 'EEXIST') return 'existe'
        try { writeFileSync(fichier, contenu, { flag: 'wx' }); return 'ok' } catch (e2) { return e2 !== null && typeof e2 === 'object' && e2.code === 'EEXIST' ? 'existe' : 'erreur' }
      }
    }
    for (let essai = 0; essai < 3; essai += 1) {
      const fait = creer()
      if (fait === 'ok') return { ok: true }
      if (fait === 'erreur') return { ok: true, sansVerrou: true, detail: 'the lock file cannot be created in ' + dirname(fichier) }
      const actuel = lireVerrou({ fichier, vivant, maintenant, ageMax, lire, retirer })
      if (actuel.etat === 'tenu') return actuel.verrou.pid === pid ? { ok: true, deja: true } : { ok: false, erreur: 'occupe', verrou: actuel.verrou }
    }
    return { ok: false, erreur: 'occupe', verrou: null }
  } catch (e) {
    return { ok: true, sansVerrou: true, detail: String(e && e.message ? e.message : e) }
  } finally { try { rmSync(tmp, { force: true }) } catch (e) { /* a temp file left in the lifecycle folder is harmless */ } }
}

/** Removes the lock if it is `pid`'s (this process by default); a lock someone else took since is left alone. */
export function libererVerrou ({ fichier, pid = process.pid } = {}) {
  try {
    const verrou = JSON.parse(readFileSync(fichier, 'utf8'))
    if (verrou !== null && typeof verrou === 'object' && verrou.pid === pid) rmSync(fichier, { force: true })
  } catch (e) { /* no lock, or not readable: nothing of ours to remove */ }
}
