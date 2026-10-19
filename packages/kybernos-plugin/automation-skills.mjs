// Writing a stable automation down as a reusable skill, by a fixed rule.
//
// An automation that has run N times in a row without a failure is a procedure that works. This turns it into a skill the person can
// use by hand in any chat. No model decides anything: the rule is a count of the history of tasks.json, and the skill is the text of the
// automation put in the skill format. The result is the person's own file: it is never written over an existing skill, and it can be
// edited or deleted like any other.
//
// Pure: history and text in, text and decisions out. index.js reads tasks.json and writes the skill and the record.

import { STABLE_CHOICES, DEFAULT_STABLE_AFTER } from './automation-settings.mjs'

const plain = (v) => v !== null && typeof v === 'object' && Array.isArray(v) === false
// \s also covers U+2028 and U+2029, so no raw line separator is spelled out here (a heredoc would turn it into a real one).
const oneLine = (v, max) => String(typeof v === 'string' ? v : '').replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)

/** The same words as DSH's own skill names: lowercase words joined by single hyphens. */
export const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const SKILL_NAME_MAX = 40
export const RECORDS_VERSION = 1

/**
 * How many runs in a row, ending with the newest, did not fail. A run is a history line with a session id; a failure is a line with the
 * status « error » (the history's own, or the note a run writes about itself after the fact). The newest failure stops the count.
 */
export const stableStreak = (history) => {
  const list = (Array.isArray(history) === true ? history : []).filter((e) => plain(e) === true)
  const stamped = list.map((e, i) => ({ e, i, ms: Date.parse(e.at) }))
  stamped.sort((a, b) => (Number.isFinite(a.ms) === true ? a.ms : Infinity) - (Number.isFinite(b.ms) === true ? b.ms : Infinity) || a.i - b.i)
  let n = 0
  for (let i = stamped.length - 1; i >= 0; i -= 1) {
    const e = stamped[i].e
    if (e.status === 'error') break
    if (typeof e.sessionId === 'string' && e.sessionId.length > 0) n += 1
  }
  return n
}

/** `stableAfter` as the settings keep it, whatever came from a file. */
export const stableAfterOf = (settings) => (plain(settings) === true && STABLE_CHOICES.indexOf(settings.stableAfter) >= 0 ? settings.stableAfter : DEFAULT_STABLE_AFTER)

/** A name for the skill: ASCII lowercase words, never empty, at most SKILL_NAME_MAX. `taken(name)` says whether a skill of that name exists. */
export const skillSlug = (name, taken) => {
  let base = oneLine(name, 120).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, SKILL_NAME_MAX).replace(/-+$/g, '')
  if (base === '') base = 'automation'
  const isTaken = typeof taken === 'function' ? taken : () => false
  if (isTaken(base) !== true) return base
  for (let i = 2; i < 10; i += 1) {
    const cand = base.slice(0, SKILL_NAME_MAX - 2).replace(/-+$/g, '') + '-' + i
    if (isTaken(cand) !== true) return cand
  }
  return null
}

const yamlText = (s) => JSON.stringify(String(s))

/**
 * The SKILL.md of an automation: its text as the procedure, with where it came from. The webhook, the history and the
 * secrets of the automation are not part of it, only what it does.
 */
export const buildSkill = (task, slug, runs) => {
  const t = plain(task) === true ? task : {}
  const name = oneLine(t.name, 120) || slug
  const steps = (typeof t.prompt === 'string' ? t.prompt : '').replace(/\r\n?/g, '\n').trim()
  const first = oneLine(steps.split('\n').find((l) => l.trim() !== '') || name, 180)
  const n = Number.isFinite(runs) === true ? Math.max(0, Math.floor(runs)) : 0
  return [
    '---',
    'name: ' + slug,
    'description: ' + yamlText('Does what the automation “' + name + '” does: ' + first),
    'whenToUse: ' + yamlText('The user asks for “' + name + '” by hand, or to redo what the automation of that name does.'),
    '---',
    '',
    '# ' + name,
    '',
    'Written by Kybernos from the automation “' + name + '”, after ' + String(n) + ' runs in a row without a failure. It is your file: edit it, or delete it, like any other skill.',
    '',
    '## What to do',
    '',
    steps === '' ? '(the automation had no text)' : steps,
    '',
  ].join('\n')
}

/** What is kept about the skills made from automations: { version, skills: { [taskId]: { skill, at, how, runs } } }. */
export const normalizeRecords = (raw) => {
  const out = { version: RECORDS_VERSION, skills: {} }
  if (plain(raw) !== true || plain(raw.skills) !== true) return out
  for (const id of Object.keys(raw.skills).slice(0, 500)) {
    const r = raw.skills[id]
    if (plain(r) !== true || typeof r.skill !== 'string' || SKILL_NAME_RE.test(r.skill) !== true) continue
    out.skills[String(id).slice(0, 120)] = { skill: r.skill, at: oneLine(r.at, 40), how: r.how === 'manual' ? 'manual' : 'auto', runs: Number.isFinite(r.runs) === true ? Math.max(0, Math.floor(r.runs)) : 0 }
  }
  return out
}

/** The automations to write down now: stable, with no skill yet. Only when the switch is on; the Journal button does the same one at a time. */
export const dueTasks = (tasks, records, settings) => {
  if (plain(settings) !== true || settings.autoSkill !== true) return []
  const after = stableAfterOf(settings)
  const done = normalizeRecords(records).skills
  return (Array.isArray(tasks) === true ? tasks : []).filter((t) => plain(t) === true && typeof t.id === 'string' && done[t.id] === undefined && stableStreak(t.history) >= after)
}

/** What the page asks about one automation: how far it is, what the rule needs, and the skill if there is one. */
export const lessonOf = (task, records, settings) => {
  const t = plain(task) === true ? task : {}
  const rec = typeof t.id === 'string' ? normalizeRecords(records).skills[t.id] : undefined
  return { streak: stableStreak(t.history), stableAfter: stableAfterOf(settings), autoSkill: plain(settings) === true && settings.autoSkill === true, skill: rec === undefined ? null : rec }
}
