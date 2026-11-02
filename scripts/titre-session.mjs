// ── Le nommage des sessions : la partie PURE ───────────────────────────────
//
// Extraite de `session-titre.mjs` au rapatriement (P5) pour être éprouvable
// sans navigateur : catégories, alias historiques, normalisation d'un titre,
// découpage des arguments, portillon du re-titrage de fin de chantier.
//
// La règle utilisateur qui gouverne ce fichier (22/09/2026) : **plus d'emoji
// dans le titre**. La catégorie est un `--cat <slug>` et c'est le plugin
// `kybernos-sessions` qui peint l'icône SVG — un emoji dans le titre est donc
// un refus, pas un détail cosmétique.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const CATEGORIES = Object.freeze({
  fonctionnalite: 'Fonctionnalité',
  correctif: 'Correctif',
  ui: 'UI/design',
  doc: 'Documentation',
  integration: 'Intégration',
  donnees: 'Données',
  nettoyage: 'Nettoyage',
  question: 'Question',
})

/** L'emoji historique, accepté mais jamais ÉCRIT dans un titre. */
export const ALIAS = Object.freeze({
  '🛠️': 'fonctionnalite', '🛠': 'fonctionnalite',
  '🐛': 'correctif',
  '🎨': 'ui',
  '📚': 'doc',
  '🔌': 'integration',
  '📊': 'donnees',
  '🧹': 'nettoyage',
  '❓': 'question', '❔': 'question',
})

/** Rend le slug canonique, ou `null` si la catégorie est absente/inconnue. */
export const slugDe = (brut) => {
  if (brut === null || brut === undefined) return null
  const v = String(brut).trim()
  if (CATEGORIES[v.toLowerCase()] !== undefined) return v.toLowerCase()
  if (ALIAS[v] !== undefined) return ALIAS[v]
  const nu = v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  return CATEGORIES[nu] === undefined ? null : nu
}

/** Un titre ne porte plus d'emoji (icônes SVG à la place). */
export const emojiDansTitre = (titre) => /\p{Extended_Pictographic}/u.test(String(titre || ''))

/**
 * La forme comparable d'un titre : on retire l'icône de tête et les espaces.
 * Sert au garde-fou `--match` (un fragment doit tomber sur la session visée).
 */
export const normaliserTitre = (s) =>
  String(s).replace(/^[\p{Extended_Pictographic}\uFE0E\uFE0F\u200D\s]+/u, '').trim()

export const FICHIER_REGLAGES = join(homedir(), '.dsh', 'kybernos', 'settings.json')

/**
 * Le re-titrage de FIN de chantier est débrayable (réglage « Rename Chat
 * session after each recap ») ; le nommage INITIAL ne l'est jamais. Un fichier
 * illisible ne débraye rien — l'absence de réglage vaut « autorisé ».
 */
export const lireReglages = (fichier = FICHIER_REGLAGES) => {
  try { return JSON.parse(readFileSync(fichier, 'utf8')) } catch (e) { return { renameAfterRecap: true } }
}

export const recapAutorise = (fichier = FICHIER_REGLAGES) => lireReglages(fichier).renameAfterRecap !== false

/**
 * Le découpage des arguments du CLI : les options à valeur consomment la
 * suivante, tout le reste est positionnel. `--` seul n'est pas une option.
 */
export const decouperArgs = (args, valeurs) => {
  const positionnels = []
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]
    if (String(a).startsWith('--') && String(a).length > 2) {
      if (valeurs.includes(String(a).slice(2))) i += 1
      continue
    }
    positionnels.push(a)
  }
  return positionnels
}

/** Le slug est-il un emoji déguisé / une chaîne vide / une catégorie connue ? */
export const verdictCategorie = (brut) => {
  const slug = slugDe(brut)
  if (slug !== null) return { ok: true, slug, motif: null }
  return {
    ok: false,
    slug: null,
    motif: 'catégorie manquante ou inconnue (' + (brut === null || brut === undefined ? 'absente' : String(brut)) + ').\n  --cat ' + Object.keys(CATEGORIES).join(' | '),
  }
}
