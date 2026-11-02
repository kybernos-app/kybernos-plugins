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
// The three cards about what Kaby does are real too: the permissions card and the wake-ups card sign, pause and (wake-ups) ask for a wake-up
// through kybernos-cloud's real routes and the sandbox's own key (the records are read back from disk; no Kaby chat exists in the sandbox, so
// « Wake it now » is checked for its refusal, not for a run), and « Where Kaby works » is drawn from kybernos-kyber's real seam. Faked there:
// the account (kybernos-kyber's two reads, `/kybernos-cloud/kyber` and `/server`, and its link call `/kybernos-cloud/kyby/computer`, so no
// account is ever touched and no computer is linked), and only once the check says so.
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
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

const CLOUD = [{ id: 'aaaaaaaa-1111', name: 'Home', state: 'suspended' }, { id: 'bbbbbbbb-2222', name: 'Atelier', state: 'running' }]
const FAKE = `(() => {
  const real = window.fetch.bind(window)
  window.__kcCloud = false
  window.__kcHome = 'aaaaaaaa-1111'
  window.__kc = { image: 0, speak: [], linked: [] }
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
    // kybernos-kyber's account: none in the sandbox. Off until the check turns it on; the link call is always faked, so no computer is ever linked.
    if (url === '/kybernos-cloud/kyber' && window.__kcCloud === true) {
      const cs = ${JSON.stringify(CLOUD)}
      return new Response(JSON.stringify({ ok: true, connected: true, telegram: null, home: cs.find((c) => c.id === window.__kcHome), computers: cs }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (url === '/kybernos-cloud/server' && window.__kcCloud === true) return new Response(JSON.stringify({ ok: true, server: { api: 'https://example.invalid/', web: 'https://example.invalid' } }), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url === '/kybernos-cloud/kyby/computer' && init && init.method === 'POST') {
      const id = JSON.parse(init.body).computer_id
      window.__kc.linked.push(id)
      if (id) window.__kcHome = id
      return new Response(JSON.stringify({ ok: true, computer_id: id }), { status: 200, headers: { 'content-type': 'application/json' } })
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
const mandateApi = (path, body) => js(`fetch('/kybernos-cloud/kyby/mandate${path}', ${body === undefined ? '{}' : `{ method: 'POST', headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }`}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }))`)
const mandateFile = () => join(process.env.DSH_HOME || '', 'kybernos', 'kyby-mandate.json')
const heartbeatApi = (path, body) => js(`fetch('/kybernos-cloud/kyby/heartbeat${path}', ${body === undefined ? '{}' : `{ method: 'POST', headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }`}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }))`)
const heartbeatFile = () => join(process.env.DSH_HOME || '', 'kybernos', 'kyby-heartbeat.json')
const shot = async (name, sel) => { if (shotDir !== null) { mkdirSync(shotDir, { recursive: true }); if (sel !== undefined) { await js(`(() => { const e = document.querySelector(${q(sel)}); if (e) e.scrollIntoView({ block: 'start' }); return true })()`); await sleep(250) } await page.shot(join(shotDir, name + '.png')) } }

try {
  // The sandbox keeps what an earlier run left: start from the defaults.
  await waitFor(page, 'document.body && document.body.innerText.length > 40', 30000)
  await api('/voice-sample/remove', {}); await api('/portrait/remove', {}); await api('/profile', { patch: { name: 'Kaby', look: '', voice: { pick: 'default' } } })
  await mandateApi('/set', { preset: 'off', paused: false })
  // Wake-ups: nothing signed at the start (the record is the sandbox's own file; this check never runs on the real :3080).
  for (const f of ['kyby-heartbeat.json', 'kyby-heartbeat-state.json', 'kyby-heartbeat-audit.jsonl']) rmSync(join(process.env.DSH_HOME || '', 'kybernos', f), { force: true })
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

  console.log('── wired into the sidebar row and the strip of Kaby’s chat ──')
  await js('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))') // the sidebar is behind the Settings dialog: Escape closes it
  check('Settings closed', await waitFor(page, 'document.querySelector(\'[data-kb="kaby-custom-page"]\') === null', 8000) === true)
  check('the sidebar row of Kaby shows the portrait the host serves', await waitFor(page, 'document.querySelector(\'[data-kb="kb-kaby-row-portrait"]\') !== null', 10000) === true)
  check('and the name the person gave, not the product’s', (await js('Array.from(document.querySelectorAll("button.kb4-item")).some((b) => b.getAttribute("aria-label") === "Léa")')) === true)
  check('the row is not a second button: the portrait sits inside the row’s own button', (await js('(() => { const i = document.querySelector(\'[data-kb="kb-kaby-row-portrait"]\'); return !!i && i.closest("button.kb4-item") !== null && i.closest("button.kb4-item").querySelector("button") === null })()')) === true)
  await shot('02b-row')
  check('Kaby’s chat opens from that row’s hook', (await js('window.__KB_KYBER__ && window.__KB_KYBER__.openChat().then((ok) => ok === true)', 60000)) === true)
  check('the strip above its composer heads with the portrait and the name', await waitFor(page, 'document.querySelector(\'[data-kb="kybernos-kyber-customise"] img[data-kb="kybernos-kyber-portrait"]\') !== null', 30000) === true && (await js('document.querySelector(\'[data-kb="kybernos-kyber-customise"]\').textContent.trim()')) === 'Léa')
  await sleep(500)
  await shot('02c-strip')
  check('a click on it opens Settings › Kaby', (await js('document.querySelector(\'[data-kb="kybernos-kyber-customise"]\').click(), true')) === true && await waitFor(page, 'document.querySelector(\'[data-kb="kaby-custom-page"]\') !== null', 30000) === true)
  await sleep(600)
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

  console.log('── where Kaby works ──')
  const whereChip = () => js('document.querySelector(\'[data-kb="kaby-custom-where-chip"]\').textContent')
  check('the card is drawn once kybernos-kyber has read the account', await waitFor(page, 'document.querySelector(\'[data-kb="kaby-custom-where"]\') !== null', 30000) === true)
  check('with no account the select offers this computer alone (so it is off) and the chip says Ready', (await js('(() => { const s = document.querySelector(\'[data-kb="kaby-custom-where-pick"]\'); return s.value === "local" && s.disabled === true && s.options.length === 1 })()')) === true && (await whereChip()).includes('Ready'))
  check('and says to keep Kybernos open, with no cloud warning', (await js('(() => { const t = document.querySelector(\'[data-kb="kaby-custom-where-help"]\').textContent; return t.includes("keep Kybernos open") && document.querySelector(\'[data-kb="kaby-custom-where-cloud-note"]\') === null })()')) === true)
  await shot('05-where-local', '[data-kb="kaby-custom-where"]')
  await js('window.__kcCloud = true, window.__KB_KYBER__.refresh().then(() => true)', 20000)
  check('with a cloud account (faked) the select lists this computer and the two cloud ones, and is on', await waitFor(page, '(() => { const s = document.querySelector(\'[data-kb="kaby-custom-where-pick"]\'); return !!s && s.options.length === 3 && s.disabled === false })()', 15000) === true)
  check('the cloud computer already made is the one picked, and the chip says its state', (await js('document.querySelector(\'[data-kb="kaby-custom-where-pick"]\').value')) === 'aaaaaaaa-1111' && (await whereChip()).includes('Asleep'))
  const pickWhere = (v) => js(`(() => { const s = document.querySelector('[data-kb="kaby-custom-where-pick"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ${JSON.stringify(v)}); s.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
  await pickWhere('bbbbbbbb-2222')
  check('picking the other cloud computer links it through the host (faked here), shows its state and the warning that the permissions do not reach it', await waitFor(page, 'window.__kc.linked.includes("bbbbbbbb-2222") && document.querySelector(\'[data-kb="kaby-custom-where-pick"]\').value === "bbbbbbbb-2222" && document.querySelector(\'[data-kb="kaby-custom-where-cloud-note"]\') !== null', 15000) === true && (await whereChip()).includes('Awake'))
  check('it is the setting of « Set up… »: the seam of kybernos-kyber says the same, and the browser remembered it', (await js('(() => { const w = window.__KB_KYBER__.where(); return w.local === false && w.picked === "bbbbbbbb-2222" && window.localStorage.getItem("kybernos-kyber.where") === "cloud" })()')) === true)
  await shot('05b-where-cloud', '[data-kb="kaby-custom-where"]')
  const linkedBefore = await js('window.__kc.linked.length')
  await pickWhere('local')
  check('going back to this computer calls nobody, drops the warning and is remembered', await waitFor(page, 'document.querySelector(\'[data-kb="kaby-custom-where-cloud-note"]\') === null && window.localStorage.getItem("kybernos-kyber.where") === "local"', 8000) === true && (await js('window.__kc.linked.length')) === linkedBefore && (await whereChip()).includes('Ready'))
  await js('window.__kcCloud = false, window.__KB_KYBER__.refresh().then(() => true)', 20000)

  console.log('── permissions ──')
  const chipState = () => js('document.querySelector(\'[data-kb="kaby-custom-mandate-chip"]\').dataset.state')
  check('the card is drawn, and nothing is in force at the start', await waitFor(page, 'document.querySelector(\'[data-kb="kaby-custom-mandate-chip"]\') !== null', 15000) === true && (await chipState()) === 'none')
  check('« Off » is the pressed starting point; sign is off (nothing to sign), the switches are on', (await js('(() => { const on = Array.from(document.querySelectorAll(\'[data-kb="kaby-custom-mandate-preset"]\')).filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.dataset.preset); return on.join() === "off" && document.querySelector(\'[data-kb="kaby-custom-mandate-sign"]\').disabled === true && Array.from(document.querySelectorAll(\'[data-kb="kaby-custom-mandate-switch"]\')).every((b) => b.disabled === false) })()')) === true)
  await shot('06-permissions-none', '[data-kb="kaby-custom-mandate"]')
  await click('[data-kb="kaby-custom-mandate-preset"][data-preset="standard"]')
  await sleep(300)
  check('a starting point is a draft: « Changes to sign », sign on, and nothing is written yet', (await chipState()) === 'dirty' && (await js('document.querySelector(\'[data-kb="kaby-custom-mandate-sign"]\').disabled')) === false && (await mandateApi('')).json.inForce === false)
  await click('[data-kb="kaby-custom-mandate-sign"]')
  check('signing puts it in force: the chip, the host’s view and the signed file agree', await waitFor(page, 'document.querySelector(\'[data-kb="kaby-custom-mandate-chip"]\').dataset.state === "in_force"', 15000) === true)
  const inForce = (await mandateApi('')).json
  check('the host says standard, 40 and 40, and never sends the signature', inForce.inForce === true && inForce.preset === 'standard' && inForce.memoryPerDay === 40 && inForce.computerPerDay === 40 && !JSON.stringify(inForce).includes('"sig"'), inForce)
  check('the record is on disk, private and signed', (() => { try { const st = statSync(mandateFile()); const rec = JSON.parse(readFileSync(mandateFile(), 'utf8')); return (st.mode & 0o777) === 0o600 && typeof rec.sig === 'string' && rec.sig.length === 64 && rec.memory === true && rec.computer === true } catch (e) { return false } })())
  check('today’s use is shown for each class on', (await js('document.querySelectorAll(\'[data-kb="kaby-custom-mandate-use"]\').length')) === 2)
  await shot('07-permissions-in-force', '[data-kb="kaby-custom-mandate"]')
  await type('[data-kb="kaby-custom-mandate-limit"][data-class="memory"]', '10')
  await sleep(300)
  check('a limit changed is a draft again, shown as Custom', (await chipState()) === 'dirty' && (await exists('[data-kb="kaby-custom-mandate-custom"]')) === true)
  await click('[data-kb="kaby-custom-mandate-sign"]')
  await waitFor(page, 'document.querySelector(\'[data-kb="kaby-custom-mandate-chip"]\').dataset.state === "in_force"', 15000)
  const custom = (await mandateApi('')).json
  check('signed again with 10 a day for memory, the rest kept', custom.memoryPerDay === 10 && custom.computerPerDay === 40 && custom.preset === 'custom', custom)
  await click('[data-kb="kaby-custom-mandate-switch"][data-class="computer"]')
  await click('[data-kb="kaby-custom-mandate-sign"]')
  await waitFor(page, 'document.querySelector(\'[data-kb="kaby-custom-mandate-chip"]\').dataset.state === "in_force"', 15000)
  check('switching a class off and signing leaves it off in the host', (await mandateApi('')).json.computer === false)
  await click('[data-kb="kaby-custom-mandate-pause"]')
  check('pausing stops everything: the chip, the sentence, and the host says paused with the settings kept', await waitFor(page, 'document.querySelector(\'[data-kb="kaby-custom-mandate-chip"]\').dataset.state === "paused"', 15000) === true && (await exists('[data-kb="kaby-custom-mandate-note"]')) === true)
  const paused = (await mandateApi('')).json
  check('the host keeps the numbers while paused, and covers nothing', paused.paused === true && paused.inForce === false && paused.memory === true && paused.memoryPerDay === 10, paused)
  await shot('08-permissions-paused', '[data-kb="kaby-custom-mandate"]')
  await click('[data-kb="kaby-custom-mandate-pause"]')
  check('resuming puts it back in force', await waitFor(page, 'document.querySelector(\'[data-kb="kaby-custom-mandate-chip"]\').dataset.state === "in_force"', 15000) === true && (await mandateApi('')).json.inForce === true)
  await click('[data-kb="kaby-custom-mandate-log-toggle"]')
  check('the log opens and says nothing ran without a question today', await waitFor(page, 'document.querySelector(\'[data-kb="kaby-custom-mandate-log-empty"]\') !== null', 8000) === true)
  const refusedSet = await js(`fetch('/kybernos-cloud/kyby/mandate/set', { method: 'POST', credentials: 'omit', headers: { 'content-type': 'application/json' }, body: '{"preset":"intensive"}' }).then((r) => r.status)`)
  check('a signing request without the page’s session is refused, and nothing changed', (refusedSet === 401 || refusedSet === 403) && (await mandateApi('')).json.preset === 'custom', refusedSet)
  await shot('09-permissions-log', '[data-kb="kaby-custom-mandate"]')

  console.log('── wake-ups ──')
  const hbChip = () => js('document.querySelector(\'[data-kb="kaby-custom-heartbeat-chip"]\').dataset.state')
  const hbDisabled = (k) => js(`document.querySelector('[data-kb="kaby-custom-heartbeat-${k}"]').disabled`)
  const hbSettled = (states) => waitFor(page, `${JSON.stringify(states)}.includes(document.querySelector('[data-kb="kaby-custom-heartbeat-chip"]').dataset.state)`, 15000)
  const setSelect = (sel, v) => js(`(() => { const s = document.querySelector(${q(sel)}); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, ${JSON.stringify(v)}); s.dispatchEvent(new Event('change', { bubbles: true })); return true })()`)
  check('the card is drawn, and nothing is signed at the start', await waitFor(page, 'document.querySelector(\'[data-kb="kaby-custom-heartbeat-chip"]\') !== null', 15000) === true && (await hbChip()) === 'none')
  check('« Off » is the pressed starting point; sign, pause and « Wake it now » are off (nothing signed)', (await js('Array.from(document.querySelectorAll(\'[data-kb="kaby-custom-heartbeat-preset"]\')).filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.dataset.preset).join()')) === 'off' && (await hbDisabled('sign')) === true && (await hbDisabled('pause')) === true && (await hbDisabled('wake')) === true)
  check('three selects with the host’s choices, the quiet hours at 22:00 to 08:00, and no cloud warning on this computer', (await js('(() => { const o = (k) => Array.from(document.querySelector(`[data-kb="kaby-custom-heartbeat-${k}"]`).options).map((x) => x.value).join(); return o("everyHours") === "2,4,8,24" && o("boxMin") === "5,10,20" && o("items") === "1,2,3" && document.querySelector(\'[data-kb="kaby-custom-heartbeat-from"]\').value === "22:00" && document.querySelector(\'[data-kb="kaby-custom-heartbeat-to"]\').value === "08:00" && document.querySelector(\'[data-kb="kaby-custom-heartbeat-cloud-note"]\') === null })()')) === true)
  check('« Open Kaby’s chat » is there, through kybernos-kyber’s seam', (await exists('[data-kb="kaby-custom-heartbeat-open"]')) === true)
  check('the card holds parameters only: no list, no report, no last wake-up line', (await exists('[data-kb="kaby-custom-heartbeat-last"]')) === false && (await js('document.querySelector(\'[data-kb="kaby-custom-heartbeat"]\').textContent.includes("in its chat, not here")')) === true)
  await shot('11-wakeups-none', '[data-kb="kaby-custom-heartbeat"]')
  await click('[data-kb="kaby-custom-heartbeat-preset"][data-preset="regular"]')
  await sleep(300)
  check('a starting point is a draft: « Changes to sign », « Turn the wake-ups on », nothing written yet', (await hbChip()) === 'dirty' && (await hbDisabled('sign')) === false && (await js('document.querySelector(\'[data-kb="kaby-custom-heartbeat-sign"]\').textContent')).includes('Turn the wake-ups on') && (await heartbeatApi('')).json.inForce === false && (await hbDisabled('wake')) === true)
  await click('[data-kb="kaby-custom-heartbeat-sign"]')
  check('signing puts it in force: the chip is « on » (or « quiet » in the night hours)', await hbSettled(['on', 'quiet']) === true)
  const hbOn = (await heartbeatApi('')).json
  check('the host says regular, every 4 h, 10 min, 2 points, quiet 22:00 to 08:00, desktop, and never sends the signature', hbOn.inForce === true && hbOn.preset === 'regular' && hbOn.everyHours === 4 && hbOn.boxMin === 10 && hbOn.items === 2 && hbOn.quiet === true && hbOn.quietFrom === '22:00' && hbOn.quietTo === '08:00' && hbOn.desktop === true && hbOn.running === false && !JSON.stringify(hbOn).includes('"sig"'), hbOn)
  check('the record is on disk, private and signed', (() => { try { const st = statSync(heartbeatFile()); const rec = JSON.parse(readFileSync(heartbeatFile(), 'utf8')); return (st.mode & 0o777) === 0o600 && typeof rec.sig === 'string' && rec.sig.length === 64 && rec.on === true && rec.everyHours === 4 } catch (e) { return false } })())
  check('the chip names the next time (or the end of the quiet hours), and « Wake it now » and pause are on', /\d\d:\d\d/.test(await js('document.querySelector(\'[data-kb="kaby-custom-heartbeat-chip"]\').textContent')) && (await hbDisabled('wake')) === false && (await hbDisabled('pause')) === false && (await hbDisabled('sign')) === true)
  await shot('12-wakeups-on', '[data-kb="kaby-custom-heartbeat"]')
  await setSelect('[data-kb="kaby-custom-heartbeat-everyHours"]', '8')
  await sleep(300)
  check('another interval is a draft again, shown as Custom, and « Wake it now » waits for the signature', (await hbChip()) === 'dirty' && (await exists('[data-kb="kaby-custom-heartbeat-custom"]')) === true && (await hbDisabled('wake')) === true)
  await click('[data-kb="kaby-custom-heartbeat-sign"]')
  await hbSettled(['on', 'quiet'])
  const hbEight = (await heartbeatApi('')).json
  check('signed again every 8 h, the rest kept', hbEight.everyHours === 8 && hbEight.boxMin === 10 && hbEight.items === 2 && hbEight.preset === 'custom', hbEight)
  await click('[data-kb="kaby-custom-heartbeat-quiet-switch"]')
  await sleep(200)
  check('the quiet switch off turns the two times off', (await hbDisabled('from')) === true && (await hbDisabled('to')) === true)
  await click('[data-kb="kaby-custom-heartbeat-sign"]')
  await hbSettled(['on', 'quiet'])
  check('signed with no quiet hours: the host says so, and the chip is « on » whatever the hour, with the time of the next wake-up', (await heartbeatApi('')).json.quiet === false && (await hbChip()) === 'on' && /next around \d\d:\d\d/.test(await js('document.querySelector(\'[data-kb="kaby-custom-heartbeat-chip"]\').textContent')))
  await shot('12b-wakeups-on-no-quiet', '[data-kb="kaby-custom-heartbeat"]')
  check('the two time fields are wide enough to show the whole time', (await js('Array.from(document.querySelectorAll(\'[data-kb="kaby-custom-heartbeat-from"], [data-kb="kaby-custom-heartbeat-to"]\')).every((i) => i.scrollWidth <= i.clientWidth + 1)')) === true)
  await click('[data-kb="kaby-custom-heartbeat-quiet-switch"]')
  await type('[data-kb="kaby-custom-heartbeat-from"]', '23:00')
  await type('[data-kb="kaby-custom-heartbeat-to"]', '07:00')
  await sleep(200)
  await click('[data-kb="kaby-custom-heartbeat-sign"]')
  await hbSettled(['on', 'quiet'])
  const hbQuiet = (await heartbeatApi('')).json
  check('quiet hours back on, 23:00 to 07:00, kept by the host', hbQuiet.quiet === true && hbQuiet.quietFrom === '23:00' && hbQuiet.quietTo === '07:00', hbQuiet)
  // « Wake it now »: the sandbox has no model key, so a wake-up that starts ends at once. Either the host says why it cannot start (the chat is busy, or does not exist) and the card says it in
  // words, or a real turn of the chat's session starts, the chip follows it and the card then gives its last wake-up as one line.
  await click('[data-kb="kaby-custom-heartbeat-wake"]')
  const woke = await waitFor(page, 'document.querySelector(\'[data-kb="kaby-custom-heartbeat-error"]\') !== null || document.querySelector(\'[data-kb="kaby-custom-heartbeat-last"]\') !== null || document.querySelector(\'[data-kb="kaby-custom-heartbeat-chip"]\').dataset.state === "running"', 40000) === true
  if (await exists('[data-kb="kaby-custom-heartbeat-error"]')) {
    check('« Wake it now » that cannot start says why, in a sentence, and no wake-up starts', woke && (await js('document.querySelector(\'[data-kb="kaby-custom-heartbeat-error"]\').textContent.length')) > 20 && (await hbChip()) !== 'running' && (await heartbeatApi('')).json.lastAt === null)
    await shot('13-wakeups-cannot-start', '[data-kb="kaby-custom-heartbeat"]')
  } else if ((await hbChip()) === 'running') {
    const under = (await heartbeatApi('')).json
    check('« Wake it now » starts one wake-up of the chat’s session: the chip says « Working · 10 min at most », the button is off, and the host says so', woke && under.running === true && under.lastOutcome === 'running' && /^Working · 10 min at most$/.test(await js('document.querySelector(\'[data-kb="kaby-custom-heartbeat-chip"]\').textContent')) && (await hbDisabled('wake')) === true && (await exists('[data-kb="kaby-custom-heartbeat-last"]')) === false, under)
    await shot('13-wakeups-running', '[data-kb="kaby-custom-heartbeat"]')
    check('« Stop this wake-up » is on the card while it runs, and pressing it ends the wake-up as « stopped by you »', (await exists('[data-kb="kaby-custom-heartbeat-stop"]')) === true && (await hbDisabled('stop')) === false)
    await click('[data-kb="kaby-custom-heartbeat-stop"]')
    check('the stopped wake-up leaves the chip, the stop button goes and the last line says it', await waitFor(page, 'document.querySelector(\'[data-kb="kaby-custom-heartbeat-chip"]\').dataset.state !== "running"', 30000) === true && (await exists('[data-kb="kaby-custom-heartbeat-stop"]')) === false && ['stopped', 'done', 'person'].includes((await heartbeatApi('')).json.lastOutcome))
  } else {
    const done = (await heartbeatApi('')).json
    check('« Wake it now » starts one wake-up of the chat’s session: it ends with a closed word, and the card gives it as one line', woke && done.running === false && ['done', 'time', 'blocked', 'person', 'stopped', 'refused', 'error', 'interrupted'].includes(done.lastOutcome) && /^Last wake-up at \d\d:\d\d: .+\.$/.test((await js('document.querySelector(\'[data-kb="kaby-custom-heartbeat-last"]\').textContent')).trim()), done)
    await shot('13-wakeups-last', '[data-kb="kaby-custom-heartbeat"]')
  }
  const stopIdle = await heartbeatApi('/stop', {})
  check('a stop asked while nothing runs is answered « not_running », and the card has no stop button', stopIdle.json !== null && stopIdle.json.ok === false && stopIdle.json.error === 'not_running' && (await exists('[data-kb="kaby-custom-heartbeat-stop"]')) === false, stopIdle)
  await click('[data-kb="kaby-custom-heartbeat-pause"]')
  check('pausing stops the wake-ups: the chip, the sentence, « Wake it now » off, and the host says paused with the settings kept', await waitFor(page, 'document.querySelector(\'[data-kb="kaby-custom-heartbeat-chip"]\').dataset.state === "paused"', 15000) === true && (await exists('[data-kb="kaby-custom-heartbeat-note"]')) === true && (await hbDisabled('wake')) === true)
  const hbPaused = (await heartbeatApi('')).json
  check('the host keeps the numbers while paused, and nothing is in force', hbPaused.paused === true && hbPaused.inForce === false && hbPaused.on === true && hbPaused.everyHours === 8, hbPaused)
  await shot('14-wakeups-paused', '[data-kb="kaby-custom-heartbeat"]')
  await click('[data-kb="kaby-custom-heartbeat-pause"]')
  check('resuming puts it back in force', await hbSettled(['on', 'quiet']) === true && (await heartbeatApi('')).json.inForce === true)
  const refusedHb = await js(`Promise.all(['/set', '/wake', '/stop'].map((p) => fetch('/kybernos-cloud/kyby/heartbeat' + p, { method: 'POST', credentials: 'omit', headers: { 'content-type': 'application/json' }, body: '{"preset":"steady"}' }).then((r) => r.status)))`)
  check('a signing, a wake or a stop request without the page’s session is refused, and nothing changed', Array.isArray(refusedHb) && refusedHb.every((s) => s === 401 || s === 403) && (await heartbeatApi('')).json.preset === 'custom', refusedHb)
  await click('[data-kb="kaby-custom-heartbeat-preset"][data-preset="off"]')
  await click('[data-kb="kaby-custom-heartbeat-sign"]')
  check('« Off » signed: the host says off and the chip says no wake-ups', await hbSettled(['off']) === true && (await heartbeatApi('')).json.why === 'off')
  await shot('15-wakeups-off', '[data-kb="kaby-custom-heartbeat"]')
  await heartbeatApi('/set', { preset: 'light' })

  console.log('── the host guards ──')
  const badBody = await js(`fetch('/kybernos-kaby-customisation/profile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{ nope' }).then((r) => r.status)`)
  check('a body that is not JSON is 400 (the origin guard itself is played by test-host.mjs: a page cannot forge an Origin)', badBody === 400, badBody)
  const reload = await js('location.reload(), true')
  await sleep(100)
  void reload
  check('the profile survives a reload (the file is on disk)', await waitFor(page, 'window.__KB_KABY__ && window.__KB_KABY__.profile() && window.__KB_KABY__.profile().name === "Léa"', 30000) === true)
  check('the permissions survive it too: still in force after the reload', (await mandateApi('')).json.inForce === true)
  check('and so do the wake-ups', (await heartbeatApi('')).json.inForce === true)
  // A record edited by hand is void: the card says so and asks for a new signature.
  try { const rec = JSON.parse(readFileSync(mandateFile(), 'utf8')); writeFileSync(mandateFile(), JSON.stringify({ ...rec, memoryPerDay: 500 }) + '\n') } catch (e) { check('the record could be edited for the tamper check', false, String(e && e.message)) }
  await sleep(300)
  await js('window.__KB_KABY__.open()', 30000)
  check('an edited record is void: the host says altered, the card says to sign again, with an alert', await waitFor(page, 'document.querySelector(\'[data-kb="kaby-custom-mandate-chip"]\') && document.querySelector(\'[data-kb="kaby-custom-mandate-chip"]\').dataset.state === "resign"', 30000) === true && (await mandateApi('')).json.why === 'altered' && (await js('document.querySelector(\'[data-kb="kaby-custom-mandate-note"]\').getAttribute("role")')) === 'alert')
  await shot('10-permissions-altered', '[data-kb="kaby-custom-mandate"]')
  // The same for the wake-ups: a file edited by hand is void, and « Sign again » is on without a draft.
  try { const rec = JSON.parse(readFileSync(heartbeatFile(), 'utf8')); writeFileSync(heartbeatFile(), JSON.stringify({ ...rec, items: 3 }) + '\n') } catch (e) { check('the wake-ups record could be edited for the tamper check', false, String(e && e.message)) }
  await sleep(300)
  await js('location.reload(), true')
  await sleep(100)
  await waitFor(page, 'window.__KB_KABY__ && window.__KB_KABY__.profile() !== null', 30000)
  await js('window.__KB_KABY__.open()', 30000)
  check('an edited wake-ups record is void: the host says altered, the card says to sign again, with an alert, and pause, wake and sign are off', await waitFor(page, 'document.querySelector(\'[data-kb="kaby-custom-heartbeat-chip"]\') && document.querySelector(\'[data-kb="kaby-custom-heartbeat-chip"]\').dataset.state === "resign"', 30000) === true && (await heartbeatApi('')).json.why === 'altered' && (await js('document.querySelector(\'[data-kb="kaby-custom-heartbeat-note"]\').getAttribute("role")')) === 'alert' && (await hbDisabled('sign')) === true && (await hbDisabled('pause')) === true && (await hbDisabled('wake')) === true)
  await shot('16-wakeups-altered', '[data-kb="kaby-custom-heartbeat"]')
  await click('[data-kb="kaby-custom-heartbeat-preset"][data-preset="light"]')
  await click('[data-kb="kaby-custom-heartbeat-sign"]')
  check('a pick, then « Sign again »: the wake-ups are back in force, as the person chose', await hbSettled(['on', 'quiet']) === true && (await heartbeatApi('')).json.inForce === true && (await heartbeatApi('')).json.preset === 'light')
} finally {
  try { await api('/profile', { patch: { name: 'Kaby', look: '', voice: { pick: 'default' } } }) } catch (e) { /* sandbox only */ }
  try { await api('/portrait/remove', {}) } catch (e) { /* sandbox only */ }
  try { await mandateApi('/set', { preset: 'off', paused: false }) } catch (e) { /* sandbox only */ }
  try { await heartbeatApi('/set', { preset: 'off', paused: false }) } catch (e) { /* sandbox only */ }
  await live.close()
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail > 0 ? 1 : 0)
