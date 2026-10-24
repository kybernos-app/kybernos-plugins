#!/usr/bin/env node
// The « Team » segment of the Automations page, on the REAL GUI of a SANDBOX instance (nothing is written, no account is needed).
//
//   source scripts/sandbox/env.sh && node scripts/check-automations-team-live.mjs [--shots <dir>]
//
// What is real: the DSH page, its theme and CSS, the Automations page of THIS checkout (the sandbox serves it), a real mouse. What is faked, inside the
// throw-away browser: the Team routes of the server (/kybernos-cloud/team/automations*), the four local routes (/kybernos/automation/team-*), the list of
// the automations and their link to a cloud computer (POST /kybernos/tasks), the cloud computers, the connected apps, the account state and the page of the plans.
// Every other request that is not a GET and goes to this DSH is refused (403) and listed, so nothing the page does can write, install or open anything.
//
// It presses every button of the tab and of the four sheets, with a real mouse event, and checks that the press lands on the button (nothing covers it); it tries
// the failure states (a refusal, a dropped connection, a secret, an app that is not connected, a computer that cannot ask) and the five locks, in English and in French,
// at 1400, 700 and 390 px. Screenshots go to --shots.
//
// Sandbox only: it refuses :3080 (exit 3). Exit 0 all good, 1 a check failed, 3 not run.
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openLivePage, waitFor, clickText } from './live-page.mjs'

const args = process.argv.slice(2)
const shotsDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const host = process.env.KB_HOST || ''
const home = process.env.DSH_HOME || ''
if (host === '' || host === '127.0.0.1:3080') { console.error('○ not run: this check needs a sandbox instance (source scripts/sandbox/env.sh), never the DSH on :3080'); process.exit(3) }
if (home.indexOf('.kybernos-sandbox') < 0) { console.error('○ not run: DSH_HOME is not a sandbox home'); process.exit(3) }

let pass = 0
const failures = []
const check = (label, cond, detail) => {
  if (cond) { pass += 1; console.log('  ✓ ' + label) } else { failures.push(label); console.log('  ✗ ' + label + (detail === undefined ? '' : '  — ' + JSON.stringify(detail).slice(0, 500))) }
}

// ── the fake world ──
const H = (c) => c.repeat(64)
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString()
const srow = (id, key, name, over) => ({
  id, key, name, description: 'About ' + name, version: H(String(id % 10)), status: 'approved', schedule: { mode: 'cron', cron: '0 9 * * 1' }, needs: ['gmail', 'slack'], prompt_chars: 120,
  proposed_by_name: 'Léa Martin', proposed_at: ago(3), reviewed_by_name: 'Julien Petit', reviewed_at: ago(2), note: null, review_note: null, replaces: null, superseded_by: null, mine: false, ...over,
})
const PROMPT_OLD = 'Summarise the client e-mails of the week.\nPost the digest in #clients.\nNever reply to a client yourself.'
const PROMPT_NEW = 'Summarise the client e-mails of the week, grouped by client.\nPost the digest in #clients and mention the account owner.\nNever reply to a client yourself.'
const PROMPT_INV = 'Every Monday, look at the invoices in Gmail labelled “To chase” that are more than 30 days old.\nFor each one, write a short, polite reminder in the client’s language and save it as a draft.\nNever send an e-mail yourself. Post the list of drafts in #finance.'
const freshRows = () => [
  srow(1, 'weekly-client-digest', 'Weekly client digest', { version: H('4'), revision: 4, description: 'Summarises the week’s client e-mails, grouped by client, and posts the digest to Slack.', schedule: { mode: 'cron', cron: '30 8 * * 1-5' } }),
  srow(2, 'daily-stock-check', 'Daily stock check', { version: H('1'), revision: 1, description: 'Reads supplier prices every morning and flags changes over 5 %.', schedule: { mode: 'cron', cron: '0 8 * * *' }, needs: ['gmail'], proposed_by_name: 'Karim Benali' }),
  srow(3, 'morning-ticket-triage', 'Morning ticket triage', { version: H('2'), revision: 2, description: 'Sorts overnight support tickets by urgency and drafts a first reply.', schedule: { mode: 'cron', cron: '30 8 * * 1-5' }, needs: ['slack', 'zendesk'], proposed_by_name: 'Sofia Rossi' }),
  srow(4, 'monthly-expenses-report', 'Monthly expenses report', { version: H('7'), revision: 1, description: 'Collects receipts from Gmail and prepares the month’s expense sheet.', schedule: { mode: 'cron', cron: '0 9 1 * *' }, needs: ['gmail'], proposed_by_name: 'Camille Roy' }),
  srow(5, 'invoice-reminder', 'Invoice reminder', { version: H('5'), status: 'proposed', mine: true, reviewed_by_name: null, reviewed_at: null, proposed_by_name: 'Sara M.', proposed_at: ago(26) }),
  srow(6, 'meeting-prep', 'Meeting prep', { version: H('6'), status: 'rejected', mine: true, review_note: 'The prompt contains a customer’s phone number. Remove it and propose again.', proposed_by_name: 'Sara M.' }),
  srow(7, 'weekly-client-digest', 'Weekly client digest', { version: H('8'), status: 'proposed', replaces: 1, schedule: { mode: 'cron', cron: '30 8 * * 1-5' }, reviewed_by_name: null, reviewed_at: null, proposed_by_name: 'Léa Martin', proposed_at: ago(2), note: 'Members asked to know who owns each account.' }),
  srow(8, 'old-newsletter-draft', 'Old newsletter draft', { version: H('9'), status: 'retired', mine: true, proposed_by_name: 'Sara M.' }),
  srow(9, 'competitor-watch', 'Competitor watch', { version: H('3'), status: 'proposed', reviewed_by_name: null, reviewed_at: null, proposed_by_name: 'Camille Roy', proposed_at: ago(26), schedule: { mode: 'webhook' }, needs: ['browser'] }),
]
const promptsOf = { 1: PROMPT_NEW, 2: 'Read the supplier prices.\nFlag changes over 5 %.', 3: 'Sort the tickets by urgency.\nDraft a first reply.', 4: 'Collect the receipts from Gmail.\nPrepare the month’s expense sheet.', 5: PROMPT_INV, 6: 'Prepare my meetings.', 7: PROMPT_NEW + '\nNever reply to a client yourself, ask the account owner.', 8: 'Old.', 9: 'Open the three pricing pages.\nNote any change since yesterday.' }
const task = (id, name, over) => ({ id, name, prompt: 'Do ' + name + '.', schedule: { mode: 'cron', cron: '0 9 * * 1', tz: 'Europe/Paris' }, runsOn: 'local', active: true, approvals: 'ask', notify: [], needs: ['gmail'], history: [], lastRun: null, nextRun: new Date(Date.now() + 86400000).toISOString(), createdAt: ago(300), updatedAt: ago(300), ...over })
const freshTasks = () => [
  task('st-digest', 'Weekly client digest', { prompt: PROMPT_OLD + '\nEdited by me.', schedule: { mode: 'cron', cron: '30 8 * * 1-5', tz: 'Europe/Paris' }, needs: ['gmail', 'slack'], team: { workspaceId: 'W1', id: 1, key: 'weekly-client-digest', version: H('3'), installedAt: ago(100), base: { name: 'Weekly client digest', prompt: PROMPT_OLD, schedule: { mode: 'cron', cron: '30 8 * * 1-5' }, needs: ['gmail', 'slack'] }, contentHash: 'x' } }),
  task('st-expenses', 'Monthly expenses report', { prompt: 'Collect the receipts from Gmail.\nPrepare the month’s expense sheet.', schedule: { mode: 'cron', cron: '0 9 1 * *', tz: 'Europe/Paris' }, team: { workspaceId: 'W1', id: 4, key: 'monthly-expenses-report', version: H('7'), installedAt: ago(100), base: { name: 'Monthly expenses report', prompt: 'Collect the receipts from Gmail.\nPrepare the month’s expense sheet.', schedule: { mode: 'cron', cron: '0 9 1 * *' }, needs: ['gmail'] }, contentHash: 'y' } }),
  task('st-invoice', 'Invoice reminder', { prompt: PROMPT_INV, needs: ['gmail', 'slack'], history: [{ at: ago(30), sessionId: 's1', status: 'fired' }], lastRun: ago(30) }),
  task('st-competitor', 'Competitor watch', { prompt: 'Open the three competitor pricing pages and note any change since yesterday.', schedule: { mode: 'cron', cron: '0 7 * * *', tz: 'Europe/Paris' }, active: false, needs: [] }),
  task('st-launch', 'Launch review', { schedule: { mode: 'once', at: '2026-12-15T09:00', tz: 'Europe/Paris' } }),
]
const fx = {
  role: 'member', lock: null, status: null, rows: freshRows(), tasks: freshTasks(), copies: [], calls: [], blocked: [],
  conn: { ok: true, configured: true, connections: [{ toolkit: 'gmail', accounts: [{ id: 1 }] }, { toolkit: 'slack', accounts: [{ id: 2 }] }] },
  computers: [{ id: '3f2a1c10-0000-4000-8000-000000000001', name: 'Home', isHome: true, state: 'asleep', capabilities: ['ask_approvals'] }],
  hostOld: false, check: undefined, add: undefined, review: undefined, install: undefined, update: undefined, publish: undefined, delay: 0, noRevision: false,
}
const resetWorld = () => { Object.assign(fx, { role: 'member', lock: null, status: null, rows: freshRows(), tasks: freshTasks(), calls: [], blocked: [], check: undefined, add: undefined, review: undefined, install: undefined, update: undefined, publish: undefined, hostOld: false, delay: 0, noRevision: false }); fx.copies = copiesOf(fx.tasks); fx.conn = { ok: true, configured: true, connections: [{ toolkit: 'gmail', accounts: [{ id: 1 }] }, { toolkit: 'slack', accounts: [{ id: 2 }] }] }; fx.computers = [{ id: '3f2a1c10-0000-4000-8000-000000000001', name: 'Home', isHome: true, state: 'asleep', capabilities: ['ask_approvals'] }] }
const copiesOf = (tasks) => tasks.filter((t) => t.team).map((t) => ({ taskId: t.id, workspaceId: t.team.workspaceId, id: t.team.id, key: t.team.key, version: t.team.version, edited: t.id === 'st-digest', missingApps: [] }))
fx.copies = copiesOf(fx.tasks)
const admin = () => fx.role === 'admin' || fx.role === 'owner'
const listFor = (view) => (view === 'approved' ? fx.rows.filter((r) => r.status === 'approved') : (view === 'proposed' ? fx.rows.filter((r) => r.status === 'proposed') : (view === 'mine' ? fx.rows.filter((r) => r.mine) : fx.rows)))
const keyOf = (name) => String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 64).replace(/-+$/, '')
const withoutRevision = (r) => { if (!fx.noRevision) return r; const c = { ...r }; delete c.revision; return c }
const fakeRelay = (method, sub, query, body) => {
  if (fx.lock !== null) return fx.lock
  if (sub === '') {
    const view = query.get('view') || 'approved'
    if (view === 'proposed' && !admin()) return { ok: false, error: 'admin_required' }
    const rows = listFor(view)
    return { ok: true, connected: true, role: fx.role, view, total: rows.length, limit: 200, offset: 0, workspaceName: 'Acme Studio', workspaceId: 'W1', counts: { approved: listFor('approved').length, pending: listFor('proposed').length }, automations: rows.map((r) => ({ ...withoutRevision(r) })) }
  }
  if (sub === '/item') {
    const id = Number(query.get('id'))
    const r = fx.rows.find((x) => x.id === id)
    return r === undefined ? { ok: false, error: 'not_found' } : { ok: true, automation: { ...withoutRevision(r), prompt: promptsOf[id] } }
  }
  if (sub === '/check') return fx.check === undefined ? { ok: true, version: H('c') } : (typeof fx.check === 'function' ? fx.check(body) : fx.check)
  if (sub === '/add') { if (fx.add !== undefined) return typeof fx.add === 'function' ? fx.add(body) : fx.add; const row = srow(50 + fx.rows.length, body.key, body.name, { description: body.description, status: admin() ? 'approved' : 'proposed', mine: true, proposed_by_name: 'Sara M.', proposed_at: new Date().toISOString(), reviewed_by_name: admin() ? 'Sara M.' : null }); fx.rows.push(row); return { ok: true, automation: row } }
  if (sub === '/review') { if (fx.review !== undefined) return typeof fx.review === 'function' ? fx.review(body) : fx.review; const r = fx.rows.find((x) => x.id === body.id); if (r !== undefined) { r.status = body.decision === 'approve' ? 'approved' : 'rejected'; r.review_note = body.note || null; r.reviewed_by_name = 'Julien Petit'; r.reviewed_at = new Date().toISOString() } return { ok: true } }
  if (sub === '/retire') { const r = fx.rows.find((x) => x.id === body.id); if (r !== undefined) r.status = 'retired'; return { ok: true } }
  if (sub === '/delete') { fx.rows = fx.rows.filter((x) => x.id !== body.id); return { ok: true } }
  return undefined
}
const fakeLocal = (sub, body) => {
  if (fx.hostOld) return undefined
  if (sub === 'team-copies') return { ok: true, copies: fx.copies }
  if (sub === 'team-pack') {
    const t = fx.tasks.find((x) => x.id === body.id)
    if (t === undefined) return { ok: false, error: 'not_found' }
    if (t.schedule.mode === 'once') return { ok: false, error: 'once_not_shareable' }
    return { ok: true, proposal: { key: t.team ? t.team.key : keyOf(t.name), name: t.name, description: String(t.prompt).split('\n')[0].slice(0, 200), prompt: t.prompt, schedule: { mode: t.schedule.mode, cron: t.schedule.cron }, needs: t.needs || [], version: H('d') }, team: t.team ? { workspaceId: 'W1', id: t.team.id, key: t.team.key, version: t.team.version, edited: t.id === 'st-digest' } : null }
  }
  if (sub === 'team-install') {
    if (fx.install !== undefined) return typeof fx.install === 'function' ? fx.install(body) : fx.install
    const t = task('st-' + body.definition.key, body.definition.name, { prompt: body.definition.prompt, schedule: { mode: 'cron', cron: body.definition.schedule.cron || '0 9 * * 1', tz: 'Europe/Paris' }, active: body.turnOn === true, approvals: body.approvals, needs: body.definition.needs, team: { workspaceId: body.workspaceId, id: body.definition.id, key: body.definition.key, version: body.definition.version, installedAt: new Date().toISOString(), base: { name: body.definition.name, prompt: body.definition.prompt, schedule: body.definition.schedule, needs: body.definition.needs }, contentHash: 'z' } })
    fx.tasks.push(t); fx.copies = copiesOf(fx.tasks)
    return { ok: true, taskId: t.id, active: body.turnOn === true, missingApps: [] }
  }
  if (sub === 'team-update') {
    if (fx.update !== undefined) return typeof fx.update === 'function' ? fx.update(body) : fx.update
    const t = fx.tasks.find((x) => x.id === body.taskId)
    if (t !== undefined && t.team) { t.team.version = body.definition.version; t.prompt = body.definition.prompt; fx.copies = copiesOf(fx.tasks); fx.copies.forEach((c) => { c.edited = false }) }
    return { ok: true, taskId: body.taskId }
  }
  return undefined
}
const fakeTasks = (body) => {
  if (body.action === 'list') return { ok: true, tasks: fx.tasks }
  if (body.action === 'cloud-link') { const t = fx.tasks.find((x) => x.id === body.id); if (t === undefined) return { ok: false, error: 'task not found' }; if (body.cloud === null) delete t.cloud; else { t.cloud = { computerId: body.cloud.computerId, name: body.cloud.name, at: new Date().toISOString(), wasActive: t.active !== false }; t.active = false } return { ok: true, task: t } }
  return { ok: false, error: 'faked: ' + String(body.action) }
}

// ── the run ──
const live = await openLivePage({ width: 1400, height: 900 }).catch((e) => { console.error('○ not run: ' + e.message); process.exit(3) })
const { page } = live
const pageErrors = []
const val = async (expr, ms) => (await page.evalJs(expr, ms)).val
try {
  await page.send('Runtime.enable', {})
  page.on('Runtime.exceptionThrown', (p) => { pageErrors.push(String((p.exceptionDetails && (p.exceptionDetails.exception ? p.exceptionDetails.exception.description : p.exceptionDetails.text)) || 'exception').slice(0, 300)) })
  const reply = (p, status, text) => page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: status, responseHeaders: [{ name: 'content-type', value: 'application/json' }, { name: 'cache-control', value: 'no-store' }], body: Buffer.from(text).toString('base64') })
  const json = (p, o) => reply(p, 200, JSON.stringify(o))
  const answer = async (p) => {
    const url = new URL(p.request.url)
    const method = p.request.method
    let body = null
    try { body = p.request.postData ? JSON.parse(p.request.postData) : null } catch (e) { body = null }
    const path = url.pathname
    if (path.startsWith('/kybernos-cloud/team/automations')) {
      fx.calls.push({ method, path, query: url.search, body })
      if (fx.delay > 0) await sleep(fx.delay)
      const a = fakeRelay(method, path.slice('/kybernos-cloud/team/automations'.length), url.searchParams, body)
      return a === undefined ? reply(p, 404, '<!doctype html><title>not found</title>') : json(p, a)
    }
    if (path.startsWith('/kybernos/automation/team-')) {
      fx.calls.push({ method, path, query: url.search, body })
      if (fx.delay > 0) await sleep(fx.delay)
      const a = fakeLocal(path.slice('/kybernos/automation/'.length), body || {})
      return a === undefined ? reply(p, 404, '<!doctype html><title>not found</title>') : json(p, a)
    }
    if (path === '/kybernos/tasks' && method === 'POST') { fx.calls.push({ method, path, body }); return json(p, fakeTasks(body || {})) }
    if (path === '/kybernos-cloud/status' && fx.status !== null) return json(p, fx.status)
    if (path === '/kybernos-cloud/server') return json(p, { ok: true, server: { console: 'https://console.example.test/plans' } })
    if (path === '/kybernos-cloud/computers') return json(p, { ok: true, connected: true, computers: fx.computers })
    if (path === '/kybernos-cloud/computers/publish') { fx.calls.push({ method, path, body }); return json(p, fx.publish === undefined ? { ok: true } : fx.publish(body)) }
    if (path.startsWith('/kybernos-cloud/computers/')) return json(p, { ok: true, runs: [], approvals: [], tasks: [] })
    if (path.startsWith('/kybernos/composio/connections')) return json(p, fx.conn)
    if (method !== 'GET' && method !== 'HEAD' && (path.startsWith('/kybernos') || path.startsWith('/kybernos-'))) { fx.blocked.push(method + ' ' + path); return reply(p, 403, JSON.stringify({ ok: false, error: 'blocked by the check' })) }
    return page.send('Fetch.continueRequest', { requestId: p.requestId })
  }
  page.on('Fetch.requestPaused', (p) => { answer(p).catch(() => { page.send('Fetch.continueRequest', { requestId: p.requestId }).catch(() => {}) }) })
  await page.send('Fetch.enable', { patterns: [
    { urlPattern: '*/kybernos-cloud/team/automations*', requestStage: 'Request' },
    { urlPattern: '*/kybernos/automation/team-*', requestStage: 'Request' },
    { urlPattern: '*/kybernos/tasks*', requestStage: 'Request' },
    { urlPattern: '*/kybernos-cloud/status*', requestStage: 'Request' },
    { urlPattern: '*/kybernos-cloud/server*', requestStage: 'Request' },
    { urlPattern: '*/kybernos-cloud/computers*', requestStage: 'Request' },
    { urlPattern: '*/kybernos/composio/connections*', requestStage: 'Request' },
    { urlPattern: '*/kybernos/*', requestStage: 'Request' },
    { urlPattern: '*/kybernos-*', requestStage: 'Request' },
  ] })

  // Rows and sheets fade in: wait for the end of the animation, or the picture shows a half-drawn screen.
  const shot = async (name) => { if (shotsDir !== null) { try { await sleep(650); await page.shot(join(shotsDir, name + '.png')) } catch (e) { /* no screenshot */ } } }
  const scrollTo = (sel) => val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e) e.scrollIntoView({ block: 'center' }); return !!e })()`)
  const text = async (sel) => (await val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.innerText.replace(/\\s+/g, ' ').trim() : '' })()`)) || ''
  const has = async (expr, ms) => (await waitFor(page, expr, ms || 8000)) !== null
  const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`
  const count = async (sel) => (await val(`document.querySelectorAll(${JSON.stringify(sel)}).length`)) || 0
  const clickAt = async (x, y) => { await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }) }
  // The centre of the element, and whether a press THERE lands on it (nothing covers it).
  const spot = (sel, label) => val(`(() => {
    const els = Array.from(document.querySelectorAll(${JSON.stringify(sel)})).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2 })
    const norm = (e) => (e.innerText || e.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim()
    const el = ${label === undefined ? 'els[0]' : `els.find((e) => norm(e).indexOf(${JSON.stringify(label)}) >= 0)`}
    if (!el) return null
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    const top = document.elementFromPoint(x, y)
    return { x, y, disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true', lands: !!top && (el === top || el.contains(top)), cover: top ? (top.tagName + '.' + String(top.className).slice(0, 40)) : null }
  })()`)
  const lastClick = { sel: '', info: null }
  // A real press. Returns false (and says why) when the element is not there, is off, or something covers it.
  const press = async (sel, label) => {
    const r = await spot(sel, label)
    lastClick.sel = sel + (label ? ' « ' + label + ' »' : ''); lastClick.info = r
    if (!r || r.disabled || r.lands !== true) return false
    await clickAt(r.x, r.y)
    await sleep(120)
    return true
  }
  const pressOk = async (sel, label, why) => { const ok = await press(sel, label); check((why || 'press ' + sel + (label ? ' « ' + label + ' »' : '')) + ': the button is there, on, and the press lands on it', ok, lastClick.info); return ok }
  const setValue = (sel, value) => val(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; const set = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set; set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  const lastCall = (path) => [...fx.calls].reverse().find((c) => c.path === path)
  const callsTo = (path) => fx.calls.filter((c) => c.path === path)
  const key = (k) => page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: k === 'Escape' ? 27 : 13 }).then(() => page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: k === 'Escape' ? 27 : 13 }))
  const reload = async () => { await page.send('Page.reload', { ignoreCache: true }); await sleep(1800); await waitFor(page, 'document.body && document.body.innerText.length > 80', 30000) }
  const openAutomations = async () => {
    for (let i = 0; i < 4; i += 1) {
      await clickText(page, 'Automations')
      if (await has(q('[data-kb="page-automations"]') + ' !== null', 6000)) { await has(`document.querySelector('[data-kb="section-yours"]') !== null`, 15000); return true }
    }
    return false
  }
  const sheetOpen = async () => has(q('[data-kb="team-sheet"]') + ' !== null', 8000)
  const sheetText = () => text('[data-kb="team-sheet"]')
  const rowText = (name) => val(`(() => { const r = Array.from(document.querySelectorAll('[data-kb="team-row"]')).find((e) => e.innerText.indexOf(${JSON.stringify(name)}) >= 0); return r ? r.innerText.replace(/\\s+/g, ' ').trim() : '' })()`)
  const rowBtn = (name, btn) => val(`(() => { const r = Array.from(document.querySelectorAll('[data-kb="team-row"]')).find((e) => e.innerText.indexOf(${JSON.stringify(name)}) >= 0); const b = r && r.querySelector('[data-kb=${JSON.stringify(btn)}]'); if (!b) return null; b.scrollIntoView({ block: 'center' }); const rc = b.getBoundingClientRect(); const top = document.elementFromPoint(rc.left + rc.width / 2, rc.top + rc.height / 2); return { x: rc.left + rc.width / 2, y: rc.top + rc.height / 2, disabled: !!b.disabled, lands: !!top && (b === top || b.contains(top)) } })()`)
  const pressRow = async (name, btn) => { const r = await rowBtn(name, btn); lastClick.sel = name + ' ' + btn; lastClick.info = r; const ok = !!r && !r.disabled && r.lands === true; if (ok) { await clickAt(r.x, r.y); await sleep(150) } check('« ' + btn + ' » of « ' + name + ' »: there, on, and the press lands on it', ok, r); return ok }
  const goTeam = async () => { await pressOk('[data-kb="section-team"]', undefined, 'the Team segment'); await has(q('[data-kb="team-automations"]') + ' !== null || ' + q('[data-kb="team-locked"]') + ' !== null', 12000) }
  const goYours = async () => { await press('[data-kb="section-yours"]'); await sleep(300) }
  const setLang = async (lang) => { await val(`localStorage.setItem('kybernos.theme.lang', ${JSON.stringify(lang)}); true`); await reload(); await openAutomations() }

  console.log('Team segment: the real GUI of a sandbox, this checkout\'s client, the Team routes faked')
  resetWorld()
  await reload()
  check('the Automations page opens', await openAutomations())
  await sleep(1500)

  // ── Yours: the marks and the way in ──
  await has(`document.querySelector('[data-kb="section-team"]') !== null`, 15000)
  const seg = await text('[data-kb="automations-sections"]')
  check('the sections are Yours, Discover and Team, with the initial of the team', /Yours/.test(seg) && /Discover/.test(seg) && /A\s*Team/.test(seg), seg)
  await has(`document.querySelectorAll('.kba-rowline:not(.kba-rowline-head)').length >= 4`, 15000)
  const yoursText = await text('.kba-lcard')
  check('Yours: a copy from the team is marked, and what the person proposed says so', /Team copy/.test(yoursText) && /Proposed to Acme Studio/.test(yoursText), yoursText.slice(0, 400))
  check('every row of Yours has the « Propose to team… » action', (await count('[data-kb="action-propose"]')) === 5)
  await shot('01-yours-with-marks')
  // hover a row, then press its action with a real mouse
  const rowSpot = await val(`(() => { const r = Array.from(document.querySelectorAll('.kba-rowline:not(.kba-rowline-head)')).find((e) => e.innerText.indexOf('Invoice reminder') >= 0); const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } })()`)
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rowSpot.x, y: rowSpot.y })
  await sleep(300)
  const actSpot = await val(`(() => { const r = Array.from(document.querySelectorAll('.kba-rowline:not(.kba-rowline-head)')).find((e) => e.innerText.indexOf('Invoice reminder') >= 0); const b = r.querySelector('[data-kb="action-propose"]'); const rc = b.getBoundingClientRect(); const top = document.elementFromPoint(rc.left + rc.width / 2, rc.top + rc.height / 2); return { x: rc.left + rc.width / 2, y: rc.top + rc.height / 2, w: rc.width, lands: b === top || b.contains(top), op: getComputedStyle(b).opacity, left: rc.left, rowRight: r.getBoundingClientRect().right, label: b.getAttribute('aria-label') } })()`)
  check('on hover the action is shown, inside its column, and nothing covers it', actSpot.op === '1' && actSpot.lands === true && actSpot.w >= 28 && actSpot.label === 'Propose “Invoice reminder” to the team', actSpot)
  await shot('01b-yours-row-hover')
  fx.calls.length = 0
  await clickAt(actSpot.x, actSpot.y)
  await sleep(700)
  check('« Propose to team… » on a row opens the Team tab with the Propose sheet on THAT automation', await sheetOpen() && /Propose to Acme Studio/.test(await sheetText()) && await has(`document.querySelector('[data-kb="tp-pick"][data-id="st-invoice"]').getAttribute('aria-checked') === 'true'`, 6000), await sheetText())
  await has(q('[data-kb="tp-check"]') + ' !== null && ' + q('[data-kb="tp-check"]') + '.getAttribute("data-state") === "ok"', 8000)
  const picks = await val(`Array.from(document.querySelectorAll('[data-kb="tp-pick"]')).map((e) => Math.round(e.getBoundingClientRect().height))`)
  check('the list of automations to choose from is drawn: five options, each tall enough to read and press (a list once collapsed to nothing in a sheet)', picks.length === 5 && picks.every((h) => h >= 36), picks)
  await shot('02-propose-from-row')
  await scrollTo('[data-kb="tp-check"]')
  await shot('02b-propose-check')
  await val(`document.querySelector('[data-kb="team-sheet"] .kbta-sbody').scrollTop = 0; true`)
  const pText = await sheetText()
  check('the sheet shows what the team will see, what never travels, the check and the note', /What Acme Studio will see/.test(pText) && /What never travels/.test(pText) && /Check before sending/.test(pText) && /Checked/.test(pText) && /Note for the reviewers/.test(pText), pText.slice(0, 300))
  check('the short description is filled in from the prompt and can be edited', (await val(`document.querySelector('[data-kb="tp-desc"]').value`)).startsWith('Every Monday, look at the invoices'))
  // the secret
  fx.check = { ok: false, error: 'scan_rejected', field: 'prompt', line: 3 }
  await setValue('[data-kb="tp-desc"]', 'Drafts a reminder for each late invoice.')
  await has(q('[data-kb="tp-check"]') + '.getAttribute("data-state") === "found"', 6000)
  const found = await text('[data-kb="tp-check"]')
  check('a secret: the chip, the line, the fix; Send is off', /Secret found/.test(found) && /Line 3 of the prompt/.test(found) && /Nothing was sent/.test(found) && (await val(`document.querySelector('[data-kb="team-sheet-go"]').disabled`)) === true, found)
  await scrollTo('[data-kb="tp-check"]')
  await shot('03-propose-secret')
  fx.check = undefined
  await pressOk('[data-kb="tp-recheck"]', undefined, '« Check again »')
  check('Check again reads the automation once more and the check comes back clean', await has(q('[data-kb="tp-check"]') + '.getAttribute("data-state") === "ok"', 8000))
  // a note of 2001 characters
  await setValue('[data-kb="tp-note"]', 'n'.repeat(2001))
  await sleep(200)
  check('a note over 2 000 characters turns the count red, keeps the text and turns Send off, with the reason', (await val(`document.querySelector('[data-kb="tp-note"]').value.length`)) === 2001 && /2000/.test(await text('[data-kb="tp-check"]')) && (await val(`document.querySelector('[data-kb="team-sheet-go"]').disabled`)) === true)
  await shot('03b-propose-note-too-long')
  await setValue('[data-kb="tp-note"]', 'It saves an hour a week.')
  await has(q('[data-kb="tp-check"]') + '.getAttribute("data-state") === "ok"', 8000)
  // a refusal at the send
  fx.add = { ok: false, error: 'too_many_proposals' }
  await pressOk('[data-kb="team-sheet-go"]', undefined, 'Send for review (refused by the server)')
  await sleep(400)
  check('a refusal of the server is said, and the button works again (not stuck on « Sending… »)', /maximum number of proposals/.test(await text('[data-kb="tp-error"]')) && /Send for review/.test(await text('[data-kb="team-sheet-go"]')) && (await val(`document.querySelector('[data-kb="team-sheet-go"]').disabled`)) === false)
  await shot('04-propose-refused')
  fx.add = undefined
  fx.calls.length = 0
  await pressOk('[data-kb="team-sheet-go"]', undefined, 'Send for review')
  await sleep(600)
  const added = lastCall('/kybernos-cloud/team/automations/add')
  check('Send posts the trimmed definition, the description and the note to the relay', added && added.body.key === 'invoice-reminder' && added.body.note === 'It saves an hour a week.' && added.body.description === 'Drafts a reminder for each late invoice.' && !('id' in added.body) && !('version' in added.body), added)
  check('Sent: what happened and where to find it', /Sent for review/.test(await sheetText()) && /Waiting for review/.test(await sheetText()) && /See it under Mine/.test(await sheetText()), await sheetText())
  await shot('05-propose-sent')
  await pressOk('[data-kb="team-sheet-go"]', undefined, '« See it under Mine »')
  check('« See it under Mine » closes the sheet and shows Mine', !(await has(q('[data-kb="team-sheet"]') + ' !== null', 800)) && (await val(`document.querySelector('[data-kb="team-table"]').getAttribute('data-view')`)) === 'mine')
  await shot('06-mine')
  const mineText = await text('[data-kb="team-table"]')
  check('Mine: waiting, refused with the reviewer\'s words, retired; and the actions that exist', /Waiting for review/.test(mineText) && /Julien Petit: “The prompt contains a customer’s phone number/.test(mineText) && /Retired/.test(mineText) && /Withdraw/.test(mineText) && /Propose again/.test(mineText), mineText.slice(0, 500))
  check('a member cannot delete what is retired (no button on that row)', (await val(`(() => { const r = Array.from(document.querySelectorAll('[data-kb="team-row"]')).find((e) => e.innerText.indexOf('Old newsletter draft') >= 0); return r.querySelectorAll('button').length })()`)) === 0)
  fx.calls.length = 0
  await pressRow('Meeting prep', 'team-again')
  check('Propose again opens the sheet; the automation of that name is gone from Yours, and the sheet says so', await sheetOpen() && /no longer in Yours/.test(await sheetText()), await sheetText())
  await pressOk('[data-kb="team-sheet-cancel"]', undefined, 'Cancel')
  check('Cancel closes the sheet', !(await has(q('[data-kb="team-sheet"]') + ' !== null', 800)))
  await pressRow('Invoice reminder', 'team-withdraw')
  await sleep(500)
  check('Withdraw deletes only that proposal and says so', callsTo('/kybernos-cloud/team/automations/delete').length === 1 && /Proposal withdrawn/.test(await text('.kba-toast')), callsTo('/kybernos-cloud/team/automations/delete'))

  // ── the approved list ──
  await press('[data-kb="team-filter-approved"]')
  await sleep(500)
  const hint = await text('[data-kb="team-hint"]')
  check('Approved: the head names the team and the person\'s role; a member has no « To review »', /Shared by the members of Acme Studio/.test(hint) && (await count('[data-kb="team-filter-review"]')) === 0, hint)
  const rows = await val(`Array.from(document.querySelectorAll('[data-kb="team-row"]')).map((e) => e.innerText.replace(/\\s+/g, ' ').trim())`)
  check('four approved automations with their buttons: Update, Install, Install, Installed', rows.length === 4 && /Update to v4/.test(rows[0]) && /Install/.test(rows[1]) && /Install/.test(rows[2]) && /Installed/.test(rows[3]), rows)
  check('an app that is not connected is said on its chip', /Zendesk · not connected/.test(rows[2]) && !/Slack · not connected/.test(rows[2]), rows[2])
  check('the version cell says what the person has', /v4 · you have #3333333/.test(rows[0]), rows[0])
  await shot('07-team-approved')
  // alignment: every cell of a column starts at the same x as its header
  const align = await val(`(() => { const head = document.querySelector('.kbta-table .kba-rowline-head .kbta-cols'); const cols = Array.from(head.children).map((c) => Math.round(c.getBoundingClientRect().left)); const bad = []; for (const row of document.querySelectorAll('[data-kb="team-row"] .kbta-cols')) { Array.from(row.children).forEach((c, i) => { if (Math.abs(Math.round(c.getBoundingClientRect().left) - cols[i]) > 1) bad.push(i) }) } return { cols, bad } })()`)
  check('every cell sits under its header (one grid)', align.bad.length === 0, align)
  const over = await val(`(() => { const t = document.querySelector('.kbta-table'); return t.scrollWidth <= t.clientWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1 })()`)
  check('nothing overflows sideways', over === true)
  // search
  await setValue('[data-kb="team-search"]', 'zendesk')
  await sleep(250)
  check('search narrows the table', (await count('[data-kb="team-row"]')) === 1 && /Morning ticket triage/.test(await rowText('Morning')))
  await setValue('[data-kb="team-search"]', 'zzzzz')
  await sleep(250)
  check('search with no match says so (it is not an empty team)', /No automation matches/.test(await text('[data-kb="team-empty"]')) && (await count('[data-kb="team-empty-propose"]')) === 0)
  await shot('07b-no-match')
  await setValue('[data-kb="team-search"]', '')

  // ── Install ──
  fx.calls.length = 0
  await pressRow('Daily stock check', 'team-install')
  check('Install opens the sheet', await sheetOpen() && /Install “Daily stock check”/.test(await sheetText()))
  await has(q('[data-kb="ti-what"]') + ' !== null', 8000)
  await sleep(300)
  const iText = await sheetText()
  check('the sheet: who proposed and approved, what it does, the copy, where, how it asks, the switch', /v1 · proposed by Karim Benali · approved by Julien Petit/.test(iText) && /Reads supplier prices/.test(iText) && /Every day, 08:00/.test(iText) && /in your time zone/.test(iText) && /Where it runs/.test(iText) && /When it asks to act/.test(iText) && /Turn it on after installing/.test(iText) && /Ask me first/.test(iText), iText.slice(0, 500))
  await shot('08-install-local')
  // the keyboard: the focus starts in the sheet, Tab and Shift+Tab stay in it (a person who cannot use a mouse must not fall onto the page behind the shade)
  const tab = (shift) => page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: shift ? 8 : 0 }).then(() => page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: shift ? 8 : 0 }))
  const inSheet = () => val(`!!document.activeElement && document.querySelector('[data-kb="team-sheet"]').contains(document.activeElement)`)
  check('the sheet takes the focus when it opens', await inSheet())
  let stayed = true
  const seen = new Set()
  for (let i = 0; i < 30 && stayed; i += 1) { await tab(false); await sleep(30); stayed = await inSheet(); seen.add(await val(`(document.activeElement.getAttribute('data-kb') || document.activeElement.tagName)`)) }
  check('Tab, 30 presses (more than the buttons of the sheet), never leaves the sheet and reaches its buttons', stayed && seen.size >= 5, [...seen])
  let back = true
  for (let i = 0; i < 8 && back; i += 1) { await tab(true); await sleep(30); back = await inSheet() }
  check('Shift+Tab never leaves it either', back)
  await val(`document.querySelector('[data-kb="team-sheet"]').focus(); true`)
  await pressOk('[data-kb="ti-where-cloud"]', undefined, '« Cloud computer · Home »')
  check('the cloud computer is on offer, and says how it runs', /Home is asleep/.test(await text('[data-kb="ti-where-hint"]')))
  await shot('09-install-cloud')
  await pressOk('[data-kb="ti-allow"]', undefined, '« Always allow »')
  await pressOk('[data-kb="ti-ask"]', undefined, '« Ask me first »')
  await pressOk('[data-kb="ti-turnon"]', undefined, 'the switch')
  check('the switch turns on and the button says what it will do', (await val(`document.querySelector('[data-kb="ti-turnon"]').getAttribute('aria-checked')`)) === 'true' && /Install and turn on/.test(await text('[data-kb="team-sheet-go"]')))
  fx.install = { ok: false, error: 'version_mismatch' }
  await pressOk('[data-kb="team-sheet-go"]', undefined, 'Install (refused by the host)')
  await sleep(400)
  check('a refusal of the host is said, nothing was installed, and the sheet works again', /does not match the approved version/.test(await text('[data-kb="ti-fail"]')) && (await val(`document.querySelector('[data-kb="team-sheet-go"]').disabled`)) === false && (await val(`document.querySelector('[data-kb="team-sheet-close"]').disabled`)) === false)
  await shot('10-install-refused')
  fx.install = { ok: false, error: 'frequent schedule', everyMinutes: 1 }
  await pressOk('[data-kb="team-sheet-go"]', undefined, 'Install (every minute)')
  await sleep(300)
  check('an every-minute rhythm is a question: nothing is confirmed on its own', (await count('[data-kb="ti-frequent"]')) === 1 && lastCall('/kybernos/automation/team-install').body.confirmFrequent === undefined)
  await scrollTo('[data-kb="ti-frequent"]')
  await shot('10b-install-frequent')
  fx.install = undefined
  fx.calls.length = 0
  await pressOk('[data-kb="ti-frequent-yes"]', undefined, '« Install anyway »')
  await sleep(900)
  const instCall = lastCall('/kybernos/automation/team-install')
  check('the yes is sent; on the cloud path the copy is installed PAUSED here', instCall && instCall.body.confirmFrequent === true && instCall.body.turnOn === false && instCall.body.workspaceId === 'W1' && instCall.body.definition.id === 2 && instCall.body.approvals === 'ask', instCall)
  const link = fx.calls.filter((c) => c.path === '/kybernos/tasks' && c.body && c.body.action === 'cloud-link')
  const put = fx.calls.filter((c) => c.path === '/kybernos-cloud/computers/publish')
  check('...then linked to the computer and sent to it with its zone and its switch', link.length === 1 && link[0].body.cloud.name === 'Home' && put.length === 1 && put[0].body.ops[0].task.active === true && put[0].body.ops[0].task.schedule.tz.length > 2, [link, put.map((p) => p.body)])
  check('Done: installed, turned on, where it runs', /Installed and turned on/.test(await sheetText()) && /on your cloud computer/.test(await sheetText()) && /marked as a team copy/.test(await sheetText()), await sheetText())
  await shot('11-install-done')
  await pressOk('[data-kb="team-sheet-go"]', undefined, '« Open in Yours »')
  await sleep(500)
  check('Open in Yours closes the sheet and shows Yours with the new copy marked as a team copy', !(await has(q('[data-kb="team-sheet"]') + ' !== null', 800)) && /Daily stock check/.test(await text('.kba-lcard')) && (await val(`document.querySelector('[data-kb="section-yours"]').classList.contains('on')`)) === true)
  await shot('12-yours-after-install')
  // missing apps
  await goTeam()
  await has(`document.querySelectorAll('[data-kb="team-row"]').length >= 4`, 8000)
  await pressRow('Morning ticket triage', 'team-install')
  await sheetOpen(); await has(q('[data-kb="ti-what"]') + ' !== null', 8000); await sleep(300)
  check('an app that is not connected: said, a button to connect it, the switch is OFF and says why', /It stays paused until Zendesk is connected/.test(await text('[data-kb="ti-missing"]')) && (await val(`document.querySelector('[data-kb="ti-turnon"]').disabled`)) === true && /connect Zendesk first/.test(await text('[data-kb="ti-turnon-hint"]')))
  await shot('13-install-missing-app')
  check('pressing the disabled switch does nothing', !(await press('[data-kb="ti-turnon"]')) && (await val(`document.querySelector('[data-kb="ti-turnon"]').getAttribute('aria-checked')`)) === 'false')
  fx.calls.length = 0
  await pressOk('[data-kb="team-sheet-go"]', undefined, 'Install paused copy')
  await sleep(700)
  check('the host is never asked to turn it on while an app is missing', lastCall('/kybernos/automation/team-install').body.turnOn === false && /Installed, paused/.test(await sheetText()) && /after connecting Zendesk/.test(await sheetText()), lastCall('/kybernos/automation/team-install'))
  await shot('13b-installed-paused')
  await pressOk('[data-kb="team-sheet-go"]', undefined, '« Open in Yours »')
  await sleep(400)

  // ── Update ──
  await goTeam()
  await has(`document.querySelectorAll('[data-kb="team-row"]').length >= 4`, 8000)
  await pressRow('Weekly client digest', 'team-update')
  check('Update opens the sheet', await sheetOpen() && /Update “Weekly client digest”/.test(await sheetText()))
  await has(q('[data-kb="tu-both"]') + ' !== null', 8000); await sleep(300)
  const uText = await sheetText()
  check('an edited copy: the warning, the changes since the version the copy was made from, the three choices', /Edited/.test(uText) && /You changed your copy/.test(uText) && /Changes since #3333333/.test(uText) && (await count('[data-k="del"]')) >= 1 && (await count('[data-k="add"]')) >= 1 && (await count('[data-kb^="tu-"][role="radio"]')) === 3, uText.slice(0, 500))
  check('the choice that loses nothing is the one selected', (await val(`document.querySelector('[data-kb="tu-both"]').getAttribute('aria-checked')`)) === 'true' && /Save mine and update/.test(await text('[data-kb="team-sheet-go"]')))
  await shot('14-update-edited')
  await pressOk('[data-kb="tu-replace"]', undefined, '« Replace with v4 »')
  await pressOk('[data-kb="tu-keep"]', undefined, '« Keep my copy »')
  await pressOk('[data-kb="tu-both"]', undefined, '« Save mine as a separate automation »')
  await pressOk('[data-kb="tu-replace"]', undefined, '« Replace with v4 » again')
  check('the button follows the choice', /Replace with v4/.test(await text('[data-kb="team-sheet-go"]')))
  fx.update = { ok: false, error: 'invalid_automation', reason: 'prompt' }
  await pressOk('[data-kb="team-sheet-go"]', undefined, 'Replace (refused by the host)')
  await sleep(400)
  check('a refusal is said and the sheet works again', /prompt must be 1 to 8,000/.test(await text('[data-kb="tu-fail"]')) && (await val(`document.querySelector('[data-kb="team-sheet-go"]').disabled`)) === false)
  fx.update = undefined
  fx.calls.length = 0
  await pressOk('[data-kb="tu-both"]', undefined, '« Save mine… » again')
  await pressOk('[data-kb="team-sheet-go"]', undefined, 'Save mine and update')
  await sleep(700)
  const upd = lastCall('/kybernos/automation/team-update')
  check('Save mine and update asks the host for « both » on that copy, then says where the copy went', upd && upd.body.mode === 'both' && upd.body.taskId === 'st-digest' && upd.body.definition.version === H('4') && /Weekly client digest \(mine\)/.test(await text('.kba-toast')), [upd, await text('.kba-toast')])
  check('the sheet is closed and the row now says Installed', !(await has(q('[data-kb="team-sheet"]') + ' !== null', 800)) && /Installed/.test(await rowText('Weekly client digest')), await rowText('Weekly client digest'))
  // an untouched copy
  fx.tasks = freshTasks(); fx.copies = copiesOf(fx.tasks); fx.copies.forEach((c) => { c.edited = false })
  await goYours(); await goTeam()
  await has(`document.querySelectorAll('[data-kb="team-row"]').length >= 4`, 8000)
  await pressRow('Weekly client digest', 'team-update')
  await sheetOpen(); await has(q('[data-kb="tu-clean"]') + ' !== null', 8000); await sleep(300)
  check('an untouched copy has nothing to choose: one sentence, « Update to v4 »', /You have not changed your copy/.test(await text('[data-kb="tu-clean"]')) && /Update to v4/.test(await text('[data-kb="team-sheet-go"]')) && (await count('[data-kb="tu-keep"]')) === 0)
  await shot('15-update-clean')
  await key('Escape'); await sleep(300)
  check('Escape closes the sheet', !(await has(q('[data-kb="team-sheet"]') + ' !== null', 800)))
  check('...and the focus goes back to the button that opened it', (await val(`document.activeElement && document.activeElement.getAttribute('data-kb')`)) === 'team-update', await val(`document.activeElement && document.activeElement.tagName + ' ' + document.activeElement.getAttribute('data-kb')`))
  fx.tasks = freshTasks(); fx.copies = copiesOf(fx.tasks)

  // ── a computer that cannot ask: the cloud is off, with the reason ──
  fx.computers = [{ id: '3f2a1c10-0000-4000-8000-000000000001', name: 'Home', isHome: true, state: 'awake', capabilities: [] }]
  // the page reads the cloud computers every 10 s: read them now
  await reload(); await openAutomations(); await goTeam()
  await has(`document.querySelectorAll('[data-kb="team-row"]').length >= 4`, 8000)
  await pressRow('Daily stock check', 'team-install')
  await sheetOpen(); await has(q('[data-kb="ti-what"]') + ' !== null', 8000); await sleep(300)
  check('a cloud computer that cannot ask before acting: the cloud is off, with the page\'s own reason', (await val(`document.querySelector('[data-kb="ti-where-cloud"]').disabled`)) === true && /before acting|can ask/.test(await text('[data-kb="ti-where-hint"]')), await text('[data-kb="ti-where-hint"]'))
  await shot('16-install-cloud-off')
  await key('Escape'); await sleep(300)
  fx.computers = [{ id: '3f2a1c10-0000-4000-8000-000000000001', name: 'Home', isHome: true, state: 'asleep', capabilities: ['ask_approvals'] }]

  // ── the old host ──
  fx.hostOld = true
  await reload(); await openAutomations(); await goTeam()
  await has(`document.querySelectorAll('[data-kb="team-row"]').length >= 4`, 8000)
  check('a DSH that has not loaded the host half: the buttons are off and a note says restart', (await val(`document.querySelector('[data-kb="team-row"] [data-kb="team-install"]').disabled`)) === true && /Restart it to propose or install/.test(await text('[data-kb="team-host-old"]')))
  await shot('17-host-old')
  fx.hostOld = false

  // ── admin ──
  fx.role = 'admin'
  fx.tasks = freshTasks(); fx.copies = copiesOf(fx.tasks)
  await goYours(); await sleep(200)
  await reload(); await openAutomations(); await has(`document.querySelector('[data-kb="team-pending"]') !== null`, 15000)
  check('an admin sees the count of proposals waiting on the segment', /A\s*Team\s*3/.test(await text('[data-kb="automations-sections"]')), await text('[data-kb="automations-sections"]'))
  await goTeam()
  await has(`document.querySelectorAll('[data-kb="team-row"]').length >= 4`, 8000)
  check('an admin has « To review 3 », « Add one of yours », and Retire on approved rows', /To review\s*3/.test(await text('.kbta-bar')) && /Add one of yours/.test(await text('.kbta-head')) && (await count('[data-kb="team-retire"]')) === 4)
  await shot('18-admin-approved')
  await pressOk('[data-kb="team-filter-review"]', undefined, '« To review »')
  await sleep(500)
  const qText = await text('[data-kb="team-table"]')
  check('the queue: both kinds, who, what it needs, when', /Weekly client digest/.test(qText) && /Update · v4 → #8888888/.test(qText) && /Competitor watch/.test(qText) && /New automation/.test(qText) && (await count('[data-kb="team-review"]')) === 3, qText)
  await shot('19-admin-queue')
  await pressRow('Weekly client digest', 'team-review')
  check('Review opens the sheet', await sheetOpen() && /Review: Weekly client digest/.test(await sheetText()))
  await has(q('[data-kb="tr-prompt"]') + ' !== null', 8000); await sleep(300)
  const rText = await sheetText()
  check('Details: who proposed and when, the apps, the prompt, the note, the check, what members get, the decision', /Proposed by Léa Martin/.test(rText) && /Update · v4 → #8888888/.test(rText) && /Members asked to know who owns each account/.test(rText) && /What members get/.test(rText) && /Your decision/.test(rText) && /Members who installed v4 are offered the update/.test(rText), rText.slice(0, 600))
  await shot('20-review-details')
  await pressOk('[data-kb="tr-tab-changes"]', undefined, '« Changes since v4 »')
  await sleep(300)
  check('Changes since v4: the added line is drawn as added', (await count('[data-k="add"]')) >= 1 && /When, needs and checks are the same as v4/.test(await sheetText()))
  await shot('21-review-changes')
  await pressOk('[data-kb="tr-refuse"]', undefined, '« Refuse »')
  check('Refuse asks for the reason and the button is off until there is one', (await count('[data-kb="tr-reason"]')) === 1 && (await val(`document.querySelector('[data-kb="team-sheet-go"]').disabled`)) === true && /Write the reason to be able to refuse/.test(await text('[data-kb="team-sheet-note"]')))
  await shot('22-review-refuse')
  await setValue('[data-kb="tr-reason"]', 'The prompt must say which clients.')
  fx.review = { ok: false, error: 'admin_required' }
  await pressOk('[data-kb="team-sheet-go"]', undefined, 'Refuse and send the reason (refused by the server)')
  await sleep(400)
  check('a refusal of the server never leaves the sheet stuck', /Only an owner or admin can do that/.test(await text('[data-kb="tr-fail"]')) && (await val(`document.querySelector('[data-kb="team-sheet-go"]').disabled`)) === false && /Refuse and send the reason/.test(await text('[data-kb="team-sheet-go"]')))
  await shot('23-review-refused-by-server')
  fx.review = undefined
  fx.calls.length = 0
  await pressOk('[data-kb="team-sheet-go"]', undefined, 'Refuse and send the reason')
  await sleep(600)
  const rev = lastCall('/kybernos-cloud/team/automations/review')
  check('the refusal goes with its reason as « reject »; the sheet closes and says so', rev && rev.body.id === 7 && rev.body.decision === 'reject' && rev.body.note === 'The prompt must say which clients.' && !(await has(q('[data-kb="team-sheet"]') + ' !== null', 800)) && /refused/.test(await text('.kba-toast')), [rev, await text('.kba-toast')])
  await pressRow('Competitor watch', 'team-review')
  await sheetOpen(); await has(q('[data-kb="tr-prompt"]') + ' !== null', 8000); await sleep(300)
  check('a new automation has no tab of changes, and the webhook is a kind (no address)', (await count('[data-kb="tr-tab-changes"]')) === 0 && /External webhook/.test(await sheetText()))
  await shot('24-review-new')
  fx.calls.length = 0
  await pressOk('[data-kb="team-sheet-go"]', undefined, 'Approve')
  await sleep(600)
  check('Approve sends the id and the decision only', lastCall('/kybernos-cloud/team/automations/review') && JSON.stringify(lastCall('/kybernos-cloud/team/automations/review').body) === '{"id":9,"decision":"approve"}' && /approved/.test(await text('.kba-toast')))
  // retire
  await press('[data-kb="team-filter-approved"]'); await sleep(500)
  await pressRow('Daily stock check', 'team-retire')
  check('Retire asks first, and says that members keep their copy', await has(`document.body.innerText.indexOf('Members who installed it keep their copy') >= 0`, 4000))
  await shot('25-retire-confirm')
  await key('Escape'); await sleep(300)
  check('Escape closes the confirmation without retiring', callsTo('/kybernos-cloud/team/automations/retire').length === 0)
  // the admin adds, and does not propose
  await pressOk('[data-kb="team-propose"]', undefined, '« Add one of yours »')
  await sheetOpen()
  check('an owner or an admin ADDS: the title, the sub and the button say it is available right away', /Add to Acme Studio/.test(await sheetText()) && /available to every member right away/.test(await sheetText()) && /Add to the team/.test(await text('[data-kb="team-sheet-go"]')))
  await pressOk('[data-kb="tp-pick"]', 'Competitor watch', '« Competitor watch »')
  await has(q('[data-kb="tp-check"]') + '.getAttribute("data-state") === "ok"', 8000)
  await shot('26-admin-add')
  await pressOk('[data-kb="team-sheet-close"]', undefined, 'the cross')
  check('the cross closes the sheet', !(await has(q('[data-kb="team-sheet"]') + ' !== null', 800)))
  // empty states
  fx.rows = fx.rows.filter((r) => r.status !== 'proposed')
  await goYours(); await goTeam(); await pressOk('[data-kb="team-filter-review"]', undefined, '« To review »'); await sleep(500)
  check('nothing to review says so', /Nothing waiting for review/.test(await text('[data-kb="team-empty"]')))
  await shot('27-empty-review')
  fx.rows = []
  await goYours(); await goTeam(); await sleep(500)
  check('an empty team says so and offers to propose', /Nothing shared yet/.test(await text('[data-kb="team-empty"]')) && (await count('[data-kb="team-empty-propose"]')) === 1)
  await shot('28-empty-approved')
  await pressOk('[data-kb="team-empty-propose"]', undefined, 'the button of the empty state')
  check('...and that button opens the sheet', await sheetOpen())
  await key('Escape'); await sleep(300)
  // a list that fails
  fx.rows = freshRows(); fx.role = 'member'
  fx.lock = { ok: false, error: 'network' }
  await goYours(); await goTeam(); await sleep(600)
  check('offline: the tab says the server could not be reached, with a way to try again', /could not be reached/.test(await text('[data-kb="team-locked"]')) && (await count('[data-kb="team-lock-retry"]')) === 1)
  await shot('29-lock-net')
  fx.lock = null
  await pressOk('[data-kb="team-lock-retry"]', undefined, '« Try again »')
  check('Try again brings the tab back when the server answers', await has(q('[data-kb="team-automations"]') + ' !== null', 8000))

  // ── the five locks, and the others ──
  const spaceStatus = (personal, planKey) => ({ ok: true, connected: true, state: { active_workspace_id: personal ? 'W0' : 'W1', workspaces: [{ id: 'W0', name: 'Perso', personal: true }, { id: 'W1', name: 'Acme Studio', personal: false }], ...(planKey ? { space_plan: { workspace_id: personal ? 'W0' : 'W1', key: planKey } } : {}) } })
  const locks = [
    ['plan_required', { ok: false, error: 'plan_required' }, spaceStatus(false, 'plus'), 'plan', /Team automations come with the Team plan/, '30-lock-plan'],
    ['signed out', { ok: false, connected: false, error: 'non connecte' }, { ok: true, connected: false }, 'signin', /Sign in to see your team’s automations/, '31-lock-signin'],
    ['personal space', { ok: false, error: 'plan_required' }, spaceStatus(true, null), 'personal', /Team automations are for team spaces/, '32-lock-personal'],
    ['not on this server', { ok: false, error: 'not_on_this_server' }, spaceStatus(false, null), 'server', /Not available on this server/, '33-lock-server'],
    ['session over', { ok: false, error: 'reconnect_required' }, spaceStatus(false, null), 'reconnect', /Your Kybernos session has expired/, '34-lock-reconnect'],
    ['something else', { ok: false, error: 'conflict' }, spaceStatus(false, null), 'other', /Team automations are not answering/, '35-lock-other'],
  ]
  for (const [label, lock, status, kind, want, name] of locks) {
    fx.lock = lock; fx.status = status
    await goYours(); await sleep(200); await goTeam(); await sleep(700)
    const t = await text('[data-kb="team-locked"]')
    check('lock « ' + label + ' »: the screen, its sentence, a way out', (await val(`document.querySelector('[data-kb="team-locked"]').getAttribute('data-lock')`)) === kind && want.test(t), [kind, t])
    if (kind === 'plan') check('...it says the plan of the space when the account state knows it, and links to the page of the plans in a new tab', /Your plan is Plus\./.test(t) && (await val(`document.querySelector('[data-kb="team-lock-plans"]').getAttribute('href')`)) === 'https://console.example.test/plans' && (await val(`document.querySelector('[data-kb="team-lock-plans"]').getAttribute('target')`)) === '_blank', t)
    await shot(name)
    const btn = await val(`Array.from(document.querySelectorAll('[data-kb="team-locked"] .kbta-lock-acts > *')).map((b) => b.innerText.trim())`)
    check('...its buttons are there, and a press on each lands on it', btn.length >= 1 && (await Promise.all(btn.map((b, i) => spot('[data-kb="team-locked"] .kbta-lock-acts > *', b)))).every((s) => s && s.lands === true), btn)
  }
  check('the segment shows a lock when the tab is locked', await has(`document.querySelector('[data-kb="section-team"] .kbta-lockico') !== null`, 4000))
  fx.lock = null; fx.status = null

  // ── contrast, in the dark and in the light theme ──
  console.log('Contrast, in the dark and in the light theme')
  const contrastJs = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '.claude', 'skills', 'ux-bug-hunter', 'contrast.js'), 'utf8')
  const audit = async (label) => {
    const r = (await page.evalJs(contrastJs, 20000)).val || { bad: [{ text: 'the probe did not answer' }], scanned: 0 }
    const ours = r.bad.filter((b) => b.where === undefined || /kbta|kba-|kbwr|kb-task|kb8|kb6/.test(b.where))
    check('contrast, ' + label + ': no text of the Team tab or its sheets under AA (' + r.scanned + ' texts read, worst ' + r.worst + ')', ours.length === 0, ours.slice(0, 6))
  }
  const setTheme = async (mode) => { await val(`window.dispatchEvent(new CustomEvent('kybernos:menu:theme', { detail: { to: ${JSON.stringify(mode)} } })); true`); await sleep(1500); await reload(); await openAutomations() }
  const auditScreens = async (mode) => {
    fx.role = 'member'; fx.tasks = freshTasks(); fx.copies = copiesOf(fx.tasks); fx.rows = freshRows(); fx.check = undefined
    await goYours(); await goTeam(); await has(`document.querySelectorAll('[data-kb="team-row"]').length >= 4`, 10000); await sleep(700)
    await audit(mode + ': Approved')
    await shot('50-' + mode + '-approved')
    await pressRow('Daily stock check', 'team-install'); await sheetOpen(); await has(q('[data-kb="ti-what"]') + ' !== null', 8000); await sleep(500)
    await audit(mode + ': Install sheet'); await shot('51-' + mode + '-install')
    await key('Escape'); await sleep(300)
    await pressRow('Morning ticket triage', 'team-install'); await sheetOpen(); await has(q('[data-kb="ti-what"]') + ' !== null', 8000); await sleep(500)
    await audit(mode + ': Install sheet, an app missing'); await shot('52-' + mode + '-install-missing')
    await key('Escape'); await sleep(300)
    await pressRow('Weekly client digest', 'team-update'); await sheetOpen(); await has(q('[data-kb="tu-both"]') + ' !== null', 8000); await sleep(500)
    await audit(mode + ': Update sheet'); await shot('53-' + mode + '-update')
    await key('Escape'); await sleep(300)
    fx.check = { ok: false, error: 'scan_rejected', field: 'prompt', line: 3 }
    await pressOk('[data-kb="team-propose"]', undefined, '« Propose one of yours »'); await sheetOpen(); await sleep(300)
    await pressOk('[data-kb="tp-pick"]', 'Invoice reminder'); await has(q('[data-kb="tp-check"]') + '.getAttribute("data-state") === "found"', 8000); await scrollTo('[data-kb="tp-check"]'); await sleep(400)
    await audit(mode + ': Propose sheet, a secret found'); await shot('54-' + mode + '-propose-secret')
    await key('Escape'); await sleep(300)
    fx.check = undefined
    await press('[data-kb="team-filter-mine"]'); await sleep(700)
    await audit(mode + ': Mine'); await shot('55-' + mode + '-mine')
    fx.role = 'admin'
    await goYours(); await reload(); await openAutomations(); await goTeam(); await has(`document.querySelectorAll('[data-kb="team-row"]').length >= 4`, 10000)
    await press('[data-kb="team-filter-review"]'); await sleep(700)
    await audit(mode + ': the queue'); await shot('56-' + mode + '-queue')
    await pressRow('Weekly client digest', 'team-review'); await sheetOpen(); await has(q('[data-kb="tr-prompt"]') + ' !== null', 8000); await sleep(400)
    await audit(mode + ': Review sheet'); await shot('57-' + mode + '-review')
    await key('Escape'); await sleep(300)
    fx.role = 'member'; fx.lock = { ok: false, error: 'not_on_this_server' }
    await goYours(); await reload(); await openAutomations(); await goTeam(); await sleep(700)
    await audit(mode + ': a lock'); await shot('58-' + mode + '-lock')
    fx.lock = null
  }
  try {
    await auditScreens('dark')
    await setTheme('light')
    check('the light theme is on', (await val(`!document.body.hasAttribute('data-ds-dark-theme')`)) === true)
    await auditScreens('light')
  } finally { await setTheme('dark') }

  // ── French ──
  console.log('French, and the narrow windows')
  await setLang('kybernos')
  await goTeam(); await has(`document.querySelectorAll('[data-kb="team-row"]').length >= 4`, 10000)
  const fr = await text('[data-kb="team-automations"]')
  check('French: the tab speaks French', /Équipe|Approuvées/.test(await text('[data-kb="automations-sections"]') + fr) && /Les automatisations que ton équipe a approuvées/.test(fr) && /Installer|Mettre à jour/.test(fr), fr.slice(0, 300))
  await shot('36-fr-approved')
  await pressRow('Daily stock check', 'team-install'); await sheetOpen(); await has(q('[data-kb="ti-what"]') + ' !== null', 8000); await sleep(300)
  check('French: the install sheet', /Installer « Daily stock check »/.test(await sheetText()) && /Où elle tourne/.test(await sheetText()) && /Me demander d’abord/.test(await sheetText()), await sheetText())
  await shot('37-fr-install')
  await key('Escape'); await sleep(300)
  await pressRow('Weekly client digest', 'team-update'); await sheetOpen(); await has(q('[data-kb="tu-both"]') + ' !== null', 8000); await sleep(300)
  await shot('38-fr-update')
  await key('Escape'); await sleep(300)
  await pressOk('[data-kb="team-propose"]', undefined, '« Proposer l’une des tiennes »')
  await sheetOpen(); await sleep(300)
  await pressOk('[data-kb="tp-pick"]', 'Invoice reminder'); await has(q('[data-kb="tp-check"]') + '.getAttribute("data-state") === "ok"', 8000)
  await shot('39-fr-propose')
  check('French: the propose sheet', /Proposer à Acme Studio/.test(await sheetText()) && /Ce que Acme Studio verra/.test(await sheetText()) && /Ce qui ne part jamais/.test(await sheetText()), (await sheetText()).slice(0, 300))
  await key('Escape'); await sleep(300)
  // narrow
  await page.send('Emulation.setDeviceMetricsOverride', { width: 700, height: 900, deviceScaleFactor: 1, mobile: false })
  await sleep(600)
  await shot('40-fr-700px')
  const o700 = await val(`document.documentElement.scrollWidth <= window.innerWidth + 1 && !!document.querySelector('.kbta-table') && document.querySelector('.kbta-table').scrollWidth <= document.querySelector('.kbta-table').clientWidth + 1`)
  check('at 700 px the table stacks and nothing scrolls sideways', o700 === true)
  await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false })
  await sleep(600)
  await shot('41-fr-390px')
  const o390 = await val(`document.documentElement.scrollWidth <= window.innerWidth + 1`)
  check('at 390 px nothing scrolls sideways', o390 === true)
  await pressRow('Daily stock check', 'team-install'); await sheetOpen(); await has(q('[data-kb="ti-what"]') + ' !== null', 8000); await sleep(400)
  const sheetBox = await val(`(() => { const s = document.querySelector('[data-kb="team-sheet"]').getBoundingClientRect(); return { w: Math.round(s.width), left: Math.round(s.left), vw: window.innerWidth } })()`)
  check('at 390 px the sheet takes the width of the phone (less the 16 px gutter the engine keeps for every dialog)', sheetBox.w >= sheetBox.vw - 18 && sheetBox.left <= 17, sheetBox)
  await shot('42-fr-390px-sheet')
  await key('Escape'); await sleep(300)
  await page.send('Emulation.clearDeviceMetricsOverride', {})
  await val(`localStorage.removeItem('kybernos.theme.lang'); true`)
  await reload(); await openAutomations()

  // ── a version without a number: the hash stands in ──
  fx.noRevision = true
  await goTeam(); await has(`document.querySelectorAll('[data-kb="team-row"]').length >= 4`, 10000)
  const nr = await rowText('Daily stock check')
  check('the contract carries no version number: without one the page shows the first characters of the hash, never « vundefined »', /#1111111/.test(nr) && !/undefined|NaN/.test(nr), nr)
  await shot('43-no-revision')
  fx.noRevision = false

  // The shell and the other plugins send their own beacons and decisions in the background (the hub, the theme, the sessions, the art): refused here too, and none of them is ours.
  const ours = fx.blocked.filter((b) => /automation|team|\/kybernos\/tasks|computers|composio/.test(b))
  check('nothing was written: every request of the page that was not a GET went to a route the check answers itself (the ' + fx.blocked.length + ' background posts of the shell were refused, none of them to the automations, the team or the computers)', ours.length === 0, ours)
  check('no script error was thrown by the page during the run', pageErrors.length === 0, pageErrors)
} finally {
  await live.close()
}
console.log('\n' + pass + ' checks passed' + (failures.length > 0 ? ', ' + failures.length + ' FAILED' : ''))
process.exit(failures.length > 0 ? 1 : 0)
