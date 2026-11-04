#!/usr/bin/env node
// Case J11-09 of docs/tests/user-journey: Settings › Connectors in its FOLDED view, in French, at the width of a phone (390 px), on a REAL DSH GUI.
//
//   source scripts/sandbox/env.sh && scripts/sandbox/start.sh      # an isolated instance serving this checkout
//   node scripts/check-connectors-phone-fr-live.mjs [--out <folder>]
//
// What it plays: built-in French is chosen on the Language page (the app language lives in the browser, so it is chosen in the same browser), the window becomes
// a 390 x 844 phone, Settings opens on its menu, « Connecteurs » is pressed, and the page is MEASURED in each of the Kybernos Cloud card's states (the real answer,
// signed out, not in the plan, included; the cloud route is answered by a stand-in held in `window.__kbCloud`, as in check-connectors-fold-live.mjs), folded and
// unfolded: the sideways scroll of the page and of every card, the box of every control (under 32 px is flagged), every box whose text is cut, how many lines the
// status line takes, and every leaf string on screen (so that an English word left in French is found by a person reading the list).
//
// It writes into the isolated instance only (the Language row is a browser choice) and REFUSES to run against the real DSH (127.0.0.1:3080); the profile files it could
// touch are copied first and put back at the end.
// Exit code: 0 all green, 1 a check failed, 3 inconclusive (GUI down / a page did not open), 2 refused (not an isolated instance).
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, openSettings, goToSettingsPage, waitFor } from './live-page.mjs'

const args = process.argv.slice(2)
const OUT = args.indexOf('--out') >= 0 ? args[args.indexOf('--out') + 1] : null
const HOST = process.env.KB_HOST || '127.0.0.1:3080'
const DSH_HOME = process.env.DSH_HOME || ''
if (HOST === '127.0.0.1:3080') { console.error('this check changes the language of the browser it talks to and reads the real DSH there (127.0.0.1:3080). Use the isolated instance (scripts/sandbox/).'); process.exit(2) }
if (!DSH_HOME.includes('.kybernos-sandbox')) { console.error('DSH_HOME is not an isolated instance (' + (DSH_HOME || 'unset') + '). Run: source scripts/sandbox/env.sh'); process.exit(2) }
if (OUT !== null) mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const notes = []
const check = (name, ok, detail) => { if (ok === true) { pass += 1; console.log('  ok   ' + name) } else { fail += 1; console.log('  FAIL ' + name + (detail === undefined ? '' : ' | ' + JSON.stringify(detail).slice(0, 400))) } }
const note = (name, v) => { notes.push({ name, v }); console.log('  note ' + name + ': ' + (typeof v === 'string' ? JSON.stringify(v.slice(0, 600)) : JSON.stringify(v).slice(0, 900))) }

// the profile files a language or connector choice could touch
const files = [join(DSH_HOME, 'kybernos/onboarding.json'), join(DSH_HOME, 'profiles/web/cordis.patch.yml')]
const saved = files.map((f) => { try { return existsSync(f) ? readFileSync(f, 'utf8') : null } catch (e) { return null } })
const restore = () => files.forEach((f, i) => { try { if (saved[i] !== null) writeFileSync(f, saved[i]) } catch (e) { /* the sandbox is nobody's */ } })
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { restore(); process.exit(130) })

const PAGE = `!!document.querySelector('[data-kb="kybernos-composio-settings"]')`
const live = await openLivePage({ width: 1400, height: 900 }).catch((e) => { restore(); console.error('inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const ev = async (js) => { const r = await page.evalJs(js, 8000); return r.err ? { __err: r.err } : r.val }
const shot = async (name) => { if (OUT !== null) { try { await page.shot(join(OUT, name + '.png')) } catch (e) { /* no picture */ } } }
const mouse = async (x, y) => { for (const t of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type: t, x, y, button: 'left', clickCount: 1 }); await sleep(300) }
const click = async (sel) => { const c = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return r.width < 2 || r.height < 2 ? null : { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`); if (c === null || c.__err) return false; await mouse(c.x, c.y); return true }
const T = (id) => `[data-kb="provider-toggle-${id}"]`
const stand = (cloud) => ev(`(() => { window.__kbCloud = ${JSON.stringify(cloud)}; return true })()`)
const reopen = async () => { await goToSettingsPage(page, /^(Web Search|Recherche web)$/, { settleMs: 800 }); return goToSettingsPage(page, /^(Connectors|Connecteurs)$/, { marker: PAGE, markerMs: 8000 }) }

// what is measured on the page (the scope is the Connectors page; the page box is the Settings dialog's scroller)
const MEASURE = `(() => {
  const scope = document.querySelector('[data-kb="kybernos-composio-settings"]')
  if (!scope) return { missing: true }
  const vw = innerWidth
  const vis = (e) => { const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' }
  const cards = ['composio', 'kybernos'].map((id) => {
    const c = scope.querySelector('[data-kb="provider-card-' + id + '"]'); if (!c) return { id, missing: true }
    const r = c.getBoundingClientRect(); const st = c.querySelector('.kbcp-pv-stx') || c.querySelector('.kbcp-pv-state'); const sr = st ? st.getBoundingClientRect() : null
    const tg = c.querySelector('[data-kb="provider-toggle-' + id + '"]'); const tr = tg ? tg.getBoundingClientRect() : null
    const rd = c.querySelector('[data-kb="provider-' + id + '"]'); const rr = rd ? rd.getBoundingClientRect() : null
    const lh = st ? parseFloat(getComputedStyle(st).lineHeight) || parseFloat(getComputedStyle(st).fontSize) * 1.3 : 0
    return { id, left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), height: Math.round(r.height), overflowsWindow: r.right > vw + 0.5 || r.left < -0.5, scrollW: c.scrollWidth, clientW: c.clientWidth,
      expanded: tg ? tg.getAttribute('aria-expanded') : null, header: (c.querySelector('.kbcp-pv-h') || {}).innerText ? c.querySelector('.kbcp-pv-h').innerText.replace(/\\s+/g, ' ').trim() : null,
      status: st ? st.innerText.replace(/\\s+/g, ' ').trim() : null, statusLines: st && lh ? Math.round(sr.height / lh * 10) / 10 : null, statusH: sr ? Math.round(sr.height) : null,
      toggle: tr ? { w: Math.round(tr.width), h: Math.round(tr.height), label: tg.getAttribute('aria-label') || tg.innerText.trim() } : null, radio: rr ? { w: Math.round(rr.width), h: Math.round(rr.height), checked: rd.getAttribute('aria-checked') } : null }
  })
  const controls = Array.from(scope.querySelectorAll('button, a, input, [role=radio], [role=switch], select, summary')).filter(vis).map((e) => { const b = e.getBoundingClientRect(); return { tag: e.tagName.toLowerCase(), text: (e.innerText || e.getAttribute('aria-label') || e.placeholder || '').replace(/\\s+/g, ' ').trim().slice(0, 60), w: Math.round(b.width), h: Math.round(b.height), right: Math.round(b.right) } })
  const small = controls.filter((c) => c.w < 32 || c.h < 32)
  const cut = Array.from(scope.querySelectorAll('*')).filter(vis).filter((e) => { const cs = getComputedStyle(e); const clips = cs.overflowX !== 'visible' || cs.textOverflow === 'ellipsis' || cs.webkitLineClamp !== 'none'; return clips && (e.scrollWidth > e.clientWidth + 1 || (cs.webkitLineClamp !== 'none' && e.scrollHeight > e.clientHeight + 1)) && (e.innerText || '').trim() !== '' })
    .map((e) => ({ tag: e.tagName.toLowerCase(), cls: String(e.className).slice(0, 40), text: (e.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 70), scrollW: e.scrollWidth, clientW: e.clientWidth }))
  const leaves = Array.from(scope.querySelectorAll('*')).filter((e) => e.children.length === 0 && vis(e) && (e.innerText || '').trim() !== '').map((e) => e.innerText.replace(/\\s+/g, ' ').trim())
  let sc = scope; const scrollers = []
  while (sc && sc !== document.documentElement) { if (sc.scrollWidth > sc.clientWidth + 1 && getComputedStyle(sc).overflowX !== 'visible') scrollers.push({ cls: String(sc.className).slice(0, 40), scrollW: sc.scrollWidth, clientW: sc.clientWidth }); sc = sc.parentElement }
  return { vw, vh: innerHeight, lang: document.documentElement.lang, docScrollW: document.documentElement.scrollWidth, bodyScrollW: document.body.scrollWidth, scopeW: Math.round(scope.getBoundingClientRect().width), scopeScrollW: scope.scrollWidth, scrollersWithSideScroll: scrollers, cards, nControls: controls.length, small, cut, leaves }
})()`

try {
  // 1. built-in French, chosen in this browser
  if (await openSettings(page) !== true) { console.log('inconclusive: the Settings dialog did not open'); process.exitCode = 3; throw new Error('stop') }
  if (await goToSettingsPage(page, /^(Language|Langue)$/, { marker: `!!document.querySelector('[data-lang]')` }) !== true) { console.log('inconclusive: the Language page did not open'); process.exitCode = 3; throw new Error('stop') }
  await sleep(1200)
  const pressed = await ev(`(() => { const b = document.querySelector('[data-lang="kybernos"] [data-act="use"]'); if (!b) return false; b.click(); return true })()`)
  check('the built-in French row is there and can be used', pressed === true)
  await sleep(3500)
  const langAfter = await ev('document.documentElement.lang')
  note('html lang after choosing built-in French', langAfter)

  // 2. a phone: 390 x 844, touch user agent, same browser (so the language stays)
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  const ua = ((await page.evalJs('navigator.userAgent')).val || '').replace('HeadlessChrome', 'Chrome')
  await page.send('Emulation.setUserAgentOverride', { userAgent: ua, acceptLanguage: 'fr-FR,fr' })
  await page.send('Page.reload', { ignoreCache: true })
  await sleep(5000)
  note('html lang on the phone after the reload', await ev('document.documentElement.lang'))
  const opened = await openSettings(page)
  check('Settings opens at 390 px', opened === true)
  if (opened !== true) { process.exitCode = 3; throw new Error('stop') }
  note('the menu cells in French (first lines)', await ev(`Array.from(document.querySelectorAll('button[class*="navCell"]')).map((b) => (b.innerText || '').trim().split('\\n')[0])`))
  await shot('1-settings-menu-fr-390')
  const reached = await goToSettingsPage(page, /^(Connectors|Connecteurs)$/, { marker: PAGE + ` && document.querySelector('[data-kb="provider-card-kybernos"]').getBoundingClientRect().width > 100`, markerMs: 10000 })
  check('the Connectors page opens at 390 px in French', reached === true)
  if (reached !== true) { process.exitCode = 3; throw new Error('stop') }
  await ev(`(() => { window.__kbPosts = []; const real = window.fetch.bind(window); window.fetch = (u, i) => { const url = typeof u === 'string' ? u : u.url; if (window.__kbCloud && /\\/kybernos-cloud\\/connections$/.test(url)) return Promise.resolve(new Response(JSON.stringify(window.__kbCloud), { status: 200, headers: { 'content-type': 'application/json' } })); return real(u, i) }; return true })()`)
  await sleep(800)

  const read = async (label, picture) => {
    const m = await ev(MEASURE)
    if (m.__err || m.missing) { check(label + ': the page can be measured', false, m); return null }
    note(label + ' | window', { vw: m.vw, docScrollW: m.docScrollW, scopeW: m.scopeW, scopeScrollW: m.scopeScrollW, sideScrollers: m.scrollersWithSideScroll, lang: m.lang })
    note(label + ' | cards', m.cards.map((c) => ({ id: c.id, width: c.width, left: c.left, right: c.right, expanded: c.expanded, status: c.status, statusLines: c.statusLines, toggle: c.toggle, radio: c.radio })))
    note(label + ' | card headers', m.cards.map((c) => c.header))
    note(label + ' | controls under 32 px (' + m.nControls + ' controls in all)', m.small)
    note(label + ' | boxes with text cut', m.cut)
    note(label + ' | every leaf string on screen', m.leaves)
    if (picture) await shot(picture)
    return m
  }
  const fits = (m) => m !== null && m.docScrollW <= m.vw + 1 && m.cards.every((c) => c.overflowsWindow === false && c.scrollW <= c.clientW + 1)

  console.log('the real answer of the cloud route, both cards folded')
  const m1 = await read('real answer, folded', '2-real-folded-fr-390')
  check('both cards fit in a 390 px window, folded', fits(m1), m1 && { docScrollW: m1.docScrollW, cards: m1.cards.map((c) => [c.id, c.left, c.right]) })
  check('both cards open folded', m1 !== null && m1.cards.every((c) => c.expanded === 'false'), m1 && m1.cards.map((c) => c.expanded))
  check('every status line takes at most two lines', m1 !== null && m1.cards.every((c) => c.statusLines === null || c.statusLines <= 2.2), m1 && m1.cards.map((c) => [c.id, c.statusLines]))
  note('the Composio card status line, in full', m1 && m1.cards[0].status)
  await click(T('composio')); await sleep(500)
  const m2 = await read('real answer, Composio unfolded', '3-composio-open-fr-390')
  check('the Composio card unfolded still fits', fits(m2))
  await click(T('kybernos')); await sleep(500)
  const m3 = await read('real answer, both unfolded', '4-both-open-fr-390')
  check('both unfolded still fit', fits(m3))
  await click(T('composio')); await click(T('kybernos'))

  for (const [label, cloud, pic] of [
    ['signed out', { ok: true, offered: true, connected: false }, '5-signed-out-fr-390'],
    ['not in the plan', { ok: true, offered: true, connected: true, entitled: false, limit: 0, count: 0, connections: [], web: 'https://example.com/plans' }, '6-not-in-plan-fr-390'],
    ['included', { ok: true, offered: true, connected: true, entitled: true, limit: 3, count: 0, connections: [] }, '7-included-fr-390'],
    ['included with 3 of 3 apps', { ok: true, offered: true, connected: true, entitled: true, limit: 3, count: 3, connections: [{ id: 'c1', toolkit: 'gmail', name: 'Gmail', status: 'active' }, { id: 'c2', toolkit: 'github', name: 'GitHub', status: 'active' }, { id: 'c3', toolkit: 'slack', name: 'Slack', status: 'active' }] }, '8-included-full-fr-390'],
  ]) {
    console.log('the Kybernos Cloud card: ' + label)
    await stand(cloud); await reopen(); await sleep(500)
    const f = await read(label + ', folded', pic)
    check(label + ': folded, within the window', fits(f), f && { docScrollW: f.docScrollW, cards: f.cards.map((c) => [c.id, c.left, c.right]) })
    check(label + ': the status line of the Kybernos Cloud card is on screen and takes at most two lines', f !== null && typeof f.cards[1].status === 'string' && f.cards[1].status !== '' && f.cards[1].statusLines <= 2.2, f && f.cards[1])
    await click(T('kybernos')); await sleep(500)
    const u = await read(label + ', unfolded', pic.replace('-fr-390', '-open-fr-390'))
    check(label + ': unfolded, within the window', fits(u))
    await click(T('kybernos')); await sleep(300)
  }
  // the page in English at the same width, for the one-to-one comparison of the strings
  await page.send('Emulation.clearDeviceMetricsOverride', {})
} catch (e) {
  if (e.message !== 'stop') { console.log('  FAIL the run stopped: ' + (e.stack || e)); fail += 1 }
} finally {
  restore()
  try { await live.close() } catch (e) { /* gone */ }
  if (OUT !== null) { try { writeFileSync(join(OUT, 'connectors-phone-fr.json'), JSON.stringify({ pass, fail, notes }, null, 1)) } catch (e) { /* no folder */ } }
}
console.log(`\n${pass} passed, ${fail} failed`)
if (process.exitCode === 3) process.exit(3)
process.exit(fail === 0 ? 0 : 1)
