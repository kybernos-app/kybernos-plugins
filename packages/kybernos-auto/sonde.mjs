// One real, tiny call to a model, and what its outcome means: the probe `kybernos-auto` runs before it routes.
//
// The block between KB-PROBE-BEGIN and KB-PROBE-END is a verbatim copy of the one in
// packages/kybernos-sessions/brain-health.mjs (the Study-model health probe): the two bundles ship one by one and
// cannot import each other, so the text is duplicated and a test (test-resilience.mjs) fails if the copies differ.
// A fix to the probe is made in both places.

import { randomUUID } from 'node:crypto'

/** Per-model timeout: beyond it the model is "silent". */
export const DELAI_DEFAUT = 8000

// KB-PROBE-BEGIN — the SAME text lives in packages/kybernos-sessions/brain-health.mjs (bundles ship one by one and cannot
// import each other); packages/kybernos-auto/test-resilience.mjs fails if the two copies differ.
/** Échecs qui ne sont pas la faute du modèle (il répond, ou rien ne passe). */
const CODES_LIMITE = ['RATE_LIMIT', 'QUOTA', 'OVERLOADED']
const CODES_RESEAU = ['TRANSPORT', 'SERVER', 'NETWORK']

/** Un refus qui dit « ce n'est pas un modèle de langage » n'est pas une panne :
 *  la passerelle a raison. Relevé, jamais alerté — sinon Jev, qui est un modèle
 *  de décision, resterait éternellement listé comme une capacité cassée. */
const REFUS_HORS_JEU = /not a language model|evaluation model|modeltype\s*mismatch/i

/** Un échec d'appel, classé — jamais une exception : une sonde rend toujours un
 *  verdict, même sur un service qui n'existe pas. */
export function classerIssue ({ finish, erreur, tropTard, ms, cle, route, modele }) {
  const base = { cle, route, modele, ms }
  // Le délai prime : si on a coupé, c'est qu'il n'a rien dit à temps.
  if (tropTard === true) return { ...base, etat: 'muet', code: 'TIMEOUT', message: 'aucune réponse dans le délai' }
  if (finish !== null && finish !== undefined && typeof finish === 'object') {
    // Le chunk cru porte `reason` ; la forme assemblée porte `kind` directement.
    const raison = (finish.reason !== null && finish.reason !== undefined && typeof finish.reason === 'object') ? finish.reason : finish
    const kind = typeof raison.kind === 'string' ? raison.kind : 'stop'
    // `max-tokens` et `tool-calls` ne sont PAS des pannes : le modèle a répondu,
    // il a seulement été coupé par notre plafond d'un jeton.
    if (kind === 'stop' || kind === 'max-tokens' || kind === 'tool-calls') return { ...base, etat: 'ok', code: kind, message: '' }
    const failure = (raison.failure !== null && raison.failure !== undefined && typeof raison.failure === 'object') ? raison.failure : {}
    const code = typeof failure.code === 'string' ? failure.code : (kind === 'aborted' ? 'ABORTED' : 'UNKNOWN')
    const message = typeof failure.message === 'string' ? failure.message : kind
    return { ...base, ...classerCode(code, message) }
  }
  if (erreur !== null && erreur !== undefined) {
    const code = typeof erreur.code === 'string' ? erreur.code : 'UNKNOWN'
    const message = typeof erreur.message === 'string' ? erreur.message : String(erreur)
    return { ...base, ...classerCode(code, message) }
  }
  return { ...base, etat: 'muet', code: 'SANS-REPONSE', message: 'le flux s’est terminé sans verdict' }
}

/** Traduit un code d'échec en état. Exporté : c'est la règle qu'on teste. */
export function classerCode (code, message) {
  // Le plus spécifique d'abord : un refus « je ne suis pas un modèle de
  // langage » porte un code générique (INVALID_REQUEST) et serait rangé en
  // « erreur » — donc alerté à tort.
  if (REFUS_HORS_JEU.test(typeof message === 'string' ? message : '')) return { etat: 'hors-jeu', code, message }
  if (CODES_LIMITE.includes(code)) return { etat: 'limite', code, message }
  if (CODES_RESEAU.includes(code)) return { etat: 'reseau', code, message }
  if (code === 'ABORTED') return { etat: 'muet', code, message }
  return { etat: 'erreur', code, message }
}

/** « route/id » — `id` peut lui-même porter une barre (openrouter/anthropic/…). */
export const decouperCle = (cle) => {
  if (typeof cle !== 'string') return null
  const coupe = cle.indexOf('/')
  if (coupe <= 0 || coupe === cle.length - 1) return null
  return { route: cle.slice(0, coupe), modele: cle.slice(coupe + 1) }
}

/** Liste nettoyée : chaînes valides, dédoublonnées, ordre conservé. */
export const normaliserListe = (modeles) => {
  const vus = new Set()
  const out = []
  for (const m of (Array.isArray(modeles) ? modeles : [])) {
    if (typeof m !== 'string' || decouperCle(m) === null || vus.has(m)) continue
    vus.add(m)
    out.push(m)
  }
  return out
}

/** Exécute `faire` sur `items` avec au plus `limite` en vol. */
const enParallele = async (items, limite, faire) => {
  const out = new Array(items.length)
  let curseur = 0
  const ouvriers = Array.from({ length: Math.max(1, Math.min(limite, items.length)) }, async () => {
    for (;;) {
      const k = curseur
      curseur += 1
      if (k >= items.length) return
      out[k] = await faire(items[k], k)
    }
  })
  await Promise.all(ouvriers)
  return out
}

/** Un appel réel, minuscule, borné dans le temps. Rend toujours un verdict. */
export async function sonderUn (llm, cle, delaiMs, horloge) {
  const parts = decouperCle(cle)
  const debut = horloge()
  if (parts === null) {
    return { cle, route: '', modele: '', ms: 0, etat: 'erreur', code: 'INVALID_MODEL', message: 'identifiant « route/id » attendu' }
  }
  const coupe = new AbortController()
  let tropTard = false
  const minuteur = setTimeout(() => { tropTard = true; coupe.abort() }, delaiMs)
  let finish = null
  try {
    const messages = [{
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: 'ping' }],
      source: { kind: 'kybernos-brain-health' }
    }]
    const flux = llm.stream({
      provider: parts.route,
      model: parts.modele,
      messages,
      maxTokens: 1,
      purpose: 'kybernos-brain-health',
      signal: coupe.signal
    })
    for await (const chunk of flux) {
      if (chunk !== null && chunk !== undefined && typeof chunk === 'object' && chunk.type === 'finish') finish = chunk
    }
    return classerIssue({ finish, tropTard, ms: horloge() - debut, cle, route: parts.route, modele: parts.modele })
  } catch (e) {
    return classerIssue({ erreur: e, tropTard, ms: horloge() - debut, cle, route: parts.route, modele: parts.modele })
  } finally {
    clearTimeout(minuteur)
  }
}
// KB-PROBE-END
