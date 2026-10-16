// The first-run wizard on a real GUI: the screens, the model question (a Kybernos account or an own key), the account
// path's pairing, a key pasted and saved, a model installed and connected, the starter kit (skills and agent teams of
// the profession) and the profession written to memory, a replay that never skips the model step, and the hand-over
// to Settings. SANDBOX ONLY (`source scripts/sandbox/env.sh`): the key
// and the model are written for real to the settings of the instance, which is the point; the user's own
// `dsh web` must never be the target (exit 3).
//
// What the check answers itself over CDP, so that nothing leaves the machine and nothing heavy runs:
//   - the Kybernos Cloud pairing routes (a real pairing would start a request on a real server),
//   - the cloud memory write and the skills install (a download from GitHub); the team install is the REAL route,
//   - the key check (a provider's own API would be asked about a made-up key),
//   - the installer and its progress (a real one runs `brew install ollama` and `ollama pull`).
// What it reads for real: the onboarding state (the sandbox's own file), the cloud status, the machine probe.
// What it verifies on disk, by name only and never printing a value: the credential and the provider routes
// the seams wrote.
//
// Named check-* on purpose: it needs a running sandbox and Chrome, so CI must not run it.
//   source scripts/sandbox/env.sh && node scripts/check-onboarding-live.mjs     (KB_SHOT_DIR=/some/dir keeps screenshots)
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
// The card test stores a made-up credential for the chat's own model: put the file back as it was, so that the next
// run starts from a model that still has no key (and a message sent then fails locally, never reaching a provider).
const credsFile = join(dshHome, '.credentials.yaml')
let credsBackup = null
try { credsBackup = readFileSync(credsFile, 'utf8') } catch (e) { credsBackup = null }
// The profile's settings, for the same reason: choosing the model after a connection rewrites the default model.
const patchFile = join(dshHome, 'profiles/web/cordis.patch.yml')
let patchBackup = null
try { patchBackup = readFileSync(patchFile, 'utf8') } catch (e) { patchBackup = null }
// The profile this sandbox was cloned from may already work without a key (the free models are often its default): every
// section below starts from a model that has NO key, so such a default is replaced by one that does not work.
if (patchBackup !== null) {
  const m = /(- id: agent-default-model[\s\S]*?config:\s*\n\s*provider: )([^\n]+)(\n\s*model: )([^\n]+)/.exec(patchBackup)
  if (m !== null && /^\s*(opencode-free|ollama-local|kybernos)\s*$/.test(m[2])) {
    // a route the profile really has, whose key the sandbox lacks: the engine then answers MISSING_CREDENTIAL, as the card expects
    const keyless = /\n\s{6}zai-coding-cn:\n/.test(patchBackup) ? ['zai-coding-cn', 'glm-5.3-flash'] : ['anthropic', 'claude-sonnet-4-5']
    patchBackup = patchBackup.replace(m[0], m[1] + keyless[0] + m[3] + keyless[1])
    try { writeFileSync(patchFile, patchBackup); await new Promise((resolve) => setTimeout(resolve, 8000)) } catch (e) { /* the sandbox is nobody's */ }
  }
}
const defaultModelOf = () => {
  const m = /- id: agent-default-model[\s\S]*?config:\s*\n\s*provider: ([^\n]+)\n\s*model: ([^\n]+)/.exec(read('profiles/web/cordis.patch.yml'))
  return m === null ? null : m[1].trim() + '/' + m[2].trim()
}
const backToTheStartingPoint = async () => {
  // The next section starts from a default model that has no key, as the profile had.
  try { if (credsBackup !== null) writeFileSync(credsFile, credsBackup) } catch (e) { /* the sandbox is nobody's */ }
  try { if (patchBackup !== null) writeFileSync(patchFile, patchBackup) } catch (e) { /* the sandbox is nobody's */ }
  await sleep(7000)
}

// The starter kit installs its two teams into DSH's own home (A6-24), where they stay: a second run would find them installed and tick nothing.
// The sandbox is this check's own, so they are removed before the run and after it.
const forgetKitTeams = () => { for (const id of ['studencik', 'research-desk']) { try { rmSync(join(dshHome, 'kybers', id), { recursive: true, force: true }) } catch (e) { /* none */ } } try { rmSync(join(dshHome, 'kybers', '.kyber-ui.json'), { force: true }) } catch (e) { /* none */ } }
forgetKitTeams()

// A fresh install: the sandbox's setup writes the file as done; the wizard opens only when it says otherwise.
mkdirSync(join(dshHome, 'kybernos'), { recursive: true })
writeFileSync(join(dshHome, 'kybernos/onboarding.json'), JSON.stringify({ version: 1, completed: false, installedAt: '2026-01-01T00:00:00.000Z', completedAt: null, profil: null, uiMode: null }) + '\n')

// keepKeyDialog: this check must SEE DSH's own « Get started » dialog if it ever comes back over the wizard (A5-34, A6-01); the helper would press it away.
const live = await openLivePage({ keepKeyDialog: true })
const page = live.page
try {
  const fake = { keyVerdict: 'ok', installPolls: 0, calls: [], accountConnected: false, freeBody: null, statusConnected: false, skillsInstalled: [], skillInstalls: [], memoryBodies: [] }
  const json = (body) => Buffer.from(JSON.stringify(body), 'utf8').toString('base64')
  const answers = (url, method, postData) => {
    const path = new URL(url).pathname
    if (path === '/kybernos-cloud/start') { fake.calls.push('cloud-start'); return { ok: true, connected: false, status: 'pending', pairing: { user_code: 'KB4-7QX2', activation_url: 'https://server.example.test/cloud/cli/activate?deviceId=d1', expires_at: '2099-01-01T00:00:00Z' } } }
    if (path === '/kybernos-cloud/poll') {
      fake.calls.push('cloud-poll')
      // an account of the Free plan: connected, and the plan brings no model
      if (fake.accountConnected) return { ok: true, connected: true, state: { user: { email: 'amina@example.com', plan: 'free' } }, models: { count: 0 } }
      return { ok: true, connected: false, status: 'pending' }
    }
    // The free models are fetched from a third party by the real route: answered here, nothing leaves the machine.
    if (path === '/free-llms/auto-enable') {
      fake.calls.push('free-enable')
      try { fake.freeBody = JSON.parse(postData || '{}') } catch (e) { fake.freeBody = null }
      return { ok: true, models: ['mimo-v2.6-flash-free'] }
    }
    // Only the free provider is answered here: the other ways read the REAL route (the default model is checked on disk).
    if (path === '/kybernos/model/auto') {
      let body = {}
      try { body = JSON.parse(postData || '{}') } catch (e) { body = {} }
      if (body.provider !== 'opencode-free') return null
      fake.calls.push('model-auto')
      return { ok: true, switched: true, provider: 'opencode-free', model: 'mimo-v2.6-flash-free', scope: 'default' }
    }
    // A connected account, as the status route would say it (the model step shows who is connected and how many models).
    if (path === '/kybernos-cloud/status' && fake.statusConnected) return { ok: true, connected: true, state: { connected: true, user: { email: 'amina@example.com', plan: 'plus' }, models: { count: 14 } } }
    if (path === '/kybernos-skills/skills' && method === 'GET') return { ok: true, skills: fake.skillsInstalled.map((name) => ({ name })) }
    if (path === '/kybernos-skills/install') {
      let body = {}
      try { body = JSON.parse(postData || '{}') } catch (e) { body = {} }
      fake.skillInstalls.push(body.source + ':' + body.name)
      fake.skillsInstalled.push(body.name)
      return { ok: true, files: 3 }
    }
    if (path === '/kybernos-cloud/memory/add' || path === '/kybernos-cloud/memory/update') {
      let body = {}
      try { body = JSON.parse(postData || '{}') } catch (e) { body = {} }
      fake.memoryBodies.push({ path, body })
      return { ok: true, memory: { id: 'mem_test_1', content: body.content } }
    }
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
    try { body = answers(p.request.url, p.request.method, p.request.postData) } catch (e) { body = null }
    try {
      if (body === null) await page.send('Fetch.continueRequest', { requestId: p.requestId })
      else await page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: json(body) })
    } catch (e) { /* the page moved on */ }
  })
  await page.send('Fetch.enable', { patterns: ['kybernos-cloud/start', 'kybernos-cloud/poll', 'kybernos-cloud/disconnect', 'kybernos-cloud/status', 'kybernos-cloud/memory/', 'kybernos-models/key/check',
    'kybernos-skills/skills', 'kybernos-skills/install',
    'modeles-locaux/installer', 'modeles-locaux/installation', 'free-llms/auto-enable', 'kybernos/model/auto'].map((x) => ({ urlPattern: '*/' + x + '*', requestStage: 'Request' })) })
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
  const seen = (text, ms = 8000) => waitFor(page, `[...document.querySelectorAll('.kb-ob h1')].some((e) => e.textContent.trim() === ${JSON.stringify(text)})`, ms)
  // A connected model becomes the default a few seconds later: the route is hot-applied, the wizard asks again meanwhile.
  const nowTheModel = (id) => waitFor(page, `((document.querySelector('.kb-ob') || {}).innerText || '').includes(${JSON.stringify(id + ' is now the model of your chats')})`, 20000)
  const goEnglish = async () => {
    await q(`document.querySelector('.kb-ob-lang-btn').click()`); await sleep(150)
    await q(`document.querySelector('.kb-ob-menu button[lang="en"]').click()`); await sleep(150)
  }
  // welcome → profession → display mode → the model question
  const toModelStep = async () => { await press('Get started'); await press('Continue'); await press('Continue') }
  // The kit is left without installing anything: the recap follows.
  const skipKit = async () => { await seen('Start with these', 8000); await press('Not now') }
  const typeKey = async (value) => q(`(() => { const i = document.querySelector('#kb-ob-key'); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)

  /* ── 1. the first run, through the sandbox's own host route ─────────────────────────────────────────────── */
  check('the wizard opens on a fresh install', (await waitFor(page, `!!document.querySelector('.kb-ob')`, 40000)) === true)
  check('it is a modal dialog with the Kybernos mark', (await q(`(() => { const r = document.querySelector('.kb-ob'); return r.getAttribute('role') === 'dialog' && r.getAttribute('aria-modal') === 'true' && r.querySelectorAll('.kb-ob-wm svg circle').length === 3 })()`)) === true)
  console.log('     theme: ' + ((await q(`document.querySelector('.kb-ob').classList.contains('kb-ob-dark')`)) ? 'dark' : 'light'))
  // A5-34 / A6-01: the engine's own step ('Sign in to your DeepSeek account or add an API Key') is replaced by the core; it is not over the wizard
  check('DSH\'s own « Sign in to your DeepSeek account » dialog is not over the wizard', (await q(`[...document.querySelectorAll('[role="dialog"]')].every((d) => !/DeepSeek account|Add API Key/.test(d.innerText || ''))`)) === true)
  await goEnglish()
  check('the wizard speaks English', (await h1()) === 'Welcome to Kybernos')
  // Escape (A6-03): a stray key never ends the first run (it used to record « later » and a lost profession for good).
  const escape = async () => { for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(400) }
  const onboardingDone = () => { try { return JSON.parse(read('kybernos/onboarding.json') || '{}').completed === true } catch (e) { return null } }
  await escape()
  check('Escape on the welcome screen leaves the wizard open and the first run undone', (await q(`!!document.querySelector('.kb-ob')`)) === true && (await h1()) === 'Welcome to Kybernos' && onboardingDone() === false)
  // The language menu: each language changes the texts, Arabic also flips the layout and keeps the logo left-to-right.
  const pickLanguage = async (id) => {
    await q(`document.querySelector('.kb-ob-lang-btn').click()`); await sleep(150)
    await q(`document.querySelector('.kb-ob-menu button[lang="${id}"]').click()`); await sleep(200)
  }
  await pickLanguage('fr')
  check('French', (await h1()) === 'Bienvenue dans Kybernos' && (await q(`document.querySelector('.kb-ob').getAttribute('lang')`)) === 'fr')
  await pickLanguage('es')
  check('Spanish', (await h1()) === 'Te damos la bienvenida a Kybernos')
  await pickLanguage('ar')
  check('Arabic reads right-to-left', (await q(`document.querySelector('.kb-ob').getAttribute('dir')`)) === 'rtl' && (await h1()) === 'مرحبًا بك في Kybernos')
  check('the logo stays left-to-right in Arabic', (await q(`getComputedStyle(document.querySelector('.kb-ob-wm')).direction`)) === 'ltr')
  check('nothing runs off the page in Arabic', (await q(`document.querySelector('.kb-ob').scrollWidth <= document.querySelector('.kb-ob').clientWidth`)) === true)
  await page.shot(join(shotDir, 'arabic.png'))
  await goEnglish()
  check('and back to English', (await h1()) === 'Welcome to Kybernos' && (await q(`document.querySelector('.kb-ob').getAttribute('dir')`)) === 'ltr')
  // the model question comes right after the display mode, with two answers
  await toModelStep()
  check('after the display mode, the model question is asked', (await h1()) === 'Which models should Kybernos use?', String(await h1()))
  check('it is the third of four numbered steps', /^Step 3 of 4$/.test(String(await q(`(document.querySelector('.kb-ob-eyebrow') || {}).textContent`))))
  const answersShown = await q(`[...document.querySelectorAll('.kb-ob-row .kb-ob-t')].map((e) => e.textContent.trim())`)
  check('two answers, the Kybernos account recommended', Array.isArray(answersShown) && answersShown.length === 2 && /^Kybernos models/.test(answersShown[0]) && /Recommended/.test(answersShown[0]) && /^My own API key/.test(answersShown[1]), JSON.stringify(answersShown))
  check('the Kybernos account is ticked by default', (await q(`document.querySelector('.kb-ob-row.on .kb-ob-t').textContent`)).startsWith('Kybernos models'))
  check('the other ways stay one line below', /a model on this computer/.test(String(await q(`(document.querySelector('.kb-ob-others') || {}).textContent`))) && /free community models/.test(String(await q(`(document.querySelector('.kb-ob-others') || {}).textContent`))))
  await escape()
  check('Escape on the model question steps back to the display mode, not out of the wizard', (await q(`!!document.querySelector('.kb-ob')`)) === true && (await h1()) === 'Choose your UI mode' && onboardingDone() === false, String(await h1()))
  await press('Continue')
  check('Continue brings the model question back', (await h1()) === 'Which models should Kybernos use?', String(await h1()))
  check('the question can be left for later', (await q(`[...document.querySelectorAll('.kb-ob button')].some((b) => b.textContent.trim() === 'Decide later')`)) === true)
  await page.shot(join(shotDir, 'model-question.png'))

  /* ── 2. the account: the code is shown, the page is opened, a pending pairing is polled, Cancel cleans up ── */
  await press('Continue')
  await sleep(500)
  check('the pairing code is shown to be typed on the page', (await q(`(document.querySelector('.kb-ob-code b') || {}).textContent`)) === 'KB4-7QX2')
  await sleep(2600)
  check('the pairing is polled while it is pending', fake.calls.filter((c) => c === 'cloud-poll').length >= 1, JSON.stringify(fake.calls))
  await press('Cancel')
  check('Cancel clears the pending pairing and returns to the question', fake.calls.includes('cloud-disconnect') && (await h1()) === 'Which models should Kybernos use?', String(await h1()))

  /* ── 3. another provider: handed over to Settings, in any language ───────────────────────────────────── */
  await press('My own API key')
  await press('Continue')
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
  await press('My own API key')
  await press('Continue')
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
  check('an accepted key is saved', (await seen('Key saved')) !== null, JSON.stringify([await h1(), await q(`(document.querySelector('.kb-ob-state') || {}).textContent`), fake.calls]))
  const creds = read('.credentials.yaml')
  const patch = read('profiles/web/cordis.patch.yml')
  check('the credential exists, by name', /OPENAI_API_KEY/.test(creds))
  check('the route names that credential and no value is in the settings', /openai/.test(patch) && /OPENAI_API_KEY/.test(patch) && !patch.includes('sk-test-0123456789abcdefXYZ'))
  check('the typed key was never written outside the credential store', !read('kybernos/onboarding.json').includes('sk-test-0123456789abcdefXYZ'))
  await page.shot(join(shotDir, 'key-saved.png'))
  await press('Continue')
  await skipKit()
  check('the recap names the provider', (await q(`document.querySelector('.kb-ob-recap').textContent`)).includes('OpenAI'))
  const defaultAfterKey = defaultModelOf()
  check('the key\'s provider became the default model (the first message needs no selector)', typeof defaultAfterKey === 'string' && defaultAfterKey.startsWith('openai/'), String(defaultAfterKey))
  await press('Open Kybernos')
  await sleep(500)
  await backToTheStartingPoint()

  /* ── 5. a local model: installed (stand-in), connected for real ──────────────────────────────────────── */
  check('Replay reopens the wizard again', await replay())
  await goEnglish()
  await toModelStep()
  await press('a model on this computer')
  const reco = await q(`(document.querySelector('.kb-ob-recap') || {}).textContent`)
  check('the machine and the recommendation are shown', typeof reco === 'string' && /qwen3\.5:9b/.test(reco), String(reco))
  fake.installPolls = 0
  // what the connection answered, for the failure detail below
  await q(`(() => { const seam = window.__KB_LOCAL__; if (!seam || seam.__spied) return false; const c = seam.connect; seam.connect = async (id) => { const r = await c(id); window.__kbLastConnect = r; return r }; seam.__spied = true; return true })()`)
  await press('Install qwen3.5:9b')
  await sleep(700)
  check('the progress screen is shown while it downloads', (await h1()) === 'Installing qwen3.5:9b' || (await seen('Model ready', 30000)) !== null)
  await page.shot(join(shotDir, 'installing.png'))
  const ready5 = await seen('Model ready', 30000)
  check('when it is done the model is connected', ready5 !== null, JSON.stringify({ connect: await q(`window.__kbLastConnect || null`), h1: await h1(), calls: fake.calls, polls: fake.installPolls, text: String(await q(`(document.querySelector('.kb-ob') || {}).innerText`)).slice(0, 300) }))
  await nowTheModel('qwen3.5:9b')
  const patch2 = read('profiles/web/cordis.patch.yml')
  check('the local route lists the model', /ollama-local/.test(patch2) && /qwen3\.5:9b/.test(patch2))
  check('and it became the default model', defaultModelOf() === 'ollama-local/qwen3.5:9b', String(defaultModelOf()))
  check('the screen says so', String(await q(`(document.querySelector('.kb-ob') || {}).innerText`)).includes('qwen3.5:9b is now the model of your chats'))
  await press('Continue')
  await skipKit()
  check('the recap names the model', (await q(`document.querySelector('.kb-ob-recap').textContent`)).includes('qwen3.5:9b'))
  await press('Open Kybernos')
  await backToTheStartingPoint()

  /* ── 5b. the account, accepted: a plan with no model gets the free community models, with their notice ── */
  fake.accountConnected = true
  fake.calls.length = 0
  fake.freeBody = null
  check('Replay reopens the wizard for the account', await replay())
  await goEnglish()
  await toModelStep()
  await press('Continue')
  check('the account is made without leaving the wizard', (await seen('You’re connected')) !== null)
  const okLine = String(await q(`(document.querySelector('.kb-ob-state.ok') || {}).innerText`))
  check('it names the Free plan and does not claim models it does not have', /Free/.test(okLine) && !/models ready/.test(okLine), JSON.stringify(okLine))
  await press('Continue')
  check('with no model in the plan, the free models are offered with their notice', (await seen('Free models, ready to use')) !== null)
  check('there is no way back to the account that was just made', (await q(`!document.querySelector('.kb-ob-back')`)) === true)
  check('nothing is wired before the acknowledgement', !fake.calls.includes('free-enable') && (await q(`document.querySelector('.kb-ob-primary').disabled`)) === true)
  await q(`document.querySelector('.kb-ob-freeack input').click()`)
  await sleep(200)
  await press('Use free models')
  await skipKit()
  await press('Open Kybernos')
  check('the wizard closes', (await waitFor(page, `document.querySelector('.kb-ob') === null`, 8000)) === true)
  await sleep(2400)
  check('the host was asked to wire them, with the acknowledgement and no model of the person\'s own', fake.calls.includes('free-enable') && fake.freeBody !== null && fake.freeBody.acknowledged === true && fake.freeBody.hasOwnModel === false, JSON.stringify([fake.calls, fake.freeBody]))
  check('and to make a free model the default', fake.calls.includes('model-auto'), JSON.stringify(fake.calls))
  let st5 = null
  try { st5 = JSON.parse(read('kybernos/onboarding.json')) } catch (e) { st5 = null }
  check('the onboarding file records the account as the way', st5 !== null && st5.completed === true && st5.model === 'cloud', JSON.stringify(st5))
  fake.accountConnected = false
  await backToTheStartingPoint()

  /* ── 5c. a replay on a machine that already works: the model step is still there, and so is the starter kit ── */
  fake.statusConnected = true
  fake.skillsInstalled = ['pdf']
  fake.skillInstalls.length = 0
  fake.memoryBodies.length = 0
  check('Replay reopens the wizard on a connected machine', await replay())
  await goEnglish()
  await press('Get started')
  await press('Students / Teaching / Research')
  check('the profession can be changed in a replay', (await q(`document.querySelector('.kb-ob-chip.on').textContent`)) === 'Students / Teaching / Research')
  await press('Continue')
  await press('Continue')
  check('the model step is NOT skipped although an account is connected', (await h1()) === 'Which models should Kybernos use?', String(await h1()))
  const line = String(await q(`(document.querySelector('.kb-ob-row.on .kb-ob-st') || {}).textContent`))
  check('it says who is connected and how many models', /Connected · amina@example\.com · 14 models ready/.test(line), JSON.stringify(line))
  check('the other answer (an own key) is still there to add', (await q(`[...document.querySelectorAll('.kb-ob-row .kb-ob-t')].some((e) => /^My own API key/.test(e.textContent.trim()))`)) === true)
  await page.shot(join(shotDir, 'replay-model-question.png'))
  await press('Keep as is')
  check('the starter kit follows, named after the profession', (await seen('A starter kit for Students / Teaching / Research')) !== null, String(await h1()))
  const kitRows = await q(`[...document.querySelectorAll('.kb-ob-kit')].map((r) => r.querySelector('b').textContent + (r.classList.contains('done') ? ':done' : r.classList.contains('on') ? ':on' : r.classList.contains('soon') ? ':soon' : ':off'))`)
  console.log('     kit rows: ' + JSON.stringify(kitRows))
  check('what is installed is marked and not ticked again', Array.isArray(kitRows) && kitRows.includes('pdf:done') && kitRows.includes('study-plan:on') && kitRows.includes('flashcards:on') && kitRows.includes('docx:on'), JSON.stringify(kitRows))
  check('the teams of the marketplace are offered and ticked', Array.isArray(kitRows) && kitRows.includes('Studencik:on') && kitRows.includes('Research Desk:on'), JSON.stringify(kitRows))
  check('the primary button counts what is ticked', /^Add 5 selected$/.test(String(await q(`document.querySelector('.kb-ob-primary').textContent`))), String(await q(`document.querySelector('.kb-ob-primary').textContent`)))
  await page.shot(join(shotDir, 'starter-kit.png'))
  // untick one, then add: only what is ticked is installed
  await q(`[...document.querySelectorAll('.kb-ob-kit')].find((r) => r.querySelector('b').textContent === 'docx').click()`)
  await sleep(150)
  check('a skill can be unticked', /^Add 4 selected$/.test(String(await q(`document.querySelector('.kb-ob-primary').textContent`))))
  await press('Add 4 selected')
  check('the recap follows the installation', (await seen('You’re all set', 40000)) !== null, String(await h1()))
  check('the skills went through the Skills page route, with their GitHub source', JSON.stringify(fake.skillInstalls.sort()) === JSON.stringify(['anthropics/claude-for-legal:flashcards', 'anthropics/claude-for-legal:study-plan']), JSON.stringify(fake.skillInstalls))
  const recapText = String(await q(`document.querySelector('.kb-ob-recap').textContent`))
  check('the recap says what was added, without an error', /Starter kit/.test(recapText) && /4 added/.test(recapText) && (await q(`!document.querySelector('.kb-ob-state.err')`)) === true, recapText)
  // A6-24: the kit's teams go to DSH's own home; a welcome screen must not add a `kybers/` folder to the project DSH was started in.
  check('the teams of the kit are in DSH\'s own home (~/.dsh/kybers)', read('kybers/studencik/kyber.yml') !== '' && read('kybers/research-desk/kyber.yml') !== '')
  check('and none was written into the project the instance was started in', process.env.KB_WORKTREE === undefined || (!existsSync(join(process.env.KB_WORKTREE, 'kybers/studencik')) && !existsSync(join(process.env.KB_WORKTREE, 'kybers/research-desk'))))
  check('the profession and display mode were written to memory, once, pinned', fake.memoryBodies.length === 1 && fake.memoryBodies[0].path === '/kybernos-cloud/memory/add' && fake.memoryBodies[0].body.pinned === true && fake.memoryBodies[0].body.kind === 'fact' && /^Works as: Students \/ Teaching \/ Research\./.test(fake.memoryBodies[0].body.content), JSON.stringify(fake.memoryBodies))
  check('and the recap says so', (await waitFor(page, `document.querySelector('.kb-ob-mem') !== null`, 4000)) === true)
  // N-09: the end screen lists what is set up, read from the host's own routes, one row per area, each with a Change link
  check('the end screen lists what we set up: five areas', (await waitFor(page, `document.querySelectorAll('.kb-ob-setup .kb-ob-srow').length === 5`, 8000)) === true, String(await q(`document.querySelectorAll('.kb-ob-setup .kb-ob-srow').length`)))
  const setupRows = (await q(`[...document.querySelectorAll('.kb-ob-setup .kb-ob-srow')].map((r) => ({ id: r.getAttribute('data-kb-ob-row'), label: r.querySelector('b').textContent, text: r.querySelector('span').textContent, change: (r.querySelector('button') || {}).textContent }))`)) || []
  const rowText = (id) => (setupRows.find((r) => r.id === id) || {}).text || ''
  check('memory, auto routing, connectors, web search and study model, in that order', JSON.stringify(setupRows.map((r) => r.id)) === JSON.stringify(['mem', 'auto', 'conn', 'ws', 'study']), JSON.stringify(setupRows))
  check('under the title « What we set up for you »', /What we set up for you/i.test(String(await q(`(document.querySelector('.kb-ob-setup h2') || {}).textContent`))))
  check('every row says something and offers Change', setupRows.every((r) => r.text.trim().length > 8 && r.change === 'Change'), JSON.stringify(setupRows))
  check('with an account the memory line says memories and lessons are on (it is what the host says)', /Memories and lessons are on/.test(rowText('mem')), rowText('mem'))
  check('Auto routing says what is so on this install, not a promise', /^(Off|On)/.test(rowText('auto')), rowText('auto'))
  check('no sideways scroll, and the main button is still there', (await q(`document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 && !!document.querySelector('[data-kb-ob-primary]')`)) === true)
  await sleep(700)
  check('the way out (Open Kybernos) stays in view at the foot of the window', (await q(`(() => { const b = document.querySelector('[data-kb-ob-primary]'); if (!b) return false; const r = b.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 1 })()`)) === true)
  await page.shot(join(shotDir, 'end-what-we-set-up.png'))
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false })
  await sleep(600)
  check('at 390 px nothing scrolls sideways and the way out is still in view', (await q(`(() => { const b = document.querySelector('[data-kb-ob-primary]'); if (!b) return false; const r = b.getBoundingClientRect(); return document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1 })()`)) === true)
  await page.shot(join(shotDir, 'end-what-we-set-up-390.png'))
  await page.send('Emulation.clearDeviceMetricsOverride', {})
  await sleep(300)
  await press('Open Kybernos')
  let st6 = null
  try { st6 = JSON.parse(read('kybernos/onboarding.json')) } catch (e) { st6 = null }
  check('the memory id is kept in the onboarding file, so the next replay updates it', st6 !== null && st6.memoryId === 'mem_test_1' && st6.profil === 'etudes', JSON.stringify(st6))
  // the second replay updates the same memory instead of adding another
  fake.memoryBodies.length = 0
  check('a second replay opens', await replay())
  await goEnglish()
  await press('Get started'); await press('Continue'); await press('Continue'); await press('Keep as is')
  await seen('A starter kit for Students / Teaching / Research', 8000)
  await press('Not now')
  await waitFor(page, `!!document.querySelector('.kb-ob-recap')`, 8000)
  await sleep(600)
  check('and updates that memory', fake.memoryBodies.length === 1 && fake.memoryBodies[0].path === '/kybernos-cloud/memory/update' && fake.memoryBodies[0].body.id === 'mem_test_1', JSON.stringify(fake.memoryBodies))
  // A Change link ends the wizard and opens that area's page of Settings (here Web Search), whatever the language.
  await waitFor(page, `document.querySelectorAll('.kb-ob-setup .kb-ob-srow').length === 5`, 8000)
  const changed = await q(`(() => { const b = document.querySelector('.kb-ob-srow[data-kb-ob-row="ws"] button'); if (!b) return false; b.click(); return true })()`)
  check('Change on the web search row is pressed', changed === true)
  await sleep(1500)
  check('the wizard is gone', (await q(`document.querySelector('.kb-ob') === null`)) === true)
  await waitFor(page, `[...document.querySelectorAll('nav button')].some((b) => /web search/i.test(b.textContent))`, 8000)
  await sleep(1200)
  const landedWs = await q(`(() => { const sel = document.querySelector('nav button[aria-current], nav button[aria-selected="true"], nav button[class*="active"], nav button[class*="selected"]'); return sel ? sel.textContent.trim() : null })()`)
  check('it landed on Web Search', landedWs === 'Web Search', JSON.stringify(landedWs))
  fake.statusConnected = false
  await backToTheStartingPoint()

  /* ── 5d. the kit on its own, later, from Settings ── */
  fake.skillsInstalled = []
  fake.skillInstalls.length = 0
  await page.send('Page.reload', { ignoreCache: true })
  await waitFor(page, `document.body && document.body.innerText.length > 40`, 30000)
  await sleep(2500)
  await q(`window.dispatchEvent(new CustomEvent('kybernos:onboarding', { detail: { action: 'kit' } }))`)
  check('the starter kit opens on its own', (await waitFor(page, `!!document.querySelector('.kb-ob')`, 20000)) === true)
  check('with no numbered step and no way back', (await q(`!document.querySelector('.kb-ob-eyebrow') && !document.querySelector('.kb-ob-back')`)) === true)
  check('it can look at another profession', (await press('Finance / Accounting / Consulting')) === true && (await seen('A starter kit for Finance / Accounting / Consulting')) !== null)
  check('the teams to come are listed, greyed', (await q(`[...document.querySelectorAll('.kb-ob-kit.soon b')].map((b) => b.textContent).join()`)) === 'Back-office Finance')
  check('and it closes without touching the onboarding file', (await press('Close')) === true && (await q(`document.querySelector('.kb-ob') === null`)) === true)
  await backToTheStartingPoint()

  /* ── 6. the moment of need: a chat whose model has no key ──────────────────────────────────────────── */
  // A real message, in the sandbox's chat: the engine refuses it locally (no credential), nothing leaves the machine.
  const stateBefore = read('kybernos/onboarding.json')
  const typeInComposer = async (text) => {
    const box = await q(`(() => { const e = document.querySelector('[contenteditable="true"], textarea'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + 40, y: r.top + r.height / 2 } })()`)
    if (!box) return false
    for (const t of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type: t, x: box.x, y: box.y, button: 'left', clickCount: 1 })
    await page.send('Input.insertText', { text })
    await sleep(300)
    for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    return true
  }
  const freshChat = async () => {
    await page.send('Page.reload', { ignoreCache: true })
    await waitFor(page, `document.body && document.body.innerText.length > 40`, 30000)
    await sleep(2500)
  }
  const cardSel = '[data-kb="need-model"]'
  const cardButton = (label) => q(`(() => { const b = [...document.querySelectorAll('${cardSel} button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true })()`)

  // A. the card says it, and the other ways connect a model that the chat itself takes
  await freshChat()
  check('a message is sent from the home box', await typeInComposer('Hello, are you there?'))
  const card = await waitFor(page, `!!document.querySelector('${cardSel}')`, 25000)
  check('the card appears above the box when the model has no key', card === true)
  let route = null
  if (card === true) {
    const cardText = await q(`document.querySelector('${cardSel}').innerText`)
    check('it says it in a person\'s words, with the route', /can.t answer yet/.test(cardText) && /has no API key/.test(cardText), JSON.stringify(cardText))
    route = (/The model it uses, ([^,]+), has no API key/.exec(cardText) || [])[1]
    check('the route is read from the engine\'s sentence', typeof route === 'string' && route.length > 0, JSON.stringify(cardText))
    check('the field names that route', (await q(`document.querySelector('.kbnm-lbl').textContent`)) === 'API key for ' + route)
    check('the engine\'s own sentence is still there (the card does not replace it)', (await q(`document.body.innerText.includes('MISSING_CREDENTIAL')`)) === true)
    await page.shot(join(shotDir, 'need-model-card.png'))

    check('the card opens the wizard', (await cardButton('Sign in with Kybernos')) === true && (await waitFor(page, `!!document.querySelector('.kb-ob')`, 8000)) === true)
    check('it opens on the model question, with no numbered steps', (await h1()) === 'Which models should Kybernos use?' && (await q(`!document.querySelector('.kb-ob-eyebrow')`)) === true)
    check('it can be closed', (await press('Close')) === true && (await q(`document.querySelector('.kb-ob') === null`)) === true)
    check('it left the onboarding file as it was', read('kybernos/onboarding.json') === stateBefore)

    // a model on this computer, from the card: the stand-in installer, then the chat itself takes it
    fake.installPolls = 0
    check('the card opens the wizard again, for a model on this computer', (await cardButton('A model on this computer')) === true && (await waitFor(page, `!!document.querySelector('.kb-ob')`, 8000)) === true)
    check('the local way is offered', await press('a model on this computer'))
    check('and installed', await press('Install qwen3.5:9b'))
    check('the model is connected', (await seen('Model ready', 30000)) !== null)
    await nowTheModel('qwen3.5:9b')
    check('and the screen says it is now the model', String(await q(`(document.querySelector('.kb-ob') || {}).innerText`)).includes('qwen3.5:9b is now the model of your chats'))
    await press('Continue')
    check('the card says this chat has the model now', (await waitFor(page, `document.querySelector('${cardSel}') && document.querySelector('${cardSel}').innerText.includes('is now this chat')`, 8000)) !== null)
    check('the default model is the connected one', defaultModelOf() === 'ollama-local/qwen3.5:9b', String(defaultModelOf()))
    await q(`document.querySelector('${cardSel} .kbnm-x').click()`)
    await sleep(300)
    check('the card can be dismissed', (await q(`document.querySelector('${cardSel}') === null`)) === true)
  }

  // B. the missing key itself, in the card (a fresh start: the default model has no key again)
  await backToTheStartingPoint()
  await freshChat()
  await typeInComposer('Hello again')
  const card2 = await waitFor(page, `!!document.querySelector('${cardSel}')`, 25000)
  check('the card is back for a new failed turn', card2 === true)
  if (card2 === true) {
    // The route of THIS failed turn: the profile's default is whatever the instance had, and what matters is that the
    // card names it and saves the key of that very reference. The profile is reloaded a moment after the restore above:
    // the card may still name the model connected in the previous section until it is redrawn.
    await waitFor(page, `(() => { const c = document.querySelector('${cardSel}'); return !!c && !/ollama-local/.test(c.innerText) })()`, 25000)
    const text2 = await q(`document.querySelector('${cardSel}').innerText`)
    route = (/The model it uses, ([^,]+), has no API key/.exec(text2) || [])[1]
    check('the card names the route of this turn', typeof route === 'string' && route.length > 0, JSON.stringify(text2))
    const typeKey2 = async (v) => q(`(() => { const i = document.querySelector('#kbnm-key'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(v)}); i.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
    check('Save is disabled until something key-shaped is typed', (await q(`document.querySelector('.kbnm-primary').disabled`)) === true)
    // The profile of the instance is reloaded a moment after the restore above: the card may be redrawn once, which
    // empties the field. Type again until the value holds (a person would simply type on).
    let held = false
    for (let attempt = 0; attempt < 4 && !held; attempt += 1) {
      await typeKey2('sk-card-test-0123456789abcdef')
      await sleep(900)
      held = (await q(`(document.querySelector('#kbnm-key') || {}).value`)) === 'sk-card-test-0123456789abcdef'
    }
    check('and enabled after', held && (await q(`document.querySelector('.kbnm-primary').disabled`)) === false)
    // The route the card names AT THE MOMENT of saving: the chat may have been given another model since (section A selected
    // the local one for it), and the key saved is the one of the route the card shows.
    const routeAtSave = (/The model it uses, ([^,]+), has no API key/.exec(String(await q(`document.querySelector('${cardSel}').innerText`))) || [])[1] || route
    await q(`document.querySelector('.kbnm-primary').click()`)
    check('the key is saved', (await waitFor(page, `document.querySelector('${cardSel}').innerText.includes('Key saved')`, 8000)) !== null)
    const expectedRef = routeAtSave.toUpperCase().replace(/[^A-Z0-9]+/g, '_') + '_API_KEY'
    // The engine writes its credential file a moment after it answers: look for the name for a few seconds.
    let named = false
    for (let i = 0; i < 12 && !named; i += 1) { named = read('.credentials.yaml').includes(expectedRef); if (!named) await sleep(500) }
    const credNames = (read('.credentials.yaml').match(/^\s{2,}([A-Za-z0-9_.\/-]+):/gm) || []).map((x) => x.trim().replace(/:$/, ''))
    check('the credential of that very reference exists, by name', named, JSON.stringify({ expectedRef, route, credNames, card: String(await q(`(document.querySelector('${cardSel}') || {}).innerText`)).slice(0, 200) }))
    check('the typed key is nowhere but in the credential store', !read('profiles/web/cordis.patch.yml').includes('sk-card-test-0123456789abcdef') && !read('kybernos/onboarding.json').includes('sk-card-test'))
    await q(`document.querySelector('.kbnm-primary').click()`)
    await sleep(600)
    check('the message is put back in the box, not sent', (await q(`(document.querySelector('[contenteditable="true"]') || {}).innerText`)).includes('Hello again'))
    check('and the card says so', (await q(`document.querySelector('${cardSel}').innerText`)).includes('press Enter'))
  }

  // ...and still not there once the first run is over: a reload (the wizard is done, no model was chosen) shows the home, not DSH's dialog
  await page.send('Page.reload', { ignoreCache: true })
  await sleep(6000)
  check('after the first run and a reload, no DSH sign-in dialog over the home', (await q(`[...document.querySelectorAll('[role="dialog"]')].every((d) => !/DeepSeek account|Add API Key/.test(d.innerText || ''))`)) === true && (await q(`document.body.innerText.length`)) > 200)

  check('no page error', page.errs.filter((e) => /kybernos|onboarding|kb-ob|is not defined|is not a function|Cannot read/i.test(e)).length === 0, JSON.stringify(page.errs.slice(0, 3)))
  console.log('     screenshots: ' + shotDir)
} catch (e) {
  fails += 1
  console.log('FAIL ' + String(e && e.message ? e.message : e))
} finally {
  await live.close()
  // Back to the credentials the instance had before this run.
  try { if (credsBackup !== null) writeFileSync(credsFile, credsBackup) } catch (e) { /* the sandbox is nobody's */ }
  try { if (patchBackup !== null) writeFileSync(patchFile, patchBackup) } catch (e) { /* the sandbox is nobody's */ }
  forgetKitTeams()
  await sleep(6000)
}
console.log(fails === 0 ? '\nall checks passed' : '\n' + fails + ' check(s) FAILED')
process.exit(fails === 0 ? 0 : 1)
