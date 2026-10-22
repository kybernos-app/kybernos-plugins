#!/usr/bin/env node
// Settings › Kaby (packages/kybernos-kaby-customisation), in a real GUI.
//
//   scripts/sandbox/setup.sh && scripts/sandbox/start.sh
//   source scripts/sandbox/env.sh && node scripts/check-kaby-customisation-live.mjs [--shots <dir>]
//
// It needs the sandbox instance (docs/dev/live-testing.md): the page writes the profile, a portrait and a voice sample into the DSH home, so it
// refuses to run against the user's own :3080 (exit 3). Real: the DSH page, the Settings dialog and its menu, the bundle's host routes and the
// folder they write, the core's voice list. Faked, by replacing the page's `fetch` for those two paths only, before any script runs: the image
// model's answer (`/kybernos/image/generate`: the sandbox has no model key; it answers a plain 512 px PNG) and the voice engine's audio
// (`/kybernos/tts/speak`, recorded so the check can read what was asked). Exit code 0 / 1 / 3 (not run).
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { openLivePage, waitFor } from './live-page.mjs'

const args = process.argv.slice(2)
const shotDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const authority = process.env.KB_HOST || '127.0.0.1:3080'
if (authority === '127.0.0.1:3080') { console.log('refusing to run on the real :3080: use the sandbox (source scripts/sandbox/env.sh)'); process.exit(3) }

// A plain 512 x 512 PNG, made here (no picture file in the repository).
const png = (() => {
  const w = 512
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(w, 4); ihdr[8] = 8; ihdr[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x7a)])
  const raw = Buffer.concat(Array.from({ length: w }, () => row))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
})()

const FAKE = `(() => {
  const real = window.fetch.bind(window)
  window.__kc = { image: 0, speak: [] }
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || ''
    if (url === '/kybernos/image/generate') {
      window.__kc.image += 1
      return new Response(JSON.stringify({ ok: true, model: 'qwen-image-3.0-pro', ms: 10, price: 0.04, image: 'data:image/png;base64,${png.toString('base64')}' }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (url === '/kybernos/tts/speak') {
      window.__kc.speak.push(JSON.parse(init.body))
      return new Response(JSON.stringify({ ok: false, error: 'faked: no audio in this check' }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return real(input, init)
  }
})()`

const live = await openLivePage({ width: 1400, height: 1100 })
const { page } = live
await page.send('Page.addScriptToEvaluateOnNewDocument', { source: FAKE })
await page.send('Page.navigate', { url: 'http://' + authority + '/' })
const js = async (expr, ms = 8000) => { const r = await page.evalJs(expr, ms); return r.err !== undefined ? { err: r.err } : r.val }
const q = (sel) => JSON.stringify(sel)
const exists = (sel) => js(`document.querySelector(${q(sel)}) !== null`)
const click = (sel) => js(`(() => { const e = document.querySelector(${q(sel)}); if (!e) return false; e.click(); return true })()`)
const type = async (sel, v) => {
  const ok = await js(`(() => { const el = document.querySelector(${q(sel)}); if (!el) return false; el.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  await sleep(150) // React renders the new value before the field loses focus, as it does for a person
  // A headless window has no focus, so .blur() sends nothing: the focusout React listens to for onBlur is sent by hand.
  await js(`document.querySelector(${q(sel)}).dispatchEvent(new FocusEvent('focusout', { bubbles: true }))`)
  return ok
}
const api = (path, body) => js(`fetch('/kybernos-kaby-customisation${path}', ${body === undefined ? '{}' : `{ method: 'POST', headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }`}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }))`)
const shot = async (name) => { if (shotDir !== null) { mkdirSync(shotDir, { recursive: true }); await page.shot(join(shotDir, name + '.png')) } }

try {
  // The sandbox keeps what an earlier run left: start from the defaults.
  await waitFor(page, 'document.body && document.body.innerText.length > 40', 30000)
  await api('/voice-sample/remove', {}); await api('/portrait/remove', {}); await api('/profile', { patch: { name: 'Kaby', look: '', voice: { pick: 'default' } } })
  console.log('── the seam and the page ──')
  check('the bundle published its seam', await waitFor(page, 'typeof window.__KB_KABY__ === "object" && typeof window.__KB_KABY__.open === "function"', 30000) === true)
  await sleep(500)
  check('the profile was read by the seam before the page opened', await waitFor(page, 'window.__KB_KABY__ && window.__KB_KABY__.profile() !== null', 15000) === true)
  const opened = await js('window.__KB_KABY__.open()', 30000)
  check('open() reaches Settings › Kaby', opened === true && await waitFor(page, 'document.querySelector(\'[data-kb="kaby-custom-page"]\') !== null', 15000) === true)
  await sleep(800)
  await shot('01-page')
  check('the three blocks are drawn', (await js('["kaby-custom-identity","kaby-custom-voice","kaby-custom-face"].every((k) => document.querySelector(`[data-kb="${k}"]`) !== null)')) === true)
  const cells = await js('Array.from(document.querySelectorAll(\'[class*="navCell"]\')).map((e) => e.textContent.trim())')
  check('« Kaby » is in the Settings menu, next to the agents', Array.isArray(cells) && cells.includes('Kaby') && Math.abs(cells.indexOf('Kaby') - cells.indexOf('Workers')) <= 3, cells)
  check('its menu entry has an icon of its own, not the shell’s gear', (await js('(() => { const c = Array.from(document.querySelectorAll(\'[class*="navCell"]\')).find((e) => e.textContent.trim() === "Kaby"); return !!c && c.querySelector("svg") !== null })()')) === true)
  check('the help card of the Suite is in the header when the Suite is there', (await js('document.querySelector(\'[data-kb="kaby-custom-page"] h4\') !== null')) === true)

  console.log('── identity ──')
  check('the default name is Kaby', (await js('document.querySelector(\'[data-kb="kaby-custom-name"]\').value')) === 'Kaby')
  await type('[data-kb="kaby-custom-name"]', 'Claude')
  await sleep(600)
  check('a reserved name is refused on the page, with a sentence', (await js('document.querySelector(\'[data-kb="kaby-custom-page"] [role="alert"]\') !== null')) === true)
  check('and nothing was kept', (await api('/profile')).json.profile.name === 'Kaby')
  await type('[data-kb="kaby-custom-name"]', 'Léa')
  await sleep(800)
  check('a valid name is kept by the host', (await api('/profile')).json.profile.name === 'Léa')
  check('and the seam tells everyone', (await js('window.__KB_KABY__.profile().name')) === 'Léa')
  check('« Generate » is off while there are no words about the look', (await js('document.querySelector(\'[data-kb="kaby-custom-generate"]\').disabled')) === true)
  await type('[data-kb="kaby-custom-look"]', 'a calm woman in her thirties, short dark hair, green sweater')
  await sleep(700)
  check('the look is kept by the host', (await api('/profile')).json.profile.look.startsWith('a calm woman'))
  check('« Generate » is on once there are words', (await js('document.querySelector(\'[data-kb="kaby-custom-generate"]\').disabled')) === false)
  check('no portrait yet', (await exists('[data-kb="kaby-custom-portrait"]')) === false)
  await click('[data-kb="kaby-custom-generate"]')
  check('Generate shows the portrait the host kept', await waitFor(page, 'document.querySelector(\'[data-kb="kaby-custom-portrait"]\') !== null', 15000) === true)
  const kept = (await api('/profile')).json.profile
  check('the host kept it as generated, with the model', kept.portrait !== null && kept.portrait.source === 'generated' && kept.portrait.model === 'qwen-image-3.0-pro')
  const served = await js(`fetch(${q(kept.portrait.url)}).then(async (r) => ({ status: r.status, type: r.headers.get('content-type'), len: (await r.arrayBuffer()).byteLength }))`)
  check('the portrait is served back as a PNG, not cached', served.status === 200 && served.type === 'image/png' && served.len === png.length, served)
  check('the page asked the image route exactly once', (await js('window.__kc.image')) === 1)
  await sleep(600)
  await shot('02-portrait')
  await click('[data-kb="kaby-custom-remove-portrait"]')
  check('removing the portrait removes it from the page and from the host', await waitFor(page, 'document.querySelector(\'[data-kb="kaby-custom-portrait"]\') === null', 8000) === true && (await api('/profile')).json.profile.portrait === null)
  await click('[data-kb="kaby-custom-import"]')
  await sleep(300)
  check('Import asks for the consent before it takes a file', (await js('(() => { const f = document.querySelector(\'[data-kb="kaby-custom-file"]\'); return !!f && f.disabled === true })()')) === true)
  await click('[data-kb="kaby-custom-consent"]')
  await sleep(300)
  check('and takes the file once it is ticked', (await js('document.querySelector(\'[data-kb="kaby-custom-file"]\').disabled')) === false)

  console.log('── voice ──')
  const pills = await js('Array.from(document.querySelectorAll(\'[data-kb="kaby-custom-voice-pill"]\')).map((e) => e.dataset.voice)')
  check('the app voice pill is there and pressed', Array.isArray(pills) && pills[0] === 'default' && (await js('document.querySelector(\'[data-kb="kaby-custom-voice-pill"]\').getAttribute("aria-pressed")')) === 'true', pills)
  check('the core’s voices are offered as pills (the machine has at least one ready engine)', Array.isArray(pills) && pills.length > 1, pills)
  if (Array.isArray(pills) && pills.length > 1) {
    await click('[data-kb="kaby-custom-voice-pill"][data-voice="' + pills[1] + '"]')
    await sleep(700)
    const v = (await api('/profile')).json.profile.voice
    check('picking a voice keeps engine, voice and language', v.pick === 'voice' && v.voice === pills[1] && typeof v.engine === 'string', v)
    await click('[data-kb="kaby-custom-preview"]')
    await sleep(900)
    const asked = await js('window.__kc.speak')
    check('Preview asked the voice engine for that voice, with the name in the sentence', asked.length === 1 && asked[0].voice === pills[1] && asked[0].text.includes('Léa'), asked)
    check('a voice engine that fails is told to the person, not swallowed', (await js('(() => { const e = document.querySelector(\'[data-kb="kaby-custom-voice-error"]\'); return !!e && e.textContent.includes("faked") })()')) === true)
  }
  await click('[data-kb="kaby-custom-voice-pill"][data-voice="default"]')
  await sleep(500)
  check('the app voice can be picked back', (await api('/profile')).json.profile.voice.pick === 'default')
  await click('[data-kb="kaby-custom-custom-voice"]')
  await sleep(400)
  check('the custom voice window opens, with Save off', (await exists('[data-kb="kaby-custom-cv"]')) === true && (await js('document.querySelector(\'[data-act="save-custom"]\').disabled')) === true)
  await shot('03-custom-voice')
  await click('[data-act="close-cv"]')
  await sleep(300)
  check('and closes', (await exists('[data-kb="kaby-custom-cv"]')) === false)
  const sample = 'data:audio/webm;base64,' + Buffer.from('not really audio, only bytes').toString('base64')
  const sent = await api('/voice-sample', { name: 'My voice', consent: true, sample })
  check('a voice sample with consent is kept by the host', sent.status === 200 && sent.json.profile.customVoice.name === 'My voice', sent)
  await js('window.__KB_KABY__.refresh()')
  await sleep(600)
  check('the page then shows it as a pill', (await exists('[data-kb="kaby-custom-voice-pill"][data-voice="custom"]')) === true)
  await click('[data-kb="kaby-custom-voice-pill"][data-voice="custom"]')
  await sleep(600)
  check('picked, it says no engine speaks it yet', (await js('document.querySelector(\'[data-kb="kaby-custom-voice"]\').textContent.includes("Not spoken yet")')) === true)
  await api('/voice-sample/remove', {})
  await sleep(300)
  check('removing the sample puts the voice back to the app’s', (await api('/profile')).json.profile.voice.pick === 'default')

  console.log('── face ──')
  const provs = await js('Array.from(document.querySelectorAll(\'[data-kb="kaby-custom-face-provider"]\')).map((e) => e.dataset.provider)')
  check('six face providers are listed', Array.isArray(provs) && provs.length === 6 && provs[0] === 'none', provs)
  check('« No face » is in use, and its button says so', (await js('(() => { const b = document.querySelector(\'[data-kb="kaby-custom-face-use"]\'); return b.disabled === true && b.textContent.includes("In use") })()')) === true)
  await click('[data-kb="kaby-custom-face-provider"][data-provider="anam"]')
  await sleep(300)
  check('a provider that no call can use yet says « soon » and cannot be chosen', (await exists('[data-kb="kaby-custom-face-soon"]')) === true && (await js('document.querySelector(\'[data-kb="kaby-custom-face-use"]\').disabled')) === true)
  const refused = await api('/profile', { patch: { face: { use: 'anam' } } })
  check('and the host refuses it too, as « soon »', refused.status === 400 && refused.json.refused.face === 'soon', refused)
  await shot('04-face')

  console.log('── the host guards ──')
  const badBody = await js(`fetch('/kybernos-kaby-customisation/profile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{ nope' }).then((r) => r.status)`)
  check('a body that is not JSON is 400 (the origin guard itself is played by test-host.mjs: a page cannot forge an Origin)', badBody === 400, badBody)
  const reload = await js('location.reload(), true')
  await sleep(100)
  void reload
  check('the profile survives a reload (the file is on disk)', await waitFor(page, 'window.__KB_KABY__ && window.__KB_KABY__.profile() && window.__KB_KABY__.profile().name === "Léa"', 30000) === true)
} finally {
  try { await api('/profile', { patch: { name: 'Kaby', look: '', voice: { pick: 'default' } } }) } catch (e) { /* sandbox only */ }
  try { await api('/portrait/remove', {}) } catch (e) { /* sandbox only */ }
  await live.close()
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail > 0 ? 1 : 0)
