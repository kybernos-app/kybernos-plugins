// End-to-end check of the PoC in a real headless Chrome: agent write, in-place edit, edit read-back, agent correction,
// sandbox fences, PDF export, PPTX export. Prints PASS/FAIL lines and a PPTX fidelity summary. Writes artefacts to OUT_DIR.
import { start } from './server.mjs'
import { deck } from './sample-deck.mjs'
import puppeteer from 'puppeteer-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const OUT = process.env.OUT_DIR || join(process.cwd(), 'out')
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
mkdirSync(OUT, { recursive: true })
let failed = 0
const ok = (name, cond, detail = '') => { if (!cond) failed++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const server = await start(0)
const base = `http://127.0.0.1:${server.address().port}`
const call = async (path, opts) => {
  const r = await fetch(base + path, opts)
  const buf = Buffer.from(await r.arrayBuffer())
  return { status: r.status, json: r.headers.get('content-type')?.includes('json') ? JSON.parse(buf.toString('utf8')) : null, buf }
}
const put = (body) => call('/api/deck', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, defaultViewport: { width: 1440, height: 900 } })
try {
  // 1. the agent writes the deck
  let r = await put(deck)
  ok('agent writes a 7-slide deck', r.status === 200 && r.json.slides === 7 && r.json.version === 1, JSON.stringify(r.json))

  // 2. the studio loads it
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(base + '/', { waitUntil: 'networkidle0' })
  await page.waitForFunction("document.querySelectorAll('#rail .thumb').length === 7", { timeout: 10000 })
  const mainFrame = async (n) => {
    for (let i = 0; i < 60; i++) {
      const f = page.frames().find((x) => x.url().includes(`/slide/${n}.html`) && !x.url().includes('thumb'))
      if (f && await f.evaluate(() => document.querySelectorAll('[data-kb]').length).catch(() => 0) > 0) return f
      await sleep(100)
    }
    throw new Error(`slide ${n} frame did not load`)
  }
  let f = await mainFrame(0)
  const leaves = await f.evaluate(() => document.querySelectorAll('[data-kb]').length)
  ok('studio shows 7 thumbnails and slide 1 is taggable', leaves >= 3, `${leaves} text leaves`)

  // 3. sandbox fences: the slide cannot reach the studio, the network, or run agent script
  const leak = await f.evaluate(() => { try { return typeof parent.document.body } catch (e) { return 'blocked' } })
  ok('slide iframe cannot read the parent document (opaque origin)', leak === 'blocked', leak)
  const net = await f.evaluate(() => fetch('/api/state').then(() => 'reached', () => 'blocked'))
  ok('slide iframe cannot call the API (CSP connect-src none)', net === 'blocked', net)

  // 4. in-place edit -> edit read-back -> deck updated
  await page.click('#edit')
  await sleep(300)
  // The stage is scaled with CSS transform, so work out the real click point (frame rect x scale) instead of trusting frame.click.
  const pt = await f.evaluate(() => { const r = document.querySelector('h1').getBoundingClientRect(); return { x: r.x + 40, y: r.y + r.height / 2 } })
  const box = await page.$eval('#main', (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width } })
  const k = box.w / 1600
  await page.mouse.click(box.x + pt.x * k, box.y + pt.y * k)
  await f.evaluate(() => document.execCommand('selectAll'))
  await page.keyboard.type('Cash-Flow Copilot, edited by a person')
  await sleep(1200)
  r = await call('/api/edits')
  const e0 = r.json.edits[0]
  ok('person edit is recorded with before/after', r.json.edits.length === 1 && e0.before === 'AI Cash-Flow Copilot' && e0.after === 'Cash-Flow Copilot, edited by a person', JSON.stringify(e0))
  r = await call('/api/deck')
  const html0 = r.json.slides[0].html
  ok('edited text is saved into the slide HTML, editor artefacts stripped', html0.includes('Cash-Flow Copilot, edited by a person') && !html0.includes('data-kb') && !html0.includes('contenteditable'))
  await page.screenshot({ path: join(OUT, 'studio-edit.png') })

  // 5. the agent corrects: the studio flags the changed slide
  const corrected = JSON.parse(JSON.stringify(deck))
  corrected.slides[0].html = html0.replace('Cash-Flow Copilot, edited by a person', 'Cash-Flow Copilot for Small Business')
  r = await put(corrected)
  ok('agent correction bumps the version', r.json.version === 2, JSON.stringify(r.json))
  await page.waitForFunction("document.querySelector('#toast').textContent.startsWith('Agent updated')", { timeout: 6000 }).catch(() => {})
  const toast = await page.$eval('#toast', (el) => el.textContent)
  const newBadges = await page.$$eval('.thumb.new', (els) => els.length)
  ok('studio announces the agent change and badges the slide', /Agent updated slide 1/.test(toast) && newBadges === 1, `${toast} / ${newBadges} badge`)

  // 6. the chart slide draws
  await page.click('#rail .thumb:nth-child(4)')
  f = await mainFrame(3)
  await f.waitForFunction('window.__chartsReady === true', { timeout: 8000 })
  const drawn = await f.evaluate(() => { const c = document.querySelector('canvas'); return !!(c && c.__chart && c.width > 100) })
  ok('declarative chart renders inside the sandbox', drawn)
  await page.screenshot({ path: join(OUT, 'studio-chart.png') })
  await page.close()

  // 7. hostile slide HTML is neutralised
  r = await put({ slides: ['<section class="slide"><h2 onclick="x()">hi</h2><script>window.pwn=1</script><img src="x" onerror="alert(1)"><a href="javascript:alert(1)">l</a><iframe src="http://evil"></iframe></section>'] })
  const bad = (await call('/api/deck')).json.slides[0].html
  ok('script, inline handlers, javascript: links and iframes are stripped', !/<script|onerror|onclick|javascript:|<iframe/i.test(bad), bad.slice(0, 120))
  await put({ ...deck, clear_edits: true })

  // 8. PDF export
  let t = Date.now()
  r = await call('/api/export/pdf')
  const pages = (r.buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length
  writeFileSync(join(OUT, 'deck.pdf'), r.buf)
  ok('PDF export: one page per slide', r.status === 200 && pages === 7, `${pages} pages, ${(r.buf.length / 1024).toFixed(0)} KB, ${Date.now() - t} ms`)

  // 9. PPTX export
  t = Date.now()
  r = await call('/api/export/pptx')
  const pptx = join(OUT, 'deck.pptx')
  writeFileSync(pptx, r.buf)
  const names = execFileSync('unzip', ['-Z1', pptx]).toString().split('\n')
  const slideFiles = names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]))
  const notesFiles = names.filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n))
  ok('PPTX export: one slide per slide', r.status === 200 && slideFiles.length === 7, `${slideFiles.length} slides, ${notesFiles.length} notes, ${(r.buf.length / 1024).toFixed(0)} KB, ${Date.now() - t} ms`)
  console.log('\nPPTX content per slide (native text boxes/shapes vs pictures):')
  slideFiles.forEach((n, i) => {
    const xml = execFileSync('unzip', ['-p', pptx, n]).toString()
    const sp = (xml.match(/<p:sp>/g) || []).length; const pic = (xml.match(/<p:pic>/g) || []).length
    const runs = (xml.match(/<a:t>/g) || []).length; const gf = (xml.match(/<p:graphicFrame>/g) || []).length
    console.log(`  slide ${i + 1}: ${sp} shapes, ${pic} pictures, ${gf} tables, ${runs} text runs`)
  })
} finally {
  await browser.close()
  server.close()
}
console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`)
process.exit(failed === 0 ? 0 : 1)
