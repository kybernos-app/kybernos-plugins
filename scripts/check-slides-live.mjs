#!/usr/bin/env node
// The Slides panel in a real GUI: thumbnails and the text editor (audit A4-03, A4-04).
//
//   source scripts/sandbox/env.sh && node scripts/check-slides-live.mjs [--shots <dir>]
//
// Needs a DSH that serves this checkout (scripts/sandbox/start.sh); refuses :3080 and any DSH home that is not a sandbox's.
// It plays the panel's own demo deck ("Voir la démo"); nothing else is read or written beyond the sandbox's own slides state.
//
// What it proves:
//   - R3-01: while the editor is open the tool bar stays reachable (the five tools are the element under their own centre), on the title
//     and on the bottom-most field, and the editor stays inside the stage; the transport bar is Start / Play / End + 0.5× 1× 2× 4× + a Done pill;
//   - the thumbnail of a « statement » slide shows its title, as the stage does (it showed only the kicker);
//   - double-clicking a field twice leaves ONE editor, and Escape closes it, and the tool bar is not covered;
//   - clicking away from the editor commits what was typed (it used to leave the text silently lost, the editor open).
// Exit code 0 / 1 / 3 (3 = inconclusive: no sandbox).
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage } from './live-page.mjs'

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

const live = await openLivePage({ width: 1500, height: 950 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const val = async (expr, ms) => (await page.evalJs(expr, ms)).val
const shot = async (name) => { if (shotDir !== null) { try { mkdirSync(shotDir, { recursive: true }); await page.shot(join(shotDir, name + '.png')) } catch (e) { /* no screenshot */ } } }
const poll = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(250) } return null }
const q = (sel) => val(`document.querySelectorAll(${JSON.stringify(sel)}).length`)
const press = async (x, y, count) => {
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: count })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: count })
}
const centre = async (js) => { const p = await val(`(() => { const e = (${js}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) })()`); return typeof p === 'string' ? JSON.parse(p) : null }
const click = async (js) => { const c = await centre(js); if (c === null) return false; await press(c.x, c.y, 1); await sleep(300); return true }
const dblclick = async (js) => { const c = await centre(js); if (c === null) return false; await press(c.x, c.y, 1); await press(c.x, c.y, 2); await sleep(500); return true }
const key = async (k, code, vk) => { await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }) }
const field = (text) => `Array.from(document.querySelectorAll('.kbsd-slide .kbsd-champ')).find((e) => e.innerText.trim().startsWith(${JSON.stringify(text)}))`
const slideNo = (n) => `document.querySelectorAll('.kbsd-vignettes .kbsd-vign')[${n - 1}]`

// A fresh instance (the sandbox) greets with a « Get started » dialog whose mask swallows every click: close it.
const dismissGetStarted = () => val(`(() => { const b = Array.from(document.querySelectorAll('button[aria-label="Close"]')).find((x) => /Get started/.test(((x.closest('[class*="_root_"]') || x.parentElement || {}).innerText) || '')); if (!b) return false; b.click(); return true })()`)

try {
  await sleep(2500)
  await dismissGetStarted()
  await sleep(500)
  // The layout and the deck survive in the sandbox from one run to the next: each step does only what is still to do.
  await val(`(() => { const b = document.querySelector('button[aria-label="Open right sidebar"]'); if (b) b.click() })()`)
  await sleep(1200)
  // The start list of the right pane: the « Slides » row after the sidebar's own « Collapse » button.
  const openTab = () => val(`(() => { const all = Array.from(document.querySelectorAll('button')); const i = all.findIndex((b) => b.getAttribute('aria-label') === 'Collapse right sidebar'); const b = all.slice(i).find((x) => x.innerText.trim() === 'Slides'); if (!b) return false; b.click(); return true })()`)
  if ((await q('.kbsd-root')) === 0) await openTab()
  check('the Slides panel is open', (await poll(() => q('.kbsd-root'))) !== null)
  if ((await q('.kbsd-vignettes .kbsd-vign')) === 0) await click(`document.querySelector('.kbsd-demo')`)
  check('the demo deck is there (5 slides)', (await poll(() => q('.kbsd-vignettes .kbsd-vign').then((n) => n === 5), 15000)) !== null)
  await sleep(11000) // the demo writes its five slides in about nine seconds

  console.log('\n── A4-03 · thumbnails ──')
  const thumb2 = await val(`(document.querySelectorAll('.kbsd-vignettes .kbsd-vign')[1] || { innerText: '' }).innerText`)
  check('the thumbnail of the « statement » slide shows its title, like the stage', /Shells should come prepared\./.test(thumb2), thumb2)
  await shot('slides-thumbnails')

  console.log('\n── A4-04 · one editor at a time ──')
  check('slide 1 is shown', (await click(slideNo(1))) === true)
  check('a double-click on the title opens the editor (no tool needs choosing)', (await dblclick(field('Rain is a given.'))) === true && (await poll(() => q('.kbsd-ebox'))) !== null)
  check('one editor is open', (await q('.kbsd-ebox')) === 1, await q('.kbsd-ebox'))
  check('...a second double-click on the same field leaves exactly one editor', (await dblclick(field('Rain is a given.'))) === true && (await q('.kbsd-ebox')) === 1, await q('.kbsd-ebox'))
  await shot('slides-one-editor')
  // R3-01 (A4-02): while the editor is open, every tool of the bar is still the element under its own centre, and the editor sits
  // inside the stage without touching the bar (the format palette used to cover Text / Brush / Eraser / Clear all until Escape).
  const geometry = `(() => {
    const tools = Array.from(document.querySelectorAll('.kbsd-outil'))
    const hit = tools.map((b) => { const r = b.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { label: b.innerText.trim(), ok: !!e && e.closest('.kbsd-outil') === b } })
    const bar = document.querySelector('.kbsd-outils').getBoundingClientRect()
    const wrap = document.querySelector('.kbsd-wrap').getBoundingClientRect()
    const box = document.querySelector('.kbsd-ebox').closest('div[style*="position: absolute"]').getBoundingClientRect()
    const overlap = box.left < bar.right && box.right > bar.left && box.top < bar.bottom && box.bottom > bar.top
    const inside = box.left >= wrap.left - 1 && box.right <= wrap.right + 1 && box.top >= wrap.top - 1 && box.bottom <= wrap.bottom + 1
    return JSON.stringify({ hit, overlap, inside, box: [box.left, box.top, box.right, box.bottom].map(Math.round), bar: [bar.left, bar.top, bar.right, bar.bottom].map(Math.round) })
  })()`
  const g1 = JSON.parse(await val(geometry))
  check('while editing the title, the five tools are reachable (Text, Brush, Eraser, Clear all and View)', g1.hit.length === 5 && g1.hit.every((x) => x.ok), g1.hit)
  check('...and the editor does not touch the tool bar, and stays inside the stage', g1.overlap === false && g1.inside === true, g1)
  await key('Escape', 'Escape', 27)
  await sleep(500)
  check('Escape closes it: no editor is left behind', (await q('.kbsd-ebox')) === 0, await q('.kbsd-ebox'))
  // the bottom-most field of the slide (a note or the footer line), so the editor goes ABOVE it
  const bottomField = `Array.from(document.querySelectorAll('.kbsd-slide .kbsd-champ')).sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0]`
  check('a double-click on the bottom-most field opens the editor too', (await dblclick(bottomField)) === true && (await poll(() => q('.kbsd-ebox'))) !== null)
  const g2 = JSON.parse(await val(geometry))
  check('...with the five tools still reachable, the editor clear of the bar and inside the stage', g2.hit.length === 5 && g2.hit.every((x) => x.ok) && g2.overlap === false && g2.inside === true, g2)
  await shot('slides-editor-bottom')
  await key('Escape', 'Escape', 27)
  await sleep(500)
  const tool = await centre(`Array.from(document.querySelectorAll('.kbsd-outil')).find((b) => /Text/.test(b.innerText))`)
  const covered = tool === null ? null : await val(`(() => { const e = document.elementFromPoint(${tool ? tool.x : 0}, ${tool ? tool.y : 0}); return !!e && !!e.closest('.kbsd-outil') })()`)
  check('the tool bar is reachable again (the Text tool is the element under its own centre)', covered === true, { tool, covered })

  console.log('\n── A4-26 · the transport bar ──')
  const bar = JSON.parse(await val(`(() => {
    const line = document.querySelector('.kbsd-bar .kbsd-line')
    if (!line) return 'null'
    const buttons = Array.from(line.querySelectorAll('button')).map((b) => b.title || b.innerText.trim())
    const pill = line.querySelector('.kbsd-badge')
    const lab = document.querySelector('.kbsd-bar .kbsd-lab')
    return JSON.stringify({ buttons, pill: pill ? pill.innerText.trim() : null, lab: lab ? lab.innerText.trim() : null, head: Array.from(document.querySelectorAll('.kbsd-head .kbsd-badge')).map((x) => x.innerText.trim()) })
  })()`))
  check('the bar is Start, Play, End, 0.5× 1× 2× 4×', bar !== null && JSON.stringify(bar.buttons) === JSON.stringify(['Start', 'Replay the writing', 'End', '0.5×', '1×', '2×', '4×']), bar)
  check('the deck has finished writing: the pill says Done and the head says nothing like « live »', bar !== null && bar.pill === 'Done' && !bar.head.some((x) => /live/i.test(x)), bar)
  check('the counter reads « n / 5 slides »', bar !== null && /^\d+ \/ 5 slides$/.test(bar.lab), bar)
  await shot('slides-transport')

  console.log('\n── A4-04 · clicking away commits ──')
  check('a double-click opens the editor on the title', (await dblclick(field('Rain is a given.'))) === true && (await q('.kbsd-ebox')) === 1)
  await sleep(300)
  await page.send('Input.insertText', { text: ' ZZ' })
  await sleep(200)
  check('a click outside the editor (on the thumbnail strip)', (await click(slideNo(1))) === true)
  await sleep(600)
  check('...closes it', (await q('.kbsd-ebox')) === 0, await q('.kbsd-ebox'))
  const typed = await val(`(() => { const e = Array.from(document.querySelectorAll('.kbsd-slide .kbsd-champ')).find((x) => /Rain is a given/.test(x.innerText)); return e ? e.innerText.trim() : null })()`)
  check('...and keeps what was typed', typeof typed === 'string' && /ZZ/.test(typed), typed)
  await shot('slides-committed')
} catch (e) {
  fail += 1
  console.log('  ✗ the check stopped: ' + (e && e.message ? e.message : e))
} finally {
  await live.close()
}
console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + ', ' + pass + ' passed')
process.exit(fail === 0 ? 0 : 1)
