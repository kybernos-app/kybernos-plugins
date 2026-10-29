// kybernos-contacts — the words of the page: which kinds of contact exist and which fields they carry.
//
// A theme says it through the point `kybernos/contacts#schema` (contacts-schema.mjs checks it); the registry hands back what the ACTIVE themes
// gave. The definitions are never stored with the rows: a row keeps the key of its type, and a key nobody defines any more is drawn as a plain
// person or company. Pure: the registry is passed in, and it is asked when a request comes, never at boot.
export const POINT_REF = 'kybernos/contacts#schema'
export const LIMITS = Object.freeze({ types: 36, fields: 40, tags: 40 })

const DEFAULT_TYPES = Object.freeze([
  Object.freeze({ key: 'person', kind: 'person', label: Object.freeze({ en: 'Person', fr: 'Personne' }) }),
  Object.freeze({ key: 'company', kind: 'company', label: Object.freeze({ en: 'Company', fr: 'Entreprise' }) }),
])
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const copy = (v) => JSON.parse(JSON.stringify(v))

/** What there is when no theme speaks: a person and a company, no field, no tag. */
export const defaultSchema = () => ({ themed: false, themes: [], types: copy(DEFAULT_TYPES), fields: [], tags: [] })

/**
 * Merges the contributions of the active themes (`{ plugin, file, value: { id, types, fields, tags } }`). The first theme to name a key keeps it;
 * a kind no theme gives a type for (a theme that only speaks of customers has no company type) gets the plain one, so the person can always
 * add either. Never throws; a contribution that is not what the registry promises is skipped.
 */
export function mergeSchema (contributions) {
  const list = Array.isArray(contributions) ? contributions : []
  const types = []
  const fields = []
  const tags = []
  const themes = []
  for (const c of list) {
    const v = plain(c) ? c.value : null
    if (!plain(v) || !Array.isArray(v.types)) continue
    if (typeof v.id === 'string' && themes.indexOf(v.id) < 0) themes.push(v.id)
    for (const t of v.types) if (plain(t) && typeof t.key === 'string' && types.length < LIMITS.types && !types.some((x) => x.key === t.key)) types.push(copy(t))
    for (const f of Array.isArray(v.fields) ? v.fields : []) if (plain(f) && typeof f.key === 'string' && fields.length < LIMITS.fields && !fields.some((x) => x.key === f.key)) fields.push(copy(f))
    for (const g of Array.isArray(v.tags) ? v.tags : []) if (typeof g === 'string' && tags.length < LIMITS.tags && tags.indexOf(g) < 0) tags.push(g)
  }
  if (themes.length === 0 && types.length === 0) return defaultSchema()
  for (const d of DEFAULT_TYPES) if (!types.some((t) => t.kind === d.kind)) types.push(copy(d))
  return { themed: true, themes, types, fields, tags }
}

/** The schema as the registry gives it now. `registry` is the seam (`Symbol.for('kybernos.registry')`), or null: the plain defaults. */
export function schemaFrom (registry) {
  try {
    if (registry === null || registry === undefined || typeof registry.contributions !== 'function') return defaultSchema()
    return mergeSchema(registry.contributions(POINT_REF))
  } catch (e) { return defaultSchema() }
}

/** The text of a label in a language, else English, else the key. */
export const labelOf = (label, lang, fallback) => (plain(label) ? String(label[lang] || label.en || fallback || '') : String(fallback || ''))

/** What an agent needs to write a row the page can show: the keys it may use, in English (the keys never change with the language). */
export function vocabulary (schema) {
  return {
    types: schema.types.map((t) => ({ key: t.key, kind: t.kind, label: labelOf(t.label, 'en', t.key) })),
    fields: schema.fields.map((f) => Object.assign({ key: f.key, type: f.type, label: labelOf(f.label, 'en', f.key) }, f.options === undefined ? {} : { options: f.options.slice() })),
    tags: schema.tags.slice(),
  }
}
