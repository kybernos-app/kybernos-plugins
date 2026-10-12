#!/usr/bin/env node
// The Automations board (the Columns and Calendar views next to the List), in a real GUI: the real client, the real
// host routes (tasks, tasks/occurrences), the real scheduler adopting the seeded automations, and a real session
// started by « Run now ».
//
//   source scripts/sandbox/env.sh && node scripts/check-automations-board-live.mjs [--shots <dir>] [--stub-model]
//
// Needs a DSH that serves this checkout (scripts/sandbox/start.sh). Refuses :3080 and any DSH home that is not a
// sandbox's. It WRITES the sandbox's kybernos/tasks.json (seven automations: a daily, a weekly, an every-6-hours, a
// one-time, a webhook-only, a failing one, a paused one) and puts the file back as it was. « Run now » starts one real
// session in the sandbox (no credential of the user's there: the turn ends at once), and nothing leaves the machine.
//
// What it proves, and what it does not:
//   - the three views and their switch, the persisted choice, the old `cards` value read as `list`;
//   - the columns hold RUNS, the webhook automation is a chip, the paused one is counted not drawn;
//   - the calendar (week and month), the folding of one automation's runs of a day, the dashed planned runs, the
//     detail strip and its actions, previous / today / next;
//   - « Run now » end to end: the host starts a real session, the board reads its state from the ENGINE (the same
//     one its sidebar shows) and never says more than it knows;
//   - the host not answering (banner, retry), the loading skeleton, the empty state, French, a phone width;
//   - with --stub-model: a run that is really RUNNING and a run that really WAITS for an approval, answered from the
//     board with Refuse and with Approve. It needs a model that does what it is told, so the check starts a stub
//     OpenAI-compatible endpoint, adds it to the SANDBOX profile (a backup is put back afterwards) and restarts the
//     sandbox twice. Without the flag these two states are proved by the pure test (test-automation-board.mjs), against
//     the structures of the engine's own client, and not seen live.
// Exit code 0 / 1 / 3 (3 = inconclusive: no sandbox).
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openLivePage, clickText } from './live-page.mjs'

const args = process.argv.slice(2)
const shotDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null
const withStub = args.includes('--stub-model')
const here = dirname(fileURLToPath(import.meta.url))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }

const host = process.env.KB_HOST || '127.0.0.1:3080'
const home = process.env.DSH_HOME || ''
if (host === '127.0.0.1:3080') { console.error('○ inconclusive: this check needs a DSH that serves this checkout (a sandbox instance), not the one on :3080. Set KB_HOST, DSH_HOME and HOME (source scripts/sandbox/env.sh).'); process.exit(3) }
if (home === '' || home.indexOf('.kybernos-sandbox') < 0) { console.error('○ inconclusive: DSH_HOME is not a sandbox home (' + (home === '' ? 'unset' : 'not under .kybernos-sandbox') + '): this check writes tasks.json and refuses to.'); process.exit(3) }

const file = join(home, 'kybernos', 'tasks.json')
const original = existsSync(file) ? readFileSync(file, 'utf8') : null
const writeAtomic = (text) => { mkdirSync(join(home, 'kybernos'), { recursive: true }); const tmp = file + '.tmp-board-check'; writeFileSync(tmp, text, { mode: 0o600 }); renameSync(tmp, file) }
const readTasks = () => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch (e) { return [] } }
const restore = () => { try { if (original === null) rmSync(file, { force: true }); else writeAtomic(original) } catch (e) { /* the sandbox is disposable */ } }

// ── Seven automations, with a history that is a function of today (never of a date written here) ─────────────
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
const local = (d, h, m) => { const x = new Date(); x.setDate(x.getDate() + d); x.setHours(h, m || 0, 0, 0); return x }
const ymdHm = (x) => x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0') + 'T' + String(x.getHours()).padStart(2, '0') + ':' + String(x.getMinutes()).padStart(2, '0')
const stamp = new Date().toISOString()
let n = 0
const ran = (d, h, m, extra) => { n += 1; return Object.assign({ at: local(d, h, m).toISOString(), sessionId: 'seed-session-' + n, status: 'fired' }, extra || {}) }
const mk = (id, name, schedule, extra) => {
  const t = Object.assign({ id, createdAt: stamp, updatedAt: stamp, history: [], lastRun: null, nextRun: null, name, prompt: '1. Reply with the single word OK.', schedule, runsOn: 'local', active: true, approvals: 'ask', notify: [] }, extra || {})
  if (t.history.length > 0) t.lastRun = t.history[t.history.length - 1].at
  return t
}
// Two hours ago, but never before this morning: the failed run is TODAY's, whatever the time the check runs at.
const failedAt = new Date(Math.max(Date.now() - 2 * 3600000, local(0, 0, 0).getTime() + 60000)).toISOString()
const SEED = [
  mk('st-board-watch', 'Competitive watch', { mode: 'cron', cron: '0 8 * * *', tz }, { history: [ran(-3, 8, 0), ran(-2, 8, 0), ran(-1, 8, 0)] }),
  mk('st-board-weekly', 'Weekly sales report', { mode: 'cron', cron: '0 17 * * 5', tz }, { history: [ran(-6, 17, 0)] }),
  mk('st-board-six', 'Lessons cleanup', { mode: 'cron', cron: '0 */6 * * *', tz }, { approvals: 'auto', history: [ran(-1, 6, 0), ran(-1, 12, 0), ran(-1, 18, 0)] }),
  mk('st-board-once', 'Launch review', { mode: 'once', at: ymdHm(local(1, 10, 0)), tz }),
  mk('st-board-hook', 'New support ticket', { mode: 'webhook', tz }, { trigger: { type: 'webhook', hookId: 'hk_000000000001', secret: 'seed-secret-0123456789abcdef0123' }, history: [ran(-2, 14, 30, { via: 'webhook' })] }),
  mk('st-board-backup', 'Log backup', { mode: 'cron', cron: '0 2 * * *', tz }, { history: [ran(-1, 2, 0), { at: failedAt, sessionId: null, status: 'error', error: 'no space left on device' }] }),
  mk('st-board-digest', 'Monthly digest', { mode: 'cron', cron: '0 8 1 * *', tz }, { active: false }),
]
const SCHEDULED = ['st-board-watch', 'st-board-weekly', 'st-board-six', 'st-board-once', 'st-board-backup']

const live = await openLivePage({ width: 1500, height: 1000 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const val = async (expr, ms) => (await page.evalJs(expr, ms)).val
const poll = async (fn, ms = 10000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await sleep(250) } }
const shot = async (name) => { if (shotDir !== null) { try { mkdirSync(shotDir, { recursive: true }); await page.shot(join(shotDir, name + '.png')) } catch (e) { /* no screenshot */ } } }
const q = (sel) => val(`document.querySelectorAll(${JSON.stringify(sel)}).length`)
const click = (sel) => val(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b || b.disabled) return false; b.click(); return true })()`)
const texts = (sel) => val(`Array.from(document.querySelectorAll(${JSON.stringify(sel)})).map((e) => e.innerText.replace(/\\s+/g, ' ').trim())`)
const attrs = (sel, attr) => val(`Array.from(document.querySelectorAll(${JSON.stringify(sel)})).map((e) => e.getAttribute(${JSON.stringify(attr)}))`)
const exceptions = []
page.on('Runtime.exceptionThrown', (p) => { exceptions.push(String((p.exceptionDetails && (p.exceptionDetails.text + ' ' + ((p.exceptionDetails.exception && p.exceptionDetails.exception.description) || ''))) || '').slice(0, 240)) })

// Intercepts the page's own calls to the tasks routes: 'pass', 'fail' (the host does not answer) or 'hold' (answers late).
let mode = 'pass'
let holdMs = 0
page.on('Fetch.requestPaused', async (p) => {
  const url = p.request.url
  try {
    if (url.indexOf('/kybernos/tasks') < 0) { await page.send('Fetch.continueRequest', { requestId: p.requestId }); return }
    if (mode === 'fail') { await page.send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'ConnectionRefused' }); return }
    if (mode === 'hold') { await sleep(holdMs) }
    await page.send('Fetch.continueRequest', { requestId: p.requestId })
  } catch (e) { /* the page went away */ }
})

const openAutomations = async () => {
  await sleep(1500)
  if ((await val(`/Add an API key to get started/.test(document.body.innerText)`)) === true) await clickText(page, 'Configure later')
  for (let i = 0; i < 4; i += 1) {
    await clickText(page, 'Automations')
    if (await poll(() => q('[data-kb="page-automations"]'), 6000)) {
      // The page is there before the host has answered: wait for the list (its toolbar) or the empty state.
      await poll(async () => (await q('[data-kb^="view-"]')) > 0 || (await q('[data-kb="automations-onboarding"]')) > 0, 15000)
      return true
    }
  }
  return false
}
const reloadAndOpen = async () => { await page.send('Page.reload', { ignoreCache: true }); await sleep(2500); return openAutomations() }
const view = (v) => click('[data-kb="view-' + v + '"]')
const pressed = () => val(`Array.from(document.querySelectorAll('[data-kb^="view-"]')).filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.kb.slice(5)).join()`)
const stored = () => val(`(() => { try { return JSON.parse(localStorage.getItem('kybernos.toolbar.automations') || 'null') } catch (e) { return null } })()`)

// A model that does what the check tells it, for the two states a real model makes rare: a run that is running
// (the endpoint never answers) and a run that waits for an approval (it answers with a `bash` call that asks for a
// wider sandbox, which the engine turns into an approval request). OpenAI-compatible, streamed.
const stubSection = async () => {
  console.log('\n── a model that does what it is told: a run that is running, a run that waits for an approval ──')
  const profile = join(home, 'profiles', 'web', 'cordis.patch.yml')
  const anchor = '- id: llm-pi-ai\n  config:\n    providers:\n'
  const patch = existsSync(profile) ? readFileSync(profile, 'utf8') : ''
  if (patch.indexOf(anchor) < 0) { console.log('  ○ skipped: the sandbox profile has no llm-pi-ai providers block to add the stub model to'); return }
  const st = { mode: 'hang', toolResults: [] }
  const text = (res, content) => {
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
      const msgs = Array.isArray(j.messages) ? j.messages : []
      const tool = msgs.filter((m) => m.role === 'tool').pop()
      if (!Array.isArray(j.tools) || j.tools.length === 0) { text(res, 'Stub'); return } // the engine's side calls (a title)
      if (st.mode === 'hang') return // the turn stays open: the session stays running
      if (tool === undefined) {
        const base = { id: 'chatcmpl-stub', object: 'chat.completion.chunk', created: 1, model: 'stub-1' }
        const args = JSON.stringify({ description: 'Print a probe line', command: 'echo kb-board-probe', sandbox_permissions: 'danger-full-access', justification: 'Board live check: this request exists to be answered from the board.' })
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write('data: ' + JSON.stringify(Object.assign({}, base, { choices: [{ index: 0, delta: { role: 'assistant', content: null, tool_calls: [{ index: 0, id: 'call_stub_1', type: 'function', function: { name: 'bash', arguments: '' } }] }, finish_reason: null }] })) + '\n\n')
        res.write('data: ' + JSON.stringify(Object.assign({}, base, { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: args } }] }, finish_reason: null }] })) + '\n\n')
        res.write('data: ' + JSON.stringify(Object.assign({}, base, { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })) + '\n\n')
        res.end('data: [DONE]\n\n')
        return
      }
      st.toolResults.push(typeof tool.content === 'string' ? tool.content : JSON.stringify(tool.content))
      text(res, 'OK')
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const sandbox = (script, extraEnv) => spawnSync('bash', [join(here, 'sandbox', script)], { env: Object.assign({}, process.env, extraEnv || {}), encoding: 'utf8', timeout: 240000 })
  const restart = (extraEnv) => { sandbox('stop.sh'); const r = sandbox('start.sh', extraEnv); return r.status === 0 }
  const backup = profile + '.bak-board-check'
  const provider = '      kbstub:\n        api: openai-completions\n        baseURL: http://127.0.0.1:' + port + '/v1\n        apiKeyEnv: KB_STUB_KEY\n        models:\n          - id: kbstub/stub-1\n            name: Stub\n'
  try {
    copyFileSync(profile, backup)
    writeFileSync(profile, patch.replace(anchor, anchor + provider))
    const up = restart({ KB_STUB_KEY: 'stub' })
    check('the sandbox restarts with the stub model added to ITS profile (a backup of it is put back after)', up === true)
    if (up !== true) return
    const stubTask = mk('st-board-stub', 'Stub run', { mode: 'cron', cron: '0 8 * * *', tz }, { model: 'kbstub/stub-1' })
    writeAtomic(JSON.stringify([stubTask], null, 2))
    check('the page opens on the sandbox again', (await reloadAndOpen()) === true)
    await view('columns')
    await poll(() => q('[data-kb="board-columns"]'))
    const runNow = () => click('[data-kb="board-card"][data-col="upcoming"][data-task="st-board-stub"] [data-act="launch"]')
    const engineSays = () => val(`Array.from(document.querySelectorAll('[class*="visuallyHidden"]')).map((e) => e.textContent.trim()).filter(Boolean)`)
    const cardText = (col) => val(`(document.querySelector('[data-kb="board-card"][data-col="${col}"][data-task="st-board-stub"]') || { innerText: '' }).innerText.replace(/\\s+/g, ' ')`)
    const toast = () => val(`(document.querySelector('.kba-toast') || { innerText: '' }).innerText.replace(/\\s+/g, ' ')`)

    console.log('  · a model that never answers: the session stays running')
    st.mode = 'hang'
    check('Run now is clicked', (await runNow()) === true)
    const running = await poll(() => q('[data-kb="board-card"][data-col="running"][data-state="running"][data-task="st-board-stub"]'), 30000)
    check('the run is in Running, as the engine says it is (running, not "started")', running === 1)
    check('...with its words, a pulse and See session', /Session running/.test(await cardText('running')) && (await q('[data-col="running"] [data-act="session"]')) === 1)
    check('...and the engine\'s own sidebar says "Running" for it', (await engineSays()).includes('Running'))
    await shot('automations-running')
    check('See session opens the conversation of that run', (await click('[data-col="running"] [data-act="session"]')) === true && (await poll(async () => (await q('[data-kb="page-automations"]')) === 0, 8000)) === true)
    check('...and the Automations page comes back', (await openAutomations()) === true)
    await view('columns')
    await poll(() => q('[data-kb="board-columns"]'))

    console.log('  · a model that calls a tool which needs approval: the run waits, and the board answers')
    st.mode = 'tool'
    check('Run now is clicked again', (await runNow()) === true)
    const waiting = await poll(() => q('[data-kb="board-card"][data-col="approve"][data-state="waiting"][data-task="st-board-stub"]'), 30000)
    check('To approve holds a run that WAITS, as the engine holds it (waiting, not failed)', waiting === 1)
    const wtext = await cardText('approve')
    check('...with the engine\'s own words for what it asks (the tool, the reason), not ours', /danger-full-access/.test(wtext) && /answered from the board/.test(wtext), wtext)
    check('...and Approve, Refuse and See', JSON.stringify(await attrs('[data-col="approve"] [data-kb="board-action"]', 'data-act')) === JSON.stringify(['approve', 'refuse', 'see']))
    check('...and the engine\'s own sidebar says "Waiting for approval" for it', (await engineSays()).includes('Waiting for approval'))
    await shot('automations-waiting')
    check('Refuse answers the engine\'s request', (await click('[data-col="approve"] [data-act="refuse"]')) === true && /Refused/.test(await poll(async () => { const t = await toast(); return /Refused/.test(t) ? t : '' }, 8000)))
    check('...the run leaves To approve', (await poll(async () => (await q('[data-kb="board-card"][data-col="approve"][data-state="waiting"]')) === 0, 15000)) === true)
    check('...and the model saw the refusal, not an approval', (await poll(async () => st.toolResults.length > 0, 10000)) === true && /reject|refus|denied/i.test(st.toolResults[0]) && st.toolResults[0].indexOf('kb-board-probe') < 0, st.toolResults)
    st.toolResults.length = 0

    check('a second run waits again', (await runNow()) === true && (await poll(() => q('[data-kb="board-card"][data-col="approve"][data-state="waiting"][data-task="st-board-stub"]'), 30000)) === 1)
    check('Approve answers the same request the other way', (await click('[data-col="approve"] [data-act="approve"]')) === true && /Approved/.test(await poll(async () => { const t = await toast(); return /Approved/.test(t) ? t : '' }, 8000)))
    check('...and the command ran: the model got its output back', (await poll(async () => st.toolResults.length > 0, 20000)) === true && /kb-board-probe/.test(st.toolResults[0]), st.toolResults)
    check('...and nothing is left waiting', (await poll(async () => (await q('[data-kb="board-card"][data-col="approve"][data-state="waiting"]')) === 0, 15000)) === true)
  } finally {
    try { if (existsSync(backup)) { copyFileSync(backup, profile); rmSync(backup, { force: true }) } } catch (e) { /* the sandbox is disposable */ }
    restart({})
    try { server.close() } catch (e) { /* closed */ }
  }
}

try {
  // The check must be able to see an error before it claims there is none.
  await page.send('Runtime.enable', {})
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*/kybernos/tasks*', requestStage: 'Request' }] })
  await page.evalJs(`console.error('kbbd-selftest')`, 4000)
  await sleep(200)
  check('the check can see a console error (so "none" below means none)', page.errs.some((e) => e.indexOf('kbbd-selftest') >= 0), page.errs)
  page.errs.length = 0

  console.log('\n── seeding seven automations; the scheduler adopts them (it computes their next run) ──')
  writeAtomic(JSON.stringify(SEED, null, 2))
  const adopted = await poll(async () => { const t = readTasks(); return SCHEDULED.every((id) => { const x = t.find((y) => y.id === id); return x !== undefined && typeof x.nextRun === 'string' }) }, 70000)
  check('the scheduler gave a next run to the five scheduled automations (about 30 s)', adopted === true)
  const nextOf = (id) => Date.parse((readTasks().find((t) => t.id === id) || {}).nextRun)
  check('the webhook-only and the paused ones have none', readTasks().filter((t) => ['st-board-hook', 'st-board-digest'].includes(t.id)).every((t) => t.nextRun === null))

  check('the Automations page opens', (await reloadAndOpen()) === true)

  console.log('\n── the List is the screen of today, and still the default ──')
  check('the three views are offered, in the order Columns, Calendar, List', (await val(`Array.from(document.querySelectorAll('[data-kb^="view-"]')).map((b) => b.dataset.kb.slice(5)).join()`)) === 'columns,calendar,list')
  check('...with their names, not only icons', JSON.stringify(await texts('[data-kb^="view-"]')) === JSON.stringify(['Columns', 'Calendar', 'List']), await texts('[data-kb^="view-"]'))
  check('the List is the one pressed', (await pressed()) === 'list')
  check('one row per automation (seven), no board', (await q('.kba-rowline:not(.kba-rowline-head)')) === 7 && (await q('[data-kb="board-columns"], [data-kb="board-calendar"]')) === 0)
  check('the sort menu is there for the List', (await click('[data-kb="order-control"] button')) === true && (await val(`/sort by|trier par/i.test(document.body.innerText)`)) === true)
  await val(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await val(`document.body.click()`)
  await shot('automations-list')

  console.log('\n── Columns ──')
  check('Columns opens', (await view('columns')) === true && (await poll(() => q('[data-kb="board-columns"]'))) === 1)
  check('four columns: Upcoming, Running, To approve, Done', JSON.stringify(await attrs('[data-kb="board-col"]', 'data-col')) === JSON.stringify(['upcoming', 'running', 'approve', 'done']))
  check('the titles are the page\'s words', JSON.stringify(await texts('[data-kb="board-col"] h3').then((a) => a.map((t) => t.replace(/\s*\d+$/, '')))) === JSON.stringify(['Upcoming', 'Running', 'To approve', 'Done, last 7 days']), await texts('[data-kb="board-col"] h3'))
  const cardsOf = async (col) => JSON.parse(await val(`JSON.stringify(Array.from(document.querySelectorAll('[data-kb="board-card"][data-col="${col}"]')).map((c) => ({ task: c.dataset.task, state: c.dataset.state })))`))
  const up = await cardsOf('upcoming')
  check('Upcoming: the next run of each active scheduled automation, and only those (five)', up.length === 5 && SCHEDULED.every((id) => up.some((c) => c.task === id)), up)
  const want = SCHEDULED.slice().sort((a, b) => nextOf(a) - nextOf(b))
  check('...soonest first, by the stored next run', JSON.stringify(up.map((c) => c.task)) === JSON.stringify(want), { got: up.map((c) => c.task), want })
  check('...no paused automation, no webhook-only one', !up.some((c) => c.task === 'st-board-digest' || c.task === 'st-board-hook'))
  check('Upcoming cards offer Run now', (await q('[data-kb="board-card"][data-col="upcoming"] [data-act="launch"]')) === 5)
  const running = await cardsOf('running')
  check('Running: empty, and says so (nothing is running)', running.length === 0 && /Nothing is running/.test(await val(`document.querySelector('[data-col="running"]').innerText`)))
  const approve = await cardsOf('approve')
  check('To approve: the failed run of the failing automation, and only it', approve.length === 1 && approve[0].task === 'st-board-backup' && approve[0].state === 'failed', approve)
  const failCard = await val(`document.querySelector('[data-kb="board-card"][data-col="approve"]').innerText.replace(/\\s+/g, ' ')`)
  check('...with its real reason and Retry / See journal', /no space left on device/.test(failCard) && (await q('[data-col="approve"] [data-act="retry"]')) === 1 && (await q('[data-col="approve"] [data-act="journal"]')) === 1, failCard)
  const done = await cardsOf('done')
  check('Done: the runs of the last 7 days (nine), one card per RUN, not per automation', done.length === 9, done.length)
  check('...a run whose session this page cannot see is "started", never "ended" (no outcome is invented)', done.every((c) => c.state === 'started'), done.map((c) => c.state))
  check('...so no Finished-looking claim and no dead "See session" button', (await q('[data-kb="board-card"][data-col="done"] [data-act="session"]')) === 0)
  check('...and one automation has several cards there (its runs)', done.filter((c) => c.task === 'st-board-six').length === 3)
  check('"On event" chips hold the webhook-only automation, with its last run', JSON.stringify(await texts('[data-kb="board-hooks"] button')).indexOf('New support ticket') >= 0 && /last triggered/.test(await val(`document.querySelector('[data-kb="board-hooks"]').innerText`)))
  check('the footnote counts the paused automation, not drawn', /1 paused automation is not shown here/.test(await val(`document.querySelector('[data-kb="board-columns"]').innerText`)))
  check('no cost is shown anywhere on the board (a separate plugin owns it)', !/[$€]|\bcost\b/i.test(await val(`document.querySelector('[data-kb="board-columns"]').innerText`)))
  check('the columns are states, not a ranking: nothing is draggable', (await q('[data-kb="board-columns"] [draggable="true"]')) === 0)
  check('the toolbar menu keeps its filters and drops the sort a board does not have', (await click('[data-kb="order-control"] button')) === true && (await val(`/filters|filtres/i.test(document.body.innerText) && !/sort by|trier par/i.test(document.body.innerText)`)) === true)
  await val(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await shot('automations-columns')

  console.log('\n── the choice is kept, and an old one is read ──')
  check('the toolbar stored the view', (await stored()).viewMode === 'columns')
  check('after a reload the page opens on Columns', (await reloadAndOpen()) === true && (await poll(() => q('[data-kb="board-columns"]'))) === 1 && (await pressed()) === 'columns')
  await val(`(() => { const s = JSON.parse(localStorage.getItem('kybernos.toolbar.automations')); s.viewMode = 'cards'; localStorage.setItem('kybernos.toolbar.automations', JSON.stringify(s)) })()`)
  check('a stored `cards` opens the List', (await reloadAndOpen()) === true && (await poll(() => q('.kba-rowline'))) > 0 && (await pressed()) === 'list' && (await q('[data-kb="board-columns"]')) === 0)
  check('...and is rewritten as `list`, once, silently', (await poll(async () => (await stored()).viewMode === 'list')) === true)
  await view('columns')
  await poll(() => q('[data-kb="board-columns"]'))
  await val(`(() => { const b = document.querySelector('[data-kb="toggle-search"]'); if (b) b.click() })()`)
  await sleep(300)
  await val(`(() => { const i = document.querySelector('[data-kb="toolbar"] input[type="search"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'weekly'); i.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await sleep(500)
  const searched = await attrs('[data-kb="board-card"]', 'data-task')
  check('a search narrows the columns to the automations that match', searched.length > 0 && searched.every((t) => t === 'st-board-weekly'), searched)
  await val(`(() => { const i = document.querySelector('[data-kb="toolbar"] input[type="search"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await sleep(400)

  console.log('\n── Calendar ──')
  check('Calendar opens on the week of today', (await view('calendar')) === true && (await poll(() => q('[data-kb="board-week"]'))) === 1 && (await q('[data-kb="board-day"]')) === 7)
  check('...with today marked', (await q('[data-kb="board-day"].today')) === 1)
  check('...Monday first', (await val(`document.querySelectorAll('[data-kb="board-day"]')[0].dataset.day`)) !== undefined && new Date((await val(`document.querySelectorAll('[data-kb="board-day"]')[0].dataset.day`)) + 'T12:00:00Z').getUTCDay() === 1)
  const goto = async (key) => { for (let i = 0; i < 4; i += 1) { if ((await q('[data-kb="board-day"][data-day="' + key + '"]')) === 1) return true; await click('[data-kb="board-prev"]'); await sleep(250) } return false }
  const ymd = (x) => x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0')
  const yesterday = ymd(local(-1, 12, 0))
  check('yesterday is reachable with Previous', (await goto(yesterday)) === true)
  const dayEvents = async (key) => JSON.parse(await val(`JSON.stringify(Array.from(document.querySelectorAll('[data-kb="board-day"][data-day="${key}"] [data-kb="board-event"]')).map((e) => ({ task: e.dataset.task, state: e.dataset.state, text: e.innerText.replace(/\\s+/g, ' ').trim() })))`))
  const yEv = await dayEvents(yesterday)
  const sixY = yEv.filter((e) => e.task === 'st-board-six')
  check('three runs of one automation in one day are ONE entry, "×3"', sixY.length === 1 && /×3/.test(sixY[0].text), yEv)
  check('past runs are drawn from the history, with the state the page can tell (started)', yEv.filter((e) => e.task === 'st-board-watch' || e.task === 'st-board-backup').every((e) => e.state === 'started'), yEv)
  await shot('automations-week-past')
  await click('[data-kb="board-today"]')
  await sleep(300)
  const todayKey = await val(`document.querySelector('[data-kb="board-day"].today').dataset.day`)
  const tEv = await dayEvents(todayKey)
  check('today holds the failed run of the failing automation (a failed sign)', tEv.some((e) => e.task === 'st-board-backup' && e.state === 'failed'), tEv)
  await click('[data-kb="board-next"]')
  await sleep(400)
  const nextWeek = JSON.parse(await val(`JSON.stringify(Array.from(document.querySelectorAll('[data-kb="board-event"]')).map((e) => ({ task: e.dataset.task, state: e.dataset.state })))`))
  check('the next week has planned runs only, all dashed (the scheduler\'s own matcher planned them)', nextWeek.length > 0 && nextWeek.every((e) => e.state === 'planned' || e.state === 'mixed'), nextWeek.slice(0, 5))
  check('...and a week title that moved', (await val(`document.querySelector('[data-kb="board-title"]').innerText`)).length > 6)
  await click('[data-kb="board-today"]')
  await sleep(300)
  // The detail strip: a planned run (Run now), the failed run (Retry, See journal)
  const planned = await val(`(() => { const e = Array.from(document.querySelectorAll('[data-kb="board-event"][data-state="planned"]'))[0]; if (!e) return null; e.click(); return e.dataset.task })()`)
  await sleep(300)
  check('a click on a planned run opens its detail: name, time, status, Run now', typeof planned === 'string' && (await q('[data-kb="board-detail"]')) === 1 && /Planned/.test(await val(`document.querySelector('[data-kb="board-detail"]').innerText`)) && (await q('[data-kb="board-detail"] [data-act="launch"]')) >= 1)
  await shot('automations-week-detail')
  const failedEv = await val(`(() => { const e = document.querySelector('[data-kb="board-event"][data-state="failed"]'); if (!e) return false; e.click(); return true })()`)
  await sleep(300)
  check('a click on the failed run: its reason, Retry and See journal', failedEv === true && /no space left on device/.test(await val(`document.querySelector('[data-kb="board-detail"]').innerText`)) && (await q('[data-kb="board-detail"] [data-act="retry"]')) === 1 && (await q('[data-kb="board-detail"] [data-act="journal"]')) === 1)
  check('...the same click again closes it', (await click('[data-kb="board-event"][data-state="failed"]')) === true && (await sleep(200), await q('[data-kb="board-detail"]')) === 0)
  check('the webhook-only automation is listed above, without a time', /New support ticket/.test(await val(`document.querySelector('[data-kb="board-hooks"]').innerText`)) && /no time/.test(await val(`document.querySelector('[data-kb="board-hooks"]').innerText`)))
  check('a legend explains the signs', (await q('.kbbd-legend span')) === 6)
  check('the planned runs of a dense schedule are not claimed complete beyond what the host listed (no note for a week)', (await q('[data-kb="board-truncated"]')) === 0)
  // Month
  check('Month: a grid of whole weeks, with a dot per automation and state', (await click('[data-kb="board-mode"][data-v="month"]')) === true && (await poll(() => q('[data-kb="board-month"]'))) === 1 && (await q('[data-kb="board-mcell"]')) % 7 === 0 && (await q('[data-kb="board-mcell"]')) >= 28 && (await q('.kbbd-dots i')) > 10)
  check('...past days carry the neutral dot of a run whose outcome is not known, future days the hollow one', (await q('.kbbd-dots i.idle')) > 0 && (await q('.kbbd-dots i.planned')) > 0)
  check('...today is marked and a failed run has its dot', (await q('.kbbd-mc.today')) === 1 && (await q('.kbbd-dots i.err')) >= 1)
  const t0 = await val(`document.querySelector('[data-kb="board-title"]').innerText`)
  await click('[data-kb="board-next"]')
  await sleep(300)
  check('Next moves a month', (await val(`document.querySelector('[data-kb="board-title"]').innerText`)) !== t0)
  await click('[data-kb="board-today"]')
  await sleep(300)
  await shot('automations-month')
  check('a day of the month opens its week', (await click('[data-kb="board-mcell"].today')) === true && (await poll(() => q('[data-kb="board-week"]'))) === 1)

  console.log('\n── a phone ──')
  await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: false })
  await sleep(800)
  const geo = async (sel) => JSON.parse(await val(`(() => { const r = document.querySelector(${JSON.stringify(sel)}); if (!r) return 'null'; const c = r.getBoundingClientRect(); return JSON.stringify({ sw: r.scrollWidth, cw: r.clientWidth, w: Math.round(c.width), docSw: document.documentElement.scrollWidth, docCw: document.documentElement.clientWidth }) })()`))
  await view('columns')
  await poll(() => q('[data-kb="board-columns"]'))
  let g = await geo('[data-kb="board-columns"]')
  check('Columns: nothing is wider than the screen (375 px)', g !== null && g.sw <= g.cw + 1 && g.docSw <= g.docCw + 1, g)
  const lefts = JSON.parse(await val(`JSON.stringify(Array.from(document.querySelectorAll('[data-kb="board-col"]')).map((c) => Math.round(c.getBoundingClientRect().left)))`))
  const tops = JSON.parse(await val(`JSON.stringify(Array.from(document.querySelectorAll('[data-kb="board-col"]')).map((c) => Math.round(c.getBoundingClientRect().top)))`))
  check('...the four columns are stacked', new Set(lefts).size === 1 && new Set(tops).size === 4, { lefts, tops })
  await shot('automations-phone-columns')
  await view('calendar')
  await poll(() => q('[data-kb="board-week"]'))
  g = await geo('[data-kb="board-calendar"]')
  check('Week: nothing is wider than the screen', g !== null && g.sw <= g.cw + 1 && g.docSw <= g.docCw + 1, g)
  const dtops = JSON.parse(await val(`JSON.stringify(Array.from(document.querySelectorAll('[data-kb="board-day"]')).map((c) => Math.round(c.getBoundingClientRect().top)))`))
  check('...the seven days are stacked', new Set(dtops).size === 7, dtops)
  await shot('automations-phone-week')
  await click('[data-kb="board-mode"][data-v="month"]')
  await poll(() => q('[data-kb="board-month"]'))
  g = await geo('[data-kb="board-calendar"]')
  check('Month: nothing is wider than the screen', g !== null && g.sw <= g.cw + 1 && g.docSw <= g.docCw + 1, g)
  const mtops = JSON.parse(await val(`JSON.stringify(Array.from(document.querySelectorAll('[data-kb="board-mcell"]')).slice(0, 7).map((c) => Math.round(c.getBoundingClientRect().top)))`))
  check('...the month stays a grid: seven days on a row', new Set(mtops).size === 1, mtops)
  await shot('automations-phone-month')
  await page.send('Emulation.clearDeviceMetricsOverride', {})
  await sleep(500)

  console.log('\n── the host stops answering: a banner, and a retry ──')
  await view('columns')
  await poll(() => q('[data-kb="board-columns"]'))
  const errMark = page.errs.length
  mode = 'fail'
  const banner = await poll(() => q('[data-kb="board-banner"].err'), 40000)
  check('the banner says the scheduler is not answering, and when the page last heard from it', banner === 1 && /scheduler is not answering/.test(await val(`document.querySelector('[data-kb="board-banner"]').innerText`)) && /\d\d:\d\d/.test(await val(`document.querySelector('[data-kb="board-banner"]').innerText`)))
  check('...what was loaded stays on screen', (await q('[data-kb="board-card"]')) > 0)
  await shot('automations-banner')
  mode = 'pass'
  check('Retry takes it away', (await click('[data-kb="board-retry"]')) === true && (await poll(async () => (await q('[data-kb="board-banner"]')) === 0, 15000)) === true)
  const failedLoads = page.errs.slice(errMark)
  page.errs.length = errMark

  console.log('\n── loading ──')
  mode = 'hold'
  holdMs = 3500
  await page.send('Page.reload', { ignoreCache: true })
  await sleep(2500)
  await clickText(page, 'Automations')
  const skel = await poll(() => q('.kbbd-skel[aria-busy="true"]'), 4000)
  check('a loading skeleton in the shape of the board, announced once', skel === 1 && (await q('.kbbd-skel .kbbd-col')) === 4, skel)
  await shot('automations-skeleton')
  mode = 'pass'
  check('...then the board', (await poll(() => q('[data-kb="board-card"]'), 15000)) > 0)

  console.log('\n── French ──')
  await val(`localStorage.setItem('kybernos.theme.lang', 'kybernos')`)
  check('Columns in French', (await reloadAndOpen()) === true && (await poll(() => q('[data-kb="board-columns"]'))) === 1 && JSON.stringify((await texts('[data-kb="board-col"] h3')).map((t) => t.replace(/\s*\d+$/, ''))) === JSON.stringify(['À venir', 'En cours', 'À valider', 'Terminées, 7 jours']), await texts('[data-kb="board-col"] h3'))
  check('...the views, the actions, the footnote', JSON.stringify(await texts('[data-kb^="view-"]')) === JSON.stringify(['Colonnes', 'Calendrier', 'Liste']) && /Lancer maintenant/.test(await val(`document.querySelector('[data-kb="board-columns"]').innerText`)) && /en pause n’apparaît pas ici/.test(await val(`document.querySelector('[data-kb="board-columns"]').innerText`)))
  await shot('automations-columns-fr')
  check('the calendar in French (days, title)', (await view('calendar')) === true && (await poll(() => q('[data-kb="board-week"]'))) === 1 && /lun\./.test(await val(`document.querySelector('[data-kb="board-week"]').innerText`)) && /octobre|novembre|décembre|septembre|janvier/.test(await val(`document.querySelector('[data-kb="board-title"]').innerText`)))
  await val(`localStorage.removeItem('kybernos.theme.lang')`)

  console.log('\n── « Run now »: a real session, and what the board may say about it ──')
  check('back on English', (await reloadAndOpen()) === true)
  await view('columns')
  await poll(() => q('[data-kb="board-columns"]'))
  const histBefore = (readTasks().find((t) => t.id === 'st-board-watch') || { history: [] }).history.length
  check('Run now is clicked on the Competitive watch card', (await click('[data-kb="board-card"][data-col="upcoming"][data-task="st-board-watch"] [data-act="launch"]')) === true)
  // Watch the state of the NEW run every 100 ms: it can only be `running` then `ended`, never anything else.
  const seen = []
  const end = Date.now() + 25000
  let newSession = null
  while (Date.now() < end) {
    const h = (readTasks().find((t) => t.id === 'st-board-watch') || { history: [] }).history
    if (h.length > histBefore && newSession === null) newSession = h[h.length - 1]
    const states = JSON.parse(await val(`JSON.stringify(Array.from(document.querySelectorAll('[data-kb="board-card"][data-task="st-board-watch"]')).filter((c) => c.dataset.col !== 'upcoming').map((c) => c.dataset.col + ':' + c.dataset.state))`))
    const fresh = states.filter((s) => !/:started$/.test(s))
    const tag = fresh.join(',')
    if (tag !== '' && seen[seen.length - 1] !== tag) seen.push(tag)
    if (/done:ended/.test(tag) && Date.now() > end - 20000) break
    await sleep(100)
  }
  check('the host started a REAL session and recorded it on the run', newSession !== null && newSession.status === 'fired' && typeof newSession.sessionId === 'string' && newSession.sessionId.indexOf('seed-session') < 0, newSession)
  console.log('  · states of the new run, as the board showed them: ' + seen.join(' → '))
  check('the board only said what the engine said: running and/or ended, in that order', seen.length > 0 && seen.every((s) => /^(running:running|done:ended|running:running,done:ended)$/.test(s) || /^(done:ended)$/.test(s)), seen)
  check('it ended in Done, "ended" (not claimed as success: the session has ended, open it to see)', /done:ended/.test(seen[seen.length - 1] || ''))
  const engineSays = await val(`Array.from(document.querySelectorAll('[class*="visuallyHidden"]')).map((e) => e.textContent.trim()).filter(Boolean)`)
  check('the engine\'s own sidebar says the same: that session is "Completed"', Array.isArray(engineSays) && engineSays.includes('Completed'), engineSays)
  check('the card now offers See session (the page can see that session)', (await q('[data-kb="board-card"][data-col="done"][data-task="st-board-watch"][data-state="ended"] [data-act="session"]')) === 1)
  await shot('automations-after-run')

  console.log('\n── an automation that can never fire is said ──')
  const all = readTasks()
  all.push(mk('st-board-never', 'Impossible date', { mode: 'cron', cron: '0 0 31 2 *', tz }))
  writeAtomic(JSON.stringify(all, null, 2))
  const note = await poll(() => q('[data-kb="board-cannot"]'), 40000)
  check('a note under Upcoming: it will not start, and why', note === 1 && /Impossible date will not start/.test(await val(`document.querySelector('[data-kb="board-cannot"]').innerText`)), await texts('[data-kb="board-cannot"]'))

  console.log('\n── nothing at all ──')
  writeAtomic('[]')
  const empty = await poll(() => q('[data-kb="automations-onboarding"]'), 40000)
  check('with no automation the page explains what one is and that the automation-creator interview makes it, in every view', empty === 1 && /automation-creator/.test(await val(`document.querySelector('[data-kb="automations-onboarding"]').innerText`)) && (await q('[data-kb="board-columns"]')) === 0)

  if (withStub === true) await stubSection()
  else console.log('\n  (without --stub-model: a run that is running and one that waits for an approval are not exercised live)')

  console.log('\n── errors ──')
  check('no exception in the page', exceptions.length === 0, exceptions)
  check('no console error (the requests this check refused on purpose aside)', page.errs.length === 0, page.errs)
  console.log('  · refused on purpose, seen as console errors: ' + failedLoads.length)
} catch (e) {
  fail += 1
  console.log('  ✗ the check stopped: ' + (e && e.message ? e.message : e))
} finally {
  restore()
  await live.close()
}

console.log('\n' + (fail === 0 ? 'ALL ' + pass + ' CHECKS PASS' : fail + ' FAILED, ' + pass + ' passed'))
process.exit(fail === 0 ? 0 : 1)
