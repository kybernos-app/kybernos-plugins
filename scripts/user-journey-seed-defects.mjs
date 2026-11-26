#!/usr/bin/env node
// Case of docs/tests/user-journey/vision-protocol.md §1: ten KNOWN defects are planted in pictures of a SANDBOX (never the owner's DSH, never a file of the repository) so that the recall of a picture reader is known before its « nothing wrong » is trusted.
// The defect is added to the page in the throw-away browser (a style or a text change in the DOM) just before the picture is taken: nothing is written to the served client.
//
//   source scripts/sandbox/env.sh && node scripts/user-journey-seed-defects.mjs --out <folder outside the repository> [--clean 8]
//
// Writes <out>/pictures/p-NN.png (the planted ones and the clean ones, mixed, in a shuffled order under neutral names), <out>/batch.json (the list of pictures to give the reader, with the page and the width but NO hint of the defect)
// and <out>/key.json (the answer key: keep it away from the reader). Score a reader's report with `--score <report.json> --out <same folder>`: a report is `{ "findings": [ { "picture": "p-03.png", "what": "..." } ] }`.
// Two defects (`measure: true`: the hit target, the sideways scroll) are decided by the walker's measures, not by a picture; they are scored on their own line.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { clickText, goToSettingsPage, openLivePage, openSettings } from './live-page.mjs'
import { LOOK_SCRIPT } from './takeoff-walk.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** The ten planted defects. `where` opens the page; `plant` is the page-side script that creates the defect and returns true when it found something to change. */
export const DEFECTS = [
  { id: 'D01', what: 'a headline clipped by its card', where: { page: 'new-chat' }, width: 1440, plant: `(() => { const leaves = Array.from(document.querySelectorAll('body *')).filter((e) => e.children.length === 0 && (e.innerText || '').trim().length > 3 && e.getBoundingClientRect().width > 100 && e.getBoundingClientRect().left > 200); leaves.sort((a, b) => parseFloat(getComputedStyle(b).fontSize) - parseFloat(getComputedStyle(a).fontSize)); const h = leaves[0]; if (!h) return false; const p = h.parentElement; p.style.overflow = 'hidden'; p.style.height = '10px'; return true })()` },
  { id: 'D02', what: 'two tabs overlapping by 12 px', where: { page: 'sidebar', label: 'Connectors' }, width: 1440, plant: `(() => { const bs = Array.from(document.querySelectorAll('button')).filter((b) => { const r = b.getBoundingClientRect(); return r.width > 30 && r.height > 20 && r.left > 280 && r.top > 80 }); for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) { const p = bs[i].getBoundingClientRect(); const q = bs[j].getBoundingClientRect(); if (Math.abs(p.top - q.top) < 6 && q.left > p.right - 1 && q.left - p.right < 40) { bs[j].style.position = 'relative'; bs[j].style.left = String(-(q.left - p.right) - 12) + 'px'; bs[j].style.zIndex = '2'; return true } } return false })()` },
  { id: 'D03', what: 'grey text on white at a contrast of about 2.1', where: { page: 'sidebar', label: 'Skills' }, width: 1440, plant: `(() => { const main = document.querySelector('main') || document.body; const ps = Array.from(main.querySelectorAll('p, span, div')).filter((e) => e.children.length === 0 && (e.innerText || '').trim().length > 20); if (!ps.length) return false; for (const e of ps.slice(0, 6)) { e.style.color = '#b2b2b2'; e.style.backgroundColor = '#ffffff' } return true })()` },
  { id: 'D04', what: 'a French string in the English interface', where: { page: 'sidebar', label: 'Creations' }, width: 1440, plant: `(() => { const h = Array.from(document.querySelectorAll('h1, h2, h3, button')).find((e) => (e.innerText || '').trim().length > 3 && e.children.length === 0); if (!h) return false; h.textContent = 'Mes créations récentes'; return true })()` },
  { id: 'D05', what: 'the text « undefined » in a gauge label', where: { page: 'settings', label: 'Usage' }, width: 1440, plant: `(() => { const e = Array.from(document.querySelectorAll('span, div, p')).find((x) => x.children.length === 0 && /\\d/.test(x.textContent || '') && (x.textContent || '').length < 30); if (!e) return false; e.textContent = 'undefined / 5 h'; return true })()` },
  { id: 'D06', what: 'a hit target 20 px high', measure: true, where: { page: 'new-chat' }, width: 1440, plant: `(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => { const r = x.getBoundingClientRect(); return r.width > 40 && r.height > 28 }); if (!b) return false; b.style.height = '20px'; b.style.minHeight = '20px'; b.style.padding = '0 8px'; return true })()` },
  { id: 'D07', what: 'a figure cut after its second character', where: { page: 'settings', label: 'Usage' }, width: 1440, plant: `(() => { const es = Array.from(document.querySelectorAll('span, div, p, strong, b')).filter((x) => { const r = x.getBoundingClientRect(); return x.children.length === 0 && r.left > 280 && r.top > 100 && r.width > 10 && /\\d\\d|\\d\\s?%/.test(x.textContent || '') && (x.textContent || '').length < 30 }); const e = es[0]; if (!e) return false; e.style.display = 'inline-block'; e.style.maxWidth = '1.6ch'; e.style.overflow = 'hidden'; e.style.whiteSpace = 'nowrap'; e.style.verticalAlign = 'bottom'; return true })()` },
  { id: 'D08', what: 'a title running over the paragraph under it', where: { page: 'sidebar', label: 'Connectors' }, width: 1440, plant: `(() => { const h = Array.from(document.querySelectorAll('h1, h2')).find((e) => e.getBoundingClientRect().height > 16 && e.getBoundingClientRect().left > 280); if (!h) return false; h.style.position = 'relative'; h.style.top = '58px'; h.style.zIndex = '3'; return true })()` },
  { id: 'D09', what: 'a list that is empty with nothing to say about it', where: { page: 'sidebar', label: 'Automations' }, width: 1440, plant: `(() => { const main = document.querySelector('main') || document.body; const list = Array.from(main.querySelectorAll('ul, [role=list], [class*=list], [class*=grid]')).sort((a, b) => b.children.length - a.children.length)[0]; if (!list || list.children.length === 0) return false; list.innerHTML = ''; list.style.minHeight = '220px'; return true })()` },
  { id: 'D10', what: 'a sideways scroll bar at 390 px', measure: true, where: { page: 'new-chat' }, width: 390, plant: `(() => { const d = document.createElement('div'); d.style.cssText = 'width:470px;height:6px;background:#888;margin-top:4px'; (document.querySelector('main') || document.body).appendChild(d); document.documentElement.style.overflowX = 'scroll'; document.body.style.minWidth = '470px'; return true })()` }
]

/** The clean pictures: the same pages, nothing planted. */
export const CLEAN = [
  { where: { page: 'new-chat' }, width: 1440 }, { where: { page: 'sidebar', label: 'Skills' }, width: 1440 }, { where: { page: 'sidebar', label: 'Creations' }, width: 1440 },
  { where: { page: 'settings', label: 'Usage' }, width: 1440 }, { where: { page: 'settings', label: 'Kybernos' }, width: 1440 }, { where: { page: 'sidebar', label: 'Automations' }, width: 1440 },
  { where: { page: 'new-chat' }, width: 390 }, { where: { page: 'settings', label: 'General' }, width: 1440 }
]

/** A deterministic shuffle (a linear congruential generator seeded by `seed`), so a batch can be rebuilt. Pure. */
export function shuffled (list, seed = 20261104) {
  const out = list.slice()
  let s = seed >>> 0
  for (let i = out.length - 1; i > 0; i--) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; const j = s % (i + 1); [out[i], out[j]] = [out[j], out[i]] }
  return out
}

/** What the walker's `look` measures that GREW between two looks of the same page (before and after the defect), as names. Pure. */
export function grew (before, after) {
  const b = before || {}
  const a = after || {}
  const out = ['overlaps', 'clippedText', 'badText', 'pastRightEdge', 'small'].filter((k) => (a[k] || []).length > (b[k] || []).length)
  if (a.scrollsSideways === true && b.scrollsSideways !== true) out.push('scrollsSideways')
  return out
}

/** Recall of a reader's findings against the key. `findings` are `{ picture, what }`. Pure. */
export function score (key, findings) {
  const said = new Set((findings || []).map((f) => String(f.picture || '').split('/').pop()))
  const planted = key.filter((k) => k.defect !== null)
  const clean = key.filter((k) => k.defect === null)
  const found = (rows) => rows.filter((k) => said.has(k.picture))
  return {
    picture: { total: planted.filter((k) => !k.measure).length, found: found(planted.filter((k) => !k.measure)).length },
    measure: { total: planted.filter((k) => k.measure).length, found: found(planted.filter((k) => k.measure)).length },
    script: { total: planted.length, found: planted.filter((k) => (k.caught || []).length > 0).length, missed: planted.filter((k) => (k.caught || []).length === 0).map((k) => `${k.defect} ${k.what}`) },
    cleanFlagged: found(clean).length,
    cleanTotal: clean.length,
    missed: planted.filter((k) => !said.has(k.picture)).map((k) => `${k.defect} ${k.what}`)
  }
}

async function openWhere (page, host, where, width) {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height: width < 600 ? 844 : 900, deviceScaleFactor: 1, mobile: width < 600 })
  await page.send('Page.navigate', { url: 'http://' + host + '/' })
  await sleep(2800)
  if (where.page === 'sidebar') { if (!(await clickText(page, where.label))) { await sleep(2500); if (!(await clickText(page, where.label))) return false } await sleep(1800) }
  if (where.page === 'settings') { if (!(await openSettings(page))) return false; if (!(await goToSettingsPage(page, where.label))) return false; await sleep(900) }
  return true
}

async function main () {
  const argv = process.argv.slice(2)
  const opt = (n, d = '') => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d }
  const refuse = (m) => { console.error('user-journey-seed-defects: ' + m); process.exit(2) }
  const out = opt('--out')
  if (!out) refuse('--out <folder outside the repository> is required')
  const outDir = resolve(out)
  const inside = relative(REPO, outDir)
  if (inside === '' || (!inside.startsWith('..') && !inside.startsWith('/'))) refuse('the output folder is inside the repository: pictures never go to git')
  if (argv.includes('--score')) {
    const key = JSON.parse(readFileSync(join(outDir, 'key.json'), 'utf8'))
    const report = JSON.parse(readFileSync(resolve(opt('--score')), 'utf8'))
    const r = score(key, report.findings)
    console.log(JSON.stringify(r, null, 2))
    process.exit(r.picture.found >= 7 && r.cleanFlagged <= 2 ? 0 : 1)
  }
  const host = process.env.KB_HOST || ''
  if (!host) refuse('KB_HOST is not set: run « source scripts/sandbox/env.sh » first')
  if (/:3080$/.test(host) || /:879[12]$/.test(host)) refuse('KB_HOST is the owner\'s own DSH or replica: this tool is for sandboxes only')
  mkdirSync(join(outDir, 'pictures'), { recursive: true })
  const jobs = shuffled([...DEFECTS.map((d) => ({ ...d, defect: d.id })), ...CLEAN.slice(0, Number(opt('--clean', '8'))).map((c) => ({ ...c, defect: null, what: 'nothing planted' }))])
  const key = []
  const batch = []
  const live = await openLivePage({ authority: host, width: 1440, height: 900 })
  try {
    let n = 0
    for (const job of jobs) {
      n += 1
      const name = `p-${String(n).padStart(2, '0')}.png`
      const ok = await openWhere(live.page, host, job.where, job.width)
      let planted = job.defect === null
      const before = ok && job.defect !== null ? (await live.page.evalJs(LOOK_SCRIPT, 10000)).val : null
      if (ok && job.defect !== null) planted = (await live.page.evalJs(job.plant, 8000)).val === true
      const caught = ok && planted && job.defect !== null ? grew(before, (await live.page.evalJs(LOOK_SCRIPT, 10000)).val) : []
      await sleep(400)
      const shot = ok && planted ? await live.page.shot(join(outDir, 'pictures', name)) : false
      key.push({ picture: name, defect: job.defect, what: job.what, measure: job.measure === true, taken: shot === true, caught })
      if (shot === true) batch.push({ picture: name, width: job.width, page: job.where.label || job.where.page })
      console.log(`${name} ${job.defect || 'clean'} ${caught.length ? '[script saw: ' + caught.join(', ') + '] ' : ''}${shot === true ? 'taken' : 'NOT TAKEN (' + (ok ? 'nothing to change on the page' : 'page did not open') + ')'}`)
    }
  } finally { await live.close() }
  writeFileSync(join(outDir, 'key.json'), JSON.stringify(key, null, 2) + '\n')
  writeFileSync(join(outDir, 'batch.json'), JSON.stringify(batch, null, 2) + '\n')
  const missing = key.filter((k) => k.defect !== null && !k.taken)
  console.log(`${batch.length} pictures in the batch, ${missing.length} planted defect(s) not placed: ${missing.map((k) => k.defect).join(', ') || 'none'}`)
  process.exit(missing.length === 0 ? 0 : 1)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main().catch((e) => { console.error(String(e.message || e)); process.exit(1) })
