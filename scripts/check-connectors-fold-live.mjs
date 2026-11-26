#!/usr/bin/env node
// Checks Settings › Connectors against a REAL DSH GUI: the two provider cards fold to their header row and one status line.
//
//   source scripts/sandbox/env.sh && scripts/sandbox/start.sh      # an isolated instance serving this checkout
//   node scripts/check-connectors-fold-live.mjs [--shots <dir>]
//
// What it plays: the page opens with both cards folded (one line of status under the header, a chevron button on the right); the chevron shows
// and hides the rest with real mouse clicks and with the keyboard (Tab from the radio lands on it, Enter and Space work, the focus ring is drawn);
// folding and unfolding never change the choice and save nothing; the radio and the name choose while the card is folded, and neither unfolds it;
// the Kybernos Cloud card is played in its four states with a stand-in for the cloud route (not offered, signed out, not in the plan, included);
// and a narrow window leaves no card wider than the page.
//
// It writes into the isolated instance only (the provider choice, by clicking a radio) and REFUSES to run against the real DSH (127.0.0.1:3080).
// Exit code: 0 all green, 1 a check failed, 3 inconclusive (GUI down / the page did not open).
// Named check-*, not test-*: CI runs every test-*.mjs with no DSH, and this one needs one.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, openSettings, goToSettingsPage, waitFor } from './live-page.mjs'

const args = process.argv.slice(2)
const shotsDir = args.indexOf('--shots') >= 0 ? args[args.indexOf('--shots') + 1] : null
const HOST = process.env.KB_HOST || '127.0.0.1:3080'
const DSH_HOME = process.env.DSH_HOME || ''
if (HOST === '127.0.0.1:3080') { console.error('✗ this check chooses a provider in the DSH it talks to, and that is the real one (127.0.0.1:3080). Use the isolated instance (scripts/sandbox/).'); process.exit(2) }
if (!DSH_HOME.includes('.kybernos-sandbox')) { console.error('✗ DSH_HOME is not an isolated instance (' + (DSH_HOME || 'unset') + '). Run: source scripts/sandbox/env.sh'); process.exit(2) }
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 300))) }
}
const PAGE = `!!document.querySelector('[data-kb="kybernos-composio-settings"]')`

const live = await openLivePage()
const { page } = live
const ev = async (js) => (await page.evalJs(js, 6000)).val
const shot = async (name) => { if (shotsDir !== null) await page.shot(join(shotsDir, name + '.png')) }
const mouse = async (x, y) => { for (const t of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type: t, x, y, button: 'left', clickCount: 1 }); await sleep(250) }
/** A real click at the centre of the element (null when it has no box: hidden). */
const click = async (sel) => { const c = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return r.width < 2 || r.height < 2 ? null : { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`); if (c === null) return false; await mouse(c.x, c.y); return true }
const key = async (name, code, vk, text) => { for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', Object.assign({ type, key: name, code, windowsVirtualKeyCode: vk }, text !== undefined && type === 'keyDown' ? { text } : {})); await sleep(250) }
const T = (id) => `[data-kb="provider-toggle-${id}"]`
const expanded = (id) => ev(`document.querySelector('${T(id)}').getAttribute('aria-expanded')`)
const shown = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2 })()`)
const checked = (id) => ev(`document.querySelector('[data-kb="provider-${id}"]').getAttribute('aria-checked')`)
const posts = () => ev(`JSON.stringify(window.__kbPosts || [])`)
/** The page remounted from scratch: another settings page, then back (it reads the host and the cloud again). */
const reopen = async () => { await goToSettingsPage(page, 'Web Search', { settleMs: 800 }); return goToSettingsPage(page, /^Connectors$/, { marker: PAGE, markerMs: 8000 }) }
const stand = (cloud) => ev(`(() => { window.__kbCloud = ${JSON.stringify(cloud)}; return true })()`)

try {
  if (await openSettings(page) !== true) { console.log('inconclusive: the Settings dialog did not open'); process.exitCode = 3; throw new Error('stop') }
  if (await goToSettingsPage(page, /^Connectors$/, { marker: PAGE, markerMs: 10000 }) !== true) { console.log('inconclusive: the Connectors page did not open'); process.exitCode = 3; throw new Error('stop') }
  // Record what the page saves, and answer the cloud route with whatever `window.__kbCloud` holds (null: the real answer).
  await ev(`(() => { window.__kbPosts = []; const real = window.fetch.bind(window); window.fetch = (u, i) => { const url = typeof u === 'string' ? u : u.url; if (/\\/kybernos\\/composio\\/provider$/.test(url) && i && i.method === 'POST') window.__kbPosts.push(JSON.parse(i.body).provider); if (window.__kbCloud && /\\/kybernos-cloud\\/connections$/.test(url)) return Promise.resolve(new Response(JSON.stringify(window.__kbCloud), { status: 200, headers: { 'content-type': 'application/json' } })); return real(u, i) }; return true })()`)
  await sleep(800)

  console.log('default: folded')
  check('both cards open folded, the toggles say so', (await expanded('composio')) === 'false' && (await expanded('kybernos')) === 'false')
  check('the rest is not on screen (key box, key field, description)', !(await shown('[data-kb="composio-host-state"]')) && !(await shown('[data-kb="kybernos-composio-settings"] input[placeholder="ck_…"]')) && !(await shown('[data-kb="provider-more-composio"]')))
  check('radio, name, badge and one status line stay visible in each card', await ev(`['composio', 'kybernos'].every((id) => { const c = document.querySelector('[data-kb="provider-card-' + id + '"]'); const st = c.querySelector('.kbcp-pv-state .kbcp-pv-stx'); const sr = st.getBoundingClientRect(); const rad = c.querySelector('[data-kb="provider-' + id + '"]').getBoundingClientRect(); const pill = c.querySelector('.kb7-pill').getBoundingClientRect(); return sr.height > 8 && sr.height < 24 && rad.width > 10 && pill.width > 10 && c.getBoundingClientRect().height < 110 })`))
  await shot('1-default')
  const before = [await checked('composio'), await checked('kybernos')]

  console.log('mouse: the chevron')
  await click(T('composio'))
  check('a click unfolds the Composio card only', (await expanded('composio')) === 'true' && (await expanded('kybernos')) === 'false')
  check('everything that was there is back: key box with its three lines, the ck_ field, Save, the help disclosure, the description', await ev(`(() => { const c = document.querySelector('[data-kb="provider-card-composio"]'); const vis = (e) => { if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2 }; return vis(c.querySelector('[data-kb="composio-host-state"]')) && vis(c.querySelector('input[placeholder="ck_…"]')) && vis(c.querySelector('details.kbcp-help summary')) && vis(c.querySelector('.kbcp-pv-p')) && c.querySelectorAll('.kbcp-btn').length >= 1 })()`))
  check('the status line is now the footer, under the box', await ev(`(() => { const c = document.querySelector('[data-kb="provider-card-composio"]'); return c.querySelector('.kbcp-pv-state').getBoundingClientRect().top > c.querySelector('input[placeholder="ck_…"]').getBoundingClientRect().bottom })()`))
  await shot('2-composio-open')
  await click(T('kybernos'))
  check('the other card unfolds on its own', (await expanded('kybernos')) === 'true' && (await expanded('composio')) === 'true')
  await shot('3-both-open')
  await click(T('composio')); await click(T('kybernos'))
  check('a second click folds each again', (await expanded('composio')) === 'false' && (await expanded('kybernos')) === 'false')
  check('unfolding and folding changed neither radio and saved nothing', JSON.stringify([await checked('composio'), await checked('kybernos')]) === JSON.stringify(before) && (await posts()) === '[]', [before, await posts()])

  console.log('keyboard')
  await ev(`document.querySelector('[data-kb="provider-composio"]').focus()`)
  await key('Tab', 'Tab', 9)
  check('Tab from the radio lands on the toggle', (await ev(`document.activeElement && document.activeElement.getAttribute('data-kb')`)) === 'provider-toggle-composio')
  check('the focus ring is drawn', await ev(`(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2 })()`))
  await key('Enter', 'Enter', 13, '\r')
  check('Enter unfolds', (await expanded('composio')) === 'true')
  await key(' ', 'Space', 32, ' ')
  check('Space folds', (await expanded('composio')) === 'false')
  check('keyboard unfolding saved nothing either', (await posts()) === '[]')

  console.log('choosing while folded')
  await click('[data-kb="provider-composio"]')
  check('the radio chooses Composio, saves it, and leaves both cards folded', (await checked('composio')) === 'true' && (await posts()) === '["composio"]' && (await expanded('composio')) === 'false' && (await expanded('kybernos')) === 'false', [await checked('composio'), await posts()])
  await click('[data-kb="provider-card-kybernos"] .kbcp-pv-h')
  check('the name of a card that cannot be chosen (not offered here) changes nothing and does not unfold it', (await checked('composio')) === 'true' && (await expanded('kybernos')) === 'false')

  console.log('the Kybernos Cloud card, state by state')
  const state = async (id) => ev(`document.querySelector('[data-kb="provider-card-${id}"] .kbcp-pv-state').innerText.trim()`)
  const hiddenAction = async (hook) => !(await shown(`[data-kb="${hook}"]`))
  await stand({ ok: true, offered: true, connected: false }); await reopen()
  check('signed out: the status says so, the sign-in button waits in the fold and shows once unfolded', (await state('kybernos')) === 'Not signed in' && (await hiddenAction('provider-signin')))
  await click(T('kybernos'))
  check('signed out: unfolded, the button is there', await shown('[data-kb="provider-signin"]'))
  await shot('4-kybernos-signed-out-open')
  await stand({ ok: true, offered: true, connected: true, entitled: false, limit: 0, count: 0, connections: [], web: 'https://example.com/plans' }); await reopen()
  check('not in the plan: the status says so, the plans button waits in the fold', (await state('kybernos')) === 'Not included in your plan' && (await hiddenAction('provider-plans')))
  await shot('5-kybernos-not-in-plan')
  await stand({ ok: true, offered: true, connected: true, entitled: true, limit: 3, count: 0, connections: [] }); await reopen()
  check('included: « Connected · 0 of 3 apps » is the one line, « Manage connections » waits in the fold', (await state('kybernos')) === 'Connected · 0 of 3 apps' && (await hiddenAction('provider-manage')), await state('kybernos'))
  await shot('6-kybernos-included')
  await click('[data-kb="provider-kybernos"]')
  check('included: the radio chooses Kybernos Cloud while folded', (await checked('kybernos')) === 'true' && (await checked('composio')) === 'false' && (await posts()) === '["composio","kybernos"]' && (await expanded('kybernos')) === 'false', [await checked('kybernos'), await posts()])
  await click(T('kybernos'))
  check('included: unfolded shows the description and the button', (await shown('[data-kb="provider-manage"]')) && (await shown('[data-kb="provider-card-kybernos"] .kbcp-pv-p')))
  await shot('7-kybernos-included-open')
  check('no click on a toggle changed the choice', (await checked('kybernos')) === 'true' && (await posts()) === '["composio","kybernos"]')

  console.log('narrow window')
  await page.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 820, deviceScaleFactor: 1, mobile: false })
  await sleep(600)
  // On a phone-sized window Settings shows its menu first: press the cell again to reach the page.
  check('the page is reachable in a narrow window', await goToSettingsPage(page, /^Connectors$/, { marker: `${PAGE} && document.querySelector('[data-kb="provider-card-kybernos"]').getBoundingClientRect().width > 100`, markerMs: 8000 }))
  const fits = (id) => `(() => { const c = document.querySelector('[data-kb="provider-card-${id}"]'); const r = c.getBoundingClientRect(); return r.width > 100 && c.scrollWidth <= c.clientWidth + 1 && r.right <= window.innerWidth })()`
  check('no card is wider than the window (the one that was unfolded included)', (await ev(fits('composio'))) === true && (await ev(fits('kybernos'))) === true)
  await shot('8-narrow')
  await click(T('kybernos')) // fold it again
  check('folded, still within the window, status on one line', (await ev(fits('kybernos'))) === true && (await ev(`document.querySelector('[data-kb="provider-card-kybernos"] .kbcp-pv-stx').getBoundingClientRect().height < 24`)) === true)
  await page.send('Emulation.clearDeviceMetricsOverride', {})
} catch (e) {
  if (e.message !== 'stop') { console.log('✗ ' + (e.message || e)); fail += 1 }
} finally {
  await live.close()
}
console.log(`\n${pass} passed, ${fail} failed`)
if (process.exitCode === 3) process.exit(3)
process.exit(fail === 0 ? 0 : 1)
