#!/usr/bin/env node
// The page detectors of the ux-bug-hunter skill (.claude/skills/ux-bug-hunter/probes.js) against two fixture pages:
// one that carries every defect the probes know, one clean page that must raise nothing.
//
//   node scripts/check-ux-probes.mjs
//
// It needs a headless Chrome and a signed-in session like every live check (docs/dev/live-testing.md), but it never looks at DSH:
// the fixtures are data: pages. Exit code 0 / 1 / 3 (inconclusive: Chrome or the GUI is not there). Named check-*, not test-*: CI has no Chrome.
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openLivePage, waitFor } from './live-page.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PROBES = readFileSync(join(REPO, '.claude', 'skills', 'ux-bug-hunter', 'probes.js'), 'utf8')

let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) console.log('  ✓ ' + name)
  else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 300))) }
}

const STYLE = `<meta charset="utf-8"><title>fixture</title><style>
  body{font:14px/1.4 system-ui;margin:20px;width:900px}
  ul{list-style:none;padding:0;margin:0 0 20px}
  li{display:flex;align-items:center;gap:8px;height:32px;padding:0 8px}
  .logo{width:20px;height:20px;border-radius:5px;background:#468;flex:none}
  .btn{padding:6px 12px;background:#c62;color:#fff;border:0;border-radius:6px}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px}
  .card{height:60px;border:1px solid #ccc;border-radius:8px;padding:8px}
  .box{border:1px dashed #aaa;padding:30px;text-align:center;margin-bottom:20px}
  .hit{position:relative;width:34px;height:20px;border:0;border-radius:99px;background:#888;padding:0}
  .hit::before{content:"";position:absolute;inset:-2px 0}
  .txt{background:none;border:0;padding:0;font:12px system-ui;text-decoration:underline;cursor:pointer}
</style>`
const LOGO = '<span class="logo"></span>'
const ICON = '<svg width="18" height="18"><path d="M0 0h10v10z"/></svg>'
const li = (items, pre) => '<ul>' + items.map((t) => '<li>' + (pre || '') + '<span>' + t + '</span></li>').join('') + '</ul>'
const NAMES = ['Atlas', 'Birch', 'Cedar', 'Delta', 'Ember', 'Fjord', 'Grove', 'Harbor', 'Island']
const cards = (n) => '<div class="grid">' + NAMES.slice(0, n).map((t) => '<div class="card">' + t + '</div>').join('') + '</div>'

const BAD = STYLE + '<main style="width:880px">'
  + '<h2 style="text-transform:uppercase;font-size:12px">Icon</h2><h3>WORKSPACE SETTINGS</h3>'
  + '<h3>Connect a model</h3><p>Connect a model to start</p>'
  + '<ul>' + ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((t) => '<li>' + LOGO + t + '</li>').join('') + '<li>Echo</li></ul>'
  + '<ul><li>Models</li><li>Skills</li><li style="padding-left:14px">Themes</li><li>Plugins</li></ul>'
  + li(['Open chat', 'Open files', 'Open goals', 'Open skills', 'Open notes'])
  + '<ul>' + ['a', 'b', 'c', 'd', 'e'].map((x) => '<li><span>' + x + '-notes.md</span><span>MD</span><small>MD · 5 KB</small><span style="margin-left:auto">Available</span></li>').join('') + '</ul>'
  + cards(9) + '<span>Page 1/5</span>'
  + '<div style="display:flex;gap:16px;align-items:center;width:880px"><p style="width:300px">Check the skills attached to this project, the selection saves by itself.</p><button class="btn" style="margin-left:200px">Browse the repository</button></div>'
  + '<div class="box">No budget declared by this project\'s agent teams (budget: block of kyber.yml).</div>'
  + '<button style="width:14px;height:14px;padding:0;font-size:8px">x</button> <button style="width:30px;height:30px"><svg width="12" height="12"></svg></button>'
  + '<div style="width:80px;overflow:hidden;white-space:nowrap">A very long unbroken label that gets cut</div>'
  + '<img src="data:image/png;base64,AAAA" width="20" height="20">'
  + li(['alpha', 'bravo', 'charlie', 'zulu', 'delta', 'echo', 'foxtrot'])
  + li(['Item 1', 'Item 2', 'Item 3', 'Item 4', 'Item 5'], ICON)
  + '</main>'

const CLEAN = STYLE + '<main style="width:880px">'
  + '<span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap">Running</span>'
  + '<h2>Workspaces</h2><p>Each project holds its own chats and goals.</p>'
  + '<ul>' + ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'].map((t, i) => '<li><span class="logo" style="background:hsl(' + i * 60 + ',45%,45%)"></span>' + t + '</li>').join('') + '</ul>'
  + cards(8) + '<span>Page 1/2</span>'
  + '<div style="text-align:right;width:880px"><button class="btn">Create</button></div>'
  + '<div style="display:flex;width:880px;padding-right:20px;box-sizing:border-box"><p style="width:300px;margin:0">Check the skills attached to this project.</p><button class="btn" style="margin-left:auto">Browse</button></div>'
  + '<div class="box"><svg width="48" height="48"><circle cx="24" cy="24" r="20"/></svg><p>No budget yet.</p><button class="btn">Add a budget</button></div>'
  + '<p><button class="hit" aria-label="Enable"></button> <button class="txt">Manage languages</button></p>'
  + '</main>'

const live = await openLivePage({ width: 1100, height: 900 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const val = async (js) => (await page.evalJs(js, 15000)).val
const load = async (html) => {
  await page.send('Page.navigate', { url: 'data:text/html;charset=utf-8,' + encodeURIComponent(html) })
  await waitFor(page, `document.title === 'fixture' && document.readyState === 'complete'`, 15000)
  await new Promise((r) => setTimeout(r, 400))
  await page.evalJs(PROBES, 15000)
}
try {
  await load(BAD)
  const bad = JSON.parse(await val('JSON.stringify(window.__UXH__.scan())'))
  if (process.argv.includes('--show')) for (const f of bad.findings) console.log('   ', f.level.padEnd(5), f.kind.padEnd(15), f.text.padEnd(26), f.detail)
  const WANT = ['caps', 'repeat-title', 'no-mark', 'misaligned', 'repeat-word', 'repeat-in-row', 'badge-constant', 'no-preview', 'orphan', 'stray-button',
    'empty-bare', 'jargon', 'tiny-target', 'no-name', 'clipped', 'broken-img', 'img-no-alt', 'order', 'same-icon']
  for (const k of WANT) check('the faulty page raises « ' + k + ' »', (bad.counts[k] || 0) > 0, bad.counts)
  check('the orphan card is reported with the pager (page size vs columns)', bad.findings.some((f) => f.kind === 'orphan' && f.detail.includes('not the last')), bad.findings.filter((f) => f.kind === 'orphan'))
  check('both ways of shouting are caught (css and literal)', bad.findings.filter((f) => f.kind === 'caps').map((f) => f.detail).sort().join('|') === 'text-transform: uppercase|written in capitals', bad.findings.filter((f) => f.kind === 'caps'))
  check('the logo-less row is the one named', bad.findings.some((f) => f.kind === 'no-mark' && f.text === 'Echo'), bad.findings.filter((f) => f.kind === 'no-mark'))
  check('every finding says where it is and what level it has', bad.findings.every((f) => ['bug', 'ux', 'check'].includes(f.level) && f.kind.length > 0), bad.findings.slice(0, 3))

  // The frame: the same page twice is stable, a resized landmark is reported, a scrollbar gutter that appears is reported.
  const f1 = await val('JSON.stringify(window.__UXH__.frame())')
  const f2 = await val('JSON.stringify(window.__UXH__.frame())')
  const same = await val(`JSON.stringify(window.__UXH__.diffFrames([{ label: 'a', frame: ${f1} }, { label: 'b', frame: ${f2} }]))`)
  check('two frames of the same page do not differ', same === '[]', same)
  await page.evalJs(`document.querySelector('main').style.width = '840px'`, 5000)
  const f3 = await val('JSON.stringify(window.__UXH__.frame())')
  const moved = JSON.parse(await val(`JSON.stringify(window.__UXH__.diffFrames([{ label: 'a', frame: ${f1} }, { label: 'b', frame: ${f3} }]))`))
  check('a resized main is reported with its old and new width', moved.some((d) => d.landmark === 'main' && /w 880 -> 840/.test(d.deltas)), moved)

  // frames: a landmark is compared with the first page that has it, so a page without a heading does not hide a title that moved.
  const A = { label: 'a', frame: { viewport: { w: 1, h: 1 }, scrollbar: 0, landmarks: { heading: null, main: { x: 0, y: 0, w: 100, h: 50 } } } }
  const B = { label: 'b', frame: { viewport: { w: 1, h: 1 }, scrollbar: 0, landmarks: { heading: { x: 272, y: 54, w: 90, h: 20 }, main: { x: 0, y: 0, w: 100, h: 50 } } } }
  const C = { label: 'c', frame: { viewport: { w: 1, h: 1 }, scrollbar: 0, landmarks: { heading: { x: 289, y: 107, w: 190, h: 20 }, main: { x: 0, y: 0, w: 100, h: 50 } } } }
  const shifted = JSON.parse(await val(`JSON.stringify(window.__UXH__.diffFrames([${JSON.stringify(A)}, ${JSON.stringify(B)}, ${JSON.stringify(C)}]))`))
  check('a title that sits elsewhere than on the first page with a title is reported (x and y, not its width)', shifted.length === 1 && shifted[0].landmark === 'heading' && shifted[0].deltas === 'x 272 -> 289, y 54 -> 107', shifted)

  await load(CLEAN)
  const clean = JSON.parse(await val('JSON.stringify(window.__UXH__.scan())'))
  check('the clean page raises nothing', clean.total === 0, clean.findings)
} finally {
  await live.close()
}
console.log(fail === 0 ? '\nOK' : '\n' + fail + ' check(s) failed')
process.exit(fail === 0 ? 0 : 1)
