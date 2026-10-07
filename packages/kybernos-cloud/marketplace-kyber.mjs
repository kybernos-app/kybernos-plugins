/**
 * marketplace-kyber.mjs — the remote catalogue of kybernos.app, plugin side.
 *
 * WHY THIS FILE EXISTS
 * The platform serves `GET /v1/marketplace`: published kybers with their public
 * manifest (`name, cat, pitch, glyph, color, agents, version`; the private keys
 * `data_schemas`, `source_kyber_id`, `price` are removed server side). The plugin
 * used to show a hard-coded local catalogue whose « 1.2k installs » counters and
 * prices were made up. This module is the pure half of the receiving path: normalise
 * what the platform sends, and turn an item into a `kyber.yml` in the format the
 * plugin really reads.
 *
 * WHAT IT REFUSES TO DO
 * Invent. A manifest gives `agents` (`role_key`, `name`, `does`, `model_route`,
 * `tools`) while a local `kyber.yml` expects roles (`id`, `kind`, `needs`,
 * `provider`, `model`, `prompt`) and `stages`. Two bridges exist, the id and the
 * prompt, and only one is solid: `does` is the prompt, `role_key` gives the id.
 * `model_route` (« kybernos/doer ») is a platform route, NOT a provider/model
 * pair: it is not translated, it is written as is under `route:` (the plugin's
 * reader ignores the keys it does not know) and LISTED in `aCompleter`. Same for
 * stages: the catalogue publishes none, none are made up.
 *
 * An empty `aCompleter` is therefore the only proof that a received kyber is
 * complete.
 *
 * THE kyber.yml WRITTEN HERE MUST BE REAL YAML
 * Every scalar goes through `scalaire` / `scalaireFlux`: plain when it is provably
 * safe, else double-quoted with exact escapes. The plugin's own reader
 * (`parseKyber` in kybernos-plugin, `unquote` and `inlineList`) decodes exactly
 * those escapes: test-marketplace-kyber.mjs holds the round trip.
 */

/** The keys the platform already removes: they are removed here too, on principle. */
export const CLES_PRIVEES = ['data_schemas', 'source_kyber_id', 'price']

/** A local identifier: lower case, dashes, never empty. */
export const slugifier = (v) => String(v === null || v === undefined ? '' : v)
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/** `custom:manager` → `manager`: the platform's prefix is not a local id. */
export const idDeRole = (roleKey) => slugifier(String(roleKey === null || roleKey === undefined ? '' : roleKey).replace(/^[a-z]+:/i, ''))

/**
 * Normalises the answer of `GET /v1/marketplace`.
 * Returns `{ ok, items, motif }`: an empty catalogue is never « ok » without a reason.
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
    // Defence in depth: the platform already removes these keys, they are not carried any further.
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

// ── YAML scalars ────────────────────────────────────────────────────────────
// A `kyber.yml` is read by more than the plugin (DSH's engine, the app, anyone's editor), so every value written must
// mean the same thing to a real YAML parser. Two ways to write a one-line value: PLAIN when nothing in it can be taken
// for YAML syntax or for another type, else DOUBLE-QUOTED with exact escapes (the only style that can carry anything).

/** The characters a YAML file may carry as they are, and that nothing in a kyber.yml needs to see escaped. */
const AFFICHABLE = /^[\x20-\x7e\u{a0}-\u{2027}\u{202a}-\u{d7ff}\u{e000}-\u{fefe}\u{ff00}-\u{fffd}\u{10000}-\u{10ffff}]*$/u

/** First characters that mean something to YAML (an indicator, a quote, a directive, a tag, an alias, an anchor...). */
const DEBUT_YAML = /^[-?:,[\]{}#&*!|>'"%@`]/

/**
 * What a plain scalar would resolve to instead of a string: null, a boolean (YAML 1.1 words included), a number in any
 * of its notations (decimal, float, `_` separators, hex, octal, binary, sexagesimal, infinity, nan), a date, or the
 * merge and value markers.
 */
const AUTRE_TYPE = new RegExp(
  '^(?:~|null|true|false|yes|no|on|off|y|n|<<|=)$'
  + '|^[-+]?(?:\\d[\\d_]*(?:\\.[\\d_]*)?(?:e[-+]?\\d+)?|\\.\\d[\\d_]*(?:e[-+]?\\d+)?|\\.(?:inf|nan))$'
  + '|^[-+]?0(?:x[0-9a-f_]+|o?[0-7_]+|b[01_]+)$'
  + '|^[-+]?[1-9][\\d_]*(?::[0-5]?\\d)+(?:\\.[\\d_]*)?$'
  + '|^\\d{4}-\\d{1,2}-\\d{1,2}',
  'i',
)

const simple = (t) => t !== '' && t === t.trim() && AFFICHABLE.test(t)
  && DEBUT_YAML.test(t) === false && /: |:$| #/.test(t) === false && AUTRE_TYPE.test(t) === false

/**
 * `t` between double quotes with exact escapes: `\\`, `\"`, `\n`, `\r`, `\t`, then `\xNN` / `\uNNNN` for anything a
 * YAML file may not carry as it is (controls, DEL, the C1 controls, NEL, the line and paragraph separators, the byte
 * order mark, non-characters, half of a surrogate pair). Accents and emoji stay as they are.
 */
const citer = (t) => {
  let out = '"'
  for (const ch of String(t)) {
    if (ch === '\\') out += '\\\\'
    else if (ch === '"') out += '\\"'
    else if (ch === '\n') out += '\\n'
    else if (ch === '\r') out += '\\r'
    else if (ch === '\t') out += '\\t'
    else if (AFFICHABLE.test(ch)) out += ch
    else {
      const code = ch.codePointAt(0)
      out += code <= 0xff ? '\\x' + code.toString(16).toUpperCase().padStart(2, '0') : '\\u' + code.toString(16).toUpperCase().padStart(4, '0')
    }
  }
  return out + '"'
}

/** A one-line value (`key: <here>`): plain when safe, else double-quoted. Anything is accepted and comes back as it was. */
export const scalaire = (valeur) => {
  const t = String(valeur === null || valeur === undefined ? '' : valeur)
  return simple(t) === true ? t : citer(t)
}

/** An item of a flow list (`[a, b]`): like `scalaire`, and a plain item never holds `,` `[` `]` `{` `}` or `:`. */
export const scalaireFlux = (valeur) => {
  const t = String(valeur === null || valeur === undefined ? '' : valeur)
  return simple(t) === true && /[,[\]{}:]/.test(t) === false ? t : citer(t)
}

/**
 * A text that may run over several lines (the pitch, what an agent does), as the lines to write under `<cle>:` at
 * `indent` spaces (the indentation of the key). As a folded block (`>-`) when YAML can carry it literally, which is
 * the readable form; else as one double-quoted line with exact escapes (a first line that starts with a space would
 * lose it in a block, and a block cannot carry a control character or a line separator that is not `\n`).
 * Blank text is never written: the caller says « not published » itself.
 */
export const lignesDeTexte = (cle, texte, indent) => {
  const pad = ' '.repeat(indent)
  const t = String(texte).replace(/\r\n?/g, '\n').replace(/^\n+/, '').replace(/\s+$/, '')
  const premiere = t.split('\n')[0]
  if (AFFICHABLE.test(t.replace(/\n/g, '')) === false || /^[ \t]/.test(premiere) === true) return [pad + cle + ': ' + citer(t)]
  return [pad + cle + ': >-'].concat(t.split('\n').map((l) => (l.trim() === '' ? '' : pad + '  ' + l)))
}

/**
 * A local `kyber.yml` from an entry of the catalogue.
 * Returns `{ yml, roles, aCompleter }`: `aCompleter` says what the platform does not provide and what the tester will
 * have to write.
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
    const prompt = typeof a.does === 'string' && a.does.trim() !== '' ? a.does : null
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
  const mission = typeof item.pitch === 'string' && item.pitch.trim() !== '' ? item.pitch : null
  if (mission === null) aCompleter.push('aucune mission publiee par le catalogue')
  const sansRoute = roles.filter((r) => r.route === null).map((r) => r.id)
  if (sansRoute.length > 0) aCompleter.push('sans route de modele : ' + sansRoute.join(', '))
  const routes = roles.filter((r) => r.route !== null)
  if (routes.length > 0) {
    aCompleter.push('la route de modele de la plateforme n\'est pas un couple provider/modele : '
      + routes.map((r) => r.id + '→' + r.route).join(', ') + ' — choisir provider/model localement')
  }
  aCompleter.push('les etapes (stages) ne sont pas publiees par le catalogue : les declarer localement')

  const l = []
  l.push('id: ' + scalaire(item.slug))
  l.push('specVersion: 2')
  l.push('name: ' + scalaire(item.name === undefined || item.name === '' ? item.slug : item.name))
  if (item.cat !== undefined && item.cat !== '') l.push('categorie: ' + scalaire(item.cat))
  if (item.glyph !== undefined && item.glyph !== '') l.push('glyphe: ' + scalaire(item.glyph))
  if (item.color !== undefined && item.color !== '') l.push('couleur: ' + scalaire(item.color))
  l.push('origine: ' + scalaire('kybernos.app/' + item.slug))
  l.push('')
  for (const ligne of lignesDeTexte('mission', mission === null ? '(mission non publiee)' : mission, 0)) l.push(ligne)
  l.push('')
  l.push('roles:')
  for (const r of roles) {
    l.push('  - id: ' + scalaire(r.id))
    if (r.route !== null) l.push('    route: ' + scalaire(r.route))
    if (r.tools.length > 0) l.push('    tools: [' + r.tools.map(scalaireFlux).join(', ') + ']')
    if (r.prompt !== null) for (const ligne of lignesDeTexte('prompt', r.prompt, 4)) l.push(ligne)
  }
  return { yml: l.join('\n') + '\n', roles, aCompleter }
}

/**
 * Do we write? A kyber with the same id already exists → it is NEVER overwritten silently: the caller must say so to
 * the tester and offer another name.
 */
export const verdictInstallation = (existants, slug, { ecraser = false } = {}) => {
  const noms = Array.isArray(existants) ? existants.filter((n) => typeof n === 'string') : []
  const pris = noms.indexOf(slug) >= 0
  if (pris === true && ecraser !== true) return { action: 'refus', motif: 'un kyber « ' + slug + ' » existe deja', cible: slug }
  return { action: 'ecrire', motif: pris === true ? 'ecrasement demande explicitement' : 'nouveau kyber', cible: slug }
}
