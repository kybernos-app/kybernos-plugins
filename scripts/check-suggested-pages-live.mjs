// What Kaby suggests, on the pages it belongs to, on a real GUI: a memory, a section of the custom instructions, a dashboard, and the « Learn my business » automation.
// SANDBOX ONLY (`source scripts/sandbox/env.sh`): it writes to the sandbox's own DSH home (the suggestions ledger, one dashboard, one automation, the AGENTS.md of the
// sandbox) and removes what it made; the user's own `dsh web` is never the target (exit 3).
//
// Plays: Memory shows the dashed block (Add waits for an account and says so; Discard resolves the ledger); Settings › Kybernos shows the instructions block and Add appends
// it under a heading and the date through the ordinary Save; Dashboards shows its dashed block, the menu row pulses with the count, Add moves it into the list, Discard
// removes it; the Learn recipe is created once, switched on, weekly, and found again.
//
// Named check-* on purpose: it needs a running sandbox and Chrome, so CI must not run it.
//   source scripts/sandbox/env.sh && node scripts/check-suggested-pages-live.mjs     (KB_SHOT_DIR=/some/dir keeps screenshots)
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import * as fsp from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLivePage, clickText, goToSettingsPage, openSettings, waitFor } from './live-page.mjs'
import { createHost } from '../packages/kybernos-dashboards/dashboard-host.mjs'

const authority = process.env.KB_HOST || '127.0.0.1:3080'
const home = process.env.DSH_HOME || ''
if (authority === '127.0.0.1:3080' || home === '') { console.error('refusing to run against :3080 or without the sandbox DSH_HOME: this check writes files. Use the sandbox (source scripts/sandbox/env.sh).'); process.exit(3) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let fails = 0
const check = (label, ok, detail) => { if (!ok) fails += 1; console.log((ok ? 'ok   ' : 'FAIL ') + label + (detail !== undefined && !ok ? ' | ' + detail : '')) }
const shotDir = process.env.KB_SHOT_DIR || join(tmpdir(), 'kb-suggested-pages-live')
mkdirSync(shotDir, { recursive: true })

// ── seed the ledger and one suggested dashboard, straight into the sandbox's home ──
const ledgerFile = join(home, 'kybernos', 'suggestions.json')
mkdirSync(join(home, 'kybernos'), { recursive: true })
const had = existsSync(ledgerFile) ? readFileSync(ledgerFile, 'utf8') : null
const item = (id, kind, text, from) => ({ id, kind, text, from: from || { n: null, span: '', where: '' }, at: new Date().toISOString() })
writeFileSync(ledgerFile, JSON.stringify({ version: 1, items: [
  item('s_ins1', 'instructions', 'Write short, plain sentences. Never promise a date you cannot keep.'),
  item('s_mem1', 'memory', 'Replies to new enquiries within the day.', { n: 14, span: '60 days', where: 'Gmail › Sent' }),
  item('s_mem2', 'memory', 'Prefers a call over a long e-mail thread for quotes.', { n: 6, span: '30 days', where: 'Google Calendar' }),
] }, null, 2), { mode: 0o600 })
const dash = createHost({ fs: fsp, home })
const made = await dash.create({ name: 'Check weekly enquiries', raw: { name: 'Check weekly enquiries', desc: 'Enquiries per week.', widgets: [{ type: 'card', title: 'Tokens', source: { provider: 'usage.daily', params: { days: 7 } }, metric: { agg: 'sum', field: 'tokens' } }] }, by: 'agent', what: 'Created' })
await dash.markSuggested(made.id, 'Seen in 14 enquiries over 60 days')

const live = await openLivePage({ width: 1400, height: 900 })
const { page } = live
const q = async (js) => { const r = await page.evalJs(js, 25000); return r.err ? { __err: r.err } : r.val }
const post = (path, body) => q(`fetch(${JSON.stringify(path)}, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(${JSON.stringify(body)}) }).then((r) => r.json())`)
const ledger = () => JSON.parse(readFileSync(ledgerFile, 'utf8')).items
const agentsFile = join(home, 'AGENTS.md')
const agentsBefore = existsSync(agentsFile) ? readFileSync(agentsFile, 'utf8') : null
let learnId = null
try {
  await sleep(3000)
  // ── Memory & Lessons ──
  check('settings opens', (await openSettings(page, { minCells: 0 })) === true)
  check('the Memory page opens', (await goToSettingsPage(page, 'Memory & Lessons', { marker: `!!document.querySelector('.kbmem-page')` })) === true)
  await waitFor(page, `!!document.querySelector('[data-sug="block"]')`, 15000)
  check('Memory: the dashed block lists the two memories with their proof', (await q(`document.querySelectorAll('[data-sug="row"]').length`)) === 2 && /14×.*60 days.*Gmail/.test(String(await q(`document.querySelector('[data-sug="row"]').textContent`))))
  check('Memory: the block pulses', (await q(`!!document.querySelector('[data-sug="block"] .kb-ping')`)) === true)
  check('Memory: without an account Add and Edit wait, and the block says why', (await q(`document.querySelector('[data-sug="add"]').disabled === true && document.querySelector('[data-sug="edit"]').disabled === true && !!document.querySelector('[data-sug="account"]')`)) === true)
  await page.shot(join(shotDir, 'memory-block.png')).catch(() => null)
  await q(`document.querySelector('[data-sug="discard"]').click()`); await sleep(1200)
  check('Memory: Discard removes the row and resolves it in the ledger', (await q(`document.querySelectorAll('[data-sug="row"]').length`)) === 1 && !ledger().some((i) => i.id === 's_mem1') && ledger().some((i) => i.id === 's_mem2'))

  // ── Settings › Kybernos: the instructions ──
  check('the Kybernos section opens', (await goToSettingsPage(page, /^Kybernos/, { marker: `!!document.querySelector('[data-kb="ky-instr-field"]')` })) === true)
  await waitFor(page, `!!document.querySelector('[data-kb="ky-instr-suggested"]')`, 12000)
  check('Instructions: the dashed block shows the suggested section with the three actions', /Never promise a date/.test(String(await q(`(document.querySelector('[data-kb="ky-sug-text"]') || { textContent: '' }).textContent`))) && (await q(`['ky-sug-add','ky-sug-edit','ky-sug-discard'].every((k) => !!document.querySelector('[data-kb="' + k + '"]'))`)) === true)
  await page.shot(join(shotDir, 'instructions-block.png')).catch(() => null)
  await q(`document.querySelector('[data-kb="ky-sug-add"]').click()`); await sleep(2000)
  const saved = await q(`fetch('/kybernos-cloud/instructions').then((r) => r.json())`)
  check('Instructions: Add wrote the section under a heading and the date, through the ordinary Save', saved.ok === true && /# Learned from your work \(\d{4}-\d{2}-\d{2}\)\nWrite short, plain sentences/.test(String(saved.text)), JSON.stringify(saved).slice(0, 300))
  check('Instructions: the block goes and the ledger is told', (await q(`!document.querySelector('[data-kb="ky-instr-suggested"]')`)) === true && !ledger().some((i) => i.id === 's_ins1'))

  // ── Dashboards ──
  await page.send('Page.reload', { ignoreCache: true }); await sleep(4000)
  const dbRow = `[...document.querySelectorAll('.kb4-item')].find((e) => /Dashboards/i.test(e.textContent))`
  check('the Dashboards menu row pulses while a suggestion waits', (await waitFor(page, `(() => { const r = ${dbRow}; return !!r && !!r.querySelector('.kb-ping') })()`, 15000)) !== null)
  await clickText(page, 'Dashboards'); await sleep(2500)
  check('Dashboards: the suggestion sits in a dashed block, not in My dashboards', (await q(`document.querySelectorAll('[data-kb="suggested-row"]').length`)) === 1 && (await q(`[...document.querySelectorAll('[data-kb="dashboards-card"] h3')].every((e) => e.textContent !== 'Check weekly enquiries')`)) === true)
  check('...and says where it comes from and its proof', /Suggested by Kaby · Seen in 14 enquiries/.test(String(await q(`document.querySelector('[data-kb="suggested-row"] .kbdb-sug-proof').textContent`))))
  await page.shot(join(shotDir, 'dashboards-block.png')).catch(() => null)
  await q(`document.querySelector('[data-kb="suggested-add"]').click()`); await sleep(1800)
  check('Dashboards: Add moves it into My dashboards and the pulse stops', (await q(`[...document.querySelectorAll('[data-kb="dashboards-card"] h3')].some((e) => e.textContent === 'Check weekly enquiries')`)) === true && (await waitFor(page, `(() => { const r = ${dbRow}; return !!r && !r.querySelector('.kb-ping') })()`, 8000)) !== null)
  const made2 = await dash.create({ name: 'Check discard me', raw: { name: 'Check discard me', widgets: [] }, by: 'agent', what: 'Created' })
  await dash.markSuggested(made2.id, '')
  await clickText(page, 'Skills'); await sleep(600); await clickText(page, 'Dashboards'); await sleep(3000)
  await q(`document.querySelector('[data-kb="suggested-discard"]').click()`); await sleep(1500)
  check('Dashboards: Discard removes the suggestion for good (file included)', (await q(`!document.querySelector('[data-kb="suggested-block"]')`)) === true && !existsSync(join(home, 'kybernos', 'dashboards', 'files', made2.id + '.miniapp.json')))

  // ── Learn my business (the recipe the starter kit creates) ──
  const body = { action: 'learn', lang: 'en', tz: 'Europe/Paris', fieldId: 'immo', field: 'Real estate', goals: ['Mandates'], about: { site: 'https://agence.test', profile: '', words: 'Local agency' } }
  const l1 = await post('/kybernos/tasks', body)
  learnId = l1.task && l1.task.id
  check('Learn: created once, on, weekly, in a session of its own, asking first', l1.ok === true && l1.existed === false && l1.task.active === true && l1.task.schedule.cron === '0 7 * * 1' && l1.task.sessionMode === 'home' && l1.task.approvals === 'ask' && typeof l1.task.nextRun === 'string')
  const l2 = await post('/kybernos/tasks', Object.assign({}, body, { lang: 'fr' }))
  check('Learn: asked again, in another language, it is found and not doubled', l2.ok === true && l2.existed === true && l2.task.id === learnId)
  await clickText(page, 'Skills'); await sleep(600); await clickText(page, 'Automations'); await sleep(2500)
  check('Learn: it is a normal row of Automations, switched on', (await q(`[...document.querySelectorAll('.kba-rowline .kba-name')].some((e) => e.textContent === 'Learn my business')`)) === true)
} catch (e) {
  fails += 1
  console.log('FAIL an error nobody caught: ' + String(e && e.message ? e.message : e).slice(0, 300))
} finally {
  try { if (learnId !== null) await post('/kybernos/tasks', { action: 'delete', id: learnId }) } catch (e) { /* gone */ }
  try { for (const d of (await dash.list()).dashboards.filter((x) => /^Check /.test(x.name))) { await dash.setFlags(d.id, { suggested: false }); await fsp.rm(join(home, 'kybernos', 'dashboards', 'files', d.id + '.miniapp.json'), { force: true }) } } catch (e) { /* gone */ }
  if (had !== null) writeFileSync(ledgerFile, had); else rmSync(ledgerFile, { force: true })
  if (agentsBefore !== null) writeFileSync(agentsFile, agentsBefore); else rmSync(agentsFile, { force: true })
  await live.close()
}
console.log(fails === 0 ? '\nall checks passed' : '\n' + fails + ' check(s) FAILED')
process.exit(fails === 0 ? 0 : 1)
