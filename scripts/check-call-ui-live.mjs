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
page.on('Fetch.requestPaused', async (p) => {
  try {
    const url = new URL(p.request.url)
    if (p.request.method === 'POST' && ['/kybernos-call/token', '/kybernos-call/agent', '/kybernos-call/utterance', '/kybernos-call/clone'].includes(url.pathname)) {
      blocked.push(url.pathname)
      await page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 403, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: Buffer.from(JSON.stringify({ ok: false, error: 'blocked by the check' })).toString('base64') })
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
const click = (sel) => val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true })()`)
const pageText = () => val(`(document.querySelector('[data-kb="kybernos-call-settings"]') || { innerText: '' }).innerText`)

const cleanup = async () => {
  try { await val(`fetch('/kybernos-call/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ patch: { language: 'auto', mode: 'voice', silenceMinutes: 5, maxMinutes: 60, defaultVoice: null, cloneUpload: false } }) }).then((r) => r.status)`, 8000) } catch (e) { /* page gone */ }
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
  await click('[data-act="call-voice"]')
  const opened = await poll(async () => { const t = await panel(); return t && /no call secrets/.test(t) ? t : null }, 15000)
  check('the voice button opens a call with the session\'s assistant, and the panel points to Settings › Calls › Service (no file path)', opened !== null && opened !== undefined && /Assistant/.test(opened) && /Settings › Calls › Service/.test(opened), opened)
  check('the two buttons became one "Hang up"', (await val(`(document.querySelector('[data-act="hangup-header"]') || { innerText: '' }).innerText.trim()`)) === 'Hang up')
  check('and nothing that acts was sent to the host', blocked.length === 0, blocked)
  await shot('call-from-session')
  await click('[data-act="hangup-header"]')
  check('clicking it closes the call, and the voice and video buttons are back', (await poll(async () => (await panel()) === null)) === true && (await poll(() => val(`!!document.querySelector('[data-act="call-voice"]')`), 5000)) === true)

  console.log('2. Settings › Calls')
  await val(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => x.getAttribute('aria-label') === 'Settings'); if (b) b.click() })()`)
  await sleep(1200)
  check('the Settings list has a "Calls" section', (await clickTextAnywhere(page, 'Calls')) === true)
  const opened2 = await poll(() => val(`!!document.querySelector('[data-kb="kybernos-call-settings"]')`), 10000)
  check('and it opens the Calls page', opened2 === true)
  await poll(() => val(`document.querySelectorAll('[data-kb="kybernos-call-settings"] [role="tab"]').length === 3`), 10000)
  const tabs = await val(`JSON.stringify(Array.from(document.querySelectorAll('[data-kb="kybernos-call-settings"] [role="tab"]')).map((t) => t.getAttribute('data-act')))`)
  check('with its three tabs: Essentials, Engines, Service', tabs === JSON.stringify(['tab-essential', 'tab-engines', 'tab-service']), tabs)
  await shot('settings-essential')
  const before = await getSettings()
  check('the defaults are shown (language auto, voice, 5 min of silence, recordings not sent)', before && before.ok === true && before.settings.language === 'auto' && before.settings.mode === 'voice' && before.settings.silenceMinutes === 5 && before.settings.cloneUpload === false, before && before.settings)
  await setField('[data-field="language"]', 'es')
  const saved = await poll(async () => { const s = await getSettings(); return s && s.settings.language === 'es' ? s : null }, 8000)
  check('choosing Spanish is saved: the host answers "es" when asked again', saved !== null && saved !== undefined)
  await click('[data-field="mode-video"]')
  check('choosing "With a face" is saved', (await poll(async () => { const s = await getSettings(); return s && s.settings.mode === 'video' }, 8000)) === true)
  await click('[data-field="cloneUpload"]')
  check('allowing recordings to be sent is a separate switch, off until clicked, and saved', (await poll(async () => { const s = await getSettings(); return s && s.settings.cloneUpload === true }, 8000)) === true)
  const voices = await val(`Array.from(document.querySelectorAll('[data-field="defaultVoice"] optgroup')).map((g) => g.label).join(',')`)
  check('the assistant\'s voice list is the app\'s own voice engines', typeof voices === 'string' && voices.length > 0, voices)
  await shot('settings-essential-changed')

  // Listen: nothing is played (Audio is stubbed); what the page asks the voice engine for, and what comes back, is recorded.
  await val(`(() => { window.__asked = []; window.__listened = []; const f = window.fetch; window.fetch = (u, i) => { try { if (String(u).includes('/tts/speak')) window.__asked.push(JSON.parse(i.body)) } catch (e) { /* not JSON */ } return f(u, i) }; window.Audio = class { constructor (src) { window.__listened.push(String(src).slice(0, 20)) } play () { setTimeout(() => { if (this.onended) this.onended() }, 5); return Promise.resolve() } } })()`)
  check('the voice row has a Listen button', (await val(`!!document.querySelector('[data-act="listen-voice"]')`)) === true)
  await click('[data-act="listen-voice"]')
  const heardDefault = await poll(() => val(`window.__listened.length > 0 ? JSON.stringify(window.__listened) : null`), 25000)
  const askedDefault = JSON.parse((await val(`JSON.stringify(window.__asked)`)) || '[]')
  check('Listen asks the app\'s voice engine for a sentence (the app\'s own voice: no engine named) and plays what comes back', heardDefault !== null && /data:audio/.test(String(heardDefault)) && askedDefault.length === 1 && typeof askedDefault[0].text === 'string' && askedDefault[0].engine === undefined, { heardDefault, askedDefault })
  const sayFr = await val(`(() => { const o = Array.from(document.querySelectorAll('[data-field="defaultVoice"] option')).find((x) => /^say::/.test(x.value) && /\\(fr\\)$/.test(x.textContent)); return o ? o.value : null })()`)
  if (sayFr !== null && sayFr !== undefined) {
    await setField('[data-field="defaultVoice"]', sayFr)
    await poll(async () => { const s2 = await getSettings(); return s2 && s2.settings.defaultVoice && s2.settings.defaultVoice.engine === 'say' }, 8000)
    await val(`window.__listened.length = 0`)
    await poll(() => val(`(() => { const b = document.querySelector('[data-act="listen-voice"]'); return !!b && b.disabled === false })()`), 8000) // the button waits while the choice is being saved
    await click('[data-act="listen-voice"]')
    await poll(() => val(`window.__listened.length > 0`), 25000)
    const askedFr = JSON.parse((await val(`JSON.stringify(window.__asked)`)) || '[]')
    const last = askedFr[askedFr.length - 1] || {}
    check('with a French voice chosen, Listen asks for that voice, in French, with a French sentence', last.engine === 'say' && last.voice === sayFr.slice(5) && last.lang === 'fr' && /Bonjour/.test(last.text), { last, sayFr, saved: (await getSettings()).settings.defaultVoice, selected: await val(`document.querySelector('[data-field="defaultVoice"]').value`), disabled: await val(`document.querySelector('[data-act="listen-voice"]').disabled`), asked: askedFr.length })
  } else check('a French voice of the say engine exists to listen to', false, sayFr)

  console.log('3. a key typed in the Service tab')
  await click('[data-act="tab-service"]')
  await sleep(400)
  const SECRET = 'gsk_check_secret_value_' + Date.now()
  await setField('[data-field="GROQ_API_KEY"]', SECRET)
  await click('[data-act="save-keys"]')
  const stored = await poll(async () => { const s = await getSettings(); return s && s.keys.GROQ_API_KEY.set === true }, 8000)
  check('saving it makes the host say "set"', stored === true)
  const everywhere = await val(`document.documentElement.outerHTML.includes(${JSON.stringify(SECRET)}) || JSON.stringify(Array.from(document.querySelectorAll('input')).map((i) => i.value)).includes(${JSON.stringify(SECRET)})`)
  check('and the key is shown nowhere in the page, not even in a field', everywhere === false)
  const raw = await val(`fetch('/kybernos-call/settings').then((r) => r.text())`)
  check('nor in what the host answers', raw.includes(SECRET) === false)
  await shot('settings-service-saved')
  await val(`window.confirm = () => true`)
  await poll(() => val(`!!document.querySelector('[data-act="remove-GROQ_API_KEY"]')`), 8000) // the page re-reads after saving
  await click('[data-act="remove-GROQ_API_KEY"]')
  check('it can be removed', (await poll(async () => { const s = await getSettings(); return s && s.keys.GROQ_API_KEY.set === false }, 8000)) === true)
  const badSave = await val(`fetch('/kybernos-call/keys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ patch: { LIVEKIT_URL: 'ftp://no', GROQ_API_KEY: 'abc def' } }) }).then(async (r) => ({ status: r.status, body: await r.json() }))`)
  check('a badly shaped value is refused by the host (400) and names what is wrong', badSave.status === 400 && badSave.body.ok === false && typeof badSave.body.refused.LIVEKIT_URL === 'string' && typeof badSave.body.refused.GROQ_API_KEY === 'string', badSave)

  console.log('4. the tests and the engines')
  await click('[data-act="test-livekit"]')
  const lk = await poll(() => val(`(document.querySelector('[data-test-result="livekit"]') || { innerText: '' }).innerText`).then((t) => (t ? t : null)), 10000)
  check('"Test the connection" says what is missing instead of failing silently', typeof lk === 'string' && /not all set/.test(lk), lk)
  await click('[data-act="tab-engines"]')
  await sleep(400)
  const engines = await pageText()
  check('the Engines tab shows the app\'s own voice engine and what a call uses', /Voice/.test(engines) && /say/.test(engines) && /Listening/.test(engines) && /Face/.test(engines), engines.slice(0, 400))
  await shot('settings-engines')
} catch (e) {
  fail += 1
  console.log('  ✗ ' + (e && e.message ? e.message : e))
} finally {
  await cleanup()
  await live.close()
}
console.log('\n' + (fail === 0 ? '✓' : '✗') + ' kybernos-call ui live: ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
