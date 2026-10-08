#!/usr/bin/env node
// The call button of a session and the Settings › Calls page (packages/kybernos-call), end to end, in a real GUI.
//
//   source scripts/sandbox/env.sh && node scripts/check-call-ui-live.mjs [--shots <dir>]
//
// It needs a DSH that LOADS the bundle: a sandbox instance (scripts/sandbox/setup.sh + start.sh), never the user's own
// (exit 3). The sandbox has no model and no call keys, so: the call opens and says what is missing; the settings are
// really saved (on the sandbox's own disk), read back, and put back.
//
// What it checks:
//   1. in a real session, the composer holds a "Call" button; it opens a call with the session's assistant (no team),
//      the panel says where to set the keys, the button turns into "Hang up" and closes the call;
//   2. Settings › Calls exists, with its three tabs; a setting is saved through the page and is on disk;
//   3. a key typed in the Service tab is saved, is NOT shown back anywhere in the page, and can be removed;
//   4. the connection test says what is missing; the Engines tab lists the app's own voice engine.
//
// SAFETY: POSTs to /kybernos-call/token, agent, utterance and clone are answered here (fail-closed). Settings and keys
// are written through the real routes, but only into the sandbox's DSH_HOME, and removed before the end.
// Exit code 0 / 1 / 3.
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, clickText as clickTextAnywhere } from './live-page.mjs'

const args = process.argv.slice(2)
const shotDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}
const host = process.env.KB_HOST || '127.0.0.1:3080'
const dshHome = process.env.DSH_HOME
if (host === '127.0.0.1:3080' || !dshHome) { console.error('○ inconclusive: this check needs a sandbox instance (KB_HOST, DSH_HOME and HOME of scripts/sandbox/env.sh), not the one on :3080.'); process.exit(3) }

const live = await openLivePage({ width: 1500, height: 1000 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const val = async (expr, ms) => (await page.evalJs(expr, ms)).val
const shot = async (name) => { if (shotDir !== null) { try { await page.shot(join(shotDir, name + '.png')) } catch (e) { /* no screenshot */ } } }
const poll = async (fn, ms = 15000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await sleep(250) } }

// fail-closed: nothing that acts is let through
const blocked = []
let statusOnce = null // the next GET /kybernos-call/status is answered with this (a machine whose keys are set, to see the first-call path)
page.on('Fetch.requestPaused', async (p) => {
  try {
    const url = new URL(p.request.url)
    if (p.request.method === 'POST' && ['/kybernos-call/token', '/kybernos-call/agent', '/kybernos-call/utterance', '/kybernos-call/clone'].includes(url.pathname)) {
      blocked.push(url.pathname)
      await page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 403, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: Buffer.from(JSON.stringify({ ok: false, error: 'blocked by the check' })).toString('base64') })
      return
    }
    if (p.request.method === 'GET' && url.pathname === '/kybernos-call/status' && statusOnce !== null) {
      const body = statusOnce
      statusOnce = null
      await page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: Buffer.from(JSON.stringify(body)).toString('base64') })
      return
    }
    await page.send('Fetch.continueRequest', { requestId: p.requestId })
  } catch (e) { try { await page.send('Fetch.continueRequest', { requestId: p.requestId }) } catch (e2) { /* gone */ } }
})
await page.send('Fetch.enable', { patterns: [{ urlPattern: '*/kybernos-call/*', requestStage: 'Request' }] })

// A real mouse click on the leaf element whose own text is exactly `text`; no scrolling (the page must stay put).
const clickText = async (_page, text) => {
  const pos = await val(`(() => { const own = (e) => Array.from(e.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim(); const e = Array.from(document.querySelectorAll('*')).filter((e) => (e.children.length === 0 ? (e.innerText || '').trim() : own(e)) === ${JSON.stringify(text)} && e.getBoundingClientRect().width > 3)[0]; if (!e) return null; const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }) })()`)
  if (typeof pos !== 'string') return false
  const { x, y } = JSON.parse(pos)
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  return true
}
const dismissKeyModal = async () => { for (let i = 0; i < 12; i += 1) { if (await val(`/Add an API key to get started/.test(document.body.innerText)`)) { await clickText(page, 'Configure later'); await sleep(600) } else break } }
const createSession = async () => {
  const pos = await val(`(() => { const e = document.querySelector('[contenteditable="true"], textarea'); if (!e) return null; const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.x + 40, y: r.y + r.height / 2 }) })()`)
  if (typeof pos !== 'string') return false
  const { x, y } = JSON.parse(pos)
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  await sleep(300)
  await page.send('Input.insertText', { text: 'Calls check' })
  await sleep(300)
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' })
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  return poll(() => val(`/Calls check/.test(document.body.innerText)`), 15000)
}
const panel = () => val(`(() => { const p = document.querySelector('[data-kb="kybernos-call-panel"]'); return p ? p.innerText : null })()`)
const getSettings = () => val(`fetch('/kybernos-call/settings').then((r) => r.json())`, 10000)
const setField = (sel, value) => val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; const set = Object.getOwnPropertyDescriptor(e.constructor.prototype, 'value').set; set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event(e.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return true })()`)
// A control that is disabled while the page works (saving, applying a preset) is clicked once it is enabled again.
const clickWhenEnabled = async (sel) => { await poll(() => val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && e.disabled !== true })()`), 10000); return click(sel) }
const click = (sel) => val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true })()`)
const pageText = () => val(`(document.querySelector('[data-kb="kybernos-call-settings"]') || { innerText: '' }).innerText`)

const cleanup = async () => {
  try { await val(`fetch('/kybernos-call/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ patch: { language: 'auto', mode: 'voice', silenceMinutes: 5, maxMinutes: 60, defaultVoice: null, cloneUpload: false, use: { listen: 'groq', face: 'liveavatar' } } }) }).then((r) => r.status)`, 8000) } catch (e) { /* page gone */ }
  try { rmSync(join(dshHome, 'kybernos', 'livekit.env'), { force: true }); rmSync(join(dshHome, 'kybernos', 'kybernos-call'), { recursive: true, force: true }) } catch (e) { /* nothing there */ }
}

try {
  console.log('1. the call buttons at the top right of a chat')
  await sleep(1500)
  await dismissKeyModal()
  check('a session is open in the sandbox (a first message was sent; there is no model, so it fails: that is fine)', (await createSession()) === true)
  await dismissKeyModal()
  const there = await poll(() => val(`!!document.querySelector('[data-kb="kybernos-call-header"]')`), 20000)
  check('the chat header holds the voice and video buttons of the bundle', there === true)
  await sleep(800)
  const geo = JSON.parse((await val(`(() => { const v = document.querySelector('[data-act="call-voice"]'); const c = document.querySelector('[data-act="call-video"]'); if (!v || !c) return 'null'; const a = v.getBoundingClientRect(); const b = c.getBoundingClientRect(); const own = Array.from(document.querySelectorAll('header button')).filter((x) => !x.closest('[data-kb="kybernos-call-header"]')).map((x) => x.getBoundingClientRect()).filter((r) => r.width > 0 && r.y < 60); const right = own.length ? Math.min(...own.filter((r) => r.x > b.x).map((r) => r.x)) : null; return JSON.stringify({ vx: a.x, vy: a.y, cx: b.x, cw: b.width, w: innerWidth, nextRight: Number.isFinite(right) ? right : null, label: v.getAttribute('aria-label'), video: c.getAttribute('aria-label') }) })()`)) || 'null')
  await shot('call-header')
  check('they sit in the top bar of the chat, on the right side of the window, left of the app\'s own right-hand controls', geo !== null && geo.vy < 60 && geo.cx > geo.w * 0.55 && (geo.nextRight === null || geo.cx + geo.cw <= geo.nextRight + 1), geo)
  check('named for screen readers: "Voice call" and "Video call"', geo !== null && geo.label === 'Voice call' && geo.video === 'Video call', geo)
  check('the old pill in the composer is gone', (await val(`!document.querySelector('[data-kb="kybernos-call-pill"]')`)) === true)
  const videoOff = await val(`(() => { const c = document.querySelector('[data-act="call-video"]'); return JSON.stringify({ disabled: c.disabled, title: c.title }) })()`)
  check('with no face provider in the sandbox the video button is off and says to add a LiveAvatar key', /"disabled":true/.test(videoOff) && /LiveAvatar/.test(videoOff), videoOff)
  const defaultsAtStart = await getSettings() // before the assistant's preset changes anything
  // The video window: wide enough to see a face, with a 16:9 picture, a grip to drag it wider and a button to fill the window.
  console.log('1c. the video window can be resized')
  statusOnce = { ok: true, secrets: 'posee', provider: 'liveavatar' }
  await val(`window.__KB_CALL__.open({ sessionId: 'session-aaaaaaaa', name: 'Assistant', mode: 'video' })`, 8000).catch(() => null)
  const geom = () => val(`(() => { const p = document.querySelector('[data-kb="kybernos-call-panel"]'); const m = document.querySelector('[data-kb="kybernos-call-media"]'); const g = document.querySelector('[data-act="resize"]'); if (!p || !m) return null; const a = p.getBoundingClientRect(); const b = m.getBoundingClientRect(); const c = g ? g.getBoundingClientRect() : null; return JSON.stringify({ w: Math.round(a.width), h: Math.round(a.height), x: Math.round(a.x), y: Math.round(a.y), mw: Math.round(b.width), mh: Math.round(b.height), full: p.getAttribute('data-full'), grip: c ? [Math.round(c.x + c.width / 2), Math.round(c.y + c.height / 2)] : null, vw: innerWidth, vh: innerHeight }) })()`)
  const g0 = JSON.parse((await poll(() => geom(), 8000)) || 'null')
  await shot('video-window-default')
  check('a video call opens a window wide enough to see a face (560 px, not 340)', g0 !== null && g0.w >= 540 && g0.w <= 580, g0)
  check('with a 16:9 picture area (the old one was 180 px high)', g0 !== null && Math.abs(g0.mh - g0.mw * 9 / 16) <= 2 && g0.mh > 250, g0)
  check('and a grip at its top left corner', g0 !== null && g0.grip !== null, g0)
  if (g0 !== null && g0.grip !== null) {
    const [gx, gy] = g0.grip
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: gx, y: gy })
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: gx, y: gy, button: 'left', clickCount: 1 })
    for (const dx of [40, 90, 150]) { await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: gx - dx, y: gy, button: 'left' }); await sleep(60) }
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: gx - 150, y: gy, button: 'left', clickCount: 1 })
    await sleep(300)
    const g1 = JSON.parse((await geom()) || 'null')
    check('dragging the grip to the left makes the window wider, the picture following', g1 !== null && g1.w >= g0.w + 140 && g1.w <= g0.w + 160 && Math.abs(g1.mh - g1.mw * 9 / 16) <= 2, g1)
    check('and the right edge stays where it was', g1 !== null && Math.abs((g1.x + g1.w) - (g0.x + g0.w)) <= 1, g1)
    check('the width is remembered on this browser', (await val(`window.localStorage.getItem('kybernos-call:width')`)) === String(g1 && g1.w))
    await shot('video-window-dragged')
  }
  await clickWhenEnabled('[data-act="panel-full"]')
  const g2 = JSON.parse((await poll(async () => { const x = JSON.parse((await geom()) || 'null'); return x !== null && x.full === 'true' ? JSON.stringify(x) : null }, 5000)) || 'null')
  check('the full screen button fills the window', g2 !== null && g2.w >= g2.vw - 40 && g2.h >= g2.vh - 40 && g2.mh > g2.vh * 0.6, g2)
  await shot('video-window-full')
  await val(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  check('Escape brings it back', (await poll(async () => { const x = JSON.parse((await geom()) || 'null'); return x !== null && x.full === 'false' }, 5000)) === true)
  await val(`(() => { const b = document.querySelector('[data-act="hangup"]'); if (b) b.click() })()`)
  await val(`window.localStorage.removeItem('kybernos-call:width')`)
  await sleep(500)

  // With nothing set up there is no pop-up to run: the panel (and the gear) lead to the one page where everything is set up.
  console.log('1d. the call panel and the gear lead to Settings › Calls')
  const settingsShown = () => val(`!!document.querySelector('[data-kb="kybernos-call-settings"]')`)
  const closeSettings = async () => { for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); return (await poll(async () => (await settingsShown()) === false, 6000)) === true }
  check('the gear next to the phone and camera opens the Calls page of the Settings', (await click('[data-act="call-setup"]')) === true && (await poll(settingsShown, 12000)) === true)
  check('Escape closes the Settings again (so the next check starts from the chat)', (await closeSettings()) === true)
  const blockedBefore1d = blocked.length
  await click('[data-act="call-voice"]')
  const notReady = await poll(async () => { const t = await panel(); return typeof t === 'string' && /not ready yet/.test(t) ? t : null }, 15000)
  check('with nothing set up, the voice button shows the call panel saying calls are not ready (no pop-up)', typeof notReady === 'string', notReady)
  check('and nothing that acts was sent to the host (the video window above is the only call that got as far as the token)', blocked.length === blockedBefore1d, blocked)
  check('the panel offers a button to Settings › Calls', (await val(`!!document.querySelector('[data-kb="kybernos-call-panel"] [data-act="open-settings"]')`)) === true)
  await shot('call-not-ready')
  await click('[data-act="open-settings"]')
  check('it opens the Calls page, and the panel is gone', (await poll(settingsShown, 12000)) === true && (await panel()) === null)
  await poll(() => val(`!!document.querySelector('[data-kb="kybernos-call-ready"]')`), 8000)
  const ready = JSON.parse((await val(`JSON.stringify({ ready: (document.querySelector('[data-kb="kybernos-call-ready"]') || { getAttribute: () => null }).getAttribute('data-ready'), fixes: Array.from(document.querySelectorAll('[data-kb="kybernos-call-ready"] [data-act^="fix-"]')).map((b) => b.getAttribute('data-act')), text: (document.querySelector('[data-kb="kybernos-call-ready"]') || { innerText: '' }).innerText })`)) || 'null')
  check('the Overview says it is not ready and lists what is missing, each with a Set up button', ready !== null && ready.ready === 'false' && /Not ready yet/.test(ready.text) && ready.fixes.includes('fix-listen') && ready.fixes.includes('fix-line') && ready.fixes.includes('fix-face') === false, ready)
  await shot('settings-not-ready')
  await click('[data-act="fix-line"]')
  check('a Set up button leads to that provider\'s page', (await poll(() => val(`!!document.querySelector('[data-provider="livekit"]')`), 8000)) === true)
  await click('[data-act="tab-overview"]')

  console.log('2. Settings › Calls › Overview')
  const opened2 = await poll(() => val(`!!document.querySelector('[data-kb="kybernos-call-settings"]')`), 10000)
  check('the Calls page is open', opened2 === true)
  const iconsOf = () => val(`JSON.stringify(Array.from(document.querySelectorAll('[class*="navCell"]')).map((c) => [c.textContent.trim(), (c.querySelector('svg') || { dataset: {} }).dataset.kbIcon || null]).filter((x) => ['Calls', 'Workers', 'Kybernos Suite', 'Auto Routing'].includes(x[0])))`)
  const icons = JSON.parse((await poll(async () => { const x = JSON.parse((await iconsOf()) || '[]'); return x.length > 0 && x.every((r) => r[1] !== null) ? JSON.stringify(x) : null }, 8000)) || '[]')
  check('the Suite\'s pages in the Settings list have their own icon, not the shell\'s gear', icons.length > 0 && icons.every((r) => r[1] !== null) && new Set(icons.map((r) => r[1])).size === icons.length, icons)
  check('Calls is a phone', icons.some((r) => r[0] === 'Calls' && r[1] === 'calls'), icons)
  await poll(() => val(`document.querySelectorAll('[data-kb="kybernos-call-settings"] [role="tab"]').length === 3`), 10000)
  const tabs = await val(`JSON.stringify(Array.from(document.querySelectorAll('[data-kb="kybernos-call-settings"] [role="tab"]')).map((t) => t.getAttribute('data-act')))`)
  check('with three tabs: Overview, Providers, Health', tabs === JSON.stringify(['tab-overview', 'tab-providers', 'tab-health']), tabs)
  await poll(() => val(`document.querySelectorAll('[data-call-slot]').length === 5`), 8000)
  const slotIds = await val(`JSON.stringify(Array.from(document.querySelectorAll('[data-call-slot]')).map((e) => e.getAttribute('data-call-slot')))`)
  check('the Overview shows the five slots of a call', slotIds === JSON.stringify(['listen', 'think', 'speak', 'face', 'line']), slotIds)
  const presets = await val(`JSON.stringify(Array.from(document.querySelectorAll('[data-kb="kybernos-call-presets"] button')).map((b) => [b.getAttribute('data-act'), b.disabled]))`)
  check('and the presets, the one that is not available yet being off', presets === JSON.stringify([['preset-simple', true], ['preset-live', false], ['preset-best', false]]), presets)
  check('with an estimate of the cost per call minute', /¢/.test(await val(`(document.querySelector('[data-kb="kybernos-call-cost"]') || { innerText: '' }).innerText`)))
  const audioModels = await val(`fetch('/kybernos/models/audio').then((r) => r.json())`, 8000)
  const banner = await val(`(document.querySelector('[data-kb="kybernos-call-found-models"]') || { innerText: '' }).innerText`)
  check('the audio models of the providers already set up in Models are listed by the app (names and kinds only)', audioModels && audioModels.ok === true && Array.isArray(audioModels.providers) && JSON.stringify(audioModels).includes('apiKey') === false, audioModels)
  check('and the Overview says so when there are some (and says nothing when there are none)', audioModels.providers.length > 0 ? new RegExp('Found in your Models: ' + audioModels.providers[0].provider).test(banner) : banner === '', { banner, audioModels })
  await shot('settings-overview')
  await click('[data-act="help-slot-speak"]')
  check('a ? next to a slot explains what it is for', /Reads the answer aloud/.test(await val(`(document.querySelector('[data-help="slot-speak"]') || { innerText: '' }).innerText`)))
  await click('[data-act="help-overview"]')
  check('and one at the top explains the page', /five slots/.test(await val(`(document.querySelector('[data-help="overview"]') || { innerText: '' }).innerText`)))
  const before = defaultsAtStart
  check('the defaults: listen with Groq, a face when one is set', before && before.ok === true && before.settings.use.listen === 'groq' && before.settings.use.face === 'liveavatar' && before.settings.language === 'auto' && before.settings.silenceMinutes === 5 && before.settings.cloneUpload === false, before && before.settings)
  await setField('[data-field="language"]', 'es')
  check('choosing Spanish is saved', (await poll(async () => { const x = await getSettings(); return x && x.settings.language === 'es' }, 8000)) === true)
  await click('[data-act="preset-live"]')
  const live = await poll(async () => { const x = await getSettings(); return x && x.settings.use.face === 'none' && x.settings.defaultVoice && x.settings.defaultVoice.engine === 'edge' ? x : null }, 8000)
  check('a preset fills the slots at once: no face, an Edge voice', live !== null && live !== undefined)
  check('and it shows as the active one', (await poll(() => val(`document.querySelector('[data-act="preset-live"]').getAttribute('aria-pressed') === 'true'`), 8000)) === true)

  console.log('3. Settings › Calls › Providers')
  await click('[data-act="tab-providers"]')
  await click('[data-act="slot-listen"]')
  await click('[data-act="prov-groq"]')
  await poll(() => val(`!!document.querySelector('[data-provider="groq"]')`), 8000)
  check('the provider list stays in its column, left of the provider page', await val(`(() => { const n = document.querySelector('.kbcl-provnav'); const p = document.querySelector('.kbcl-prov'); if (!n || !p) return false; const bs = Array.from(n.querySelectorAll('button')); return n.getBoundingClientRect().right <= p.getBoundingClientRect().left && bs.length > 0 && bs.every((b) => b.getBoundingClientRect().right <= p.getBoundingClientRect().left) })()`) === true)
  const SECRET = 'gsk_' + 'x'.repeat(30) + '_SECRET_MUST_NOT_APPEAR'
  await setField('[data-field="GROQ_API_KEY"]', SECRET)
  await clickWhenEnabled('[data-act="save-GROQ_API_KEY"]') // enabled once the page has taken the typed key into its state
  const stored = await poll(async () => { const x = await getSettings(); return x && x.keys.GROQ_API_KEY.set === true }, 8000)
  check('a key typed on a provider\'s page is saved: the host says "set"', stored === true, stored === true ? undefined : { keys: (await getSettings()).keys.GROQ_API_KEY, notice: await val(`(document.querySelector('[data-kb="kybernos-call-notice"]') || { innerText: '' }).innerText`), field: await val(`(document.querySelector('[data-field="GROQ_API_KEY"]') || { value: null }).value`) })
  await poll(() => val(`Array.from(document.querySelectorAll('input')).every((i) => i.value === '')`), 8000) // the field is emptied once the key is saved
  const everywhere = await val(`document.documentElement.outerHTML.includes(${JSON.stringify(SECRET)}) || JSON.stringify(Array.from(document.querySelectorAll('input')).map((i) => i.value)).includes(${JSON.stringify(SECRET)})`)
  check('and it is shown nowhere in the page, not even in a field', everywhere === false)
  check('nor in what the host answers', (await val(`fetch('/kybernos-call/settings').then((r) => r.text())`)).includes(SECRET) === false)
  await shot('settings-provider-groq')
  await setField('[data-field="model"]', 'whisper-large-v3')
  check('the provider\'s own setting (its model) is saved', (await poll(async () => { const x = await getSettings(); return x && x.settings.providers.groq && x.settings.providers.groq.model === 'whisper-large-v3' }, 8000)) === true)
  await val(`window.confirm = () => true`)
  await poll(() => val(`!!document.querySelector('[data-act="remove-GROQ_API_KEY"]')`), 8000)
  await click('[data-act="remove-GROQ_API_KEY"]')
  check('the key can be removed', (await poll(async () => { const x = await getSettings(); return x && x.keys.GROQ_API_KEY.set === false }, 8000)) === true)
  const badSave = await val(`fetch('/kybernos-call/keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ patch: { LIVEKIT_URL: 'ftp://no', GROQ_API_KEY: 'abc' } }) }).then(async (r) => ({ status: r.status, body: await r.json() }))`)
  check('a badly shaped value is refused by the host (400) and names what is wrong', badSave.status === 400 && badSave.body.ok === false && typeof badSave.body.refused.LIVEKIT_URL === 'string' && typeof badSave.body.refused.GROQ_API_KEY === 'string', badSave)
  await click('[data-act="slot-face"]')
  await click('[data-act="prov-anam"]')
  await poll(() => val(`!!document.querySelector('[data-provider="anam"]')`), 8000)
  const soon = await val(`JSON.stringify({ text: document.querySelector('[data-provider="anam"]').innerText, fields: document.querySelectorAll('[data-provider="anam"] [data-field]').length, use: !!document.querySelector('[data-act="use-anam"]') })`)
  check('a provider that is not wired yet says so and offers nothing to fill in or to use', /cannot be used yet/.test(soon) && JSON.parse(soon).fields === 0 && JSON.parse(soon).use === false, soon)
  await click('[data-act="prov-liveavatar"]')
  await poll(() => val(`!!document.querySelector('[data-provider="liveavatar"]')`), 8000)
  check('the face provider has its key, its face and its test-mode switch', (await val(`['LIVEAVATAR_API_KEY', 'LIVEAVATAR_AVATAR_ID', 'LIVEAVATAR_SANDBOX'].every((n) => !!document.querySelector('[data-field="' + n + '"]'))`)) === true)
  await click('[data-field="LIVEAVATAR_SANDBOX"]')
  check('the test-mode switch is saved as a value of the provider', (await poll(async () => { const x = await getSettings(); return x && x.keys.LIVEAVATAR_SANDBOX.set === true && x.keys.LIVEAVATAR_SANDBOX.value === '1' }, 8000)) === true)
  await click('[data-act="slot-speak"]')
  await click('[data-act="prov-say"]')
  await poll(() => val(`!!document.querySelector('[data-provider="say"] [data-field="voice"]')`), 8000)
  const sayFr = await val(`(() => { const o = Array.from(document.querySelectorAll('[data-provider="say"] [data-field="voice"] option')).find((x) => /\\(fr\\)$/.test(x.textContent)); return o ? o.value : null })()`)
  check('a voice engine\'s page lists its voices, with Listen', typeof sayFr === 'string' && (await val(`!!document.querySelector('[data-provider="say"] [data-act="listen-voice"]')`)) === true, sayFr)
  await val(`(() => { window.__asked = []; window.__listened = []; const f = window.fetch; window.fetch = (u, i) => { try { if (String(u).includes('/tts/speak')) window.__asked.push(JSON.parse(i.body)) } catch (e) { /* not JSON */ } return f(u, i) }; window.Audio = class { constructor (src) { window.__listened.push(String(src).slice(0, 20)) } play () { setTimeout(() => { if (this.onended) this.onended() }, 5); return Promise.resolve() } } })()`)
  await setField('[data-provider="say"] [data-field="voice"]', sayFr)
  await click('[data-provider="say"] [data-act="listen-voice"]')
  const heard = await poll(() => val(`window.__listened.length > 0 ? JSON.stringify(window.__listened) : null`), 25000)
  const asked = JSON.parse((await val(`JSON.stringify(window.__asked)`)) || '[]')[0] || {}
  check('Listen asks the app\'s voice engine for that voice, in French, and plays what comes back', heard !== null && /data:audio/.test(String(heard)) && asked.engine === 'say' && asked.voice === sayFr && asked.lang === 'fr' && /Bonjour/.test(asked.text), { heard, asked })
  await click('[data-act="use-say"]')
  check('"Use for calls" makes it the assistant\'s voice', (await poll(async () => { const x = await getSettings(); return x && x.settings.defaultVoice && x.settings.defaultVoice.engine === 'say' && x.settings.defaultVoice.voice === sayFr }, 8000)) === true)
  await click('[data-act="prov-app"]')
  await poll(() => val(`!!document.querySelector('[data-act="use-app"]')`), 8000)
  await click('[data-act="use-app"]')
  check('and the app\'s own voice can be chosen again', (await poll(async () => { const x = await getSettings(); return x && x.settings.defaultVoice === null }, 8000)) === true)
  await click('[data-act="prov-elevenlabs"]')
  await poll(() => val(`!!document.querySelector('[data-provider="elevenlabs"] [data-field="cloneUpload"]')`), 8000)
  check('the clone provider has its key, its model and the switch that allows sending recordings, and no "use" button', (await val(`['ELEVENLABS_API_KEY', 'model', 'cloneUpload'].every((n) => !!document.querySelector('[data-provider="elevenlabs"] [data-field="' + n + '"]')) && !document.querySelector('[data-act="use-elevenlabs"]')`)) === true)
  await click('[data-provider="elevenlabs"] [data-field="cloneUpload"]')
  check('allowing recordings to be sent is a separate switch, off until clicked, and saved', (await poll(async () => { const x = await getSettings(); return x && x.settings.cloneUpload === true }, 8000)) === true)
  await click('[data-act="slot-line"]')
  await click('[data-act="prov-livekit"]')
  await poll(() => val(`!!document.querySelector('[data-act="test-livekit"]')`), 8000)
  await click('[data-act="test-livekit"]')
  const lk = await poll(() => val(`(document.querySelector('[data-test-result="livekit"]') || { innerText: '' }).innerText`).then((t) => (t ? t : null)), 10000)
  check('"Test" says what is missing instead of failing silently', typeof lk === 'string' && /not all set/.test(lk), lk)
  await shot('settings-provider-livekit')

  console.log('3b. the models of the user\'s own providers')
  await click('[data-act="tab-overview"]')
  await poll(() => val(`!!document.querySelector('[data-act="check-models"]') || !document.querySelector('[data-kb="kybernos-call-found-models"]')`), 8000)
  if (audioModels.providers.length > 0) {
    await click('[data-act="check-models"]')
    const chips = await poll(() => val(`(() => { const c = Array.from(document.querySelectorAll('[data-model]')); return c.length > 0 && c.every((e) => !/…$/.test(e.innerText)) ? JSON.stringify(c.map((e) => e.innerText)) : null })()`), 60000)
    check('"Check these models" asks each one and shows what came back: with no key in the sandbox, that there is no key', chips !== null && chips !== undefined && JSON.parse(chips).some((t) => /no key for this provider/.test(t)), chips)
  }
  await click('[data-act="tab-providers"]')
  await click('[data-act="slot-listen"]')
  await click('[data-act="prov-models-asr"]')
  await poll(() => val(`!!document.querySelector('[data-provider="models-asr"]')`), 8000)
  const listenModels = await val(`JSON.stringify(Array.from(document.querySelectorAll('[data-provider="models-asr"] [data-field="model"] option')).map((o) => o.value).filter((v) => v !== ''))`)
  const expectListen = audioModels.providers.flatMap((g) => g.models.filter((m) => m.kind === 'listen').map((m) => g.provider + ':' + m.id))
  check('the Listen slot offers the listening models found in Models, whichever provider they come from', expectListen.length === 0 ? (await val(`!!document.querySelector('[data-kb="kybernos-call-no-models"]')`)) === true : JSON.stringify(JSON.parse(listenModels).sort()) === JSON.stringify(expectListen.sort()), { listenModels, expectListen })
  if (expectListen.length > 0) {
    check('and "Use for calls" waits for one to be chosen', (await val(`document.querySelector('[data-act="use-models-asr"]').disabled`)) === true)
    await setField('[data-provider="models-asr"] [data-field="model"]', expectListen[0])
    check('choosing one is saved', (await poll(async () => { const x = await getSettings(); return x && x.settings.providers['models-asr'] && x.settings.providers['models-asr'].model === expectListen[0] }, 8000)) === true)
    await poll(() => val(`document.querySelector('[data-act="use-models-asr"]').disabled === false`), 8000)
    await clickWhenEnabled('[data-act="use-models-asr"]')
    check('and using it makes it who listens', (await poll(async () => { const x = await getSettings(); return x && x.settings.use.listen === 'models-asr' }, 8000)) === true)
    await click('[data-act="prov-groq"]')
    await clickWhenEnabled('[data-act="use-groq"]')
    check('and Groq can be chosen again', (await poll(async () => { const x = await getSettings(); return x && x.settings.use.listen === 'groq' }, 8000)) === true)
  }
  await click('[data-act="prov-app-dictation"]')
  await poll(() => val(`!!document.querySelector('[data-provider="app-dictation"]')`), 8000)
  check('the app\'s own dictation is a listening provider too, with its own test', (await val(`!!document.querySelector('[data-provider="app-dictation"] [data-act="test-dictation"]')`)) === true)
  await click('[data-act="slot-speak"]')
  await click('[data-act="prov-models-tts"]')
  await poll(() => val(`!!document.querySelector('[data-provider="models-tts"]')`), 8000)
  const speakModels = await val(`JSON.stringify(Array.from(document.querySelectorAll('[data-provider="models-tts"] [data-field="voice"] option')).map((o) => o.value))`)
  const expectSpeak = audioModels.providers.flatMap((g) => g.models.filter((m) => m.kind === 'speak' && !/voiceclone|voicedesign/i.test(m.id)).map((m) => g.provider + ':' + m.id))
  check('the Speak slot offers the voice models found in Models as the voices of the "models" engine', expectSpeak.length === 0 ? true : JSON.stringify(JSON.parse(speakModels).sort()) === JSON.stringify(expectSpeak.sort()), { speakModels, expectSpeak })

  console.log('4. Settings › Calls › Health')
  await click('[data-act="tab-health"]')
  await poll(() => val(`!!document.querySelector('[data-act="run-health"]')`), 8000)
  await click('[data-act="run-health"]')
  const final = await poll(() => val(`(() => { const r = Array.from(document.querySelectorAll('[data-check]')); return r.length === 6 && r.every((e) => ['ok', 'warn', 'bad'].includes(e.getAttribute('data-status'))) ? JSON.stringify(Object.fromEntries(r.map((e) => [e.getAttribute('data-check'), [e.getAttribute('data-status'), e.innerText.replace(/\\s+/g, ' ')]]))) : null })()`), 70000)
  const rows = final ? JSON.parse(final) : {}
  check('"Check everything" fills the six rows: microphone, listen, speak, face, line, call engine', final !== null && final !== undefined, final)
  check('a missing key is named: listen is bad and says no key is saved', rows.listen && rows.listen[0] === 'bad' && /No key saved/.test(rows.listen[1]), rows.listen)
  check('the line says what is missing', rows.line && rows.line[0] === 'bad' && /missing/.test(rows.line[1]), rows.line)
  check('a call engine that is not installed says so and offers to install it in one click', rows.engine && rows.engine[0] === 'bad' && /not installed/.test(rows.engine[1]) && (await val(`!!document.querySelector('[data-act="install-engine"]')`)) === true, rows.engine)
  check('a face provider that is not wanted is fine, and says calls are voice only', rows.face && rows.face[0] === 'ok' && /voice only/.test(rows.face[1]), rows.face)
  check('the voice is tried through the app\'s own engine', rows.speak && ['ok', 'warn'].includes(rows.speak[0]) && /The voice answers|took over/.test(rows.speak[1]), rows.speak)
  await shot('settings-health')
  await click('[data-act="fix-listen"]')
  const fixed = await poll(() => val(`!!document.querySelector('[data-provider="groq"]')`), 8000)
  check('a failing row opens the provider to fix it', fixed === true, fixed === true ? undefined : { page: await val(`(document.querySelector('[data-provider]') || { getAttribute: () => null }).getAttribute('data-provider')`), settings: (await getSettings()).settings.use })
} catch (e) {
  fail += 1
  console.log('  ✗ ' + (e && e.message ? e.message : e))
} finally {
  await cleanup()
  await live.close()
}
console.log('\n' + (fail === 0 ? '✓' : '✗') + ' kybernos-call ui live: ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
