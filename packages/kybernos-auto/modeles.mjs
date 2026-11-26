// The models Auto may pick from, when the person has not typed a list of them.
//
// « Auto routing » used to need every model typed in by hand (`provider/model`, one chip each). Now the list has three scopes
// (the setting `autoScope` of settings.json):
//   · all    — every configured model whose provider is connected (the default for a fresh install);
//   · free   — the same, restricted to the models that cost nothing to call;
//   · custom — the list the person typed (`autoWhitelist`), exactly as before.
// The scope is resolved here, on the host, each time the list is needed, so a model connected tomorrow is picked up without
// anybody editing a list. Pure parts first (tested without a DSH), then the reading of the host's services.
//
// « Free » is read from what the profile says, nothing more: the Free LLMs route, a model whose id says so (`:free`, `-free`),
// a model that runs on this machine. A provider's free quota cannot be told from the profile and is not guessed.

/** The route the Free LLMs plugin writes in `llm-pi-ai.providers`. */
export const ROUTE_GRATUITE = 'opencode-free'
/** The route the Kybernos Cloud plugin writes while an account is connected. */
export const ROUTE_NUAGE = 'kybernos'

/** Never a chat nor a media model: Auto must not route a request to an embedding, a reranker or a moderation model. */
const HORS_CHAT = /embed|rerank|moderation|guard/i
/** The cheap tier of every provider, and the costly one (the same reading as the Study model's automatic pick). */
const LOURD = /opus|\bpro\b|large|max|ultra|think|reason|(^|[^a-z0-9])(o1|o3|r1)([^a-z0-9]|$)|\b(32|34|70|72|110|235|405|480)b\b/i
const PETIT = /nano|lite|tiny|mini|small|flash|haiku|\bair\b|fast|turbo|instant|\b(0\.5|1|1\.5|2|3|4)b\b/i
const LIBRE_ID = /(:free|-free)$/i
const OLLAMA = /^ollama/i
const BOUCLE = /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?|0\.0\.0\.0)$/i

export const SCOPES = ['all', 'free', 'custom']

const cleDe = (x) => (typeof x.cle === 'string' && x.cle !== '' ? x.cle : x.route + '/' + x.id)
const rang = (x) => (LOURD.test(x.id) ? 2 : (PETIT.test(x.id) ? 0 : 1))

/** Does this model cost nothing to call? */
export const estLibre = (x) => x.route === ROUTE_GRATUITE || x.locale === true || LIBRE_ID.test(String(x.id))

/** The scope in force: the stored one, else what the saved settings imply (a list typed before scopes existed stays that list). */
export const scopeEnVigueur = (stocke, liste) => {
  if (SCOPES.indexOf(stocke) >= 0) return stocke
  return Array.isArray(liste) && liste.length > 0 ? 'custom' : 'all'
}

/**
 * The ordered `route/id` list of a scope. `custom` is the typed list as it is. `all` and `free` read the models the host knows:
 * connected ones, no embedding or moderation model, the Kybernos Cloud first, then the cheap ones before the costly ones, a model
 * on this machine after the remote ones (a small local model is the last resort, not the first pick), then by name.
 * With nothing known (no service, nothing configured) the answer is an empty list, never a made-up one.
 * @param {'all'|'free'|'custom'} scope
 * @param {string[]} liste the typed list (`custom`)
 * @param {Array<{route:string,id:string,cle?:string,connecte?:boolean,locale?:boolean}>|null} modeles
 * @returns {string[]}
 */
export const etendre = (scope, liste, modeles) => {
  if (scope === 'custom') return Array.isArray(liste) ? liste : []
  if (!Array.isArray(modeles)) return []
  const bons = modeles
    .filter((x) => x !== null && typeof x === 'object' && typeof x.route === 'string' && x.route !== '' && typeof x.id === 'string' && x.id !== '')
    .filter((x) => x.connecte !== false && !HORS_CHAT.test(x.id))
    .filter((x) => scope !== 'free' || estLibre(x))
  const ordre = (x) => (x.route === ROUTE_NUAGE ? 0 : (x.locale === true ? 3 : 1 + (rang(x) === 2 ? 1 : 0)))
  bons.sort((a, b) => ordre(a) - ordre(b) || rang(a) - rang(b) || (cleDe(a) < cleDe(b) ? -1 : (cleDe(a) > cleDe(b) ? 1 : 0)))
  const vus = new Set()
  const sortie = []
  for (const x of bons) { const c = cleDe(x); if (!vus.has(c)) { vus.add(c); sortie.push(c) } }
  return sortie
}

// ── what is typed in the list: a `provider/model` the profile knows ───────────────────────────────────────────────────────
/** `route/id`: a provider slug, a slash, a model id with no space, no control character and no `..`. Pure. */
const FORME = /^[a-z0-9][a-z0-9-]{0,40}\/[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,150}$/
export const formeOk = (cle) => typeof cle === 'string' && FORME.test(cle) && cle.indexOf('..') < 0

/**
 * Why a typed list is refused, or null when it is fine. The form is always checked; the existence is checked only when the host
 * knows the configured models (`connus` is a Set of `route/id`, or null when nothing is known): a host that cannot read the profile
 * must not refuse a list it cannot judge. Pure.
 * @returns {{ code: 'forme'|'inconnu', cles: string[] } | null}
 */
export const refuserListe = (liste, connus) => {
  const sait = connus instanceof Set && connus.size > 0
  // A model the profile itself declares is accepted whatever its spelling; anything else must look like `provider/model`.
  const mauvaises = liste.filter((x) => !(sait && connus.has(x)) && formeOk(x) !== true)
  if (mauvaises.length > 0) return { code: 'forme', cles: mauvaises }
  if (sait) {
    const inconnues = liste.filter((x) => !connus.has(x))
    if (inconnues.length > 0) return { code: 'inconnu', cles: inconnues }
  }
  return null
}

// ── reading the host's services (settings + credentials): never throws ───────────────────────────────────────────────────
const profilLocal = (route, profil) => {
  if (OLLAMA.test(route)) return true
  try { return BOUCLE.test(new URL(String(profil.baseURL)).hostname) } catch (e) { return false }
}

/** The value of one settings namespace; the host's service answers an array of `{ns, value}`, a remote one `{ok, value:{namespaces}}`. */
const valeurNamespace = async (settings, ns) => {
  if (settings === null || settings === undefined || typeof settings.describe !== 'function') return undefined
  let formes = await settings.describe()
  if (formes !== null && typeof formes === 'object' && formes.value !== null && typeof formes.value === 'object' && Array.isArray(formes.value.namespaces)) formes = formes.value.namespaces
  if (!Array.isArray(formes)) return undefined
  const f = formes.find((x) => x !== null && typeof x === 'object' && x.ns === ns)
  return f === undefined ? undefined : f.value
}

/**
 * Every configured model, with whether its provider is connected: a provider is connected when its profile names no key (a local
 * engine, an account) or when the key it names exists. Only the EXISTENCE of a key is asked of the credentials service. An unreadable
 * settings service gives `null` (nothing known); an unreadable credentials service gives a provider taken as connected.
 * @returns {Promise<Array<{route:string,id:string,cle:string,connecte:boolean,locale:boolean}>|null>}
 */
export async function modelesConnus (services = {}) {
  try {
    const settings = services !== null && services !== undefined ? services.settings : undefined
    const credentials = services !== null && services !== undefined ? services.credentials : undefined
    const ns = await valeurNamespace(settings, 'llm-pi-ai')
    if (ns === undefined) return null
    const profils = ns !== null && typeof ns === 'object' && ns.providers !== null && typeof ns.providers === 'object' ? ns.providers : {}
    const connus = new Map()
    const connecte = async (profil) => {
      const ref = typeof profil.apiKeyEnv === 'string' ? profil.apiKeyEnv : ''
      if (ref === '') return true
      if (credentials === null || credentials === undefined || typeof credentials.describe !== 'function') return true
      if (!connus.has(ref)) {
        connus.set(ref, (async () => {
          try {
            const d = await credentials.describe(ref)
            return d !== null && typeof d === 'object' ? d.configured === true : true
          } catch (e) { return true }
        })())
      }
      return connus.get(ref)
    }
    const sortie = []
    for (const route of Object.keys(profils)) {
      const profil = profils[route] !== null && typeof profils[route] === 'object' ? profils[route] : {}
      const ids = []
      for (const mo of (Array.isArray(profil.models) ? profil.models : [])) if (mo !== null && typeof mo === 'object' && typeof mo.id === 'string' && mo.id !== '') ids.push(mo.id)
      const dessus = profil.modelOverrides !== null && typeof profil.modelOverrides === 'object' ? profil.modelOverrides : {}
      for (const id of Object.keys(dessus)) if (id !== '') ids.push(id)
      if (ids.length === 0) continue
      const est = await connecte(profil)
      const locale = profilLocal(route, profil)
      const vu = new Set()
      for (const id of ids) {
        if (vu.has(id)) continue
        vu.add(id)
        sortie.push({ route, id, cle: route + '/' + id, connecte: est, locale })
      }
    }
    return sortie
  } catch (e) { return null }
}
