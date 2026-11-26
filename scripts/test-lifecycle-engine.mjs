#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// Harnais du moteur de cycle de vie — fonctions pures sur FIXTURES.
// Aucun disque réel, aucun npm : fs/exec/horloge injectés.
//
//   node scripts/test-lifecycle-engine.mjs
// Sortie 0 si tout passe.
// ═══════════════════════════════════════════════════════════════════════════

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ICI = join(dirname(fileURLToPath(import.meta.url)))
import {
  lireCompat, testerCompatibilite, testerNoeud, plageDeNoeud, noeudRepond, comparerVersions, inspecterFraicheur, versionDuGlobal, etatDoctor, planUpgrade,
  photographier, restaurerPhoto, photoLaPlusRecente, journaliser, lireJournal,
  alignerPins, alignerLiens, retirerRangeesPatch, verifierBundles, ecrireLisezMoi,
  DEPUIS_VERS, motifDeRetrait, migrerProfil
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
ok('le refus s\'explique, en anglais (A6-18)', /never been tested|tested range/i.test(c2.raison) && !/jamais|testé/i.test(c2.raison), c2.raison)
const c3 = testerCompatibilite({ cible: '0.1.7-alpha.1', compat, force: true })
ok('--force passe le refus avec avertissement', c3.verdict === 'force' && c3.bloquant === false, JSON.stringify(c3))
const c4 = testerCompatibilite({ cible: '0.1.5-rc.9', compat })
ok('sous le minimum → refus aussi', c4.verdict === 'refuse', JSON.stringify(c4))

// ── 1ter. the Node that runs the engine ───────────────────────────────────
{
  const zone = { dsh: { min: '0.1.6-alpha.2', max: '0.2.2-rc.1', node: { min: '24.9.0', from: '0.2.2-alpha.2' } } }
  const nd = (cible, noeud, force) => testerNoeud({ cible, compat: zone, noeud, force })
  ok('Node 24.22 fits DSH 0.2.2-rc.1', nd('0.2.2-rc.1', '24.22.2').verdict === 'ok' && nd('0.2.2-rc.1', 'v24.22.2').verdict === 'ok')
  ok('Node 22 is refused for DSH 0.2.2-rc.1, in English, with what to do and the way out', (() => {
    const r = nd('0.2.2-rc.1', '22.23.4')
    return r.verdict === 'refuse' && r.bloquant === true && /too old/.test(r.raison) && /24\.9\.0/.test(r.raison) && /nodejs\.org/.test(r.raison) && /--force/.test(r.raison) && /Nothing was changed/.test(r.raison)
  })())
  ok('the floor is a floor: 24.8.9 is refused, 24.9.0 and 26.7.0 pass', nd('0.2.2-rc.1', '24.8.9').verdict === 'refuse' && nd('0.2.2-rc.1', '24.9.0').verdict === 'ok' && nd('0.2.2-rc.1', '26.7.0').verdict === 'ok')
  ok('the first engine that declares it (alpha.2) is held to it, the one before is not', nd('0.2.2-alpha.2', '22.19.0').verdict === 'refuse' && nd('0.2.1-rc.5', '20.0.0').verdict === 'ok' && nd('0.1.6-alpha.2', '18.0.0').verdict === 'ok')
  ok('--force goes on with a warning that says it is not supported', (() => { const r = nd('0.2.2-rc.1', '22.23.4', true); return r.verdict === 'force' && r.bloquant === false && r.avertissement === true && /not supported/.test(r.raison) })())
  ok('what cannot be read never blocks: no Node, no target, no requirement declared', nd('0.2.2-rc.1', '').verdict === 'inconnu' && nd('0.2.2-rc.1', undefined).verdict === 'inconnu' && nd('', '22.1.0').verdict === 'inconnu'
    && testerNoeud({ cible: '0.2.2-rc.1', compat: { dsh: { min: '0.1.6-alpha.2', max: '0.2.2-rc.1' } }, noeud: '18.0.0' }).verdict === 'ok')
  ok('the repository\'s own dsh-compat.json declares the floor, and its max engine is held to it', (() => {
    const real = JSON.parse(readFileSync(join(ICI, '..', 'dsh-compat.json'), 'utf8'))
    return real.dsh.node?.min === '24.9.0' && comparerVersions(real.dsh.max, real.dsh.node.from) >= 0 && testerNoeud({ cible: real.dsh.max, compat: real, noeud: '22.23.4' }).verdict === 'refuse'
  })())
  // From DSH 0.2.3-alpha.1 the engine declares a RANGE: "^24.22.3 || >=26.13.1". A single floor cannot say it (24.22.3 would pass 26.7.0).
  const RANGE = '^24.22.3 || >=26.13.1'
  ok('noeudRepond reads the range DSH writes: the 24 line from 24.22.3, the 26 line from 26.13.1, nothing in between', (() => {
    const r = (v) => noeudRepond(v, RANGE)
    return r('24.22.3') === true && r('24.30.0') === true && r('v26.13.1') === true && r('27.0.0') === true
      && r('24.22.2') === false && r('24.9.0') === false && r('25.5.0') === false && r('26.7.0') === false && r('26.13.0') === false
  })())
  ok('noeudRepond: a part it does not read gives null (never a refusal), a readable alternative still wins', noeudRepond('26.7.0', '>=24') === null && noeudRepond('26.7.0', '') === null && noeudRepond('24.22.3', '^24.22.3 || something') === true)
  const avecPlages = { dsh: { min: '0.1.6-alpha.2', max: '0.2.3-alpha.2', node: { min: '24.9.0', from: '0.2.2-alpha.2', ranges: [{ from: '0.2.3-alpha.1', node: RANGE }] } } }
  ok('plageDeNoeud: none before the engine that declares it, the range from it on, the newest entry wins in any order', (() => {
    const e = avecPlages.dsh.node
    const deux = { ranges: [{ from: '0.2.3-alpha.1', node: RANGE }, { from: '0.2.4-rc.1', node: '^24.30.0' }] }
    const inverse = { ranges: deux.ranges.slice().reverse() }
    return plageDeNoeud(e, '0.2.2-rc.5') === null && plageDeNoeud(e, '0.2.3-alpha.1') === RANGE && plageDeNoeud(e, '0.2.3-alpha.2') === RANGE && plageDeNoeud(e, '0.2.3') === RANGE
      && plageDeNoeud(deux, '0.2.4-rc.2') === '^24.30.0' && plageDeNoeud(inverse, '0.2.4-rc.2') === '^24.30.0' && plageDeNoeud(deux, '0.2.3-alpha.2') === RANGE
      && plageDeNoeud({ min: '24.9.0' }, '0.2.3-alpha.2') === null && plageDeNoeud(undefined, '0.2.3-alpha.2') === null
  })())
  ok('0.2.3-alpha.2 on Node 26.7.0 is refused (the floor of the line before would let it through), in English, with the way out', (() => {
    const r = testerNoeud({ cible: '0.2.3-alpha.2', compat: avecPlages, noeud: '26.7.0' })
    return r.verdict === 'refuse' && r.bloquant === true && /does not fit/.test(r.raison) && r.raison.includes(RANGE) && /brew upgrade node/.test(r.raison) && /Nothing was changed/.test(r.raison) && /--force/.test(r.raison)
  })())
  ok('0.2.3-alpha.2 fits Node 26.13.1 and 24.22.3, is refused on 24.9.0 and 22', ['26.13.1', 'v26.13.1', '24.22.3', '27.1.0'].every((n) => testerNoeud({ cible: '0.2.3-alpha.2', compat: avecPlages, noeud: n }).verdict === 'ok')
    && ['24.9.0', '24.22.2', '22.23.4', '25.0.0'].every((n) => testerNoeud({ cible: '0.2.3-alpha.2', compat: avecPlages, noeud: n }).verdict === 'refuse'))
  ok('the engine before keeps the plain floor: rc.5 still runs on Node 26.7.0 and 24.9.0, and --force goes on with a warning on the new one', testerNoeud({ cible: '0.2.2-rc.5', compat: avecPlages, noeud: '26.7.0' }).verdict === 'ok'
    && testerNoeud({ cible: '0.2.2-rc.5', compat: avecPlages, noeud: '24.9.0' }).verdict === 'ok'
    && (() => { const r = testerNoeud({ cible: '0.2.3-alpha.2', compat: avecPlages, noeud: '26.7.0', force: true }); return r.verdict === 'force' && r.bloquant === false && /not supported/.test(r.raison) })())
  ok('a range the gate cannot read never blocks', testerNoeud({ cible: '0.2.3-alpha.2', compat: { dsh: { ...avecPlages.dsh, node: { ...avecPlages.dsh.node, ranges: [{ from: '0.2.3-alpha.1', node: '>=24' }] } } }, noeud: '22.0.0' }).verdict === 'inconnu')
  ok('the repository\'s dsh-compat.json carries the range for 0.2.3-alpha.1 and later, and the gate applies it to its own file', (() => {
    const real = JSON.parse(readFileSync(join(ICI, '..', 'dsh-compat.json'), 'utf8'))
    const g = (n) => testerNoeud({ cible: '0.2.3-alpha.2', compat: real, noeud: n }).verdict
    return plageDeNoeud(real.dsh.node, '0.2.3-alpha.2') === RANGE && g('26.7.0') === 'refuse' && g('26.13.1') === 'ok' && g('24.22.3') === 'ok'
  })())
}

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
ok('doctor : le problème est dit en anglais (A6-18)', doctorDiverge.problemes.some((p) => /profile pins/.test(p)) && !doctorDiverge.problemes.some((p) => /épingl|profil /.test(p)), doctorDiverge.problemes[0])

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
ok('photo : contient package.json, lock, cordis, README, versions', ['package.json', 'pnpm-lock.yaml', 'cordis.patch.yml', 'README.txt', 'versions.txt'].every((f) => chemins.some((p) => p.endsWith(f))), chemins.join(','))
const lisez = ecrits.find((e) => e.p.endsWith('README.txt'))
ok('photo : le README dit comment revenir en arrière, en anglais', /rollback/.test(lisez.c) && /To come back to this state/.test(lisez.c) && !/Pour revenir|Photo de sécurité/.test(lisez.c))

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
ok('alignerLiens : ajoute un @local manquant avec link:', pkgLiens.dependencies['@local/kybernos-maintenance'] === 'link:' + join(R, 'packages', 'kybernos-maintenance'))
ok('alignerLiens : le bundle suit le lien', pkgLiens.dsh.profile.bundles.includes('@local/kybernos-maintenance'))
ok('alignerLiens : ne duplique pas un lien existant', pkgLiens.dsh.profile.bundles.filter((b) => b === '@local/kybernos').length === 1)
// ── 7a. a bundle whose folder was deleted from the repository leaves the profile that still carries it ──
{
  const faux = (fichiers) => ({ existe: (p) => p in fichiers, lire: (p) => fichiers[p], ecrire: (p, c) => { fichiers[p] = c } })
  const PKG = JSON.stringify({ dependencies: { '@local/kybernos': 'link:' + join(R, 'packages', 'kybernos-plugin'), '@local/kybernos-computers': 'link:/gone/packages/kybernos-computers', '@local/kybernos-registrynom': '^1.0.0' }, dsh: { profile: { bundles: ['@local/kybernos', '@local/kybernos-computers'] } } })
  const PATCH = '- id: tools\n  disabled: false\n\n- id: kybernos-computers\n  disabled: true\n\n- id: other\n  disabled: false\n'
  const RET = [{ dir: 'kybernos-computers', nom: '@local/kybernos-computers', patchId: 'kybernos-computers' }]
  const PACK = [{ dir: 'kybernos-plugin', nom: '@local/kybernos' }]
  let f = { [join(PROFIL, 'package.json')]: PKG, [join(PROFIL, 'cordis.patch.yml')]: PATCH }
  alignerLiens({ fs: faux(f), profilDir: PROFIL, repoDir: R, packages: PACK, retires: RET })
  const apres = JSON.parse(f[join(PROFIL, 'package.json')])
  ok('retires: the link and the bundle of the vanished package leave the profile', apres.dependencies['@local/kybernos-computers'] === undefined && !apres.dsh.profile.bundles.includes('@local/kybernos-computers'))
  ok('retires: the other links and bundles stay', apres.dependencies['@local/kybernos'] !== undefined && apres.dsh.profile.bundles.includes('@local/kybernos'))
  ok('retires: a dependency that is not a link is left alone', apres.dependencies['@local/kybernos-registrynom'] === '^1.0.0')
  ok('retires: the `disabled` row of the package leaves cordis.patch.yml with no gap, the other rows stay', f[join(PROFIL, 'cordis.patch.yml')] === '- id: tools\n  disabled: false\n\n- id: other\n  disabled: false\n', JSON.stringify(f[join(PROFIL, 'cordis.patch.yml')]))
  f = { [join(PROFIL, 'package.json')]: PKG, [join(PROFIL, 'cordis.patch.yml')]: PATCH }
  alignerLiens({ fs: faux(f), profilDir: PROFIL, repoDir: R, packages: PACK })
  ok('retires: with no list nothing changes (the link stays)', JSON.parse(f[join(PROFIL, 'package.json')]).dependencies['@local/kybernos-computers'] !== undefined && f[join(PROFIL, 'cordis.patch.yml')] === PATCH)
  const PORTEUSE = '- id: kybernos-computers\n  config:\n    apiKeyEnv: E2B_API_KEY\n\n- id: other\n  disabled: false\n'
  f = { [join(PROFIL, 'cordis.patch.yml')]: PORTEUSE }
  const r = retirerRangeesPatch({ fs: faux(f), profilDir: PROFIL, ids: ['kybernos-computers'] })
  ok('retires: a row that carries anything but `disabled` is kept and named', r.gardees.join() === 'kybernos-computers' && r.retirees.length === 0 && f[join(PROFIL, 'cordis.patch.yml')] === PORTEUSE)
  ok('retires: no cordis.patch.yml, no error', retirerRangeesPatch({ fs: faux({}), profilDir: PROFIL, ids: ['x'] }).retirees.length === 0)
  ok('retires: an id that is not in the file changes nothing', retirerRangeesPatch({ fs: faux({ [join(PROFIL, 'cordis.patch.yml')]: PATCH }), profilDir: PROFIL, ids: ['nope'] }).retirees.length === 0)
  // The real list: a retired package has no folder left under packages/ and is not in the managed list (else the robot would link it back).
  const REEL = JSON.parse(readFileSync(join(ICI, 'lifecycle-packages.json'), 'utf8'))
  const retiresReels = Array.isArray(REEL.retires) ? REEL.retires : []
  ok('retires (real list): every entry names a dir and a package, and says since when', retiresReels.length > 0 && retiresReels.every((e) => typeof e.dir === 'string' && typeof e.nom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.depuis ?? '')), retiresReels.map((e) => e.dir))
  ok('retires (real list): none of them is still a package folder or a managed package', retiresReels.every((e) => !existsSync(join(ICI, '..', 'packages', e.dir, 'package.json')) && !REEL.packages.some((p) => p.nom === e.nom || p.dir === e.dir)), retiresReels.map((e) => e.dir))
}
// ── 7b. move to packages/: an old flat link is re-pointed, a foreign link is not ──
{
  const pkgAncien = JSON.stringify({
    name: 'dsh-profile-web', private: true,
    dependencies: {
      '@local/kybernos-maintenance': 'link:' + join(R, 'kybernos-maintenance'),
      '@local/kybernos-theme': 'link:/home/dev/mon-checkout/kybernos-theme'
    },
    dsh: { profile: { bundles: ['@local/kybernos-maintenance', '@local/kybernos-theme'] } }
  })
  const fsAncien = { ...fsFixe, lire: (p) => (p.endsWith('package.json') && p.startsWith(PROFIL) ? pkgAncien : fsFixe.lire(p)) }
  ecrits = []
  alignerLiens({ fs: fsAncien, profilDir: PROFIL, repoDir: R, packages: [{ dir: 'kybernos-maintenance', nom: '@local/kybernos-maintenance' }, { dir: 'kybernos-theme', nom: '@local/kybernos-theme' }] })
  const depsApres = JSON.parse(ecrits.find((e) => e.p === join(PROFIL, 'package.json')).c).dependencies
  ok('alignerLiens : un ancien lien à plat est ré-pointé vers packages/', depsApres['@local/kybernos-maintenance'] === 'link:' + join(R, 'packages', 'kybernos-maintenance'))
  ok('alignerLiens : un lien vers un autre checkout est laissé tel quel', depsApres['@local/kybernos-theme'] === 'link:/home/dev/mon-checkout/kybernos-theme')
}

// ── 7c. explicit migration from an old repo (--migrer-depuis) ──
{
  const ANCIEN = '/home/dev/ancien-depot'
  const pkgMig = JSON.stringify({
    name: 'dsh-profile-web', private: true,
    dependencies: {
      '@local/kybernos-theme': 'link:' + join(ANCIEN, 'kybernos-theme'),
      '@local/kybernos-models': 'link:' + join(ANCIEN, 'packages', 'kybernos-models'),
      '@local/kybernos-slash': 'link:/home/dev/un-autre-checkout/kybernos-slash'
    },
    dsh: { profile: { bundles: ['@local/kybernos-theme', '@local/kybernos-models', '@local/kybernos-slash'] } }
  })
  const fsMig = { ...fsFixe, lire: (p) => (p.endsWith('package.json') && p.startsWith(PROFIL) ? pkgMig : fsFixe.lire(p)) }
  const paquetsMig = [{ dir: 'kybernos-theme', nom: '@local/kybernos-theme' }, { dir: 'kybernos-models', nom: '@local/kybernos-models' }, { dir: 'kybernos-slash', nom: '@local/kybernos-slash' }]
  ecrits = []
  alignerLiens({ fs: fsMig, profilDir: PROFIL, repoDir: R, packages: paquetsMig })
  let deps = JSON.parse(ecrits.find((e) => e.p === join(PROFIL, 'package.json')).c).dependencies
  ok('sans --migrer-depuis, les liens de l\'ancien dépôt restent intacts (jamais silencieux)', deps['@local/kybernos-theme'] === 'link:' + join(ANCIEN, 'kybernos-theme') && deps['@local/kybernos-models'] === 'link:' + join(ANCIEN, 'packages', 'kybernos-models'))
  ecrits = []
  alignerLiens({ fs: fsMig, profilDir: PROFIL, repoDir: R, packages: paquetsMig, anciensDepots: [ANCIEN] })
  deps = JSON.parse(ecrits.find((e) => e.p === join(PROFIL, 'package.json')).c).dependencies
  ok('avec --migrer-depuis, un lien à plat de l\'ancien dépôt est ré-pointé', deps['@local/kybernos-theme'] === 'link:' + join(R, 'packages', 'kybernos-theme'))
  ok('avec --migrer-depuis, un lien packages/ de l\'ancien dépôt aussi', deps['@local/kybernos-models'] === 'link:' + join(R, 'packages', 'kybernos-models'))
  ok('avec --migrer-depuis, un lien vers un AUTRE checkout reste intact', deps['@local/kybernos-slash'] === 'link:/home/dev/un-autre-checkout/kybernos-slash')
}

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


// ── retouches retirées : partout, ou seulement à partir d'une version du moteur ──
{
  const partout = { id: 'x', retire: 'motif quelconque' }
  const depuis = { id: 'y', retire_depuis_moteur: '0.2.0-rc.2', retire_motif: 'migrée dans le plugin, mesurée sur 0.2.0-rc.2' }
  ok('motifDeRetrait : `retire` vaut pour tous les moteurs, même inconnu', motifDeRetrait(partout, '0.1.6-alpha.2') === 'motif quelconque' && motifDeRetrait(partout, null) === 'motif quelconque')
  ok('motifDeRetrait : retirée sur le moteur du seuil (0.2.0-rc.2)', motifDeRetrait(depuis, '0.2.0-rc.2') === 'migrée dans le plugin, mesurée sur 0.2.0-rc.2')
  ok('motifDeRetrait : retirée sur un moteur plus récent (0.2.0, 0.10.0)', motifDeRetrait(depuis, '0.2.0') !== null && motifDeRetrait(depuis, '0.10.0') !== null)
  ok('motifDeRetrait : PAS retirée sur les moteurs plus anciens de la zone (0.1.6, 0.1.7, 0.1.7-rc.2)', ['0.1.6-alpha.2', '0.1.7-alpha.1', '0.1.7-rc.2'].every((v) => motifDeRetrait(depuis, v) === null))
  ok('motifDeRetrait : comparaison par segments, pas alphabétique (0.1.10 est plus ancien que 0.2.0)', motifDeRetrait(depuis, '0.1.10') === null)
  ok('motifDeRetrait : moteur inconnu (null, chaîne vide) → on ne retire rien, on ne devine pas', motifDeRetrait(depuis, null) === null && motifDeRetrait(depuis, '') === null)
  ok('motifDeRetrait : sans motif écrit, un motif par défaut qui nomme la version', /0\.2\.0-rc\.2/.test(motifDeRetrait({ retire_depuis_moteur: '0.2.0-rc.2' }, '0.2.0-rc.2')))
  ok('motifDeRetrait : une retouche ordinaire reste posée, une entrée invalide aussi', motifDeRetrait({ id: 'z' }, '0.2.0-rc.2') === null && motifDeRetrait(null, '0.2.0-rc.2') === null && motifDeRetrait(undefined, '0.2.0-rc.2') === null)
  ok('motifDeRetrait : un seuil mal typé est ignoré', motifDeRetrait({ retire_depuis_moteur: 2 }, '0.2.0-rc.2') === null)
}

// ── migrerProfil: the `tools` row with a lone `mode` goes away for DSH 0.2.2+ (measured 2026-10-30) ──
{
  const fsDur = { existe: existsSync, lire: (p) => readFileSync(p, 'utf8'), ecrire: (p, c) => writeFileSync(p, c) }
  const rangee = "- id: tools\n  config:\n    mode: !!js process.env.DSH_TOOLS_MODE || 'native'\n"
  const avant = '# patches\n- id: tool-web\n  config:\n    fetch: true\n\n' + rangee + '\n- insert:\n    - id: other\n      config: {}\n'
  const profil = (nom, contenu) => { const d = join(R, nom); mkdirSync(d, { recursive: true }); if (contenu !== null) writeFileSync(join(d, 'cordis.patch.yml'), contenu); return d }
  const lire = (d) => readFileSync(join(d, 'cordis.patch.yml'), 'utf8')

  const a = profil('migrer-a', avant)
  const ra = migrerProfil({ fs: fsDur, profilDir: a, cible: '0.2.2-alpha.2' })
  ok('migrerProfil: the lone-`mode` tools row is removed on 0.2.2-alpha.2', ra.retires.length === 1 && !/id: tools/.test(lire(a)) && !/DSH_TOOLS_MODE/.test(lire(a)))
  ok('migrerProfil: the neighbouring rows are untouched', /- id: tool-web\n  config:\n    fetch: true/.test(lire(a)) && /- insert:\n    - id: other/.test(lire(a)))
  ok('migrerProfil: it leaves a one-line comment that says why', /removed by dsh-lifecycle/.test(lire(a)))
  ok('migrerProfil: a second run changes nothing', migrerProfil({ fs: fsDur, profilDir: a, cible: '0.2.2-alpha.2' }).retires.length === 0)

  const b = profil('migrer-b', avant)
  ok('migrerProfil: on 0.2.1-rc.2 the file is not touched', migrerProfil({ fs: fsDur, profilDir: b, cible: '0.2.1-rc.2' }).retires.length === 0 && lire(b) === avant)
  ok('migrerProfil: on a later line (0.2.2, 0.3.0) it applies', ['0.2.2', '0.3.0'].every((v) => { const d = profil('migrer-v' + v, avant); return migrerProfil({ fs: fsDur, profilDir: d, cible: v }).retires.length === 1 }))

  const c = profil('migrer-c', '- id: tools\n  config:\n    mode: native\n    timeoutMs: 5000\n- id: x\n  config: {}\n')
  const rc = migrerProfil({ fs: fsDur, profilDir: c, cible: '0.2.2-alpha.2' })
  ok('migrerProfil: a tools row that carries more than `mode` is kept and named', rc.retires.length === 0 && rc.gardes.length === 1 && /timeoutMs/.test(lire(c)))

  ok('migrerProfil: no cordis.patch.yml, an empty target or no target: nothing happens, nothing throws',
    migrerProfil({ fs: fsDur, profilDir: profil('migrer-d', null), cible: '0.2.2-alpha.2' }).retires.length === 0
    && migrerProfil({ fs: fsDur, profilDir: a, cible: '' }).retires.length === 0
    && migrerProfil({ fs: fsDur, profilDir: a, cible: undefined }).retires.length === 0)

  // ── the `agent-team` row: the member cap moved to the `subagent` row on 0.2.2-rc.2 (measured 2026-11-18 on rc.5) ──
  const equipe = '- id: agent-team\n  config:\n    maxMembers: 16\n    maxTasks: 256\n    maxPendingMessagesPerMember: 64\n    maxMessageBytes: 65536\n    disposalTimeoutMs: 5000\n'
  const apres = '# patches\n- id: tool-web\n  config:\n    fetch: true\n\n' + equipe + '- id: subagent\n  config:\n    maxActiveSubagents: 20\n    maxDepth: 2\n'
  const e1 = profil('migrer-e1', apres)
  const re1 = migrerProfil({ fs: fsDur, profilDir: e1, cible: '0.2.2-rc.5' })
  ok('migrerProfil: the four refused keys of the agent-team row go, maxTasks stays', re1.nettoyes.length === 1 && re1.nettoyes[0].cles.length === 4 && re1.nettoyes[0].supprimee === false
    && !/maxMembers|maxMessageBytes|disposalTimeoutMs|maxPendingMessagesPerMember/.test(lire(e1)) && /- id: agent-team\n  config:\n    maxTasks: 256\n/.test(lire(e1)))
  ok('migrerProfil: the subagent row (the real member cap) and the other rows are untouched', /- id: subagent\n  config:\n    maxActiveSubagents: 20\n    maxDepth: 2\n/.test(lire(e1)) && /- id: tool-web\n  config:\n    fetch: true/.test(lire(e1)))
  ok('migrerProfil: a second run on the agent-team row changes nothing', migrerProfil({ fs: fsDur, profilDir: e1, cible: '0.2.2-rc.5' }).nettoyes.length === 0)
  const e2 = profil('migrer-e2', '- id: agent-team\n  config:\n    maxMembers: 16\n- id: x\n  config: {}\n')
  const re2 = migrerProfil({ fs: fsDur, profilDir: e2, cible: '0.2.2-rc.2' })
  ok('migrerProfil: a row left with no key goes away with a comment that says why, on 0.2.2-rc.2 already', re2.nettoyes.length === 1 && re2.nettoyes[0].supprimee === true
    && !/id: agent-team/.test(lire(e2)) && /removed by dsh-lifecycle: `agent-team` takes no maxMembers/.test(lire(e2)) && /- id: x\n  config: \{\}/.test(lire(e2)))
  const e3 = profil('migrer-e3', apres)
  ok('migrerProfil: on 0.2.2-rc.1 (and alpha.2) the agent-team row is NOT touched — the engine still accepts it there', ['0.2.2-rc.1', '0.2.2-alpha.2'].every((v) => migrerProfil({ fs: fsDur, profilDir: e3, cible: v }).nettoyes.length === 0) && lire(e3) === apres)
  const e4 = profil('migrer-e4', '- id: agent-team\n  config: !!js ({ maxMembers: 16 })\n')
  const re4 = migrerProfil({ fs: fsDur, profilDir: e4, cible: '0.2.2-rc.5' })
  ok('migrerProfil: an agent-team row with no plain key lines is left alone', re4.nettoyes.length === 0 && re4.gardes.length === 0 && /maxMembers/.test(lire(e4)))
  const e5 = profil('migrer-e5', '- id: agent-team\n  config:\n    maxMembers:\n      deep: 1\n')
  const re5 = migrerProfil({ fs: fsDur, profilDir: e5, cible: '0.2.2-rc.5' })
  ok('migrerProfil: a nested agent-team row is kept and named, not mangled', re5.nettoyes.length === 0 && re5.gardes.length === 1 && /deep: 1/.test(lire(e5)))
  const e6 = profil('migrer-e6', '- id: agent-team\n  config:\n    maxTasks: 128\n    defaultEnabled: true\n')
  ok('migrerProfil: an agent-team row that only carries accepted keys is not touched', migrerProfil({ fs: fsDur, profilDir: e6, cible: '0.2.2-rc.5' }).nettoyes.length === 0 && /maxTasks: 128\n    defaultEnabled: true/.test(lire(e6)))
}

console.log(ko === 0 ? `\nMOTEUR DE CYCLE DE VIE — ${n} assertions, 0 échec` : `\n✗ ${ko} échec(s) sur ${n}`)
process.exit(ko === 0 ? 0 : 1)