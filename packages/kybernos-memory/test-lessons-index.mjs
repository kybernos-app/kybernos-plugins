#!/usr/bin/env node
// Lessons as an index (like the skills list): title and summary per lesson, the full text on demand (lesson_read), the
// tidy-up that merges and compacts them, and memory_tidy. Real files in a temp folder, never the machine's ~/.dsh.
//
//   node packages/kybernos-memory/test-lessons-index.mjs
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'kybernos-lessons-index-'))
const kybers = join(root, 'kybers')
mkdirSync(join(kybers, '.active'), { recursive: true })
process.env.KYBERNOS_MEMORY_KYBERS = kybers
process.env.KYBERNOS_MEMORY_SETTINGS = join(root, 'kybernos-memory.json')
const studyFile = join(root, 'kybernos-settings.json')
process.env.KYBERNOS_SETTINGS_FILE = studyFile
delete globalThis[Symbol.for('kybernos.studyModel')]
delete globalThis[Symbol.for('kybernos.space')]

let pass = 0
const ok = (label) => { pass += 1; console.log('  \u2713 ' + label) }
const dirOf = (kyber) => join(kybers, kyber, 'memory')
const fileOf = (kyber) => join(dirOf(kyber), 'lessons.jsonl')
const raw = (kyber) => readFileSync(fileOf(kyber), 'utf8')
const rows = (kyber) => raw(kyber).split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l))
const put = (kyber, lessons) => { mkdirSync(dirOf(kyber), { recursive: true }); writeFileSync(fileOf(kyber), lessons.map((l) => JSON.stringify(l)).join('\n') + '\n') }
const iso = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString()
const L = (text, over = {}) => ({ ts: iso(60), text, tags: [], uses: 0, lastUsed: null, ...over })
const active = (session, kyber) => writeFileSync(join(kybers, '.active', session), JSON.stringify({ kybers: [{ id: kyber }] }))

// A lesson of about the measured median length (325 characters), all different, made of plain words.
const WORDS = 'bundler cache config deploy export route header token retry backoff mirror atlas sprite padding render session worker queue timeout socket port proxy schema migration index'.split(' ')
const medianLesson = (i) => {
  let t = 'When the ' + WORDS[i % 25] + ' ' + WORDS[(i * 7 + 3) % 25] + ' fails after a restart, check the ' + WORDS[(i * 3 + 1) % 25] + ' first'
  for (let k = 0; t.length < 318; k++) t += (k === 0 ? ': ' : ', then ') + 'the ' + WORDS[(i + k * 5) % 25] + ' ' + WORDS[(i * 11 + k) % 25] + ' must be ' + WORDS[(k * 13 + i) % 25]
  return t.slice(0, 324).trim() + '.'
}

const store = await import('./lessons-store.mjs')
const dedupe = await import('./dedupe.mjs')
const compact = await import('./compact.mjs')
const mod = await import('./index.js')

try {
  console.log('kybernos-memory \u2014 lessons as an index')

  // -- 1. title and summary: optional fields, derived at read time for old lines, never written back --------------------------
  put('web-studio', [
    L('Always restart the bundler after editing app.json; the cache keeps the old config and the change looks ignored.', { extra: 'kept by every rewrite' }),
    L('short rule'),
  ])
  const before = raw('web-studio')
  const listed = store.listLessons({ kyber: 'web-studio' }).items
  const long = listed.find((l) => l.text.startsWith('Always'))
  assert.equal(long.title, 'Always restart the bundler after editing app.json', 'the fallback title is the first clause')
  assert.equal(long.summary, long.text, 'a one-sentence lesson under 140 characters is its own summary')
  assert.equal(long.titled, false)
  const cut = store.lessonHeads({ text: 'Word '.repeat(40) + 'end.' })
  assert.ok(cut.title.length <= store.LESSON_TITLE_MAX && cut.title.endsWith('\u2026') && !/\sWor\u2026$/.test(cut.title) && /Word\u2026$/.test(cut.title), 'cut at a word boundary: ' + cut.title)
  assert.ok(cut.summary.length <= store.LESSON_SUMMARY_MAX && cut.summary.endsWith('Word\u2026'), 'the summary too: ' + cut.summary)
  mod.renderLessonsChunk({ agent: { session: { id: 'sess-none-000001' } } })
  store.searchLessons('bundler')
  assert.equal(raw('web-studio'), before, 'reading, searching and the prompt never write a derived title back')
  ok('fields: an old line gets a derived title (first clause) and summary (first sentence), cut at a word, never written back')

  const made = store.addLesson('web-studio', { text: 'Pin the proxy port in the worker config.', title: '  Proxy   port\n pinned  ', summary: 'S'.repeat(30) + ' ' + 'x'.repeat(200) })
  const madeRow = rows('web-studio').find((r) => r.text.startsWith('Pin the proxy'))
  assert.equal(madeRow.title, 'Proxy port pinned', 'one line, trimmed')
  assert.ok(madeRow.summary.length <= store.LESSON_SUMMARY_MAX && madeRow.summary.endsWith('\u2026'), 'clipped to ' + String(store.LESSON_SUMMARY_MAX))
  assert.equal(made.lesson.titled, true)
  store.addLesson('web-studio', { text: 'A lesson whose title is only punctuation.', title: ' ... ', summary: 42 })
  const odd = rows('web-studio').find((r) => r.text.startsWith('A lesson whose'))
  assert.equal('title' in odd || 'summary' in odd, false, 'a title with no letter and a summary that is not a string are not stored')
  const up = store.updateLesson(made.lesson.id, { title: 'Proxy port', summary: null })
  assert.equal(up.ok, true)
  const upRow = rows('web-studio').find((r) => r.text.startsWith('Pin the proxy'))
  assert.deepEqual([upRow.title, 'summary' in upRow], ['Proxy port', false], 'a title changes, a null summary goes back to the derived one')
  store.markUsed(listed.find((l) => l.text.startsWith('Always')).id)
  store.updateLesson(store.listLessons({ kyber: 'web-studio', q: 'bundler' }).items[0].id, { tags: ['build'] })
  assert.equal(rows('web-studio').find((r) => r.text.startsWith('Always')).extra, 'kept by every rewrite', 'a field this bundle does not know survives every rewrite')

  const w = mod.lessonWriteTool()
  assert.ok(w.parameters.properties.title !== undefined && w.parameters.properties.summary !== undefined)
  const wrote = await w.execute({ kyber: 'web-studio', text: 'y'.repeat(700), title: 'T'.repeat(90), summary: 'A summary.', tags: ['long'] })
  assert.equal(wrote.ok, true)
  const wroteRow = rows('web-studio').find((r) => r.tags.includes('long'))
  assert.equal(wroteRow.text.length, store.LESSON_MAX_CHARS + 1, 'the text cap stays 500')
  assert.ok(wroteRow.title.length <= store.LESSON_TITLE_MAX && wroteRow.summary === 'A summary.')
  ok('fields: lesson_write and the store take an optional title and summary, validated and clipped; unknown fields survive')

  // -- 2. the prompt block is an index ----------------------------------------------------------------------------------------
  for (const k of store.listKybers()) rmSync(join(kybers, k), { recursive: true, force: true })
  const fifty = Array.from({ length: 50 }, (_, i) => L(medianLesson(i), { ts: iso(i + 1), uses: i % 4 }))
  const median = [...fifty.map((l) => l.text.length)].sort((a, b) => a - b)[25]
  assert.ok(median >= 315 && median <= 335, 'the fixture is at the measured median length: ' + String(median))
  put('web-studio', fifty)
  put('default', [L('Say what you verified and what you did not.', { uses: 3 })])
  const SES = 'sess-index-000001'
  active(SES, 'web-studio')
  const block = mod.renderLessonsChunk({ agent: { session: { id: SES } } })
  const entries = block.split('\n').filter((l) => /^- (web-studio|default):[0-9a-f]{12} \S/.test(l))
  assert.ok(entries.filter((l) => l.startsWith('- web-studio:')).length >= 30, 'a 50-lesson team at median length shows at least 30 entries: ' + String(entries.length))
  assert.ok(block.length <= mod.CHUNK_MAX_CHARS, 'inside the same budget: ' + String(block.length))
  assert.ok(entries.some((l) => l === "- " + store.lessonId('default', { ts: rows('default')[0].ts, text: rows('default')[0].text }) + ' Say what you verified and what you did not.'), 'default keeps its place, a short lesson whole')
  assert.ok(/lesson_read/.test(block) && /Before you rely on one/.test(block), 'one line tells the model to read a lesson before relying on it')
  assert.ok(/more not shown: lesson_search/.test(block), 'what does not fit is counted')
  assert.equal(mod.renderLessonsChunk({ agent: { session: { id: SES } } }), block, 'the same files give the same text, byte for byte')
  const firstEntry = entries.find((l) => l.startsWith('- web-studio:'))
  const shownId = firstEntry.slice(2).split(' ')[0]
  assert.ok(store.parseLessonId(shownId) !== null, 'the index prints the lesson_forget id form')
  // a lesson with its own title and summary shows both
  const titled = rows('web-studio')
  titled[0] = { ...titled[0], uses: 99, title: 'Bundler cache after restart', summary: 'Check the cache before the route.' }
  put('web-studio', titled)
  const withTitle = mod.renderLessonsChunk({ agent: { session: { id: SES } } })
  assert.ok(withTitle.split('\n').some((l) => / Bundler cache after restart( : Check the cache\u2026| : Check the cache before the route\.)?$/.test(l) && l.startsWith('- web-studio:')), 'own title (and summary when the width allows)')
  ok('index: a 50-lesson team at median length shows >= 30 one-line entries, inside 2400, the same text for the same files')

  // the relevance pick is written in full, the rest is the index
  put('web-studio', [...fifty.slice(0, 46),
    L('The zeppelin gondola autopilot drifts when the ballast table is stale: refresh the ballast table first', { ts: iso(80000), tags: ['zeppelin'] }),
    L('Gondola autopilot logs of the zeppelin must be rotated hourly or the ballast console freezes', { ts: iso(81000) })])
  mod.sessionQuery.clear(); mod.sessionPick.clear()
  mod.noteUserTurn(SES, { source: { kind: 'user' }, content: [{ type: 'text', text: 'the zeppelin gondola autopilot drifts, is the ballast table stale?' }] }, 1)
  const picked = mod.planLessons(SES, { relevant: true })
  assert.equal(picked.full.length, 2, 'the two clear matches')
  const withPick = mod.renderLessonsChunk({ agent: { session: { id: SES } } })
  assert.ok(withPick.includes('- [web-studio] The zeppelin gondola autopilot drifts when the ballast table is stale: refresh the ballast table first #zeppelin'), 'a match in full, as before')
  assert.ok(withPick.indexOf('- [web-studio] The zeppelin') < withPick.indexOf('lesson_read'), 'before the index')
  assert.ok(withPick.split('\n').filter((l) => l.startsWith('- web-studio:')).length >= 20 && withPick.length <= mod.CHUNK_MAX_CHARS)
  ok('index: the 2-4 clear matches of the latest message come first, in full; the others are index lines')

  // -- 3. lesson_read ------------------------------------------------------------------------------------------------------
  put('web-studio', [L('Restart the worker after a schema migration, or the old index stays in memory.', { tags: ['db'], title: 'Worker after migration' }), L('Second lesson about the socket timeout.')])
  const r = mod.lessonReadTool()
  assert.equal(r.name, 'lesson_read')
  assert.deepEqual([r.parameters.properties.ids.minItems, r.parameters.properties.ids.maxItems], [1, 5])
  const idA = store.lessonId('web-studio', rows('web-studio')[0])
  const read = await r.execute({ ids: ['#' + idA, 'web-studio:000000000000', 'garbage'] })
  assert.equal(read.ok, true)
  assert.equal(read.count, 1)
  assert.ok(read.found.includes('Worker after migration') && read.found.includes('Restart the worker after a schema migration, or the old index stays in memory.') && read.found.includes('#db'), 'title, full text and tags')
  assert.equal(read.missing, 'web-studio:000000000000, garbage')
  assert.ok(r.output.render({}, read)[0].text.includes('Unknown ids (no such lesson): web-studio:000000000000, garbage'), 'unknown ids are said plainly')
  assert.equal(rows('web-studio')[0].uses, 1, 'reading a lesson counts as a use')
  assert.equal((await r.execute({ ids: [] })).error, 'ids_manquants')
  assert.ok(/^trop_d_ids/.test((await r.execute({ ids: ['a:1', 'b:2', 'c:3', 'd:4', 'e:5', 'f:6'] })).error), 'six ids are refused')
  await mod.ROUTES.find((x) => x.path === '/kybernos-memory/settings/set').run({ url: '/' }, { lessons: false })
  assert.equal((await r.execute({ ids: [idA] })).error, 'lecons_desactivees')
  await mod.ROUTES.find((x) => x.path === '/kybernos-memory/settings/set').run({ url: '/' }, { lessons: true })
  ok('lesson_read: full text, title and tags by id, counts the use, unknown ids said plainly, 1 to 5 ids')

  // -- 4. dedupe: "+" against "plus", quotes, one number more ---------------------------------------------------------------
  const mk = (id, content, extra = {}) => ({ id, content, createdAt: '2026-11-01 10:00:00+00:00', bucket: 'team', ...extra })
  const pairA = 'The smoke check + the overlay probe mark a frozen widget (delta 0) as healthy: look at the rendered \u00abstate\u00bb before trusting the probe.'
  const pairB = 'The smoke check plus the overlay probe mark a frozen widget as healthy: look at the rendered "state" before trusting the probe.'
  assert.equal(dedupe.clash(pairA, pairB), null, 'a number only one of them has is a detail, not another value')
  const merged = dedupe.findDuplicateGroups([mk(1, pairB, { createdAt: '2026-11-05 10:00:00+00:00' }), mk(2, pairA)])
  assert.equal(merged.length, 1, 'the paraphrased pair merges')
  assert.ok(merged[0].score >= dedupe.AUTO_MIN_SCORE, 'above the auto line: ' + String(merged[0].score))
  assert.equal(merged[0].keeperId, 2, 'the keeper is the one that holds the number, so the merge loses none')
  assert.equal(dedupe.canon('a \u2018b\u2019 + c & d \u2014 e'), "a 'b' plus c and d - e")
  assert.equal(dedupe.clash('The dev server listens on port 3000 for the whole project', 'The dev server listens on port 3080 for the whole project'), 'number', 'another value still clashes')
  assert.equal(dedupe.clash('Do not commit the env files + the keys to the repository', 'Commit the env files plus the keys to the repository'), 'negation', 'a negation still clashes')
  assert.equal(dedupe.findDuplicateGroups([mk(1, 'Do not commit the env files + the keys to the repository'), mk(2, 'Commit the env files plus the keys to the repository')]).length, 0)
  assert.equal(dedupe.findDuplicateGroups([mk(1, 'The dev server listens on port 3000 for the whole project'), mk(2, 'The dev server listens on port 3080 for the whole project')]).length, 0)
  const base12 = 'alpha beta gamma delta epsilon zeta theta iota kappa lambda sigma omega'
  const keeps = dedupe.findDuplicateGroups([mk('x', base12 + ' 7'), mk('y', base12 + ' xxone yytwo')])
  assert.deepEqual([keeps.length, keeps[0] && keeps[0].keeperId], [1, 'x'], 'the most complete text would lose the 7: the one with the number keeps the group')
  assert.equal(dedupe.negationCount('Never do this, and do not do that: no.'), 3)
  ok('dedupe: "+" and "plus", typographic and plain quotes, one extra number merge; a negation or another value still stays apart')

  // -- 5. compaction rules --------------------------------------------------------------------------------------------------
  const longText = 'Never deploy the export worker on a Friday after 16:00, because the mirror sync takes 3 hours and nobody is there to watch it; ' + 'if a deploy is urgent, deploy the route header only and keep the queue paused, then check the token backoff and the socket timeout before the weekend starts, without touching the schema.'
  assert.ok(longText.length > compact.COMPACT_TEXT_MAX)
  const good = { title: 'No Friday deploys of the export worker', summary: 'Never deploy the export worker on Friday after 16:00: the 3-hour mirror sync is unwatched.', text: 'Never deploy the export worker on Friday after 16:00: the mirror sync takes 3 hours and nobody watches it. If urgent, deploy only the route header, keep the queue paused, check token backoff and socket timeout, without touching the schema.' }
  const checked = compact.checkRewrite(longText, good)
  assert.equal(checked.ok, true, JSON.stringify(checked))
  // A text that fails a check is not taken: the lesson keeps its own words, with the sound title and summary (textRefused says why).
  const keepsOwn = (r, why) => r.ok === true && r.text === longText && r.textRefused === why && r.title === good.title
  assert.ok(keepsOwn(compact.checkRewrite(longText, { ...good, text: good.text.replace('3 hours', 'hours') }), 'number'), 'a text that loses a number is not taken')
  assert.ok(keepsOwn(compact.checkRewrite(longText, { ...good, text: good.text.replace('16:00', '17:00') }), 'number'), 'nor one that changes a number')
  assert.ok(keepsOwn(compact.checkRewrite(longText, { ...good, text: good.text.replace(', without touching the schema', ' and the schema') }), 'negation'), 'nor one that loses a negation')
  assert.ok(keepsOwn(compact.checkRewrite(longText, { ...good, text: good.text + ' '.repeat(3) + 'x'.repeat(200) }), 'text'), 'nor one over 300 characters')
  // A title or summary that is unsound refuses the whole answer; one a little long is cut at a word.
  // An unsafe summary is not written (the index shows the lesson's own first sentence); the title is still taken.
  const noSummary = (r, why) => r.ok === true && r.summary === null && r.summaryRefused === why && r.title === good.title
  assert.ok(noSummary(compact.checkRewrite(longText, { ...good, summary: 'Deploy the export worker on Friday after 16:00.' }), 'negation'), 'a summary that drops the "never" is not written')
  assert.ok(noSummary(compact.checkRewrite(longText, { ...good, summary: good.summary + ' at 23:00' }), 'number'), 'nor one with a number the lesson does not hold')
  assert.ok(noSummary(compact.checkRewrite(longText, { ...good, summary: '' }), 'summary'), 'nor an empty one')
  assert.equal(compact.checkRewrite(longText, { ...good, title: '---' }).why, 'title')
  assert.equal(compact.checkRewrite(longText, { ...good, title: 'Deploy at 23:00' }).why, 'number', 'a title with a number the lesson does not hold refuses all')
  assert.equal(compact.checkRewrite('Deploy on Fridays.', { title: 'Never deploy on Fridays', summary: 'Deploy on Fridays.', text: 'Deploy on Fridays.' }).why, 'negation', 'a title that adds a "not" refuses all')
  const longTitle = compact.checkRewrite(longText, { ...good, title: 'Export worker deploys need a quiet window and no schema change at all' })
  assert.ok(longTitle.ok === true && longTitle.title.length <= 60 && !/\s$/.test(longTitle.title), 'a title over 60 characters is cut at a word, not refused')
  // Measured 2026-11-08 (deepseek-v4.1-flash): a reasoning model spent the whole 4,000-token cap thinking and the JSON was cut. The whole items before the cut are kept.
  const cutAnswer = '{"items":[{"n":1,"title":"Rule one","summary":"Short rule 2.","text":"Short rule 2."},{"n":2,"title":"Rule \\"two\\" {x}","summary":"Short rule 3.","text":"Short rule 3."},{"n":3,"title":"Ru'
  assert.deepEqual(compact.parseCompactions(cutAnswer, [{ text: 'Short rule 2.' }, { text: 'Short rule 3.' }, { text: 'Short rule 4.' }]).map((x) => x.ok ? 'ok' : x.why), ['ok', 'ok', 'shape'], 'an answer cut short keeps its whole items')
  assert.ok(compact.COMPACT_MAX_TOKENS >= 16000 && compact.COMPACT_TIMEOUT_MS >= 180000, 'room for a reasoning model to think, then answer')
  assert.equal(compact.checkRewrite('Short rule 2.', { title: 'Rule', summary: 'Short rule 2.', text: 'Short rule 2.' }).text, 'Short rule 2.', 'a short lesson given back unchanged keeps its text')
  assert.equal(compact.checkRewrite('Short rule 2.', { title: 'Rule', summary: 'Short rule 2.', text: 'A much longer rule 2 than before.' }).textRefused, 'longer')
  assert.deepEqual(compact.parseCompactions('nonsense', [{ text: 'a' }]).map((x) => x.why), ['shape'], 'a slip changes nothing')
  ok('compaction: a text that loses or changes a number, loses a negation, or is too long is not taken (title and summary are); an unsound title or summary refuses all; a cut answer keeps its whole items')

  // -- 6. the tidy-up compacts, archives, logs, and Undo reverts it --------------------------------------------------------
  for (const k of store.listKybers()) rmSync(join(kybers, k), { recursive: true, force: true })
  const tidyFile = join(root, 'kybernos-memory.tidy.json')
  rmSync(tidyFile, { force: true })
  put('ops', [
    L(longText, { ts: iso(500), uses: 2, tags: ['deploy'] }),
    L('Keep the proxy port at 8080 in the staging config.', { ts: iso(400) }),
    L('Never restart the queue during a migration.', { ts: iso(300), title: 'Queue during migration', summary: 'Never restart the queue during a migration.' }),
  ])
  const opsBefore = raw('ops')
  const tidyRoute = (p) => mod.ROUTES.find((x) => x.path === '/kybernos-memory/tidy' + p)
  assert.deepEqual((await tidyRoute('').run({ url: '/' }, null)).settings, { mode: 'auto', schedule: 'daily', brain: true }, 'the lessons tidy-up: daily, with the Study model, by default')

  // without a model nothing new is written
  writeFileSync(studyFile, JSON.stringify({ brain: 'none' }))
  const noModel = await mod.tidyRun('manual')
  assert.deepEqual([noModel.compact.asked, noModel.compact.compacted, noModel.compact.titled], [0, 0, 0])
  assert.equal(raw('ops'), opsBefore, 'no Study model: no lesson is touched')
  assert.equal(existsSync(join(dirOf('ops'), 'lessons.archive.jsonl')), false)
  assert.equal('settings' in JSON.parse(readFileSync(tidyFile, 'utf8')), false, 'a run does not freeze the defaults into the file')

  const calls = []
  let answer = null
  const fakeLlm = { stream: (o) => (async function* () { calls.push(o); yield { type: 'text-delta', text: answer(o.messages[0].content[0].text) }; yield { type: 'finish', reason: { kind: 'stop' } } })() }
  mod.apply({ get: (n) => (n === 'llm' ? fakeLlm : undefined), inject: () => {}, effect: () => {} })
  writeFileSync(studyFile, JSON.stringify({ brain: 'test/study-model' }))
  const blocksOf = (prompt) => prompt.split('\n\n').slice(1).map((b) => b.replace(/^n=\d+\n/, ''))
  answer = (prompt) => JSON.stringify({ items: blocksOf(prompt).map((text, i) => (text.startsWith('Never deploy') ? { n: i + 1, ...good } : text.startsWith('Keep the proxy') ? { n: i + 1, title: 'Staging proxy port', summary: 'The staging proxy port is 9090.', text } : { n: i + 1, title: 'x', summary: 'y', text })) })
  const ran = await mod.tidyRun('manual')
  assert.equal(calls.length, 1, 'one question for the two lessons that need it (the titled short one is left alone)')
  assert.ok(!/Never restart the queue/.test(calls[0].messages[0].content[0].text), 'a lesson that already has a title and is short is not sent')
  assert.deepEqual([ran.compact.compacted, ran.compact.titled, ran.compact.refused, ran.compact.why['summary-number']], [0, 2, 0, 1], JSON.stringify(ran.compact))
  const after = rows('ops')
  const kept = after.find((l) => l.text === longText)
  assert.ok(kept !== undefined && kept.text.length > 300, 'the long lesson keeps every word of its text: the model never rewrites it (2026-11-20)')
  assert.deepEqual([kept.title, kept.summary, kept.uses, kept.tags], [good.title, good.summary, 2, ['deploy']], 'with its title and summary; uses and tags kept')
  const proxy = after.find((l) => l.text.startsWith('Keep the proxy'))
  assert.deepEqual([proxy.title, 'summary' in proxy], ['Staging proxy port', false], 'a summary with an invented number is not written; the title is')
  assert.equal(existsSync(join(dirOf('ops'), 'lessons.archive.jsonl')), false, 'no text changed, so nothing goes to the lessons archive')
  const view = await tidyRoute('').run({ url: '/' }, null)
  const entry = view.log.find((l) => l.kind === 'title')
  assert.ok(entry !== undefined && entry.by === 'brain' && entry.canUndo === true && entry.kyber === 'ops', 'the tidy log has an entry the Undo can revert')
  assert.equal(view.last.compacted, 0)
  // the refused one is not asked again for a while
  calls.length = 0
  await mod.tidyRun('manual')
  assert.equal(calls.length, 0, 'a lesson that has its title is not asked again the next day')
  for (const e of view.log.filter((l) => l.kind === 'title' && l.kyber === 'ops')) {
    const undone = await tidyRoute('/undo').run({ url: '/' }, { run: e.id })
    assert.equal(undone.ok, true, JSON.stringify(undone))
  }
  const back = rows('ops').find((l) => l.text === longText)
  assert.ok(back !== undefined && !('title' in back) && !('summary' in back) && back.uses === 2, 'Undo takes the title and summary off again')
  ok('tidy: with a model, an untitled lesson gets a title and summary and keeps its text, logged, undone by the existing Undo; a bad summary writes nothing')

  // "Ask me first": titles and summaries only, never a new text
  rmSync(tidyFile, { force: true })   // a clean state: no refused rewrite remembered
  await tidyRoute('/settings').run({ url: '/' }, { mode: 'ask' })
  calls.length = 0
  await mod.tidyRun('manual')
  const asked = rows('ops').find((l) => l.text === longText)
  assert.ok(asked !== undefined && asked.title === good.title, 'ask mode: the title is written, the text is the person\'s')
  ok('tidy: in "Ask me first" the Study model only adds titles and summaries')

  // a saved settings file keeps what it says
  writeFileSync(tidyFile, JSON.stringify({ settings: { mode: 'auto', schedule: 'weekly', brain: false } }))
  assert.deepEqual((await tidyRoute('').run({ url: '/' }, null)).settings, { mode: 'auto', schedule: 'weekly', brain: false })
  writeFileSync(tidyFile, JSON.stringify({ settings: { mode: 'ask' } }))
  assert.deepEqual((await tidyRoute('').run({ url: '/' }, null)).settings, { mode: 'ask', schedule: 'daily', brain: true }, 'what the file does not say is the lessons default')
  ok('settings: lessons default to daily with the Study model; a saved file keeps what it says')

  // -- 6b. a night asks about 96 lessons, the untitled first ------------------------------------------------------------------
  // Decided 2026-11-08: 12 questions of 8 a run, and a new (untitled, short) lesson is never starved by long ones that have a title.
  assert.equal(compact.COMPACT_BATCH * compact.COMPACT_MAX_CALLS, 96, 'about 96 lessons a night')
  const order = [{ id: 'a', text: 'x'.repeat(400), untitled: false }, { id: 'b', text: 'short new rule', untitled: true }, { id: 'c', text: 'y'.repeat(320), untitled: true }, { id: 'd', text: 'z'.repeat(500), untitled: false }]
  assert.deepEqual(order.sort(mod.compactOrder).map((x) => x.id), ['c', 'b', 'd', 'a'], 'untitled first, then the longest')
  rmSync(tidyFile, { force: true })
  for (const k of store.listKybers()) rmSync(join(kybers, k), { recursive: true, force: true })
  let seed = 7
  const word = () => { let w = ''; for (let k = 0; k < 6; k++) { seed = (seed * 1103515245 + 12345) % 2147483648; w += String.fromCharCode(97 + (seed >> 16) % 26) } return w }
  const longTitled = (i) => { const ws = []; while (ws.join(' ').length < 320) ws.push(word()); return L(ws.join(' ') + '.', { ts: iso(5000 + i), title: 'Rule ' + word(), summary: 'A long rule.' }) }
  for (const team of ['n-a', 'n-b', 'n-c']) put(team, Array.from({ length: 35 }, (_, i) => longTitled(i)))
  put('n-d', [L('Freshly learned: check the gateway banner first.', { ts: iso(1) })])
  calls.length = 0
  const answerBefore = answer
  answer = () => '{"items":[]}'
  await mod.tidyRun('manual')
  answer = answerBefore
  const compactCalls = calls.filter((c) => /tidy short lessons/.test(c.messages[0].content[0].text))
  assert.equal(compactCalls.length, 1, 'the 105 long lessons that already have a title are not asked any more: only the one untitled lesson is (2026-11-20)')
  assert.ok(/Freshly learned: check the gateway banner first/.test(compactCalls[0].messages[0].content[0].text), 'the new untitled lesson is in the question')
  for (const k of store.listKybers()) rmSync(join(kybers, k), { recursive: true, force: true })
  rmSync(tidyFile, { force: true })
  put('n-e', Array.from({ length: 100 }, (_, i) => L('Untitled rule number ' + word() + ' ' + String(i), { ts: iso(6000 + i) })))
  calls.length = 0
  answer = () => '{"items":[]}'
  await mod.tidyRun('manual')
  answer = answerBefore
  assert.equal(calls.filter((c) => /tidy short lessons/.test(c.messages[0].content[0].text)).length, compact.COMPACT_MAX_CALLS, '12 questions for 100 untitled lessons: a night is bounded')
  for (const k of store.listKybers()) rmSync(join(kybers, k), { recursive: true, force: true })
  ok('compaction: only untitled lessons are asked, 12 questions of 8 a run, the untitled first')

  // -- 7. memory_tidy ------------------------------------------------------------------------------------------------------
  rmSync(tidyFile, { force: true })
  for (const k of store.listKybers()) rmSync(join(kybers, k), { recursive: true, force: true })
  put('ops', [
    L('Run the lifecycle tests before every push to the repository', { ts: iso(3000), title: 'Tests before push', summary: 'Run the lifecycle tests before every push.' }),
    L('Always run the lifecycle tests before every push to the repository', { ts: iso(2000), title: 'Tests before push', summary: 'Always run the lifecycle tests before every push.' }),
    L(longText, { ts: iso(100) }),
  ])
  const t = mod.memoryTidyTool()
  assert.equal(t.name, 'memory_tidy')
  assert.deepEqual(Object.keys(t.parameters.properties), ['dryRun'])
  const opsNow = raw('ops')
  calls.length = 0
  const dry = await t.execute({ dryRun: true })
  assert.equal(dry.ok, true)
  assert.equal(raw('ops'), opsNow, 'a dry run writes nothing')
  assert.equal(calls.length, 0, 'and asks no model')
  assert.ok(/Dry run/.test(dry.summary) && /Would merge 1 group/.test(dry.summary) && /memories: not connected\.$/.test(dry.summary), dry.summary)
  const real = await t.execute({})
  assert.equal(real.ok, true, JSON.stringify(real))
  assert.ok(/^Lessons: 3 before, 2 after\. Merged: 1 group\(s\) \(1 lesson\(s\) removed\)\. Compacted: 0\. Titles written: 1\. Errors: none\. memories: not connected\.$/.test(real.summary), 'without the account bundle the memories line is plain, not an error: ' + real.summary)
  assert.equal(t.output.render({}, real)[0].text, real.summary)
  // Measured 2026-11-08: the line read 'refused (negation 6, number 1, text-text 17)', counting the 17 texts kept under a new title as refusals.
  assert.equal(mod.refusalWords({ negation: 6, number: 1, 'text-text': 17, 'text-number': 2 }), 'a negation lost 6, a number lost or changed 1')
  assert.equal(mod.refusalWords(null), '')
  assert.equal(JSON.parse(readFileSync(tidyFile, 'utf8')).last.trigger, 'tool', 'the run is a tool run')
  // a run already in progress: waited for, bounded
  mod.tidyFlags.running = true
  const busy = await mod.memoryTidy({ waitMs: 60, pollMs: 10 })
  assert.deepEqual([busy.ok, busy.error], [false, 'deja_en_cours'])
  setTimeout(() => { mod.tidyFlags.running = false }, 30)
  const waited = await mod.memoryTidy({ waitMs: 5000, pollMs: 10 })
  assert.equal(waited.ok, true, 'it waits for the other run, then runs: ' + JSON.stringify(waited))
  await mod.ROUTES.find((x) => x.path === '/kybernos-memory/settings/set').run({ url: '/' }, { lessons: false })
  assert.equal((await t.execute({})).error, 'lecons_desactivees')
  await mod.ROUTES.find((x) => x.path === '/kybernos-memory/settings/set').run({ url: '/' }, { lessons: true })
  ok('memory_tidy: runs the lessons tidy-up now and says what it did in one line; dryRun writes nothing; a busy run is waited for')

  // -- 8. memory_tidy runs the account memories tidy-up too (kybernos-cloud's seam) --------------------------------------------
  const SEAM = Symbol.for('kybernos.memoriesTidy')
  assert.equal(mod.MEMORIES_TIDY_SEAM, SEAM)
  const seamCalls = []
  let seamAnswer = { ok: true, before: 148, after: 145, merged: 3, suggestions: 2, error: null }
  globalThis[SEAM] = async (o) => { seamCalls.push(o); return typeof seamAnswer === 'function' ? seamAnswer() : seamAnswer }
  try {
    const both = await t.execute({})
    assert.equal(both.ok, true)
    assert.ok(/ Memories: 148 before, 145 after, 3 merged, 2 left as suggestions\.$/.test(both.summary), both.summary)
    assert.ok(/^Lessons: /.test(both.summary), 'the lessons line first')
    assert.deepEqual(seamCalls, [{ dryRun: false }], 'the seam is called once, as a real run')
    seamAnswer = { ok: true, dryRun: true, before: 148, after: 147, merged: 1, suggestions: 4, error: null }
    const dryBoth = await t.execute({ dryRun: true })
    assert.deepEqual(seamCalls[1], { dryRun: true }, 'a dry run is a dry run for the memories too')
    assert.ok(/Memories: 148 now, would merge 1 group\(s\) \(147 after\), 4 left as suggestions\.$/.test(dryBoth.summary), dryBoth.summary)
    seamAnswer = { ok: true, before: 10, after: 10, merged: 0, suggestions: 1, error: 'delai_depasse' }
    assert.ok(/Memories: 10 before, 10 after, 0 merged, 1 left as suggestions \(Study model: delai_depasse\)\.$/.test((await t.execute({})).summary))
    seamAnswer = { ok: false, error: 'not_connected' }
    const off = await t.execute({})
    assert.equal(off.ok, true, 'not connected is not an error')
    assert.ok(/ memories: not connected\.$/.test(off.summary), off.summary)
    seamAnswer = { ok: false, error: 'deja_en_cours' }
    assert.ok(/ memories: not tidied \(another memories tidy-up is running\)\.$/.test((await t.execute({})).summary))
    seamAnswer = () => { throw new Error('boom') }
    assert.ok(/ memories: not tidied \(boom\)\.$/.test((await t.execute({})).summary), 'a seam that throws is said, never thrown')
    seamAnswer = () => new Promise(() => {})
    const slow = await mod.memoryTidy({ waitMs: 3000, pollMs: 10 })
    assert.ok(/ memories: still running, the Memory page shows the result\.$/.test(slow.summary), slow.summary)
    globalThis[SEAM] = 'not a function'
    assert.ok(/ memories: not connected\.$/.test((await t.execute({})).summary))
    // lessons switched off: the memories are still tidied
    seamAnswer = { ok: true, before: 5, after: 4, merged: 1, suggestions: 0, error: null }
    globalThis[SEAM] = async () => seamAnswer
    await mod.ROUTES.find((x) => x.path === '/kybernos-memory/settings/set').run({ url: '/' }, { lessons: false })
    const lessonsOff = await t.execute({})
    assert.deepEqual([lessonsOff.ok, lessonsOff.error, lessonsOff.summary], [false, 'lecons_desactivees', 'Lessons: switched off. Memories: 5 before, 4 after, 1 merged, 0 left as suggestions.'])
    await mod.ROUTES.find((x) => x.path === '/kybernos-memory/settings/set').run({ url: '/' }, { lessons: true })
  } finally {
    delete globalThis[SEAM]
  }
  ok('memory_tidy: runs the account memories tidy-up through kybernos-cloud\'s seam and says it in one line (not connected is a plain line; an error, a throw or a slow run is said, never thrown)')

  console.log('\n' + String(pass) + ' verifications OK')
} finally {
  rmSync(root, { recursive: true, force: true })
}
