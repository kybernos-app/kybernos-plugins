#!/usr/bin/env node
// tiktok-scout: the numbers behind the skill. Reads the PUBLIC metadata of TikTok videos through yt-dlp (no download, no
// sign-in, no captcha to solve) for a watchlist of accounts, ranks what over-performed, and keeps the small state the skill
// needs between two runs: the watchlist, what was already seen, the narrator choice and the A/B log.
//
//   node scout.mjs doctor [--live]
//   node scout.mjs watch   list | add <@handle|url>... | remove <@handle>...
//   node scout.mjs topics  list | add <word>... | remove <word>...
//   node scout.mjs scout   [--days 60] [--top 10] [--per-account 20] [--detail 8] [--only @handle] [--json] [--no-save]
//   node scout.mjs prefs   [get | set key=value ...]          keys: narrator, layout, ab
//   node scout.mjs check   <scenarios.md> [--wps 2.6]         spoken words per scenario against its `Length: N s` line (exit 4 if off)
//   node scout.mjs ab      add <video url> [--narrator kaby|human] [--style name] | set <id> key=value | report | next
//
// State lives in <DSH_HOME, else ~/.dsh>/kybernos/tiktok-scout/. The yt-dlp binary is $TIKTOK_SCOUT_YTDLP, else `yt-dlp`.
// Exit codes: 0 done, 1 usage error, 2 yt-dlp missing, 3 every account failed, 4 a scenario is off its length.
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_ACCOUNTS = ['pro.glitch', 'rileybrown.ai']
export const DEFAULT_TOPICS = ['ai agent', 'ai agents', 'agents', 'automation', 'automate', 'ai employee', 'claude', 'workflow', 'second brain', 'assistant', 'n8n', 'mcp', 'ai team', 'open source']
export const NARRATORS = ['kaby', 'human', 'avatar', 'voice-screen']
export const AB_ARMS = ['kaby', 'human']
export const LAYOUTS = ['split', 'full']
const MIN_PER_ARM = 6
const KEEP_REPORTS = 30

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const firstLine = (e) => String((e && (e.stderr || e.message)) || e).trim().split('\n').filter(Boolean).pop() || 'unknown error'

export const median = (a) => {
  const s = a.filter(Number.isFinite).sort((x, y) => x - y)
  if (!s.length) return null
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** `@Name`, `name` or any tiktok.com URL of that account -> the lowercase handle, or null when it is not a handle. */
export function normHandle(raw) {
  const s = String(raw || '').trim().replace(/^https?:\/\/(www\.)?tiktok\.com\//i, '').replace(/^@/, '').split(/[/?#]/)[0].toLowerCase()
  return /^[a-z0-9._]{2,24}$/.test(s) && /[a-z0-9]/.test(s) ? s : null
}

export const hashtagsOf = (text) => [...new Set((String(text || '').match(/#[\p{L}\p{N}_]+/gu) || []).map((t) => t.toLowerCase()))]

/** How many DIFFERENT topic words the text contains (whole words only: "agent" is not inside "management"). */
export function relevanceOf(text, topics) {
  const t = String(text || '')
  return topics.filter((k) => new RegExp('(^|[^\\p{L}\\p{N}])' + esc(k) + '(?=$|[^\\p{L}\\p{N}])', 'iu').test(t)).length
}

/**
 * outlier = views / the account's median views: a video that beat its OWN account's habit, whatever the audience size.
 * score   = outlier (capped at 10) x (1 + 0.25 per topic word, up to 4).
 */
export function scoreOf(views, baseline, hits) {
  const outlier = baseline > 0 && Number.isFinite(views) ? views / baseline : null
  return { outlier: outlier === null ? null : round(outlier, 2), score: round(Math.min(outlier ?? 1, 10) * (1 + 0.25 * Math.min(hits, 4)), 2) }
}

export function patternsOf(top) {
  const tags = new Map()
  for (const v of top) for (const t of v.hashtags || []) tags.set(t, (tags.get(t) || 0) + 1)
  return {
    sample: top.length,
    medianDurationSec: median(top.map((v) => v.duration)),
    numberedTitleShare: top.length ? round(top.filter((v) => /\b\d+\b/.test(String(v.title || '').slice(0, 60))).length / top.length, 2) : null,
    topHashtags: [...tags].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8).map(([tag, count]) => ({ tag, count })),
  }
}

// ---------- state ----------
export const stateDir = (env = process.env) => join(env.DSH_HOME || join(homedir(), '.dsh'), 'kybernos', 'tiktok-scout')
const readJson = (file, fallback) => { try { const v = JSON.parse(readFileSync(file, 'utf8')); return plain(v) ? v : fallback } catch (e) { return fallback } }
function writeJson(file, data) {
  mkdirSync(join(file, '..'), { recursive: true })
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(data, null, 2))
  renameSync(tmp, file)
}
export function loadWatch(dir) {
  const w = readJson(join(dir, 'watchlist.json'), {})
  return {
    accounts: Array.isArray(w.accounts) ? w.accounts.map(normHandle).filter(Boolean) : DEFAULT_ACCOUNTS.slice(),
    topics: Array.isArray(w.topics) && w.topics.length ? w.topics.map((t) => String(t).toLowerCase().trim()).filter(Boolean) : DEFAULT_TOPICS.slice(),
  }
}
export const saveWatch = (dir, w) => writeJson(join(dir, 'watchlist.json'), w)

export function loadPrefs(dir) {
  const p = readJson(join(dir, 'prefs.json'), {})
  return {
    narrator: NARRATORS.includes(p.narrator) ? p.narrator : 'kaby',
    layout: LAYOUTS.includes(p.layout) ? p.layout : 'split',
    ab: p.ab === false ? false : true,
    chosen: Boolean(p.chosen),
  }
}
/** Validates `key=value` pairs; returns { prefs } or { error }. A narrator set by hand counts as « chosen by the person ». */
export function setPrefs(dir, pairs) {
  const cur = loadPrefs(dir)
  for (const pair of pairs) {
    const [k, v] = String(pair).split('=')
    if (k === 'narrator' && NARRATORS.includes(v)) { cur.narrator = v; cur.chosen = true }
    else if (k === 'layout' && LAYOUTS.includes(v)) cur.layout = v
    else if (k === 'ab' && ['on', 'off', 'true', 'false'].includes(v)) cur.ab = v === 'on' || v === 'true'
    else return { error: `cannot set "${pair}": narrator=${NARRATORS.join('|')} layout=${LAYOUTS.join('|')} ab=on|off` }
  }
  writeJson(join(dir, 'prefs.json'), cur)
  return { prefs: cur }
}

// ---------- yt-dlp ----------
const binOf = (env = process.env) => env.TIKTOK_SCOUT_YTDLP || 'yt-dlp'
function ytdlp(args, bin) {
  return new Promise((resolve, reject) => {
    execFile(bin, ['--no-warnings', '--socket-timeout', '20', ...args], { timeout: 90000, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) { err.stderr = err.stderr || stderr; return reject(err) }
      try { resolve(JSON.parse(stdout.slice(stdout.indexOf('{')))) } catch (e) { reject(new Error('yt-dlp answered something that is not JSON')) }
    })
  })
}
const toVideo = (e, handle, nowSec) => {
  const ts = Number.isFinite(e.timestamp) ? e.timestamp : null
  return {
    id: String(e.id),
    handle,
    url: e.webpage_url || e.url || `https://www.tiktok.com/@${handle}/video/${e.id}`,
    title: String(e.title || '').trim(),
    views: Number.isFinite(e.view_count) ? e.view_count : null,
    likes: Number.isFinite(e.like_count) ? e.like_count : null,
    comments: Number.isFinite(e.comment_count) ? e.comment_count : null,
    shares: Number.isFinite(e.repost_count) ? e.repost_count : null,
    duration: Number.isFinite(e.duration) ? e.duration : null,
    ageDays: ts === null ? null : round(Math.max(0, nowSec - ts) / 86400, 1),
    description: typeof e.description === 'string' ? e.description : '',
    music: e.track || null,
    cover: e.thumbnail || null,
  }
}
export async function fetchProfile(handle, n, bin, nowSec) {
  const j = await ytdlp(['--flat-playlist', '--playlist-end', String(n), '-J', `https://www.tiktok.com/@${handle}`], bin)
  return (j.entries || []).filter((e) => e && e.id).map((e) => toVideo(e, handle, nowSec))
}
export async function fetchVideo(handle, id, bin, nowSec) {
  return toVideo(await ytdlp(['--no-download', '-J', `https://www.tiktok.com/@${handle}/video/${id}`], bin), handle, nowSec)
}
async function mapLimit(items, n, fn) {
  const out = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k) } }))
  return out
}

// ---------- scout ----------
export async function runScout(o) {
  const dir = o.dir
  const nowSec = o.nowSec ?? Math.floor(Date.now() / 1000)
  const watch = loadWatch(dir)
  const handles = o.only ? [normHandle(o.only)].filter(Boolean) : watch.accounts
  const errors = []
  const accounts = []
  const read = await mapLimit(handles, 2, async (h, i) => {
    if (i && o.delay) await sleep(o.delay)
    try { return await fetchProfile(h, o.perAccount, o.bin, nowSec) } catch (e) { errors.push({ handle: h, error: firstLine(e) }); return [] }
  })
  const all = []
  handles.forEach((h, i) => {
    const baseline = read[i].length >= 4 ? median(read[i].map((v) => v.views)) : null
    accounts.push({ handle: h, videos: read[i].length, baselineViews: baseline })
    for (const v of read[i]) all.push({ ...v, baseline })
  })
  const rank = (v) => {
    const hits = relevanceOf(v.title + ' ' + v.description, watch.topics)
    return { ...v, hits, ...scoreOf(v.views, v.baseline, hits) }
  }
  const state = readJson(join(dir, 'state.json'), {})
  const seen = plain(state.seen) ? state.seen : {}
  let cands = all.filter((v) => v.ageDays === null || v.ageDays <= o.days).map(rank)
  cands.sort((a, b) => b.score - a.score)

  // the second look (full caption, shares, hashtags) only for the front-runners: one request each
  const detailed = new Map()
  await mapLimit(cands.slice(0, o.detail), 2, async (v, i) => {
    if (i && o.delay) await sleep(o.delay)
    try { detailed.set(v.id, await fetchVideo(v.handle, v.id, o.bin, nowSec)) } catch (e) { errors.push({ handle: v.handle, video: v.id, error: firstLine(e) }) }
  })
  cands = cands.map((v) => {
    const d = detailed.get(v.id)
    return d ? rank({ ...v, ...d, title: d.title || v.title, baseline: v.baseline, cover: d.cover || v.cover, hashtags: hashtagsOf(d.description) }) : v
  }).sort((a, b) => b.score - a.score)
  const top = cands.slice(0, o.top).map((v) => ({ ...v, new: !seen[v.id], likeRate: v.views && v.likes !== null ? round(v.likes / v.views, 3) : null, shareRate: v.views && v.shares !== null ? round(v.shares / v.views, 3) : null }))

  const report = {
    generatedAt: new Date(nowSec * 1000).toISOString(),
    days: o.days,
    accounts,
    videosRead: all.length,
    newCount: top.filter((v) => v.new).length,
    top,
    patterns: patternsOf(top),
    errors,
    allFailed: handles.length > 0 && read.every((r) => r.length === 0),
  }
  if (o.save) {
    for (const v of cands) if (!seen[v.id]) seen[v.id] = report.generatedAt
    writeJson(join(dir, 'state.json'), { seen, lastRun: report.generatedAt })
    const rdir = join(dir, 'reports')
    writeJson(join(rdir, report.generatedAt.replace(/[:.]/g, '-') + '.json'), report)
    for (const f of readdirSync(rdir).sort().slice(0, -KEEP_REPORTS)) rmSync(join(rdir, f), { force: true })
  }
  return report
}

const fmtN = (n) => (n === null ? '?' : n >= 1e6 ? round(n / 1e6) + 'M' : n >= 1e3 ? round(n / 1e3) + 'k' : String(n))
export const fmtLen = (s) => {
  if (s === null) return '?'
  const t = Math.round(s)
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}
const pct = (r) => (r === null ? '?' : round(r * 100) + '%')

export function renderScout(r) {
  const out = [`TikTok scout · ${r.generatedAt.slice(0, 10)} · window ${r.days} d · ${r.accounts.length} account${r.accounts.length === 1 ? '' : 's'} · ${r.videosRead} videos read · ${r.newCount} new in the top`]
  out.push('', 'rank · NEW · creator · views · x median of the account · likes/views · shares/views · length · age · caption')
  r.top.forEach((v, i) => {
    out.push(`${i + 1}. ${v.new ? 'NEW ' : '    '}@${v.handle} · ${fmtN(v.views)} · x${v.outlier ?? '?'} · ${pct(v.likeRate)} · ${pct(v.shareRate)} · ${fmtLen(v.duration)} · ${v.ageDays === null ? '?' : Math.floor(v.ageDays) + 'd'} · ${v.title.slice(0, 90)}`)
    out.push(`     ${v.url}${v.hashtags && v.hashtags.length ? '  ' + v.hashtags.slice(0, 6).join(' ') : ''}`)
  })
  const p = r.patterns
  out.push('', `Patterns of these ${p.sample}: median length ${fmtLen(p.medianDurationSec)} · a number in the title ${p.numberedTitleShare === null ? '?' : Math.round(p.numberedTitleShare * 100) + '%'} · hashtags ${p.topHashtags.map((t) => `${t.tag}(${t.count})`).join(' ') || 'none read'}`)
  for (const a of r.accounts) out.push(`@${a.handle}: ${a.videos} videos, median ${fmtN(a.baselineViews)} views`)
  for (const e of r.errors) out.push(`! @${e.handle}${e.video ? ' video ' + e.video : ''}: ${e.error}`)
  if (r.allFailed) out.push('! every account failed: TikTok may be blocking this IP, or yt-dlp is out of date (yt-dlp -U). Do not try to get around a captcha.')
  return out.join('\n')
}

// ---------- A/B ----------
const VIDEO_URL = /tiktok\.com\/@([A-Za-z0-9._]{2,24})\/video\/(\d+)/i
export function abAdd(dir, url, opts) {
  const m = VIDEO_URL.exec(String(url || ''))
  if (!m) return { error: 'not a TikTok video URL (https://www.tiktok.com/@name/video/123...)' }
  const narrator = opts.narrator || loadPrefs(dir).narrator
  if (!NARRATORS.includes(narrator)) return { error: `narrator must be one of ${NARRATORS.join(', ')}` }
  const ab = readJson(join(dir, 'ab.json'), { videos: [] })
  if (ab.videos.some((v) => v.id === m[2])) return { error: 'this video is already logged' }
  const video = { id: m[2], handle: m[1].toLowerCase(), url: `https://www.tiktok.com/@${m[1]}/video/${m[2]}`, narrator, style: opts.style || '', addedAt: new Date().toISOString(), manual: {} }
  ab.videos.push(video)
  writeJson(join(dir, 'ab.json'), ab)
  return { video }
}
/** The numbers TikTok shows only to the creator (completion, 3-second hold) are typed in by hand, as fractions 0..1. */
export function abSet(dir, id, pairs) {
  const ab = readJson(join(dir, 'ab.json'), { videos: [] })
  const v = ab.videos.find((x) => x.id === id)
  if (!v) return { error: `no logged video ${id}` }
  for (const pair of pairs) {
    const [k, raw] = String(pair).split('=')
    const n = Number(raw)
    if (!['completion', 'hold3s'].includes(k) || !(n >= 0 && n <= 1) || raw === '') return { error: `cannot set "${pair}": completion=0..1 or hold3s=0..1 (a fraction, 42 % = 0.42)` }
    v.manual[k] = n
  }
  writeJson(join(dir, 'ab.json'), ab)
  return { video: v }
}
/** Which arm is due: the one with fewer videos so far, the first arm on a tie. With the test switched off: the chosen narrator. */
export function abNext(dir) {
  const prefs = loadPrefs(dir)
  if (!prefs.ab) return { narrator: prefs.narrator, reason: 'A/B test is off: the narrator you chose' }
  const ab = readJson(join(dir, 'ab.json'), { videos: [] })
  const n = Object.fromEntries(AB_ARMS.map((a) => [a, ab.videos.filter((v) => v.narrator === a).length]))
  const narrator = AB_ARMS.slice().sort((a, b) => n[a] - n[b])[0]
  return { narrator, reason: AB_ARMS.map((a) => `${a} ${n[a]}`).join(' · ') + ` · due: ${narrator}`, counts: n }
}
export async function abReport(dir, bin, nowSec) {
  const ab = readJson(join(dir, 'ab.json'), { videos: [] })
  const rows = await mapLimit(ab.videos, 2, async (v) => {
    try { return { ...v, live: await fetchVideo(v.handle, v.id, bin, nowSec) } } catch (e) { return { ...v, live: null, error: firstLine(e) } }
  })
  const arms = {}
  for (const a of AB_ARMS) {
    const mine = rows.filter((r) => r.narrator === a)
    const live = mine.map((r) => r.live).filter((l) => l && l.views)
    arms[a] = {
      videos: mine.length,
      medianViews: median(live.map((l) => l.views)),
      medianLikeRate: median(live.map((l) => (l.likes ?? NaN) / l.views)),
      medianShareRate: median(live.map((l) => (l.shares ?? NaN) / l.views)),
      medianCompletion: median(mine.map((r) => r.manual.completion)),
      medianHold3s: median(mine.map((r) => r.manual.hold3s)),
    }
  }
  const enough = AB_ARMS.every((a) => arms[a].videos >= MIN_PER_ARM)
  return { arms, rows, enough, note: enough ? 'Enough videos per arm to read a direction, not a proof: judge on completion and shares, not on views alone.' : `Fewer than ${MIN_PER_ARM} videos in an arm: too early to conclude, keep alternating.` }
}
export function renderAb(r) {
  const out = ['A/B narrator test (public numbers from yt-dlp; completion and hold3s are the ones typed in by hand)']
  for (const [a, s] of Object.entries(r.arms)) {
    out.push(`${a}: ${s.videos} videos · median views ${fmtN(s.medianViews)} · likes ${pct(s.medianLikeRate)} · shares ${pct(s.medianShareRate)} · completion ${pct(s.medianCompletion)} · 3 s hold ${pct(s.medianHold3s)}`)
  }
  for (const row of r.rows.filter((x) => x.error)) out.push(`! ${row.id}: ${row.error}`)
  out.push(r.note)
  return out.join('\n')
}

// ---------- word count ----------
const SPOKEN_WPS = 2.6
/**
 * A scenario file has one `## ` section per scenario, a line `Length: 90 s`, and the spoken lines as blockquotes (`> ...`).
 * Counting words by hand is where a script drifts, so this does it: words / 2.6 per second against the target.
 */
export function checkScenarios(text, wps = SPOKEN_WPS) {
  const sections = []
  let cur = null
  for (const line of String(text).split('\n')) {
    const h = /^##\s+(?!#)(.+)/.exec(line)
    if (h) { cur = { title: h[1].trim(), words: 0, targetSec: null }; sections.push(cur); continue }
    if (!cur) continue
    const len = /^\s*(?:\*\*)?Length:?(?:\*\*)?\s*(\d+)\s*s\b/i.exec(line)
    if (len) cur.targetSec = Number(len[1])
    const q = /^\s*>\s?(.*)$/.exec(line)
    if (q) cur.words += q[1].replace(/[*_`]/g, '').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length
  }
  return sections.filter((x) => x.words > 0 || x.targetSec !== null).map((x) => {
    const sec = round(x.words / wps)
    const budget = x.targetSec === null ? null : Math.round(x.targetSec * wps)
    let verdict = 'no target length'
    if (budget !== null) {
      const gap = x.words - budget
      verdict = Math.abs(gap) <= budget * 0.1 ? 'ok' : gap > 0 ? `${gap} words too long` : `${-gap} words short`
    }
    return { title: x.title, words: x.words, seconds: sec, targetSec: x.targetSec, budgetWords: budget, verdict }
  })
}
export const renderCheck = (rows) => (rows.length ? rows.map((r) => `${r.title}: ${r.words} words = ${r.seconds} s` + (r.targetSec === null ? ' (no "Length: N s" line)' : ` for ${r.targetSec} s (budget ${r.budgetWords} words): ${r.verdict}`)).join('\n') : 'no scenario found: one "## " heading per scenario, spoken lines as "> " quotes')

// ---------- command line ----------
function parseArgs(argv) {
  const pos = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const k = a.slice(2)
      if (['json', 'no-save', 'live'].includes(k)) flags[k] = true
      else flags[k] = argv[++i]
    } else pos.push(a)
  }
  return { pos, flags }
}
const intFlag = (v, d, min, max) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d }

export async function main(argv, env = process.env, log = console.log) {
  const { pos, flags } = parseArgs(argv)
  const [cmd, sub, ...rest] = pos
  const dir = stateDir(env)
  const bin = binOf(env)
  const say = (v) => log(flags.json ? JSON.stringify(v, null, 2) : typeof v === 'string' ? v : JSON.stringify(v))

  if (cmd === 'doctor') {
    const out = []
    const major = Number(process.versions.node.split('.')[0])
    out.push(`node ${process.versions.node} ${major >= 18 ? 'ok' : 'TOO OLD (18+ needed)'}`)
    let code = 0
    try {
      const v = await new Promise((res, rej) => execFile(bin, ['--version'], { timeout: 15000 }, (e, so) => (e ? rej(e) : res(so.trim()))))
      out.push(`yt-dlp ${v} ok`)
    } catch (e) {
      out.push(`yt-dlp NOT FOUND (${bin}): install it with "brew install yt-dlp" or "pip install yt-dlp", then run doctor again`)
      code = 2
    }
    try { mkdirSync(dir, { recursive: true }); out.push(`state ${dir} ok`) } catch (e) { out.push(`state ${dir} NOT WRITABLE`); code = code || 1 }
    if (flags.live && code === 0) {
      const h = loadWatch(dir).accounts[0]
      try { const v = await fetchProfile(h, 1, bin, Math.floor(Date.now() / 1000)); out.push(`live @${h}: ${v.length} video read ok`) } catch (e) { out.push(`live @${h}: ${firstLine(e)}`); code = 3 }
    }
    log(out.join('\n'))
    return code
  }

  if (cmd === 'watch' || cmd === 'topics') {
    const w = loadWatch(dir)
    const key = cmd === 'watch' ? 'accounts' : 'topics'
    const norm = cmd === 'watch' ? normHandle : (t) => String(t).toLowerCase().trim() || null
    if (!sub || sub === 'list') { say(w[key].join('\n')); return 0 }
    if (sub !== 'add' && sub !== 'remove') { log('usage: ' + cmd + ' list | add <...> | remove <...>'); return 1 }
    const items = rest.map(norm)
    if (!rest.length || items.includes(null)) { log('not valid: ' + rest.filter((_, i) => items[i] === null).join(', ')); return 1 }
    w[key] = sub === 'add' ? [...new Set([...w[key], ...items])] : w[key].filter((x) => !items.includes(x))
    saveWatch(dir, w)
    say(w[key].join('\n'))
    return 0
  }

  if (cmd === 'prefs') {
    if (sub === 'set') {
      const r = setPrefs(dir, rest)
      if (r.error) { log(r.error); return 1 }
      say(r.prefs)
      return 0
    }
    say(loadPrefs(dir))
    return 0
  }

  if (cmd === 'ab') {
    if (sub === 'add') {
      const r = abAdd(dir, rest[0], { narrator: flags.narrator, style: flags.style })
      if (r.error) { log(r.error); return 1 }
      say(r.video)
      return 0
    }
    if (sub === 'set') {
      const r = abSet(dir, rest[0], rest.slice(1))
      if (r.error) { log(r.error); return 1 }
      say(r.video)
      return 0
    }
    if (sub === 'next') { const r = abNext(dir); say(flags.json ? r : `${r.narrator}  (${r.reason})`); return 0 }
    if (sub === 'report') { const r = await abReport(dir, bin, Math.floor(Date.now() / 1000)); log(flags.json ? JSON.stringify(r, null, 2) : renderAb(r)); return 0 }
    log('usage: ab add <video url> [--narrator ..] [--style ..] | set <id> completion=0.4 | report | next')
    return 1
  }

  if (cmd === 'check') {
    if (!sub || !existsSync(sub)) { log('usage: check <scenarios.md> [--wps 2.6]'); return 1 }
    const rows = checkScenarios(readFileSync(sub, 'utf8'), Number(flags.wps) > 0 ? Number(flags.wps) : SPOKEN_WPS)
    log(flags.json ? JSON.stringify(rows, null, 2) : renderCheck(rows))
    return rows.some((r) => r.verdict !== 'ok') ? 4 : 0
  }

  if (cmd === 'scout') {
    const r = await runScout({
      dir, bin,
      days: intFlag(flags.days, 60, 1, 365),
      top: intFlag(flags.top, 10, 1, 30),
      perAccount: intFlag(flags['per-account'], 20, 4, 60),
      detail: intFlag(flags.detail, 8, 0, 20),
      only: flags.only,
      save: !flags['no-save'],
      delay: env.TIKTOK_SCOUT_DELAY_MS === undefined ? 600 : Number(env.TIKTOK_SCOUT_DELAY_MS),
    })
    log(flags.json ? JSON.stringify(r, null, 2) : renderScout(r))
    return r.allFailed ? 3 : 0
  }

  log('usage: node scout.mjs doctor | watch | topics | scout | prefs | ab | check   (see the header of this file)')
  return 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => { process.exitCode = c }, (e) => { console.error(firstLine(e)); process.exitCode = 1 })
}
