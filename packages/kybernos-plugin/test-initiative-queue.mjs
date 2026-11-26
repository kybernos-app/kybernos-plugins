// The initiative queue (the door, the ledger) and the two agent tools that feed it: initiative_record parks an entry with
// the evidence that was measured, initiative_list reads what waits. Nothing here activates anything, and every rendered
// sentence says the entry waits for the person.
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { checkInitiative, makeInitiativeQueue, INITIATIVE_MAX, KEPT_MAX, LIMITS, RESOLVE_STATUSES, RISKS, REVERSIBILITY, STATUSES } from './initiative-queue.mjs'
import { SUGGESTED_MAX } from './automation-suggest.mjs'
import { PROMPT, toolDefinitions, mountAutomationTools } from './automation-tools.mjs'

let fails = 0
const eq = (label, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) { fails++; console.log('FAIL', label, '| got', JSON.stringify(got), '| want', JSON.stringify(want)) } else console.log('ok  ', label) }

// ---------- A. the door: pure, no file, flat in, nested out ----------
const base = { title: 'Reply to first enquiries with a template', n: 14, span: '60 days', where: 'Gmail › Contact form', risk: 'low', reversibility: 'trivial', nextAction: { summary: 'Draft three reply templates' } }
const good = checkInitiative(base)
eq('the door nests a flat call into the frozen shape, with a draft next action', [good.ok, good.entry], [true, { title: base.title, evidence: { n: 14, span: '60 days', where: 'Gmail › Contact form' }, risk: 'low', reversibility: 'trivial', nextAction: { kind: 'draft', summary: 'Draft three reply templates' } }])
eq('a title at the limit is accepted, one character more is refused', [checkInitiative(Object.assign({}, base, { title: 'a'.repeat(LIMITS.title) })).ok, checkInitiative(Object.assign({}, base, { title: 'a'.repeat(LIMITS.title + 1) })).error], [true, 'too long'])
eq('a blank title is refused', checkInitiative(Object.assign({}, base, { title: '   ' })).error, 'empty title')
eq('no evidence means no initiative', [0, -3, NaN, '14'].map((n) => checkInitiative(Object.assign({}, base, { n })).error), ['no evidence', 'no evidence', 'no evidence', 'no evidence'])
eq('a count over the bound is refused, not clamped', checkInitiative(Object.assign({}, base, { n: 1e12 })).error, 'no evidence')
eq('a count is rounded', checkInitiative(Object.assign({}, base, { n: 3.6 })).entry.evidence.n, 4)
eq('where you saw it is required', [checkInitiative(Object.assign({}, base, { where: '' })).error, checkInitiative(Object.assign({}, base, { where: undefined })).error], ['no evidence', 'no evidence'])
eq('risk has no default: a missing or unknown one is refused', [checkInitiative(Object.assign({}, base, { risk: 'huge' })).error, checkInitiative({ title: base.title, n: 14, where: 'Gmail', reversibility: 'trivial', nextAction: base.nextAction }).error], ['unknown risk', 'unknown risk'])
eq('reversibility has no default either', [checkInitiative(Object.assign({}, base, { reversibility: 'maybe' })).error, checkInitiative({ title: base.title, n: 14, where: 'Gmail', risk: 'low', nextAction: base.nextAction }).error], ['unknown reversibility', 'unknown reversibility'])
eq('a next action that is not a draft is refused', checkInitiative(Object.assign({}, base, { nextAction: { kind: 'send', summary: 'Send it' } })).error, 'next action must be a draft')
eq('an absent kind is filled with the only value that exists', checkInitiative(Object.assign({}, base, { nextAction: { summary: 'Draft it' } })).entry.nextAction, { kind: 'draft', summary: 'Draft it' })
eq('an empty next action is refused', checkInitiative(Object.assign({}, base, { nextAction: { summary: '   ' } })).error, 'empty next action')
eq('a summary at the limit is accepted, one character more is refused', [checkInitiative(Object.assign({}, base, { nextAction: { summary: 's'.repeat(LIMITS.summary) } })).ok, checkInitiative(Object.assign({}, base, { nextAction: { summary: 's'.repeat(LIMITS.summary + 1) } })).error], [true, 'too long'])
eq('personal data is refused in the title, the where and the summary', [checkInitiative(Object.assign({}, base, { title: 'Write to claire@example.com' })).error, checkInitiative(Object.assign({}, base, { where: 'call +33 6 12 34 56 78' })).error, checkInitiative(Object.assign({}, base, { nextAction: { summary: 'Open https://x.example/a?token=abc' } })).error], ['personal data', 'personal data', 'personal data'])
eq('control characters are stripped from every text', checkInitiative(Object.assign({}, base, { title: 'Draft\u0007 the reply', where: 'Gmail\u001b' })).entry, { title: 'Draft the reply', evidence: { n: 14, span: '60 days', where: 'Gmail' }, risk: 'low', reversibility: 'trivial', nextAction: { kind: 'draft', summary: 'Draft three reply templates' } })
eq('an emoji counts as one character, never split', [checkInitiative(Object.assign({}, base, { title: '🙏'.repeat(LIMITS.title) })).ok, checkInitiative(Object.assign({}, base, { title: '🙏'.repeat(LIMITS.title + 1) })).error], [true, 'too long'])
eq('span and where are clipped, not refused', checkInitiative(Object.assign({}, base, { span: 's'.repeat(99), where: 'w'.repeat(99) })).entry.evidence, { n: 14, span: 's'.repeat(LIMITS.span), where: 'w'.repeat(LIMITS.where) })

// ---------- B. the ledger: one file, atomic, bounded ----------
const dir = mkdtempSync(join(tmpdir(), 'kb-init-'))
const file = join(dir, 'kybernos', 'initiatives.json')
let made = 0
const q = makeInitiativeQueue({ file, now: () => '2026-10-28T00:00:00.000Z', newId: () => 'i_' + (made += 1) })
const entry = (title, extra) => Object.assign({ title, n: 3, span: '60 days', where: 'Gmail', risk: 'low', reversibility: 'trivial', nextAction: { summary: 'Draft a plan' } }, extra)

eq('the queue is exactly {list, add, resolve, cap}, as pinned', [Object.keys(q).sort(), q.cap, typeof q.cap], [['add', 'cap', 'list', 'resolve'], INITIATIVE_MAX, 'number'])
eq('the answers resolve accepts are the three pinned ones', [RESOLVE_STATUSES, STATUSES, RISKS, REVERSIBILITY], [['asked', 'added', 'dropped'], ['proposed', 'asked', 'added', 'dropped'], ['low', 'medium', 'high'], ['trivial', 'easy', 'hard']])
eq('the queue mirror the cap of the automation proposals', INITIATIVE_MAX, SUGGESTED_MAX)
eq('an empty queue lists nothing', q.list(), [])
const first = await q.add(entry('Reply to first enquiries'))
eq('a first initiative is proposed, with its evidence and the injected moment', [first.ok, first.item.id, first.item.status, first.item.at, first.item.nextAction.kind, first.item.evidence], [true, 'i_1', 'proposed', '2026-10-28T00:00:00.000Z', 'draft', { n: 3, span: '60 days', where: 'Gmail' }])
eq('the stored entry is the frozen shape and nothing more', Object.keys(first.item).sort(), ['at', 'evidence', 'id', 'nextAction', 'reversibility', 'risk', 'status', 'title'])
eq('the file is private and no temporary file is left', [(statSync(file).mode & 0o777).toString(8), readdirSync(dirname(file)).filter((x) => x.includes('.tmp-')).length], ['600', 0])
eq('the file envelope is the one of the suggestions ledger', [JSON.parse(readFileSync(file, 'utf8')).version, readFileSync(file, 'utf8').includes('\n  ')], [1, true])
eq('what waits is listed by default, and by name', [q.list().length, q.list('pending').length, q.list('proposed').length, q.list('asked').length], [1, 1, 1, 0])
eq('a title differing only by case, spacing or punctuation is the same initiative', (await q.add(entry('  reply TO first   enquiries '))).error, 'already queued')
eq('a pending title cannot come back with a higher count', (await q.add(entry('Reply to first enquiries', { n: 9 }))).error, 'already queued')
eq('an unknown status filter lists nothing, it never throws', q.list('nonsense'), [])
eq('dropping it answers the person and keeps the entry', [(await q.resolve('i_1', 'dropped')).item.status, q.list().length, q.list('dropped').length], ['dropped', 0, 1])
eq('a dropped initiative comes back only with new evidence', (await q.add(entry('Reply to first enquiries', { n: 3 }))).error, 'needs new evidence')
const again = await q.add(entry('Reply to first enquiries', { n: 21 }))
eq('...and a higher count creates a new entry, the dropped one stays', [again.ok, again.item.id, q.list('dropped').length, q.list('dropped')[0].evidence.n], [true, 'i_2', 1, 3])
const accented = await q.add(entry('Répondre aux demandes'))
eq('accents are normalised too', [accented.ok, (await q.add(entry('repondre aux demandes'))).error], [true, 'already queued'])
eq('resolve defaults to dropping an entry', (await q.resolve(accented.item.id)).item.status, 'dropped')
eq('an added initiative is never proposed again', [(await q.resolve('i_2', 'added')).item.status, (await q.add(entry('Reply to first enquiries', { n: 99 }))).error], ['added', 'already added'])
eq('the creation state is not an answer: resolve refuses proposed', (await q.resolve('i_1', 'proposed')).error, 'unknown status')
eq('the status is checked before the id', (await q.resolve('i_nope', 'proposed')).error, 'unknown status')
eq('an unknown id says so', (await q.resolve('i_nope')).error, 'not found')
eq('asked is a valid answer', (await q.resolve('i_2', 'asked')).item.status, 'asked')
eq('an asked entry still waits for the person', q.list().map((i) => i.id), ['i_2'])
await q.resolve('i_2')
let full = true
for (let i = 0; i < INITIATIVE_MAX; i += 1) full = full && (await q.add(entry('Initiative ' + i))).ok === true
const before = readFileSync(file, 'utf8')
eq('eight initiatives may wait', [full, q.list().length], [true, 8])
eq('the ninth is refused and the file is untouched', [(await q.add(entry('One more'))).error, readFileSync(file, 'utf8') === before], ['too many initiatives', true])
writeFileSync(file, '{ not json')
eq('a damaged file reads as empty', q.list(), [])
eq('...and the next write repairs it', (await q.add(entry('After the damage'))).ok, true)
const both = await Promise.all([q.add(entry('Parallel A')), q.add(entry('Parallel B'))])
eq('two writers at once never lose an entry', [both.every((x) => x.ok === true), q.list().some((i) => i.title === 'Parallel A'), q.list().some((i) => i.title === 'Parallel B')], [true, true, true])
const copy = q.list()[0]
copy.title = 'mutated'
eq('the list hands copies, a caller cannot rewrite the store', q.list().some((i) => i.title === 'mutated'), false)
const pendingNow = q.list().length
for (let i = 0; i < KEPT_MAX + 1; i += 1) {
  const added = await q.add(entry('Evicted ' + i))
  await q.resolve(added.item.id, 'dropped')
}
await q.add(entry('Tail'))
const done = q.list('dropped')
eq('the oldest resolved entries leave, and no pending one ever does', [done.length, done.some((i) => i.title === 'Evicted 0'), done[done.length - 1].title, q.list().length, KEPT_MAX], [KEPT_MAX, false, 'Evicted ' + KEPT_MAX, pendingNow + 1, 24])
rmSync(dir, { recursive: true, force: true })

// ---------- C. the two tools: they exist only with the seam, and they hand a flat draft ----------
const tasks = async () => ({ ok: true, task: { name: 'N' } })
const ledger = { add: async () => ({ ok: true, item: { id: 's_1' } }) }
const seen = []
let asked = 'unset'
const initiative = {
  add: async (raw) => { seen.push(raw); return { ok: true, item: { id: 'i_1', title: raw.title } } },
  list: async (status) => { asked = status; return [] },
  resolve: async () => ({ ok: true })
}
const names = (deps) => toolDefinitions(deps).map((t) => t.name)
eq('without the seam there are still only the three automation tools', names({ tasks }), ['automation_suggest', 'automation_home', 'automation_remind'])
eq('a plural or aliased key registers nothing: deps.initiative is singular', [names({ tasks, initiatives: initiative }).length, names({ tasks, queue: initiative }).length], [3, 3])
eq('with the ledger the four existing names keep their order', names({ tasks, ledger }), ['automation_suggest', 'automation_home', 'automation_remind', 'memory_suggest', 'instructions_suggest'])
eq('with the seam the two initiative tools come last', names({ tasks, initiative }), ['automation_suggest', 'automation_home', 'automation_remind', 'initiative_record', 'initiative_list'])
const tools = toolDefinitions({ tasks, ledger, initiative })
eq('with both there are seven', tools.map((t) => t.name), ['automation_suggest', 'automation_home', 'automation_remind', 'memory_suggest', 'instructions_suggest', 'initiative_record', 'initiative_list'])
const rec = tools[5]
const lis = tools[6]
eq('both schemas are strict', [rec.parameters.additionalProperties, lis.parameters.additionalProperties], [false, false])
eq('the record asks exactly the six fields of the door', rec.parameters.required, ['title', 'n', 'where', 'risk', 'reversibility', 'summary'])
eq('the model cannot name a next-action kind', Object.keys(rec.parameters.properties).includes('kind'), false)
eq('risk and reversibility are enums, as the door validates them', [rec.parameters.properties.risk.enum, rec.parameters.properties.reversibility.enum], [['low', 'medium', 'high'], ['trivial', 'easy', 'hard']])
eq('the list filters on the four states', lis.parameters.properties.status.enum, ['proposed', 'asked', 'added', 'dropped'])
await rec.execute({ title: 'T', n: 3, span: '', where: 'Gmail', risk: 'medium', reversibility: 'easy', summary: 'Draft a plan' }, {})
eq('record hands the flat call to the queue, with the draft literal', seen[0], { title: 'T', n: 3, span: '', where: 'Gmail', risk: 'medium', reversibility: 'easy', nextAction: { kind: 'draft', summary: 'Draft a plan' } })
eq('list forwards the status, undefined when the call has none', [(await lis.execute({}, {})), asked], [{ ok: true, items: [] }, undefined])
await lis.execute({ status: 'dropped' }, {})
eq('...and the status it was given', asked, 'dropped')
const withCap = toolDefinitions({ tasks, initiative: Object.assign({ cap: INITIATIVE_MAX }, initiative) }).find((t) => t.name === 'initiative_list')
eq('the cap of the queue rides along when there is one', await withCap.execute({}, {}), { ok: true, items: [], cap: INITIATIVE_MAX })
const boom = () => { throw new Error('an initiative tool must never reach the tasks route') }
const quiet = toolDefinitions({ tasks: boom, initiative })
eq('neither tool touches the tasks route', [(await quiet.find((t) => t.name === 'initiative_record').execute({ title: 'T', n: 2, where: 'Gmail', risk: 'low', reversibility: 'easy', summary: 'Draft' }, {})).ok, (await quiet.find((t) => t.name === 'initiative_list').execute({}, {})).ok], [true, true])

const text = (t, v) => t.output.render({}, v)[0].text
eq('recording says it waits and that nothing ran', text(rec, { ok: true, item: { id: 'i_1' } }), 'Recorded in the initiative queue: it waits for the person to answer on the Automations page. Nothing ran.')
eq('a refusal of the queue is said in words the agent can act on', [text(rec, { ok: false, error: 'already queued' }), text(rec, { ok: false, error: 'already added' }), text(rec, { ok: false, error: 'needs new evidence' }), text(rec, { ok: false, error: 'too many initiatives' })], ['Not done: an initiative with that title already waits.', 'Not done: the person already added that initiative: nothing to propose again.', 'Not done: that one was dropped before: bring it back only with a higher count.', 'Not done: eight initiatives already wait: the person has to answer some first.'])
eq('the draft-only rule has its own sentence', text(rec, { ok: false, error: 'next action must be a draft' }), 'Not done: the next action of an initiative is a draft: it prepares text or a plan, it never sends, publishes, deletes or pays.')
eq('an empty queue says nothing waits', text(lis, { ok: true, items: [] }), 'The initiative queue is empty: nothing waits for the person.')
eq('one waiting initiative is named with its risk and its undo', text(lis, { ok: true, items: [{ title: 'Reply to first enquiries', risk: 'low', reversibility: 'trivial' }] }), 'Waiting for the person (1): “Reply to first enquiries” (low risk, trivial to undo). Nothing ran.')
eq('several are separated, still bounded', text(lis, { ok: true, items: [{ title: 'A', risk: 'low', reversibility: 'trivial' }, { title: 'B', risk: 'high', reversibility: 'hard' }] }), 'Waiting for the person (2): “A” (low risk, trivial to undo); “B” (high risk, hard to undo). Nothing ran.')
const eight = Array.from({ length: INITIATIVE_MAX }, (x, i) => ({ title: 'T' + i, risk: 'low', reversibility: 'easy' }))
eq('a full queue says it is full', /^Waiting for the person \(8, full\): /.test(text(lis, { ok: true, items: eight })), true)
eq('the render is bounded whatever the file holds', text(lis, { ok: true, items: eight.concat(eight) }).includes('T7”') && text(lis, { ok: true, items: eight.concat([{ title: 'Nine', risk: 'low', reversibility: 'easy' }]) }).includes('Nine'), false)
const renders = [text(rec, { ok: true, item: { id: 'i_1' } }), text(rec, { ok: false, error: 'needs new evidence' }), text(lis, { ok: true, items: [] }), text(lis, { ok: true, items: [{ title: 'A', risk: 'low', reversibility: 'easy' }] }), text(lis, { ok: true, items: eight })]
eq('no render ever claims something ran or was switched on', renders.filter((s) => /is running|has run|was started|is active|switched on|will run|was created/.test(s)), [])
eq('a value that is not an answer says so instead of failing', text(lis, null), 'Not done: no answer.')
eq('the prompt carries the three initiative rules and keeps the seven existing ones', [PROMPT.split('\n').length, PROMPT.includes('initiative_record'), PROMPT.includes('An initiative never creates'), PROMPT.includes('The next action of an initiative is a draft'), PROMPT.includes('Call initiative_list'), PROMPT.includes('Write patterns, not people.'), PROMPT.includes('never sends, deletes, pays or publishes')], [12, true, true, true, true, true, true])

// ---------- D. mounting: every seam guarded ----------
const registered = []
const chunks = []
mountAutomationTools({ inject: (names, fn) => fn(names[0] === 'tools' ? { tools: { register: (t) => registered.push(t.name) } } : { systemPrompt: { context: (c) => chunks.push(c) } }) }, { tasks, ledger, initiative })
eq('the mount registers the five tools and the one prompt chunk', [registered, chunks.length], [['automation_suggest', 'automation_home', 'automation_remind', 'memory_suggest', 'instructions_suggest', 'initiative_record', 'initiative_list'], 1])
const logged = []
mountAutomationTools({ inject: () => { throw new Error('no seam') } }, { tasks, initiative }, (m) => logged.push(m))
eq('a missing seam drops the part and logs, never throws', logged.length, 2)
const onlyAutomations = []
mountAutomationTools({ inject: (names, fn) => fn({ tools: { register: (t) => onlyAutomations.push(t.name) } }) }, { tasks })
eq('a host without the queue still gets the three automation tools', onlyAutomations, ['automation_suggest', 'automation_home', 'automation_remind'])

console.log(fails === 0 ? '\nall checks passed' : '\n' + fails + ' check(s) FAILED')
process.exit(fails === 0 ? 0 : 1)
