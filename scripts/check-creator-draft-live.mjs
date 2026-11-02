#!/usr/bin/env node
// « Let the agent help me create a preset » (Settings › Agent presets), in a real GUI: it must land in a Creator-mode chat whose
// composer already holds the brief, with Settings closed. DSH ships that button with no draft; the client hands it one.
//
//   source scripts/sandbox/env.sh && node scripts/check-creator-draft-live.mjs [--shots <dir>]
//
// Needs a DSH that serves this checkout (scripts/sandbox/start.sh). Refuses :3080. The draft is NOT sent.
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
const BUTTON = `Array.from(document.querySelectorAll('button')).find((x) => /Let the agent help me create a preset/.test(x.innerText))`

try {
  await sleep(3000)
  if ((await val(`/Add an API key to get started/.test(document.body.innerText)`)) === true) {
    const pos = await val(`(() => { const e = Array.from(document.querySelectorAll('*')).filter((e) => e.children.length === 0 && (e.innerText || '').trim() === 'Configure later')[0]; if (!e) return null; const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }) })()`)
    if (typeof pos === 'string') { const { x, y } = JSON.parse(pos); await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }); await sleep(700) }
  }
  await val(`document.querySelector('[class*="settingsArea"] button[class*="trigger"]').click()`)
  check('Settings open', (await poll(() => val(`/Back to workspace/.test(document.body.innerText)`), 8000)) === true)
  await val(`(() => { const b = Array.from(document.querySelectorAll('button[class*="navCell"]')).find((x) => x.innerText.trim().split('\\n')[0] === 'Agent presets'); if (b) b.click() })()`)
  check('the Agent presets page has the button', (await poll(() => val(`!!(${BUTTON})`), 8000)) === true)
  await val(`(${BUTTON}).click()`)
  const landed = await poll(() => val(`!/Back to workspace/.test(document.body.innerText) && !!document.querySelector('[contenteditable="true"]')`), 12000)
  check('Settings close and a chat is open', landed === true)
  await sleep(800)
  const draft = await val(`(document.querySelector('[contenteditable="true"]') || { innerText: '' }).innerText`)
  check('the composer already holds the brief', /Help me create an agent preset/.test(draft) && /editing-cordis-compositions/.test(draft) && /write nothing until I have approved/.test(draft), draft.slice(0, 160))
  check('the chat is a Creator-mode chat', (await val(`/Creator mode/.test(document.body.innerText)`)) === true)
  check('nothing was sent: no message in the chat', (await val(`document.querySelectorAll('[data-message-role], [class*="userMessage"]').length`)) === 0)
  if (shotDir !== null) { try { await page.shot(join(shotDir, 'creator-draft.png')) } catch (e) { /* no screenshot */ } }
} catch (e) {
  fail += 1
  console.log('  ✗ the check stopped: ' + e.message)
} finally {
  await live.close()
}
console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)
