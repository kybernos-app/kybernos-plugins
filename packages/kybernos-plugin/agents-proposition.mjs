// ── "Force de proposition": the global rule of the Kybernos agents ──────────
// (02/10/2026) The shared "system prompt" of the DSH agents lives in
// `<DSH home>/AGENTS.md` (~/.dsh by default) — one file PER MACHINE, never in the
// package. So that every user of the plugin gets the "Agent Team/skill matching" reflex,
// the plugin's boot LAYS the section into that file, idempotently: marked, never
// removed. Same contract as `preset-legacy.mjs`: a boot seam, not an engine patch.
//
// Idempotence: an HTML marker opens and closes the section; if the title of the rule
// ALREADY exists outside the markers (the author's machine), nothing is touched —
// overwriting a user's own text would be a regression.
//
// Versions: the marker carries the version of the text. v2 (2026-10-16) names the Study
// model instead of the retired « Decision Brain ». A machine that holds v1 gets v2 at the
// next boot: the v1 section is REPLACED in place, but only when it is byte for byte the
// one this plugin laid (a person's own edit of it is never overwritten), and once — the
// next boot finds v2 and does nothing.
// The SECTION below is the text the agents read, so it stays in French, as written.
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync, appendFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dshHomeSync } from './dsh-home.mjs'

export const MARQUEUR_OUVERT = '<!-- kybernos:force-proposition v2 -->'
export const MARQUEUR_FERME = '<!-- /kybernos:force-proposition -->'
const MARQUEUR_V1 = '<!-- kybernos:force-proposition v1 -->'
const TITRE_EXISTANT = 'Force de proposition dès l\'ouverture d\'un chat'

// The two bodies, markers included, joined with \n (a file with other line endings is compared and written in its own).
const BLOC_V1 = [
  MARQUEUR_V1,
  '## Force de proposition — matching systématique Agent Team/skill (posée par le plugin Kybernos)',
  '',
  'À chaque demande (et à chaque changement de sujet), AVANT de proposer une',
  'ressource, passer la demande dans le double étage — jamais au flair :',
  '',
  '1. **Score lexical en front** : confronter les 1-2 phrases de la demande aux',
  '   missions des Agent Teams installées (`~/.dsh/kybers/`) et aux descriptions',
  '   des skills du catalogue ; garder les 2 meilleurs de chaque.',
  '2. **Arbitre** si le lexical hésite (scores proches ou aucun net) : une',
  '   question fermée au Decision Brain (réglage `decisionBrain`, défaut',
  '   typesafe-ai/jev) : « demande X → Agent Team/skill parmi A, B, aucun ?',
  '   réponds un seul mot ».',
  '',
  'Ne proposer QUE les gagnants — nommés, en une phrase de mission, avec une',
  'question fermée (« je le lance ? »). Une skill se propose, elle ne se charge',
  'qu\'après un oui. Rien de ce qui n\'existe pas ne se propose.',
  '',
  MARQUEUR_FERME
].join('\n')

const BLOC_V2 = [
  MARQUEUR_OUVERT,
  '## Force de proposition — matching systématique Agent Team/skill (posée par le plugin Kybernos)',
  '',
  'À chaque demande (et à chaque changement de sujet), AVANT de proposer une',
  'ressource, passer la demande dans le double étage — jamais au flair :',
  '',
  '1. **Score lexical en front** : confronter les 1-2 phrases de la demande aux',
  '   missions des Agent Teams installées (`~/.dsh/kybers/`) et aux descriptions',
  '   des skills du catalogue ; garder les 2 meilleurs de chaque.',
  '2. **Arbitre** si le lexical hésite (scores proches ou aucun net) : une',
  '   question fermée au Study model (le modèle d\'étude de Kybernos Settings,',
  '   choisi automatiquement par défaut) : « demande X → Agent Team/skill parmi',
  '   A, B, aucun ? réponds un seul mot ».',
  '',
  'Ne proposer QUE les gagnants — nommés, en une phrase de mission, avec une',
  'question fermée (« je le lance ? »). Une skill se propose, elle ne se charge',
  'qu\'après un oui. Rien de ce qui n\'existe pas ne se propose.',
  '',
  MARQUEUR_FERME
].join('\n')

/** Writes `texte` over `chemin` without ever leaving half a file: a temporary file next to it, then a rename. A symlinked
 *  AGENTS.md (a dotfiles repo) stays a link — the new content goes to the real file — and the permissions are kept. */
function ecrireAtomique (chemin, texte) {
  let cible = chemin
  try { cible = realpathSync(chemin) } catch (e) { cible = chemin }
  const temporaire = cible + '.kybernos-' + process.pid + '.tmp'
  try {
    mkdirSync(dirname(cible), { recursive: true })
    writeFileSync(temporaire, texte, 'utf8')
    try { chmodSync(temporaire, statSync(cible).mode & 0o777) } catch (e) { /* the default mode is fine */ }
    renameSync(temporaire, cible)
  } catch (e) {
    try { unlinkSync(temporaire) } catch (e2) { /* nothing was written */ }
    throw e
  }
}

/** Lays the section into `<DSH home>/AGENTS.md` if absent, or replaces an untouched v1 section by v2. Idempotent,
 *  reversible (the markers allow a clean removal). Returns a readable state: `pose`, `deja` (v2 is there), `migre` (v1
 *  replaced), `v1-modifiee` (a v1 section the person edited, or damaged: left alone), `variante-locale`, `erreur`. */
export function poserForceProposition (chemin = join(dshHomeSync(), 'AGENTS.md')) {
  const brut = existsSync(chemin) ? readFileSync(chemin, 'utf8') : ''
  if (brut.includes(MARQUEUR_OUVERT)) return { etat: 'deja', chemin }
  const debut = brut.indexOf(MARQUEUR_V1)
  if (debut >= 0) {
    const fin = brut.indexOf(MARQUEUR_FERME, debut)
    if (fin < 0) return { etat: 'v1-modifiee', chemin }
    const finBloc = fin + MARQUEUR_FERME.length
    if (brut.slice(debut, finBloc).replace(/\r\n/g, '\n') !== BLOC_V1) return { etat: 'v1-modifiee', chemin }
    const eol = brut.includes('\r\n') ? '\r\n' : '\n'
    try {
      ecrireAtomique(chemin, brut.slice(0, debut) + BLOC_V2.replace(/\n/g, eol) + brut.slice(finBloc))
      return { etat: 'migre', chemin }
    } catch (e) {
      return { etat: 'erreur', chemin, erreur: String(e && e.message ? e.message : e) }
    }
  }
  // The author's machine carries the rule written by hand: same title, same
  // spirit — do not double it.
  if (brut.includes(TITRE_EXISTANT)) return { etat: 'variante-locale', chemin }
  try {
    appendFileSync(chemin, '\n' + BLOC_V2 + '\n', 'utf8')
    return { etat: 'pose', chemin }
  } catch (e) {
    return { etat: 'erreur', chemin, erreur: String(e && e.message ? e.message : e) }
  }
}
