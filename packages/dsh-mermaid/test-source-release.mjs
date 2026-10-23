// The source of a fence that failed to draw (audit L1-04): a render error puts the source on show (class `dsh-mermaid-source`), and a
// LATER successful render of the same block (a streamed fence that is complete at last, a corrected edit) must take it back. It never
// did: the diagram was drawn AND the raw source stayed under it, and the button, whose label is read from that class, offered
// « Diagram » over a diagram already there. A source the person asked for with the button is theirs and stays.
//
// The built client.js runs for real, in a real browser, on the DOM DSH 0.2 renders (test/harness.html).
//   node packages/dsh-mermaid/test-source-release.mjs
// Needs Playwright with a Chromium; when one is missing the test says so and exits 0 (SKIPPED: a skip is not a pass).
//   KB_CHROMIUM=/path/to/chromium   KB_BENCH_DEPS=/dir/with/node_modules (playwright)   (or NODE_PATH)
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const HARNESS = pathToFileURL(join(HERE, 'test', 'harness.html')).href

let playwright
let browser
try {
  const req = createRequire(join(process.env.KB_BENCH_DEPS || resolve(HERE, '..', '..'), 'noop.js'))
  playwright = req('playwright')
  const launch = { headless: true }
  if (process.env.KB_CHROMIUM) launch.executablePath = process.env.KB_CHROMIUM
  browser = await playwright.chromium.launch(launch)
} catch (e) {
  console.log('SKIPPED: the source-release GUI check of dsh-mermaid — needs playwright and a Chromium (' + String(e.message).split('\n')[0] + ')')
  console.log('DSH-MERMAID SOURCE RELEASE — 0 assertions run, SKIPPED')
  process.exit(0)
}

let ko = 0
const ok = (titre, cond, detail = '') => {
  console.log(`${cond ? '✓' : '✗'} ${titre}${detail ? ' — ' + detail : ''}`)
  if (!cond) ko += 1
}

const BAD = 'flowchart TD\n  A[ --> ???'
const GOOD = 'flowchart TD\n  A[Streamed] --> B[Complete]'
const GOOD2 = 'flowchart TD\n  A[Edited] --> B[Again]'

const page = await browser.newPage({ viewport: { width: 900, height: 1200 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(HARNESS)
await page.waitForSelector('#valid .dsh-mermaid svg', { timeout: 30000 })

// A fresh block, built from the valid one (same markup as DSH 0.2), carrying `src`.
await page.evaluate(([id, src]) => {
  const b = document.getElementById('valid').cloneNode(true)
  b.id = id
  b.removeAttribute('data-dsh-mermaid')
  b.classList.remove('dsh-mermaid-source')
  b.querySelectorAll('.dsh-mermaid').forEach((e) => e.remove())
  b.querySelector('pre code').textContent = src
  document.querySelector('.wrap').append(b)
}, ['stream', BAD])

const state = (id) => page.evaluate((i) => {
  const b = document.getElementById(i)
  const pre = b.querySelector('pre')
  const card = b.querySelector('.dsh-mermaid')
  return {
    sourceClass: b.classList.contains('dsh-mermaid-source'),
    ready: b.getAttribute('data-dsh-mermaid'),
    preShown: pre.getClientRects().length > 0,
    cards: b.querySelectorAll('.dsh-mermaid').length,
    svgs: b.querySelectorAll('.dsh-mermaid svg').length,
    errors: b.querySelectorAll('.dsh-mermaid-error').length,
    cardState: card ? card.dataset.dshMermaidState : null,
    button: card && card.querySelector('.dsh-mermaid-bar button') ? card.querySelector('.dsh-mermaid-bar button').textContent : null,
  }
}, id)
const edit = (id, src) => page.evaluate(([i, s]) => { document.getElementById(i).querySelector('pre code').textContent = s }, [id, src])

await page.waitForSelector('#stream .dsh-mermaid-error', { timeout: 30000 })
let s = await state('stream')
ok('an invalid fence: error card, source on show', s.cardState === 'error' && s.sourceClass && s.preShown, JSON.stringify(s))

// The same block becomes valid (the fence is complete at last).
await edit('stream', GOOD)
await page.waitForSelector('#stream .dsh-mermaid svg', { timeout: 30000 })
s = await state('stream')
ok('a later success: the diagram is drawn, once', s.svgs === 1 && s.cards === 1 && s.cardState === 'ok', JSON.stringify(s))
ok('...the error is gone', s.errors === 0)
ok('...and the raw source is NOT left on show under the diagram', s.sourceClass === false && s.preShown === false, JSON.stringify(s))
ok('...the button offers the code (not « Diagram » over a diagram)', s.button === 'Code', String(s.button))

// The button still works both ways after that.
await page.click('#stream .dsh-mermaid-bar button')
s = await state('stream')
ok('the button shows the source on request, and then offers the diagram', s.sourceClass && s.preShown && s.button === 'Diagram', JSON.stringify(s))

// A source the PERSON asked for is theirs: a redraw (an edit here) does not take it back.
await edit('stream', GOOD2)
await page.waitForFunction(() => document.querySelector('#stream .dsh-mermaid-canvas svg').textContent.includes('Edited'), null, { timeout: 30000 })
s = await state('stream')
ok('a redraw keeps the source the person asked for', s.sourceClass && s.preShown && s.button === 'Diagram', JSON.stringify(s))
await page.click('#stream .dsh-mermaid-bar button')

// Error, error, success: still one card, source shown through both errors and taken back at the end.
await edit('stream', BAD)
await page.waitForSelector('#stream .dsh-mermaid-error', { timeout: 30000 })
await edit('stream', BAD + ' !')
await page.waitForTimeout(700)
s = await state('stream')
ok('two errors in a row: still one card, one error, source on show', s.cards === 1 && s.errors === 1 && s.sourceClass && s.preShown, JSON.stringify(s))
await edit('stream', GOOD)
await page.waitForFunction(() => document.querySelector('#stream .dsh-mermaid-canvas svg') !== null, null, { timeout: 30000 })
s = await state('stream')
ok('...then a success: source back under the diagram', s.sourceClass === false && s.preShown === false && s.button === 'Code' && s.svgs === 1, JSON.stringify(s))

// A source shown by the person while an error happens: the error does not own it, the success does not take it.
await page.click('#stream .dsh-mermaid-bar button') // person shows the source
await edit('stream', BAD)
await page.waitForSelector('#stream .dsh-mermaid-error', { timeout: 30000 })
await edit('stream', GOOD)
await page.waitForFunction(() => document.querySelector('#stream .dsh-mermaid-canvas svg') !== null, null, { timeout: 30000 })
s = await state('stream')
ok('source shown by the person before an error: still shown after the success', s.sourceClass && s.preShown && s.button === 'Diagram', JSON.stringify(s))

// The `forced` flag (the error, not the person, put the source on show) stays right because the person cannot touch the source while the error shows: the card's
// button is not on offer then. If that button ever came back during an error, a source the person hid and showed again by hand would be taken back by the next success.
await page.click('#stream .dsh-mermaid-bar button') // person hides the source they had shown
await edit('stream', BAD)
await page.waitForSelector('#stream .dsh-mermaid-error', { timeout: 30000 })
const barShown = await page.evaluate(() => { const b = document.querySelector('#stream .dsh-mermaid-bar'); return b !== null && b.getClientRects().length > 0 })
ok('while the error shows, the source toggle is not on offer (the error owns the source it put on show)', barShown === false)

ok('no page error', errors.length === 0, errors.join(' | '))
await browser.close()
console.log(ko === 0 ? '\nOK' : `\n${ko} failure(s)`)
process.exit(ko === 0 ? 0 : 1)
