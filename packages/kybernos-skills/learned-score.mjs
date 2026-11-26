// The confidence score of a suggestion, and the hard stops no threshold can lift. Pure: a suggestion and what the host knows in, numbers and codes out.
//
// THE SCORE IS MADE BY RULES, FROM FACTS, never by the model grading itself (a model that wrote a skill would grade it kindly):
//
//   evidence  35  how many independent things it came from: lessons (11 each), runs of an automation without a failure (6 each),
//                 a chat where the person asked for it (11, plus 11 for each verified lesson it cites and 11 for each earlier chat where the host
//                 verified a similar ask, learned-repeat.mjs), and for an improvement the
//                 distinct chats the skill was really used in (11 each, counted by the host)
//   words     25  how much of the text is the person's own words: a lesson's sentence, an automation's text (25); text the agent wrote (10)
//   checks    15  every check of the review passes (5 otherwise)
//   clean     10  no client data found in the text (0 otherwise)
//   copy      10  not a copy of a skill the person has (5 when 40 % alike or more)
//   record     5  the person has accepted suggestions and not taken back one of Kaby's own changes in the last 30 days
//
// A text that asks the agent to send, publish, delete, pay or run commands is capped at 60 whatever else it scores.
// The score measures evidence, not quality: a skill can score well and be a bad idea. What protects the person is the HARD STOPS (below), the undo and the journal.
const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const SCORE_MAX = 100
export const RISKY_CAP = 60
export const AGENT_KINDS = Object.freeze(['asked', 'improve', 'auto'])

const fold = (t) => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
// Actions beyond reading and drafting, in English and French (folded: no accents). Conservative on purpose: « remove » in a procedure costs an automatic level, never more.
const RISKY = /\b(send|sends|sending|publish|delete|remove|erase|pay|purchase|buy|transfer|sudo|chmod|curl|wget|rm -rf|git push|envoie|envoyer|envoyez|supprime|supprimer|supprimez|efface|effacer|paie|payer|payez|publie|publier|publiez|achete|acheter|virement|virer)\b/
/** Does the text ask the agent to act beyond reading and drafting? */
export const isRisky = (text) => RISKY.test(fold(text))

/** The distinct things a suggestion came from, by kind (see the table above). `uses` is the host's count of chats an improved skill was used in. */
export const evidenceOf = (p, uses = 0) => {
  const lessons = p.from !== null && typeof p.from === 'object' && Array.isArray(p.from.lessons) ? p.from.lessons.length : 0
  if (p.kind === 'lessons') return Math.min(35, 11 * lessons)
  if (p.kind === 'auto') return Math.min(35, 6 * (p.from && p.from.automation && Number.isFinite(p.from.automation.runs) ? Math.max(0, p.from.automation.runs) : 0))
  if (p.kind === 'asked') return Math.min(35, 11 + 11 * ((Number.isFinite(p.verifiedLessons) ? Math.max(0, p.verifiedLessons) : 0) + (Number.isFinite(p.repeats) ? Math.max(0, p.repeats) : 0)))
  if (p.kind === 'improve') return Math.min(35, 11 * Math.max(0, uses))
  return 0
}
const wordsOf = (kind) => (kind === 'lessons' || kind === 'auto' ? 25 : 10)

/**
 * `checks` is checkProposal's answer, `record` says whether the person's track record is good, `uses` is for improvements.
 * → `{ total, signals: [{ id, v, max }], risky, hits, checksBad }`.
 */
export const scoreOf = (p, { checks, record = false, uses = 0, text } = {}) => {
  const list = checks !== undefined && checks !== null && Array.isArray(checks.list) ? checks.list : []
  const hits = checks !== undefined && checks !== null && Array.isArray(checks.hits) ? checks.hits.length : 0
  const copy = list.find((c) => c.id === 'copy')
  const allOk = list.length > 0 && list.every((c) => c.s === 'ok')
  const signals = [
    { id: 'evidence', v: evidenceOf(p, uses), max: 35 },
    { id: 'words', v: wordsOf(p.kind), max: 25 },
    { id: 'checks', v: allOk ? 15 : 5, max: 15 },
    { id: 'clean', v: hits === 0 ? 10 : 0, max: 10 },
    { id: 'copy', v: copy !== undefined && copy.percent >= 40 ? 5 : 10, max: 10 },
    { id: 'record', v: record === true ? 5 : 0, max: 5 }
  ]
  let total = signals.reduce((n, s) => n + s.v, 0)
  const risky = isRisky(text !== undefined ? text : String(p.description || '') + '\n' + String(p.kind === 'improve' ? p.add || '' : p.body || ''))
  if (risky && total > RISKY_CAP) total = RISKY_CAP
  return { total, signals, risky, hits, checksBad: checks !== undefined && checks !== null && checks.blocking === true }
}

/**
 * Why Kaby may NOT act alone on this suggestion, as codes, in the order the page says them. Empty = it may. The settings decide the level and the line;
 * the rest are hard stops that no threshold lifts:
 *   your_click      the person asked for it by hand (« Make a skill »): they still read it
 *   asks            the level is « Ask me every time »
 *   locked          Law and Health, until the person unlocks the field
 *   needs_create    the level improves Kaby's own skills only
 *   untrusted       the chat it came from read untrusted content (a web page, an e-mail, someone else's file), or could not be followed
 *   risky           the text asks the agent to send, delete, pay or run commands
 *   client_data     client data is in the text
 *   checks          a check of the review fails
 *   edited_by_you   an improvement of a skill the person has edited since: Kaby proposes a diff, never applies it
 *   below           the score is under the person's line
 *   cap             this week's automatic changes already reached the limit
 */
export const stopsOf = (p, score, { settings, sensitive = false, usedThisWeek = 0, targetEdited = false, mode } = {}) => {
  const level = mode !== undefined ? mode : settings.mode
  const out = []
  if (AGENT_KINDS.indexOf(p.kind) < 0) out.push('your_click')
  if (level === 'ask') out.push('asks')
  if (sensitive === true && settings.privOk !== true) out.push('locked')
  if (p.kind !== 'improve' && level !== 'auto' && level !== 'ask') out.push('needs_create')
  // Text the agent wrote in a chat: that chat must be known, followed from its start and never have reached outside (an automation's text is the person's own).
  if ((p.kind === 'asked' || p.kind === 'improve') && (p.source === undefined || p.source === null || p.source.tainted !== false)) out.push('untrusted')
  if (score.risky === true) out.push('risky')
  if (score.hits > 0) out.push('client_data')
  if (score.checksBad === true) out.push('checks')
  if (p.kind === 'improve' && targetEdited === true) out.push('edited_by_you')
  if (score.total < settings.threshold) out.push('below')
  if (usedThisWeek >= settings.cap) out.push('cap')
  return out
}

/** The suggestion's name is valid whatever the agent wrote: a lowercase kebab slug, cut to 40, or null. */
export const slugOf = (text) => {
  const s = String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '')
  return SKILL_NAME_RE.test(s) ? s : null
}
