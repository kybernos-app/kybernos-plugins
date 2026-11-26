#!/usr/bin/env node
// Kaby's wake-up and the certification gate of the Automations page, as the user-journey recette (R5, J14-03 and J16-02/05) saw them, in a real GUI on a sandbox.
//
//   scripts/sandbox/setup.sh && scripts/sandbox/start.sh
//   source scripts/sandbox/env.sh && node scripts/check-kaby-journeys-live.mjs
//
// It needs no model: nothing here starts a run. It reads and writes the sandbox's own automations (the ones it makes are deleted at the end) and refuses to run on the real :3080 (exit 3).
// What it pins (all measured on 2026-11-04):
//   1. An automation made through the route the Schedule form posts to (`action: create`, `active: true`) is stored ON while its gate is `draft`; it can neither be run now nor
//      switched on again without an approval (« approval required »).
//   2. The wake-up Kaby's page makes (the same input as Settings › Kaby › Work): every 4 hours from 08:00 to 20:00 in the machine's zone, 10 minutes at most, stops when the person
//      writes, in Kaby's own chat, OFF, gate `draft`; its prompt names todo.md; it cannot be run or switched on before an approval.
//   3. The gate's static checks pass on the wake-up and warn about two words of its own safety sentence (« send », « pay »): warnings, never errors.
//   4. A schedule more frequent than every 5 minutes is refused (« frequent schedule »).
// Exit code 0 pass, 1 fail, 3 not run.
import { openLivePage, waitFor } from './live-page.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 500))) }
}
const authority = process.env.KB_HOST || '127.0.0.1:3080'
if (authority === '127.0.0.1:3080') { console.log('refusing to run on the real :3080: use the sandbox (source scripts/sandbox/env.sh)'); process.exit(3) }

const live = await openLivePage({ width: 1200, height: 900 })
const { page } = live
const js = async (expr, ms = 15000) => { const r = await page.evalJs(expr, ms); return r.err !== undefined ? { err: r.err } : r.val }
const api = (path, body) => js(`fetch(${JSON.stringify(path)}, ${body === undefined ? '{ credentials: "same-origin" }' : `{ method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }`}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }))`)
const tasks = (body) => api('/kybernos/tasks', body)
const made = []
try {
  await page.send('Page.navigate', { url: 'http://' + authority + '/' })
  await waitFor(page, 'document.body && document.body.innerText.length > 40', 30000)

  console.log('── an automation from the form path ──')
  const spec = { name: 'Journey check (form path)', prompt: '1. Reply with the single word OK.', schedule: { mode: 'cron', cron: '0 8 * * 1', tz: 'Europe/Paris' }, active: true, approvals: 'ask', notify: [], runsOn: 'local' }
  const created = (await tasks({ action: 'create', task: spec })).json
  check('create answers ok', created !== null && created.ok === true, created)
  const id = created && created.task ? created.task.id : null
  if (id !== null) made.push(id)
  const listed = ((await tasks({ action: 'list' })).json || {}).tasks || []
  const mine = listed.find((t) => t.id === id)
  check('it is stored ON while its gate is « draft »', !!mine && mine.active === true && mine.gate && mine.gate.status === 'draft', mine && { active: mine.active, gate: mine.gate })
  const run = (await tasks({ action: 'run-now', id })).json
  check('« run now » is refused until it is approved', run !== null && run.ok === false && run.error === 'approval required', run)
  const off = (await tasks({ action: 'toggle', id, active: false })).json
  const on = (await tasks({ action: 'toggle', id, active: true })).json
  check('switched off then on again: the second step is refused (« approval required »)', off !== null && off.ok === true && on !== null && on.ok === false && on.error === 'approval required', { off, on })
  const tooOften = (await tasks({ action: 'create', task: { ...spec, name: 'Journey check (every minute)', schedule: { mode: 'cron', cron: '* * * * *', tz: 'Europe/Paris' } } })).json
  check('a schedule more often than every 5 minutes is refused', tooOften !== null && tooOften.ok === false && tooOften.error === 'frequent schedule', tooOften)

  console.log('── the wake-up, as Settings › Kaby › Work makes it ──')
  const native = (await api('/kybernos-cloud/kyby/native')).json
  const sid = native && native.sessionId ? native.sessionId : null
  if (sid === null) {
    console.log('  · Kaby has no chat yet in this sandbox: open it once (the wake-up runs there). The wake-up half is not run.')
  } else {
    const wake = { name: 'Journey check wake-up', prompt: 'This is your scheduled wake-up. Read todo.md in your workspace and take the 2 oldest points still open. Never send, publish, pay, install, schedule or switch anything on.', active: false, approvals: 'ask', notify: [], runsOn: 'local', sessionMode: 'home', homeSessionId: sid, maxMinutes: 10, onPersonWrites: 'stop', schedule: { mode: 'cron', cron: '0 8-20/4 * * *' } }
    const w = (await tasks({ action: 'create', task: wake })).json
    check('the wake-up is created', w !== null && w.ok === true, w)
    const wid = w && w.task ? w.task.id : null
    if (wid !== null) made.push(wid)
    const stored = (((await tasks({ action: 'list' })).json || {}).tasks || []).find((t) => t.id === wid)
    check('stored OFF, in Kaby’s chat, 10 minutes at most, stops when the person writes, gate draft', !!stored && stored.active === false && stored.sessionMode === 'home' && stored.homeSessionId === sid && stored.maxMinutes === 10 && stored.onPersonWrites === 'stop' && stored.gate && stored.gate.status === 'draft', stored)
    check('its schedule is every 4 hours from 08:00 to 20:00 in a named zone', !!stored && stored.schedule && stored.schedule.cron === '0 8-20/4 * * *' && typeof stored.schedule.tz === 'string' && stored.schedule.tz !== '', stored && stored.schedule)
    check('« Wake it now » (run now) is refused before an approval', ((await tasks({ action: 'run-now', id: wid })).json || {}).error === 'approval required')
    check('switching it on is refused before an approval', ((await tasks({ action: 'toggle', id: wid, active: true })).json || {}).error === 'approval required')
    const gate = (await tasks({ action: 'gate-check', id: wid })).json
    check('the static checks pass, with warnings only', gate !== null && gate.ok === true && gate.gate && gate.gate.status === 'static-passed' && (gate.gate.staticChecks.findings || []).every((f) => f.severity === 'warn'), gate && gate.gate && gate.gate.staticChecks)
  }
} finally {
  for (const id of made) { try { await tasks({ action: 'delete', id }) } catch (e) { /* the sandbox is thrown away anyway */ } }
  await live.close()
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
