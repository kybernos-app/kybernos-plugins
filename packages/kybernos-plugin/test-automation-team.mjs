// Team automations, the local half: the pure module (automation-team.mjs). This proves the canonical form and the two test vectors of
// docs/dev/team-automations-contract.md byte for byte, the key and the description derived from a name and a prompt, what a proposal holds (the contract's fields and
// nothing else), the hash a copy is judged edited by, the contract's rules on a definition, and the update logic (keep / both / replace, and « the schedule follows the team
// only if the person did not change it since install »). The routes that apply it are proven by scripts/test-tasks-team.mjs.
//   node packages/kybernos-plugin/test-automation-team.mjs   (exit 0 = everything passes)
import assert from 'node:assert/strict'
import {
  LIMITS, baseOf, canonicalOf, contentHashOf, copyRowOf, describeFrom, isEdited, markOf, mineOf, missingAppsOf, needsOf, packOf, planUpdate, replaceTask,
  scheduleFollows, slugKey, teamInfoOf, validateDefinition, versionOf,
} from './automation-team.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

// ── the canonical form and the two vectors of the contract ───────────────────────────────────────────────────────────────
const PROMPT_1 = 'Every Monday, look at the invoices in Gmail labelled “To chase” that are more than 30 days old.\nFor each one, write a short, polite reminder in the client’s language and save it as a draft.\nNever send an e-mail yourself. Post the list of drafts in #finance.'
const VECTOR_1 = { key: 'invoice-reminder', name: 'Invoice reminder', description: 'Drafts a polite reminder for every invoice more than 30 days old.', prompt: PROMPT_1, schedule: { mode: 'cron', cron: '0 9 * * 1' }, needs: ['slack', 'gmail'] }
const VECTOR_2 = { key: 'hook-demo', name: 'Hook demo', description: 'Runs when called.', prompt: 'Say hi.', schedule: { mode: 'webhook' }, needs: [] }
assert.equal(canonicalOf(VECTOR_1).length, 477, 'the canonical form of the first vector is 477 characters')
assert.equal(versionOf(VECTOR_1), '40d2e6d589d77bc36888fd2d6a22354c77902a374f47723b1179a9bddf8e9c24')
assert.equal(versionOf(VECTOR_2), 'e68467deacc2f458f0b1c5a0655c743e5b8ff1c81e20b9104c191a820f8fa5dd')
ok('both test vectors of the contract give their hash byte for byte (477-character canonical form for the first)')
assert.ok(canonicalOf(VECTOR_1).startsWith('{"key":"invoice-reminder","name":"Invoice reminder","description":"Drafts'), 'keys in the contract\'s order')
assert.ok(canonicalOf(VECTOR_1).endsWith('"schedule":{"mode":"cron","cron":"0 9 * * 1"},"needs":["gmail","slack"]}'), 'schedule then needs, needs sorted')
assert.ok(canonicalOf(VECTOR_1).includes('“To chase”') && canonicalOf(VECTOR_1).includes('\\n'), 'non-ASCII characters stay as they are, a newline is the JSON escape')
const reordered = { needs: ['gmail', 'slack'], schedule: { cron: '0   9 *  * 1', mode: 'cron' }, prompt: PROMPT_1, description: VECTOR_1.description, name: VECTOR_1.name, key: VECTOR_1.key }
assert.equal(versionOf(reordered), versionOf(VECTOR_1), 'the order of the keys, the order of needs and the spaces of the cron do not change the version')
assert.equal(versionOf(Object.assign({}, VECTOR_1, { schedule: { mode: 'cron', cron: '0 9 * * 1', tz: 'Europe/Paris' } })), versionOf(VECTOR_1), 'a zone is not part of the canonical form')
for (const [field, value] of [['key', 'invoice-chaser'], ['name', 'Invoice reminder 2'], ['description', 'x'], ['prompt', PROMPT_1 + '.'], ['schedule', { mode: 'cron', cron: '0 9 * * 2' }], ['needs', ['gmail']]]) {
  assert.notEqual(versionOf(Object.assign({}, VECTOR_1, { [field]: value })), versionOf(VECTOR_1), field + ' changes the version')
}
assert.equal(versionOf(null), null)
assert.equal(versionOf(Object.assign({}, VECTOR_1, { needs: 'gmail' })), null)
assert.equal(versionOf(Object.assign({}, VECTOR_1, { schedule: { mode: 'once', at: '2030-01-01T08:00' } })), null, 'a one-time schedule has no canonical form')
ok('the version follows the content only: one changed field changes it; key order, needs order, cron spacing and a zone do not')
// Trimming (the contract's « Trimming and the note »): name, description and prompt are hashed trimmed.
const padded = Object.assign({}, VECTOR_1, { name: '  Invoice reminder\n', description: ' ' + VECTOR_1.description + '\t', prompt: '\n\n' + PROMPT_1 + '  \n' })
assert.equal(versionOf(padded), versionOf(VECTOR_1), 'white space around name, description and prompt is not part of the version')
assert.equal(canonicalOf(padded), canonicalOf(VECTOR_1), '...the canonical form is the trimmed one')
assert.equal(versionOf(Object.assign({}, VECTOR_1, { prompt: PROMPT_1.replace('Never', ' Never') })) === versionOf(VECTOR_1), false, 'white space inside the text still counts')
ok('name, description and prompt are hashed trimmed: the first vector gives the same hash with white space around them')

// ── the key and the description ──────────────────────────────────────────────────────────────────────────────────────────
assert.equal(slugKey('Invoice reminder'), 'invoice-reminder')
assert.equal(slugKey('  Café — Relance Été !! '), 'cafe-relance-ete')
assert.equal(slugKey('A__B..C'), 'a-b-c')
assert.equal(slugKey('x'.repeat(100)).length, 64)
assert.equal(slugKey('word '.repeat(30)), ('word-'.repeat(30)).slice(0, 64).replace(/-+$/, ''), 'cut at 64 without a trailing dash')
const empty = slugKey('✨ \u{1F680}')
assert.match(empty, /^automation-[0-9a-f]{6}$/)
assert.equal(slugKey('✨ \u{1F680}'), empty, 'the fallback is stable')
assert.notEqual(slugKey('日本語'), slugKey('中文'), 'two names with nothing Latin in them do not share a key')
for (const name of ['Weekly digest', 'Ünïcödé', '1', '--', '', 'a'.repeat(300), 'Ça va ? Oui !']) assert.match(slugKey(name), /^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'always a valid key: ' + JSON.stringify(name))
ok('the key: accents off, lower case, runs of other characters one dash, 64 at most, a stable fallback when nothing is left, always valid')
assert.equal(describeFrom(PROMPT_1), 'Every Monday, look at the invoices in Gmail labelled “To chase” that are more than 30 days old.')
assert.equal(describeFrom('Say hi.'), 'Say hi.')
assert.equal(describeFrom('Summarise my inbox! Then reply to the urgent ones.'), 'Summarise my inbox!')
assert.equal(describeFrom('\n\n  Check the dashboard\nthen tell me.'), 'Check the dashboard')
assert.equal(describeFrom('# Morning digest. Extra'), 'Morning digest.')
assert.equal(describeFrom('- Look at v2.1 notes. Done'), 'Look at v2.1 notes.')
assert.equal(describeFrom('今日は晴れ。明日は雨。'), '今日は晴れ。')
assert.equal(describeFrom(''), '')
assert.equal(describeFrom(null), '')
const long = ('alpha beta gamma delta epsilon zeta ').repeat(20).trim() // no full stop: one 700-character sentence
const cut = describeFrom(long)
assert.ok(cut.length <= 200 && cut.endsWith('…'), 'at most 200 characters, with an ellipsis: ' + cut.length)
assert.ok(long.startsWith(cut.slice(0, -1)) && ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'].includes(cut.slice(0, -1).split(' ').pop()), 'cut on a word, not inside one')
const exact = 'w'.repeat(5).concat(' ', 'x'.repeat(194)) // 200 characters, one space
assert.equal(describeFrom(exact), exact, 'exactly 200 is left alone')
assert.ok(describeFrom('y'.repeat(500)).length <= 200, 'a text with no space is cut at the cap')
const astral = describeFrom('\u{1F600}'.repeat(150))
assert.ok(astral.length <= 200 && /^(?:\u{1F600})+…$/u.test(astral), 'never half of a surrogate pair')
ok('the description: the first sentence (its first line up to a full stop), 200 characters at most, cut on a word')

// ── what a proposal holds ────────────────────────────────────────────────────────────────────────────────────────────────
const SECRET = 'f00dfeedf00dfeedf00dfeedf00dfeed'
const STORED = {
  id: 'st-abc123', createdAt: '2026-10-20T08:00:00.000Z', updatedAt: '2026-10-21T08:00:00.000Z', name: 'Invoice reminder', prompt: PROMPT_1,
  schedule: { mode: 'cron', cron: '0 9 * * 1', tz: 'Europe/Paris' }, runsOn: 'local', active: true, approvals: 'auto', notify: ['push', 'email'], needs: ['slack', 'gmail', 'Not A Slug', 7],
  sessionMode: 'home', homeSessionId: 'sess-home-1', homeOwn: true, workspaceHint: 'ws-private-1', history: [{ at: '2026-10-21T09:00:00.000Z', sessionId: 'sess-run-9', status: 'fired' }],
  lastRun: '2026-10-21T09:00:00.000Z', nextRun: '2026-10-28T08:00:00.000Z', trigger: { type: 'webhook', hookId: 'hk_deadbeef0001', secret: SECRET },
  cloud: { computerId: '3f2a1c10-0000-4000-8000-000000000001', name: 'Home' }, published: { ref: 'ref-1' }, origin: { by: 'kaby' }, limits: { perHour: 9 },
}
const packed = packOf(STORED)
assert.equal(packed.ok, true)
assert.deepEqual(Object.keys(packed.proposal), ['key', 'name', 'description', 'prompt', 'schedule', 'needs', 'version'], 'exactly the contract\'s fields, in order')
assert.deepEqual(packed.proposal.schedule, { mode: 'cron', cron: '0 9 * * 1' }, 'no zone')
assert.deepEqual(packed.proposal.needs, ['gmail', 'slack'], 'the task\'s slugs, valid ones, sorted')
assert.equal(packed.proposal.key, 'invoice-reminder')
assert.equal(packed.proposal.description, 'Every Monday, look at the invoices in Gmail labelled “To chase” that are more than 30 days old.')
assert.equal(packed.proposal.prompt, PROMPT_1)
assert.equal(packed.proposal.version, versionOf(packed.proposal), 'the version is the one of what is proposed')
const text = JSON.stringify(packed)
for (const leak of [SECRET, 'hk_deadbeef0001', 'sess-home-1', 'sess-run-9', 'ws-private-1', 'st-abc123', 'Europe/Paris', 'runsOn', 'active', 'approvals', 'notify', 'history', 'trigger', 'workspace', 'cloud', '3f2a1c10', 'ref-1', 'kaby', 'perHour', '2026-10', 'push', 'email']) {
  assert.equal(text.includes(leak), false, 'nothing of the task leaks: ' + leak)
}
const check = validateDefinition(Object.assign({ id: 1 }, packed.proposal))
assert.equal(check.ok, true, 'a proposal is a definition the rules accept: ' + JSON.stringify(check))
ok('a proposal holds the contract\'s seven fields and nothing of the task: no zone, state, notification, id, history, webhook, workspace, session, approval mode or place')
const hook = packOf(Object.assign({}, STORED, { name: 'Hook demo', prompt: 'Say hi.', needs: undefined, schedule: { mode: 'webhook', tz: 'Asia/Kolkata' } }))
assert.deepEqual(hook.proposal, { key: 'hook-demo', name: 'Hook demo', description: 'Say hi.', prompt: 'Say hi.', schedule: { mode: 'webhook' }, needs: [], version: versionOf(Object.assign({}, VECTOR_2, { description: 'Say hi.' })) }, 'a webhook automation is a kind, with no address and no zone')
assert.deepEqual(packOf(Object.assign({}, STORED, { schedule: { mode: 'once', at: '2030-01-01T08:00', tz: 'UTC' } })), { ok: false, error: 'once_not_shareable' })
assert.deepEqual(packOf(Object.assign({}, STORED, { schedule: undefined })), { ok: false, error: 'once_not_shareable' })
assert.deepEqual(packOf(Object.assign({}, STORED, { prompt: '  \n ' })), { ok: false, error: 'empty_prompt' })
assert.deepEqual(packOf(Object.assign({}, STORED, { prompt: undefined })), { ok: false, error: 'empty_prompt' })
assert.deepEqual(packOf(Object.assign({}, STORED, { schedule: { mode: 'cron', cron: 'every day' } })), { ok: false, error: 'invalid_schedule' })
assert.deepEqual(packOf(null), { ok: false, error: 'not_found' })
assert.equal(packOf(Object.assign({}, STORED, { prompt: 'p'.repeat(9000) })).proposal.prompt.length, LIMITS.prompt, 'a prompt past the cap is cut as the sanitizer cuts it')
const spaced = packOf(Object.assign({}, STORED, { name: '  Invoice reminder \n', prompt: '\n  ' + PROMPT_1 + '  ' })).proposal
assert.deepEqual([spaced.name, spaced.prompt, spaced.description], ['Invoice reminder', PROMPT_1, packed.proposal.description], 'a proposal is trimmed')
assert.equal(spaced.version, packed.proposal.version, '...so its version is the one of the trimmed text')
const cutName = packOf(Object.assign({}, STORED, { name: 'a'.repeat(119) + ' b'.repeat(5) })).proposal.name
assert.ok(cutName === 'a'.repeat(119) && cutName.length === 119, 'a name cut at 120 on a space does not end with it')
const cutPrompt = packOf(Object.assign({}, STORED, { prompt: 'p'.repeat(7999) + ' tail' })).proposal
assert.ok(cutPrompt.prompt === 'p'.repeat(7999) && cutPrompt.version === versionOf(cutPrompt), 'a prompt cut at 8000 on a space does not end with it')
assert.equal(packOf(Object.assign({}, STORED, { name: '\u200b\u200b' })).proposal.name, 'Automation', 'a name with nothing in it gets a plain one')
const withMark = packOf(Object.assign({}, STORED, { name: 'My own title', team: markOf({ workspaceId: 'w1', id: 4, key: 'invoice-reminder', version: 'a'.repeat(64), installedAt: 'x' }, STORED) }))
assert.equal(withMark.proposal.key, 'invoice-reminder', 'a copy of a team automation proposes under its own key, whatever its name became: that is what makes it an update')
ok('a one-time schedule, an empty prompt and a task that is not one are refused; a webhook travels as a kind; a copy proposes under its team key')

// ── the hash a copy is judged edited by ───────────────────────────────────────────────────────────────────────────────────
const copy = () => {
  const task = { id: 'st-1', name: 'Invoice reminder', prompt: PROMPT_1, schedule: { mode: 'cron', cron: '0 9 * * 1', tz: 'Europe/Paris' }, needs: ['gmail', 'slack'], active: false, approvals: 'ask' }
  task.team = markOf({ workspaceId: 'w1', id: 12, key: 'invoice-reminder', version: versionOf(VECTOR_1), installedAt: '2026-10-24T08:00:00.000Z' }, task)
  return task
}
const fresh = copy()
assert.deepEqual(Object.keys(fresh.team), ['workspaceId', 'id', 'key', 'version', 'installedAt', 'base', 'contentHash'])
assert.deepEqual(fresh.team.base, { name: 'Invoice reminder', prompt: PROMPT_1, schedule: { mode: 'cron', cron: '0 9 * * 1' }, needs: ['gmail', 'slack'] }, 'base: the four fields, no zone')
assert.match(fresh.team.contentHash, /^[0-9a-f]{64}$/)
assert.equal(contentHashOf(fresh), fresh.team.contentHash)
assert.equal(contentHashOf({ name: 'N', prompt: 'P', schedule: { mode: 'webhook', tz: 'UTC' }, needs: ['b-app', 'a-app'] }), contentHashOf({ name: 'N', prompt: 'P', schedule: { mode: 'webhook' }, needs: ['a-app', 'b-app'] }))
assert.notEqual(contentHashOf({ name: 'N', prompt: 'P', schedule: { mode: 'webhook' }, needs: [] }), contentHashOf({ name: 'N', prompt: 'P', schedule: { mode: 'cron', cron: '0 8 * * *' }, needs: [] }))
assert.deepEqual(baseOf(null), { name: '', prompt: '', schedule: { mode: 'once' }, needs: [] })
assert.equal(isEdited(fresh), false, 'just installed: not edited')
assert.equal(isEdited(Object.assign(copy(), { active: true, approvals: 'auto', notify: ['push'], updatedAt: 'later', history: [{}], lastRun: 'x', nextRun: 'y', workspaceHint: 'w', sessionMode: 'home', trigger: { type: 'webhook', hookId: 'h', secret: 's' } })), false, 'state, approvals, notifications, history, place and webhook are not what a copy is judged on')
assert.equal(isEdited(Object.assign(copy(), { schedule: { mode: 'cron', cron: '0 9 * * 1', tz: 'Asia/Tokyo' } })), false, 'the zone is not part of it')
assert.equal(isEdited(Object.assign(copy(), { needs: ['slack', 'gmail'] })), false, 'the order of needs is not')
assert.equal(isEdited(Object.assign(copy(), { schedule: { mode: 'cron', cron: '0  9 * *  1' } })), false, 'nor the spacing of the cron')
for (const [what, patch] of [['name', { name: 'Invoice reminder 2' }], ['prompt', { prompt: PROMPT_1 + '.' }], ['cron', { schedule: { mode: 'cron', cron: '0 10 * * 1' } }], ['mode', { schedule: { mode: 'webhook' } }], ['one-time', { schedule: { mode: 'once', at: '2030-01-01T08:00' } }], ['needs', { needs: ['gmail'] }]]) {
  assert.equal(isEdited(Object.assign(copy(), patch)), true, what + ' edited')
}
assert.equal(isEdited({ name: 'plain' }), false, 'an automation with no mark is not a copy, so not edited')
assert.equal(isEdited(Object.assign(copy(), { team: Object.assign({}, fresh.team, { contentHash: 'nope' }) })), true, 'a mark with no usable hash counts as edited: nothing is overwritten on a guess')
assert.equal(isEdited(null), false)
ok('a copy is edited when name, prompt, schedule (mode, cron) or needs differ from what was installed, and by nothing else')
assert.deepEqual(teamInfoOf(fresh), { workspaceId: 'w1', id: 12, key: 'invoice-reminder', version: versionOf(VECTOR_1), edited: false })
assert.deepEqual(teamInfoOf(Object.assign(copy(), { name: 'x' })).edited, true)
assert.equal(teamInfoOf({ name: 'plain' }), null)
assert.deepEqual(Object.keys(copyRowOf(fresh, ['slack'])), ['taskId', 'workspaceId', 'id', 'key', 'version', 'edited', 'missingApps'])
assert.deepEqual(copyRowOf(fresh, ['slack']).missingApps, ['slack'])
assert.equal(copyRowOf({ name: 'plain' }, []), null)
assert.deepEqual(missingAppsOf(['slack', 'gmail'], null), [], 'the host cannot know: nothing is said to be missing')
assert.deepEqual(missingAppsOf(['slack', 'gmail', 'notion'], ['gmail']), ['notion', 'slack'])
assert.deepEqual(needsOf(['b-app', 'a-app', 'a-app', 'X', 'a', 5, 'toolong'.repeat(10)]), ['a-app', 'b-app'])
ok('the copy rows have the contract\'s fields; missing apps are reported only when the connected ones are known')

// ── the contract's rules on a definition ──────────────────────────────────────────────────────────────────────────────────
const GOOD = Object.assign({ id: 12 }, VECTOR_1, { version: versionOf(VECTOR_1) })
const good = validateDefinition(GOOD)
assert.equal(good.ok, true)
assert.deepEqual(good.definition.needs, ['gmail', 'slack'], 'needs come back sorted')
assert.equal(good.definition.id, 12)
assert.equal(validateDefinition(Object.assign({}, GOOD, { id: '12' })).definition.id, 12, 'the id may be digits')
assert.deepEqual(Object.keys(good.definition), ['id', 'key', 'name', 'description', 'prompt', 'schedule', 'needs', 'version'], 'only the contract\'s fields are read: a row from the list carries more and none of it is kept')
assert.equal(Object.keys(validateDefinition(Object.assign({}, GOOD, { status: 'approved', proposed_by_name: 'Camille', note: 'x' })).definition).includes('status'), false)
assert.equal(validateDefinition(Object.assign({}, GOOD, { schedule: { mode: 'cron', cron: ' 0  9 * * 1 ' } })).definition.schedule.cron, '0 9 * * 1', 'the cron is read with one space between fields')
const refuse = (label, patch, reason, field) => {
  const r = validateDefinition(typeof patch === 'function' ? patch(GOOD) : Object.assign({}, GOOD, patch))
  assert.deepEqual([r.ok, r.reason, r.field], [false, reason, field || reason], label + ' -> ' + JSON.stringify(r))
}
refuse('no key', { key: '' }, 'key')
refuse('an upper-case key', { key: 'Invoice' }, 'key')
refuse('a key with a double dash', { key: 'a--b' }, 'key')
refuse('a key that starts with a dash', { key: '-a' }, 'key')
refuse('a key of 65 characters', { key: 'a'.repeat(65) }, 'key')
refuse('a key that is not text', { key: 3 }, 'key')
refuse('a bad id', { id: 0 }, 'id')
refuse('an id that is not a number', { id: 'abc' }, 'id')
refuse('a name that is empty once trimmed', { name: '   ' }, 'name')
refuse('a name of zero-width characters', { name: '\u200b\u200d\ufeff' }, 'name')
refuse('a name of 121 characters', { name: 'n'.repeat(121) }, 'name')
refuse('a name that is not text', { name: null }, 'name')
refuse('an empty description', { description: ' ' }, 'description')
refuse('a description of 501 characters', { description: 'd'.repeat(501) }, 'description')
refuse('an empty prompt', { prompt: ' \n' }, 'prompt')
refuse('a prompt of 8001 characters', { prompt: 'p'.repeat(8001) }, 'prompt')
refuse('8001 characters once trimmed', { prompt: ' ' + 'p'.repeat(8001) + ' ' }, 'prompt')
refuse('a NUL in the prompt', { prompt: 'a\u0000b' }, 'binary', 'prompt')
refuse('half of a surrogate pair in the prompt', { prompt: 'a\ud83d' }, 'binary', 'prompt')
refuse('the other half', { prompt: '\ude00 a' }, 'binary', 'prompt')
refuse('a NUL in the name', { name: 'a\u0000' }, 'binary', 'name')
refuse('a NUL in the description', { description: '\u0000' }, 'binary', 'description')
refuse('a one-time schedule', { schedule: { mode: 'once', at: '2030-01-01T08:00' } }, 'schedule')
refuse('a time zone sent with a cron', { schedule: { mode: 'cron', cron: '0 9 * * 1', tz: 'Europe/Paris' } }, 'schedule')
refuse('a time zone sent with a webhook', { schedule: { mode: 'webhook', tz: 'UTC' } }, 'schedule')
refuse('a cron on a webhook', { schedule: { mode: 'webhook', cron: '0 9 * * 1' } }, 'schedule')
refuse('a cron with four fields', { schedule: { mode: 'cron', cron: '0 9 * *' } }, 'schedule')
refuse('a cron with six fields', { schedule: { mode: 'cron', cron: '0 9 * * 1 1' } }, 'schedule')
refuse('a cron with a character outside the shape', { schedule: { mode: 'cron', cron: '0 9 * * 1;' } }, 'schedule')
refuse('a cron of 101 characters', { schedule: { mode: 'cron', cron: '0 9 * * ' + '1,'.repeat(46) + '1' } }, 'schedule')
refuse('no cron', { schedule: { mode: 'cron' } }, 'schedule')
refuse('no schedule', { schedule: undefined }, 'schedule')
refuse('a schedule that is a string', { schedule: 'daily' }, 'schedule')
refuse('seven apps', { needs: ['aa', 'bb', 'cc', 'dd', 'ee', 'ff', 'gg'] }, 'needs')
refuse('the same app twice', { needs: ['gmail', 'gmail'] }, 'needs')
refuse('an upper-case slug', { needs: ['Gmail'] }, 'needs')
refuse('a slug of one character', { needs: ['g'] }, 'needs')
refuse('needs that is not a list', { needs: 'gmail' }, 'needs')
assert.equal(validateDefinition(null).ok, false)
assert.equal(validateDefinition([]).ok, false)
assert.equal(validateDefinition(Object.assign({}, GOOD, { schedule: { mode: 'cron', cron: '0 9 * * MON' } })).ok, true, 'the server\'s shape lets names through; the host parses the expression for real')
assert.equal(validateDefinition(Object.assign({}, GOOD, { key: 'a'.repeat(64), name: 'n'.repeat(120), description: 'd'.repeat(500), prompt: 'p'.repeat(8000), needs: ['aa', 'bb', 'cc', 'dd', 'ee', 'ff'] })).ok, true, 'the limits themselves are allowed')
const trimmedOnly = validateDefinition(Object.assign({}, GOOD, { name: ' ' + 'n'.repeat(120) + ' ', description: ' ' + 'd'.repeat(500) + ' ', prompt: ' ' + 'p'.repeat(8000) + '\n' }))
assert.equal(trimmedOnly.ok, true, 'the limits are those of the trimmed text')
assert.deepEqual([trimmedOnly.definition.name.length, trimmedOnly.definition.description.length, trimmedOnly.definition.prompt.length], [120, 500, 8000], '...and what comes back is trimmed')
const untrimmed = validateDefinition(Object.assign({}, GOOD, { name: '  Invoice reminder ', description: ' ' + GOOD.description + ' ', prompt: '\n' + PROMPT_1 + '\n' })).definition
assert.deepEqual([untrimmed.name, untrimmed.description, untrimmed.prompt], [GOOD.name, GOOD.description, PROMPT_1])
assert.equal(versionOf(untrimmed), GOOD.version, 'an untrimmed definition, once trimmed, has the version the server computed')
ok('the definition rules: key, name, description, prompt, binary, schedule (no once, no zone), needs and id, each at its limit and one past it; text is trimmed first')

// ── the update logic ─────────────────────────────────────────────────────────────────────────────────────────────────────
const NEXT = { id: 13, key: 'invoice-reminder', name: 'Invoice reminder v2', description: 'd', prompt: 'New prompt.', schedule: { mode: 'cron', cron: '30 8 * * 1' }, needs: ['gmail'], version: 'b'.repeat(64) }
const clean = { name: NEXT.name, prompt: NEXT.prompt, needs: NEXT.needs, schedule: { mode: 'cron', cron: '30 8 * * 1', tz: 'Europe/Paris' } }
const NOW = '2026-10-25T10:00:00.000Z'
assert.deepEqual(planUpdate({ name: 'plain' }, NEXT, 'replace'), { ok: false, error: 'not_a_team_copy' })
assert.deepEqual(planUpdate(null, NEXT, 'replace'), { ok: false, error: 'not_a_team_copy' })
assert.deepEqual(planUpdate(copy(), NEXT, 'merge'), { ok: false, error: 'invalid_mode' })
assert.deepEqual(planUpdate(copy(), NEXT, undefined), { ok: false, error: 'invalid_mode' })
assert.deepEqual(planUpdate(copy(), Object.assign({}, NEXT, { key: 'other' }), 'replace'), { ok: false, error: 'key_mismatch' })
assert.deepEqual(planUpdate(copy(), NEXT, 'keep'), { ok: false, error: 'not_edited' }, 'an unedited copy accepts replace only')
assert.deepEqual(planUpdate(copy(), NEXT, 'both'), { ok: false, error: 'not_edited' })
assert.deepEqual(planUpdate(copy(), NEXT, 'replace'), { ok: true, keep: false, both: false, followsSchedule: true })
const edited = Object.assign(copy(), { prompt: 'My own prompt.' })
assert.deepEqual(planUpdate(edited, NEXT, 'keep'), { ok: true, keep: true })
assert.deepEqual(planUpdate(edited, NEXT, 'both'), { ok: true, keep: false, both: true, followsSchedule: true })
assert.deepEqual(planUpdate(edited, NEXT, 'replace'), { ok: true, keep: false, both: false, followsSchedule: true }, 'replace is open to an edited copy too: it is what « use the team version » does')
ok('which modes a copy accepts: an unedited one replace only; keep and both need an edit; a wrong key, mode or a plain automation is refused')
// the schedule rule, against team.base
assert.equal(scheduleFollows(copy()), true)
assert.equal(scheduleFollows(Object.assign(copy(), { prompt: 'edited' })), true, 'editing the prompt does not stop the schedule from following')
assert.equal(scheduleFollows(Object.assign(copy(), { schedule: { mode: 'cron', cron: '0 9 * * 1', tz: 'Asia/Tokyo' } })), true, 'a different zone is not a different rhythm')
assert.equal(scheduleFollows(Object.assign(copy(), { schedule: { mode: 'cron', cron: '0 10 * * 1' } })), false, 'the person moved it to ten: it stays at ten')
assert.equal(scheduleFollows(Object.assign(copy(), { schedule: { mode: 'webhook' } })), false)
assert.equal(scheduleFollows(Object.assign(copy(), { schedule: { mode: 'once', at: '2030-01-01T08:00' } })), false)
assert.equal(scheduleFollows(Object.assign(copy(), { team: Object.assign({}, fresh.team, { base: Object.assign({}, fresh.team.base, { schedule: undefined }) }) })), false, 'a mark with no base schedule: nothing is overwritten on a guess')
assert.equal(scheduleFollows({ name: 'plain' }), false)
assert.equal(planUpdate(Object.assign(copy(), { schedule: { mode: 'cron', cron: '0 10 * * 1' } }), NEXT, 'replace').followsSchedule, false)
ok('the schedule follows the team version only while it is the one installed (team.base): a changed cron, mode or date stays the person\'s; a zone or a prompt edit changes nothing')
// replace
const live = Object.assign(copy(), { active: true, approvals: 'auto', notify: ['push'], nextRun: 'soon', history: [{ at: 'a' }], lastRun: 'b', trigger: { type: 'webhook', hookId: 'hk_1', secret: 's' }, workspaceHint: 'w', createdAt: 'c0', homeSessionId: 'h' })
const before = JSON.stringify(live)
const replaced = replaceTask(live, NEXT, clean, true, NOW)
assert.equal(JSON.stringify(live), before, 'the stored task is not changed in place')
assert.deepEqual([replaced.name, replaced.prompt, replaced.needs, replaced.schedule], [NEXT.name, NEXT.prompt, ['gmail'], clean.schedule], 'name, prompt, needs and (following) schedule come from the definition')
assert.deepEqual([replaced.id, replaced.createdAt, replaced.active, replaced.approvals, replaced.notify, replaced.history, replaced.lastRun, replaced.trigger, replaced.workspaceHint, replaced.homeSessionId], [live.id, 'c0', true, 'auto', ['push'], [{ at: 'a' }], 'b', live.trigger, 'w', 'h'], 'active state, place, approval mode, notifications, history and webhook stay')
assert.equal(replaced.updatedAt, NOW)
assert.deepEqual([replaced.team.workspaceId, replaced.team.id, replaced.team.key, replaced.team.version, replaced.team.installedAt], ['w1', 13, 'invoice-reminder', 'b'.repeat(64), NOW], 'the mark moves to the new version, same workspace and key')
assert.deepEqual(replaced.team.base, { name: 'Invoice reminder v2', prompt: 'New prompt.', schedule: { mode: 'cron', cron: '30 8 * * 1' }, needs: ['gmail'] })
assert.equal(isEdited(replaced), false, 'after a replace that took everything, the copy is the team\'s again')
const kept = replaceTask(Object.assign(copy(), { schedule: { mode: 'cron', cron: '0 10 * * 1', tz: 'Europe/Paris' } }), NEXT, clean, false, NOW)
assert.deepEqual(kept.schedule, { mode: 'cron', cron: '0 10 * * 1', tz: 'Europe/Paris' }, 'the person\'s own rhythm stays')
assert.deepEqual([kept.name, kept.prompt, kept.needs], [NEXT.name, NEXT.prompt, ['gmail']], '...while name, prompt and needs are the team\'s')
assert.deepEqual(kept.team.base.schedule, { mode: 'cron', cron: '30 8 * * 1' }, 'base is the team\'s definition, so the person\'s rhythm keeps reading as their change')
assert.equal(isEdited(kept), true)
const elsewhere = replaceTask(copy(), NEXT, Object.assign({}, clean, { schedule: { mode: 'cron', cron: '1 1 * * 1', tz: 'UTC' } }), false, NOW)
assert.deepEqual(elsewhere.team.base.schedule, { mode: 'cron', cron: '30 8 * * 1' }, 'base is the definition as the team sent it, whatever the sanitizer made of the schedule')
assert.equal(scheduleFollows(kept), false, '...and the next team update does not take it either')
const onceKept = replaceTask(Object.assign(copy(), { schedule: { mode: 'once', at: '2030-01-01T08:00', tz: 'UTC' } }), NEXT, clean, false, NOW)
assert.deepEqual(onceKept.schedule, { mode: 'once', at: '2030-01-01T08:00', tz: 'UTC' })
const toHook = replaceTask(copy(), Object.assign({}, NEXT, { schedule: { mode: 'webhook' } }), { name: 'N', prompt: 'P', needs: [], schedule: { mode: 'webhook', tz: 'UTC' } }, true, NOW)
assert.deepEqual([toHook.schedule, toHook.team.base.schedule], [{ mode: 'webhook', tz: 'UTC' }, { mode: 'webhook' }])
ok('replace: the team\'s name, prompt, needs and (if it follows) schedule; state, place, approvals, notifications, history and webhook stay; the mark moves with base = the definition')
// both
const mine = mineOf(Object.assign(live, { name: 'N'.repeat(120), cloud: { computerId: 'c' }, pendingFire: true, pendingFires: ['x'], origin: { by: 'kaby' }, published: { ref: 'r' }, suggested: false, homeOwn: true, sessionMode: 'home', limits: { perHour: 1 } }), 'st-mine', NOW)
assert.equal(mine.name.length, 120)
assert.ok(mine.name.endsWith(' (mine)') && mine.name.startsWith('N'.repeat(113)), 'the name is cut to leave room for the suffix')
assert.equal(mineOf(copy(), 'st-m', NOW).name, 'Invoice reminder (mine)')
assert.equal(mine.team, undefined, 'no mark: it is the person\'s own')
assert.deepEqual([mine.id, mine.active, mine.nextRun, mine.runsOn, mine.history, mine.lastRun, mine.createdAt, mine.updatedAt], ['st-mine', false, null, 'local', [], null, NOW, NOW], 'paused, new, with no history')
assert.deepEqual(Object.keys(mine).sort(), ['active', 'approvals', 'createdAt', 'history', 'id', 'lastRun', 'name', 'needs', 'nextRun', 'notify', 'prompt', 'runsOn', 'schedule', 'updatedAt', 'workspaceHint'], 'only the definition and the person\'s choices are copied: nothing of the original\'s runs, home session, cloud link, webhook or origin')
assert.deepEqual([mine.prompt, mine.schedule, mine.approvals, mine.notify, mine.needs, mine.workspaceHint], [live.prompt, live.schedule, 'auto', ['push'], live.needs, 'w'])
mine.schedule.cron = 'changed'
mine.needs.push('zz-app')
assert.notEqual(live.schedule.cron, 'changed', 'the clone does not share the schedule with the original')
assert.equal(live.needs.includes('zz-app'), false)
ok('both: the current copy kept as « <name> (mine) », paused, with no mark and nothing of the original\'s runs or webhook')

console.log('\n' + pass + ' verifications OK')
process.exit(0)
