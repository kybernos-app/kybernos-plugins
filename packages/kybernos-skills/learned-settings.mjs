// The settings of « Learned skills » (<DSH home>/kybernos/skills-learned-settings.json): how much Kaby may do on its own with the skills it learns.
//
// No I/O here: learned.mjs reads and writes the file and hands the parsed object to these functions, so the rules can be tested without a host.
//
//   mode       ask       Kaby suggests, the person accepts: nothing learned is active before a click (the default, and what every field starts from)
//              improve   above the threshold Kaby may also update a skill it made and the person accepted; new skills still wait
//              auto      above the threshold Kaby may also create a skill and switch it on
//   threshold  the confidence score (0 to 100, learned-score.mjs) from which Kaby may act alone: 70 to 99, 90 by default
//   cap        at most this many automatic changes in a week: 1, 3 or 5
//   notify     where the person is told about an automatic change: both | chat | week (the weekly card is V2)
//   privOk     in Law and Health the automatic levels are locked; this explicit switch unlocks them (the privacy check still blocks)
//   breaker    set by the host, never by the page: when the person undid two of Kaby's changes in a week, Kaby went back to « ask » and says so here
//              until the person chooses a level again
//
// V2 (what Kaby notices and tells, none of it writes a skill):
//   notice     tell me when I ask for the same thing again (learned-repeat.mjs)          on by default
//   minRep     from how many similar chats: 3, 4 or 5                                      3
//   win        within how many days: 30, 60 or 90                                          60
//   week       show the weekly card on the home of a blank chat (follows `notify`)         on
//   team       point out a skill that is ready to propose to the team                      on
//   teamMin    ready after this many chats that used it: 3, 5 or 8                          3
//   teamPriv   in Law and Health, allow that hint anyway (off: those skills stay local)    off
//
// The Autonomous preset of the onboarding does NOT change any of this: it has its own setting, on its own screen.
export const SETTINGS_VERSION = 1
export const MODES = Object.freeze(['ask', 'improve', 'auto'])
export const THRESHOLD = Object.freeze({ min: 70, max: 99, default: 90 })
export const CAPS = Object.freeze([1, 3, 5])
export const NOTIFY = Object.freeze(['both', 'chat', 'week'])
export const MIN_REP = Object.freeze([3, 4, 5])
export const WINDOWS = Object.freeze([30, 60, 90])
export const TEAM_MIN = Object.freeze([3, 5, 8])
const BOOLS = ['privOk', 'notice', 'week', 'team', 'teamPriv']
const KEYS = ['mode', 'threshold', 'cap', 'notify', 'minRep', 'win', 'teamMin', ...BOOLS]

/** What a fresh install starts from: Kaby only suggests. */
export const defaults = () => ({ version: SETTINGS_VERSION, mode: 'ask', threshold: THRESHOLD.default, cap: 3, notify: 'both', privOk: false, breaker: null, notice: true, minRep: 3, win: 60, week: true, team: true, teamMin: 3, teamPriv: false })

/** Any parsed value → a complete, well-typed state. A key of the wrong type reads as its default. */
export const normalize = (raw) => {
  const base = defaults()
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return base
  if (MODES.indexOf(raw.mode) >= 0) base.mode = raw.mode
  if (Number.isInteger(raw.threshold) && raw.threshold >= THRESHOLD.min && raw.threshold <= THRESHOLD.max) base.threshold = raw.threshold
  if (CAPS.indexOf(raw.cap) >= 0) base.cap = raw.cap
  if (NOTIFY.indexOf(raw.notify) >= 0) base.notify = raw.notify
  for (const k of BOOLS) if (typeof raw[k] === 'boolean') base[k] = raw[k]
  if (MIN_REP.indexOf(raw.minRep) >= 0) base.minRep = raw.minRep
  if (WINDOWS.indexOf(raw.win) >= 0) base.win = raw.win
  if (TEAM_MIN.indexOf(raw.teamMin) >= 0) base.teamMin = raw.teamMin
  if (typeof raw.breaker === 'string' && Number.isFinite(Date.parse(raw.breaker))) base.breaker = raw.breaker
  return base
}

/** What GET answers. */
export const publicView = (state) => { const s = normalize(state); return { mode: s.mode, threshold: s.threshold, cap: s.cap, notify: s.notify, privOk: s.privOk, breaker: s.breaker, notice: s.notice, minRep: s.minRep, win: s.win, week: s.week, team: s.team, teamMin: s.teamMin, teamPriv: s.teamPriv } }

/**
 * A POST body → the next state, or a refusal (`{ ok: false, error }`, a snake_case code). Only known keys, each of its own type; one bad value refuses the whole patch
 * (a half-applied patch would leave the page and the file disagreeing). `sensitive` is Law or Health: the automatic levels are locked there until `privOk`.
 * Choosing a level again clears the breaker's note.
 */
export const apply = (state, patch, { sensitive = false } = {}) => {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return { ok: false, error: 'bad_settings' }
  const keys = Object.keys(patch)
  if (keys.length === 0) return { ok: false, error: 'bad_settings' }
  for (const key of keys) {
    if (KEYS.indexOf(key) < 0) return { ok: false, error: 'bad_settings' }
    const v = patch[key]
    if (key === 'mode' && MODES.indexOf(v) < 0) return { ok: false, error: 'bad_settings' }
    if (key === 'threshold' && !(Number.isInteger(v) && v >= THRESHOLD.min && v <= THRESHOLD.max)) return { ok: false, error: 'bad_settings' }
    if (key === 'cap' && CAPS.indexOf(v) < 0) return { ok: false, error: 'bad_settings' }
    if (key === 'notify' && NOTIFY.indexOf(v) < 0) return { ok: false, error: 'bad_settings' }
    if (BOOLS.indexOf(key) >= 0 && typeof v !== 'boolean') return { ok: false, error: 'bad_settings' }
    if (key === 'minRep' && MIN_REP.indexOf(v) < 0) return { ok: false, error: 'bad_settings' }
    if (key === 'win' && WINDOWS.indexOf(v) < 0) return { ok: false, error: 'bad_settings' }
    if (key === 'teamMin' && TEAM_MIN.indexOf(v) < 0) return { ok: false, error: 'bad_settings' }
  }
  const next = normalize(state)
  for (const key of keys) next[key] = patch[key]
  if (sensitive === true && next.privOk !== true && next.mode !== 'ask') {
    // Asking for an automatic level while the field is locked is refused; locking the field again (the switch off) puts the level back to « ask ».
    if (patch.mode !== undefined) return { ok: false, error: 'locked_field' }
    next.mode = 'ask'
  }
  if (patch.mode !== undefined && patch.mode !== 'ask') next.breaker = null
  return { ok: true, state: next }
}
