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
  await click('[data-act="call-voice"]')
  const assistant = (sel = '') => val(`(() => { const a = document.querySelector('[data-kb="kybernos-call-assistant"]${sel}'); return a ? a.innerText : null })()`)
  const dlg = await poll(() => assistant(), 15000)
  check('with nothing set up, the voice button opens the setup assistant instead of failing', typeof dlg === 'string' && /step 1 of 4/.test(dlg) && /Check your microphone/.test(dlg), dlg)
  check('and nothing that acts was sent to the host', blocked.length === 0, blocked)
  check('no call panel was opened behind it', (await panel()) === null)
  await shot('assistant-1-microphone')
  const mic = await poll(() => val(`(document.querySelector('[data-kb="kybernos-call-mic-error"], [data-kb="kybernos-call-mic-state"]') || { innerText: '' }).innerText`).then((t) => (t || null)), 10000)
  check('the microphone screen says what it sees: access or no access, never nothing', typeof mic === 'string' && /microphone|Listening|hear/i.test(mic), mic)
  await click('[data-act="assist-next"]')
  await poll(() => val(`!!document.querySelector('[data-act="assist-preset-live"]')`), 8000)
  check('step 2 offers the presets, the one that is not available yet being off', (await val(`JSON.stringify(Array.from(document.querySelectorAll('[data-act^="assist-preset-"]')).map((b) => [b.getAttribute('data-act'), b.disabled]))`)) === JSON.stringify([['assist-preset-simple', true], ['assist-preset-live', false], ['assist-preset-best', false]]))
  await click('[data-act="assist-preset-live"]')
  check('choosing one fills the slots', (await poll(async () => { const x = await getSettings(); return x && x.settings.use.face === 'none' && x.settings.defaultVoice && x.settings.defaultVoice.engine === 'edge' }, 8000)) === true)
  await shot('assistant-2-preset')
  await click('[data-act="assist-next"]')
  await poll(() => val(`!!document.querySelector('[data-kb="kybernos-call-assistant"] [data-provider="groq"]')`), 8000)
  check('step 3 asks for what the chosen preset needs: the listening key and the line, each with its link and test', (await val(`['groq', 'livekit'].every((id) => { const f = document.querySelector('[data-kb="kybernos-call-assistant"] [data-provider="' + id + '"]'); return !!f && !!f.querySelector('a[href^="https://"]') && !!f.querySelector('[data-act^="test-"]') }) && !document.querySelector('[data-kb="kybernos-call-assistant"] [data-provider="liveavatar"]') && !document.querySelector('[data-kb="kybernos-call-assistant"] [data-act^="use-"]')`)) === true)
  await shot('assistant-3-connect')
  await click('[data-act="assist-next"]')
  const fin = await poll(() => val(`(() => { const r = Array.from(document.querySelectorAll('[data-kb="kybernos-call-assistant"] [data-check]')); return r.length === 6 && r.every((e) => ['ok', 'warn', 'bad'].includes(e.getAttribute('data-status'))) ? JSON.stringify(r.map((e) => [e.getAttribute('data-check'), e.getAttribute('data-status')])) : null })()`), 70000)
  check('step 4 runs the health check by itself and shows the six rows', fin !== null && fin !== undefined, fin)
  await shot('assistant-4-check')
  await click('[data-act="assist-back"]')
  check('Back goes to the previous screen', (await poll(async () => /Connect the services/.test((await assistant()) || ''), 5000)) === true)
  await click('[data-act="assist-back"]')
  await click('[data-act="assist-back"]')
  await click('[data-act="assist-back"]')
  check('and Cancel on the first screen closes the assistant, leaving everything as it was', (await poll(async () => (await assistant()) === null, 5000)) === true && (await panel()) === null)

  console.log('2. Settings › Calls › Overview')
  await val(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => x.getAttribute('aria-label') === 'Settings'); if (b) b.click() })()`)
  await sleep(1200)
  check('the Settings list has a "Calls" section', (await clickTextAnywhere(page, 'Calls')) === true)
  const opened2 = await poll(() => val(`!!document.querySelector('[data-kb="kybernos-call-settings"]')`), 10000)
  check('and it opens the Calls page', opened2 === true)
  await poll(() => val(`document.querySelectorAll('[data-kb="kybernos-call-settings"] [role="tab"]').length === 3`), 10000)
  const tabs = await val(`JSON.stringify(Array.from(document.querySelectorAll('[data-kb="kybernos-call-settings"] [role="tab"]')).map((t) => t.getAttribute('data-act')))`)
  check('with three tabs: Overview, Providers, Health', tabs === JSON.stringify(['tab-overview', 'tab-providers', 'tab-health']), tabs)
  await poll(() => val(`document.querySelectorAll('[data-call-slot]').length === 5`), 8000)
  const slotIds = await val(`JSON.stringify(Array.from(document.querySelectorAll('[data-call-slot]')).map((e) => e.getAttribute('data-call-slot')))`)
  check('the Overview shows the five slots of a call', slotIds === JSON.stringify(['listen', 'think', 'speak', 'face', 'line']), slotIds)
  const presets = await val(`JSON.stringify(Array.from(document.querySelectorAll('[data-kb="kybernos-call-presets"] button')).map((b) => [b.getAttribute('data-act'), b.disabled]))`)
  check('and the presets, the one that is not available yet being off', presets === JSON.stringify([['preset-simple', true], ['preset-live', false], ['preset-best', false]]), presets)
  check('with an estimate of the cost per call minute', /¢/.test(await val(`(document.querySelector('[data-kb="kybernos-call-cost"]') || { innerText: '' }).innerText`)))
  await shot('settings-overview')
  await click('[data-act="help-slot-speak"]')
  check('a ? next to a slot explains what it is for', /Reads the answer aloud/.test(await val(`(document.querySelector('[data-help="slot-speak"]') || { innerText: '' }).innerText`)))
  await click('[data-act="help-overview"]')
  check('and one at the top explains the page', /five slots/.test(await val(`(document.querySelector('[data-help="overview"]') || { innerText: '' }).innerText`)))
  const before = defaultsAtStart
  check('the defaults: listen with Groq, a face when one is set, setup not done', before && before.ok === true && before.settings.use.listen === 'groq' && before.settings.use.face === 'liveavatar' && before.settings.setupDone === false && before.settings.language === 'auto' && before.settings.silenceMinutes === 5 && before.settings.cloneUpload === false, before && before.settings)
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
  const SECRET = 'gsk_' + 'x'.repeat(30) + '_SECRET_MUST_NOT_APPEAR'
  await setField('[data-field="GROQ_API_KEY"]', SECRET)
  await click('[data-act="save-GROQ_API_KEY"]')
  const stored = await poll(async () => { const x = await getSettings(); return x && x.keys.GROQ_API_KEY.set === true }, 8000)
  check('a key typed on a provider\'s page is saved: the host says "set"', stored === true)
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

  console.log('4. Settings › Calls › Health')
  await click('[data-act="tab-health"]')
  await poll(() => val(`!!document.querySelector('[data-act="run-health"]')`), 8000)
  await click('[data-act="run-health"]')
  const final = await poll(() => val(`(() => { const r = Array.from(document.querySelectorAll('[data-check]')); return r.length === 6 && r.every((e) => ['ok', 'warn', 'bad'].includes(e.getAttribute('data-status'))) ? JSON.stringify(Object.fromEntries(r.map((e) => [e.getAttribute('data-check'), [e.getAttribute('data-status'), e.innerText.replace(/\\s+/g, ' ')]]))) : null })()`), 70000)
  const rows = final ? JSON.parse(final) : {}
  check('"Check everything" fills the six rows: microphone, listen, speak, face, line, call engine', final !== null && final !== undefined, final)
  check('a missing key is named: listen is bad and says no key is saved', rows.listen && rows.listen[0] === 'bad' && /No key saved/.test(rows.listen[1]), rows.listen)
  check('the line says what is missing', rows.line && rows.line[0] === 'bad' && /missing/.test(rows.line[1]), rows.line)
  check('a call engine that is not installed says so', rows.engine && rows.engine[0] === 'bad' && /not installed/.test(rows.engine[1]), rows.engine)
  check('a face provider that is not wanted is fine, and says calls are voice only', rows.face && rows.face[0] === 'ok' && /voice only/.test(rows.face[1]), rows.face)
  check('the voice is tried through the app\'s own engine', rows.speak && ['ok', 'warn'].includes(rows.speak[0]) && /The voice answers|took over/.test(rows.speak[1]), rows.speak)
  await shot('settings-health')
  await click('[data-act="fix-listen"]')
  check('a failing row opens the provider to fix it', (await poll(() => val(`!!document.querySelector('[data-provider="groq"]')`), 8000)) === true)
} catch (e) {
  fail += 1
  console.log('  ✗ ' + (e && e.message ? e.message : e))
} finally {
  await cleanup()
  await live.close()
}
console.log('\n' + (fail === 0 ? '✓' : '✗') + ' kybernos-call ui live: ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
