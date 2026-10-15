#!/usr/bin/env node
// « Search for new models » on the Ollama Local Models page, in a real GUI: it runs its three calls in order and names the
// one that is running, it says what the catalogue answered, and the page always says where the list comes from.
//
//   source scripts/sandbox/env.sh && node scripts/check-ollama-search-live.mjs [--shots <dir>]
//
// Needs a DSH that serves this checkout (scripts/sandbox/start.sh, restarted after a host change: the route is host code).
// Refuses :3080. Read-only: nothing here installs or wires a model. The sandbox has no catalogue key, so the answer is the
// honest « not active yet »; the signed path (a good, tampered, older, oversized catalogue) is played by
// packages/kybernos-modeles-locaux/test-modeles-catalogue.mjs against a local server.
// Exit code 0 / 1 / 3.
import { join } from 'node:path'
import { openLivePage } from './live-page.mjs'

const args = process.argv.slice(2)
const shotDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }

const host = process.env.KB_HOST || '127.0.0.1:3080'
if (host === '127.0.0.1:3080') { console.error('○ inconclusive: this check needs a DSH that serves this checkout (a sandbox instance), not the one on :3080. Set KB_HOST, DSH_HOME and HOME.'); process.exit(3) }

const live = await openLivePage({ width: 1500, height: 1000 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const val = async (e, ms) => (await page.evalJs(e, ms)).val
const poll = async (fn, ms = 10000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await sleep(150) } }

try {
  await sleep(3000)
  if ((await val(`/Add an API key to get started/.test(document.body.innerText)`)) === true) {
    const pos = await val(`(() => { const e = Array.from(document.querySelectorAll('*')).filter((e) => e.children.length === 0 && (e.innerText || '').trim() === 'Configure later')[0]; if (!e) return null; const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }) })()`)
    if (typeof pos === 'string') { const { x, y } = JSON.parse(pos); await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }); await sleep(700) }
  }
  await val(`document.querySelector('[class*="settingsArea"] button[class*="trigger"]').click()`)
  check('Settings open', (await poll(() => val(`/Back to workspace/.test(document.body.innerText)`), 8000)) === true)
  const went = await val(`(() => { const b = Array.from(document.querySelectorAll('button[class*="navCell"]')).find((x) => x.innerText.trim().split('\\n')[0] === 'Ollama Local Models'); if (!b) return false; b.click(); return true })()`)
  check('the page opens', went === true)
  await poll(() => val(`!!document.querySelector('.kml-scan-source')`), 8000)

  const before = await val(`(document.querySelector('.kml-scan-source') || { innerText: '' }).innerText`)
  check('before any search, the page says where its list comes from', /^List: /.test(before), before)
  check('the list has the recommended models', (await val(`document.querySelectorAll('[data-kml-carte]').length`)) >= 6)
  // The button sits in the machine tile, which is drawn once the machine has been measured.
  await poll(() => val(`!!document.querySelector('button[aria-label="Re-check"]')`), 25000)
  check('the button says what it does', (await val(`(document.querySelector('button[aria-label="Re-check"]') || { innerText: '' }).innerText`)).includes('Search for new models'))

  await val(`window.__kmlSteps = []; new MutationObserver(() => { const e = document.querySelector('[data-etape]'); if (e && window.__kmlSteps[window.__kmlSteps.length - 1] !== e.dataset.etape) window.__kmlSteps.push(e.dataset.etape) }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true })`)
  await val(`document.querySelector('button[aria-label="Re-check"]').click()`)
  const answered = await poll(() => val(`!!document.querySelector('[data-cat]')`), 30000)
  check('the search ends with an answer about the catalogue', answered === true)
  const steps = await val(`window.__kmlSteps`)
  check('the three real calls are named, in order: installed models, this machine, the catalogue', JSON.stringify(steps) === JSON.stringify(['ollama', 'machine', 'catalogue']), steps)
  const state = await val(`(document.querySelector('[data-cat]') || { getAttribute: () => null }).getAttribute('data-cat')`)
  const text = await val(`(document.querySelector('[data-cat]') || { innerText: '' }).innerText`)
  check('the answer is honest: no key embedded means « not active yet », never a made-up « up to date »', state === 'refused' ? /not active yet/.test(text) : ['ok', 'offline', 'off'].includes(state), { state, text })
  const after = await val(`(document.querySelector('.kml-scan-source') || { innerText: '' }).innerText`)
  check('the list is still there, with its provenance', /^List: /.test(after) && (await val(`document.querySelectorAll('[data-kml-carte]').length`)) >= 6, after)
  if (shotDir !== null) { try { await page.shot(join(shotDir, 'ollama-search.png')) } catch (e) { /* no screenshot */ } }
} catch (e) {
  fail += 1
  console.log('  ✗ the check stopped: ' + e.message)
} finally {
  await live.close()
}
console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)
