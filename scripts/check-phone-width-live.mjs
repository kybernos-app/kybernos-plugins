#!/usr/bin/env node
// What did not fit a phone (and a few things that did not fit 1400 px), on a REAL GUI (audit 2026-10-16, package « Cards, lists and the
// phone width »).
//
//   source scripts/sandbox/env.sh && node scripts/check-phone-width-live.mjs [--shots <dir>]
//
// Needs a DSH that serves this checkout (scripts/sandbox/start.sh); refuses :3080 and any DSH home that is not a sandbox's. It writes one
// slash command to the sandbox's store (« wp17-widget ») and deletes it again. Nothing leaves the machine and no model is called.
//
// At 390 x 844, Android phone emulation (the width kybernos-mobile lays out for):
//   - A3-20 / A3-23  a switch keeps its pill (34-40 x 20-22 px, never a 40 px square) in Web Search, Auto Routing, General, About, Kybernos
//                    Suite and Usage; the radios of Connectors are round dots; the segmented options of Auto Routing keep 40 px;
//   - A3-19 / Tools  Workers and Tools (and Web Search, AI Provider, Commands) do not scroll sideways; the Workers chevron is on screen;
//   - A3-18          the « Kybernos Cloud » banner of AI provider and models is about 190 px, not 390;
//   - A3-22          a command's name keeps 100 px or more; the search field (one bar with the tabs, 150 px at least) is not cut by the page; the tabs fit;
//   - A5-05          the four tabs of the Skills page are all on screen, no strip to slide;
//   - A4-10 / A4-31  the Creations tiles are one strip (about 104 px high: the 64 px drawing, its label, the margins) that slides sideways and the first card starts above 700 px;
//   - A1-20          the drawer's session search opens with a field of 80 px or more (it was 4);
//   - A4-32          the transport row of Briques stays on screen (when the panel can be opened).
// At 1400 x 900:
//   - A4-23          Atlas › Around: the four columns are inside their card;
//   - A4-10 / C-04   ten type tiles of Creations are equal in width on at most two rows, and no label is cut (1100, 1280 and 1400 px).
// At 800 px (the engine's 44 px icon rail):
//   - A5-30          each page icon of the sidebar has its own name (aria-label and title), all different;
//   - A5-29          the goal-progress card is not drawn in the rail.
// Exit code 0 / 1 / 3 (3 = inconclusive: no sandbox).
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, openSettings, clickText } from './live-page.mjs'

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
if (shotDir !== null) mkdirSync(shotDir, { recursive: true })

const live = await openLivePage({ width: 1400, height: 900 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const ev = async (js) => { const r = await page.evalJs(js, 10000); return r.err ? { __err: r.err } : r.val }
const shot = async (name) => { if (shotDir !== null) await page.shot(join(shotDir, name + '.png')).catch(() => {}) }
const press = async (x, y) => { for (const t of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type: t, x, y, button: 'left', clickCount: 1 }) }
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'
const phone = async (w = 390, h = 844) => {
  await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true })
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true })
  await page.send('Emulation.setUserAgentOverride', { userAgent: ANDROID, platform: 'Linux armv8l' })
}
const desktop = async (w = 1400, h = 900) => {
  await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false })
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: false })
  await page.send('Emulation.setUserAgentOverride', { userAgent: '', platform: '' })
}
const reload = async (ms = 5500) => { await page.send('Page.reload', {}); await sleep(ms) }
const drawerGo = async (label) => {
  await ev(`(() => { const b = document.querySelector('[data-kb="mobile-menu"]'); if (b) b.click(); return !!b })()`)
  await sleep(900)
  const at = await ev(`(() => { const e = Array.from(document.querySelectorAll('[data-slot="sidebar"] button')).filter((x) => { const r = x.getBoundingClientRect(); return r.width > 2 && r.height > 2 }).find((x) => (x.innerText || '').replace(/\\s+/g, ' ').trim().toLowerCase().startsWith(${JSON.stringify(label.toLowerCase())})); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + 60, y: r.y + r.height / 2 } })()`)
  if (at === null || at.__err) return false
  await press(at.x, at.y)
  await sleep(3000)
  return true
}
// A Settings page: reload, open Settings, pick the cell (a finger on the list, as the phone's client does), wait.
const settingsPage = async (label) => {
  await reload()
  if ((await openSettings(page, { minCells: 3 })) !== true) return false
  const c = await ev(`(() => { const e = Array.from(document.querySelectorAll('[class*="navCell"]')).find((x) => x.innerText.trim() === ${JSON.stringify(label)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
  if (c === null || c.__err) return false
  await press(c.x, c.y)
  await sleep(2500)
  return true
}
// A box of the page that scrolls sideways (a code block, `pre`, does so on purpose: its text is not wrapped)
const sideways = () => ev(`(() => { const m = document.querySelector('[data-shortcut-modal="settings"]'); if (!m) return 'no settings'; const sc = Array.from(m.querySelectorAll('*')).find((e) => e.tagName !== 'PRE' && e.tagName !== 'CODE' && /(auto|scroll)/.test(getComputedStyle(e).overflowX) && e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 200); return sc ? String(sc.className).slice(0, 30) + ' ' + sc.scrollWidth + '/' + sc.clientWidth : null })()`)
const dims = (sel) => ev(`Array.from(document.querySelectorAll('[data-shortcut-modal="settings"] ${sel}')).filter((e) => e.getBoundingClientRect().width > 1).map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)] })`)

const slash = (body) => ev(`fetch('/kybernos/slash/entries', { method: 'POST', headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }).then((r) => r.status)`)

try {
  await sleep(3000)
  await phone()

  console.log('Settings pages at 390 px: switches, radios, sideways scroll')
  for (const label of ['General', 'About', 'Web Search', 'Auto Routing', 'Kybernos Suite', 'Usage']) {
    if (!(await settingsPage(label))) { console.log('  ○ ' + label + ' did not open'); continue }
    const sw = await dims('[role=switch]')
    if (sw.length === 0) { console.log('  ○ ' + label + ' has no switch in this instance'); continue }
    check(label + ': every switch is a pill (wider than high, 40 px wide at most, 24 px high at most)', sw.every(([w, h]) => w > h && w <= 40 && h <= 24), sw)
    check(label + ': the page does not scroll sideways', (await sideways()) === null, await sideways())
    if (label === 'Web Search') await shot('phone-web-search')
  }
  if (await settingsPage('Auto Routing')) {
    const seg = await dims('[role=radio]')
    check('Auto Routing: the segmented options (they have a label) keep their 40 px', seg.length >= 3 && seg.every(([, h]) => h >= 40), seg)
  }
  if (await settingsPage('Connectors')) {
    const rad = await dims('[role=radio]')
    check('Connectors: the provider radios are round dots (18 x 18, not 40 px squares)', rad.length >= 2 && rad.every(([w, h]) => w === h && w <= 24), rad)
    await shot('phone-connectors')
  }
  for (const label of ['Workers', 'Tools', 'AI provider and models', 'Commands']) {
    if (!(await settingsPage(label))) { console.log('  ○ ' + label + ' did not open'); continue }
    check(label + ': the page does not scroll sideways', (await sideways()) === null, await sideways())
    if (label === 'Workers') {
      const chev = await ev(`Array.from(document.querySelectorAll('.kbwk-chev')).filter((e) => e.getBoundingClientRect().width > 0).map((e) => Math.round(e.getBoundingClientRect().right))`)
      check('Workers: the chevron of every row is on screen (it ended at 409)', chev.length > 0 && chev.every((r) => r <= 390), chev)
      await shot('phone-workers')
    }
    if (label === 'AI provider and models') {
      const hero = await ev(`(() => { const h = document.querySelector('.kbmh-hero'); return h ? Math.round(h.getBoundingClientRect().height) : null })()`)
      if (hero === null) console.log('  ○ no « Kybernos Cloud » card in this instance')
      else check('AI provider and models: the Cloud card is one card tall, 110 px or less (the banner it replaces was ~390)', hero <= 110, hero)
      await shot('phone-ai-provider')
    }
  }

  console.log('Commands & actions at 390 px')
  const seeded = (await slash({ entry: { slug: 'wp17-widget', template: 'Make a {{kind}} about {{topic}} for {{audience}}', order: 99 } })) === 200
  try {
    if (!seeded) console.log('  ○ the sandbox refused the test command: the Commands row is not measured')
    else if (await settingsPage('Commands')) {
      const m = await ev(`(() => { const m = document.querySelector('[data-shortcut-modal="settings"]'); const row = Array.from(m.querySelectorAll('.kbsl-lrow')).find((r) => /wp17-widget/.test(r.innerText)); const name = row ? row.querySelector('.kbsl-slug') : null; const s = m.querySelector('.kbsl-search'); const page = m.querySelector('.kbsl-page'); const tabs = Array.from(m.querySelectorAll('.kbsl-tab')).map((t) => Math.round(t.getBoundingClientRect().top)); return { name: name ? Math.round(name.getBoundingClientRect().width) : null, search: s ? Math.round(s.getBoundingClientRect().width) : null, searchRight: s ? Math.round(s.getBoundingClientRect().right) : null, page: page ? Math.round(page.getBoundingClientRect().width) : null, pageRight: page ? Math.round(page.getBoundingClientRect().right) : null, tabsOneLine: new Set(tabs).size === 1 } })()`)
      check('Commands: the command\'s name keeps 100 px or more (it kept ~25)', m.name !== null && m.name >= 100, m)
      // The search shares its bar with the tabs (flex 1 1 150px, 260 at most): it is not stretched to the page any more, it must not be cut by it.
      check('Commands: the search field is at least 150 px wide and inside the page (it was cut at 220 px)', m.search !== null && m.page !== null && m.search >= 150 && m.searchRight <= m.pageRight + 1, m)
      check('Commands: the two tabs share one line', m.tabsOneLine === true, m)
      await shot('phone-commands')
    }
  } finally { await slash({ delete: 'wp17-widget' }) }

  console.log('Skills, Creations, the drawer\'s search at 390 px')
  await reload()
  if (await drawerGo('Skills')) {
    await ev(`new Promise((r) => setTimeout(r, 2500))`)
    const t = await ev(`(() => { const tabs = Array.from(document.querySelectorAll('.kbsub-group [role=tab]')).filter((e) => e.getBoundingClientRect().width > 2); return { n: tabs.length, rights: tabs.map((e) => Math.round(e.getBoundingClientRect().right)) } })()`)
    check('Skills: every tab is on screen (« Team » ended at 400)', t.n >= 3 && t.rights.every((r) => r <= 390), t)
    await shot('phone-skills')
  } else console.log('  ○ the drawer did not offer Skills')
  await reload()
  if (await drawerGo('Creations')) {
    const c = await ev(`(() => { const row = document.querySelector('[data-kb=type-tiles]'); const first = document.querySelector('.kb6-card, [data-kb=art-row]'); if (!row) return null; return { strip: row.scrollWidth > row.clientWidth, rowH: Math.round(row.getBoundingClientRect().height), tiles: row.children.length, firstTop: first ? Math.round(first.getBoundingClientRect().top) : null, sideways: document.documentElement.scrollWidth > innerWidth } })()`)
    if (c === null) console.log('  ○ the type tiles are not there')
    else {
      check('Creations: the type tiles are one strip, 110 px high at most (they took 368-460 px)', c.rowH <= 110, c)
      check('Creations: the first card starts above 700 px (it started at 976)', c.firstTop === null || c.firstTop <= 700, c)
      check('Creations: the page does not scroll sideways', c.sideways === false, c)
    }
    await shot('phone-creations')
  } else console.log('  ○ the drawer did not offer Creations')
  await reload()
  await ev(`(() => { const b = document.querySelector('[data-kb="mobile-menu"]'); if (b) b.click(); return !!b })()`)
  await sleep(1000)
  const mag = await ev(`(() => { const b = Array.from(document.querySelectorAll('[data-slot="sidebar"] button')).find((x) => /Search sessions/i.test(x.getAttribute('aria-label') || x.title || '')); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
  if (mag === null || mag.__err) console.log('  ○ no « Search sessions » button in the drawer')
  else {
    await press(mag.x, mag.y)
    await sleep(1000)
    const w = await ev(`(() => { const i = document.querySelector('[data-slot="sidebar"] input'); return i ? Math.round(i.getBoundingClientRect().width) : null })()`)
    check('the drawer\'s session search opens with a field of 80 px or more (it was 4 px)', w !== null && w >= 80, w)
    await shot('phone-search')
  }

  console.log('Briques at 390 px')
  await reload()
  await ev(`(() => { const b = document.querySelector('button[data-sidebar-right-expand]'); if (b) b.click(); return !!b })()`)
  await sleep(1500)
  const opened = await ev(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => x.innerText.trim() === 'Briques'); if (!b) return false; b.click(); return true })()`)
  await sleep(1500)
  if (opened !== true || (await ev(`!!document.querySelector('.kbb-root')`)) !== true) console.log('  ○ the Briques panel could not be opened here')
  else {
    await ev(`(() => { const c = Array.from(document.querySelectorAll('.kbb-chip')).find((b) => /Phare|Lighthouse|Harbor/i.test(b.innerText)); if (c) c.click(); return !!c })()`)
    await sleep(2500)
    await ev(`(() => { const b = document.querySelector('.kbb-step[title="Fin"]'); if (b) b.click(); return !!b })()`)
    await sleep(800)
    const t = await ev(`(() => { const l = document.querySelector('.kbb-line'); if (!l) return null; return Array.from(l.children).map((e) => Math.round(e.getBoundingClientRect().right)) })()`)
    if (t === null) console.log('  ○ no demo could be played')
    else check('Briques: every control of the transport row is on screen (the badge ended at 408)', t.every((r) => r <= 390), t)
    await shot('phone-bricks')
  }

  console.log('1400 px: Atlas, Creations tiles')
  await desktop()
  await reload()
  if ((await openSettings(page, { minCells: 3 })) === true) {
    const c = await ev(`(() => { const e = Array.from(document.querySelectorAll('[class*="navCell"]')).find((x) => x.innerText.trim() === 'Atlas'); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
    if (c === null || c.__err) console.log('  ○ no Atlas page here')
    else {
      await press(c.x, c.y)
      await sleep(2000)
      const u = await ev(`(() => { const b = Array.from(document.querySelectorAll('button')).filter((x) => (x.innerText || '').trim() === 'Update' && x.getBoundingClientRect().width > 0).pop(); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
      if (u === null) console.log('  ○ no Update button')
      else {
        await press(u.x, u.y)
        await sleep(7000)
        const a = await ev(`(() => { const g = document.querySelector('.kbat-grid'); const card = document.querySelector('.kbat-around'); if (!g || !card) return null; const cr = card.getBoundingClientRect(); const cols = Array.from(g.querySelectorAll('.kbat-col')).map((e) => Math.round(e.getBoundingClientRect().right)); return { cols, cardRight: Math.round(cr.right), scroll: card.scrollWidth > card.clientWidth + 1 } })()`)
        if (a === null) console.log('  ○ the Around view did not draw')
        else check('Atlas › Around: the four columns are inside their card and the card does not scroll sideways', a.cols.length === 4 && a.cols.every((r) => r <= a.cardRight) && a.scroll === false, a)
        await shot('atlas-1400')
      }
    }
  }
  await reload()
  await clickText(page, 'Creations')
  await sleep(3500)
  // C-04: a tile is wide enough for its whole label (« Spreadsheets », « Audio & Video » were cut at 1100-1280 px); ten tiles may take two rows, and they stay equal in width
  // (the one that wraps alone is not stretched).
  const ten = await ev(`(() => { const row = document.querySelector('[data-kb=type-tiles]'); if (!row) return null; const last = row.lastElementChild; while (row.children.length < 10) row.appendChild(last.cloneNode(true)); const t = Array.from(row.children); const cut = Array.from(row.querySelectorAll('.kb-type-lab')).filter((l) => l.scrollWidth > l.clientWidth + 1).map((l) => l.textContent); return { rows: new Set(t.map((x) => Math.round(x.getBoundingClientRect().top))).size, widths: Array.from(new Set(t.map((x) => Math.round(x.getBoundingClientRect().width)))), cut } })()`)
  if (ten === null) console.log('  ○ the type tiles are not there')
  else check('ten type tiles are equal in width, take at most two rows at 1400 px, and no label is cut', ten.rows <= 2 && ten.widths.length === 1 && ten.cut.length === 0, ten)
  for (const w of [1100, 1280]) {
    await phone(w, 800)
    await reload()
    await clickText(page, 'Creations')
    await sleep(3000)
    const cutAt = await ev(`(() => { const row = document.querySelector('[data-kb=type-tiles]'); if (!row) return null; return Array.from(row.querySelectorAll('.kb-type-lab')).filter((l) => l.scrollWidth > l.clientWidth + 1).map((l) => l.textContent) })()`)
    if (cutAt !== null) check('Creations at ' + w + ' px: every type tile shows its whole label (« Spreadsheets », « Audio & Video » were cut)', cutAt.length === 0, cutAt)
  }
  await phone(1400, 900)

  console.log('The 44 px icon rail (800 px)')
  await phone(800, 900)
  await reload()
  const rail = await ev(`(() => { const items = Array.from(document.querySelectorAll('.kb4-item')).filter((e) => e.getBoundingClientRect().width > 0); const names = items.map((e) => e.getAttribute('aria-label') || ''); const labelShown = items.some((e) => { const l = e.querySelector('.kb4-lab'); return l && l.getBoundingClientRect().width > 0 }); return { n: items.length, names, titles: items.every((e) => (e.getAttribute('title') || '') === (e.getAttribute('aria-label') || '')), labelShown } })()`)
  if (rail.n === 0) console.log('  ○ no page icon in the sidebar at 800 px')
  else {
    check('every page icon has a name, and they are all different (the tooltip was « Kybernos » for the eight)', rail.names.every((n) => n !== '') && new Set(rail.names).size === rail.n && rail.titles === true, rail)
    if (rail.labelShown) console.log('  ○ the sidebar is not a rail at 800 px in this DSH: the rail checks that follow are skipped')
    else {
      const bar = await ev(`(() => { const host = document.querySelector('.kb4-menu'); if (!host) return null; const p = host.parentElement; const stub = document.createElement('div'); stub.className = 'kbp-bar'; stub.textContent = 'Progression'; p.appendChild(stub); const d = getComputedStyle(stub).display; stub.remove(); return d })()`)
      if (bar === null) console.log('  ○ no menu to put a goal card in')
      else check('the goal-progress card is not drawn in the rail (display: none)', bar === 'none', bar)
    }
    await shot('phone-rail')
  }
} catch (e) {
  fail += 1
  console.log('  ✗ ' + (e && e.message ? e.message : e))
} finally {
  await live.close()
}
console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
