// Local classifier — which category for this chat, from the words of its title alone.
//
// Why this module exists. The icon of a session row is its category (decision.mjs: CATEGORIES). The words of the title are
// asked FIRST, before any model: they cost nothing, send nothing anywhere and are instant. A model (the Study model, see
// decision-llm.mjs) is asked only when they have no clear signal. The answer is deliberately cautious:
//   · it classifies only on a clear signal: a specific enough word (or two), and a lead over the next category;
//   · otherwise it answers `null` and the row keeps its neutral icon: a category is never invented;
//   · its verdict is labelled `local` — never presented as the model's.
// Pure: no file read, no network, no clock. Tested by test-classement-local.mjs.
//
// A stem of 3 letters or less only counts as a whole word (« ui » is not in « quiz », « bug » not in « debugger », with the
// common 3-letter inflections: bugs, fixed); a longer stem counts as a word start (« nettoy » → nettoyage, nettoyer); `=word`
// only counts as a whole word (« =memo »: not « memory »). Accents and case are ignored.
// Weights: 3 = the word names the domain, 2 = typical, 1 = weak hint (never enough alone).

/** Minimum score of the winner, and minimum lead over the next category. */
export const SEUIL_LOCAL = 2
export const ECART_LOCAL = 1

// The rules below mix English and French stems (accents removed). The French ones that read as a sentence are kept apart in this
// French table, so that the rest of the file holds no French text.
const PHRASES_FR = { doc: ['compte rendu'], question: ['est ce que'] }

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
    [2, ['doc', 'rapport', 'redig', 'redact', 'article', 'adr', 'specification', '=spec', 'procedure', 'faq', '=memo', ...PHRASES_FR.doc]],
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
    [2, ['=quel', '=quelle', '=quels', '=quelles', 'which', 'what', ...PHRASES_FR.question, 'peux tu', 'can you', 'explique', 'explain', 'difference', 'vs', '=avis', 'conseil', 'recommand', 'compar', 'faut il', 'should', '=quoi', 'greeting', 'hello', 'hi', 'hey', 'salut', 'bonjour', 'bonsoir', 'coucou', 'merci', 'thanks', 'recherche', 'research', 'derniers', 'dernieres', 'latest', 'actualite', 'news', 'actu', 'match', 'matchs', 'meteo', 'weather', 'comparatif', 'comparaison', 'resultat']],
    [1, []]
  ],
  fonctionnalite: [
    [3, ['feature', 'fonctionnalite', 'implement', 'nouvelle fonction', 'nouveau reglage', 'automatisation', 'automation']],
    [2, ['skill', 'agent', 'outil', 'tool', 'workflow', 'plugin', 'module', 'commande', 'command', 'route', 'support', 'refonte', 'redesign', 'protocole', 'relance', 'memoire', 'memory', 'crew', 'miniapp', 'mini app', 'modeleur', 'simulation', 'simulat', 'video', 'voix', 'voice', 'slash', 'brain', 'goal', 'objectif', 'generation', 'generer', 'generat', 'moteur', 'engine', 'cerveau', 'pack', 'vues', 'calendrier', 'planning', 'cycle', 'ecriture', 'edition', 'editeur', 'editor']],
    [1, ['creer', 'cree', 'creation', 'create', 'ajout', 'ajoute', 'add', 'build', 'construi', 'develop', 'mise en place', 'mettre en place', 'nouveau', 'nouvelle', 'new', 'amelior', 'improve', 'evolution']]
  ]
}

/** Titles the harness sets before the first naming: nothing to classify. */
const TITRES_VIDES = new Set(['new session', 'nouvelle session', 'untitled', 'sans titre', 'new chat', 'nouveau chat'])

const normaliser = (texte) => String(texte === undefined || texte === null ? '' : texte)
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[’']/g, ' ')

const jetons = (texte) => normaliser(texte).split(/[^a-z0-9]+/).filter((j) => j !== '')

/** The words (token indexes) this stem recognises in the title; a phrase (with a space) is looked for word by word, word
 *  start included, and counts for every word it covers. */
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
  // Three letters or less: the whole word (« ui » is not in « quiz »), and for three letters its common inflections
  // (bugs, fixed, added). Longer: a word start.
  const flexions = radical.length === 3 ? ['', 's', 'es', 'ed', 'er', 'e'] : ['']
  listeJetons.forEach((j, i) => {
    const ok = radical.length <= 3 ? flexions.some((f) => j === radical + f) : j.startsWith(radical)
    if (ok) sortie.push(i)
  })
  return sortie
}

/**
 * @param {string} titre the chat title
 * @returns {{ categorie: string|null, score: number, ecart: number, mots: string[] }}
 *   `categorie`: the slug of CATEGORIES (decision.mjs), or `null` when the title does not say enough.
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
    // A word of the title counts ONCE per category (the strongest of its stems: « creer » is not also « cree »).
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
    // A question mark in the title: the chat asks a question.
    if (slug === 'question' && brut.indexOf('?') !== -1) { total += 4; vus.push('?') }
    points[slug] = total
    mots[slug] = vus
  }
  // The most points, and a lead over the next: on a tie (a title that speaks as much of interface as of data) the title does
  // not decide — measured on 113 titles already classified, breaking ties was right only 2 times out of 10: no invented
  // category, the row keeps its neutral icon.
  const classes = Object.keys(points).sort((a, b) => points[b] - points[a])
  const premier = classes[0]
  const second = classes[1]
  const ecart = points[premier] - points[second]
  if (points[premier] < SEUIL_LOCAL || ecart < ECART_LOCAL) return { ...vide, score: points[premier], ecart }
  return { categorie: premier, score: points[premier], ecart, mots: mots[premier] }
}

/** Is this a placeholder title the harness sets before the first naming (« New Session », « Untitled »…)? Nothing in it is
 *  worth putting to a model. */
export function estTitreAttente (titre) {
  return TITRES_VIDES.has(jetons(titre).join(' '))
}
