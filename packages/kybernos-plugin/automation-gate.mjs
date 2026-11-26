// ── KB-AUTOGATE-HEADER ──────────────────────────────────────────────────────
// The static gate of an automation draft: may this draft be certified, and what exactly is wrong with it?
//
// It answers one question about one object — the draft the model writes through `automation_suggest`, the form
// posts, or a published definition carries — and nothing else. `checkDraft(draft, options)` returns a bounded,
// deterministic `{ verdict, findings }`; every finding is a frozen `{ code, severity, field, message }` whose
// severity and field come from the frozen table below (KB-AUTOGATE-SHAPES), never from the draft, and whose
// message is a fixed English line: no text of the draft is ever echoed.
//
// Why it imports nothing: it is the cheap, total, side-effect-free first gate that every later batch imports —
// the proof report (B2) reads the verdict, the route (B3) refuses a `fail`, the page (B5) draws the findings.
// It cannot read a file, open a socket, look at a clock, store anything or decide activation, so it can also be
// imported from a client bundle or from a test under a `data:` URL. The scheduler rules it must agree with
// (cron grammar, gap, "never fires", IANA zone) are therefore COPIED from `KB-TASKS-CORE` in index.js and the
// copy is pinned by a parity test against that block; index.js itself is never imported (it runs for its side
// effects and exports nothing).
//
// Two invariants, stated once: (1) activation is impossible here — no export returns, computes or writes a
// status, the gate only observes the `active` flag; (2) "never sends, publishes, deletes or pays alone" is what
// the checks enforce — through the prompt word families, the tool/connector advisories and the blocker that
// fires when `approvals` is `'auto'` and the run would act.
//
// Fail closed: any internal error becomes the single blocker `gate.internal`. There is no input for which this
// module returns `pass` by accident.

// ── KB-AUTOGATE-SHAPES ──────────────────────────────────────────────────────
// The closed vocabularies of the gate record (cadrage's GateStatus / GateRecord / GateFinding). B2 normalizes
// against these lists; B1 only publishes them, it never builds, stamps or persists a record.

export const GATE_VERDICTS = Object.freeze(['pass', 'fail'])
export const GATE_SEVERITIES = Object.freeze(['blocker', 'warn', 'info'])
export const GATE_STATUSES = Object.freeze(['draft', 'static-failed', 'static-passed', 'trial-done', 'awaiting-approval', 'approved', 'refused', 'activated'])
export const GATE_APPROVAL_STATES = Object.freeze(['none', 'asked', 'granted', 'refused'])
export const GATE_FINDING_KEYS = Object.freeze(['code', 'severity', 'field', 'message'])
export const GATE_RECORD_KEYS = Object.freeze(['id', 'automationId', 'status', 'staticChecks', 'trial', 'approval', 'updatedAt', 'rev'])

/** The schedule modes the scheduler acts on (index.js `kbSanitizeTaskInput`: anything else reads as `cron`). */
const GATE_MODES = Object.freeze(['cron', 'once', 'webhook'])

// The whole catalogue, in the order the findings come out: blockers, then warns, then infos. One entry is one
// code and one severity and one field — the single source of truth, so a message can never claim another
// severity than the table and a draft carrying `severity: 'info'` changes nothing.
const GATE_CATALOGUE = Object.freeze([
  // Blockers: any one of them fails the draft.
  Object.freeze(['draft.unreadable', 'blocker', 'draft']),
  Object.freeze(['gate.internal', 'blocker', 'draft']),
  Object.freeze(['name.missing', 'blocker', 'name']),
  Object.freeze(['name.too-long', 'blocker', 'name']),
  Object.freeze(['prompt.missing', 'blocker', 'prompt']),
  Object.freeze(['prompt.too-long', 'blocker', 'prompt']),
  Object.freeze(['schedule.missing', 'blocker', 'schedule']),
  Object.freeze(['schedule.mode', 'blocker', 'schedule.mode']),
  Object.freeze(['schedule.cron.invalid', 'blocker', 'schedule.cron']),
  Object.freeze(['schedule.cron.never-fires', 'blocker', 'schedule.cron']),
  Object.freeze(['schedule.cron.too-frequent', 'blocker', 'schedule.cron']),
  Object.freeze(['schedule.tz.unknown', 'blocker', 'schedule.tz']),
  Object.freeze(['schedule.at.invalid', 'blocker', 'schedule.at']),
  Object.freeze(['schedule.at.past', 'blocker', 'schedule.at']),
  Object.freeze(['prompt.unattended', 'blocker', 'prompt']),
  Object.freeze(['tools.unattended', 'blocker', 'tools']),
  Object.freeze(['gate.unapproved-activation', 'blocker', 'gate']),
  // Warns: the verdict stays `pass` when there is no blocker.
  Object.freeze(['approvals.auto', 'warn', 'approvals']),
  Object.freeze(['approvals.unknown', 'warn', 'approvals']),
  Object.freeze(['prompt.send.word', 'warn', 'prompt']),
  Object.freeze(['prompt.delete.word', 'warn', 'prompt']),
  Object.freeze(['prompt.pay.word', 'warn', 'prompt']),
  Object.freeze(['tools.write-capable', 'warn', 'tools']),
  Object.freeze(['needs.invalid', 'warn', 'needs']),
  Object.freeze(['needs.unknown-app', 'warn', 'needs']),
  Object.freeze(['needs.too-many', 'warn', 'needs']),
  Object.freeze(['needs.missing', 'warn', 'needs']),
  Object.freeze(['schedule.cron.frequent-confirmed', 'warn', 'schedule.cron']),
  // Infos: observations, never a decision.
  Object.freeze(['schedule.tz.machine', 'info', 'schedule.tz']),
  Object.freeze(['schedule.cron.ignored', 'info', 'schedule.cron']),
  Object.freeze(['schedule.cron.defaulted', 'info', 'schedule.cron']),
  Object.freeze(['activation.pending-approval', 'info', 'active']),
  Object.freeze(['needs.write-capable', 'info', 'needs']),
])

/** `code -> { severity, field }`, frozen entry by entry: the checks read it, they never pass a severity. */
export const GATE_CHECKS = Object.freeze(Object.assign({}, ...GATE_CATALOGUE.map(([code, severity, field]) => ({ [code]: Object.freeze({ severity, field }) }))))

/** The codes in catalogue order: the deterministic sort after the severity rank. */
export const GATE_CODE_ORDER = Object.freeze(GATE_CATALOGUE.map(([code]) => code))

/**
 * The cap on one answer. It equals the number of declared codes, so it can never bind: one finding per code
 * means the output size does not depend on the input size (a test asserts the equality, so a future code that
 * forgot its entry can never make truncation drop a blocker).
 */
export const GATE_FINDINGS_MAX = Object.keys(GATE_CHECKS).length

/** `automation_suggest`'s own name description: a bound, not a truncation (a longer name is a finding). */
export const GATE_NAME_MAX = 120
/** Same tool, prompt description: 8000 characters of steps. */
export const GATE_PROMPT_MAX = 8000
/** index.js `kbSanitizeTaskInput`: the route keeps the first 6 toolkit slugs. */
export const GATE_NEEDS_MAX = 6
/** Forward-looking bound on the optional `tools` field: the tool scan stops there. */
export const GATE_TOOLS_MAX = 32
/** index.js `kbIsValidTimeZone`: 1 to 64 characters. */
export const GATE_TZ_MAX = 64
/** index.js `kbParseCron`: an expression longer than this is refused before parsing. */
export const GATE_CRON_MAX = 200
/** index.js `KB_FREQUENT_MINUTES`: every run starts a real model session. */
export const GATE_FREQUENT_MINUTES = 5
/** A message is one English line; it is cut in code points so a multi-byte character is never cut in half. */
export const GATE_MESSAGE_MAX = 200
/** A field is a dotted path of the draft, bounded. */
export const GATE_FIELD_MAX = 80

/** Severity rank for the sort: blockers first. Private, like the index of a code. */
const GATE_RANK = Object.freeze({ blocker: 0, warn: 1, info: 2 })
const GATE_CODE_INDEX = Object.freeze(Object.assign({}, ...GATE_CODE_ORDER.map((code, i) => ({ [code]: i }))))

/** How many `needs` entries are inspected (a longer list is a bound defect anyway). */
const GATE_NEEDS_SCAN = 64
/** How many characters of one tool name are tokenized. */
const GATE_TOKEN_SCAN = 200

// ── KB-AUTOGATE-WORDS ───────────────────────────────────────────────────────
// The gate's English vocabulary is the engine's own write words (`KB_MCP_WRITE_WORDS`, index.js:765) plus the
// synonyms a person really writes in a prompt (`email`, `erase`, `clear`), and the unit suite proves that every
// other entry is a membership word by word against index.js itself. The French tables are the gate's own: the
// engine only ever reads English tool names, while `checkDraft` reads a human prompt, and a French prompt that
// sends or deletes must not slip through a table written in English only.
//
// The tokenizer is stem-free on purpose: a prompt token is compared to a table entry as a string, whole-token
// equality only, no prefix and no inflection — the same way the engine reads tool names (`kbIsReadName`). So
// `send` is caught and `sending` names nothing; `sent`, `paid` and `deleted` are not in the engine's table either.
// A French table therefore lists the forms people actually write (`envoie`, `envoyez`, `envoyer`), not a stem.
//
// Words the product treats as a read or as a formatting token stay out (`run`, `set`, `add`, `start`, `stop`,
// `type`, `click`, `format`, `evaluate`, `order`, `report`, `mark`, `check`): a gate whose warn fires on
// "in order to" is a gate people learn to ignore. `write` and `reply` are excluded on purpose — writing a DRAFT
// reply is exactly the gesture the gate recommends, so warning on it would punish the safe draft. `draft` is in
// no table. The same rule trims the French tables: no `poste` (a workstation), no `facture` (an invoice to
// prepare is the safe draft), no `vide` (an empty field) — only the gesture itself.
//
// Every table is frozen, and both tables of a family are read on every check: an English word first, then its
// French equivalent, so a prompt that mixes them is caught by whichever it uses.

export const GATE_SEND_WORDS = Object.freeze(new Set(['send', 'email', 'publish', 'submit', 'post', 'forward', 'share', 'invite', 'upload']))
export const GATE_DELETE_WORDS = Object.freeze(new Set(['delete', 'remove', 'erase', 'clear', 'trash', 'purge', 'empty', 'revoke']))
export const GATE_PAY_WORDS = Object.freeze(new Set(['pay', 'charge', 'refund', 'buy', 'sell', 'transfer', 'void']))

export const GATE_SEND_WORDS_FR = Object.freeze(new Set(['envoie', 'envoies', 'envoyez', 'envoyons', 'envoyer', 'envoi', 'envoye', 'envoyee', 'envoyes', 'envoyees', 'mail', 'courriel', 'transmets', 'transmettez', 'transmettre', 'partage', 'partagez', 'partager', 'publie', 'publiez', 'publier', 'soumets', 'soumettez', 'soumettre', 'poster', 'postez', 'diffuse', 'diffusez', 'diffuser', 'expedie', 'expediez', 'expedier']))
export const GATE_DELETE_WORDS_FR = Object.freeze(new Set(['supprime', 'supprimes', 'supprimez', 'supprimons', 'supprimer', 'efface', 'effacez', 'effacer', 'retire', 'retirez', 'retirer', 'enleve', 'enlevez', 'enlever', 'detruis', 'detruisez', 'detruire', 'purge', 'purgez', 'purger', 'nettoie', 'nettoyez', 'nettoyer']))
export const GATE_PAY_WORDS_FR = Object.freeze(new Set(['paie', 'paye', 'payes', 'payez', 'payons', 'payer', 'paiement', 'rembourse', 'remboursez', 'rembourser', 'achete', 'achetez', 'acheter', 'vends', 'vendez', 'vendre', 'virement', 'preleve', 'prelevement', 'debite', 'debiter', 'encaisse', 'encaisser']))

// The tables of one family, in the order a message looks them up: English, then French.
const GATE_SEND_TABLES = Object.freeze([GATE_SEND_WORDS, GATE_SEND_WORDS_FR])
const GATE_DELETE_TABLES = Object.freeze([GATE_DELETE_WORDS, GATE_DELETE_WORDS_FR])
const GATE_PAY_TABLES = Object.freeze([GATE_PAY_WORDS, GATE_PAY_WORDS_FR])

/**
 * Composio toolkit slugs whose hint words name the app in a prompt (`needs.missing`). Declaration order is the
 * order the message lists apps in, so the answer is stable. Advisory only: the route decides what a run gets.
 */
export const GATE_APP_HINTS = Object.freeze({
  gmail: Object.freeze(['gmail', 'inbox']),
  googlecalendar: Object.freeze(['calendar', 'googlecalendar', 'gcal']),
  googledrive: Object.freeze(['drive', 'googledrive']),
  slack: Object.freeze(['slack']),
  notion: Object.freeze(['notion']),
  stripe: Object.freeze(['stripe']),
  hubspot: Object.freeze(['hubspot']),
  airtable: Object.freeze(['airtable']),
})

/**
 * The connectors of `GATE_APP_HINTS` whose own tools move money or write into a system other people read. The
 * info `needs.write-capable` names them. `gmail` is deliberately NOT here: a digest that only reads threads is
 * the safe draft this gate recommends (a weekly inbox digest must pass with no finding), so warning on it would
 * punish the good case; the prompt word families already catch the step that would send.
 */
export const GATE_WRITE_APPS = Object.freeze(new Set(['stripe', 'slack', 'hubspot', 'airtable']))

/** A Composio toolkit slug as `kbSanitizeTaskInput` accepts it (index.js:460). */
const GATE_SLUG_RE = /^[a-z0-9_-]{2,40}$/
/** The only shapes a value may take inside a message (a tool name, a connector slug). */
const GATE_SAFE_TOKEN_RE = /^[a-z0-9_.-]{1,80}$/

/**
 * The tokens of a text: lower case, diacritics folded, split on anything outside `[a-z0-9]`. A set, so a lookup
 * is one pass.
 *
 * Folding is what makes an ASCII table readable against a French prompt: `supprimé`, `envoyée`, `transférer` and
 * `payé` tokenize as their accent-free forms, and an elided article splits (`l'envoi` is `l` and `envoi`, so the
 * negative `n'envoie pas` still names `envoie`). It costs nothing in English, where there is nothing to fold.
 */
export const gateWords = (text) => {
  const out = new Set()
  if (typeof text !== 'string' || text === '') return out
  const folded = text.toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  for (const word of folded.split(/[^a-z0-9]+/)) if (word !== '') out.add(word)
  return out
}

/**
 * The product's own safety sentence, written into the wake-up prompt of Kaby (kybernos-kaby-customisation). It FORBIDS the very words the word checks look for, so the checks read the prompt
 * without it (UJ-166): the person who approves the wake-up was shown two warnings about a sentence that says the opposite. Exactly these sentences and nothing broader: « never send it »
 * beside something else, or a prompt that asks for a send, stays flagged.
 */
export const GATE_OWN_SAFETY_SENTENCES = Object.freeze(['Never send, publish, pay, install, schedule or switch anything on.'])
const gateWithoutOwnSafety = (text) => GATE_OWN_SAFETY_SENTENCES.reduce((out, sentence) => out.split(sentence).join(' '), text)

/** Is one entry of `set` a token of `tokens`? Whole-token equality, as `kbIsReadName` reads a tool name. */
export const gateHasWord = (set, tokens) => {
  if (set === null || typeof set !== 'object' || typeof set.has !== 'function') return false
  if (tokens === null || typeof tokens !== 'object' || typeof tokens.has !== 'function') return false
  for (const word of set) if (tokens.has(word) === true) return true
  return false
}

// The FIRST entry of the table a token equals, in declaration order: the `{word}` of a message is stable
// across calls and across implementations.
const gateFirstWord = (set, tokens) => {
  for (const word of set) if (tokens.has(word) === true) return word
  return null
}

// The first word of ONE family, its English table before its French one: a prompt written in either language (or
// in both) is caught, and a word the two tables share is reported in the English spelling.
const gateFirstWordOf = (tables, tokens) => {
  for (const table of tables) {
    const word = gateFirstWord(table, tokens)
    if (word !== null) return word
  }
  return null
}

// The first write word of a token set, families in declaration order (send, then delete, then pay): one value
// even when a prompt names several gestures.
const gateFirstWriteWord = (tokens) => {
  const send = gateFirstWordOf(GATE_SEND_TABLES, tokens)
  if (send !== null) return send
  const del = gateFirstWordOf(GATE_DELETE_TABLES, tokens)
  if (del !== null) return del
  return gateFirstWordOf(GATE_PAY_TABLES, tokens)
}

// The first tool of a list whose own name carries a write word; null when none does.
const gateFirstWriteTool = (tools) => {
  for (const tool of tools) {
    if (typeof tool !== 'string') continue
    if (gateFirstWriteWord(gateWords(tool.slice(0, GATE_TOKEN_SCAN))) !== null) return tool
  }
  return null
}

// A value a message may quote, or the word that stands for it. Text of the draft never reaches a message.
const gateSafeToken = (value, fallback) => (typeof value === 'string' && GATE_SAFE_TOKEN_RE.test(value) === true ? value : fallback)

// ── KB-AUTOGATE-CRON ────────────────────────────────────────────────────────
// A verified copy of the scheduler's own grammar (index.js `kbParseCronField` / `kbParseCron`,
// `kbCronGapMinutes`, `kbCronCanFire`). Only the calendar arithmetic differs: the host uses `Date`, this module
// has no clock and no `Date` at all, so days are counted by the Gregorian rules themselves (see gateDaysFromCivil).

const GATE_HOUR_MS = 3600000
const GATE_DAY_MS = 86400000

/** Days in a month of the proleptic Gregorian calendar (the leap rule, not a `Date` roll-over). */
const gateDaysInMonth = (y, mo) => {
  if (mo === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28
  return mo === 4 || mo === 6 || mo === 9 || mo === 11 ? 30 : 31
}

/** Days since 1970-01-01 of a civil date (Howard Hinnant's `days_from_civil`, arithmetic only). */
const gateDaysFromCivil = (y, mo, d) => {
  const yy = mo <= 2 ? y - 1 : y
  const era = Math.floor(yy / 400)
  const yoe = yy - era * 400
  const mp = (mo + 9) % 12
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

/** The civil date and weekday (0 = Sunday, as `getUTCDay`) of a day count. */
const gateCivilFromDays = (days) => {
  const z = days + 719468
  const era = Math.floor(z / 146097)
  const doe = z - era * 146097
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365)
  const y = yoe + era * 400
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100))
  const mp = Math.floor((5 * doy + 2) / 153)
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1
  const mo = mp < 10 ? mp + 3 : mp - 9
  return { y: mo <= 2 ? y + 1 : y, mo, d, dow: ((days % 7) + 11) % 7 }
}

// Five fields: minute hour day-of-month month day-of-week. Each field is a comma list of `*`, `n`, `a-b`, `*/n`,
// `a-b/n` or `a/n`, digits only (no names, no empty element, no `L`/`#`). Day-of-week is 0-7 (0 and 7 are
// Sunday). As in Vixie cron, a field that STARTS with `*` counts as unrestricted, and when both day fields are
// restricted either one is enough.
const gateParseCronField = (spec, min, max, wrap7) => {
  const body = String(spec).trim()
  if (/^[0-9*,/-]+$/.test(body) === false) return null
  const set = new Set()
  for (const piece of body.split(',')) {
    const m = /^(?:(\*)|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(piece)
    if (m === null) return null
    const step = m[4] === undefined ? 1 : parseInt(m[4], 10)
    if (step <= 0) return null
    let lo = min
    let hi = max
    if (m[1] !== '*') {
      lo = parseInt(m[2], 10)
      hi = m[3] !== undefined ? parseInt(m[3], 10) : (m[4] !== undefined ? max : lo) // "5/2" = from 5 to the max
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo < min || hi > max || lo > hi) return null
    for (let v = lo; v <= hi; v += step) set.add(wrap7 === true && v === 7 ? 0 : v)
  }
  return set.size > 0 ? set : null
}

/** A cron expression → the five field sets (+ `domStar`/`dowStar`), or null when it is not one. */
export const gateParseCron = (expr) => {
  const text = String(expr || '').trim()
  if (text.length > GATE_CRON_MAX) return null
  const parts = text.split(/\s+/)
  if (parts.length !== 5) return null
  const minute = gateParseCronField(parts[0], 0, 59, false)
  const hour = gateParseCronField(parts[1], 0, 23, false)
  const dom = gateParseCronField(parts[2], 1, 31, false)
  const mon = gateParseCronField(parts[3], 1, 12, false)
  const dow = gateParseCronField(parts[4], 0, 7, true)
  if (minute === null || hour === null || dom === null || mon === null || dow === null) return null
  return { minute, hour, dom, mon, dow, domStar: parts[2].charAt(0) === '*', dowStar: parts[4].charAt(0) === '*' }
}

// The gap of an already parsed cron, so one check parses once.
const gateGapOfParsed = (f) => {
  const slots = []
  for (const h of Array.from(f.hour).sort((a, b) => a - b)) { for (const mi of Array.from(f.minute).sort((a, b) => a - b)) slots.push(h * 60 + mi) }
  let gap = Infinity
  for (let i = 1; i < slots.length; i += 1) gap = Math.min(gap, slots[i] - slots[i - 1])
  // Across midnight, only when the next day fires as well (every day of every month).
  if (slots.length > 0 && f.dom.size === 31 && f.dow.size === 7 && f.mon.size === 12) gap = Math.min(gap, slots[0] + 1440 - slots[slots.length - 1])
  return gap
}

/**
 * The shortest gap, in minutes, between two runs of a cron, or `Infinity` when a run is always alone.
 * `null` — not `Infinity` — for an expression this cannot parse: "unknown" and "always alone" stay distinct
 * (the engine answers `Infinity` for both, index.js:365).
 */
export const gateCronGapMinutes = (expr) => {
  const f = gateParseCron(expr)
  return f === null ? null : gateGapOfParsed(f)
}

// Does this cron fire at all? The engine's own window: eight years from 2024-01-01, in UTC (`kbCronCanFire`,
// index.js:361 — the longest gap between two 29 Februaries is 8 years). No zone conversion is needed there:
// the window is UTC and a matching day always has fireable slots, so the answer is a day match.
const gateCanFireOfParsed = (f) => {
  const baseDay = gateDaysFromCivil(2024, 1, 1)
  const lastDay = baseDay + 366 * 8 + 2
  for (let day = baseDay; day <= lastDay; day += 1) {
    const c = gateCivilFromDays(day)
    if (f.mon.has(c.mo) === false) continue
    const domOk = f.domStar === true ? true : f.dom.has(c.d)
    const dowOk = f.dowStar === true ? true : f.dow.has(c.dow)
    const dayMatch = f.domStar === false && f.dowStar === false ? (domOk || dowOk) : (domOk && dowOk)
    if (dayMatch === false) continue
    if (day > baseDay) return true
    // The base instant is 2024-01-01T00:00, and a run must come strictly after it: only 00:00 is not one.
    let other = false
    for (const h of f.hour) if (h > 0) other = true
    for (const mi of f.minute) if (mi > 0) other = true
    if (other === true) return true
  }
  return false
}

/** Does this cron fire at all? A cron that never fires is refused, not stored asleep (`kbCronCanFire`). */
export const gateCronCanFire = (expr) => {
  const f = gateParseCron(expr)
  return f === null ? false : gateCanFireOfParsed(f)
}

/**
 * `YYYY-MM-DDTHH:MM` → `{ y, mo, d, h, mi }`, or null. Validated by arithmetic (Gregorian leap rule, days per
 * month): the module has no `Date`, and a `Date` would roll 31 February over to 3 March instead of refusing it.
 */
export const gateParseAt = (text) => {
  if (typeof text !== 'string') return null
  const body = text.trim()
  if (body.length > 40) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(body)
  if (m === null) return null
  const y = parseInt(m[1], 10)
  const mo = parseInt(m[2], 10)
  const d = parseInt(m[3], 10)
  const h = parseInt(m[4], 10)
  const mi = parseInt(m[5], 10)
  if (mo < 1 || mo > 12 || d < 1 || d > gateDaysInMonth(y, mo) || h > 23 || mi > 59) return null
  return { y, mo, d, h, mi }
}

// The wall time of a parsed one-off, read as UTC: the gate has no zone arithmetic (see the past check).
const gateAtMs = (at) => gateDaysFromCivil(at.y, at.mo, at.d) * GATE_DAY_MS + at.h * GATE_HOUR_MS + at.mi * 60000

// ── KB-AUTOGATE-ZONE ────────────────────────────────────────────────────────
// Mirror of `kbIsValidTimeZone` (index.js:228): a string of 1 to 64 characters that `Intl` accepts. One
// formatter per zone (building one costs far more than using it), cached exactly like index.js:219 and capped
// so a draft cannot grow the cache without bound.
const gateDtfCache = new Map()
const gateDtfOf = (tz) => {
  if (gateDtfCache.has(tz) === true) return gateDtfCache.get(tz)
  let dtf = null
  try { dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) } catch (e) { dtf = null }
  if (gateDtfCache.size > 200) gateDtfCache.clear()
  gateDtfCache.set(tz, dtf)
  return dtf
}

/**
 * Is this an IANA zone name? Canonicalization is NOT checked (`europe/paris` passes, `Intl` accepts it): the
 * canonical name depends on the ICU version, and determinism wins over a cosmetic finding.
 */
export const gateIsValidZone = (tz) => typeof tz === 'string' && tz.length > 0 && tz.length <= GATE_TZ_MAX && gateDtfOf(tz) !== null

// ── KB-AUTOGATE-DRAFT ───────────────────────────────────────────────────────
// Two shapes are accepted, and only these: the `automation_suggest` payload (flat `cron` + `timezone`,
// automation-tools.mjs:75-80) and a task-shaped draft (`schedule`). When both are present `schedule` wins,
// silently: one draft has one schedule, and reporting the ignored flat cron would invent a defect.

// A text field: trimmed, control characters dropped, NOT truncated (a bound is a finding, not a silent cut).
// `\t` and `\n` are kept: they separate tokens, and a prompt is a list of numbered steps.
const gateText = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim() : '')

// A schedule field: undefined when absent (or an empty string, which the route treats as absent), as given else.
const gateGiven = (v) => (v === undefined || v === null || v === '' ? undefined : v)

const gateNormalizeSchedule = (raw) => {
  const sc = raw.schedule
  const flat = gateGiven(raw.cron) !== undefined
  let source = null
  if (sc !== null && sc !== undefined && typeof sc === 'object' && Array.isArray(sc) === false) source = sc
  else if (sc !== null && sc !== undefined) return null // a schedule that is not an object: one defect, `schedule.missing`
  else if (flat === true) {
    return Object.freeze({
      mode: 'cron',
      tz: gateGiven(raw.timezone),
      cron: raw.cron,
    })
  } else return null
  // A task-shaped draft: the route's own default for a missing mode (`sc.mode === 'once' ? ... : 'cron'`).
  const mode = source.mode === undefined || source.mode === null || source.mode === '' ? 'cron' : source.mode
  const out = { mode, tz: gateGiven(source.tz) }
  if (gateGiven(source.cron) !== undefined) out.cron = source.cron
  if (gateGiven(source.at) !== undefined) out.at = source.at
  return Object.freeze(out)
}

/**
 * A draft (tool payload or task-shaped) → the canonical draft, or null when it is not an object. Never throws.
 *
 * The normalized draft carries the two facts the route itself stores (`name`, `prompt`, `schedule`, `needs`,
 * `approvals`) plus the raw value of `approvals` (`approvalsGiven`), because a value the route rewrites to 'ask'
 * is still a defect worth one line. A `needs` that is present but not an array is kept as given, for the same
 * reason; a `tools` that is not an array reads as absent (there is no finding for its shape).
 */
export const normalizeDraft = (raw) => {
  try { return gateNormalize(raw) } catch (e) { return null }
}

const gateNormalize = (raw) => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const needsGiven = raw.needs
  const needs = needsGiven === undefined || needsGiven === null ? null : (Array.isArray(needsGiven) === true ? Object.freeze(needsGiven.slice(0, GATE_NEEDS_SCAN)) : needsGiven)
  const toolsGiven = raw.tools
  const tools = Array.isArray(toolsGiven) === true ? Object.freeze(toolsGiven.slice(0, GATE_TOOLS_MAX)) : null
  return Object.freeze({
    name: gateText(raw.name),
    prompt: gateText(raw.prompt),
    schedule: gateNormalizeSchedule(raw),
    needs,
    tools,
    approvals: raw.approvals === 'auto' ? 'auto' : 'ask', // index.js:449
    approvalsGiven: raw.approvals,
    active: raw.active === true,
    confirmFrequent: raw.confirmFrequent === true,
  })
}

// ── KB-AUTOGATE-CHECKS ──────────────────────────────────────────────────────
// One small function per family: each is pure over the normalized draft (`d`) and a context (`ctx`: the prompt
// tokens computed once, `nowMs` and the gate record as the caller passed them), each returns an array of
// `{ code, message }`. Severity and field are looked up afterwards; a message never quotes the draft.

const gateCheckName = (d) => {
  if (d.name === '') return [{ code: 'name.missing', message: 'name is empty: the automation would have no title.' }]
  if (d.name.length > GATE_NAME_MAX) return [{ code: 'name.too-long', message: 'name is longer than ' + GATE_NAME_MAX + ' characters.' }]
  return []
}

const gateCheckPrompt = (d) => {
  if (d.prompt === '') return [{ code: 'prompt.missing', message: 'prompt is empty: the run would have no steps.' }]
  if (d.prompt.length > GATE_PROMPT_MAX) return [{ code: 'prompt.too-long', message: 'prompt is longer than ' + GATE_PROMPT_MAX + ' characters.' }]
  return []
}

const gateCheckSchedule = (d) => {
  const s = d.schedule
  if (s === null) return [{ code: 'schedule.missing', message: 'the draft has no schedule: a cron, a one-off date or a webhook is needed.' }]
  if (GATE_MODES.indexOf(s.mode) < 0) return [{ code: 'schedule.mode', message: 'schedule.mode must be one of cron, once, webhook.' }]
  return []
}

// The cron: invalid, then never fires, then too frequent — in that order, so a cron that can never run is
// reported as such instead of being called frequent (`0 0 31 2 *` has no gap at all). A cron field is validated
// in EVERY mode: in `cron` mode it is the schedule, and in `once`/`webhook` mode it is a value the draft carries,
// so a bogus one is still a defect the draft must not ship (the route just drops it silently otherwise).
const gateCheckCron = (d) => {
  const s = d.schedule
  if (s === null) return []
  if (s.cron === undefined) {
    // Only the cron mode defaults; a one-off without a cron is the normal shape of a one-off.
    if (s.mode !== 'cron') return []
    return [{ code: 'schedule.cron.defaulted', message: 'no cron: the route stores every day at 8, which may not be the hour the person meant.' }]
  }
  const f = gateParseCron(s.cron)
  if (f === null) return [{ code: 'schedule.cron.invalid', message: 'the cron is not five fields of digits, *, lists, ranges and steps.' }]
  // Past the grammar, only the cron mode reads the expression; the other modes report it as unused below.
  if (s.mode !== 'cron') return []
  if (gateCanFireOfParsed(f) === false) return [{ code: 'schedule.cron.never-fires', message: 'that cron never fires: no date in the next eight years matches it.' }]
  const gap = gateGapOfParsed(f)
  if (gap >= GATE_FREQUENT_MINUTES) return []
  // Below the bound the scheduler refuses the request unless the person confirmed it (index.js:383 uses `>=`).
  if (d.confirmFrequent === true) return [{ code: 'schedule.cron.frequent-confirmed', message: 'this runs every ' + gap + ' minute(s), and the person confirmed it: every run starts a model session.' }]
  return [{ code: 'schedule.cron.too-frequent', message: 'the shortest gap between two runs is ' + gap + ' minute(s): below ' + GATE_FREQUENT_MINUTES + ", every run starts a model session and needs the person's confirmation." }]
}

// A cron field in a mode that never reads one: `webhook` fires on the hook, `once` on `at`. Saying so is an
// observation, not a decision — but it must be said, because a one-off carrying a bogus cron used to pass in
// silence, the exact draft whose author believed the cron was what would run.
const gateCheckCronUnused = (d) => {
  const s = d.schedule
  if (s === null || s.cron === undefined) return []
  if (s.mode === 'webhook') return [{ code: 'schedule.cron.ignored', message: 'a cron is present and schedule.mode is webhook: the cron is never used.' }]
  if (s.mode === 'once') return [{ code: 'schedule.cron.ignored', message: 'a cron is present and schedule.mode is once: the one-off date wins and the cron is never used.' }]
  return []
}

const gateCheckZone = (d) => {
  const s = d.schedule
  if (s === null) return []
  if (s.tz !== undefined && gateIsValidZone(s.tz) === false) return [{ code: 'schedule.tz.unknown', message: 'that time zone is not an IANA zone name.' }]
  if ((s.mode === 'cron' || s.mode === 'once') && s.tz === undefined) return [{ code: 'schedule.tz.machine', message: "no time zone: the machine's own is used, which is not the same on a laptop and on a cloud computer." }]
  return []
}

const gateCheckAt = (d, ctx) => {
  const s = d.schedule
  if (s === null || s.mode !== 'once') return []
  const at = gateParseAt(s.at)
  if (at === null) return [{ code: 'schedule.at.invalid', message: 'a one-off date is YYYY-MM-DDTHH:MM, on a date that exists.' }]
  // Only when the caller gave a clock (`nowMs`): this module has none of its own. The wall time is read as UTC
  // (the gate carries no zone conversion, and importing one would make the answer depend on the tz database);
  // the scheduler's own clock arbitrates at the tick, so a one-off that passed less than a zone offset ago is
  // not flagged here — a miss, never a refusal of a date that is still ahead in UTC.
  if (ctx.nowMs !== null && gateAtMs(at) <= ctx.nowMs) return [{ code: 'schedule.at.past', message: 'that one-off date is in the past: it would never run.' }]
  return []
}

const gateCheckUnattended = (d, ctx) => {
  if (d.approvals !== 'auto') return []
  const word = gateFirstWriteWord(ctx.tokens)
  if (word === null) return []
  return [{ code: 'prompt.unattended', message: "the prompt names " + word + " and approvals is 'auto': the run would act without asking. Write the step as a draft the person sends." }]
}

const gateCheckToolsUnattended = (d) => {
  if (d.approvals !== 'auto' || d.tools === null) return []
  const tool = gateFirstWriteTool(d.tools)
  if (tool === null) return []
  return [{ code: 'tools.unattended', message: "the tool " + gateSafeToken(tool, 'a tool') + " can change something outside the session and approvals is 'auto': the run would act without asking." }]
}

// Invariant #1, through data: a record that claims approval without a granted approval is refused; the
// `active` flag is only observed, never interpreted as permission.
const gateCheckGateRecord = (d, ctx) => {
  const out = []
  const g = ctx.gate
  const granted = g !== null && g.approval !== null && typeof g.approval === 'object' && g.approval.state === 'granted'
  if (g !== null && (g.status === 'approved' || g.status === 'activated') && granted === false) {
    out.push({ code: 'gate.unapproved-activation', message: 'the gate record is ' + g.status + " with no recorded human approval: activation only follows approval.state 'granted'." })
  }
  if (d.active === true && granted === false) {
    out.push({ code: 'activation.pending-approval', message: 'the draft is switched on; nothing here activates it: the flip follows a granted approval on the gate record.' })
  }
  return out
}

const gateCheckApprovals = (d) => {
  const out = []
  if (d.approvals === 'auto') out.push({ code: 'approvals.auto', message: "approvals is 'auto': no run pauses for the person. Acceptable only for read-only work." })
  const given = d.approvalsGiven
  if (given !== undefined && given !== 'ask' && given !== 'auto') out.push({ code: 'approvals.unknown', message: "approvals is neither 'ask' nor 'auto': the route stores 'ask'." })
  return out
}

const gateCheckWords = (d, ctx) => {
  const out = []
  const send = gateFirstWordOf(GATE_SEND_TABLES, ctx.tokens)
  if (send !== null) out.push({ code: 'prompt.send.word', message: 'the prompt names ' + send + ': an automation prepares and asks, it does not send or publish by itself.' })
  const del = gateFirstWordOf(GATE_DELETE_TABLES, ctx.tokens)
  if (del !== null) out.push({ code: 'prompt.delete.word', message: "the prompt names " + del + ": deleting is irreversible and stays the person's gesture." })
  const pay = gateFirstWordOf(GATE_PAY_TABLES, ctx.tokens)
  if (pay !== null) out.push({ code: 'prompt.pay.word', message: 'the prompt names ' + pay + ': money never leaves on a schedule.' })
  return out
}

const gateCheckTools = (d) => {
  if (d.tools === null) return []
  const tool = gateFirstWriteTool(d.tools)
  if (tool === null) return []
  return [{ code: 'tools.write-capable', message: 'the tool ' + gateSafeToken(tool, 'a tool') + ' can change something outside the session: its steps must prepare drafts.' }]
}

const gateCheckNeeds = (d, ctx) => {
  const needs = d.needs
  const out = []
  if (needs !== null && Array.isArray(needs) === false) {
    // The shape is the primary defect: what the draft needs cannot be read, so no coverage is claimed either.
    return [{ code: 'needs.invalid', message: 'needs must be an array of Composio toolkit slugs.' }]
  }
  if (Array.isArray(needs) === true) {
    let bad = 0
    for (const entry of needs) if (typeof entry !== 'string' || GATE_SLUG_RE.test(entry) === false) bad += 1
    if (bad > 0) out.push({ code: 'needs.unknown-app', message: bad + ' toolkit slug(s) are not slugs (2 to 40 characters of a-z, 0-9, _ or -): the route drops them.' })
    if (needs.length > GATE_NEEDS_MAX) out.push({ code: 'needs.too-many', message: 'needs lists more than ' + GATE_NEEDS_MAX + ' toolkits: the route keeps the first ' + GATE_NEEDS_MAX + '.' })
    const covered = new Set()
    for (const entry of needs) if (typeof entry === 'string') covered.add(entry)
    let writeApp = null
    for (const entry of needs) if (writeApp === null && typeof entry === 'string' && GATE_WRITE_APPS.has(entry) === true) writeApp = entry
    if (writeApp !== null) out.push({ code: 'needs.write-capable', message: 'the connector ' + writeApp + ' can change something outside the session: its steps must prepare drafts.' })
    const apps = []
    for (const slug of Object.keys(GATE_APP_HINTS)) {
      if (apps.length >= 2) break
      if (covered.has(slug) === true) continue
      if (gateHasWord(GATE_APP_HINTS[slug], ctx.tokens) === true) apps.push(slug)
    }
    if (apps.length > 0) out.push({ code: 'needs.missing', message: 'the prompt names ' + apps.join(', ') + ' and needs does not list it: the run would look for a connector it was not given.' })
  }
  return out
}

// Every family, in catalogue order (the sort below makes the order of this list harmless).
const GATE_CHECKS_RUN = Object.freeze([
  gateCheckName, gateCheckPrompt, gateCheckSchedule, gateCheckCron, gateCheckCronUnused, gateCheckZone, gateCheckAt,
  gateCheckUnattended, gateCheckToolsUnattended, gateCheckGateRecord,
  gateCheckApprovals, gateCheckWords, gateCheckTools, gateCheckNeeds,
])

// A message is bounded in CODE POINTS, so a multi-byte character is never cut in half.
const gateBound = (text, max) => (text.length <= max ? text : Array.from(text).slice(0, max).join(''))

const gateFindingOf = (code, message) => {
  const entry = GATE_CHECKS[code]
  return Object.freeze({
    code,
    severity: entry.severity,
    field: entry.field,
    message: gateBound(String(message), GATE_MESSAGE_MAX),
  })
}

// One finding per code, sorted by severity rank then by catalogue order, capped at the provably non-binding
// maximum, every finding frozen and the answer frozen: a caller cannot mutate a verdict into a pass.
const gateResultOf = (findings) => {
  const seen = new Set()
  const unique = []
  for (const f of findings) { if (seen.has(f.code) === false) { seen.add(f.code); unique.push(f) } }
  unique.sort((a, b) => (GATE_RANK[a.severity] - GATE_RANK[b.severity]) || (GATE_CODE_INDEX[a.code] - GATE_CODE_INDEX[b.code]))
  const kept = unique.slice(0, GATE_FINDINGS_MAX)
  let fail = false
  for (const f of kept) if (f.severity === 'blocker') fail = true
  return Object.freeze({ verdict: fail === true ? 'fail' : 'pass', findings: Object.freeze(kept) })
}

/**
 * The checks. Never throws. `options` is optional: `{ nowMs?, gate? }`.
 *
 *   nowMs  an integer clock, the ONLY check that needs one (`schedule.at.past`); without it, no past-date check
 *          runs at all — this module has no clock.
 *   gate   a GateRecord (or anything shaped like one). Its status and its approval are read, never written.
 *
 * Returns `{ verdict, findings }`: `fail` iff at least one finding is a `blocker`. Every internal exception is
 * caught and becomes the single blocker `gate.internal` — fail closed, never fail open.
 */
export const checkDraft = (draft, options = {}) => {
  try {
    const o = options !== null && typeof options === 'object' ? options : {}
    const d = gateNormalize(draft)
    if (d === null) return gateResultOf([gateFindingOf('draft.unreadable', 'the draft is not an object: nothing can be certified.')])
    const nowMs = Number.isInteger(o.nowMs) === true ? o.nowMs : null
    const gate = o.gate !== null && typeof o.gate === 'object' && Array.isArray(o.gate) === false ? o.gate : null
    // The prompt is tokenized once, on a bounded window: a longer prompt is already a blocker (`prompt.too-long`).
    const tokens = gateWords(gateWithoutOwnSafety(d.prompt.length > GATE_PROMPT_MAX ? d.prompt.slice(0, GATE_PROMPT_MAX) : d.prompt))
    const ctx = { tokens, nowMs, gate }
    const found = []
    for (const check of GATE_CHECKS_RUN) {
      const out = check(d, ctx)
      if (Array.isArray(out) === false) continue
      for (const item of out) if (GATE_CHECKS[item.code] !== undefined) found.push(gateFindingOf(item.code, item.message))
    }
    return gateResultOf(found)
  } catch (e) {
    return gateResultOf([gateFindingOf('gate.internal', 'the checks could not complete: this draft is not certified.')])
  }
}

// ── KB-AUTOGATE-SUMMARY ─────────────────────────────────────────────────────
/**
 * Counts for a badge: severity is looked up by CODE (never read from the finding), and an unknown code counts as
 * an info, so a caller from a later batch can summarize a list it did not produce.
 */
export const gateSummary = (findings) => {
  const out = { blockers: 0, warnings: 0, infos: 0, total: 0 }
  if (Array.isArray(findings) === false) return out
  for (const f of findings) {
    if (f === null || typeof f !== 'object' || typeof f.code !== 'string') continue
    const entry = GATE_CHECKS[f.code]
    const severity = entry === undefined ? 'info' : entry.severity
    if (severity === 'blocker') out.blockers += 1
    else if (severity === 'warn') out.warnings += 1
    else out.infos += 1
    out.total += 1
  }
  return out
}
