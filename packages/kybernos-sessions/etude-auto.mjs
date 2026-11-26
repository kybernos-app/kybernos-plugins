// The automatic Study model.
//
// The setting `brain` of Kybernos Settings names the Study model: it watches the other models, judges the unclear cases of the
// Memory tidy-up and answers the closed questions (which agent team, which chat icon). Empty used to mean « nobody », so on a
// fresh install nothing was watched and the closed questions never reached a model. Empty now means « Automatic »: this module
// picks the model, from what the person already connected.
//
// The order (owner's decision, 2026-10-16):
//   1. the model of the connected Kybernos Cloud;
//   2. else the cheapest connected model that answers — a provider whose key is configured and that the last health probe did
//      not see failing. The profile carries no price, so « cheap » is read from the model's name (nano, mini, flash, haiku…
//      are cheap; opus, pro, reasoning and very large models are not);
//   3. else a small local Ollama model (the smallest).
// A model that is not a chat model (embedding, speech, image), or that declares no text input, is never picked.
//
// The choice is a pure function of the models it is given, so it is stable from one reading to the next. Reading the host's
// services (`modelesConnectes`) never throws: a service that is absent or fails means « nothing known », not an error.

/** The route the Kybernos Cloud plugin writes in `llm-pi-ai.providers` while an account is connected. */
export const ROUTE_NUAGE = 'kybernos'

/** A model that is not for chat: it must not become the Study model (same list as the default-model picker). */
const SPECIALISE = /embed|rerank|tts|whisper|transcri|audio|speech|image|dall-?e|moderation|realtime|guard|sora/i
/** Slow, costly or thinking models: a closed question needs one short answer, not 120 tokens of reasoning. */
const LOURD = /opus|\bpro\b|large|max|ultra|think|reason|(^|[^a-z0-9])(o1|o3|r1)([^a-z0-9]|$)|\b(32|34|70|72|110|235|405|480)b\b/i
/** The cheap tier of every provider. */
const PETIT = /nano|lite|tiny|mini|small|flash|haiku|\bair\b|fast|turbo|instant|\b(0\.5|1|1\.5|2|3|4)b\b/i
const OLLAMA = /^ollama/i

const cleDe = (x) => (typeof x.cle === 'string' && x.cle !== '' ? x.cle : x.route + '/' + x.id)
const estLocal = (x) => x.locale === true || OLLAMA.test(String(x.route))
const rang = (x) => (LOURD.test(x.id) ? 2 : (PETIT.test(x.id) ? 0 : 1))
const parCle = (a, b) => (cleDe(a) < cleDe(b) ? -1 : (cleDe(a) > cleDe(b) ? 1 : 0))

/** A text model: not a specialised one, and not one that declares input modalities WITHOUT text. An empty or missing
 *  declaration is « not declared », not « no text » (the harness renders many text models with an empty array). */
const pourLeTexte = (x) => !SPECIALISE.test(String(x.id)) &&
  (!Array.isArray(x.entree) || x.entree.length === 0 || x.entree.indexOf('text') >= 0)

/** The size of a local model in billions of parameters, read from its id (« qwen2.5:3b » → 3); 7 when it does not say. */
const taille = (id) => {
  const m = /(\d+(?:\.\d+)?)b\b/i.exec(String(id))
  return m === null ? 7 : Number(m[1])
}

/**
 * @param {{ modeles: Array<{route:string,id:string,cle?:string,entree?:string[]|null,connecte?:boolean,locale?:boolean}>, ecartes?: Set<string> }} entree
 * @returns {{ cle: string, raison: 'cloud'|'petit'|'local' } | null}
 */
export function choisirEtudeAuto (entree) {
  const modeles = entree !== null && entree !== undefined && Array.isArray(entree.modeles) ? entree.modeles : []
  const ecartes = entree !== null && entree !== undefined && entree.ecartes instanceof Set ? entree.ecartes : new Set()
  const bons = modeles
    .filter((x) => x !== null && typeof x === 'object' && typeof x.route === 'string' && x.route !== '' && typeof x.id === 'string' && x.id !== '')
    .filter((x) => x.connecte !== false && pourLeTexte(x) && !ecartes.has(cleDe(x)))
    .sort(parCle)
  const nuage = bons.filter((x) => x.route === ROUTE_NUAGE)
  if (nuage.length > 0) {
    const auto = nuage.filter((x) => /auto/i.test(x.id))
    const choisi = auto.length > 0 ? auto[0] : nuage.slice().sort((a, b) => rang(a) - rang(b) || parCle(a, b))[0]
    return { cle: cleDe(choisi), raison: 'cloud' }
  }
  const distants = bons.filter((x) => !estLocal(x))
  if (distants.length > 0) {
    return { cle: cleDe(distants.slice().sort((a, b) => rang(a) - rang(b) || parCle(a, b))[0]), raison: 'petit' }
  }
  const locaux = bons.filter((x) => estLocal(x))
  if (locaux.length > 0) {
    return { cle: cleDe(locaux.slice().sort((a, b) => taille(a.id) - taille(b.id) || parCle(a, b))[0]), raison: 'local' }
  }
  return null
}

const BOUCLE = /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?|0\.0\.0\.0)$/i
/** Does the profile talk to an engine on this machine? */
const profilLocal = (route, profil) => {
  if (OLLAMA.test(route)) return true
  try { return BOUCLE.test(new URL(String(profil.baseURL)).hostname) } catch (e) { return false }
}

/** The value of one settings namespace, from the settings service of the host. The host's service answers an array of
 *  `{ns, value}` at once; a remote one answers a promise of `{ok, value: {namespaces}}`: both are read. `undefined` when it
 *  cannot be read. */
const valeurNamespace = async (settings, ns) => {
  if (settings === null || settings === undefined || typeof settings.describe !== 'function') return undefined
  let formes = await settings.describe()
  if (formes !== null && typeof formes === 'object' && formes.value !== null && typeof formes.value === 'object' && Array.isArray(formes.value.namespaces)) formes = formes.value.namespaces
  if (!Array.isArray(formes)) return undefined
  const f = formes.find((x) => x !== null && typeof x === 'object' && x.ns === ns)
  return f === undefined ? undefined : f.value
}

/**
 * Every configured model, with whether its provider is connected. A provider is connected when its profile names no key (a
 * local engine, an account) or when the key it names is configured. Only the EXISTENCE of a key is asked of the credentials
 * service, never its value. Never throws; an unreadable service gives an empty list, an unreadable credentials service a
 * provider taken as connected (a failing call costs nothing, a model wrongly left out would).
 * @returns {Promise<Array<{route:string,id:string,cle:string,entree:string[]|null,connecte:boolean,locale:boolean}>>}
 */
export async function modelesConnectes (services = {}) {
  const sortie = []
  try {
    const settings = services !== null && services !== undefined ? services.settings : undefined
    const credentials = services !== null && services !== undefined ? services.credentials : undefined
    const ns = await valeurNamespace(settings, 'llm-pi-ai')
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
    for (const route of Object.keys(profils)) {
      const profil = profils[route] !== null && typeof profils[route] === 'object' ? profils[route] : {}
      const modeles = []
      for (const mo of (Array.isArray(profil.models) ? profil.models : [])) {
        if (mo !== null && typeof mo === 'object' && typeof mo.id === 'string' && mo.id !== '') modeles.push({ id: mo.id, entree: Array.isArray(mo.input) ? mo.input : null })
      }
      const dessus = profil.modelOverrides !== null && typeof profil.modelOverrides === 'object' ? profil.modelOverrides : {}
      for (const id of Object.keys(dessus)) {
        const ro = dessus[id] !== null && typeof dessus[id] === 'object' ? dessus[id] : {}
        if (id !== '') modeles.push({ id, entree: Array.isArray(ro.input) ? ro.input : null })
      }
      if (modeles.length === 0) continue
      const vu = new Set()
      const est = await connecte(profil)
      const locale = profilLocal(route, profil)
      for (const mo of modeles) {
        if (vu.has(mo.id)) continue
        vu.add(mo.id)
        sortie.push({ route, id: mo.id, cle: route + '/' + mo.id, entree: mo.entree, connecte: est, locale })
      }
    }
  } catch (e) { /* nothing known */ }
  return sortie
}

/** Of the models the page asks about, the ones that are connected. A model the host knows nothing about is kept: the page may
 *  list a model the host has not read yet, and a model it asked about is never dropped in silence. In Automatic the probe
 *  watches what the person connected: the profile lists many providers nobody set a key for, and « 100 models not answering »
 *  would be noise, not a warning. */
export function garderConnectes (cles, modeles) {
  const connus = new Map()
  for (const x of (Array.isArray(modeles) ? modeles : [])) {
    if (x !== null && typeof x === 'object') connus.set(typeof x.cle === 'string' && x.cle !== '' ? x.cle : String(x.route) + '/' + String(x.id), x.connecte !== false)
  }
  return (Array.isArray(cles) ? cles : []).filter((c) => connus.get(c) !== false)
}

/** The models the last health probe saw failing: silent, refused, rate-limited or not a chat model. A network failure says
 *  nothing about a model, and when EVERY model failed the probe says the network is down, not the models: then nothing is
 *  excluded. `null` (no probe yet) excludes nothing. */
export function ecartesDe (sonde) {
  const sortie = new Set()
  if (sonde === null || sonde === undefined || typeof sonde !== 'object' || sonde.actif !== true || sonde.tousEnEchec === true) return sortie
  for (const r of (Array.isArray(sonde.modeles) ? sonde.modeles : [])) {
    if (r !== null && typeof r === 'object' && ['erreur', 'muet', 'limite', 'hors-jeu'].indexOf(r.etat) >= 0 && typeof r.cle === 'string') sortie.add(r.cle)
  }
  return sortie
}
