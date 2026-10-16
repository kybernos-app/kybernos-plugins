// Model health probe — what the Study model watches.
//
// The rule (setting `brain` of Kybernos Settings): the Study model watches the configured models and, when one of them stops
// answering, a banner at the top of the chat names the culprit and invites to change it. The setting is the person's pick or,
// empty, Automatic (etude-auto.mjs picks the model); only `none` means nobody watches: no probe, no banner. The probe pings
// every configured model whichever one the Study model is, so the setting is the switch.
//
// The measure is a REAL call per model, tiny (a « ping », one output token). It is the only honest measure here: a catalogue
// that lists a model does not say it answers, and a missing key only shows when called.
//
// Five outcomes, and ONE ALONE deserves an alert:
//   · ok      — the model spoke (even cut at one token: it answered);
//   · muet    — nothing, or too late (timeout);
//   · erreur  — a plain refusal: missing key, unknown model, missing adapter;
//   · limite  — rate or quota: the model exists and answers, it is out of credit at this moment. Alerting would make the
//               banner blink for nothing — this is NOT an alert;
//   · reseau  — transport or server: the failure is not the model's. If ALL the models are there, it is the network (or the
//               service) to look at, not fifty-six models.
//
// And a sixth, added 2026-09-23:
//   · hors-jeu — the model REFUSED to be a language model. Measured on `vercel-ai-gateway/typesafe-ai/jev`: « Model
//               'typesafe-ai/jev' is an evaluation model, not a language model. » It answers typed verdicts on the gateway's
//               evaluation API and will never answer a chat ping — counting it as « does not answer » would make a permanent
//               false witness in the banner. It is therefore reported APART, and does not alert.

import { randomUUID } from 'node:crypto'

/** Délai par modèle : au-delà, il est « muet ». */
export const DELAI_DEFAUT = 8000
/** Modèles sondés en parallèle. Mesuré : au-delà, on se fait limiter soi-même. */
export const CONCURRENCE_DEFAUT = 4
/** Durée de validité d'un relevé — cinq heures. Un relevé réel coûte un appel
 *  par modèle : le garder long est ce qui rend la surveillance gratuite. Le host
 *  le règle par `KB_BRAIN_TTL`. */
export const TTL_DEFAUT = 18000000

// KB-PROBE-BEGIN — the SAME text lives in packages/kybernos-auto/sonde.mjs (bundles ship one by one and cannot
// import each other); packages/kybernos-auto/test-resilience.mjs fails if the two copies differ.
/** Failures that are not the model's fault (it answers, or nothing gets through). */
const CODES_LIMITE = ['RATE_LIMIT', 'QUOTA', 'OVERLOADED']
const CODES_RESEAU = ['TRANSPORT', 'SERVER', 'NETWORK']

/** A refusal that says « this is not a language model » is not an outage:
 *  the gateway is right. Noted, never alerted — otherwise Jev, which is a decision
 *  model, would stay listed forever as a broken capability. */
const REFUS_HORS_JEU = /not a language model|evaluation model|modeltype\s*mismatch/i

/** A failed call, classified — never an exception: a probe always returns a
 *  verdict, even on a service that does not exist. */
export function classerIssue ({ finish, erreur, tropTard, ms, cle, route, modele }) {
  const base = { cle, route, modele, ms }
  // The time limit comes first: if we cut it off, it said nothing in time.
  if (tropTard === true) return { ...base, etat: 'muet', code: 'TIMEOUT', message: 'no answer within the time limit' }
  if (finish !== null && finish !== undefined && typeof finish === 'object') {
    // The raw chunk carries `reason`; the assembled form carries `kind` directly.
    const raison = (finish.reason !== null && finish.reason !== undefined && typeof finish.reason === 'object') ? finish.reason : finish
    const kind = typeof raison.kind === 'string' ? raison.kind : 'stop'
    // `max-tokens` and `tool-calls` are NOT outages: the model answered,
    // it was only cut off by our one-token cap.
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
  return { ...base, etat: 'muet', code: 'SANS-REPONSE', message: 'the stream ended without a verdict' }
}

/** Turns a failure code into a state. Exported: it is the rule that is tested. */
export function classerCode (code, message) {
  // The most specific first: a refusal « I am not a language model »
  // carries a generic code (INVALID_REQUEST) and would be filed as an
  // « error » — hence alerted by mistake.
  if (REFUS_HORS_JEU.test(typeof message === 'string' ? message : '')) return { etat: 'hors-jeu', code, message }
  if (CODES_LIMITE.includes(code)) return { etat: 'limite', code, message }
  if (CODES_RESEAU.includes(code)) return { etat: 'reseau', code, message }
  if (code === 'ABORTED') return { etat: 'muet', code, message }
  return { etat: 'erreur', code, message }
}

/** « route/id » — the `id` can itself carry a slash (openrouter/anthropic/…). */
export const decouperCle = (cle) => {
  if (typeof cle !== 'string') return null
  const coupe = cle.indexOf('/')
  if (coupe <= 0 || coupe === cle.length - 1) return null
  return { route: cle.slice(0, coupe), modele: cle.slice(coupe + 1) }
}

/** A cleaned list: valid strings, de-duplicated, order kept. */
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

/** Runs `faire` on `items` with at most `limite` in flight. */
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

/** One real, tiny call, bounded in time. Always returns a verdict. */
export async function sonderUn (llm, cle, delaiMs, horloge) {
  const parts = decouperCle(cle)
  const debut = horloge()
  if (parts === null) {
    return { cle, route: '', modele: '', ms: 0, etat: 'erreur', code: 'INVALID_MODEL', message: 'a « route/id » identifier was expected' }
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

/** The probe: one reading at a time, cached for the TTL. */
export function creerSonde ({ llm, delaiMs = DELAI_DEFAUT, concurrence = CONCURRENCE_DEFAUT, ttlMs = TTL_DEFAUT, horloge = () => Date.now() } = {}) {
  let cache = null
  let enCours = null

  const dernier = () => (cache === null ? null : cache.resultat)

  const sonder = async (modeles, opts = {}) => {
    const brain = typeof opts.brain === 'string' ? opts.brain : ''
    // No Study model in force (None, or Automatic with nothing connected): nobody watches. We SAY so, we do not probe.
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
    // Two simultaneous calls do not probe twice: they share the run.
    if (enCours !== null && enCours.signature === signature) return enCours.promesse
    const promesse = (async () => {
      const debut = horloge()
      const resultats = await enParallele(liste, concurrence, (cle) => sonderUn(llm, cle, delaiMs, horloge))
      const sains = resultats.filter((r) => r.etat === 'ok')
      const alertes = resultats.filter((r) => r.etat === 'erreur' || r.etat === 'muet')
      const limites = resultats.filter((r) => r.etat === 'limite')
      const reseau = resultats.filter((r) => r.etat === 'reseau')
      // Evaluation models are noted, not judged: they cannot answer a chat ping, and their refusal says nothing about health.
      const horsJeu = resultats.filter((r) => r.etat === 'hors-jeu')
      // No model answers: not fifty-six culprits but a general failure — the banner must not accuse the models. And a reading
      // that holds ONLY out-of-game models is no failure: it is a list with nobody to ask.
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
