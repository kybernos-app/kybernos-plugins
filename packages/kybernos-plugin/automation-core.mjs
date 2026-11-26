// Core automations: the few automations Kybernos makes by itself, the first time the host starts with a readable store,
// so that housekeeping happens without anyone setting it up. Today there is one, "Tidy memory & lessons" (`memory-tidy`):
// every night at 03:30, local time, it calls the `memory_tidy` host tool once (the kybernos-memory bundle registers it)
// and says in two lines what changed.
//
// The rules (the host applies them in index.js, under the tasks.json lock):
//  - a core automation is a normal task that carries `core: '<id>'`. The person may pause it, edit it or delete it; a
//    body from the page can never set or change `core` (kbSanitizeTaskInput never copies it, an edit keeps the stored one).
//  - it is made once. A small ledger next to tasks.json (core-automations.json) records when it was made (`seededAt`) and
//    when the person deleted it (`deletedAt`). Once either is there, a missing task is never made again: a deletion by the
//    page, by the automation-creator skill or by hand is the person's choice. An unreadable ledger makes nothing.
// Pure: no I/O.

export const CORE_MEMORY_TIDY = 'memory-tidy'
/** Every core automation, in the order they are made. */
export const CORE_IDS = [CORE_MEMORY_TIDY]
/** `process.platform` of an engine that runs inside the phone app (the same two names kybernos-phone-model answers to). */
const PHONE_PLATFORMS = ['android', 'ios']
/** The core automations made for a computer and never made by itself on a phone: a night run of the memory tidy would cost a phone's battery and a small
 * model's turn for lessons and notes that live on the computer; nobody chose it there. A phone that already holds one keeps it ('exists'). */
export const CORE_NOT_ON_PHONE = [CORE_MEMORY_TIDY]

/** The ledger's file name, next to tasks.json. */
export const CORE_LEDGER_FILE = 'core-automations.json'
/** The host tool the run calls (registered by packages/kybernos-memory). */
export const MEMORY_TIDY_TOOL = 'memory_tidy'
/** Every day at 03:30, in the person's time zone (the machine's own, like any automation made without one). */
export const MEMORY_TIDY_CRON = '30 3 * * *'
/** The name in each language. The host stores the English one (it does not know the page's language); the page shows the
 * French one while the stored name is still one of these (see kbCoreName in client.js). */
export const MEMORY_TIDY_NAMES = { en: 'Tidy memory & lessons', fr: 'Ranger m\u00e9moire et le\u00e7ons' }

/** The prompt of a run. It names the tool once, forbids every other tool and any deletion by hand, and says what to answer
 * when the tool is not there (the memory bundle off or too old). */
export const memoryTidyPrompt = () => [
  'Tidy the lessons and the memory kept on this computer.',
  '1. Call the ' + MEMORY_TIDY_TOOL + ' tool once, with no arguments. Call no other tool.',
  '2. Then answer in two plain lines, in the language of the person: what changed, from what the tool returned, or that nothing needed tidying.',
  'Never delete, rewrite or move a lesson or a memory yourself: only the tool tidies, and what it does can be undone.',
  'If the ' + MEMORY_TIDY_TOOL + ' tool is not in your tool list, answer in one line that the memory tidy tool is not available on this computer, and stop.',
].join('\n')

/** True for a time zone name shaped like an IANA one (the sanitizer checks that it exists). */
const zoneOk = (tz) => typeof tz === 'string' && /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(tz)

/**
 * The form entry of a core automation, for kbSanitizeTaskInput, or null for an unknown id. Without a zone the sanitizer
 * puts the machine's own, like every automation made without one.
 * @param {string} id a core id
 * @param {{tz?: string}} [opts]
 */
export const coreTaskInput = (id, opts = {}) => {
  if (id !== CORE_MEMORY_TIDY) return null
  const tz = opts !== null && typeof opts === 'object' && zoneOk(opts.tz) ? opts.tz : undefined
  return {
    name: MEMORY_TIDY_NAMES.en,
    prompt: memoryTidyPrompt(),
    schedule: Object.assign({ mode: 'cron', cron: MEMORY_TIDY_CRON }, tz !== undefined ? { tz } : {}),
    active: true,
    // It only touches the lessons and the memory of this computer, and every change the tool makes can be undone.
    approvals: 'auto',
    // One chat for all its runs (made at the first run), not a new chat every night.
    sessionMode: 'home',
  }
}

/** The core id a stored task carries, or null. */
export const coreOf = (task) => (task !== null && typeof task === 'object' && typeof task.core === 'string' && CORE_IDS.indexOf(task.core) >= 0 ? task.core : null)

const plain = (v) => v !== null && typeof v === 'object' && Array.isArray(v) === false
const iso = (v) => (typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v)) ? v : null)

/**
 * The ledger read from its file's text. `null` (no file yet) is an empty ledger; a text that is not a JSON object is
 * unreadable, and an unreadable ledger makes nothing (it could hide a deletion).
 * @param {string|null} text
 * @returns {{ok: true, ledger: object} | {ok: false}}
 */
export const coreLedgerParse = (text) => {
  if (text === null || text === undefined) return { ok: true, ledger: {} }
  let data = null
  try { data = JSON.parse(String(text).charCodeAt(0) === 0xfeff ? String(text).slice(1) : String(text)) } catch (e) { return { ok: false } }
  if (plain(data) !== true) return { ok: false }
  const ledger = {}
  for (const id of CORE_IDS) {
    const r = data[id]
    if (plain(r) !== true) continue
    const entry = {}
    if (iso(r.seededAt) !== null) entry.seededAt = r.seededAt
    if (iso(r.deletedAt) !== null) entry.deletedAt = r.deletedAt
    if (Object.keys(entry).length > 0) ledger[id] = entry
  }
  return { ok: true, ledger }
}

/**
 * What to do for one core automation: `exists` (a task carries it), `deleted` (the ledger says it was made or deleted
 * once, and the person removed it since), `not-on-phone` (nothing made, nothing recorded: see CORE_NOT_ON_PHONE), or `create`.
 * @param {unknown[]} tasks the stored tasks
 * @param {object} ledger a parsed ledger
 * @param {string} id a core id
 * @param {string} [platform] `process.platform` of this engine
 */
export const corePlan = (tasks, ledger, id, platform) => {
  if ((Array.isArray(tasks) ? tasks : []).some((t) => coreOf(t) === id)) return 'exists'
  const entry = plain(ledger) === true && plain(ledger[id]) === true ? ledger[id] : null
  if (entry !== null && (typeof entry.seededAt === 'string' || typeof entry.deletedAt === 'string')) return 'deleted'
  if (PHONE_PLATFORMS.indexOf(platform) >= 0 && CORE_NOT_ON_PHONE.indexOf(id) >= 0) return 'not-on-phone'
  return 'create'
}

/** A copy of the ledger with one field of one entry set. */
export const coreLedgerWith = (ledger, id, field, at) => {
  const out = plain(ledger) === true ? JSON.parse(JSON.stringify(ledger)) : {}
  out[id] = Object.assign({}, plain(out[id]) === true ? out[id] : {}, { [field]: at })
  return out
}
