// ── Réordonnancement de la file d'attente, sans patcher le moteur ───────────
//
// REMPLACE `scripts/patch-dsh-queue-move.mjs` (cinq fichiers moteur, un diff
// par version de DSH). Mesuré sur 0.2.0-rc.2 / 0.2.1-alpha.1 :
//
//   · le verbe natif est inatteignable depuis un plugin : `updateQueue` n'a que
//     edit / remove / steer, union FERMÉE recopiée dans trois codecs ;
//   · l'API publique de l'inbox ne convient pas : `splice`, `remove` et
//     `replace` passent par `mutate(…, discardRemoved = true)` — le message
//     retiré est « discarded » (`agent/inbox/discarded`, splice `canceled`),
//     ce qui fait perdre ses pièces jointes et ses tours de goal. C'est la
//     raison d'être du patch d'origine.
//
// Ce module contourne le codec par une route À NOUS (`/kybernos/queue-move`) et
// reprend le geste du patch via la méthode interne `mutate(target, start,
// deleteCount, inserted, discardRemoved)` avec `discardRemoved = false` : deux
// splices (retrait, puis insertion du MÊME objet) sans `canceled` ni
// `discarded` — les consommateurs ne voient qu'un déplacement.
//
// `mutate` n'est pas dans le contrat public de l'inbox : elle est donc gardée
// par un CANARI (`capacite`) vérifié à chaque appel — présence, arité, et la
// lecture publique `nextTurn`/`nextStep`. Si le moteur la renomme ou en change
// la signature, la route répond 501 `unsupported` et le client ne rend aucune
// poignée : la fonction se désactive, elle ne casse rien et n'écrit nulle part.

const LANES = ['next-turn', 'next-step']

/** Texte aperçu d'un message (premier bloc texte), pour confronter la ligne du DOM. */
export function apercu (message) {
  const blocs = Array.isArray(message?.content) ? message.content : []
  for (const bloc of blocs) {
    if (bloc?.type === 'text' && typeof bloc.text === 'string') return bloc.text.replace(/\s+/g, ' ').trim().slice(0, 200)
  }
  return ''
}

const lane = (inbox, cible) => (cible === 'next-turn' ? inbox.nextTurn : inbox.nextStep)

/**
 * Le canari : le moteur installé expose-t-il ce dont le déplacement dépend ?
 * @param {object} inbox `agent.inbox`
 * @returns {{ok: true} | {ok: false, raison: string}}
 */
export function capacite (inbox) {
  if (inbox === undefined || inbox === null) return { ok: false, raison: 'inbox-absente' }
  if (typeof inbox.mutate !== 'function') return { ok: false, raison: 'mutate-absente' }
  if (inbox.mutate.length !== 5) return { ok: false, raison: 'mutate-signature (' + String(inbox.mutate.length) + ' arguments au lieu de 5)' }
  if (!Array.isArray(inbox.nextTurn) || !Array.isArray(inbox.nextStep)) return { ok: false, raison: 'lecture-publique-absente' }
  return { ok: true }
}

/** Les deux files, avec identité et aperçu : la vérité que le client confronte à son DOM. */
export function lister (inbox) {
  const items = []
  for (const cible of LANES) {
    lane(inbox, cible).forEach((message, index) => { items.push({ id: message.id, lane: cible, index, preview: apercu(message) }) })
  }
  return items
}

function localiser (inbox, id) {
  for (const cible of LANES) {
    const index = lane(inbox, cible).findIndex((m) => m.id === id)
    if (index >= 0) return { lane: cible, index }
  }
  return undefined
}

/**
 * Déplace `messageId` juste avant `beforeId` (`null` = en fin de file), dans sa file.
 * Mêmes refus que le patch : message inconnu, ancre inconnue, autre file, même place.
 * @param {object} inbox `agent.inbox`
 * @param {{messageId: string, beforeId: string|null}} demande
 * @returns {{ok: true, deplace: boolean} | {ok: false, erreur: string}}
 */
export function deplacer (inbox, { messageId, beforeId }) {
  const cap = capacite(inbox)
  if (cap.ok === false) return { ok: false, erreur: 'unsupported', detail: cap.raison }
  const source = localiser(inbox, messageId)
  if (source === undefined) return { ok: false, erreur: 'not-found' }
  let ancre
  if (beforeId !== null) {
    ancre = localiser(inbox, beforeId)
    if (ancre === undefined) return { ok: false, erreur: 'anchor-not-found' }
    if (ancre.lane !== source.lane) return { ok: false, erreur: 'cross-lane' }
    if (beforeId === messageId) return { ok: true, deplace: false }
  }
  const liste = lane(inbox, source.lane)
  const dernier = liste.length - 1
  // Même place : déjà juste avant l'ancre, ou déjà en queue.
  if (beforeId === null ? source.index === dernier : source.index + 1 === ancre.index) return { ok: true, deplace: false }
  const message = liste[source.index]
  inbox.mutate(source.lane, source.index, 1, [], false)
  const apres = lane(inbox, source.lane)
  const position = beforeId === null ? apres.length : apres.findIndex((m) => m.id === beforeId)
  // L'ancre vient de nous être confirmée : si elle a disparu entre-temps, on remet le message où il était.
  inbox.mutate(source.lane, position >= 0 ? position : source.index, 0, [message], false)
  return { ok: true, deplace: true }
}

// ── Garde d'origine (copie fidèle de celle de kybernos-plugin) ───────────────
// DSH sert les routes des plugins AVANT son authentification : chaque route se
// garde elle-même. L'origine est comparée à l'adresse RÉELLE d'écoute du socket
// (un `Host` forgé ne la contourne pas — recette 2026-10).
// Hosted instance: also accept the authorities declared to DSH with --trusted-host. The core bundle publishes the predicate
// (kybernos-plugin/trusted-authority.mjs); absent or failing, it answers false and the guard stays loopback-only.
const kbTrusted = (host) => { try { const f = globalThis[Symbol.for('kybernos.trustedAuthority')]; return typeof f === 'function' && f(host) === true } catch (e) { return false } }
const str = (v) => (typeof v === 'string' && v.length > 0 ? v : null)

function hotesLocaux (req) {
  const port = typeof req?.socket?.localPort === 'number' ? ':' + req.socket.localPort : ''
  return ['127.0.0.1' + port, 'localhost' + port, '[::1]' + port]
}

/** POST : l'absence d'Origin ET de Referer est refusée. */
export function sameOriginStrict (req) {
  try {
    const source = str(req?.headers?.origin) ?? str(req?.headers?.referer)
    if (source === null) return false
    const u = new URL(source)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    return (hotesLocaux(req).includes(u.host) || kbTrusted(u.host))
  } catch { return false }
}

/** GET : l'absence d'en-tête passe (navigation directe) ; un Origin étranger (DNS-rebinding) non. */
export function sameOriginLax (req) {
  try {
    const source = str(req?.headers?.origin) ?? str(req?.headers?.referer)
    if (source === null) return true
    const u = new URL(source)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    return (hotesLocaux(req).includes(u.host) || kbTrusted(u.host))
  } catch { return true }
}

function envoyer (res, statut, charge) {
  try {
    res.writeHead(statut, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(charge))
  } catch { /* socket fermé */ }
}

async function lireCorps (req, plafond = 4096) {
  let taille = 0
  const morceaux = []
  for await (const morceau of req) {
    taille += morceau.length
    if (taille > plafond) throw new Error('corps trop volumineux')
    morceaux.push(morceau)
  }
  if (morceaux.length === 0) return null
  return JSON.parse(Buffer.concat(morceaux).toString('utf8'))
}

const STATUT = { 'unsupported': 501, 'not-found': 404, 'anchor-not-found': 404, 'cross-lane': 409 }
const ID = /^[A-Za-z0-9._:-]{1,128}$/
/** Un identifiant valide est UNE CHAÎNE conforme — `String(undefined)` ne doit jamais passer pour « undefined ». */
const idValide = (v) => typeof v === 'string' && ID.test(v)

/**
 * Monte `/kybernos/queue-move` :
 *   GET  ?sessionId=…  → { ok, supported, items: [{id, lane, index, preview}] } (la sonde de capacité du client)
 *   POST {sessionId, messageId, beforeId|null} → { ok, deplace } ou { ok:false, error }
 * @param {{register: Function}} webServer service `webServer` de DSH
 * @param {{agents: () => {get: Function}|undefined, effect?: Function}} liens accès au registre d'agents et `ctx.effect`
 */
export function monterRoutes (webServer, liens) {
  const handler = async (req, res) => {
    const agents = liens.agents()
    const agentDe = (sessionId) => (idValide(sessionId) ? agents?.get(sessionId) : undefined)
    try {
      if (req.method === 'GET') {
        if (sameOriginLax(req) === false) return envoyer(res, 403, { ok: false, error: 'origin-refused' })
        const sessionId = new URL(req.url || '/', 'http://localhost').searchParams.get('sessionId')
        const agent = agentDe(sessionId)
        if (agent === undefined) return envoyer(res, 200, { ok: true, supported: false, items: [], reason: 'session-not-live' })
        const cap = capacite(agent.inbox)
        if (cap.ok === false) return envoyer(res, 200, { ok: true, supported: false, items: [], reason: cap.raison })
        return envoyer(res, 200, { ok: true, supported: true, items: lister(agent.inbox) })
      }
      if (req.method === 'POST') {
        if (sameOriginStrict(req) === false) return envoyer(res, 403, { ok: false, error: 'origin-refused' })
        if (!String(req.headers?.['content-type'] ?? '').toLowerCase().startsWith('application/json')) return envoyer(res, 415, { ok: false, error: 'json-required' })
        let corps
        try { corps = await lireCorps(req) } catch { return envoyer(res, 400, { ok: false, error: 'bad-body' }) }
        const { sessionId, messageId, beforeId } = corps ?? {}
        if (!idValide(messageId) || (beforeId !== null && !idValide(beforeId))) return envoyer(res, 400, { ok: false, error: 'bad-ids' })
        const agent = agentDe(sessionId)
        if (agent === undefined) return envoyer(res, 404, { ok: false, error: 'session-not-live' })
        const verdict = deplacer(agent.inbox, { messageId, beforeId })
        if (verdict.ok === true) return envoyer(res, 200, verdict)
        return envoyer(res, STATUT[verdict.erreur] ?? 400, { ok: false, error: verdict.erreur, ...(verdict.detail === undefined ? {} : { detail: verdict.detail }) })
      }
      return envoyer(res, 405, { ok: false, error: 'method-not-allowed' })
    } catch (erreur) {
      return envoyer(res, 500, { ok: false, error: String(erreur?.message ?? erreur) })
    }
  }
  const enregistrer = () => webServer.register({ kind: 'exact', path: '/kybernos/queue-move', handler })
  return typeof liens.effect === 'function' ? liens.effect(enregistrer, 'kybernos-flow: route queue-move') : enregistrer()
}
