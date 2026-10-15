// Classement local de secours — quelle catégorie pour ce chat, SANS le cerveau de décision.
//
// Pourquoi ce module existe. L'icône d'une ligne de session est sa catégorie (decision.mjs : CATEGORIES). Le cerveau de décision
// (Jev, sur la passerelle) est la source de la vraie réponse ; mesuré le 15/10/2026, il rend un 403 (« Free tier users do not
// have access to this model ») : plus aucune session créée depuis n'a de catégorie, et toutes les lignes gardent le point
// « non classé ». Ce module donne alors une réponse HONNÊTE et prudente, à partir des seuls mots du titre :
//   · il n'est appelé que quand le cerveau n'a PAS répondu (erreur, éteint, clé absente) — jamais pour contredire un verdict ;
//   · il ne classe que sur un signal net : un mot assez spécifique (ou deux), et une avance sur la catégorie suivante ;
//   · sinon il rend `null` et la ligne garde son icône neutre : on n'invente pas une catégorie ;
//   · son verdict est étiqueté `local` — jamais présenté comme celui du modèle.
// Pur : aucune lecture de fichier, aucun réseau, aucune horloge. Testé par test-classement-local.mjs.
//
// Un radical de 3 lettres ou moins ne vaut que comme mot entier (« ui » n'est pas dans « quiz », « bug » pas dans « debugger »,
// avec les flexions courantes de 3 lettres : bugs, fixed) ; un radical plus long vaut comme début de mot (« nettoy » →
// nettoyage, nettoyer) ; `=mot` ne vaut que comme mot entier (« =memo » : pas « memory »). Accents et casse ignorés.
// Poids : 3 = le mot dit le domaine, 2 = typique, 1 = indice faible (jamais suffisant seul).

/** Score minimal du vainqueur, et avance minimale sur le suivant. */
export const SEUIL_LOCAL = 2
export const ECART_LOCAL = 1

const REGLES = {
  correctif: [
    [3, ['bug', 'regression', 'crash', 'plantage', 'erreur', 'error', 'exception', 'broken', 'ne marche', 'ne fonctionne', 'marche pas', 'fonctionne pas']],
    [2, ['fix', 'corrig', 'repar', 'panne', 'echec', 'fail', 'probleme', 'problem', 'faux positif', 'timeout', 'blocage', 'bloque', 'cass', 'correct', 'durci', 'hardened', 'securise', 'non regression', 'incident', 'constate', 'honnete']],
    [1, ['souci', 'warning']]
  ],
  ui: [
    [3, ['theme', 'ui', 'ux', 'css', 'design', 'maquette', 'mockup', 'icone', 'icon', 'couleur', 'color', 'dark mode', 'mode sombre', 'responsive', 'layout', 'mise en page', 'sidebar', 'barre laterale', 'typograph', 'police', '=logo', 'animation', 'apparence', 'visuel', 'ecran', 'capture', 'liseret']],
    [2, ['style', 'interface', 'bouton', 'button', 'onglet', 'menu', 'accueil', 'affichage', 'alignement', 'aligne', 'espacement', 'padding', 'reglage', 'parametre', 'setting', 'panneau', 'panel', 'pastille', 'puce', 'chip', 'fiche', 'selecteur', 'selector', 'barre', 'pinned', 'epingl', 'pagination', 'repli', 'largeur', 'pixel', 'rendu', 'affich', 'apercu', 'preview', 'miniature', 'galerie', 'gallery', 'composer', 'popover', 'dialogue', 'modale', 'tooltip']],
    [1, ['libelle', 'label']]
  ],
  doc: [
    [3, ['readme', 'documentation', 'changelog', 'tutoriel', 'tuto', 'mode d emploi', 'manuel', 'guide', 'passation', 'handoff']],
    [2, ['doc', 'rapport', 'redig', 'redact', 'article', 'adr', 'specification', '=spec', 'procedure', 'faq', '=memo', 'compte rendu']],
    [1, ['ecrire', 'ecris', 'write', 'skill', 'resume']]
  ],
  integration: [
    [3, ['webhook', 'mcp', 'oauth', 'connecteur', 'connector', 'integration', 'composio', 'telegram', 'slack', 'stripe', 'github', 'gitlab', 'vercel', 'coolify', 'hetzner', 'hostinger', 'openai', 'anthropic', 'cle api', 'api key', 'apikey']],
    [2, ['api', 'serveur', 'server', 'deploy', 'deploiement', 'docker', 'ngrok', 'cloudflare', 'dns', 'domaine', 'smtp', 'fournisseur', 'provider', 'token', 'authentification', '=auth', 'sso', 'sync', 'installation', 'installer', 'install', 'linux', 'windows', 'compte', 'account', 'parrainage', 'referral', 'recette', 'mise a jour', 'update', 'release', 'publication', 'publier', 'publish', 'cloud', 'tunnel', 'passerelle', 'gateway', 'proxy', 'routes']],
    [1, ['service']]
  ],
  donnees: [
    [3, ['donnee', 'data', 'dataset', 'csv', 'sql', 'database', 'base de donnees', 'schema', 'migration', 'tendance', 'trend', 'statistique', 'stats', 'kpi', 'metrique', 'metric', 'benchmark', 'tarif', 'pricing', 'catalogue']],
    [2, ['analyse', 'analysis', 'graphique', 'chart', 'dashboard', 'tableau', 'spreadsheet', 'tableur', 'export', '=excel', 'mesure', 'usage', 'cout', 'cost', 'etude', 'study', 'veille', 'score', 'scores', 'chiffre', 'chiffres', 'economie', 'quality', 'qualite', 'insight', 'insights', 'ledger', 'cout']],
    [1, ['rapport', 'report', 'recherche']]
  ],
  nettoyage: [
    [3, ['nettoy', 'clean', 'cleanup', 'purge', 'dedup', 'deduplic', 'doublon', 'obsolete', 'code mort', 'tidy', 'prune', 'menage']],
    [2, ['supprim', 'delete', 'remove', 'retire', 'vider', 'liberer', 'free up', 'archiv', 'ranger', 'rangement', 'renomm', 'rename', 'deplac', 'refactor']],
    [1, ['simplif']]
  ],
  question: [
    [3, ['pourquoi', 'why', '=comment', 'how']],
    [2, ['=quel', '=quelle', '=quels', '=quelles', 'which', 'what', 'est ce que', 'peux tu', 'can you', 'explique', 'explain', 'difference', 'vs', '=avis', 'conseil', 'recommand', 'compar', 'faut il', 'should', '=quoi', 'greeting', 'hello', 'hi', 'hey', 'salut', 'bonjour', 'bonsoir', 'coucou', 'merci', 'thanks', 'recherche', 'research', 'derniers', 'dernieres', 'latest', 'actualite', 'news', 'actu', 'match', 'matchs', 'meteo', 'weather', 'comparatif', 'comparaison', 'resultat']],
    [1, []]
  ],
  fonctionnalite: [
    [3, ['feature', 'fonctionnalite', 'implement', 'nouvelle fonction', 'nouveau reglage', 'automatisation', 'automation']],
    [2, ['skill', 'agent', 'outil', 'tool', 'workflow', 'plugin', 'module', 'commande', 'command', 'route', 'support', 'refonte', 'redesign', 'protocole', 'relance', 'memoire', 'memory', 'crew', 'miniapp', 'mini app', 'modeleur', 'simulation', 'simulat', 'video', 'voix', 'voice', 'slash', 'brain', 'goal', 'objectif', 'generation', 'generer', 'generat', 'moteur', 'engine', 'cerveau', 'pack', 'vues', 'calendrier', 'planning', 'cycle', 'ecriture', 'edition', 'editeur', 'editor']],
    [1, ['creer', 'cree', 'creation', 'create', 'ajout', 'ajoute', 'add', 'build', 'construi', 'develop', 'mise en place', 'mettre en place', 'nouveau', 'nouvelle', 'new', 'amelior', 'improve', 'evolution']]
  ]
}

/** Titres que le harnais pose avant le premier nommage : rien à classer. */
const TITRES_VIDES = new Set(['new session', 'nouvelle session', 'untitled', 'sans titre', 'new chat', 'nouveau chat'])

const normaliser = (texte) => String(texte === undefined || texte === null ? '' : texte)
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[’']/g, ' ')

const jetons = (texte) => normaliser(texte).split(/[^a-z0-9]+/).filter((j) => j !== '')

/** Les mots (indices de jetons) que ce radical reconnaît dans le titre ; une expression (avec espace) se cherche mot à mot,
 *  début de mot compris, et vaut pour tous les mots qu'elle couvre. */
const reconnus = (radical, listeJetons) => {
  const sortie = []
  if (radical.indexOf(' ') !== -1) {
    const morceaux = radical.split(' ')
    for (let i = 0; i + morceaux.length <= listeJetons.length; i += 1) {
      if (morceaux.every((m, k) => (k === morceaux.length - 1 ? listeJetons[i + k].startsWith(m) : listeJetons[i + k] === m))) {
        for (let k = 0; k < morceaux.length; k += 1) sortie.push(i + k)
      }
    }
    return sortie
  }
  if (radical.startsWith('=')) {
    const exact = radical.slice(1)
    listeJetons.forEach((j, i) => { if (j === exact) sortie.push(i) })
    return sortie
  }
  // Trois lettres ou moins : le mot entier (« ui » n'est pas dans « quiz »), et pour trois lettres ses flexions courantes
  // (bugs, fixed, added). Plus long : un début de mot.
  const flexions = radical.length === 3 ? ['', 's', 'es', 'ed', 'er', 'e'] : ['']
  listeJetons.forEach((j, i) => {
    const ok = radical.length <= 3 ? flexions.some((f) => j === radical + f) : j.startsWith(radical)
    if (ok) sortie.push(i)
  })
  return sortie
}

/**
 * @param {string} titre le titre du chat
 * @returns {{ categorie: string|null, score: number, ecart: number, mots: string[] }}
 *   `categorie` : le slug de CATEGORIES (decision.mjs), ou `null` quand le titre ne dit pas assez.
 */
export function classerLocalement (titre) {
  const vide = { categorie: null, score: 0, ecart: 0, mots: [] }
  const brut = String(titre === undefined || titre === null ? '' : titre).trim()
  if (brut.length < 4) return vide
  const liste = jetons(brut)
  if (TITRES_VIDES.has(liste.join(' '))) return vide
  const points = {}
  const mots = {}
  for (const slug of Object.keys(REGLES)) {
    // Un mot du titre ne compte qu'UNE fois par catégorie (le plus fort de ses radicaux : « creer » ne vaut pas aussi « cree »).
    const parMot = new Map()
    const vus = []
    for (const [poids, radicaux] of REGLES[slug]) {
      for (const r of radicaux) {
        const idx = reconnus(r, liste)
        if (idx.length === 0) continue
        vus.push(r)
        for (const i of idx) parMot.set(i, Math.max(parMot.get(i) || 0, poids))
      }
    }
    let total = 0
    for (const v of parMot.values()) total += v
    // Un point d'interrogation dans le titre : le chat pose une question.
    if (slug === 'question' && brut.indexOf('?') !== -1) { total += 4; vus.push('?') }
    points[slug] = total
    mots[slug] = vus
  }
  // Le plus de points, et une avance sur le suivant : à égalité (un titre qui parle autant d'interface que de données) le titre
  // ne tranche pas — mesuré sur 113 titres déjà classés, départager les égalités ne tombait juste que 2 fois sur 10 : pas de
  // catégorie inventée, la ligne garde son icône neutre.
  const classes = Object.keys(points).sort((a, b) => points[b] - points[a])
  const premier = classes[0]
  const second = classes[1]
  const ecart = points[premier] - points[second]
  if (points[premier] < SEUIL_LOCAL || ecart < ECART_LOCAL) return { ...vide, score: points[premier], ecart }
  return { categorie: premier, score: points[premier], ecart, mots: mots[premier] }
}
