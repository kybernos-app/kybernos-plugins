// The suggested automations on a real GUI: Kaby proposes, the person adds or discards. SANDBOX ONLY (`source scripts/sandbox/env.sh`): it writes three automations to the
// sandbox's own tasks.json and removes them at the end; the user's own `dsh web` is never the target (exit 3).
//
// Plays: a suggestion posted to the host appears in a dashed card above the list, not in the list and not in the menu count; the Automations menu row pulses; the card says where
// the suggestion comes from and its proof; Add moves it into the list, switched off, and the pulse stops; Discard removes it; a suggestion is never started by Run now / toggle.
//
// Named check-* on purpose: it needs a running sandbox and Chrome, so CI must not run it.
//   source scripts/sandbox/env.sh && node scripts/check-suggested-live.mjs     (KB_SHOT_DIR=/some/dir keeps screenshots)
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLivePage, clickText } from './live-page.mjs'

const authority = process.env.KB_HOST || '127.0.0.1:3080'
if (authority === '127.0.0.1:3080') { console.error('refusing to run against :3080: this check writes automations. Use the sandbox (source scripts/sandbox/env.sh).'); process.exit(3) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let fails = 0
const check = (label, ok, detail) => { if (!ok) fails += 1; console.log((ok ? 'ok   ' : 'FAIL ') + label + (detail !== undefined && !ok ? ' | ' + detail : '')) }
const shotDir = process.env.KB_SHOT_DIR || join(tmpdir(), 'kb-suggested-live')
mkdirSync(shotDir, { recursive: true })

const live = await openLivePage({ width: 1400, height: 900 })
const { page } = live
const q = async (js) => { const r = await page.evalJs(js, 25000); return r.err ? { __err: r.err } : r.val }
const post = (body) => q(`fetch('/kybernos/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(${JSON.stringify(body)}) }).then((r) => r.json())`)
const made = []
const task = (name, extra) => Object.assign({ name, prompt: '1. List the deadlines.', schedule: { mode: 'cron', cron: '0 8 * * 1', tz: 'Europe/Paris' }, active: false }, extra || {})
try {
  await sleep(3000)
  const real = await post({ action: 'create', task: task('Check real automation') })
  made.push(real.task.id)
  const s1 = await post({ action: 'suggest', task: task('Check enquiry summary'), proof: { n: 14, span: '60 days', where: 'Gmail › Contact form', note: '11 of the 14 got the same request' } })
  const s2 = await post({ action: 'suggest', task: task('Check reminders'), proof: { n: 9, span: '30 days', where: 'Google Calendar' } })
  made.push(s1.task.id, s2.task.id)
  check('the host stores two suggestions switched off', s1.ok === true && s2.ok === true && s1.task.active === false && s1.task.suggested === true)
  await clickText(page, 'Automations'); await sleep(2500)
  check('the suggestions sit in a dashed card, two rows', (await q(`document.querySelectorAll('[data-kb="suggested-block"] [data-kb="suggested-row"]').length`)) === 2)
  check('the card is dashed', (await q(`getComputedStyle(document.querySelector('[data-kb="suggested-block"]')).borderTopStyle`)) === 'dashed')
  check('the list holds only the real automation', (await q(`[...document.querySelectorAll('.kba-rowline .kba-name')].map((e) => e.textContent).join('|')`)) === 'Check real automation', await q(`[...document.querySelectorAll('.kba-rowline .kba-name')].map((e) => e.textContent).join('|')`))
  check('a row says where the suggestion comes from and its proof', /Suggested by Kaby.*14×.*60 days.*Gmail/.test(String(await q(`document.querySelector('[data-kb="suggested-row"] .kba-sugmeta').textContent`))))
  check('each row has Add, Edit and Discard', (await q(`['suggested-add','suggested-edit','suggested-discard'].every((k) => document.querySelectorAll('[data-kb="' + k + '"]').length === 2)`)) === true)
  check('the menu count does not include the suggestions', /^\s*1\s*$/.test(String(await q(`(() => { const r = [...document.querySelectorAll('.kb4-item')].find((e) => /Automations|Deadlines|Automations/i.test(e.textContent) && e.querySelector('.kb4-badge')); return r ? r.querySelector('.kb4-badge').textContent : 'none' })()`))))
  check('the menu row pulses while suggestions wait', (await q(`(() => { const r = [...document.querySelectorAll('.kb4-item')].find((e) => e.querySelector('.kb4-badge') && /Automation|Deadline/i.test(e.textContent)); return !!r && !!r.querySelector('.kb-ping') })()`)) === true)
  check('the ping animates (or is static under reduced motion)', (await q(`getComputedStyle(document.querySelector('.kba-sugname .kb-ping'), '::after').animationName`)) !== undefined)
  await page.shot(join(shotDir, 'suggested-block.png')).catch(() => null)
  const run = await post({ action: 'run-now', id: s1.task.id })
  check('Run now is refused on a suggestion', run.ok === false && /add it first/.test(String(run.error)))
  // Add the first one
  await q(`document.querySelector('[data-kb="suggested-add"]').click()`); await sleep(1500)
  const after = await post({ action: 'list' })
  const added = after.tasks.find((t) => t.id === s1.task.id)
  check('Add clears the flag and keeps it switched off', added !== undefined && added.suggested === undefined && added.active === false)
  check('...it is now in the list and one suggestion is left', (await q(`document.querySelectorAll('[data-kb="suggested-row"]').length`)) === 1 && (await q(`[...document.querySelectorAll('.kba-rowline .kba-name')].map((e) => e.textContent).includes('Check enquiry summary')`)) === true)
  // Discard the second
  await q(`document.querySelector('[data-kb="suggested-discard"]').click()`); await sleep(1500)
  const left = await post({ action: 'list' })
  check('Discard deletes the suggestion and the card goes', left.tasks.find((t) => t.id === s2.task.id) === undefined && (await q(`!document.querySelector('[data-kb="suggested-block"]')`)) === true)
  check('the pulse stops when nothing waits', (await q(`(() => { const r = [...document.querySelectorAll('.kb4-item')].find((e) => e.querySelector('.kb4-badge') && /Automation|Deadline/i.test(e.textContent)); return !!r && !r.querySelector('.kb-ping') })()`)) === true)
  // The apps the suggestions ask for: a pulse and a number on the Connectors row, the apps first on the page
  const s3 = await post({ action: 'suggest', task: task('Check needs apps', { needs: ['gmail', 'googlecalendar'] }), proof: { n: 3 } })
  made.push(s3.task.id)
  await clickText(page, 'Skills'); await sleep(800); await clickText(page, 'Automations'); await sleep(3500)
  const cnRow = `[...document.querySelectorAll('.kb4-item')].find((e) => /Connectors/i.test(e.textContent))`
  check('the Connectors row pulses with the number of apps to connect', (await q(`(() => { const r = ${cnRow}; return !!r && !!r.querySelector('.kb-ping') && r.querySelector('.kb4-badge') !== null && r.querySelector('.kb4-badge').textContent === '2' })()`)) === true, await q(`(() => { const r = ${cnRow}; return r ? r.textContent : 'none' })()`))
  await clickText(page, 'Connectors'); await sleep(2500)
  check('on Yours the two apps come first, in dashed cards that say who needs them', (await q(`document.querySelectorAll('[data-kb="yours-need"] .kb7-card').length`)) === 2 && /Needed by.*Check needs apps/.test(String(await q(`document.querySelector('[data-kb="yours-need"]').textContent`))))
  check('the old « For your field » strip is gone', (await q(`!document.querySelector('[data-kb="yours-field"]')`)) === true)
  await page.shot(join(shotDir, 'connectors-need.png')).catch(() => null)
  await q(`document.querySelector('[data-kb="need-later"]').click()`); await sleep(800)
  check('« Not now » silences one pulse and keeps the app listed', (await q(`(() => { const r = ${cnRow}; return !!r && r.querySelector('.kb4-badge').textContent === '1' })()`)) === true && (await q(`document.querySelectorAll('[data-kb="yours-need"] .kb7-card').length`)) === 2)
  await clickText(page, 'Discover'); await sleep(1500)
  check('on Discover the same two apps head one flat list, with no section titles', (await q(`[...document.querySelectorAll('[data-kb="discover-grid"] .kb7-card')].slice(0, 2).every((c) => /Needed by/.test(c.textContent))`)) === true && (await q(`document.querySelectorAll('.kb7-seclab').length`)) === 0)
} catch (e) {
  fails += 1
  console.log('FAIL an error nobody caught: ' + String(e && e.message ? e.message : e).slice(0, 300))
} finally {
  for (const id of made) { try { await post({ action: 'delete', id }) } catch (e) { /* gone */ } }
  await live.close()
}
console.log(fails === 0 ? '\nall checks passed' : '\n' + fails + ' check(s) FAILED')
process.exit(fails === 0 ? 0 : 1)
