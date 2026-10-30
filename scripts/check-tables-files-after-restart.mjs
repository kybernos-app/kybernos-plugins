#!/usr/bin/env node
// What a restart must not lose: the files check-tables-live.mjs attached to the « Contract » row of the Papers db are still there. Run it after
//   scripts/sandbox/stop.sh && scripts/sandbox/start.sh
// It reads the host the way the page does (no write), asks for each file by the row that holds it and compares the bytes with the ones that were sent, then opens the page and looks
// at the row: the thumbnail of the image decodes and the PDF is listed by its name.
//
//   source scripts/sandbox/env.sh && node scripts/check-tables-files-after-restart.mjs
//
// SANDBOX ONLY (exit 3 against :3080 and without a sandbox DSH_HOME). Exit code: 0 all green, 1 a check failed, 3 not run.
import { cookieDeSession } from './cdp-lib.mjs'
import { FILE_FIXTURES as F, bytesOf, shaOf as sha } from './lib-tables-seed.mjs'
import { clickText, openLivePage } from './live-page.mjs'

const host = process.env.KB_HOST || ''
const dshHome = process.env.DSH_HOME || ''
if (host === '' || /:3080$/.test(host)) { console.error('○ not run: sandbox only. `source scripts/sandbox/env.sh` first (KB_HOST is "' + host + '")'); process.exit(3) }
if (!dshHome.includes('.kybernos-sandbox')) { console.error('○ not run: DSH_HOME is not a sandbox\'s (' + dshHome + ')'); process.exit(3) }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 500))) }
}
const cookie = cookieDeSession(host)
if (cookie === null) { console.error('○ not run: the sandbox\'s session secret is unreadable'); process.exit(3) }
const raw = (path) => fetch('http://' + host + path, { headers: { cookie: cookie.nom + '=' + cookie.valeur } })
const state = await raw('/kybernos-db/state').then((r) => r.json()).catch(() => null)
if (state === null || state.ok !== true) { console.error('○ not run: the sandbox does not answer on ' + host + ' (scripts/sandbox/start.sh)'); process.exit(3) }
const papers = state.dbs.find((d) => d.name === 'Papers')
if (papers === undefined) { console.error('○ not run: no Papers db here: run check-tables-live.mjs first'); process.exit(3) }

const rows = (await raw('/kybernos-db/records?db=' + papers.id + '&object=doc').then((r) => r.json())).records
const contract = rows.find((r) => r.values.name === 'Contract')
const held = (contract && contract.values.files) || []
const wanted = [F.png, F.pdf, F.txt]
check('the Contract row still holds the three files, in the order they were attached', held.map((f) => f.hash).join() === wanted.map(sha).join(), held.map((f) => f.name))
for (const f of wanted) {
  const r = await raw('/kybernos-db/file?db=' + papers.id + '&object=doc&id=' + (contract ? contract.id : '') + '&field=files&hash=' + sha(f))
  const body = Buffer.from(await r.arrayBuffer())
  check(f.name + ' is served again, byte for byte', r.status === 200 && body.equals(bytesOf(f)), { status: r.status, size: body.length })
}

const live = await openLivePage({ width: 1500, height: 950 }).catch((e) => { console.error('○ not run: ' + e.message); process.exit(3) })
const { page } = live
try {
  await page.send('Runtime.enable', {})
  const ev = async (js) => { const r = await page.evalJs(js, 10000); return r.err ? { err: r.err } : r.val }
  const until = async (fn, ms = 9000) => { const end = Date.now() + ms; let last; while (Date.now() < end) { last = await fn(); if (last) return last; await sleep(200) } return last }
  await sleep(2500)
  check('the page opens on the Tables row', (await clickText(page, 'Tables')) === true && (await until(() => ev(`document.querySelector('[data-kb="tables-bar"]') !== null`))) === true)
  const chose = await until(() => ev(`(() => { const e = document.querySelector('[data-kb="tables-db"]'); if (e === null) return false; e.value = ${JSON.stringify(papers.id)}; e.dispatchEvent(new Event('change', { bubbles: true })); return e.value === ${JSON.stringify(papers.id)} })()`))
  const cell = `[data-kb="tables-row"][data-id="${contract ? contract.id : ''}"] [data-kb="tables-cell-files"]`
  check('the row shows the image as a thumbnail that decodes, and the PDF by its name', chose === true && (await until(() => ev(`(() => { const i = document.querySelector(${JSON.stringify(cell + ' img')}); const t = document.querySelector(${JSON.stringify(cell)}); return i !== null && i.complete && i.naturalWidth === 12 && t !== null && /contract\\.pdf/.test(t.innerText) })()`))) === true)
} catch (e) {
  fail += 1
  console.log('  ✗ the run stopped: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e))
} finally {
  await live.close()
}
console.log('\ncheck-tables-files-after-restart: ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
