// ── Force de proposition : la règle globale des agents Kybernos ─────────────
// (02/10/2026) Le « prompt système » partagé des agents DSH vit dans
// `~/.dsh/AGENTS.md` — un fichier PAR POSTE, jamais dans le paquet. Pour que
// chaque utilisateur du plugin reçoive le réflexe « matching kyber/skill »,
// le boot du plugin POSSE la section dans ce fichier, de façon idempotente :
// marquée, jamais réécrite, jamais supprimée. C'est le même contrat que
// `preset-compaction.mjs` : une couture de boot, pas un patch moteur.
//
// Idempotence : un marqueur HTML ouvre et ferme la section ; si le titre de la
// règle existe DÉJÀ hors marqueur (le cas du poste de l'auteur), on ne touche
// à rien — écraser la main d'un utilisateur serait une régression.
import { existsSync, readFileSync, appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

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

/** Pose la section dans `~/.dsh/AGENTS.md` si absente. Idempotent, réversible
 *  (les marqueurs permettent un retrait propre). Rend un état lisible. */
export function poserForceProposition (chemin = join(homedir(), '.dsh', 'AGENTS.md')) {
  const brut = existsSync(chemin) ? readFileSync(chemin, 'utf8') : ''
  if (brut.includes(MARQUEUR_OUVERT)) return { etat: 'deja', chemin }
  // Le poste de l'auteur porte la règle écrite à la main : même titre, même
  // esprit — ne pas doubler.
  if (brut.includes(TITRE_EXISTANT)) return { etat: 'variante-locale', chemin }
  try {
    appendFileSync(chemin, SECTION, 'utf8')
    return { etat: 'pose', chemin }
  } catch (e) {
    return { etat: 'erreur', chemin, erreur: String(e && e.message ? e.message : e) }
  }
}
