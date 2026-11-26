#!/usr/bin/env node
// The phone layer's frame, in a real GUI at the size of a phone, in the four ways DSH reaches a phone. The regression this guards: on 2026-11-07 the phone look
// shrank the shell grid to three tracks (0 / 1fr / 0) and the Android app showed every screen BLANK, because there the engine's own `grid-area` of the centre and
// right columns was not in force: the page was auto-placed in the 0 px track and the empty right bar covered the screen. The browser sandbox could not show it.
//
//   source scripts/sandbox/env.sh && node scripts/check-phone-frame-live.mjs
//
// For each way, on Home and on two global pages (Front desk: narrow content; Skills: wide content), it measures the centre column, the page and what a tap at
// the middle of the screen would hit:
//   browser   a phone browser (no shell token)
//   app       the Android app (`KybernosHost/…`: <html class="kb-app kb-app-android">, NOT kb-kaby)
//   app-auto  the app with the engine's `grid-area` of the three columns switched off (the placement measured in the real app)
//   app-top   the app with the engine's top clearance at 60 px (the engine then pads a global page by nothing: what the real app showed, the first row
//             of every page under the fixed title band)
//   app-old   an engine that places nothing and pads nothing, as the real app seemed to be: the engine's placement of the frame and of the Settings
//             boxes switched off, the `data-global-panel` mark taken off the pages (the 0.2.1 look: no mark, no `grid-area`)
//   kaby      Kaby mode (`… KabyMode/1`, <html class="kb-kaby">): Home only, there is no drawer
// Passes when the centre column is the whole width, the page is not squeezed, the right bar is not what a tap hits and no control of a global page sits
// under the title band. In the app ways it also taps the drawer's « Settings » row and expects DSH's Settings to open; with a Settings page open, the
// close cross sits on the « Settings » bar and the page starts right under it (no row of its own for the cross). On Home, a composer that takes the
// focus by itself lets go of it (no keyboard) and a tap in it focuses it.
// In the app-old way every global page is swept for the three things the real phone showed: text under the 56 px title band, a tab label broken on two lines (the
// real font is wider than the sandbox's: the tabs are checked with a bigger one), the floating button over the last content (checked at the end of the scroll); and
// Connectors' secondary button has a fill and its add menu has icons. In a browser the maintenance pages show their engine audit; in the app they do not.
// An isolated DSH only (the sandbox: it refuses :3080 and any DSH home that is not a sandbox's). Exit code 0: all good, 1: a check failed, 3: it cannot start.
import { openGui, sleep } from './lib-e2e-gui.mjs'

const host = process.env.KB_HOST || '127.0.0.1:3080'
const home = process.env.DSH_HOME || ''
if (/:3080$/.test(host) || !home.includes('.kybernos-sandbox')) { console.error('○ inconclusive: needs a sandbox DSH (source scripts/sandbox/env.sh), not :3080.'); process.exit(3) }

const W = 406
const H = 757
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; 23127PN0CC) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'
const APP_TOKEN = ' KybernosHost/0.1.0 (android) KybernosCaps/where,account,plans'
const WAYS = [
  { id: 'browser', ua: ANDROID, shell: false, auto: false, pages: [null, 'Front desk', 'Skills'] },
  { id: 'app', ua: ANDROID + APP_TOKEN, shell: true, auto: false, pages: [null, 'Front desk', 'Skills'] },
  // a signed-in account (the status of the cloud plugin answered by the page itself): the real footer card and its real menu are drawn, inside the real drawer's boxes
  { id: 'app-signed', ua: ANDROID + APP_TOKEN + ',referral,signout', shell: true, auto: false, account: true, pages: [null] },
  { id: 'app-auto', ua: ANDROID + APP_TOKEN, shell: true, auto: true, pages: [null, 'Front desk', 'Skills'] },
  { id: 'app-top', ua: ANDROID + APP_TOKEN, shell: true, auto: false, top: true, pages: [null, 'Creations', 'Skills'] },
  { id: 'app-old', ua: ANDROID + APP_TOKEN, shell: true, auto: true, bare: true, top: true, sweep: true, pages: [null, 'Connectors', 'Automations', 'Agent Teams', 'Skills', 'Creations'] },
  { id: 'kaby', ua: ANDROID + APP_TOKEN + ' KabyMode/1', shell: true, auto: false, pages: [null] },
]
const SIGNED_IN = { ok: true, connected: true, state: { user: { name: 'milou7', email: 'milou7@example.test', plan: 'free' }, workspaces: [{ id: 'ws-1', name: 'Personal', personal: true }], active_workspace_id: 'ws-1', space_plan: { key: 'free', label: 'Free', workspace_id: 'ws-1' } } }
const AUTO_CSS = '[class*="_centerCol"], [class*="_rightbarCol"], [class*="_sidebarCol"], [data-shortcut-modal="settings"] > * { grid-area: auto !important }'

let failed = 0
const check = (name, ok, detail) => {
  if (!ok) failed += 1
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (!ok && detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 300) : ''))
}

const MEASURE = `(() => {
  const f = document.querySelector('[data-slot="root"] > div:has(> [data-shell-overlay])')
  if (!f) return JSON.stringify({ noFrame: true })
  const centre = Array.from(f.children).find((c) => c.matches('div:not([data-sidebar-mask], [data-rightbar-col], [data-shell-bottom], [data-shell-overlay], [data-shell-leading])') && !c.querySelector(':scope > [data-slot="sidebar"]'))
  const bar = f.querySelector(':scope > [data-rightbar-col]')
  const at = document.elementFromPoint(${Math.round(W / 2)}, ${Math.round(H / 2)})
  const band = document.querySelector('.kb6-titlerow')
  // the page region as the engine draws it (\`data-slot="main"\`), not the \`data-global-panel\` mark the real app's engine does not put on the page
  const tops = Array.from(document.querySelectorAll('[data-slot="main"] button, [data-slot="main"] input, [data-slot="main"] a[href]'))
    .filter((e) => !(band && band.contains(e)) && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0 && getComputedStyle(e).position !== 'fixed')
    .map((e) => Math.round(e.getBoundingClientRect().top))
  return JSON.stringify({
    firstTop: tops.length > 0 ? Math.min(...tops) : null,
    bandBottom: band ? Math.round(band.getBoundingClientRect().bottom) : null,
    centre: centre ? Math.round(centre.getBoundingClientRect().width) : 0,
    centreX: centre ? Math.round(centre.getBoundingClientRect().x) : null,
    hitsBar: !!(bar && at && (bar === at || bar.contains(at))),
    html: document.documentElement.className,
  })
})()`

// `--only app-old` runs one way (a quick look while working); without it every way runs
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null
for (const way of WAYS) {
  if (only !== null && way.id !== only) continue
  console.log('\n' + way.id)
  const g = await openGui(host, { width: 1400, height: 900 })
  const send = (m, p) => g.page.send(m, p)
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 3, mobile: true })
  await send('Emulation.setTouchEmulationEnabled', { enabled: true })
  // a headless page does not have the focus, so no focus event is fired (a page of a phone has it): without this the focus checks see nothing
  await send('Emulation.setFocusEmulationEnabled', { enabled: true })
  if (way.account) await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const of = window.fetch; const FIX = ${JSON.stringify(SIGNED_IN)}; window.fetch = function (u, i) { const s = String((u && u.url) || u); if (/kybernos-cloud\\/status/.test(s)) return Promise.resolve(new Response(JSON.stringify(FIX), { status: 200, headers: { 'content-type': 'application/json' } })); return of.apply(this, arguments) } })()` })
  if (way.shell) await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__posted=[];window.ReactNativeWebView={postMessage:function(m){window.__posted.push(m)}}' })
  await send('Emulation.setUserAgentOverride', { userAgent: way.ua, platform: 'Linux armv81', userAgentMetadata: { platform: 'Android', platformVersion: '14.0.0', architecture: '', model: '23127PN0CC', mobile: true, brands: [{ brand: 'Chromium', version: '130' }] } })
  // not g.reload(): it waits for the account card, which a phone layout (or the app's `account` capability) keeps out of the page
  await g.val('window.__kbStale = true')
  await send('Page.reload', { ignoreCache: true })
  await g.waitFor(`window.__kbStale === undefined && document.readyState === 'complete' && document.querySelector('[data-slot="root"] > div > [data-shell-overlay]') !== null`, 30000)
  await g.dismissGetStarted(); await sleep(2200)
  if (way.top) { await g.val(`document.querySelector('[data-sidebar-drawer]').style.setProperty('--dsh-frame-top-clearance', '60px')`); await sleep(500) }
  if (way.auto) { await g.val(`(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(AUTO_CSS)}; document.head.appendChild(s) })()`); await sleep(500) }
  const tap = async (js) => {
    const c = await g.val(`(() => { const e = ${js}; if (!e) return 'null'; const r = e.getBoundingClientRect(); return JSON.stringify([Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]) })()`)
    const xy = typeof c === 'string' ? JSON.parse(c) : c
    if (xy === null) return false
    await g.mouse(xy[0], xy[1]); await sleep(1000); return true
  }
  const sweep = async (label) => {
    const r = JSON.parse(await g.val(`(() => {
      const main = document.querySelector('[data-slot="main"]'); const band = document.querySelector('.kb6-titlerow')
      let top = null, what = ''
      const w = document.createTreeWalker(main, NodeFilter.SHOW_TEXT)
      for (let n; (n = w.nextNode());) { if (!n.textContent.trim()) continue; const el = n.parentElement; if (!el || (band && band.contains(el)) || el.closest('.kbmob-menu')) continue; const cs = getComputedStyle(el); if (cs.position === 'fixed' || cs.visibility === 'hidden' || cs.display === 'none') continue
        const rg = document.createRange(); rg.selectNodeContents(n); const b = rg.getBoundingClientRect(); if (b.width > 0 && b.height > 0 && (top === null || b.top < top)) { top = b.top; what = n.textContent.trim().slice(0, 20) } }
      return JSON.stringify({ textTop: top === null ? null : Math.round(top), what, bandBottom: band ? Math.round(band.getBoundingClientRect().bottom) : null })
    })()`))
    if (r.textTop !== null) check(`${label}: no text sits under the title band (the first is « ${r.what} » at ${r.textTop}${r.bandBottom !== null ? ', the band ends at ' + r.bandBottom : ''})`, r.bandBottom === null || r.textTop >= r.bandBottom, r)
    // the tab rows, with a font wider than the sandbox's (the real phone broke « MCP servers » on two lines)
    await g.val(`(() => { const s = document.createElement('style'); s.id = 'kb-check-wide'; s.textContent = '[data-slot="main"] [role="tab"] { font-size: 21px !important }'; document.head.appendChild(s) })()`); await sleep(400)
    const tabs = JSON.parse(await g.val(`(() => JSON.stringify(Array.from(document.querySelectorAll('[data-slot="main"] [role="tablist"]')).filter((b) => b.getBoundingClientRect().width > 0).map((b) => ({ ovx: getComputedStyle(b).overflowX, wrap: getComputedStyle(b).flexWrap, tabs: Array.from(b.querySelectorAll('[role="tab"]')).map((t) => ({ ws: getComputedStyle(t).whiteSpace, shrink: getComputedStyle(t).flexShrink })) }))))()`))
    await g.val(`document.getElementById('kb-check-wide').remove()`)
    if (tabs.length > 0) check(`${label}: the tab row keeps one line per label and slides (${tabs.length} row${tabs.length > 1 ? 's' : ''})`, tabs.every((b) => b.ovx === 'auto' && b.wrap === 'nowrap' && b.tabs.every((t) => t.ws === 'nowrap' && t.shrink === '0')), tabs)
    // a floating button never stays over the last content once the page is scrolled to its end
    const fab = JSON.parse(await g.val(`(() => {
      const main = document.querySelector('[data-slot="main"]'); const fab = Array.from(main.querySelectorAll('.kb8-primary')).find((e) => getComputedStyle(e).position === 'fixed' && e.getBoundingClientRect().width > 0)
      if (!fab) return JSON.stringify(null)
      const sc = Array.from(main.querySelectorAll('*')).filter((e) => { const cs = getComputedStyle(e); return (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 4 }).sort((a, b) => b.clientHeight - a.clientHeight)[0]
      if (sc) sc.scrollTop = sc.scrollHeight
      const fr = fab.getBoundingClientRect(); let bottom = 0
      for (const e of main.querySelectorAll('*')) { if (fab.contains(e) || e.contains(fab)) continue; const cs = getComputedStyle(e); if (cs.position === 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') continue; if (e.children.length > 0 && !/^(P|SPAN|BUTTON|A|H1|H2|H3|SMALL|LABEL)$/.test(e.tagName) && !/card|item|row|box|empty/i.test(String(e.className))) continue; const r = e.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0 || r.top < 60 || r.top > innerHeight) continue; if (r.bottom > bottom) bottom = r.bottom }
      if (sc) sc.scrollTop = 0
      return JSON.stringify({ fabTop: Math.round(fr.top), lastBottom: Math.round(bottom) })
    })()`))
    if (fab !== null) check(`${label}: the floating button clears the last content at the end of the page (content ends at ${fab.lastBottom}, the button starts at ${fab.fabTop})`, fab.lastBottom <= fab.fabTop, fab)
    if (label === 'Connectors') {
      // a secondary button (« Browse the catalog ») has a fill; its tone is the second card tone, never transparent
      await g.val(`(() => { const b = document.createElement('button'); b.type = 'button'; b.className = 'kbcp-btn'; b.id = 'kb-check-browse'; b.textContent = 'Browse the catalog'; document.querySelector('[data-slot="main"]').appendChild(b) })()`); await sleep(300)
      const br = JSON.parse(await g.val(`(() => { const b = document.getElementById('kb-check-browse'); const cs = getComputedStyle(b); const r = b.getBoundingClientRect(); const out = { bg: cs.backgroundColor, h: Math.round(r.height) }; b.remove(); return JSON.stringify(out) })()`))
      check(`Connectors: a secondary button has a fill (${br.bg}) and is 44 px high (${br.h})`, !/rgba\(0, 0, 0, 0\)|transparent/.test(br.bg) && br.h >= 44, br)
      // the add menu: every row has an icon, like the Agent Teams menu
      await g.val(`document.querySelector('[data-kb="connector-create"]').click()`); await sleep(900)
      const rows = JSON.parse(await g.val(`(() => JSON.stringify({ n: document.querySelectorAll('.kbcp-menu button').length, noIcon: Array.from(document.querySelectorAll('.kbcp-menu button')).filter((b) => !b.querySelector('svg')).length }))()`))
      check(`Connectors: every row of the « Add an MCP server » menu has an icon (${rows.n} rows)`, rows.n > 0 && rows.noIcon === 0, rows)
      // closed again by its own button (the sheet is a layer: Escape alone left it over the drawer's button)
      await g.val(`(() => { if (document.querySelector('.kbcp-menu')) document.querySelector('[data-kb="connector-create"]').click() })()`); await sleep(500)
      await g.key('Escape', 'Escape', 27); await sleep(600)
    }
  }
  for (const page of way.pages) {
    const label = page === null ? 'Home' : page
    if (page !== null) {
      await tap(`document.querySelector('.kbmob-menu')`)
      const ok = await tap(`Array.from(document.querySelectorAll('[data-slot="sidebar"] nav button')).find((x) => (x.innerText || '').trim().startsWith(${JSON.stringify(page)}))`)
      if (!ok) { check(`${label}: the page opens`, false, 'the drawer entry was not found'); continue }
      await sleep(1800)
    }
    if (way.bare) { await g.val(`document.querySelectorAll('[data-global-panel]').forEach((e) => e.removeAttribute('data-global-panel'))`); await sleep(300) }
    const raw = await g.val(MEASURE)
    const m = typeof raw === 'string' ? JSON.parse(raw) : raw
    check(`${label}: the centre column is the whole width (${m.centre} px of ${W})`, m.noFrame !== true && m.centre >= W - 2 && m.centreX === 0, m)
    check(`${label}: a tap in the middle of the screen does not hit the empty right bar`, m.noFrame !== true && m.hitsBar === false, m)
    if (page === null && way.id !== 'kaby') {
      await g.val(`document.querySelector('[data-composer-input]').focus()`); await sleep(300)
      check('Home: a composer that takes the focus by itself does not keep it (no keyboard)', (await g.val(`!(document.activeElement && document.activeElement.hasAttribute('data-composer-input'))`)) === true)
      const small = await g.val(`JSON.stringify(Array.from(document.querySelectorAll('[data-composer-card] button')).filter((b) => { const r = b.getBoundingClientRect(); return r.width > 2 && r.height > 2 && getComputedStyle(b).visibility !== 'hidden' && (r.width < 43.5 || r.height < 43.5) }).map((b) => (b.getAttribute('aria-label') || '').slice(0, 24) + ' ' + Math.round(b.getBoundingClientRect().width) + 'x' + Math.round(b.getBoundingClientRect().height)))`)
      check('Home: every button of the composer card is at least 44 x 44', small === '[]', small)
      // the Cloud Computer pill says its whole sentence (the core clamps it to two lines; the sentence needs three on a phone)
      const pill = await g.val(`(() => { const d = document.querySelector('.kb8-nc-d'); return d === null ? 'none' : JSON.stringify({ cut: d.scrollHeight > d.clientHeight + 1, clamp: getComputedStyle(d).webkitLineClamp }) })()`)
      check('Home: the Cloud Computer description is not cut', pill === 'none' || JSON.parse(pill).cut === false, pill)
      await tap(`document.querySelector('[data-composer-input]')`)
      check('Home: a tap in the composer focuses it', (await g.val(`!!(document.activeElement && document.activeElement.hasAttribute('data-composer-input'))`)) === true)
      await g.val(`document.activeElement && document.activeElement.blur()`)
    }
    if (page !== null && m.firstTop !== null && m.bandBottom !== null) check(`${label}: no control sits under the fixed title band (first one at ${m.firstTop}, band ends at ${m.bandBottom})`, m.firstTop >= m.bandBottom, m)
    if (page !== null && way.sweep === true) await sweep(label)
  }
  const settingsPage = async (label) => {
    await g.val(`(() => { const b = Array.from(document.querySelectorAll('[data-shortcut-modal="settings"] nav button')).find((x) => /^Auto Routing/.test((x.innerText || '').trim())); if (b) { b.scrollIntoView({ block: 'center' }); b.click() } })()`)
    await sleep(1800)
    const raw = await g.val(`(() => {
      const d = document.querySelector('[data-shortcut-modal="settings"]')
      if (!d) return JSON.stringify({ noDialog: true })
      const x = d.querySelector('button:has([data-slot="settings.close"])')
      const box = Array.from(d.querySelectorAll('*')).find((e) => /Automatic routing/.test(e.textContent || '') && e.children.length > 2 && e.getBoundingClientRect().width > 300)
      return JSON.stringify({ xBottom: x ? Math.round(x.getBoundingClientRect().bottom) : null, pageTop: box ? Math.round(box.getBoundingClientRect().top) : null })
    })()`)
    const m = typeof raw === 'string' ? JSON.parse(raw) : raw
    check(`${label}: on a Settings page the close cross sits on the « Settings » bar (bottom at ${m.xBottom}) and the page starts right under it (top at ${m.pageTop})`, m.noDialog !== true && m.xBottom !== null && m.xBottom <= 76 && m.pageTop !== null && m.pageTop <= 76, m)
  }
  // the maintenance pages: a browser shows the engine audit of the About page, the app does not (and neither shows its update parts)
  const aboutCheck = async (label, expectShown) => {
    for (let i = 0; i < 20 && (await g.val(`typeof window.__kbOpenDshSettings`)) !== 'function'; i += 1) await sleep(700)
    await g.val(`window.__kbOpenDshSettings && window.__kbOpenDshSettings()`); await sleep(2200)
    await g.val(`(() => { const b = Array.from(document.querySelectorAll('[data-shortcut-modal="settings"] nav button')).find((x) => /^About/.test((x.innerText || '').trim())); if (b) { b.scrollIntoView({ block: 'center' }); b.click() } })()`); await sleep(2200)
    const a = JSON.parse(await g.val(`(() => { const h = (k) => { const e = document.querySelector('[data-kb="' + k + '"]'); return e ? Math.round(e.getBoundingClientRect().height) : null }; return JSON.stringify({ tiles: h('maintenance-tiles'), auto: h('maintenance-auto-update'), refresh: h('maintenance-refresh'), version: h('maintenance-version') }) })()`))
    if (expectShown) check(`${label}: the About page shows its engine cards and the update check (a browser keeps them)`, a.tiles > 0 && a.auto > 0 && a.refresh > 0, a)
    else check(`${label}: the About page of the app has no « unknown » engine cards, no update check, and keeps its version line`, (a.tiles === null || a.tiles === 0) && (a.auto === null || a.auto === 0) && (a.refresh === null || a.refresh === 0) && a.version > 0, a)
    await g.val(`document.querySelector('[data-shortcut-modal="settings"] button:has([data-slot="settings.close"])') && document.querySelector('[data-shortcut-modal="settings"] button:has([data-slot="settings.close"])').click()`); await sleep(800)
  }
  if (way.id === 'browser') await aboutCheck(way.id, true)
  if (way.id === 'app-auto') await aboutCheck(way.id, false)
  if (way.id === 'app-old') {
    for (let i = 0; i < 20 && (await g.val(`typeof window.__kbOpenDshSettings`)) !== 'function'; i += 1) await sleep(700)
    await g.val(`window.__kbOpenDshSettings && window.__kbOpenDshSettings()`); await sleep(2200)
    await settingsPage(way.id)
  }
  if (way.id === 'app') {
    // the credit notice (kybernos-cloud's `shell.quota-notice`, drawn here from its own markup: the real one needs a refused call): text across the screen, button under it, cross in the corner
    await g.val(`(() => { const d = document.createElement('div'); d.className = 'kbqn'; d.id = 'kb-check-notice'; d.setAttribute('role', 'alert'); d.setAttribute('data-kb', 'quota-notice')
      d.innerHTML = '<span class="kbqn-text">Your credit is used up — this plan has no allowance of its own.</span><button type="button" class="kbqn-act" data-kb="quota-notice-open">Open Plan &amp; Credits</button><button type="button" class="kbqn-x" aria-label="Close">×</button>'; document.body.appendChild(d) })()`)
    await sleep(500)
    const qn = JSON.parse(await g.val(`(() => { const d = document.getElementById('kb-check-notice'); const r = (e) => { const b = e.getBoundingClientRect(); return { l: Math.round(b.left), t: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) } }; return JSON.stringify({ box: r(d), text: r(d.children[0]), act: r(d.children[1]), x: r(d.children[2]) }) })()`))
    check(`the credit notice: its text has most of the width (${qn.text.w} of ${qn.box.w} px), not a column beside the button`, qn.text.w >= qn.box.w * 0.7, qn)
    check('the credit notice: the button sits under the text and is 44 px high', qn.act.t >= qn.text.t + qn.text.h - 1 && qn.act.h >= 44, qn)
    check('the credit notice: the cross is a 44 px target in the top right corner', qn.x.w >= 44 && qn.x.h >= 44 && qn.x.l + qn.x.w >= qn.box.l + qn.box.w - 6 && qn.x.t <= qn.box.t + 6, qn)
    await g.val(`document.getElementById('kb-check-notice').remove()`)
    // a chat row's « … »: the row of engine 0.2.1 (the app's: no context-menu mark on the button, the button in a wrapper span of its own, the actions box 0 x 0 until a long press)
    // must not hide it from a finger. The sandbox's engine (0.2.2) is made to look like it, then the icon is taken off too (a button found by its place only).
    await g.val(`(() => { document.querySelectorAll('[data-row-key^="session:"] button[data-context-menu-trigger]').forEach((b) => { b.removeAttribute('data-context-menu-trigger'); const w = document.createElement('span'); w.className = '_root_4ub78_1'; b.parentElement.insertBefore(w, b); w.appendChild(b) })
      const s = document.createElement('style'); s.id = 'kb-check-hover-only'; s.textContent = '[class*="_rowActions"] { display: none; width: 0 } [class*="_rowActions"] button { display: none; width: 36px }'; document.head.appendChild(s) })()`)
    await tap(`document.querySelector('.kbmob-menu')`)
    const ROW_BTNS = `Array.from(document.querySelectorAll('[data-row-key^="session:"] [class*="_rowActions"] button')).filter((b) => b.getBoundingClientRect().width > 0)`
    const measure = async () => JSON.parse(await g.val(`(() => { const bs = ${ROW_BTNS}; const rows = document.querySelectorAll('[data-row-key^="session:"]:has([class*="_rowActions"])').length;   /* the open, new session has no actions box */ return JSON.stringify({ rows, shown: bs.length, small: bs.filter((b) => { const r = b.getBoundingClientRect(); return r.width < 43.5 || r.height < 43.5 }).length }) })()`))
    const r1 = await measure()
    check(`every chat row of the drawer shows ONE « … » at 44 x 44 on a touch screen, in the 0.2.1 shape of the row (${r1.shown} buttons for ${r1.rows} rows)`, r1.rows > 0 && r1.shown === r1.rows && r1.small === 0, r1)
    // engine 0.2.1's row in full (round 5 on the real phone): a time label before the box, and beside the « … » a wrapper slot holding Archive and Pin. Nothing may overflow the row, the « … » stands alone, the time is not drawn
    const SIM_ROW = `(() => { document.querySelectorAll('[data-row-key^="session:"]:has([class*="_rowActions"])').forEach((row) => { const box = row.querySelector('[class*="_rowActions"]'); const t = document.createElement('span'); t.className = 'x_time'; t.setAttribute('data-kb-check', 'sim'); t.textContent = '12min'; box.parentElement.insertBefore(t, box)
      const w = document.createElement('div'); w.setAttribute('data-slot', 'sidebar.workspaces.session.row.action'); w.setAttribute('data-kb-check', 'sim'); w.style.display = 'contents'
      for (const l of ['Archive session', 'Pin session']) { const b = document.createElement('button'); b.type = 'button'; b.setAttribute('aria-label', l); b.className = 'x_iconButton'; b.style.cssText = 'width:36px;height:36px'; b.textContent = l[0]; w.appendChild(b) }
      box.appendChild(w) }) })()`
    await g.val(SIM_ROW)
    await sleep(300)
    const FULL_EVAL = `(() => { const rows = Array.from(document.querySelectorAll('[data-row-key^="session:"]:has([class*="_rowActions"])')).filter((r) => r.getBoundingClientRect().height > 0); const bad = []
      for (const row of rows) { const rr = row.getBoundingClientRect(); const vis = Array.from(row.querySelectorAll('button')).filter((b) => { const q = b.getBoundingClientRect(); return q.width > 0 && q.height > 0 }); const over = vis.filter((b) => b.getBoundingClientRect().right > rr.right + 0.5)
        const time = row.querySelector('[data-kb-check="sim"].x_time'); if (over.length > 0 || vis.length !== 1 || (time && getComputedStyle(time).display !== 'none')) bad.push({ buttons: vis.map((b) => b.getAttribute('aria-label')), over: over.length, timeShown: !!time && getComputedStyle(time).display !== 'none' }) }
      return JSON.stringify({ rows: rows.length, bad }) })()`
    const full = JSON.parse(await g.val(FULL_EVAL))
    check(`a chat row in engine 0.2.1's full shape (time, « … », Archive, Pin): the « … » stands alone, nothing leaves the row, the time is not drawn (${full.rows} rows)`, full.rows > 0 && full.bad.length === 0, full)
    await g.val(`document.querySelectorAll('[data-kb-check="sim"]').forEach((e) => e.remove())`)
    // the Workspaces heading on engine 0.2.1: the search plugin's button is the heading's FIRST child there (invisible, 44 px wide): the heading stays level with the rows
    const head = JSON.parse(await g.val(`(() => { const h = document.querySelector('[data-slot="sidebar.workspaces"] > div > :first-child'); const b = h && h.querySelector('[data-kb="search-header"]'); if (!h || !b) return JSON.stringify(null); h.insertBefore(b, h.firstChild)
      const lab = h.querySelector('[class*="sectionLabel"]'); const side = document.querySelector('[data-slot="sidebar"]'); const sc = Array.from(side.querySelectorAll('div')).find((e) => e.querySelector(':scope > [data-slot="sidebar.workspaces"]'))
      return JSON.stringify({ btn: getComputedStyle(b).display, labelLeft: lab ? Math.round(lab.getBoundingClientRect().left - sc.getBoundingClientRect().left) : null }) })()`))
    check(`C2: the Workspaces heading is level with the rows even with the search button first (${head && head.labelLeft} px from the list's edge, not 45 more)`, head !== null && head.btn === 'none' && head.labelLeft !== null && head.labelLeft <= 32, head)
    await g.val(`document.querySelectorAll('[data-row-key^="session:"] svg').forEach((v) => v.removeAttribute('data-icon'))`); await sleep(300)
    const r2 = await measure()
    check(`… and with no ellipsis icon to find it by, the box's first button still shows alone (${r2.shown} buttons for ${r2.rows} rows)`, r2.rows > 0 && r2.shown === r2.rows && r2.small === 0, r2)
    // the row of the REAL engine 0.2.1 (round 9 on the Xiaomi: a titled chat showed the time and THREE 44 px buttons at rest, because no ellipsis icon could be found): no ellipsis icon, a time, the « … » in its wrapper,
    // Archive and Pin in the slot's wrapper. At rest the row is its title and the « … » only; Archive and Pin are in the « … » menu.
    await g.val(SIM_ROW); await sleep(300)
    const full21 = JSON.parse(await g.val(FULL_EVAL))
    check(`a chat row exactly as engine 0.2.1 draws it (no ellipsis icon, a time, « … », Archive, Pin): at rest only the « … » shows, 44 x 44, alone, inside the row, no time (${full21.rows} rows)`, full21.rows > 0 && full21.bad.length === 0, full21)
    const r3 = await measure()
    check(`… and it is still 44 x 44 (${r3.shown} buttons for ${r3.rows} rows)`, r3.rows > 0 && r3.shown === r3.rows && r3.small === 0, r3)
    await g.val(`document.querySelectorAll('[data-kb-check="sim"]').forEach((e) => e.remove())`)
    // the drawer's foot (4 rows) covers most of the list on a 757 px screen, so no row can be reached by a finger here: the button is clicked itself, which is what a tap on it does
    await g.val(`(() => { const b = ${ROW_BTNS}[0]; if (b) b.click() })()`); await sleep(1000)
    check('a row\'s « … » opens its menu', (await g.val(`!!document.querySelector('[role="menu"]')`)) === true)
    await g.val(`document.getElementById('kb-check-hover-only').remove()`)
    await g.key('Escape', 'Escape', 27); await sleep(700)
    // ── menu C2 ── the drawer is still open under the menu, or the menu's close took it along: open it if it is not
    const drawerShown = async () => (await g.val(`(() => { const d = document.querySelector('.kbmob-dock'); return !!d && d.getBoundingClientRect().width > 0 })()`)) === true
    if (!(await drawerShown())) await tap(`document.querySelector('.kbmob-menu')`)
    await sleep(800)
    // « Where Kybernos runs »: in a chat, a line under the title (the shell lists `where` in this way's user agent); never tapped here (the link would leave the page)
    await tap(`Array.from(document.querySelectorAll('[data-slot="sidebar"] [data-row-key^="session:"]')).filter((e) => /Stub/.test(e.innerText) && e.getBoundingClientRect().height > 0)[0]`)
    await sleep(2500)
    const wh = JSON.parse(await g.val(`(() => { const b = document.querySelector('.kbmob-where'); if (!b) return JSON.stringify(null); const r = b.getBoundingClientRect(); const cs = getComputedStyle(b); const t = document.querySelector('[data-slot="conversation.session.header"]'); let title = null
      // the title's letters, by a range over its first text node (the engine's box can start left of the word: the real phone's began 8 px before it)
      if (t && t.firstElementChild) { const w = (e) => { for (const n of Array.from(e.childNodes)) if (n.nodeType === 3 && n.textContent.trim()) return n; for (const c of e.children) { const f = w(c); if (f) return f } return null }; const n = w(t.firstElementChild); if (n) { const rg = document.createRange(); rg.selectNodeContents(n); const q = rg.getBoundingClientRect(); title = { l: Math.round(q.left), b: Math.round(q.bottom) } } }
      const head = document.querySelector('[data-slot="conversation.header"] > header'); const dot = b.querySelector('.kbmob-where-dot'); const lab = b.children[1]
      return JSON.stringify({ text: b.innerText.trim(), place: b.getAttribute('data-place'), h: Math.round(r.height), w: Math.round(r.width), t: Math.round(r.top), l: Math.round(r.left), pos: cs.position, title,
        dotL: dot ? Math.round(dot.getBoundingClientRect().left) : null, textBottom: lab ? Math.round(lab.getBoundingClientRect().bottom) : null, headBottom: head ? Math.round(head.getBoundingClientRect().bottom) : null, headPadB: head ? getComputedStyle(head).paddingBottom : null }) })()`))
    check('C2: in a chat, « On this phone » is a line under the title with a 44 px target', wh !== null && wh.text === 'On this phone' && wh.place === 'local' && wh.h >= 44 && wh.pos === 'fixed' && wh.title !== null, wh)
    check(`C2: the pill's dot starts under the title's first letter (dot at ${wh && wh.dotL}, letter at ${wh && wh.title && wh.title.l})`, wh !== null && wh.title !== null && wh.dotL !== null && Math.abs(wh.dotL - wh.title.l) <= 2, wh)
    check(`C2: the header's bottom line (${wh && wh.headBottom}) is at least 6 px under the pill's text (${wh && wh.textBottom}): it does not cross it`, wh !== null && wh.headBottom !== null && wh.textBottom !== null && wh.headBottom - wh.textBottom >= 6 && wh.headPadB === '16px', wh)
    // the line under the answer: one quiet line of flat icons, the five stars flat in that same line (round 8: not one star that opens them, not a sheet)
    const act = JSON.parse(await g.val(`(() => { const cards = Array.from(document.querySelectorAll('.kbq-rating')); const card = cards[cards.length - 1]; if (!card) return JSON.stringify(null)
      const row = card.closest('div:has(> [data-slot="conversation.chat.assistant-actions"])') || (document.querySelector('[data-slot="conversation.chat.assistant-actions"]') || {}).parentElement
      const k = getComputedStyle(card); const cb = card.getBoundingClientRect()
      const stars = Array.from(card.querySelectorAll('.kbq-rating-etoile')).map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), getComputedStyle(b).borderTopWidth, getComputedStyle(b).backgroundColor, Math.round(r.top), Math.round(r.right)] })
      const q = card.querySelector('.kbq-rating-question')
      const btns = row ? Array.from(row.querySelectorAll('button')).filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !b.closest('.kbq-rating') }).map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), getComputedStyle(b).borderTopWidth, getComputedStyle(b).backgroundColor, Math.round(r.top)] }) : []
      const rep = document.querySelector('[data-kb="report-tail"] > button'); const rk = rep ? getComputedStyle(rep) : null
      return JSON.stringify({ stars, card: [Math.round(cb.left), Math.round(cb.right)], border: k.borderTopWidth, bg: k.backgroundColor, question: q ? getComputedStyle(q).display : 'none', btns, report: rk ? { deco: rk.textDecorationLine, size: rk.fontSize } : null }) })()`))
    const flat = (bg) => /rgba\(0, 0, 0, 0\)|transparent/.test(bg)
    check(`the line under an answer: the five stars are there at once, flat (${act && act.stars.map((x) => x.slice(0, 2).join('x')).join(' ')} px, no border, no fill, no question), inside the page (right edge ${act && act.card[1]} of ${W}), every icon button of the line is 36 x 36 and flat, « Report » is not underlined`, act !== null && act.stars.length === 5 && act.stars.every((x) => x[0] >= 30 && x[1] >= 36 && x[2] === '0px' && flat(x[3])) && act.question === 'none' && act.border === '0px' && flat(act.bg) && act.card[1] <= W && act.btns.length >= 2 && act.btns.every((b) => b[0] === 36 && b[1] === 36 && b[2] === '0px' && flat(b[3])) && (act.report === null || act.report.deco === 'none'), act)
    check('the line under an answer: the five stars sit side by side on one line', act !== null && act.stars.every((x) => x[4] === act.stars[0][4]) && act.stars.every((x, i) => i === 0 || x[5] > act.stars[i - 1][5]), act)
    // round 9: ONE line - the usage icon of engine 0.2.1 (a button in the end-of-line box, beside the clock) is simulated, the clock is not drawn, « Report » is a flag at the end
    await g.val(`(() => { const acts = Array.from(document.querySelectorAll('[data-slot="conversation.chat.assistant-actions"]')); const row = acts[acts.length - 1].parentElement; const end = row.querySelector('[class*="_endInfo"]'); if (!end || end.querySelector('[data-kb-check="usage"]')) return
      const b = document.createElement('button'); b.type = 'button'; b.setAttribute('data-kb-check', 'usage'); b.setAttribute('aria-label', 'Usage'); b.className = '_action'; b.style.cssText = 'width:36px;height:36px;display:flex;align-items:center;justify-content:center;border:0;background:none'; b.innerHTML = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/></svg>'; end.insertBefore(b, end.firstChild) })()`)
    await sleep(300)
    const one = JSON.parse(await g.val(`(() => { const acts = Array.from(document.querySelectorAll('[data-slot="conversation.chat.assistant-actions"]')); const row = acts[acts.length - 1].parentElement; const root = row.parentElement; const q = (e) => { const r = e.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } }
      const flag = root.querySelector('[data-kb="report-tail"] > button[data-act="report-open"]'); const usage = row.querySelector('[data-kb-check="usage"]'); const clock = row.querySelector('[class*="_endInfo"] > :not(button):not(:has(button))')
      const icons = Array.from(row.querySelectorAll('button')).filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 }).map((b) => q(b))
      const ico = flag ? getComputedStyle(flag, '::before') : null
      return JSON.stringify({ icons, flag: flag ? q(flag) : null, flagName: flag ? flag.getAttribute('aria-label') : null, flagIcon: ico ? [ico.width, ico.height] : null, usage: usage ? q(usage) : null, clock: clock ? getComputedStyle(clock).display : 'none', root: q(root) }) })()`))
    check(`the line under an answer: with the usage icon there, EVERYTHING (${one.icons.length} buttons: icons, five stars, usage, flag) is on one line, the flag is 36 x 36 on the line's end (right edge ${one.flag && one.flag.r} of the message's ${one.root.r}), named « ${one.flagName} », and nothing overlaps it`, one.flag !== null && one.flag.w === 36 && one.flag.h === 36 && one.icons.every((b) => b.t === one.icons[0].t) && Math.abs(one.flag.r - one.root.r) <= 1 && one.icons.filter((b) => b.l !== one.flag.l).every((b) => b.r <= one.flag.l + 0.5) && one.usage !== null && one.usage.r <= one.flag.l + 0.5 && one.flagName !== null && /report|signaler/i.test(one.flagName) && one.flagIcon !== null && one.flagIcon[0] === '18px', one)
    check('the line under an answer: the time of the answer is not drawn', one.clock === 'none', one)
    await g.val(`(() => { const e = document.querySelector('[data-kb-check="usage"]'); if (e) e.remove() })()`)
    // the model menu is drawn inside the composer's model slot: the chip's own rules (spans inline, `flex: 1`) must not reach its rows (round 5: the tick took half the row, the names looked centred)
    await tap(`document.querySelector('[data-slot="conversation.input.model"] button')`); await sleep(1200)
    const ms = JSON.parse(await g.val(`(() => { const menu = document.querySelector('.kbmsl-menu'); if (!menu) return JSON.stringify(null); const grp = document.createElement('div'); grp.className = 'kbmsl-group'; grp.id = 'kb-check-models'
      grp.innerHTML = '<div class="kbmsl-g"><span>Kybernos Cloud</span></div><button type="button" role="menuitemradio" aria-checked="false" class="kbmsl-row"><span class="kbmsl-tick"></span><span class="kbmsl-name">Claude Haiku 4.5</span></button>'; menu.appendChild(grp)
      const row = grp.querySelector('.kbmsl-row'); const tick = row.children[0]; const name = row.children[1]; const rr = row.getBoundingClientRect()
      return JSON.stringify({ tickW: Math.round(tick.getBoundingClientRect().width), nameFromRow: Math.round(name.getBoundingClientRect().left - rr.left), nameAlign: getComputedStyle(name).textAlign, nameDisplay: getComputedStyle(name).display }) })()`))
    check(`C2: in the model menu a row is a 14 px tick then the name from the left (tick ${ms && ms.tickW} px, name ${ms && ms.nameFromRow} px from the row's edge), not a tick that takes half the row`, ms !== null && ms.tickW <= 16 && ms.nameFromRow <= 40 && ms.nameAlign === 'left' && ms.nameDisplay !== 'inline', ms)
    await g.val(`(() => { const e = document.getElementById('kb-check-models'); if (e) e.remove() })()`)
    await g.key('Escape', 'Escape', 27); await sleep(700)
    await tap(`document.querySelector('.kbmob-menu')`); await sleep(900)
    const geo = JSON.parse(await g.val(`(() => { const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: Math.round(b.left), t: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) } }
      const side = document.querySelector('[data-slot="sidebar"]'); const items = Array.from(side.querySelectorAll('.kb4-item')).filter((e) => e.getBoundingClientRect().height > 0)
      const av = document.querySelector('.kbmob-avatar'); const nc = document.querySelector('.kbmob-newchat')
      const scroller = Array.from(side.querySelectorAll('div')).find((e) => e.querySelector(':scope > [data-slot="sidebar.workspaces"]'))
      return JSON.stringify({ drawer: r(side.parentElement), dock: r(document.querySelector('.kbmob-dock')), av: r(av), avShape: av ? getComputedStyle(av).borderRadius + '/' + getComputedStyle(av).cornerShape : null, nc: r(nc), ncText: nc ? nc.innerText.trim() : null,
        rows: items.map((e) => ({ t: (e.innerText || '').trim(), h: Math.round(e.getBoundingClientRect().height) })), footer: (() => { const f = side.querySelector('[data-slot="sidebar.footer.action"]'); if (!f) return 'none'; const cs = getComputedStyle(f); const b = f.getBoundingClientRect(); return cs.visibility === 'hidden' && b.height === 0 ? 'none' : 'drawn' })(), settingsTrigger: getComputedStyle(side.querySelector('[data-slot="sidebar.settings"]') || document.body).display,
        scroller: scroller ? { oy: getComputedStyle(scroller).overflowY, top: Math.round(scroller.getBoundingClientRect().top), bottom: Math.round(scroller.getBoundingClientRect().bottom) } : null,
        collapse: r(side.querySelector('[data-sidebar-toggle]')), collapseOpacity: (side.querySelector('[data-sidebar-toggle]') ? getComputedStyle(side.querySelector('[data-sidebar-toggle]')).opacity : null),
        tree: (() => { const t = side.querySelector('[role="tree"]'); return t ? { recents: t.getAttribute('data-kbmob-recents'), display: getComputedStyle(t).display } : null })() }) })()`))
    check(`C2: the drawer is 88 % of the screen (${geo.drawer.w} of ${W} px)`, Math.abs(geo.drawer.w - Math.min(W * 0.88, 400)) <= 2, geo.drawer)
    check('C2: six or seven destination rows, Kaby first and Creations last, each at least 44 px', geo.rows.length >= 6 && geo.rows.every((x) => x.h >= 44) && /^Kaby/i.test(geo.rows[0].t) && /^Creations/i.test(geo.rows[geo.rows.length - 1].t), geo.rows)
    check('C2: the dock is at the foot of the drawer, avatar round 48 px on the left, « + New chat » filling the rest', geo.dock !== null && geo.dock.t + geo.dock.h >= H - 2 && geo.av.w === 48 && geo.av.h === 48 && /^50%\/(round|superellipse\(1\))$/.test(geo.avShape) && geo.nc.l > geo.av.l + geo.av.w && geo.nc.h >= 44 && /new chat|nouveau/i.test(geo.ncText), geo)
    check('C2: the drawer\'s own footer is not drawn (the account card is there, invisible, for its menu), nor the engine\'s Settings trigger, the collapse button is in the layout but not seen', geo.footer === 'none' && geo.settingsTrigger === 'none' && geo.collapse !== null && geo.collapse.w >= 40 && Number(geo.collapseOpacity) === 0, geo)
    check('C2: ONE scrolling area under the rows (the engine\'s list is flattened), with a « Recents » label', geo.scroller !== null && geo.scroller.oy === 'auto' && geo.tree !== null && geo.tree.display === 'contents' && geo.tree.recents === 'Recents', geo)
    // the workspaces come first, then the chats; a tap on a workspace filters, a second one clears; the drawer stays open
    const order = JSON.parse(await g.val(`(() => { const keys = Array.from(document.querySelectorAll('[data-slot="sidebar"] [data-row-key]')).filter((e) => e.getBoundingClientRect().height > 0).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).map((e) => e.getAttribute('data-row-key').split(':')[0]); return JSON.stringify(keys) })()`))
    const firstSession = order.indexOf('session'); const lastWorkspace = order.lastIndexOf('workspace')
    check('C2: every workspace row is drawn before the first chat', lastWorkspace >= 0 && firstSession > lastWorkspace, order)
    await tap(`Array.from(document.querySelectorAll('[data-slot="sidebar"] [data-row-key^="workspace:"]')).filter((e) => e.getBoundingClientRect().height > 0)[0]`)
    const f1 = JSON.parse(await g.val(`JSON.stringify({ filter: document.querySelector('[data-slot="sidebar"] [role="tree"]').getAttribute('data-kbmob-filter'), lit: document.querySelectorAll('[data-kbmob-on]').length, open: !document.querySelector('[data-slot="root"] > div').hasAttribute('data-sidebar-collapsed') })`))
    check('C2: a tap on a workspace lights it, filters the chats and keeps the drawer open', f1.filter === '1' && f1.lit === 1 && f1.open === true, f1)
    await tap(`document.querySelector('[data-slot="sidebar"] [data-row-key^="workspace:"][data-kbmob-on]')`)
    check('C2: a second tap clears the filter', (await g.val(`document.querySelector('[data-slot="sidebar"] [role="tree"]').getAttribute('data-kbmob-filter') === null && document.querySelectorAll('[data-kbmob-on]').length === 0`)) === true)
    // the last chat can be scrolled above the dock
    const clear = await g.val(`(() => { const side = document.querySelector('[data-slot="sidebar"]'); const sc = Array.from(side.querySelectorAll('div')).find((e) => e.querySelector(':scope > [data-slot="sidebar.workspaces"]')); sc.scrollTop = sc.scrollHeight; const rows = Array.from(side.querySelectorAll('[data-row-key]')).filter((e) => e.getBoundingClientRect().height > 0); const last = rows.reduce((m, e) => Math.max(m, e.getBoundingClientRect().bottom), 0); const av = document.querySelector('.kbmob-avatar').getBoundingClientRect(); return last + ' <= ' + av.top + (last <= av.top + 1) })()`)
    check(`C2: scrolled to the end, the last row clears the dock (${clear})`, /true$/.test(String(clear)), clear)
    // the avatar opens the web's account menu (kybernos-cloud's footer card, drawn invisible; its menu is a bottom sheet)
    await tap(`document.querySelector('.kbmob-avatar')`)
    await sleep(900)
    const menuProbe = `(() => { const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: Math.round(b.left), t: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), b: Math.round(b.bottom) } }
      const shown = Array.from(document.querySelectorAll('[role="menu"]')).filter((m) => { const b = m.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(m).visibility !== 'hidden' })
      const top = shown[shown.length - 1] || null
      const rows = top ? Array.from(top.querySelectorAll('[role="menuitem"]')).filter((x) => x.getBoundingClientRect().height > 0) : []
      const card = document.querySelector('[data-slot="sidebar.footer.action"]'); const cs = card ? getComputedStyle(card) : null
      return JSON.stringify({ n: shown.length, box: r(top), rows: rows.map((x) => ({ k: x.getAttribute('data-kb'), h: Math.round(x.getBoundingClientRect().height) })), scrim: !!document.querySelector('.kbmob-scrim[data-on]'), cardHidden: cs ? cs.visibility === 'hidden' : null, page: !!document.querySelector('.kbmob-settings') }) })()`
    const mn = JSON.parse(await g.val(menuProbe))
    check(`C2: the avatar opens the account menu as a bottom sheet, the screen's width, resting on its bottom edge (${JSON.stringify(mn.box)})`, mn.n >= 1 && mn.box !== null && mn.box.w === W && mn.box.b >= H - 2 && mn.page === false, mn)
    check('C2: the sheet\'s rows are at least 46 px, and the page dims behind it', mn.rows.length >= 3 && mn.rows.every((x) => x.h >= 46) && mn.scrim === true, mn)
    check('C2: the footer card the menu belongs to is not drawn (only its menu is)', mn.cardHidden === true, mn)
    // Back (the shell's close-layer) closes the sheet
    await g.val(`window.__posted.length = 0; window.__KB_APP__.receive(JSON.stringify({ kybernos: 'close-layer', version: 1 }))`); await sleep(700)
    check('C2: the shell\'s close-layer closes the sheet', JSON.parse(await g.val(menuProbe)).n === 0)
    // a row that opens a page puts the drawer away: Settings opens DSH's own Settings, the web's page
    await tap(`document.querySelector('.kbmob-avatar')`); await sleep(900)
    const hasSettings = await g.val(`!!document.querySelector('[role="menu"] [data-kb="menu-settings"]')`)
    if (hasSettings === true) {
      await tap(`document.querySelector('[role="menu"] [data-kb="menu-settings"]')`)
      await sleep(1500)
      check('C2: the Settings row opens DSH\'s Settings, and the drawer is put away', (await g.val(`!!document.querySelector('[data-shortcut-modal="settings"]') && document.querySelector('[data-slot="root"] > div').hasAttribute('data-sidebar-collapsed')`)) === true)
    } else {
      console.log('  (signed out in this sandbox: no Settings row in the menu; the signed-in rows are not checked here, DSH\'s Settings is opened by its seam)')
      await g.val(`window.__KB_APP__.receive(JSON.stringify({ kybernos: 'close-layer', version: 1 }))`); await sleep(500)
      await g.val(`(() => { try { if (typeof window.__kbOpenDshSettings === 'function') window.__kbOpenDshSettings() } catch (e) { /* the seam is not there */ } })()`)
      await sleep(1500)
      check('C2: DSH\'s Settings opens (the seam of the Kybernos plugin, the web\'s « Settings » row calls it)', (await g.val(`!!document.querySelector('[data-shortcut-modal="settings"]')`)) === true)
    }
    await settingsPage(way.id)
  }
  if (way.id === 'app-signed') {
    // The signed-in menu sits inside the drawer's own boxes (the sidebar column is a fixed box with a z-index of its own). On the real phone (2026-11-08) it stayed UNDER the page's dim and
    // the drawer vanished with it: a check that only looks at the menu's size passes there, so this one asks what a finger would hit.
    const probe = `(() => { const col = document.querySelector('[class*="sidebarCol"]')
      const m = Array.from(document.querySelectorAll('.kbfp-menu')).filter((x) => x.getBoundingClientRect().height > 0)[0] || null
      const rows = m ? Array.from(m.querySelectorAll('[role="menuitem"]')).filter((x) => x.getBoundingClientRect().height > 0) : []
      const hitOf = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!(h && h.closest('.kbfp-menu')) }
      const b = m ? m.getBoundingClientRect() : null
      return JSON.stringify({ card: !!document.querySelector('[data-kb="workspace-card"]'), avatar: (document.querySelector('.kbmob-avatar') || {}).textContent || null,
        menu: b ? { l: Math.round(b.left), w: Math.round(b.width), bottom: Math.round(b.bottom), inBody: m.parentElement === document.body, n: rows.length, minH: rows.reduce((a, x) => Math.min(a, Math.round(x.getBoundingClientRect().height)), 999) } : null,
        firstHit: hitOf(rows[0]), lastVisibleHit: hitOf(rows.filter((x) => x.getBoundingClientRect().bottom <= window.innerHeight).slice(-1)[0]),
        scrim: !!document.querySelector('.kbmob-scrim[data-on]'), drawerOpen: !document.querySelector('[data-slot="root"] > div').hasAttribute('data-sidebar-collapsed'),
        col: col ? { z: getComputedStyle(col).zIndex, lifted: col.hasAttribute('data-kbmob-lift') } : null }) })()`
    await tap(`document.querySelector('.kbmob-menu')`); await sleep(900)
    await tap(`document.querySelector('.kbmob-avatar')`); await sleep(1300)
    const sg = JSON.parse(await g.val(probe))
    check('signed in: the drawer\'s avatar is the account\'s letter and the web\'s card is in the page', sg.card === true && sg.avatar === 'M', sg)
    check('signed in: the M opens the account menu as a sheet, full width, on the bottom edge, in <body>', sg.menu !== null && sg.menu.w === W && sg.menu.bottom >= H - 2 && sg.menu.inBody === true && sg.menu.n >= 8, sg)
    check('signed in: a finger on a row hits the MENU, not the page\'s dim (elementFromPoint, first and last visible rows)', sg.firstHit === true && sg.lastVisibleHit === true && sg.scrim === true, sg)
    check('signed in: the rows are at least 46 px', sg.menu !== null && sg.menu.minH >= 46, sg)
    check('signed in: the drawer stays open behind the sheet (its column keeps its z-index)', sg.drawerOpen === true && sg.col !== null && sg.col.lifted === false && sg.col.z !== 'auto', sg)
    await g.val(`window.__posted.length = 0; window.__KB_APP__.receive(JSON.stringify({ kybernos: 'close-layer', version: 1 }))`); await sleep(800)
    const sc = JSON.parse(await g.val(probe))
    check('signed in: Back closes the sheet and the drawer is still there', sc.menu === null && sc.drawerOpen === true && sc.scrim === false, sc)
    // the arrow says « leaves the app »: not on a row the shell opens natively (Account, Referral: the caps of this way list them), still on Website
    await tap(`document.querySelector('.kbmob-avatar')`); await sleep(1300)
    const ar = JSON.parse(await g.val(`(() => { const w = (k) => { const e = document.querySelector('.kbfp-menu [data-kb="' + k + '"] > span[aria-hidden="true"]'); return e ? Math.round(e.getBoundingClientRect().width) : null }; return JSON.stringify({ account: w('menu-account'), referral: w('menu-referral'), website: w('menu-website') }) })()`))
    check('signed in: no « leaves the app » arrow on Account and Referral (native), one on Website', ar.account === 0 && ar.referral === 0 && ar.website > 0, ar)
    // Send feedback: the dialog's message box keeps its height (it was crushed to one line), whatever the keyboard
    await tap(`document.querySelector('.kbfp-menu [data-kb="menu-feedback"]')`); await sleep(1500)
    const fb = JSON.parse(await g.val(`(() => { const t = document.getElementById('kbfb-msg'); const c = t ? t.closest('[role="dialog"]') : null; return JSON.stringify({ open: !!t, h: t ? Math.round(t.getBoundingClientRect().height) : null, cardH: c ? Math.round(c.getBoundingClientRect().height) : null, drawerOpen: !document.querySelector('[data-slot="root"] > div').hasAttribute('data-sidebar-collapsed') }) })()`))
    check('signed in: the Send feedback message box is at least 100 px high and the row put the drawer away', fb.open === true && fb.h >= 100 && fb.drawerOpen === false, fb)
    await g.key('Escape', 'Escape', 27); await sleep(700)
    // Create a team / Join a team: their dialogs were drawn inside the drawer's footer, which the phone does not show (0 x 0, hidden): the row closed the menu and nothing came. They are drawn on the page.
    for (const [row, hook] of [['space-create', 'new-team'], ['space-join', 'join-team']]) {
      await tap(`document.querySelector('.kbmob-menu')`); await sleep(900)
      await tap(`document.querySelector('.kbmob-avatar')`); await sleep(1300)
      const has = await g.val(`!!document.querySelector('.kbfp-menu [data-kb="${row}"]')`)
      if (has !== true) { console.log(`  (the account menu of this way has no ${row} row: its dialog is not checked here)`); await g.key('Escape', 'Escape', 27); await sleep(500); continue }
      await tap(`document.querySelector('.kbfp-menu [data-kb="${row}"]')`); await sleep(1500)
      const dlg = JSON.parse(await g.val(`(() => { const c = document.querySelector('[data-kb="${hook}"]'); if (!c) return JSON.stringify({ open: false }); const s = c.closest('.kbc-scrim'); const r = c.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 60)); return JSON.stringify({ open: true, inBody: !!s && s.parentElement === document.body, l: Math.round(r.left), w: Math.round(r.width), top: Math.round(r.top), bottom: Math.round(r.bottom), hit: !!(hit && hit.closest('[data-kb="${hook}"]')) }) })()`))
      check(`signed in: « ${row} » opens its dialog, on the page (in <body>), inside the screen (${dlg.l}..${dlg.l + dlg.w} of ${W} px) and a finger hits it`, dlg.open === true && dlg.inBody === true && dlg.l >= 0 && dlg.l + dlg.w <= W && dlg.top >= 0 && dlg.bottom <= H && dlg.hit === true, dlg)
      await g.key('Escape', 'Escape', 27); await sleep(700)
      check(`signed in: Escape closes the « ${row} » dialog`, (await g.val(`!document.querySelector('[data-kb="${hook}"]')`)) === true)
    }
    // a row that opens a page: Settings opens DSH's Settings and the drawer goes
    await tap(`document.querySelector('.kbmob-menu')`); await sleep(900)
    await tap(`document.querySelector('.kbmob-avatar')`); await sleep(1300)
    await tap(`document.querySelector('.kbfp-menu [data-kb="menu-settings"]')`); await sleep(1700)
    check('signed in: the Settings row opens DSH\'s Settings and puts the drawer away', (await g.val(`!!document.querySelector('[data-shortcut-modal="settings"]') && document.querySelector('[data-slot="root"] > div').hasAttribute('data-sidebar-collapsed')`)) === true)
    const full = JSON.parse(await g.val(`(() => { const d = document.querySelector('[data-shortcut-modal="settings"]'); const b = d ? d.getBoundingClientRect() : null; return JSON.stringify({ l: b && Math.round(b.left), w: b && Math.round(b.width) }) })()`))
    check(`signed in: Settings is edge to edge (${full.w} of ${W} px)`, full.l === 0 && full.w === W, full)
    // a page of settings: a text and its control. A long text is not squeezed beside the control: it has 240 px at least, the control goes under it when it must
    await tap(`Array.from(document.querySelectorAll('[data-shortcut-modal="settings"] nav button')).find((x) => (x.innerText || '').trim() === 'General')`); await sleep(1500)
    const rows = JSON.parse(await g.val(`(() => { const d = document.querySelector('[data-shortcut-modal="settings"]'); const ctl = (e) => e.matches('button, select, input, [role="switch"], [role="radiogroup"], [role="group"]') || e.querySelector('button, input, select') !== null
      const rs = Array.from(d.querySelectorAll('div')).filter((e) => e.children.length === 2 && !e.children[0].matches('button, select, input, [role]') && ctl(e.children[1]) && (e.children[0].innerText || '').trim().length > 40 && e.getBoundingClientRect().width > 250)
      return JSON.stringify({ n: rs.length, min: rs.reduce((a, e) => Math.min(a, Math.round(e.children[0].getBoundingClientRect().width)), 999), under: rs.filter((e) => e.children[1].getBoundingClientRect().top >= e.children[0].getBoundingClientRect().bottom - 1).length }) })()`))
    check(`signed in: on General the text of ${rows.n} rows keeps 240 px at least (${rows.min}), ${rows.under} of them with the control under it`, rows.n >= 2 && rows.min >= 240, rows)
    // The « ‹ Settings » bar of a page is a real button over it (a pseudo-element is no control: no focus, no name): it has a name, a hit area of the bar, and a tap takes the list back.
    const bk = JSON.parse(await g.val(`(() => { const d = document.querySelector('[data-shortcut-modal="settings"]'); const b = d ? d.querySelector('[data-kbmob-backbtn]') : null; if (!b) return JSON.stringify({ btn: false })
      const r = b.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + 20, r.top + r.height / 2)
      return JSON.stringify({ btn: true, name: b.getAttribute('aria-label'), h: Math.round(r.height), w: Math.round(r.width), hit: hit === b, page: d.hasAttribute('data-kbmob-page') }) })()`))
    check('signed in: a Settings page has a real, named back button on its bar, 44 px high at least, which a finger hits', bk.btn === true && /Back to Settings/.test(String(bk.name)) && bk.h >= 44 && bk.hit === true && bk.page === true, bk)
    await tap(`document.querySelector('[data-shortcut-modal="settings"] [data-kbmob-backbtn]')`); await sleep(900)
    check('signed in: a tap on the back button shows the list of pages again (the button is not drawn there)', (await g.val(`(() => { const d = document.querySelector('[data-shortcut-modal="settings"]'); const b = d.querySelector('[data-kbmob-backbtn]'); return !d.hasAttribute('data-kbmob-page') && (!b || b.getBoundingClientRect().height === 0 || getComputedStyle(b).display === 'none') })()`)) === true)
  }
  await g.close()
}
console.log(failed === 0 ? '\nOK: the frame holds in every way.' : `\n${failed} check(s) failed.`)
process.exit(failed === 0 ? 0 : 1)
