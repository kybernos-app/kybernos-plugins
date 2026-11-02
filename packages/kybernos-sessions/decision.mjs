// The closed lists of the decision route: which agent team handles a request, and which category (so which icon) a chat gets.
//
// A closed question is a short text to sort into a list the product wrote: the ids and, for each, when it applies. This module
// holds the lists and builds the question; `decision-llm.mjs` puts it to the Study model through DSH's `llm` service and keeps
// an answer only if it is an id of the list. Nothing here touches the network.
//
// Two callers, two closed lists:
//   · `construireQuestion`          — which agent team handles this request (the criteria are the `mission:` of the teams,
//                                     plus an explicit `aucun`);
//   · `construireQuestionCategorie` — which session category, so which icon before the row (the criteria are CATEGORIES,
//                                     whose meaning is written below).
// A third use would only need a `criteria` map.

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** The DSH home, resolved the way DSH does (@deepseek-ai/dsh-home-paths): a non-blank $DSH_HOME (trimmed, a leading ~
 *  expanded), else <os home>/.dsh. Resolved at each use, never cached: with DSH_HOME set, no default path may point into the
 *  real ~/.dsh. */
export const dshHome = (env = process.env, osHome = homedir) => {
  const raw = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  if (raw === '') return join(osHome(), '.dsh')
  if (raw === '~') return osHome()
  return resolve(raw.startsWith('~/') || raw.startsWith('~\\') ? join(osHome(), raw.slice(2)) : raw)
}
/** Longest mission put in a question (a longer one is cut: the call stays cheap). */
export const MISSION_MAX = 400

/** The eight session categories, and the ONLY place where their meaning is written. `CATEGORIES_CONNUES` (index.js) derives
 *  from this table and the client paints the icon of the slug: adding a row here offers it to the model and accepts it on
 *  the categories route. The order is that of the historical registry — do not change it without changing `check-all`
 *  (it is tested as it stands).
 *  `quand` is the criterion the model reads: it describes the WORK, not the vocabulary (a request may say "bug" while
 *  asking for a feature). */
export const CATEGORIES = [
  { slug: 'fonctionnalite', quand: 'the request builds or extends a capability: new behaviour, new route, new setting, rework of an existing flow' },
  { slug: 'correctif', quand: 'the request repairs something that does not work, or not as announced: bug, regression, false positive, crash, failing test' },
  { slug: 'ui', quand: 'the request is about looks or ergonomics: layout, theme, icons, visible labels, screenshots, mockup' },
  { slug: 'doc', quand: 'the request writes or updates documentation: user guide, report, skill, handbook, handoff note' },
  { slug: 'integration', quand: 'the request plugs in an outside service: MCP connector, third-party API, model provider, key, authentication' },
  { slug: 'donnees', quand: 'the request is about data or measurements: schema, migration, catalogue, prices, readings, statistics' },
  { slug: 'nettoyage', quand: 'the request tidies without changing behaviour: deletion, renaming, moving, deduplication, dead-file housekeeping' },
  { slug: 'question', quand: 'the chat is not a work item: it asks for an opinion, an explanation or a comparison, and nothing is to be written' }
]

/** A cleaned list of agent teams: valid `{id, mission}`, no duplicates, order kept. `aucun` is reserved — it is the answer
 *  « nobody covers this ». */
export const normaliserKybers = (kybers) => {
  const vus = new Set()
  const out = []
  for (const k of (Array.isArray(kybers) ? kybers : [])) {
    if (k === null || typeof k !== 'object') continue
    const id = typeof k.id === 'string' ? k.id.trim() : ''
    if (id === '' || id === 'aucun' || vus.has(id)) continue
    const mission = typeof k.mission === 'string' ? k.mission.trim() : ''
    vus.add(id)
    out.push({ id, mission: mission === '' ? '(mission not declared)' : mission.slice(0, MISSION_MAX) })
  }
  return out
}

/** The question that tells agent teams apart: `{instructions, criteria}`, `criteria` being id → when it applies. `null` when
 *  the list is empty: there is nothing to sort. */
export const construireQuestion = (kybers, opts = {}) => {
  const liste = normaliserKybers(kybers)
  if (liste.length === 0) return null
  const criteria = {}
  for (const k of liste) criteria[k.id] = k.mission
  criteria.aucun = typeof opts.aucun === 'string' && opts.aucun !== ''
    ? opts.aucun
    : 'no agent team of the list covers this request'
  return {
    instructions: 'Pick the agent team whose mission matches the request. Judge the mission, not the words: a request may borrow one agent team\'s vocabulary while asking for another\'s work. Answer "aucun" when no listed mission covers the request.',
    criteria
  }
}

/** The question that picks the CATEGORY of a chat — so the icon painted before its row. No « aucun » here: a chat always has a
 *  category, and `question` plays that part (the chat asks for nothing to be written). */
export const construireQuestionCategorie = (opts = {}) => {
  const table = Array.isArray(opts.categories) ? opts.categories : CATEGORIES
  const criteria = {}
  for (const c of table) {
    if (c === null || typeof c !== 'object') continue
    const slug = typeof c.slug === 'string' ? c.slug.trim() : ''
    if (slug === '' || criteria[slug] !== undefined) continue
    criteria[slug] = typeof c.quand === 'string' && c.quand !== '' ? c.quand : slug
  }
  if (Object.keys(criteria).length === 0) return null
  return {
    instructions: 'Pick the category that describes what this chat actually does. Judge the work, not the words: a chat may say "bug" while asking for new behaviour, or look like a feature while it only asks a question. Answer "question" when nothing is to be written.',
    criteria
  }
}
