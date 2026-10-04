// Builds the Suite catalogue shipped inside the hub (packages/kybernos-hub/catalog.json).
//   node scripts/build-catalog.mjs           # (re)write the file
//   node scripts/build-catalog.mjs --check   # exit 1 if the file is stale (CI / guard)
//
// The catalogue is DERIVED, never hand-edited: which modules exist comes from
// scripts/lifecycle-packages.json, socle/tier/default-state from docs/beta/satellites.json,
// the version from each package.json. Only the family and the one-line promise (fr/en)
// are written here, once, because nothing else knows them.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ICI = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(ICI, '..')
export const FICHIER_CATALOGUE = join(REPO, 'packages', 'kybernos-hub', 'catalog.json')

export const FAMILLES = [
  { id: 'base', fr: 'Fondations', en: 'Foundations', ligne: { fr: 'Le socle, sur chaque poste.', en: 'The base, on every machine.' }, icone: 'box' },
  { id: 'models', fr: 'Modèles', en: 'Models', ligne: { fr: 'N’importe quel modèle, y compris local.', en: 'Any model, local ones included.' }, icone: 'cpu' },
  { id: 'teams', fr: 'Équipes d’agents', en: 'Agent teams', ligne: { fr: 'File d’attente, reprise, objectifs.', en: 'Queue, resume, goals.' }, icone: 'users' },
  { id: 'create', fr: 'Créer dans le chat', en: 'Create in the chat', ligne: { fr: 'L’agent montre au lieu d’expliquer.', en: 'The agent shows instead of explaining.' }, icone: 'layout' },
  { id: 'connect', fr: 'Connecteurs et machines', en: 'Connectors and machines', ligne: { fr: 'Vos outils, des ordinateurs pour l’agent.', en: 'Your tools, computers for the agent.' }, icone: 'plug' },
  { id: 'cloud', fr: 'Cloud', en: 'Cloud', ligne: { fr: 'Compte, mémoire, modèles du proxy.', en: 'Account, memory, proxy models.' }, icone: 'cloud' }
]

// dir → [family, promise fr, promise en]
const FICHE = {
  'kybernos-plugin': ['base', 'Le cœur : équipes d’agents, ressources, réglages et préréglages.', 'The core: agent teams, resources, settings and presets.'],
  'kybernos-hub': ['base', 'Ce panneau, la garde de démarrage et le mode sans échec.', 'This panel, the boot guard and safe mode.'],
  'kybernos-theme': ['base', 'Thème, palettes, fond, police et animation de réflexion.', 'Theme, palettes, background, font and thinking animation.'],
  'kybernos-language': ['base', 'Langue de l’interface : toutes les langues ISO, traduction de Kybernos et de DSH, sens de lecture.', 'Interface language: every ISO language, translation of Kybernos and DSH, reading direction.'],
  'kybernos-sessions': ['base', 'Sessions qui se nomment et se classent seules.', 'Sessions that name and sort themselves.'],
  'kybernos-maintenance': ['base', 'Versions, journal, état de santé de l’installation.', 'Versions, journal, installation health.'],
  'kybernos-skills': ['base', 'Compétences locales, créées par chat.', 'Local skills, created by chat.'],
  'kybernos-slash': ['base', 'Commandes / et actions de message, créées par chat.', 'Slash commands and message actions, created by chat.'],
  'kybernos-relance': ['base', 'Relancer DSH sans couper l’agent qui travaille.', 'Restart DSH without cutting the working agent.'],
  'kybernos-models': ['models', 'Catalogue de modèles : recherche, comparaison, prix.', 'Model catalogue: search, compare, prices.'],
  'kybernos-modeles-locaux': ['models', 'Modèles locaux détectés et installés depuis les Réglages.', 'Local models detected and installed from Settings.'],
  'kybernos-auto': ['models', 'Routage Auto : le moindre modèle qui passe votre seuil.', 'Auto routing: the cheapest model that clears your bar.'],
  'kybernos-flow': ['teams', 'Reprise des tours coupés, file d’attente réordonnable, barre Goal.', 'Resume cut turns, reorderable queue, Goal bar.'],
  'kybernos-slides': ['create', 'Decks écrits en direct dans la barre latérale.', 'Decks written live in the sidebar.'],
  'kybernos-bricks': ['create', 'Maquettes en briques, animées brique par brique.', 'Brick mockups, animated brick by brick.'],
  'kybernos-modeleur': ['create', 'Modèles 2D et 3D pilotés par le chat.', '2D and 3D models driven by the chat.'],
  'kybernos-miniapps': ['create', '« Install as app » : un panneau devient une app native.', '"Install as app": a panel becomes a native app.'],
  'kybernos-refs': ['create', 'Les liens des messages deviennent des pastilles de référence.', 'Message links become reference chips.'],
  'dsh-mermaid': ['create', 'Diagrammes Mermaid rendus en SVG dans le chat.', 'Mermaid diagrams rendered as SVG in the chat.'],
  'dsh-db-viewer': ['create', 'Bases SQLite et Postgres, avec graphiques.', 'SQLite and Postgres databases, with charts.'],
  'dsh-media-player': ['create', 'Lecteur audio et vidéo dans la barre latérale.', 'Audio and video player in the sidebar.'],
  'kybernos-composio': ['connect', 'Des centaines de connecteurs en cartes prêtes pour l’agent.', 'Hundreds of connectors as ready-made cards for the agent.'],
  'kybernos-computers': ['connect', 'Ordinateurs cloud pour les agents (votre clé E2B).', 'Cloud computers for agents (your E2B key).'],
  'kybernos-workers': ['connect', 'État vérifié de Claude Code, Codex et ZCode, et exposition au lead.', 'Verified state of Claude Code, Codex and ZCode, and exposure to the lead.'],
  'kybernos-cloud': ['cloud', 'Compte Kybernos, modèles du proxy, mémoire du compte.', 'Kybernos account, proxy models, account memory.'],
  'kybernos-memory': ['cloud', 'La page Memory & Lessons learned : mémoire du compte et leçons par kyber, filtres, interrupteurs.', 'The Memory & Lessons learned page: account memory and lessons per kyber, filters, on/off switches.']
}

/** Pure: assemble the catalogue from the three sources of truth. */
export function construireCatalogue ({ lifecycle, satellites, versions }) {
  const parNom = new Map()
  for (const b of satellites?.socle?.bundles ?? []) parNom.set(b.nom, { ...b, socle: true })
  for (const b of satellites?.satellites?.bundles ?? []) parNom.set(b.nom, { ...b, socle: false })
  const modules = (lifecycle?.packages ?? []).map((p) => {
    const f = FICHE[p.dir]
    if (f === undefined) throw new Error('catalog: no family/promise for "' + p.dir + '" — add it to FICHE in scripts/build-catalog.mjs')
    const s = parNom.get(p.nom)
    if (s === undefined) throw new Error('catalog: "' + p.nom + '" is in lifecycle-packages.json but not in docs/beta/satellites.json')
    const version = versions?.[p.dir]
    if (typeof version !== 'string') throw new Error('catalog: no version for "' + p.dir + '"')
    return {
      id: p.dir,
      nom: p.nom,
      famille: f[0],
      palier: 'core',
      version,
      socle: s.socle === true,
      defaut: s.defaut === 'actif' ? 'actif' : null,
      poids_ko: typeof s.poids_ko === 'number' ? s.poids_ko : null,
      promesse: { fr: f[1], en: f[2] }
    }
  })
  const dirs = new Set((lifecycle?.packages ?? []).map((p) => p.dir))
  for (const d of Object.keys(FICHE)) if (!dirs.has(d)) throw new Error('catalog: FICHE lists "' + d + '" which is not in lifecycle-packages.json')
  return { schema: 1, familles: FAMILLES, modules }
}

const lire = (...chemin) => JSON.parse(readFileSync(join(REPO, ...chemin), 'utf8'))

export function catalogueDuDepot () {
  const lifecycle = lire('scripts', 'lifecycle-packages.json')
  const versions = {}
  for (const p of lifecycle.packages) versions[p.dir] = lire('packages', p.dir, 'package.json').version
  return construireCatalogue({ lifecycle, satellites: lire('docs', 'beta', 'satellites.json'), versions })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const texte = JSON.stringify(catalogueDuDepot(), null, 2) + '\n'
  if (process.argv.includes('--check')) {
    let actuel = ''
    try { actuel = readFileSync(FICHIER_CATALOGUE, 'utf8') } catch { /* missing */ }
    if (actuel !== texte) { console.error('✗ packages/kybernos-hub/catalog.json is stale — run: node scripts/build-catalog.mjs'); process.exit(1) }
    console.log('✓ catalogue up to date (' + JSON.parse(texte).modules.length + ' modules)')
  } else {
    writeFileSync(FICHIER_CATALOGUE, texte)
    console.log('✓ wrote packages/kybernos-hub/catalog.json (' + JSON.parse(texte).modules.length + ' modules)')
  }
}
