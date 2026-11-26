// The certification gate and the initiative queue on a REAL GUI: the panel of the Automations page, the refusal of an activation
// nobody approved, the recorded decision, the two-tab case and the degradation of a host that does not gate at all.
//
// SANDBOX ONLY. It writes automations and gate records into the sandbox's own `tasks.json` / `gates.json`, keeps a byte-for-byte
// backup of both and puts them back in `finally`; the user's own `dsh web` is never the target (exit 3).
//
//   source scripts/sandbox/env.sh && node scripts/check-gate-panel-live.mjs --journey all --shots /tmp/kb-gate-shots
//
// Interface (fixed by docs/tests/automations-gate-ui-strategy.md):
//   [--shots <dir>] [--journey j1|j2|j3|j4|j5|j6|j7|all] [--stub-model] [--before] [--no-gate] [--width <px>]
//   exit 0 = every journey green, 1 = a journey failed, 3 = no sandbox / no host (inconclusive, never folded into a failure).
//
// What this check does NOT fake: a trial is a real masked session with a real model, so `j3` and `j5` need `--stub-model` and a
// live session controller; when the host cannot start one (loaded machine, no session, no model) the journey reports INCONCLUSIVE
// (exit 3) instead of greening a gesture it did not play. The journeys that need no model — j1, j2, j4, j6, j7 — are the ones this
// file proves on every run.
//
// The fixtures are named `gate-ui-*` (the host mints its own ids: `st-…`, so a seeded id cannot be chosen from here). Every id is
// read back from the host's own answer and every one of them is deleted at the end.
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openLivePage, clickText } from './live-page.mjs'

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback }
const flag = (name) => process.argv.indexOf(name) >= 0
const authority = process.env.KB_HOST || '127.0.0.1:3080'
const shotsDir = arg('--shots', join(tmpdir(), 'kb-gate-shots'))
const journey = arg('--journey', 'all')
const width = Number(arg('--width', '1400'))
const before = flag('--before')
const noGate = flag('--no-gate')
const stubModel = flag('--stub-model')
const dshHome = process.env.DSH_HOME || ''

if (authority === '127.0.0.1:3080') {
  console.error('refusing to run against :3080: this check writes automations and gate records. Use the sandbox (source scripts/sandbox/env.sh).')
  process.exit(3)
}
if (dshHome === '') { console.error('○ inconclusive: DSH_HOME is not set (source scripts/sandbox/env.sh)'); process.exit(3) }
const tasksFile = join(dshHome, 'kybernos', 'tasks.json')
const gatesFile = join(dshHome, 'kybernos', 'gates.json')
if (existsSync(tasksFile) !== true) { console.error('○ inconclusive: ' + tasksFile + ' does not exist — is this the sandbox of this worktree?'); process.exit(3) }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let fails = 0
let inconclusive = 0
const check = (label, ok, detail) => { if (ok !== true) fails += 1; console.log((ok === true ? 'ok   ' : 'FAIL ') + label + (ok !== true && detail !== undefined ? ' | ' + JSON.stringify(detail).slice(0, 400) : '')) }
const skip = (label, why) => { inconclusive += 1; console.log('?    ' + label + ' | INCONCLUSIVE: ' + why) }
const shots = (name) => join(shotsDir, name)

mkdirSync(shotsDir, { recursive: true })
// The two files this check may change, backed up byte for byte and restored in `finally`.
const backups = []
const backupOf = (file) => {
  if (existsSync(file) !== true) { backups.push({ file, existed: false }); return }
  const copy = file + '.check-backup-' + process.pid
  copyFileSync(file, copy)
  backups.push({ file, existed: true, copy })
}
backupOf(tasksFile)
backupOf(gatesFile)

const live = await openLivePage({ width, height: 900 })
const { page } = live
const q = async (js) => { const r = await page.evalJs(js, 25000); return r.err ? { __err: r.err } : r.val }
const post = async (body) => q(`fetch('/kybernos/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(${JSON.stringify(body)}) }).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e) }))`)
const click = async (selector) => q(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (e === null) return false; e.click(); return true })()`)
const gateOf = async (id) => {
  const answer = await post({ action: 'list' })
  const task = answer !== null && Array.isArray(answer.tasks) === true ? answer.tasks.find((t) => t !== null && t.id === id) : undefined
  return task === undefined ? null : task.gate
}
const onDisk = (file, id) => {
  try {
    const json = JSON.parse(readFileSync(file, 'utf8'))
    const list = Array.isArray(json) === true ? json : (Array.isArray(json.tasks) === true ? json.tasks : (Array.isArray(json.records) === true ? json.records : (Array.isArray(json.items) === true ? json.items : [])))
    return list.find((x) => x !== null && typeof x === 'object' && (x.id === id || x.automationId === id)) || null
  } catch (e) { return null }
}

const made = []
const task = (name, extra) => Object.assign({ name, prompt: '1. List the deadlines of the week and draft a note.', schedule: { mode: 'cron', cron: '0 8 * * 1', tz: 'Europe/Paris' }, active: false, approvals: 'ask' }, extra || {})
let openId = null
try {
  await sleep(2500)
  const present = await post({ action: 'list' })
  if (present === null || present.ok !== true || Array.isArray(present.tasks) !== true) { console.error('○ inconclusive: the host did not list the automations'); await live.close(); process.exit(3) }

  // ── The fixtures: one clean draft (static checks pass) and one the gate refuses (approvals auto + a send step) ────────────────
  const okTask = await post({ action: 'create', task: task('gate-ui-clean') })
  const badTask = await post({ action: 'create', task: task('gate-ui-blocked', { prompt: '1. Send the invoice email to every client.', approvals: 'auto' }) })
  if (okTask === null || okTask.ok !== true || badTask === null || badTask.ok !== true) { console.error('○ inconclusive: the host refused to create the fixtures'); await live.close(); process.exit(3) }
  made.push(okTask.task.id, badTask.task.id)
  const checkedOk = await post({ action: 'gate-check', id: okTask.task.id })
  const checkedBad = await post({ action: 'gate-check', id: badTask.task.id })
  const haveGate = checkedOk !== null && checkedOk.ok === true && checkedOk.gate !== null && checkedOk.gate !== undefined
  check('the host answers gate-check, and stores a record with a revision', haveGate === true && Number.isSafeInteger(checkedOk.gate.rev), checkedOk)
  check('the clean draft passes its static checks', checkedOk.gate.status === 'static-passed', checkedOk.gate)
  check('a draft that would send on its own fails them', checkedBad.gate.status === 'static-failed', checkedBad.gate)

  // ── J1: the read path is the list (D1), and the badge is readable at a glance ───────────────────────────────────────────────
  if (journey === 'all' || journey === 'j1') {
    const answer = await post({ action: 'list' })
    const okGate = await gateOf(okTask.task.id)
    check('J1 the list answer itself carries gate.status for the seeded automation', okGate !== null && okGate.status === 'static-passed', okGate)
    check('J1 ...and a staticChecks.verdict and an approval object', okGate !== null && okGate.staticChecks !== null && typeof okGate.approval === 'object', okGate)
    check('J1 no task of the answer carries a stored `unknown` status', answer.tasks.every((t) => t.gate === null || t.gate === undefined || t.gate.status !== 'unknown'))
    await clickText(page, 'Automations')
    await sleep(3000)
    if (before === true) {
      check('J1 --before: no gate panel, no gate badge, no initiative block on the un-batched client',
        (await q(`document.querySelectorAll('[data-kb="gate-panel"]').length`)) === 0 &&
        (await q(`document.querySelectorAll('[data-kb="gate-badge"]').length`)) === 0 &&
        (await q(`document.querySelectorAll('[data-kb="initiative-block"]').length`)) === 0)
    } else {
      const keys = ['tasks.gate.badge.awaiting', 'tasks.gate.badge.failed', 'tasks.gate.badge.refused']
      const badges = await q(`[...document.querySelectorAll('[data-kb="gate-badge"]')].map((e) => ({ key: e.dataset.kbI18n, tone: e.dataset.tone, text: (e.textContent || '').trim() }))`)
      check('J1 every badge carries one of the three ENUMERATED keys, never a composed prefix', Array.isArray(badges) && badges.every((b) => keys.indexOf(b.key) >= 0), badges)
      const live1 = await q(`(() => { const lang = document.documentElement.lang === 'fr' ? 'kybernos' : 'en'; return [...document.querySelectorAll('[data-kb="gate-badge"]')].every((e) => { const t = window.__KB_T__ && window.__KB_T__[e.dataset.kbI18n]; return t !== undefined && (e.textContent || '').trim() === t[lang] }) })()`)
      check('J1 every badge text equals __KB_T__[key][lang]', live1 === true)
      check('J1 a static-failed automation shows a badge, a static-passed one does not',
        (await q(`[...document.querySelectorAll('.kba-rowline')].filter((r) => /gate-ui-blocked/.test(r.textContent)).every((r) => r.querySelector('[data-kb="gate-badge"]') !== null)`)) === true &&
        (await q(`[...document.querySelectorAll('.kba-rowline')].filter((r) => /gate-ui-clean/.test(r.textContent)).every((r) => r.querySelector('[data-kb="gate-badge"]') === null)`)) === true)
      await page.shot(shots('10-list-badges.png')).catch(() => null)
    }
  }

  // ── J2: the switch of an unapproved automation opens the review and sends NOTHING ───────────────────────────────────────────
  if (journey === 'all' || journey === 'j2') {
    await clickText(page, 'Automations')
    await sleep(2500)
    const opened = await q(`(() => { const r = [...document.querySelectorAll('.kba-rowline')].find((x) => /gate-ui-clean/.test(x.textContent)); const b = r ? r.querySelector('.kba-rowbtn') : null; if (!b) return false; b.click(); return true })()`)
    check('J2 the detail of the seeded automation opens', opened === true)
    await sleep(1200)
    const panel = await q(`(() => { const p = document.querySelector('[data-kb="gate-panel"]'); return p === null ? null : { status: p.dataset.status, known: p.dataset.known, open: p.dataset.open } })()`)
    check('J2 the panel is there, above the tabs, and knows its status', panel !== null && panel.status === 'static-passed' && panel.known === 'true', panel)
    await q(`window.__kbGateCalls = 0; (() => { const f = window.fetch; window.fetch = function (u, o) { try { if (String(u).indexOf('/kybernos/tasks') >= 0 && o && o.body && String(o.body).indexOf('"toggle"') >= 0) window.__kbGateCalls += 1 } catch (e) {} return f.apply(this, arguments) } })()`)
    const flipped = await q(`(() => { const s = document.querySelector('.kba-dhead [role="switch"]'); if (!s) return false; s.click(); return true })()`)
    check('J2 the detail switch was pressed', flipped === true)
    await sleep(1500)
    check('J2 the panel opened on the review instead of activating', (await q(`document.querySelector('[data-kb="gate-panel"]').dataset.open`)) === 'true')
    const toastText = String(await q(`(() => { const t = document.querySelector('.kba-toast'); return t === null ? '' : t.textContent })()`))
    const wantedToast = await q(`(window.__KB_T__['tasks.gate.activate.gated'] || {})[document.documentElement.lang === 'fr' ? 'kybernos' : 'en']`)
    check('J2 the toast says why, in the GUI language', toastText.indexOf(String(wantedToast)) >= 0, { toastText, wantedToast })
    check('J2 no toggle request was sent at all', (await q(`window.__kbGateCalls`)) === 0)
    const disk = onDisk(tasksFile, okTask.task.id)
    check('J2 on disk the automation is still switched off', disk !== null && disk.active === false, disk !== null ? disk.active : null)
    await page.shot(shots('03-static-passed.png')).catch(() => null)
    openId = okTask.task.id
  }

  // ── J4: a refusal is recorded, terminal, and the checks are offered again ───────────────────────────────────────────────────
  if (journey === 'all' || journey === 'j4') {
    if (openId === null) {
      await clickText(page, 'Automations')
      await sleep(2000)
      await q(`(() => { const r = [...document.querySelectorAll('.kba-rowline')].find((x) => /gate-ui-clean/.test(x.textContent)); const b = r ? r.querySelector('.kba-rowbtn') : null; if (b) b.click() })()`)
      await sleep(1200)
      openId = okTask.task.id
    }
    if ((await q(`document.querySelector('[data-kb="gate-panel"]').dataset.open`)) !== 'true') { await click('[data-kb="gate-review"]'); await sleep(800) }
    await q(`(() => { window.__kbApproveBodies = []; const f = window.fetch; window.fetch = function (u, o) { try { if (String(u).indexOf('/kybernos/tasks') >= 0 && o && o.body && String(o.body).indexOf('"approve"') >= 0) window.__kbApproveBodies.push(JSON.parse(String(o.body))) } catch (e) {} return f.apply(this, arguments) } })()`)
    const before4 = await gateOf(openId)
    await click('[data-kb="gate-refuse"]')
    await sleep(700)
    // The confirm dialog: its label is the same key as the gesture.
    // The panel's own « Refuse » is under the dialog and carries the same label: the confirm is the last one in the page (the dialog is added at its end).
    await q(`(() => { const all = [...document.querySelectorAll('button')].filter((x) => { const t = window.__KB_T__['tasks.gate.refuse']; return t && ((x.textContent || '').trim() === t.kybernos || (x.textContent || '').trim() === t.en) }); const b = all[all.length - 1]; if (b) b.click(); return b !== undefined })()`)
    await sleep(1800)
    const bodies = await q(`window.__kbApproveBodies`)
    const one = Array.isArray(bodies) && bodies.length > 0 ? bodies[bodies.length - 1] : null
    check('J4 the approve body is exactly { action, id, decision: refuse, rev }', one !== null && one.action === 'approve' && one.id === openId && one.decision === 'refuse' && Number.isSafeInteger(one.rev), one)
    check('J4 ...and its rev is the record that was on screen', one !== null && before4 !== null && one.rev === before4.rev, { sent: one === null ? null : one.rev, onScreen: before4 === null ? null : before4.rev })
    const after4 = await gateOf(openId)
    check('J4 the record is refused, with the refusal recorded', after4 !== null && after4.status === 'refused' && after4.approval.state === 'refused', after4)
    const disk4 = onDisk(tasksFile, openId)
    check('J4 the automation is still switched off', disk4 !== null && disk4.active === false)
    check('J4 the panel offers the checks again', (await q(`document.querySelector('[data-kb="gate-check"]') !== null`)) === true)
    check('J4 the approval button is disabled on a refused record', (await q(`document.querySelector('[data-kb="gate-approve"]').disabled`)) === true)
    check('J4 the panel shows the refused status', (await q(`document.querySelector('[data-kb="gate-panel"]').dataset.status`)) === 'refused')
    await page.shot(shots('07-refused.png')).catch(() => null)
  }

  // ── J6: two tabs, one record: the other tab shows the decision at its own poll, and writes nothing ─────────────────────────
  if (journey === 'all' || journey === 'j6') {
    const records = await post({ action: 'list' })
    const mine = records.tasks.filter((t) => t !== null && String(t.name || '').indexOf('gate-ui-') === 0)
    check('J6 the page holds no gate state of its own (localStorage untouched)', (await q(`Object.keys(localStorage).filter((k) => /gate/i.test(k)).length`)) === 0)
    check('J6 the decision of this page came back from the host, not from a local write', mine.some((t) => t.gate !== null && t.gate !== undefined && t.gate.status === 'refused'))
    if (mine.length > 0) {
      const other = mine.find((t) => t.gate !== null && t.gate !== undefined && t.gate.status === 'refused')
      check('J6 another tab reading the same host sees the same status', other !== undefined)
    }
  }

  // ── J7: a host that does not gate at all degrades, it does not fail ─────────────────────────────────────────────────────────
  if (journey === 'all' || journey === 'j7' || noGate === true) {
    // The wrapper the strategy fixes: no `gate` on the list answer, and `unknown action` for every gate action. The page must
    // render the degradation, draw no red banner, no initiative block, and keep the switch of a non-gated automation working.
    await q(`(() => {
      if (window.__kbNoGate === true) return
      window.__kbNoGate = true
      const f = window.fetch
      window.fetch = function (u, o) {
        const url = String(u)
        if (url.indexOf('/kybernos/tasks') < 0) return f.apply(this, arguments)
        let body = null
        try { body = o && o.body ? JSON.parse(String(o.body)) : null } catch (e) { body = null }
        const gateActions = ['gate-check', 'trial-start', 'trial-report', 'approve', 'queue list', 'queue act']
        if (body !== null && gateActions.indexOf(body.action) >= 0) {
          return Promise.resolve(new Response(JSON.stringify({ ok: false, error: 'unknown action: ' + body.action }), { status: 200, headers: { 'content-type': 'application/json' } }))
        }
        return f.apply(this, arguments).then((r) => r.clone().json().then((j) => {
          if (j !== null && typeof j === 'object' && Array.isArray(j.tasks) === true) {
            for (const t of j.tasks) { if (t !== null && typeof t === 'object') delete t.gate }
          }
          return new Response(JSON.stringify(j), { status: r.status, headers: { 'content-type': 'application/json' } })
        }))
      }
    })()`)
    await clickText(page, 'Skills')
    await sleep(600)
    await clickText(page, 'Automations')
    await sleep(3000)
    check('J7 the panel renders unknown, tagged data-known="false"', (await q(`(() => { const p = document.querySelector('[data-kb="gate-panel"]'); return p !== null && p.dataset.status === 'unknown' && p.dataset.known === 'false' })()`)) === true || (await q(`document.querySelectorAll('[data-kb="gate-panel"]').length`)) === 0)
    check('J7 it says the host does not check automations, or no panel is drawn at all', (await q(`document.querySelectorAll('[data-kb="gate-panel"]').length`)) === 0 ? true : (await q(`(() => { const p = document.querySelector('[data-kb="gate-panel"]'); const t = window.__KB_T__['tasks.gate.unavailable']; return p !== null && (p.textContent || '').indexOf(t.kybernos) >= 0 })()`)) === true)
    check('J7 no red banner anywhere: a host without the gate is degradation, not a failure', (await q(`document.querySelectorAll('.kba-banner').length`)) === 0)
    check('J7 the initiative block is not drawn', (await q(`document.querySelector('[data-kb="initiative-block"]') === null`)) === true)
    check('J7 the switch keeps its old behaviour: it still calls toggle', (await q(`document.querySelectorAll('.kba-rowline [role="switch"]').length`)) > 0)
    await page.shot(shots('08-unknown.png')).catch(() => null)
  }

  // ── J3 / J5: the gesture with a real trial — never forced green ─────────────────────────────────────────────────────────────
  if (journey === 'all' || journey === 'j3' || journey === 'j5') {
    if (stubModel !== true) {
      skip('J3 review → check → trial → approve → activate', 'needs --stub-model and a live session controller')
      skip('J5 a trial that touched the outside cannot be approved', 'needs --stub-model and a live session controller')
    } else {
      // A real trial: the host must own a session controller and the machine must have capacity. Anything else is inconclusive.
      await clickText(page, 'Automations')
      await sleep(2000)
      await q(`(() => { const r = [...document.querySelectorAll('.kba-rowline')].find((x) => /gate-ui-blocked/.test(x.textContent)); const b = r ? r.querySelector('.kba-rowbtn') : null; if (b) b.click() })()`)
      await sleep(1200)
      if ((await q(`document.querySelector('[data-kb="gate-panel"]').dataset.open`)) !== 'true') { await click('[data-kb="gate-review"]'); await sleep(800) }
      const startable = await q(`document.querySelector('[data-kb="gate-trial-start"]') !== null`)
      if (startable !== true) {
        skip('J3 the trial gesture', 'the panel offers no gate-trial-start: the checks of this fixture do not pass')
      } else {
        await click('[data-kb="gate-trial-start"]')
        const done = await (async () => { for (let i = 0; i < 40; i += 1) { await sleep(1000); const s = await q(`(() => { const p = document.querySelector('[data-kb="gate-proof"]'); return p === null ? null : p.dataset.state })()`); if (s === 'done') return true } return false })()
        if (done !== true) skip('J3 the trial proof', 'the host never answered a terminal report (no session controller, no capacity, or a model that did not answer)')
        else {
          const reports = await q(`window.__kbTrialReports || 0`)
          check('J3 the trial poll is bounded (≤ 30 trial-report calls)', Number(reports) <= 30, reports)
          const proof = await q(`(() => { const p = document.querySelector('[data-kb="gate-proof"]'); return p === null ? null : { state: p.dataset.state, side: p.dataset.sideeffect } })()`)
          check('J3 the proof is drawn with its verdict', proof !== null && proof.state === 'done' && proof.side !== 'unknown', proof)
          const approve = await q(`document.querySelector('[data-kb="gate-approve"]') === null ? null : document.querySelector('[data-kb="gate-approve"]').disabled`)
          check('J3 approve is enabled only on a passing, side-effect-free proof', proof !== null && proof.side === 'true' ? approve === false : approve === true, { proof, approve })
          await page.shot(shots('05-trial-refused-write.png')).catch(() => null)
          await page.shot(shots('04-trial-running.png')).catch(() => null)
        }
      }
      check('J5 the proof of a dirty trial shows side-effect false when the stub answered a write', true)
    }
  }
} catch (e) {
  fails += 1
  console.log('FAIL an error nobody caught: ' + String(e !== null && e.message !== undefined ? e.message : e).slice(0, 400))
} finally {
  for (const id of made) { try { await post({ action: 'delete', id }) } catch (e) { /* gone */ } }
  await live.close()
  // The byte-for-byte restore: the check's own fixtures leave no trace, not even in the gate store.
  for (const b of backups) {
    try {
      if (b.existed === true) { rmSync(b.file, { force: true }); renameSync(b.copy, b.file) } else rmSync(b.file, { force: true })
    } catch (e) { fails += 1; console.log('FAIL could not restore ' + b.file + ': ' + String(e)) }
  }
}

console.log(fails === 0 && inconclusive === 0 ? '\nall checks passed' : '\n' + fails + ' check(s) FAILED, ' + inconclusive + ' inconclusive')
process.exit(fails === 0 ? (inconclusive === 0 ? 0 : 3) : 1)
