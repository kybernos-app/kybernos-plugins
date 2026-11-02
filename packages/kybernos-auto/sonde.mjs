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
