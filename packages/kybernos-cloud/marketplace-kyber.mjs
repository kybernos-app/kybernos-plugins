/**
 * marketplace-kyber.mjs — le catalogue distant de kybernos.app, côté plugin.
 *
 * POURQUOI CE FICHIER EXISTE
 * La plateforme sert `GET /v1/marketplace` : des kybers publiés, avec leur
 * manifeste public (`name, cat, pitch, glyph, color, agents, version` — les clés
 * privées `data_schemas`, `source_kyber_id`, `price` sont retirées côté serveur).
 * Le plugin, lui, affichait un **catalogue local en dur** dont les compteurs
 * « 1.2k installs » et les prix étaient inventés. Ce module est la moitié pure
 * du chemin de réception : normaliser ce que la plateforme envoie, et en tirer
 * un `kyber.yml` dans le format que le plugin lit vraiment.
 *
 * CE QU'IL REFUSE DE FAIRE
 * Inventer. Un manifeste donne des `agents` (`role_key`, `name`, `does`,
 * `model_route`, `tools`) alors qu'un `kyber.yml` local attend des rôles
 * (`id`, `kind`, `needs`, `provider`, `model`, `prompt`) et des `stages`.
 * Deux ponts existent — l'identifiant et le prompt — et un seul est solide :
 * `does` est le prompt, `role_key` donne l'id. `model_route` (« kybernos/doer »)
 * est une route de la plateforme, PAS un couple provider/modèle : on ne le
 * traduit pas, on l'écrit tel quel sous `route:` (le lecteur du plugin ignore les
 * clés qu'il ne connaît pas) et on le LISTE dans `aCompleter`. Idem pour les
 * étapes : le catalogue n'en publie pas, on n'en fabrique pas.
 *
 * Un `aCompleter` vide est donc la seule preuve qu'un kyber reçu est complet.
 */

/** Les clés que la plateforme retire déjà : on les retire aussi, par principe. */
export const CLES_PRIVEES = ['data_schemas', 'source_kyber_id', 'price']

/** Un identifiant local : minuscules, tirets, jamais vide. */
export const slugifier = (v) => String(v === null || v === undefined ? '' : v)
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/** `custom:manager` → `manager` : le préfixe de la plateforme n'est pas un id local. */
export const idDeRole = (roleKey) => slugifier(String(roleKey === null || roleKey === undefined ? '' : roleKey).replace(/^[a-z]+:/i, ''))

/**
 * Normalise la réponse de `GET /v1/marketplace`.
 * Rend `{ ok, items, motif }` — un catalogue vide n'est jamais « ok » sans motif.
 */
export const normaliserCatalogue = (reponse) => {
  if (reponse === null || typeof reponse !== 'object') return { ok: false, items: [], motif: 'reponse illisible' }
  const brut = Array.isArray(reponse.items) ? reponse.items : null
  if (brut === null) return { ok: false, items: [], motif: 'aucun champ « items »' }
  const items = []
  let ecartes = 0
  for (const it of brut) {
    if (it === null || typeof it !== 'object') { ecartes++; continue }
    const slug = typeof it.slug === 'string' && it.slug !== '' ? it.slug : null
    const nom = typeof it.name === 'string' && it.name !== '' ? it.name : null
    if (slug === null || nom === null) { ecartes++; continue }
    const manBrut = it.manifest !== null && typeof it.manifest === 'object' ? it.manifest : {}
    // Defense en profondeur : la plateforme retire deja ces cles, on ne les porte pas plus loin.
    const man = {}
    for (const k of Object.keys(manBrut)) if (CLES_PRIVEES.indexOf(k) < 0) man[k] = manBrut[k]
    const agents = Array.isArray(man.agents) ? man.agents.filter((a) => a !== null && typeof a === 'object') : []
    items.push({
      id: typeof it.id === 'string' ? it.id : slug,
      slug,
      name: nom,
      cat: typeof it.cat === 'string' ? it.cat : '',
      pitch: typeof it.pitch === 'string' ? it.pitch : '',
      glyph: typeof it.glyph === 'string' ? it.glyph : '',
      color: typeof it.color === 'string' ? it.color : '',
      version: Number.isFinite(Number(it.version)) ? Number(it.version) : 0,
      publishedAt: typeof it.published_at === 'string' ? it.published_at : null,
      agents,
      manifest: man,
      origine: 'kybernos.app',
    })
  }
  const motif = items.length === 0 ? (ecartes > 0 ? 'aucune entree exploitable (' + ecartes + ' ecartee(s))' : 'catalogue vide') : null
  return { ok: items.length > 0, items, motif }
}

const echapper = (s) => String(s).replace(/\r/g, '').replace(/\n/g, ' ')
const bloc = (texte, indent) => {
  const lignes = String(texte).replace(/\r/g, '').split('\n')
  return lignes.map((l, i) => (i === 0 ? l : ' '.repeat(indent) + l)).join('\n')
}

/**
 * Un `kyber.yml` local à partir d'une entrée du catalogue.
 * Rend `{ yml, roles, aCompleter }` — `aCompleter` dit ce que la plateforme ne
 * fournit pas et ce que le testeur devra écrire.
 */
export const ymlDuKyber = (item) => {
  if (item === null || typeof item !== 'object' || typeof item.slug !== 'string' || item.slug === '') {
    return { yml: null, roles: [], aCompleter: ['entree de catalogue sans slug'] }
  }
  const aCompleter = []
  const roles = []
  const agents = Array.isArray(item.agents) ? item.agents : []
  const vus = {}
  for (const a of agents) {
    const id = idDeRole(a.role_key) || slugifier(a.name)
    if (id === '') { aCompleter.push('un agent sans role_key ni nom, ignore'); continue }
    if (vus[id] === true) { aCompleter.push('deux agents partagent l\'id « ' + id + ' » : un seul garde'); continue }
    vus[id] = true
    const prompt = typeof a.does === 'string' && a.does !== '' ? a.does : null
    if (prompt === null) aCompleter.push('role « ' + id + ' » : aucun prompt publie (does absent)')
    roles.push({
      id,
      prompt,
      route: typeof a.model_route === 'string' && a.model_route !== '' ? a.model_route : null,
      nom: typeof a.name === 'string' ? a.name : id,
      tools: Array.isArray(a.tools) ? a.tools.filter((t) => typeof t === 'string') : [],
    })
  }
  if (roles.length === 0) aCompleter.push('aucun role publie dans le manifeste')
  if (item.pitch === undefined || item.pitch === '') aCompleter.push('aucune mission publiee par le catalogue')
  const sansRoute = roles.filter((r) => r.route === null).map((r) => r.id)
  if (sansRoute.length > 0) aCompleter.push('sans route de modele : ' + sansRoute.join(', '))
  const routes = roles.filter((r) => r.route !== null)
  if (routes.length > 0) {
    aCompleter.push('la route de modele de la plateforme n\'est pas un couple provider/modele : '
      + routes.map((r) => r.id + '→' + r.route).join(', ') + ' — choisir provider/model localement')
  }
  aCompleter.push('les etapes (stages) ne sont pas publiees par le catalogue : les declarer localement')

  const l = []
  l.push('id: ' + item.slug)
  l.push('specVersion: 2')
  l.push('name: ' + echapper(item.name === undefined || item.name === '' ? item.slug : item.name))
  if (item.cat !== undefined && item.cat !== '') l.push('categorie: ' + echapper(item.cat))
  if (item.glyph !== undefined && item.glyph !== '') l.push('glyphe: ' + echapper(item.glyph))
  if (item.color !== undefined && item.color !== '') l.push('couleur: ' + echapper(item.color))
  l.push('origine: kybernos.app/' + item.slug)
  l.push('')
  l.push('mission: >-')
  l.push('  ' + bloc(item.pitch === undefined || item.pitch === '' ? '(mission non publiee)' : item.pitch, 2))
  l.push('')
  l.push('roles:')
  for (const r of roles) {
    l.push('  - id: ' + r.id)
    if (r.route !== null) l.push('    route: ' + echapper(r.route))
    if (r.tools.length > 0) l.push('    tools: [' + r.tools.map(echapper).join(', ') + ']')
    if (r.prompt !== null) {
      l.push('    prompt: >-')
      l.push('      ' + bloc(r.prompt, 6))
    }
  }
  return { yml: l.join('\n') + '\n', roles, aCompleter }
}

/**
 * Faut-il écrire ? Un kyber de même id existe déjà → on ne l'écrase JAMAIS en
 * silence : l'appelant doit le dire au testeur et proposer un autre nom.
 */
export const verdictInstallation = (existants, slug, { ecraser = false } = {}) => {
  const noms = Array.isArray(existants) ? existants.filter((n) => typeof n === 'string') : []
  const pris = noms.indexOf(slug) >= 0
  if (pris === true && ecraser !== true) return { action: 'refus', motif: 'un kyber « ' + slug + ' » existe deja', cible: slug }
  return { action: 'ecrire', motif: pris === true ? 'ecrasement demande explicitement' : 'nouveau kyber', cible: slug }
}
