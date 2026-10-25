#!/usr/bin/env node
// Tests of studio.mjs: the pure rules (prices, choice, check, quote) and the command line against a fake DSH that answers
// GET /kybernos-cloud/models. Nothing leaves the machine, nothing is written outside a temporary DSH_HOME.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildQuote, checkSettings, dollars, estimate, main, readModels, stateDir, toMicro, validateChoice, validateStoryboard } from './studio.mjs'

let pass = 0
const ok = (name) => { pass += 1; console.log('  ✓ ' + name) }

// ── the price of one unit, as integers ──
assert.equal(toMicro('0.14'), 140000)
assert.equal(toMicro('1'), 1000000)
assert.equal(toMicro('0.000015'), 15)
for (const bad of ['free', '', '0.1234567891', '1234567', '-1', '.5', '1.', null, undefined, 0.14]) assert.equal(toMicro(bad), null, String(bad))
assert.equal(toMicro('0.0000125'), 13, 'a finer price is rounded UP to the millionth, never down')
assert.equal(toMicro('0.123456789'), 123457)
assert.equal(toMicro('0.140000000'), 140000, 'the server may write trailing zeros')
assert.equal(toMicro('999999.999999999'), 1000000000000)
ok('a price is a plain decimal with at most 9 decimals, parsed exactly and rounded up to the millionth, else it is not a price')
assert.equal(dollars(0), '0.00')
assert.equal(dollars(1), '0.01')
assert.equal(dollars(140000), '0.14')
assert.equal(dollars(2540000), '2.54')
assert.equal(dollars(10067000), '10.07')
ok('a quote rounds UP to the cent: it never says less than it will cost')

// ── what the server offers ──
const ENTRIES = [
  { id: 'seedream-5.0', name: 'Seedream 5.0', kind: 'image', unit: 'image', usd: '0.14' },
  { id: 'flux-3-image', name: 'FLUX 3', kind: 'image', unit: 'image', usd: '0.19' },
  { id: 'wan-3.0', name: 'Wan 3.0', kind: 'video', unit: 'second', usd: '0.40' },
  { id: 'veo-3.1-fast', name: 'Veo 3.1 Fast', kind: 'video', unit: 'second', usd: '0.60' },
  { id: 'fish-s2.1-pro', name: 'Fish Audio S2.1 Pro', kind: 'speech', unit: 'thousand_characters', usd: '0.06' },
]
const body = (creation) => ({ ok: true, connected: true, models: { creation } })
assert.equal(readModels(null).state, 'none')
assert.equal(readModels({ connected: false }).state, 'none')
assert.equal(readModels(body([])).state, 'empty')
assert.equal(readModels(body('x')).state, 'empty')
const all = readModels(body(ENTRIES))
assert.equal(all.state, 'ok')
assert.equal(all.models.length, 5)
const odd = readModels(body([
  { id: 'a', kind: 'rerank', unit: 'image', usd: '1' }, { id: '', kind: 'image' }, null, 'x',
  { id: 'free', kind: 'image', unit: 'image', usd: 'free' },
  { id: 'wrong-unit', kind: 'image', unit: 'second', usd: '0.10' },
  { id: 'nameless', kind: 'video', unit: 'second', usd: '0.40' },
]))
assert.deepEqual(odd.models.map((m) => [m.id, m.usd, m.name]), [['free', null, 'free'], ['wrong-unit', null, 'wrong-unit'], ['nameless', '0.40', 'nameless']])
ok('the models of the account are read: unknown kinds and bad entries dropped, a price only counts in its kind\'s unit')

const sizes = { images: 5, clipSeconds: 20, chars: 450 }
assert.equal(estimate(all.models[0], sizes), 700000)
assert.equal(estimate(all.models[2], sizes), 8000000)
assert.equal(estimate(all.models[4], sizes), 27000)
assert.equal(estimate(odd.models[0], sizes), null)
ok('a model is compared by what a usual 30 s video would cost with it: 5 pictures, 20 s of clips, 450 characters')

// ── the choice the person validates ──
const m = all.models
let v = validateChoice('image', 'seedream-5.0', 'flux-3-image', m)
assert.equal(v.ok, true)
assert.deepEqual(v.choice.primary, { id: 'seedream-5.0', name: 'Seedream 5.0', unit: 'image', usd: '0.14' })
assert.equal(v.choice.backup.id, 'flux-3-image')
assert.equal(validateChoice('image', 'wan-3.0', undefined, m).ok, false, 'a video model is not a picture model')
assert.match(validateChoice('image', 'nope', undefined, m).error, /Offered: seedream-5\.0, flux-3-image/)
assert.equal(validateChoice('image', 'seedream-5.0', 'seedream-5.0', m).ok, false)
assert.equal(validateChoice('image', 'seedream-5.0', 'wan-3.0', m).ok, false, 'a backup of another kind is refused')
assert.equal(validateChoice('movie', 'a', 'b', m).ok, false)
v = validateChoice('speech', 'fish-s2.1-pro', undefined, m)
assert.equal(v.ok, true)
assert.equal(v.choice.backup, null)
assert.equal(v.noBackupPossible, true, 'a single model of the kind: no backup is possible, and it is said')
assert.equal(validateChoice('video', 'wan-3.0', undefined, m).noBackupPossible, false, 'two models exist: a backup was possible')
ok('a choice is a primary and a backup of the same kind, both offered by the account, never the same model')

// ── does the saved choice still hold? ──
const saved = (id, usd, backup) => ({ primary: { id, usd, unit: 'x' }, backup: backup || null })
const good = { image: saved('seedream-5.0', '0.14', { id: 'flux-3-image', usd: '0.19' }), video: saved('wan-3.0', '0.40', { id: 'veo-3.1-fast', usd: '0.60' }) }
assert.deepEqual(checkSettings({}, m).kinds.image, { status: 'missing' })
assert.equal(checkSettings({}, m).ready, false)
assert.equal(checkSettings(good, m).ready, true, 'voice is optional')
assert.equal(checkSettings({ ...good, speech: saved('fish-s2.1-pro', '0.06') }, m).ready, true)
assert.equal(checkSettings({ ...good, image: saved('gone-model', '0.14') }, m).kinds.image.status, 'gone')
assert.deepEqual(checkSettings({ ...good, image: saved('seedream-5.0', '0.10') }, m).kinds.image, { status: 'repriced', id: 'seedream-5.0', was: '0.10', now: '0.14' })
assert.equal(checkSettings({ ...good, image: saved('seedream-5.0', '0.14', { id: 'gone', usd: '1' }) }, m).kinds.image.status, 'backup-gone')
assert.equal(checkSettings({ ...good, video: saved('wan-3.0', '0.40', { id: 'veo-3.1-fast', usd: '0.55' }) }, m).kinds.video.status, 'backup-repriced')
assert.equal(checkSettings({ ...good, video: saved('wan-3.0', '0.40', { id: 'veo-3.1-fast', usd: '0.55' }) }, m).ready, false)
assert.equal(checkSettings({ ...good, speech: saved('fish-s2.1-pro', '0.05') }, m).ready, false, 'a voice that was chosen and moved needs a look; one never chosen does not')
assert.equal(checkSettings(null, m).ready, false)
ok('the saved choice is compared with what is offered now: gone, repriced, backup gone or repriced all call for a new validation')

// ── a storyboard and its quote ──
const SB = { title: 'x', shots: [
  { id: 1, seconds: 5, motion: 'clip' }, { id: 2, seconds: 6, motion: 'clip' }, { id: 3, seconds: 8, motion: 'clip' },
  { id: 4, seconds: 7, motion: 'still' }, { id: 5, seconds: 4, motion: 'clip' }] }
for (const [bad, why] of [
  [null, 'null'], [{}, 'no shots'], [{ shots: [] }, 'empty'], [{ shots: [{ id: 1, seconds: 0, motion: 'clip' }] }, 'zero seconds'],
  [{ shots: [{ id: 1, seconds: 31, motion: 'clip' }] }, 'too long'], [{ shots: [{ id: 1, seconds: 3, motion: 'gif' }] }, 'motion'],
  [{ shots: [{ id: 1, seconds: 3, motion: 'clip' }, { id: 1, seconds: 3, motion: 'clip' }] }, 'same id'],
  [{ shots: [{ seconds: 3, motion: 'clip' }] }, 'no id'], [{ shots: Array.from({ length: 41 }, (_, i) => ({ id: i, seconds: 1, motion: 'still' })) }, '41 shots'],
  [{ shots: [{ id: 1, seconds: 3, motion: 'clip' }], voice: { chars: 'many' } }, 'voice'],
]) assert.equal(validateStoryboard(bad).ok, false, why)
assert.equal(validateStoryboard(SB).ok, true)
ok('a storyboard is checked before anything is priced')

let q = buildQuote(SB, good)
assert.equal(q.ok, true)
assert.deepEqual(q.lines.map((l) => [l.label, l.count, l.micro]), [['pictures', 5, 700000], ['picture redos', 1, 140000], ['video clips', 23, 9200000]])
assert.equal(q.total, 10040000)
assert.equal(dollars(q.total), '10.04')
assert.equal(q.voice, 'local')
assert.equal(dollars(q.ceiling), '14.94', 'everything on the dearer of primary and backup: 6 pictures x 0.19 + 23 s x 0.60')
q = buildQuote({ ...SB, voice: { chars: 450 } }, { ...good, speech: saved('fish-s2.1-pro', '0.06') })
assert.equal(dollars(q.total), '10.07', '10.04 + 450 characters at 0.06 per thousand')
assert.equal(q.voice, 'account')
assert.equal(buildQuote({ ...SB, voice: { chars: 450 } }, good).voice, 'local', 'no validated voice: the free local one')
assert.equal(dollars(buildQuote(SB, good, { retries: 0 }).total), '9.90')
q = buildQuote({ shots: [{ id: 1, seconds: 5, motion: 'still' }, { id: 2, seconds: 5, motion: 'still' }] }, { image: good.image })
assert.equal(q.ok, true, 'a storyboard of stills needs no video model')
assert.equal(dollars(q.total), '0.42')
assert.equal(buildQuote(SB, { image: good.image }).code, 5, 'a clip needs a validated video model')
assert.equal(buildQuote(SB, {}).code, 5)
assert.equal(buildQuote(SB, { ...good, image: saved('seedream-5.0', null) }).code, 6, 'an unreadable price cannot be quoted')
assert.equal(buildQuote({ shots: [] }, good).code, 1)
ok('the quote: pictures, one redo, clip seconds, voice; a ceiling at the dearer model of each kind; a missing model or price is refused')

// ── the command line, against a fake DSH ──
let answer = { status: 200, json: body(ENTRIES) }
const server = createServer((req, res) => {
  if (req.url !== '/kybernos-cloud/models') { res.writeHead(404).end(); return }
  res.writeHead(answer.status, { 'content-type': 'application/json' })
  res.end(answer.raw !== undefined ? answer.raw : JSON.stringify(answer.json))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const home = mkdtempSync(join(tmpdir(), 'studio-'))
const env = { DSH_HOME: home, TIKTOK_STUDIO_BASE: 'http://127.0.0.1:' + String(server.address().port) }
const run = async (...argv) => { const lines = []; const code = await main(argv, env, (s) => lines.push(s)); return { code, text: lines.join('\n') } }
try {
  assert.equal(stateDir(env), join(home, 'kybernos', 'tiktok-studio'))
  let r = await run('models')
  assert.equal(r.code, 0)
  assert.match(r.text, /IMAGE {2}\(estimate for 5 pictures\)/)
  assert.match(r.text, /seedream-5\.0 +\$0\.14 \/ image +≈ \$0\.70/)
  assert.match(r.text, /wan-3\.0 +\$0\.40 \/ s +≈ \$8\.00/)
  assert.match(r.text, /fish-s2\.1-pro +\$0\.06 \/ 1,000 chars +≈ \$0\.03/)
  r = await run('models', '--json', '--images', '10')
  const listed = JSON.parse(r.text)
  assert.equal(listed.find((x) => x.id === 'seedream-5.0').estimate, '1.40')
  ok('models: the offer by kind with the price of a unit and the estimate for a usual video')

  r = await run('check')
  assert.equal(r.code, 5)
  assert.match(r.text, /image +missing/)
  r = await run('set', 'image', 'seedream-5.0', 'nope')
  assert.equal(r.code, 1)
  assert.match(r.text, /Offered:/)
  assert.equal((await run('settings')).text, 'Nothing validated yet.')
  r = await run('set', 'image', 'seedream-5.0', 'flux-3-image')
  assert.equal(r.code, 0)
  assert.match(r.text, /Saved: image primary seedream-5\.0 \(\$0\.14 \/ image\), backup flux-3-image/)
  assert.equal((await run('set', 'video', 'wan-3.0', 'veo-3.1-fast')).code, 0)
  const file = join(home, 'kybernos', 'tiktok-studio', 'settings.json')
  const kept = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(kept.video.primary.usd, '0.40', 'the price the person saw is kept')
  assert.match(kept.image.validatedAt, /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(statSync(file).mode & 0o077, 0, 'the file is private')
  assert.match((await run('settings')).text, /image: primary seedream-5\.0 \(\$0\.14 \/ image\), backup flux-3-image/)
  ok('set: the choice is validated against the offer, saved with the price that was shown, privately')

  assert.equal((await run('check')).code, 0)
  answer = { status: 200, json: body(ENTRIES.map((e) => (e.id === 'wan-3.0' ? { ...e, usd: '0.55' } : e))) }
  r = await run('check')
  assert.equal(r.code, 5)
  assert.match(r.text, /video +repriced \(wan-3\.0\) \$0\.40 -> \$0\.55/)
  answer = { status: 200, json: body(ENTRIES.filter((e) => e.id !== 'seedream-5.0')) }
  assert.match((await run('check')).text, /image +gone \(seedream-5\.0\)/)
  answer = { status: 200, json: body(ENTRIES) }
  ok('check: a model that left or changed its price is told, with the price it had when it was validated')

  const sbFile = join(home, 'storyboard.json')
  writeFileSync(sbFile, JSON.stringify(SB))
  r = await run('quote', sbFile)
  assert.equal(r.code, 0)
  assert.match(r.text, /QUOTE +\$10\.04 +ceiling if everything falls back to the dearer model: \$14\.94 +\(voice: the free local one\)/)
  assert.equal(JSON.parse((await run('quote', sbFile, '--json')).text).total, '10.04')
  assert.equal((await run('quote', join(home, 'missing.json'))).code, 1)
  ok('quote: read from the saved choice, with its ceiling')

  r = await run('doctor')
  assert.equal(r.code, 0)
  assert.match(r.text, /5 creation models offered/)
  assert.match(r.text, /generation: NOT wired yet/)
  answer = { status: 200, json: { ok: true, connected: false } }
  r = await run('doctor')
  assert.equal(r.code, 3)
  assert.match(r.text, /No Kybernos account is connected/)
  answer = { status: 200, json: body([]) }
  assert.equal((await run('models')).code, 4)
  assert.equal((await run('doctor')).code, 4)
  answer = { status: 500, json: {} }
  assert.equal((await run('models')).code, 2)
  answer = { status: 200, raw: '<html>' }
  assert.equal((await run('models')).code, 2)
  server.close()
  assert.equal((await main(['models'], { ...env, TIKTOK_STUDIO_BASE: 'http://127.0.0.1:1' }, () => {})), 2)
  assert.equal((await run('')).code, 1)
  ok('doctor and the others: no DSH (2), no account (3), no creation model (4), each said in words, and generation is said not to be wired')
} finally { rmSync(home, { recursive: true, force: true }); server.close() }

console.log('\n' + pass + ' groups of checks, all passed')
