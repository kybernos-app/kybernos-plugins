// ── Le plafond de retries : l'invariant qui dort, côté plugin ───────────────
//
// Mesuré le 29/09/2026 dans le moteur (dsh-llm/lib/index.js:247-257 et 316) :
//   · un fournisseur SANS retryPolicy explicite n'est pas un orphelin —
//     `resolveRetryPolicy(undefined)` lui applique un défaut sain (mode normal,
//     5 essais, backoff 0,5 s → 10 s, codes RATE_LIMIT/SERVER/TIMEOUT/
//     TRANSPORT/EMPTY_RESPONSE) ;
//   · pour un fournisseur nouveau, échouer vite (et notifier l'agent, qui
//     re-route) vaut mieux que patienter : on ne touche PAS aux politiques
//     absentes, et on ne force pas le plafond comme défaut.
//
// Ce module ne garantit qu'une seule chose, celle qui a fait mal : AUCUNE
// politique ne dépasse le plafond d'essais. Un `maxRetries: 500` avec un
// backoff plafonné à 30 s laissait un subagent « ne pas répondre » pendant
// des heures (quota quotidien épuisé) au lieu d'échouer en ~12 min. Au boot,
// toute politique `normal` au-dessus du plafond est ramenée au plafond via
// settings.update — écriture qui ne part QUE si une violation existe : tant
// que tout va bien, rien n'est écrit, et le fichier de patch (commentaires
// historiques compris) n'est jamais réécrit.
//
// Les modes `never`/`always` ne sont pas bornés : changer `mode` dépasserait
// le mandat d'un plafond, et la règle maison est déjà « jamais always »
// (il retente aussi AUTH et CONTEXT_WINDOW_EXCEEDED sans limite).

/** Namespace de configuration qui porte les fournisseurs (rangée `llm-pi-ai`). */
export const ID_NS_PROVIDERS = 'llm-pi-ai'

/**
 * Plafond d'essais, surchargeable sans relance de code.
 * @param {Record<string, unknown>|undefined} env
 * @returns {number} entier sûr ≥ 0 ; 10 par défaut (décision utilisateur du
 *   04/10/2026 après un 429 de plan : au-delà, on redirige la tâche vers un
 *   AUTRE fournisseur au lieu de réessayer le même — 30 tenait le fil vivant
 *   ~12 min pour rien).
 */
export function plafondDepuisEnv(env = process.env) {
  // Digits only: `Number('')` and `Number('  ')` are 0, which would cut every provider to zero retries
  // at boot when the variable is set but empty (`KB_RETRY_PLAFOND=`).
  const texte = String(env?.KB_RETRY_PLAFOND ?? '').trim()
  if (/^\d+$/.test(texte) === false) return 10
  const brut = Number(texte)
  return Number.isSafeInteger(brut) ? brut : 10
}

const cloner = (valeur) =>
  typeof structuredClone === 'function' ? structuredClone(valeur) : JSON.parse(JSON.stringify(valeur))

const errText = (e) => (e && e.message ? String(e.message) : String(e))

/**
 * Lit un namespace de configuration par les deux surfaces mesurées du service :
 * `get(ns)` quand il existe, sinon `describe()` — le service réellement monté
 * par le profil n'expose PAS `get` (cause du « service settings absent » du
 * 29/09 : la première version du garde testait `get`). Même repli que
 * `lireNamespace` de index.js.
 * @param {{get?: Function, describe?: Function}} settings
 * @param {string} ns
 * @returns {{valeur: unknown, erreur: string|null}}
 */
function lireNamespace(settings, ns) {
  if (typeof settings.get === 'function') {
    try { return { valeur: settings.get(ns), erreur: null } } catch (erreur) { return { valeur: undefined, erreur: 'settings.get(' + ns + ') : ' + errText(erreur) } }
  }
  if (typeof settings.describe === 'function') {
    try {
      const forms = settings.describe() || []
      const f = forms.find((x) => x !== null && x !== undefined && x.ns === ns)
      if (f === undefined) return { valeur: undefined, erreur: 'namespace ' + ns + ' absent des formulaires' }
      return { valeur: f.value, erreur: null }
    } catch (erreur) { return { valeur: undefined, erreur: 'settings.describe() : ' + errText(erreur) } }
  }
  return { valeur: undefined, erreur: 'service settings sans get() ni describe()' }
}

/**
 * Noms des fournisseurs dont la politique `normal` dépasse le plafond.
 * Politique absente = défaut moteur (sain, plus court que le plafond) : jamais
 * comptée comme violation. Lecture pure, ne mute rien.
 * @param {Record<string, {retryPolicy?: {mode?: unknown, maxRetries?: unknown}}>|undefined|null} providers
 * @param {number} plafond
 * @returns {string[]} noms en ordre de déclaration
 */
export function violationsPlafond(providers, plafond) {
  const noms = []
  if (providers === null || providers === undefined || typeof providers !== 'object') return noms
  for (const [nom, profil] of Object.entries(providers)) {
    const politique = profil !== null && typeof profil === 'object' ? profil.retryPolicy : undefined
    if (politique === null || typeof politique !== 'object') continue
    if (politique.mode !== 'normal') continue
    if (Number.isSafeInteger(politique.maxRetries) && politique.maxRetries > plafond) noms.push(nom)
  }
  return noms
}

/**
 * Copie des fournisseurs avec chaque violation ramenée au plafond.
 * La source n'est jamais mutée : l'objet vivant de settings doit rester tel
 * quel (le moteur mémoïse par identité, et une mutation en place serait
 * invisible pour lui comme pour nous).
 * @param {Record<string, unknown>|undefined|null} providers
 * @param {number} plafond
 * @returns {Record<string, unknown>}
 */
export function providersAuPlafond(providers, plafond) {
  const copie = cloner(providers ?? {})
  for (const nom of violationsPlafond(copie, plafond)) {
    const profil = copie[nom]
    if (profil !== null && typeof profil === 'object' && profil.retryPolicy !== null && typeof profil.retryPolicy === 'object') {
      profil.retryPolicy = { ...profil.retryPolicy, maxRetries: plafond }
    }
  }
  return copie
}

/**
 * Applique le plafond au boot. Ne jette jamais : un garde-fou de confort ne
 * doit pas faire tomber le boot du plugin. N'écrit que s'il y a au moins une
 * violation (l'écriture part par settings.update, que l'éditeur de config
 * persiste ensuite dans le patch de profil).
 * @param {{settings?: {get?: Function, update?: Function}}|undefined|null} ctx
 * @param {number} [plafond] défaut : plafondDepuisEnv()
 * @returns {Promise<{corriges: number, plafond: number, noms?: string[], surveillance?: number, raison?: string}>}
 */
export async function appliquerPlafondRetries(ctx, plafond = plafondDepuisEnv()) {
  const settings = ctx?.settings
  if (settings === undefined || settings === null) {
    return { corriges: 0, plafond, raison: 'service settings absent' }
  }
  if (typeof settings.update !== 'function') {
    return { corriges: 0, plafond, raison: 'settings.update indisponible' }
  }
  const lu = lireNamespace(settings, ID_NS_PROVIDERS)
  if (lu.erreur !== null) return { corriges: 0, plafond, raison: lu.erreur }
  const providers = lu.valeur !== null && typeof lu.valeur === 'object' ? lu.valeur.providers : undefined
  const noms = violationsPlafond(providers, plafond)
  if (noms.length === 0) {
    return { corriges: 0, plafond, surveillance: providers !== null && typeof providers === 'object' ? Object.keys(providers).length : 0 }
  }
  const corriges = providersAuPlafond(providers, plafond)
  try {
    await settings.update(ID_NS_PROVIDERS, { providers: corriges })
  } catch (erreur) {
    return { corriges: 0, plafond, noms, raison: 'settings.update a refusé : ' + errText(erreur) }
  }
  return { corriges: noms.length, plafond, noms }
}
