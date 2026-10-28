// test-automation-gate.mjs — B1 gate-static-checks: the pure certification checks.
// Joins scripts/run-all-tests.mjs discovery (packages/*/test*.mjs). No I/O, no network.

import { strict as assert } from 'node:assert'
import {
  GATE_VERDICTS, GATE_SEVERITIES, GATE_STATUSES, GATE_APPROVAL_STATES,
  GATE_FINDING_KEYS, GATE_RECORD_KEYS, GATE_CHECKS, GATE_CODE_ORDER,
  GATE_FINDINGS_MAX, GATE_SEND_WORDS, GATE_DELETE_WORDS, GATE_PAY_WORDS,
  GATE_SEND_WORDS_FR, GATE_DELETE_WORDS_FR, GATE_PAY_WORDS_FR,
  GATE_NAME_MAX, GATE_PROMPT_MAX, GATE_CRON_MAX, GATE_TZ_MAX,
  GATE_NEEDS_MAX, GATE_FIELD_MAX, GATE_MESSAGE_MAX, GATE_FREQUENT_MINUTES,
  checkDraft, normalizeDraft, gateSummary,
  gateParseCron, gateCronGapMinutes, gateCronCanFire, gateIsValidZone,
  gateHasWord, gateWords,
} from './automation-gate.mjs'

let n = 0
const ok = (label, cond) => { n += 1; assert.ok(cond, label); console.log('ok  ' + label) }
const eq = (label, a, b) => { n += 1; assert.deepStrictEqual(a, b, label); console.log('ok  ' + label) }

// ── 1. Frozen shapes ─────────────────────────────────────────────────────────

ok('GATE_VERDICTS is [pass, fail]', GATE_VERDICTS.length === 2 && GATE_VERDICTS.includes('pass') && GATE_VERDICTS.includes('fail'))
ok('GATE_SEVERITIES is [blocker, warn, info]', GATE_SEVERITIES.length === 3)
ok('GATE_STATUSES has 8 statuses', GATE_STATUSES.length === 8)
ok('GATE_APPROVAL_STATES has 4 states', GATE_APPROVAL_STATES.length === 4)
eq('GATE_FINDING_KEYS is the frozen four', [...GATE_FINDING_KEYS], ['code', 'severity', 'field', 'message'])
eq('GATE_RECORD_KEYS is the frozen eight', [...GATE_RECORD_KEYS], ['id', 'automationId', 'status', 'staticChecks', 'trial', 'approval', 'updatedAt', 'rev'])

// ── 2. Cap is provably non-binding ───────────────────────────────────────────

ok('GATE_FINDINGS_MAX equals |GATE_CHECKS| (one finding per code)', GATE_FINDINGS_MAX === Object.keys(GATE_CHECKS).length)
ok('GATE_CODE_ORDER has the same length as GATE_CHECKS', GATE_CODE_ORDER.length === Object.keys(GATE_CHECKS).length)
ok('GATE_FINDINGS_MAX is at least 20', GATE_FINDINGS_MAX >= 20)

// ── 3. Vocabulary: the engine's write words, plus the gate's own synonyms and French ─────────────────────────
// The engine's write words (index.js:765) — copied, not imported (different batch). `email`, `erase` and `clear`
// are the gate's own synonyms for a human prompt, and the French tables are the gate's alone (the engine only
// reads English tool names): the membership proof covers the rest, word by word.
const KB_MCP_WRITE_WORDS = new Set([
  'send', 'create', 'update', 'delete', 'remove', 'write', 'post', 'put', 'patch', 'add', 'append',
  'publish', 'submit', 'forward', 'share', 'invite', 'upload', 'trash', 'purge', 'empty', 'revoke',
  'pay', 'charge', 'refund', 'buy', 'sell', 'transfer', 'void',
])
const GATE_ONLY_SYNONYMS = new Set(['email', 'erase', 'clear'])
const KNOWN_WRITE_WORDS = new Set([...KB_MCP_WRITE_WORDS, ...GATE_ONLY_SYNONYMS])
ok('every GATE_SEND_WORDS entry is an engine write word or a documented synonym', [...GATE_SEND_WORDS].every((w) => KNOWN_WRITE_WORDS.has(w)))
ok('every GATE_DELETE_WORDS entry is an engine write word or a documented synonym', [...GATE_DELETE_WORDS].every((w) => KNOWN_WRITE_WORDS.has(w)))
ok('every GATE_PAY_WORDS entry is an engine write word', [...GATE_PAY_WORDS].every((w) => KB_MCP_WRITE_WORDS.has(w)))
ok('sent is NOT in GATE_SEND_WORDS (stem-free)', !GATE_SEND_WORDS.has('sent'))
ok('sending is NOT in GATE_SEND_WORDS (stem-free)', !GATE_SEND_WORDS.has('sending'))
ok('the three word tables and their French counterparts are frozen',
  [GATE_SEND_WORDS, GATE_DELETE_WORDS, GATE_PAY_WORDS, GATE_SEND_WORDS_FR, GATE_DELETE_WORDS_FR, GATE_PAY_WORDS_FR].every((s) => Object.isFrozen(s)))
ok('the French tables carry the send/delete/pay gestures', GATE_SEND_WORDS_FR.has('envoie') && GATE_DELETE_WORDS_FR.has('supprime') && GATE_PAY_WORDS_FR.has('payer'))
ok('a French table entry is accent-free (the tokenizer folds)', [...GATE_SEND_WORDS_FR, ...GATE_DELETE_WORDS_FR, ...GATE_PAY_WORDS_FR].every((w) => w === w.normalize('NFD').replace(/[\u0300-\u036f]/g, '')))

// ── 4. normalizeDraft ────────────────────────────────────────────────────────

ok('normalizeDraft(null) returns null', normalizeDraft(null) === null)
ok('normalizeDraft(42) returns null', normalizeDraft(42) === null)
ok('normalizeDraft({}) returns a normalized draft', normalizeDraft({}) !== null)
const nd = normalizeDraft({ name: 'Test', prompt: 'Do something', schedule: { mode: 'cron', cron: '0 8 * * 1' }, approvals: 'ask' })
ok('normalizeDraft returns name/prompt/schedule/approvals', nd !== null && typeof nd.name === 'string' && typeof nd.prompt === 'string')

// ── 5. checkDraft — happy path ───────────────────────────────────────────────

const goodDraft = { name: 'Weekly report', prompt: 'Compile the weekly report and save it as a draft.', schedule: { mode: 'cron', cron: '0 8 * * 1' }, approvals: 'ask' }
const goodResult = checkDraft(goodDraft, { nowMs: 1700000000000 })
ok('good draft passes', goodResult.verdict === 'pass')
ok('good draft has findings array', Array.isArray(goodResult.findings))
ok('good draft findings are bounded', goodResult.findings.length <= GATE_FINDINGS_MAX)

// ── 6. checkDraft — blockers ─────────────────────────────────────────────────

const sendDraft = { name: 'Send email', prompt: 'Send the digest to the team.', schedule: { mode: 'cron', cron: '0 8 * * 1' }, approvals: 'ask' }
const sendResult = checkDraft(sendDraft, { nowMs: 1700000000000 })
ok('prompt with send word yields a finding', sendResult.findings.length > 0)
const sendFinding = sendResult.findings.find((f) => f.code.includes('send') || f.code.includes('word'))
ok('send word produces a prompt.send.word finding', sendFinding !== undefined)

const autoDraft = { name: 'Auto run', prompt: 'Do something useful.', schedule: { mode: 'cron', cron: '0 8 * * 1' }, approvals: 'auto' }
const autoResult = checkDraft(autoDraft, { nowMs: 1700000000000 })
const autoFinding = autoResult.findings.find((f) => f.code.includes('unattended') || f.code.includes('auto'))
ok('approvals auto with unattended prompt yields a blocker', autoFinding !== undefined || autoResult.findings.length > 0)

const badCron = { name: 'Bad cron', prompt: 'Do something.', schedule: { mode: 'cron', cron: 'not-a-cron' }, approvals: 'ask' }
const badCronResult = checkDraft(badCron, { nowMs: 1700000000000 })
ok('bad cron yields a finding', badCronResult.findings.length > 0)

const noSchedule = { name: 'No sched', prompt: 'Do something.', approvals: 'ask' }
const noSchedResult = checkDraft(noSchedule, { nowMs: 1700000000000 })
ok('missing schedule yields a finding', noSchedResult.findings.length > 0)

// ── 6b. French prompts and the English synonyms ──────────────────────────────
// The adversarial case: a French prompt that sends and deletes, with approvals 'auto', used to pass with no
// blocker at all because the word tables were English-only.
const frenchAuto = { name: 'Rapport clients', prompt: 'Envoie le rapport par e-mail aux clients, puis supprime les brouillons.', schedule: { mode: 'cron', cron: '0 8 * * 1', tz: 'Europe/Paris' }, approvals: 'auto' }
const frenchAutoResult = checkDraft(frenchAuto)
ok('a French send/delete prompt with approvals auto FAILS', frenchAutoResult.verdict === 'fail')
ok('...with the unattended blocker (French send word found)', frenchAutoResult.findings.some((f) => f.code === 'prompt.unattended' && f.severity === 'blocker'))
ok('...and the French send gesture is named', frenchAutoResult.findings.some((f) => f.code === 'prompt.send.word' && f.message.includes('envoie')))
ok('...and the French delete gesture is named', frenchAutoResult.findings.some((f) => f.code === 'prompt.delete.word' && f.message.includes('supprime')))

const frenchAsk = { name: 'Rapport clients', prompt: 'Envoie le rapport par e-mail aux clients.', schedule: { mode: 'cron', cron: '0 8 * * 1', tz: 'Europe/Paris' }, approvals: 'ask' }
ok('a French send word is a warn when approvals is ask', checkDraft(frenchAsk).findings.some((f) => f.code === 'prompt.send.word'))

const frenchPay = { name: 'Factures', prompt: 'Paie les factures en retard chaque lundi.', schedule: { mode: 'cron', cron: '0 8 * * 1', tz: 'Europe/Paris' }, approvals: 'auto' }
ok('a French pay word fails with approvals auto', checkDraft(frenchPay).verdict === 'fail' && checkDraft(frenchPay).findings.some((f) => f.code === 'prompt.pay.word'))

// The tokenizer folds diacritics, so the participle forms people write are caught by the accent-free table.
const frenchFolded = { name: 'Nettoyage', prompt: 'Le rapport a été supprimé et envoyé hier.', schedule: { mode: 'cron', cron: '0 8 * * 1', tz: 'Europe/Paris' }, approvals: 'ask' }
ok('an accented French form folds onto the table (supprimé, envoyé)', checkDraft(frenchFolded).findings.some((f) => f.code === 'prompt.delete.word') && checkDraft(frenchFolded).findings.some((f) => f.code === 'prompt.send.word'))

const emailDraft = { name: 'Email the report', prompt: 'Email the report to the client every Monday.', schedule: { mode: 'cron', cron: '0 8 * * 1', tz: 'Europe/Paris' }, approvals: 'auto' }
const emailResult = checkDraft(emailDraft)
ok('"Email the report" is caught (email is a send word)', emailResult.verdict === 'fail' && emailResult.findings.some((f) => f.code === 'prompt.send.word' && f.message.includes('email')))

for (const [word, code] of [['erase', 'prompt.delete.word'], ['clear', 'prompt.delete.word'], ['remove', 'prompt.delete.word']]) {
  const d = { name: 'Cleanup', prompt: 'Please ' + word + ' the stale drafts.', schedule: { mode: 'cron', cron: '0 8 * * 1', tz: 'Europe/Paris' }, approvals: 'ask' }
  ok('"' + word + '" is a delete word', checkDraft(d).findings.some((f) => f.code === code))
}

// ── 6c. A cron field is validated and reported in EVERY mode ────────────────
// The adversarial case: a "once" draft carrying a bogus cron used to pass in silence — the cron was ignored
// without a word, so the author believed it was the schedule.
const onceBogus = { name: 'One-off', prompt: 'Compile the report and save it as a draft.', schedule: { mode: 'once', at: '2026-12-01T09:00', cron: 'not-a-cron', tz: 'Europe/Paris' }, approvals: 'ask' }
const onceBogusResult = checkDraft(onceBogus)
ok('a bogus cron in once mode is a BLOCKER, not silent', onceBogusResult.verdict === 'fail' && onceBogusResult.findings.some((f) => f.code === 'schedule.cron.invalid' && f.severity === 'blocker'))
ok('...and the unused cron is reported as info', onceBogusResult.findings.some((f) => f.code === 'schedule.cron.ignored' && f.severity === 'info'))

const onceValid = { name: 'One-off', prompt: 'Compile the report and save it as a draft.', schedule: { mode: 'once', at: '2026-12-01T09:00', cron: '0 8 * * 1', tz: 'Europe/Paris' }, approvals: 'ask' }
const onceValidResult = checkDraft(onceValid)
ok('a valid cron in once mode is still declared unused (info)', onceValidResult.findings.some((f) => f.code === 'schedule.cron.ignored') && onceValidResult.verdict === 'pass')

const oncePlain = { name: 'One-off', prompt: 'Compile the report and save it as a draft.', schedule: { mode: 'once', at: '2026-12-01T09:00', tz: 'Europe/Paris' }, approvals: 'ask' }
ok('a plain one-off has no cron finding at all', checkDraft(oncePlain).findings.every((f) => f.code !== 'schedule.cron.ignored' && f.code !== 'schedule.cron.invalid'))

const hookCron = { name: 'Hook', prompt: 'Compile the report and save it as a draft.', schedule: { mode: 'webhook', cron: '0 8 * * 1', tz: 'Europe/Paris' }, approvals: 'ask' }
ok('a cron in webhook mode is still declared unused (regression)', checkDraft(hookCron).findings.some((f) => f.code === 'schedule.cron.ignored'))

// ── 7. checkDraft — fail closed ──────────────────────────────────────────────

const nullResult = checkDraft(null, { nowMs: 1700000000000 })
ok('checkDraft(null) fails closed', nullResult.verdict === 'fail')
ok('checkDraft(null) has a blocker finding', nullResult.findings.some((f) => f.severity === 'blocker'))

const weirdResult = checkDraft({ name: 'x', prompt: 'y', schedule: { mode: 'cron', cron: '0 8 * * 1' }, approvals: 'ask', __proto__: { evil: true } }, { nowMs: 1700000000000 })
ok('checkDraft with proto pollution returns a valid result', weirdResult !== null && typeof weirdResult.verdict === 'string')

// ── 8. One finding per code ──────────────────────────────────────────────────

const manyIssues = {
  name: 'x'.repeat(500),
  prompt: 'Send delete pay charge refund buy sell transfer void publish submit forward share invite upload trash purge empty revoke. ' + 'x'.repeat(2000),
  schedule: { mode: 'cron', cron: 'bad' },
  approvals: 'auto',
}
const manyResult = checkDraft(manyIssues, { nowMs: 1700000000000 })
const codes = manyResult.findings.map((f) => f.code)
ok('one finding per code (no duplicates)', new Set(codes).size === codes.length)
ok('findings bounded by GATE_FINDINGS_MAX', manyResult.findings.length <= GATE_FINDINGS_MAX)
ok('findings have exactly the four keys', manyResult.findings.every((f) => Object.keys(f).every((k) => GATE_FINDING_KEYS.includes(k))))

// ── 9. Severity comes from GATE_CHECKS, not input ────────────────────────────

ok('every finding severity is in GATE_SEVERITIES', manyResult.findings.every((f) => GATE_SEVERITIES.includes(f.severity)))
ok('every finding field is a string', manyResult.findings.every((f) => typeof f.field === 'string'))
ok('every finding message is bounded', manyResult.findings.every((f) => f.message.length <= GATE_MESSAGE_MAX))

// ── 10. gateSummary ──────────────────────────────────────────────────────────

const summary = gateSummary(manyResult.findings)
ok('gateSummary returns blockers/warnings/infos/total', typeof summary.blockers === 'number' && typeof summary.warnings === 'number' && typeof summary.infos === 'number' && typeof summary.total === 'number')
ok('gateSummary total equals findings length', summary.total === manyResult.findings.length)
ok('gateSummary counts sum to total', summary.blockers + summary.warnings + summary.infos === summary.total)
eq('gateSummary([]) is all zeros', gateSummary([]), { blockers: 0, warnings: 0, infos: 0, total: 0 })

// ── 11. Verdict rule ─────────────────────────────────────────────────────────

ok('verdict is fail iff at least one blocker', manyResult.verdict === (summary.blockers > 0 ? 'fail' : 'pass'))
ok('good draft verdict is pass', goodResult.verdict === 'pass')

// ── 12. Determinism ──────────────────────────────────────────────────────────

const det1 = checkDraft(sendDraft, { nowMs: 1700000000000 })
const det2 = checkDraft(sendDraft, { nowMs: 1700000000000 })
eq('checkDraft is deterministic', det1, det2)

console.log('\nall ' + n + ' checks passed')
