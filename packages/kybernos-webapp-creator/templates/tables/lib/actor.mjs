// actor.mjs — who the door is asked about. Pure.
//
// A team member has one role in the team space, and it is a profile id: each app answers for that id from the profiles it holds itself (kybernos-db core/profiles.mjs), and
// an app that has no profile of that id shows them nothing. The owner is the one reserved role, `owner`, and only the bootstrap (lib/bootstrap.mjs) makes one.
//
// The profile-id pattern is the one of kybernos-db; test-tables-actor.mjs fails if the two ever differ.
export const PROFILE_ID = /^[a-z][a-z0-9_-]{0,23}$/
export const SLUG = /^[a-z][a-z0-9-]{0,39}$/
export const OWNER = 'owner'

export const isSlug = (s) => typeof s === 'string' && SLUG.test(s)

/** Can the owner hand this role to someone? A profile id, never `owner`. */
export const assignable = (role) => typeof role === 'string' && PROFILE_ID.test(role) && role !== OWNER

/** The actor for `api.as()` from a member row (`{ user_id, role }`), or null when the row names no role the door knows. */
export function actorOf (member) {
  if (member === null || typeof member !== 'object' || typeof member.user_id !== 'string' || member.user_id === '') return null
  if (member.role === OWNER) return { kind: 'person', role: OWNER }
  return assignable(member.role) ? { kind: 'member', role: member.role, id: member.user_id } : null
}
