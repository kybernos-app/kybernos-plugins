#!/usr/bin/env node
// Kaby mode, in a real GUI at the size of a phone (390 x 844), with a stub model for the answers.
//
//   source scripts/sandbox/env.sh && node scripts/check-kaby-mode-live.mjs --out <evidence dir>
//
// What it plays, on an isolated DSH (the sandbox; it refuses :3080 and any DSH home that is not a sandbox's):
//   A  the full app (the app's user agent WITHOUT the Kaby token) keeps everything Kaby mode hides; a browser that carries the token is not Kaby mode.
//   B  Kaby mode (`... KabyMode/1`): the class is on <html> from the page head, the conversation opens on its own, every selector of the hide list matches
//      only elements that are not drawn, every hook of the show list that is drawn without a tap is drawn (the phone's own burger, the composer, the chat), no word of the engine's
//      wording is on screen, no sideways scroll; the answers and the « Report » link; DSH's own approval card; the notification permission is asked once, with no word of anyone's.
//   C  Simple's Settings is the real dialog (burger, avatar, Settings): About, with the app's phone-only sections inside it (« The Kybernos app » was a page until item 28: Notifications, where Kaby works, Account and plan, Help
//      and report); the card « Kaby wants to connect X » (asked by a window event) from « asking » to « connected », « Not now », and what reaches the shell (the sign-in
//      sheet address, the screens, the permission). The drawer, the account menu and the rows of the preset are read by scripts/check-simple-settings-live.mjs.
// The shell is played by the page itself (`window.ReactNativeWebView` records what the page posts; the script answers through `__KB_APP__.receive`).
// It adds a stub model to the sandbox profile (a backup is put back) and restarts the sandbox once. Nothing leaves the machine.
// Exit code 0: every check passed (what it could not see is under « not seen » in the report), 1: a check failed, 3: it cannot start.
// 390 px screenshots go to <out>/shots: they are meant to be LOOKED at, not only counted.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openGui, sleep } from './lib-e2e-gui.mjs'
import { KABY_CLASS, KABY_HIDE, KABY_SHOW, KABY_STYLE_ID } from '../packages/kybernos-mobile/kaby-mode.mjs'

const args = process.argv.slice(2)
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : null
if (OUT === null) { console.error('usage: --out <evidence dir>'); process.exit(3) }
mkdirSync(join(OUT, 'shots'), { recursive: true })
const here = dirname(fileURLToPath(import.meta.url))
const host = process.env.KB_HOST || '127.0.0.1:3080'
const home = process.env.DSH_HOME || ''
if (/:3080$/.test(host) || !home.includes('.kybernos-sandbox')) { console.error('○ inconclusive: needs a sandbox DSH (source scripts/sandbox/env.sh), not :3080.'); process.exit(3) }

const report = { when: new Date().toISOString(), host, steps: [], notSeen: [], findings: {} }
let failed = 0
const check = (name, ok, detail) => {
  report.steps.push({ name, ok: !!ok, detail: ok || detail === undefined ? undefined : detail })
  if (!ok) failed += 1
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (!ok && detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 360) : ''))
}
const note = (k, v) => { report.findings[k] = v; console.log('  ○ ' + k + ': ' + JSON.stringify(v).slice(0, 360)) }
const notSeen = (what) => { report.notSeen.push(what); console.log('  ◌ not seen: ' + what) }

const FULL_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KybernosHost/0.1.0 (ios)'
const KABY_UA = FULL_UA + ' KabyMode/1'
const ANDROID_KABY_UA = 'Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 KybernosHost/1.2.3-beta.4 (android) KabyMode/1'
const BROWSER_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1 KabyMode/1'

// ── the stub model: a turn is chosen by a marker in the last user message ─────────────────────────────────────
const probe = { seen: [], toolNames: [] }
const sse = (res, delta, finish) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const base = { id: 'chatcmpl-stub', object: 'chat.completion.chunk', created: 1, model: 'stub-1' }
  res.write('data: ' + JSON.stringify(Object.assign({}, base, { choices: [{ index: 0, delta, finish_reason: null }] })) + '\n\n')
  res.write('data: ' + JSON.stringify(Object.assign({}, base, { choices: [{ index: 0, delta: {}, finish_reason: finish }] })) + '\n\n')
  res.end('data: [DONE]\n\n')
}
const textOf = (m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
const server = createServer((req, res) => {
  let body = ''
  req.on('data', (d) => { body += d })
  req.on('end', () => {
    let j = {}
    try { j = JSON.parse(body) } catch (e) { j = {} }
    if (String(req.url).indexOf('/chat/completions') < 0) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'kbstub/stub-1', object: 'model' }] })); return }
    if (!Array.isArray(j.tools) || j.tools.length === 0) { sse(res, { role: 'assistant', content: 'Stub' }, 'stop'); return }
    probe.toolNames = j.tools.map((t) => (t.function ? t.function.name : ''))
    const bashDef = j.tools.find((t) => t.function && t.function.name === 'bash')
    probe.bash = bashDef ? bashDef.function.parameters : null
    const msgs = Array.isArray(j.messages) ? j.messages : []
    let lastUser = -1
    for (let i = msgs.length - 1; i >= 0; i -= 1) { if (msgs[i].role === 'user' && /\[(K[1-9])\]/.test(textOf(msgs[i]))) { lastUser = i; break } }
    const marker = lastUser >= 0 ? (textOf(msgs[lastUser]).match(/\[(K[1-9])\]/) || [])[1] : null
    const results = msgs.slice(lastUser + 1).filter((x) => x.role === 'tool').map(textOf)
    if (probe.seen.length < 20) probe.seen.push({ marker, results: results.length })
    const COMMANDS = { K2: 'touch \"$HOME/kaby-mode-live-check.txt\"', K3: 'curl -s -m 2 -o /dev/null http://192.0.2.1/kaby-mode-live-check', K4: 'rm -rf \"$HOME/kaby-mode-live-check-dir\"' }
    // when the bash tool has a switch that asks to leave the sandbox, the stub flips it: that is what makes a real agent ask the person
    const props = probe.bash && probe.bash.properties ? Object.keys(probe.bash.properties) : []
    const extra = {}
    for (const name of props) { const d = probe.bash.properties[name]; if (/escalat|sandbox|approval|permission|unsafe/i.test(name) && d && d.type === 'boolean') extra[name] = true }
    probe.extra = extra
    if (COMMANDS[marker] !== undefined && results.length === 0) {
      sse(res, { role: 'assistant', tool_calls: [{ index: 0, id: 'call_' + marker, type: 'function', function: { name: 'bash', arguments: JSON.stringify(Object.assign({ command: COMMANDS[marker], description: 'A command the engine may ask about' }, extra)) } }] }, 'tool_calls')
      return
    }
    if (COMMANDS[marker] !== undefined) { sse(res, { role: 'assistant', content: 'Done: the command ran.' }, 'stop'); return }
    sse(res, { role: 'assistant', content: 'Hello. This is a stub answer, long enough to wrap on a phone: Kaby would help you with your day, your mail and your files.' }, 'stop')
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const stubPort = server.address().port

const profile = join(home, 'profiles', 'web', 'cordis.patch.yml')
const backup = profile + '.bak-kaby-mode'
const anchor = '- id: llm-pi-ai\n  config:\n    providers:\n'
const patch = existsSync(profile) ? readFileSync(profile, 'utf8') : ''
if (patch.indexOf(anchor) < 0) { console.error('○ inconclusive: the sandbox profile has no llm-pi-ai providers block to add the stub model to'); process.exit(3) }
const sandbox = (script, extraEnv) => spawnSync('bash', [join(here, 'sandbox', script)], { env: Object.assign({}, process.env, { KB_SANDBOX_TTL: '10800' }, extraEnv || {}), encoding: 'utf8', timeout: 240000 })
const restart = (extraEnv) => { sandbox('stop.sh'); return sandbox('start.sh', extraEnv).status === 0 }
const provider = '      kbstub:\n        api: openai-completions\n        baseURL: http://127.0.0.1:' + stubPort + '/v1\n        apiKeyEnv: KB_STUB_KEY\n        models:\n          - id: kbstub/stub-1\n            name: Stub\n'

// ── the page, as the shell's WebView would show it ────────────────────────────────────────────────────────────
let g = null
let shellScript = null
const shot = async (name) => { try { await g.shot(join(OUT, 'shots', name + '.png')) } catch (e) { /* no shot */ } }
const val = (js) => g.val(js)
const SHELL_JS = 'window.__kbOut = []; window.ReactNativeWebView = { postMessage: function (s) { try { window.__kbOut.push(JSON.parse(s)) } catch (e) { window.__kbOut.push({ raw: String(s) }) } } };'
const open = async ({ ua, shell = true, dark = false, width = 390, height = 844 }) => {
  await g.val(`(() => { try { const k = 'kybernos.theme.v1'; const v = JSON.parse(localStorage.getItem(k) || '{}'); v.mode = ${dark ? "'dark'" : "'light'"}; localStorage.setItem(k, JSON.stringify(v)) } catch (e) { /* no storage */ } })()`)
  const send = (m, p) => g.page.send(m, p)
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true })
  await send('Emulation.setTouchEmulationEnabled', { enabled: true })
  await send('Emulation.setUserAgentOverride', { userAgent: ua, platform: /Android/.test(ua) ? 'Linux armv81' : 'iPhone' })
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] })
  if (shellScript !== null) { try { await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: shellScript }) } catch (e) { /* gone */ } shellScript = null }
  if (shell) { const r = await send('Page.addScriptToEvaluateOnNewDocument', { source: SHELL_JS }); shellScript = r && r.identifier ? r.identifier : null }
  await g.val('window.__kbStale = true')
  await send('Page.reload', { ignoreCache: true })
  await g.waitFor("window.__kbStale === undefined && document.readyState === 'complete'", 30000)
  await sleep(1500)
}
const shellSays = (m) => val(`(() => { const a = window.__KB_APP__; return a && typeof a.receive === 'function' ? a.receive(${JSON.stringify(m)}) : null })()`)
// `layers` (depth of the open sheets, contract §8) is posted by both the full app and Kaby mode; test-layers.mjs owns it, so the older checks do not count it
const out = async () => ((await val('window.__kbOut || []')) || []).filter((m) => m.kybernos !== 'layers' && m.kybernos !== 'local-llm')
const SHELL_STATE = { kybernos: 'shell-state', version: 1, capabilities: { authorize: true, notifications: true, screens: ['account', 'plan', 'help', 'notification-settings'] }, notifications: 'undetermined', connection: 'cloud' }

// what is drawn: an element is drawn when it has a box and nothing hides it (itself or an ancestor)
const DRAWN_JS = `const own = (e) => { const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden') return false; if (s.display === 'contents') return Array.from(e.children).some(own); const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 }; const drawn = (e) => { if (!e) return false; for (let n = e.parentElement; n && n.nodeType === 1; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden') return false } return own(e) };`
const drawnCount = (sel) => val(`(() => { ${DRAWN_JS} return Array.from(document.querySelectorAll(${JSON.stringify(sel)})).filter(drawn).length })()`)
const countAll = (sel) => val(`document.querySelectorAll(${JSON.stringify(sel)}).length`)
const visibleText = () => val('document.body.innerText')
// the words a person can read now: text nodes that are drawn and inside the screen (the closed drawer is off-canvas, the model picker is the web app's own and names the model in use, so its words are not the page's wording)
const screenText = () => val(`(() => { const w = innerWidth, h = innerHeight; const hidden = (e) => { for (let n = e; n && n.nodeType === 1; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden') return true } return false }; const out = []; const it = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); for (let t = it.nextNode(); t; t = it.nextNode()) { const e = t.parentElement; if (!e || !t.nodeValue.trim() || e.closest('[data-kb="model-seat"], script, style') || hidden(e)) continue; const r = document.createRange(); r.selectNodeContents(t); const b = r.getBoundingClientRect(); if (b.width > 0 && b.height > 0 && b.right > 0 && b.left < w && b.bottom > 0 && b.top < h) out.push(t.nodeValue.trim()) } return out.join(' ') })()`)
const sideways = () => val('(() => ({ doc: document.documentElement.scrollWidth, body: document.body.scrollWidth, view: window.innerWidth }))()')
const press = async (sel, ms = 6000) => { const ok = await g.press(sel, ms); await sleep(400); return ok }
const waitFor = (fn, ms = 20000, step = 250) => g.until(fn, ms, step)

let folder = null
try {
  // a run that was killed leaves its stub model in the profile (and a doubled one would stop the engine from starting): the backup is always the profile without it
  const clean = patch.replace(/ {6}kbstub:\n(?: {8,}.*\n)+/, '')
  writeFileSync(backup, clean)
  writeFileSync(profile, clean.replace(anchor, anchor + provider))
  console.log('\n── set up: a stub model, a first answer so that the chat exists ──')
  check('the sandbox restarts with a stub model', restart({ KB_STUB_KEY: 'stub' }) === true)
  g = await openGui(host, { width: 1500, height: 950 })
  await g.reload()
  await g.selectModel('Stub')
  await g.send('[K1] hello')
  const first = await waitFor(async () => (/stub answer/.test(String(await visibleText())) ? true : null), 40000)
  check('the stub model answers in the full desktop GUI', first === true)
  folder = true

  console.log('\n── A: the full app, and a browser that carries the token ──')
  await open({ ua: FULL_UA })
  const fullApp = await val(`(() => ({ cls: document.documentElement.classList.contains('${KABY_CLASS}'), app: document.documentElement.classList.contains('kb-app'), mode: window.__KB_APP__ ? window.__KB_APP__.mode || null : 'no seam', keys: window.__KB_APP__ ? Object.keys(window.__KB_APP__).sort().join() : null, bar: !!document.querySelector('[data-kb="kaby-bar"]'), style: !!document.getElementById('${KABY_STYLE_ID}') }))()`)
  note('A the full app, as seen', fullApp)
  check('the full app has no Kaby class, no Kaby mode on its seam, no Kaby bar', fullApp.cls === false && fullApp.app === true && fullApp.mode === null && fullApp.bar === false && !/mode/.test(String(fullApp.keys)), fullApp)
  check('the page head carries the rules anyway (they are all under html.kb-kaby)', fullApp.style === true)
  const fullKeeps = {
    model: await drawnCount('button[aria-label^="Select model"]'),
    header: await drawnCount('[data-slot="conversation.header"], [data-slot="conversation.session.header"]'),
    strip: await drawnCount('[data-kb="kybernos-kyber-dock"]'),
    menu: await drawnCount('[data-kb="mobile-menu"]')
  }
  note('A what the full app still draws', fullKeeps)
  check('the full app still draws what Kaby mode hides: the model picker and the menu button that opens the sidebar', fullKeeps.model > 0 && fullKeeps.menu > 0, fullKeeps)
  await shot('A1-full-app-390')

  await open({ ua: BROWSER_UA, shell: false })
  const inBrowser = await val(`(() => ({ cls: document.documentElement.classList.contains('${KABY_CLASS}'), bar: !!document.querySelector('[data-kb="kaby-bar"]'), seam: !!window.__KB_APP__ }))()`)
  check('a browser that carries the words (it is not the app) is not Kaby mode', inBrowser.cls === false && inBrowser.bar === false && inBrowser.seam === false, inBrowser)

  console.log('\n── B: Kaby mode ──')
  await open({ ua: KABY_UA })
  const html = await val(`(async () => { const t = await (await fetch(location.pathname, { credentials: 'same-origin' })).text(); const head = t.indexOf('</head>'); const first = t.search(/<script[^>]+src=/); return { style: t.indexOf('id="${KABY_STYLE_ID}"'), script: t.indexOf('classList.add(\\'${KABY_CLASS}\\')'), headEnd: head, firstBundle: first, firstBundleTag: first < 0 ? '' : t.slice(first, first + 90) } })()`)
  note('B the served page: where the stylesheet and the class script sit (index in the HTML)', html)
  check('the class script and the stylesheet are in the page head, so the class is there while the page is parsed, before the body and before any React render: the first paint is already Kaby\'s', html.style > 0 && html.script > 0 && html.style < html.headEnd && html.script < html.headEnd, html)
  const up = await waitFor(async () => ((await drawnCount('[data-kb="mobile-menu"]')) > 0 && (await drawnCount('[data-slot="conversation.composer.bar"]')) > 0 ? true : null), 30000)
  check('the phone\'s own burger and the composer are there, with no tap: Kaby\'s conversation opened by itself', up === true)
  const state = await val(`(() => ({ cls: document.documentElement.classList.contains('${KABY_CLASS}'), app: document.documentElement.classList.contains('kb-app-ios'), mode: window.__KB_APP__ && window.__KB_APP__.mode, v: window.__KB_APP__ && window.__KB_APP__.modeVersion, title: document.title }))()`)
  note('B the page state', state)
  check('<html> is marked and the seam says Kaby mode, version 1', state.cls === true && state.app === true && state.mode === 'kaby' && state.v === 1, state)
  const o1 = await out()
  check('the shell heard « kaby-ready » (once, first), then the old entry message', o1.length >= 2 && o1[0].kybernos === 'kaby-ready' && o1[0].mode === 'kaby' && o1[0].modeVersion === 1 && o1[0].platform === 'ios' && o1.filter((m) => m.kybernos === 'kaby-ready').length === 1 && o1[1].kybernos === 'app-entry', o1)
  await shellSays(SHELL_STATE)
  const settled = await waitFor(async () => ((await drawnCount('[data-slot="conversation.chat.flow"]')) > 0 ? true : null), 20000)
  note('B the conversation settled (drawn) before the measures', settled === true)
  await sleep(500)
  note('B the frame\'s grid and the editable field', await val(`(() => { const f = document.querySelector('[data-slot="root"] > div:has(> [data-shell-overlay])'); const e = document.querySelector('[contenteditable="true"]'); return f ? { cols: getComputedStyle(f).gridTemplateColumns, attrs: Array.from(f.attributes).map((a) => a.name + '=' + a.value.slice(0, 60)).filter((x) => !/^class/.test(x)), editableWidth: e ? Math.round(e.getBoundingClientRect().width) : null } : null })()`))

  // a right bar left open by an earlier visit puts a third, empty column in the frame's inline template: the chat must keep its width
  const forced = await val(`(() => { const f = document.querySelector('[data-slot="root"] > div:has(> [data-shell-overlay])'); const e = document.querySelector('[contenteditable="true"]'); const was = f.getAttribute('style'); f.style.gridTemplateColumns = '0px minmax(0px, 1fr) 340px'; const w = e.getBoundingClientRect().width; f.setAttribute('style', was); return { width: Math.round(w), restored: f.getAttribute('style') === was } })()`)
  check('with a 340 px third column in the frame\'s own style (a right bar left open), the chat keeps its width (the stylesheet wins over the inline template)', forced.width >= 300 && forced.restored === true, forced)

  // what is shown, what is hidden — measured on the page
  const shown = {}
  for (const row of KABY_SHOW) shown[row.id] = { present: await countAll(row.probe), drawn: await drawnCount(row.probe) }
  note('B the show list on an empty chat (present / drawn)', shown)
  check('the conversation, the composer and the phone\'s burger are drawn (the avatar and the Settings dialog only with the drawer or the dialog open)', ['conversation', 'composer', 'drawer'].every((id) => shown[id].drawn > 0) && (await countAll('[data-kb="kaby-bar"], [data-kb="kaby-menu"], [data-kb="kaby-settings"]')) === 0, shown)
  const hidden = {}
  const leaks = []
  for (const row of KABY_HIDE) {
    for (const sel of row.css) {
      const present = await countAll(sel)
      const d = await drawnCount(sel)
      hidden[row.id + ' ' + sel] = present + '/' + d
      if (d > 0) leaks.push([row.id, sel, d])
    }
  }
  note('B the hide list on an empty chat (elements present / drawn)', hidden)
  check('nothing of the hide list is drawn (every selector that matches something matches only what is not drawn)', leaks.length === 0, leaks)
  const mentioned = Object.entries(hidden).filter(([, v]) => v.split('/')[0] !== '0').length
  check('and the list is not matching nothing (the page has elements for most of its selectors)', mentioned >= 5, mentioned)
  check('the access-mode shield is not drawn, and the web\'s own model picker is (step 6: Simple keeps the web app\'s picker, there is no answer chip)', (await drawnCount('[data-slot="conversation.input.permission"]')) === 0 && (await drawnCount('button[aria-label^="Select model"]')) > 0 && (await countAll('[data-kb="kaby-chip"]')) === 0)
  const said = String(await screenText())
  const forbidden = ['DeepSeek', 'Harness', 'Remote control', 'This computer', 'Telegram', 'WhatsApp', 'Add a model', 'Workspace Write', 'Creations', 'Automations', 'Connectors', 'Skills', 'Agent Teams', 'Front desk', 'Workspaces', 'Stub']
  note('B the words drawn on an empty chat', said.replace(/\s+/g, ' ').slice(0, 300))
  check('no word of the engine\'s wording is on screen (DeepSeek Harness, Remote control, This computer, Telegram, the sidebar pages, a model name)', forbidden.every((w) => said.indexOf(w) < 0), forbidden.filter((w) => said.indexOf(w) >= 0))
  note('B the document title', state.title)
  check('the document title does not say « DeepSeek Harness »', !/DeepSeek Harness/i.test(String(state.title)), state.title)
  const sw = await sideways()
  check('no sideways scroll at 390 px', sw.doc <= sw.view && sw.body <= sw.view, sw)
  const topBox = await val(`(() => { const b = document.querySelector('[data-kb="mobile-menu"]'); const c = document.querySelector('[data-slot="conversation.composer.bar"] [contenteditable="true"]'); const r = b.getBoundingClientRect(); const q = c.getBoundingClientRect(); return { burgerTop: r.top, burgerLeft: r.left, burgerW: r.width, burgerH: r.height, composerTop: q.top, composerBottom: q.bottom, view: window.innerHeight } })()`)
  note('B the burger and the composer, measured', topBox)
  check('the burger is in the top-left corner as a 44 px target, and the composer is inside the screen', topBox.burgerLeft < 80 && topBox.burgerTop < 80 && topBox.burgerW >= 44 && topBox.burgerH >= 44 && topBox.composerBottom <= topBox.view, topBox)
  await shot('B1-kaby-empty-390')

  console.log('\n── B: an answer, and DSH\'s approval card ──')
  note('B the editable fields before sending', await val(`Array.from(document.querySelectorAll('[contenteditable], textarea')).map((e) => { const r = e.getBoundingClientRect(); return [e.tagName, Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] })`))
  await g.send('[K1] Say hello')
  const answered = await waitFor(async () => ((String(await visibleText()).match(/stub answer/g) || []).length >= 2 ? true : null), 40000)
  check('a new answer comes, with a « Report » link under each answer', answered === true && (await countAll('[data-kb="report-tail"]')) >= 2, await countAll('[data-kb="report-tail"]'))
  await sleep(1200)
  const answerState = {}
  for (const row of KABY_SHOW) answerState[row.id] = await drawnCount(row.probe)
  note('B the show list once there is an answer (drawn)', answerState)
  check('the answers and the « Report » link are drawn', answerState.answers > 0 && answerState.report > 0, answerState)
  const extras = { summarize: await drawnCount('[data-kb-edit="summarize"]'), action: await drawnCount('[data-kb-add]'), kabyStrip: await drawnCount('[data-kb="kybernos-kyber-dock"]') }
  check('under the answer: no « summarize », no « Action »; above the composer: no Kaby strip', extras.summarize === 0 && extras.action === 0 && extras.kabyStrip === 0, extras)
  const said2 = String(await visibleText())
  const onScreen2 = String(await screenText())
  check('the answer is on screen and still none of the engine\'s wording', /stub answer/.test(said2) && forbidden.filter((w) => w !== 'Stub').every((w) => onScreen2.indexOf(w) < 0), forbidden.filter((w) => onScreen2.indexOf(w) >= 0))
  const sw2 = await sideways()
  check('still no sideways scroll with an answer on screen', sw2.doc <= sw2.view && sw2.body <= sw2.view, sw2)
  // The old answer chip sat on the first message (owner, 2026-11-22). Nothing may now: what a finger hits at the centre of each of the person's messages drawn is the message itself, and the model picker sits in the composer.
  const firstHit = await val(`(() => { const seen = Array.from(document.querySelectorAll('*')).filter((e) => { if (e.children.length !== 0 || !/\\[K1\\]/.test(e.textContent || '')) return false; const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight && !e.closest('[data-slot="sidebar"], nav, aside') }); if (seen.length === 0) return { found: 0 }; const hit = seen.map((t) => { const r = t.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !(top && (t.contains(top) || top.contains(t))) }); const seat = document.querySelector('[data-kb="model-seat"]'); const sb = seat ? seat.getBoundingClientRect() : null; const last = seen[seen.length - 1].getBoundingClientRect(); return { found: seen.length, overlapped: hit.filter(Boolean).length, seatInComposer: !!seat && !!seat.closest('[data-composer-card]'), seatBelowMessages: !!sb && sb.top > last.bottom } })()`)
  check('nothing sits on a message of the person (a tap at the centre of each one drawn reaches it), and the model picker is in the composer, below them', !!firstHit && firstHit.found > 0 && firstHit.overlapped === 0 && firstHit.seatInComposer === true && firstHit.seatBelowMessages === true, firstHit)
  await shot('B2-kaby-answer-390')
  const reportOpened = await press('[data-kb="report-tail"] button, [data-kb="report-tail"] a', 4000)
  await sleep(600)
  await shot('B3-kaby-report-390')
  note('B the Report control opened something', reportOpened)
  await val(`(() => { const b = document.querySelector('[data-kb="report-tail"] button[aria-expanded="true"]'); if (b) b.click() })()`)

  const askedBefore = (await out()).filter((m) => m.kybernos === 'notifications-ask').length
  let card = null
  for (const [marker, words] of [['K2', 'Please leave a note in my home folder'], ['K3', 'Please fetch an address on this computer'], ['K4', 'Please remove a folder']]) {
    if (card === true) break
    await g.send('[' + marker + '] ' + words)
    card = await waitFor(async () => ((await drawnCount('[data-slot*="approval"]')) > 0 ? true : (/the command ran/.test(String(await visibleText())) ? 'ran' : null)), 30000)
    note('B ' + marker + ' (' + words + '): did DSH ask for approval?', card)
  }
  note('B the stub model saw the bash tool take these properties, and set these', { props: probe.bash && probe.bash.properties ? Object.keys(probe.bash.properties) : null, extra: probe.extra })
  if (card !== true) {
    notSeen('DSH\'s own approval card did not appear with the stub model (bash writing in the home folder, a network call, an rm, in « Workspace Write »: the engine ran them without asking, the bash tool has no escalation switch): how DSH\'s real card LOOKS at 390 px, and that the hook `[data-slot*="approval"]` draws on it, are NOT verified (the hook is the engine\'s own slot name `conversation.approval.card`, read in its source)')
    await shot('B4-no-approval-390')
    // the trigger and the message, on a stand-in element that carries the engine's real slot name
    const askedNow = (await out()).filter((m) => m.kybernos === 'notifications-ask').length
    await val(`(() => { const d = document.createElement('div'); d.id = 'kb-test-card'; d.setAttribute('data-slot', 'conversation.approval.card'); d.textContent = 'test card'; document.body.appendChild(d) })()`)
    await sleep(1800)
    const asksT = (await out()).filter((m) => m.kybernos === 'notifications-ask')
    check('(on a stand-in element carrying the engine\'s slot name) an approval card appearing makes the page ask the shell for the permission once (reason: approval), with no word of anyone\'s', asksT.length === askedNow + 1 && asksT[asksT.length - 1].why === 'approval' && Object.keys(asksT[asksT.length - 1]).sort().join() === 'id,kybernos,version,why', asksT)
    await val(`document.getElementById('kb-test-card').remove()`)
    await shellSays({ kybernos: 'notifications-state', version: 1, state: 'undetermined' })
  } else {
    check('DSH\'s own approval card is drawn on the page, in the show list\'s hook', card === true)
    await sleep(1200)
    await shot('B4-kaby-approval-390')
    const cardBox = await val(`(() => { ${DRAWN_JS} const c = Array.from(document.querySelectorAll('[data-slot*="approval"]')).find(drawn); const r = c.getBoundingClientRect(); const b = Array.from(c.querySelectorAll('button')).map((x) => ({ t: (x.innerText || '').trim(), w: Math.round(x.getBoundingClientRect().width), h: Math.round(x.getBoundingClientRect().height) })); return { l: r.left, r: r.right, view: innerWidth, buttons: b, text: (c.innerText || '').replace(/\\s+/g, ' ').slice(0, 160) } })()`)
    note('B the approval card', cardBox)
    check('the card fits the screen and has its buttons', cardBox.l >= 0 && cardBox.r <= cardBox.view && cardBox.buttons.length >= 2, cardBox)
    const asks = (await out()).filter((m) => m.kybernos === 'notifications-ask')
    check('the first approval card makes the page ask the shell for the notification permission (reason: approval), once', asks.length === askedBefore + 1 && asks[asks.length - 1].why === 'approval', asks)
    check('that message carries no word of anyone\'s: only the type, the version, an id and the reason', Object.keys(asks[asks.length - 1]).sort().join() === 'id,kybernos,version,why', asks[asks.length - 1])
    const allowed = await g.pressText('Allow once')
    note('B « Allow once » pressed', allowed)
    const done = await waitFor(async () => (/the command ran/.test(String(await visibleText())) ? true : null), 40000)
    check('answering the card in the page lets the turn go on to its answer', done === true && (await drawnCount('[data-slot*="approval"]')) === 0, { done })
    await shot('B5-kaby-after-approval-390')
  }
  const asks2 = (await out()).filter((m) => m.kybernos === 'notifications-ask')
  check('the permission was asked at most once in this load', asks2.length <= 1, asks2)
  await shellSays(SHELL_STATE)

  console.log('\n── C: Settings of Simple (the real dialog, About with the app\'s parts) and the connection card ──')
  const SETTINGS = '[data-shortcut-modal="settings"]'
  // the cloud half of the connections is stubbed in the page (the sandbox has no Kybernos account): what the connection card asks of the server is recorded here
  await val(`(() => {
    const real = window.fetch.bind(window)
    window.__kbCalls = []
    window.__kbItem = 'pending'
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    window.fetch = (u, init) => {
      const path = typeof u === 'string' ? u : (u && u.url) || ''
      if (path.indexOf('/kybernos-cloud/connections') !== 0) return real(u, init)
      const method = (init && init.method) || 'GET'
      window.__kbCalls.push(method + ' ' + path + (init && init.body ? ' ' + init.body : ''))
      if (path === '/kybernos-cloud/connections') return Promise.resolve(json(200, { ok: true, offered: true, entitled: true, connections: [{ id: 'c1', toolkit: 'gmail', alias: 'Gmail', status: 'active' }, { id: 'c2', toolkit: 'notion', alias: '', status: 'pending' }] }))
      if (path.indexOf('/kybernos-cloud/connections/apps') === 0) return Promise.resolve(json(200, { ok: true, apps: [{ slug: 'github', name: 'GitHub' }, { slug: 'slack', name: 'Slack' }, { slug: 'stripe', name: 'Stripe', needsApiKey: true }] }))
      if (path.indexOf('/kybernos-cloud/connections/link') === 0) return Promise.resolve(json(200, { ok: true, redirectUrl: 'https://accounts.example.com/o/auth?app=github', connection: { id: 'c9', status: 'pending' } }))
      if (path.indexOf('/kybernos-cloud/connections/item') === 0) return Promise.resolve(json(200, { ok: true, connection: { id: 'c9', status: window.__kbItem } }))
      if (path.indexOf('/kybernos-cloud/connections/delete') === 0) return Promise.resolve(json(200, { ok: true }))
      return Promise.resolve(json(404, { ok: false }))
    }
  })()`)
  const drawerIsOpen = () => val(`(() => { const r = document.querySelector('[data-slot="root"] > div'); return r ? !r.hasAttribute('data-sidebar-collapsed') : null })()`)
  const openAppPage = async () => {
    if ((await drawerIsOpen()) !== true) { await press('[data-kb="mobile-menu"]'); await sleep(500) }
    await press('[data-kb="mobile-avatar"]'); await sleep(500)
    await press('[data-kb="menu-settings"]')
    const up = await waitFor(async () => ((await drawnCount(SETTINGS)) > 0 ? true : null), 10000)
    await press(SETTINGS + ' [data-kb-t="about"]'); await sleep(1800)
    return up === true
  }
  // on a page the phone layout shows a back button (to the list of pages); « Back to workspace » is then the second tap
  const closeSettings = async () => {
    if (await val(`!!document.querySelector('${SETTINGS}[data-kbmob-page]')`)) { await press(SETTINGS + ' [data-kbmob-backbtn]'); await sleep(600) }
    await press(SETTINGS + ' .kbsb'); await sleep(800)
  }
  check('the drawer\'s avatar opens the account menu, and its Settings opens DSH\'s own dialog, and About carries the app\'s parts', (await openAppPage()) === true)
  const sections = await val(`Array.from(document.querySelectorAll('${SETTINGS} section[data-kb^="kaby-"]')).map((s) => s.getAttribute('data-kb'))`)
  note('C the sections of the phone-only part of the page', sections)
  check('three sections, in order: Notifications, Account and plan, Help and report (« Need more? » only when the shell says it can switch); « Your computer » only when a computer is linked (the locked preset\'s `appPage.computer`, step 6 part 3), none is here', JSON.stringify(sections) === '["kaby-notifications","kaby-account","kaby-help"]', sections)
  const settingsText = String(await val(`Array.from(document.querySelectorAll('${SETTINGS} section[data-kb^="kaby-"]')).map((s) => s.innerText).join(' ')`))
  check('nothing of the engine\'s wording is in them: no plugins, MCP, model keys, execution environment, advanced, remote control', !/plugin|MCP|API key|Execution|Advanced|Remote control|DeepSeek|Harness|Telegram/i.test(settingsText), settingsText.slice(0, 300))
  const notif = String(await val(`document.querySelector('[data-kb="kaby-notifications-line"]').innerText`))
  note('C the notifications line (permission undecided)', notif)
  check('Notifications says it is off and offers « Turn on » (the permission is undecided)', /^Off\./.test(notif) && (await countAll('[data-act="kaby-notifications-on"]')) === 1, notif)
  const beforeOn = (await out()).length
  await press('[data-act="kaby-notifications-on"]')
  const askedOn = (await out()).slice(beforeOn).filter((m) => m.kybernos === 'notifications-ask')
  check('« Turn on » asks the shell (reason: settings), with no word of anyone\'s', askedOn.length === 1 && askedOn[0].why === 'settings' && Object.keys(askedOn[0]).sort().join() === 'id,kybernos,version,why', askedOn)
  await shellSays({ kybernos: 'notifications-state', version: 1, state: 'granted' })
  await sleep(300)
  const notifOn = String(await val(`document.querySelector('[data-kb="kaby-notifications-line"]').innerText`))
  check('once the shell says granted: « On », a notification never carries what was said, and no « Turn on »', /^On\./.test(notifOn) && /never what was said/.test(notifOn) && (await countAll('[data-act="kaby-notifications-on"]')) === 0, notifOn)
  const compLine = String(await val(`document.querySelector('[data-kb="kaby-computer-line"]').innerText`))
  note('C the computer line', compLine)
  check('Your computer says the cloud computer is the place (the shell said « cloud »)', compLine.length > 5 && !/Remote control|Telegram/.test(compLine), compLine)
  await shot('C1-settings-kybernos-app-390')
  const accountActs = await val(`Array.from(document.querySelectorAll('[data-kb="kaby-account"] button, [data-kb="kaby-help"] button')).map((b) => b.getAttribute('data-act'))`)
  check('Account and plan opens the shell\'s own screens, and Help has the report link', ['kaby-open-account', 'kaby-open-plan'].every((a) => accountActs.includes(a)) && (await countAll('[data-kb="kaby-help"] [data-kb="report-tail"], [data-kb="kaby-help"] .kbrp')) > 0, accountActs)
  const before = (await out()).length
  await press('[data-act="kaby-open-plan"]')
  const plan = (await out()).slice(before)
  check('« My plan » asks the shell for the plan screen (a message, no new window)', plan.length === 1 && plan[0].kybernos === 'open-screen' && plan[0].screen === 'plan', plan)
  const small = await val(`Array.from(document.querySelectorAll('${SETTINGS} section[data-kb^="kaby-"] button')).filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && (r.height < 40) }).map((b) => (b.innerText || b.getAttribute('aria-label') || '').slice(0, 30))`)
  check('every button of the phone-only sections is at least 40 px high (a thumb)', small.length === 0, small)
  await closeSettings()
  check('« Back to workspace » closes the dialog: the conversation is back', (await drawnCount(SETTINGS)) === 0 && (await drawnCount('[data-composer-input]')) > 0)
  // a request from another bundle (the window event the connectors use) becomes a card
  await val(`window.__kbCalls = []; window.dispatchEvent(new CustomEvent('kb-connect-request', { detail: { toolkit: 'github', name: 'GitHub' } }))`)
  await sleep(700)
  check('an event from another bundle (kb-connect-request) makes a card (nothing is sent yet)', (await countAll('[data-kb="kaby-connect-card"][data-kb-phase="asking"]')) === 1)
  const callsAsking = await val('window.__kbCalls')
  check('before the person taps « Connect » nothing was asked of the server for it (no link, no connection)', !callsAsking.some((c) => /connections\/link/.test(c)), callsAsking)
  await shot('C3-connect-asking-390')
  const cardText = String(await val(`document.querySelector('[data-kb="kaby-connect-card"]').innerText`))
  check('the card says what Kaby wants and that the person signs in on the app\'s own page', /Kaby wants to connect GitHub/.test(cardText) && /never sees your password/.test(cardText) && /Connect/.test(cardText) && /Not now/.test(cardText), cardText)
  const cardGeom = await val(`(() => { const c = document.querySelector('[data-kb="kaby-connect-card"]'); const r = c.getBoundingClientRect(); return { l: r.left, r: r.right, b: r.bottom, view: innerWidth, vh: innerHeight, btn: Array.from(c.querySelectorAll('button')).map((x) => Math.round(x.getBoundingClientRect().height)) } })()`)
  check('the card fits the screen (inside it, buttons at least 44 px)', cardGeom.l >= 0 && cardGeom.r <= cardGeom.view && cardGeom.b <= cardGeom.vh && cardGeom.btn.every((h) => h >= 44), cardGeom)
  const mark = (await out()).length
  await press('[data-act="kaby-connect-accept"]')
  const authorizing = await waitFor(async () => ((await countAll('[data-kb="kaby-connect-card"][data-kb-phase="authorizing"]')) > 0 ? true : null), 8000)
  const sentAuth = (await out()).slice(mark).filter((m) => m.kybernos === 'authorize')
  check('« Connect » asks for the address, and hands it to the shell with an id (the system browser sheet is the shell\'s to open)', authorizing === true && sentAuth.length === 1 && sentAuth[0].url === 'https://accounts.example.com/o/auth?app=github' && sentAuth[0].app === 'github' && typeof sentAuth[0].id === 'string', sentAuth)
  const calls2 = await val('window.__kbCalls')
  check('and asked the cloud half once, for that app only', calls2.filter((c) => /connections\/link/.test(c)).length === 1 && /"toolkit":"github"/.test(calls2.find((c) => /connections\/link/.test(c)) || ''), calls2)
  await shot('C4-connect-authorizing-390')
  await shellSays({ kybernos: 'authorize-result', version: 1, id: 'not-an-id-asked', state: 'returned' })
  check('an answer for an id the page never asked is refused: the card is still waiting', (await countAll('[data-kb="kaby-connect-card"][data-kb-phase="authorizing"]')) === 1)
  await shellSays({ kybernos: 'authorize-result', version: 1, id: sentAuth[0].id, state: 'returned' })
  const checking = await waitFor(async () => ((await countAll('[data-kb="kaby-connect-card"][data-kb-phase="checking"]')) > 0 ? true : null), 6000)
  check('when the sheet is gone the page checks with the server (the server says pending: the card says « Checking »)', checking === true)
  await shot('C5-connect-checking-390')
  await val(`window.__kbItem = 'active'`)
  const connected = await waitFor(async () => ((await countAll('[data-kb="kaby-connect-card"][data-kb-phase="connected"]')) > 0 ? true : null), 15000, 500)
  check('once the server says active the card says it is connected', connected === true)
  await shot('C6-connect-connected-390')
  await press('[data-act="kaby-connect-done"]')
  check('« OK » closes the card', (await countAll('[data-kb="kaby-connect-card"]')) === 0)
  // « Not now »
  await val(`window.__kbCalls = []; window.dispatchEvent(new CustomEvent('kb-connect-request', { detail: { toolkit: 'slack', name: 'Slack' } }))`)
  await sleep(600)
  check('another bundle can ask through a window event, and the card shows', (await countAll('[data-kb="kaby-connect-card"][data-kb-phase="asking"]')) === 1)
  await press('[data-act="kaby-connect-decline"]')
  const calls3 = await val('window.__kbCalls')
  check('« Not now »: the card goes away and nothing was asked of the server', (await countAll('[data-kb="kaby-connect-card"]')) === 0 && calls3.length === 0, calls3)
  // a shell that cannot open the sign-in sheet
  await shellSays({ kybernos: 'shell-state', version: 1, capabilities: { authorize: false, notifications: true, screens: [] }, notifications: 'denied', connection: 'cloud' })
  await val(`window.__kbCalls = []; window.dispatchEvent(new CustomEvent('kb-connect-request', { detail: { toolkit: 'slack', name: 'Slack' } }))`)
  await sleep(500)
  await press('[data-act="kaby-connect-accept"]')
  await sleep(600)
  const unsupportedCard = String(await val(`(document.querySelector('[data-kb="kaby-connect-card"]') || { innerText: '' }).innerText`))
  const calls4 = await val('window.__kbCalls')
  check('a shell that cannot open the sign-in sheet: the card says to update the app, and nothing was started on the server', /cannot open the sign-in page yet/.test(unsupportedCard) && calls4.length === 0, { unsupportedCard, calls4 })
  await shot('C7-connect-unsupported-390')
  await press('[data-act="kaby-connect-close"]')
  await openAppPage()
  const notifDenied = String(await val(`document.querySelector('[data-kb="kaby-notifications-line"]').innerText`))
  check('with the permission refused on the phone, Notifications says so (and has no « Turn on »)', /phone’s settings|phone's settings/.test(notifDenied) && (await countAll('[data-act="kaby-notifications-on"]')) === 0, notifDenied)
  await closeSettings()
  check('and the dialog closes onto the conversation again', (await drawnCount(SETTINGS)) === 0 && (await drawnCount('[data-composer-input]')) > 0)

  console.log('\n── B2: Android, version 0 ──')
  await open({ ua: ANDROID_KABY_UA, dark: false })
  await waitFor(async () => ((await drawnCount('[data-kb="mobile-menu"]')) > 0 ? true : null), 25000)
  const droid = await val(`(() => ({ cls: document.documentElement.classList.contains('${KABY_CLASS}'), p: document.documentElement.classList.contains('kb-app-android'), out: (window.__kbOut || []).filter((m) => m.kybernos !== 'layers' && m.kybernos !== 'local-llm').map((m) => m.kybernos + ':' + (m.platform || '')) }))()`)
  check('on Android the same switch gives the same page (kb-app-android, kaby-ready says android)', droid.cls && droid.p && droid.out[0] === 'kaby-ready:android', droid)

  console.log('\n── B3: « where Kybernos runs »: the page\'s own pill is for a cloud connection only (step 6) ──')
  await open({ ua: KABY_UA + ' KybernosCaps/where KybernosPlace/local' })
  await sleep(3500)
  const localPill = await countAll('[data-kb="mobile-where"]')
  await open({ ua: KABY_UA + ' KybernosCaps/where KybernosPlace/cloud' })
  const cloudPill = await waitFor(async () => ((await drawnCount('[data-kb="mobile-where"]')) > 0 ? true : null), 15000)
  check('no « On this phone » pill on the phone\'s own connection (KybernosPlace/local); on a cloud connection (KybernosPlace/cloud) the pill that chooses the place is drawn over an open chat', localPill === 0 && cloudPill === true, { localPill, cloudPill })
  await shot('B3-cloud-where-390')

  await open({ ua: FULL_UA.replace('KybernosHost/0.1.0 (ios)', 'KybernosHost/0.1.0 (ios) KabyMode/0') })
  await sleep(2500)
  const zero = await val(`(() => ({ cls: document.documentElement.classList.contains('${KABY_CLASS}'), chip: !!document.querySelector('[data-kb="kaby-chip"]'), model: !!document.querySelector('button[aria-label^="Select model"]') }))()`)
  check('KabyMode/0 is the full app (no class, no answer chip (it is gone), the model picker is there)', zero.cls === false && zero.chip === false && zero.model === true, zero)

  notSeen('the shell itself (the real WebView, injectJavaScript, the system browser sheet, the real notification permission, the page\'s behaviour when the app goes to the background) is played by the script, not by a device')
  notSeen('the dark theme: the sandbox\'s theme comes from DSH\'s own settings, which the script did not switch (the chip and the card use only DSH\'s colour tokens, so they follow it: not looked at)')
  notSeen('a connection finished against a real provider (the cloud half is stubbed here: the sandbox has no Kybernos account), and the server page that closes the sheet')
  notSeen('the Account, Team settings and Referral windows (they open with window.open in the full app: listed in the contract, not driven)')
} catch (e) {
  failed += 1
  console.log('  ✗ the run broke: ' + (e && e.message ? e.message : e))
  report.error = String(e && e.stack ? e.stack : e)
} finally {
  try { if (g) await g.close() } catch (e) { /* gone */ }
  try { writeFileSync(profile, readFileSync(backup, 'utf8')) } catch (e) { /* kept */ }
  server.close()
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2))
  console.log('\n' + report.steps.filter((s) => s.ok).length + ' passed, ' + failed + ' failed, ' + report.notSeen.length + ' not seen. Evidence: ' + OUT)
  void folder
}
process.exit(failed > 0 ? 1 : 0)
