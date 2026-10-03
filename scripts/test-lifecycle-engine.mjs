#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// Harnais du moteur de cycle de vie — fonctions pures sur FIXTURES.
// Aucun disque réel, aucun npm : fs/exec/horloge injectés.
//
//   node scripts/test-lifecycle-engine.mjs
// Sortie 0 si tout passe.
// ═══════════════════════════════════════════════════════════════════════════

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ICI = join(dirname(fileURLToPath(import.meta.url)))
import {
  lireCompat, testerCompatibilite, comparerVersions, inspecterFraicheur, versionDuGlobal, etatDoctor, planUpgrade,
  photographier, restaurerPhoto, photoLaPlusRecente, journaliser, lireJournal,
  alignerPins, alignerLiens, verifierBundles, ecrireLisezMoi,
  DEPUIS_VERS
} from './lifecycle-engine.mjs'

let ko = 0
let n = 0
const ok = (titre, cond, detail = '') => {
  n += 1
  console.log(`${cond ? '✓' : '✗'} ${titre}${detail ? ' — ' + detail : ''}`)
  if (!cond) ko += 1
}

// ── fixtures : un DSH_HOME factice avec profil web ────────────────────────
const R = mkdtempSync(join(tmpdir(), 'kblife-'))
const HOME = join(R, 'dshhome')
const PROFIL = join(HOME, 'profiles', 'web')
const PHOTOS = join(HOME, 'lifecycle', 'photos')
const JOURNAL = join(HOME, 'lifecycle', 'journal.jsonl')
mkdirSync(join(PROFIL), { recursive: true })
mkdirSync(PHOTOS, { recursive: true })

const pkgProfil = (pins, locaux, bundles) => JSON.stringify({
  name: 'dsh-profile-web', private: true,
  dependencies: {
    '@deepseek-ai/dsh-browser-use': pins,
    ...Object.fromEntries(locaux.map((l) => [l, 'link:' + join(R, 'repo', l)])),
    ...Object.fromEntries(bundles.map((b) => [b, '0.0.0']))
  },
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', ...locaux] } }
}, null, 2)
writeFileSync(join(PROFIL, 'package.json'), pkgProfil('0.1.6-alpha.2', ['@local/kybernos'], ['@local/kybernos']))
writeFileSync(join(PROFIL, 'pnpm-lock.yaml'), '# lock factice\n')
writeFileSync(join(PROFIL, 'cordis.patch.yml'), '[]\n')
for (const l of ['@local/kybernos']) mkdirSync(join(R, 'repo', l), { recursive: true })

const fsFixe = {
  existe: () => true,
  lire: (p) => {
    if (p.endsWith('package.json') && p.startsWith(PROFIL)) return pkgProfil('0.1.6-alpha.2', ['@local/kybernos'], ['@local/kybernos'])
    if (p.endsWith('dsh-compat.json')) return JSON.stringify({ dsh: { min: '0.1.6-alpha.2', max: '0.1.6-alpha.2', testees: ['0.1.6-alpha.2'] } })
    if (p.endsWith('journal.jsonl')) return (journalBrut.length > 0 ? journalBrut.join('\n') + '\n' : '')
    throw new Error('lecture imprévue: ' + p)
  },
  ecrire: (p, c) => {
    ecrits.push({ p, c })
    // le journal est un vrai état mutable : ce qui s'écrit doit se relire
    if (p.endsWith('journal.jsonl')) journalBrut = c.split('\n').filter((l) => l.trim() !== '')
  },
  creerRep: () => {},
  lister: () => [],
  // copier simule la vraie copie : lit la source (fixée), écrit la destination
  copier: (src, dst) => {
    let contenu = null
    if (src.endsWith('package.json') && src.startsWith(PROFIL)) contenu = pkgProfil('0.1.6-alpha.2', ['@local/kybernos'], ['@local/kybernos'])
    else if (src.endsWith('pnpm-lock.yaml')) contenu = '# lock factice\n'
    else if (src.endsWith('cordis.patch.yml')) contenu = '[]\n'
    else throw new Error('copie imprévue: ' + src)
    ecrits.push({ p: dst, c: contenu })
  },
}
let ecrits = []
let journalBrut = []
const execFixe = (reponses) => {
  const appels = []
  const run = async (cmd) => {
    appels.push(cmd)
    const cle = Object.keys(reponses).find((k) => cmd.join(' ').includes(k))
    return reponses[cle] ?? { code: 0, sortie: '' }
  }
  run.appels = appels
  return run
}

// ── 1. compatibilité ───────────────────────────────────────────────────────
const compat = lireCompat({ fs: fsFixe, chemin: join(R, 'dsh-compat.json') })
ok('lireCompat lit min/max', compat.dsh.min === '0.1.6-alpha.2' && compat.dsh.max === '0.1.6-alpha.2')

const c1 = testerCompatibilite({ cible: '0.1.6-alpha.2', compat })
ok('0.1.6 dans la zone → compatible', c1.verdict === 'ok' && c1.bloquant === false, JSON.stringify(c1))
const c2 = testerCompatibilite({ cible: '0.1.7-alpha.1', compat })
ok('0.1.7 hors zone → refus bloquant', c2.verdict === 'refuse' && c2.bloquant === true, JSON.stringify(c2))
ok('le refus s\'explique en français', /jamais|test|compat/i.test(c2.raison), c2.raison)
const c3 = testerCompatibilite({ cible: '0.1.7-alpha.1', compat, force: true })
ok('--force passe le refus avec avertissement', c3.verdict === 'force' && c3.bloquant === false, JSON.stringify(c3))
const c4 = testerCompatibilite({ cible: '0.1.5-rc.9', compat })
ok('sous le minimum → refus aussi', c4.verdict === 'refuse', JSON.stringify(c4))

// ── 2. versions ────────────────────────────────────────────────────────────
const execV = execFixe({ '--version': { code: 0, sortie: '0.1.6-alpha.2\n' } })
ok('versionDuGlobal lit dsh --version', (await versionDuGlobal({ exec: execV })) === '0.1.6-alpha.2')

// ── 3. doctor ──────────────────────────────────────────────────────────────
const doctorSain = await etatDoctor({ fs: fsFixe, exec: execV, profilDir: PROFIL, repoDir: R, patches: [{ id: 'p1', script: 'patch-x.mjs', cible: '@deepseek-ai/dsh-api-session-controller' }], compatChemin: join(R, 'dsh-compat.json') })
ok('doctor : global = profil → aligné', doctorSain.global === '0.1.6-alpha.2' && doctorSain.alignePins === true)
ok('doctor : lien @local présent → aligné', doctorSain.liensManquants.length === 0)
ok('doctor : bundle déclaré → ok', doctorSain.bundlesManquants.length === 0)
ok('doctor : couleur verte quand tout va', doctorSain.couleur === 'verte', JSON.stringify({ c: doctorSain.couleur, p: doctorSain.problemes }))

// doctor avec pin divergent (le monde réel de ce matin)
const fsDiverge = { ...fsFixe, lire: (p) => {
  if (p.endsWith('package.json') && p.startsWith(PROFIL)) return pkgProfil('0.1.6-alpha.2', ['@local/kybernos'], ['@local/kybernos'])
  if (p.endsWith('dsh-compat.json')) return JSON.stringify({ dsh: { min: '0.1.6-alpha.2', max: '0.1.6-alpha.2', testees: ['0.1.6-alpha.2'] } })
  if (p.endsWith('journal.jsonl')) return (journalBrut.length > 0 ? journalBrut.join('\n') + '\n' : '')
  throw new Error('lecture imprévue: ' + p)
} }
const execV17 = execFixe({ '--version': { code: 0, sortie: '0.1.7-alpha.1\n' } })
const doctorDiverge = await etatDoctor({ fs: fsDiverge, exec: execV17, profilDir: PROFIL, repoDir: R, patches: [{ id: 'p1', script: 'patch-x.mjs', cible: '@deepseek-ai/dsh-api-session-controller' }], compatChemin: join(R, 'dsh-compat.json') })
ok('doctor : global 0.1.7 vs pins 0.1.6 → orange', doctorDiverge.couleur === 'orange' && doctorDiverge.alignePins === false, doctorDiverge.problemes.join(' | '))
ok('doctor : le problème est dit en français', doctorDiverge.problemes.some((p) => /profil|épingl/.test(p)), doctorDiverge.problemes[0])

// lien manquant + bundle manquant
const fsLienManque = { ...fsFixe, lire: (p) => {
  if (p.endsWith('package.json') && p.startsWith(PROFIL)) return JSON.stringify({ name: 'x', private: true, dependencies: {}, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } })
  if (p.endsWith('dsh-compat.json')) return JSON.stringify({ dsh: { min: '0.1.6-alpha.2', max: '0.1.6-alpha.2', testees: ['0.1.6-alpha.2'] } })
  if (p.endsWith('journal.jsonl')) return ''
  throw new Error('lecture imprévue: ' + p)
} }
const doctorVide = await etatDoctor({ fs: fsLienManque, exec: execV, profilDir: PROFIL, repoDir: R, packages: [{ dir: 'kybernos-plugin', nom: '@local/kybernos' }], patches: [], compatChemin: join(R, 'dsh-compat.json') })
ok('doctor : aucun lien @local → orange + lien manquant listé', doctorVide.couleur === 'orange' && doctorVide.liensManquants.includes('@local/kybernos'))
ok('doctor : bundle manquant listé', doctorVide.bundlesManquants.includes('@local/kybernos'))

// ── 4. plan d'upgrade (l'ordre des gestes, écrit noir sur blanc) ──────────
const plan = planUpgrade({ cible: '0.1.7-alpha.1', depuis: '0.1.6-alpha.2', compatVerdict: 'ok', aDesBundles: true })
ok('plan : 8 gestes, dans l\'ordre', plan.length === 8 && plan[0] === 'compatibilite' && plan[1] === 'photo' && plan[2] === 'remplacer-moteur' && plan[7] === 'journal', plan.join('>'))
const planMeme = planUpgrade({ cible: '0.1.6-alpha.2', depuis: '0.1.6-alpha.2', compatVerdict: 'ok', aDesBundles: true })
ok('plan : même version → pas de remplacement moteur', planMeme.length === 7 && !planMeme.includes('remplacer-moteur'), planMeme.join('>'))
const planRefus = planUpgrade({ cible: '0.1.7-alpha.1', depuis: '0.1.6-alpha.2', compatVerdict: 'refuse', aDesBundles: true })
ok('plan : refus → un seul geste (compat), rien d\'écrit', planRefus.length === 1 && planRefus[0] === 'compatibilite')

// ── 5. photo / restauration ────────────────────────────────────────────────
ecrits = []
const photo = await photographier({ fs: fsFixe, profilDir: PROFIL, photosDir: PHOTOS, horodatage: '20260922-1200', versions: { global: '0.1.6-alpha.2', plugin: 'abc1234' }, exec: execV })
ok('photo : tout est dans le dossier horodaté', photo.dossier.startsWith(PHOTOS) && photo.dossier.includes('20260922-1200'))
const chemins = ecrits.map((e) => e.p)
ok('photo : contient package.json, lock, cordis, LISEZ-MOI, versions', ['package.json', 'pnpm-lock.yaml', 'cordis.patch.yml', 'LISEZ-MOI.txt', 'versions.txt'].every((f) => chemins.some((p) => p.endsWith(f))), chemins.join(','))
const lisez = ecrits.find((e) => e.p.endsWith('LISEZ-MOI.txt'))
ok('photo : le LISEZ-MOI dit comment revenir en arrière', /rollback|revenir/i.test(lisez.c))

// restauration : la photo relit ses fichiers et les recopie dans le profil
ecrits = []
const contenuPhoto = { 'package.json': pkgProfil('0.1.5-rc.9', ['@local/kybernos'], ['@local/kybernos']), 'pnpm-lock.yaml': '# lock ancien\n', 'cordis.patch.yml': '[]\n' }
const fsPhoto = { ...fsFixe, lire: (p) => {
  for (const [k, v] of Object.entries(contenuPhoto)) if (p.endsWith(k) && p.startsWith(PHOTOS)) return v
  return fsFixe.lire(p)
} }
const restaurer = await restaurerPhoto({ fs: fsPhoto, photosDir: PHOTOS, photoDossier: join(PHOTOS, '20260922-1200'), profilDir: PROFIL })
ok('restauration : recopie package.json + lock + cordis vers le profil', ['package.json', 'pnpm-lock.yaml', 'cordis.patch.yml'].every((f) => ecrits.some((e) => e.p === join(PROFIL, f))), ecrits.map((e) => e.p).join(','))
ok('restauration : le contenu recopié est bien celui de la photo', ecrits.find((e) => e.p.endsWith('package.json')).c.includes('0.1.5-rc.9'))

// ── 6. journal ────────────────────────────────────────────────────────────
journalBrut = []
await journaliser({ fs: fsFixe, journal: JOURNAL, op: { date: '2026-09-22T11:00:00Z', quoi: 'moteur', de: '0.1.6-alpha.2', vers: '0.1.7-alpha.1', resultat: 'echec', raison: 'boot échoué' } })
await journaliser({ fs: fsFixe, journal: JOURNAL, op: { date: '2026-09-22T11:01:00Z', quoi: 'moteur', de: '0.1.7-alpha.1', vers: '0.1.6-alpha.2', resultat: 'retour-arriere', raison: 'photo remise' } })
ok('journal : chaque opération ajoute une ligne', journalBrut.length === 2)
const j = lireJournal({ fs: fsFixe, journal: JOURNAL })
ok('journal : le plus récent d\'abord, lisible', j.length === 2 && j[0].de === '0.1.7-alpha.1' && j[0].resultat === 'retour-arriere', JSON.stringify(j[0]))
ok('journal : garde DE → VERS et le résultat', j.every((e) => e.de !== undefined && e.vers !== undefined && e.resultat !== undefined))

// ── 7. alignement de la fiche (le geste qui a manqué ce matin) ────────────
ecrits = []
alignerPins({ fs: fsFixe, profilDir: PROFIL, cible: '0.1.7-alpha.1' })
const pkgEcrit = ecrits.find((e) => e.p === join(PROFIL, 'package.json'))
ok('alignerPins : réécrit le package.json du profil', pkgEcrit !== undefined)
const nouveau = JSON.parse(pkgEcrit.c)
ok('alignerPins : TOUS les pins @deepseek-ai passent à la cible', nouveau.dependencies['@deepseek-ai/dsh-browser-use'] === '0.1.7-alpha.1')
ok('alignerPins : les @local/* sont préservés', Object.keys(nouveau.dependencies).some((k) => k === '@local/kybernos'))
ok('alignerPins : les bundles sont préservés', nouveau.dsh.profile.bundles.includes('@local/kybernos'))

ecrits = []
alignerLiens({ fs: fsFixe, profilDir: PROFIL, repoDir: R, packages: [{ dir: 'kybernos-plugin', nom: '@local/kybernos' }, { dir: 'kybernos-maintenance', nom: '@local/kybernos-maintenance' }] })
const pkgLiens = JSON.parse(ecrits.find((e) => e.p === join(PROFIL, 'package.json')).c)
ok('alignerLiens : ajoute un @local manquant avec link:', pkgLiens.dependencies['@local/kybernos-maintenance'] === 'link:' + join(R, 'kybernos-maintenance'))
ok('alignerLiens : le bundle suit le lien', pkgLiens.dsh.profile.bundles.includes('@local/kybernos-maintenance'))
ok('alignerLiens : ne duplique pas un lien existant', pkgLiens.dsh.profile.bundles.filter((b) => b === '@local/kybernos').length === 1)

// ── 8. LISEZ-MOI de rollback ──────────────────────────────────────────────
const texte = ecrireLisezMoi({ photo: join(PHOTOS, 'x'), versions: { global: '0.1.6-alpha.2', plugin: 'abc' }, date: '2026-09-22' })
ok('LISEZ-MOI : contient la commande rollback pointant sur la photo', texte.includes('rollback') && texte.includes('x'), texte.slice(0, 80))

// ── 9. constantes de verdict ───────────────────────────────────────────────
ok('DEPUIS_VERS existe (de/vers jamais vides)', typeof DEPUIS_VERS === 'object')

// ── 9bis. la porte de compatibilité compare des VERSIONS, pas des chaînes ──
// `'0.1.10-alpha.1' > '0.1.7-alpha.1'` est FAUX en JavaScript (comparaison
// alphabétique) alors que c'est vrai en semver : une porte qui se trompe refuse
// la bonne version, ou laisse passer une version jamais testée.
ok('comparerVersions : 0.1.10-alpha.1 est postérieur à 0.1.7-alpha.1',
  comparerVersions('0.1.10-alpha.1', '0.1.7-alpha.1') > 0)
ok('comparerVersions : 0.1.7-alpha.1 est postérieur à 0.1.6-alpha.2',
  comparerVersions('0.1.7-alpha.1', '0.1.6-alpha.2') > 0)
ok('comparerVersions : une version finale passe après sa rc',
  comparerVersions('0.1.7', '0.1.7-rc.1') > 0)
ok('comparerVersions : rc.2 passe après rc.1',
  comparerVersions('0.1.6-rc.2', '0.1.6-rc.1') > 0)
ok('comparerVersions : alpha.2 passe après alpha.1',
  comparerVersions('0.1.6-alpha.2', '0.1.6-alpha.1') > 0)
ok('comparerVersions : deux fois la même version sont égales',
  comparerVersions('0.1.7-alpha.1', '0.1.7-alpha.1') === 0)
ok('la porte accepte une cible postérieure dans la zone (0.1.6 → 0.1.7)',
  testerCompatibilite({ cible: '0.1.7-alpha.1', compat: { dsh: { min: '0.1.6-alpha.2', max: '0.1.7-alpha.1' } } }).verdict === 'ok')
ok('la porte refuse 0.1.10-alpha.1 hors zone (le piège alphabétique)',
  testerCompatibilite({ cible: '0.1.10-alpha.1', compat: { dsh: { min: '0.1.6-alpha.2', max: '0.1.7-alpha.1' } } }).verdict === 'refuse')
ok('la porte refuse une version antérieure à la zone',
  testerCompatibilite({ cible: '0.1.5-rc.3', compat: { dsh: { min: '0.1.6-alpha.2', max: '0.1.7-alpha.1' } } }).verdict === 'refuse')

// ── 9ter. le serveur est-il plus vieux que l'installation ? ────────────────
// Le mélange « serveur 0.1.6 en mémoire / fichiers 0.1.7 sur le disque » est ce
// qui affichait « Failed to load plugins — jobs: waiting for service: jobs ».
const T = 1_700_000_000_000
ok('fraîcheur : un serveur POSTÉRIEUR à l\'installation est sain',
  inspecterFraicheur({ demarrageServeur: T + 60_000, installation: T }).verdict === 'frais')
ok('fraîcheur : un serveur ANTÉRIEUR de 4 h est signalé périmé',
  inspecterFraicheur({ demarrageServeur: T - 4 * 3600_000, installation: T }).perime === true)
ok('fraîcheur : le retard est rendu lisible (heures → secondes)',
  /14400 s/.test(inspecterFraicheur({ demarrageServeur: T - 4 * 3600_000, installation: T }).raison))
ok('fraîcheur : l\'écart de quelques secondes est absorbé (tolérance)',
  inspecterFraicheur({ demarrageServeur: T - 5_000, installation: T, toleranceMs: 10_000 }).perime === false)
ok('fraîcheur : un serveur absent ne bloque pas le doctor',
  inspecterFraicheur({ demarrageServeur: null, installation: T }).verdict === 'inconnu' &&
  inspecterFraicheur({ demarrageServeur: null, installation: T }).perime === false)

// ── 10. alignerPins : un paquet absent de la cible est RETIRÉ (mesuré) ─────
// Ce que ça répare, mesuré le 2026-09-22 : `dsh-experimental-agent-team-web-profile`
// s'arrête à 0.1.6-alpha.2 (fusionné en amont dans `dsh-experimental-agent-team-profile`).
// L'alignement historique le pinçait quand même sur 0.1.7-alpha.1 → pnpm du profil
// en ERR_PNPM_NO_MATCHING_VERSION → rollback de tout l'upgrade.
const PROFIL_MESURE = join(R, 'mesure')
mkdirSync(PROFIL_MESURE, { recursive: true })
const cheminMesure = join(PROFIL_MESURE, 'package.json')
writeFileSync(cheminMesure, JSON.stringify({
  name: 'dsh-profile-web', private: true,
  dependencies: {
    '@deepseek-ai/dsh-browser-use': '0.1.6-alpha.2',
    '@deepseek-ai/dsh-experimental-agent-team-web-profile': '0.1.6-alpha.2',
    '@local/kybernos': 'link:' + join(R, 'repo', 'kybernos')
  },
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-experimental-agent-team-web-profile', '@local/kybernos'] } }
}, null, 2) + '\n')
const fsDisque = { ...fsFixe, lire: (p) => readFileSync(p, 'utf8'), ecrire: (p, c) => writeFileSync(p, c) }
const mesure = alignerPins({
  fs: fsDisque,
  profilDir: PROFIL_MESURE,
  cible: '0.1.7-alpha.1',
  disponibles: {
    '@deepseek-ai/dsh-browser-use': ['0.1.6-alpha.2', '0.1.7-alpha.1'],
    '@deepseek-ai/dsh-experimental-agent-team-web-profile': ['0.1.6-alpha.2']
  }
})
ok('alignerPins mesuré : le paquet publié à la cible est épinglé',
  mesure.pkg.dependencies['@deepseek-ai/dsh-browser-use'] === '0.1.7-alpha.1')
ok('alignerPins mesuré : le paquet absent de la cible est retiré des dépendances',
  mesure.pkg.dependencies['@deepseek-ai/dsh-experimental-agent-team-web-profile'] === undefined)
ok('alignerPins mesuré : son bundle est retiré aussi',
  mesure.pkg.dsh.profile.bundles.includes('@deepseek-ai/dsh-experimental-agent-team-web-profile') === false)
ok('alignerPins mesuré : les bundles indépendants sont préservés',
  mesure.pkg.dsh.profile.bundles.includes('@deepseek-ai/dsh-base') && mesure.pkg.dsh.profile.bundles.includes('@local/kybernos'))
ok('alignerPins mesuré : il nomme le retrait et la dernière version publiée',
  mesure.retires.length === 1 && mesure.retires[0].derniere === '0.1.6-alpha.2',
  JSON.stringify(mesure.retires))
ok('alignerPins mesuré : le profil sur disque ne porte plus le paquet fantôme',
  JSON.parse(readFileSync(cheminMesure, 'utf8')).dependencies['@deepseek-ai/dsh-experimental-agent-team-web-profile'] === undefined)

// Sans mesure (registre injoignable), on retombe sur le geste historique :
// épingler la cible. L'échec pnpm éventuel est alors visible et non silencieux.
const PROFIL_HIST = join(R, 'historique')
mkdirSync(PROFIL_HIST, { recursive: true })
writeFileSync(join(PROFIL_HIST, 'package.json'), JSON.stringify({
  name: 'dsh-profile-web', private: true,
  dependencies: { '@deepseek-ai/dsh-browser-use': '0.1.6-alpha.2', '@deepseek-ai/dsh-experimental-agent-team-web-profile': '0.1.6-alpha.2' },
  dsh: { profile: { bundles: [] } }
}, null, 2) + '\n')
ok('alignerPins sans mesure : le comportement historique est conservé (épinglé à la cible)',
  alignerPins({ fs: fsDisque, profilDir: PROFIL_HIST, cible: '0.1.7-alpha.1' })
    .pkg.dependencies['@deepseek-ai/dsh-experimental-agent-team-web-profile'] === '0.1.7-alpha.1')

// ── 9. le profil VIERGE (machine nue) : ne pas planter, dire le geste ──────
// Défaut trouvé en SONDANT, pas en relisant : `doctor` sur un profil qui
// n'existe pas encore mourait sur `node:fs:539` (ENOENT package.json). C'est
// exactement l'état d'un testeur qui vient de poser DSH et n'a rien lancé.
const fsVierge = {
  existe: () => false,
  lire: (p) => { throw new Error('ENOENT: ' + p) },
  ecrire: () => {}, lister: () => [], copier: () => {}, creerRep: () => {},
}
const doctorVierge = await etatDoctor({ fs: fsVierge, exec: execV, profilDir: join(R, 'profil-qui-nexiste-pas'), repoDir: R, packages: [{ dir: 'kybernos-plugin', nom: '@local/kybernos' }], patches: [], compatChemin: join(R, 'dsh-compat.json') })
ok('profil vierge : le doctor NE PLANTE PAS', doctorVierge !== undefined && doctorVierge.profil === 'absent')
ok('profil vierge : UNE seule phrase, pas douze « non lié »', doctorVierge.problemes.length === 1, JSON.stringify(doctorVierge.problemes))
ok('profil vierge : la phrase dit le geste à faire', /dsh web|install/.test(doctorVierge.problemes[0]), doctorVierge.problemes[0])
const doctorViergeSansMoteur = await etatDoctor({ fs: fsVierge, exec: execFixe({ '--version': { code: 1, sortie: '' } }), profilDir: join(R, 'encore-moins'), repoDir: R, packages: [], patches: [], compatChemin: join(R, 'dsh-compat.json') })
ok('profil vierge ET moteur absent : la phrase propose l\'installeur', /kybernos-install/.test(doctorViergeSansMoteur.problemes[0]), doctorViergeSansMoteur.problemes[0])

rmSync(R, { recursive: true, force: true })
// ── 12. le câblage du moteur VIVANT (dsh-lifecycle.mjs) ─────────────────────
// Ces quatre gardes tiennent les deux défauts trouvés au laboratoire le
// 23/09/2026, mesurés en jouant le scénario B-m :
//   · `npm i -g` en mise à jour => EEXIST sur le lien que NOTRE installation a
//     posé, et aucun sous-paquet épinglé ;
//   · `moteurEpinglé()` (le dossier le plus récent) faisait travailler le doctor
//     et le retour arrière dans un arbre que personne ne lançait.
const CLI = readFileSync(join(ICI, 'dsh-lifecycle.mjs'), 'utf8')
ok('la mise à jour du moteur ne passe plus par npm i -g (EEXIST mesuré)', CLI.includes("'i', '-g'") === false)
ok('elle remplace le moteur par le chemin de l\'installation', CLI.includes('await installerMoteur(cible, { tolere: true })') === true)
ok('installerMoteur peut LEVER au lieu de sortir', CLI.includes('opts.tolere === true') && CLI.includes('throw new Error(message)'))
ok('moteurDuLien lit le moteur que `dsh` lance vraiment', CLI.includes('const moteurDuLien = async ()') === true)
ok('il passe AVANT moteurEpinglé dans racineGlobale',
  CLI.indexOf('const duLien = await moteurDuLien()') > 0 &&
  CLI.indexOf('const duLien = await moteurDuLien()') < CLI.indexOf('const epingle = moteurEpinglé()'))
ok('les DEUX côtés sont résolus (piège /tmp vs /private/tmp)',
  CLI.includes('realpathSync(MOTEUR_DIR)') === true && CLI.includes('realpathSync(join(prefixe, \'bin\', nom))') === true)
ok('le cache de racine tombe quand le moteur change', /RACINE_CACHE = null[\s\S]{0,120}dsh lié|dsh lié[\s\S]{0,200}RACINE_CACHE = null/.test(CLI) || CLI.includes('RACINE_CACHE = null') === true)

console.log(ko === 0 ? `\nMOTEUR DE CYCLE DE VIE — ${n} assertions, 0 échec` : `\n✗ ${ko} échec(s) sur ${n}`)
process.exit(ko === 0 ? 0 : 1)