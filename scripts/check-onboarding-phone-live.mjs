// The first-run wizard as the PHONE app shows it (the page carries html.kb-app, set by kybernos-mobile): it starts on the model question
// (no welcome, no field, no goals, no step number, nothing to go back to), « Skip » says what a model is for instead of letting the chat open
// empty, the key step shows a logo on each provider and « Other providers » opens the whole catalogue of the models page (search, free / popular /
// all), a key pasted for a provider of that catalogue is saved, and the first run ends on the chat: no « done » screen. Also the account path.
// SANDBOX ONLY (`source scripts/sandbox/env.sh`): a made-up key and a provider route are written for real to the sandbox's own settings, which is the
// point; the user's own `dsh web` must never be the target (exit 3). Nothing leaves the machine: the Kybernos Cloud routes are answered here.
//
// Named check-* on purpose: it needs a running sandbox and Chrome, so CI must not run it.
//   source scripts/sandbox/env.sh && node scripts/check-onboarding-phone-live.mjs     (KB_SHOT_DIR=/some/dir keeps the screenshots)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLivePage, waitFor } from './live-page.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const authority = process.env.KB_HOST || '127.0.0.1:3080'
if (authority === '127.0.0.1:3080') { console.error('refusing to run against :3080: this check writes a key and a provider to the settings. Use the sandbox (source scripts/sandbox/env.sh).'); process.exit(3) }
const dshHome = process.env.DSH_HOME
if (!dshHome) { console.error('DSH_HOME is not set: source scripts/sandbox/env.sh'); process.exit(3) }

let fails = 0
const check = (label, ok, detail) => {
  if (!ok) fails += 1
  console.log((ok ? 'ok   ' : 'FAIL ') + label + (detail !== undefined && !ok ? ' | ' + detail : ''))
}
const shotDir = process.env.KB_SHOT_DIR || join(tmpdir(), 'kb-onboarding-phone-live')
mkdirSync(shotDir, { recursive: true })
const read = (rel) => { try { return readFileSync(join(dshHome, rel), 'utf8') } catch (e) { return '' } }
const credsFile = join(dshHome, '.credentials.yaml')
const patchFile = join(dshHome, 'profiles/web/cordis.patch.yml')
const onboardingFile = join(dshHome, 'kybernos/onboarding.json')
const keep = (f) => { try { return readFileSync(f, 'utf8') } catch (e) { return null } }
const credsBackup = keep(credsFile)
let patchBackup = keep(patchFile)
// The profile this sandbox was cloned from may already work without a key (the free models are often its default): the check starts from a default model
// that has NO key, as a fresh phone has, or the wizard would say « Keep as is » and never ask.
if (patchBackup !== null) {
  const m = /(- id: agent-default-model[\s\S]*?config:\s*\n\s*provider: )([^\n]+)(\n\s*model: )([^\n]+)/.exec(patchBackup)
  if (m !== null && /^\s*(opencode-free|ollama-local|kybernos)\s*$/.test(m[2])) {
    const keyless = /\n\s{6}zai-coding-cn:\n/.test(patchBackup) ? ['zai-coding-cn', 'glm-5.3-flash'] : ['anthropic', 'claude-sonnet-4-5']
    patchBackup = patchBackup.replace(m[0], m[1] + keyless[0] + m[3] + keyless[1])
    try { writeFileSync(patchFile, patchBackup); await sleep(8000) } catch (e) { /* the sandbox is nobody's */ }
  }
}
const FINISHED_FIRST_RUN = JSON.stringify({ version: 1, completed: true, installedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:00:00.000Z', profil: 'produit', uiMode: null }) + '\n'
const onboardingBackup = (() => {
  const had = read('kybernos/onboarding.json')
  try { return JSON.parse(had).completed === true ? had : FINISHED_FIRST_RUN } catch (e) { return FINISHED_FIRST_RUN }
})()
const openFirstRun = () => writeFileSync(onboardingFile, JSON.stringify({ version: 1, completed: false, installedAt: '2026-01-01T00:00:00.000Z', completedAt: null, profil: null, uiMode: null }) + '\n')
const restoreSandbox = () => {
  try { if (credsBackup !== null) writeFileSync(credsFile, credsBackup) } catch (e) { /* the sandbox is nobody's */ }
  try { if (patchBackup !== null) writeFileSync(patchFile, patchBackup) } catch (e) { /* the sandbox is nobody's */ }
  try { writeFileSync(onboardingFile, onboardingBackup) } catch (e) { /* the sandbox is nobody's */ }
}
const verdict = () => console.log(fails === 0 ? '\nall checks passed' : '\n' + fails + ' check(s) FAILED')

mkdirSync(join(dshHome, 'kybernos'), { recursive: true })
// The engine hot-applies a rewritten profile a few seconds later: a key saved meanwhile is refused, so the check waits for the previous run's restore to settle.
await sleep(8000)
openFirstRun()
// The phone's window: 390 x 844.
const live = await openLivePage({ keepKeyDialog: true, width: 390, height: 844 })
const page = live.page
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { fails += 1; console.log('FAIL the run was interrupted (' + sig + ')'); try { await live.close() } catch (e) { /* gone */ } restoreSandbox(); verdict(); process.exit(1) })
process.on('unhandledRejection', (e) => { fails += 1; console.log('FAIL an error nobody caught: ' + String(e && e.message ? e.message : e).slice(0, 200)) })
const q = async (expr) => (await page.evalJs(expr, 8000)).val
const press = async (text) => {
  const ok = await q(`(() => { const all = [...document.querySelectorAll('.kb-ob button')].filter((b) => !b.disabled); const want = ${JSON.stringify(text)};
    const b = all.find((x) => x.textContent.trim() === want) || all.find((x) => x.textContent.trim().indexOf(want) === 0); if (!b) return false; b.click(); return true })()`)
  await sleep(350)
  return ok === true
}
const h1 = async () => q(`(document.querySelector('.kb-ob h1') || {}).textContent`)
const seen = (text, ms = 8000) => waitFor(page, `[...document.querySelectorAll('.kb-ob h1')].some((e) => e.textContent.trim() === ${JSON.stringify(text)})`, ms)
const shot = async (name) => { try { await page.shot(join(shotDir, name + '.png')) } catch (e) { /* a screenshot is a courtesy */ } }
// Does the wizard fit a phone? The page itself must not scroll sideways, and the main action must be on screen (the provider list scrolls by design, inside its own step).
const fitLog = []
const fit = async (label) => {
  const m = await q(`(() => { const r = document.querySelector('.kb-ob'); if (!r) return null; const a = document.querySelector('.kb-ob-primary'); const ar = a ? a.getBoundingClientRect() : null;
    return { sideways: document.documentElement.scrollWidth > innerWidth + 1, primaryOnScreen: ar === null ? null : ar.bottom <= innerHeight + 1 && ar.top >= 0 } })()`)
  if (m !== null && m !== undefined) fitLog.push(Object.assign({ screen: label }, m))
}
const waitClosed = (ms = 25000) => waitFor(page, `document.querySelector('.kb-ob') === null`, ms)
const onboarding = () => { try { return JSON.parse(read('kybernos/onboarding.json')) } catch (e) { return {} } }

try {
  const fake = { calls: [], accountConnected: false }
  const json = (body) => Buffer.from(JSON.stringify(body), 'utf8').toString('base64')
  const answers = (url) => {
    const path = new URL(url).pathname
    if (path === '/kybernos-cloud/start') { fake.calls.push('cloud-start'); return { ok: true, connected: false, status: 'pending', pairing: { user_code: 'KB4-7QX2', activation_url: 'https://server.example.test/cloud/cli/activate?code=KB4-7QX2' } } }
    if (path === '/kybernos-cloud/poll') {
      fake.calls.push('cloud-poll')
      if (fake.accountConnected) return { ok: true, connected: true, state: { user: { email: 'amina@example.com', plan: 'plus' } }, models: { count: 14 } }
      return { ok: true, connected: false, status: 'pending' }
    }
    if (path === '/kybernos-cloud/disconnect') { fake.calls.push('cloud-disconnect'); return { ok: true } }
    if (path === '/kybernos-cloud/status') return { ok: true, connected: false }
    return null
  }
  page.on('Fetch.requestPaused', async (p) => {
    if (p.responseStatusCode !== undefined) {
      // The wizard asks THIS machine's Ollama for its models to decide whether a model already works: the answer of the real route is kept but for that.
      try {
        const got = (await page.send('Fetch.getResponseBody', { requestId: p.requestId })).result || {}
        const raw = got.base64Encoded ? Buffer.from(got.body, 'base64').toString('utf8') : String(got.body || '')
        let j = null
        try { j = JSON.parse(raw) } catch (e) { j = null }
        if (j !== null && typeof j === 'object' && j.machine && typeof j.machine === 'object' && j.machine.ollama && typeof j.machine.ollama === 'object') j.machine.ollama.models = []
        const headers = (p.responseHeaders || []).filter((h) => !/^(content-length|content-encoding|transfer-encoding)$/i.test(h.name))
        await page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: p.responseStatusCode, responseHeaders: headers, body: Buffer.from(j === null ? raw : JSON.stringify(j), 'utf8').toString('base64') })
      } catch (e) { try { await page.send('Fetch.continueResponse', { requestId: p.requestId }) } catch (e2) { /* the page moved on */ } }
      return
    }
    let body = null
    try { body = answers(p.request.url) } catch (e) { body = null }
    try {
      if (body === null) await page.send('Fetch.continueRequest', { requestId: p.requestId })
      else await page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: json(body) })
    } catch (e) { /* the page moved on */ }
  })
  await page.send('Fetch.enable', { patterns: ['kybernos-cloud/start', 'kybernos-cloud/poll', 'kybernos-cloud/disconnect', 'kybernos-cloud/status'].map((x) => ({ urlPattern: '*/' + x + '*', requestStage: 'Request' }))
    .concat([{ urlPattern: '*/modeles-locaux/machine*', requestStage: 'Response' }]) })
  // What kybernos-mobile does in the app: mark the page. Set before the page's own scripts, and again if the document is rebuilt.
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const add = () => { if (document.documentElement) document.documentElement.classList.add('kb-app', 'kb-app-ios') }; add(); new MutationObserver(add).observe(document, { childList: true }) })()` })
  await page.send('Page.reload', { ignoreCache: true })

  /* ── 1. It starts on the model question ─────────────────────────────── */
  check('the wizard opens', (await waitFor(page, `document.querySelector('.kb-ob') !== null`, 25000)) !== null)
  await sleep(600)
  // English, so the texts below can be read: the language menu is the wizard's own.
  await q(`(() => { const b = document.querySelector('.kb-ob-lang-btn'); if (b) b.click() })()`); await sleep(150)
  await q(`(() => { const b = document.querySelector('.kb-ob-menu button[lang="en"]'); if (b) b.click() })()`); await sleep(250)
  check('the page is marked as the phone app (the check plays what the app does)', (await q(`document.documentElement.classList.contains('kb-app')`)) === true)
  check('first screen = the model question: no welcome, no field, no goals', (await h1()) === 'Which models should Kybernos use?', await h1())
  check('no step number on the phone', (await q(`document.querySelector('.kb-ob-eyebrow') === null`)) === true)
  check('nothing to go back to on the first screen', (await q(`document.querySelector('.kb-ob-back') === null`)) === true)
  check('the own-key row says the key stays on the PHONE', (await q(`document.querySelector('.kb-ob').innerText.includes('The key stays on this phone')`)) === true)
  check('the way out is « Skip », not « Decide later »', (await q(`[...document.querySelectorAll('.kb-ob .kb-ob-ghost')].map((b) => b.textContent.trim()).join('|')`)) === 'Skip', await q(`[...document.querySelectorAll('.kb-ob .kb-ob-ghost')].map((b) => b.textContent.trim()).join('|')`))
  await fit('model'); await shot('1-model')

  /* ── 2. Skip does not open an empty chat ────────────────────────────── */
  check('« Skip » is pressable', await press('Skip'))
  check('it says what a model is for', (await seen('Without a model, Kybernos cannot answer')) !== null, await h1())
  check('the wizard is still open and the first run is not recorded as done', (await q(`document.querySelector('.kb-ob') !== null`)) === true && onboarding().completed !== true)
  check('two ways out: an account, or an own key', (await q(`[...document.querySelectorAll('.kb-ob button')].map((b) => b.textContent.trim()).filter((t) => t === 'Create my account' || t === 'Use my own key').join('|')`)) === 'Create my account|Use my own key')
  await fit('nomodel'); await shot('2-nomodel')

  /* ── 3. The key step: a logo on every provider ──────────────────────── */
  check('« Use my own key »', await press('Use my own key'))
  check('the key step opens', (await seen('Your API key')) !== null, await h1())
  const chips = await q(`[...document.querySelectorAll('.kb-ob-chip')].map((c) => ({ t: c.textContent.trim(), mask: (c.querySelector('.kb-ob-lg') || {}).style ? c.querySelector('.kb-ob-lg').style.webkitMaskImage || c.querySelector('.kb-ob-lg').style.maskImage : '' }))`)
  check('the four providers and « Other providers »', JSON.stringify((chips || []).map((c) => c.t)) === JSON.stringify(['Anthropic', 'OpenAI', 'DeepSeek', 'Google Gemini', 'Other providers']), JSON.stringify(chips))
  check('each of the four has a logo from the models page', (chips || []).slice(0, 4).every((c) => /\/kybernos-models\/logo\?id=[a-z]+/.test(c.mask || '')), JSON.stringify(chips))
  const logoOk = await q(`(async () => { const out = []; for (const id of ['anthropic', 'openai', 'deepseek', 'google']) { const r = await fetch('/kybernos-models/logo?id=' + id); out.push(r.status + ':' + (r.headers.get('content-type') || '')) } return out })()`)
  check('and the host serves those logos as SVG', JSON.stringify(logoOk) === JSON.stringify(Array(4).fill('200:image/svg+xml; charset=utf-8')), JSON.stringify(logoOk))
  await fit('key'); await shot('3-key')

  /* ── 4. Other providers: the whole catalogue ────────────────────────── */
  check('« Other providers »', await press('Other providers'))
  check('the list opens', (await seen('Other providers')) !== null, await h1())
  await sleep(400)
  const secs = await q(`[...document.querySelectorAll('.kb-ob-sec')].map((h) => h.textContent.trim())`)
  check('three sections: free-quota, popular, all', Array.isArray(secs) && secs.length === 3 && secs[0] === 'Free models (quota)' && secs[1] === 'Popular' && /^All providers · \d+$/.test(secs[2]), JSON.stringify(secs))
  const rows = await q(`document.querySelectorAll('.kb-ob-prow').length`)
  check('about two hundred providers, as the models page lists them', rows >= 190 && rows <= 260, String(rows))
  check('each row has a logo or an initial', (await q(`[...document.querySelectorAll('.kb-ob-prow')].every((r) => r.querySelector('.kb-ob-lg') || r.querySelector('.kb-ob-ini'))`)) === true)
  const freeNames = await q(`(() => { const h = document.querySelector('.kb-ob-sec'); const out = []; let n = h ? h.nextElementSibling : null; while (n && !n.classList.contains('kb-ob-sec')) { if (n.classList.contains('kb-ob-prow')) out.push((n.querySelector('.kb-ob-prn') || n).textContent.trim()); n = n.nextElementSibling } return out })()`)
  check('the free-quota section lists the two providers that give free models, in the order of the models page (by name)', Array.isArray(freeNames) && freeNames.length === 2 && /nvidia/i.test(freeNames[0]) && /openrouter/i.test(freeNames[1]), JSON.stringify(freeNames))
  await fit('providers'); await shot('4-providers')
  await q(`(() => { const i = document.getElementById('kb-ob-psearch'); i.focus(); i.value = 'groq'; i.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await sleep(250)
  check('a search keeps one flat list that matches the name', JSON.stringify(await q(`[...document.querySelectorAll('.kb-ob-prow .kb-ob-prn')].map((x) => x.textContent.trim())`)) === JSON.stringify(['Groq']))
  check('the search field keeps its focus while the list changes (the phone keeps its keyboard)', (await q(`document.activeElement && document.activeElement.id`)) === 'kb-ob-psearch')
  await q(`(() => { const i = document.getElementById('kb-ob-psearch'); i.value = 'zzzzqq'; i.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await sleep(200)
  check('no match is said in words', (await q(`document.querySelector('.kb-ob').innerText.includes('No provider with this name')`)) === true)
  await q(`(() => { const i = document.getElementById('kb-ob-psearch'); i.value = 'groq'; i.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await sleep(200)

  /* ── 5. A provider of the catalogue: the key step is its own ────────── */
  check('Groq is chosen', await press('Groq'))
  check('back on the key step', (await seen('Your API key')) !== null, await h1())
  const groqChip = await q(`(() => { const c = [...document.querySelectorAll('.kb-ob-chip')].find((x) => x.textContent.trim() === 'Groq'); return c ? c.getAttribute('aria-checked') : null })()`)
  check('Groq shows as the chosen provider', groqChip === 'true', String(groqChip))
  const text = String((await q(`document.querySelector('.kb-ob').innerText`)) || '')
  check('the guide names Groq', /Open your Groq account and create an API key/.test(text), text.slice(0, 160))
  check('the note: on this phone, only sent to the provider, Kybernos never receives it', /stays on this phone and is only sent to your provider\. Kybernos never receives it/.test(text))
  check('the wizard never says the key is encrypted (DSH keeps it in a file the app alone can read)', !/encrypt/i.test(text))
  check('the save button waits for something that looks like a key', (await q(`document.querySelector('[data-kb-ob-primary]').disabled`)) === true)
  await fit('key-groq'); await shot('5-key-groq')

  /* ── 6. A key is saved and the first run ends on the chat ───────────── */
  const key = 'gsk_' + Array.from({ length: 40 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('')
  await q(`(() => { const i = document.getElementById('kb-ob-key'); i.focus(); i.value = ${JSON.stringify(key)}; i.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await sleep(200)
  check('the save button is now enabled', (await q(`document.querySelector('[data-kb-ob-primary]').disabled`)) === false)
  check('« Check and save »', await press('Check and save'))
  const closed = (await waitClosed()) !== null
  check('no « done » screen: the wizard closes by itself', closed, closed ? '' : String(await q(`(document.querySelector('.kb-ob') || {}).innerText`)).replace(/\s+/g, ' ').slice(0, 400))
  await sleep(1200)
  const done = onboarding()
  check('the first run is recorded as done, with the own key as the model', done.completed === true && done.model === 'key', JSON.stringify({ completed: done.completed, model: done.model }))
  const creds = read('.credentials.yaml')
  check('the key is stored under its reference, by name only (never printed)', /\bGROQ_API_KEY\s*:/.test(creds))
  check('and the sandbox profile now declares the Groq route', /\bgroq\b/i.test(read('profiles/web/cordis.patch.yml')))
  check('the key itself is in no other file of the profile settings', !read('profiles/web/cordis.patch.yml').includes(key))
  await shot('6-after-key')

  /* ── 7. The account path: no « connected » screen either ────────────── */
  restoreSandbox(); openFirstRun(); fake.accountConnected = false; fake.calls = []
  await sleep(8000)
  await page.send('Page.reload', { ignoreCache: true })
  check('the wizard opens again on the model question', (await waitFor(page, `[...document.querySelectorAll('.kb-ob h1')].some((e) => e.textContent.trim() === 'Quels modèles Kybernos doit-il utiliser ?' || e.textContent.trim() === 'Which models should Kybernos use?')`, 25000)) !== null)
  await q(`(() => { const b = document.querySelector('.kb-ob-lang-btn'); if (b) b.click() })()`); await sleep(150)
  await q(`(() => { const b = document.querySelector('.kb-ob-menu button[lang="en"]'); if (b) b.click() })()`); await sleep(250)
  check('« Skip » then « Create my account »', (await press('Skip')) && (await seen('Without a model, Kybernos cannot answer')) !== null && (await press('Create my account')))
  check('the pairing page is opened in the system browser and the code is shown', (await waitFor(page, `document.querySelector('.kb-ob').innerText.includes('KB4-7QX2')`, 10000)) !== null)
  await fit('cloud-wait'); await shot('7-cloud-wait')
  fake.accountConnected = true
  check('once the account is connected the wizard closes (no « connected » screen)', (await waitClosed(30000)) !== null, await h1())
  await sleep(1500)
  check('the first run is recorded as done, with the account as the model', onboarding().completed === true && onboarding().model === 'cloud', JSON.stringify({ completed: onboarding().completed, model: onboarding().model }))

  /* ── 8. Does it fit a phone? ────────────────────────────────────────── */
  const bad = fitLog.filter((m) => m.sideways === true || m.primaryOnScreen === false)
  check('every screen the check reached fits 390 x 844: no sideways scroll, the main action on screen (' + fitLog.length + ' screens)', bad.length === 0, JSON.stringify(bad))
} finally {
  try { await live.close() } catch (e) { /* gone */ }
  restoreSandbox()
}
verdict()
console.log('screenshots: ' + shotDir)
process.exit(fails === 0 ? 0 : 1)
