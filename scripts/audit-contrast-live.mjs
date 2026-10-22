#!/usr/bin/env node
// Text contrast (WCAG AA) of every Settings page, on the LIVE GUI. It measures, it does not gate (exit 0; 3 = inconclusive).
//
//   node scripts/audit-contrast-live.mjs                          # the mode the GUI is in now, every Settings page
//   node scripts/audit-contrast-live.mjs --only "General|Voice"   # only these pages (their names, separated by |)
//   node scripts/audit-contrast-live.mjs --json out.json          # + the full machine-readable report
//   source scripts/sandbox/env.sh && node scripts/audit-contrast-live.mjs --mode Light   # a sandbox only: set Light, measure, put the mode back
//
// The measuring is .claude/skills/ux-bug-hunter/contrast.js (read it for what it leaves out: drawings, disabled controls, text that is animating, text on
// a gradient). On :3080 the walk only opens pages, like the other audits; `--mode` presses the Theme page's mode cards and so refuses :3080.
// The report groups the hits by the pair of colours: DSH's own pages share a few tokens, so « 22 hits, one pair » is one decision, not 22 defects.
// A hit on a class with a hashed prefix (`oY77xG_desc`) belongs to the engine, the others to a plugin of this repo.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openLivePage, openSettings, goToSettingsPage, openThemeAdvanced } from './live-page.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const argOf = (name) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : null }
const ONLY = argOf('--only')
const JSON_OUT = argOf('--json')
const MODE = argOf('--mode')
const host = process.env.KB_HOST || '127.0.0.1:3080'
if (MODE !== null && (host === '127.0.0.1:3080' || !['Light', 'Dark', 'System'].includes(MODE))) {
  console.error('○ inconclusive: --mode Light|Dark|System presses the Appearance cards, so it needs a sandbox instance (KB_HOST), never :3080.')
  process.exit(3)
}
const PROBE = readFileSync(join(REPO, '.claude', 'skills', 'ux-bug-hunter', 'contrast.js'), 'utf8')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const engineClass = /\.[A-Za-z0-9]{6}_/

const live = await openLivePage({ width: 1400, height: 900 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const ev = async (js, ms = 20000) => (await page.evalJs(js, ms)).val
const click = async (x, y) => { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }) }
/** Presses the Theme page's mode card that starts with `name`; resolves the name of the card that was current before (so it can be put back). */
const pickMode = async (name) => {
  await goToSettingsPage(page, 'Theme', { settleMs: 1500 })
  await openThemeAdvanced(page) // the mode cards sit in the Advanced editor, folded under the simple view
  const before = await ev(`(() => { const c = Array.from(document.querySelectorAll('.kbth-mode')).find((x) => /current/i.test(x.innerText || '')); return c ? (c.innerText || '').trim().split('\\n')[0] : null })()`)
  const at = await ev(`(() => { const e = Array.from(document.querySelectorAll('.kbth-mode')).find((x) => (x.innerText || '').trim().startsWith(${JSON.stringify(name)})); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
  if (at === null) throw new Error('the Theme page has no « ' + name + ' » mode card')
  await click(at.x, at.y); await sleep(1500)
  return before
}

const report = { host, mode: MODE, pages: {} }
let previous = null
try {
  await sleep(3000)
  await openSettings(page)
  if (MODE !== null) previous = await pickMode(MODE)
  const pages = JSON.parse(await ev(`JSON.stringify(Array.from(document.querySelectorAll('button[class*="navCell"]')).map((x) => (x.innerText || '').trim().split('\\n')[0]))`))
  const wanted = ONLY === null ? null : ONLY.split('|').map((s) => s.trim().toLowerCase())
  for (const p of pages) {
    if (wanted !== null && !wanted.includes(p.toLowerCase())) continue
    await goToSettingsPage(page, p, { settleMs: 1800 })
    let res
    try { res = await ev(PROBE, 30000) } catch (e) { res = { error: String(e.message || e) } }
    report.pages[p] = res
    console.log(p.padEnd(26) + (res.error ? 'error: ' + res.error : res.bad.length + ' below AA · ' + res.scanned + ' read · worst ' + res.worst))
  }
  report.scheme = await ev(`getComputedStyle(document.body).backgroundColor`)
} finally {
  try { if (previous !== null) await pickMode(previous) } catch (e) { console.log('! the mode could not be put back (' + (e.message || e) + '): it was ' + previous) }
  await live.close()
}

const groups = new Map()
for (const [p, res] of Object.entries(report.pages)) {
  for (const b of res.bad || []) {
    const key = b.fg + ' on ' + b.bg
    const g = groups.get(key) || { key, ratio: b.ratio, need: b.need, who: new Set(), n: 0, e: null, owner: 'ours' }
    g.n += 1; g.who.add(p); if (g.e === null) g.e = b.text + ' (' + b.where + ')'
    if (engineClass.test(b.where)) g.owner = 'engine'
    groups.set(key, g)
  }
}
const rows = [...groups.values()].sort((a, b) => a.ratio - b.ratio)
console.log('\n' + rows.reduce((n, g) => n + g.n, 0) + ' hit(s), ' + rows.length + ' pair(s) of colours, background ' + (report.scheme || '?'))
for (const g of rows) console.log('  ' + String(g.ratio).padStart(5) + ' (needs ' + g.need + ')  ' + g.key.padEnd(26) + g.owner.padEnd(7) + g.n + '× on ' + [...g.who].slice(0, 4).join(', ') + (g.who.size > 4 ? '…' : '') + '  e.g. ' + g.e)
if (JSON_OUT !== null) { writeFileSync(JSON_OUT, JSON.stringify(report, null, 1)); console.log('report: ' + JSON_OUT) }
process.exit(0)
