// Updating THIS cloud computer (ADR 0052, addendum 2026-11-21).
//
// A cloud computer cannot update itself in place: its software is its image, and the platform moves the machine onto the newest one when its person presses « update » (the machine keeps its
// volume: profile, chats, files, and restarts for about a minute). The maintenance dialog of the computer's own page asks here whether a newer version is ready and starts the move. On a DSH
// that is not a cloud computer both calls answer `applicable: false` and nothing else.
//
// The platform is asked with the computer's OWN token, on its own routes (`/v1/computer/update`): that token reaches this computer and nothing else (it may not even list the person's computers),
// the move is to the platform's own newest image and never one named here, and the platform never names an image: `target` is a short opaque name the page keys « skip this version » on.
//
// The dependencies are the host's own (a seam for the tests): `computerSelf()` → { id, token }, `apiCall(path, { method, token, body, timeoutMs })` → { status, body }.

export const UPDATE_REFUSALS = Object.freeze(['up_to_date', 'update_running', 'update_unsupported', 'update_unavailable', 'rate_limited'])
const TARGET_RE = /^[0-9a-f]{8}$/
const PATH = '/v1/computer/update'

export function createComputerUpdate ({ computerSelf, apiCall }) {
  /** The computer's identity, or null off a cloud computer (no id, or no token to speak with). */
  const me = () => {
    const s = computerSelf()
    return s !== null && typeof s === 'object' && typeof s.id === 'string' && s.id !== '' && typeof s.token === 'string' && s.token !== '' ? s : null
  }

  /** Whether a newer version of this computer is ready. Read-only. */
  const state = async () => {
    const self = me()
    if (self === null) return { ok: true, applicable: false }
    const res = await apiCall(PATH, { method: 'GET', token: self.token, timeoutMs: 15000 })
    const u = res.status === 200 && res.body !== null && typeof res.body === 'object' && res.body.update !== null && typeof res.body.update === 'object' ? res.body.update : null
    if (u === null) {
      // Status 0 is the network: a platform that did not answer says nothing about whether a newer version exists.
      return { ok: true, applicable: true, supported: false, available: false, updating: false, error: res.status === 0 ? 'server_unreachable' : 'unavailable' }
    }
    return {
      ok: true, applicable: true, supported: u.supported === true, available: u.available === true, updating: u.updating === true,
      target: typeof u.target === 'string' && TARGET_RE.test(u.target) ? u.target : null
    }
  }

  /** The person's press: the platform answers at once (202) and restarts this machine behind its answer. A refusal is a closed code, never the platform's words. */
  const start = async () => {
    const self = me()
    if (self === null) return { ok: false, error: 'not_a_computer' }
    const res = await apiCall(PATH, { method: 'POST', token: self.token, body: {}, timeoutMs: 25000 })
    if (res.status === 202) return { ok: true, started: true }
    const code = res.body !== null && typeof res.body === 'object' && typeof res.body.error === 'string' ? res.body.error : ''
    return { ok: false, error: UPDATE_REFUSALS.includes(code) ? code : (res.status === 0 ? 'server_unreachable' : 'refused'), status: res.status }
  }

  return { state, start }
}
