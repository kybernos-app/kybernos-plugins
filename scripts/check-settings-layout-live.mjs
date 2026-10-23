#!/usr/bin/env node
// Four layout faults of Settings, measured in a real GUI (audit R3-03): the Ollama tiles (R-A3-02), the open row of the nav against the
// hovered one and the heading of the switches block of General (C-06), Agent presets at a phone's width (R-A5-04).
//
//   source scripts/sandbox/env.sh && node scripts/check-settings-layout-live.mjs [--shots <dir>]
//
// Needs a DSH that serves this checkout (scripts/sandbox/start.sh). Refuses :3080 (exit 3). Read-only: it clicks nav entries and moves
// the pointer, nothing is installed, pulled or saved; the throw-away browser's own storage holds the little it changes (the Settings
// fold). The Ollama page is only looked at: the « Install », « Search for new models » and « Re-check » buttons are never pressed.
// Exit code 0 / 1 / 3.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, openSettings, waitFor, clickText } from './live-page.mjs'

const args = process.argv.slice(2)
const shotDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null
if (shotDir !== null) mkdirSync(shotDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 400))) } }

const host = process.env.KB_HOST || '127.0.0.1:3080'
if (host === '127.0.0.1:3080') { console.error('○ inconclusive: this check needs a DSH that serves this checkout (a sandbox instance), not the one on :3080. Set KB_HOST, DSH_HOME and HOME.'); process.exit(3) }

const live = await openLivePage({ width: 1400, height: 900 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const val = async (e, ms) => (await page.evalJs(e, ms || 8000)).val
const metrics = (width, height) => page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 })
const shot = async (name) => { if (shotDir === null) return; try { await page.shot(join(shotDir, name + '.png')) } catch (e) { /* no screenshot */ } }
const move = async (x, y) => { await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }) }
// Open Settings on a page, from a clean load at this size.
const openPage = async (width, height, cell) => {
  await metrics(width, height)
  await page.send('Page.reload', { ignoreCache: true })
  await waitFor(page, `document.readyState === 'complete' && document.querySelector('[class*="settingsArea"] button[class*="trigger"]') !== null`, 30000)
  if ((await openSettings(page, { minCells: 3 })) !== true) return false
  const clicked = await clickText(page, cell)
  await sleep(1800)
  return clicked
}

try {
  console.log('R-A3-02 · Ollama local models: the dot of a tile stays beside the first line of its text')
  if (await openPage(1400, 900, 'Ollama local models')) {
    const ready = await waitFor(page, `document.querySelectorAll('.kml-tuile').length === 3 && document.querySelectorAll('.kml-tuile .kbm-dot[data-state="done"]').length >= 1`, 25000)
    if (ready === null) check('the three tiles are drawn with a measured machine', false, await val(`document.querySelector('.kml-tuiles') ? document.querySelector('.kml-tuiles').innerText : 'no tiles'`))
    else {
      // A long chip name, as a « Pro » or « Max » chip reads (this machine's own chip is short): client-side text only.
      await val(`(() => { const b = document.querySelector('.kml-tuile .kml-tuile-ligne b'); if (b) b.textContent = 'Apple M3 Ultra · 192 GB RAM' })()`)
      const m = JSON.parse(await val(`(() => {
        const rr = (r) => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right })
        return JSON.stringify(Array.from(document.querySelectorAll('.kml-tuile')).map((t) => {
          const dot = t.querySelector('.kbm-dot'); const name = t.querySelector('.kml-tuile-ligne b')
          if (!dot || !name) return null
          const range = document.createRange(); range.selectNodeContents(name)
          const lines = Array.from(range.getClientRects())
          const first = lines.length > 0 ? lines.reduce((a, b) => (b.top < a.top ? b : a)) : name.getBoundingClientRect()
          return { name: name.textContent, dot: rr(dot.getBoundingClientRect()), first: rr(first), lines: new Set(lines.map((l) => Math.round(l.top))).size }
        }))
      })()`))
      const tiles = m.filter((x) => x !== null)
      check('the machine tile and the engine tile both carry a dot and a name', tiles.length === 2, m)
      for (const t of tiles) {
        const beside = t.dot.top >= t.first.top - 4 && t.dot.bottom <= t.first.bottom + 4 && t.dot.right <= t.first.left + 1
        check('« ' + t.name + ' »: the dot is left of the first line of the text, not above it', beside, t)
      }
      check('the long chip name does wrap in the tile (the case the audit measured)', tiles[0] !== undefined && tiles[0].lines >= 2, tiles[0])
      await shot('ollama-tiles')
    }
  } else console.log('  ○ the Ollama page did not open')

  console.log('C-06 · General: the open row is not the hovered row, and the switches have a heading')
  if (await openPage(1400, 900, 'General')) {
    await waitFor(page, `document.querySelector('[data-kbr="brain"]') !== null`, 20000)
    // A cell that is not the open one, and its place: the pointer goes there for real.
    const pick = JSON.parse(await val(`(() => {
      const cells = Array.from(document.querySelectorAll('button[class*="navCell"]')).filter((c) => { const r = c.getBoundingClientRect(); return r.width > 20 && r.height > 20 && r.top > 100 && r.bottom < innerHeight - 20 })
      const cur = cells.find((c) => c.getAttribute('aria-current') === 'true')
      const other = cells.find((c) => c !== cur && c.getAttribute('aria-current') !== 'true' && c.textContent.trim() !== '')
      if (!cur || !other) return JSON.stringify(null)
      const r = other.getBoundingClientRect()
      return JSON.stringify({ cur: cur.textContent.trim(), other: other.textContent.trim(), x: r.left + r.width / 2, y: r.top + r.height / 2 })
    })()`))
    if (pick === null) check('the nav shows the open row and another one', false)
    else {
      await move(pick.x, pick.y)
      await sleep(350)
      const look = JSON.parse(await val(`(() => {
        // The colour a person sees: the computed colour (any syntax) painted over the first opaque ancestor.
        const cv = document.createElement('canvas'); cv.width = cv.height = 1; const g = cv.getContext('2d', { willReadFrequently: true })
        const px = (css) => { g.clearRect(0, 0, 1, 1); g.fillStyle = '#000'; g.fillStyle = css; g.fillRect(0, 0, 1, 1); return Array.from(g.getImageData(0, 0, 1, 1).data) }
        const over = (fg, bg) => { const a = fg[3] / 255; return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)) }
        const under = (el) => { for (let e = el.parentElement; e; e = e.parentElement) { const c = px(getComputedStyle(e).backgroundColor); if (c[3] === 255) return c; if (c[3] > 0) return over(c, under(e)) } return [255, 255, 255, 255] }
        const paint = (el) => over(px(getComputedStyle(el).backgroundColor), under(el))
        const cells = Array.from(document.querySelectorAll('button[class*="navCell"]'))
        const cur = cells.find((c) => c.getAttribute('aria-current') === 'true')
        const other = cells.find((c) => c.textContent.trim() === ${JSON.stringify(pick.other)} && c.matches(':hover'))
        if (!cur || !other) return JSON.stringify({ missing: true, hovered: !!other })
        const a = paint(cur); const b = paint(other)
        return JSON.stringify({ cur: a.map(Math.round), hover: b.map(Math.round), diff: Math.round(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])), bar: getComputedStyle(cur).boxShadow, hoverBar: getComputedStyle(other).boxShadow })
      })()`))
      check('the pointer really is over another row of the nav (« ' + pick.other + ' »)', look.missing !== true, look)
      if (look.missing !== true) {
        // The engine marks the open row with a FILL only (`.navCell.active` in dsh-client-ui-settings-general; no
        // box-shadow anywhere): a bar is an option, not the rule. What must hold is that the open row reads as
        // clearly different from the hovered one — a bar on its edge OR a fill that is no longer nearly the same.
        check('the open row is marked — a bar on its edge, or a clearly stronger fill than the hovered row', (look.bar !== 'none' && look.hoverBar === 'none') || look.diff >= 24, look)
      }
      await shot('nav-hover')
    }
    const head = JSON.parse(await val(`(() => {
      const t = document.querySelector('[data-kbr="behaviour-title"]'); const intro = Array.from(document.querySelectorAll('[data-kbr="bloc"] > *')).find((e) => /Small switches/.test(e.textContent || ''))
      const row = document.querySelector('[data-kbr="rename-after-recap"]'); const onb = document.querySelector('[data-kbr="onboarding-replay"]')
      if (!t) return JSON.stringify(null)
      const before = (a, b) => !!(a && b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING))
      return JSON.stringify({ text: t.textContent.trim(), tag: t.tagName, aboveIntro: before(t, intro), aboveSwitches: before(t, row), belowOnboarding: before(onb, t), size: parseFloat(getComputedStyle(t).fontSize) })
    })()`))
    check('a heading « Behaviour » sits above the sentence that introduces the switches, below the Onboarding row', head !== null && head.text === 'Behaviour' && head.aboveIntro === true && head.aboveSwitches === true && head.belowOnboarding === true, head)
    check('it reads as a heading (a title tag, larger than the 13 px sentences)', head !== null && /^H[1-6]$/.test(head.tag) && head.size >= 15, head)
    await move(5, 5)
    await shot('general-heading')
  } else console.log('  ○ General did not open')

  console.log('R-A5-04 · Agent presets: no inner sideways scroll and no cut label, at 390 px and at 1400 px')
  for (const [w, h] of [[390, 844], [1400, 900]]) {
    if (!(await openPage(w, h, 'Agent presets'))) { console.log('  ○ Agent presets did not open at ' + w); continue }
    await waitFor(page, `document.querySelector('.kbhi-mm') !== null`, 15000)
    const m = JSON.parse(await val(`(() => {
      const opt = document.querySelector('[class$="_options"]')
      const labels = Array.from(document.querySelectorAll('.kbhi-mm-acts > *')).map((e) => ({ t: e.textContent, sw: e.scrollWidth, cw: e.clientWidth }))
      const acts = document.querySelector('.kbhi-mm-acts'); const row = document.querySelector('.kbhi-mm-row.hot'); const tr = document.querySelector('.kbhi-mm-track'); const txt = document.querySelector('.kbhi-mm-i')
      const ar = acts ? acts.getBoundingClientRect() : null; const rr = row ? row.getBoundingClientRect() : null; const tt = tr ? tr.getBoundingClientRect() : null; const xx = txt ? txt.getBoundingClientRect() : null
      return JSON.stringify({ opt: opt ? { sw: opt.scrollWidth, cw: opt.clientWidth, ox: getComputedStyle(opt).overflowX } : null, labels, actsInRow: !!(ar && rr && ar.right <= rr.right + 0.5 && ar.left >= rr.left), trackClear: !!(tt && ar && tt.right <= ar.left + 0.5), trackInText: !!(tt && xx && tt.left >= xx.left - 1 && tt.right <= xx.right + 1) })
    })()`))
    // A pane scrolls sideways when its overflow-x can scroll AND its content is wider (a clipped overflow, `hidden`, keeps the page still).
    check(w + ' px: the options pane does not scroll sideways', m.opt !== null && (!/(auto|scroll)/.test(m.opt.ox) || m.opt.sw <= m.opt.cw + 1), m.opt)
    // The mock types one label at a time (measured on 2026-10-21: 1 label on screen, 113 px client = 113 px scroll):
    // the fault it guards against is a CUT label, not a count of four.
    check(w + ' px: the label of the animated mock shows in full (« Create with the agent » was cut)', m.labels.length >= 1 && m.labels.every((l) => l.sw <= l.cw + 1), m.labels)
    check(w + ' px: the buttons stay inside their row and the progress bar ends before them', m.actsInRow === true && m.trackClear === true && m.trackInText === true, m)
    if (w === 390) await shot('presets-390')
  }
} catch (e) {
  fail += 1
  console.log('  ✗ the check stopped: ' + e.message)
} finally {
  await live.close()
}
console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)
