// Pure state of the first-run onboarding (~/.dsh/kybernos/onboarding.json).
//
// No I/O here: index.js reads and writes the file and hands the parsed object to these
// functions, so the rules below can be tested without a host.
//
// The version stays at 1 on purpose: the page opens the wizard when `completed` is false
// OR the stored version differs from the served one, so raising it would reopen the
// wizard for every existing user. New facts go in new fields instead; an older file
// simply reads them as null.

export const ONBOARDING_VERSION = 1

/** How the person chose to power the agents. `later` = left the step without choosing. */
export const MODEL_CHOICES = ['cloud', 'key', 'local', 'later']

const TEXT_MAX = 60
const LANG_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/

/** A trimmed non-empty string, cut to `max` characters, or null. */
const text = (value, max = TEXT_MAX) => {
  if (typeof value !== 'string') return null
  const clean = value.trim()
  return clean === '' ? null : Array.from(clean).slice(0, max).join('')
}

/** A language tag such as `en`, `fr`, `pt-BR`, or null. */
const lang = (value) => {
  const clean = text(value, 12)
  return clean !== null && LANG_RE.test(clean) ? clean : null
}

/** An id the cloud memory handed back (opaque, printable, short), or null. */
const memoryId = (value) => {
  const clean = text(value, 80)
  return clean !== null && /^[\x21-\x7e]+$/.test(clean) ? clean : null
}

/** The goals ticked in the wizard (ids of a domain pack): valid ids only, each once, at most GOALS_MAX. */
export const GOALS_MAX = 12
const GOAL_RE = /^[a-z][a-z0-9-]{1,23}$/
const goalList = (value) => (Array.isArray(value)
  ? [...new Set(value.filter((g) => typeof g === 'string' && GOAL_RE.test(g)))].slice(0, GOALS_MAX)
  : [])

/** A model choice from MODEL_CHOICES, or null. */
const modelChoice = (value) => (typeof value === 'string' && MODEL_CHOICES.indexOf(value) >= 0 ? value : null)

/** The file a fresh install starts from. */
export const defaultState = (now = new Date()) => ({
  version: ONBOARDING_VERSION,
  completed: false,
  installedAt: now.toISOString(),
  completedAt: null,
  profil: null,
  uiMode: null,
  model: null,
  lang: null,
  memoryId: null,
  goals: [],
})

/** What GET answers: the completion flag already folds the version in. */
export const publicView = (state) => ({
  completed: state.completed === true && state.version === ONBOARDING_VERSION,
  version: ONBOARDING_VERSION,
  installedAt: state.installedAt || null,
  completedAt: state.completedAt || null,
  profil: state.profil || null,
  uiMode: state.uiMode || null,
  model: modelChoice(state.model),
  lang: lang(state.lang),
  memoryId: memoryId(state.memoryId),
  goals: goalList(state.goals),
})

/** The person went through (or left) the wizard: record the choices, stamp the date. */
export const complete = (state, body, now = new Date()) => {
  const input = body !== null && typeof body === 'object' ? body : {}
  return {
    ...state,
    version: ONBOARDING_VERSION,
    completed: true,
    completedAt: now.toISOString(),
    profil: text(input.profil),
    uiMode: text(input.uiMode),
    model: modelChoice(input.model),
    lang: lang(input.lang),
    // The memory the wizard wrote about the profession: kept across replays so a replay updates it instead of adding another.
    memoryId: memoryId(input.memoryId) || memoryId(state.memoryId),
    // `profil` is the domain (an id of domains/*.json) and `goals` the ones ticked; a client that sends no `goals` keeps the saved ones.
    goals: Array.isArray(input.goals) ? goalList(input.goals) : goalList(state.goals),
  }
}

/** A new domain and goals chosen later (Settings, Starter kit): only those two answers move, the wizard's completion is left as it is. */
export const chooseDomain = (state, body) => {
  const input = body !== null && typeof body === 'object' ? body : {}
  return { ...state, profil: text(input.profil), goals: goalList(input.goals) }
}

/** « Replay onboarding » in Settings: the next page load opens the wizard again. The old answers stay. */
export const replay = (state) => ({ ...state, completed: false, completedAt: null })
