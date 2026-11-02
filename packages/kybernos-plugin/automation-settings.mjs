// Pure rules of the Automations settings page (~/.dsh/kybernos/automation-settings.json).
//
// No I/O here: index.js reads and writes the file and hands the parsed object to these functions, so the
// rules can be tested without a host. Two switches, both booleans, both off by default:
//
//   showNativeTasks  DSH's own « Automation tasks » entry stays in the menu. Off = it is hidden, because the
//                    Kybernos Automations page is the one place the person's automations live.
//   paused           nothing fires while it is on. What came due while paused fires once at the first tick
//                    after it is turned off (the scheduler's own catch-up), it is not skipped.
//
// The version stays at 1: new facts go in new fields, an older file reads them as their default.

export const AUTOMATION_SETTINGS_VERSION = 1

export const KEYS = ['showNativeTasks', 'paused']

/** What a fresh install starts from. */
export const defaults = () => ({ version: AUTOMATION_SETTINGS_VERSION, showNativeTasks: false, paused: false })

/** Any parsed value → a complete, well-typed state. A key of the wrong type reads as its default. */
export const normalize = (raw) => {
  const base = defaults()
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return base
  for (const key of KEYS) if (typeof raw[key] === 'boolean') base[key] = raw[key]
  return base
}

/** What GET answers: only the keys the page reads. */
export const publicView = (state) => {
  const s = normalize(state)
  return { showNativeTasks: s.showNativeTasks, paused: s.paused }
}

/**
 * A POST body → the next state, or a refusal. Only known keys, only booleans: anything else is refused
 * whole (a half-applied patch would leave the page and the file disagreeing).
 */
export const apply = (state, patch) => {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return { ok: false, error: 'a JSON object is expected' }
  const keys = Object.keys(patch)
  if (keys.length === 0) return { ok: false, error: 'nothing to change' }
  for (const key of keys) {
    if (KEYS.indexOf(key) < 0) return { ok: false, error: 'unknown setting: ' + key }
    if (typeof patch[key] !== 'boolean') return { ok: false, error: key + ' must be true or false' }
  }
  const next = normalize(state)
  for (const key of keys) next[key] = patch[key]
  return { ok: true, state: next }
}

/** Does the scheduler hold its tick? (Fail-open: an unreadable file never stops the automations.) */
export const isPaused = (state) => normalize(state).paused === true
