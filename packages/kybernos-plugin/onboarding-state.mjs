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

/** How much the agents may do alone (the « agents » step): the three presets of the wizard, or null. */
export const AGENT_PRESETS = ['prudent', 'balanced', 'auto']
const agentPreset = (value) => (typeof value === 'string' && AGENT_PRESETS.indexOf(value) >= 0 ? value : null)

/**
 * What the person typed about themselves (the « about you » step): a website, a social profile and a free word, each optional and bounded.
 * It stays in this local file and is never part of what GET answers (that route is served before DSH's own sign-in).
 */
export const ABOUT_MAX = { site: 200, profile: 200, words: 600 }
const line = (value, max) => {
  if (typeof value !== 'string') return null
  const clean = value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim()
  return clean === '' ? null : Array.from(clean).slice(0, max).join('')
}
const aboutOf = (value) => {
  if (value === null || typeof value !== 'object') return null
  const out = { site: line(value.site, ABOUT_MAX.site), profile: line(value.profile, ABOUT_MAX.profile), words: line(value.words, ABOUT_MAX.words) }
  return out.site === null && out.profile === null && out.words === null ? null : out
}

/** What the person said about themselves, as stored (null when nothing): for the wizard's own replay, never for the public view. */
export const aboutView = (state) => aboutOf(state !== null && typeof state === 'object' ? state.about : null)

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
  agents: null,
  about: null,
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
  agents: agentPreset(state.agents),
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
    // The autonomy the person picked for the agents, and what they said about themselves; a client that sends neither keeps what is saved.
    agents: agentPreset(input.agents) || agentPreset(state.agents),
    about: input.about !== undefined ? aboutOf(input.about) : aboutOf(state.about),
  }
}

/** A new domain and goals chosen later (the starter kit opened on its own): only those two answers move, the wizard's completion is left as it is. */
export const chooseDomain = (state, body) => {
  const input = body !== null && typeof body === 'object' ? body : {}
  return { ...state, profil: text(input.profil), goals: goalList(input.goals) }
}

/** « Replay onboarding » in Settings: the next page load opens the wizard again. The old answers stay. */
export const replay = (state) => ({ ...state, completed: false, completedAt: null })
