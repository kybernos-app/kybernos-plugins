// Suggested automations: the pure rules, no I/O.
//
// Kaby (the « Learn my business » automation, or any agent through a tool) can PROPOSE an automation. It is stored in the same file as the others, switched off and marked
// `suggested: true`, and the scheduler, the run-now route, the webhook and the toggle all refuse it until the person presses Add (`accept`). Add keeps it switched off:
// switching it on is a second, separate click. Discard is the ordinary delete. The proof (« seen 14 times in 60 days ») rides along in `origin.proof` so the list can show it.

export const SUGGESTED_MAX = 8
const text = (v, max) => (typeof v === 'string' ? Array.from(v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim()).slice(0, max).join('') : '')

/** The proof of a suggestion: a count, a period, where it was seen and a note, each bounded; null when there is nothing usable. */
export const proofOf = (raw) => {
  if (raw === null || typeof raw !== 'object') return null
  const n = Number.isFinite(raw.n) ? Math.max(0, Math.min(100000, Math.round(raw.n))) : null
  const out = { n, span: text(raw.span, 40), where: text(raw.where, 80), note: text(raw.note, 160) }
  return n === null && out.span === '' && out.where === '' && out.note === '' ? null : out
}

export const isSuggested = (task) => task !== null && typeof task === 'object' && task.suggested === true

/** The stored shape of a suggestion made from an already sanitised task: off, flagged, with where it came from. */
export const suggestedTask = (clean, rawProof, nowIso) => Object.assign({}, clean, {
  active: false,
  suggested: true,
  origin: { by: 'kaby', recipe: 'learn-my-business', proof: proofOf(rawProof), at: nowIso },
})

/** What Add does: the flag goes, the automation stays switched off, the moment is kept. */
export const acceptedTask = (task, nowIso) => {
  const out = Object.assign({}, task, { active: false, acceptedAt: nowIso, updatedAt: nowIso })
  delete out.suggested
  out.nextRun = null
  return out
}

/** Refusal when the list already holds this name (any state) or too many suggestions wait; null when the suggestion can be stored. */
export const refusalFor = (tasks, name) => {
  const list = Array.isArray(tasks) ? tasks : []
  const key = String(name).trim().toLowerCase()
  if (list.some((t) => t !== null && typeof t === 'object' && typeof t.name === 'string' && t.name.trim().toLowerCase() === key)) return { ok: false, error: 'already exists' }
  if (list.filter(isSuggested).length >= SUGGESTED_MAX) return { ok: false, error: 'too many suggestions waiting' }
  return null
}
