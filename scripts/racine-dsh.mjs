// ── La racine des retouches : DÉCLARÉE, jamais devinée ───────────────────────
//
// Doctrine (lot P1 du plan du 23/09/2026) : un script de retouche n'a pas le
// droit de CHERCHER son installation. Il écrit là où on lui dit, ou il refuse.
//
// Pourquoi c'est une règle et non un confort : mesuré le 23/09/2026, une sonde
// `require.resolve` lancée depuis le dépôt et un défaut `/opt/homebrew/...`
// faisaient rendre « 4/4 posées » à la machine de développement en écrivant
// parfois dans une copie que DSH **ne charge pas**. Un « ✓ » vert peut donc
// mesurer une autre installation que celle du testeur. La seule source de
// vérité, c'est le robot de cycle de vie : lui seul sait quelle copie charge le
// DSH qui tourne (`racineQuiPorte`), et il la passe par `--dsh`.
//
// Contrat d'appel :
//   node scripts/patch-dsh-<id>.mjs [--check|--revert] --dsh <RACINE>
// où RACINE est un dossier qui PORTE la cible, sous l'une des trois formes
// mesurées sur DSH 0.1.7 :
//   · le profil        ~/.dsh/profiles/web   → node_modules/<pkg>
//   · le paquet global …/@deepseek-ai/dsh    → node_modules/@deepseek-ai/<court>
//   · le préfixe npm   …/lib/node_modules    → @deepseek-ai/dsh/node_modules/@deepseek-ai/<court>
//
// Usage direct (pour savoir ce qu'un script viserait, sans rien écrire) :
//   node scripts/racine-dsh.mjs --dsh <RACINE> [--pkg @deepseek-ai/dsh-client-ui-workspace]
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** La lecture de texte, injectable pour que la résolution reste éprouvable à sec. */
export const lireTexte = (chemin) => readFileSync(chemin, 'utf8')

/** Le `--dsh <R>` des arguments, résolu en absolu. `null` s'il n'est pas là. */
export const racineDeclaree = (args) => {
  const i = args.indexOf('--dsh')
  const valeur = i >= 0 ? args[i + 1] : undefined
  if (typeof valeur !== 'string') return null
  if (valeur.trim() === '' || valeur.startsWith('--') === true) return null
  return resolve(valeur)
}

/**
 * Les BASES à essayer : un dossier B tel que `B/node_modules/@deepseek-ai/<pkg>`
 * soit la copie du paquet. Toutes dérivées de R — aucune devinette.
 */
export const basesPossibles = (racine) => {
  const bases = [racine]
  // Installation par PROJET (référence épinglée par `overrides`) : la racine est
  // `…/<projet>/node_modules/@deepseek-ai/dsh`, les paquets sont remontés, donc
  // la base qui les porte est la racine du projet, deux crans plus haut que
  // `node_modules`.
  if (basename(dirname(racine)) === '@deepseek-ai') bases.push(dirname(dirname(dirname(racine))))
  // Préfixe npm : la racine est `…/lib/node_modules`, le moteur est dedans.
  bases.push(join(racine, '@deepseek-ai', 'dsh'))
  return bases
}

/** Le dossier du paquet `dsh` (celui dont on lit la VERSION), vu depuis la base. */
export const moteurSous = (base, existe = existsSync, lire = lireTexte) => {
  const sous = join(base, 'node_modules', '@deepseek-ai', 'dsh')
  if (existe(sous) === true) return sous
  // La base EST le paquet `dsh` (installation globale : les sous-paquets sont
  // imbriqués dedans). On ne le confond pas avec un profil : on lit son nom.
  try {
    if (JSON.parse(lire(join(base, 'package.json'))).name === '@deepseek-ai/dsh') return base
  } catch (e) { /* pas un manifeste lisible : ce n'est pas le moteur */ }
  return null
}

/** La version du moteur, ou `null` : l'appelant DIT qu'il ne l'a pas lue. */
export const versionDuMoteur = (moteur, lire = lireTexte) => {
  if (moteur === null) return null
  try {
    const v = JSON.parse(lire(join(moteur, 'package.json'))).version
    return typeof v === 'string' && v !== '' ? v : null
  } catch (e) { return null }
}

/**
 * Pure : rend `{ copie, base, moteur, motif }`.
 * - `copie`  : le dossier du paquet à retoucher ;
 * - `base`   : le dossier qui PORTE `node_modules/@deepseek-ai/*` — c'est lui qui
 *   donne les chemins relatifs (`base` + `node_modules/@deepseek-ai/…`) ;
 * - `moteur` : le dossier du paquet `dsh` — c'est lui qui donne la VERSION, et
 *   c'est une autre question que la première (mesuré le 23/09/2026 : dans une
 *   installation par projet, les paquets sont remontés au niveau du projet, donc
 *   la base et le moteur ne sont PAS le même dossier).
 * `motif` n'est renseigné que lorsque `copie` est `null`, et il dit POURQUOI.
 */
export const resoudreCopie = (racine, pkg, existe = existsSync, lire = lireTexte) => {
  if (racine === null) {
    return {
      copie: null,
      motif: 'aucune racine déclarée : ce script exige --dsh <dossier du moteur DSH>.\n' +
        '      Le robot de cycle de vie le passe toujours (lui seul sait quelle copie DSH charge) ;\n' +
        '      à la main, vise le profil : --dsh ~/.dsh/profiles/web',
    }
  }
  // Une racine de moteur : soit un dossier qui porte les paquets (profil,
  // préfixe npm), soit le paquet `dsh` lui-même (dont les sous-paquets peuvent
  // être imbriqués OU remontés au niveau du projet).
  const porteLeMoteur = existe(join(racine, 'node_modules', '@deepseek-ai')) === true ||
    existe(join(racine, 'package.json')) === true
  if (porteLeMoteur !== true) {
    return { copie: null, motif: racine + " ne porte ni node_modules/@deepseek-ai ni package.json — ce n'est pas une racine de moteur DSH" }
  }
  for (const base of basesPossibles(racine)) {
    const copie = join(base, 'node_modules', pkg)
    if (existe(copie) === true) return { copie, base, moteur: moteurSous(base, existe, lire), motif: null }
  }
  return {
    copie: null,
    motif: pkg + " n'est installé dans aucune des copies attendues sous " + racine + ' :\n      ' +
      basesPossibles(racine).map((b) => join(b, 'node_modules', pkg)).join('\n      '),
  }
}

/** Refuse, en le disant, et sort en 2 (1 = un écart mesuré ; 2 = impossible d'écrire). */
export const refuserRacine = (motif, script) => {
  console.error('✗ ' + script + ' : ' + motif)
  process.exit(2)
}

// ── Point d'entrée direct : on DIT ce que la racine porte, on n'écrit rien ───
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const iPkg = args.indexOf('--pkg')
  const pkg = iPkg >= 0 && args[iPkg + 1] !== undefined ? args[iPkg + 1] : '@deepseek-ai/dsh-client-ui-workspace'
  const racine = racineDeclaree(args)
  const { copie, motif } = resoudreCopie(racine, pkg)
  if (copie === null) {
    console.error('✗ ' + pkg + ' — ' + motif)
    process.exit(2)
  }
  console.log('✓ ' + pkg)
  console.log('  racine : ' + racine)
  console.log('  copie  : ' + copie)
}
