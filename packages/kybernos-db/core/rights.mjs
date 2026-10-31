// Who may do what: the one function every door of the engine asks, `can()`. Pure.
//
// Phase A has one person and their agents, so the rule is short:
//   - the owner (the person at the screen) may do everything; a field that is not `normal` is shown masked until they reveal it;
//   - the owner's agent (Kaby) reads and writes records and views freely, but asks the person before it touches a field that is not `normal`
//     or changes the structure (a card shows the change before and after) or puts a table or an app away, and it can raise a field's protection, never lower it;
//     deleting a table or an app for good is the person's alone: the agent is refused, and says so;
//   - a team member (`kind: 'member'`) is answered from their profile (profiles.mjs): additive and default-deny, a table only if it has a grant, a field only as its access says;
//     a member never deletes a record and never changes the structure, whatever the profile says;
//   - anyone else is refused: the answer is deny, never a guess.
//
// The answer is `{ effect: 'allow' | 'ask' | 'deny', reason?, mask? }`. `ask` means « only with the person's OK, now ».

import { PROTECTION } from './types.mjs'
import { isPlain } from './text.mjs'
import { fieldAccess, grantOf, grantUpdates } from './profiles.mjs'

export const ACTIONS = ['record.read', 'record.create', 'record.update', 'record.delete', 'field.read', 'field.write', 'view.edit', 'schema.change', 'schema.archive', 'schema.delete', 'field.protect']

/** The rank of a protection level: 0 normal, 1 personal, 2 sensitive, 3 secret. */
export const protectionRank = (level) => PROTECTION.indexOf(level)

const answer = (effect, reason, mask) => {
  const out = { effect }
  if (reason) out.reason = reason
  if (mask) out.mask = true
  return out
}

/** A team member: answered from the profile the actor carries (`actor.profile`, normalized by profiles.mjs); `resource.object` is the table's key. */
function canMember (actor, action, resource) {
  if (!ACTIONS.includes(action)) return answer('deny', 'unknown-action')
  if (!isPlain(actor.profile)) return answer('deny', 'no-profile')
  if (action === 'record.delete') return answer('deny', 'members-never-delete')
  if (action === 'schema.change' || action === 'schema.archive' || action === 'schema.delete' || action === 'view.edit' || action === 'field.protect') return answer('deny', 'owner-only')
  const object = isPlain(resource) ? resource.object : undefined
  const grant = grantOf(actor.profile, object)
  if (grant === undefined) return answer('deny', 'no-access')
  switch (action) {
    case 'record.read': return grant.do.includes('read') ? answer('allow') : answer('deny', 'no-access')
    case 'record.create': return grant.do.includes('create') ? answer('allow') : answer('deny', 'no-access')
    case 'record.update': return grantUpdates(grant) ? answer('allow') : answer('deny', 'no-access')
    default: {
      const field = isPlain(resource) && isPlain(resource.field) ? resource.field : null
      if (field === null) return answer('deny', 'no-field')
      const access = fieldAccess(actor.profile, object, field)
      if (access === 'hidden') return answer('deny', 'hidden-field')
      if (action === 'field.write' && access !== 'write') return answer('deny', 'read-only-field')
      return answer('allow')
    }
  }
}

/**
 * `actor` is `{ kind: 'person' | 'agent', role: 'owner' }` or `{ kind: 'member', role: <profile id>, profile }`, `action` one of ACTIONS, `resource` what it is about:
 * `{ field: { protection } }` for field.read and field.write, `{ field: { protection }, to }` for field.protect (`to` is the level asked for); for a member also `object`
 * (the table's key) and `field: { key, protection }`.
 */
export function can (actor, action, resource) {
  if (isPlain(actor) && actor.kind === 'member') return canMember(actor, action, resource)
  if (!isPlain(actor) || actor.role !== 'owner') return answer('deny', 'not-owner')
  if (!ACTIONS.includes(action)) return answer('deny', 'unknown-action')
  const field = isPlain(resource) && isPlain(resource.field) ? resource.field : {}
  const level = PROTECTION.includes(field.protection) ? field.protection : 'normal'
  if (actor.kind === 'person') return action === 'field.read' && level !== 'normal' ? answer('allow', undefined, true) : answer('allow')
  if (actor.kind !== 'agent') return answer('deny', 'unknown-actor')
  switch (action) {
    case 'schema.change': return answer('ask', 'schema-change')
    case 'schema.archive': return answer('ask', 'archive')
    case 'schema.delete': return answer('deny', 'person-only')
    case 'field.protect': return protectionRank(resource && resource.to) < protectionRank(level) ? answer('deny', 'agent-cannot-lower') : answer('allow')
    case 'field.read': case 'field.write': return level === 'normal' ? answer('allow') : answer('ask', 'protected-field')
    default: return answer('allow')
  }
}
