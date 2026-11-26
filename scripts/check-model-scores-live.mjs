#!/usr/bin/env node
// « Load model scores » on AI provider and models › Models, in a real GUI (audit V-37): a fresh install has no score snapshot, so the
// Score badge, the Score filter and the Score sort never show. The page now offers a visible way in, and reads nothing before the click.
//
//   source scripts/sandbox/env.sh && node scripts/check-model-scores-live.mjs [--shots <dir>]
//
// FAIL CLOSED: the scores routes of the host (`/kybernos-models/scores*`) read two outside sites (Artificial Analysis, BenchLM) when
// `/sync` is called. Every request to them is intercepted in the browser and ANSWERED HERE (a canned snapshot); none reaches the host,
// and an unknown one is refused. Nothing is installed, saved or sent. Refuses :3080 and a home that is not a sandbox (exit 3).
// Exit code 0 / 1 / 3.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { openLivePage, openSettings, waitFor, clickText } from './live-page.mjs'

const args = process.argv.slice(2)
const shotDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null
if (shotDir !== null) mkdirSync(shotDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 400))) } }

const host = process.env.KB_HOST || '127.0.0.1:3080'
if (host === '127.0.0.1:3080') { console.error('○ inconclusive: this check needs a DSH that serves this checkout (a sandbox instance), not the one on :3080. Set KB_HOST, DSH_HOME and HOME.'); process.exit(3) }
if (!(process.env.DSH_HOME || '').includes('.kybernos-sandbox')) { console.error('○ inconclusive: DSH_HOME is not an isolated instance. Run: source scripts/sandbox/env.sh'); process.exit(3) }

const live = await openLivePage({ width: 1400, height: 1000 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const val = async (e, ms) => (await page.evalJs(e, ms || 8000)).val
const shot = async (name) => { if (shotDir === null) return; try { await page.shot(join(shotDir, name + '.png')) } catch (e) { /* no screenshot */ } }
const click = async (sel) => {
  const r = await val(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })()`)
  if (!r) return false
  for (const t of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type: t, x: r.x, y: r.y, button: 'left', clickCount: 1 })
  return true
}

// The interceptor: every request to /kybernos-models/scores* is answered here, none goes to the host.
const seen = { list: 0, sync: [], status: 0, other: [] }
const state = { synced: false }
page.on('Fetch.requestPaused', async (p) => {
  const reply = (code, body) => page.send('Fetch.fulfillRequest', {
    requestId: p.requestId, responseCode: code,
    responseHeaders: [{ name: 'content-type', value: 'application/json' }], body: Buffer.from(JSON.stringify(body), 'utf8').toString('base64'),
  })
  try {
    const url = new URL(p.request.url)
    const path = url.pathname
    if (path === '/kybernos-models/scores/list') {
      seen.list += 1
      let scores = {}
      if (state.synced === true) {
        // A score for every model the page asks about (the badge only shows on the rows that are drawn).
        let models = []
        try { models = JSON.parse(p.request.postData || '{}').models || [] } catch (e) { models = [] }
        for (const m of models) if (m && typeof m.key === 'string') scores[m.key] = 31.2
      }
      await reply(200, { ok: true, version: 1, at: state.synced ? Date.now() : null, stale: !state.synced, scores })
    } else if (path === '/kybernos-models/scores/sync') {
      seen.sync.push({ method: p.request.method, body: p.request.postData || '' })
      state.synced = true
      await reply(200, { ok: true, started: true, running: true })
    } else if (path === '/kybernos-models/scores/status') {
      seen.status += 1
      await reply(200, { ok: true, version: 1, at: Date.now(), sources: null, job: { running: false } })
    } else {
      seen.other.push(path)
      await reply(404, { ok: false, error: 'refused by the check' })
    }
  } catch (e) { try { await reply(500, { ok: false, error: 'check' }) } catch (e2) { /* gone */ } }
})
await page.send('Fetch.enable', { patterns: [{ urlPattern: '*kybernos-models/scores*', requestStage: 'Request' }] })

try {
  await sleep(1500)
  if ((await openSettings(page, { minCells: 3 })) !== true) { console.error('○ inconclusive: the Settings dialog did not open'); process.exit(3) }
  await clickText(page, 'AI provider and models')
  const tab = await waitFor(page, `document.querySelector('[data-kbm="tab-models"]') !== null`, 20000)
  if (tab === null) { console.error('○ inconclusive: the AI provider and models page did not draw its Models tab'); process.exit(3) }
  await click('[data-kbm="tab-models"]')
  const listed = await waitFor(page, `document.querySelectorAll('[data-kbm="item"]').length > 0`, 20000)
  if (listed === null) { console.error('○ inconclusive: the Models tab lists no model in this sandbox'); process.exit(3) }
  await sleep(1200) // the Score column is read once the models are known

  console.log('before any click')
  check('the Models tab asked the host for the scores it already holds (one read, nothing more)', seen.list >= 1 && seen.sync.length === 0, { list: seen.list, sync: seen.sync.length })
  check('no score badge, no Score filter, no Score sort yet', (await val(`document.querySelectorAll('[data-kbm="row-score"]').length`)) === 0 && (await val(`document.querySelector('[data-kbm="menu-score"]') === null`)) === true)
  const button = JSON.parse(await val(`(() => { const b = document.querySelector('[data-kbm="scores-load"]'); if (!b) return JSON.stringify(null); const r = b.getBoundingClientRect(); return JSON.stringify({ text: b.textContent.trim(), disabled: b.disabled, w: Math.round(r.width), h: Math.round(r.height), title: b.title }) })()`))
  check('a visible « Load model scores » button is in the results bar', button !== null && button.text === 'Load model scores' && button.disabled === false && button.w > 40 && button.h > 10, button)
  check('it says what it reads, and that nothing is read before the click', button !== null && /Artificial Analysis/.test(button.title) && /Nothing is read before you click/.test(button.title), button)
  await shot('scores-before')

  console.log('the click')
  await click('[data-kbm="scores-load"]')
  await waitFor(page, `document.querySelectorAll('[data-kbm="row-score"]').length > 0`, 25000)
  check('one sync was asked, forced (the person clicked), by POST', seen.sync.length === 1 && seen.sync[0].method === 'POST' && /"force":true/.test(seen.sync[0].body), seen.sync)
  check('the page looked at the job status before reading the column again', seen.status >= 1, seen.status)
  const after = JSON.parse(await val(`JSON.stringify({ badges: document.querySelectorAll('[data-kbm="row-score"]').length, text: (document.querySelector('[data-kbm="row-score"]') || { textContent: '' }).textContent, button: document.querySelector('[data-kbm="scores-load"]') !== null, menu: document.querySelector('[data-kbm="menu-score"]') !== null })`))
  check('the Score badges show (« II 31.2 »), and the button is gone', after.badges > 0 && /31\.2/.test(after.text) && after.button === false, after)
  check('the Score filter is in the bar now', after.menu === true, after)
  await shot('scores-after')

  console.log('nothing else happened')
  check('no request to the scores routes went anywhere else than the interceptor (no unknown path)', seen.other.length === 0, seen.other)
} catch (e) {
  fail += 1
  console.log('  ✗ the check stopped: ' + e.message)
} finally {
  try { await page.send('Fetch.disable', {}) } catch (e) { /* closing */ }
  await live.close()
}
console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)
