// ═══════════════════════════════════════════════════════════════════════════
// kybernos-sessions — host.
//
// Deux lectures réelles, aucune écriture :
//   • l'état « sessions » d'un dossier : combien de sessions y ont écrit
//     récemment (fenêtre glissante), git (branche, sale, poussé) ;
//   • l'état « mémoire » des kybers : leçons, runs du ledger, membres.
//
// Routes exposées (webServer) :
//   GET  /kybernos-sessions/state?session=<id>[&kyber=<id>][&window=24]
//   POST /kybernos-sessions/isolate     → crée OU réutilise (idempotent, marqué)
//   POST /kybernos-sessions/reclaim     → ramasse les arbres propres sans travail
//   POST /kybernos-sessions/commit      → commit attribué + merge (`local:true`
//                                          = aucun envoi GitHub)
//   POST /kybernos-sessions/close-check → « cette session est-elle clôturable ? »
//                                          (mêmes gardes que la fermeture)
//   POST /kybernos-sessions/close       → fusionne puis retire l'arbre
//   POST /kybernos-sessions/push · /fetch · /sync · /pr
//   GET|POST /kybernos-sessions/settings   → ~/.dsh/kybernos/settings.json
//        (renommage de fin de chantier, modèle d'étude `brain`, source du micro,
//         et modèle de décision `decisionBrain` : le GET annonce AUSSI les
//         modèles connus de l'API d'évaluation — la page n'en invente aucun)
//   GET  /kybernos-sessions/categories     → ~/.dsh/kybernos/categories.json
//        (la catégorie d'une session, écrite par la CLI de nommage : c'est
//         elle que la liste des chats rend en SVG, sans emoji dans le titre)
//   POST /kybernos-sessions/decision       → le CERVEAU DE DÉCISION (Jev) :
//        `{kybers:[{id,mission}],demande}` classe la demande, ou
//        `{categorie:"texte du chat"}` choisit la catégorie de session (donc
//        l'icône du nommage), ou `{state,questions}` passe une question typée.
//        Jev n'est pas un modèle
//        de langage (mesuré le 23/09/2026 : le chat rend un 400) : il vit sur
//        /v1/evaluate et rend des verdicts typés avec des probabilités.
//
// Les fonctions pures sont exportées pour le harnais
// scripts/test-kybernos-sessions-host.mjs.
// ═══════════════════════════════════════════════════════════════════════════

import { execFile } from 'node:child_process'
import { readdirSync, statSync, existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync, rmSync, realpathSync, renameSync, chmodSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'
import { creerSonde } from './brain-health.mjs'
import { decider, selectionnerKyber, selectionnerCategorie, lireModeleDecision, dshHome, CATEGORIES, MODELES_DECISION_CONNUS, MODELE_DEFAUT } from './decision.mjs'
// Hosted instance: also accept the authorities declared to DSH with --trusted-host. The core bundle publishes the predicate
// (kybernos-plugin/trusted-authority.mjs); absent or failing, it answers false and the guard stays loopback-only.
const kbTrusted = (host) => { try { const f = globalThis[Symbol.for('kybernos.trustedAuthority')]; return typeof f === 'function' && f(host) === true } catch (e) { return false } }

// ── slug du magasin de sessions ⇄ chemin ───────────────────────────────────
// Le slug encode le chemin ('/Users/me/projects/x' → '--Users-me-projects-x--')
// mais le tiret est ambigu (il séparateur ET caractère légal d'un dossier).
// On résout donc par existence : toutes les coupures possibles, on ne garde
// que les chemins qui existent, le plus profond gagne.

export function slugSegments (slug) {
  const corps = slug.replace(/^--/, '').replace(/--$/, '')
  return corps.split('-').filter((s) => s.length > 0)
}

export function decodeSlugPath (slug, exists = existsSync) {
  const segs = slugSegments(slug)
  if (segs.length === 0) return null
  const candidats = []
  const marcher = (i, chemin) => {
    if (i >= segs.length) { candidats.push(chemin); return }
    for (let j = segs.length; j > i; j -= 1) {
      const morceau = segs.slice(i, j).join('-').replace(/~([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      const suite = chemin + '/' + morceau
      if (j === segs.length) candidats.push(suite)
      else if (exists(suite)) marcher(j, suite)
    }
  }
  marcher(0, '')
  const existants = candidats.filter(exists)
  if (existants.length === 0) return null
  return existants.sort((a, b) => b.length - a.length)[0]
}

// ── magasin de sessions (~/.dsh/sessions) ───────────────────────────────────

// macOS dépose un .DS_Store (fichier) à la racine du magasin : un slug de
// dossier est TOUJOURS un répertoire, sinon `ls(join(home, slug))` jette
// ENOTDIR et toute la route répond 500.
function estDossier (chemin) {
  try { return statSync(chemin).isDirectory() } catch (e) { return false }
}

export function sessionsDuDossier (sessionsHome, slug, fenetreMs, maintenant = Date.now(), st = statSync, ls = readdirSync) {
  const dir = join(sessionsHome, slug)
  if (!existsSync(dir)) return []
  const sessions = []
  for (const nom of ls(dir)) {
    const sdir = join(dir, nom)
    const log = join(sdir, 'session.v3.jsonl.zstd')
    let logStat = null
    try { logStat = st(log) } catch (e) { continue /* pas un dossier de session */ }
    sessions.push({
      id: nom.replace(/^session-/, ''),
      mtime: logStat.mtimeMs,
      actif: maintenant - logStat.mtimeMs <= fenetreMs
    })
  }
  return sessions
}

export function repartitionParDossier (sessionsHome, fenetreMs, maintenant = Date.now(), st = statSync, ls = readdirSync) {
  const dossiers = {}
  if (!existsSync(sessionsHome)) return dossiers
  for (const slug of ls(sessionsHome)) {
    if (!estDossier(join(sessionsHome, slug))) continue
    const sessions = sessionsDuDossier(sessionsHome, slug, fenetreMs, maintenant, st, ls)
    if (sessions.length === 0) continue
    const actifs = sessions.filter((s) => s.actif)
    dossiers[slug] = {
      sessionsTotal: sessions.length,
      sessionsActives: actifs.length,
      derniereActivite: Math.max(...sessions.map((s) => s.mtime))
    }
  }
  return dossiers
}

export function dossierDeSession (sessionsHome, sessionId, ls = readdirSync) {
  if (!existsSync(sessionsHome)) return null
  const cible = String(sessionId || '').replace(/^session-/, '')
  for (const slug of ls(sessionsHome)) {
    if (!estDossier(join(sessionsHome, slug))) continue
    for (const nom of ls(join(sessionsHome, slug))) {
      if (nom.replace(/^session-/, '') === cible) return slug
    }
  }
  return null
}

// ── git (exécution, jamais d'écriture) ─────────────────────────────────────

const gitRun = (args, cwd) => new Promise((res) => {
  execFile('git', args, { cwd, timeout: 15000 }, (err, stdout, stderr) =>
    res({ ok: !err, out: String(stdout || ''), err: String(stderr || '') }))
})

// v3 « status light » — même contrat pour gh (pull requests).
const ghRun = (args, cwd) => new Promise((res) => {
  execFile('gh', args, { cwd, timeout: 20000 }, (err, stdout, stderr) =>
    res({ ok: !err, out: String(stdout || ''), err: String(stderr || (err && err.message) || '') }))
})

// Cache des lectures gh (la GUI interroge l'état toutes les 30 s ; gh prend
// quelques centaines de ms et n'apporte rien en boucle).
const cachePr = new Map() // chemin -> { t, val }
const git = gitRun

// Les chemins d'un `git status --porcelain` : « M fichier », « ?? dossier/ »,
// « R  ancien -> nouveau ». Un dossier non suivi est rendu AINSI, avec son
// slash final — d'où `estSale`, qui reconnaît aussi les fichiers qu'il
// contient : sans cela, un fichier neuf dans un dossier neuf passait pour
// « déjà enregistré » et le commit était sauté en silence.
export function cheminsSales (out) {
  return String(out || '').split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim() !== '')
    .map((l) => l.slice(3).trim().replace(/^"/, '').replace(/"$/, '').split(' -> ').pop())
    .filter((p) => p !== '')
}
// Les mêmes chemins AVEC leur code `XY` (« M », « ?? », « UU »…), pour dire ce qui a changé et non seulement où :
// le plugin « Changes » les range en modifié / nouveau / supprimé / en conflit. Champ additif de l'état.
export function fichiersSales (out) {
  return String(out || '').split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim() !== '')
    .map((l) => ({ code: l.slice(0, 2).trim(), chemin: l.slice(3).trim().replace(/^"/, '').replace(/"$/, '').split(' -> ').pop() }))
    .filter((f) => f.chemin !== '')
}
export function estSale (sales, p) {
  return (Array.isArray(sales) ? sales : []).some((s) => {
    const brut = String(s)
    const t = brut.replace(/\/+$/, '')
    if (t === p) return true
    return brut.charAt(brut.length - 1) === '/' && p.indexOf(t + '/') === 0
  })
}

export async function etatGit (chemin, run = git) {
  const [branche, sale, avance, worktrees] = await Promise.all([
    run(['rev-parse', '--abbrev-ref', 'HEAD'], chemin),
    run(['status', '--porcelain'], chemin),
    run(['log', '--oneline', '@{upstream}..HEAD'], chemin),
    run(['rev-parse', '--git-dir'], chemin)
  ])
  if (!branche.ok) return { git: false }
  const gitdir = worktrees.out.trim()
  const estWorktree = /\.git\/worktrees\//.test(gitdir)
  // ── v3 « status light » : état GitHub (recu), copie non fusionnée, base,
  // remote et dernier fetch — champs additifs, les anciens restent identiques.
  const [recul, distant, baseR] = await Promise.all([
    run(['rev-list', '--count', 'HEAD..@{upstream}'], chemin),
    run(['remote', 'get-url', 'origin'], chemin),
    run(['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'], chemin)
  ])
  const base = baseR.ok && baseR.out.trim() !== ''
    ? baseR.out.trim().replace(/^origin\//, '')
    : ((await baseDuDepot(chemin, run)) || 'main')
  const fusion = estWorktree
    ? await run(['rev-list', '--count', base + '..HEAD'], chemin)
    : { ok: true, out: '0' }
  let dernierFetch = null
  for (const fd of [join(chemin, '.git', 'FETCH_HEAD'), join(gitdir, 'FETCH_HEAD')]) {
    try { dernierFetch = statSync(fd).mtime.toISOString(); break } catch (e) { /* pas de fetch */ }
  }
  return {
    git: true,
    branche: branche.out.trim(),
    modifications: sale.ok ? sale.out.split('\n').filter((l) => l.trim() !== '').length : -1,
    // La LISTE des chemins sales, pas seulement leur nombre : la carte Recap
    // peut alors dire « le travail de ce chat est enregistré » en regardant le
    // disque, même quand le commit est passé par le bouton (le journal, lui, ne
    // voit que les commits lancés par un outil de l'agent).
    sale: sale.ok ? cheminsSales(sale.out).slice(0, 200) : [],
    fichiers: sale.ok ? fichiersSales(sale.out).slice(0, 200) : [],
    commitsNonPousses: avance.ok ? avance.out.split('\n').filter((l) => l.trim() !== '').length : -1,
    commitsRecus: recul.ok ? parseInt(recul.out.trim(), 10) || 0 : -1,
    nonFusionnes: fusion.ok ? parseInt(fusion.out.trim(), 10) || 0 : -1,
    base,
    distant: distant.ok ? distant.out.trim() : null,
    worktree: estWorktree ? chemin : null,
    dernierFetch
  }
}

// ── réglages Kybernos (~/.dsh/kybernos/settings.json) ──────────────────────
// Le popup Paramètres écrit ici, la CLI de nommage LIT ici : c'est le seul
// contrat qui rende un interrupteur de la GUI réellement obéi par l'agent
// (l'agent n'a aucun accès au localStorage de la page).
//
// Quatre réglages : `renameAfterRecap` — re-titrer la session à la fin de chaque
// récapitulatif (défaut : vrai) — `brain`, le MODÈLE D'ÉTUDE que le harnais
// interroge pour dire si un modèle configuré répond encore — `voiceInput`, la
// SOURCE DU MICRO du composer : le contrôle natif du harnais (`native`) ou celui
// de Kybernos (`kybernos`, défaut), qui prend alors sa place — et `decisionBrain`,
// le MODÈLE DE DÉCISION (Jev) : celui qui répond aux questions fermées (quel
// kyber traite une demande, quelle catégorie — donc quelle icône — pour un chat).
//
// Le modèle d'étude s'écrit `route/id` : exactement l'identifiant que la page
// Models affiche. Vide = aucun modèle d'étude, donc aucun contrôle de santé —
// c'est un état légitime, pas une erreur.
//
// Le modèle de décision, lui, ne vient PAS des modèles configurés : il doit
// répondre sur l'API d'évaluation de la passerelle (`/v1/evaluate`), où Jev est
// seul aujourd'hui. Vide = le défaut (annoncé à la page, jamais recopié ici),
// `none` = cerveau éteint (chaque appelant garde sa propre règle), sinon
// l'identifiant écrit là.

export const REGLAGES_DEFAUT = { renameAfterRecap: true, brain: '', voiceInput: 'kybernos', decisionBrain: '', autoRouting: false, autoWhitelist: [], autoClassifier: '' }

/** La whitelist Auto : un tableau d'identifiants « route/id » (ou route/clé),
 *  sans doublon, plafonné à 64 entrées — les seuls modèles que le routage Auto
 *  a le droit de choisir pour une délégation. */
const whitelistValide = (v) => Array.isArray(v) && v.length <= 64 &&
  v.every((x) => brainValide(x) === true) && new Set(v).size === v.length

/** Les deux sources de dictée admises. Toute autre valeur retombe sur le défaut
 *  plutôt que d'écrire un mot que le client ne saurait pas rendre. */
export const VOICE_SOURCES = ['native', 'kybernos']
const voiceSourceValide = (v) => VOICE_SOURCES.indexOf(v) !== -1

/** Un identifiant `route/id` plausible, ou la chaîne vide. Volontairement LARGE :
 *  l'hôte ne connaît PAS la liste des modèles (elle vit dans le client, qui l'a
 *  lue du service de réglages), il refuse donc seulement ce qui ne peut pas être
 *  un identifiant — pas ce qui n'est pas *le bon*. */
const brainValide = (v) => typeof v === 'string' && v.length <= 200
  && (v === '' || /^[A-Za-z0-9._:-]+\/[A-Za-z0-9._:-]+$/.test(v))

/** Le modèle de décision accepte une valeur de plus que le modèle d'étude :
 *  `none`, qui ÉTEINT le cerveau sans le confondre avec « prends le défaut ». */
const decisionValide = (v) => (typeof v === 'string' && v === 'none') || brainValide(v)

// The seven keys this page owns, normalised: anything missing or invalid falls
// back to its default.
const normalizeSettings = (j) => ({
  renameAfterRecap: j.renameAfterRecap !== false,
  brain: brainValide(j.brain) === true ? j.brain : '',
  voiceInput: voiceSourceValide(j.voiceInput) === true ? j.voiceInput : REGLAGES_DEFAUT.voiceInput,
  decisionBrain: decisionValide(j.decisionBrain) === true ? j.decisionBrain : '',
  autoRouting: j.autoRouting === true,
  autoWhitelist: whitelistValide(j.autoWhitelist) === true ? j.autoWhitelist : [],
  autoClassifier: brainValide(j.autoClassifier) === true ? j.autoClassifier : ''
})

// Tolerant read: a missing, unreadable or mangled file gives the defaults. A
// setting must NEVER make the page that shows it fail.
export function lireReglages (fichier) {
  let brut = null
  try { brut = JSON.parse(readFileSync(fichier, 'utf8')) } catch (e) { brut = null }
  return normalizeSettings((brut !== null && typeof brut === 'object') ? brut : {})
}

// ── Safe writer for settings.json ──────────────────────────────────────────
// The file is SHARED. Besides the seven keys written here, the core bundle reads
// `pairingToken`, `gatewayBase` and `wsAdminKey` from it, kybernos-auto writes its
// own keys, and other bundles may add more. So a save is a MERGE, never a
// replace: read what is on disk, overlay the keys this page owns, keep every
// other key as it is. The write is atomic (temp file in the same directory, then
// rename), so a crash cannot leave half a file, and the file's permissions are
// kept: it holds secrets, so a file created here is 0600. If the file exists but
// is not a JSON object, nothing is written: a copy is kept next to it and the
// caller gets an error.

// KB-SETTINGS-FILE-BEGIN — the SAME text lives in packages/kybernos-sessions/index.js and
// packages/kybernos-auto/index.js (bundles ship one by one and cannot import each other);
// packages/kybernos-sessions/test-reglages.mjs fails if the two copies differ.
const CORRUPT_COPY_SUFFIX = '.corrupt-'
const CORRUPT_COPIES_MAX = 5

/** The raw object on disk: `{ raw }` (a missing or empty file is an empty object),
 *  `{ corrupt, text }` (present but not a JSON object) or `{ error }` (present but
 *  unreadable). */
function readRawSettings (file) {
  let text
  try { text = readFileSync(file, 'utf8') } catch (e) {
    if (e !== null && e !== undefined && e.code === 'ENOENT') return { raw: {} }
    return { error: 'settings.json cannot be read (' + (e && e.code ? e.code : 'unknown error') + '), so nothing was saved' }
  }
  if (text.trim() === '') return { raw: {} }
  let value
  try { value = JSON.parse(text) } catch (e) { return { corrupt: true, text } }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { corrupt: true, text }
  return { raw: value }
}

/** Keep a copy of a corrupt settings file next to it. A copy with the same content is
 *  reused, and there are never more than CORRUPT_COPIES_MAX copies, so repeated saves
 *  do not pile up files. Returns the copy's path or null. */
function keepCorruptCopy (file, text) {
  try {
    const folder = dirname(file)
    const prefix = basename(file) + CORRUPT_COPY_SUFFIX
    const copies = readdirSync(folder).filter((name) => name.startsWith(prefix))
    for (const name of copies) {
      try { if (readFileSync(join(folder, name), 'utf8') === text) return join(folder, name) } catch (e) { /* unreadable copy: ignored */ }
    }
    if (copies.length >= CORRUPT_COPIES_MAX) return null
    // Exclusive create ('wx'): two copies made in the same millisecond must never
    // overwrite each other, so a name that is taken gets a counter.
    const base = join(folder, prefix + Date.now())
    for (let i = 0; i < CORRUPT_COPIES_MAX; i += 1) {
      const copy = i === 0 ? base : base + '-' + i
      try { writeFileSync(copy, text, { mode: 0o600, flag: 'wx' }); return copy } catch (e) { if (!(e && e.code === 'EEXIST')) return null }
    }
    return null
  } catch (e) { return null }
}

/** Write `text` to `file` atomically, keeping an existing file's permissions (0600 for
 *  a new one). A symlinked settings.json stays a symlink: the target is replaced, not
 *  the link. Throws on failure, after removing its temp file. */
function writeFileAtomically (file, text) {
  let target = file
  try { target = realpathSync(file) } catch (e) { /* new file */ }
  let mode = 0o600
  try { mode = statSync(target).mode & 0o777 } catch (e) { /* new file: private by default */ }
  mkdirSync(dirname(target), { recursive: true })
  const temp = join(dirname(target), '.' + basename(target) + '.tmp-' + process.pid + '-' + Date.now())
  try {
    writeFileSync(temp, text, { mode })
    chmodSync(temp, mode) // the mode given to writeFileSync is masked by the umask
    renameSync(temp, target)
  } catch (e) {
    try { rmSync(temp, { force: true }) } catch (e2) { /* nothing left to clean */ }
    throw e
  }
}

/** The error to give back when the file on disk must NOT be overwritten (unreadable, or
 *  present but not a JSON object: a copy of it is kept), or null when writing is safe. */
function settingsFileBlocked (read, file) {
  if (read.error !== undefined) return read.error
  if (read.corrupt !== true) return null
  const copy = keepCorruptCopy(file, read.text)
  return 'settings.json is not a valid JSON object, so nothing was saved' +
    (copy === null ? '' : ' (a copy is kept as ' + basename(copy) + ')') +
    '. Fix or remove the file, then save again.'
}
// KB-SETTINGS-FILE-END
export { readRawSettings }

// Targeted write of known fields: never an object from the network as it is, and
// never a replacement of the keys other bundles keep in the same file.
export function ecrireReglages (fichier, patch) {
  const p = (patch !== null && typeof patch === 'object') ? patch : {}
  // Un modèle d'étude refusé se DIT : l'ignorer en silence ferait croire à la
  // page que le choix est enregistré alors que le fichier garde l'ancien.
  if (p.brain !== undefined && brainValide(p.brain) !== true) {
    return { ok: false, erreur: 'brain : identifiant « route/id » attendu (ou chaîne vide)' }
  }
  if (p.voiceInput !== undefined && voiceSourceValide(p.voiceInput) !== true) {
    return { ok: false, erreur: 'voiceInput : « native » ou « kybernos » attendu' }
  }
  if (p.decisionBrain !== undefined && decisionValide(p.decisionBrain) !== true) {
    return { ok: false, erreur: 'decisionBrain : identifiant « route/id », « none » ou chaîne vide attendu' }
  }
  if (p.autoWhitelist !== undefined && whitelistValide(p.autoWhitelist) !== true) {
    return { ok: false, erreur: 'autoWhitelist : tableau d identifiants « route/id » sans doublon attendu' }
  }
  const lu = readRawSettings(fichier)
  const bloque = settingsFileBlocked(lu, fichier)
  if (bloque !== null) return { ok: false, erreur: bloque }
  const avant = normalizeSettings(lu.raw)
  const apres = {
    renameAfterRecap: p.renameAfterRecap === undefined
      ? avant.renameAfterRecap
      : p.renameAfterRecap !== false,
    brain: p.brain === undefined ? avant.brain : p.brain,
    voiceInput: p.voiceInput === undefined ? avant.voiceInput : p.voiceInput,
    decisionBrain: p.decisionBrain === undefined ? avant.decisionBrain : p.decisionBrain,
    autoRouting: p.autoRouting === undefined ? avant.autoRouting : p.autoRouting === true,
    autoWhitelist: p.autoWhitelist === undefined ? avant.autoWhitelist : p.autoWhitelist,
    autoClassifier: p.autoClassifier === undefined ? avant.autoClassifier : p.autoClassifier
  }
  try {
    // Merge: every key already on disk stays, the seven above are overlaid.
    writeFileAtomically(fichier, JSON.stringify({ ...lu.raw, ...apres }, null, 2) + '\n')
  } catch (e) { return { ok: false, erreur: String(e && e.message ? e.message : e) } }
  return { ok: true, reglages: apres }
}

// ── catégories de session (~/.dsh/kybernos/categories.json) ────────────────
// Le titre d'une session ne porte PLUS d'emoji : la catégorie (fonctionnalité,
// correctif, UI/design…) vit à part, indexée par identifiant de session, et
// c'est elle que la liste rend en SVG. La CLI de nommage l'écrit ; le client la
// lit ici. Le fichier est un simple objet `{ "<sessionId>": { cat, titre, ts } }`.

// Les slugs acceptés — DÉRIVÉS de la table du cerveau de décision, qui est le
// seul endroit où leur SENS est écrit (les critères envoyés à Jev) : une
// catégorie ajoutée là-bas est proposée au modèle et acceptée par la route, sans
// second relevé à tenir à jour. L'ordre est celui du registre historique.
export const CATEGORIES_CONNUES = CATEGORIES.map((c) => c.slug)

export function lireCategories (fichier) {
  let brut = null
  try { brut = JSON.parse(readFileSync(fichier, 'utf8')) } catch (e) { brut = null }
  if (brut === null || typeof brut !== 'object' || Array.isArray(brut)) return {}
  const propre = {}
  for (const id of Object.keys(brut)) {
    const e = brut[id]
    if (e === null || typeof e !== 'object') continue
    const cat = String(e.cat || '')
    if (CATEGORIES_CONNUES.indexOf(cat) === -1) continue
    // `auto` : catégorie posée par le CLIENT (classement automatique du titre
    // initial), pas par l'agent qui nomme. L'agent peut la remplacer à tout
    // moment ; l'auto ne re-classe jamais par-dessus un nommage explicite.
    propre[id] = { cat, titre: String(e.titre || '').slice(0, 200), ts: String(e.ts || ''), auto: e.auto === true }
  }
  return propre
}

export function ecrireCategorie (fichier, sessionId, cat, titre, auto) {
  const id = String(sessionId || '').trim()
  if (id === '') return { ok: false, erreur: 'session vide' }
  if (CATEGORIES_CONNUES.indexOf(String(cat)) === -1) {
    return { ok: false, erreur: 'catégorie inconnue : ' + String(cat) + ' (attendu : ' + CATEGORIES_CONNUES.join(', ') + ')' }
  }
  const toutes = lireCategories(fichier)
  toutes[id] = { cat: String(cat), titre: String(titre || '').slice(0, 200), ts: new Date().toISOString(), auto: auto === true }
  try {
    mkdirSync(dirname(fichier), { recursive: true })
    writeFileSync(fichier, JSON.stringify(toutes, null, 2) + '\n')
  } catch (e) { return { ok: false, erreur: String(e && e.message ? e.message : e) } }
  return { ok: true, id, categorisation: toutes[id] }
}

// ── mémoire des kybers (~/.dsh/kybers/<kyber>/memory) ──────────────────────

export function lignesJsonl (chemin) {
  if (!existsSync(chemin)) return []
  try {
    return readFileSync(chemin, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l))
  } catch (e) { return [] }
}

export function etatMemoire (kybersHome, ls = readdirSync) {
  const kybers = []
  if (!existsSync(kybersHome)) return kybers
  for (const nom of ls(kybersHome)) {
    const kdir = join(kybersHome, nom)
    if (!statSync(kdir).isDirectory()) continue
    const lecons = lignesJsonl(join(kdir, 'memory', 'lessons.jsonl'))
    const ledger = lignesJsonl(join(kdir, 'memory', 'ledger.jsonl'))
    if (lecons.length === 0 && ledger.length === 0) continue
    const membres = {}
    for (const e of ledger) {
      const r = e.role || '?'
      if (membres[r] === undefined) membres[r] = { runs: 0, dernier: null, outcome: null }
      membres[r].runs += 1
      if (e.ts && (membres[r].dernier === null || e.ts > membres[r].dernier)) {
        membres[r].dernier = e.ts
        membres[r].outcome = e.outcome || null
      }
    }
    const dernierLedger = ledger.length > 0 ? ledger[ledger.length - 1] : null
    kybers.push({
      id: nom,
      lecons: lecons.slice(-5).reverse().map((l) => ({ ts: l.ts, texte: l.text || '', tags: l.tags || [] })),
      totalLecons: lecons.length,
      totalRuns: ledger.length,
      derniereActivite: dernierLedger ? dernierLedger.ts : null,
      dernierOutcome: dernierLedger ? (dernierLedger.role + ' · ' + (dernierLedger.outcome || '')) : null,
      membres: Object.entries(membres).map(([role, m]) => ({ role, runs: m.runs, dernier: m.dernier, outcome: m.outcome }))
        .sort((a, b) => b.runs - a.runs)
    })
  }
  return kybers.sort((a, b) => String(b.derniereActivite || '').localeCompare(String(a.derniereActivite || '')))
}

// ── réponse complète ────────────────────────────────────────────────────────

export async function construireEtat ({ sessionsHome, kybersHome, sessionId, fenetreMs = 24 * 3600 * 1000, horloge = Date.now, run = git, ls = readdirSync, st = statSync, avecPr = false, gh = ghRun, cachePr: prCache = cachePr }) {
  const slug = sessionId ? dossierDeSession(sessionsHome, sessionId, ls) : null
  const repartition = repartitionParDossier(sessionsHome, fenetreMs, horloge(), st, ls)
  let session = null
  if (slug !== null) {
    const chemin = decodeSlugPath(slug)
    const dos = repartition[slug] || { sessionsActives: 0, sessionsTotal: 0, derniereActivite: 0 }
    const g = chemin ? await etatGit(chemin, run) : { git: false }
    // worktrees d'isolation présents dans ce dossier (un chat « né » ici peut
    // y être isolé : son activité ne menace plus le dossier principal)
    let nbWorktrees = 0
    if (chemin !== null) {
      const wdir = join(chemin, '.worktrees')
      if (existsSync(wdir)) nbWorktrees = readdirSync(wdir).filter((n) => estDossier(join(wdir, n))).length
    }
    session = {
      slug,
      chemin,
      sessionsActives: dos.sessionsActives,
      sessionsTotal: dos.sessionsTotal,
      worktrees: nbWorktrees,
      etat: g.git
        ? (dos.sessionsActives >= 2 && nbWorktrees === 0
            ? 'error'
            : (dos.sessionsActives >= 2 || g.modifications > 0 || g.commitsNonPousses > 0 ? 'warning' : 'done'))
        : 'idle',
      git: g
    }
    // ── v3 « status light » : état GitHub du PROJET (en worktree, la pilule
    // sync décrit le dossier principal — une copie isolée reste sur l'ordinateur)
    // et pull request de la branche courante (gh, en cache 60 s).
    if (g.git) {
      const sd = g.worktree
        ? await etatGit(String(chemin).replace(/\/\.worktrees\/[^/]+$/, ''), run)
        : g
      session.sync = g.worktree && sd.git
        ? { branche: sd.branche, commitsNonPousses: sd.commitsNonPousses, commitsRecus: sd.commitsRecus, distant: sd.distant, dernierFetch: sd.dernierFetch }
        : { branche: g.branche, commitsNonPousses: g.commitsNonPousses, commitsRecus: g.commitsRecus, distant: g.distant, dernierFetch: g.dernierFetch }
      session.pr = avecPr ? await etatPr(chemin, { gh, cache: prCache, horloge }) : null
    }
  }
  return { session, kybers: etatMemoire(kybersHome, ls) }
}


// ── « la session peut-elle être clôturée ? » — LECTURE seule ────────────────
// Mêmes gardes que `cloturer`, mais sans aucune écriture : le récapitulatif de
// la pilule locale dit ce qui reste à faire au lieu de le découvrir au clic.
//   · hors git, ou dossier principal → clôturable (rien à fusionner) ;
//   · copie isolée → il faut un arbre propre, une branche poussée, et aucune
//     entrée ignorée non régénérable (`.env`, base locale…) que la fermeture
//     détruirait.
export async function sondeCloture ({ chemin, run = gitRun, forceIgnores = false }) {
  if (!chemin || !existsSync(chemin)) return { ok: false, cloturable: false, worktree: false, raison: 'dossier introuvable', erreurs: ['dossier introuvable'] }
  const g = await etatGit(chemin, run)
  if (!g.git) return { ok: true, cloturable: true, worktree: false, branche: null, raison: 'hors git — rien à fusionner', erreurs: [] }
  const gd = await run(['rev-parse', '--git-dir'], chemin)
  const estWt = /\.git\/worktrees\//.test(String(gd.out))
  if (!estWt) return { ok: true, cloturable: true, worktree: false, branche: g.branche, raison: 'dossier principal — la session peut être fermée', erreurs: [] }
  const erreurs = []
  if (g.modifications > 0) erreurs.push('arbre sale (' + g.modifications + ' fichier' + (g.modifications === 1 ? '' : 's') + ') — committer d’abord')
  const ig = await run(['status', '--porcelain', '--ignored=matching'], chemin)
  const precieux = ig.ok ? ignoresPrecieux(String(ig.out)) : []
  if (precieux.length > 0 && forceIgnores !== true) {
    erreurs.push(precieux.length + ' entrée(s) ignorée(s) non régénérable(s) (' + precieux.slice(0, 3).join(', ') + ') — fermer les détruirait')
  }
  const pousse = await run(['rev-list', '--count', '@{upstream}..' + g.branche], chemin)
  if (!pousse.ok) erreurs.push('branche sans upstream (jamais poussée) — pousser d’abord')
  else if (String(pousse.out).trim() !== '0') erreurs.push(String(pousse.out).trim() + ' commit(s) non poussé(s) — pousser d’abord')
  return {
    ok: true,
    cloturable: erreurs.length === 0,
    worktree: true,
    branche: g.branche,
    nonFusionnes: g.nonFusionnes,
    raison: erreurs.length === 0 ? 'copie isolée propre — elle peut être fusionnée puis retirée' : erreurs[0],
    erreurs
  }
}

// ── actions protégées (dry-run par défaut, exec uniquement sur confirmation) ─

// ── isolation : cycle de vie des worktrees ──────────────────────────────────
// Un arbre créé doit pouvoir être RÉUTILISÉ (jamais deux fois le même nom),
// MARQUÉ (but + date, écrit À CÔTÉ de l'arbre pour ne pas le salir) et RAMASSÉ
// (retiré dès qu'il est propre et sans travail). Sans ces trois propriétés une
// garde automatique fabrique des arbres morts à chaque appel — constaté le
// 21/09/2026 : deux arbres `.worktrees/s-mub*` à 0 commit d'avance, 0 de retard,
// arbre propre, et un troisième déjà signalé « resté, redondant ».

const normaliserSlug = (nom) => (nom || ('s-' + Date.now().toString(36)))
  .replace(/[^a-z0-9-]/gi, '-').slice(0, 40)

const dossierMarqueur = (chemin) => join(chemin, '.worktrees')
const cheminMarqueur = (chemin, slug) => join(dossierMarqueur(chemin), slug + '.kybernos.json')

export function lireMarqueur (chemin, slug) {
  try { return JSON.parse(readFileSync(cheminMarqueur(chemin, slug), 'utf8')) } catch (e) { return {} }
}
function ecrireMarqueur (chemin, slug, data) {
  try {
    mkdirSync(dossierMarqueur(chemin), { recursive: true })
    writeFileSync(cheminMarqueur(chemin, slug), JSON.stringify({ version: 1, ...data }) + '\n')
  } catch (e) { /* un marqueur manquant ne bloque pas l'isolation */ }
}
function effacerMarqueur (chemin, slug) {
  try { rmSync(cheminMarqueur(chemin, slug), { force: true }) } catch (e) { /* déjà absent */ }
}

// `.worktrees/` entre dans l'exclusion LOCALE du dépôt (info/exclude, jamais
// committée) : sans elle le dossier d'arbres compte comme non suivi et la garde
// « arbre sale » d'isoler se déclencherait sur sa propre production.
export async function exclureWorktrees ({ chemin, run = gitRun }) {
  const gd = await run(['rev-parse', '--path-format=absolute', '--git-common-dir'], chemin)
  const dir = gd.ok && String(gd.out).trim() !== '' ? String(gd.out).trim() : join(chemin, '.git')
  try {
    const excl = join(dir, 'info', 'exclude')
    const avant = existsSync(excl) ? readFileSync(excl, 'utf8') : ''
    if (!/^\.worktrees\/?\s*$/m.test(avant)) {
      mkdirSync(join(dir, 'info'), { recursive: true })
      appendFileSync(excl, (avant === '' || avant.endsWith('\n') ? '' : '\n') + '.worktrees/\n')
    }
    return { ok: true, chemin: excl }
  } catch (e) { return { ok: false, erreur: String(e && e.message ? e.message : e) } }
}

// L'encodage du magasin est une CONVENTION de DSH, pas un contrat : tout
// caractère hors [a-zA-Z0-9-] devient `~XXXX` (espace → ~0020, point → ~002e) et
// chaque « / » devient « - ». Le construire à la main ratait toute session dont
// le dossier contient un caractère encodé : le magasin réel porte
// `--Users-miled-Library-Application~0020Support-Open~0020Design-…--`. Une session
// « non vue » = un arbre TENU pris pour un arbre libre, donc supprimé par le
// ramassage. On encode, et on se replie sur le décodage du magasin si le nom
// direct n'existe pas.
export function encoderSlugChemin (chemin) {
  const corps = String(chemin).replace(/^\/+/, '').split('/')
    .map((seg) => seg.replace(/[^a-zA-Z0-9-]/g, (c) => '~' + c.codePointAt(0).toString(16).padStart(4, '0')))
    .join('-')
  return '--' + corps + '--'
}

export function slugsDeChemin (sessionsHome, chemin, ls = readdirSync) {
  if (!sessionsHome || !chemin) return []
  const direct = encoderSlugChemin(chemin)
  if (existsSync(join(sessionsHome, direct))) return [direct]
  try { return ls(sessionsHome).filter((n) => decodeSlugPath(n) === chemin) } catch (e) { return [] }
}

// Une session ouverte sur cet arbre interdit de le ramasser : on ne retire
// jamais un dossier où un chat écrit en ce moment (même règle que la fermeture).
export function estTenue (sessionsHome, chemin, fenetreMs = 3600 * 1000, maintenant = Date.now(), st = statSync, ls = readdirSync) {
  if (!sessionsHome || !chemin) return false
  return slugsDeChemin(sessionsHome, chemin, ls)
    .some((slug) => sessionsDuDossier(sessionsHome, slug, fenetreMs, maintenant, st, ls).some((s) => s.actif))
}

// Toutes les entrées ignorées ne se valent pas. `node_modules/`, `dist/`,
// `.DS_Store` sont REGÉNÉRABLES : les traiter comme du travail rendrait le
// ramassage inutile — tout arbre où l'on a lancé un `npm install` resterait à
// jamais, et un SEUL `.DS_Store` (effet de bord de Finder) suffisait à bloquer la
// récupération (mesuré le 21/09/2026). `.env`, un brouillon ou une base locale,
// non : ceux-là ne se reconstruisent pas. C'est donc une liste de REGÉNÉRABLES, et
// tout ce qui n'y figure pas est réputé PRÉCIEUX — le défaut est conservateur.
const IGNORES_REGENERABLES = new Set([
  'node_modules', 'dist', 'build', 'out', 'target', 'coverage', 'vendor',
  '.cache', '.parcel-cache', '.next', '.nuxt', '.turbo', '.svelte-kit',
  '.venv', 'venv', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache',
  '.gradle', '.idea', '.vscode', '.sass-cache', '.terraform', '.worktrees',
  '.DS_Store', 'tmp', '.tmp'
])

export function ignoresPrecieux (porcelainIgnore) {
  return String(porcelainIgnore).split('\n')
    .filter((l) => l.startsWith('!! '))
    .map((l) => l.slice(3).trim().replace(/^"/, '').replace(/"$/, ''))
    .map((p) => (p.endsWith('/') ? p.slice(0, -1) : p))
    .filter((p) => p !== '')
    .filter((p) => {
      const feuille = p.split('/').pop()
      return !IGNORES_REGENERABLES.has(feuille) && !/\.log$/.test(feuille)
    })
}

// La base d'un tronc n'est pas toujours `main` : `origin/HEAD` d'abord (ce que le
// dépôt déclare), puis les noms usuels, puis la branche courante. Sans cela un
// dépôt sur `master` gardait TOUS ses arbres (« base main introuvable ») et le
// ramassage ne ramassait rien — exactement le mal qu'il doit réparer.
export async function baseDuDepot (chemin, run = gitRun) {
  const tete = await run(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], chemin)
  if (tete.ok) {
    const m = String(tete.out).trim().match(/^refs\/remotes\/origin\/(.+)$/)
    if (m !== null) return m[1]
  }
  for (const c of ['main', 'master', 'dev']) {
    const r = await run(['show-ref', '--verify', '--quiet', 'refs/heads/' + c], chemin)
    if (r.ok) return c
  }
  const cur = await run(['rev-parse', '--abbrev-ref', 'HEAD'], chemin)
  const nom = cur.ok ? String(cur.out).trim() : ''
  return nom === '' || nom === 'HEAD' ? null : nom
}

export async function worktreesEnregistres (chemin, run = gitRun) {
  const r = await run(['worktree', 'list', '--porcelain'], chemin)
  if (!r.ok) return []
  const out = []
  for (const bloc of String(r.out).split('\n\n')) {
    const l = bloc.split('\n')
    const p = (l.find((x) => x.startsWith('worktree ')) || '').slice(9).trim()
    if (p === '') continue
    out.push({
      chemin: p,
      branche: (l.find((x) => x.startsWith('branch ')) || 'branch (détaché)').slice(7).trim(),
      slug: p.includes('/.worktrees/') ? p.split('/.worktrees/').pop() : null
    })
  }
  return out
}

// Lecture seule : que ferait l'isolation ? La garde s'en sert AVANT d'écrire,
// pour ne jamais créer un second arbre quand le premier est encore libre.
export async function sondeIsolation ({ chemin, nom, run = gitRun, sessionsHome = null, fenetreMs = 3600 * 1000 }) {
  if (!chemin || !existsSync(chemin)) return { ok: false, git: false, erreur: 'dossier introuvable' }
  const g = await etatGit(chemin, run)
  if (!g.git) return { ok: false, git: false, erreur: 'pas un dépôt git' }
  if (g.worktree) return { ok: true, git: true, dejaIsole: true, cible: chemin, branche: g.branche }
  const slug = normaliserSlug(nom)
  const cible = join(chemin, '.worktrees', slug)
  const branche = 'feature/' + slug
  if (existsSync(cible)) {
    const r = await etatGit(cible, run)
    const tenue = estTenue(sessionsHome, cible, fenetreMs)
    const libre = r.git && r.worktree && r.modifications === 0 && r.nonFusionnes === 0 && !tenue
    return {
      ok: libre, git: true, dejaIsole: false, reutilisable: libre, cible,
      branche: r.git ? r.branche : branche,
      ...(libre ? {} : { erreur: tenue ? 'arbre tenu par une session ouverte' : 'arbre existant sale ou porteur de travail' })
    }
  }
  // Le tronc doit être propre POUR CRÉER : un arbre naît de HEAD et laisserait
  // les modifications non committées derrière lui. Cela ne concerne pas la
  // réutilisation d'un arbre déjà en place (traitée juste au-dessus).
  //
  // `.worktrees/` est filtré ICI, en lecture seule : le dossier d'arbres est la
  // production de ce module, il ne doit pas faire refuser la création. L'ancienne
  // version obtenait le même effet en écrivant dans `info/exclude` AVANT de
  // sonder — donc même en dry-run (contrat rompu). L'exclusion reste écrite, mais
  // seulement quand on exécute réellement.
  const brut = await run(['status', '--porcelain'], chemin)
  const lignes = brut.ok ? String(brut.out).split('\n').filter((l) => l.trim() !== '') : []
  const horsArbres = lignes.filter((l) => !/(^|\s)\.worktrees\//.test(l))
  if (horsArbres.length > 0) return { ok: false, git: true, sale: true, cible, branche, erreur: 'arbre sale (' + horsArbres.length + ' fichiers) — committer d\'abord' }
  return { ok: true, git: true, dejaIsole: false, reutilisable: false, cible, branche }
}

export async function isoler ({ chemin, nom, but, exec = false, run = gitRun, sessionsHome = null, fenetreMs = 3600 * 1000 }) {
  if (!chemin || !existsSync(chemin)) return { ok: false, erreur: 'dossier introuvable' }
  const s = await sondeIsolation({ chemin, nom, run, sessionsHome, fenetreMs })
  if (s.dejaIsole) return { ok: true, dejaIsole: true, cible: s.cible, branche: s.branche, message: 'déjà isolé — ce dossier est un worktree' }
  if (!s.ok) return { ok: false, erreur: s.erreur }
  // L'exclusion n'est écrite qu'APRÈS une sonde favorable : une isolation REFUSÉE
  // (tronc sale) ne doit pas laisser de trace dans le dépôt.
  if (exec) await exclureWorktrees({ chemin, run })
  if (s.reutilisable) {
    if (!exec) return { ok: true, dry: true, reutilise: true, cible: s.cible, branche: s.branche, commandes: [] }
    return { ok: true, reutilise: true, cible: s.cible, branche: s.branche, message: 'worktree déjà en place et sans travail — réutilisé, rien créé' }
  }
  // Une branche `feature/<slug>` peut survivre au ramassage de son arbre : la
  // réutiliser au lieu de la recréer (`-b`) est ce qui garde `isoler` idempotent
  // à la frontière du ramassage, sans supposer que le ramassage a tout nettoyé.
  const existe = await run(['show-ref', '--verify', '--quiet', 'refs/heads/' + s.branche], chemin)
  const brancheExistante = existe.ok
  const commandes = [brancheExistante
    ? ['worktree', 'add', s.cible, s.branche]
    : ['worktree', 'add', '-b', s.branche, s.cible]]
  if (!exec) {
    return { ok: true, dry: true, commandes: commandes.map((c) => 'git ' + c.join(' ')), cible: s.cible, branche: s.branche, brancheExistante }
  }
  const r = await run(commandes[0], chemin)
  if (!r.ok) return { ok: false, erreur: 'git a refusé : ' + r.err.trim().slice(0, 200) }
  const g = await etatGit(chemin, run)
  const base = await baseDuDepot(chemin, run)
  ecrireMarqueur(chemin, normaliserSlug(nom), {
    but: but || null, branche: s.branche, base: base || g.base || null,
    ne: new Date().toISOString(), par: 'kybernos-sessions/isoler'
  })
  return { ok: true, cible: s.cible, branche: s.branche, message: 'worktree créé — ouvre le PROCHAIN chat dans ce dossier pour qu\'il y soit isolé' }
}

// Ramasse les arbres d'isolation PROPRES et SANS TRAVAIL (0 commit au-delà de
// la base). Ne touche jamais : un arbre sale, un arbre en avance, un arbre tenu
// par une session ouverte, un dossier hors `.worktrees/`. Dry-run par défaut.
export async function ramasser ({ chemin, exec = false, run = gitRun, sessionsHome = null, fenetreMs = 3600 * 1000, base = null, forceIgnores = false }) {
  if (!chemin || !existsSync(chemin)) return { ok: false, erreur: 'dossier introuvable' }
  const g = await etatGit(chemin, run)
  if (!g.git) return { ok: false, erreur: 'pas un dépôt git' }
  if (g.worktree) return { ok: false, erreur: 'ce dossier est un worktree — ramasser se lance depuis le checkout principal' }
  const b = base || (await baseDuDepot(chemin, run)) || g.base || 'main'
  const candidats = []
  const gardes = []
  for (const w of await worktreesEnregistres(chemin, run)) {
    if (w.chemin.replace(/\/+$/, '') === String(chemin).replace(/\/+$/, '')) continue
    if (w.slug === null) { gardes.push({ chemin: w.chemin, raison: 'hors .worktrees/' }); continue }
    const branche = String(w.branche || '').replace(/^refs\/heads\//, '')
    if (!existsSync(w.chemin)) {
      candidats.push({ chemin: w.chemin, slug: w.slug, branche, brancheRetirable: await brancheRetirable(chemin, branche, b, run), raison: 'dossier absent' })
      continue
    }
    if (estTenue(sessionsHome, w.chemin, fenetreMs)) { gardes.push({ chemin: w.chemin, raison: 'tenu par une session ouverte' }); continue }
    const st = await run(['status', '--porcelain'], w.chemin)
    if (!st.ok || String(st.out).trim() !== '') { gardes.push({ chemin: w.chemin, raison: 'arbre sale' }); continue }
    // `--porcelain` NE COMPTE PAS les fichiers ignorés : un arbre dont le seul
    // contenu non committé est ignoré (brouillon, base locale, `.env`) paraît
    // propre, `worktree remove` réussit, et ce contenu est DÉTRUIT. On garde —
    // mais seulement pour ce qui n'est pas régénérable, sinon le ramassage ne
    // ramasserait plus rien (voir `IGNORES_REGENERABLES`).
    const ig = await run(['status', '--porcelain', '--ignored=matching'], w.chemin)
    const precieux = ig.ok ? ignoresPrecieux(String(ig.out)) : []
    if (precieux.length > 0 && forceIgnores !== true) {
      gardes.push({ chemin: w.chemin, raison: precieux.length + ' entrée(s) ignorée(s) non régénérable(s) — --force-ignores pour les détruire', ignores: precieux.slice(0, 5) })
      continue
    }
    const av = await run(['rev-list', '--count', b + '..HEAD'], w.chemin)
    const n = av.ok ? (parseInt(String(av.out).trim(), 10) || 0) : -1
    if (n !== 0) { gardes.push({ chemin: w.chemin, raison: n < 0 ? 'base « ' + b + ' » introuvable' : n + ' commit(s) au-delà de ' + b }); continue }
    candidats.push({ chemin: w.chemin, slug: w.slug, branche, brancheRetirable: await brancheRetirable(chemin, branche, b, run), but: lireMarqueur(chemin, w.slug).but || null })
  }
  const commandes = candidats.flatMap((c) => ['git worktree remove ' + c.chemin]
    .concat(c.brancheRetirable ? ['git branch -D ' + c.branche] : []))
  if (!exec) return { ok: true, dry: true, base: b, candidats, gardes, commandes }
  const retires = []
  const branchesRetirees = []
  for (const c of candidats) {
    const r = await run(['worktree', 'remove', c.chemin], chemin)
    if (!r.ok && existsSync(c.chemin)) {
      gardes.push({ chemin: c.chemin, raison: 'remove refusé : ' + String(r.err || '').trim().slice(0, 120) })
      continue
    }
    retires.push(c.chemin)
    effacerMarqueur(chemin, c.slug)
    if (c.brancheRetirable) {
      const br = await run(['branch', '-D', c.branche], chemin)
      if (br.ok) branchesRetirees.push(c.branche)
    }
  }
  const pr = await run(['worktree', 'prune'], chemin)
  return { ok: true, base: b, retires, branchesRetirees, gardes, prune: pr.ok,
    message: retires.length + ' arbre(s) sans travail retiré(s)' }
}

// Une branche `feature/<slug>` n'est supprimable que si elle ne porte AUCUN
// commit au-delà de la base : tout est déjà dans la base, on ne retire qu'une
// référence. Sans ce nettoyage, `isoler` du même nom échouait après un
// ramassage (« a branch named … already exists ») — l'idempotence cassait
// exactement à la frontière du ramassage.
async function brancheRetirable (chemin, branche, base, run) {
  if (branche === '' || branche === base) return false
  const cnt = await run(['rev-list', '--count', base + '..' + branche], chemin)
  return cnt.ok && String(cnt.out).trim() === '0'
}

export async function cloturer ({ chemin, exec = false, run = gitRun, forceIgnores = false }) {
  if (!chemin || !existsSync(chemin)) return { ok: false, erreur: 'dossier introuvable' }
  const g = await etatGit(chemin, run)
  if (!g.git) return { ok: false, erreur: 'pas un dépôt git' }
  const gd = await run(['rev-parse', '--git-dir'], chemin)
  if (!/\.git\/worktrees\//.test(String(gd.out))) return { ok: false, erreur: 'ce dossier n\'est pas un worktree' }
  if (g.modifications > 0) return { ok: false, erreur: 'arbre sale (' + g.modifications + ' fichiers) — committer d\'abord' }
  // Fermer DÉTRUIT l'arbre : les entrées ignorées non régénérables (`.env`, base
  // locale) disparaîtraient sans que `git status` ait rien signalé. Même garde que
  // le ramassage, même soupape explicite.
  const ig = await run(['status', '--porcelain', '--ignored=matching'], chemin)
  const precieux = ig.ok ? ignoresPrecieux(String(ig.out)) : []
  if (precieux.length > 0 && forceIgnores !== true) {
    return { ok: false, erreur: precieux.length + ' entrée(s) ignorée(s) non régénérable(s) (' + precieux.slice(0, 3).join(', ') + ') — fermer les détruirait ; `forceIgnores` pour l\'assumer' }
  }
  const branche = g.branche
  const pousse = await run(['rev-list', '--count', '@{upstream}..' + branche], chemin)
  if (!pousse.ok) return { ok: false, erreur: 'branche sans upstream (jamais poussée) — pousser d\'abord' }
  if (String(pousse.out).trim() !== '0') return { ok: false, erreur: String(pousse.out).trim() + ' commit(s) non poussé(s) — pousser d\'abord' }
  const racine = await run(['rev-parse', '--show-toplevel'], chemin)
  const principal = String(racine.out).trim().replace(/\/.worktrees\/[^/]+$/, '')
  const commandes = [
    ['merge', '--no-ff', '-m', 'merge: ' + branche, branche],
    ['worktree', 'remove', chemin]
  ]
  if (!exec) {
    return { ok: true, dry: true, branche,
      commandes: ['cd ' + principal + ' && git ' + commandes[0].join(' '), 'git ' + commandes[1].join(' ')] }
  }
  const m = await run(commandes[0], principal)
  if (!m.ok) return { ok: false, erreur: 'merge refusé : ' + m.err.trim().slice(0, 200) }
  const w = await run(commandes[1], principal)
  if (!w.ok) return { ok: false, erreur: 'worktree non retiré : ' + w.err.trim().slice(0, 200) }
  if (chemin.startsWith(join(principal, '.worktrees') + '/')) effacerMarqueur(principal, basename(chemin))
  return { ok: true, branche, message: 'fusionné et worktree retiré' }
}


// commit (+ push, + merge si worktree) — dry-run par défaut, gardes identiques
// `chemins` : la liste des fichiers écrits PAR CE CHAT (son journal la connaît).
// Fournie, elle remplace `git add -A` — sur un dossier partagé par huit chats,
// `-A` embarque le travail en cours des autres dans le commit et le pousse.
// Fournie ET VIDE, elle signifie « ce chat n'a rien écrit » : on refuse, au lieu
// de committer le dossier d'autrui.
export async function commiter ({ chemin, message, exec = false, run = gitRun, chemins = null, pousser: pousserAussi = true }) {
  if (!chemin || !existsSync(chemin)) return { ok: false, erreur: 'dossier introuvable' }
  const g = await etatGit(chemin, run)
  if (!g.git) return { ok: false, erreur: 'pas un dépôt git' }
  const gd = await run(['rev-parse', '--git-dir'], chemin)
  const estWt = /\.git\/worktrees\//.test(String(gd.out))
  let principal = null
  if (estWt) {
    const racine = await run(['rev-parse', '--show-toplevel'], chemin)
    principal = String(racine.out).trim().replace(/\/.worktrees\/[^/]+$/, '')
  }
  // Mode LOCAL (`pousser:false`) : rien ne part sur GitHub. Un arbre propre n'est
  // alors pas une impasse — s'il reste des commits à ramener dans la branche de
  // base, « commit & merge local » fait la fusion seule. C'est le geste du
  // bouton rapide : le travail reste sur la machine, le dossier principal le voit.
  if (g.modifications <= 0) {
    if (pousserAussi === false && estWt && g.nonFusionnes > 0) {
      const commandes = [['merge', '--no-ff', '-m', 'merge: ' + g.branche, g.branche]]
      if (!exec) {
        return { ok: true, dry: true, local: true, mergeSeul: true, worktree: true, branche: g.branche,
          message: 'fusion locale de ' + g.branche, commandes: ['git ' + commandes[0].join(' ')] }
      }
      const m = await run(commandes[0], principal)
      if (!m.ok) return { ok: false, erreur: 'merge refusé : ' + m.err.trim().slice(0, 200) }
      return { ok: true, local: true, mergeSeul: true, worktree: true, branche: g.branche,
        message: 'fusionné dans la branche locale (aucun envoi)' }
    }
    return { ok: false, erreur: 'rien à committer — arbre propre' }
  }
  const msg = (message && message.trim() !== '') ? message.trim().slice(0, 200) : 'livraison ' + new Date().toISOString().slice(0, 16).replace('T', ' ')
  const scope = Array.isArray(chemins)
  // Les chemins viennent du journal de la session : ils y sont écrits comme
  // l'outil les a reçus — donc SOUVENT en absolu (`/Users/…/scripts/foo.mjs`),
  // puisque c'est ainsi que l'agent nomme ses fichiers. Les refuser en bloc
  // faisait répondre « aucun fichier attribué à ce chat » à un chat qui venait
  // d'en écrire cinquante-huit. On les ramène donc RELATIFS quand ils sont sous
  // la racine du dépôt, et on écarte le reste : hors dépôt (fichiers de
  // configuration de la machine) ou tentative de remontée (`..`).
  const racine = (await run(['rev-parse', '--show-toplevel'], chemin)).out
  const brut = String(racine || '').trim().replace(/\/$/, '')
  const reelDe = (p) => { try { return realpathSync(p) } catch (e) { return null } }
  const sous = (base, p) => (base !== '' && p !== base && p.indexOf(base + '/') === 0 ? p.slice(base.length + 1) : null)
  const relatif = (c) => {
    if (c === '') return null
    if (c.charAt(0) !== '/') return c.split('/').includes('..') ? null : c
    // macOS : /var est un lien vers /private/var. Le journal peut nommer le
    // chemin par le lien quand git rend la racine résolue (ou l'inverse) : on
    // compare donc le texte ET les chemins réels. Aucune base n'étant un
    // symlink vers l'extérieur, on ne peut pas sortir du dépôt par ce biais.
    const bases = [brut, reelDe(brut)].filter((b) => b !== null && b !== '')
    const formes = [c, reelDe(c)].filter((p) => p !== null)
    for (const base of bases) for (const p of formes) { const s = sous(base, p); if (s !== null) return s }
    return null
  }
  const retenus = scope
    ? chemins.map((c) => relatif(String(c).trim()))
        .filter((c) => c !== null && c !== '')
        .filter((c, i, t) => t.indexOf(c) === i)
        .slice(0, 200)
    : []
  if (scope && retenus.length === 0) {
    return { ok: false, erreur: 'aucun fichier attribué à ce chat — le dossier est modifié par d’autres chats, rien à committer ici' }
  }
  const sales = Array.isArray(g.sale) ? g.sale : []
  // Déjà enregistré : le bouton a servi, ou un commit est passé par un autre
  // chemin. Le dire, au lieu de laisser `git commit` échouer sur « nothing
  // added to commit » — c'est ce que faisait le second clic.
  if (scope && retenus.length > 0 && retenus.every((p) => estSale(sales, p) === false)) {
    return { ok: true, deja: true, message: 'déjà enregistré — rien de nouveau dans les fichiers de ce chat',
      chemins: retenus, laisses: sales }
  }
  const commandes = [scope ? ['add', '--', ...retenus] : ['add', '-A'], ['commit', '-m', msg]]
  if (pousserAussi !== false) commandes.push(['push'])
  // Ce que le `add` laisse de côté : c'est le travail des autres, dit noir sur blanc.
  const st = await run(['status', '--porcelain'], chemin)
  const tous = st.ok ? cheminsSales(st.out) : sales
  const laisses = scope ? tous.filter((p) => estSale(retenus, p) === false) : []
  if (estWt) {
    commandes.push(['merge', '--no-ff', '-m', 'merge: ' + g.branche, g.branche])
  }
  if (!exec) {
    return { ok: true, dry: true, local: pousserAussi === false, message: msg, worktree: estWt, scope, chemins: retenus, laisses,
      commandes: commandes.map((c) => 'git ' + c.join(' ')) }
  }
  // S-02 : un échec de `git push` n'est plus AVALÉ — le commit local a
  // réussi (ok:true) mais l'état du push est rendu, pas tu.
  let pushRate = null
  for (const c of commandes) {
    if (c[0] === 'merge') {
      const m = await run(c, principal)
      if (!m.ok) return { ok: false, erreur: 'merge refusé : ' + m.err.trim().slice(0, 200) }
    } else {
      const r = await run(c, chemin)
      if (!r.ok && c[0] !== 'push') return { ok: false, erreur: 'git ' + c[0] + ' refusé : ' + r.err.trim().slice(0, 200) }
      if (!r.ok && c[0] === 'push') pushRate = r.err.trim().slice(0, 200)
    }
  }
  if (pousserAussi === false) {
    return { ok: true, local: true, message: msg, worktree: estWt,
      note: estWt ? 'committé et fusionné dans la branche locale (aucun envoi)' : 'committé localement (aucun envoi)' }
  }
  if (pushRate !== null) {
    return { ok: true, pousse: false, message: msg, worktree: estWt, erreurPush: pushRate,
      note: 'committé localement — le push a ÉCHOUÉ (voir erreurPush), le commit reste à envoyer' }
  }
  return { ok: true, pousse: true, message: msg, worktree: estWt,
    note: estWt ? 'committé, poussé et fusionné dans la branche de base' : 'committé et poussé' }
}

// ── GitHub : pousser / rapatrier / pull requests (gh) ───────────────────────
// Mêmes contrats que isoler/commiter/cloturer : dry-run d'abord (plan de
// commandes), exécution sur exec:true. Lecture seule côté state.

export async function pousser ({ chemin, exec = false, run = gitRun }) {
  if (!chemin || !existsSync(chemin)) return { ok: false, erreur: 'dossier introuvable' }
  const g = await etatGit(chemin, run)
  if (!g.git) return { ok: false, erreur: 'pas un dépôt git' }
  if (!g.distant) return { ok: false, erreur: 'aucun dépôt distant (origin) configuré' }
  if (g.commitsNonPousses === 0) return { ok: false, erreur: 'rien à pousser — déjà à jour' }
  if (!exec) return { ok: true, dry: true, commandes: ['git push'] }
  const r = await run(['push'], chemin)
  if (!r.ok) return { ok: false, erreur: 'push refusé : ' + String(r.err || '').trim().slice(0, 200) }
  return { ok: true, message: 'envoyé sur GitHub' }
}

export async function rapatrier ({ chemin, exec = false, run = gitRun }) {
  if (!chemin || !existsSync(chemin)) return { ok: false, erreur: 'dossier introuvable' }
  const g = await etatGit(chemin, run)
  if (!g.git) return { ok: false, erreur: 'pas un dépôt git' }
  if (!g.distant) return { ok: false, erreur: 'aucun dépôt distant (origin) configuré' }
  if (!exec) return { ok: true, dry: true, commandes: ['git fetch'] }
  const r = await run(['fetch'], chemin)
  if (!r.ok) return { ok: false, erreur: 'fetch refusé : ' + String(r.err || '').trim().slice(0, 200) }
  return { ok: true, message: 'mises à jour récupérées — rien de changé sur vos fichiers' }
}

export async function synchroniser ({ chemin, exec = false, run = gitRun }) {
  if (!chemin || !existsSync(chemin)) return { ok: false, erreur: 'dossier introuvable' }
  const g = await etatGit(chemin, run)
  if (!g.git) return { ok: false, erreur: 'pas un dépôt git' }
  if (!g.distant) return { ok: false, erreur: 'aucun dépôt distant (origin) configuré' }
  if (!exec) return { ok: true, dry: true, commandes: ['git fetch', 'git push'] }
  const f = await run(['fetch'], chemin)
  if (!f.ok) return { ok: false, erreur: 'fetch refusé : ' + String(f.err || '').trim().slice(0, 200) }
  const p = await run(['push'], chemin)
  if (!p.ok) return { ok: false, erreur: 'push refusé : ' + String(p.err || '').trim().slice(0, 200) }
  return { ok: true, message: 'récupéré puis envoyé — synchronisé' }
}

// ── pull requests via gh (CLI, lecture + actions) ───────────────────────────

export async function etatPr (chemin, { gh = ghRun, cache = cachePr, duree = 60000, horloge = Date.now } = {}) {
  if (!chemin || !existsSync(chemin)) return null
  const c = cache.get(chemin)
  if (c && horloge() - c.t < duree) return c.val
  const r = await gh(['pr', 'view', '--json', 'number,title,state,reviewDecision,statusCheckRollup,url,headRefName,baseRefName'], chemin)
  let val = null
  if (r.ok) {
    try {
      const j = JSON.parse(String(r.out))
      const rollup = Array.isArray(j.statusCheckRollup) ? j.statusCheckRollup : []
      const etats = rollup.map((c2) => String(c2.conclusion || c2.status || 'PENDING').toUpperCase())
      const valChecks = etats.length === 0
        ? 'none'
        : etats.some((x) => x === 'FAILURE' || x === 'TIMED_OUT' || x === 'CANCELLED') ? 'fail'
          : etats.every((x) => x === 'SUCCESS' || x === 'SKIPPED') ? 'pass' : 'running'
      val = {
        numero: j.number,
        titre: j.title,
        etat: String(j.state || '').toLowerCase(), // open | merged | closed
        revue: String(j.reviewDecision || '').toLowerCase(), // approved | changes_requested | review_required
        checks: valChecks,
        url: j.url,
        branche: j.headRefName,
        cible: j.baseRefName
      }
    } catch (e) { val = null }
  }
  cache.set(chemin, { t: horloge(), val })
  return val
}

export async function prCreer ({ chemin, exec = false, run = gitRun, gh = ghRun }) {
  if (!chemin || !existsSync(chemin)) return { ok: false, erreur: 'dossier introuvable' }
  const g = await etatGit(chemin, run)
  if (!g.git) return { ok: false, erreur: 'pas un dépôt git' }
  if (g.branche === g.base) return { ok: false, erreur: 'la branche courante est la branche de base — créez d’abord une copie isolée' }
  if (!g.distant || !/github\.com/.test(g.distant)) return { ok: false, erreur: 'pas de remote GitHub (origin)' }
  if (g.nonFusionnes <= 0 && g.modifications <= 0) return { ok: false, erreur: 'rien à examiner — aucun commit au-delà de ' + g.base }
  const commandes = ['git push', 'gh pr create --fill']
  if (!exec) return { ok: true, dry: true, commandes, branche: g.branche, cible: g.base }
  const p = await run(['push'], chemin)
  if (!p.ok) return { ok: false, erreur: 'push refusé : ' + String(p.err || '').trim().slice(0, 200) }
  const c = await gh(['pr', 'create', '--fill'], chemin)
  if (!c.ok) return { ok: false, erreur: 'gh pr create refusé : ' + String(c.err || '').trim().slice(0, 200) }
  return { ok: true, message: String(c.out || '').trim().split('\n').filter(Boolean).pop() || 'pull request créée' }
}

export async function prFusionner ({ chemin, exec = false, gh = ghRun }) {
  if (!chemin || !existsSync(chemin)) return { ok: false, erreur: 'dossier introuvable' }
  const commandes = ['gh pr merge --merge']
  if (!exec) return { ok: true, dry: true, commandes }
  const c = await gh(['pr', 'merge', '--merge'], chemin)
  if (!c.ok) return { ok: false, erreur: 'gh pr merge refusé : ' + String(c.err || '').trim().slice(0, 200) }
  return { ok: true, message: 'pull request fusionnée dans la branche de base' }
}

// ── montage des routes (webServer, GET uniquement) ─────────────────────────

const envoyer = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(obj))
}

// Same-origin guard. DSH serves plugin routes BEFORE its own authentication (measured on
// 0.2.0-rc.2: `/` answers 401 without a cookie, `/kybernos-sessions/settings` answers 200), so
// each plugin guards itself. The origin is compared with the REAL listening address of the
// socket, never with the client-supplied Host header, and never by prefix
// (« localhost.evil.example » used to pass: recette 2026-10, M-02/S-03).
// A request that changes state (anything but GET, HEAD, OPTIONS) MUST carry an Origin, or
// failing that a Referer: a browser always sends an Origin on a POST, so its absence means a
// caller that is not a browser. Reads tolerate its absence (direct navigation) but still
// refuse a foreign origin, which DNS rebinding always sends. Same rule as `sameOriginStrict`
// and `sameOriginLax` in the core bundle.
const METHODES_LECTURE = ['GET', 'HEAD', 'OPTIONS']
export const origineOK = (req) => {
  const headers = (req !== null && req !== undefined && req.headers !== null && req.headers !== undefined) ? req.headers : {}
  const lecture = METHODES_LECTURE.indexOf(String((req && req.method) || 'GET').toUpperCase()) !== -1
  const o = String(headers.origin || headers.referer || '')
  if (o === '') return lecture
  try {
    const u = new URL(o)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const port = (req.socket && typeof req.socket.localPort === 'number') ? ':' + req.socket.localPort : ''
    return (['127.0.0.1' + port, 'localhost' + port, '[::1]' + port].indexOf(u.host) >= 0 || kbTrusted(u.host))
  } catch { return false }
}

const lireCorps = (req) => new Promise((res) => {
  let corps = ''
  req.on('data', (d) => { corps += d })
  req.on('end', () => { try { res(JSON.parse(corps || '{}')) } catch (e) { res({}) } })
})

// ── S-01 : confinement des chemins libres ──────────────────────────────────
// Un `chemin` fourni par le client n'est accepté que s'il est CONNU des
// sessions (un slug de ce chemin existe sous sessionsHome : une session y a
// réellement travaillé). Le slug dérivé de `corps.session` reste toujours
// valable. Tout autre chemin (ex. /tmp, /etc) est refusé avant d'atteindre
// git/gh — l'exécution reste confinée aux racines des chantiers enregistrés.
const cheminConfine = (sessionsHome, corps, slug) => {
  if (corps.chemin === undefined || corps.chemin === null || corps.chemin === '') {
    return slug !== null ? decodeSlugPath(slug) : null
  }
  const libre = String(corps.chemin)
  if (slugsDeChemin(sessionsHome, libre).length === 0) return null
  return libre
}

// ── santé des modèles : ce que le « modèle d'étude » surveille ─────────────
// La sonde vit dans son propre module (brain-health.mjs) : elle se teste hors
// DSH avec un service `llm` factice, sans réseau ni clé.
export function monterRoutes (webServerSvc, opts) {
  const sessionsHome = opts.sessionsHome
  const kybersHome = opts.kybersHome
  // Settings, category registry and credentials. Given by `apply()` (the real DSH
  // home); otherwise derived from the session store, so a harness that passes a
  // temporary home stays out of the real one. With no session store either, the
  // DSH home itself (never <os home>/kybernos, which is not a DSH folder).
  const base = sessionsHome === undefined ? dshHome() : dirname(sessionsHome)
  const reglagesFichier = opts.reglagesPath || join(base, 'kybernos', 'settings.json')
  const categoriesFichier = opts.categoriesPath || join(base, 'kybernos', 'categories.json')
  // Le fichier de références du harnais porte la clé de la passerelle de
  // décision. Il est lu PAR L'HÔTE, jamais envoyé à la page : le cerveau de
  // décision n'expose pas de secret au navigateur.
  const referencesFichier = opts.credentialsPath || join(base, '.credentials.yaml')
  // Le moteur de décision est injectable : le harnais de routes le remplace par
  // un faux — sinon chaque contrôle appellerait vraiment la passerelle.
  const moteurDecision = (opts.decision === null || opts.decision === undefined)
    ? { decider, selectionner: selectionnerKyber, selectionnerCategorie }
    : opts.decision

  // Le service `llm` est lu À L'APPEL, pas au montage : DSH peut le publier
  // après ce plugin, et un plugin qui refuse de se monter perdrait toutes ses
  // routes. Getter et non fonction : `creerSonde` teste `typeof llm.stream`
  // pour dire « service indisponible » au lieu d'accuser les 56 modèles.
  const llmParesseux = {
    get stream () {
      let svc = null
      try { svc = opts.ctx === undefined || opts.ctx === null ? null : opts.ctx.get('llm') } catch (e) { svc = null }
      return svc === null || svc === undefined || typeof svc.stream !== 'function' ? undefined : svc.stream.bind(svc)
    }
  }
  const sondeSante = creerSonde({
    llm: llmParesseux,
    delaiMs: parseInt(process.env.KB_BRAIN_DELAI || '8000', 10),
    concurrence: parseInt(process.env.KB_BRAIN_CONCURRENCE || '4', 10),
    ttlMs: parseInt(process.env.KB_BRAIN_TTL || '18000000', 10)
  })
  webServerSvc.register({ kind: 'exact', path: '/kybernos-sessions/state', handler: async (req, res) => {
    if (req.method !== 'GET') { res.writeHead(405); res.end('POST attendu non — GET uniquement'); return }
    if (!origineOK(req)) { res.writeHead(403); res.end('origine refusee'); return }
    try {
      const u = new URL(req.url, 'http://127.0.0.1')
      const sessionId = u.searchParams.get('session') || ''
      const fenetreH = parseInt(u.searchParams.get('window') || '24', 10)
      const etat = await construireEtat({
        sessionsHome, kybersHome, sessionId,
        fenetreMs: (Number.isFinite(fenetreH) ? fenetreH : 24) * 3600 * 1000,
        avecPr: true
      })
      envoyer(res, 200, etat)
    } catch (e) {
      envoyer(res, 500, { erreur: String(e && e.message ? e.message : e) })
    }
  } })
  webServerSvc.register({ kind: 'exact', path: '/kybernos-sessions/isolate', handler: async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405); res.end('GET non supporté — POST attendu'); return }
    if (!origineOK(req)) { res.writeHead(403); res.end('origine refusee'); return }
    const corps = await lireCorps(req)
    const slug = dossierDeSession(sessionsHome, corps.session || '')
    const chemin = slug !== null ? decodeSlugPath(slug) : null
    envoyer(res, 200, await isoler({ chemin, nom: corps.nom, but: corps.but, exec: corps.exec === true, sessionsHome }))
  } })
  webServerSvc.register({ kind: 'exact', path: '/kybernos-sessions/commit', handler: async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405); res.end('GET non supporté — POST attendu'); return }
    if (!origineOK(req)) { res.writeHead(403); res.end('origine refusee'); return }
    const corps = await lireCorps(req)
    const slug = dossierDeSession(sessionsHome, corps.session || '')
    const chemin = cheminConfine(sessionsHome, corps, slug)
    envoyer(res, 200, await commiter({ chemin, message: corps.message, exec: corps.exec === true, chemins: Array.isArray(corps.chemins) ? corps.chemins : null, pousser: corps.local !== true }))
  } })
  // ── « commit & merge dans le repo local » : aucune écriture distante ───────
  // Même route que /commit avec `local:true` (pousser:false) : add des seuls
  // fichiers de ce chat, commit, puis fusion dans la branche de base locale.
  // L'arbre propre + des commits non fusionnés restent un cas utile (fusion
  // seule) — voir `commiter`.
  webServerSvc.register({ kind: 'exact', path: '/kybernos-sessions/close-check', handler: async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405); res.end('GET non supporté — POST attendu'); return }
    if (!origineOK(req)) { res.writeHead(403); res.end('origine refusee'); return }
    const corps = await lireCorps(req)
    const slug = dossierDeSession(sessionsHome, corps.session || '')
    const chemin = cheminConfine(sessionsHome, corps, slug)
    try {
      envoyer(res, 200, await sondeCloture({ chemin, forceIgnores: corps.forceIgnores === true }))
    } catch (e) {
      envoyer(res, 500, { ok: false, cloturable: false, erreur: String(e && e.message ? e.message : e) })
    }
  } })
  // ── santé des modèles (le « modèle d'étude ») ─────────────────────────────
  // Le client envoie la liste des modèles configurés — lui seul la connaît, elle
  // vient du service settings. L'hôte sonde chacun par un appel RÉEL minuscule.
  // Réglage `brain` vide : personne ne surveille, on ne sonde rien et on le dit.
  webServerSvc.register({ kind: 'exact', path: '/kybernos-sessions/brain/health', handler: async (req, res) => {
    if (!origineOK(req)) { res.writeHead(403); res.end('origine refusee'); return }
    // GET : le dernier relevé, sans rien relancer — c'est ce que lit le bandeau
    // au chargement, pour ne pas re-sonder à chaque ouverture de chat.
    if (req.method === 'GET') { envoyer(res, 200, { ok: true, dernier: sondeSante.dernier() }); return }
    if (req.method !== 'POST') { res.writeHead(405); res.end('GET ou POST attendu'); return }
    const corps = await lireCorps(req)
    const reglages = lireReglages(reglagesFichier)
    try {
      envoyer(res, 200, await sondeSante.sonder(corps.models, {
        brain: typeof reglages.brain === 'string' ? reglages.brain : '',
        force: corps.force === true
      }))
    } catch (e) {
      envoyer(res, 500, { ok: false, erreur: String(e && e.message ? e.message : e) })
    }
  } })
  // ── cerveau de décision (Jev) : là où il faut CLASSER, pas rédiger ────────
  // Deux formes, une seule route :
  //   { kybers:[{id,mission}], demande, seuil? } → quel kyber traite la demande ;
  //   { state, questions }                       → une question typée en direct.
  // Le verdict est rendu avec un code 200 même quand il est négatif : comme la
  // sonde de santé, cette route rend un VERDICT, elle ne jette pas — l'appelant
  // lit `ok`, et un `ok:false` n'est pas une panne de la route.
  webServerSvc.register({ kind: 'exact', path: '/kybernos-sessions/decision', handler: async (req, res) => {
    if (!origineOK(req)) { res.writeHead(403); res.end('origine refusee'); return }
    if (req.method !== 'POST') { res.writeHead(405); res.end('POST attendu'); return }
    const corps = await lireCorps(req)
    const seuil = (typeof corps.seuil === 'number' && corps.seuil > 0 && corps.seuil <= 1) ? corps.seuil : undefined
    try {
      const questions = corps.questions
      // Quel modèle sert : le réglage de la page Paramètres, et le défaut si
      // elle n'a rien dit. Le cerveau peut être ÉTEINT là — auquel cas aucune
      // passerelle n'est appelée et le verdict le dit (`CERVEAU-ETEINT`).
      const regle = lireModeleDecision({ fichier: reglagesFichier })
      const modele = typeof corps.modele === 'string' && corps.modele !== ''
        ? corps.modele
        : (regle.eteint === true ? 'none' : regle.modele)
      const verdict = (questions !== null && questions !== undefined && typeof questions === 'object' && Array.isArray(questions) === false)
        ? await moteurDecision.decider(questions, corps.state === undefined ? '' : corps.state,
          { fichierCredentials: referencesFichier, modele })
        : (corps.categorie !== undefined && corps.categorie !== null
            ? await moteurDecision.selectionnerCategorie(corps.categorie,
              { fichierCredentials: referencesFichier, modele, ...(seuil === undefined ? {} : { seuil }) })
            : await moteurDecision.selectionner(corps.kybers, corps.demande,
              { fichierCredentials: referencesFichier, modele, ...(seuil === undefined ? {} : { seuil }) }))
      envoyer(res, 200, verdict === null || typeof verdict !== 'object' ? { ok: false, code: 'VERDICT-ILLISIBLE', erreur: 'le moteur n’a rien rendu' } : verdict)
    } catch (e) {
      envoyer(res, 200, { ok: false, code: 'MOTEUR-EN-PANNE', erreur: String(e && e.message ? e.message : e) })
    }
  } })
  // ── réglages Kybernos : ce que la page Paramètres lit et écrit ─────────────
  webServerSvc.register({ kind: 'exact', path: '/kybernos-sessions/settings', handler: async (req, res) => {
    if (!origineOK(req)) { res.writeHead(403); res.end('origine refusee'); return }
    if (req.method === 'GET') { envoyer(res, 200, { ok: true, reglages: lireReglages(reglagesFichier), modelesDecision: MODELES_DECISION_CONNUS, modeleDecisionDefaut: MODELE_DEFAUT }); return }
    if (req.method !== 'POST') { res.writeHead(405); res.end('GET ou POST attendu'); return }
    try {
      const corps = await lireCorps(req)
      const r = ecrireReglages(reglagesFichier, corps)
      envoyer(res, r.ok === false ? 500 : 200, r.ok === false ? { ok: false, erreur: r.erreur } : { ok: true, reglages: r.reglages })
    } catch (e) {
      envoyer(res, 500, { ok: false, erreur: String(e && e.message ? e.message : e) })
    }
  } })
  // ── catégories de session : la liste les rend en SVG (plus d'emoji) ────────
  webServerSvc.register({ kind: 'exact', path: '/kybernos-sessions/categories', handler: async (req, res) => {
    if (!origineOK(req)) { res.writeHead(403); res.end('origine refusee'); return }
    if (req.method === 'GET') {
      try {
        envoyer(res, 200, { ok: true, categories: lireCategories(categoriesFichier), connues: CATEGORIES_CONNUES })
      } catch (e) {
        envoyer(res, 500, { ok: false, erreur: String(e && e.message ? e.message : e) })
      }
      return
    }
    if (req.method !== 'POST') { res.writeHead(405); res.end('GET ou POST attendu'); return }
    // SEUL écrivain du registre : la CLI de nommage ET le classement automatique
    // du client passent par ici — un format, un validateur. `auto:true` marque
    // la catégorie posée sans nommage d'agent (remplaçable, re-classable).
    const corps = await lireCorps(req)
    const r = ecrireCategorie(categoriesFichier, String(corps.session || ''), String(corps.cat || ''), String(corps.titre || ''), corps.auto === true)
    envoyer(res, r.ok === true ? 200 : 400, r)
  } })
  webServerSvc.register({ kind: 'exact', path: '/kybernos-sessions/close', handler: async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405); res.end('GET non supporté — POST attendu'); return }
    if (!origineOK(req)) { res.writeHead(403); res.end('origine refusee'); return }
    const corps = await lireCorps(req)
    const slugC = dossierDeSession(sessionsHome, corps.session || '')
    envoyer(res, 200, await cloturer({ chemin: cheminConfine(sessionsHome, corps, slugC), exec: corps.exec === true, forceIgnores: corps.forceIgnores === true }))
  } })
  webServerSvc.register({ kind: 'exact', path: '/kybernos-sessions/reclaim', handler: async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405); res.end('GET non supporté — POST attendu'); return }
    if (!origineOK(req)) { res.writeHead(403); res.end('origine refusee'); return }
    const corps = await lireCorps(req)
    const slug = dossierDeSession(sessionsHome, corps.session || '')
    const chemin = cheminConfine(sessionsHome, corps, slug)
    envoyer(res, 200, await ramasser({ chemin, exec: corps.exec === true, sessionsHome, forceIgnores: corps.forceIgnores === true }))
  } })
  // ── v3 « status light » : sync GitHub + pull requests (dry-run d'abord) ────
  const routeAction = (path, faire, extra = () => ({})) => webServerSvc.register({ kind: 'exact', path, handler: async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405); res.end('GET non supporté — POST attendu'); return }
    if (!origineOK(req)) { res.writeHead(403); res.end('origine refusee'); return }
    const corps = await lireCorps(req)
    const slug = dossierDeSession(sessionsHome, corps.session || '')
    const chemin = cheminConfine(sessionsHome, corps, slug)
    envoyer(res, 200, await faire({ chemin, ...extra(corps), exec: corps.exec === true }))
  } })
  routeAction('/kybernos-sessions/push', (o) => pousser(o))
  routeAction('/kybernos-sessions/fetch', (o) => rapatrier(o))
  routeAction('/kybernos-sessions/sync', (o) => synchroniser(o))
  routeAction('/kybernos-sessions/pr', (o) => (o.action === 'merge' ? prFusionner(o) : prCreer(o)),
    (corps) => ({ action: corps.action }))
}

export function apply (ctx) {
  try {
    const home = dshHome()
    const demarrer = (hostCtx) => {
      monterRoutes(hostCtx.webServer, {
        ctx: hostCtx,
        sessionsHome: join(home, 'sessions'),
        kybersHome: join(home, 'kybers'),
        reglagesPath: join(home, 'kybernos', 'settings.json'),
        categoriesPath: join(home, 'kybernos', 'categories.json'),
        credentialsPath: join(home, '.credentials.yaml')
      })
      console.log('[kybernos-sessions] routes webServer /kybernos-sessions/* enregistrees (etat, reglages, categories, actions)')
    }
    if (ctx.get('webServer') !== undefined) demarrer(ctx)
    else ctx.inject(['webServer'], demarrer)
  } catch (e) {
    console.error('[kybernos-sessions] demarrage impossible', e)
  }
}
