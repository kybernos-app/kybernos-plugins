// The registry rules of the Servers page: names, ids and duplicates. Pure (no disk, no network): the host half reads and writes the file
// (<DSH home>/kybernos/servers.json) and calls these. The open half (kybernos-cloud, `server-profile.mjs`) stays the judge of a profile.
export const BUILTIN_ID = 'kybernos-cloud'
export const ID = /^[a-z0-9][a-z0-9-]{0,39}$/
export const MAX_NAME = 60

/** A name as it may be shown and stored: single spaces, no control characters, no angle brackets, at most 60 characters. */
export const cleanName = (value) => (typeof value === 'string'
  // eslint-disable-next-line no-control-regex
  ? value.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME)
  : '')

/** Two spellings of one address are one server: scheme, lower-case host, port and path without a trailing slash. */
export const normalizeApi = (api) => {
  try { const u = new URL(api); return u.origin + u.pathname.replace(/\/+$/, '') } catch (e) { return String(api) }
}

/** The entry (of `[{ id, api, … }]`) whose address is the same as `api`, or undefined. */
export const findByApi = (servers, api) => {
  const want = normalizeApi(api)
  return (Array.isArray(servers) ? servers : []).find((s) => s !== null && typeof s === 'object' && typeof s.api === 'string' && normalizeApi(s.api) === want)
}

const sameName = (a, b) => a.toLowerCase() === b.toLowerCase()

/** The name proposed for a discovered server: its published name, except that « Kybernos » (what every Kybernos server answers by default) and a
 *  name already in the list become « <name> · <host> », so two servers never look alike. */
export const suggestName = (published, host, existingNames) => {
  const base = cleanName(published) || cleanName(host)
  const taken = (Array.isArray(existingNames) ? existingNames : []).filter((n) => typeof n === 'string')
  if (sameName(base, 'Kybernos') || taken.some((n) => sameName(n, base))) return cleanName(base + ' · ' + host) || base
  return base
}

/** A name the person chose is kept as typed, with « (2) », « (3) »… when it is already taken. Empty after cleaning → ''. */
export const uniqueName = (name, existingNames) => {
  const base = cleanName(name)
  if (base === '') return ''
  const taken = (Array.isArray(existingNames) ? existingNames : []).filter((n) => typeof n === 'string')
  let out = base
  for (let n = 2; taken.some((t) => sameName(t, out)); n += 1) out = base.slice(0, MAX_NAME - String(n).length - 3) + ' (' + n + ')'
  return out
}

/** A free id derived from `base` (a slug): `base`, then `base-2`, `base-3`… never one of `taken`, never the built-in id, at most 40 characters. */
export const uniqueId = (base, taken) => {
  const used = new Set((Array.isArray(taken) ? taken : []).concat([BUILTIN_ID]))
  let id = ID.test(base) ? base : 'server'
  for (let n = 2; used.has(id); n += 1) id = base.slice(0, 40 - String(n).length - 1) + '-' + n
  return id
}

/** The registry as an object `{ active, servers }` with a profile added / renamed / removed. Never mutates its argument.
 *  Removing the active server makes the built-in one active (the way back is always there). */
export const withProfile = (registry, profile) => ({ active: registry.active, servers: registry.servers.concat([profile]) })
export const withName = (registry, id, name) => ({ active: registry.active, servers: registry.servers.map((s) => (s !== null && typeof s === 'object' && s.id === id ? Object.assign({}, s, { name }) : s)) })
export const without = (registry, id) => ({ active: registry.active === id ? BUILTIN_ID : registry.active, servers: registry.servers.filter((s) => !(s !== null && typeof s === 'object' && s.id === id)) })
