// Builds the Suite catalogue shipped inside the hub (packages/kybernos-hub/catalog.json).
//   node scripts/build-catalog.mjs           # (re)write the file
//   node scripts/build-catalog.mjs --check   # exit 1 if the file is stale (CI / guard)
//
// The catalogue is DERIVED, never hand-edited: which modules exist comes from
// scripts/lifecycle-packages.json, socle/tier/default-state from docs/beta/satellites.json, and the
// rest (version, title, glyph, family, one-line promise in fr/en) from each module's plugin.json
// (docs/dev/plugin-contract.md). The featured cards (VEDETTES) are still written here.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { manifestErrors } from './plugin-manifest.mjs'

const ICI = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(ICI, '..')
export const FICHIER_CATALOGUE = join(REPO, 'packages', 'kybernos-hub', 'catalog.json')

export const FAMILLES = [
  { id: 'base', fr: 'Fondations', en: 'Foundations', couleur: '#5b6fd6' },
  { id: 'models', fr: 'Modèles', en: 'Models', couleur: '#8a5bd6' },
  { id: 'teams', fr: 'Agent Teams', en: 'Agent Teams', couleur: '#1a9a8a' },
  { id: 'create', fr: 'Créer dans le chat', en: 'Create in the chat', couleur: '#e8630a' },
  { id: 'data', fr: 'Données', en: 'Data', couleur: '#0f8fb5' },
  { id: 'connect', fr: 'Connexions', en: 'Connections', couleur: '#d6458a' },
  { id: 'cloud', fr: 'Cloud', en: 'Cloud', couleur: '#3b8be0' }
]

// Featured = the most advanced modules; `vedette` is the rank in this list. Each one carries a tagline, a description and the points of what it does, written
// from the module's own README (nothing here is a promise the module does not keep).
const VEDETTES = {
  'kybernos-models': {
    accroche: { fr: 'Fournisseurs et modèles au même endroit', en: 'Providers and models in one place' },
    description: {
      fr: 'Une page pour chaque fournisseur et chaque modèle que tes agents peuvent appeler. Ajoute un fournisseur comme dans DSH, désactives-en un sans le supprimer, demande à un fournisseur quels modèles il propose, et compare les modèles dans un tableau : capacités, prix, scores. La page native de DSH reste à un clic.',
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
      fr: 'Le routage Auto envoie chaque étape déléguée vers le meilleur modèle de ta liste. Il pose d’abord une vraie question minuscule aux candidats, écarte ceux qui échouent et garde une chaîne de repli : une délégation n’attend jamais un modèle en panne. Chaque modèle écarté dit pourquoi et quand il sera réessayé.',
      en: 'Auto routing sends each delegated step to the best model of your list. It asks the candidates a real, tiny question first, skips the ones that fail and keeps a fallback chain, so a delegation never waits on a model that is down. Every skipped model says why and when it will be tried again.'
    },
    points: [
      { fr: 'Sonde d’abord : un modèle doit répondre avant d’être choisi (verdict gardé 60 s)', en: 'Probe first: a model must answer before it is chosen (verdict kept 60 s)' },
      { fr: 'Un disjoncteur par modèle : une clé refusée le met en pause, un modèle instable après trois échecs', en: 'A circuit breaker per model: a refused key pauses it, a flaky one after three failures' },
      { fr: 'Une chaîne de repli de 10 modèles au plus, dans l’ordre de ta liste', en: 'A fallback chain of at most 10 models, in the order of your list' },
      { fr: 'Des raisons lisibles : clé refusée, modèle retiré, muet, limite de débit', en: 'Readable reasons: key refused, model gone, silent, rate limited' },
      { fr: 'La commande de l’agent est livrée avec le module', en: 'The agent’s command ships with the module' }
    ]
  },
  'kybernos-memory': {
    accroche: { fr: 'Ce que les agents ont retenu', en: 'What the agents remember' },
    description: {
      fr: 'La page Memory & Lessons : les souvenirs du compte et les leçons de chaque Agent Team, avec recherche, filtres et interrupteurs. La recherche classe par pertinence, en local.',
      en: 'The Memory & Lessons page: the account memories and the lessons of every agent team, with search, filters and switches. Search ranks by relevance, locally.'
    },
    points: [
      { fr: 'Souvenirs du compte : liste, recherche, filtres (épinglés, source, date), ajout, modification, oubli avec annulation', en: 'Account memories: list, search, filters (pinned, source, date), add, edit, forget with Undo' },
      { fr: 'Leçons de chaque Agent Team : filtres, modification, suppression (archivée, pas perdue)', en: 'Lessons of every agent team: filters, edit, delete (archived, not lost)' },
      { fr: 'Recherche classée par pertinence, en local : accents, pluriels et mots rares pris en compte', en: 'Search ranked by relevance, locally: accents, plurals and rare words handled' },
      { fr: 'Options : ce qui est envoyé au modèle, capture automatique, recherche par sens', en: 'Options: what is sent to the model, automatic capture, search by meaning' }
    ]
  },
  'dsh-db-viewer': {
    accroche: { fr: 'Lire la base d’une Agent Team dans le chat', en: 'Read an agent team’s database in the chat' },
    description: {
      fr: 'Une visionneuse SQLite en lecture seule dans la barre latérale : la petite base que garde une Agent Team, en diagramme, en graphiques, en tableaux et avec une zone SELECT. Rien ne peut être écrit depuis la page.',
      en: 'A read-only SQLite viewer in the right sidebar: the small database an agent team keeps, as a diagram, charts, tables and a SELECT box. Nothing can be written from the page.'
    },
    points: [
      { fr: 'Diagramme : une carte par table, avec les liens tirés des clés étrangères', en: 'Diagram: a card per table, with the links drawn from the foreign keys' },
      { fr: 'Graphiques : compteurs et courbes choisies d’après les types de colonnes', en: 'Charts: counters and charts picked from the column types' },
      { fr: 'Données : une table à la fois, en liste', en: 'Data: one table at a time, as a list' },
      { fr: 'SQL : une requête SELECT, WITH, PRAGMA ou EXPLAIN', en: 'SQL: one SELECT, WITH, PRAGMA or EXPLAIN statement' }
    ]
  },
  'kybernos-slides': {
    accroche: { fr: 'Un deck écrit sous tes yeux', en: 'A deck written before your eyes' },
    description: {
      fr: 'L’agent écrit un deck de slides en temps réel dans la barre latérale, caractère par caractère. Tu retouches à la main (texte, pinceau), l’agent relit tes retouches et corrige, et chaque passage corrigé est souligné à l’écran.',
      en: 'The agent writes a slide deck in real time in the right sidebar, character by character. You touch it up by hand (text, brush), the agent reads your edits back and corrects, and every corrected passage is highlighted on screen.'
    },
    points: [
      { fr: 'Six mises en page : titre, statement, puces, chiffre, citation, fin', en: 'Six layouts: title, statement, bullets, figure, quote, end' },
      { fr: 'Quatre thèmes : sombre, clair, corail, papier', en: 'Four themes: dark, light, coral, paper' },
      { fr: 'Tes retouches (texte et pinceau) sont relues par l’agent', en: 'Your edits (text and brush) are read back by the agent' },
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

// ── The help of a module: packages/<dir>/help.json, one per bundle ────────────────────────────────────────────────────
// What it is, how to use it in a few steps, where to find it, one thing worth knowing — in French and in English. The
// Suite shows it on the module's page and the « ? How it works » button of any plugin page shows the same text, so it is
// written once, here, and read from the catalogue. A bundle without a valid help.json fails the build (and CI).
const AIDE_LIMITES = { what: 200, step: 140, good: 220, where: 120, title: 40 }
// The article a card links to (« Read the article »): an address on the help site, never anywhere else. The path is made of
// lower-case words; « {lang} » as its first part stands for the language of the reader (en, fr, ar, zh-cn), the way the site
// addresses its articles (https://help.kybernos.app/<lang>/<category>/<article>/); a bare https://help.kybernos.app/<slug> passes too.
const AIDE_ADRESSE = /^https:\/\/help\.kybernos\.app\/(\{lang\}\/)?[a-z0-9]+(-[a-z0-9]+)*(\/[a-z0-9]+(-[a-z0-9]+)*){0,3}\/?$/
// Words a person who is not a developer does not know: the help is for them. A file name or a folder of the project (« .miniapp.json », « artifacts/ ») is one too.
const JARGON = /\b(slot|bundle|endpoint|DOM|settings\.section|webServer)\b|\.(?:json|ya?ml|mjs|js|toml)\b|\bartifacts\//i

/** Pure: one help card ({ what, steps, where, good?, url? }, plus a title for a page card), checked. */
function validerFiche (dir, brut, champ, { titre }) {
  const faute = (m) => { throw new Error('help.json of "' + dir + '": ' + m) }
  if (brut === null || typeof brut !== 'object' || Array.isArray(brut)) faute(champ + ' is not an object')
  const permis = titre ? ['title', 'what', 'steps', 'where', 'good', 'url'] : ['what', 'steps', 'where', 'good', 'url', 'pages']
  for (const k of Object.keys(brut)) if (!permis.includes(k)) faute((champ === '' ? '' : champ + ': ') + 'unknown field "' + k + '" (expected ' + permis.join(', ') + ')')
  const nom = (f) => (champ === '' ? f : champ + '.' + f)
  const paire = (v, f, max) => {
    const c = nom(f)
    if (v === null || typeof v !== 'object') faute(c + ' must be { fr, en }')
    for (const l of ['fr', 'en']) {
      const t = v[l]
      if (typeof t !== 'string' || t.trim() === '') faute(c + '.' + l + ' is empty')
      if (t.length > max) faute(c + '.' + l + ' is ' + t.length + ' characters, the limit is ' + max)
      if (JARGON.test(t)) faute(c + '.' + l + ' uses a word the user does not know (' + (JARGON.exec(t) || [''])[0] + ')')
      if (/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u.test(t)) faute(c + '.' + l + ' has an emoji')
    }
    return { fr: v.fr.trim(), en: v.en.trim() }
  }
  const out = {}
  if (titre) out.title = paire(brut.title, 'title', AIDE_LIMITES.title)
  out.what = paire(brut.what, 'what', AIDE_LIMITES.what)
  if (!Array.isArray(brut.steps) || brut.steps.length < 2 || brut.steps.length > 4) faute(nom('steps') + ' must hold 2 to 4 entries')
  out.steps = brut.steps.map((e, i) => paire(e, 'steps[' + i + ']', AIDE_LIMITES.step))
  const w = paire(brut.where, 'where', AIDE_LIMITES.where)
  if (typeof brut.where.page !== 'boolean') faute(nom('where.page') + ' must be true or false')
  out.where = { ...w, page: brut.where.page }
  if (brut.good !== undefined) out.good = paire(brut.good, 'good', AIDE_LIMITES.good)
  if (brut.url !== undefined) {
    if (typeof brut.url !== 'string' || AIDE_ADRESSE.test(brut.url) !== true) faute(nom('url') + ' must be an address on help.kybernos.app (https://help.kybernos.app/<article>, or https://help.kybernos.app/{lang}/<category>/<article>/)')
    out.url = brut.url
  }
  return out
}

/**
 * Pure: a help.json, checked. Throws a message that names the bundle and the field. `pages` is optional: a bundle that owns
 * several Settings pages gives each its own card, `{ "voice": { title, what, steps, where, good? } }`, and the page asks for
 * it with `{ id, page }`.
 */
export function validerAide (dir, brut) {
  const faute = (m) => { throw new Error('help.json of "' + dir + '": ' + m) }
  if (brut === null || typeof brut !== 'object' || Array.isArray(brut)) faute('not an object')
  const out = validerFiche(dir, brut, '', { titre: false })
  if (brut.pages !== undefined) {
    if (brut.pages === null || typeof brut.pages !== 'object' || Array.isArray(brut.pages)) faute('pages must be an object')
    out.pages = {}
    for (const [cle, fiche] of Object.entries(brut.pages)) {
      if (/^[a-z][a-z0-9-]{0,31}$/.test(cle) !== true) faute('pages key "' + cle + '" must be lower-case letters, digits and dashes')
      out.pages[cle] = validerFiche(dir, fiche, 'pages.' + cle, { titre: true })
    }
  }
  return out
}

/** Pure: assemble the catalogue from the sources of truth. `manifests` = { <dir>: plugin.json parsed }, `aides` = { <dir>: help.json parsed }. */
export function construireCatalogue ({ lifecycle, satellites, manifests, aides }) {
  const parNom = new Map()
  for (const b of satellites?.socle?.bundles ?? []) parNom.set(b.nom, { ...b, socle: true })
  for (const b of satellites?.satellites?.bundles ?? []) parNom.set(b.nom, { ...b, socle: false })
  const modules = (lifecycle?.packages ?? []).map((p) => {
    const mf = manifests?.[p.dir]
    if (mf === undefined) throw new Error('catalog: "' + p.dir + '" has no plugin.json — write packages/' + p.dir + '/plugin.json (docs/dev/plugin-contract.md)')
    const s = parNom.get(p.nom)
    if (s === undefined) throw new Error('catalog: "' + p.nom + '" is in lifecycle-packages.json but not in docs/beta/satellites.json')
    const v = VEDETTES[p.dir]
    if (aides !== undefined && aides[p.dir] === undefined) throw new Error('catalog: "' + p.dir + '" has no help.json — write packages/' + p.dir + '/help.json (see validerAide in scripts/build-catalog.mjs for the shape)')
    return {
      id: p.dir,
      nom: p.nom,
      titre: mf.name.en,
      glyphe: mf.icon,
      famille: mf.family,
      palier: 'core',
      version: mf.version,
      socle: s.socle === true,
      defaut: s.defaut === 'actif' ? 'actif' : null,
      poids_ko: typeof s.poids_ko === 'number' ? s.poids_ko : null,
      promesse: { fr: mf.description.fr, en: mf.description.en },
      ...(aides === undefined ? {} : { aide: validerAide(p.dir, aides[p.dir]) }),
      ...(v === undefined ? {} : { vedette: Object.keys(VEDETTES).indexOf(p.dir) + 1, accroche: v.accroche, description: v.description, points: v.points })
    }
  })
  const dirs = new Set((lifecycle?.packages ?? []).map((p) => p.dir))
  for (const d of Object.keys(VEDETTES)) if (!dirs.has(d)) throw new Error('catalog: VEDETTES lists "' + d + '" which is not in lifecycle-packages.json')
  return { schema: 1, familles: FAMILLES, modules }
}

const lire = (...chemin) => JSON.parse(readFileSync(join(REPO, ...chemin), 'utf8'))

export function catalogueDuDepot () {
  const lifecycle = lire('scripts', 'lifecycle-packages.json')
  const manifests = {}
  for (const p of lifecycle.packages) {
    const fichier = join(REPO, 'packages', p.dir, 'plugin.json')
    if (!existsSync(fichier)) throw new Error('catalog: "' + p.dir + '" has no plugin.json — write packages/' + p.dir + '/plugin.json (docs/dev/plugin-contract.md)')
    manifests[p.dir] = lire('packages', p.dir, 'plugin.json')
    const fautes = manifestErrors(manifests[p.dir], { firstParty: true, dir: p.dir, packageJson: lire('packages', p.dir, 'package.json'), suiteZone: lire('dsh-compat.json').dsh, fileExists: (rel) => existsSync(join(REPO, 'packages', p.dir, rel)) })
    if (fautes.length > 0) throw new Error('catalog: packages/' + p.dir + '/plugin.json is not valid — ' + fautes.join('; '))
  }
  const aides = {}
  for (const p of lifecycle.packages) if (existsSync(join(REPO, 'packages', p.dir, 'help.json'))) aides[p.dir] = lire('packages', p.dir, 'help.json')
  return construireCatalogue({ lifecycle, satellites: lire('docs', 'beta', 'satellites.json'), manifests, aides })
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
