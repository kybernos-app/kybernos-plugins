// Suggested automations: the pure rules (automation-suggest.mjs). The route and the scheduler are covered by scripts/test-tasks-route.mjs.
import { proofOf, isSuggested, suggestedTask, acceptedTask, refusalFor, SUGGESTED_MAX } from './automation-suggest.mjs'

let fails = 0
const eq = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) { fails++; console.log('FAIL', label, '| got', JSON.stringify(got), '| want', JSON.stringify(want)) } else console.log('ok  ', label) }

eq('no proof is null', [proofOf(null), proofOf('x'), proofOf({})], [null, null, null])
eq('a count, a period, a place and a note are kept', proofOf({ n: 14.4, span: '60 days', where: 'Gmail', note: 'same request' }), { n: 14, span: '60 days', where: 'Gmail', note: 'same request' })
eq('a count is bounded and never negative', [proofOf({ n: 1e12 }).n, proofOf({ n: -5 }).n], [100000, 0])
eq('texts are cut and control characters dropped', [proofOf({ span: 'x'.repeat(99) }).span.length, proofOf({ note: 'a\u0000b' }).note], [40, 'ab'])
eq('a suggestion is switched off, flagged and says where it came from', (() => { const t = suggestedTask({ name: 'N', prompt: 'P', active: true }, { n: 3 }, '2026-10-22T00:00:00.000Z'); return [t.active, t.suggested, t.origin.by, t.origin.proof.n, t.origin.at] })(), [false, true, 'kaby', 3, '2026-10-22T00:00:00.000Z'])
eq('isSuggested reads the flag only', [isSuggested({ suggested: true }), isSuggested({ suggested: 'yes' }), isSuggested(null), isSuggested({})], [true, false, false, false])
eq('Add drops the flag, keeps the automation off, keeps the origin', (() => { const t = acceptedTask(suggestedTask({ name: 'N', prompt: 'P' }, null, 'a'), 'b'); return [t.suggested, t.active, t.nextRun, t.acceptedAt, t.origin.by] })(), [undefined, false, null, 'b', 'kaby'])
eq('a name in use is refused whatever its case', refusalFor([{ name: 'Weekly Report' }], ' weekly report '), { ok: false, error: 'already exists' })
eq('a free name is accepted', refusalFor([{ name: 'Weekly Report' }], 'Other'), null)
eq('too many waiting suggestions are refused', refusalFor(Array.from({ length: SUGGESTED_MAX }, (_, i) => ({ name: 'n' + i, suggested: true })), 'fresh'), { ok: false, error: 'too many suggestions waiting' })

console.log(fails === 0 ? '\nall checks passed' : '\n' + fails + ' check(s) FAILED')
process.exit(fails === 0 ? 0 : 1)
