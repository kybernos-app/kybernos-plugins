// The plugin manifest validator (docs/dev/plugin-contract.md, section 4): the schema, then the rules a schema cannot say (4.4).
//
//   · `manifestErrors(manifest, ctx)`   one manifest against plugin.schema.json plus its own rules;
//   · `setErrors(manifests)`            rules across a set of manifests (ids, claims, dependency cycles);
//   · `firstPartyId(dir)`               the id a module of this repository gets from its folder name.
//
// The schema file is the single source of truth for the shape: it is read here and interpreted by schema-subset.mjs, so the shape and the
// validator cannot drift. A copy of the schema sits in docs/dev/schemas/ for people to read (test-registry.mjs keeps the two identical).
// Nothing here touches the network; the only disk access is reading the schema once. It runs in DSH (the registry) and in the dev scripts.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, validate } from './schema-subset.mjs'
import { compareVersions as comparerVersions } from './version.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const SCHEMA_FILE = join(HERE, 'plugin.schema.json')
const SCHEMA = JSON.parse(readFileSync(SCHEMA_FILE, 'utf8'))
/** Namespaces nobody may claim by themselves: `kybernos` is ours, `dsh` is the engine's, `local` is a folder on the person's machine. */
export const RESERVED_NAMESPACES = ['kybernos', 'dsh', 'local']

/** `kybernos-plugin` → `kybernos/core`, `kybernos-hub` → `kybernos/hub`, `dsh-mermaid` → `kybernos/dsh-mermaid` (contract, 4.3). */
export function firstPartyId (dir) {
  if (dir === 'kybernos-plugin') return 'kybernos/core'
  if (dir.startsWith('kybernos-')) return 'kybernos/' + dir.slice('kybernos-'.length)
  return 'kybernos/' + dir
}

const inZone = (v, zone) => comparerVersions(v, zone.min) >= 0 && comparerVersions(v, zone.max) <= 0
/** A regular expression a vendor writes for its key. It must compile, and must not nest quantifiers (catastrophic backtracking). */
function keyFormatFault (format) {
  try { new RegExp(format, 'u') } catch (e) { return 'is not a valid regular expression' } // eslint-disable-line no-new
  if (/\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)[+*{]/.test(format)) return 'nests a quantifier inside a repeated group (not linear-time)'
  return null
}
const netHosts = (permissions) => (permissions ?? []).filter((p) => p.startsWith('net:')).map((p) => p.slice(4))

/**
 * @param {object} manifest   the parsed plugin.json
 * @param {object} [ctx]      what the caller knows, each part optional (a rule whose input is missing is skipped):
 *   firstParty  boolean       the plugin is a module of this repository (it may use the `kybernos` namespace and a `suite` block)
 *   local       boolean       the plugin is a folder placed on the machine (it may use the `local` namespace)
 *   dir         string        the folder name under packages/ (the first-party id must follow it)
 *   packageJson object        the parsed package.json (version, name, exports must agree)
 *   suiteZone   {min,max}     dsh-compat.json's `dsh` (a first-party zone must lie inside it)
 *   fileExists  (rel) => bool files of the plugin folder
 * @returns {string[]} the faults, empty when the manifest is acceptable
 */
export function manifestErrors (manifest, ctx = {}) {
  const errors = describe(validate(SCHEMA, manifest))
  if (errors.length > 0) return errors // the rules below assume the shape
  const m = manifest
  const fault = (s) => errors.push(s)
  const [namespace] = m.id.split('/')

  // 1. the namespace is the author's, and the reserved ones are not up for grabs
  if (m.author.id !== namespace) fault('author.id "' + m.author.id + '" is not the namespace of id "' + m.id + '"')
  if (namespace === 'dsh') fault('the namespace "dsh" is reserved for the engine')
  if (namespace === 'kybernos' && ctx.firstParty !== true) fault('the namespace "kybernos" is reserved for the modules of this repository')
  if (namespace === 'local' && ctx.local !== true) fault('the namespace "local" is reserved for a folder placed on this machine')
  if (m.suite !== undefined && ctx.firstParty !== true) fault('"suite" belongs to the modules of this repository')

  // 2. a code plugin and its package.json say the same thing
  if (ctx.packageJson !== undefined && m.kind === 'code') {
    if (m.version !== ctx.packageJson.version) fault('version "' + m.version + '" differs from package.json "' + ctx.packageJson.version + '"')
    if (m.package !== ctx.packageJson.name) fault('package "' + m.package + '" differs from package.json name "' + ctx.packageJson.name + '"')
    const exp = ctx.packageJson.exports ?? {}
    const file = (sub) => (typeof exp[sub] === 'string' ? exp[sub].replace(/^\.\//, '') : undefined)
    if (m.entry.host !== undefined && m.entry.host !== file('.')) fault('entry.host "' + m.entry.host + '" is not the "." export of package.json (' + file('.') + ')')
    if (m.entry.client !== undefined && m.entry.client !== file('./client')) fault('entry.client "' + m.entry.client + '" is not the "./client" export of package.json (' + file('./client') + ')')
    for (const [sub, path] of Object.entries(m.entry.extra ?? {})) if (path !== file(sub)) fault('entry.extra "' + sub + '" is "' + path + '", package.json exports ' + file(sub))
  }
  if (ctx.dir !== undefined && ctx.firstParty === true && m.id !== firstPartyId(ctx.dir)) fault('id "' + m.id + '" should be "' + firstPartyId(ctx.dir) + '" for the folder ' + ctx.dir)
  if (ctx.fileExists !== undefined) {
    for (const rel of [m.entry?.host, m.entry?.client, ...Object.values(m.entry?.extra ?? {}), m.help, ...(m.provides ?? []).map((p) => p.schema)]) {
      if (typeof rel === 'string' && !ctx.fileExists(rel)) fault('the file "' + rel + '" named by the manifest does not exist')
    }
  }
  if (ctx.firstParty === true && m.kind === 'code' && m.help === undefined) fault('a module of this repository needs a help card ("help")')

  // 3. points: unique names; a data point is checked by a schema OR by a validator the owner registers, never neither, never both
  const names = (m.provides ?? []).map((p) => p.name)
  if (new Set(names).size !== names.length) fault('provides lists a point name twice')
  for (const p of m.provides ?? []) if (p.kind === 'data' && (p.schema === undefined) === (p.validator === undefined)) fault('provides "' + p.name + '": a data point has exactly one of schema and validator')

  // 4. you cannot extend what you do not depend on
  for (const e of m.extends ?? []) {
    const owner = e.point.split('#')[0]
    if (owner !== m.id && (m.requires.plugins ?? {})[owner] === undefined) fault('extends "' + e.point + '" but "' + owner + '" is not in requires.plugins')
  }

  // 5. every route prefix a permission opens is a prefix the plugin claims
  for (const p of m.permissions ?? []) {
    const r = /^host\.routes:(\/[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)?):(?:read|write)$/.exec(p)
    if (r !== null && !(m.claims?.routePrefixes ?? []).includes(r[1])) fault('permission "' + p + '" needs the prefix ' + r[1] + ' in claims.routePrefixes')
  }

  // 6. the key goes to hosts the plugin declared, and its shape check is safe to run
  const key = m.commerce?.key
  if (key !== undefined) {
    const declared = netHosts(m.permissions)
    for (const h of key.hosts) if (!declared.includes(h)) fault('commerce.key.hosts "' + h + '" is not among the net: permissions')
    if (key.format !== undefined) { const f = keyFormatFault(key.format); if (f !== null) fault('commerce.key.format ' + f) }
    if (!(m.permissions ?? []).includes('secrets.own') && m.kind === 'code') fault('a code plugin that stores a key must declare secrets.own')
  }

  // 7. the free side of a paid plugin is stated, and is not the paid side
  if (m.commerce !== undefined && m.commerce.worksWithout.en.trim().toLowerCase() === m.commerce.unlocks.en.trim().toLowerCase()) fault('commerce.worksWithout repeats commerce.unlocks')

  // 8. compatibility: a first-party zone lies inside the suite zone, and what was tested lies inside the plugin's zone
  const zone = m.requires.dsh ?? (ctx.firstParty === true ? ctx.suiteZone : undefined)
  if (m.requires.dsh !== undefined) {
    if (comparerVersions(m.requires.dsh.min, m.requires.dsh.max) > 0) fault('requires.dsh min is above max')
    if (ctx.firstParty === true && ctx.suiteZone !== undefined && !(inZone(m.requires.dsh.min, ctx.suiteZone) && inZone(m.requires.dsh.max, ctx.suiteZone))) fault('requires.dsh lies outside the zone of dsh-compat.json')
  }
  if (zone !== undefined) for (const v of m.tested?.dsh ?? []) if (!inZone(v, zone)) fault('tested.dsh "' + v + '" lies outside the zone')

  // 9. an engine patch is a first-party legacy
  if ((m.permissions ?? []).includes('engine.patch') && namespace !== 'kybernos') fault('engine.patch is for the "kybernos" namespace only')
  return errors
}

/** Rules across the manifests of one installed set. Keys are the ids. */
export function setErrors (manifests) {
  const errors = []
  const byId = new Map()
  for (const m of manifests) {
    if (byId.has(m.id)) errors.push('the id "' + m.id + '" appears twice')
    byId.set(m.id, m)
  }
  for (const claim of ['cssPrefix', 'routePrefixes', 'slotIds']) {
    const seen = new Map()
    for (const m of manifests) for (const v of [].concat(m.claims?.[claim] ?? [])) {
      if (seen.has(v) && seen.get(v) !== m.id) errors.push('claims.' + claim + ' "' + v + '" is taken by both "' + seen.get(v) + '" and "' + m.id + '"')
      seen.set(v, m.id)
    }
  }
  // dependencies among the plugins of the set: no cycle, depth at most 4 (a dependency outside the set is a runtime status, not a fault)
  const depth = (id, trail) => {
    if (trail.includes(id)) { errors.push('dependency cycle: ' + [...trail, id].join(' → ')); return 0 }
    const m = byId.get(id)
    if (m === undefined) return 0
    return 1 + Math.max(0, ...Object.keys(m.requires?.plugins ?? {}).map((d) => depth(d, [...trail, id])))
  }
  for (const m of manifests) if (depth(m.id, []) > 4) errors.push('"' + m.id + '" depends on a chain longer than 4 plugins')
  return [...new Set(errors)]
}
