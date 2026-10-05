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
  { id: 'base', fr: 'Fondations', en: 'Foundations', couleur: '#5b6fd6' },
  { id: 'models', fr: 'Modèles', en: 'Models', couleur: '#8a5bd6' },
  { id: 'teams', fr: 'Équipes d’agents', en: 'Agent teams', couleur: '#1a9a8a' },
  { id: 'create', fr: 'Créer dans le chat', en: 'Create in the chat', couleur: '#e8630a' },
  { id: 'data', fr: 'Données', en: 'Data', couleur: '#0f8fb5' },
  { id: 'connect', fr: 'Connecteurs et machines', en: 'Connectors and machines', couleur: '#d6458a' },
  { id: 'cloud', fr: 'Cloud', en: 'Cloud', couleur: '#3b8be0' }
]

// dir → [family, promise fr, promise en]
const FICHE = {
  'kybernos-plugin': ['base', 'Le cœur : équipes d’agents, ressources, réglages et préréglages.', 'The core: agent teams, resources, settings and presets.'],
  'kybernos-hub': ['base', 'Ce panneau, la garde de démarrage et le mode sans échec.', 'This panel, the boot guard and safe mode.'],
  'kybernos-theme': ['base', 'Thème, palettes, fond, police et animation de réflexion.', 'Theme, palettes, background, font and thinking animation.'],
  'kybernos-language': ['base', 'Langue de l’interface : toutes les langues ISO, traduction de Kybernos et de DSH, sens de lecture.', 'Interface language: every ISO language, translation of Kybernos and DSH, reading direction.'],
  'kybernos-sessions': ['base', 'Sessions qui se nomment et se classent seules.', 'Sessions that name and sort themselves.'],
  'kybernos-maintenance': ['base', 'Page À propos : version, compatibilité avec DSH, journal des mises à jour.', 'About page: version, DSH compatibility, update log.'],
  'kybernos-skills': ['base', 'Compétences locales, créées par chat.', 'Local skills, created by chat.'],
  'kybernos-slash': ['base', 'Commandes / et actions de message, créées par chat.', 'Slash commands and message actions, created by chat.'],
  'kybernos-relance': ['base', 'Relancer DSH sans couper l’agent qui travaille.', 'Restart DSH without cutting the working agent.'],
  'kybernos-models': ['models', 'Catalogue de modèles : recherche, comparaison, prix.', 'Model catalogue: search, compare, prices.'],
  'kybernos-modeles-locaux': ['models', 'Modèles locaux détectés et installés depuis les Réglages.', 'Local models detected and installed from Settings.'],
  'kybernos-auto': ['models', 'Routage Auto : choisit un modèle de votre liste selon la classe de la demande.', 'Auto routing: picks a model from your list by request class.'],
  'kybernos-flow': ['teams', 'Reprise des tours coupés, file d’attente réordonnable, barre Goal.', 'Resume cut turns, reorderable queue, Goal bar.'],
  'kybernos-slides': ['create', 'Decks écrits en direct dans la barre latérale.', 'Decks written live in the sidebar.'],
  'kybernos-bricks': ['create', 'Maquettes en briques, animées brique par brique.', 'Brick mockups, animated brick by brick.'],
  'kybernos-modeleur': ['create', 'Modèles 2D et 3D pilotés par le chat.', '2D and 3D models driven by the chat.'],
  'kybernos-miniapps': ['create', '« Install as app » : un panneau devient une app native.', '"Install as app": a panel becomes a native app.'],
  'kybernos-refs': ['create', 'Les liens des messages deviennent des pastilles de référence.', 'Message links become reference chips.'],
  'dsh-mermaid': ['create', 'Diagrammes Mermaid rendus en SVG dans le chat.', 'Mermaid diagrams rendered as SVG in the chat.'],
  'dsh-db-viewer': ['data', 'Visionneuse SQLite en lecture seule, avec graphiques.', 'Read-only SQLite viewer, with charts.'],
  'dsh-media-player': ['create', 'Lecteur audio et vidéo dans la barre latérale.', 'Audio and video player in the sidebar.'],
  'kybernos-composio': ['connect', 'Des centaines de connecteurs en cartes prêtes pour l’agent.', 'Hundreds of connectors as ready-made cards for the agent.'],
  'kybernos-computers': ['connect', 'Ordinateurs cloud pour les agents (votre clé E2B).', 'Cloud computers for agents (your E2B key).'],
  'kybernos-workers': ['connect', 'État vérifié de Claude Code, Codex et ZCode, et exposition au lead.', 'Verified state of Claude Code, Codex and ZCode, and exposure to the lead.'],
  'kybernos-cloud': ['cloud', 'Compte Kybernos, modèles du proxy, mémoire du compte.', 'Kybernos account, proxy models, account memory.'],
  'kybernos-memory': ['cloud', 'La page Memory & Lessons learned : mémoire du compte et leçons par kyber, filtres, interrupteurs.', 'The Memory & Lessons learned page: account memory and lessons per kyber, filters, on/off switches.']
}

// dir → human title (the id stays visible under it) and the glyph the client draws for it.
const TITRES = {
  'kybernos-plugin': 'Kybernos Core', 'kybernos-hub': 'Suite', 'kybernos-theme': 'Theme', 'kybernos-language': 'Language',
  'kybernos-sessions': 'Sessions', 'kybernos-maintenance': 'About & Maintenance', 'kybernos-skills': 'Skills', 'kybernos-slash': 'Slash commands',
  'kybernos-relance': 'Relaunch', 'kybernos-models': 'Models', 'kybernos-modeles-locaux': 'Local models', 'kybernos-auto': 'Auto routing',
  'kybernos-flow': 'Flow', 'kybernos-slides': 'Slides', 'kybernos-bricks': 'Bricks', 'kybernos-modeleur': '3D modeller',
  'kybernos-miniapps': 'Mini-apps', 'kybernos-refs': 'Reference chips', 'dsh-mermaid': 'Mermaid', 'dsh-db-viewer': 'Databases',
  'dsh-media-player': 'Media player', 'kybernos-composio': 'Connectors', 'kybernos-computers': 'Cloud computers', 'kybernos-workers': 'Workers',
  'kybernos-cloud': 'Kybernos Cloud', 'kybernos-memory': 'Memory & Lessons'
}
const GLYPHES = {
  'kybernos-plugin': 'cube', 'kybernos-hub': 'plug', 'kybernos-theme': 'palette', 'kybernos-language': 'lang', 'kybernos-sessions': 'chat',
  'kybernos-maintenance': 'info', 'kybernos-skills': 'bolt', 'kybernos-slash': 'slash', 'kybernos-relance': 'refresh', 'kybernos-models': 'cpu',
  'kybernos-modeles-locaux': 'home', 'kybernos-auto': 'route', 'kybernos-flow': 'flow', 'kybernos-slides': 'slides', 'kybernos-bricks': 'bricks',
  'kybernos-modeleur': 'box3d', 'kybernos-miniapps': 'app', 'kybernos-refs': 'link', 'dsh-mermaid': 'flowc', 'dsh-db-viewer': 'db',
  'dsh-media-player': 'play', 'kybernos-composio': 'plug', 'kybernos-computers': 'pc', 'kybernos-workers': 'wrench', 'kybernos-cloud': 'cloud',
  'kybernos-memory': 'brain'
}

// Featured = the most advanced modules; `vedette` is the rank in this list. Each one carries a tagline, a description and the points of what it does, written
// from the module's own README (nothing here is a promise the module does not keep).
const VEDETTES = {
  'kybernos-models': {
    accroche: { fr: 'Fournisseurs et modèles au même endroit', en: 'Providers and models in one place' },
    description: {
      fr: 'Une page pour chaque fournisseur et chaque modèle que vos agents peuvent appeler. Ajoutez un fournisseur comme dans DSH, désactivez-en un sans le supprimer, demandez à un fournisseur quels modèles il propose, et comparez les modèles dans un tableau : capacités, prix, scores. La page native de DSH reste à un clic.',
      en: 'One page for every provider and every model your agents can call. Add a provider the way DSH does, switch one off without deleting it, ask a provider which models it serves, and compare models in a table: capabilities, prices, scores. DSH’s native page stays one click away.'
    },
    points: [
      { fr: 'Fournisseurs en cartes : état de la clé, nombre de modèles, actions au survol, désactivation sans suppression', en: 'Providers as cards: key state, model count, hover actions, disable without deleting' },
      { fr: 'Tableau des modèles avec filtres par capacité, tri et fiche détaillée', en: 'Models table with capability filters, sorting and a details sheet' },
      { fr: 'Récupérer les modèles disponibles chez le fournisseur, avec recherche et tout sélectionner', en: 'Fetch the available models from the provider, with search and select all' },
      { fr: 'Une pastille qui dit quels modèles ne répondent plus, et pourquoi', en: 'A chip that says which models stopped answering, and why' },
      { fr: 'Les deux adaptateurs DeepSeek modifiables, avec leur catalogue de modèles', en: 'Both DeepSeek adapters editable, with their model catalogue' }
    ]
  },
  'kybernos-auto': {
    accroche: { fr: 'Choisit un modèle qui répond', en: 'Picks a model that answers' },
    description: {
      fr: 'Le routage Auto envoie chaque étape déléguée vers le meilleur modèle de votre liste. Il pose d’abord une vraie question minuscule aux candidats, écarte ceux qui échouent et garde une chaîne de repli : une délégation n’attend jamais un modèle en panne. Chaque modèle écarté dit pourquoi et quand il sera réessayé.',
      en: 'Auto routing sends each delegated step to the best model of your list. It asks the candidates a real, tiny question first, skips the ones that fail and keeps a fallback chain, so a delegation never waits on a model that is down. Every skipped model says why and when it will be tried again.'
    },
    points: [
      { fr: 'Sonde d’abord : un modèle doit répondre avant d’être choisi (verdict gardé 60 s)', en: 'Probe first: a model must answer before it is chosen (verdict kept 60 s)' },
      { fr: 'Un disjoncteur par modèle : une clé refusée le met en pause, un modèle instable après trois échecs', en: 'A circuit breaker per model: a refused key pauses it, a flaky one after three failures' },
      { fr: 'Une chaîne de repli de 10 modèles au plus, dans l’ordre de votre liste', en: 'A fallback chain of at most 10 models, in the order of your list' },
      { fr: 'Des raisons lisibles : clé refusée, modèle retiré, muet, limite de débit', en: 'Readable reasons: key refused, model gone, silent, rate limited' },
      { fr: 'La commande de l’agent est livrée avec le module', en: 'The agent’s command ships with the module' }
    ]
  },
  'kybernos-memory': {
    accroche: { fr: 'Ce que les agents ont retenu', en: 'What the agents remember' },
    description: {
      fr: 'La page Memory & Lessons learned : les souvenirs du compte et les leçons de chaque kyber, avec recherche, filtres et interrupteurs. La recherche classe par pertinence, en local.',
      en: 'The Memory & Lessons learned page: the account memories and the lessons of every kyber, with search, filters and switches. Search ranks by relevance, locally.'
    },
    points: [
      { fr: 'Souvenirs du compte : liste, recherche, filtres (épinglés, source, date), ajout, modification, oubli avec annulation', en: 'Account memories: list, search, filters (pinned, source, date), add, edit, forget with Undo' },
      { fr: 'Leçons de chaque kyber : filtres, modification, suppression (archivée, pas perdue)', en: 'Lessons of every kyber: filters, edit, delete (archived, not lost)' },
      { fr: 'Recherche classée par pertinence, en local : accents, pluriels et mots rares pris en compte', en: 'Search ranked by relevance, locally: accents, plurals and rare words handled' },
      { fr: 'Options : ce qui est envoyé au modèle, capture automatique, recherche par sens', en: 'Options: what is sent to the model, automatic capture, search by meaning' }
    ]
  },
  'dsh-db-viewer': {
    accroche: { fr: 'Lire la base d’un kyber dans le chat', en: 'Read a kyber’s database in the chat' },
    description: {
      fr: 'Une visionneuse SQLite en lecture seule dans la barre latérale : la petite base que garde un kyber, en diagramme, en graphiques, en tableaux et avec une zone SELECT. Rien ne peut être écrit depuis la page.',
      en: 'A read-only SQLite viewer in the right sidebar: the small database a kyber keeps, as a diagram, charts, tables and a SELECT box. Nothing can be written from the page.'
    },
    points: [
      { fr: 'Diagramme : une carte par table, avec les liens tirés des clés étrangères', en: 'Diagram: a card per table, with the links drawn from the foreign keys' },
      { fr: 'Graphiques : compteurs et courbes choisies d’après les types de colonnes', en: 'Charts: counters and charts picked from the column types' },
      { fr: 'Données : une table à la fois, en liste', en: 'Data: one table at a time, as a list' },
      { fr: 'SQL : une requête SELECT, WITH, PRAGMA ou EXPLAIN', en: 'SQL: one SELECT, WITH, PRAGMA or EXPLAIN statement' }
    ]
  },
  'kybernos-slides': {
    accroche: { fr: 'Un deck écrit sous vos yeux', en: 'A deck written before your eyes' },
    description: {
      fr: 'L’agent écrit un deck de slides en temps réel dans la barre latérale, caractère par caractère. Vous retouchez à la main (texte, pinceau), l’agent relit vos retouches et corrige, et chaque passage corrigé est souligné à l’écran.',
      en: 'The agent writes a slide deck in real time in the right sidebar, character by character. You touch it up by hand (text, brush), the agent reads your edits back and corrects, and every corrected passage is highlighted on screen.'
    },
    points: [
      { fr: 'Six mises en page : titre, statement, puces, chiffre, citation, fin', en: 'Six layouts: title, statement, bullets, figure, quote, end' },
      { fr: 'Quatre thèmes : sombre, clair, corail, papier', en: 'Four themes: dark, light, coral, paper' },
      { fr: 'Vos retouches (texte et pinceau) sont relues par l’agent', en: 'Your edits (text and brush) are read back by the agent' },
      { fr: 'Les passages corrigés par l’agent reçoivent un halo vert', en: 'Passages corrected by the agent get a green halo' }
    ]
  },
  'kybernos-modeleur': {
    accroche: { fr: '2D et 3D, dessinés par l’agent', en: '2D and 3D, drawn by the agent' },
    description: {
      fr: 'L’agent dessine un modèle 2D ou 3D ; il s’anime dans la barre latérale, objet par objet, puis se relit. Les solides 3D s’orbitent.',
      en: 'The agent draws a 2D or 3D model; it animates in the right sidebar, object by object, then plays back. 3D solids can be orbited.'
    },
    points: [
      { fr: 'Un moteur 2D à l’échelle et un moteur 3D de solides orbitables', en: 'A to-scale 2D engine and an orbitable 3D solids engine' },
      { fr: 'Pose objet par objet, calée sur l’horloge de l’hôte : un onglet en retard rattrape son retard', en: 'Objects appear one by one on the host’s clock: a late tab catches up' },
      { fr: 'Lecture, vitesses, curseur et relecture', en: 'Play, speeds, cursor and replay' }
    ]
  }
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
    const v = VEDETTES[p.dir]
    return {
      id: p.dir,
      nom: p.nom,
      titre: TITRES[p.dir],
      glyphe: GLYPHES[p.dir],
      famille: f[0],
      palier: 'core',
      version,
      socle: s.socle === true,
      defaut: s.defaut === 'actif' ? 'actif' : null,
      poids_ko: typeof s.poids_ko === 'number' ? s.poids_ko : null,
      promesse: { fr: f[1], en: f[2] },
      ...(v === undefined ? {} : { vedette: Object.keys(VEDETTES).indexOf(p.dir) + 1, accroche: v.accroche, description: v.description, points: v.points })
    }
  })
  const dirs = new Set((lifecycle?.packages ?? []).map((p) => p.dir))
  for (const d of dirs) if (typeof TITRES[d] !== 'string' || typeof GLYPHES[d] !== 'string') throw new Error('catalog: "' + d + '" has no title or glyph — add it to TITRES and GLYPHES in scripts/build-catalog.mjs')
  for (const d of Object.keys(VEDETTES)) if (!dirs.has(d)) throw new Error('catalog: VEDETTES lists "' + d + '" which is not in lifecycle-packages.json')
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
