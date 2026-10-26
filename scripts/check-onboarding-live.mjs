// The first-run wizard on a real GUI: the screens, the model question (a Kybernos account or an own key), the account
// path's pairing, a key pasted and saved, a model installed and connected, the starter kit (skills and agent teams of
// the field of work and its goals), the field and goals written to memory, the menu wording the field gives, a replay that never skips the model step, and the hand-over
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
const fitLog = []
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
// What the route does when it switches the default model: the profile's `agent-default-model` names the new provider and model. The check's stand-in for a local
// model's switch (below) leaves exactly that in the sandbox's own profile, so that « it became the default model » is read from the file as before.
const setDefaultModel = (provider, model) => {
  try {
    const text = readFileSync(patchFile, 'utf8')
    const next = text.replace(/(- id: agent-default-model[\s\S]*?config:\s*\n\s*provider: )([^\n]+)(\n\s*model: )([^\n]+)/, (all, a, p0, b) => a + provider + b + model)
    if (next !== text) writeFileSync(patchFile, next)
  } catch (e) { /* the sandbox is nobody's */ }
}
const backToTheStartingPoint = async () => {
  // The next section starts from a default model that has no key, as the profile had.
  try { if (credsBackup !== null) writeFileSync(credsFile, credsBackup) } catch (e) { /* the sandbox is nobody's */ }
  try { if (patchBackup !== null) writeFileSync(patchFile, patchBackup) } catch (e) { /* the sandbox is nobody's */ }
  await sleep(7000)
}

// The starter kit installs its two teams into DSH's own home (A6-24), where they stay: a second run would find them installed and tick nothing.
// The sandbox is this check's own, so they are removed before the run and after it.
const forgetKitTeams = () => { for (const id of ['studencik', 'research-desk']) { try { rmSync(join(dshHome, 'kybers', id), { recursive: true, force: true }) } catch (e) { /* none */ } } try { rmSync(join(dshHome, 'kybers', '.kyber-ui.json'), { force: true }) } catch (e) { /* none */ }
  // what the kit also made: the skill the plugin ships (and its mark in the seeding record) and the automation, which is a task of the sandbox's own file
  for (const name of ['quiz-builder', 'deadline-check']) try { rmSync(join(dshHome, 'skills', name), { recursive: true, force: true }) } catch (e) { /* none */ }
  try { const f = join(dshHome, 'kybernos/seeded-skills.json'); if (existsSync(f)) { const j = JSON.parse(readFileSync(f, 'utf8')); if (j && j.skills) { delete j.skills['deadline-check']; delete j.skills['quiz-builder']; writeFileSync(f, JSON.stringify(j)) } } } catch (e) { /* none */ }
  try { const f = join(dshHome, 'kybernos/tasks.json'); if (existsSync(f)) { const t = JSON.parse(readFileSync(f, 'utf8')); if (Array.isArray(t)) writeFileSync(f, JSON.stringify(t.filter((x) => !(x && ['Refresh my revision plan', 'Mettre à jour mon plan de révision'].includes(x.name))), null, 2) + '\n') } } catch (e) { /* none */ }
}
forgetKitTeams()

// A fresh install: the sandbox's setup writes the file as done; the wizard opens only when it says otherwise. What the sandbox had is put back at the end.
mkdirSync(join(dshHome, 'kybernos'), { recursive: true })
// What the sandbox is put back to is a FINISHED first run: its own file when that one says so, else the state the sandbox's setup writes. A run that was killed hard
// leaves the wizard open (completed:false) behind it; the next run must not take THAT for « what the sandbox had » and leave it open again, because every other live
// check (the footer's first among them) then meets the wizard over the page and fails (R-A6-03).
const FINISHED_FIRST_RUN = JSON.stringify({ version: 1, completed: true, installedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:00:00.000Z', profil: 'produit', uiMode: null }) + '\n'
const onboardingBackup = (() => {
  const had = read('kybernos/onboarding.json')
  try { return JSON.parse(had).completed === true ? had : FINISHED_FIRST_RUN } catch (e) { return FINISHED_FIRST_RUN }
})()
writeFileSync(join(dshHome, 'kybernos/onboarding.json'), JSON.stringify({ version: 1, completed: false, installedAt: '2026-01-01T00:00:00.000Z', completedAt: null, profil: null, uiMode: null }) + '\n')

// keepKeyDialog: this check must SEE DSH's own « Get started » dialog if it ever comes back over the wizard (A5-34, A6-01); the helper would press it away.
// KB_VIEW=1000x561 plays the whole check in a smaller (or a phone-sized) window: the fit report at the end says which screens scroll there.
const VIEW = /^(\d+)x(\d+)$/.exec(process.env.KB_VIEW || '')
const live = await openLivePage(Object.assign({ keepKeyDialog: true }, VIEW !== null ? { width: Number(VIEW[1]), height: Number(VIEW[2]) } : {}))
const page = live.page
// Back to what the sandbox had: the credentials, the profile's settings, the onboarding state and the teams the kit installed. Run at the end AND when the run is cut.
const restoreSandbox = () => {
  try { if (credsBackup !== null) writeFileSync(credsFile, credsBackup) } catch (e) { /* the sandbox is nobody's */ }
  try { if (patchBackup !== null) writeFileSync(patchFile, patchBackup) } catch (e) { /* the sandbox is nobody's */ }
  try { writeFileSync(join(dshHome, 'kybernos/onboarding.json'), onboardingBackup) } catch (e) { /* the sandbox is nobody's */ }
  forgetKitTeams()
}
const verdict = () => console.log(fails === 0 ? '\nall checks passed' : '\n' + fails + ' check(s) FAILED')
// A run that is cut (Ctrl-C, a kill, an error nobody caught) still puts the sandbox back and still says how it ended: a gate without a verdict is not a gate.
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { fails += 1; console.log('FAIL the run was interrupted (' + sig + ')'); try { await live.close() } catch (e) { /* gone */ } restoreSandbox(); verdict(); process.exit(130) })
process.on('unhandledRejection', (e) => { fails += 1; console.log('FAIL an error nobody caught: ' + String(e && e.message ? e.message : e).slice(0, 200)) })
process.on('uncaughtException', (e) => { fails += 1; console.log('FAIL an exception nobody caught: ' + String(e && e.message ? e.message : e).slice(0, 200)); try { restoreSandbox() } catch (e2) { /* gone */ } verdict(); process.exit(1) })
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
    // The free provider and the local model are answered here; the other ways (an own key) read the REAL route (the default model is checked on disk).
    if (path === '/kybernos/model/auto') {
      let body = {}
      try { body = JSON.parse(postData || '{}') } catch (e) { body = {} }
      // A local model: the real route asks THIS machine's Ollama which models it holds, and the stand-in installer pulled nothing, so the answer would be
      // « no-model » (or another model) on a machine without Ollama and a different one on a machine with it. The stand-in answers as the route does when the
      // model IS listed (the route's own choices are covered by packages/kybernos-plugin/test-default-model.mjs) and writes what that answer means in the
      // sandbox's profile: the default model. A chat that asked (a sessionId) gets it for itself, which is also saved as the default, as the engine does.
      if (body.provider === 'ollama-local') {
        fake.calls.push('model-auto-local')
        const model = typeof body.model === 'string' && body.model !== '' ? body.model : 'qwen3.5:9b'
        setDefaultModel('ollama-local', model)
        return { ok: true, switched: true, provider: 'ollama-local', model, scope: typeof body.sessionId === 'string' && body.sessionId !== '' ? 'session' : 'default' }
      }
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
    if (p.responseStatusCode !== undefined) {
      // The wizard asks THIS machine's Ollama for its models to decide whether a model already works (« Keep as is » instead of « Decide later », no free models
      // offered after an account without models, the kit without a model question). A machine that holds models would turn those steps into other steps, so
      // the answer of the real route is kept but for the one thing that depends on the machine: its Ollama has no model, as on the machine this check is written for.
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
    try { body = answers(p.request.url, p.request.method, p.request.postData) } catch (e) { body = null }
    try {
      if (body === null) await page.send('Fetch.continueRequest', { requestId: p.requestId })
      else await page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: json(body) })
    } catch (e) { /* the page moved on */ }
  })
  await page.send('Fetch.enable', { patterns: ['kybernos-cloud/start', 'kybernos-cloud/poll', 'kybernos-cloud/disconnect', 'kybernos-cloud/status', 'kybernos-cloud/memory/', 'kybernos-models/key/check',
    'kybernos-skills/skills', 'kybernos-skills/install',
    'modeles-locaux/installer', 'modeles-locaux/installation', 'free-llms/auto-enable', 'kybernos/model/auto'].map((x) => ({ urlPattern: '*/' + x + '*', requestStage: 'Request' }))
    .concat([{ urlPattern: '*/modeles-locaux/machine*', requestStage: 'Response' }]) })
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
  // Every screen the check reaches is measured once it is drawn: does the wizard scroll as a page, and is its main action on screen?
  const fit = async (label) => {
    const m = await q(`(() => { const r = document.querySelector('.kb-ob'); if (!r) return null; const a = document.querySelector('.kb-ob-primary, .kb-ob-go'); const ar = a ? a.getBoundingClientRect() : null; return { over: r.scrollHeight - r.clientHeight, vh: innerHeight, vw: innerWidth, wide: document.documentElement.scrollWidth - innerWidth, action: ar ? Math.round(ar.bottom) : null } })()`)
    if (m !== null && m !== undefined && m.over !== undefined) fitLog.push(Object.assign({ screen: label }, m))
  }
  const seen = async (text, ms = 8000) => {
    const r = await waitFor(page, `[...document.querySelectorAll('.kb-ob h1')].some((e) => e.textContent.trim() === ${JSON.stringify(text)})`, ms)
    if (r !== null) { await sleep(450); await fit(text) }
    return r
  }
  // A connected model becomes the default a few seconds later: the route is hot-applied, the wizard asks again meanwhile.
  const nowTheModel = (id) => waitFor(page, `((document.querySelector('.kb-ob') || {}).innerText || '').includes(${JSON.stringify(id + ' is now the model of your chats')})`, 20000)
  const goEnglish = async () => {
    await q(`document.querySelector('.kb-ob-lang-btn').click()`); await sleep(150)
    await q(`document.querySelector('.kb-ob-menu button[lang="en"]').click()`); await sleep(150)
  }
  // welcome → field (a tap on a tile chooses, Continue moves on) → goals → the model question
  const toModelStep = async () => {
    await press('Get started')
    for (let i = 0; i < 8 && (await h1()) !== 'Which models should Kybernos use?'; i += 1) {
      if ((await h1()) === 'Which field do you work in?') { await press('Education'); await sleep(300) }
      await press('Continue')
    }
  }
  // After the model: « about you » is passed, the agents are kept as proposed, the kit is left without installing anything, the plan is left free: the recap follows.
  const skipKit = async () => {
    await seen('Tell Kaby about you', 8000); await press('Skip this step')
    await seen('How much can agents do alone?', 8000); await press('Continue')
    await waitFor(page, `/^(A starter kit for|Start with these)/.test((document.querySelector('.kb-ob h1') || {}).textContent || '')`, 8000); await press('Not now')
    await seen('So it keeps running without you', 8000); await press('Continue for free')
  }
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
  check('after the goals, the model question is asked', (await h1()) === 'Which models should Kybernos use?', String(await h1()))
  check('it is the third of six numbered steps (field, goals, model, about you, agents, kit)', /^Step 3 of 6$/.test(String(await q(`(document.querySelector('.kb-ob-eyebrow') || {}).textContent`))))
  const answersShown = await q(`[...document.querySelectorAll('.kb-ob-row .kb-ob-t')].map((e) => e.textContent.trim())`)
  check('two answers, the Kybernos account recommended', Array.isArray(answersShown) && answersShown.length === 2 && /^Kybernos models/.test(answersShown[0]) && /Recommended/.test(answersShown[0]) && /^My own API key/.test(answersShown[1]), JSON.stringify(answersShown))
  check('the Kybernos account is ticked by default', (await q(`document.querySelector('.kb-ob-row.on .kb-ob-t').textContent`)).startsWith('Kybernos models'))
  check('the other ways stay one line below', /a model on this computer/.test(String(await q(`(document.querySelector('.kb-ob-others') || {}).textContent`))) && /free community models/.test(String(await q(`(document.querySelector('.kb-ob-others') || {}).textContent`))))
  await escape()
  check('Escape on the model question steps back to the goals, not out of the wizard', (await q(`!!document.querySelector('.kb-ob')`)) === true && (await h1()) === 'What do you want Kybernos to do for you?' && onboardingDone() === false, String(await h1()))
  await press('Continue')
  check('Continue brings the model question back', (await h1()) === 'Which models should Kybernos use?', String(await h1()))
  check('the question can be left for later', (await q(`[...document.querySelectorAll('.kb-ob button')].some((b) => b.textContent.trim() === 'Decide later')`)) === true)
  await page.shot(join(shotDir, 'model-question.png'))

  /* ── 2. the account: the code is shown, the page is opened, a pending pairing is polled, Cancel cleans up ── */
  await press('Continue')
  await waitFor(page, `((document.querySelector('.kb-ob-code b') || {}).textContent) === 'KB4-7QX2'`, 10000)
  check('the pairing code is shown to be typed on the page', (await q(`(document.querySelector('.kb-ob-code b') || {}).textContent`)) === 'KB4-7QX2')
  for (let i = 0; i < 80 && fake.calls.filter((c) => c === 'cloud-poll').length < 1; i += 1) await sleep(250)
  check('the pairing is polled while it is pending', fake.calls.filter((c) => c === 'cloud-poll').length >= 1, JSON.stringify(fake.calls))
  await press('Cancel')
  check('Cancel clears the pending pairing and returns to the question', fake.calls.includes('cloud-disconnect') && (await h1()) === 'Which models should Kybernos use?', String(await h1()))

  /* ── 3. another provider: handed over to Settings, in any language ───────────────────────────────────── */
  await press('My own API key')
  await press('Continue')
  check('the paste form is there for a known provider', (await q(`!!document.querySelector('#kb-ob-key')`)) === true)
  // « Other providers » opens the catalogue of the models page (checked in full by check-onboarding-phone-live.mjs); a custom API is what Settings still does alone.
  await press('Other providers')
  check('« Other providers » opens the list of the catalogue', (await h1()) === 'Other providers', String(await h1()))
  await press('Custom API')
  check('another provider has no paste field', (await q(`!!document.querySelector('#kb-ob-key')`)) === false)
  await press('Open Settings → AI provider and models')
  await waitFor(page, `document.querySelector('.kb-ob') === null`, 8000)
  check('the wizard is gone', (await q(`document.querySelector('.kb-ob') === null`)) === true)
  const settingsOpen = await waitFor(page, `[...document.querySelectorAll('nav button')].some((b) => /models/i.test(b.textContent))`, 8000)
  check('the Settings dialog opened', settingsOpen !== null)
  const selectedCell = `(() => { const sel = document.querySelector('nav button[aria-current], nav button[aria-selected="true"], nav button[class*="active"], nav button[class*="selected"]'); return sel ? sel.textContent.trim() : null })()`
  await waitFor(page, `${selectedCell} === 'AI provider and models'`, 10000)
  const landed = await q(selectedCell)
  check('it landed on AI provider and models', landed === 'AI provider and models', JSON.stringify(landed))
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
  await waitFor(page, `!!document.querySelector('.kb-ob-state.err')`, 8000)
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
  check('the progress screen is shown while it downloads', (await seen('Installing qwen3.5:9b', 8000)) !== null || (await seen('Model ready', 30000)) !== null)
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
  await waitFor(page, `!document.querySelector('.kb-ob-primary').disabled`, 5000)
  await press('Use free models')
  await skipKit()
  await press('Open Kybernos')
  check('the wizard closes', (await waitFor(page, `document.querySelector('.kb-ob') === null`, 8000)) === true)
  for (let i = 0; i < 40 && !(fake.calls.includes('free-enable') && fake.calls.includes('model-auto')); i += 1) await sleep(250)
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
  // The earlier sections went through the wizard and chose a field: this one starts from a machine that has none (and no memory written for it yet).
  try { writeFileSync(join(dshHome, 'kybernos/onboarding.json'), JSON.stringify({ ...JSON.parse(read('kybernos/onboarding.json')), profil: null, goals: [], agents: null, about: null, memoryId: null })) } catch (e) { /* the sandbox is nobody's */ }
  check('Replay reopens the wizard on a connected machine', await replay())
  await goEnglish()
  await press('Get started')
  check('the field of work is asked, with the nine fields the packs ship as tiles (an icon, a name, what it covers)', (await h1()) === 'Which field do you work in?' && (await q(`document.querySelectorAll('.kb-ob-tiles .kb-ob-tile').length`)) === 9 && (await q(`[...document.querySelectorAll('.kb-ob-tile')].every((t) => t.querySelector('.kb-ob-tile-b svg') && t.querySelector('b').textContent.length > 2 && t.querySelector('small').textContent.length > 8)`)) === true, String(await h1()))
  const pvName = () => q(`(() => { const n = document.querySelector('.kb-ob-pv-name'); return n && n.style.display !== 'none' ? n.textContent : null })()`)
  const pvMenu = () => q(`[...document.querySelectorAll('.kb-ob-pv .kb-ob-pw-mi span:last-child')].map((e) => e.textContent.trim())`)
  check('a live miniature of Kybernos sits beside the step, neutral until a field is shown', (await q(`!!document.querySelector('.kb-ob-split .kb-ob-pv .kb-ob-pw')`)) === true && (await pvName()) === null && (await q(`document.querySelector('.kb-ob').classList.contains('kb-ob-tint')`)) === false)
  check('the miniature starts level with the subtitle, within 2 px', (await q(`(() => { const s = document.querySelector('.kb-ob-split .kb-ob-step .kb-ob-sub'); const p = document.querySelector('.kb-ob-pv'); return !!s && !!p && (getComputedStyle(p).display === 'none' /* a narrow or short window hides the picture */ || Math.abs(s.getBoundingClientRect().top - p.getBoundingClientRect().top) <= 2) })()`)) === true)
  await page.shot(join(shotDir, 'field-neutral.png'))
  await q(`document.querySelectorAll('.kb-ob-tile')[1].dispatchEvent(new Event('mouseenter'))`)
  await sleep(300)
  const tinted = await q(`(() => { const r = document.querySelector('.kb-ob'); return { on: r.classList.contains('kb-ob-tint'), a: r.style.getPropertyValue('--ob-a'), dark: r.classList.contains('kb-ob-dark') } })()`)
  // the colour of Health is #1B7F76; on a dark page it is made lighter (30 % towards white), so that it reads
  const healthColour = tinted !== undefined && tinted.dark === true ? '#5fa59f' : '#1b7f76'
  check('hovering a field shows it at once: the page takes its colour, the miniature its name and its menu wording', tinted !== undefined && tinted.on === true && String(tinted.a).trim().toLowerCase() === healthColour && (await pvName()) === 'Health' && (await pvMenu()).includes('My activity') && (await pvMenu()).includes('Practice team'), JSON.stringify([tinted, await pvName(), await pvMenu()]))
  await page.shot(join(shotDir, 'field-hover-health.png'))
  await q(`document.querySelector('.kb-ob-tiles').dispatchEvent(new Event('mouseleave'))`)
  await sleep(200)
  check('leaving the tiles puts the neutral Kybernos back', (await pvName()) === null && (await q(`document.querySelector('.kb-ob').classList.contains('kb-ob-tint')`)) === false)
  check('the sentence box is gone: a field is chosen by a tap on its tile', (await q(`!document.querySelector('.kb-ob-nl, .kb-ob-nlin')`)) === true)
  check('the miniature\'s own text sits under it, never above', (await q(`(() => { const p = document.querySelector('.kb-ob-pv'); const k = [...p.children].map((e) => e.className); return k.indexOf('kb-ob-pv-box') === 0 && k.indexOf('kb-ob-pv-h') === 1 && k.indexOf('kb-ob-pv-cap') === 2 })()`)) === true)
  const fieldState = () => q(`(() => ({ h1: (document.querySelector('.kb-ob h1') || {}).textContent, on: [...document.querySelectorAll('.kb-ob-tile.on')].map((t) => t.getAttribute('data-pack')), checked: [...document.querySelectorAll('.kb-ob-tile[aria-checked="true"]')].length, next: (document.querySelector('[data-kb-ob-primary]') || {}).disabled }))()`)
  check('Continue waits for a choice on the field step', (await fieldState()).next === true)
  await q(`document.querySelector('.kb-ob-tile').__kept = 1`)
  await press('Education')
  await sleep(600)
  const edu = await fieldState()
  check('a tap on a field only chooses it: still on the field step, its tile ticked, Continue enabled', edu.h1 === 'Which field do you work in?' && edu.on.length === 1 && edu.checked === 1 && edu.next === false, JSON.stringify(edu))
  await press('Health')
  await sleep(600)
  const hea = await fieldState()
  check('the choice can be changed: another tap moves the tick, still no jump', hea.h1 === 'Which field do you work in?' && hea.on.length === 1 && hea.on[0] !== edu.on[0] && hea.checked === 1, JSON.stringify(hea))
  check('a choice does not redraw the screen (no flash): the very same tile elements are still there', (await q(`document.querySelector('.kb-ob-tile').__kept === 1`)) === true)
  await press('Education')
  await sleep(300)
  await q(`document.querySelector('.kb-ob-lang-btn').click()`); await sleep(250)
  check('a redraw of the same screen (the language menu opened) does not replay its entrance animation', (await q(`(() => { const e = document.querySelector('.kb-ob-step'); return e.classList.contains('kb-ob-still') && getComputedStyle(e).animationName === 'none' })()`)) === true)
  await q(`document.querySelector('.kb-ob-lang-btn').click()`); await sleep(250)
  await press('Continue')
  check('Continue moves on to the goals: five tags, the first two ticked, and Continue there', (await seen('What do you want Kybernos to do for you?')) !== null && (await q(`document.querySelectorAll('.kb-ob-gtags .kb-ob-chip').length`)) === 5 && (await q(`document.querySelectorAll('.kb-ob-gtags .kb-ob-chip.on').length`)) === 2 && (await q(`document.querySelector('[data-kb-ob-primary]').disabled`)) === false)
  check('the goals are tags you tick (checkboxes), not tall cards', (await q(`[...document.querySelectorAll('.kb-ob-gtags .kb-ob-chip')].every((b) => b.getAttribute('role') === 'checkbox')`)) === true && (await q(`document.querySelectorAll('.kb-ob-rows .kb-ob-row').length`)) === 0)
  check('the line under the tags says what the goal in focus is and what it adds: skills, an automation, a team', /Pass my exams.*2 skills.*1 automation.*team Studencik/.test(String(await q(`document.querySelector('.kb-ob-gfocus').textContent`))), String(await q(`document.querySelector('.kb-ob-gfocus').textContent`)))
  await q(`document.querySelectorAll('.kb-ob-gtags .kb-ob-chip')[3].dispatchEvent(new MouseEvent('mouseenter'))`)
  check('pointing at another tag shows that one, and leaving it brings the first back', /Prepare my classes/.test(String(await q(`document.querySelector('.kb-ob-gfocus').textContent`))) && (await (async () => { await q(`document.querySelectorAll('.kb-ob-gtags .kb-ob-chip')[3].dispatchEvent(new MouseEvent('mouseleave'))`); return /Pass my exams/.test(String(await q(`document.querySelector('.kb-ob-gfocus').textContent`))) })()))
  check('the primary button follows the colour of the field (Education)', (await q(`getComputedStyle(document.querySelector('[data-kb-ob-primary]')).backgroundColor`)) === (tinted.dark === true ? 'rgb(152, 130, 249)' : 'rgb(108, 77, 246)'))
  check('the miniature shows the example of the field before a goal is ticked', (await q(`document.querySelectorAll('.kb-ob-pv .kb-ob-pw-sc:not(.empty)').length`)) === 2)
  check('two goals ticked, Continue is there', (await q(`document.querySelectorAll('.kb-ob-gtags .kb-ob-chip.on').length`)) === 2 && (await q(`document.querySelector('[data-kb-ob-primary]').disabled`)) === false)
  // The free field: a goal in the person's own words becomes a dashed tag with its cross, has no kit, and travels to the memory line and to Learn my business
  await q(`(() => { const i = document.querySelector('#kb-ob-f-own'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '  Prepare   my thesis defence '); i.dispatchEvent(new Event('input', { bubbles: true })); i.focus(); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })()`)
  await sleep(500)
  check('the free field adds a tag of its own (cleaned, dashed, with a cross), says it has no kit, and the field is ready for the next one', (await q(`document.querySelectorAll('.kb-ob-gown').length`)) === 1 && /^Prepare my thesis defence/.test(String(await q(`document.querySelector('.kb-ob-gown-t').textContent`))) && (await q(`getComputedStyle(document.querySelector('.kb-ob-gown')).borderTopStyle`)) === 'dashed' && /No ready-made kit/.test(String(await q(`document.querySelector('.kb-ob-gfocus').textContent`))) && (await q(`document.activeElement && document.activeElement.id`)) === 'kb-ob-f-own' && (await q(`document.querySelector('#kb-ob-f-own').value`)) === '')
  check('typing the same goal again (in another case) adds nothing', await (async () => { await q(`(() => { const i = document.querySelector('#kb-ob-f-own'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'PREPARE MY THESIS DEFENCE'); i.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('.kb-ob-gadd').click() })()`); await sleep(300); return (await q(`document.querySelectorAll('.kb-ob-gown').length`)) === 1 })())
  check('the miniature follows the ticks: their first questions, their skills, their automation, their team', (await q(`document.querySelectorAll('.kb-ob-pv .kb-ob-pw-sc:not(.empty)').length`)) === 2 && (await q(`[...document.querySelectorAll('.kb-ob-pv .kb-ob-pw-skl span')].map((e) => e.textContent).join()`)).includes('study-plan') && /Refresh my revision plan/.test(String(await q(`document.querySelector('.kb-ob-pv').textContent`))) && /Studencik/.test(String(await q(`document.querySelector('.kb-ob-pv').textContent`))))
  await page.shot(join(shotDir, 'goals.png'))
  await press('Continue')
  check('the model step is NOT skipped although an account is connected', (await h1()) === 'Which models should Kybernos use?', String(await h1()))
  const line = String(await q(`(document.querySelector('.kb-ob-row.on .kb-ob-st') || {}).textContent`))
  check('it says who is connected and how many models', /Connected · amina@example\.com · 14 models ready/.test(line), JSON.stringify(line))
  check('the other answer (an own key) is still there to add', (await q(`[...document.querySelectorAll('.kb-ob-row .kb-ob-t')].some((e) => /^My own API key/.test(e.textContent.trim()))`)) === true)
  await page.shot(join(shotDir, 'replay-model-question.png'))
  await press('Keep as is')
  check('« about you » comes after the model: a website, a profile and a free word, none required', (await seen('Tell Kaby about you')) !== null && (await q(`document.querySelectorAll('.kb-ob-in').length`)) === 3 && /^Step 4 of 6$/.test(String(await q(`(document.querySelector('.kb-ob-eyebrow') || {}).textContent`))))
  check('its button says « Skip this step » (not the header\'s Skip) while nothing is typed', String(await q(`document.querySelector('[data-kb-ob-primary]').textContent`)) === 'Skip this step')
  const typeAbout = (id, v) => q(`(() => { const i = document.getElementById(${JSON.stringify(id)}); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  await typeAbout('kb-ob-f-site', 'svt-lemaire.example')
  await typeAbout('kb-ob-f-social', 'linkedin.com/in/sofia-lemaire')
  await typeAbout('kb-ob-f-words', 'Years 10 and 11, a quiz every week.')
  check('once something is typed the button says Continue', String(await q(`document.querySelector('[data-kb-ob-primary]').textContent`)) === 'Continue')
  await page.shot(join(shotDir, 'about.png'))
  await press('Continue')
  check('the agents come next: three presets, the field\'s own marked, its reason and what it means under them', (await seen('How much can agents do alone?')) !== null && (await q(`document.querySelectorAll('.kb-ob-rows .kb-ob-row').length`)) === 3 && /Balanced/.test(String(await q(`document.querySelector('.kb-ob-row.on').textContent`))) && /for your field/.test(String(await q(`document.querySelector('.kb-ob-row.on').textContent`))) && /Why:/.test(String(await q(`document.querySelector('.kb-ob-sum').textContent`))))
  await press('Autonomous')
  check('another preset can be ticked, and what it means follows', /Autonomous/.test(String(await q(`document.querySelector('.kb-ob-row.on').textContent`))) && /Sends on its own/.test(String(await q(`document.querySelector('.kb-ob-sum').textContent`))))
  await page.shot(join(shotDir, 'agents.png'))
  await press('Continue')
  check('the starter kit follows, named after the field', (await seen('A starter kit for Education')) !== null, String(await h1()))
  check('it is the last numbered step, with NO display-mode row (the field decides it) and the kit as one line', /^Step 6 of 6$/.test(String(await q(`(document.querySelector('.kb-ob-eyebrow') || {}).textContent`))) && (await q(`!document.querySelector('.kb-ob-seg') && !document.querySelector('.kb-ob-rw')`)) === true && /^Skills: 5 · Teams: 2 · Automations \(off\): 1/.test(String(await q(`document.querySelector('.kb-ob-sumrow').textContent`))) && (await q(`document.querySelectorAll('.kb-ob-kit').length`)) === 0)
  await q(`document.querySelector('.kb-ob-sumrow').click()`)
  await sleep(200)
  // The screen is drawn with the default ticks at once and the installed marks follow when the two reads of what is installed (the skills list, the agent teams) have
  // come back, which takes longer on a busy machine: the rows are read once the one this check installed (pdf) is marked as done, never at the moment the heading shows.
  const kitLoaded = await waitFor(page, `[...document.querySelectorAll('.kb-ob-kit')].some((r) => r.querySelector('b').textContent === 'pdf' && r.classList.contains('done'))`, 30000)
  check('the kit has read what is installed before it is looked at', kitLoaded !== null)
  const kitRows = await q(`[...document.querySelectorAll('.kb-ob-kit')].map((r) => r.querySelector('b').textContent + (r.classList.contains('done') ? ':done' : r.classList.contains('on') ? ':on' : r.classList.contains('soon') ? ':soon' : ':off'))`)
  console.log('     kit rows: ' + JSON.stringify(kitRows))
  check('what is installed is marked and not ticked again', Array.isArray(kitRows) && kitRows.includes('pdf:done') && kitRows.includes('study-plan:on') && kitRows.includes('flashcards:on') && kitRows.includes('docx:on') && kitRows.includes('quiz-builder:on'), JSON.stringify(kitRows))
  check('the automation of the goals is offered, ticked, with its schedule, and said to be created off', kitRows.includes('Refresh my revision plan:on') && /Every Sunday at 18:00/.test(String(await q(`document.querySelector('.kb-ob-kitbox:nth-of-type(3)') ? document.body.innerText : document.body.innerText`))) && /switched off/.test(String(await q(`document.querySelector('.kb-ob').innerText`))))
  check('the skill the plugin ships says so, the others name their repository', /included with Kybernos/.test(String(await q(`document.querySelector('.kb-ob').innerText`))) && /from anthropics\/skills/.test(String(await q(`document.querySelector('.kb-ob').innerText`))))
  check('Learn my business is in the same list, ticked, with its chip, what it does and the apps it is better with', kitRows.includes('Learn my business:on') && /proposes only/.test(String(await q(`document.querySelector('.kb-ob').innerText`))) && /Better with Gmail and Google Calendar/.test(String(await q(`document.querySelector('.kb-ob').innerText`))) && /It only proposes: nothing is added or switched on without your click/.test(String(await q(`document.querySelector('.kb-ob').innerText`))))
  check('the teams of the marketplace are offered and ticked', Array.isArray(kitRows) && kitRows.includes('Studencik:on') && kitRows.includes('Research Desk:on'), JSON.stringify(kitRows))
  check('the primary button counts what is ticked', /^Add 8 selected$/.test(String(await q(`document.querySelector('.kb-ob-primary').textContent`))), String(await q(`document.querySelector('.kb-ob-primary').textContent`)))
  await page.shot(join(shotDir, 'starter-kit.png'))
  // untick one, then add: only what is ticked is installed
  await q(`[...document.querySelectorAll('.kb-ob-kit')].find((r) => r.querySelector('b').textContent === 'docx').click()`)
  await sleep(150)
  check('a skill can be unticked', /^Add 7 selected$/.test(String(await q(`document.querySelector('.kb-ob-primary').textContent`))))
  await press('Add 7 selected')
  check('the plan is the last thing asked, with an account on the machine: Team solo, or free', (await seen('So it keeps running without you', 40000)) !== null && (await q(`[...document.querySelectorAll('.kb-ob button')].filter((b) => !b.disabled).map((b) => b.textContent.trim()).filter((t) => /^Continue (with|for)/.test(t)).join('|')`)) === 'Continue with Team solo|Continue for free' && !/\$|€/.test(String(await q(`document.querySelector('.kb-ob').innerText`))), String(await h1()))
  await page.shot(join(shotDir, 'plan.png'))
  await press('Continue for free')
  check('the recap follows the installation', (await seen('You’re all set', 40000)) !== null, String(await h1()))
  check('the skills went through the Skills page route, with their GitHub source', JSON.stringify(fake.skillInstalls.sort()) === JSON.stringify(['anthropics/claude-for-legal:flashcards', 'anthropics/claude-for-legal:study-plan']), JSON.stringify(fake.skillInstalls))
  const recapText = String(await q(`document.querySelector('.kb-ob-recap').textContent`))
  check('the recap says what was added, without an error', /Starter kit/.test(recapText) && /7 added/.test(recapText) && (await q(`!document.querySelector('.kb-ob-state.err')`)) === true, recapText)
  // A6-24: the kit's teams go to DSH's own home; a welcome screen must not add a `kybers/` folder to the project DSH was started in.
  check('the teams of the kit are in DSH\'s own home (~/.dsh/kybers)', read('kybers/studencik/kyber.yml') !== '' && read('kybers/research-desk/kyber.yml') !== '')
  check('the skill the plugin ships was written into the skills folder by the plugin\'s own route (nothing downloaded)', existsSync(join(dshHome, 'skills', 'quiz-builder', 'SKILL.md')) && /^---\nname: quiz-builder\n/.test(read('skills/quiz-builder/SKILL.md')))
  fake.skillsInstalled.push('quiz-builder') // the faked skills list stands for the registry: it now holds the file the route wrote
  const madeTasks = (() => { try { return JSON.parse(read('kybernos/tasks.json')) } catch (e) { return [] } })()
  const made = madeTasks.find((t) => t && t.name === 'Refresh my revision plan')
  check('the automation was created switched OFF, on its schedule, asking before it acts, and its prompt names a skill that is installed', made !== undefined && made.active === false && made.schedule.cron === '0 18 * * 0' && made.approvals === 'ask' && /study-plan skill/.test(made.prompt) && made.nextRun === null, JSON.stringify(made))
  // « Learn my business »: offered in the same list, ticked, said to propose only; it is the one automation the kit switches ON, weekly, in a session of its own
  const learn = madeTasks.find((t) => t && t.name === 'Learn my business')
  check('Learn my business was made: switched ON, Mondays 07:00, asking first, in a session of its own, from what the person said', learn !== undefined && learn.active === true && learn.schedule.cron === '0 7 * * 1' && learn.approvals === 'ask' && learn.sessionMode === 'home' && learn.origin && learn.origin.recipe === 'learn-my-business' && /svt-lemaire\.example/.test(learn.prompt) && /Education/.test(learn.prompt) && /Goals they wrote in their own words \(no ready-made kit behind them\): Prepare my thesis defence/.test(learn.prompt), JSON.stringify(learn).slice(0, 300))
  check('...and it asks for the two mail apps (Education is not a sensitive field)', learn !== undefined && JSON.stringify(learn.needs) === '["gmail","googlecalendar"]')
  check('and only that one: the kit made no other task', madeTasks.filter((t) => t && /revision|Refresh/i.test(t.name)).length === 1)
  check('and none was written into the project the instance was started in', process.env.KB_WORKTREE === undefined || (!existsSync(join(process.env.KB_WORKTREE, 'kybers/studencik')) && !existsSync(join(process.env.KB_WORKTREE, 'kybers/research-desk'))))
  check('the field, the goals, the display mode, what was said and the agents preset were written to memory, once, pinned', fake.memoryBodies.length === 1 && fake.memoryBodies[0].path === '/kybernos-cloud/memory/add' && fake.memoryBodies[0].body.pinned === true && fake.memoryBodies[0].body.kind === 'fact' && /^Field of work: Education\. Wants help with: Exams, Courses, Prepare my thesis defence\. Prefers: Office mode\. Website: svt-lemaire\.example\. Profile: linkedin\.com\/in\/sofia-lemaire\. In their own words: Years 10 and 11, a quiz every week\. Agents: autonomous/.test(fake.memoryBodies[0].body.content), JSON.stringify(fake.memoryBodies))
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
  check('the memory id is kept in the onboarding file, so the next replay updates it', st6 !== null && st6.memoryId === 'mem_test_1' && st6.profil === 'edu' && JSON.stringify(st6.goals) === JSON.stringify(['exams', 'courses']) && st6.agents === 'auto' && st6.about !== undefined && st6.about !== null && st6.about.site === 'svt-lemaire.example' && st6.about.words === 'Years 10 and 11, a quiz every week.', JSON.stringify(st6))
  const publicState = await q(`fetch('/kybernos/onboarding', { cache: 'no-store' }).then((r) => r.json()).then((j) => ({ agents: j.agents, aboutHere: j.about, ownHere: j.customGoals }))`)
  check('the goal the person wrote is kept in the local onboarding file, and comes back to this page only, never in the public answer', st6 !== null && JSON.stringify(st6.customGoals) === '["Prepare my thesis defence"]', JSON.stringify(st6 && st6.customGoals))
  check('the agents preset is public, and what was said comes back to this page only (the route is served before DSH\'s sign-in)', publicState !== undefined && publicState.agents === 'auto' && publicState.aboutHere !== undefined && publicState.aboutHere.site === 'svt-lemaire.example' && JSON.stringify(publicState.ownHere) === '["Prepare my thesis defence"]')
  const outside = await new Promise((resolve) => import('node:http').then(({ default: http }) => http.get({ host: '127.0.0.1', port: Number(authority.split(':')[1]), path: '/kybernos/onboarding' }, (r) => { let b = ''; r.on('data', (c) => { b += c }); r.on('end', () => resolve(b)) }).on('error', () => resolve('')))).catch(() => '')
  check('a plain request with no origin never gets what was said', !/svt-lemaire|sofia-lemaire|quiz every week|thesis defence/.test(outside), outside.slice(0, 120))
  // the second replay updates the same memory instead of adding another
  fake.memoryBodies.length = 0
  check('a second replay opens', await replay())
  await goEnglish()
  await press('Get started'); await press('Continue'); await press('Continue'); await press('Keep as is')
  check('a replay shows what was said the last time', (await seen('Tell Kaby about you')) !== null && (await q(`document.getElementById('kb-ob-f-site').value`)) === 'svt-lemaire.example' && (await q(`document.getElementById('kb-ob-f-words').value`)) === 'Years 10 and 11, a quiz every week.')
  await press('Continue')
  check('and the agents preset it chose', (await seen('How much can agents do alone?')) !== null && /Autonomous/.test(String(await q(`document.querySelector('.kb-ob-row.on').textContent`))))
  await press('Continue')
  await seen('A starter kit for Education', 8000)
  await q(`document.querySelector('.kb-ob-sumrow').click()`)
  const kitDone = await waitFor(page, `[...document.querySelectorAll('.kb-ob-kit')].some((r) => r.querySelector('b').textContent === 'Refresh my revision plan' && r.classList.contains('done'))`, 30000)
  check('a replay finds the automation, the plugin skill and the teams already made, and ticks only what the person left out (docx)', kitDone !== null && JSON.stringify(await q(`[...document.querySelectorAll('.kb-ob-kit.on b')].map((b) => b.textContent)`)) === JSON.stringify(['docx']) && /^Add 1 selected$/.test(String(await q(`document.querySelector('.kb-ob-primary').textContent`))), String(await q(`[...document.querySelectorAll('.kb-ob-kit')].map((r) => r.querySelector('b').textContent + ':' + r.className).join(' | ')`)))
  await press('Not now')
  await seen('So it keeps running without you', 8000)
  await press('Continue for free')
  await waitFor(page, `!!document.querySelector('.kb-ob-recap')`, 8000)
  for (let i = 0; i < 40 && fake.memoryBodies.length < 1; i += 1) await sleep(250)
  check('and updates that memory', fake.memoryBodies.length === 1 && fake.memoryBodies[0].path === '/kybernos-cloud/memory/update' && fake.memoryBodies[0].body.id === 'mem_test_1', JSON.stringify(fake.memoryBodies))
  // A Change link ends the wizard and opens that area's page of Settings (here Web Search), whatever the language.
  await waitFor(page, `document.querySelectorAll('.kb-ob-setup .kb-ob-srow').length === 5`, 8000)
  const changed = await q(`(() => { const b = document.querySelector('.kb-ob-srow[data-kb-ob-row="ws"] button'); if (!b) return false; b.click(); return true })()`)
  check('Change on the web search row is pressed', changed === true)
  await waitFor(page, `document.querySelector('.kb-ob') === null`, 8000)
  check('the wizard is gone', (await q(`document.querySelector('.kb-ob') === null`)) === true)
  await waitFor(page, `[...document.querySelectorAll('nav button')].some((b) => /web search/i.test(b.textContent))`, 8000)
  const selectedWs = `(() => { const sel = document.querySelector('nav button[aria-current], nav button[aria-selected="true"], nav button[class*="active"], nav button[class*="selected"]'); return sel ? sel.textContent.trim() : null })()`
  await waitFor(page, `${selectedWs} === 'Web Search'`, 10000)
  const landedWs = await q(selectedWs)
  check('it landed on Web Search', landedWs === 'Web Search', JSON.stringify(landedWs))
  // « Continue with Team solo »: the wizard ends as usual, then the account's own view opens (stood in for here: the cloud bundle's view is not the subject)
  check('Replay reopens the wizard for the Team path', await replay())
  await goEnglish()
  await q(`window.__upgradeCalls = 0; window.__KB_UPGRADE__ = { open: () => { window.__upgradeCalls += 1 } }`)
  await press('Get started'); await press('Continue'); await press('Continue'); await press('Keep as is'); await press('Continue'); await press('Continue')
  await seen('A starter kit for Education', 8000)
  await press('Not now')
  await seen('So it keeps running without you', 8000)
  await press('Continue with Team solo')
  check('the Team choice goes to the recap, and nothing is opened yet', (await seen('You’re all set', 8000)) !== null && (await q(`window.__upgradeCalls`)) === 0)
  await press('Open Kybernos')
  check('the account\'s own view (price, secure payment) opens once the wizard is closed', (await waitFor(page, `window.__upgradeCalls === 1 && document.querySelector('.kb-ob') === null`, 8000)) === true)
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
  check('it opens on the saved field, with the goals of that field as ticked chips', (await seen('A starter kit for Education')) !== null && (await q(`document.querySelectorAll('.kb-ob-chips-tight')[1].querySelectorAll('.kb-ob-chip.on').length`)) === 2)
  check('and says that the choice also sets the menu wording', /also sets the wording of the menu/.test(String(await q(`document.querySelector('.kb-ob').innerText`))))
  const onboardingNow = () => { try { return JSON.parse(read('kybernos/onboarding.json')) } catch (e) { return null } }
  const beforeSwitch = onboardingNow()
  check('it can switch to another field', (await press('Finance')) === true && (await seen('A starter kit for Finance')) !== null)
  check('the things to come are listed, greyed', (await q(`[...document.querySelectorAll('.kb-ob-kit.soon b')].map((b) => b.textContent).join()`)) === 'Back-office Finance team')
  for (let i = 0; i < 40 && (onboardingNow() || {}).profil !== 'fin'; i += 1) await sleep(250)
  const afterSwitch = onboardingNow()
  check('the choice is saved at once (field and all its goals), and nothing else of the file moves',
    afterSwitch !== null && afterSwitch.profil === 'fin' && JSON.stringify(afterSwitch.goals) === JSON.stringify(['reconcile', 'closing', 'variances', 'dunning', 'cash']) &&
    ['completed', 'completedAt', 'installedAt', 'uiMode', 'model', 'lang', 'memoryId', 'version'].every((k) => JSON.stringify(afterSwitch[k]) === JSON.stringify(beforeSwitch[k])), JSON.stringify(afterSwitch))
  const menuLabels = () => q(`[...document.querySelectorAll('.kb4-menu .kb4-lab')].map((e) => e.textContent.trim())`)
  const hasLabels = (labels, want) => Array.isArray(labels) && want.every((w) => labels.includes(w))
  check('the menu wording follows without a reload: the finance pack renames the rows', (await waitFor(page, `['Back-office team', 'Statements and reports', 'Closings and reminders'].every((w) => [...document.querySelectorAll('.kb4-menu .kb4-lab')].some((e) => e.textContent.trim() === w))`, 10000)) === true, JSON.stringify(await menuLabels()))
  check('rows the pack leaves alone keep their own words', hasLabels(await menuLabels(), ['Kaby', 'Skills']) || hasLabels(await menuLabels(), ['Kaby', 'Compétences']), JSON.stringify(await menuLabels()))
  await press('Reconciliation')
  for (let i = 0; i < 40 && ((onboardingNow() || {}).goals || []).length !== 4; i += 1) await sleep(250)
  check('a goal unticked is saved too', JSON.stringify((onboardingNow() || {}).goals) === JSON.stringify(['closing', 'variances', 'dunning', 'cash']), JSON.stringify((onboardingNow() || {}).goals))
  check('and the kit follows the goals: no reconciliation skill any more', (await q(`[...document.querySelectorAll('.kb-ob-kit b')].map((b) => b.textContent).includes('reconciliation')`)) === false)
  check('it closes with Close', (await press('Close')) === true && (await q(`document.querySelector('.kb-ob') === null`)) === true)

  /* ── 5e. the packs and the saved choice, from the host ── */
  const packsRes = await q(`fetch('/kybernos/domains', { cache: 'no-store' }).then((r) => r.json()).then((j) => ({ ok: j.ok, ids: (j.packs || []).map((p) => p.id), rejected: j.rejected }))`)
  check('the host serves the nine packs, none rejected', packsRes !== undefined && packsRes.ok === true && JSON.stringify(packsRes.ids) === JSON.stringify(['edu', 'sante', 'immo', 'droit', 'fin', 'com', 'mkt', 'dev', 'general']) && packsRes.rejected === 0, JSON.stringify(packsRes))
  const postDomain = (body) => q(`fetch('/kybernos/onboarding', { method: 'POST', headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }).then((r) => r.status)`)
  const fileBefore = read('kybernos/onboarding.json')
  check('a field no pack ships is refused, and the file is left as it was', (await postDomain({ action: 'domain', profil: 'nope', goals: [] })) === 400 && read('kybernos/onboarding.json') === fileBefore)
  check('goals the pack does not know are dropped', (await postDomain({ action: 'domain', profil: 'sante', goals: ['notes', 'nope', 'appointments', 'closing'] })) === 200 && JSON.stringify((onboardingNow() || {}).goals) === JSON.stringify(['notes', 'appointments']))
  // A file the previous wizard wrote: a profession of the old list, no goals. It reads as the field that claims it.
  writeFileSync(join(dshHome, 'kybernos/onboarding.json'), JSON.stringify({ ...onboardingNow(), profil: 'soft', goals: undefined }))
  const legacy = await q(`fetch('/kybernos/onboarding', { cache: 'no-store' }).then((r) => r.json()).then((j) => ({ completed: j.completed, profil: j.profil, domain: j.domain, goals: j.goals }))`)
  check('a profession of the old list reads as its field, still done, no goals', legacy !== undefined && legacy.completed === true && legacy.profil === 'soft' && legacy.domain === 'dev' && JSON.stringify(legacy.goals) === '[]', JSON.stringify(legacy))
  await backToTheStartingPoint()

  /* ── 5f. the field on the pages: titles, creation tiles, the Skills and Connectors sections ── */
  // The saved field is Law with two goals ticked. Every page must say the word the menu gives its row, the Creations tiles come in the field's order,
  // Skills opens on the field's skills (the ticked goals' first) and Connectors on its apps.
  const reloadField = async () => { await q(`window.dispatchEvent(new CustomEvent('kb-domain-reload'))`); await sleep(1500) }
  const openView = async (arg, ms = 3500) => { await q(`window.__KB_OPEN__(${JSON.stringify(arg)})`); await sleep(ms) }
  const titleNow = () => q(`(document.querySelector('.kb6-title') || {}).textContent || null`)
  const menuLabelOf = (row) => q(`(() => { const rows = [...document.querySelectorAll('.kb4-menu .kb4-item')]; const e = rows[${row}]; return e ? e.querySelector('.kb4-lab').textContent.trim() : null })()`)
  check('Law saved with two goals', (await postDomain({ action: 'domain', profil: 'droit', goals: ['contracts', 'deadlines'] })) === 200)
  await reloadField()
  const pageRows = [['artifacts', { view: 'artifacts' }, 'Deeds and notes'], ['tasks', { view: 'tasks' }, 'Deadlines'], ['dashboards', { view: 'dashboards' }, 'My firm'], ['agent teams', { nav: 'kybers', view: 'gallery', detailPath: null, detailRoot: null }, 'Legal team'], ['workspaces', { view: 'projects' }, 'Workspaces'], ['skills', { view: 'skills' }, 'Skills'], ['connectors', { view: 'connectors' }, 'Connectors']]
  for (const [name, arg, want] of pageRows) {
    await openView(arg)
    const got = await titleNow()
    check('the ' + name + ' page is titled with the menu\'s word: ' + want, got === want && (await q(`[...document.querySelectorAll('.kb4-menu .kb4-lab')].some((e) => e.textContent.trim() === ${JSON.stringify(want)})`)) === true, JSON.stringify(got))
  }
  await openView({ view: 'artifacts' })
  const tileNames = await q(`[...document.querySelectorAll('[data-kb="type-tiles"] .kb-type-lab')].map((e) => e.textContent.trim())`)
  check('the Creations tiles come in the field\'s order: All, Documents, Spreadsheets, then the others as before', JSON.stringify(tileNames) === JSON.stringify(['All', 'Documents', 'Spreadsheets', 'Slides', 'Websites', 'Images', 'Audio & Video']), JSON.stringify(tileNames))
  await page.shot(join(shotDir, 'pages-creations-law.png'))
  await openView({ view: 'skills' })
  const fieldDots = await q(`document.querySelectorAll('[data-kb="field-rows"] [data-kb="field-skill"] .kbsf-fdot').length`)
  const fieldFrame = await q(`!!document.querySelector('.kbsf-field, .kbsf-fhead')`)
  const fieldNames = await q(`[...document.querySelectorAll('[data-kb="field-skill"]')].map((e) => e.getAttribute('data-skill'))`)
  const fieldTags = await q(`[...document.querySelectorAll('[data-kb="field-skill"] .kbsf-tagtx')].map((e) => e.textContent.trim() + (e.classList.contains('on') ? '*' : ''))`)
  check('Skills opens on the Law skills, flat in the list: a dot each, no frame, no title', fieldDots === 6 && fieldFrame === false, JSON.stringify([fieldDots, fieldFrame]))
  check('with the skills of the ticked goals first (marked), then the others of the field, each once', JSON.stringify(fieldNames) === JSON.stringify(['review-contract', 'compliance-check', 'deadline-check', 'case-law-watch', 'xlsx', 'docx']) && JSON.stringify(fieldTags) === JSON.stringify(['Contracts*', 'Contracts*', 'Deadlines*', 'Watch', 'Time', 'Drafting']), JSON.stringify([fieldNames, fieldTags]))
  check('the curated skills carry the page\'s own title, not the folder name', (await q(`[...document.querySelectorAll('[data-skill="docx"] .kbsf-title, [data-skill="xlsx"] .kbsf-title')].map((e) => e.textContent.trim()).join('|')`)) !== 'Xlsx|Docx')
  check('a skill from GitHub asks the usual confirmation before anything is installed', (await q(`(() => { const b = document.querySelector('[data-skill="docx"] [data-kb="pick-install"]'); if (!b) return false; b.click(); return true })()`)) === true && (await waitFor(page, `!!document.querySelector('[data-kb="install-confirm"]') && /anthropics\\/skills/.test(document.querySelector('[data-kb="install-confirm"]').innerText)`, 6000)) === true)
  await q(`(() => { const b = document.querySelector('[data-kb="install-confirm-no"]'); if (b) b.click() })()`)
  await sleep(500)
  await page.shot(join(shotDir, 'pages-skills-law.png'))
  check('a skill that ships with Kybernos installs in one click, with no download', (await q(`(() => { const b = document.querySelector('[data-skill="deadline-check"] [data-kb="pick-install"]'); if (!b) return false; b.click(); return true })()`)) === true &&
    (await waitFor(page, `!!document.querySelector('[data-skill="deadline-check"] [data-kb="pick-use"]')`, 15000)) === true && existsSync(join(dshHome, 'skills', 'deadline-check', 'SKILL.md')))
  try { rmSync(join(dshHome, 'skills', 'deadline-check'), { recursive: true, force: true }) } catch (e) { /* none */ }
  try { const f = join(dshHome, 'kybernos/seeded-skills.json'); if (existsSync(f)) { const j = JSON.parse(readFileSync(f, 'utf8')); if (j && j.skills) { delete j.skills['deadline-check']; writeFileSync(f, JSON.stringify(j, null, 2)) } } } catch (e) { /* none */ }
  await openView({ view: 'connectors' })
  check('Connectors has no « For your field » strip any more: the apps are in the lists', (await q(`!document.querySelector('[data-kb="yours-field"], [data-kb="yours-field-go"]')`)) === true)
  await q(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /^Discover/.test(x.textContent.trim())); if (b) b.click() })()`)
  await waitFor(page, `!!document.querySelector('[data-kb="discover-grid"] .kb7-card')`, 15000)
  const apps = await q(`[...document.querySelectorAll('[data-kb="discover-grid"] .kb7-name')].map((e) => e.textContent.trim())`)
  const appTags = await q(`[...document.querySelectorAll('[data-kb="field-goal"]')].map((e) => e.textContent.trim())`)
  // « Learn my business » (made by the kit above) needs Gmail and Google Calendar: those two lead the list, said to be needed by it; the field's apps follow (they are not shown twice)
  check('Discover starts with the apps an automation needs (Gmail and Google Calendar, for Learn my business), then the field\'s apps in ONE list, each tagged with its goal and a dot, no section title', JSON.stringify(apps.slice(0, 2)) === JSON.stringify(['Gmail', 'Google Calendar']) && /Needed by.*Learn my business/.test(String(await q(`[...document.querySelectorAll('[data-kb="discover-grid"] .kb7-card')].slice(0, 2).map((c) => c.textContent).join(' ')`))) && JSON.stringify(apps.slice(2, 6)) === JSON.stringify(['DocuSign', 'Google Drive', 'Dropbox', 'Outlook']) && JSON.stringify(appTags.slice(0, 6)) === JSON.stringify(['Needed by Learn my business', 'Needed by Learn my business', 'Contracts', 'Contracts', 'Contracts', 'Deadlines']) && (await q(`document.querySelectorAll('.kb7-seclab').length === 0 && document.querySelectorAll('[data-kb="discover-grid"] .kb7-fdot').length >= 4`)) === true, JSON.stringify([apps, appTags]))
  check('an app shown there is not shown again below', (await q(`(() => { const all = [...document.querySelectorAll('[data-kb="discover-grid"] .kb7-name')].map((e) => e.textContent); return all.length - new Set(all).size === 0 && all.length > 0 })()`)) === true)
  await page.shot(join(shotDir, 'pages-connectors-law.png'))
  // French: the page follows the menu there too
  await q(`localStorage.setItem('kybernos.theme.lang', 'kybernos')`)
  await page.send('Page.reload', { ignoreCache: true })
  await waitFor(page, `document.body && document.body.innerText.length > 40`, 30000)
  await sleep(3000)
  for (const [name, arg, want] of [['artifacts', { view: 'artifacts' }, 'Actes et notes'], ['tasks', { view: 'tasks' }, 'Échéances'], ['dashboards', { view: 'dashboards' }, 'Mon cabinet'], ['agent teams', { nav: 'kybers', view: 'gallery', detailPath: null, detailRoot: null }, 'Équipe juridique']]) {
    await openView(arg)
    check('in French the ' + name + ' page is titled ' + want, (await titleNow()) === want)
  }
  await openView({ view: 'skills' })
  check('in French the field skills keep their dot and no title', (await q(`document.querySelectorAll('[data-kb="field-rows"] .kbsf-fdot').length`)) === 6 && (await q(`!document.querySelector('.kbsf-fh')`)) === true)
  await q(`localStorage.removeItem('kybernos.theme.lang')`)
  // No field known (a profession no pack claims): the pages are as they were
  writeFileSync(join(dshHome, 'kybernos/onboarding.json'), JSON.stringify({ ...onboardingNow(), profil: 'unknown-job', goals: [] }))
  await page.send('Page.reload', { ignoreCache: true })
  await waitFor(page, `document.body && document.body.innerText.length > 40`, 30000)
  await sleep(3000)
  await openView({ view: 'artifacts' })
  const plain = await titleNow()
  await openView({ view: 'skills' })
  check('with no field the pages keep their own words and the Skills page has no field rows', plain === 'Creations' && (await q(`!document.querySelector('[data-kb="field-rows"]')`)) === true && (await titleNow()) === 'Skills', JSON.stringify(plain))
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
  try { await live.close() } catch (e) { /* gone */ }
  restoreSandbox()
  await sleep(6000)
  // The host may write the file once more after the page is gone (a request on its way when the browser closed): what is on disk must be the finished first run.
  if (read('kybernos/onboarding.json') !== onboardingBackup) restoreSandbox()
  // The fit report: one line per screen reached. `over` = how far the wizard is taller than the window (it scrolls as a page when > 1), `action` = where the bottom of its main button is.
  const tall = fitLog.filter((m) => m.over > 1 || m.wide > 1 || (m.action !== null && m.action > m.vh))
  console.log('FIT ' + String(fitLog.length) + ' screens at ' + (fitLog[0] ? fitLog[0].vw + 'x' + fitLog[0].vh : '?') + ': ' + (tall.length === 0 ? 'none scrolls' : tall.map((m) => m.screen + ' (over ' + m.over + ', wide ' + m.wide + ', action ' + m.action + '/' + m.vh + ')').join(' | ')))
  verdict() // in the finally: whatever happened above, the run ends with its verdict
}
process.exit(fails === 0 ? 0 : 1)
