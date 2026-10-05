#!/usr/bin/env node
// Tidy up, the shared half (tidy.mjs): settings, when a run is due, what may be merged without asking, and the Study
// model's judgement — against a fake `llm` service, so nothing leaves this machine.
//   node packages/kybernos-cloud/test-tidy.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  TIDY_DEFAULTS, normalizeTidySettings, patchTidySettings, tidyDue, tidyNext, pickAuto, AUTO_MAX_REMOVALS, readStudyModel, textHash,
  removalChunks, brainPrompt, parseVerdicts, askModel, brainGroups, BRAIN_BATCH, BRAIN_MAX_PAIRS, TIDY_N_NEW, AUTO_MIN_SCORE,
} from './tidy.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const HERE = dirname(fileURLToPath(import.meta.url))

console.log('settings')
assert.deepEqual(TIDY_DEFAULTS, { mode: 'auto', schedule: 'weekly', brain: false })
assert.deepEqual(normalizeTidySettings(undefined), TIDY_DEFAULTS)
assert.deepEqual(normalizeTidySettings({ mode: 'ask', schedule: 'daily', brain: true }), { mode: 'ask', schedule: 'daily', brain: true })
assert.deepEqual(normalizeTidySettings({ mode: 'yolo', schedule: 'hourly', brain: 'yes' }), TIDY_DEFAULTS, 'anything invalid falls back to the default, key by key')
assert.deepEqual(normalizeTidySettings({ mode: 'ask', schedule: 'nope' }), { ...TIDY_DEFAULTS, mode: 'ask' })
assert.deepEqual(patchTidySettings(TIDY_DEFAULTS, { schedule: 'n50' }), { ok: true, settings: { ...TIDY_DEFAULTS, schedule: 'n50' } })
assert.deepEqual(patchTidySettings(TIDY_DEFAULTS, { mode: 'ask', brain: true }).settings, { mode: 'ask', schedule: 'weekly', brain: true })
for (const bad of [null, [], 'x', {}, { mode: 'yolo' }, { schedule: 3 }, { brain: 'true' }, { mode: 'ask', other: 1 }, { other: 1 }]) assert.equal(patchTidySettings(TIDY_DEFAULTS, bad).ok, false, JSON.stringify(bad))
assert.deepEqual(patchTidySettings(TIDY_DEFAULTS, { mode: 'ask', brain: 'true' }), { ok: false, error: 'valeur_invalide', key: 'brain' }, 'one bad value applies nothing')
assert.equal(patchTidySettings(TIDY_DEFAULTS, { zzz: 1 }).error, 'cle_inconnue')
ok('defaults are auto + weekly + brain off; a patch is all or nothing; bad values fall back')

console.log('when')
const NOW = Date.parse('2026-10-05T12:00:00.000Z')
const ago = (days) => ({ at: new Date(NOW - days * 86400000).toISOString(), total: 100 })
const due = (o) => tidyDue({ now: NOW, total: 100, bootDone: false, last: ago(10), ...o })
assert.equal(due({ schedule: 'off' }), false)
assert.equal(due({ schedule: 'bogus' }), false)
assert.equal(due({ schedule: 'daily', last: ago(0.9) }), false)
assert.equal(due({ schedule: 'daily', last: ago(1.01) }), true)
assert.equal(due({ schedule: 'weekly', last: ago(6.9) }), false)
assert.equal(due({ schedule: 'weekly', last: ago(7.1) }), true)
assert.equal(due({ schedule: 'start', last: ago(2) }), false, 'a start run waits for the last one to be over 3 days old')
assert.equal(due({ schedule: 'start', last: ago(4) }), true)
assert.equal(due({ schedule: 'start', last: ago(4), bootDone: true }), false, 'and only once per start')
assert.equal(due({ schedule: 'n50', last: { ...ago(1), total: 100 }, total: 149 }), false)
assert.equal(due({ schedule: 'n50', last: { ...ago(1), total: 100 }, total: 150 }), true)
assert.equal(due({ schedule: 'n50', last: { ...ago(1), total: 100 }, total: null }), false, 'an unknown count never triggers')
assert.equal(due({ schedule: 'daily', last: null }), true, 'never run: due')
assert.equal(due({ schedule: 'weekly', last: null }), true)
assert.equal(due({ schedule: 'n50', last: null, total: 49 }), false, 'never run, but too few items to bother')
assert.equal(due({ schedule: 'n50', last: null, total: 50 }), true)
assert.equal(due({ schedule: 'daily', last: ago(3), retryAt: NOW + 1000 }), false, 'a failed run waits before the next attempt')
assert.equal(due({ schedule: 'daily', last: ago(3), retryAt: NOW - 1000 }), true)
assert.equal(TIDY_N_NEW, 50)
ok('off never; daily 24 h; weekly 7 days; start once per launch after 3 days; every 50 new; never-run is due; a retry delay is honoured')

const nx = (o) => tidyNext({ now: NOW, total: 100, last: ago(1), ...o })
assert.deepEqual(nx({ schedule: 'off' }), { kind: 'off' })
assert.equal(nx({ schedule: 'daily' }).kind, 'now', 'exactly a day ago: due at the next check')
assert.equal(nx({ schedule: 'daily', last: ago(0.5) }).at, new Date(NOW - 0.5 * 86400000 + 86400000).toISOString())
assert.equal(nx({ schedule: 'weekly', last: ago(8) }).kind, 'now', 'overdue: at the next check')
assert.equal(nx({ schedule: 'weekly', last: null }).kind, 'now')
assert.deepEqual(nx({ schedule: 'n50', last: { ...ago(1), total: 100 }, total: 120 }), { kind: 'count', remaining: 30 })
assert.deepEqual(nx({ schedule: 'n50', last: { ...ago(1), total: 100 }, total: 400 }), { kind: 'count', remaining: 0 })
assert.equal(nx({ schedule: 'start', last: ago(1) }).kind, 'start')
ok('the next run is described: off, at a date, now, a count to go, at start')

console.log('without asking')
const G = (id, score, n, extra = {}) => ({ id, score, by: 'local', items: Array.from({ length: n }, (_, i) => ({ id: id + '-' + String(i) })), ...extra })
const groups = [G('a', 100, 3), G('b', 80, 2), G('c', 79, 2), G('d', 95, 2, { by: 'brain', score: null }), G('e', 67, 4), G('f', 90, 1), G('g', 85, 3)]
assert.deepEqual(pickAuto(groups, { mode: 'auto' }).map((g) => g.id), ['a', 'b', 'g'], 'the line is 80: 79 and a containment group wait; a Study-model verdict never goes by itself; a single item is no group')
assert.deepEqual(pickAuto(groups, { mode: 'ask' }), [], 'ask first: nothing')
assert.deepEqual(pickAuto(groups, undefined).map((g) => g.id), ['a', 'b', 'g'], 'the default mode is auto')
assert.equal(AUTO_MIN_SCORE, 80)
const huge = [G('h1', 100, 60), G('h2', 100, 60), G('h3', 100, 3)]
assert.deepEqual(pickAuto(huge, { mode: 'auto' }, 100).map((g) => g.id), ['h1', 'h3'], 'a run removes at most ' + String(AUTO_MAX_REMOVALS) + ' by itself; what does not fit waits')
for (const bad of [null, undefined, 'x', [null, 3, {}], [{ items: 'no' }]]) assert.doesNotThrow(() => pickAuto(bad, { mode: 'auto' }))
ok('auto picks the local groups at 80 % and over, within the cap; ask mode, brain verdicts and weaker groups wait for a click')

const sizes = (chunks) => chunks.map((c) => c.reduce((n, g) => n + g.items.length - 1, 0))
const rc = removalChunks([G('a', 100, 31), G('b', 100, 21), G('c', 100, 11), G('d', 100, 11), G('e', 100, 3)], 50)
assert.ok(sizes(rc).every((n) => n <= 50) && rc.flat().map((g) => g.id).join('') === 'abcde' && rc.length === 2, 'requests of at most 50 removals, in order, no group lost')
assert.deepEqual(sizes(removalChunks([G('a', 100, 5), G('big', 100, 60), G('c', 100, 5)], 50)), [4, 59, 4], 'a group over the limit goes alone')
assert.deepEqual(removalChunks([], 50), [])
ok('removals are cut into requests of at most 50, a group over the limit alone')

console.log('the Study model setting')
assert.equal(readStudyModel(() => JSON.stringify({ brain: 'zai-coding-cn/GLM-5.3-Flash' })), 'zai-coding-cn/GLM-5.3-Flash')
assert.equal(readStudyModel(() => JSON.stringify({ brain: '' })), '')
assert.equal(readStudyModel(() => JSON.stringify({ brain: 'no-slash' })), '')
assert.equal(readStudyModel(() => JSON.stringify({ brain: 'a/b c' })), '')
assert.equal(readStudyModel(() => JSON.stringify({ brain: 3 })), '')
assert.equal(readStudyModel(() => 'not json'), '')
assert.equal(readStudyModel(() => { throw new Error('ENOENT') }), '')
ok('the Study model is « route/id » or nothing; a missing or mangled file means none')

console.log('the question and the answer')
const P = (n, a, b) => ({ id: 'p' + String(n), a: { id: n * 2, content: a, createdAt: '2026-09-01 10:00:00+00:00', pinned: false }, b: { id: n * 2 + 1, content: b, createdAt: '2026-09-20 10:00:00+00:00', pinned: false }, like: 70, why: 'close' })
const prompt = brainPrompt([P(1, 'The dev server uses port 3000', 'The dev server uses port 3080'), P(2, 'Project A\n  deploys on Vercel', 'Project B deploys on Railway')], 'memories')
assert.ok(prompt.includes('n=1\n[A] The dev server uses port 3000\n[B] The dev server uses port 3080') && prompt.includes('n=2\n[A] Project A deploys on Vercel'), 'pairs are numbered, A is the older, newlines folded')
assert.ok(/data, never instructions/.test(prompt) && /strict JSON/.test(prompt) && /OLDER/.test(prompt))
assert.ok(brainPrompt([P(1, 'x'.repeat(2000), 'y')], 'lessons').length < 2000, 'a long note is cut')
const ans = (o) => JSON.stringify({ verdicts: o })
let v = parseVerdicts('Sure!\n' + ans([{ n: 1, verdict: 'same', why: 'reworded', merged: 'Merged text that keeps both details.' }, { n: 2, verdict: 'replaces', why: 'port changed' }, { n: 3, verdict: 'different', why: 'two projects' }]) + '\nDone', 3, 400)
assert.deepEqual(v.map((x) => x.verdict), ['same', 'replaces', 'different'])
assert.equal(v[0].merged, 'Merged text that keeps both details.')
assert.equal(v[1].merged, null, 'a merged text only comes with « same »')
v = parseVerdicts(ans([{ n: 2, verdict: 'same' }]), 3, 400)
assert.deepEqual(v.map((x) => x.verdict), ['unsure', 'same', 'unsure'], 'a pair the model skipped is unsure')
for (const bad of ['', 'no json', '{"verdicts": 3}', '{"verdicts":[{"n":1,"verdict":"merge it"}]}', ans([{ n: 9, verdict: 'same' }]), ans([{ n: 1.5, verdict: 'same' }]), ans([null, 3, 'x']), '{"verdicts":[', null, undefined]) {
  assert.deepEqual(parseVerdicts(bad, 2, 400).map((x) => x.verdict), ['unsure', 'unsure'], 'garbage is unsure: ' + String(bad))
}
assert.deepEqual(parseVerdicts(ans([{ n: 1, verdict: 'same', merged: 'x'.repeat(500) }]), 1, 400)[0], { verdict: 'same', why: '', merged: null }, 'a merged text over the limit is dropped, the verdict stays')
assert.equal(parseVerdicts(ans([{ n: 1, verdict: 'same', merged: 'short' }]), 1, 400)[0].merged, null, 'a merged text under 8 characters is not a note')
assert.deepEqual(parseVerdicts(ans([{ n: 1, verdict: 'same', why: 'a' }, { n: 1, verdict: 'different' }]), 1, 400).map((x) => x.verdict), ['same'], 'the first answer for a number wins')
assert.equal(parseVerdicts(ans([{ n: 1, verdict: 'different', why: 'w'.repeat(500) }]), 1, 400)[0].why.length, 160)
ok('the prompt numbers the pairs and says the notes are data; the answer is parsed tolerantly and every slip becomes « unsure »')

console.log('one call')
const streamOf = (chunks) => ({ stream: () => (async function* () { for (const c of chunks) yield c })() })
const text = (t) => ({ type: 'text-delta', text: t })
const fin = (kind, extra = {}) => ({ type: 'finish', reason: { kind, ...extra } })
let r = await askModel(streamOf([text('{"a":'), text('1}'), fin('stop')]), 'zai/GLM', 'q')
assert.deepEqual(r, { text: '{"a":1}' })
let seen = null
await askModel({ stream: (o) => { seen = o; return (async function* () { yield fin('stop') })() } }, 'zai-coding-cn/GLM-5.3-Flash', 'hello', { maxTokens: 123 })
assert.deepEqual([seen.provider, seen.model, seen.maxTokens, seen.purpose], ['zai-coding-cn', 'GLM-5.3-Flash', 123, 'kybernos-tidy'], 'route and id are split on the first slash; the call says why it is made')
assert.equal(seen.messages[0].content[0].text, 'hello')
assert.equal(seen.messages[0].source.kind, 'kybernos-tidy')
assert.match(seen.messages[0].id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, 'the message id has the shape the engine\'s own probe uses (a UUID)')
assert.deepEqual(await askModel(null, 'a/b', 'q'), { error: 'llm_indisponible' })
assert.deepEqual(await askModel({}, 'a/b', 'q'), { error: 'llm_indisponible' })
assert.deepEqual(await askModel(streamOf([]), 'nomodel', 'q'), { error: 'modele_invalide' })
assert.equal((await askModel({ stream: () => { throw new Error('no key') } }, 'a/b', 'q')).error, 'modele_en_erreur')
const thrown = await askModel({ stream: () => (async function* () { throw Object.assign(new Error('boom'), { code: 'TRANSPORT' }) })() }, 'a/b', 'q')
assert.deepEqual([thrown.error, thrown.detail], ['modele_en_erreur', 'TRANSPORT: boom'], 'a failure says why')
const finErr = await askModel(streamOf([text('x'), fin('error', { failure: { code: 'SERVER', message: 'upstream 502' } })]), 'a/b', 'q')
assert.deepEqual([finErr.error, finErr.detail], ['modele_en_erreur', 'error SERVER: upstream 502'], 'a model that finished in error is an error, even with some text, and says why')
assert.deepEqual(await askModel(streamOf([text('cut'), fin('max-tokens')]), 'a/b', 'q'), { text: 'cut' })
const slow = { stream: ({ signal }) => (async function* () { await new Promise((res, rej) => { signal.addEventListener('abort', () => rej(new Error('aborted'))) }); yield text('late') })() }
const t0 = Date.now()
assert.equal((await askModel(slow, 'a/b', 'q', { timeoutMs: 40 })).error, 'delai_depasse')
assert.ok(Date.now() - t0 < 1500, 'a silent model is cut at the delay')
const outer = new AbortController()
setTimeout(() => outer.abort(), 20)
assert.equal((await askModel(slow, 'a/b', 'q', { timeoutMs: 5000, signal: outer.signal })).error, 'modele_en_erreur', 'the caller can stop it')
ok('a call is bounded, never throws, splits route/id, names its purpose and reports every failure by a code')

console.log('judging pairs')
const mk = (id, content, extra = {}) => ({ id, content, createdAt: '2026-09-10 10:00:00+00:00', pinned: false, bucket: 'fact', ...extra })
const items = [
  mk(1, 'The dev server listens on port 3000 for the whole project', { createdAt: '2026-08-01 10:00:00+00:00' }),
  mk(2, 'The dev server listens on port 3080 for the whole project', { createdAt: '2026-09-20 10:00:00+00:00' }),
  mk(3, 'Do not commit .env files to the repository', { createdAt: '2026-08-01 10:00:00+00:00' }),
  mk(4, 'Commit .env files to the repository', { createdAt: '2026-09-01 10:00:00+00:00' }),
  mk(5, 'Project A deploys on Vercel from the dev branch'),
  mk(6, 'Project B deploys on Railway from the dev branch'),
  mk(7, 'Prefers short answers in French'),
]
const calls = []
const fakeLlm = (decide) => ({ stream: (o) => { const prompt = o.messages[0].content[0].text; calls.push(prompt); return (async function* () { yield text(decide(prompt)); yield fin('stop') })() } })
const decideByContent = (prompt) => {
  const blocks = prompt.split('\n\n').slice(1)
  return JSON.stringify({ verdicts: blocks.map((b, i) => {
    if (/port 3000/.test(b)) return { n: i + 1, verdict: 'replaces', why: 'the port changed' }
    if (/\.env/.test(b)) return { n: i + 1, verdict: 'different', why: 'opposite rules' }
    if (/Vercel/.test(b)) return { n: i + 1, verdict: 'same', why: 'x', merged: 'Both projects deploy from the dev branch.' }
    return { n: i + 1, verdict: 'unsure' }
  }) })
}
const base = { items, taken: new Set(), judged: {}, dismissed: [], model: 'zai/GLM', maxMerged: 400, noun: 'memories', now: NOW }
let out = await brainGroups({ ...base, llm: fakeLlm(decideByContent) })
assert.equal(out.error, null)
assert.equal(calls.length, 1, 'all the pairs go in one question')
assert.equal(out.asked, 3)
const byType = Object.fromEntries(out.groups.map((g) => [g.type, g]))
assert.deepEqual(Object.keys(byType).sort(), ['merge', 'outdated'], '« different » makes no suggestion')
assert.equal(byType.outdated.keeperId, 2, 'the newer one stays')
assert.deepEqual(byType.outdated.items.map((i) => [i.id, i.keep]), [[2, true], [1, false]])
assert.equal(byType.outdated.verdict, 'the port changed')
assert.equal(byType.outdated.by, 'brain')
assert.equal(byType.outdated.score, null)
assert.equal(byType.merge.merged, 'Both projects deploy from the dev branch.')
assert.equal(byType.merge.saves, 1)
assert.deepEqual(Object.values(out.judged).map((j) => j.verdict).sort(), ['different', 'replaces', 'same'], 'every judgement is cached')
assert.equal(out.unclear, 3)
ok('the model\'s verdicts become suggestions: the newer one replaces the older, « same » carries the merged text, « different » stays quiet')

calls.length = 0
const again = await brainGroups({ ...base, judged: out.judged, llm: fakeLlm(decideByContent) })
assert.equal(calls.length, 0, 'a judged pair is not asked again')
assert.equal(again.asked, 0)
assert.deepEqual(again.groups.map((g) => g.id).sort(), out.groups.map((g) => g.id).sort(), 'but its suggestion is still there (until it is applied or kept apart)')
const edited = items.map((i) => (i.id === 2 ? { ...i, content: 'The dev server listens on port 4000 for the whole project' } : i))
await brainGroups({ ...base, items: edited, judged: out.judged, llm: fakeLlm(decideByContent) })
assert.equal(calls.length, 1, 'a pair whose text changed is asked again')
ok('a pair is asked once; its suggestion survives; a changed text is asked again')

calls.length = 0
const kept = await brainGroups({ ...base, dismissed: [out.groups.find((g) => g.type === 'outdated').id], llm: fakeLlm(decideByContent) })
assert.equal(kept.groups.some((g) => g.type === 'outdated'), false, 'a pair the user kept apart is neither shown nor asked')
assert.ok(!/port 3000/.test(calls[0] || ''))
const taken = await brainGroups({ ...base, taken: new Set([1, 2]), llm: fakeLlm(decideByContent) })
assert.equal(taken.groups.some((g) => g.type === 'outdated'), false, 'items already in a local group are not paired')
ok('pairs kept apart and items already grouped are left out of the question')

const pinnedOld = [mk(1, 'The dev server listens on port 3000 for the whole project', { createdAt: '2026-08-01 10:00:00+00:00', pinned: true }), mk(2, 'The dev server listens on port 3080 for the whole project', { createdAt: '2026-09-20 10:00:00+00:00' })]
const pin = await brainGroups({ ...base, items: pinnedOld, llm: fakeLlm(decideByContent) })
assert.equal(pin.groups.length, 0, 'a pinned item is never offered for removal: « outdated » on a pinned older note makes no suggestion')
const pinSame = await brainGroups({ ...base, items: [mk(5, 'Project A deploys on Vercel from the dev branch', { pinned: true }), mk(6, 'Project B deploys on Railway from the dev branch')], llm: fakeLlm(decideByContent) })
assert.equal(pinSame.groups[0].keeperId, 5, 'for « same », the pinned one is the keeper')
ok('a pinned note is never the one removed')

const many = Array.from({ length: 40 }, (_, i) => [mk(100 + i * 2, 'The deploy of service ' + String.fromCharCode(97 + (i % 26)) + String.fromCharCode(97 + Math.floor(i / 26)) + 'q uses the blue server for staging today'), mk(101 + i * 2, 'The deploy of service ' + String.fromCharCode(97 + (i % 26)) + String.fromCharCode(97 + Math.floor(i / 26)) + 'q uses the green server for staging today')]).flat()
calls.length = 0
const crowd = await brainGroups({ ...base, items: many, llm: fakeLlm(() => '{"verdicts":[]}') })
assert.ok(crowd.asked <= BRAIN_MAX_PAIRS, 'at most ' + String(BRAIN_MAX_PAIRS) + ' pairs per run')
assert.equal(calls.length, Math.ceil(crowd.asked / BRAIN_BATCH), 'in questions of at most ' + String(BRAIN_BATCH))
assert.ok(crowd.unclear > crowd.asked, 'the rest waits for the next run')
ok('a run asks about at most 30 pairs, 12 at a time')

let n = 0
const flaky = { stream: () => (async function* () { n += 1; if (n === 2) throw new Error('down'); yield text(JSON.stringify({ verdicts: Array.from({ length: BRAIN_BATCH }, (_, i) => ({ n: i + 1, verdict: 'different' })) })); yield fin('stop') })() }
const part = await brainGroups({ ...base, items: many, llm: flaky })
assert.equal(part.error, 'modele_en_erreur')
assert.equal(part.detail, 'down', 'the reason travels up to the host and the page')
assert.equal(part.asked, BRAIN_BATCH, 'what was judged before the failure is kept')
assert.equal(Object.keys(part.judged).length, BRAIN_BATCH)
const noLlm = await brainGroups({ ...base, llm: null })
assert.deepEqual([noLlm.groups.length, noLlm.asked, noLlm.unclear], [0, 0, 3], 'without a model nothing is asked, and the unclear pairs are still counted')
const noModel = await brainGroups({ ...base, model: '', llm: fakeLlm(decideByContent) })
assert.equal(noModel.asked, 0)
const garbage = await brainGroups({ ...base, llm: fakeLlm(() => 'I cannot do that') })
assert.deepEqual([garbage.groups.length, garbage.asked, garbage.error], [0, 3, null], 'an unreadable answer suggests nothing')
ok('a failure keeps what was judged, no model asks nothing, a garbled answer suggests nothing')

const big = {}
for (let i = 0; i < 600; i++) big['k' + String(i)] = { ha: 'a', hb: 'b', verdict: 'different', why: '', merged: null, at: new Date(NOW - i * 1000).toISOString() }
const trimmed = await brainGroups({ ...base, judged: big, llm: fakeLlm(decideByContent) })
assert.ok(Object.keys(trimmed.judged).length <= 500, 'the judgement cache is bounded')
assert.ok(trimmed.judged.k0 !== undefined && trimmed.judged.k599 === undefined, 'the oldest go first')
ok('the judgement cache keeps the newest 500')

console.log('shared module')
assert.equal(textHash('abc'), textHash('abc'))
assert.notEqual(textHash('abc'), textHash('abd'))
const memCopy = join(HERE, '..', 'kybernos-memory', 'tidy.mjs')
try {
  assert.equal(readFileSync(join(HERE, 'tidy.mjs'), 'utf8'), readFileSync(memCopy, 'utf8'), 'tidy.mjs is one module, copied into each bundle: the two copies must stay byte-identical')
  assert.equal(readFileSync(join(HERE, 'dedupe.mjs'), 'utf8'), readFileSync(join(HERE, '..', 'kybernos-memory', 'dedupe.mjs'), 'utf8'))
  ok('kybernos-memory/tidy.mjs and dedupe.mjs are byte-identical to the kybernos-cloud copies')
} catch (e) {
  if (e.code === 'ENOENT') throw new Error('copy the module into kybernos-memory: cp packages/kybernos-cloud/tidy.mjs packages/kybernos-memory/tidy.mjs')
  throw e
}

console.log('\n' + pass + ' verifications OK')
