// Sonde de santé des modèles — ce que fait le « modèle d'étude » (brain).
//
// La règle (réglage `brain` de Kybernos Settings) : le modèle d'étude surveille
// les modèles configurés et, quand l'un d'eux ne répond plus, un bandeau en haut
// du chat nomme le fautif et invite à le changer. Réglage vide = personne ne
// surveille : aucune sonde, aucun bandeau.
//
// La mesure est un appel RÉEL par modèle, minuscule (un « ping », un jeton de
// sortie). C'est la seule mesure honnête ici : un catalogue qui liste un modèle
// ne dit pas qu'il répond, et une clé absente ne se voit qu'en appelant.
//
// Cinq issues, et UNE SEULE mérite une alerte :
//   · ok      — le modèle a parlé (même tronqué à un jeton : il a répondu) ;
//   · muet    — rien, ou trop tard (délai dépassé) ;
//   · erreur  — refus net : clé absente, modèle inconnu, adaptateur manquant ;
//   · limite  — débit ou quota : le modèle existe et répond, il est à court de
//               crédit à cet instant. Alerter ferait clignoter le bandeau pour
//               rien — ce n'est PAS une alerte ;
//   · reseau  — transport ou serveur : la panne n'est pas celle du modèle.
//               Si TOUS les modèles en sont là, c'est le réseau (ou le service)
//               qu'il faut regarder, pas cinquante-six modèles.
//
// Et une sixième, ajoutée le 23/09/2026 :
//   · hors-jeu — le modèle a REFUSÉ d'être un modèle de langage. Mesuré sur
//               `vercel-ai-gateway/typesafe-ai/jev` : « Model 'typesafe-ai/jev'
//               is an evaluation model, not a language model. » C'est un modèle
//               de DÉCISION (verdicts typés sur /v1/evaluate), il ne répondra
//               jamais à un ping de chat — le compter comme « ne répond pas »
//               ferait un faux témoin permanent dans le bandeau. Il est donc
//               relevé À PART, et n'alerte pas.

import { randomUUID } from 'node:crypto'

/** Délai par modèle : au-delà, il est « muet ». */
export const DELAI_DEFAUT = 8000
/** Modèles sondés en parallèle. Mesuré : au-delà, on se fait limiter soi-même. */
export const CONCURRENCE_DEFAUT = 4
/** Durée de validité d'un relevé — cinq heures. Un relevé réel coûte un appel
 *  par modèle : le garder long est ce qui rend la surveillance gratuite. Le host
 *  le règle par `KB_BRAIN_TTL`. */
export const TTL_DEFAUT = 18000000

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

/** La sonde : un relevé à la fois, mis en cache le temps du TTL. */
export function creerSonde ({ llm, delaiMs = DELAI_DEFAUT, concurrence = CONCURRENCE_DEFAUT, ttlMs = TTL_DEFAUT, horloge = () => Date.now() } = {}) {
  let cache = null
  let enCours = null

  const dernier = () => (cache === null ? null : cache.resultat)

  const sonder = async (modeles, opts = {}) => {
    const brain = typeof opts.brain === 'string' ? opts.brain : ''
    // Réglage vide : personne ne surveille. On le DIT, on ne sonde pas.
    if (brain === '') return { ok: true, actif: false, raison: 'aucun-modele-detude', brain: '' }
    if (llm === null || llm === undefined || typeof llm.stream !== 'function') {
      return { ok: false, actif: true, brain, erreur: 'service llm indisponible' }
    }
    const liste = normaliserListe(modeles)
    const signature = liste.join(',')
    const force = opts.force === true
    if (!force && cache !== null && cache.signature === signature && (horloge() - cache.quand) < ttlMs) {
      return { ...cache.resultat, cache: true }
    }
    // Deux appels simultanés ne sondent pas deux fois : ils partagent la course.
    if (enCours !== null && enCours.signature === signature) return enCours.promesse
    const promesse = (async () => {
      const debut = horloge()
      const resultats = await enParallele(liste, concurrence, (cle) => sonderUn(llm, cle, delaiMs, horloge))
      const sains = resultats.filter((r) => r.etat === 'ok')
      const alertes = resultats.filter((r) => r.etat === 'erreur' || r.etat === 'muet')
      const limites = resultats.filter((r) => r.etat === 'limite')
      const reseau = resultats.filter((r) => r.etat === 'reseau')
      // Les modèles de décision sont relevés, pas jugés : ils ne peuvent pas
      // répondre à un ping de chat, et leur refus ne dit rien sur la santé.
      const horsJeu = resultats.filter((r) => r.etat === 'hors-jeu')
      // Aucun modèle ne répond : ce n'est pas cinquante-six coupables, c'est une
      // panne d'ensemble — le bandeau ne doit pas accuser les modèles. Et un
      // relevé qui ne contient QUE des modèles hors-jeu n'est pas une panne :
      // c'est une liste où il n'y a personne à interroger.
      const juges = resultats.filter((r) => r.etat !== 'hors-jeu')
      const tousEnEchec = juges.length > 0 && sains.length === 0
      const resultat = {
        ok: true,
        actif: true,
        brain,
        verifieA: new Date(horloge()).toISOString(),
        dureeMs: horloge() - debut,
        total: resultats.length,
        sains: sains.length,
        alertes,
        limites: limites.map((r) => ({ cle: r.cle, code: r.code, message: r.message })),
        reseau: reseau.map((r) => ({ cle: r.cle, code: r.code, message: r.message })),
        horsJeu: horsJeu.map((r) => ({ cle: r.cle, code: r.code, message: r.message })),
        tousEnEchec,
        modeles: resultats
      }
      cache = { signature, resultat, quand: horloge() }
      return resultat
    })()
    enCours = { signature, promesse }
    try {
      return await promesse
    } finally {
      if (enCours !== null && enCours.promesse === promesse) enCours = null
    }
  }

  return { sonder, dernier }
}
