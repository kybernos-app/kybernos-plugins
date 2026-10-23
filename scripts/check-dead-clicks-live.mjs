// Dead clicks, on the REAL GUI: press everything a person could press on each page, and list what does nothing or throws.
//
//   node scripts/check-dead-clicks-live.mjs [--pages "Skills,Connectors" (default: every row of the sidebar's Kybernos menu)] [--settings [--settings-pages "General,Skills"]] [--max 120] [--settle 700] [--shots <dir>] [--verbose]
//                                            [--swap kybernos-skills,kybernos-plugin [--mine <root>]]   (try this checkout's client, or the one under <root>, before it is merged)
//
// The method and its limits are in scripts/lib-dead-clicks.mjs (proved against a fixture page by scripts/test-dead-clicks.mjs). Here it is pointed at the pages
// of the sidebar (and, with --settings, at each page of the Settings dialog) of the GUI at KB_HOST: a sandbox (`source scripts/sandbox/env.sh`), or the real :3080
// with --real (the ux-bug-hunter rule is « on :3080 you look »: pressing everything there is allowed only because nothing can be written, see below).
//
// It is read-only in the way the other live checks are, and stricter: the browser is a throw-away one, EVERY HTTP request that is not a GET is answered 403
// inside the browser and listed (so a Save, an Install, a Delete that a press reaches cannot write anything), nothing is sent on a WebSocket while a press is
// watched (no chat message, no command), window.open and the native dialogs are stubbed, and what reads as destructive is not pressed at all. What it cannot
// see: a handler that works but only after more than ~0.7 s, and one that only changes something invisible (a value kept in memory). A press that changes the
// page itself (a tab, a filter) makes it open the page again before the next one.
//
// scripts/dead-clicks-allow.json lists the presses that do nothing ON PURPOSE (page, what it is called or its data-kb, why). Anything else dead or broken fails.
// Exit 0 nothing to fix / 1 a dead or broken press / 3 not run (no GUI).
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { clickText, goToSettingsPage, openLivePage, openSettings, waitFor } from './live-page.mjs'
import { swapBundles } from './lib-bundle-swap.mjs'
import { INSTALL_JS, probePage } from './lib-dead-clicks.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const arg = (name, dflt) => { const i = process.argv.indexOf('--' + name); return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt }
const flag = (name) => process.argv.includes('--' + name)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// `--pages` names the sidebar rows to walk; without it, every row of the Kybernos menu is read from the sidebar (the rows carry the owner's own names: a renamed Agent Teams, a Dashboards).
const PAGES_ARG = arg('pages', null)
const MAX = Number(arg('max', '120'))
const SETTLE = Number(arg('settle', '700'))
const shotsDir = arg('shots', null)
const MAIN = '[class*="centerCol"]'   // the main column of the DSH shell (a CSS-module name with a hashed prefix)
// The content of the Settings dialog, without its menu: the sibling of the nav's branch (pressing a menu cell is the walk of Settings itself, not a thing to test on each page).
const SETTINGS_CONTENT = `js:(() => { const d = document.querySelector('[role="dialog"]'); const cell = d && d.querySelector('button[class*="navCell"]'); if (!cell) return null; for (let n = cell; n.parentElement; n = n.parentElement) { const sib = Array.from(n.parentElement.children).find((c) => c !== n && !c.contains(cell) && c.getBoundingClientRect().width > 300); if (sib) return sib; if (n.parentElement === d) break } return d })()`
let allow = []
try { allow = JSON.parse(readFileSync(join(here, 'dead-clicks-allow.json'), 'utf8')).allow } catch (e) { allow = [] }
const allowed = (page, row) => allow.some((a) => (a.page === page || a.page === '*') && ((typeof a.dk === 'string' && a.dk === row.dk) || (typeof a.match === 'string' && row.label.startsWith(a.match))))

if ((process.env.KB_HOST || '127.0.0.1:3080') === '127.0.0.1:3080' && !flag('real')) {
  console.error('○ not run: this presses every button of every page. On the real :3080 say so with --real (every write is refused in the browser); otherwise use a sandbox: source scripts/sandbox/env.sh')
  process.exit(3)
}
const live = await openLivePage({ width: 1500, height: 950 }).catch((e) => { console.error('○ not run: ' + e.message); process.exit(3) })
const { page } = live
const blocked = []
let failures = 0
const report = []
try {
  // Fail closed: nothing but a read leaves the browser.
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] })
  page.on('Fetch.requestPaused', (p) => {
    if (p.responseStatusCode !== undefined) return   // the bundle swap's business (response stage)
    const m = p.request.method
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') { page.send('Fetch.continueRequest', { requestId: p.requestId }).catch(() => {}); return }
    blocked.push(m + ' ' + p.request.url.split('?')[0].replace(/^https?:\/\/[^/]+/, ''))
    page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 403, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: Buffer.from(JSON.stringify({ ok: false, error: 'refused_by_the_probe' }), 'utf8').toString('base64') }).catch(() => {})
  })
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: INSTALL_JS })
  const swapNames = arg('swap', '').split(',').map((x) => x.trim()).filter((x) => x !== '')
  const swap = swapNames.length === 0 ? null : await swapBundles(page, swapNames.map((name) => ({ name })), { mineRoot: arg('mine', undefined), extraPatterns: [{ urlPattern: '*', requestStage: 'Request' }] })
  await page.send('Page.reload', { ignoreCache: true })
  const shell = async () => { await sleep(2200); await waitFor(page, 'document.body && document.body.innerText.length > 80', 30000) }
  await shell()
  const js = async (e) => (await page.evalJs(e, 15000)).val

  const walk = async (name, { enter, scope, soft }) => {
    process.stdout.write('· ' + name + ' … ')
    if (!(await enter(true))) { console.log('not in this GUI (skipped)'); return }
    const t0 = Date.now()
    const out = await probePage(page, { max: MAX, settleMs: SETTLE, scope, onResult: (r) => { if (flag('verbose')) console.log('      ' + r.verdict.padEnd(6) + ' ' + r.label.slice(0, 40).padEnd(40) + ' <' + r.tag + (r.dk !== '' ? ' ' + r.dk : '') + '> ' + r.why) }, restore: async () => {
      if (soft !== undefined) { try { await soft(); if (await enter(false)) return } catch (e) { /* reload below */ } }
      await page.send('Page.reload', { ignoreCache: true }); await shell(); await enter(false)
    } })
    const bad = out.results.filter((r) => r.verdict !== 'ok')
    const real = bad.filter((r) => !allowed(name, r))
    console.log(out.results.length + ' pressed in ' + Math.round((Date.now() - t0) / 1000) + ' s: ' + (out.results.length - bad.length) + ' ok, ' + real.length + ' to fix' + (bad.length > real.length ? ', ' + (bad.length - real.length) + ' allowed' : '') + '; ' + out.skipped.length + ' skipped, ' + out.covered.length + ' covered, page reopened ' + out.restores + '×')
    for (const r of real) console.log('    ' + (r.verdict === 'dead' ? 'DEAD   ' : 'BROKEN ') + r.label.slice(0, 50) + '  <' + r.tag + (r.role !== '' ? ' role=' + r.role : '') + (r.dk !== '' ? ' data-kb=' + r.dk : '') + (r.cls !== '' ? ' class="' + r.cls + '"' : '') + '>' + (r.verdict === 'broken' ? '  — ' + r.why : ''))
    if (out.results.length >= MAX) console.log('    (stopped at --max ' + MAX + ': more are left)')
    if (real.length > 0 && shotsDir !== null) await page.shot(join(shotsDir, 'dead-clicks-' + name.replace(/\W+/g, '-') + '.png')).catch(() => {})
    failures += real.length
    report.push({ page: name, pressed: out.results.length, dead: bad.filter((r) => r.verdict === 'dead').map((r) => r.label), broken: bad.filter((r) => r.verdict === 'broken').map((r) => r.label + ': ' + r.why), skipped: out.skipped.length, covered: out.covered })
  }

  const PAGES = PAGES_ARG !== null ? PAGES_ARG.split(',').map((x) => x.trim()).filter((x) => x !== '')
    : (await js(`Array.from(document.querySelectorAll('.kb4-menu .kb4-item .kb4-lab')).map((e) => (e.innerText || '').trim()).filter((t) => t !== '')`)) || []
  console.log('sidebar rows: ' + (PAGES.length > 0 ? PAGES.join(', ') : '(none found)'))
  for (const name of PAGES) {
    await walk(name, {
      scope: MAIN,
      enter: async (first) => {
        if (!(await clickText(page, name))) return false
        await sleep(first ? 1800 : 1500)
        return true
      }
    })
  }

  if (flag('settings')) {
    if (!(await openSettings(page, { tries: 3 }))) console.log('· Settings did not open (skipped)')
    else {
      const cells = await js(`Array.from(document.querySelectorAll('button[class*="navCell"]')).map((b) => (b.innerText || '').trim().split('\\n')[0]).filter((t) => t !== '')`)
      const only = arg('settings-pages', '').split(',').map((x) => x.trim().toLowerCase()).filter((x) => x !== '')
      for (const label of (Array.isArray(cells) ? cells : []).filter((c) => only.length === 0 || only.includes(c.toLowerCase()))) {
        await walk('Settings › ' + label, {
          scope: SETTINGS_CONTENT,
          // Opening Settings again resets a page (it is mounted anew): no need to reload the whole GUI between two presses.
          soft: async () => { await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(500) },
          enter: async () => { if (!(await openSettings(page, { tries: 2 }))) return false; return goToSettingsPage(page, label, { settleMs: 800 }) }
        })
      }
    }
  }

  if (swap !== null) console.log('\nclient swapped in: ' + swap.report().map((r) => r.file + (r.replaced ? '' : ' (NOT FOUND in the served bundle: the page ran what is deployed)')).join(', '))
  console.log('\nwrites the page tried and that were refused here: ' + blocked.length + (blocked.length > 0 ? ' (' + [...new Set(blocked)].slice(0, 6).join(', ') + ')' : ''))
  if (arg('json', null) !== null) writeFileSync(resolve(arg('json', '')), JSON.stringify({ report, blocked }, null, 1))
} finally {
  await live.close()
}
console.log(failures === 0 ? '\nNo dead click, no broken one.' : '\n' + failures + ' press(es) to fix (or to list in scripts/dead-clicks-allow.json with the reason).')
process.exit(failures === 0 ? 0 : 1)
