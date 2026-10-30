// Who may do what: the one function every door of the engine asks, `can()`. Pure.
//
// Phase A has one person and their agents, so the rule is short:
//   - the owner (the person at the screen) may do everything; a field that is not `normal` is shown masked until they reveal it;
//   - the owner's agent (Kaby) reads and writes records and views freely, but asks the person before it touches a field that is not `normal`
//     or changes the structure (a card shows the change before and after), and it can raise a field's protection, never lower it;
//   - anyone else is refused until team profiles bring their own rules (phase C): the answer is deny, never a guess.
//
// The answer is `{ effect: 'allow' | 'ask' | 'deny', reason?, mask? }`. `ask` means « only with the person's OK, now ».

import { PROTECTION } from './types.mjs'
import { isPlain } from './text.mjs'

export const ACTIONS = ['record.read', 'record.create', 'record.update', 'record.delete', 'field.read', 'field.write', 'view.edit', 'schema.change', 'field.protect']

/** The rank of a protection level: 0 normal, 1 personal, 2 sensitive, 3 secret. */
export const protectionRank = (level) => PROTECTION.indexOf(level)

const answer = (effect, reason, mask) => {
  const out = { effect }
  if (reason) out.reason = reason
  if (mask) out.mask = true
  return out
}

/**
 * `actor` is `{ kind: 'person' | 'agent', role: 'owner' }`, `action` one of ACTIONS, `resource` what it is about:
 * `{ field: { protection } }` for field.read and field.write, `{ field: { protection }, to }` for field.protect (`to` is the level asked for).
 */
export function can (actor, action, resource) {
  if (!isPlain(actor) || actor.role !== 'owner') return answer('deny', 'not-owner')
  if (!ACTIONS.includes(action)) return answer('deny', 'unknown-action')
  const field = isPlain(resource) && isPlain(resource.field) ? resource.field : {}
  const level = PROTECTION.includes(field.protection) ? field.protection : 'normal'
  if (actor.kind === 'person') return action === 'field.read' && level !== 'normal' ? answer('allow', undefined, true) : answer('allow')
  if (actor.kind !== 'agent') return answer('deny', 'unknown-actor')
  switch (action) {
    case 'schema.change': return answer('ask', 'schema-change')
    case 'field.protect': return protectionRank(resource && resource.to) < protectionRank(level) ? answer('deny', 'agent-cannot-lower') : answer('allow')
    case 'field.read': case 'field.write': return level === 'normal' ? answer('allow') : answer('ask', 'protected-field')
    default: return answer('allow')
  }
}
