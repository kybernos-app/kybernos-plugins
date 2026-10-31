// people.mjs — the owner's side of the team: invite by e-mail or by link, resend, change a profile, revoke. Over the store and the invitation tokens; no http, no Better-Auth.
//
// Every answer is `{ ok: true, … }` or `{ ok: false, error, message }` with `error` one of `invalid`, `unknown`, `owner`. The profile id of an invitation must be one the apps of the
// space define (`roles()` gives them); `owner` is never one of them.
import { assignable } from './actor.mjs'
import { INVITE_TTL_SEC, mintInvitationToken, newInvitationId, newNonce, normEmail } from './invitation.mjs'
import { MAIL_FAILED } from './mailer.mjs'

const fail = (error, message) => ({ ok: false, error, message })

/**
 * `roles()` gives `[{ id, label, apps }]`, the profile ids the apps define; `publicUrl` is where the link points; `mailer` is the port of lib/mailer.mjs. `inviter(userId)` gives the
 * words the e-mail uses for whoever sends the invitation (or '' / null), `space()` the name of the space; both are optional and may be async.
 */
export function makePeople ({ store, secret, publicUrl, mailer, roles, now = Date.now, inviter = async () => '', space = () => '' }) {
  const link = (inv) => publicUrl.replace(/\/$/, '') + '/invite?t=' + encodeURIComponent(mintInvitationToken({ secret, id: inv.id, nonce: inv.nonce, now, ttlSec: Math.max(1, Math.floor((inv.exp - now()) / 1000)) }))
  const known = (role) => assignable(role) && roles().some((r) => r.id === role)
  const shape = (inv) => ({ id: inv.id, email: inv.email, role: inv.role, exp: inv.exp })

  /**
   * Sends the link by e-mail when there is an address and a mailer that sends; the link is given back whenever it was not sent. When a mailer that was meant to send did not,
   * the answer says so (`mailFailed`, and the fixed `message`) and still carries the link: the owner passes it on themselves. Nothing of the provider's answer is kept.
   */
  async function deliver (inv, by) {
    const url = link(inv)
    if (inv.email === null) return { ok: true, invitation: shape(inv), link: url, sent: false }
    const meant = mailer.configured !== false
    let sent = false
    if (meant) {
      try {
        let who = ''
        try { who = (await inviter(by)) || '' } catch (e) { who = '' }
        const label = roles().find((r) => r.id === inv.role)?.label
        sent = (await mailer.send({ to: inv.email, link: url, role: inv.role, roleLabel: label ?? '', expires: new Date(inv.exp).toISOString(), expiresInDays: Math.round(INVITE_TTL_SEC / 86400), inviter: who, space: space() })).sent === true
      } catch (e) { sent = false }
    }
    if (sent) store.markSent(inv.id)
    return { ok: true, invitation: shape(inv), sent, ...(sent ? {} : { link: url }), ...(meant && !sent ? { mailFailed: true, message: MAIL_FAILED } : {}) }
  }

  return {
    list: () => ({ members: store.members(), invitations: store.pending().map((i) => ({ id: i.id, email: i.email, role: i.role, exp: i.exp, sent: i.sent_at !== null })), roles: roles() }),

    async invite ({ email, role, by }) {
      if (!known(role)) return fail('invalid', 'that profile does not exist in this space')
      let address = null
      if (email !== undefined && email !== null && email !== '') {
        address = normEmail(email)
        if (address === null) return fail('invalid', 'that is not an e-mail address')
        if (store.memberByEmail(address) !== null) return fail('invalid', 'that person is already in the team')
      }
      const inv = { id: newInvitationId(), email: address, role, nonce: newNonce(), exp: now() + INVITE_TTL_SEC * 1000, by }
      store.invite(inv)
      return deliver(inv, by)
    },

    async resend (id, by) {
      const row = store.invitation(id)
      if (row === null || row.accepted_at !== null) return fail('unknown', 'no such pending invitation')
      const nonce = newNonce()
      const exp = now() + INVITE_TTL_SEC * 1000
      store.renewInvitation(id, nonce, exp)
      return deliver({ ...row, nonce, exp }, by)
    },

    setInvitationRole (id, role) {
      if (!known(role)) return fail('invalid', 'that profile does not exist in this space')
      return store.setInvitationRole(id, role) === 1 ? { ok: true } : fail('unknown', 'no such pending invitation')
    },

    revoke: (id) => (store.revokeInvitation(id) === 1 ? { ok: true } : fail('unknown', 'no such pending invitation')),

    setMemberRole (userId, role) {
      const m = store.member(userId)
      if (m === null) return fail('unknown', 'no such member')
      if (m.role === 'owner') return fail('owner', 'the owner has no profile to change')
      if (!known(role)) return fail('invalid', 'that profile does not exist in this space')
      return store.setRole(userId, role) === 1 ? { ok: true } : fail('unknown', 'no such member')
    },
  }
}
