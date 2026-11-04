#!/usr/bin/env node
// A reminder (an automation made by the agent's `automation_remind`: one date, in one chat) on the real GUI, in a throw-away signed-in Chrome.
//
//   source scripts/sandbox/env.sh && node scripts/check-reminder-live.mjs [--shots <dir>]
//
// SANDBOX ONLY (it refuses :3080, exit 3): it writes two reminders, shaped as the host stores them, into the sandbox's tasks.json (one waiting for tomorrow, one that ran), then reads
// the list and the sheet of each. The route that makes a reminder is tool-only, so the host half (tool, route, tick, the refusal of `schedule_create`) is proved by
// scripts/test-reminder-route.mjs; this proves what the person sees: the same list and sheet as any automation, no certification panel, a finished one is Done and not Paused.
// The browser half is this checkout's client.js (lib-bundle-swap.mjs); each scheme is forced in the throw-away page only. Exit code 0 / 1 / 3.
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { openLivePage, clickText, waitFor } from './live-page.mjs'
import { swapBundles } from './lib-bundle-swap.mjs'

const argv = process.argv.slice(2)
const shots = argv.indexOf('--shots') >= 0 ? resolve(argv[argv.indexOf('--shots') + 1]) : null
if (shots !== null) mkdirSync(shots, { recursive: true })
const host = String(process.env.KB_HOST || '127.0.0.1:3080')
const dshHome = String(process.env.DSH_HOME || '')
if (/:3080$/.test(host) || dshHome.indexOf('.kybernos-sandbox') < 0) { console.log('refused: this check writes two reminders, so it runs on a sandbox only (source scripts/sandbox/env.sh first)'); process.exit(3) }

const file = join(dshHome, 'kybernos', 'tasks.json')
const before = existsSync(file) ? readFileSync(file, 'utf8') : null
const now = Date.now()
const iso = (ms) => new Date(ms).toISOString()
const reminder = (n, name, prompt, atMs, active, ran) => ({
  id: 'st-reminder-live-' + n, createdAt: iso(now - 3600000), updatedAt: iso(now - 3600000), history: ran ? [{ at: iso(atMs), sessionId: 'sess-demo', status: 'fired', via: 'schedule' }] : [], lastRun: ran ? iso(atMs) : null, homeOwn: false,
  name, prompt, schedule: { mode: 'once', tz: 'Europe/Paris', at: iso(atMs).slice(0, 19) + 'Z' }, runsOn: 'local', active, approvals: 'ask', sessionMode: 'home', homeSessionId: 'sess-demo',
  origin: { by: 'chat', recipe: 'reminder', at: iso(now - 3600000) }, nextRun: active ? iso(atMs) : null
})
mkdirSync(join(dshHome, 'kybernos'), { recursive: true })
writeFileSync(file, JSON.stringify([
  reminder(1, 'Call the plumber', 'Remind the person to call the plumber about the leak under the sink.', now + 86400000, true, false),
  reminder(2, 'Send the invoice', 'Remind the person to send the March invoice before noon.', now - 1800000, false, true)
], null, 2), { mode: 0o600 })
try { chmodSync(file, 0o600) } catch (e) { /* the mode was set at write */ }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let fails = 0
const check = (label, ok, detail) => { if (!ok) fails += 1; console.log((ok ? 'ok   ' : 'FAIL ') + label + (detail !== undefined && !ok ? ' | ' + detail : '')) }
const live = await openLivePage({ width: 1500, height: 1000 })
const { page } = live
const q = async (js) => { const r = await page.evalJs(js, 25000); return r.err ? { __err: r.err } : r.val }
const shot = async (name) => { if (shots !== null) await page.shot(resolve(shots, name + '.png')).catch(() => null) }
const open = async (i) => {
  await q(`(() => { const e = document.querySelector('[data-kb="back-to-list"], .kba-crumb'); if (e) e.click() })()`)
  await sleep(600)
  await q(`(() => { const n = document.querySelectorAll('.kba-rowline .kba-name')[${i}]; if (n) n.click() })()`)
  return waitFor(page, `!!document.querySelector('[data-kb="automation-sheet"]')`, 6000)
}
try {
  const swap = await swapBundles(page, [{ name: 'kybernos-plugin' }])
  await page.send('Page.reload', {})
  await sleep(3500)
  check('this checkout\'s client is the one on the page', swap.report().every((r) => r.replaced === true), JSON.stringify(swap.report()))
  await clickText(page, 'Automations')
  await waitFor(page, `document.querySelectorAll('.kba-rowline .kba-name').length >= 2`, 12000)
  const names = await q(`[...document.querySelectorAll('.kba-rowline .kba-name')].map((n) => n.textContent.trim())`)
  check('both reminders are in the Automations list, like any automation', Array.isArray(names) && names.indexOf('Call the plumber') >= 0 && names.indexOf('Send the invoice') >= 0, JSON.stringify(names))
  const rowText = (name) => q(`(() => { const n = [...document.querySelectorAll('.kba-rowline')].find((r) => r.textContent.indexOf(${JSON.stringify(name)}) >= 0); return n ? n.textContent : '' })()`)
  const done = String(await rowText('Send the invoice'))
  check('the reminder that ran says Done, not Paused', done.indexOf('Done') >= 0 && done.indexOf('Paused') < 0, done)
  await shot('reminder-list')
  const i1 = names.indexOf('Call the plumber')
  const i2 = names.indexOf('Send the invoice')
  for (const [i, label] of [[i1, 'waiting'], [i2, 'done']]) {
    check('the ' + label + ' reminder opens on its sheet', (await open(i)) === true)
    check('...with no certification panel (a reminder has none to show)', (await q(`!!document.querySelector('[data-kb="gate-panel"]')`)) === false)
    check('...the eight cards of the sheet are there', (await q(`['prompt','when','where','who','uses','safety','cost','runs'].filter((k) => document.querySelector('[data-kb="sheet-card-' + k + '"]')).length`)) === 8)
    check('...the trigger reads « One time » and the approvals ask first', (await q(`(document.querySelector('[data-kb="sheet-trigger"]') || {}).textContent || ''`)).indexOf('One time') >= 0 && (await q(`document.querySelector('[data-kb="automation-sheet"]').textContent.indexOf('Ask me first') >= 0`)) === true)
    check('...no horizontal scroll', (await q(`document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1`)) === true)
    for (const dark of [true, false]) {
      await q(`(() => { document.documentElement.setAttribute('data-kb-theme', ${JSON.stringify(dark ? 'dark' : 'light')}); if (${dark}) document.body.setAttribute('data-ds-dark-theme', ''); else document.body.removeAttribute('data-ds-dark-theme') })()`)
      await sleep(700)
      await shot('reminder-' + label + '-' + (dark ? 'dark' : 'light'))
    }
  }
} catch (e) {
  fails += 1
  console.log('FAIL an error nobody caught: ' + String(e && e.message ? e.message : e).slice(0, 300))
} finally {
  await live.close()
  // The sandbox goes back to what it held before.
  if (before === null) { try { writeFileSync(file, '[]', { mode: 0o600 }) } catch (e) { /* sandbox only */ } } else writeFileSync(file, before, { mode: 0o600 })
}
console.log(fails === 0 ? '\nall checks passed' : '\n' + fails + ' check(s) FAILED')
process.exit(fails === 0 ? 0 : 1)
