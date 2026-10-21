// A small JSON Schema interpreter: the subset the plugin contract allows (docs/dev/plugin-contract.md, 6.3).
//
// Why it exists: this repository has no dependency, and a data plugin's point schema is written by someone else, so the validator must be
// short enough to read and must refuse what it does not understand. Nothing here touches the disk or the network.
//
// Supported: type, const, enum, pattern, minLength, maxLength, minimum, maximum, items, minItems, maxItems, uniqueItems, properties,
// additionalProperties (false or a schema), required, propertyNames, minProperties, maxProperties, allOf, anyOf, oneOf, not, if/then/else,
// and $ref to a place in the same document ("#/$defs/name"). Annotations ($schema, $id, $comment, title, description, $defs, default,
// examples) are ignored. ANY OTHER KEYWORD THROWS: a schema that leans on something outside the subset is a bad schema, not a lenient one.
const ANNOTATIONS = new Set(['$schema', '$id', '$comment', 'title', 'description', '$defs', 'default', 'examples'])
const KEYWORDS = new Set([
  'type', 'const', 'enum', 'pattern', 'minLength', 'maxLength', 'minimum', 'maximum', 'items', 'minItems', 'maxItems', 'uniqueItems',
  'properties', 'additionalProperties', 'required', 'propertyNames', 'minProperties', 'maxProperties',
  'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else', '$ref'
])

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const typeIs = (t, v) => {
  if (t === 'null') return v === null
  if (t === 'array') return Array.isArray(v)
  if (t === 'object') return plain(v)
  if (t === 'integer') return Number.isInteger(v)
  if (t === 'number') return typeof v === 'number' && Number.isFinite(v)
  return typeof v === t // string, boolean
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const regexes = new Map()
const regex = (p) => { let r = regexes.get(p); if (r === undefined) { r = new RegExp(p, 'u'); regexes.set(p, r) } return r }
const where = (path) => (path === '' ? '(root)' : path)

function resolve (root, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) throw new Error('schema-subset: only local references ("#/…") are supported: ' + String(ref))
  let node = root
  for (const part of ref.slice(2).split('/')) {
    node = node?.[part.replace(/~1/g, '/').replace(/~0/g, '~')]
    if (node === undefined) throw new Error('schema-subset: unresolved reference ' + ref)
  }
  return node
}

function run (schema, value, path, root, out, depth) {
  if (depth > 64) throw new Error('schema-subset: schema nests too deeply')
  if (schema === true) return
  if (schema === false) { out.push({ path, message: 'is not allowed' }); return }
  if (!plain(schema)) throw new Error('schema-subset: a schema is an object or a boolean')
  for (const k of Object.keys(schema)) if (!KEYWORDS.has(k) && !ANNOTATIONS.has(k)) throw new Error('schema-subset: unsupported keyword "' + k + '"')
  const ok = (s, v) => { const o = []; run(s, v, path, root, o, depth + 1); return o.length === 0 }
  const fail = (message) => out.push({ path, message })

  if (schema.$ref !== undefined) run(resolve(root, schema.$ref), value, path, root, out, depth + 1)
  if (schema.const !== undefined && !same(schema.const, value)) fail('must be ' + JSON.stringify(schema.const))
  if (schema.enum !== undefined && !schema.enum.some((e) => same(e, value))) fail('must be one of ' + JSON.stringify(schema.enum))
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!types.some((t) => typeIs(t, value))) { fail('must be of type ' + types.join(' or ')); return }
  }

  if (typeof value === 'string') {
    const length = Array.from(value).length
    if (schema.minLength !== undefined && length < schema.minLength) fail('is shorter than ' + schema.minLength)
    if (schema.maxLength !== undefined && length > schema.maxLength) fail('is longer than ' + schema.maxLength)
    if (schema.pattern !== undefined && !regex(schema.pattern).test(value)) fail('does not match ' + schema.pattern)
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) fail('is below ' + schema.minimum)
    if (schema.maximum !== undefined && value > schema.maximum) fail('is above ' + schema.maximum)
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) fail('has fewer than ' + schema.minItems + ' items')
    if (schema.maxItems !== undefined && value.length > schema.maxItems) fail('has more than ' + schema.maxItems + ' items')
    if (schema.uniqueItems === true && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) fail('has a repeated item')
    if (schema.items !== undefined) value.forEach((v, i) => run(schema.items, v, path + '/' + i, root, out, depth + 1))
  }
  if (plain(value)) {
    const keys = Object.keys(value)
    if (schema.minProperties !== undefined && keys.length < schema.minProperties) fail('has fewer than ' + schema.minProperties + ' keys')
    if (schema.maxProperties !== undefined && keys.length > schema.maxProperties) fail('has more than ' + schema.maxProperties + ' keys')
    for (const k of schema.required ?? []) if (!Object.prototype.hasOwnProperty.call(value, k)) fail('"' + k + '" is required')
    if (schema.propertyNames !== undefined) for (const k of keys) run(schema.propertyNames, k, path + '/' + k, root, out, depth + 1)
    const known = schema.properties ?? {}
    for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(known, k)) run(known[k], value[k], path + '/' + k, root, out, depth + 1)
      else if (schema.additionalProperties === false) out.push({ path: path + '/' + k, message: 'is not a known key' })
      else if (plain(schema.additionalProperties)) run(schema.additionalProperties, value[k], path + '/' + k, root, out, depth + 1)
    }
  }

  for (const s of schema.allOf ?? []) run(s, value, path, root, out, depth + 1)
  if (schema.anyOf !== undefined && !schema.anyOf.some((s) => ok(s, value))) fail('matches none of the allowed shapes')
  if (schema.oneOf !== undefined && schema.oneOf.filter((s) => ok(s, value)).length !== 1) fail('must match exactly one of the allowed shapes')
  if (schema.not !== undefined && ok(schema.not, value)) fail('matches a shape that is not allowed here')
  if (schema.if !== undefined) {
    if (ok(schema.if, value)) { if (schema.then !== undefined) run(schema.then, value, path, root, out, depth + 1) } else if (schema.else !== undefined) run(schema.else, value, path, root, out, depth + 1)
  }
}

/** @returns {{ path: string, message: string }[]} empty when `value` satisfies `schema`. Throws on a schema outside the subset. */
export function validate (schema, value) {
  const out = []
  run(schema, value, '', schema, out, 0)
  return out
}

/** One line per error: "/permissions/0 does not match …". */
export const describe = (errors) => errors.map((e) => where(e.path) + ' ' + e.message)

/** Every keyword of the whole schema that the subset does not understand, with its place. Empty = the schema stays inside the subset (also in the branches a given value never reaches). */
export function unsupportedKeywords (schema, path = '') {
  if (!plain(schema)) return []
  const out = []
  for (const k of Object.keys(schema)) if (!KEYWORDS.has(k) && !ANNOTATIONS.has(k)) out.push(path + '/' + k)
  for (const k of ['properties', '$defs']) for (const [name, sub] of Object.entries(schema[k] ?? {})) out.push(...unsupportedKeywords(sub, path + '/' + k + '/' + name))
  for (const k of ['items', 'additionalProperties', 'propertyNames', 'not', 'if', 'then', 'else']) out.push(...unsupportedKeywords(schema[k], path + '/' + k))
  for (const k of ['allOf', 'anyOf', 'oneOf']) (schema[k] ?? []).forEach((sub, i) => out.push(...unsupportedKeywords(sub, path + '/' + k + '/' + i)))
  return out
}
