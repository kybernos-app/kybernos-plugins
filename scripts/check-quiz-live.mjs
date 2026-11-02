#!/usr/bin/env node
// A quiz opened from Creations, in a real GUI (audit A4-28 and A4-34).
//
//   source scripts/sandbox/env.sh && node scripts/check-quiz-live.mjs [--shots <dir>]
//
// Needs a DSH that serves this checkout (scripts/sandbox/start.sh); refuses :3080 and any DSH home that is not a sandbox's.
// It writes ONE file, quiz-demo.quiz, at the root of this checkout (the sandbox's workspace) and removes it at the end; the
// request to install an app is intercepted and refused, so nothing is installed.
//
// What it proves:
//   - « App » (the mini-app button) no longer floats over the player: it is on a line of its own, and the middle of the
//     « Check » button is the Check button (it used to be the App button: a click there asked to install an app);
//   - checking a quiz writes its score to <DSH_HOME>/kybernos/progress.json, not next to the plugin (packages/.dsh).
// Exit code 0 / 1 / 3 (3 = inconclusive: no sandbox).
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openLivePage, clickText } from './live-page.mjs'

const args = process.argv.slice(2)
const shotDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }

const host = process.env.KB_HOST || '127.0.0.1:3080'
const home = process.env.DSH_HOME || ''
if (host === '127.0.0.1:3080') { console.error('○ inconclusive: this check needs a DSH that serves this checkout (a sandbox instance), not the one on :3080.'); process.exit(3) }
if (home.indexOf('.kybernos-sandbox') < 0) { console.error('○ inconclusive: DSH_HOME is not a sandbox home.'); process.exit(3) }

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const quizFile = join(repo, 'quiz-demo.quiz')
const registry = join(home, 'kybernos', 'progress.json')
const stray = join(repo, 'packages', '.dsh')
if (existsSync(quizFile)) { console.error('○ inconclusive: ' + quizFile + ' already exists; not touching it.'); process.exit(3) }
rmSync(registry, { force: true })
const strayBefore = existsSync(stray)

writeFileSync(quizFile, JSON.stringify([
  { question: 'What is 2 + 2?', choices: ['3', '4'], answer: 1 },
  { question: 'What colour is a clear sky?', choices: ['blue', 'green'], answer: 0 },
]))

const live = await openLivePage({ width: 1400, height: 900 }).catch((e) => { rmSync(quizFile, { force: true }); console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const val = async (expr, ms) => (await page.evalJs(expr, ms)).val
const shot = async (name) => { if (shotDir !== null) { try { mkdirSync(shotDir, { recursive: true }); await page.shot(join(shotDir, name + '.png')) } catch (e) { /* no screenshot */ } } }
const poll = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(250) } return null }
const q = (sel) => val(`document.querySelectorAll(${JSON.stringify(sel)}).length`)
const press = async (x, y) => {
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}
const centre = async (js) => { const p = await val(`(() => { const e = (${js}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) })()`); return typeof p === 'string' ? JSON.parse(p) : null }
const click = async (js) => { const c = await centre(js); if (c === null) return false; await press(c.x, c.y); await sleep(300); return true }
const dismissGetStarted = () => val(`(() => { const b = Array.from(document.querySelectorAll('button[aria-label="Close"]')).find((x) => /Get started/.test(((x.closest('[class*="_root_"]') || x.parentElement || {}).innerText) || '')); if (!b) return false; b.click(); return true })()`)

// The install request must never go out: it is refused here.
const installs = []
await page.send('Fetch.enable', { patterns: [{ urlPattern: '*kybernos-miniapps/install*', requestStage: 'Request' }] })
page.on('Fetch.requestPaused', async (p) => {
  installs.push(p.request.url)
  try { await page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: Buffer.from('{"ok":false,"error":"refused by the check"}').toString('base64') }) } catch (e) { /* gone */ }
})

try {
  await sleep(2500)
  await dismissGetStarted()
  await sleep(500)
  check('Creations opens', (await clickText(page, 'Creations')) === true)
  check('the quiz is listed', (await poll(() => val(`Array.from(document.querySelectorAll('*')).some((e) => e.children.length === 0 && /quiz-demo\\.quiz/.test(e.innerText || ''))`), 25000)) === true)
  await sleep(1000)
  check('...and opens', (await click(`Array.from(document.querySelectorAll('.kb6-card')).find((e) => /quiz-demo\\.quiz/.test(e.innerText || ''))`)) === true && (await poll(() => q('[data-kb="quiz-check"]'), 15000)) !== null)
  await sleep(800)

  console.log('\n── A4-28 · the App button and the player ──')
  check('the mini-app button is there', (await poll(() => q('.kbma-root > .kbmini-btn'), 10000)) !== null)
  const geo = JSON.parse(await val(`(() => { const a = document.querySelector('.kbma-root > .kbmini-btn').getBoundingClientRect(); const c = document.querySelector('[data-kb="quiz-check"]').getBoundingClientRect(); const e = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2); return JSON.stringify({ app: [a.left, a.top, a.right, a.bottom].map(Math.round), check: [c.left, c.top, c.right, c.bottom].map(Math.round), over: e ? (e.closest('button') || e).getAttribute('data-kb') || (e.closest('button') || e).className : null }) })()`))
  const overlap = !(geo.app[2] <= geo.check[0] || geo.check[2] <= geo.app[0] || geo.app[3] <= geo.check[1] || geo.check[3] <= geo.app[1])
  check('the two buttons do not overlap', overlap === false, geo)
  check('the element under the middle of « Check » is the Check button', geo.over === 'quiz-check', geo)
  await shot('quiz-app-button')
  for (const sel of ['[data-kb="quiz-item"]:nth-of-type(1) .kbq-choice:nth-child(2)', '[data-kb="quiz-item"]:nth-of-type(2) .kbq-choice:nth-child(1)']) await click(`document.querySelector(${JSON.stringify(sel)})`)
  await sleep(400)
  check('a click in the MIDDLE of « Check » checks the quiz', (await click(`document.querySelector('[data-kb="quiz-check"]')`)) === true && (await poll(() => q('[data-kb="quiz-score"]'), 6000)) !== null)
  check('...and asked to install nothing', installs.length === 0, installs)
  await shot('quiz-checked')

  console.log('\n── A4-34 · where the score is kept ──')
  check('the score is in the DSH home (kybernos/progress.json)', (await poll(async () => existsSync(registry), 6000)) !== null && /quiz-demo/.test(readFileSync(registry, 'utf8')))
  check('nothing was written next to the plugin (packages/.dsh)', strayBefore === true || existsSync(stray) === false)
} catch (e) {
  fail += 1
  console.log('  ✗ the check stopped: ' + (e && e.message ? e.message : e))
} finally {
  await live.close()
  rmSync(quizFile, { force: true })
  rmSync(registry, { force: true })
  if (strayBefore !== true) rmSync(stray, { recursive: true, force: true })
}
console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + ', ' + pass + ' passed')
process.exit(fail === 0 ? 0 : 1)
