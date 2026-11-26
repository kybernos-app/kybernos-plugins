// The small model of the phone, against a REAL engine (contract tests 1, 2, 4 and 5 of LOCAL-MODELS-PLUGIN-CONTRACT.md), on either of the two the bundle must serve.
// A FAKE app server (the OpenAI subset of the contract, a random port and key) stands where the phone app's server would; the engine is started with the four
// KB_LOCAL_LLM_* variables and the bundle on, then a real chat is driven through the GUI: the provider is in the picker, Discussion is chosen for the chat,
// the request the engine sends has no tools and fits 480 tokens, the answer streams back, the app's `model_stopped` error shows its sentence (mid-answer and as a
// plain 503), and the key is in no file the engine wrote.
//
//   the sandbox (this checkout's DSH, 0.2.2):
//     source scripts/sandbox/env.sh && bash scripts/sandbox/setup.sh && node scripts/check-phone-model-chat.mjs
//   the engine the phone ships (0.2.1-rc.2), from the payload the app builds (`payload/build-payload.mjs` of the mobile repository, with @local/kybernos-phone-model
//   among its bundles; KB_LOCAL_LLM_ANY_PLATFORM=1 lets this Mac stand for the phone). The engine boots the way the phone app starts it (bootstrap.mjs), in a
//   throw-away folder; the first unpack of the payload takes a couple of minutes:
//     node scripts/check-phone-model-chat.mjs --payload <payload dir>        (or KB_PAYLOAD_DIR=<payload dir>)
//
// `--light` runs the same engine with an app that says its model takes tools (`"tools": true` on its row of GET /v1/models): the chat then gets the « Light agent » preset
// instead of Discussion, and the check proves what the engine sends (four small tools in the OpenAI format, today's date in the prompt, the size of it all), that a reminder
// waits for the person's approval before it runs, that a tool call outside the four is refused, and that the tool result goes back to the model. `--dump <file>` writes the
// first chat request of the run (the whole JSON body) to that file, to count its tokens with a real tokenizer.
//
// `--upgrade` (implies `--light`) starts with an app that does NOT say its model takes tools, so the blank chat is recorded on Discussion, then makes the app say it, waits for the host
// to name the light agent, reloads the page: the engine hands the same blank chat back under the preset its log recorded (Discussion), and the page must move it to the light agent.
// That is what happened on the phone: the chat the person opened was a blank one an earlier test had left on Discussion, and the light agent was never chosen.
//
// A `check-*` script (needs a headless Chrome): CI does not run it. It refuses to touch anything but the sandbox or its own throw-away engine, never the real DSH.
import crypto from 'node:crypto'
import http from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { openGui, sleep } from './lib-e2e-gui.mjs'
import { chooseWorkspace } from './live-page.mjs'
import { FIRST_REQUEST_TOKENS, LIGHT_FIXED_TOKENS, LIGHT_NAMES, LIGHT_TEXT, LIGHT_TOOLS, nowLine, roughTokens, SYSTEM_TEXT } from '../packages/kybernos-phone-model/phone-model.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const UPGRADE = process.argv.includes('--upgrade')
const LIGHT = process.argv.includes('--light') || UPGRADE
const FIRST_PRESET = LIGHT && !UPGRADE ? 'light-agent' : 'discussion' // the preset the host names at the start
const dumpAt = process.argv.indexOf('--dump')
const DUMP = dumpAt > 0 ? process.argv[dumpAt + 1] : null
const argAt = process.argv.indexOf('--payload')
const PAYLOAD = argAt > 0 ? process.argv[argAt + 1] : (process.env.KB_PAYLOAD_DIR || null)
if (PAYLOAD === null) {
  if (!process.env.KB_HOST || /:3080$/.test(process.env.KB_HOST) || !(process.env.DSH_HOME || '').includes('.kybernos-sandbox')) { console.error('REFUSED: source scripts/sandbox/env.sh first (this check only runs against the sandbox), or pass --payload <payload dir>'); process.exit(2) }
} else if (!existsSync(join(PAYLOAD, 'payload.kbpack')) || !existsSync(join(PAYLOAD, 'bootstrap.mjs'))) { console.error('REFUSED: ' + PAYLOAD + ' is not a payload dir built by payload/build-payload.mjs'); process.exit(2) }

let pass = 0
let fail = 0
const ok = (name, cond, detail) => { if (cond === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail !== undefined ? ' — ' + detail : '')) } }

// ── the fake app server ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const KEY = crypto.randomBytes(32).toString('base64url')
// the row the app's server really answers (localLlm.ts of the mobile repository): `created`, `owned_by`, the size, and `tools: true` only when the model takes tools
const MODEL = { id: 'qwen3-1.7b-q4_k_m', object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'kybernos-phone', name: 'Qwen3 1.7B', bytes: 1107409472, context: 4096, ...(LIGHT && !UPGRADE ? { tools: true } : {}) }
const NONCE = crypto.randomBytes(3).toString('hex')
const CANARY = 'zorblax' + crypto.randomBytes(3).toString('hex') // a word of the person's first message that exists nowhere else: if it shows up in anything the engine sent away, the message left the phone
const ANSWER = ['Hello', ' from', ' the small', ' model', ' on this phone ' + NONCE + '.']
const STOP_SENTENCE = 'The phone ran low on memory and stopped the small model.'
const seen = []
let mode = 'ok' // ok | stop-data (the app stops DURING an answer) | stop-503 (before the first word) | tool (the model calls automation_remind) | tool-bash (it calls a tool that is not one of the four) | tool-knowledge (it lists the knowledge folder)
const sse = (res, data, event) => res.write((event ? 'event: ' + event + '\n' : '') + 'data: ' + (typeof data === 'string' ? data : JSON.stringify(data)) + '\n\n')
const server = http.createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    let body = null
    try { body = raw === '' ? null : JSON.parse(raw) } catch (e) { body = null }
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, host: req.headers.host, body })
    if (req.headers.authorization !== 'Bearer ' + KEY) { res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'Wrong key', type: 'invalid_request_error', code: 'invalid_api_key' } })); return }
    if (req.method === 'GET' && req.url === '/v1/models') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ object: 'list', data: [MODEL] })); return }
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      if (body === null || (Array.isArray(body.tools) && body.tools.length > 0 && !LIGHT)) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'This model cannot use tools.', type: 'invalid_request_error', code: 'tools_not_supported' } })); return }
      const lightChat = LIGHT && Array.isArray(body.tools) && body.tools.length > 0
      const answeredByTool = Array.isArray(body.messages) && body.messages.length > 0 && body.messages[body.messages.length - 1].role === 'tool' // the result of the call that was just made, not one of an earlier turn
      if ((mode === 'tool' || mode === 'tool-bash' || mode === 'tool-knowledge') && lightChat && !answeredByTool) {
        const call = mode === 'tool'
          ? { name: 'automation_remind', arguments: JSON.stringify({ message: 'Remind the person to call the plumber.', at: '2026-11-13T09:00' }) }
          : mode === 'tool-knowledge' ? { name: 'kaby_knowledge', arguments: '{}' } : { name: 'bash', arguments: JSON.stringify({ command: 'ls' }) }
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
        const tc = (delta, finish, extra) => ({ id: 'chatcmpl-fake', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: finish || null }], ...(extra || {}) })
        sse(res, tc({ role: 'assistant', content: null, tool_calls: [{ index: 0, id: 'call_' + mode, type: 'function', function: { name: call.name, arguments: '' } }] }))
        sse(res, tc({ tool_calls: [{ index: 0, function: { arguments: call.arguments } }] }))
        sse(res, tc({}, 'tool_calls', { usage: { prompt_tokens: 600, completion_tokens: 30, total_tokens: 630 } }))
        sse(res, '[DONE]')
        res.end()
        return
      }
      if (mode === 'stop-503') { res.writeHead(503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: STOP_SENTENCE, type: 'server_error', code: 'model_stopped' } })); return }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      const chunk = (delta, finish, extra) => ({ id: 'chatcmpl-fake', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: finish || null }], ...(extra || {}) })
      sse(res, chunk({ role: 'assistant', content: '' }))
      const words = mode === 'ok' ? ANSWER : ANSWER.slice(0, 2)
      words.forEach((w, i) => setTimeout(() => sse(res, chunk({ content: w })), 30 * (i + 1)))
      setTimeout(() => {
        if (mode === 'stop-data') { sse(res, { error: { message: STOP_SENTENCE, type: 'server_error', code: 'model_stopped' } }); res.end(); return }
        sse(res, chunk({}, 'stop', { usage: { prompt_tokens: 60, completion_tokens: 8, total_tokens: 68 } }))
        sse(res, '[DONE]')
        res.end()
      }, 30 * (words.length + 2))
      return
    }
    res.writeHead(404, { 'content-type': 'application/json' }); res.end('{}')
  })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const PORT = server.address().port

// ── start the engine with the app's variables ────────────────────────────────────────────────────────────────────────────────────────────────────────
const MIN_ANSWER = 256 // an answer shorter than this is a cut-off chat (the engine once asked for ONE token and the answer stopped after one word)
const appEnv = { KB_LOCAL_LLM_URL: 'http://127.0.0.1:' + PORT + '/v1', KB_LOCAL_LLM_KEY: KEY, KB_LOCAL_LLM_CONTEXT: '4096', KB_LOCAL_LLM_MAX_TOKENS: '1024', KB_LOCAL_LLM_ANY_PLATFORM: '1' }
let engineLabel = 'the sandbox'
let stopEngine = () => spawnSync('bash', [join(ROOT, 'scripts/sandbox/stop.sh')], { env: process.env, stdio: 'ignore' })
let keyRoots = [process.env.DSH_HOME, join(process.env.DSH_HOME || '', '..', '..')]
let engineOut = () => ''
let EGRESS = null // payload mode only: the file the egress spy writes
if (PAYLOAD === null) {
  console.log('restarting the sandbox with the small model in its environment')
  const env = { ...process.env, ...appEnv, KB_SANDBOX_TTL: '3600' }
  spawnSync('bash', [join(ROOT, 'scripts/sandbox/stop.sh')], { env, stdio: 'ignore' })
  const started = spawnSync('bash', [join(ROOT, 'scripts/sandbox/start.sh')], { env, encoding: 'utf8', timeout: 180000 })
  if (started.status !== 0) { console.error('the sandbox did not start:\n' + String(started.stdout).slice(-600) + String(started.stderr).slice(-600)); server.close(); process.exit(1) }
  console.log('   engine: ' + String(spawnSync('dsh', ['--version'], { encoding: 'utf8' }).stdout || '').trim())
} else {
  const manifest = JSON.parse(readFileSync(join(PAYLOAD, 'payload.json'), 'utf8'))
  engineLabel = 'the payload engine ' + manifest.engine
  console.log('starting the payload engine ' + manifest.engine + ' with the small model in its environment (the first unpack takes a couple of minutes)')
  const work = realpathSync(mkdtempSync(join(tmpdir(), 'kb-phone-chat-'))) // the real path: the engine refuses a chat whose workspace it reads as /var/… and /private/var/… (macOS's tmp is a link)
  const home = join(work, 'home')
  mkdirSync(join(home, '.dsh', 'profiles', 'web'), { recursive: true })
  mkdirSync(join(work, 'ws'), { recursive: true }) // the workspace folder the app would have made
  // the sandbox does the same: a profile that has finished its welcome wizard (the wizard is not what this check is about)
  mkdirSync(join(home, '.dsh', 'kybernos'), { recursive: true })
  writeFileSync(join(home, '.dsh', 'kybernos', 'onboarding.json'), '{"version":1,"completed":true,"installedAt":"2026-01-01T00:00:00.000Z","completedAt":"2026-01-01T00:00:00.000Z","profil":"produit","uiMode":null}\n')
  const env = { ...process.env, KB_PAYLOAD: join(PAYLOAD, 'payload.kbpack'), KB_MANIFEST: join(PAYLOAD, 'payload.json'), KB_ROOT: join(work, 'runtime'), KB_HOME: home, KB_WORKSPACE: join(work, 'ws'), KB_PORT: '0', ...appEnv }
  delete env.KB_HOST
  // The phone with a cloud model connected, the usual case: a Claude key (a canary, it opens nothing) makes the phone's first-run seed name Claude as the DEFAULT model, so every call the
  // engine makes outside the chat's own route has somewhere remote to go. The spy refuses every connection that leaves the machine and writes down what it was and what it carried.
  EGRESS = join(work, 'egress.jsonl')
  env.ANTHROPIC_API_KEY = 'sk-ant-canary-' + crypto.randomBytes(8).toString('hex')
  env.KB_EGRESS_LOG = EGRESS
  env.NODE_OPTIONS = ((env.NODE_OPTIONS || '') + ' --import ' + pathToFileURL(join(HERE, 'lib-egress-spy.mjs')).href).trim()
  let out = ''
  const child = spawn(process.execPath, ['--expose-internals', join(PAYLOAD, 'bootstrap.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true }) // its own process group: one kill takes the engine and what it started
  child.stdout.on('data', (d) => { out += d }); child.stderr.on('data', (d) => { out += d })
  engineOut = () => out
  // Stopped at once, not on a timer: this script exits right after, a timer would never run and a slow engine would stay alive (ten of them did) with its folder.
  stopEngine = () => {
    try { process.kill(-child.pid, 'SIGKILL') } catch (e) { try { child.kill('SIGKILL') } catch (e2) { /* gone */ } }
    try { rmSync(work, { recursive: true, force: true, maxRetries: 3 }) } catch (e) { /* left in the temporary folder */ }
  }
  process.on('exit', () => stopEngine()) // also when the check itself crashes or is interrupted
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130))
  let address = null
  for (let i = 0; i < 480 && address === null; i += 1) { const m = /dsh web: (http:\/\/127\.0\.0\.1:(\d+)\/)/.exec(out); if (m !== null) address = m; else await sleep(500) }
  if (address === null) { console.error('the payload engine did not print its address:\n' + out.split('\n').filter((l) => !/^\s+at /.test(l)).slice(-12).join('\n')); stopEngine(); server.close(); process.exit(1) }
  process.env.KB_HOST = '127.0.0.1:' + address[2]
  process.env.DSH_HOME = join(home, '.dsh') // where the engine keeps the secret the page's session cookie is signed with
  keyRoots = [home, join(work, 'ws'), join(work, 'runtime', 'logs')]
  await sleep(4000) // the bundles finish mounting a moment after the address is printed
  const failure = /.*\[kybernos-phone-model\] (preset not registered|preset light-agent not registered|prompt variable not registered|disabled|settings refused|a step failed|the Discussion chat keeps its tools|the Light agent chat keeps its tools).*/.exec(out)
  console.log('   engine: ' + manifest.engine + ', on ' + process.env.KB_HOST)
  if (failure !== null) console.log('   the bundle says: ' + failure[0].slice(0, 200))
}

console.log('1. the provider reaches the engine')
let state = null
for (let i = 0; i < 30 && (state === null || state.installed !== true || state.preset === null); i += 1) {
  try { state = await (await fetch('http://' + process.env.KB_HOST + '/phone-model/state')).json() } catch (e) { state = null }
  if (state === null || state.installed !== true || state.preset === null) await sleep(1000)
}
ok('the state route answers { available, installed, model, preset } with no key and no address, and names the preset to select (the light agent once it is registered, else Discussion)', state !== null && state.available === true && state.installed === true && state.model.id === MODEL.id && Object.keys(state).sort().join() === 'available,installed,model,preset' && state.preset === FIRST_PRESET && state.model.tools === (FIRST_PRESET === 'light-agent') && !JSON.stringify(state).includes(KEY) && !JSON.stringify(state).includes(String(PORT)), JSON.stringify(state))
ok('the host asked the app\'s server for its models, with the key', seen.some((r) => r.method === 'GET' && r.url === '/v1/models' && r.auth === 'Bearer ' + KEY))

let sentAt = Date.now()
let otherPostsAtEnd = []
const g = await openGui(process.env.KB_HOST, { width: 1200, height: 900 })
try {
  if (PAYLOAD !== null) {
    // a fresh profile of the phone's engine shows the preview notice, and a new chat asks which workspace it is for (the sandbox, cloned from a used profile, has settled both)
    await g.until(() => g.val(`document.body.innerText.includes('Preview Notice')`), 15000)
    if ((await g.val(`document.body.innerText.includes('Preview Notice')`)) === true) { await g.pressText('Continue'); await sleep(800) }
    if ((await g.val(`document.body.innerText.includes('Choose a workspace to start')`)) === true) console.log('   workspace chosen: ' + await chooseWorkspace(g.page))
  }
  await g.waitFor(`document.querySelector('[data-composer-input], [contenteditable="true"]') !== null`, 30000)
  let selected = false
  try { selected = await g.selectModel('Qwen3 1.7B') } catch (e) { console.log('   ' + String(e.message).slice(0, 300)) }
  ok('the phone\'s model is in the picker, and can be chosen', selected === true)
  if (selected !== true) { console.log('   the page says: ' + JSON.stringify(String(await g.val('document.body.innerText')).slice(0, 500))); await g.shot('/private/tmp/claude-501/phone-model-nopicker.png') }
  await sleep(1500)
  if (UPGRADE) {
    console.log('1b. a blank chat the engine hands back already on Discussion goes to the light agent once the app says its model takes tools')
    const onDiscussion = await g.until(() => g.val(`(window.__KB_PHONE_MODEL__ && window.__KB_PHONE_MODEL__.seen && window.__KB_PHONE_MODEL__.seen.preset) === 'discussion'`), 20000)
    ok('before: the blank chat is on Discussion (the app did not say its model takes tools)', onDiscussion === true, JSON.stringify(await g.val('JSON.stringify(window.__KB_PHONE_MODEL__ && window.__KB_PHONE_MODEL__.seen)')))
    MODEL.tools = true // the app now says it, the way it does once its model is loaded
    let flipped = null
    for (let i = 0; i < 40 && !(flipped !== null && flipped.preset === 'light-agent'); i += 1) { await sleep(1500); try { flipped = await (await fetch('http://' + process.env.KB_HOST + '/phone-model/state')).json() } catch (e) { flipped = null } }
    ok('the host (it asks the app every ten seconds) now says the model takes tools and names the light agent', flipped !== null && flipped.preset === 'light-agent' && flipped.model.tools === true, JSON.stringify(flipped))
    await g.page.send('Page.reload', { ignoreCache: true })
    await sleep(3000)
    await g.waitFor(`document.querySelector('[data-composer-input], [contenteditable="true"]') !== null`, 40000)
    let moved = await g.until(() => g.val(`(window.__KB_PHONE_MODEL__ && window.__KB_PHONE_MODEL__.decided) === 'light-agent'`), 12000)
    if (moved !== true) { try { await g.selectModel('Qwen3 1.7B') } catch (e) { /* the chat kept the model */ } moved = await g.until(() => g.val(`(window.__KB_PHONE_MODEL__ && window.__KB_PHONE_MODEL__.decided) === 'light-agent'`), 40000) }
    ok('after the reload the page looked at the blank chat again and chose the light agent (it was recorded as Discussion)', moved === true, JSON.stringify(await g.val('JSON.stringify(window.__KB_PHONE_MODEL__)')))
  }
  console.log('   page probe: ' + JSON.stringify(await g.val('JSON.stringify(window.__KB_PHONE_MODEL__ || null)')))
  const line = await g.until(() => g.val(`(() => { const e = document.querySelector('[data-kb="phone-model-line"]'); return e ? e.innerText : null })()`), 15000)
  ok('the quiet line is in the composer dock once the phone model is chosen', typeof line === 'string' && /Small model on this phone|Petit modèle sur ce téléphone/.test(line), JSON.stringify(line))
  if (LIGHT) ok('the app says its model takes tools, so the page chooses the LIGHT agent preset for the chat (the line names reminders and notes)', await g.until(() => g.val(`(window.__KB_PHONE_MODEL__ && window.__KB_PHONE_MODEL__.seen && window.__KB_PHONE_MODEL__.seen.preset) === 'light-agent'`), 15000) === true && /reminders and notes|rappels et notes/.test(String(await g.val(`(document.querySelector('[data-kb="phone-model-line"]') || {}).innerText || ''`))), JSON.stringify(await g.val('JSON.stringify(window.__KB_PHONE_MODEL__ && window.__KB_PHONE_MODEL__.seen)')))
  const modeTag = await g.val(`(() => { const e = document.querySelector('[data-kb="phone-model-mode"]'); return e ? { mode: e.getAttribute('data-mode'), tools: e.getAttribute('data-tools'), text: e.innerText } : null })()`)
  console.log('   the mode on the quiet line: ' + JSON.stringify(modeTag))
  ok('the quiet line says which mode the chat is in: ' + (LIGHT ? '« can set reminders »' : '« chat only » and why'), modeTag !== null && modeTag.mode === (LIGHT ? 'light' : 'chat') && (LIGHT ? /can set reminders|peut créer des rappels/ : /chat only|discussion seule/).test(modeTag.text), JSON.stringify(modeTag))
  const probed = await g.val('JSON.stringify(window.__KB_PHONE_MODEL__ ? { tools: window.__KB_PHONE_MODEL__.tools, preset: window.__KB_PHONE_MODEL__.preset, decided: window.__KB_PHONE_MODEL__.decided } : null)')
  ok('the page decided the preset from the host\'s fresh answer: ' + (LIGHT ? 'light-agent' : 'discussion'), probed !== null && JSON.parse(probed).decided === (LIGHT ? 'light-agent' : 'discussion') && JSON.parse(probed).preset === (LIGHT ? 'light-agent' : 'discussion'), probed)
  await g.shot('/private/tmp/claude-501/phone-model-line.png')

  console.log('2. a real chat (contract tests 4 and 5)')
  const before = seen.length
  sentAt = Date.now()
  await g.send('Donne-moi une recette de crêpes ' + CANARY)
  await g.until(() => seen.slice(before).some((r) => r.method === 'POST' && r.url === '/v1/chat/completions'), 30000)
  const answered = await g.until(() => g.val(`document.body.innerText.includes(${JSON.stringify('this phone ' + NONCE)})`), 30000)
  ok('the answer streams back into the conversation', answered === true)
  const posts = seen.slice(before).filter((r) => r.method === 'POST' && r.url === '/v1/chat/completions')
  if (posts[0] && posts[0].body && Array.isArray(posts[0].body.tools)) console.log('   tools in the first request: ' + JSON.stringify(posts[0].body.tools.map((t) => (t.function && t.function.name) || t.name)))
  const first = posts[0]
  ok('the engine asked the app\'s server for the chat, with the key', posts.length >= 1 && first.auth === 'Bearer ' + KEY, 'posts: ' + posts.length)
  const b = first !== undefined ? first.body : null
  if (DUMP !== null && b !== null) { writeFileSync(DUMP, JSON.stringify(b)); console.log('   the first request is written to ' + DUMP) }
  if (!LIGHT) ok('the request has NO tools', b !== null && (b.tools === undefined || (Array.isArray(b.tools) && b.tools.length === 0)) && b.tool_choice === undefined, b !== null ? JSON.stringify(Object.keys(b)) : 'no body')
  else {
    const names = b !== null && Array.isArray(b.tools) ? b.tools.map((t) => t.function && t.function.name) : []
    ok('the request has exactly the four light tools, in the OpenAI format, with the small schemas of the bundle, in whatever order the engine lists them (0.2.2 sorts by name; no team tool, no Kybernos tool of any other bundle)', [...names].sort().join() === [...LIGHT_NAMES].sort().join() && b.tools.every((t) => { const w = LIGHT_TOOLS.find((x) => x.name === t.function.name); return w !== undefined && t.type === 'function' && t.function.description === w.description && JSON.stringify(Object.keys(t.function.parameters.properties)) === JSON.stringify(Object.keys(w.properties)) && JSON.stringify(t.function.parameters.required) === JSON.stringify(w.required) }), JSON.stringify(names))
    console.log('   tools JSON: ' + (b !== null ? JSON.stringify(b.tools).length : 0) + ' characters')
  }
  ok('only system / user / assistant roles', b !== null && b.messages.every((m) => ['system', 'user', 'assistant'].includes(m.role)), b !== null ? b.messages.map((m) => m.role).join() : '')
  ok('max_tokens (not only max_completion_tokens) of 256 to 1024 (the engine clamps it to the declared window minus the prompt minus 4096: a 4096 window gives 1), no store, streaming', b !== null && Number.isInteger(b.max_tokens) && b.max_tokens >= MIN_ANSWER && b.max_tokens <= 1024 && b.store === undefined && b.stream === true, b !== null ? JSON.stringify({ max_tokens: b.max_tokens, max_completion_tokens: b.max_completion_tokens, store: b.store, stream: b.stream }) : '')
  const sent = b !== null ? b.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n') : ''
  const toolsJson = b !== null && Array.isArray(b.tools) ? JSON.stringify(b.tools) : ''
  // not an assertion: nothing in the plugins can drop it (README, « The engine's team message »); the note says whether the app's server still has to
  console.log('   the engine\'s team message (« You are the Team Lead… send_message(…) ») is ' + (b !== null && /Team Lead|send_message|list_agents/.test(sent) ? 'STILL in the request: drop it in the app\'s server (a user message that starts with « Current runtime context. ») or leave dsh-experimental-agent-team-profile out of the phone profile (README)' : 'not in the request'))
  if (LIGHT) console.log('   messages: ' + (b !== null ? b.messages.map((m) => m.role + ' ' + String(m.content).length + ' characters').join(', ') : 'none') + ' (the third, a user message of the engine\'s required runtime context, cannot be switched off: see light-agent-scope.js)')
  if (LIGHT) ok('the whole first request (prompt, tools and the first message) fits ' + (LIGHT_FIXED_TOKENS + 250) + ' tokens (pessimistic count: one token per three characters; 120 for the first message, 130 for the engine\'s runtime context message)', b !== null && roughTokens(sent + toolsJson) <= LIGHT_FIXED_TOKENS + 250, String(roughTokens(sent + toolsJson)) + ' tokens')
  else ok('the whole first request fits ' + FIRST_REQUEST_TOKENS + ' tokens (pessimistic count: one token per three characters)', b !== null && roughTokens(sent) <= FIRST_REQUEST_TOKENS, String(roughTokens(sent)) + ' tokens, ' + sent.length + ' characters: ' + JSON.stringify(sent.slice(0, 500)))
  if (LIGHT) {
    const sys = b !== null ? String(b.messages[0].content) : ''
    const today = [nowLine(new Date(sentAt), Intl.DateTimeFormat().resolvedOptions().timeZone), nowLine(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone)] // the clock may have turned a quarter of an hour between the message and now
    ok('the system text is the light agent persona with TODAY\'s date, time zone and the week filled in by the engine (the prompt variable), and nothing else', b !== null && b.messages[0].role === 'system' && today.some((line) => sys === LIGHT_TEXT.replace('{{kb_phone_now}}', line)), JSON.stringify(sys.slice(0, 260)))
  } else
  ok('the system text is exactly the Discussion persona (it names the last message\'s language and says it can only chat) and nothing else', b !== null && b.messages[0].role === 'system' && b.messages[0].content === SYSTEM_TEXT, b !== null ? JSON.stringify(b.messages[0].content.slice(0, 200)) : '')
  console.log('   first request: ' + JSON.stringify({ keys: b !== null ? Object.keys(b) : null, system_chars: b !== null ? b.messages[0].content.length : null, tokens_est: roughTokens(sent), max_tokens: b !== null ? b.max_tokens : null }))

  if (LIGHT) {
    console.log('2c. the light agent calls a tool: a reminder waits for the person, a tool outside the four is refused, the result goes back to the model')
    const isToolBack = (r) => r.method === 'POST' && r.url === '/v1/chat/completions' && r.body && Array.isArray(r.body.messages) && r.body.messages.length > 0 && r.body.messages[r.body.messages.length - 1].role === 'tool'
    mode = 'tool'
    const t0 = seen.length
    await g.send('Rappelle-moi d\'appeler le plombier vendredi à 9h')
    const cardShown = () => g.val(`/Set this reminder|Créer ce rappel/.test(document.body.innerText)`)
    // either the card, or (a chat in the « Full access » mode, approval policy never: the engine rejects a card unseen) the bundle's own refusal going back to the model
    await g.until(async () => (await cardShown()) === true || seen.slice(t0).some(isToolBack), 45000)
    const card = (await cardShown()) === true
    if (!card && seen.slice(t0).some(isToolBack)) {
      const r0 = seen.slice(t0).find(isToolBack)
      const tool0 = r0.body.messages.filter((m) => m.role === 'tool').pop()
      console.log('   no card: the chat is in the Full access mode; the tool result the model reads: ' + JSON.stringify(String(tool0 ? tool0.content : '').slice(0, 260)))
      ok('Full access (approval policy never, the engine shows no card): the reminder is refused with a sentence that says it was NOT stored (in French for this French ask), not with « the user rejected »', tool0 !== undefined && /NOT stored|rien n'a été enregistré/.test(String(tool0.content)) && !/user rejected|a refusé/.test(String(tool0.content)), String(tool0 ? tool0.content : '').slice(0, 200))
      await g.until(() => g.val(`document.body.innerText.includes(${JSON.stringify('this phone ' + NONCE)})`), 30000)
    } else {
    ok('the engine asks the person before it stores the reminder: its own approval card, with the reminder\'s words and time', card === true && await g.val(`/plumber/.test(document.body.innerText) && /2026-11-13T09:00/.test(document.body.innerText)`) === true)
    await g.shot('/private/tmp/claude-501/phone-model-light-card.png')
    ok('while the card waits nothing has gone back to the model', !seen.slice(t0).some(isToolBack))
    const labels = await g.val(`[...document.querySelectorAll('button, [role=button]')].map((b) => (b.innerText || '').replace(/\\s+/g, ' ').trim()).filter(Boolean)`)
    console.log('   buttons on the page: ' + JSON.stringify((labels || []).slice(-14)))
    const want = (labels || []).find((l) => /^(allow once|allow|approve|accept|yes|autoriser|oui)\b/i.test(l))
    ok('the card has a button that approves', want !== undefined, JSON.stringify((labels || []).slice(-14)))
    if (want !== undefined) {
      await g.pressText(want)
      const back = await g.until(() => seen.slice(t0).some(isToolBack), 45000)
      ok('after the approval the reminder runs and its result goes back to the model (the assistant\'s call, then a tool message with the same id)', back === true)
      const r2 = seen.slice(t0).find(isToolBack)
      if (r2 !== undefined) {
        const msgs = r2.body.messages
        const call = msgs.find((m) => m.role === 'assistant' && Array.isArray(m.tool_calls))
        const tool = msgs.find((m) => m.role === 'tool')
        console.log('   the tool result the model reads: ' + JSON.stringify(String(tool.content).slice(0, 240)))
        ok('the engine sent the call back in the OpenAI format: an assistant message with tool_calls, then a tool message with its tool_call_id', call !== undefined && call.tool_calls[0].function.name === 'automation_remind' && tool !== undefined && tool.tool_call_id === call.tool_calls[0].id && String(tool.content).length > 0)
        ok('the reminder was not refused (the result is not a denial)', !/denied|refused|declin|not allowed|can only use/i.test(String(tool.content)), String(tool.content).slice(0, 200))
        ok('that request still has the four tools and a first-message prompt of the same size (the tools stay, the history grows by the call and its result)', Array.isArray(r2.body.tools) && r2.body.tools.length === LIGHT_NAMES.length && Number.isInteger(r2.body.max_tokens) && r2.body.max_tokens >= MIN_ANSWER)
      }
      await g.until(() => g.val(`document.body.innerText.includes(${JSON.stringify('this phone ' + NONCE)})`), 30000)
    }
    }
    // the model made a time up for a reminder the person gave none for: the bundle refuses it before any card, and the sentence goes back to the model so that it asks
    mode = 'tool'
    const tn = seen.length
    await g.send('Remind me to call the plumber')
    const noTime = await g.until(() => seen.slice(tn).some(isToolBack), 45000)
    const rn = seen.slice(tn).find(isToolBack)
    const toolN = rn !== undefined ? rn.body.messages.filter((m) => m.role === 'tool').pop() : undefined
    console.log('   the tool result the model reads for a reminder with no time from the person: ' + JSON.stringify(String(toolN ? toolN.content : '').slice(0, 220)))
    ok('a reminder the person gave no time for is refused before any card, and the result is the question itself, to be said as it is (nothing was created)', noTime === true && toolN !== undefined && /Not created: no time given\. When should I remind you\?/.test(String(toolN.content)) && !/Ask them/.test(String(toolN.content)))
    await g.until(() => g.val(`document.body.innerText.includes(${JSON.stringify('this phone ' + NONCE)})`), 30000)
    // the same in French: the result the model reads is French (phone test 9: after a tool call the model answered a French ask in English, because the result was English)
    mode = 'tool'
    const tf = seen.length
    await g.send("Rappelle-moi d'appeler le plombier")
    const noTimeFr = await g.until(() => seen.slice(tf).some(isToolBack), 45000)
    const rf = seen.slice(tf).find(isToolBack)
    const toolF = rf !== undefined ? rf.body.messages.filter((m) => m.role === 'tool').pop() : undefined
    console.log('   the tool result the model reads for the same reminder asked in French: ' + JSON.stringify(String(toolF ? toolF.content : '').slice(0, 220)))
    ok('the refusal of a reminder with no time is worded in French for a French ask (a denied call goes through the post-execute listener too)', noTimeFr === true && toolF !== undefined && /Pas créé : aucune heure\. Quand veux-tu que je te rappelle \?/.test(String(toolF.content)) && !/nothing was set|Not created|When should I/.test(String(toolF.content)))
    await g.until(() => g.val(`document.body.innerText.includes(${JSON.stringify('this phone ' + NONCE)})`), 30000)
    // the knowledge folder of this sandbox is empty: the model reads one plain sentence, in the person's language (phone test 11: the tool's own English text, with the folder's path, came back)
    mode = 'tool-knowledge'
    const tk = seen.length
    await g.send('Quels documents ai-je ?')
    const knowledgeBack = await g.until(() => seen.slice(tk).some(isToolBack), 45000)
    const rk = seen.slice(tk).find(isToolBack)
    const toolK = rk !== undefined ? rk.body.messages.filter((m) => m.role === 'tool').pop() : undefined
    console.log('   the tool result the model reads for the knowledge folder asked in French: ' + JSON.stringify(String(toolK ? toolK.content : '').slice(0, 220)))
    ok('the knowledge folder result is the plain French sentence, with no path and no English', knowledgeBack === true && toolK !== undefined && /vide \(aucun document\)/.test(String(toolK.content)) && !/Your knowledge folder|\//.test(String(toolK.content)), String(toolK ? toolK.content : '').slice(0, 200))
    await g.until(() => g.val(`document.body.innerText.includes(${JSON.stringify('this phone ' + NONCE)})`), 30000)
    mode = 'tool-bash'
    const t1 = seen.length
    await g.send('Run ls in the shell')
    const refused = await g.until(() => seen.slice(t1).some(isToolBack), 45000)
    const r3 = seen.slice(t1).find(isToolBack)
    const tool3 = r3 !== undefined ? r3.body.messages.filter((m) => m.role === 'tool').pop() : undefined
    console.log('   the tool result the model reads for a tool outside the four: ' + JSON.stringify(String(tool3 ? tool3.content : '').slice(0, 200)))
    ok('a call to a tool outside the four (bash) is refused by the engine without running, and the refusal goes back to the model', refused === true && tool3 !== undefined && /can only use: automation_remind/.test(String(tool3.content)), String(tool3 ? tool3.content : '').slice(0, 200))
    mode = 'ok'
    await g.until(() => g.val(`document.body.innerText.split(${JSON.stringify('this phone ' + NONCE)}).length - 1 >= 3`), 30000)
  }

  mode = 'stop-data'
  await g.send('Tell me more please')
  const stopped = await g.until(() => g.val(`document.body.innerText.includes(${JSON.stringify(STOP_SENTENCE.slice(0, 30))})`), 45000)
  ok('the app\'s mid-answer model_stopped (a last data frame { error }, no [DONE]) shows its own sentence in the conversation', stopped === true)
  await g.shot('/private/tmp/claude-501/phone-model-stopped.png')
  mode = 'stop-503'
  await g.send('And once more')
  const stopped2 = await g.until(() => g.val(`document.body.innerText.split(${JSON.stringify(STOP_SENTENCE.slice(0, 30))}).length - 1 >= 2`), 45000)
  ok('the same error before the first word (a plain 503 with the standard body) shows its sentence too', stopped2 === true)
  const allPosts = seen.slice(before).filter((r) => r.method === 'POST' && r.url === '/v1/chat/completions' && r.body)
  const isChat = (r) => (LIGHT ? /^You are the Kybernos assistant\./ : /^You are Kybernos, a helpful assistant on this phone/).test(String((r.body.messages[0] || {}).content))
  const chatPosts = allPosts.filter(isChat)
  const otherPosts = allPosts.filter((r) => !isChat(r)) // the engine's own calls on the same route: the session title (its base profile caps it at 4096 tokens)
  otherPostsAtEnd = otherPosts
  const asked = chatPosts.map((r) => r.body.max_tokens)
  ok('every chat request of the run (the longer conversation too) asked for 256 to 1024 answer tokens', chatPosts.length >= 3 && asked.every((n) => Number.isInteger(n) && n >= MIN_ANSWER && n <= 1024), 'max_tokens asked: ' + JSON.stringify(asked))
  console.log('   max_tokens asked, chat request by request: ' + JSON.stringify(asked) + '; the engine\'s own calls on the same route (session title): ' + JSON.stringify(otherPosts.map((r) => r.body.max_tokens)))
  ok('the engine\'s own call for the session title is not cut to one token either (its own ceiling is 4096)', otherPosts.every((r) => Number.isInteger(r.body.max_tokens) && r.body.max_tokens >= 64), JSON.stringify(otherPosts.map((r) => r.body.max_tokens)))
  if (stopped2 !== true) { console.log('   the page says: ' + JSON.stringify(String(await g.val('document.body.innerText')).slice(-700))); await g.shot('/private/tmp/claude-501/phone-model-stopped-503.png') }
} finally {
  try { await g.close() } catch (e) { /* closed */ }
}

if (EGRESS !== null) {
  console.log('2b. nothing of the chat leaves the phone (the engine runs with a Claude key as its default model and an egress spy that refuses every connection off this machine)')
  await sleep(15000) // the engine's own follow-ups (title, memory, closed questions) start a few seconds after the answer
  let lines = []
  try { lines = readFileSync(EGRESS, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l)) } catch (e) { lines = [] }
  const after = lines.filter((l) => l.t >= sentAt)
  const carries = (l) => JSON.stringify(l).includes(CANARY)
  const isModelCall = (l) => /(\/v1\/messages|\/chat\/completions|\/v1\/responses|:generateContent|:streamGenerateContent)/.test(String(l.path || l.url || ''))
  const hosts = [...new Set(after.map((l) => l.host))].sort()
  console.log('   refused after the first message: ' + after.length + ' call(s), to ' + (hosts.length === 0 ? 'nobody' : hosts.join(', ')) + '; before it: ' + (lines.length - after.length))
  ok('the person\'s words (a word that exists nowhere else) are in nothing the engine tried to send off this machine, from the first message to the end of the run', !lines.some(carries), JSON.stringify(lines.filter(carries).map((l) => ({ kind: l.kind, host: l.host, path: l.path || l.url })).slice(0, 5)))
  const modelCalls = after.filter(isModelCall)
  ok('no call to a remote MODEL is made after the first message but the health probe of the connected providers (a one-token « ping », no words of the chat)', modelCalls.every((l) => /"text":"ping"/.test(String(l.body)) && /"max_tokens":1\b/.test(String(l.body))), JSON.stringify(modelCalls.filter((l) => !/"text":"ping"/.test(String(l.body))).map((l) => ({ host: l.host, path: l.path || l.url, body: String(l.body).slice(0, 200) })).slice(0, 3)))
  const titleCalls = otherPostsAtEnd.filter((r) => /title/i.test(String((r.body.messages[0] || {}).content)))
  ok('the engine\'s own call for the title of the chat is made on the chat\'s route, the phone\'s model, and not on the default cloud model', titleCalls.length >= 1, 'the phone\'s server saw ' + otherPostsAtEnd.length + ' call(s) that are not chat requests')
}

console.log('3. the key is in no file of ' + engineLabel + ' (contract test 2)')
const walk = (dir, out = []) => { for (const f of readdirSync(dir)) { const p = join(dir, f); let s; try { s = statSync(p) } catch (e) { continue } if (s.isSymbolicLink()) continue; if (s.isDirectory()) { if (/node_modules|\.pnpm-store|chrome|Cache/i.test(f)) continue; walk(p, out) } else if (s.size < 40e6) out.push(p) } return out }
const roots = keyRoots.filter((d) => { try { return statSync(d).isDirectory() } catch (e) { return false } })
const files = [...new Set(roots.flatMap((d) => walk(d)))]
const holders = files.filter((f) => { try { return readFileSync(f).includes(KEY) } catch (e) { return false } })
ok('scanned ' + files.length + ' files of ' + engineLabel + ' (settings, logs, credentials, sessions): none holds the key', holders.length === 0, holders.join(', '))
const providerFiles = files.filter((f) => { try { return readFileSync(f, 'utf8').includes('phone-local') } catch (e) { return false } })
console.log('   the provider block is written in: ' + providerFiles.map((f) => f.replace(process.env.HOME, '~')).join(', '))
ok('the block holds the key\'s NAME, the app\'s address, and no key', providerFiles.some((f) => { const t = readFileSync(f, 'utf8'); return t.includes('KB_LOCAL_LLM_KEY') && t.includes('127.0.0.1:' + PORT) && !t.includes(KEY) }))

// what the bundle itself said while the engine ran (a step it could not put is logged, never thrown: without this line a refusal of the engine stays unseen)
const bundleSaid = engineOut().split('\n').filter((l) => /\[kybernos-phone-model\]/.test(l)).slice(0, 8)
if (bundleSaid.length > 0) console.log('   the bundle said: ' + bundleSaid.map((l) => l.trim().slice(0, 220)).join(' | '))
stopEngine()
server.close()
console.log('\n' + (fail === 0 ? 'all ' + pass + ' passed' : pass + ' passed, ' + fail + ' FAILED'))
process.exit(fail === 0 ? 0 : 1)
