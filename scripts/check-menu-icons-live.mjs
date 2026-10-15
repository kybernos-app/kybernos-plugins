#!/usr/bin/env node
// The menu icon sets on the REAL GUI (read-only): the sidebar draws its entries through the registry of kybernos-theme,
// grey at rest and in the entry's colour on the open page, and the Theme page offers the sets.
//
//   node scripts/check-menu-icons-live.mjs [--shots <dir>]
//
// What is real: the DSH page, the sidebar, Settings › Theme. What is swapped (scripts/lib-bundle-swap.mjs, in a throw-away
// Chrome): the kybernos-theme and kybernos-plugin clients, from this checkout instead of the shared tree.
// What is NOT done: no card of the Theme page is clicked. A click goes through `commit`, which writes DSH's own theme preference
// and text size (setTheme / setFontSize): that would change the owner's real settings. The sets are switched through the registry
// (`window.__KB_ICONSETS__.set`), which is what `commit` ends in; the host's boot post is answered here, never forwarded.
//
// Exit 0 all good, 1 a check failed, 3 not run (no GUI).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, waitFor, clickText, openSettings } from './live-page.mjs'
import { swapBundles } from './lib-bundle-swap.mjs'

const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
const failures = []
const check = (label, cond, detail) => {
  if (cond) { pass += 1; console.log('  ✓ ' + label) } else { failures.push(label); console.log('  ✗ ' + label + (detail === undefined ? '' : '  — ' + JSON.stringify(detail).slice(0, 300))) }
}

const live = await openLivePage({ width: 1400, height: 900 }).catch((e) => { console.error('○ not run: ' + e.message); process.exit(3) })
const { page } = live
const ev = async (js) => (await page.evalJs(js, 8000)).val
const shot = async (name, sel) => {
  if (shotsDir === null) return
  try {
    mkdirSync(shotsDir, { recursive: true })
    const box = sel ? await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'start' }); const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height } })()`) : null
    const args = { format: 'png' }
    if (box) args.clip = { x: Math.max(0, box.x), y: Math.max(0, box.y), width: Math.max(10, box.width), height: Math.max(10, box.height), scale: 2 }
    await sleep(250)
    const r = await page.send('Page.captureScreenshot', args)
    writeFileSync(join(shotsDir, name + '.png'), Buffer.from(r.result.data, 'base64'))
  } catch (e) { console.log('     (no screenshot: ' + e.message + ')') }
}

try {
  await page.send('Runtime.enable', {})
  // The theme plugin tells the host what it painted at activation; this browser is not the owner's, so the host is not told.
  page.on('Fetch.requestPaused', async (p) => {
    if (p.request.url.indexOf('kybernos-theme/boot') < 0 || p.responseStatusCode !== undefined) return
    try { await page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: Buffer.from('{"ok":true}').toString('base64') }) } catch (e) { /* page gone */ }
  })
  const swap = await swapBundles(page, [{ name: 'kybernos-theme' }, { name: 'kybernos-plugin' }], { extraPatterns: [{ urlPattern: '*kybernos-theme/boot*', requestStage: 'Request' }] })
  await page.send('Page.reload', { ignoreCache: true })
  await sleep(3000)
  await waitFor(page, `document.querySelectorAll('.kb4-menu .kb4-item').length >= 4`, 40000)
  check('the theme and plugin clients were found in the served bundle and swapped', swap.report().every((r) => r.replaced === true), swap.report())

  console.log('Menu icon sets — this checkout in the real GUI')
  const rows = await ev(`document.querySelectorAll('.kb4-menu .kb4-item').length`)
  check('the sidebar menu has its rows (' + rows + ')', rows >= 4, rows)
  check('the registry is published, on « classic », with twelve sets', await ev(`!!window.__KB_ICONSETS__ && window.__KB_ICONSETS__.current() === 'classic' && window.__KB_ICONSETS__.sets.length === 12`))
  check('classic: the rows keep the line icons (no set drawing)', await ev(`document.querySelectorAll('.kb4-menu .kb4-isvg').length === 0 && document.querySelectorAll('.kb4-menu .kb4-ico svg').length >= 4`))
  check('the line icons are lent to the theme page', await ev(`typeof window.__KB_MENU_CLASSIC__ === 'function' && /^<svg/.test(window.__KB_MENU_CLASSIC__('cloud', 18) || '')`))
  await shot('classic', '.kb4-menu')

  // Every other set, through the registry. A page is open (Skills) so one row shows its colour.
  await clickText(page, 'Skills', { within: '.kb4-menu' })
  await sleep(700)
  const sets = await ev(`window.__KB_ICONSETS__.sets.map((s) => s.id).filter((i) => i !== 'classic')`)
  for (const id of sets) {
    await ev(`window.__KB_ICONSETS__.set(${JSON.stringify(id)})`)
    await sleep(350)
    const st = await ev(`(() => {
      const ico = Array.from(document.querySelectorAll('.kb4-menu .kb4-item'))
      const drawn = ico.filter((i) => i.querySelector('.kb4-isvg svg'))
      const on = document.querySelector('.kb4-menu .kb4-item.on .kb4-isvg')
      return { rows: ico.length, drawn: drawn.length, attr: document.documentElement.getAttribute('data-kb-icons'),
        on: on ? on.innerHTML : null, rest: drawn.filter((i) => !i.classList.contains('on')).every((i) => !/#[0-9a-f]{6}/i.test(i.querySelector('.kb4-isvg').innerHTML.replace(/#fff\\b/g, ''))),
        box: (() => { const s = document.querySelector('.kb4-menu .kb4-isvg'); const r = s ? s.getBoundingClientRect() : null; return r ? [Math.round(r.width), Math.round(r.height)] : null })() }
    })()`)
    check(id + ': every row that has an entry is redrawn (' + st.drawn + ' of ' + st.rows + '), 16 px', st.drawn >= 4 && st.attr === id && st.box !== null && st.box[0] === 16 && st.box[1] === 16, st)
    check(id + ': the open page (Skills) is in its colour, the others are not coloured', st.on !== null && /#10b981/i.test(st.on) && st.rest === true, { on: st.on && st.on.slice(0, 120), rest: st.rest })
    await shot('menu-' + id, '.kb4-menu')
  }
  await ev(`window.__KB_ICONSETS__.set('classic')`)
  await sleep(300)
  check('back on classic the line icons are back', await ev(`document.querySelectorAll('.kb4-menu .kb4-isvg').length === 0`))

  // The Theme page: the picker is there with a preview per set. Nothing is clicked in it.
  const opened = await openSettings(page, { tries: 3 })
  check('Settings open', opened === true)
  if (opened === true) {
    await clickText(page, 'Theme')
    await sleep(1500)
    // The picker is in the Essentiel tab, which is the default one.
    const found = await waitFor(page, `document.querySelectorAll('[data-kb="theme-icset"]').length > 0`, 12000)
    check('the Theme page has « Menu icons » with twelve set cards', found !== null && (await ev(`document.querySelectorAll('[data-kb="theme-icset"]').length`)) === 12)
    check('every card shows nine drawings in two rows (rest, then colour)', await ev(`Array.from(document.querySelectorAll('[data-kb="theme-icset"]')).every((c) => c.querySelectorAll('.kbth-icset-i svg').length === 18)`))
    check('the current set (classic) is the pressed one', await ev(`(() => { const on = Array.from(document.querySelectorAll('[data-kb="theme-icset"]')).filter((c) => c.getAttribute('aria-checked') === 'true'); return on.length === 1 && on[0].getAttribute('data-id') === 'classic' })()`))
    await shot('theme-page', '[data-kb="theme-icons"]')
  }
} finally {
  await live.close()
}

console.log('\n' + (failures.length === 0 ? '✓ ' + pass + ' checks passed' : '✗ ' + failures.length + ' failed of ' + (pass + failures.length)))
process.exit(failures.length === 0 ? 0 : 1)
