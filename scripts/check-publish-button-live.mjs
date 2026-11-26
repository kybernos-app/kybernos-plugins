#!/usr/bin/env node
// The Publish button of the Creations, in a real GUI: tile menu, preview header, dialog (address, what is sent, refusals, the limit), the « Online » mark, update and take down.
//
//   source scripts/sandbox/env.sh && node scripts/check-publish-button-live.mjs --fake http://127.0.0.1:4177 --ws <folder> [--shots <dir>]
//
// Needs a sandbox that serves this checkout (scripts/sandbox/start.sh) started with KYBERNOS_CLOUD_API=<the fake server>, a sandbox state `kybernos-cloud.json` that holds a token, and a
// workspace that is `--ws` (see the recipe in docs/dev/live-testing.md). The fake server is `fake-sites-server.mjs` (it answers like kybernos-server's `/v1/sites` and lists what it received at
// `/__debug`); the folder holds `solo.html`, `third.html`, `notes.md`, `pizza/index.html` (+ css, a picture, `carte.html`, a PDF) and `big/index.html` (three 1.5 MB pictures).
// It refuses :3080 and any DSH home that is not a sandbox's (exit 3). Nothing real is published: the host of the pages is the fake server.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, clickText } from './live-page.mjs'

const args = process.argv.slice(2)
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null)
const fake = opt('--fake')
const ws = opt('--ws')
const shotDir = opt('--shots')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }

const host = process.env.KB_HOST || '127.0.0.1:3080'
const home = process.env.DSH_HOME || ''
if (host === '127.0.0.1:3080') { console.error('○ inconclusive: this check needs a sandbox that serves this checkout, not the DSH on :3080.'); process.exit(3) }
if (home.indexOf('.kybernos-sandbox') < 0) { console.error('○ inconclusive: DSH_HOME is not a sandbox home.'); process.exit(3) }
if (fake === null || ws === null) { console.error('○ inconclusive: give --fake <server url> and --ws <folder>.'); process.exit(3) }
const debug = async () => { try { return (await (await fetch(fake + '/__debug')).json()).sites } catch (e) { return null } }
if ((await debug()) === null) { console.error('○ inconclusive: the fake sites server does not answer at ' + fake); process.exit(3) }
if (shotDir !== null) mkdirSync(shotDir, { recursive: true })

const live = await openLivePage({ width: 1400, height: 900 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const val = async (expr, ms) => (await page.evalJs(expr, ms)).val
const poll = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(200) } return null }
const shot = async (name) => { if (shotDir !== null) await page.shot(join(shotDir, name + '.png')) }
const clickJs = async (expr) => {
  const c = await val(`(() => { const e = (${expr}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) })()`)
  if (c === null || c === undefined) return false
  const { x, y } = JSON.parse(c)
  for (const t of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type: t, x, y, button: 'left', clickCount: 1 })
  await sleep(250)
  return true
}
const cardJs = (file) => `[...document.querySelectorAll('.kb6-card')].find((c) => c.title.endsWith(${JSON.stringify('/' + file)}))`
const dialogView = () => val(`(() => { const e = document.querySelector('[data-kb="publish-card"]'); return e ? e.getAttribute('data-view') : null })()`)
const waitView = (v, ms = 8000) => poll(async () => (await dialogView()) === v, ms)
const dialogText = () => val(`(() => { const e = document.querySelector('[data-kb="publish-card"]'); return e ? e.innerText : '' })()`)
const typeName = async (text) => {
  await clickJs(`document.querySelector('[data-kb="publish-name"]')`)
  await val(`document.querySelector('[data-kb="publish-name"]').select()`)
  await page.send('Input.insertText', { text })
  await sleep(250)
}
const closeDialog = async () => { await clickJs(`document.querySelector('[data-kb="publish-close"]')`); await sleep(300) }
const openTileMenu = async (file) => {
  const found = await poll(() => val(`!!(${cardJs(file)})`), 8000)
  if (found === null) return false
  await clickJs(`(${cardJs(file)}).querySelector('.kb6-menu-btn')`)
  await sleep(300)
  return true
}
const menuMarks = () => val(`JSON.stringify([...document.querySelectorAll('.kb6-menu [data-kb]')].map((b) => b.getAttribute('data-kb')))`).then((s) => (s ? JSON.parse(s) : []))
const pressMenu = async (mark) => { await clickJs(`document.querySelector('.kb6-menu [data-kb="${mark}"]')`); await sleep(400) }
const online = (file) => val(`!!(${cardJs(file)}) && !!(${cardJs(file)}).querySelector('[data-kb="art-online"]')`)

try {
  await sleep(2500)
  await clickText(page, 'Creations')
  check('the Creations page shows the tiles', (await poll(() => val(`!!(${cardJs('solo.html')})`), 20000)) !== null)
  check('the account answered: the page knows it can publish (list of the account read)', (await poll(async () => (await val(`!!document.querySelector('[data-kb="art-prev"]')`)) === true, 5000)) !== null)
  await sleep(1500)

  // ── a file that is not a page has no row ──
  check('a Markdown note has no Publish row', (await openTileMenu('notes.md')) === true && !(await menuMarks()).includes('action-publish'))
  await clickJs(`(${cardJs('notes.md')}).querySelector('.kb6-menu-btn')`)
  await sleep(300)

  // ── a single page ──
  await sleep(600)
  check('an HTML page has a Publish… row in its menu', (await openTileMenu('solo.html')) === true && (await menuMarks()).includes('action-publish'), await menuMarks())
  await pressMenu('action-publish')
  check('the dialog opens and reads the page', (await waitView('ready')) !== null, await dialogView())
  let text = await dialogText()
  check('the address is proposed from the page\'s title and ends with .kaby.app', (await val(`document.querySelector('[data-kb="publish-name"]').value`)) === 'solo-page' && /\.kaby\.app/.test(text), text)
  check('it says what is sent: one file', /1 file/.test(text), text)
  check('it says the page is public', /Public: anyone who has the address/.test(text))
  check('it counts the pages online', /Pages online: 0/.test(text), text)
  await shot('publish-1-ready')

  await typeName('www')
  check('a reserved name is refused before anything is sent, and the button waits', /reserved/.test(await dialogText()) && (await val(`document.querySelector('[data-kb="publish-go"]').disabled`)) === true)
  await typeName('a')
  check('a name that is too short says the rule', /3 to 32 letters/.test(await dialogText()))
  await typeName('Solo Page!')
  check('what the person types is cleaned: lower case, hyphens, nothing else', (await val(`document.querySelector('[data-kb="publish-name"]').value`)) === 'solo-page', await val(`document.querySelector('[data-kb="publish-name"]').value`))
  await typeName('pris')
  await clickJs(`document.querySelector('[data-kb="publish-go"]')`)
  check('a name another person holds is said, and the dialog stays on the form', (await poll(async () => /already used by someone else/.test(await dialogText()), 6000)) !== null && (await dialogView()) === 'ready', await dialogText())
  await shot('publish-2-name-taken')
  await typeName('solo-page')
  await clickJs(`document.querySelector('[data-kb="publish-go"]')`)
  check('putting it online ends on the Online screen with the address', (await waitView('online', 12000)) !== null && /https:\/\/solo-page\.kaby\.app/.test(await dialogText()), await dialogText())
  await shot('publish-3-online')
  let sent = (await debug()).find((s) => s.slug === 'solo-page')
  check('the server received the page as index.html, with its title', sent !== undefined && sent.files.join() === 'index.html' && sent.title === 'Solo page', sent)
  await closeDialog()
  check('the tile now carries the « Online » mark', (await poll(() => online('solo.html'), 6000)) !== null)
  await shot('publish-4-tile-online')
  await openTileMenu('solo.html')
  const marks = await menuMarks()
  check('its menu offers Open, Update and Take down, and no longer Publish', marks.includes('action-site-open') && marks.includes('action-site-update') && marks.includes('action-site-down') && !marks.includes('action-publish'), marks)
  await shot('publish-5-menu-online')

  // ── update from the menu ──
  await pressMenu('action-site-update')
  check('Update online page says how it went, at the top of the page', (await poll(() => val(`/Online page updated/.test(document.body.innerText)`), 6000)) !== null)

  // ── a page with the files it uses ──
  await sleep(600)
  check('the page of a folder is found', (await openTileMenu('pizza/index.html')) === true)
  await pressMenu('action-publish')
  await waitView('ready')
  text = await dialogText()
  check('its address comes from its title, with the accents dropped', (await val(`document.querySelector('[data-kb="publish-name"]').value`)) === 'pizza-one-naples-a-lyon', await val(`document.querySelector('[data-kb="publish-name"]').value`))
  check('it says 4 files are sent: the page, its style, its picture and the other page', /4 files/.test(text), text)
  check('it names what is not sent: the PDF and the picture outside the folder', /Not sent/.test(text) && /menu\.pdf/.test(text) && /outside\.png/.test(text), text)
  await shot('publish-6-folder-page')
  await clickJs(`document.querySelector('[data-kb="publish-go"]')`)
  check('the folder page goes online', (await waitView('online', 12000)) !== null)
  sent = (await debug()).find((s) => s.slug === 'pizza-one-naples-a-lyon')
  check('the server received the page and the files it uses, at the same relative paths, and nothing else', sent !== undefined && sent.files.slice().sort().join() === 'carte.html,css/site.css,img/hero.png,index.html', sent)
  await closeDialog()

  // ── too big ──
  await sleep(600)
  await openTileMenu('big/index.html')
  await pressMenu('action-publish')
  check('a page over 4 MB is stopped before anything leaves, with the largest files named', (await waitView('blocked')) !== null && /4 MB at most/.test(await dialogText()) && /a\.png|b\.png|c\.png/.test(await dialogText()), await dialogText())
  await shot('publish-7-too-big')
  await closeDialog()

  // ── the limit of pages ──
  await openTileMenu('third.html')
  await pressMenu('action-publish')
  await waitView('ready')
  await clickJs(`document.querySelector('[data-kb="publish-go"]')`)
  check('a third page is refused with the limit, and the pages online are listed', (await poll(() => val(`!!document.querySelector('[data-kb="publish-pages"]')`), 6000)) !== null && /limit of pages online \(2\)/.test(await dialogText()), await dialogText())
  await shot('publish-8-limit')
  await clickJs(`document.querySelector('[data-kb="publish-free"]')`)
  check('Take down… in that list asks first', (await waitView('confirm')) !== null && /stops working right away/.test(await dialogText()), await dialogText())
  await shot('publish-9-confirm')
  await clickJs(`document.querySelector('[data-kb="publish-keep"]')`)
  check('Keep it online goes back without touching the page', (await debug()).length === 2)
  await clickJs(`document.querySelector('[data-kb="publish-free"]')`)
  await waitView('confirm')
  await clickJs(`document.querySelector('[data-kb="publish-takedown"]')`)
  check('Take down removes the page at the server', (await waitView('gone')) !== null && (await debug()).length === 1, await debug())
  await closeDialog()

  // ── from the preview header ──
  await openTileMenu('third.html')
  await pressMenu('action-publish')
  await waitView('ready')
  await clickJs(`document.querySelector('[data-kb="publish-go"]')`)
  await waitView('online', 12000)
  await closeDialog()
  await clickJs(`(${cardJs('third.html')}).querySelector('[data-kb="art-prev"]')`)
  check('the preview of a page that is online shows « Online » in its header', (await poll(() => val(`(() => { const b = document.querySelector('[data-kb="art-popup-publish"]'); return !!b && /Online/.test(b.innerText) && b.className.includes('live') })()`), 8000)) !== null)
  await shot('publish-10-preview-online')
  await clickJs(`document.querySelector('[data-kb="art-popup-publish"]')`)
  check('pressing it opens the Online screen', (await waitView('online')) !== null)
  await clickJs(`document.querySelector('[data-kb="publish-update"]')`)
  check('Update sends the page again and says so', (await poll(() => val(`/The page is updated/.test(document.body.innerText)`), 10000)) !== null)
  await clickJs(`document.querySelector('[data-kb="publish-down"]')`)
  await waitView('confirm')
  await clickJs(`document.querySelector('[data-kb="publish-takedown"]')`)
  check('taking it down from the preview works', (await waitView('gone')) !== null && (await debug()).every((s) => s.slug !== 'third-page' && s.slug !== 'troisieme-page'), await debug())
  await closeDialog()
  check('the preview header goes back to « Publish »', (await poll(() => val(`(() => { const b = document.querySelector('[data-kb="art-popup-publish"]'); return !!b && /Publish/.test(b.innerText) && !b.className.includes('live') })()`), 8000)) !== null)

  // ── narrow window ──
  await clickJs(`document.querySelector('[data-kb="art-popup-publish"]')`)
  await waitView('ready')
  await page.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 800, deviceScaleFactor: 1, mobile: false })
  await sleep(600)
  const fits = await poll(() => val(`(() => { const c = document.querySelector('[data-kb="publish-card"]'); const r = c.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight })()`), 4000)
  check('at 420 px the dialog fits inside the window', fits !== null)
  await shot('publish-11-narrow')
  await page.send('Emulation.clearDeviceMetricsOverride', {})
} catch (e) {
  fail += 1
  console.log('  ✗ the check stopped: ' + (e && e.message ? e.message : e))
} finally {
  await live.close()
}
console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail > 0 ? 1 : 0)
