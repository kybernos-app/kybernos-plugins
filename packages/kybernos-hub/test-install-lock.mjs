// The installation lock and the sweep of the temp folders a killed update leaves (recette 2026-10-25, fix 24: L3-85).
//
// The robot of the Suite panel is a child process that survives the death of DSH. Its lock lives on disk, with its pid and its start time, so that a restarted DSH still
// knows an installer runs, and a lock whose process is gone is recognised as stale and removed. Nothing here installs anything: the « installer » is a harmless stand-in,
// a node process that waits, and the folders are throw-away folders.
//   node packages/kybernos-hub/test-install-lock.mjs
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AGE_MAX_MS, fichierVerrou, juger, libererVerrou, lireVerrou, pidVivant, prendreVerrou } from './install-lock.mjs'
import { suiteDeps } from './index.js'
import { PREFIXE_TEMP, balayerOrphelins } from './telechargement.mjs'

let echecs = 0
let total = 0
const ok = (nom, cond, detail) => { total += 1; if (cond) console.log('  ✓ ' + nom); else { echecs += 1; console.log('  ✗ ' + nom + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 240) : '')) } }

/** A harmless stand-in for an installer: a process that does nothing until it is killed. */
const standIn = async () => {
  const enfant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  await new Promise((resoudre) => enfant.once('spawn', resoudre))
  return enfant
}
/** `kill -9`, and wait until the process is really gone. */
const tuer = (enfant) => new Promise((resoudre) => { enfant.once('exit', resoudre); enfant.kill('SIGKILL') })
const base = mkdtempSync(join(tmpdir(), 'kb-install-lock-'))
let n = 0
const dossier = () => { n += 1; const d = join(base, 'dsh-' + n); mkdirSync(d, { recursive: true }); return d }

console.log('judging a record (pure)')
{
  const vivants = new Set([100])
  const v = (verrou, over = {}) => juger(verrou, { vivant: (pid) => vivants.has(pid), maintenant: () => 1_000_000, ...over })
  ok('a live pid, started a minute ago: held', v({ pid: 100, debut: 1_000_000 - 60_000 }).etat === 'tenu')
  ok('a pid that is gone: stale (pid-mort)', v({ pid: 101, debut: 1_000_000 }).raison === 'pid-mort' && v({ pid: 101, debut: 1_000_000 }).etat === 'perime')
  ok('a live pid older than the age limit is taken for a reused pid: stale (trop-ancien)', v({ pid: 100, debut: 1_000_000 - AGE_MAX_MS - 1 }).raison === 'trop-ancien' && v({ pid: 100, debut: 1_000_000 - AGE_MAX_MS }).etat === 'tenu')
  ok('a start time in the future (a clock that stepped back) is not stale by age', v({ pid: 100, debut: 5_000_000 }).etat === 'tenu')
  ok('a record that is not a record is stale (illisible)', [null, 'x', 42, {}, { pid: 100 }, { debut: 1 }, { pid: '100', debut: 1 }, { pid: -1, debut: 1 }, { pid: 1.5, debut: 1 }].every((x) => v(x).raison === 'illisible'))
  ok('pidVivant: this process is alive, a huge pid is not, EPERM counts as alive, junk is not a pid', pidVivant(process.pid) === true && pidVivant(2 ** 30) === false && pidVivant(7, () => { throw Object.assign(new Error('x'), { code: 'EPERM' }) }) === true && [0, -3, NaN, '5', null].every((x) => pidVivant(x) === false))
}

console.log('the lock on disk, with a stand-in installer')
{
  const home = dossier()
  const fichier = fichierVerrou(home)
  ok('the lock lives in <DSH home>/lifecycle/install.lock', fichier === join(home, 'lifecycle', 'install.lock'))
  ok('no file: free', lireVerrou({ fichier }).etat === 'libre')

  const installateur = await standIn()
  let r = prendreVerrou({ fichier, genre: 'suite', source: '/tmp/kybernos-update-a/contenu', pid: installateur.pid })
  ok('the installer takes the lock with its pid, its start time, its kind and its source', r.ok === true && existsSync(fichier))
  const ecrit = JSON.parse(readFileSync(fichier, 'utf8'))
  ok('…the record says so', ecrit.v === 1 && ecrit.pid === installateur.pid && typeof ecrit.debut === 'number' && Math.abs(Date.now() - ecrit.debut) < 5000 && ecrit.genre === 'suite' && ecrit.source === '/tmp/kybernos-update-a/contenu', ecrit)
  ok('…no temp file is left beside it', readdirSync(join(home, 'lifecycle')).join() === 'install.lock', readdirSync(join(home, 'lifecycle')))

  const lu = lireVerrou({ fichier })
  ok('a live installer: held, and reading does not touch the file', lu.etat === 'tenu' && lu.verrou.pid === installateur.pid && existsSync(fichier))
  r = prendreVerrou({ fichier, genre: 'install', pid: process.pid })
  ok('a second installer is refused while the first lives, and told who holds it', r.ok === false && r.erreur === 'occupe' && r.verrou.pid === installateur.pid && r.verrou.genre === 'suite', r)
  ok('…the lock is still the first one’s', JSON.parse(readFileSync(fichier, 'utf8')).pid === installateur.pid)
  r = prendreVerrou({ fichier, genre: 'suite', pid: installateur.pid })
  ok('the holder asking again is not a conflict', r.ok === true && r.deja === true)
  libererVerrou({ fichier, pid: process.pid })
  ok('someone else cannot release it', existsSync(fichier))

  await tuer(installateur) // kill -9: no exit handler runs, the lock stays on disk
  ok('after the installer is killed the lock is still on disk (nothing removed it)', existsSync(fichier))
  const apres = lireVerrou({ fichier })
  ok('…and reading it finds it stale: free, removed, and says why', apres.etat === 'libre' && apres.nettoye === 'pid-mort' && existsSync(fichier) === false, apres)

  // a new installer takes over a stale lock
  const mort = await standIn()
  prendreVerrou({ fichier, genre: 'install', pid: mort.pid })
  await tuer(mort)
  r = prendreVerrou({ fichier, genre: 'upgrade', pid: process.pid })
  ok('a stale lock is replaced by the new installer’s', r.ok === true && JSON.parse(readFileSync(fichier, 'utf8')).pid === process.pid)
  libererVerrou({ fichier })
  ok('the holder releases its own lock', existsSync(fichier) === false)

  mkdirSync(join(home, 'lifecycle'), { recursive: true })
  writeFileSync(fichier, '{"pid": 12')
  ok('a half-written or corrupt record is stale, and is removed', lireVerrou({ fichier }).nettoye === 'illisible' && existsSync(fichier) === false)
  writeFileSync(fichier, '')
  ok('an empty file too', lireVerrou({ fichier }).etat === 'libre' && existsSync(fichier) === false)

  const vieux = await standIn()
  writeFileSync(fichier, JSON.stringify({ v: 1, pid: vieux.pid, debut: Date.now() - AGE_MAX_MS - 60_000, genre: 'suite' }))
  ok('a live pid with a start time past the age limit is stale (a reused pid must not block updates for ever)', lireVerrou({ fichier }).nettoye === 'trop-ancien' && existsSync(fichier) === false)
  await tuer(vieux)

  // two robots starting at the same moment: exactly one wins
  const a = await standIn()
  const b = await standIn()
  const premier = prendreVerrou({ fichier, genre: 'install', pid: a.pid })
  const second = prendreVerrou({ fichier, genre: 'install', pid: b.pid })
  ok('two installers starting together: one takes it, the other is told it is busy', premier.ok === true && second.ok === false && second.verrou.pid === a.pid)
  await tuer(a)
  await tuer(b)
  rmSync(fichier, { force: true })

  if (typeof process.getuid === 'function' && process.getuid() !== 0 && process.platform !== 'win32') {
    const ferme = dossier()
    mkdirSync(join(ferme, 'lifecycle'))
    chmodSync(join(ferme, 'lifecycle'), 0o500)
    const rs = prendreVerrou({ fichier: fichierVerrou(ferme), genre: 'install' })
    chmodSync(join(ferme, 'lifecycle'), 0o700)
    ok('a folder that cannot be written does not stop an install: it goes on without the lock and says so', rs.ok === true && rs.sansVerrou === true && typeof rs.detail === 'string', rs)
  } else console.log('SKIPPED: the read-only folder case of the installation lock (running as root, or Windows)')
}

console.log('the temp folders a killed update leaves')
{
  const tmp = mkdtempSync(join(base, 'tmp-'))
  const marqueur = (d, pid) => writeFileSync(join(d, '.proprietaire'), JSON.stringify({ pid, debut: Date.now() }) + '\n')
  const faire = (nom) => { const d = join(tmp, nom); mkdirSync(join(d, 'contenu', 'scripts'), { recursive: true }); writeFileSync(join(d, 'archive.tar.gz'), 'x'.repeat(1000)); return d }
  const vivant = await standIn()
  const mort = await standIn()
  const pidMort = mort.pid
  await tuer(mort)
  const ancien = (d) => { const t = new Date(Date.now() - 3 * 3600 * 1000); utimesSync(d, t, t) }

  const orphelin = faire(PREFIXE_TEMP + 'AAA'); marqueur(orphelin, pidMort)
  const encours = faire(PREFIXE_TEMP + 'BBB'); marqueur(encours, vivant.pid)
  const sansMarqueurVieux = faire(PREFIXE_TEMP + 'CCC'); ancien(sansMarqueurVieux)
  const sansMarqueurRecent = faire(PREFIXE_TEMP + 'DDD')
  const sousInstallateur = faire(PREFIXE_TEMP + 'EEE'); marqueur(sousInstallateur, pidMort)
  const autre = join(tmp, 'other-folder'); mkdirSync(autre); marqueur(autre, pidMort)
  writeFileSync(join(tmp, PREFIXE_TEMP + 'file'), 'not a folder')

  const verrou = { pid: vivant.pid, debut: Date.now(), genre: 'suite', source: join(sousInstallateur, 'contenu') }
  const r = balayerOrphelins({ tmp, verrou })
  ok('a folder whose maker (a killed DSH) is gone is removed, with its 300 MB', r.retires.includes(PREFIXE_TEMP + 'AAA') && existsSync(orphelin) === false, r)
  ok('a folder whose maker is alive (another DSH of this machine, downloading now) is kept', existsSync(encours) && r.gardes.includes(PREFIXE_TEMP + 'BBB'))
  ok('a folder an installer still runs from is kept even though its maker is dead', existsSync(sousInstallateur) && r.gardes.includes(PREFIXE_TEMP + 'EEE'))
  ok('a folder with no marker is removed once it is old, kept while it is young', existsSync(sansMarqueurVieux) === false && existsSync(sansMarqueurRecent))
  ok('what is not a kybernos-update folder is never touched (another name, a plain file)', existsSync(autre) && existsSync(join(tmp, PREFIXE_TEMP + 'file')))
  const encore = balayerOrphelins({ tmp, verrou: null })
  ok('with the installer gone, its folder goes at the next sweep; the live maker’s stays', encore.retires.join() === PREFIXE_TEMP + 'EEE' && existsSync(encours))
  ok('a temp folder that does not exist, or a failing removal, never throws', balayerOrphelins({ tmp: join(base, 'nope') }).retires.length === 0 && balayerOrphelins({ tmp, retirer: () => { throw new Error('EBUSY') } }).retires.length === 0)
  await tuer(vivant)
}

console.log('the real wiring of the hub (a throw-away DSH home and temp folder)')
{
  const home = dossier()
  const tmp = mkdtempSync(join(base, 'tmp-wiring-'))
  const gardeTmp = process.env.TMPDIR
  process.env.TMPDIR = tmp // os.tmpdir() reads it at each call
  try {
    const d = suiteDeps(home, { etat: () => ({}) })
    ok('no lock: free', d.lireVerrou().etat === 'libre')
    const installateur = await standIn()
    prendreVerrou({ fichier: fichierVerrou(home), genre: 'engine', pid: installateur.pid })
    ok('the lock the robot writes in the DSH home is what the hub reads', d.lireVerrou().etat === 'tenu' && d.lireVerrou().verrou.genre === 'engine')
    const orphelin = join(tmp, PREFIXE_TEMP + 'ZZZ')
    mkdirSync(orphelin)
    const mort = await standIn()
    const pidMort = mort.pid
    await tuer(mort)
    writeFileSync(join(orphelin, '.proprietaire'), JSON.stringify({ pid: pidMort, debut: Date.now() }))
    const enCours = join(tmp, PREFIXE_TEMP + 'YYY')
    mkdirSync(enCours)
    writeFileSync(join(enCours, '.proprietaire'), JSON.stringify({ pid: pidMort, debut: Date.now() }))
    rmSync(fichierVerrou(home), { force: true })
    prendreVerrou({ fichier: fichierVerrou(home), genre: 'suite', source: join(enCours, 'contenu'), pid: installateur.pid })
    const r = d.balayer()
    ok('balayer() sweeps the orphan of a dead DSH in the OS temp folder and keeps the folder the live installer runs from', r.retires.join() === PREFIXE_TEMP + 'ZZZ' && existsSync(orphelin) === false && existsSync(enCours), r)
    await tuer(installateur)
    ok('once the installer is gone its folder goes at the next sweep', d.balayer().retires.join() === PREFIXE_TEMP + 'YYY' && existsSync(enCours) === false)
  } finally { if (gardeTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = gardeTmp }
}

rmSync(base, { recursive: true, force: true })
console.log('\nINSTALL LOCK — ' + total + ' assertions, ' + echecs + ' failure(s)')
process.exit(echecs === 0 ? 0 : 1)
