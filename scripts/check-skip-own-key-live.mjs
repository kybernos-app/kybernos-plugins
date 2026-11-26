// A person who skips the first-run wizard and brings their own key, in a real GUI, with a loopback stand-in for the provider and the model.
//
//   source scripts/sandbox/env.sh && node scripts/check-skip-own-key-live.mjs --out <folder outside the repository>
//
//   1. the wizard opens on a profile that never finished it; « Skip » closes it, writes « completed », and two reloads later no wizard and no
//      dialog asks for an account (what is left is read: the inline « No model to answer with yet » notice, the sidebar footer, the Cloud Computer tile).
//   2. Settings > AI provider and models > Add provider > Custom API, pointed at a stand-in on this machine's loopback, with a made-up key the
//      stand-in refuses (401): the sheet must say that the key is refused, in words, and name no secret.
//   3. the right key (a made-up one the stand-in accepts) is pasted: the key is accepted, the model is listed, and a message typed in a new chat
//      is answered by the stand-in (scripted text, streamed): « chat works ».
//   4. the local model: Settings > Ollama local models is read (the engine, the models it lists); nothing is pulled or loaded.
//
// Nothing leaves the machine: the provider is a stand-in on 127.0.0.1, the key check never reaches a real provider. SANDBOX ONLY: it rewrites the sandbox's
// onboarding state and adds then deletes one custom provider, and puts both back. Exit 0 = every step held, 1 = one did not, 3 = wrong environment.
import http from 'node:http'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, openSettings } from './live-page.mjs'

const arg = (name, dflt) => { const i = process.argv.indexOf('--' + name); return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : dflt }
const OUT = arg('out', '')
const authority = process.env.KB_HOST || '127.0.0.1:3080'
const dshHome = process.env.DSH_HOME || ''
if (authority === '127.0.0.1:3080') { console.error('refusing to run against :3080'); process.exit(3) }
if (!dshHome.includes('.kybernos-sandbox')) { console.error('DSH_HOME is not a sandbox home: source scripts/sandbox/env.sh'); process.exit(3) }
if (OUT === '' || OUT.includes('/worktrees/')) { console.error('--out <folder outside the repository> is required'); process.exit(2) }
mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const notes = []
const check = (name, ok, detail) => { if (ok === true) { pass += 1; console.log('  ok   ' + name) } else { fail += 1; console.log('  FAIL ' + name + (detail === undefined ? '' : ' | ' + JSON.stringify(detail).slice(0, 400))) } }
const note = (k, v) => { notes.push({ k, v }); console.log('  note ' + k + ': ' + JSON.stringify(v).slice(0, 500)) }

// ── the stand-in provider ──
const GOOD = 'sk-standin-accepted-0001'
const WRONG = 'sk-made-up-refused-0002'
const calls = []
const fake = http.createServer((req, res) => {
  const bearer = String(req.headers.authorization || '')
  const good = bearer === 'Bearer ' + GOOD
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    // what is logged says whether a key was sent and whether it was the good one, never the key itself
    calls.push({ method: req.method, path: req.url, key: bearer === '' ? 'none' : (good ? 'good' : 'wrong') })
    const json = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
    if (req.method === 'GET' && req.url === '/v1/models') { good ? json(200, { object: 'list', data: [{ id: 'standin-model', object: 'model' }] }) : json(401, { error: { message: 'Incorrect API key provided', type: 'invalid_request_error' } }); return }
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      if (!good) { json(401, { error: { message: 'Incorrect API key provided' } }); return }
      let body = {}
      try { body = JSON.parse(raw) } catch (e) { body = {} }
      const text = 'Hello from the stand-in model.'
      if (body.stream === true) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
        const chunk = (delta, finish) => 'data: ' + JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'standin-model', choices: [{ index: 0, delta, finish_reason: finish }] }) + '\n\n'
        res.write(chunk({ role: 'assistant', content: '' }, null))
        for (const w of text.split(' ')) res.write(chunk({ content: w + ' ' }, null))
        res.write(chunk({}, 'stop'))
        res.write('data: ' + JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'standin-model', choices: [], usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 } }) + '\n\n')
        res.end('data: [DONE]\n\n')
      } else json(200, { id: 'c1', object: 'chat.completion', created: 1, model: 'standin-model', choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 } })
      return
    }
    json(404, { error: { message: 'no route' } })
  })
})
await new Promise((r) => fake.listen(0, '127.0.0.1', r))
const fakeUrl = 'http://127.0.0.1:' + fake.address().port + '/v1'

const onboardingFile = join(dshHome, 'kybernos/onboarding.json')
let backup = null
try { backup = readFileSync(onboardingFile, 'utf8') } catch (e) { backup = null }
// choosing the stand-in model in the picker also rewrites the profile's default model: the profile is put back as it was, too
const patchFile = join(dshHome, 'profiles/web/cordis.patch.yml')
let patchBackup = null
try { patchBackup = readFileSync(patchFile, 'utf8') } catch (e) { patchBackup = null }
const restore = () => {
  try { if (backup !== null) writeFileSync(onboardingFile, backup) } catch (e) { /* the sandbox is nobody's */ }
  try { if (patchBackup !== null && readFileSync(patchFile, 'utf8') !== patchBackup) writeFileSync(patchFile, patchBackup) } catch (e) { /* the sandbox is nobody's */ }
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { restore(); process.exit(130) })
writeFileSync(onboardingFile, JSON.stringify({ version: 1, completed: false, installedAt: '2026-01-01T00:00:00.000Z', completedAt: null, profil: null, uiMode: null }) + '\n')

const live = await openLivePage({ keepKeyDialog: true, width: 1440, height: 900 }).catch((e) => { restore(); fake.close(); console.error('inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const val = async (expr, ms) => { const r = await page.evalJs(expr, ms || 8000); return r.err ? { __err: r.err } : r.val }
const shot = async (name) => { try { await page.shot(join(OUT, name + '.png')) } catch (e) { /* no picture */ } }
const poll = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(250) } return null }
const mouse = async (x, y, kinds = ['mouseMoved', 'mousePressed', 'mouseReleased']) => { for (const t of kinds) await page.send('Input.dispatchMouseEvent', { type: t, x, y, button: 'left', clickCount: 1 }) }
const key = async (k, code, vk) => { await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk }); await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk }) }
const center = (sel) => val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) })()`)
const click = async (sel) => { const p = await center(sel); if (typeof p !== 'string') return false; const { x, y } = JSON.parse(p); await mouse(x, y); await sleep(300); return true }
const type = (sel, v) => val(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
const q = (sel) => val(`document.querySelectorAll(${JSON.stringify(sel)}).length`)
const text = (sel) => val(`(document.querySelector(${JSON.stringify(sel)}) || { innerText: '' }).innerText`)
const attr = (sel, a) => val(`(document.querySelector(${JSON.stringify(sel)}) || { getAttribute: () => null }).getAttribute(${JSON.stringify(a)})`)
const CARD = '[data-kbm="prov-card"][data-prov="standin-key"]'

const dropProvider = async () => {
  if ((await q(CARD)) === 0) return true
  if ((await q('[data-kbm="pv-drawer"]')) > 0) { await key('Escape', 'Escape', 27); await sleep(400) }
  if ((await click(CARD + ' [data-kbm="prov-more"]')) !== true || (await poll(() => q('[data-kbm="prov-delete"]'))) === null) return false
  if ((await click('[data-kbm="prov-delete"]')) !== true || (await poll(() => q('[data-kbm="prov-del-type"]'))) === null) return false
  await type('[data-kbm="prov-del-type"]', 'standin-key')
  await sleep(300)
  return (await click('[data-kbm="prov-del-ok"]')) === true && (await poll(() => val(`!document.querySelector('${CARD}')`), 15000)) === true
}
const openProviders = async () => {
  await openSettings(page)
  const went = await val(`(() => { const b = Array.from(document.querySelectorAll('button[class*="navCell"]')).find((x) => x.innerText.trim().split('\\n')[0] === 'AI provider and models'); if (!b) return false; b.click(); return true })()`)
  return went === true && (await poll(() => q('[data-kbm="prov-add"]'))) !== null
}

try {
  console.log('1. Skip')
  await page.send('Page.reload', {})
  const opened = await poll(() => val(`!!document.querySelector('.kb-ob h1')`), 30000)
  check('the wizard opens on a profile that never finished it', opened === true)
  await shot('1-wizard')
  const skip = await center('.kb-ob-skip')
  if (typeof skip === 'string') { const { x, y } = JSON.parse(skip); await mouse(x, y) }
  const closed = await poll(() => val(`!document.querySelector('.kb-ob')`), 8000)
  check('Skip closes the wizard', closed === true)
  // the wizard leaves at once and the host writes the answer a moment later: read the file until it says so
  let st = JSON.parse(readFileSync(onboardingFile, 'utf8'))
  for (let i = 0; i < 20 && st.completed !== true; i += 1) { await sleep(300); st = JSON.parse(readFileSync(onboardingFile, 'utf8')) }
  check('and the first run is recorded as done, with no answers', st.completed === true && st.model === null && st.goals.length === 0, { completed: st.completed, model: st.model, goals: st.goals })
  const reads = []
  for (let i = 1; i <= 3; i += 1) {
    await page.send('Page.reload', {})
    await sleep(5500)
    reads.push(await val(`(() => {
      const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
      const modals = Array.from(document.querySelectorAll('[role=dialog], [aria-modal=true], .kb-ob')).filter(vis).map((e) => (e.getAttribute('aria-label') || e.innerText || '').trim().slice(0, 60))
      const notice = Array.from(document.querySelectorAll('*')).filter((e) => e.children.length < 6 && /No model to answer with yet/.test(e.innerText || '') && vis(e)).length > 0
      const signIns = Array.from(document.querySelectorAll('button')).filter((b) => /^(sign in|sign up)/i.test(b.innerText.trim()) && vis(b)).map((b) => b.innerText.trim().split('\\n')[0])
      return { modals, notice, signIns }
    })()`))
  }
  check('three reloads later: no wizard and no dialog asks for an account', reads.every((r) => r.modals.length === 0), reads.map((r) => r.modals))
  note('what stays on the new-chat page after Skip (3 reloads)', reads[2])
  await shot('2-after-skip-reload')

  console.log('2. A made-up key')
  check('Settings > AI provider and models opens', await openProviders() === true)
  await sleep(600)
  await dropProvider()
  check('Add provider opens the drawer', (await click('[data-kbm="prov-add"]')) === true && (await poll(() => q('[data-kbm="pv-drawer"]'))) !== null)
  const presets = await val(`Array.from(document.querySelectorAll('[data-kbm="pv-drawer"] [data-kbm^="prov-mode"], [data-kbm="pv-drawer"] [role=tab]')).map((e) => e.innerText.trim()).filter(Boolean)`)
  note('the drawer\'s tabs', presets)
  check('the Custom API tab opens', (await click('[data-kbm="prov-mode-perso"]')) === true && (await poll(() => q('#pv-slug'))) !== null)
  await type('#pv-slug', 'standin-key')
  await type('#pv-name', 'Stand-in')
  await type('#pv-url', fakeUrl)
  await type('#pv-key', WRONG)
  await sleep(2500)
  const ckBefore = await text('[data-kbm="pv-ck"]')
  note('the drawer before creating, with the made-up key typed (key line)', ckBefore)
  await shot('3-add-wrong-key')
  await click('[data-kbm="pv-model-add"]')
  await type('[data-kbm="pv-model-row"] input', 'standin-model')
  await sleep(300)
  check('Create provider creates it', (await click('[data-kbm="prov-ok"]')) === true && (await poll(() => val(`!!document.querySelector('${CARD}')`), 15000)) === true)
  await sleep(800)
  check('a click on the card opens its sheet', (await click(CARD + ' [data-kbm="prov-voir"]')) === true && (await poll(() => q('[data-kbm="pv-drawer"]'))) !== null)
  const refused = await poll(async () => (await attr('[data-kbm="pv-ck"]', 'data-kbm-state')) === 'refused', 15000)
  const refusedLine = await text('[data-kbm="pv-ck"]')
  check('the sheet says the key is refused', refused === true, { state: await attr('[data-kbm="pv-ck"]', 'data-kbm-state'), line: refusedLine })
  note('the refusal as the person reads it', refusedLine)
  check('the line holds no secret', !refusedLine.includes(WRONG) && !refusedLine.includes(GOOD))
  const apply1 = (await text('[data-kbm="pv-apply"]')).trim()
  note('the button while the key is refused', apply1)
  await shot('4-refused-sheet')
  const sawWrong = calls.some((c) => c.key === 'wrong')
  check('only the stand-in on this machine was asked about the made-up key', sawWrong === true && calls.every((c) => c.path.startsWith('/v1/')), calls.slice(0, 6))

  console.log('3. The key it accepts, and a chat')
  await type('#pv-key', GOOD)
  const okState = await poll(async () => (await attr('[data-kbm="pv-ck"]', 'data-kbm-state')) === 'ok', 15000)
  check('a key the provider accepts is connected', okState === true, await text('[data-kbm="pv-ck"]'))
  note('the accepted line', await text('[data-kbm="pv-ck"]'))
  check('Apply writes and closes the sheet', (await click('[data-kbm="pv-apply"]')) === true && (await poll(() => val(`!document.querySelector('[data-kbm="pv-drawer"]')`), 15000)) === true)
  await sleep(1500)
  await page.send('Page.reload', {})
  await sleep(6000)
  const picked = await val(`(() => { const b = document.querySelector('button[aria-label^="Select model"]'); if (!b) return null; b.click(); return b.getAttribute('aria-label') })()`)
  note('the model button before the choice', picked)
  await sleep(900)
  const items = await val(`Array.from(document.querySelectorAll('[role=option], [role=menuitem], [role=menuitemradio], [data-radix-collection-item]')).map((e) => e.innerText.trim().replace(/\\s+/g, ' ')).filter(Boolean).slice(0, 40)`)
  note('the model picker lists', items)
  await shot('5-model-picker')
  const chose = await val(`(() => { const e = Array.from(document.querySelectorAll('*')).find((x) => (x.innerText || '').trim() === 'standin-model' && x.children.length === 0 && x.getBoundingClientRect().width > 0); if (!e) return false; const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) })()`)
  if (typeof chose === 'string') { const { x, y } = JSON.parse(chose); await mouse(x, y); await sleep(1200) }
  const label = await val(`(document.querySelector('button[aria-label^="Select model"]') || { getAttribute: () => null }).getAttribute('aria-label')`)
  note('the model button after the choice', label)
  check('the stand-in model is in the picker, can be chosen, and the composer then names it', typeof chose === 'string' && /standin-model/.test(String(label)), label)
  // the composer takes no first message until a workspace is chosen
  const composer = await val(`(() => { const t = document.querySelector('textarea, [contenteditable="true"], [role="textbox"]'); if (!t) return null; t.focus(); const r = t.getBoundingClientRect(); return JSON.stringify({ x: r.left + 40, y: r.top + 20 }) })()`)
  if (typeof composer === 'string') { const { x, y } = JSON.parse(composer); await mouse(x, y); await sleep(300) }
  await page.send('Input.insertText', { text: 'Say hello in one short sentence.' })
  await sleep(400)
  await shot('6-typed')
  await key('Enter', 'Enter', 13)
  const answered = await poll(() => val(`/Hello from the stand-in model/.test(document.body.innerText)`), 40000)
  check('a message is answered by the stand-in model (chat works with an own key)', answered === true, await val(`document.body.innerText.slice(-300)`))
  const chatCalls = calls.filter((c) => c.method === 'POST' && c.path === '/v1/chat/completions')
  check('the stand-in saw the chat request with the good key', chatCalls.some((c) => c.key === 'good'), chatCalls)
  await shot('7-answered')
  note('the account prompts still on screen after a working chat', await val(`Array.from(document.querySelectorAll('button')).filter((b) => /sign in|sign up/i.test(b.innerText) && b.getBoundingClientRect().width > 0).map((b) => b.innerText.trim().split('\\n')[0])`))

  console.log('4. The local model (read only)')
  check('Settings > Ollama local models opens', await (async () => { await openSettings(page); const w = await val(`(() => { const b = Array.from(document.querySelectorAll('button[class*="navCell"]')).find((x) => x.innerText.trim().split('\\n')[0] === 'Ollama local models'); if (!b) return false; b.click(); return true })()`); await sleep(2500); return w === true })())
  const local = await val(`document.body.innerText.replace(/\\s+/g, ' ').slice(0, 1600)`)
  note('the Ollama page, first 1600 characters', local)
  await shot('8-ollama-page')
} catch (e) {
  fail += 1
  console.log('  FAIL the run stopped: ' + (e && e.stack ? e.stack : e))
} finally {
  try { await key('Escape', 'Escape', 27) } catch (e) { /* closed */ }
  try { await openProviders(); await dropProvider() } catch (e) { /* gone */ }
  restore()
  writeFileSync(join(OUT, 'skip-own-key.json'), JSON.stringify({ pass, fail, notes, standinCalls: calls }, null, 1))
  await live.close()
  fake.close()
}
console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + ', ' + pass + ' passed')
process.exit(fail === 0 ? 0 : 1)
