// ── DSH that starts by itself ───────────────────────────────────────────────
//
// After a reboot or a crash nothing started `dsh web` again, and the page the browser had kept showed the engine's « Failed to load
// plugins » card (measured 2026-10-26: the server was simply not running). This module puts DSH under the operating system's own
// supervisor, for the current user only, and only when the person said yes:
//
//   macOS  → a LaunchAgent (RunAtLoad + KeepAlive: back at login, back after a crash)
//   Linux  → a `systemd --user` unit (Restart=always)
//   Windows → not installed: the Task Scheduler plan of `plateforme.mjs` was written from the documentation and never run, so we
//             say so instead of writing a task nobody has seen work.
//
// The decision and the I/O are separate, like `plateforme.mjs`: everything here takes its I/O as `io`, so the tests play every branch
// without touching a launchd or a systemd. Nothing here is a DSH engine patch and nothing runs inside DSH.
//
// What a service does NOT get: the person's shell environment. DSH reads `~/.dsh/.env` itself, and keys typed in Kybernos live in DSH's
// own store; no key is ever written into the unit (it is a file anyone who can read your home can read).
import { dirname, join } from 'node:path'
import { planSupervision } from './plateforme.mjs'

export const LABEL = 'com.kybernos.dsh-web'
/** One unit per port: a test instance or a second profile on another port never replaces the unit of the real one on 3080. */
export const etiquette = (port) => (Number(port) === 3080 ? LABEL : LABEL + '-' + Number(port))
/** The families whose unit we write AND start. */
export const FAMILLES_INSTALLABLES = ['mac', 'linux']

const unique = (liste) => [...new Set(liste.filter((d) => typeof d === 'string' && d !== ''))]

/**
 * The PATH the service gets: the installer's own PATH (the person's terminal, where their tools are), with Node's folder first so that
 * `#!/usr/bin/env node` finds the same Node that runs DSH.
 */
export const cheminDuService = ({ path = '', node = '', sep = ':' }) => unique([node === '' ? '' : dirname(node), ...String(path).split(sep)]).join(sep)

/**
 * What `planSupervision` needs. `dsh` is the path of the `dsh` command AS FOUND on the PATH (not its realpath): the robot re-links it
 * when the engine changes, so the unit keeps working across engine updates. The working folder is the person's home, never a development
 * tree (the hand-made plist that was there pointed into one and sent no key).
 */
export const contexteService = ({ home, dshHome, port, node, dsh, path, uid, sep = ':' }) => ({
  home, node, dsh, port,
  travail: home,
  journaux: join(dshHome, 'logs'),
  path: cheminDuService({ path, node, sep }),
  uid,
  label: etiquette(port),
})

/** The first `dsh` on `dirs` that `existe` says is there: the common global prefixes are tried too, because a launcher has a thin PATH. */
export const trouverDsh = ({ dirs, home, existe, nom = 'dsh' }) => {
  const candidats = unique([...dirs, '/opt/homebrew/bin', '/usr/local/bin', join(home, '.local', 'bin'), join(home, '.npm-global', 'bin')])
  for (const d of candidats) { const c = join(d, nom); if (existe(c)) return c }
  return null
}

/**
 * The `node` to run DSH with, AS FOUND on the PATH (Homebrew's stable `/opt/homebrew/bin/node` link), not `process.execPath`, which is the versioned
 * file (`.../Cellar/node/26.7.0/bin/node`): after `brew upgrade node` that folder is gone and the unit would never start again.
 */
export const trouverNode = ({ dirs, home, existe, execPath }) => trouverDsh({ dirs, home, existe, nom: 'node' }) ?? execPath

/**
 * Who decides whether the question is asked. Pure.
 *   `oui`/`non`  : the person's flag wins.
 *   `deja`       : a unit is already there (they said yes earlier): refresh it, ask nothing.
 *   `demander`   : an interactive terminal, an installed archive: ask, pre-ticked.
 *   `ignorer`    : a development checkout or no terminal (a script, an AI agent, CI): nothing is added behind anyone's back.
 */
export const decisionDemarrageAuto = ({ autostart = false, refuse = false, interactif = false, depotDeDev = false, present = false }) => {
  if (refuse) return 'non'
  if (autostart) return 'oui'
  if (present) return 'deja'
  if (depotDeDev) return 'ignorer'
  return interactif ? 'demander' : 'ignorer'
}

/** `io`: { existe(chemin), lire(chemin), executer(argv) → { code, sortie, err } }. */
export async function etat ({ fam, ctx, io }) {
  const plan = planSupervision(fam, ctx)
  if (plan === null || !FAMILLES_INSTALLABLES.includes(fam)) return { gere: false, fam }
  const present = io.existe(plan.chemin)
  const identique = present && io.lire(plan.chemin) === plan.contenu
  const r = await io.executer(plan.etat[0])
  // launchd keeps a per-user list of labels switched off (`launchctl disable`). A disabled label is never loaded at login and `bootstrap`
  // refuses it: measured 2026-10-26, this is why the hand-made unit never started DSH after the reboot, although its file was in place.
  let desactive = false
  if (fam === 'mac') desactive = new RegExp('"' + ctx.label.replace(/[.]/g, '\\.') + '"\\s*=>\\s*(?:disabled|true)').test((await io.executer(['launchctl', 'print-disabled', 'gui/' + ctx.uid])).sortie)
  return { gere: true, fam, chemin: plan.chemin, present, identique, charge: r.code === 0, desactive }
}

/**
 * Writes the unit and starts it. `io`: { existe, lire, ecrire(chemin, contenu), supprimer(chemin), sauvegarder(chemin, contenu) → where, executer,
 * serveurRepond(port, ms) → bool }. `portOccupe`: a DSH nobody supervises already listens (started by hand in a terminal): we do not cut it, the
 * unit takes over at the next login (it is NOT a DSH the unit already runs). Returns `{ ok, etapes, demarre?, raison?, chemin }`; never throws on a refused command.
 */
export async function installer ({ fam, ctx, io, portOccupe = false, dry = false }) {
  const plan = planSupervision(fam, ctx)
  if (plan === null || !FAMILLES_INSTALLABLES.includes(fam)) {
    return { ok: false, raison: 'not-measured', etapes: [], message: 'Starting at login is written for macOS and Linux only; on this system it was never run, so nothing was written.' }
  }
  const etapes = []
  const avant = io.existe(plan.chemin) ? io.lire(plan.chemin) : null
  const avantEtat = await etat({ fam, ctx, io })
  const courant = avantEtat.charge
  const desactive = avantEtat.desactive === true
  if (avant === plan.contenu) etapes.push('the unit is already up to date: ' + plan.chemin)
  else etapes.push((avant === null ? 'write ' : 'replace (a copy of the old one is kept) ') + plan.chemin)
  // A unit that is already running is never stopped here: a refreshed file is read at the next start, so an update does not cut DSH.
  const commandes = []
  let lance = false
  if (desactive) etapes.push('launchd had this unit switched off (launchctl disable): it is switched on again')
  if (courant) etapes.push('already running under ' + plan.nom + ': left as it is')
  else if (fam === 'mac') {
    // `enable` is idempotent and clears a `launchctl disable` left by an earlier attempt; without it the unit is never loaded, at login or now.
    commandes.push(['launchctl', 'enable', 'gui/' + ctx.uid + '/' + ctx.label])
    if (!portOccupe) { commandes.push(plan.installer[0]); lance = true }
  } else {
    commandes.push(plan.installer[0])
    if (portOccupe) commandes.push(plan.installer[1].filter((a) => a !== '--now')); else { commandes.push(plan.installer[1]); lance = true }
  }
  for (const c of commandes) etapes.push('run ' + c.join(' '))
  if (portOccupe && !courant) etapes.push('a DSH you started yourself holds port ' + ctx.port + ': it is left running, the unit takes over at your next login')
  if (dry) return { ok: true, dry: true, etapes, chemin: plan.chemin }

  let sauvegarde = null
  if (avant !== plan.contenu) {
    if (avant !== null) sauvegarde = io.sauvegarder(plan.chemin, avant)
    io.ecrire(plan.chemin, plan.contenu)
  }
  for (const c of commandes) {
    const r = await io.executer(c)
    if (r.code !== 0) {
      // Whatever the command refused, the folder is left as it was found.
      if (avant === null) io.supprimer(plan.chemin); else io.ecrire(plan.chemin, avant)
      return { ok: false, raison: 'command-failed', etapes, chemin: plan.chemin, message: (c.join(' ') + ': ' + (r.err || r.sortie || 'exit ' + r.code)).trim().slice(0, 300), sauvegarde }
    }
  }
  const demarre = lance ? await io.serveurRepond(ctx.port, 45_000) : false
  return { ok: true, etapes, demarre, chemin: plan.chemin, sauvegarde }
}

/** Takes the unit away. Stopping the job stops the DSH it runs (launchd and systemd do that): `arrete` says so. */
export async function retirer ({ fam, ctx, io }) {
  const plan = planSupervision(fam, ctx)
  if (plan === null || !FAMILLES_INSTALLABLES.includes(fam)) return { ok: false, raison: 'not-measured', etapes: [] }
  const e = await etat({ fam, ctx, io })
  const etapes = []
  if (e.charge) { await io.executer(plan.desinstaller[0]); etapes.push('stopped ' + plan.desinstaller[0].join(' ')) }
  if (e.present) { io.supprimer(plan.chemin); etapes.push('removed ' + plan.chemin) }
  if (fam === 'linux') await io.executer(['systemctl', '--user', 'daemon-reload'])
  return { ok: true, etapes, arrete: e.charge, chemin: plan.chemin }
}

/** The command that restarts DSH THROUGH its supervisor, or null when there is none: killing a supervised DSH would make the supervisor start a second one. */
export const commandeRedemarrage = (fam, ctx) => {
  if (!FAMILLES_INSTALLABLES.includes(fam)) return null
  if (fam === 'mac') return ['launchctl', 'kickstart', '-k', 'gui/' + ctx.uid + '/' + ctx.label]
  return ['systemctl', '--user', 'restart', ctx.label + '.service']
}
