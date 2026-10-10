// The first-run wizard on a real GUI: the screens, the account path's pairing, a key pasted and saved, a model
// installed and connected, and the hand-over to Settings. SANDBOX ONLY (`source scripts/sandbox/env.sh`): the key
// and the model are written for real to the settings of the instance, which is the point; the user's own
// `dsh web` must never be the target (exit 3).
//
// What the check answers itself over CDP, so that nothing leaves the machine and nothing heavy runs:
//   - the Kybernos Cloud pairing routes (a real pairing would start a request on a real server),
//   - the key check (a provider's own API would be asked about a made-up key),
//   - the installer and its progress (a real one runs `brew install ollama` and `ollama pull`).
// What it reads for real: the onboarding state (the sandbox's own file), the cloud status, the machine probe.
// What it verifies on disk, by name only and never printing a value: the credential and the provider routes
// the seams wrote.
//
// Named check-* on purpose: it needs a running sandbox and Chrome, so CI must not run it.
//   source scripts/sandbox/env.sh && node scripts/check-onboarding-live.mjs     (KB_SHOT_DIR=/some/dir keeps screenshots)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLivePage, waitFor } from './live-page.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const authority = process.env.KB_HOST || '127.0.0.1:3080'
if (authority === '127.0.0.1:3080') { console.error('refusing to run against :3080: this check writes a key and a model to the settings. Use the sandbox (source scripts/sandbox/env.sh).'); process.exit(3) }
const dshHome = process.env.DSH_HOME
if (!dshHome) { console.error('DSH_HOME is not set: source scripts/sandbox/env.sh'); process.exit(3) }

let fails = 0
const check = (label, ok, detail) => {
  if (!ok) fails += 1
  console.log((ok ? 'ok   ' : 'FAIL ') + label + (detail !== undefined && !ok ? ' | ' + detail : ''))
}
const shotDir = process.env.KB_SHOT_DIR || join(tmpdir(), 'kb-onboarding-live')
mkdirSync(shotDir, { recursive: true })
const read = (rel) => { try { return readFileSync(join(dshHome, rel), 'utf8') } catch (e) { return '' } }

// A fresh install: the sandbox's setup writes the file as done; the wizard opens only when it says otherwise.
mkdirSync(join(dshHome, 'kybernos'), { recursive: true })
writeFileSync(join(dshHome, 'kybernos/onboarding.json'), JSON.stringify({ version: 1, completed: false, installedAt: '2026-01-01T00:00:00.000Z', completedAt: null, profil: null, uiMode: null }) + '\n')

const live = await openLivePage()
const page = live.page
try {
  const fake = { keyVerdict: 'ok', installPolls: 0, calls: [] }
  const json = (body) => Buffer.from(JSON.stringify(body), 'utf8').toString('base64')
  const answers = (url, method) => {
    const path = new URL(url).pathname
    if (path === '/kybernos-cloud/start') { fake.calls.push('cloud-start'); return { ok: true, connected: false, status: 'pending', pairing: { user_code: 'KB4-7QX2', activation_url: 'https://server.example.test/cloud/cli/activate?deviceId=d1', expires_at: '2099-01-01T00:00:00Z' } } }
    if (path === '/kybernos-cloud/poll') { fake.calls.push('cloud-poll'); return { ok: true, connected: false, status: 'pending' } }
    if (path === '/kybernos-cloud/disconnect') { fake.calls.push('cloud-disconnect'); return { ok: true } }
    if (path === '/kybernos-models/key/check') { fake.calls.push('key-check'); return { ok: true, result: fake.keyVerdict } }
    if (path === '/modeles-locaux/installer') { fake.calls.push('install-start'); return { ok: true, demarre: true, cmd: 'ollama pull qwen3.5:9b' } }
    if (path === '/modeles-locaux/installation') {
      fake.installPolls += 1
      if (fake.installPolls < 3) return { ok: true, job: { cible: 'qwen3.5:9b', running: true, ok: null, pct: fake.installPolls === 1 ? null : 40, octets: fake.installPolls === 1 ? null : { recu: '2.4 GB', total: '6.1 GB' }, ligne: '' } }
      return { ok: true, job: { cible: 'qwen3.5:9b', running: false, ok: true, annule: false, pct: 100, octets: null, ligne: '' } }
    }
    return null
  }
  page.on('Fetch.requestPaused', async (p) => {
    if (p.responseStatusCode !== undefined) return
    let body = null
    try { body = answers(p.request.url, p.request.method) } catch (e) { body = null }
    try {
      if (body === null) await page.send('Fetch.continueRequest', { requestId: p.requestId })
      else await page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: json(body) })
    } catch (e) { /* the page moved on */ }
  })
  await page.send('Fetch.enable', { patterns: ['kybernos-cloud/start', 'kybernos-cloud/poll', 'kybernos-cloud/disconnect', 'kybernos-models/key/check',
    'modeles-locaux/installer', 'modeles-locaux/installation'].map((x) => ({ urlPattern: '*/' + x + '*', requestStage: 'Request' })) })
  await page.send('Page.reload', { ignoreCache: true })

  const q = async (expr) => (await page.evalJs(expr, 8000)).val
  // Pressed by its own button (exact label, else the label it starts with: a row's tag is part of its text). The mouse
  // helper of live-page picks the first ELEMENT showing the text, which for a short label is the row of buttons around it.
  const press = async (text) => {
    const ok = await q(`(() => { const all = [...document.querySelectorAll('.kb-ob button')].filter((b) => !b.disabled); const want = ${JSON.stringify(text)};
      const b = all.find((x) => x.textContent.trim() === want) || all.find((x) => x.textContent.trim().indexOf(want) === 0); if (!b) return false; b.click(); return true })()`)
    await sleep(300)
    return ok === true
  }
  const h1 = async () => q(`(document.querySelector('.kb-ob h1') || {}).textContent`)
  const seen = (text) => waitFor(page, `[...document.querySelectorAll('.kb-ob h1')].some((e) => e.textContent.trim() === ${JSON.stringify(text)})`, 8000)
  const goEnglish = async () => {
    await q(`document.querySelector('.kb-ob-lang-btn').click()`); await sleep(150)
    await q(`document.querySelector('.kb-ob-menu button[lang="en"]').click()`); await sleep(150)
  }
  const toModelStep = async () => { await press('Get started'); await press('Continue'); await press('Continue') }
  const typeKey = async (value) => q(`(() => { const i = document.querySelector('#kb-ob-key'); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)

  /* ── 1. the first run, through the sandbox's own host route ─────────────────────────────────────────────── */
  check('the wizard opens on a fresh install', (await waitFor(page, `!!document.querySelector('.kb-ob')`, 40000)) === true)
  check('it is a modal dialog with the Kybernos mark', (await q(`(() => { const r = document.querySelector('.kb-ob'); return r.getAttribute('role') === 'dialog' && r.getAttribute('aria-modal') === 'true' && r.querySelectorAll('.kb-ob-wm svg circle').length === 3 })()`)) === true)
  console.log('     theme: ' + ((await q(`document.querySelector('.kb-ob').classList.contains('kb-ob-dark')`)) ? 'dark' : 'light'))
  await goEnglish()
  check('the wizard speaks English', (await h1()) === 'Welcome to Kybernos')
  await toModelStep()
  const step = await q(`(document.querySelector('.kb-ob-eyebrow') || {}).textContent`)
  check('the model step is numbered', /^Step \d of \d$/.test(String(step)), String(step))
  const rows = await q(`[...document.querySelectorAll('.kb-ob-row .kb-ob-t')].map((e) => e.textContent.trim())`)
  console.log('     options offered: ' + JSON.stringify(rows))
  check('the three ways are offered', Array.isArray(rows) && rows.length === 3, JSON.stringify(rows))
  await page.shot(join(shotDir, 'model-step.png'))

  /* ── 2. the account: the code is shown, the page is opened, a pending pairing is polled, Cancel cleans up ── */
  await press('Start right away')
  await sleep(500)
  check('the pairing code is shown to be typed on the page', (await q(`(document.querySelector('.kb-ob-code b') || {}).textContent`)) === 'KB4-7QX2')
  await sleep(2600)
  check('the pairing is polled while it is pending', fake.calls.filter((c) => c === 'cloud-poll').length >= 1, JSON.stringify(fake.calls))
  await press('Cancel')
  check('Cancel clears the pending pairing and returns to the choice', fake.calls.includes('cloud-disconnect') && (await h1()) === 'Which model do you want to work with?')

  /* ── 3. another provider: handed over to Settings, in any language ───────────────────────────────────── */
  await press('I already have an API key')
  check('the paste form is there for a known provider', (await q(`!!document.querySelector('#kb-ob-key')`)) === true)
  await press('Other provider')
  check('another provider has no paste field', (await q(`!!document.querySelector('#kb-ob-key')`)) === false)
  await press('Open Settings → Models')
  await sleep(1500)
  check('the wizard is gone', (await q(`document.querySelector('.kb-ob') === null`)) === true)
  const settingsOpen = await waitFor(page, `[...document.querySelectorAll('nav button')].some((b) => /models/i.test(b.textContent))`, 8000)
  check('the Settings dialog opened', settingsOpen !== null)
  await sleep(1200)
  const landed = await q(`(() => { const sel = document.querySelector('nav button[aria-current], nav button[aria-selected="true"], nav button[class*="active"], nav button[class*="selected"]'); return sel ? sel.textContent.trim() : null })()`)
  check('it landed on AI Provider & Models', landed === 'AI Provider & Models', JSON.stringify(landed))
  let state = null
  try { state = JSON.parse(read('kybernos/onboarding.json')) } catch (e) { state = null }
  check('the host wrote the answers and kept the version', state !== null && state.completed === true && state.version === 1 && state.model === 'key' && state.lang === 'en', JSON.stringify(state))

  /* ── 4. a key pasted: refused when invalid, saved when not ─────────────────────────────────────────── */
  const replay = async () => {
    await page.send('Page.reload', { ignoreCache: true })
    await waitFor(page, `document.body && document.body.innerText.length > 40`, 30000)
    await sleep(2500)
    await q(`window.dispatchEvent(new CustomEvent('kybernos:onboarding', { detail: { action: 'replay' } }))`)
    return (await waitFor(page, `!!document.querySelector('.kb-ob')`, 20000)) === true
  }
  check('Replay reopens the wizard', await replay())
  await goEnglish()
  await toModelStep()
  await press('I already have an API key')
  await press('OpenAI')
  fake.keyVerdict = 'invalid'
  await typeKey('sk-test-0123456789abcdefXYZ')
  const credsBefore = read('.credentials.yaml')
  const patchBefore = read('profiles/web/cordis.patch.yml')
  await press('Check and save')
  await sleep(500)
  check('an invalid key is refused, and the field keeps what was typed', (await q(`(document.querySelector('.kb-ob-state.err') || {}).textContent`)) !== undefined && (await q(`document.querySelector('#kb-ob-key').value`)) === 'sk-test-0123456789abcdefXYZ')
  check('nothing was stored for it: credentials and settings are byte for byte as they were', read('.credentials.yaml') === credsBefore && read('profiles/web/cordis.patch.yml') === patchBefore)
  fake.keyVerdict = 'ok'
  await press('Check and save')
  check('an accepted key is saved', (await seen('Key saved')) !== null)
  const creds = read('.credentials.yaml')
  const patch = read('profiles/web/cordis.patch.yml')
  check('the credential exists, by name', /OPENAI_API_KEY/.test(creds))
  check('the route names that credential and no value is in the settings', /openai/.test(patch) && /OPENAI_API_KEY/.test(patch) && !patch.includes('sk-test-0123456789abcdefXYZ'))
  check('the typed key was never written outside the credential store', !read('kybernos/onboarding.json').includes('sk-test-0123456789abcdefXYZ'))
  await page.shot(join(shotDir, 'key-saved.png'))
  await press('Continue')
  check('the recap names the provider', (await q(`document.querySelector('.kb-ob-recap').textContent`)).includes('OpenAI'))
  await press('Open Kybernos')
  await sleep(500)

  /* ── 5. a local model: installed (stand-in), connected for real ──────────────────────────────────────── */
  check('Replay reopens the wizard again', await replay())
  await goEnglish()
  await toModelStep()
  await press('A model on this computer')
  const reco = await q(`(document.querySelector('.kb-ob-recap') || {}).textContent`)
  check('the machine and the recommendation are shown', typeof reco === 'string' && /qwen3\.5:9b/.test(reco), String(reco))
  fake.installPolls = 0
  await press('Install qwen3.5:9b')
  await sleep(700)
  check('the progress screen is shown while it downloads', (await h1()) === 'Installing qwen3.5:9b' || (await seen('Model ready')) !== null)
  await page.shot(join(shotDir, 'installing.png'))
  check('when it is done the model is connected', (await seen('Model ready')) !== null)
  const patch2 = read('profiles/web/cordis.patch.yml')
  check('the local route lists the model', /ollama-local/.test(patch2) && /qwen3\.5:9b/.test(patch2))
  await press('Continue')
  check('the recap names the model', (await q(`document.querySelector('.kb-ob-recap').textContent`)).includes('qwen3.5:9b'))
  await press('Open Kybernos')

  check('no page error', page.errs.filter((e) => /kybernos|onboarding|kb-ob|is not defined|is not a function|Cannot read/i.test(e)).length === 0, JSON.stringify(page.errs.slice(0, 3)))
  console.log('     screenshots: ' + shotDir)
} catch (e) {
  fails += 1
  console.log('FAIL ' + String(e && e.message ? e.message : e))
} finally {
  await live.close()
}
console.log(fails === 0 ? '\nall checks passed' : '\n' + fails + ' check(s) FAILED')
process.exit(fails === 0 ? 0 : 1)
