#!/usr/bin/env node
// The thinking-animation picker on the REAL GUI (read-only): the catalogue of drawings, small cards, every drawing animated.
//
//   node scripts/check-animations-live.mjs [--shots <dir>]
//
// What is real: the DSH page, Settings › Theme › Animation, the « Add an animation » window. What is swapped (scripts/lib-bundle-swap.mjs,
// in a throw-away Chrome): the kybernos-theme client, from this checkout instead of the shared tree. Nothing is added or removed: the
// window is only opened and read, and the host's boot post is answered here, never forwarded.
//
// Exit 0 all good, 1 a check failed, 3 not run (no GUI).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, waitFor, clickText, openSettings, openThemeAdvanced } from './live-page.mjs'
import { swapBundles } from './lib-bundle-swap.mjs'

const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
const failures = []
const check = (label, cond, detail) => {
  if (cond) { pass += 1; console.log('  ✓ ' + label) } else { failures.push(label); console.log('  ✗ ' + label + (detail === undefined ? '' : '  — ' + JSON.stringify(detail).slice(0, 300))) }
}

const live = await openLivePage({ width: 1300, height: 1000 }).catch((e) => { console.error('○ not run: ' + e.message); process.exit(3) })
const { page } = live
const ev = async (js) => (await page.evalJs(js, 8000)).val
const shot = async (name, sel) => {
  if (shotsDir === null) return
  try {
    mkdirSync(shotsDir, { recursive: true })
    const box = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height } })()`)
    const args = { format: 'png' }
    if (box) args.clip = { x: Math.max(0, box.x), y: Math.max(0, box.y), width: Math.max(10, box.width), height: Math.max(10, box.height), scale: 2 }
    const r = await page.send('Page.captureScreenshot', args)
    writeFileSync(join(shotsDir, name + '.png'), Buffer.from(r.result.data, 'base64'))
  } catch (e) { console.log('     (no screenshot: ' + e.message + ')') }
}

try {
  await page.send('Runtime.enable', {})
  page.on('Fetch.requestPaused', async (p) => {
    if (p.request.url.indexOf('kybernos-theme/boot') < 0 || p.responseStatusCode !== undefined) return
    try { await page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: Buffer.from('{"ok":true}').toString('base64') }) } catch (e) { /* page gone */ }
  })
  const swap = await swapBundles(page, [{ name: 'kybernos-theme' }], { extraPatterns: [{ urlPattern: '*kybernos-theme/boot*', requestStage: 'Request' }] })
  await page.send('Page.reload', { ignoreCache: true })
  await sleep(3000)
  await waitFor(page, `document.readyState === 'complete'`, 30000)
  check('the theme client was found in the served bundle and swapped', swap.report().every((r) => r.replaced === true), swap.report())

  console.log('Animation picker — this checkout in the real GUI')
  const opened = await openSettings(page, { tries: 3 })
  check('Settings open', opened === true)
  if (opened === true) {
    await clickText(page, 'Theme')
    await sleep(1200)
    await openThemeAdvanced(page) // the tabs sit in the Advanced editor, folded under the simple view
    const tab = (await clickText(page, 'Animation')) || (await clickText(page, 'Animations'))
    check('the Animation tab opens', tab === true)
    await sleep(1000)
    const btn = await waitFor(page, `!!document.querySelector('[data-kb="ld-open-picker"]')`, 12000)
    check('the « Add an animation » button is there', btn !== null)
    if (btn !== null) {
      await ev(`document.querySelector('[data-kb="ld-open-picker"]').click()`)
      await waitFor(page, `!!document.querySelector('[data-kb="ld-picker"] .kbth-lcard')`, 12000)
      await sleep(900)
      const st = await ev(`(() => {
        const cards = Array.from(document.querySelectorAll('[data-kb="ld-picker"] .kbth-lcard'))
        const w = cards.map((c) => Math.round(c.getBoundingClientRect().width))
        const h = cards.map((c) => Math.round(c.getBoundingClientRect().height))
        const anims = cards.map((c) => c.querySelectorAll('svg').length > 0 && c.querySelector('svg').getAnimations({ subtree: true }).length)
        return { n: cards.length, w: [Math.min(...w), Math.max(...w)], h: [Math.min(...h), Math.max(...h)], still: cards.filter((c, i) => !anims[i]).map((c) => c.getAttribute('data-id')) }
      })()`)
      check('the picker lists the 34 examples', st.n === 34, st)
      check('the cards are small (at most 120 px wide, 140 px tall)', st.w[1] <= 120 && st.h[1] <= 140, st)
      check('every drawing is running an animation', st.still.length === 0, st.still)
      await shot('picker', '[data-kb="ld-picker"]')
      await ev(`(() => { const b = document.querySelector('[data-kb="ld-picker"] .kbth-mbody'); if (b) b.scrollTop = b.scrollHeight })()`)
      await sleep(700)
      await shot('picker-end', '[data-kb="ld-picker"]')
    }
  }
} finally {
  await live.close()
}

console.log('\n' + (failures.length === 0 ? '✓ ' + pass + ' checks passed' : '✗ ' + failures.length + ' failed of ' + (pass + failures.length)))
process.exit(failures.length === 0 ? 0 : 1)
