// tiktok-scout: the scoring, the state files and the whole scout run, against a stand-in for yt-dlp (no network).
// `node .claude/skills/tiktok-scout/scripts/test-scout.mjs`
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as S from './scout.mjs'

let passed = 0
const t = async (name, fn) => {
  try { await fn(); passed++ } catch (e) { console.log('FAIL ' + name + '\n  ' + String(e.message).split('\n').join('\n  ')); process.exitCode = 1 }
}

const tmp = mkdtempSync(join(tmpdir(), 'tiktok-scout-'))
// The command line reads the real clock (its ages are `now - upload date`), so the fixtures hang off the real clock too: a fixed date made the text
// report test go red two days after it was written (3d became 5d).
const NOW = Math.floor(Date.now() / 1000)
const day = 86400
const entry = (id, handle, views, ageDays, title = 'a video', extra = {}) => ({ id, url: `https://www.tiktok.com/@${handle}/video/${id}`, title, view_count: views, like_count: Math.round(views * 0.05), duration: 180, timestamp: NOW - ageDays * day, ...extra })

const fixture = {
  profiles: {
    alpha: [entry('1', 'alpha', 1000, 5), entry('2', 'alpha', 1200, 9), entry('3', 'alpha', 900, 12), entry('4', 'alpha', 1100, 15), entry('5', 'alpha', 5000, 3, 'The 5 levels of automation'), entry('6', 'alpha', 800, 200, 'too old')],
    beta: [entry('11', 'beta', 20000, 4), entry('12', 'beta', 21000, 8), entry('13', 'beta', 19000, 11), entry('14', 'beta', 22000, 14), entry('15', 'beta', 40000, 6, 'AI agents and automation, the workflow')],
    tiny: [entry('21', 'tiny', 999999, 2), entry('22', 'tiny', 10, 3)],
    broken: [],
  },
  videos: {
    5: { ...entry('5', 'alpha', 5000, 3, 'The 5 levels of automation'), description: 'The 5 levels of automation #aiagents #automation #claude', repost_count: 250, comment_count: 12, track: 'original sound' },
    15: { ...entry('15', 'beta', 40000, 6), description: 'AI agents and automation, the workflow #aiagents #claude', repost_count: 900, comment_count: 80 },
    31: { ...entry('31', 'ours', 3000, 2), description: 'ours #aiagents', repost_count: 60, comment_count: 4 },
    32: { ...entry('32', 'ours', 1000, 2), description: 'ours', repost_count: 10, comment_count: 1 },
  },
  fail: ['broken'],
}
const fixtureFile = join(tmp, 'fixture.json')
writeFileSync(fixtureFile, JSON.stringify(fixture))
const stub = join(tmp, 'yt-dlp-stub.mjs')
writeFileSync(stub, `#!/usr/bin/env node
import { readFileSync } from 'node:fs'
const args = process.argv.slice(2)
const fx = JSON.parse(readFileSync(process.env.STUB_FIXTURE, 'utf8'))
if (args.includes('--version')) { console.log('2099.01.01'); process.exit(0) }
const m = args[args.length - 1].match(/@([^/]+)(?:\\/video\\/(\\d+))?/)
if (!m) { console.error('bad url'); process.exit(1) }
if (fx.fail.includes(m[1])) { console.error('ERROR: [TikTok] blocked'); process.exit(1) }
if (args.includes('--flat-playlist')) {
  console.log(JSON.stringify({ entries: (fx.profiles[m[1]] || []).slice(0, Number(args[args.indexOf('--playlist-end') + 1])) }))
} else if (fx.videos[m[2]]) console.log(JSON.stringify(fx.videos[m[2]]))
else { console.error('ERROR: no such video'); process.exit(1) }
`)
chmodSync(stub, 0o755)
const env = (home) => ({ ...process.env, DSH_HOME: home, TIKTOK_SCOUT_YTDLP: stub, STUB_FIXTURE: fixtureFile, TIKTOK_SCOUT_DELAY_MS: '0' })
const run = async (home, args) => {
  const lines = []
  const code = await S.main(args, env(home), (l) => lines.push(l))
  return { code, out: lines.join('\n') }
}
const home = (name) => join(tmp, name)
const dirOf = (h) => S.stateDir({ DSH_HOME: h })
const opts = (h, o = {}) => ({ dir: dirOf(h), bin: stub, days: 60, top: 10, perAccount: 20, detail: 4, save: true, delay: 0, nowSec: NOW, ...o })
process.env.STUB_FIXTURE = fixtureFile

await t('handles are normalised from every shape and refused when they are not handles', () => {
  assert.equal(S.normHandle('@Pro.Glitch'), 'pro.glitch')
  assert.equal(S.normHandle('https://www.tiktok.com/@rileybrown.ai/video/7675070405308075295'), 'rileybrown.ai')
  assert.equal(S.normHandle('plain_name'), 'plain_name')
  for (const bad of ['', 'a', 'has space', 'x'.repeat(25), '../etc', '..', '@']) assert.equal(S.normHandle(bad), null, JSON.stringify(bad))
})

await t('median, hashtags, relevance count whole words and distinct topics only', () => {
  assert.equal(S.median([3, 1, 2]), 2)
  assert.equal(S.median([1, 2, 3, 4]), 2.5)
  assert.equal(S.median([]), null)
  assert.deepEqual(S.hashtagsOf('x #AIagents #claude #aiagents. é #été'), ['#aiagents', '#claude', '#été'])
  assert.equal(S.relevanceOf('AI agents and automation', S.DEFAULT_TOPICS), 3) // ai agents, agents, automation
  assert.equal(S.relevanceOf('management of agentic things', ['agent']), 0)
  assert.equal(S.relevanceOf('', S.DEFAULT_TOPICS), 0)
})

await t('score = outlier capped at 10, plus 25 % per topic word up to 4; no baseline = neutral', () => {
  assert.deepEqual(S.scoreOf(5000, 1000, 0), { outlier: 5, score: 5 })
  assert.equal(S.scoreOf(5000, 1000, 2).score, 7.5)
  assert.equal(S.scoreOf(5000, 1000, 9).score, 10) // 5 * (1 + 1)
  assert.equal(S.scoreOf(900000, 1000, 0).score, 10) // capped
  assert.deepEqual(S.scoreOf(5000, null, 0), { outlier: null, score: 1 })
})

await t('scout: ranks what beat its own account, keeps the window, needs 4 videos for a baseline', async () => {
  const h = home('scout1')
  S.saveWatch(dirOf(h), { accounts: ['alpha', 'beta', 'tiny', 'broken'], topics: S.DEFAULT_TOPICS })
  const r = await S.runScout(opts(h, { detail: 2 }))
  const ids = r.top.map((v) => v.id)
  // alpha: 5000 views against a median of 1050 (the 6 videos read, the old one included) = x4.76, two topic words: 7.14
  // beta:  40000 against 21000 = x1.9, four topic words (the cap): 3.81
  assert.deepEqual(ids.slice(0, 2), ['5', '15'])
  assert.ok(!ids.includes('6'), 'the 200 days old video is out of the window')
  const v5 = r.top.find((v) => v.id === '5')
  assert.equal(v5.outlier, 4.76)
  assert.equal(v5.score, 7.14)
  assert.equal(r.top[1].score, 3.81)
  assert.equal(v5.shares, 250)
  assert.deepEqual(v5.hashtags, ['#aiagents', '#automation', '#claude'])
  assert.equal(r.accounts.find((a) => a.handle === 'tiny').baselineViews, null, 'two videos are not a baseline')
  assert.equal(r.top.find((v) => v.id === '21').outlier, null)
  assert.equal(r.errors.length, 1)
  assert.equal(r.errors[0].handle, 'broken')
  assert.equal(r.allFailed, false)
  assert.equal(r.patterns.medianDurationSec, 180)
  assert.ok(r.patterns.topHashtags.some((x) => x.tag === '#aiagents' && x.count === 2))
})

await t('scout: NEW is true once, then false; --no-save leaves no trace; reports are kept', async () => {
  const h = home('scout2')
  S.saveWatch(dirOf(h), { accounts: ['alpha'], topics: S.DEFAULT_TOPICS })
  const dry = await S.runScout(opts(h, { save: false, detail: 1 }))
  assert.ok(dry.top.every((v) => v.new))
  assert.equal(existsSync(join(dirOf(h), 'state.json')), false)
  const first = await S.runScout(opts(h))
  assert.ok(first.top.every((v) => v.new))
  const second = await S.runScout(opts(h))
  assert.ok(second.top.every((v) => !v.new))
  assert.equal(second.newCount, 0)
  assert.ok(readdirSync(join(dirOf(h), 'reports')).length >= 1)
})

await t('scout: when every account fails the run says so and the CLI exits 3', async () => {
  const h = home('scout3')
  S.saveWatch(dirOf(h), { accounts: ['broken'], topics: S.DEFAULT_TOPICS })
  const r = await run(h, ['scout'])
  assert.equal(r.code, 3)
  assert.match(r.out, /every account failed/)
  assert.match(r.out, /captcha/)
})

await t('scout: the text report shows rank, NEW, ratio, length and the link', async () => {
  const h = home('scout4')
  S.saveWatch(dirOf(h), { accounts: ['alpha'], topics: S.DEFAULT_TOPICS })
  const r = await run(h, ['scout', '--top', '3'])
  assert.equal(r.code, 0)
  assert.match(r.out, /1\. NEW @alpha · 5k · x4\.76 · 5% · 5% · 3:00 · 3d · The 5 levels of automation/)
  assert.match(r.out, /https:\/\/www\.tiktok\.com\/@alpha\/video\/5/)
  assert.match(r.out, /Patterns of these 3/)
})

await t('watch and topics: add, dedupe, refuse bad input, remove; first run is seeded with the two examples', async () => {
  const h = home('watch')
  assert.deepEqual(S.loadWatch(dirOf(h)).accounts, ['pro.glitch', 'rileybrown.ai'])
  assert.equal((await run(h, ['watch', 'add', '@New.Person', 'https://www.tiktok.com/@alpha/video/5', 'alpha'])).code, 0)
  assert.deepEqual(S.loadWatch(dirOf(h)).accounts, ['pro.glitch', 'rileybrown.ai', 'new.person', 'alpha'])
  assert.equal((await run(h, ['watch', 'add', 'bad handle!'])).code, 1)
  assert.equal((await run(h, ['watch', 'remove', 'alpha'])).code, 0)
  assert.ok(!S.loadWatch(dirOf(h)).accounts.includes('alpha'))
  assert.equal((await run(h, ['topics', 'add', 'Vibe Coding'])).code, 0)
  assert.ok(S.loadWatch(dirOf(h)).topics.includes('vibe coding'))
})

await t('prefs: defaults to Kaby in the split layout; refuses unknown values; a hand-set narrator is « chosen »', async () => {
  const h = home('prefs')
  assert.deepEqual(S.loadPrefs(dirOf(h)), { narrator: 'kaby', layout: 'split', ab: true, chosen: false })
  assert.equal((await run(h, ['prefs', 'set', 'narrator=robot'])).code, 1)
  assert.equal((await run(h, ['prefs', 'set', 'narrator=human', 'ab=off'])).code, 0)
  assert.deepEqual(S.loadPrefs(dirOf(h)), { narrator: 'human', layout: 'split', ab: false, chosen: true })
})

await t('ab: alternates the arms, refuses bad URLs and doubles, keeps hand-typed fractions only', async () => {
  const h = home('ab')
  const d = dirOf(h)
  assert.equal(S.abNext(d).narrator, 'kaby')
  assert.equal((await run(h, ['ab', 'add', 'https://example.com/x'])).code, 1)
  assert.equal((await run(h, ['ab', 'add', 'https://www.tiktok.com/@ours/video/31', '--narrator', 'kaby', '--style', 'playbook'])).code, 0)
  assert.equal((await run(h, ['ab', 'add', 'https://www.tiktok.com/@ours/video/31'])).code, 1)
  assert.equal(S.abNext(d).narrator, 'human')
  assert.equal((await run(h, ['ab', 'add', 'https://www.tiktok.com/@ours/video/32', '--narrator', 'human'])).code, 0)
  assert.equal(S.abNext(d).narrator, 'kaby')
  assert.equal((await run(h, ['ab', 'set', '31', 'completion=42'])).code, 1)
  assert.equal((await run(h, ['ab', 'set', '31', 'completion=0.42', 'hold3s=0.7'])).code, 0)
  assert.equal((await run(h, ['ab', 'set', '99', 'completion=0.1'])).code, 1)
  const r = await S.abReport(d, stub, NOW)
  assert.equal(r.arms.kaby.videos, 1)
  assert.equal(r.arms.kaby.medianViews, 3000)
  assert.equal(r.arms.kaby.medianCompletion, 0.42)
  assert.equal(r.arms.human.medianCompletion, null)
  assert.equal(r.enough, false)
  assert.match(S.renderAb(r), /too early to conclude/)
  S.setPrefs(d, ['ab=off', 'narrator=human'])
  assert.match(S.abNext(d).reason, /off/)
})

await t('lengths print as m:ss and never as 2:60', () => {
  assert.equal(S.fmtLen(119.6), '2:00')
  assert.equal(S.fmtLen(223), '3:43')
  assert.equal(S.fmtLen(null), '?')
})

await t('check: counts only the spoken quotes, per scenario, against the Length line', () => {
  const words = (n) => Array.from({ length: n }, (_, i) => 'word' + i).join(' ')
  const md = ['# Idea', '## A · Playbook', 'Length: 60 s', '### 0:00', '> ' + words(100), '- Screen: lots of words that are not spoken', '> **' + words(56) + '**', '## B · Screen proof', 'Length: 30 s', '> ' + words(50), '## C', '> — ' + words(10)].join('\n')
  const rows = S.checkScenarios(md)
  assert.equal(rows.length, 3)
  assert.deepEqual([rows[0].words, rows[0].budgetWords, rows[0].verdict], [156, 156, 'ok'])
  assert.equal(rows[1].verdict, '28 words short') // 50 spoken words, 30 s x 2.6 = 78 words of budget
  assert.equal(rows[2].verdict, 'no target length')
  assert.equal(S.checkScenarios('nothing here').length, 0)
})

await t('doctor: ok with a binary, exit 2 and an install hint without one', async () => {
  const h = home('doc')
  const ok = await run(h, ['doctor'])
  assert.equal(ok.code, 0)
  assert.match(ok.out, /yt-dlp 2099\.01\.01 ok/)
  const bad = spawnSync(process.execPath, [fileURLToPath(new URL('./scout.mjs', import.meta.url)), 'doctor'], { env: { ...env(h), TIKTOK_SCOUT_YTDLP: join(tmp, 'nope') }, encoding: 'utf8' })
  assert.equal(bad.status, 2)
  assert.match(bad.stdout, /brew install yt-dlp/)
})

await t('the command line works as a program, not only as a module', () => {
  const out = execFileSync(process.execPath, [fileURLToPath(new URL('./scout.mjs', import.meta.url)), 'prefs'], { env: env(home('cli')), encoding: 'utf8' })
  assert.equal(JSON.parse(out).narrator, 'kaby')
})

rmSync(tmp, { recursive: true, force: true })
console.log(process.exitCode ? 'FAILED' : `ok: ${passed} tests`)
