// Auto routing, made resilient: probe before routing, a circuit breaker per model, a bounded fallback chain.
//
// What the router used to do: pick the first whitelist model of the class that a lifetime error ratio had not marked
// "down". Nobody asked whether the model answers NOW, a model that once failed was judged forever, and the caller got a
// single choice with nothing to fall back on.
//
// What it does now:
//   · probe first — a candidate is asked a real, tiny question (the same probe as the Study-model health check) unless a
//     verdict younger than a minute says so already; the caller is only sent to a model that answered;
//   · a circuit breaker per model — a failure that retrying cannot fix (key refused, model gone) opens it at once, a
//     flaky one after three in a row; it stays open for a pause that grows (1 min → 10 min), then ONE trial decides
//     (half-open): a success closes it, a failure opens it again for longer. Nothing is judged forever;
//   · a fallback chain — the answer lists, in order, the models to try next, never more than the retry cap (10, the same
//     number the plugin enforces on the engine's own retries, KB_RETRY_PLAFOND);
//   · every outcome keeps its reason (code, message, when) so the page can say WHY a model is skipped.
//
// Nothing here talks to the network: the probe is injected, which is also what makes it testable.
import { classerCode } from './sonde.mjs'

/** The most models a caller is ever pointed at for one delegation: the plugin's retry cap (`KB_RETRY_PLAFOND`, 10). */
export const plafondEssais = (env = process.env) => {
  const brut = Number(env === null || env === undefined ? undefined : env.KB_RETRY_PLAFOND)
  return Number.isSafeInteger(brut) && brut >= 1 ? brut : 10
}
/** A healthy verdict is trusted for a minute (the "cached probe" of the design). */
export const TTL_SONDE_MS = 60000
/** A failed one for ten seconds: long enough not to hammer a dead model, short enough not to hide its recovery. */
export const TTL_SONDE_KO_MS = 10000
/** Consecutive failures that open the breaker for a model whose failure may be a flake. */
export const SEUIL_OUVERTURE = 3
export const PAUSE_MIN_MS = 60000
export const PAUSE_MAX_MS = 600000
/** A rate limit or a quota: the model exists and answers, it is short of credit for a moment. */
export const PAUSE_LIMITE_MS = 60000
/** A model that refused to be a language model (an evaluation model, say) is not retried for an hour. */
export const PAUSE_HORS_JEU_MS = 3600000
/** How long a routing call may spend probing before it hands over what it has (the rest is returned unprobed). */
export const DELAI_SONDES_MS = 12000
/** Models probed at the same time. */
export const GROUPE_SONDES = 3
const RECENTES = 5
const MESSAGE_MAX = 200

/** Failures that asking again will not fix: a refused key, a model that is gone, a request the provider rejects. */
const CODES_DURS = ['AUTH', 'UNKNOWN_MODEL', 'INVALID_MODEL', 'INVALID_REQUEST', 'PI_AI_ERROR', 'CONTEXT_WINDOW_EXCEEDED']

/** The same causes, in the same words, as the model-health chip of the Models tab (kybernos-sessions publishes them). */
export const CAUSES = { UNKNOWN_MODEL: 'gone', INVALID_MODEL: 'gone', INVALID_REQUEST: 'refused', PI_AI_ERROR: 'refused', AUTH: 'key', CONTEXT_WINDOW_EXCEEDED: 'text', TIMEOUT: 'silent', 'SANS-REPONSE': 'silent', ABORTED: 'silent' }
export const causeDe = (code) => (Object.prototype.hasOwnProperty.call(CAUSES, code) ? CAUSES[code] : 'other')

/** The record of a model that has never been seen. Pure. */
export const vierge = () => ({ calls: 0, errors: 0, probes: 0, lastLatencyMs: null, cacheInput: 0, cacheRead: 0, consecutive: 0, openUntil: 0, openReason: null, lastError: null, recent: [], lastOkAt: null, lastProbe: null, updatedAt: null })

/** closed = route to it; open = skip it until `openUntil`; half-open = the pause ended, one trial decides. Pure. */
export function etatDisjoncteur (rec, maintenant) {
  if (rec === null || rec === undefined || typeof rec !== 'object') return 'closed'
  const jusqua = Number(rec.openUntil)
  if (!(jusqua > 0)) return 'closed'
  return jusqua > maintenant ? 'open' : 'half-open'
}

/** What an outcome from a delegation's report means, in the probe's vocabulary. Pure. */
export function issueDeRapport ({ erreur, code, message } = {}) {
  if (erreur !== true) return { etat: 'ok', code: 'stop', message: '' }
  return classerCode(typeof code === 'string' && code !== '' ? code : 'UNKNOWN', typeof message === 'string' ? message : '')
}

const noterErreur = (rec, issue, maintenant) => {
  const note = { at: maintenant, code: String(issue.code || 'UNKNOWN'), message: String(issue.message || '').slice(0, MESSAGE_MAX) }
  rec.lastError = note
  rec.recent = [note].concat(Array.isArray(rec.recent) ? rec.recent : []).slice(0, RECENTES)
}

/** The record after one outcome (a probe or a report). Pure: the input is not changed. */
export function apresIssue (rec, issue, maintenant) {
  const r = { ...vierge(), ...(rec !== null && typeof rec === 'object' ? rec : {}) }
  r.updatedAt = maintenant
  const etat = issue !== null && typeof issue === 'object' ? issue.etat : 'erreur'
  if (etat === 'ok') {
    r.consecutive = 0
    r.openUntil = 0
    r.openReason = null
    r.lastOkAt = maintenant
    return r
  }
  noterErreur(r, issue, maintenant)
  if (etat === 'reseau') return r // the transport failed, not the model: the breaker is left alone
  if (etat === 'limite') {
    r.openUntil = Math.max(Number(r.openUntil) || 0, maintenant + PAUSE_LIMITE_MS)
    r.openReason = 'limit'
    return r
  }
  if (etat === 'hors-jeu') {
    r.openUntil = maintenant + PAUSE_HORS_JEU_MS
    r.openReason = 'not-chat'
    return r
  }
  // erreur | muet
  r.consecutive = (Number(r.consecutive) || 0) + 1
  const dur = CODES_DURS.indexOf(String(issue.code)) >= 0
  let pause = 0
  if (dur) pause = PAUSE_MAX_MS
  else if (r.consecutive >= SEUIL_OUVERTURE) pause = Math.min(PAUSE_MIN_MS * Math.pow(2, r.consecutive - SEUIL_OUVERTURE), PAUSE_MAX_MS)
  if (pause > 0) {
    r.openUntil = maintenant + pause
    r.openReason = causeDe(String(issue.code))
  }
  return r
}

/** The page's view of one model. `etat`: jamais (never seen) | ok | degrade (failing, not yet skipped, or on trial) | down. Pure. */
export function vueModele (modele, rec, maintenant) {
  const r = rec !== null && rec !== undefined && typeof rec === 'object' ? rec : null
  const calls = r === null ? 0 : Number(r.calls) || 0
  const vu = r !== null && (calls > 0 || r.lastProbe !== null && r.lastProbe !== undefined || r.lastError !== null && r.lastError !== undefined)
  const disjoncteur = etatDisjoncteur(r, maintenant)
  const consecutive = r === null ? 0 : Number(r.consecutive) || 0
  let etat = 'ok'
  if (!vu) etat = 'jamais'
  else if (disjoncteur === 'open') etat = 'down'
  else if (disjoncteur === 'half-open' || consecutive > 0) etat = 'degrade'
  const errors = r === null ? 0 : Number(r.errors) || 0
  const cacheInput = r === null ? 0 : Number(r.cacheInput) || 0
  const cacheRead = r === null ? 0 : Number(r.cacheRead) || 0
  return {
    modele, etat, disjoncteur, jusqua: disjoncteur === 'open' ? Number(r.openUntil) : null,
    cause: disjoncteur === 'closed' || r === null || r.openReason === null || r.openReason === undefined ? (r !== null && r.lastError ? causeDe(String(r.lastError.code)) : null) : r.openReason,
    consecutive, calls, errors,
    erreurPct: calls > 0 ? Math.round((errors / calls) * 1000) / 10 : null,
    lastLatencyMs: r === null ? null : (r.lastLatencyMs === undefined ? null : r.lastLatencyMs),
    cacheHitPct: cacheInput > 0 ? Math.round((cacheRead / cacheInput) * 100) : null,
    lastError: r === null || !r.lastError ? null : r.lastError,
    sonde: r === null || !r.lastProbe ? null : r.lastProbe
  }
}

/** Who may be tried, in the whitelist's order, and who is skipped and why. `exclure` = models that just failed for
 *  this very delegation. At most `max` are kept: the caller never gets a longer chain than the retry cap. Pure. */
export function triCandidats (candidats, sante, maintenant, { exclure = [], max = plafondEssais() } = {}) {
  const eligibles = []
  const ecartes = []
  const vus = new Set()
  for (const modele of Array.isArray(candidats) ? candidats : []) {
    if (typeof modele !== 'string' || vus.has(modele)) continue
    vus.add(modele)
    if (exclure.indexOf(modele) >= 0) { ecartes.push({ modele, raison: 'exclu' }); continue }
    const rec = sante !== null && sante !== undefined ? sante[modele] : undefined
    if (etatDisjoncteur(rec, maintenant) === 'open') {
      ecartes.push({ modele, raison: rec.openReason || 'pause', jusqua: Number(rec.openUntil) })
      continue
    }
    if (eligibles.length >= max) { ecartes.push({ modele, raison: 'plafond' }); continue }
    eligibles.push(modele)
  }
  return { eligibles, ecartes }
}

/** Is a cached verdict still good? Pure. */
export const verdictFrais = (verdict, maintenant) => verdict !== null && verdict !== undefined &&
  maintenant - verdict.at < (verdict.issue.etat === 'ok' ? TTL_SONDE_MS : TTL_SONDE_KO_MS)

/** Probe the eligible models, in order, a few at a time, until one answers; hand back the chain.
 *  `sonder(modele)` resolves to an issue (never throws); `cache` is a Map modele → { at, issue }; `noter(modele, issue)`
 *  records an outcome. Models not reached (deadline, or a healthy one was found first) follow, unprobed. */
export async function resoudre ({ eligibles, sonder, cache, noter, horloge = () => Date.now(), delaiMs = DELAI_SONDES_MS, groupe = GROUPE_SONDES, forcer = false }) {
  const chaine = []
  const echecs = []
  let sondes = 0
  let delai = false
  const debut = horloge()
  let i = 0
  while (i < eligibles.length) {
    if (chaine.some((c) => c.verifie === true)) break
    if (horloge() - debut >= delaiMs) { delai = true; break }
    const lot = eligibles.slice(i, i + groupe)
    i += lot.length
    const verdicts = await Promise.all(lot.map(async (modele) => {
      const vu = forcer === true ? null : cache.get(modele)
      if (verdictFrais(vu, horloge())) return { modele, issue: vu.issue, source: 'cache' }
      const issue = await sonder(modele)
      sondes += 1
      cache.set(modele, { at: horloge(), issue })
      noter(modele, issue)
      return { modele, issue, source: 'probe' }
    }))
    for (const v of verdicts) {
      if (v.issue.etat === 'ok') chaine.push({ modele: v.modele, verifie: true, source: v.source })
      else echecs.push({ modele: v.modele, raison: causeDe(String(v.issue.code)), code: String(v.issue.code), message: String(v.issue.message || '').slice(0, MESSAGE_MAX) })
    }
  }
  for (const modele of eligibles.slice(i)) chaine.push({ modele, verifie: false, source: 'unprobed' })
  return { chaine, echecs, sondes, delai }
}
