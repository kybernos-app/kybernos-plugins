#!/usr/bin/env node
// The Kybernos accent, in a real GUI (audit A1-01): orange by default, the look's own colour when it has one.
//
//   source scripts/sandbox/env.sh && node scripts/check-accent-live.mjs [--shots <dir>]
//
// kybernos-plugin declares `--kybernos-accent` (and `--kybernos-on-accent`) once: #ff7a1a with the ink #0f1115 (a darker orange in the light schemes, which need
// 3:1 on white), or the theme's brand token when kybernos-theme says on <html data-kbth-brand> that the active look has its own (Neutral violet, Ember, an accent
// from the picker). The Suite and Workers pages (switches, kicker lines, active-tab underline, accent buttons, progress bar) read that token.
// This check picks the looks on the Theme page, opens Settings › Kybernos Suite (Featured tab and a module's detail) and Settings › Workers, and measures
// the computed colours:
//   - DSH default, Dark  → the accent is the orange #ff7a1a;
//   - DSH default, Light → the darker orange (#db6916): the switch and the tab underline are 3:1 on their background, the ink on a fill 4.5:1;
//   - Neutral violet (light, then dark) → the accent is the look's brand token (violet), not the orange; in the dark scheme the token is mixed 10 % toward white,
//     because the engine only lifts a brand colour to 3:1 on layer 1 (4.15:1 ink on the violet, 4.9:1 on the mixed one).
// For each scheme it prints the accent it measured. It reads and clicks nothing that installs, saves or sends: it only changes the THEME of the instance
// it is pointed at, so it refuses :3080. Exit code 0 / 1 / 3 (3 = inconclusive: no sandbox).
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, openSettings, waitFor } from './live-page.mjs'

const args = process.argv.slice(2)
const shotDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }

const host = process.env.KB_HOST || '127.0.0.1:3080'
if (host === '127.0.0.1:3080') { console.error('○ inconclusive: this check changes the theme; use a sandbox instance (KB_HOST), not :3080.'); process.exit(3) }

const live = await openLivePage({ width: 1400, height: 900 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const val = async (expr, ms) => (await page.evalJs(expr, ms)).val
const shot = async (name) => { if (shotDir !== null) { try { mkdirSync(shotDir, { recursive: true }); await page.shot(join(shotDir, name + '.png')) } catch (e) { /* no screenshot */ } } }
const click = async (x, y) => { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }) }
/** Real click on the first visible element matching `css` whose text starts with `text`. */
const press = async (css, text) => {
  const at = await val(`(() => { const e = Array.from(document.querySelectorAll(${JSON.stringify(css)})).find((x) => x.getBoundingClientRect().width > 4 && (x.innerText || '').trim().toLowerCase().startsWith(${JSON.stringify(text.toLowerCase())})); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
  if (!at) return false
  await click(at.x, at.y)
  return true
}
const cell = (name) => press('button[class*="navCell"]', name)

/** In-page measurement: every colour is normalised to [r,g,b] through a canvas (so color-mix() and color() read as numbers), the background an element sits on is
 *  the first opaque ancestor fill, and a contrast is WCAG's. */
const READ = `(() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true })
  const rgb = (css) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = css; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255] }
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return Math.round((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) * 100) / 100 }
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c[3] > 0.95) return c } return [255, 255, 255, 1] }
  const probe = document.createElement('i'); probe.style.cssText = 'position:fixed;left:-99px;background:var(--kybernos-accent);color:var(--kybernos-on-accent)'
  const brandProbe = document.createElement('i'); brandProbe.style.cssText = 'position:fixed;left:-99px;background:var(--dsw-alias-brand-primary)'
  document.body.append(probe, brandProbe)
  const accent = rgb(getComputedStyle(probe).backgroundColor), ink = rgb(getComputedStyle(probe).color), brand = rgb(getComputedStyle(brandProbe).backgroundColor)
  probe.remove(); brandProbe.remove()
  const one = (sel, prop) => { const e = document.querySelector(sel); return e === null ? null : rgb(getComputedStyle(e)[prop]) }
  const fill = (sel, onBg) => { const e = document.querySelector(sel); if (e === null) return null; const c = rgb(getComputedStyle(e).backgroundColor); return { rgb: c, against: ratio(c, bgOf(e.parentElement || e)) } }
  const text = (sel) => { const e = document.querySelector(sel); if (e === null) return null; const c = rgb(getComputedStyle(e).color); return { rgb: c, against: ratio(c, bgOf(e)) } }
  const tab = (() => { const e = document.querySelector('.kbsu-tabs button[aria-selected="true"]'); if (e === null) return null; const c = rgb(getComputedStyle(e).borderBottomColor); return { rgb: c, against: ratio(c, bgOf(e)) } })()
  const ink2 = (sel) => { const e = document.querySelector(sel); if (e === null) return null; const s = getComputedStyle(e); return { fg: rgb(s.color), bg: rgb(s.backgroundColor), ratio: ratio(rgb(s.color), rgb(s.backgroundColor)) } }
  return JSON.stringify({ accent, ink, brand, dark: document.body.hasAttribute('data-ds-dark-theme'), attr: document.documentElement.getAttribute('data-kbth-brand'),
    suite: { sw: fill('.kbsu-sw.on:not(:disabled)'), tab, tag: text('.kbsu-tag'), btn: ink2('.kbsu-btn.accent') },
    workers: { sw: fill('.kbwk-sw.on'), btn: ink2('.kbwk-btn.accent'), prog: one('.kbwk-prog i', 'backgroundColor'), cur: ink2('.kbwk-todo>li.cur .kbwk-n') } })
})()`
const near = (a, b, tol = 2) => Array.isArray(a) && Array.isArray(b) && [0, 1, 2].every((i) => Math.abs(a[i] - b[i]) <= tol)
const hex = (c) => (c === null ? 'none' : '#' + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join(''))

const SCHEMES = [
  { id: 'dark', skin: 'DSH default', seg: 'Dark', want: 'the orange #ff7a1a', accent: [255, 122, 26], dark: true, attr: null },
  { id: 'light', skin: 'DSH default', seg: 'Light', want: 'the light orange #db6916 (3:1 on white)', accent: [219, 105, 22], dark: false, attr: null },
  { id: 'neutre', skin: 'Neutral violet', seg: null, want: 'the look\'s brand token', accent: null, dark: false, attr: 'light dark' },
  { id: 'neutre-dark', skin: 'Neutral violet', seg: 'Dark', want: 'the look\'s brand token lifted 10 % toward white', accent: null, lift: 0.1, dark: true, attr: 'light dark' },
]
const measured = {}
try {
  await sleep(2500)
  check('Settings open', await openSettings(page, { tries: 4 }))
  for (const sc of SCHEMES) {
    console.log('— ' + sc.id + ' (' + sc.skin + (sc.seg ? ', ' + sc.seg : '') + ')')
    check('the Theme page opens', await cell('Theme') && (await waitFor(page, `document.querySelector('.kbth-skin') !== null`, 10000)) !== null)
    check('the look is picked', await press('.kbth-skin', sc.skin) && (sc.seg === null || (await sleep(900), await press('.kbth-seg button', sc.seg))))
    await sleep(1500)
    check('the Suite page opens on its Featured tab', await cell('Kybernos Suite') && (await waitFor(page, `document.querySelector('[data-kb="suite-card"] .kbsu-sw.on') !== null`, 15000)) !== null && await press('button', 'Featured') && (await waitFor(page, `document.querySelector('.kbsu-tag') !== null`, 8000)) !== null)
    await sleep(600)
    const s1 = JSON.parse(await val(READ))
    await shot('suite-' + sc.id)
    check('a module detail opens (its tab bar)', await press('[data-kb="suite-fiche-btn"]', 'Details') && (await waitFor(page, `document.querySelector('.kbsu-tabs') !== null`, 8000)) !== null)
    const s2 = JSON.parse(await val(READ))
    await shot('suite-detail-' + sc.id)
    check('the Workers page opens', await cell('Workers') && (await waitFor(page, `document.querySelector('.kbwk') !== null`, 12000)) !== null)
    await sleep(1000)
    const w = JSON.parse(await val(READ))
    await shot('workers-' + sc.id)
    const a = s1.accent
    measured[sc.id] = hex(a)
    check('the scheme is the expected one (' + (sc.dark ? 'dark' : 'light') + ')' + (sc.attr === null ? ', no brand attribute' : ', data-kbth-brand="' + sc.attr + '"'), s1.dark === sc.dark && s1.attr === sc.attr, { dark: s1.dark, attr: s1.attr })
    if (sc.accent !== null) check('the accent is ' + sc.want + ' (measured ' + hex(a) + ')', near(a, sc.accent), a)
    else {
      const expected = s1.brand.slice(0, 3).map((v) => v * (1 - (sc.lift || 0)) + 255 * (sc.lift || 0))
      check('the accent is ' + sc.want + ' (measured ' + hex(a) + ', brand token ' + hex(s1.brand) + '), and not the orange', near(a, expected, 2) && !near(a, [255, 122, 26], 12) && !near(a, [219, 105, 22], 12), { a, brand: s1.brand })
    }
    check('the on-accent ink is ' + (sc.accent === null ? 'the look\'s own label pair' : '#0f1115'), sc.accent === null || near(s1.ink, [15, 17, 21]), s1.ink)
    check('a module switch that is ON is the accent, 3:1 on its card', s1.suite.sw !== null && near(s1.suite.sw.rgb, a, 1) && s1.suite.sw.against >= 3, s1.suite.sw)
    check('the kicker line of a featured card is drawn, in the accent family, 4.5:1 on its card', s1.suite.tag !== null && s1.suite.tag.against >= 4.5, s1.suite.tag)
    check('the selected tab underline of a module is the accent, 3:1 on its bar', s2.suite.tab !== null && near(s2.suite.tab.rgb, a, 1) && s2.suite.tab.against >= 3, s2.suite.tab)
    check('Workers shows at least one accent control, and each of them is the accent', [w.workers.sw, w.workers.btn, w.workers.prog, w.workers.cur].some((x) => x !== null), w.workers)
    if (w.workers.sw !== null) check('the Workers switch is the accent, 3:1', near(w.workers.sw.rgb, a, 1) && w.workers.sw.against >= 3, w.workers.sw)
    if (w.workers.btn !== null) check('the Workers accent button is the accent with 4.5:1 ink', near(w.workers.btn.bg, a, 1) && w.workers.btn.ratio >= 4.5, w.workers.btn)
    if (w.workers.prog !== null) check('the Workers progress bar is the accent', near(w.workers.prog, a, 1), w.workers.prog)
    if (w.workers.cur !== null) check('the current step disc is the accent with 4.5:1 ink', near(w.workers.cur.bg, a, 1) && w.workers.cur.ratio >= 4.5, w.workers.cur)
  }
  // leave the sandbox on its default look
  await cell('Theme'); await waitFor(page, `document.querySelector('.kbth-skin') !== null`, 8000); await press('.kbth-skin', 'DSH default'); await sleep(600)
} catch (e) {
  console.log('  ✗ the check threw — ' + String(e && e.message || e).slice(0, 200)); fail += 1
} finally {
  await live.close()
}
console.log('\naccent measured: ' + SCHEMES.map((sc) => sc.id + ' ' + (measured[sc.id] || '?')).join(' · '))
console.log(pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
