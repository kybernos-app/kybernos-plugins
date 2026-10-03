// ── Le filet du compactage, sans écrire dans le moteur ─────────────────────
//
// Mesuré le 23/09/2026 (sonde `scripts/sonde-compaction-plugin.mjs`) :
//   · le seuil vit dans `presets/standard.patch.yml` → `compaction-basic.config
//     .thresholdRatio`, défaut 0,8 × la fenêtre ;
//   · le composeur de patchs de DSH ne descend PAS dans un `config.plugins` en
//     objet : aucun patch de profil ne peut atteindre cet enfant
//     (`patch-dsh-compaction-net.mjs --sonde` → « entry persona not found ») ;
//   · notre bundle monte APRÈS `dsh-web-app` (profil : #12 contre #1), donc
//     muter la définition après coup est trop tard — l'enfant a déjà monté.
//
// Le chemin qui reste, et qu'on prend ici : notre plugin enregistre un preset
// À NOUS, cloné au démarrage depuis la définition du preset source telle que le
// registre la tient en mémoire. On ne recopie donc AUCUN YAML : on hérite de la
// composition du jour et on ne change qu'une feuille. Un preset de plus est
// exactement ce que DSH supporte (standard, minimal, ptc, cordis coexistent).
//
// Le choix du preset par défaut se fait ensuite par un RÉGLAGE
// (`agentPresets.policy()` lit `selectedDefault`, sinon `config.default`), donc
// sans toucher à un fichier non plus.

export const PAQUET_COMPACTAGE = '@deepseek-ai/dsh-compaction-basic'
export const CHAMP_SEUIL = 'thresholdRatio'
export const CHAMP_PROVIDER = 'summarizationProvider'
export const CHAMP_MODELE = 'summarizationModel'
export const ID_PRESET_KYBERNOS = 'kybernos-standard'

// Nom AFFICHÉ de notre preset. Il manquait : un preset natif tire son libellé de
// la locale du cœur, pas de sa définition, donc `source.name` était vide et le
// clone partait sans nom. Le registre retombe alors sur l'identifiant
// (`preset.name ?? preset.id`) et la carte des Réglages coupait
// « kybernos-standa… » sur 85 px (constat de la campagne visuelle). Un nom court
// suffit — l'identifiant, lui, reste `kybernos-standard` (il est durable : ne pas
// le renommer).
export const NOM_PRESET_KYBERNOS = 'Kybernos'

// Le VRAI levier du filet, corrigé le 23/09/2026 après lecture du script de
// patch : `patch-dsh-compaction-net.mjs` n'écrit pas le seuil, il ÉPINGLE le
// modèle de résumé. Mesuré dans `resolveConfig` : sans config,
// `summarizationProvider`/`summarizationModel` restent à `""` — l'engine tombe
// alors sur le modèle de session, dont la fenêtre peut ne pas tenir le prompt à
// résumer, et c'est là que le compactage meurt. Le seuil (0,8 par défaut, un
// autre levier) n'est PAS touché : on reproduit le patch, on ne l'étend pas.
export const PROVIDER_FILET = process.env.KB_FILET_PROVIDER || 'deepseek-official'
export const MODELE_FILET = process.env.KB_FILET_MODEL || 'deepseek-flash'

// Le seuil du compactage AUTOMATIQUE (demande du 01/10/2026) : 0,7 — le
// contexte se compacte dès qu'il dépasse 70 % de la fenêtre, au lieu du 0,8 du
// preset standard. Surcharge d'environnement : KB_SEUIL_COMPACTAGE (0 < x ≤ 1).
// La jauge visuelle du chat lit la MÊME valeur par la route /kybernos/compaction,
// pour ne jamais afficher un seuil différent de celui réellement posé.
export const SEUIL_COMPACTAGE = (() => {
  const brut = Number(process.env.KB_SEUIL_COMPACTAGE)
  return Number.isFinite(brut) && brut > 0 && brut <= 1 ? brut : 0.7
})()

const cloner = (valeur) =>
  typeof structuredClone === 'function' ? structuredClone(valeur) : JSON.parse(JSON.stringify(valeur))

/**
 * Toutes les rangées d'un preset qui montent le moteur de compactage.
 * On marche `plugins` et les `config` en LISTE (une rangée `group: true` porte
 * ses enfants dans `config`), sans supposer une profondeur.
 * @param {object} definition définition de preset
 * @returns {object[]} les rangées trouvées (références, pas des copies)
 */
export function rangerCompactage(definition) {
  const trouvees = []
  const visite = (rang) => {
    if (rang === null || typeof rang !== 'object') return
    if (Array.isArray(rang)) {
      for (const r of rang) visite(r)
      return
    }
    if (rang.name === PAQUET_COMPACTAGE) trouvees.push(rang)
    if (Array.isArray(rang.config)) for (const r of rang.config) visite(r)
    if (Array.isArray(rang.plugins)) for (const r of rang.plugins) visite(r)
  }
  visite(definition?.plugins)
  return trouvees
}

// ── Sous-agent Claude Code (migration du patch moteur, 04/10/2026) ───────────
// L'ancien `patch-dsh-subagent-claude-code.mjs` éditait `disabled: true → false`
// dans les `presets/*.patch.yml` du moteur : une montée de version l'effaçait.
// Ici la même bascule vit dans NOTRE preset cloné (ci-dessous, `retournerSubagent`)
// ET, au boot, dans toutes les définitions du registre vivant (`activerSubagentClaude`)
// — zéro écriture fichier, survit aux mises à jour de DSH.
export const ID_RANGEE_SUBAGENT_CLAUDE = 'tool-subagent-claude-code'

/**
 * Toutes les rangées d'un preset qui montent le sous-agent Claude Code.
 * Même marche que `rangerCompactage` (plugins + config en liste, profondeur libre).
 * @param {object} definition définition de preset
 * @returns {object[]} les rangées trouvées (références, pas des copies)
 */
export function rangerSubagentClaude(definition) {
  const trouvees = []
  const estClaudeCode = (rang) =>
    rang.id === ID_RANGEE_SUBAGENT_CLAUDE ||
    rang.config?.provider === 'claude-code' ||
    rang.config?.toolName === 'subagent_claude_code'
  const visite = (rang) => {
    if (rang === null || typeof rang !== 'object') return
    if (Array.isArray(rang)) {
      for (const r of rang) visite(r)
      return
    }
    if (estClaudeCode(rang) === true) trouvees.push(rang)
    if (Array.isArray(rang.config)) for (const r of rang.config) visite(r)
    if (Array.isArray(rang.plugins)) for (const r of rang.plugins) visite(r)
  }
  visite(definition?.plugins)
  return trouvees
}

/**
 * Bascule `disabled: false` sur les rangées Claude Code de TOUTES les définitions
 * du registre vivant (standard, cordis, kybernos-standard…). Ne jette jamais :
 * le boot n'en dépend pas. Retourne un bilan pour le journal.
 * @param {{agentPresets?: object}} ctx contexte cordis du plugin
 */
export async function activerSubagentClaude(ctx) {
  const service = ctx?.agentPresets
  const definitions = service?.definitions
  if (definitions === undefined || definitions === null || typeof definitions.keys !== 'function') {
    return { bascules: 0, raison: 'registre illisible (definitions)' }
  }
  let bascules = 0
  const touches = []
  let ids = []
  try { ids = Array.from(definitions.keys()) } catch { ids = [] }
  for (const id of ids) {
    let enregistrement = null
    try { enregistrement = definitions.get(id) } catch { continue }
    const rangées = rangerSubagentClaude(enregistrement?.config)
    for (const rangée of rangées) {
      if (rangée.disabled !== false) {
        rangée.disabled = false
        bascules += 1
        touches.push(id)
      }
    }
  }
  return { bascules, presets: [...new Set(touches)] }
}

/**
 * Clone une définition de preset en y posant le filet : le modèle de résumé est
 * épinglé. La source n'est jamais modifiée.
 * @param {object} source définition du preset source (telle que le registre la tient)
 * @param {{id?: string, provider?: string, modele?: string, seuil?: number, nom?: string}} [options]
 * @returns {{ok: true, definition: object, retouches: number, provider: string, modele: string, seuil?: number} | {ok: false, raison: string}}
 */
export function clonerPresetFilet(source, options = {}) {
  const { id = ID_PRESET_KYBERNOS, provider = PROVIDER_FILET, modele = MODELE_FILET, seuil, nom } = options
  if (source === null || typeof source !== 'object') {
    return { ok: false, raison: 'définition source absente' }
  }
  if (typeof provider !== 'string' || provider === '' || typeof modele !== 'string' || modele === '') {
    return { ok: false, raison: 'filet incomplet : provider et modèle sont requis' }
  }
  if (seuil !== undefined && (typeof seuil !== 'number' || Number.isFinite(seuil) === false || seuil <= 0 || seuil > 1)) {
    return { ok: false, raison: 'seuil hors de (0, 1] : ' + String(seuil) }
  }
  if (rangerCompactage(source).length === 0) {
    return { ok: false, raison: 'aucun ' + PAQUET_COMPACTAGE + ' dans la source — on ne pose pas un preset sans le filet' }
  }
  const definition = cloner(source)
  const copies = rangerCompactage(definition)
  for (const moteur of copies) {
    moteur.config = moteur.config ?? {}
    moteur.config[CHAMP_PROVIDER] = provider
    moteur.config[CHAMP_MODELE] = modele
    if (seuil !== undefined) moteur.config[CHAMP_SEUIL] = seuil
  }
  // Migration du patch moteur subagent-claude-code : le clone porte la rangée
  // activée — les sessions sur notre preset voient `subagent_claude_code`.
  for (const rangée of rangerSubagentClaude(definition)) rangée.disabled = false
  definition.id = id
  if (nom !== undefined) definition.name = nom
  else if (typeof source.name === 'string' && source.name !== '') definition.name = source.name + ' · Kybernos'
  if (typeof definition.order !== 'number') definition.order = 0
  return { ok: true, definition, retouches: copies.length, provider, modele, seuil }
}

/**
 * Enregistre le preset Kybernos auprès du registre vivant.
 * Ne jette pas : la pose d'un confort ne doit pas faire tomber le boot du plugin.
 * @param {{agentPresets?: object}} ctx contexte cordis du plugin
 * @param {{source?: string, id?: string, provider?: string, modele?: string, seuil?: number}} [options]
 */
export async function poserPresetKybernos(ctx, options = {}) {
  const { source = 'standard', id = ID_PRESET_KYBERNOS, provider = PROVIDER_FILET, modele = MODELE_FILET, seuil, nom = NOM_PRESET_KYBERNOS } = options
  const service = ctx?.agentPresets
  if (service === undefined || service === null) return { pose: false, raison: 'service agentPresets absent' }
  const definitions = service.definitions
  if (definitions === undefined || definitions === null || typeof definitions.get !== 'function') {
    return { pose: false, raison: 'registre illisible (definitions.get)' }
  }
  if (definitions.has(id)) return { pose: false, deja: true, raison: 'preset « ' + id + ' » déjà enregistré' }
  const enregistrement = definitions.get(source)
  if (enregistrement === undefined) return { pose: false, raison: 'preset source « ' + source + ' » introuvable' }
  const clonage = clonerPresetFilet(enregistrement.config, { id, provider, modele, seuil, nom })
  if (clonage.ok === false) return { pose: false, raison: clonage.raison }
  try {
    await service.register(clonage.definition)
  } catch (erreur) {
    return { pose: false, raison: 'agentPresets.register a refusé : ' + (erreur?.message ?? String(erreur)) }
  }
  return { pose: true, id, provider, modele, seuil, retouches: clonage.retouches }
}

export const NS_REGLAGES_PRESET = 'agent-preset-registry'

/**
 * Fait de notre preset celui des sessions à venir — sans écraser un choix
 * explicite de l'utilisateur. `selectedDefault` est un champ volatile écrit par
 * la GUI quand on choisit un preset dans la page de gestion ; `policy()` lit
 * `selectedDefault ?? config.default`. On écrit donc le même champ, par le
 * service `settings`, et seulement s'il est vide (ou déjà à nous).
 * @param {{agentPresets?: object, settings?: object}} ctx contexte cordis
 * @param {string} id preset à choisir par défaut
 */
export async function choisirPresetParDefaut(ctx, id) {
  if (typeof id !== 'string' || id === '') return { ecrit: false, raison: 'identifiant vide' }
  const service = ctx?.agentPresets
  const courant = (() => {
    try {
      const champ = service?.config?.selectedDefault
      return typeof champ?.get === 'function' ? champ.get() : champ
    } catch { return undefined }
  })()
  if (courant === id) return { ecrit: false, deja: true, raison: 'déjà notre preset' }
  if (typeof courant === 'string' && courant !== '') {
    return { ecrit: false, raison: 'choix explicite conservé (« ' + courant + ' »)' }
  }
  const settings = ctx?.settings
  if (settings === undefined || settings === null || typeof settings.update !== 'function') {
    return { ecrit: false, raison: 'service settings absent' }
  }
  try {
    await settings.update(NS_REGLAGES_PRESET, { selectedDefault: id })
  } catch (erreur) {
    return { ecrit: false, raison: 'settings.update a refusé : ' + (erreur?.message ?? String(erreur)) }
  }
  return { ecrit: true, id, ns: NS_REGLAGES_PRESET }
}
