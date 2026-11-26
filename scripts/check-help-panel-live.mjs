#!/usr/bin/env node
// The « ? » of a page and the help card it opens, on a PHONE (the owner's capture of 2026-11-23: on Automations the card was a 44 px strip, cut to one or two letters a line, and the « ? » sat on
// the left of its 44 px box). Played on the sandbox (never :3080) with the phone's user agent (Simple, `KabyMode/1`) and, once, the full app on the same screen.
//
//   source scripts/sandbox/env.sh && node scripts/check-help-panel-live.mjs [--shots <dir>] [--widths 360,390,412] [--langs en,fr] [--schemes light,dark] [--uas kaby,full] [--only <page>] [--quick]
//
// Default = the quick run: 390 px, English, light, Simple then the full app. `--quick` is the same; any flag widens it. The full sweep (3 widths, 2 languages, 2 schemes, 2 apps) is slow (about 20 minutes).
// For EVERY page the phone can open (the drawer's rows, then every Settings page the phone lists) and for each « ? » on it (`.kbhp-btn` of the Suite, `.kb6-helpbtn` of a page's header):
//   - the button is at least 44 × 44 and its glyph is centred in its box (and so is every icon-sized button on the page: a glyph that is not centred in a 44 px box is the same defect);
//   - the card it opens is whole: inside the screen with 8 px or more on each side, as wide as the screen leaves (at least W - 40 px), no sideways scroll, no text cut by its own edge, nothing of the page over it
//     (five points of the card are hit-tested), the ✕ is a thumb's size, inside the card and free to tap; every button and link of the card is 44 px high; a tap on the ✕ closes it.
//   - nothing of the page (closed, with the card open, with the page's own guide open) sticks out of the screen or of the box that clips it, and no pane as wide as the screen scrolls sideways (a scrollbar at its foot):
//     the Language page had a row 46 px too wide, the Agent Teams guide a table of three columns.
// The result is also printed as a list of defects with the page, the width, the language and the scheme. Screenshots (`--shots`) are not committed (no media in git); they are for the reader.
// Exit 0: nothing found, 1: a defect, 3: not run (no GUI, or not the sandbox).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, waitFor } from './live-page.mjs'

const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : dflt }
const shotsDir = arg('--shots', null)
const WIDTHS = arg('--widths', '390').split(',').map(Number)
const LANGS = arg('--langs', 'en').split(',')
const SCHEMES = arg('--schemes', 'light').split(',')
const UAS = arg('--uas', 'kaby,full').split(',')
const ONLY = arg('--only', null) // a page: only the drawer rows and the Settings pages whose name holds this text (a quick replay of one page)
const wanted = (name) => ONLY === null || String(name).toLowerCase().includes(ONLY.toLowerCase())
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
if (!process.env.KB_HOST || /:3080$/.test(process.env.KB_HOST)) {
  console.error('○ not run: this check opens pages and Settings. Run it on the sandbox: source scripts/sandbox/env.sh && node scripts/check-help-panel-live.mjs')
  process.exit(3)
}
const live = await openLivePage({ width: 1400, height: 1000 }).catch((e) => { console.error('○ not run: ' + e.message); process.exit(3) })
const { page } = live
const ev = async (js, ms = 12000) => { const r = await page.evalJs(js, ms); return r.err !== undefined ? { err: r.err } : r.val }
const rect = (sel, nth = 0, block = 'center') => ev(`(() => { const e = document.querySelectorAll(${JSON.stringify(sel)})[${nth}]; if (!e) return null; e.scrollIntoView({ block: ${JSON.stringify(block)} }); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height } })()`)
const click = async (sel, nth = 0, block = 'center') => {
  let r = await rect(sel, nth, block)
  if (r === null || r === undefined || r.err !== undefined) throw new Error('nothing to click: ' + sel)
  await sleep(320)
  r = await rect(sel, nth, block)
  if (r === null || r === undefined || r.err !== undefined) throw new Error('nothing to click: ' + sel)
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 })
  await sleep(300)
}
const exists = (sel) => ev(`!!document.querySelector(${JSON.stringify(sel)})`)

const KABY_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KybernosHost/0.1.0 (ios) KabyMode/1 KybernosCaps/account,plans,referral,where,signout'
const FULL_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KybernosHost/0.1.0 (ios) KybernosCaps/account,plans,referral,where,signout,mode'
const SHELL_JS = 'window.__kbOut = []; window.ReactNativeWebView = { postMessage: function (s) {} };'
const CLOUD_USER = { user: { email: 'dev@example.test', name: 'Dev Person', plan: 'free' }, workspaces: [{ id: 'W0', name: 'Personal', personal: true, role: 'owner' }], active_workspace_id: 'W0', space_plan: { key: 'free', label: 'Free', workspace_id: 'W0' }, web_url: 'https://dev.kybernos.app', device_label: 'This phone' }
// A connected account (the Reminders and Apps rows are padlocked without one) and an EMPTY automation list: the phone of the owner has none, so Automations draws the Suite's « ? » there.
const stubs = (emptyTasks) => `(function () { var real = window.fetch.bind(window); var json = function (b) { return Promise.resolve(new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } })) }; window.fetch = function (u, o) { var s = typeof u === 'string' ? u : ((u && u.url) || ''); if (s.indexOf('/kybernos-cloud/status') >= 0) return json(${JSON.stringify({ ok: true, connected: true, state: CLOUD_USER })}); ${emptyTasks ? "if (/tasks$/.test(s.split('?')[0]) && o && typeof o.body === 'string' && o.body.indexOf('\"list\"') >= 0) return json({ ok: true, tasks: [] });" : ''} return real(u, o) } })();`
const seedLang = (lang) => `try { if (localStorage.getItem('kb_live_seeded') === null) { localStorage.setItem('kybernos.theme.lang', '${lang}'); localStorage.setItem('kb_live_seeded', '1') } } catch (e) {}`
const STORE = 'kybernos.theme.v1'
const LIB = 'kybernos.theme.presets.v1'
const MENU = 'kybernos.theme.menu.v1'
const DIALOG = '[data-shortcut-modal="settings"]'
const BURGER = '[data-kb="mobile-menu"]'
const AVATAR = '[data-kb="mobile-avatar"]'
const BTN = '.kbhp-btn, .kb6-helpbtn, .kbln-help-btn, .kbat-help, .kbcl-hl'

const findings = []
const found = (where, what, detail) => { findings.push({ where, what, detail }); console.log('  ✗ ' + where + ' — ' + what + (detail === undefined ? '' : '  ' + JSON.stringify(detail).slice(0, 300))) }
let pass = 0
const ok = (n = 1) => { pass += n }
const errors = []
let report = []
const shot = async (name) => {
  if (shotsDir === null) return
  try { mkdirSync(shotsDir, { recursive: true }); const r = await page.send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(shotsDir, name + '.png'), Buffer.from(r.result.data, 'base64')) } catch (e) { /* no screenshot */ }
}

// ── in the page ──────────────────────────────────────────────────────────────────────────────────────────────
/** The icon-sized buttons whose glyph is not centred in their box (more than 1.5 px across or 2.5 px down while the box has 8 px or more to spare), and the help controls under 44 px. */
const SCAN_JS = `(() => {
  const out = { off: [], small: [] }
  const vis = (e) => { const b = e.getBoundingClientRect(), cs = getComputedStyle(e); return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && b.bottom > 0 && b.top < innerHeight && b.right > 0 && b.left < innerWidth && Number(cs.opacity) > 0.05 }
  const name = (e) => (e.getAttribute('data-kb') || e.getAttribute('aria-label') || String(e.className).split(' ')[0] || e.tagName).slice(0, 40)
  const root = document.querySelector('${DIALOG}') || document
  for (const e of root.querySelectorAll('button, [role="button"], [role="tab"]')) {
    if (!vis(e)) continue
    const b = e.getBoundingClientRect()
    { const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); if (!(top === e || e.contains(top))) continue }
    if (b.width > 64 || b.height > 64 || b.width < 20) continue
    if (e.getAttribute('role') === 'switch' || e.hasAttribute('aria-checked')) continue
    // icon-only: a glyph of one or two characters (« ? », « ✕ »), or a picture and no words (a label may sit at the start of its box by design)
    const words = (e.textContent || '').trim()
    if (words.length > 2 || (words.length === 0 && !e.querySelector('svg, img'))) continue
    const r = document.createRange(); r.selectNodeContents(e)
    const rs = [...r.getClientRects()].filter((x) => x.width > 0 && x.height > 0)
    if (rs.length === 0) continue
    const l = Math.min(...rs.map((x) => x.left)), rr = Math.max(...rs.map((x) => x.right)), t = Math.min(...rs.map((x) => x.top)), bt = Math.max(...rs.map((x) => x.bottom))
    const dx = (l + rr) / 2 - (b.left + b.right) / 2, dy = (t + bt) / 2 - (b.top + b.bottom) / 2
    // a box nobody sees (no fill, no line) cannot show a glyph off its centre: only a drawn box counts
    const cs = getComputedStyle(e), alpha = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return 0; const p = m[1].split(',').map(Number); return p.length > 3 ? p[3] : 1 }
    const drawn = alpha(cs.backgroundColor) > 0.03 || (parseFloat(cs.borderTopWidth) > 0 && alpha(cs.borderTopColor) > 0.03) || (cs.boxShadow !== 'none' && !/^rgba\(0, 0, 0, 0\)/.test(cs.boxShadow))
    if (!drawn) continue
    if ((b.width - (rr - l) > 8 && Math.abs(dx) > 2) || (b.height - (bt - t) > 8 && Math.abs(dy) > 2.5)) out.off.push({ el: name(e), w: Math.round(b.width), h: Math.round(b.height), dx: Math.round(dx * 10) / 10, dy: Math.round(dy * 10) / 10 })
  }
  for (const e of document.querySelectorAll('.kbhp-btn, .kb6-helpbtn, .kbln-help-btn, .kbat-help, .kbcl-hl')) { if (!vis(e)) continue; const b = e.getBoundingClientRect(); if (b.width < 43.5 || b.height < 43.5 || Math.abs(b.width - b.height) > 4) out.small.push({ el: name(e), w: Math.round(b.width), h: Math.round(b.height), note: 'under 44 px, or not square' }) }
  return out
})()`
/** What sticks out of the screen or of the box that clips it, and a pane as wide as the screen that scrolls sideways (the Language page: a row 46 px too wide; Agent Teams' guide: a table of three columns).
 *  A strip meant to scroll (a row of chips narrower than the screen, `overflow-x:auto`) owns its content; the closed drawer and what is hidden are not looked at. */
const STICK_JS = `(() => {
  const W = innerWidth
  const out = { stick: [], clip: [], pane: [] }
  const root = document.querySelector('${DIALOG}') || document.body
  const label = (e) => (e.tagName + '.' + String(typeof e.className === 'string' ? e.className : '').split(' ')[0]).slice(0, 44) + (e.tagName === 'TD' || e.tagName === 'TH' || e.tagName === 'BUTTON' ? ' « ' + (e.textContent || '').trim().slice(0, 24) + ' »' : '')
  for (const e of root.querySelectorAll('*')) {
    if (e.closest('[aria-hidden="true"], [inert]') !== null || e instanceof SVGElement) continue
    // what a shut <details> keeps is not drawn (its summary is); a colour input is a native box a swatch clips on purpose
    if ((e.closest('details:not([open])') !== null && e.closest('summary') === null) || (e.tagName === 'INPUT' && e.type === 'color')) continue
    const b = e.getBoundingClientRect()
    if (b.width <= 0 || b.height <= 0) continue
    const cs = getComputedStyle(e)
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.05 || cs.position === 'fixed') continue
    if (b.width >= W - 4 && (cs.overflowX === 'auto' || cs.overflowX === 'scroll') && e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0) out.pane.push({ el: label(e), sw: e.scrollWidth, cw: e.clientWidth })
    let scroller = false, clipper = null
    for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
      const o = getComputedStyle(a).overflowX, ab = a.getBoundingClientRect()
      if ((o === 'auto' || o === 'scroll') && ab.width < W - 4) { scroller = true; break }
      if ((o === 'hidden' || o === 'clip') && clipper === null && ab.width > 4) clipper = ab
    }
    if (scroller) continue
    if (b.right > W + 1 || b.left < -1) out.stick.push({ el: label(e), left: Math.round(b.left), right: Math.round(b.right), W })
    else if (clipper !== null && (b.right > clipper.right + 1 || b.left < clipper.left - 1)) out.clip.push({ el: label(e), left: Math.round(b.left), right: Math.round(b.right), box: [Math.round(clipper.left), Math.round(clipper.right)] })
  }
  out.stick = out.stick.slice(0, 4); out.clip = out.clip.slice(0, 4); out.pane = out.pane.slice(0, 3)
  return out
})()`
const CARD_JS = (sel) => `(() => {
  const c = document.querySelector(${JSON.stringify(sel)}); if (!c) return null
  const b = c.getBoundingClientRect(), W = innerWidth, H = innerHeight
  const x = c.querySelector('.kbhp-x'), xb = x ? x.getBoundingClientRect() : null
  const pts = [[b.left + 14, b.top + 14], [b.right - 14, b.top + 14], [b.left + 14, Math.min(b.bottom, H) - 14], [b.right - 14, Math.min(b.bottom, H) - 14], [(b.left + b.right) / 2, (b.top + Math.min(b.bottom, H)) / 2]]
  const covered = []
  for (const [px, py] of pts) { const el = document.elementFromPoint(px, py); if (!el || !c.contains(el)) covered.push([Math.round(px), Math.round(py), el ? el.tagName + '.' + String(el.className).slice(0, 30) : null]) }
  let xFree = null
  if (xb) { const el = document.elementFromPoint(xb.left + xb.width / 2, xb.top + xb.height / 2); xFree = el === x || x.contains(el) }
  const outside = [...c.querySelectorAll('*')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > b.right + 1 || r.left < b.left - 1) }).slice(0, 3).map((e) => e.tagName + '.' + String(e.className).slice(0, 30))
  const small = [...c.querySelectorAll('button, a[href]')].map((e) => { const r = e.getBoundingClientRect(); return { el: (e.className || e.tagName).toString().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) } }).filter((o) => o.h > 0 && o.h < 43.5)
  return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, w: b.width, h: b.height, W, H, scrollW: c.scrollWidth, clientW: c.clientWidth, scrollH: c.scrollHeight, clientH: c.clientHeight, oy: getComputedStyle(c).overflowY, x: xb ? { w: Math.round(xb.width), h: Math.round(xb.height), left: xb.left, right: xb.right, top: xb.top, bottom: xb.bottom } : null, xFree, covered, outside, small, docW: document.documentElement.scrollWidth, text: c.innerText.slice(0, 60) }
})()`

/** Judges one open card. */
const judgeCard = (where, m, W) => {
  if (m === null || m === undefined || m.err !== undefined) return found(where, 'the card did not open', m)
  let bad = 0
  const fail = (what, d) => { bad += 1; found(where, what, d) }
  if (m.left < 8 - 0.5 || m.right > W - 8 + 0.5) fail('the card leaves the screen (8 px margin)', { left: m.left, right: m.right, W })
  if (m.w < W - 40) fail('the card is narrower than the screen leaves (' + (W - 40) + ' px or more)', { w: m.w, W })
  if (m.scrollW > m.clientW + 1) fail('text is cut by the card\'s own edge (sideways scroll inside it)', { scrollW: m.scrollW, clientW: m.clientW })
  if (m.outside.length > 0) fail('something inside the card sticks out of it', m.outside)
  if (m.docW > W + 2) fail('the page scrolls sideways with the card open', { docW: m.docW, W })
  if (m.bottom > m.H + 1 && !(m.oy === 'auto' || m.oy === 'scroll')) fail('the foot of the card is under the screen\'s edge and it cannot scroll', { bottom: m.bottom, H: m.H })
  if (m.bottom > m.H + 1) fail('the card is taller than the screen (its foot is out of sight until it is scrolled)', { bottom: m.bottom, H: m.H })
  if (m.covered.length > 0) fail('something of the page lies over the card', m.covered)
  if (m.x === null) fail('the card has no ✕')
  else {
    if (m.x.w < 43.5 || m.x.h < 43.5) fail('the ✕ is under a thumb\'s size (44 px)', m.x)
    if (m.x.left < m.left - 0.5 || m.x.right > m.right + 0.5 || m.x.top < m.top - 0.5) fail('the ✕ is not inside the card', m.x)
    if (m.xFree !== true) fail('the ✕ is covered (a tap on it would not reach it)', m.x)
  }
  if (m.small.length > 0) fail('a button or link of the card is under 44 px high', m.small)
  if (bad === 0) ok()
  return bad
}

/** Judges what sticks out of a page: closed (`state` = 'closed') or with its guide / card open. */
const judgeStick = async (where, state) => {
  // the page's folded sections (<details>: the Theme page's editor) are opened once, on the first look, so that what they hold is measured too
  if (state === 'closed') { await ev(`document.querySelectorAll('details:not([open])').forEach((d) => { d.open = true })`); await sleep(500) }
  const m = await ev(STICK_JS)
  if (!m || m.err !== undefined) return 0
  let bad = 0
  if (m.pane.length > 0) { bad += 1; found(where + ' (' + state + ')', 'a pane as wide as the screen scrolls sideways (a sideways scrollbar at the foot of the page)', m.pane) }
  if (m.stick.length > 0) { bad += 1; found(where + ' (' + state + ')', 'something sticks out of the screen', m.stick) }
  if (m.clip.length > 0) { bad += 1; found(where + ' (' + state + ')', 'something is cut by the box that clips it', m.clip) }
  if (bad === 0) ok()
  return bad
}

// ── one page ─────────────────────────────────────────────────────────────────────────────────────────────────
const inspectPage = async (tag, where, W, lang) => {
  const scan = await ev(SCAN_JS)
  if (scan && scan.err === undefined) {
    if (scan.off.length > 0) found(where, 'a glyph is not centred in its button', scan.off); else ok()
    if (scan.small.length > 0) found(where, 'a « ? » is under 44 px or not square', scan.small); else ok()
  }
  // the help buttons that can be seen get a number, so that a tap goes to the one meant (a page that is not shown may keep its own « ? » in the page)
  const n = await ev(`(() => { document.querySelectorAll('[data-kbsweep]').forEach((e) => e.removeAttribute('data-kbsweep')); const root = document.querySelector('${DIALOG}') || document; let i = 0; for (const e of root.querySelectorAll(${JSON.stringify(BTN)})) { const b = e.getBoundingClientRect(); if (b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden' && e.closest('[aria-hidden="true"], [inert]') === null) { const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); if (top === e || e.contains(top)) { e.setAttribute('data-kbsweep', String(i)); i += 1 } } } return i })()`)
  report.push({ page: tag, helpButtons: n })
  if (!n) return 0
  const label = await ev(`document.querySelector('[data-kbsweep="0"]').getAttribute('aria-label')`)
  const want = lang === 'fr' ? /Comment ça marche/ : /How it works/
  if (!want.test(String(label))) found(where, 'the « ? » is not in the page\'s language (' + lang + ')', label)
  else ok()
  await shot(tag + '-closed')
  await judgeStick(where, 'closed')
  let done = 0
  for (let i = 0; i < Math.min(n, 2); i += 1) {
    // the card hangs from this very button: scroll it into view first
    const me = `[data-kbsweep="${i}"]`
    await click(me, 0, 'center')
    await sleep(700)
    const isSuite = await ev(`(() => { const b = document.querySelector('${me}'); return b ? b.classList.contains('kbhp-btn') : null })()`)
    if (isSuite) {
      const sel = await ev(`(() => { const b = document.querySelector('${me}'); const id = b && b.getAttribute('aria-controls'); return id ? '#' + id : null })()`)
      const m = sel ? await ev(CARD_JS(sel)) : null
      await shot(tag + '-open' + (i > 0 ? '-' + i : ''))
      if (m === null) console.log('    debug', sel, JSON.stringify(await ev(`(() => { const b = document.querySelector('${me}'); return b ? { html: b.outerHTML.slice(0, 260), exp: b.getAttribute('aria-expanded'), url: location.href.slice(-40), pops: document.querySelectorAll('.kbhp-pop').length, dlg: !!document.querySelector('${DIALOG}') } : null })()`)))
      judgeCard(where + (i > 0 ? ' (button ' + (i + 1) + ')' : ''), m, W)
      await judgeStick(where + (i > 0 ? ' (button ' + (i + 1) + ')' : ''), 'card open')
      // the ✕ closes it
      if (m && m.x) {
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: (m.x.left + m.x.right) / 2, y: (m.x.top + m.x.bottom) / 2 })
        await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: (m.x.left + m.x.right) / 2, y: (m.x.top + m.x.bottom) / 2, button: 'left', clickCount: 1 })
        await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: (m.x.left + m.x.right) / 2, y: (m.x.top + m.x.bottom) / 2, button: 'left', clickCount: 1 })
        await sleep(400)
        if (await exists(sel)) found(where, 'a tap on the ✕ does not close the card'); else ok()
      }
      done += 1
    } else {
      // the page's own guide (Automations with a list): it opens in the page; it must not scroll the page sideways nor be cut
      await shot(tag + '-open' + (i > 0 ? '-' + i : ''))
      const w = await ev(`document.documentElement.scrollWidth`)
      if (w > W + 2) found(where, 'the page scrolls sideways with its guide open', { docW: w, W }); else ok()
      await judgeStick(where, 'guide open')
      await click(me, 0, 'center')
      done += 1
    }
  }
  return done
}

// ── the phone ────────────────────────────────────────────────────────────────────────────────────────────────
let scriptId = null
const intoPhone = async ({ ua, width, scheme, lang, emptyTasks }) => {
  const height = width <= 360 ? 740 : (width >= 412 ? 915 : 844)
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true })
  await page.send('Emulation.setUserAgentOverride', { userAgent: ua, platform: 'iPhone' })
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  if (scriptId !== null) { await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: scriptId }).catch(() => {}); scriptId = null }
  const source = (ua === KABY_UA ? SHELL_JS : '') + stubs(emptyTasks) + (lang === 'fr' ? seedLang('kybernos') : '')
  const r = await page.send('Page.addScriptToEvaluateOnNewDocument', { source }); scriptId = r.identifier || (r.result && r.result.identifier) || null
  await ev(`['${STORE}', '${LIB}', '${MENU}'].forEach((k) => localStorage.removeItem(k))`)
  await page.send('Page.reload', { ignoreCache: true })
  await sleep(4000)
  await waitFor(page, `!!document.querySelector('${BURGER}')`, 30000)
  await sleep(lang === 'fr' ? 9000 : 2000)
  await ensureScheme(scheme, lang)
}
/** DSH keeps its light / dark choice on the host and ignores the browser's own, so the account menu's Appearance switch (sun first, moon second, whatever the language) is pressed, then the page reloaded. */
const isDark = () => ev(`document.body.hasAttribute('data-ds-dark-theme')`)
const ensureScheme = async (scheme, lang) => {
  if ((await isDark()) === (scheme === 'dark')) return
  await openDrawer(); await click(AVATAR); await sleep(500)
  if (!(await waitFor(page, `document.querySelectorAll('[data-kb="menu-appearance"] .kbfp-seg button').length === 2`, 6000))) return
  await click('[data-kb="menu-appearance"] .kbfp-seg button', scheme === 'dark' ? 1 : 0); await sleep(600)
  await page.send('Page.reload', { ignoreCache: true })
  await sleep(4000)
  await waitFor(page, `!!document.querySelector('${BURGER}')`, 30000)
  await sleep(lang === 'fr' ? 9000 : 2000)
}
const drawerOpen = () => ev(`(() => { const r = document.querySelector('[data-slot="root"] > div'); return r ? !r.hasAttribute('data-sidebar-collapsed') : null })()`)
const openDrawer = async () => { if ((await drawerOpen()) !== true) { await click(BURGER); await sleep(500) } return (await drawerOpen()) === true }
const drawerRows = () => ev(`[...document.querySelectorAll('[data-kb-row]')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(e).display !== 'none' }).map((e) => e.getAttribute('data-kb-row'))`)
const shownPages = () => ev(`[...document.querySelectorAll('${DIALOG} [class*="navList"] [data-kb-t]')].filter((c) => getComputedStyle(c).display !== 'none').map((c) => c.getAttribute('data-kb-t'))`)
const slug = (s) => String(s).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()

try {
  await page.send('Runtime.enable', {})
  page.on('Runtime.exceptionThrown', (p) => { errors.push(String((p.exceptionDetails && (p.exceptionDetails.exception && p.exceptionDetails.exception.description || p.exceptionDetails.text)) || 'exception').slice(0, 300)) })
  const rowsDone = new Set()
  for (const lang of LANGS) {
    for (const scheme of SCHEMES) {
      for (const width of WIDTHS) {
        for (const uaKey of UAS) {
          const ua = uaKey === 'full' ? FULL_UA : KABY_UA
          const combo = `${uaKey === 'full' ? 'full' : 'simple'}-${width}-${lang}-${scheme}`
          console.log('\n' + combo)
          for (const emptyTasks of [true, false]) {
            const mark = combo + (emptyTasks ? '' : '-withlist')
            await intoPhone({ ua, width, scheme, lang, emptyTasks })
            const dark = await ev(`document.body.hasAttribute('data-ds-dark-theme')`)
            if ((scheme === 'dark') !== (dark === true)) found(mark, 'the scheme asked for (' + scheme + ') is not the one drawn', { dark })
            else ok()
            await openDrawer(); await sleep(400)
            const rows = (await drawerRows()) || []
            // with a list only Automations changes (the guide button): the other rows were seen with the empty list
            for (const row of (emptyTasks ? rows : rows.filter((r) => r === 'tasks')).filter(wanted)) {
              if (!(await exists(`[data-kb-row="${row}"]`))) await openDrawer()
              await click(`[data-kb-row="${row}"]`); await sleep(1600)
              await inspectPage(mark + '-row-' + slug(row), mark + ' › ' + row, width, lang)
              await openDrawer(); await sleep(300)
            }
            if (!emptyTasks) continue
            // Settings, page by page (the phone lists one page at a time)
            await click(AVATAR); await sleep(500)
            if (!(await waitFor(page, `!!document.querySelector('[data-kb="menu-settings"]')`, 5000))) { found(mark, 'the account menu has no Settings'); continue }
            await click('[data-kb="menu-settings"]')
            await waitFor(page, `!!document.querySelector('${DIALOG}')`, 8000)
            await sleep(900)
            const pages = (await shownPages()) || []
            report.push({ combo: mark, settingsPages: pages })
            for (const key of pages.filter(wanted)) {
              if (!(await exists(`${DIALOG} [data-kb-t="${key}"]`))) { await click(`${DIALOG} [data-kbmob-back]`).catch(() => {}); await sleep(900) }
              await click(`${DIALOG} [data-kb-t="${key}"]`).catch((e) => found(mark + ' › settings:' + key, 'the page cell could not be tapped', e.message))
              await sleep(1700)
              await inspectPage(mark + '-set-' + slug(key), mark + ' › settings: ' + key, width, lang)
              await click(`${DIALOG} [data-kbmob-back]`).catch(() => {}); await sleep(900)
            }
          }
        }
      }
    }
  }
  if (LANGS.includes('fr')) {
    // leave the sandbox as it was found: DSH keeps its language on the host (the French seed put it on `fr`)
    await intoPhone({ ua: KABY_UA, width: 390, scheme: 'light', lang: 'en', emptyTasks: true })
    await ev(`localStorage.removeItem('kb_live_seeded')`)
    await openDrawer(); await click(AVATAR); await sleep(500); await click('[data-kb="menu-settings"]'); await sleep(1500)
    await click(`${DIALOG} [data-kb-t="language"]`); await sleep(1500)
    await click('.kbln-lang:not(.on) button'); await sleep(13000)
    const l = await ev(`document.documentElement.lang`)
    if (l !== 'en') console.log('  (the language was left on ' + l + ': play it again, or choose English on the Language page)')
  }
  if (SCHEMES.includes('dark')) { await intoPhone({ ua: KABY_UA, width: 390, scheme: 'light', lang: 'en', emptyTasks: true }) }
  if (errors.length > 0) found('page', 'script errors', errors)
} catch (e) {
  found('the script itself', e.message)
  try { await shot('99-stopped') } catch (e2) { /* nothing */ }
} finally {
  if (shotsDir !== null) { try { writeFileSync(join(shotsDir, 'report.json'), JSON.stringify({ report, findings }, null, 1)) } catch (e) { /* nothing */ } }
  await live.close()
}
console.log('\n' + (findings.length === 0 ? '✓ ' + pass + ' checks, 0 defects' : '✗ ' + pass + ' passed, ' + findings.length + ' defect(s)'))
process.exit(findings.length === 0 ? 0 : 1)
