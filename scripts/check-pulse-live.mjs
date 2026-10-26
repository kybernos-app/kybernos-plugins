#!/usr/bin/env node
// The Widget module (packages/kybernos-pulse), end to end, in a real GUI.
//
//   source scripts/sandbox/env.sh && node scripts/check-pulse-live.mjs [--shots <dir>]
//
// It needs a DSH that LOADS the bundle, i.e. the sandbox instance (`scripts/sandbox/setup.sh`, `scripts/sandbox/start.sh`; see
// docs/dev/live-testing.md). The user's own `dsh web` does not list the bundle: this script refuses to run against :3080 (exit 3).
// The sandbox must have been started with `<DSH_HOME>/kybernos/pulse/pulse.json` holding the one failed run this script expects
// (`--seed` writes it and says so; start the sandbox after that, the host reads the file once).
//
// What it checks, in a real page:
//   1. the host half of this checkout answers through the page's own origin: the state route, the settings route (a good patch,
//      a bad one, a body that is not JSON), the inbox route; the seeded failed run is in the inbox with a count of one;
//   2. the page tab title carries that count, and the banner that was due is marked as shown without a word (no permission here);
//   3. Settings › Widget: the page mounts with its blocks, the level choice and the switches save through the real route,
//      the floating-window button is there (disabled with a reason when this browser has no Document Picture-in-Picture);
//   4. a watcher pass over a run whose journal does not exist claims nothing and breaks nothing;
//   5. a narrow window does not overflow.
//
// NOT covered here (no automation and no model in a sandbox): a real run ending, and the floating window itself (a headless browser
// has no window to float): those are covered by the unit tests on fakes and have to be seen once on a real browser.
//
// SAFETY: the sandbox has its own DSH_HOME; the only things written are its own pulse.json and, for check 4, a tasks.json it removes again.
// Exit code 0 / 1 / 3.
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { openLivePage, openSettings, goToSettingsPage, waitFor } from './live-page.mjs'

const args = process.argv.slice(2)
const shotDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null
const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
const pulseFile = join(dshHome, 'kybernos', 'pulse', 'pulse.json')

if (args.includes('--seed')) {
  if (!process.env.DSH_HOME) { console.error('refusing to seed without DSH_HOME (source scripts/sandbox/env.sh first)'); process.exit(3) }
  mkdirSync(join(dshHome, 'kybernos', 'pulse'), { recursive: true })
  const item = { id: 'r:session-chk', kind: 'failed', task: 'Check run', taskId: 'chk', sessionId: 'session-chk', at: Date.now(), unread: true, bannered: false, message: 'No credit left', calls: 2 }
  writeFileSync(pulseFile, JSON.stringify({ version: 1, settings: { level: 'every' }, state: { baselined: true, seen: { 'session-chk': { phase: 'failed', at: Date.now() } }, inbox: [item] } }))
  console.log('seeded ' + pulseFile + ': one failed run, level "every". Start the sandbox now, then run this script without --seed.')
  process.exit(0)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const host = process.env.KB_HOST || '127.0.0.1:3080'
if (host === '127.0.0.1:3080') { console.error('○ inconclusive: this check needs a DSH that loads the bundle (a sandbox instance), not the one on :3080. Set KB_HOST, DSH_HOME and HOME.'); process.exit(3) }

const live = await openLivePage({ width: 1500, height: 1000 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const val = async (expr, ms) => (await page.evalJs(expr, ms)).val
const shot = async (name) => { if (shotDir !== null) { try { mkdirSync(shotDir, { recursive: true }); await page.shot(join(shotDir, name + '.png')) } catch (e) { /* no screenshot */ } } }
const poll = async (fn, ms = 10000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await sleep(250) } }
const api = (path, body, headers) => val(`fetch(${JSON.stringify(path)}, ${body === undefined ? '{}' : `{ method: 'POST', headers: ${JSON.stringify(headers || { 'content-type': 'application/json' })}, body: ${JSON.stringify(typeof body === 'string' ? body : JSON.stringify(body))} }`}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))`, 15000)
const tasksFile = join(dshHome, 'kybernos', 'tasks.json')
const hadTasks = existsSync(tasksFile)

try {
  await waitFor(page, 'document.readyState === "complete" && document.body && document.body.innerText.length > 40', 30000)

  console.log('── 1. the host, through the page ──')
  let st = await api('/kybernos-pulse/state')
  check('state answers on the page\'s own origin, with the settings, the inbox and the count', st.status === 200 && st.body.ok === true && Array.isArray(st.body.inbox) && typeof st.body.unread === 'number' && st.body.settings.level !== undefined, st)
  const seeded = st.body && st.body.inbox ? st.body.inbox.filter((x) => x.id === 'r:session-chk') : []
  check('the seeded failed run is in the inbox, as a thing that needs you', seeded.length === 1 && seeded[0].kind === 'failed' && seeded[0].todo === true && seeded[0].message === 'No credit left', st.body && st.body.inbox)
  check('and it is counted once', st.body.unread >= 1, st.body.unread)
  const set = await api('/kybernos-pulse/settings', { level: 'need' })
  check('a good settings patch is saved through the route the page may call (origin and session cookie)', set.status === 200 && set.body.settings.level === 'need', set)
  check('a bad value is refused', (await api('/kybernos-pulse/settings', { level: 'loud' })).status === 400)
  check('a body that is not JSON is refused', (await api('/kybernos-pulse/settings', 'x', { 'content-type': 'text/plain' })).status === 415)
  check('an unknown inbox action is refused', (await api('/kybernos-pulse/inbox', { action: 'boom' })).status === 400)
  const noCookie = await val(`fetch('/kybernos-pulse/settings', { method: 'POST', credentials: 'omit', headers: { 'content-type': 'application/json' }, body: '{"level":"never"}' }).then((r) => r.status)`)
  check('the same write without the session cookie is refused (401), whatever the origin', noCookie === 401, noCookie)
  check('and left the settings as they were', (await api('/kybernos-pulse/state')).body.settings.level === 'need')

  console.log('\n── 2. the tab title and the banner that was due ──')
  const titled = await poll(() => val(`/^\\(\\d+\\+?\\) /.test(document.title)`), 20000)
  check('the tab title carries the count of what is unread', titled === true, await val('document.title'))
  await api('/kybernos-pulse/settings', { level: 'every' })
  await sleep(500)
  st = await api('/kybernos-pulse/state')
  check('no banner is left due: with no permission the page marked what was due as shown, without a word', st.body.banners.length === 0, st.body.banners)

  console.log('\n── 3. Settings › Widget ──')
  check('Settings open', (await openSettings(page, { tries: 3 })) === true)
  const pageSel = `document.querySelector('[data-kb="pulse-page"]') !== null`
  const went = await goToSettingsPage(page, 'Widget', { marker: pageSel, markerMs: 10000 })
  check('the Widget entry is in the Settings menu and opens', went === true)
  check('the page mounts with its four blocks', (await poll(() => val(`['pulse-where', 'pulse-level', 'pulse-banners', 'pulse-quiet'].every((k) => document.querySelector('[data-kb="' + k + '"]') !== null)`), 10000)) === true)
  const floatBtn = await val(`(() => { const b = document.querySelector('[data-kb="pulse-floating"]'); return b ? { disabled: b.disabled, text: b.innerText.trim(), pip: 'documentPictureInPicture' in window } : null })()`)
  check('the floating-window button is there; disabled exactly when this browser has no Picture-in-Picture', floatBtn !== null && floatBtn.disabled === !floatBtn.pip, floatBtn)
  console.log('  ○ Document Picture-in-Picture in this browser: ' + (floatBtn && floatBtn.pip ? 'available' : 'absent') + '; Notification permission: ' + (await val(`typeof Notification === 'function' ? Notification.permission : 'unsupported'`)))
  // A REAL click (a mouse event from the browser itself, so the page has the user gesture Picture-in-Picture wants). What a headless browser does with
  // it is told, not asserted: the window is the one thing this check cannot look at (it is not in the page).
  if (floatBtn !== null && floatBtn.pip && floatBtn.disabled === false) {
    const pos = JSON.parse(await val(`(() => { const r = document.querySelector('[data-kb="pulse-floating"]').getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }) })()`))
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pos.x, y: pos.y })
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', clickCount: 1 })
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos.x, y: pos.y, button: 'left', clickCount: 1 })
    await sleep(2000)
    const after = await val(`(() => { const b = document.querySelector('[data-kb="pulse-floating"]'); return { button: b ? b.innerText.trim() : null, error: /did not open|n.a pas ouvert/.test(document.querySelector('[data-kb="pulse-page"]').innerText) } })()`)
    console.log('  ○ a real click on « Show it »: ' + JSON.stringify(after) + (after.button === 'Close it' ? ' (the browser opened the window)' : ' (the browser did not open it here)'))
    if (after.button === 'Close it') {
      // The window is the page's own document: its panel can be read and pressed from here (documentPictureInPicture.window).
      const pip = (expr) => val(`(() => { const w = window.documentPictureInPicture && window.documentPictureInPicture.window; if (!w) return null; const d = w.document; return (${expr}) })()`)
      const html = await poll(() => pip(`d.body.innerHTML.includes('Check run failed') ? d.body.innerHTML : ''`), 10000)
      check('the floating window holds the panel, with the seeded failed run and the engine\'s message', typeof html === 'string' && html.includes('data-kb="pulse-window"') && html.includes('Check run failed') && html.includes('No credit left'), html && html.slice(0, 200))
      check('its tabs, its link back to Kybernos and its settings link are there', typeof html === 'string' && html.includes('data-act="tab"') && html.includes('data-act="kyb"') && html.includes('data-act="gear"'))
      await pip(`d.querySelector('[data-act="tab"][data-v="now"]').click()`)
      check('the « Now » tab redraws the window', (await poll(() => pip(`d.body.innerHTML.includes('No run going')`), 5000)) === true)
      await pip(`d.querySelector('[data-act="tab"][data-v="inbox"]').click()`)
      await val(`(() => { const orig = window.__KB_OPEN__; window.__pulseOpened = []; if (typeof orig === 'function') { const wrapped = (a) => { window.__pulseOpened.push(a); return orig(a) }; wrapped.views = orig.views; window.__KB_OPEN__ = wrapped } })()`)
      await pip(`d.querySelector('[data-act="open"]').click()`)
      const opened = await poll(() => val(`(window.__pulseOpened || []).some((o) => o && o.view === 'tasks')`), 5000)
      check('the arrow of a card asks Kybernos to open the Automations page', opened === true, await val(`JSON.stringify(window.__pulseOpened || null)`))
      await pip(`d.querySelector('[data-act="dismiss"]').click()`)
      check('dismissing a card removes it on the host and the window follows', (await poll(async () => (await api('/kybernos-pulse/state')).body.inbox.every((x) => x.id !== 'r:session-chk'), 8000)) === true && (await poll(() => pip(`!d.body.innerHTML.includes('Check run failed')`), 12000)) === true)
      // The arrow took the page away from Settings (it opened the Automations page): the window is closed from here and Settings is opened again.
      await val(`window.documentPictureInPicture.window.close()`)
      check('closing the window is noticed', (await poll(() => val(`!(window.documentPictureInPicture && window.documentPictureInPicture.window)`), 5000)) === true)
      check('Settings › Widget opens again', (await openSettings(page, { tries: 3 })) === true && (await goToSettingsPage(page, 'Widget', { marker: pageSel, markerMs: 10000 })) === true)
      check('and the page shows the window as closed', (await poll(() => val(`(document.querySelector('[data-kb="pulse-floating"]') || { innerText: '' }).innerText.trim() === 'Show it'`), 8000)) === true)
    }
  }
  const checked = (k) => val(`(document.querySelector('[data-kb="pulse-level-${k}"]') || { getAttribute: () => null }).getAttribute('aria-checked')`)
  await poll(async () => (await checked('every')) === 'true', 10000)
  check('the level shown is the one the host holds', (await checked('every')) === 'true' && (await checked('need')) === 'false', [await checked('every'), await checked('need')])
  await val(`document.querySelector('[data-kb="pulse-level-never"]').click()`)
  const saved = await poll(async () => (await api('/kybernos-pulse/state')).body.settings.level === 'never', 8000)
  check('choosing « Never » saves through the real route and the page follows', saved === true && (await poll(async () => (await checked('never')) === 'true', 8000)) === true)
  await val(`document.querySelector('[data-kb="pulse-sw-badge"]').click()`)
  check('the badge switch saves', (await poll(async () => (await api('/kybernos-pulse/state')).body.settings.badge === false, 8000)) === true)
  check('with the badge off the tab title carries no count', (await poll(() => val(`!/^\\(\\d+\\+?\\) /.test(document.title)`), 25000)) === true, await val('document.title'))
  await val(`document.querySelector('[data-kb="pulse-sw-badge"]').click()`)
  await val(`document.querySelector('[data-kb="pulse-level-need"]').click()`)
  check('both put back as they were', (await poll(async () => { const s = (await api('/kybernos-pulse/state')).body.settings; return s.badge === true && s.level === 'need' }, 8000)) === true)
  const quiet = await api('/kybernos-pulse/settings', { mute: 'Check run' })
  check('an automation can be made quiet and the list shows it', quiet.status === 200 && (await poll(() => val(`!!Array.from(document.querySelectorAll('[data-kb="pulse-unmute"]')).find((b) => /Check run/.test(b.innerText))`), 8000)) === true)
  await val(`Array.from(document.querySelectorAll('[data-kb="pulse-unmute"]')).find((b) => /Check run/.test(b.innerText)).click()`)
  check('and it speaks again with a click on its name', (await poll(async () => (await api('/kybernos-pulse/state')).body.settings.muted.length === 0, 8000)) === true)
  await shot('pulse-page')

  console.log('\n── 4. a pass over a run that has no journal ──')
  if (hadTasks) console.log('  ○ the sandbox already has a tasks.json: this check does not touch it')
  else {
    const at = new Date().toISOString()
    mkdirSync(join(dshHome, 'kybernos'), { recursive: true })
    writeFileSync(tasksFile, JSON.stringify([{ id: 'chk', name: 'Check run', history: [{ at, sessionId: 'session-does-not-exist-chk', status: 'fired' }] }]))
    await sleep(20000)
    const after = await api('/kybernos-pulse/state')
    check('the watcher read it, found no journal and claimed nothing: no new item, no run, the route still answers', after.status === 200 && after.body.inbox.every((x) => x.sessionId !== 'session-does-not-exist-chk') && after.body.running.length === 0, after.body)
    rmSync(tasksFile, { force: true })
  }

  console.log('\n── 5. a narrow window ──')
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 800, deviceScaleFactor: 1, mobile: true })
  const widthOver = () => val(`(() => { const p = document.querySelector('[data-kb="pulse-page"]'); if (!p) return 'no page'; return p.scrollWidth - p.clientWidth })()`)
  const over = await poll(async () => (await widthOver()) <= 0, 5000)
  check('the page does not overflow at 390 px', over === true, await widthOver())
  await shot('pulse-narrow')
} catch (e) {
  fail += 1
  console.log('  ✗ the check itself failed: ' + (e && e.stack ? e.stack : e))
} finally {
  if (!hadTasks) { try { rmSync(tasksFile, { force: true }) } catch (e) { /* already gone */ } }
  await live.close()
}
console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail > 0 ? 1 : 0)
