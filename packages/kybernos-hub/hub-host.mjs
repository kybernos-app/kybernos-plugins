// ── Hub host: boot tracking + HTTP routes ───────────────────────────────────
// Everything here takes its I/O as arguments (state reader/writer, clock, id
// generator) so test-host.mjs can play it without DSH, a disk or a browser.
import { noterCasse, noterChargement, noterDemarrage, noterSante, normaliser, nomsValides, recommandation } from './boot-guard.mjs'
import { basculer, charge, installer } from './suite-host.mjs'

/**
 * @param {{lire: () => unknown, ecrire: (etat: object) => void, maintenant: () => string, nouvelId: () => string}} io
 */
export function creerHub (io) {
  let bootId = null
  const charger = () => { try { return normaliser(io.lire()) } catch { return normaliser(null) } }
  const sauver = (etat) => { try { io.ecrire(etat) } catch { /* disk full / read-only: tracking is best effort, never fatal */ } }

  return {
    /** Record this boot. Returns the verdict about the PREVIOUS boots. */
    demarrer () {
      bootId = io.nouvelId()
      const etat = noterDemarrage(charger(), { id: bootId, date: io.maintenant() })
      sauver(etat)
      return recommandation(etat, { exclure: bootId })
    },
    bootId: () => bootId,
    /** Beacon from the browser. Returns {statut, corps}. */
    balise ({ type, bootId: recu, entries }) {
      if (bootId === null) return { statut: 503, corps: { ok: false, error: 'not-started' } }
      if (type === 'loading') {
        sauver(noterChargement(charger(), bootId))
        return { statut: 200, corps: { ok: true, bootId } }
      }
      if (type === 'broken') {
        if (recu !== bootId) return { statut: 409, corps: { ok: false, error: 'stale-boot', bootId } }
        sauver(noterCasse(charger(), bootId, entries))
        return { statut: 200, corps: { ok: true, bootId, entries: nomsValides(entries) } }
      }
      if (type === 'alive') {
        if (recu !== bootId) return { statut: 409, corps: { ok: false, error: 'stale-boot', bootId } }
        sauver(noterSante(charger(), bootId))
        return { statut: 200, corps: { ok: true, bootId } }
      }
      return { statut: 400, corps: { ok: false, error: 'bad-type' } }
    },
    etat () {
      const e = charger()
      return {
        ok: true,
        bootId,
        recommendation: recommandation(e, { exclure: bootId }),
        safe: { active: e.safe.actif, since: e.safe.depuis },
        history: e.demarrages.slice(-5).map((d) => ({ id: d.id, date: d.date, gui: d.gui, failed: d.echouees }))
      }
    }
  }
}

// ── Origin guard. DSH serves plugin routes BEFORE its own auth, so each route
// guards itself. Same rule as the other bundles: compare with the REAL socket
// address, so a forged Host header does not get through.
const str = (v) => (typeof v === 'string' && v.length > 0 ? v : null)
const hotesLocaux = (req) => {
  const port = typeof req?.socket?.localPort === 'number' ? ':' + req.socket.localPort : ''
  return ['127.0.0.1' + port, 'localhost' + port, '[::1]' + port]
}
const origineOk = (req, strict) => {
  try {
    const source = str(req?.headers?.origin) ?? str(req?.headers?.referer)
    if (source === null) return strict === false
    const u = new URL(source)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    return hotesLocaux(req).includes(u.host)
  } catch { return strict === false }
}
export const sameOriginStrict = (req) => origineOk(req, true)
export const sameOriginLax = (req) => origineOk(req, false)

const envoyer = (res, statut, charge) => {
  try {
    res.writeHead(statut, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(charge))
  } catch { /* socket closed */ }
}

const lireCorps = async (req, plafond = 2048) => {
  let taille = 0
  const morceaux = []
  for await (const m of req) { taille += m.length; if (taille > plafond) throw new Error('too-large'); morceaux.push(m) }
  return morceaux.length === 0 ? null : JSON.parse(Buffer.concat(morceaux).toString('utf8'))
}

export function monterRoutes (webServer, hub, liens = {}) {
  const etat = (req, res) => {
    if (req.method !== 'GET') return envoyer(res, 405, { ok: false, error: 'method-not-allowed' })
    if (sameOriginLax(req) === false) return envoyer(res, 403, { ok: false, error: 'origin-refused' })
    return envoyer(res, 200, hub.etat())
  }
  const balise = async (req, res) => {
    if (req.method !== 'POST') return envoyer(res, 405, { ok: false, error: 'method-not-allowed' })
    if (sameOriginStrict(req) === false) return envoyer(res, 403, { ok: false, error: 'origin-refused' })
    if (!String(req.headers?.['content-type'] ?? '').toLowerCase().startsWith('application/json')) return envoyer(res, 415, { ok: false, error: 'json-required' })
    let corps
    try { corps = await lireCorps(req) } catch { return envoyer(res, 400, { ok: false, error: 'bad-body' }) }
    const { statut, corps: charge } = hub.balise({ type: corps?.type, bootId: corps?.bootId, entries: corps?.entries })
    return envoyer(res, statut, charge)
  }
  const enregistrer = () => {
    webServer.register({ kind: 'exact', path: '/kybernos-hub/state', handler: etat })
    webServer.register({ kind: 'exact', path: '/kybernos-hub/beacon', handler: balise })
  }
  return typeof liens.effect === 'function' ? liens.effect(enregistrer, 'kybernos-hub: routes') : enregistrer()
}

/**
 * Suite panel routes.
 *   GET  /kybernos-hub/suite      → catalogue + what is switched on + boot verdict
 *   POST /kybernos-hub/module     → { id, action: 'activer' | 'desactiver' | 'installer' }
 *   POST /kybernos-hub/relaunch   → { confirm: true } — detached restart, ONLY on explicit confirmation
 * deps: { catalogue, lireActivation(), ecrireActivation(obj), executer(argv), relancer(), hub }
 */
export function monterSuite (webServer, deps, liens = {}) {
  let occupe = false
  const lire = () => { try { return deps.lireActivation() } catch { return null } }
  const suite = (req, res) => {
    if (req.method !== 'GET') return envoyer(res, 405, { ok: false, error: 'method-not-allowed' })
    if (sameOriginLax(req) === false) return envoyer(res, 403, { ok: false, error: 'origin-refused' })
    return envoyer(res, 200, charge({ catalogue: deps.catalogue, brut: lire(), etatHub: deps.hub.etat() }))
  }
  const corpsJson = async (req, res) => {
    if (req.method !== 'POST') { envoyer(res, 405, { ok: false, error: 'method-not-allowed' }); return undefined }
    if (sameOriginStrict(req) === false) { envoyer(res, 403, { ok: false, error: 'origin-refused' }); return undefined }
    if (!String(req.headers?.['content-type'] ?? '').toLowerCase().startsWith('application/json')) { envoyer(res, 415, { ok: false, error: 'json-required' }); return undefined }
    try { return (await lireCorps(req)) ?? {} } catch { envoyer(res, 400, { ok: false, error: 'bad-body' }); return undefined }
  }
  const module_ = async (req, res) => {
    const corps = await corpsJson(req, res)
    if (corps === undefined) return undefined
    const { id, action } = corps
    if (occupe) return envoyer(res, 409, { ok: false, error: 'busy' })
    occupe = true
    try {
      if (action === 'installer') {
        const r = await installer({ catalogue: deps.catalogue, brut: lire(), id, ecrire: deps.ecrireActivation, executer: deps.executer })
        return envoyer(res, r.ok ? 200 : (r.error === 'unknown-module' ? 404 : 500), r)
      }
      if (action === 'activer' || action === 'desactiver') {
        const b = basculer({ catalogue: deps.catalogue, brut: lire(), id, actif: action === 'activer' })
        if (!b.ok) return envoyer(res, b.error === 'unknown-module' ? 404 : 403, b)
        try { deps.ecrireActivation(b.ecrit) } catch (e) { return envoyer(res, 500, { ok: false, error: 'activation-write-failed', detail: String(e?.message ?? e) }) }
        return envoyer(res, 200, { ok: true })
      }
      return envoyer(res, 400, { ok: false, error: 'bad-action' })
    } finally { occupe = false }
  }
  const relancer = async (req, res) => {
    const corps = await corpsJson(req, res)
    if (corps === undefined) return undefined
    if (corps.confirm !== true) return envoyer(res, 400, { ok: false, error: 'confirmation-required' })
    let r
    try { r = await deps.relancer() } catch (e) { return envoyer(res, 500, { ok: false, error: 'relaunch-failed', detail: String(e?.message ?? e) }) }
    return envoyer(res, r?.ok === true ? 200 : 500, r?.ok === true ? { ok: true } : { ok: false, error: r?.error ?? 'relaunch-failed' })
  }
  const enregistrer = () => {
    webServer.register({ kind: 'exact', path: '/kybernos-hub/suite', handler: suite })
    webServer.register({ kind: 'exact', path: '/kybernos-hub/module', handler: module_ })
    webServer.register({ kind: 'exact', path: '/kybernos-hub/relaunch', handler: relancer })
  }
  return typeof liens.effect === 'function' ? liens.effect(enregistrer, 'kybernos-hub: suite routes') : enregistrer()
}
