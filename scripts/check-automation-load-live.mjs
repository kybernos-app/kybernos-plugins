#!/usr/bin/env node
// The cap on automation runs started at once, in a real GUI: the real scheduler tick, the real engine reporting a session
// running or idle (agent/status), the real route, the real Settings row and the real board banner.
//
//   source scripts/sandbox/env.sh && node scripts/check-automation-load-live.mjs [--shots <dir>]
//
// Needs a DSH that serves this checkout (scripts/sandbox/start.sh). Refuses :3080 and any DSH home that is not a sandbox's.
// It WRITES the sandbox's kybernos/tasks.json (five due automations) and the sandbox profile's model list (a stub model; a backup is
// put back), restarts the sandbox, and puts everything back. Nothing leaves the machine; no credential of the user's is there.
//
// What it proves:
//   - with the maximum at 2 and a model that never answers, only the 2 oldest due automations start, the other 3 stay due (late, not lost)
//     and keep waiting on the next tick;
//   - GET /kybernos/automation-load tells the same (2 going, room for 2, 3 waiting), and refuses a write;
//   - Settings › Automations shows the row, and the board says "Waiting for the computer", not "The scheduler seems to be stopped";
//   - when the model answers, the engine reports the sessions idle, room opens, and the next due runs start, oldest first;
//   - with the guard on (not off), the machine's own reading is a sane figure on this machine (memory pressure, not os.freemem());
//   - lighter runs, with the level FORCED (the machine is not made busy for real): very busy, the run's real request to the model carries the line
//     "do not start sub-agents", a run held more than ten minutes still starts, and a real `subagent` call from the model comes back to it as
//     an error that says the computer is very busy; with the machine free, the prompt carries no such line.
// Exit code 0 / 1 / 3 (3 = inconclusive: no sandbox).
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openLivePage, openSettings, goToSettingsPage, clickText } from './live-page.mjs'

const args = process.argv.slice(2)
const shotDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null
const onlyLighter = args.includes('--only-lighter') // stop after the lighter-run phases (the GUI part takes five more minutes)
const here = dirname(fileURLToPath(import.meta.url))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }

const host = process.env.KB_HOST || '127.0.0.1:3080'
const home = process.env.DSH_HOME || ''
if (host === '127.0.0.1:3080') { console.error('○ inconclusive: this check needs a DSH that serves this checkout (a sandbox instance), not the one on :3080. Set KB_HOST, DSH_HOME and HOME (source scripts/sandbox/env.sh).'); process.exit(3) }
if (home === '' || home.indexOf('.kybernos-sandbox') < 0) { console.error('○ inconclusive: DSH_HOME is not a sandbox home: this check writes tasks.json and refuses to.'); process.exit(3) }

const file = join(home, 'kybernos', 'tasks.json')
const original = existsSync(file) ? readFileSync(file, 'utf8') : null
const writeAtomic = (text) => { mkdirSync(join(home, 'kybernos'), { recursive: true }); const tmp = file + '.tmp-load-check'; writeFileSync(tmp, text, { mode: 0o600 }); renameSync(tmp, file) }
const readTasks = () => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch (e) { return [] } }
const restoreTasks = () => { try { if (original === null) rmSync(file, { force: true }); else writeAtomic(original) } catch (e) { /* the sandbox is disposable */ } }
const started = () => readTasks().filter((t) => Array.isArray(t.history) && t.history.some((h) => h.status === 'fired')).map((t) => t.id).sort()
const authority = host
const loadRoute = async (method) => {
  const r = await fetch('http://' + authority + '/kybernos/automation-load', { method: method || 'GET', headers: { origin: 'http://' + authority } })
  let j = null
  try { j = await r.json() } catch (e) { j = null }
  return { status: r.status, json: j }
}
const poll = async (fn, ms = 10000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await sleep(500) } }

// A model that never answers (the sessions stay running) until the check lets it: then every waiting request is answered at once.
const pending = []
let answering = false
// 'cap': the phase of the cap (every request hangs until released). 'call' / 'text': the lighter-run phases (the model calls the sub-agent tool / answers).
let mode = 'cap'
const probe = { systems: [], toolNames: null, called: null, toolResult: null, where: [], keys: null }
const systemOf = (j) => (Array.isArray(j.messages) ? j.messages.filter((m) => m.role === 'system').map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n') : '')
const toolCall = (res, name, args) => {
  const base = { id: 'chatcmpl-stub', object: 'chat.completion.chunk', created: 1, model: 'stub-1' }
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  res.write('data: ' + JSON.stringify(Object.assign({}, base, { choices: [{ index: 0, delta: { role: 'assistant', content: null, tool_calls: [{ index: 0, id: 'call_probe_1', type: 'function', function: { name, arguments: '' } }] }, finish_reason: null }] })) + '\n\n')
  res.write('data: ' + JSON.stringify(Object.assign({}, base, { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args) } }] }, finish_reason: null }] })) + '\n\n')
  res.write('data: ' + JSON.stringify(Object.assign({}, base, { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })) + '\n\n')
  res.end('data: [DONE]\n\n')
}
const sse = (res, content) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const base = { id: 'chatcmpl-stub', object: 'chat.completion.chunk', created: 1, model: 'stub-1' }
  res.write('data: ' + JSON.stringify(Object.assign({}, base, { choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] })) + '\n\n')
  res.write('data: ' + JSON.stringify(Object.assign({}, base, { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })) + '\n\n')
  res.end('data: [DONE]\n\n')
}
const server = createServer((req, res) => {
  let body = ''
  req.on('data', (d) => { body += d })
  req.on('end', () => {
    let j = {}
    try { j = JSON.parse(body) } catch (e) { j = {} }
    if (String(req.url).indexOf('/chat/completions') < 0) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'kbstub/stub-1', object: 'model' }] })); return }
    if (!Array.isArray(j.tools) || j.tools.length === 0) { sse(res, 'Stub'); return } // the engine's side calls (a title)
    if (mode !== 'cap') {
      const msgs = Array.isArray(j.messages) ? j.messages : []
      const tool = msgs.filter((m) => m.role === 'tool').pop()
      probe.systems.push(systemOf(j))
      probe.keys = Object.keys(j)
      probe.where.push((Array.isArray(j.messages) ? j.messages : []).map((m) => (m.role + ':' + (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).length + (/Do not start sub-agents|The computer is busy/.test(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)) ? ':NOTE' : ''))).join(' '))
      probe.toolNames = j.tools.map((t) => (t.function ? t.function.name : ''))
      if (tool !== undefined) { probe.toolResult = typeof tool.content === 'string' ? tool.content : JSON.stringify(tool.content); sse(res, 'OK'); return }
      const sub = j.tools.find((t) => t.function && /^subagent(_[a-z0-9_]+)?$/.test(t.function.name || ''))
      if (mode === 'call' && sub !== undefined) {
        const params = sub.function.parameters || {}
        const args = {}
        for (const k of params.required || []) { const def = (params.properties || {})[k] || {}; args[k] = Array.isArray(def.enum) ? def.enum[0] : def.type === 'boolean' ? false : def.type === 'number' || def.type === 'integer' ? 1 : 'Reply with the single word OK.' }
        probe.called = sub.function.name
        toolCall(res, sub.function.name, args)
        return
      }
      sse(res, 'OK')
      return
    }
    if (answering === true) { sse(res, 'OK'); return }
    pending.push(res)
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const stubPort = server.address().port

const profile = join(home, 'profiles', 'web', 'cordis.patch.yml')
const backup = profile + '.bak-load-check'
const anchor = '- id: llm-pi-ai\n  config:\n    providers:\n'
const patch = existsSync(profile) ? readFileSync(profile, 'utf8') : ''
if (patch.indexOf(anchor) < 0) { console.error('○ inconclusive: the sandbox profile has no llm-pi-ai providers block to add the stub model to'); process.exit(3) }
const sandbox = (script, extraEnv) => spawnSync('bash', [join(here, 'sandbox', script)], { env: Object.assign({}, process.env, extraEnv || {}), encoding: 'utf8', timeout: 240000 })
const restart = (extraEnv) => { sandbox('stop.sh'); return sandbox('start.sh', extraEnv).status === 0 }
const provider = '      kbstub:\n        api: openai-completions\n        baseURL: http://127.0.0.1:' + stubPort + '/v1\n        apiKeyEnv: KB_STUB_KEY\n        models:\n          - id: kbstub/stub-1\n            name: Stub\n'

const stamp = new Date().toISOString()
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
const NAMES = ['Load A', 'Load B', 'Load C', 'Load D', 'Load E']
const seed = () => NAMES.map((name, i) => ({
  id: 'st-load-' + 'abcde'[i], createdAt: stamp, updatedAt: stamp, history: [], lastRun: null, name, prompt: '1. Reply with the single word OK.',
  schedule: { mode: 'cron', cron: '0 8 * * *', tz }, runsOn: 'local', active: true, approvals: 'auto', notify: [], model: 'kbstub/stub-1',
  // Overdue by 8 minutes (A) to 4 minutes (E): the board banner needs more than 3, and the order of the cap is the order of these.
  nextRun: new Date(Date.now() - (8 - i) * 60000).toISOString(),
}))

let live = null
try {
  console.log('\n── the machine\'s own reading, guard on, on this machine ──')
  const first = await loadRoute()
  check('the route answers on the sandbox', first.status === 200 && first.json !== null && first.json.ok === true, first)
  if (first.json !== null && first.json.ok === true) {
    const v = first.json
    check('memory is a figure between 1 and 100 (macOS: the system\'s pressure, not os.freemem())', typeof v.memAvailablePct === 'number' && v.memAvailablePct >= 1 && v.memAvailablePct <= 100, v)
    check('load per core is a number', typeof v.loadPerCpu === 'number' && v.loadPerCpu >= 0, v)
    check('the gauge figure is a whole number from 0 to 100, in step with the level', Number.isInteger(v.pressure) && v.pressure >= 0 && v.pressure <= 100 && (v.level !== 'high' || v.pressure === 100) && (v.level !== 'busy' || v.pressure >= 50), v)
    console.log('    (level ' + v.level + ', memory ' + v.memAvailablePct + ' % available, load/core ' + v.loadPerCpu + ')')
  }
  check('a write is refused', (await loadRoute('POST')).status === 405)

  console.log('\n── the cap: maximum 2, a model that never answers ──')
  copyFileSync(profile, backup)
  writeFileSync(profile, patch.replace(anchor, anchor + provider))
  writeAtomic(JSON.stringify(seed(), null, 2) + '\n')
  const up = restart({ KB_STUB_KEY: 'stub', KYBERNOS_AUTOMATION_MAX_PARALLEL: '2', KYBERNOS_AUTOMATION_LOAD_GUARD: 'off' })
  check('the sandbox restarts with the stub model, maximum 2, five due automations', up === true)
  if (up !== true) throw new Error('sandbox did not restart')
  // The first tick is 5 s after the start, then every 30 s.
  const two = await poll(() => started().length >= 2, 60000)
  check('two automations started', two === true, started())
  check('the two OLDEST started', started().join() === 'st-load-a,st-load-b', started())
  const mid = await loadRoute()
  check('the page is told: 2 going, room for 2, 3 waiting', mid.json !== null && mid.json.inFlight === 2 && mid.json.allowed === 2 && mid.json.waiting === 3, mid.json)
  await sleep(36000) // one more tick
  check('a tick later the other three are still waiting (the cap holds while the runs go)', started().join() === 'st-load-a,st-load-b', started())
  const held = readTasks().filter((t) => ['st-load-c', 'st-load-d', 'st-load-e'].indexOf(t.id) >= 0)
  check('the held ones are still due, with their own due time (late, not lost)', held.length === 3 && held.every((t) => Date.parse(t.nextRun) < Date.now() - 3 * 60000), held.map((t) => t.nextRun))

  // ── lighter runs, level forced ───────────────────────────────────────────────────────────────────────────────────────────────
  console.log('\n── lighter runs: the level is forced, the machine is not made busy for real ──')
  for (const res of pending.splice(0)) { try { sse(res, 'OK') } catch (e) { /* the request went away */ } }
  answering = true
  mode = 'call'
  // Overdue by eleven minutes: a very busy machine has no room, but a run held more than ten minutes starts anyway.
  const lone = (id, name) => Object.assign(seed()[0], { id, name, history: [], lastRun: null, nextRun: new Date(Date.now() - 11 * 60000).toISOString() })
  writeAtomic(JSON.stringify([lone('st-load-hot', 'Load hot')], null, 2) + '\n')
  check('the sandbox restarts with the level forced to very busy', restart({ KB_STUB_KEY: 'stub', KYBERNOS_AUTOMATION_LOAD_FORCE: 'high' }) === true)
  const hot = await poll(() => probe.toolResult !== null || (probe.systems.length > 0 && probe.called === null), 90000)
  check('a run held more than ten minutes started anyway, though a very busy machine has no room', started().join() === 'st-load-hot', started())
  // The engine puts the plugins' `systemPrompt.context` blocks in a user-role context message, not in the `system` one: look in every message.
  check('the real request to the model carries the line: do not start sub-agents (in the context message, on every step)', probe.where.length >= 1 && probe.where.every((w) => /:NOTE/.test(w)), probe.where)
  check('the model had a sub-agent tool to call (otherwise the next check proves nothing)', probe.called !== null, probe.toolNames)
  check('the call came back to the model as an error that says the computer is very busy', hot && probe.toolResult !== null && /Sub-agent not started/.test(probe.toolResult) && /very busy/.test(probe.toolResult), probe.toolResult)
  const hotView = (await loadRoute()).json
  check('the page is told: a refusal was counted, no sub-agent allowed', hotView !== null && hotView.level === 'high' && hotView.subagents.limit === 0 && hotView.subagents.refused >= 1, hotView)

  mode = 'text'
  probe.systems.length = 0; probe.where.length = 0; probe.toolResult = null; probe.called = null
  writeAtomic(JSON.stringify([lone('st-load-free', 'Load free')], null, 2) + '\n')
  check('the sandbox restarts with the machine\'s own reading, guard off (free)', restart({ KB_STUB_KEY: 'stub', KYBERNOS_AUTOMATION_LOAD_GUARD: 'off' }) === true)
  const free = await poll(() => probe.systems.length > 0, 90000)
  check('a run started on a free machine', free === true && started().join() === 'st-load-free', started())
  check('the real request to the model carries no line about the machine being busy (every message looked at)', probe.where.length > 0 && probe.where.every((w) => !/:NOTE/.test(w)), probe.where)

  if (onlyLighter === true) throw new Error('only-lighter: stopped before the GUI part')
  // Back to the phase the GUI part needs: the cap at 2, a model that never answers, five due automations.
  mode = 'cap'; answering = false
  writeAtomic(JSON.stringify(seed(), null, 2) + '\n')
  check('the sandbox restarts for the GUI part (maximum 2, hanging model)', restart({ KB_STUB_KEY: 'stub', KYBERNOS_AUTOMATION_MAX_PARALLEL: '2', KYBERNOS_AUTOMATION_LOAD_GUARD: 'off' }) === true)
  check('two start again, the other three wait', await poll(() => started().length >= 2, 60000) === true && (await loadRoute()).json.waiting === 3, started())

  live = await openLivePage({ width: 1400, height: 950 })
  const page = live.page
  const val = async (expr, ms) => (await page.evalJs(expr, ms)).val
  const shot = async (name) => { if (shotDir !== null) { try { mkdirSync(shotDir, { recursive: true }); await page.shot(join(shotDir, name + '.png')) } catch (e) { /* no screenshot */ } } }
  const exceptions = []
  page.on('Runtime.exceptionThrown', (p) => { exceptions.push(String((p.exceptionDetails && p.exceptionDetails.text) || '').slice(0, 200)) })
  await page.send('Runtime.enable', {})
  // The page's own reads of the load route can be answered by the check (the three states of the gauge, whatever this machine is doing).
  let forced = null
  page.on('Fetch.requestPaused', async (p) => {
    try {
      if (forced === null || p.request.url.indexOf('/kybernos/automation-load') < 0) { await page.send('Fetch.continueRequest', { requestId: p.requestId }); return }
      await page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: Buffer.from(JSON.stringify(Object.assign({ ok: true, reasons: [], inFlight: 2, allowed: 2, maxParallel: 3, waiting: 3, memAvailablePct: 30, loadPerCpu: 0.5 }, forced))).toString('base64') })
    } catch (e) { /* the page went away */ }
  })
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*/kybernos/automation-load*', requestStage: 'Request' }] })

  console.log('\n── Settings › Automations ──')
  const inSettings = await openSettings(page)
  check('Settings opens', inSettings === true)
  const onPage = await goToSettingsPage(page, 'Automations', { marker: `!!document.querySelector('[data-kb="automation-load"]')`, markerMs: 15000 })
  check('Settings › Automations shows the load row', onPage === true)
  const row = await val(`(() => { const r = document.querySelector('[data-kb="automation-load"]'); return r ? { level: r.getAttribute('data-level'), text: r.innerText.replace(/\\s+/g, ' ').trim() } : null })()`)
  check('the row says the level and "2 running · 3 waiting"', row !== null && /2 running · 3 waiting/.test(row.text) && row.level === 'ok', row)
  await shot('settings-load-row')
  const STATES = [['ok', 22], ['busy', 70], ['high', 100]]
  const colours = {}
  for (const [level, pressure] of STATES) {
    forced = { level, pressure, reasons: level === 'ok' ? [] : ['memory'], subagents: { limit: level === 'high' ? 0 : level === 'busy' ? 1 : null, active: 0, refused: level === 'high' ? 4 : 0 } }
    const g = await poll(() => val(`(() => { const g = document.querySelector('[data-kb="automation-load"] [data-kb="load-gauge"]'); if (!g || g.getAttribute('data-level') !== ${JSON.stringify(level)}) return null; const on = g.querySelectorAll('i.on'); const last = on[on.length - 1]; return { now: g.getAttribute('aria-valuenow'), on: on.length, ticks: g.querySelectorAll('i').length, head: g.querySelectorAll('i.head').length, text: g.innerText.trim(), colour: last ? getComputedStyle(last).backgroundColor : null, role: g.getAttribute('role') } })()`), 16000)
    check('the gauge shows ' + level + ' at ' + pressure + ' %: a meter, ' + Math.max(1, Math.round(pressure / 100 * 24)) + ' of 24 ticks filled, one head, the figure', g !== null && g !== undefined && g.role === 'meter' && g.now === String(pressure) && g.ticks === 24 && g.on === Math.max(1, Math.round(pressure / 100 * 24)) && g.head === 1 && g.text === pressure + '%', g)
    if (g) colours[level] = g.colour
    const rowText = await val(`(document.querySelector('[data-kb="automation-load"]') || { innerText: '' }).innerText.replace(/\\s+/g, ' ')`)
    if (level === 'high') check('the row says what very busy does to sub-agents, and counts the calls held back', /start no sub-agents/.test(rowText) && /4 sub-agent call\(s\) held back/.test(rowText), rowText)
    if (level === 'busy') check('the row says what busy does to sub-agents, and counts none', /at most one sub-agent at a time/.test(rowText) && !/held back/.test(rowText), rowText)
    await shot('settings-gauge-' + level)
  }
  const rgb = (c) => (String(c).match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number)
  const [okC, busyC, highC] = [rgb(colours.ok), rgb(colours.busy), rgb(colours.high)]
  check('green is greener than red, red is redder than green, amber sits between (the colour is the level)', okC.length === 3 && busyC.length === 3 && highC.length === 3 && okC[1] > okC[0] && highC[0] > highC[1] + 40 && busyC[0] > okC[0] && busyC[1] > highC[1], colours)
  forced = null

  console.log('\n── the board ──')
  await page.send('Page.reload', { ignoreCache: true })
  await sleep(3000)
  for (let i = 0; i < 4; i += 1) { await clickText(page, 'Automations'); if (await poll(() => val(`!!document.querySelector('[data-kb="page-automations"]')`), 6000)) break }
  await poll(() => val(`document.querySelectorAll('[data-kb^="view-"]').length > 0`), 15000)
  await val(`(() => { const b = document.querySelector('[data-kb="view-columns"]'); if (b) b.click(); return !!b })()`)
  const banner = await poll(() => val(`(() => { const b = document.querySelector('[data-kb="board-banner"]'); return b ? { reason: b.getAttribute('data-reason'), text: b.innerText.replace(/\\s+/g, ' ').trim() } : null })()`), 30000)
  check('the board banner says the cap holds the runs, not that the scheduler is stopped', banner !== null && banner.reason === 'load' && /Waiting for the computer/.test(banner.text) && !/scheduler seems/i.test(banner.text), banner)
  const dueCards = await val(`Array.from(document.querySelectorAll('[data-kb="board-card"][data-col="upcoming"]')).filter((c) => /Load [CDE]/.test(c.innerText)).map((c) => c.querySelector('.kbbd-st') ? c.querySelector('.kbbd-st').innerText.trim() : '')`)
  check('the three held cards say they wait for the computer, not that the scheduler starts them next pass', Array.isArray(dueCards) && dueCards.length === 3 && dueCards.every((t) => /waiting for the computer/.test(t)), dueCards)
  await shot('board-load-banner')
  forced = { level: 'high', pressure: 100, reasons: ['memory'], inFlight: 2, allowed: 0, waiting: 3 }
  const bg = await poll(() => val(`(() => { const g = document.querySelector('[data-kb="board-banner"] [data-kb="load-gauge"]'); return g ? { level: g.getAttribute('data-level'), now: g.getAttribute('aria-valuenow') } : null })()`), 20000)
  check('the banner carries the same gauge, red at 100 %', bg !== null && bg !== undefined && bg.level === 'high' && bg.now === '100', bg)
  await shot('board-load-banner-red')
  forced = null
  check('no exception in the page', exceptions.length === 0, exceptions)

  console.log('\n── the model answers: the engine reports the sessions idle, room opens ──')
  answering = true
  for (const res of pending.splice(0)) { try { sse(res, 'OK') } catch (e) { /* the request went away */ } }
  const four = await poll(() => started().length >= 4, 75000)
  check('the next two due automations start, oldest first (C and D)', four === true && started().join() === 'st-load-a,st-load-b,st-load-c,st-load-d', started())
  const five = await poll(() => started().length >= 5, 75000)
  check('then the last one (E): nothing was lost', five === true && started().join() === 'st-load-a,st-load-b,st-load-c,st-load-d,st-load-e', started())
  const end = await loadRoute()
  check('nothing waits any more', end.json !== null && end.json.waiting === 0, end.json)
} catch (e) {
  if (!/^only-lighter/.test(String((e && e.message) || e))) fail += 1
  console.log((/^only-lighter/.test(String((e && e.message) || e)) ? '  ○ ' : '  ✗ the check stopped: ') + String((e && e.message) || e))
} finally {
  try { if (live !== null) await live.close() } catch (e) { /* closed */ }
  try { copyFileSync(backup, profile); rmSync(backup, { force: true }) } catch (e) { /* no backup was made */ }
  restoreTasks()
  restart({})
  sandbox('stop.sh')
  try { server.close() } catch (e) { /* closed */ }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
