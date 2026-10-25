#!/usr/bin/env node
// Our own controls can be hit on 24 px (UX audit 2026-10-20, WCAG 2.5.8): a switch, a colour dot, a radio, a chip's cross is reachable on a
// 24 px box, by an invisible ::before when the drawing is smaller. A bare text link keeps its line's height (the standard exempts it).
// Measured on the real GUI with the page probes (tiny-target), on the home page, the sidebar pages and every Settings page.
//
//   node scripts/check-hit-targets-live.mjs [--worktree]
//
// The engine's own controls (DSH class names with a hash: _switch_1ik0f_5, eGxaPq_mark...) are out of reach without patching it: they are
// listed, not failed. The reorder arrows of Web Search (a stacked pair 15 px wide, 17 px high each) are the one accepted exception of ours.
// --worktree: serve this checkout's clients in the throw-away browser (scripts/lib-bundle-swap.mjs). READ-ONLY. Exit code 0 / 1 / 3.
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openLivePage, openSettings, goToSettingsPage } from './live-page.mjs'
import { swapBundles } from './lib-bundle-swap.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PROBES = readFileSync(join(REPO, '.claude', 'skills', 'ux-bug-hunter', 'probes.js'), 'utf8')
const args = process.argv.slice(2)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) console.log('  ✓ ' + name)
  else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 700))) }
}
const BUNDLES = ['kybernos-models', 'kybernos-hub', 'kybernos-websearch', 'kybernos-auto', 'kybernos-plugin', 'kybernos-maintenance', 'kybernos-theme', 'kybernos-composio', 'kybernos-modeles-locaux', 'kybernos-skills', 'kybernos-mobile', 'kybernos-slash']
const ENGINE = /(?:^|\.)[A-Za-z0-9]{5,7}_[A-Za-z0-9]+|_[a-z0-9]{4,6}_\d|\.locked|\.on\b/   // a DSH class: hash + name
const ACCEPTED = /kwse-move/

const live = await openLivePage({ width: 1400, height: 900 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const ev = async (js) => (await page.evalJs(js, 20000)).val
const seen = []
const scan = async (view) => {
  await sleep(1500)
  await page.evalJs(PROBES, 20000)
  const rep = JSON.parse(await ev('JSON.stringify(window.__UXH__.scan())'))
  for (const f of rep.findings.filter((x) => x.kind === 'tiny-target')) seen.push({ view, where: f.where, text: f.text, detail: f.detail })
  return rep
}
try {
  if (args.includes('--worktree')) {
    const swap = await swapBundles(page, BUNDLES.map((name) => ({ name })))
    await page.send('Page.reload', { ignoreCache: true })
    await sleep(6000)
    if (swap.report().some((r) => r.replaced !== true)) console.log('○ a served client is not the checked-out one: running on what is deployed for it')
  }
  await sleep(2500)
  await scan('home')
  for (const t of ['Dashboards', 'Agent Teams', 'Workspaces', 'Creations', 'Automations', 'Skills', 'Connectors']) {
    const c = await ev(`(() => { const e = [...document.querySelectorAll('.kb4-item')].find((x) => (x.innerText || '').trim().startsWith(${JSON.stringify(t)})); if (!e) return null; const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) })()`)
    if (c === null) continue
    const { x, y } = JSON.parse(c)
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
    await scan('page ' + t)
  }
  if ((await openSettings(page, { minCells: 3 })) !== true) { console.error('○ inconclusive: Settings did not open'); process.exit(3) }
  await sleep(1200)
  const cells = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('button[class*="navCell"]')].map((b) => (b.innerText || '').trim().split('\\n')[0]))`))
  for (const c of cells) { if ((await goToSettingsPage(page, c, { settleMs: 1200 })) === true) await scan('settings ' + c) }
} finally { await live.close() }

const lastClass = (w) => (w.split(' > ').pop() || '')
const engine = seen.filter((f) => ENGINE.test(lastClass(f.where)) && !/\.kb[a-z0-9]*-/.test(lastClass(f.where)))
const ours = seen.filter((f) => !engine.includes(f))
const accepted = ours.filter((f) => ACCEPTED.test(f.where))
const bad = ours.filter((f) => !ACCEPTED.test(f.where))
console.log('  ' + seen.length + ' controls under 24 px found: ' + engine.length + ' the engine\'s, ' + accepted.length + ' accepted, ' + bad.length + ' ours')
check('none of our own controls is under 24 px without an invisible hit area', bad.length === 0, bad.map((f) => f.view + ' ' + lastClass(f.where) + ' ' + f.detail.split(' (')[0]))
check('the only exception of ours is the stacked reorder arrows of Web Search', accepted.every((f) => /kwse-move/.test(f.where)))
console.log(fail === 0 ? '\nOK' : '\n' + fail + ' check(s) failed')
process.exit(fail === 0 ? 0 : 1)
