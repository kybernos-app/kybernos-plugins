#!/usr/bin/env node
// Kaby mode (« Simple ») on the engine the phone ships (0.2.1-rc.2), from the payload the app builds, at the size of a phone (390 x 844).
//
//   node scripts/check-kaby-mode-engine.mjs --payload <payload dir> --out <evidence dir> [--cloud-key] [--simple | --blank | --plus | --picker | --pick-phone | --pick-phone-first | --default-phone | --stub-reminder | --light-reminder]
//
// check-kaby-mode-live.mjs plays the mode on the sandbox (0.2.2-rc.1); this one plays it on the phone's own engine, with the phone's model behind a FAKE app server (the OpenAI subset the
// phone app serves, `tools: true`), the way check-phone-model-chat.mjs boots it (bootstrap.mjs, a throw-away folder, the egress spy: nothing leaves the machine). Without `--cloud-key` the
// engine has only the phone's model (a phone that never signed in); with it, a canary Claude key makes Claude the default model first (a signed-in phone).
// What it reports (it never fails on a finding: a finding is the answer):
//   1. every selector of KABY_HIDE and every hook of KABY_SHOW: how many elements it matches in the page and how many are DRAWN, on the new-chat page of the full app and in Kaby mode;
//   2. what Kaby mode opens (the session, its model, its preset) and what the model is sent for a first message: the model, the number of tools, the size of the system text;
//   3. screenshots in light and dark, for LOOKING at.
// A `check-*` script (needs a headless Chrome): CI does not run it. It never touches the real DSH.
import crypto from 'node:crypto'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { openGui, sleep } from './lib-e2e-gui.mjs'
import { chooseWorkspace } from './live-page.mjs'
import { KABY_CLASS, KABY_HIDE, KABY_SHOW } from '../packages/kybernos-mobile/kaby-mode.mjs'
import { roughTokens } from '../packages/kybernos-phone-model/phone-model.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null)
const PAYLOAD = flag('--payload') || process.env.KB_PAYLOAD_DIR || null
const OUT = flag('--out')
const CLOUD_KEY = args.includes('--cloud-key')
const LIGHT = args.includes('--light-reminder') // with --pick-phone-first: the phone model's own chat (the light agent) is asked for a reminder: its time guard and its card must come before the core plugin's
const DEFAULT_PHONE = args.includes('--default-phone') // the phone's model is the engine's default for a new chat (the model picker of rc.5 is not driven by this script): does the first message reach it?
const SIMPLE = args.includes('--simple') // only the Simple items (step 6: the chip that said who answers is deleted, so its probe now answers `null`; the real picker is the check), the phone model chosen when nothing else can answer, the phone's own drawer and the real pages its rows open, the switch line on « The Kybernos app » page
const BLANK = args.includes('--blank') // S0 of the signed-out phone (read-only proof): a BLANK profile (no onboarding.json, no account) in Kaby mode: does the first-run wizard (« Which models should Kybernos use? ») open, is the phone's model the one that answers, does anything leave the machine; then the file the native app would write (`completed: true, model: "local"`) is put where the app puts it and the page is opened again
const PLUS = args.includes('--plus') // only the composer's « + » sheet, in the full app and in Kaby mode: which rows does it list, which are drawn
const PICKER = args.includes('--picker') // only the model picker of the full app at 390 px: open it, look at its layers, search, pick the phone's model, send (no other section runs)
const PICK_FIRST = args.includes('--pick-phone-first') // choose the phone's model in the FULL app first (a blank chat), then switch to Kaby mode: does Kaby's chat inherit it?
const STUB = args.includes('--stub-reminder') // a stand-in « cloud » model is the engine's default and asks for a reminder: does a card come, in the full app and in Kaby mode?
const PICK_PHONE = args.includes('--pick-phone') // lift Kaby mode for a moment and choose the phone's model for the chat (the picker is hidden in Kaby mode)
if (PAYLOAD === null || OUT === null || !existsSync(join(PAYLOAD, 'payload.kbpack')) || !existsSync(join(PAYLOAD, 'bootstrap.mjs'))) { console.error('usage: --payload <payload dir built by payload/build-payload.mjs> --out <evidence dir> [--cloud-key] [--pick-phone | --pick-phone-first | --default-phone | --stub-reminder | --light-reminder]'); process.exit(3) }
mkdirSync(join(OUT, 'shots'), { recursive: true })

const FULL_UA = 'Mozilla/5.0 (Linux; Android 16; Redmi) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 KybernosHost/0.1.0 (android)'
const KABY_UA = FULL_UA + ' KabyMode/1'
const report = { when: new Date().toISOString(), cloudKey: CLOUD_KEY, engine: null, hide: [], show: [], opened: {}, request: null, notes: [] }
const say = (s) => console.log(s)
const note = (k, v) => { report.notes.push({ k, v }); say('  ○ ' + k + ': ' + JSON.stringify(v).slice(0, 400)) }

// ── the fake app server: the phone app's loopback server, the OpenAI subset ─────────────────────────────────────────────────────────
const KEY = crypto.randomBytes(32).toString('base64url')
const MODEL = { id: 'qwen3-1.7b-q4_k_m', object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'kybernos-phone', name: 'Qwen3 1.7B', bytes: 1107409472, context: 4096, tools: true }
const seen = []
const toolResults = [] // the text of every tool result a model was sent back
const remindRequests = [] // the messages of every request that carries a reminder ask: role and first words, to see what the engine hands a guard
const tomorrow9 = (() => { const d = new Date(Date.now() + 86400000); const z = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()) + 'T09:00' })()
const sse = (res, data) => res.write('data: ' + (typeof data === 'string' ? data : JSON.stringify(data)) + '\n\n')
const server = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    let body = null
    try { body = raw === '' ? null : JSON.parse(raw) } catch (e) { body = null }
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body })
    if (req.headers.authorization !== 'Bearer ' + KEY) { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"error":{"message":"Wrong key"}}'); return }
    if (req.method === 'GET' && req.url === '/v1/models') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ object: 'list', data: [MODEL] })); return }
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      const msgs = body !== null && Array.isArray(body.messages) ? body.messages : []
      const last = msgs.length > 0 ? msgs[msgs.length - 1] : null
      const lastText = last === null ? '' : (typeof last.content === 'string' ? last.content : JSON.stringify(last.content))
      if (last !== null && last.role === 'tool') toolResults.push(lastText.slice(0, 300))
      if (msgs.some((m) => m.role === 'user' && /Remind me/.test(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))) remindRequests.push(msgs.map((m) => m.role + ': ' + (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).slice(0, 140)))
      // the person's last words that no assistant or tool message has answered yet: 0.2.2-rc.5 puts the engine's own « runtime context » message AFTER the person's, so « the last message » is not theirs there
      const unanswered = (re) => { for (let i = msgs.length - 1; i >= 0; i -= 1) { const m = msgs[i]; if (m.role === 'assistant' || m.role === 'tool') return false; if (m.role === 'user' && re.test(typeof m.content === 'string' ? m.content : JSON.stringify(m.content))) return true } return false }
      if (((STUB && body !== null && body.model === 'stub-1') || (LIGHT && body !== null && body.model === MODEL.id)) && unanswered(/Remind me/) && Array.isArray(body.tools) && body.tools.some((t) => t.function && t.function.name === 'automation_remind')) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
        const tc = (delta, finish, extra) => ({ id: 'chatcmpl-stub', object: 'chat.completion.chunk', created: 1, model: 'stub-1', choices: [{ index: 0, delta, finish_reason: finish || null }], ...(extra || {}) })
        sse(res, tc({ role: 'assistant', content: null, tool_calls: [{ index: 0, id: 'call_remind', type: 'function', function: { name: 'automation_remind', arguments: '' } }] }))
        sse(res, tc({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ message: 'Remind the person to call the plumber.', at: tomorrow9 }) } }] }))
        sse(res, tc({}, 'tool_calls', { usage: { prompt_tokens: 600, completion_tokens: 30, total_tokens: 630 } }))
        sse(res, '[DONE]'); res.end(); return
      }
      if (STUB && body !== null && body.model === 'stub-1' && unanswered(/Remember that/) && Array.isArray(body.tools) && body.tools.some((t) => t.function && t.function.name === 'memory_suggest')) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
        const tc = (delta, finish, extra) => ({ id: 'chatcmpl-stub-m', object: 'chat.completion.chunk', created: 1, model: 'stub-1', choices: [{ index: 0, delta, finish_reason: finish || null }], ...(extra || {}) })
        sse(res, tc({ role: 'assistant', content: null, tool_calls: [{ index: 0, id: 'call_mem', type: 'function', function: { name: 'memory_suggest', arguments: '' } }] }))
        sse(res, tc({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ text: 'Prefers meetings in the morning.', n: 4, span: '30 days', where: 'chat' }) } }] }))
        sse(res, tc({}, 'tool_calls', { usage: { prompt_tokens: 600, completion_tokens: 30, total_tokens: 630 } }))
        sse(res, '[DONE]'); res.end(); return
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      const chunk = (delta, finish, extra) => ({ id: 'chatcmpl-fake', object: 'chat.completion.chunk', created: 1, model: body !== null ? body.model : MODEL.id, choices: [{ index: 0, delta, finish_reason: finish || null }], ...(extra || {}) })
      sse(res, chunk({ role: 'assistant', content: '' }))
      for (const [i, w] of ['Hello', ' from', ' the small', ' model', ' on this phone.'].entries()) setTimeout(() => sse(res, chunk({ content: w })), 30 * (i + 1))
      setTimeout(() => { sse(res, chunk({}, 'stop', { usage: { prompt_tokens: 60, completion_tokens: 8, total_tokens: 68 } })); sse(res, '[DONE]'); res.end() }, 260)
      return
    }
    res.writeHead(404, { 'content-type': 'application/json' }); res.end('{}')
  })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const PORT = server.address().port

// ── the engine the phone ships, booted the way the app boots it ─────────────────────────────────────────────────────────────────────────
const manifest = JSON.parse(readFileSync(join(PAYLOAD, 'payload.json'), 'utf8'))
report.engine = manifest.engine
say('starting the payload engine ' + manifest.engine + (CLOUD_KEY ? ' with a canary cloud key' : ' with the phone model only') + ' (the first unpack takes a couple of minutes)')
const work = realpathSync(mkdtempSync(join(tmpdir(), 'kb-kaby-engine-')))
const home = join(work, 'home')
mkdirSync(join(home, '.dsh', 'profiles', 'web'), { recursive: true })
mkdirSync(join(work, 'ws'), { recursive: true })
mkdirSync(join(home, '.dsh', 'kybernos'), { recursive: true })
if (!BLANK) writeFileSync(join(home, '.dsh', 'kybernos', 'onboarding.json'), '{"version":1,"completed":true,"installedAt":"2026-01-01T00:00:00.000Z","completedAt":"2026-01-01T00:00:00.000Z","profil":"produit","uiMode":null}\n')
const env = { ...process.env, KB_PAYLOAD: join(PAYLOAD, 'payload.kbpack'), KB_MANIFEST: join(PAYLOAD, 'payload.json'), KB_ROOT: join(work, 'runtime'), KB_HOME: home, KB_WORKSPACE: join(work, 'ws'), KB_PORT: '0',
  KB_LOCAL_LLM_URL: 'http://127.0.0.1:' + PORT + '/v1', KB_LOCAL_LLM_KEY: KEY, KB_LOCAL_LLM_CONTEXT: '4096', KB_LOCAL_LLM_MAX_TOKENS: '1024', KB_LOCAL_LLM_ANY_PLATFORM: '1',
  KB_EGRESS_LOG: join(work, 'egress.jsonl') }
delete env.KB_HOST
if (DEFAULT_PHONE && !STUB) {
  writeFileSync(join(home, '.dsh', 'profiles', 'web', 'cordis.patch.yml'), '- id: agent-default-model\n  config:\n    provider: phone-local\n    model: ' + MODEL.id + '\n')
}
if (STUB) {
  // the phone's user layer, written before the first boot (the seed leaves a layer that has entries alone): a stand-in model, named by the default-model row
  writeFileSync(join(home, '.dsh', 'profiles', 'web', 'cordis.patch.yml'), '- id: agent-default-model\n  config:\n    provider: kbstub\n    model: stub-1\n- id: llm-pi-ai\n  config:\n    providers:\n      kbstub:\n        displayName: Stub\n        api: openai-completions\n        baseURL: http://127.0.0.1:' + PORT + '/v1\n        apiKeyEnv: KB_STUB_KEY\n        models:\n          - id: stub-1\n            name: Stub\n            contextWindow: 200000\n            maxTokens: 4096\n            input:\n              - text\n')
  env.KB_STUB_KEY = KEY
}
delete env.ANTHROPIC_API_KEY
if (CLOUD_KEY) env.ANTHROPIC_API_KEY = 'sk-ant-canary-' + crypto.randomBytes(8).toString('hex')
env.NODE_OPTIONS = ((env.NODE_OPTIONS || '') + ' --import ' + pathToFileURL(join(HERE, 'lib-egress-spy.mjs')).href).trim()
let out = ''
const child = spawn(process.execPath, ['--expose-internals', join(PAYLOAD, 'bootstrap.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
child.stdout.on('data', (d) => { out += d }); child.stderr.on('data', (d) => { out += d })
const stop = () => {
  try { process.kill(-child.pid, 'SIGKILL') } catch (e) { try { child.kill('SIGKILL') } catch (e2) { /* gone */ } }
  try { rmSync(work, { recursive: true, force: true, maxRetries: 3 }) } catch (e) { /* left in the temporary folder */ }
}
process.on('exit', stop)
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130))
let address = null
for (let i = 0; i < 480 && address === null; i += 1) { const m = /dsh web: (http:\/\/127\.0\.0\.1:(\d+)\/)/.exec(out); if (m !== null) address = m; else await sleep(500) }
if (address === null) { console.error('the payload engine did not print its address:\n' + out.split('\n').filter((l) => !/^\s+at /.test(l)).slice(-12).join('\n')); stop(); server.close(); process.exit(1) }
process.env.KB_HOST = '127.0.0.1:' + address[2]
process.env.DSH_HOME = join(home, '.dsh')
await sleep(4000)
say('   engine ' + manifest.engine + ' on ' + process.env.KB_HOST)

// ── the page, as the app's WebView would show it ────────────────────────────────────────────────────────────────────────────────────────
const g = await openGui(process.env.KB_HOST, { width: 390, height: 844 })
const val = (js) => g.val(js)
const shot = async (name) => { try { await g.shot(join(OUT, 'shots', name + '.png')) } catch (e) { /* no shot */ } }
const SHELL_JS = 'window.__kbOut = []; window.ReactNativeWebView = { postMessage: function (s) { try { window.__kbOut.push(JSON.parse(s)) } catch (e) { window.__kbOut.push({ raw: String(s) }) } } };'
let shellScript = null
const open = async ({ ua, dark }) => {
  await val(`(() => { try { const k = 'kybernos.theme.v1'; const v = JSON.parse(localStorage.getItem(k) || '{}'); v.mode = ${dark ? "'dark'" : "'light'"}; localStorage.setItem(k, JSON.stringify(v)) } catch (e) { /* no storage */ } })()`)
  const send = (m, p) => g.page.send(m, p)
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await send('Emulation.setTouchEmulationEnabled', { enabled: true })
  await send('Emulation.setUserAgentOverride', { userAgent: ua, platform: 'Linux armv81' })
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] })
  if (shellScript !== null) { try { await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: shellScript }) } catch (e) { /* gone */ } shellScript = null }
  const r = await send('Page.addScriptToEvaluateOnNewDocument', { source: SHELL_JS }); shellScript = r && r.identifier ? r.identifier : null
  await val('window.__kbStale = true')
  await send('Page.reload', { ignoreCache: true })
  await g.waitFor("window.__kbStale === undefined && document.readyState === 'complete'", 30000)
  await sleep(2500)
  if ((await val(`document.body.innerText.includes('Preview Notice')`)) === true) { await g.pressText('Continue'); await sleep(800) }
  if ((await val(`document.body.innerText.includes('Choose a workspace to start')`)) === true) say('   workspace chosen: ' + await chooseWorkspace(g.page))
}
const DRAWN_JS = `const drawn = (e) => { if (!e || !e.isConnected) return false; const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden') return false; if (s.display === 'contents') return Array.from(e.children).some(drawn); if (typeof e.checkVisibility === 'function' && !e.checkVisibility({ visibilityProperty: true })) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 };`
/** How many elements the selector matches in the page, and how many of them are drawn. A selector the engine rejects (a `:has` it does not know) says so. */
const count = (sel) => val(`(() => { ${DRAWN_JS} try { const all = Array.from(document.querySelectorAll(${JSON.stringify(sel)})); const holds = all.filter((e) => e.querySelector('[data-composer-input], [contenteditable="true"], [data-slot="conversation.composer.bar"]') !== null).length; return { total: all.length, drawn: all.filter(drawn).length, holdsComposer: holds } } catch (e) { return { error: String(e.message || e) } } })()`)
const sweep = async (label) => {
  const rows = []
  for (const row of KABY_HIDE) for (const css of row.css) rows.push({ kind: 'hide', id: row.id, css, ...(await count(css)), when: label })
  for (const row of KABY_SHOW) rows.push({ kind: 'show', id: row.id, css: row.probe, ...(await count(row.probe)), when: label })
  return rows
}
const visibleText = async () => String(await val(`(() => { ${DRAWN_JS} return Array.from(document.querySelectorAll('button, a, [role="button"], h1, h2, h3, p, label')).filter(drawn).map((e) => (e.innerText || e.getAttribute('aria-label') || '').trim()).filter((t) => t !== '' && t.length < 80).slice(0, 60).join(' | ') })()`))
const edge = () => val(`(() => { const el = document.elementFromPoint(window.innerWidth - 5, 400); const d = document.documentElement; return { doc: d.scrollWidth, client: d.clientWidth, view: window.innerWidth, at: el ? { tag: el.tagName, slot: el.getAttribute('data-slot'), kb: el.getAttribute('data-kb'), cls: String(el.className).slice(0, 60), scrollbar: el.offsetWidth - el.clientWidth, overflowY: getComputedStyle(el).overflowY, bg: getComputedStyle(el).backgroundColor, left: Math.round(el.getBoundingClientRect().left), width: Math.round(el.getBoundingClientRect().width) } : null } })()`)
const probe = () => val('JSON.stringify(window.__KB_PHONE_MODEL__ ? { tools: window.__KB_PHONE_MODEL__.tools, preset: window.__KB_PHONE_MODEL__.preset, decided: window.__KB_PHONE_MODEL__.decided, seen: window.__KB_PHONE_MODEL__.seen } : null)')

// ── the model picker of the full app, as the phone shows it ─────────────────────────────────────────────────────────
// What it answers: is the sheet that opens on the model chip live (not under a scrim, takes a tap on its search field, lists the phone's model, takes the choice), and which rule of OUR style sheets
// (the `<style data-plugin>` of the bundles) matches one of its layers. Layers = every fixed or dialog element that is big enough to cover the page, with what decides who is on top.
const LAYERS_JS = `(() => {
  const vw = window.innerWidth, vh = window.innerHeight
  const rows = []
  for (const e of Array.from(document.querySelectorAll('body *'))) {
    const s = getComputedStyle(e); const r = e.getBoundingClientRect()
    const dialog = e.getAttribute('role') === 'dialog' || /sheet|drawer|overlay|scrim|backdrop|popover|modal/i.test((e.getAttribute('data-slot') || '') + ' ' + (e.getAttribute('data-state') || '') + ' ' + String(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className))
    const big = (s.position === 'fixed' || s.position === 'absolute') && r.width >= vw * 0.6 && r.height >= vh * 0.25
    if (!(dialog || big) || r.width < 4 || r.height < 4 || s.display === 'none') continue
    rows.push({ tag: e.tagName, slot: e.getAttribute('data-slot'), kb: e.getAttribute('data-kb'), role: e.getAttribute('role'), state: e.getAttribute('data-state'), cls: String(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className).slice(0, 70), pos: s.position, z: s.zIndex, op: s.opacity, pe: s.pointerEvents, bg: s.backgroundColor, filter: s.filter, bf: s.backdropFilter, vis: s.visibility, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), kids: e.children.length })
  }
  return rows.slice(0, 40)
})()`
// the rules of the bundles' own style sheets that match a layer (a layer = same test as above), with their declarations
const OURS_JS = `(() => {
  const vw = window.innerWidth, vh = window.innerHeight
  const layers = Array.from(document.querySelectorAll('body *')).filter((e) => { const s = getComputedStyle(e); const r = e.getBoundingClientRect(); const dialog = e.getAttribute('role') === 'dialog' || /sheet|drawer|overlay|scrim|backdrop|popover|modal/i.test((e.getAttribute('data-slot') || '') + ' ' + String(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className)); return (dialog || ((s.position === 'fixed' || s.position === 'absolute') && r.width >= vw * 0.6 && r.height >= vh * 0.25)) && r.width > 4 && r.height > 4 && s.display !== 'none' })
  const hits = []; const sheets = []
  const walk = (rules, owner, cond) => { for (const r of Array.from(rules)) {
    if (r.cssRules && !r.selectorText) { walk(r.cssRules, owner, cond + (r.conditionText ? ' @' + r.conditionText : '')); continue }
    if (!r.selectorText) continue
    const hit = layers.filter((e) => { try { return e.matches(r.selectorText) } catch (x) { return false } })
    if (hit.length > 0) hits.push({ owner, cond, sel: r.selectorText.slice(0, 200), css: r.style.cssText.slice(0, 200), on: hit.slice(0, 3).map((e) => e.tagName + '[' + (e.getAttribute('data-slot') || e.getAttribute('data-kb') || '') + ']') })
  } }
  for (const sh of Array.from(document.styleSheets)) {
    const n = sh.ownerNode; const owner = n ? (n.getAttribute('data-plugin') || n.getAttribute('data-kb-style') || n.id || (n.tagName === 'LINK' ? 'link:' + String(n.href).slice(-30) : 'style')) : 'sheet'
    if (!/kybernos|local|kb|kaby|phone|mobile/i.test(owner)) continue
    sheets.push(owner)
    try { walk(sh.cssRules, owner, '') } catch (x) { /* cross-origin */ }
  }
  return { sheets: Array.from(new Set(sheets)), hits: hits.slice(0, 40), layers: layers.length }
})()`
// ── the composer's « + » sheet, as the phone shows it ───────────────────────────────────────────────────────────────
// A sheet the engine portals out of the page's boxes is out of reach of a rule that hides by container: this lists what it holds, row by row, in the full app and in Kaby mode.
const plusSection = async () => {
  const send = (m, p) => g.page.send(m, p)
  const touch = async (x, y) => { await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(60); await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }) }
  const BUTTONS_JS = `(() => { ${DRAWN_JS} const bar = document.querySelector('[data-slot="conversation.composer.bar"]') || document.body; return Array.from(bar.querySelectorAll('button')).filter(drawn).map((b) => { const r = b.getBoundingClientRect(); const ic = b.querySelector('svg'); return { label: b.getAttribute('aria-label'), icon: ic ? ic.getAttribute('data-icon') : null, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } }) })()`
  // every open menu or dialog that is drawn, what is in it, row by row, and where it sits in the page (the part of the path that names a slot says which hide rule could reach it)
  const SHEET_JS = `(() => { ${DRAWN_JS} const sheets = Array.from(document.querySelectorAll('[role="menu"], [role="dialog"], [role="listbox"]')).filter((e) => drawn(e) && (e.innerText || '').trim().length > 0 && e.getBoundingClientRect().width > 100 && e.getBoundingClientRect().x >= 0); const path = (e) => { const out = []; for (let n = e; n && n !== document.body; n = n.parentElement) out.push(n.tagName.toLowerCase() + (n.getAttribute('data-slot') ? '[' + n.getAttribute('data-slot') + ']' : '') + (n.getAttribute('role') ? '{' + n.getAttribute('role') + '}' : '') + (n.className && typeof n.className === 'string' ? '.' + n.className.split(' ')[0] : '')); return out.slice(0, 7).join(' < ') }; return sheets.slice(-3).map((e) => ({ path: path(e), text: (e.innerText || '').replace(/\\n+/g, ' | ').slice(0, 600), rows: Array.from(e.querySelectorAll('button, [role="menuitem"], [role="option"], a')).filter(drawn).map((r) => ({ role: r.getAttribute('role'), slot: r.getAttribute('data-slot'), kb: r.getAttribute('data-kb'), text: (r.innerText || '').replace(/\\n+/g, ' / ').trim().slice(0, 90) })).slice(0, 24) })) })()`
  const openPlus = async (R, name) => {
    const buttons = await val(BUTTONS_JS)
    const plus = Array.isArray(buttons) ? buttons.find((b) => /plus/i.test(b.icon || '') || /Add files or run commands/i.test(b.label || '')) : undefined
    if (plus === undefined) { say('  [' + name + '] no « + » button: ' + JSON.stringify(buttons).slice(0, 300)); return false }
    await touch(plus.x, plus.y)
    await sleep(1500)
    const sheets = await val(SHEET_JS)
    const scrim = await val(`(() => { const s = document.querySelector('.kbmob-scrim'); return !!s && s.hasAttribute('data-on') })()`)
    R[name] = { scrim, sheets }
    await shot('plus-' + name)
    say('  [' + name + '] scrim: ' + scrim + ', sheets drawn: ' + (Array.isArray(sheets) ? sheets.length : JSON.stringify(sheets)))
    if (Array.isArray(sheets)) for (const sh of sheets) { say('    ' + sh.path + '\n      text: ' + sh.text); for (const r of sh.rows) say('      row: ' + JSON.stringify(r)) }
    return true
  }
  for (const [label, ua] of [['full', FULL_UA], ['kaby', KABY_UA]]) {
    say('\n── + (' + label + ') ──')
    await open({ ua, dark: false })
    await g.waitFor(`document.querySelector('[data-composer-input], [contenteditable="true"]') !== null`, 30000)
    await sleep(2500)
    const R = {}
    await openPlus(R, label + '-new')
    // the new-chat sheet, drawn or not: where is it, and which hide rule of ours (or which box) keeps it from being drawn
    R.hidden = await val(`(() => { const hits = []; const rules = ${JSON.stringify(KABY_HIDE.flatMap((r) => r.css.map((c) => [r.id, c])))}; const menu = Array.from(document.querySelectorAll('[role="menu"], [role="listbox"]')).find((e) => /Files and commands|File/.test(e.textContent || '')); if (!menu) return { menu: false }; const chain = []; for (let n = menu; n && n !== document.body; n = n.parentElement) { const cs = getComputedStyle(n); const why = rules.filter(([id, c]) => { try { return n.matches(c) } catch (e) { return false } }).map(([id, c]) => id + ' ' + c.slice(0, 90)); chain.push({ t: n.tagName.toLowerCase() + (n.getAttribute('data-slot') ? '[' + n.getAttribute('data-slot') + ']' : '') + '.' + String(n.className).split(' ')[0], display: cs.display, vis: cs.visibility, why }) } return { menu: true, chain: chain.filter((c) => c.display === 'none' || c.vis === 'hidden' || c.why.length > 0).slice(0, 6), text: (menu.innerText || '').replace(/\\n+/g, ' | ').slice(0, 200) } })()`)
    R.newMarkup = await val(`(() => { const menu = Array.from(document.querySelectorAll('[role="menu"]')).find((e) => /Files and commands/.test(e.textContent || '')); if (!menu) return null; const dump = (e, d) => { const at = {}; for (const a of Array.from(e.attributes)) if (a.name !== 'style' && a.name !== 'class') at[a.name] = String(a.value).slice(0, 40); const kids = Array.from(e.children); return { t: e.tagName.toLowerCase(), c: String(e.className).split(' ').filter(Boolean).slice(0, 2).join('.'), at, text: kids.length === 0 ? (e.textContent || '').trim().slice(0, 30) : undefined, kids: d < 4 ? kids.slice(0, 10).map((k) => dump(k, d + 1)) : kids.length } }; return dump(menu, 0) })()`)
    say('  [' + label + '-new hidden?] ' + JSON.stringify(R.hidden).slice(0, 900))
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await sleep(800)
    // a chat: the « + » of a conversation is the engine's « Add files or run commands » menu itself (File, Feedback, Commands…)
    await g.send('Hello')
    await sleep(6000)
    await openPlus(R, label + '-chat')
    // the open list's markup, attribute by attribute: what a rule could hold on to to hide the developer rows and keep « File »
    R.markup = await val(`(() => { const lb = Array.from(document.querySelectorAll('[role="listbox"]')).filter((e) => (e.innerText || '').includes('Commands')).pop(); if (!lb) return null; const dump = (e, d) => { const at = {}; for (const a of Array.from(e.attributes)) if (a.name !== 'style' && a.name !== 'class') at[a.name] = String(a.value).slice(0, 40); const kids = Array.from(e.children); return { t: e.tagName.toLowerCase(), c: String(e.className).split(' ').filter(Boolean).slice(0, 2).join('.'), at, text: kids.length === 0 ? (e.innerText || '').trim().slice(0, 40) : undefined, kids: d < 6 ? kids.slice(0, 12).map((k) => dump(k, d + 1)) : kids.length } }; return dump(lb, 0) })()`)
    // the same list opened by a typed « / » and « @ » (the placeholder offers both): what do they list, and in which box
    for (const [name, ch] of [['slash', '/'], ['at', '@']]) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
      await sleep(600)
      await val(`(() => { const e = document.querySelector('[data-composer-input], [contenteditable="true"]'); if (e) { e.focus(); const sel = window.getSelection(); sel.selectAllChildren(e); sel.deleteFromDocument() } })()`)
      await send('Input.insertText', { text: ch })
      await sleep(1300)
      R[label + '-' + name] = await val(`(() => { ${DRAWN_JS} const lb = Array.from(document.querySelectorAll('[role="listbox"]')).filter(drawn); return lb.map((e) => { const ov = e.closest('[data-slot="conversation.input.overlay"]'); return { label: e.getAttribute('aria-label'), inOverlay: !!ov, overlayDrawn: ov ? drawn(ov) : null, rows: Array.from(e.querySelectorAll('[role="option"], [role="presentation"]')).filter(drawn).map((r) => (r.getAttribute('role') === 'presentation' ? '## ' : '') + (r.innerText || '').replace(/\\n+/g, ' / ').trim().slice(0, 50)).slice(0, 10) } }) })()`)
      say('  [' + label + '-' + name + '] ' + JSON.stringify(R[label + '-' + name]).slice(0, 600))
      await shot('plus-' + label + '-' + name)
    }
    report['plus-' + label] = R
    // what the phone person may be offered in these lists: « File » and nothing else in Kaby mode, the whole engine list in the full app
    const rowsOf = (name) => { const x = R[name]; return x && Array.isArray(x.sheets) ? x.sheets.flatMap((sh) => sh.rows.map((r) => r.text)) : null }
    const typed = (name) => (Array.isArray(R[name]) ? R[name].flatMap((l) => l.rows) : null)
    if (label === 'kaby') {
      note('Kaby mode, a blank chat: the « + » opens a list that holds « File » and nothing else (no dead dim)', JSON.stringify(rowsOf('kaby-new')) === '["File"]', rowsOf('kaby-new'))
      note('Kaby mode, in a chat: the « + » list holds « File » and nothing else (no Feedback, no Commands)', JSON.stringify(rowsOf('kaby-chat')) === '["File"]', rowsOf('kaby-chat'))
      note('Kaby mode: a typed « / » lists « File » and its section, no Commands and no Skills', JSON.stringify(typed('kaby-slash')) === '["## Add","File"]', typed('kaby-slash'))
      note('Kaby mode: a typed « @ » opens no list', Array.isArray(R['kaby-at']) && R['kaby-at'].length === 0, R['kaby-at'])
    } else {
      note('the full app is unchanged: the « + » list of a chat still holds Feedback and the Commands', (rowsOf('full-chat') || []).some((t) => /^Feedback/.test(t)) && (rowsOf('full-chat') || []).some((t) => /^Compact/.test(t)), rowsOf('full-chat'))
    }
  }
}
// ── Simple's four items: the menu, the chip, the phone model chosen for a chat nothing else can answer, the switch line ─────────────────────────────────────────────────
// What it answers, in Kaby mode on the engine the phone ships: (1) which model the chat opens on (the engine's default with no key, or the phone's, chosen by kybernos-phone-model after its short wait) and what the chip says;
// (2) a first message reaches the phone's model; (3) the menu button opens four rows and nothing else, each row opens its page (reminders, apps, conversations) and Back/Escape closes it; (4) « Need more? » appears only after the
// shell says it can switch (`shell-state` with `capabilities.mode`) and sends `set-mode`; without the capability it is not drawn.
const simpleSection = async () => {
  const S = {}
  report.simple = S
  const click = (sel) => val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true })()`)
  const textOf = (sel) => val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? (e.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 600) : null })()`)
  const chipJs = `(() => { const c = document.querySelector('[data-kb="kaby-chip"]'); if (!c) return null; const r = c.getBoundingClientRect(); return { text: c.textContent, kind: c.getAttribute('data-kind'), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } })()`
  const modelJs = `(() => { const e = document.querySelector('[data-slot="conversation.input.model"]'); return e ? { text: (e.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80), shown: getComputedStyle(e).display } : null })()`
  const phoneJs = `JSON.stringify(window.__KB_PHONE_MODEL__ ? { auto: window.__KB_PHONE_MODEL__.auto, seen: window.__KB_PHONE_MODEL__.seen && { phone: window.__KB_PHONE_MODEL__.seen.phone, blank: window.__KB_PHONE_MODEL__.seen.blank, step: window.__KB_PHONE_MODEL__.seen.step, current: window.__KB_PHONE_MODEL__.seen.current, preset: window.__KB_PHONE_MODEL__.seen.preset } } : null)`
  for (const dark of [false, true]) {
    const tag = dark ? 'dark' : 'light'
    say('\n── Simple (' + tag + ') ──')
    await open({ ua: KABY_UA, dark })
    await g.waitFor(`document.querySelector('[data-composer-input], [contenteditable="true"]') !== null`, 30000)
    await sleep(dark ? 3000 : 7000) // the phone model's own wait before it moves a blank chat (3 s) and the page's 400 ms look
    const R = {}
    S[tag] = R
    R.bar = await val(`(() => { const b = document.querySelector('[data-kb="mobile-menu"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { h: Math.round(r.height), w: Math.round(r.width), x: Math.round(r.x), y: Math.round(r.y), overflowX: document.documentElement.scrollWidth > window.innerWidth } })()`) // the phone's own burger (Simple draws no bar of its own)
    R.chip = await val(chipJs)
    R.picker = await val(modelJs)
    R.phone = await val(phoneJs)
    say('  ○ burger: ' + JSON.stringify(R.bar) + '\n  ○ chip: ' + JSON.stringify(R.chip) + '\n  ○ the engine\'s hidden picker: ' + JSON.stringify(R.picker) + '\n  ○ the phone model page: ' + String(R.phone).slice(0, 700))
    await shot('simple-chat-' + tag)
    R.placeholder = await val(PLACEHOLDER_JS)
    R.modelsLine = await val(MODELS_LINE_JS)
    say('  ○ the composer\'s placeholder: ' + JSON.stringify(R.placeholder) + '\n  ○ the phone model\'s lines: ' + JSON.stringify(R.modelsLine))
    if (dark) {
      // the drawer and one real page, to LOOK at in the dark theme
      await click('[data-kb="mobile-menu"]'); await sleep(600)
      await shot('simple-drawer-dark')
      await click('[data-kb-row="tasks"]'); await sleep(1500)
      await shot('simple-page-reminders-dark')
      continue
    }
    // a first message: which model gets it
    const before = seen.filter((r) => r.method === 'POST' && r.url === '/v1/chat/completions').length
    try { await g.send('Hello') } catch (e) { note('could not send', String(e.message).slice(0, 200)) }
    const got = await g.until(() => seen.filter((r) => r.method === 'POST' && r.url === '/v1/chat/completions').length > before, 20000, 300)
    await sleep(2500)
    const first = seen.filter((r) => r.method === 'POST' && r.url === '/v1/chat/completions')[before]
    R.firstMessage = { reachedPhoneModel: got === true, model: first && first.body ? first.body.model : null, tools: first && first.body && Array.isArray(first.body.tools) ? first.body.tools.length : 0 }
    R.afterChip = await val(chipJs)
    R.afterPlaceholder = await val(PLACEHOLDER_JS)
    say('  ○ the composer\'s placeholder in the chat, after the first message: ' + JSON.stringify(R.afterPlaceholder && { text: R.afterPlaceholder.placeholder && R.afterPlaceholder.placeholder.text, aria: R.afterPlaceholder.input && R.afterPlaceholder.input.attrs }))
    say('  ○ the first message: ' + JSON.stringify(R.firstMessage) + '; chip after: ' + JSON.stringify(R.afterChip))
    await shot('simple-after-message')
    // the drawer: the engine's own sidebar, filtered by the locked preset (the rows are `data-kb-row`)
    R.menuButton = await val(`(() => { const b = document.querySelector('[data-kb="mobile-menu"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x) } })()`)
    await click('[data-kb="mobile-menu"]'); await sleep(600)
    R.menu = await val(`(() => { const rows = Array.from(document.querySelectorAll('[data-kb-row]')).filter((b) => b.getBoundingClientRect().height > 0); return rows.length === 0 ? null : { rows: rows.map((b) => ({ id: b.getAttribute('data-kb-row'), label: (b.getAttribute('aria-label') || '').trim(), h: Math.round(b.getBoundingClientRect().height) })) } })()`)
    say('  ○ drawer rows: ' + JSON.stringify(R.menu))
    await shot('simple-drawer')
    for (const id of ['tasks', 'connectors']) {
      if (!(await click('[data-kb-row="' + id + '"]'))) { await click('[data-kb="mobile-menu"]'); await sleep(500); if (!(await click('[data-kb-row="' + id + '"]'))) { say('  ✗ no row ' + id); continue } }
      await sleep(1800)
      R[id] = { text: (await val(`document.body.innerText.replace(/\\s+/g, ' ').slice(0, 300)`)) }
      say('  ○ ' + id + ' (the engine\'s own page): ' + JSON.stringify(R[id]).slice(0, 600))
      await shot('simple-page-' + id)
      await click('[data-kb="mobile-menu"]'); await sleep(500)
    }
    // « Kaby » row: back to the conversation, drawer closed
    await click('[data-kb-row="kyber"]'); await sleep(1500)
    R.kabyRow = { composer: (await val(`document.querySelector('[data-composer-input], [contenteditable="true"]') !== null`)) === true }
    // the switch line, in About, on the real Settings: absent until the shell says it can switch
    R.opened = await openSimpleSettings()
    R.switchBefore = (await val(`document.querySelector('[data-kb="kaby-mode-switch"]') !== null`)) === true
    await val(`window.__KB_APP__.receive({ kybernos: 'shell-state', version: 1, capabilities: { authorize: true, notifications: true, mode: true, screens: ['account'] }, notifications: 'undetermined', connection: 'local' })`); await sleep(600)
    R.switchAfter = await textOf('[data-kb="kaby-mode-switch"]')
    R.help = await val(`(() => { const sec = document.querySelector('[data-kb="kaby-help"]'); if (!sec) return null; sec.scrollIntoView({ block: 'center' }); const b = sec.querySelector('[data-act="report-open"]'); const r = b ? b.getBoundingClientRect() : null; return { text: (sec.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 300), button: r ? { w: Math.round(r.width), h: Math.round(r.height) } : null } })()`)
    say('  ○ the help card: ' + JSON.stringify(R.help))
    await sleep(300)
    await shot('simple-settings-help')
    await shot('simple-settings-switch')
    await val('window.__kbOut.length = 0')
    await click('[data-act="kaby-mode-advanced"]'); await sleep(400)
    R.setMode = await val('window.__kbOut.filter((m) => m.kybernos === "set-mode")')
    say('  ○ the switch line: before the shell said so ' + R.switchBefore + '; after: ' + JSON.stringify(R.switchAfter) + '; message: ' + JSON.stringify(R.setMode))
  }
}

// What the composer says when it is empty, and where the text lives: the element, its data-* / aria attributes, and the pseudo-element's content (the engine draws some placeholders in CSS).
// Simple's Settings is DSH's own dialog: the phone's burger opens the drawer, the avatar of its dock the account menu, and the menu's Settings the dialog. About holds the phone-only cards (« The Kybernos app » was a page until item 28).
const SETTINGS_SEL = '[data-shortcut-modal="settings"]'
const openSimpleSettings = async () => {
  const tap = (sel) => val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true })()`)
  const drawerOpen = async () => (await val(`(() => { const r = document.querySelector('[data-slot="root"] > div'); return r ? !r.hasAttribute('data-sidebar-collapsed') : null })()`)) === true
  if (!(await drawerOpen())) { await tap('[data-kb="mobile-menu"]'); await sleep(600) }
  await tap('[data-kb="mobile-avatar"]'); await sleep(600)
  await tap('[data-kb="menu-settings"]'); await sleep(1500)
  await tap(SETTINGS_SEL + ' [data-kb-t="about"]'); await sleep(1800)
  return (await val(`document.querySelector(${JSON.stringify(SETTINGS_SEL)}) !== null`)) === true
}
const PLACEHOLDER_JS = `(() => { const e = document.querySelector('[data-composer-placeholder]'); const inp = document.querySelector('[data-composer-input], [contenteditable="true"]'); const pick = (n) => n ? { tag: n.tagName.toLowerCase(), text: (n.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120), attrs: Array.from(n.attributes).filter((a) => /placeholder|aria-label|data-kb|data-composer/.test(a.name)).map((a) => a.name + '=' + String(a.value).slice(0, 100)), before: getComputedStyle(n, '::before').content, after: getComputedStyle(n, '::after').content, display: getComputedStyle(n).display } : null; return { placeholder: pick(e), input: pick(inp), kaby: document.documentElement.classList.contains('kb-kaby') } })()`
// The two lines the phone model's bundle draws above the composer: its sentence and the link that opens the phone's models.
const MODELS_LINE_JS = `(() => { const n = document.querySelector('[data-kb="phone-model-line"], [data-kb^="phone-model"]'); const all = Array.from(document.querySelectorAll('[data-kb^="phone-model"], [data-kb^="pm-"]')).map((e) => { const r = e.getBoundingClientRect(); return { kb: e.getAttribute('data-kb'), text: (e.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 120), shown: r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none' } }); return all.slice(0, 8) })()`

const pickerSection = async () => {
  say('\n── P. the model picker of the full app, 390 px ──')
  await open({ ua: FULL_UA, dark: false })
  await g.waitFor(`document.querySelector('[data-composer-input], [contenteditable="true"]') !== null`, 30000)
  await sleep(1500)
  const P = {}
  P.button = await g.modelButton()
  P.before = await val(LAYERS_JS)
  await shot('p-0-closed')
  const touch = async (x, y) => { const send = (m, p) => g.page.send(m, p); await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(60); await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }) }
  await touch(P.button.x, P.button.y)
  await sleep(1500)
  P.open = await val(LAYERS_JS)
  P.ours = await val(OURS_JS)
  // who the open sheet is (its own box, role menu or dialog) and every box above it that is a stacking context: a sheet under the scrim is under one of those
  P.chain = await val(`(() => { const sheet = Array.from(document.querySelectorAll('[role="menu"], [role="dialog"], [role="listbox"]')).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 100 && r.x >= 0 && /Search models|On this phone/.test(e.innerText || '') }).pop(); if (!sheet) return null; const out = []; for (let e = sheet; e && e !== document.documentElement; e = e.parentElement) { const s = getComputedStyle(e); const ctx = []; if (s.position === 'fixed' || s.position === 'sticky') ctx.push(s.position); if (s.zIndex !== 'auto' && s.position !== 'static') ctx.push('z=' + s.zIndex); if (s.transform !== 'none') ctx.push('transform'); if (parseFloat(s.opacity) < 1) ctx.push('opacity'); if (s.filter !== 'none') ctx.push('filter'); if (s.backdropFilter && s.backdropFilter !== 'none') ctx.push('backdrop'); if (/transform|opacity|filter|perspective/.test(s.willChange)) ctx.push('will-change:' + s.willChange); if (s.isolation === 'isolate') ctx.push('isolate'); if (/layout|paint|strict|content/.test(s.contain)) ctx.push('contain:' + s.contain); if (s.mixBlendMode !== 'normal') ctx.push('blend'); if (s.containerType && s.containerType !== 'normal') ctx.push('container'); if (s.clipPath !== 'none') ctx.push('clip'); if (s.maskImage && s.maskImage !== 'none') ctx.push('mask'); out.push({ tag: e.tagName, slot: e.getAttribute('data-slot'), cls: String(e.className).slice(0, 60), ctx: ctx.join(' '), lift: e.getAttribute('data-kbmob-lift') }) } return { sheetCls: String(sheet.className).slice(0, 80), role: sheet.getAttribute('role'), chain: out } })()`)
  // the sheet's own search field (the sidebar has one too, off screen), and what is on top of it
  const SEARCH_JS = `(() => { const i = Array.from(document.querySelectorAll('input')).find((x) => /search models/i.test((x.placeholder || '') + (x.getAttribute('aria-label') || ''))); if (!i) return null; const r = i.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { x: r.x + r.width / 2, y: r.y + r.height / 2, ph: i.placeholder, onTop: !!top && (top === i || i.contains(top) || top.contains(i)), top: top ? top.tagName + ' ' + String(top.className).slice(0, 50) : null } })()`
  P.search = await val(SEARCH_JS)
  say('  ○ chip: ' + JSON.stringify(P.button) + '; the sheet\'s search field: ' + JSON.stringify(P.search))
  note('the picker sheet is on top of the page: the search field, not the scrim, is what a tap at its centre reaches', P.search !== null && P.search.onTop === true)
  P.scrim = await val(`(() => { const sc = document.querySelector('.kbmob-scrim'); const sh = Array.from(document.querySelectorAll('[role="menu"], [role="dialog"]')).filter((e) => /Search models|On this phone/.test(e.innerText || '')).pop(); if (!sh) return null; const r = sh.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + 120); return { scrim: !!sc, sheetOnTop: !!top && sh.contains(top) } })()`)
  note('the scrim is there and the sheet is above it', P.scrim !== null && P.scrim.scrim === true && P.scrim.sheetOnTop === true)
  await shot('p-1-open')
  P.text = await val(`document.body.innerText.slice(0, 600)`)
  if (P.search !== null) {
    await touch(P.search.x, P.search.y)
    await sleep(900)
    P.afterTapSearch = { focused: await val(`document.activeElement ? document.activeElement.tagName + ' ' + (document.activeElement.placeholder || '') : null`), stillOpen: (await val(SEARCH_JS)) !== null }
    note('a tap on the search field keeps the sheet open and focuses the field', P.afterTapSearch.stillOpen === true && /INPUT/.test(P.afterTapSearch.focused || ''), P.afterTapSearch)
    await shot('p-2-after-tap-search')
    if (P.afterTapSearch.stillOpen === true) {
      await g.page.send('Input.insertText', { text: '1.7b' })
      await sleep(900)
      P.line = await g.leaf('Qwen3 1.7B')
      note('typing « 1.7b » lists the phone model', P.line !== null && P.line !== undefined)
      await shot('p-3-typed')
      if (P.line) { await touch(P.line.x, P.line.y); await sleep(900) }
      P.chosen = await g.modelButton()
      note('the phone model is the composer\'s model after the tap on its line', P.chosen !== null && /qwen3 1\.7b/i.test(P.chosen.current || P.chosen.shown || ''), P.chosen && P.chosen.current)
      await shot('p-4-chosen')
      const before = seen.filter((r) => r.method === 'POST' && r.url === '/v1/chat/completions').length
      try { await g.send('Hello') } catch (e) { note('could not send', String(e.message).slice(0, 200)) }
      const got = await g.until(() => seen.filter((r) => r.method === 'POST' && r.url === '/v1/chat/completions').length > before, 20000, 300)
      const req = got ? seen.filter((r) => r.method === 'POST' && r.url === '/v1/chat/completions')[before] : undefined
      note('a first message then reaches the phone model', !!req && req.body !== null && req.body.model === MODEL.id, req && req.body ? req.body.model : null)
      await sleep(1500)
      await shot('p-5-sent')
    }
  }
  report.picker = P
  say('  ○ picker: ' + JSON.stringify({ search: P.search, afterTapSearch: P.afterTapSearch, line: P.line ? { x: P.line.x, y: P.line.y } : null, chosen: P.chosen && P.chosen.current, oursSheets: P.ours.sheets, oursHits: P.ours.hits.length }).slice(0, 1500))
  for (const h of P.ours.hits) say('    our rule on a layer: ' + JSON.stringify(h).slice(0, 400))
}

// ── S0 of the signed-out phone (read-only): a blank profile, no account, the Simple user agent ───────────────────────────────────────────
// What it answers (the brief of the signed-out phone, section S0):
//   (a) does the first-run wizard (the page's `.kb-ob`, « Which models should Kybernos use? ») open on a profile with no onboarding.json and no account?
//   (b) is the phone's model the one that answers (the phone model's own wait is 3 s) when nothing else can?
//   (c) does ANY connection leave the machine (lib-egress-spy.mjs refuses every one and writes it down)?
// Then the file the native app would write for « this phone only » (`<DSH_HOME>/kybernos/onboarding.json`, finished, `model: "local"`: the shape engine-account.mjs `finishOnboarding` writes, with `local`
// in place of `cloud`) is put in the same place, the page is opened again, and the same three questions are asked of the chat.
const blankSection = async () => {
  const B = {}
  report.blank = B
  const startedAt = Date.now() - 40000 // seconds in the egress list are counted from about the engine's start (a rough origin: the unpack is not timed)
  const egress = () => { try { return readFileSync(join(work, 'egress.jsonl'), 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => { const j = JSON.parse(l); return { at: Math.round((j.t - startedAt) / 1000), kind: j.kind, host: j.host, port: j.port, path: j.path || j.url || null, method: j.method || null } }) } catch (e) { return [] } }
  const fileNow = () => { try { return JSON.parse(readFileSync(join(home, '.dsh', 'kybernos', 'onboarding.json'), 'utf8')) } catch (e) { return null } }
  const route = () => val(`fetch('/kybernos/onboarding', { headers: { accept: 'application/json' } }).then((r) => r.json()).then((j) => JSON.stringify(j)).catch((e) => 'ERR ' + e)`)
  const wizard = () => val(`(() => { const w = document.querySelector('.kb-ob'); if (!w) return null; const h = w.querySelector('h1'); const r = w.getBoundingClientRect(); return { h1: h ? h.textContent.trim() : null, rows: Array.from(w.querySelectorAll('.kb-ob-row')).map((b) => (b.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 100)), skip: !!w.querySelector('.kb-ob-skip'), w: Math.round(r.width), h: Math.round(r.height), text: (w.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 400) } })()`)
  const modelJs = `(() => { const e = document.querySelector('[data-slot="conversation.input.model"]'); return e ? { text: (e.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80), shown: getComputedStyle(e).display } : null })()`
  const phoneJs = `JSON.stringify(window.__KB_PHONE_MODEL__ ? { auto: window.__KB_PHONE_MODEL__.auto, seen: window.__KB_PHONE_MODEL__.seen && { phone: window.__KB_PHONE_MODEL__.seen.phone, blank: window.__KB_PHONE_MODEL__.seen.blank, step: window.__KB_PHONE_MODEL__.seen.step, current: window.__KB_PHONE_MODEL__.seen.current, preset: window.__KB_PHONE_MODEL__.seen.preset } } : null)`
  const look = async (tag) => {
    const R = {}
    R.onboardingRoute = await route()
    R.file = fileNow()
    R.wizard = await wizard()
    R.picker = await val(modelJs)
    R.phone = await val(phoneJs)
    R.composer = (await val(`document.querySelector('[data-composer-input], [contenteditable="true"]') !== null`)) === true
    R.modelsLine = await val(MODELS_LINE_JS)
    say('  ○ ' + tag + ' the route says: ' + String(R.onboardingRoute).slice(0, 300))
    say('  ○ ' + tag + ' the file on disk: ' + JSON.stringify(R.file) + '\n  ○ ' + tag + ' the wizard: ' + JSON.stringify(R.wizard) + '\n  ○ ' + tag + ' the picker: ' + JSON.stringify(R.picker) + '\n  ○ ' + tag + ' the phone model page: ' + String(R.phone).slice(0, 500) + '\n  ○ ' + tag + ' the phone model line: ' + JSON.stringify(R.modelsLine).slice(0, 400))
    return R
  }
  say('\n── S0 phase 1. a blank profile (no onboarding.json, no account), Kaby mode ──')
  B.fileBefore = fileNow()
  say('  ○ the harness wrote no onboarding.json (--blank); the file at this point is the engine\'s own first read (the host route CREATES it): ' + JSON.stringify(B.fileBefore))
  await open({ ua: KABY_UA, dark: false })
  await g.waitFor(`document.querySelector('[data-composer-input], [contenteditable="true"], .kb-ob') !== null`, 30000)
  await sleep(8000) // the phone model's own wait (3 s), then the wizard's own boot fetch
  B.blank = await look('blank:')
  await shot('s0-blank')
  B.egressBlank = egress()
  say('  ○ connections refused so far: ' + B.egressBlank.length + (B.egressBlank.length > 0 ? ' ' + JSON.stringify(B.egressBlank).slice(0, 600) : ''))

  say('\n── S0 phase 2. the file the native app writes for « this phone only » (finished, model "local") ──')
  const done = { version: 1, completed: true, installedAt: (B.blank.file && B.blank.file.installedAt) || new Date().toISOString(), completedAt: new Date().toISOString(), profil: null, uiMode: null, model: 'local', lang: null, memoryId: null, goals: [], customGoals: [], agents: null, theme: null, about: null }
  writeFileSync(join(home, '.dsh', 'kybernos', 'onboarding.json'), JSON.stringify(done, null, 2) + '\n')
  B.written = { path: '<DSH_HOME>/kybernos/onboarding.json', keys: Object.keys(done) }
  await open({ ua: KABY_UA, dark: false })
  await g.waitFor(`document.querySelector('[data-composer-input], [contenteditable="true"], .kb-ob') !== null`, 30000)
  await sleep(8000)
  B.local = await look('local:')
  await shot('s0-local-chat')
  B.egressBeforeMessage = egress()
  say('  ○ connections refused before the first message: ' + B.egressBeforeMessage.length)
  const before = seen.filter((r) => r.method === 'POST' && r.url === '/v1/chat/completions').length
  try { await g.send('Hello') } catch (e) { note('could not send', String(e.message).slice(0, 200)) }
  const got = await g.until(() => seen.filter((r) => r.method === 'POST' && r.url === '/v1/chat/completions').length > before, 20000, 300)
  await sleep(2500)
  const first = seen.filter((r) => r.method === 'POST' && r.url === '/v1/chat/completions')[before]
  B.firstMessage = { reachedPhoneModel: got === true, model: first && first.body ? first.body.model : null, tools: first && first.body && Array.isArray(first.body.tools) ? first.body.tools.length : 0 }
  say('  ○ the first message: ' + JSON.stringify(B.firstMessage))
  await shot('s0-local-after-message')
  B.egress = egress()
  say('  ○ connections refused AFTER the first message was sent: ' + (B.egress.length - B.egressBeforeMessage.length) + ' more')
  B.requestsToTheFakeServer = seen.map((r) => r.method + ' ' + r.url).reduce((m, k) => { m[k] = (m[k] || 0) + 1; return m }, {})
  const sum = (list) => Object.entries(list.reduce((m, e) => { const k = e.kind + ' ' + e.method + ' ' + e.path; m[k] = (m[k] || 0) + 1; return m }, {})).map(([k, n]) => n + ' x ' + k).join('; ')
  B.egressSummary = sum(B.egress)
  say('\n  ○ every connection that tried to leave the machine, over both phases: ' + B.egress.length + (B.egress.length > 0 ? ' = ' + B.egressSummary : ''))
  say('  ○ ...and the ones that are not models.dev, with the second they came at: ' + JSON.stringify(B.egress.filter((e) => e.host !== 'models.dev').map((e) => [e.at, e.host, e.path])))
  say('  ○ what the fake phone app server was asked: ' + JSON.stringify(B.requestsToTheFakeServer))
}


try {
  PICKER_ONLY: {
  if (BLANK) { await blankSection(); break PICKER_ONLY }
  if (SIMPLE) { await simpleSection(); break PICKER_ONLY }
  if (PLUS) { await plusSection(); break PICKER_ONLY }
  if (PICKER) { await pickerSection(); break PICKER_ONLY }
  say('\n── A. the full app (no Kaby token), light ──')
  await open({ ua: FULL_UA, dark: false })
  await g.waitFor(`document.querySelector('[data-composer-input], [contenteditable="true"]') !== null`, 30000)
  const full = await sweep('full')
  // the new-chat page's structure: which hero parts exist, which hold the composer (a rule that hides one of those hides the composer with it)
  report.hero = await val(`(() => { ${DRAWN_JS} const q = (e) => e.querySelector('[data-composer-input], [contenteditable="true"], [data-slot="conversation.composer.bar"]') !== null; const path = (e) => { const out = []; for (let n = e.parentElement; n && out.length < 4; n = n.parentElement) out.push(n.getAttribute('data-slot') || n.getAttribute('data-kb') || n.tagName.toLowerCase()); return out }; return Array.from(document.querySelectorAll('[data-slot^="conversation.hero"], [data-kb-hero], [data-kb-beta], [data-kb^="newchat-"]')).map((e) => ({ slot: e.getAttribute('data-slot'), kb: e.getAttribute('data-kb') || (e.hasAttribute('data-kb-hero') ? '[data-kb-hero]' : null), tag: e.tagName.toLowerCase(), drawn: drawn(e), holdsComposer: q(e), parents: path(e), text: (e.innerText || '').replace(/\\s+/g, ' ').slice(0, 50) })) })()`)
  say('  ○ new-chat page parts: ' + JSON.stringify(report.hero).slice(0, 1500))
  report.full = { kaby: await val(`document.documentElement.classList.contains('${KABY_CLASS}')`), text: await visibleText() }
  if (PICK_FIRST) {
    let chosen = false
    try { chosen = await g.selectModel('Qwen3 1.7B') } catch (e) { note('selectModel failed', String(e.message).slice(0, 200)) }
    note('the phone model was chosen in the full app, on its blank chat', chosen === true)
    await sleep(2500)
  }
  await shot('a-full-light')
  say('   Kaby class on in the full app: ' + report.full.kaby)

  say('\n── B. Kaby mode, light ──')
  await open({ ua: KABY_UA, dark: false })
  const up = await g.until(async () => (((await count('[data-kb="mobile-menu"]')).total > 0 && (await count('[data-slot="conversation.composer.bar"]')).drawn > 0) ? true : null), 45000, 500)
  note('the phone\'s own burger and the composer are drawn', up === true)
  await val(`window.__KB_APP__ && window.__KB_APP__.receive({ kybernos: 'shell-state', version: 1, capabilities: { authorize: true, notifications: true, screens: ['account', 'plan', 'help', 'notification-settings'] }, notifications: 'undetermined', connection: 'local' })`)
  if (PICK_PHONE) {
    await sleep(2500)
    await val(`document.documentElement.classList.remove('${KABY_CLASS}')`)
    await sleep(800)
    let chosen = false
    try { chosen = await g.selectModel('Qwen3 1.7B') } catch (e) { note('selectModel failed', String(e.message).slice(0, 200)) }
    await val(`document.documentElement.classList.add('${KABY_CLASS}')`)
    note('the phone model was chosen for the Kaby chat (the class was lifted for a moment: the picker is hidden in Kaby mode)', chosen === true)
  }
  await sleep(3000)
  await shot('b-kaby-light-1-first')
  report.opened = { class: await val(`document.documentElement.classList.contains('${KABY_CLASS}')`), url: await val('location.href.replace(/token=[^&]*/, "token=[hidden]")'), probe: await probe(), text: await visibleText(),
    shell: await val('window.__kbOut.map((m) => m.kybernos + (m.mode ? ":" + m.mode : ""))') }
  say('  ○ opened: ' + JSON.stringify(report.opened).slice(0, 700))
  const kaby = await sweep('kaby')
  const byKey = new Map(full.map((r) => [r.kind + '|' + r.css, r]))
  for (const r of kaby) {
    const f = byKey.get(r.kind + '|' + r.css)
    report[r.kind === 'hide' ? 'hide' : 'show'].push({ id: r.id, css: r.css, fullTotal: f ? f.total : null, fullDrawn: f ? f.drawn : null, fullHolds: f ? f.holdsComposer : null, kabyTotal: r.total, kabyDrawn: r.drawn, kabyHolds: r.holdsComposer, error: r.error })
  }
  // a hide rule must never match an element that holds the composer: it would take the composer with it (DSH 0.2.2-rc.5: « conversation.hero.frame » wraps it, a blank page with no way to write)
  const hidesComposer = report.hide.filter((r) => r.kabyHolds > 0 || r.fullHolds > 0)
  note('no hide rule matches an element that holds the composer', hidesComposer.length === 0, JSON.stringify(hidesComposer.map((r) => r.css)))
  const stillDrawn = report.hide.filter((r) => r.kabyDrawn > 0)
  const rejected = [...report.hide, ...report.show].filter((r) => r.error !== undefined)
  const noMatch = report.hide.filter((r) => r.kabyTotal === 0 && r.fullTotal === 0)
  const noShow = report.show.filter((r) => r.kabyDrawn === 0)
  say('  hide rows that are STILL DRAWN in Kaby mode: ' + JSON.stringify(stillDrawn.map((r) => r.css)))
  say('  selectors the engine REJECTS: ' + JSON.stringify(rejected.map((r) => r.css + ' → ' + r.error)))
  note('the engine rejects none of the hide and show selectors (a browser drops a whole rule for one it cannot parse: a `:has` inside a `:has`)', rejected.length === 0, rejected.map((r) => r.css))
  say('  hide selectors that match nothing in either page (new chat, rc.2): ' + JSON.stringify(noMatch.map((r) => r.css)))
  say('  show hooks NOT drawn in Kaby mode (first screen): ' + JSON.stringify(noShow.map((r) => r.css)))

  say('\n── C. a first message, and what the model is sent ──')
  const before = seen.filter((r) => r.method === 'POST' && r.url === '/v1/chat/completions').length
  let sent = null
  try { sent = await g.send('Hello') } catch (e) { note('could not send', String(e.message).slice(0, 200)) }
  const got = await g.until(() => seen.filter((r) => r.method === 'POST' && r.url === '/v1/chat/completions').length > before, 20000, 300)
  await sleep(2500)
  await shot('b-kaby-light-2-answer')
  const first = seen.filter((r) => r.method === 'POST' && r.url === '/v1/chat/completions')[before]
  if (got && first !== undefined && first.body !== null) {
    const system = Array.isArray(first.body.messages) ? first.body.messages.filter((m) => m.role === 'system').map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n') : ''
    report.request = { model: first.body.model, tools: Array.isArray(first.body.tools) ? first.body.tools.length : 0, toolNames: Array.isArray(first.body.tools) ? first.body.tools.map((t) => t.function && t.function.name).slice(0, 12) : [],
      maxTokens: first.body.max_tokens, messages: Array.isArray(first.body.messages) ? first.body.messages.length : 0, systemTokens: roughTokens(system), systemHead: system.slice(0, 260) }
  } else report.request = { reachedPhoneModel: false, sentAt: sent }
  say('  ○ the first request the phone model got: ' + JSON.stringify(report.request).slice(0, 900))
  report.afterSend = { probe: await probe(), text: await visibleText() }
  report.afterAnswer = (await sweep('after-answer')).map((r) => ({ kind: r.kind, css: r.css, total: r.total, drawn: r.drawn }))
  const leftDrawn = report.afterAnswer.filter((r) => r.kind === 'hide' && r.drawn > 0)
  const shownNow = report.afterAnswer.filter((r) => r.kind === 'show' && r.drawn > 0)
  say('  after the answer: hide selectors still DRAWN: ' + JSON.stringify(leftDrawn.map((r) => r.css)) + '; show hooks drawn: ' + JSON.stringify(shownNow.map((r) => r.css)))
  say('  ○ after the message: ' + JSON.stringify(report.afterSend).slice(0, 700))

  say('\n── D. Simple\'s real Settings (About with the app\'s parts), light and dark ──')
  const gear = await openSimpleSettings()
  await sleep(800)
  await shot('b-kaby-light-3-settings')
  report.edgeLight = await edge()
  say('  ○ right edge, light settings: ' + JSON.stringify(report.edgeLight))
  report.slots = await val(`Array.from(new Set(Array.from(document.querySelectorAll('[data-slot]')).map((e) => e.getAttribute('data-slot')))).sort()`)
  report.settingsText = String(await val(`(document.querySelector('[data-shortcut-modal="settings"]') || { innerText: '' }).innerText`))
  say('   settings opened: ' + gear + ', text: ' + report.settingsText.replace(/\n+/g, ' / ').slice(0, 700))
  await open({ ua: KABY_UA, dark: true })
  await g.until(async () => ((await count('[data-kb="mobile-menu"]')).total > 0 ? true : null), 30000, 500)
  await sleep(2500)
  await shot('c-kaby-dark-1-conversation')
  report.dark = { theme: await val(`document.documentElement.getAttribute('data-theme') || document.documentElement.className`), bg: await val(`getComputedStyle(document.body).backgroundColor`), text: await visibleText() }
  say('  ○ dark: ' + JSON.stringify(report.dark).slice(0, 500))
  const gear2 = await openSimpleSettings()
  await sleep(800)
  await shot('c-kaby-dark-2-settings')
  report.edgeDark = await edge()
  say('  ○ right edge, dark settings: ' + JSON.stringify(report.edgeDark))
  say('   dark settings opened: ' + gear2)
  await open({ ua: FULL_UA, dark: true })
  await sleep(2000)
  await shot('c-full-dark')
  if (STUB || LIGHT) {
    say('\n── E. « Remind me tomorrow at 9 to call the plumber », ' + (LIGHT ? 'on the phone model (the light agent chat)' : 'on the stand-in default model') + ' ──')
    const accessMode = () => val(`(() => { const b = document.querySelector('button[aria-label^="Access mode"]'); return b ? b.getAttribute('aria-label') : null })()`)
    const card = () => val(`(() => { ${DRAWN_JS} const c = Array.from(document.querySelectorAll('[data-slot*="approval"]')).filter(drawn).length; const t = document.body.innerText; return { slot: c, buttons: /Allow once|Allow|Reject/.test(t) } })()`)
    // the card's words, and a tap on one of its buttons (the engine's own approval card: « Allow once » / « Reject »)
    const cardText = () => val(`(() => { const m = /(?:Kaby (?:wants|veut)|Set this reminder|Créer ce rappel)[^\\n]*/.exec(document.body.innerText); return m ? m[0] : null })()`)
    const tap = (re) => val(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => ${re}.test((x.innerText || '').trim())); if (!b) return false; b.click(); return true })()`)
    const reminder = async (label, ua, steps) => {
      await open({ ua, dark: false })
      await g.until(async () => ((await val(`document.querySelector('[data-composer-input], [contenteditable="true"]') !== null`)) ? true : null), 30000, 500)
      await sleep(3500)
      const r = { accessMode: await accessMode(), turns: [] }
      for (const [i, step] of steps.entries()) {
        const decide = step.decide
        const before = toolResults.length
        await g.send(step.text)
        await g.until(async () => { const c = await card(); return (c.slot > 0 || c.buttons || toolResults.length > before) ? true : null }, 30000, 400)
        await sleep(1200)
        const c = await card()
        const turn = { cardShown: c.slot > 0 || c.buttons, cardText: await cardText() }
        await shot('e-' + label + '-' + i + '-card')
        if (turn.cardShown && decide !== null) {
          turn.tapped = decide
          turn.tapOk = await tap(decide === 'allow' ? '/^allow/i' : '/^reject/i')
          await g.until(async () => (toolResults.length > before ? true : null), 30000, 400)
          await sleep(800)
          await shot('e-' + label + '-' + i + '-after-' + decide)
        }
        turn.toolResult = toolResults.length > before ? toolResults[toolResults.length - 1] : null
        r.turns.push(turn)
      }
      r.probe = await probe()
      report['reminder' + label] = r
      say('  ○ ' + label + ': ' + JSON.stringify(r).slice(0, 900))
    }
    const T9 = 'Remind me tomorrow at 9 to call the plumber'
    if (LIGHT) {
      // no time in the first words: the light chat refuses before any card; then one card, the light chat's own wording, and Allow stores it
      await reminder('light', KABY_UA, [{ text: 'Remind me to call the plumber', decide: null }, { text: T9, decide: 'allow' }])
    } else {
      await reminder('full', FULL_UA, [{ text: T9, decide: 'reject' }])
      await reminder('kaby', KABY_UA, [{ text: T9, decide: 'reject' }, { text: T9 + ', again', decide: 'allow' }])
    }
  }
  if (STUB) {
    say('\n── F. The app\'s parts in About, in Simple: the computer and the notifications cards ──')
    await open({ ua: KABY_UA, dark: false })
    await g.until(async () => ((await val(`document.querySelector('[data-composer-input], [contenteditable="true"]') !== null`)) ? true : null), 30000, 500)
    await sleep(3500)
    const f = {}
    f.opened = await openSimpleSettings()
    const cardOf = (kb) => val(`(() => { const c = document.querySelector('[data-kb="${kb}"]'); return c ? c.innerText.replace(/\\s+/g, ' ').trim() : null })()`)
    f.computerBeforeShell = await cardOf('kaby-computer')
    // the shell answers: this phone, notifications undecided
    await val(`window.__KB_APP__ && window.__KB_APP__.receive({ kybernos: 'shell-state', version: 1, capabilities: { authorize: true, notifications: true, screens: ['account', 'plan', 'help', 'notification-settings'] }, notifications: 'undetermined', connection: 'local' })`)
    await sleep(800)
    f.computerLocal = await cardOf('kaby-computer')
    f.notifications = await cardOf('kaby-notifications')
    f.cards = await val(`Array.from(document.querySelectorAll('[data-shortcut-modal="settings"] section[data-kb^="kaby-"]')).map((n) => n.getAttribute('data-kb'))`)
    await shot('f-settings-kybernos-app')
    report.settings = f
    say('  ○ settings: ' + JSON.stringify(f).slice(0, 1800))
  }
  }
} catch (e) {
  say('✗ the check stopped: ' + String(e && e.stack ? e.stack : e).slice(0, 700))
  report.error = String(e && e.message ? e.message : e)
} finally {
  report.remindRequests = remindRequests.slice(-3)
  report.engineLines = out.split('\n').filter((l) => /\[kybernos-(kyber|mobile|phone-model|cloud)\]|error|Error|warn/.test(l)).slice(-25).map((l) => l.slice(0, 220))
  try { writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2)) } catch (e) { /* no report */ }
  try { await g.close() } catch (e) { /* closed */ }
  stop()
  server.close()
  say('\nreport: ' + join(OUT, 'report.json'))
}
