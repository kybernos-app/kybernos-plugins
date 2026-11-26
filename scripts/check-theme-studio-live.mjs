#!/usr/bin/env node
// The simple view of the Theme page (the « look studio », packages/kybernos-theme) in a REAL GUI: a small DSH drawn from the look in use,
// eleven parts to click, thirteen panels, five vibes, Surprise me, Undo / Reset, Save / Export / Import, and what each choice does to the
// real application (tokens, the font, the effects sheet, the animation store, the disk copy of « My themes »).
//
//   source scripts/sandbox/env.sh && node scripts/check-theme-studio-live.mjs [--shots <dir>]
//
// Run it on the SANDBOX (scripts/sandbox): a click on a mode card or a size goes through `commit`, which writes DSH's own theme preference
// and text size into the profile of the DSH it talks to. On the owner's real DSH that would change their settings, so this script refuses
// to run there (exit 3). The sandbox serves this checkout, so no bundle is swapped.
//
// A conversation is not needed: the two markers DSH puts on a message (`data-chat-flow-kind="user"`, `data-chat-group-part="response"`) are
// reproduced by a small probe in the page, whose bubble and text are painted with the same variables DSH's own bubble uses
// (`--dsw-specific-bubble`, `--dsw-alias-label-primary`). The real markers were read on a real conversation (2026-10-22).
//
// Exit 0 all good, 1 a check failed, 3 not run (no GUI, or not the sandbox).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, waitFor, openSettings, clickText } from './live-page.mjs'

const shotsDir = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
if (!process.env.KB_HOST || /:3080$/.test(process.env.KB_HOST)) {
  console.error('○ not run: this check clicks the mode and the text size, which DSH keeps in its profile. Run it on the sandbox: source scripts/sandbox/env.sh && node scripts/check-theme-studio-live.mjs')
  process.exit(3)
}
let pass = 0
const failures = []
const check = (label, cond, detail) => {
  if (cond === true) { pass += 1; console.log('  ✓ ' + label) } else { failures.push(label); console.log('  ✗ ' + label + (detail === undefined ? '' : '  — ' + JSON.stringify(detail).slice(0, 360))) }
}
const live = await openLivePage({ width: 1400, height: 1000 }).catch((e) => { console.error('○ not run: ' + e.message); process.exit(3) })
const { page } = live
const ev = async (js, ms = 12000) => { const r = await page.evalJs(js, ms); return r.err !== undefined ? { err: r.err } : r.val }
const STORE = 'kybernos.theme.v1'
const LDK = 'kybernos.theme.loader.v1'
const LIB = 'kybernos.theme.presets.v1'
const state = () => ev(`JSON.parse(localStorage.getItem(${JSON.stringify(STORE)}) || '{}')`)
const loopState = () => ev(`JSON.parse(localStorage.getItem(${JSON.stringify(LDK)}) || '{}')`)
const body = (n) => ev(`getComputedStyle(document.body).getPropertyValue(${JSON.stringify(n)}).trim()`)
const shot = async (name) => {
  if (shotsDir === null) return
  try { mkdirSync(shotsDir, { recursive: true }); const r = await page.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(shotsDir, name + '.png'), Buffer.from(r.result.data, 'base64')) } catch (e) { console.log('     (no screenshot: ' + e.message + ')') }
}
/** A real mouse click at the centre of the first element that matches. */
const click = async (sel) => {
  const r = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } })()`)
  if (r === null || r === undefined || r.err !== undefined) throw new Error('nothing to click: ' + sel)
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 })
  await sleep(250)
  return true
}
const key = async (k, code) => { await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: code || k }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: code || k }); await sleep(250) }
const Z = (z) => `[data-kb="theme-zone"][data-zone="${z}"]`
/** A real click on the empty bottom of the sidebar (its centre is a row, which is another part). */
const clickSidebarBottom = async () => {
  const r = await ev(`(() => { const b = document.querySelector('[data-kb="theme-zone"][data-zone="sidebar"]').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.bottom - 14 } })()`)
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 })
  await sleep(250)
}
/** A button of the segmented control that sits in the row with this label (two rows can both have a « Soft »). */
const pressSeg = (row, text) => ev(`(() => { const r = Array.from(document.querySelectorAll('[data-kb="theme-st-panel"] .kbth-row')).find((x) => (x.querySelector('.kbth-lb') || {}).textContent === ${JSON.stringify(row)}); const b = r && Array.from(r.querySelectorAll('button')).find((x) => x.textContent === ${JSON.stringify(text)}); if (!b) return false; b.click(); return true })()`)
const panelTitle = () => ev(`(() => { const p = document.querySelector('[data-kb="theme-st-panel"]'); return p ? p.getAttribute('aria-label') : null })()`)
const openZone = async (z) => { await closePanel(); if (z === 'sidebar') await clickSidebarBottom(); else await click(Z(z)); await sleep(200); return panelTitle() }
const openChip = async (z) => { await closePanel(); await click(`[data-chip="${z}"]`); await sleep(200); return panelTitle() }
const closePanel = async () => { if ((await panelTitle()) !== null) { await click('[data-kb="theme-st-done"]'); await sleep(150) } }
const openMore = () => ev(`(() => { const d = document.querySelector('[data-kb="theme-st-panel"] details.kbth-st-more'); if (!d) return false; d.open = true; d.dispatchEvent(new Event('toggle')); return true })()`)
const slide = (label, v) => ev(`(() => { const i = Array.from(document.querySelectorAll('[data-kb="theme-st-panel"] input[type=range]')).find((x) => x.getAttribute('aria-label') === ${JSON.stringify(label)}); if (!i) return false; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(String(v))}); i.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
const typeIn = (sel, text) => ev(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); if (!i) return false; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(text)}); i.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
const rowRgb = (css) => {
  const h = /^#([0-9a-f]{6})/i.exec(css)
  if (h !== null) return [parseInt(h[1].slice(0, 2), 16), parseInt(h[1].slice(2, 4), 16), parseInt(h[1].slice(4, 6), 16)]
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css) || []
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

// An empty start: the browser's copies and the sandbox's disk copies of My themes and My animations (a thin « put » of an empty library, then deletes).
const host = (route, body) => ev(`(async () => { const r = await fetch(new URL('kybernos-theme/' + ${JSON.stringify(route)}, document.baseURI).pathname, ${body === undefined ? 'undefined' : `{ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(${JSON.stringify(body)}) }`}); return r.json().catch(() => null) })()`)
const wipe = async () => {
  await host('preset-store', { library: { v: 1, updatedAt: Date.now() + 1000, presets: [] } })
  const st = await host('loader-store')
  for (const l of ((st && st.loaders) || [])) await host('loader-store', { op: 'delete-loader', id: l.id })
  await host('loader-store', { op: 'put-words', words: [] })
  await ev(`localStorage.removeItem(${JSON.stringify(STORE)}); localStorage.removeItem(${JSON.stringify(LIB)}); localStorage.removeItem(${JSON.stringify(LDK)}); localStorage.removeItem('kybernos.theme.loader.cache.v1')`)
}

try {
  await page.send('Runtime.enable', {})
  // The theme plugin tells the host what it painted (the boot sheet of the next load); this browser is a throw-away one, and the sandbox's other checks
  // must not find a look of this one in it: the post is answered here, never forwarded.
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*kybernos-theme/boot*', requestStage: 'Request' }] })
  page.on('Fetch.requestPaused', async (p) => { try { await page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: Buffer.from('{"ok":true}').toString('base64') }) } catch (e) { /* gone */ } })
  const errors = []
  page.on('Runtime.exceptionThrown', (p) => { errors.push(String((p.exceptionDetails && (p.exceptionDetails.exception && p.exceptionDetails.exception.description || p.exceptionDetails.text)) || 'exception').slice(0, 200)) })
  await sleep(2500)
  check('the page opens (settings dialog)', (await openSettings(page)) === true)
  for (const l of ['Theme', 'Thème']) { if ((await clickText(page, l)) === true) break }
  const there = await waitFor(page, `!!document.querySelector('[data-kb="theme-studio"]')`, 20000)
  check('Settings › Theme shows the simple view', there !== null)
  await sleep(1500)
  await wipe()
  await page.send('Page.reload', { ignoreCache: true })
  await sleep(2500)
  check('after the wipe, the page opens on the studio again', (await openSettings(page)) === true)
  for (const l of ['Theme', 'Thème']) { if ((await clickText(page, l)) === true) break }
  await waitFor(page, `!!document.querySelector('[data-kb="theme-studio"]')`, 20000)
  await sleep(1200)
  // a probe for the two markers DSH puts on a message
  await ev(`document.body.insertAdjacentHTML('beforeend', '<div id="kb-probe" style="position:fixed;left:-9999px;top:0"><div data-chat-flow-kind="user"><div id="kb-pb" style="background:var(--dsw-specific-bubble);color:var(--dsw-alias-label-primary)">hello</div></div><div data-chat-group-part="response" id="kb-pr"><p id="kb-pt" style="color:var(--dsw-alias-label-primary)">reply</p></div></div>')`)
  // the composer dock chips are ours: a probe of the three roots
  await ev(`document.body.insertAdjacentHTML('beforeend', '<div data-slot="conversation.composer.dock" id="kb-dock" style="position:fixed;left:-9999px;top:40px"><span class="kbs-popwrap" data-kb="status-pill" id="kb-d1">a</span><span data-kb="changes" id="kb-d2">b</span><span class="kbus-wrap" data-kb="usage-chip" id="kb-d3">c</span></div>')`)

  console.log('The page')
  check('five vibes, Surprise me, the window, three chips, the actions, My looks', await ev(`document.querySelectorAll('[data-kb="theme-st-vibe"]').length === 5 && !!document.querySelector('[data-kb="theme-st-surprise"]') && !!document.querySelector('[data-kb="theme-st-window"]') && document.querySelectorAll('[data-chip]').length === 3 && !!document.querySelector('[data-kb="theme-st-save"]') && !!document.querySelector('[data-kb="theme-st-looks"]')`))
  check('eleven parts can be clicked, each is a button with a name', await ev(`(() => { const z = Array.from(document.querySelectorAll('[data-kb="theme-zone"]')); const ids = new Set(z.map((e) => e.getAttribute('data-zone'))); return ids.size === 11 && z.every((e) => e.getAttribute('role') === 'button' && e.tabIndex === 0 && (e.getAttribute('aria-label') || '').length > 2) })()`))
  check('the window is drawn at a readable size, wide layout', await ev(`(() => { const r = document.querySelector('[data-kb="theme-st-window"]').getBoundingClientRect(); return r.width > 560 && r.height > 280 && !document.querySelector('.kbth-st').classList.contains('narrow') })()`))
  check('the editor of the nine tabs is folded under it', await ev(`(() => { const d = document.querySelector('[data-kb="theme-classic"]'); return !!d && d.open === false && !!d.querySelector('.kbth-adv-tab') })()`))
  check('no panel is open until a part is clicked', (await panelTitle()) === null)
  await shot('01-page')

  console.log('Panels: every part opens its own, inside the window')
  const titles = { mood: 'Light or dark?', style: 'Pick a style', accent: 'Accent color', sidebar: 'Sidebar', wall: 'Wallpaper', user: 'Your messages', agent: 'Agent replies', icons: 'Menu icons', think: 'Thinking animation', letters: 'Letters', widgets: 'Under the message box' }
  for (const z of Object.keys(titles)) {
    const t = await openZone(z)
    const box = await ev(`(() => { const p = document.querySelector('[data-kb="theme-st-panel"]'), w = document.querySelector('[data-kb="theme-st-window"]'); if (!p || !w) return null; const a = p.getBoundingClientRect(), b = w.getBoundingClientRect(); return { l: Math.round(a.left - b.left), r: Math.round(b.right - a.right), gap: Math.round(a.top - b.bottom) } })()`)
    check('« ' + titles[z] + ' » opens by a click on the ' + z + ' part, under the window (never over it), as wide as it', t === titles[z] && box !== null && box.gap >= 0 && Math.abs(box.l) <= 1 && Math.abs(box.r) <= 1, { t, box })
  }
  for (const [z, t] of [['effects', 'Effects and shape'], ['access', 'Accessibility']]) { const got = await openChip(z); check('« ' + t + ' » opens from its chip, under the window', got === t && (await ev(`document.querySelector('[data-kb="theme-st-panel"]').getBoundingClientRect().top >= document.querySelector('[data-kb="theme-st-window"]').getBoundingClientRect().bottom`)), got) }
  // What you change must stay in view while you change it: with the tallest panel open and scrolled to its end, the window is still on screen and nothing covers it.
  await openZone('think'); await openMore()
  await ev(`document.querySelector('[data-kb="theme-st-panel"]').scrollIntoView({ block: 'end' })`); await sleep(300)
  check('the window stays in view, uncovered, while the tallest panel is scrolled to its end', await ev(`(() => { const w = document.querySelector('[data-kb="theme-st-window"]'); const r = w.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + 60); return r.top >= 0 && r.bottom <= innerHeight && !!e && w.contains(e) })()`))
  await shot('00-window-stays')
  await closePanel()
  await closePanel()
  // Escape and outside press
  await click(Z('mood')); await key('Escape')
  check('Escape closes the panel and the focus comes back to the part', (await panelTitle()) === null && await ev(`document.activeElement && document.activeElement.getAttribute('data-zone') === 'mood'`))
  await click(Z('mood')); await click('.kbth-st-hint')
  check('a press outside closes the panel', (await panelTitle()) === null)
  await ev(`document.querySelector(${JSON.stringify(Z('think'))}).focus()`); await key('Enter')
  check('the keyboard opens a part (Tab to it, Enter)', (await panelTitle()) === 'Thinking animation')
  await closePanel()

  console.log('Light or dark, style, accent')
  await openZone('mood'); await click('[data-kb="theme-st-mood"][data-id="light"]')
  check('Light: the real application goes light', (await ev(`!document.body.hasAttribute('data-ds-dark-theme')`)) === true && (await state()).mode === 'light')
  await click('[data-kb="theme-st-mood"][data-id="dark"]')
  check('Dark: and dark again', (await ev(`document.body.hasAttribute('data-ds-dark-theme')`)) === true && (await state()).mode === 'dark')
  await openZone('style'); await click('[data-kb="theme-st-style"][data-id="bleu"]')
  check('a style: the whole look of the shipped theme is applied', (await state()).skin === 'bleu' && (await state()).acc === '#4176E6' && (await state()).wp === 'nuit')
  check('...and the window shows its wallpaper', await ev(`!!document.querySelector('.kbth-st-wpl')`))
  await click('[data-kb="theme-st-allstyles"]')
  check('« All 18 styles » shows the eighteen', (await ev(`document.querySelectorAll('[data-kb="theme-st-style"]').length`)) === 18)
  await openZone('accent'); await click('.kbth-st-sw[aria-label="#EC4899"]')
  check('an accent swatch: the real brand colour follows (token layer)', (await state()).acc === '#EC4899' && /#ec4899|rgb\(236, 72, 153\)/i.test(await body('--dsw-alias-brand-primary')), await body('--dsw-alias-brand-primary'))
  await openMore(); await typeIn('[data-kb="theme-st-hex"]', '#10b981'); await sleep(250)
  check('the hex field sets the accent', (await state()).acc === '#10b981')
  check('how readable the text on it is, is said', await ev(`!!document.querySelector('[data-kb="theme-badge"]')`))

  console.log('Sidebar, wallpaper')
  await openZone('sidebar')
  const side0 = rowRgb(await body('--dsw-specific-sidebar-fill'))
  await click('[data-kb="theme-st-side"][data-id="darker"]'); await sleep(200)
  const side1 = rowRgb(await body('--dsw-specific-sidebar-fill'))
  check('Darker: the real sidebar fill gets darker', (await state()).sideTone === 'darker' && lum(side1) < lum(side0), { side0, side1 })
  await click('[data-kb="theme-st-side"][data-id="auto"]')
  await openZone('wall'); await click('[data-kb="theme-st-wpcat"][data-id="patterns"]'); await click('[data-kb="theme-st-wp"][data-id="seyes"]')
  check('a pattern is chosen: the real wallpaper layer is there', (await state()).wp === 'seyes' && (await ev(`!!Array.from(document.body.children).find((e) => e.style && e.style.position === 'fixed' && e.style.zIndex === '-1')`)) === true)
  await openMore(); await slide('Visibility', 40); await sleep(200)
  check('Visibility (under More options): the wallpaper opacity moves', (await state()).wpVis === 40 && (await ev(`Array.from(document.body.children).some((e) => e.style && e.style.position === 'fixed' && e.style.opacity === '0.4')`)))
  check('More options stays open after a change', await ev(`document.querySelector('[data-kb="theme-st-panel"] details.kbth-st-more').open`))
  await click('[data-kb="theme-st-wpnone"]')
  check('None removes it', (await state()).wp === 'none')

  console.log('Your messages and the agent\'s replies (the probe carries DSH\'s two markers)')
  await openZone('user')
  await click('[data-kb="theme-st-bubble"][data-id="accent"]'); await sleep(200)
  const accentFill = await body('--dsw-specific-bubble')
  check('Accent: the real bubble token is the accent fill', /^#[0-9a-f]{6}$/i.test(accentFill), accentFill)
  const pb = await ev(`getComputedStyle(document.getElementById('kb-pb')).backgroundColor`)
  check('...and what DSH paints with it follows', JSON.stringify(rowRgb(pb)) === JSON.stringify([parseInt(accentFill.slice(1, 3), 16), parseInt(accentFill.slice(3, 5), 16), parseInt(accentFill.slice(5, 7), 16)]), pb)
  const ink0 = await ev(`getComputedStyle(document.getElementById('kb-pb')).color`)
  check('the text on a bubble of our colour reads (white or ink, never the grey of the app)', /rgb\((255, 255, 255|15, 17, 21)\)/.test(ink0), ink0)
  await click('[data-kb="theme-st-bubble"][data-id="dark"]'); await sleep(200)
  check('Dark bubble', /^#(000000|1d1f24)$/i.test(await body('--dsw-specific-bubble')))
  await click('.kbth-st-sw[aria-label="#FDE68A"]'); await sleep(200)
  check('a text colour: your messages take it, the rest of the app does not', (await ev(`getComputedStyle(document.getElementById('kb-pb')).color`)) === 'rgb(253, 230, 138)' && (await ev(`getComputedStyle(document.getElementById('kb-pt')).color`)) !== 'rgb(253, 230, 138)')
  await click('[data-kb="theme-st-bubble"][data-id="auto"]'); await click('.kbth-st-sw.auto'); await sleep(200)
  check('Auto leaves DSH\'s own bubble and text', (await state()).bubbleUser === 'auto' && (await state()).textUser === null && /^#[0-9a-f]{6}$/i.test(await body('--dsw-specific-bubble')))
  await openZone('agent')
  await click('[data-kb="theme-st-reply"][data-id="card"]'); await sleep(200)
  const card = await ev(`(() => { const c = getComputedStyle(document.getElementById('kb-pr')); return { bg: c.backgroundColor, pad: c.paddingLeft, bd: c.borderTopWidth, r: c.borderTopLeftRadius } })()`)
  check('Card: a real background, a hairline, a radius and padding around the reply', card.bg !== 'rgba(0, 0, 0, 0)' && card.pad === '14px' && card.bd === '1px' && parseFloat(card.r) > 4, card)
  await click('[data-kb="theme-st-reply"][data-id="outline"]'); await sleep(200)
  const out = await ev(`(() => { const c = getComputedStyle(document.getElementById('kb-pr')); return { bg: c.backgroundColor, bd: c.borderTopWidth } })()`)
  check('Outline: a border only', out.bg === 'rgba(0, 0, 0, 0)' && out.bd === '1px', out)
  await click('[data-kb="theme-st-reply"][data-id="tint"]'); await sleep(200)
  check('Tinted: the accent at a low strength', (await ev(`getComputedStyle(document.getElementById('kb-pr')).backgroundColor`)) !== 'rgba(0, 0, 0, 0)')
  await click('.kbth-st-sw[aria-label="#A7F3D0"]'); await sleep(200)
  check('a reply text colour: the reply takes it', (await ev(`getComputedStyle(document.getElementById('kb-pt')).color`)) === 'rgb(167, 243, 208)')
  await click('[data-kb="theme-st-reply"][data-id="none"]'); await click('.kbth-st-sw.auto'); await sleep(200)
  check('None: no frame left', (await ev(`getComputedStyle(document.getElementById('kb-pr')).paddingLeft`)) === '0px')
  await shot('02-agent-panel')

  console.log('Icons, letters, widgets')
  await openZone('icons'); await click('[data-kb="theme-st-icons"][data-id="nature"]')
  check('a menu icon set: stored, and the registry of the menu follows', (await state()).iconSet === 'nature' && (await ev(`!window.__KB_ICONSETS__ || window.__KB_ICONSETS__.current() === 'nature'`)))
  check('...and the window draws it', await ev(`document.querySelectorAll('[data-kb="theme-st-window"] .kbth-st-ico svg').length === 5`))
  await openZone('letters'); await click('[data-kb="theme-st-font"][data-id="georgia"]')
  check('a font: the real application takes it (--dsw-font-family)', /Georgia/.test(await body('--dsw-font-family')) && (await state()).fontText === 'georgia')
  await click('.kbth-seg button:nth-child(3)')
  check('a size: Large is 16 px (DSH\'s own text size)', (await state()).fs === 16)
  await openMore()
  check('under More options: all thirty fonts, in groups, searchable', (await ev(`document.querySelectorAll('[data-kb="theme-st-fontall"]').length`)) === 30)
  await typeIn('[data-kb="theme-st-fq"]', 'fut'); await sleep(200)
  check('searching « fut » leaves Futura only', (await ev(`Array.from(document.querySelectorAll('[data-kb="theme-st-fontall"] span')).map((e) => e.textContent).join()`)) === 'Futura')
  await click('[data-kb="theme-st-fontall"]'); await sleep(250)
  check('and a font from the long list applies', /Futura/.test(await body('--dsw-font-family')) && (await state()).fontText === 'futura', { st: (await state()).fontText, v: await body('--dsw-font-family') })
  await click('.kbth-st-sw[aria-label="#BFDBFE"]'); await sleep(250)
  check('the app text colour: the primary text token takes it for the scheme on display', /#bfdbfe/i.test(JSON.stringify((await state()).ov)) && /rgb\(191, 219, 254\)|#bfdbfe/i.test(await body('--dsw-alias-label-primary')))
  await click('.kbth-st-sw.auto'); await sleep(200)
  check('Auto gives it back', !('dark:t1' in (await state()).ov) && !('light:t1' in (await state()).ov))
  await openZone('widgets')
  check('three pills can be switched off, each on its own', (await ev(`document.querySelectorAll('[data-kb="theme-st-panel"] .kbth-toggle').length`)) === 3)
  await ev(`Array.from(document.querySelectorAll('[data-kb="theme-st-panel"] .kbth-toggle'))[0].click()`); await sleep(250)
  const vis = () => ev(`['kb-d1', 'kb-d2', 'kb-d3'].map((i) => getComputedStyle(document.getElementById(i)).display !== 'none')`)
  check('the status pills hidden: only they go', (await state()).wgSessions === false && JSON.stringify(await vis()) === '[false,true,true]', await vis())
  await ev(`Array.from(document.querySelectorAll('[data-kb="theme-st-panel"] .kbth-toggle'))[1].click()`); await ev(`Array.from(document.querySelectorAll('[data-kb="theme-st-panel"] .kbth-toggle'))[2].click()`); await sleep(250)
  check('changes and usage hidden too', JSON.stringify(await vis()) === '[false,false,false]')
  await ev(`Array.from(document.querySelectorAll('[data-kb="theme-st-panel"] .kbth-toggle')).forEach((b) => { if (b.getAttribute('aria-checked') === 'false') b.click() })`); await sleep(250)
  check('and shown again', JSON.stringify(await vis()) === '[true,true,true]')

  console.log('Thinking animation')
  await openZone('think')
  check('the whale tail, 34 loops and « + », all drawn (real SVG), compact', await ev(`(() => { const t = Array.from(document.querySelectorAll('[data-kb="theme-st-loop"]')); const r = t[1].getBoundingClientRect(); return t.length === 35 && t.every((b) => b.querySelector('svg, img, span')) && r.width < 70 && !!document.querySelector('[data-kb="theme-st-addloop"]') })()`))
  check('the names are on hover (no label under the tiles)', await ev(`(() => { const t = document.querySelector('[data-kb="theme-st-loop"][data-id="bunny"]'); return t.getAttribute('data-name') === 'Bunny' && t.textContent.trim() === '' && getComputedStyle(t, '::after').content.length > 2 })()`))
  await click('[data-kb="theme-st-loop"][data-id="bunny"]'); await sleep(250)
  check('a loop: the animation store has it as the only one', JSON.stringify((await loopState()).sel) === '["bunny"]')
  check('...and the window draws it in the status line', await ev(`!!document.querySelector('.kbth-st-think .kb-ld')`))
  await ev(`(() => { const s = document.querySelector('[data-kb="theme-st-pack"]'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, 'cuisine'); s.dispatchEvent(new Event('change', { bubbles: true })) })()`); await sleep(250)
  check('the words: the ambiance is chosen from a dropdown, the window says one of its words', (await loopState()).pack === 'cuisine' && /Cooking|Mijotage/.test(await ev(`document.querySelector('.kbth-st-think').textContent`)))
  await openMore()
  await ev(`Array.from(document.querySelectorAll('[data-kb="theme-st-panel"] .kbth-seg button')).find((b) => b.textContent === '40 px').click()`); await sleep(200)
  check('under More options: the size', (await loopState()).size === 'large')
  await ev(`Array.from(document.querySelectorAll('[data-kb="theme-st-panel"] .kbth-seg button')).find((b) => b.textContent === 'Fast').click()`); await sleep(200)
  check('...the speed', Math.abs((await loopState()).speed - 1.6) < 0.01)
  await ev(`Array.from(document.querySelectorAll('[data-kb="theme-st-panel"] .kbth-toggle')).find((t) => t.getAttribute('aria-label') === 'Mix several animations').click()`); await sleep(200)
  for (const id of ['ring', 'orbit', 'atom', 'flow', 'sand']) await click(`[data-kb="theme-st-loop"][data-id="${id}"]`)
  check('Mix: at most four, the fifth is refused with a word', (await loopState()).sel.length === 4 && (await ev(`!!document.querySelector('[data-kb="theme-st-note"]')`)))
  await ev(`document.querySelector('[data-kb="theme-st-words"]').focus()`)
  await typeIn('[data-kb="theme-st-words"]', 'Pondering, Brewing'); await key('Enter'); await sleep(1200)
  const wordsNow = { pack: (await loopState()).pack, said: await ev(`document.querySelector('.kbth-st-think').textContent`), disk: ((await host('loader-store')) || {}).words }
  check('my own words: chosen, the window says one of them, and the disk copy has them', wordsNow.pack === 'perso' && /Pondering|Brewing/.test(wordsNow.said) && JSON.stringify(wordsNow.disk) === '["Pondering","Brewing"]', wordsNow)
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3" fill="red"><animate attributeName="r" values="1;3;1" dur="1s" repeatCount="indefinite"/></circle></svg>'
  await ev(`(() => { const f = new File([${JSON.stringify(svg)}], 'wave.svg', { type: 'image/svg+xml' }); const dt = new DataTransfer(); dt.items.add(f); const i = document.querySelector('[data-kb="theme-st-addloop"]'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  await sleep(1500)
  check('my own animation (SVG): it joins the grid, is chosen, is cleaned and saved', await ev(`Array.from(document.querySelectorAll('[data-kb="theme-st-loop"]')).some((b) => b.getAttribute('data-name') === 'wave')`) && (await loopState()).sel.length >= 1)
  await ev(`(() => { const f = new File([new Uint8Array(210 * 1024)], 'big.gif', { type: 'image/gif' }); const dt = new DataTransfer(); dt.items.add(f); const i = document.querySelector('[data-kb="theme-st-addloop"]'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  await sleep(800)
  check('a file over 200 KB is refused, with the size in the message', /200/.test(await ev(`(document.querySelector('[data-kb="theme-st-note"]') || {}).textContent || ''`)) && !(await ev(`Array.from(document.querySelectorAll('[data-kb="theme-st-loop"]')).some((b) => b.getAttribute('data-name') === 'big')`)))
  await shot('03-think-panel')
  // my files go away from the sandbox's disk again
  for (const l of ((((await host('loader-store')) || {}).loaders) || [])) await host('loader-store', { op: 'delete-loader', id: l.id })

  console.log('Effects and shape, accessibility')
  await openChip('effects')
  await pressSeg('Corners', 'Sharp'); await sleep(200)
  check('Corners: sharp (the radius tokens shrink)', (await state()).radius === 'sharp' && parseFloat(await body('--dsw-radius-md')) <= 3.5)
  await pressSeg('Corners', 'Standard'); await pressSeg('Shadows', 'Soft')
  await ev(`Array.from(document.querySelectorAll('[data-kb="theme-st-panel"] .kbth-toggle'))[0].click()`); await sleep(300)
  check('Shadows soft + Glow: the effects sheet has them', (await state()).shadow === 'soft' && (await state()).glow === true && (await ev(`Array.from(document.querySelectorAll('style[data-plugin="@local/kybernos-theme"]')).some((s) => /\\[data-composer-card\\]\\{box-shadow:0 4px 14px[^}]*0 0 18px/.test(s.textContent))`)))
  await openChip('access')
  await pressSeg('Contrast', 'Enhanced'); await sleep(200)
  check('Contrast: enhanced', (await state()).contrastMode === 'plus')
  await ev(`Array.from(document.querySelectorAll('[data-kb="theme-st-panel"] .kbth-toggle'))[0].click()`); await sleep(200)
  check('Reduce animations: the document says so', (await state()).reduceMotion === true && (await ev(`document.documentElement.hasAttribute('data-kbth-reduced')`)))
  await ev(`Array.from(document.querySelectorAll('[data-kb="theme-st-panel"] .kbth-toggle'))[0].click()`)
  await closePanel()

  console.log('Vibes, Surprise me, Undo, Reset')
  await click('[data-kb="theme-st-vibe"][data-id="dev"]'); await sleep(500)
  const dev = await state()
  check('Dev: a whole look (font, icons, sidebar tone, frame, bubble, accent) and its loop and words', /JetBrains/.test(await body('--dsw-font-family')) && dev.iconSet === 'matrice' && dev.sideTone === 'darker' && dev.replyBg === 'outline' && dev.bubbleUser === 'dark' && dev.acc === '#22C55E' && JSON.stringify((await loopState()).sel) === '["bars"]' && (await loopState()).pack === 'ingenierie', dev)
  check('...it is shown as the chosen vibe, and only it', await ev(`Array.from(document.querySelectorAll('[data-kb="theme-st-vibe"]')).filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.getAttribute('data-id')).join()`) === 'dev')
  check('...it left the accessibility needs the person had set (Enhanced contrast stays)', dev.contrastMode === 'plus')
  await sleep(900)
  await click('[data-kb="theme-st-vibe"][data-id="study"]'); await sleep(900)
  const study = await state()
  check('Study after Dev: nothing of Dev stays (a vibe starts from the defaults)', study.bubbleUser === 'auto' && study.sideTone === 'auto' && study.replyBg === 'card' && study.iconSet === 'kawaii' && study.fontText === 'nunito')
  const before = JSON.stringify(await state())
  await sleep(900)
  await click('[data-kb="theme-st-surprise"]'); await sleep(900)
  check('Surprise me changes the look (and never the accessibility needs)', JSON.stringify(await state()) !== before && (await state()).contrastMode === study.contrastMode && (await state()).reduceMotion === study.reduceMotion)
  await sleep(900)
  await click('[data-kb="theme-st-undo"]'); await sleep(500)
  check('Undo puts the look back exactly as it was before Surprise me', JSON.stringify(await state()) === before)
  await sleep(900)
  await click('[data-kb="theme-st-reset"]'); await sleep(500)
  const reset = await state()
  check('Reset: the defaults', reset.skin === 'dsh' && reset.acc === null && reset.replyBg === 'none' && reset.bubbleUser === 'auto' && reset.wgSessions === true)
  await sleep(900)
  await click('[data-kb="theme-st-undo"]'); await sleep(500)
  check('...and Undo undoes the reset', JSON.stringify(await state()) === before)
  await click('[data-kb="theme-st-reset"]'); await sleep(300)

  console.log('Save, Export, Import, My looks (the real disk copy)')
  await click('[data-kb="theme-st-vibe"][data-id="chill"]'); await sleep(400)
  await typeIn('[data-kb="theme-st-name"]', 'Friday vibes'); await click('[data-kb="theme-st-save"]'); await sleep(900)
  const lib = await ev(`JSON.parse(localStorage.getItem(${JSON.stringify(LIB)}) || '{"presets":[]}').presets`)
  check('Save: the look is in My themes, with the bubble, the frame and the sidebar tone it carries', lib.length === 1 && lib[0].name === 'Friday vibes' && lib[0].settings.bubbleUser === 'accent' && lib[0].settings.replyBg === 'tint' && lib[0].settings.sideTone === 'tinted', lib)
  check('...and it is a chip you can press', await ev(`!!document.querySelector('[data-kb="theme-st-look"]')`))
  await sleep(1200)
  const disk = ((((await host('preset-store')) || {}).library || {}).presets || []).map((p) => ({ n: p.name, k: Object.keys(p.settings) }))
  check('...the DSH disk copy keeps the new keys too (the host store knows them)', Array.isArray(disk) && disk.length >= 1 && disk.some((d) => d.k.includes('bubbleUser') && d.k.includes('replyBg') && d.k.includes('sideTone')), disk)
  await ev(`window.__dl = null; HTMLAnchorElement.prototype.click = function () { window.__dl = { href: this.href, name: this.download } }`)
  await typeIn('[data-kb="theme-st-name"]', 'Friday vibes'); await click('[data-kb="theme-st-export"]'); await sleep(400)
  const dl = await ev(`(async () => { const d = window.__dl; if (!d) return null; const o = JSON.parse(await (await fetch(d.href)).text()); return { name: d.name, format: o.format, keys: Object.keys(o.settings), n: o.name } })()`)
  check('Export: a .json theme file named after the look, with the chat settings', dl !== null && dl.name === 'theme-friday-vibes.json' && dl.format === 'kybernos-theme-preset' && dl.keys.includes('bubbleUser') && dl.keys.includes('replyBg'), dl)
  await ev(`(() => { const f = new File([JSON.stringify({ format: 'kybernos-theme-preset', version: 1, name: 'Imported one', settings: { mode: 'light', acc: '#112233', bubbleUser: '#aabbcc', replyBg: 'card' } })], 'x.json'); const dt = new DataTransfer(); dt.items.add(f); const i = document.querySelector('[data-kb="theme-st-import"]'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  await sleep(700)
  check('Import: it appears in My themes and is not applied until pressed', await ev(`Array.from(document.querySelectorAll('[data-kb="theme-st-look"]')).some((b) => b.textContent.includes('Imported one'))`) && (await state()).acc !== '#112233')
  await ev(`(() => { const f = new File(['{"hello":1}'], 'bad.json'); const dt = new DataTransfer(); dt.items.add(f); const i = document.querySelector('[data-kb="theme-st-import"]'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  await sleep(500)
  check('a wrong file is refused with a word, nothing changes', /not recognized|non reconnu/i.test(await ev(`(document.querySelector('[data-kb="theme-st-status"]') || {}).textContent || ''`)))
  await click('[data-kb="theme-st-look"][data-id]'); await sleep(400)
  check('pressing a saved look applies it (the first chip: the one just saved)', (await state()).bubbleUser === 'accent' && (await state()).replyBg === 'tint')
  await ev(`(() => { const x = Array.from(document.querySelectorAll('.kbth-st-x'))[0]; if (x) x.click() })()`); await sleep(250)
  check('deleting a look asks first', await ev(`!!document.querySelector('[data-kb="theme-st-delyes"]')`))
  await click('[data-kb="theme-st-delyes"]'); await sleep(500)
  check('...and confirmed, it is gone', (await ev(`JSON.parse(localStorage.getItem(${JSON.stringify(LIB)}) || '{"presets":[]}').presets.length`)) === 1)

  console.log('The editor of the nine tabs, still whole')
  await click('[data-kb="theme-classic"] > summary'); await sleep(400)
  check('opened: the nine tabs are there', (await ev(`document.querySelectorAll('[data-kb="theme-classic"] .kbth-adv-tab').length`)) === 9 && (await ev(`document.querySelector('[data-kb="theme-classic"]').open`)))
  await ev(`Array.from(document.querySelectorAll('[data-kb="theme-classic"] .kbth-adv-tab')).find((b) => b.textContent.trim() === 'Accessibility').click()`); await sleep(300)
  check('a tab opens and works (Accessibility table)', await ev(`!!document.querySelector('[data-kb="theme-classic"] .kbth-a11y-table')`))
  await click('[data-kb="theme-st-looks"] .kbth-link'); await sleep(500)
  check('« Find more looks (gallery) » opens the gallery tab of the editor', await ev(`document.querySelector('[data-kb="theme-classic"]').open && !!document.querySelector('[data-kb="theme-gal"], [data-kb="theme-gal-loading"], [data-kb="theme-gal-error"], [data-kb="theme-gal-none"]')`))

  console.log('Narrow')
  await page.send('Emulation.setDeviceMetricsOverride', { width: 860, height: 900, deviceScaleFactor: 1, mobile: false })
  await sleep(900)
  const nar = await ev(`document.querySelector('.kbth-st').classList.contains('narrow')`)
  check('a narrow page switches the studio to its narrow layout', nar === true)
  if (nar === true) {
    await ev(`document.querySelector('[data-kb="theme-st-looks"]').scrollIntoView()`)
    await openZone('user')
    check('...and it is in the flow (static), below the window', await ev(`(() => { const p = document.querySelector('[data-kb="theme-st-panel"]'), w = document.querySelector('[data-kb="theme-st-window"]'); return getComputedStyle(p).position === 'static' && p.getBoundingClientRect().top >= w.getBoundingClientRect().bottom - 2 })()`))
    await shot('04-narrow')
  }
  await page.send('Emulation.clearDeviceMetricsOverride', {})

  check('no script error the whole time', errors.length === 0, errors)
  await shot('05-end')

} catch (e) {
  failures.push('the script stopped: ' + (e && e.message))
  console.log('  ✗ the script stopped: ' + (e && e.message))
} finally {
  // Put the sandbox back, whatever happened: the defaults go into DSH's own preferences (mode, text size) and the disk copies are emptied.
  try { await ev(`(() => { const b = document.querySelector('[data-kb="theme-st-reset"]'); if (b) b.click() })()`); await sleep(800); await wipe() } catch (e) { /* the page is gone */ }
  try { await live.close() } catch (e) { /* closed */ }
}
console.log('\n' + (failures.length === 0 ? '✓ ' : '✗ ') + pass + ' checks, ' + failures.length + ' failed')
if (failures.length > 0) { console.log(failures.map((f) => ' - ' + f).join('\n')); process.exit(1) }
process.exit(0)
