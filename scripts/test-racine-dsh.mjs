// ── Épreuve de la racine des retouches ──────────────────────────────────────
//
// Deux étages, séparés exprès :
//   · la RÉSOLUTION — pure, éprouvée en mémoire avec un faux `existe`, donc
//     toujours verte quelle que soit la machine ;
//   · le REFUS — mesuré en lançant les quatre vrais scripts, parce que c'est la
//     question qui compte pour P1 : « sans racine déclarée, un script de
//     retouche peut-il encore rendre un ✓ ? » (la réponse doit être non, et
//     le code de sortie doit dire POURQUOI : 2 = impossible d'écrire).
//
// Usage : node scripts/test-racine-dsh.mjs   (0 = tout vert)
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { racineDeclaree, basesPossibles, resoudreCopie, versionDuMoteur } from './racine-dsh.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let ok = 0
const echecs = []
const verifie = (titre, condition) => {
  if (condition) ok += 1
  else echecs.push(titre)
}

// ── 1. `--dsh` : ce qui est lu, et ce qui est refusé ────────────────────────
verifie('sans --dsh, aucune racine n\'est déclarée', racineDeclaree([]) === null)
verifie('--dsh sans valeur ne déclare rien', racineDeclaree(['--dsh']) === null)
verifie('--dsh suivi d\'une option ne déclare rien', racineDeclaree(['--dsh', '--check']) === null)
verifie('--dsh vide ne déclare rien', racineDeclaree(['--dsh', '   ']) === null)
verifie('--dsh --check ne mange pas l\'option suivante', racineDeclaree(['--check', '--dsh']) === null)
verifie('--dsh relatif est résolu en absolu', racineDeclaree(['--dsh', '.']) === resolve('.'))
verifie('--dsh est lu même après --check', racineDeclaree(['--check', '--dsh', '/tmp/x']) === '/tmp/x')

// ── 2. les bases mesurées sous DSH 0.1.7 ────────────────────────────────────
const PKG = '@deepseek-ai/dsh-client-ui-workspace'
const basesSimples = basesPossibles('/R')
verifie('le profil / le préfixe est la base première', basesSimples[0] === '/R')
verifie('le préfixe npm a sa base imbriquée', basesSimples.indexOf(join('/R', '@deepseek-ai', 'dsh')) >= 0)
verifie('toutes les bases sont dérivées de la racine', basesSimples.every((b) => b === '/R' || b.startsWith('/R/')))
// Installation PAR PROJET (référence épinglée par `overrides`, mesurée le
// 23/09/2026) : la base qui porte les paquets est la racine du projet, et le
// moteur n'est PAS ce dossier — deux questions distinctes.
const racineProjet = join('/P', 'node_modules', '@deepseek-ai', 'dsh')
const basesProjet = basesPossibles(racineProjet)
verifie('la racine du projet est une base possible', basesProjet.indexOf('/P') >= 0)
verifie('le dossier du moteur reste une base possible', basesProjet.indexOf(racineProjet) >= 0)
verifie('une base qui n\'a pas la forme projet n\'est pas inventée', basesPossibles('/R').indexOf(dirname('/R')) < 0)

// ── 3. la résolution, pure (un `existe` en mémoire) ─────────────────────────
const fauxExiste = (poses) => (chemin) => poses.indexOf(chemin) >= 0
const racineProfil = '/P'
const profilPose = [join(racineProfil, 'node_modules', '@deepseek-ai'), join(racineProfil, 'node_modules', PKG)]

const sansRacine = resoudreCopie(null, PKG)
verifie('sans racine, rien n\'est résolu', sansRacine.copie === null)
verifie('sans racine, le motif réclame --dsh', sansRacine.motif.indexOf('--dsh') >= 0)
verifie('sans racine, le motif dit qui sait quelle copie DSH charge', sansRacine.motif.indexOf('robot de cycle de vie') >= 0)

const mauvaise = resoudreCopie('/Q', PKG, fauxExiste([]))
verifie('une racine sans node_modules/@deepseek-ai est refusée', mauvaise.copie === null)
verifie('le motif dit ce qui manque à la racine', mauvaise.motif.indexOf('node_modules/@deepseek-ai') >= 0)

const bonne = resoudreCopie(racineProfil, PKG, fauxExiste(profilPose), (c) => JSON.stringify({ name: 'profil' }))
verifie('la copie du profil est trouvée', bonne.copie === join(racineProfil, 'node_modules', PKG))
verifie('une copie trouvée n\'a pas de motif', bonne.motif === null)
verifie('la base est le dossier qui porte les paquets', bonne.base === racineProfil)
verifie('un profil n\'est pas pris pour le moteur', bonne.moteur === null)

// ── 3 bis. la version se lit sur le MOTEUR, pas sur la base ─────────────────
const moteurPose = join(racineProjet, 'package.json')
const lireFaux = (c) => (c === moteurPose ? JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.7-alpha.1' }) : '{}')
const dansLeProjet = resoudreCopie(racineProjet, PKG, fauxExiste([join('/P', 'node_modules', PKG), racineProjet, join(racineProjet, 'package.json')]), lireFaux)
verifie('dans un projet, la copie est trouvée sous la racine du projet', dansLeProjet.copie === join('/P', 'node_modules', PKG))
verifie('dans un projet, la base est la racine du projet', dansLeProjet.base === '/P')
verifie('dans un projet, le moteur est le dossier @deepseek-ai/dsh', dansLeProjet.moteur === racineProjet)
verifie('la version du moteur est lue', versionDuMoteur(dansLeProjet.moteur, lireFaux) === '0.1.7-alpha.1')
verifie('sans moteur, la version vaut null', versionDuMoteur(null, lireFaux) === null)
verifie('un manifeste illisible rend null, jamais une exception', versionDuMoteur('/X', () => { throw new Error('boom') }) === null)

// Paquet global : la racine EST le dossier du moteur, les paquets sont imbriqués
// dedans — la base est donc la racine elle-même.
const racineGlobal = join('/R', 'node_modules', '@deepseek-ai', 'dsh')
const copieGlobale = join(racineGlobal, 'node_modules', PKG)
const globalPose = [join(racineGlobal, 'node_modules', '@deepseek-ai'), copieGlobale, join(racineGlobal, 'package.json')]
const dansLeGlobal = resoudreCopie(racineGlobal, PKG, fauxExiste(globalPose), (c) => JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.7-alpha.1' }))
verifie('la forme du paquet global est trouvée', dansLeGlobal.copie === copieGlobale)
verifie('dans le paquet global, la base est la racine', dansLeGlobal.base === racineGlobal)
verifie('dans le paquet global, le moteur est la racine', dansLeGlobal.moteur === racineGlobal)

const copiePrefixe = join('/R', '@deepseek-ai', 'dsh', 'node_modules', PKG)
const prefixePose = [join('/R', 'node_modules', '@deepseek-ai'), copiePrefixe]
verifie('la forme du préfixe npm est trouvée', resoudreCopie('/R', PKG, fauxExiste(prefixePose)).copie === copiePrefixe)

const cibleAbsente = resoudreCopie('/R', PKG, fauxExiste([join('/R', 'node_modules', '@deepseek-ai')]))
verifie('racine bonne mais cible absente : rien n\'est résolu', cibleAbsente.copie === null)
verifie('le motif nomme le paquet absent', cibleAbsente.motif.indexOf(PKG) >= 0)
verifie('le motif liste les bases essayées', cibleAbsente.motif.indexOf(copiePrefixe) >= 0)

// ── 4. le refus, mesuré : `--check` sans racine ne rend JAMAIS un ✓ ─────────
const SCRIPTS = [
  ['patch-dsh-queue-move.mjs', '@deepseek-ai/dsh-api-session-controller'],
  ['patch-dsh-model-search.mjs', '@deepseek-ai/dsh-client-ui-model-selection'],
  ['patch-dsh-models-header.mjs', '@deepseek-ai/dsh-client-ui-settings-models'],
  ['patch-dsh-workspace-pins.mjs', '@deepseek-ai/dsh-client-ui-workspace'],
  // Cette retouche vise DEUX paquets (la carte du fil et la barre) : le banc
  // doit porter les deux, sinon le script refuse la racine — à juste titre.
  ['patch-dsh-goal-affichage.mjs', '@deepseek-ai/dsh-client-ui-chat', ['@deepseek-ai/dsh-client-ui-goal']],
]
for (const [script] of SCRIPTS) {
  const r = spawnSync('node', [join('scripts', script), '--check'], { cwd: REPO, encoding: 'utf8' })
  verifie(script + ' : --check sans --dsh sort en 2', r.status === 2)
  verifie(script + ' : --check sans --dsh ne dit pas ✓', (r.stdout || '').indexOf('✓') < 0)
  verifie(script + ' : --check sans --dsh réclame --dsh', (r.stderr || '').indexOf('aucune racine déclarée') >= 0)
}

// ── 5. la racine déclarée est HONORÉE (et non remplacée par un défaut) ──────
// Un banc jetable qui porte les cibles, mais aucun contenu : les scripts doivent
// aller AU-DELÀ du contrôle de racine (donc sortir en 1 — écart mesuré — et
// jamais en 2, qui est le refus de racine). C'est ce qui distingue « j'ai
// regardé la copie que tu m'as donnée » de « j'ai cherché ailleurs ».
const banc = join('/tmp', 'kb-racine-banc-' + process.pid)
try {
  for (const [, cible, autres = []] of SCRIPTS) for (const paquet of [cible].concat(autres)) mkdirSync(join(banc, 'node_modules', paquet), { recursive: true })
  for (const [script] of SCRIPTS) {
    const r = spawnSync('node', [join('scripts', script), '--check', '--dsh', banc], { cwd: REPO, encoding: 'utf8' })
    verifie(script + ' : accepte une racine déclarée qui porte la cible', r.status !== 2)
    verifie(script + ' : ne réclame plus --dsh quand la racine est donnée', (r.stderr || '').indexOf('aucune racine déclarée') < 0)
  }
} finally {
  rmSync(banc, { recursive: true, force: true })
}

// ── verdict ─────────────────────────────────────────────────────────────────
console.log('RACINE DES RETOUCHES — ' + ok + ' assertions, ' + echecs.length + ' échec(s)')
for (const e of echecs) console.log('  ✗ ' + e)
process.exit(echecs.length === 0 ? 0 : 1)
