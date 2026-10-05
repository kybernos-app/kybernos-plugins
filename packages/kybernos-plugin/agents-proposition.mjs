// ── "Force de proposition": the global rule of the Kybernos agents ──────────
// (02/10/2026) The shared "system prompt" of the DSH agents lives in
// `<DSH home>/AGENTS.md` (~/.dsh by default) — one file PER MACHINE, never in the
// package. So that every user of the plugin gets the "kyber/skill matching" reflex,
// the plugin's boot LAYS the section into that file, idempotently: marked, never
// rewritten, never removed. Same contract as `preset-compaction.mjs`: a boot seam,
// not an engine patch.
//
// Idempotence: an HTML marker opens and closes the section; if the title of the rule
// ALREADY exists outside the markers (the author's machine), nothing is touched —
// overwriting a user's own text would be a regression.
// The SECTION below is the text the agents read, so it stays in French, as written.
import { existsSync, readFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { dshHomeSync } from './dsh-home.mjs'

export const MARQUEUR_OUVERT = '<!-- kybernos:force-proposition v1 -->'
export const MARQUEUR_FERME = '<!-- /kybernos:force-proposition -->'
const TITRE_EXISTANT = 'Force de proposition dès l\'ouverture d\'un chat'

const SECTION = [
  '',
  MARQUEUR_OUVERT,
  '## Force de proposition — matching systématique kyber/skill (posée par le plugin Kybernos)',
  '',
  'À chaque demande (et à chaque changement de sujet), AVANT de proposer une',
  'ressource, passer la demande dans le double étage — jamais au flair :',
  '',
  '1. **Score lexical en front** : confronter les 1-2 phrases de la demande aux',
  '   missions des kybers installés (`~/.dsh/kybers/`) et aux descriptions des',
  '   skills du catalogue ; garder les 2 meilleurs de chaque.',
  '2. **Arbitre** si le lexical hésite (scores proches ou aucun net) : une',
  '   question fermée au Decision Brain (réglage `decisionBrain`, défaut',
  '   typesafe-ai/jev) : « demande X → kyber/skill parmi A, B, aucun ? réponds',
  '   un seul mot ».',
  '',
  'Ne proposer QUE les gagnants — nommés, en une phrase de mission, avec une',
  'question fermée (« je le lance ? »). Une skill se propose, elle ne se charge',
  'qu\'après un oui. Rien de ce qui n\'existe pas ne se propose.',
  '',
  MARQUEUR_FERME,
  ''
].join('\n')

/** Lays the section into `<DSH home>/AGENTS.md` if absent. Idempotent, reversible
 *  (the markers allow a clean removal). Returns a readable state. */
export function poserForceProposition (chemin = join(dshHomeSync(), 'AGENTS.md')) {
  const brut = existsSync(chemin) ? readFileSync(chemin, 'utf8') : ''
  if (brut.includes(MARQUEUR_OUVERT)) return { etat: 'deja', chemin }
  // The author's machine carries the rule written by hand: same title, same
  // spirit — do not double it.
  if (brut.includes(TITRE_EXISTANT)) return { etat: 'variante-locale', chemin }
  try {
    appendFileSync(chemin, SECTION, 'utf8')
    return { etat: 'pose', chemin }
  } catch (e) {
    return { etat: 'erreur', chemin, erreur: String(e && e.message ? e.message : e) }
  }
}
