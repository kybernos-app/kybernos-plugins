// The canvas of an automation (Workflow tab) in a dark app, on a real GUI: every style keeps a canvas and cards that belong to the app's scheme, readable ink on the cards, and
// the light twin is unchanged. SANDBOX ONLY (`source scripts/sandbox/env.sh`): it writes one automation to the sandbox's tasks.json and removes it (exit 3 elsewhere).
//
// Named check-* on purpose: it needs a running sandbox and Chrome, so CI must not run it.
//   source scripts/sandbox/env.sh && node scripts/check-flow-dark-live.mjs     (KB_SHOT_DIR=/some/dir keeps screenshots)
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLivePage, clickText, waitFor } from './live-page.mjs'

const authority = process.env.KB_HOST || '127.0.0.1:3080'
if (authority === '127.0.0.1:3080') { console.error('refusing to run against :3080: this check writes an automation. Use the sandbox (source scripts/sandbox/env.sh).'); process.exit(3) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let fails = 0
const check = (label, ok, detail) => { if (!ok) fails += 1; console.log((ok ? 'ok   ' : 'FAIL ') + label + (detail !== undefined && !ok ? ' | ' + detail : '')) }
const shotDir = process.env.KB_SHOT_DIR || join(tmpdir(), 'kb-flow-dark-live')
mkdirSync(shotDir, { recursive: true })

const live = await openLivePage({ width: 1500, height: 1000 })
const { page } = live
const q = async (js) => { const r = await page.evalJs(js, 25000); return r.err ? { __err: r.err } : r.val }
const post = (body) => q(`fetch('/kybernos/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(${JSON.stringify(body)}) }).then((r) => r.json())`)
const STYLES = ['auto', 'nr', 'bp', 'pp', 'sf', 'lg', 'at', 'jy', 'mx']
// relative luminance of the first rgb() in a computed colour
const LUM = `(c) => { const m = String(c).match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/); if (!m) return null; const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(+m[1]) + 0.7152 * f(+m[2]) + 0.0722 * f(+m[3]) }`
let taskId = null
try {
  await sleep(3000)
  const t = await post({ action: 'create', task: { name: 'Check dark canvas', prompt: '1. List the deadlines.\n2. Write the summary.\n3. Record the run.', schedule: { mode: 'cron', cron: '0 8 * * 1', tz: 'Europe/Paris' }, active: false } })
  taskId = t.task && t.task.id
  const measure = (dark) => q(`(() => { const lum = ${LUM}; const root = document.documentElement; root.setAttribute('data-kb-theme', ${JSON.stringify(dark ? 'dark' : 'light')}); const cv = document.querySelector('[data-kb="flow-canvas"]'); const card = document.querySelector('[data-kb="flow-card"]'); if (!cv || !card) return null; const cs = getComputedStyle(card); return { style: cv.dataset.style, cv: lum(getComputedStyle(cv).backgroundColor), card: lum(cs.backgroundColor), ink: lum(getComputedStyle(card.querySelector('b, strong, span') || card).color) } })()`)
  for (const id of STYLES) {
    await q(`localStorage.setItem('kybernos.flowstyle', ${JSON.stringify(id)})`)
    await page.send('Page.reload', { ignoreCache: true }); await sleep(3500)
    await clickText(page, 'Automations'); await sleep(1800)
    await q(`(() => { const n = document.querySelector('.kba-rowline .kba-name'); if (n) n.click() })()`)
    await waitFor(page, `!!document.querySelector('[data-kb="flow-card"]')`, 12000)
    const light = await measure(false)
    const dark = await measure(true)
    await sleep(300)
    if (id === 'jy' || id === 'lg') await page.shot(join(shotDir, 'flow-dark-' + id + '.png')).catch(() => null)
    check('style ' + id + ': the canvas is drawn in both schemes', light !== null && dark !== null && light.style === id, JSON.stringify([light, dark]))
    if (light === null || dark === null) continue
    // in the dark app: a dark canvas, cards darker than the ink, and an ink that reads on its card (contrast >= 4.5)
    const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
    if (id !== 'auto') check('style ' + id + ' in the dark app: a dark canvas, a dark card, an ink that reads on it', dark.cv < 0.12 && dark.card < 0.2 && contrast(dark.ink, dark.card) >= 4.5, JSON.stringify(dark))
    if (id !== 'auto' && id !== 'bp') check('style ' + id + ' in the light app is unchanged: a light canvas', light.cv > 0.5, JSON.stringify(light))
  }
  // The real thing: the app's own dark theme (its toggle), for the style that follows the app and for a light one
  for (const id of ['auto', 'jy']) {
    await q(`localStorage.setItem('kybernos.flowstyle', ${JSON.stringify(id)})`)
    await page.send('Page.reload', { ignoreCache: true }); await sleep(3500)
    const toggled = await q(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('title') === 'Dark theme' || x.getAttribute('aria-label') === 'Dark theme'); if (!b) return false; b.click(); return true })()`)
    await sleep(1500)
    await clickText(page, 'Automations'); await sleep(1800)
    await q(`(() => { const n = document.querySelector('.kba-rowline .kba-name'); if (n) n.click() })()`)
    await waitFor(page, `!!document.querySelector('[data-kb="flow-card"]')`, 12000)
    const real = await q(`(() => { const lum = ${LUM}; const cv = document.querySelector('[data-kb="flow-canvas"]'); const card = document.querySelector('[data-kb="flow-card"]'); return { theme: document.documentElement.getAttribute('data-kb-theme'), cv: lum(getComputedStyle(cv).backgroundColor), card: lum(getComputedStyle(card).backgroundColor), ink: lum(getComputedStyle(card.querySelector('b, strong, span') || card).color) } })()`)
    await page.shot(join(shotDir, 'flow-real-dark-' + id + '.png')).catch(() => null)
    const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
    check('style ' + id + ' in the real dark theme (the app\'s own toggle): a dark canvas and card, ink that reads', toggled === true && real !== null && real.theme === 'dark' && real.cv < 0.12 && real.card < 0.2 && contrast(real.ink, real.card) >= 4.5, JSON.stringify([toggled, real]))
    await q(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('title') === 'Light theme' || x.getAttribute('aria-label') === 'Light theme'); if (b) b.click() })()`)
    await sleep(800)
  }
} catch (e) {
  fails += 1
  console.log('FAIL an error nobody caught: ' + String(e && e.message ? e.message : e).slice(0, 300))
} finally {
  try { if (taskId) await post({ action: 'delete', id: taskId }) } catch (e) { /* gone */ }
  try { await q(`localStorage.removeItem('kybernos.flowstyle')`) } catch (e) { /* gone */ }
  await live.close()
}
console.log(fails === 0 ? '\nall checks passed' : '\n' + fails + ' check(s) FAILED')
process.exit(fails === 0 ? 0 : 1)
