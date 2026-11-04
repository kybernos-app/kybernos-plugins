#!/usr/bin/env node
// Case J19-09 of docs/tests/user-journey: how long a person waits, measured on the REAL GUI of a SANDBOX, against proposed budgets.
//
//   source scripts/sandbox/env.sh && node scripts/measure-budgets-live.mjs [--runs 5] [--json <file outside the repo>]
//
// What is timed, each `--runs` times, from a clean load (a measured number needs a quiet machine: stop other live runs first):
//   shell     navigating to the address until the sidebar and the composer are drawn (« start-up time » as the person sees it);
//   <page>    pressing a sidebar entry until its page title is on screen (Skills, Creations, Automations, Connectors);
//   settings  from the press that opens the Settings dialog until its navigation is drawn (the 1 s pause between the account chip and its menu is in it).
// Not here: the first token of a model answer (needs a real or stand-in model: the replica journeys time it) and a 5,000-row table (scripts/check-tables-big-live.mjs).
// The budgets are PROPOSALS (the owner decides them): a median above its budget is reported « over », and the exit code stays 0, because a first measure sets a baseline and
// does not gate. Exit 0 measured, 1 could not run, 3 not a sandbox.
import { writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { clickText, openLivePage, openSettings, waitFor } from './live-page.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const BUDGETS_MS = { shell: 6000, Skills: 1500, Creations: 1500, Automations: 1500, Connectors: 1500, settings: 2500 }

/** The median and the slowest of a list of numbers, rounded to a millisecond. Pure. */
export function summarise (ms) {
  const sorted = ms.slice().sort((a, b) => a - b)
  if (sorted.length === 0) return { median: null, worst: null, runs: 0 }
  const mid = sorted.length >> 1
  return { median: Math.round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2), worst: Math.round(sorted[sorted.length - 1]), runs: sorted.length }
}

/** `over` when the median is above its budget, `within` otherwise, `no budget` when none is proposed. Pure. */
export const against = (name, summary, budgets = BUDGETS_MS) => (budgets[name] === undefined ? 'no budget' : (summary.median !== null && summary.median > budgets[name] ? 'over' : 'within'))

async function main () {
  const argv = process.argv.slice(2)
  const opt = (n, d = '') => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d }
  const runs = Number(opt('--runs', '5'))
  const host = process.env.KB_HOST || ''
  if (!host || !process.env.DSH_HOME || /:3080$/.test(host) || /:879[12]$/.test(host)) { console.error('○ not run: sandbox only (source scripts/sandbox/env.sh)'); process.exit(3) }
  const json = opt('--json')
  if (json && !relative(REPO, resolve(json)).startsWith('..')) { console.error('measure-budgets-live: --json must be a file outside the repository'); process.exit(2) }
  const live = await openLivePage({ authority: host, width: 1440, height: 900 })
  const { page } = live
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const shellReady = `/agent teams|kybers/i.test(document.body ? document.body.innerText : '') && !!document.querySelector('textarea, [contenteditable=true], [role=textbox]')`
  const times = {}
  const add = (k, ms) => { (times[k] = times[k] || []).push(ms) }
  try {
    for (let i = 0; i < runs; i += 1) {
      let t0 = Date.now()
      await page.send('Page.navigate', { url: 'http://' + host + '/' })
      if ((await waitFor(page, shellReady, 30000)) === null) { console.error('the shell never came up on run ' + (i + 1)); continue }
      add('shell', Date.now() - t0)
      await sleep(1500)
      for (const name of ['Skills', 'Creations', 'Automations', 'Connectors']) {
        t0 = Date.now()
        if (!(await clickText(page, name))) continue
        const shown = await waitFor(page, `Array.from(document.querySelectorAll('h1, h2, [role=heading]')).some((e) => e.getBoundingClientRect().width > 0 && ${JSON.stringify(name.toLowerCase())} === (e.innerText || '').replace(/[⟦⟧]/g, '').trim().toLowerCase().slice(0, ${name.length}))`, 8000)
        if (shown !== null) add(name, Date.now() - t0)
        await sleep(500)
      }
      await page.send('Page.navigate', { url: 'http://' + host + '/' })
      await waitFor(page, shellReady, 30000)
      await sleep(1200)
      // from the press on the account chip (and the 1 s the menu needs to open) to the navigation drawn: not the waits openSettings makes before the press (UJ-53)
      const timing = {}
      if (await openSettings(page, { tries: 1, timing }) && timing.pressedAt && timing.shownAt) add('settings', timing.shownAt - timing.pressedAt)
    }
  } finally { await live.close() }
  const report = {}
  console.log(`J19-09 on ${host}, ${runs} runs (a first measure, proposed budgets, nothing gates):`)
  for (const [name, list] of Object.entries(times)) {
    const s = summarise(list)
    report[name] = { ...s, budget: BUDGETS_MS[name] ?? null, verdict: against(name, s) }
    console.log(`  ${name.padEnd(12)} median ${String(s.median).padStart(5)} ms  slowest ${String(s.worst).padStart(5)} ms  budget ${String(BUDGETS_MS[name] ?? '—').padStart(5)}  ${report[name].verdict}  (${s.runs} runs)`)
  }
  if (json) writeFileSync(resolve(json), JSON.stringify(report, null, 2) + '\n')
  if (Object.keys(report).length === 0) process.exit(1)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main().catch((e) => { console.error(String(e.message || e)); process.exit(1) })
