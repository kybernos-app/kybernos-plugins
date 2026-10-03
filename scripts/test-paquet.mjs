// ── Épreuve du paquetage ────────────────────────────────────────────────────
//
// Deux étages, séparés exprès :
//   · le MANIFESTE et sa VÉRIFICATION — purs, éprouvés en mémoire, donc
//     toujours verts quelle que soit la machine ;
//   · le CONTENU — lu sur le vrai dépôt, parce que c'est la question qui compte
//     (« qu'est-ce qui part chez le testeur ? ») et qu'un contenu dérivé peut
//     silencieusement perdre un bundle.
//
// Usage : node scripts/test-paquet.mjs   (0 = tout vert)
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { construireManifest, verifierManifest, listerContenu, dependancesDesPatchs, fichiersSales, verdictArbrePropre, estBruit, exclureIgnores, importsRelatifs, fermetureModules, SCRIPTS_DU_ROBOT, FICHIERS_DE_SERVICE, LANCEURS } from './paquet.mjs'

const existeFichier = (racine, chemin) => {
  try { return statSync(join(racine, chemin)).isFile() === true } catch (e) { return false }
}
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let ok = 0
const echecs = []
const verifie = (titre, condition) => {
  if (condition) ok += 1
  else echecs.push(titre)
}

// ── 1. un faux dépôt en mémoire ─────────────────────────────────────────────
const faux = {
  'a.txt': Buffer.from('bonjour'),
  'b/c.txt': Buffer.from('monde'),
  'z.txt': Buffer.from(''),
}
const lireFaux = (chemin) => {
  if (!(chemin in faux)) throw new Error('absent : ' + chemin)
  return faux[chemin]
}
const manifest = construireManifest({
  liste: ['z.txt', 'a.txt', 'b/c.txt'], // exprès dans le désordre
  lire: lireFaux,
  version: '1.2.3',
  plateforme: 'mac',
  compat: { 'dsh.min': '0.1.6-alpha.2', 'dsh.max': '0.1.7-alpha.1' },
  horloge: () => '2026-09-23T00:00:00.000Z',
})
verifie('manifeste : les chemins sont triés', manifest.fichiers.map((f) => f.chemin).join(',') === 'a.txt,b/c.txt,z.txt')
verifie('manifeste : les octets sont comptés', manifest.fichiers[0].octets === 7)
verifie('manifeste : un fichier vide fait 0 octet et une empreinte', manifest.fichiers[2].octets === 0 && manifest.fichiers[2].sha256.length === 64)
verifie('manifeste : le total additionne les fichiers', manifest.total.fichiers === 3 && manifest.total.octets === 12)
verifie('manifeste : la version et la plateforme sont portées', manifest.version === '1.2.3' && manifest.plateforme === 'mac')
verifie('manifeste : la compatibilité est portée', manifest.dsh['dsh.max'] === '0.1.7-alpha.1')
verifie('manifeste : la date vient de l\'horloge injectée', manifest.creeLe === '2026-09-23T00:00:00.000Z')
verifie('manifeste : deux contenus différents ont deux empreintes', manifest.fichiers[0].sha256 !== manifest.fichiers[1].sha256)

// ── 2. la vérification, dans les trois sens ─────────────────────────────────
const intact = verifierManifest({ manifest, lire: lireFaux, presents: ['manifest.json', 'a.txt', 'b/c.txt', 'z.txt'] })
verifie('vérification : une archive intacte passe', intact.ok === true && intact.ecarts.length === 0)
verifie('vérification : le manifeste ne s\'accuse pas lui-même', intact.ecarts.length === 0)
const avecVersion = verifierManifest({ manifest: construireManifest({ liste: ['VERSION', 'a.txt'], lire: (c) => (c === 'VERSION' ? Buffer.from('1.0.0-beta.1\n') : Buffer.from('bonjour')), version: '1.0.0-beta.1', plateforme: 'mac' }), lire: (c) => (c === 'VERSION' ? Buffer.from('1.0.0-beta.1\n') : Buffer.from('bonjour')), presents: ['VERSION', 'a.txt', 'manifest.json'] })
verifie('vérification : VERSION est listé et vérifié', avecVersion.ok === true)

const modifie = verifierManifest({ manifest, lire: (c) => (c === 'a.txt' ? Buffer.from('bonjour!') : lireFaux(c)), presents: ['a.txt'] })
verifie('vérification : un octet de plus est vu', modifie.ok === false && modifie.ecarts.length === 1)
verifie('vérification : l\'écart dit « modifie »', modifie.ecarts[0].type === 'modifie')
verifie('vérification : l\'écart donne les deux empreintes', modifie.ecarts[0].attendu !== modifie.ecarts[0].obtenu)

const manquant = verifierManifest({ manifest, lire: (c) => { if (c === 'b/c.txt') throw new Error('absent'); return lireFaux(c) }, presents: ['a.txt'] })
verifie('vérification : un fichier manquant est vu', manquant.ecarts.length === 1 && manquant.ecarts[0].type === 'manquant')

const enTrop = verifierManifest({ manifest, lire: lireFaux, presents: ['a.txt', 'b/c.txt', 'z.txt', 'intrus.sh'] })
verifie('vérification : un fichier en trop est vu', enTrop.ecarts.length === 1 && enTrop.ecarts[0].type === 'en-trop')
verifie('vérification : l\'intrus est nommé', enTrop.ecarts[0].chemin === 'intrus.sh')

// ── 3. le contenu réel du dépôt ─────────────────────────────────────────────
const contenu = listerContenu(REPO)
verifie('contenu : il y a du monde', contenu.length > 40)
verifie('contenu : les chemins sont triés', contenu.join('\n') === [...contenu].sort().join('\n'))
verifie('contenu : le bundle principal est là', contenu.includes('kybernos-plugin/index.js') && contenu.includes('kybernos-plugin/client.js'))
verifie('contenu : les douze bundles sont là', ['kybernos-theme', 'kybernos-models', 'kybernos-skills', 'kybernos-slash', 'kybernos-sessions', 'kybernos-relance', 'kybernos-flow', 'kybernos-composio', 'kybernos-cloud', 'kybernos-maintenance', 'dsh-media-player', 'dsh-mermaid'].every((d) => contenu.some((c) => c.startsWith(d + '/'))))
verifie('contenu : le robot est là', SCRIPTS_DU_ROBOT.every((c) => contenu.includes(c)))
verifie('contenu : les quatre lanceurs sont là', LANCEURS.every((c) => contenu.includes(c)))
verifie('contenu : un lanceur Unix et un lanceur Windows par geste', LANCEURS.length === 4 && LANCEURS.some((c) => c.endsWith('.cmd')))
verifie('contenu : la compatibilité est là', contenu.includes('dsh-compat.json'))
verifie('contenu : aucune maquette (171 Mo de docs) ne part', !contenu.some((c) => c.startsWith('docs/')))
verifie('contenu : aucun test ne part', !contenu.some((c) => c.startsWith('scripts/test-')))
verifie('contenu : ni node_modules ni .git', !contenu.some((c) => c.includes('node_modules') || c.startsWith('.git')))

// ── 4. les fichiers du robot existent vraiment ──────────────────────────────
for (const chemin of [...SCRIPTS_DU_ROBOT, ...LANCEURS, ...FICHIERS_DE_SERVICE]) {
  verifie('existe sur le disque : ' + chemin, existsSync(join(REPO, chemin)) || FICHIERS_DE_SERVICE.includes(chemin))
}
verifie('VERSION porte une version lisible', /^\d+\.\d+\.\d+/.test(readFileSync(join(REPO, 'VERSION'), 'utf8').trim()))

// ── 5. ce dont un script de retouche dépend voyage AVEC lui ─────────────────
// Leçon du 23/09/2026 : l'archive portait les quatre scripts de retouche mais
// aucun de leurs fichiers — queue-move n'avait pas son diff, ni son contrôle, et
// aucun n'avait le module de racine. Le défaut ne se voyait QUE chez le testeur,
// sur une machine neuve. Ces assertions tiennent la classe entière.
const patches = JSON.parse(readFileSync(join(REPO, 'scripts', 'patches.json'), 'utf8'))
const dependances = dependancesDesPatchs(REPO, patches)
verifie('les dépendances des retouches sont dérivées du source', dependances.length >= 5)
for (const chemin of dependances) verifie('existe sur le disque : ' + chemin, existsSync(join(REPO, chemin)))
for (const chemin of dependances) verifie('voyage dans l\'archive : ' + chemin, contenu.includes(chemin))
verifie('la racine déclarée est du voyage (racine-dsh.mjs)', contenu.includes('scripts/racine-dsh.mjs'))
verifie('le diff de queue-move est du voyage', contenu.includes('scripts/dsh-queue-move-017.patch'))
verifie('le contrôle de queue-move est du voyage', contenu.includes('scripts/check-queue-move.mjs'))

// ── 6. les retouches RETIRÉES (P3) ──────────────────────────────────────────
// Retirer une entrée de `patches.json` laisserait la retouche POSÉE sur les
// machines où elle est déjà — sans que le rollback, qui lit ce même fichier,
// sache la défaire. Une retouche se retire donc en gardant son entrée, marquée
// `retire`, et le robot la défait au lieu de la poser. Ces assertions tiennent
// la classe entière : une entrée retirée sans son script serait irréversible.
verifie('patches.json se lit', Array.isArray(patches) && patches.length >= 3)
verifie('chaque entrée porte id, script et cible',
  patches.every((x) => typeof x.id === 'string' && x.id !== '' && typeof x.script === 'string' && typeof x.cible === 'string'))
verifie('les identifiants sont uniques', new Set(patches.map((x) => x.id)).size === patches.length)
const retirees = patches.filter((x) => x.retire !== undefined)
verifie('au moins une retouche est retirée', retirees.length >= 1)
verifie('model-search est retirée (notre catalogue cherche déjà)',
  retirees.some((x) => x.id === 'model-search'))
verifie('chaque retraite est motivée par une phrase',
  retirees.every((x) => typeof x.retire === 'string' && x.retire.length >= 20))
for (const x of retirees) verifie('le script d\'une retouche retirée reste sur le disque : ' + x.script, existsSync(join(REPO, 'scripts', x.script)))
for (const x of retirees) verifie('le script d\'une retouche retirée voyage (rollback possible) : ' + x.script, contenu.includes('scripts/' + x.script))
const moteur = readFileSync(join(REPO, 'scripts', 'dsh-lifecycle.mjs'), 'utf8')
verifie('le moteur ne pose plus une retouche retirée', moteur.includes('if (p.retire !== undefined)'))
verifie('le moteur la DÉFAIT là où elle traîne', moteur.includes("'--revert'") && moteur.includes('retire: true'))
verifie('le doctor compte les retouches non retirées',
  moteur.includes('la retouche « ${p.id} » est retirée mais encore posée'))

// ── 7. l'archive ne se construit pas sur un arbre sale (23/09/2026) ─────────
// Le premier jet de cette garde retirait « des non-espaces » : le statut de git
// commençant par une espace, l'expression ne mordait pas et la garde laissait
// passer TOUT — l'archive s'est construite sur neuf fichiers livrés sales sans
// un mot. Ces assertions tiennent le format, pas l'intention.
const LIVRES = ['scripts/patches.json', 'scripts/dsh-lifecycle.mjs']
verifie('un fichier livré modifié est vu (statut « M » en 2e colonne)',
  fichiersSales(LIVRES, () => ' M scripts/patches.json\n').join() === 'scripts/patches.json')
verifie('un fichier livré modifié est vu (statut « M » en 1re colonne)',
  fichiersSales(LIVRES, () => 'M  scripts/patches.json\n').join() === 'scripts/patches.json')
verifie('un fichier livré ajouté est vu (« ?? »)',
  fichiersSales(LIVRES, () => '?? scripts/dsh-lifecycle.mjs\n').join() === 'scripts/dsh-lifecycle.mjs')
verifie('un renommage rend le chemin d\'arrivée',
  fichiersSales(LIVRES, () => 'R  vieux.mjs -> scripts/patches.json\n').join() === 'scripts/patches.json')
verifie('un brouillon HORS paquet ne bloque pas',
  fichiersSales(LIVRES, () => ' M docs/brouillon.md\n').join() === '')
verifie('un arbre propre rend zéro fichier', fichiersSales(LIVRES, () => '').length === 0)
verifie('git muet (dépôt absent) ne bloque pas', fichiersSales(LIVRES, () => { throw new Error('pas de git') }).length === 0)
verifie('le verdict est vert sur un arbre propre', verdictArbrePropre([]).ok === true)
const verdictSale = verdictArbrePropre(['scripts/patches.json'])
verifie('le verdict est rouge sur un arbre sale', verdictSale.ok === false)
verifie('le refus NOMME le fichier', verdictSale.message.includes('scripts/patches.json'))
verifie('le refus dit pourquoi (l\'arbre de travail part tel quel)', /arbre de travail/.test(verdictSale.message))
verifie('le refus donne la sortie « révision propre »', /git worktree add/.test(verdictSale.message))
const source = readFileSync(join(REPO, 'scripts', 'paquet.mjs'), 'utf8')
verifie('--construire refuse AVANT d\'écrire', source.includes('verdictPropre.ok !== true') && source.includes('process.exit(2)'))

// ── 8. le bruit ne part pas chez le testeur (23/09/2026) ────────────────────
// Une construction depuis l'arbre de travail embarquait trois `.DS_Store` et un
// `dsh-media-player/test/harness.bundle.js` d'1 Mo — tous git-ignorés, donc
// absents d'une construction depuis une révision propre. Trouvé en comparant les
// deux listes (`--liste` dans l'arbre sale vs dans un worktree de HEAD).
verifie('un .DS_Store est du bruit', estBruit('kybernos-theme/.DS_Store') === true)
verifie('un ._fichier AppleDouble est du bruit', estBruit('a/._b.js') === true)
verifie('un Thumbs.db est du bruit', estBruit('a/Thumbs.db') === true)
verifie('un bundle livré n\'est PAS du bruit', estBruit('kybernos-plugin/client.js') === false)
verifie('un harness.bundle n\'est pas du bruit PAR SON NOM (git s\'en charge)',
  estBruit('dsh-media-player/test/harness.bundle.js') === false)
verifie('la liste du dépôt ne porte aucun .DS_Store', contenu.some((c) => c.includes('DS_Store')) === false)
verifie('git retire ce qu\'il ignore',
  exclureIgnores(['a.js', 'b.js'], () => 'b.js\n').join() === 'a.js')
verifie('rien d\'ignoré (git sort 1) laisse la liste entière',
  exclureIgnores(['a.js'], () => { throw new Error('rien ignoré') }).join() === 'a.js')
verifie('git absent laisse la liste entière', exclureIgnores(['a.js'], () => { throw new Error('no git') }).join() === 'a.js')

// ── 9. le graphe de modules du robot voyage entier (pre-vol P7) ─────────────
// Trouve en extrayant l'archive et en lançant son installateur : `dsh-lifecycle.mjs`
// importe `./paquet.mjs`, que la liste du robot ne portait pas — l'archive ne
// DEMARRAIT pas (ERR_MODULE_NOT_FOUND) alors que toutes les épreuves du dépôt
// étaient vertes (elles lisent le dépôt, où le fichier est là). On ne liste donc
// plus les modules du robot : on les SUIT.
const importsCycle = importsRelatifs(REPO, 'scripts/dsh-lifecycle.mjs')
verifie('un import relatif est vu', importsCycle.includes('./paquet.mjs') === true)
verifie('un import hôte n\'est pas vu comme un fichier', importsCycle.every((i) => i.startsWith('.')))
const ferme = fermetureModules(REPO, ['scripts/dsh-lifecycle.mjs'])
verifie('la fermeture attrape paquet.mjs', ferme.includes('scripts/paquet.mjs') === true)
verifie('la fermeture attrape plateforme.mjs', ferme.includes('scripts/plateforme.mjs') === true)
verifie('la fermeture est transitive (racine-dsh.mjs)', ferme.includes('scripts/racine-dsh.mjs') === true)
verifie('la fermeture ne sort pas du dépôt', ferme.every((c) => c.startsWith('..') === false))
verifie('listerContenu porte les modules du robot suivis', contenu.includes('scripts/paquet.mjs') === true)
// La classe entière : TOUT import relatif d'un .mjs livré est livré.
const manquants = []
for (const chemin of contenu.filter((c) => c.endsWith('.mjs'))) {
  for (const relatif of importsRelatifs(REPO, chemin)) {
    const cible = relative(REPO, resolve(join(REPO, dirname(chemin)), relatif))
    if (existeFichier(REPO, cible) === true && contenu.includes(cible) === false) manquants.push(chemin + ' → ' + cible)
  }
}
verifie('aucun import relatif d\'un module livré ne manque', manquants.length === 0, manquants.join(', '))

// ── verdict ─────────────────────────────────────────────────────────────────
console.log('PAQUETAGE — ' + ok + ' assertions, ' + echecs.length + ' échec(s)')
for (const e of echecs) console.log('  ✗ ' + e)
process.exit(echecs.length === 0 ? 0 : 1)
