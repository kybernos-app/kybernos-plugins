// kybernos-changes — host half.
//
// None: the chip reads the facts through the sessions client (window.__KB_SESSIONS_VIEW__) and runs its
// actions through the routes of @local/kybernos-sessions (/kybernos-sessions/state, commit, push, fetch,
// sync, pr, isolate, close), which keep their own origin guard and their dry run. This file only exists
// because a bundle needs a host entry; it must never stop DSH from starting.
export const name = 'kybernos-changes'
export function apply (ctx) {
  try {
    // nothing to mount
  } catch (e) {
    console.log('[kybernos-changes] disabled: ' + String(e && e.message ? e.message : e))
  }
}
