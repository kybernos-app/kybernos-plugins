// Cerveau de décision (Jev) — ce que fait le CLASSEMENT, jamais la rédaction.
//
// Mesuré le 23/09/2026 : Jev (`vercel-ai-gateway/typesafe-ai/jev`) n'est PAS un
// modèle de langage. Un appel de chat — la forme que la sonde de santé emploie
// pour tout le monde — rend un 400 de la passerelle :
//   « Model 'typesafe-ai/jev' is an evaluation model, not a language model.
//     Use the evaluation generation API instead. »
// Son API est /v1/evaluate : on lui donne un `state` (le texte à juger) et des
// `questions` typées — `choice`, `boolean`, `score` — il rend des verdicts typés
// avec des probabilités calibrées. Pas de prose : c'est exactement ce qu'il faut
// pour CHOISIR, et surtout pas pour expliquer.
//
// Ce que ce module ajoute par-dessus l'API, c'est la RÈGLE. Une probabilité
// calibrée reste une déclaration du modèle, pas une preuve : elle est donc
// appliquée avec un seuil explicite, et sous le seuil la réponse est `aucun` —
// jamais « le plus probable ». Même philosophie que brain-health.mjs : un
// verdict toujours, une exception jamais, et tout est injectable (fetch, clé,
// horloge) pour se tester sans réseau, sans clé, sans jeton.
//
// Deux appelants, deux catalogues fermés, la MÊME règle de seuil :
//   · `selectionnerKyber`  — quel kyber traite cette demande (critères = les
//     `mission:` des kybers, plus un `aucun` explicite) ;
//   · `selectionnerCategorie` — quelle catégorie de session, donc quelle icône
//     devant la ligne (critères = CATEGORIES, dont le sens est écrit ici).
// Un troisième usage n'aurait besoin que d'un `criteria` : voir classerChoix.

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** La seule adresse qui répond à Jev (l'API de chat le refuse). */
export const URL_DECISION = 'https://ai-gateway.vercel.sh/v1/evaluate'
/** Le modèle de décision. Un nom de chat ici rendrait un 400 explicite. */
export const MODELE_DEFAUT = 'typesafe-ai/jev'
/** Les modèles connus pour répondre sur `/v1/evaluate`. Mesuré le 23/09/2026 sur
 *  le catalogue de la passerelle (`GET /v1/models`, 386 modèles) : `typesafe-ai`
 *  n'en publie qu'un. La liste est annoncée à la page Paramètres telle quelle —
 *  écrite ici, et nulle part ailleurs. */
export const MODELES_DECISION_CONNUS = [MODELE_DEFAUT]
/** La valeur qui ÉTEINT le cerveau : les appelants gardent alors leur propre
 *  règle, au lieu de recevoir un classement qu'ils n'ont pas demandé. */
export const MODELE_ETEINT = 'none'
/** The DSH home, resolved the way DSH does (@deepseek-ai/dsh-home-paths): a non-blank
 *  $DSH_HOME (trimmed, a leading ~ expanded), else <os home>/.dsh. Resolved at each use,
 *  never cached: with DSH_HOME set, no default path below may point into the real ~/.dsh. */
export const dshHome = (env = process.env, osHome = homedir) => {
  const raw = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  if (raw === '') return join(osHome(), '.dsh')
  if (raw === '~') return osHome()
  return resolve(raw.startsWith('~/') || raw.startsWith('~\\') ? join(osHome(), raw.slice(2)) : raw)
}
/** Le fichier de réglages de Kybernos — celui que la page Paramètres écrit et
 *  que ce module relit pour savoir QUEL modèle de décision sert. */
const fichierReglagesDefaut = () => join(dshHome(), 'kybernos', 'settings.json')
/** The harness's references file: it holds the gateway key. */
const fichierCredentialsDefaut = () => join(dshHome(), '.credentials.yaml')
/** Sous ce seuil, la réponse est `aucun` : une décision probabiliste ne se
 *  prend pas sur « le plus probable » quand il est à peine devant. */
export const SEUIL_DEFAUT = 0.6
/** Délai d'un appel : Jev répond en ~400 ms mesurés ; au-delà, on coupe. */
export const DELAI_DEFAUT = 10000
/** Longueur maximale d'une mission envoyée en critère (Jev : 32K de contexte). */
export const MISSION_MAX = 400

/** Les huit catégories de session — et le SEUL endroit où leur sens est écrit.
 *  `CATEGORIES_CONNUES` (index.js) dérive de cette table, et le client peint
 *  l'icône du slug : ajouter une ligne ici la propose à Jev et l'accepte sur la
 *  route des catégories. L'ordre est celui du registre historique — ne pas le
 *  changer sans changer `check-all` (il est testé tel quel).
 *  `quand` est le critère envoyé à Jev : il décrit le TRAVAIL, pas le vocabulaire
 *  (une demande peut dire « bug » en demandant une fonctionnalité). */
export const CATEGORIES = [
  { slug: 'fonctionnalite', quand: 'la demande construit ou étend une capacité : nouveau comportement, nouvelle route, nouveau réglage, refonte d’un flux existant' },
  { slug: 'correctif', quand: 'la demande répare quelque chose qui ne marche pas ou pas comme annoncé : bug, régression, faux positif, plantage, échec de test' },
  { slug: 'ui', quand: 'la demande porte sur l’apparence ou l’ergonomie : mise en page, thème, icônes, libellés visibles, captures d’écran, maquette' },
  { slug: 'doc', quand: 'la demande écrit ou met à jour de la documentation : mode d’emploi, rapport, skill, guide, note de passation' },
  { slug: 'integration', quand: 'la demande branche un service extérieur : connecteur MCP, API tierce, fournisseur de modèle, clé, authentification' },
  { slug: 'donnees', quand: 'la demande porte sur des données ou des mesures : schéma, migration, catalogue, tarifs, relevés, statistiques' },
  { slug: 'nettoyage', quand: 'la demande range sans changer le comportement : suppression, renommage, déplacement, déduplication, ménage de fichiers morts' },
  { slug: 'question', quand: 'le chat n’est pas un chantier : il demande un avis, une explication ou une comparaison, et rien ne doit être écrit' }
]

/** La variable d'environnement, puis le fichier de références du harnais.
 *  Rend `null` — jamais une exception : une clé absente est un état, pas un bug. */
export function lireCle ({ env = process.env, fichier } = {}) {
  const direct = env === undefined || env === null ? undefined : env.VERCEL_AI_GATEWAY_API_KEY
  if (typeof direct === 'string' && direct.trim() !== '') return direct.trim()
  const chemin = typeof fichier === 'string' && fichier !== '' ? fichier : fichierCredentialsDefaut()
  let texte = null
  try { texte = readFileSync(chemin, 'utf8') } catch (e) { return null }
  const m = /^[ \t]+VERCEL_AI_GATEWAY_API_KEY[ \t]*:[ \t]*(.+?)[ \t]*$/m.exec(texte)
  if (m === null) return null
  const valeur = m[1].replace(/^["']|["']$/g, '').trim()
  return valeur === '' ? null : valeur
}

/** Le modèle de décision tel que la page Paramètres l'a enregistré dans
 *  `<DSH home>/kybernos/settings.json` (clé `decisionBrain`). Rend TOUJOURS
 *  `{eteint, modele}` : fichier absent, illisible ou tordu → le défaut. Un
 *  réglage ne doit jamais faire échouer un classement.
 *  Vide = défaut · `none` = éteint · sinon l'identifiant écrit là. */
export function lireModeleDecision ({ fichier, defaut = MODELE_DEFAUT } = {}) {
  const modeleDefaut = typeof defaut === 'string' && defaut !== '' ? defaut : MODELE_DEFAUT
  const chemin = typeof fichier === 'string' && fichier !== '' ? fichier : fichierReglagesDefaut()
  let brut = null
  try { brut = JSON.parse(readFileSync(chemin, 'utf8')) } catch (e) { return { eteint: false, modele: modeleDefaut } }
  const j = (brut !== null && typeof brut === 'object') ? brut : null
  const v = (j !== null && typeof j.decisionBrain === 'string') ? j.decisionBrain.trim() : ''
  if (v === '') return { eteint: false, modele: modeleDefaut }
  if (v === MODELE_ETEINT) return { eteint: true, modele: modeleDefaut }
  return { eteint: false, modele: v }
}
/** Liste de kybers nettoyée : `{id, mission}` valides, dédoublonnés, ordre
 *  conservé. `aucun` est réservé — c'est la réponse « personne ne couvre ». */
export const normaliserKybers = (kybers) => {
  const vus = new Set()
  const out = []
  for (const k of (Array.isArray(kybers) ? kybers : [])) {
    if (k === null || typeof k !== 'object') continue
    const id = typeof k.id === 'string' ? k.id.trim() : ''
    if (id === '' || id === 'aucun' || vus.has(id)) continue
    const mission = typeof k.mission === 'string' ? k.mission.trim() : ''
    vus.add(id)
    out.push({ id, mission: mission === '' ? '(mission non déclarée)' : mission.slice(0, MISSION_MAX) })
  }
  return out
}

/** La question `choice` posée à Jev pour départager des kybers. Rend `null`
 *  quand la liste est vide : il n'y a rien à classer. */
export const construireQuestion = (kybers, opts = {}) => {
  const liste = normaliserKybers(kybers)
  if (liste.length === 0) return null
  const criteria = {}
  for (const k of liste) criteria[k.id] = k.mission
  criteria.aucun = typeof opts.aucun === 'string' && opts.aucun !== ''
    ? opts.aucun
    : 'aucun kyber de la liste ne couvre cette demande'
  return {
    type: 'choice',
    instructions: 'Pick the kyber whose mission matches the request. Judge the mission, not the words: a request may borrow one kyber\'s vocabulary while asking for another\'s work. Answer "aucun" when no listed mission covers the request.',
    criteria
  }
}

/** La question `choice` posée à Jev pour choisir la CATÉGORIE d'un chat — donc
 *  l'icône peinte devant sa ligne. Pas de « aucun » ici : un chat a toujours une
 *  catégorie, et `question` joue ce rôle (le chat ne demande rien à écrire). */
export const construireQuestionCategorie = (opts = {}) => {
  const table = Array.isArray(opts.categories) ? opts.categories : CATEGORIES
  const criteria = {}
  for (const c of table) {
    if (c === null || typeof c !== 'object') continue
    const slug = typeof c.slug === 'string' ? c.slug.trim() : ''
    if (slug === '' || criteria[slug] !== undefined) continue
    criteria[slug] = typeof c.quand === 'string' && c.quand !== '' ? c.quand : slug
  }
  if (Object.keys(criteria).length === 0) return null
  return {
    type: 'choice',
    instructions: 'Pick the category that describes what this chat actually does. Judge the work, not the words: a chat may say "bug" while asking for new behaviour, or look like a feature while it only asks a question. Answer "question" when nothing is to be written.',
    criteria
  }
}

/** Applique le seuil au verdict, quel que soit le catalogue. Exporté : c'est la
 *  règle qu'on teste, et elle est la même pour les kybers et les catégories.
 *  `opts.connus` (la liste proposée) ferme un trou réel : un modèle peut
 *  INVENTER un libellé plausible — `hors-catalogue` le refuse au lieu de
 *  sélectionner un kyber qui n'existe pas. */
export function classerChoix (reponse, opts = {}) {
  const seuil = typeof opts.seuil === 'number' && opts.seuil > 0 && opts.seuil <= 1 ? opts.seuil : SEUIL_DEFAUT
  const cle = typeof opts.cle === 'string' && opts.cle !== '' ? opts.cle : 'kyber'
  const connus = Array.isArray(opts.connus) && opts.connus.length > 0 ? opts.connus : null
  const answers = (reponse !== null && reponse !== undefined && typeof reponse === 'object' &&
    reponse.answers !== null && reponse.answers !== undefined && typeof reponse.answers === 'object')
    ? reponse.answers
    : {}
  const a = answers[cle]
  const base = { choix: null, confiance: 0, motif: 'reponse-illisible', seuil, probabilites: {} }
  if (a === null || a === undefined || typeof a !== 'object' || a.type !== 'choice') return base
  const probabilites = (a.probabilities !== null && a.probabilities !== undefined && typeof a.probabilities === 'object') ? a.probabilities : {}
  const confiance = typeof a.confidence === 'number' ? a.confidence : 0
  const choix = typeof a.choice === 'string' ? a.choice : ''
  if (choix === '') return { ...base, confiance, probabilites }
  const p = typeof probabilites[choix] === 'number' ? probabilites[choix] : confiance
  if (choix === 'aucun') return { choix: null, confiance: p, motif: 'aucun', seuil, probabilites }
  if (connus !== null && connus.includes(choix) === false) return { choix: null, confiance: p, motif: 'hors-catalogue', seuil, probabilites }
  if (p < seuil) return { choix: null, confiance: p, motif: 'sous-le-seuil', seuil, probabilites }
  return { choix, confiance: p, motif: 'choisi', seuil, probabilites }
}

/** Le classement d'un kyber — la forme historique, conservée telle quelle. */
export function classerKyber (reponse, opts = {}) {
  const r = classerChoix(reponse, opts)
  return { kyber: r.choix, confiance: r.confiance, motif: r.motif, seuil: r.seuil, probabilites: r.probabilites }
}

/** Le classement d'une catégorie de session. `sous-le-seuil` ne rend PAS la
 *  main sur un candidat : l'appelant garde son propre choix. La réponse est lue
 *  sous la clé `categorie` — celle de la question posée, pas celle des kybers. */
export function classerCategorie (reponse, opts = {}) {
  const r = classerChoix(reponse, { cle: 'categorie', ...opts })
  return { categorie: r.choix, confiance: r.confiance, motif: r.motif, seuil: r.seuil, probabilites: r.probabilites }
}

/** Le message d'erreur d'une passerelle, extrait d'un corps JSON si on peut. *  Borné : le message de Vercel porte toute la trace de routage. */
const extraireMessage = (texte) => {
  const brut = typeof texte === 'string' ? texte : ''
  try {
    const j = JSON.parse(brut)
    const m = j !== null && typeof j === 'object' && j.error !== null && typeof j.error === 'object' ? j.error.message : null
    if (typeof m === 'string' && m !== '') return m.slice(0, 300)
  } catch (e) { /* pas du JSON : on rend le texte brut, borné */ }
  return brut.slice(0, 300)
}

/** Un appel à Jev. Rend TOUJOURS un verdict : `{ok:true, answers, usage, ms}`
 *  ou `{ok:false, code, erreur, ms}` — jamais une exception. */
export async function decider (questions, state, opts = {}) {
  const fetchImpl = opts.fetchImpl === undefined || opts.fetchImpl === null ? globalThis.fetch : opts.fetchImpl
  const url = typeof opts.url === 'string' && opts.url !== '' ? opts.url : URL_DECISION
  const modele = typeof opts.modele === 'string' && opts.modele !== '' ? opts.modele : MODELE_DEFAUT
  const delaiMs = typeof opts.delaiMs === 'number' && opts.delaiMs > 0 ? opts.delaiMs : DELAI_DEFAUT
  const horloge = typeof opts.horloge === 'function' ? opts.horloge : () => Date.now()
  const debut = horloge()
  // Éteint dans les réglages : rien n'est demandé à personne, et l'appelant
  // garde sa propre règle. C'est un ÉTAT, pas une panne — d'où le code distinct.
  if (modele === MODELE_ETEINT) {
    return { ok: false, code: 'CERVEAU-ETEINT', erreur: 'le cerveau de décision est éteint dans les réglages Kybernos', ms: 0 }
  }
  if (questions === null || questions === undefined || typeof questions !== 'object' ||
    Array.isArray(questions) || Object.keys(questions).length === 0) {
    return { ok: false, code: 'SANS-QUESTION', erreur: 'au moins une question typée est attendue', ms: 0 }
  }
  if (typeof fetchImpl !== 'function') {
    return { ok: false, code: 'SANS-RESEAU', erreur: 'fetch indisponible dans ce contexte', ms: 0 }
  }
  const secret = typeof opts.cle === 'string' && opts.cle !== '' ? opts.cle : lireCle({ fichier: opts.fichierCredentials })
  if (secret === null) {
    return { ok: false, code: 'CLE-ABSENTE', erreur: 'VERCEL_AI_GATEWAY_API_KEY introuvable (environnement et références)', ms: 0 }
  }
  const coupe = new AbortController()
  const minuteur = setTimeout(() => coupe.abort(), delaiMs)
  try {
    const reponse = await fetchImpl(url, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + secret, 'content-type': 'application/json' },
      body: JSON.stringify({ model: modele, state: state === undefined ? '' : state, questions }),
      signal: coupe.signal
    })
    const texte = await reponse.text()
    if (reponse.ok !== true) {
      return { ok: false, code: 'HTTP-' + String(reponse.status), erreur: extraireMessage(texte), ms: horloge() - debut }
    }
    let corps = null
    try { corps = JSON.parse(texte) } catch (e) { corps = null }
    if (corps === null || typeof corps !== 'object') {
      return { ok: false, code: 'REPONSE-ILLISIBLE', erreur: 'le corps de la réponse n’est pas du JSON', ms: horloge() - debut }
    }
    return {
      ok: true,
      modele: typeof corps.model === 'string' ? corps.model : modele,
      answers: (corps.answers !== null && typeof corps.answers === 'object') ? corps.answers : {},
      usage: (corps.usage !== null && typeof corps.usage === 'object') ? corps.usage : null,
      ms: horloge() - debut
    }
  } catch (e) {
    const coupe2 = coupe.signal.aborted === true
    return {
      ok: false,
      code: coupe2 ? 'DELAI' : 'RESEAU',
      erreur: coupe2 ? 'aucune réponse dans le délai' : String(e !== null && e !== undefined && e.message ? e.message : e).slice(0, 300),
      ms: horloge() - debut
    }
  } finally {
    clearTimeout(minuteur)
  }
}

/** Le premier appelant de la route : « quel kyber traite cette demande ? ».
 *  Sous le seuil, rien n'est choisi — l'appelant garde alors sa propre règle. */
export async function selectionnerKyber (kybers, demande, opts = {}) {
  const seuil = typeof opts.seuil === 'number' && opts.seuil > 0 && opts.seuil <= 1 ? opts.seuil : SEUIL_DEFAUT
  const question = construireQuestion(kybers, opts)
  if (question === null) {
    return { ok: false, code: 'SANS-KYBER', erreur: 'aucun kyber à départager', ms: 0, seuil }
  }
  const texte = demande === undefined || demande === null ? '' : String(demande)
  if (texte.trim() === '') {
    return { ok: false, code: 'SANS-DEMANDE', erreur: 'la demande à classer est vide', ms: 0, seuil }
  }
  const verdict = await decider({ kyber: question }, texte, opts)
  if (verdict.ok !== true) return { ...verdict, seuil }
  // `classerKyber` lit la réponse ENTIÈRE (`reponse.answers[cle]`) : on lui
  // passe le verdict, pas le seul dictionnaire de réponses. Les identifiants
  // réellement proposés ferment la porte à un libellé inventé.
  const connus = Object.keys(question.criteria).filter((k) => k !== 'aucun')
  return { ok: true, ...classerKyber(verdict, { seuil, connus }), modele: verdict.modele, usage: verdict.usage, ms: verdict.ms }
}

/** Le second appelant : « quelle catégorie pour ce chat ? » — donc quelle icône
 *  devant sa ligne. Sous le seuil, rien n'est choisi : le nommeur garde son
 *  propre choix (une icône approximative ne doit pas être présentée comme un
 *  verdict du modèle). */
export async function selectionnerCategorie (texte, opts = {}) {
  const seuil = typeof opts.seuil === 'number' && opts.seuil > 0 && opts.seuil <= 1 ? opts.seuil : SEUIL_DEFAUT
  const question = construireQuestionCategorie(opts)
  if (question === null) {
    return { ok: false, code: 'SANS-CATEGORIE', erreur: 'aucune catégorie à proposer', ms: 0, seuil }
  }
  const demande = texte === undefined || texte === null ? '' : String(texte)
  if (demande.trim() === '') {
    return { ok: false, code: 'SANS-TEXTE', erreur: 'le texte du chat à classer est vide', ms: 0, seuil }
  }
  const verdict = await decider({ categorie: question }, demande, opts)
  if (verdict.ok !== true) return { ...verdict, seuil }
  const connus = Object.keys(question.criteria)
  return { ok: true, ...classerCategorie(verdict, { seuil, connus }), modele: verdict.modele, usage: verdict.usage, ms: verdict.ms }
}
