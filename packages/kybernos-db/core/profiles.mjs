// Profiles: what a team member may do in an app, as data. Pure.
//
// A profile is `{ id, label, grants }`; a grant is `{ object, do, fields? }`. The rules are additive and default-deny: a profile sees and touches only the tables it has a grant
// for, and inside a table only what the grant gives. `do` is a list of `read`, `create` and `update`; **`delete` is not a verb here**: a member never deletes, and never changes the
// structure (fields, tables, views), whatever a profile says. `fields` maps a field key to `hidden`, `read` or `write` and wins over the default of the grant:
//   - a `normal` field is `write` when the grant can create or update, else `read`;
//   - a `personal` field is `hidden` until the grant names it;
//   - a `sensitive` or `secret` field is `hidden` always (an app that holds one is not published).
// The owner is built in and has no profile: `owner` is a reserved id.
//
// The profiles of an app live in its catalogue (store/db.mjs), so the page, the agent and the hosted app read the same rules, and `can()` (rights.mjs) answers from them.

import { PROTECTION } from './types.mjs'
import { isPlain } from './text.mjs'

export const GRANT_DO = Object.freeze(['read', 'create', 'update'])
export const FIELD_ACCESS = Object.freeze(['hidden', 'read', 'write'])
export const PROFILE_ID = /^[a-z][a-z0-9_-]{0,23}$/
export const RESERVED_IDS = Object.freeze(['owner'])
export const PROFILE_LIMITS = Object.freeze({ profiles: 8, grants: 60 })

const CONTROL = /[\u0000-\u001f\u007f]/
const onlyKeys = (raw, allowed, path, fail) => { for (const k of Object.keys(raw)) if (!allowed.includes(k)) fail(path ? path + '.' + k : k, 'unknown-key', 'not a property here') }

/**
 * Checks a list of profiles against the objects of the app (`[{ key, fields: [{ key }] }]`, archived ones included) and returns `{ ok: true, profiles }` (a copy, defaults filled)
 * or `{ ok: false, errors: [{ path, code, message }] }`. Without `objects` only the shape is checked.
 */
export function normalizeProfiles (list, objects) {
  const errors = []
  const fail = (path, code, message) => errors.push({ path, code, message })
  const known = Array.isArray(objects) ? new Map(objects.filter(isPlain).map((o) => [o.key, new Set((Array.isArray(o.fields) ? o.fields : []).map((f) => f.key))])) : null
  const out = []
  if (!Array.isArray(list)) return { ok: false, errors: [{ path: '', code: 'shape', message: 'profiles are a list' }] }
  if (list.length > PROFILE_LIMITS.profiles) fail('', 'too-many', 'at most ' + PROFILE_LIMITS.profiles + ' profiles')
  const ids = new Set()
  list.slice(0, PROFILE_LIMITS.profiles).forEach((p, i) => {
    const at = String(i)
    if (!isPlain(p)) { fail(at, 'shape', 'a profile is an object'); return }
    onlyKeys(p, ['id', 'label', 'grants'], at, fail)
    if (typeof p.id !== 'string' || !PROFILE_ID.test(p.id)) fail(at + '.id', 'id', 'an id is lower-case letters, digits, - and _, starting with a letter, 24 at most')
    else if (RESERVED_IDS.includes(p.id)) fail(at + '.id', 'reserved', '"' + p.id + '" is built in: the owner has no profile')
    else if (ids.has(p.id)) fail(at + '.id', 'duplicate', 'two profiles share this id')
    else ids.add(p.id)
    const label = typeof p.label === 'string' ? p.label.trim() : ''
    if (label.length < 1 || label.length > 60 || CONTROL.test(label)) fail(at + '.label', 'label', 'a label is 1 to 60 characters')
    const grants = []
    if (!Array.isArray(p.grants)) fail(at + '.grants', 'grants', 'grants are a list')
    else if (p.grants.length > PROFILE_LIMITS.grants) fail(at + '.grants', 'too-many', 'at most ' + PROFILE_LIMITS.grants + ' grants')
    else {
      const seen = new Set()
      p.grants.forEach((g, j) => {
        const gat = at + '.grants.' + j
        if (!isPlain(g)) { fail(gat, 'shape', 'a grant is an object'); return }
        onlyKeys(g, ['object', 'do', 'fields'], gat, fail)
        if (typeof g.object !== 'string' || g.object === '') { fail(gat + '.object', 'object', 'a grant names a table'); return }
        if (known !== null && !known.has(g.object)) { fail(gat + '.object', 'unknown-object', 'no such table in this app: ' + g.object); return }
        if (seen.has(g.object)) { fail(gat + '.object', 'duplicate', 'two grants for one table'); return }
        seen.add(g.object)
        let verbs = []
        if (!Array.isArray(g.do) || g.do.length < 1) fail(gat + '.do', 'do', 'a grant gives at least one of ' + GRANT_DO.join(', '))
        else if (g.do.includes('delete')) fail(gat + '.do', 'never-delete', 'a member never deletes: delete is not a verb of a grant')
        else if (g.do.some((v) => !GRANT_DO.includes(v))) fail(gat + '.do', 'do', 'the verbs are ' + GRANT_DO.join(', '))
        else verbs = GRANT_DO.filter((v) => g.do.includes(v))
        let fields
        if (g.fields !== undefined) {
          if (!isPlain(g.fields)) fail(gat + '.fields', 'fields', 'fields map a field key to ' + FIELD_ACCESS.join(', '))
          else {
            fields = {}
            for (const [k, v] of Object.entries(g.fields)) {
              if (!FIELD_ACCESS.includes(v)) fail(gat + '.fields.' + k, 'access', 'one of ' + FIELD_ACCESS.join(', '))
              else if (known !== null && !known.get(g.object).has(k)) fail(gat + '.fields.' + k, 'unknown-field', 'no such field in this table')
              else fields[k] = v
            }
          }
        }
        grants.push({ object: g.object, do: verbs, ...(fields === undefined ? {} : { fields }) })
      })
    }
    out.push({ id: typeof p.id === 'string' ? p.id : '', label, grants })
  })
  return errors.length === 0 ? { ok: true, profiles: out } : { ok: false, errors }
}

/** The profile with that id, or undefined (the owner has none). */
export const profileOf = (profiles, id) => (Array.isArray(profiles) && typeof id === 'string' ? profiles.find((p) => isPlain(p) && p.id === id) : undefined)

/** What a profile's grant on a table is, or undefined: it has none and so sees nothing of the table. */
export const grantOf = (profile, object) => (isPlain(profile) && Array.isArray(profile.grants) && typeof object === 'string' ? profile.grants.find((g) => isPlain(g) && g.object === object) : undefined)

/** Whether the grant may update records: by the verb, or because one of its fields is writable on its own. */
export const grantUpdates = (grant) => isPlain(grant) && ((Array.isArray(grant.do) && grant.do.includes('update')) || (isPlain(grant.fields) && Object.values(grant.fields).includes('write')))

/** `hidden`, `read` or `write`: what a profile may do with one field (`{ key, protection }`) of a table. */
export function fieldAccess (profile, object, field) {
  const grant = grantOf(profile, object)
  if (grant === undefined || !isPlain(field)) return 'hidden'
  const level = PROTECTION.includes(field.protection) ? field.protection : 'normal'
  if (level === 'sensitive' || level === 'secret') return 'hidden'
  const named = isPlain(grant.fields) ? grant.fields[field.key] : undefined
  if (FIELD_ACCESS.includes(named)) return named
  if (level === 'personal') return 'hidden'
  return Array.isArray(grant.do) && (grant.do.includes('create') || grant.do.includes('update')) ? 'write' : 'read'
}
